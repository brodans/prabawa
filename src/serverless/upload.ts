/**
 * Vercel Serverless Function — proxy `POST /service/importfile` (multipart).
 *
 * ⚠️ Ini satu-satunya endpoint pusat yang bukan JSON-RPC: unggah lampiran
 * pengajuan izin. Bentuk field disalin apa adanya dari
 * `PerizinanFragment$uploadImage$multipartRequest$1` (APK v89):
 *
 *   api_key, id, last_latlong (kosong), type = "ijin", part `image`
 *
 * Berbeda dengan `api/rpc.ts`, route ini **tidak** membangun envelope
 * JSON — field multipart diteruskan persis; hanya `last_latlong` yang
 * dipaksa kosong karena itulah yang selalu dikirim aplikasi.
 *
 * ⚠️⚠️ Endpoint-nya belum terverifikasi di sisi server (ENDPOINT.md §2.1):
 * path-nya hidup, tapi gateway menjawab `-32605 Invalid Request` untuk
 * semua variasi body. Fungsi ini meneruskan dan melaporkan apa adanya.
 */

import {
  PRESENSI_IMPORTFILE_PATH,
  PRESENSI_IMPORTFILE_URL,
  cuplikanAman,
  galatHulu,
} from '../lib/presensiContract';

const REQUEST_TIMEOUT_MS = 30_000;

/** Batas unggahan — sama dengan route Express. */
const BATAS_BODY_BYTES = 20 * 1024 * 1024;

/** Header yang meniru klien Android asli (Volley). */
const BASE_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'okhttp/4.12.0',
  'Accept-Encoding': 'gzip',
};

async function forward(body: Buffer, contentType: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(PRESENSI_IMPORTFILE_URL, {
      method: 'POST',
      // ⚠️ Content-Type **harus** diteruskan utuh, termasuk `boundary`.
      // Tanpanya gateway melihat tipe yang tidak dikenal dan menjawab
      // `-32605 Invalid Request`.
      headers: { ...BASE_HEADERS, 'Content-Type': contentType },
      /*
       * `Uint8Array` bukan `Buffer`: `fetch` di Node menerima `BodyInit`
       * yang berupa `ArrayBufferView`, dan `Buffer` adalah turunannya —
       * tapi tipenya tidak dianggap kompatibel di sini karena
       * `BodyInit` berasal dari `lib.dom.d.ts` yang menunjuk `ArrayBufferView`
       * generik. Isinya sama persis, byte demi byte.
       */
      body: new Uint8Array(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

import { terapkanCors } from './_cors';

/**
 * Body sebagai `Buffer`, apa pun bentuknya di platform ini.
 *
 * ⚠️ Kenapa tidak `FormData`.
 *
 * Dulu fungsi ini mengarang ulang body dari `req.body` dengan asumsi bahwa
 * isinya `FormData`. Asumsi itu benar di satu platform dan salah di platform
 * yang justru dipakai: runtime Node Vercel hanya mem-parse body untuk
 * `application/json` dan `application/x-www-form-urlencoded`. Untuk
 * `multipart/form-data` ia **menyerahkan `Buffer` mentah** — jadi
 * `typeof body.get !== 'function'` selalu terpenuhi, dan setiap unggahan
 * berakhir dengan 400 "Body harus multipart/form-data", apa pun isinya.
 *
 * Route Express sudah benar sejak awal: `express.raw({ type:
 * 'multipart/form-data' })` memberikan Buffer, lalu diteruskan apa adanya.
 * Sekarang kedua platform melakukan hal yang sama persis — termasuk tidak
 * menyentuh boundary, nama field, dan filename. Decode lalu encode-ulang
 * justru berisiko merusak part berkas.
 */
function bodyMentah(req: any): Buffer | null {
  const mentah = req.body;
  if (Buffer.isBuffer(mentah)) return mentah;
  if (mentah instanceof ArrayBuffer) return Buffer.from(mentah);
  if (typeof mentah === 'string') return Buffer.from(mentah, 'binary');
  // Beberapa runtime membungkusnya di `req.rawBody` / body ber-encoding latin1.
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) return req.rawBody;
  return null;
}

export default async function handler(req: any, res: any) {
  // Allow-list origin — lihat `api/_cors.ts`.
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ error: 'Origin tidak diizinkan.' });
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Hanya POST yang diterima.' });
  }

  /*
   * Allow-list path — sama seperti route Express. Tanpa ini, `?path=` dari
   * klien jadi open proxy ke endpoint mana pun di server pusat, hanya dengan
   * mengubah satu parameter di URL.
   */
  const diminta = String(req.query?.path ?? '');
  if (diminta !== PRESENSI_IMPORTFILE_PATH) {
    return res.status(400).json({
      error: `Endpoint ini hanya melayani ${PRESENSI_IMPORTFILE_PATH}.`,
    });
  }

  const tipe = String(req.headers?.['content-type'] ?? '');
  if (!tipe.toLowerCase().startsWith('multipart/form-data')) {
    return res.status(400).json({ error: 'Body harus multipart/form-data.' });
  }

  const body = bodyMentah(req);
  if (!body || body.length === 0) {
    return res.status(400).json({ error: 'Body kosong.' });
  }
  if (body.length > BATAS_BODY_BYTES) {
    return res.status(413).json({
      error: `Lampiran terlalu besar. Batas ${Math.round(BATAS_BODY_BYTES / 1024 / 1024)} MB.`,
    });
  }

  try {
    const upstream = await forward(body, tipe);
    const raw = await upstream.text();

    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /*
       * Endpoint ini belum terverifikasi di sisi server (`ENDPOINT.md` §2.1),
       * jadi `-32605 Invalid Request` masih satu-satunya bukti yang bisa dibaca
       * sampai jalurnya benar. Yang dikembalikan cukup **baris pertama** dari
       * badan respons — lihat `cuplikanAman`. Badannya utuh tidak pernah
       * diteruskan: isinya bisa halaman galat HTML dari proxy, yang tidak
       * menambah informasi apa pun tapi bisa jadi berukuran besar.
       */
      return res
        .status(upstream.status >= 500 ? 503 : 502)
        .json(galatHulu(upstream.status, raw, cuplikanAman));
    }

    return res.status(200).json({
      result: parsed?.result ?? null,
      error: parsed?.error ?? null,
      errorCode: parsed?.error?.code ?? null,
      upstreamStatus: upstream.status,
    });
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({
      error: aborted
        ? 'Server pusat tidak merespons dalam batas waktu.'
        : `Gagal menghubungi server pusat: ${err?.message ?? 'tidak diketahui'}`,
    });
  }
}

export { PRESENSI_IMPORTFILE_PATH };
