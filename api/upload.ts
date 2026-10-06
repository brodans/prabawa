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

// src/serverless/upload.ts
var REQUEST_TIMEOUT_MS = 3e4;
var BATAS_BODY_BYTES = 20 * 1024 * 1024;
var BASE_HEADERS = {
  Accept: "application/json",
  "User-Agent": "okhttp/4.12.0",
  "Accept-Encoding": "gzip"
};
async function forward(body, contentType) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(PRESENSI_IMPORTFILE_URL, {
      method: "POST",
      // ⚠️ Content-Type **harus** diteruskan utuh, termasuk `boundary`.
      // Tanpanya gateway melihat tipe yang tidak dikenal dan menjawab
      // `-32605 Invalid Request`.
      headers: { ...BASE_HEADERS, "Content-Type": contentType },
      /*
       * `Uint8Array` bukan `Buffer`: `fetch` di Node menerima `BodyInit`
       * yang berupa `ArrayBufferView`, dan `Buffer` adalah turunannya —
       * tapi tipenya tidak dianggap kompatibel di sini karena
       * `BodyInit` berasal dari `lib.dom.d.ts` yang menunjuk `ArrayBufferView`
       * generik. Isinya sama persis, byte demi byte.
       */
      body: new Uint8Array(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}
function bodyMentah(req) {
  const mentah = req.body;
  if (Buffer.isBuffer(mentah)) return mentah;
  if (mentah instanceof ArrayBuffer) return Buffer.from(mentah);
  if (typeof mentah === "string") return Buffer.from(mentah, "binary");
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) return req.rawBody;
  return null;
}
async function handler(req, res) {
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ error: "Origin tidak diizinkan." });
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Hanya POST yang diterima." });
  }
  const diminta = String(req.query?.path ?? "");
  if (diminta !== PRESENSI_IMPORTFILE_PATH) {
    return res.status(400).json({
      error: `Endpoint ini hanya melayani ${PRESENSI_IMPORTFILE_PATH}.`
    });
  }
  const tipe = String(req.headers?.["content-type"] ?? "");
  if (!tipe.toLowerCase().startsWith("multipart/form-data")) {
    return res.status(400).json({ error: "Body harus multipart/form-data." });
  }
  const body = bodyMentah(req);
  if (!body || body.length === 0) {
    return res.status(400).json({ error: "Body kosong." });
  }
  if (body.length > BATAS_BODY_BYTES) {
    return res.status(413).json({
      error: `Lampiran terlalu besar. Batas ${Math.round(BATAS_BODY_BYTES / 1024 / 1024)} MB.`
    });
  }
  try {
    const upstream = await forward(body, tipe);
    const raw = await upstream.text();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(upstream.status >= 500 ? 503 : 502).json(galatHulu(upstream.status, raw, cuplikanAman));
    }
    return res.status(200).json({
      result: parsed?.result ?? null,
      error: parsed?.error ?? null,
      errorCode: parsed?.error?.code ?? null,
      upstreamStatus: upstream.status
    });
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? "Server pusat tidak merespons dalam batas waktu." : `Gagal menghubungi server pusat: ${err?.message ?? "tidak diketahui"}`
    });
  }
}
export {
  PRESENSI_IMPORTFILE_PATH,
  handler as default
};
