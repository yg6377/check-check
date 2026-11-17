-- 013_night_shift_checkout
-- 야간조가 다음 날 새벽에 퇴근 QR 을 찍을 수 있게 한다.
--
-- 지금까지 submit_attendance 는 "찍는 순간의 KST 날짜" 행에만 퇴근을 기록해서,
-- 저녁에 출근하고 자정을 넘겨 퇴근하면 "출근 체크가 먼저 필요합니다"로 거부됐다.
-- 이제 오늘 출근 기록이 없으면 전날의 미퇴근 기록(출근 후 18시간 이내)에 퇴근을 기록한다.
-- 그 경우 반환하는 work_date 는 전날이다.
--
-- 나머지(검증, 위치 기록, 반환 키, 인자)는 012 정의 그대로다. 시그니처가 같아 DROP 없이 교체된다.
-- 재실행해도 안전하다.

CREATE OR REPLACE FUNCTION submit_attendance(
  scanned_code  text,
  action        text,
  p_lat         numeric DEFAULT NULL,
  p_lng         numeric DEFAULT NULL,
  p_accuracy    numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id  uuid;
  v_retire_date date;
  v_site_code  text;
  v_today      date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_now        timestamptz := now();
  v_existing_id          uuid;
  v_existing_check_in    timestamptz;
  v_existing_check_out   timestamptz;
  v_work_date  date;          -- 실제로 타각이 기록되는 근무일 (야간조 퇴근이면 전날)
  -- 위치 기록용 (전부 NULL 이면 "위치 없이 타각")
  v_site       jsonb;
  v_site_lat   double precision;
  v_site_lng   double precision;
  v_radius     double precision;
  v_lat        numeric(10,7);
  v_lng        numeric(10,7);
  v_accuracy   numeric(8,2);
  v_distance   numeric(8,2);
  v_within     boolean;
  v_dist_raw   double precision;
BEGIN
  v_worker_id := current_worker_id();
  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION '근로자 계정으로 로그인되어 있지 않습니다.';
  END IF;

  SELECT retire_date INTO v_retire_date
  FROM workers
  WHERE id = v_worker_id;

  IF v_retire_date IS NOT NULL AND v_retire_date <= v_today THEN
    RAISE EXCEPTION '퇴사 처리된 근로자는 출퇴근을 등록할 수 없습니다.';
  END IF;

  SELECT data INTO v_site FROM settings WHERE category = 'site';
  v_site_code := v_site->>'checkinCode';
  IF v_site_code IS NULL OR length(v_site_code) = 0 THEN
    RAISE EXCEPTION '현장 QR 코드가 아직 발급되지 않았습니다. 관리자에게 문의하세요.';
  END IF;
  IF scanned_code IS NULL OR btrim(scanned_code) != v_site_code THEN
    RAISE EXCEPTION '잘못된 QR 코드입니다.';
  END IF;

  -- ── 위치 계산 ────────────────────────────────────────────
  -- 이 블록은 어떤 입력이 와도 예외를 밖으로 내보내지 않는다.
  -- 실패하면 위치 값을 전부 NULL 로 두고 타각만 진행한다.
  BEGIN
    IF p_lat IS NOT NULL AND p_lng IS NOT NULL
       AND p_lat BETWEEN -90 AND 90
       AND p_lng BETWEEN -180 AND 180 THEN
      v_lat := round(p_lat, 7);
      v_lng := round(p_lng, 7);

      IF p_accuracy IS NOT NULL AND p_accuracy >= 0 THEN
        v_accuracy := round(LEAST(p_accuracy, 999999.99), 2);
      END IF;

      v_site_lat := (v_site->'siteLocation'->>'lat')::double precision;
      v_site_lng := (v_site->'siteLocation'->>'lng')::double precision;
      v_radius   := (v_site->>'allowedRadius')::double precision;

      -- 관리자가 현장 설정 화면에서 기준점을 저장한 적이 없으면(siteLocationSet 이 true 가 아니면) "미설정".
      -- 좌표 값으로는 판단하지 않는다: 시드의 더미 좌표나 예전 가짜 지도를 눌러 생긴 좌표도 실제 현장이 아니다.
      -- 미설정이면 좌표만 남기고 거리·반경 판정은 하지 않는다(전원이 '현장 밖'으로 찍히는 것을 방지).
      IF COALESCE(v_site->>'siteLocationSet', '') = 'true'
         AND v_site_lat IS NOT NULL AND v_site_lng IS NOT NULL
         AND v_site_lat BETWEEN -90 AND 90
         AND v_site_lng BETWEEN -180 AND 180 THEN
        -- haversine (지구 반지름 6,371,000m)
        v_dist_raw := 2 * 6371000 * asin(LEAST(1.0, sqrt(
            power(sin(radians(v_lat::double precision - v_site_lat) / 2), 2)
          + cos(radians(v_site_lat)) * cos(radians(v_lat::double precision))
            * power(sin(radians(v_lng::double precision - v_site_lng) / 2), 2)
        )));
        -- numeric(8,2) 상한(약 1,000km)을 넘지 않게 자른다.
        v_distance := round(LEAST(v_dist_raw, 999999.99)::numeric, 2);
        IF v_radius IS NOT NULL AND v_radius > 0 THEN
          v_within := v_dist_raw <= v_radius;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_lat := NULL; v_lng := NULL; v_accuracy := NULL;
    v_distance := NULL; v_within := NULL;
  END;

  SELECT id, check_in_at, check_out_at
    INTO v_existing_id, v_existing_check_in, v_existing_check_out
  FROM attendance
  WHERE worker_id = v_worker_id AND work_date = v_today;
  v_work_date := v_today;

  IF action = 'in' THEN
    IF v_existing_id IS NOT NULL AND v_existing_check_in IS NOT NULL THEN
      RAISE EXCEPTION '오늘 이미 출근 체크가 완료되었습니다.';
    END IF;

    IF v_existing_id IS NULL THEN
      INSERT INTO attendance (
        worker_id, work_date, check_in_at, status,
        check_in_lat, check_in_lng, check_in_accuracy_m,
        check_in_distance_m, check_in_within_geo
      )
      VALUES (
        v_worker_id, v_today, v_now, 'normal',
        v_lat, v_lng, v_accuracy,
        v_distance, v_within
      )
      RETURNING id INTO v_existing_id;
    ELSE
      UPDATE attendance
      SET check_in_at         = v_now,
          check_in_lat        = v_lat,
          check_in_lng        = v_lng,
          check_in_accuracy_m = v_accuracy,
          check_in_distance_m = v_distance,
          check_in_within_geo = v_within
      WHERE id = v_existing_id;
    END IF;

    RETURN jsonb_build_object(
      'action', 'in',
      'attendance_id', v_existing_id,
      'work_date', v_today,
      'timestamp', v_now,
      'distance_m', v_distance,
      'within_geo', v_within
    );

  ELSIF action = 'out' THEN
    -- 야간조: 오늘 출근 기록이 없으면, 전날 출근하고 아직 퇴근하지 않은 기록에 퇴근을 찍는다.
    -- 출근 후 18시간이 지난 기록은 "퇴근을 깜빡한 지난 근무"로 보고 잇지 않는다
    -- (프런트 SupabaseContext 의 OPEN_SHIFT_MAX_HOURS 와 같은 값이어야 한다).
    IF v_existing_id IS NULL OR v_existing_check_in IS NULL THEN
      SELECT id, check_in_at, check_out_at, work_date
        INTO v_existing_id, v_existing_check_in, v_existing_check_out, v_work_date
      FROM attendance
      WHERE worker_id = v_worker_id
        AND work_date = v_today - 1
        AND check_in_at IS NOT NULL
        AND check_out_at IS NULL
        AND check_in_at > v_now - interval '18 hours';

      IF NOT FOUND THEN
        RAISE EXCEPTION '출근 체크가 먼저 필요합니다.';
      END IF;
    END IF;
    IF v_existing_check_out IS NOT NULL THEN
      RAISE EXCEPTION '오늘 이미 퇴근 체크가 완료되었습니다.';
    END IF;

    UPDATE attendance
    SET check_out_at         = v_now,
        check_out_lat        = v_lat,
        check_out_lng        = v_lng,
        check_out_accuracy_m = v_accuracy,
        check_out_distance_m = v_distance,
        check_out_within_geo = v_within
    WHERE id = v_existing_id;

    RETURN jsonb_build_object(
      'action', 'out',
      'attendance_id', v_existing_id,
      'work_date', v_work_date,
      'timestamp', v_now,
      'distance_m', v_distance,
      'within_geo', v_within
    );

  ELSE
    RAISE EXCEPTION '알 수 없는 액션: %', action;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_attendance(text, text, numeric, numeric, numeric) TO authenticated;

-- PostgREST 가 새 시그니처를 바로 인식하도록 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
