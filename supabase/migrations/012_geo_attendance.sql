-- 012_geo_attendance
-- QR 타각 시 근로자 위치를 함께 받아 현장 기준점과의 거리·반경 내 여부를 "기록"한다.
--
-- 원칙
--   * 위치는 타각을 막지 않는다. 반경 밖이어도, 좌표가 없어도, 좌표가 이상해도 타각은 성공한다.
--   * 기존 검증 5종(근로자 로그인 / 퇴사 여부 / QR 코드 일치 / 당일 중복 / 퇴근 전 출근 선행)과
--     기존 반환 키(action, attendance_id, work_date, timestamp)는 009 정의 그대로 유지한다.
--   * 옛 클라이언트의 2인자 호출 submit_attendance(scanned_code, action) 도 계속 동작한다
--     (새 인자 3개에 기본값 NULL).
--
-- 재실행해도 안전하다.

-- ------------------------------------------------------------
-- 1) 위치 정확도 컬럼 (lat/lng/distance_m/within_geo 는 schema.sql 에 이미 있음)
-- ------------------------------------------------------------
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in_accuracy_m  numeric(8,2),
  ADD COLUMN IF NOT EXISTS check_out_accuracy_m numeric(8,2);

-- ------------------------------------------------------------
-- 2) submit_attendance 재작성
--    인자 목록이 달라지면 Postgres 는 별개 함수(오버로드)로 취급한다.
--    2인자 버전을 남겨 두면 2인자 호출이 모호해지므로 먼저 제거한다.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS submit_attendance(text, text);

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

      -- 기준점이 없거나 시드의 더미 좌표(37.1234, 126.4567) 그대로면 "미설정"으로 본다.
      -- 이때는 좌표만 남기고 거리·반경 판정은 하지 않는다(전원이 '현장 밖'으로 찍히는 것을 방지).
      IF v_site_lat IS NOT NULL AND v_site_lng IS NOT NULL
         AND v_site_lat BETWEEN -90 AND 90
         AND v_site_lng BETWEEN -180 AND 180
         AND NOT (v_site_lat = 37.1234 AND v_site_lng = 126.4567) THEN
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
    IF v_existing_id IS NULL OR v_existing_check_in IS NULL THEN
      RAISE EXCEPTION '출근 체크가 먼저 필요합니다.';
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
      'work_date', v_today,
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
