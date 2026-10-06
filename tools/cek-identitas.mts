/**
 * Uji identitas aplikasi: nama, versi, dan — yang paling penting —
 * apakah setiap path logo yang dirujuk benar-benar ADA di `public/assets/`.
 *
 * ⚠️ Ini bug yang sebelumnya nyata: `index.html` dan `manifest.json`
 * menunjuk `android-chrome-192x192.png` dan `favicon-16x16.png`, file yang
 * tidak pernah ada di folder — sehingga logo tidak pernah termuat sama
 * sekali. Skrip ini mencegah itu terulang.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const { APP_NAME, APP_FULL_NAME, APP_VERSION, APP_LOGO } = await import(
  '../src/lib/appIdentity.ts'
);

// ═════════════════════════════════════════════════════════════════════
console.log('=== Nama & versi');
cek('nama aplikasi = PRABAWA', APP_NAME === 'PRABAWA', APP_NAME);
cek(
  'nama lengkap benar',
  APP_FULL_NAME === 'Portal Presensi Jawa Timur',
  APP_FULL_NAME
);
cek('versi = 1.0.0', APP_VERSION === '1.0.0', APP_VERSION);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Tidak ada jejak nama lama');
/*
 * Aplikasi sudah beberapa kali ganti nama. Yang dijaga di sini bukan hanya
 * ejaan — tapi bahwa tidak ada satu pun berkas yang masih menyebut nama lama.
 *
 * Alasannya dari pengalaman: nama yang tertinggal di satu tempat sering tidak
 * terlihat. Judul browser, nama PWA di layar utama, dan teks kartu QRIS
 * berasal dari tiga berkas berbeda yang tidak saling mengimpor, jadi tidak
 * ada satu pun yang akan gagal keras kalau hanya satu yang lupa diubah.
 * Pemeriksaan di bawah menutup celah itu.
 *
 * **Tanpa pengecualian.** Sebelumnya ada satu: awalan `order_id` versi lama,
 * disimpan supaya tagihan yang sudah dibayar masih bisa diaktivasi. Aplikasi
 * masih baru dan belum ada transaksi, jadi daftar itu tidak pernah berguna —
 * hanya menambah satu nama lama yang harus dijaga selamanya. `order_id`
 * sekarang hanya memakai awalan PRABAWA, dan `serverBilling.ts` mencocokkannya
 * sama persis.
 *
 * Cakupannya lebih luas dari `src/`: nama lama juga pernah muncul di
 * `index.html`, `manifest.json`, `package.json`, `.env.example`, dan
 * `firestore.rules` — berkas yang tidak melewati bundler, jadi tidak ada yang
 * akan ingat untuk mengirimkannya lagi kalau belum diganti.
 */

/*
 * Nama lama + kepanjangan lamanya. Tidak ada lagi nama antara keduanya.
 *
 * ⚠️ "Praktis Basis Absensi Jawa Timur" ada di sini sebagai nama lama yang
 * **dilarang muncul sebagai teks** — padahal kata-kata itu masih ada di
 * `appIdentity.ts` yang menjelaskan kenapa nama berubah. Pengecualiannya
 * satu file dan satu blok komentar, dan diuji oleh assertion terpisah di
 * bawah: kalau penjelasannya dihapus, yang tersisa adalah nama lama tanpa
 * alasan.
 */
const JEJAK_LAMA =
  /jadhim|jadhuman|satria|jaringan absensi digital|sistem absensi terintegrasi|praktis\s+basis\s+absensi/i;

/**
 * Satu-satunya tempat yang boleh menyebut nama kepanjangan lama.
 *
 * `appIdentity.ts` — dan hanya di dalam blok komentar pembuka yang
 * menjelaskan hubungan nama lama dan nama baru.
 */
const BOLEH_NAMA_LAMA = new Set(['src/lib/appIdentity.ts']);

/** Yang diperiksa: kode, markup, dan konfigurasi. */
const CAKUPAN = ['src', 'tools', 'api'];
const BERKAS_TUNGGAL = [
  'index.html',
  'package.json',
  'package-lock.json',
  'public/manifest.json',
  '.env.example',
  'firestore.rules',
  'vercel.json',
  'ENDPOINT.md',
];

/*
 * Pengecualian `BOLEH_NAMA_LAMA` diterapkan lewat **penghapusan baris**, bukan
 * lewat `if` di dalam loop.
 *
 * Alasannya: kalau pengecualiannya berupa kondisi di dalam loop, menyalin
 * logika ini ke tempat lain berarti mudah lupa memasang pengecualiannya — dan
 * hasil akhirnya "nama lama ada di mana-mana" tanpa ada yang sedang
 * memeriksa. Menghapus barisnya lebih kasar dan tidak bisa dilupakan diam-diam.
 */
const jejak: string[] = [];
const jejakDiKecuali: string[] = [];
for (const dir of CAKUPAN) {
  for (const f of walk(join(root, dir))) {
    const namaRelatif = rel(f);
    // Berkas ini sendiri memuat pola `JEJAK_LAMA` dan penjelasannya, jadi
    // memindainya sendiri akan selalu memfailkan dirinya sendiri pada setiap
    // run. Pola yang sama dikecualikan di `cek-naskah.ts` untuk alasan yang
    // sama: pola pemeriksaan harus boleh menyebut apa yang dicari.
    if (namaRelatif === 'tools/cek-identitas.mts') continue;
    const boleh = BOLEH_NAMA_LAMA.has(namaRelatif);
    readFileSync(f, 'utf8')
      .split('\n')
      .forEach((baris: string, i: number) => {
        if (!JEJAK_LAMA.test(baris)) return;
        const catat = `${namaRelatif}:${i + 1} ${baris.trim().slice(0, 55)}`;
        (boleh ? jejakDiKecuali : jejak).push(catat);
      });
  }
}
for (const f of BERKAS_TUNGGAL) {
  const p = join(root, f);
  if (!existsSync(p)) continue;
  readFileSync(p, 'utf8')
    .split('\n')
    .forEach((baris, i) => {
      if (JEJAK_LAMA.test(baris)) jejak.push(`${f}:${i + 1} ${baris.trim().slice(0, 55)}`);
    });
}

/*
 * Penjelasan di `appIdentity.ts` boleh menyebut nama lama — tapi **hanya di
 * dalam komentar pembuka**, bukan di kode yang dijalankan.
 *
 * Kalau nama lama muncul di `APP_FULL_NAME` (kode nyata), itu bug: aplikasi
 * menampilkan nama yang sudah dibuang. Karena itu baris yang dikecualikan
 * diperiksa ulang: hanya yang diawali ` *` atau `/**` yang lolos.
 */
const jejakDiKode = jejakDiKecuali.filter(
  baris => !/^\s*(\/?\*|\/\*)/.test(baris.slice(baris.indexOf(' ') + 1))
);

cek(
  'tidak ada jejak nama lama di mana pun',
  jejak.length === 0,
  jejak.slice(0, 6).join(' | ')
);
cek(
  'nama kepanjangan lama tidak dipakai di kode yang dijalankan',
  jejakDiKode.length === 0,
  jejakDiKode.slice(0, 4).join(' | ')
);
cek(
  'penjelasan hubungan nama lama/baru masih ada',
  jejakDiKecuali.length > 0,
  'hilangnya penjelasan bukan hanya kehilangan dokumentasi — yang tersisa ' +
    'nama lama tanpa alasan, dan nama itu akan merayap balik'
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Nama panjang baru muncul di semua tempat yang dilihat pengguna');
/*
 * `APP_FULL_NAME` dipakai lewat bundler, tapi `index.html` dan
 * `public/manifest.json` **tidak** melewati bundler — keduanya harus
 * menyebut nama sebagai literal.
 *
 * Tiga berkas itu tidak saling mengimpor, jadi tidak ada satu pun yang gagal
 * keras kalau hanya satu yang lupa diubah. Judul browser, nama PWA di layar
 * utama, dan nama yang tampil saat aplikasi diinstal bisa saja tiga nama
 * berbeda — dan tidak ada yang salah secara teknis.
 */
const NamaBaru = 'Portal Presensi Jawa Timur';
cek('APP_FULL_NAME = nama baru', APP_FULL_NAME === NamaBaru, APP_FULL_NAME);

const htmlSrc = readFileSync(join(root, 'index.html'), 'utf8');
const manifestSrc = readFileSync(join(root, 'public/manifest.json'), 'utf8');
const cekNamaDiTeks = (label: string, teks: string): void =>
  cek(`${label} menyebut nama baru`, teks.includes(NamaBaru), teks.slice(0, 60));

cekNamaDiTeks('index.html <title>', htmlSrc);
cekNamaDiTeks('index.html meta description', htmlSrc);
cekNamaDiTeks('manifest.json name', manifestSrc);
cekNamaDiTeks('manifest.json description', manifestSrc);
cek(
  'package.json description menyebut nama baru',
  readFileSync(join(root, 'package.json'), 'utf8').includes(NamaBaru)
);
cek('ENDPOINT.md menjelaskan hubungan kedua nama', /Portal Presensi Jawa Timur/.test(
  readFileSync(join(root, 'ENDPOINT.md'), 'utf8')
));

/*
 * Yang **tidak boleh** ikut berubah karena nama tampilan.
 *
 * Ketiganya rusak secara irreversible kalau disentuh:
 *
 * - `prabawa-kredensial` = turunan kunci enkripsi. Berubah = setiap password
 *   server pusat yang tersimpan tidak bisa didekripsi lagi.
 * - `PREFIX_ORDER_ID` = awalan `order_id`. Berubah = tagihan yang sudah
 *   tersimpan di produksi tidak dikenali lagi.
 * - `prabawa.vercel.app` = domain produksi, ada di `ALLOWED_ORIGINS`.
 */
const panelSrc = readFileSync(join(root, 'src/lib/panelServer.ts'), 'utf8');
cek(
  'salt enkripsi kredensial tidak ikut diganti',
  /createHmac\('sha256', 'prabawa-kredensial'\)/.test(panelSrc),
  'berubah = seluruh password server pusat yang tersimpan tidak bisa dibaca lagi'
);
cek(
  'domain produksi tidak ikut diganti',
  /prabawa\.vercel\.app/.test(readFileSync(join(root, '.env.example'), 'utf8')),
  'ALLOWED_ORIGINS harus tetap cocok dengan domain yang sedang dipakai'
);
cek(
  'APP_NAME tetap PRABAWA (nama merchant QRIS & awalan order_id)',
  APP_NAME === 'PRABAWA',
  'APP_NAME juga jadi nama merchant QRIS dan bagian order_id produksi'
);

// `order_id` dan pemecahnya harus membaca konstanta yang sama, kalau tidak
// tagihan berhenti bisa diaktivasi tanpa pesan yang menyebut penyebabnya.
const durasiSrc = readFileSync(join(root, 'src/lib/durasi.ts'), 'utf8');
cek('PREFIX_ORDER_ID = PRABAWA', /PREFIX_ORDER_ID = 'PRABAWA'/.test(durasiSrc));
cek(
  'tidak ada konstanta awalan lama yang tersisa',
  !/PREFIX_ORDER_ID_LAMA|POLA_ORDER_ID/.test(durasiSrc + readFileSync(join(root, 'src/lib/serverBilling.ts'), 'utf8')),
  'kalau muncul lagi, ada nama lama yang merayap balik ke kode'
);
cek(
  'serverBilling.ts memotong awalan yang sama',
  /PREFIX_ORDER_ID\}-\$\{item\.id\.toUpperCase\(\)\}\-/.test(
    readFileSync(join(root, 'src/lib/serverBilling.ts'), 'utf8')
  ),
  'tagihan hanya dikenali kalau awalannya PRABAWA'
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== package.json & manifest.json');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8'));
cek('package.json name = prabawa', pkg.name === 'prabawa', pkg.name);
cek('package.json version = 1.0.0', pkg.version === '1.0.0', pkg.version);
cek('manifest version = 1.0.0', manifest.version === '1.0.0', manifest.version);
cek('manifest short_name = PRABAWA', manifest.short_name === 'PRABAWA', manifest.short_name);
cek('manifest name memuat nama lengkap', manifest.name.includes(APP_FULL_NAME), manifest.name);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Path logo di appIdentity.ts benar-benar ada');
// Hanya `APP_LOGO` yang diekspor. `APP_ICONS` pernah ada di sini tapi tidak
// pernah diimpor: `index.html` dan `manifest.json` tidak melewati bundler,
// jadi daftar ikon harus tetap berupa literal di sana — konstanta di modul
// hanya menduplikasi. Yang dijaga di bawah adalah konsistensi kedua literal
// itu satu sama lain, bukan keberadaan konstanta.
cek(`APP_LOGO → ${APP_LOGO}`, existsSync(join(root, 'public', APP_LOGO.replace(/^\//, ''))));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Deskripsi: index.html dan manifest.json harus sama');
/*
 * `APP_DESCRIPTION` pernah diekspor di `appIdentity.ts` tapi tidak pernah
 * dipakai persis karena dua berkas ini tidak melewati bundler — dan justru
 * di situlah nilainya harus hidup.
 *
 * Dua salinan dari satu kalimat mudah berbeda: `index.html` diubah untuk
 * SEO, `manifest.json` terlupa, dan tidak ada yang salah di kedua berkas
 * secara terpisah. Yang diperiksa di sini adalah keduanya identik, dan
 * keduanya tidak pernah menjadi nama generik.
 */
const deskripsiHtml = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/) ?? [])[1] ?? '';
cek('index.html punya meta description', deskripsiHtml.length > 0);
cek('deskripsi index.html = deskripsi manifest', deskripsiHtml === manifest.description,
  `html="${deskripsiHtml.slice(0, 40)}" manifest="${String(manifest.description).slice(0, 40)}"`);
cek('deskripsi menyebut nama lengkap', deskripsiHtml.includes(APP_FULL_NAME), deskripsiHtml);
cek('deskripsi bukan kalimat kosong', deskripsiHtml.trim().length > 40, `${deskripsiHtml.length} karakter`);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Path logo di index.html & manifest.json');
const semuaPathHtml = [...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
cek('index.html punya rujukan assets', semuaPathHtml.length > 0, `${semuaPathHtml.length} rujukan`);
for (const p of semuaPathHtml) {
  cek(`index.html: ${p}`, existsSync(join(root, 'public', p.replace(/^\//, ''))));
}
for (const ic of manifest.icons) {
  cek(`manifest: ${ic.src} (${ic.sizes})`, existsSync(join(root, 'public', ic.src.replace(/^\//, ''))));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Tidak ada path logo usang');
// Komentar dibuang dulu: `index.html` sengaja memuat komentar yang
// menjelaskan file mana yang dulu hilang, jadi nama lamanya muncul di sana.
const htmlKode = html.replace(/<!--[\s\S]*?-->/g, '');
const usang = ['android-chrome-', 'favicon-16x16', 'favicon-32x32'];
for (const u of usang) {
  cek(`tidak ada "${u}" di index.html`, !htmlKode.includes(u));
  cek(`tidak ada "${u}" di manifest.json`, !JSON.stringify(manifest).includes(u));
  // Di `src/` nama-nama ini hanya boleh muncul di dalam komentar yang
  // menjelaskan bug lamanya — bukan di kode yang benar-benar dijalankan.
  cek(`tidak ada "${u}" di kode src/`, !pakaiDiKode(u));
}

// ═════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Bingkai logo persegi rounded, bukan lingkaran');
/** Letak logo aplikasi (bukan foto profil pengguna). */
const logoPlaces = [
  'src/App.tsx', // sidebar
  'src/components/LoginScreen.tsx', // layar login
];
for (const f of logoPlaces) {
  const isi = readFileSync(join(root, f), 'utf8');
  // Ambil blok sekitar tiap pemanggilan APP_LOGO (±3 baris).
  const blok = [...isi.matchAll(/APP_LOGO/g)]
    .map(m => isi.slice(Math.max(0, m.index - 400), m.index + 400))
    .join('\n');
  cek(`${f} punya blok logo`, blok.length > 0);
  cek(`${f} logo tidak dipotong lingkaran`, !blok.includes('circle(50%)'));
  cek(`${f} bingkai logo bukan rounded-full`, !/rounded-full/.test(blok));
  cek(`${f} bingkai logo rounded persegi`, /rounded-(2xl|3xl|\[)/.test(blok));
  // `scale-110` sengaja dihapus: dulu dipakai buat menutupi sudut lingkaran
  // yang terpotong clipPath. Tersisa = logo mengecut di kotak persegi.
  cek(`${f} tidak pakai scale-110 pada logo`, !/scale-110/.test(blok));
}

console.log('\n=== Tidak ada "E-Presensi" di tempat yang dilihat pengguna');
/** File yang isinya tampil ke pengguna. */
const ditampilkan = [
  'index.html',
  'public/manifest.json',
  'src/App.tsx',
  'src/components/LoginScreen.tsx',
  'src/pages/Beranda.tsx',
  'src/pages/Docs.tsx',
  'src/lib/appIdentity.ts',
];
for (const f of ditampilkan) {
  cek(`${f} bebas "E-Presensi"`, !adaEpresensiDiKode(readFileSync(join(root, f), 'utf8')));
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);

/** Buang semua komentar supaya hanya kode yang benar-benar dijalankan. */
function buangKomentar(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Apakah "E-Presensi" muncul di KODE (bukan komentar, bukan kunci storage)?
 *
 * ⚠️ `epresensi_jatim_*` adalah kunci localStorage/sessionStorage, dan
 * sengaja tidak diubah: key itu yang menyimpan sesi, kredensial terenkripsi
 * (sumber auto-login), dan titik absen. Mengubahnya akan mengeluarkan
 * semua orang dan menghapus data mereka tanpa sisa. Nama itu hanya terlihat
 * di DevTools, jadi bukan bagian dari merek yang dilihat pengguna.
 */
function adaEpresensiDiKode(src: string): boolean {
  const kode = buangKomentar(src);
  // Buang kunci storage (identifier snake_case di dalam string).
  const tanpaKunci = kode.replace(/['"][a-z0-9_]*epresensi[a-z0-9_]*['"]/gi, '""');
  /*
   * `epresensi-bkdjatim` bukan nama lama kita — itu nama cookie sesi yang
   * benar-benar diterbitkan server e-Presensi, dan itu diputuskan di sana.
   *
   * Halaman Docs sengaja menampilkannya: itu dokumentasi protokol hulu. Kalau
   * nama yang ditampilkan diganti, dokumentasinya jadi salah — dan orang yang
   * mengikuti langkah Docs tidak akan pernah menemukan cookie-nya di DevTools.
   *
   * Sama seperti `epresensi_jatim_*` di atas: protocol/identifier dibiarkan,
   * merek yang dilihat pengguna yang wajib hilang.
   */
  const tanpaProtokol = tanpaKunci.replace(/epresensi-bkdjatim/gi, 'cookie-sesi-hulu');
  return /e-?presensi/i.test(tanpaProtokol);
}

/** Apakah `needle` muncul di kode `src/` (komentar sudah dibuang)? */
function pakaiDiKode(needle: string): boolean {
  for (const f of walk(join(root, 'src'))) {
    if (buangKomentar(readFileSync(f, 'utf8')).includes(needle)) return true;
  }
  return false;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Path relatif terhadap root project, untuk pesan error yang ringkas. */
function rel(p: string): string {
  return p.startsWith(root) ? p.slice(root.length) : p;
}
