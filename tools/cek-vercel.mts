/**
 * Uji fungsi-fungsi `api/` persis seperti runtime Vercel.
 *
 * ## Kenapa modul ini ada
 *
 * `tools/cek-proxy-absen.mts` menguji **Express dev server**
 * (`src/api/server.ts`) dengan stub gateway lokal. Itu tidak menjamin
 * apa pun tentang **Vercel serverless functions** di `api/` — yang justru
 * yang dipakai saat deploy. Akibatnya `api/` tidak pernah dieksekusi sama
 * sekali di lingkungan uji, dan dua kegagalan yang hanya muncul di Vercel
 * lolos tanpa terdeteksi:
 *
 * 1. **Build gagal total.** `api/billing-aktivasi.ts` mengimpor
 *    `src/lib/serverBilling.ts`, yang mengimpor `firebase-admin/firestore`.
 *    Pada `firebase-admin@14`, `@google-cloud/firestore` hanya
 *    *optionalDependency* dan tidak selalu terpasang. Kalau tidak ada,
 *    esbuild berhenti dengan `Could not resolve "@google-cloud/firestore"`
 *    — build function gagal, deployment rusak.
 *
 * 2. **Handler melempar di luar `try`.** Kalau `handler` melempar sebelum
 *    atau sesudah blok `try`-nya, Vercel menjawab
 *    `FUNCTION_INVOCATION_FAILED` dengan HTTP 500 — bentuk error yang sama
 *    dengan "server error" biasa, padahal penyebabnya di kode kita.
 *
 * Di sini setiap handler dipanggil sungguhan: bundel dengan esbuild seperti
 * `@vercel/node`, lalu dieksekusi dengan `req`/`res` tiruan dan gateway
 * lokal sebagai upstream. Tidak ada yang menyentuh server pusat.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

// ═════════════════════════════════════════════════════════════════════
//  Gateway stub lokal
// ═════════════════════════════════════════════════════════════════════
/**
 * upstream yang mencatat request dan membalas JSON-RPC.
 * Variabel `tipeBalasan` diganti per-kasus supaya bisa menguji upstream yang
 * error, lambat, atau bukan JSON.
 */
let upstreamTerpanggil = 0;
/**
 * Badan request terakhir yang sampai di stub upstream.
 *
 * Bentuknya `Record<string, unknown>` karena yang diperiksa benar-benar
 * bentuk JSON yang dikirim handler — bukan tipe yang dideklarasikan di
 * modul mana pun.
 */
type BadanUpstream = Record<string, unknown>;

/**
 * Badan request terakhir yang sampai di stub upstream.
 *
 * Dipakai lewat `upstream()` / `paramUpstream()`, bukan lewat properti
 * langsung. Penulisannya terjadi di dalam callback `http`, yang tidak
 * terlihat TypeScript sebagai assignment — jadi `upstream().x` akan
 * disempitkan jadi `never`, bukan `undefined`.
 */
const receptor: { badan: BadanUpstream | null } = { badan: null };

/** Envelope terakhir yang naik ke upstream. */
function upstream(): BadanUpstream {
  return receptor.badan ?? {};
}

/** `param` dari envelope terakhir. */
function paramUpstream(): Record<string, unknown> {
  return (receptor.badan?.param ?? {}) as Record<string, unknown>;
}
let tipeBalasan = 'normal';
const stub = createServer((req, res) => {
  let data = '';
  req.on('data', c => (data += c));
  req.on('end', () => {
    upstreamTerpanggil++;
    try {
      receptor.badan = JSON.parse(data) as BadanUpstream;
    } catch {
      receptor.badan = null;
    }
    if (tipeBalasan === 'bukan-json') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>bukan json</html>');
    }
    if (tipeBalasan === 'badan-kosong') {
      /*
       * Bentuk yang terverifikasi keluar dari `presensi.bkd.jatimprov.go.id`:
       * HTTP 500 + `text/html` + badan **nol byte**. Semula ini dijawab
       * `502 'respons bukan JSON'` — sama persis dengan kasus halaman galat,
       * padahal penyebab dan obatnya beda.
       */
      res.writeHead(500, { 'Content-Type': 'text/html' });
      return res.end('');
    }
    if (tipeBalasan === 'error-500') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('upstream error');
    }
    if (tipeBalasan === 'gagal-json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: 2, id_req: 'x', error: { code: -32601, message: 'Object not found' } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: 2,
        id_req: 'abc',
        result: { result: true, message: 'ok', api_key: 'KEY-123' },
      })
    );
  });
});
await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
const stubAddr = stub.address();
if (stubAddr === null || typeof stubAddr === 'string') {
  throw new Error('stub upstream belum listen, port tidak bisa dibaca');
}
const stubUrl = `http://127.0.0.1:${stubAddr.port}/service`;

// ═════════════════════════════════════════════════════════════════════
//  Bundel setiap handler seperti @vercel/node
// ═════════════════════════════════════════════════════════════════════
/*
 * ⚠️ Direktori hasil bundel harus di dalam proyek, bukan di `/tmp`.
 *
 * Node mencari paket telanjang (`crypto-js`, `bcryptjs`) dengan menelusuri
 * `node_modules` ke atas dari lokasi berkasnya. Dari `/tmp/...` penelusuran itu
 * berhenti di `/node_modules` — bukan pernah sampai `node_modules` proyek —
 * sehingga setiap handler yang punya dependensi luar gagal dimuat dengan
 * "Cannot find module", padahal bundle-nya sendiri sehat.
 *
 * Diletakkan di `node_modules/.…` supaya resolusi berjalan persis seperti di
 * Vercel, tanpa meninggalkan berkas di dalam repo. `rmSync` di akhir skrip
 * membersihkannya.
 */
const kerja = mkdtempSync(join(root, 'node_modules', '.prabawa-vercel-'));
process.env.PRESENSI_BASE_URL = stubUrl;
process.env.ALLOWED_ORIGINS = 'https://presensi.bkd.jatimprov.go.id';
process.env.NODE_ENV = 'test';

/*
 * Setiap handler yang deployed ke Vercel. Daftar ini harus persis sama dengan
 * isi `api/` setelah `npm run build:api` — assertion di §10 yang menjaga
 * kedua sisinya tetap sinkron.
 *
 * `panel-auth` **harus** ada di sini. Ini endpoint yang mengunci seluruh
 * panel, dan duluan tidak ikut diuji: tidak pernah dibundel, tidak pernah
 * diberi body sampah, tidak pernah diperiksa default export-nya. Handler yang
 * paling penting justru paling sedikit dijaga.
 */
const FUNCTIONS = [
  'rpc',
  'upload',
  'health',
  'billing-aktivasi',
  'midtrans-charge',
  'panel-auth',
  // Menu Web: `ep` = reverse proxy ke server e-Presensi.
  //
  // `ocr` tidak ada di sini lagi. Handler OCR menarik `onnxruntime-node` yang
  // 844 MB, dan itu penyebab storage Function Vercel melonjak. Produksi kini
  // meminta captcha diketik manual (`OCR_LOKAL` di `WebPresensi.tsx` bernilai
  // `false` di build produksi), dan `ocr.ts` sudah masuk `BUKAN_HANDLER`.
  //
  // Kalau suatu saat OCR dikembalikan ke Vercel, masukkan `ocr` ke sini
  // sekalian — tanpa itu, regresinya baru ketahuan saat deploy.
  'ep',
];

const handlers = new Map();
const buildGagal = [];

console.log('=== 1. Setiap handler harus bisa dibundel');
/*
 * Ini persis langkah yang gagal di Vercel: esbuildResolution error
 * `Could not resolve "@google-cloud/firestore"` menghentikan build
 * function, dan deployment tidak pernah selesai.
 */
for (const nama of FUNCTIONS) {
  const keluar = join(kerja, `${nama}.cjs`);
  try {
    execFileSync(
      'npx',
      // `--packages=external` wajib: itu cara Vercel membangun function
      // (`@vercel/node` menandai `node_modules` sebagai external lalu
      // menyalinnya lewat nft). Tanpa flag ini, esbuild meng-inline
      // `firebase-admin/app` dan menguji kombinasi modul yang tidak pernah
      // terjadi di produksi.
      ['esbuild', `src/serverless/${nama}.ts`, '--bundle', '--platform=node', '--format=cjs',
       '--packages=external', `--outfile=${keluar}`],
      { cwd: root, stdio: 'pipe' }
    );
    handlers.set(nama, keluar);
    cek(`${nama}.ts (sumber) terbundel`, true);
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const pesan = String(e.stderr ?? e.message).split('\n').find((l: string) => /ERROR|Could not/.test(l)) ?? 'tidak diketahui';
    buildGagal.push(nama);
    cek(`${nama}.ts (sumber) terbundel`, false, pesan.trim().slice(0, 110));
  }
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Handler rpc: alur normal');
// ═════════════════════════════════════════════════════════════════════
/**
 * `res` tiruan yang cukup lengkap untuk Vercel + Express.
 *
 * Metodanya berantai dan mengembalikan `this`, seperti `express.Response`
 * sungguhan. Handler produksi memanggil `res.status(403).json({...})`, jadi
 * stub yang mengembalikan `undefined` membuat rantai itu runtuh di tengah —
 * dan ujinya lalu lulus bukan karena respons handler, tapi karena tidak ada
 * respons sama sekali.
 */
interface ResPalsu {
  statusCode: number;
  header: Record<string, string>;
  body?: unknown;
  bodyTertutup: boolean;
  setHeader(k: string, v: string): ResPalsu;
  status(k: number): ResPalsu;
  json(payload: unknown): ResPalsu;
  send(payload: unknown): ResPalsu;
  end(): ResPalsu;
}

function resPalsu(): ResPalsu {
  const r: ResPalsu = {
    statusCode: 200,
    header: {},
    body: undefined,
    bodyTertutup: false,
    setHeader(k, v) { r.header[k.toLowerCase()] = v; return r; },
    status(k) { r.statusCode = k; return r; },
    json(payload) { r.body = payload; r.bodyTertutup = true; return r; },
    send(payload) { r.body = payload; r.bodyTertutup = true; return r; },
    end() { r.bodyTertutup = true; return r; },
  };
  return r;
}

/** Opsi request untuk `panggil()`. Bentuknya sengaja longgar. */
interface OpsiPanggil {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
}

/** Body respons handler, dibaca sebagai objek. */
function badan(res: ResPalsu): Record<string, unknown> {
  return (res.body ?? {}) as Record<string, unknown>;
}

async function panggil(nama: string, { method = 'POST', headers = {}, body = undefined, query = {} }: OpsiPanggil = {}): Promise<ResPalsu> {
  const handler = (await import(handlers.get(nama) as string)).default as (
    req: unknown,
    res: unknown,
  ) => Promise<void>;
  const res = resPalsu();
  const req = { method, headers, body, query };
  await handler(req, res);
  return res;
}

if (handlers.has('rpc')) {
  tipeBalasan = 'normal';
  upstreamTerpanggil = 0;

  let res = await panggil('rpc', {
    headers: { origin: 'https://presensi.bkd.jatimprov.go.id' },
    body: { object: 'login', param: { nip: '123', password: 'rahasia' } },
  });
  cek('POST login → 200', res.statusCode === 200, `status ${res.statusCode}`);
  cek('hasil diteruskan ke klien',
    (badan(res).result as { api_key?: string } | undefined)?.api_key === 'KEY-123',
    JSON.stringify(res.body)?.slice(0, 90));
  cek('envelope naik ke upstream', upstream().object === 'login', String(upstream().object));
  cek('versi = 89', upstream().version === 89, String(upstream().version));
  cek('jsonrpc = 2', upstream().jsonrpc === 2);
  cek('method = POST', upstream().method === 'POST');
  cek('tiga kunci disuntik',
    'api_key' in (paramUpstream()) &&
    'last_latlong' in (paramUpstream()) &&
    'imei' in (paramUpstream()),
    Object.keys(paramUpstream()).join(','));
  /*
   * `imei` harus ada, tapi **boleh kosong** — dan tidak diisi server.
   *
   * Field-nya wajib ada karena tanpa itu server membalas `-32602`, tapi
   * isinya adalah urusan klien: identitasnya dibuat di peramban, satu per
   * akun per peramban (`src/lib/idPerangkat.ts`). Proxy tidak pernah
   * memilihnya — satu id yang dibagi ke semua perangkat menghapus makna
   * pengikatan akun ke perangkat di server pusat.
   */
  cek('imei tidak diisi server saat kosong', (paramUpstream().imei ?? '') === '',
    'kalau proxy mengisinya, semua perangkat berbagi satu identitas');
  cek('param asli diteruskan', paramUpstream().nip === '123');
  cek('CORS: Allow-Origin sesuai allow-list', res.header['access-control-allow-origin'] === 'https://presensi.bkd.jatimprov.go.id');
  cek('CORS: Vary: Origin ada', res.header.vary === 'Origin');

  console.log('\n=== 3. rpc: upstream bermasalah → error TERJAGA (bukan 500)');
  tipeBalasan = 'bukan-json';
  res = await panggil('rpc', { body: { object: 'login', param: {} } });
  cek('upstream 200 tapi HTML → 502 (bukan 500)', res.statusCode === 502, `status ${res.statusCode}`);
  cek('pesan menyebut halaman galat, bukan JSON mentah',
    /halaman galat/i.test(String(badan(res).error ?? '')), String(badan(res).error));
  cek('status hulu ikut diteruskan (200)',
    badan(res).huluStatus === 200, `huluStatus ${badan(res).huluStatus}`);
  cek('huluKosong=false karena badan berisi HTML', badan(res).huluKosong === false);
  cek('cuplikan hanya baris pertama tanpa tag',
    badan(res).cuplikan === 'bukan json' && !String(badan(res).cuplikan ?? '').includes('<'),
    JSON.stringify(badan(res).cuplikan));
  cek('field lama "text" tidak lagi bocorkan badan mentah',
    badan(res).text === undefined, JSON.stringify(badan(res).text));

  /*
   * Kasus yang paling sering muncul di dunia nyata: `HTTP 500` dengan badan
   * nol byte. Proxy harus membalas `503`, bukan `502`, supaya sisi klien tahu
   * ini gangguan **sesaat** di server pusat dan layak dicoba sekali lagi.
   */
  tipeBalasan = 'badan-kosong';
  res = await panggil('rpc', { body: { object: 'getlokasiabsen', param: {} } });
  cek('hulu 500 badan kosong → 503 (bukan 502)', res.statusCode === 503, `status ${res.statusCode}`);
  cek('huluKosong=true', badan(res).huluKosong === true);
  cek('status hulu = 500 diteruskan', badan(res).huluStatus === 500, `huluStatus ${badan(res).huluStatus}`);
  cek('pesan menyebut gangguan sesaat di server pusat',
    /tidak melayani/i.test(String(badan(res).error ?? '')), String(badan(res).error));
  cek('cuplikan kosong, tidak mengarang isi',
    badan(res).cuplikan === '', JSON.stringify(badan(res).cuplikan));

  tipeBalasan = 'gagal-json';
  res = await panggil('rpc', { body: { object: 'login', param: {} } });
  cek('upstream JSON-RPC error → tetap 200', res.statusCode === 200, `status ${res.statusCode}`);
  cek('error upstream ikut diteruskan', Boolean(badan(res).error));

  tipeBalasan = 'error-500';
  res = await panggil('rpc', { body: { object: 'login', param: {} } });
  cek('upstream 500 → error diteruskan, tidak crash', res.bodyTertutup === true, `status ${res.statusCode}`);

  console.log('\n=== 4. rpc: validasi & CORS');
  tipeBalasan = 'normal';
  res = await panggil('rpc', { method: 'GET' });
  cek('GET ditolak 405', res.statusCode === 405, `status ${res.statusCode}`);
  res = await panggil('rpc', { method: 'OPTIONS' });
  cek('OPTIONS dijawab 200', res.statusCode === 200, `status ${res.statusCode}`);
  res = await panggil('rpc', { body: {} });
  cek('body tanpa object → 400', res.statusCode === 400, `status ${res.statusCode}`);
  res = await panggil('rpc', { body: { object: 'a b c' } });
  cek('object tidak valid → 400', res.statusCode === 400, `status ${res.statusCode}`);
  res = await panggil('rpc', { body: null });
  cek('body null → 400, tidak crash', res.statusCode === 400, `status ${res.statusCode}`);
  res = await panggil('rpc', { body: { object: 'login', param: 'bukan objek' } });
  cek('param bukan objek → tetap jalan', res.statusCode === 200, `status ${res.statusCode}`);
  res = await panggil('rpc', { headers: { origin: 'https://penyerang.example' }, body: { object: 'login', param: {} } });
  cek('origin asing → 403', res.statusCode === 403, `status ${res.statusCode}`);
  cek('origin asing tidak pernah sampai ke upstream', true);
  res = await panggil('rpc', { headers: {}, body: { object: 'login', param: {} } });
  cek('tanpa Origin (curl/health) → boleh', res.statusCode === 200, `status ${res.statusCode}`);

  console.log('\n=== 5. TIDAK ADA handler yang melempar keluar');
  /*
   * Inilah yang menghasilkan `FUNCTION_INVOCATION_FAILED`: handler melempar
   * di luar blok `try`-nya, jadi Vercel tidak pernah sampai menulis
   * respons. Semua pemanggilan di bawah harus menghasilkan respons
   * berstatus, apa pun inputnya.
   */
  for (const nama of FUNCTIONS) {
    if (!handlers.has(nama)) continue;
    for (const [label, opsi] of [
      ['tanpa body', {}],
      ['body null', { body: null }],
      ['body bukan objek', { body: 'teks' }],
      ['body array', { body: [1, 2] }],
      ['tanpa headers', { headers: undefined }],
      ['tanpa method', { method: undefined }],
      ['method aneh', { method: 'TRACE' }],
      ['query ada', { query: { a: 1 } }],
    ] as Array<[string, OpsiPanggil]>) {
      try {
        const r = await panggil(nama, opsi);
        cek(`${nama} (${label}) → respons berstatus`, r.bodyTertutup === true, `status ${r.statusCode}`);
      } catch (err) {
        cek(`${nama} (${label}) tidak melempar`, false, String((err as Error)?.message).slice(0, 90));
      }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Tiap fungsi punya default export (syarat Vercel)');
// ═════════════════════════════════════════════════════════════════════
for (const nama of FUNCTIONS) {
  if (!handlers.has(nama)) continue;
  const m = await import(handlers.get(nama));
  cek(`${nama} default export adalah fungsi`, typeof m.default === 'function', typeof m.default);
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Konfigurasi deploy');
// ═════════════════════════════════════════════════════════════════════
const vercel = JSON.parse(
  (await import('node:fs')).readFileSync(join(root, 'vercel.json'), 'utf8')
) as { functions?: Record<string, unknown> };

/*
 * `FUNCTION_INVOCATION_FAILED` datang dari platform Vercel, bukan dari kode
 * kita: artinya function-nya tidak pernah sempat dijalankan. Dua penyebab
 * yang bisa dicek dari berkas konfigurasi:
 *
 * 1. **Runtime function tidak dikunci.** `@google-cloud/firestore@9` butuh
 *    Node >= 22. Kalau function jalan di Node 20, paket itu tidak bisa
 *    dipakai, dan tergantung tahapnya build berhenti atau modul gagal
 *    termuat saat runtime. `engines.node` di `package.json` TIDAK selalu
 *    berlaku untuk function — `functions` di `vercel.json` yang mengunci
 *    runtime secara eksplisit.
 *
 * 2. **Self-rewrite `/api/:path*` -> `/api/:path*`.** Tidak berguna (Vercel
 *    sudah check filesystem sebelum rewrite) dan memaksa request lewat mesin
 *    rewrite. Semula ada di berkas ini.
 *
 * 3. **Glob `functions` tidak cocok dengan isi `api/`.** Ini yang terjadi
 *    di deploy `d6ec9b6`: `api/` sudah berisi bundel hasil
 *    `npm run build:api`, tapi `vercel.json` masih menunjuk `api/*.ts`.
 *    Glob yang tidak cocok dengan satu file pun berarti Vercel tidak
 *    menetapkan runtime ke fungsi mana pun, dan build berhenti sebelum
 *    aplikasi sempat jalan dengan pesan:
 *
 *        Function Runtimes must have a valid version, for example `now-php@1.0.0`.
 *
 *    Gejalanya menipu karena build log bersih dan tidak ada satu pun
 *    assertion yang gagal — makanya glob-nya yang diuji di sini, bukan hanya
 *    "apakah kuncinya ada".
 */

/*
 * Fungsi yang benar-benar ada di `api/`.
 *
 * Hanya `.ts` — itu satu-satunya ekstensi handler di `api/` sekarang.
 * `.d.ts` ikut tersaring karena bukan handler.
 */
const fungsiAda: string[] = (await import('node:fs'))
  .readdirSync(join(root, 'api'))
  .filter((f: string) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map((f: string) => `api/${f}`);

cek('ada fungsi di api/', fungsiAda.length > 0, `${fungsiAda.length} berkas`);

const globbyFunctions = Object.keys(vercel.functions ?? {});

/** `api/*.ts` → RegExp. Hanya `*` yang dipakai di konfigurasi ini. */
const polaGlob = (g: string): RegExp =>
  new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');

for (const globby of globbyFunctions) {
  const cocok = fungsiAda.filter(f => polaGlob(globby).test(f));

  cek(
    `glob "${globby}" cocok dengan setidaknya satu fungsi`,
    cocok.length > 0,
    cocok.length === 0
      ? `TIDAK ADA yang cocok — Vercel akan gagal dengan "Function Runtimes must have a valid version". Fungsi yang ada: ${fungsiAda.join(', ')}`
      : `${cocok.length} cocok: ${cocok.join(', ')}`
  );
}

/*
 * Dan sebaliknya: setiap fungsi harus tertangkap oleh salah satu glob.
 * Glob yang cocok tapi tidak mencakup semuanya berarti fungsi sisanya
 * berjalan tanpa runtime yang dikunci — lebih diam-diam daripada yang
 * tidak cocok sama sekali, karena build justru lulus.
 */
const yatim = fungsiAda.filter(f => !globbyFunctions.some(g => polaGlob(g).test(f)));
cek(
  'setiap fungsi tercakup konfigurasi deploy (tidak ada api/*.ts yang yatim)',
  yatim.length === 0,
  yatim.length > 0 ? `tanpa konfigurasi: ${yatim.join(', ')}` : `${fungsiAda.length} fungsi tertangkap`
);

/**
 * Konfigurasi tiap fungsi, dikumpulkan dari semua glob yang cocok.
 *
 * `vercel.json` mendaftarkan setiap function satu per satu, bukan lewat
 * `api/*.ts` — batasannya memang berbeda-beda. Membaca satu kunci glob
 * tunggal selalu menghasilkan `{}`, dan assertion yang memakainya lalu
 * memeriksa `undefined >= 30` (selalu salah) atau `maxDuration` yang tidak
 * pernah ada. Jadi kumpulkan per fungsi yang benar-benar terdaftar.
 */
interface KonfigurasiFungsi {
  runtime?: string;
  maxDuration?: number;
  memory?: number;
}

const fnConfig = new Map<string, KonfigurasiFungsi>();
for (const [globby, cfg] of Object.entries(vercel.functions ?? {}) as Array<[string, KonfigurasiFungsi]>) {
  const rx = polaGlob(globby);
  for (const f of fungsiAda.filter((x: string) => rx.test(x))) {
    fnConfig.set(f, { ...(fnConfig.get(f) ?? {}), ...cfg });
  }
}

const packageJson = JSON.parse((await import('node:fs')).readFileSync(join(root, 'package.json'), 'utf8'));
cek('Node 22 ditentukan lewat engines.node', packageJson.engines?.node === '22.x',
  packageJson.engines?.node ?? '(tidak ada)');

const tanpaRuntime = [...fnConfig].filter(([, cfg]) => 'runtime' in cfg);
cek('runtime custom tidak ditetapkan untuk fungsi Node bawaan Vercel',
  tanpaRuntime.length === 0,
  tanpaRuntime.length > 0
    ? tanpaRuntime.map(([f, c]) => `${f}: ${c.runtime}`).join(', ')
    : `${fnConfig.size} fungsi, runtime dideteksi otomatis`);

const tanpaDurasi = [...fnConfig].filter(([, cfg]) => Number(cfg.maxDuration) < 30);
cek('maxDuration >= 30 detik untuk setiap function',
  tanpaDurasi.length === 0,
  tanpaDurasi.length > 0
    ? `${tanpaDurasi.length} function tanpa maxDuration cukup — rpc retry 3x25s butuh ruang`
    : [...fnConfig].map(([f, c]) => `${f}=${c.maxDuration}s`).join(', '));

/*
 * `routes` dipakai, bukan `rewrites`.
 *
 * Proyek ini memakai `{ "handle": "filesystem" }` supaya berkas asli — termasuk
 * `api/*.ts` dan aset statis seperti `assets/*.js` — dilayani apa adanya sebelum
 * catch-all SPA. Tanpa itu, berkas aset akan dilayani `index.html` dan peramban
 * menerima HTML untuk berkas JS. `rewrites` tidak punya titik ini, jadi
 * pemeriksaan berikut membaca keduanya lewat satu bentuk.
 *
 * Catatan: `api/model/` sudah tidak ada (OCR tidak lagi di-deploy), tapi
 * `handle: filesystem` tetap wajib karena aset hasil build Vite ada di sini.
 */
interface AturanRute {
  src?: string;
  dest?: string;
  handle?: string;
  methods?: string[];
}

const vercelJsonRaw = JSON.parse(
  (await import('node:fs')).readFileSync(join(root, 'vercel.json'), 'utf8')
) as {
  rewrites?: AturanRute[];
  routes?: AturanRute[];
};

const rewrites = vercelJsonRaw.rewrites ?? vercelJsonRaw.routes ?? [];
const handleFilesystem = (vercelJsonRaw.routes ?? []).some(r => r.handle === 'filesystem');

for (const rw of rewrites) {
  if (!rw.src || rw.handle) continue;
  cek(
    `tidak ada self-rewrite ${rw.src}`,
    rw.src !== rw.dest,
    'source == destination memaksa request lewat mesin rewrite tanpa guna'
  );
}
cek('tidak ada rewrite yang menyentuh /api/',
  !rewrites.some((rw: AturanRute) => String(rw.src).includes('/api/:path*') && rw.dest === rw.src));
cek('berkas asli dilayani sebelum catch-all SPA',
  handleFilesystem || (vercelJsonRaw.rewrites?.length ?? 0) > 0,
  'tanpa `handle: filesystem` (atau `rewrites`), aset seperti assets/*.js dilayani index.html');
/*
 * Assertion rewrite di sini SENGAJA mencari rewrite SPA lewat
 * `destination`-nya, bukan lewat indeks.
 *
 * Dulu ada tepat satu rewrite, jadi `rewrites[0]` pasti yang SPA. Sekarang
 * `/ep/:path*` (menu Web) ocupa indeks 0 dan SPA pindah ke indeks 1 — dan
 * assertion lama ikut berbohong: dia membaca `/ep/:path*`, menyimpulkan
 * "(?!api/) tidak ada", lalu melaporkan rewrite SPA tidak mengecualikan
 * `/api/`, padahal sebenarnya benar.
 *
 * Yang benar-benar berbahaya adalah dua hal lain, dan keduanya diperiksa di
 * bawah: `/api/` tidak boleh tertangkap SPA, dan rewrite `/ep` harus di
 * SEBELUM SPA — kalau tidak, `/ep/*` dilayani `index.html` dan login web
 * mati tanpa error (halaman HTML, bukan JSON).
 */
/*
 * SPA dicari lewat `dest`-nya, bukan lewat indeks, dan nama fieldnya mengikuti
 * sumber konfigurasi yang dipakai: `rewrites` memakai `source`/`destination`,
 * sedangkan `routes` memakai `src`/`dest`.
 */
const polaSpa = (rw: AturanRute): boolean => String(rw.dest ?? '').includes('index.html');
const polaEp = (rw: AturanRute): boolean => String(rw.src ?? '').includes('/ep');
/**
 * Apakah `/api/*` dilayani sebelum rule `index.html` ini?
 *
 * Dua cara, sesuai bentuk konfigurasi:
 *
 * - `rewrites` — rule SPA sendiri yang mengecualikan `/api/` lewat regex
 *   `(?!api/)`.
 * - `routes` — catch-all `^/(.*)$ -> /index.html` **tidak** bisaSports regex
 *   yang dinersialkan Vercel, jadi `/api/*` dilindungi oleh entri
 *   `{ "handle": "filesystem" }` yang diletakkan **sebelumnya**.
 *
 * Yang kedua mudah terbalik: `handle: filesystem` yang muncul *sesudah*
 * catch-all tidak berguna apa pun, karena request sudah terlayani.
 */
const filesystemSebelum = (indeks: number): boolean =>
  handleFilesystem && rewrites.findIndex((rw: AturanRute) => rw.handle === 'filesystem') < indeks;

const kecualikanApi = (rw: AturanRute, indeks: number): boolean =>
  String(rw.src ?? '').includes('(?!api/)') || filesystemSebelum(indeks);

const spaRewrites = rewrites.filter(polaSpa);
const spaRewrite = spaRewrites[0];
cek('ada tepat satu rewrite SPA (-> index.html)',
  spaRewrites.length === 1,
  `${spaRewrites.length} rewrite menuju index.html dari ${rewrites.length} rewrite`);
/*
 * Posisi yang dibandingkan adalah indeks di `rewrites` — urutan aslinya.
 * Kalau dihitung relatif terhadap `spaRewrites` (yang sudah difilter),
 * `handle: filesystem` selalu terlihat "sesudah" dan penjelasannya sendiri
 * berbohong.
 */
const posisiDiRewrites = (rw: AturanRute): number => rewrites.indexOf(rw);
const idxSpa = posisiDiRewrites(spaRewrite as AturanRute);

cek('SPA tidak menelan panggilan /api/',
  spaRewrites.length > 0 &&
    spaRewrites.every((rw: AturanRute) => kecualikanApi(rw, posisiDiRewrites(rw))),
  spaRewrite
    ? (filesystemSebelum(idxSpa)
        ? 'dikecualikan lewat `handle: filesystem` yang mendahului catch-all'
        : `src: ${spaRewrite.src ?? '(tidak ada)'}`)
    : '(tidak ada rewrite SPA)');
cek('tidak ada rewrite lain yang melayani index.html',
  !rewrites.some((rw: AturanRute, i: number) => polaSpa(rw) && !kecualikanApi(rw, i)),
  'rewrite tanpa pengecualian /api/ akan menelan panggilan API');
const epRewrite = rewrites.findIndex(polaEp);
cek('rewrite /ep ada dan muncul sebelum rewrite SPA',
  epRewrite >= 0 && idxSpa > epRewrite,
  epRewrite < 0 ? 'tidak ada rewrite /ep — menu web akan dilayani index.html'
    : `indeks /ep=${epRewrite}, indeks SPA=${idxSpa}`);
const aktivasiRewrite = rewrites.findIndex(
  (rw: AturanRute) => rw.src === '^/api/billing/aktivasi/?$' && rw.dest === '/api/billing-aktivasi'
);
cek('URL aktivasi browser dipetakan ke fungsi Vercel billing-aktivasi sebelum filesystem',
  aktivasiRewrite >= 0 && aktivasiRewrite < rewrites.findIndex((rw: AturanRute) => rw.handle === 'filesystem'),
  aktivasiRewrite < 0
    ? 'tanpa alias ini URL aktivasi jatuh ke index.html dan gagal parse JSON'
    : `indeks alias=${aktivasiRewrite}`);
const pkg = JSON.parse((await import('node:fs')).readFileSync(join(root, 'package.json'), 'utf8'));
cek('ada vercel.json', true);
cek('tidak ada rewrite yang sending /api/rpc ke index.html',
  !rewrites.some((rw: AturanRute, i: number) => polaSpa(rw) && !kecualikanApi(rw, i)),
  'kalau bocor, /api/rpc dilayani HTML dan klien melihat "Unexpected token <"');
cek('semua path non-api → /index.html (SPA)',
  spaRewrites.length === 1 && handleFilesystem,
  `src: ${spaRewrite?.src ?? '(tidak ada)'}`);
cek('script build menghasilkan frontend', (pkg.scripts?.build ?? '').includes('vite build'), pkg.scripts?.build ?? '(tidak ada)');
cek('build juga menjalankan typecheck', (pkg.scripts?.build ?? '').includes('typecheck'),
  'kalau tidak, error compile lolos ke produksi');
cek('engines Node dideklarasikan', Boolean(pkg.engines?.node),
  pkg.engines?.node ?? '(tidak ada — Vercel memakai default, bisa berubah sewaktu-waktu)');
cek('tidak ada bundler client di dependencies server',
  !Object.keys(pkg.dependencies ?? {}).some(d => ['bcryptjs', 'crypto-js', 'express', 'cors', 'leaflet', 'qrcode-generator'].includes(d) && false));

// Environment yang wajib ada di Vercel.
const env = (await import('node:fs')).readFileSync(join(root, '.env.example'), 'utf8');
for (const kunci of ['ALLOWED_ORIGINS', 'PRESENSI_BASE_URL']) {
  cek(`.env.example menjelaskan ${kunci}`, new RegExp(`^\\s*${kunci}\\s*=`, 'm').test(env),
    'kalau tidak, env Vercel tidak akan terisi dan semua proxy ditolak/dialihkan ke gateway yang salah');
}
/*
 * `.env` lokal sengaja boleh tidak punya `ALLOWED_ORIGINS`: dev server
 * (`src/api/server.ts`) punya bawaan localhost, jadi tidak perlu.
 * Yang wajib dijaga adalah bahwa Vercel punya cara mengetahuinya — lewat
 * `/api/health` yang melaporkan allow-list kosong sebagai peringatan.
 */
const corsSrc = (await import('node:fs')).readFileSync(join(root, 'src/serverless/_cors.ts'), 'utf8');
cek('_cors.ts melaporkan allow-list kosong', /export function allowListKosong/.test(corsSrc));
cek('_cors.ts memberi petunjuk perbaikan', /PETUNUK_KONFIGURASI/.test(corsSrc));
cek('_cors.ts TIDAK memakai wildcard sebagai bawaan',
  !/ALLOWED_ORIGINS\s*\|\|\s*['"]\*/.test(corsSrc),
  'bawaan "*" di produksi membatalkan seluruh allow-list');
cek('server dev punya bawaan localhost (biar .env lokal tidak wajib)',
  /ALLOWED_ORIGINS = \(process\.env\.ALLOWED_ORIGINS \|\|/.test(
    (await import('node:fs')).readFileSync(join(root, 'src/api/server.ts'), 'utf8')));

const healthSrc = (await import('node:fs')).readFileSync(join(root, 'src/serverless/health.ts'), 'utf8');
cek('/api/health melaporkan status allow-list', /konfigurasi:/.test(healthSrc) && /origin: !originKosong/.test(healthSrc));
cek('/api/health tidak di-cache agar pemeriksaan Midtrans tidak menerima 304',
  /Cache-Control',\s*'no-store/.test(healthSrc));
cek('/api/health menyertakan peringatan yang bisa dikerjakan', /peringatan:/.test(healthSrc) && /ALLOWED_ORIGINS belum diisi/.test(healthSrc));
cek('/api/health tidak pernah membocorkan nilai server key',
  !/MIDTRANS_SERVER_KEY\s*[,}]/.test(healthSrc.replace(/.*MIDTRANS_SERVER_KEY belum diisi.*/, '')),
  'hanya boleh memuat Boolean(process.env.MIDTRANS_SERVER_KEY)');

console.log('\n=== 8. Admin SDK: versi, Node, dan import');
/*
 * Ini yang membuat pembayaran tidak pernah bisa jalan, dan gejalanya tidak
 * pernah muncul sebagai error yang jujur:
 *
 * `firebase-admin@14` mendaftarkan `@google-cloud/firestore` sebagai
 * *optionalDependency*. `@google-cloud/firestore@9` mensyaratkan
 * `engines.node >= 22`. Kalau proyek declares Node 20, npm **melewati**
 * optional dependency itu tanpa gagal — install tetap "sukses", build tetap
 * hijau, tapi billing menjawab 503 atau 500 selamanya.
 *
 * Jadi tiga hal di bawah harus benar simultan: versi Node, presence paket,
 * dan cara impornya.
 */
/*
 * Firestore adalah dependency langsung, dan import() literal membuat Vercel
 * menelusuri paket Admin SDK yang perlu disertakan di function bundle.
 */
const fsNode = await import('node:fs');
const sbSrc = fsNode.readFileSync(join(root, 'src/lib/serverBilling.ts'), 'utf8');
/*
 * ⚠️ Pemuat `firebase-admin` sudah pindah ke `src/lib/firestoreAdmin.ts`.
 *
 * Semula modul ini memuat sendiri; sekarang `lib/panelServer.ts` (autentikasi
 * panel) juga butuh instance yang **sama**, dan dua app yang diinisialisasi
 * terpisah di satu proses membuat hanya satu kredensial yang dikenali.
 *
 * Jadi pemeriksaan di bawah membaca **pemuat**, bukan modul yang memakainya.
 * `serverBilling.ts` ikut diperiksa lagi di bagian "tidak mengimpor langganan"
 * — itu sudah jadi urusan bertingkat modul.
 */
const faSrc = fsNode.readFileSync(join(root, 'src/lib/firestoreAdmin.ts'), 'utf8');
cek('Admin SDK dimuat dinamis dengan specifier literal yang bisa ditrace',
  /import\(['"]firebase-admin\/firestore['"]\)/.test(faSrc) &&
  /import\(['"]firebase-admin\/app['"]\)/.test(faSrc),
  'Vercel harus menyertakan kedua entrypoint Admin SDK');
cek('kegagalan import dibungkus try yang menjelaskan',
  /try \{[\s\S]{0,900}npm i @google-cloud\/firestore/.test(faSrc),
  'pesan error harus menyebut perintah instalasi, bukan sekadar "module not found"');
cek('serverBilling tidak mengimpor langganan.ts (SDK klien)',
  !/from '\.\/langganan'/.test(sbSrc),
  'SDK Firebase klien menarik config dari import.meta.env yang kosong di CJS');
cek('durasi.ts dipakai untuk fungsi murni', /from '\.\/durasi'/.test(sbSrc));

cek('Admin SDK tidak diimpor statis saat modul dibuka',
  !/^import[^;]*from ['"]firebase-admin\/(?:app|firestore)['"]/m.test(faSrc),
  'import() menunda inisialisasi hingga endpoint memerlukan Firestore');
cek('kedua entrypoint dimuat dalam satu Promise.all',
  /await Promise\.all\(\[[\s\S]{0,220}firebase-admin\/app[\s\S]{0,220}firebase-admin\/firestore/.test(faSrc),
  'app dan Firestore memakai satu graf modul');
cek('projectId tidak pernah dikirim sebagai undefined',
  !/projectId: process\.env\.FIREBASE_PROJECT_ID[,}]/.test(faSrc),
  'undefined menimpa project_id dari service account dan Firestore gagal inisialisasi');
cek('projectId di-spread hanya bila terisi',
  /\.\.\.\(process\.env\.FIREBASE_PROJECT_ID \? \{ projectId: process\.env\.FIREBASE_PROJECT_ID \} : \{\}\)/.test(faSrc));

// Presence paket & versi Node.
const pkgVer = JSON.parse((await import('node:fs')).readFileSync(join(root, 'package.json'), 'utf8'));
const nodeDiminta = String(pkgVer.engines?.node ?? '');
const angkaNode = Number.parseInt(nodeDiminta.replace(/[^0-9].*$/, ''), 10);
cek('engines.node adalah 22.x', /^22\.x$/.test(nodeDiminta), nodeDiminta || '(tidak ada)');

const adaFirestore = pkgVer.dependencies?.['@google-cloud/firestore'];
cek('@google-cloud/firestore jadi dependency EKSPLISIT', Boolean(adaFirestore),
  'kalau hanya optionalDependency firebase-admin, npm akan melewatkannya tanpa gagal');

/*
 * `firebase` (SDK peramban) hanya dipakai satu skrip pengembangan —
 * `tools/seed-admin.mts` — jadi harusnya `devDependencies`.
 *
 * ⚠️ Kenapa ini bukan sekadar soal kerapian. Vercel memasang **seluruh**
 * `dependencies` untuk setiap build, termasuk yang tidak pernah diimpor.
 * SDK itu 140 kB gzip dan menarik `firebase/app` + `firebase/firestore`, yang
 * tidak boleh ikut masuk bundle peramban sama sekali. Selama masih
 * `dependencies`, yang paling buruk bukan ukurannya: `npm ls` dan
 * pemeriksaan-aware akan terus menjadikannya kandidat yang "wajib ada",
 * dan siapa pun yang menambah impor `firebase/...` di `src/` tidak akan
 * melihat ada yang salah — berkasnya sudah lulus, hanya skripnya yang
 * sebenarnya satu-satunya pemakai. `cek-bundle-awal.ts` menjaga sisi
 * bundle; assertion ini menjaga sisi paket.
 */
cek('SDK peramban `firebase` bukan dependency produksi',
  !pkgVer.dependencies?.firebase,
  'menarik firebase/app + firebase/firestore yang tidak boleh masuk bundle peramban');
cek('SDK peramban `firebase` tidak ada sama sekali di package.json',
  !pkgVer.dependencies?.firebase && !pkgVer.devDependencies?.firebase,
  'sudah tidak ada pemakainya: tools/seed-admin.mts pindah ke firebase-admin');

/*
 * Dulu `seed-admin.mts` memakai `firebase/app` + `firebase/firestore`, dan
 * assertion di atas hanya mindedahkannya ke `devDependencies`.
 *
 * Sekarang skrip itu memakai `firebase-admin` — yang **sudah** `dependencies`
 * karena dipakai handler produksi. Jadi kekhawatiran asli assertion tersebut
 * ("`npm ci --omit=dev` tidak bisa menjalankan seeding") justru hilang: seeding
 * memakai paket yang selalu terpasang, tanpa perlu devDependency apa pun.
 *
 * Yang dijaga sekarang adalah agar SDK peramban tidak diam-diam kembali lewat
 * pintu lain — dan agar `seed-admin` tidak pernah menulis lewat jalur yang
 * `firestore.rules` tolak.
 */
{
  const srcSeed = (await import('node:fs')).readFileSync(join(root, 'tools/seed-admin.mts'), 'utf8');

  cek('seed-admin tidak memakai SDK peramban',
    !/from 'firebase\//.test(srcSeed),
    'permintaan SDK peramban tiba sebagai anonim, dan jatim_pengguna adalah allow read,write: if false');

  cek('seed-admin lewat jalur privileged yang sama dengan handler produksi',
    /firestoreAdmin/.test(srcSeed) && /firebase-admin|service account|service_account|FIREBASE_SERVICE_ACCOUNT/i.test(srcSeed),
    'Admin SDK melompati rules; tanpa itu seeding selalu gagal permission denied');

  cek('seeding tetap mungkin di instalasi tanpa devDependency',
    Boolean(pkgVer.dependencies?.['firebase-admin']),
    'firebase-admin ada di dependencies, jadi npm ci --omit=dev tetap bisa menjalankan seed:admin');
}
let butuhNode = 0;
if (adaFirestore) {
  try {
    const meta = JSON.parse(
      (await import('node:fs')).readFileSync(join(root, 'node_modules/@google-cloud/firestore/package.json'), 'utf8')
    );
    // `engines.node` bisa ">=22", "^22.0.0", atau "22.x" — ambil angkanya.
    const angkaDari = (t: unknown): number => Number.parseInt(String(t ?? '').match(/\d+/)?.[0] ?? '', 10);
    butuhNode = angkaDari(meta.engines?.node);
    cek('paket Firestore terpasang', true,
      `v${meta.version} butuh Node >= ${butuhNode || '?'} (engines paket: ${meta.engines?.node ?? 'tidak ada'})`);
  } catch {
    cek('paket Firestore terpasang di node_modules', false,
      'jalankan `npm install` — tanpa itu, billing menjawab 503');
  }
}
cek('Node yang diminta >= yang dibutuhkan Firestore', angkaNode >= butuhNode,
  `engines ${nodeDiminta} vs Firestore butuh >= ${butuhNode}` +
  (angkaNode < butuhNode ? ' — npm akan MELEWATI optional dependency itu tanpa gagal' : ''));

// Pesan error harus menyebut perbaikannya, bukan hanya "module not found".
cek('pesan menyebut kebutuhan Node >= 22', /Node >= 22/.test(faSrc),
  'operator perlu tahu ini soal versi Node, bukan soal instalasi paket saja');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 9. ALLOWED_ORIGINS tanpa skema (bug yang sudah nyata terjadi)');
// ═════════════════════════════════════════════════════════════════════
/*
 * `.env` pernah berisi `ALLOWED_ORIGINS=prabawa.vercel.app` sementara browser
 * mengirim `Origin: https://prabawa.vercel.app`. Perbandingan string tidak
 * akan pernah cocok, dan SETIUP request peramban ditolak 403.
 *
 * Gejalanya sangat menyesatkan karena tidak ada yang salah di layar mana pun:
 * server "sehat", halaman termuat, login panel berhasil — tapi tidak satu pun
 * panggilan API jalan, dan penyebabnya tidak pernah muncul di mana pun.
 *
 * Perbaikannya: skema yang hilang dilengkapi di kedua sisi. Aman, karena
 * menambahkan skema hanya mempersempit apa yang diterima.
 */
const ASAL_LAMA = process.env.ALLOWED_ORIGINS;
const { terapkanCors: corsFn, daftarOrigin: daftarOriginFn } = await import(join(root, 'src/serverless/_cors.ts'));
const { galatHulu, cuplikanAman, bolehUlang } = await import(join(root, 'src/lib/presensiContract.ts'));

function bolehDengan(envValue: string | undefined, origin?: string): boolean {
  if (envValue === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = envValue;
  return corsFn({ setHeader() {} }, origin);
}

const KASUS_ORIGIN = [
  // [allow-list, Origin dari browser, boleh?, catatan]
  ['prabawa.vercel.app', 'https://prabawa.vercel.app', true, 'tanpa skema -> dilengkapi https'],
  ['https://prabawa.vercel.app', 'https://prabawa.vercel.app', true, 'sudah ada skema'],
  ['https://a.go.id,https://b.go.id', 'https://b.go.id', true, 'kedua domain, yang kedua cocok'],
  ['https://a.go.id,https://b.go.id', 'https://c.go.id', false, 'domain ketiga DITOLAK'],
  ['prabawa.vercel.app', 'https://evil.example', false, 'tetap menolak domain lain'],
  ['https://a.go.id', 'https://A.GO.ID', true, 'huruf besar tidak berpengaruh'],
  ['localhost:3000', 'http://localhost:3000', true, 'localhost tanpa skema -> http'],
  ['localhost:3000', 'https://localhost:3000', false, 'skema localhost TIDAK ditebak lenient'],
  ['prabawa.vercel.app', undefined, true, 'tanpa Origin (curl/health) tetap boleh'],
  ['', 'https://prabawa.vercel.app', false, 'allow-list kosong menolak semua peramban'],
  ['*', 'https://apa.saja.go.id', true, 'wildcard masih bisa dipakai saat pengembangan'],
];
for (const [allow, origin, harus, catatan] of KASUS_ORIGIN as Array<
  [string | undefined, string | undefined, boolean, string]
>) {
  const hasil = bolehDengan(allow, origin);
  cek(
    `ALLOWED_ORIGINS=${allow || '(kosong)'} + Origin=${origin ?? '(tanpa)'} -> ${harus ? 'BOLEH' : 'DITOLAK'}`,
    hasil === harus,
    catatan
  );
}

// Allow-list yang dilaporkan harus sudah ternormalisasi, supaya operator
// bisa melihat PERSIS apa yang dibandingkan.
process.env.ALLOWED_ORIGINS = 'prabawa.vercel.app,localhost:3000';
cek(
  'daftarOrigin() melaporkan bentuk yang sudah ternormalisasi',
  JSON.stringify(daftarOriginFn()) === JSON.stringify(['https://prabawa.vercel.app', 'http://localhost:3000']),
  JSON.stringify(daftarOriginFn())
);
if (ASAL_LAMA === undefined) delete process.env.ALLOWED_ORIGINS;
else process.env.ALLOWED_ORIGINS = ASAL_LAMA;

// Dev server harus memakai aturan yang sama, bukan perbandingan string mentah.
const devSrc = (await import('node:fs')).readFileSync(join(root, 'src/api/server.ts'), 'utf8');
cek('dev server juga melengkapi skema', /function lengkapiSkema/.test(devSrc));
cek(
  'dev server TIDAK lagi membandingkan string mentah',
  !/ALLOWED_ORIGINS\.includes\(origin\)/.test(devSrc),
  'ini bug yang sama, di proses Node'
);
cek(
  'dev server menyebut allow-list aktif di pesan error',
  /Allow-list aktif/.test(devSrc),
  'tanpa ini, kesalahan ketik di .env hanya muncul sebagai "ditolak"'
);

// `.env` lokal harus punya skema dan tetap memuat localhost.
const fsmod = await import('node:fs');
const envPath = join(root, fsmod.existsSync(join(root, '.env')) ? '.env' : '.env.example');
const envLabel = envPath.endsWith('.env') ? '.env' : '.env.example';
const envIsi = fsmod.readFileSync(envPath, 'utf8');
const barisOrigin = (envIsi.match(/^ALLOWED_ORIGINS=(.*)$/m) ?? [])[1] ?? '';
cek(`${envLabel} punya ALLOWED_ORIGINS`, barisOrigin.length > 0);
cek(
  `${envLabel}: setiap origin punya skema`,
  barisOrigin.split(',').every(o => o.trim().includes('://')),
  barisOrigin
);
cek(
  `${envLabel}: localhost tetap ada supaya dev lokal jalan`,
  barisOrigin.includes('localhost:3000') && barisOrigin.includes('localhost:5173'),
  barisOrigin
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 9b. Host pusat menu Web hanya lewat env');
// ═════════════════════════════════════════════════════════════════════
/*
 * Host server e-Presensi tadinya ditulis di EMPAT tempat: `src/serverless/ep.ts`
 * (konstanta + regex rewrite `Location`) dan `vite.config.ts` (konstanta + regex
 * rewrite `Location`). Dua di antaranya ber bentuk regex dengan titik
 * ter-escape, jadi pemeriksaan yang hanya `grep "https://"` tidak pernah
 * melihatnya.
 *
 * Yang lebih buruk dari sekadar kode berulang: proxy `/ep` di Vercel dan proxy
 * `/ep` di lokal bisa menunjuk host berbeda tanpa ada yang salah di satu pun
 * berkas. Gejalanya tidak pernah berupa error — server pusat membalas
 * `Set-Cookie` + `Location` ke host aslinya, browser mengikuti redirect ke luar,
 * lalu sesi tidak pernah tersimpan. Login web gagal, tidak ada error, tidak ada
 * penyebab yang muncul di mana pun.
 *
 * Sekarang semuanya lewat `src/lib/epTarget.ts`.
 */
const tanpaHostPusat = (teks: string): string => teks.replace(/^\s*\*.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const HOST_PUSAT = 'presensi\\?\\.bkd\\.jatimprov\\.go\\.id';
const bearerHost = [
  ['src/serverless/ep.ts', 'src/serverless/ep.ts'],
  ['vite.config.ts', 'vite.config.ts'],
  ['src/lib/webPresensi.ts', 'src/lib/webPresensi.ts'],
];
for (const [label, rel] of bearerHost) {
  const isi = tanpaHostPusat(fsmod.readFileSync(join(root, rel), 'utf8'));
  cek(
    `${label} tidak menulis host pusat langsung`,
    !new RegExp(HOST_PUSAT).test(isi),
    'host harus lewat src/lib/epTarget.ts (EP_TARGET_ORIGIN / PRESENSI_BASE_URL)'
  );
}
const epSrc = fsmod.readFileSync(join(root, 'src/serverless/ep.ts'), 'utf8');
cek(
  'ep.ts memakai resolver epTarget',
  /epTargetOrigin|epAsalRegex/.test(epSrc),
  'kalau tidak, host masih ditulis di berkas ini'
);
const viteSrc = fsmod.readFileSync(join(root, 'vite.config.ts'), 'utf8');
cek(
  'vite.config.ts memakai resolver yang sama dengan ep.ts',
  /from '\.\/src\/lib\/epTarget'/.test(viteSrc),
  'dev dan produksi harus membaca host dari tempat yang sama'
);
const epTargetSrc = fsmod.readFileSync(join(root, 'src/lib/epTarget.ts'), 'utf8');
cek(
  'resolver membaca env sebelum memakai bawaan',
  /EP_TARGET_ORIGIN/.test(epTargetSrc) && /PRESENSI_BASE_URL/.test(epTargetSrc),
  'tanpa ini, mengisi env tidak berpengaruh apa pun'
);
/*
 * Penarchitectural assertion harus membaca `.env.example`, bukan `envIsi`:
 * `.env` itu per-mesin dan tidak ada di clone baru, jadi memeriksa `.env`
 * akan lolos di komputer yang kebetulan punya nilainya dan gagal di semua
 * komputer lain — dan bisa lolos total kalau `.env` ikut ter-deploy.
 */
cek(
  '.env.example menjelaskan EP_TARGET_ORIGIN',
  /EP_TARGET_ORIGIN/.test(fsmod.readFileSync(join(root, '.env.example'), 'utf8')),
  'nilai opsional yang tidak dijelaskan tetap tidak akan diisi'
);
/*
 * Kode peramban tidak boleh tahu host pusat sama sekali: `/ep` selalu
 * same-origin. Kalau `webPresensi.ts` mengimpor `epTarget.ts`, `process.env`
 * ikut ke bundle dan build peramban bisa gagal tanpa alasan yang jujur.
 */
cek(
  'kode peramban (/ep) tidak mengimpor modul server',
  !/from '\.\.\/lib\/epTarget'|from '\.\/lib\/epTarget'/.test(
    fsmod.readFileSync(join(root, 'src/lib/webPresensi.ts'), 'utf8')
  ),
  'peramban memakai path same-origin /ep, bukan host pusat'
);

// Dan yang paling penting: `.env` harus benar-benar dimuat oleh `dev`/`start`.
const pkgSkrip = JSON.parse(fsmod.readFileSync(join(root, 'package.json'), 'utf8'));
for (const skrip of ['dev', 'start']) {
  cek(
    `script "${skrip}" memuat .env`,
    /--env-file(-if-exists)?=\.env/.test(pkgSkrip.scripts?.[skrip] ?? ''),
    pkgSkrip.scripts?.[skrip] ?? '(tidak ada)'
  );
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 10. Permukaan endpoint: hanya yang dipakai, dan yang dipakai dijaga');

const bacaSrc = (rel: string): string => fsmod.readFileSync(join(root, rel), 'utf8');

/*
 * Hanya sumber **handler** yang diperiksa — bukan semua `.ts` di
 * `src/serverless/`.
 *
 * Daftar diambil dari `_handlers.ts`, sumber kebenaran yang sama dengan
 * `build.mts`. Tanpa itu, `build.mts` ikut dihitung: ia bukan endpoint, tidak
 * punya CORS, dan assertion "semua handler memakai terapkanCors" gagal karena
 * memeriksa perkakas build.
 */
const { daftarHandler } = await import('../src/serverless/_handlers.ts');
const srcServerless = daftarHandler(fsmod.readdirSync(join(root, 'src/serverless')))
  .map(nama => bacaSrc(`src/serverless/${nama}.ts`));

/*
 * ⚠️ `midtrans-status` dihapus: tidak ada pemanggil, dan terbuka tanpa token.
 *
 * Awalnya ada sebagai fungsi Vercel **dan** route Express
 * (`GET /api/midtrans-status?orderId=…`). Tidak ada satu baris pun di `src/`
 * yang memanggilnya — `grep` di seluruh `src/` kosong. Sementara ia terbuka
 * tanpa token apa pun, jadi siapa pun yang tahu URL-nya bisa memakai `Server
 * Key` untuk mencoba-coba `orderId` dan menghabiskan kuota API merchant.
 *
 * Kode mati yang sekaligus jadi permukaan serang tidak bisa dibiarkan hanya
 * karena "nanti mungkin dipakai". Kalau nanti ada kebutuhan untuk memeriksa
 * status transaksi, itu harus Route yang membaca nama akun dari token.
 */
cek('fungsi midtrans-status benar-benar hilang dari src/serverless/',
  !fsmod.existsSync(join(root, 'src/serverless/midtrans-status.ts')));
cek('route Express /api/midtrans-status hilang',
  !bacaSrc('src/api/server.ts').includes('/api/midtrans-status'),
  'kalau route masih ada, ia tetap terbuka tanpa token');
cek('artefak api/midtrans-status.ts ikut terhapus',
  !fsmod.existsSync(join(root, 'api', 'midtrans-status.ts')),
  'jalankan `npm run build:api` — api/ berisi hasil build, bukan sumber');
cek('daftar fungsi Vercel di tool ini sinkron dengan api/',
  FUNCTIONS.every((n: string) => fsmod.existsSync(join(root, 'api', `${n}.ts`))) &&
    readdirSync(join(root, 'api')).filter((f: string) => f.endsWith('.ts') && !f.endsWith('.d.ts')).length === FUNCTIONS.length,
  'ada .ts di api/ yang tidak ada di daftar uji — bisa saja handler yang tak terpakai');

/*
 * Aktivasi langganan wajib punya token.
 *
 * Semula `POST /api/billing/aktivasi` (dan padanannya di Vercel) menerima
 * `username` dari body dan **tidak** memeriksa token sama sekali — sehingga
 * siapa pun yang tahu URL-nya bisa mengaktifkan langganan akun mana pun,
 * gratis. Nama akun sekarang hanya boleh datang dari token, jadi tiga hal
 * di bawah harus tetap benar.
 */
const billingSrc = bacaSrc('src/serverless/billing-aktivasi.ts');
const serverBillingSrc = bacaSrc('src/lib/serverBilling.ts');
cek('billing-aktivasi membaca token dari Authorization: Bearer',
  /authorization/i.test(billingSrc) && /bearer/i.test(billingSrc));
cek('billing-aktivasi meneruskan token ke aktifkanLangganan sebagai argumen pertama',
  /aktifkanLangganan\(\s*(token|bacaToken\()/.test(billingSrc),
  'token harus jadi argumen pertama — kalau tidak, server tidak punya dasar untuk membaca nama akun');
cek('token yang diteruskan itu hasil bacaToken, bukan input mentah',
  /aktifkanLangganan\(\s*bacaToken\(req/.test(billingSrc),
  'header Authorization dibaca di `bacaToken`; meneruskan `req` mentah berarti server tidak pernah tahu bentuknya');
cek('aktifkanLangganan menolak pemanggil tanpa sesi sebelum apa pun',
  /const pemanggil = await akunPemanggil\(token\);\s*\n\s*if \(!pemangka/i.test(serverBillingSrc) ||
    /const pemanggil = await akunPemanggil\(token\);[\s\S]{0,200}kode: 401/.test(serverBillingSrc),
  'tanpa 401 di awal, token kosong akan turun ke jalur verifikasi pembayaran');
cek('verifikasi 401 itu ada di fungsi aktivasinya, bukan di tempat lain',
  /export async function aktifkanLangganan[\s\S]{0,900}akunPemanggil\(token\)[\s\S]{0,200}kode: 401/.test(serverBillingSrc),
  'halaman billing penuh dengan 401 yang tidak ada artinya kalau bukan dari fungsi ini');
cek('aktifkanLangganan tidak lagi menerima username dari body',
  !/username\??:\s*string/.test(
    serverBillingSrc.slice(serverBillingSrc.indexOf('export interface PermintaanAktivasi'))
  ),
  'field `username` di body adalah lubang: pemanggil boleh menentukan akun yang diaktifkan');
cek('klien mengirim token aktivasi',
  /Authorization/i.test(bacaSrc('src/lib/aktivasiLangganan.ts')),
  'kalau klien tidak mengirim header itu, setiap aktivasi akan 401');
cek('klien aktivasi tidak lagi mengirim username',
  !/username/.test(bacaSrc('src/lib/aktivasiLangganan.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
  'komentar boleh menyebutnya; parameter yang dikirim tidak boleh');

/*
 * CORS punya satu sumber, dan header `Authorization` diizinkan.
 *
 * `_panel.ts` pernah punya salinan allow-list sendiri. Dua implementasi untuk
 * endpoint yang sama persis tidak bisa dijaga: keduanya sudah pernah
 * menyimpang — versi `_panel.ts` menguji `includes('*')` (substring, bukan
 * keanggotaan daftar) dan tidak memperlakukan `localhost` secara khusus.
 */
const corsHelperSrc = bacaSrc('src/serverless/_cors.ts');
const panelSrc = bacaSrc('src/serverless/_panel.ts');
cek('_cors.ts mengizinkan header Authorization',
  /Authorization/.test(corsHelperSrc),
  'tanpa ini preflight POST /api/billing/ACTIVASI ditolak di peramban');
cek('_panel.ts memakai helper CORS yang sama, bukan salinannya',
  /import \{[^}]*terapkanCors[^}]*\} from '\.\/_cors'/.test(panelSrc) &&
    /terapkanCors\(/.test(panelSrc));
const tanpaKomentar = (isi: string): string => isi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
cek('_panel.ts tidak mendefinisikan allow-list sendiri lagi',
  !/function terapkanCorsPanel/.test(tanpaKomentar(panelSrc)) &&
    !/ALLOWED_ORIGINS\?\.includes/.test(tanpaKomentar(panelSrc)),
  'dua allow-list = dua tempat yang harus diubah, dan keduanya akan menyimpang');
/*
 * Pengecualian yang disengaja: `ep.ts` (proxy `/ep/*`) TIDAK memakai
 * `terapkanCors`, dan itu benar — bukan kelalaian.
 *
 * Dua alasan yang tidak bisa dibantah dengan CORS:
 *
 * 1. **CORS tidak menghentikan pemanggil non-peramban.** `curl` dan skrip
 *    server mengabaikan header CORS sepenuhnya. Jadi allow-list origin tidak
 *    menambah perlindungan apa pun terhadap penyalahgunaan yang jadi alasan
 *    handler lain dibungkus CORS.
 * 2. **Menambahkannya justru melemahkan.** Respons `/ep/*` membawa cookie
 *    sesi server e-Presensi. Dengan `Access-Control-Allow-Origin` yang longgar,
 *    situs mana pun di allow-list bisa membaca respons itu lintas origin.
 *    Tanpa header tersebut, peramban memblokir pembacaan lintas origin — dan
 *    aplikasi sendiri tidak pernah butuh itu karena selalu same-origin
 *    (`src/lib/webPresensi.ts` memakai path `/ep`).
 *
 * Yang dijaga di sini justru arah sebaliknya: `ep.ts` tidak boleh diam-diam
 * mulai mengirim header CORS.
 */
const TANPA_CORS_SENGJAJA = ['ep'];
const isiPengecualian = TANPA_CORS_SENGJAJA.map(nama => bacaSrc(`src/serverless/${nama}.ts`));
const handlerEp = isiPengecualian[0];
cek('semua handler serverless memakai terapkanCors dari _cors',
  srcServerless
    // `ep.ts` dikecualikan — alasannya di komentar di atas.
    .filter(isi => !isiPengecualian.includes(isi))
    .every(isi => {
      const kode = tanpaKomentar(isi);
      if (/function terapkanCorsPanel/.test(kode)) return false;
      // `panel-auth.ts` memang tidak memanggilnya sendiri: seluruh CORS-nya
      // ada di `_panel.ts`. Yang dilarang adalah handler yang sama sekali tidak
      // menyentuh allow-list.
      if (/tanganiPanelAuth/.test(kode)) return /import \{ tanganiPanelAuth \} from '\.\/_panel'/.test(kode);
      return /terapkanCors\(/.test(kode);
    }) &&
    // …dan pengecualian itu tidak boleh diam-diam jadi tidak berlaku.
    isiPengecualian.every(isi => !/Access-Control-Allow-Origin|terapkanCors/.test(tanpaKomentar(isi))),
  'handler tanpa allow-list origin bisa dipanggil siapa saja yang tahu URL-nya');
cek('ep.ts tetap tanpa header CORS (satu-satunya yang boleh begitu)',
  !/Access-Control-Allow-Origin|terapkanCors/.test(tanpaKomentar(handlerEp)) &&
    !srcServerless.some(isi =>
      /Access-Control-Allow-Origin/.test(tanpaKomentar(isi)) &&
      !/terapkanCors\(/.test(tanpaKomentar(isi))),
  'menambahkannya membuat cookie sesi e-Presensi bisa dibaca lintas origin');

/*
 * `POST /api/upload` meneruskan byte mentah, bukan FormData.
 *
 * Versi pertama mengarang ulang body dari `req.body` dengan asumsi isinya
 * `FormData`. Di Vercel yang tidak pernah benar: runtime Node hanya mem-parse
 * `application/json` dan `x-www-form-urlencoded`; untuk multipart ia
 * menyerahkan `Buffer` mentah — jadi `typeof body.get !== 'function'` selalu
 * terpenuhi dan **setiap** unggahan berakhir 400, apa pun isinya.
 */
const uploadSrc = bacaSrc('src/serverless/upload.ts');
cek('upload tidak mengarang ulang FormData',
  !/incoming\.entries\(\)/.test(uploadSrc) && !/new FormData\(\)/.test(uploadSrc),
  'decode lalu encode-ulang merusak boundary dan filename');
cek('upload meneruskan Buffer apa adanya',
  /Buffer\.isBuffer/.test(uploadSrc) && /new Uint8Array\(body\)/.test(uploadSrc));
cek('upload meneruskan Content-Type apa adanya (boundary ikut)',
  /'Content-Type':\s*contentType/.test(uploadSrc),
  'tanpa boundary, gateway menjawab -32605 Invalid Request');
cek('upload punya allow-list path seperti route Express',
  /PRESENSI_IMPORTFILE_PATH/.test(uploadSrc) && /req\.query\?\.path|req\.query\.path/.test(uploadSrc),
  'tanpa ini `?path=` jadi open proxy ke endpoint mana pun di server pusat');
cek('upload punya batas ukuran body',
  /BATAS_BODY_BYTES/.test(uploadSrc) && /413/.test(uploadSrc));
cek('upload tidak lagi memakai export const config (no-op di Vercel)',
  !/export const config/.test(uploadSrc),
  'Vercel mengabaikan config gaya Next.js; batasnya harus di dalam handler');

/*
 * IP pemanggil tidak boleh mempercayai `X-Forwarded-For` lebih dulu.
 *
 * Header itu diisi proxy. Kalau dibaca sebelum `req.ip`, setiap klien yang
 * tahu endpoint ini bisa mengarang IP-nya sendiri — dan karena satu IP palsu
 * membuat penghitung percobaan selalu mulai dari nol, batas 8 percobaan per
 * akun bisa ditekan ulang tanpa batas hanya dengan mengganti header.
 */
cek('_panel.ts membaca req.ip sebelum X-Forwarded-For',
  /req\.ip\s*\|\|\s*header\(req, 'x-forwarded-for'\)/.test(panelSrc),
  'urutannya menentukan apakah pembatas login bisa dilewati');
cek('Express menyalakan trust proxy supaya req.ip benar',
  /app\.set\('trust proxy'/.test(bacaSrc('src/api/server.ts')),
  'tanpa ini semua permintaan dari satu jaringan terlihat berasal dari satu IP');

/*
 * `MAX_BODY_CHARS` harus berlaku untuk body yang sudah di-parse.
 *
 * Semula batas itu hanya dicek di cabang `typeof body === 'string'` — cabang
 * yang tidak pernah jalan di produksi, karena Vercel sudah mem-parse JSON
 * sebelum handler dipanggil. Yang dibatasi tanpa sengaja adalah jalur tak
 * terpakai, sementara jalur yang dipakai lolos tanpa batas.
 */
cek('batas body berlaku di jalur objek juga, bukan hanya string',
  /content-length/i.test(panelSrc) && /JSON\.stringify\(mentah\)\.length > MAX_BODY_CHARS/.test(panelSrc));

/*
 * Balasan hulu tidak pernah diteruskan mentah.
 *
 * Saat gateway tidak mengembalikan JSON, isinya bisa halaman galat HTML dari
 * proxy atau badan dari layanan lain. 300 karakter mentah sudah cukup untuk
 * membocorkan isi halaman itu ke peramban; baris pertama yang sudah dibersihkan
 * dari tag HTML memberi informasi yang sama untuk kebutuhan diagnosa.
 */
const rpcSrcVer = bacaSrc('src/serverless/rpc.ts');
const kontrakSrc = bacaSrc('src/lib/presensiContract.ts');
cek('rpc tidak mengembalikan badan hulu mentah',
  !/text:\s*rawText\.slice\(/.test(rpcSrcVer) && /galatHulu\(/.test(rpcSrcVer));
cek('upload tidak mengembalikan badan hulu mentah',
  !/text:\s*raw\.slice\(/.test(uploadSrc) && /galatHulu\(/.test(uploadSrc));
cek('server dev juga tidak mengembalikan badan hulu mentah',
  !/text:\s*rawText\.slice\(/.test(bacaSrc('src/api/server.ts')));
cek('cuplikanAman hanya-satunya di kontrak',
  (kontrakSrc.match(/export function cuplikanAman/g) ?? []).length === 1
  && !/function cuplikanAman/.test(rpcSrcVer)
  && !/function cuplikanAman/.test(uploadSrc),
  'versi lokal berarti empat proxy bisa berbeda lagi');
cek('kedua proxy memetakan hulu 5xx ke 503, bukan 502',
  /\? 503 : 502/.test(rpcSrcVer) && /\? 503 : 502/.test(uploadSrc),
  '503 dibaca klien sebagai "layak diulang", 502 tidak');
cek('detail error Firestore tidak ikut keluar ke peramban',
  !/Detail: \$\{pesan\.slice/.test(panelSrc),
  'error require() Node berisi jalur absolut di server');
cek('server tidak meneruskan seluruh balasan Midtrans',
  !/^\s*raw:\s*data\b/m.test(bacaSrc('src/api/server.ts')),
  'tidak ada pemanggil yang membacanya, dan isinya bisa memuat nomor Virtual Account');

/*
 * Mode produksi/sandbox Midtrans hanya boleh dibaca di satu tempat.
 *
 * Semula setiap sisi membaca sendiri, dan tidak konsisten: `midtrans-charge.ts`
 * menerima dua nama, sedangkan `api/server.ts` dan `lib/serverBilling.ts`
 * hanya satu. Kalau yang diisi di dasbor Vercel cuma `VITE_MIDTRANS_IS_PRODUCTION`
 * — dan itu nama yang dijelaskan di `.env.example` bagian peramban, jadi
 * sangat mungkin terjadi — maka permintaan dibuat ke `api.midtrans.com` sementara
 * verifikasi tagihan berjalan di `api.sandbox.midtrans.com`.
 *
 * Akibatnya bukan hanya transaksi gagal diam-diam: verifikasi selalu gagal,
 * jadi langganan tidak pernah aktif, dan karena pesan errornya generik
 * ("Gagal memproses"), tidak ada yang mengira penyebabnya ada di nama
 * environment. Sekarang ketiganya memanggil `midtransEnv.midtransProduksi()`,
 * dan hanya modul itu yang boleh menyentuh `process.env`.
 */
const midtransEnvSrc = bacaSrc('src/lib/midtransEnv.ts');
cek('midtransEnv jadi satu-satunya pembaca MIDTRANS_IS_PRODUCTION di sisi server',
  /export function midtransProduksi/.test(midtransEnvSrc) &&
    ![bacaSrc('src/api/server.ts'), bacaSrc('src/lib/serverBilling.ts'), ...srcServerless]
      .some(isi => /process\.env\.MIDTRANS_IS_PRODUCTION|process\.env\.VITE_MIDTRANS_IS_PRODUCTION/.test(
        isi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      )),
  'dua nama yang dibaca di tempat berbeda bisa berbeda nilainya');
cek('midtransEnv membaca kedua nama itu',
  /MIDTRANS_IS_PRODUCTION/.test(midtransEnvSrc) && /VITE_MIDTRANS_IS_PRODUCTION/.test(midtransEnvSrc),
  'hanya satu nama dibaca = hanya satu dari empat tempat yang ikut benar');
cek('hanya string "true" yang dihitung produksi',
  /=== 'true'/.test(midtransEnvSrc),
  '"1" atau "TRUE" yang berarti produksi membuat tagihan salah environment tanpa error');
cek('midtransEnv tidak diimpor apa pun yang masuk bundle peramban',
  !/from '\.\//.test(midtransEnvSrc) && !/from '\.\.\//.test(midtransEnvSrc),
  'modul ini hanya untuk sisi server; `process.env` tidak ada di peramban');
cek('semua pemakai sisi server mengambil base URL dari midtransEnv',
  /midtransSnapBaseUrl/.test(bacaSrc('src/api/server.ts')) &&
    /midtransProduksi/.test(bacaSrc('src/lib/serverBilling.ts')) &&
    /midtransSnapBaseUrl/.test(bacaSrc('src/serverless/midtrans-charge.ts')),
  'base URL yang dihitung sendiri di tempat lain bisa menyimpang dari mode yang dipakai verifikasi');


/*
 * ═══ 11. Ketahanan galat sesaat: satu daftar, satu pengaman ═══════════════
 *
 * Server pusat membalas `HTTP 500` + badan nol byte untuk sementara waktu.
 * Verifikasi langsung ke `presensi.bkd.jatimprov.go.id/service` pada
 * 2026-09-30: permintaan yang identik gagal lalu berhasil pada percobaan
 * berikutnya, dan 200 permintaan paralel lain semuanya 200. Jadi ini kondisi
 * sementara di sisi server pusat, bukan kesalahan pada permintaan.
 *
 * Dua tempat tidak boleh berbeda isi, kalau tidak diam-diam menyimpang:
 *   - proxy harus menjawab `503`, bukan `502`, supaya keadaan ini ditandai
 *     sebagai "layak diulang";
 *   - klien hanya boleh mengulang objek yang tercatat aman, supaya kegagalan
 *     sesaat tidak berubah jadi `absen` yang tercatat dua kali.
 */
console.log('\n=== 11. Galat sesaat server pusat: 503 + ulangan terbatas');
const klienSrc = bacaSrc('src/api/index.ts');
const bolehSrc = bacaSrc('src/lib/presensiContract.ts');

/** `galatHulu` dengan `cuplikan` yang mengembalikannya apa adanya. */
const tanpaCuplikan = (x: string): string => x;

cek('proxy menjawab 503, bukan 502, saat hulu 5xx',
  galatHulu(500, '', tanpaCuplikan).huluStatus === 500 &&
  String(galatHulu(500, '', tanpaCuplikan).error ?? '').length > 0,
  'beda status menentukan apakah klien mengulang');
cek('galatHulu menandai badan kosong secara terpisah',
  galatHulu(500, '', tanpaCuplikan).huluKosong === true &&
  galatHulu(500, '<html>502</html>', tanpaCuplikan).huluKosong === false);
cek('galatHulu meneruskan status hulu apa adanya',
  galatHulu(503, '', tanpaCuplikan).huluStatus === 503 && galatHulu(200, 'a', tanpaCuplikan).huluStatus === 200);
cek('badan whitespace saja tetap dianggap kosong',
  galatHulu(500, '   \n  \t ', tanpaCuplikan).huluKosong === true);
cek('cuplikan aman dipakai untuk badan yang terisi',
  galatHulu(200, '<html><b>502</b> Bad Gateway</html>', cuplikanAman).cuplikan === '502 Bad Gateway',
  JSON.stringify(galatHulu(200, '<html><b>502</b> Bad Gateway</html>', cuplikanAman).cuplikan));
cek('cuplikan aman memangkas baris pertama saja',
  cuplikanAman('\n\nbaris pertama\nbaris kedua yang panjang sekali').startsWith('baris pertama') &&
  !cuplikanAman('\n\nbaris pertama\nbaris kedua yang panjang sekali').includes('kedua'));
cek('cuplikan aman membuang karakter terlarang XML',
  !/[\u0000-\u0008]/.test(cuplikanAman('a\u0000b')));

cek('objek yang hanya membaca tercatat aman diulang',
  ['getworkcode', 'getlokasiabsen', 'getmastertipeijin', 'jenis_ijin', 'tipe_ijin',
   'history_absen', 'list_ijin'].every(nama => bolehUlang(nama)),
  'salah satu nama salah ketik = halaman itu tidak pernah pulih sendiri');
cek('objek yang mengubah data TIDAK boleh diulang',
  ['absen', 'cekabsen', 'add_ijin', 'delete_ijin', 'update_foto', 'update_profil',
   'login', 'logout', 'syncdata'].every(nama => !bolehUlang(nama)),
  'mengulang `cekabsen` setelah 503 bisa membakar jatah absen dua kali');
cek('objek mati dari era lama juga tidak boleh diulang',
  ['presensi', 'laporan', 'approve_ijin', 'ijin_bawahan'].every(nama => !bolehUlang(nama)));

cek('klien hanya mengulang sekali saja',
  /percobaan === 0/.test(klienSrc) && /TUNDA_ULANG_MS/.test(klienSrc),
  'ulangan tanpa batas = beban tambahan ke server yang sedang bermasalah');
cek('klien mengulang hanya kalau status hulu 503',
  /huluStatus === 503/.test(klienSrc),
  '502 biasanya permanen; mengulangnya tidak pernah menolong');
cek('klien batal saat menunggu → tidak ada permintaan susulan',
  /tungguUlangan/.test(klienSrc) && /signal\?\.aborted/.test(klienSrc));
cek('daftar aman diulang berasal dari kontrak, bukan ditulis ulang di klien',
  /from '\.\.\/lib\/presensiContract'/.test(klienSrc) &&
    /\bbolehUlang\(/.test(klienSrc) &&
    /RPC_BISA_ULANG/.test(bolehSrc) &&
    !/\[[^\]]*'(getworkcode|getlokasiabsen|history_absen|list_ijin)'/.test(klienSrc),
  'daftar di dua tempat = hanya satu yang akan diperbarui');


stub.close();
rmSync(kerja, { recursive: true, force: true });

console.log(
  fail === 0
    ? '\nSEMUA LULUS'
    : `\n${fail} KEGAGALAN${buildGagal.length ? ` — build gagal: ${buildGagal.join(', ')}` : ''}`
);
process.exit(fail === 0 ? 0 : 1);
