/**
 * Simulasi-build Vercel — membuktikan `api/*.ts` benar-benar bisa dijalankan
 * setelah perubahan `api/package.json`.
 *
 * ## Bug yang menutupi modul ini
 *
 * `package.json` root memakai `"type": "module"`. Vercel menentukan format
 * output function dari `type` pada package.json **terdekat**, jadi `api/*.ts`
 * diperlakukan sebagai ESM. Pada mode itu Vercel tidak membundel import
 * relatif, sehingga
 *
 *     import { … } from '../src/lib/presensiContract'
 *
 * dibiarkan apa adanya di output. Resolver ESM mencari `presensiContract`
 * tanpa ekstensi, tidak menemukannya (filenya `.ts`), dan function gagal
 * start:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *       '/var/task/src/lib/presensiContract'
 *       imported from /var/task/api/rpc.ts
 *
 * Di browser itu muncul sebagai `500 FUNCTION_INVOCATION_FAILED` — error
 * platform Vercel, bukan dari kode kita. Build terlihat hijau karena
 * Build-nya memang tidak salah; yang salah hanya saat runtime.
 *
 * Yang diuji di sini: setiap `api/*.ts` bisa dibundel menjadi satu berkas
 * mandiri, dan berkasnya jalan di Node. Kalau bundel gagal atau berkas
 * masih mengimpor sesuatu dari luar `api/`, handler tidak akan pernah
 * start di Vercel.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const API_DIR = join(root, 'api');
let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ' — ' + detail : ''}`);
};

console.log('=== 1. api/ tidak punya .ts (Vercel mengompilasi tanpa membundle)');
/*
 * Rantai penyebab FUNCTION_INVOCATION_FAILED, ringkas:
 * Vercel hanya mengompilasi `api/*.ts` -> `.js` tanpa membundle, dan Node ESM
 * tidak bisa me-resolve impor relatif tanpa ekstensi. Jadi `.ts` di `api/`
 * berarti output berisi `from './_cors'` atau `from '../src/lib/...'` yang
 * mustahil di-resolve. Handler sekarang di-bundle lebih dulu ke `api/*.ts`
 * oleh `src/serverless/build.mts`.
 *
 * Berkas `api/package.json` dengan `"type": "commonjs"` pernah dicoba dan
 * TIDAK memperbaiki apa pun — builder yang dipakai mengabaikannya, dan
 * gejalanya hanya berpindah dari satu impor gagal ke impor gagal berikutnya.
 */
/*
 * Yang dijaga bukan "tidak ada `.ts`" — `.ts` di `api/` memang disengaja.
 * Yang dijaga adalah dua hal yang jadi penyebab sebenarnya:
 *
 * 1. **Tidak ada impor relatif yang tersisa.** Vercel mengompilasi tanpa
 *    me-bundle, jadi impor relatif yang tertinggal tidak akan pernah
 *    ter-resolve oleh Node ESM. Karena itu isi `api/*.ts` harus sudah
 *    self-contained (lihat `npm run build:api`).
 * 2. **Ekspansi `functions` di `vercel.json` tidak menunjuk berkas yang tidak
 *    ada.** Kunci glob yang tidak cocok berarti Vercel tidak menetapkan runtime
 *    ke fungsi mana pun, dan build berhenti dengan:
 *
 *        Function Runtimes must have a valid version, for example `now-php@1.0.0`
 */
const isiApi = readdirSync(API_DIR);
const handlerApi = isiApi.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort();

const tanpaSelfContained = handlerApi.filter((f) => {
  const isi = readFileSync(join(API_DIR, f), 'utf8');
  return /from\s*["'][.]{1,2}\//.test(isi) && !/node_modules/.test(isi);
});
cek('setiap api/*.ts sudah self-contained (tanpa impor relatif ke proyek)',
  tanpaSelfContained.length === 0,
  tanpaSelfContained.join(', ') || `${handlerApi.length} handler, semua tanpa impor relatif`);

const vercelJson = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  functions?: Record<string, unknown>;
};
const kunciFunctions = Object.keys(vercelJson.functions ?? {});
const takAda = kunciFunctions.filter(k => !existsSync(join(root, k)));
cek('semua kunci functions di vercel.json menunjuk berkas yang ada',
  takAda.length === 0, takAda.join(', ') || `${kunciFunctions.length} kunci cocok`);

cek('api/ mengikuti scope ESM package.json root',
  !existsSync(join(API_DIR, 'package.json')),
  'bundle harus cocok dengan type=module di root');
cek('api/tsconfig.json ada (Vercel me-resolve tsconfig dari folder entrypoint)',
  existsSync(join(API_DIR, 'tsconfig.json')));
cek('handler ada di src/serverless/',
  existsSync(join(root, 'src/serverless/rpc.ts')) && existsSync(join(root, 'src/serverless/_cors.ts')));

console.log('\n=== 2. Setiap function bisa dibundel jadi berkas mandiri');
/*
 * ⚠️ Direktori hasil bundel harus ada **di dalam proyek**, bukan di `/tmp`.
 *
 * Node menyelesaikan paket telanjang (`crypto-js`, `bcryptjs`) dengan menelusuri
 * `node_modules` ke atas dari lokasi berkasnya. Berkas di `/tmp/...` akan
 * menelusuri `/tmp/node_modules` lalu `/node_modules` — dan berhenti di sana,
 * bukan sampai `node_modules` proyek. Akibatnya langkah 4 gagal dengan
 * "Cannot find module 'crypto-js'" untuk setiap bundel yang punya satu pun
 * dependensi luar, padahal bundle-nya sendiri sehat.
 *
 * Yang sebenarnya ingin diuji di langkah 4 adalah "handler benar-benar
 * bisa dieksekusi" — sama seperti di Vercel, di mana dependensi terpasang di
 * folder proyek. Menaruh berkasnya di `node_modules/.…` membuat resolusi
 * berjalan persis seperti di sana, tanpa mengotori repo.
 */
const kerja = mkdtempSync(join(root, 'node_modules', '.prabawa-vercelbuild-'));
const FUNGSI = ['rpc', 'upload', 'health', 'billing-aktivasi', 'midtrans-charge'];
const hasilBundel = new Map<string, string>();

for (const nama of FUNGSI) {
  const keluar = join(kerja, `${nama}.cjs`);
  try {
    execFileSync(
      'npx',
      [
        'esbuild', `api/${nama}.ts`,
        '--bundle',
        '--platform=node',
        '--format=cjs',
        '--packages=external',
        `--outfile=${keluar}`,
      ],
      { cwd: root, stdio: 'pipe' }
    );
    hasilBundel.set(nama, keluar);
    cek(`api/${nama}.ts bisa dimuat`, true);
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const pesan = String(e.stderr ?? e.message).split('\n').find(l => /ERROR|Could not/.test(l)) ?? 'tidak diketahui';
    cek(`api/${nama}.ts bisa dimuat`, false, pesan.trim().slice(0, 110));
  }
}

console.log('\n=== 3. Bundel TIDAK boleh masih mengimpor dari luar api/');
/*
 * Inilah yang gagal di Vercel: output ESM masih berisi
 * `require("../src/lib/presensiContract")` / `import ... from
 * "../src/lib/presensiContract"`, dan path itu tidak ada di `/var/task`.
 */
for (const [nama, berkas] of hasilBundel) {
  const isi = readFileSync(berkas, 'utf8');
  const lintas = [
    ...new Set([
      ...(isi.match(/require\("\.\.\/src\/[^"]+"\)/g) ?? []),
      ...(isi.match(/from "\.\.\/src\/[^"]+"/g) ?? []),
      ...(isi.match(/import\("\.\.\/src\/[^"]+"\)/g) ?? []),
    ]),
  ];
  cek(`${nama}: tidak ada impor ke ../src/ yang belum ter-bundle`, lintas.length === 0,
    lintas.join(', ') || '');
}

console.log('\n=== 4. Bundel jalan di Node (handler benar-benar dieksekusi)');
for (const [nama, berkas] of hasilBundel) {
  try {
    const m: Record<string, unknown> = await import(`file://${berkas}`);
    cek(`${nama}: default export adalah fungsi`, typeof m.default === 'function', typeof m.default);
  } catch (err) {
    cek(`${nama}: bisa dimuat`, false, String((err as Error)?.message).slice(0, 100));
  }
}

console.log('\n=== 5. Kontrak yang diimpor lintas batas memang terpakai');
/*
 * Kalau `presensiContract.ts` tidak lagi diekspor ke `api/`, bundel tetap
 * akan jalan — tapi tanpa versi dan tanpa kunci suntikan yang benar, dan
 * gateway akan menolak dengan "aplikasi terbaru telah tersedia" atau
 * menghitung geofence dari koordinat yang tidak pernah sampai.
 */
const rpcSrc = readFileSync(join(root, 'src/serverless/rpc.ts'), 'utf8');
cek('rpc.ts mengimpor buildRpcEnvelope dari kontrak', /buildRpcEnvelope/.test(rpcSrc));
cek('rpc.ts mengimpor INJECTED_PARAM_KEYS dari kontrak', /INJECTED_PARAM_KEYS/.test(rpcSrc));
cek('rpc.ts mengimpor PRESENSI_VERSION dari kontrak', /PRESENSI_VERSION as VERIFIED_PRESENSI_VERSION/.test(rpcSrc));
cek('upload.ts mengimpor path importfile dari kontrak', /PRESENSI_IMPORTFILE_PATH/.test(readFileSync(join(root, 'src/serverless/upload.ts'), 'utf8')));

rmSync(kerja, { recursive: true, force: true });

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
