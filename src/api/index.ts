/**
 * Client API untuk PRABAWA (Portal Presensi Jawa Timur).
 *
 * Semua panggilan frontend TIDAK pernah menyentuh host pusat secara
 * langsung — semuanya lewat /api/rpc (Vercel serverless) atau
 * route yang sama di Express dev server. Tujuannya:
 *   1. Menutupi CORS di sisi browser.
 *   2. Menyembunyikan host pusat + TechMark (androidId) dari client.
 *   3. Menormalkan envelope JSON-RPC.
 */

import {
  type BaseRpcParam,
  type RpcRequestBody,
  type RpcResponse,
  type RpcObject,
  bolehUlang,
} from '../lib/presensiContract';

/**
 * Error dari gateway pusat, dengan kode angkanya ikut terbawa.
 *
 * Kode yang paling penting di sisi UI adalah `402` — artinya akun sudah
 * terdaftar pada perangkat lain dan `imei` yang dikirim tidak cocok.
 * Tanpa kode ini, UI tidak bisa membedakan "password salah" dari
 * "perangkat tidak dikenali" karena keduanya sama-sama `result: null`.
 */
export interface ApiTrafficEntry {
  id: number;
  endpoint: string;
  payload: Record<string, any>;
  response?: any;
  error?: string;
  status?: number;
  duration: number;
  timestamp: string;
}

type ApiTrafficListener = (entry: ApiTrafficEntry) => void;
const trafficListeners = new Set<ApiTrafficListener>();
let trafficSequence = 0;

export const subscribeToApiTraffic = (listener: ApiTrafficListener) => {
  trafficListeners.add(listener);
  return () => trafficListeners.delete(listener);
};

const publishApiTraffic = (entry: Omit<ApiTrafficEntry, 'id'>) => {
  const completeEntry = { ...entry, id: ++trafficSequence };
  trafficListeners.forEach(listener => listener(completeEntry));
};

export class RpcError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

/*
 * ⚠️ Hanya `503` dari proxy kita sendiri yang layak diulang, yaitu "server
 * pusat sedang tidak melayani". `502` berarti proxy gagal meneruskan dan
 * penyebabnya biasanya permanen (URL salah, CORS, konfigurasi rusak) —
 * mengulangnya hanya menambah beban tanpa ada peluang untuk berhasil.
 */

/**
 * Berapa lama menunggu sebelum mengulang permintaan yang gagal.
 *
 * 900 ms dipilih karena dua-duanya harus benar: cukup lama untuk gateway
 * pusat yang sedang galat sesaat selesai, dan cukup pendek sehingga pengguna
 * tidak sempat menekan "Muat Ulang" duluan lalu memunculkan dua permintaan
 * untuk data yang sama.
 */
const TUNDA_ULANG_MS = 900;

/** Tunggu sebentar, atau batalkan lebih dulu kalau pemanggil sudah menyerah. */
function tungguUlangan(signal: AbortSignal | undefined, ms: number): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const id = setTimeout(done, ms);
    function done() {
      clearTimeout(id);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Kirim satu panggilan JSON-RPC ke gateway pusat lewat proxy.
 *
 * ## Percobaan ulang untuk objek yang hanya membaca
 *
 * Proxy membalas `503` kalau server pusat mengembalikan `5xx` atau badan
 * kosong — keadaan yang terverifikasi terjadi sesaat di sisi server pusat
 * (`getlokasiabsen` sesekali membalas `HTTP 500` dengan badan nol byte).
 * Semula keadaan itu langsung tampil sebagai halaman galat, padahal
 * permintaan yang identik berhasil beberapa detik kemudian.
 *
 * Sekarang `503` dicoba **satu kali** lagi — dan hanya untuk objek yang
 * tercatat aman di `RPC_BISA_ULANG`. Objek yang mengubah data di server
 * (`absen`, `cekabsen`, `add_ijin`, …) tidak pernah diulang, supaya
 * kegagalan sesaat tidak berubah jadi catatan ganda.
 *
 * @param object nama RPC, cth. 'getworkcode', 'cekabsen', 'add_ijin'
 * @param param  payload; api_key / last_latlong / imei disuntik di server
 * @param options signal untuk membatalkan permintaan (mis. saat pindah halaman)
 */
export const rpc = async <T = any>(
  object: RpcObject | string,
  param: BaseRpcParam = {},
  options: { signal?: AbortSignal } = {}
): Promise<T | null> => {
  for (let percobaan = 0; ; percobaan++) {
    try {
      return await kirimRpc<T>(object, param, options);
    } catch (err: any) {
      const boleh = percobaan === 0 && bolehUlang(object) && err?.huluStatus === 503;
      if (!boleh) throw err;
      await tungguUlangan(options.signal, TUNDA_ULANG_MS);
      if (options.signal?.aborted) throw err;
    }
  }
};

/** Satu percobaan, tanpa pengulangan. Lihat `rpc()` untuk alasannya. */
const kirimRpc = async <T = any>(
  object: RpcObject | string,
  param: BaseRpcParam = {},
  options: { signal?: AbortSignal } = {}
): Promise<T | null> => {
  const url = '/api/rpc';
  const startedAt = performance.now();
  const requestTimestamp = new Date().toISOString();
  const body: RpcRequestBody = { object, param };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (fetchErr: any) {
    const message = `Koneksi gagal: ${fetchErr?.message ?? 'tidak diketahui'}`;
    publishApiTraffic({
      endpoint: object,
      payload: body,
      error: message,
      duration: Math.round(performance.now() - startedAt),
      timestamp: requestTimestamp,
    });
    throw new Error(message);
  }

  const responseText = await response.text();

  if (!response.ok) {
    let errorMessage: string | null = null;
    try {
      const errJson = JSON.parse(responseText);
      if (errJson && (errJson.error || errJson.message)) {
        errorMessage = errJson.error || errJson.message;
      }
    } catch {
      // abaikan, pakai pesan generik
    }
    const message = errorMessage || `HTTP Error ${response.status}: ${responseText.slice(0, 200)}`;
    publishApiTraffic({
      endpoint: object,
      payload: body,
      error: message,
      status: response.status,
      duration: Math.round(performance.now() - startedAt),
      timestamp: requestTimestamp,
    });
    /*
     * Status hulu ikut dibawa ke error supaya `rpc()` bisa membedakan
     * "server pusat sedang galat sesaat" ( layak diulang ) dari galat lain.
     * Hanya diisi di jalur galat HTTP — di jalur 200 tidak pernah ada.
     */
    let huluStatus = 0;
    try {
      const bad = JSON.parse(responseText);
      if (typeof bad?.huluStatus === 'number') huluStatus = bad.huluStatus;
    } catch {
      // abaikan: bentuk galat tidak dikenal, dianggap tidak layak diulang
    }
    const err = new Error(message) as Error & { huluStatus: number };
    err.huluStatus = huluStatus;
    throw err;
  }

  let parsed: RpcResponse<T> & { error?: string; errorCode?: number; message?: string };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    const isHtml =
      responseText.trim().startsWith('<!doctype') ||
      responseText.trim().startsWith('<html') ||
      responseText.trim().startsWith('<!DOCTYPE');
    const message = isHtml
      ? 'Gagal memuat data dari server pusat (menerima halaman HTML). Silakan segarkan halaman dan coba lagi.'
      : `Gagal membaca respons server (format tidak valid): ${responseText.slice(0, 200)}`;
    throw new Error(message);
  }

  // Proxy sudah meratakan: bentuk { jsonrpc, id_req, result } atau { error, errorCode }.
  if (parsed.error) {
    publishApiTraffic({
      endpoint: object,
      payload: body,
      error: parsed.error,
      status: parsed.errorCode ?? response.status,
      duration: Math.round(performance.now() - startedAt),
      timestamp: requestTimestamp,
    });
    throw new RpcError(parsed.error, parsed.errorCode);
  }


  publishApiTraffic({
    endpoint: object,
    payload: body,
    response: parsed,
    status: response.status,
    duration: Math.round(performance.now() - startedAt),
    timestamp: requestTimestamp,
  });

  // Kegagalan bisnis = result null, bukan exception.
  return (parsed.result ?? null) as T | null;
};

/**
 * Teruskan satu request `multipart/form-data` ke proxy `/api/upload`.
 *
 * ⚠️ Endpoint ini hanya untuk `POST /importfile` — lampiran pengajuan
 * izin. Semua fungsi lain lewat `rpc()` (JSON-RPC ke `/api/rpc`).
 * Bentuk field-nya disalin apa adanya dari
 * `PerizinanFragment$uploadImage$multipartRequest$1` (APK v89):
 * `api_key`, `id`, `last_latlong` (kosong), `type` = "ijin", dan part
 * berkas bernama `image`.
 *
 * Proxy meneruskan body apa adanya (tanpa decode), jadi boundary tetap
 * milik browser dan nama field/filename tidak berubah di tengah jalan.
 *
 * @param parts nama field → nilai; `File` dikirim sebagai bagian berkas
 *              dengan nama field yang sama seperti di aplikasi.
 */
export const uploadMultipart = async <T = any>(
  path: string,
  parts: Record<string, string | File>
): Promise<T | null> => {
  const url = `/api/upload?path=${encodeURIComponent(path)}`;
  const startedAt = performance.now();
  const requestTimestamp = new Date().toISOString();

  const form = new FormData();
  Object.entries(parts).forEach(([name, value]) => {
    form.append(name, value);
  });

  // ⚠️ Jangan set Content-Type: browser yang menambahkan boundary.
  const response = await fetch(url, { method: 'POST', body: form });

  const responseText = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Respons unggah tidak valid (${responseText.slice(0, 200)})`);
  }

  if (!response.ok || parsed.error) {
    // Proxy meratakan `error` gateway jadi objek { message, code }, jadi
    // pesannya harus diambil dari sana — bukan di-string-ify-mentah.
    const message =
      parsed.error && typeof parsed.error === 'object'
        ? `Gateway menolak unggahan: ${parsed.error.message ?? 'tidak diketahui'}`
        : parsed.error || parsed.message || `HTTP ${response.status}`;
    publishApiTraffic({
      endpoint: `POST ${path}`,
      payload: { parts: Object.keys(parts) },
      error: message,
      status: parsed.errorCode ?? response.status,
      duration: Math.round(performance.now() - startedAt),
      timestamp: requestTimestamp,
    });
    throw new RpcError(message, parsed.errorCode);
  }

  publishApiTraffic({
    endpoint: `POST ${path}`,
    payload: { parts: Object.keys(parts) },
    response: parsed,
    status: response.status,
    duration: Math.round(performance.now() - startedAt),
    timestamp: requestTimestamp,
  });

  return (parsed.result ?? null) as T | null;
};

