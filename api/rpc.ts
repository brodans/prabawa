/**
 * ⚠️ BERKAS HASIL BUILD — JANGAN DIEDIT, jangan diimpor dari mana pun.
 *
 * Dibuat oleh `src/serverless/build.mts` dari `src/serverless/<nama>.ts`.
 * Sumbernya ada di `src/serverless/`; ubah sana, lalu jalankan `npm run build`.
 *
 * Alasan berkas ini harus mandiri ada di `src/serverless/build.mts`: Vercel
 * hanya mengompilasi `api/*.ts` tanpa meng-bundle, dan Node ESM tidak bisa
 * me-resolve impor relatif tanpa ekstensi — hasilnya 500
 * `FUNCTION_INVOCATION_FAILED` untuk SELURUH endpoint.
 *
 * Isinya JavaScript hasil bundel, bukan TypeScript tulis-tangan — itu sebabnya
 * `@ts-nocheck` tepat di bawah banner ini.
 */
// @ts-nocheck
/* eslint-disable */
// src/lib/presensiContract.ts
var PRESENSI_SERVICE_URL = "https://presensi.bkd.jatimprov.go.id/service";
var PRESENSI_IMPORTFILE_PATH = "/importfile";
var PRESENSI_IMPORTFILE_URL = `${PRESENSI_SERVICE_URL}${PRESENSI_IMPORTFILE_PATH}`;
var APK_VERSION_CODE = 89;
var PRESENSI_VERSION = APK_VERSION_CODE;
var INJECTED_PARAM_KEYS = ["api_key", "last_latlong", "imei"];
var RPC_OBJECTS = {
  // ── Autentikasi ──
  LOGIN: "login",
  LOGOUT: "logout",
  // ── Data referensi (semua butuh api_key valid) ──
  GET_WORK_CODE: "getworkcode",
  GET_LOKASI_ABSEN: "getlokasiabsen",
  GET_MASTER_TIPE_IJIN: "getmastertipeijin",
  JENIS_IJIN: "jenis_ijin",
  TIPE_IJIN: "tipe_ijin",
  SYNC_DATA: "syncdata",
  // ── Absensi ──
  CEK_ABSEN: "cekabsen",
  ABSEN: "absen",
  HISTORY_ABSEN: "history_absen",
  // ── Perizinan ──
  ADD_IJIN: "add_ijin",
  DELETE_IJIN: "delete_ijin",
  LIST_IJIN: "list_ijin",
  // ── Profil ──
  UPDATE_FOTO: "update_foto",
  UPDATE_PROFIL: "update_profil"
};
var RPC_REQUIRED_PARAMS = {
  [RPC_OBJECTS.LOGIN]: ["email", "password", "latlong", "imei"],
  [RPC_OBJECTS.LOGOUT]: [],
  [RPC_OBJECTS.GET_WORK_CODE]: [],
  [RPC_OBJECTS.GET_LOKASI_ABSEN]: [],
  [RPC_OBJECTS.GET_MASTER_TIPE_IJIN]: [],
  [RPC_OBJECTS.JENIS_IJIN]: ["absen", "master_tipe_ijin"],
  [RPC_OBJECTS.TIPE_IJIN]: [],
  [RPC_OBJECTS.SYNC_DATA]: [],
  // ⚠ cekabsen: work_code wajib secara bisnis ("Work Kode wajib dipilih")
  [RPC_OBJECTS.CEK_ABSEN]: ["checktype", "iswfh", "work_code"],
  [RPC_OBJECTS.ABSEN]: [
    "checktype",
    "ijin",
    "iswfh",
    "keterangan",
    "type_ijin",
    "work_code"
  ],
  [RPC_OBJECTS.HISTORY_ABSEN]: ["tgl", "page", "limit"],
  [RPC_OBJECTS.LIST_IJIN]: ["page", "limit"],
  [RPC_OBJECTS.ADD_IJIN]: [
    "tgl_ijin",
    "tgl_ijin_sampai",
    "alasan",
    "jenis_ijin",
    "tipe_ijin"
  ],
  [RPC_OBJECTS.DELETE_IJIN]: ["id"],
  // update_foto: decompilasi v89 (UploadPhotoViewModel.uploadPhoto) mengirim
  // tiga key sekaligus — `image` = "foto.png", `image64` = base64 isi
  // berkas, `vektor` = embedding wajah (512 float, dipisah koma).
  [RPC_OBJECTS.UPDATE_FOTO]: ["image", "image64", "vektor"],
  // update_profil: ProfileFragment v89 hanya mengirim dua key ini.
  [RPC_OBJECTS.UPDATE_PROFIL]: ["password_lama", "password"]
};
function buildRpcEnvelope(object, param) {
  return {
    jsonrpc: 2,
    method: "POST",
    version: PRESENSI_VERSION,
    object,
    param
  };
}
var RPC_BISA_ULANG = [
  RPC_OBJECTS.GET_WORK_CODE,
  RPC_OBJECTS.GET_LOKASI_ABSEN,
  RPC_OBJECTS.GET_MASTER_TIPE_IJIN,
  RPC_OBJECTS.JENIS_IJIN,
  RPC_OBJECTS.TIPE_IJIN,
  RPC_OBJECTS.HISTORY_ABSEN,
  RPC_OBJECTS.LIST_IJIN
];
function cuplikanAman(teks) {
  const barisPertama = teks.split(/\r?\n/).find((baris) => baris.trim().length > 0) ?? "";
  return barisPertama.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}
function galatHulu(status, rawText, cuplikan) {
  const teks = rawText.trim();
  if (teks.length === 0) {
    return {
      // 503, bukan 502: 502 berarti "proxy gagal meneruskan", sedangkan di
      // sini sesasinya berhasil dan **server pusat** yang sedang bermasalah.
      // Klien memakai status ini untuk memutuskan apakah perlu mencoba lagi,
      // jadi 503 (hulu) dipetakan ke 503 (proxy) — bukan ke 502.
      error: "Server pusat sedang tidak melayani. Data belum berhasil dimuat \u2014 ini gangguan sesaat di sisi server pusat, bukan pada akun atau perangkat ini. Coba lagi beberapa saat lagi.",
      huluStatus: status,
      huluKosong: true,
      cuplikan: ""
    };
  }
  return {
    error: "Server pusat mengembalikan halaman galat, bukan data. Permintaan sudah diterima tetapi jawabannya tidak bisa dibaca.",
    huluStatus: status,
    huluKosong: false,
    cuplikan: cuplikan(teks)
  };
}

// src/serverless/_cors.ts
var HOST_LOKAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function lengkapiSkema(origin) {
  if (origin.includes("://")) return origin;
  if (origin === "*") return origin;
  const denganPort = /^[^/:]+:\d+$/.test(origin);
  if (HOST_LOKAL.test(origin) || denganPort && HOST_LOKAL.test(origin.split(":")[0])) {
    return `http://${origin}`;
  }
  return `https://${origin}`;
}
function daftarOrigin() {
  return (process.env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean).map(lengkapiSkema);
}
function originMilikSendiri() {
  const asal = [];
  for (const nama of ["VERCEL_URL", "VERCEL_BRANCH_URL"]) {
    const nilai = process.env[nama];
    if (!nilai) continue;
    asal.push(lengkapiSkema(String(nilai).trim()));
  }
  return asal;
}
function asalDiizinkan(origin) {
  if (!origin) return true;
  const cari = lengkapiSkema(origin.trim()).toLowerCase();
  if (originMilikSendiri().some((item) => item.toLowerCase() === cari)) return true;
  const daftar = daftarOrigin();
  if (daftar.includes("*")) return true;
  return daftar.some((item) => item.toLowerCase() === cari);
}
function terapkanCors(res, origin) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  if (!asalDiizinkan(origin)) {
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  return true;
}

// src/serverless/rpc.ts
var PRESENSI_SERVICE_URL2 = process.env.PRESENSI_BASE_URL || "https://presensi.bkd.jatimprov.go.id/service";
var PRESENSI_VERSION2 = Number(process.env.PRESENSI_VERSION || PRESENSI_VERSION);
var REQUEST_TIMEOUT_MS = 15e3;
var MAX_RETRIES = 2;
var BASE_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  Accept: "application/json",
  "User-Agent": "okhttp/4.12.0",
  "Accept-Encoding": "gzip"
};
function getSanitizedHeaders() {
  return { ...BASE_HEADERS };
}
function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}
async function fetchWithRetry(url, init, retries = MAX_RETRIES, timeoutMs = REQUEST_TIMEOUT_MS) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { signal, done } = withTimeout(timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal });
      const rawText = await response.text();
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
    await new Promise((resolve) => setTimeout(resolve, attempt * 800 + 400));
  }
  throw lastError instanceof Error ? lastError : new Error("Gagal menghubungi server pusat");
}
async function handler(req, res) {
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ error: "Origin tidak diizinkan." });
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  try {
    const { object, param, filter } = req.body ?? {};
    if (!object || typeof object !== "string") {
      return res.status(400).json({ error: 'Field "object" (nama RPC) wajib diisi.' });
    }
    if (!/^[a-z0-9_]{2,40}$/i.test(object)) {
      return res.status(400).json({ error: "Nama RPC tidak valid." });
    }
    const incomingParam = param && typeof param === "object" ? param : {};
    const disuntik = {
      api_key: incomingParam.api_key ?? "",
      last_latlong: incomingParam.last_latlong ?? "",
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
      imei: incomingParam.imei ?? ""
    };
    const mergedParam = { ...incomingParam };
    for (const kunci of INJECTED_PARAM_KEYS) mergedParam[kunci] = disuntik[kunci];
    const envelope = {
      ...buildRpcEnvelope(object, mergedParam),
      version: PRESENSI_VERSION2
    };
    if (typeof filter === "number") {
      envelope.filter = filter;
    }
    const { status: huluStatus, rawText } = await fetchWithRetry(PRESENSI_SERVICE_URL2, {
      method: "POST",
      headers: getSanitizedHeaders(),
      body: JSON.stringify(envelope)
    });
    let upstream = null;
    try {
      upstream = JSON.parse(rawText);
    } catch {
      return res.status(huluStatus >= 500 ? 503 : 502).json(galatHulu(huluStatus, rawText, cuplikanAman));
    }
    return res.status(200).json({
      jsonrpc: upstream.jsonrpc ?? 2,
      id_req: upstream.id_req ?? "",
      result: upstream.result ?? null,
      ...upstream.error ? { error: upstream.error } : {}
    });
  } catch (err) {
    console.error("rpc error:", err);
    const aborted = err?.name === "AbortError";
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? "Server pusat tidak merespons dalam batas waktu." : `Gagal menghubungi server pusat: ${err?.message ?? "tidak diketahui"}`
    });
  }
}
export {
  handler as default
};
