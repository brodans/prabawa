/**
 * Dead code — ekspor yang tidak pernah dipakai.
 *
 * `tsc` dengan `noUnusedLocals`/`noUnusedParameters` sudah menangkap variabel
 * tak terpakai di dalam satu berkas. Tapi `export` yang tidak dirujuk di
 * mana pun tetap lolos: TypeScript menganggapnya bagian dari API publik
 * modul, dan tidak ada build step yang mengeluh.
 *
 * Yang dihitung di sini:
 *
 * - **Kelas B (dipakai 0x, bahkan di berkasnya sendiri)** — dead code
 *   sungguhan. Ini yang harus hilang.
 * - **Kelas A (dipakai hanya di berkasnya sendiri)** — bukan dead code,
 *   hanya `export` yang tidak perlu. Dilaporkan, tidak digagalkan.
 *
 * ⚠️ Yang TIDAK dihitung di sini, karena pemanggilannya tidak terlihat
 * sebagai teks:
 *   - komponen yang dirender langsung di `App.tsx` lewat PAGES/menu
 *   - route yang dirujuk lewat string, bukan import
 *   - nilai yang dibaca `api/` (serverless, di luar `src/`)
 *   - nilai yang dipanggil skrip uji di `tools/`
 *
 * Semua yang diekspor dari `src/` tetapi dipakai oleh `api/` atau `tools/`
 * tetap dihitung karena teksnya ikut digabung.
 *
 * ⚠️ Bagian `tools/` itu penting, bukan pelengkap. Hook khusus uji —
 * `__setFirestoreTiruan()`, `resetPembatasPercobaan()` — sengaja ada hanya
 * supaya skrip uji bisa menjalankan kode produksi sungguhan. Tanpa menghitungnya,
 * keduanya terbaca sebagai dead code dan "diperbaiki" dengan menghapus
 * sesuatu yang justru sedang diuji.
 *
 * Catatan: `src/api/` ikut dihitung. Dulu folder `api` di level atas
 * dilewati, dan itu membuat `src/api/server.ts` terlihat seperti bukan
 * pemakai — sehingga `RpcResponse` terbaca sebagai dead code padahal
 * sudah dipakai. Polanya di sini sengaja hanya mengecualikan `api/`
 * yang langsung di root.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const lewati = new Set(['node_modules', 'dist', '.git', 'public', 'tools', '.vite']);
const files = [];
(function jalan(d) {
  for (const e of readdirSync(d)) {
    // Hanya `api/` di level atas yang dilewati; `src/api/` berisi kode
    // produksi dan harus ikut dihitung sebagai pemakai.
    if (lewati.has(e) && !(e === 'api' && d === root)) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) jalan(p);
    else if (/\.tsx?$/.test(e)) files.push(p);
  }
})(root);

const sumber = new Map(files.map(f => [f, readFileSync(f, 'utf8')]));
const luar = [
  ...readdirSync(join(root, 'api'))
    .filter(f => f.endsWith('.ts'))
    .map(f => readFileSync(join(root, 'api', f), 'utf8')),
  // Skrip uji memanggil hook khusus uji (mis. `__setFirestoreTiruan`).
  // Hitung sebagai pemakai — kalau tidak, hook itu akan dilaporkan dead code
  // dan "dibetulkan" dengan menghapus hal yang sedang diuji.
  ...readdirSync(join(root, 'tools'))
    .filter(f => f.endsWith('.mjs'))
    .map(f => readFileSync(join(root, 'tools', f), 'utf8')),
  readFileSync(join(root, 'index.html'), 'utf8'),
].join('\n');

/** Baris yang menjadi deklarasi, supaya tidak dihitung sebagai "pemakaian". */
function hitungPemakaian(teks, nama, tanpaNamaIni) {
  const disamarkan = teks.replace(tanpaNamaIni, nama);
  return (disamarkan.match(new RegExp(`\\b${nama}\\b`, 'g')) || []).length;
}

const kelasA = [];
const kelasB = [];
let total = 0;

for (const [f, teks] of sumber) {
  for (const m of teks.matchAll(
    /^export\s+(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm
  )) {
    const [, jenis, nama] = m;
    total++;

    // Hapus blok deklarasi supaya penyebutan di dalam definisi sendiri
    // (tipe balik, parameter bertipe, rekursi) tidak dihitung sebagai pemakaian.
    const polaBlok = new RegExp(
      `^export\\s+(?:async\\s+)?${jenis}\\s+${nama}\\b[\\s\\S]*?(?=\\n(?:export|import|const|let|var|function|class|interface|type|enum)\\b|\\n\\}|\\n$)`,
      'm'
    );
    const tanpa = teks.replace(polaBlok, '');

    const diSendiri = hitungPemakaian(tanpa, nama, polaBlok);
    let diLuar = 0;
    for (const [g, t] of sumber) {
      if (g === f) continue;
      diLuar += (t.match(new RegExp(`\\b${nama}\\b`, 'g')) || []).length;
    }
    diLuar += (luar.match(new RegExp(`\\b${nama}\\b`, 'g')) || []).length;

    const baris = `${relative(root, f)}  ${jenis} ${nama}`;
    if (diLuar === 0) {
      if (diSendiri === 0) kelasB.push(`${baris}  — 0 pemakaian total`);
      else kelasA.push(`${baris}  — dipakai ${diSendiri}x hanya di berkas sendiri`);
    }
  }
}

console.log(`Total ekspor bernama: ${total}\n`);
console.log(`KELAS A — "export" tidak perlu (${kelasA.length}), bukan dead code:`);
for (const x of kelasA) console.log('  ' + x);
console.log(`\nKELAS B — DEAD CODE SUNGGUHAN (${kelasB.length}):`);
for (const x of kelasB) console.log('  ' + x);
console.log(kelasB.length === 0 ? '\nSEMUA LULUS' : `\n${kelasB.length} dead code`);
process.exit(kelasB.length === 0 ? 0 : 1);
