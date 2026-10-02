/**
 * Simulasi deploy Vercel — bukti bahwa `api/*.js` benar-benar jalan di sana.
 *
 * ## Bug yang menutupi modul ini
 *
 * Dua log Vercel yang berurutan, setelah dua percobaan perbaikan berbeda:
 *
 *     04:34  Cannot find module '/var/task/src/lib/presensiContract'
 *            imported from /var/task/api/rpc.js
 *
 *     04:42  Cannot find module '/var/task/api/_cors'
 *            imported from /var/task/api/health.js
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
 * Layout `/var/task` dibangun sungguhan: hanya `api/*.js` dan `node_modules`,
 * tanpa `src/`, tanpa `.ts`, tanpa berkas handler lain. Lalu `node` dijalankan
 * di dalamnya.
 *
 * Kalau ada satu saja `require`/`import` relatif yang tersisa di `api/*.js`,
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
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ' — ' + detail : ''}`);
};

const rpcSource = readFileSync(join(root, 'src/serverless/rpc.ts'), 'utf8');
const timeoutMs = Number(rpcSource.match(/const REQUEST_TIMEOUT_MS = ([\d_]+);/)?.[1]?.replaceAll('_', ''));
const retries = Number(rpcSource.match(/const MAX_RETRIES = ([\d_]+);/)?.[1]?.replaceAll('_', ''));
const maxDurationMs = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).functions['api/*.js'].maxDuration * 1000;
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

// ── Simulasikan /var/task ESM dengan api/*.js + node_modules ──
const files = readdirSync(join(root, 'api')).filter(f => f.endsWith('.js'));
for (const f of files) cpSync(join(root, 'api', f), join(task, 'api', f));
symlinkSync(join(root, 'node_modules'), join(task, 'node_modules'), 'dir');
writeFileSync(join(task, 'package.json'), JSON.stringify({ name: 'prabawa-func', type: 'module' }, null, 2));

console.log('=== 1. Layout /var/task dibangun');
cek('hanya api/*.js yang disalin', files.length > 0, `${files.length} berkas`);
cek('tidak ada src/ di dalam function', !existsSync(join(task, 'src')));
cek('/var/task package scope adalah ESM', JSON.parse(readFileSync(join(task, 'package.json'), 'utf8')).type === 'module');
cek('tidak ada .ts di dalam function',
  files.filter(f => f.endsWith('.ts')).length === 0);
cek('node_modules ikut ter-deploy', existsSync(join(task, 'node_modules')));

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
    const m = await import(`file://${join(task, 'api', f)}`);
    if (typeof m.default === 'function') {
      handlerAman.push(f);
      cek(`api/${f} start, default export = fungsi`, true);
    } else {
      cek(`api/${f} start, default export = fungsi`, false, `dapat ${typeof m.default}`);
    }
  } catch (err) {
    const pesan = String(err?.message ?? err).split('\n')[0];
    cek(`api/${f} start tanpa error`, false, pesan.slice(0, 110));
  }
}

console.log('\n=== 4. Handler-nya benar-benar dipanggil (bukan cuma dimuat)');
for (const f of handlerAman) {
  const m = await import(`file://${join(task, 'api', f)}`);
  const res = {
    statusCode: 200, header: {},
    setHeader(k, v) { this.header[k.toLowerCase()] = v; },
    status(k) { this.statusCode = k; return this; },
    json(p) { this.body = p; return this; },
    end() { this.body = this.body ?? null; return this; },
  };
  try {
    await m.default({ method: 'GET', headers: {} }, res);
    // Yang penting: handler menulis respons, bukan melempar. Melempar di luar
    // blok try-nya itulah yang menghasilkan FUNCTION_INVOCATION_FAILED.
    cek(`api/${f} menjawab respons berstatus`, res.statusCode >= 200 && res.statusCode < 600,
      `status ${res.statusCode}`);
  } catch (err) {
    cek(`api/${f} tidak melempar keluar`, false, String(err?.message).slice(0, 100));
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
    req.on('data', c => (data += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: 2, id_req: 'sim', result: { result: true, message: 'ok', api_key: 'K' } }));
    });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const stubUrl = `http://127.0.0.1:${stub.address().port}/service`;

  // Ganti PRESENSI_BASE_URL di dalam bundel supaya mengarah ke stub.
  const sumber = readFileSync(join(task, 'api/rpc.js'), 'utf8');
  const diganti = sumber.replace(
    /process\.env\.PRESENSI_BASE_URL/g,
    JSON.stringify(stubUrl)
  );
  const sementara = join(task, 'api/rpc.stub.js');
  writeFileSync(join(task, 'api/rpc.stub.js'), diganti);

  process.env.ALLOWED_ORIGINS = 'https://app.example.go.id';
  const m = await import(`file://${sementara}`);
  const res = {
    statusCode: 200, header: {},
    setHeader(k, v) { this.header[k.toLowerCase()] = v; },
    status(k) { this.statusCode = k; return this; },
    json(p) { this.body = p; return this; },
    end() { return this; },
  };
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
  cek('hasil diteruskan ke klien', res.body?.result?.api_key === 'K', JSON.stringify(res.body)?.slice(0, 90));
  stub.close();
  rmSync(sementara, { force: true });
}

console.log('\n=== 6. Bekas kegagalan lama tidak mungkin terulang');
const adaTsDiApi = existsSync(join(root, 'api')) &&
  readdirSync(join(root, 'api')).some(f => f.endsWith('.ts'));
cek('tidak ada .ts di api/ (Vercel akan mengompilasinya tanpa membundle)', !adaTsDiApi,
  'ini akar dari Cannot find module .../src/lib/presensiContract');
cek('sumber handler tinggal di src/serverless/',
  existsSync(join(root, 'src/serverless/rpc.ts')) && existsSync(join(root, 'src/serverless/_cors.ts')));
cek('semua handler ter-bundle (jumlahnya cocok)',
  files.length === readdirSync(join(root, 'src/serverless')).filter(f => f.endsWith('.ts') && !f.startsWith('_')).length,
  `${files.length} hasil vs sumber`);

rmSync(kerja, { recursive: true, force: true });

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
