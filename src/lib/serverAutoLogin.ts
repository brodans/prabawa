/**
 * Auto-login ke server pusat.
 *
 * ## Aturan yang dipegang modul ini
 *
 * **Server pusat selalu terhubung otomatis**, kecuali pengguna menekan
 * "Keluar dari Server" pada kartu akun di topbar. Tidak ada pengecualian
 * lain: NIP, password, dan IMEI diambil sendiri dari kredensial
 * terenkripsi, jadi membuka aplikasi tidak pernah menuntut login manual.
 *
 * Sebelumnya ini gagal dalam dua situasi, keduanya diperbaiki di sini:
 *
 * 1. **Setelah refresh halaman.** Efek auto-login lama hanya berjalan
 *    ketika `autoLoginTrigger` berubah — dan `useState` selalu kembali ke
 *    0 setelah refresh. Jadi siapa pun yang me-refresh harus login manual
 *    lagi, walau kredensialnya tersimpan. Sekarang auto-login berjalan
 *    saat komponen mount.
 *
 * 2. **Setelah "Keluar dari Server".** Cache sesi di-buang, tapi kredensial
 *    masih ada di Firestore — sehingga ada risiko auto-login menembak
 *    balik ke server yang baru saja diputus. Sekarang "Keluar dari
 *    Server" menandai akun tersebut, dan auto-login menghormati tanda itu
 *    sampai pengguna login manual sekali lagi.
 *
 * ## Tiga faktor
 *
 * `login` server punya tiga isyarat: NIP, password, dan `imei` sebagai
 * pengikat perangkat. Ketiganya diambil dari satu sumber — kredensial
 * terenkripsi di Firestore — bukan diketik ulang.
 *
 * ## Cache sesi hanya 1 jam
 *
 * `api_key` berumur pendek dan bisa dicabut server kapan saja (mis. setelah
 * "Keluar dari Server" di perangkat lain). Cache lokal disimpan di
 * `sessionStorage` dengan TTL satu jam, jadi masih ada jendela di mana
 * `api_key` yang tersimpan sudah tidak berlaku.
 *
 * Kalau cache mengembalikan token mati, `useServerContext` tetap menganggap
 * sesi "siap" karena `api_key` tidak kosong — sehingga semua panggilan
 * berikutnya gagal tanpa pernah mencoba login ulang. Untuk itu dua hal
 * ditambahkan: `tokenMasihValid()` yang menguji cache dengan satu panggilan
 * murah, dan `abaikanCache` yang memaksa login ulang dari kredensial.
 *
 * Untuk `imei` ada dua sumber, dan urutannya penting:
 *
 * 1. Nilai yang pernah diketik pengguna (akun terkunci ke satu perangkat).
 * 2. **TechMark stabil per akun panel** — UUID yang di-generate sekali
 *    lalu disimpan di localStorage.
 *
 * ⚠️ Poin ke-2 itu tidak boleh dihapus. Sebelumnya, `imei` kosong
 * dibiarkan proxy menggantinya dengan UUID yang di-generate **per
 * proses server** — jadi nilainya berubah setiap kali proxy di-restart.
 * Akibatnya auto-login untuk akun yang tidak terkunci pun bisa gagal
 * secara tidak deterministik, dan yang ketiga faktor sama sekali tidak
 * konsisten antar sesi. TechMark stabil membuat faktor ini bisa diulang.
 *
 * Catatan: `imei` adalah pengenal perangkat, **bukan rahasia** — nilainya
 * hanya dibandingkan, tidak pernah dipakai untuk otentikasi.
 */

import { rpcGetWorkCode, type ProfilPegawai } from './apiCalls';
import { getServerSessionCache, setServerSessionCache } from './cacheManager';
import { absenTimeoutMs } from './presensiContract';
import { fotoProfileValid } from './viewModels';

/** Penanda "pengguna keluar dari server" per akun panel, di localStorage. */
const KELUAR_KEY_PREFIX = 'epresensi_jatim_server_keluar_';
/** TechMark stabil per akun panel — nilai `imei` yang konsisten. */
const IMEI_KEY_PREFIX = 'epresensi_jatim_imei_';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function keluarKey(username: string): string {
  return `${KELUAR_KEY_PREFIX}${username.trim()}`;
}

function imeiKey(username: string): string {
  return `${IMEI_KEY_PREFIX}${username.trim()}`;
}

/** Sudahkah pengguna menekan "Keluar dari Server" untuk akun ini? */
export function sudahKeluarServer(username: string): boolean {
  if (!isBrowser()) return false;
  try {
    return localStorage.getItem(keluarKey(username)) === '1';
  } catch {
    return false;
  }
}

/** Tandai akun ini tidak boleh auto-login lagi. */
export function tandaiKeluarServer(username: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(keluarKey(username), '1');
  } catch {
    // localStorage ditolak — auto-login akan tetap mencoba, tidak fatal.
  }
}

/**
 * BukaAgain penanda keluar.
 *
 * Dipanggil setelah login manual berhasil, karena itu jelas bermaksud
 * "sambungkan lagi".
 */
export function tandaiAktifServer(username: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(keluarKey(username));
  } catch {
    // abaikan
  }
}

/**
 * `imei` yang stabil untuk akun panel ini.
 *
 *dikembalikan apa adanya bila pengguna pernah mengisinya (akun terkunci
 * ke perangkat tertentu). Kalau belum, dibuat satu UUID dan disimpan —
 * nilai yang sama dipakai di semua sesi berikutnya.
 */
export function imeiStabil(username: string): string {
  if (!isBrowser()) return '';
  try {
    const tersimpan = localStorage.getItem(imeiKey(username));
    if (tersimpan) return tersimpan;
    const baru =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tms-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(imeiKey(username), baru);
    return baru;
  } catch {
    return '';
  }
}

/** Simpan `imei` yang diketik pengguna supaya dipakai seterusnya. */
export function simpanImei(username: string, imei: string): void {
  if (!isBrowser() || !imei) return;
  try {
    localStorage.setItem(imeiKey(username), imei);
  } catch {
    // abaikan
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Profil
// ═══════════════════════════════════════════════════════════════════════

/** Bentuk profil yang dipakai seluruh aplikasi. */
export interface ProfilPegawaiResult {
  apiKey: string;
  id: string;
  nip: string;
  nama: string;
  jabatan: string;
  instansi: string;
  kodeInstansi: string;
  departemen: string;
  group: string;
  groupId: string;
  departmentId: string;
  idLokasi: string;
  kodeUnor: string;
  profilePic: string;
  usingWajah: number;
  usingWajahDariServer: number;
  usingWajahServer: number;
  allowWfh: number;
  vektorApproved: number;
  absenTimeout: number;
  logoDepartemen: string;
  labelWfh: string;
  imei: string;
  modul: { home: number; presensi: number; perizinan: number; laporan: number };
  /**
   * Index signature — `PegawaiProfile` punya `[key: string]: unknown` untuk
   * accommodate field tambahan yang mungkin dikirim server di masa depan,
   * jadi bentuk profil ini harus sama strukturnya agar bisa langsung
   * dipakai `setPegawai`.
   */
  [key: string]: unknown;
}

/**
 * Ubah hasil `login` server pusat menjadi bentuk profil.
 *
 * `login` mengirim profil lengkap — nama, jabatan, departemen, group,
 * logo, URL foto, flag verifikasi wajah, keempat flag modul, dan
 * `absen_timeout`. Yang tetap kosong hanya `instansi`, `kodeInstansi`,
 * `kodeUnor`, dan `idLokasi`: keempatnya memang tidak ada di balasan
 * server, dan tidak ada endpoint lain yang menyediakannya.
 */
export function toPegawaiProfile(result: ProfilPegawai, imei = ''): ProfilPegawaiResult {
  return {
    apiKey: String(result.api_key ?? ''),
    id: String(result.pegawai_id ?? ''),
    nip: result.nip,
    nama: result.nama,
    jabatan: result.jabatan ?? '',
    instansi: '',
    kodeInstansi: '',
    departemen: result.departemen,
    group: result.group_name ?? '',
    groupId: String(result.group_id ?? ''),
    departmentId: String(result.departemen_id ?? ''),
    idLokasi: '',
    kodeUnor: '',
    profilePic: fotoProfileValid(result.foto_profile),
    usingWajah: Number(result.upload_wajah ?? 0),
    usingWajahDariServer: Number(result.upload_wajah ?? 0),
    usingWajahServer: Number(result.using_wajah ?? 0),
    allowWfh: Number(result.allow_wfh ?? 0),
    vektorApproved: Number(result.vektor_approved ?? 0),
    absenTimeout: absenTimeoutMs(result),
    logoDepartemen: result.logo_departemen ?? '',
    labelWfh: result.label_wfh ?? '',
    imei,
    modul: {
      home: Number(result.home ?? 0),
      presensi: Number(result.presensi ?? 0),
      perizinan: Number(result.perizinan ?? 0),
      laporan: Number(result.laporan ?? 0),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Hasil percobaan
// ═══════════════════════════════════════════════════════════════════════

/**
 * Kode dari `PanelAuthError`, atau `0` kalau errornya error lain.
 *
 * Kenapa bentuknya diperiksa dan bukan `instanceof`:
 *
 * - `PanelAuthError` didefinisikan di `akunFirestore`, yang diimpor **secara
 *   dinamis** supaya tidak masuk jalur muat awal. `instanceof` di dalam blok
 *   `catch` akan selalu `false` untuk error dari modul yang sama, karena
 *   kelasnya belum ada saat blok itu ditulis.
 * - Bentuk `{ name: 'PanelAuthError', kode }` yang diperiksa justru yang
 *   dipasang konstruktornya (`this.name = 'PanelAuthError'`), jadi pemeriksaan
 *   ini benar secara literal, bukan tebakan.
 *
 * `0` berarti "bukan error dari endpoint panel" — termasuk error jaringan dari
 * `fetch`, yang juga dibuang `akunFirestore` sebagai `PanelAuthError(…, 0)`.
 * Keduanya sama-sama "tidak tahu jawaban server", jadi pemanggilnya boleh
 * memperlakukannya sama.
 */
function kodeGalatPanel(err: unknown): number {
  const mungkin = err as { name?: string; kode?: unknown } | null;
  if (mungkin?.name !== 'PanelAuthError') return 0;
  return typeof mungkin.kode === 'number' ? mungkin.kode : 0;
}

export type StatusAutoLogin =
  /** Sesi dipulihkan dari cache lokal — tanpa menyentuh server. */
  | 'dari-cache'
  /** Login ke server pusat berhasil. */
  | 'berhasil'
  /** Kredensial server belum pernah tersimpan untuk akun ini. */
  | 'belum-ada-kredensial'
  /** Server menjawab 402 — akun terkunci ke perangkat lain. */
  | 'terkunci-perangkat'
  /** Password/NIP ditolak server. */
  | 'kredensial-salah'
  /** Gagal lain (jaringan, error tidak terduga). */
  | 'gagal';

export interface HasilAutoLogin {
  status: StatusAutoLogin;
  /** Terisi kalau `status` = 'berhasil' atau 'dari-cache'. */
  profile?: ProfilPegawaiResult;
  /** `imei` yang dipakai — selalu non-kosong bila akun punya tech mark. */
  imei: string;
  /** Alasan singkat untuk ditampilkan ke pengguna. */
  pesan?: string;
}

/** Sambungkan server pusat dan perbarui cache sesi. */
function simpanSesi(
  username: string,
  profile: ProfilPegawaiResult,
  imei: string,
): void {
  setServerSessionCache(username, {
    apiKey: profile.apiKey ?? '',
    nip: profile.nip ?? '',
    pegawaiId: profile.id ?? '',
    idLokasi: profile.idLokasi ?? '',
    kodeInstansi: profile.kodeInstansi ?? '',
    kodeUnor: profile.kodeUnor ?? '',
    nama: profile.nama ?? '',
    jabatan: profile.jabatan ?? '',
    instansi: profile.instansi ?? '',
    departemen: profile.departemen ?? '',
    group: profile.group ?? '',
    profilePic: profile.profilePic ?? '',
    usingWajah: profile.usingWajah ?? 0,
    workCode: '',
    imei,
  });
}

/** Bentuk profil dari cache sesi lokal, tanpa field `modul` (tak ada di cache). */
function profilDariCache(
  cached: NonNullable<ReturnType<typeof getServerSessionCache>>
): ProfilPegawaiResult {
  return {
    apiKey: cached.apiKey,
    id: cached.pegawaiId,
    nip: cached.nip,
    nama: cached.nama,
    jabatan: cached.jabatan,
    instansi: cached.instansi,
    kodeInstansi: cached.kodeInstansi,
    departemen: cached.departemen,
    group: cached.group,
    groupId: '',
    departmentId: '',
    idLokasi: cached.idLokasi,
    kodeUnor: cached.kodeUnor,
    profilePic: cached.profilePic,
    usingWajah: cached.usingWajah,
    usingWajahDariServer: cached.usingWajah,
    usingWajahServer: 0,
    allowWfh: 0,
    vektorApproved: 0,
    // Tanpa server, masa berlaku konfirmasi kembali ke default 5 menit.
    absenTimeout: 300_000,
    logoDepartemen: '',
    labelWfh: '',
    imei: cached.imei ?? '',
    // Cache tidak menyimpan flag modul server; asumsikan aktif supaya
    // menu tidak ikut tersembunyi saat memulihkan sesi.
    modul: { home: 1, presensi: 1, perizinan: 1, laporan: 1 },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Percobaan otomatis
// ═══════════════════════════════════════════════════════════════════════

/**
 * Coba sambungkan ke server pusat untuk satu akun panel.
 *
 * Urutannya: cache lokal dulu (murah, tanpa jaringan), lalu kredensial
 * terenkripsi. `signal` dipakai pemanggil supaya hasil yang datang
 * terlambat bisa diabaikan saat pengguna sudah berpindah akun.
 */
export async function cobaAutoLogin(
  username: string,
  options: { signal?: AbortSignal; abaikanCache?: boolean } = {}
): Promise<HasilAutoLogin> {
  const sudahBatal = () => options.signal?.aborted === true;

  // 1. Cache sesi — jalur pintas tanpa menyentuh server.
  //
  // ⚠️ `abaikanCache` dipakai saat token dari cache ditolak server. Tanpa
  // itu, cache yang basi akan terus mengembalikan token mati pada setiap
  // muat dan auto-login tidak pernah bisa menolong diri sendiri.
  if (!options.abaikanCache) {
    const cached = getServerSessionCache(username);
    if (cached?.apiKey) {
      return { status: 'dari-cache', profile: profilDariCache(cached), imei: cached.imei ?? '' };
    }
  }

  // 2. Login ke server pusat lewat server aplikasi.
  //
  // ⚠️ Yang berubah: password server pusat **tidak lagi melewati peramban**.
  //
  // Semula langkah ini membaca `kredensial_server__{username}` langsung dari
  // Firestore dan mendekripsi `AES(password, VITE_APP_SECRET)` di browser —
  // dengan kunci yang ada di bundle, jadi seluruh password server pusat bisa
  // diambil dari Firebase Console lalu didekripsi di luar aplikasi. Sekarang
  // server mendekripsi dan memanggil gateway; yang kembali ke sini hanya
  // `api_key` dan profil.
  //
  // Impor dinamis: `akunFirestore` menarik modul lain dan modul ini ada di
  // jalur muat awal. Auto-login ke server pusat hanya perlu ketika cache lokal
  // ditolak, jadi tidak perlu diunduh lebih dulu.
  let imei = imeiStabil(username);
  try {
    /*
     * Impor dinamis, bukan statis di atas.
     *
     * Modul ini ada di jalur muat awal, dan `akunFirestore` menarik modul lain
     * yang ikut menambah ukuran muat awal. Auto-login ke server pusat baru
     * dibutuhkan kalau cache lokal ditolak — jadi SDK-nya tidak perlu diunduh
     * sebelum orang sempat melihat aplikasinya.
     *
     */
    const { autoLoginServerPusat } = await import('./akunFirestore');
    const hasil = await autoLoginServerPusat(username, imei);
    if (sudahBatal()) return { status: 'gagal', imei, pesan: 'Dibatalkan.' };

    const profilPusat = hasil.profil as unknown as ProfilPegawai;
    const profile = toPegawaiProfile({ ...profilPusat, api_key: hasil.apiKey }, imei);
    simpanSesi(username, profile, imei);
    return { status: 'berhasil', profile, imei };
  } catch (err: any) {
    if (sudahBatal()) return { status: 'gagal', imei: '', pesan: 'Dibatalkan.' };

    /*
     * Kode server dikembalikan apa adanya supaya penjelasan yang tampil sesuai
     * penyebabnya. `404`/`422` berarti kredensial belum ada atau belum bisa
     * dibaca — itu kondisi "belum diatur", bukan kegagalan.
     *
     * `402` tetap punya artinya sendiri: server pusat menjawab begitu kalau
     * akun terkunci ke perangkat lain.
     */
    const kode = kodeGalatPanel(err);
    const pesan = String(err?.message ?? 'Gagal menghubungi server pusat.');

    if (kode === 404 || kode === 422) {
      return { status: 'belum-ada-kredensial', imei: '', pesan };
    }
    if (kode === 402) {
      return {
        status: 'terkunci-perangkat',
        imei,
        pesan:
          'Akun ini terdaftar di perangkat lain. Isi kolom IMEI di Beranda dengan androidId perangkat aslinya.',
      };
    }
    if (kode === 401) {
      return { status: 'kredensial-salah', imei, pesan };
    }
    return { status: 'gagal', imei, pesan };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Orkestrasi percobaan
// ═══════════════════════════════════════════════════════════════════════

/**
 * Percobaan yang sedang berjalan per akun, plus hasilnya.
 *
 * ## Kenapa ini dipindah ke luar komponen
 *
 * Auto-login dulu dijalankan dari `useEffect` di dalam `MainApp`, dengan
 * dua alat yang saling bertabrakan:
 *
 * - `React.StrictMode` (lihat `main.tsx`) menjalankan efek **dua kali** di
 *   React 19: mount → cleanup → mount.
 * - Efek itu instalar `controller.abort()` di cleanup dan penjaga
 *   `sudahDiproses.current === username` di bodinya.
 *
 * Urutannya jadi: percobaan #1 mulai, cleanup membatalkannya, percobaan #2
 * melihat penjaga sudah terisi lalu **keluar tanpa mencoba**. Jadi
 * auto-login tidak pernah selesai — dan karena pembatalan itu "normal",
 * tidak ada error yang muncul. Gejalanya persis seperti yang dilaporkan:
 * "di reload harusnya sudah login, tapi tidak".
 *
 * Dengan percobaan dicatat di modul, StrictMode aman: mount kedua
 * menerima promise yang sama, bukan memulai percobaan baru. Dan karena
 * tidak ada `abort()` di cleanup, request yang sudah jalan tidak dibuang.
 */
type Percobaan = {
  promise: Promise<HasilAutoLogin>;
  controller: AbortController;
};

const percobaanBerjalan = new Map<string, Percobaan>();

/**
 * Mulai (atau ikuti) auto-login untuk satu akun.
 *
 * Aman dipanggil berkali-kali: panggilan kedua untuk akun yang sama
 * menerima promise yang sedang berjalan, bukan permintaan baru. Ini yang
 * membuat pemanggilan dari `useEffect` tidak perlu penjaga manual.
 *
 * ⚠️ Cakupannya **hanya percobaan yang sedang berjalan**. Selesai
 * berhasil, entri dihapus (lihat `percobaanBerjalan.delete` di bawah),
 * jadi panggilan berikutnya untuk akun yang sama memulai login baru.
 * Itu perilaku yang diinginkan: "sambung ulang" harus benar-benar
 * menanyakan ke server, bukan diam-diam memakai hasil lama.
 */
export function mulaiAutoLogin(username: string): Promise<HasilAutoLogin> {
  const sudahBerjalan = percobaanBerjalan.get(username);
  if (sudahBerjalan) return sudahBerjalan.promise;
  return jalankan(username).promise;
}

/**
 * Percobaan ulang yang memaksa login ke server.
 *
 * Dipakai saat token dari cache ternyata sudah tidak berlaku — server bisa
 * mencabut `api_key` kapan saja. Tanpa jalur ini, cache basi akan terus
 * mengembalikan token mati pada setiap muat dan pengguna tidak pernah
 * bisa masuk lagi tanpa mengetik kredensial.
 */
export function ulangAutoLoginTanpaCache(
  username: string
): { promise: Promise<HasilAutoLogin>; controller: AbortController } {
  percobaanBerjalan.get(username)?.controller.abort();
  percobaanBerjalan.delete(username);
  return jalankan(username, { abaikanCache: true });
}

/** Jalankan percobaan, catat entri running-nya, dan tandai bila berhasil. */
function jalankan(
  username: string,
  options: { abaikanCache?: boolean } = {}
): { promise: Promise<HasilAutoLogin>; controller: AbortController } {
  const controller = new AbortController();
  const promise = cobaAutoLogin(username, { signal: controller.signal, ...options })
    .catch((err: any) => ({
      status: 'gagal' as const,
      imei: '',
      pesan: String(err?.message ?? 'Gagal menghubungi server pusat.'),
    }))
    ;

  const entry: Percobaan = { promise, controller };
  percobaanBerjalan.set(username, entry);
  void promise.finally(() => {
    // Jangan hapus entri kalau ada yang lebih baru.
    if (percobaanBerjalan.get(username) === entry) percobaanBerjalan.delete(username);
  });

  return { promise, controller };
}

/** Catat bahwa cache akun ini ditolak server, agar tidak dicoba lagi. */
/**
 * Uji apakah `api_key` dari cache masih berlaku.
 *
 * Dipakai setelah memulihkan sesi dari cache: `api_key` bisa saja sudah
 * dicabut server, dan tanpa pemeriksaan itu pengguna akan melihat
 * "Koneksi gagal" di setiap halaman tanpa pernah diberi kesempatan login
 * ulang. `getworkcode` dipilih karena murah (satu baris konfigurasi jam kerja)
 * dan tetap membrhiterequisite `api_key` yang valid.
 *
 * Return `true` bila token MASIH valid, `false` bila sudah ditolak.
 *
 * Galat jaringan sengaja **tidak** dihitung sebagai token mati: satu
 * gangguan sesaat tidak boleh membuat login yang sehat ikut dibuang.
 */
export async function tokenMasihValid(
  ctx: { apiKey: string; imei: string },
  options: { signal?: AbortSignal } = {}
): Promise<boolean> {
  try {
    const rows = await rpcGetWorkCode(ctx, { signal: options.signal });
    return Array.isArray(rows);
  } catch {
    return true;
  }
}

/**
 * Batalkan percobaan yang sedang berjalan untuk semua akun.
 *
 * Dipakai waktu komponen dilepas. ⚠️ Berbeda dari versi lama, ini **tidak**
 * memengaruhi apa yang akan terjadi saat komponen dipasang lagi: cache dan
 * penanda berhasil tetap utuh, jadi setelah reload aplikasi tetap
 * tersambung.
 */
function batalkanSemuaPercobaan(): void {
  for (const entry of percobaanBerjalan.values()) entry.controller.abort();
  percobaanBerjalan.clear();
}

/** Bersihkan seluruh status auto-login — dipanggil saat keluar dari akun panel. */
export function resetAutoLogin(): void {
  batalkanSemuaPercobaan();
}
