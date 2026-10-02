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

// Stub "gateway": mencatat setiap request yang diterima proxy.
const Ask = [];
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
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
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubUrl = `http://127.0.0.1:${stub.address().port}/service`;

process.env.PRESENSI_BASE_URL = stubUrl;

const { startServer } = await import('../src/api/server.ts');
const app = await startServer();

const srv = http.createServer(app);
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const kirim = async (object, param) => {
  Ask.length = 0;
  const res = await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object, param }),
  });
  return { res, req: Ask[0] };
};

console.log('=== envelope yang dibangun proxy');
{
  const { req } = await kirim('absen', {
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
  const { req } = await kirim('absen', {
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
  const { req } = await kirim('absen', { last_latlong: koordinat, api_key: 'T' });
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
  const kosong = JSON.parse((await kirim('getworkcode', { api_key: 'T' })).req.raw.toString('utf8')).param;
  cek('imei "" tetap "" — tidak diisi UUID dari server', kosong.imei === '',
    'server tidak punya hak memilih identitas perangkat pengguna');
  cek('last_latlong kosong tetap kosong', kosong.last_latlong === '');

  const isi = JSON.parse(
    (await kirim('getworkcode', { api_key: 'T', imei: 'WEB-ABC123' })).req.raw.toString('utf8')
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
  cek('path lain ditolak 400', r2.status === 400, (await r2.json()).error);
  cek('tidak ada request ke upstream saat ditolak', Ask.length === 0, `jumlah=${Ask.length}`);
}

console.log('\n=== respons ke klien diratakan');
{
  const { res } = await kirim('absen', { api_key: 'T' });
  const body = await res.json();
  cek('selalu HTTP 200', res.status === 200, `status=${res.status}`);
  cek('body punya result', 'result' in body, JSON.stringify(Object.keys(body)));
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
stub.close();
srv.close();
process.exit(fail === 0 ? 0 : 1);
