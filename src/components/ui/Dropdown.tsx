import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/**
 * Dropdown milik sendiri.
 *
 * `<select>` bawaan browser tidak bisa diberi gaya, opsi panjangnya terpotong
 * di layar kecil, panahnya bawaan OS, dan tidak bisa difilter. Semua select
 * di aplikasi ini memakai komponen ini.
 *
 * ## Arah buka: bawah dulu, ke atas hanya kalau perlu
 *
 * Aturannya satu kalimat: **buka ke bawah; ke atas hanya kalau bawah tidak
 * muat dan atas lebih luas.**
 *
 * Versi lama memakai angka tetap:
 *
 * ```
 * setDropdownUp(window.innerHeight - rect.bottom < 280 && rect.top > 280)
 * ```
 *
 * Dua masalahnya nyata. Pertama, `280` adalah tebakan: daftar 4 opsi tidak
 * pernah setinggi itu, daftar 20 opsi pasti. Kedua — dan ini yang bikin
 * dropdown terasa "ngawur" — syarat `rect.top > 280` berarti pemicu yang
 * letaknya di **atas** layar akan *dipaksa* buka ke bawah, padahal ruang di
 * bawahnya mungkin tinggal 40 piksel. Hasilnya daftar terpotong persis di
 * tempat yang paling butuh ruang.
 *
 * Sekarang ruang dihitung dari tinggi daftar yang benar-benar dirender dan
 * dari `visualViewport` (bukan `innerHeight`) — yang terakhir penting di HP,
 * karena `innerHeight` tidak ikut menyusut saat keyboard virtual muncul.
 */

/** Jarak aman dari tepi layar, dalam piksel. */
const JARAK_TEPI = 8;

/** Batas atas tinggi daftar, sama dengan `max-h-64` di Tailwind. */
const TINGGI_DAFTAR_MAKS = 256;

/**
 * Ruang minimum di bawah agar daftar tetap dibuka ke bawah.
 *
 * Angka ini adalah ambang "masih berguna", bukan ambang "cukup untuk seluruh
 * daftar". Selama ada 120 px di bawah, daftar dibuka ke bawah dan digulir di
 * dalam panelnya — lebih dapat diprediksi daripada melompat ke atas.
 *
 * Di bawah ambang ini tidak ada pilihan lain: panel setinggi 120 px dengan
 * 4–5 baris yang bisa digulir masih jauh lebih baik daripada daftar yang
 * setengahnya keluar layar.
 */
const TINGGI_MINIMUM = 120;

export interface OpsiDropdown {
  value: string;
  label: string;
  /** Teks kecil di bawah label. */
  hint?: string;
  disabled?: boolean;
  /** Kelompok untuk `<optgroup>`. Opsi diurutkan sesuai kemunculannya. */
  group?: string;
}

export interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  opsi: OpsiDropdown[];
  placeholder?: string;
  disabled?: boolean;
  /** Tampilkan kolom pencarian di dalam daftar. */
  searchable?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export default function Dropdown({
  value,
  onChange,
  opsi,
  placeholder = '— Pilih —',
  disabled = false,
  searchable = false,
  className = '',
  id,
  'aria-label': ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  /**
   * Arah buka daftar. Default 'bawah' — bukan karena itu selalu benar,
   * tapi karena itu yang dipakai kalau pengukuran belum sempat jalan, dan
   * membuka ke bawah selalu lebih aman daripada membuka ke atas tanpa dasar.
   */
  const [arah, setArah] = useState<'bawah' | 'atas'>('bawah');
  /** Tinggi daftar, dibatasi ruang yang tersedia di sisi tempat ia dibuka. */
  const [tinggiMaks, setTinggiMaks] = useState(TINGGI_DAFTAR_MAKS);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const terpilih = useMemo(() => opsi.find(item => item.value === value) ?? null, [opsi, value]);

  // Tutup saat klik di luar atau tekan Escape.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Fokuskan kolom cari ketika daftar dibuka dengan mode pencarian.
  useEffect(() => {
    if (open && searchable) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, searchable]);

  const tersaring = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!searchable || !q) return opsi;
    return opsi.filter(
      item =>
        item.label.toLowerCase().includes(q) ||
        item.hint?.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q)
    );
  }, [opsi, query, searchable]);

  // Kelompok hanya dipakai bila ada opsi yang menyatakannya.
  const pakaiGrup = useMemo(() => opsi.some(item => item.group), [opsi]);

  /*
   * Arah buka & tinggi maksimum.
   *
   * ## Aturan arah: ke bawah adalah bawaan
   *
   * Daftar hanya naik ke atas kalau ruang di bawah **tidak cukup untuk apa pun
   * yang berguna** — di bawah `TINGGI_MINIMUM`, bukan sekadar lebih kecil
   * daripada ruang di atas.
   *
   * Aturan lama — `ruangBawah < tinggi && ruangAtas > ruangBawah`, dengan
   * `tinggi` diambil dari `scrollHeight` daftar — memakai ke atas jauh lebih
   * sering dari yang disengaja. Sebuah dropdown di baris tabel ketiga dari
   * bawah akan melompat ke atas hanya karena daftarnya panjang, padahal di
   * bawahnya masih ada 300 px yang cukup untuk menampilkan banyak baris.
   *
   * Daftar yang melompat-lompat adalah masalah nyata, bukan soal selera:
   * isinya nama, filter, dan format. Salah pilih berarti salah aksi, dan mata
   * harus mencari ulang dari nol setiap kali arahnya berubah.
   *
   * Sekarang: selama ada minimal `TINGGI_MINIMUM` (120 px) di bawah, daftar
   * tetap ke bawah, dan panjangnya menyesuaikan lewat tinggi maksimum yang
   * dihitung di bawah. Membalik ke atas berarti tombolnya nyaris menyentuh
   * tepi atas layar — di HP yang sama artinya daftar itu tertutup palang atas.
   */
  const hitungArah = useCallback(() => {
    const pemicu = rootRef.current?.getBoundingClientRect();
    if (!pemicu) return;

    // `visualViewport` menyusut saat keyboard virtual muncul; `innerHeight`
    // tidak. Mengukurnya di HP tanpa memperhitungkan keyboard = daftar tertutup keyboard.
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const tinggiLayar = vv?.height ?? window.innerHeight;
    const offsetLayar = vv?.offsetTop ?? 0;

    // Ruang yang benar-benar bisa dipakai, dikurangi jarak aman tepi.
    const ruangBawah = tinggiLayar - (pemicu.bottom - offsetLayar) - JARAK_TEPI;
    const ruangAtas = pemicu.top - offsetLayar - JARAK_TEPI;

    /*
     * ⚠️ Tinggi daftar penuh (`scrollHeight`) **tidak lagi dipakai** di sini.
     *
     * Semula arah ditentukan oleh `ruangBawah < tinggi && ruangAtas >
     * ruangBawah`, dan `tinggi` dihitung dari `scrollHeight` daftar. Itu yang
     * membuat menu melompat ke atas terlalu sering — daftar panjang di baris
     * tabel ketiga dari bawah akan naik ke atas meskipun di bawahnya masih
     * ada ruang yang cukup.
     *
     * Sekarang arah ditentukan oleh ruang minimum saja, jadi `scrollHeight`
     * tidak dibutuhkan di sini.
     */
    const keAtas = ruangBawah < TINGGI_MINIMUM && ruangAtas > ruangBawah;
    setArah(keAtas ? 'atas' : 'bawah');

    // Batasi tinggi daftar dengan ruang yang tersedia, supaya daftar pendek
    // tetap pendek dan daftar panjang tidak pernah keluar layar.
    const ruang = keAtas ? ruangAtas : ruangBawah;
    setTinggiMaks(Math.max(TINGGI_MINIMUM, Math.min(TINGGI_DAFTAR_MAKS, ruang)));
  }, []);

  // Hitung setelah render pertama supaya tinggi panel sudah ada.
  useEffect(() => {
    if (!open) return;
    hitungArah();
    const raf = requestAnimationFrame(hitungArah);
    return () => cancelAnimationFrame(raf);
  }, [open, hitungArah]);

  // Hitung ulang saat isi daftar berubah (pencarian menyaring opsi) — tinggi
  // yang needed berubah bersama isinya.
  useEffect(() => {
    if (!open) return;
    hitungArah();
  }, [open, tersaring.length, pakaiGrup, searchable, hitungArah]);

  /*
   * Hitung ulang saat jendela digulir atau diubah ukurannya.
   *
   * Tanpa ini, dropdown yang sudah terbuka bisa tertinggal di sisi yang
   * sekarang penuh — daftar tertutup keyboard atau keluar layar.
   */
  useEffect(() => {
    if (!open) return;
    const onResize = () => hitungArah();
    const onScroll = () => hitungArah();
    window.addEventListener('resize', onResize);
    // `capture` supaya gulir di dalam daftar lain (dialog) ikut terukur.
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, hitungArah]);

  // Gulir opsi yang sedang disorot ke dalam tampilan.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const pilih = (opsiValue: string) => {
    onChange(opsiValue);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const jml = tersaring.length;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
        setHighlight(Math.max(0, tersaring.findIndex(item => item.value === value)));
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlight(prev => (jml === 0 ? 0 : (prev + 1) % jml));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlight(prev => (jml === 0 ? 0 : (prev - 1 + jml) % jml));
        break;
      case 'Enter': {
        event.preventDefault();
        const item = tersaring[highlight];
        if (item && !item.disabled) pilih(item.value);
        break;
      }
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          setOpen(prev => !prev);
          setQuery('');
        }}
        onKeyDown={onKeyDown}
        className={`w-full flex items-center justify-between gap-2 py-2.5 px-3.5 rounded-xl border text-sm font-medium transition-colors ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600'
        } ${
          open
            ? 'border-blue-500 ring-2 ring-blue-500/20 bg-white dark:bg-slate-800/60'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60'
        }`}
      >
        <span
          className={`truncate min-w-0 text-left ${
            terpilih ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {terpilih ? terpilih.label : placeholder}
        </span>
        {/* Panah ikut arah: saat daftar terbuka ke atas, panah tetap ke atas
            supaya terbaca sebagai "naik", bukan "turun lalu naik". */}
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
            open ? (arah === 'atas' ? 'rotate-180' : '') : ''
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            data-arah={arah}
            initial={{ opacity: 0, y: arah === 'atas' ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: arah === 'atas' ? 4 : -4, scale: 0.98 }}
            transition={{ duration: 0.13, ease: 'easeOut' }}
            className={`absolute left-0 z-[80] w-full min-w-0 max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl shadow-slate-950/25 overflow-hidden ${
              arah === 'atas' ? 'bottom-full mb-2' : 'top-full mt-2'
            }`}
          >
            {searchable && (
              <div className="relative border-b border-slate-100 dark:border-slate-700">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={event => {
                    setQuery(event.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setHighlight(prev => (tersaring.length === 0 ? 0 : (prev + 1) % tersaring.length));
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setHighlight(prev =>
                        tersaring.length === 0 ? 0 : (prev - 1 + tersaring.length) % tersaring.length
                      );
                    } else if (event.key === 'Enter') {
                      event.preventDefault();
                      const item = tersaring[highlight];
                      if (item && !item.disabled) pilih(item.value);
                    }
                  }}
                  placeholder="Ketik untuk mencari..."
                  className="w-full pl-9 pr-9 py-2.5 bg-transparent text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      searchRef.current?.focus();
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label="Bersihkan pencarian"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <div
              ref={listRef}
              role="listbox"
              // `max-h-64` digantikan `tinggiMaks`: daftar pendek tetap
              // setinggi isinya, daftar panjang berhenti di ruang yang ada
              // alih-alih keluar layar.
              className="overflow-y-auto custom-scrollbar p-1.5"
              style={{ maxHeight: tinggiMaks }}
            >
              {tersaring.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                  Tidak ada opsi yang cocok.
                </p>
              ) : pakaiGrup ? (
                <GroupedList
                  opsi={tersaring}
                  highlight={highlight}
                  value={value}
                  onHighlight={setHighlight}
                  onPilih={pilih}
                />
              ) : (
                tersaring.map((item, index) => (
                  <OptionRow
                    key={item.value}
                    item={item}
                    index={index}
                    active={highlight === index}
                    terpilih={value === item.value}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => !item.disabled && pilih(item.value)}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Baris opsi
// ═══════════════════════════════════════════════════════════════════════

function OptionRow({
  item,
  index,
  active,
  terpilih,
  onMouseEnter,
  onClick,
}: {
  item: OpsiDropdown;
  index: number;
  active: boolean;
  terpilih: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={terpilih}
      data-index={index}
      disabled={item.disabled}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition-colors ${
        item.disabled
          ? 'opacity-40 cursor-not-allowed'
          : active
            ? 'bg-blue-50 dark:bg-blue-500/15'
            : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
      }`}
    >
      <Check
        className={`w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400 transition-opacity ${
          terpilih ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-xs font-semibold truncate ${
            terpilih ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200'
          }`}
        >
          {item.label}
        </span>
        {item.hint && (
          <span className="block text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
            {item.hint}
          </span>
        )}
      </span>
    </button>
  );
}

/** Daftar opsi yang dikelompokkan mengikuti nilai `group`. */
function GroupedList({
  opsi,
  highlight,
  value,
  onHighlight,
  onPilih,
}: {
  opsi: OpsiDropdown[];
  highlight: number;
  value: string;
  onHighlight: (index: number) => void;
  onPilih: (value: string) => void;
}) {
  // `data-index` harus memakai indeks global supaya sorotan keyboard dan
  // `scrollIntoView` tetap cocok.
  const groups: { name: string; items: { item: OpsiDropdown; index: number }[] }[] = [];
  opsi.forEach((item, index) => {
    const name = item.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push({ item, index });
    else groups.push({ name, items: [{ item, index }] });
  });

  return (
    <>
      {groups.map(group => (
        <div key={group.name || '_'} className="mb-1 last:mb-0">
          {group.name && (
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {group.name}
            </p>
          )}
          {group.items.map(({ item, index }) => (
            <OptionRow
              key={`${group.name}-${item.value}`}
              item={item}
              index={index}
              active={highlight === index}
              terpilih={value === item.value}
              onMouseEnter={() => onHighlight(index)}
              onClick={() => !item.disabled && onPilih(item.value)}
            />
          ))}
        </div>
      ))}
    </>
  );
}
