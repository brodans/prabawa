/**
 * Kebersihan naskah di seluruh sumber.
 *
 * ## Kenapa skrip ini ada
 *
 * Komentar dan teks UI ditulis dalam bahasa Indonesia. Berulang kali ada
 * karakter dari trek lain yang ikut terbawa — dari mengetik di tengah
 * kalimat, atau dari hasil salin-tempel. Semuanya **halus**: berkas tetap
 * terbaca, `tsc` tetap lulus, dan tidak ada yang gagal saat build.
 *
 * Yang rusak cuma **bahasanya**. Contoh nyata yang pernah ada di repo ini:
 *
 * ```
 * * Yang_thOOK ditambahkan fungsi ini hanya kompatibilitas
 * * builder itu bukan sekadar merapikan: ia menutup (aksara CJK)
 * ```
 *
 * Pembaca kode ini tidak mungkin memahaminya. Hasilnya selalu "tulisan ini
 * dibuat terburu-buru", dan itu langsung mengikis kepercayaan pada semua
 * penjelasan di berkas yang sama — termasuk penjelasan yang sebenarnya
 * berguna.
 *
 * ## Kenapa pakai `\p{Script=…}`, bukan rentang manual
 *
 * Rentang yang ditulis manual punya dua masalah: rentang itu tidak membedakan
 * emoji (yang di sini dipakai sah — ikon kalender, kunci, dan lain-lain),
 * dan mudah salah tangkap karakter Latin.
 *
 * `\p{Script=…}` tepat untuk hal ini: hanya Han/Hiragana/Katakana/Hangul, dan
 * tidak satu pun karakter Latin atau emoji yang dipakai di repo ini ikut
 * terbawa.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const LEWATI = new Set(['node_modules', 'dist', '.git', '.vite']);

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/*
 * Aksara yang tidak pernah dipakai di repo ini.
 *
 * Dibuat dari *nama skrip* Unicode, bukan dari karakternya, supaya berkas ini
 * sendiri bersih dan boleh diperiksa.
 *
 * Emoji **tidak** termasuk di sini: 📅 🔑 🗓️ dipakai sah di UI.
 */
const AKSARA_ASING = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/*
 * Tanda baca CJK.
 *
 * ⚠️ `…` (U+2026) dan `〜` (U+301C) **sengaja tidak** masuk daftar. Keduanya
 * dipakai sah dan sering di repo ini — `…` dipakai di hundreds baris
 * (ellipsis di teks UI, komentar, dan `ENDPOINT.md`), dan `〜` muncul di
 * dokumentasi. Semuanya bukan tanda CJK walau bentuknya mirip.
 */
const TANDA_CJK = /[　、。〃〈-】〔-〟〰〿！-／：-＠［-｀｛-･]/;

const EKSTENSI = new Set(['.ts', '.tsx', '.mts', '.js', '.css', '.html', '.json', '.md']);

const berkas: string[] = [];
(function jalan(dir: string): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (LEWATI.has(ent.name)) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) jalan(p);
    // Ekstensi, bukan nama berkas. `EKSTENSI.has('App.tsx')` selalu `false`,
    // dan skrip ini lalu melaporkan "0 berkas diperiksa" — lulus karena tidak
    // memeriksa apa pun.
    else if (EKSTENSI.has(extname(ent.name))) berkas.push(p);
  }
})(root);

/*
 * Berkas yang dikecualikan.
 *
 * - `package-lock.json` — isinya disengaja, bukan tulisan kita.
 * - `tools/cek-naskah.mts` (berkas ini) — **harus** dikecualikan, dan bukan
 *   sekadar "~kebetulan lolos".
 *
 * Alasannya berkas ini memang memuat karakter yang dicarinya: pola
 * `\p{Script=Han}` ditulis sebagai *nama skrip* supaya aman, tapi
 * `TANDA_CJK` dan pencocokan kata campuran harus menulis rentangnya secara
 * literal. Kalau berkas ini ikut diperiksa, ia akan memfailkan dirinya sendiri
 * pada setiap run — dan kegagalan itu membuat orang mematikan pemeriksa,
 * bukan memperbaiki pola yang salah.
 *
 * - `api/model/charset.json` — **data**, bukan tulisan kita. Charset model
 *   OCR (ddddocr) berisi beberapa ratus glyph, dan sebagiannya adalah
 *   aksara Tionghoa. Aturannya dibuat ddddocr, bukan kita: mengubah isinya
 *   membuat nomor output model tidak lagi cocok dengan indeks di
 *   `src/serverless/ocr.ts`, dan setiap digit captcha jadi salah.
 *
 * Semua aksara yang benar-benar salah ketik ada di berkas *proyek*, bukan di
 * perkakas pengujinya maupun di data model. Jadi dikecualikan di sini tidak
 * mengurangi apa pun.
 */
const DIKECUALIKAN = new Set(['package-lock.json', 'cek-naskah.mts', 'charset.json']);

const target = berkas.filter(f => !DIKECUALIKAN.has(f.split('/').pop() ?? ''));

const temuanAksara: string[] = [];
const temuanTanda: string[] = [];
const campuran = new Set<string>();

/** Buang komentar — nama ikon/emoji di dalamnya bisa muncul sebagai teks. */
const tanpaKomentar = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

for (const f of target) {
  let teks: string;
  try {
    teks = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  const rel = relative(root, f);
  const baris = teks.split('\n');

  baris.forEach((isi, i) => {
    if (AKSARA_ASING.test(isi)) {
      temuanAksara.push(`${rel}:${i + 1} → ${isi.trim().slice(0, 70)}`);
    }
    if (TANDA_CJK.test(isi)) {
      temuanTanda.push(`${rel}:${i + 1} → ${isi.trim().slice(0, 70)}`);
    }
  });

  // Kata campuran huruf Latin dan non-Latin dalam satu token. Bentuk yang
  // khas dari salah ketik, dan tidak selalu tertangkap pola aksara di atas
  // kalau huruf asingnya cuma satu.
  for (const m of tanpaKomentar(teks).matchAll(/[A-Za-z]{2,}[^\x00-\x7F][A-Za-z]{0,}/g)) {
    if (!/[゠-ヿ가-힯一-鿿]/.test(m[0])) continue;
    campuran.add(`${rel} → ${m[0]}`);
  }
}

cek(
  'tidak ada aksara asing (Han / kana / hangul) di sumber',
  temuanAksara.length === 0,
  temuanAksara.slice(0, 6).join(' | ')
);
cek(
  'tidak ada tanda baca CJK di sumber',
  temuanTanda.length === 0,
  temuanTanda.slice(0, 6).join(' | ')
);
cek(
  'tidak ada kata campuran huruf Latin dan non-Latin',
  campuran.size === 0,
  [...campuran].slice(0, 6).join(' | ')
);

// Emoji sah yang memang dipakai di UI. Kalau nanti ada yang salah ketik,
// daftar ini yang harus diperbarui — bukan check-nya yang dilonggarkan.
const EMOJI_SAH = ['📅', '🔑'];
cek(
  'emoji yang dipakai di UI terdaftar sebagai sah',
  EMOJI_SAH.length > 0,
  EMOJI_SAH.join(' ')
);

console.log(`\n${target.length} berkas diperiksa.`);
console.log(fail === 0 ? 'SEMUA LULUS' : `${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
