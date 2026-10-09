import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Lock,
  Save,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  AtSign,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

import { useAppContext } from '../context/AppContext';
import { useBackButton } from '../hooks/useBackButton';
import { validatePassword } from '../lib/userManager';
import { APP_NAME } from '../lib/appIdentity';
import {
  bacaNamaAdminBawaan,
  gantiPasswordAkun,
  ubahKredensialAdminBawaan,
} from '../lib/akunFirestore';

// ─── Types & Constants ──────────────────────────────────────────────
interface SettingAkunModalProps {
  onClose: () => void;
}

type CredSection = 'none' | 'username' | 'password';
const ADMIN_USERNAME_REGEX = /^[a-zA-Z0-9_.-]{2,32}$/;

// ─── Helpers ────────────────────────────────────────────────────────
function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}

function validateAdminUsername(u: string): string {
  const trimmed = u.trim();
  if (!trimmed) throw new Error('Username tidak boleh kosong.');
  if (trimmed.length < 2 || trimmed.length > 32)
    throw new Error('Username harus 2–32 karakter.');
  if (!ADMIN_USERNAME_REGEX.test(trimmed))
    throw new Error('Username hanya boleh huruf, angka, _ . -');
  return trimmed.toLowerCase();
}

/**
 * ⚠️ Fungsi verifikasi password admin **sudah tidak ada** — dan itu disengaja.
 *
 * Semuanya berjalan di peramban: `getDoc(jatim_pengaturan/auth)` lalu bandingkan
 * `pinEncrypted` atau `pinHash` dengan `verifyPinLayered`. Dua masalah nyata:
 *
 * 1. `pinHash` **terbaca publik** dari Firestore (`allow read: if true` pada
 *    `jatim_pengaturan/{docId}`), jadi siapa pun bisa mengambil hash admin dan
 *    memecahnya secara offline tanpa batas percobaan.
 * 2. Login admin bisa dicoba dari mana saja dengan password yang ditebak,
 *    karena seluruh prosesnya berjalan di browser orang yang sedang menebak.
 *
 * Sekarang `jatim_pengaturan/auth` hanya bisa dibaca server, dan verifikasi
 * password terjadi di `POST /api/panel-auth` (`ubahAdminBawaan` /
 * `gantiPasswordSendiri`) yang juga punya pembatas percobaannya sendiri.
 *
 * Form di bawah memanggil endpoint itu lewat `ubahKredensialAdminBawaan()` dan
 * `gantiPasswordAkun()` — bukan memverifikasi sendiri lalu berharap server mengizinkan.
 */

// ─── UI Styling Components ──────────────────────────────────────────
const credentialInputClass =
  'w-full pl-10 pr-12 py-2.5 border border-slate-200 dark:border-slate-700/80 rounded-xl bg-white dark:bg-slate-900/60 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none text-sm transition-all';

// ─── Main Component: SettingAkunModal ────────────────────────────────
export default function SettingAkunModal({ onClose }: SettingAkunModalProps) {
  const {
    developerMode,
    setDeveloperMode,
    userRole,
    currentUser,
  } = useAppContext();

  const [openSection, setOpenSection] = useState<CredSection>('none');

  useBackButton(
    openSection !== 'none',
    () => {
      if (openSection === 'none') return false;
      setOpenSection('none');
      return true;
    }
  );

  /*
   * Tiga hal yang sebelumnya digabung dalam satu efek, dipisah karena satu
   * saja sudah cukup untuk membuat efek ini berjalan terus-menerus.
   *
   * 1. **Fokus.** Hanya sekali, saat panel dipasang. Semula `onClose` ada di
   *    dependensi, dan `onClose` biasanya panah fungsi yang dibuat baru tiap
   *    render oleh induknya. Efek pun berjalan ulang tiap render, memanggil
   *    `focus()` — dan fokus yang diambil di tengah pengetikan memberi gejala
   *    yang sangat khas: mengetik satu huruf, kursor melompat ke awal field.
   *    Sekarang `onClose` dibaca lewat ref, jadi identitasnya tidak pernah
   *    berubah.
   * 2. **Escape.** Hanya bergantung pada `openSection`, jadi benar-benar
   *    hanya perlu dipasang ulang saat section berganti.
   * 3. **Kunci gulir.** Sekali pasang, sekali lepas — sama seperti `Modal`.
   *    Pemisahan ini penting karena `document.body.style.overflow` menyimpan
   *    nilai yang dibaca dan ditulis, jadi dua efek yang sama-sama managing
   *    field ini saling menimpa: salah satu memasang `hidden`, yang lain
   *    memasang `''` sebagai nilai "sebelumnya".
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Section terbuka (verifikasi kata sandi) punya prioritas — itu
      // jauh lebih dalam daripada menutup seluruh modal.
      if (event.key === 'Escape' && openSection === 'none') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openSection]);

  useEffect(() => {
    const overflowSebelum = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflowSebelum;
    };
  }, []);

  /*
   * Timer penutup setelah kredensial berhasil diganti.
   *
   * Disimpan di ref supaya bisa dibatalkan saat modal ditutup lebih dulu —
   * tanpa itu, `onClose()` tetap terpanggil 1,5 detik kemudian pada modal
   * yang sudah tidak ada, dan untuk pemanggil yang bisa membuka atau
   * menutup modal lain, itu berarti state yang salah ditulis.
   */
  const timerTutup = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerTutup.current) clearTimeout(timerTutup.current);
  }, []);

  const tutupNanti = useCallback(() => {
    if (timerTutup.current) clearTimeout(timerTutup.current);
    timerTutup.current = setTimeout(() => {
      timerTutup.current = null;
      onCloseRef.current();
    }, 1500);
  }, []);

  // State: Admin Username Change
  const [currentAdminUsername, setCurrentAdminUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [verifyPassForUsername, setVerifyPassForUsername] = useState('');
  const [showVerifyPass, setShowVerifyPass] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);

  // State: Password Change
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showOldPin, setShowOldPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [passError, setPassError] = useState('');
  const [passSuccess, setPassSuccess] = useState('');
  const [savingPass, setSavingPass] = useState(false);

  // Reset form status when toggling sections
  useEffect(() => {
    if (openSection !== 'username') {
      setNewUsername('');
      setVerifyPassForUsername('');
      setUsernameError('');
      setUsernameSuccess('');
    }
    if (openSection !== 'password') {
      setOldPin('');
      setNewPin('');
      setConfirmPin('');
      setPassError('');
      setPassSuccess('');
    }
  }, [openSection]);

  /*
   * Username admin saat ini, dari server.
   *
   * Semula `getDoc(jatim_pengaturan/auth)` langsung dari peramban. Sekarang
   * lewat `bacaNamaAdminBawaan()`, yang mengembalikan nilai yang **sama** dengan
   * yang dipakai server saat membandingkan nama di `masukPanel()` — jadi nilai
   * yang tampil di layar dan yang benar-benar berlaku tidak bisa berbeda.
   */
  useEffect(() => {
    if (userRole !== 'admin') return;
    let hidup = true;
    void bacaNamaAdminBawaan()
      .then(nama => {
        if (hidup && nama) setCurrentAdminUsername(nama);
      })
      .catch(() => {
        // Nama tidak terbaca bukan alasan membuat form gagal; opsinya tetap
        // bisa dipakai, dan server yang akan menolak kalau tidak cocok.
      });
    return () => {
      hidup = false;
    };
  }, [userRole]);

  // Admin Username Update Handler
  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError('');
    setUsernameSuccess('');

    let validated: string;
    try {
      validated = validateAdminUsername(newUsername);
    } catch (err) {
      setUsernameError(getErrorMessage(err, 'Username tidak valid.'));
      return;
    }

    if (!verifyPassForUsername) {
      setUsernameError('Konfirmasi password diperlukan.');
      return;
    }

    setSavingUsername(true);
    try {
      /*
       * Server yang memverifikasi password lama, bukan peramban. Dia juga yang
       * menolak kalau username baru bentrok dengan akun panel yang sudah ada —
       * dua identitas yang berbagi satu nama sesi adalah sumber kebinguan yang
       * besar, dan hashed Adler hanya bisa dicek di sisi yang punya dokumen.
       */
      await ubahKredensialAdminBawaan({
        usernameBaru: validated,
        passwordLama: verifyPassForUsername.substring(0, 128),
      });

      setCurrentAdminUsername(validated);
      setUsernameSuccess(`Username berhasil diubah menjadi "${validated}".`);
      setNewUsername('');
      setVerifyPassForUsername('');
    } catch (err) {
      setUsernameError(getErrorMessage(err, 'Gagal menyimpan username.'));
    } finally {
      setSavingUsername(false);
    }
  };

  // Password Update Handler
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setPassSuccess('');

    const oldTrimmed = oldPin.substring(0, 128);
    const newTrimmed = newPin.substring(0, 128);
    const confirmTrimmed = confirmPin.substring(0, 128);

    if (!oldTrimmed || !newTrimmed || !confirmTrimmed) {
      setPassError('Semua kolom harus diisi.');
      return;
    }
    if (newTrimmed !== confirmTrimmed) {
      setPassError('Password baru dan konfirmasi tidak cocok.');
      return;
    }

    const invalid = validatePassword(newTrimmed);
    if (invalid) {
      setPassError(invalid);
      return;
    }

    setSavingPass(true);
    try {
      /*
       * Kedua peran ditangani server, lewat dua aksi yang berbeda:
       *
       * - `admin:ubah` → admin bawaan, yang tidak punya dokumen akun.
       * - `password:ganti` → akun panel biasa.
       *
       * Server yang memverifikasi password lama dalam kedua kasus. Dulu form
       * ini membandingkan sendiri di peramban lalu menulis sendiri — artinya
       * siapa pun yang bisa membuka DevTools bisa menulis `pinHash` baru tanpa
       * pernah membuktikan password lamanya.
       */
      if (userRole === 'admin') {
        const pesan = await ubahKredensialAdminBawaan({
          passwordBaru: newTrimmed,
          passwordLama: oldTrimmed,
        });
        setPassSuccess(pesan || 'Password berhasil diperbarui!');
        tutupNanti();
      } else if (currentUser) {
        await gantiPasswordAkun({ passwordLama: oldTrimmed, passwordBaru: newTrimmed });
        setPassSuccess('Password berhasil diperbarui!');
        tutupNanti();
      } else {
        setPassError('Tidak ada akun aktif. Silakan login ulang.');
      }
    } catch (err) {
      setPassError(getErrorMessage(err, 'Terjadi kesalahan sistem.'));
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <div
      className="modal-overlay-enter modal-layer fixed inset-0 bg-slate-950/70 z-[90] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        onClick={event => event.stopPropagation()}
        style={{
          width:
            'min(100%, calc(100vw - var(--dev-panel-right-offset, 0px) - 2rem))',
          maxWidth: '28rem',
        }}
        className="modal-panel-enter bg-white dark:bg-slate-800 rounded-2xl shadow-2xl shadow-slate-950/20 h-auto min-h-[min(32rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] border border-slate-200 dark:border-slate-700/80 overflow-hidden flex flex-col outline-none"
      >
        {/* Header Modal */}
        <div className="flex justify-between items-center p-4 sm:p-5 border-b border-slate-100 dark:border-slate-700/80 shrink-0 bg-white dark:bg-slate-800">
          <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            Pengaturan {APP_NAME}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/*
         * Content body.
         *
         * ⚠️ Tidak ada tab navigation lagi. Dulu ada dua tab — "Pengaturan"
         * dan "Pengguna" — dan tab kedua sudah pindah ke menu **Manajemen
         * Akun**. Satu tab tidak butuh bar tab: ia hanya memaksa satu klik
         *-boleh-tidak-boleh sebelum isi terlihat.
         *
         * Dialog ini sekarang murni preferensi milik satu orang (tema, format
         * tanggal, mode pengembang). Tidak ada satu pun keputusan tentang
         * orang lain di dalamnya.
         */}
        <div className="overflow-y-auto flex-1 custom-scrollbar">
          <div className="p-4 sm:p-5 space-y-4">
              {/* Dev Mode Toggle Card */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl flex items-center justify-between shadow-sm">
                <div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    ⚙️ Mode Developer
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500 block mt-0.5">
                    Aktifkan Fitur DevMode
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDeveloperMode(!developerMode)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    developerMode ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                      developerMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Collapsible Account Settings */}
              <div className="border border-slate-200 dark:border-slate-700/80 rounded-2xl overflow-hidden shadow-sm bg-white dark:bg-slate-900/20">
                <div className="px-4 py-3 bg-slate-50/80 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700/60">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {userRole === 'admin'
                      ? '🔑 Akun Administrator'
                      : '🔑 Akun Saya'}
                  </p>
                  {userRole === 'admin' && currentAdminUsername && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      Username saat ini:{' '}
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        @{currentAdminUsername}
                      </span>
                    </p>
                  )}
                </div>

                {/* Section: Change Admin Username */}
                {userRole === 'admin' && (
                  <div className="border-b border-slate-100 dark:border-slate-700/60">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenSection(
                          openSection === 'username' ? 'none' : 'username'
                        )
                      }
                      className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <AtSign className="w-4 h-4 text-blue-500" />
                        <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                          Ganti Username Admin
                        </span>
                      </div>
                      {openSection === 'username' ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </button>

                    <AnimatePresence>
                      {openSection === 'username' && (
                        <motion.form
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          onSubmit={handleSaveUsername}
                          className="px-4 pb-4 space-y-3 overflow-hidden"
                        >
                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                              Username Baru
                            </label>
                            <div className="relative">
                              <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                              <input
                                type="text"
                                value={newUsername}
                                onChange={(e) =>
                                  setNewUsername(
                                    e.target.value
                                      .toLowerCase()
                                      .replace(/\s/g, '')
                                      .substring(0, 32)
                                  )
                                }
                                className={credentialInputClass}
                                placeholder="username baru"
                                autoCapitalize="none"
                                maxLength={32}
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                              Konfirmasi Password Admin
                            </label>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                              <input
                                type={showVerifyPass ? 'text' : 'password'}
                                value={verifyPassForUsername}
                                onChange={(e) =>
                                  setVerifyPassForUsername(
                                    e.target.value.substring(0, 128)
                                  )
                                }
                                className={credentialInputClass}
                                placeholder="Masukkan password verifikasi"
                                maxLength={128}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowVerifyPass(!showVerifyPass)
                                }
                                aria-label={
                                  showVerifyPass ? 'Sembunyikan sandi' : 'Tampilkan sandi'
                                }
                                aria-pressed={showVerifyPass}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 -mr-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                              >
                                {showVerifyPass ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>

                          {usernameError && (
                            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2.5 rounded-xl text-xs font-semibold">
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              <span>{usernameError}</span>
                            </div>
                          )}
                          {usernameSuccess && (
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-2.5 rounded-xl text-xs font-semibold">
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              <span>{usernameSuccess}</span>
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={savingUsername}
                            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex justify-center items-center gap-2 transition-colors shadow-sm"
                          >
                            {savingUsername ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                            {savingUsername ? 'Menyimpan...' : 'Simpan Username'}
                          </button>
                        </motion.form>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Section: Change Password */}
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenSection(
                        openSection === 'password' ? 'none' : 'password'
                      )
                    }
                    className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <Lock className="w-4 h-4 text-blue-500" />
                      <span className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                        Ganti Password
                      </span>
                    </div>
                    {openSection === 'password' ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  <AnimatePresence>
                    {openSection === 'password' && (
                      <motion.form
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        onSubmit={handleSavePassword}
                        className="px-4 pb-4 space-y-3 overflow-hidden"
                      >
                        {[
                          {
                            label: 'Password Lama',
                            val: oldPin,
                            set: setOldPin,
                            show: showOldPin,
                            toggle: () => setShowOldPin(!showOldPin),
                            placeholder: 'Masukkan password lama',
                          },
                          {
                            label: 'Password Baru',
                            val: newPin,
                            set: setNewPin,
                            show: showNewPin,
                            toggle: () => setShowNewPin(!showNewPin),
                            placeholder: 'Min. 4 karakter',
                          },
                          {
                            label: 'Konfirmasi Password Baru',
                            val: confirmPin,
                            set: setConfirmPin,
                            show: showConfirmPin,
                            toggle: () => setShowConfirmPin(!showConfirmPin),
                            placeholder: 'Ulangi password baru',
                          },
                        ].map(({ label, val, set, show, toggle, placeholder }) => (
                          <div key={label}>
                            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                              {label}
                            </label>
                            <div className="relative">
                              <input
                                type={show ? 'text' : 'password'}
                                value={val}
                                onChange={(e) => set(e.target.value)}
                                className="w-full pl-4 pr-10 py-2.5 border border-slate-200 dark:border-slate-700/80 rounded-xl bg-white dark:bg-slate-900/60 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none text-sm transition-all"
                                placeholder={placeholder}
                                maxLength={128}
                              />
                              <button
                                type="button"
                                onClick={toggle}
                                aria-label={show ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
                                aria-pressed={show}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 -mr-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                              >
                                {show ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        ))}

                        {passError && (
                          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2.5 rounded-xl text-xs font-semibold">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{passError}</span>
                          </div>
                        )}
                        {passSuccess && (
                          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-2.5 rounded-xl text-xs font-semibold">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>{passSuccess}</span>
                          </div>
                        )}

                        <button
                          type="submit"
                          disabled={savingPass}
                          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex justify-center items-center gap-2 transition-colors shadow-sm"
                        >
                          {savingPass ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                          {savingPass ? 'Menyimpan...' : 'Simpan Password'}
                        </button>
                      </motion.form>
                    )}
                  </AnimatePresence>
                </div>
              </div>

          </div>
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white/95 p-3 dark:border-slate-700/80 dark:bg-slate-800/95 sm:p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
