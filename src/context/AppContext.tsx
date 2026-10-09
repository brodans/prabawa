import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { getTodayWIB } from '../lib/dateFormatter';
import type { UserRole, TabPermissions, UserAccountSafe } from '../lib/userManager';
import {
  batasiIzin,
  DEFAULT_ADMIN_PERMISSIONS,
  normalizeUserPermissions,
  UNAUTHENTICATED_PERMISSIONS,
} from '../lib/userManager';
import { clearServerSessionCache } from '../lib/cacheManager';
import type { IjinView } from '../lib/viewModels';
import type {
  HasilImei,
  HasilKehadiran,
  DetailPegawai,
  HasilPerizinan,
  BarisIjin,
} from '../lib/webPresensi';
import {
  loadSession,
  saveSession,
  clearAllSessions,
  perbaruiTokenSesi,
} from '../lib/sessionManager';
import { resetAutoLogin } from '../lib/serverAutoLogin';
import { bacaStorage, tulisStorage } from '../lib/storageAman';
import { verifikasiSesiPanel } from '../lib/akunFirestore';
import { migrasiTitikUsernameLokal } from '../lib/lokasiTersimpan';

// ═══════════════════════════════════════════════════════════════════════
//  Profil pegawai hasil login ke server pusat
// ═══════════════════════════════════════════════════════════════════════

export interface PegawaiProfile {
  id?: string;
  apiKey?: string;
  nip?: string;
  nama?: string;
  nib?: string;
  jabatan?: string;
  instansi?: string;
  kodeInstansi?: string;
  departemen?: string;
  departmentId?: string;
  group?: string;
  groupId?: string;
  idLokasi?: string;
  kodeUnor?: string;
  namaLokasi?: string;
  profilePic?: string;
  usingWajah?: number;
  labelWfh?: string;
  /** 1 = server mewajibkan pencocokan wajah saat absen (login.upload_wajah). */
  usingWajahDariServer?: number;
  /** 1 = akun boleh absen Work-From-Home (login.allow_wfh). */
  allowWfh?: number;
  /** Vektor wajah sudah disetujui atasan (login.vektor_approved). */
  vektorApproved?: number;
  /**
   * Masa berlaku konfirmasi absensi dalam milidetik (login.absen_timeout).
   *
   * Dipakai halaman Presensi untuk menampilkan hitung mundur setelah
   * `cekabsen` membalas peringatan — perilaku yang sama dengan
   * `PendingAttendanceResult` di aplikasi Android.
   */
  absenTimeout?: number;
  /** 1 = akun mewajibkan verifikasi wajah (login.using_wajah). */
  usingWajahServer?: number;
  /** URL logo departemen (login.logo_departemen). */
  logoDepartemen?: string;
  /**
   * IMEI / androidId yang dipakai untuk sesi ini. Terisi bila pengguna
   * mengisinya di form login karena akunnya terkunci ke perangkat tertentu.
   */
  imei?: string;
  /**
   * Flag modul dari `login`: beranda, presensi, perizinan, laporan.
   * Server menguroniumnya per pegawai; 0 berarti modul tidak boleh dibuka.
   */
  modul?: { home: number; presensi: number; perizinan: number; laporan: number };
  workCode?: string;
  message?: string;
  [key: string]: unknown;
}

/** Form login ke server pusat. */
export interface LoginFormState {
  username: string;
  password: string;
  /**
   * IMEI / androidId perangkat yang terdaftar pada akun ini.
   *
   * ⚠️ Wajib diisi HANYA untuk akun yang masih terkunci ke perangkat
   * tertentu — server menjawab 402 untuk nilai apa pun bila akun sudah
   * terdaftar di perangkat lain. Akun yang binding-nya sudah dilepas
   * (mis. NIP 200308062025101001) menerima nilai apa saja.
   *
   * Dikosongkan berarti proxy memakai TechMark proses, sama seperti
   * perilaku sebelum kolom ini ada.
   */
  imei: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  State halaman yang perlu bertahan saat pindah tab
// ═══════════════════════════════════════════════════════════════════════

export interface LaporanLogState {
  dateStart: string;
  dateEnd: string;
  reportType: string;
  /**
   * Penanda bahwa rentang ini sudah pernah dimuat.
   *
   * ⚠️ Hanya field yang benar-benar memengaruhi query yang boleh
   *zynyalakannya kembali (lihat `patch()` di `pages/Laporan.tsx`).
   * `reportType` tidak: kedua jenis laporan memakai RPC yang sama, jadi
   * menyalakannya hanya menembakkan ulang request yang hasilnya identik.
   *
   * Field `format` ('pdf' | 'xls') pernah ada di sini dan sudah dihapus.
   * Nilainya tidak pernah dibaca apa pun — tombol "Cetak" selalu mencetak dan
   * "Ekspor" selalu mengunduh CSV — tapi dropdownnya masih menulis
   * `hasLoadedOnce: false`, sehingga satu pilihan memicu muatan ulang
   * 1 + jumlah hari request tanpa mengubah apa pun di layar.
   */
  hasLoadedOnce: boolean;
}

export interface RiwayatIzinState {
  dateStart: string;
  dateEnd: string;
  rows: IjinView[];
  hasLoadedOnce: boolean;
}

export type WebPresensiTab = 'imei' | 'kehadiran' | 'detail' | 'perizinan';

export interface WebPresensiState {
  sudahLogin: boolean;
  pemilikSesi: string | null;
  hasilImei: HasilImei | null;
  tab: WebPresensiTab;
  kehadiran: HasilKehadiran | null;
  detail: DetailPegawai | null;
  ijinAjax: BarisIjin[] | null;
  perizinan: HasilPerizinan | null;
  semuaPerizinan: BarisIjin[] | null;
  /** Flags apakah tiap tab sudah pernah di-load. */
  dimuat: { kehadiran: boolean; detail: boolean; perizinan: boolean };
}

const EMPTY_CONFIG = {
  deviceId: '',
  latitude: '',
  longitude: '',
  idLokasi: '',
  kodeInstansi: '',
  kodeUnor: '',
  workMode: '1',
  /** IMEI yang dipakai untuk sesi server pusat aktif. */
  imei: '',
  /** Koordinat terakhir yang dikirim, dalam bentuk `"lat,long"`. */
  lastLatLong: '',
};

// ═══════════════════════════════════════════════════════════════════════
//  Context
// ═══════════════════════════════════════════════════════════════════════

interface AppContextType {
  // Sesi server pusat
  pegawai: PegawaiProfile | null;
  setPegawai: React.Dispatch<React.SetStateAction<PegawaiProfile | null>>;
  serverConnected: boolean;
  setServerConnected: (value: boolean) => void;
  /**
   * Alasan server pusat gagal terhubung otomatis.
   *
   * Auto-login berjalan sendiri setiap kali aplikasi dibuka (lihat
   * `lib/serverAutoLogin.ts`), jadi kegagalannya harus terlihat tanpa
   * pengguna mencari-cari. `null` berarti sedang mencoba atau berhasil.
   */
  serverLoginError: string | null;
  setServerLoginError: (value: string | null) => void;
  /** true = pengguna menekan "Keluar dari Server", auto-login dimatikan. */
  serverLogoutRequested: boolean;
  setServerLogoutRequested: (value: boolean) => void;
  loginForm: LoginFormState;
  setLoginForm: React.Dispatch<React.SetStateAction<LoginFormState>>;

  config: typeof EMPTY_CONFIG;
  setConfig: React.Dispatch<React.SetStateAction<typeof EMPTY_CONFIG>>;

  // Halaman
  activePage: string;
  setActivePage: (page: string) => void;
  /** Pindah ke tab/URL tertentu tanpa memuat ulang halaman. */
  setSubPath: (path: string) => void;
  /** Pathname saat ini; dipakai untuk menentukan tab dari URL. */
  pathname: string;
  laporanLogState: LaporanLogState;
  setLaporanLogState: React.Dispatch<React.SetStateAction<LaporanLogState>>;
  riwayatIzinState: RiwayatIzinState;
  setRiwayatIzinState: React.Dispatch<React.SetStateAction<RiwayatIzinState>>;
  webPresensiState: WebPresensiState;
  setWebPresensiState: React.Dispatch<React.SetStateAction<WebPresensiState>>;

  // Mode pengembang — mengaktifkan panel trafik JSON-RPC.
  developerMode: boolean;
  setDeveloperMode: (value: boolean) => void;

  /** Gaya kalender di seluruh halaman: kartu modern atau klasik ringkas. */

  // Akun panel
  currentUser: UserAccountSafe | null;
  /**
   * Tetapkan akun yang sedang masuk.
   *
   * `token` wajib diisi — lihat catatan panjang di implementasinya. Melewatkannya
   * berarti menyimpan `role` tanpa bukti, dan modul sesi akan menolaknya.
   */
  setCurrentUser: (user: UserAccountSafe | null, token?: string) => void;
  userRole: UserRole;
  /**
   * Izin tab & aksi — **hasil verifikasi server**, bukan input peramban.
   *
   * ⚠️ Tidak ada lagi `setTabPermissions()` di context ini. Semula ada, dan
   * pemanggilnya bisa menulis izin apa saja dari peramban; sekarang izin hanya
   * bisa berasal dari dua tempat:
   *
   * 1. `verifikasiSesiPanel()` — server membaca dokumen dan mengirimkannya.
   * 2. `setCurrentUser()` — dari akun yang sama, hasil login server.
   *
   * Menghapus setter-nya bukan sekadar merapikan: selama setter ada, ada jalur
   * yang membuat izin di layar berbeda dari yang server tahu. Menutupnya berarti
   * tidak ada kode yang bisa melakukan itu.
   *
   * Mengubah izin memang harus lewat `updateUserAccount()` (server), dan
   * perubahan itu berlaku di muat berikutnya — bukan seketika, karena server
   * yang harus memberikannya.
   */
  tabPermissions: TabPermissions;
  /**
   * True selama token sesi belum diverifikasi server.
   *
   * Selama ini nilai `true`, **tidak ada** hak akses sama sekali — termasuk
   * di sidebar. `App.tsx` juga menunda render aplikasi. Inilah yang membuat
   * "refresh" tidak pernah menjadi jalan masuk dengan hak lama.
   */
  cekingSesi: boolean;
  /** Penanda sesi tersimpan saat load, hanya untuk menampilkan placeholder inert. */
  adaSesiSaatMuat: boolean;
  /*
   * ⚠️ `autoLoginTrigger` **dihapus**.
   *
   * Semula auto-login server bergantung pada nilai ini, sehingga hanya jalan
   * setelah login panel BARU dan tidak pernah jalan lagi setelah refresh
   * (`useState` kembali ke 0). Sekarang auto-login bergantung pada
   * `currentUser.username` dan berjalan setiap kali aplikasi dibuka — lihat
   * `lib/serverAutoLogin.ts`.
   *
   * Setelah dependensi itu dipindah, tidak ada satu pun pembacaannya. Yang
   * tersisa hanyalah `setAutoLoginTrigger(prev => prev + 1)` di
   * `setCurrentUser()`, yaitu render tambahan yang tidak mengubah apa pun
   * — dan satu dependensi `useMemo` lebih banyak di nilai context, yang
   * membuat **seluruh** pemanggil `useAppContext()` merender ulang setiap
   * kali seseorang login.
   */
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Routing berbasis pathname (tanpa react-router).
const PATH_MAP: Record<string, string> = {
  tabBeranda: '/beranda',
  tabPresensi: '/presensi',
  tabPerizinan: '/perizinan',
  tabRiwayatIzin: '/riwayat-izin',
  tabLaporan: '/laporan',
  tabDocs: '/docs',
  tabLokasiAbsen: '/lokasi-absen',
  tabManajemenAkun: '/manajemen-akun',
  tabWeb: '/web',
};

const FALLBACK_PAGE = 'tabBeranda';

/**
 * URL lama → URL baru.
 *
 * URL langganan lama diarahkan ke satu halaman Manajemen Akun terpadu.
 */
export const PATH_LAMA: Record<string, string> = {
  '/langganan': PATH_MAP.tabManajemenAkun,
  '/langganan/akun': PATH_MAP.tabManajemenAkun,
  '/langganan/pembayaran': PATH_MAP.tabManajemenAkun,
  '/langganan/metode': PATH_MAP.tabManajemenAkun,
  '/manajemen-akun/langganan': PATH_MAP.tabManajemenAkun,
};

/**
 * `pathname` → id halaman.
 *
 * Dua tahap, dan urutan itu penting:
 *
 * 1. **Cocok persis** dulu.
 * 2. URL lama dialihkan sebelum pemetaan.
 * 3. **Cocok awalan terpanjang** untuk subhalaman yang memakai path.
 *
 * Awalan harus diurutkan dari yang **terpanjang**. Kalau diurutkan seperti
 * `Object.keys`, awalan yang lebih pendek akan menang lebih dulu dan setiap
 * sub-path salah buka halaman.
 */
const AWALAN_PATH = Object.entries(PATH_MAP)
  .map(([id, path]) => ({ id, path }))
  .sort((a, b) => b.path.length - a.path.length);

export const getPageFromPath = (path: string): string => {
  // Normalisasi: buang slash di akhir supaya `/presensi/` tetap dikenali.
  const bersih = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const tujuanLama = PATH_LAMA[bersih];
  if (tujuanLama) return getPageFromPath(tujuanLama);
  for (const [tabId, tabPath] of Object.entries(PATH_MAP)) {
    if (bersih === tabPath) return tabId;
  }
  for (const { id, path: prefix } of AWALAN_PATH) {
    if (bersih.startsWith(`${prefix}/`)) return id;
  }
  return FALLBACK_PAGE;
};

export function AppProvider({ children }: { children: ReactNode }) {
  // ── Restore sesi panel: storage → server ──────────────────────────
  /*
   * Sesi TIDAK lagi dipercaya begitu saja dari `sessionStorage`.
   *
   * Yang ada di sana adalah token bertanda tangan. Modul ini selalu
   * memverifikasinya ke `POST /api/panel-auth` sebelum mempercayai apa pun,
   * dan memakai `role`/`permissions` yang **dikembalikan server** — yang
   * dibaca ulang dari dokumen Firestore, bukan dari storage.
   *
   * Akibatnya:
   *
   * - `setDoc({ role: 'admin' })` pada `sessionStorage` tidak berarti apa-apa;
   *   `App.tsx` juga menolak render aplikasi kalau `siapSesi` masih `false`.
   * - Admin yang diturunkan di Firestore langsung kehilangan haknya di muat
   *   berikutnya — tanpa perlu logout.
   * - Akun yang dinonaktifkan ditolak seketika.
   *
   * `cekingSesi` sengajadipisahkan dari `isAuthenticated` milik `App.tsx`: yang ini
   * milik provider dan tidak perlu tahu apa pun soal render.
   */
  const [sesiTersimpan] = useState(() => loadSession());
  const adaSesiSaatMuat = sesiTersimpan !== null;

  /*
   * Selama verifikasi berjalan, **tidak ada hak akses sama sekali**.
   *
   * Ini yang membuat "refresh" tidak pernah menjadi jalan masuk. Kalau state
   * awal memakai `currentUser` dari storage, ada satu frame — atau satu
   * redirect — di mana aplikasi sudah berjalan dengan hak yang belum
   * diverifikasi. `UNAUTHENTICATED_PERMISSIONS` menutup celang itu: selama
   * `cekingSesi === true`, sidebar dan seluruh halaman mati.
   */
  const [currentUser, setCurrentUserState] = useState<UserAccountSafe | null>(null);
  const currentUserRef = React.useRef<UserAccountSafe | null>(null);

  // ⚠️ SECURITY: saat belum diverifikasi / belum login WAJIB tanpa hak akses.
  const [tabPermissions, setTabPermissionsState] =
    useState<TabPermissions>(UNAUTHENTICATED_PERMISSIONS);

  /** True selama token belum diverifikasi server. */
  const [cekingSesi, setCekingSesi] = useState(() => sesiTersimpan !== null);

  // ⚠️ SECURITY: role selalu 'user' bila currentUser null.
  const userRole: UserRole = currentUser?.role ?? 'user';

  React.useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  /*
   * Verifikasi sesi yang tersimpan — satu kali, saat mount.
   *
    * Effect-nya sengaja tidak memakai penjaga `sudahDiproses` supaya aman
    * terhadap double-mount `StrictMode`:
   * dua verifikasi untuk token yang sama tidak merusak apa pun, dan keduanya
   * menghasilkan state yang sama.
   */
  React.useEffect(() => {
    if (!sesiTersimpan) {
      setCekingSesi(false);
      return;
    }

    let hidup = true;
    void (async () => {
      try {
        const hasil = await verifikasiSesiPanel(sesiTersimpan.token);
        if (!hidup) return;

        // Peran & izin datang dari server, bukan dari storage.
        const izinServer = batasiIzin(hasil.akun.permissions, hasil.akun.role);
        migrasiTitikUsernameLokal(hasil.akun.username, hasil.akun.usernameSebelumnya ?? []);
        setCurrentUserState(hasil.akun);
        setTabPermissionsState(izinServer);
        // Perpanjangan token disimpan tanpa mengganti akun.
        if (hasil.tokenBaru) perbaruiTokenSesi(hasil.tokenBaru);
      } catch {
        /*
         * Token ditolak server — karena kedaluwarsa, karena sudah dicabut, atau
         * karena akun dinonaktifkan. Satu-satunya respons yang aman adalah
         * membuang sesi:membiarkannya di storage hanya akan dicoba lagi pada muat
         * berikutnya, dan `role` di dalamnya tidak boleh dipercaya.
         */
        if (!hidup) return;
        clearAllSessions();
        setCurrentUserState(null);
        setTabPermissionsState(UNAUTHENTICATED_PERMISSIONS);
      } finally {
        if (hidup) setCekingSesi(false);
      }
    })();

    return () => {
      hidup = false;
    };
  }, [sesiTersimpan]);

  // ── State server pusat ───────────────────────────────────────────
  const [pegawai, setPegawai] = useState<PegawaiProfile | null>(null);
  const [serverConnected, setServerConnected] = useState(false);
  const [serverLoginError, setServerLoginError] = useState<string | null>(null);
  const [serverLogoutRequested, setServerLogoutRequested] = useState(false);
  const [loginForm, setLoginForm] = useState<LoginFormState>({ username: '', password: '', imei: '' });
  const [config, setConfig] = useState(EMPTY_CONFIG);

  /**
   * Masuk sebagai `user`, dengan `token` dari server.
   *
   * ⚠️ `token` **wajib**. Sesi tanpa token tidak dapat diverifikasi siapa pun,
   * jadi menyimpannya berarti menyimpan `role` yang tidak punya bukti — persis
   * bug yang ditutup modul ini. Parameternya sengaja tidak opsional supaya
   * pemanggil lama tidak bisa lagi kompilasi tanpa menyadarinya.
   *
   * Izin dihitung ulang di sini juga, bukan memakai apa yang dikirim server
   * apa adanya: `batasiIzin` memastikan izin khusus admin mati untuk
   * non-admin apa pun isi dokumennya.
   */
  const setCurrentUser = React.useCallback((user: UserAccountSafe | null, token?: string) => {
    if (!user) {
      // Logout — bersihkan seluruh data.
      clearAllSessions();
      setPegawai(null);
      setServerConnected(false);
      setServerLoginError(null);
      setServerLogoutRequested(false);
      setLoginForm({ username: '', password: '', imei: '' });
      setConfig(EMPTY_CONFIG);
      setCurrentUserState(null);
      setTabPermissionsState(UNAUTHENTICATED_PERMISSIONS);
      setWebPresensiState({
        sudahLogin: false,
        pemilikSesi: null,
        hasilImei: null,
        tab: 'imei',
        kehadiran: null,
        detail: null,
        ijinAjax: null,
        perizinan: null,
        semuaPerizinan: null,
        dimuat: { kehadiran: false, detail: false, perizinan: false },
      });
      // Status auto-login ikut dibuang. Kalau tidak, entri "sedang berjalan"
      // dan "berhasil" masih milik akun yang baru saja keluar — dan login
      // berikutnya dengan akun sama akan menerima promise lama, bukan
      // percobaan baru.
      resetAutoLogin();
      return;
    }

    // Ganti akun: buang cache akun sebelumnya dan status auto-login-nya.
    const prevUsername = currentUserRef.current?.username ?? '';
    if (prevUsername && prevUsername !== user.username) {
      clearServerSessionCache(prevUsername);
      resetAutoLogin();
    }

    setPegawai(null);
    setServerConnected(false);
    setServerLoginError(null);
    setLoginForm({ username: '', password: '', imei: '' });
    setConfig(EMPTY_CONFIG);

    // Izin khusus admin (menu Langganan) selalu dipaksa mati untuk
    // non-admin, apa pun isi dokumennya.
    const permissions: TabPermissions = batasiIzin(
      user.role === 'admin'
        ? { ...DEFAULT_ADMIN_PERMISSIONS }
        : normalizeUserPermissions(user.permissions as unknown as Record<string, unknown>),
      user.role
    );

    if (!token || !token.trim()) {
      // Bukan melempar: pemanggil yang salah harus melihat sesi tetap kosong
      // dan pesan di log, bukan aplikasi yang crash saat login. Yang penting,
      // **tidak ada** state hak akses yang terpasang.
      console.error('[AppContext] setCurrentUser tanpa token — sesi ditolak.');
      setCurrentUserState(null);
      setTabPermissionsState(UNAUTHENTICATED_PERMISSIONS);
      clearAllSessions();
      return;
    }

    migrasiTitikUsernameLokal(user.username, user.usernameSebelumnya ?? []);
    setCurrentUserState(user);
    setTabPermissionsState(permissions);
    saveSession(user, permissions, token);
    // Auto-login server pusat dipicu oleh `currentUser.username` yang
    // berubah di atas — lihat `MainApp` di `App.tsx`. Tidak ada pemicu
    // tambahan yang perlu dinaikkan di sini.
  }, []);

  // ── Routing ───────────────────────────────────────────────────────
  const [activePage, setActivePageState] = useState<string>(() => {
    if (typeof window === 'undefined') return FALLBACK_PAGE;
    return getPageFromPath(window.location.pathname);
  });

  /*
   * `pathname` disimpan di state, bukan dibaca dari `window.location` saat
   * render.
   *
   * Menilai `window.location.pathname` langsung di render membuat render
   * pertama dan render berikutnya bisa melihat URL yang berbeda tanpa
   * penyebab yang bisa dilacak — dan komponen yang menentukan tab dari
   * URL akan tampak "berganti sendiri". Dengan state, setiap perubahan
   * pathname pasti melewati satu event yang sama.
   */
  const [pathname, setPathname] = useState<string>(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname
  );

  /*
   * `useCallback` wajib, bukan gaya.
   *
   * Nilai context di bawah sudah `useMemo`, jadi ia **hanya** berubah ketika
   * salah satu dependensinya berubah. Kalau `setActivePage` bukan callback
   * yang stabil,ia ikut jadi dependensi — lalu setiap render provider
   * membuat objek context baru, dan **seluruh** 13 pemanggil
   * `useAppContext()` merender ulang.
   *
   * Yang paling paradoxical: `MainApp` memanggil `setActivePage` dari dalam
   * `useEffect` yang dependensinya berisi `setActivePage` sendiri. Tanpa
   * callback, effect itu berjalan pada setiap render — jadi kestabilannya
   * bukan hanya soal performa, tapi urutan render yang benar.
   */
  const setActivePage = useCallback((pageId: string) => {
    setActivePageState(pageId);
    if (typeof window !== 'undefined') {
      const targetPath = PATH_MAP[pageId] || PATH_MAP[FALLBACK_PAGE];
      if (window.location.pathname !== targetPath) {
        window.history.pushState(null, '', targetPath);
        setPathname(targetPath);
      }
    }
  }, []);

  /**
   * Pindah ke **tab** dari halaman yang sedang terbuka, tanpa memuat ulang.
   *
   * `setActivePage()` tidak bisa dipakai di sini: ia memindahkan pathname ke
   * path *halaman* (mis. `/manajemen-akun`), yang menghapus sub-path tab. Jadi
   * menekan tab "Langganan" akan menutup halaman, bukan hanya berganti tab.
   */
  const setSubPath = useCallback((path: string) => {
    if (typeof window === 'undefined') return;
    const target = PATH_LAMA[path] ?? path;
    if (window.location.pathname !== target) {
      window.history.pushState(null, '', target);
    }
    setPathname(target);
    setActivePageState(getPageFromPath(target));
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleLocationChange = () => {
      setPathname(window.location.pathname);
      setActivePageState(getPageFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  /*
   * Pengalihan URL lama.
   *
   * `replaceState`, bukan `pushState`: tidak ada yang berguna di riwayat
   * peramban — dan kalau Back dipakai, pengguna akan melewati pengalihan ini
   * lalu mendarat di halaman yang sama, yang terasa seperti macet.
   */
  React.useEffect(() => {
    const path = window.location.pathname;
    const tujuan = PATH_LAMA[path];
    if (!tujuan) return;
    window.history.replaceState(null, '', tujuan);
    setPathname(tujuan);
    setActivePageState(getPageFromPath(tujuan));
  }, []);

  // ── Preferensi ────────────────────────────────────────────────────
  /*
   * Ketiga initializer di bawah memakai `bacaStorage`/`tulisStorage`, bukan
   * `localStorage` langsung.
   *
   * Semuanya berjalan pada fase render, di dalam provider yang membungkus
   * seluruh aplikasi. `localStorage.getItem` yang melempar di sini — Safari
   * mode privat, atau penyimpanan yang diblokir kebijakan situs — membuat
   * `AppContext` gagal mounting, dan karena provider-nya di paling atas,
   * tidak ada satu pun layar yang muncul. Bukan "preferensi tidak
   * tersimpan", tapi aplikasi tidak bisa dibuka sama sekali.
   *
   * Nilai yang tidak terbaca diperlakukan sebagai "belum pernah dipilih",
   * yang mengembalikan perilaku bawaan.
   */
  const [developerMode, setDeveloperModeState] = useState<boolean>(
    () => bacaStorage('jatim_developer_mode') === 'true'
  );

  const setDeveloperMode = useCallback((value: boolean) => {
    setDeveloperModeState(value);
    tulisStorage('jatim_developer_mode', value ? 'true' : 'false');
  }, []);

  // ── State halaman yang bertahan ───────────────────────────────────
  const [laporanLogState, setLaporanLogState] = useState<LaporanLogState>(() => ({
    dateStart: getTodayWIB(),
    dateEnd: getTodayWIB(),
    reportType: 'presensi',
    hasLoadedOnce: false,
  }));

  const [riwayatIzinState, setRiwayatIzinState] = useState<RiwayatIzinState>(() => ({
    dateStart: getTodayWIB(),
    dateEnd: getTodayWIB(),
    rows: [],
    hasLoadedOnce: false,
  }));

  const [webPresensiState, setWebPresensiState] = useState<WebPresensiState>(() => ({
    sudahLogin: false,
    pemilikSesi: null,
    hasilImei: null,
    tab: 'imei',
    kehadiran: null,
    detail: null,
    ijinAjax: null,
    perizinan: null,
    semuaPerizinan: null,
    dimuat: { kehadiran: false, detail: false, perizinan: false },
  }));

  /*
   * Nilai context di-`useMemo`, dan itu **wajib** — bukan "_optimasi_".
   *
   * Tanpa `useMemo`, objek literal di bawah dibuat baru pada **setiap**
   * render provider. React membandingkan nilai context dengan `Object.is`,
   * jadi objek baru berarti "nilai berubah" — dan seluruh 13 pemanggil
   * `useAppContext()` merender ulang, meskipun tidak ada satu pun state
   * yang berubah.
   *
   * Yang membuatnya terasa: `Clock` di `App.tsx` menetapkan state setiap
   * detik. `Clock` tidak memakai context, jadi ia tidak memicu apa pun —
   * tapi `useServerContext` menulis `config` setiap kali koordinat berubah,
   * dan `setPathname` berjalan di setiap perpindahan halaman. Keduanya
   * membuat provider merender ulang, dan tanpa memo seluruh pohon halaman
   * ikut merender ulang bersamanya.
   *
   * `setState` dari `useState` sudah stabil secara identitas, jadi tidak
   * perlu dimasukkan sebagai dependensi — tapi tetap dituliskan supaya
   * siapa pun yang menambah state baru tidak lupa mengisinya.
   */
  const nilai = useMemo<AppContextType>(
    () => ({
      pegawai,
      setPegawai,
      serverConnected,
      setServerConnected,
      serverLoginError,
      setServerLoginError,
      serverLogoutRequested,
      setServerLogoutRequested,
      loginForm,
      setLoginForm,
      developerMode,
      setDeveloperMode,
      config,
      setConfig,
      activePage,
      setActivePage,
      setSubPath,
      pathname,
      laporanLogState,
      setLaporanLogState,
      riwayatIzinState,
      setRiwayatIzinState,
      webPresensiState,
      setWebPresensiState,
      currentUser,
      setCurrentUser,
      userRole,
      tabPermissions,
      cekingSesi,
      adaSesiSaatMuat,
    }),
    [
      // State
      pegawai, serverConnected, serverLoginError, serverLogoutRequested,
      loginForm, developerMode, config, activePage,
      pathname, laporanLogState, riwayatIzinState, webPresensiState, currentUser, userRole,
      tabPermissions, cekingSesi, adaSesiSaatMuat,
      // Setter
      setDeveloperMode, setActivePage, setSubPath, setCurrentUser,
      // Dispatcher useState — stabil, tapi didaftarkan agar lengkap.
      setPegawai, setServerConnected, setServerLoginError, setServerLogoutRequested,
      setLoginForm, setConfig, setLaporanLogState, setRiwayatIzinState, setWebPresensiState,
    ]
  );

  return <AppContext.Provider value={nilai}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

/** Peta id halaman → path, dipakai juga oleh App.tsx. */
export const PAGE_PATHS = PATH_MAP;
