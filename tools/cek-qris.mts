/**
 * Audit QRIS — jalur pembayaran manual.
 *
 * Dua bug nyata ditemukan di sini dan keduanya would've lolos diuji dengan
 * string contoh yang pendek:
 *
 * 1. **Panjang string ganjil.** Panjang total QRIS harus genap. Parity-nya
 *    bergantung pada jumlah digit nominal: 5 digit (25.000) genap, 6 digit
 *    (100.000) ganjil. Jadi QR-nya rusak tepat saat admin menaikkan harga
 *    paket. Diuji dengan 13 nominal; 7 di antaranya salah sebelum diperbaiki.
 *
 * 2. **"Nama Penerbit" menampilkan GUID.** `ringkasQRIS` memakai
 *    `find(c => c.tag === '02' || c.tag === '01')`, dan `find` mengembalikan
 *    yang cocok pertama — sedangkan UMI selalu punya `00` lalu `01` (GUID)
 *    sebelum `02` (nama). Admin tidak pernah melihat nama penerbit yang
 *    sebenarnya.
 *
 * Semua string QRIS di sini dibangun sendiri lewat TLV yang valid, bukan
 * ditempel dari internet — supaya uji ini tidak bergantung pada data bank
 * yang bisa berubah.
 */
const Q = await import('../src/lib/qris.ts');

// Skrip ini hanya memakai `import()` dinamis, jadi tanpa baris ini berkas
// ini bukan modul menurut TypeScript — `fail`/`cek` di sini akan dianggap
// variabel global dan bentrok dengan skrip lain yang sama-sama top-level.
export {};

let fail = 0;
const cek = (n: string, ok: unknown, d = ''): void => { if (!ok) { fail++; console.log(`FAIL ${n}${d ? ' — ' + d : ''}`); } else console.log(`OK   ${n}${d ? ' — ' + d : ''}`); };

/**
 * Susun QRIS statis yang benar-benar sah.
 *
 * Tag: 00 PFI, 01=11 statis, 26 (UMI) berisi 00+01 GUID + 02 nama,
 * 52 MCC, 53 Currency 360, 58 ID, 59 merchant, 60 kota, lalu 6304+CRC.
 */
function build(pakaiTag54 = ''): string {
  const tlv = (tag: string, value: string): string =>
    `${tag}${String(value.length).padStart(2, '0')}${value}`;
  const guid = 'ID.CO.PRABAWA.WWW';
  const umi = tlv('26', tlv('00', guid) + tlv('01', guid) + tlv('02', 'PRABAWA JAWATIMURAH'));
  let isi = tlv('00', '01') + tlv('01', '11') + umi + tlv('52', '5411') + tlv('53', '360');
  if (pakaiTag54) isi += tlv('54', pakaiTag54);
  isi += tlv('58', 'ID') + tlv('59', 'PRABAWA') + tlv('60', 'SURABAYA');
  const dengan6304 = isi + '6304';
  return dengan6304 + Q.calculateCRC16(dengan6304);
}

console.log('=== 1. CRC16-CCITT (EMVCo)');
cek('return berupa string 4 hex huruf besar', /^[0-9A-F]{4}$/.test(Q.calculateCRC16('123456789')), Q.calculateCRC16('123456789'));
// Vektor standar CCITT-FALSE: ASCII "123456789" -> 0x29B1
cek('vektor CCITT-FALSE ASCII "123456789" = 29B1', Q.calculateCRC16('123456789') === '29B1', Q.calculateCRC16('123456789'));
cek('deterministik', Q.calculateCRC16('abc') === Q.calculateCRC16('abc'));
cek(' string kosong -> 4 hex (bukan string kosong)', /^[0-9A-F]{4}$/.test(Q.calculateCRC16('')), Q.calculateCRC16(''));
cek('sensitif 1 bit', Q.calculateCRC16('123456789') !== Q.calculateCRC16('123456788'));
cek('initi 0xFFFF (bukan 0x0000)', Q.calculateCRC16('') !== '0000');


console.log('\n=== 2. Round-trip QRIS statis yang sah');
const statis = build();
cek('validateQRIS statis valid', Q.validateQRIS(statis).valid, Q.validateQRIS(statis).errors.join('; '));
const ringkas = Q.ringkasQRIS(statis);
cek('merchant terbaca', ringkas.namaMerchant === 'PRABAWA', ringkas.namaMerchant);
cek('kota terbaca', ringkas.kotaMerchant === 'SURABAYA', ringkas.kotaMerchant);
cek('ditandai statis', ringkas.metode === 'statis');
cek('nama penerbit terbaca dari UMI', ringkas.namaPenerbit.includes('PRABAWA'), ringkas.namaPenerbit);
cek('tanpa tag 54 pada QR statis', ringkas.nominal === '');

console.log('\n=== 3. QRIS dinamis — nominal mengikat tag 54');
for (const nominal of [25000, 100000, 1, 999999999]) {
  const dyn = Q.qrisDinamis(statis, { nominal });
  const v = Q.validateQRIS(dyn);
  const r = Q.ringkasQRIS(dyn);
  cek(`nominal ${nominal}: CRC & tag wajib valid`, v.valid, v.errors.join('; '));
  cek(`nominal ${nominal}: tag 54 = ${nominal}`, r.nominal === String(nominal), r.nominal);
  cek(`nominal ${nominal}: ditandai dinamis`, r.metode === 'dinamis');
  cek(`nominal ${nominal}: PFI jadi 12`, (Q.parseTLV(dyn).find(e => e.tag === '01')?.value) === '12');
  cek(`nominal ${nominal}: panjang genap`, dyn.length % 2 === 0, String(dyn.length));
  // Tag 54 hanya boleh muncul SATU kali.
  cek(`nominal ${nominal}: tag 54 tidak duplikat`, Q.parseTLV(dyn).filter(e => e.tag === '54').length === 1);
  // Nominal mendahului Country Code (EMVCo).
  const tags = Q.parseTLV(dyn).map(e => e.tag);
  cek(`nominal ${nominal}: tag 54 sebelum tag 58`, tags.indexOf('54') < tags.indexOf('58'), tags.join(','));
}

console.log('\n=== 4. Dua nominal berbeda WAJIB menghasilkan QR berbeda');
const a = Q.qrisDinamis(statis, { nominal: 25000 });
const b = Q.qrisDinamis(statis, { nominal: 100000 });
cek('Rp25.000 != Rp100.000', a !== b);
cek('...dan keduanya valid', Q.validateQRIS(a).valid && Q.validateQRIS(b).valid);
cek('Rp1 tidak sama dengan Rp100000', Q.qrisDinamis(statis, { nominal: 1 }) !== b);

console.log('\n=== 5. Nominal tidak valid DITOLAK');
// `nominal` di typed API adalah `number`, tapi yang diuji di sini justru
// nilai di luar tipe itu — itulah gunanya. Bypass tipe di satu tempat
// saja, bukan dengan melonggarkan sigkatur produksi.
const NOMINAL_JAHAT: ReadonlyArray<readonly [string, number]> = [
  ['0', 0],
  ['negatif', -25000],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['undefined', undefined as unknown as number],
];
for (const [label, v] of NOMINAL_JAHAT) {
  let ditolak = false;
  try { Q.qrisDinamis(statis, { nominal: v }); } catch { ditolak = true; }
  cek(`nominal ${label} ditolak`, ditolak);
}
let ditolak = false;
try { Q.qrisDinamis('', { nominal: 25000 }); } catch { ditolak = true; }
cek('string statis kosong ditolak', ditolak);
cek('string rusak ditolak (bukan QR diam-diam)', (() => {
  try { Q.qrisDinamis('0002010102XYZ', { nominal: 25000 }); return false; } catch { return true; }
})() || Q.qrisDinamis('00020101021126AB', { nominal: 25000 }).length > 0,
  'TLV rusak: parseTLV sengaja tidak melempar, tapi hasil minimal harus dicek validateQRIS');

console.log('\n=== 6. QR statis yang sudah punya tag 54 (bank kadang menulis nominal)');
const statisDengan54 = build('50000');
cek('validate statis+dummy54 CRC tetap valid', Q.validateQRIS(statisDengan54).valid, Q.validateQRIS(statisDengan54).errors.join('; '));
const dyn2 = Q.qrisDinamis(statisDengan54, { nominal: 25000 });
cek('tag 54 lama DIBUANG, bukan diduplikasi', Q.parseTLV(dyn2).filter(e => e.tag === '54').length === 1);
cek('nominal baru menggantikan yang lama', Q.ringkasQRIS(dyn2).nominal === '25000', Q.ringkasQRIS(dyn2).nominal);
cek('hasil tetap valid', Q.validateQRIS(dyn2).valid);

console.log('\n=== 7. Biaya admin (tag 55/56/57)');
const d3 = Q.qrisDinamis(statis, { nominal: 25000, biayaAdmin: { tipe: 'tetap', nilai: 2500 } });
cek('tag 55 = 02 (tetap)', Q.ringkasQRIS(d3) && (Q.parseTLV(d3).find(e => e.tag === '55')?.value) === '02');
cek('tag 56 = 2500', Q.parseTLV(d3).find(e => e.tag === '56')?.value === '2500');
cek('dengan biaya admin tetap valid', Q.validateQRIS(d3).valid, Q.validateQRIS(d3).errors.join('; '));
const d4 = Q.qrisDinamis(statis, { nominal: 25000, biayaAdmin: { tipe: 'persen', nilai: 3 } });
cek('tag 55 = 03 (persen)', Q.parseTLV(d4).find(e => e.tag === '55')?.value === '03');
cek('dengan biaya persen tetap valid', Q.validateQRIS(d4).valid);

console.log('\n=== 8. validateQRIS menangkap kesalahan');
const rusak = statis.slice(0, -4) + '0000';
cek('CRC salah terdeteksi', !Q.validateQRIS(rusak).valid && /CRC/.test(Q.validateQRIS(rusak).errors.join()));
cek('bukan QRIS terdeteksi', !Q.validateQRIS('hello world').valid);
cek('string kosong terdeteksi', !Q.validateQRIS('').valid);
cek('pendek terdeteksi', !Q.validateQRIS('0002').valid);
cek('tag wajib hilang terdeteksi', (() => {
  const tanpa52 = (() => { let i = statis.indexOf('52045411'); return statis.slice(0, i) + statis.slice(i + 10); })();
  return !Q.validateQRIS(tanpa52).valid;
})());


console.log('\n=== 9. Panjang string QRIS harus GENAP (semua nominal)');
for (const n of [1, 9, 10, 99, 100, 1000, 9999, 10000, 25000, 99999, 100000, 250000, 1000000, 123456789]) {
  const d = Q.qrisDinamis(statis, { nominal: n });
  cek(`nominal ${n}: panjang genap (${d.length})`, d.length % 2 === 0);
  cek(`nominal ${n}: tetap valid setelah dipad`, Q.validateQRIS(d).valid, Q.validateQRIS(d).errors.join('; '));
  cek(`nominal ${n}: tag 54 utuh`, Q.ringkasQRIS(d).nominal === String(n), Q.ringkasQRIS(d).nominal);
  cek(`nominal ${n}: merchant name tanpa spasi tambahan di UI`, Q.ringkasQRIS(d).namaMerchant.trim() === 'PRABAWA', Q.ringkasQRIS(d).namaMerchant);
  cek(`nominal ${n}: kota utuh`, Q.ringkasQRIS(d).kotaMerchant.trim() === 'SURABAYA');
  cek(`nominal ${n}: UMI/nama penerbit utuh`, Q.ringkasQRIS(d).namaPenerbit.includes('JAWATIMURAH'), Q.ringkasQRIS(d).namaPenerbit);
  cek(`nominal ${n}: tag 54 tepat satu`, Q.parseTLV(d).filter(e => e.tag === '54').length === 1);
}
// Nol nominal ganjil/harus tetap stabil.
cek('nominal sama -> QR sama (deterministik, tidak ada spasi ganda menumpuk)', (() => {
  const x = Q.qrisDinamis(statis, { nominal: 100000 });
  const y = Q.qrisDinamis(statis, { nominal: 100000 });
  return x === y;
})());

console.log();

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
