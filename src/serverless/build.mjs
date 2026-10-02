/**
 * Membangun Vercel Serverless Functions yang mandiri.
 *
 * ## Kenapa dibundel manual
 *
 * Awalnya sumber handler ada di `api/*.ts` dan Vercel mengompilasinya sendiri.
 * Itu tidak pernah berhasil di proyek ini, dan alasannya bukan kode handler —
 * tapi cara Vercel menyusun output:
 *
 * ```
 * [info] Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *   '/var/task/src/lib/presensiContract' imported from /var/task/api/rpc.js
 *     at finalizeResolution (node:internal/modules/esm/resolve:281:11)
 * ```
 *
 * Dua hal bertemu di sini:
 *
 * 1. **Vercel tidak meng-bundle** — ia hanya mengubah `.ts` menjadi `.js` dan
 *    membiarkan `import` relatif apa adanya. Perhatikan path di log:
 *    `/var/task/api/rpc.js`, yaitu layout builder lama.
 * 2. **Node ESM tidak pernah bisa me-resolve impor relatif tanpa ekstensi.**
 *    `from '../src/lib/presensiContract'` akan selalu gagal, apa pun isi
 *    direktinya. Dan berkas `.ts` memang tidak ada di sana sebagai `.js`.
 *
 * Ditambah `api/_cors.ts`: berkas berawalan `_` tidak diperlakukan sebagai
 * function, jadi tidak pernah dikompilasi menjadi `_cors.js` — padahal
 * semua handler mengimpornya. Hasilnya `Cannot find module '/var/task/api/_cors'`.
 *
 * Gejalanya di browser selalu sama dan selalu menyesatkan: **500
 * `FUNCTION_INVOCATION_FAILED`**, tanpa satu pun handler sempat jalan. Build
 * terlihat hijau, log build bersih — yang gagal adalah saat runtime, dan
 * penyebabnya tidak ada di mana pun di proyek.
 *
 * Format modul handler juga harus cocok dengan package root. Bundle CommonJS
 * `.js` di bawah `"type": "module"` gagal dengan
 * `ReferenceError: module is not defined` saat runtime.
 *
 * ## Solusinya
 *
 * Handler ditulis di `src/serverless/`, lalu **di-bundle di sini** menjadi
 * berkas `.js` mandiri di dalam `api/`. Berkas hasil build:
 *
 * - tidak punya `require`/`import` ke berkas proyek lain — semua ikut ter-inline;
 * - berformat ESM, sesuai `"type": "module"` di root;
 * - mengimpor paket eksternal saja, yang memang ikut ter-deploy.
 *
 * Yang tersisa hanya paket npm. Kalau salah satu hilang, gejalanya
 * `Cannot find module 'nama-paket'` — jelas dan bisa ditunjuk ke satu
 * dependency, bukan ke struktur proyek.
 *
 * Hasil build diberi banner supaya jelas itu artefak, bukan sumber.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SUMBER = join(root, 'src/serverless');
const KELUARAN = join(root, 'api');

const BANNER = `/**
 * ⚠️ BERKAS HASIL BUILD — JANGAN DIEDIT, jangan diimpor dari mana pun.
 *
 * Dibuat oleh \`src/serverless/build.mjs\` dari \`src/serverless/<nama>.ts\`.
 * Sumbernya ada di \`src/serverless/\`; ubah sana, lalu jalankan \`npm run build\`.
 *
 * Alasan berkas ini harus mandiri ada di \`src/serverless/build.mjs\`: Vercel
 * hanya mengompilasi \`api/*.ts\` tanpa meng-bundle, dan Node ESM tidak bisa
 * me-resolve impor relatif tanpa ekstensi — hasilnya 500
 * \`FUNCTION_INVOCATION_FAILED\` untuk SELURUH endpoint.
 */
`;

/** Handler yang jadi Vercel function (berawalan `_` bukan function). */
const handlers = readdirSync(SUMBER)
  .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
  .map(f => f.replace(/\.ts$/, ''))
  .sort();

if (handlers.length === 0) {
  console.error('Tidak ada handler di src/serverless/. Tidak ada yang dibangun.');
  process.exit(1);
}

// Bersihkan artefak lama supaya berkas yang dihapus tidak tertinggal.
for (const lama of readdirSync(KELUARAN)) {
  if (lama.endsWith('.js') || lama === 'package.json') rmSync(join(KELUARAN, lama), { force: true });
}

let gagal = 0;
for (const nama of handlers) {
  const target = join(KELUARAN, `${nama}.js`);
  try {
    execFileSync(
      'npx',
      [
        'esbuild', join(SUMBER, `${nama}.ts`),
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--packages=external',
        '--log-level=warning',
        `--outfile=${target}`,
      ],
      { cwd: root, stdio: 'pipe' }
    );
    const isi = readFileSync(target, 'utf8');
    // Sisipkan banner di depan keluaran esbuild.
    writeFileSync(target, BANNER + '/* eslint-disable */\n' + isi);
    console.log(`  ${nama}.ts -> api/${nama}.js  (${(isi.length / 1024).toFixed(0)} kB)`);
  } catch (err) {
    gagal++;
    const pesan = String(err.stderr ?? err.message).split('\n')
      .find(l => /ERROR|Could not/.test(l)) ?? String(err.message);
    console.error(`  GAGAL ${nama}.ts: ${pesan.trim().slice(0, 160)}`);
  }
}

if (gagal > 0) {
  console.error(`\n${gagal} handler gagal dibundel.`);
  process.exit(1);
}

// Guard: hasil build tidak boleh masih mengimpor berkas proyek lain. Kalau
// ada, bundel tidak berhasil dan deployment akan gagal saat runtime.
const MASALAH = [];
for (const nama of handlers) {
  const isi = readFileSync(join(KELUARAN, `${nama}.js`), 'utf8');
  const polaImpor = [
    ...(isi.match(/require\(["'](\.\.?\/[^"']+)["']\)/g) ?? []),
    ...(isi.match(/from\s*["'](\.\.?\/[^"']+)["']/g) ?? []),
  ];
  const lintasBerkas = [...new Set(polaImpor)].filter(x => !x.includes('node_modules'));
  if (lintasBerkas.length > 0) MASALAH.push(`${nama}: ${lintasBerkas.join(', ')}`);
}

if (MASALAH.length > 0) {
  console.error('\nMASALAH — bundel masih mengimpor berkas proyek lain:');
  for (const m of MASALAH) console.error('  ' + m);
  console.error('Deployment akan gagal dengan 500 FUNCTION_INVOCATION_FAILED.');
  process.exit(1);
}

console.log(`\n${handlers.length} function siap: ${handlers.map(h => `api/${h}.js`).join(', ')}`);

// Sanity: sumbernya masih ada di tempat yang benar.
for (const nama of handlers) {
  if (!existsSync(join(SUMBER, `${nama}.ts`))) {
    console.error(`\nSumber hilang: src/serverless/${nama}.ts`);
    process.exit(1);
  }
}
