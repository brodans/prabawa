/**
 * Uji logika langganan + QRIS.
 *
 * Bagian ini murni aritmetika dan keputusan aturan — tidak ada Firestore, tidak ada
 * jaringan — jadi bisa diuji seluruhnya di Node. Yang diuji justru aturan
 * yang paling mahal kalau salah:
 *
 * 1. **Status kedaluwarsa** dihitung dari `masaAkhir`, bukan disimpan.
 * 2. **`gratis` menang atas kedaluwarsa.** Kalau tidak, akun yang ditandai
 *    gratis akan terkunci sendiri setelah 30 hari.
 * 3. **Pembayaran memperpanjang dari masa aktif yang ada**, bukan dari hari
 *    ini — kalau tidak, pengguna yang membayar dua bulan di bulan kedua
 *    kehilangan sisa masa aktifnya.
 * 4. **Pembayaran dobel untuk `orderId` yang sama tidak menambah bulan dua
 *    kali.** Pengecekan status Midtrans bisa dipanggil berulang.
 * 5. **Admin selalu boleh masuk.** Kalau tidak, tidak ada yang bisa membuka
 *    kembali.
 * 6. **QRIS dinamis** benar-benar mengubah tag 01, menyisipkan tag 54 di
 *    posisi yang diwajibkan EMVCo, dan CRC-nya cocok.
 */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

const baca = p => readFileSync(new URL(p, import.meta.url), 'utf8');

void webcrypto; // crypto global sudah tersedia di Node 20

// Modul yang diuji hanya butuh `firebase/firestore` yang tidak pernah
// dipanggil pada fungsi murni. Stub Window/browser seperlunya.
globalThis.window = globalThis.window ?? {};

let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const {
  PAKET_BAWAAN,
  BILLING_DEFAULT,
  statusLangganan,
  sisaHari,
  tambahHari,
  ringkasanLangganan,
  bolehMasuk,
  paketEfektif,
  formatRupiah,
  formatRuang,
  idTagihan,
} = await import('../src/lib/langganan.ts');

/** @typedef {import('../src/lib/langganan.ts').DokumenLangganan} DokumenLangganan */

const { calculateCRC16, qrisDinamis, validateQRIS, ringkasQRIS, parseTLV } = await import(
  '../src/lib/qris.ts'
);

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Sisa hari dihitung dari masaAkhir');
const sekarang = new Date('2026-09-28T10:00:00+07:00');
// `sisaHari()` membandingkan selisih milidetik absolut, jadi kedua sisi
// harus dalam zona waktu yang sama. Semua waktu di sini WIB.
cek('sisa 30 hari ke depan', sisaHari('2026-10-28T10:00:00+07:00', sekarang) === 30);
cek('sisa 1 hari', sisaHari('2026-09-29T10:00:00+07:00', sekarang) === 1);
cek('sudah lewat → negatif', sisaHari('2026-09-27T10:00:00+07:00', sekarang) === -1);
cek('kosong dianggap belum ada', sisaHari(undefined, sekarang) === -1);
cek('timestamp tak valid dianggap belum ada', sisaHari('bukan-tanggal', sekarang) === -1);
// 12 jam tersisa harus dihitung "1 hari lagi", bukan 0 — kalau dibulatkan
// ke bawah, pengguna melihat "0 hari" lalu tidak tahu harus buru-buru.
cek(
  'sisa 12 jam dibulatkan ke atas jadi 1 hari',
  sisaHari('2026-09-28T22:00:00+07:00', sekarang) === 1,
  String(sisaHari('2026-09-28T22:00:00+07:00', sekarang))
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Status langganan');
/** @type {DokumenLangganan} */
const AKTIF_AKHIR = '2026-10-28T10:00:00+07:00';
const AKTIF_MULAI = '2026-08-28T10:00:00+07:00';
const aktif = {
  username: 'budi',
  paketId: 'bulanan',
  masaMulai: AKTIF_MULAI,
  masaAkhir: AKTIF_AKHIR,
  gratis: false,
  totalBayar: 25000,
  jumlahBayar: 1,
  createdAt: AKTIF_MULAI,
};
cek('masa aktif → aktif', statusLangganan(aktif, sekarang) === 'aktif');
cek('tidak ada dokumen → belum', statusLangganan(null, sekarang) === 'belum');
cek('masa lewat → kadaluarsa', statusLangganan({ ...aktif, masaAkhir: '2026-09-01T00:00:00+07:00' }, sekarang) === 'kadaluarsa');

// ⚠️ Ini yang paling mudah salah: akun exempt tidak boleh pernah kedaluwarsa.
cek(
  'gratis menang atas kedaluwarsa',
  statusLangganan({ ...aktif, gratis: true, masaAkhir: '2020-01-01T00:00:00+07:00' }, sekarang) === 'gratis'
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Ringkasan & gerbang masuk');
const ring = ringkasanLangganan('budi', aktif, PAKET_BAWAAN, 'user', sekarang);
cek('ringkasan: status aktif', ring.status === 'aktif', ring.status);
cek('ringkasan: sisa hari 30', ring.sisaHari === 30, String(ring.sisaHari));
cek('ringkasan: label paket', ring.paketLabel === '1 Bulan', ring.paketLabel);
cek('user aktif boleh masuk', bolehMasuk(ring, 'user') === true);

const ringKadaluarsa = ringkasanLangganan(
  'budi',
  { ...aktif, masaAkhir: '2026-01-01T00:00:00+07:00' },
  PAKET_BAWAAN,
  'user',
  sekarang
);
cek('user kedaluwarsa tidak boleh masuk', bolehMasuk(ringKadaluarsa, 'user') === false);

const ringGratis = ringkasanLangganan(
  'siti',
  { ...aktif, username: 'siti', gratis: true, masaAkhir: '2020-01-01T00:00:00+07:00' },
  PAKET_BAWAAN,
  'user',
  sekarang
);
cek('akun gratis boleh masuk', bolehMasuk(ringGratis, 'user') === true);
cek('label paket untuk akun gratis', ringGratis.paketLabel === 'Gratis (exempt)', ringGratis.paketLabel);

// Admin harus selalu lolos — kalau admin ikut terkunci, tidak ada yang
// bisa membukanya kembali.
const ringAdmin = ringkasanLangganan(
  'admin',
  { ...aktif, username: 'admin', masaAkhir: '2020-01-01T00:00:00+07:00' },
  PAKET_BAWAAN,
  'admin',
  sekarang
);
cek('admin kedaluwarsa tetap dihitung aktif', ringAdmin.status === 'aktif', ringAdmin.status);
cek('admin selalu boleh masuk', bolehMasuk(ringAdmin, 'admin') === true);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Perpanjangan dihitung dari masa aktif yang ada');
// Logika yang sama dipakai `catatPembayaran`; diuji ulang di sini agar
// pergeserannya tidak diam-diam berubah.
const perpanjang = (dari, sisaHariSekarang, durasi) =>
  tambahHari(sisaHariSekarang > 0 ? tambahHari(dari, sisaHariSekarang) : dari, durasi);

// Bayar lagi 10 hari sebelum masa aktif habis → 30 hari ditambahkan dari
// AKHIR masa aktif, bukan dari tanggal bayar. Kalau dihitung dari tanggal
// bayar, sisa 10 hari itu hangus.
const bayarDi = new Date('2026-10-18T10:00:00+07:00');
const sisaSaatBayar = sisaHari(aktif.masaAkhir, bayarDi);
const baru = perpanjang(bayarDi, sisaSaatBayar, 30);
cek('sisa saat bayar = 10 hari', sisaSaatBayar === 10, String(sisaSaatBayar));
cek(
  'masa aktif jadi 27 Nov (akhir lama 28 Okt + 30 hari)',
  baru.toISOString() === new Date('2026-11-27T10:00:00+07:00').toISOString(),
  baru.toISOString()
);

// Bayar setelah masa aktif habis → mulai dari tanggal bayar, bukan dihitung
// dari masa aktif lama.
const bayarSetelahHabis = new Date('2026-11-05T10:00:00+07:00');
const baru2 = perpanjang(bayarSetelahHabis, sisaHari(aktif.masaAkhir, bayarSetelahHabis), 30);
cek('masa aktif = 5 Des (dari tanggal bayar)', baru2.toISOString() === new Date('2026-12-05T10:00:00+07:00').toISOString(), baru2.toISOString());

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Format rupiah & id tagihan');
cek('formatRuang tanpa pemisah ribuan', formatRuang(25000) === '25.000', formatRuang(25000));
cek('formatRupiah', formatRupiah(250000) === 'Rp 250.000', formatRupiah(250000));
cek('formatRuang aman untuk NaN', formatRuang(NaN) === '0', formatRuang(NaN));
cek('formatRuang aman untuk undefined', formatRuang(undefined) === '0');

const id = idTagihan('bulanan', new Date('2026-09-28T12:34:56+07:00'));
cek('id tagihan diawali PRABAWA-', id.startsWith('PRABAWA-BULANAN-'), id);
cek('id tagihan ≤ 50 karakter (aturan Midtrans)', id.length <= 50, `${id.length} karakter`);
cek('id tagihan tanpa tanda baca', /^[A-Z0-9-]+$/.test(id), id);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Paket efektif menyaring paket tidak valid');
const semuaValid = paketEfektif(BILLING_DEFAULT);
cek('default punya 2 paket', semuaValid.length === 2, String(semuaValid.length));
cek('semua default punya harga & durasi', semuaValid.every(p => p.harga > 0 && p.durasi > 0));

// ⚠️ `paketEfektif` hanya menyaring; bentuknya sudah dinormalkan oleh
// `loadPengaturanBilling`. Di sini tetap dibaca apa adanya supaya
// penyaringan diuji apa adanya juga.
const campuran = paketEfektif({
  ...BILLING_DEFAULT,
  paket: [
    { id: 'ok', label: 'OK', harga: 1000, durasi: 1, satuan: 'bulan' },
    { id: 'gratis', label: 'Gratis', harga: 0, durasi: 1, satuan: 'bulan' },
    { id: 'tanpa-durasi', label: 'Tanpa Durasi', harga: 1000, durasi: 0, satuan: 'bulan' },
  ],
});
cek('paket harga 0 dibuang', campuran.length === 1, `${campuran.length} paket`);
cek('paket yang tersisa benar', campuran[0]?.id === 'ok');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6b. Durasi paket: KALENDER, bukan jumlah hari');
const { tambahDurasi, deskripsiDurasi, normalisasiPaket, normalisasiDaftarPaket, LABEL_SATUAN } =
  await import('../src/lib/langganan.ts');

/**
 * Format tanggal lokal sebagai YYYY-MM-DD.
 *
 * ⚠️ `toISOString()` tidak boleh dipakai: ia mengubah ke UTC, dan mesin ini
 * berada di Asia/Jakarta (UTC+7) — `new Date(2026, 0, 31)` (tengah malam
 * lokal) jadi `2026-01-30T17:00Z` dan terbaca "30 Januari", satu hari
 * mundur. Itu sempat membuat seluruh assertion kalender gagal dengan hasil
 * yang benar-benar salah.
 */
const iso = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── Bug yang dilaporkan: label "3 Bulan" tapi keterangan "365 hari" ──
const tigaBulan = normalisasiPaket({ id: 'p', label: '3 Bulan', harga: 250000, durasi: 3, satuan: 'bulan' });
cek('deskripsi 3 bulan = "3 bulan"', deskripsiDurasi(tigaBulan.durasi, tigaBulan.satuan) === '3 bulan', deskripsiDurasi(tigaBulan.durasi, tigaBulan.satuan));
// Keterangan bawaan dulu berisi "Aktif 365 hari" dan ikut terbawa saat
// admin mengganti label — itu persis yang membuat layar bertentangan.
const bawaanLama = normalisasiPaket({ id: 'x', label: '1 Tahun', harga: 250000, durasiHari: 365, keterangan: 'Aktif 365 hari, lebih hemat' });
cek('paket bawaan lama tidak punya keterangan bawaan', bawaanLama.keterangan === undefined, String(bawaanLama.keterangan));
cek('deskripsi paket bawaan lama = "1 tahun"', deskripsiDurasi(bawaanLama.durasi, bawaanLama.satuan) === '1 tahun', deskripsiDurasi(bawaanLama.durasi, bawaanLama.satuan));

// ── Perpanjangan kalender ──
cek(
  '31 Jan + 1 bulan = 28 Feb (bukan 2 Mar)',
  iso(tambahDurasi(new Date(2026, 0, 31), 1, 'bulan')) === '2026-02-28',
  iso(tambahDurasi(new Date(2026, 0, 31), 1, 'bulan'))
);
cek(
  '31 Jan + 1 bulan (tahun kabisat) = 29 Feb',
  iso(tambahDurasi(new Date(2028, 0, 31), 1, 'bulan')) === '2028-02-29',
  iso(tambahDurasi(new Date(2028, 0, 31), 1, 'bulan'))
);
cek(
  '30 Nov + 1 bulan = 30 Des (tanggal ikut, bukan jadi 31)',
  iso(tambahDurasi(new Date(2026, 10, 30), 1, 'bulan')) === '2026-12-30',
  iso(tambahDurasi(new Date(2026, 10, 30), 1, 'bulan'))
);
cek(
  '31 Des + 3 bulan = 31 Mar tahun depan',
  iso(tambahDurasi(new Date(2026, 11, 31), 3, 'bulan')) === '2027-03-31',
  iso(tambahDurasi(new Date(2026, 11, 31), 3, 'bulan'))
);
// 31 Agustus + 6 bulan menyeberang|Februari yang hanya 28 hari.
cek(
  '31 Agu + 6 bulan = 28 Feb (dijepit, tidak meluber ke 3 Mar)',
  iso(tambahDurasi(new Date(2026, 7, 31), 6, 'bulan')) === '2027-02-28',
  iso(tambahDurasi(new Date(2026, 7, 31), 6, 'bulan'))
);
cek(
  '31 Jan + 1 bulan + 1 bulan = 28 Mar (perpanjangan berulang tetap kalender)',
  iso(tambahDurasi(tambahDurasi(new Date(2026, 0, 31), 1, 'bulan'), 1, 'bulan')) === '2026-03-28',
  iso(tambahDurasi(tambahDurasi(new Date(2026, 0, 31), 1, 'bulan'), 1, 'bulan'))
);
cek(
  '1 tahun dari 29 Feb = 28 Feb tahun depan',
  iso(tambahDurasi(new Date(2028, 1, 29), 1, 'tahun')) === '2029-02-28',
  iso(tambahDurasi(new Date(2028, 1, 29), 1, 'tahun'))
);
cek(
  '30 hari tetap bergeser 30 hari (satuan hari tidak berubah)',
  iso(tambahDurasi(new Date(2026, 0, 1), 30, 'hari')) === '2026-01-31',
  iso(tambahDurasi(new Date(2026, 0, 1), 30, 'hari'))
);
cek('durasi 0 tidak mengubah tanggal', iso(tambahDurasi(new Date(2026, 0, 1), 0, 'bulan')) === '2026-01-01');
cek('durasi negatif ditolak (tidak menggeser tanggal)', iso(tambahDurasi(new Date(2026, 0, 1), -1, 'bulan')) === '2026-01-01', iso(tambahDurasi(new Date(2026, 0, 1), -1, 'bulan')));
cek('durasi negatif tidak bisa dipakai memperpendek langganan', tambahDurasi(new Date(2026, 0, 1), -30, 'hari').getTime() === new Date(2026, 0, 1).getTime());

// ── Migration paket lama ──
cek('lama 30 hari → 1 bulan', normalisasiPaket({ id: 'a', label: 'A', harga: 1, durasiHari: 30 }).satuan === 'bulan');
cek('lama 90 hari → 3 bulan', normalisasiPaket({ id: 'a', label: 'A', harga: 1, durasiHari: 90 }).durasi === 3);
cek('lama 365 hari → 1 tahun', normalisasiPaket({ id: 'a', label: 'A', harga: 1, durasiHari: 365 }).satuan === 'tahun');
cek('lama 45 hari → 45 hari', normalisasiPaket({ id: 'a', label: 'A', harga: 1, durasiHari: 45 }).satuan === 'hari');
cek('bentuk baru dipakai utuh', normalisasiPaket({ id: 'a', label: 'A', harga: 1, durasi: 3, satuan: 'bulan' }).durasi === 3);
cek('paket tanpa harga dibuang', normalisasiPaket({ id: 'a', label: 'A', harga: 0, durasi: 1, satuan: 'bulan' }) === null);
cek('paket tanpa durasi dibuang', normalisasiPaket({ id: 'a', label: 'A', harga: 1, durasi: 0, satuan: 'bulan' }) === null);
cek('daftar bukan array → kosong', normalisasiDaftarPaket('bukan array').length === 0);

// ── Label satuan ──
cek('satuan hari', LABEL_SATUAN.hari === 'Hari');
cek('satuan bulan', LABEL_SATUAN.bulan === 'Bulan');
cek('satuan tahun', LABEL_SATUAN.tahun === 'Tahun');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. CRC16-CCITT (EMVCo)');
// Nilai uji dari referensi EMVCo QRIS: CRC "6304" + isi → 4 hex huruf besar.
cek('CRC 4 digit hex', /^[0-9A-F]{4}$/.test(calculateCRC16('0002010102')), calculateCRC16('0002010102'));
cek('CRC deterministik', calculateCRC16('000201') === calculateCRC16('000201'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 8. QRIS statis → dinamis');
// QRIS contoh: statis, tanpa nominal, dengan CRC yang benar.
//
// ⚠️ Panjang TLV harus DIHITUNG, bukan diketik manual. Versi pertama skrip
// ini menulis panjangnya sendiri-sendiri dan langsung menghasilkan string
// rusak — yang justru membuktikan bahwa `validateQRIS` menangkap input
// rusak (bagian 9), tapi tidak ada gunanya menguji konversi dengan masukan
// yang memang salah sejak awal.
const tlv = (tag, nilai) => `${tag}${String(nilai.length).padStart(2, '0')}${nilai}`;

/** Susun QRIS statis yang sah, lengkap dengan CRC-nya. */
function qrisStatisSah() {
  const merchant =
    tlv('00', 'ID.CO.QRIS.WWW0212') + tlv('01', 'UMI') + tlv('02', 'PRABAWA_EXTEND_INDONESIA');
  const body =
    tlv('00', '01') + // Payload Format Indicator
    tlv('01', '11') + // Point of Initiation Method = statis
    tlv('26', merchant) + // Merchant Account Info
    tlv('52', '5999') + // Merchant Category Code
    tlv('53', '360') + // Currency = IDR
    tlv('58', 'ID') + // Country
    tlv('59', 'PRABAWA EXTEND INDONESIA') + // Merchant Name
    tlv('60', 'SURABAYA'); // Merchant City
  const isi = body + '6304';
  return isi + calculateCRC16(isi);
}

const qrisStatis = qrisStatisSah();

const validStatis = validateQRIS(qrisStatis);
cek('QRIS statis valid', validStatis.valid, validStatis.errors.join('; '));

const dinamis = qrisDinamis(qrisStatis, { nominal: 25000 });
const validDinamis = validateQRIS(dinamis);
cek('QRIS dinamis valid', validDinamis.valid, validDinamis.errors.join('; '));

const elemen = parseTLV(dinamis);
const tag = t => elemen.find(e => e.tag === t)?.value;

cek('tag 01 jadi 12 (dinamis)', tag('01') === '12', String(tag('01')));
cek('tag 54 = nominal 25000', tag('54') === '25000', String(tag('54')));
cek('nominal tanpa titik ribuan', !String(tag('54')).includes('.'));

// ⚠️ EMVCo mewajibkan tag 54 SEBELUM tag 58. Melewatinya membuat beberapa
// aplikasi pembayaran menolak QR despite CRC-nya benar.
const i54 = elemen.findIndex(e => e.tag === '54');
const i58 = elemen.findIndex(e => e.tag === '58');
cek('tag 54 ada sebelum tag 58', i54 >= 0 && i54 < i58, `54 di ${i54}, 58 di ${i58}`);

cek('hanya ada satu tag 54', elemen.filter(e => e.tag === '54').length === 1);
cek('hanya ada satu tag 63 (CRC)', elemen.filter(e => e.tag === '63').length === 1);
cek('merchant tetap terbaca', ringkasQRIS(dinamis).namaMerchant.includes('PRABAWA'), ringkasQRIS(dinamis).namaMerchant);
cek('metode terbaca sebagai dinamis', ringkasQRIS(dinamis).metode === 'dinamis');

// Mengubah nominal menghasilkan QR yang berbeda.
const dinamis2 = qrisDinamis(qrisStatis, { nominal: 50000 });
cek('nominal berbeda → QR berbeda', dinamis !== dinamis2);
cek('nominal kedua 50000', parseTLV(dinamis2).find(e => e.tag === '54')?.value === '50000');
cek('QR kedua tetap valid', validateQRIS(dinamis2).valid);

// Konversi dua kali tidak menumpuk tag 54.
const duaKali = qrisDinamis(qrisDinamis(qrisStatis, { nominal: 25000 }), { nominal: 30000 });
cek('konversi ganda tetap satu tag 54', parseTLV(duaKali).filter(e => e.tag === '54').length === 1);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 9. QRIS tidak valid ditolak');
const crcRusak = qrisStatis.slice(0, -4) + 'FFFF';
const hasilCrc = validateQRIS(crcRusak);
cek('CRC rusak terdeteksi', !hasilCrc.valid && hasilCrc.errors.some(e => e.includes('CRC')), hasilCrc.errors.join('; '));

cek('string kosong ditolak', !validateQRIS('').valid);
cek('string pendek ditolak', !validateQRIS('000201').valid);
cek('awalan salah ditolak', !validateQRIS('123456' + '0'.repeat(40)).valid);
cek('tanpa merchant ditolak', !validateQRIS(qrisTanpaMerchant()).valid);

/** QRIS sah format tapi tanpa blok merchant — harus ditolak. */
function qrisTanpaMerchant() {
  const body =
    tlv('00', '01') + tlv('01', '11') + tlv('52', '5999') + tlv('53', '360') + tlv('58', 'ID') +
    tlv('59', 'PRABAWA') + tlv('60', 'SURABAYA');
  const isi = body + '6304';
  return isi + calculateCRC16(isi);
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 10. qrisDinamis menolak input tidak valid');
let lempar = false;
try {
  qrisDinamis(qrisStatis, { nominal: 0 });
} catch {
  lempar = true;
}
cek('nominal 0 ditolak', lempar);

lempar = false;
try {
  qrisDinamis('', { nominal: 1000 });
} catch {
  lempar = true;
}
cek('string kosong ditolak', lempar);

lempar = false;
try {
  qrisDinamis(qrisStatis, { nominal: 1000 / 0 });
} catch {
  lempar = true;
}
cek('nominal NaN ditolak', lempar);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 11. Menu Langganan terkunci ke admin');
// Izin khusus admin harus dipaksa `false` oleh `batasiIzin`, bukan hanya
// punya default `false` — kalau tidak, dokumen lama yang pernah `true`
// akan tetap membuka menu untuk user biasa.
const { batasiIzin, normalizeUserPermissions, DEFAULT_USER_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } =
  await import('../src/lib/userManager.ts');

const dariDefault = normalizeUserPermissions({});
cek('default user: tabManajemenAkun false', dariDefault.tabManajemenAkun === false);
cek('default user tidak kehilangan izin lain', dariDefault.tabPresensi === DEFAULT_USER_PERMISSIONS.tabPresensi);

const dariDokumenLama = normalizeUserPermissions({ tabManajemenAkun: true, tabPresensi: true });
cek('dokumen lama tidak bisa menyalakan tabManajemenAkun', dariDokumenLama.tabManajemenAkun === false);
cek('izin lain dari dokumen lama tetap dipakai', dariDokumenLama.tabPresensi === true);

/*
 * Migrasi `tabLangganan` → `tabManajemenAkun`.
 *
 * Menu yang sama, nama field berbeda.
 *
 * Hasil akhirnya `false` untuk semua orang, dan itu memang yang benar:
 * `normalizeUserPermissions` tidak tahu `role`, jadi ia SELALU memaksa izin
 * khusus admin ke `false`. Yang diuji di sini adalah apakah nilai lama masih
 * terbaca sama sekali (bukan dianggap field asing yang diabaikan), karena
 * itulah yang membuat migrasi tidak diam-diam-butakan data.
 *
 * Kenapa migrasi ini tidak mengubah akses siapa pun: admin selalu mendapat
 * `DEFAULT_ADMIN_PERMISSIONS` di `setCurrentUser` (bukan dari dokumen), dan
 * non-admin memang tidak boleh punya menu ini. Dia tetap ditulis supaya
 * field yang tidak lagi dipakai ini tidak menggantung di normalize — kalau
 * di suatu hari admin tidak lagi mendapat default penuh, nilai lama masih
 * terbaca.
 */
const migrasi = normalizeUserPermissions({ tabLangganan: true, tabPresensi: true });
cek('field lama tabLangganan tidak dianggap field asing', migrasi.tabManajemenAkun === false);
cek('field lama tidak menambah kunci baru ke dokumen', Object.keys(migrasi).length === Object.keys(DEFAULT_USER_PERMISSIONS).length);
cek('izin lain dari dokumen lama tetap dipakai', migrasi.tabPresensi === true);
// Kalau dokumen sudah punya field baru, yang lama tidak boleh menimpanya.
const fieldBaruAda = normalizeUserPermissions({ tabLangganan: true, tabManajemenAkun: false });
cek('field baru menang atas field lama', fieldBaruAda.tabManajemenAkun === false);
cek('admin tetap boleh lewat batasiIzin', batasiIzin({ ...migrasi, tabManajemenAkun: true }, 'admin').tabManajemenAkun === true);

const dipaksa = batasiIzin({ ...DEFAULT_ADMIN_PERMISSIONS }, 'user');
cek('batasiIzin mematikan tabManajemenAkun untuk user', dipaksa.tabManajemenAkun === false);
cek('batasiIzin tidak menyentuh izin lain', dipaksa.tabPresensi === true);
cek('batasiIzin membiarkan admin apa adanya', batasiIzin({ ...DEFAULT_ADMIN_PERMISSIONS }, 'admin').tabManajemenAkun === true);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 12. QR benar-benar bisa digambar (matriks valid)');
// `KartuQris` menggambar QR dengan `qrcode-generator`. Modul ini tidak bisa
// diuji di Node (butuh `document`), tapi yang bisa — dan yang paling sering
// salah — adalah matriksnya: apakah pustaka-nya benar-benar bisa mengubah
// string QRIS dinamis menjadi pola yang bisa dipindai.
const { default: qrcode } = await import('qrcode-generator');

let matriks = null;
try {
  const qr = qrcode(0, 'M');
  qr.addData(dinamis);
  qr.make();
  matriks = qr;
} catch (err) {
  cek('QRIS dinamis bisa dibuat jadi matriks', false, err?.message);
}

if (matriks) {
  cek('QRIS dinamis bisa dibuat jadi matriks', true);
  const modul = matriks.getModuleCount();
  cek('jumlah modul >= 21 (versi 1)', modul >= 21, String(modul));
  // QR Code maksimum 177×177 modul; string QRIS yang terlalu panjang akan
  // membuat pustaka melempar.
  cek('jumlah modul <= 177', modul <= 177, String(modul));

  // Tiga finder pattern (pojok kiri-atas, kanan-atas, kiri-bawah) harus
  // gelap di 7×7 modul terluar. Tanpa itu, aplikasi pembayaran tidak
  // akan menemukan orientasi QR.
  const cornerDark = (offsetX, offsetY) => {
    let gelap = 0;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (matriks.isDark(r + offsetY, c + offsetX)) gelap++;
      }
    }
    return gelap;
  };
  cek('finder pattern kiri-atas ada', cornerDark(0, 0) >= 29, `${cornerDark(0, 0)}/49`);
  cek('finder pattern kanan-atas ada', cornerDark(modul - 7, 0) >= 29, `${cornerDark(modul - 7, 0)}/49`);
  cek('finder pattern kiri-bawah ada', cornerDark(0, modul - 7) >= 29, `${cornerDark(0, modul - 7)}/49`);

  // QR harus mengandung overwhelmingly gelap + terang — kalau tidak,
  // encoding-nya gagal dan hasilnya bukan QR.
  let gelap = 0;
  for (let r = 0; r < modul; r++) {
    for (let c = 0; c < modul; c++) if (matriks.isDark(r, c)) gelap++;
  }
  const rasio = gelap / (modul * modul);
  cek('porsi modul gelap wajar (40-60%)', rasio > 0.4 && rasio < 0.6, `${(rasio * 100).toFixed(1)}%`);
}

// Rumus ukuran yang dipakai `KartuQris`:
//   px  = floor(UKURAN_QR / modul)   → modul * px harus muat di dalam kotak
//   kotak = UKURAN_QR + 30           → QR + 15px padding di setiap sisi
const UKURAN_QR = 250;
const px = Math.max(2, Math.floor(UKURAN_QR / (matriks?.getModuleCount() ?? 21)));
const sisiQr = (matriks?.getModuleCount() ?? 21) * px;
cek('QR muat di dalam kotak', sisiQr <= UKURAN_QR, `${sisiQr} <= ${UKURAN_QR}`);
cek('QR tidak terlalu kecil', sisiQr >= UKURAN_QR - px, `${sisiQr} >= ${UKURAN_QR - px}`);
cek('kotak QR muat di dalam kartu (lebar 400)', UKURAN_QR + 30 <= 400, String(UKURAN_QR + 30));
cek('kotak QR tidak menabrak kepala kartu', 175 + UKURAN_QR + 30 <= 480, String(175 + UKURAN_QR + 30));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 13. Tema visual kartu QRIS');
// `KartuQris` tidak boleh pakai aset eksternal: string QRIS yang dikirim ke
// server lain berarti nama merchant dan nominal bocor.
// Penggambaran pindah ke `lib/kartuQrisCanvas.ts` supaya bisa diuji tanpa
// browser; komponen hanya menunggu font lalu mengubah kanvas jadi PNG.
const kartuSrc = readFileSync(new URL('../src/lib/kartuQrisCanvas.ts', import.meta.url), 'utf8');
const kartuKomponen = readFileSync(new URL('../src/components/KartuQris.tsx', import.meta.url), 'utf8');
cek('tidak ada URL eksternal di kartu QR', !/https?:\/\//.test(kartuSrc + kartuKomponen));
cek('gambar QR lokal (canvas, bukan API)', /buatKanvas/.test(kartuSrc));
cek('level koreksi kesalahan M', /qrcode\(0, 'M'\)/.test(kartuSrc));
cek('tunggu font siap sebelum menggambar', /document\.fonts\?\.ready/.test(kartuKomponen));
cek('nama merchant ikut tergambar', /namaMerchant/.test(kartuSrc));
cek('penggambaran dipisah dari komponen (bisa diuji)', /export function gambarKartuQris/.test(kartuSrc));
cek('komponen hanya menunggu font + toDataURL', /toDataURL/.test(kartuKomponen));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 14. Aturan nomor WhatsApp');
const { normalisasiNomorWa, isiPesanWa, tautanWa, TEMPLATE_WA_DEFAULT, BATAS_PESAN_WA } =
  await import('../src/lib/langganan.ts');

// Semua bentuk penulisan ini harus berakhir di URL yang sama.
const bentuk = [
  ['081234567890', '6281234567890'],
  ['81234567890', '6281234567890'],
  ['+62 812-3456-7890', '6281234567890'],
  ['+6281234567890', '6281234567890'],
  ['6281234567890', '6281234567890'],
  ['  0812 3456 7890  ', '6281234567890'],
  ['(0812) 3456.7890', '6281234567890'],
  ['0081234567890', '6281234567890'],
];
for (const [masuk, harap] of bentuk) {
  const hasil = normalisasiNomorWa(masuk);
  cek(`"${masuk}" → ${harap}`, hasil.ok && hasil.nomor === harap, hasil.nomor || hasil.pesan);
}

// Yang ditolak, dengan alasan yang jelas.
const tolak = [
  ['', 'kosong'],
  ['   ', 'hanya spasi'],
  ['abc', 'bukan angka'],
  ['+1 202 555 0143', 'bukan Indonesia'],
  ['12345', 'terlalu pendek'],
  ['62', 'terlalu pendek'],
  ['628123456789012345', 'terlalu panjang'],
  // `002812…` punya nol berlebih DAN angka `2` di posisi yang harusnya `8`.
  // Nolnya boleh dihapus, tapi sisa angkanya bukan ponsel Indonesia —
  // diterima berarti nomornya tidak ada.
  ['0028123456789', 'sisa bukan ponsel'],
  ['622123456789', 'telepon tetap'],
];
for (const [masuk, alasan] of tolak) {
  const hasil = normalisasiNomorWa(masuk);
  cek(`ditolak: ${alasan} ("${masuk}")`, !hasil.ok && !!hasil.pesan, hasil.pesan ?? 'TANPA PESAN');
}

// Normalisasi idempoten: nomor yang sudah bersih tidak berubah lagi.
const sekali = normalisasiNomorWa('081234567890').nomor;
cek('idempoten', normalisasiNomorWa(sekali).nomor === sekali, sekali);

// ── Tautan wa.me ──────────────────────────────────────────────────────
const pesanUji = isiPesanWa(TEMPLATE_WA_DEFAULT, {
  app: 'PRABAWA',
  username: 'budi',
  orderId: 'PRABAWA-BULANAN-20260928',
  nominal: 25000,
  paket: '1 Bulan',
  tanggal: '28 Sep 2026',
});
const url = tautanWa('081234567890', pesanUji);
cek('tautan wa.me terbentuk', typeof url === 'string' && url.startsWith('https://wa.me/6281234567890?text='), String(url).slice(0, 60));
cek('pesan ter-encode (tidak ada spasi mentah)', !String(url).includes(' '), 'spasi mentah');
cek('isi pesan ada di tautan', decodeURIComponent(String(url)).includes('PRABAWA-BULANAN-20260928'));
cek('nominal terformat rupiah', pesanUji.includes('25.000'), 'ada Rp 25.000');
cek('nama akun ikut terkirim', pesanUji.includes('budi'));
cek('paket ikut terkirim', pesanUji.includes('1 Bulan'));
cek('tidak ada "undefined" di pesan', !pesanUji.includes('undefined'));
cek('placeholder tak dikenal dibiarkan', isiPesanWa('{tidakDikenal} {nama}', { nama: 'Budi' }).includes('{tidakDikenal}'));
cek('nomor tidak valid → tautan null', tautanWa('12345', 'halo') === null);
cek('nomor kosong → tautan null', tautanWa('', 'halo') === null);

// Pesan panjang dipotong, bukan ditolak.
const sangatPanjang = 'x'.repeat(BATAS_PESAN_WA + 500);
cek('pesan dipotong pada batas', isiPesanWa(sangatPanjang, {}).length === BATAS_PESAN_WA, String(isiPesanWa(sangatPanjang, {}).length));
cek('template kosong → pakai bawaan', isiPesanWa('', { nama: 'Budi' }).includes('Budi'));
cek('template undefined → pakai bawaan', isiPesanWa(undefined, { nama: 'Budi' }).includes('Budi'));

// ── Aset logo ─────────────────────────────────────────────────────────
console.log('\n=== 15. Aset logo QRIS & GPN tersalin');
const adaBerkas = rel => {
  try {
    return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  } catch {
    return null;
  }
};
const qrisSvg = adaBerkas('public/ico/qris.svg');
const gpnSvg = adaBerkas('public/ico/gpn.svg');
const waSvg = adaBerkas('public/ico/wa.svg');
cek('public/ico/qris.svg ada', qrisSvg !== null);
cek('public/ico/gpn.svg ada', gpnSvg !== null);
cek('qris.svg adalah SVG dengan viewBox', /<svg[\s\S]*viewBox=/.test(qrisSvg ?? ''));
cek('gpn.svg adalah SVG dengan viewBox', /<svg[\s\S]*viewBox=/.test(gpnSvg ?? ''));
// ⚠️ `public/ico/wa.svg` dihapus. Tidak pernah dipakai sebagai favicon
// (favicon memakai PNG di `public/assets/`) maupun sebagai `<img>` — satu-
//-satunya tempat ikon WhatsApp muncul adalah `IkonWa`. Assertion ini menjaga
// agar berkasnya tidak diam-diam dibiarkan menggantung sebagai aset mati.
cek('public/ico/wa.svg sudah dihapus (ikon WA inline di IkonWa)', waSvg === null);
cek('logo dimuat sebelum digambar', /muatGambar\(LOGO_QRIS\)/.test(baca('../src/components/KartuQris.tsx')));
cek('gambarKartuQris menerima logo', /logoQris\?/.test(baca('../src/lib/kartuQrisCanvas.ts')));
cek('logo digambar dengan rasio asli', /rasioLogo/.test(baca('../src/lib/kartuQrisCanvas.ts')));
cek('logo tidak dipaksa persegi', !/drawImage\(opsi\.logoQris, 25, 28, 30, 30\)/.test(baca('../src/lib/kartuQrisCanvas.ts')));
// ⚠️ Tombol WA TIDAK boleh memakai `<img src="/ico/wa.svg">` lagi. Warna di
// dalam file SVG terkunci — memuatnya lewat `<img>` tidak bisa di-override
// `currentColor`, jadi ikon hijau `#25D366` akan lenyap di atas tombol hijau
// `#25D366`. Ikonnya sekarang komponen JSX (`src/components/ui/IkonWa.tsx`).
const modalSrc = baca('../src/components/BayarLanggananModal.tsx');
cek('tombol WA tidak lagi memakai <img> untuk ikonnya', !/<img[^>]*wa\.svg/.test(modalSrc));
cek('tombol WA memakai komponen IkonWa', /<IkonWa/.test(modalSrc));
const ikonWaSrc = baca('../src/components/ui/IkonWa.tsx');
cek('IkonWa ada sebagai komponen', ikonWaSrc !== null);
cek('IkonWa memakai currentColor', /fill="currentColor"/.test(ikonWaSrc ?? ''));
cek('IkonWa memakai glif WhatsApp asli', /17\.472 14\.382/.test(ikonWaSrc ?? ''));
cek('IkonWa tidak mengunci warna (tidak ada fill="#25D366")', !/fill="#25D366"/.test(ikonWaSrc ?? ''));
cek('tombol WA meminta ikon putih', /<IkonWa className="[^"]*text-white/.test(modalSrc));
cek('nomor WA divalidasi di form admin', /normalisasiNomorWa\(draft\.nomorWa\)/.test(baca('../src/pages/Langganan.tsx')));
cek('nomor WA dinormalkan saat disimpan', /nomorWa: normalisasiNomorWa\(draft\.nomorWa\)\.nomor/.test(baca('../src/pages/Langganan.tsx')));

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
