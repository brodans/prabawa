/**
 * Kit komponen kecil yang dipakai bersama oleh seluruh halaman.
 *
 * Sengaja dibuat statis (bukan konfigurasi Tailwind) supaya konsisten
 * dengan gaya glassmorphism + rounded-2xl yang dipakai App.tsx.
 */

import {
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  Inbox,
  Info,
  Loader2,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════
//  Judul halaman
// ═══════════════════════════════════════════════════════════════════════

export function PageHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="w-11 h-11 rounded-2xl bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/10">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-slate-100 tracking-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {/*
       * ⚠️ `flex-wrap` **dan** `shrink-0` — keduanya wajib, dan alasan keduanya
       * berbeda.
       *
       * `flex-wrap`: kelompok aksi pernah lewat tiga tombol. Empat tombol
       * "Muat Ulang, Cetak, Excel, CSV" totaled ±354 px, dan di layar 360 px
       * yang tersedia hanya 328 px — tombol terakhir terdorong keluar viewport
       * tanpa ada yang memberi tahu.
       *
       * `shrink-0`: tanpa itu, yang ditekan lebih dulu adalah **tombolnya**,
       * bukan judul. Judul sudah punya `min-w-0` + `truncate`, jadi aman
       * menyusut; tombol tidak — label "Muat Ulang" lalu turun ke dua baris di
       * dalam tombol setinggi 30 px, dan terakhir hurufnya terpotong. Itu
       * tampilan yang paling sering dilaporkan sebagai "mepet di kanan".
       *
       * `sm:justify-end` menjaga keselarasan kanan di layar lebar, saat tidak
       * ada yang perlu membungkus.
       */}
      {action && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{action}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Kartu / panel
// ═══════════════════════════════════════════════════════════════════════

export function Card({
  children,
  className = '',
  padded = true,
  ref,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  /** Dipakai halaman Pengaturan untuk menggulir ke card password. */
  ref?: React.Ref<HTMLElement>;
}) {
  return (
    <section
      ref={ref}
      className={`bg-white dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl shadow-sm ${padded ? 'p-5 sm:p-6' : ''} ${className}`}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">{children}</h2>
      {action}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Statistik
// ═══════════════════════════════════════════════════════════════════════

const TILE_TONES = {
  blue: 'from-blue-500/10 to-blue-500/0 text-blue-600 dark:text-blue-400',
  emerald: 'from-emerald-500/10 to-emerald-500/0 text-emerald-600 dark:text-emerald-400',
  amber: 'from-amber-500/10 to-amber-500/0 text-amber-600 dark:text-amber-400',
  rose: 'from-rose-500/10 to-rose-500/0 text-rose-600 dark:text-rose-400',
  violet: 'from-violet-500/10 to-violet-500/0 text-violet-600 dark:text-violet-400',
  slate: 'from-slate-500/10 to-slate-500/0 text-slate-600 dark:text-slate-400',
} as const;

export type TileTone = keyof typeof TILE_TONES;

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: TileTone;
}) {
  return (
    <div
      className={`rounded-2xl bg-gradient-to-br ${TILE_TONES[tone]} border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 p-4 shadow-sm`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-bold font-mono text-slate-800 dark:text-slate-100 truncate">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">{hint}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Tombol
// ═══════════════════════════════════════════════════════════════════════

export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 active:translate-y-0',
  secondary:
    'bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700',
  ghost:
    'bg-transparent text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  warning: 'bg-amber-500 text-white hover:bg-amber-600',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-xl',
  lg: 'px-6 py-3.5 text-sm gap-2 rounded-xl',
};

/**
 * Kelas dasar tombol.
 *
 * Diekstrak supaya komponen yang membuat tombolnya sendiri — `TombolMenu`
 * — warnanya sama persis, bukan "hampir sama".
 */
export function gayaTombol(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return `${VARIANTS[variant]} ${SIZES[size]}`;
}

/*
 * ⚠️ `ref` ikut menjadi prop biasa.
 *
 * `TombolMenu` harus tahu posisi tombolnya supaya panelnya bisa ditempelkan
 * tepat di bawahnya — seperti yang dilakukan `AksiMenu` dan `DatePicker`.
 * Tanpa `ref` yang diteruskan, satu-satunya jalan adalah `forwardRef`, dan
 * `forwardRef` sendiri tidak lagi perlu sejak React 19.
 */
interface ActionButtonProps extends React.ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

/*
 * ⚠️ `whitespace-nowrap` + `shrink-0` di dalam `className` — bukan detail tampilan.
 *
 * Tombol adalah flex item di hampir setiap baris aksi di aplikasi ini. Tanpa
 * `whitespace-nowrap`, ruang yang kurang sedikit membuat label turun ke baris
 * kedua **di dalam tombol**: tombol setinggi 30 px berisi dua baris teks 12 px,
 * dan huruf terakhir bisa terpotong. Tanpa `shrink-0`, tombol ikut menyusut
 * lebih dulu daripada teks di sebelahnya — padahal teks itu sudah punya
 * `truncate` yang tahu harus memotong dirinya sendiri.
 *
 * Dua kelas inilah yang membuat baris aksi tidak pernah "mepet di kanan".
 */
export function ActionButton({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  className = '',
  children,
  disabled,
  ...rest
}: ActionButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 whitespace-nowrap shrink-0 ${gayaTombol(variant, size)} ${block ? 'w-full' : ''} ${className}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Form
// ═══════════════════════════════════════════════════════════════════════

const FIELD_BASE =
  'block w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all disabled:opacity-50';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  /**
   * Pesan error di bawah field.
   *
   * ⚠️ `error` tidak sekadar info: kalau ada, `aria-invalid` ikut dipasang
   * supaya pembaca layar membacanya sebagai error, bukan teks biasa. Field
   * yang isinya salah tapi tidak ditandai apa pun adalah form yang Waters
   * menebak-nebak.
   */
  error?: string;
  /** Tampilkan tanda bintang merah setelah label. */
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ml-1">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
      {/*
        Error menang atas hint. Menampilkan keduanya berarti field yang salah
        juga menampilkan penjelasannormalnya — dua pesan untuk satu field, dan
        yang salah justru yang tenggelam.
      */}
      {error ? (
        <p role="alert" className="text-[11px] text-rose-500 dark:text-rose-400 ml-1">
          {error}
        </p>
      ) : (
        hint && <p className="text-[11px] text-slate-400 dark:text-slate-500 ml-1">{hint}</p>
      )}
    </div>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${FIELD_BASE} ${className}`} />;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${FIELD_BASE} resize-y min-h-[88px] ${className}`} />;
}

/**
 * Input angka dengan tombol naik/turun.
 *
 * ## Kenapa bukan `<Input type="number">`
 *
 * `type="number"` bawaan browser punya tiga masalah yang langsung terasa di HP
 * yang jadi target utama aplikasi ini:
 *
 * 1. **Spinner-nya muncul sebagai teks** (`1.0e3`) saat nilainya belum diparse
 *    — terutama di Android dan iOS. `Number("1.0e3")` menghasilkan 1, bukan
 *    1000, jadi harga paket bisa tersimpan seribu kali lebih murah.
 * 2. **Formatnya mengikuti locale.** Ketik `25000` di perangkat yang memakai
 *    koma sebagai desimal, dan apa yang terkirim bisa jadi `25000` atau
 *    `25000.0` tergantung peramban. Karena harga disimpan sebagai **angka
 *    rupiah penuh** (tanpa pembatas ribuan), satu karakter yang salah = harga
 *    salah.
 * 3. **Spinners hanya di desktop.** Di layar sentuh tidak ada cara menaikkan
 *    nilai kecuali mengetik — padahal yang paling sering dipakai admin adalah
 *    menaikkan harga.
 *
 * Yang di sini: input `text` biasa dengan `inputMode="numeric"`, difilter
 * supaya hanya digit, ada tombol `+`/`-`, dan `min`/`max` ditegakkan di
 * tombol maupun saat mengetik. Tidak ada scrolling nilai, tidak ada `e`, tidak
 * ada spinner.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  placeholder,
  className = '',
  'aria-label': ariaLabel,
  prefix,
  format,
  hideSteppersBelowSm = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  /** Teks tetap di kiri input, mis. `"Rp"`. */
  prefix?: string;
  /** Sembunyikan tombol naik/turun pada layar sempit agar input tetap terbaca. */
  hideSteppersBelowSm?: boolean;
  /**
   * Format tampilan, mis. `formatRuang` untuk `100000` → `"100.000"`.
   *
   * ⚠️ **Hanya tampilan.** Nilai yang diketik dan disimpan tetap angka
   * polos: `onChange` menerima hasil `Number(bersih)` seperti biasa, dan
   * `dariTeks` tetap membuang semua yang bukan digit. Jadi menampilkan
   * titik ribuan tidak membuat "100.000" tersimpan sebagai seribu —
   * yang terjadi kalau orang mengetik titik dengan tangan.
   */
  format?: (value: number) => string;
}) {
  /** Jaga agar selalu di dalam [min, max] dan bulat. */
  const kunci = (n: number): number => {
    let hasil = Number.isFinite(n) ? n : (min ?? 0);
    if (Number.isInteger(step)) hasil = Math.round(hasil);
    if (min !== undefined) hasil = Math.max(min, hasil);
    if (max !== undefined) hasil = Math.min(max, hasil);
    return hasil;
  };

  /** Buang semua yang bukan digit. Satu-satunya tempat filter ini hidup. */
  const dariTeks = (teks: string) => {
    const bersih = teks.replace(/\D/g, '');
    if (bersih === '') {
      // Kosongkan = belum mengetik. Jangan dipaksa 0 — `min` sering 1, dan
      // menulis 0 di field "durasi" menghasilkan paket yang tidak bisa
      // dipakai tanpa disadari.
      onChange(min ?? 0);
      return;
    }
    onChange(kunci(Number(bersih)));
  };

  const naik = () => onChange(kunci(value + step));
  const turun = () => onChange(kunci(value - step));

  return (
    <div className={`flex items-stretch gap-1.5 ${className}`}>
      {prefix && (
        <span
          className="flex items-center rounded-xl border border-r-0 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0"
          aria-hidden="true"
        >
          {prefix}
        </span>
      )}
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        // `autoComplete="off"` supaya keyboard mobile tidak suggested
        // mengisi harga dengan nilai yang pernah diketik di form lain.
        autoComplete="off"
        value={
          Number.isFinite(value) && value > 0
            ? (format ? format(Math.round(value)) : String(Math.round(value)))
            : ''
        }
        onChange={event => dariTeks(event.target.value)}
        onFocus={event => event.currentTarget.select()}
        onBlur={event => dariTeks(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            naik();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            turun();
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`font-mono tabular-nums ${prefix ? 'rounded-l-none text-left' : 'text-center'}`}
      />
      {!disabled && (
        <div className={`flex flex-col gap-1 shrink-0 ${hideSteppersBelowSm ? 'hidden sm:flex' : ''}`}>
          <StepButton
            onClick={naik}
            disabled={max !== undefined && value >= max}
            label={`Tambah ${step}`}
            dir="up"
          />
          <StepButton
            onClick={turun}
            disabled={min !== undefined && value <= min}
            label={`Kurangi ${step}`}
            dir="down"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Kotak centang.
 *
 * ## Kenapa bukan `<input type="checkbox">`
 *
 * `accent-*` ikut warna **sistem operasi**, bukan tema aplikasi. Kotak yang
 * sama tampil biru di Windows, hijau di Android, dan biru muda di iOS — jadi
 * "tampilan" aplikasi berubah tergantung perangkat, persis yang swore
 * dihindari di komponen lain.
 *
 * Kotak centang asli juga berukuran berbeda per platform, dan di layar sentuh
 * target sentuhnya kecil: di iOS hanya sekitar 20 px, jauh di bawah 44 px
 * yangDisconnect. Yang di sini adalah kotak yang benar-benar diklik sendiri
 * (bukan cuma `accent-*`), dan seluruh baris label ikut bisa diklik.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  tone = 'blue',
  disabled,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  /** `rose` untuk tindakan yang menonaktifkan sesuatu. */
  tone?: 'blue' | 'rose' | 'emerald';
  disabled?: boolean;
  className?: string;
}) {
  const aktif = {
    blue: 'bg-blue-600 border-blue-600',
    rose: 'bg-rose-600 border-rose-600',
    emerald: 'bg-emerald-600 border-emerald-600',
  }[tone];

  return (
    <label
      className={`flex items-start gap-2.5 select-none ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <span className="relative shrink-0 mt-px">
        {/*
         * `<input>` disembunyikan dengan `sr-only`, bukan dihapus: tanpa
         * elemen itu, pembaca layar tidakagnonolo mengumuman "kotak centang"
         * dan state-nya tidak bisa diuji. Yang diklik adalah `<span>` di
         * atasnya; input tetap di DOM hanya untuk semantik & aksesibilitas.
         */}
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`block w-[18px] h-[18px] rounded-md border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/40 peer-focus-visible:ring-offset-1 ${
            checked ? aktif : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
          }`}
        >
          {checked && (
            <Check className="w-3 h-3 ml-[3px] mt-[3px] text-white" strokeWidth={3.5} />
          )}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        {hint && (
          <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * Field password dengan tombol lihat/sembunyikan.
 *
 * ## Kenapa komponen, bukan `<Input type="password">` + tombol seadanya
 *
 * Tombolnya sudah ditulis ulang di lima tempat (Beranda, LoginScreen,
 * SettingAkunModal ×2, ProfilServerModal, ManajemenAkun) dan setiap tulisan
 * sedikit berbeda: ukuran `p-2` atau
 * `p-1.5`, `right-1` atau `right-3`, satu yang lupa `aria-label`.
 *
 * Yang paling penting bukan keseragaman, tapi **penyejajaran**: di sebagian
 * versi `top-1/2` + `-translate-y-1/2` tidak ada, sehingga tombol mata tidak
 * lagi sejajar dengan field dan meleset beberapa piksel ke bawah — cukup jauh
 * untuk tidak bisa diklik di layar sentuh.
 *
 * Di sini satu implementasi: posisinya benar, ukurannya memenuhi target
 * sentuh, dan `aria-pressed` ikut berubah supaya pembaca layar tahu keadaan
 * saat ini.
 */
export function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  maxLength,
  disabled,
  className = '',
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const [lihat, setLihat] = useState(false);
  return (
    <div className={`relative ${className}`}>
      <Input
        type={lihat ? 'text' : 'password'}
        value={value}
        onChange={event => {
          const next = event.target.value;
          onChange(maxLength ? next.slice(0, maxLength) : next);
        }}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-label={ariaLabel}
        // `pr-11` menyisakan ruang untuk tombol mata. Tanpa itu teks sandi
        // panjang menimpa ikon dan tombolnya tidak bisa diklik.
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setLihat(prev => !prev)}
        disabled={disabled}
        aria-label={lihat ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
        aria-pressed={lihat}
        title={lihat ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
      >
        {lihat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function StepButton({
  onClick,
  disabled,
  label,
  dir,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  dir: 'up' | 'down';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-8 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-1 flex items-center justify-center"
    >
      {dir === 'up' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Status
// ═══════════════════════════════════════════════════════════════════════

const BADGE_TONES = {
  slate: 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600',
  blue: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
  emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
  amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
  rose: 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20',
  violet: 'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-500/20',
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Kotak informasi dengan warna sesuai nada.
 *
 * ## Ikon ikut nadanya — bukan selalu tanda peringatan
 *
 * Versi ini selalu menggambar `AlertCircle` apa pun nadanya, sehingga
 * `tone="blue"` (memberi tahu) dan `tone="emerald"` (kabar baik) tetap tampil
 * dengan segitiga peringatan di sebelah kirinya. Pemanggil yang memang
 * butuh ikon sendiri lalu menambahkan ikon kedua di dalam `children` —
 * hasilnya **dua tanda peringatan untuk satu kalimat**.
 *
 * Di halaman Presensi itu yang terlihat:
 *
 *     Waktu sekarang 08:56 WIB - jadwal (JATIM) PEMPROV 5 HARI KERJA
 *     berada di dalam rentang jam kerja.
 *
 * tampil dengan segitiga peringatan *dan* ikon info, padahal kalimat itu
 * kabar biasa, bukan peringatan.
 *
 * Karena itu ikon sekarang ditentukan oleh nada:
 *
 * | nada      | ikon          | artinya                 |
 * |-----------|---------------|-------------------------|
 * | `amber`   | `AlertCircle` | perlu-hatian            |
 * | `rose`    | `CircleAlert` | gagal                   |
 * | `blue`    | `Info`        | memberi tahu, netral    |
 * | `emerald` | `CircleCheck` | berhasil / dalam aturan |
 *
 * `icon={false}` mematikan ikon untuk pemanggil yang tidak butuh ikon sama
 * sekali; `icon={<...>}` untuk ikon kustom.
 */
export function Alert({
  children,
  tone = 'amber',
  icon,
}: {
  children: ReactNode;
  tone?: 'amber' | 'rose' | 'blue' | 'emerald';
  /** Ikon kustom, atau `false` untuk mematikan ikon bawaan. */
  icon?: ReactNode | false;
}) {
  const tones = {
    amber: 'bg-amber-50/80 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400',
    rose: 'bg-rose-50/80 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400',
    blue: 'bg-blue-50/80 border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/20 dark:text-blue-400',
    emerald:
      'bg-emerald-50/80 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400',
  } as const;

  const bawaan = {
    amber: <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />,
    rose: <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />,
    blue: <Info className="w-4 h-4 shrink-0 mt-0.5" />,
    emerald: <CircleCheck className="w-4 h-4 shrink-0 mt-0.5" />,
  } as const;
  const ikon = icon === false ? null : (icon ?? bawaan[tone]);

  return (
    <div className={`flex items-start gap-2.5 p-3.5 rounded-xl text-sm font-medium border ${tones[tone]}`}>
      {ikon}
      <span className="leading-relaxed break-words">{children}</span>
    </div>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
        <Inbox className="w-6 h-6 text-slate-400 dark:text-slate-500" />
      </div>
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{message}</p>
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 max-w-sm">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-slate-200/70 dark:bg-slate-700/60 ${className}`}
    />
  );
}

export function SkeletonTable({ columns = 6, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Memuat tabel">
      <div
        aria-hidden="true"
        className="grid gap-3 border-b border-slate-200 dark:border-slate-700 px-3 pb-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 w-3/4" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          aria-hidden="true"
          className="grid items-center gap-3 rounded-xl border border-slate-100 dark:border-slate-700/60 px-3 py-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              className={`h-3 ${column === 0 ? 'w-4/5' : column === columns - 1 ? 'w-1/2' : 'w-3/5'}`}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Memuat data...</span>
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Memuat daftar">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-3"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
      <span className="sr-only">Memuat data...</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Tabel
// ═══════════════════════════════════════════════════════════════════════

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T, index: number) => ReactNode;
  className?: string;
  /**
   * Kolom ini jadi **judul kartu** di layar sempit.
   *
   * Default: kolom pertama yang punya header. Judul tidak diberi label
   * "Pegawai:" di atasnya — nama orang sudah jelas tanpa kata sandaran.
   */
  mobileTitle?: boolean;
}

/**
 * Toleransi pembulatan piksel saat membandingkan min-content tabel dengan
 * lebar wadah. Tanpa ini tabel bisa tertukar ke kartu karena selisih
 * pecahan satu piksel dari `getBoundingClientRect`.
 */
const TOLERANSI_PX = 2;

/**
 * Min-content tabel, diukur dari DOM — bukan ditebak dari daftar breakpoint.
 *
 * `width: min-content` pada wadah pengukuran memaksa browser menyelesaikan
 * masalah intrinsik yang sama persis dengan yang terjadi saat tabel dipaksa
 * menggulir horizontal. Hasilnya adalah lebar tabel paling sempit yang masih
 * tidak memotong isi kolom mana pun.
 *
 * Tabel asli tidak bisa diukur begitu saja: ia diberi `w-full` supaya melebar
 * mengisi wadah, sehingga `offsetWidth`-nya selalu sebesar wadah, bukan
 * sebesar min-content-nya. Karena itu yang diukur adalah **klon** yang
 * dititipkan sebentar di luar layar lalu langsung dibuang.
 *
 * `width` pada klon sengaja ditimpa jadi `auto`: `w-full` bersifat relatif
 * terhadap wadahnya, dan di dalam wadah `min-content` itu membentuk
 * lingkaran. Dengan `auto`, min-content tabel ikut menentukan lebar wadah,
 * persis seperti saat tabel dirender sungguhan.
 */
function ukurMinContentTabel(tabel: HTMLElement): number {
  const wadah = document.createElement('div');
  wadah.setAttribute('aria-hidden', 'true');
  wadah.style.cssText =
    'position:fixed;left:-99999px;top:0;width:min-content;pointer-events:none;visibility:hidden;';
  const klon = tabel.cloneNode(true) as HTMLElement;
  /*
   * Klon hidup di luar React, jadi ia tidak punya `ownerDocument` yang
   * sama dengan event handler. Id pun disalin mentah; dua elemen ber-id sama
   * di satu dokumen bisa membuat `aria-controls` dan label melompat ke
   * klon yang akan dibuang sebentar lagi.
   */
  klon.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  klon.style.width = 'auto';
  wadah.appendChild(klon);
  document.body.appendChild(wadah);
  const lebar = wadah.getBoundingClientRect().width;
  wadah.remove();
  return Math.ceil(lebar);
}

/**
 * Tabel data, dengan tampilan kartu untuk layar sempit.
 *
 * ## Kenapa bukan `overflow-x-auto` saja
 *
 * Semula satu-satunya penanganan layar sempit adalah `min-w-[640px]` di dalam
 * `overflow-x-auto`. Di HP 360 px tabel laporan lebar 692 px berada di dalam
 * wadah 316 px — jadi pengguna harus menggulir **horizontal** untuk melihat
 * kolom "Jarak" dan "Persetujuan", dan tidak ada satu pun petunjuk bahwa ada
 * kolom di luar layar. Kolom paling kanan justru yang paling sering dilewati,
 * dan itu kolom yang paling jarang dibaca.
 *
 * ## Kenapa diukur, bukan breakpoint
 *
 * Breakpoint viewport **tidak bisa** dijadikan penentu, karena dua alasan
 * yang keduanya terbukti dari pengukuran, bukan dari bulatan.
 *
 * **Satu. Min-content tiap tabel berbeda jauh.** Angka di bawah diukur di DOM
 * dengan `width: min-content`, memakai data terburuk (nama dan departemen
 * sepanjang), bukan satu baris contoh:
 *
 * | tabel            | min-content |
 * |------------------|-------------|
 * | Laporan          | 629 px      |
 * | Perizinan        | 817 px      |
 * | Riwayat Izin     | 994 px      |
 *
 * Ambang yang benar untuk Laporan membuat tabel Riwayat Izin tetap tergulir
 * horizontal di viewport yang sama. Dan begitu ada satu kolom baru, angka itu
 * basi — tidak ada cara memperbaruinya tanpa menyentuh `DataTable`.
 *
 * **Dua. Lebar wadah tidak monoton terhadap lebar viewport.** Sidebar melebar ke
 * `w-64` tepat pada `lg` (1024 px), jadi wadah justru **lebih sempit** di 1024
 * px daripada di 768 px:
 *
 * | viewport | sidebar | isi kartu | lebar wadah | min-content Laporan |
 * |----------|---------|-----------|-------------|---------------------|
 * | 640 px   | 84 px   | `p-5`     | 532 px      | 629 px → 97 px terpotong |
 * | 768 px   | 84 px   | `p-6`     | 660 px      | 629 px → pas         |
 * | 1024 px  | **256 px** | `p-6`  | **644 px**  | 629 px → pas         |
 *
 * Jendela peramban yang dikecilkan juga menggeser lebarnya tanpa menyentuh
 * breakpoint sama sekali. Keduanya mustahil dicek oleh CSS murni.
 *
 * Jadi `DataTable` mengukur sendiri: `useLayoutEffect` memuat min-content tabel
 * lewat klon tersembunyi, membandingkannya dengan lebar wadah sebenarnya, dan
 * `ResizeObserver` mengulang pengukuran tiap kali wadah berubah. Tabel tampil
 * kalau **muat**, kartu kalau tidak. Judul kartu dan isi tabel tetap dibangun
 * dari `columns` yang sama, jadi tidak ada daftar kolom kedua yang bisa
 * menyimpang — yang diukur hanyalah **kapan** tabel ditampilkan.
 *
 * Sisa ruang kolom "Pegawai" sengaja dibiarkan `truncate` — nama yang lebih
 * panjang dari ~30 huruf lebih baik terpotong elipsis daripada membuat seluruh
 * tabel bergeser ke kanan.
 *
 * ## Kolom teks panjang wajib punya plafon `max-width`
 *
 * `truncate` sendirian **tidak membatasi apa pun**. Di `table-layout: auto`,
 * min-content sebuah sel tetap sebesar teks penuhnya, karena `white-space:
 * nowrap` tidak pernah membungkus — jadi `overflow: hidden` +
 * `text-overflow: ellipsis` tidak punya apa pun untuk dipotong. Di Laporan,
 * nama + departemen sepanjang membuat kolom Pegawai melebar 277 px dan tabel
 * 686 px, melebihi wadah 644 px di 1024 px.
 *
 * Yang benar-benar menurunkan min-content hanyalah `max-width` pada
 * `Column.className`: `min-w-0` di dalam sel, begitu juga `max-w-0 w-full`,
 * keduanya tetap mengukur teks penuh. Karena itu setiap kolom ber-`truncate`
 * yang tidak dikunci lebarnya harus diberi plafon.
 *
 * Kartu dirender dari `columns` yang **sama** dengan tabelnya — tidak ada
 * daftar kolom kedua yang bisa menyimpang.
 *
 * ## Mengukur ulang
 *
 * Pengukuran dipicu ulang bukan hanya saat ukuran wadah berubah, tapi juga
 * saat `rows` atau `columns` berganti object — isi baris ikut menentukan
 * min-content, jadi tabel yang tadinya muat bisa tidak muat setelah disaring
 * lebih ketat. `ResizeObserver` saja tidak menangkap itu.
 *
 * ## Cetak
 *
 * `print:hidden` / `print:!block` ada karena keputusan kartu-versus-tabel di
 * atas mengevaluasi lebar *wadah layar*, sedangkan media query cetak
 * mengevaluasi lebar *kertas*. Tanpa itu, mencetak dari jendela browser yang
 * sempit akan mencetak kartu, bukan tabel.
 */
export function DataTable<T>({
  columns,
  rows,
  keyOf,
  emptyMessage = 'Belum ada data.',
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T, index: number) => string;
  emptyMessage?: string;
}) {
  const wadahRef = useRef<HTMLDivElement>(null);
  const tabelRef = useRef<HTMLTableElement>(null);
  const ukurRef = useRef<() => void>(() => {});
  const [muatTabel, setMuatTabel] = useState(false);

  /*
   * Tabel ditampilkan kalau min-content-nya benar-benar muat di wadah.
   * Default `false` (kartu) dipilih supaya render pertama di layar sempit
   * tidak sempat menampilkan tabel yang meluber; `useLayoutEffect` di bawah
   * membetulkan sebelum browser menggambar.
   */
  useLayoutEffect(() => {
    ukurRef.current = () => {
      const wadah = wadahRef.current;
      const tabel = tabelRef.current;
      if (!wadah || !tabel) return;
      /*
       * Wadah sedang disembunyikan (mis. tab lain yang aktif, atau belum
       * selesai transisi). `clientWidth` 0 bukan berarti tabel tidak muat,
       * jadi pengukuran ini diabaikan — bukan dianggap "tidak muat".
       */
      const tersedia = wadah.clientWidth;
      if (tersedia <= 0) return;
      setMuatTabel(ukurMinContentTabel(tabel) <= tersedia + TOLERANSI_PX);
    };
    ukurRef.current();
    const wadah = wadahRef.current;
    if (!wadah) return;
    const ro = new ResizeObserver(() => ukurRef.current());
    ro.observe(wadah);
    // Web font baru bisa mengubah min-content setelah tabel dirender.
    void document.fonts?.ready.then(() => ukurRef.current());
    return () => ro.disconnect();
  }, []);

  // Data atau susunan kolom berubah → angka min-content lamanya sudah basi.
  useLayoutEffect(() => {
    ukurRef.current();
  }, [rows, columns]);

  /*
   * Judul kartu: kolom yang ditandai `mobileTitle`, atau kolom pertama yang
   * punya header. Fallback "semua kolom punya label" dipakai supaya tabel
   * yang kolom pertamanya tidak bergelar (mis. kolom aksi di depan) tidak
   * kehilangan kolomnya di kartu.
   */
  const judulKey =
    columns.find(column => column.mobileTitle && column.header)?.key ??
    columns.find(column => column.header)?.key ??
    columns[0]?.key;
  const judul = columns.find(column => column.key === judulKey);
  const sisa = columns.filter(column => column.key !== judulKey);
  /** Kolom tanpa header = kolom aksi; di kartu tidak perlu label. */
  const aksi = sisa.filter(column => !column.header);
  const berlabel = sisa.filter(column => column.header);

  if (rows.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <div ref={wadahRef}>
      {/* ── Wadah sempit: kartu ────────────────────────────────────── */}
      <ul
        className={`${muatTabel ? 'hidden ' : ''}space-y-3 print:hidden`}
        aria-hidden={muatTabel}
      >
        {rows.map((row, index) => (
          <li
            key={keyOf(row, index)}
            className="rounded-xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-900/40 p-4 space-y-2"
          >
            {judul && (
              <div className="min-w-0 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
                {judul.render(row, index)}
              </div>
            )}
            <dl className="divide-y divide-slate-100 dark:divide-slate-800">
              {berlabel.map(column => (
                <div
                  key={column.key}
                  className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <dt className="min-w-0 break-words pt-0.5 text-[10px] font-bold uppercase leading-relaxed tracking-wider text-slate-500 dark:text-slate-400">
                    {column.header}
                  </dt>
                  <dd className="min-w-0 text-right text-sm text-slate-600 dark:text-slate-300">
                    {column.render(row, index)}
                  </dd>
                </div>
              ))}
            </dl>
            {aksi.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {aksi.map(column => (
                  <span key={column.key} className="inline-flex">
                    {column.render(row, index)}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* ── Wadah cukup lebar: tabel ───────────────────────────────── */}
      {/*
       * `print:!block` ikut meng-override visibility berbasis JS: media query
       * cetak mengevaluasi lebar kertas, sedangkan keputusan di atas
       * mengevaluasi lebar wadah layar. Tanpa override ini, mencetak dari
       * jendela sempit akan mencetak kartu, bukan tabel.
       */}
      <div
        className={`${muatTabel ? '' : 'hidden '}overflow-x-auto -mx-5 px-5 sm:-mx-6 sm:px-6 print:!block print:mx-0 print:px-0 custom-scrollbar`}
        aria-hidden={!muatTabel}
      >
        {/*
         * `min-w` **bukan** penentu lebar sebenarnya — hanya lantai. Yang
         * menentukan adalah jumlah `min-content` kolom, dan itu berbeda tiap
         * tabel (Laporan 629 px). Jadi lantai ini sengaja longgar: kalau
         * `min-w` ikut menentukan, setiap tabel harus menyetelnya sendiri dan
         * nilai itu cepat basi begitu ada satu kolom baru.
         */}
        <table ref={tabelRef} className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              {columns.map(column => (
                <th
                  key={column.key}
                  className={`px-2.5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 ${column.className ?? ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={keyOf(row, index)}
                className="border-b border-slate-100 dark:border-slate-800/70 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
              >
                {columns.map(column => (
                  <td
                    key={column.key}
                    className={`px-2.5 py-3 text-sm text-slate-600 dark:text-slate-300 align-top ${column.className ?? ''}`}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
