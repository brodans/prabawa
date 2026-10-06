/**
 * Analis graf impor statis — mencari siapa yang menarik `firebase/firestore`
 * ke dalam jalur muat awal.
 *
 * Ini menjelaskan kenapa 140 kB gzip itu muncul sebagai
 * `<link rel="modulepreload">` di `index.html`: begitu satu berkas di jalur
 * awal mengimpor SDK secara statis, Vite menaruhnya di graf awal dan
 * mem-*preload*-nya. Semua orang lalu mengunduhnya sebelum sempat melihat
 * layar login.
 *
 * Jadi pertanyaannya bukan "apakah ada yang mengimpor firebase" — pastinya
 * ada — tapi "apakah ada yang mengimpornya secara **statis**, dan siapa".
 *
 * Modul yang diimpor lewat `import()` dinamis tidak dihitung: justru itu
 * yang membuat berkas SDK tidak masuk ke graf awal.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = resolve('.');

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(ent.name) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(resolve(root, 'src'));
const known = new Set<string>(files);

/** Impor **nilai** saja; `import type` tidak mengarahkan bundel. */
function imporStatis(file: string): Array<{ spec: string; ligne: number }> {
  const src = readFileSync(file, 'utf8');
  const out: Array<{ spec: string; ligne: number }> = [];
  // `import … from '…'` dengan `import` di awal baris.
  const nilai = /^import\s+(?!type\b)([\s\S]*?)\s+from\s+'([^']+)';/gm;
  let m: RegExpExecArray | null;
  while ((m = nilai.exec(src))) out.push({ spec: m[2], ligne: src.slice(0, m.index).split('\n').length });
  // `import '…'` (efek samping).
  const samping = /^import\s+'([^']+)';/gm;
  while ((m = samping.exec(src))) out.push({ spec: m[1], ligne: src.slice(0, m.index).split('\n').length });
  return out;
}

const peta = new Map<string, Array<{ spec: string; ligne: number }>>(
  files.map(f => [f, imporStatis(f)])
);

function selesaikan(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const kandidat of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (known.has(kandidat)) return kandidat;
  }
  return null;
}

const entry = resolve(root, 'src/main.tsx');
const seen = new Set<string>([entry]);
const jalur = new Map<string, string>();
const q: string[] = [entry];

while (q.length > 0) {
  const f = q.shift() as string;
  for (const { spec } of peta.get(f) ?? []) {
    if (!spec.startsWith('.')) {
      if (spec.includes('firebase')) {
        const rantai = [relative(root, f)];
        let n = jalur.get(f);
        while (n) {
          rantai.unshift(relative(root, n));
          n = jalur.get(n);
        }
        console.log('  STATIS  ' + spec);
        console.log('    ' + rantai.join(' → '));
      }
      continue;
    }
    const t = selesaikan(f, spec);
    if (t && !seen.has(t)) {
      seen.add(t);
      jalur.set(t, f);
      q.push(t);
    }
  }
}

console.log('');
console.log(`  berkas terjangkau dari entry: ${seen.size} dari ${files.length}`);
const total = seen.size === files.length;
console.log(
  total
    ? '  ⚠️  SELURUH src/ terjangkau — tidak ada pemisahan kode'
    : `  ${files.length - seen.size} berkas tidak terjangkau (dipisah lewat import dinamis)`
);
