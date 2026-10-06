/**
 * Aturan izin & bentuk data akun panel (berbeda dari akun NIP server pusat).
 *
 * ## Isi modul ini: **tidak ada satu pun akses jaringan**
 *
 * Hanya tipe, konstanta izin, normalisasi, dan validasi. Semua baca/tulis
 * dokumen pindah ke `akunFirestore.ts`.
 *
 * Pemisahan itu disengaja dan bukan soal kerapian. Modul ini diimpor secara
 * statis oleh `AppContext` dan `LoginScreen`, yang keduanya ada di jalur muat
 * awal. Selama modul ini ikut menarik `firebase/firestore` — 140 kB gzip,
 * 35% bundle — Vite menulis `modulepreload` untuknya di `index.html`, dan
 * setiap orang membayarnya sebelum sempat melihat layar login. Dengan batas
 * "modul ini tidak menyentuh jaringan", hal itu bisa dicek otomatis.
 *
 * Perilaku dan nama ekspornya tidak berubah dari sebelumnya; hanya tempatnya.
 *
 * Koleksi yang dipakai modul pasangannya:
 *
 *   jatim_pengguna/{username}
 *   jatim_pengaturan/kredensial_server__{username}   NIP + password + IMEI
 */

export type UserRole = 'admin' | 'user';

// ═══════════════════════════════════════════════════════════════════════
//  Izin akses per halaman
// ═══════════════════════════════════════════════════════════════════════

export interface TabPermissions {
  tabBeranda: boolean;
  tabPresensi: boolean;
  tabPerizinan: boolean;
  tabRiwayatIzin: boolean;
  tabLokasiAbsen: boolean;
  tabLaporan: boolean;
  tabDocs: boolean;
  /** Menu WEB — e-Presensi BKD Jatim (IMEI, Kehadiran, Detail Pegawai, Perizinan). */
  tabWeb: boolean;

  // Aksi sensitif
  aksiAbsen: boolean;
  aksiAjukanIzin: boolean;
  aksiSyncData: boolean;
  aksiKelolaUser: boolean;
  tabDeveloper: boolean;
  /**
   * Menu **Manajemen Akun** (kelola akun + langganan).
   *
   * ⚠️ Izin ini **tidak** berlaku untuk admin: menu ini hanya untuk admin,
   * dan pemeriksaan di `App.tsx` memakai `userRole === 'admin'`, bukan nilai
   * izin ini. Field-nya ada supaya `normalizeUserPermissions` tidak
   * men-drop kunci baru — kalau tidak, setiap akun non-admin yang
   * disimpan sebelum menu ini ada akan gagal serialisasi.
   *
   * ## Kenapa dinamai ulang dari `tabLangganan`
   *
   * Menu ini dulu hanya mengatur langganan. Sekarang memuat dua tab dengan
   * dua URL, dan nama lamanya jadi salah_desc — klikannya bukan "langganan"
   * tapi "akun dan langganan". Nilai `true` dari dokumen lama dipindahkan di
   * `normalizeUserPermissions`, jadi tidak ada akun yang kehilangan akses
   * karena perubahan nama field.
   */
  tabManajemenAkun: boolean;

  /**
   * Sesi **server pusat**: login otomatis dan keluar dari server.
   *
   * ⚠️ Satu izin untuk dua hal, bukan dua izin terpisah.
   *
   * Auto-login adalah hal yang *dibutuhkan* — tanpa itu aplikasi tidak punya
   * `api_key` dan tidak bisa melakukan apa pun. Yang mungkin tidak diinginkan
   * justru **memutus** sesi itu, misalnya saat satu akun dipakai bersama di
   * satu perangkat.
   *
   * Dua izin terpisah akan menghasilkan keadaan "bisa masuk tapi tidak bisa
   * keluar" — dan itu justru mengunci orang di dalam sesi yang bukan
   * miliknya.
   *
   * Jadi: `false` berarti **tidak boleh memutus sesi server**. Auto-login
   * tetap berjalan, dan item "Keluar dari Server" tidak muncul sama sekali di
   * kartu akun.
   *
   * Default `true` untuk semua peran, supaya perilakunya sama seperti sekarang
   * sampai admin benar-benar mematikan izinnya.
   */
  aksiSesiServer: boolean;
}

export const TAB_PERMISSION_LABELS: Record<keyof TabPermissions, string> = {
  tabBeranda: 'Beranda',
  tabPresensi: 'Presensi',
  tabPerizinan: 'Pengajuan Izin',
  tabRiwayatIzin: 'Riwayat Izin',
  tabLaporan: 'Laporan',
  tabLokasiAbsen: 'Lokasi Absen',
  tabDocs: 'Dokumentasi',
  tabWeb: 'WEB (e-Presensi BKD Jatim)',
  aksiAbsen: 'Lakukan Absen',
  aksiAjukanIzin: 'Ajukan Izin',
  aksiSyncData: 'Sync Data',
  aksiKelolaUser: 'Kelola Pengguna',
  tabDeveloper: 'Mode Pengembang',
  tabManajemenAkun: 'Menu Manajemen Akun (khusus admin)',
  aksiSesiServer: 'Keluar dari Server Pusat',
};

export const PERMISSION_GROUPS: { label: string; keys: (keyof TabPermissions)[] }[] = [
  {
    label: 'Halaman',
    keys: [
      'tabBeranda',
      'tabPresensi',
      'tabPerizinan',
      'tabRiwayatIzin',
      'tabLaporan',
      'tabLokasiAbsen',
      'tabDocs',
      'tabWeb',
    ],
  },
  {
    label: 'Aksi',
    keys: ['aksiAbsen', 'aksiAjukanIzin', 'aksiSyncData', 'aksiKelolaUser', 'aksiSesiServer'],
  },
  {
    label: 'Pengaturan',
    keys: ['tabDeveloper'],
  },
];

/**
 * Izin yang hanya relevan untuk admin.
 *
 * Dipakai `normalizeUserPermissions` untuk memaksa nilainya `false` pada
 * semua akun non-admin — bukan sekadar default. Kalau andalkan default saja,
 * izin yang pernah `true` pada dokumen lama akan tetap `true` dan
 * user non-admin bisa melihat menu yang harusnya tertutup.
 */
export const PERMISSION_KHUSUS_ADMIN: (keyof TabPermissions)[] = ['tabManajemenAkun'];

export const DEFAULT_ADMIN_PERMISSIONS: TabPermissions = {
  tabBeranda: true,
  tabPresensi: true,
  tabPerizinan: true,
  tabRiwayatIzin: true,
  tabLaporan: true,
  tabLokasiAbsen: true,
  tabDocs: true,
  tabWeb: true,
  aksiAbsen: true,
  aksiAjukanIzin: true,
  aksiSyncData: true,
  aksiKelolaUser: true,
  tabDeveloper: true,
  tabManajemenAkun: true,
  aksiSesiServer: true,
};

/** Default untuk user biasa: boleh presensi & izin sendiri, tanpa admin. */
export const DEFAULT_USER_PERMISSIONS: TabPermissions = {
  tabBeranda: true,
  tabPresensi: true,
  tabPerizinan: true,
  tabRiwayatIzin: true,
  tabLokasiAbsen: true,
  tabLaporan: false,
  tabDocs: false,
  tabWeb: true,
  aksiAbsen: true,
  aksiAjukanIzin: true,
  aksiSyncData: true,
  aksiKelolaUser: false,
  tabDeveloper: false,
  tabManajemenAkun: false,
  aksiSesiServer: true,
};

/** ⚠️ Security: saat belum login, TIDAK ADA hak akses sama sekali. */
export const UNAUTHENTICATED_PERMISSIONS: TabPermissions = Object.fromEntries(
  Object.keys(DEFAULT_ADMIN_PERMISSIONS).map(key => [key, false])
) as unknown as TabPermissions;

export function normalizeUserPermissions(raw: Record<string, unknown> | undefined | null): TabPermissions {
  const base = { ...DEFAULT_USER_PERMISSIONS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(base) as (keyof TabPermissions)[]) {
      if (key in raw) base[key] = Boolean((raw as Record<string, unknown>)[key]);
    }
    /*
     * Migrasi `tabLangganan` → `tabManajemenAkun`.
     *
     * Hanya dibaca, tidak pernah ditulis ulang. Menulis ulang berarti
     * `setDoc` dari klien untuk setiap akun di koleksi — padahal
     * `normalizeUserPermissions` juga dipanggil saat login, jadi setiap login
     * akan menulis ke Firestore. Membaca saja membuat pengalihan instan
     * tanpa satu pun tulisan.
     */
    if (!('tabManajemenAkun' in raw) && 'tabLangganan' in raw) {
      base.tabManajemenAkun = Boolean(raw.tabLangganan);
    }
  }
  // Izin khusus admin dipaksa mati di sini. `role` belum diketahui pada
  // titik ini, jadi pemanggil yang menyelesaikan lewat `batasiIzin`.
  for (const key of PERMISSION_KHUSUS_ADMIN) base[key] = false;
  return base;
}

/**
 * Paksa izin khusus admin menjadi `false`.
 *
 * Dipanggil setelah `role` diketahui. Dipisah dari `normalizeUserPermissions`
 * karena normalisasi tidak menerima role — dan menerima role di sana akan
 * berarti setiap pemanggil harus ingat memanggilinya.
 */
export function batasiIzin(permissions: TabPermissions, role: UserRole): TabPermissions {
  if (role === 'admin') return permissions;
  const hasil = { ...permissions };
  for (const key of PERMISSION_KHUSUS_ADMIN) hasil[key] = false;
  return hasil;
}

// ═══════════════════════════════════════════════════════════════════════
//  Tipe akun
// ═══════════════════════════════════════════════════════════════════════

export interface UserAccount {
  /** Id dokumen Firestore — sama dengan `username` setelah disanitasi. */
  id?: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  permissions: TabPermissions;
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string;
  /** NIP terakhir yang dipakai untuk login server pusat (cache lokal saja). */
  lastNip?: string;
  /**
   * Nama lengkap pegawai.
   *
   * ⚠️ Wajib ada karena `username` sering berupa NIP atau singkatan, dan
   * pesan konfirmasi WhatsApp jadi tidak bisa dibaca admin tanpa nama.
   * Opsional di level data (akun lama tidak memilikinya) tapi wajib diisi
   * di form pembuatan akun baru.
   */
  namaLengkap?: string;
  /**
   * NIP untuk login server pusat.
   *
   * ⚠️ Ini hanya **referensi** untuk admin. Yang benar-benar dikirim ke
   * server adalah NIP di `kredensial_server__{username}` (lihat
   * `saveServerCredential`). Keduanya bisa berbeda kalau admin mengisi form
   * kredensial dan form akun secara tidak sinkron — dan yang menang adalah
   * yang kedua, karena itu yang dipakai auto-login.
   */
  nip?: string;
  /** Catatan bebas untuk admin. */
  catatan?: string;
  /** Nonaktifkan akun tanpa menghapusnya (riwayat langganan tetap ada). */
  nonaktif?: boolean;
}

/** Bentuk aman untuk disimpan di sessionStorage — tanpa hash. */
export type UserAccountSafe = Omit<UserAccount, 'passwordHash'>;

// ═══════════════════════════════════════════════════════════════════════
//  Validasi
// ═══════════════════════════════════════════════════════════════════════

export function sanitizeString(value: unknown, maxLength = 100): string {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validasi username.
 *
 * Diekspor untuk `akunFirestore.ts`, yang memanggilnya sebelum menulis
 * dokumen — supaya aturan ini hanya ada di satu tempat.
 */
export function validateUsername(username: string): string | null {
  const value = username.trim();
  if (!value) return 'Username wajib diisi.';
  if (value.length < 3) return 'Username minimal 3 karakter.';
  if (value.length > 32) return 'Username maksimal 32 karakter.';
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    return 'Username hanya boleh huruf, angka, titik, underscore, dan strip.';
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Password wajib diisi.';
  if (password.length < 6) return 'Password minimal 6 karakter.';
  if (password.length > 128) return 'Password terlalu panjang.';
  return null;
}

