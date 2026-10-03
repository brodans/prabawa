import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { epAsalRegex, epTargetOrigin } from './src/lib/epTarget';

const DIR_PROYEK = path.dirname(fileURLToPath(import.meta.url));

// ─── Proxy e-Presensi BKD Jatim ───────────────────────────────────────────
// Semua request ke /ep/* diteruskan ke server e-presensi.
// Cookie session (epresensi-bkdjatim) tanpa atribut Domain, jadi browser
// menyimpannya di localhost dan proxy meneruskannya bolak-balik dengan benar.
//
// ⚠️ Host pusat lewat `src/lib/epTarget.ts` (env `EP_TARGET_ORIGIN`, atau
// origin dari `PRESENSI_BASE_URL`), bukan ditulis di sini. Proxy dev ini dan
// `src/serverless/ep.ts` (Vercel) harus menunjuk host yang sama; dua salinan
// yang bisa berbeda hanya akan muncul sebagai "login web gagal" tanpa error.
const EP_TARGET = epTargetOrigin();
const EP_TARGET_ORIGIN = new URL(EP_TARGET).origin;

// Server e-presensi mengirim redirect ABSOLUT. Kita tulis ulang Location
// agar selalu menunjuk balik ke proxy /ep (same-origin).
function rewriteEpLocation(proxyRes: { headers: Record<string, string | string[] | undefined> }) {
  const loc = proxyRes.headers['location'];
  if (!loc || typeof loc !== 'string') return;
  let baru = loc.replace(epAsalRegex(), '');
  if (!baru.startsWith('/')) baru = '/' + baru;
  if (!/^\/ep(\/|$)/.test(baru)) baru = '/ep' + baru;
  proxyRes.headers['location'] = baru;
}

const epProxy = {
  target: EP_TARGET,
  changeOrigin: true,
  secure: true,
  rewrite: (p: string) => p.replace(/^\/ep/, '').replace(/^\/p\//, '/index.php/'),
  headers: { Referer: EP_TARGET_ORIGIN + '/' },
  configure: (proxyServer: { on: (event: string, cb: (proxyRes: { headers: Record<string, string | string[] | undefined> }) => void) => void }) => {
    proxyServer.on('proxyRes', rewriteEpLocation);
  },
};

// ─── OCR Captcha (hanya local dev) ────────────────────────────────────────
// Captcha dipecahkan otomatis oleh layanan OCR lokal `ocr_service.py`
// (127.0.0.1:8791, ddddocr). Plugin ini:
//   - menyediakan endpoint same-origin POST /api/ocr
//   - menjalankan ocr_service.py otomatis bila belum berjalan
//
// Di Vercel/production, endpoint /api/ocr dilayani oleh api/ocr.js
// yang memakai model ONNX langsung (tanpa Python).

// Host/port OCR lokal hanya untuk pengembangan — di produksi quirk ini
// dilayani `api/ocr.js` (ONNX). Tetap lewat env supaya bisa diarahkan ke
// layanan OCR yang sudah jalan di mesin lain tanpa mengubah kode.
const OCR_HOST = process.env.OCR_HOST || '127.0.0.1';
const OCR_PORT = Number(process.env.OCR_PORT || 8791);

let anakOcr: ReturnType<typeof spawn> | null = null;
let berhentiOcr = false;
let waktuSpawnTerakhir = 0;
let ocrPythonTersedia = true; // asumsi tersedia sampai terbukti tidak

function ocrSehat(timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: OCR_HOST, port: OCR_PORT, path: '/health', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function cariOcrPy(): string | null {
  const ocr_py = path.join(DIR_PROYEK, 'ocr_service.py');
  try { return fs.existsSync(ocr_py) ? ocr_py : null; } catch { return null; }
}

function jalankanLayananOcr() {
  if (!ocrPythonTersedia) return;
  if (anakOcr && anakOcr.exitCode === null && !anakOcr.killed) return;

  const ocr_py = cariOcrPy();
  if (!ocr_py) {
    ocrPythonTersedia = false;
    console.log('[ocr-captcha] ocr_service.py tidak ditemukan — OCR via Node.js ONNX (/api/ocr) akan dipakai');
    return;
  }

  anakOcr = spawn('python3', [ocr_py, '--warmup'], {
    cwd: path.dirname(ocr_py),
    stdio: 'ignore',
  });
  anakOcr.on('error', (err) => {
    console.log('[ocr-captcha] gagal spawn python3:', (err as Error).message);
    ocrPythonTersedia = false;
  });
  waktuSpawnTerakhir = Date.now();
  console.log('[ocr-captcha] menjalankan ocr_service.py di', ocr_py);
}

async function pastikanOcr(waktuTungguMs = 30000): Promise<boolean> {
  if (!ocrPythonTersedia) return false;
  const mulai = Date.now();
  while (Date.now() - mulai < waktuTungguMs && !berhentiOcr) {
    if (await ocrSehat(1000)) return true;
    if (Date.now() - waktuSpawnTerakhir > 5000) jalankanLayananOcr();
    await new Promise((r) => setTimeout(r, 500));
  }
  return ocrSehat(1000);
}

function middlewareOcr(req: http.IncomingMessage, res: http.ServerResponse) {
  const potongan: Buffer[] = [];
  req.on('data', (c: Buffer) => potongan.push(c));
  req.on('error', () => {});
  req.on('end', async () => {
    const gambar = Buffer.concat(potongan);

    // Health check GET
    if (req.method === 'GET') {
      const sehat = await ocrSehat(500);
      res.statusCode = sehat ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: sehat, engine: 'python-ddddocr' }));
      return;
    }

    if (!gambar.length) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'body gambar kosong' }));
      return;
    }

    const siap = await pastikanOcr();
    if (!siap) {
      // Fallback ke ONNX Node.js handler
      res.statusCode = 502;
      res.end(JSON.stringify({
        ok: false,
        error: 'OCR Python tidak tersedia. Pastikan ddddocr terpasang dan ocr_service.py bisa dijalankan.',
      }));
      return;
    }
    const up = http.request(
      {
        host: OCR_HOST,
        port: OCR_PORT,
        path: '/ocr',
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': gambar.length,
        },
      },
      (ures) => {
        res.statusCode = ures.statusCode ?? 200;
        res.setHeader('Content-Type', ures.headers['content-type'] || 'application/json; charset=utf-8');
        ures.pipe(res);
      },
    );
    up.on('error', () => {
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: 'gagal meneruskan gambar ke layanan OCR' }));
    });
    up.end(gambar);
  });
}

function ocrCaptcha() {
  return {
    name: 'ocr-captcha-e-presensi',
    configureServer(server: { middlewares: { use: (p: string, fn: (req: http.IncomingMessage, res: http.ServerResponse) => void) => void } }) {
      berhentiOcr = false;
      server.middlewares.use('/api/ocr', middlewareOcr);
      // Coba jalankan OCR Python di background — jika gagal, frontend fallback ke ONNX
      jalankanLayananOcr();
      pastikanOcr(60000).catch(() => {});
    },
    configurePreviewServer(server: { middlewares: { use: (p: string, fn: (req: http.IncomingMessage, res: http.ServerResponse) => void) => void } }) {
      berhentiOcr = false;
      server.middlewares.use('/api/ocr', middlewareOcr);
      jalankanLayananOcr();
      pastikanOcr(60000).catch(() => {});
    },
    closeBundle() {
      berhentiOcr = true;
      if (anakOcr) {
        try { anakOcr.kill(); } catch { /* abaikan */ }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), ocrCaptcha()],
  server: {
    hmr: false,
    proxy: {
      '/ep': epProxy,
      // Semua /api/* di-proxy ke Express dev server (port 3000).
      // Di Vercel, /api/* langsung ke serverless functions.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        /*
         * `return undefined` = "jangan dikumpulkan ke chunk mana pun".
         *
         * Semua paket di daftar itu hanya dibutuhkan setelah pengguna menekan
         * tombolnya: QRIS (`qrcode-generator`) saat tombol QRIS ditekan, PDF
         * (`jspdf` + `canvg` + `html2canvas` + `dompurify`) saat laporan
         * diunduh. Semuanya sudah di-`lazy()` di sisi komponen.
         *
         * Kalau ikut dikumpulkan ke `vendor`, semuanya jadi satu berkas yang
         * di-*preload* bersama layar login — dan `qrcode-generator` ikut terunduh
         * oleh orang yang tidak akan pernah menekan tombol itu. `vendor` sendiri
         * di-*preload* oleh `index.html`, jadi apa pun yang masuk ke sana tidak
         * bisa ditunda.
         */
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet')) return 'leaflet';
            if (id.includes('firebase')) return 'firebase';
            if (id.includes('motion')) return 'motion';
            // Ditunggu sampai tombol ditekan — jangan dikumpulkan ke `vendor`.
            if (
              id.includes('qrcode-generator') ||
              id.includes('jspdf') ||
              id.includes('canvg') ||
              id.includes('dompurify') ||
              id.includes('html2canvas') ||
              id.includes('core-js')
            ) {
              return undefined;
            }
            return 'vendor';
          }
          if (id.includes('src/data/')) {
            return 'data';
          }
        }
      }
    }
  }
});
