/**
 * ⚠️ BERKAS HASIL BUILD — JANGAN DIEDIT, jangan diimpor dari mana pun.
 *
 * Dibuat oleh `src/serverless/build.mjs` dari `src/serverless/<nama>.ts`.
 * Sumbernya ada di `src/serverless/`; ubah sana, lalu jalankan `npm run build`.
 *
 * Alasan berkas ini harus mandiri ada di `src/serverless/build.mjs`: Vercel
 * hanya mengompilasi `api/*.ts` tanpa meng-bundle, dan Node ESM tidak bisa
 * me-resolve impor relatif tanpa ekstensi — hasilnya 500
 * `FUNCTION_INVOCATION_FAILED` untuk SELURUH endpoint.
 */
/* eslint-disable */
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
function allowListKosong() {
  return daftarOrigin().length === 0;
}
var PETUNUK_KONFIGURASI = "Isi environment variable ALLOWED_ORIGINS di dashboard Vercel (Settings \u2192 Environment Variables), berisi domain aplikasimu, pisah koma kalau lebih dari satu. Contoh: https://app.example.go.id";
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

// src/serverless/health.ts
async function handler(req, res) {
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ ok: false });
  }
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  const originKosong = allowListKosong();
  const midtransSiap = Boolean(process.env.MIDTRANS_SERVER_KEY);
  const firebaseSiap = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CLOUD_PROJECT || process.env.K_SERVICE
  );
  const panelSecret = (process.env.PANEL_SESSION_SECRET ?? "").trim();
  const panelAuthSiap = panelSecret.length >= 32;
  return res.status(200).json({
    ok: true,
    service: process.env.PRESENSI_BASE_URL || "https://presensi.bkd.jatimprov.go.id/service",
    version: Number(process.env.PRESENSI_VERSION || 89),
    midtrans: midtransSiap,
    /*
     * Ringkasan konfigurasi per fitur.
     *
     * `ok: true` hanya berarti server hidup — bukan berarti fiturnya bisa
     * dipakai. Kondisi yang membuat bug seperti `ALLOWED_ORIGINS` kosong
     * sulit dicari: server sehat, halaman termuat, tapi tidak satu pun API
     * call berhasil. Kedua keadaan itu harus bisa dibedakan dari luar.
     */
    konfigurasi: {
      origin: !originKosong,
      firebase: firebaseSiap,
      midtrans: midtransSiap,
      panelAuth: panelAuthSiap
    },
    /*
     * Allow-list **setelah** dilengkapi skema — persis yang dibandingkan
     * terhadap `Origin` dari browser.
     *
     * Ini yang membuat kesalahan ketik bisa dilihat. allow-list `prabawa.vercel.app`
     * dan `Origin: https://prabawa.vercel.app` terlihat berbeda di teks, tapi
     * setelah normalisasi keduanya jelas sama, dan operator tahu apa yang
     * sebenarnya dibandingkan.
     */
    origin: {
      diterima: req.headers?.origin ?? null,
      diizinkan: daftarOrigin()
    },
    // Peringatan yang bisa langsung dikerjakan. Kosong bila semuanya beres.
    peringatan: [
      ...originKosong ? [`ALLOWED_ORIGINS belum diisi \u2014 ${PETUNUK_KONFIGURASI}`] : [],
      ...firebaseSiap ? [] : [
        "Kredensial Firebase Admin belum diisi \u2014 endpoint aktivasi akan menjawab 503 sampai FIREBASE_SERVICE_ACCOUNT (JSON inline) atau GOOGLE_APPLICATION_CREDENTIALS diisi."
      ],
      ...midtransSiap ? [] : ["MIDTRANS_SERVER_KEY belum diisi \u2014 metode QRIS otomatis disembunyikan dari pengguna."],
      ...panelAuthSiap ? [] : panelSecret ? [
        "PANEL_SESSION_SECRET belum diisi atau terlalu pendek (minimal 32 karakter) \u2014 seluruh login panel akan ditolak dengan 503 sampai variabel ini diisi."
      ] : ["PANEL_SESSION_SECRET belum diisi \u2014 seluruh login panel akan ditolak dengan 503."]
    ]
  });
}
export {
  handler as default
};
