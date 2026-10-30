/**
 * ═══════════════════════════════════════════════════════════════════════
 *  NORMALISASI BALASAN SERVER → BENTUK YANG DIPAKAI HALAMAN
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  `presensiContract.ts` berisi bentuk payloads apa adanya, disalin
 *  persis dari balasan gateway `presensi.bkd.jatimprov.go.id` (version 89).
 *  Bentuk itu apa adanya: `Id`/`Nama` kapital, `latlong` sebagai
 *  satu string, tanggal izin terformat bahasa Indonesia, dan status izin
 *  hanya berupa boolean `approval`.
 *
 *  Berkas ini menerjemahkan payload itu menjadi bentuk domain yang enak
 *  dibaca komponen React: `id`/`nama` huruf kecil, latitude/longitude
 *  terpisah, tanggal ISO, dan status izin yang sudah diklasifikasikan.
 *
 *  Semua pemetaan tercatat di bawah supaya mudah diaudit ulang kalau
 *  server berubah — jangan pernah "ditebak" di dalam komponen.
 */

import {
  ABSEN_CHECK_TYPE,
  IJIN_STATUS_KODE,
  type HariModel,
  type HistoryAbsenModel,
  type IjinModel,
  type JenisIjinModel,
  type LokasiModel,
  type MasterTipeIjinModel,
  type WorkCodeModel,
} from './presensiContract';
import { timeToMinutes } from './dateFormatter';

// ═══════════════════════════════════════════════════════════════════════
//  Tanggal
// ═══════════════════════════════════════════════════════════════════════

const BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * Ubah tanggal terformat Indonesia ("09 September 2026") menjadi ISO.
 *
 * `list_ijin` mengirim `tgl_ijin_dari` / `tgl_ijin_sampai` dalam format
 * ini, sedangkan `history_absen` mengirim `waktu` ISO penuh. Karena
 * penyaringan rentang tanggal dilakukan di sisi klien, keduanya harus
 * dinormalkan ke satu bentuk.
 *
 * Mengembalikan `null` bila tidak bisa dibaca — pemanggil wajib
 * menanganinya, jangan mengasumsikan tanggal selalu ada.
 */
export function tanggalKeIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  // Sudah ISO: "2026-09-09" atau "2026-09-09 08:12:33".
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Indonesia: "09 September 2026".
  const indo = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (indo) {
    const bulan = BULAN.findIndex(item => item.toLowerCase() === indo[2].toLowerCase());
    if (bulan >= 0) {
      return `${indo[3]}-${String(bulan + 1).padStart(2, '0')}-${indo[1].padStart(2, '0')}`;
    }
  }

  return null;
}

/** Ambil bagian "HH:MM" dari waktu server, atau `null`. */
export function jamTampil(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/(\d{1,2}:\d{2})/);
  return match ? match[1].padStart(5, '0') : null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Lokasi absen
// ═══════════════════════════════════════════════════════════════════════

/** Bentuk `getlokasiabsen` setelah diratakan untuk komponen. */
export interface LokasiView {
  /** id numerik dari server, dipakai sebagai React key. */
  id: string;
  /** "default-159" — gabungan `tipe` dan `id` untuk ditampilkan. */
  kode: string;
  /** Nama instansi besar, mis. "BADAN KESATUAN BANGSA DAN POLITIK". */
  nama: string;
  /** Nama satuan kerja, mis. "SUB BAGIAN UMUM DAN KEPEGAWAIAN". */
  satuanKerja: string;
  deskripsi: string;
  /** "lat,long" mentah dari server. */
  latlong: string;
  latitude: number | null;
  longitude: number | null;
  /** Radius geofence meter. */
  radius: number;
  tipe: string;
  prioritas: number;
}

/**
 * `getlokasiabsen` → bentuk datar.
 *
 * Server mengembalikan satu string `latlong` ("-7.29007,112.703"), bukan
 * dua field terpisah, jadi dipecah di sini. Koordinat yang tidak bisa
 * diurai menjadi `null` supaya `checkGeofence` menandainya "tidak
 * dalam radius" alih-alih menandai lokasi sebagai di dalam.
 */
export function toLokasiView(row: LokasiModel): LokasiView {
  const latlong = String(row.latlong ?? '').trim();
  const [lat, lon] = latlong.split(',').map(part => Number(part.trim()));
  return {
    id: String(row.id ?? ''),
    kode: row.tipe ? `${row.tipe}-${row.id}` : String(row.id ?? ''),
    nama: String(row.lokasi ?? '').trim(),
    satuanKerja: String(row.data ?? '').trim(),
    deskripsi: String(row.deskripsi ?? '').trim(),
    latlong,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    radius: Number(row.radius ?? 0),
    tipe: String(row.tipe ?? ''),
    prioritas: Number(row.prioritas ?? 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Work code
// ═══════════════════════════════════════════════════════════════════════

/** `getworkcode` → bentuk datar; `jam` diambil dari `hari.jam`. */
export interface WorkCodeView {
  /** Dikirim apa adanya sebagai param `work_code`. */
  id: number;
  nama: string;
  /** Nama hari dari server, mis. "Minggu" (dipakai server apa adanya). */
  hari: string;
  jam: HariModel['jam'];
}

/**
 * `getworkcode` → bentuk datar.
 *
 * Jam kerja bersarang tiga tingkat di balasan server
 * (`[].hari.jam.jam_masuk`). Aplikasi asli membacanya lewat
 * `data.ui.model.WorkCode`; di sini cukup diratakan satu tingkat supaya
 * komponen tidak perluVERS|menelusuri `hari.jam` di mana-mana.
 *
 * ⚠️ Nilai `hari.nama` dari server ternyata berisi nama hari dalam
 * bahasa Inggris ("Minggu") untuk semua work code — tidak trustworthy
 * untuk memilih hari. Pemilihan hari dilakukan di sisi klien lewat
 * `pilihWorkCodeUntukHari`.
 */
export function toWorkCodeView(row: WorkCodeModel): WorkCodeView {
  return {
    id: Number(row.id),
    nama: String(row.nama ?? ''),
    hari: String(row.hari?.nama ?? ''),
    jam: {
      jam_masuk_awal: String(row.hari?.jam?.jam_masuk_awal ?? ''),
      jam_masuk: String(row.hari?.jam?.jam_masuk ?? ''),
      jam_keluar: String(row.hari?.jam?.jam_keluar ?? ''),
      jam_keluar_akhir: String(row.hari?.jam?.jam_keluar_akhir ?? ''),
    },
  };
}

/**
 * Pilih work code yang paling cocok untuk sebuah tanggal.
 *
 * `getworkcode` mengembalikan work code per EVENT ("(EVENT) Hari
 * Olahraga Nasional", "(EVENT) Maulid Nabi"), dan lebih dari satu kode
 * bisa berlaku pada hari yang sama. Urutan balisan server sudah
 * prioritas (kode biasa lebih dulu, event menyusul), jadi untuk hari biasa
 * ambil kode pertama; nama yang diawali "(EVENT)" hanya dipakai bila
 * tidak ada kode biasa yang cocok.
 */
export function pilihWorkCodeUntukHari(codes: WorkCodeView[], isoDate: string): WorkCodeView | null {
  if (codes.length === 0) return null;
  const dayName = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    timeZone: 'Asia/Jakarta',
  })
    .format(new Date(`${isoDate}T00:00:00Z`))
    .toLowerCase();

  const byName = codes.filter(code => code.nama.toLowerCase().startsWith(dayName));
  const biasa = byName.filter(code => !code.nama.toUpperCase().startsWith('(EVENT)'));
  return biasa[0] ?? byName[0] ?? codes.find(code => !code.nama.toUpperCase().startsWith('(EVENT)')) ?? codes[0];
}

// ═══════════════════════════════════════════════════════════════════════
//  Master jenis izin
// ═══════════════════════════════════════════════════════════════════════

/** `getmastertipeijin` → bentuk datar. */
export interface MasterTipeIjinView {
  id: number;
  nama: string;
  /** id `tipe_ijin` yang valid untuk kelompok ini, mis. [1,2,3]. */
  tipe: number[];
}

/** `getmastertipeijin` → bentuk datar (Id/Nama/Tipe → id/nama/tipe). */
export function toMasterTipeIjinView(row: MasterTipeIjinModel): MasterTipeIjinView {
  return {
    id: Number(row.Id ?? 0),
    nama: String(row.Nama ?? ''),
    tipe: Array.isArray(row.Tipe) ? row.Tipe.map(Number) : [],
  };
}

/** `jenis_ijin` → bentuk datar. */
export interface JenisIjinView {
  /** Dikirim apa adanya sebagai param `jenis_ijin` pada `add_ijin`. */
  id: number;
  nama: string;
  /** Kode singkat dari server, mis. "DLLK". */
  kode: string;
  /** true bila jenis ini bisa dipilih setengah hari. */
  setengahHari: boolean;
  /** Dicocokkan dengan `MasterTipeIjinView.id` untuk pengelompokan. */
  tipeId: number;
  /** "1" bila memotong jatah. */
  potongan: string;
  isAktif: number;
}

/** `jenis_ijin` → bentuk datar. */
export function toJenisIjinView(row: JenisIjinModel): JenisIjinView {
  return {
    id: Number(row.Id ?? 0),
    nama: String(row.Nama ?? ''),
    kode: String(row.Kode ?? ''),
    setengahHari: Boolean(row.SetengahHari),
    tipeId: Number(row.TipeId ?? 0),
    potongan: String(row.Potongan ?? '0'),
    isAktif: Number(row.IsAktif ?? 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Pengajuan izin
// ═══════════════════════════════════════════════════════════════════════

/**
 * Status izin.
 *
 * `list_ijin` mengirim `approval` (boolean) **dan** `status` (int) —
 * keduanya dibaca aplikasi v89 (`ListIjinFragment` /
 * `ListIjinBawahanFragment`). Nilai `status` yang dikenal: 1 disetujui,
 * 2 menunggu, 3 ditolak.
 *
 * ⚠️ Belum diverifikasi live apakah server selalu mengirim `status`.
 * Bila tidak ada, `toIjinView` memakai `approval` sebagai cadangan —
 * jadi `ditolak` hanya muncul bila `status` = 3, dan permintaan lama
 * tanpa `status` tetap tampil "menunggu".
 */
export type IjinStatus = 'approved' | 'pending' | 'ditolak';

/** `list_ijin` → bentuk datar, tanggal sudah dinormalkan ke ISO. */
export interface IjinView {
  id: number;
  /** Nama pemohon. */
  nama: string;
  /** NIP pemohon (server mengirimnya di field `email`). */
  nip: string;
  departemen: string;
  jenisIjinId: number;
  jenisIjinNama: string;
  /** id master jenis izin (`master_jenis_ijin`). */
  masterJenisIjin: number;
  tipeIjinId: number;
  tipeIjinText: string;
  /** "09 September 2026  s/d  09 September 2026" — mentah dari server. */
  tglIjin: string;
  /** "YYYY-MM-DD" atau `null` bila tidak terbaca. */
  tglDari: string | null;
  tglSampai: string | null;
  alasan: string;
  /** Lampiran; string kosong bila tidak ada. */
  berkas: string;
  createdAt: string;
  approvedAt: string;
  status: IjinStatus;
  /** Catatan atasan; string kosong bila tidak ada. */
  catatan: string;
  /** Nilai `status` mentah dari server (0 bila tidak dikirim). */
  statusRaw: number;
  /** id pegawai + id user pemohon — dasar penyaringan "izin bawahan". */
  pegawaiId: number | null;
  userId: string;
  updatedAt: string;
  updatedUser: string;
}

/** `list_ijin` → bentuk datar. */
export function toIjinView(row: IjinModel): IjinView {
  const statusRaw = Number(row.status ?? 0);
  const adaStatus = Number.isFinite(statusRaw) && statusRaw > 0;
  /*
   * Kode status dibaca dari `IJIN_STATUS_KODE`, bukan ditulis sebagai `1`
   * dan `3` di sini. Angka telanjang di pemetaan ini adalah tempat yang
   * paling mudah salah: `status` integer dan `approval` boolean adalah dua
   * sumber yang tidak selalu konsisten, jadi kalau kodenya berubah, satu
   * filter di halaman ini diam-diam jadi tidak pernah cocok.
   *
   * Cadangan ke `approval` tetap dipakai untuk permintaan lama yang belum
   * punya field `status` sama sekali (`adaStatus` false).
   */
  const status: IjinStatus = adaStatus
    ? statusRaw === IJIN_STATUS_KODE.DISETUJUI
      ? 'approved'
      : statusRaw === IJIN_STATUS_KODE.DITOLAK
        ? 'ditolak'
        : 'pending'
    : row.approval === true
      ? 'approved'
      : 'pending';

  return {
    id: Number(row.id ?? 0),
    nama: String(row.nama ?? ''),
    nip: String(row.email ?? ''),
    departemen: String(row.departemen ?? ''),
    jenisIjinId: Number(row.jenis_ijin ?? 0),
    jenisIjinNama: String(row.jenis_ijin_text ?? ''),
    masterJenisIjin: Number(row.master_jenis_ijin ?? 0),
    tipeIjinId: Number(row.tipe_ijin ?? 0),
    tipeIjinText: String(row.tipe_ijin_text ?? ''),
    tglIjin: String(row.tgl_ijin ?? ''),
    tglDari: tanggalKeIso(row.tgl_ijin_dari ?? row.tgl_ijin),
    tglSampai: tanggalKeIso(row.tgl_ijin_sampai ?? row.tgl_ijin),
    alasan: String(row.alasan ?? ''),
    berkas: String(row.berkas ?? ''),
    createdAt: String(row.created_at ?? ''),
    approvedAt: String(row.approval_at ?? ''),
    status,
    catatan: String(row.catatan ?? ''),
    statusRaw,
    pegawaiId: row.pegawai_id != null ? Number(row.pegawai_id) : null,
    userId: String(row.user_id ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    updatedUser: String(row.updated_user ?? ''),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Riwayat absensi
// ═══════════════════════════════════════════════════════════════════════

export type StatusAbsensi = 'hadir' | 'terlambat';

/**
 * Satu baris rekap harian hasil pivot dari `history_absen`.
 *
 * `history_absen` mengembalikan SATU BARIS PER PUKUL (satu baris
 * "Datang", satu baris "Pulang"), bukan satu baris per hari. Aplikasi
 * asli menampilkannya apa adanya; untuk laporan yang lebih berguna baris
 * dipivot menjadi satu entri per tanggal di `pivotAbsensiHarian`.
 */
export interface AbsensiHarianView {
  /** "YYYY-MM-DD". */
  tanggal: string;
  nama: string;
  departemen: string;
  /** "HH:MM" waktu absen datang, atau `null`. */
  jamMasuk: string | null;
  /** "HH:MM" waktu absen pulang, atau `null`. */
  jamPulang: string | null;
  /** Jarak dari titik absen, format server ("12,509,838"). */
  jarak: string;
  status: StatusAbsensi;
  /** Punch mentah, untuk detail. */
  punches: HistoryAbsenModel[];
}

/** Toleransi keterlambatan (menit), mengikuti kebiasaan presensi berakhir 15 menit. */
const TOLERANSI_TERLAMBAT = 15;

/**
 * Apakah datang dianggap sebagai terlambat.
 *
 * Ini satu-satunya tempat angka toleransi 15 menit itu hidup.
 *
 * Versi sebelumnya punya dua salinan dari aturan yang sama: fungsi
 * `pivotAbsensiHarian` di modul ini (tak terpakai — sisa rekap yang dulu satu
 * pegawai per hari, sekarang digantikan `buildRekap` multi-pegawai di
 * `Laporan.tsx`) dan perhitungan inline di sana juga. Dua salinan angka yang
 * sama di dua berkas berarti diam-diam bisa berbeda begitu salah satu diubah.
 *
 * Sekarang satu fungsi, satu angka.
 */
export function terlambatCompared(
  jamMasuk: string | null | undefined,
  jamMasukAwal: string | null | undefined
): boolean {
  // `timeToMinutes` (bukan implementasi sendiri) karena ia yang lebih ketat:
  // menolak "25:00" dan "08:99". Versi longgar yang diganti di sini
  // menerima keduanya dan menghasilkan menit di luar satu hari — yang membuat
  // orang dianggap "terlambat" dengan batas 25 * 60 + 0 menit.
  const batas = timeToMinutes(jamMasukAwal);
  const menit = timeToMinutes(jamMasuk);
  // Salah satu tidak terbaca -> tidak bisa disimpulkan terlambat.
  if (batas === null || menit === null) return false;
  return menit > batas + TOLERANSI_TERLAMBAT;
}

/** Cocokkan `checktype` dari server dengan konstanta ABSEN_CHECK_TYPE. */
export function isCheckType(value: unknown, expected: number): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim().toLowerCase();
  if (expected === ABSEN_CHECK_TYPE.DATANG) return text === 'datang' || text === 'masuk' || text === '1';
  if (expected === ABSEN_CHECK_TYPE.PULANG) return text === 'pulang' || text === 'keluar' || text === '2';
  return text === 'siang' || text === '3';
}

/** Label `checktype` yang bisa ditampilkan. */
export function labelCheckType(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '-';
  if (isCheckType(text, ABSEN_CHECK_TYPE.DATANG)) return 'Datang';
  if (isCheckType(text, ABSEN_CHECK_TYPE.PULANG)) return 'Pulang';
  if (isCheckType(text, ABSEN_CHECK_TYPE.SIANG)) return 'Siang';
  return text;
}

/**
 * URL foto profil dari server hanya dipakai bila nama berkasnya benar.
 *
 * `update_foto` membentuk nama berkas dari nilai `image` yang dikirim; nilai
 * kosong menghasilkan URL yang diakhiri tanda hubung dengan file 0 byte.
 * URL seperti itu akan membuat <img> rusak, jadi dibuang.
 */
export function fotoProfileValid(url: unknown): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  const namaBerkas = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return namaBerkas && !namaBerkas.endsWith('-') ? trimmed : '';
}
