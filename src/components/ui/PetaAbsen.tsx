import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Peta Leaflet ringkas untuk halaman Lokasi Absen.
 *
 * Leaflet diimpor sebagai ESM lalu dipakai lewat `L.Map` imperatif —
 * bukan lewat pembungkus React, supaya marker bisa digeser, radius
 * digambar sebagai lingkaran, dan klik peta langsung memberi koordinat
 * baru tanpa memicu render ulang peta.
 *
 * Tile dari OpenStreetMap. Leaflet butuh URL absolut untuk tile, jadi
 * `tile.openstreetmap.org` ditulis penuh (tanpa protocol relatif yang
 * akan ditafsirkan relatif terhadap origin sendiri).
 */

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Ikon marker default Leaflet di-bundle sebagai URL, bukan objek gambar. */
const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

export interface TitikPeta {
  id: string;
  nama: string;
  latitude: number;
  longitude: number;
  radius: number;
  /** true = titik milik server (`getlokasiabsen`). */
  dariServer: boolean;
  /** true = titik yang sedang disunting atau dipakai. */
  aktif?: boolean;
  /** true = posisi perangkat saat ini. */
  posisiDevices?: boolean;
  /** Jarak pengguna ke titik ini, meter; null bila belum diketahui. */
  jarak?: number | null;
  /** true bila jarak ini masih di dalam radius. */
  dalamRadius?: boolean;
}

export interface PetaAbsenProps {
  /** Titik yang digambar. */
  titik: TitikPeta[];
  /** Titik yang bisa digeser (biasanya satu, titik yang sedang disunting). */
  draggableId?: string | null;
  /** Dipanggil saat marker digeser — koordinat baru. */
  onGeser?: (id: string, koordinat: { latitude: number; longitude: number }) => void;
  /** Dipanggil saat peta diklik — untuk membuat titik baru. */
  onKlikPeta?: (koordinat: { latitude: number; longitude: number }) => void;
  /** Dipanggil saat marker diklik. */
  onPilih?: (id: string) => void;
  /** Titik yang dipusatkan saat peta siap (id marker atau koordinat). */
  fokus?: { id?: string; latitude?: number; longitude?: number } | null;
  className?: string;
  height?: string;
}

export default function PetaAbsen({
  titik,
  draggableId,
  onGeser,
  onKlikPeta,
  onPilih,
  fokus,
  className = '',
  height = '420px',
}: PetaAbsenProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const markerByIdRef = useRef(new Map<string, L.Marker>());
  // Simpan handler terbaru di ref supaya layer tidak perlu dibangun ulang
  // setiap kali callback berubah identitas.
  const onGeserRef = useRef(onGeser);
  const onKlikPetaRef = useRef(onKlikPeta);
  const onPilihRef = useRef(onPilih);
  onGeserRef.current = onGeser;
  onKlikPetaRef.current = onKlikPeta;
  onPilihRef.current = onPilih;

  // ── Inisialisasi peta sekali ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [-7.5, 112.7], // tengah Jawa Timur
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    layerGroupRef.current = L.layerGroup().addTo(map);

    if (onKlikPetaRef.current) {
      map.on('click', event => {
        onKlikPetaRef.current?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
      });
    }

    mapRef.current = map;

    // Peta di dalam tab/panel yang mulai tersembunyi dilaporkan ukuran nol;
    // invalidateSize memaksa penghitungan ulang saat kontainer terlihat.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      markerByIdRef.current.clear();
    };
  }, []);

  // ── Gambar ulang titik ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    markerByIdRef.current.clear();

    for (const item of titik) {
      const color =
        item.posisiDevices
          ? '#e11d48'
          : item.aktif
            ? '#2563eb'
            : item.dariServer
              ? '#059669'
              : '#7c3aed';

      if (item.radius > 0) {
        L.circle([item.latitude, item.longitude], {
          radius: item.radius,
          color,
          weight: 1,
          opacity: 0.5,
          fillColor: color,
          fillOpacity: 0.08,
        }).addTo(group);
      }

      const marker = L.marker([item.latitude, item.longitude], {
        icon: markerIcon,
        draggable: item.id === draggableId,
        title: item.nama,
      });

      const jarakTeks =
        item.jarak === null || item.jarak === undefined
          ? ''
          : `<br><strong>${Math.round(item.jarak).toLocaleString('id-ID')} m</strong> dari Anda` +
            (item.dalamRadius ? ' · dalam radius' : ' · di luar radius');

      marker.bindPopup(
        `<div style="min-width:150px"><strong>${escapeHtml(item.nama)}</strong>` +
          `<br><span style="font-family:monospace;font-size:11px">${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}</span>` +
          (item.radius > 0 ? `<br>radius ${item.radius} m` : '') +
          jarakTeks +
          `</div>`
      );
      marker.on('click', () => onPilihRef.current?.(item.id));
      marker.on('dragend', event => {
        const pos = (event.target as L.Marker).getLatLng();
        onGeserRef.current?.(item.id, { latitude: pos.lat, longitude: pos.lng });
      });

      marker.addTo(group);
      markerByIdRef.current.set(item.id, marker);
    }
  }, [titik, draggableId]);

  // ── Fokus ke titik tertentu ─────────────────────────────────────
  const fokusId = fokus?.id;
  const titikFokus = fokusId ? titik.find(item => item.id === fokusId) : undefined;
  const fokusLatitude =
    typeof fokus?.latitude === 'number' ? fokus.latitude : titikFokus?.latitude;
  const fokusLongitude =
    typeof fokus?.longitude === 'number' ? fokus.longitude : titikFokus?.longitude;
  const kunciIdTitik = titik.map(item => item.id).join('\0');

  /**
   * Hitung zoom optimal berdasarkan radius titik.
   * Makin besar radius → makin zoom out agar lingkaran terlihat penuh.
   */
  function zoomDariRadius(radius: number | undefined): number {
    if (!radius || radius <= 0) return 17;
    if (radius <= 50)   return 18;
    if (radius <= 100)  return 17;
    if (radius <= 200)  return 16;
    if (radius <= 500)  return 15;
    if (radius <= 1000) return 14;
    if (radius <= 3000) return 13;
    return 12;
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (typeof fokusLatitude === 'number' && typeof fokusLongitude === 'number') {
      const zoomTarget = zoomDariRadius(titikFokus?.radius);
      map.setView([fokusLatitude, fokusLongitude], Math.max(map.getZoom(), zoomTarget), { animate: true });
      if (fokusId) markerByIdRef.current.get(fokusId)?.openPopup();
      return;
    }
    if (!fokusId) return;

    const marker = markerByIdRef.current.get(fokusId);
    if (!marker) return;
    const zoomTarget = zoomDariRadius(titikFokus?.radius);
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), zoomTarget), { animate: true });
    marker.openPopup();
  }, [fokusId, fokusLatitude, fokusLongitude, kunciIdTitik, titikFokus?.radius]);

  // ── Susun ulang tampilan ────────────────────────────────────────
  const style = useMemo(() => ({ height }), [height]);

  return (
    <div
      ref={containerRef}
      style={style}
      className={`w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 z-0 ${className}`}
      role="application"
      aria-label="Peta titik absen"
    />
  );
}

/** Cegah HTML dari nama lokasi merusak popup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
