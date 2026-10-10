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
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/firestoreAman.ts
function objekPolos(nilai) {
  if (nilai === null || typeof nilai !== "object") return false;
  const proto = Object.getPrototypeOf(nilai);
  return proto === Object.prototype || proto === null;
}
function bersihkanNilai(nilai, dalam) {
  if (dalam > 20) return nilai;
  if (Array.isArray(nilai)) {
    return nilai.map((item) => bersihkanNilai(item, dalam + 1));
  }
  if (!objekPolos(nilai)) return nilai;
  const hasil = {};
  for (const [kunci, isi] of Object.entries(nilai)) {
    if (isi === void 0) continue;
    hasil[kunci] = bersihkanNilai(isi, dalam + 1);
  }
  return hasil;
}
function bersihkanUndefined(data) {
  if (data === null || data === void 0) return {};
  if (!objekPolos(data)) return data;
  const hasil = {};
  for (const [kunci, nilai] of Object.entries(data)) {
    if (nilai === void 0) continue;
    if (Array.isArray(nilai)) {
      hasil[kunci] = nilai.filter((item) => item !== void 0).map((item) => bersihkanNilai(item, 1));
      continue;
    }
    hasil[kunci] = bersihkanNilai(nilai, 1);
  }
  return hasil;
}
var init_firestoreAman = __esm({
  "src/lib/firestoreAman.ts"() {
    "use strict";
  }
});

// src/lib/firestoreAdmin.ts
import { existsSync, readFileSync } from "node:fs";
async function muatAdmin() {
  if (adminModul) return adminModul;
  try {
    const [app, firestore] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/firestore")
    ]);
    adminModul = {
      cert: app.cert,
      getApps: app.getApps,
      initializeApp: app.initializeApp,
      getFirestore: firestore.getFirestore
    };
  } catch (err) {
    throw new Error(
      `Paket "@google-cloud/firestore" tidak tersedia di server ini. Pasang dengan \`npm i @google-cloud/firestore\` (butuh Node >= 22). (${String(err.message).slice(0, 160)})`
    );
  }
  return adminModul;
}
function adminTersedia() {
  if (firestoreTiruan) return true;
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS) || process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE
  );
}
async function admin() {
  if (firestoreTiruan) return firestoreTiruan;
  const { cert, getApps, initializeApp, getFirestore } = await muatAdmin();
  if (adminApp) return getFirestore(adminApp);
  const aplikasiAda = getApps();
  if (aplikasiAda.length) {
    adminApp = aplikasiAda[0];
    return getFirestore(adminApp);
  }
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    try {
      adminApp = initializeApp({
        credential: cert(JSON.parse(inline)),
        ...process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}
      });
      return getFirestore(adminApp);
    } catch (err) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT tidak valid: ${err.message}`);
    }
  }
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath && existsSync(credentialPath)) {
    adminApp = initializeApp({
      credential: cert(JSON.parse(readFileSync(credentialPath, "utf8"))),
      ...process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}
    });
    return getFirestore(adminApp);
  }
  adminApp = process.env.FIREBASE_PROJECT_ID ? initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID }) : initializeApp({});
  return getFirestore(adminApp);
}
var adminModul, adminApp, firestoreTiruan;
var init_firestoreAdmin = __esm({
  "src/lib/firestoreAdmin.ts"() {
    "use strict";
    adminModul = null;
    adminApp = null;
    firestoreTiruan = null;
  }
});

// src/lib/pin.ts
import CryptoJS from "crypto-js";
import bcrypt from "bcryptjs";
function lapisSatu(plain) {
  return CryptoJS.SHA256(`${plain}${PIN_SALT}`).toString(CryptoJS.enc.Hex);
}
async function hashPinLayered(plain) {
  return bcrypt.hash(lapisSatu(plain), 10);
}
async function verifyPinLayered(plain, storedHash) {
  if (!storedHash) return false;
  try {
    return await bcrypt.compare(lapisSatu(plain), storedHash);
  } catch {
    return false;
  }
}
var PIN_SALT;
var init_pin = __esm({
  "src/lib/pin.ts"() {
    "use strict";
    PIN_SALT = "epresensi-jatim-pin-salt-v1";
  }
});

// src/lib/presensiContract.ts
function buildRpcEnvelope(object, param) {
  return {
    jsonrpc: 2,
    method: "POST",
    version: PRESENSI_VERSION,
    object,
    param
  };
}
var PRESENSI_SERVICE_URL, PRESENSI_IMPORTFILE_PATH, PRESENSI_IMPORTFILE_URL, APK_VERSION_CODE, PRESENSI_VERSION, RPC_OBJECTS, RPC_REQUIRED_PARAMS, RPC_BISA_ULANG;
var init_presensiContract = __esm({
  "src/lib/presensiContract.ts"() {
    "use strict";
    PRESENSI_SERVICE_URL = "https://presensi.bkd.jatimprov.go.id/service";
    PRESENSI_IMPORTFILE_PATH = "/importfile";
    PRESENSI_IMPORTFILE_URL = `${PRESENSI_SERVICE_URL}${PRESENSI_IMPORTFILE_PATH}`;
    APK_VERSION_CODE = 89;
    PRESENSI_VERSION = APK_VERSION_CODE;
    RPC_OBJECTS = {
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
    RPC_REQUIRED_PARAMS = {
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
    RPC_BISA_ULANG = [
      RPC_OBJECTS.GET_WORK_CODE,
      RPC_OBJECTS.GET_LOKASI_ABSEN,
      RPC_OBJECTS.GET_MASTER_TIPE_IJIN,
      RPC_OBJECTS.JENIS_IJIN,
      RPC_OBJECTS.TIPE_IJIN,
      RPC_OBJECTS.HISTORY_ABSEN,
      RPC_OBJECTS.LIST_IJIN
    ];
  }
});

// src/lib/userManager.ts
function normalizeUserPermissions(raw) {
  const base = { ...DEFAULT_USER_PERMISSIONS };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(base)) {
      if (key in raw) base[key] = Boolean(raw[key]);
    }
    if (!("tabManajemenAkun" in raw) && "tabLangganan" in raw) {
      base.tabManajemenAkun = Boolean(raw.tabLangganan);
    }
  }
  for (const key of PERMISSION_KHUSUS_ADMIN) base[key] = false;
  return base;
}
function batasiIzin(permissions, role) {
  if (role === "admin") return permissions;
  const hasil = { ...permissions };
  for (const key of PERMISSION_KHUSUS_ADMIN) hasil[key] = false;
  return hasil;
}
function sanitizeString(value, maxLength = 100) {
  return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, maxLength);
}
function validateUsername(username) {
  const value = username.trim();
  if (!value) return "Username wajib diisi.";
  if (value.length < 3) return "Username minimal 3 karakter.";
  if (value.length > 32) return "Username maksimal 32 karakter.";
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    return "Username hanya boleh huruf, angka, titik, underscore, dan strip.";
  }
  return null;
}
function validatePassword(password) {
  if (!password) return "Password wajib diisi.";
  if (password.length < 6) return "Password minimal 6 karakter.";
  if (password.length > 128) return "Password terlalu panjang.";
  return null;
}
var PERMISSION_KHUSUS_ADMIN, DEFAULT_ADMIN_PERMISSIONS, DEFAULT_USER_PERMISSIONS, UNAUTHENTICATED_PERMISSIONS;
var init_userManager = __esm({
  "src/lib/userManager.ts"() {
    "use strict";
    PERMISSION_KHUSUS_ADMIN = ["tabManajemenAkun"];
    DEFAULT_ADMIN_PERMISSIONS = {
      tabBeranda: true,
      tabPresensi: true,
      tabPerizinan: true,
      tabLaporan: true,
      tabLokasiAbsen: true,
      tabDocs: true,
      tabWeb: true,
      aksiAbsen: true,
      aksiAjukanIzin: true,
      aksiSyncData: true,
      aksiKelolaUser: true,
      tabDeveloper: true,
      tabManajemenAkun: true,
      aksiSesiServer: true
    };
    DEFAULT_USER_PERMISSIONS = {
      tabBeranda: true,
      tabPresensi: true,
      tabPerizinan: true,
      tabLokasiAbsen: true,
      tabLaporan: false,
      tabDocs: false,
      tabWeb: true,
      aksiAbsen: true,
      aksiAjukanIzin: true,
      aksiSyncData: true,
      aksiKelolaUser: false,
      tabDeveloper: false,
      tabManajemenAkun: false,
      aksiSesiServer: true
    };
    UNAUTHENTICATED_PERMISSIONS = Object.fromEntries(
      Object.keys(DEFAULT_ADMIN_PERMISSIONS).map((key) => [key, false])
    );
  }
});

// src/lib/panelServer.ts
var panelServer_exports = {};
__export(panelServer_exports, {
  NAMA_ADMIN_BAWAAN: () => NAMA_ADMIN_BAWAAN,
  adalahAdminToken: () => adalahAdminToken,
  akunDariToken: () => akunDariToken,
  autoLoginPusat: () => autoLoginPusat,
  bacaToken: () => bacaToken,
  buatAkun: () => buatAkun,
  daftarAkun: () => daftarAkun,
  gantiPasswordSendiri: () => gantiPasswordSendiri,
  hapusAkun: () => hapusAkun,
  hapusKredensial: () => hapusKredensial,
  kredensialWebSendiri: () => kredensialWebSendiri,
  masukPanel: () => masukPanel,
  resetPembatasPercobaan: () => resetPembatasPercobaan,
  ringkasKredensial: () => ringkasKredensial,
  ringkasSemuaKredensial: () => ringkasSemuaKredensial,
  ringkasanPanelAuth: () => ringkasanPanelAuth,
  simpanKredensial: () => simpanKredensial,
  terbitkanToken: () => terbitkanToken,
  ubahAdminBawaan: () => ubahAdminBawaan,
  ubahAkun: () => ubahAkun,
  verifikasiToken: () => verifikasiToken
});
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { Buffer as NodeBuffer } from "node:buffer";
function rahasia() {
  const nilai = process.env.PANEL_SESSION_SECRET?.trim();
  if (!nilai) {
    throw new Error(
      "PANEL_SESSION_SECRET belum diisi. Tambahkan di dashboard Vercel (Settings \u2192 Environment Variables) sebagai string acak minimal 32 karakter, lalu deploy ulang. Autentikasi panel berhenti tanpa nilai ini \u2014 bukan memakai nilai bawaan."
    );
  }
  if (nilai.length < 32) {
    throw new Error(
      `PANEL_SESSION_SECRET terlalu pendek (minimal 32 karakter). Panjang saat ini: ${nilai.length}.`
    );
  }
  return nilai;
}
function kunciKredensial() {
  return createHmac("sha256", "prabawa-kredensial").update(rahasia()).digest();
}
function ringkasanPanelAuth() {
  const nilai = process.env.PANEL_SESSION_SECRET?.trim() ?? "";
  return {
    siap: adminTersedia() && nilai.length >= 32,
    secretAda: nilai.length > 0,
    secretCukupPanjang: nilai.length >= 32
  };
}
function tanda(payloadB64) {
  return createHmac("sha256", rahasia()).update(payloadB64).digest("base64url");
}
function terbitkanToken(sub, role, perms) {
  const sekarang = Date.now();
  const muatan = {
    v: TOKEN_V,
    sub,
    role,
    perms,
    iat: sekarang,
    exp: sekarang + TOKEN_TTL_MS,
    jti: randomUUID()
  };
  const payloadB64 = NodeBuffer.from(JSON.stringify(muatan), "utf8").toString("base64url");
  return `${payloadB64}.${tanda(payloadB64)}`;
}
function bacaToken(token) {
  if (typeof token !== "string" || !token) return null;
  const titik = token.indexOf(".");
  if (titik <= 0 || titik === token.length - 1) return null;
  const payloadB64 = token.slice(0, titik);
  const signature = token.slice(titik + 1);
  let diharapkan;
  try {
    diharapkan = tanda(payloadB64);
  } catch {
    return null;
  }
  const a = NodeBuffer.from(signature);
  const b = NodeBuffer.from(diharapkan);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let muatan;
  try {
    muatan = JSON.parse(NodeBuffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!muatan || typeof muatan !== "object") return null;
  if (muatan.v !== TOKEN_V) return null;
  if (typeof muatan.sub !== "string" || !muatan.sub) return null;
  if (muatan.role !== "admin" && muatan.role !== "user") return null;
  if (typeof muatan.exp !== "number" || typeof muatan.iat !== "number") return null;
  if (Date.now() >= muatan.exp) return null;
  if (muatan.iat > Date.now() + 6e4) return null;
  return muatan;
}
function kunciAkun(username) {
  return username.trim().replace(/\//g, "_");
}
function dokKredensial(username) {
  return `kredensial_server__${kunciAkun(username)}`;
}
async function namaAdmin() {
  const snap = await (await admin()).collection(COLL_PENGATURAN).doc(DOC_AUTH).get();
  const data = snap.data();
  const nama = typeof data?.adminUsername === "string" ? data.adminUsername.toLowerCase().trim() : "";
  return nama || NAMA_ADMIN_BAWAAN;
}
function akunAman(doc, fallbackUsername) {
  const role = doc.role === "admin" ? "admin" : "user";
  const permissions = role === "admin" ? { ...DEFAULT_ADMIN_PERMISSIONS } : batasiIzin(
    normalizeUserPermissions(doc.permissions),
    role
  );
  return {
    username: sanitizeString(doc.username ?? fallbackUsername, 32) || fallbackUsername,
    usernameSebelumnya: Array.isArray(doc.usernameSebelumnya) ? doc.usernameSebelumnya.filter((nama) => typeof nama === "string").map((nama) => sanitizeString(nama, 32)).filter(Boolean).slice(-20) : void 0,
    role,
    permissions,
    createdAt: typeof doc.createdAt === "string" ? doc.createdAt : "",
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : void 0,
    lastLoginAt: typeof doc.lastLoginAt === "string" ? doc.lastLoginAt : void 0,
    lastNip: typeof doc.lastNip === "string" ? doc.lastNip : void 0,
    namaLengkap: typeof doc.namaLengkap === "string" ? doc.namaLengkap : void 0,
    nip: typeof doc.nip === "string" ? doc.nip : void 0,
    catatan: typeof doc.catatan === "string" ? doc.catatan : void 0,
    nonaktif: Boolean(doc.nonaktif)
  };
}
function sisaKunci(peta, kunci, batas) {
  const c = peta.get(kunci);
  if (!c) return 0;
  const lewat = Date.now() - c.mulai;
  if (lewat >= JENDALA_MS) {
    peta.delete(kunci);
    return 0;
  }
  if (c.jumlah < batas) return 0;
  return Math.ceil((JENDALA_MS - lewat) / 1e3);
}
function catatGagal(peta, kunci) {
  const c = peta.get(kunci);
  if (!c || Date.now() - c.mulai >= JENDALA_MS) {
    peta.set(kunci, { jumlah: 1, mulai: Date.now() });
    return;
  }
  c.jumlah += 1;
}
function pangkas(peta) {
  if (peta.size < BATAS_ENTRI_PEMBATAS) return;
  const sekarang = Date.now();
  for (const [kunci, nilai] of peta) {
    if (sekarang - nilai.mulai >= JENDALA_MS) peta.delete(kunci);
  }
  if (peta.size <= BATAS_ENTRI_PEMBATAS) return;
  const urut = [...peta.entries()].sort((a, b) => a[1].mulai - b[1].mulai);
  const kelebihan = urut.length - BATAS_ENTRI_PEMBATAS;
  for (let i = 0; i < kelebihan; i++) peta.delete(urut[i][0]);
}
function resetPembatasPercobaan() {
  percobaanIp.clear();
  percobaanAkun.clear();
}
async function masukPanel(username, password, info = {}) {
  const nama = String(username ?? "").trim().toLowerCase();
  const sandi = String(password ?? "");
  if (!nama || !sandi) {
    return { ok: false, kode: 400, pesan: "ID pengguna dan kata sandi wajib diisi." };
  }
  if (nama.length > 32 || sandi.length > 128) {
    return { ok: false, kode: 400, pesan: "ID pengguna atau kata sandi tidak valid." };
  }
  const ip = info.ip || "tak-diketahui";
  pangkas(percobaanIp);
  pangkas(percobaanAkun);
  const kunciPerIp = sisaKunci(percobaanIp, ip, BATAS_PER_IP);
  if (kunciPerIp) {
    return {
      ok: false,
      kode: 429,
      terkunci: kunciPerIp,
      pesan: "Terlalu banyak percobaan dari perangkat ini."
    };
  }
  const kunciPerAkun = sisaKunci(percobaanAkun, nama, BATAS_PER_AKUN);
  if (kunciPerAkun) {
    return {
      ok: false,
      kode: 429,
      terkunci: kunciPerAkun,
      pesan: "Terlalu banyak percobaan untuk akun ini."
    };
  }
  const db = await admin();
  let akun = null;
  let refAkun = null;
  const namaAdminSah = await namaAdmin();
  if (nama === namaAdminSah) {
    const authSnap = await db.collection(COLL_PENGATURAN).doc(DOC_AUTH).get();
    const auth = authSnap.data() ?? {};
    const sah = (typeof auth.pinHash === "string" && auth.pinHash ? await verifyPinLayered(sandi, auth.pinHash) : false) || (typeof auth.pinEncrypted === "string" && auth.pinEncrypted ? await verifikasiLegacyPin(auth.pinEncrypted, sandi) : false);
    if (sah) {
      akun = {
        username: namaAdminSah,
        role: "admin",
        permissions: { ...DEFAULT_ADMIN_PERMISSIONS },
        createdAt: typeof auth.createdAt === "string" ? auth.createdAt : ""
      };
    }
  }
  if (!akun) {
    const snap = await db.collection(COLL_PENGGUNA).doc(kunciAkun(nama)).get();
    if (snap.exists) {
      const doc = snap.data();
      const valid = await verifyPinLayered(sandi, String(doc.passwordHash ?? ""));
      if (valid && !doc.nonaktif) {
        akun = akunAman(doc, nama);
        refAkun = snap.ref;
      }
    }
  }
  if (!akun) {
    catatGagal(percobaanIp, ip);
    catatGagal(percobaanAkun, nama);
    return { ok: false, kode: 401, pesan: pesanGagal };
  }
  if (refAkun) {
    try {
      await refAkun.update({ lastLoginAt: (/* @__PURE__ */ new Date()).toISOString() });
    } catch {
    }
  }
  return {
    ok: true,
    kode: 200,
    token: terbitkanToken(akun.username, akun.role, akun.permissions),
    akun
  };
}
async function verifikasiLegacyPin(pinEncrypted, sandi) {
  const legacy = process.env.VITE_APP_SECRET?.trim();
  if (!legacy) return false;
  try {
    const sandiSalt = uraiOpenSslSalted(pinEncrypted);
    if (!sandiSalt) return false;
    const { key, iv } = evpBytesToKey(legacy, sandiSalt.salt, 32, 16);
    const dekrip = createDecipheriv("aes-256-cbc", key, iv);
    const teks = NodeBuffer.concat([
      dekrip.update(NodeBuffer.from(sandiSalt.ciphertext)),
      dekrip.final()
    ]).toString("utf8");
    return teks.length > 0 && teks === sandi;
  } catch {
    return false;
  }
}
function uraiOpenSslSalted(blob) {
  let raw;
  try {
    raw = NodeBuffer.from(String(blob ?? ""), "base64");
  } catch {
    return null;
  }
  if (raw.length <= OPENSSL_SALTED_MAGIC.length + 16 + 1) return null;
  if (!raw.subarray(0, OPENSSL_SALTED_MAGIC.length).equals(OPENSSL_SALTED_MAGIC)) return null;
  const ciphertext = raw.subarray(16);
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return null;
  return { salt: raw.subarray(8, 16), ciphertext };
}
function evpBytesToKey(passphrase, salt, keyLen, ivLen) {
  const total = keyLen + ivLen;
  const turunan = NodeBuffer.alloc(total);
  let terisi = 0;
  let blok = NodeBuffer.alloc(0);
  while (terisi < total) {
    blok = createHash("md5").update(NodeBuffer.concat([blok, NodeBuffer.from(passphrase, "utf8"), NodeBuffer.from(salt)])).digest();
    blok.copy(turunan, terisi, 0, Math.min(blok.length, total - terisi));
    terisi += blok.length;
  }
  return {
    key: NodeBuffer.from(turunan.subarray(0, keyLen)),
    iv: NodeBuffer.from(turunan.subarray(keyLen, total))
  };
}
async function verifikasiToken(token, opsi = {}) {
  const muatan = bacaToken(token);
  if (!muatan) return { ok: false, kode: 401, pesan: "Sesi tidak valid atau sudah berakhir." };
  const db = await admin();
  const snap = await db.collection(COLL_PENGGUNA).doc(kunciAkun(muatan.sub)).get();
  let akun;
  if (snap.exists) {
    const doc = snap.data();
    if (doc.nonaktif) {
      return { ok: false, kode: 403, pesan: "Akun ini dinonaktifkan. Hubungi administrator." };
    }
    if (sanitizeString(doc.username ?? muatan.sub, 32) !== muatan.sub) {
      return { ok: false, kode: 401, pesan: "Sesi tidak valid." };
    }
    akun = akunAman(doc, muatan.sub);
  } else {
    const namaAdminSah = await namaAdmin();
    if (muatan.sub !== namaAdminSah) {
      return { ok: false, kode: 401, pesan: "Akun tidak ditemukan." };
    }
    const authSnap = await db.collection(COLL_PENGATURAN).doc(DOC_AUTH).get();
    const auth = authSnap.data() ?? {};
    if (typeof auth.pinHash !== "string" || !auth.pinHash) {
      return { ok: false, kode: 401, pesan: "Kredensial admin sudah tidak berlaku." };
    }
    akun = {
      username: namaAdminSah,
      role: "admin",
      permissions: { ...DEFAULT_ADMIN_PERMISSIONS },
      createdAt: typeof auth.createdAt === "string" ? auth.createdAt : ""
    };
  }
  const perluBaru = opsi.perbarui === true && muatan.exp - Date.now() < PERBARU_BILA_SISA_MS;
  return {
    ok: true,
    kode: 200,
    token: perluBaru ? terbitkanToken(akun.username, akun.role, akun.permissions) : void 0,
    akun
  };
}
async function akunDariToken(token) {
  const hasil = await verifikasiToken(token);
  return hasil.ok ? hasil.akun ?? null : null;
}
async function adalahAdminToken(token) {
  const akun = await akunDariToken(token);
  return akun?.role === "admin";
}
async function ubahAdminBawaan(token, isi) {
  if (!await adalahAdminToken(token)) {
    return { ok: false, kode: 403, pesan: "Hanya admin yang bisa mengubah kredensial admin." };
  }
  const passwordLama = String(isi.passwordLama ?? "");
  if (!passwordLama) {
    return { ok: false, kode: 400, pesan: "Password admin saat ini wajib diisi." };
  }
  const db = await admin();
  const ref = db.collection(COLL_PENGATURAN).doc(DOC_AUTH);
  const auth = (await ref.get()).data() ?? {};
  const sah = (typeof auth.pinHash === "string" && auth.pinHash ? await verifyPinLayered(passwordLama, auth.pinHash) : false) || (typeof auth.pinEncrypted === "string" && auth.pinEncrypted ? await verifikasiLegacyPin(auth.pinEncrypted, passwordLama) : false);
  if (!sah) return { ok: false, kode: 401, pesan: "Password admin saat ini salah." };
  const patch = { updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  let adaPerubahan = false;
  if (isi.usernameBaru !== void 0) {
    const nama = String(isi.usernameBaru).trim().toLowerCase();
    const galat = validateUsername(nama);
    if (galat) return { ok: false, kode: 400, pesan: galat };
    if ((await db.collection(COLL_PENGGUNA).doc(kunciAkun(nama)).get()).exists) {
      return { ok: false, kode: 409, pesan: "Username itu sudah dipakai akun panel lain." };
    }
    patch.adminUsername = nama;
    adaPerubahan = true;
  }
  if (isi.passwordBaru) {
    const galat = validatePassword(isi.passwordBaru);
    if (galat) return { ok: false, kode: 400, pesan: galat };
    patch.pinHash = await hashPinLayered(isi.passwordBaru);
    const hapus = await hapusField();
    patch.pinEncrypted = hapus;
    adaPerubahan = true;
  }
  if (!adaPerubahan) return { ok: false, kode: 400, pesan: "Tidak ada yang diubah." };
  await ref.set(patch, { merge: true });
  return { ok: true, kode: 200, pesan: "Kredensial admin diperbarui. Silakan login ulang." };
}
async function hapusField() {
  const modul = await import("firebase-admin/firestore");
  return modul.FieldValue.delete();
}
async function daftarAkun(token) {
  if (!await adalahAdminToken(token)) {
    return { ok: false, kode: 403, pesan: "Akses khusus admin." };
  }
  const snap = await (await admin()).collection(COLL_PENGGUNA).limit(BATAS_AKUN_PANEL + 1).get();
  if (snap.size > BATAS_AKUN_PANEL) {
    return {
      ok: false,
      kode: 409,
      pesan: `Jumlah akun melewati batas ${BATAS_AKUN_PANEL}. Daftar sengaja tidak dipotong \u2014 hubungi pengelola sistem.`
    };
  }
  return {
    ok: true,
    kode: 200,
    daftar: snap.docs.map((d) => akunAman(d.data(), d.id))
  };
}
async function buatAkun(token, isi) {
  if (!await adalahAdminToken(token)) {
    return { ok: false, kode: 403, pesan: "Akses khusus admin." };
  }
  const nama = String(isi.username ?? "").trim();
  const galatNama = validateUsername(nama);
  if (galatNama) return { ok: false, kode: 400, pesan: galatNama };
  const sandi = String(isi.password ?? "");
  const galatSandi = validatePassword(sandi);
  if (galatSandi) return { ok: false, kode: 400, pesan: galatSandi };
  const namaLengkap = sanitizeString(isi.namaLengkap ?? "", 120);
  if (!namaLengkap) return { ok: false, kode: 400, pesan: "Nama lengkap wajib diisi." };
  const db = await admin();
  const ref = db.collection(COLL_PENGGUNA).doc(kunciAkun(nama));
  if ((await ref.get()).exists) return { ok: false, kode: 409, pesan: "Username sudah dipakai." };
  const role = isi.role === "admin" ? "admin" : "user";
  const permissions = role === "admin" ? { ...DEFAULT_ADMIN_PERMISSIONS } : normalizeUserPermissions({ ...DEFAULT_USER_PERMISSIONS, ...isi.permissions ?? {} });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const record = {
    username: nama,
    passwordHash: await hashPinLayered(sandi),
    role,
    permissions,
    namaLengkap,
    nip: sanitizeString(isi.nip ?? "", 32),
    catatan: sanitizeString(isi.catatan ?? "", 500),
    nonaktif: false,
    createdAt: now,
    updatedAt: now
  };
  await ref.set(bersihkanUndefined(record));
  const { passwordHash: _hash, ...safe } = record;
  void _hash;
  return { ok: true, kode: 200, akun: safe };
}
async function ubahAkun(token, username, isi) {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil || pemanggil.role !== "admin") {
    return { ok: false, kode: 403, pesan: "Akses khusus admin." };
  }
  const nama = String(username ?? "").trim();
  const db = await admin();
  const ref = db.collection(COLL_PENGGUNA).doc(kunciAkun(nama));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, kode: 404, pesan: "Pengguna tidak ditemukan." };
  const sekarang = snap.data();
  const roleBaru = isi.role ?? (sekarang.role === "admin" ? "admin" : "user");
  const kehilanganAdmin = sekarang.role === "admin" && (roleBaru !== "admin" || isi.nonaktif === true);
  if (kehilanganAdmin) {
    const adminLain = await db.collection(COLL_PENGGUNA).where("role", "==", "admin").limit(2).get();
    const adaAdminLain = adminLain.docs.some((d) => d.id !== kunciAkun(nama));
    if (!adaAdminLain) {
      return {
        ok: false,
        kode: 409,
        pesan: "Ini admin terakhir. Tunjuk admin lain sebelum menurunkan atau menonaktifkan akun ini."
      };
    }
  }
  const patch = { updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  if (isi.password) {
    const galat = validatePassword(isi.password);
    if (galat) return { ok: false, kode: 400, pesan: galat };
    patch.passwordHash = await hashPinLayered(isi.password);
  }
  if (isi.role) {
    patch.role = isi.role;
    if (isi.role === "admin") patch.permissions = { ...DEFAULT_ADMIN_PERMISSIONS };
  }
  if (isi.permissions) {
    patch.permissions = batasiIzin(
      normalizeUserPermissions({ ...sekarang.permissions, ...isi.permissions }),
      roleBaru
    );
  }
  if (isi.namaLengkap !== void 0) {
    const namaLengkap = sanitizeString(isi.namaLengkap, 120);
    if (!namaLengkap) return { ok: false, kode: 400, pesan: "Nama lengkap wajib diisi." };
    patch.namaLengkap = namaLengkap;
  }
  if (isi.nip !== void 0) patch.nip = sanitizeString(isi.nip, 32);
  if (isi.catatan !== void 0) patch.catatan = sanitizeString(isi.catatan, 500);
  if (isi.nonaktif !== void 0) patch.nonaktif = Boolean(isi.nonaktif);
  const usernameBaru = isi.usernameBaru === void 0 ? nama : String(isi.usernameBaru).trim().toLowerCase();
  const galatUsername = validateUsername(usernameBaru);
  if (galatUsername) return { ok: false, kode: 400, pesan: galatUsername };
  const gantiUsername = kunciAkun(nama) !== kunciAkun(usernameBaru);
  if (gantiUsername) {
    const kunciBaru = kunciAkun(usernameBaru);
    if (usernameBaru === await namaAdmin()) {
      return { ok: false, kode: 409, pesan: "Username tersebut dipakai admin bawaan." };
    }
    const refAkunBaru = db.collection(COLL_PENGGUNA).doc(kunciBaru);
    const refLanggananLama = db.collection(COLL_LANGGANAN).doc(nama);
    const refLanggananBaru = db.collection(COLL_LANGGANAN).doc(usernameBaru);
    const refKredensialLama = db.collection(COLL_PENGATURAN).doc(dokKredensial(nama));
    const refKredensialBaru = db.collection(COLL_PENGATURAN).doc(dokKredensial(usernameBaru));
    const idMigrasi = `rename_akun__${kunciAkun(nama)}`;
    const refMigrasi = db.collection(COLL_PENGATURAN).doc(idMigrasi);
    const [akunBaru, langgananBaru, kredensialBaru, migrasi, tagihanNamaBaru] = await Promise.all([
      refAkunBaru.get(),
      refLanggananBaru.get(),
      refKredensialBaru.get(),
      refMigrasi.get(),
      db.collection(COLL_TAGIHAN).where("username", "==", usernameBaru).get()
    ]);
    const dataMigrasi = migrasi.exists ? migrasi.data() : null;
    if (migrasi.exists && (dataMigrasi?.dari !== nama || dataMigrasi?.ke !== usernameBaru)) {
      return { ok: false, kode: 409, pesan: "Migrasi username akun lain sedang berlangsung." };
    }
    if (!migrasi.exists && (akunBaru.exists || langgananBaru.exists || kredensialBaru.exists || tagihanNamaBaru.docs.length > 0)) {
      return { ok: false, kode: 409, pesan: "Username baru sudah digunakan atau memiliki data." };
    }
    if (!migrasi.exists) {
      await refMigrasi.set({
        dari: nama,
        ke: usernameBaru,
        dibuatPada: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const tagihanLama = await db.collection(COLL_TAGIHAN).where("username", "==", nama).get();
    for (let mulai = 0; mulai < tagihanLama.docs.length; mulai += 400) {
      const batch2 = db.batch();
      for (const tagihan of tagihanLama.docs.slice(mulai, mulai + 400)) {
        const data = tagihan.data();
        batch2.set(
          db.collection(COLL_TAGIHAN).doc(tagihan.id),
          {
            ...data,
            username: usernameBaru,
            ...data.usernameLabel === nama ? { usernameLabel: usernameBaru } : {}
          },
          { merge: true }
        );
      }
      await batch2.commit();
    }
    const [akunTujuan, langgananAsal, kredensialAsal] = await Promise.all([
      refAkunBaru.get(),
      refLanggananLama.get(),
      refKredensialLama.get()
    ]);
    if (akunTujuan.exists) {
      await refMigrasi.delete();
      return { ok: false, kode: 409, pesan: "Username baru sudah digunakan akun lain." };
    }
    const batch = db.batch();
    batch.set(
      refAkunBaru,
      bersihkanUndefined({
        ...sekarang,
        ...patch,
        username: usernameBaru,
        usernameSebelumnya: [
          .../* @__PURE__ */ new Set([
            ...Array.isArray(sekarang.usernameSebelumnya) ? sekarang.usernameSebelumnya.filter((nama2) => typeof nama2 === "string") : [],
            nama
          ])
        ].slice(-20)
      })
    );
    batch.delete(ref);
    if (langgananAsal.exists) {
      batch.set(refLanggananBaru, {
        ...langgananAsal.data(),
        username: usernameBaru
      });
      batch.delete(refLanggananLama);
    }
    if (kredensialAsal.exists) {
      batch.set(refKredensialBaru, kredensialAsal.data());
      batch.delete(refKredensialLama);
    }
    batch.delete(refMigrasi);
    await batch.commit();
    return {
      ok: true,
      kode: 200,
      pesan: "Username dan data akun berhasil dipindahkan."
    };
  }
  await ref.set(bersihkanUndefined({ ...sekarang, ...patch }), { merge: true });
  return { ok: true, kode: 200 };
}
async function hapusAkun(token, username) {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil || pemanggil.role !== "admin") {
    return { ok: false, kode: 403, pesan: "Akses khusus admin." };
  }
  const nama = String(username ?? "").trim();
  if (kunciAkun(nama) === kunciAkun(pemanggil.username)) {
    return { ok: false, kode: 409, pesan: "Admin tidak bisa menghapus akunnya sendiri." };
  }
  const db = await admin();
  const ref = db.collection(COLL_PENGGUNA).doc(kunciAkun(nama));
  if ((await ref.get()).exists) await ref.delete();
  await db.collection(COLL_PENGATURAN).doc(dokKredensial(nama)).delete();
  return { ok: true, kode: 200 };
}
function enkripsi(plain) {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", kunciKredensial(), iv);
  const data = NodeBuffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v2",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url")
  ].join(".");
}
function dekripsi(teks) {
  const bagian = String(teks ?? "").split(".");
  if (bagian.length !== 4 || bagian[0] !== "v2") return null;
  try {
    const iv = NodeBuffer.from(bagian[1], "base64url");
    const tag = NodeBuffer.from(bagian[2], "base64url");
    const data = NodeBuffer.from(bagian[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", kunciKredensial(), iv);
    decipher.setAuthTag(tag);
    return NodeBuffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
async function cekPemilik(token, username) {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil) return null;
  if (kunciAkun(pemanggil.username) !== kunciAkun(String(username ?? ""))) {
    return pemanggil.role === "admin" ? pemanggil : null;
  }
  return pemanggil;
}
function dokKredensialTarget(username) {
  return dokKredensial(String(username ?? "").trim().toLowerCase());
}
async function ringkasKredensial(token, username) {
  const pemanggil = await cekPemilik(token, username);
  if (!pemanggil) return { ok: false, kode: 403, pesan: "Hanya untuk akun sendiri." };
  const snap = await (await admin()).collection(COLL_PENGATURAN).doc(dokKredensialTarget(username)).get();
  if (!snap.exists) return { ok: false, kode: 404, pesan: "Kredensial server belum diatur." };
  const data = snap.data();
  const terbaca = dekripsi(String(data.passwordEncrypted ?? "")) !== null;
  return {
    ok: true,
    kode: 200,
    ringkasan: bersihkanUndefined({
      nip: String(data.nip ?? ""),
      imei: String(data.imei ?? ""),
      terbaca,
      updatedAt: String(data.updatedAt ?? ""),
      pesan: terbaca ? void 0 : "Kredensial lama belum bisa dibaca server. Simpan ulang password server pusat dari menu Manajemen Akun."
    })
  };
}
async function kredensialWebSendiri(token) {
  const akun = await akunDariToken(token);
  if (!akun) return { ok: false, kode: 401, pesan: "Sesi tidak valid. Login ulang." };
  const snap = await (await admin()).collection(COLL_PENGATURAN).doc(dokKredensialTarget(akun.username)).get();
  if (!snap.exists) {
    return { ok: false, kode: 404, pesan: "Kredensial server belum diatur." };
  }
  const data = snap.data();
  const nip = String(data.nip ?? "");
  const password = dekripsi(String(data.passwordEncrypted ?? ""));
  if (!nip || password === null) {
    return { ok: false, kode: 422, pesan: "Password server tersimpan tidak dapat dibaca. Simpan ulang kredensial." };
  }
  return { ok: true, kode: 200, kredensial: { nip, password } };
}
async function ringkasSemuaKredensial(token) {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil || pemanggil.role !== "admin") {
    return { ok: false, kode: 403, pesan: "Akses khusus admin." };
  }
  const db = await admin();
  const akunSnap = await db.collection(COLL_PENGGUNA).limit(BATAS_AKUN_PANEL + 1).get();
  if (akunSnap.size > BATAS_AKUN_PANEL) {
    return {
      ok: false,
      kode: 409,
      pesan: `Jumlah akun melewati batas ${BATAS_AKUN_PANEL}. Daftar sengaja tidak dipotong \u2014 hubungi pengelola sistem.`
    };
  }
  const akun = akunSnap.docs.map((d) => ({
    username: String(d.data().username ?? d.id),
    ref: db.collection(COLL_PENGATURAN).doc(dokKredensial(String(d.data().username ?? d.id)))
  }));
  const hasil = {};
  for (let i = 0; i < akun.length; i += 300) {
    const potongan = akun.slice(i, i + 300);
    const snaps = await db.getAll(...potongan.map((a) => a.ref));
    snaps.forEach((s, idx) => {
      if (!s.exists) return;
      const data = s.data();
      const terbaca = dekripsi(String(data.passwordEncrypted ?? "")) !== null;
      hasil[potongan[idx].username] = bersihkanUndefined({
        nip: String(data.nip ?? ""),
        imei: String(data.imei ?? ""),
        terbaca,
        updatedAt: String(data.updatedAt ?? ""),
        pesan: terbaca ? void 0 : "Kredensial lama belum bisa dibaca server. Simpan ulang password server pusat dari menu Manajemen Akun."
      });
    });
  }
  return { ok: true, kode: 200, daftar: hasil };
}
async function simpanKredensial(token, isi) {
  const pemanggil = await cekPemilik(token, isi.username);
  if (!pemanggil) return { ok: false, kode: 403, pesan: "Hanya untuk akun sendiri." };
  const nip = sanitizeString(isi.nip, 32);
  const sandi = String(isi.password ?? "");
  if (!nip) return { ok: false, kode: 400, pesan: "NIP wajib diisi." };
  const db = await admin();
  const ref = db.collection(COLL_PENGATURAN).doc(dokKredensialTarget(isi.username));
  const snap = await ref.get();
  if (!sandi && !snap.exists) {
    return { ok: false, kode: 400, pesan: "Password server wajib diisi untuk kredensial baru." };
  }
  const patch = {
    nip,
    imei: sanitizeString(isi.imei ?? "", 64),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (sandi) patch.passwordEncrypted = enkripsi(sandi);
  await ref.set(bersihkanUndefined(patch), { merge: true });
  return { ok: true, kode: 200 };
}
async function hapusKredensial(token, username) {
  const pemanggil = await cekPemilik(token, username);
  if (!pemanggil) return { ok: false, kode: 403, pesan: "Hanya untuk akun sendiri." };
  await (await admin()).collection(COLL_PENGATURAN).doc(dokKredensialTarget(username)).delete();
  return { ok: true, kode: 200 };
}
async function autoLoginPusat(token, username, opsi = {}) {
  const pemanggil = await cekPemilik(token, username);
  if (!pemanggil) return { ok: false, kode: 403, pesan: "Hanya untuk akun sendiri." };
  const db = await admin();
  const snap = await db.collection(COLL_PENGATURAN).doc(dokKredensialTarget(username)).get();
  if (!snap.exists) {
    return { ok: false, kode: 404, pesan: "Kredensial server pusat belum diatur." };
  }
  const data = snap.data();
  const nip = String(data.nip ?? "");
  const sandi = dekripsi(String(data.passwordEncrypted ?? ""));
  if (!nip || sandi === null) {
    return {
      ok: false,
      kode: 422,
      pesan: "Kredensial server pusat belum bisa dibaca server. Simpan ulang dari menu Manajemen Akun."
    };
  }
  const imei = sanitizeString(data.imei || opsi.imei || "", 64);
  const envelope = buildRpcEnvelope("login", {
    email: nip,
    password: sandi,
    latlong: "0,0",
    imei,
    api_key: "",
    last_latlong: ""
  });
  try {
    const upstream = await fetch(process.env.PRESENSI_BASE_URL || GATEWAY_BAWAAN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json",
        "User-Agent": "okhttp/4.12.0",
        "Accept-Encoding": "gzip"
      },
      body: JSON.stringify(envelope)
    });
    const teks = await upstream.text();
    let parsed = null;
    try {
      parsed = JSON.parse(teks);
    } catch {
      return { ok: false, kode: 502, pesan: "Server pusat mengembalikan respons yang bukan JSON." };
    }
    const galat = parsed?.error;
    if (galat) {
      const pesan = typeof galat === "string" ? galat : galat.message ?? "Permintaan ditolak server pusat.";
      const kodeGateway = typeof galat === "object" && galat ? galat.code : void 0;
      return { ok: false, kode: kodeGateway === 402 ? 402 : 401, pesan };
    }
    const hasil = parsed?.result;
    const apiKey = String(hasil?.api_key ?? "");
    if (!hasil || !apiKey) {
      return { ok: false, kode: 401, pesan: "NIP atau password server pusat tidak cocok." };
    }
    return { ok: true, apiKey, profil: { ...hasil, nip, imei } };
  } catch (err) {
    return {
      ok: false,
      kode: 502,
      pesan: `Gagal menghubungi server pusat: ${err?.message ?? "tidak diketahui"}`
    };
  }
}
async function gantiPasswordSendiri(token, isi) {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil) return { ok: false, kode: 401, pesan: "Sesi tidak valid." };
  const baru = String(isi.passwordBaru ?? "");
  const galat = validatePassword(baru);
  if (galat) return { ok: false, kode: 400, pesan: galat };
  const db = await admin();
  const ref = db.collection(COLL_PENGGUNA).doc(kunciAkun(pemanggil.username));
  const snap = await ref.get();
  if (!snap.exists) {
    return {
      ok: false,
      kode: 400,
      pesan: 'Akun admin bawaan \u2014 ganti lewat bagian "Ganti Password" yang sama.'
    };
  }
  const sekarang = snap.data();
  const sah = await verifyPinLayered(
    String(isi.passwordLama ?? ""),
    String(sekarang.passwordHash ?? "")
  );
  if (!sah) return { ok: false, kode: 401, pesan: "Password lama tidak valid." };
  await ref.set(
    { passwordHash: await hashPinLayered(baru), updatedAt: (/* @__PURE__ */ new Date()).toISOString() },
    { merge: true }
  );
  return { ok: true, kode: 200, pesan: "Password berhasil diperbarui." };
}
var COLL_PENGGUNA, COLL_PENGATURAN, COLL_LANGGANAN, COLL_TAGIHAN, BATAS_AKUN_PANEL, DOC_AUTH, TOKEN_TTL_MS, PERBARU_BILA_SISA_MS, TOKEN_V, NAMA_ADMIN_BAWAAN, GATEWAY_BAWAAN, BATAS_PER_IP, BATAS_PER_AKUN, JENDALA_MS, percobaanIp, percobaanAkun, BATAS_ENTRI_PEMBATAS, pesanGagal, OPENSSL_SALTED_MAGIC;
var init_panelServer = __esm({
  "src/lib/panelServer.ts"() {
    "use strict";
    init_firestoreAdmin();
    init_pin();
    init_presensiContract();
    init_firestoreAman();
    init_userManager();
    COLL_PENGGUNA = "jatim_pengguna";
    COLL_PENGATURAN = "jatim_pengaturan";
    COLL_LANGGANAN = "jatim_langganan";
    COLL_TAGIHAN = "jatim_tagihan";
    BATAS_AKUN_PANEL = 1e3;
    DOC_AUTH = "auth";
    TOKEN_TTL_MS = 30 * 60 * 1e3;
    PERBARU_BILA_SISA_MS = 10 * 60 * 1e3;
    TOKEN_V = 1;
    NAMA_ADMIN_BAWAAN = "admin";
    GATEWAY_BAWAAN = "https://presensi.bkd.jatimprov.go.id/service";
    BATAS_PER_IP = 20;
    BATAS_PER_AKUN = 8;
    JENDALA_MS = 10 * 60 * 1e3;
    percobaanIp = /* @__PURE__ */ new Map();
    percobaanAkun = /* @__PURE__ */ new Map();
    BATAS_ENTRI_PEMBATAS = 500;
    pesanGagal = "ID pengguna atau kata sandi salah.";
    OPENSSL_SALTED_MAGIC = NodeBuffer.from("Salted__", "utf8");
  }
});

// src/lib/durasi.ts
function hariDalamBulan(tahun, bulan) {
  return new Date(tahun, bulan + 1, 0).getDate();
}
function tambahDurasi(dari, durasi, satuan) {
  const hasil = new Date(dari.getTime());
  const n = Math.round(Number(durasi) || 0);
  if (n <= 0) return hasil;
  if (satuan === "hari") {
    hasil.setDate(hasil.getDate() + n);
    return hasil;
  }
  if (satuan === "tahun") {
    const bulanAsal2 = hasil.getMonth();
    const hariAsal2 = hasil.getDate();
    hasil.setDate(1);
    hasil.setFullYear(hasil.getFullYear() + n);
    hasil.setMonth(bulanAsal2);
    hasil.setDate(Math.min(hariAsal2, hariDalamBulan(hasil.getFullYear(), bulanAsal2)));
    return hasil;
  }
  const bulanAsal = hasil.getMonth();
  const hariAsal = hasil.getDate();
  const totalBulan = hasil.getFullYear() * 12 + bulanAsal + n;
  const tahunBaru = Math.floor(totalBulan / 12);
  const bulanBaru = (totalBulan % 12 + 12) % 12;
  hasil.setDate(1);
  hasil.setFullYear(tahunBaru, bulanBaru, 1);
  hasil.setDate(Math.min(hariAsal, hariDalamBulan(tahunBaru, bulanBaru)));
  return hasil;
}
function normalisasiPaket(mentah) {
  if (!mentah || typeof mentah !== "object") return null;
  const data = mentah;
  const id = String(data.id ?? "").trim();
  const label = String(data.label ?? id).trim();
  const harga = Number(data.harga) || 0;
  if (!id || harga <= 0) return null;
  const satuan = data.satuan;
  const durasi = Number(data.durasi);
  if ((satuan === "hari" || satuan === "bulan" || satuan === "tahun") && durasi > 0) {
    const hasil = {
      id,
      label,
      harga,
      durasi: Math.round(durasi),
      satuan
    };
    const keterangan = typeof data.keterangan === "string" ? data.keterangan.trim() : "";
    if (keterangan) hasil.keterangan = keterangan;
    return hasil;
  }
  const hari = Number(data.durasiHari) || 0;
  if (hari <= 0) return null;
  if (hari % 365 === 0) return { id, label, harga, durasi: hari / 365, satuan: "tahun" };
  if (hari % 30 === 0 && hari < 365) return { id, label, harga, durasi: hari / 30, satuan: "bulan" };
  return { id, label, harga, durasi: hari, satuan: "hari" };
}
function normalisasiDaftarPaket(mentah) {
  if (!Array.isArray(mentah)) return [];
  return mentah.map(normalisasiPaket).filter((item) => item !== null);
}
var PREFIX_ORDER_ID = "PRABAWA";

// src/lib/serverBilling.ts
init_firestoreAman();
init_firestoreAdmin();

// src/lib/midtransEnv.ts
function midtransProduksi() {
  return process.env.MIDTRANS_IS_PRODUCTION === "true" || process.env.VITE_MIDTRANS_IS_PRODUCTION === "true";
}

// src/lib/serverBilling.ts
var COLL_PENGATURAN2 = "jatim_pengaturan";
var COLL_LANGGANAN2 = "jatim_langganan";
var COLL_TAGIHAN2 = "jatim_tagihan";
var DOC_BILLING = "billing";
async function bacaPaket() {
  const snap = await (await admin()).collection(COLL_PENGATURAN2).doc(DOC_BILLING).get();
  const data = snap.data();
  return normalisasiDaftarPaket(data?.paket);
}
function paketDariOrderId(orderId, paket) {
  const atas = orderId.toUpperCase();
  const cocok = paket.find(
    (item) => atas.startsWith(`${PREFIX_ORDER_ID}-${item.id.toUpperCase()}-`)
  );
  return cocok ?? null;
}
async function verifikasiMidtrans(orderId, options) {
  const base = options.produksi ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  const auth = Buffer.from(`${options.serverKey}:`).toString("base64");
  try {
    const response = await fetch(
      `${base}/v2/${encodeURIComponent(orderId)}/status`,
      { headers: { Accept: "application/json", Authorization: `Basic ${auth}` } }
    );
    const data = await response.json();
    if (!response.ok) {
      return {
        ok: false,
        pesan: data?.error_messages?.[0] || `Transaksi tidak ditemukan di Midtrans (HTTP ${response.status}).`
      };
    }
    const status = String(data.transaction_status ?? "");
    const fraud = String(data.fraud_status ?? "");
    if (status !== "settlement") {
      const pesan = status === "pending" ? "Pembayaran belum diterima (masih pending)." : status === "expire" ? "Kedaluwarsa sebelum dibayar." : `Transaksi berstatus "${status || "tidak diketahui"}", belum lunas.`;
      return { ok: false, status, nominal: Number(data.gross_amount ?? 0) || void 0, pesan };
    }
    if (fraud && fraud !== "accept") {
      return { ok: false, status, pesan: `Transaksi ditahan Midtrans (fraud_status: ${fraud}).` };
    }
    const nominal = typeof data.gross_amount === "string" || typeof data.gross_amount === "number" ? Math.round(Number(data.gross_amount)) : NaN;
    if (!Number.isFinite(nominal) || nominal <= 0) {
      return {
        ok: false,
        status,
        pesan: "Nominal transaksi tidak terbaca dari Midtrans, pembayaran tidak bisa diverifikasi."
      };
    }
    return {
      ok: true,
      status,
      nominal,
      waktuBayar: typeof data.waktu_paid === "string" ? data.waktu_paid : void 0
    };
  } catch (err) {
    return { ok: false, pesan: `Gagal menghubungi Midtrans: ${err?.message ?? "tidak diketahui"}` };
  }
}
async function akunPemanggil(token) {
  const { akunDariToken: akunDariToken2 } = await Promise.resolve().then(() => (init_panelServer(), panelServer_exports));
  return akunDariToken2(token);
}
async function aktifkanLangganan(token, permintaan) {
  const { orderId, metode } = permintaan;
  const pemanggil = await akunPemanggil(token);
  if (!pemanggil) {
    return {
      ok: false,
      kode: 401,
      pesan: "Sesi tidak valid atau sudah berakhir. Login ulang lalu coba lagi."
    };
  }
  const username = pemanggil.username;
  if (!orderId) {
    return { ok: false, pesan: "orderId wajib diisi.", kode: 400 };
  }
  if (/[\\/]/.test(orderId) || /[\\/]/.test(username) || orderId.length > 80 || username.length > 64) {
    return { ok: false, pesan: "orderId atau username tidak valid.", kode: 400 };
  }
  const db = await admin();
  const refLangganan = db.collection(COLL_LANGGANAN2).doc(username);
  const refTagihan = db.collection(COLL_TAGIHAN2).doc(orderId);
  const tagihanAda = await refTagihan.get();
  if (tagihanAda.exists) {
    const lama = tagihanAda.data();
    if (lama?.masaAkhirSetelah) {
      return {
        ok: true,
        masaAkhir: String(lama.masaAkhirSetelah),
        nominal: Number(lama.nominal ?? 0) || void 0,
        durasi: Number(lama.durasi ?? 0) || void 0,
        sumber: lama.sumber ?? "manual"
      };
    }
  }
  const paket = await bacaPaket();
  const paketTerpilih = paketDariOrderId(orderId, paket);
  if (!paketTerpilih) {
    return {
      ok: false,
      pesan: "Paket pada tagihan tidak dikenal atau sudah tidak dijual. Hubungi administrator.",
      kode: 422
    };
  }
  let sumber = "manual";
  let waktuBayar = (/* @__PURE__ */ new Date()).toISOString();
  if (metode === "qris_midtrans") {
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    if (!serverKey) {
      return { ok: false, pesan: "Server belum dikonfigurasi untuk Midtrans.", kode: 500 };
    }
    const hasil = await verifikasiMidtrans(orderId, {
      serverKey,
      produksi: midtransProduksi()
    });
    if (!hasil.ok) {
      return { ok: false, pesan: hasil.pesan, kode: 402, statusTransaksi: hasil.status };
    }
    if (hasil.nominal !== paketTerpilih.harga) {
      return {
        ok: false,
        pesan: `Nominal tidak cocok: dibayar ${hasil.nominal}, paket apa adanya ${paketTerpilih.harga}.`,
        kode: 409
      };
    }
    sumber = "midtrans";
    if (hasil.waktuBayar) waktuBayar = hasil.waktuBayar;
  } else if (permintaan.nominalKlien !== void 0 && permintaan.nominalKlien !== paketTerpilih.harga) {
    return {
      ok: false,
      pesan: "Nominal tidak sesuai harga paket. Muat ulang halaman.",
      kode: 409
    };
  }
  const sekarang = new Date(waktuBayar);
  return db.runTransaction(async (tx) => {
    const snapTagihan = await tx.get(refTagihan);
    const snapLangganan = await tx.get(refLangganan);
    if (snapTagihan.exists) {
      const tagihanLama = snapTagihan.data();
      if (tagihanLama?.masaAkhirSetelah) {
        return {
          ok: true,
          masaAkhir: String(tagihanLama.masaAkhirSetelah),
          nominal: Number(tagihanLama.nominal ?? 0) || void 0,
          durasi: Number(tagihanLama.durasi ?? 0) || void 0,
          sumber: tagihanLama.sumber ?? "manual"
        };
      }
    }
    const lama = snapLangganan.data();
    const masaAkhirLama = typeof lama?.masaAkhir === "string" ? lama.masaAkhir : "";
    const masihAktif = Boolean(masaAkhirLama) && masaAkhirLama > sekarang.toISOString();
    const dasar = masihAktif ? new Date(masaAkhirLama) : sekarang;
    const masaAkhirBaru = tambahDurasi(dasar, paketTerpilih.durasi, paketTerpilih.satuan).toISOString();
    const masaMulaiBaru = masihAktif ? lama.masaMulai : sekarang.toISOString();
    tx.set(
      refLangganan,
      // ⚠️ WAJIB `bersihkanUndefined`. `lama?.alasanGratis` menghasilkan
      // `undefined` untuk akun yang belum pernah ditandai gratis, dan
      // Firestore menolak `undefined` outright — bukan mengabaikannya.
      // Gejalanya: "Function setDoc() called with invalid data. Unsupported
      // field value: undefined (found in field alasanGratis)".
      bersihkanUndefined({
        username,
        paketId: paketTerpilih.id,
        masaMulai: masaMulaiBaru,
        masaAkhir: masaAkhirBaru,
        gratis: lama?.gratis ?? false,
        alasanGratis: lama?.alasanGratis,
        totalBayar: (Number(lama?.totalBayar ?? 0) || 0) + paketTerpilih.harga,
        jumlahBayar: (Number(lama?.jumlahBayar ?? 0) || 0) + 1,
        pembayaranTerakhir: {
          orderId,
          nominal: paketTerpilih.harga,
          metode,
          sumber,
          waktu: waktuBayar
        },
        createdAt: lama?.createdAt ?? sekarang.toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }),
      { merge: true }
    );
    tx.set(
      refTagihan,
      bersihkanUndefined({
        orderId,
        username,
        usernameLabel: lama?.username ?? username,
        paketId: paketTerpilih.id,
        nominal: paketTerpilih.harga,
        metode,
        sumber,
        durasi: paketTerpilih.durasi,
        satuan: paketTerpilih.satuan,
        status: "lunas",
        catatan: "",
        buktiUrl: "",
        waktuBayar,
        masaAkhirSetelah: masaAkhirBaru,
        createdAt: snapTagihan.exists ? snapTagihan.data()?.createdAt : (/* @__PURE__ */ new Date()).toISOString()
      }),
      { merge: true }
    );
    return {
      ok: true,
      masaAkhir: masaAkhirBaru,
      masaMulai: masaMulaiBaru,
      nominal: paketTerpilih.harga,
      durasi: paketTerpilih.durasi,
      satuan: paketTerpilih.satuan,
      sumber
    };
  });
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

// src/serverless/billing-aktivasi.ts
var BATAS_AKTIVASI = 20;
var JENDALA_AKTIVASI_MS = 6e4;
var riwayat = /* @__PURE__ */ new Map();
function bacaToken2(req, body) {
  const header = String(req.headers?.authorization ?? "").trim();
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, "").trim();
  return typeof body.token === "string" ? body.token.trim() : "";
}
async function handler(req, res) {
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ ok: false, pesan: "Origin tidak diizinkan." });
  }
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, pesan: "Method tidak diizinkan." });
  }
  const ip = req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "tak-diketahui";
  const sekarangMs = Date.now();
  const catat = riwayat.get(ip);
  if (catat && sekarangMs - catat.mulai < JENDALA_AKTIVASI_MS) {
    if (catat.jumlah >= BATAS_AKTIVASI) {
      const tunggu = Math.ceil((JENDALA_AKTIVASI_MS - (sekarangMs - catat.mulai)) / 1e3);
      res.setHeader("Retry-After", String(tunggu));
      return res.status(429).json({ ok: false, pesan: `Terlalu banyak permintaan. Coba lagi dalam ${tunggu} detik.` });
    }
    catat.jumlah += 1;
  } else {
    riwayat.set(ip, { jumlah: 1, mulai: sekarangMs });
  }
  if (!adminTersedia()) {
    return res.status(503).json({
      ok: false,
      pesan: "Server belum dikonfigurasi untuk menulis langganan. Isi FIREBASE_SERVICE_ACCOUNT di dashboard Vercel."
    });
  }
  const { orderId, metode, nominal } = req.body ?? {};
  try {
    const hasil = await aktifkanLangganan(
      bacaToken2(req, req.body ?? {}),
      {
        orderId: String(orderId ?? ""),
        metode: metode === "qris" || metode === "transfer" ? metode : "qris_midtrans",
        nominalKlien: typeof nominal === "number" ? nominal : void 0
      }
    );
    return res.status(hasil.ok ? 200 : hasil.kode ?? 400).json(hasil);
  } catch (err) {
    console.error("Aktivasi langganan gagal:", err);
    return res.status(500).json({ ok: false, pesan: "Gagal memproses pembayaran di server." });
  }
}
export {
  handler as default
};
