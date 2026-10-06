/**
 * Manajemen sesi panel.
 *
 * ## Yang disimpan di sini bukan kredensial, tapi **token server**
 *
 * Sesi yang disimpan adalah token bertanda tangan HMAC yang diterbitkan
 * `POST /api/panel-auth`, bukan objek akun yang bisa disusun sendiri.
 *
 * Ini adalah perubahan paling penting dari modul ini. Sebelumnya
 * `loadSession()` mengembalikan `currentUser` apa adanya dari `sessionStorage`,
 * dan `boundRole` hanya memeriksa konsistensi **dalam** — mengubah `role` dan
 * `boundRole` bersama-sama akan lolos. Sekarang:
 *
 * - `saveSession()` menolak sesi tanpa token server — parameter tokennya wajib.
 * - `AppContext` memverifikasi token ke server **setiap kali aplikasi dibuka**,
 *   dan memakai `role`/`permissions` yang dikembalikan server — yang dibaca
 *   ulang dari dokumen Firestore, bukan dari storage.
 *
 * Jadi mengedit `sessionStorage` di DevTools tidak lagi berarti apa-apa: token
 * yang dimodifikasi gagal tanda tangannya, dan token asli pun akan ditolak
 * server kalau dokumen sudah berubah.
 *
 * ## Kenapa peramban sama sekali tidak menyentuh Firestore untuk akun
 *
 * Karena aplikasi tidak memakai Firebase Authentication, semua permintaan
 * Firestore dari klien datang sebagai **anonim**. `firestore.rules` tidak bisa
 * membedakan admin dari user biasa — jadi `jatim_pengguna` hanya boleh dibaca
 * dan ditulis oleh server (Admin SDK). Tanpa itu, `setDoc({ role: 'admin' })`
 * pada dokumen sendiri adalah eskalasi peran yang lengkap, dan itulah akar
 * laporan "saya login user, reload jadi admin".
 *
 * ## Akun yang sedang aktif HARUS eksplisit
 *
 * Versi lama `loadSession()` menelusuri `sessionStorage` dan mengembalikan
 * **sesi valid pertama yang kebetulan ditemukan**:
 *
 * ```ts
 * for (let index = 0; index < sessionStorage.length; index++) {
 *   const key = sessionStorage.key(index);
 *   ...
 *   return session;   // ← yang pertama, bukan "yang sedang dipakai"
 * }
 * ```
 *
 * Itu bug yang serius: begitu ada dua sesi di storage, akun mana yang muncul
 * setelah **refresh** ditentukan oleh urutan internal `sessionStorage` — bukan
 * oleh akun yang sedang dipakai.
 *
 * Perbaikannya adalah menyimpan **penunjuk akun aktif** secara eksplisit.
 * `loadSession()` membaca penunjuk itu dan memuat tepat satu sesi.
 *
 * Kalau penunjuk tidak ada (naik dari versi lama, atau storage dibersihkan
 * sebagian), `loadSession()` tidak menebak:
 *
 * - **tepat satu sesi valid** → sesi itu yang dipakai, lalu penunjuk ditulis;
 * - **lebih dari satu sesi** → situationnya ambigu, jadi **semua** dibuang dan
 *   pemanggil diminta login ulang.
 *
 * ## Penyimpanan
 *
 * Sesi disimpan per-akun di sessionStorage (bukan localStorage) supaya
 * menutup tab otomatis mengeluarkan pengguna — penting untuk panel absensi
 * yang dipakai perangkat bersama.
 */

import {
  type TabPermissions,
  type UserAccountSafe,
  type UserRole,
} from './userManager';

/**
 * Sesi idle dibatalkan setelah 30 menit tanpa aktivitas.
 *
 * ⚠️ Harus **sama** dengan masa berlaku token di `lib/panelServer.ts`. Kalau
 * lebih pendek, pengguna logout tanpa sebab; kalau lebih panjang, sesi
 * kedaluwarsa masih sempat dipakai sebelum server menolaknya.
 */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

const SESSION_KEY_PREFIX = 'epresensi_jatim_session_';
/**
 * Penunjuk akun yang sedang dipakai.
 *
 * ⚠️ Sengaja TIDAK memakai awalan `epresensi_jatim_session_`, supaya
 * `clearAllSessions()` dan `loadSession()` tidak ikut memprosesnya sebagai
 * sesi biasa.
 */
const ACTIVE_KEY = 'epresensi_jatim_sesi_aktif';

/**
 * ⚠️ Dinaikkan dari 1 ke 2 **sengaja**.
 *
 * Sesi versi 1 adalah `{ currentUser, tabPermissions, boundRole }` — objek
 * JSON polos yang peramban bisa bebas menyusun. Tidak ada cara membuatnya
 * dipercaya, jadi **harus dibuang**, bukan dibaca lalu "divalidasi": validasi
 * apa pun yang bisa lolos di peramban bisa dilewati juga oleh orang yang
 * menyunting storagenya. Menaikkan versi membuat `bacaSatu()` langsung
 * membuang setiap sesi lama, dan satu-satunya jalan masuknya sekarang adalah
 * token bertanda tangan.
 */
const SESSION_VERSION = 2;

export interface StoredSession {
  version: number;
  /** Akun, untuk ditampilkan. `role` di sini **bukan** sumber kebenaran. */
  currentUser: UserAccountSafe;
  tabPermissions: TabPermissions;
  authTime: number;
  boundRole: UserRole;
  /**
   * Token bertanda tangan dari server.
   *
   * Inilah satu-satunya bukti yang dipercaya. Tanpa token, sesi tidak pernah
   * dipulihkan.
   */
  token: string;
}

function sessionKey(username: string): string {
  return `${SESSION_KEY_PREFIX}${username.trim()}`;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** True kalau `key` adalah kunci sesi (bukan penunjuk aktif). */
function adalahKunciSesi(key: string | null): key is string {
  return key !== null && key.startsWith(SESSION_KEY_PREFIX);
}

/** Baca penunjuk akun aktif; `''` bila tidak ada. */
function akunAktif(): string {
  try {
    return sessionStorage.getItem(ACTIVE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Tulis penunjuk akun aktif. */
function setAkunAktif(username: string): void {
  try {
    if (username) sessionStorage.setItem(ACTIVE_KEY, username);
    else sessionStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Tidak fatal: tanpa penunjuk, `loadSession()` jatuh ke jalur
    // "tepat satu sesi", yang deterministik.
  }
}

/**
 * Baca dan validasi satu sesi dari storage.
 *
 * Mengembalikan `null` **dan menghapus** sesi yang tidak valid — versi tidak
 * cocok, token kosong, peran tidak cocok, atau kedaluwarsa.
 *
 * ⚠️ Yang diperiksa modul ini hanya bentuk dan umur. **Keaslian token tidak
 * bisa dinilai di sini** — hanya server yang memegang kuncinya. Karena itu
 * `AppContext` selalu memanggil `verifikasiSesiPanel()` sebelum mempercayai
 * `role` dari sini; pemeriksaannya di modul ini adalah lapis pertama, bukan
 * penjaga terakhir.
 */
function bacaSatu(key: string): StoredSession | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as StoredSession;
    if (session.version !== SESSION_VERSION) {
      sessionStorage.removeItem(key);
      return null;
    }
    // Token wajib ada. Sesi tanpa token adalah sesi versi lama yang lolos
    // dari pemeriksaan versi ditulis ulang oleh peramban — tidak bisa dipercaya.
    if (typeof session.token !== 'string' || !session.token) {
      sessionStorage.removeItem(key);
      return null;
    }
    // Bentuk token diperiksa: `<payload>.<signature>`. Ini bukan verifikasi
    // kriptografis — hanya menyaring masukan yang jelas bukan token server,
    // supaya `AppContext` tidak studsdk request yang pasti ditolak.
    if (session.token.split('.').length !== 2) {
      sessionStorage.removeItem(key);
      return null;
    }
    // Peran akun harus cocok — mencegah inkonsistensi internal yang bisa
    // terjadi kalau `currentUser` ditulis ulang di storage.
    if (session.currentUser?.role !== session.boundRole) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (!session.currentUser?.username) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() - session.authTime > SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

/** Semua kunci sesi yang ada, apa pun keadaannya. */
function semuaKunciSesi(): string[] {
  const out: string[] = [];
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (adalahKunciSesi(key)) out.push(key);
    }
  } catch {
    // Penyimpanan tidak bisa dibaca — anggap tidak ada sesi.
  }
  return out;
}

/*
 * ⚠️ `createAdminUserAccount()` **dihapus** — bukan pernah ada pemanggilnya.
 *
 * Fungsi itu menyusun `UserAccountSafe` dengan `role: 'admin'` dari atas
 * sendiri, di peramban, tanpa token. Semula dipakai `LoginScreen` untuk
 * membuat sesi admin bawaan; sekarang seluruh autentikasi lewat
 * `POST /api/panel-auth`, dan peran **selalu** dibaca server dari dokumen
 * Firestore.
 *
 * Fungsi seperti ini berbahaya justru karena tidak terpakai: sekali
 * diimpor lagi, ia menyediakan jalan membuat sesi admin lokal yang tidak
 * perlu diverifikasi siapa pun. Tidak ada pembangun sesi tanpa token.
 */

/**
 * Simpan sesi untuk sebuah akun, dan jadikan akun itu yang aktif.
 *
 * **Semua** sesi lain dibuang lebih dulu — bukan hanya yang perannya beda.
 *
 * Alasannya: di panel absensi, satu perangkat dipakai bergantian. Sisa-sesi di
 * `sessionStorage` adalah kredensial yang tidak perlu ada, dan selama masih
 * ada, ada kemungkinan sesi itu terbaca di muat halaman berikutnya.
 *
 * Aturan ini ditegakkan di dalam modul, jadi tidak bisa dilanggar pemanggil
 * mana pun.
 *
 * ⚠️ `token` wajib diisi. `saveSession()` tanpa token berarti menyimpan sesi
 * yang tidak bisa diverifikasi — yang persis bug yang sedang ditutup modul ini.
 * Parameter tokennya sengaja **wajib** supaya pemanggil lama tidak bisa lagi
 * kompilasi tanpa memperhatikannya.
 */
export function saveSession(
  user: UserAccountSafe,
  permissions: TabPermissions,
  token: string
): void {
  if (!isBrowser()) return;
  if (typeof token !== 'string' || !token.trim()) {
    // Lempar, bukan simpan: sesi tanpa token tidak berguna, dan diam-diam
    // menyimpan apa adanya berarti modul ini sekali lagi menerima sesi yang
    // tidak bisa dipercaya.
    throw new Error(
      'saveSession() butuh token server. Sesi tanpa token ditolak agar role tidak bisa ' +
        'dipercantumkan dari storage.'
    );
  }

  const session: StoredSession = {
    version: SESSION_VERSION,
    currentUser: user,
    tabPermissions: permissions,
    authTime: Date.now(),
    boundRole: user.role,
    token: token.trim(),
  };
  try {
    const kunci = sessionKey(user.username);
    for (const key of semuaKunciSesi()) {
      if (key !== kunci) sessionStorage.removeItem(key);
    }
    sessionStorage.setItem(kunci, JSON.stringify(session));
    setAkunAktif(user.username);
    invalidasiTokenCache();
  } catch (err) {
    console.warn('[sessionManager] Gagal menyimpan sesi:', err);
  }
}

/**
 * Token sesi yang sedang aktif, atau `''`.
 *
 * Dipakai `akunFirestore.ts` untuk menempelkan header `Authorization` —
 * modul itu tidak boleh jadi pemilik token kedua.
 *
 * ## Kenapa ada cache
 *
 * Setiap permintaan ke `/api/panel-auth` memanggil ini. Tanpa cache, tiap
 * request membayar `loadSession()` penuh: `sessionStorage.getItem` untuk
 * penunjuk, `getItem` lagi untuk sesi, `JSON.parse`, lalu
 * `sessionStorage.setItem` untuk menulis ulang penunjuk kalau penunjuk
 * belum ada. Semua itu sinkron di thread utama, diulang untuk setiap
 * request — dan halaman Langganan saja issuing belasan sekaligus.
 *
 * Yang disimpan hanya **string token**, dan hanya selama satu detik.
 * Satu detik dipilih supaya pengaruhnya mustahil menghasilkan header
 * `Authorization` basi: `saveSession()` dan `perbaruiTokenSesi()` — satu-
 *-satunya jalan token berubah — keduanya membatalkan cache di sini, jadi
 * token baru langsung terbaca pada request berikutnya.
 *
 * Aman untuk multi-tab: `sessionStorage` sudah terisolasi per
 * tab, jadi tab lain tidak pernah melihat perubahan ini.
 */
let tokenCache = '';
let tokenCachePada = 0;
const TOKEN_CACHE_MS = 1_000;

export function tokenAktif(): string {
  if (!isBrowser()) return '';
  if (tokenCache && Date.now() - tokenCachePada < TOKEN_CACHE_MS) return tokenCache;
  const sesi = loadSession();
  tokenCache = sesi?.token ?? '';
  tokenCachePada = Date.now();
  return tokenCache;
}

/** Buang cache token. Dipanggil setiap kali token benar-benar berubah. */
function invalidasiTokenCache(): void {
  tokenCache = '';
  tokenCachePada = 0;
}

/**
 * Ganti token tanpa mengubah akun.
 *
 * Dipanggil setelah server menerbitkan perpanjangan di `verifikasiSesiPanel()`.
 * `authTime` ikut disegarkan, jadi idle timeout menghitung dari verifikasi
 * terakhir — bukan dari login, yang bisa saja sudah 29 menit lalu.
 */
export function perbaruiTokenSesi(token: string): boolean {
  if (!isBrowser()) return false;
  const sesi = loadSession();
  if (!sesi) return false;
  const berikut: StoredSession = {
    ...sesi,
    token: token.trim(),
    authTime: Date.now(),
  };
  try {
    sessionStorage.setItem(sessionKey(sesi.currentUser.username), JSON.stringify(berikut));
    invalidasiTokenCache();
    return true;
  } catch {
    return false;
  }
}

/**
 * Muat sesi akun yang sedang aktif.
 *
 * Tidak pernah menebak: kalau lebih dari satu sesi valid ada dan penunjuknya
 * hilang, semuanya dibuang dan `null` dikembalikan — memaksa login ulang jauh
 * lebih baik daripada mendarat di akun yang salah.
 *
 * ⚠️ Sesi yang dikembalikan di sini **belum terverifikasi**. `role` di dalamnya
 * berasal dari storage dan hanya dipakai untuk menampilkan nama/bentuk selama
 * verifikasi berjalan. `AppContext` menggantinya dengan nilai dari server
 * sebelum merender apa pun yang bergantung pada izin.
 */
export function loadSession(): StoredSession | null {
  if (!isBrowser()) return null;

  // 1. Jalur biasa: penunjuk ada dan sesinya masih valid.
  const aktif = akunAktif();
  if (aktif) {
    const sesi = bacaSatu(sessionKey(aktif));
    if (sesi) return sesi;
    // Penunjuk menunjuk sesi yang sudah tidak berlaku — jangan cari yang
    // lain, karena itu berarti membaca akun yang berbeda.
    setAkunAktif('');
  }

  // 2. Tanpa penunjuk: kumpulkan sesi valid.
  const valid: StoredSession[] = [];
  for (const key of semuaKunciSesi()) {
    const sesi = bacaSatu(key);
    if (sesi) valid.push(sesi);
  }

  if (valid.length === 1) {
    // Tepat satu: tidak ada pilihan yang harus ditebak.
    setAkunAktif(valid[0].currentUser.username);
    return valid[0];
  }
  if (valid.length > 1) {
    // ⚠️ Ambigu. Membuang semuanya lebih aman daripada memilih satu.
    console.warn(
      `[sessionManager] ${valid.length} sesi aktif sekaligus tanpa penunjuk ` +
        `(admin=${valid.filter(s => s.boundRole === 'admin').map(s => s.currentUser.username)}, ` +
        `user=${valid.filter(s => s.boundRole === 'user').map(s => s.currentUser.username)}). ` +
        'Semua dibuang demi keamanan — please login ulang.'
    );
    clearAllSessions();
  }
  return null;
}

/** Perpanjang masa berlaku sesi (dipanggil saat ada aktivitas pengguna). */
export function touchSession(): void {
  if (!isBrowser()) return;
  const session = loadSession();
  if (!session) return;
  session.authTime = Date.now();
  try {
    sessionStorage.setItem(sessionKey(session.currentUser.username), JSON.stringify(session));
  } catch {
    // abaikan
  }
}

/**
 * Buang semua sesi dengan peran tertentu.
 *
 * Masih dipakai `LoginScreen` saat login manual, tapi tidak lagi jadi penjaga
 * aturan "satu perangkat satu akun" — `saveSession()` sudah menegakkannya.
 */
export function clearSessionByRole(role: UserRole): void {
  if (!isBrowser()) return;
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (!adalahKunciSesi(key)) continue;
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        const session = JSON.parse(raw) as StoredSession;
        if (session.boundRole === role) sessionStorage.removeItem(key);
      } catch {
        sessionStorage.removeItem(key);
      }
    }
    // Penunjuk tidak boleh menunjuk sesi yang baru saja dihapus.
    const aktif = akunAktif();
    if (aktif) {
      const sesi = bacaSatu(sessionKey(aktif));
      if (!sesi) setAkunAktif('');
    }
    // Sesi yang dihapus bisa saja yang sedang aktif — cache token wajib
    // ikut dibuang, kalau tidak request berikutnya masih memakai token
    // akun yang baru saja dikeluarkan.
    invalidasiTokenCache();
  } catch {
    // abaikan
  }
}

export function clearAllSessions(): void {
  if (!isBrowser()) return;
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key && key.startsWith(SESSION_KEY_PREFIX)) sessionStorage.removeItem(key);
    }
    // Penunjuk ikut dibuang — kalau tidak, `loadSession()` akan menemukan
    // penunjuk yang menunjuk sesi yang sudah tidak ada, dan jalur pemulihan
    // ia akan salah.
    sessionStorage.removeItem(ACTIVE_KEY);
    invalidasiTokenCache();
  } catch {
    // abaikan
  }
}
