/**
 * Ukur berat dependensi yang ikut ter-*bundle* ke Function Vercel.
 *
 * ## Kenapa ini dijaga
 *
 * Storage Function Vercel dihitung dari **setiap** deployment yang masih
 * tersimpan, bukan hanya yang terbaru. Satu paket yang tidak perlu menambah
 * ratusan MB di *tiap* deploy, dan kumulatifnya yang bikin grafik naik terus.
 *
 * Dua insiden jadi ukuran patokan:
 *
 * 1. `onnxruntime-node` pernah **844 MB** — 662 MB-nya
 *    `libonnxruntime_providers_cuda.so`, sementara OCR jalan
 *    `executionProviders: ['cpu']` di Vercel yang tidak punya GPU.
 * 2. Handler OCR-nya sendiri dihapus dari Vercel (lihat `BUKAN_HANDLER` di
 *    `_handlers.ts`): produksi meminta captcha diketik manual. Bersamaan dengan
 *    itu `onnxruntime-node` **dan** `sharp` dicabut dari `dependencies`, jadi
 *    keduanya tidak lagi ter-install sama sekali di server.
 *
 * Guard ini menjaga dua hal:
 *
 * 1. Paket berat tidak masuk lagi diam-diam. Kalau suatu saat OCR dikembalikan
 *    ke Vercel, angka ini langsung menunjukkan biayanya — bukan setelah grafik
 *    storage naik dan tagihan atau quota yang protes.
 * 2. Tidak ada `postinstall` yang rusak. Kerusakannya mahal: `npm install`
 *    gagal, jadi **seluruh deploy** mati, dan pesannya (`Invalid tag name`)
 *    sama sekali tidak menyebut berkas yang salah.
 *
 * Yang diukur: ukuran di disk `node_modules`, karena itulah yang benar-benar
 * dilihat Vercel setelah `npm install`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const nm = join(root, 'node_modules');
const ada = (paket: string): boolean => existsSync(join(nm, ...paket.split('/')));

console.log('=== postinstall tidak rusak');
/*
 * `postinstall` pernah mendaftarkan `pangkas-onnx.mjs`. Skrip itu sudah dihapus
 * bersama paketnya, jadi `postinstall` ikut hilang — dan itu benar.
 *
 * Yang dijaga di sini bukan keberadaan skrip, tapi **bentuk** nilainya kalau
 * suatu saat ada. Kesalahan sebelumnya adalah mendaftarkan
 * `"pangkas-onnx": "node pangkas-onnx.mjs"` di `devDependencies`: npm
 * membacanya sebagai tag versi, dan `npm install` gagal dengan
 * `EINVALIDTAGNAME` — pesan yang tidak menyebut berkas yang salah.
 */
cek('postinstall tidak menunjuk berkas yang sudah dihapus',
  pkg.scripts?.postinstall === undefined || existsSync(join(root, pkg.scripts.postinstall.split(/\s+/).pop() ?? '')),
  `postinstall=${pkg.scripts?.postinstall ?? '(tidak ada)'}`);

/*
 * ⚠️ Setiap entri `dependencies`/`devDependencies` harus bernilai versi yang sah.
 *
 * Kalau ada nilai yang bukan nomor versi — seperti perintah shell — npm
 * memperlakukannya sebagai tag dan menolak build. Di Vercel itu mematikan
 * seluruh deploy sebelum kode apa pun dieksekusi.
 */
for (const [nama, versi] of [
  ...Object.entries(pkg.dependencies ?? {}),
  ...Object.entries(pkg.devDependencies ?? {}),
] as [string, string][]) {
  // Ranged (`^`, `~`, `>=`) dan tag biasa sama-sama sah. Yang salah adalah
  // nilai yang **bukan** nomor versi sama sekali.
  const sah =
    /^\d/.test(versi) ||
    /^[\^~><=*]\s*\d/.test(versi) ||
    ['latest', 'next', 'beta', '*'].includes(versi) ||
    versi.startsWith('workspace:') ||
    versi.startsWith('file:') ||
    versi.startsWith('git') ||
    versi.startsWith('npm:');
  cek(`versi "${nama}" sah untuk npm`, sah,
    `nilai="${versi}" — npm akan memperlakukannya sebagai tag versi dan menolak build`);
}

console.log('\n=== paket OCR tidak lagi ikut ke Vercel');
/*
 * Ketiga paket ini yang dulu menyebabkan storage melonjak. Semuanya sudah
 * dicabut dari `dependencies`, jadi tidak ter-install di server sama sekali.
 *
 * Dicek di dua tempat sekaligus: manifest (sumber kebenaran) dan disk
 * (`node_modules` lokal mencerminkan apa yang akan dipasang Vercel).
 */
for (const paket of ['onnxruntime-node', 'sharp']) {
  cek(`${paket} bukan dependency produksi`, !(paket in (pkg.dependencies ?? {})),
    'kalau kembali, storage Function naik ratusan MB per deployment');

  cek(`${paket} tidak ter-install`, !ada(paket),
    'node_modules lokal harus mencerminkan apa yang dipasang Vercel');
}

/** Ukuran rekursif, dalam byte. */
function ukuran(p: string): number {
  let total = 0;
  for (const e of readdirSync(p)) {
    const f = join(p, e);
    let s;
    try {
      s = statSync(f);
    } catch {
      continue;
    }
    total += s.isDirectory() ? ukuran(f) : s.size;
  }
  return total;
}

console.log('\n=== berat dependensi yang masuk Function Vercel');
if (!existsSync(nm)) {
  cek('node_modules ada', false, 'jalankan npm install');
} else {
  const deps = Object.keys(pkg.dependencies ?? {});
  const baris: { nama: string; mb: number }[] = [];
  for (const d of deps) {
    const p = join(nm, ...d.split('/'));
    if (existsSync(p)) baris.push({ nama: d, mb: ukuran(p) / 1048576 });
  }
  baris.sort((a, b) => b.mb - a.mb);

  for (const b of baris.slice(0, 6)) {
    console.log(`     ${b.mb.toFixed(0).padStart(6)} MB  ${b.nama}`);
  }

  /*
   * Batas 250 MB.
   *
   * Angkanya diturunkan dari posisi sekarang (~115 MB terpasang, ~40 MB yang
   * benar-benar masuk Function), bukan dari angka historis. Semua `dependencies`
   * digabung karena Vercel memasang semuanya untuk setiap build — paket yang
   * tidak pernah diimpor tetap ikut ter-*download* ke image build, walau tidak
   * masuk bundel function.
   *
   * Batasnya longgar sengaja: yang dikejar adalah **lontarannya**. Naik dari 115
   * ke 250 mungkin masih wajar (React, Firebase, Express), tapi lonjakan lewat
   * situ hampir selalu berarti satu paket besar baru masuk tanpa disadari.
   */
  const total = baris.reduce((s, b) => s + b.mb, 0);
  cek('total dependencies di bawah 250 MB', total < 250,
    `${total.toFixed(0)} MB — ini yang dikali jumlah deployment`);

  cek('node_modules tidak didominasi satu paket (>150 MB)',
    baris.length === 0 || baris[0].mb < 150,
    baris.length ? `terbesar: ${baris[0].nama} ${baris[0].mb.toFixed(0)} MB` : 'tidak ada');
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);