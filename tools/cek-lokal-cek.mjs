/**
 * Jalankan alur login, sebagaimana pengguna menemukannya, tanpa browser.
 *
 * `npm test` sudah memeriksa setiap fungsi secara terpisah. Yang belum pernah
 * diperiksa adalah apakah semua bagian itu benar-benar bekerja **berurutan**:
 * halaman termuat → cek health → tekan login → proxy → gateway →
 * token kembali → sesi tersimpan.
 *
 * Itu yang di sini. Sesi ini memanggil handler yang sama dengan yang
 * ter-deploy di Vercel (`src/serverless/*.ts`, yang di-build jadi
 * `api/*.js`), bukan versi localhost yang terpisah.
 *
 * ⚠️ Yang diuji:
 * - `/api/health` → konfigurasi apa yang kurang.
 * - `POST /api/rpc object=login` → NIP uji, bukan NIP asli.
 * - Penolakan origin → memastikan proxy tidak terbuka untuk semua domain.
 *
 * Yang TIDAK diuji, dan tidak bisa dari sini: NIP + password yang benar
 * (butuh kredensial asli), dan Firebase (butuh env + emulator).
 */
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/** Domain yang diizinkan — meniru allow-list produksi. */
const ASAL = 'https://prabawa.vercel.app';
process.env.ALLOWED_ORIGINS = ASAL;

// Impor setelah env di-set: `_cors.ts` membacanya saat modul dimuat.
const { default: health } = await import('../src/serverless/health.ts');
const { default: rpc } = await import('../src/serverless/rpc.ts');

/** `res` tiruan yang cukup untuk ketiga handler. */
function resPalsu() {
  const state = { code: 0, body: null, header: {} };
  const res = {
    setHeader(k, v) { state.header[k] = v; },
    status(c) { state.code = c; return res; },
    json(b) { state.body = b; return res; },
    send(b) { state.body = b; return res; },
    end() { return res; },
  };
  return { state, res };
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1. /api/health melaporkan konfigurasi');
{
  const { state, res } = resPalsu();
  await health({ method: 'GET', headers: { origin: ASAL } }, res);

  cek('health menjawab 200', state.code === 200, `status ${state.code}`);
  cek('ok = true', state.body?.ok === true);
  cek('lapisan konfigurasi ada', Boolean(state.body?.konfigurasi),
    'tanpa ini, env yang lupa diisi hanya muncul sebagai 403 di browser');
  cek('origin dilaporkan sudah ternormalisasi',
    state.body?.origin?.diizinkan?.includes(ASAL) === true,
    'operator harus melihat PERSIS apa yang dibandingkan dengan Origin');
  cek('versi envelope >= 81', Number(state.body?.version) >= 81,
    `versi ${state.body?.version} — di bawah 81 server menolak absen`);
  cek('peringatan berupa array', Array.isArray(state.body?.peringatan));

  // Skrip ini sengaja tidak memerlukan env Midtrans/Firebase, jadi
  // peringatan tidak kosong di sini. Yang diperiksa justrubentuknya.
  cek('peringatan berupa kalimat, bukan kode',
    state.body.peringatan.every(p => typeof p === 'string' && p.length > 20),
    'kalau hanya kode, operator tidak tahu harus mengisi apa');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. /api/rpc menolak origin luar (sebelum menyentuh gateway)');
{
  const { state, res } = resPalsu();
  await rpc({
    method: 'POST',
    headers: { origin: 'https://evil.example.com' },
    body: { object: 'login', param: {} },
  }, res);

  cek('origin asing ditolak 403', state.code === 403, `status ${state.code}`);
  cek('tidak ada Access-Control-Allow-Origin',
    state.header['Access-Control-Allow-Origin'] === undefined,
    'kalau ada, browser akan membocorkan respons ke domain asing');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Login benar-benar melewati gateway');
{
  const NIP_UJI = '198501012015011001'; // format benar, tidak terdaftar
  const kirim = async (origin) => {
    const { state, res } = resPalsu();
    await rpc({
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: {
        jsonrpc: '2',
        method: 'POST',
        version: 89,
        object: 'login',
        param: { email: NIP_UJI, password: 'ini-bukan-password-asli', latlong: '0,0', imei: '' },
      },
    }, res);
    return state;
  };

  const sah = await kirim(ASAL);
  cek('origin sah tidak ditolak', sah.code !== 403, `status ${sah.code}`);
  cek('balasan adalah JSON-RPC', sah.body?.jsonrpc === 2,
    `dapat: ${JSON.stringify(sah.body).slice(0, 80)}`);
  cek('envelopenya dari gateway, bukan dari Vercel',
    typeof sah.body?.id_req === 'string' && sah.body.id_req.length > 0,
    'id_req hanya diisi gateway — kalau kosong, request tidak pernah sampai');
  cek('gateway menjawab, bukan error Vercel',
    !/FUNCTION_INVOCATION_FAILED|This page is unavailable/i.test(JSON.stringify(sah.body)),
    'kalau muncul, bundel api/*.js rusak');
  cek('NIP uji ditolak gateway (jalur sehat)',
    sah.body?.error?.code === 401 || sah.body?.error?.message === 'Invalid Nip',
    `dapat: ${JSON.stringify(sah.body?.error)}`);
  cek('tanpa api_key — benar, NIP memang tidak terdaftar',
    !sah.body?.result?.api_key);

  const tanpaOrigin = await kirim(undefined);
  cek('tanpa Origin tetap boleh (curl / health check)',
    tanpaOrigin.code === 200,
    'request tanpa Origin tidak bisa cross-origin lewat JavaScript');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Bundel yang akan ter-deploy');
{
  const build = readFileSync(`${root}src/serverless/build.mjs`, 'utf8');
  cek('build ada dan menghasilkan api/*.js', build.includes('api/'));

  // Guard yang menjaga glob `functions` di vercel.json — ini yang pernah
  // membuat deploy gagal dengan build log yang bersih.
  const vercel = JSON.parse(readFileSync(`${root}vercel.json`, 'utf8'));
  cek('glob functions = api/*.js', Boolean(vercel.functions?.['api/*.js']),
    `yang ada: ${Object.keys(vercel.functions ?? {}).join(', ')}`);
  const packageJson = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
  cek('Node 22 ditentukan lewat engines.node', packageJson.engines?.node === '22.x',
    '@google-cloud/firestore butuh Node >= 22');
  /*
   * Yang dijaga bukan jumlah rewrite, tapi dua sifat yang bisa merusak:
   * `/api/` tidak boleh tertangkap rewrite SPA, dan `/ep/*` harus ditulis
   * sebelum SPA. Dicari lewat `destination`, bukan lewat indeks — karena
   * `/ep/:path*` (menu Web) menempati indeks 0, sehingga `rewrites[0]`
   * bukan lagi SPA. Assertion lama salah baca di situ dan melaporkan SPA
   * tidak mengecualikan `/api/` padahal sebenarnya benar.
   */
  const rewrites = vercel.rewrites ?? [];
  const spa = rewrites.find(rw => String(rw.destination).includes('index.html'));
  cek('ada tepat satu rewrite SPA', Boolean(spa) &&
    rewrites.filter(rw => String(rw.destination).includes('index.html')).length === 1,
    `${rewrites.length} rewrite total`);
  cek('rewrite SPA mengecualikan /api/',
    String(spa?.source ?? '').includes('(?!api/)'),
    'rewrite yang menyentuh /api/ akan melayani index.html untuk panggilan API');
  const idxEp = rewrites.findIndex(rw => String(rw.source).startsWith('/ep/'));
  cek('rewrite /ep ada dan sebelum rewrite SPA',
    idxEp >= 0 && rewrites.indexOf(spa) > idxEp,
    idxEp < 0 ? 'tidak ada rewrite /ep — menu web dilayani index.html'
      : `indeks /ep=${idxEp}, SPA=${rewrites.indexOf(spa)}`);
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
if (fail > 0) process.exitCode = 1;
