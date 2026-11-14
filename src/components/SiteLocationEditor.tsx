// 관리자 현장 설정 — 현장 기준점(위도·경도)과 반경 편집.
// 입력마다 저장하지 않고 로컬 draft 에 모았다가 [저장] 때 한 번만 반영한다
// (입력 한 글자마다 settings 저장 + 변경 이력이 쌓이던 문제 방지).
import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LocateFixed, MapPin, RotateCcw, Save } from "lucide-react";
import { SiteSettings } from "../types";
import { isSiteLocationUnset, isValidLatLng } from "../utils/geo";

// 지도(leaflet)는 이 화면을 열 때만 내려받는다.
const SiteMap = lazy(() => import("./SiteMap"));

const MIN_RADIUS = 50;
const MAX_RADIUS = 1000;

interface Draft {
  lat: string;
  lng: string;
  radius: number;
}

function toDraft(site: SiteSettings): Draft {
  return {
    lat: String(site.siteLocation?.lat ?? ""),
    lng: String(site.siteLocation?.lng ?? ""),
    radius: Number(site.allowedRadius) || 100,
  };
}

function round6(n: number): number {
  return Number(n.toFixed(6));
}

export const SiteLocationEditor: React.FC<{
  site: SiteSettings;
  onSave: (next: {
    siteLocation: { lat: number; lng: number };
    allowedRadius: number;
    siteLocationSet: true;
  }) => Promise<void>;
}> = ({ site, onSave }) => {
  const [draft, setDraft] = useState<Draft>(() => toDraft(site));
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);

  const savedLat = site.siteLocation?.lat;
  const savedLng = site.siteLocation?.lng;
  const savedRadius = site.allowedRadius;

  // 저장된 값이 바뀌면(저장 완료·다른 관리자의 변경) draft 를 다시 맞춘다.
  useEffect(() => {
    setDraft(toDraft(site));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedLat, savedLng, savedRadius]);

  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  const valid = draft.lat.trim() !== "" && draft.lng.trim() !== "" && isValidLatLng(lat, lng);
  const savedIsPlaceholder = isSiteLocationUnset(site);
  // 기준점을 한 번도 저장한 적이 없으면, 값을 바꾸지 않아도 "이 위치로 확정" 저장을 할 수 있어야 한다.
  const dirty =
    savedIsPlaceholder ||
    lat !== Number(savedLat) || lng !== Number(savedLng) || draft.radius !== Number(savedRadius);

  // 입력 중 좌표가 잠시 유효하지 않아도 지도는 마지막 유효 위치를 유지한다.
  const mapCenter = useMemo(
    () => (valid ? { lat, lng } : { lat: Number(savedLat) || 0, lng: Number(savedLng) || 0 }),
    [valid, lat, lng, savedLat, savedLng]
  );

  const pick = (nextLat: number, nextLng: number) => {
    setDraft((d) => ({ ...d, lat: String(round6(nextLat)), lng: String(round6(nextLng)) }));
    setMessage(null);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage({ kind: "error", text: "이 브라우저에서는 위치를 사용할 수 없습니다. (HTTPS 접속이 필요합니다)" });
      return;
    }
    setLocating(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pick(pos.coords.latitude, pos.coords.longitude);
        const acc = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null;
        setMessage({
          kind: "info",
          text:
            `현재 위치를 불러왔습니다${acc != null ? ` (정확도 약 ±${acc}m)` : ""}. ` +
            "지도에서 위치를 확인한 뒤 [저장]을 눌러야 반영됩니다.",
        });
      },
      (err) => {
        setLocating(false);
        setMessage({
          kind: "error",
          text:
            err.code === err.PERMISSION_DENIED
              ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요."
              : "현재 위치를 가져오지 못했습니다. 잠시 후 다시 시도하거나 지도를 클릭해 지정해 주세요.",
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ siteLocation: { lat, lng }, allowedRadius: draft.radius, siteLocationSet: true });
      setMessage({ kind: "ok", text: "현장 기준점과 반경을 저장했습니다." });
    } catch (e: any) {
      setMessage({ kind: "error", text: e?.message || "저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="block text-xs font-semibold text-gray-500">
          현장 기준점 지도 (지도를 클릭하거나 핀을 끌어 기준점을 지정합니다)
        </span>
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          <LocateFixed className={`w-3.5 h-3.5 ${locating ? "animate-pulse" : ""}`} />
          {locating ? "위치 확인 중…" : "현재 위치를 기준점으로"}
        </button>
      </div>

      {savedIsPlaceholder && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-900">기준점이 아직 설정되지 않았습니다</p>
            <p>
              현재 좌표는 초기 더미 값입니다. 기준점을 저장하기 전까지는 출퇴근 위치가 기록되더라도
              거리·현장 밖 여부는 판정되지 않습니다. 현장에서 [현재 위치를 기준점으로]를 누르거나 지도를 클릭해 지정한 뒤 저장하세요.
            </p>
          </div>
        </div>
      )}

      <div className="relative border border-gray-200 rounded-xl overflow-hidden bg-slate-100 shadow-inner">
        <Suspense
          fallback={
            <div className="h-72 flex items-center justify-center text-xs text-gray-400">지도를 불러오는 중…</div>
          }
        >
          <SiteMap center={mapCenter} radius={draft.radius} onPick={pick} />
        </Suspense>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">현장 기준점 위도 / 경도 (Lat / Lng)</label>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            step="0.000001"
            value={draft.lat}
            onChange={(e) => setDraft((d) => ({ ...d, lat: e.target.value }))}
            aria-label="위도"
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-mono"
          />
          <input
            type="number"
            step="0.000001"
            value={draft.lng}
            onChange={(e) => setDraft((d) => ({ ...d, lng: e.target.value }))}
            aria-label="경도"
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-mono"
          />
        </div>
        {!valid && (
          <p className="mt-1 text-[11px] text-rose-600">위도는 -90~90, 경도는 -180~180 범위의 숫자여야 합니다.</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">
          현장 반경 (Site Radius): <span className="text-blue-600 font-extrabold">{draft.radius}m</span>
        </label>
        <input
          type="range"
          min={MIN_RADIUS}
          max={MAX_RADIUS}
          step="50"
          value={draft.radius}
          onChange={(e) => setDraft((d) => ({ ...d, radius: Number(e.target.value) }))}
          className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
          <span>{MIN_RADIUS}m</span>
          <span>{MAX_RADIUS.toLocaleString()}m</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || !valid || saving}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "저장 중…" : "기준점·반경 저장"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(toDraft(site));
            setMessage(null);
          }}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          되돌리기
        </button>
        {dirty && !saving && <span className="text-[11px] font-semibold text-amber-600">저장하지 않은 변경이 있습니다</span>}
      </div>

      {message && (
        <p
          className={`text-[11px] ${
            message.kind === "ok" ? "text-emerald-600" : message.kind === "error" ? "text-rose-600" : "text-blue-600"
          }`}
        >
          {message.text}
        </p>
      )}

      <p className="flex items-start gap-1 text-[11px] text-gray-400">
        <MapPin className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          파란 원이 현장 반경입니다. 반경은 출퇴근을 <b>막지 않습니다</b> — 타각 위치와 기준점 사이의 거리,
          반경 안/밖 여부를 기록해 보여 주는 용도입니다. (GPS 오차·위치 권한 거부로 출근이 막히지 않도록)
        </span>
      </p>
    </div>
  );
};
