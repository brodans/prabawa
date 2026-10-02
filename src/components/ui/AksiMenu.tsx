import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import {
  KELAS_PANEL_MENU,
  LEBAR_PANEL,
  kelasItemMenu,
  perkiraanTinggiMenu,
  useMenuLayang,
  type ItemMenu,
} from './menuTerdapat';

/**
 * Menu aksi untuk satu baris tabel.
 *
 * ## Kenapa satu tombol, bukan empat ikon
 *
 * Tabel "Monitoring Akun" punya empat aksi per baris: perpanjang, koreksi
 * tanggal, tandai gratis, riwayat. Empat tombol ikon 36 px = 144 px + celah,
 * dan kolom aksinya hanya 168 px — jadi `flex-wrap` memecah tombolnya jadi
 * **dua baris**, dan tinggi setiap baris tabel ikut naik. Di tabel tagihan
 * lebih parah lagi: tiga tombol (108 px) dipaksakan ke 92 px.
 *
 * Hasilnya bukan cuma rapi. Kolom Akun ikut tergerus, dan di layar sempit
 * tombol-tombolnya saling menempel — yang pressed-nya tidak jelas mana.
 *
 * Satu tombol "⋯" memakai 40 px, jadi kolom aksi menyusut dari 168 px jadi 40
 * px. Lebar itu dikembalikan ke kolom yang memang butuh: Akun, Masa Aktif, dan
 * Pembayaran.
 *
 * Penempatan panelnya — portal, arah buka, penutup layar — dipegang
 * `menuTerdapat.ts`, yang dipakai juga `TombolMenu`, jadi aturan yang sama
 * tidak mungkin punya dua angka yang berbeda.
 */

/** Bentuk item yang dipakai halaman ini sejak pertama kali. */
export type AksiMenuItem = ItemMenu;

export interface AksiMenuProps {
  items: AksiMenuItem[];
  /** Label aksesibel untuk tombolnya, mis. "Aksi untuk budi". */
  ariaLabel?: string;
  className?: string;
}

export function AksiMenu({ items, ariaLabel = 'Aksi baris', className = '' }: AksiMenuProps) {
  const [open, setOpen] = useState(false);
  const tutup = () => setOpen(false);

  const { pemicuRef, panelRef, posisi } = useMenuLayang({
    terbuka: open,
    tutup,
    tinggi: perkiraanTinggiMenu(items),
    lebar: LEBAR_PANEL,
    sisi: 'kanan',
  });

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={pemicuRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`h-9 w-9 inline-flex items-center justify-center rounded-lg border
          border-transparent text-slate-400 transition-colors
          hover:bg-slate-100 hover:text-slate-700 hover:border-slate-200
          dark:hover:bg-slate-700/60 dark:hover:text-slate-200 dark:hover:border-slate-600
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
          focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900
          ${open ? 'relative z-[62] bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200' : ''}
          ${className}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open &&
        posisi &&
        createPortal(
          <>
            {/* Penutup layar penuh — menutup menu tanpa harus mengklik tepat di panel. */}
            <div className="fixed inset-0 z-[60]" onClick={tutup} aria-hidden />
            <div
              ref={panelRef}
              role="menu"
              aria-label={ariaLabel}
              style={{
                top: posisi.top,
                left: posisi.left,
                minWidth: LEBAR_PANEL,
                maxHeight: posisi.maxHeight,
              }}
              className={KELAS_PANEL_MENU}
            >
              {items.map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.id}>
                    {item.pemisah && (
                      <div className="my-1 border-t border-slate-100 dark:border-slate-700/70" role="separator" />
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={() => {
                        setOpen(false);
                        item.onClick();
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px]
                        font-medium transition-colors disabled:cursor-not-allowed ${kelasItemMenu(item)}`}
                    >
                      {Icon && <Icon className="w-4 h-4 shrink-0 opacity-80" />}
                      <span className="truncate">{item.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
