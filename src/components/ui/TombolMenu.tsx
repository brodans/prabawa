import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { ActionButton, type ButtonSize, type ButtonVariant } from './Surface';
import {
  KELAS_PANEL_MENU,
  LEBAR_PANEL,
  LEBAR_PANEL_HINT,
  kelasItemMenu,
  perkiraanTinggiMenu,
  useMenuLayang,
  type ItemMenu,
} from './menuTerdapat';

/**
 * Tombol yang membuka menu.
 *
 * ## Kenapa formatnya bukan tombol tersendiri
 *
 * Halaman Laporan punya tiga pilihan unduhan: Excel, CSV, PDF. Semula
 * masing-masing jadi tombol tersendiri di kepala halaman, dan baris aksinya
 * jadi ±354 px — di layar 360 px yang tersedia hanya 328 px, sehingga tombol
 * terakhir keluar viewport tanpa ada yang memberi tahu.
 *
 * Menumpuknya ke tombol "⋯" seperti di `AksiMenu` akan menyembunyikan nama
 * format sampai diklik. Untuk hal yang dipakai rutin, itu satu klik tambahan
 * setiap kali. Jadi formatnya diberi nama di tombolnya sendiri, dan yang
 * dipindah ke dalam menu adalah **pemilihan formatnya** — bukan jejaknya.
 *
 * Hasilnya baris aksi kembali ke tiga tombol (Muat Ulang, Cetak, Ekspor)
 * yang muat di layar 360 px tanpa membungkus.
 *
 * ## Arah buka dan portal
 *
 * Dipegang `menuTerdapat.ts`, sama persis dengan `AksiMenu`: ke bawah
 * sebagai bawaan, portal ke `document.body`, ditutup di klik pertama di luar.
 * Lihat penjelasan panjang di berkas itu.
 */

export interface TombolMenuProps {
  /** Teks di tombol. */
  label: string;
  items: ItemMenu[];
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function TombolMenu({
  label,
  items,
  icon,
  variant = 'secondary',
  size = 'sm',
  disabled = false,
  loading = false,
  ariaLabel,
  className = '',
}: TombolMenuProps) {
  const [open, setOpen] = useState(false);
  const tutup = () => setOpen(false);
  const adaHint = items.some(item => item.hint);

  const { pemicuRef, panelRef, posisi } = useMenuLayang({
    terbuka: open,
    tutup,
    // `perkiraanTinggiMenu` sudah menghitung item ber-`hint` sebagai baris
    // ganda, jadi tidak perlu ada tebakan tambahan di sini.
    tinggi: perkiraanTinggiMenu(items),
    /*
     * Lebar tombol "Ekspor" ±100 px; panel 200 px memberi ruang untuk label
     * tanpa menutupi isi tabel.
     *
     * Kalau ada `hint`, panel dibuat lebih lebar (280 px) dan hint-nya
     * **membungkus**. Semula keduanya dipatok 200 px dengan `truncate`, jadi
     * ".xls · dua lembar (riwayat + rekap) · kolom Jarak bisa dijumlahkan"
     * terpotong jadi ".xls · dua lembar (riwayat +…". Ekstensi di depan
     * selamat, tapi penjelasannya — bagian yang menjelaskan kenapa format itu
     * dipilih — hilang. Ditukar: 280 px dan dua baris, keduanya terbaca.
     */
    lebar: adaHint ? LEBAR_PANEL_HINT : LEBAR_PANEL,
    sisi: 'kanan',
  });

  if (items.length === 0) return null;

  return (
    <>
      <ActionButton
        ref={pemicuRef}
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        className={`${open ? 'ring-2 ring-blue-500/30' : ''} ${className}`}
        icon={loading ? undefined : icon}
      >
        {label}
        {/* Panah ikut arah. */}
        <ChevronDown
          className={`w-3.5 h-3.5 opacity-70 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </ActionButton>

      {open &&
        posisi &&
        createPortal(
          <>
            {/* Penutup layar penuh — menutup tanpa harus mengklik tepat di panel. */}
            <div className="fixed inset-0 z-[60]" onClick={tutup} aria-hidden />
            <div
              ref={panelRef}
              role="menu"
              aria-label={ariaLabel ?? label}
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
                      className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${kelasItemMenu(item)}`}
                    >
                      {Icon && <Icon className="w-4 h-4 shrink-0 mt-0.5 opacity-80" />}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold">{item.label}</span>
                        {/*
                         * Hint membungkus, bukan `truncate`: penjelasannya yang
                         * membuat opsi ini dipilih. Memotongnya di ujung
                         * kalimat membuang alasan pilihannya — hasilnya
                         * "…(riwayat +…".
                         */}
                        {item.hint && (
                          <span className="block text-[11px] text-slate-400 dark:text-slate-500 break-words mt-0.5">
                            {item.hint}
                          </span>
                        )}
                      </span>
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
