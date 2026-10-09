/**
 * Modal "Profil Server" — Aksi pada akun yang benar-benar milik server pusat.
 *
 * ⚠️ Sebelumnya menu "Ganti Password Server" (label + hint-nya menyebut
 * `object update_profil`) justru membuka `SettingAkunModal`, yaitu
 * pengaturan akun **panel** yang tersimpan di Firestore. RPC
 * `update_profil` tidak pernah dipanggil. Modal ini menutup celah itu:
 * dua aksi yang benar-benar memanggil server pusat —
 *
 *   1. Ganti password   → `update_profil` (`password_lama` + `password`)
 *   2. Unggah foto     → `update_foto`   (`image` + `image64` + `vektor`)
 *
 * Bentuk payload keduanya disalin dari decompilasi APK 1.11.21
 * (`ProfileFragment` dan `UploadPhotoViewModel`).
 */

import { useEffect, useState } from 'react';
import { Camera, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { useToast } from './ui/Toast';
import { Modal } from './ui/Modal';
import { ActionButton, Alert, Card, CardTitle, Field, PasswordField } from './ui/Surface';
import { rpcUpdateFoto, rpcUpdateProfil } from '../lib/apiCalls';
import { fotoProfileValid } from '../lib/viewModels';

/** Batas foto profil — dikirim sebagai base64, jadi lebih besar dari aslinya. */
const MAX_PHOTO_BYTES = 3_000_000;

/**
 * Kebijakan password yang ditegakkan server (dicek di sisi klien dulu,
 * persis seperti `ProfileFragment`).
 *
 * Pesan error yang sama dengan yang dikirim server: "minimal 8 karakter,
 * huruf besar, angka, karakter spesial".
 */
function validasiPassword(pw: string): string | null {
  if (pw.length < 8) return 'Password baru minimal 8 karakter.';
  if (!/[A-Z]/.test(pw)) return 'Password baru harus memuat huruf besar.';
  if (!/[0-9]/.test(pw)) return 'Password baru harus memuat angka.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password baru harus memuat karakter spesial.';
  return null;
}

export default function ProfilServerModal({ onClose }: { onClose: () => void }) {
  const { pegawai, setPegawai } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();

  const [mode, setMode] = useState<'password' | 'foto'>('password');

  // ── Ganti password ────────────────────────────────────────────────
  const [passwordLama, setPasswordLama] = useState('');
  const [passwordBaru, setPasswordBaru] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [gantiSibuk, setGantiSibuk] = useState(false);
  const [gantiError, setGantiError] = useState<string | null>(null);

  // ── Unggah foto ───────────────────────────────────────────────────
  const [fotoBerkas, setFotoBerkas] = useState<File | null>(null);
  const [fotoPratinjau, setFotoPratinjau] = useState<string>('');
  const [unggahSibuk, setUnggahSibuk] = useState(false);
  const [unggahError, setUnggahError] = useState<string | null>(null);

  /*
   * Pratinjau lokal = `blob:` URL, dan `blob:` URL **tidak** dibebaskan
   * otomatis. Semula URL itu hanya direvoke di dua tempat: saat berkas lain
   * dipilih, dan setelah unggahan berhasil. Dua-duanya tidak mencakup
   * kasus paling umum — menutup modal selagi foto sudah dipilih tapi
   * belum diunggah. Setiap percobaan yang batal seperti itu menahan salinan
   * berkas foto (sampai 3 MB) di memori browser sampai tab ditutup, dan
   * `ProfilServerModal` bisa dibuka berulang.
   *
   * Satu tempat yang membersihkan — `useEffect` saat komponen dilepas — dan
   * hanya itu. Revoke juga dipanggil tepat sebelum `createObjectURL` berikutnya
   * (lihat `handleGantiPratinjau`) supaya tidak ada dua pratinjau hidup sekaligus.
   */
  useEffect(() => {
    return () => {
      if (fotoPratinjau) URL.revokeObjectURL(fotoPratinjau);
    };
  }, [fotoPratinjau]);

  /** Ganti pratinjau, melepas URL lama lebih dulu. */
  const handleGantiPratinjau = (berikutnya: string) => {
    setFotoPratinjau(pratinjauLama => {
      if (pratinjauLama) URL.revokeObjectURL(pratinjauLama);
      return berikutnya;
    });
  };

  const handleGantiPassword = async () => {
    setGantiError(null);

    if (!passwordLama) {
      setGantiError('Password lama wajib diisi.');
      return;
    }
    if (!passwordBaru) {
      setGantiError('Password baru wajib diisi.');
      return;
    }
    if (passwordBaru !== konfirmasi) {
      setGantiError('Password baru tidak sama dengan konfirmasi.');
      return;
    }
    const masalah = validasiPassword(passwordBaru);
    if (masalah) {
      setGantiError(masalah);
      return;
    }

    setGantiSibuk(true);
    try {
      // Hanya dua key yang dikirim server — `konfirmasi` tidak pernah
      // masuk request (lihat `ProfileFragment`).
      const result = await rpcUpdateProfil(context, { passwordLama, passwordBaru });

      if (result === null) {
        setGantiError('Server pusat menolak. Periksa password lama Anda.');
        return;
      }
      if (result.result === false) {
        setGantiError(result.message || 'Server menolak penggantian password.');
        return;
      }

      toast.success(result.message || 'Password server pusat berhasil diganti.');
      setPasswordLama('');
      setPasswordBaru('');
      setKonfirmasi('');
    } catch (err: any) {
      setGantiError(err?.message ?? 'Gagal mengganti password server pusat.');
    } finally {
      setGantiSibuk(false);
    }
  };

  const handlePilihFoto = (file: File | null) => {
    setUnggahError(null);
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setUnggahError(`Foto maksimal ${Math.round(MAX_PHOTO_BYTES / 1_000_000)} MB.`);
      return;
    }
    if (!/^image\/(jpeg|jpg|png)$/i.test(file.type)) {
      setUnggahError('Foto harus berupa JPG atau PNG.');
      return;
    }
    setFotoBerkas(file);
    handleGantiPratinjau(URL.createObjectURL(file));
  };

  const handleUnggahFoto = async () => {
    setUnggahError(null);
    if (!fotoBerkas) {
      setUnggahError('Pilih foto terlebih dahulu.');
      return;
    }

    setUnggahSibuk(true);
    try {
      const base64 = await bacaBase64(fotoBerkas);
      // `image` = nama berkas (selalu "foto.png" di aplikasi), `image64` =
      // isi berkasnya. `vektor` tidak diisi: vektor wajah dihitung di
      // perangkat oleh model FaceNet, bukan di peramban.
      const result = await rpcUpdateFoto(context, { image64: base64 });

      if (result === null) {
        setUnggahError('Server pusat menolak unggahan foto.');
        return;
      }
      if (result.result === false) {
        setUnggahError(result.message || 'Server menolak unggahan foto.');
        return;
      }

      // Balasan `update_foto` memuat URL file yang baru ditulis server.
      const urlBaru = fotoProfileValid(result.url);
      if (urlBaru) {
        setPegawai(prev => (prev ? { ...prev, profilePic: urlBaru } : prev));
      }
      toast.success(result.message || 'Foto profil berhasil diperbarui.');
      setFotoBerkas(null);
      handleGantiPratinjau('');
    } catch (err: any) {
      setUnggahError(err?.message ?? 'Gagal mengunggah foto profil.');
    } finally {
      setUnggahSibuk(false);
    }
  };

  if (!pegawai || !ready) {
    return (
      <Modal
        open
        onClose={onClose}
        size="sm"
        title="Profil Server"
        icon={<ShieldCheck className="w-5 h-5 text-blue-500" />}
      >
        <Alert tone="amber">Hubungkan akun ke server pusat terlebih dahulu.</Alert>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Profil Server"
      icon={<ShieldCheck className="w-5 h-5 text-blue-500" />}
      footer={
        <div className="flex items-center gap-2">
          <ActionButton variant="ghost" size="sm" onClick={onClose}>
            Tutup
          </ActionButton>
          {mode === 'password' ? (
            <ActionButton
              className="flex-1"
              loading={gantiSibuk}
              onClick={() => void handleGantiPassword()}
              icon={<KeyRound className="w-4 h-4" />}
            >
              Ganti Password
            </ActionButton>
          ) : (
            <ActionButton
              className="flex-1"
              loading={unggahSibuk}
              disabled={!fotoBerkas}
              onClick={() => void handleUnggahFoto()}
              icon={<Upload className="w-4 h-4" />}
            >
              Unggah Foto
            </ActionButton>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('password')}
            className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              mode === 'password'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            Password
          </button>
          <button
            type="button"
            onClick={() => setMode('foto')}
            className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              mode === 'foto'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Camera className="w-4 h-4" />
            Foto Profil
          </button>
        </div>

        {mode === 'password' ? (
          <>
            {gantiError && <Alert tone="rose">{gantiError}</Alert>}
            <Field
              label="Password Lama"
              hint="Masukkan password yang sedang digunakan."
            >
              <PasswordField
                value={passwordLama}
                onChange={setPasswordLama}
                autoComplete="current-password"
              />
            </Field>
            <Field
              label="Password Baru"
              hint="Min. 8 karakter, huruf besar, angka, dan simbol."
            >
              <PasswordField
                value={passwordBaru}
                onChange={setPasswordBaru}
                autoComplete="new-password"
              />
            </Field>
            <Field
              label="Ulangi Password Baru"
            >
              <PasswordField
                value={konfirmasi}
                onChange={setKonfirmasi}
                autoComplete="new-password"
              />
            </Field>
          </>
        ) : (
          <>
            {unggahError && <Alert tone="rose">{unggahError}</Alert>}

            <Card className="bg-slate-50/60 dark:bg-slate-900/30">
              <CardTitle>Foto Saat Ini</CardTitle>
              <div className="flex items-center gap-4">
                {pegawai.profilePic ? (
                  <img
                    src={pegawai.profilePic}
                    alt="Foto profil server"
                    className="w-16 h-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                    <Camera className="w-6 h-6 text-slate-400" />
                  </div>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Berkas dikirim sebagai base64 pada field{' '}
                  <span className="font-mono">image64</span>; nama berkasnya dikirim terpisah
                  sebagai <span className="font-mono">image</span>.
                </p>
              </div>
            </Card>

            {fotoPratinjau && (
              <div className="flex items-center gap-4">
                <img
                  src={fotoPratinjau}
                  alt="Pratinjau foto"
                  className="w-16 h-16 rounded-2xl object-cover border border-blue-200 dark:border-blue-500/40"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {fotoBerkas?.name}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    {fotoBerkas ? Math.round(fotoBerkas.size / 1000) : 0} KB
                  </p>
                </div>
              </div>
            )}

            <Field label="Pilih Foto" hint="JPG atau PNG, maksimal 3 MB.">
              <label className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <Upload className="w-4 h-4" />
                Pilih Berkas
                <input
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png"
                  onChange={event => handlePilihFoto(event.target.files?.[0] ?? null)}
                />
              </label>
            </Field>

            {Number(pegawai.usingWajahServer ?? 0) === 1 && (
              <Alert tone="amber">
                Akun ini mewajibkan verifikasi wajah. Face recognition di aplikasi Android
                berjalan sepenuhnya di perangkat (model FaceNet) dan vektor wajahnya dikirim lewat
                <span className="font-mono"> vektor</span> pada <span className="font-mono">update_foto</span> —
                bagian itu belum direplikasi di panel web ini.
              </Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Baca berkas sebagai base64 polos (tanpa prefix data URI). */
function bacaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (!base64) reject(new Error('Gagal membaca berkas.'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('Gagal membaca berkas.'));
    reader.readAsDataURL(file);
  });
}
