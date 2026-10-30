/**
 * Perhitungan geolokasi murni.
 *
 * Tidak ada akses GPS di aplikasi ini: koordinat absen selalu berasal dari
 * titik yang dipilih pengguna di peta (lihat `lokasiTersimpan.ts`), lalu
 * dikirim apa adanya sebagai `last_latlong`. Karena itu modul ini hanya
 * berisi rumus jarak dan pengecekan radius — tidak ada hook yang meminta
 * izin lokasi ke peramban.
 */

/** Jarak dua titik di permukaan bumi, meter (rumus haversine). */
function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export interface GeofenceResult {
  withinRadius: boolean;
  distance: number | null;
  radius: number;
}

/**
 * Cek apakah koordinat berada dalam radius titik absen server.
 *
 * Radius dalam meter; nilai yang tidak valid dianggap 100 m — angka yang
 * sama dengan fallback di sisi server.
 */
export function checkGeofence(
  sourceLat: number | null | undefined,
  sourceLon: number | null | undefined,
  targetLat: number | string | null | undefined,
  targetLon: number | string | null | undefined,
  radiusRaw: number | string | null | undefined
): GeofenceResult {
  const radius = Number(radiusRaw);
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 100;

  if (
    sourceLat === null || sourceLat === undefined ||
    sourceLon === null || sourceLon === undefined ||
    targetLat === null || targetLat === undefined || targetLat === '' ||
    targetLon === null || targetLon === undefined || targetLon === ''
  ) {
    return { withinRadius: false, distance: null, radius: safeRadius };
  }

  const distance = distanceMeters(sourceLat, sourceLon, Number(targetLat), Number(targetLon));
  return { withinRadius: distance <= safeRadius, distance, radius: safeRadius };
}
