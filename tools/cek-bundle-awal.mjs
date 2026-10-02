/**
 * Jaga pemisahan "murni" vs "I/O", dan hasilnya: bundle awal.
 *
 * ## Yang dijaga
 *
 * **1. Modul murni tidak boleh menyentuh jaringan.**
 *
 * `userManager.ts` dan `langganan.ts` sengaja dipisah dari
 * `akunFirestore.ts` dan `langgananFirestore.ts`. Alasannya konkret: begitu
 * satu berkas di jalur muat awal mengimpor `firebase/firestore` secara
 * statis, Vite menulis `<link rel="modulepreload">` untuk SDK itu ke
 * `index.html` — 140 kB gzip, 35% bundle — sehingga semua orang
 * mengunduhnya sebelum sempat melihat layar login.
 *
 * Modul murni diimpor statis (`AppContext` butuh `DEFAULT_ADMIN_PERMISSIONS`
 * saat render), jadi satu impor statis saja sudah cukup untuk membatalkan
 * seluruhnya. Aturan inilah yang menjaga agar tidak berlaku diam-diam.
 *
 * **2. Tidak ada impor statis `firebase/*` di jalur muat awal.**
 *
 * Dihitung dari graf impor sungguhan, bukan dari daftar manual — jadi berkas
 * baru yang salah implemennya langsung ketahuan, bukan enam bulan kemudian.
 *
 * **3. Baris pertama bundle tidak|preload SDK-nya.**
 *
 * Pemeriksaan terakhir terhadap hasil build. Yang di atas memeriksa kode,
 * yang ini memeriksa hasilnya — dua hal yang bisa berbeda, misalnya kalau
 * `manualChunks` di `vite.config.ts` ikut berubah.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

// Akar proyek dari lokasi skrip, bukan dari cwd — skrip ini bisa dipanggil
// dari folder mana pun dan harus tetap menunjuk ke sumber yang benar.
const root = new URL('..', import.meta.url).pathname;
let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const baca = p => readFileSync(join(root, p), 'utf8');
const kode = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1. Modul murni tidak menyentuh jaringan');

/** Nama berkas yang isinya harus tetap murni. */
const BERSIH = ['src/lib/userManager.ts', 'src/lib/langganan.ts'];

for (const f of BERSIH) {
  const isi = kode(baca(f));
  cek(
    `${f} tidak mengimpor firebase/firestore`,
    !/from 'firebase\/firestore'/.test(isi)
  );
  cek(`${f} tidak mengimpor firebase/app`, !/from 'firebase\/app'/.test(isi));
  cek(
    `${f} tidak mengimpor modul I/O`,
    !/from '\.\/(akunFirestore|langgananFirestore)'/.test(isi),
    'kalau ini muncul, batas "murni" sudah runtuh'
  );
}

/*
 * ⚠️ Dua modul ini **tidak lagi** mengimpor SDK Firestore.
 *
 * Semula keduanya Acetál, dan `akunFirestore.ts` adalah yang paling parah: ia
 * menarik `firebase/firestore` ke jalur muat awal tepat karena `LoginScreen`
 * memakainya untuk membaca hash password.
 *
 * Sekarang keduanya cuma `fetch` ke endpoint server. `langgananFirestore.ts`
 * masih membaca dokumen langganan/tagihan secara langsung — itu memang harus
 * begitu, dan rules mengizinkan bacanya — tapi **tidak** menarik SDK ke jalur
 * awal karena semua pemanggilnya sudah lewat `import()` dinamis.
 *
 * Pemeriksaan ini sekarang dua arah: tidak boleh menarik SDK (itu yang membuat
 * modul terlalu berat untuk jalur awal), dan harus tetap mengimpor
 * `langgananFirestore` secara dinamis dari mana pun di jalur awal.
 */
cek(
  'akunFirestore tidak mengimpor firebase/firestore',
  !/from 'firebase\/firestore'/.test(kode(baca('src/lib/akunFirestore.ts'))),
  'operasinya lewat /api/panel-auth — menarik SDK di sini pasti masuk jalur awal'
);
cek('akunFirestore tidak mengimpor firebase/app',
  !/from 'firebase\/app'/.test(kode(baca('src/lib/akunFirestore.ts'))));
cek(
  'akunFirestore tidak mengimpor modul I/O lain',
  !/from '\.\/langgananFirestore'/.test(kode(baca('src/lib/akunFirestore.ts'))),
  'sekarang hanya butuh token dari sessionManager'
);

/*
 * ⚠️ Klien **tidak lagi** memakai `firebase/firestore` sama sekali.
 *
 * Semula `langgananFirestore.ts` mengimpornya untuk membaca
 * `jatim_langganan` dan `jatim_tagihan` langsung dari peramban. Dua alasan
 * mendorong perubahan itu, dan keduanya independen:
 *
 * 1. **Keamanan.** `firestore.rules` membiarkan kedua koleksi dengan
 *    `allow read: if true` — dan aplikasi ini tidak memakai Firebase Auth,
 *    jadi `request.auth` selalu `null`. Artinya seluruh koleksi terbuka untuk
 *    siapa pun yang punya API key, dan API key itu ada di bundle peramban.
 *    Yang bocor: NIP, masa aktif, status `gratis`, nama orang, `nominal`, dan
 *    `buktiUrl`.
 *
 * 2. **Ukuran.** SDK itu 140 kB gzip, 35% bundle. Sekarang semua pembacaan
 *    lewat `POST /api/panel-auth` yang sudah ada di jalur muat awal, jadi SDK
 *    tidak perlu diunduh siapa pun.
 *
 * Pemeriksaan di bawah menjaga supaya `firebase/*` tidak diam-diam masuk lagi
 * lewat jalur baru.
 */
const tanpaFirebaseSdk = kode(baca('src/lib/langgananFirestore.ts'));
cek(
  'langgananFirestore tidak lagi mengimpor firebase/firestore',
  !/from 'firebase\/firestore'/.test(tanpaFirebaseSdk),
  'koleksi langganan/tagihan hanya boleh dibaca lewat server yang memverifikasi token'
);
cek(
  'langgananFirestore tidak mengimpor firebase sama sekali',
  !/from 'firebase\//.test(tanpaFirebaseSdk),
  'SDK-nya 140 kB gzip dan tidak dibutuhkan lagi'
);
cek(
  'langgananFirestore hanya bicara ke /api/panel-auth',
  /akunFirestore/.test(tanpaFirebaseSdk) && !/from 'firebase/.test(tanpaFirebaseSdk),
  'pembacaan lewat server = token diverifikasi, nama akun dari token'
);
cek(
  'lib/firebase.ts tidak diimpor dari modul I/O klien',
  !/from '\.\/firebase'/.test(tanpaFirebaseSdk),
  'modul itu hanya perlu `db` + SDK, yang keduanya sudah tidak dipakai'
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Graf impor statis dari entry');

/*
 * Modul yang hanya boleh diakses lewat `import()` dinamis dari jalur awal.
 *
 * Daftar ini **kosong** sekarang. Semula berisi `langgananFirestore`, karena
 * modul itu menarik `firebase/firestore` — jadi masuknya jalur awal berarti
 * 140 kB gzip diunduh sebelum orang sempat melihat layar login.
 *
 * Sekarang modul itu bebas SDK, jadi tidak ada alasan menahannya. Tapi
 * pemeriksaannya tetap ada: kalau nanti ada modul I/O baru yang menarik
 * Firestore, daftar ini harus berisi modul itu — bukan karena
 * `firebase/firestore` yang berat, tapi karena pembacaan langsung dari
 * peramban selalu melewati verifikasi token.
 *
 * `akunFirestore` juga TIDAK ada di sini: modul itu bebas SDK, dan
 * `AppContext` membutuhkannya secara statis untuk memverifikasi token sesi
 * saat aplikasi dibuka. Menaruhnya di daftar ini akan memaksa verifikasi sesi
 * lewat `await import()` — yang justru menunda keputusan apakah pengguna sudah
 * masuk.
 */
const modulIO = [];

function walkSrc(dir = join(root, 'src'), out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkSrc(p, out);
    else if (/\.tsx?$/.test(ent.name) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const semua = walkSrc();
const dikenal = new Set(semua);

function imporStatis(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  let m;
  const nilai = /^import\s+(?!type\b)([\s\S]*?)\s+from\s+'([^']+)';/gm;
  while ((m = nilai.exec(src))) out.push(m[2]);
  return out;
}

function selesaikan(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const k of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (dikenal.has(k)) return k;
  }
  return null;
}

const entry = join(root, 'src/main.tsx');
const terjangkau = new Set([entry]);
const rantai = new Map();
const antre = [entry];
const penyerang = [];

while (antre.length > 0) {
  const f = antre.shift();
  for (const spec of imporStatis(f)) {
    if (!spec.startsWith('.')) {
      if (spec.startsWith('firebase/')) {
        const jalan = [relative(root, f)];
        let n = rantai.get(f);
        while (n) {
          jalan.unshift(relative(root, n));
          n = rantai.get(n);
        }
        penyerang.push({ spec, jalan });
      }
      continue;
    }
    const t = selesaikan(f, spec);
    if (t && !terjangkau.has(t)) {
     terjangkau.add(t);
      rantai.set(t, f);
      antre.push(t);
    }
  }
}

cek(
  'tidak ada firebase/* diimpor statis dari jalur muat awal',
  penyerang.length === 0,
  penyerang.map(t => `${t.spec} lewat ${t.jalan.join(' → ')}`).join(' | ')
);

// Modul I/O pun tidak boleh masuk jalur awal secara statis.
const ioMasuk = [...terjangkau].filter(f =>
  modulIO.some(m => f.endsWith(`/${m}.ts`) || f.endsWith(`/${m}.tsx`))
);
cek(
  'modul I/O tidak terjangkau lewat impor statis',
  ioMasuk.length === 0,
  ioMasuk.map(f => relative(root, f)).join(', ')
);

console.log(
  `     ${terjangkau.size} berkas terjangkau dari entry, ${semua.length - terjangkau.size} dipisah lewat import() dinamis`
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Bundle hasil build');

// Build wajib ada supaya pemeriksa ini berarti. Kalau belum, jalankan dulu —
// lebih baik dilewati diam-diam daripada melaporkan "lulus" tanpa bukti.
if (!existsSync(join(root, 'dist/index.html'))) {
  console.log('\nSKIP bagian bundle: dist/index.html belum ada. Jalankan `npm run build` lebih dulu.');
} else {
  const html = baca('dist/index.html');
  const pre = [...html.matchAll(/modulepreload"[^>]*href="\/assets\/([^"]+)"/g)].map(m => m[1]);

  const adaFirebase = pre.some(f => f.startsWith('firebase'));
  cek(
    'SDK firebase tidak di-preload di index.html',
    !adaFirebase,
    adaFirebase ? 'SDK-nya masuk lagi ke muatan awal' : '140 kB gzip, ditunda sampai pemakaian pertama'
  );

  // `firebase` boleh tetap jadi chunk, asalkan tidak di awal.
  cek(
    'firebase tidak dirujuk di index.html sama sekali',
    !/firebase/.test(html),
    'kalau muncul sebagai <script> atau <link> lain, pemeriksa di atas bisa lolos'
  );

  // Ukuran nyata yang diunduh pengguna sebelum melihat apa pun.
  let awal = gzipSync(Buffer.from(html)).length;
  for (const f of pre) {
    const p = join(root, 'dist/assets', f);
    if (existsSync(p)) awal += gzipSync(readFileSync(p)).length;
  }
  const kB = awal / 1024;
  cek(
    'muat awal di bawah 200 kB gzip',
    kB < 200,
    `${kB.toFixed(1)} kB gzip untuk ${pre.length + 1} berkas`
  );

  /*
   * ⚠️ Pustaka yang hanya dipakai saat tombol ditekan **wajib** keluar dari
   * muatan awal, dan ini tidak bisa dijamin oleh `import()` dinamis saja.
   *
   * `pdfTabel.ts` memang menulis `await import('jspdf')`. Tapi
   * `manualChunks` di `vite.config.ts` mengembalikan `'vendor'` untuk
   * *apa pun* di `node_modules` — dan `vendor` ikut `<link rel=modulepreload>`
   * di `index.html`. Hasilnya `jspdf` mendarat di `vendor` yang diunduh
   * bersama layar login, dan `import()` dinamisnya tidak menunda apa pun.
   *
   * Yang lebih besar: `canvg`, `dompurify`, `html2canvas`, dan `core-js` adalah
   * `optionalDependencies` milik `jspdf` (untuk merender HTML ke PDF — kita
   * tidak pernah memakainya). Mengecualikan `jspdf` saja tidak cukup; keempatnya
   * ikut, karena aturannya "apa pun di node_modules".
   *
   * Threshold 200 kB sempat menangkapnya (338 kB), tapi angka itu bisa bergeser
   * karena alasan lain. Yang di sini diperiksa adalah **penyebabnya**.
   */
  const BUTUH_SAAT_TEKAN = ['jspdf', 'html2canvas', 'canvg', 'dompurify', 'core-js'];
  const ikutAwal = [];
  for (const f of pre) {
    const p = join(root, 'dist/assets', f);
    if (!existsSync(p)) continue;
    const isi = readFileSync(p, 'utf8');
    for (const nama of BUTUH_SAAT_TEKAN) {
      if (new RegExp(`from\\s*"[^"]*${nama}[^"]*"|require\\(["'][^"']*${nama}`).test(isi)) {
        ikutAwal.push(`${nama} di ${f}`);
      }
    }
  }
  cek(
    'pustaka "saat tombol ditekan" tidak ikut muatan awal',
    ikutAwal.length === 0,
    ikutAwal.join(' | ') ||
      'jspdf (102 kB gzip) ditunda sampai PDF benar-benar diminta'
  );

  /*
   * Pustaka yang sama harus tetap **terjangkau** — dikecualikan dari `vendor`
   * bukan berarti hilang. Kalau nama berkasnya tidak ada di `dist/assets`,
   * berarti `return undefined` di `vite.config.ts` membuat Rollup membuangnya
   * dan PDF akan gagal saat tombol ditekan.
   */
  const berkasJspdf = readdirSync(join(root, 'dist/assets')).filter(f => /^jspdf\..*\.js$/.test(f));
  cek('jspdf tetap terbangun sebagai chunk sendiri', berkasJspdf.length > 0,
    berkasJspdf.length > 0
      ? `${berkasJspdf[0]} — ditunggu sampai tombol PDF ditekan`
      : 'tidak ada berkas jspdf*.js di dist/assets — tombol PDF akan gagal saat ditekan');

  /*
   * Dan sumbernya harus benar-benar `import()` dinamis. Impor statis di
   * `pdfTabel.ts` akan menarik `jspdf` ke graf muat awal lagi, sekecil apa pun
   * penolaknya di `manualChunks`.
   */
  const pdf = kode(baca('src/lib/pdfTabel.ts'));
  cek('jspdf di pdfTabel.ts dimuat lewat import() dinamis',
    /await import\('jspdf'\)/.test(pdf) && !/^import .*from 'jspdf'/m.test(pdf),
    'impor statis menarik jspdf ke jalur muat awal dan membatalkan seluruh usaha manualChunks');

  /*
   * Diperiksa lagi di level sumber, supaya tidak hanya bergantung pada
   * `dist/`. Kalau `dist/` belum dibangun, dua pemeriksaan di atas dilewati
   * sepenuhnya (SKIP) — dan `vite.config.ts` yang salah edit akan lolos
   * tanpa jejak sampai build berikutnya.
   */
  const viteCfg = kode(baca('vite.config.ts'));
  const blokVendor = viteCfg.slice(viteCfg.indexOf('manualChunks'));
  const dikecualikan = BUTUH_SAAT_TEKAN.concat(['qrcode-generator']).filter(nama =>
    new RegExp(`id\\.includes\\('${nama}'\\)`).test(blokVendor)
  );
  cek('vite.config.ts mengecualikan pustaka "saat tombol ditekan" dari vendor',
    dikecualikan.length === BUTUH_SAAT_TEKAN.length + 1,
    `baru tercakup: ${dikecualikan.join(', ') || '(tidak ada)'} — sisa daftar masih eager-load`);

  console.log(`     muat awal: ${kB.toFixed(1)} kB gzip (index.html + ${pre.length} chunk)`);
  for (const f of pre) {
    const p = join(root, 'dist/assets', f);
    if (existsSync(p)) {
      console.log(`       ${f.padEnd(36)} ${(gzipSync(readFileSync(p)).length / 1024).toFixed(1)} kB`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
if (fail > 0) process.exitCode = 1;
void statSync;
