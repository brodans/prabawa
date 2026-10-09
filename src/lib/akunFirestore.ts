/**
 * Akses data akun panel dari sisi peramban.
 *
 * ## ⚠️ Semua operasi lewat `/api/panel-auth` — tidak ada Firestore langsung
 *
 * Modul ini **tidak** lagi mengimpor `firebase/firestore`. Setiap operasi
 *kilau hanya mengirim permintaan ke server, dan server yang membaca/menulis
 * Firestore memakai Admin SDK.
 *
 * ## Kenapa berubah total
 *
 * Versi lama menjalankan seluruh autentikasi **di peramban**: `getDoc` +
 * `bcrypt.compare`. Itu berarti `firestore.rules` harus membuka
 * `jatim_pengguna` untuk baca **dan** tulis — jadi:
 *
 * - hash password semua orang bisa dibaca siapa pun yang punya API key;
 * - `role: 'admin'` bisa ditulis sendiri lalu di-refresh → **eskalasi peran**.
 * - batas brute force hanya ada di `localStorage`, dihapus dengan satu baris.
 *
 * Dengan semua operasi pindah ke server, rules bisa ditutup total untuk
 * `jatim_pengguna` dan `jatim_pengaturan/auth`, dan peran tidak pernah lagi
 * datang dari dokumen yang bisa ditulis klien. Bentuk ekspor di bawah
 * **sengaja tidak berubah**, jadi `ManajemenAkun.tsx`, `SettingAkunModal.tsx`,
 * dan `serverAutoLogin.ts` tidak ikut berubah.
 *
 * ## Token
 *
 * Token sesi disimpan di modul `sessionManager` (bukan di sini) dan dikirim
 * lewat header `Authorization`. Modul ini tidak pernah menyentuhnya langsung —
 * `sesi()` di bawah membacanya dari `sessionManager`, yang menjadi satu-satunya
 * pemilik token.
 */

import type {
  TabPermissions,
  UserAccount,
  UserAccountSafe,
  UserRole,
} from './userManager';
import type { DokumenLangganan } from './langganan';
import { tokenAktif } from './sessionManager';
import { AKSI_WAJIB, KONTRAK_VERSI } from './kontrakServer';

const PANEL_AUTH_TIMEOUT_MS = 15_000;

/** Bentuk respons `POST /api/panel-auth`. */
interface HasilPanel {
  ok: boolean;
  kode: number;
  pesan?: string;
  terkunci?: number;
  jumlah?: number;
  token?: string;
  akun?: UserAccountSafe;
  daftar?: UserAccount[];
  ringkasan?: RingkasanKredensial;
  /** Dokumen langganan setelah server menulisnya. */
  dokumen?: Record<string, unknown>;
}

/*
 * Status kontrak server, dibaca peramban.
 *
 * ## Kenapa module-level, bukan state React
 *
 * `panel()` dipanggil dari `sessionManager` dan modul lain yang tidak punya
 * akses ke React. Menaruh statusnya di `AppContext` berarti setiap pemanggil
 * harus menyalinnya, dan satu yang lupa = bug senyap yang sama.
 *
 * Ditulis sekali saat setiap respons lewat, dibaca saat render banner.
 */
let kontrakTerdeteksi: number | null = null;
const aksiHilang: string[] = [];

/** Versi kontrak dari respons server terakhir; `null` = belum ada respons. */
export function kontrakServerTerlihat(): number | null {
  return kontrakTerdeteksi;
}

/** Aksi yang server belum ada di versi ini. */
export function aksiServerHilang(): string[] {
  return aksiHilang;
}

/**
 * `true` kalau server yang menjawab adalah versi yang **tidak cocok** dengan
 * peramban.
 *
 * `null` (belum ada respons) sengaja **tidak** dianggap tidak cocok — banner
 * akan muncul untuk semua orang setiap kali aplikasi dibuka, sebelum request
 * pertama selesai. Itu hanya noise.
 */
export function kontrakServerBasi(): boolean {
  return kontrakTerdeteksi !== null && kontrakTerdeteksi !== KONTRAK_VERSI;
}

/** Galat yang membawa pesan server apa adanya, supaya UI tidak mengarang. */
export class PanelAuthError extends Error {
  readonly kode: number;
  /** Sisa detik penguncian, kalau server melaporkan penguncian. */
  readonly terkunci?: number;
  /**
   * Data tambahan yang	server kirim bersama penolakan.
   *
   * Satu-satunya pemakai sekarang: `buatTagihan` mengembalikan `orderId`
   * tagihan yang sudah ada ketika server menolak pembuatan baru. Tanpa ini
   * peramban hanya bisa menampilkan pesan "sudah ada tagihan lain" tanpa
   * mengetahui **yang mana** — dan tidak bisa melanjutkannya.
   *
   * ⚠️ Jangan pernah menampilkan `isi` ini apa adanya ke pengguna: isinya
   * berasal dari server, dan `pesan` sudah diuraikan khusus untuk manusia.
   */
  readonly isi: Record<string, unknown>;

  constructor(pesan: string, kode: number, terkunci?: number, isi: Record<string, unknown> = {}) {
    super(pesan);
    this.name = 'PanelAuthError';
    this.kode = kode;
    this.terkunci = terkunci;
    this.isi = isi;
  }
}

/**
 * Kirim satu permintaan ke `/api/panel-auth`.
 *
 * Token diambil dari `sessionManager` — bukan parameter — supaya tidak ada
 * pemanggil yang bisa lupa mengirimkannya. Bila token tidak ada, header tidak
 * diisi dan server yang menolak; itu lebih baik daripada mengirim token kosong
 * yang terlihat seperti "sudah login tapi invalid".
 */
async function panel<T = HasilPanel>(
  aksi: string,
  isi: Record<string, unknown> = {}
): Promise<T & HasilPanel> {
  let respons: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PANEL_AUTH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const token = tokenAktif();
    if (token) headers.Authorization = `Bearer ${token}`;

    respons = await fetch('/api/panel-auth', {
      method: 'POST',
      headers,
      body: JSON.stringify({ aksi, ...isi }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new PanelAuthError(
      controller.signal.aborted
        ? 'Server autentikasi tidak merespons dalam 15 detik. Periksa koneksi lalu coba lagi.'
        : 'Tidak bisa menghubungi server autentikasi. Periksa koneksi internet Anda.',
      0
    );
  }

  let hasil: T & HasilPanel;
  try {
    hasil = (await respons.json()) as T & HasilPanel;
  } catch {
    const waktuHabis = controller.signal.aborted;
    throw new PanelAuthError(
      waktuHabis
        ? 'Server autentikasi tidak merespons dalam 15 detik. Periksa koneksi lalu coba lagi.'
        : 'Respons server autentikasi tidak bisa dibaca. Coba muat ulang halaman.',
      waktuHabis ? 0 : respons.status
    );
  } finally {
    clearTimeout(timeout);
  }

  catatKontrak(hasil, aksi);

  if (!hasil.ok) {
    throw new PanelAuthError(
      hasil.pesan ?? 'Permintaan ditolak server.',
      hasil.kode ?? respons.status,
      hasil.terkunci,
      hasil as unknown as Record<string, unknown>
    );
  }
  return hasil;
}

/**
 * Catat versi kontrak dari setiap respons — termasuk yang `ok: false`.
 *
 * Respons penolakan justru yang paling perlu diperiksa: "kredensial salah"
 * dari server versi lama dan dari server yang sama-sama salah, dan satu-
 * satunya pembeda adalah versi kontraknya.
 */
function catatKontrak(hasil: unknown, aksi: string): void {
  if (!hasil || typeof hasil !== 'object') return;
  const versi = (hasil as Record<string, unknown>).kontrakVersi;
  if (typeof versi === 'number') kontrakTerdeteksi = versi;

  /*
   * Aksi yang hilang dilaporkan terpisah dari versi.
   *
   * Kalau server mengulang versi yang sama tanpa satu aksi yang peramban
   * panggil, itu build yang lebih lama — dan menyebut nama aksinya membuat
   * diagnosis satu kalimat, bukan "coba deploy ulang" yang bisa benar atau
   * salah.
   */
  if ((AKSI_WAJIB as readonly string[]).includes(aksi)) return;
  if (!aksiHilang.includes(aksi)) aksiHilang.push(aksi);
}

/**
 * Versi `panel()` yang **tidak melempar** saat server menolak.
 *
 * Yang dikembalikan `null` adalah "tidak ada data" — bukan "server error".
 * Dipakai `langgananFirestore.ts`, yang memakai nilai cadangan sebagai tanda
 * dokumen tidak terbaca.
 *
 * ⚠️ Yang ditelan hanya `401`/`403`. Kesalahan lain (jaringan, 500, 503)
 * tetap dilempar supaya masalah konfigurasi server tidak ikut disamarkan
 * menjadi "langganan habis" — gejalanya pengguna mengira tagihannya yang
 * bermasalah, padahal server-lah yang salah.
 */
export async function panelBatal<T = HasilPanel>(
  aksi: string,
  isi: Record<string, unknown> = {}
): Promise<(T & HasilPanel) | null> {
  try {
    return await panel<T>(aksi, isi);
  } catch (err) {
    if (err instanceof PanelAuthError && (err.kode === 401 || err.kode === 403)) return null;
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Login
// ═══════════════════════════════════════════════════════════════════════

/**
 * Verifikasi kredensial panel lewat server.
 *
 * Berbeda dengan versi lama, **tidak ada lagi** pembacaan `pinEncrypted`
 * langsung dari `jatim_pengaturan/auth`. Dua alasan:
 *
 * 1. `adminUsername` yang kosong dulu membuat `storedAdmin ? … : true`
 *    menerima **username apa pun** + password admin → admin penuh. Server
 *    sekarang selalu membandingkan nama, dan field kosong berarti `admin`
 *    (nama bawaan), bukan "apa pun".
 * 2. Membaca `pinHash` di peramban berarti seluruh hash password admin
 *    bisa diambil dari Firebase Console dan dipecah secara offline.
 *
 * Token yang dikembalikan **wajib** disimpan lewat `saveSession()` supaya
 * modul ini tidak jadi pemilik kedua token.
 */
/**
 * Hasil login: akun **dan** token.
 *
 * Keduanya harus dikembalikan bersama. `akun` tanpa `token` tidak berguna —
 * sesi yang tidak bisa diverifikasi tidak boleh disimpan, itu Rules of the
 * game yang modul ini tegakkan.
 */
export interface HasilMasukPanel {
  akun: UserAccountSafe;
  token: string;
}

export async function masukPanelPanel(
  username: string,
  password: string
): Promise<HasilMasukPanel> {
  const hasil = await panel('masuk', { username, password });
  if (!hasil.akun || !hasil.token) {
    throw new PanelAuthError('Server tidak mengembalikan sesi yang valid.', 500);
  }
  return { akun: hasil.akun, token: hasil.token };
}

/**
 * Cocokkan token dengan server.
 *
 * Dipanggil sekali saat aplikasi dibuka. Ini yang memastikan sesi di
 * `sessionStorage` bukan sekadar JSON yang bisa diedit di DevTools: server
 * memeriksa tanda tangannya dan **membaca ulang peran dari dokumen**.
 */
export async function verifikasiSesiPanel(
  token: string
): Promise<{ akun: UserAccountSafe; tokenBaru?: string }> {
  const hasil = await panel('verifikasi', { token, perbarui: true });
  if (!hasil.akun) throw new PanelAuthError('Sesi tidak valid atau sudah berakhir.', 401);
  return { akun: hasil.akun, tokenBaru: hasil.token };
}

// ═══════════════════════════════════════════════════════════════════════
//  Kelola akun (admin)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Daftar seluruh akun panel.
 *
 * Nilai `role` dan `permissions` berasal dari server — hasil perhitungan ulang
 * dari dokumen, bukan apa adanya seperti yang tersimpan. Jadi dokumen yang
 * isinya_role user tapi izinnya admin tidak pernah ditampilkan apa adanya.
 */
export async function fetchAllUsers(): Promise<UserAccount[]> {
  const hasil = await panel('akun:daftar');
  return hasil.daftar ?? [];
}

export async function createUserAccount(input: {
  username: string;
  password: string;
  role: UserRole;
  permissions?: Partial<TabPermissions>;
  namaLengkap?: string;
  nip?: string;
  catatan?: string;
}): Promise<UserAccountSafe> {
  const hasil = await panel('akun:buat', {
    username: input.username,
    password: input.password,
    role: input.role,
    permissions: input.permissions,
    namaLengkap: input.namaLengkap,
    nip: input.nip,
    catatan: input.catatan,
  });
  if (!hasil.akun) throw new PanelAuthError('Akun dibuat, tapi server tidak mengembalikan detailnya.', 500);
  return hasil.akun;
}

export async function updateUserAccount(
  username: string,
  updates: {
    usernameBaru?: string;
    password?: string;
    role?: UserRole;
    permissions?: Partial<TabPermissions>;
    namaLengkap?: string;
    nip?: string;
    catatan?: string;
    nonaktif?: boolean;
  }
): Promise<void> {
  await panel('akun:ubah', { username, ...updates });
}

export async function deleteUserAccount(username: string): Promise<void> {
  await panel('akun:hapus', { username });
}

/**
 * Verifikasi password lokal — **dihapus**.
 *
 * Fungsi ini dulu membandingkan hash di peramban. Sekarang password hanya
 * bisa diverifikasi server, jadi tidak ada versi klien yang jujur. Yang
 * tersisa adalah gimmik yang hanya superficially works: membandingkan
 * password kiriman dengan password lama yang dikirim ulang — yang justru
 * membocorkan password lama ke jaringan.
 *
 * `verifyUserPassword` tidak lagi diekspor. Satu-satunya tempat yang
 * memeriksa password lama adalah server.
 */

// ═══════════════════════════════════════════════════════════════════════
//  Kredensial server pusat
// ═══════════════════════════════════════════════════════════════════════

/**
 * Simpan kredensial server pusat.
 *
 * Password **tidak lagi** dienkripsi di peramban dengan `VITE_APP_SECRET`.
 * Kuncinya ada di bundle, jadi enkripsi itu hanya obfuscation; sekarang
 * server mengenkripsi dengan kunci turunan `PANEL_SESSION_SECRET` yang tidak
 * pernah masuk bundle.
 */
export async function saveServerCredential(
  username: string,
  nip: string,
  password: string,
  imei = ''
): Promise<void> {
  await panel('kredensial:simpan', { username, nip, password, imei });
}

/**
 * Login ke server pusat untuk satu akun panel.
 *
 * ⚠️ Password server pusat **tidak pernah ada di peramban**.
 *
 * Versi lama membaca `kredensial_server__{username}` dari Firestore lalu
 * mendekripsi `AES(password, VITE_APP_SECRET)` di browser — dengan kunci yang
 * ada di bundle, jadi seluruh password server pusat bisa diambil dari Firebase
 * Console. Sekarang server yang mendekripsi dan memanggil gateway; yang kembali
 * ke sini hanya `api_key` dan profil.
 *
 * `api_key` memang selalu ada di peramban (itu nature sesi gateway), dan itu
 * tidak berubah.
 */
export async function autoLoginServerPusat(
  username: string,
  imei = ''
): Promise<{ apiKey: string; profil: Record<string, unknown> }> {
  const hasil = await panel<{ apiKey?: string; profil?: Record<string, unknown> }>(
    'pusat:login',
    { username, imei }
  );
  if (!hasil.apiKey || !hasil.profil) {
    throw new PanelAuthError('Server pusat tidak mengembalikan sesi login.', 502);
  }
  return { apiKey: hasil.apiKey, profil: hasil.profil };
}

/**
 * Metadata kredensial server pusat — **tanpa passwordnya**.
 *
 * Ini yang dipakai tiga tempat di UI (Beranda, Langganan, KredensialServerModal).
 * Semula ekspornya mengembalikan `passwordEncrypted` yang bisa didekripsi di
 * peramban, karena kuncinya ada di bundle. Sekarang dokumennya hanya dibaca
 * server dan field password tidak pernah dikirim keluar — pemanggil hanya perlu
 * NIP, IMEI, dan apakah passwordnya masih bisa dipakai.
 *
 * `terbaca: false` berarti dokumen format lama. Pemanggil menampilkan
 * "simpan ulang" beserta `pesan` dari server, bukan pesan umum.
 */
export interface RingkasanKredensial {
  nip: string;
  imei: string;
  /** true = password tersimpan dan bisa dibaca server. */
  terbaca: boolean;
  updatedAt: string;
  /** Penjelasan server kalau `terbaca` false. */
  pesan?: string;
}

export async function ringkasanKredensial(
  username: string
): Promise<RingkasanKredensial | null> {
  try {
    const hasil = await panel<{ ringkasan?: RingkasanKredensial }>('kredensial:ringkas', {
      username,
    });
    return hasil.ringkasan ?? null;
  } catch (err) {
    if (err instanceof PanelAuthError && err.kode === 404) return null;
    throw err;
  }
}

/**
 * Metadata kredensial **seluruh akun** — hanya untuk admin.
 *
 * Menggantikan pemanggilan `ringkasanKredensial()` dalam `loop` di
 * `ManajemenAkun`. Bentuk per-akun tetap ada untuk dialog satu akun
 * (`KredensialServerModal`) dan form admin; bentuk batch ini khusus tabel
 * yang menampilkan semua akun sekaligus.
 *
 * Akun tanpa dokumen kredensial **tidak muncul** di hasil — persis seperti
 * `ringkasanKredensial()` yang mengembalikan `null` untuk mereka.
 */
export async function semuaRingkasanKredensial(): Promise<Map<string, RingkasanKredensial>> {
  const hasil = await panel<{ daftar?: Record<string, RingkasanKredensial> }>(
    'kredensial:ringkas-semua'
  );
  const peta = new Map<string, RingkasanKredensial>();
  for (const [username, nilai] of Object.entries(hasil.daftar ?? {})) {
    if (nilai) peta.set(username, nilai);
  }
  return peta;
}

export async function hapusServerCredential(username: string): Promise<void> {
  await panel('kredensial:hapus', { username });
}

// ═══════════════════════════════════════════════════════════════════════
//  Password akun sendiri
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ganti password akun panel yang sedang dipakai.
 *
 * `passwordLama` diverifikasi server terhadap dokumen. Untuk akun admin
 * bawaan (yang tidak punya dokumen), server yang memutuskan jalurnya.
 */
// ═══════════════════════════════════════════════════════════════════════
//  Langganan, tagihan, dan billing
//
//  Semuanya lewat server. Versi perambannya tidak pernah bisa berhasil:
//  `firestore.rules` menutup `jatim_langganan`, `jatim_tagihan`, dan
//  `jatim_pengaturan/billing` untuk tulis klien — lihat catatan panjang di
//  `lib/langgananFirestore.ts`.
//
//  Yang membedakan dari operasi akun di atas: ini **hanya admin**, dan token
//  yang salah perannya akan ditolak server — bukan disembunyikan di UI.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Bentuk respons untuk operasi langganan.
 *
 * Pembungkus tipis: nama aksi diteruskan apa adanya, jadi ada satu tempat yang
 * perlu diubah kalau ada aksi baru — bukan tujuh fungsi yang masing-masing
 * memanggil `panel()` dengan format sendiri.
 */
async function langganan(aksi: string, isi: Record<string, unknown> = {}): Promise<HasilPanel> {
  return panel(aksi, isi);
}

/**
 * Perpanjang masa aktif tanpa mencatat pembayaran (khusus admin).
 *
 * ⚠️ `totalBayar` **tidak** naik — perpanjangan manual bukan pembayaran.
 */
export async function perpanjangManual(input: {
  username: string;
  durasi?: number;
  satuan?: string;
  catatan?: string;
}): Promise<DokumenLangganan> {
  const hasil = await langganan('langganan:perpanjang', { ...input });
  const dokumen = hasil.dokumen;
  if (!dokumen) throw new PanelAuthError(hasil.pesan ?? 'Gagal memperpanjang.', hasil.kode);
  return dokumen as unknown as DokumenLangganan;
}

/** Setel masa aktif ke waktu tertentu (koreksi admin). */
export async function setMasaAkhir(username: string, iso: string): Promise<void> {
  await langganan('langganan:set-masa-akhir', { username, iso });
}

/** Tandai akun sebagai gratis (exempt) atau kembalikan ke normal. */
export async function setGratis(username: string, gratis: boolean, alasan = ''): Promise<void> {
  await langganan('langganan:set-gratis', { username, gratis, alasan });
}

/**
 * Buat dokumen tagihan berstatus `menunggu`, sebelum pembayaran dikirim.
 *
 * ⚠️ Cuma empat isian yang benar-benar dikirim. `username`, `nominal`,
 * `durasi`, dan `satuan` **tidak boleh** dikirim dari sini: server mengambil
 * semuanya dari token dan konfigurasi paketnya sendiri. Kalau peramban ikut
 * mengirim angkanya, nilainya hanya jadi bahan tebak-tebakan yang tidak pernah
 * dibaca — dan membiarkan Opera berarti ada dua sumber kebenaran.
 *
 * `paketId` justru tetap dikirim, sebagai **pemeriksa**: server membandingkannya
 * dengan paket yang tersembunyi di dalam `orderId` dan menolak kalau beda,
 * supaya harga yang berubah di tengah sesi tidak sampai terisi diam-diam.
 */
export async function buatTagihan(input: {
  orderId: string;
  usernameLabel: string;
  paketId: string;
  metode: string;
}): Promise<void> {
  try {
    await langganan('tagihan:buat', { ...input });
  } catch (galat) {
    /*
     * Server menolak pembuatan baru kalau akun sudah punya tagihan `menunggu`,
     * dan menyertakan `orderId` tagihan itu di responsnya.
     *
     * Galat itu diteruskan apa adanya — pemanggil yang sudah tahu harus
     * melanjutkan atau membatalkan tagihan lama, dan ditelan di sini jadi
     * informasi yang paling dibutuhkan justru hilang. `GerbangLangganan` yang
     * membacanya lewat `PanelAuthError.isi`.
     */
    throw galat;
  }
}

/**
 * Tandai tagihan lunas / batal — **tanpa** menambah masa aktif.
 *
 * `lunas`/`menunggu` hanya untuk admin. `batal` juga boleh untuk pemilik
 * tagihannya sendiri: itu satu-satunya jalan keluar dari aturan satu-tagihan,
 * jadi tanpa ini akun yang salah pilih paket tidak bisa apa-apa.
 *
 * `status` dikirim apa adanya, bukan dipetakan di sini — server yang menentukan
 * apa yang diizinkan untuk peran pemanggil.
 */
export async function setStatusTagihan(
  orderId: string,
  status: string,
  catatan = ''
): Promise<void> {
  await langganan('tagihan:status', { orderId, status, catatan });
}

/**
 * Batalkan tagihan milik sendiri yang masih `menunggu`.
 *
 * Server menolak kalau dokumen bukan milik pemanggil, atau statusnya bukan
 * `menunggu` (mis. sudah `lunas` — penanda lunas harus tetap datang dari
 * verifikasi pembayaran, tidak dari klik pengguna).
 */
export async function batalkanTagihan(orderId: string): Promise<void> {
  await langganan('tagihan:status', { orderId, status: 'batal' });
}

/** Hapus tagihan yang batal atau salah input. */
export async function hapusTagihan(orderId: string): Promise<void> {
  await langganan('tagihan:hapus', { orderId });
}

/** Hapus seluruh riwayat tagihan — khusus admin. */
export async function hapusSemuaTagihan(): Promise<number> {
  const hasil = await langganan('tagihan:hapus-semua', {});
  if (typeof hasil.jumlah !== 'number') {
    throw new PanelAuthError('Server tidak mengembalikan jumlah tagihan yang dihapus.', hasil.kode);
  }
  return hasil.jumlah;
}

/** Simpan pengaturan billing: paket, QRIS, rekening, nomor WA. */
export async function savePengaturanBilling(nilai: unknown): Promise<void> {
  await langganan('billing:simpan', { nilai });
}

export async function gantiPasswordAkun(
  isi: { passwordLama: string; passwordBaru: string }
): Promise<void> {
  await panel('password:ganti', isi);
}

/**
 * Ganti username dan/atau password **admin bawaan**.
 *
 * Dipakai `SettingAkunModal`. Server meminta password admin saat ini dan
 * memverifikasinya terhadap dokumen, jadi langkah ini tidak bisa dijalankan
 * hanya dengan sesi admin yang tersimpan di `sessionStorage`.
 */
export async function ubahKredensialAdminBawaan(isi: {
  passwordLama: string;
  passwordBaru?: string;
  usernameBaru?: string;
}): Promise<string> {
  const hasil = await panel<HasilPanel>('admin:ubah', isi);
  return hasil.pesan ?? 'Kredensial admin diperbarui.';
}

/**
 * Username admin bawaan saat ini.
 *
 * Tidak lagi diambil dari Firestore klien (dokumen itu tidak bisa dibaca lagi).
 * Yang dikembalikan adalah nama yang berlaku di server — sumber yang sama
 * dengan yang dipakai saat memverifikasi login.
 */
export async function bacaNamaAdminBawaan(): Promise<string> {
  const hasil = await panel<{ namaAdmin?: string }>('admin:nama');
  return typeof hasil.namaAdmin === 'string' ? hasil.namaAdmin : '';
}
