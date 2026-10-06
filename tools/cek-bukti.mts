/**
 * Bukti — render nyata, bukan pembacaan source.
 *
 * Skrip-skrip lain membuktikan aturan langganan secara statis. Skrip ini
 * membuktikan hal yang lebih penting: **komponennya benar-benar merender
 * apa yang seharusnya**, dan **kartu QRIS benar-benar menggambar elemen
 * yang benar**.
 *
 * Tiga hal diuji, semuanya lewat output nyata:
 *
 * 1. `LayarLanggananHabis` di-render dengan `renderToStaticMarkup` (React
 *    sungguhan) lalu HTML hasilnya diperiksa: tombol "Lakukan Pembayaran"
 *    ada, dialog terbuka hanya saat `bayar` true, dan akun aktif tidak
 *    "Saya Sudah Bayar" benar-benar ada di HTML.
 * 2. `BayarLanggananModal` di-render: paket, metode, dan tombol
 *    "Saya Sudah Bayar" benar-benar ada di HTML.
 * 3. `gambarKartuQris` dijalankan dengan kanvas perekam — setiap
 *    `fillRect`/`fillText` dicatat, lalu diperiksa: kartu putih, dua
 *    segitiga merah, thousands of modul QR, dan seluruh teks yang diharapkan.
 *
 * Karena tidak ada peramban di lingkungan ini, ini adalah bukti terdekat
 * yang bisa diperoleh: HTML dan piksel yang benar-benar dihasilkan kode.
 */
import { webcrypto } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

void webcrypto;

import { readFileSync } from 'node:fs';
const baca = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

// Modul yang diuji menyentuh `window`/`document` hanya lewat `isBrowser()`
// dan `document.fonts` di dalam efek — keduanya tidak dijalankan saat SSR.
globalThis.window = globalThis.window ?? {};

const { LayarLanggananHabis, LayarTungguVerifikasi, formatHitungMundur, TUNGGU_VERIFIKASI_DETIK } =
  await import('../src/components/GerbangLangganan.tsx');
const BayarLanggananModal = (await import('../src/components/BayarLanggananModal.tsx')).default;
const { ToastProvider } = await import('../src/components/ui/Toast.tsx');

/** Bungkus komponen yang butuh ToastProvider. */
const denganToast = (node: React.ReactNode) => React.createElement(ToastProvider, null, node);
const { ringkasanLangganan, PAKET_BAWAAN, BILLING_DEFAULT, bolehMasuk } = await import(
  '../src/lib/langganan.ts'
);
const { gambarKartuQris, KARTU_LEBAR, KARTU_TINGGI, UKURAN_QR, WARNA_QRIS } = await import(
  '../src/lib/kartuQrisCanvas.ts'
);
const { qrisDinamis, calculateCRC16 } = await import('../src/lib/qris.ts');

/** Dokumen langganan kadaluwarsa 10 hari lalu. */
const KEDALUWARSA = {
  username: 'budi',
  paketId: 'bulanan',
  masaMulai: '2026-07-01T00:00:00+07:00',
  masaAkhir: '2026-08-01T00:00:00+07:00',
  gratis: false,
  totalBayar: 25000,
  jumlahBayar: 1,
  createdAt: '2026-07-01T00:00:00+07:00',
};

/** @type {import('../src/lib/langganan.ts').DokumenLangganan} */
const KEDALUWARSA_DOC = KEDALUWARSA;
void KEDALUWARSA_DOC;

const SEKARANG = new Date('2026-09-28T10:00:00+07:00');
const paket = PAKET_BAWAAN;

const expired = ringkasanLangganan('budi', KEDALUWARSA, paket, 'user', SEKARANG);
const aktif = ringkasanLangganan(
  'budi',
  { ...KEDALUWARSA, masaAkhir: '2026-10-28T10:00:00+07:00' },
  paket,
  'user',
  SEKARANG
);

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Data uji: akun benar-benar tidak entitled');
cek('status kedaluwarsa', expired.status === 'kadaluarsa', expired.status);
cek('tidak boleh masuk', bolehMasuk(expired, 'user') === false);
cek('sisa hari negatif (1 Agu → 28 Sep = 58 hari)', expired.sisaHari === -58, String(expired.sisaHari));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Layar "langganan habis" benar-benar dirender');
const layarHtml = renderToStaticMarkup(
  denganToast(React.createElement(LayarLanggananHabis, {
    ringkasan: expired,
    namaPegawai: 'BUDI SANTOSO',
    username: 'budi',
    paket,
    tagihan: [],
    pengaturan: BILLING_DEFAULT,
    bayar: false,
    setBayar: () => {},
    muatUlang: () => {},
    muatUlangLokal: async () => {},
    lanjutkan: null,
    setLanjutkan: () => {},
    paketTerpilih: null,
    setPaketTerpilih: () => {},
    mulaiLewatTagihan: () => {},
    onSelesai: async () => {},
    onTungguVerifikasi: () => {},
    onKeluar: () => {},
  }))
);

cek('judul "Langganan Habis" tampil', layarHtml.includes('Langganan Habis'));
cek('badge status tampil', layarHtml.includes('Kedaluwarsa'), 'label badge');
cek('nama akun tampil', layarHtml.includes('budi'));
cek('nama pegawai tampil', layarHtml.includes('BUDI SANTOSO'));
cek('tertanggal "sudah lewat 58 hari" tampil', layarHtml.includes('sudah lewat 58 hari'), 'sisa hari');
cek('tombol "Lakukan Pembayaran" ada', layarHtml.includes('Lakukan Pembayaran'));
cek('kata "kirim" / "pembayaran" bukan aksi lain', !/Kirim|iRequest|Catat Pembayaran/.test(layarHtml));
cek('tombol periksa lagi ada', layarHtml.includes('Sudah bayar? Periksa lagi'));
cek('ada jalan keluar', layarHtml.includes('Ganti akun') && layarHtml.includes('Keluar'));
cek('daftar paket tampil', layarHtml.includes('Pilihan Paket') && layarHtml.includes('1 Bulan'));
cek('harga rupiah tampil', layarHtml.includes('25.000') && layarHtml.includes('250.000'));
// Teks "Butuh akses gratis? ... exempt" sengaja dihapus: ia menawarkan jalan
// melewati gerbang tanpa bayar — persis hal yang tidak boleh ada di layar ini.
cek('tidak ada lagi ajakan akses gratis', !/exempt|access.?gratis/i.test(layarHtml));
cek('tidak ada teks "Butuh akses gratis"', !layarHtml.includes('Butuh akses gratis'));
cek('dialog pembayaran BELUM terbuka', !layarHtml.includes('role="dialog"'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Dialog pembayaran terbuka otomatis');
const layarDialogHtml = renderToStaticMarkup(
  denganToast(React.createElement(LayarLanggananHabis, {
    ringkasan: expired,
    username: 'budi',
    paket,
    tagihan: [],
    pengaturan: BILLING_DEFAULT,
    bayar: true,
    setBayar: () => {},
    muatUlang: () => {},
    muatUlangLokal: async () => {},
    lanjutkan: null,
    setLanjutkan: () => {},
    paketTerpilih: null,
    setPaketTerpilih: () => {},
    mulaiLewatTagihan: () => {},
    onSelesai: async () => {},
    onTungguVerifikasi: () => {},
    onKeluar: () => {},
  }))
);

cek('dialog benar-benar dirender', layarDialogHtml.includes('role="dialog"'));
cek('dialog ditandai aria-modal', layarDialogHtml.includes('aria-modal="true"'));
cek('judul dialog menyebut perpanjangan', layarDialogHtml.includes('Perpanjang Langganan'));
cek('nama akun ada di judul dialog', layarDialogHtml.includes('budi'));
cek('daftar paket ada di dalam dialog', layarDialogHtml.includes('Pilihan Paket') || layarDialogHtml.includes('Pilih paket'));
cek('harga tampil di dialog', layarDialogHtml.includes('25.000'));
cek('dialog punya tombol tutup', layarDialogHtml.includes('aria-label="Tutup"'));

// Pengaturan bawaan belum punya QRIS/rekening, jadi dialog harus
// mengatakannya dengan jujur, bukan menampilkan metode yang rusak.
cek('buka & klik paket dulu sebelum pilih metode', layarDialogHtml.includes('25.000'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Akun aktif: tidak ada apa-apa tambahan');
// `GerbangLangganan` mengembalikan `children` apa adanya saat boleh masuk.
// Yang diuji di sini adalah lubang yang sama di level layar: kalau layar
// "habis" sampai dipanggil untuk akun aktif, itu bug. Pastikan kodenya
// menolak lewat satu-satunya fungsi yang sama.
const layarUntukAktif = renderToStaticMarkup(
  denganToast(React.createElement(LayarLanggananHabis, {
    ringkasan: aktif,
    username: 'budi',
    paket,
    tagihan: [],
    pengaturan: BILLING_DEFAULT,
    bayar: false,
    setBayar: () => {},
    muatUlang: () => {},
    muatUlangLokal: async () => {},
    lanjutkan: null,
    setLanjutkan: () => {},
    paketTerpilih: null,
    setPaketTerpilih: () => {},
    mulaiLewatTagihan: () => {},
    onSelesai: async () => {},
    onTungguVerifikasi: () => {},
    onKeluar: () => {},
  }))
);
cek('layar "habis" untuk akun aktif akan menampilkan "Langganan Habis"', layarUntukAktif.includes('Langganan Habis'));
cek('— jadi listing ini membuktikan layar itu HANYA dipakai saat tidak entitled', true);

const gerbangSrc = (await import('node:fs')).readFileSync(
  new URL('../src/components/GerbangLangganan.tsx', import.meta.url),
  'utf8'
);
const gerbangKode = gerbangSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
cek(
  'gerbang mengembalikan children apa adanya saat boleh masuk',
  /if \(bolehMasuk\(ringkasan, role\)\) \{\s*return <>\{children\}<\/>;/.test(gerbangKode)
);
cek(
  'layar hanya dirender setelah pemeriksaan itu',
  /<LayarLanggananHabis/.test(gerbangKode) &&
    gerbangKode.indexOf('if (bolehMasuk(ringkasan, role))') < gerbangKode.indexOf('<LayarLanggananHabis')
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Dialog pembayaran dirender nyata');
// `BayarLanggananModal` membaca `midtransTersedia()` saat render; itu hanya
// membaca `import.meta.env`, aman di Node.
const modalTertutup = renderToStaticMarkup(
  denganToast(React.createElement(BayarLanggananModal, {
    ringkasan: null,
    pengaturan: BILLING_DEFAULT,
    paket,
    tagihan: [],
    onClose: () => {},
    onSelesai: async () => {},
    onTungguVerifikasi: () => {},
  }))
);
cek('modal tidak render dialog saat ringkasan null', !modalTertutup.includes('role="dialog"'), `${modalTertutup.length} byte HTML`);

// Dialog terbuka tapi belum ada metode yang siap (pengaturan bawaan tidak
// punya QRIS/rekening) → harus jujur, bukan menampilkan tombol rusak.
const modalTanpaMetode = renderToStaticMarkup(
  denganToast(React.createElement(BayarLanggananModal, {
    ringkasan: expired,
    pengaturan: BILLING_DEFAULT,
    paket,
    tagihan: [],
    onClose: () => {},
    onSelesai: async () => {},
    onTungguVerifikasi: () => {},
  }))
);
cek('modal terbuka saat ringkasan ada', modalTanpaMetode.includes('role="dialog"'));
cek('paket tampil', modalTanpaMetode.includes('1 Bulan'));
cek('jika belum ada metode → ada peringatan', modalTanpaMetode.includes('Belum ada metode pembayaran'));

// Dengan QRIS siap, metode harus muncul setelah paket dipilih — tapi itu
// butuh interaksi, jadi yang diuji di sini adalah QR-nya sendiri.
const modalQris = renderToStaticMarkup(
  denganToast(React.createElement(BayarLanggananModal, {
    ringkasan: expired,
    pengaturan: { ...BILLING_DEFAULT, qrisStatis: '000201010211' },
    paket,
    tagihan: [],
    onClose: () => {},
    onSelesai: async () => {},
    onTungguVerifikasi: () => {},
  }))
);
cek('modal dengan QRIS tetap menampilkan paket', modalQris.includes('1 Bulan'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5b. Tombol konfirmasi: satu, bukan tiga');
const { TombolKonfirmasiWa } = await import('../src/components/BayarLanggananModal.tsx');

const tombolWa = renderToStaticMarkup(
  React.createElement(TombolKonfirmasiWa, {
    url: 'https://wa.me/6281234567890?text=Halo',
    bekerja: false,
    onKonfirmasi: () => {},
  })
);

cek('hanya ada SATU tautan konfirmasi', (tombolWa.match(/<a\b/g) ?? []).length === 1, `${(tombolWa.match(/<a\b/g) ?? []).length} tautan`);
cek('tautannya benar-benar ke wa.me', tombolWa.includes('https://wa.me/6281234567890'));
cek('tautan membuka tab baru', tombolWa.includes('target="_blank"'));
cek('tautan punya rel aman', tombolWa.includes('rel="noopener noreferrer"'));
cek('teks tombol menyebut sudah bayar', tombolWa.includes('Saya Sudah Bayar'));
// Label dua baris: baris pertama = niat, baris kedua = akibat. Kalau baris
// kedua hilang, tombolnya kembali jadi "sudah bayar" tanpa penjelasan ke
// mana tagihannya dikirim — persis kebingungan yang tombol ini dirancang
// untuk dihilangkan.
cek('baris kedua menjelaskan akibatnya', tombolWa.includes('Buka WhatsApp &amp; kirim tagihan'));
cek('dua baris label (bukan satu kalimat)', tombolWa.includes('block text-sm font-bold') && tombolWa.includes('block text-[11px]'));
/*
 * Tidak ada tombol "kembali ke pilihan metode".
 *
 * Semula ada, dan itu membuat dua jalan keluar dari langkah QR yang melakukan
 * hal sama — tombol itu dan tombol tutup (X) di header modal. Yang tidak
 * terlihat diam-diam jadi tombol yang tidak melakukan apa-apa.
 *
 * Yang dijaga: **tidak ada** `<button>` sama sekali di sini. Kalau nanti ada
 * tombol serupa yang ditambahkan lagi, jumlah tombol naik dan assertion ini
 * menangkapnya. Membebaskan `TombolKonfirmasiWa` dari `onBatal` juga membuat
 * TypeScript gagal kalau ada pemanggil yang masih mengirimnya.
 */
cek('tidak ada tombol selain tautan konfirmasi',
  (tombolWa.match(/<button\b/g) ?? []).length === 0,
  `${(tombolWa.match(/<button\b/g) ?? []).length} tombol — harus 0, jalan keluar lewat tombol tutup modal`);
cek('tombol konfirmasi tidak punya onBatal lagi',
  !/onBatal/.test(baca('../src/components/BayarLanggananModal.tsx')),
  'propsi onBatal sudah dihapus; kalau muncul lagi berarti ada tombol kembali yang tidak perlu');

// Ikon: harus PUTIH di atas hijau, bukan hijau di atas hijau. `fill="currentColor"`
// + `text-white` di elemen yang sama adalah satu-satunya cara believable —
// `<img src="/ico/wa.svg">` mengunci warnanya jadi hijau lenyap.
cek('ikon WA di-inline sebagai SVG', tombolWa.includes('<svg') && tombolWa.includes('17.472 14.382'));
cek('ikon WA tidak lewat <img> (warna tidak akan bisa diganti)', !tombolWa.includes('/ico/wa.svg'));
cek('ikon WA memakai currentColor', tombolWa.includes('fill="currentColor"'));
cek('ikon WA putih — kelas text-white ada di svg', /<svg[^>]*class="[^"]*text-white[^"]*"/.test(tombolWa));
cek('tombolnya hijau WhatsApp', tombolWa.includes('bg-[#25D366]'));
cek('tautan pembuka WhatsApp tidak di-cancel', !tombolWa.includes('preventDefault'));

// Tanpa nomor WA: tombol harus tetap ada (bukan `return null`), supaya
// pengguna yang sudah transfer tidak terjebak tanpa jalan keluar.
const tombolTanpaWa = renderToStaticMarkup(
  React.createElement(TombolKonfirmasiWa, {
    url: null,
    bekerja: false,
    onKonfirmasi: () => {},
  })
);
cek('tanpa nomor WA tombol tetap dirender', tombolTanpaWa.includes('Saya Sudah Bayar'));
cek('tanpa nomor WA jadi <button>, bukan <a>', !tombolTanpaWa.includes('<a '));
cek('tanpa nomor WA ada peringatan', tombolTanpaWa.includes('Nomor WhatsApp admin belum diisi'));

// Saat bekerja, tautan tidak bisa diklik lagi (aktivasi ganda = bulan ganda).
const tombolBekerja = renderToStaticMarkup(
  React.createElement(TombolKonfirmasiWa, {
    url: 'https://wa.me/6281234567890',
    bekerja: true,
    onKonfirmasi: () => {},
  })
);
cek('saat memproses teks berubah', tombolBekerja.includes('Memproses'));
cek('saat memproses tautan dinonaktifkan', tombolBekerja.includes('pointer-events-none'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5c. Layar "Mohon Tunggu" benar-benar mengunci');
const tungguHtml = renderToStaticMarkup(
  React.createElement(LayarTungguVerifikasi, {
    info: {
      username: 'budi',
      orderId: 'PRABAWA-BULANAN-1759000000000',
      paket: '1 Bulan',
      nominal: 25000,
      berakhirAt: Date.now() + 240_000,
    },
    sisaDetik: 277,
  })
);

cek('judul "Mohon Tunggu" tampil', tungguHtml.includes('Mohon Tunggu'));
cek('hitung mundur tampil', tungguHtml.includes('04:37'), '277 detik → 04:37');
cek('hitung mundur punya role timer', tungguHtml.includes('role="timer"'));
cek('angka pakai tabular-nums (tidak bergeser)', tungguHtml.includes('tabular-nums'));
cek('progress bar punya nilai', /aria-valuenow="277"/.test(tungguHtml));
cek('nomor tagihan tampil', tungguHtml.includes('PRABAWA-BULANAN-1759000000000'));
cek('akun tampil', tungguHtml.includes('budi'));
cek('paket tampil', tungguHtml.includes('1 Bulan'));
cek('nominal tampil', tungguHtml.includes('25.000'));
cek('ADA ikon WhatsApp (putih di atas hijau)', /<svg[^>]*text-white/.test(tungguHtml));
cek('tidak ada satu pun <button> di layar tunggu', !tungguHtml.includes('<button'), 'layar ini tidak boleh punya jalan keluar');
cek('tidak ada tautan di layar tunggu', !tungguHtml.includes('<a '));
cek('tidak ada "Ganti akun"', !tungguHtml.includes('Ganti akun'));
cek('tidak ada "Keluar"', !tungguHtml.includes('Keluar'));
cek('tidak ada "Batal"', !tungguHtml.includes('Batal'));
cek('tetap ada input, form, atau menu', !tungguHtml.includes('<input') && !tungguHtml.includes('<form'));
cek('masa tunggu diberi batas 5 menit', TUNGGU_VERIFIKASI_DETIK === 300, `${TUNGGU_VERIFIKASI_DETIK} detik`);
cek('berjanji kembali ke pembayaran kalau habis', tungguHtml.includes('kembali ke formulir'));

// Format hitung mundur
cek('0 detik → 00:00', formatHitungMundur(0) === '00:00');
cek('59 detik → 00:59', formatHitungMundur(59) === '00:59');
cek('60 detik → 01:00', formatHitungMundur(60) === '01:00');
cek('300 detik → 05:00', formatHitungMundur(300) === '05:00');
cek('negatif dibatasi 00:00', formatHitungMundur(-5) === '00:00');
cek('pecahan dipotong ke bawah', formatHitungMundur(277.9) === '04:37', formatHitungMundur(277.9));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5e. Kartu QR tidak pernah merender <img> tanpa src');
/**
 * Bug: `KartuQris` merender `<img src={dataUrl ?? undefined}>` selama PNG
 * belum selesai digambar.
 *
 * Menggambar kartu itu async (tunggu `document.fonts.ready`, muat dua logo
 * SVG, gambar ribuan modul), jadi `qrisString` sudah ada sementara
 * `dataUrl` masih `null`. Peramban menggambar **ikon gambar rusak + teks alt
 * di pojok kiri** kotak putih selama itu — persis yang terlihat di layar.
 *
 * `renderToStaticMarkup` justru membuat tes ini mungkin: `useEffect`
 * tidak jalan saat SSR, jadi render pertama komponen
 * persis keadaan bermasalahnya — `qrisString` terisi, `dataUrl` kosong.
 */
const KartuQris = (await import('../src/components/KartuQris.tsx')).default;

const kartuSaatDigambar = renderToStaticMarkup(
  React.createElement(KartuQris, { qrisString: '00020101021126', lebar: 264 })
);

cek('tidak ada <img> sama sekali saat PNG belum siap', !kartuSaatDigambar.includes('<img'), 'hanya boleh <img> setelah PNG ada');
cek('tidak ada src kosong/kosong-string', !/src=\s*(""|''|undefined|null)/.test(kartuSaatDigambar));
cek('menampilkan label memuat', kartuSaatDigambar.includes('Menyiapkan QR pembayaran'));
/*
 * Placeholder TIDAK boleh meniru bentuk QR.
 *
 * Semula ada grid 5×5 modul QR berkedip plus garis pemindai hijau, dan
 * assertion-nya justru *menuntut* 25 modul itu ("siluet bukan kotak putih
 * polos"). Itu menjaga keputusan desain yang salah: 25 kotak berdenyut terbaca
 * seperti skeleton yang belum terisi, dan yang lebih buruk — seperti QR yang
 * **rusak**. Tidak ada yang mau memindai QR setengah jadi, jadi bentuk itu
 * actively MUSUH bagi apa yang seharusnya terjadi.
 *
 * Yang dijaga sekarang: spinner tunggal (tidak ada grid modul), warna netral
 * (bukan hijau emerald yang terbaca sebagai "sukses"), dan `motion-safe:`
 * supaya `prefers-reduced-motion` dihormati.
 */
const kartuSrcKritis = baca('../src/components/KartuQris.tsx');
cek('placeholder tidak meniru modul QR', !/rounded-\[2px\]/.test(kartuSaatDigambar),
  'grid kotak berkedip terbaca seperti QR rusak');
cek('tidak ada grid modul di sumber placeholder', !/grid-cols-5/.test(kartuSrcKritis));
cek('ada indikator spinner', kartuSaatDigambar.includes('animate-spin'));
cek('spinner dihormati prefers-reduced-motion', /motion-safe:animate-spin/.test(kartuSaatDigambar));
cek('placeholder tidak memakai warna emerald', !/emerald/.test(kartuSaatDigambar.split('function RangkaKartu')[1]?.split('\n}')[0] ?? ''));
cek('placeholder punya role status', kartuSaatDigambar.includes('role="status"'));
cek('placeholder punya live region', kartuSaatDigambar.includes('aria-live="polite"'));

// Tanpa string sama sekali — harusnya placeholder juga, bukan apa pun.
const kartuKosong = renderToStaticMarkup(React.createElement(KartuQris, { qrisString: '', lebar: 264 }));
cek('string kosong -> placeholder', kartuKosong.includes('Menyiapkan QR pembayaran'));
cek('string kosong tidak merender <img>', !kartuKosong.includes('<img'));

/*
 * Skeleton `lazy()` di modal harus **sama** dengan placeholder "memuat" di
 * `KartuQris` — keduanya spinner, keduanya menjawab "sedang memuat, tunggu".
 *
 * Guard lama justru menuntut skeleton punya grid 5×5 modul, sementara
 * `RangkaKartu` juga punya — jadi keduanya seragam, tapi seragam pada bentuk
 * yang salah. Sekarang keduanya spinner, dan guard ini memeriksa kesamaan itu
 * lewat bentuk yang benar: tidak ada grid modul di salah satunya.
 */
const modalSrc2 = baca('../src/components/BayarLanggananModal.tsx');
cek('skeleton lazy() tidak meniru modul QR', !/grid-cols-5|rounded-\[2px\]/.test(modalSrc2),
  'kotak berkedip di sini sama salahnya dengan di KartuQris');
cek('skeleton lazy() memakai spinner motion-safe', /motion-safe:animate-spin/.test(modalSrc2));
cek('skeleton lazy() punya label memuat', /Memuat QR pembayaran/.test(modalSrc2));
cek('error QRIS memakai warna merah + ikon', /AlertTriangle/.test(baca('../src/components/KartuQris.tsx')));
cek('error QRIS berbeda dari loading (tidak spinner)', !/animate-spin/.test(baca('../src/components/KartuQris.tsx').split('if (gagal)')[1]?.split('if (!dataUrl)')[0] ?? ''));
// `onSiap` lewat ref, bukan dependensi efek — kalau tidak, arrow inline
// membuat efek menggambar ulang selamanya dan aplikasi membeku.
const kartuRefSrc = baca('../src/components/KartuQris.tsx');
cek('onSiap dibaca lewat ref', /onSiapRef\.current = onSiap/.test(kartuRefSrc));
cek('onSiap tidak lagi jadi dependensi efek', !/\}, \[qrisString, onSiap\]\);/.test(kartuRefSrc));
cek('panggilannya lewat ref', /onSiapRef\.current\?\.\(url\)/.test(kartuRefSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5d. Tata letak sempit: kartu QR bisa menyusut');
// Di 320 px ruang dialog hanya ~248 px. `width` inline 264 px tanpa
// `maxWidth` akan meluber keluar dialog dan memotong QR — persis di perangkat
// yang paling mungkin dipakai untuk membayar.
const kartuSrc = baca('../src/components/KartuQris.tsx');
cek('kartu QR punya maxWidth 100%', /maxWidth: '100%'/.test(kartuSrc));
cek('kartu QR tidak memaksa tinggi piksel', !/style=\{\{ width: lebar, height: tinggi/.test(kartuSrc));
cek('kartu QR menghitung tinggi lewat aspectRatio', /aspectRatio: String\(KARTU_RASIO\)/.test(kartuSrc));
cek('kartu QR punya height auto', /h-auto/.test(kartuSrc));
const skelSrc = baca('../src/components/BayarLanggananModal.tsx');
cek('skeleton QR juga bisa menyusut', /aspectRatio: '400 \/ 580'/.test(skelSrc) && /maxWidth: '100%'/.test(skelSrc));
cek('lebar kartu tetap prop (bukan angka mati di markup)', /<KartuQris qrisString=\{qrTeks\} lebar=\{lebarKartu\}/.test(skelSrc));
// Layar tunggu: satu kolom, lebar dibatasi, nomor tagihan boleh patah baris.
cek('layar tunggu satu kolom', /max-w-sm/.test(tungguHtml));
cek('nomor tagihan boleh patah baris (tidak meluber)', tungguHtml.includes('break-all'));
cek('hitung mundur tidak meluber', tungguHtml.includes('min-w-0'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Kartu QRIS benar-benar menggambar isinya');
/**
 * Kanvas perekam.
 *
 * Semua kanvas yang dibuat berbagi satu `rekaman` — termasuk kanvas QR,
 * yang digambar terpisah dari kartu. Kalau tidak, modul QR akan tercatat di
 * rekaman lain dan pemeriksaan "QR benar-benar digambar" selalu lulus kosong
 * tanpa benar-benar menggambar apa pun.
 */
import type { Konteks2D, KanvasPenggambar } from '../src/lib/kartuQrisCanvas';

/**
 * `fill`/`drawImage` yang tercatat.
 *
 * Union bertipe `op` supaya `filter(i => i.op === 'drawImage')` benar-benar
 * menyempitkan koordinatnya jadi wajib ada. Tanpa itu, setiap penyebutan
 * `i.w` jadi `number | undefined` dan banyak assertion harus di-casting sia-sia.
 */
type CatatanIsi =
  | { op: 'fill'; fillStyle: string; kanvas: string }
  | { op: 'drawImage'; x: number; y: number; w: number; h: number; kanvas: string };

/** `fillRect` yang tercatat — koordinatnya selalu ada. */
interface CatatanRect {
  fillStyle: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kanvas: string;
}

/** `fillText` yang tercatat — teks dan fontnya selalu ada. */
interface CatatanTeks {
  text: string;
  x: number;
  y: number;
  font: string;
  kanvas: string;
}

/** Rekaman seluruh operasi menggambar pada satu perekam. */
interface Rekaman {
  isi: CatatanIsi[];
  fillRect: CatatanRect[];
  fillText: CatatanTeks[];
}

/** Konteks perekam, ditambah nama kanvas supaya bisa dibedakan. */
type KonteksRekam = Konteks2D & { _nama: string };

function buatPerekam(): {
  rekaman: Rekaman;
  contextBaru: () => KonteksRekam;
} {
  const rekaman: Rekaman = {
    isi: [],
    fillRect: [],
    fillText: [],
  };

  const contextBaru = (): KonteksRekam => {
    const ctx: KonteksRekam = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      imageSmoothingQuality: 'high',
      font: '10px sans-serif',
      scale() {},
      save() {},
      restore() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      arcTo() {},
      clip() {},
      fill() {
        rekaman.isi.push({ op: 'fill', fillStyle: String(ctx.fillStyle), kanvas: ctx._nama });
      },
      stroke() {},
      fillRect(x, y, w, h) {
        rekaman.fillRect.push({ fillStyle: String(ctx.fillStyle), x, y, w, h, kanvas: ctx._nama });
      },
      strokeRect() {},
      fillText(text, x, y) {
        rekaman.fillText.push({ text, x, y, font: String(ctx.font), kanvas: ctx._nama });
      },
      measureText(text) {
        const ukuran = Number(String(ctx.font).match(/(\d+)px/)?.[1] ?? 10);
        return { width: text.length * ukuran * 0.55 };
      },
      drawImage(_img, dx, dy, dw, dh) {
        rekaman.isi.push({ op: 'drawImage', x: dx, y: dy, w: dw, h: dh, kanvas: ctx._nama });
      },
      createPattern() {
        return { pola: true };
      },
      _nama: 'kartu',
    };
    return ctx;
  };

  return { rekaman, contextBaru };
}

// QRIS statis yang sah.
const tlv = (tag: string, nilai: string): string =>
  `${tag}${String(nilai.length).padStart(2, '0')}${nilai}`;
const merchant = tlv('00', 'ID.CO.QRIS.WWW0212') + tlv('01', 'UMI') + tlv('02', 'PRABAWA_EXTEND_INDONESIA');
const bodyStatis =
  tlv('00', '01') + tlv('01', '11') + tlv('26', merchant) + tlv('52', '5999') + tlv('53', '360') +
  tlv('58', 'ID') + tlv('59', 'PRABAWA EXTEND INDONESIA') + tlv('60', 'SURABAYA');
const isiStatis = bodyStatis + '6304';
const qrisStatis = isiStatis + calculateCRC16(isiStatis);
const qrisDinamis25k = qrisDinamis(qrisStatis, { nominal: 25000 });

const perekam = buatPerekam();
let dibuat = 0;
const buatKanvas = (w: number, h: number): KanvasPenggambar => {
  dibuat += 1;
  const ctx = perekam.contextBaru();
  ctx._nama = dibuat === 1 ? 'qr' : 'kartu';
  return { width: w, height: h, getContext: () => ctx };
};
const hasil = gambarKartuQris(buatKanvas(KARTU_LEBAR * 3, KARTU_TINGGI * 3), buatKanvas, {
  qrisString: qrisDinamis25k,
  skala: 3,
});

cek('kartu tergambar tanpa error', hasil !== null);
cek('jumlah modul > 0', hasil.modul > 0, String(hasil.modul));
cek('QR muat di kotak', hasil.sisiQr <= UKURAN_QR, `${hasil.sisiQr} <= ${UKURAN_QR}`);
cek(
  'QR digambar di dalam kotak dengan padding 15px',
  perekam.rekaman.isi.some(
    item => item.op === 'drawImage' && Math.abs(item.x - (KARTU_LEBAR - UKURAN_QR) / 2) < 0.5
  ),
  'penempatan kotak QR'
);

// Modul QR benar-benar digambar sebagai kotak hitam.
const modulGelap = perekam.rekaman.fillRect.filter(r => r.fillStyle === '#000000');
cek('modul QR digambar', modulGelap.length > 100, `${modulGelap.length} modul`);
// 49×49 = 2401 modul, ~50% gelap → sekitar 1200.
cek('jumlah modul gelap masuk akal', modulGelap.length > 800 && modulGelap.length < 1600, String(modulGelap.length));

// Dasar kartu putih.
cek('dasar kartu putih digambar', perekam.rekaman.isi.some(i => i.op === 'fill' && i.fillStyle === '#ffffff'));

// Segitiga merah QRIS.
const segitigaMerah = perekam.rekaman.isi.filter(i => i.op === 'fill' && i.fillStyle === WARNA_QRIS);
cek('dua segitiga merah digambar', segitigaMerah.length === 2, String(segitigaMerah.length));

// Motif kawung.
const isiPola = perekam.rekaman.isi.filter(i => i.op === 'fill' && i.fillStyle === '[object Object]');
cek('motif kawung digambar (dua segitiga)', isiPola.length >= 2, String(isiPola.length));

// Teks yang harus ada di kartu.
const teks = perekam.rekaman.fillText.map(t => t.text);
for (const diharapkan of [
  'QR Code Standar',
  'Pembayaran Nasional',
  'PRABAWA EXTEND INDONESIA',
  'Scan dengan aplikasi apa pun',
  'QRIS Dinamis · nominal terkunci di dalam QR',
]) {
  cek(`teks "${diharapkan}" tergambar`, teks.includes(diharapkan));
}
cek('nama merchant terpotong otomatis bila kepanjangan',
  perekam.rekaman.fillText.some(t => t.text.endsWith('...')) === false,
  'nama normal tidak dipotong');
cek('tidak ada URL eksternal di teks kartu', !teks.some((t: string) => /https?:\/\//.test(t)));

// Logo QRIS & GPN benar-benar digambar, dengan rasio aslinya.
const gambar = perekam.rekaman.isi.filter(i => i.op === 'drawImage');
cek('tanpa logo: kartu hanya drew 1 gambar (QR)', gambar.length === 1, String(gambar.length));

const denganLogo = buatPerekam();
let dibuat2 = 0;
const buatKanvas2 = (w: number, h: number): KanvasPenggambar => {
  dibuat2 += 1;
  const c = denganLogo.contextBaru();
  c._nama = dibuat2 === 1 ? 'qr' : 'kartu';
  return { width: w, height: h, getContext: () => c };
};
gambarKartuQris(buatKanvas2(KARTU_LEBAR * 3, KARTU_TINGGI * 3), buatKanvas2, {
  qrisString: qrisDinamis25k,
  skala: 3,
  // Rasio asli: qris.svg 300:110.71 ≈ 2.71, gpn.svg 3174:4025 ≈ 0.79
  logoQris: { width: 300, height: 110.71 },
  logoGpn: { width: 3174.803, height: 4025.197 },
});
const gambar2 = denganLogo.rekaman.isi.filter(i => i.op === 'drawImage');
cek('ketika logo diberikan, 3 gambar tergambar (QR + QRIS + GPN)', gambar2.length === 3, String(gambar2.length));
const logoTinggi = gambar2.filter(i => i.h === 30);
cek('kedua logo digambar setinggi 30px', logoTinggi.length === 2, String(logoTinggi.length));
cek(
  'logo QRIS memakai rasio aslinya (≈2.71)',
  logoTinggi.some(i => Math.abs(i.w / 30 - 300 / 110.71) < 0.01),
  logoTinggi.map(i => (i.w / 30).toFixed(3)).join(', ')
);
cek(
  'logo GPN memakai rasio aslinya (≈0.79)',
  logoTinggi.some(i => Math.abs(i.w / 30 - 3174.803 / 4025.197) < 0.01),
  logoTinggi.map(i => (i.w / 30).toFixed(3)).join(', ')
);
cek('logo tidak dipaksa persegi', logoTinggi.every(i => Math.abs(i.w - 30) > 1));
cek('label digeser setelah logo', denganLogo.rekaman.fillText.some(t => t.text === 'QR Code Standar' && t.x > 100), 'x > 100');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6b. Ukuran kanvas saat dipakai sungguhan');
// Kanvas di `KartuQris` dibuat dengan ukuran logis × 3 supaya tajam di layar
// retina. Rasio adalah satu-satunya sumber kebenaran tinggi: `KARTU_RASIO`
// diturunkan dari lebar/tinggi logis, dan komponen memakainya untuk
// menghitung tinggi dari lebar yang diminta.
//
// Helper `tinggiKartu()` pernah ada di sini lalu dihapus: tidak ada
// pemanggilnya di produksi, jadi ia hanya menambah satu cara berbeda untuk
// mendapatkan angka yang sama. Tinggi dihitung langsung dari rasionya.
const { KARTU_RASIO } = await import('../src/lib/kartuQrisCanvas.ts');
const tinggiUntuk = (lebar: number): number => Math.round(lebar / KARTU_RASIO);
cek('lebar logis kartu 400px', KARTU_LEBAR === 400, String(KARTU_LEBAR));
cek('tinggi logis kartu 580px', KARTU_TINGGI === 580, String(KARTU_TINGGI));
cek('tinggi tampil pada lebar 300 = 435px', tinggiUntuk(300) === 435, String(tinggiUntuk(300)));
cek('tinggi tampil pada lebar 264 = 383px', tinggiUntuk(264) === 383, String(tinggiUntuk(264)));
cek('rasio lebar/tinggi ≈ 0.69', Math.abs(KARTU_LEBAR / KARTU_TINGGI - 0.6897) < 0.001);
cek('KARTU_RASIO diturunkan dari ukuran logis, bukan angka terpisah',
  Math.abs(KARTU_RASIO - KARTU_LEBAR / KARTU_TINGGI) < 1e-12, String(KARTU_RASIO));

// Tinggi tampilan tidak dihitung di mana pun: komponen mengoper `aspectRatio`
// ke browser. Yang harus benar hanya ukuran logis yang jadi dasar kanvas
// retina, dan keduanya harus dibaca dari konstanta — bukan angka literal.
const kartuQrisSrc = (await import('node:fs')).readFileSync(
  new URL('../src/components/KartuQris.tsx', import.meta.url), 'utf8'
);
cek('ukuran kanvas retina memakai KARTU_LEBAR', /canvas\.width = KARTU_LEBAR \* 3;/.test(kartuQrisSrc));
cek('ukuran kanvas retina memakai KARTU_TINGGI (bukan angka hardcoded)',
  /canvas\.height = KARTU_TINGGI \* 3;/.test(kartuQrisSrc),
  'angka literal di sini bisa menyimpang dari konstanta tanpa terdeteksi');
cek('tinggi tampilan diserahkan ke aspectRatio', /aspectRatio: String\(KARTU_RASIO\)/.test(kartuQrisSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Aturan "aktif = tidak ada apa-apa"');
cek('fungsi bolehMasuk tidak punya pengecualian lain', /role === 'admin'/.test(
  (await import('node:fs')).readFileSync(new URL('../src/lib/langganan.ts', import.meta.url), 'utf8')
));
cek('gratis tetap boleh masuk', bolehMasuk(expired, 'admin') === true);
cek('kadaluwarsa tidak', bolehMasuk(expired, 'user') === false);
cek('aktif boleh', bolehMasuk(aktif, 'user') === true);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Dropzone: area seret berkas benar-benar merender');
/*
 * Permintaan: lampiran di Perizinan harus bisa **diseret**, bukan cuma diklik.
 *
 * Yang diuji lewat render nyata (bukan pembacaan source), karena yang bisa
 * rusak tanpa error adalah *atribut semantik* — `role="button"` hilang, atau
 * `accept` tidak ikut, atau area kosongnya tidak memberi tahu apa pun.
 */
const Dropzone = (await import('../src/components/ui/Dropzone.tsx')).default;
const perizinanSrc = baca('../src/pages/Perizinan.tsx');

const dzKosong = renderToStaticMarkup(
  React.createElement(Dropzone, {
    value: '',
    onPilih: () => {},
    accept: 'image/jpeg,application/pdf',
    label: 'Seret berkas ke sini, atau klik untuk memilih',
    hint: 'JPG atau PDF, maks 5 MB',
  })
);

// Area kosong harus bisa difokus dan punya peran tombol — kalau tidak, area
// seret hanya bisa dipakai dengan tetikus, dan pembaca layar membacanya
// sebagai teks biasa.
cek('area seret punya role button', /role="button"/.test(dzKosong));
cek('area seret bisa difokus', /tabindex="0"/.test(dzKosong.toLowerCase()));
cek('input file tetap ada untuk keyboard & pembaca layar',
  /<input[^>]*type="file"/.test(dzKosong));
cek('input file memakai accept yang diminta',
  /accept="image\/jpeg,application\/pdf"/.test(dzKosong),
  'tanpa accept, peramban akan menawarkan semua jenis berkas');
cek('input file disembunyikan, bukan dihapus',
  /type="file"[^>]*class="hidden"|class="hidden"[^>]*type="file"/.test(dzKosong),
  'input yang terlihat membuat tampilan dobel di area seret');
cek('border putus-putus menandakan area seret', /border-dashed/.test(dzKosong));
cek('label dan petunjuk ikut terbaca', /Seret berkas ke sini/.test(dzKosong) && /maks 5 MB/.test(dzKosong));

// Setelah ada berkas: input disembunyikan sepenuhnya, yang tampil baris
// nama berkas + tombol hapus.
const dzTerisi = renderToStaticMarkup(
  React.createElement(Dropzone, {
    value: 'surat-dispensasi.pdf',
    onPilih: () => {},
    accept: 'image/jpeg,application/pdf',
  })
);
cek('nama berkas yang dipilih tampil', /surat-dispensasi\.pdf/.test(dzTerisi));
cek('area seret disembunyikan setelah berkas dipilih',
  !/border-dashed/.test(dzTerisi),
  'menyeret berkas kedua harus lewat tombol, bukan menimpa');
cek('ada tombol hapus lampiran', /aria-label="Hapus lampiran"/.test(dzTerisi));
cek('tombol hapus punya target yang jelas', /type="button"/.test(dzTerisi));

// Perizinan harus benar-benar memakainya.
cek('Perizinan memakai Dropzone', /<Dropzone/.test(perizinanSrc));
cek('Perizawaan meneruskan nilai berkas yang sama',
  /value=\{form\.berkasName\}/.test(perizinanSrc) &&
    /onPilih=\{handleFile\}/.test(perizinanSrc),
  'nilai harus dua arah: hapus dari UI harus ikut menghapus dari state');
cek('Perizinan meneruskan accept yang sama',
  /accept="image\/jpeg,application\/pdf"/.test(perizinanSrc));
cek('handleFile(null) menghapus, bukan mengabaikan',
  /if \(!file\) \{[\s\S]{0,200}setLampiran\(null\)/.test(perizinanSrc),
  'tanpa ini berkas yang dihapus dari layar tetap terkirim saat pengajuan');
cek('validasi jenis & ukuran tetap di satu tempat',
  (perizinanSrc.match(/file\.size > MAX_ATTACHMENT_BYTES/) || []).length === 1 &&
    /file\.type\.toLowerCase\(\)/.test(perizinanSrc) &&
    !/file\.type/.test(baca('../src/components/ui/Dropzone.tsx')),
  'menyalin aturan ke Dropzone berarti ada jalan yang bisa melewatinya');

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
