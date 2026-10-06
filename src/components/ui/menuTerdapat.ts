/**
 * Penempatan menu yang melayang bebas di layar.
 *
 * Dipakai berdua oleh `AksiMenu` (menu "..." di baris tabel) dan
 * `TombolMenu` (menu tombol biasa, mis. pilihan format unduhan). Keduanya
 * butuh hal yang persis sama: mengukur posisi pemicu, memutuskan buka ke atas
 * atau ke bawah, menjaga panel tetap di dalam layar, lalu menutup diri saat
 * diklik dari luar.
 *
 * Ditulis sebagai satu hook supaya aturan ini tidak pernah diimplementasikan
 * dua kali dengan dua angka yang berbeda.
 *
 * ## Kenapa `fixed` + portal, bukan `absolute`
 *
 * Tabel dibungkus `overflow-x-auto` (lihat `DataTable`). Menu `absolute` di
 * dalam sel akan ikut terpotong oleh pembungkus itu — persis di kasus yang
 * paling penting: baris terakhir, di dasar tabel yang panjang.
 *
 * `fixed` di dalam pohon DOM tidak cukup. Setiap leluhur yang punya
 * `transform`, `filter`, `backdrop-filter`, atau `will-change` **membuat
 * containing block sendiri** untuk keturunannya yang `fixed` — hasilnya
 * `top`/`left` dihitung relatif kotak leluhur itu, bukan viewport. Padahal
 * koordinat di sini berasal dari `getBoundingClientRect()`, yang selalu
 * relatif viewport. Menu lalu muncul meleset jauh dari barisnya.
 *
 * Leluhur seperti itu benar-benar ada di aplikasi ini: `App.tsx` membungkus
 * tiap halaman dengan `motion.div` (`y: 10 → 0`). Motion menulis
 * `transform: none` setelah animasi selesai, jadi gejalanya intermittent —
 * menu meleset hanya kalau dibuka dalam 300 ms pertama perpindahan halaman.
 *
 * `createPortal` ke `document.body` menutup kelas bug ini sepenuhnya: satu-
 * satunya leluhur `fixed`-nya adalah viewport. Pola yang sama sudah dipakai
 * `DatePicker`.
 *
 * ## Arah buka: bawah adalah bawaan
 *
 * Menu hanya naik ke atas kalau ruang di bawah **tidak cukup untuk apa pun
 * yang berguna** — di bawah `TINGGI_MINIMUM`, bukan sekadar lebih kecil
 * daripada ruang di atas.
 *
 * Aturan lama memakai `tinggi > ruangBawah && ruangAtas > ruangBawah`, dan
 * akibatnya menu di baris ketiga dari bawah melompat ke atas hanya karena
 * daftarnya panjang, padahal di bawahnya masih ada 300 px yang cukup. Menu
 * yang melompat-lompat memaksa mata mencari ulang, dan daftar ini berisi
 * aksi yang menghapus tagihan atau mengubah format berkas — salah pilih
 * berarti salah aksi.
 *
 * Sekarang: selama ada minimal 120 px di bawah, menu tetap ke bawah dan
 * digulir di dalam panelnya. Sama seperti `Dropdown.tsx`.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Lebar panel. Cukup untuk label terpanjang + ikon. */
export const LEBAR_PANEL = 200;

/**
 * Lebar panel untuk menu yang sebagian itemnya punya `hint`.
 *
 * Menu baris tabel (label pendek) cukup di 200 px. Menu format unduhan
 * tidak: hint-nya kalimat, bukan satu kata. Di 200 px dengan `truncate`,
 * ".xls · dua lembar (riwayat + rekap) · kolom Jarak bisa dijumlahkan"
 * berakhir di "…(riwayat +…" — Ekstensi di depan selamat, tapi alasan
 * memilih format itu justru hilang.
 *
 * 280 px + `break-words` membuat hint-nya jadi dua baris utuh. Panel tetap
 * dijepit ke dalam layar di `hitungPosisi()`, jadi di HP sempit ia melebar
 * mengikuti ruang yang ada, bukan mengikuti angka ini.
 */
export const LEBAR_PANEL_HINT = 280;

/** Jarak aman dari tepi layar, sama seperti `Dropdown.tsx`. */
export const JARAK_TEPI = 8;

/** Tinggi perkiraan satu item tanpa `hint` — dipakai sebelum pengukuran. */
export const TINGGI_ITEM = 34;

/**
 * Tinggi perkiraan item **ber-`hint`**.
 *
 * 34 px + dua baris (label + hint yang membungkus) + `py-2` 16 px. Angka ini
 * hanya untuk menentukan tinggi saat menu dibuka ke atas dan lantai
 * `maxHeight` — panelnya sendiri diukur browser, jadi kelewatan berarti
 * panel mulai sedikit lebih tinggi dari perlu, bukan salah tempat.
 */
export const TINGGI_ITEM_HINT = 62;

/** `py-1` panel atas + bawah. */
const PADDING_PANEL = 12;

/**
 * Ruang minimum di bawah agar menu tetap dibuka ke bawah.
 *
 * Ambang "masih berguna", bukan ambang "cukup untuk seluruh menu". Selama ada
 * 120 px di bawah, menu tetap ke bawah dan digulir di dalam panelnya.
 *
 * Di bawah ambang ini panel setinggi 120 px dengan 3–4 baris yang bisa
 * digulir masih jauh lebih baik daripada menu yang setengahnya keluar layar.
 */
export const TINGGI_MINIMUM = 120;

export type NadaMenu = 'default' | 'danger';

/** Satu isi menu. `id` dipakai sebagai kunci React — jangan pakai index. */
export interface ItemMenu {
  /** Identitas stabil untuk React — jangan pakai index. */
  id: string;
  label: string;
  /** Teks kecil di bawah label. */
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  /** `danger` untuk aksi yang menghapus atau membatalkan. */
  tone?: NadaMenu;
  disabled?: boolean;
  /** Garis pemisah sebelum item ini — untuk memisahkan "berbahaya". */
  pemisah?: boolean;
}

export interface PosisiMenu {
  top: number;
  left: number;
  maxHeight: number;
}

export interface OpsiMenuLayang {
  /** Panel sedang tampil? */
  terbuka: boolean;
  /** Tutup panel. */
  tutup: () => void;
  /** Perkiraan tinggi panel, dipakai sebelum pengukuran. */
  tinggi: number;
  /** Lebar panel. */
  lebar?: number;
  /**
   * Sisi panel yang ditempel ke sisi tombol yang sama.
   *
   * `kanan` untuk tombol di ujung kanan baris aksi, `kiri` untuk tombol di
   * awal baris. Dipakai hanya sebagai titik awal — hasilnya tetap dijepit
   * agar tidak keluar layar.
   */
  sisi?: 'kiri' | 'kanan';
  /**
   * Kembalikan fokus ke pemicu setelah ditutup lewat Escape.
   *
   * **Bawaan `true`.** Menu yang menutup diri tapi meninggalkan fokus di
   * `body` membuat pengguna papan ketik kehilangan tempatnya: di menu baris
   * tabel artinya fokus melompat keluar dari tabel, dan tombol berikutnya
   * yang ditekan mendarat di halaman, bukan di baris yang tadi. Setel `false`
   * hanya kalau pemanggil memang memindahkan fokus ke tempat lain.
   */
  fokusKembali?: boolean;
}

/**
 * Pasang menu melayang pada satu tombol.
 *
 * Mengembalikan ref pemicu, ref panel, dan posisi yang sudah diukur dalam
 * koordinat viewport.
 */
export function useMenuLayang({
  terbuka,
  tutup,
  tinggi,
  lebar = LEBAR_PANEL,
  sisi = 'kanan',
  fokusKembali = true,
}: OpsiMenuLayang) {
  const [posisi, setPosisi] = useState<PosisiMenu | null>(null);

  const pemicuRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const hitungPosisi = useCallback(() => {
    const pemicu = pemicuRef.current;
    if (!pemicu) return;
    const rect = pemicu.getBoundingClientRect();

    const ruangBawah = window.innerHeight - rect.bottom - JARAK_TEPI;
    const ruangAtas = rect.top - JARAK_TEPI;

    // ⚠️ Yang diuji adalah `ruangBawah < TINGGI_MINIMUM` — BUKAN
    // `tinggi > ruangBawah && ruangAtas > ruangBawah`. Lihat penjelasan
    // "Arah buka" di header berkas.
    const keAtas = ruangBawah < TINGGI_MINIMUM && ruangAtas > ruangBawah;

    const top = keAtas ? Math.max(JARAK_TEPI, rect.top - tinggi - 4) : rect.bottom + 4;

    // Rata ke sisi tombol yang dipilih, lalu dijaga tetap di dalam layar.
    const kiriIdeal = sisi === 'kiri' ? rect.left : rect.right - lebar;
    const left = Math.max(
      JARAK_TEPI,
      Math.min(kiriIdeal, window.innerWidth - lebar - JARAK_TEPI)
    );

    setPosisi({
      top,
      left,
      // Ke bawah, ruang yang tersedia boleh lebih kecil dari tinggi menu —
      // panelnya yang digulir, bukan menu yang melompat ke atas.
      maxHeight: Math.max(TINGGI_MINIMUM, keAtas ? ruangAtas : ruangBawah),
    });
  }, [tinggi, lebar, sisi]);

  /*
   * Ukur **sebelum** dirender: panel muncul di posisi yang benar pada frame
   * pertama. Kalau diukur di `useEffect`, panel sempat tampil di (0,0) — terlihat
   * berkedip ke sudut layar.
   */
  useLayoutEffect(() => {
    if (terbuka) hitungPosisi();
  }, [terbuka, hitungPosisi]);

  // Tutup saat klik di luar, tekan Escape, atau halaman digulir / diubah.
  //
  // `scroll` ikut memicu karena panel-nya `fixed`: tanpa ini, tabel yang
  // digulir akan membuat menu tetap tertinggal di tempat yang sudah tidak ada
  // barisnya.
  //
  // ⚠️ `mousedown` (bukan `click`) supaya panel hilang seketika di klik
  // pertama. Dengan `click`, `mousedown` sudah menggerakkan tombol di bawah
  // penutup layar, dan klik berikutnya mendarat di sana — hasilnya klik
  // pertama menutup, klik kedua membuka lagi.
  useEffect(() => {
    if (!terbuka) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (pemicuRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      tutup();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      tutup();
      if (fokusKembali) pemicuRef.current?.focus();
    };
    const onResize = () => tutup();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', tutup, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', tutup, true);
      window.removeEventListener('resize', onResize);
    };
  }, [terbuka, tutup, fokusKembali]);

  return { pemicuRef, panelRef, posisi, hitungPosisi };
}

/**
 * Perkiraan tinggi panel dari isi menunya — dipakai sebelum pengukuran.
 *
 * Dihitung per item, bukan `jumlahItem * TINGGI_ITEM`: menu yang setiap
 * itemnya punya `hint` (pilihan format unduhan) jauh lebih tinggi daripada
 * menu baris tabel, dan satu rumus untuk keduanya membuat salah satunya
 * salah tempat saat dibuka ke atas.
 */
export function perkiraanTinggiMenu(
  items: readonly { hint?: string | undefined }[]
): number {
  return (
    items.reduce((total, item) => total + (item.hint ? TINGGI_ITEM_HINT : TINGGI_ITEM), 0) +
    PADDING_PANEL
  );
}

/**
 * Kelas baris satu item menu, dipakai kedua komponen agar identik.
 *
 * Tidak ada keadaan "aktif" di sini: sorotan biru hanya bermakna kalau menu
 * bisa dinavigasi dengan papan ketik, dan penanda biru tanpa makna itu hanya
 * menambah satu warna yang tidak menjelaskan apa pun.
 */
export function kelasItemMenu(item: ItemMenu): string {
  if (item.disabled) return 'opacity-40 cursor-not-allowed';
  if (item.tone === 'danger')
    return 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40';
  return 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/60';
}

/** Kelas panel menu, dipakai kedua komponen agar identik. */
export const KELAS_PANEL_MENU =
  'fixed z-[61] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/40';
