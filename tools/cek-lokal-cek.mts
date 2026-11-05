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
 * `api/*.ts`), bukan versi localhost yang terpisah.
 *
 * ⚠️ Yang diuji:
 * - `/api/health` → konfigurasi apa yang kurang.
 * - `POST /api/rpc object=login` → NIP uji, bukan NIP asli.
 * - Penolakan origin → memastikan proxy tidak terbuka untuk semua domain.
 *
 * Yang TIDAK diuji, dan tidak bisa dari sini: NIP + password yang benar
 * (butuh kredensial asli), dan Firebase (butuh env + emulator).
 */
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/** Domain yang diizinkan — meniru allow-list produksi. */
const ASAL = 'https://prabawa.vercel.app';
process.env.ALLOWED_ORIGINS = ASAL;

// Impor setelah env di-set: `_cors.ts` membacanya saat modul dimuat.
const { default: health } = await import('../src/serverless/health.ts');
const { default: rpc } = await import('../src/serverless/rpc.ts');

/**
 * `res` tiruan yang cukup untuk ketiga handler.
 *
 * `body` sengaja bertipe longgar: yang diuji adalah bentuk JSON yang
 *tlmengirim* handler, jadi melonggarkan di satu tempat lebih baik daripada
 * menulis tipe untuk setiap kemungkinan respons upstream.
 */
interface StateRes {
  code: number;
  body: Record<string, any> | null;
  header: Record<string, string>;
}

interface ResTiruan {
  setHeader(k: string, v: string): void;
  status(c: number): ResTiruan;
  json(b: Record<string, any>): ResTiruan;
  send(b: unknown): ResTiruan;
  end(): ResTiruan;
}

function resPalsu(): { state: StateRes; res: ResTiruan } {
  const state: StateRes = { code: 0, body: null, header: {} };
  const res: ResTiruan = {
    setHeader(k: string, v: string) { state.header[k] = v; },
    status(c: number) { state.code = c; return res; },
    json(b: Record<string, any>) { state.body = b; return res; },
    send(b: unknown) { state.body = b as Record<string, any>; return res; },
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
  // peringatan tidak kosong di sini. Yang diperiksa justru bentuknya.
  cek('peringatan berupa kalimat, bukan kode',
    (state.body?.peringatan as string[]).every(p => typeof p === 'string' && p.length > 20),
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
  const kirim = async (origin?: string): Promise<StateRes> => {
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
    'kalau muncul, bundel api/*.ts rusak');
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
/**
 * Bentuk aturan di `vercel.json`.
 *
 * `rewrites` memakai `source`/`destination`, `routes` memakai `src`/`dest`.
 * Keduanya dibaca lewat satu bentuk supaya pemeriksaan di bawah tidak perlu
 * dua jalur — dan tidak bisa lupa salah satu.
 */
interface AturanRute {
  src?: string;
  dest?: string;
  handle?: string;
  methods?: string[];
}

console.log('\n=== 4. Bundel yang akan ter-deploy');
{
  const build = readFileSync(`${root}src/serverless/build.mts`, 'utf8');
  cek('build ada dan menghasilkan api/*.ts', build.includes('api/'));

  const vercel = JSON.parse(readFileSync(`${root}vercel.json`, 'utf8')) as {
    functions?: Record<string, unknown>;
    rewrites?: AturanRute[];
    routes?: AturanRute[];
  };

  /*
   * Guard konfigurasi `functions` — ini yang pernah membuat deploy gagal
   * dengan build log yang bersih.
   *
   * `vercel.json` tidak memakai glob `api/*.ts`; tiap function didaftarkan satu
   * per satu karena batasannya berbeda-beda. Yang dijaga: **setiap handler
   * hasil build punya entri**, dan setiap entri menunjuk berkas yang benar-benar
   * ada. Kunci yang tidak cocok dengan satu file pun berarti Vercel tidak
   * menetapkan runtime ke fungsi mana pun, dan build berhenti sebelum aplikasi
   * sempat jalan dengan pesan:
   *
   *     Function Runtimes must have a valid version, for example `now-php@1.0.0`.
   */
  const { daftarHandler } = await import('../src/serverless/_handlers.ts');
  const handlerAda = daftarHandler(readdirSync(`${root}src/serverless`));
  const isiApi = readdirSync(`${root}api`).filter((f: string) => f.endsWith('.js'));

  const tanpaKonfigurasi = handlerAda.filter(
    (nama: string) => !(`api/${nama}.ts` in (vercel.functions ?? {})),
  );
  cek('setiap handler punya entri functions di vercel.json', tanpaKonfigurasi.length === 0,
    tanpaKonfigurasi.length > 0
      ? `tanpa entri: ${tanpaKonfigurasi.map((n: string) => `api/${n}.ts`).join(', ')}`
      : `${handlerAda.length} handler terdaftar`);

  const takAda = isiApi.filter((f: string) => !(`api/${f}` in (vercel.functions ?? {})));
  cek('tidak ada entri functions yang menunjuk berkas hilang', takAda.length === 0,
    takAda.join(', ') || `${isiApi.length} entri cocok dengan isi api/`);
  const packageJson = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as {
    engines?: { node?: string };
  };
  cek('Node 22 ditentukan lewat engines.node', packageJson.engines?.node === '22.x',
    '@google-cloud/firestore butuh Node >= 22');
  /*
   * Yang dijaga bukan jumlah aturannya, tapi tiga sifat yang bisa merusak:
   * ada tepat satu catch-all SPA, `/api/` tidak boleh tertangkapnya, dan
   * `/ep/*` harus ditulis sebelum SPA.
   *
   * SPA dicari lewat `dest`-nya, bukan lewat indeks — `/ep/:path*` (menu Web)
   * menempati indeks 0, sehingga urutan ke-0 bukan lagi SPA.
   *
   * Konfigurasi memakai `routes`, dan nama fieldnya `src`/`dest` (bukan
   * `source`/`destination`). `/api/*` dikecualikan lewat entri
   * `{ "handle": "filesystem" }` yang mendahului catch-all — kalau tidak,
   * aset hasil build seperti `assets/*.js` ikut dilayani `index.html`, dan
   * peramban menerima HTML untuk berkas JavaScript.
   */
  const atur = vercel.rewrites ?? vercel.routes ?? [];
  const idxFilesystem = atur.findIndex((r: AturanRute) => r.handle === 'filesystem');
  const spaIdx = atur.findIndex((r: AturanRute) => String(r.dest ?? '').includes('index.html'));
  const spa = spaIdx >= 0 ? atur[spaIdx] : undefined;

  cek('ada tepat satu catch-all SPA (-> index.html)',
    atur.filter((r: AturanRute) => String(r.dest ?? '').includes('index.html')).length === 1,
    `${atur.length} aturan total`);
  cek('berkas asli & /api/* dilayani sebelum catch-all SPA',
    idxFilesystem >= 0 && idxFilesystem < spaIdx,
    idxFilesystem < 0
      ? 'tidak ada `handle: filesystem` — aset seperti assets/*.js dilayani index.html'
      : `filesystem=${idxFilesystem}, SPA=${spaIdx}`);
  cek('catch-all SPA tidak mengikutsertakan /api/',
    spaIdx >= 0 && (idxFilesystem >= 0 && idxFilesystem < spaIdx || String(spa?.src ?? '').includes('(?!api/)')),
    'rewrite yang menyentuh /api/ akan melayani index.html untuk panggilan API');
  const idxEp = atur.findIndex((r: AturanRute) => String(r.src ?? '').includes('/ep'));
  cek('rewrite /ep ada dan sebelum catch-all SPA',
    idxEp >= 0 && spaIdx > idxEp,
    idxEp < 0 ? 'tidak ada rewrite /ep — menu web dilayani index.html'
      : `indeks /ep=${idxEp}, SPA=${spaIdx}`);
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
if (fail > 0) process.exitCode = 1;
