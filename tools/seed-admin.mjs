#!/usr/bin/env node
/**
 * Seed akun admin awal ke Firestore.
 *
 * Menulis satu dokumen ke `jatim_pengguna/{username}` dengan password yang
 * di-hash memakai algoritma yang sama persis dengan aplikasi:
 *   bcrypt(SHA256(password + "epresensi-jatim-pin-salt-v1"))
 *
 * Jalankan:
 *   node tools/seed-admin.mjs admin admin
 *
 * Password tidak pernah ditulis ke file mana pun dalam bentuk polos —
 * hanya hash yang masuk Firestore.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import bcrypt from 'bcryptjs';
import CryptoJS from 'crypto-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN_SALT = 'epresensi-jatim-pin-salt-v1';

const ADMIN_PERMISSIONS = {
  tabBeranda: true,
  tabPresensi: true,
  tabPerizinan: true,
  tabRiwayatIzin: true,
  tabLaporan: true,
  tabDocs: true,
  tabLokasiAbsen: true,
  aksiAbsen: true,
  aksiAjukanIzin: true,
  aksiSyncData: true,
  aksiKelolaUser: true,
  tabDeveloper: true,
};

function bacaEnv() {
  const isi = readFileSync(join(root, '.env'), 'utf8');
  const env = {};
  for (const baris of isi.split('\n')) {
    const match = baris.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

async function hashPassword(plain) {
  const step = CryptoJS.SHA256(`${plain}${PIN_SALT}`).toString(CryptoJS.enc.Hex);
  return bcrypt.hash(step, 10);
}

const [, , username = 'admin', password = 'admin'] = process.argv;

if (password.length < 6) {
  console.error('[!] Password minimal 6 karakter (sesuai validasi aplikasi).');
  process.exit(1);
}

const env = bacaEnv();
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

if (!config.apiKey || !config.projectId) {
  console.error('[!] VITE_FIREBASE_* di .env belum lengkap.');
  process.exit(1);
}

const db = getFirestore(initializeApp(config));
// 'jatim_pengguna' adalah koleksi, username adalah id dokumen.
const ref = doc(db, 'jatim_pengguna', username);
const ada = await getDoc(ref);

if (ada.exists() && process.env.FORCE !== '1') {
  console.log(`[!] Akun "${username}" sudah ada. Set FORCE=1 untuk menimpa.`);
  process.exit(1);
}

const now = new Date().toISOString();
await setDoc(
  ref,
  {
    username,
    passwordHash: await hashPassword(password),
    role: 'admin',
    permissions: ADMIN_PERMISSIONS,
    createdAt: ada.exists() ? ada.data().createdAt ?? now : now,
    updatedAt: now,
  },
  { merge: true }
);

console.log(`[✓] Akun admin "${username}" tersimpan di jatim/pengguna/${username}`);
console.log('    Login panel: username + password yang Anda berikan.');
