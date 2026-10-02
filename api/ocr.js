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
// src/serverless/ocr.ts
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

// src/serverless/ocr.ts
var MAX_BODY = 2 * 1024 * 1024;
var PANJANG_CAPTCHA = 4;
function cariDirModel() {
  const kandidat = [];
  if (typeof import.meta.url === "string") {
    try {
      kandidat.push(dirname(fileURLToPath(import.meta.url)));
    } catch {
    }
  }
  if (typeof __dirname === "string") kandidat.push(__dirname);
  kandidat.push(join(process.cwd(), "api"));
  kandidat.push(process.cwd());
  kandidat.push("/var/task/api");
  kandidat.push("/var/task");
  for (const dir of kandidat) {
    if (existsSync(join(dir, "model", "ocr.onnx"))) return dir;
  }
  throw new Error(
    "model/ocr.onnx tidak ditemukan. Dicoba di: " + [...new Set(kandidat)].join(", ") + ". Pastikan folder model ikut ter-deploy bersama api/ocr.js."
  );
}
var _modelPath = null;
var _charsetPath = null;
function getModelPaths() {
  if (_modelPath && _charsetPath) return { modelPath: _modelPath, charsetPath: _charsetPath };
  const dir = cariDirModel();
  _modelPath = join(dir, "model", "ocr.onnx");
  _charsetPath = join(dir, "model", "charset.json");
  return { modelPath: _modelPath, charsetPath: _charsetPath };
}
var _session = null;
var _charset = null;
async function muatModel() {
  if (_session && _charset) return { session: _session, charset: _charset };
  const { modelPath, charsetPath } = getModelPaths();
  const ort = await import("onnxruntime-node");
  if (!_session) {
    const InferenceSession = ort.InferenceSession ?? ort.default?.InferenceSession;
    _session = await InferenceSession.create(modelPath, {
      executionProviders: ["cpu"]
    });
  }
  if (!_charset) {
    _charset = JSON.parse(readFileSync(charsetPath, "utf-8"));
  }
  return { session: _session, charset: _charset };
}
async function preprocessGambar(gambar) {
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default ?? sharpMod;
  const { data, info } = await sharp(gambar).resize(224, 64, { fit: "fill" }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const tensor = new Float32Array(H * W);
  for (let i = 0; i < H * W; i++) {
    tensor[i] = (data[i] / 255 - 0.5) / 0.5;
  }
  return tensor;
}
function ctcDecode(indices, charset) {
  const hasil = [];
  let sebelumnya = -1;
  for (const i of indices) {
    if (i !== sebelumnya && i !== 0) {
      if (charset[i]) hasil.push(charset[i]);
    }
    sebelumnya = i;
  }
  return hasil.join("");
}
async function selesaikanCaptcha(gambar) {
  const { session, charset } = await muatModel();
  const ortMod = await import("onnxruntime-node");
  const ort = ortMod.default ?? ortMod;
  const tensorData = await preprocessGambar(gambar);
  const tensor = new ort.Tensor("float32", tensorData, [1, 1, 64, 224]);
  const inputName = session.inputNames[0];
  const feeds = { [inputName]: tensor };
  const results = await session.run(feeds);
  const outputName = session.outputNames[0];
  const output = results[outputName];
  const logits = output.data;
  const dims = output.dims;
  let T, C;
  if (dims.length === 3) {
    T = dims[0];
    C = dims[2];
  } else if (dims.length === 2) {
    T = dims[0];
    C = dims[1];
  } else {
    throw new Error(`Shape output tidak dikenali: ${dims.join("\xD7")}`);
  }
  const digitSet = /* @__PURE__ */ new Set([0, ...charset.map((c, i) => /^[0-9]$/.test(c) ? i : -1).filter((i) => i >= 0)]);
  const argmaxDigit = [];
  const argmaxBebas = [];
  for (let t = 0; t < T; t++) {
    const offset = t * C;
    let maxDigit = -Infinity, idxDigit = 0;
    let maxBebas = -Infinity, idxBebas = 0;
    for (let c = 0; c < C; c++) {
      const val = logits[offset + c];
      if (val > maxBebas) {
        maxBebas = val;
        idxBebas = c;
      }
      if (digitSet.has(c) && val > maxDigit) {
        maxDigit = val;
        idxDigit = c;
      }
    }
    argmaxDigit.push(idxDigit);
    argmaxBebas.push(idxBebas);
  }
  const teksDigit = ctcDecode(argmaxDigit, charset);
  const teksBebas = ctcDecode(argmaxBebas, charset);
  const kandidat = [];
  for (const t of [teksDigit, teksBebas]) {
    if (t && !kandidat.includes(t)) kandidat.push(t);
  }
  const utama = kandidat.find((k) => k.length === PANJANG_CAPTCHA && /^\d+$/.test(k)) || kandidat.find((k) => k.length === PANJANG_CAPTCHA) || kandidat[0] || "";
  return {
    ok: true,
    text: utama,
    kandidat,
    yakin: utama.length === PANJANG_CAPTCHA && /^\d+$/.test(utama),
    panjang: PANJANG_CAPTCHA
  };
}
function kirimJson(res, kode, data) {
  const body = JSON.stringify(data);
  res.statusCode = kode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}
async function handler(req, res) {
  if (!terapkanCors(res, req.headers?.origin)) {
    res.statusCode = 403;
    res.end(JSON.stringify({ ok: false, error: "Origin tidak diizinkan" }));
    return;
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (typeof req?.on !== "function") {
    kirimJson(res, 400, {
      ok: false,
      error: "Body permintaan harus berupa stream (req.on tidak tersedia). Endpoint ini menerima byte gambar mentah, bukan JSON."
    });
    return;
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method === "GET") {
    try {
      await muatModel();
      kirimJson(res, 200, { ok: true, engine: "onnx-ddddocr", panjang: PANJANG_CAPTCHA });
    } catch (e) {
      kirimJson(res, 503, { ok: false, error: String(e) });
    }
    return;
  }
  if (req.method !== "POST") {
    kirimJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  const gambar = await new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total <= MAX_BODY) chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.alloc(0)));
  });
  if (!gambar.length) {
    kirimJson(res, 400, { ok: false, error: "body gambar kosong" });
    return;
  }
  try {
    const hasil = await selesaikanCaptcha(gambar);
    kirimJson(res, 200, hasil);
  } catch (e) {
    kirimJson(res, 500, {
      ok: false,
      error: `OCR gagal: ${e instanceof Error ? e.message : String(e)}`
    });
  }
}
export {
  handler as default
};
