/**
 * Perhitungan durasi & bentuk paket — bagian dari langganan yang **tidak
 * menyentuh Firestore sama sekali**.
 *
 * ## Kenapa modul ini dipisah
 *
 * Semula semua ini hidup di `langganan.ts`, satu modul dengan akses
 * Firestore. `serverBilling.ts` (sisi server, memakai Admin SDK) memanggil
 * `tambahDurasi()` dan `normalisasiDaftarPaket()` untuk menghitung harga
 * dan masa akhir — jadi mengimpor `langganan.ts` berarti menarik seluruh
 * SDK Firebase *klien* ke dalam bundel server.
 *
 * Akibatnya `dist/server.cjs` ikut memuat `src/lib/firebase.ts`, yang
 * membaca konfigurasinya dari `import.meta.env`. Bundel itu CJS, jadi
 * `import.meta.env` kosong, semua kunci dianggap hilang, dan modul itu
 * mencetak:
 *
 *     [firebase] Konfigurasi belum lengkap (...). Mode demo aktif.
 *
 * di layar Admin **setiap kali server dinyalakan** — padahal server
 * tidak memakai SDK klien sama sekali, ia memakai Admin SDK yang
 * kredensialnya dari `FIREBASE_SERVICE_ACCOUNT`. Pesan itu salah, dan
 * pesanan yang salah di layar server membuat orang mengira sistemnya
 * rusak.
 *
 * Solusinya bukan membungkam peringatannya, tapi memutus rantainya: fungsi
 * yang benar-benar dipakai server dipindah ke modul yang tidak mengimpor
 * apa pun. `langganan.ts` meng-ekspor ulang semuanya, jadi tidak ada satu
 * pun `import` di proyek ini yang perlu berubah.
 *
 * ## Aturan yang dipegang
 *
 * Durasi adalah **jumlah + satuan kalender**, bukan jumlah hari. "1 bulan"
 * bukan 30 hari: bayar tanggal 31 Januari dengan paket 1 bulan berakhir 28
 * Februari, bukan 2 Maret. Untuk bulan dan tahun, perhitungannya memakai
 * operasi kalender yang mengoreksi tanggal yang tidak ada — `setMonth` di
 * JavaScript menggeser ke akhir bulan berikutnya, bukan meluber ke bulan
 * setelahnya.
 */

// ═══════════════════════════════════════════════════════════════════════
//  Tipe
// ═══════════════════════════════════════════════════════════════════════

/** Satuan perpanjangan. */
export type SatuanDurasi = 'hari' | 'bulan' | 'tahun';

/** Metode pembayaran yang didukung. */
export type MetodePembayaran = 'qris' | 'qris_midtrans' | 'transfer';

/**
 * Satu paket langganan.
 *
 * Harga disimpan sebagai **angka rupiah penuh** (tanpa pembatas ribuan)
 * supaya aman di aritmetika — string berformat akan berubah jadi `NaN`
 * saat dikalikan.
 */
export interface PaketLangganan {
  id: string;
  label: string;
  /** Harga dalam rupiah per satu siklus. */
  harga: number;
  /** Jumlah satuan, mis. `1` dengan satuan `bulan`. */
  durasi: number;
  satuan: SatuanDurasi;
  /**
   * Keterangan tambahan yang **dibiarkan kosong secara bawaan**.
   *
   * Dulu paket bawaan punya teks seperti "Aktif 365 hari, lebih hemat".
   * Begitu admin mengganti label jadi "3 Bulan", teks itu ikut terbawa
   * dan muncul bertentangan dengan durasi aslinya — label "3 Bulan" di
   * atas, keterangan "365 hari" di bawahnya. Karena itu keterangan kini
   * selalu diturunkan dari `durasi` + `satuan`, dan `keterangan` hanya
   * dipakai sebagai catatan tambahan yang benar-benar diketik admin.
   */
  keterangan?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Perhitungan tanggal
// ═══════════════════════════════════════════════════════════════════════

/** Jumlah hari dalam satu bulan (0 = Januari). */
function hariDalamBulan(tahun: number, bulan: number): number {
  return new Date(tahun, bulan + 1, 0).getDate();
}

/**
 * Ubah tanggal ditambah durasi kalender.
 *
 * Hanya `hari` yang memakai `setDate`; `bulan` dan `tahun` memakai
 * `setMonth`/`setFullYear` supaya tanggal 31 di bulan 31 hari tidak
 * melompat ke bulan berikutnya.
 */
export function tambahDurasi(dari: Date, durasi: number, satuan: SatuanDurasi): Date {
  const hasil = new Date(dari.getTime());
  // Durasi negatif ditolak, bukan dihitung diam-diam. `Math.round(-0.4)`
  // menghasilkan `-0` yang lolos `=== 0`, jadi batasnya `n <= 0`.
  const n = Math.round(Number(durasi) || 0);
  if (n <= 0) return hasil;

  if (satuan === 'hari') {
    hasil.setDate(hasil.getDate() + n);
    return hasil;
  }
  if (satuan === 'tahun') {
    const bulanAsal = hasil.getMonth();
    const hariAsal = hasil.getDate();
    hasil.setDate(1); // amankan dulu dari overflow
    hasil.setFullYear(hasil.getFullYear() + n);
    hasil.setMonth(bulanAsal);
    hasil.setDate(Math.min(hariAsal, hariDalamBulan(hasil.getFullYear(), bulanAsal)));
    return hasil;
  }

  const bulanAsal = hasil.getMonth();
  const hariAsal = hasil.getDate();
  const totalBulan = hasil.getFullYear() * 12 + bulanAsal + n;
  const tahunBaru = Math.floor(totalBulan / 12);
  const bulanBaru = ((totalBulan % 12) + 12) % 12;
  // Tanggal asal dijepit ke panjang bulan tujuan: tanggal 31 di bulan
  // tujuan 30 hari berakhir 30, bukan melompat ke bulan berikutnya.
  hasil.setDate(1);
  hasil.setFullYear(tahunBaru, bulanBaru, 1);
  hasil.setDate(Math.min(hariAsal, hariDalamBulan(tahunBaru, bulanBaru)));
  return hasil;
}

/**
 * Deskripsi durasi yang selalu cocok dengan `durasi` + `satuan`.
 *
 * Ini yang dipakai di semua tampilan, jadi label dan keterangan tidak
 * pernah bisa bertentangan: label paket "3 Bulan" dengan satuan
 * `durasi: 3, satuan: 'bulan'` selalu menghasilkan deskripsi "3 bulan".
 */
export function deskripsiDurasi(durasi: number, satuan: SatuanDurasi): string {
  const n = Math.round(Number(durasi) || 0);
  if (n <= 0) return 'Tanpa masa aktif';
  if (satuan === 'hari') return `${n} hari`;
  if (satuan === 'tahun') return `${n} tahun`;
  return `${n} bulan`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Bentuk paket
// ═══════════════════════════════════════════════════════════════════════

/**
 * Baca paket dari data apa pun, termasuk dokumen lama.
 *
 * Dokumen sebelum perubahan ini hanya punya `durasiHari`. Nilai itu
 * ditebak kembali ke satuan yang paling masuk akal supaya paket lama tidak
 * ikut rusak: 365 → 1 tahun, kelipatan 30 di bawah 365 → bulan, selain
 * itu → hari.
 */
export function normalisasiPaket(mentah: unknown): PaketLangganan | null {
  if (!mentah || typeof mentah !== 'object') return null;
  const data = mentah as Record<string, unknown>;
  const id = String(data.id ?? '').trim();
  const label = String(data.label ?? id).trim();
  const harga = Number(data.harga) || 0;
  if (!id || harga <= 0) return null;

  const satuan = data.satuan;
  const durasi = Number(data.durasi);
  if ((satuan === 'hari' || satuan === 'bulan' || satuan === 'tahun') && durasi > 0) {
    /*
     * ⚠️ `keterangan` hanya dipasang kalau memang ada teksnya — jangan
     * menulis `keterangan: data.keterangan`. Paket yang tidak diketik
     * keterangannya akan membawa `undefined` ikut ke dokumen.
     *
     * Hasil fungsi ini bukan hanya untuk ditampilkan: `simpanBillingServer()`
     * menulis ulang daftar paket ini apa adanya ke `jatim_pengaturan/billing`,
     * dan Firestore **menolak** `undefined` dengan pesan yang tidak menyebut
     * sumbernya — `found in field paket.0.keterangan`. Gejalanya então baru
     * muncul saat admin menekan "Simpan", dan hanya untuk paket yang
     * keterangannya memang kosong, jadi sebagian paket berhasil disimpan dan
     * sebagian lagi tidak.
     */
    const hasil: PaketLangganan = {
      id,
      label,
      harga,
      durasi: Math.round(durasi),
      satuan,
    };
    const keterangan = typeof data.keterangan === 'string' ? data.keterangan.trim() : '';
    if (keterangan) hasil.keterangan = keterangan;
    return hasil;
  }

  // Bentuk lama.
  const hari = Number(data.durasiHari) || 0;
  if (hari <= 0) return null;
  if (hari % 365 === 0) return { id, label, harga, durasi: hari / 365, satuan: 'tahun' };
  if (hari % 30 === 0 && hari < 365) return { id, label, harga, durasi: hari / 30, satuan: 'bulan' };
  return { id, label, harga, durasi: hari, satuan: 'hari' };
}

/** Normalisasi seluruh daftar paket, membuang yang tidak valid. */
export function normalisasiDaftarPaket(mentah: unknown): PaketLangganan[] {
  if (!Array.isArray(mentah)) return [];
  return mentah.map(normalisasiPaket).filter((item): item is PaketLangganan => item !== null);
}

export function paketById(paket: PaketLangganan[], id: string): PaketLangganan | null {
  return paket.find(item => item.id === id) ?? null;
}

/**
 * Awalan `order_id` untuk tagihan: `PRABAWA-<paket>-<waktu>`.
 *
 * ## Kenapa tinggal di sini
 *
 * Dua modul perlu nilai ini dan tidak bisa saling mengimpor:
 *
 * - `langganan.ts` (klien) membentuk id tagihan.
 * - `serverBilling.ts` (server) memotong id itu untuk menentukan paket mana
 *   yang dibayar.
 *
 * `langganan.ts` mengimpor SDK Firebase klien, sedangkan `serverBilling.ts`
 * **harus** tidak menariknya — kalau iya, konfigurasi yang dibaca dari
 * `import.meta.env` ikut terbawa ke bundel CJS, hasilnya kosong, dan
 * server mencetak "Mode demo aktif" di layar Admin padahal tidak.
 *
 * `durasi.ts` satu-satunya modul yang boleh diimpor kedua sisi, jadi
 * konstanta yang mereka bagi harus ada di sini. Nilai yang sama ditulis dua
 * kali akan cepat berbeda — dan gejalanya tagihan gagal aktivasi tanpa
 * pesan yang jelas.
 *
 * Awalan ini **wajib sama persis**. `serverBilling.ts` memotongnya untuk
 * menentukan paket mana yang dibayar, jadi kalau satu sisi berubah dan
 * sisi lain tidak, tagihan berhenti bisa diaktivasi tanpa pesan error yang
 * menyebut penyebabnya.
 */
export const PREFIX_ORDER_ID = 'PRABAWA';
