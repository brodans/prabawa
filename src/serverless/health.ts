/**
 * Vercel Serverless Function — health check & diagnosis.
 *
 * Dua fungsi:
 *
 * 1. Menyediakan `midtrans: boolean` yang dipakai `cekMidtransServer()` di
 *    peramban untuk menentukan apakah metode QRIS Midtrans boleh ditawarkan.
 * 2. **Melaporkan konfigurasi yang hilang.** Tanpa endpoint ini, environment
 *    variable yang lupa diisi di dashboard Vercel hanya muncul sebagai
 *    "HTTP 403" atau "FUNCTION_INVOCATION_FAILED" di browser — keduanya
 *    tidak menyuruh operator mencari tahu apa yang salah, dan keduanya
 *    bentuknya sama untuk penyebab yang sangat berbeda.
 *
 * ⚠️ Yang dikirim hanya **keberadaan** variabel, tidak pernah nilainya.
 * `MIDTRANS_SERVER_KEY` sendiri tidak pernah keluar dari server, jadi
 * endpoint ini aman dipanggil dari mana pun yang bisa menjangkau aplikasi.
 */

import { terapkanCors, allowListKosong, daftarOrigin, PETUNUK_KONFIGURASI } from './_cors';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ ok: false });
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  /*
   * Allow-list kosong adalah kondisi yang membuat SELURUH aplikasi tidak
   * bisa dipakai: setiap POST dari peramban membawa `Origin`, dan tanpa
   * allow-list semuanya ditolak.
   *
   * Ini bukan 403 yang acak — ini 403 yang pasti, jadi harus disebut di
   * sini, bukan dibiarkan muncul sebagai "Access to fetch … has been
   * blocked by CORS policy" yang menyebut apa pun.
   */
  const originKosong = allowListKosong();
  const midtransSiap = Boolean(process.env.MIDTRANS_SERVER_KEY);
  const firebaseSiap = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.FIREBASE_CLOUD_PROJECT ||
      process.env.K_SERVICE
  );
  /*
   * `PANEL_SESSION_SECRET` — hanya dilaporkan sebagai boolean.
   *
   * Endpoint `/api/panel-auth` menolak dengan 503 kalau ini kosong, dan itu
   * bentuk kegagalannya **tidak** sama dengan "password salah": aplikasi
   * menampilkan Initialization Failed, yang jauh lebih berguna daripada
   * "Kesalahan jaringan" tanpa penjelasan.
   */
  const panelSecret = (process.env.PANEL_SESSION_SECRET ?? '').trim();
  const panelAuthSiap = panelSecret.length >= 32;

  return res.status(200).json({
    ok: true,
    service: process.env.PRESENSI_BASE_URL || 'https://presensi.bkd.jatimprov.go.id/service',
    version: Number(process.env.PRESENSI_VERSION || 89),
    midtrans: midtransSiap,

    /*
     * Ringkasan konfigurasi per fitur.
     *
     * `ok: true` hanya berarti server hidup — bukan berarti fiturnya bisa
     * dipakai. Kondisi yang membuat bug seperti `ALLOWED_ORIGINS` kosong
     * sulit dicari: server sehat, halaman termuat, tapi tidak satu pun API
     * call berhasil. Kedua keadaan itu harus bisa dibedakan dari luar.
     */
    konfigurasi: {
      origin: !originKosong,
      firebase: firebaseSiap,
      midtrans: midtransSiap,
      panelAuth: panelAuthSiap,
    },

    /*
     * Allow-list **setelah** dilengkapi skema — persis yang dibandingkan
     * terhadap `Origin` dari browser.
     *
     * Ini yang membuat kesalahan ketik bisa dilihat. allow-list `prabawa.vercel.app`
     * dan `Origin: https://prabawa.vercel.app` terlihat berbeda di teks, tapi
     * setelah normalisasi keduanya jelas sama, dan operator tahu apa yang
     * sebenarnya dibandingkan.
     */
    origin: {
      diterima: req.headers?.origin ?? null,
      diizinkan: daftarOrigin(),
    },

    // Peringatan yang bisa langsung dikerjakan. Kosong bila semuanya beres.
    peringatan: [
      ...(originKosong
        ? [`ALLOWED_ORIGINS belum diisi — ${PETUNUK_KONFIGURASI}`]
        : []),
      ...(firebaseSiap
        ? []
        : [
            'Kredensial Firebase Admin belum diisi — endpoint aktivasi akan menjawab 503 ' +
              'sampai FIREBASE_SERVICE_ACCOUNT (JSON inline) atau GOOGLE_APPLICATION_CREDENTIALS diisi.',
          ]),
      ...(midtransSiap
        ? []
        : ['MIDTRANS_SERVER_KEY belum diisi — metode QRIS otomatis disembunyikan dari pengguna.']),
      ...(panelAuthSiap
        ? []
        : panelSecret
          ? [
              'PANEL_SESSION_SECRET belum diisi atau terlalu pendek (minimal 32 karakter) — ' +
                'seluruh login panel akan ditolak dengan 503 sampai variabel ini diisi.',
            ]
          : ['PANEL_SESSION_SECRET belum diisi — seluruh login panel akan ditolak dengan 503.']),
    ],
  });
}
