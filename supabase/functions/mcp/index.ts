// 읽기 전용 MCP 서버 — AI(Claude 등)가 근태·공수 데이터를 읽어 엑셀 노무대장을 채우게 한다.
//
// - 전송: MCP Streamable HTTP, 상태 없음(세션 ID 없음) + JSON 응답(SSE 없음). 요청마다 서버를 새로 만든다.
//   POST 만 받는다. GET/DELETE 는 405 (서버가 먼저 보내는 스트림과 세션이 없으므로).
// - 인증: Authorization: Bearer <토큰>. 토큰의 SHA-256(16진수 소문자)을 함수 시크릿 MCP_TOKEN_SHA256 과 비교한다.
//   시크릿이 없으면 모든 요청을 401 로 거부한다. 토큰 원문은 저장소·함수 어디에도 두지 않는다.
//   함수가 직접 검사하므로 verify_jwt = false 로 배포한다 (supabase/config.toml).
// - 조회만 한다. DB 는 함수 안에서 service role 로 읽고, 쓰기 도구는 없다.
// - 응답에 넣는 컬럼은 아래 select 문자열과 pick() 목록에 적힌 것이 전부다(화이트리스트).
//   주민번호·계좌·연락처·주소·좌표·QR 코드(checkinCode)·관리자 메모는 읽지도 않는다.
//   컬럼을 늘릴 때는 이 원칙을 지킬 것 — select('*') 금지.
// - 미확정 근태의 시간·공수 계산은 calc.ts(프런트 src/utils/attendanceHours.ts 의 복사본)를 쓴다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  type AllSettings,
  type Holiday,
  type SnapDayType,
  calculateDailyBreakdown,
  DEFAULT_MAN_DAY_TABLE,
  DEFAULT_NIGHT_SHIFT_START_TIME,
  DEFAULT_TIME_ZONE,
  formatZonedTime,
  getDayType,
  getWeekdayLabel,
  getZonedClockMinutes,
  resolveManDayDayType,
  snapClockMinutes,
} from './calc.ts';

const PAGE = 1000;
const MAX_ROWS = 50000;
const MAX_RANGE_DAYS = 93; // 한 번에 조회할 수 있는 기간(약 3개월)

// ── 공통 ────────────────────────────────────────────────────────────────────
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 길이가 같을 때 비교 시간이 내용에 따라 달라지지 않게 한다 */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const expected = (Deno.env.get('MCP_TOKEN_SHA256') ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    console.error('MCP_TOKEN_SHA256 시크릿이 없거나 SHA-256 16진수(64자)가 아닙니다. 모든 요청을 거부합니다.');
    return false;
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  if (!token) return false;
  return sameHex(await sha256Hex(token), expected);
}

/** 조회가 가끔 일시적으로 실패하므로 300ms 뒤 한 번 더 시도한다 */
async function withRetry<T extends { error: unknown }>(make: () => PromiseLike<T>): Promise<T> {
  let r = await make();
  if (r.error) {
    await new Promise((res) => setTimeout(res, 300));
    r = await make();
  }
  return r;
}

/** 1,000행 제한에 잘리지 않게 나눠 받는다 (make 는 순서가 고정된 쿼리여야 한다) */
// deno-lint-ignore no-explicit-any
async function fetchAll<T>(make: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await withRetry<any>(() => make().range(from, from + PAGE - 1));
    if (error) throw new Error(`DB 조회 실패: ${(error as { message?: string }).message || 'unknown'}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const num = (v: unknown) => Number(v) || 0;

function pick(src: unknown, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (src && typeof src === 'object') {
    for (const k of keys) {
      const v = (src as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

// ── 날짜 ────────────────────────────────────────────────────────────────────
function assertYmd(v: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} 은(는) YYYY-MM-DD 형식이어야 합니다: ${v}`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new Error(`${name} 이(가) 달력에 없는 날짜입니다: ${v}`);
  return v;
}

function assertRange(from: string, to: string) {
  assertYmd(from, 'from');
  assertYmd(to, 'to');
  if (from > to) throw new Error('from 이 to 보다 늦습니다.');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) throw new Error(`한 번에 최대 ${MAX_RANGE_DAYS}일(약 3개월)까지 조회할 수 있습니다. 기간을 나눠 호출하세요. (요청: ${days}일)`);
}

function monthRange(month: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`month 는 YYYY-MM 형식이어야 합니다: ${month}`);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const minutesToHHMM = (m: number) => {
  const w = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`;
};

// ── 라벨 ────────────────────────────────────────────────────────────────────
const EMPLOYMENT_LABEL: Record<string, string> = { salary: '월급제', hourly: '시급제', daily: '일용직', business: '사업소득자' };
const DAY_TYPE_LABEL: Record<SnapDayType, string> = { weekday: '평일', saturday: '토요일', sunday: '일요일', holiday: '공휴일' };
const MAN_DAY_TABLE_LABEL: Record<string, string> = { weekday: '평일 표', saturday: '토요일 표', sunday: '일요일 표' };
const STATUS_LABEL: Record<string, string> = {
  normal: '정상', late: '지각', early_leave: '조퇴', absent: '결근', annual_leave: '연차', half_day: '반차',
  outing: '외출', sick_leave: '병가', leave_of_absence: '휴직', holiday_work: '휴일근무',
};

// ── DB 조회 (컬럼 화이트리스트) ─────────────────────────────────────────────
const WORKER_COLUMNS = 'id, worker_id, name, employment_type, department, duty, job, join_date, retire_date, monthly_base, hourly_rate, daily_rate';
const ATTENDANCE_COLUMNS = 'id, worker_id, work_date, check_in_at, check_out_at, status, attendance_segments(segment_type, hours, man_days, created_at)';

type WorkerRow = {
  id: string; worker_id: string; name: string; employment_type: 'salary' | 'hourly' | 'daily' | 'business';
  department: string | null; duty: string | null; job: string | null; join_date: string | null; retire_date: string | null;
  monthly_base: number | string | null; hourly_rate: number | string | null; daily_rate: number | string | null;
};
type SegmentRow = { segment_type: string; hours: number | string | null; man_days: number | string | null; created_at: string | null };
type AttendanceRow = {
  id: string; worker_id: string; work_date: string; check_in_at: string | null; check_out_at: string | null;
  status: string; attendance_segments: SegmentRow[] | null;
};

const loadWorkers = (sb: SupabaseClient) =>
  fetchAll<WorkerRow>(() => sb.from('workers').select(WORKER_COLUMNS).order('worker_id', { ascending: true }));

async function loadHolidays(sb: SupabaseClient, from: string, to: string): Promise<Holiday[]> {
  return await fetchAll<Holiday>(() => sb.from('holidays').select('date, name, type').gte('date', from).lte('date', to).order('date'));
}

async function loadRawSettings(sb: SupabaseClient): Promise<Record<string, Record<string, unknown>>> {
  const { data, error } = await withRetry(() => sb.from('settings').select('category, data'));
  if (error) throw new Error(`DB 조회 실패: ${error.message}`);
  const map: Record<string, Record<string, unknown>> = {};
  for (const row of data ?? []) map[row.category] = row.data ?? {};
  return map;
}

/** 계산에 쓰는 설정. 앱(SupabaseContext.loadSettings)과 같이 DB 값을 기본값과 병합하지 않고 그대로 쓴다. */
function toCalcSettings(raw: Record<string, Record<string, unknown>>): AllSettings {
  for (const key of ['workTime', 'overtimeRules', 'dailyWorkerRules']) {
    if (!raw[key]) throw new Error(`settings 테이블에 '${key}' 설정이 없습니다. 앱 설정 화면에서 저장했는지 확인하세요.`);
  }
  return {
    workTime: raw.workTime,
    overtimeRules: raw.overtimeRules,
    dailyWorkerRules: raw.dailyWorkerRules,
    site: { timezone: typeof raw.site?.timezone === 'string' ? raw.site.timezone : undefined },
  } as unknown as AllSettings;
}

const timeZoneOf = (s: AllSettings) => (s.site?.timezone && s.site.timezone.length > 0 ? s.site.timezone : DEFAULT_TIME_ZONE);

// ── 확정 분해 (src/context/SupabaseContext.tsx 의 segmentsToBreakdown 과 같은 규칙) ──
// segment_type 을 추가하면 원본과 이 함수를 함께 고칠 것.
function segmentsToBreakdown(segments: SegmentRow[] | null | undefined) {
  if (!segments || segments.length === 0) return null;
  const v = { regularHours: 0, overtimeHours: 0, holidayHours: 0, holidayOvertimeHours: 0, nightHours: 0, manDays: 0 };
  for (const s of segments) {
    const hours = num(s.hours);
    const manDays = num(s.man_days);
    const type = s.segment_type;
    if (type === 'standard') { v.regularHours += hours; v.manDays += manDays; }
    else if (type === 'weekday_ot' || type === 'afternoon_ot' || type === 'evening_ot' || type === 'early_morning') { v.overtimeHours += hours; v.manDays += manDays; }
    else if (type === 'holiday') { v.holidayHours += hours; v.manDays += manDays; }
    else if (type === 'holiday_ot') { v.holidayOvertimeHours += hours; v.manDays += manDays; }
    else if (type === 'night') { v.nightHours += hours; }
  }
  return {
    regularHours: round2(v.regularHours), overtimeHours: round2(v.overtimeHours), holidayHours: round2(v.holidayHours),
    holidayOvertimeHours: round2(v.holidayOvertimeHours), nightHours: round2(v.nightHours), manDays: round2(v.manDays),
  };
}

// ── 하루치 계산 ─────────────────────────────────────────────────────────────
interface DayValues {
  workHours: number; regularHours: number; overtimeHours: number; nightHours: number;
  holidayHours: number; holidayOvertimeHours: number; manDays: number;
}

function computeDay(a: AttendanceRow, w: WorkerRow, settings: AllSettings, holidays: Holiday[]) {
  const tz = timeZoneOf(settings);
  const dayType = getDayType(a.work_date, holidays);
  const isManDay = w.employment_type === 'daily' || w.employment_type === 'business';
  const auto = calculateDailyBreakdown(a.check_in_at, a.check_out_at, dayType, w.employment_type, settings, a.work_date);
  const confirmed = segmentsToBreakdown(a.attendance_segments);

  let values: DayValues;
  if (confirmed) {
    // 앱(AttendanceTab)과 같이: 확정 행의 근무시간은 4개 분류의 합, 합이 0이면 타각 기준 근무시간
    const sum = confirmed.regularHours + confirmed.overtimeHours + confirmed.holidayHours + confirmed.holidayOvertimeHours;
    values = { ...confirmed, workHours: sum > 0 ? sum : auto.workHours };
  } else {
    values = { ...auto, manDays: isManDay ? auto.manDays : 0 };
  }

  // 인정 시각 = 타각 보정(snapRules)을 거친 시각. 계산에 실제로 쓰이는 값.
  const rules = settings.overtimeRules.snapRules;
  const inRec = a.check_in_at ? snapClockMinutes(getZonedClockMinutes(new Date(a.check_in_at), tz), dayType, 'in', rules) : null;
  const outRec = a.check_out_at ? snapClockMinutes(getZonedClockMinutes(new Date(a.check_out_at), tz), dayType, 'out', rules) : null;

  return {
    dayType, isManDay, confirmed: Boolean(confirmed), values,
    checkInRaw: a.check_in_at ? formatZonedTime(a.check_in_at, tz, '') : null,
    checkOutRaw: a.check_out_at ? formatZonedTime(a.check_out_at, tz, '') : null,
    checkInRecognized: inRec === null ? null : minutesToHHMM(inRec),
    checkOutRecognized: outRec === null ? null : minutesToHHMM(outRec),
    checkOutNextDay: inRec !== null && outRec !== null ? outRec <= inRec : false,
    confirmedAt: (a.attendance_segments ?? []).reduce<string | null>((m, s) => (s.created_at && (!m || s.created_at > m) ? s.created_at : m), null),
  };
}

async function loadAttendanceContext(sb: SupabaseClient, from: string, to: string, workerCode?: string) {
  const [workers, holidays, rawSettings] = await Promise.all([loadWorkers(sb), loadHolidays(sb, from, to), loadRawSettings(sb)]);
  const settings = toCalcSettings(rawSettings);
  let target: WorkerRow | undefined;
  if (workerCode) {
    target = workers.find((w) => w.worker_id === workerCode.trim());
    if (!target) throw new Error(`사번 '${workerCode}' 인 근로자가 없습니다. list_workers(include_retired=true)로 사번을 확인하세요.`);
  }
  const rows = await fetchAll<AttendanceRow>(() => {
    let q = sb.from('attendance').select(ATTENDANCE_COLUMNS).gte('work_date', from).lte('work_date', to);
    if (target) q = q.eq('worker_id', target.id);
    return q.order('work_date', { ascending: true }).order('id', { ascending: true });
  });
  return { workers, holidays, settings, rows, target };
}

// ── 도구 구현 ───────────────────────────────────────────────────────────────
async function listWorkers(sb: SupabaseClient, includeRetired: boolean) {
  const workers = await loadWorkers(sb);
  const list = workers.filter((w) => includeRetired || !w.retire_date);
  return {
    count: list.length,
    include_retired: includeRetired,
    workers: list.map((w) => ({
      worker_code: w.worker_id,
      name: w.name,
      employment_type: w.employment_type,
      employment_type_label: EMPLOYMENT_LABEL[w.employment_type] ?? w.employment_type,
      department: w.department || '',
      rank: w.duty || '',
      job: w.job || '',
      join_date: w.join_date,
      retire_date: w.retire_date,
      monthly_base: num(w.monthly_base),
      hourly_rate: num(w.hourly_rate),
      daily_rate: num(w.daily_rate),
    })),
  };
}

async function getAttendance(sb: SupabaseClient, from: string, to: string, workerCode?: string) {
  assertRange(from, to);
  const { workers, holidays, settings, rows } = await loadAttendanceContext(sb, from, to, workerCode);
  const byId = new Map(workers.map((w) => [w.id, w]));
  const holidayName = new Map(holidays.map((h) => [h.date, h.name]));

  const records = [];
  for (const a of rows) {
    const w = byId.get(a.worker_id);
    if (!w) continue;
    const d = computeDay(a, w, settings, holidays);
    records.push({
      work_date: a.work_date,
      weekday: getWeekdayLabel(a.work_date),
      day_type: d.dayType,
      day_type_label: DAY_TYPE_LABEL[d.dayType],
      holiday_name: holidayName.get(a.work_date) ?? null,
      worker_code: w.worker_id,
      worker_name: w.name,
      employment_type: w.employment_type,
      status: a.status,
      status_label: STATUS_LABEL[a.status] ?? a.status,
      check_in_raw: d.checkInRaw,
      check_out_raw: d.checkOutRaw,
      check_in_recognized: d.checkInRecognized,
      check_out_recognized: d.checkOutRecognized,
      check_out_next_day: d.checkOutNextDay,
      missing_check_out: Boolean(a.check_in_at) && !a.check_out_at,
      work_hours: round2(d.values.workHours),
      regular_hours: round2(d.values.regularHours),
      overtime_hours: round2(d.values.overtimeHours),
      night_hours: round2(d.values.nightHours),
      holiday_hours: round2(d.values.holidayHours),
      holiday_overtime_hours: round2(d.values.holidayOvertimeHours),
      man_days: round4(d.values.manDays),
      man_day_table: d.isManDay ? MAN_DAY_TABLE_LABEL[resolveManDayDayType(d.dayType, a.work_date)] : null,
      confirmed: d.confirmed,
      confirmed_at: d.confirmedAt,
    });
  }
  records.sort((x, y) => x.worker_code.localeCompare(y.worker_code) || x.work_date.localeCompare(y.work_date));
  return { from, to, timezone: timeZoneOf(settings), count: records.length, records };
}

async function getMonthlySummary(sb: SupabaseClient, month: string, workerCode?: string) {
  const { from, to } = monthRange(month);
  const { workers, holidays, settings, rows, target } = await loadAttendanceContext(sb, from, to, workerCode);
  const byId = new Map(workers.map((w) => [w.id, w]));

  const blank = () => ({
    attendance_days: 0, man_days: 0, work_hours: 0, regular_hours: 0, overtime_hours: 0, night_hours: 0,
    holiday_hours: 0, holiday_overtime_hours: 0, missing_check_out: 0, confirmed_days: 0, unconfirmed_days: 0,
    status_counts: {} as Record<string, number>,
  });
  const acc = new Map<string, ReturnType<typeof blank>>();
  // 그 달에 재직한 근로자는 기록이 없어도 0으로 넣는다 (노무대장에 빈 줄이 필요하므로)
  for (const w of target ? [target] : workers) {
    const employed = (!w.join_date || w.join_date <= to) && (!w.retire_date || w.retire_date >= from);
    if (employed || target) acc.set(w.id, blank());
  }

  for (const a of rows) {
    const w = byId.get(a.worker_id);
    if (!w) continue;
    const t = acc.get(w.id) ?? acc.set(w.id, blank()).get(w.id)!;
    const d = computeDay(a, w, settings, holidays);
    if (a.check_in_at) {
      t.attendance_days += 1;
      if (!a.check_out_at) t.missing_check_out += 1;
      else if (d.confirmed) t.confirmed_days += 1;
      else t.unconfirmed_days += 1;
    } else if (d.confirmed) t.confirmed_days += 1;
    t.man_days += d.values.manDays;
    t.work_hours += d.values.workHours;
    t.regular_hours += d.values.regularHours;
    t.overtime_hours += d.values.overtimeHours;
    t.night_hours += d.values.nightHours;
    t.holiday_hours += d.values.holidayHours;
    t.holiday_overtime_hours += d.values.holidayOvertimeHours;
    const label = STATUS_LABEL[a.status] ?? a.status;
    t.status_counts[label] = (t.status_counts[label] ?? 0) + 1;
  }

  const summary = workers.filter((w) => acc.has(w.id)).map((w) => {
    const t = acc.get(w.id)!;
    return {
      worker_code: w.worker_id,
      worker_name: w.name,
      employment_type: w.employment_type,
      employment_type_label: EMPLOYMENT_LABEL[w.employment_type] ?? w.employment_type,
      monthly_base: num(w.monthly_base),
      hourly_rate: num(w.hourly_rate),
      daily_rate: num(w.daily_rate),
      attendance_days: t.attendance_days,
      man_days: round4(t.man_days),
      work_hours: round2(t.work_hours),
      regular_hours: round2(t.regular_hours),
      overtime_hours: round2(t.overtime_hours),
      night_hours: round2(t.night_hours),
      holiday_hours: round2(t.holiday_hours),
      holiday_overtime_hours: round2(t.holiday_overtime_hours),
      missing_check_out: t.missing_check_out,
      confirmed_days: t.confirmed_days,
      unconfirmed_days: t.unconfirmed_days,
      status_counts: t.status_counts,
    };
  });
  return { month, from, to, timezone: timeZoneOf(settings), count: summary.length, summary };
}

async function getSettings(sb: SupabaseClient) {
  const raw = await loadRawSettings(sb);
  const daily = raw.dailyWorkerRules ?? {};
  const table = Array.isArray(daily.manDayTable) ? daily.manDayTable : null;
  return {
    site: pick(raw.site, ['companyName', 'timezone', 'paymentDay']), // 주소·좌표·반경·QR 코드는 내보내지 않는다
    work_time: pick(raw.workTime, [
      'defaultCheckIn', 'defaultCheckOut', 'lunchStart', 'lunchEnd', 'lunchDuration', 'standardDailyHours',
      'standardWeeklyHours', 'hourlyOrdinaryWageRate', 'hourlyOrdinaryMonthlyHours',
    ]),
    overtime_rules: pick(raw.overtimeRules, [
      'weekdayOvertimeRate', 'holidayRate', 'holidayOvertimeRate', 'nightRate', 'nightStart', 'nightEnd', 'snapRules',
    ]),
    man_day_rules: {
      night_shift_start_time: typeof daily.nightShiftStartTime === 'string' ? daily.nightShiftStartTime : DEFAULT_NIGHT_SHIFT_START_TIME,
      table_source: table ? 'settings' : 'default',
      table: (table ?? DEFAULT_MAN_DAY_TABLE).map((r) => pick(r, ['shift', 'dayType', 'fromTime', 'toTime', 'manDays', 'countable', 'label', 'outBefore'])),
    },
    insurance_rates: pick(raw.insuranceRates, ['nationalPensionRate', 'healthInsuranceRate', 'longTermCareRate', 'employmentInsuranceRate', 'effectiveFrom']),
    tax_rules: pick(raw.taxRules, ['businessIncomeRate', 'dailyWorkerTaxFreeLimit', 'dailyWorkerTaxRate', 'localTaxRate']),
    allowance_defaults: pick(raw.allowanceDefaults, ['meal', 'transport', 'phone']),
  };
}

async function getHolidays(sb: SupabaseClient, year: number) {
  const holidays = await loadHolidays(sb, `${year}-01-01`, `${year}-12-31`);
  return {
    year,
    count: holidays.length,
    holidays: holidays.map((h) => ({
      date: h.date, weekday: getWeekdayLabel(h.date), name: h.name, type: h.type,
      type_label: h.type === 'public' ? '법정 공휴일' : '회사 지정 휴일',
    })),
  };
}

// ── MCP 서버 ────────────────────────────────────────────────────────────────
const VALUE_GUIDE = [
  '값의 뜻과 단위:',
  '- 시각은 모두 현장 타임존(응답의 timezone, 보통 Asia/Seoul) 기준 24시간제 "HH:mm".',
  '- check_in_raw / check_out_raw = 근로자가 실제로 찍은 시각. check_in_recognized / check_out_recognized = 타각 보정 규칙을 거친 "인정 시각"(계산에 쓰인 시각). 보정 규칙에 걸리지 않으면 둘이 같다.',
  '- check_out_next_day=true 이면 퇴근이 근무일 다음 날이다. 이때 "00:00"은 밤 12시(24:00)를 뜻한다.',
  '- *_hours 는 시간(소수, 예 1.5 = 1시간 30분). work_hours=점심 제외 총 근무, regular_hours=소정근로, overtime_hours=평일 연장, holiday_hours=휴일근로, holiday_overtime_hours=휴일 연장, night_hours=야간(22~06시 등 설정 구간과 겹친 시간. 가산용이라 다른 시간과 중복 집계된다 — 더하지 말 것).',
  '- man_days = 공수(일용직 daily·사업소득자 business 의 품 단위, 1 = 하루치). 월급제·시급제의 미확정 행은 0. 일용·사업소득의 미확정 행은 *_hours 가운데 work_hours·night_hours 만 채워진다.',
  '- confirmed=true 는 관리자가 근태 화면에서 "확정"한 값(그대로 써도 됨). false 는 출퇴근 시각으로 앱과 같은 방식으로 자동 계산한 값이라 관리자가 확정하면 달라질 수 있다.',
  '- day_type: weekday 평일 / saturday 토요일 / sunday 일요일 / holiday 공휴일(등록된 휴일이면 토·일보다 우선).',
  '- missing_check_out=true 는 출근만 찍고 퇴근 기록이 없는 날. 시간·공수가 모두 0으로 나오니 임의로 채우지 말고 사용자에게 알릴 것.',
].join('\n');

function buildServer(sb: SupabaseClient): McpServer {
  const server = new McpServer(
    { name: 'checkin-labor-readonly', version: '1.0.0' },
    {
      instructions:
        '건설 현장 출퇴근·노무 앱의 읽기 전용 데이터입니다. 엑셀 노무대장을 채울 때: ① list_workers 로 사번·이름·단가 확인 → ② get_monthly_summary 로 월 합계 → ③ 날짜별 칸은 get_attendance. ' +
        '근로자는 이름이 아니라 사번(worker_code)으로 맞추세요. 주민번호·계좌·연락처·주소는 제공하지 않으니 그런 칸은 비워 두세요. 데이터를 수정하는 도구는 없습니다.',
    },
  );
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
  const ymd = (what: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식').describe(what);
  const workerCode = z.string().min(1).max(50).optional().describe('사번(예: "CM6010"). 생략하면 전체 근로자. list_workers 의 worker_code 와 같은 값.');

  server.registerTool('list_workers', {
    title: '근로자 목록',
    description:
      '근로자 목록(사번순). worker_code=사번, name=이름, employment_type=고용유형(salary 월급제 / hourly 시급제 / daily 일용직 / business 사업소득자), ' +
      'department=부서, rank=직급, job=직종, join_date·retire_date=입사일·퇴사일(YYYY-MM-DD, 재직 중이면 retire_date 는 null). ' +
      '단가는 원(KRW) 단위: monthly_base=월 기본급, hourly_rate=시급, daily_rate=일급(공수 1당 금액). 고용유형에 맞는 단가만 의미가 있다(일용·사업소득 → daily_rate). ' +
      '주민번호·계좌·연락처·주소는 제공하지 않는다.',
    inputSchema: { include_retired: z.boolean().optional().describe('true 면 퇴사자도 포함. 기본 false(재직자만). 지난달 대장을 채울 때는 true 를 권장.') },
    annotations: readOnly,
  }, async ({ include_retired }: { include_retired?: boolean }) => ok(await listWorkers(sb, include_retired ?? false)));

  server.registerTool('get_attendance', {
    title: '일별 근태',
    description:
      `기간 내 일별 출퇴근·근로시간·공수. 근로자 1명의 하루가 1행이고, 출퇴근 기록이 없는 날은 행이 없다(쉰 날). 사번순 → 날짜순. 기간은 한 번에 최대 ${MAX_RANGE_DAYS}일. ` +
      '인원이 많으면 worker_code 를 지정해 한 사람씩 받는 편이 정확하다.\n' + VALUE_GUIDE,
    inputSchema: { from: ymd('시작 근무일 (포함)'), to: ymd('끝 근무일 (포함)'), worker_code: workerCode },
    annotations: readOnly,
  }, async ({ from, to, worker_code }: { from: string; to: string; worker_code?: string }) => ok(await getAttendance(sb, from, to, worker_code)));

  server.registerTool('get_monthly_summary', {
    title: '월 근태 합계',
    description:
      '한 달치 근로자별 합계. 그 달에 재직한 근로자는 기록이 없어도 0으로 나온다. ' +
      'attendance_days=출근일수(출근 기록이 있는 날 수), man_days=공수 합계, *_hours=시간 분류별 합계, missing_check_out=퇴근 미체크 건수, ' +
      'confirmed_days / unconfirmed_days=관리자 확정 / 미확정 일수, status_counts=근태 상태별 일수. monthly_base·hourly_rate·daily_rate=단가(원). ' +
      '일용·사업소득자의 노임은 보통 man_days × daily_rate 이다. unconfirmed_days 나 missing_check_out 이 0이 아니면 합계가 아직 확정 전이라는 뜻이니 사용자에게 알릴 것.\n' + VALUE_GUIDE,
    inputSchema: { month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식').describe('대상 월, 예: "2026-11"'), worker_code: workerCode },
    annotations: readOnly,
  }, async ({ month, worker_code }: { month: string; worker_code?: string }) => ok(await getMonthlySummary(sb, month, worker_code)));

  server.registerTool('get_settings', {
    title: '임금·근무 설정',
    description:
      '계산 기준 설정. work_time=근무시간 기준(기본 출퇴근·점심 시각 HH:mm, standardDailyHours 1일 소정시간, hourlyOrdinaryMonthlyHours 월 통상시간 209 등). ' +
      'overtime_rules=가산율(weekdayOvertimeRate 평일 연장 배율 예 1.5, holidayRate 휴일, holidayOvertimeRate 휴일 연장, nightRate 야간 "추가" 가산 예 0.5)과 야간 구간, snapRules=타각 보정 규칙(해당 요일·출퇴근 구분에서 fromTime~toTime 에 찍으면 snapTo 로 인정). ' +
      'man_day_rules=일용·사업소득 공수를 정하는 급여정산 테이블: shift(day 주간조 / night 야간조 — 출근이 night_shift_start_time 이후면 야간조), dayType(weekday 평일 표 / saturday 토요일 표 / sunday 일요일·평일 공휴일 표), ' +
      '"출근 ≤ fromTime 이고 퇴근 ≥ toTime"인 행의 manDays 를 모두 더한다(구간을 다 채우지 못하면 0, 비례 계산 없음). countable=false 행은 안내용이라 더하지 않는다. outBefore 가 있는 행은 퇴근이 그 시각보다 이를 때만 적용. ' +
      'insurance_rates·tax_rules=4대보험·세율(비율, 0.045 = 4.5%), allowance_defaults=수당 기본값(원). 현장 주소·좌표·QR 코드는 제공하지 않는다.',
    inputSchema: {},
    annotations: readOnly,
  }, async () => ok(await getSettings(sb)));

  server.registerTool('get_holidays', {
    title: '휴일 목록',
    description: '해당 연도에 등록된 휴일. date=날짜(YYYY-MM-DD), weekday=요일(일~토), name=이름, type=public(법정 공휴일) / custom(회사 지정 휴일). 여기 등록된 날은 근태의 day_type 이 holiday 가 된다. 일요일은 등록돼 있지 않아도 휴일로 계산된다.',
    inputSchema: { year: z.number().int().min(2000).max(2100).describe('연도, 예: 2026') },
    annotations: readOnly,
  }, async ({ year }: { year: number }) => ok(await getHolidays(sb, year)));

  return server;
}

// ── HTTP ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (!(await isAuthorized(req))) {
    return json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }, 401, { 'www-authenticate': 'Bearer' });
  }
  if (req.method !== 'POST') {
    return json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. POST 만 지원합니다.' }, id: null }, 405, { allow: 'POST' });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const server = buildServer(sb);
  // sessionIdGenerator 를 주지 않으면 상태 없는 모드, enableJsonResponse 로 SSE 대신 JSON 한 번에 응답
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (e) {
    console.error('mcp request failed:', e);
    return json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }, 500);
  }
});
