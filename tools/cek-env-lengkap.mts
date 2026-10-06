/**
 * Semua env yang dibaca kode harus terdaftar di `.env.example` — dan
 * sebaliknya: yang terdaftar harus benar-benar dibaca kode.
 *
 * ## Kenapa dua arah
 *
 * **Kode baca env yang tak terdaftar.** Env Vercel diisi manusia, dari
 * `.env.example`. Variabel yang tidak ada di sana tidak akan pernah diisi,
 * dan gejalanya muncul jauh dari penyebabnya: `ALLOWED_ORIGINS` kosong →
 * tiap panggilan API dapat 403 padahal server "sehat". Itu persis
 * kegagalan yang pernah terjadi di proyek ini, dan tidak ada yang
 * memberi tahu.
 *
 * **Env terdaftar tapi tak dibaca.** Itu kebocoran kecil: nama variabel
 * terlihat penting, seseorang mengisinya di dashboard, lalu tidak ada
 * yang memakainya. "Kelihatan terkonfigurasi" lebih buruk dari
 * "tidak ada", karena membuat orang berhenti memeriksa.
 *
 * Yang diperiksa: `src/**` + `vite.config.ts` (kode yang benar-benar jalan),
 * bukan skrip uji. Skrip uji boleh membaca env untuk kebutuhan skripnya sendiri.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const contoh = readFileSync(join(root, '.env.example'), 'utf8');

/** Nama env yang ditulis di `.env.example` (asal dan yang dikomentari). */
const terdaftar = new Set<string>(
  [...contoh.matchAll(/^\s*#?\s*([A-Z][A-Z_0-9]*)\s*=/gm)].map(m => m[1])
);

function walkSrc(dir: string = join(root, 'src'), out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkSrc(p, out);
    else if (/\.tsx?$/.test(ent.name) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * Env yang dibaca kode aplikasi.
 *
 * ⚠️ Polanya harus menerima `import.meta.env?.X` **dan** `process.env.X`.
 * Bentuk `?.` dipakai hampir semua env Vite di proyek ini
 * (`import.meta.env?.VITE_FIREBASE_API_KEY`), dan pola yang hanya
 * mencari titik akan melewatkannya — yang membuat variabel yang benar-benar
 * tak terpakai ikut lolos, dan orang lalu menghapus env yang sebenarnya
 * masih dibaca.
 */
const dibaca = new Map<string, string[]>();
/*
 * `vite.config.ts` ikut dipindai karena ia **kode yang jalan**, bukan skrip uji:
 * plugin OCR lokal di sana membaca `OCR_HOST`/`OCR_PORT`. Kalau berkas ini
 * tidak dipindai, kedua variabel itu terbaca "terdaftar tapi tidak dipakai" —
 * dan guard ini akan menyuruh orang menghapusnya dari `.env.example`, padahal
 * kodenya jelas membacanya.
 */
for (const f of [...walkSrc(), join(root, 'vite.config.ts')]) {
  const isi = readFileSync(f, 'utf8');
  // `?.` dituliskan opsional supaya keduanya tertangkap.
  const pola = /(?:import\.meta\.env|process\.env)\??\.([A-Z][A-Z_0-9]*)/g;
  for (const m of isi.matchAll(pola)) {
    const daftar = dibaca.get(m[1]) ?? [];
    daftar.push(f.replace(root, ''));
    dibaca.set(m[1], daftar);
  }
  // Bentuk lain: destructuring, mis. `const { X } = import.meta.env`.
  for (const m of isi.matchAll(/(?:import\.meta\.env|process\.env)\s*\.\s*([A-Z][A-Z_0-9]*)/g)) {
    const daftar = dibaca.get(m[1]) ?? [];
    daftar.push(f.replace(root, ''));
    dibaca.set(m[1], daftar);
  }
}

console.log('=== 1. Semua env yang dibaca kode terdaftar di .env.example');

/**
 * Env yang dibaca kode tapi **tidak boleh** diisi manusia.
 *
 * Semuanya disetel platform, jadi menaruhnya di `.env.example` hanya
 * menyuruh orang mengisinya dengan nilai yang tidak ada gunanya.
 *
 * Daftar ini eksplisit, bukan pola: kalau nanti ada env platform lain
 * yang terbaca, guard ini akan gagal dan memaksa ditambahkan di sini
 * beserta alasannya — bukan lolos diam-diam bersama seluruh daftar.
 */
const DI_SETEL_PLATFORM: Record<string, string> = {
  NODE_ENV: 'disetel Vercel / Node',
  PORT: 'disetel platform; hanya untuk server dev',
  K_SERVICE: 'disetel Google Cloud Run — hanya untuk mendeteksi "saya di cloud"',
  GOOGLE_CLOUD_PROJECT: 'disetel Google Cloud Run — hanya untuk mendeteksi "saya di cloud"',
  FIREBASE_CLOUD_PROJECT: 'disetel Google Cloud Run — hanya untuk mendeteksi "saya di cloud"',
  /*
   * `VERCEL` dan `VERCEL_ENV` disetel Vercel sendiri di setiap function —
   * tidak bisa diisi manual dan tidak perlu ada di `.env.example`.
   *
   * `ep.ts` memakainya untuk membedakan produksi (HTTPS: cookie perlu
   * `Secure`) dari dev lokal (HTTP: `Secure` dihapus supaya browser mau
   * menyimpan cookie di localhost). Semuanya dik injecting Vercel, jadi
   * tidak pernah kosong di production.
   */
  VERCEL: 'disetel Vercel — penanda "saya di Vercel", bukan env aplikasi',
  VERCEL_ENV: 'disetel Vercel — production/preview/development',
  /*
   * `DEV` di sini **bukan** `process.env.DEV`.
   *
   * Pemindaian di atas menangkap `import.meta.env.DEV` di `WebPresensi.tsx` —
   * penanda "build pengembangan" dari Vite. Vite yang menyuntikkannya saat
   * build: `true` di `npm run dev`, `false` di build produksi. Tidak ada yang
   * perlu mengisinya di dashboard Vercel, dan tidak bisa diisi manual pun:
   * nilainya sudah di-*constant-fold* ke dalam bundle.
   */
  DEV: 'disetel Vite saat build — import.meta.env.DEV, bukan env aplikasi',
};

for (const [nama, di] of [...dibaca].sort()) {
  cek(
    `${nama} terdaftar`,
    terdaftar.has(nama) || nama in DI_SETEL_PLATFORM,
    DI_SETEL_PLATFORM[nama]
      ? `${di[0]} — ${DI_SETEL_PLATFORM[nama]}`
      : `dibaca di ${di[0]} — tapi tidak ada di .env.example, jadi tidak akan pernah diisi di Vercel`
  );
}

console.log('\n=== 2. Semua env yang terdaftar benar-benar dibaca kode');
for (const nama of [...terdaftar].sort()) {
  // `VITE_*` yang tidak dirujuk masih boleh: yang disebut eksplisit di
  // `vite-env.d.ts` atau memang milik tooling, bukan aplikasi.
  const dipakaiLangsung = dibaca.has(nama);
  const diTipografi = /readonly\s+[A-Z_0-9]+/.test(
    readFileSync(join(root, 'src/vite-env.d.ts'), 'utf8')
  )
    ? new RegExp(`readonly\\s+${nama}\\b`).test(readFileSync(join(root, 'src/vite-env.d.ts'), 'utf8'))
    : false;

  cek(
    `${nama} dibaca aplikasi`,
    dipakaiLangsung || diTipografi,
    dipakaiLangsung
      ? ''
      : 'terdaftar tapi tidak dipakai — orang akan mengisinya di dashboard tanpa efek'
  );
}

console.log('\n=== 3. Tidak ada VITE_ yang membocorkan rahasia ke peramban');

/**
 * Satu-satunya `VITE_*` yang namanya mencurigakan tapi memang tidak
 * bisa dipindah ke server.
 *
 * `VITE_APP_SECRET` mengenkripsi password server pusat sebelum disimpan ke
 * dokumen Firestore **milik pengguna itu sendiri**, supaya tidak terbaca
 * polos di Firebase Console. Enkripsi harusnya terjadi sebelum data
 * meninggalkan peramban — kalau dipindah ke server, kuncinya jadi milik
 * server dan bobotnya hilang: siapa pun yang bisa memakai endpoint itu
 * sudah bisa membaca password apa pun yang tersimpan.
 *
 * Yang dilindungi: skrip lain di origin yang sama membacanya, bukan
 * mencegah pengguna sendiri melihat passwordnya sendiri — itu memang
 * tidak bisa dihindari di desain seperti ini.
 */
const VITE_YANG_WAJIB_PUBLIK = new Set(['VITE_APP_SECRET']);

for (const nama of terdaftar) {
  if (!nama.startsWith('VITE_')) continue;
  const mencurigakan = /SECRET|PRIVATE|SERVER_KEY|SERVICE_ACCOUNT|PASSWORD|TOKEN/i.test(nama);
  cek(
    `${nama} aman untuk peramban`,
    !mencurigakan || VITE_YANG_WAJIB_PUBLIK.has(nama),
    VITE_YANG_WAJIB_PUBLIK.has(nama)
      ? 'wajib ada di peramban — kuncinya mengenkripsi data milik pengguna sendiri sebelum dikirim'
      : 'Vite menyuntik seluruh VITE_* ke JavaScript — berawalan VITE_ berarti ada di bundle'
  );
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. .env.example menjelaskan cara menutupi kegagalan yang pernah terjadi');
/*
 * Setiap penyebab kegagalan yang nyata harus punya petunjuk perbaikannya.
 *
 * `PANEL_SESSION_SECRET` masuk daftar ini karena tanpanya **tidak ada yang bisa
 * login sama sekali** — gejalanya 503 yang bentuknya mirip "server tidak bisa
 * dihubungi", dan penyebabnya tidak muncul di mana pun kalau tidak ditulis.
 */
/** Topik yang harus disinggung di `.env.example`, dengan polanya. */
const TOPIK_ENV: ReadonlyArray<readonly [string, RegExp]> = [
  ['ALLOWED_ORIGINS', /ALLOWED_ORIGINS/],
  ['Node 22 untuk @google-cloud/firestore', /Node.{0,4}\s*(?:>=)?\s*22|nodejs22/i],
  ['firebase deploy --only firestore:rules', /firestore:rules/],
  ['kenapa id perangkat tidak dipusatkan', /perangkat|imei/i],
  ['PANEL_SESSION_SECRET + syarat panjangnya', /PANEL_SESSION_SECRET[\s\S]{0,900}32 karakter/],
  ['PANEL_SESSION_SECRET tidak boleh berawalan VITE_', /JANGAN PERNAH membuatnya berawalan `VITE_`/],
  [' kenapa rules yang belum di-deploy berbahaya', /role: 'admin'[\s\S]{0,200}refresh/],
];

for (const [topik, pola] of TOPIK_ENV) {
  cek(`.env.example menyebut ${topik}`, pola.test(contoh));
}

/*
 * Id perangkat harus dibuat di peramban, bukan di environment variable.
 *
 * Ini pernah jadi sebaliknya: ada `PRESENSI_TECH_MARK` di `.env`, dan
 * kelihatannya seperti konfigurasi yang berarti. Padahal sebenarnya tidak
 * pernah terpakai — `useServerContext()` selalu mengirim `imei` (walau hanya `''`),
 * dan `??` hanya memakai cadangan saat nilainya `null`, bukan saat string
 * kosong. Satu UUID yang terbaca "sudah dikonfigurasi" tapi tidak pernah
 * dipakai lebih berbahaya daripada tidak ada sama sekali, karena membuat
 * orang berhenti memeriksa.
 */
cek(
  'tidak ada env id-perangkat yang dipusatkan',
  !terdaftar.has('PRESENSI_TECH_MARK'),
  'id perangkat dibuat per akun per peramban di src/lib/idPerangkat.ts'
);
// Komentar dibuang dulu: nama `TECH_MARK` masih disebut di penjelasan
// kenapa ia dihapus, dan penyebutan di situ justru itu yang berguna.
const tanpaKomentar = (f: string): string =>
  readFileSync(join(root, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

cek(
  'proxy tidak punya fallback UUID untuk imei',
  !/TECH_MARK/.test(tanpaKomentar('src/serverless/rpc.ts')) &&
    !/TECH_MARK/.test(tanpaKomentar('src/api/server.ts')),
  'satu id yang dibagi ke semua perangkat menghapus makna pengikatan akun'
);

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
if (fail > 0) process.exitCode = 1;
