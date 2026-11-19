import type {
  AllSettings,
  AttendanceSnapRule,
  Holiday,
  ManDayDayType,
  ManDayRow,
  ManDayShift,
  SnapDayType,
  SnapKind,
  WorkTimeSettings,
  Worker,
} from "../types";
import { DEFAULT_TIME_ZONE, getAppTimeZone, getZonedClockMinutes } from "./datetime";
import { DEFAULT_MAN_DAY_TABLE, DEFAULT_NIGHT_SHIFT_START_TIME } from "../data/defaults";

function hhmmToMinutes(value: string): number {
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

/**
 * 야간조 식사시간 — 급여정산 테이블 야간조 표에서 "합산 안 함(countable=false) + 공수 0" 행.
 * (안내용 합계 행은 공수가 0이 아니라서 걸리지 않는다.)
 * 시각은 야간조 기준으로 12:00 미만이면 다음 날(+24시간)로 본다. 공수표 계산과 같은 규칙.
 */
function getNightMealBreaks(table: ManDayRow[] | undefined, dayType: ManDayDayType): Array<[number, number]> {
  const nightAdjust = (m: number) => (m < 720 ? m + 1440 : m);
  const breaks: Array<[number, number]> = [];
  for (const row of table ?? DEFAULT_MAN_DAY_TABLE) {
    if (row.shift !== "night" || row.dayType !== dayType || row.countable || row.manDays !== 0) continue;
    if (!isValidHHMM(row.fromTime) || !isValidHHMM(row.toTime)) continue;
    const from = nightAdjust(hhmmToMinutes(row.fromTime));
    let to = nightAdjust(hhmmToMinutes(row.toTime));
    if (to <= from) to += 1440;
    breaks.push([from, to]);
  }
  return breaks;
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

  // 야간조 판정 — 공수표와 같은 기준(인정 출근 시각 ≥ 야간조 기준 출근시간, 기본 15:00)
  const nightShiftStart = hhmmToMinutes(
    isValidHHMM(dailyWorkerRules.nightShiftStartTime)
      ? dailyWorkerRules.nightShiftStartTime
      : DEFAULT_NIGHT_SHIFT_START_TIME
  );
  const isNightShift = ((startMinutes % 1440) + 1440) % 1440 >= nightShiftStart;
  const manDayDayType = resolveManDayDayType(dayType, workDate);

  // 쉬는 시간 차감 — 주간조는 점심시간, 야간조는 급여정산 테이블 야간조 표의 식사시간
  let lunchStart: number | undefined;
  let lunchEnd: number | undefined;
  const breaks: Array<[number, number]> = [];
  if (isNightShift) {
    breaks.push(...getNightMealBreaks(dailyWorkerRules.manDayTable, manDayDayType));
  } else if (workTime.lunchStart && workTime.lunchEnd) {
    lunchStart = hhmmToMinutes(workTime.lunchStart);
    lunchEnd = hhmmToMinutes(workTime.lunchEnd);
    if (lunchEnd <= lunchStart) lunchEnd += 1440;
    breaks.push([lunchStart, lunchEnd]);
    if (endMinutes > 1440) breaks.push([lunchStart + 1440, lunchEnd + 1440]);
  }
  let breakMinutes = 0;
  for (const [bs, be] of breaks) breakMinutes += overlapMinutes(startMinutes, endMinutes, bs, be);

  const netHours = Math.max(0, (endMinutes - startMinutes - breakMinutes) / 60);

  // 야간 시간대(예: 22:00~06:00) 겹침 — 가산 개념이라 별도 집계. 그 안에 든 쉬는 시간은 뺀다
  const nightStart = hhmmToMinutes(overtimeRules.nightStart);
  let nightEnd = hhmmToMinutes(overtimeRules.nightEnd);
  if (nightEnd <= nightStart) nightEnd += 1440;
  let nightMinutes = 0;
  // 전날 야간대(00:00 이전부터 이어지는 06:00까지)·당일·익일 야간대 모두 검사
  for (const shiftBy of [-1440, 0, 1440]) {
    const ws = nightStart + shiftBy;
    const we = nightEnd + shiftBy;
    nightMinutes += overlapMinutes(startMinutes, endMinutes, ws, we);
    for (const [bs, be] of breaks) {
      nightMinutes -= overlapMinutes(startMinutes, endMinutes, Math.max(ws, bs), Math.min(we, be));
    }
  }
  const nightHours = Math.max(0, nightMinutes / 60);

  // ── 일용/사업소득자: 공수(man-day)는 "급여정산 테이블"에서 찾는다 ──
  // 예전의 조출/오후연장/저녁연장 고정 가산 + 휴일 배율(holidayRate) 수식은 쓰지 않는다.
  // (그 설정값들은 아래 시급제 연장 판정과 급여 시뮬레이터에서만 계속 사용)
  if (employmentType === "daily" || employmentType === "business") {
    const { manDays } = calculateManDaysFromTable({
      inMinutes: startMinutes,
      outMinutes: endMinutes,
      dayType: manDayDayType,
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

  // 평일 야간조: 하루 근무의 처음 8시간이 정규, 나머지가 연장 (엑셀 노무대장과 같음).
  // 주간조처럼 "08:00~17:00과 겹친 시간"으로 정규를 잡으면 밤 근무는 정규 0, 전부 연장이 된다.
  if (isNightShift) {
    return {
      ...EMPTY_BREAKDOWN,
      workHours: netHours,
      regularHours: Math.min(netHours, standardHours),
      overtimeHours: Math.max(0, netHours - standardHours),
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

// ============================================================
// 지각 판정
// ============================================================

/** 지각 판정의 기준이 되는 출근 시각("HH:mm"). 근무시간 설정의 기본 출근 시각을 쓴다. */
export function getLateBaseTime(settings: AllSettings | null | undefined): string {
  const base = settings?.workTime?.defaultCheckIn;
  return isValidHHMM(base) ? base : "08:00";
}

/**
 * 출근 타각이 기준 시각보다 몇 분 늦었는지 돌려준다. 지각이 아니면 0.
 *
 * - 기준: 기본 출근 시각(보통 08:00)을 "넘기면" 지각. 08:00:59 까지는 지각이 아니고 08:01 부터 1분 지각.
 * - 타각 보정(snapRules)과는 별개다. 08:20 출근은 공수 계산에서는 08:00 으로 인정되지만 지각 표시는 남는다.
 * - 야간조(출근이 nightShiftStartTime 이후, 기본 15:00)는 요일마다 시작 시각이 달라 판정하지 않는다.
 * - 저장하지 않고 출근 시각에서 그때그때 계산한다(관리자가 출근 시각을 고치면 표시도 따라 바뀐다).
 */
export function getLateMinutes(
  checkInISO: string | null | undefined,
  settings: AllSettings | null | undefined
): number {
  if (!checkInISO || !settings) return 0;
  const at = new Date(checkInISO);
  if (Number.isNaN(at.getTime())) return 0;

  const clock = getZonedClockMinutes(at, getAppTimeZone(settings));
  const nightStartRaw = settings.dailyWorkerRules?.nightShiftStartTime;
  const nightStart = hhmmToMinutes(isValidHHMM(nightStartRaw) ? nightStartRaw : DEFAULT_NIGHT_SHIFT_START_TIME);
  if (clock >= nightStart) return 0;

  return Math.max(0, clock - hhmmToMinutes(getLateBaseTime(settings)));
}

/** 지각 시간을 "12분" / "1시간 5분" 형태로 표기한다. */
export function formatLateDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}
