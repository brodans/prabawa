/**
 * Vercel Serverless Function: /api/ep
 *
 * Reverse proxy ke server e-Presensi. Menangani semua request ke /ep/* dan
 * meneruskannya ke server e-Presensi.
 *
 * ⚠️ Host pusat TIDAK ditulis di berkas ini. Semuanya lewat `epTarget.ts`
 * (`EP_TARGET_ORIGIN` / `PRESENSI_BASE_URL`) supaya tidak ada lagi salinan
 * yang harus diubah manual kalau hostnya berganti.
 *
 * Fitur:
 * - Meneruskan cookies sesi (epresensi-bkdjatim) bolak-balik
 * - Menulis ulang header Location pada redirect agar tetap same-origin
 * - Meneruskan semua method (GET, POST, dll.)
 * - Meneruskan body untuk POST/PUT
 * - Mendukung berkas biner (PDF, gambar)
 *
 * ⚠️ Berkas ini adalah SUMBER, bukan artefak.
 * Dibangun oleh `src/serverless/build.mjs` menjadi `api/ep.js`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { epAsalRegex, epTargetOrigin } from '../lib/epTarget';

const TARGET = epTargetOrigin();
const TARGET_ORIGIN = new URL(TARGET).origin;
const ASAL_UPSTREAM = epAsalRegex();

// Header yang TIDAK diteruskan ke upstream (hop-by-hop + host)
const HOP_BY_HOP_REQUEST = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

// Header yang TIDAK diteruskan ke browser dari upstream
const HOP_BY_HOP_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Tulis ulang URL redirect agar menunjuk ke proxy, bukan ke upstream langsung.
 * Contoh: https://presensi.bkd.jatimprov.go.id/index.php/ -> /ep/index.php/
 *
 * ⚠️ Host diambil dari `ASAL_UPSTREAM` (lihat `epTarget.ts`), bukan ditulis
 * di sini — kalau tidak, perubahan host hanya berlaku di satu dari dua tempat.
 */
function rewriteLocation(loc: string): string {
  let baru = loc.replace(ASAL_UPSTREAM, '');
  if (!baru.startsWith('/')) baru = '/' + baru;
  if (!/^\/ep(\/|$)/.test(baru)) baru = '/ep' + baru;
  return baru;
}

/**
 * Tulis ulang Set-Cookie: buang Domain, sesuaikan Path ke /ep, hapus Secure
 * agar cookie bisa disimpan di HTTP local (tidak perlu HTTPS di dev).
 */
function rewriteSetCookie(cookies: string | string[]): string[] {
  const list = Array.isArray(cookies) ? cookies : [cookies];
  return list.map((cookie) =>
    cookie
      .replace(/;\s*domain=[^;]*/gi, '')
      .replace(/;\s*path=\//gi, '; Path=/ep')
      .replace(/;\s*secure/gi, '')
  );
}

export default async function handler(req: IncomingMessage & { url?: string; method?: string; headers: Record<string, string | string[] | undefined> }, res: ServerResponse): Promise<void> {
  /*
   * Handler tidak boleh melempar keluar: di Vercel itu jadi
   * `FUNCTION_INVOCATION_FAILED` — tanpa respons, tanpa penyebab yang bisa
   * dibaca. Body diteruskan sebagai stream, jadi bentuk minimum yang dibutuhkan
   * adalah `req.on`; kalau tidak ada, jawab 400 dengan pesan yang menyebut apa
   * yang terjadi, bukan berhenti sebagai `TypeError` yang tidak terbaca.
   */
  if (typeof req?.on !== 'function') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'Permintaan harus berupa stream (req.on tidak tersedia).',
    }));
    return;
  }

  const originalUrl = req.url || '/';

  // Vercel bisa memberikan req.url dalam dua bentuk tergantung versi CLI:
  // 1. Sudah di-strip: "/index.php/captcha?r=..." (tanpa /api/ep di depan)
  // 2. Belum di-strip: "/api/ep/index.php/captcha?r=..." (URL rewrite penuh)
  // Strip keduanya agar upstreamPath selalu berupa path murni.
  let upstreamPath = originalUrl
    .replace(/^\/api\/ep/, '')
    .replace(/^\/ep/, '');
  if (!upstreamPath.startsWith('/')) upstreamPath = '/' + upstreamPath;

  const upstreamUrl = `${TARGET}${upstreamPath}`;

  // Susun headers untuk request upstream
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP_REQUEST.has(key.toLowerCase()) && typeof value === 'string') {
      headers[key] = value;
    }
  }

  // Override headers penting agar upstream menerimanya dengan benar
  headers['host'] = new URL(TARGET).host;
  headers['referer'] = TARGET_ORIGIN + '/';
  headers['origin'] = TARGET_ORIGIN;

  // Baca body untuk method yang membawa payload
  let body: ArrayBuffer | undefined;
  const method = req.method || 'GET';
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const raw = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(Buffer.alloc(0)));
    });
    if (raw.length > 0) {
      // Salin ke ArrayBuffer yang bukan Buffer Node.js
      const ab = new ArrayBuffer(raw.length);
      const view = new Uint8Array(ab);
      for (let i = 0; i < raw.length; i++) view[i] = raw[i];
      body = ab;
    }
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: 'manual', // Tangani redirect manual agar bisa menulis ulang Location
    });
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'Gagal menghubungi server e-Presensi',
      detail: e instanceof Error ? e.message : String(e),
    }));
    return;
  }

  // Set status code
  res.statusCode = upstreamRes.status;

  // Teruskan headers respons
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (HOP_BY_HOP_RESPONSE.has(key.toLowerCase())) continue;

    if (key.toLowerCase() === 'location') {
      res.setHeader('Location', rewriteLocation(value));
    } else if (key.toLowerCase() === 'set-cookie') {
      const rewritten = rewriteSetCookie(value);
      for (const cookie of rewritten) {
        res.appendHeader('Set-Cookie', cookie);
      }
    } else {
      try {
        res.setHeader(key, value);
      } catch {
        // Abaikan header yang tidak valid
      }
    }
  }

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Teruskan body respons sebagai buffer
  const buffer = Buffer.from(await upstreamRes.arrayBuffer());
  res.end(buffer);
}
