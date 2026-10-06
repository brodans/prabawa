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
 * Dibangun oleh `src/serverless/build.mts` menjadi `api/ep.js`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { epTargetOrigin } from '../lib/epTarget';

const TARGET = epTargetOrigin();
const TARGET_ORIGIN = new URL(TARGET).origin;

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
  // Node.js fetch sudah decompress body otomatis — kalau header ini ikut
  // diteruskan, browser mencoba decompress lagi dan gagal (ERR_CONTENT_DECODING_FAILED)
  'content-encoding',
  'content-length', // panjang berubah setelah decompress
]);

/**
 * Tulis ulang URL redirect agar menunjuk ke proxy, bukan ke upstream langsung.
 * Contoh: https://presensi.bkd.jatimprov.go.id/index.php/ -> /ep/index.php/
 *
 * ⚠️ Host diambil dari `ASAL_UPSTREAM` (lihat `epTarget.ts`), bukan ditulis
 * di sini — kalau tidak, perubahan host hanya berlaku di satu dari dua tempat.
 */
function rewriteLocation(loc: string): string {
  // Buang semua prefix absolut (http://host atau https://host), apapun hostnya
  // — upstream kadang redirect ke domain Vercel karena kita kirim Host: mereka
  let baru = loc;
  try {
    const u = new URL(loc);
    baru = u.pathname + u.search + u.hash;
  } catch {
    // bukan URL absolut — pakai apa adanya
  }
  if (!baru.startsWith('/')) baru = '/' + baru;
  // Pastikan diawali /ep
  if (!/^\/ep(\/|$)/.test(baru)) baru = '/ep' + baru;
  // Ganti /index.php/ → /p/ (bypass Vercel WAF)
  baru = baru.replace(/\/index\.php(\/|$)/g, '/p$1');
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
  // ⚠️ host, referer, origin HARUS menunjuk ke upstream — jangan forward
  // nilai dari browser. Kalau origin browser (prabawa.vercel.app) diteruskan,
  // server upstream akan redirect ke domain Vercel dan mematikan proxy loop.
  headers['host'] = new URL(TARGET).host;
  headers['referer'] = TARGET_ORIGIN + '/';
  headers['origin'] = TARGET_ORIGIN;
  // Hapus header yang bisa bocorkan domain Vercel ke upstream
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-for'];

  /*
   * `content-length` **wajib** dihapus, dan ini bukan soal kerapian.
   *
   * ⚠️ Penghapusan harus **tidak regard terhadap huruf besar**. Versi pertama
   * memakai `delete headers['content-length']` saja, yang HANYA menghapus ejaan
   * lowercase. Browser dan Vercel mengirim `Content-Length` dengan huruf besar,
   * jadi header itu tetap diteruskan berdampingan dengan body yang panjangnya
   * sudah berubah. undici menerimanya sebagai "42 byte" diikuti 64 byte, lalu
   * menolak socket-nya:
   *
   *   TypeError: fetch failed  (cause: UND_ERR_SOCKET)
   *
   * Kenapa gejalanya tidak selalu muncul: penghapusan lowercase diam-diam
   * berhasil pada test yang body-nya sudah ter-encode. Yang gagal hanya body
   * yang panjangnya berubah saat dibangun ulang — yaitu yang mengandung `[` atau
   * `%20`:
   *
   *   m_user[email]=...     ->  jadi m_user%5Bemail%5D=...  (52 -> 64)  502
   *   m_user%5Bemail%5D=...  (sudah ter-encode, 64)                       200
   *
   * Login web selalu mengirim kurung polos, jadi **selalu** 502 — dan karena
   * peramban memakai pesan umum "periksa NIP, password, dan captcha", ini
   * terlihat seperti kredensial salah padahal tidak ada yang salah di sana.
   *
   * Fluid Compute memberi `req.body` dalam bentuk **sudah diparsing** — untuk
   * `application/x-www-form-urlencoded` jadi object biasa. Body lalu dibangun
   * ulang dengan `URLSearchParams` (lihat blok di atas), dan itu mengubah
   * panjangnya: `URLSearchParams` meng-encode `[` jadi `%5B` dan `]` jadi
   * `%5D`, sedangkan body asli dari browser tidak.
   *
   *   dari browser : m_user[email]=...&m_user[password]=...  ->  83 byte
   *   setelah dibangun ulang : m_user%5Bemail%5D=...        ->  95 byte
   *
   * Kalau `content-length` ikut diteruskan, upstream/undici menerima "83 byte"
   * yang diikuti 95 byte. undici menolaknya sebagai socket rusak:
   *
   *   TypeError: fetch failed  (cause: UND_ERR_SOCKET)
   *
   * Handler menangkap galat itu jadi **502 `fetch failed`**, dan gejalanya persis
   * "login web gagal" — padahal GET apa pun tetap jalan, karena GET tidak punya
   * body sehingga tidak ada `content-length` yang bisa basi. Itu sebabnya gejalanya
   * terasa seperti masalah captcha, sementara endpoint lain tetap normal.
   *
   * `undici` menghitung sendiri `Content-Length` dari body yang benar-benar
   * dikirim, jadi menghapusnya selalu aman — termasuk untuk multipart, karena
   * body-nya diteruskan apa adanya sebagai buffer.
   *
   * `content-encoding` dihapus dengan alasan sama: body yang kita kirim selalu
   * sudah berupa byte hasil decode Vercel. Meneruskan `content-encoding: gzip`
   * akan membuat upstream mencoba meng-unzip byte yang sudah polos.
   */
  for (const k of Object.keys(headers)) {
    const turun = k.toLowerCase();
    if (turun === 'content-length' || turun === 'content-encoding') delete headers[k];
  }

  // Baca body untuk method yang membawa payload — dua mode:
  // 1. Fluid Compute: body sudah di-parse di req.body
  // 2. Classic stream: baca lewat req.on('data')
  let body: ArrayBuffer | undefined;
  const method = req.method || 'GET';
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const bodyLangsung = (req as any).body;
    const contentType = String(req.headers?.['content-type'] || '');

    if (bodyLangsung !== undefined && bodyLangsung !== null) {
      // Fluid Compute: konversi ke ArrayBuffer sesuai content-type
      let raw: Buffer;
      if (Buffer.isBuffer(bodyLangsung)) {
        raw = bodyLangsung;
      } else if (typeof bodyLangsung === 'string') {
        raw = Buffer.from(bodyLangsung);
      } else if (bodyLangsung instanceof Uint8Array) {
        raw = Buffer.from(bodyLangsung);
      } else if (typeof bodyLangsung === 'object' && contentType.includes('application/x-www-form-urlencoded')) {
        // Fluid Compute mem-parse form-urlencoded menjadi object — serialize ulang
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(bodyLangsung as Record<string, unknown>)) {
          params.append(k, String(v));
        }
        raw = Buffer.from(params.toString(), 'utf-8');
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
    console.log(`[ep] body-type=${typeof bodyLangsung} content-type=${contentType.slice(0,60)} body-len=${body?.byteLength ?? 0}`);
  }

  let upstreamRes!: Response;
  try {
    if (method === 'POST') {
      // POST: follow redirect internal agar browser tidak menerima 302 cross-origin
      // yang akan di-block oleh fetch dengan credentials:include
      let nextUrl = upstreamUrl;
      let nextMethod: string = method;
      let nextBody: BodyInit | undefined = body ? new Uint8Array(body) : undefined;
      const hopHeaders = { ...headers };
      for (let hop = 0; hop < 8; hop++) {
        upstreamRes = await fetch(nextUrl, {
          method: nextMethod,
          headers: hopHeaders,
          body: nextBody,
          redirect: 'manual',
        });
        const st = upstreamRes.status;
        if (st < 300 || st >= 400) break;
        const loc = upstreamRes.headers.get('location');
        if (!loc) break;
        try { nextUrl = new URL(loc, nextUrl).href; } catch { break; }
        // POST→GET setelah 302/303
        if ((st === 302 || st === 303) && nextMethod === 'POST') {
          nextMethod = 'GET';
          nextBody = undefined;
          delete hopHeaders['content-type'];
          delete hopHeaders['content-length'];
        }
      }
    } else {
      upstreamRes = await fetch(upstreamUrl, {
        method,
        headers,
        body,
        redirect: 'manual',
      });
    }
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
