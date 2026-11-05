import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldCheck, UserCircle, Users } from 'lucide-react';

/**
 * Dropdown akun di top bar.
 *
 * ## Tombolnya **lingkaran**, bukan kapsul
 *
 * Semunya tombol berbentuk pil: avatar + nama (`max-w-[130px]`) + chevron.
 * Di layar sempit topbar sudah sempit — dan kalau panel Network Inspector
 * ikut terbuka sebagai kolom layout, ruangnya menyusut lagi. Akibatnya tombol
 * akun meluber ke luar header atau terpotong, dan tabel di bawahnya ikut
 * bergeser.
 *
 * Avatar lingkaran menyelesaikan dua masalah sekaligus: lebar tombolnya
 * tetap (32 px) di ukuran layar berapa pun, dan identitas orang tetap
 * terbaca lewat inisial.
 *
 * Namanya tidak hilang — hanya pindah ke dalam menu, di mana ada ruang untuk
 * menuliskannya dengan utuh. Di `sm` ke atas, nama tetap tampil di samping
 * avatar; di bawah itu, tombolnya jadi lingkaran murni.
 */

export interface AkunDropdownItem {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  onClick: () => void;
  /** `danger` untuk keluar dari aplikasi. */
  tone?: 'default' | 'danger';
}

export interface AkunDropdownProps {
  /** Nama depan yang tampil. */
  displayName: string;
  /** URL foto; kosongkan untuk avatar inisial. */
  photoUrl?: string;
  role: string;
  items: AkunDropdownItem[];
}

/** Lebar menu. `min()` supaya tidak pernah melebihi layar sempit. */
const LEBAR_MENU = 264;
/** Jarak aman dari tepi layar. */
const MARGIN = 12;

export default function AkunDropdown({
  displayName,
  photoUrl,
  role,
  items,
}: AkunDropdownProps) {
  const [open, setOpen] = useState(false);
  const [lebar, setLebar] = useState(LEBAR_MENU);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Lebar menu dihitung dari ruang yang benar-benar tersedia.
   *
   * Nilai tetap `w-64` (256 px) tampak aman di HP 360 px — tapi begitu panel
   * developer ikut occupying layout, atau topbar berada di dalam sidebar yang
   * sedang menyempit, sisa ruang bisa turun di bawah itu. Hasilnya menu
   * melewati tepi kanan layar dan bagian Spawned tidak bisa dibaca.
   *
   * `min(264px, lebarTersedia)` menutupnya di sumbernya, dan diproses ulang
   * setiap kali jendela berubah ukurannya.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const hitung = () => {
      const tombol = rootRef.current?.getBoundingClientRect();
      if (!tombol) return;
      // Ruang dari tepi kiri tombol sampai tepi layar, dikurangi margin.
      const keKiri = tombol.left - MARGIN;
      const keKanan = window.innerWidth - tombol.right - MARGIN;
      // Menu diratakan ke kanan tombol, tapi tidak boleh melewati tepi kiri.
      setLebar(Math.max(200, Math.min(LEBAR_MENU, Math.max(keKanan, Math.min(keKiri, LEBAR_MENU)))));
    };
    hitung();
    window.addEventListener('resize', hitung);
    return () => window.removeEventListener('resize', hitung);
  }, [open]);

  // Tutup saat klik di luar atau tekan Escape.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // `stopPropagation` dipakai supaya Escape di sini tidak ikut menjatuhkan
      // panel lain yang kebetulan juga listening (developer inspector).
      event.stopPropagation();
      setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Inisial untuk avatar cadangan.
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');

  const isAdmin = role === 'admin';

  const avatar = (size: 'sm' | 'md') =>
    photoUrl ? (
      <img
        src={photoUrl}
        alt={displayName}
        className={`${size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'} rounded-full object-cover aspect-square border border-slate-200 dark:border-slate-600 shrink-0`}
      />
    ) : (
      <div
        className={`${size === 'sm' ? 'w-8 h-8 text-[11px]' : 'w-10 h-10 text-xs'} rounded-full flex items-center justify-center shrink-0 border ${
          isAdmin
            ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30'
            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'
        }`}
      >
        {initials || <UserCircle className="w-4 h-4" />}
      </div>
    );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu akun — ${displayName}`}
        title={displayName}
        className={`flex items-center rounded-full border transition-all cursor-pointer ${
          open
            ? 'border-blue-400 dark:border-blue-500/60 ring-2 ring-blue-500/20'
            : 'border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md'
        } p-0.5 sm:p-0.5 sm:pr-2.5 sm:gap-2 bg-white/50 dark:bg-slate-800/50 shadow-sm`}
      >
        {avatar('sm')}

        {/*
          Nama + chevron hanya di `sm` ke atas.

          Di bawah itu topbar hanya muat untuk ikon, dan kapsul dengan nama
          membuat tombol ini meluber melewati tepi layar. Avatar lingkaran
         * sendirian sudah menentukan ukuran dan tetap dikenali lewat inisial.
        */}
        <span className="hidden sm:inline text-sm font-semibold text-slate-700 dark:text-slate-200 max-w-[130px] truncate">
          {displayName}
        </span>
        <svg
          className={`hidden sm:block w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            role="menu"
            style={{ width: lebar }}
            className="absolute right-0 top-full mt-2 z-[85] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl shadow-slate-950/25 overflow-hidden"
          >
            {/* Kepala: identitas + peran */}
            <div className="flex items-center gap-3 px-4 py-3.5 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700/60">
              {avatar('md')}
              <div className="min-w-0 flex-1">
                {/*
                  `break-words`, bukan `truncate`.

                  Nama orang bisa panjang dan tidak selalu punya spasi di tempat
                  yang nyaman — memotongnya menghilangkan bagian yang justru
                  membedakan dua orang bernama sama. Yang dipotong di sini
                  bukan isinya, tapi pembatasnya: `min-w-0` di pembungkus
                  membuat `break-words` aman di dalam flex.
                */}
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 break-words leading-snug">
                  {displayName}
                </p>
                <span
                  className={`inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                    isAdmin
                      ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {isAdmin ? <ShieldCheck className="w-2.5 h-2.5" /> : <Users className="w-2.5 h-2.5" />}
                  {isAdmin ? 'Administrator' : 'Pengguna'}
                </span>
              </div>
            </div>

            {/* Aksi */}
            <div className="p-1.5 space-y-0.5">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${
                    item.tone === 'danger'
                      ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <span className="mt-0.5 shrink-0">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold">{item.label}</span>
                    {/* Hint panjang tidak boleh terpotong di tengah kata. */}
                    {item.hint && (
                      <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 break-words leading-snug">
                        {item.hint}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
