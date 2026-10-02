/**
 * Fungsi Vercel harus mandiri — tanpa impor antar-berkas.
 *
 * ## Bug yang menutupi modul ini
 *
 * Log Vercel:
 *
 *     [info] Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *       '/var/task/src/lib/presensiContract' imported from /var/task/api/rpc.js
 *         at finalizeResolution (node:internal/modules/esm/resolve:281:11)
 *     [info] Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *       '/var/task/api/_cors' imported from /var/task/api/health.js
 *
 * Dua-duanya extensionless, dan keduanya mustahil di-resolve:
 *
 * 1. **Vercel tidak meng-bundle.** Ia hanya mengubah `.ts` → `.js` dan
 *    membiarkan `import` relatif apa adanya. Path `/var/task/api/rpc.js`
 *    menunjukkan layout builder yang menyalin apa adanya.
 * 2. **Node ESM tidak pernah bisa me-resolve impor relatif tanpa ekstensi.**
 *    Bukan soal berkas ada atau tidak — mekanismenya memang begitu.
 * 3. **`api/_cors.ts` tidak pernah dikompilasi.** Berkas berawalan `_` bukan
 *    function, jadi tidak menjadi `.js` — padahal semua handler mengimpornya.
 *
 * Log production menunjukkan bundle CommonJS `.js` dijalankan dalam scope
 * ESM root, sehingga `module` tidak tersedia. Hasil build sekarang harus ESM
 * dan mengikuti `package.json` root.
 *
 * Hasilnya 500 `FUNCTION_INVOCATION_FAILED` untuk **seluruh** endpoint —
 * build hijau, log build bersih, tidak satu handler sempat jalan.
 *
 * ## Yang dijaga di sini
 *
 * 1. `api/` hanya berisi `.js` hasil build, tidak ada `.ts` yang perlu
 *    dikompilasi Vercel.
 * 2. Tidak ada `require`/`import` relatif di hasil build — semua ter-inline.
 * 3. `require` ke `node_modules` boleh, karena paket ikut ter-deploy.
 * 4. Sumber handler ada di `src/serverless/`, dan artefak build selalu
 *    lebih baru dari sumbernya.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ' — ' + detail : ''}`);
};

const SUMBER = join(root, 'src/serverless');
const API = join(root, 'api');

console.log('=== 1. api/ hanya berisi .js hasil build');
const isiApi = readdirSync(API);
const tsDiApi = isiApi.filter(f => f.endsWith('.ts'));
cek('tidak ada .ts di api/', tsDiApi.length === 0, tsDiApi.join(', ') || '— kalau ada, Vercel akan mengompilasinya tanpa membundle dan itu penyebab FUNCTION_INVOCATION_FAILED');
cek('tidak ada .mjs / .mts di api/',
  isiApi.filter(f => f.endsWith('.mjs') || f.endsWith('.mts')).length === 0);
cek('root package.json menetapkan ESM', JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).type === 'module');
cek('api/ mengikuti scope root tanpa package override', !existsSync(join(API, 'package.json')));
const jsDiApi = isiApi.filter(f => f.endsWith('.js')).sort();
cek('ada .js hasil build', jsDiApi.length > 0, `${jsDiApi.length} berkas`);

console.log('\n=== 2. Sumber handler ada di src/serverless/');
const sumberAda = readdirSync(SUMBER).filter(f => f.endsWith('.ts') && !f.startsWith('_')).sort();
cek('src/serverless/ punya sumber handler', sumberAda.length > 0, sumberAda.join(', '));
cek('jumlah sumber = jumlah hasil build', sumberAda.length === jsDiApi.length,
  `${sumberAda.length} sumber vs ${jsDiApi.length} hasil`);
for (const f of sumberAda) {
  cek(`api/${f.replace(/\.ts$/, '.js')} ada`, existsSync(join(API, f.replace(/\.ts$/, '.js'))));
}

console.log('\n=== 3. Hasil build TIDAK boleh mengimpor berkas proyek lain');
/*
 * Inilah yang menggagalkan di Vercel. Kalau masih ada `require("./x")` atau
 * `from "../src/..."` di output, function tidak akan start.
 *
 * `require` ke paket npm (`firebase-admin`, `crypto`, `firebase/firestore`)
 * TIDAK dihitung salah: paket itu ikut ter-deploy ke dalam function.
 */
for (const f of jsDiApi) {
  const isi = readFileSync(join(API, f), 'utf8');
  const relatif = [
    ...new Set([
      ...(isi.match(/require\(["'](\.\.?\/[^"']+)["']\)/g) ?? []),
      ...(isi.match(/from\s*["'](\.\.?\/[^"']+)["']/g) ?? []),
      ...(isi.match(/import\(["'](\.\.?\/[^"']+)["']\)/g) ?? []),
    ]),
  ];
  cek(`api/${f} mandiri (tanpa impor relatif)`, relatif.length === 0, relatif.join(', '));
}

console.log('\n=== 4. Hasil build memakai ESM sesuai scope root');
for (const f of jsDiApi) {
  const isi = readFileSync(join(API, f), 'utf8');
  cek(`api/${f} tidak memakai module.exports`, !/\bmodule\.exports\b/.test(isi));
  cek(`api/${f} punya default export ESM`, /export\s*\{[^}]*default[^}]*\}|export\s+default/.test(isi));
  cek(`api/${f} diberi banner "hasil build"`, /BERKAS HASIL BUILD/.test(isi),
    'tanpa banner, orang akan mengedit artefak dan perubahannya hilang saat build berikutnya');
}

console.log('\n=== 5. Artefak build selalu lebih baru dari sumbernya');
/*
 * Kalau `api/*.js` lebih tua dari `src/serverless/*.ts`, hasil build berisi
 * kode lama — persis skenario "sudah diperbaiki tapi masih error", karena
 * yang ter-deploy adalah artefak basi.
 */
for (const f of sumberAda) {
  const hasil = join(API, f.replace(/\.ts$/, '.js'));
  if (!existsSync(hasil)) continue;
  const tSumber = statSync(join(SUMBER, f)).mtimeMs;
  const tHasil = statSync(hasil).mtimeMs;
  cek(`${f.replace(/\.ts$/, '.js')} tidak lebih tua dari ${f}`, tHasil >= tSumber,
    tHasil < tSumber ? 'jalankan `npm run build:api`' : '');
}

console.log('\n=== 6. Script build memanggil build:api');
/*
 * Vercel menjalankan `npm run build`. Kalau langkah `build:api` tidak ada di
 * sana, `api/*.js` tidak pernah dibangun di lingkungan Vercel — dan kalau
 * `api/` kosong, semua endpoint 404.
 */
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
cek('script build:api ada', Boolean(pkg.scripts?.['build:api']), pkg.scripts?.['build:api'] ?? '(tidak ada)');
cek('script build memanggil build:api', /build:api/.test(pkg.scripts?.build ?? ''), pkg.scripts?.build ?? '');
cek('build:api memanggil src/serverless/build.mjs', /serverless\/build\.mjs/.test(pkg.scripts?.['build:api'] ?? ''));

console.log('\n=== 7. Bundling bisa dijalankan ulang dan hasilnya identik');
/*
 * Kalau `npm run build:api` tidak idempoten, setiap build menghasilkan
 * isi berbeda sehingga tidak ada yang bisa dibandingkan. Yang diuji di sini
 * hanya sifat idempotennya: build kedua tetap menghasilkan semua berkas,
 * dan tidak ada berkas yang rusak.
 *
 * ⚠️ Isi `api/` **sebelum** build disimpan lebih dulu, karena §8 harus memeriksa
 * artefak yang benar-benar ter-commit — bukan hasil build yang baru saja dibuat
 * di sini. Kalau urutan dibalik, §8 selalu hijau apa pun isi artefaknya.
 */
const artefakSebelumBuild = Object.fromEntries(
  jsDiApi.map(f => [f, readFileSync(join(API, f), 'utf8')])
);
try {
  const sebelum = jsDiApi.map(f => artefakSebelumBuild[f].length);
  execFileSync('npm', ['run', '--silent', 'build:api'], { cwd: root, stdio: 'pipe' });
  const sesudah = readdirSync(API).filter(f => f.endsWith('.js')).sort().map(f => readFileSync(join(API, f), 'utf8').length);
  cek('build kedua menghasilkan jumlah berkas yang sama', sesudah.length === sebelum.length,
    `${sebelum.length} -> ${sesudah.length}`);
  cek('build kedua menghasilkan ukuran yang sama', JSON.stringify(sesudah) === JSON.stringify(sebelum),
    'ukuran berubah = artefak ter-commit tidak sama dengan hasil build → jalankan `npm run build:api`');
} catch (err) {
  cek('build:api bisa dijalankan ulang', false, String(err?.message).slice(0, 100));
}

console.log('\n=== 8. Artefak TERBANGUN mengulang perbaikan yang sudah ada di sumber');
/*
 * ⚠️ Bagian ini menjawab bug yang **tidak** bisa ditangkap pemeriksaan lain.
 *
 * `api/*.js` adalah hasil build yang ikut ter-commit, dan Vercel tidak menjalankan
 * `build:api`. Jadi perbaikannya bisa sudah benar di `src/lib/serverBilling.ts`
 * dan di `src/serverless/_panel.ts` — semua uji sumber hijau, semua uji kode
 * klien hijau — sementara yang benar-benar melayani permintaan di production
 * tetap bundle lama.
 *
 * Gejalanya persis yang dilaporkan: pengguna biasa menekan tombol bayar, muncul
 * "Akses khusus admin." Sumbernya sudah diperbaiki, dan bugnya tetap ada.
 *
 * Uji mtime di §5 tidak cukup: berkas bisa lebih baru tanpa isinya ikut baru
 * (`git checkout`, `touch`, salinan dari mesin lain). Yang diuji di sini
 * **isi** artefak yang ter-commit, bukan waktunya dan bukan hasil build baru.
 */
{
  const isi = artefakSebelumBuild['panel-auth.js'];
  if (isi === undefined) {
    cek('api/panel-auth.js ada', false, 'jalankan `npm run build:api`');
  } else {
    /*
     * Helper di-bundle apa adanya (tanpa minify), jadi nama fungsinya masih
     * terbaca. Potong **hanya** badan fungsi itu — `setStatusTagihanServer` dan
     * `hapusTagihanServer` sesudahnya memang tetap memakai dinding admin, jadi
     * slicing sampai ujung berkas akan selalu "menemukan" `dindingAdmin`.
     */
    const potong = (mulai, akhir) => {
      const a = isi.indexOf(mulai);
      if (a === -1) return '';
      const b = isi.indexOf(akhir, a + mulai.length);
      return isi.slice(a, b === -1 ? isi.length : b);
    };
    /*
     * `esbuild` menulis ulang tanda kutip menjadi `"` saat bundling, jadi
     * pencarian `case 'tagihan:buat'` tidak akan pernah cocok di artefak.
     */
    const potongKasus = (aksi, aksiBerikut) =>
      potong(`case "tagihan:${aksi}"`, `case "${aksiBerikut}"`);
    const buatTagihan = potong('async function buatTagihanServer', '\nasync function ');
    cek('api/panel-auth.js memuat buatTagihanServer', buatTagihan.length > 0,
      'jalankan `npm run build:api`');
    cek(
      'bundle: buatTagihanServer tidak memakai dinding admin',
      buatTagihan.length > 0 && !/dindingAdmin|Akses khusus admin/.test(buatTagihan),
      'bundle production masih menolak user biasa = "Akses khusus admin." saat bayar'
    );
    cek(
      'bundle: buatTagihanServer memverifikasi sesi (401), bukan hak peran',
      buatTagihan.length > 0 && /kode: 401/.test(buatTagihan) && /pemanggil/.test(buatTagihan)
    );
    cek(
      'bundle: harga/durasi/satuan diambil dari konfigurasi paket server',
      buatTagihan.length > 0 && /nominal: Math\.round\(/.test(buatTagihan) &&
        /durasi: terpilih\.durasi/.test(buatTagihan) &&
        /satuan: terpilih\.satuan/.test(buatTagihan),
      'kalau angka klien ikut ter-inline di bundle, harga bisa dipalsukan'
    );
    /*
     * Kasus `tagihan:buat` di router harus meneruskan **empat** field saja. Kalau
     * `username` ikut diteruskan, akun tagihan bisa diganti — dan yang menguji
     * bukan sumbernya, tapi bundle yang benar-benar melayani permintaan.
     */
    const kasusBuat = potongKasus('buat', 'tagihan:status');
    cek('bundle: kasus tagihan:buat ada', kasusBuat.length > 0, 'jalankan `npm run build:api`');
    cek(
      'bundle: tagihan:buat tidak meneruskan username/nominal/durasi/satuan',
      kasusBuat.length > 0 &&
        !/username: str\(body\.username\)/.test(kasusBuat) &&
        !/nominal:/.test(kasusBuat) &&
        !/durasi:/.test(kasusBuat) &&
        !/satuan:/.test(kasusBuat)
    );
    cek(
      'bundle: tagihan:buat meneruskan usernameLabel + paketId',
      kasusBuat.length > 0 && /usernameLabel/.test(kasusBuat) && /paketId/.test(kasusBuat)
    );
  }
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
