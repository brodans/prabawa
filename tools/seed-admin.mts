#!/usr/bin/env node
/**
 * Seed akun admin awal ke Firestore.
 *
 * Menulis satu dokumen ke `jatim_pengguna/{username}` dengan password yang
 * di-hash memakai algoritma yang sama persis dengan aplikasi:
 *   bcrypt(SHA256(password + "epresensi-jatim-pin-salt-v1"))
 *
 * Jalankan:
 *   npm run seed:admin -- admin admin
 *
 * Password tidak pernah ditulis ke file mana pun dalam bentuk polos —
 * hanya hash yang masuk Firestore.
 *
 * ## Kenapa memakai `firebase-admin`, bukan SDK peramban
 *
 * Semula skrip ini memakai `firebase/app` + `firebase/firestore` — SDK
 * peramban, dengan `VITE_FIREBASE_API_KEY` dari `.env`. Itu tidak pernah bisa
 * berhasil:
 *
 * ```
 * match /jatim_pengguna/{username} {
 *   allow read, write: if false;
 * }
 * ```
 *
 * Permintaan dari SDK peramban tiba sebagai **anonim** (lihat bagian
 * "Semua permintaan Firestore dari peramban" di `firestore.rules`), jadi
 * `allow ... if false` menolaknya. Skrip ini tidak punya jalur privileged apa
 * pun: ia hanya punya API key, yang bukan rahasia dan tidak memberi hak tulis
 * ke koleksi server-only. `npm run seed:admin` gagal dengan permission denied.
 *
 * Admin SDK conversely melompati rules sepenuhnya — persis seperti handler
 * produksi. Jadi ini bukan pilihan gaya, tapi memperbaiki skrip yang tidak
 * bisa berjalan.
 *
 * Dua alasan pendukung:
 *
 * 1. **Menarik 169 MB dependensi.** `firebase` + `@firebase` menarik
 *    `@grpc/grpc-js` yang membawa beberapa advisory **high**. Semua itu hanya
 *    untuk satu skrip yang jarang dijalankan, dan tidak pernah masuk bundle
 *    peramban maupun server.
 * 2. **Dua jalur kode untuk satu hal.** Kredensial dibaca ulang di sini dengan
 *    parser sendiri, terpisah dari `src/lib/firestoreAdmin.ts` yang dipakai
 *    seluruh kode server. Dua pembaca `.env` berbeda pasti akan menyimpang.
 *
 * Sekarang skrip ini memakai `admin()` yang sama dengan handler produksi: satu
 * sumber kredensial, satu penanganan app, satu pesan galat. SDK peramban bisa
 * dicabut dari `package.json`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import CryptoJS from 'crypto-js';
import type { TabPermissions } from '../src/lib/userManager';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN_SALT = 'epresensi-jatim-pin-salt-v1';

/**
 * Izin yang diberikan ke akun admin saat pertama dibuat.
 *
 * `Partial`, dan bukan `TabPermissions` penuh, itu disengaja. `TabPermissions`
 * punya 14 kunci; skrip ini menulis **12** saja, dan itulah yang selalu terjadi
 * sejak awal. Menulis `TabPermissions` penuh agar typecheck lolos justru akan
 * diam-diam menambah `tabWeb`, `tabManajemenAkun`, dan `aksiSesiServer` ke
 * dokumen yang ditulis — mengubah akun pertama yang created.
 *
 * `normalizeUserPermissions` sudah men-default kunci yang kosong, jadi 12 kunci
 * ini tetap menghasilkan akun yang utuh.
 */
const ADMIN_PERMISSIONS: Partial<TabPermissions> = {
  tabBeranda: true,
  tabPresensi: true,
  tabPerizinan: true,
  tabLaporan: true,
  tabDocs: true,
  tabLokasiAbsen: true,
  aksiAbsen: true,
  aksiAjukanIzin: true,
  aksiSyncData: true,
  aksiKelolaUser: true,
  tabDeveloper: true,
};

function bacaEnv(): Record<string, string> {
  const isi = readFileSync(join(root, '.env'), 'utf8');
  const env: Record<string, string> = {};
  for (const baris of isi.split('\n')) {
    const match = baris.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

async function hashPassword(plain: string): Promise<string> {
  const step = CryptoJS.SHA256(`${plain}${PIN_SALT}`).toString(CryptoJS.enc.Hex);
  return bcrypt.hash(step, 10);
}

const [, , username = 'admin', password = 'admin'] = process.argv;

if (password.length < 6) {
  console.error('[!] Password minimal 6 karakter (sesuai validasi aplikasi).');
  process.exit(1);
}

// Kredensial dimuat ke `process.env` supaya `firestoreAdmin.admin()` — yang
// sudah jadi satu-satunya pembaca kredensial di proyek ini — bisa memakainya.
// Nilai yang sudah ada di environment menang, jadi eksekusi manual dengan
// `GOOGLE_APPLICATION_CREDENTIALS` tidak tertimpa isi `.env`.
const env = bacaEnv();
for (const kunci of [
  'FIREBASE_SERVICE_ACCOUNT',
  'FIREBASE_PROJECT_ID',
  'GOOGLE_APPLICATION_CREDENTIALS',
]) {
  if (!process.env[kunci] && env[kunci]) process.env[kunci] = env[kunci];
}

if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('[!] Kredensial Admin SDK tidak ditemukan.');
  console.error('    Isi salah satu di .env:');
  console.error('      FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}');
  console.error('      GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json');
  console.error('    Ambil dengan: firebase serviceAccount:key > service-account.json');
  process.exit(1);
}

const { admin, adminTersedia } = await import('../src/lib/firestoreAdmin.ts');

if (!adminTersedia()) {
  console.error('[!] Kredensial terbaca tapi tidak lengkap — cek isi .env.');
  process.exit(1);
}

let db: Awaited<ReturnType<typeof admin>>;
try {
  db = await admin();
} catch (err) {
  console.error(`[x] Gagal menghubungi Firestore: ${(err as Error).message}`);
  process.exit(1);
}

// 'jatim_pengguna' adalah koleksi, username adalah id dokumen.
const ref = db.collection('jatim_pengguna').doc(username);
const ada = await ref.get();

if (ada.exists && process.env.FORCE !== '1') {
  console.log(`[!] Akun "${username}" sudah ada. Set FORCE=1 untuk menimpa.`);
  process.exit(1);
}

const now = new Date().toISOString();
await ref.set(
  {
    username,
    passwordHash: await hashPassword(password),
    role: 'admin',
    permissions: ADMIN_PERMISSIONS,
    createdAt: (ada.data()?.createdAt as string | undefined) ?? now,
    updatedAt: now,
  },
  { merge: true }
);

console.log(`[OK] Akun admin "${username}" tersimpan di jatim_pengguna/${username}`);
console.log('     Login panel: username + password yang Anda berikan.');
