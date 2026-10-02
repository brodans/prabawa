import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { SHORT_MONTHS_ID, getTodayWIB } from '../../lib/dateFormatter';

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  max?: string;
  min?: string;
  disabled?: boolean;
  className?: string;
}

/** Konversi YYYY-MM-DD → Date lokal tanpa pergeseran timezone. */
function parseLocal(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const WEEKDAYS_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

const MONTHS_FULL_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/** Jumlah tahun di grid pemilih tahun (3 kolom × 4 baris). */
const TAHUN_PER_GRID = 12;

/** Lebar panel popup. */
const POPUP_WIDTH = 290;
const EST_HEIGHT = 360;
const GAP = 4;
const MARGIN = 8;

type PanelView = 'days' | 'months' | 'years';

interface SelisihHari {
  day: number;
  isCurrentMonth: boolean;
  date: Date;
}

/**
 * Kalender beserta pemilih bulan & tahun.
 *
 * ## Kenapa hanya ada satu gaya
 *
 * Semula ada dua: "modern" (panel penuh) dan "klasik" (panel ringkas, bulan
 * disingkat jadi "Jan"). Gaya klasik beserta prefs-nya sudah **dihapus** —
 * permintaan eksplisit, dan juga karena keduanya tidak pernah benar-benar
 * berbeda secara fungsi: pem'affiche bulan dan tahun di panel modern sudah
 * berupa grid 3 kolom, jadiIH tidak ada dropdown bertingkat yang perlu
 * dihindari.
 *
 * Yang tersisa hanya satu jalur, tanpa prefs di `sessionStorage` dan tanpa
 * pembacaan `useAppContext` — jadi setiap `DatePicker` di aplikasi memakai
 * tampilan yang sama, dan tidak ada yang bisa tersimpan dengan versi lama.
 *
 * ## Kenapa popup-nya di-portal
 *
 * Popup ini pernah `absolute` di dalam tombolnya. Dua masalah nyata:
 *
 * 1. **Terpotong di dalam modal.** `Modal` memberi `overflow-y-auto` pada
 *    bodynya, dan `DatePicker` dipakai di form Perizinan yang berada di
 *    dalam modal — jadi kalender terpotong tepat di tepi panel.
 * 2. **Tidak tahu posisi scroll.** `absolute` diposisikan relatif elemen
 *    yang memuatnya, sehingga tidak bisa menampilkan diri ke atas saat
 *    tidak ada ruang di bawah.
 *
 * `createPortal` ke `document.body` dengan `position: fixed` PLUS
 * pembacaan `getBoundingClientRect()` menyelesaikan keduanya: panel selalu
 * benar-benar di layar, dan membalik ke atas otomatis kalau ruang di bawah
 * tidak cukup. `requestAnimationFrame` dipakai untuk reposisi setelah
 * render supaya tinggi yang diukur bukan estimasi.
 *
 * ## Kenapa bulan & tahun berupa grid, bukan dropdown
 *
 * Dua komponen `Dropdown` di dalam header bikin panel jadi tinggi dan
 * sempit, dan tiap `Dropdown` membawa popup + animasinya sendiri — jadi
 * kalender, yang paling sering dibuka, justru yang paling berat. Sekarang
 * keduanya jadi grid 3 kolom di panel yang sama: satu kali klik untuk
 * melihat semua bulan, satu klik untuk melihat semua tahun, dan panel
 * tetap seukuran aslinya.
 */
export default function DatePicker({
  value,
  onChange,
  label,
  max,
  min,
  disabled = false,
  className = '',
}: DatePickerProps) {
  const selected = parseLocal(value);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>('days');
  const [viewDate, setViewDate] = useState<Date>(() => selected ?? new Date());
  const [openAbove, setOpenAbove] = useState(false);
  const [popupStyle, setPopupStyle] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: POPUP_WIDTH,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const todayIso = getTodayWIB();

  // ── Posisi panel ────────────────────────────────────────────────
  // Dihitung ulang saat buka, tiap scroll, dan tiap resize. Padding
  // `--dev-panel-right-offset` milik DeveloperInspector ikut diperhitungkan
  // supaya panel tidak tersembunyi di balik panel developer.
  const hitungPosisi = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const devOffset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--dev-panel-right-offset') || '0'
    );
    const usableWidth = Math.max(vw - devOffset, 0);
    const popupH = popupRef.current?.offsetHeight || EST_HEIGHT;
    const width = Math.min(POPUP_WIDTH, Math.max(usableWidth - MARGIN * 2, 220));

    let left = rect.left;
    if (left + width > usableWidth - MARGIN) left = Math.max(MARGIN, usableWidth - width - MARGIN);
    if (left < MARGIN) left = MARGIN;

    const spaceBelow = vh - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    // Condong ke bawah kalau muat; kalau tidak, condong ke atas.
    const below = spaceBelow >= popupH || spaceBelow >= spaceAbove;

    let top: number;
    if (below) {
      top = rect.bottom + GAP;
      if (top + popupH > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - popupH);
    } else {
      top = rect.top - GAP - popupH;
      if (top < MARGIN) top = MARGIN;
    }

    setOpenAbove(!below);
    setPopupStyle({ top, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    // Dua frame: frame pertama setelah popup terpasang, kedua setelah
    // tinggi sebenarnya selesai dihitung (grid bulan/tahun memengaruhi
    // tinggi panel).
    const id = requestAnimationFrame(() => {
      hitungPosisi();
      requestAnimationFrame(hitungPosisi);
    });
    return () => cancelAnimationFrame(id);
  }, [open, view, hitungPosisi]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const diKontainer = containerRef.current?.contains(target);
      const diPopup = popupRef.current?.contains(target);
      if (!diKontainer && !diPopup) setOpen(false);
    };

    // Escape diteangkap di fase *capture* supaya hanya menutup kalender.
    // Kalau didiarkan, listener `document` milik `Modal` ikut menerima
    // event yang sama dan seluruh modal ikut tertutup — dan karena modal
    // dipasang lebih dulu, `stopPropagation` di tahap bubble sudah
    // terlambat.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', hitungPosisi, true);
    window.addEventListener('resize', hitungPosisi);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', hitungPosisi, true);
      window.removeEventListener('resize', hitungPosisi);
    };
  }, [open, hitungPosisi]);

  // Ikuti nilai dari luar saat panel terbuka, dan kembali ke tampilan hari
  // setiap kali ditutup supaya panel tidak pernah terbuka dalam keadaan
  // menampilkan daftar bulan.
  useEffect(() => {
    if (open) {
      const next = parseLocal(value);
      if (next) setViewDate(next);
    } else {
      setView('days');
    }
  }, [open, value]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  /**
   * Tahun yang bisa dipilih: 12 tahun berpusat di tahun berjalan.
   *
   * Dulu rentangnya 7 tahun (sekarang-5 sampai sekarang+1) yang tidak
   * menghasilkan grid penuh. 12 tahun = 3 kolom × 4 baris persis, jadi
   * panel.year punya tinggi tetap dan tidak melompat.
   */
  const tahunGrid = useMemo(() => {
    const now = new Date().getFullYear();
    const start = now - 4;
    return Array.from({ length: TAHUN_PER_GRID }, (_, i) => start + i);
  }, []);

  const sel = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const startOffset = firstDayOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const cells: SelisihHari[] = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({
        day: daysInPrevMonth - startOffset + i + 1,
        isCurrentMonth: false,
        date: new Date(year, month - 1, daysInPrevMonth - startOffset + i + 1),
      });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ day, isCurrentMonth: true, date: new Date(year, month, day) });
    }
    // Lengkapi ke 35 atau 42 sel supaya tinggi panel tidak melompat
    // antar-bulan.
    const total = cells.length <= 35 ? 35 : 42;
    for (let day = 1; day <= total - cells.length; day++) {
      cells.push({ day, isCurrentMonth: false, date: new Date(year, month + 1, day) });
    }
    return cells;
  }, [year, month]);

  const goToMonth = (delta: number) => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const pilihTanggal = (iso: string) => {
    if (min && iso < min) return;
    if (max && iso > max) return;
    onChange(iso);
    setOpen(false);
  };

  const tampilTanggal = selected
    ? `${selected.getDate()} ${SHORT_MONTHS_ID[selected.getMonth()]} ${selected.getFullYear()}`
    : 'Pilih tanggal';

  const popup =
    open &&
    createPortal(
      <>
        <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
        <div
          ref={popupRef}
          style={{ position: 'fixed', top: popupStyle.top, left: popupStyle.left, width: popupStyle.width }}
          className={`modal-layer z-[9999] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl shadow-slate-950/25 border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col ${
            openAbove ? 'animate-pop-in-above' : 'animate-pop-in-below'
          }`}
          onClick={event => event.stopPropagation()}
        >
          {/* ── Header: bulan & tahun sebagai tombol pemindah panel ── */}
          <div className="flex items-center gap-1 px-2.5 py-2 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <button
              type="button"
              onClick={() => goToMonth(-1)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0"
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0 flex items-center justify-center gap-0.5">
              <button
                type="button"
                onClick={() => setView(view === 'months' ? 'days' : 'months')}
                className={`px-1.5 py-1 rounded-md text-[11px] font-bold truncate transition-colors ${
                  view === 'months'
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
                aria-label="Pilih bulan"
              >
                {MONTHS_FULL_ID[month]}
              </button>
              <button
                type="button"
                onClick={() => setView(view === 'years' ? 'days' : 'years')}
                className={`px-1.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                  view === 'years'
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
                aria-label="Pilih tahun"
              >
                {year}
              </button>
            </div>

            <button
              type="button"
              onClick={() => goToMonth(1)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0"
              aria-label="Bulan berikutnya"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:bg-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
              aria-label="Tutup kalender"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ── Isi panel: hari / bulan / tahun ─────────────────────── */}
          <div className="px-2.5 py-2.5 overflow-y-auto custom-scrollbar min-h-0">
            {view === 'days' && (
              <>
                <div className="grid grid-cols-7 gap-0.5 mb-1">
                  {WEEKDAYS_ID.map(day => (
                    <div
                      key={day}
                      className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 py-0.5"
                    >
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {sel.map((item, index) => {
                    const iso = toISODate(item.date);
                    const isSelected = iso === value;
                    const isToday = iso === todayIso;
                    const disabledDay = (min !== undefined && iso < min) || (max !== undefined && iso > max);

                    return (
                      <button
                        key={`${iso}-${index}`}
                        type="button"
                        disabled={disabledDay}
                        onClick={() => pilihTanggal(iso)}
                        className={`aspect-square rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors mx-auto w-full ${
                          !item.isCurrentMonth
                            ? 'text-slate-300 dark:text-slate-600'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                        } ${isSelected ? '!bg-blue-600 !text-white hover:!bg-blue-700 shadow-sm' : ''} ${
                          isToday && !isSelected
                            ? 'border border-blue-400 dark:border-blue-500 text-blue-600 dark:text-blue-400'
                            : ''
                        } ${disabledDay ? 'opacity-25 cursor-not-allowed' : ''}`}
                      >
                        {item.day}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {view === 'months' && (
              <div className="grid grid-cols-3 gap-1.5">
                {SHORT_MONTHS_ID.map((short, index) => (
                  <button
                    key={short}
                    type="button"
                    onClick={() => {
                      setViewDate(new Date(year, index, 1));
                      setView('days');
                    }}
                    className={`py-2 rounded-lg text-[11px] font-bold transition-colors ${
                      month === index
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {short}
                  </button>
                ))}
              </div>
            )}

            {view === 'years' && (
              <div className="grid grid-cols-3 gap-1.5">
                {tahunGrid.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setViewDate(new Date(item, month, 1));
                      setView('days');
                    }}
                    className={`py-2 rounded-lg text-[11px] font-bold transition-colors ${
                      year === item
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Pintasan ─────────────────────────────────────────────── */}
          <div className="px-2.5 py-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              disabled={Boolean(max && todayIso > max)}
              onClick={() => {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                pilihTanggal(toISODate(yesterday));
              }}
              className="text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors disabled:opacity-30"
            >
              Kemarin
            </button>
            <button
              type="button"
              disabled={Boolean(max && todayIso > max)}
              onClick={() => pilihTanggal(todayIso)}
              className="text-[11px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors disabled:opacity-30"
            >
              Hari ini
            </button>
          </div>
        </div>
      </>,
      document.body
    );

  return (
    // Lebar dibuka lewat `className`, bukan `w-full` bawaan. Kalau dipatok
    // di sini, pemanggil tidak bisa menyempitkannya — `w-full` dan
    // `max-w-*` sama-sama utilitas lebar, dan yang menang ditentukan urutan
    // di CSS, bukan urutan di `class`.
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 ml-1">
          {label}
        </label>
      )}

      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(prev => !prev)}
        className={`w-full flex items-center justify-between gap-2 rounded-xl border bg-white dark:bg-slate-800/60 px-3.5 py-2.5 text-sm text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          open
            ? 'border-blue-500 ring-2 ring-blue-500/20'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="truncate font-medium">{tampilTanggal}</span>
        </span>
      </button>

      {popup}
    </div>
  );
}
