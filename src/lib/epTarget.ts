/**
 * Origin server e-Presensi untuk proxy `/ep/*` (menu Web).
 *
 * ## Kenapa berkas ini ada
 *
 * Host pusat tadinya ditulis langsung di **empat** tempat:
 *
 * | tempat | bentuk |
 * | --- | --- |
 * | `src/serverless/ep.ts` | `const TARGET = 'https://presensi.bkd…'` |
 * | `src/serverless/ep.ts` | regex rewrite `Location` yang menyebut host |
 * | `vite.config.ts` | `const EP_TARGET = 'https://presensi.bkd…'` |
 * | `vite.config.ts` | regex rewrite `Location` yang menyebut host |
 *
 * Empat salinan itu bukan sekadar kotak: begitu host pusat berubah, proxy
 * `/ep` di Vercel dan proxy `/ep` di lokal bisa menunjuk ke host berbeda,
 * sedangkan regex rewrite `Location` di dua file itu harus diubah manual.
 * Kalau lupa satu, gejalanya **login web gagal tanpa error**: server pusat
 * membalas `Set-Cookie` + `Location` ke host aslinya, browser mengikuti
 * redirect ke luar, lalu cookie tidak pernah tersimpan di `/ep`.
 *
 * Dua di antaranya juga tidak terlihat kalau hanya `grep "https://"`: bentuknya
 * regex, bukan string URL — `presensi\.bkd\.jatimprov\.go\.id` dengan titik
 * ter-escape. Pemeriksaan yang hanya mencari `https://…` akan menganggap aman.
 *
 * ## Aturannya
 *
 * Urutan pembacaan, dari yang paling spesifik:
 *
 * 1. `EP_TARGET_ORIGIN` — kalau diisi, inilah yang dipakai. Dipakai saat
 *    `/ep` harus menunjuk mirror/host lain yang bukan gateway RPC.
 * 2. `PRESENSI_BASE_URL` — dipakai hanya **origin**-nya. Alasannya: menu Web
 *    dan RPC memang satu server yang sama, jadi satu env var harus cukup
 *    untuk keduanya; mengisi `PRESENSI_BASE_URL` ke mirror uji tidak boleh
 *    diam-diam meninggalkan `/ep` masih di host produksi.
 * 3. Bawaan kontrak — dipakai hanya kalau dua-duanya kosong, supaya proyek
 *    tetap jalan tanpa `.env` sama sekali.
 *
 * ⚠️ Modul ini hanya untuk sisi server (`process.env`). `src/lib/webPresensi.ts`
 * berada di peramban dan **tidak boleh** mengimpornya — ia memakai path
 * same-origin `/ep`, jadi tidak perlu tahu host pusat sama sekali.
 */

/** Bawaan dari kontrak terverifikasi. Bukan konfigurasi — lihat catatan atas. */
export const EP_TARGET_BAWAAN = 'https://presensi.bkd.jatimprov.go.id';

/**
 * Membaca URL sebagai origin, dengan pesan yang menyebut nama variabelnya.
 *
 * `new URL()` melempar galat yang tidak menyebut nama env var — "Invalid URL"
 * tanpa petunjuk — dan galat itu muncul saat modul diimpor. Di Vercel itu
 * berarti 500 di setiap endpoint yang memuat modul ini, dengan penyebab yang
 * tidak menyebut satu pun nama environment variable.
 */
function asalDari(nilai: string, namaVar: string): string {
  try {
    return new URL(nilai).origin;
  } catch {
    throw new Error(
      `${namaVar} bukan URL yang valid: ${JSON.stringify(nilai)}. ` +
      `Contoh yang benar: ${EP_TARGET_BAWAAN}`
    );
  }
}

/** Origin yang dipakai untuk semua request `/ep/*`. */
export function epTargetOrigin(): string {
  const khusus = process.env.EP_TARGET_ORIGIN?.trim();
  if (khusus) return asalDari(khusus, 'EP_TARGET_ORIGIN');

  const dasar = process.env.PRESENSI_BASE_URL?.trim();
  if (dasar) return asalDari(dasar, 'PRESENSI_BASE_URL');

  return EP_TARGET_BAWAAN;
}

/**
 * Regex yang mencabut `http(s)://host` dari nilai `Location` milik upstream.
 *
 * ⚠️ Host **tidak** ditulis langsung di sini. Diturunkan dari origin aktif,
 * termasuk titik yang harus di-escape (`presensi.bkd.jatimprov.go.id` punya
 * titik yang, kalau tidak di-escape, cocok juga dengan `presensiXbkdY…`).
 *
 * Skema tetap `https?` walau target memakai `https`, karena upstream bisa
 * membalas redirect ke `http://` untuk host yang sama dan nilainya tetap harus
 * ditulis ulang agar tidak keluar dari proxy.
 */
export function epAsalRegex(): RegExp {
  const host = new URL(epTargetOrigin()).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^https?://${host}`, 'i');
}