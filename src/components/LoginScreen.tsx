import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Hexagon,
  Lock,
  LogIn,
  Moon,
  ShieldAlert,
  Sun,
  User,
} from 'lucide-react';
import { sanitizeString } from '../lib/userManager';
import { useAppContext } from '../context/AppContext';
import { clearSessionByRole } from '../lib/sessionManager';
import { masukPanelPanel, PanelAuthError } from '../lib/akunFirestore';
import { APP_FULL_NAME, APP_LOGO, APP_NAME } from '../lib/appIdentity';
import { bacaStorage, tulisStorage, hapusStorage } from '../lib/storageAman';

interface LoginScreenProps {
  onLogin: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

// ─── Rate limiting sisi klien ─────────────────────────────────────
/*
 * ⚠️ Ini **bukan** pengaman lagi — hanya lapisan server yang menahan, dan
 * bentuk kesalahannya masih kelihatan di UI.
 *
 * Penghitung yang sebenarnya ada di `POST /api/panel-auth`
 * (`BATAS_PER_IP` / `BATAS_PER_AKUN` di `lib/panelServer.ts`) dan tidak bisa
 * dihapus dengan mengosongkan `localStorage`. Yang di sini tetap dipakai karena
 * dua hal yang tidak bisa diulang server: menahan tombol spam di perangkat yang
 * sama, dan menampilkan hitung mundur tanpa menunggu respons.
 */
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_USERNAME_LEN = 32;
const MAX_PASSWORD_LEN = 128;
const MIN_AUTH_DELAY_MS = 300; // waktu respons minimum (timing-safe)
const LS_ATTEMPTS = 'epresensi_jatim_login_attempts';
const LS_COOLDOWN = 'epresensi_jatim_cooldown_until';

// ─── Auth reducer ────────────────────────────────────────────────
type AuthStatus = 'IDLE' | 'AUTHENTICATING' | 'LOCKED' | 'SUCCESS';

interface AuthState {
  status: AuthStatus;
  username: string;
  pin: string;
  attempts: number;
  cooldownUntil: number | null;
  errorMessage: string | null;
}

type AuthAction =
  | { type: 'SET_USERNAME'; payload: string }
  | { type: 'SET_PIN'; payload: string }
  | { type: 'START_AUTH' }
  | { type: 'AUTH_SUCCESS' }
  | {
      type: 'AUTH_FAILED';
      payload: { attempts: number; cooldownUntil?: number; errorMsg: string };
    }
  | { type: 'UPDATE_COOLDOWN'; payload: number | null };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_USERNAME':
      return { ...state, username: action.payload.substring(0, MAX_USERNAME_LEN) };
    case 'SET_PIN':
      return { ...state, pin: action.payload.substring(0, MAX_PASSWORD_LEN) };
    case 'START_AUTH':
      return { ...state, status: 'AUTHENTICATING', errorMessage: null };
    case 'AUTH_SUCCESS':
      return { ...state, status: 'SUCCESS', pin: '', errorMessage: null };
    case 'AUTH_FAILED':
      return {
        ...state,
        status: action.payload.cooldownUntil ? 'LOCKED' : 'IDLE',
        attempts: action.payload.attempts,
        cooldownUntil: action.payload.cooldownUntil ?? state.cooldownUntil,
        errorMessage: action.payload.errorMsg,
        pin: '',
      };
    case 'UPDATE_COOLDOWN':
      return {
        ...state,
        cooldownUntil: action.payload,
        status: action.payload && action.payload > Date.now() ? 'LOCKED' : 'IDLE',
      };
    default:
      return state;
  }
}

// ─── Sanitizer input ─────────────────────────────────────────────
function sanitizeUsername(value: string): string {
  return sanitizeString(value, MAX_USERNAME_LEN).toLowerCase().replace(/\s/g, '');
}

function sanitizePassword(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, '').substring(0, MAX_PASSWORD_LEN);
}

const formatCountdown = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export default function LoginScreen({ onLogin, isDarkMode, toggleDarkMode }: LoginScreenProps) {
  const { setCurrentUser } = useAppContext();

  const [state, dispatch] = useReducer(authReducer, {
    status: 'IDLE',
    username: '',
    pin: '',
    attempts: 0,
    cooldownUntil: null,
    errorMessage: null,
  });

  const [showPin, setShowPin] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const authInFlight = useRef(false);

  // ── Pulihkan status kunci dari localStorage ────────────────────
  /*
   * Semua akses penyimpanan di layar ini lewat `storageAman`.
   * Dua di antaranya berada di jalur yang paling tidak boleh gagal:
   * `tulisStorage(LS_ATTEMPTS, …)` dipanggil di dalam blok `catch` dari
   * handler login — kalau penulisan itu melempar karena kuota penuh, lemparan
   * baru menggantikan yang asli, penghitung percobaan tidak pernah naik,
   * dan penguncian brute-force tidak pernah aktif. Login jadi bisa ditebak
   * tanpa batas.
   */
  useEffect(() => {
    const savedAttempts = parseInt(bacaStorage(LS_ATTEMPTS, '0'), 10) || 0;
    const savedCooldown = parseInt(bacaStorage(LS_COOLDOWN, '0'), 10) || 0;
    if (savedCooldown && savedCooldown > Date.now()) {
      dispatch({
        type: 'AUTH_FAILED',
        payload: {
          attempts: savedAttempts,
          cooldownUntil: savedCooldown,
          errorMsg: 'Terlalu banyak percobaan. Sistem dikunci sementara.',
        },
      });
    } else if (savedAttempts > 0) {
      tulisStorage(LS_ATTEMPTS, '0');
      hapusStorage(LS_COOLDOWN);
    }
  }, []);

  // ── Hitung mundur kunci ────────────────────────────────────────
  useEffect(() => {
    if (!state.cooldownUntil || state.cooldownUntil <= Date.now()) return;
    const interval = setInterval(() => {
      const remaining = Math.ceil((state.cooldownUntil! - Date.now()) / 1000);
      if (remaining <= 0) {
        setTimeLeft(0);
        dispatch({ type: 'UPDATE_COOLDOWN', payload: null });
        hapusStorage(LS_COOLDOWN);
        tulisStorage(LS_ATTEMPTS, '0');
      } else {
        setTimeLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [state.cooldownUntil]);

  // ── Autentikasi ────────────────────────────────────────────────
  const handleAuthentication = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (authInFlight.current) return;

    if (state.status === 'LOCKED' || state.cooldownUntil) {
      dispatch({
        type: 'AUTH_FAILED',
        payload: {
          attempts: state.attempts,
          errorMsg: `Akses ditolak. Tunggu ${formatCountdown(timeLeft)}.`,
        },
      });
      return;
    }

    const username = sanitizeUsername(state.username);
    const password = sanitizePassword(state.pin);

    if (!username || !password) {
      dispatch({
        type: 'AUTH_FAILED',
        payload: { attempts: state.attempts, errorMsg: 'ID pengguna dan kata sandi wajib diisi.' },
      });
      return;
    }

    authInFlight.current = true;
    dispatch({ type: 'START_AUTH' });
    const startedAt = Date.now();

    /** Jaga waktu respons tetap minimal supaya tidak membocorkan info. */
    const ensureMinDelay = async () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_AUTH_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_AUTH_DELAY_MS - elapsed));
      }
    };

    try {
      /*
       * Satu permintaan ke server. Tidak ada lagi pembacaan Firestore di
       * peramban.
       *
       * Yang dihapus beserta alasannya:
       *
       * 1. Blok "admin bawaan" (`pinEncrypted` / `pinHash` dari
       *    `jatim_pengaturan/auth`). Semuanya berbunyi
       *    `storedAdmin ? username === storedAdmin : true` — begitu
       *    `adminUsername` belum pernah diisi, **username apa pun** +
       *    password admin menghasilkan admin penuh. Server selalu membandingkan
       *    nama sekarang, dan field kosong berarti `admin`, bukan "apa pun".
       *
       * 2. `verifyUserPassword()` — bcrypt di peramban. Membacanya berarti
       *    seluruh hash password admin bisa diambil dari Firebase Console dan
       *    dipecah secara offline; lewat server, hash tidak pernah keluar.
       *
       * 3. `createAdminUserAccount()` + `DEFAULT_ADMIN_PERMISSIONS` yang
       *    diinisialisasi di sini. Peran sekarang **selalu** datang dari
       *    server sebagai bagian dari token, tidak pernah diasumsikan di
       *    peramban.
       *
       * Token dikembalikan bersama akun dan **wajib** diteruskan ke
       * `setCurrentUser()`; tanpa itu tidak ada yang bisa diverifikasi saat
       * muat berikutnya.
       */
      const { akun, token } = await masukPanelPanel(username, password);

      await ensureMinDelay();

      tulisStorage(LS_ATTEMPTS, '0');
      hapusStorage(LS_COOLDOWN);

      // Sesi peran lain dibuang sebelum masuk. `saveSession()` juga melakukannya,
      // tapi Storage sudah bersih lebih dulu di sini, sebelum render apa pun.
      clearSessionByRole(akun.role === 'admin' ? 'user' : 'admin');

      setCurrentUser(akun, token);
      dispatch({ type: 'AUTH_SUCCESS' });
      setTimeout(onLogin, 400);
    } catch (err) {
      await ensureMinDelay();

      /*
       * Server sudah punya penguncian sendiri, dan itu yang benar-benar
       * menahan. Penghitung lokal tetap dipakai untuk tombol spam di perangkat
       * ini — tetapi kalau server yang menolak dengan 429, hitung mundur
       * **ikut** dipakai dari server, bukan yang lokal: mengabaikan 429 akan
       * membuat tombol tetap bisa ditekan padahal sudah pasti ditolak.
       */
      if (err instanceof PanelAuthError && err.kode === 429) {
        const detik = Math.max(1, Math.ceil((err.terkunci ?? COOLDOWN_MS / 1000)));
        const lockUntil = Date.now() + detik * 1000;
        tulisStorage(LS_COOLDOWN, String(lockUntil));
        dispatch({
          type: 'AUTH_FAILED',
          payload: {
            attempts: state.attempts,
            cooldownUntil: lockUntil,
            errorMsg: `${err.message} Tunggu ${formatCountdown(detik)}.`,
          },
        });
        return;
      }

      // 503 = server belum dikonfigurasi (PANEL_SESSION_SECRET / Firebase
      // Admin). Menambahkannya ke penghitung percobaan akan mengunci orang
      // selama 5 menit karena masalah yang tidak ada hubungannya dengan
      // password-nya.
      if (err instanceof PanelAuthError && (err.kode === 503 || err.kode === 0)) {
        dispatch({
          type: 'AUTH_FAILED',
          payload: { attempts: state.attempts, errorMsg: err.message },
        });
        return;
      }

      console.warn('[LoginScreen] autentikasi gagal:', err);
      const nextAttempts = state.attempts + 1;
      tulisStorage(LS_ATTEMPTS, String(nextAttempts));

      if (nextAttempts >= MAX_ATTEMPTS) {
        const lockUntil = Date.now() + COOLDOWN_MS;
        tulisStorage(LS_COOLDOWN, String(lockUntil));
        dispatch({
          type: 'AUTH_FAILED',
          payload: {
            attempts: nextAttempts,
            cooldownUntil: lockUntil,
            errorMsg: 'Terlalu banyak percobaan gagal. Sistem dikunci 5 menit.',
          },
        });
      } else {
        dispatch({
          type: 'AUTH_FAILED',
          payload: {
            attempts: nextAttempts,
            errorMsg: `Kredensial salah. ${MAX_ATTEMPTS - nextAttempts} percobaan tersisa.`,
          },
        });
      }
    } finally {
      authInFlight.current = false;
    }
  };

  const isLocked = state.status === 'LOCKED';
  const isAuthing = state.status === 'AUTHENTICATING';
  const canSubmit =
    !isLocked && !isAuthing && sanitizeUsername(state.username).length > 0 && sanitizePassword(state.pin).length > 0;

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-8 font-sans transition-colors duration-500 bg-slate-200/80 dark:bg-[#0a0f1c] overflow-hidden selection:bg-indigo-500/30">
      {/* ─── Latar ─────────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="login-grid-mask absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] dark:bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)]" />
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-emerald-500/10 dark:bg-emerald-500/15 blur-3xl" />
      </div>

      {/* ─── Ganti tema ────────────────────────────────────────────── */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={toggleDarkMode}
          className="p-3 rounded-xl bg-white/60 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:bg-white dark:hover:bg-slate-800 transition-all duration-300 active:scale-95 group"
          aria-label="Ganti tema"
        >
          {isDarkMode ? (
            <Sun className="w-5 h-5 text-amber-400 group-hover:rotate-45 transition-transform duration-500" />
          ) : (
            <Moon className="w-5 h-5 text-indigo-500 group-hover:-rotate-12 transition-transform duration-500" />
          )}
        </button>
      </div>

      {/* ─── Kartu utama ───────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-[26rem] bg-white/95 dark:bg-slate-900/75 backdrop-blur-xl border border-slate-200/90 dark:border-slate-700/60 rounded-[2rem] shadow-2xl shadow-slate-900/10 dark:shadow-slate-950/50 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />

        <div className="px-8 pt-10 pb-6 text-center relative">
          <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6 group">
            <div className="absolute inset-0 bg-indigo-500/20 dark:bg-indigo-500/30 rounded-3xl rotate-6 group-hover:rotate-12 transition-transform duration-500" />
            <div className="absolute inset-0 bg-emerald-500/20 dark:bg-emerald-500/30 rounded-3xl -rotate-6 group-hover:-rotate-12 transition-transform duration-500" />
            <div className="relative flex items-center justify-center w-full h-full bg-slate-100 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-1.5 overflow-hidden">
              <img
                src={APP_LOGO}
                alt={`Logo ${APP_NAME}`}
                className="h-full w-full object-contain"
                onError={event => {
                  event.currentTarget.style.display = 'none';
                  event.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
              <Hexagon className="hidden w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 tracking-tight">
            {APP_NAME}
          </h1>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-2 uppercase tracking-[0.2em]">
            {APP_FULL_NAME}
          </p>
          {/*
            Nomor versi **dihapus** dari layar login.

            Yang tampil sudah tiga baris: logo, nama aplikasi, dan nama
            lengkapnya. Baris keempat — "v1.0.0" — tidak menambah informasi apa
            pun bagi orang yang sedang login: tidak ada yang bisa dilakukan
            dengannya, dan tidak ada tempat lain di layar yang menyebut versi
            aplikasi. Yang tersisa cuma ruang kosong tambahan.

            `APP_VERSION` masih dipakai di layar "Mohon Tunggu" versi
            verifikasi dan di `GerbangLangganan` — di sana memang berguna,
            karena pengguna yang menunggu perlu tahu versi yang sedang
            bermasalah saat menghubungi admin.
          */}
        </div>

        <div className="px-8 pb-10 relative">
          {state.status === 'SUCCESS' && (
            <div className="absolute inset-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm flex flex-col justify-center items-center rounded-b-[2rem] animate-in fade-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-500/10 rounded-full flex items-center justify-center mb-6 ring-8 ring-emerald-50/50 dark:ring-emerald-500/5">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Autentikasi Berhasil</h2>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 animate-pulse">Menyiapkan workspace...</p>
            </div>
          )}

          <form onSubmit={handleAuthentication} className="space-y-6" autoComplete="off">
            {state.errorMessage && (
              <div
                className={`flex items-start gap-3 p-4 rounded-xl text-sm font-medium shadow-sm border animate-in fade-in slide-in-from-top-2 duration-300 ${
                  isLocked
                    ? 'bg-red-50/80 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400'
                    : 'bg-amber-50/80 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400'
                }`}
              >
                {isLocked ? <ShieldAlert className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                <span className="leading-relaxed">{state.errorMessage}</span>
              </div>
            )}

            <div className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="login-username"
                  className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1"
                >
                  ID Pengguna
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <User className="h-5 w-5" />
                  </div>
                  <input
                    id="login-username"
                    type="text"
                    value={state.username}
                    disabled={isLocked || isAuthing}
                    onChange={event => dispatch({ type: 'SET_USERNAME', payload: event.target.value })}
                    className="block w-full pl-11 pr-4 py-3.5 bg-white/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50"
                    placeholder="Masukkan ID Anda"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label
                    htmlFor="login-password"
                    className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider"
                  >
                    Kata Sandi
                  </label>
                  {isLocked && (
                    <span className="text-[10px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1 bg-red-100 dark:bg-red-500/20 px-2 py-1 rounded-md animate-pulse">
                      <Clock className="w-3 h-3" /> {formatCountdown(timeLeft)}
                    </span>
                  )}
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                    <Lock className="h-5 w-5" />
                  </div>
                  <input
                    id="login-password"
                    type={showPin ? 'text' : 'password'}
                    value={state.pin}
                    disabled={isLocked || isAuthing}
                    onChange={event => dispatch({ type: 'SET_PIN', payload: event.target.value })}
                    className="block w-full pl-11 pr-12 py-3.5 bg-white/50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-xl text-base font-mono tracking-widest text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50"
                    placeholder={isLocked ? 'TERKUNCI' : '••••••••'}
                    autoComplete="current-password"
                  />
                  <div className="absolute inset-y-0 right-1 flex items-center pr-2">
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      disabled={isLocked || isAuthing}
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-all focus:outline-none"
                      aria-label={showPin ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                      aria-pressed={showPin}
                    >
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className={`relative w-full flex justify-center items-center gap-2 py-3.5 px-6 rounded-xl text-sm font-bold text-white transition-all duration-300 overflow-hidden ${
                isAuthing
                  ? 'bg-indigo-500 cursor-wait'
                  : isLocked || !canSubmit
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 shadow-[0_8px_20px_rgb(79,70,229,0.25)] hover:-translate-y-0.5 active:translate-y-0 group'
              }`}
            >
              {isAuthing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Memverifikasi...</span>
                </>
              ) : isLocked ? (
                <>
                  <Lock className="w-5 h-5" />
                  <span>Akses Tertutup</span>
                </>
              ) : (
                <>
                  <span className="relative z-10">Masuk ke Sistem</span>
                  <LogIn className="w-5 h-5 relative z-10 transition-transform duration-300 group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
