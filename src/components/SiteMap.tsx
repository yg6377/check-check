// 현장 기준점 지도 (Leaflet + OpenStreetMap, API 키 불필요).
// 관리자 현장 설정에서만 쓰이므로 SiteLocationEditor 가 React.lazy 로 불러온다
// → leaflet(JS+CSS)은 초기 번들에 들어가지 않는다.
import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface SiteMapProps {
  center: { lat: number; lng: number };
  radius: number; // 미터
  onPick: (lat: number, lng: number) => void;
}

// Leaflet 기본 마커는 CSS 위치를 기준으로 PNG 경로를 추정하는데,
// Vite 가 파일명을 해시로 바꾸면 그 추정이 깨져 마커가 깨진 이미지로 나온다.
// 이미지 파일에 의존하지 않도록 인라인 SVG 핀(divIcon)을 쓴다.
const PIN_ICON = L.divIcon({
  className: "",
  iconSize: [28, 36],
  iconAnchor: [14, 36],
  html:
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">' +
    '<path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 36 14 36s14-11.7 14-22.1C28 6.2 21.7 0 14 0z" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>' +
    '<circle cx="14" cy="14" r="5" fill="#ffffff"/></svg>',
});

const SiteMap: React.FC<SiteMapProps> = ({ center, radius, onPick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // 지도는 한 번만 만든다. 좌표·반경 변화는 아래 effect 가 기존 레이어를 옮겨서 반영한다.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 16,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const circle = L.circle([center.lat, center.lng], {
      radius,
      color: "#2563eb",
      weight: 1.5,
      dashArray: "4",
      fillColor: "#3b82f6",
      fillOpacity: 0.12,
    }).addTo(map);
    const marker = L.marker([center.lat, center.lng], {
      icon: PIN_ICON,
      draggable: true,
      keyboard: false,
    }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      onPickRef.current(e.latlng.lat, e.latlng.lng);
    });
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onPickRef.current(p.lat, p.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    // 탭 전환 직후 등 컨테이너 크기가 늦게 잡히면 타일이 일부만 그려진다.
    const t = setTimeout(() => map.invalidateSize(), 0);

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // 초기 1회만 — center/radius 는 다음 effect 에서 동기화
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !markerRef.current || !circleRef.current) return;
    const latlng = L.latLng(center.lat, center.lng);
    markerRef.current.setLatLng(latlng);
    circleRef.current.setLatLng(latlng);
    circleRef.current.setRadius(radius);
    // 기준점이 화면 밖으로 나갔을 때만 따라간다(클릭할 때마다 지도가 움직이지 않게).
    if (!map.getBounds().pad(-0.15).contains(latlng)) {
      map.panTo(latlng);
    }
  }, [center.lat, center.lng, radius]);

  // isolate: Leaflet 내부 z-index(최대 1000)가 앱의 모달·헤더 위로 올라오지 않게 쌓임 맥락을 가둔다.
  return <div ref={containerRef} className="isolate h-72 w-full" />;
};

export default SiteMap;
