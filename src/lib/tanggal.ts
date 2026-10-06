/**
 * Format tanggal & waktu untuk seluruh aplikasi.
 *
 * Dipisah dari `dateFormatter.ts` supaya modul yang hanya butuh format
 * tampilan (label, tabel, dialog) tidak ikut menarik utilitas tanggal
 * absensi yang tidak ada hubungannya.
 */

/** ISO timestamp → `28 Sep 2026, 14:22` (WIB). */
export function formatTanggalWaktuLokal(iso: string | undefined | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * ISO timestamp → `28 Sep 2026` (WIB), tanpa jam.
 *
 * Untuk hal yang tanggalnya yang penting dan jamnya hanya noise — masa
 * aktif langganan, tanggal bayar, tanggal tagihan. "29 Okt 2026, 00.24"
 * di layar sempit mendorong teks supaya patah baris, sementara
 * "29 Okt 2026" selalu muat.
 */
export function formatTanggalLokal(iso: string | undefined | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}
