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
// src/lib/midtransEnv.ts
function midtransProduksi() {
  return process.env.MIDTRANS_IS_PRODUCTION === "true" || process.env.VITE_MIDTRANS_IS_PRODUCTION === "true";
}
function midtransSnapBaseUrl() {
  return midtransProduksi() ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
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

// src/serverless/midtrans-charge.ts
function serverKey() {
  return process.env.MIDTRANS_SERVER_KEY || "";
}
async function handler(req, res) {
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ error_messages: ["Origin tidak diizinkan."] });
  }
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error_messages: [`Method ${req.method} not allowed`] });
  }
  const key = serverKey();
  if (!key) {
    return res.status(500).json({
      error_messages: ["Server misconfiguration: MIDTRANS_SERVER_KEY tidak ditemukan."]
    });
  }
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  let parsedBody;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return res.status(400).json({ error_messages: ["Body harus berupa JSON yang valid."] });
  }
  if (!parsedBody?.transaction_details?.order_id) {
    return res.status(400).json({
      error_messages: ["transaction_details.order_id wajib diisi."]
    });
  }
  const auth = Buffer.from(`${key}:`).toString("base64");
  const baseUrl = midtransSnapBaseUrl();
  try {
    const upstream = await fetch(`${baseUrl}/snap/v1/transactions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`
      },
      body
    });
    const text = await upstream.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return res.status(502).json({
        error_messages: ["Respons tidak valid dari Midtrans (bukan JSON)."]
      });
    }
    const sukses = ["200", "201", "202"].includes(String(data.status_code));
    if (!sukses) {
      return res.status(422).json({
        error_messages: [
          data.error_messages?.[0] || data.status_message || `Gagal memproses (status: ${data.status_code})`
        ],
        raw: data
      });
    }
    return res.status(200).json(data);
  } catch (err) {
    const pesan = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({
      error_messages: [`Gagal terhubung ke server pembayaran: ${pesan}`]
    });
  }
}
export {
  handler as default
};
