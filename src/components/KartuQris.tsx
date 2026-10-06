import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  KARTU_LEBAR,
  KARTU_TINGGI,
  KARTU_RASIO,
  gambarKartuQris,
} from '../lib/kartuQrisCanvas';

/** Logo yang dipakai di kepala kartu. */
const LOGO_QRIS = '/ico/qris.svg';
const LOGO_GPN = '/ico/gpn.svg';

/**
 * Muat gambar dan tunggu sampai siap.
 *
 * Ini wajib: menggambar `<img>` yang belum selesai diunduh tidak
 * menghasilkan error — canvas hanya melompatinya. Logo akan hilang
 * diam-diam, dan itu persis yang tidak terlihat sampai dilaporkan pengguna.
 */
function muatGambar(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[KartuQris] Logo gagal dimuat: ${src}`);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Kartu QRIS — QR pembayaran dalam bentuk kartu siap pakai.
 *
 * ## Kenapa digambar di kanvas, bukan pakai API pihak ketiga
 *
 * String QRIS memuat nama merchant dan nominal. Kalau dirender lewat
 * `api.qrserver.com` atau layanan serupa, string itu **dikirim** ke sana —
 * dan siapa pun yang memegang request-nya bisa membacanya. Untuk data
 * pembayaran itu tidak dapat diterima. Jadi seluruh kartu digambar lokal,
 * tanpa jaringan sama sekali.
 *
 * Seluruh penggambarannya ada di `lib/kartuQrisCanvas.ts`; komponen ini
 * hanya menunggu font siap lalu mengubah kanvas jadi PNG.
 *
 * ## Nominal tidak ditulis di dalam kartu
 *
 * Nominal yang dipakai aplikasi pembayaran diambil dari tag 54 pada string
 * QRIS, bukan dari gambar. Menulis nominal besar di dalam kartu berisiko
 * menyesatkan begitu harga paket berubah, jadi teksnya diganti "nominal
 * terkunci di dalam QR".
 */
export interface KartuQrisProps {
  /** String QRIS ber-nominal (hasil `qrisDinamis`). */
  qrisString: string;
  /** Lebar kartu dalam piksel logis. */
  lebar?: number;
  className?: string;
  /** Dipanggil sekali QR selesai digambar (untuk tombol unduh / perbesar). */
  onSiap?: (dataUrl: string) => void;
}

export default function KartuQris({
  qrisString,
  lebar = 300,
  className = '',
  onSiap,
}: KartuQrisProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [gagal, setGagal] = useState<string | null>(null);

  /*
   * `onSiap` dibaca lewat ref, bukan dari dependensi efek.
   *
   * `onSiap` opsional dan sering diisi arrow inline. Kalau ikut jadi
   * dependensi, identitasnya berubah **setiap render** → efek menggambar
   * ulang → `setDataUrl` memicu render → efek menggambar ulang lagi, dan
   * aplikasi membeku di loop. Gejalanya: kartu QR "hang" dengan
   * spin berputar dan kotak putih, persis seperti bug gambar rusak yang
   * baru saja diperbaiki — tapi kali ini tidak pernah selesai.
   *
   * Ref membuat efek hanya bergantung pada `qrisString`, yang memang satu-
   *-satunya hal yang harus memicu penggambaran ulang.
   */
  const onSiapRef = useRef(onSiap);
  useEffect(() => {
    onSiapRef.current = onSiap;
  });

  useEffect(() => {
    if (!qrisString) return;
    let batal = false;

    const gambar = async () => {
      try {
        // Font kustom belum tentu siap saat komponen mount. Tanpa
        // `fonts.ready`, canvas jatuh ke font sistem dan teks merchant
        // terlihat berbeda dari sisa tampilan.
        if (document.fonts?.ready) await document.fonts.ready;

        const canvas = document.createElement('canvas');
        // `KARTU_TINGGI`, bukan literal `580`: ukuran logis × 3 supaya tajam
        // di layar retina. Angka yang ditulis manual di sini bisa berbeda
        // dari konstanta tanpa ada yang menyadarinya — kartu lalu tergambar
        // terpotong atau melonjok, dan penyebabnya tidak kelihatan.
        canvas.width = KARTU_LEBAR * 3;
        canvas.height = KARTU_TINGGI * 3;

        // Logo dimuat dulu, baru kartu digambar — canvas tidak bisa
        // menunggu sendiri.
        const [logoQris, logoGpn] = await Promise.all([muatGambar(LOGO_QRIS), muatGambar(LOGO_GPN)]);

        gambarKartuQris(canvas, (w, h) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          return c;
        }, { qrisString, skala: 3, logoQris, logoGpn });

        if (batal) return;
        const url = canvas.toDataURL('image/png', 1);
        setDataUrl(url);
        setGagal(null);
        onSiapRef.current?.(url);
      } catch (err: any) {
        console.error('[KartuQris] Gagal menggambar kartu:', err);
        if (!batal) setGagal('QR tidak bisa dibuat dari string ini.');
      }
    };

    void gambar();
    return () => {
      batal = true;
    };
  }, [qrisString]);

  /*
   * Lebar dikirim lewat `style` supaya angka `lebar` tidak ikut hilang saat
   * `className` menimpa. Tapi `width` inline justru menjadi masalah: di layar
   * 320 px (iPhone SE generasi pertama) ruang dialog hanya sekitar 248 px, dan
   * kartu 264 px akan meluber keluar dialog — memotong QR persis di
   * perangkat yang paling mungkin dipakai untuk membayar.
   *
   * Solusinya: `maxWidth: '100%'` plus `height: 'auto'`, dengan `aspectRatio`
   * yang menghitung tinggi yang benar. `aspectRatio` diabaikan kalau `height`
   * juga ditetapkan, jadi `height` harus dibiarkan otomatis.
   */
  const gaya = { width: lebar, maxWidth: '100%' as const, aspectRatio: String(KARTU_RASIO) };

  if (!qrisString) {
    return <RangkaKartu className={className} gaya={gaya} />;
  }

  /*
   * ERROR — sengaja berbeda total dari memuat.
   *
   * Dulu kedua keadaan ini memakai placeholder yang sama persis: kotak putih
   * dengan spin kecil di tengah. Akibatnya QR yang gagal digambar terlihat
   * identik dengan QR yang masih dimuat, dan pengguna menunggu sesuatu yang
   * tidak akan pernah datang — bahkan setelah pesannya sudah gagal.
   *
   * Sekarang: memuat = kartu putih + spinner abu-abu netral, gagal = kartu
   * merah + ikon peringatan. Satu perbedaan warna sudah cukup untuk keduanya
   * terbaca sekilas, sebelum teksnya sempat dibaca.
   *
   * Spinner bewarna netral (abu-abu) bukan hijau emerald seperti
   * placeholder 5×5 yang lama, supaya tidak ada elemen "sukses" yang muncul
   * sebelum QR-nya benar-benar jadi.
   */
  if (gagal) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2.5 rounded-[20px] border border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30 p-5 text-center ${className}`}
        style={{ ...gaya, height: 'auto' }}
      >
        <AlertTriangle className="w-7 h-7 text-rose-500 shrink-0" />
        <p className="text-xs font-bold text-rose-700 dark:text-rose-400">QR tidak bisa dibuat</p>
        <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 leading-relaxed max-w-[190px]">
          {gagal} Minta administrator memeriksa string QRIS di pengaturan.
        </p>
      </div>
    );
  }

  /*
   * String sudah ada, PNG belum.
   *
   * ⚠️ Ini keadaan yang **selalu** terjadi dan tidak boleh lolos ke `<img>`.
   * Menggambar kartu adalah operasi async: menunggu `document.fonts.ready`,
   * memuat dua logo SVG, lalu menggambar ribuan modul ke kanvas. Selama itu
   * berjalan, `qrisString` sudah terisi tapi `dataUrl` masih `null`.
   *
   * Versi lama merender `<img src={dataUrl ?? undefined}>` — yaitu `<img>`
   * tanpa `src`. Peramban tidak menampilkannya sebagai apa pun yang berguna:
   * ia menggambar **ikon gambar rusak dan teks alt di pojok kiri atas** kotak
   * putih. Itu persis yang terlihat di layar — kotak putih dengan gambar
   * jelek di pojok kiri, selama berdetik-detik, setiap kali dialog pembayaran
   * dibuka.
   *
   * Periksanya harus `!dataUrl`, bukan `!qrisString` — dua hal yang berbeda,
   * dan hanya yang kedua yang membuat `<img>` aman dirender.
   */
  if (!dataUrl) {
    return <RangkaKartu className={className} gaya={gaya} />;
  }

  // `dataUrl` dijamin terisi di sini oleh penjaga di atas — tanpa penjaga
  // itu, React merender `<img>` tanpa `src` dan peramban menggambar ikon
  // gambar rusak di pojok kiri.
  return (
    <img
      src={dataUrl}
      alt="Kartu QRIS pembayaran"
      className={`rounded-[20px] shadow-sm bg-white h-auto ${className}`}
      style={gaya}
    />
  );
}

/**
 * Placeholder selagi QR digambar.
 *
 * ## Kenapa spinner, bukan placeholder berbentuk QR
 *
 * Menggambar kartu berarti memuat dua logo SVG, menunggu font siap, lalu
 * menggambar ribuan modul QR ke kanvas. Di HP beberapa detik.
 *
 * Dua percobaan sebelumnya salah, dan keduanya karena alasan yang sama —
 * bentuknya **meniru** hasil akhir:
 *
 * 1. Spin kecil pucat di tengah kotak putih. Persis seperti yang ditampilkan
 *    browser saat gambar gagal dimuat, jadi pengguna membacanya sebagai error
 *    lalu menekan "Periksa lagi" berulang kali.
 * 2. Siluet 5×5 modul QR berkedip + garis pemindai hijau. Lebih masuk akal,
   *    tapi 25 kotak berkedip berdenyut terbaca seperti skeleton yang belum
   *    terisi — dan terutama seperti QR yang **rusak**. Tidak ada yang mau
   *    memindai QR setengah jadi.
 *
 * Yang sekarang: spinner tunggal di tengah, dengan label. Tidak meniru apa pun,
 * jadi tidak bisa disalahartikan sebagai QR maupun error.
 *
 * ## Kenapa spinner di dalam kartu, bukan di luar
 *
 * Tata letaknya sudah punya slot QR dengan `aspect-ratio` tetap. Mengganti
 * isinya dengan spinner membuat tinggi kartu tidak berubah, jadi tidak ada
 * lompatan layout ketika QR selesai digambar.
 *
 * `prefers-reduced-motion` dihormati lewat `motion-safe:animate-spin`: pengguna
 * yang meminta pengurangan gerakan tetap melihat spinner statis beserta
 * labelnya.
 */
function RangkaKartu({
  className,
  gaya,
}: {
  className: string;
  gaya: { width: number; maxWidth: string; aspectRatio: string };
}) {
  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-[20px] bg-white border border-slate-200 dark:border-slate-700 ${className}`}
      style={{ ...gaya, height: 'auto' }}
      role="status"
      aria-live="polite"
    >
      {/*
        * `animate-spin` memakai CSS animation, jadi dihormati
       * `prefers-reduced-motion` oleh Tailwind di balik `motion-safe:`.
       * Ketebalan 2px supaya ukurannya tidak bersaing dengan teks di bawahnya.
       */}
      <Loader2
        className="w-7 h-7 text-slate-400 dark:text-slate-500 motion-safe:animate-spin"
        strokeWidth={2}
        aria-hidden="true"
      />

      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 px-4 text-center">
        Menyiapkan QR pembayaran…
      </p>
    </div>
  );
}
