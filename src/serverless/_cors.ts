/**
 * Pemeriksa asal request — dipakai semua serverless function.
 *
 * ## Kenapa harus ada
 *
 * Tanpa pemeriksaan ini, `Access-Control-Allow-Origin: *` membuat endpoint
 * bisa dipanggil dari **halaman mana pun di internet**. Siapa pun yang
 * membaca sumber halaman Anda (atau menebak URL-nya) bisa memakai proxy
 * JSON-RPC dan route pembayaran dari domain mereka sendiri.
 *
 * Untuk `/api/rpc` dampaknya nyata: hostname dan TechMark server Anda
 * tercatat sebagai pemanggil di log gateway pusat, dan alamat IP Anda jadi IP
 * yang membawa seluruh request absensi.
 *
 * Yang diperiksa:
 * - `Origin` harus ada di `ALLOWED_ORIGINS`, atau
 * - tidak ada `Origin` sama sekali (curl, native app, health check) —
 *   ini bukan browser, jadi tidak bisa cross-origin lewat JavaScript.
 *
 * Pengecualian Allow-Origin untuk request tanpa origin **sengaja tidak
 * ada**: di browser, `fetch` lintas origin selalu mengirim `Origin`, jadi
 * allow-list ini tidak memotong pemakaian normal.
 *
 * ## `ALLOWED_ORIGINS` tanpa skema — bug yang sudah nyata terjadi
 *
 * `.env` pernah berisi:
 *
 *     ALLOWED_ORIGINS=prabawa.vercel.app
 *
 * sementara browser mengirim:
 *
 *     Origin: https://prabawa.vercel.app
 *
 * Perbandingan string tidak akan pernah cocok, dan **setiap** request dari
 * peramban ditolak 403. Gejalanya sangat menyesatkan: server "sehat",
 * halaman termuat, login berhasil, tapi tidak satu pun panggilan API jalan —
 * dan penyebabnya tidak pernah muncul di mana pun.
 *
 * Skema yang hilang karena itu dilengkapi di sini. Pelengkapannya aman:
 * `prabawa.vercel.app` menjadi `https://prabawa.vercel.app` — tidak ada origin
 * lain yang ikut diterima. Yang tetap ditolak tetap ditolak.
 *
 * Karena itu bentuk yang sudah dinormalisasi juga dilaporkan di
 * `/api/health`, supaya operator melihat **persis** apa yang dibandingkan,
 * bukan apa yang mereka kira they've ketik.
 */

/** Host yang sering dipakai tanpa skema di server lokal. */
const HOST_LOKAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Lengkapi origin yang ditulis tanpa skema.
 *
 * - `localhost` / `127.0.0.1` → `http://` (dipakai server dev).
 * - selain itu → `https://`. Aman: menambahkan skema hanya mempersempit
 *   apa yang diterima, tidak pernah memperlebar.
 */
function lengkapiSkema(origin: string): string {
  if (origin.includes('://')) return origin;
  if (origin === '*') return origin;
  const denganPort = /^[^/:]+:\d+$/.test(origin); // "localhost:3000"
  if (HOST_LOKAL.test(origin) || denganPort && HOST_LOKAL.test(origin.split(':')[0])) {
    return `http://${origin}`;
  }
  return `https://${origin}`;
}

/** Allow-list dari env, sudah dibersihkan dan dilengkapi skemanya. */
export function daftarOrigin(): string[] {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(lengkapiSkema);
}

/**
 * Origin milik deployment ini sendiri.
 *
 * ⚠️ Ditambahkan supaya preview deployment tidak selalu 403. Setiap build
 * Vercel punya domain yang **berbeda** dari produksi — `prabawa-<hash>.vercel.app`
 * — dan nama itu baru diketahui setelah deploy selesai. Kalau allow-list hanya
 * berisi domain produksi, setiap preview deployment langsung tidak bisa
 * dipakai: halamannya termuat, tapi tiap panggilan API mendapat 403, dan
 * gejalanya tidak menyuruh siapa pun curiga pada allow-list.
 *
 * Domain sendiri aman diterima tanpa syarat tambahan: deployment hanya
 * melayani permintaannya sendiri, dan nilainya diisi platform — bukan oleh
 * pengguna — jadi tidak bisa dipakai untuk membuka akses ke domain lain.
 *
 * `VERCEL_BRANCH_URL` ikut dibaca supaya preview yang punya alias
 * branch-domain pun tercakup.
 */
function originMilikSendiri(): string[] {
  const asal: string[] = [];
  for (const nama of ['VERCEL_URL', 'VERCEL_BRANCH_URL']) {
    const nilai = process.env[nama];
    if (!nilai) continue;
    asal.push(lengkapiSkema(String(nilai).trim()));
  }
  return asal;
}

/**
 * True bila request boleh lewat.
 *
 * `ALLOWED_ORIGINS=*` melonggarkan seluruhnya — hanya untuk pengembangan.
 *
 * Perbandingan dilakukan setelah kedua sisi dilewatkan `lengkapiSkema()`,
 * jadi `prabawa.vercel.app` di env tetap cocok dengan
 * `https://prabawa.vercel.app` dari browser. Host di browser selalu huruf
 * kecil, jadi sisi allow-list ikut diturunkan hurufnya.
 */
function asalDiizinkan(origin: string | undefined): boolean {
  if (!origin) return true;
  const cari = lengkapiSkema(origin.trim()).toLowerCase();

  if (originMilikSendiri().some(item => item.toLowerCase() === cari)) return true;

  const daftar = daftarOrigin();
  if (daftar.includes('*')) return true;
  return daftar.some(item => item.toLowerCase() === cari);
}

/**
 * True bila allow-list sama sekali belum diisi.
 *
 * ⚠️ Tidak ada nilai bawaan di sini, dan itu memang pilihan yang benar. Tapi
 * konsekuensinya harus terlihat: tanpa `ALLOWED_ORIGINS`, **setiap** request
 * peramban ditolak dengan 403 yang sama bentuknya dengan "halaman ini bukan
 * milik Anda", padahal penyebabnya konfigurasi yang belum diisi.
 *
 * `src/api/server.ts` (dev server) punya bawaan localhost; file ini tidak,
 * karena di produksi "localhost" bukan asal yang sah. Karena itu `/api/health`
 * melaporkan allow-list kosong sebagai peringatan, bukan sekadar "server
 * hidup".
 */
export function allowListKosong(): boolean {
  return daftarOrigin().length === 0;
}

/** Petunjuk perbaikan, hanya untuk operator. */
export const PETUNUK_KONFIGURASI =
  'Isi environment variable ALLOWED_ORIGINS di dashboard Vercel ' +
  '(Settings → Environment Variables), berisi domain aplikasimu, ' +
  'pisah koma kalau lebih dari satu. Contoh: https://app.example.go.id';

/**
 * Terapkan header CORS sesuai hasil pemeriksaan.
 *
 * Mengembalikan `false` kalau origin ditolak — pemanggil harus langsung
 * membalas 403 sebelum menyentuh apa pun yang mahal.
 */
export function terapkanCors(
  res: { setHeader(name: string, value: string): void },
  origin: string | undefined
): boolean {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  /*
   * ⚠️ `Authorization` wajib ada di sini, bukan hanya di `_panel.ts`.
   *
   * Preflight CORS memeriksa daftar header yang boleh dikirim browser. Kalau
   * `Authorization` tidak ada di respons preflight, browser **membuang**
   * header itu sebelum request dikirim — dan pemanggil hanya melihat
   * "CORS error", padahal server-nya tidak pernah menerima token sama sekali.
   *
   * Daftar header yang terlalu luas tidak membuka akses apa pun: browser
   * tetap hanya bisa mengirim header yang diizinkan skripnya, dan
   * `Access-Control-Allow-Headers` bukan kontrol akses. Yang mengendalikan
   * adalah `Access-Control-Allow-Origin` di bawah.
   */
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');

  if (!asalDiizinkan(origin)) {
    // Tidak ada `Access-Control-Allow-Origin` sama sekali → browser
    // memblokir respons, dan pemanggil melihat error CORS.
    return false;
  }

  // `*` hanya aman karena request tanpa `Origin` (curl/native) tidak
  // bisa di-trigger lintas origin dari peramban.
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  return true;
}
