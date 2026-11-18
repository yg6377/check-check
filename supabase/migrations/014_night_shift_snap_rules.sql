-- 014: 야간조 타각 보정 규칙 추가 (데이터 마이그레이션, 재실행 안전)
--
-- 문제: 타각 보정 규칙이 주간조 시각만 다뤄서, 야간조가 19:30 을 1분이라도 넘겨 출근하면
--       급여정산 테이블의 "전반 19:30~23:30 = 0.75" 행을 채우지 못해 2공수가 1.25공수로 계산됐다.
-- 해결: 야간조 출근·퇴근 보정 규칙을 settings.overtimeRules.snapRules 에 덧붙인다.
--       같은 id 가 이미 있으면 건너뛴다. 관리자가 화면에서 고친 기존 규칙은 건드리지 않는다.
--       이미 확정된 근태(attendance_segments)는 바뀌지 않고 미확정 행만 새 규칙으로 계산된다.
--       함께: 주간조 자정 전후 퇴근 → 24:00 규칙(snap-wd-out-4). 기본값에는 있었지만 운영 설정에는
--       빠져 있어 08:00~23:59 가 2.5 가 아니라 2.0 으로 계산됐다.
-- 기본값 원본: src/data/defaults.ts 의 DEFAULT_SETTINGS.overtimeRules.snapRules

WITH new_rules AS (
  SELECT r
  FROM jsonb_array_elements('[
    {"id":"snap-wd-out-4","dayType":"weekday","kind":"out","fromTime":"23:30","toTime":"00:30","snapTo":"00:00"},
    {"id":"snap-wd-in-n1","dayType":"weekday","kind":"in","fromTime":"18:30","toTime":"20:00","snapTo":"19:30"},
    {"id":"snap-wd-out-n1","dayType":"weekday","kind":"out","fromTime":"04:00","toTime":"04:59","snapTo":"04:30"},
    {"id":"snap-wd-out-n2","dayType":"weekday","kind":"out","fromTime":"05:00","toTime":"06:30","snapTo":"05:30"},
    {"id":"snap-sat-in-n1","dayType":"saturday","kind":"in","fromTime":"15:00","toTime":"16:30","snapTo":"16:00"},
    {"id":"snap-sat-out-n1","dayType":"saturday","kind":"out","fromTime":"00:30","toTime":"01:59","snapTo":"01:00"},
    {"id":"snap-sun-in-n1","dayType":"sunday","kind":"in","fromTime":"14:30","toTime":"16:00","snapTo":"15:30"},
    {"id":"snap-sun-out-n1","dayType":"sunday","kind":"out","fromTime":"23:30","toTime":"00:59","snapTo":"00:00"}
  ]'::jsonb) AS r
),
missing AS (
  SELECT coalesce(jsonb_agg(n.r), '[]'::jsonb) AS rules
  FROM new_rules n
  WHERE NOT EXISTS (
    SELECT 1
    FROM settings s, jsonb_array_elements(coalesce(s.data->'snapRules', '[]'::jsonb)) e
    WHERE s.category = 'overtimeRules' AND e->>'id' = n.r->>'id'
  )
)
UPDATE settings s
SET data = jsonb_set(s.data, '{snapRules}', coalesce(s.data->'snapRules', '[]'::jsonb) || m.rules)
FROM missing m
WHERE s.category = 'overtimeRules' AND jsonb_array_length(m.rules) > 0;
