/**
 * Klien tidak boleh menyentuh Firestore langsung.
 *
 * ## Bug yang ditutup modul ini
 *
 * `lib/firebase.ts` mengekspor `db` sebagai `let`, dan `langgananFirestore.ts`
 * mengimpornya **secara statis** lalu memakainya lewat `requireDb()`.
 *
 * Masalahnya: `db` hanya diisi di dalam `siapkanFirestore()`, dan
 * **tidak ada satu pun pemanggil** fungsi itu. Jadi:
 *
 * - `db` bernilai `null` selamanya,
 * - `requireDb()` melempar "Firebase belum dikonfigurasi" untuk setiap
 *   pembacaan,
 * - setiap pembacaan punya `catch` yang mengembalikan nilai cadangan,
 * - hasilnya: `loadPengaturanBilling()` selalu mengembalikan paket bawaan,
 *   `loadLangganan()` selalu `null`, `loadTagihan()` selalu `[]`.
 *
 * Tidak ada error yang terlihat. Gate langganan berjalan sempurna dengan data
 * kosong — setiap akun terbaca "belum bayar" dan tidak ada yang bisa membayar.
 *
 * ## Perbaikannya
 *
 * Akses Firestore dari peramban **dihapus seluruhnya**, bukan diperbaiki.
 * Alasannya bukan hanya bug di atas:
 *
 * - `firestore.rules` membiarkan `jatim_langganan` dan `jatim_tagihan` dengan
 *   `allow read: if true`, dan aplikasi ini tidak memakai Firebase Auth — jadi
 *   `request.auth` selalu `null` dan `if true` berarti seluruh koleksi terbuka
 *   untuk siapa pun yang punya API key. API key-nya ada di bundle peramban.
 * - `firebase/firestore` 140 kB gzip, 35% bundle, dan tidak dibutuhkan lagi.
 *
 * Sekarang semua pembacaan lewat `POST /api/panel-auth`, yang memverifikasi
 * token dan mengembalikan hanya dokumen milik pemanggil.
 *
 * Uji di bawah menjaga supaya tidak ada jalur Firestore yang diam-diam muncul
 * lagi lewat nama baru.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const baca = p => readFileSync(join(root, p), 'utf8');
/** Buang komentar supaya hanya kode yang benar-benar dijalankan. */
const kode = src =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

function walk(dir = join(root, 'src'), out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(ent.name) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const semuaSrc = walk();
const kodeFile = f => kode(readFileSync(f, 'utf8'));

// ═══ 1. Tidak ada SDK Firestore di kode peramban ════════════════════

const pemakaiSdk = semuaSrc.filter(f => /from 'firebase\/(firestore|app)'/.test(kodeFile(f)));
cek(
  'tidak ada modul peramban yang mengimpor firebase/firestore atau firebase/app',
  pemakaiSdk.length === 0,
  pemakaiSdk.map(f => f.replace(`${root}/`, '')).join(', ')
);

// ═══ 2. `firebase.ts` tidak lagi memuat SDK ═════════════════════════

const firebaseSrc = kode(baca('src/lib/firebase.ts'));
cek('firebase.ts tidak memanggil import() dinamis apa pun', !/await import\(/.test(firebaseSrc),
  'SDK-nya 140 kB gzip dan tidak dibutuhkan lagi');
cek('firebase.ts tidak mengekspor `let db`', !/export\s+let\s+db\b/.test(firebaseSrc),
  'ekspor `let` membuat pemanggil statis melihat nilai basi');
cek('firebase.ts tidak mengekspor db sebagai nilai', !/export\s+(const|let)\s+db\b/.test(firebaseSrc));
cek('firebase.ts tidak mengekspor instance Firestore', !/Firestore/.test(firebaseSrc),
  'tidak ada yang memakai instance anymore');
cek('firebase.ts hanya mengekspor isFirebaseReady', /export const isFirebaseReady/.test(firebaseSrc));

// ═══ 3. Pembacaan langganan lewat server ════════════════════════════

const langgananSrc = kode(baca('src/lib/langgananFirestore.ts'));
cek('langgananFirestore tidak mengimpor modul firebase', !/from '\.\/firebase'/.test(langgananSrc));
cek('langgananFirestore bicara ke /api/panel-auth', /from '\.\/akunFirestore'/.test(langgananSrc),
  'token diverifikasi server, nama akun diambil dari token');
cek('tidak ada requireDb lagi', !/requireDb/.test(langgananSrc));
cek(
  'nama akun diabaikan pada pembacaan per-akun',
  /loadLangganan\(username: string\)[\s\S]{0,200}?void username;/.test(langgananSrc),
  'kalau username diteruskan, satu akun bisa mengarahkan pembacaan ke dokumen orang lain'
);

// ═══ 4. Sisi server memverifikasi token ═════════════════════════════

const serverSrc = kode(baca('src/lib/serverBilling.ts'));

/*
 * Pembacaan milik sendiri — menolak sesi tidak sah dengan 401.
 *
 * Nama dokumen berasal dari `akunPemanggil(token)`, bukan dari request, jadi
 * satu akun tidak bisa mengarahkan pembacaan ke dokumen orang lain hanya
 * dengan mengubah `username` di body.
 */
for (const fn of ['bacaLanggananSaya', 'bacaTagihanSaya']) {
  cek(
    `${fn} menolak tanpa sesi`,
    new RegExp(`export async function ${fn}\\([\\s\\S]{0,400}?akunPemanggil\\(token\\)[\\s\\S]{0,200}?kode: 401`).test(serverSrc),
    'tanpa verifikasi token, endpoint ini jadi pembaca semua dokumen'
  );
  cek(
    `${fn} tidak menerima username dari input`,
    new RegExp(`export async function ${fn}\\([\\s\\S]{0,400}?input\\b`).test(serverSrc) === false,
    'nama dokumen harus berasal dari token, bukan dari request'
  );
  cek(
    `${fn} memfilter berdasarkan username dari token`,
    new RegExp(`export async function ${fn}\\([\\s\\S]{0,700}?pemanggil\\.username`).test(serverSrc)
  );
}

/*
 * Pembacaan seluruh koleksi — admin saja, menolak dengan 403.
 *
 * Beda kode dengan punyamu sendiri itu disengaja: 403 = "kamu ada, tapi
 * tidak berhak", 401 = "kamu tidak masuk". Menyamakan keduanya membuat
 * `GerbangLangganan` menampilkan "langganan habis" untuk sesi yang sebenarnya
 * kedaluwarsa.
 */
for (const fn of ['bacaSemuaLangganan', 'bacaSemuaTagihan']) {
  cek(
    `${fn} khusus admin`,
    new RegExp(`export async function ${fn}\\([\\s\\S]{0,300}?dindingAdmin`).test(serverSrc),
    'tanpa ini, allow read: if true yang lama berarti semua data terbuka'
  );
  cek(
    `${fn} menolak dengan 403`,
    new RegExp(`export async function ${fn}\\([\\s\\S]{0,300}?dindingAdmin[\\s\\S]{0,200}?kode: 403`).test(serverSrc)
  );
  cek(
    `${fn} dibatasi jumlah dokumen`,
    new RegExp(`export async function ${fn}\\([\\s\\S]{0,600}?\\.limit\\(`).test(serverSrc),
    'tanpa limit, satu akun dengan ribuan dokumen menghasilkan respons raksasa'
  );
}

// ═══ 5. Rules menutup koleksi entitlement dari klien ═════════════════

const rules = baca('firestore.rules')
  .replace(/^\s*\/\*\*[\s\S]*?\*\/\s*$/gm, '')
  .replace(/^\s*\/\/.*$/gm, '');
cek(
  'jatim_langganan: server-only sepenuhnya',
  /match \/jatim_langganan\/\{username\}\s*\{\s*allow read, write: if false;/.test(rules),
  'allow read: if true = NIP + masa aktif + status gratis terbuka untuk semua'
);
cek(
  'jatim_tagihan: server-only sepenuhnya',
  /match \/jatim_tagihan\/\{orderId\}\s*\{\s*allow read, write: if false;/.test(rules),
  'allow read: if true = nama + nominal + buktiUrl terbuka untuk semua'
);
cek(
  'hanya billing yang boleh dibaca peramban',
  /match \/jatim_pengaturan\/billing[\s\S]{0,120}allow read: if true;/.test(rules) &&
    !/match \/jatim_(langganan|tagihan)\/[^{]*\{[^}]*allow read: if true;/.test(rules)
);

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
