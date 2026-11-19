-- 015: 평일 야간조 06시대 퇴근을 06:00 으로 인정 (데이터 마이그레이션, 재실행 안전)
--
-- 014 에서 넣은 snap-wd-out-n2(05:00~06:30 → 05:30)는 06:02 퇴근도 05:30 으로 잘라
-- 시급제 야간 근무가 엑셀 노무대장(06:00 인정)보다 30분 적게 잡혔다.
--   - snap-wd-out-n2 의 끝을 06:30 → 05:59 로 줄인다 (014 원래 값 그대로일 때만. 관리자가 고쳤으면 두지 않는다)
--   - snap-wd-out-n3(06:00~06:30 → 06:00)를 덧붙인다 (같은 id 가 있으면 건너뜀)
-- 일용/사업소득 공수는 영향 없음(새벽 잔업 행이 05:30 에 끝나므로 05:30 이든 06:00 이든 같다).
-- 이미 확정된 근태(attendance_segments)는 바뀌지 않는다.

UPDATE settings s
SET data = jsonb_set(
  s.data,
  '{snapRules}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN e->>'id' = 'snap-wd-out-n2' AND e->>'fromTime' = '05:00' AND e->>'toTime' = '06:30' AND e->>'snapTo' = '05:30'
          THEN jsonb_set(e, '{toTime}', '"05:59"')
        ELSE e
      END
      ORDER BY t.ord
    )
    FROM jsonb_array_elements(s.data->'snapRules') WITH ORDINALITY AS t(e, ord)
  )
)
WHERE s.category = 'overtimeRules'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(s.data->'snapRules') e
    WHERE e->>'id' = 'snap-wd-out-n2' AND e->>'toTime' = '06:30'
  );

UPDATE settings s
SET data = jsonb_set(
  s.data,
  '{snapRules}',
  coalesce(s.data->'snapRules', '[]'::jsonb)
    || '[{"id":"snap-wd-out-n3","dayType":"weekday","kind":"out","fromTime":"06:00","toTime":"06:30","snapTo":"06:00"}]'::jsonb
)
WHERE s.category = 'overtimeRules'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(s.data->'snapRules', '[]'::jsonb)) e
    WHERE e->>'id' = 'snap-wd-out-n3'
  );
