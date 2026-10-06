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

// src/serverless/ep.ts
var TARGET = epTargetOrigin();
var TARGET_ORIGIN = new URL(TARGET).origin;
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
  "upgrade",
  // Node.js fetch sudah decompress body otomatis — kalau header ini ikut
  // diteruskan, browser mencoba decompress lagi dan gagal (ERR_CONTENT_DECODING_FAILED)
  "content-encoding",
  "content-length"
  // panjang berubah setelah decompress
]);
function rewriteLocation(loc) {
  let baru = loc;
  try {
    const u = new URL(loc);
    baru = u.pathname + u.search + u.hash;
  } catch {
  }
  if (!baru.startsWith("/")) baru = "/" + baru;
  if (!/^\/ep(\/|$)/.test(baru)) baru = "/ep" + baru;
  baru = baru.replace(/\/index\.php(\/|$)/g, "/p$1");
  return baru;
}
function rewriteSetCookie(cookies) {
  const isProd = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const list = Array.isArray(cookies) ? cookies : [cookies];
  return list.map((cookie) => {
    let c = cookie.replace(/;\s*domain=[^;]*/gi, "").replace(/;\s*path=[^;]*/gi, "; Path=/ep");
    if (isProd) {
      if (!/;\s*secure/i.test(c)) c += "; Secure";
      if (!/;\s*samesite=/i.test(c)) c += "; SameSite=Lax";
    } else {
      c = c.replace(/;\s*secure/gi, "");
    }
    return c;
  });
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
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-for"];
  for (const k of Object.keys(headers)) {
    const turun = k.toLowerCase();
    if (turun === "content-length" || turun === "content-encoding") delete headers[k];
  }
  let body;
  const method = req.method || "GET";
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const bodyLangsung = req.body;
    const contentType = String(req.headers?.["content-type"] || "");
    if (bodyLangsung !== void 0 && bodyLangsung !== null) {
      let raw;
      if (Buffer.isBuffer(bodyLangsung)) {
        raw = bodyLangsung;
      } else if (typeof bodyLangsung === "string") {
        raw = Buffer.from(bodyLangsung);
      } else if (bodyLangsung instanceof Uint8Array) {
        raw = Buffer.from(bodyLangsung);
      } else if (typeof bodyLangsung === "object" && contentType.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(bodyLangsung)) {
          params.append(k, String(v));
        }
        raw = Buffer.from(params.toString(), "utf-8");
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
    console.log(`[ep] body-type=${typeof bodyLangsung} content-type=${contentType.slice(0, 60)} body-len=${body?.byteLength ?? 0}`);
  }
  let upstreamRes;
  try {
    if (method === "POST") {
      let nextUrl = upstreamUrl;
      let nextMethod = method;
      let nextBody = body ? new Uint8Array(body) : void 0;
      const hopHeaders = { ...headers };
      for (let hop = 0; hop < 8; hop++) {
        upstreamRes = await fetch(nextUrl, {
          method: nextMethod,
          headers: hopHeaders,
          body: nextBody,
          redirect: "manual"
        });
        const st = upstreamRes.status;
        if (st < 300 || st >= 400) break;
        const loc = upstreamRes.headers.get("location");
        if (!loc) break;
        try {
          nextUrl = new URL(loc, nextUrl).href;
        } catch {
          break;
        }
        if ((st === 302 || st === 303) && nextMethod === "POST") {
          nextMethod = "GET";
          nextBody = void 0;
          delete hopHeaders["content-type"];
          delete hopHeaders["content-length"];
        }
      }
    } else {
      upstreamRes = await fetch(upstreamUrl, {
        method,
        headers,
        body,
        redirect: "manual"
      });
    }
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
  const cookieMasuk = req.headers?.["cookie"] || "(tidak ada)";
  const setCookieKeluar = upstreamRes.headers.get("set-cookie") || "(tidak ada)";
  const locationKeluar = upstreamRes.headers.get("location") || "";
  console.log(`[ep] upstream=${upstreamPath} status=${upstreamRes.status} cookie-masuk=${String(cookieMasuk).slice(0, 80)} set-cookie=${String(setCookieKeluar).slice(0, 120)} location=${locationKeluar}`);
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
