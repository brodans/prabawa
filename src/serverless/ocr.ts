/**
 * Vercel Serverless Function: /api/ocr
 *
 * Memecahkan captcha e-Presensi BKD Jatim menggunakan model ONNX (ddddocr).
 * Berjalan di Vercel (Node.js runtime) maupun local dev.
 *
 * Request : POST /api/ocr
 *   Body  : byte gambar captcha (GIF/PNG/JPG), Content-Type bebas
 * Response: { ok: true, text: "1234", kandidat: [...], yakin: true }
 *           { ok: false, error: "..." } bila gagal
 *
 * Model   : api/model/ocr.onnx  (ddddocr common_old, 13 MB)
 * Charset : api/model/charset.json
 *
 * ⚠️ Berkas ini adalah SUMBER, bukan artefak.
 * Dibangun oleh `src/serverless/build.mjs` menjadi `api/ocr.js`.
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
  kandidat.push(join(process.cwd(), 'api'));

  for (const dir of kandidat) {
    if (existsSync(join(dir, 'model', 'ocr.onnx'))) return dir;
  }
  throw new Error(
    'model/ocr.onnx tidak ditemukan. Dicoba di: ' +
      [...new Set(kandidat)].join(', ') +
      '. Pastikan folder model ikut ter-deploy bersama api/ocr.js.'
  );
}

const DIR = cariDirModel();
const MODEL_PATH = join(DIR, 'model', 'ocr.onnx');
const CHARSET_PATH = join(DIR, 'model', 'charset.json');

// ─── Lazy-load ONNX Runtime & charset ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _session: any = null;
let _charset: string[] | null = null;

async function muatModel(): Promise<{ session: NonNullable<typeof _session>; charset: string[] }> {
  if (_session && _charset) return { session: _session, charset: _charset };

  // Gunakan require untuk menghindari masalah ESM interop di Node.js bundled
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const ort: any = await import('onnxruntime-node');

  if (!_session) {
    // InferenceSession.create bisa berada di ort langsung atau ort.default
    const InferenceSession = ort.InferenceSession ?? ort.default?.InferenceSession;
    _session = await InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
    });
  }

  if (!_charset) {
    _charset = JSON.parse(readFileSync(CHARSET_PATH, 'utf-8')) as string[];
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
  if (typeof req?.on !== 'function') {
    kirimJson(res, 400, {
      ok: false,
      error: 'Body permintaan harus berupa stream (req.on tidak tersedia). ' +
        'Endpoint ini menerima byte gambar mentah, bukan JSON.',
    });
    return;
  }

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

  // Baca body gambar
  const gambar = await new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total <= MAX_BODY) chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });

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
