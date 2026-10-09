/**
 * Pemilih izin per menu, dipindah dari `SettingAkunModal`.
 *
 * ## Kenapa pindah
 *
 * Dulu ini ada di tab "Pengguna" dalam dialog Pengaturan Akun, berdampingan
 * dengan pengaturan tema dan format tanggal. Dua concerns berbeda dalam satu
 * dialog: **preferensi** (milik satu orang) dan **izin** (keputusan admin
 * tentang orang lain). Layar pengaturan di pojok atas muncul di semua
 * halaman untuk semua pengguna — dan di dalamnya ada tabel yang hanya boleh
 * disentuh admin.
 *
 * Sekarang satu-satunya tempat mengubah izin adalah menu **Manajemen Akun**,
 * berdampingan dengan nama, peran, NIP, dan status akun. Satu tempat untuk
 * satu jenis keputusan.
 *
 * ## Yang dipertahankan
 *
 * - Izin **wajib** (Beranda, Presensi) tidak bisa dimatikan. Orang tanpa
 *   Beranda tidak punya tempat kembali ke daftar akun setelah logout.
 * - Izin khusus admin selalu dikunci. `batasiIzin()` di `userManager.ts` sudah
 *   memaksa `false`-nya untuk non-admin; disables di sini hanya agar
 *   antarmukanya tidak menawarkan sesuatu yang tidak akan berlaku.
 */
import { useMemo } from 'react';
import { Check, Lock, RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_USER_PERMISSIONS,
  PERMISSION_GROUPS,
  TAB_PERMISSION_LABELS,
  normalizeUserPermissions,
  type TabPermissions,
  type UserRole,
} from '../lib/userManager';

/**
 * Izin yang tidak boleh dimatikan.
 *
 * Beranda: setelah logout, dialihkan ke Beranda. Menonaktifkannya membuat
 *   orang terjebak di halaman yang tidak bisa ia cari jalan keluarnya.
 * Presensi: ini aplikasi absensi. Akun tanpa Presensi tidak punya alasan
 * sekarang.
 */
const IZIN_WAJIB: (keyof TabPermissions)[] = ['tabBeranda', 'tabPresensi'];

interface IzinAkunProps {
  nilai: TabPermissions;
  role: UserRole;
  onUbah: (nilai: TabPermissions) => void;
  /** Sembunyikan editor untuk admin — haknya sudah penuh. */
  readonly?: boolean;
}

export default function IzinAkun({ nilai, role, onUbah, readonly }: IzinAkunProps) {
  /*
   * Admin mendapat `DEFAULT_ADMIN_PERMISSIONS`, bukan `nilai` yang di state.
   *
   * Alasannya `setCurrentUser()` di `AppContext` juga begitu: admin yang
   * dokumennya secara tidak sengaja berisi `tabPresensi: false` akan punya daftar izin
   * berbeda dari yang sebenarnya berlaku, dan setiap pengetikan akan ditolak
   * tanpa penjelasan. Menampilkan keadaan sebenarnya lebih penting daripada
   * menampilkan apa yang tersimpan.
   */
  const efektif = useMemo(() => {
    if (role === 'admin' || readonly) return null;
    return normalizeUserPermissions(nilai as unknown as Record<string, unknown>);
  }, [nilai, role, readonly]);

  if (!efektif) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-950/30 p-3.5">
        <p className="text-xs font-bold text-violet-800 dark:text-violet-300 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          Akun admin tidak punya batasan izin
        </p>
      </div>
    );
  }

  const setSemua = (v: boolean) => {
    const berikut = { ...efektif } as Record<string, boolean>;
    for (const key of Object.keys(berikut)) {
      if (IZIN_WAJIB.includes(key as keyof TabPermissions)) continue;
      berikut[key] = v;
    }
    onUbah(berikut as unknown as TabPermissions);
  };

  const aktif = Object.entries(efektif).filter(
    ([key, v]) => v && !IZIN_WAJIB.includes(key as keyof TabPermissions)
  ).length;
  const total = Object.keys(efektif).length - IZIN_WAJIB.length;

  /**
   * Apakah masih persis sama dengan bawaan.
   *
   * `tabManajemenAkun` ikut dibandingkan meski tidak tampil: kalau nilainya
   * berubah tanpa terlihat, penanda "semua masih bawaan" akan berbohong.
   */
  const samaDefault = (Object.keys(efektif) as (keyof TabPermissions)[]).every(
    key => Boolean(efektif[key]) === Boolean(DEFAULT_USER_PERMISSIONS[key])
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Izin Menu &amp; Aksi
          </p>
          {/*
           * Penanda "default" — tanpa ini admin tidak bisa tahu izin mana yang
           * bawaan dan mana yang sudah diubah, jadi satu-satunya cara tahu
           * adalah mengingat. Label dan "Berubah" membuat
           * penyimpangan terlihat tanpa harus membandingkan.
           */}
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {samaDefault ? 'Semua izin masih bawaan' : 'Beberapa izin sudah diubah dari bawaan'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mr-1">
            {aktif}/{total} aktif
          </span>
          <TombolMini
            onClick={() => onUbah({ ...DEFAULT_USER_PERMISSIONS })}
            title="Kembalikan semua izin ke bawaan"
            disabled={samaDefault}
          >
            <RotateCcw className="w-3 h-3" />
          </TombolMini>
          <TombolMini onClick={() => setSemua(true)} title="Buka semua izin yang boleh diubah">
            <Check className="w-3 h-3" />
          </TombolMini>
          <TombolMini onClick={() => setSemua(false)} title="Tutup semua izin yang boleh diubah">
            <X className="w-3 h-3" />
          </TombolMini>
        </div>
      </div>

      {PERMISSION_GROUPS.map(group => {
        // `tabManajemenAkun` sengaja tidak ada di `PERMISSION_GROUPS`: ia
        // bukan izin yang bisa dianut, dan memunculkannya di sini hanya
        //isserie menawarkan sesuatu yang `batasiIzin()` akan menolaknya.
        const kunci = group.keys.filter(
          key => !(key === 'tabManajemenAkun' && role === 'admin')
        );
        if (kunci.length === 0) return null;
        return (
          <div key={group.label} className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {group.label}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {kunci.map(key => {
                const wajib = IZIN_WAJIB.includes(key);
                const nyala = efektif[key];
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={wajib}
                    onClick={() =>
                      onUbah({ ...efektif, [key]: !efektif[key] } as TabPermissions)
                    }
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                      wajib
                        ? 'bg-blue-50/70 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-900/60 dark:text-blue-300'
                        : nyala
                          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900/60 dark:text-emerald-400'
                          : 'bg-white text-slate-400 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-500'
                    }`}
                  >
                    <span className="min-w-0 truncate text-left">{TAB_PERMISSION_LABELS[key]}</span>
                    <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/10">
                      {wajib ? (
                        <>
                          <Lock className="w-2.5 h-2.5 inline -mt-0.5" /> WAJIB
                        </>
                      ) : nyala ? (
                        'ON'
                      ) : (
                        'OFF'
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TombolMini({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
