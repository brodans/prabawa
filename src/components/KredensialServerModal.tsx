import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { useToast } from './ui/Toast';
import { Alert, Field, Input, PasswordField } from './ui/Surface';
import { Modal } from './ui/Modal';
import {
  hapusServerCredential,
  ringkasanKredensial,
  saveServerCredential,
  type RingkasanKredensial,
} from '../lib/akunFirestore';
import { formatTanggalWaktuLokal } from '../lib/tanggal';

/**
 * Editor kredensial server pusat untuk satu akun panel — khusus admin.
 *
 * ## Kenapa perlu
 *
 * Auto-login membaca `jatim_pengaturan/kredensial_server__{username}`, yang
 * sekarang hanya bisa diisi oleh akunnya sendiri lewat halaman Beranda. Itu
 * berarti setiap akun harus login manual **sekali** sebelum auto-login bisa
 * bekerja — dan kalau banyak akun, itu banyak pekerjaan berulang.
 *
 * Menu ini memungkinkan admin mengisi NIP, password, dan IMEI untuk setiap
 * akun sekali saja. Setelah itu semua akun langsung tersambung sendiri saat
 * aplikasi dibuka, tanpa perlu login manual per akun.
 *
 * ## Password tidak pernah ada di peramban
 *
 * Dua lapis:
 *
 * 1. Yang dibaca dialog ini hanya `ringkasanKredensial()` — NIP, IMEI, dan
 *    boolean "password-nya masih bisa dipakai server". Tidak ada field
 *    password di respons mana pun.
 * 2. Enkripsi sekarang dilakukan **server**, dengan kunci turunan
 *    `PANEL_SESSION_SECRET` yang tidak pernah masuk bundle peramban.
 *
 * Semuanya `AES(password, VITE_APP_SECRET)` di peramban — kunci yang ada di
 * bundle, jadi siapa pun yang punya ciphertext bisa membukanya. Itu bukan
 * rahasia yang melindungi apa pun.
 *
 * #### Akibatnya untuk dialog ini
 *
 * Password yang sudah tersimpan harus diketik ulang admin bila ingin diganti.
 * Itu perilaku yang benar: penyimpanan password yang bisa dibaca balik berarti
 * plaintext ada di dalam sistem, dan di panel absensi ini orangnya banyak.
 */
export default function KredensialServerModal({
  username,
  onClose,
  onTersimpan,
}: {
  /** `null` menutup dialog. */
  username: string | null;
  onClose: () => void;
  onTersimpan: () => Promise<void>;
}) {
  const toast = useToast();
  const [tersedia, setTersedia] = useState<RingkasanKredensial | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [nip, setNip] = useState('');
  const [password, setPassword] = useState('');
  const [imei, setImei] = useState('');
  const [bekerja, setBekerja] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  /**
   * Penjaga double-submit, di luar state.
   *
   * ⚠️ `disabled={bekerja}` saja tidak cukup. `setBekerja(true)` baru
   * terlihat pada render **berikutnya**, jadi di antara klik pertama dan
   * render itu masih ada jendela di mana tombolnya belum `disabled` dan
   * penangan kedua bisa berjalan juga. Dua klik cepat (atau Enter lalu klik)
   * karena itu mengirim dua permintaan simpan: dua toast, dua pemuatan
   * ulang ringkasan, dan untuk `hapus` — dua penghapusan dengan satu konfirmasi.
   *
   * `useRef` menutup jendela itu karena ditulis dan dibaca di dalam satu
   * kilatan yang sama, tanpa menunggu render.
   */
  const sedangKerja = useRef(false);

  const muatKredensial = useCallback(async () => {
    if (!username) return;
    setMemuat(true);
    setGalat(null);
    try {
      const data = await ringkasanKredensial(username);
      setTersedia(data);
      setNip(data?.nip ?? '');
      setImei(data?.imei ?? '');
      setPassword('');
    } catch (err: any) {
      setGalat(err?.message ?? 'Gagal membaca kredensial server.');
    } finally {
      setMemuat(false);
    }
  }, [username]);

  useEffect(() => {
    if (!username) return;
    setNip('');
    setPassword('');
    setImei('');
    setTersedia(null);
    setGalat(null);
    void muatKredensial();
  }, [username, muatKredensial]);

  const simpan = async () => {
    if (!username) return;
    if (sedangKerja.current) return;
    if (!nip.trim()) {
      setGalat('NIP wajib diisi.');
      return;
    }
    /*
     * Password wajib diisi kalau belum ada yang tersimpan. Kalau sudah ada,
     * membiarkan kosong berarti "jangan diubah".
     *
     * `terbaca` — bukan "dokumennya ada" — yang diperiksa: kredensial format
     * lama yang tidak bisa dibuka server sama sekali tidak bisa dipertahankan,
     * jadi admin harus mengetik ulang password-nya. Menyelamatkannya di sini
     * hanya akan menunda auto-login gagal.
     */
    const tersimpanDanTerbaca = Boolean(tersedia?.terbaca);
    if (!password && !tersimpanDanTerbaca) {
      setGalat(
        tersedia
          ? 'Kredensial lama perlu ditulis ulang. Isi password server pusat di bawah.'
          : 'Password wajib diisi untuk kredensial baru.'
      );
      return;
    }
    sedangKerja.current = true;
    setBekerja(true);
    setGalat(null);
    try {
      /*
       * Password kosong = "jangan diubah".
       *
       * Ini mungkin karena server sekarang mengenkripsi sendiri: dokumennya
       * bisa disisipi sebagian, jadi NIP/IMEI yang dikoreksi **tidak** ikut
       * menimpa `passwordEncrypted` yang sudah ada.
       *
       * Dulu tidak bisa begitu — `saveServerCredential()` hanya menerima
       * plaintext dan mengenkripsi sendiri di peramban, jadi mengubah NIP
       * berarti password lama harus diketik ulang oleh admin. Admin yang
       * memperbaiki satu IMEI yang salah ketik jadi harus meminta password
       * server pusat setiap orang.
       *
       * ⚠️ Yang tidak berubah: password yang sudah tersimpan tidak pernah
       * bisa dibaca atau dikirim ulang. Kalau perlu diganti, diketik lagi.
       */
      await saveServerCredential(username, nip.trim(), password, imei.trim());
      toast.success(`Kredensial server untuk ${username} disimpan. Auto-login akan langsung aktif.`);
      await onTersimpan();
      onClose();
    } catch (err: any) {
      setGalat(err?.message ?? 'Gagal menyimpan kredensial server.');
    } finally {
      sedangKerja.current = false;
      setBekerja(false);
    }
  };

  const hapus = async () => {
    if (!username) return;
    if (sedangKerja.current) return;
    sedangKerja.current = true;
    setBekerja(true);
    setGalat(null);
    try {
      await hapusServerCredential(username);
      setTersedia(null);
      setNip('');
      setPassword('');
      setImei('');
      toast.success(`Kredensial server untuk ${username} dihapus.`);
      await onTersimpan();
      onClose();
    } catch (err: any) {
      setGalat(err?.message ?? 'Gagal menghapus kredensial server.');
    } finally {
      sedangKerja.current = false;
      setBekerja(false);
    }
  };

  if (!username) return null;

  return (
    <Modal
      open={Boolean(username)}
      onClose={onClose}
      title={`Kredensial Server — ${username}`}
      icon={<KeyRound className="w-5 h-5 text-blue-500" />}
      size="sm"
      footer={
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          {tersedia && (
            <button
              type="button"
              onClick={() => void hapus()}
              disabled={bekerja}
              className="sm:flex-1 py-2.5 rounded-xl border border-rose-200 dark:border-rose-900 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Hapus
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={bekerja}
            className="sm:flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void simpan()}
            disabled={bekerja || memuat}
            className="sm:flex-[2] py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            {bekerja ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Simpan
          </button>
        </div>
      }
    >
      {memuat ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {galat && <Alert tone="rose">{galat}</Alert>}

          {tersedia ? (
            <Alert tone="blue">
              Kredensial tersimpan sejak {formatTanggalWaktuLokal(tersedia.updatedAt)}.{' '}
              <strong>Password tidak bisa dibaca kembali</strong> — untuk mengubah NIP atau IMEI, isi ulang
              password di bawah.
            </Alert>
          ) : (
            <Alert tone="amber">
              Belum ada kredensial server untuk akun ini. Setelah diisi, <strong>{username}</strong> akan
              otomatis tersambung ke server pusat setiap kali aplikasi dibuka.
            </Alert>
          )}

          <Field label="NIP" hint="Nomor induk pegawai — dipakai sebagai `email` saat login server.">
            <Input
              value={nip}
              onChange={event => setNip(event.target.value.replace(/\s/g, ''))}
              placeholder="18 digit NIP, contoh 123456789012345678"
              className="font-mono"
              disabled={bekerja}
            />
          </Field>

          <Field
            label="Password Server"
            hint={
              tersedia?.terbaca
                ? 'Kosongkan kalau tidak ingin mengubahnya. NIP dan IMEI bisa diubah terpisah.'
                : tersedia
                  ? 'Kredensial ini perlu ditulis ulang — isikan password server pusat.'
                  : 'Disimpan terenkripsi di server, tidak pernah dibaca kembali.'
            }
          >
            <PasswordField
              value={password}
              onChange={value => setPassword(value.replace(/\s/g, ''))}
              placeholder={tersedia?.terbaca ? '•••••••• (tidak diubah)' : 'Password server pusat'}
              autoComplete="new-password"
              disabled={bekerja}
            />
          </Field>

          <Field
            label="IMEI / androidId"
            hint="Wajib kalau akun server ini terkunci ke satu perangkat. Kosongkan kalau tidak."
          >
            <Input
              value={imei}
              onChange={event => setImei(event.target.value)}
              placeholder="UUID perangkat"
              className="font-mono"
              disabled={bekerja}
            />
          </Field>

          <p className="text-[11px] text-slate-400 dark:text-slate-500 flex items-start gap-1.5 leading-relaxed">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Kredensial ini hanya dibaca browser untuk melakukan auto-login. Jangan pernah dibagikan di
            tempat publik.
          </p>
        </div>
      )}
    </Modal>
  );
}
