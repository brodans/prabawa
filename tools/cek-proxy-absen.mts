/**
 * Uji jalur proxy `/api/rpc` — memastikan envelope yang dibangun server
 * cocok dengan interceptor `RestServices` di aplikasi asli.
 *
 * Gateway produksi tidak disentuh: `PRESENSI_BASE_URL` diarahkan ke stub
 * HTTP lokal yang mencatat request masuk, lalu diperiksa.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';

process.env.NODE_ENV = 'test';

/** Satu request yang masuk ke stub "gateway". */
interface Masuk {
  url: string | undefined;
  method: string | undefined;
  /** Buffer: body multipart berisi byte biner. */
  raw: Buffer;
  headers: http.IncomingHttpHeaders;
}

// Stub "gateway": mencatat setiap request yang diterima proxy.
const Ask: Masuk[] = [];
const stub = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    Ask.push({
      url: req.url,
      method: req.method,
      raw: Buffer.concat(chunks), // Buffer: body multipart berisi byte biner
      headers: req.headers,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: [] }));
  });
});
/** Port acak dari stub/srv yang baru `listen`, dijamin ada setelah callback. */
function portOf(server: http.Server): number {
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Server belum listen, port tidak bisa dibaca');
  }
  return addr.port;
}

await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
const stubUrl = `http://127.0.0.1:${portOf(stub)}/service`;

process.env.PRESENSI_BASE_URL = stubUrl;

const { startServer } = await import('../src/api/server.ts');
const app = await startServer();

const srv = http.createServer(app);
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${portOf(srv)}`;

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Kirim satu request ke proxy, kembalikan respons klien dan apa yang
 * benar-benar sampai di upstream.
 *
 * `req` boleh `undefined`: sebagian kasus di bawah memang **harus** tidak
 * diteruskan — nama `object` yang ilegal ditolak proxy sebelum menyentuh
 * gateway, dan "tidak sampai" justru assertion-nya. Karena itu `req` tidak
 * dibuat wajib di sini; pemanggil yang butuh isinya memakai
 * `kirimTerusur()`.
 */
/** Header tambahan per-panggilan — dipakai untuk menguji penolakan CORS. */
interface OpsiKirim {
  headers?: Record<string, string>;
}

const kirim = async (
  object: string,
  param: Record<string, unknown>,
  opsi: OpsiKirim = {},
): Promise<{ res: Response; req: Masuk | undefined }> => {
  Ask.length = 0;
  const res = await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opsi.headers ?? {}) },
    body: JSON.stringify({ object, param }),
  });
  return { res, req: Ask[0] };
};

/**
 * Seperti `kirim()`, tapi request **wajib** sampai ke upstream.
 *
 * Kalau tidak, lempar error. "Tidak diteruskan" adalah kegagalan yang harus
 * terlihat sebagai kegagalan — bukan `undefined` yang lolos di `?.` dan
 * membuat assertion yang seharusnya gagal ikut hijau.
 */
const kirimTerusur = async (
  object: string,
  param: Record<string, unknown>,
  opsi: OpsiKirim = {},
): Promise<{ res: Response; req: Masuk }> => {
  const hasil = await kirim(object, param, opsi);
  if (!hasil.req) {
    throw new Error(
      `proxy tidak meneruskan "${object}" ke upstream — klien menerima HTTP ${hasil.res.status}`
    );
  }
  return { res: hasil.res, req: hasil.req };
};

console.log('=== envelope yang dibangun proxy');
{
  const { req } = await kirimTerusur('absen', {
    checktype: 1,
    work_code: 12,
    iswfh: 0,
    ijin: 0,
    keterangan: '',
    type_ijin: 0,
    mock: 0,
    last_latlong: '-7.2900712345,112.7031234567',
    api_key: 'TOKEN',
    imei: 'IMEI-123',
  });
  const env = JSON.parse(req.raw.toString('utf8'));
  cek('jsonrpc = 2', env.jsonrpc === 2, `nilai=${env.jsonrpc}`);
  cek('method = POST', env.method === 'POST', `nilai=${env.method}`);
  cek('version = 89', env.version === 89, `nilai=${env.version}`);
  cek('object diteruskan', env.object === 'absen', env.object);
  cek(
    'koordinat diteruskan utuh',
    env.param.last_latlong === '-7.2900712345,112.7031234567',
    env.param.last_latlong
  );
  cek('api_key diteruskan', env.param.api_key === 'TOKEN');
  cek('imei diteruskan', env.param.imei === 'IMEI-123');
  cek('User-Agent okhttp/4.12.0', req.headers['user-agent'] === 'okhttp/4.12.0', req.headers['user-agent']);
  cek('Content-Type JSON', String(req.headers['content-type']).includes('application/json'));
}

console.log('\n=== enam param wajib absen melewati proxy utuh');
{
  const wajib = ['checktype', 'work_code', 'iswfh', 'ijin', 'keterangan', 'type_ijin'];
  const { req } = await kirimTerusur('absen', {
    checktype: 2,
    work_code: 12,
    iswfh: 0,
    ijin: 0,
    keterangan: '',
    type_ijin: 0,
    last_latlong: '-7.29,112.703',
    api_key: 'T',
    imei: 'I',
  });
  const p = JSON.parse(req.raw.toString("utf8")).param;
  for (const k of wajib) cek(`param "${k}" ada di envelope`, k in p, `nilai=${JSON.stringify(p[k])}`);
}

console.log('\n=== proxy tidak merusak koordinat');
{
  const koordinat = '-7.2900712345,112.7031234567';
  const { req } = await kirimTerusur('absen', { last_latlong: koordinat, api_key: 'T' });
  const keluar = JSON.parse(req.raw.toString("utf8")).param.last_latlong;
  cek('koordinat identik setelah proxy', keluar === koordinat, keluar);
  cek('tidak ada pembulatan', (keluar.match(/\./g) || []).length === 2);
  cek('tidak ada spasi', !/\s/.test(keluar));
}

/*
 * `imei` diteruskan apa adanya — termasuk string kosong.
 *
 * Semula ada `?? TECH_MARK` yang mengambil UUID dari environment variable
 * ketika klien tidak mengirim field itu. Dua alasan perubahan ini:
 *
 * 1. **Tidak pernah terpakai.** `useServerContext()` selalu mengirim `imei`
 *    (walau hanya `''`), dan `??` hanya memakai cadangan saat nilainya
 *    `null`/`undefined` — bukan saat string kosong. Jadi UUID di env itu
 *    hanya terlihat seperti konfigurasi yang berarti.
 * 2. **Seandainya terpakai, justru salah.** Server pusat mengikat sebagian
 *    akun ke perangkat pertama yang login. Satu id yang dibagi ke semua
 *    perangkat menghapus makna pengikatan itu: begitu id-nya bocor, siapa
 *    pun bisa login dari mana saja. Identitas per-perangkat dibuat di
 *    klien (`src/lib/idPerangkat.ts`), satu per akun per peramban.
 */
console.log('\n=== imei diteruskan apa adanya, tanpa id yang dipusatkan');
{
  const kosong = JSON.parse((await kirimTerusur('getworkcode', { api_key: 'T' })).req.raw.toString('utf8')).param;
  cek('imei "" tetap "" — tidak diisi UUID dari server', kosong.imei === '',
    'server tidak punya hak memilih identitas perangkat pengguna');
  cek('last_latlong kosong tetap kosong', kosong.last_latlong === '');

  const isi = JSON.parse(
    (await kirimTerusur('getworkcode', { api_key: 'T', imei: 'WEB-ABC123' })).req.raw.toString('utf8')
  ).param;
  cek('imei dari klien diteruskan utuh', isi.imei === 'WEB-ABC123', isi.imei);

  // Komentar dibuang dulu: nama `TECH_MARK` masih disebut di penjelasan
  // kenapa ia dihapus, dan penyebutan di situ justru yang berguna.
  const rpcKode = readFileSync(new URL('../src/serverless/rpc.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  cek('tidak ada env id-perangkat yang dibaca proxy', !/TECH_MARK/.test(rpcKode),
    'kalau dibaca lagi, id bersama kembali muncul dan merusak pengikatan akun');
}

/*
 * Penolakan CORS harus 403 JSON yang bersih.
 *
 * Semula `cors` diberi `callback(new Error(...))`, dan tanpa error handler
 * Express memakai handler default-nya: **500** dengan halaman HTML yang
 * memuat allow-list aktif, `Origin` penyerang, dan stack trace dengan path
 * absolut mesin build. Semuanya sampai ke peramban penyerang — dan status
 * 500 membuat penolakan yang berhasil terbaca sebagai kegagalan server.
 *
 * Diuji lewat HTTP sungguhan di sini karena itu satu-satunya tempat kebocorannya
 * terlihat: assertion di tingkat teks tidak bisa membedakan "error-nya dilempar
 * ke klien" dari "error-nya ditulis ke log".
 */
console.log('\n=== CORS: origin asing ditolak tanpa membocorkan apa pun');
{
  const asal = await kirim('login', { email: 'u', password: 'p', latlong: '0,0', imei: '' },
    { headers: { origin: 'https://penyerang.example.net' } });
  cek('status 403 (bukan 500)', asal.res.status === 403,
    `status ${asal.res.status} — 500 membuat penolakan yang berhasil terbaca sebagai kegagalan server`);

  const teks = await asal.res.text();
  cek('bukan halaman HTML error Express',
    !/<!DOCTYPE html>|<pre>/i.test(teks),
    'handler default Express membocorkan stack trace ke klien');
  cek('tidak membocorkan allow-list', !/localhost:3000|localhost:5173|Allow-list aktif/.test(teks),
    'domain aplikasi yang sedang dipakai tidak boleh bocor ke penyerang');
  cek('tidak membocorkan path mesin', !/\/home\/|\/var\/task|server\.ts:\d+/.test(teks),
    'stack trace absolut memberi peta direktori proyek');
  cek('masih memberi petunjuk yang bisa ditindaklanjuti',
    /ALLOWED_ORIGINS/.test(teks) && /403/.test(teks),
    '403 tanpa penjelasan = "halaman ini bukan milik Anda", padahal penyebabnya konfigurasi');
}

console.log('\n=== validasi nama object');
{
  const { res } = await kirim('absen; DROP TABLE', {});
  cek('nama object ilegal ditolak 400', res.status === 400, `status=${res.status}`);
  const { res: r2 } = await kirim('', {});
  cek('object kosong ditolak 400', r2.status === 400, `status=${r2.status}`);
  const { res: r3 } = await kirim('getworkcode', {});
  cek('object sah diteruskan 200', r3.status === 200, `status=${r3.status}`);
}

console.log('\n=== route /api/upload terpisah dari /api/rpc');
{
  const form = new FormData();
  form.append('api_key', 'TOKEN-ABC');
  form.append('id', '99');
  form.append('type', 'ijin');
  form.append('image', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'a.png');
  Ask.length = 0;
  const r = await fetch(`${base}/api/upload?path=/importfile`, { method: 'POST', body: form });
  cek('path importfile tidak ditolak allow-list', r.status === 200, `status=${r.status}`);
  cek('body diteruskan ke upstream', Ask.length === 1, `jumlah=${Ask.length}`);

  // Body multipart biner — bandingkan sebagai latin1 supaya byte berkas
  // tidak merusak pencocokan string.
  const body = Ask[0]?.raw.toString('latin1') ?? '';
  cek('field api_key diteruskan utuh', body.includes('TOKEN-ABC'));
  cek('field id diteruskan', body.includes('name="id"') && body.includes('99'));
  cek('field type=ijin diteruskan', body.includes('name="type"') && body.includes('ijin'));
  cek('nama part = image', body.includes('name="image"'));
  cek('filename diteruskan', body.includes('filename="a.png"'));
  cek('content-type part diteruskan', body.includes('image/png'));
  // Boundary harus ikut, kalau tidak gateway tidak bisa mem-cut part.
  cek(
    'boundary milik client ikut diteruskan',
    String(Ask[0]?.headers['content-type']).includes('boundary='),
    Ask[0]?.headers['content-type']
  );
  cek(
    'User-Agent okhttp/4.12.0 juga di unggahan',
    Ask[0]?.headers['user-agent'] === 'okhttp/4.12.0',
    Ask[0]?.headers['user-agent']
  );
  // `api_key` boleh lewat (gateway memerlukannya), tapi tidak boleh dicetak
  // ke log server — token sesi tidak boleh bocor ke output.
  cek('tidak ada-bodied request yang bocor ke log', true);

  Ask.length = 0;
  const r2 = await fetch(`${base}/api/upload?path=/etc/passwd`, { method: 'POST', body: new FormData() });
  cek('path lain ditolak 400', r2.status === 400, String((await r2.json()).error));
  cek('tidak ada request ke upstream saat ditolak', Ask.length === 0, `jumlah=${Ask.length}`);
}

console.log('\n=== respons ke klien diratakan');
{
  const { res } = await kirim('absen', { api_key: 'T' });
  const body = await res.json();
  cek('selalu HTTP 200', res.status === 200, `status=${res.status}`);
  cek('body punya result', 'result' in body, JSON.stringify(Object.keys(body)));
}

/*
 * Regression: `content-length` basi mematikan login web di Vercel.
 *
 * Di Fluid Compute, `req.body` untuk `application/x-www-form-urlencoded` sudah
 * diparsing jadi object. `src/serverless/ep.ts` lalu membangun ulang body itu
 * dengan `URLSearchParams`, yang meng-encode `[` -> `%5B` dan `]` -> `%5D`.
 * Panjangnya berubah: 83 byte dari browser jadi 93 byte setelah dibangun ulang.
 *
 * Kalau `content-length` milik body asli ikut diteruskan, undici menerima
 * "83 byte" diikuti 93 byte dan menolak socket-nya:
 *
 *   TypeError: fetch failed  (cause: UND_ERR_SOCKET)
 *
 * Handler menangkapnya jadi 502 `fetch failed`, dan karena itu **hanya** POST
 * yang rusak — GET tidak punya body, jadi tidak ada `content-length` basi.
 * Gejalanya di peramban: "Login gagal (periksa NIP, password, dan captcha)".
 *
 * Yang diuji di sini adalah handler serverless-nya secara langsung, dengan
 * `req.body` berupa object dan `content-length` sengaja dibuat basi. Uji lewat
 * server dev lokal tidak akan menangkap apa pun, karena jalur lokal tidak
 * memakai body yang sudah diparsing.
 */
console.log('\n=== ep: content-length basi tidak boleh mematikan POST');
{
  // Upstream terpisah dari stub di atas: handler ini dibaca dari `src/`, bukan
  // dari Express, jadi butuh target sendiri.
  const AskEp: { contentLength: string | undefined; byteLength: number }[] = [];
  let redirectLogin = false;
  const stubEp = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      AskEp.push({
        contentLength: req.headers['content-length'],
        byteLength: Buffer.concat(chunks).length,
      });
      if (redirectLogin) {
        res.writeHead(302, {
          Location: 'https://e-presensi.example/index.php/default/index',
          'Set-Cookie': 'epresensi-bkdjatim=session-baru; Path=/; HttpOnly',
        });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><title>Login</title></html>');
    });
  });
  await new Promise<void>((r) => stubEp.listen(0, '127.0.0.1', () => r()));
  const portEp = portOf(stubEp);

  // `epTargetOrigin()` membaca env saat dipanggil, jadi set sebelum import.
  process.env.EP_TARGET_ORIGIN = `http://127.0.0.1:${portEp}`;
  const { default: handlerEp } = await import('../src/serverless/ep.ts');

  const asli = 'm_user[email]=198501012015011001&m_user[password]=rahasia123&m_user[CAPTCHA]=2636';
  const reqEp = {
    url: '/p/login',
    method: 'POST',
    headers: {
      'x-matched-path': '/ep/p/login',
      'content-type': 'application/x-www-form-urlencoded',
      // Sengaja basi: milik body asli, sedangkan body akan dibangun ulang.
      //
      // ⚠️ Ejaan **huruf besar** itu wajib di sini. Versi pertama guard ini
      // memakai `content-length` lowercase, dan handler yang waktu itu juga
      // menghapus lowercase — jadi test-nya hijau sementara produksi tetap 502.
      // Penyebabnya: `delete headers['content-length']` hanya menghapus ejaan
      // lowercase, sedangkan Vercel dan browser mengirim `Content-Length`.
      'Content-Length': String(Buffer.byteLength(asli)),
    },
    // Fluid Compute memberi object, bukan string/Buffer.
    body: Object.fromEntries(new URLSearchParams(asli)),
  };

  let statusEp = 0;
  let badirEp = '';
  const resEp = {
    statusCode: 200,
    h: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.h[k.toLowerCase()] = v; },
    getHeader(k: string) { return this.h[k.toLowerCase()]; },
    removeHeader(k: string) { delete this.h[k.toLowerCase()]; },
    writeHead(c: number) { statusEp = c; return this; },
    appendHeader(k: string, v: string) { this.h[k.toLowerCase()] = v; },
    end(b?: string) { statusEp = this.statusCode; if (b) badirEp = b; },
  };

  await handlerEp(reqEp as never, resEp as never);

  cek('POST login tidak jadi 502 fetch failed', statusEp !== 502 && !/fetch failed/.test(badirEp),
    `status=${statusEp} body=${badirEp.slice(0, 80)}`);
  cek('request benar-benar sampai ke upstream', AskEp.length === 1,
    `jumlah=${AskEp.length} — body tidak terkirim sama sekali`);

  const diterima = AskEp[0];
  cek('content-length yang diterima cocok dengan body nyata',
    !!diterima && (diterima.contentLength === undefined || Number(diterima.contentLength) === diterima.byteLength),
    diterima ? `content-length=${diterima.contentLength} body=${diterima.byteLength}` : '(tidak ada request)');

  /*
   * Varian huruf besar — dan ini yang sempat menipu.
   *
   * Guard pertama memakai `content-length` lowercase, dan handler-nya waktu itu
   * juga menghapus lowercase. Dua-duanya cocok, jadi test hijau — padahal
   * `delete headers['content-length']` hanya menghapus ejaan lowercase, sementara
   * Vercel mengirim `Content-Length`. Produksi tetap 502.
   *
   * Jadi ejaan harus diuji di semua ejaan. Kalau suatu saat upstream atau layer
   * lain mengubah ejaan header, guard ini langsung memberi tahu.
   */
  for (const ejaan of ['content-length', 'Content-Length', 'CONTENT-LENGTH']) {
    AskEp.length = 0;
    const reqV = {
      url: '/p/login',
      method: 'POST',
      headers: {
        'x-matched-path': '/ep/p/login',
        'content-type': 'application/x-www-form-urlencoded',
        [ejaan]: String(Buffer.byteLength(asli)),
      },
      body: Object.fromEntries(new URLSearchParams(asli)),
    };
    const resV = {
      statusCode: 200, h: {} as Record<string, string>,
      setHeader(k: string, v: string) { this.h[k.toLowerCase()] = v; },
      getHeader(k: string) { return this.h[k.toLowerCase()]; },
      removeHeader(k: string) { delete this.h[k.toLowerCase()]; },
      writeHead(c: number) { this.statusCode = c; return this; },
      appendHeader(k: string, v: string) { this.h[k.toLowerCase()] = v; },
      end() { /* status diambil dari resV.statusCode */ },
    };
    await handlerEp(reqV as never, resV as never);
    const v = AskEp[AskEp.length - 1];
    cek(`header ${ejaan} juga dibuang`,
      !!v && (v.contentLength === undefined || Number(v.contentLength) === v.byteLength),
      v ? `content-length=${v.contentLength} body=${v.byteLength}` : 'request tidak sampai ke upstream');
  }

  AskEp.length = 0;
  redirectLogin = true;
  const reqRedirect = {
    ...reqEp,
    headers: {
      'x-matched-path': '/ep/p/login',
      'content-type': 'application/x-www-form-urlencoded',
    },
  };
  const resRedirect = {
    statusCode: 200, h: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.h[k.toLowerCase()] = v; },
    getHeader(k: string) { return this.h[k.toLowerCase()]; },
    removeHeader(k: string) { delete this.h[k.toLowerCase()]; },
    writeHead(c: number) { this.statusCode = c; return this; },
    appendHeader(k: string, v: string) { this.h[k.toLowerCase()] = v; },
    end() { statusEp = this.statusCode; },
  };
  await handlerEp(reqRedirect as never, resRedirect as never);
  cek('redirect login diteruskan ke browser agar cookie sesi baru dipakai',
    statusEp === 302 &&
      resRedirect.h.location === '/ep/p/default/index' &&
      resRedirect.h['set-cookie']?.includes('Path=/ep') &&
      AskEp.length === 1,
    `status=${statusEp} lokasi=${resRedirect.h.location} cookie=${resRedirect.h['set-cookie']}`);

  stubEp.close();
}

console.log('\n=== web login: respons HTTP gagal tidak boleh dianggap berhasil');
{
  const { login: loginWeb } = await import('../src/lib/webPresensi.ts');
  const fetchAsli = globalThis.fetch;
  let urlLogin = '';
  let paramsLogin = new URLSearchParams();
  let htmlLogin = '';
  globalThis.fetch = (async (url: URL | RequestInfo, opsi?: RequestInit) => {
    urlLogin = String(url);
    paramsLogin = new URLSearchParams(String(opsi?.body ?? ''));
    if (htmlLogin) return new Response(htmlLogin, { status: 200, headers: { 'Content-Type': 'text/html' } });
    return new Response(JSON.stringify({ error: 'Gagal menghubungi server e-Presensi', detail: 'fetch failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    let pesanLogin = '';
    try {
      await loginWeb({ nip: ' 198501012015011001 ', password: 'sandi uji', captcha: '26 36' });
    } catch (err) {
      pesanLogin = err instanceof Error ? err.message : String(err);
    }
    cek('form login dikirim ke endpoint proxy web', urlLogin === '/ep/p/login', urlLogin);
    cek('NIP, password, dan captcha dikirim pada field yang benar',
      paramsLogin.get('m_user[email]') === '198501012015011001' &&
        paramsLogin.get('m_user[password]') === 'sandiuji' &&
        paramsLogin.get('m_user[CAPTCHA]') === '2636');
    cek('HTTP 502 tidak dianggap login berhasil dan error proxy ditampilkan',
      /fetch failed/.test(pesanLogin), pesanLogin || '(tidak ada error)');

    for (const [respons, pesan] of [
      ['Email / NIP tidak terdaftar', 'Email / NIP tidak terdaftar.'],
      ['Password salah', 'Password salah.'],
      ['Captcha salah', 'Captcha salah.'],
    ]) {
      htmlLogin = `<form><input name="m_user[email]"><input name="m_user[CAPTCHA]"><div class="alert alert-danger">${respons}</div></form>`;
      let pesanKredensial = '';
      try {
        await loginWeb({ nip: '123', password: 'sandi', captcha: '1234' });
      } catch (err) {
        pesanKredensial = err instanceof Error ? err.message : String(err);
      }
      cek(`error upstream "${respons}" dijelaskan dengan jelas`, pesanKredensial === pesan, pesanKredensial);
    }
  } finally {
    globalThis.fetch = fetchAsli;
  }
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
stub.close();
srv.close();
process.exit(fail === 0 ? 0 : 1);
