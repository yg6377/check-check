import React, { useEffect, useMemo, useState } from "react";
import { Calculator, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useApp } from "../context/SupabaseContext";
import { ManDayDayType, ManDayRow, ManDayShift } from "../types";
import { DEFAULT_MAN_DAY_TABLE, DEFAULT_NIGHT_SHIFT_START_TIME } from "../data/defaults";
import { calculateManDaysFromTable } from "../utils/attendanceHours";

/**
 * 일용/사업소득 "급여정산 테이블" 편집 창.
 *
 * - 화면에서 고친 내용은 로컬 draft에만 쌓이고 [저장]을 눌러야 DB에 반영된다
 *   (입력할 때마다 저장하면 설정 변경 이력이 글자 단위로 쌓이기 때문).
 * - 아래 "공수 미리 계산해 보기"는 저장 전의 draft로 계산하므로, 저장하기 전에 결과를 확인할 수 있다.
 */

const SHIFT_LABELS: Record<ManDayShift, string> = { day: "주간조", night: "야간조" };
const DAY_LABELS: Record<ManDayDayType, string> = {
  weekday: "평일",
  saturday: "토요일",
  sunday: "일요일 · 공휴일",
};
const DAY_ORDER: ManDayDayType[] = ["weekday", "saturday", "sunday"];

const HHMM = /^\d{1,2}:\d{2}$/;

function hhmmToMin(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** "00:00" 종료는 밤 12시(자정)로 계산된다는 것을 알기 쉽게 풀어 쓴다. */
function describeTime(value: string): string {
  if (!HHMM.test(value)) return "";
  if (value === "00:00" || value === "24:00") return "밤 12시";
  return value;
}

function cloneRows(rows: ManDayRow[]): ManDayRow[] {
  return rows.map((r) => ({ ...r }));
}

function formatManDays(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const inputClass =
  "w-full px-3 py-2.5 border-2 border-slate-300 rounded-lg text-lg bg-white focus:border-blue-600 focus:outline-none";

export const ManDayTableEditor: React.FC = () => {
  const { settings, updateSetting } = useApp();
  const rules = settings?.dailyWorkerRules;

  const savedRows = useMemo(() => cloneRows(rules?.manDayTable ?? DEFAULT_MAN_DAY_TABLE), [rules?.manDayTable]);
  const savedNightStart = rules?.nightShiftStartTime || DEFAULT_NIGHT_SHIFT_START_TIME;

  const [rows, setRows] = useState<ManDayRow[]>(savedRows);
  const [nightStart, setNightStart] = useState<string>(savedNightStart);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [shiftView, setShiftView] = useState<ManDayShift>("day");

  // 미리보기 계산기 입력
  const [previewDay, setPreviewDay] = useState<ManDayDayType>("weekday");
  const [previewIn, setPreviewIn] = useState("08:00");
  const [previewOut, setPreviewOut] = useState("17:00");

  // 고치는 중이 아닐 때만 서버 값으로 다시 맞춘다 (저장 직후·다른 곳에서 설정이 바뀐 경우)
  useEffect(() => {
    if (dirty) return;
    setRows(savedRows);
    setNightStart(savedNightStart);
  }, [savedRows, savedNightStart, dirty]);

  const touch = () => {
    setDirty(true);
    setMessage(null);
  };

  const patchRow = (id: string, patch: Partial<ManDayRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    touch();
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    touch();
  };

  const addRow = (shift: ManDayShift, dayType: ManDayDayType) => {
    const newRow: ManDayRow = {
      id: crypto.randomUUID(),
      shift,
      dayType,
      fromTime: "",
      toTime: "",
      manDays: 0.5,
      countable: true,
      label: "",
    };
    setRows((prev) => [...prev, newRow]);
    touch();
  };

  const loadDefaults = () => {
    if (!window.confirm("지금 표를 지우고 엑셀 기본값으로 바꿀까요?\n([저장]을 눌러야 실제로 적용됩니다.)")) return;
    setRows(cloneRows(DEFAULT_MAN_DAY_TABLE));
    setNightStart(DEFAULT_NIGHT_SHIFT_START_TIME);
    touch();
  };

  const discard = () => {
    setRows(savedRows);
    setNightStart(savedNightStart);
    setDirty(false);
    setMessage(null);
  };

  const invalidRowIds = useMemo(() => {
    const bad = new Set<string>();
    for (const r of rows) {
      if (!HHMM.test(r.fromTime) || !HHMM.test(r.toTime)) bad.add(r.id);
      else if (!Number.isFinite(r.manDays) || r.manDays < 0) bad.add(r.id);
      else if (r.outBefore !== undefined && !HHMM.test(r.outBefore)) bad.add(r.id);
    }
    return bad;
  }, [rows]);

  const save = async () => {
    if (!rules) return;
    if (invalidRowIds.size > 0) {
      setMessage({ kind: "error", text: "빨간색으로 표시된 줄에 시작·끝 시각이나 공수가 비어 있습니다. 채우거나 지운 뒤 다시 저장해 주세요." });
      return;
    }
    if (!HHMM.test(nightStart)) {
      setMessage({ kind: "error", text: "야간조 기준 출근 시각을 넣어 주세요." });
      return;
    }
    setSaving(true);
    try {
      await updateSetting("dailyWorkerRules", {
        ...rules,
        manDayTable: rows,
        nightShiftStartTime: nightStart,
      });
      setDirty(false);
      setMessage({ kind: "ok", text: "저장했습니다. 아직 확정하지 않은 근태부터 새 표로 계산됩니다." });
    } catch (err) {
      console.error("manDayTable save error:", err);
      setMessage({ kind: "error", text: "저장하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요." });
    } finally {
      setSaving(false);
    }
  };

  // 미리보기: 저장 전 draft 기준. 타각 보정(스냅)은 거치지 않고 넣은 시각 그대로 계산한다.
  const preview = useMemo(() => {
    if (!HHMM.test(previewIn) || !HHMM.test(previewOut)) return null;
    return calculateManDaysFromTable({
      inMinutes: hhmmToMin(previewIn),
      outMinutes: hhmmToMin(previewOut),
      dayType: previewDay,
      table: rows,
      nightShiftStartTime: HHMM.test(nightStart) ? nightStart : undefined,
    });
  }, [previewDay, previewIn, previewOut, rows, nightStart]);

  if (!rules) {
    return <p className="text-lg text-slate-500 py-8 text-center">설정을 불러오는 중입니다…</p>;
  }

  return (
    <div className="space-y-6 text-slate-900">
      <div>
        <h3 className="text-2xl font-bold">일용/사업소득 정산 테이블</h3>
        <p className="text-base text-slate-600 mt-2 leading-relaxed">
          일용직·사업소득자의 하루 공수를 정하는 표입니다. 엑셀 노무대장의 「급여정산 테이블」과 같은 방식으로,
          <b> 출근이 시작 시각보다 빠르거나 같고, 퇴근이 끝 시각보다 늦거나 같은 줄</b>의 공수를 모두 더합니다.
          중간에 퇴근해서 구간을 다 채우지 못한 줄은 0으로 칩니다.
        </p>
        <p className="text-base text-slate-600 mt-1">시급제·월급제 계산에는 영향을 주지 않습니다.</p>
      </div>

      {/* ── 미리보기 계산기 ── */}
      <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5 space-y-4">
        <div className="flex items-center gap-2 text-xl font-bold text-blue-900">
          <Calculator className="w-6 h-6" /> 공수 미리 계산해 보기
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-base font-semibold">요일</span>
            <select
              value={previewDay}
              onChange={(e) => setPreviewDay(e.target.value as ManDayDayType)}
              className={`${inputClass} mt-1`}
            >
              {DAY_ORDER.map((d) => (
                <option key={d} value={d}>{DAY_LABELS[d]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-base font-semibold">출근</span>
            <input type="time" value={previewIn} onChange={(e) => setPreviewIn(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="block">
            <span className="text-base font-semibold">퇴근</span>
            <input type="time" value={previewOut} onChange={(e) => setPreviewOut(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
        </div>
        {preview ? (
          <div className="bg-white rounded-lg border border-blue-200 p-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-4xl font-extrabold text-blue-700">{formatManDays(preview.manDays)} 공수</span>
              <span className="text-base text-slate-600">({SHIFT_LABELS[preview.shift]} 표로 계산)</span>
            </div>
            {preview.appliedRows.length > 0 ? (
              <ul className="mt-3 space-y-1 text-lg">
                {preview.appliedRows.map((r) => (
                  <li key={r.id} className="flex justify-between gap-4 border-b border-slate-100 py-1">
                    <span>
                      {r.fromTime} ~ {describeTime(r.toTime)}
                      {r.label ? <span className="text-slate-500"> · {r.label}</span> : null}
                    </span>
                    <span className="font-bold">+{formatManDays(r.manDays)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-lg text-slate-600">끝까지 채운 줄이 없어 0 공수입니다.</p>
            )}
            <p className="mt-3 text-sm text-slate-500">
              넣은 시각 그대로 계산한 값입니다. 실제 근태는 출퇴근 시각 보정(예: 16:50 퇴근 → 17:00 인정)을 먼저 거친 뒤 이 표로 계산합니다.
              {dirty ? " 지금 고치고 있는(아직 저장하지 않은) 표로 계산했습니다." : ""}
            </p>
          </div>
        ) : (
          <p className="text-lg text-slate-600">출근·퇴근 시각을 넣으면 공수가 바로 나옵니다.</p>
        )}
      </div>

      {/* ── 주간조 / 야간조 선택 ── */}
      <div className="grid grid-cols-2 gap-3">
        {(["day", "night"] as ManDayShift[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setShiftView(s)}
            className={`py-4 rounded-xl text-xl font-bold border-2 cursor-pointer transition ${
              shiftView === s ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {SHIFT_LABELS[s]} 표
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center gap-3">
        <span className="text-lg font-semibold">야간조 기준: 출근이</span>
        <input
          type="time"
          value={nightStart}
          onChange={(e) => { setNightStart(e.target.value); touch(); }}
          className="px-3 py-2 border-2 border-slate-300 rounded-lg text-lg bg-white w-40"
        />
        <span className="text-lg">이후이면 야간조 표, 그 전이면 주간조 표를 씁니다.</span>
      </div>

      {/* ── 요일별 표 ── */}
      {DAY_ORDER.map((dayType) => {
        const sectionRows = rows.filter((r) => r.shift === shiftView && r.dayType === dayType);
        return (
          <section key={dayType} className="rounded-xl border-2 border-slate-200 overflow-hidden">
            <header className="bg-slate-100 px-5 py-3 flex items-center justify-between">
              <h4 className="text-xl font-bold">{SHIFT_LABELS[shiftView]} · {DAY_LABELS[dayType]}</h4>
              {dayType === "sunday" && (
                <span className="text-sm text-slate-600">평일에 걸린 공휴일도 이 표로 계산합니다</span>
              )}
            </header>

            <div className="p-4 space-y-3">
              {sectionRows.length === 0 && (
                <p className="text-lg text-slate-500 py-2">줄이 없습니다. 아래 [줄 추가]를 눌러 넣어 주세요.</p>
              )}

              {sectionRows.map((row) => {
                const invalid = invalidRowIds.has(row.id);
                return (
                  <div
                    key={row.id}
                    className={`rounded-lg border-2 p-3 ${
                      invalid ? "border-red-400 bg-red-50" : row.countable ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-100"
                    }`}
                  >
                    <div className="grid grid-cols-2 md:grid-cols-12 gap-3 items-end">
                      <label className="block md:col-span-2">
                        <span className="text-sm font-semibold text-slate-600">시작</span>
                        <input type="time" value={row.fromTime} onChange={(e) => patchRow(row.id, { fromTime: e.target.value })} className={inputClass} />
                      </label>
                      <label className="block md:col-span-2">
                        <span className="text-sm font-semibold text-slate-600">끝</span>
                        <input type="time" value={row.toTime} onChange={(e) => patchRow(row.id, { toTime: e.target.value })} className={inputClass} />
                      </label>
                      <label className="block md:col-span-2">
                        <span className="text-sm font-semibold text-slate-600">공수</span>
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          value={Number.isFinite(row.manDays) ? row.manDays : ""}
                          onChange={(e) => patchRow(row.id, { manDays: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                          className={`${inputClass} font-bold`}
                        />
                      </label>
                      <label className="block col-span-2 md:col-span-2">
                        <span className="text-sm font-semibold text-slate-600">메모</span>
                        <input
                          type="text"
                          value={row.label ?? ""}
                          placeholder="예: 오전, 잔업"
                          onChange={(e) => patchRow(row.id, { label: e.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className="flex items-center gap-2 md:col-span-2 py-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={row.countable}
                          onChange={(e) => patchRow(row.id, { countable: e.target.checked })}
                          className="w-6 h-6"
                        />
                        <span className="text-lg font-semibold whitespace-nowrap">공수에 더함</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        aria-label="이 줄 지우기"
                        className="md:col-span-2 flex items-center justify-center gap-1 py-2.5 px-3 rounded-lg border-2 border-red-300 text-red-700 bg-white hover:bg-red-50 text-lg font-bold whitespace-nowrap cursor-pointer"
                      >
                        <Trash2 className="w-5 h-5" /> 삭제
                      </button>
                    </div>

                    {row.toTime === "00:00" && (
                      <p className="mt-2 text-sm text-slate-600">끝 시각 00:00(오전 12:00)은 밤 12시(자정)까지로 계산합니다.</p>
                    )}
                    {!row.countable && (
                      <p className="mt-2 text-sm text-slate-600">안내용 줄입니다. 공수에 더하지 않습니다. (하루 합계 표시, 점심·식사시간 등)</p>
                    )}
                    {row.outBefore !== undefined && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-base">
                        <span>조건: 퇴근이</span>
                        <input
                          type="time"
                          value={row.outBefore}
                          onChange={(e) => patchRow(row.id, { outBefore: e.target.value })}
                          className="px-2 py-1.5 border-2 border-slate-300 rounded-lg text-lg bg-white w-36"
                        />
                        <span>보다 빠를 때만 더합니다 (조기퇴근용).</span>
                        <button
                          type="button"
                          onClick={() => patchRow(row.id, { outBefore: undefined })}
                          className="underline text-slate-600 cursor-pointer"
                        >
                          조건 없애기
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => addRow(shiftView, dayType)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-blue-400 text-blue-700 bg-white hover:bg-blue-50 text-lg font-bold cursor-pointer"
              >
                <Plus className="w-5 h-5" /> {DAY_LABELS[dayType]} 줄 추가
              </button>
            </div>
          </section>
        );
      })}

      {/* ── 저장 영역 ── */}
      <div className="sticky bottom-0 bg-white border-t-2 border-slate-200 pt-4 pb-2 space-y-3">
        {dirty && !message && (
          <p className="text-lg font-semibold text-amber-700">고친 내용이 아직 저장되지 않았습니다. [저장]을 눌러야 적용됩니다.</p>
        )}
        {message && (
          <p className={`text-lg font-semibold ${message.kind === "ok" ? "text-green-700" : "text-red-700"}`}>{message.text}</p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-2 px-8 py-4 rounded-xl bg-blue-700 text-white text-xl font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-800"
          >
            <Save className="w-6 h-6" /> {saving ? "저장하는 중…" : "저장"}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={!dirty || saving}
            className="px-6 py-4 rounded-xl border-2 border-slate-300 bg-white text-lg font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
          >
            고친 것 취소
          </button>
          <button
            type="button"
            onClick={loadDefaults}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-4 rounded-xl border-2 border-slate-300 bg-white text-lg font-bold cursor-pointer hover:bg-slate-50 ml-auto"
          >
            <RotateCcw className="w-5 h-5" /> 엑셀 기본값 불러오기
          </button>
        </div>
      </div>
    </div>
  );
};
