/**
 * Handler OCR captcha (model ONNX ddddocr) — **sumber, tidak lagi di-deploy**.
 *
 * Request : POST /api/ocr
 *   Body  : byte gambar captcha (GIF/PNG/JPG), Content-Type bebas
 * Response: { ok: true, text: "1234", kandidat: [...], yakin: true }
 *
 * ## Kenapa tidak jadi Vercel Function lagi
 *
 * Handler ini menarik `onnxruntime-node`, yang ukurannya **844 MB** di
 * `node_modules` (662 MB-nya `libonnxruntime_providers_cuda.so`, yang tidak
 * pernah dipakai karena OCR jalan `executionProviders: ['cpu']`). Itulah penyebab
 * storage Function Vercel melonjak ke 8,4 GB.
 *
 * Produksi kini meminta captcha **diketik manual** — lihat `OCR_LOKAL` di
 * `WebPresensi.tsx`, yang bernilai `false` di build produksi. Handler ini
 * dicoret dari `BUKAN_HANDLER` di `_handlers.ts`, jadi `api/ocr.ts` tidak lagi
 * dibuat dan tidak pernah ter-deploy.
 *
 * Berkas ini **tetap disimpan** karena `npm run dev` masih memakai OCR: endpoint
 * `/api/ocr` di dev dilayani `ocr_service.py` (Python, port 8791) yang
 * menjalankan model ddddocr yang sama. Versi Node.js ini dipakai ketika model
 * perlu dijalankan di luar Python — dan `ocr_service.py` sendiri memakai
 * `onnxruntime` Python, jadi logika inferensinya ada dua salinan yang harus
 * dijaga sinkron.
 *
 * Berkas model (`ocr.onnx`, `charset.json`) tidak ada di repo. Untuk dev,
 * `ocr_service.py` mengunduh sendiri ke `.cache/`; untuk menjalankan versi
 * Node.js, taruh model di `api/model/` secara lokal; `.gitignore` mengecualikannya
 * supaya 13 MB itu tidak masuk Git.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terapkanCors } from './_cors';

// ─── Konstanta ───────────────────────────────────────────────────────────────

const MAX_BODY = 2 * 1024 * 1024; // 2 MB
const PANJANG_CAPTCHA = 4;

/*
 * Path model relatif ke file ini (`api/ocr.js` saat sudah dibuild).
 *
 * Yang dipakai di produksi tetap cara pertama: `import.meta.url` di bundle ESM
 * yang benar-benar dijalankan Vercel. Dua cara berikutnya hanya aktif kalau
 * yang pertama tidak tersedia — bundle CommonJS, tempat esbuild mengosongkan
 * `import.meta` (ia sendiri memperingatkan hal ini).
 *
 * Yang kandidat di sini diturunkan dari lokasi model yang benar-benar ada,
 * bukan ditebak: kalau path-nya salah, pesan `ENOENT` hanya menyebut path yang
 * salah dan tidak pernah menyuruh memeriksa bahwa yang salah lokasi deploy-nya.
 */
function cariDirModel(): string {
  const kandidat: string[] = [];
  if (typeof import.meta.url === 'string') {
    try {
      kandidat.push(dirname(fileURLToPath(import.meta.url)));
    } catch {
      // `import.meta.url` ada tapi bukan URL — biarkan kandidat berikutnya.
    }
  }
  if (typeof __dirname === 'string') kandidat.push(__dirname);
  // Vercel: cwd biasanya /var/task, model ada di api/model/
  kandidat.push(join(process.cwd(), 'api'));
  // Vercel dengan includeFiles: model bisa saja di-copy langsung ke cwd
  kandidat.push(process.cwd());
  // Fallback eksplisit untuk Vercel
  kandidat.push('/var/task/api');
  kandidat.push('/var/task');

  for (const dir of kandidat) {
    if (existsSync(join(dir, 'model', 'ocr.onnx'))) return dir;
  }
  throw new Error(
    'model/ocr.onnx tidak ditemukan. Dicoba di: ' +
      [...new Set(kandidat)].join(', ') +
      '. Pastikan folder model ikut ter-deploy bersama api/ocr.js.'
  );
}

// Path model dicari saat pertama kali dibutuhkan (lazy), bukan saat module
// di-load — agar cold start tidak crash sebelum handler sempat menjawab.
let _modelPath: string | null = null;
let _charsetPath: string | null = null;

function getModelPaths(): { modelPath: string; charsetPath: string } {
  if (_modelPath && _charsetPath) return { modelPath: _modelPath, charsetPath: _charsetPath };
  const dir = cariDirModel();
  _modelPath = join(dir, 'model', 'ocr.onnx');
  _charsetPath = join(dir, 'model', 'charset.json');
  return { modelPath: _modelPath, charsetPath: _charsetPath };
}

// ─── Lazy-load ONNX Runtime & charset ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _session: any = null;
let _charset: string[] | null = null;

async function muatModel(): Promise<{ session: NonNullable<typeof _session>; charset: string[] }> {
  if (_session && _charset) return { session: _session, charset: _charset };

  const { modelPath, charsetPath } = getModelPaths();

  // Gunakan require untuk menghindari masalah ESM interop di Node.js bundled
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const ort: any = await import('onnxruntime-node');

  if (!_session) {
    // InferenceSession.create bisa berada di ort langsung atau ort.default
    const InferenceSession = ort.InferenceSession ?? ort.default?.InferenceSession;
    _session = await InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
    });
  }

  if (!_charset) {
    _charset = JSON.parse(readFileSync(charsetPath, 'utf-8')) as string[];
  }

  return { session: _session, charset: _charset };
}

// ─── Preprocessing gambar ────────────────────────────────────────────────────

/**
 * Preprocessing gambar captcha menjadi tensor float32 [1, 1, 64, 224].
 * Dimensi ini sesuai dengan model ddddocr (common_old).
 */
async function preprocessGambar(gambar: Buffer): Promise<Float32Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharpMod: any = await import('sharp');
  const sharp = sharpMod.default ?? sharpMod;

  const { data, info } = await sharp(gambar)
    .resize(224, 64, { fit: 'fill' })
    .grayscale()
    .raw()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .toBuffer({ resolveWithObject: true }) as any;

  const W: number = info.width;   // 224
  const H: number = info.height;  // 64
  const tensor = new Float32Array(H * W);

  // Normalisasi: (pixel/255 - 0.5) / 0.5 — sama dengan ddddocr Python
  for (let i = 0; i < H * W; i++) {
    tensor[i] = ((data as Buffer)[i] / 255.0 - 0.5) / 0.5;
  }

  return tensor;
}

// ─── CTC Decode ──────────────────────────────────────────────────────────────

/** CTC greedy decode: buang blank (index 0) dan duplikat berurutan. */
function ctcDecode(indices: number[], charset: string[]): string {
  const hasil: string[] = [];
  let sebelumnya = -1;
  for (const i of indices) {
    if (i !== sebelumnya && i !== 0) {
      if (charset[i]) hasil.push(charset[i]);
    }
    sebelumnya = i;
  }
  return hasil.join('');
}

// ─── Inferensi ───────────────────────────────────────────────────────────────

interface OcrResult {
  ok: boolean;
  text: string;
  kandidat: string[];
  yakin: boolean;
  panjang: number;
  error?: string;
}

async function selesaikanCaptcha(gambar: Buffer): Promise<OcrResult> {
  const { session, charset } = await muatModel();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ortMod: any = await import('onnxruntime-node');
  const ort = ortMod.default ?? ortMod;

  const tensorData = await preprocessGambar(gambar);
  const tensor = new ort.Tensor('float32', tensorData, [1, 1, 64, 224]);

  const inputName: string = session.inputNames[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feeds: Record<string, any> = { [inputName]: tensor };

  const results = await session.run(feeds);
  const outputName: string = session.outputNames[0];
  const output = results[outputName];
  const logits: Float32Array = output.data as Float32Array;

  // Shape: [T, 1, C] atau [T, C]
  const dims: number[] = output.dims as number[];
  let T: number, C: number;

  if (dims.length === 3) {
    T = dims[0];
    C = dims[2];
  } else if (dims.length === 2) {
    T = dims[0];
    C = dims[1];
  } else {
    throw new Error(`Shape output tidak dikenali: ${dims.join('×')}`);
  }

  // Kandidat 1: argmax dibatasi ke digit 0-9 (+ blank index 0)
  const digitSet = new Set([0, ...charset
    .map((c, i) => /^[0-9]$/.test(c) ? i : -1)
    .filter(i => i >= 0)]);

  const argmaxDigit: number[] = [];
  const argmaxBebas: number[] = [];

  for (let t = 0; t < T; t++) {
    const offset = t * C;
    let maxDigit = -Infinity, idxDigit = 0;
    let maxBebas = -Infinity, idxBebas = 0;

    for (let c = 0; c < C; c++) {
      const val = logits[offset + c];
      if (val > maxBebas) { maxBebas = val; idxBebas = c; }
      if (digitSet.has(c) && val > maxDigit) { maxDigit = val; idxDigit = c; }
    }
    argmaxDigit.push(idxDigit);
    argmaxBebas.push(idxBebas);
  }

  const teksDigit = ctcDecode(argmaxDigit, charset);
  const teksBebas = ctcDecode(argmaxBebas, charset);

  const kandidat: string[] = [];
  for (const t of [teksDigit, teksBebas]) {
    if (t && !kandidat.includes(t)) kandidat.push(t);
  }

  // Pilih kandidat terbaik: 4 digit murni → panjang 4 → kandidat pertama
  const utama =
    kandidat.find((k) => k.length === PANJANG_CAPTCHA && /^\d+$/.test(k)) ||
    kandidat.find((k) => k.length === PANJANG_CAPTCHA) ||
    kandidat[0] || '';

  return {
    ok: true,
    text: utama,
    kandidat,
    yakin: utama.length === PANJANG_CAPTCHA && /^\d+$/.test(utama),
    panjang: PANJANG_CAPTCHA,
  };
}

// ─── Kirim JSON ──────────────────────────────────────────────────────────────

function kirimJson(res: ServerResponse, kode: number, data: object): void {
  const body = JSON.stringify(data);
  res.statusCode = kode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

// ─── Handler HTTP ─────────────────────────────────────────────────────────────

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  /*
   * CORS lewat helper yang sama dengan handler lain, bukan
   * `Access-Control-Allow-Origin: '*'` tulisan tangan.
   *
   * Endpoint ini menjalankan model ONNX 13 MB — mahal. Dengan `*`, situs mana
   * pun yang tahu URL-nya bisa memakainya sebagai layanan OCR gratis, dan
   * yang pays-nya adalah kuota function Vercel proyek ini. Dengan allow-list,
   * hanya origin aplikasi sendiri yang bisa memanggil.
   *
   * Yang TIDAK bisa dilindungi CORS: pemanggil non-peramban (curl, skrip).
   * CORS hanya ditegakkan oleh peramban, jadi allow-list ini menutup jalan
   * misuse dari situs lain, bukan dari skrip server.
   */
  if (!terapkanCors(res, req.headers?.origin)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ ok: false, error: 'Origin tidak diizinkan' }));
    return;
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  /*
   * Handler tidak boleh melempar keluar. Di Vercel itu jadi
   * `FUNCTION_INVOCATION_FAILED`: tidak ada respons sama sekali, dan tidak ada
   * yang bisa menebak penyebabnya.
   *
   * Gambar dibaca dari stream `req`, jadi bentuk minimum yang dibutuhkan adalah
   * `on`. Runtime yang tidak memberi stream (atau pemanggil yang mengoper objek
   * biasa) harus berakhir sebagai 400 dengan pesan jelas, bukan `TypeError`.
   */
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET') {
    try {
      await muatModel();
      kirimJson(res, 200, { ok: true, engine: 'onnx-ddddocr', panjang: PANJANG_CAPTCHA });
    } catch (e) {
      kirimJson(res, 503, { ok: false, error: String(e) });
    }
    return;
  }

  if (req.method !== 'POST') {
    kirimJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  // Baca body gambar — dua mode:
  // 1. Fluid Compute / Next.js: body sudah di-parse, tersedia di req.body
  // 2. Classic Serverless: body datang sebagai stream lewat req.on('data')
  let gambar: Buffer;

  const bodyLangsung = (req as any).body;
  if (bodyLangsung !== undefined && bodyLangsung !== null) {
    // Fluid Compute: body sudah tersedia
    if (Buffer.isBuffer(bodyLangsung)) {
      gambar = bodyLangsung;
    } else if (typeof bodyLangsung === 'string') {
      gambar = Buffer.from(bodyLangsung, 'binary');
    } else if (bodyLangsung instanceof Uint8Array) {
      gambar = Buffer.from(bodyLangsung);
    } else {
      // Fallback: coba JSON / unknown
      gambar = Buffer.alloc(0);
    }
  } else if (typeof (req as any).on === 'function') {
    // Classic stream
    gambar = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total <= MAX_BODY) chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(Buffer.alloc(0)));
    });
  } else {
    kirimJson(res, 400, { ok: false, error: 'Tidak bisa membaca body: req.on dan req.body keduanya tidak tersedia.' });
    return;
  }

  if (!gambar.length) {
    kirimJson(res, 400, { ok: false, error: 'body gambar kosong' });
    return;
  }

  try {
    const hasil = await selesaikanCaptcha(gambar);
    kirimJson(res, 200, hasil);
  } catch (e) {
    kirimJson(res, 500, {
      ok: false,
      error: `OCR gagal: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
