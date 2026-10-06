/**
 * Simulasi deploy Vercel — bukti bahwa `api/*.ts` benar-benar jalan di sana.
 *
 * ## Bug yang menutupi modul ini
 *
 * Dua log Vercel yang berurutan, setelah dua percobaan perbaikan berbeda:
 *
 *     04:34  Cannot find module '/var/task/src/lib/presensiContract'
 *            imported from /var/task/api/rpc.ts
 *
 *     04:42  Cannot find module '/var/task/api/_cors'
 *            imported from /var/task/api/health.ts
 *
 * Keduanya gagal di `finalizeResolution (node:internal/modules/esm/resolve)`
 * — dan itu bukan error filesystem, tapi **resolver ESM menolak impor relatif
 * tanpa ekstensi**. Direktinya `/var/task` menunjukkan Vercel menyalin
 * keluaran apa adanya: ia mengompilasi `.ts` → `.js` tanpa membundle.
 *
 * Root project memakai `"type": "module"`, jadi hasil build handler juga
 * harus berupa ESM. Bundle CommonJS `.js` gagal saat runtime dengan
 * `ReferenceError: module is not defined`.
 *
 * ## Yang diuji di sini
 *
 * Layout `/var/task` dibangun sungguhan: hanya `api/*.ts` dan `node_modules`,
 * tanpa `src/`, tanpa `.ts`, tanpa berkas handler lain. Lalu `node` dijalankan
 * di dalamnya.
 *
 * Kalau ada satu saja `require`/`import` relatif yang tersisa di `api/*.ts`,
 * function tidak akan start — persis seperti di produksi. Ini menguji
 * kondisi yang tidak bisa diuji dengan import dari proyek asli, karena Node
 * selalu bisa menemukan berkas-nya sendiri.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ' — ' + detail : ''}`);
};

const rpcSource = readFileSync(join(root, 'src/serverless/rpc.ts'), 'utf8');
const timeoutMs = Number(rpcSource.match(/const REQUEST_TIMEOUT_MS = ([\d_]+);/)?.[1]?.replaceAll('_', ''));
const retries = Number(rpcSource.match(/const MAX_RETRIES = ([\d_]+);/)?.[1]?.replaceAll('_', ''));

/**
 * `maxDuration` untuk `api/rpc.ts`.
 *
 * `vercel.json` tidak memakai glob `api/*.ts` — semua function didaftarkan satu
 * per satu, karena batasannya berbeda-beda (`ocr` butuh 1024 MB, sisanya 30
 * detik). Membaca `functions['api/*.ts']` selalu `undefined` lalu
 * `undefined.maxDuration` melempar, dan skrip mati sebelum bagian mana pun
 * diuji.
 *
 * Kalau nanti glob dipakai lagi, fallback di bawah tetap berlaku.
 */
const vercelJson = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  functions?: Record<string, { maxDuration?: number }>;
};
const maksRpcDetik = vercelJson.functions?.['api/rpc.ts']?.maxDuration
  ?? vercelJson.functions?.['api/*.ts']?.maxDuration
  ?? 0;
cek('vercel.json punya maxDuration untuk api/rpc.ts', maksRpcDetik > 0,
  `dibaca: ${maksRpcDetik} detik`);
const maxDurationMs = maksRpcDetik * 1000;
const backoffMs = Array.from({ length: retries }, (_, attempt) => attempt * 800 + 400)
  .reduce((total, delay) => total + delay, 0);
const worstCaseMs = (retries + 1) * timeoutMs + backoffMs;

console.log('=== 0. Batas retry RPC muat dalam maxDuration Vercel');
cek('budget RPC di bawah batas fungsi',
  Number.isFinite(worstCaseMs) && worstCaseMs < maxDurationMs,
  `${(worstCaseMs / 1000).toFixed(1)}s / ${(maxDurationMs / 1000).toFixed(0)}s`);

const kerja = join(tmpdir(), `vercel-deploy-sim-${process.pid}`);
const task = join(kerja, 'var-task');
rmSync(kerja, { recursive: true, force: true });
mkdirSync(join(task, 'api'), { recursive: true });

// ── Simulasikan /var/task ESM dengan api/*.ts + node_modules ──
const files = readdirSync(join(root, 'api')).filter(f => f.endsWith('.ts'));
for (const f of files) cpSync(join(root, 'api', f), join(task, 'api', f));
cpSync(join(root, 'api/tsconfig.json'), join(task, 'api/tsconfig.json'));
symlinkSync(join(root, 'node_modules'), join(task, 'node_modules'), 'dir');
writeFileSync(join(task, 'package.json'), JSON.stringify({ name: 'prabawa-func', type: 'module' }, null, 2));

console.log('=== 1. Layout /var/task dibangun');
cek('hanya api/*.ts yang disalin', files.length > 0, `${files.length} berkas`);
cek('tidak ada src/ di dalam function', !existsSync(join(task, 'src')));
cek('/var/task package scope adalah ESM', JSON.parse(readFileSync(join(task, 'package.json'), 'utf8')).type === 'module');
cek('node_modules ikut ter-deploy', existsSync(join(task, 'node_modules')));
cek('api/tsconfig.json ikut ter-deploy (Vercel me-resolve tsconfig dari entrypoint)',
  existsSync(join(task, 'api/tsconfig.json')));

console.log('\n=== 1b. Vercel mengompilasi api/*.ts dengan tsc — disimulasikan');
/*
 * Ini langkah yang paling mudah terlewat, dan melewatkannya membuat seluruh
 * simulasi di bawah menguji pipeline yang salah.
 *
 * Vercel mengompilasi `api/*.ts` dengan typecheck PENUH. Di
 * `packages/node/src/build.ts`:
 *
 *     const getOutput = skipTypeCheck ? getOutputTranspile : getOutputTypeCheck;
 *
 * Pemanggilnya mengirim dua argumen saja (`tsCompile(source, path)`), jadi
 * `skipTypeCheck` selalu `undefined` dan cabang typecheck yang terpilih.
 *
 * Kalau typecheck ini gagal, build Vercel berhenti dan **seluruh** endpoint
 * hilang — gejalanya 500 `FUNCTION_INVOCATION_FAILED` atau 404, dengan build
 * log yang tidak menyebut penyebabnya. Jadi di sini `tsc` dijalankan sungguhan
 * atas salinan `.ts`, persis seperti yang dilakukan Vercel.
 */
const KELUARAN_TSC = join(task, '.tsc-out');
let tscBerhasil = true;
let pesanTsc = '';
try {
  execFileSync(
    'npx',
    ['tsc', '-p', join(task, 'api/tsconfig.json'), '--outDir', KELUARAN_TSC, '--noEmit', 'false', '--rootDir', join(task, 'api')],
    { cwd: task, stdio: 'pipe' },
  );
} catch (err) {
  tscBerhasil = false;
  const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
  pesanTsc = String(e.stdout ?? e.stderr ?? e.message ?? '').split('\n').filter(Boolean).slice(0, 3).join(' | ');
}
cek('tsc mengompilasi api/*.ts tanpa error', tscBerhasil, pesanTsc.slice(0, 200) || 'typecheck bersih');
cek('keluaran tsc benar-benar terbentuk',
  tscBerhasil && files.every(f => existsSync(join(KELUARAN_TSC, f.replace(/\.ts$/, '.js')))),
  tscBerhasil ? `${files.length} berkas .js terbentuk` : 'lewati — tsc gagal');

/*
 * Yang diimpor selanjutnya adalah hasil `tsc`, bukan `.ts` aslinya — sama
 * seperti Vercel menjalankan yang sudah dikompilasi.
 */
const jalanDari = (nama: string): string =>
  tscBerhasil
    ? join(KELUARAN_TSC, nama.replace(/\.ts$/, '.js'))
    : join(task, 'api', nama);

console.log('\n=== 2. Tidak ada impor relatif yang tersisa (penyebab ERR_MODULE_NOT_FOUND)');
for (const f of files) {
  const isi = readFileSync(join(task, 'api', f), 'utf8');
  const relatif = [
    ...new Set([
      ...(isi.match(/require\(["'](\.\.?\/[^"']+)["']\)/g) ?? []),
      ...(isi.match(/from\s*["'](\.\.?\/[^"']+)["']/g) ?? []),
      ...(isi.match(/import\(["'](\.\.?\/[^"']+)["']\)/g) ?? []),
    ]),
  ];
  cek(`api/${f} tidak punya impor relatif`, relatif.length === 0,
    relatif.join(', ') || '— kalau ada, Node ESM akan menolaknya persis seperti di Vercel');
}

console.log('\n=== 3. Setiap function benar-benar START di dalam layout itu');
/*
 * Ini yang paling penting. Ketidakmahan memuat modul di proyek asli tidak
 * membuktikan apa pun — Node selalu menemukan berkas lewat path relatifnya.
 * Di sini jalurnya sudah dipotong persis seperti di Vercel.
 */
const handlerAman = [];
for (const f of files) {
  try {
    const m = await import(`file://${jalanDari(f)}`);
    if (typeof m.default === 'function') {
      handlerAman.push(f);
      cek(`api/${f} start, default export = fungsi`, true);
    } else {
      cek(`api/${f} start, default export = fungsi`, false, `dapat ${typeof m.default}`);
    }
  } catch (err) {
    const pesan = String((err as Error)?.message ?? err).split('\n')[0];
    cek(`api/${f} start tanpa error`, false, pesan.slice(0, 110));
  }
}

/**
 * `res` tiruan yang mencatat status dan body jawaban.
 *
 * Metodanya berantai dan mengembalikan `this`, seperti `express.Response`
 * sungguhan. Handler produksi memanggil `res.status(403).json({...})`, jadi
 * stub yang mengembalikan `undefined` akan membuat rantai itu runtuh di
 * tengah — dan ujinya lulus karena bukan lagi respons handler.
 *
 * `appendHeader` ikut ada karena `ep.ts` memakainya untuk `Set-Cookie`.
 * Node menyediakan `appendHeader` sejak v18, jadi ini bukan tambahan
 * tebakan: tanpa method-nya, handler `ep` melempar
 * `res.appendHeader is not a function` saat dipanggil — persis kelas
 * kegagalan yang bagian ini ada untuk menangkapnya.
 */
interface ResPalsu {
  statusCode: number;
  header: Record<string, string>;
  body: Record<string, unknown> | null;
  setHeader(k: string, v: string): ResPalsu;
  appendHeader(k: string, v: string): ResPalsu;
  status(k: number): ResPalsu;
  json(p: Record<string, unknown>): ResPalsu;
  end(): ResPalsu;
}

function resPalsu(): ResPalsu {
  const res: ResPalsu = {
    statusCode: 200,
    header: {},
    body: null,
    setHeader(k, v) {
      res.header[k.toLowerCase()] = v;
      return res;
    },
    appendHeader(k, v) {
      res.header[k.toLowerCase()] = v;
      return res;
    },
    status(k) {
      res.statusCode = k;
      return res;
    },
    json(p) {
      res.body = p;
      return res;
    },
    end() {
      res.body = res.body ?? null;
      return res;
    },
  };
  return res;
}

console.log('\n=== 4. Handler-nya benar-benar dipanggil (bukan cuma dimuat)');
for (const f of handlerAman) {
  const m = await import(`file://${join(task, 'api', f)}`);
  const res = resPalsu();
  try {
    await m.default({ method: 'GET', headers: {} }, res);
    // Yang penting: handler menulis respons, bukan melempar. Melempar di luar
    // blok try-nya itulah yang menghasilkan FUNCTION_INVOCATION_FAILED.
    cek(`api/${f} menjawab respons berstatus`, res.statusCode >= 200 && res.statusCode < 600,
      `status ${res.statusCode}`);
  } catch (err) {
    cek(`api/${f} tidak melempar keluar`, false, String((err as Error)?.message).slice(0, 100));
  }
}

console.log('\n=== 5.rpc menjawab JSON-RPC dari gateway stub');
/*
 * `/api/rpc` adalah endpoint yang dipakai auto-login. Kalau bundelnya benar,
 * satu siklus penuh (validasi → envelope → stub gateway → normalisasi
 * respons) harus jalan di dalam layout /var/task.
 */
{
  const { createServer } = await import('node:http');
  const stub = createServer((req, res) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString('utf8')));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: 2, id_req: 'sim', result: { result: true, message: 'ok', api_key: 'K' } }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
  const stubAddr = stub.address();
  if (stubAddr === null || typeof stubAddr === 'string') {
    throw new Error('stub gateway belum listen, port tidak bisa dibaca');
  }
  const stubUrl = `http://127.0.0.1:${stubAddr.port}/service`;

  // Ganti PRESENSI_BASE_URL di dalam bundel supaya mengarah ke stub, lalu
  // kompilasi ulang dengan tsc seperti Vercel melakukannya.
  const sumber = readFileSync(join(task, 'api/rpc.ts'), 'utf8');
  const diganti = sumber.replace(
    /process\.env\.PRESENSI_BASE_URL/g,
    JSON.stringify(stubUrl)
  );
  const sementara = join(task, 'api/rpc.stub.ts');
  writeFileSync(sementara, diganti);

  const KELUARAN_STUB = join(task, '.tsc-stub');
  try {
    execFileSync(
      'npx',
      ['tsc', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
       '--skipLibCheck', '--noCheck', '--types', 'node', '--outDir', KELUARAN_STUB, sementara],
      { cwd: task, stdio: 'pipe' },
    );
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    console.error(String(e.stdout ?? e.stderr ?? '').slice(0, 300));
  }

  process.env.ALLOWED_ORIGINS = 'https://app.example.go.id';
  const m = await import(`file://${join(KELUARAN_STUB, 'rpc.stub.js')}`);
  const res = resPalsu();
  await m.default(
    {
      method: 'POST',
      headers: { origin: 'https://app.example.go.id' },
      body: {
        object: 'login',
        param: { email: '199104262025211116', password: 'x', latlong: '0,0', imei: '1c99c1ff2343cd25' },
      },
    },
    res
  );
  cek('POST /api/rpc login → 200', res.statusCode === 200, `status ${res.statusCode}`);
  cek('hasil diteruskan ke klien',
    (res.body?.result as { api_key?: string } | undefined)?.api_key === 'K',
    JSON.stringify(res.body)?.slice(0, 90));
  stub.close();
  rmSync(sementara, { force: true });
}

console.log('\n=== 6. Bekas kegagalan lama tidak mungkin terulang');
/*
 * Bekas kegagalan yang dijaga di sini BUKAN "ada `.ts` di `api/`" — `.ts` di
 * sana memang disengaja (lihat §1b). Yang dijaga adalah akar sebenarnya:
 * **impor relatif yang tidak ter-bundle**.
 *
 * `api/*.ts` berisi bundel yang sudah lengkap. Vercel mengompilasinya dengan
 * tsc, tapi tsc tidak pernah me-bundle — dan itu tidak masalah, karena tidak
 * ada yang perlu di-bundle. Yang akan menggagalkan build adalah impor relatif
 * yang masih tertinggal, karena Node ESM tidak bisa me-resolve-nya tanpa
 * ekstensi:
 *
 *     Cannot find module '/var/task/src/lib/presensiContract'
 *
 * Bagian §2 sudah memeriksa itu persis di layout `/var/task`, jadi di sini cukup
 * dijaga bahwa hasil build benar-benar tidak bergantung pada `src/` — kalau
 * `src/` ikut ter-deploy, ada sesuatu yang bocor keluar dari bundel.
 */
const isiApiLd = existsSync(join(root, 'api'))
  ? readdirSync(join(root, 'api')).filter(f => f.endsWith('.ts'))
  : [];
const masihButuhSrc = isiApiLd.some(f =>
  /from\s*["'][.]{1,2}\/.*src\//.test(readFileSync(join(root, 'api', f), 'utf8')),
);
cek('tidak ada handler yang masih mengimpor dari src/', !masihButuhSrc,
  'impor relatif yang tertinggal = Cannot find module .../src/lib/presensiContract di /var/task');
cek('semua handler punya @ts-nocheck (build Vercel butuh)',
  isiApiLd.length > 0 && isiApiLd.every(f => readFileSync(join(root, 'api', f), 'utf8').includes('// @ts-nocheck')),
  `${isiApiLd.length} handler diperiksa`);
cek('sumber handler tinggal di src/serverless/',
  existsSync(join(root, 'src/serverless/rpc.ts')) && existsSync(join(root, 'src/serverless/_cors.ts')));
/*
 * Jumlah hasil build harus sama dengan jumlah sumber handler.
 *
 * Daftar handler dibaca dari `_handlers.ts`, bukan dari "semua `.ts` yang tidak
 * berawalan `_`". Kalau tidak, `build.mts` ikut terhitung — dan kalau ikut
 * dibundel, `api/build.ts` muncul sebagai endpoint yang tidak melakukan apa-apa
 * selain menulis bundel baru ke `api/`.
 */
const { daftarHandler } = await import('../src/serverless/_handlers.ts');
const jumlahHandler = daftarHandler(readdirSync(join(root, 'src/serverless'))).length;
cek('semua handler ter-bundle (jumlahnya cocok)',
  files.length === jumlahHandler,
  `${files.length} hasil vs ${jumlahHandler} sumber handler`);

rmSync(kerja, { recursive: true, force: true });

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
