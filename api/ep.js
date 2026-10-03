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
// src/lib/epTarget.ts
var EP_TARGET_BAWAAN = "https://presensi.bkd.jatimprov.go.id";
function asalDari(nilai, namaVar) {
  try {
    return new URL(nilai).origin;
  } catch {
    throw new Error(
      `${namaVar} bukan URL yang valid: ${JSON.stringify(nilai)}. Contoh yang benar: ${EP_TARGET_BAWAAN}`
    );
  }
}
function epTargetOrigin() {
  const khusus = process.env.EP_TARGET_ORIGIN?.trim();
  if (khusus) return asalDari(khusus, "EP_TARGET_ORIGIN");
  const dasar = process.env.PRESENSI_BASE_URL?.trim();
  if (dasar) return asalDari(dasar, "PRESENSI_BASE_URL");
  return EP_TARGET_BAWAAN;
}
function epAsalRegex() {
  const host = new URL(epTargetOrigin()).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https?://${host}`, "i");
}

// src/serverless/ep.ts
var TARGET = epTargetOrigin();
var TARGET_ORIGIN = new URL(TARGET).origin;
var ASAL_UPSTREAM = epAsalRegex();
var HOP_BY_HOP_REQUEST = /* @__PURE__ */ new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade"
]);
var HOP_BY_HOP_RESPONSE = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade"
]);
function rewriteLocation(loc) {
  let baru = loc.replace(ASAL_UPSTREAM, "");
  if (!baru.startsWith("/")) baru = "/" + baru;
  if (!/^\/ep(\/|$)/.test(baru)) baru = "/ep" + baru;
  baru = baru.replace(/\/index\.php\//g, "/p/");
  return baru;
}
function rewriteSetCookie(cookies) {
  const list = Array.isArray(cookies) ? cookies : [cookies];
  return list.map(
    (cookie) => cookie.replace(/;\s*domain=[^;]*/gi, "").replace(/;\s*path=\//gi, "; Path=/ep").replace(/;\s*secure/gi, "")
  );
}
async function handler(req, res) {
  const originalUrl = req.url || "/";
  const matchedPath = req.headers?.["x-matched-path"] || "";
  const rewriteSrc = req.headers?.["x-vercel-rewrite-source"] || "";
  const sourceUrl = rewriteSrc || matchedPath || originalUrl;
  console.log(`[ep] method=${req.method} url=${originalUrl} matched=${matchedPath} rewrite-src=${rewriteSrc}`);
  let upstreamPath = sourceUrl.replace(/^\/api\/ep/, "").replace(/^\/ep/, "");
  if (!upstreamPath.startsWith("/")) upstreamPath = "/" + upstreamPath;
  if (!upstreamPath) upstreamPath = "/";
  upstreamPath = upstreamPath.replace(/^\/p(\/|$)/, "/index.php$1");
  const upstreamUrl = `${TARGET}${upstreamPath}`;
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP_REQUEST.has(key.toLowerCase()) && typeof value === "string") {
      headers[key] = value;
    }
  }
  headers["host"] = new URL(TARGET).host;
  headers["referer"] = TARGET_ORIGIN + "/";
  headers["origin"] = TARGET_ORIGIN;
  let body;
  const method = req.method || "GET";
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const bodyLangsung = req.body;
    if (bodyLangsung !== void 0 && bodyLangsung !== null) {
      let raw;
      if (Buffer.isBuffer(bodyLangsung)) {
        raw = bodyLangsung;
      } else if (typeof bodyLangsung === "string") {
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
    } else if (typeof req.on === "function") {
      const raw = await new Promise((resolve) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", () => resolve(Buffer.alloc(0)));
      });
      if (raw.length > 0) {
        const ab = new ArrayBuffer(raw.length);
        const view = new Uint8Array(ab);
        for (let i = 0; i < raw.length; i++) view[i] = raw[i];
        body = ab;
      }
    }
  }
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: "manual"
      // Tangani redirect manual agar bisa menulis ulang Location
    });
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      error: "Gagal menghubungi server e-Presensi",
      detail: e instanceof Error ? e.message : String(e)
    }));
    return;
  }
  res.statusCode = upstreamRes.status;
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (HOP_BY_HOP_RESPONSE.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === "location") {
      res.setHeader("Location", rewriteLocation(value));
    } else if (key.toLowerCase() === "set-cookie") {
      const rewritten = rewriteSetCookie(value);
      for (const cookie of rewritten) {
        res.appendHeader("Set-Cookie", cookie);
      }
    } else {
      try {
        res.setHeader(key, value);
      } catch {
      }
    }
  }
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  const buffer = Buffer.from(await upstreamRes.arrayBuffer());
  res.end(buffer);
}
export {
  handler as default
};
