import { AlertTriangle, RefreshCw } from 'lucide-react';
import { aksiServerHilang, kontrakServerBasi, kontrakServerTerlihat } from '../lib/akunFirestore';
import { KONTRAK_VERSI } from '../lib/kontrakServer';

/**
 * Banner "server belum ter-deploy".
 *
 * ## Kenapa ini perlu ada, dan bukan hanya pesan di halaman Pengaturan
 *
 * Server autentikasi hidup di `api/panel-auth.js` — hasil build, di-deploy
 * sendiri, dan tidak ikut ter-deploy saat frontend di-build ulang. Kalau
 * frontend lebih baru dari server, peramban dan server diam-diam tidak
 * sinkron, dan gejalanya **tidak pernah** berupa error yang jujur.
 *
 * Dua contoh nyata di proyek ini:
 *
 * - Server lama menulis kredensial ke dokumen **akun admin**. Peramban mendapat
 *   `{ ok: true }` — dialog menampilkan "Akun diperbarui", dan tidak ada satu
 *   pun tanda bahwa apa pun tidak tersimpan.
 * - Server lama tidak mengenal `kredensial:ringkas-semua`. Halaman Manajemen
 *   Akun memanggilnya di dalam `.catch()` yang mengosongkan hasilnya, jadi
 *   setiap baris menampilkan "Kredensial belum diatur" tanpa penjelasan.
 *
 * Keduanya berakhir sebagai "sudah saya isi, tapi tidak ada yang terjadi" —
 * dan penyebabnya tidak terlihat dari mana pun di antarmuka.
 *
 * ## Kenapa taruh di sini, bukan di Settings
 *
 * Kesalahannya bisa terjadi di halaman mana pun: mengisi kredensial di
 * Manajemen Akun, auto-login di Beranda, atau menyimpan langganan. Banner di
 * pojok atas halaman Pengaturan hanya dilihat kalau orang sudah tahu harus
 * melihat ke sana. Di sini, ia muncul di halaman yang sedang dikerjakan.
 *
 * ## Kapan **tidak** muncul
 *
 * Sebelum respons pertama diterima (`null`). Banner yang berkedip setiap kali
 * aplikasi dibuka, lalu hilang sendiri, lebih buruk daripada tidak ada.
 */
export default function BannerKontrakServer() {
  if (!kontrakServerBasi()) return null;

  const terlihat = kontrakServerTerlihat();
  const hilang = aksiServerHilang();
  /*
   * Aksi yang hilang lebih berguna daripada nomor versi.
   *
   * "Versi 3 banding 4" tidak langsung mengatakan apa yang harus diperbaiki.
   * "Server tidak
   * mengenal aksi `kredensial:ringkas-semua`" langsung mengarah ke satu
   * penyebab yang punya satu perbaikan.
   */
  const rincian =
    hilang.length > 0
      ? `Server tidak mengenal aksi: ${hilang.join(', ')}.`
      : `Peramban memakai kontrak versi ${KONTRAK_VERSI}, server menjawab versi ${terlihat}.`;

  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 border-b border-amber-300/70 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/40 px-4 sm:px-8 py-2.5 shrink-0"
    >
      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
        <p className="font-bold text-amber-900 dark:text-amber-200">
          Server autentikasi versi lama — sebagian fitur tidak akan bekerja.
        </p>
        <p className="text-amber-800 dark:text-amber-300/90 mt-0.5">{rincian}</p>
        <p className="text-amber-800 dark:text-amber-300/90 mt-0.5">
          Jalankan <code className="font-mono">npm run build:api</code> lalu deploy ulang. Menulis
          NIP, IMEI, atau password di Manajemen Akun **tidak akan tersimpan** selama banner ini
          muncul.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-amber-800 dark:text-amber-200 border border-amber-400/70 dark:border-amber-600/60 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Muat ulang
      </button>
    </div>
  );
}
