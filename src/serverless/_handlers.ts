/**
 * Daftar handler yang jadi Vercel Serverless Function.
 *
 * Satu-satunya sumber kebenaran. Dipakai oleh `build.mts` saat membundel dan
 * oleh `tools/cek-vercel-selfcontained.mts` saat menghitung — supaya keduanya
 * tidak bisa berbeda dalam diam-diam.
 *
 * ⚠️ Nama berawalan `_` **bukan** function. `_cors.ts` dan `_panel.ts` adalah
 * helper yang di-bundle bersama handler yang memakainya, dan Vercel tidak
 * memperlakukan berkasnya sebagai endpoint.
 *
 * Berkas ini sendiri ikut aturan itu: ia tidak handler, hanya daftar.
 */

/**
 * Yang bukan handler, selain yang sudah berawalan `_`.
 *
 * `build.mts` ikut dikecualikan: ia adalah perkakas build, bukan endpoint.
 * Kalau ikut ter-bundle, `api/build.mts` ter-deploy sebagai handler yang tidak
 * melakukan apa-apa selain menulis bundel baru ke `api/`.
 *
 * `ocr.ts` juga dikecualikan. Handler OCR pernah ada di Vercel untuk memecah
 * captcha otomatis, tapi ia menarik `onnxruntime-node` — 844 MB di
 * `node_modules`, dan itu penyebab storage Function melonjak. Produksi kini
 * meminta captcha diketik manual (lihat `OCR_LOKAL` di `WebPresensi.tsx`), jadi
 * handler-nya tidak lagi ada gunanya di server.
 *
 * Berkasnya **tetap ada** di `src/serverless/` karena dua hal:
 *
 * 1. `npm run dev` tetap memakai OCR — `vite.config.ts` melayaninya lewat
 *    `ocr_service.py`, jadi devs lokal tidak kehilangan kemampuan otomatisnya.
 * 2. Menghapus berkasnya menghapus satu-satunya jalan mengembalikan OCR kalau
 *    nanti dibutuhkan. Yang mahal adalah *deploy*-nya, dan itu sudah dihentikan.
 */
const BUKAN_HANDLER = new Set(['build.mts', '_handlers.ts', 'ocr.ts']);

/**
 * Nama handler tanpa ekstensi — persis nama berkas di `api/`.
 *
 * Satu-satunya tempat aturan "apa yang jadi endpoint" ditulis. Dipakai oleh
 * `build.mts` saat membundel, dan oleh dua skrip penjaga yang menghitung
 * jumlah sumber vs jumlah hasil. Kalau aturannya ditulis ulang di salah satu
 * dari tiga tempat itu, mereka bisa berbeda tanpa ada yang salah — dan
 * `build.mts` diam-diam menulis endpoint yang tidak pernah dimaksud
 * (seperti yang terjadi dengan `api/build.js`).
 */
export function daftarHandler(namaBerkas: readonly string[]): string[] {
  return namaBerkas
    .filter(f => f.endsWith('.ts') && !f.startsWith('_') && !BUKAN_HANDLER.has(f))
    .map(f => f.replace(/\.ts$/, ''))
    .sort();
}