/**
 * Uji keamanan — menguji apa yang **tidak boleh** terjadi.
 *
 * Skrip lain membuktikan fitur berjalan. Skrip ini membuktikan kebocoran
 * dan bypass yang paling mungkin terjadi kalau aturan keamanan
 * dilonggarkan.
 *
 * Yang diuji:
 *
 * 1. **Tidak ada `Server Key` di kode klien.** `VITE_*` di-bundle Vite ke
 *    peramban, jadi satu rujukan saja sudah cukup membocorkan key.
 * 2. **Tidak ada nomor telepon hardcoded.** Nomor WA harus datang dari
 *    Firestore, tidak pernah ditulis di source.
 * 3. **CORS tidak terbuka.** `Access-Control-Allow-Origin: *` di endpoint
 *    serverless membuat proxy bisa dipanggil dari halaman mana pun.
 * 4. **IP klien tidak diteruskan ke gateway pusat.**
 * 5. **Firestore rules menolak tulis dari klien** untuk koleksi langganan
 *    dan tagihan.
 * 6. **Tidak ada hardcoded `localhost`/IP debug** yang bocor ke bundle.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
/** Baca file; `p` boleh relatif terhadap root atau sudah absolut. */
const baca = (p: string): string => readFileSync(p.startsWith('/') ? p : join(root, p), 'utf8');
/** Buang komentar supaya hanya kode yang benar-benar dijalankan. */
const kode = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Berkas di `src/` yang **hanya** berjalan di server.
 *
 * `src/api/server.ts` di-bundle terpisah oleh esbuild ke `dist/server.cjs`
 * (lihat script "build") dan `src/lib/serverBilling.ts` hanya diimpor
 * dinamis darinya — keduanya tidak pernah masuk bundel peramban, jadi
 * boleh membaca `process.env`.
 */
/**
 * Berkas di `src/` yang **hanya** berjalan di server.
 *
 * `src/api/server.ts` di-bundle terpisah oleh esbuild ke `dist/server.cjs`
 * dan `src/lib/serverBilling.ts` hanya diimpor dinamis darinya — keduanya
 * tidak pernah masuk bundel peramban, jadi boleh membaca `process.env`.
 *
 * **Daftar ini wajib lengkap.** Modul server yang salah klasifikasi di sini
 * akan dibaca sebagai "kode klien yang membaca kunci server" — persis
 * pemeriksaan yang menjaga hal itu. Ketika modul server baru
 * ditambahkan, masukkan ke sini di commit yang sama; kalau tidak, ujinya
 * gagal dan itu memang harus gagal.
 *
 * Aturan main: berkas di sini **tidak boleh** diimpor dari berkas klien
 * mana pun. `./_panel.ts` sudah menarik `panelServer.ts` → `firestoreAdmin.ts`,
 * dan `api/server.ts` mengimpor `_panel` **secara dinamis** supaya tidak ikut
 * ter-bundle ke peramban. Pemeriksa "tidak mengimpor handler serverless" di
 * bawah menjaga sisi itu.
 */
const SERVER_ONLY = [
  'src/api/server.ts',
  'src/lib/serverBilling.ts',
  // Pemuat Firebase Admin bersama — dipakai `serverBilling` + `panelServer`.
  'src/lib/firestoreAdmin.ts',
  // Autentikasi & otorisasi panel: password, peran, token, Firestore Admin.
  'src/lib/panelServer.ts',
];

/*
 * `src/serverless/` adalah handler Vercel — kode server, bukan kode klien.
 *
 * Semula handler-nya tinggal di `api/*.ts` dan tidak ikut dihitung di sini.
 * Setelah dipindah ke `src/serverless/` (agar bisa di-bundle menjadi
 * `api/*.ts` yang mandiri), isinya mulai terbaca sebagai "kode klien yang
 * membaca kunci server" — dan itu salah classify, bukan kebocoran:
 * handler memang dibangun untuk berjalan di server, dan tidak pernah masuk
 * bundel peramban.
 *
 * Yang JADI wajib dijaga justru sebaliknya: tidak boleh ada berkas klien
 * yang mengimpor dari `src/serverless/`. Kalau itu terjadi, `process.env`
 * dan `MIDTRANS_SERVER_KEY`-nya ikut terbawa ke peramban. Pemeriksaan itu
 * ada di bawah.
 */
const semuaServerlessSrc = walk(join(root, 'src/serverless'));
const semuaSrc = walk(join(root, 'src')).filter(f => {
  const rel = f.replace(`${root}/`, '');
  return !SERVER_ONLY.includes(rel) && !rel.startsWith('src/serverless/');
});
/*
 * Artefak build di `api/`.
 *
 * Semula filter ini `.js` — dan karena keluarannya dulu memang `.js`, daftar
 * ini **selalu kosong**: tidak ada satu pun assertion di bawah yang pernah
 * dijalankan. Yang bisa dicek baru berlaku sekarang, karena keluarannya `.ts`.
 *
 * `walk()` hanya mengambil `.ts`/`.tsx`, jadi `api/tsconfig.json` otomatis
 * tidak ikut.
 */
const semuaApi = walk(join(root, 'api')).filter(f => f.endsWith('.ts'));
const kodeServer =
  kode(baca('src/api/server.ts')) +
  kode(baca('src/lib/serverBilling.ts')) +
  semuaServerlessSrc.map(baca).join('\n') +
  (semuaApi.length ? semuaApi.map(baca).join('\n') : '');

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Server Key tidak boleh sampai ke peramban');
const rujukanClient = [];
/**
 * Yang dicari adalah **akses** ke kunci, bukan penyebutan namanya.
 *
 * Menyebut `MIDTRANS_SERVER_KEY` di teks bantuan untuk admin (mis.
 * `<code>MIDTRANS_SERVER_KEY</code>` di form pengaturan) tidak membocorkan
 * apa pun. Yang berbahaya adalah membacanya lewat `process.env` /
 * `import.meta.env` di berkas yang ikut ter-bundle ke peramban.
 */
const POLA_AKSES = [
  /process\.env\.?(VITE_)?MIDTRANS_SERVER_KEY/,
  /process\.env\.?(VITE_)?FIREBASE_SERVICE_ACCOUNT/,
  /process\.env\.?(VITE_)?GOOGLE_APPLICATION_CREDENTIALS/,
  /import\.env\.?(VITE_)?MIDTRANS_SERVER_KEY/,
  /import\.env\.?(VITE_)?FIREBASE_SERVICE_ACCOUNT/,
];
for (const f of [...semuaSrc]) {
  const isi = kode(baca(f));
  for (const pola of POLA_AKSES) {
    if (pola.test(isi)) rujukanClient.push(`${f.replace(root, '')} cocok ${pola}`);
  }
}
cek('tidak ada kode klien yang merujuk kunci server', rujukanClient.length === 0, rujukanClient.join(', '));
cek('kode server boleh membaca kunci (dipisah dari klien)', /process\.env\.MIDTRANS_SERVER_KEY/.test(kodeServer));

const envPath = join(root, existsSync(join(root, '.env')) ? '.env' : '.env.example');
const env = baca(envPath);
cek('VITE_MIDTRANS_SERVER_KEY tidak dikonfigurasi', !/^\s*VITE_MIDTRANS_SERVER_KEY\s*=/m.test(env));
cek('MIDTRANS_SERVER_KEY dideklarasikan untuk server', /^MIDTRANS_SERVER_KEY=/m.test(env));
cek('env contoh menjelaskan bahayanya', /JANGAN PERNAH membuatnya berawalan `VITE_`/.test(baca('.env.example')));

// Kode server boleh membaca `MIDTRANS_SERVER_KEY` — tapi hanya lewat
// `process.env`, tidak pernah lewat `import.meta.env` yang di-bundle Vite.
for (const f of semuaApi) {
  const isi = kode(baca(f));
  cek(`${f.replace(root, '')} tidak pakai import.meta.env`, !/import\.meta\.env/.test(isi));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1b. Handler serverless tidak boleh bisa masuk ke peramban');
/*
 * `src/serverless/` membaca `MIDTRANS_SERVER_KEY` dan friends — itu memang
 * tugasnya. Bahayanya kalau salah satu berkas klien mengimpornya: seluruh
 * handler ikut ter-bundle ke peramban, dan kunci server ikut terbawa.
 */
for (const f of semuaSrc) {
  const isi = kode(baca(f));
  const mengimpor = isi.match(/from\s*['"][^'"]*serverless[^'"]*['"]/g);
  cek(`${f.replace(root, '')} tidak mengimpor handler serverless`, !mengimpor,
    mengimpor?.join(', ') ?? '');
}
cek('ada handler di src/serverless/', semuaServerlessSrc.length > 0,
  `${semuaServerlessSrc.length} berkas`);

// Bukti terkuat: kunci server tidak boleh muncul di bundel peramban. Yang
// boleh hanya penyebutan NAMA variabel di teks bantuan admin.
const assetsDir = join(root, 'dist', 'assets');
let adaBundle = true;
try {
  readdirSync(assetsDir);
} catch {
  adaBundle = false;
}
if (adaBundle) {
  for (const pola of [
    /Mid-server-[A-Za-z0-9]{10}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /"type"\s*:\s*"service_account"/,
  ]) {
    const kena = readdirSync(assetsDir)
      .filter(f => f.endsWith('.js'))
      .filter(f => pola.test(readFileSync(join(assetsDir, f), 'utf8')));
    cek(`bundle peramban bebas ${pola.source.slice(0, 34)}`, kena.length === 0, kena.join(', '));
  }
  // `MIDTRANS_SERVER_KEY` boleh muncul sebagai TEKS yang ditampilkan ke admin
  // (petunjuk cara mengisinya), tapi tidak boleh sebagai akses `process.env`.
  const aksesDiBundle = readdirSync(assetsDir)
    .filter(f => f.endsWith('.js'))
    .filter(f => /process\.env\.?\s*\.?(MIDTRANS_SERVER_KEY|FIREBASE_SERVICE_ACCOUNT)/.test(readFileSync(join(assetsDir, f), 'utf8')));
  cek('bundle peramban tidak membaca kunci server', aksesDiBundle.length === 0, aksesDiBundle.join(', '));
} else {
  console.log('SKIP dist/ belum dibangun.');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Bundle produksi tidak boleh memuat kunci');
// Bundle hanya ada setelah `npm run build`. Kalau belum, dilewati.
const assets = join(root, 'dist', 'assets');
let adaBundleKli = true;
try {
  readdirSync(assets);
} catch {
  adaBundleKli = false;
}
if (adaBundleKli) {
  const bocor = [];
  for (const f of readdirSync(assets)) {
    if (!f.endsWith('.js')) continue;
    const isi = readFileSync(join(assets, f), 'utf8');
    for (const pola of [/Mid-server-[A-Za-z0-9]{10}/, /private_key/i, /"type"\s*:\s*"service_account"/]) {
      if (pola.test(isi)) bocor.push(`${f} cocok ${pola}`);
    }
  }
  cek('tidak ada server key / private key di bundle', bocor.length === 0, bocor.join(', '));
} else {
  console.log('SKIP dist/ belum dibangun — jalankan `npm run build` lebih dulu.');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Nomor telepon tidak boleh hardcoded');
// Pola nomor Indonesia: 62/08 diikuti 8–12 digit. Diekslusikan komentar,
// JSDoc, dan contoh NIP (yang jelas ditandai).
const nomorDitemukan: string[] = [];
for (const f of [...semuaSrc, ...semuaApi]) {
  const isi = kode(baca(f));
  isi.split('\n').forEach((baris: string, i: number) => {
    if (/(0|\+?62)\d{8,14}/.test(baris)) {
      // Izinkan kalau jelas bukan nomor telepon (mis. "18 digit NIP").
      if (/NIP|contoh|padding|epoch|milidetik|timestamp|QRIS|Payload Format/i.test(baris)) return;
      nomorDitemukan.push(`${f.replace(root, '')}:${i + 1} ${baris.trim().slice(0, 70)}`);
    }
  });
}
cek('tidak ada nomor telepon di kode', nomorDitemukan.length === 0, nomorDitemukan.slice(0, 3).join(' | '));

// Nomor WA harus datang dari pengaturan, bukan konstanta.
const modalSrc = kode(baca('src/components/BayarLanggananModal.tsx'));
cek('nomor WA dibaca dari pengaturan', /pengaturan\.nomorWa/.test(modalSrc));
cek('tidak ada nomor WA konstan', !/nomorWa\s*=\s*['"]\d{6,}/.test(modalSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. CORS tidak terbuka');
// Helper CORS pindah ke `src/serverless/_cors.ts` saat handler dipindah ke sana
// supaya bisa di-bundle menjadi `api/*.ts` yang mandiri.
const corsHelper = kode(baca('src/serverless/_cors.ts'));
cek('ada helper CORS terpusat', /export function terapkanCors/.test(corsHelper));
cek('helper memakai allow-list', /ALLOWED_ORIGINS/.test(corsHelper));
cek('helper menolak origin asing', /return false;/.test(corsHelper));
cek('helper menambah header Vary: Origin', /'Vary', 'Origin'/.test(corsHelper));

for (const f of semuaApi) {
  const nama = f.replace(root, '');
  if (nama.endsWith('_cors.ts')) continue;
  const isi = kode(baca(f));
  // `origin || '*'` hanya boleh ada di dalam helper terpusat.
  if (/setHeader\(\s*'Access-Control-Allow-Origin'\s*,\s*['"]\*['"]\s*\)/.test(isi)) {
    cek(`${nama} tidak memakai Allow-Origin: *`, false, 'CORS terbuka');
  } else {
    cek(`${nama} tidak memakai Allow-Origin: *`, true);
  }
  /*
   * `ep.ts` satu-satunya yang **sengaja** tidak memakai helper CORS.
   *
   * Proxy e-Presensi meneruskan `Set-Cookie` sesi hulu. Kalau ia mengirim
   * `Access-Control-Allow-Origin`, cookie itu bisa dibaca lintas origin dan
   * sesi server pusat ikut terbaca.
   *
   * Pengecualian ini bukan lubang: `tools/cek-vercel.mts` mengujinya dua arah
   * lewat `TANPA_CORS_SENGJAJA` — `ep.ts` tidak boleh punya header CORS, dan
   * tidak boleh diam-diam kehilangan pengecualiannya. Yang dijaga di sini
   * hanya kebalikannya: tidak ada handler lain yang boleh luput dari
   * allow-list.
   */
  if (/\/ep\.ts$/.test(nama)) continue;
  cek(`${nama} memakai helper CORS`, /terapkanCors\(/.test(isi),
    'handler tanpa allow-list origin bisa dipanggil siapa saja yang tahu URL-nya');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. IP klien tidak diteruskan ke gateway');
for (const f of ['src/api/server.ts', 'src/serverless/rpc.ts', 'src/serverless/upload.ts']) {
  const isi = kode(baca(f));
  const meneruskan =
    /x-forwarded-for/i.test(isi) || /x-real-ip/i.test(isi) || /CF-Connecting-IP/i.test(isi);
  cek(`${f} tidak meneruskan IP klien ke upstream`, !meneruskan);
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Header upstream tidak diteruskan mentah');
const serverSrc = kode(baca('src/api/server.ts'));
cek('ada getSanitizedHeaders / BASE_HEADERS tetap', /BASE_HEADERS/.test(serverSrc));
/*
 * ⚠️ Yang diperiksa bukan lagi "tidak ada kata `req.headers` di berkas".
 *
 * Bentuk lama terlalu kasar: begitu ada satu tempat yang **membaca** header
 * klien untuk keperluan panel sendiri — yaitu memverifikasi token sesi pada
 * `POST /api/billing/aktivasi` — assertion itu gagal, padahal pembacaan itu
 * justru benar dan tidak ada hubungannya dengan meneruskan header ke gateway.
 *
 * Yang benar-benar dilarang adalah **menyalin** header klien ke permintaan
 * ke server pusat. Dua-duanya diperiksa terpisah di bawah:
 *
 * 1. Tidak ada `req.headers` (atau `req.get`/`req.header`) yang masuk ke
 *    objek `headers` milik panggilan upstream — hanya boleh `BASE_HEADERS`
 *    dan literal, atau pengecualian `Content-Type` milik multipart.
 * 2. Tidak ada penyebaran objek header apa pun (`...req.headers`).
 */
const upstreamHeaders = [...serverSrc.matchAll(/headers:\s*\{([^}]*)\}/g)].map(m => m[1]);
cek('tidak ada req.headers yang masuk ke header upstream',
  upstreamHeaders.every(blok => !/req\.(headers|get|header)\b/.test(blok)),
  `ditemukan pada ${upstreamHeaders.filter(b => /req\.(headers|get|header)\b/.test(b)).length} blok header upstream`);
cek('tidak ada spreading req.headers ke upstream',
  !/\.\.\.\s*req\.headers/.test(serverSrc));
cek('req.headers hanya dipakai untuk memverifikasi token sendiri',
  [...serverSrc.matchAll(/req\.headers([.\[])/g)].length <= 3,
  'pemakaian yang lain perlu dijelaskan dan diuji di sini');
/*
 * Server TIDAK boleh membuat identitas perangkat sendiri.
 *
 * Assertion ini dulu arahnya kebalik: ia menuntut `TECH_MARK` ada di
 * server. Padahal begitu ada UUID yang dibuat server, semua perangkat
 * memakai id yang sama — dan server pusat mengikat sebagian akun ke
 * perangkat pertama yang login. Satu id bersama menghapus makna
 * pengikatan itu: begitu id-nya bocor, siapa pun bisa login dari mana saja.
 *
 * Aplikasi ini dipakai banyak perangkat, jadi identitasnya harus lahir di
 * peramban: satu per akun per peramban (`src/lib/idPerangkat.ts`), lalu
 * diteruskan apa adanya. Yang diperiksa di sini justru ketiadaannya.
 */
cek('proxy tidak membuat identitas perangkat sendiri', !/TECH_MARK/.test(serverSrc),
  'UUID dari server berarti semua perangkat berbagi satu identitas');
cek('imei diteruskan apa adanya, tidak diisi ulang',
  /imei: typeof imeiDiminta === 'string' \? imeiDiminta : ''/.test(serverSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Firestore rules menutup jalur tulis');
const rulesMentah = baca('firestore.rules');
// Rules dibaca tanpa membuang komentar JSDoc di dalam blok: yang
// dibaca adalah aturan `match`/`allow`-nya, bukan penjelasannya.
const rules = rulesMentah.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
cek('rules pakai versi 2', /rules_version = '2'/.test(rulesMentah));
/*
 * ⚠️ `jatim_langganan` dan `jatim_tagihan` sekarang **server-only sepenuhnya**,
 * bukan hanya untuk tulis.
 *
 * Semula keduanya `allow read: if true`, dengan alasan "peramban butuh tahu
 * masa aktif". Tapi aplikasi ini tidak memakai Firebase Authentication, jadi
 * `request.auth` selalu `null` dan `if true` berarti **seluruh koleksi terbuka**.
 *
 * API key-nya bukan rahasia — ada di `VITE_FIREBASE_API_KEY`, yang Vite
 * suntikkan ke bundle. Setelah diambil dari DevTools, satu request REST
 * mengembalikan seluruh isi koleksi tanpa membuka aplikasi sama sekali.
 *
 * Yang bocor: `nip`, `masaAkhir`, `gratis` (siapa yang tidak membayar), dan di
 * `jatim_tagihan` juga `usernameLabel`, `nominal`, serta `buktiUrl`.
 *
 * Sekarang keduanya lewat `POST /api/panel-auth` (`langganan:saya`,
 * `tagihan:saya`, `langganan:daftar`, `tagihan:daftar`), yang memverifikasi
 * token dan mengembalikan hanya dokumen milik pemanggil.
 */
cek(
  'langganan: server-only, baca maupun tulis',
  /match \/jatim_langganan\/\{username\}\s*\{\s*allow read, write: if false;/.test(rules),
  'allow read: if true = siapa pun yang punya API key bisa membaca NIP + masa aktif + status gratis'
);
cek(
  'tagihan: server-only, baca maupun tulis',
  /match \/jatim_tagihan\/\{orderId\}\s*\{\s*allow read, write: if false;/.test(rules),
  'allow read: if true = nama orang + nominal + buktiUrl terbuka untuk semua'
);
cek(
  'tidak ada koleksi entitlement yang boleh dibaca anonim',
  !/match \/jatim_(langganan|tagihan)\/[^{]*\{[^}]*allow read: if true;/.test(rules),
  'aplikasi tidak memakai Firebase Auth, jadi "read: if true" = terbuka untuk semua'
);
cek('billing: hanya server yang boleh tulis', /match \/jatim_pengaturan\/billing[\s\S]{0,140}allow write: if false;/.test(rules));
cek('default menolak semua yang tidak dicakup', /match \/\{document=\*\*\}/.test(rules));

/*
 * Tiga aturan yang **baru**, dan ini yang menutup laporan "saya login user,
 * terus refresh jadi admin".
 *
 * Semuanya `if false` tanpa kondisi: aplikasi ini tidak memakai Firebase
 * Authentication, jadi rules tidak punya cara membedakan admin dari pengguna
 * biasa. Satu-satunya akses yang sah adalah dari server (Admin SDK), yang
 * melewati rules sepenuhnya.
 *
 * |\n * `jatim_pengguna`      | hash password + `role` setiap orang |
 * | `jatim_pengaturan/*`  | `pinHash` admin, password server pusat |
 * | `jatim_tagihan`       | status & masa aktif hanya dari server |
 *
 * Yang terakhir dipisah supaya `billing` — satu-satunya dokumen yang **harus**
 * dibaca peramban — tetap punya allow-list-nya sendiri.
 */
cek(
  'akun panel: server-only, tanpa kecuali',
  /match \/jatim_pengguna\/\{username\}\s*\{\s*allow read, write: if false;/.test(rules),
  'allow read/write: if true = setDoc({role:"admin"}) + refresh'
);
cek(
  'akun panel tidak boleh dibaca klien',
  !/match \/jatim_pengguna\/\{username\}[\s\S]{0,160}if true/.test(rules),
  'baca = seluruh hash password panel bisa dicuri dan dipecah offline'
);
cek(
  'auth + kredensial server: server-only',
  /match \/jatim_pengaturan\/\{docId\}\s*\{\s*allow read, write: if false;/.test(rules),
  'pinHash admin & password server pusat tidak boleh terbaca dari klien'
);
cek(
  'billing tetap boleh dibaca (harga paket harus tampil)',
  /match \/jatim_pengaturan\/billing\s*\{\s*allow read: if true;/.test(rules),
  'menutupnya membuat pengguna tidak bisa melihat harga paket'
);
cek('billing: hanya server yang boleh tulis', /match \/jatim_pengaturan\/billing[\s\S]{0,140}allow write: if false;/.test(rules));
cek('default menolak semua yang tidak dicakup', /match \/\{document=\*\*\}/.test(rules));
cek('batasan tanpa Firebase Auth dijelaskan', /tidak memakai Firebase Authentication/i.test(rulesMentah));
cek('akar bug refresh-jadi-admin dijelaskan di rules', /reload jadi admin/.test(rulesMentah));

/*
 * ⚠️ Rules **tidak bisa** menggantikan pemeriksaan server.
 *
 * `firebase-admin` memanggil Firestore sebagai service account dan melewati
 * seluruh rules. Jadi dua lapis ini saling melengkapi: rules menutup pintu dari
 * luar, kode server memeriksa yang diminta request. Assertion ini menjaga
 * kode server tidak pernah berubah jadi mempercayai `role` dari body/header.
 */
cek(
  'secret hanya dari process.env, tidak pernah import.meta.env',
  /process\.env\.PANEL_SESSION_SECRET/.test(kode(baca('src/lib/panelServer.ts'))) &&
    !/import\.meta\.env/.test(kode(baca('src/lib/panelServer.ts'))),
  'import.meta.env ikut ter-bundle ke peramban — secret bocor ke sana'
);
cek(
  'secret tidak punya nilai bawaan',
  !/PANEL_SESSION_SECRET\s*\|\|\s*['"]/.test(kode(baca('src/lib/panelServer.ts'))),
  'nilai bawaan = rahasia publik, siapa pun bisa menandatangani token admin'
);
cek(
  'passwordHash tidak pernah keluar dari server',
  !/passwordHash/.test(kode(baca('src/serverless/_panel.ts'))),
  'field ini tidak pernah dibutuhkan di sisi klien'
);

/*
 * ⚠️ Operasi langganan TIDAK BOLEH punya versi peramban.
 *
 * `jatim_langganan`, `jatim_tagihan`, dan `jatim_pengaturan/billing` semuanya
 * `write: if false` untuk klien. Jadi fungsi yang memanggil `setDoc`/`updateDoc`
 * pada salah satunya dari peramban **pasti ditolak rules** — bukan "kurang
 * aman", tapi tidak berfungsi sama sekali.
 *
 * Yang pernah ada di `langgananFirestore.ts` persis seperti itu. Kalau ada lagi
 * di sana setelah pemindahan, pemindahannya belum tuntas.
 */
const langgananSrc = kode(baca('src/lib/langgananFirestore.ts'));
const POLA_TULIS = /\bsetDoc\s*\(|\bupdateDoc\s*\(|\baddDoc\s*\(|\bdeleteDoc\s*\(/;
cek(
  'langgananFirestore tidak lagi menulis Firestore sama sekali',
  !POLA_TULIS.test(langgananSrc),
  'pola tulis di sini berarti operasi yang ditolak rules — perlu lewat server'
);
cek(
  'langgananFirestore hanya membaca (load*, map*)',
  !POLA_TULIS.test(langgananSrc)
);
cek(
  'fungsi tulis yang dihapus memang tidak ada lagi',
  !/export async function (catatPembayaran|perpanjangManual|setMasaAkhir|savePengaturanBilling)\b/.test(
    langgananSrc
  ),
  'versi perambannya tidak bisa jalan dan jadi surface yang tidak perlu'
);

/*
 * Delapan operasi tulis tidak hanya hilang — **namanya** sekarang tidak ada di
 * modul baca. Kalau salah satunya masih ada di sini, ada jalur tulis
 * yang tidak akan pernah berhasil dan hanya menghasilkan error yang membingungkan.
 */
const YANG_HARUS_HILANG = [
  'catatPembayaran',
  'perpanjangManual',
  'setMasaAkhir',
  'setGratis',
  'buatTagihan',
  'setStatusTagihan',
  'hapusTagihan',
  'savePengaturanBilling',
];
const masihAda = YANG_HARUS_HILANG.filter(nama =>
  new RegExp(`export (async )?function ${nama}\\b`).test(langgananSrc)
);
cek('tidak ada operasi tulis tersisa di langgananFirestore', masihAda.length === 0,
  masihAda.join(', '));

// Tidak ada operasi tulis di modul peramban lain pun yang menyentuh langganan.
const lainTulis: string[] = [];
for (const f of semuaSrc) {
  if (f.endsWith('lib/langgananFirestore.ts') || f.endsWith('lib/akunFirestore.ts')) continue;
  const isi = kode(baca(f.replace(`${root}/`, '')));
  // Pola yang benar-benar menulis ke koleksi langganan/tagihan/billing.
  if (/doc\([^)]*COLL_(?:LANGGANAN|TAGIHAN)/.test(isi) && /\bsetDoc\s*\(|\bupdateDoc\s*\(/.test(isi)) {
    lainTulis.push(f.replace(`${root}/`, ''));
  }
}
cek('tidak ada modul peramban lain yang menulis ke koleksi langganan', lainTulis.length === 0,
  lainTulis.join(', '));

/*
 * Server harus menyediakan padanannya, dan **memverifikasi admin**.
 *
 * Tanpa pemeriksaan admin di server, mengindahkan operasi ke sana hanya
 * memindahkan masalah: peramban tetap bisa memanggilnya tanpa hak.
 */
const serverBillingSrc = kode(baca('src/lib/serverBilling.ts'));
for (const nama of [
  'perpanjangManualServer',
  'setMasaAkhirServer',
  'setGratisServer',
  'buatTagihanServer',
  'setStatusTagihanServer',
  'hapusTagihanServer',
  'hapusSemuaTagihanServer',
  'simpanBillingServer',
]) {
  cek(`server punya ${nama}`, new RegExp(`export async function ${nama}\\b`).test(serverBillingSrc));
}
cek(
  'fungsi serverBilling menerima token dan memverifikasinya',
  /_token: AdminToken/.test(serverBillingSrc) && /adalahAdminToken/.test(serverBillingSrc),
  'tanpa ini, pemindahan ke server hanya memindahkan masalahnya'
);
cek(
  'hapusSemuaTagihanServer memeriksa hak admin',
  /hapusSemuaTagihanServer[\s\S]*?dindingAdmin\(token\)/.test(serverBillingSrc),
);
cek(
  'Aksi langganan di endpoint memakai helper yang sama',
  /muatBilling\(\)/.test(kode(baca('src/serverless/_panel.ts'))),
  'satu handler, satu cara memeriksa token'
);

const billingSrc = kode(baca('src/lib/serverBilling.ts'));
cek('serverBilling punya perpanjangManualServer', /export async function perpanjangManualServer/.test(billingSrc));
cek('serverBilling punya setMasaAkhirServer', /export async function setMasaAkhirServer/.test(billingSrc));
cek('serverBilling punya simpanBillingServer', /export async function simpanBillingServer/.test(billingSrc));
cek(
  'perpanjangan manual TIDAK menaikkan totalBayar',
  /totalBayar: lama\.totalBayar \?\? 0/.test(billingSrc) &&
    /jumlahBayar: lama\.jumlahBayar \?\? 0/.test(billingSrc),
  'perpanjangan manual bukan pembayaran — naikkan angka ini berarti rekap keuangan bohong'
);
cek(
  'durasi perpanjangan dibatasi (salah ketik 100 tahun)',
  /durasi > 3650/.test(billingSrc),
  'salah ketik seperti ini tidak disadari selama berbulan-bulan'
);
cek(
  'setMasaAkhirServer mem-parse tanggal, bukan menyimpan mentah',
  /waktu\.toISOString\(\)/.test(billingSrc),
  'masaAkhir dibaca di banyak tempat — string yang tidak bisa di-parse jadi NaN diam-diam'
);
cek(
  'username divalidasi (anti path traversal) sebelum jadi kunci dokumen',
  /function usernameValid/.test(billingSrc) && /\!\/\[\\\\\/\]\//.test(billingSrc)
);

/*
 * ⚠️ `buatTagihanServer` adalah **satu-satunya** pengecualian dari `dindingAdmin`.
 *
 * Semula ia memakai dinding itu, dan akibatnya pengguna biasa tidak bisa
 * membayar: legendanya "Akses khusus admin." muncul tepat di halaman pembayaran
 * yang seharusnya milik orang yang belum membayar. Tagihan adalah dokumen milik
 * pemanggil sendiri, jadi syaratnya sesi yang sah — bukan peran admin.
 *
 * Karena begitu, yang tidak boleh hilang adalah tiga pengaman penggantinya:
 * akun dari token, angka dari konfigurasi server, dan batas tagihan menunggu.
 * Semuanya diuji di `cek-panel-auth.ts` bagian 5d lewat HTTP sungguhan; di sini
 * cukup dijaga agar dinding admin tidak diam-diam dikembalikan.
 */
{
  // Potong **hanya** badan `buatTagihanServer` — `setStatusTagihanServer` dan
  // `hapusTagihanServer` setelahnya memang tetap memakai dinding admin, jadi
  // slicing sampai ujung file akan selalu "menemukan" dindingAdmin.
  const mulaiBuat = billingSrc.indexOf('export async function buatTagihanServer');
  const badanBuatTagihan = mulaiBuat === -1
    ? ''
    : billingSrc.slice(mulaiBuat, billingSrc.indexOf('\nexport ', mulaiBuat + 1));
  cek(
    'buatTagihanServer TIDAK memakai dindingAdmin',
    mulaiBuat !== -1 && !/dindingAdmin/.test(badanBuatTagihan),
    'dinding admin di sini = pengguna biasa tidak bisa membayar'
  );
  cek(
    'buatTagihanServer memverifikasi sesi (401), bukan hak peran',
    /akunPemanggil\(token\)/.test(badanBuatTagihan) && /kode: 401/.test(badanBuatTagihan)
  );
  cek(
    'akun tagihan diambil dari token, bukan dari input',
    /const username = pemanggil\.username/.test(badanBuatTagihan)
  );
  cek(
    'harga/durasi/satuan diambil dari konfigurasi paket server',
    /nominal: Math\.round\(terpilih\.harga\)/.test(badanBuatTagihan) &&
      /durasi: terpilih\.durasi/.test(badanBuatTagihan) &&
      /satuan: terpilih\.satuan/.test(badanBuatTagihan),
    'nominal dari klien = aktivasi nanti salah menghitung masa aktif'
  );
  cek(
    'paketId dari klien hanya pemeriksa (409), bukan sumber harga',
    /input\.paketId && input\.paketId !== terpilih\.id/.test(badanBuatTagihan) &&
      /kode: 409/.test(badanBuatTagihan)
  );
  /*
   * Batas tagihan `menunggu` — sekarang **satu**, bukan lima.
   *
   * Semula 429 dengan angka: "Masih ada 5 tagihan yang belum diselesaikan."
   * Pesan itu benar secara fakta, tapi tidak ada yang bisa dilakukan pengguna —
   * `GerbangLangganan` tidak menampilkan daftar tagihan, dan `batal` hanya
   * boleh untuk admin. Jadi 429 itu efektifnya akun terkunci, dan
   * dokumen tagihan menumpuk justru karena tidak ada jalan menyelesaikannya.
   *
   * Sekarang 409 dengan `orderId` tagihan yang ada, supaya peramban bisa
   * **melanjutkan** pembayaran tagihan itu. Dan `batal` bisa dipakai pemilik
   * tagihannya sendiri, jadi salah pilih paket bukan jalan buntu.
   */
  // Konstanta dibaca dari SELURUH file, bukan dari badan `buatTagihanServer`.
  // `BATAS_TAGIHAN_MENUNGGU` dideklarasikan di luar fungsi itu, jadi potongan
  // badan fungsi tidak pernah memuatnya. Pemeriksaan dari `badanBuatTagihan`
  // selalu gagal tanpa memberi tahu apa yang sebenarnya salah.
  cek(
    'satu akun hanya boleh punya satu tagihan menunggu (BATAS = 1)',
    /BATAS_TAGIHAN_MENUNGGU = 1\b/.test(billingSrc),
    'BATAS_TAGIHAN_MENUNGGU di src/lib/serverBilling.ts harus bernilai 1'
  );
  cek(
    'tagihan menunggu ditolak dengan 409, bukan 429',
    /kode: 409/.test(badanBuatTagihan) && !/kode: 429/.test(badanBuatTagihan),
    '429 berarti "coba lagi nanti"; masalahnya tidak sementara dan percobaan ulang tidak akan berhasil'
  );
  cek(
    'penolakan menyertakan orderId tagihan yang ada',
    /orderId: String\(data\.orderId/.test(badanBuatTagihan),
    'tanpa orderId, peramban hanya bisa menampilkan pesan buntu tanpa bisa melanjutkan tagihan itu'
  );

  /*
   * `batal` harus bisa dipakai pemilik tagihannya sendiri.
   *
   * Aturan satu-tagihan tanpa jalan keluar = akun yang salah pilih paket tidak
   * bisa apa-apa sampai admin menghapus tagihannya manual. Jalur keluarnya:
   * pengguna membatalkan, lalu baru boleh membuat tagihan baru.
   */
  const mulaiStatus = billingSrc.indexOf('export async function setStatusTagihanServer');
  const badanStatus = mulaiStatus === -1
    ? ''
    : billingSrc.slice(mulaiStatus, billingSrc.indexOf('\nexport ', mulaiStatus + 1));
  cek(
    'batal boleh dipakai pemilik tagihan (bukan hanya admin)',
    /input\.status === 'batal'/.test(badanStatus) && /akunPemanggil/.test(badanStatus),
    'tanpa ini, tagihan yang salah pilih paket hanya bisa dihapus admin'
  );
  cek(
    'batal hanya untuk tagihan milik pemanggil sendiri',
    /data\.username[\s\S]*?pemanggil\.username/.test(badanStatus),
    'pemeriksaan kepemilikan wajib sebelum status diubah'
  );
  cek(
    'batal hanya untuk tagihan yang masih menunggu',
    /data\.status[\s\S]*?!== 'menunggu'/.test(badanStatus),
    'menanda lunas harus tetap datang dari verifikasi pembayaran, bukan dari klik pengguna'
  );
  cek(
    'tagihan milik orang lain dijawab 404, bukan 403',
    /kode: 404/.test(badanStatus),
    '404 membuat "tidak ada" dan "bukan milikmu" tidak bisa dibedakan, jadi orderId tak bisa dipetakan'
  );
  /*
   * `lunas`/`menunggu` harus tetap melewati `dindingAdmin()`.
   *
   * Bentuknya: cabang `batal` lebih dulu dan **keluar duluan** (`return`), jadi
   * kode setelahnya hanya menjangkau `lunas`/`menunggu`. Yang diperiksa: pada
   * jalur itu, `dindingAdmin()` ada DAN hasilnya dipakai untuk menolak.
   *
   * Regex lama (`!…dindingAdmin…return { ok: true`) terlalu longgar: ia bisa
   * ia bisa lolos karena `return { ok: true }` milik cabang `batal` yang
   * muncul lebih dulu di teks.
   */
  /*
   * Dibandingkan dengan **posisi**, bukan regex per-bagian.
   *
   * Cabang `batal` lebih dulu dan keluar lewat `return`. Jadi kalau
   * pemeriksaan `dindingAdmin` muncul **sesudah** `return { ok: true }` milik
   * cabang itu, jalur `lunas`/`menunggu` pasti melewatinya — tanpa perlu
   * menebak bentuk regex-nya. Ini juga langsung menangkap regresi yang paling
   * berbahaya: `batal` tanpa `return`, yang akan membuat kode status lain ikut
   * terproses.
   */
  const posBatalMasuk = badanStatus.indexOf("input.status === 'batal'");
  const posBatalKeluar = badanStatus.indexOf('return { ok: true', posBatalMasuk);
  const posDindingAdmin = badanStatus.indexOf('dindingAdmin(token)');
  cek(
    'cabang batal keluar duluan (tidak bisa jatuh ke jalur admin)',
    posBatalMasuk !== -1 && posBatalKeluar > posBatalMasuk,
    `batal-masuk=${posBatalMasuk} batal-keluar=${posBatalKeluar} — tanpa return, kode status lain ikut dijalankan`
  );
  cek(
    'lunas/menunggu tetap melewati dindingAdmin',
    posDindingAdmin > posBatalKeluar && /dindingAdmin\(token\)/.test(badanStatus) && /kode: 403/.test(badanStatus),
    `dindingAdmin=${posDindingAdmin} (harus setelah batal keluar=${posBatalKeluar}) — pengguna biasa tidak boleh menandai lunas`
  );
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 9. Bundel server tidak boleh memuat kode khusus peramban');
/*
 * `serverBilling.ts` memanggil `tambahDurasi()` dan `normalisasiDaftarPaket()`.
 * Semula fungsi itu tinggal di `langganan.ts`, yang mengimpor SDK Firebase
 * klien — jadi mengimpornya dari sisi server menarik `src/lib/firebase.ts`
 * ke dalam bundel CJS.
 *
 * Modul itu membaca konfigurasinya dari `import.meta.env`, yang kosong di
 * bundel CJS. Hasilnya semua kunci dianggap hilang dan modul mencetak
 *
 *     [firebase] Konfigurasi belum lengkap (...). Mode demo aktif.
 *
 * di layar Admin **setiap kali server dinyalakan** — padahal server memakai
 * Admin SDK dan tidak butuh konfigurasi klien sama sekali.
 *
 * Pemeriksa ini tidak hanya melihat string di dalam bundel: dia menjalankan
 * esbuild dengan metafile, lalu memeriksa modul peramban mana saja yang
 * ikut ter-bawa. Dicek dari metafile, bukan dari teks, supaya berkas yang
 * kebetulan tidak menyalin string peringatan pun tetap terdeteksi.
 */
const { build } = await import('esbuild');
let ikutBundel: string[] = [];
try {
  const hasil = await build({
    entryPoints: [join(root, 'src/api/server.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    write: false, // hanya mau metafile-nya, tidak perlu menulis berkas
    metafile: true,
    outfile: join(root, 'dist/server.cjs'),
    logLevel: 'silent',
  });
  ikutBundel = Object.keys(hasil.metafile.inputs);
  cek('esbuild bisa membundel server.ts', true);
} catch (err) {
  cek('esbuild bisa membundel server.ts', false, String((err as Error)?.message ?? err).slice(0, 120));
}
cek(
  'src/lib/firebase.ts tidak ikut ter-bundle di server',
  !ikutBundel.some(f => f.endsWith('lib/firebase.ts')),
  ikutBundel.filter(f => f.endsWith('lib/firebase.ts')).join(', ')
);
cek(
  'src/lib/langganan.ts tidak ikut ter-bundle di server',
  !ikutBundel.some(f => f.endsWith('lib/langganan.ts')),
  'fungsi murni harus diambil dari durasi.ts'
);
cek('src/lib/durasi.ts yang dipakai server', ikutBundel.some(f => f.endsWith('lib/durasi.ts')));
/*
 * Modul yang **wajib** ikut ter-bundle di server — arahnya berlawanan dengan
 * pemeriksaan di atas.
 *
 * Alasannya: `src/api/server.ts` mengimpor `../serverless/_panel` secara
 * **dinamis**. Kalau nama jalannya berubah atau berkasnya dihapus, TypeScript
 * tetap lulus (dan `esbuild` pun bisa lulus, karena `import()` dinamis tidak
 * selalu ikut error), tapi `/api/panel-auth` akan menjawab 500 saat dipanggil —
 * artinya tidak ada yang bisa login, dan penyebabnya tidak muncul di mana pun.
 *
 * Modul browser yang tidak boleh ikut tetap diperiksa seperti sebelumnya.
 */
const WAJIB_SERVER = [
  'lib/panelServer.ts',
  'lib/firestoreAdmin.ts',
  'lib/pin.ts',
  'serverless/_panel.ts',
];
for (const f of WAJIB_SERVER) {
  cek(
    `${f} ikut ter-bundle di server`,
    ikutBundel.some(x => x.endsWith(f)),
    'kalau hilang, /api/panel-auth akan 500 dan tidak ada yang bisa login'
  );
}

/*
 * `panelServer` menarik `userManager` (tipe & izin) dan `pin` (bcrypt) — keduanya
 * aman, tanpa konfigurasi. Tapi modul-modul di bawah menarik `import.meta.env`
 * dan harus tetap di luar bundel CJS, tempat kutipan itu tidak ada.
 */
const PERAMBAN = [
  'lib/firebase.ts',
  'lib/cryptoJS.ts',
  'lib/akunFirestore.ts',
  'lib/sessionManager.ts',
  'components/LoginScreen.tsx',
  'context/AppContext.tsx',
];
for (const f of PERAMBAN) {
  cek(`${f} tidak ikut ter-bundle di server`, !ikutBundel.some(x => x.endsWith(f)));
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
