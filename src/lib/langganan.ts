/**
 * Langganan & pembayaran.
 *
 * ## Aturan yang dipegang modul ini
 *
 * **Setiap akun wajib berlangganan.** Pengecualiannya ada dua: akun
 * `admin`, dan akun yang admin tandai gratis (exempt). Tidak ada akun
 * lain yang bisa masuk.
 *
 * **Masa aktif dihitung dari pembayaran, bukan dari tanggal login.**
 * Pembayaran menambah masa aktif dari `masaAkhir` yang sekarang, bukan
 * dari `hari ini` — jadi pengguna yang membayar dua bulan berturut-turut
 * tidak kehilangan sisa masa aktifnya.
 *
 * ## Kenapa dipisah dua
 *
 * Modul ini **tidak menyentuh jaringan sama sekali** — hanya paket, status,
 * durasi, format, dan label. Seluruh akses Firestore, termasuk penamaan
 * dokumen, ada di `langgananFirestore.ts`.
 *
 * Pemisahan itu bukan soal kerapian. Modul ini diimpor secara statis oleh
 * `GerbangLangganan`, yang ada di jalur muat awal. Selama modul ini ikut
 * menarik `firebase/firestore` — 140 kB gzip, 35% bundle — Vite menulis
 * `modulepreload` untuknya di `index.html`, dan setiap orang membayarnya
 * sebelum sempat melihat layar login. Dengan batas "modul ini tidak
 * menyentuh jaringan", aturan itu bisa dijaga oleh pemeriksaan otomatis.
 *
 * Semuanya tetap terkumpul di satu pasangan berkas, bukan disebar di
 * komponen — tetap satu tempat yang harus diubah saat harga paket, rekening,
 * atau metode pembayaran berubah.
 */

import { APP_NAME } from './appIdentity';

/*
 * Bentuk paket dan perhitungan durasi ada di `durasi.ts` — modul yang
 * tidak mengimpor Firestore, supaya bisa dipakai `serverBilling.ts` tanpa
 * menarik SDK klien ke bundel server. Dijual ulang di sini supaya tidak
 * ada `import` di proyek ini yang perlu berubah; lihat `durasi.ts` untuk
 * alasannya.
 */
export {
  tambahDurasi,
  deskripsiDurasi,
  normalisasiPaket,
  normalisasiDaftarPaket,
  paketById,
  type SatuanDurasi,
  type PaketLangganan,
  type MetodePembayaran,
} from './durasi';
// `export … from` tidak membuat binding lokal, jadi yang dipakai di bawah
// tetap perlu diimpor sendiri.
import {
  paketById,
  PREFIX_ORDER_ID,
  type MetodePembayaran,
  type PaketLangganan,
  type SatuanDurasi,
} from './durasi';

// ═══════════════════════════════════════════════════════════════════════
//  Paket langganan
// ═══════════════════════════════════════════════════════════════════════

/**
 * Paket bawaan.
 *
 * ⚠️ Ini hanya nilai *awal*. Admin dapat menambah, mengubah harga, dan
 * mengaktifkan/nonaktifkan paket dari menu Langganan; yang tersimpan di
 * Firestore yang jadi acuan. Paket bawaan dipakai kalau dokumen
 * pengaturan belum pernah dibuat.
 *
 * Tidak ada `keterangan` di sini — lihat catatan pada `PaketLangganan`.
 */
export const PAKET_BAWAAN: PaketLangganan[] = [
  { id: 'bulanan', label: '1 Bulan', harga: 25_000, durasi: 1, satuan: 'bulan' },
  { id: 'tahunan', label: '1 Tahun', harga: 250_000, durasi: 1, satuan: 'tahun' },
];

/** Label satuan untuk ditampilkan. */
export const LABEL_SATUAN: Record<SatuanDurasi, string> = {
  hari: 'Hari',
  bulan: 'Bulan',
  tahun: 'Tahun',
};




// ═══════════════════════════════════════════════════════════════════════
//  Konfirmasi WhatsApp
// ═══════════════════════════════════════════════════════════════════════

/**
 * Template pesan konfirmasi bawaan.
 *
 * Placeholder yang tersedia: `{nama}`, `{username}`, `{orderId}`,
 * `{nominal}`, `{paket}`, `{tanggal}`. Placeholder yang tidak dikenal
 * dibiarkan apa adanya — lebih baik pesan yang agak aneh daripada
 * placeholder yang diam-diam hilang.
 */
export const TEMPLATE_WA_DEFAULT = [
  'Halo, saya sudah membayar langganan {APP}.',
  '',
  'Nama     : {nama}',
  'Username : {username}',
  'Paket    : {paket}',
  'Nominal  : {nominal}',
  'Tagihan  : {orderId}',
  'Tanggal  : {tanggal}',
  '',
  'Mohon dikonfirmasi. Terima kasih.',
].join('\n');

/**
 * Berapa karakter maksimum pesan WhatsApp.
 *
 * Batas resminya 65.536 karakter. Template yang lebih panjang dipotong di
 * sini supaya tidak gagal diam-diam saat dikirim.
 */
export const BATAS_PESAN_WA = 65_000;

import { normalisasiNomorWa } from './nomorWa';

// Implementasinya pindah ke `lib/nomorWa.ts` (modul kecil tanpa dependensi
// Firestore, supaya `userManager` bisa memakainya tanpa menarik seluruh modul
// langganan) lalu diekspor ulang di sini supaya semua pemanggil lama tetap
// berjalan tanpa ubah.
export { normalisasiNomorWa, type HasilNormalisasiWa } from './nomorWa';

/**
 * Susun pesan konfirmasi dari template.
 *
 * `APP_NAME` selalu tersedia selain placeholder di atas. Nilai yang belum
 * diketahui menjadi string kosong, bukan `undefined` — supaya pesan tidak
 * pernah memuat teks "undefined" di depan pengguna.
 */
export function isiPesanWa(
  template: string | undefined,
  data: {
    app?: string;
    nama?: string;
    username?: string;
    orderId?: string;
    nominal?: number;
    paket?: string;
    tanggal?: string;
  }
): string {
  const isi = template && template.trim() ? template : TEMPLATE_WA_DEFAULT;
  /*
   * Nilai yang belum diketahui jadi **string kosong**, bukan `-`.
   *
   * Versi lama mengisi `-` untuk setiap field yang kosong, dan hasil yang
   * terkirim ke admin berbunyi begini:
   *
   * ```
   * Nama     : -
   * Paket    : -
   * Nominal  : -
   * ```
   *
   * Enam baris, tiga di antaranya tidak berisi informasi apa pun. Admin harus
   * membacanya lalu menyimpulkan "datanya belum terkirim" — padahal yang
   * belum terkirim memang tidak ada. Baris kosong lebih jujur: yang
   * tampil persis apa yang diketahui.
   */
  const nilai: Record<string, string> = {
    '{APP}': data.app ?? 'PRABAWA',
    '{nama}': data.nama || '',
    '{username}': data.username || '',
    '{orderId}': data.orderId || '',
    '{nominal}': typeof data.nominal === 'number' ? formatRupiah(data.nominal) : '',
    '{paket}': data.paket || '',
    '{tanggal}': data.tanggal || '',
  };
  let pesan = isi;
  for (const [kunci, teks] of Object.entries(nilai)) pesan = pesan.split(kunci).join(teks);

  /*
   * Buang baris "Label :" yang valuenya kosong.
   *
   * Regex-nya sengaja hanya menangkap baris berbentuk `Label : nilai` —
   * itu satu-satunya bentuk yang dipakai template bawaan. Baris bebas
   * milik admin tidak boleh ikut terhapus hanya karena kebetulan memuat
   * tanda titik dua.
   */
  pesan = pesan
    .split('\n')
    .filter(baris => {
      const cocok = baris.match(/^\s*[^:\n]{1,24}:\s*(.*)$/);
      return !cocok || cocok[1].trim() !== '';
    })
    .join('\n');

  // Sisa baris kosong hasil pembuangan dirapatkan jadi satu, supaya tidak
  // ada tebakanEMPTY yang membingungkan di awal pesan.
  pesan = pesan.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');

  return pesan.length > BATAS_PESAN_WA ? pesan.slice(0, BATAS_PESAN_WA) : pesan;
}

/**
 * Tautan `wa.me` untuk membuka WhatsApp dengan pesan terisi.
 *
 * `wa.me` dipakai (bukan `api.whatsapp.com`) karena tidak butuh token dan
 * tetap jalan di desktop maupun ponsel. Bila nomor tidak valid, `null`
 * dikembalikan supaya pemanggil menyembunyikan tombolnya, bukan membuka
 * halaman yang pasti gagal.
 */
export function tautanWa(masuk: string, pesan: string): string | null {
  const { ok, nomor } = normalisasiNomorWa(masuk);
  if (!ok) return null;
  return `https://wa.me/${nomor}?text=${encodeURIComponent(pesan.slice(0, BATAS_PESAN_WA))}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Metode pembayaran
// ═══════════════════════════════════════════════════════════════════════


/**
 * Bank yang didukung untuk transfer manual.
 *
 * ⚠️ Daftar ini **dibatasi** — hanya lima bank ini, dan ikonnya dipakai
 * langsung di layar pembayaran. Bank lain tidak bisa ditambah lewat form:
 * Antarmuka memakai warna dan tata letak yang sudah disetel untuk ikon ini,
 * jadi logo asing akan terlihat rusak.
 *
 * Kode di sini juga dipakai sebagai penanda saat mencatat pembayaran, jadi
 * Menambah bank berarti perubahan kode, bukan perubahan konfigurasi.
 */
const KODE_BANK = ['bri', 'bca', 'bni', 'mandiri', 'seabank'] as const;
export type KodeBank = (typeof KODE_BANK)[number];

export interface InfoBank {
  kode: KodeBank;
  nama: string;
  /** Ikon di `public/ico/`. */
  ikon: string;
  /** Warna resmi, dipakai untuk memotong logo putih jadi berwarna. */
  warna: string;
}

/** Bank yang bisa dipilih, lengkap dengan ikon dan warnanya. */
export const DAFTAR_BANK: readonly InfoBank[] = [
  { kode: 'bri', nama: 'BRI', ikon: '/ico/bri.svg', warna: '#004B87' },
  { kode: 'bca', nama: 'BCA', ikon: '/ico/bca.svg', warna: '#005CA9' },
  { kode: 'bni', nama: 'BNI', ikon: '/ico/bni.svg', warna: '#F68F1E' },
  { kode: 'mandiri', nama: 'Mandiri', ikon: '/ico/mandiri.svg', warna: '#003087' },
  { kode: 'seabank', nama: 'SeaBank', ikon: '/ico/seabank.svg', warna: '#FF5722' },
];

export function infoBank(kode: string | undefined): InfoBank | null {
  return DAFTAR_BANK.find(item => item.kode === kode) ?? null;
}

/** Pesan error untuk kode bank yang tidak dikenal. */
export function validasiKodeBank(kode: string): string | null {
  return infoBank(kode) ? null : `Pilih salah satu bank: ${DAFTAR_BANK.map(b => b.nama).join(', ')}.`;
}

/** Satu rekening bank untuk transfer manual. */
export interface RekeningBank {
  id: string;
  /** Harus salah satu dari `KODE_BANK`. */
  kodeBank: KodeBank;
  nomorRekening: string;
  atasNama: string;
  /** Keterangan tambahan, mis. "Biaya admin Rp 2.500". */
  catatan?: string;
  /** Urutan tampil; lebih kecil lebih dulu. */
  urutan: number;
  aktif: boolean;
}

export interface PengaturanBilling {
  /** QRIS statis dari bank/penyedia. Dibuat dinamis per tagihan. */
  qrisStatis: string;
  /** Nama merchant yang tampil di aplikasi pembayaran. */
  namaMerchant: string;
  /** Rekening bank untuk transfer manual. */
  rekening: RekeningBank[];
  /** Paket yang ditawarkan; kosong berarti memakai `PAKET_BAWAAN`. */
  paket: PaketLangganan[];
  /** Metode yang diizinkan pengguna. */
  metodeAktif: MetodePembayaran[];
  /** Midtrans aktif? Kalau false, Midtrans disembunyikan dari UI. */
  midtransAktif: boolean;
  /**
   * Izinkan admin menandai akun sebagai gratis (exempt).
   * Kalau dimatikan, toggle "Gratis" di tabel disembunyikan.
   */
  izinkanGratis: boolean;
  /**
   * Nomor WhatsApp tujuan konfirmasi.
   *
   * Dikosongkan = tombol konfirmasi disembunyikan. Format yang disimpan
   * selalu internasional tanpa tanda baca apa pun (`62…`) — hasil dari
   * `normalisasiNomorWa()`, bukan apa yang diketik admin.
   */
  nomorWa: string;
  /** Template pesan konfirmasi. Lihat `isiPesanWa()`. */
  templateWa: string;
  updatedAt?: string;
}

export const BILLING_DEFAULT: PengaturanBilling = {
  qrisStatis: '',
  namaMerchant: APP_NAME,
  rekening: [],
  paket: PAKET_BAWAAN,
  metodeAktif: ['qris'],
  midtransAktif: false,
  izinkanGratis: true,
  nomorWa: '',
  templateWa: TEMPLATE_WA_DEFAULT,
  updatedAt: undefined,
};

/**
 * Paket yang benar-benar dipakai — konfigurasi admin, atau bawaan.
 *
 * Disini filter: paket tanpa harga atau tanpa durasi tidak bisa dipakai,
 * karena keduanya tidak cocok dengan `catatPembayaran` yang menambah masa
 * aktif sebanyak `durasiHari` dan menagih `harga`.
 */
export function paketEfektif(pengaturan: PengaturanBilling): PaketLangganan[] {
  const daftar = pengaturan.paket?.length ? pengaturan.paket : PAKET_BAWAAN;
  return daftar.filter(
    item => item && item.id && item.harga > 0 && item.durasi > 0
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Status langganan
// ═══════════════════════════════════════════════════════════════════════

/**
 * Status langganan sebuah akun.
 *
 * `kadaluarsa` tidak pernah disimpan — dihitung dari `masaAkhir` setiap
 * kali dibaca. Menyimpannya berarti ada dua sumber kebenaran yang bisa
 * berbeda, dan yang berbeda adalah yang dipercaya.
 */
export type StatusLangganan = 'aktif' | 'kadaluarsa' | 'belum' | 'gratis';

export interface DokumenLangganan {
  username: string;
  paketId: string;
  /** ISO timestamp kapan masa aktif berakhir. */
  masaAkhir: string;
  /** ISO timestamp kapan dibuat / pembayaran terakhir. */
  masaMulai: string;
  /** True bila admin menandai akun ini tidak perlu bayar. */
  gratis: boolean;
  /** Alasan gratis — disimpan biar ada jejak siapa yang memberi exemptions. */
  alasanGratis?: string;
  /** Jumlah total yang sudah dibayar (akumulasi, rupiah). */
  totalBayar: number;
  /** Jumlah kali pembayaran berhasil. */
  jumlahBayar: number;
  /** Pembayaran terakhir (ringkas, untuk tampilan). */
  pembayaranTerakhir?: {
    orderId: string;
    nominal: number;
    metode: MetodePembayaran;
    waktu: string;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface RingkasanLangganan {
  username: string;
  status: StatusLangganan;
  /**
   * Peran akun.
   *
   * ⚠️ Penting untuk tampilan, bukan untuk gerbang. Akun admin **tidak**
   * punya masa aktif yang berlaku — `bolehMasuk()` sudah melepaskannya lebih
   * dulu. Tanpa field ini, tabel admin menampilkan "Masa Aktif: 1 Jan 2025,
   * sudah lewat -1 hari", dan peringatan kedaluwarsa ikut berbunyi untuk
   * sesuatu yang tidak akan pernah terjadi. Peringatan yang salah lebih
   * merusak daripada tidak ada.
   */
  role: 'admin' | 'user';
  paketId: string;
  paketLabel: string;
  masaAkhir: string;
  /** Sisa hari; negatif berarti sudah lewat. */
  sisaHari: number;
  gratis: boolean;
  totalBayar: number;
  jumlahBayar: number;
  /** Ringkasan langganan + data tagihan untuk tabel. */
  langganan: DokumenLangganan | null;
}

/** Sisa hari sampai `masaAkhir`; negatif berarti sudah lewat. */
export function sisaHari(masaAkhir: string | undefined, sekarang: Date = new Date()): number {
  if (!masaAkhir) return -1;
  const akhir = new Date(masaAkhir);
  if (Number.isNaN(akhir.getTime())) return -1;
  // Bulatkan ke atas supaya 12 jam tersisa masih dihitung "1 hari".
  return Math.ceil((akhir.getTime() - sekarang.getTime()) / 86_400_000);
}

/** Tanggal setelah `n` hari dari `dari`. */
export function tambahHari(dari: Date, n: number): Date {
  const hasil = new Date(dari.getTime());
  hasil.setDate(hasil.getDate() + n);
  return hasil;
}

/**
 * Status langganan untuk satu dokumen.
 *
 * `gratis` diperiksa lebih dulu: akun-exempt **tidak pernah** kadaluarsa,
 * walau `masaAkhir`-nya sudah lewat. Kalau tidak, admin yang menandai
 * akun gratis akan melihat akun itu terkunci setelah 30 hari.
 */
export function statusLangganan(
  doc: DokumenLangganan | null,
  sekarang: Date = new Date()
): StatusLangganan {
  if (doc?.gratis) return 'gratis';
  if (!doc?.masaAkhir) return 'belum';
  return sisaHari(doc.masaAkhir, sekarang) > 0 ? 'aktif' : 'kadaluarsa';
}

export const STATUS_LABEL: Record<StatusLangganan, string> = {
  aktif: 'Aktif',
  kadaluarsa: 'Kedaluwarsa',
  belum: 'Belum Bayar',
  gratis: 'Gratis',
};

/** Warna badge untuk tiap status. */
export const STATUS_TONE: Record<StatusLangganan, 'emerald' | 'amber' | 'rose' | 'slate'> = {
  aktif: 'emerald',
  kadaluarsa: 'rose',
  belum: 'amber',
  gratis: 'slate',
};

/**
 * Ringkasan satu akun — bentuk yang dipakai tabel dan gate aplikasi.
 *
 * Admin selalu `aktif`: kalau admin ikut terkunci, tidak ada yang bisa
 * membukanya kembali. Ini pengaman, bukan kebijakan.
 */
export function ringkasanLangganan(
  username: string,
  doc: DokumenLangganan | null,
  paket: PaketLangganan[],
  role: 'admin' | 'user',
  sekarang: Date = new Date()
): RingkasanLangganan {
  const dasar = statusLangganan(doc, sekarang);
  const status: StatusLangganan = role === 'admin' ? 'aktif' : dasar;
  const paketTerpilih = doc ? paketById(paket, doc.paketId) : null;

  return {
    username,
    status,
    role,
    paketId: doc?.paketId ?? '',
    // Admin tidak berlangganan — paketnya tidak berlaku, jadi tidak
    // ditampilkan. Menampilkan paket yang "dipilih" membuat admin terlihat
    // seperti pelanggan yang belum bayar.
    paketLabel:
      role === 'admin'
        ? 'Administrator'
        : doc?.gratis
          ? 'Gratis (exempt)'
          : paketTerpilih?.label ?? (doc?.paketId ? doc.paketId : '—'),
    masaAkhir: doc?.masaAkhir ?? '',
    sisaHari: doc?.masaAkhir ? sisaHari(doc.masaAkhir, sekarang) : -1,
    gratis: doc?.gratis ?? false,
    totalBayar: doc?.totalBayar ?? 0,
    jumlahBayar: doc?.jumlahBayar ?? 0,
    langganan: doc,
  };
}

/**
 * Apakah akun ini boleh masuk ke aplikasi.
 *
 * ⚠️ Ini satu-satunya gerbang. Semua halaman selain menu Langganan berada
 * di balik pemeriksaan ini, jadi "wajib bayar" ditegakkan di satu tempat
 * dan tidak bisa dilanggar dengan membuka halaman lain.
 */
export function bolehMasuk(ringkasan: RingkasanLangganan, role: 'admin' | 'user'): boolean {
  if (role === 'admin') return true;
  return ringkasan.status === 'aktif' || ringkasan.status === 'gratis';
}

// ═══════════════════════════════════════════════════════════════════════
//  Format & id
// ═══════════════════════════════════════════════════════════════════════

/** Format rupiah tanpa pembatas ribuan — aman untuk arithmetic & QR. */
export function formatRuang(num: number): string {
  return Math.round(Number(num) || 0).toLocaleString('id-ID');
}

export function formatRupiah(num: number): string {
  return `Rp ${formatRuang(num)}`;
}

/*
 * Diekspor ulang dari `durasi.ts` (tempat aslinya tinggal) supaya pemanggil
 * tidak perlu tahu modul mana yang menjadi sumbernya.
 */
export { PREFIX_ORDER_ID } from './durasi';

/**
 * Id tagihan unik.
 *
 * Format `PRABAWA-<paket>-<14 digit waktu>`.
 *
 * Awalan dan pemisahannya harus identik dengan yang dicari
 * `serverBilling.ts.paketDariOrderId()` — keduanya membaca konstanta yang
 * sama dari `durasi.ts`, jadi tidak bisa berbeda tanpa satu sisi tidak
 * dijaga.
 */
export function idTagihan(paketId: string, sekarang: Date = new Date()): string {
  const stempel = sekarang.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${PREFIX_ORDER_ID}-${paketId.toUpperCase()}-${stempel}`.slice(0, 50);
}


/** Status riwayat pembayaran. */
export type StatusTagihan = 'menunggu' | 'lunas' | 'batal';

export interface DokumenTagihan {
  orderId: string;
  username: string;
  usernameLabel?: string;
  paketId: string;
  nominal: number;
  metode: MetodePembayaran;
  durasi?: number;
  satuan?: SatuanDurasi;
  /** Jumlah hari, disimpan untuk rekaman tagihan lama. */
  durasiHari?: number;
  status: StatusTagihan;
  buktiUrl?: string;
  catatan?: string;
  waktuBayar?: string;
  masaAkhirSetelah?: string;
  createdAt?: string;
}

/** Simpan tagihan berstatus menunggu (sebelum pembayaran terverifikasi). */
