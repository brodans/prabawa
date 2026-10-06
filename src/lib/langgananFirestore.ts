/**
 * Akses data langganan & tagihan untuk peramban — **lewat server**.
 *
 * ## Kenapa modul ini tidak lagi menyentuh Firestore
 *
 * Semula modul ini membaca tiga koleksi langsung dari peramban memakai
 * `firebase/firestore` (SDK 140 kB gzip, 35% bundle):
 *
 * ```
 * loadPengaturanBilling()  → jatim_pengaturan/billing
 * loadLangganan()         → jatim_langganan/{username}
 * loadTagihan()           → jatim_tagihan where username == …
 * ```
 *
 * Dua alasan, dan yang kedua jauh lebih serius dari yang pertama.
 *
 * **1. Keamanan.** `firestore.rules` membiarkan ketiganya dengan
 * `allow read: if true`, dengan alasan "peramban butuh tahu masa aktif".
 *
 * Tapi aplikasi ini tidak memakai Firebase Authentication — setiap permintaan
 * dari peramban datang sebagai anonim, jadi `request.auth` selalu `null` dan
 * `if true` berarti **seluruh koleksi terbuka untuk siapa pun**. API key-nya
 * ada di `VITE_FIREBASE_API_KEY`, yang Vite suntikkan ke bundle, jadi bisa
 * diambil dari DevTools lalu dipakai lewat REST API tanpa membuka aplikasi:
 *
 * ```
 * GET https://firestore.googleapis.com/v1/projects/<id>/databases/(default)/documents/jatim_tagihan
 * ```
 *
 * Yang keluar bukan data teknis: `usernameLabel` (nama orang), `nominal`,
 * `buktiUrl` (tautan bukti transfer), `nip`, `masaAkhir`, dan `gratis` —
 * yaitu siapa yang **tidak** membayar.
 *
 * **2. Biaya unduhan.** SDK itu tidak lagi perlu sama sekali. Dengan semua
 * pembacaan lewat `POST /api/panel-auth` — yang juga sudah ada di jalur muat awal —
 * `firebase/firestore` hilang dari bundle peramban sepenuhnya: 140 kB gzip
 * lebih kecil, dan tidak ada `modulepreload` yang ditulis ke `index.html`.
 *
 * ## Yang terjadi sekarang
 *
 * ```
 * loadPengaturanBilling()  → POST /api/panel-auth {aksi:"billing:baca"}
 * loadLangganan()          → POST /api/panel-auth {aksi:"langganan:saya"}
 * loadTagihan()            → POST /api/panel-auth {aksi:"tagihan:saya"}
 * mapLangganan()           → POST /api/panel-auth {aksi:"langganan:daftar"}
 * loadSemuaTagihan()       → POST /api/panel-auth {aksi:"tagihan:daftar"}
 * ```
 *
 * Nama-nama ekspor **tidak berubah**, jadi `GerbangLangganan`, `Langganan`,
 * dan `ManajemenAkun` tidak ikut berubah.
 *
 * `username` pada `loadLangganan()` / `loadTagihan()` **diabaikan** — server
 * memakai nama akun dari token. Parameternya dibiarkan supaya pemanggilnya
 * tidak berubah, dan hasilnya benar untuk pemanggil yang sedang login (satu
 * akun aktif per tab, ditegakkan `saveSession()`).
 *
 * ## Kenapa `isFirebaseReady()` masih dipakai
 *
 * Bukan untuk membaca Firestore — Gerbang Langganan memakainya untuk
 * memutuskan apakah layanan langganan bisa diverifikasi sama sekali. Tanpa
 * Firestore di sisi server, status langganan tidak ada sumber kebenaran, dan
 * tanpa itu **semua** akun terbaca "belum bayar" dan tidak ada yang bisa
 * membayar. Keadaan itu harus terlihat, bukan diperlakukan sebagai "lolos".
 */
import {
  BILLING_DEFAULT,
  normalisasiNomorWa,
  PAKET_BAWAAN,
  TEMPLATE_WA_DEFAULT,
  type DokumenLangganan,
  type DokumenTagihan,
  type PengaturanBilling,
} from './langganan';
import { panelBatal } from './akunFirestore';

// ═══════════════════════════════════════════════════════════════════════
//  Helper
// ═══════════════════════════════════════════════════════════════════════

/**
 * Satu request ke `POST /api/panel-auth`, dengan bentuk yang dipakai modul ini.
 *
 * `panelBatal()` sudah menerjemahkan 401/403 menjadi `null`. Sisanya
 * diterjemahkan di sini supaya pemanggil cukup menulis `hasil?.dokumen`
 * tanpa perlu `try` sendiri di setiap fungsi.
 */
async function minta<T>(aksi: string, isi: Record<string, unknown> = {}): Promise<T | null> {
  try {
    return await panelBatal<T>(aksi, isi);
  } catch (err) {
    console.warn(`[langganan] Gagal memanggil ${aksi}:`, err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Pengaturan billing
// ═══════════════════════════════════════════════════════════════════════

export async function loadPengaturanBilling(): Promise<PengaturanBilling> {
  const hasil = await minta<{ nilai?: Partial<PengaturanBilling> }>('billing:baca');
  const data = hasil?.nilai;
  if (!data) return { ...BILLING_DEFAULT };
  return {
    ...BILLING_DEFAULT,
    ...data,
    rekening: Array.isArray(data.rekening) ? data.rekening : [],
    paket: Array.isArray(data.paket) && data.paket.length > 0 ? data.paket : PAKET_BAWAAN,
    // Nomor WA dinormalkan ulang saat dibaca, bukan dipercaya apa adanya
    // — dokumen lama mungkin masih menyimpan `08xx`.
    nomorWa: normalisasiNomorWa(String(data.nomorWa ?? '')).nomor,
    templateWa:
      typeof data.templateWa === 'string' && data.templateWa.trim()
        ? data.templateWa
        : TEMPLATE_WA_DEFAULT,
    metodeAktif:
      Array.isArray(data.metodeAktif) && data.metodeAktif.length > 0
        ? data.metodeAktif
        : BILLING_DEFAULT.metodeAktif,
  };
}

/**
 * ⚠️ `savePengaturanBilling()` **dihapus**, bukan dipindah.
 *
 * `setDoc` ke `jatim_pengaturan/billing` dari peramban pasti ditolak
 * `firestore.rules` (`allow write: if false`), jadi ia tidak pernah berhasil —
 * hanya *kelihatan* berhasil kalau rules yang aktif di proyek ternyata longgar.
 * Jalur yang benar `simpanBillingServer()` di `lib/serverBilling.ts`, dipanggil
 * lewat aksi `billing:simpan`.
 *
 * Dihapus, bukan dibiarkan sebagai pembungkus yang memanggil server, karena
 * nama `savePengaturanBilling` akan terlihat dan dipakai lagi — dan pemanggilnya
 * tidak akan pernah berhasil, hanya menghasilkan error.
 */

// ═══════════════════════════════════════════════════════════════════════
//  Langganan
// ═══════════════════════════════════════════════════════════════════════

/**
 * Status langganan **akun yang sedang login**.
 *
 * ⚠️ `username` diabaikan — server memakai nama akun dari token. Parameternya
 * dibiarkan supaya pemanggilnya tidak berubah, dan `saveSession()` menjamin
 * hanya ada satu akun aktif per tab.
 *
 * `null` berarti belum pernah membayar (dokumennya tidak ada) **atau** server
 * tidak bisa dihubungi. keduanya menghasilkan tampilan yang sama dari sisi
 * gerbang, dan itu tidak berubah dari perilaku sebelumnya.
 */
export async function loadLangganan(username: string): Promise<DokumenLangganan | null> {
  void username;
  const hasil = await minta<{ dokumen?: DokumenLangganan }>('langganan:saya');
  return hasil?.dokumen ?? null;
}

/**
 * Semua dokumen langganan — **admin saja**.
 *
 * Dibatasi `limit(500)` di server; sisi klien tidak menambahkan pagination
 * sendiri karena halaman Langganan menampilkan seluruh daftar dalam satu
 * tabel dan menambahkannya berarti mengubah bentuk UI.
 */
export async function mapLangganan(): Promise<Map<string, DokumenLangganan>> {
  const hasil = await minta<{ daftar?: DokumenLangganan[] }>('langganan:daftar');
  const semua = hasil?.daftar ?? [];
  return new Map(semua.map(item => [String(item.username ?? '').trim(), item]));
}

// ═══════════════════════════════════════════════════════════════════════
//  Tagihan
// ═══════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `catatPembayaran()` **dihapus** — digantikan `aktifkanLangganan()`.
 *
 * Dua alasan, dan keduanya independen:
 *
 * 1. **Sudah tidak dipakai.** `POST /api/billing/aktivasi` yang menghitung harga
 *    dan durasinya dari konfigurasi server, memverifikasi Midtrans, lalu
 *    menulis dengan Admin SDK. Fungsi lama *menerima* `nominal` dan `durasi`
 *    dari peramban — artinya siapa pun yang bisa membuka DevTools bisa menambah
 *    masa aktif sendiri dengan nilai pilihan.
 * 2. **Tidak bisa jalan.** `setDoc` ke `jatim_langganan` dan `jatim_tagihan`
 *    ditolak rules.
 *
 * Dihapus, bukan dibiarkan: tidak ada lagi jalur pembayaran yang bisa dipanggil,
 * jadi tidak perlu ada surface-nya.
 */

/*
 * ⚠️ `perpanjangManual()` **dihapus** — digantikan `perpanjangManualServer()`.
 *
 * Perpanjangan masa aktif adalah perubahan `masaAkhir`, dan `jatim_langganan`
 * tertutup untuk tulis klien. Jadi versi perambannya pasti ditolak rules;
 * sekarang lewat aksi `langganan:perpanjang` di `POST /api/panel-auth`, dengan
 * admin diverifikasi server dan durasi dibatasi.
 */

/*
 * ⚠️ `setMasaAkhir()` **dihapus** — digantikan `setMasaAkhirServer()`.
 *
 * Jalur koreksi admin sekarang aksi `langganan:set-masa-akhir`. Bedanya bukan
 * hanya siapa yang menulis: server juga **mem-parse** tanggalnya, jadi
 * `masaAkhir` yang tersimpan selalu ISO yang bisa dibaca. Nilai mentah dari
 * peramban bisa berupa apa saja, dan `masaAkhir` dibaca di banyak tempat —
 * string yang tidak bisa di-parse menghasilkan `NaN` yang tidak pernah terlihat.
 */

/**
 * Tagihan milik akun yang sedang login, terbaru dulu.
 *
 * ⚠️ `username` diabaikan, sama seperti `loadLangganan()` — server memfilter
 * berdasarkan nama akun dari token. Jadi tidak ada request yang bisa
 * diarahkan ke tagihan orang lain.
 *
 * `batas` dikirim ke server dan di sana ikut dibatasi (1–200), jadi angka
 * seenak_CLIENT tidak bisa membuat server membaca seluruh koleksi.
 */
export async function loadTagihan(username: string, batas = 20): Promise<DokumenTagihan[]> {
  void username;
  const hasil = await minta<{ tagihan?: DokumenTagihan[] }>('tagihan:saya', { batas });
  return hasil?.tagihan ?? [];
}

/** Semua tagihan, terbaru dulu — untuk rekap di halaman admin. */
export async function loadSemuaTagihan(batas = 200): Promise<DokumenTagihan[]> {
  const hasil = await minta<{ tagihan?: DokumenTagihan[] }>('tagihan:daftar', { batas });
  return hasil?.tagihan ?? [];
}
