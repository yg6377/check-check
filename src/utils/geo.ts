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
