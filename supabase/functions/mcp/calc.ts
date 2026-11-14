// 근태 계산 순수 함수 — 프런트엔드 코드의 "복사본"이다.
//
// 원본:
//   - src/utils/attendanceHours.ts  (타각 보정, 근로시간 분해, 급여정산 테이블 공수)
//   - src/utils/datetime.ts         (타임존 벽시계 변환)
//   - src/data/defaults.ts          (DEFAULT_MAN_DAY_TABLE, DEFAULT_NIGHT_SHIFT_START_TIME)
//   - src/types.ts                  (아래 타입 중 계산에 필요한 것만)
//
// 복사한 이유: 원본은 확장자 없는 import("./datetime")를 쓰는 Vite 코드라 Edge Function(Deno) 번들이
// 그대로 가져올 수 없다. 그래서 필요한 함수만 "글자 그대로" 옮겼다.
//
// ★ 원본을 고치면 이 파일도 같이 고칠 것. 반대도 마찬가지.
//   두 쪽 결과가 같은지는 calc.test.ts 가 확인한다:
//     deno test --no-check --sloppy-imports --allow-read --allow-env supabase/functions/mcp/calc.test.ts

// ── 타입 (src/types.ts 에서 계산에 쓰는 부분만) ─────────────────────────────
export type SnapDayType = "weekday" | "saturday" | "sunday" | "holiday";
export type SnapKind = "in" | "out";

export interface AttendanceSnapRule {
  id: string;
  dayType: SnapDayType;
  kind: SnapKind;
  fromTime: string;
  toTime: string;
  snapTo: string;
}

export type ManDayShift = "day" | "night";
export type ManDayDayType = "weekday" | "saturday" | "sunday";

export interface ManDayRow {
  id: string;
  shift: ManDayShift;
  dayType: ManDayDayType;
  fromTime: string;
  toTime: string;
  manDays: number;
  countable: boolean;
  label?: string;
  outBefore?: string;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  type: "public" | "custom";
}

export interface WorkTimeSettings {
  defaultCheckIn: string;
  defaultCheckOut: string;
  lunchStart: string;
  lunchEnd: string;
  standardDailyHours: number;
}

export interface Worker {
  employmentType: "salary" | "hourly" | "daily" | "business";
}

/** 계산에 필요한 설정만 추린 형태 (원본 AllSettings 의 부분집합) */
export interface AllSettings {
  workTime: WorkTimeSettings;
  overtimeRules: {
    nightStart: string;
    nightEnd: string;
    snapRules?: AttendanceSnapRule[];
  };
  dailyWorkerRules: {
    manDayTable?: ManDayRow[];
    nightShiftStartTime?: string;
    earlyMorningStart: string;
    earlyMorningEnd: string;
  };
  site?: { timezone?: string };
}

// ── src/data/defaults.ts ────────────────────────────────────────────────────
export const DEFAULT_NIGHT_SHIFT_START_TIME = "15:00";

/**
 * 일용/사업소득 "급여정산 테이블" 기본값 — 엑셀 노무대장의 표를 그대로 옮긴 것.
 * - countable: false 행은 안내용(반일 두 개의 합계 표시, 점심·식사시간)이라 합산하지 않는다.
 * - toTime "00:00"은 밤 12시(자정, 엑셀의 24:00)를 뜻한다.
 * - 행 라벨(조출/오전/잔업 등)은 화면 표시용으로 붙인 이름이며 계산에는 쓰이지 않는다.
 */
export const DEFAULT_MAN_DAY_TABLE: ManDayRow[] = [
  // ── 주간조 · 평일 ──
  { id: "md-d-wd-1", shift: "day", dayType: "weekday", fromTime: "05:00", toTime: "08:00", manDays: 0.5, countable: true, label: "조출" },
  { id: "md-d-wd-2", shift: "day", dayType: "weekday", fromTime: "08:00", toTime: "12:00", manDays: 0.5, countable: true, label: "오전" },
  { id: "md-d-wd-3", shift: "day", dayType: "weekday", fromTime: "12:00", toTime: "13:00", manDays: 0, countable: false, label: "점심시간" },
  { id: "md-d-wd-4", shift: "day", dayType: "weekday", fromTime: "13:00", toTime: "17:00", manDays: 0.5, countable: true, label: "오후" },
  { id: "md-d-wd-5", shift: "day", dayType: "weekday", fromTime: "08:00", toTime: "17:00", manDays: 1, countable: false, label: "하루 합계(안내용)" },
  { id: "md-d-wd-6", shift: "day", dayType: "weekday", fromTime: "17:00", toTime: "19:30", manDays: 0.5, countable: true, label: "잔업 1" },
  { id: "md-d-wd-7", shift: "day", dayType: "weekday", fromTime: "19:30", toTime: "22:00", manDays: 0.5, countable: true, label: "잔업 2" },
  { id: "md-d-wd-8", shift: "day", dayType: "weekday", fromTime: "22:00", toTime: "00:00", manDays: 0.5, countable: true, label: "잔업 3" },
  { id: "md-d-wd-9", shift: "day", dayType: "weekday", fromTime: "13:00", toTime: "15:00", manDays: 0.25, countable: true, label: "오후 조기퇴근", outBefore: "17:00" },
  // ── 주간조 · 토요일 ──
  { id: "md-d-sat-1", shift: "day", dayType: "saturday", fromTime: "05:00", toTime: "08:00", manDays: 0.5, countable: true, label: "조출" },
  { id: "md-d-sat-2", shift: "day", dayType: "saturday", fromTime: "08:00", toTime: "16:00", manDays: 1, countable: false, label: "하루 합계(안내용)" },
  { id: "md-d-sat-3", shift: "day", dayType: "saturday", fromTime: "08:00", toTime: "12:00", manDays: 0.5, countable: true, label: "오전" },
  { id: "md-d-sat-4", shift: "day", dayType: "saturday", fromTime: "12:00", toTime: "13:00", manDays: 0, countable: false, label: "점심시간" },
  { id: "md-d-sat-5", shift: "day", dayType: "saturday", fromTime: "13:00", toTime: "16:00", manDays: 0.5, countable: true, label: "오후" },
  { id: "md-d-sat-6", shift: "day", dayType: "saturday", fromTime: "16:00", toTime: "18:00", manDays: 0.5, countable: true, label: "잔업" },
  // ── 주간조 · 일요일(평일 공휴일 포함) ──
  { id: "md-d-sun-1", shift: "day", dayType: "sunday", fromTime: "05:00", toTime: "08:00", manDays: 0.5, countable: true, label: "조출" },
  { id: "md-d-sun-2", shift: "day", dayType: "sunday", fromTime: "08:00", toTime: "12:00", manDays: 0.5, countable: true, label: "오전" },
  { id: "md-d-sun-3", shift: "day", dayType: "sunday", fromTime: "08:00", toTime: "15:30", manDays: 1, countable: false, label: "하루 합계(안내용)" },
  { id: "md-d-sun-4", shift: "day", dayType: "sunday", fromTime: "12:00", toTime: "13:00", manDays: 0, countable: false, label: "점심시간" },
  { id: "md-d-sun-5", shift: "day", dayType: "sunday", fromTime: "13:00", toTime: "15:30", manDays: 0.5, countable: true, label: "오후" },
  { id: "md-d-sun-6", shift: "day", dayType: "sunday", fromTime: "15:30", toTime: "17:30", manDays: 0.5, countable: true, label: "잔업" },
  // ── 야간조 · 평일 ──
  { id: "md-n-wd-1", shift: "night", dayType: "weekday", fromTime: "19:30", toTime: "23:30", manDays: 0.75, countable: true, label: "전반" },
  { id: "md-n-wd-2", shift: "night", dayType: "weekday", fromTime: "23:30", toTime: "00:30", manDays: 0, countable: false, label: "식사시간" },
  { id: "md-n-wd-3", shift: "night", dayType: "weekday", fromTime: "00:30", toTime: "04:30", manDays: 0.75, countable: true, label: "후반" },
  { id: "md-n-wd-4", shift: "night", dayType: "weekday", fromTime: "04:30", toTime: "05:30", manDays: 0.5, countable: true, label: "새벽 잔업" },
  // ── 야간조 · 토요일 ──
  { id: "md-n-sat-1", shift: "night", dayType: "saturday", fromTime: "16:00", toTime: "20:00", manDays: 1, countable: true, label: "전반" },
  { id: "md-n-sat-2", shift: "night", dayType: "saturday", fromTime: "20:00", toTime: "21:00", manDays: 0, countable: false, label: "식사시간" },
  { id: "md-n-sat-3", shift: "night", dayType: "saturday", fromTime: "21:00", toTime: "01:00", manDays: 1, countable: true, label: "후반" },
  // ── 야간조 · 일요일(평일 공휴일 포함) ──
  { id: "md-n-sun-1", shift: "night", dayType: "sunday", fromTime: "15:30", toTime: "19:30", manDays: 1, countable: true, label: "전반" },
  { id: "md-n-sun-2", shift: "night", dayType: "sunday", fromTime: "19:30", toTime: "20:30", manDays: 0, countable: false, label: "식사시간" },
  { id: "md-n-sun-3", shift: "night", dayType: "sunday", fromTime: "20:30", toTime: "00:00", manDays: 1, countable: true, label: "후반" },
];

// ── src/utils/datetime.ts ───────────────────────────────────────────────────
export const DEFAULT_TIME_ZONE = "Asia/Seoul";

const WEEKDAY_LABELS_KO = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * "YYYY-MM-DD" 근무일자의 요일을 한 글자(일~토)로 돌려준다.
 * 날짜만 있는 문자열은 타임존과 무관한 "달력상의 날짜"이므로 로컬 자정으로 해석해도 요일이 바뀌지 않는다.
 */
export function getWeekdayLabel(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return WEEKDAY_LABELS_KO[date.getDay()];
}

/** 설정에서 적용할 타임존을 읽는다. 미설정 시 Asia/Seoul. */
export function getAppTimeZone(settings?: AllSettings | null): string {
  const tz = settings?.site?.timezone;
  return tz && tz.length > 0 ? tz : DEFAULT_TIME_ZONE;
}

/** 주어진 절대시각(Date)을 해당 타임존의 "자정 기준 분(分)"으로 환산한다. (0~1439) */
export function getZonedClockMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** ISO 시각 문자열을 해당 타임존 기준 "HH:MM" 으로 표시한다. */
export function formatZonedTime(iso: string | null, timeZone: string, fallback = "--:--"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// ── src/utils/attendanceHours.ts ────────────────────────────────────────────
export function hhmmToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function overlapMinutes(start: number, end: number, windowStart: number, windowEnd: number): number {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
}

function overlapWorkMinutes(
  start: number,
  end: number,
  windowStart: number,
  windowEnd: number,
  breakStart?: number,
  breakEnd?: number
): number {
  const baseMinutes = overlapMinutes(start, end, windowStart, windowEnd);
  if (breakStart === undefined || breakEnd === undefined || baseMinutes <= 0) return baseMinutes;

  let breakMinutes = overlapMinutes(start, end, Math.max(windowStart, breakStart), Math.min(windowEnd, breakEnd));
  if (end > 1440) {
    breakMinutes += overlapMinutes(
      start,
      end,
      Math.max(windowStart, breakStart + 1440),
      Math.min(windowEnd, breakEnd + 1440)
    );
  }
  return Math.max(0, baseMinutes - breakMinutes);
}

/**
 * 근무일의 요일 유형을 4분류로 판정한다.
 * 공휴일 등록일이면 'holiday'가 일/토요일보다 우선한다.
 */
export function getDayType(workDate: string, holidays: Holiday[]): SnapDayType {
  if (holidays.some((h) => h.date === workDate)) return "holiday";
  const parsed = new Date(`${workDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "weekday";
  const day = parsed.getDay();
  if (day === 0) return "sunday";
  if (day === 6) return "saturday";
  return "weekday";
}

/**
 * 타각 시각(설정 타임존 벽시계 분)을 보정 규칙에 따라 인정 시각으로 스냅한다.
 * dayType/kind가 일치하고 raw 시각이 [fromTime, toTime] 구간에 드는 첫 규칙의 snapTo로 보정.
 * 매칭되는 규칙이 없으면 raw 그대로 반환(구간 밖은 보정하지 않음).
 */
export function snapClockMinutes(
  rawMinutes: number,
  dayType: SnapDayType,
  kind: SnapKind,
  snapRules?: AttendanceSnapRule[]
): number {
  if (!snapRules || snapRules.length === 0) return rawMinutes;
  // raw는 0~1439로 정규화해서 비교 (자정 넘김 +1440이 들어와도 안전)
  const raw = ((rawMinutes % 1440) + 1440) % 1440;
  for (const rule of snapRules) {
    if (rule.dayType !== dayType || rule.kind !== kind) continue;
    const from = hhmmToMinutes(rule.fromTime);
    const to = hhmmToMinutes(rule.toTime);
    const inRange = from <= to ? raw >= from && raw <= to : raw >= from || raw <= to; // from>to: 자정 넘김 구간
    if (inRange) return hhmmToMinutes(rule.snapTo);
  }
  return rawMinutes;
}

export function calculateWorkedHours(
  checkInISO: string | null,
  checkOutISO: string | null,
  workTime?: WorkTimeSettings,
  timeZone: string = DEFAULT_TIME_ZONE
): number {
  if (!checkInISO || !checkOutISO) return 0;

  const checkIn = new Date(checkInISO);
  const checkOut = new Date(checkOutISO);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) return 0;

  // 설정 타임존 기준 벽시계 분(分)으로 환산 (기기 로컬 타임존 무관)
  const startMinutes = getZonedClockMinutes(checkIn, timeZone);
  let endMinutes = getZonedClockMinutes(checkOut, timeZone);
  if (endMinutes <= startMinutes) endMinutes += 1440;

  let breakMinutes = 0;
  if (workTime?.lunchStart && workTime?.lunchEnd) {
    const lunchStart = hhmmToMinutes(workTime.lunchStart);
    let lunchEnd = hhmmToMinutes(workTime.lunchEnd);
    if (lunchEnd <= lunchStart) lunchEnd += 1440;

    breakMinutes += overlapMinutes(startMinutes, endMinutes, lunchStart, lunchEnd);

    if (endMinutes > 1440) {
      breakMinutes += overlapMinutes(startMinutes, endMinutes, lunchStart + 1440, lunchEnd + 1440);
    }
  }

  return Math.max(0, (endMinutes - startMinutes - breakMinutes) / 60);
}

/**
 * 해당 근무일이 휴일인지 판정한다.
 * 기준: 일요일(getDay() === 0) 또는 holidays 컬렉션에 등록된 날짜.
 */
export function isHolidayDate(workDate: string, holidays: Holiday[]): boolean {
  const parsed = new Date(`${workDate}T00:00:00`);
  if (!Number.isNaN(parsed.getTime()) && parsed.getDay() === 0) return true;
  return holidays.some((h) => h.date === workDate);
}

// ============================================================
// 일용/사업소득 공수 — "급여정산 테이블" 방식
// ============================================================

function isValidHHMM(value: string | undefined): value is string {
  return !!value && /^\d{1,2}:\d{2}$/.test(value);
}

/**
 * 근무일을 정산 테이블의 요일 구분(평일/토요일/일요일 표)으로 바꾼다.
 *
 * 엑셀 수식 그대로: 일요일 또는 "평일에 걸린 공휴일" → 일요일 표, 토요일 → 토요일 표, 그 외 → 평일 표.
 * (엑셀 표의 제목은 "토요일/공휴일"이지만 실제 수식은 평일 공휴일을 일요일 표로 보낸다. 수식을 따른다.)
 * 토요일과 겹친 공휴일은 토요일 표, 일요일과 겹친 공휴일은 일요일 표.
 * workDate가 없어 실제 요일을 모르는 공휴일은 일요일 표로 본다.
 */
export function resolveManDayDayType(dayType: SnapDayType, workDate?: string): ManDayDayType {
  if (dayType !== "holiday") return dayType;
  if (workDate) {
    const parsed = new Date(`${workDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime()) && parsed.getDay() === 6) return "saturday";
  }
  return "sunday";
}

export interface ManDayCalcInput {
  inMinutes: number; // 출근 벽시계 분 (타각 보정 후)
  outMinutes: number; // 퇴근 벽시계 분 (타각 보정 후). 자정 넘김 +1440 이 붙어 있어도 된다
  dayType: ManDayDayType;
  table?: ManDayRow[]; // 미지정 시 DEFAULT_MAN_DAY_TABLE
  nightShiftStartTime?: string; // 미지정 시 "15:00"
}

export interface ManDayCalcResult {
  manDays: number;
  shift: ManDayShift;
  appliedRows: ManDayRow[]; // 합산에 들어간 행
}

/**
 * 정산 테이블에서 하루 공수를 계산한다 (엑셀 "급여정산 테이블" 수식과 동일한 규칙).
 *
 * 1. 출근 시각 ≥ 야간조 기준(15:00)이면 야간조 표, 아니면 주간조 표.
 * 2. 해당 조·요일 표에서 "출근 ≤ 시작 AND 퇴근 ≥ 종료"인 행의 공수를 모두 더한다.
 *    구간을 끝까지 채우지 못한 행은 0. (겹친 시간만큼 비례 계산하지 않는다)
 * 3. countable=false(안내용 합계·식사시간) 행은 더하지 않는다.
 * 4. outBefore가 있는 행은 퇴근이 그 시각보다 빠를 때만 적용한다(오후 조기퇴근).
 * 5. 자정 넘김:
 *    - 주간조: 퇴근이 05:00 미만이면 +24시간. 종료가 시작보다 이르거나 같은 행(22:00~00:00)은 종료 +24시간.
 *    - 야간조: 12:00 미만인 시각(행의 시작·종료, 퇴근, 조건 시각)에 +24시간.
 */
export function calculateManDaysFromTable(input: ManDayCalcInput): ManDayCalcResult {
  const table = input.table ?? DEFAULT_MAN_DAY_TABLE;
  const nightStart = hhmmToMinutes(
    isValidHHMM(input.nightShiftStartTime) ? input.nightShiftStartTime : DEFAULT_NIGHT_SHIFT_START_TIME
  );
  const wrap = (m: number) => ((m % 1440) + 1440) % 1440;
  const inClock = wrap(input.inMinutes);
  const outClock = wrap(input.outMinutes);
  const shift: ManDayShift = inClock >= nightStart ? "night" : "day";

  const nightAdjust = (m: number) => (m < 720 ? m + 1440 : m);
  const outAt = shift === "day" ? (outClock < 300 ? outClock + 1440 : outClock) : nightAdjust(outClock);

  const appliedRows: ManDayRow[] = [];
  let total = 0;
  for (const row of table) {
    if (row.shift !== shift || row.dayType !== input.dayType) continue;
    if (!row.countable) continue;
    if (!isValidHHMM(row.fromTime) || !isValidHHMM(row.toTime)) continue;
    if (!Number.isFinite(row.manDays)) continue;

    let from = hhmmToMinutes(row.fromTime);
    let to = hhmmToMinutes(row.toTime);
    let outLimit = isValidHHMM(row.outBefore) ? hhmmToMinutes(row.outBefore) : undefined;
    if (shift === "day") {
      if (to <= from) to += 1440;
    } else {
      from = nightAdjust(from);
      to = nightAdjust(to);
      if (outLimit !== undefined) outLimit = nightAdjust(outLimit);
    }

    if (inClock > from || outAt < to) continue;
    if (outLimit !== undefined && outAt >= outLimit) continue;

    appliedRows.push(row);
    total += row.manDays;
  }

  return { manDays: Math.round(total * 10000) / 10000, shift, appliedRows };
}

export interface DailyBreakdown {
  workHours: number; // 총 근무(점심 제외)
  regularHours: number; // 소정근로 (평일, standardDailyHours 한도)
  overtimeHours: number; // 연장 (평일, 소정 초과분)
  holidayHours: number; // 휴일근로 (휴일, standardDailyHours 한도)
  holidayOvertimeHours: number; // 휴일연장 (휴일, 소정 초과분)
  nightHours: number; // 야간 (22~06시 겹침, 가산 개념이라 위 값과 중첩됨)
  manDays: number; // 공수 (일용/사업소득자용)
}

const EMPTY_BREAKDOWN: DailyBreakdown = {
  workHours: 0,
  regularHours: 0,
  overtimeHours: 0,
  holidayHours: 0,
  holidayOvertimeHours: 0,
  nightHours: 0,
  manDays: 0,
};

/**
 * 출퇴근 시각을 설정값 기준으로 일별 근로시간/공수로 분해한다.
 *
 * 주의: 정밀한 노동법 산정(주 단위 연장 합산, 통상임금 환산 등)이 아니라
 * 설정값(소정시간/야간시간대/공수규칙) 기반의 화면 표시용 근사 분해다.
 *
 * workDate("YYYY-MM-DD")는 일용/사업소득 정산 테이블의 요일 표 선택에 쓰인다
 * (공휴일이 실제로 무슨 요일인지 알아야 함). 생략하면 공휴일은 일요일 표로 계산한다.
 */
export function calculateDailyBreakdown(
  checkInISO: string | null,
  checkOutISO: string | null,
  dayType: SnapDayType,
  employmentType: Worker["employmentType"],
  settings: AllSettings,
  workDate?: string
): DailyBreakdown {
  if (!checkInISO || !checkOutISO) return { ...EMPTY_BREAKDOWN };

  const checkIn = new Date(checkInISO);
  const checkOut = new Date(checkOutISO);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return { ...EMPTY_BREAKDOWN };
  }

  const { workTime, overtimeRules, dailyWorkerRules } = settings;
  const timeZone = getAppTimeZone(settings);
  const isHoliday = dayType !== "weekday";

  // 설정 타임존 기준 벽시계 분(分)으로 환산 후, 타각 보정 규칙으로 인정 시각 스냅
  const startMinutes = snapClockMinutes(
    getZonedClockMinutes(checkIn, timeZone),
    dayType,
    "in",
    overtimeRules.snapRules
  );
  let endMinutes = snapClockMinutes(
    getZonedClockMinutes(checkOut, timeZone),
    dayType,
    "out",
    overtimeRules.snapRules
  );
  // 자정 넘김 보정은 스냅 적용 후에 수행
  if (endMinutes <= startMinutes) endMinutes += 1440;

  // 점심시간 차감
  let breakMinutes = 0;
  let lunchStart: number | undefined;
  let lunchEnd: number | undefined;
  if (workTime.lunchStart && workTime.lunchEnd) {
    lunchStart = hhmmToMinutes(workTime.lunchStart);
    lunchEnd = hhmmToMinutes(workTime.lunchEnd);
    if (lunchEnd <= lunchStart) lunchEnd += 1440;
    breakMinutes += overlapMinutes(startMinutes, endMinutes, lunchStart, lunchEnd);
    if (endMinutes > 1440) {
      breakMinutes += overlapMinutes(startMinutes, endMinutes, lunchStart + 1440, lunchEnd + 1440);
    }
  }

  const netHours = Math.max(0, (endMinutes - startMinutes - breakMinutes) / 60);

  // 야간 시간대(예: 22:00~06:00) 겹침 — 가산 개념이라 별도 집계
  const nightStart = hhmmToMinutes(overtimeRules.nightStart);
  let nightEnd = hhmmToMinutes(overtimeRules.nightEnd);
  if (nightEnd <= nightStart) nightEnd += 1440;
  let nightMinutes = overlapMinutes(startMinutes, endMinutes, nightStart, nightEnd);
  // 전날 야간대(00:00 이전부터 이어지는 06:00까지)와 익일 야간대 모두 검사
  nightMinutes += overlapMinutes(startMinutes, endMinutes, nightStart - 1440, nightEnd - 1440);
  nightMinutes += overlapMinutes(startMinutes, endMinutes, nightStart + 1440, nightEnd + 1440);
  const nightHours = Math.max(0, nightMinutes / 60);

  // ── 일용/사업소득자: 공수(man-day)는 "급여정산 테이블"에서 찾는다 ──
  // 예전의 조출/오후연장/저녁연장 고정 가산 + 휴일 배율(holidayRate) 수식은 쓰지 않는다.
  // (그 설정값들은 아래 시급제 연장 판정과 급여 시뮬레이터에서만 계속 사용)
  if (employmentType === "daily" || employmentType === "business") {
    const { manDays } = calculateManDaysFromTable({
      inMinutes: startMinutes,
      outMinutes: endMinutes,
      dayType: resolveManDayDayType(dayType, workDate),
      table: dailyWorkerRules.manDayTable,
      nightShiftStartTime: dailyWorkerRules.nightShiftStartTime,
    });

    return {
      ...EMPTY_BREAKDOWN,
      workHours: netHours,
      nightHours,
      manDays,
    };
  }

  // ── 월급/시급: 시간 분해 ──
  const standardHours = workTime.standardDailyHours || 8;
  if (isHoliday) {
    return {
      ...EMPTY_BREAKDOWN,
      workHours: netHours,
      holidayHours: Math.min(netHours, standardHours),
      holidayOvertimeHours: Math.max(0, netHours - standardHours),
      nightHours,
    };
  }

  const regularStart = hhmmToMinutes(workTime.defaultCheckIn);
  let regularEnd = hhmmToMinutes(workTime.defaultCheckOut);
  if (regularEnd <= regularStart) regularEnd += 1440;

  const earlyStart = hhmmToMinutes(dailyWorkerRules.earlyMorningStart);
  let earlyEnd = hhmmToMinutes(dailyWorkerRules.earlyMorningEnd);
  if (earlyEnd <= earlyStart) earlyEnd += 1440;

  const regularHours = Math.min(
    standardHours,
    overlapWorkMinutes(startMinutes, endMinutes, regularStart, regularEnd, lunchStart, lunchEnd) / 60
  );
  const earlyOvertimeHours =
    overlapWorkMinutes(startMinutes, endMinutes, earlyStart, earlyEnd, lunchStart, lunchEnd) / 60;
  const afterRegularOvertimeHours =
    overlapWorkMinutes(startMinutes, endMinutes, regularEnd, endMinutes, lunchStart, lunchEnd) / 60;

  return {
    ...EMPTY_BREAKDOWN,
    workHours: netHours,
    regularHours,
    overtimeHours: earlyOvertimeHours + afterRegularOvertimeHours,
    nightHours,
  };
}
