/**
 * Satu-satunya tempat yang memutuskan "Midtrans produksi atau sandbox".
 *
 * ## Kenapa berkas ini ada
 *
 * Dulu setiap sisi membaca sendiri, dan tidak konsisten:
 *
 * | tempat | yang dibaca |
 * | --- | --- |
 * | `serverless/midtrans-charge.ts` | `MIDTRANS_IS_PRODUCTION` **atau** `VITE_MIDTRANS_IS_PRODUCTION` |
 * | `api/server.ts` | `MIDTRANS_IS_PRODUCTION` saja |
 * | `lib/serverBilling.ts` | `MIDTRANS_IS_PRODUCTION` saja |
 * | `lib/midtrans.ts` (peramban) | `VITE_MIDTRANS_IS_PRODUCTION` saja |
 *
 * Dua dari empat hanya mengenal satu nama. Kalau yang diisi di dasbor Vercel
 * cuma `VITE_MIDTRANS_IS_PRODUCTION` — dan itu nama yang **dijelaskan** di
 * `.env.example` bagian peramban, jadi sangat mungkin terjadi — maka
 * `midtrans-charge.ts` mengirim permintaan ke `api.midtrans.com`, sementara
 * `serverBilling.ts` memverifikasi tagihan di `api.sandbox.midtrans.com`.
 *
 * Akibatnya bukan hanya transaksi gagal diam-diam. Verifikasi selalu gagal,
 * jadi langganan tidak pernah aktif, dan karena pesan errornya generik
 * ("Gagal memproses"), tidak ada yang mengira penyebabnya ada di nama
 * environment.
 *
 * ## Aturannya sekarang
 *
 * Nama tanpa prefiks dibaca lebih dulu (`MIDTRANS_IS_PRODUCTION`), karena itu
 * yang didokumentasikan untuk sisi server. Kalau kosong, baru
 * `VITE_MIDTRANS_IS_PRODUCTION` — nama yang harus ada di peramban dan karena itu
 * selalu ikut terkonfigurasi di proyek yang memakai Snap. Dengan begitu
 * kedua sisi tidak mungkin lagi berbeda.
 *
 * Hanya `'true'` yang dihitung produksi. Variabel yang belum diisi, bernilai
 * `'1'`, atau `TRUE` semuanya berarti **sandbox** — pilihan yang aman, karena
 * transaksi produksi yang tidak sengaja tidak mungkin terjadi.
 */

/**
 * `true` kalau Midtrans harus memakai endpoint produksi.
 *
 * ⚠️ Hanya untuk sisi server (`process.env`). Modul ini tidak boleh diimpor
 * oleh apa pun yang masuk ke bundle peramban: `process.env` tidak ada di sana,
 * dan mengimpornya di sana akan membuat kode yang tidak mungkin benar ikut
 * ter-*tree-shake*.
 */
export function midtransProduksi(): boolean {
  return (
    process.env.MIDTRANS_IS_PRODUCTION === 'true' ||
    process.env.VITE_MIDTRANS_IS_PRODUCTION === 'true'
  );
}

/** Base URL Core API sesuai mode yang aktif. */
export function midtransBaseUrl(): string {
  return midtransProduksi() ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
}
