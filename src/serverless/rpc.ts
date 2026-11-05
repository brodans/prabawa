/**
 * Vercel Serverless Function — proxy JSON-RPC ke server pusat PRABAWA.
 *
 * Meniru RestServices.kt (interceptor) dari APK:
 *   - membungkus payload jadi envelope { jsonrpc, method, version, object, param }
 *   - menyuntik api_key, last_latlong, imei ke dalam param
 *
 * `imei` (androidId) TIDAK pernah dikirim dari browser — di-generate
 * server-side per-instance proxy supaya tidak bisa dipalsukan client.
 */

import {
  PRESENSI_VERSION as VERIFIED_PRESENSI_VERSION,
  INJECTED_PARAM_KEYS,
  buildRpcEnvelope,
  cuplikanAman,
  galatHulu,
} from '../lib/presensiContract';
import { terapkanCors } from './_cors';

const PRESENSI_SERVICE_URL =
  process.env.PRESENSI_BASE_URL || 'https://presensi.bkd.jatimprov.go.id/service';

/**
 * ⚠️ Versi gateway TIDAK boleh ditulis manual di sini.
 *
 * Nilai lama file ini `78` — salah satu versi yang **ditolak** server
 * untuk `absen` / `cekabsen` / `add_ijin` dengan pesan "aplikasi terbaru
 * telah tersedia". Sekarang diambil dari kontrak terverifikasi
 * (`PRESENSI_VERSION` = 89, versionCode APK 1.11.21) supaya tidak
 * melenceng lagi di dua tempat.
 */
const PRESENSI_VERSION = Number(process.env.PRESENSI_VERSION || VERIFIED_PRESENSI_VERSION);

// Keep the worst-case retry budget below Vercel's 60s function limit:
// 3 attempts * 15s + 1.6s backoff = 46.6s.
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

/** Header yang meniru klien Android asli (okhttp / Volley). */
const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=UTF-8',
  Accept: 'application/json',
  'User-Agent': 'okhttp/4.12.0',
  'Accept-Encoding': 'gzip',
};


/** Buang header yang bisa dipakai upstream untuk fingerprint pemanggil. */
function getSanitizedHeaders(): Record<string, string> {
  return { ...BASE_HEADERS };
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries: number = MAX_RETRIES,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<{ status: number; rawText: string }> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { signal, done } = withTimeout(timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal });
      const rawText = await response.text();
      // 5xx dan 429 layak dicoba ulang; 4xx tidak.
      if (response.status < 500 && response.status !== 429) {
        return { status: response.status, rawText };
      }
      lastError = new Error(`Upstream HTTP ${response.status}`);
      if (attempt === retries) return { status: response.status, rawText };
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    } finally {
      done();
    }
    // Backoff linear
    await new Promise(resolve => setTimeout(resolve, attempt * 800 + 400));
  }

  throw lastError instanceof Error ? lastError : new Error('Gagal menghubungi server pusat');
}

export default async function handler(req: any, res: any) {
  // ⚠️ Allow-list origin. Tanpa ini, proxy JSON-RPC bisa dipanggil dari
  // halaman mana pun — hostname dan IP server Anda jadi penanda di log
  // gateway pusat. Lihat `api/_cors.ts`.
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ error: 'Origin tidak diizinkan.' });
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { object, param, filter } = (req.body ?? {}) as {
      object?: string;
      param?: Record<string, unknown>;
      filter?: number;
    };

    if (!object || typeof object !== 'string') {
      return res.status(400).json({ error: 'Field "object" (nama RPC) wajib diisi.' });
    }
    if (!/^[a-z0-9_]{2,40}$/i.test(object)) {
      return res.status(400).json({ error: 'Nama RPC tidak valid.' });
    }

    // ── Bentuk envelope persis seperti RestServices.kt ────────────────
    const incomingParam = (param && typeof param === 'object' ? param : {}) as Record<string, unknown>;

    /*
     * Bentuk envelope dan daftar kunci yang disuntik keduanya berasal dari
     * `presensiContract.ts` — sama seperti `src/api/server.ts`.
     *
     * Endpoint ini (Vercel) dan `server.ts` (Node) adalah dua jalan ke
     * gateway yang sama. Semula masing-masing menyusun envelope dan
     * menulis `api_key`/`last_latlong`/`imei` sendiri; sekarang keduanya
     * memanggil fungsi yang sama, jadi tidak bisa lagi berbeda.
     */
    const disuntik: Record<string, unknown> = {
      api_key: incomingParam.api_key ?? '',
      last_latlong: incomingParam.last_latlong ?? '',
      /*
       * Field `imei` diteruskan apa adanya, termasuk string kosong.
       *
       * Semula ada `?? TECH_MARK` — UUID dari environment variable — sebagai
       * cadangan kalau klien tidak mengirim field itu. proved itu tidak
       * pernah terjadi: `useServerContext()` selalu mengirim `imei` (walau
       * hanya `''`), dan `??` hanya memakai cadangan saat nilainya
       * `null`/`undefined`, bukan saat string kosong. Jadi satu UUID yang
       * ada di environment variable itu **tidak pernah terpakai** — hanya
       * terlihat seperti konfigurasi yang berarti.
       *
       * Dan memang tidak boleh: aplikasi ini dipakai banyak perangkat.
       * Satu id bersama menghapus makna pengikatan akun-ke-perangkat di
       * server pusat — begitu id-nya bocor, siapa pun bisa login dari mana
       * saja. Identitas per-perangkat dibuat di sisi klien
       * (`lib/idPerangkat.ts`), satu per akun per peramban.
       */
      imei: incomingParam.imei ?? '',
    };
    const mergedParam: Record<string, unknown> = { ...incomingParam };
    for (const kunci of INJECTED_PARAM_KEYS) mergedParam[kunci] = disuntik[kunci];

    /*
     * Bentuk envelope dari `buildRpcEnvelope` (sumber tunggal, sama dengan
     * `src/api/server.ts`), lalu `version` ditimpa hanya kalau env menyetelnya.
     *
     * `PRESENSI_VERSION` sebelumnya tidak terpakai sama sekali — versinya
     * sudah dibawa `buildRpcEnvelope` dari kontrak — padahal dokumentasinya
     * menyebut env itu sebagai cara override. Kalau dibiarkan begitu, orang
     * yang menyetel `PRESENSI_VERSION=81` akan melihat perubahannya
     * diabaikan tanpa error apa pun.
     */
    const envelope: Record<string, unknown> = {
      ...buildRpcEnvelope(object, mergedParam),
      version: PRESENSI_VERSION,
    };
    if (typeof filter === 'number') {
      envelope.filter = filter;
    }

    const { status: huluStatus, rawText } = await fetchWithRetry(PRESENSI_SERVICE_URL, {
      method: 'POST',
      headers: getSanitizedHeaders(),
      body: JSON.stringify(envelope),
    });

    let upstream: any = null;
    try {
      upstream = JSON.parse(rawText);
    } catch {
      return res
        .status(huluStatus >= 500 ? 503 : 502)
        .json(galatHulu(huluStatus, rawText, cuplikanAman));
    }

    // Login & logout tetap sukses HTTP 200 walau result null — biarkan
    // frontend yang menafsirkan; ini kontrak asli gateway.
    return res.status(200).json({
      jsonrpc: upstream.jsonrpc ?? 2,
      id_req: upstream.id_req ?? '',
      result: upstream.result ?? null,
      ...(upstream.error ? { error: upstream.error } : {}),
    });
  } catch (err: any) {
    console.error('rpc error:', err);
    const aborted = err?.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({
      error: aborted
        ? 'Server pusat tidak merespons dalam batas waktu.'
        : `Gagal menghubungi server pusat: ${err?.message ?? 'tidak diketahui'}`,
    });
  }
}
