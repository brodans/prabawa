/**
 * Jaga `.vercelignore` — dan yang lebih penting, `.gitignore`.
 *
 * ## Kenapa berkas ini butuh penjaga
 *
 * Dua ignore itu berbeda tujuan dan sering tertukar:
 *
 * - `.gitignore`   → apa yang di-*commit* ke GitHub.
 * - `.vercelignore` → apa yang di-*upload* ke Vercel.
 *
 * Menaruh nama yang salah di tempat yang salah merusak hal yang berbeda
 * sama sekali. `tools/` di `.gitignore` menghapus semua guard dari repo —
 * tidak ada yang salah sampai klon berikutnya tidak bisa diuji. `api/` di
 * `.vercelignore` menghapus endpoint-nya, dan itu persis kelas kegagalan
 * yang sudah pernah terjadi di proyek ini: build hijau, halaman termuat,
 * tapi setiap `/api/*` menjawab 404 atau "This page is unavailable", tanpa
 * satu baris pun di build log yang menyesatkan.
 *
 * Yang diperiksa:
 *
 * 1. Tidak ada yang dibutuhkan build yang ter-exclude.
 * 2. Tidak ada yang dibutuhkan build yang ter-*commit* tapi hilang.
 * 3. `api/*.ts` ada di repo **dan** di daftar upload.
 * 4. Tidak ada Rahasia yang ikut ter-upload.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baca = (p: string): string => readFileSync(join(root, p), 'utf8');
const ada = (p: string): boolean => existsSync(join(root, p));

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/** Satu baris aturan dari berkas ignore. */
interface Aturan {
  negasi: boolean;
  pola: string;
}

/** Aturan dari berkas ignore, tanpa komentar. */
function aturan(p: string): Aturan[] | null {
  if (!ada(p)) return null;
  return baca(p)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => ({ negasi: l.startsWith('!'), pola: l.replace(/^!/, '').replace(/^\//, '') }));
}

/**
 * Penanda untuk `**` sebelum pola lain ikut diganti.
 *
 * Dipakai sebagai teks, bukan byte NUL literal: berkas dengan NUL di
 * dalamnya dibaca sebagai "binary" oleh perkakas, dan `git diff` menampilkannya
 * sebagai berkas biner — perubahan di dalamnya jadi mustahil ditinjau.
 */
const SENTINEL = '\u0000';

/** Glob sederhana: `*` satu tingkat, `**` lintas tingkat, sisanya literal. */
function cocok(pola: string, p: string): boolean {
  if (pola.endsWith('/')) pola += '**';
  const rx = '^' +
    pola
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, SENTINEL)
      .replace(/\*/g, '[^/]*')
      .replace(new RegExp(SENTINEL, 'g'), '.*') +
    '$';
  return new RegExp(rx).test(p);
}

/** True bila `ter-exclude` di berkas ignore, dengan menghormati `!`. */
function terExclude(rules: Aturan[] | null, p: string): boolean {
  let hasil = false;
  for (const r of rules ?? []) {
    if (cocok(r.pola, p)) hasil = !r.negasi;
  }
  return hasil;
}

const vercel = aturan('.vercelignore');
const git = aturan('.gitignore');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1. Berkas yang dibutuhkan build tidak ter-exclude');
cek('.vercelignore ada', vercel !== null,
  vercel ? '' : 'tanpa berkas ini, semua yang ada di repo ikut ter-upload');
cek('.gitignore ada', git !== null);

/*
 * Yang benar-benar dibutuhkan build Vercel. `build` berjalan:
 *
 *   npm run typecheck      -> tsc, butuh tsconfig + src
 *   npm run build:api      -> tsx src/serverless/build.mts
 *   vite build             -> src, index.html, vite.config.ts, postcss.config.ts, public
 *   esbuild src/api/server.ts
 *
 * ⚠️ `tsconfig.tools.json` ikut ter-upload meski `tools/` tidak. Itu
 * disengaja: berkasnya yang dibutuhkan, bukan isinya. Tapi `typecheck` yang
 * dipanggil `build` **hanya** memeriksa `src/` — kalau tidak, build di
 * Vercel gagal dengan "No inputs were found" karena `tools/` tidak ikut
 * dikirim. Pemeriksaan `tools/` ada di `typecheck:tools`, yang hanya jalan
 * di mesin yang punya repo lengkap.
 *
 * Ditambah `api/*.ts`: Vercel membuild fungsi dari berkas yang ia terima,
 * dan tidak menjalankan `build:api` untuk Needs. Kalau `api/` tidak ikut,
 * semua endpoint 404 dengan build log yang bersih.
 */
const WAJIB = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.tools.json',
  'vite.config.ts',
  'postcss.config.ts',
  'index.html',
  'vercel.json',
  'src/main.tsx',
  'src/App.tsx',
  'src/api/server.ts',
  'src/serverless/build.mts',
  'src/serverless/_handlers.ts',
  'src/serverless/rpc.ts',
  // `api/tsconfig.json` wajib ikut: Vercel me-resolve `tsconfig.json` dari
  // folder entrypoint saat mengompilasi `api/*.ts`. Tanpa ini, typecheck
  // fallback ke `tsconfig.json` root yang `strict: true` — dan bundel
  // esbuild akan gagal build dengan puluhan error semantik.
  'api/tsconfig.json',
  'public/manifest.json',
  'api/rpc.ts',
  'api/health.ts',
  'api/upload.ts',
  'api/billing-aktivasi.ts',
  'api/midtrans-charge.ts',
  /*
   * `api/panel-auth.ts` ikut wajib. Endpoint ini mengunci seluruh panel —
   * peran, izin, dan kredensial server pusat — tapi semula tidak ada di
   * daftar ini, jadi boleh ter-exclude saat upload tanpa ada yang menyadarikan.
   *
   * `api/midtrans-status.ts` **dihapus** dari daftar: handler-nya tidak ada
   * lagi. Tidak ada pemanggilnya di `src/`, dan ia terbuka tanpa token, jadi
   * siapa pun yang tahu URL-nya bisa memakai Server Key untuk mencoba-coba
   * `orderId`. Kode mati yang sekaligus jadi permukaan serang tidak bisa
   * dibiarkan hanya karena "nanti mungkin dipakai".
   */
  'api/panel-auth.ts',
];

for (const p of WAJIB) {
  cek(`${p} ada di repo`, ada(p), 'tidak ada di filesystem');
  cek(`${p} tidak ter-exclude saat upload`, !terExclude(vercel, p),
    terExclude(vercel, p) ? 'Vercel tidak akan menerimanya — endpoint atau build akan hilang' : '');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Folder kunci tidak ter-exclude');
for (const p of ['src', 'api', 'public']) {
  cek(`folder ${p}/ tidak ter-exclude`, !terExclude(vercel, `${p}/`));
}

/*
 * `api/` ter-exclude adalah kegagalan yang paling mahal di daftar ini:
 * build tetap hijau, halaman tetap termuat, dan tidak ada satu baris di
 * build log yang menyebut penyebabnya.
 */
cek('api/ TIDAK boleh masuk .vercelignore', !terExclude(vercel, 'api/'),
  'kalau ter-exclude, setiap /api/* akan 404 dengan build log yang bersih');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Perkakas boleh hilang dari upload, tapi jangan dari repo');
{
  const terExcludeUpload = terExclude(vercel, 'tools/cek-vercel.mts');
  cek('tools/ tidak ikut ter-upload', terExcludeUpload,
    'tidak ada yang membutuhkannya saat build');
  cek('tools/ tidak masuk .gitignore', !terExclude(git, 'tools/'),
    'kalau masuk, guard hilang dari repo dan `npm test` gagal di klon baru');

  const skrip = readdirSync(join(root, 'tools')).filter(f => f.endsWith('.mts'));
  cek('tools/ masih berisi skrip uji', skrip.length > 20, `${skrip.length} berkas`);

  // Setiap script npm yang memanggil tools/ harus menunjuk berkas yang ada.
  const pkg = JSON.parse(baca('package.json')) as { scripts?: Record<string, string> };
  const rusak: string[] = [];
  for (const [nama, nilai] of Object.entries(pkg.scripts ?? {})) {
    for (const m of nilai.matchAll(/tools\/[\w.-]+/g)) {
      if (!ada(m[0])) rusak.push(`${nama} → ${m[0]}`);
    }
  }
  cek('setiap script npm menunjuk berkas yang ada', rusak.length === 0, rusak.join(', '));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Tidak ada rahasia yang ikut ter-upload');
// Untuk `.env` arahnya berlawanan dengan yang lain: justru **harus**
// ter-exclude. Env production diisi lewat dashboard Vercel, tidak pernah
// lewat berkas — jadi berkas `.env` yang tersesuai-upload tidak punya
// gunanya kecuali membocorkan `FIREBASE_SERVICE_ACCOUNT`.
for (const p of ['.env', '.env.local', '.env.production']) {
  cek(`${p} ter-exclude dari upload`, terExclude(vercel, p),
    'kalau ikut terkirim, isinya tidak berguna dan hanya risiko');
  cek(`${p} tidak ikut ter-commit`, terExclude(git, p));
}
cek('.env.example tetap ikut', ada('.env.example'),
  'itu templatenya, aman dan tidak berisi nilai');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Aturan .vercelignore itu wajar');
{
  const pola = (vercel ?? []).map(r => r.pola);
  cek('tidak ada pola yang terlalu luas seperti "/"',
    !pola.includes('') && !pola.includes('*'),
    'pola "/" atau "*" akan mengecualikan seluruh repo');
  const adaApi = pola.some(p => /^api\/?(\*\*)?$/.test(p) || p.startsWith('api/'));
  cek('tidak ada aturan yang menyentuh api/', !adaApi);
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
if (fail > 0) process.exitCode = 1;
