// 현장 위치(기준점) 관련 공용 헬퍼.
// 위치는 출퇴근을 "막는" 용도가 아니라 거리·반경 내 여부를 "기록·표시"하는 용도다.

// seed.sql / DEFAULT_SETTINGS 에 들어 있는 더미 기준점.
// 이 값 그대로면 "기준점 미설정"으로 본다 (submit_attendance RPC 도 같은 값을 미설정으로 취급).
export const PLACEHOLDER_SITE_LOCATION = { lat: 37.1234, lng: 126.4567 } as const;

export function isPlaceholderSiteLocation(
  loc: { lat: number; lng: number } | null | undefined
): boolean {
  if (!loc) return true;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  return lat === PLACEHOLDER_SITE_LOCATION.lat && lng === PLACEHOLDER_SITE_LOCATION.lng;
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
