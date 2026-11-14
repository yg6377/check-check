// 현장 위치(기준점) 관련 공용 헬퍼.
// 위치는 출퇴근을 "막는" 용도가 아니라 거리·반경 내 여부를 "기록·표시"하는 용도다.

// 기준점이 "아직 설정되지 않았는지" 판정한다.
// 좌표 값으로는 판단하지 않는다 — 시드의 더미 좌표뿐 아니라 예전 가짜 지도를 눌러 생긴 좌표도
// 실제 현장이 아니기 때문이다. 관리자가 현장 설정 화면에서 저장하면 siteLocationSet 이 true 가 되고,
// submit_attendance RPC 도 같은 표시를 보고 거리·반경 판정 여부를 정한다.
export function isSiteLocationUnset(
  site: { siteLocation?: { lat: number; lng: number } | null; siteLocationSet?: boolean } | null | undefined
): boolean {
  if (!site || site.siteLocationSet !== true || !site.siteLocation) return true;
  return !isValidLatLng(Number(site.siteLocation.lat), Number(site.siteLocation.lng));
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

// 1000m 미만은 m, 그 이상은 km 로 표기 (예: "85m", "1.2km")
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "-";
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)}km`;
}

// 타각과 함께 서버로 보내는 근로자 위치
export interface AttendanceLocation {
  lat: number;
  lng: number;
  accuracy: number | null; // 미터
}

// ------------------------------------------------------------
// 주소 → 좌표 (OpenStreetMap Nominatim, API 키 없음)
// ------------------------------------------------------------
// 한국 도로명 주소는 건물 번호까지 등록된 곳이 적다. 전체 주소로 못 찾으면 뒤쪽 단어를
// 하나씩 떼어 다시 찾고(도로 → 읍·면 순으로 넓어짐), 그 경우 approximate 로 알린다.
// 찾은 좌표는 "지도를 그 근처로 옮기는" 용도다 — 호출하는 쪽에서 바로 저장하지 말 것.
export interface GeocodeResult {
  lat: number;
  lng: number;
  /** 지도 서비스가 돌려준 장소 이름 */
  label: string;
  /** 실제로 검색에 쓰인 주소 (뒤 단어를 뗐으면 입력보다 짧다) */
  matchedQuery: string;
  /** 입력 주소 전체가 아니라 일부만으로 찾았는지 */
  approximate: boolean;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const GEOCODE_MAX_TRIES = 4;
// Nominatim 이용 정책: 초당 1회 이하
const GEOCODE_INTERVAL_MS = 1100;

export async function geocodeAddress(address: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const tokens = address.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  for (let attempt = 0; attempt < GEOCODE_MAX_TRIES && tokens.length - attempt >= 1; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, GEOCODE_INTERVAL_MS));
    const query = tokens.slice(0, tokens.length - attempt).join(" ");
    const url =
      `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=kr&accept-language=ko&q=` + encodeURIComponent(query);
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`주소 검색 서비스 오류 (${res.status})`);
    const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
    const hit = rows[0];
    if (hit) {
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (isValidLatLng(lat, lng)) {
        return { lat, lng, label: hit.display_name ?? query, matchedQuery: query, approximate: attempt > 0 };
      }
    }
  }
  return null;
}
