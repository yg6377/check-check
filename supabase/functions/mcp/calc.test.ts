// calc.ts(복사본)가 프런트엔드 원본과 같은 결과를 내는지 확인한다.
// 실행 (저장소 루트에서):
//   deno test --no-check --sloppy-imports --allow-read --allow-env supabase/functions/mcp/calc.test.ts
// 배포되는 함수(index.ts)는 이 파일을 import 하지 않는다.
import * as copy from "./calc.ts";
import * as orig from "../../../src/utils/attendanceHours.ts";
import { DEFAULT_SETTINGS, DEFAULT_MAN_DAY_TABLE } from "../../../src/data/defaults.ts";
import { formatZonedTime, getWeekdayLabel, getZonedClockMinutes } from "../../../src/utils/datetime.ts";

const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  복사본: ${JSON.stringify(a)}\n  원본  : ${JSON.stringify(b)}`);
};

// KST 벽시계 → ISO. 퇴근이 출근보다 이르면 다음 날로 본다.
const iso = (ymd: string, hhmm: string, plusDay = 0) =>
  new Date(new Date(`${ymd}T${hhmm}:00+09:00`).getTime() + plusDay * 86400000).toISOString();
const pair = (ymd: string, i: string, o: string) => [iso(ymd, i), iso(ymd, o, o <= i ? 1 : 0)] as const;

// 2026-11: 11(수) 평일, 14(토), 15(일). 공휴일은 평일(12 목)과 토요일(21)에 하나씩 둔다.
const HOLIDAYS = [
  { date: "2026-11-12", name: "시험 공휴일(평일)", type: "custom" as const },
  { date: "2026-11-21", name: "시험 공휴일(토)", type: "custom" as const },
];
const DATES = ["2026-11-11", "2026-11-12", "2026-11-14", "2026-11-15", "2026-11-21"];
const TYPES = ["salary", "hourly", "daily", "business"] as const;

Deno.test("기본 급여정산 테이블이 원본과 같다", () => {
  eq(copy.DEFAULT_MAN_DAY_TABLE, DEFAULT_MAN_DAY_TABLE, "DEFAULT_MAN_DAY_TABLE");
});

Deno.test("정답표: 사업소득자 공수", () => {
  const md = (ymd: string, i: string, o: string) => {
    const [a, b] = pair(ymd, i, o);
    return copy.calculateDailyBreakdown(a, b, copy.getDayType(ymd, HOLIDAYS), "business", DEFAULT_SETTINGS, ymd).manDays;
  };
  eq(md("2026-11-11", "08:00", "17:00"), 1, "평일 08-17");
  eq(md("2026-11-11", "08:00", "19:30"), 1.5, "평일 08-19:30");
  eq(md("2026-11-11", "08:00", "22:00"), 2, "평일 08-22");
  eq(md("2026-11-11", "08:00", "00:00"), 2.5, "평일 08-24");
  eq(md("2026-11-14", "08:00", "16:00"), 1, "토 08-16");
  eq(md("2026-11-15", "08:00", "15:30"), 1, "일 08-15:30");
  eq(md("2026-11-11", "19:30", "05:30"), 2, "평일 야간 19:30-05:30");
});

Deno.test("복사본 = 원본 (요일 5종 × 고용유형 4종 × 30분 간격 출퇴근)", () => {
  let n = 0;
  for (const ymd of DATES) {
    eq(copy.getDayType(ymd, HOLIDAYS), orig.getDayType(ymd, HOLIDAYS), `getDayType ${ymd}`);
    eq(copy.getWeekdayLabel(ymd), getWeekdayLabel(ymd), `getWeekdayLabel ${ymd}`);
    const dayType = orig.getDayType(ymd, HOLIDAYS);
    for (let im = 0; im < 1440; im += 30) {
      const i = `${String(Math.floor(im / 60)).padStart(2, "0")}:${String(im % 60).padStart(2, "0")}`;
      // 보정 규칙 경계를 밟도록 퇴근은 17분씩 어긋나게 잡는다
      for (let om = 7; om < 1440; om += 47) {
        const o = `${String(Math.floor(om / 60)).padStart(2, "0")}:${String(om % 60).padStart(2, "0")}`;
        const [a, b] = pair(ymd, i, o);
        eq(copy.getZonedClockMinutes(new Date(b), "Asia/Seoul"), getZonedClockMinutes(new Date(b), "Asia/Seoul"), "getZonedClockMinutes");
        eq(copy.formatZonedTime(b, "Asia/Seoul"), formatZonedTime(b, "Asia/Seoul"), "formatZonedTime");
        for (const kind of ["in", "out"] as const) {
          eq(
            copy.snapClockMinutes(om, dayType, kind, DEFAULT_SETTINGS.overtimeRules.snapRules),
            orig.snapClockMinutes(om, dayType, kind, DEFAULT_SETTINGS.overtimeRules.snapRules),
            `snap ${ymd} ${kind} ${o}`,
          );
        }
        for (const t of TYPES) {
          eq(
            copy.calculateDailyBreakdown(a, b, dayType, t, DEFAULT_SETTINGS, ymd),
            orig.calculateDailyBreakdown(a, b, dayType, t, DEFAULT_SETTINGS, ymd),
            `${ymd} ${t} ${i}~${o}`,
          );
          n++;
        }
      }
    }
  }
  console.log(`  비교한 조합 ${n}건`);
});

Deno.test("manDayTable 미설정이면 기본 표를 쓴다 (복사본 = 원본)", () => {
  const s = { ...DEFAULT_SETTINGS, dailyWorkerRules: { ...DEFAULT_SETTINGS.dailyWorkerRules, manDayTable: undefined, nightShiftStartTime: undefined } };
  const [a, b] = pair("2026-11-11", "08:00", "22:00");
  eq(
    copy.calculateDailyBreakdown(a, b, "weekday", "daily", s, "2026-11-11"),
    orig.calculateDailyBreakdown(a, b, "weekday", "daily", s, "2026-11-11"),
    "기본 표",
  );
  eq(copy.calculateDailyBreakdown(a, b, "weekday", "daily", s, "2026-11-11").manDays, 2, "기본 표 08-22");
});
