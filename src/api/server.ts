/**
 * Dev / self-hosted server.
 *
 * Menjalankan Express yang:
 *   1. Menyediakan /api/rpc — proxy JSON-RPC ke server pusat.
 *   2. Menyediakan /api/upload — proxy multipart lampiran izin.
 *   3. Melayani SPA hasil `vite build` (mode production) atau
 *      Vite dalam middlewareMode (mode development).
 *
 * Logika /api/rpc sengaja dibuat identik dengan api/rpc.ts (Vercel)
 * supaya front-end tidak perlu tahu sedang berada di mana.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  PRESENSI_VERSION as VERIFIED_PRESENSI_VERSION,
  PRESENSI_IMPORTFILE_PATH,
  INJECTED_PARAM_KEYS,
  buildRpcEnvelope,
  cuplikanAman,
  galatHulu,
  type RpcResponse,
} from '../lib/presensiContract';
import { APP_FULL_NAME } from '../lib/appIdentity';
import { midtransBaseUrl } from '../lib/midtransEnv';
/*
 * Normalisasi Origin yang sama persis dengan yang dipakai function Vercel.
 *
 * `api/_cors.ts` sengaja tidak mengimpor apa pun supaya tetap bisa dipakai
 * tanpa bundling frontend, dan server ini berjalan sebagai proses Node
 * terpisah — jadi satu-satunya tempat yang boleh dipakai berdua adalah
 * implementasi small-nya di sini.
 *
 * Aturannya: skema yang hilang dilengkapi (`prabawa.vercel.app` ->
 * `https://prabawa.vercel.app`, `localhost:3000` -> `http://localhost:3000`).
 * Melengkapi skema hanya mempersempit apa yang diterima, tidak pernah
 * memperlebar, jadi tidak meng-longgarkan proteksi.
 */
function lengkapiSkema(origin: string): string {
  if (!origin || origin === '*' || origin.includes('://')) return origin;
  const hostLokal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  const hostLokalDenganPort = /^[^/:]+:\d+$/.test(origin) &&
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(origin.split(':')[0]);
  return hostLokal || hostLokalDenganPort ? `http://${origin}` : `https://${origin}`;
}

/**
 * Direktori modul ini, aman untuk ESM (tsx / vite) maupun bundel CJS
 * (`esbuild --format=cjs`, lihat script "build") yang tidak menyediakan
 * `import.meta.url`.
 */
const moduleDir = (() => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // jatuh ke __dirname di bawah
  }
  return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
})();

/** Naik sampai menemukan folder yang memuat package.json (akar proyek). */
function findProjectRoot(from: string): string {
  let current = path.resolve(from);
  for (let depth = 0; depth < 8; depth++) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(from, '..', '..');
}

// ─── Konfigurasi ──────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3000);

const PRESENSI_SERVICE_URL =
  process.env.PRESENSI_BASE_URL || 'https://presensi.bkd.jatimprov.go.id/service';

/**
 * URL unggah lampiran izin.
 *
 * ⚠️ Diturunkan dari `PRESENSI_SERVICE_URL`, **bukan** dari konstanta
 * `PRESENSI_IMPORTFILE_URL` di kontrak. Alasannya: `PRESENSI_BASE_URL`
 * adalah titik injeksi untuk uji — kalau route ini memakai konstanta kontrak,
 * `PRESENSI_BASE_URL` hanya berlaku untuk `/api/rpc` sedangkan
 * `/api/upload` tetap menembak gateway produksi. Bug itu sempat
 * terlihat saat skrip uji: stub lokal merekam 0 request.
 */
const PRESENSI_IMPORTFILE_URL = `${PRESENSI_SERVICE_URL}${PRESENSI_IMPORTFILE_PATH}`;

/**
 * Versi klien yang dikirim ke gateway.
 *
 * Default diambil dari kontrak terverifikasi (`PRESENSI_VERSION` = 89,
 * versionCode APK 1.11.21) agar tidak ada angka yang melenceng di dua
 * tempat. Gate versi server mulai dari 81 — angka lebih rendah membuat
 * absen/cekabsen/add_ijin ditolak dengan "aplikasi terbaru telah tersedia".
 */
const PRESENSI_VERSION = Number(process.env.PRESENSI_VERSION || VERIFIED_PRESENSI_VERSION);

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;

/*
 * Allow-list Origin, dibandingkan dengan aturan yang SAMA dengan
 * `api/_cors.ts` (Vercel).
 *
 * Semula server dev membandingkan string apa adanya, jadi
 * `ALLOWED_ORIGINS=prabawa.vercel.app` — tanpa `https://` — tidak pernah
 * cocok dengan `Origin: https://prabawa.vercel.app` yang dikirim browser.
 * Gejalanya: development jalan saat allow-list masih localhost, lalu begitu
 * domain produksi diisi, **semua** request ditolak dan tidak ada yang
 * menyuruh mencari tahu kenapa.
 *
 * Sekarang `lengkapiSkema` dipakai di kedua tempat, jadi apa yang ditulis di
 * `.env` dan di dashboard Vercel berperilaku identik. Perbedaan sisa
 * yang disengaja: hanya server dev yang punya nilai bawaan localhost.
 */
const BAVAAN_DEV = 'http://localhost:3000,http://localhost:5173';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || BAVAAN_DEV)
  .split(',')
  .map(origin => lengkapiSkema(origin.trim()))
  .filter(Boolean);

const originDiizinkan = (origin: string | undefined): boolean => {
  if (!origin) return true; // curl / native app / health check
  if (ALLOWED_ORIGINS.includes('*')) return true;
  const cari = lengkapiSkema(origin.trim()).toLowerCase();
  return ALLOWED_ORIGINS.some(item => item.toLowerCase() === cari);
};

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=UTF-8',
  Accept: 'application/json',
  'User-Agent': 'okhttp/4.12.0',
  'Accept-Encoding': 'gzip',
};

const isProd = process.env.NODE_ENV === 'production';

/**
 * Retry dengan timeout per percobaan dan backoff linear.
 * Mirip DefaultRetryPolicy(15000, 1, 1.0f) yang dipakai Volley di HomeVM.
 */
async function fetchWithRetryAndTimeout(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.status < 500 && response.status !== 429) {
        return response;
      }
      lastError = new Error(`Upstream HTTP ${response.status}`);
      if (attempt === retries) return response;
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    } finally {
      clearTimeout(timer);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 800 + 400));
  }

  throw lastError instanceof Error ? lastError : new Error('Gagal menghubungi server pusat');
}

/**
 * Jalankan server proxy + penyaji front-end.
 *
 * Diekspor supaya bisa dipanggil skrip uji tanpa menyalakan listener
 * diam-diam (lihat `tools/cek-proxy-absen.mjs`).
 */
export async function startServer() {
  const app = express();

  /*
   * `req.ip` harus berasal dari rantai proxy, bukan dari socket.
   *
   * Tanpa ini, Express memakai alamat socket — yaitu proxy di depannya — jadi
   * semua permintaan dari satu jaringan terlihat berasal dari satu IP, dan
   * pembatas percobaan login ikut mengunci seluruh kantor begitu satu orang
   * di dalamnya salah lima kali.
   *
   * `true` berarti seluruh rantai `X-Forwarded-For` dipercaya. Itu tepat di
   * belakang reverse proxy (Vercel, Nginx, Cloudflare) dan di server
   * pengembangan. Kalau server ini nanti dijalankan langsung menghadap
   * internet tanpa proxy, ubah ke `1` (atau hapus baris ini) — dengan
   * `true`, klien yang menulis sendiri header itu bisa mengarang IP-nya dan
   * melewati pembatas percobaan.
   */
  app.set('trust proxy', true);

  // ─── CORS dengan allow-list ─────────────────────────────────────────
  app.use(
    cors({
      origin: (origin, callback) => {
        if (originDiizinkan(origin)) return callback(null, true);
        // Pesannya menyebut allow-list yang aktif, supaya kesalahan ketik di
        // `.env` langsung terlihat di log server — bukan hanya "ditolak".
        return callback(
          new Error(
            `Origin tidak diizinkan: ${origin}. Allow-list aktif: ${ALLOWED_ORIGINS.join(', ') || '(kosong)'}` +
              (origin && !origin.includes('://') ? ' — Origin dari browser selalu memakai skema.' : '')
          )
        );
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
    })
  );

  /*
   * Batas body **per route**, bukan global.
   * Semula `app.use(express.json({ limit: '50mb' }))` dipasang sekali untuk
   * seluruh aplikasi, dengan alasan "foto base64 bisa besar". Masalahnya
   * alasan itu hanya berlaku untuk satu route: `/api/rpc` yang mengirim
   * `update_foto` (base64 foto) dan `vektor`. Empat route lain —
   * `panel-auth`, `billing/aktivasi`, `midtrans-charge`, dan `health` — hanya
   * menerima form kecil, tapi tetap memberi izin 50 MB di memori server untuk
   * setiap permintaan, dari klien mana pun, sebelum authenticate.
   *
   * Batas 12 MB untuk `/api/rpc` dipilih dari angka nyata: foto maksimum 3 MB
   * (`MAX_PHOTO_BYTES` di `ProfilServerModal`) jadi sekitar 4 MB base64, plus
   * `vektor` dan envelope-nya — sisanya dipakai sebagai cadangan. Lampiran
   * yang lebih besar tidak lewat sini: `POST /api/upload` punya jalurnya sendiri
   * dengan batas 20 MB dan tipe `multipart/form-data`.
   */
  const BATAS_JSON_KECIL = '64kb';
  const BATAS_JSON_RPC = '12mb';
  const bodyKecil = express.json({ limit: BATAS_JSON_KECIL });

  // ─── Proxy JSON-RPC ─────────────────────────────────────────────────
  app.post('/api/rpc', express.json({ limit: BATAS_JSON_RPC }), async (req, res) => {
    try {
      const { object, param } = (req.body ?? {}) as {
        object?: string;
        param?: Record<string, unknown>;
      };

      if (!object || typeof object !== 'string') {
        return res.status(400).json({ error: 'Field "object" (nama RPC) wajib diisi.' });
      }
      if (!/^[a-z0-9_]{2,40}$/i.test(object)) {
        return res.status(400).json({ error: 'Nama RPC tidak valid.' });
      }

      const incomingParam = (param && typeof param === 'object' ? param : {}) as Record<string, unknown>;

      // Sama seperti RestServices.insertAuthorizationInterceptor.
      //
      // `imei` WAJIB ada di `login` — menghilangkannya membuat server
      // membalas `-32602 Invalid params`. Nilai yang benar diteruskan
      // apa adanya; hanya string kosong yang diganti TechMark proses ini
      // (dipakai sebagai pengenal perangkat, bukan rahasia).
      //
      // ⚠️ Untuk akun yang masih terkunci ke satu perangkat, TechMark ini
      // PASTI tidak cocok dan server membalas 402. Itu bukan bug proxy:
      // pengguna harus mengisinya lewat kolom IMEI Perangkat di Beranda.
      const imeiDiminta = incomingParam.imei;
      /*
       * Ketiga kunci disuntik dari `INJECTED_PARAM_KEYS`, bukan ditulis
       * satu per satu.
       *
       * Versi sebelumnya menulis `api_key`, `last_latlong`, dan `imei`
       * sebagai key literal — di sini, di `api/rpc.ts`, dan di
       * `withContext()` pada `apiCalls.ts`. Tiga salinan dari satu fakta
       * kontrak: kalau server menambah kunci keempat, atau salah satu
       * nama berubah, hanya satu dari tiga yang ikut diperbarui dan
       * sisanya diam-diam terus mengirim bentuk lama.
       *
       * `INJECTED_PARAM_KEYS` adalah daftar dari `presensiContract.ts`,
       * jadi sekarang menambah kunci cukup di satu tempat.
       */
      const disuntik: Record<string, unknown> = {
        api_key: incomingParam.api_key ?? '',
        last_latlong: incomingParam.last_latlong ?? '',
        // Diteruskan apa adanya, termasuk string kosong. Lihat catatan
        // yang sama di `src/serverless/rpc.ts`: identitas perangkat
        // dibuat di klien, satu per akun per peramban — bukan satu UUID
        // yang dibagi ke semua orang dari environment variable.
        imei: typeof imeiDiminta === 'string' ? imeiDiminta : '',
      };
      const mergedParam: Record<string, unknown> = { ...incomingParam };
      for (const kunci of INJECTED_PARAM_KEYS) mergedParam[kunci] = disuntik[kunci];

      // Bentuk envelope ditentukan `buildRpcEnvelope`, sama seperti
      // `api/rpc.ts` — bukan disusun ulang di sini.
      const envelope: Record<string, unknown> = {
        ...buildRpcEnvelope(object, mergedParam),
      };

      const upstream = await fetchWithRetryAndTimeout(PRESENSI_SERVICE_URL, {
        method: 'POST',
        headers: BASE_HEADERS,
        body: JSON.stringify(envelope),
      });

      const rawText = await upstream.text();

      /*
       * `RpcResponse` dari kontrak, bukan `any`.
       *
       * `any` membuat setiap akses ke `parsed.…` lolos pemeriksaan tipe,
       * termasuk `parsed.jsonrpc` yang di bawah dikembalikan ke klien sebagai
       * nomor versi JSON-RPC. Dengan bentuk kontrak yang di sini, field yang
       * tidak ada di balasan gateway akan terlihat di `tsc`, bukan muncul
       * sebagai `undefined` yang diteruskan ke peramban.
       *
       * `JSON.parse` tetap perlu `unknown` → bentuk kontrak, karena JSON
       * apa pun bisa datang dari sana; yang dijamin hanya bahwa parse itu
       * menghasilkan bentuk yang diharapkan, atau nol bila JSON-nya rusak.
       */
      let parsed: RpcResponse & { error?: unknown } | null = null;
      try {
        parsed = JSON.parse(rawText) as RpcResponse & { error?: unknown };
      } catch {
        return res
          .status(upstream.status >= 500 ? 503 : 502)
          .json(galatHulu(upstream.status, rawText, cuplikanAman));
      }

      // Ratakan error gateway jadi string + kode terpisah supaya sisi
      // klien bisa menampilkannya tanpa "[object Object]".
      // Kode penting: -32601 object mati, -32602 param salah,
      // -32604 token invalid, 401 NIP salah, 402 akun terkunci ke device lain.
      const upstreamError = parsed.error as
        | { code?: number; message?: string }
        | string
        | undefined;
      const errorCode =
        typeof upstreamError === 'object' && upstreamError ? upstreamError.code : undefined;
      const errorMessage =
        typeof upstreamError === 'string'
          ? upstreamError
          : upstreamError?.message ?? 'Permintaan ditolak server pusat.';

      return res.status(200).json({
        jsonrpc: parsed.jsonrpc ?? 2,
        id_req: parsed.id_req ?? '',
        result: parsed.result ?? null,
        total: parsed.total,
        page: parsed.page,
        view: parsed.view,
        ...(upstreamError ? { error: errorMessage, errorCode } : {}),
      });
    } catch (err: any) {
      console.error('Proxy rpc error:', err);
      const aborted = err?.name === 'AbortError';
      return res.status(aborted ? 504 : 502).json({
        error: aborted
          ? 'Server pusat tidak merespons dalam batas waktu.'
          : `Gagal menghubungi server pusat: ${err?.message ?? 'tidak diketahui'}`,
      });
    }
  });

  // ─── Proxy multipart (POST /service/importfile) ────────────────────
  // Satu-satunya endpoint pusat yang BUKAN JSON-RPC: lampiran pengajuan
  // izin. Bentuknya disalin dari
  // `PerizinanFragment$uploadImage$multipartRequest$1` (APK v89).
  //
  // ⚠️ Endpoint ini belum terverifikasi di sisi server (ENDPOINT.md §2.1).
  // Path-nya hidup — 200 + JSON-RPC, bukan 404 seperti path karangan — tapi
  // gateway menjawab `-32605 Invalid Request` untuk semua variasi body yang
  // dicoba. Route ini karena itu meneruskan dan melaporkan apa adanya;
  // pemanggil wajib memperlakukan unggahan sebagai operasi yang bisa gagal.
  //
  // Body diteruskan apa adanya — tidak didecode — supaya boundary, nama
  // field, dan filename persis seperti yang dibuat browser. Decoding lalu
  // encode-ulang justru berisiko merusak part berkas.
  app.post(
    '/api/upload',
    express.raw({ type: 'multipart/form-data', limit: '20mb' }),
    async (req, res) => {
      try {
        const requested = String(req.query.path ?? '');

        // Allow-list ketat: route ini jangan sampai jadi open proxy.
        if (requested !== PRESENSI_IMPORTFILE_PATH) {
          return res.status(400).json({
            error: `Path "${requested}" tidak diizinkan. Hanya ${PRESENSI_IMPORTFILE_PATH} yang didukung.`,
          });
        }

        const contentType = req.get('content-type') ?? '';
        if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
          return res
            .status(400)
            .json({ error: 'Endpoint ini hanya menerima multipart/form-data.' });
        }

        const body = req.body as Buffer;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          return res.status(400).json({ error: 'Body multipart kosong.' });
        }

        const upstream = await fetchWithRetryAndTimeout(PRESENSI_IMPORTFILE_URL, {
          method: 'POST',
          headers: {
            // Boundary milik client, jadi header ini diteruskan utuh.
            'Content-Type': contentType,
            Accept: 'application/json',
            'User-Agent': 'okhttp/4.12.0',
            'Accept-Encoding': 'gzip',
          },
          // Body diteruskan sebagai ArrayBuffer agar tidak disalin ulang;
          // byte-nya identik dengan yang dikirim browser.
          body: new Uint8Array(body),
        });

        const rawText = await upstream.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          return res
            .status(upstream.status >= 500 ? 503 : 502)
            .json(galatHulu(upstream.status, rawText, cuplikanAman));
        }

        // Selalu HTTP 200 ke klien; kode gateway dibawa di `errorCode`,
        // sama seperti route /api/rpc.
        return res.status(200).json({
          result: parsed?.result ?? null,
          error: parsed?.error ?? null,
          errorCode: parsed?.error?.code ?? null,
          upstreamStatus: upstream.status,
        });
      } catch (err: any) {
        console.error('Proxy upload error:', err);
        const aborted = err?.name === 'AbortError';
        return res.status(aborted ? 504 : 502).json({
          error: aborted
            ? 'Server pusat tidak merespons dalam batas waktu.'
            : `Gagal menghubungi server pusat: ${err?.message ?? 'tidak diketahui'}`,
        });
      }
    }
  );

  // ─── Pembayaran: Midtrans Core API ──────────────────────────────────
  //
  // ⚠️ `Server Key` TIDAK PERNAH sampai ke peramban. Route di bawah satu-
  //-satunya pembaca `MIDTRANS_SERVER_KEY`; logika dan pesan errornya
  // identik dengan `api/midtrans-charge.ts` (Vercel) supaya front-end
  // tidak perlu tahu sedang dilayani Express atau Vercel.
  //
  // CORS sudah ditangani oleh middleware global di atas — termasuk
  // penolakan origin yang tidak ada di allow-list.
  const midtransServerKey = process.env.MIDTRANS_SERVER_KEY || '';
  // Mode produksi/sandbox dari satu sumber — lihat `lib/midtransEnv.ts`.
  const midtransBase = midtransBaseUrl;

  app.post('/api/midtrans-charge', bodyKecil, async (req, res) => {
    if (!midtransServerKey) {
      return res.status(500).json({
        error_messages: [
          'Server misconfiguration: MIDTRANS_SERVER_KEY tidak ditemukan. Isi di file .env lalu restart server.',
        ],
      });
    }

    // Wajib ada `order_id` — tanpa itu Midtrans menolak.
    const body = req.body as any;
    if (!body?.transaction_details?.order_id) {
      return res
        .status(400)
        .json({ error_messages: ['transaction_details.order_id wajib diisi.'] });
    }

    const auth = Buffer.from(`${midtransServerKey}:`).toString('base64');
    try {
      const upstream = await fetchWithRetryAndTimeout(`${midtransBase()}/v2/charge`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(body),
      });

      const text = await upstream.text();
      let data: any;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        return res
          .status(502)
          .json({ error_messages: ['Respons tidak valid dari Midtrans (bukan JSON).'] });
      }

      // Midtrans memakai `status_code` 200/201/202 untuk sukses.
      /*
       * Hanya `error_messages` yang diteruskan — **bukan** badan respons utuh.
       *
       * Semula ada `raw: data` di sini. Tidak ada satu pun pemanggil yang
       * membacanya (grep di `src/lib/midtrans.ts` dan
       * `src/lib/aktivasiLangganan.ts` kosong), jadi ia tidak pernah dipakai —
       * sementara isinya seluruh balasan Midtrans, termasuk `bank_details`,
       * nomor Virtual Account, dan `expiry_time`. Untuk kasus gagal, isinya
       * bisa apa saja yang dikembalikan layanan pembayaran; meneruskannya
       * hanya membuka informasi yang tidak perlu diketahui peramban.
       *
       * Yang dibutuhkan layar sudah ada di `error_messages`.
       */
      const sukses = ['200', '201', '202'].includes(String(data.status_code));
      if (!sukses) {
        return res.status(422).json({
          error_messages: [
            data.error_messages?.[0] ||
              data.status_message ||
              `Gagal memproses (status: ${data.status_code})`,
          ],
        });
      }

      return res.status(200).json(data);
    } catch (err: any) {
      const pesan = err?.message ?? 'tidak diketahui';
      return res
        .status(500)
        .json({ error_messages: [`Gagal terhubung ke server pembayaran: ${pesan}`] });
    }
  });

  // ─── Aktivasi langganan (server-side) ──────────────────────────────
  //
  // ⚠️ Ini satu-satunya jalur yang boleh menulis `jatim_langganan` dan
  //    `jatim_tagihan` dari sisi server. Klien **tidak** bisa menulis
  //    dokumen itu sendiri (lihat `firestore.rules`), jadi mengedit
  //    `masaAkhir` lewat DevTools tidak ada efeknya.
  //
  // ⚠️ Token panel **wajib**. `aktifkanLangganan()` membaca nama akun dari
  //    token, jadi `username` di body diabaikan. Tanpa ini, siapa pun yang
  //    tahu URL endpoint bisa mengaktifkan langganan akun mana pun tanpa
  //    pernah login — gerbang langganan sendiri hanya tampil setelah login
  //    panel berhasil, jadi tidak ada pemanggil sah yang kehilangan
  //    kemampuannya untuk membayar.
  //
  // Rate limit 20 permintaan per menit per IP. Tanpa itu, endpoint ini bisa
  // dipakai untuk membanjiri Midtrans dengan pengecekan status (dan memakai
  // kuota API merchant Anda).
  const aktivasiRiwayat = new Map<string, { jumlah: number; mulai: number }>();
  const BATAS_AKTIVASI = 20;
  const JENDALA_AKTIVASI_MS = 60_000;

  app.post('/api/billing/aktivasi', bodyKecil, async (req, res) => {
    // Rate limit dievaluasi sebelum apa pun yang mahal.
    const ip = (req.ip || req.socket.remoteAddress || 'tak-diketahui').toString();
    const sekarangMs = Date.now();
    const catat = aktivasiRiwayat.get(ip);
    if (catat && sekarangMs - catat.mulai < JENDALA_AKTIVASI_MS) {
      if (catat.jumlah >= BATAS_AKTIVASI) {
        const tunggu = Math.ceil((JENDALA_AKTIVASI_MS - (sekarangMs - catat.mulai)) / 1000);
        res.setHeader('Retry-After', String(tunggu));
        return res.status(429).json({
          ok: false,
          pesan: `Terlalu banyak permintaan. Coba lagi dalam ${tunggu} detik.`,
        });
      }
      catat.jumlah += 1;
    } else {
      aktivasiRiwayat.set(ip, { jumlah: 1, mulai: sekarangMs });
    }

    // `firebase-admin` dimuat saat route ini dipanggil, bukan di atas.
    //
    // Alasannya nyata: `firebase-admin` menarik `@google-cloud/firestore`
    // yang harus terpasang terpisah, dan mengimpornya di modul atas
    // membuat **seluruh** server gagal start di mesin yang belum
    // memasangnya — termasuk yang tidak pernah menyentuh pembayaran.
    let aktifkanLangganan: typeof import('../lib/serverBilling')['aktifkanLangganan'];
    let adminTersedia: typeof import('../lib/serverBilling')['adminTersedia'];
    try {
      ({ aktifkanLangganan, adminTersedia } = await import('../lib/serverBilling'));
    } catch (err: any) {
      return res.status(503).json({
        ok: false,
        pesan: `firebase-admin belum terpasang di server: ${err?.message ?? 'tidak diketahui'}. Jalankan: npm install firebase-admin`,
      });
    }

    if (!adminTersedia()) {
      return res.status(503).json({
        ok: false,
        pesan:
          'Server belum dikonfigurasi untuk menulis langganan. Isi FIREBASE_SERVICE_ACCOUNT (atau GOOGLE_APPLICATION_CREDENTIALS) lalu restart.',
      });
    }

    const { orderId, metode, nominal } = (req.body ?? {}) as {
      orderId?: string;
      metode?: string;
      nominal?: number;
    };

    const authHeader = String(req.headers.authorization ?? '').trim();
    const token = /^bearer\s+/i.test(authHeader)
      ? authHeader.replace(/^bearer\s+/i, '').trim()
      : typeof (req.body as Record<string, unknown> | undefined)?.token === 'string'
        ? String((req.body as Record<string, unknown>).token).trim()
        : '';

    try {
      const hasil = await aktifkanLangganan(token, {
        orderId: String(orderId ?? ''),
        metode: (metode === 'qris' || metode === 'transfer' ? metode : 'qris_midtrans') as
          | 'qris'
          | 'transfer'
          | 'qris_midtrans',
        nominalKlien: typeof nominal === 'number' ? nominal : undefined,
      });
      return res.status(hasil.ok ? 200 : hasil.kode ?? 400).json(hasil);
    } catch (err: any) {
      console.error('Aktivasi langganan gagal:', err);
      return res.status(500).json({ ok: false, pesan: 'Gagal memproses pembayaran di server.' });
    }
  });

  // ─── Autentikasi & otorisasi panel ─────────────────────────────────
  //
  // Satu route untuk semua operasi (login, verifikasi sesi, kelola akun,
  // kredensial server). Handler-nya sama persis dengan yang dipakai function
  // Vercel — `src/serverless/_panel.ts` — supaya dev dan produksi tidak bisa
  // berbeda perilaku dalam hal yang paling menentukan: siapa yang dianggap
  // admin.
  //
  // Middleware CORS global di atas sudah menolak origin asing, jadi handler
  // cukup menerima route-nya.
  app.post('/api/panel-auth', bodyKecil, async (req, res) => {
    try {
      const { tanganiPanelAuth } = await import('../serverless/_panel');
      return await tanganiPanelAuth(req, res);
    } catch (err: any) {
      console.error('Panel auth gagal:', err);
      return res.status(500).json({ ok: false, kode: 500, pesan: 'Gagal memproses di server.' });
    }
  });

  // ─── Health check ───────────────────────────────────────────────────
  app.get('/api/health', async (_req, res) => {
    /*
     * `panelAuth` sengaja dihitung lewat `process.env` langsung, bukan lewat
     * `ringkasanPanelAuth()` dari `lib/panelServer.ts`. Modul itu menarik
     * `lib/userManager` → `lib/pin` → bcrypt, dan health check tidak boleh
     * menarik dependensi itu hanya untuk membaca satu environment variable.
     * Yang dilaporkan hanya boolean — panjang secret tidak pernah keluar.
     */
    const secret = (process.env.PANEL_SESSION_SECRET ?? '').trim();
    res.json({
      ok: true,
      service: PRESENSI_SERVICE_URL,
      version: PRESENSI_VERSION,
      // Hanya boolean, bukan key — jangan pernah bocorkan lewat health check.
      midtrans: Boolean(midtransServerKey),
      panelAuth: secret.length >= 32,
    });
  });

  // ─── Frontend ───────────────────────────────────────────────────────
  // src/api/server.ts di-bundle ke <root>/dist/server.cjs saat build, dan
  // berjalan langsung dari src/api saat dev. Cari akar proyek (folder
  // yang memuat package.json) supaya keduanya bisa menemukan dist/.
  const root = findProjectRoot(moduleDir);
  const distDir = path.join(root, 'dist');

  if (isProd && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    // Express 5 memakai path-to-regexp v8: '*' tidak lagi sah, harus '/*splat'.
    app.get('/*splat', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // `NODE_ENV=test` → jangan dengarkan socket; pemanggil yang
  // memegang instance Express sendiri, supaya skrip uji bisa mengambil
  // port acak.
  if (process.env.NODE_ENV === 'test') return app;

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ${APP_FULL_NAME} (PRABAWA) — server berjalan di http://localhost:${PORT}`);
    console.log(`  Mode            : ${isProd ? 'production' : 'development'}`);
    console.log(`  Gateway pusat   : ${PRESENSI_SERVICE_URL} (v${PRESENSI_VERSION})`);
    console.log(`  Origin diizinkan: ${ALLOWED_ORIGINS.join(', ')}\n`);
  });
  return app;
}

// Jangan menyalakan server saat modul ini diimpor (skrip uji).
if (process.env.NODE_ENV !== 'test') {
  startServer();
}
