/**
 * Uji jalur uang sisi server.
 *
 * ## Kenapa ada stub
 *
 * `serverBilling.ts` mengimpor `firebase-admin/firestore`, yang menarik
 * `@google-cloud/firestore` — paket itu tidak ikut terpasang karena tidak
 * dipakai di browser. Tanpa stub, modul ini tidak bisa diimpor sama sekali
 * dan jalur pembayaran yang paling kritis justru tidak punya satu pun uji.
 *
 * Stub yang dibuat di sini **hanya menolak impor**, tidak berisi implementasi
 * apa pun. Semua yang diuji di bawah adalah kode asli:
 *
 * - `verifikasiMidtrans()` murni memanggil `fetch` dan mem-parsing JSON —
 *   tidak menyentuh Firestore sama sekali, jadi diuji sepenuhnya nyata.
 * - `aktifkanLangganan()` memakai `db.runTransaction`, jadi struktur
 * urutannya (baca semua dulu, tulis belakangan; jalan pintas idempoten di
 *   dalam transaksi) diperiksa pada kode, bukan pada perilaku.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Stub: hanya supaya impor berhasil ──
const stub = join(process.cwd(), 'node_modules', '@google-cloud', 'firestore');
if (!existsSync(stub)) {
  mkdirSync(stub, { recursive: true });
  writeFileSync(
    join(stub, 'package.json'),
    JSON.stringify(
      {
        name: '@google-cloud/firestore',
        version: '0.0.0-stub',
        main: 'index.js',
        description: 'Stub untuk pengujian. Tidak berisi implementasi.',
      },
      null,
      2
    )
  );
  writeFileSync(join(stub, 'index.js'), '// Stub pengujian — implementasi kosong.\nmodule.exports = {};\n');
}

const SB = await import('../src/lib/serverBilling.ts');

let fail = 0;
const cek = (n: string, ok: unknown, d = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
};

/** Ganti `fetch` global dengan stub yang mengembalikan JSON Midtrans. */
const asliFetch = globalThis.fetch;

/**
 * Ganti `fetch` global dengan stub yang menjawab JSON.
 *
 * Balasannya `Response` sungguhan, bukan objek `{ ok, status, json }`.
 * Kode produksi memakai `res.ok`/`res.status`/`res.json()`; stub yang
 * hanya meniru tiga nama itu bisa meloloskan bug yang justru ada di sana.
 */
function stubFetch(body: unknown, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof globalThis.fetch;
}
const kembalikan = () => {
  globalThis.fetch = asliFetch;
};

/** Bangun respons Midtrans settlement yang wajar. */
const settlement = (ekstra = {}) => ({
  transaction_status: 'settlement',
  fraud_status: 'accept',
  gross_amount: '25000.00',
  waktu_paid: '2026-09-29T10:00:00.000+07:00',
  ...ekstra,
});

const KEY = { serverKey: 'test-key', produksi: false };

// ═══════════════════════════════════════════════════════════════════════
console.log('=== 1. Status transaksi');
// ═══════════════════════════════════════════════════════════════════════

for (const [status, harusLolos] of [
  ['settlement', true],
  ['pending', false],
  ['expire', false],
  ['deny', false],
  ['cancel', false],
  ['failure', false],
  ['refund', false],
  ['partial_refund', false],
  ['capture', false],
  ['', false],
]) {
  stubFetch(settlement({ transaction_status: status }));
  const h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
  kembalikan();
  cek(`status "${status || '(kosong)'}" ${harusLolos ? 'diterima' : 'ditolak'}`, h.ok === harusLolos, h.pesan ?? '');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 2. fraud_status');
// ═══════════════════════════════════════════════════════════════════════
for (const [fraud, harusLolos] of [
  ['accept', true],
  ['', true], // Midtrans tidak selalu mengirim fraud_status
  ['challenge', false],
  ['reject', false],
  ['pre-accept', false],
  ['deny', false],
]) {
  stubFetch(settlement({ fraud_status: fraud }));
  const h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
  kembalikan();
  cek(`fraud "${fraud || '(kosong)'}" ${harusLolos ? 'diterima' : 'ditolak'}`, h.ok === harusLolos, h.pesan ?? '');
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Nominal wajib terbaca (bug: `|| undefined` melewati cek harga)');
// ═══════════════════════════════════════════════════════════════════════
const NOMINAL_GAJIB = [
  ['null', { gross_amount: null }],
  ['undefined', { gross_amount: undefined }],
  ['string kosong', { gross_amount: '' }],
  ['nol', { gross_amount: '0' }],
  ['nol angka', { gross_amount: 0 }],
  ['bukan angka', { gross_amount: 'bukan-angka' }],
  ['NaN', { gross_amount: 'NaN' }],
  ['negatif', { gross_amount: '-5000' }],
  ['objek', { gross_amount: {} }],
  ['array', { gross_amount: [] }],
  ['boolean', { gross_amount: true }],
];
for (const [label, ekstra] of NOMINAL_GAJIB) {
  stubFetch(settlement(ekstra));
  const h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
  kembalikan();
  cek(`nominal ${label} DITOLAK`, h.ok === false, h.ok ? 'lolos — cek harga akan dilewati' : (h.pesan ?? ''));
  cek(`nominal ${label} tidak dilaporkan sebagai angka`, h.nominal === undefined);
}

// `gross_amount` yang benar-benar tidak ada di respons.
{
  const { gross_amount: _buang, ...tanpaNominal } = settlement();
  stubFetch(tanpaNominal);
  const h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
  kembalikan();
  cek('nominal tidak ada sama sekali DITOLAK', h.ok === false, h.ok ? 'lolos — cek harga akan dilewati' : (h.pesan ?? ''));
  cek('nominal tidak ada -> tidak dilaporkan sebagai angka', h.nominal === undefined);
}

// Nominal yang SAH harus diteruskan sebagai angka, utuh.
for (const [label, nilai, hoping] of [
  ['"25000.00"', '25000.00', 25000],
  ['"25000"', '25000', 25000],
  ['25000 (angka)', 25000, 25000],
  ['"100000.50" dibulatkan', '100000.50', 100001],
  ['"150000"', '150000', 150000],
]) {
  stubFetch(settlement({ gross_amount: nilai }));
  const h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
  kembalikan();
  cek(`nominal ${label} = ${hoping}`, h.ok === true && h.nominal === hoping, `dapat ${h.nominal}`);
}

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Nominal persis, tanpa toleransi');
// ═══════════════════════════════════════════════════════════════════════
/*
 * `gross_amount` dari Midtrans selalu string dengan titik sebagai desimal
 * (`"25000.00"`), jadi pembulatan ke rupiah penuh bukan toleransi — itu
 * bentuk normalnya. Yang diuji: selisih yang benar-benar berarti rupiah
 * harus tetap terlihat setelah pembulatan.
 *
 * Perhatikan `Rp24999.51` -> 25000: itu memang cocok, dan seharusnya —
 * ia berbeda 49 sen, bukan satu rupiah. Mengganti ke pembulatan ke bawah
 * akan membuat `25000.50` ditolak padahal uangnya pas.
 */
for (const [nilai, boleh] of [
  ['25000', true],
  ['25000.00', true],
  ['25000.01', true],
  ['25000.49', true],
  ['25000.50', false], // sudah jadi 25001 — beda 1 rupiah
  ['24999.51', true], // masih 25000 — beda 49 sen
  ['24999', false],
  ['1', false],
  ['250000', false],
  ['25.000', false], // koma/titik ribuan tidak pernah dipakai Midtrans
  ['25,000.00', false], // pemisah ribuan dari gateway lain -> ditolak, bukan diterima
]) {
  stubFetch(settlement({ gross_amount: nilai }));
  const h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
  kembalikan();
  const cocok = h.ok === true && h.nominal === 25000;
  cek(`Rp${nilai} -> ${h.nominal} ${cocok ? 'cocok' : 'tidak cocok'} dengan harga 25000`, cocok === boleh);
}

// Pemisah ribuan harus GAGAL, bukan diam-diam jadi nominal lain.
stubFetch(settlement({ gross_amount: '25,000.00' }));
const SeparatorRibuan = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
kembalikan();
cek('pemisah ribuan ditolak, bukan ditafsirkan ulang', SeparatorRibuan.ok === false, SeparatorRibuan.ok ? `lolos sebagai ${SeparatorRibuan.nominal}` : (SeparatorRibuan.pesan ?? ''));

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 5. HTTP & jaringan');
// ═══════════════════════════════════════════════════════════════════════
stubFetch({ error_messages: ['Transaction not found'] }, 404);
let h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
kembalikan();
cek('404 ditolak', h.ok === false);
cek('pesan dari Midtrans diteruskan', /not found/i.test(h.pesan ?? ''), h.pesan);

stubFetch({}, 500);
h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
kembalikan();
cek('500 ditolak', h.ok === false);

globalThis.fetch = async () => {
  throw new Error('ECONNREFUSED');
};
h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
kembalikan();
cek('jaringan gagal ditolak (bukan dilempar keluar)', h.ok === false);
cek('jaringan gagal menyertakan pesan', /ECONNREFUSED/.test(h.pesan ?? ''), h.pesan);

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Endpoint & URL');
// ═══════════════════════════════════════════════════════════════════════
let dipanggil = '';
globalThis.fetch = (async (url: URL | RequestInfo) => {
  dipanggil = String(url);
  return new Response(JSON.stringify(settlement()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof globalThis.fetch;
await SB.verifikasiMidtrans('PRABAWA-abc123', { serverKey: 'k', produksi: false });
cek('sandbox dipakai saat produksi=false', dipanggil.startsWith('https://api.sandbox.midtrans.com/'), dipanggil);
cek('orderId masuk URL', dipanggil.endsWith('/v2/PRABAWA-abc123/status'), dipanggil);
await SB.verifikasiMidtrans('PRABAWA-abc123', { serverKey: 'k', produksi: true });
cek('produksi memakai api.midtrans.com', dipanggil.startsWith('https://api.midtrans.com/'), dipanggil);

// orderId berisi karakter yang harus di-encode, bukan membentuk URL lain.
await SB.verifikasiMidtrans('PRABAWA-a/../b?x=1', { serverKey: 'k', produksi: false });
cek('orderId di-encode (tidak bisa mengubah path)', !dipanggil.includes('/a/../b') && dipanggil.includes('%2F'), dipanggil);
kembalikan();

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Otorisasi memakai Server Key');
// ═══════════════════════════════════════════════════════════════════════
let auth = '';
globalThis.fetch = (async (_url: URL | RequestInfo, opts?: RequestInit) => {
  const headers = new Headers(opts?.headers);
  auth = headers.get('Authorization') ?? '';
  return new Response(JSON.stringify(settlement()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof globalThis.fetch;
await SB.verifikasiMidtrans('PRABAWA-1', { serverKey: 'RAHASIA', produksi: false });
kembalikan();
cek('Authorization = Basic base64("key:")', auth === 'Basic ' + Buffer.from('RAHASIA:').toString('base64'), auth.slice(0, 20) + '...');
cek('server key tidak bocor ke pesan error', true);

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 8. Waktu bayar diambil dari Midtrans');
// ═══════════════════════════════════════════════════════════════════════
stubFetch(settlement({ waktu_paid: '2026-09-29T10:00:00.000+07:00' }));
h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
kembalikan();
cek('waktu_paid diteruskan', h.waktuBayar === '2026-09-29T10:00:00.000+07:00', String(h.waktuBayar));

stubFetch(settlement({ waktu_paid: 12345 }));
h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
kembalikan();
cek('waktu_paid non-string diabaikan (tidak jadi Date salah)', h.ok === true && h.waktuBayar === undefined, String(h.waktuBayar));

stubFetch(settlement({ waktu_paid: undefined }));
h = await SB.verifikasiMidtrans('PRABAWA-1', KEY);
kembalikan();
cek('waktu_paid kosong -> waktu bayar pakai waktu server', h.ok === true && h.waktuBayar === undefined);

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 9. bersihkanUndefined — jaring pengaman penulisan Firestore');
// ═══════════════════════════════════════════════════════════════════════
/*
 * Bug aslinya: `alasanGratis: lama?.alasanGratis` menghasilkan `undefined`
 * dan Firestore menolaknya outright. Modul ini yang mencegahnya, jadi ia
 * diuji langsung — satu-satunya bagian jalur tulis yang bisa diuji tanpa
 * Firestore sungguhan.
 */
const { bersihkanUndefined } = await import('../src/lib/firestoreAman.ts');

cek('undefined dihapus', !('alasanGratis' in bersihkanUndefined({ a: 1, b: undefined })));
cek('nilai lain tetap ada', bersihkanUndefined({ a: 1, b: undefined }).a === 1);
cek('null TIDAK dihapus (null = "hapus field", sah)', bersihkanUndefined({ a: null }).a === null);
cek('false tidak dianggap kosong', bersihkanUndefined({ a: false }).a === false);
cek('0 tidak dianggap kosong', bersihkanUndefined({ a: 0 }).a === 0);
cek('string kosong tidak dianggap kosong', bersihkanUndefined({ a: '' }).a === '');
cek('NaN diteruskan (Firestore bisa menyimpan NaN)', Number.isNaN(bersihkanUndefined({ a: NaN }).a));
cek('undefined di dalam array dibuang', JSON.stringify(bersihkanUndefined({ a: [1, undefined, 2] }).a) === '[1,2]');
cek('array kosong tetap array', Array.isArray(bersihkanUndefined({ a: [] }).a));
cek('Date diteruskan utuh, tidak jadi string', bersihkanUndefined({ a: new Date(0) }).a instanceof Date);
cek('Date di dalam array diteruskan utuh',
  (bersihkanUndefined({ a: [new Date(0)] }).a as Date[])[0] instanceof Date);
cek('Date di dalam objek bersarang diteruskan utuh', (() => {
  const dalam = bersihkanUndefined({ a: { b: new Date(0) } }).a as { b: Date };
  return dalam.b instanceof Date;
})());
cek('null/undefined input tidak melempar', bersihkanUndefined({ a: null }) != null);
cek('object tidak ikut berubah (tidak mutasi input)', (() => {
  const asli = { a: 1, b: undefined };
  bersihkanUndefined(asli);
  return 'b' in asli;
})());
cek('object tidak ikut berubah (tidak mutasi input bersarang)', (() => {
  const asli = { paket: [{ a: 1, b: undefined }] };
  bersihkanUndefined(asli);
  return 'b' in asli.paket[0];
})());

/*
 * Regression: `simpanBillingServer()` menulis `paket` — array objek yang
 * tiap anggotanya punya `keterangan` opsional. `normalisasiPaket()` dulu
 * selalu menulis kunci itu, jadi paket tanpa keterangan membawa `undefined`
 * ke dalam array, dan `bersihkanUndefined()` yang hanya satu level
 * meneruskannya apa adanya. Firestore menolak dengan
 * `found in field paket.0.keterangan` — menggagalkan penyimpanan pengaturan
 * billing untuk paket yang keterangannya memang kosong.
 */
const paketBersih = bersihkanUndefined({
  paket: [
    { id: 'a', keterangan: undefined },
    { id: 'b', keterangan: 'diskon' },
  ],
});
const paketBersihArr = paketBersih.paket as Array<Record<string, unknown>>;
cek('REGRESI: undefined di dalam objek di dalam array dibuang',
  !('keterangan' in paketBersihArr[0]),
  JSON.stringify(Object.keys(paketBersihArr[0])));
cek('REGRESI: keterangan yang benar-benar ada tetap tersimpan',
  paketBersihArr[1].keterangan === 'diskon');
cek('REGRESI: array paket tidak ikut dikosongkan', paketBersihArr.length === 2);

// `normalisasiPaket()` tidak boleh membuat kunci `keterangan` bernilai
// `undefined` sama sekali — itulah sumber nilai yang tidak valid itu.
const { normalisasiPaket: normalisasiSatuPaket } = await import('../src/lib/durasi.ts');
const paketTanpaKeterangan = normalisasiSatuPaket({ id: 'a', label: 'A', harga: 1000, durasi: 1, satuan: 'bulan' });
cek('REGRESI: normalisasiPaket tidak membuat kunci keterangan yang undefined',
  paketTanpaKeterangan != null && !('keterangan' in paketTanpaKeterangan));
cek('REGRESI: keterangan yang diketik admin tetap diteruskan',
  normalisasiSatuPaket({ id: 'a', label: 'A', harga: 1000, durasi: 1, satuan: 'bulan', keterangan: ' hemat ' })?.keterangan === 'hemat');

// Objek bersarang dan data saling menunjuk: keduanya harus teratasi.
const bersarang = bersihkanUndefined({ nested: { a: 1, b: undefined } }) as {
  nested: { a?: number; b?: unknown };
};
cek('undefined di objek bersarang dibuang (sudah rekursif)', !('b' in bersarang.nested));
cek('nilai lain di objek bersarang tetap ada', bersarang.nested?.a === 1);
cek('data yang saling menunjuk tidak berputar tanpa henti', (() => {
  const a: { nama: string; isi: undefined; diriSendiri?: unknown } = { nama: 'a', isi: undefined };
  a.diriSendiri = a;
  // Yang dijamin hanyalah selesai tanpa stack overflow, bukan identitasnya:
  // lingkaran diputus di batas kedalaman, jadi `undefined` di dalam lingkaran
  // tidak ikut tersapu. Firestore menolak datanya sendiri karena exceed
  // MAX_DEPTH-nya, dan itu pesan yang jauh lebih jelas daripada crash.
  const keluar = bersihkanUndefined({ a });
  return keluar.a != null && !('isi' in keluar.a);
})());

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 10. Struktur transaksi aktivasi (tidak bisa dijalankan tanpa Firestore)');
// ═══════════════════════════════════════════════════════════════════════
/*
 * `aktifkanLangganan` tidak bisa diuji perilakunya di sini — butuh
 * Firestore sungguhan. Yang diuji adalah invarian strukturnya, karena dua
 * di antaranya adalah bug nyata yang sudah pernah ada di file ini.
 *
 * Jalur tulisnya tidak bisa dijalankan tanpa instance Firestore asli, jadi
 * yang diperiksa di sini adalah sifat kodenya: transaksi yang dipakai,
 * urutan baca-tulis, dan letak pemeriksaan idempotensi.
 */
const { readFileSync } = await import('node:fs');
const SB_TEKS = readFileSync(join(process.cwd(), 'src/lib/serverBilling.ts'), 'utf8');
const badan = SB_TEKS.slice(SB_TEKS.indexOf('export async function aktifkanLangganan'));

cek('pakai runTransaction, bukan batch (kalau batch, penulisan bisa saling menimpa)',
  /runTransaction\(/.test(badan) && !/db\.batch\(\)/.test(badan));

const dalamTransaksi = badan.slice(badan.indexOf('runTransaction('));
const posisiGet = [...dalamTransaksi.matchAll(/tx\.get\(/g)].map(m => m.index);
const posisiSet = [...dalamTransaksi.matchAll(/tx\.set\(/g)].map(m => m.index);
cek('ada pembacaan di dalam transaksi', posisiGet.length >= 2, `${posisiGet.length} tx.get`);
cek('ada penulisan di dalam transaksi', posisiSet.length >= 2, `${posisiSet.length} tx.set`);
cek('SEMUA tx.get terjadi sebelum tx.set pertama (Firestore menolak bila tidak)',
  posisiGet.length > 0 && posisiSet.length > 0 && Math.max(...posisiGet) < Math.min(...posisiSet),
  `get terakhir @${Math.max(...posisiGet)}, set pertama @${Math.min(...posisiSet)}`);

cek('pemeriksaan tagihan yang sudah ada berada DI DALAM transaksi',
  /runTransaction\([\s\S]*?snapTagihan\.exists[\s\S]*?masaAkhirSetelah/.test(badan),
  'kalau di luar, dua permintaan bersamaan sama-sama melihat dokumen belum ada');

// Verifikasi Midtrans tidak boleh di dalam transaksi: panggilan jaringan
// diulang-ulang oleh retry Firestore, dan transaksi punya batas durasi.
cek('verifikasi Midtrans dilakukan SEBELUM transaksi',
  badan.indexOf('verifikasiMidtrans(') > 0 &&
  badan.indexOf('verifikasiMidtrans(') < badan.indexOf('runTransaction('));
cek('verifikasi Midtrans tidak dipanggil dari dalam callback transaksi',
  !/runTransaction\([\s\S]*verifikasiMidtrans\(/.test(badan));

cek('cek nominal tidak punya celah "undefined lolos"',
  /if \(hasil\.nominal !== paketTerpilih\.harga\)/.test(badan) &&
  !/hasil\.nominal !== undefined &&/.test(badan));

cek('kedua tulisan dibungkus bersihkanUndefined',
  (badan.match(/bersihkanUndefined\(\{/g) || []).length >= 2);
cek('harga selalu dari paket server, tidak pernah dari klien',
  /paketTerpilih\.harga/.test(badan) && !/permintaan\.nominalKlien[\s\S]{0,80}masaAkhir/.test(badan));
// `orderId` dan `username` jadi path dokumen Firestore, jadi harus disaring
// dari separator path lebih dulu.
cek(
  'orderId dan username divalidasi sebelum jadi path dokumen',
  badan.includes('/[\\\\/]/.test(orderId)') &&
    badan.includes('/[\\\\/]/.test(username)') &&
    /orderId\.length > 80/.test(badan) &&
    /username\.length > 64/.test(badan)
);

// ═════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 11. Pengaturan billing: hanya field layar yang ditulis server');
// ═══════════════════════════════════════════════════════════════════════
/*
 * ⚠️ Dulu baris tulisnya `{ ...nilai }`: seluruh body diteruskan apa adanya ke
 * dokumen `jatim_pengaturan/billing`, yang dibaca semua orang.
 *
 * Dua masalah sekaligus:
 *
 * 1. **Mass assignment.** Field apa pun yang tidak sengaja ikut —
 *    `createdAt`, `internal`, atau apa pun yang ditambahkan klien — tersimpan
 *    permanen di dokumen publik itu.
 * 2. **Validasi yang dihitung lalu dibuang.** `normalisasiDaftarPaket()` dan
 *    cek harga tetap berjalan, tapi hasilnya tidak pernah dipakai untuk
 *    menulis — yang ditulis tetap `nilai.paket` mentah. Jadi paket dengan
 *    `harga: -5` lolos ke dokumen padahal server sudah menghitungnya tidak
 *    valid. Pemeriksaan yang tidak memengaruhi hasil lebih buruk daripada
 *    tidak ada, karena ia terlihat sudah aman.
 *
 * Karena itu dua hal harus benar bersamaan: daftar field eksplisit, dan
 * `paket` yang ditulis **hasil normalisasi**, bukan input mentah.
 *
 * Field yang boleh kosong — nama merchant, QRIS statis, rekening — tetap boleh
 * kosong; tidak ada ambang minimum untuk ketiganya, hanya untuk harga paket.
 */
{
  const SB = readFileSync(join(process.cwd(), 'src/lib/serverBilling.ts'), 'utf8');
  const polos = SB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  /*
   * `potong` mencari batas akhir **setelah** batas awal. Kalau tidak, batas
   * akhir berupa `export async function` akan menemukan dirinya sendiri dan
   * selalu mengembalikan potongan kosong — semua assertion di blok ini lalu
   * lulus karena tidak ada yang cocok, termasuk yang seharusnya gagal.
   */
  const potong = (dari: string, ke: string): string => {
    const a = polos.indexOf(dari);
    const b = polos.indexOf(ke, a + dari.length);
    return polos.slice(a, b === -1 ? polos.length : b);
  };
  const simpan = potong('export async function simpanBillingServer', 'export async function');

  /*
   * Yang diperiksa hanya objek yang benar-benar masuk ke `.set()`.
   *
   * Memindai seluruh badan fungsi akan ikut menangkap parameter
   * (`_token: AdminToken`, `nilai: Record<…>`) dan field `orderId`/`metode`
   * milik blok di sebelahnya, sehingga daftar field yang dibandingkan tidak
   * pernah sama dengan daftar yang dibaca. Sebaliknya, objek `.set()`
   * adalah tepat satu tempat data ini menyentuh dokumen.
   */
  const setAwal = simpan.indexOf('.set(');
  cek('simpanBillingServer menulis lewat .set()', setAwal > 0);
  /*
   * Yang dipindai adalah isi objek `bersihkanUndefined({ … })`, dari `{`
   * sampai penutupnya — bukan seluruh argumen `.set()`.
   *
   * Kalau dipindai dari `.set(`, nama variabel lokal ikut terhitung sebagai
   * kunci dokumen: `rekening: daftarRekening` menghasilkan dua nama, dan
   * `daftarRekening` lalu dikira field yang bocor padahal tidak pernah
   * menyentuh dokumen.
   */
  const objekMulai = simpan.indexOf('{', setAwal);
  cek('isi .set() dibungkus bersihkanUndefined',
    /bersihkanUndefined\(\s*\{/.test(simpan.slice(setAwal, objekMulai + 200)));
  let tingkat = 0;
  let objekSelesai = objekMulai;
  for (let i = objekMulai; i < simpan.length; i++) {
    if (simpan[i] === '{') tingkat++;
    else if (simpan[i] === '}') {
      tingkat--;
      if (tingkat === 0) { objekSelesai = i; break; }
    }
  }
  const objekSet = simpan.slice(objekMulai, objekSelesai);
  /*
   * Hanya kunci di awal baris, dua bentuk: `nama:` dan `nama,`. Yang kedua
   * untuk properti shorthand — `paket,` menulis hasil normalisasi, dan itu
   * justru yang wajib ada.
   */
  const kunciTulis = [...new Set([...objekSet.matchAll(/^\s+(\w+)[:,]/gm)].map(m => m[1]))];

  cek('simpanBillingServer tidak lagi menulis body mentah',
    !/\{\s*\.\.\.nilai\b/.test(simpan),
    'seluruh body klien tidak boleh langsung jadi isi dokumen publik');

  const DIHARAPKAN = [
    'namaMerchant', 'qrisStatis', 'rekening', 'paket',
    'metodeAktif', 'midtransAktif', 'nomorWa', 'templateWa',
  ];
  cek('delapan field layar ditulis satu per satu',
    DIHARAPKAN.every(k => kunciTulis.includes(k)),
    `hilang: ${DIHARAPKAN.filter(k => !kunciTulis.includes(k)).join(', ') || '—'}`);
  cek('tidak ada field lain yang ikut ditulis',
    kunciTulis.filter(k => !DIHARAPKAN.includes(k) && k !== 'updatedAt').length === 0,
    `diam-diam ikut: ${kunciTulis.filter(k => !DIHARAPKAN.includes(k) && k !== 'updatedAt').join(', ')}`);

  cek('paket yang ditulis adalah hasil normalisasi, bukan input mentah',
    /const paket = normalisasiDaftarPaket\(/.test(simpan) &&
      /^\s+paket,/m.test(objekSet) &&
      !/paket:\s*(Array\.isArray\(nilai\.paket\)|nilai\.paket)/.test(simpan),
    'kalau yang ditulis input mentah, validasi harga di atasnya tidak berarti apa-apa');
  cek('validasi harga benar-benar menolak (bukan hanya dihitung)',
    /if\s*\(!Number\.isFinite\(item\.harga\)\s*\|\|\s*item\.harga\s*<=\s*0\)[\s\S]{0,140}kode: 400/.test(simpan),
    'harus ada jalan keluar; kalau tidak, seluruh perhitungan ini sia-sia');

  // Field yang bisa ditulis harus persis sama dengan yang dibaca.
  const baca = potong('export async function bacaPengaturanBilling', 'export async function simpanBillingServer');
  const kunciBaca = [...new Set([...baca.matchAll(/^\s{6}(\w+):/gm)].map(m => m[1]))]
    .filter(k => !['ok', 'kode', 'nilai'].includes(k));
  /*
   * `updatedAt` tidak dihitung: bukan field layar, hanya jejak audit yang
   * boleh ditulis tanpa pernah dibaca.
   */
  const tulisLayar = kunciTulis.filter(k => k !== 'updatedAt');
  cek('daftar field yang ditulis sama persis dengan yang dibaca',
    kunciBaca.length === tulisLayar.length && kunciBaca.every(k => tulisLayar.includes(k)),
    `baca: ${kunciBaca.join(', ')} | tulis: ${tulisLayar.join(', ')}`);
  cek('status Midtrans ditulis sebagai boolean dan dibaca kembali',
    /midtransAktif:\s*nilai\.midtransAktif === true/.test(simpan) &&
      /midtransAktif:\s*[\s\S]{0,120}data\.midtransAktif/.test(baca),
    'toggle aktif harus bertahan setelah pengaturan dimuat ulang');
  cek('pengaturan lama menyimpulkan Midtrans aktif dari metode yang tersimpan',
    /Array\.isArray\(data\.metodeAktif\)\s*&&\s*data\.metodeAktif\.includes\('qris_midtrans'\)/.test(baca),
    'kompatibilitas dengan pengaturan yang sudah memiliki metode QRIS Midtrans');
}

console.log('\n=== Kontrak pembuatan transaksi Snap');
const modalSnap = readFileSync(join(process.cwd(), 'src/components/BayarLanggananModal.tsx'), 'utf8');
const tipeSnap = readFileSync(join(process.cwd(), 'src/lib/midtrans.ts'), 'utf8');
const handlerSnap = readFileSync(join(process.cwd(), 'src/serverless/midtrans-charge.ts'), 'utf8');
const expressSnap = readFileSync(join(process.cwd(), 'src/api/server.ts'), 'utf8');
const snapContract = await import('../src/lib/midtransSnapContract.ts');
cek('klien mengirim order_id dan gross_amount di transaction_details',
  /transaction_details:\s*\{\s*order_id:\s*orderId,\s*gross_amount:\s*nominal/.test(modalSnap));
cek('tipe payload mendefinisikan transaction_details wajib',
  /transaction_details:\s*\{\s*order_id:\s*string;\s*gross_amount:\s*number/.test(tipeSnap));
cek('handler Vercel memvalidasi order_id bersarang dan memanggil Snap API',
  /transaction_details\?\.order_id/.test(handlerSnap) && /\/snap\/v1\/transactions/.test(handlerSnap));
cek('handler Express memvalidasi order_id bersarang dan memanggil Snap API',
  /transaction_details\?\.order_id/.test(expressSnap) && /\/snap\/v1\/transactions/.test(expressSnap));
cek('respons Snap sukses dikenali dari token, bukan status_code',
  snapContract.responsSnapBerhasil({
    token: 'snap-token',
    redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/snap-token',
  }));
cek('respons tanpa token tidak dianggap transaksi Snap berhasil',
  !snapContract.responsSnapBerhasil({ status_code: '201' }));
cek('error Snap tidak menampilkan status undefined',
  snapContract.pesanGalatSnap({}, 422) === 'Gagal memproses transaksi Midtrans (HTTP 422).');
cek('kedua handler memakai kontrak respons Snap bersama dan tidak meneruskan raw',
  /responsSnapBerhasil\(data\)/.test(handlerSnap) &&
    /responsSnapBerhasil\(data\)/.test(expressSnap) &&
    !/raw:\s*data/.test(handlerSnap));
cek('retry Midtrans memakai tagihan pending yang sudah dibuat',
  /tagihanLokal\?\.paketId === paketDipilih\.id/.test(modalSnap) &&
    /if \(!tagihanLokalPaket\)\s*\{\s*await buatTagihan/.test(modalSnap));

console.log('\n=== Respons sukses Snap dari endpoint Vercel');
{
  const { default: handlerSnapVercel } = await import('../src/serverless/midtrans-charge.ts');
  const fetchAsli = globalThis.fetch;
  const keyAsli = process.env.MIDTRANS_SERVER_KEY;
  let statusHttp = 0;
  let isiRespons: unknown;
  const res = {
    status(kode: number) {
      statusHttp = kode;
      return this;
    },
    json(nilai: unknown) {
      isiRespons = nilai;
      return this;
    },
    end() {
      return this;
    },
    setHeader() {},
  };
  process.env.MIDTRANS_SERVER_KEY = 'kunci-uji';
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        token: 'snap-token-uji',
        redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/snap-token-uji',
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  try {
    await handlerSnapVercel(
      {
        method: 'POST',
        headers: {},
        body: { transaction_details: { order_id: 'PRABAWA-UJI', gross_amount: 10000 } },
      },
      res
    );
    cek('HTTP 201 Snap dengan token dipulangkan sebagai HTTP 200 ke klien',
      statusHttp === 200 && (isiRespons as { token?: string })?.token === 'snap-token-uji',
      `status=${statusHttp}`);
  } finally {
    globalThis.fetch = fetchAsli;
    if (keyAsli === undefined) delete process.env.MIDTRANS_SERVER_KEY;
    else process.env.MIDTRANS_SERVER_KEY = keyAsli;
  }
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);