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
  // Ganti /index.php/ dengan /p/ agar tidak kena Vercel WAF
  baru = baru.replace(/\/index\.php\//g, '/p/');
  return baru;
}

/**
 * Tulis ulang Set-Cookie:
 * - Buang Domain (agar cookie tersimpan di domain Vercel, bukan domain upstream)
 * - Sesuaikan Path ke /ep
 * - Di production (HTTPS): pastikan Secure ada, tambah SameSite=Lax
 * - Di dev lokal (HTTP): hapus Secure agar browser mau menyimpan di localhost
 */
function rewriteSetCookie(cookies: string | string[]): string[] {
  const isProd = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const list = Array.isArray(cookies) ? cookies : [cookies];
  return list.map((cookie) => {
    let c = cookie
      .replace(/;\s*domain=[^;]*/gi, '')
      .replace(/;\s*path=[^;]*/gi, '; Path=/ep');
    if (isProd) {
      // Production (Vercel HTTPS): Secure wajib, SameSite=Lax agar cookie ikut
      if (!/;\s*secure/i.test(c)) c += '; Secure';
      if (!/;\s*samesite=/i.test(c)) c += '; SameSite=Lax';
    } else {
      // Dev lokal (HTTP): hapus Secure agar browser simpan di localhost
      c = c.replace(/;\s*secure/gi, '');
    }
    return c;
  });
}

export default async function handler(req: IncomingMessage & { url?: string; method?: string; headers: Record<string, string | string[] | undefined> }, res: ServerResponse): Promise<void> {
  const originalUrl = req.url || '/';

  // Vercel routes dengan dest=/api/ep menyebabkan req.url = '/api/ep'
  // (kehilangan sub-path). Baca original URL dari header yang Vercel set.
  // Prioritas: x-matched-path > x-vercel-rewrite-source > req.url
  const matchedPath = (req.headers?.['x-matched-path'] as string) || '';
  const rewriteSrc  = (req.headers?.['x-vercel-rewrite-source'] as string) || '';
  const sourceUrl   = rewriteSrc || matchedPath || originalUrl;

  console.log(`[ep] method=${req.method} url=${originalUrl} matched=${matchedPath} rewrite-src=${rewriteSrc}`);

  let upstreamPath = sourceUrl
    .replace(/^\/api\/ep/, '')
    .replace(/^\/ep/, '');
  if (!upstreamPath.startsWith('/')) upstreamPath = '/' + upstreamPath;
  if (!upstreamPath) upstreamPath = '/';

  // Terjemahkan /p/ ke /index.php/ (bypass Vercel WAF yang blokir .php)
  upstreamPath = upstreamPath.replace(/^\/p(\/|$)/, '/index.php$1');

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

  // Baca body untuk method yang membawa payload — dua mode:
  // 1. Fluid Compute: body sudah di-parse di req.body
  // 2. Classic stream: baca lewat req.on('data')
  let body: ArrayBuffer | undefined;
  const method = req.method || 'GET';
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const bodyLangsung = (req as any).body;
    if (bodyLangsung !== undefined && bodyLangsung !== null) {
      // Fluid Compute: konversi ke ArrayBuffer
      let raw: Buffer;
      if (Buffer.isBuffer(bodyLangsung)) {
        raw = bodyLangsung;
      } else if (typeof bodyLangsung === 'string') {
        raw = Buffer.from(bodyLangsung);
      } else if (bodyLangsung instanceof Uint8Array) {
        raw = Buffer.from(bodyLangsung);
      } else {
        raw = Buffer.from(JSON.stringify(bodyLangsung));
      }
      if (raw.length > 0) {
        const ab = new ArrayBuffer(raw.length);
        const view = new Uint8Array(ab);
        for (let i = 0; i < raw.length; i++) view[i] = raw[i];
        body = ab;
      }
    } else if (typeof (req as any).on === 'function') {
      const raw = await new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', () => resolve(Buffer.alloc(0)));
      });
      if (raw.length > 0) {
        const ab = new ArrayBuffer(raw.length);
        const view = new Uint8Array(ab);
        for (let i = 0; i < raw.length; i++) view[i] = raw[i];
        body = ab;
      }
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

  // Log untuk diagnosa cookie/session
  const cookieMasuk = req.headers?.['cookie'] || '(tidak ada)';
  const setCookieKeluar = upstreamRes.headers.get('set-cookie') || '(tidak ada)';
  const locationKeluar = upstreamRes.headers.get('location') || '';
  console.log(`[ep] upstream=${upstreamPath} status=${upstreamRes.status} cookie-masuk=${String(cookieMasuk).slice(0,80)} set-cookie=${String(setCookieKeluar).slice(0,120)} location=${locationKeluar}`);

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
