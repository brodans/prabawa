import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, Info, X, XCircle } from 'lucide-react';

/**
 * Modal & dialog konfirmasi milik sendiri.
 *
 * Semua konfirmasi di aplikasi ini lewat komponen ini — tidak ada
 * `window.confirm` / `window.alert` / `window.prompt` bawaan browser.
 * Dialog native tidak bisa diberi gaya, tidak bisa waited, memblokir
 * pengetikan di input yang sama, dan tampilannya berbeda tiap OS.
 *
 * ## Kenapa tanpa `motion/react`
 *
 * Modal ini tadinya memakai `AnimatePresence` + `motion.div`. Itu
 * terlalu berat untuk sesuatu yang dibuka terus-menerus, karena tiga hal:
 *
 * 1. `backdrop-blur-sm` pada overlay — `backdrop-filter` memaksa browser
 *    mengambil ulang dan mengaburkan seluruh isi layar **di setiap frame**.
 * 2. `scale` pada panel — `transform: scale()` memicu perhitungan ulang
 *    isi panel tiap frame; `translate` tidak.
 * 3. `AnimatePresence` menahan elemen di DOM sampai animasi keluar selesai,
 *    sehingga ada jeda terasa setiap kali modal ditutup.
 *
 * Sekarang: animasi masuk pakai keyframe CSS (`.modal-panel-enter`),
 * overlay tanpa blur, dan panel hanya dianimasikan dengan `translateY`.
 * Semuanya compositor-only. Modal langsung hilang saat ditutup — lebih
 * terasa responsif daripada menunggu animasi.
 *
 * `@media (prefers-reduced-motion)` di `index.css` menonaktifkan
 * animasinya bagi pengguna yang meminta pengurangan gerakan.
 */

/**
 * Kunci gulir halaman dengan penghitung.
 *
 * Diperlukan karena beberapa modal bisa bertumpuk (mis. dialog konfirmasi
 * di atas modal pemilih peta). Tanpa penghitung, modal yang menutup paling
 * dalam akan membuka gulir halaman padahal masih ada modal di atasnya.
 */
let kunciGulir = 0;
let overflowSebelum = '';

function kunciGulirHalaman(): void {
  if (kunciGulir === 0) {
    overflowSebelum = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  kunciGulir += 1;
}

function bukaGulirHalaman(): void {
  kunciGulir = Math.max(0, kunciGulir - 1);
  if (kunciGulir === 0) {
    document.body.style.overflow = overflowSebelum;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Modal dasar
// ═══════════════════════════════════════════════════════════════════════

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Ikon di sebelah judul. */
  icon?: ReactNode;
  /** Lebar maksimum, pakai class Tailwind. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  /** Aksi di footer; kalau kosong, tombol Tutup otomatis. */
  footer?: ReactNode;
  /** Sembunyikan tombol × di kanan atas. */
  hideClose?: boolean;
}

const SIZES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  icon,
  size = 'md',
  children,
  footer,
  hideClose = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  // `onClose` biasanya arrow function inline di pemanggil, jadi identitasnya
  // berubah tiap render. Kalau masuk ke dependensi `useEffect` di bawah,
  // efek akan berjalan ulang terus-menerus — setiap render memasang ulang
  // listener Escape, menulis ulang `overflow` body, dan memfokuskan panel
  // lagi. Itu penyebab modal terasa "nyangkut" saat dipakai.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Tutup dengan Escape, dan kunci gulir halaman di belakang.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    kunciGulirHalaman();

    // Fokuskan panel supaya screen reader dan keyboard masuk ke dialog.
    // `preventScroll` mencegah halaman ikut ter-scroll ke panel.
    panelRef.current?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      bukaGulirHalaman();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay-enter modal-layer fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-6 bg-slate-950/70"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(100%, calc(100vw - var(--dev-panel-right-offset, 0px) - 2rem))',
        }}
        className={`modal-panel-enter w-full ${SIZES[size]} max-h-[calc(100dvh-2rem)] flex flex-col bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl shadow-slate-950/30 overflow-hidden outline-none`}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <h3 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 min-w-0">
              {icon}
              <span className="truncate">{title}</span>
            </h3>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">{children}</div>

        <div className="shrink-0 px-5 py-3.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30">
          {footer ?? (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors"
            >
              Tutup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Dialog konfirmasi
// ═══════════════════════════════════════════════════════════════════════

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Isi pesan. Boleh ReactNode untuk paragraf tambahan. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` untuk aksi merusak (hapus, putuskan sesi). */
  tone?: 'default' | 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
  /** Tampilkan spinner di tombol konfirmasi. */
  loading?: boolean;
}

const CONFIRM_TONES = {
  default: {
    icon: <Info className="w-5 h-5" />,
    iconClass: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
    button: 'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500',
  },
  warning: {
    icon: <AlertTriangle className="w-5 h-5" />,
    iconClass: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
    button: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500',
  },
  danger: {
    icon: <XCircle className="w-5 h-5" />,
    iconClass: 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400',
    button: 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500',
  },
} as const;

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  tone = 'default',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const konf = CONFIRM_TONES[tone];

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      hideClose
      footer={
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="sm:flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`sm:flex-1 py-2.5 rounded-xl text-white text-xs font-bold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 ${konf.button}`}
          >
            {loading ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex gap-3.5">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${konf.iconClass}`}>
          {konf.icon}
        </div>
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</p>
          <div className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{message}</div>
        </div>
      </div>
    </Modal>
  );
}
