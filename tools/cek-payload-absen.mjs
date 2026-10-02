/**
 * Uji kontrak payload absensi tanpa menyentuh server.
 *
 * `fetch` diganti stub yang mencatat body, jadi kita bisa memastikan
 * keenam param wajib `absen` benar-benar terkirim ke proxy.
 *
 * ⚠️ Yang diperiksa adalah body ke `/api/rpc`, yaitu `{ object, param }`.
 * Envelope lengkap (`jsonrpc`/`method`/`version`) disusun nanti oleh proxy
 * di `src/api/server.ts`, jadi `version` tidak ada di sini — Presence of
 * `version` diuji lewat test proxy terpisah.
 */
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  return new Response(JSON.stringify({ result: { absen: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const { rpcAbsen, rpcCekAbsen } = await import('../src/lib/apiCalls.ts');
const { formatLatLong } = await import('../src/lib/presensiContract.ts');

const ctx = { apiKey: 'TOKEN', imei: 'IMEI-123', lastLatLong: '' };
const koordinat = formatLatLong(-7.2900712345, 112.7031234567);
let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};
const paramTerakhir = () => calls.at(-1).body.param;

console.log('=== rpcAbsen: param wajib (enam, hasil delta-debugging)');
await rpcAbsen(ctx, { checkType: 1, workCode: 12 });
const wajib = ['checktype', 'work_code', 'iswfh', 'ijin', 'keterangan', 'type_ijin'];
let p = paramTerakhir();
for (const k of wajib) cek(`mengirim "${k}"`, k in p, `nilai=${JSON.stringify(p[k])}`);

console.log('\n=== rpcAbsen: field base yang disuntik proxy');
cek('api_key diteruskan', p.api_key === 'TOKEN');
cek('imei diteruskan', p.imei === 'IMEI-123');
/*
 * `last_latlong` SELALU kosong.
 *
 * Aplikasi tidak memakai GPS maupun peta — `navigator.geolocation` tidak
 * pernah dipanggil, dan tidak ada permintaan izin lokasi ke peramban.
 * Field-nya tetap dikirim karena server membalas `-32602 Invalid params`
 * bila `latlong` tidak ada pada `login`; tapi isinya tidak pernah dipakai
 * untuk mengukur apa pun, dan geofence dihitung server dari titik absen
 * yang terdaftar.
 */
cek('last_latlong dikirim (wajib, kalau tidak server menolak)', 'last_latlong' in p);
cek('last_latlong kosong — tidak ada koordinat perangkat', p.last_latlong === '', JSON.stringify(p.last_latlong));
cek('mock = 0 (tidak pernah ada lokasi simulasi)', p.mock === 0, `nilai=${p.mock}`);

console.log('\n=== rpcAbsen: tidak ada jejak GPS di payload');
cek('tidak ada latlong (field khusus login)', !('latlong' in p), Object.keys(p).join(','));
cek('isi payload persis: 6 wajib + mock + 3 suntikan proxy',
  Object.keys(p).length === 10 &&
  [...wajib, 'mock', 'api_key', 'last_latlong', 'imei'].every(k => k in p),
  `${Object.keys(p).length} key: ${Object.keys(p).join(',')}`);

console.log('\n=== rpcAbsen:_object dan path');
cek('object = absen', calls.at(-1).body.object === 'absen');
cek('menuju /api/rpc', calls.at(-1).url === '/api/rpc', calls.at(-1).url);

console.log('\n=== rpcAbsen:(absen sambil ngajuin izin');
await rpcAbsen(ctx, {
  checkType: 1,
  workCode: 12,
  withIjin: true,
  keterangan: 'Sakit',
  typeIjin: 1,
});
p = paramTerakhir();
cek('ijin = 1', p.ijin === 1, `nilai=${p.ijin}`);
cek('keterangan terkirim', p.keterangan === 'Sakit');
cek('type_ijin terkirim', String(p.type_ijin) === '1');

console.log('\n=== rpcAbsen: semua checktype tetap mengirim 6 wajib');
for (const ct of [1, 2, 3]) {
  await rpcAbsen(ctx, { checkType: ct, workCode: 12 });
  const q = paramTerakhir();
  const lengkap = wajib.every(k => k in q);
  cek(`checktype ${ct}: 6 param lengkap`, lengkap && q.checktype === ct);
}

console.log('\n=== rpcAbsen: tanpa koordinat (jatuh ke last_latlong ctx)');
await rpcAbsen(ctx, { checkType: 1, workCode: 12 });
cek('tidak melempar error', true);
cek('last_latlong dari ctx (string kosong)', paramTerakhir().last_latlong === '');

console.log('\n=== rpcCekAbsen');
await rpcCekAbsen(ctx, { checkType: 1, workCode: 12 });
p = paramTerakhir();
cek('object = cekabsen', calls.at(-1).body.object === 'cekabsen');
cek('checktype terkirim', p.checktype === 1);
cek('work_code terkirim', String(p.work_code) === '12');
cek('iswfh terkirim', p.iswfh === 0, `nilai=${p.iswfh}`);
cek('last_latlong tetap kosong di rpcCekAbsen juga', p.last_latlong === '', JSON.stringify(p.last_latlong));

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
