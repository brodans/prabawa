import { ServerCrash } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

/**
 * Auto-login ke server pusat gagal — dan itu terlihat di halaman mana pun.
 *
 * ## Kenapa banner, bukan hanya pesan di Beranda
 *
 * `serverLoginError` diisi di `App.tsx` setiap kali `mulaiAutoLogin()` gagal,
 * tapi sebelum ini hanya dirender di Beranda, di dalam blok form "Hubungkan
 * Akun". Orang yang sedang membuka Presensi, Laporan, atau Manajemen Akun tidak
 * pernah melihatnya.
 *
 * Gejalanya persis seperti ini: aplikasi terbuka normal, semua menu ada, tapi
 * **tidak ada data sama sekali** karena belum ada `api_key` yang sah. Tidak ada
 * yang memberitahu mengapa.
 *
 * Kegagalannya paling sering muncul justru saat admin sedang menyiapkan akun
 * orang lain — ia mengisi NIP, IMEI, dan password, lalu melihat halaman
 * Akun-nya kosong tanpa penjelasan, sementara penyebab sebenarnya ada di
 * server.
 *
 * ## Yang tidak ditampilkan di sini
 *
 * `null` (kredensial belum diisi — normal untuk akun yang belum disiapkan) dan
 * status "sedang menghubungi". Keduanya bukan kegagalan; memamerkannya sebagai
 * banner merah hanya membuat orang mencari masalah yang tidak ada.
 */
export default function BannerServerPusat() {
  const { serverConnected, serverLoginError } = useAppContext();

  if (serverConnected) return null;
  if (!serverLoginError) return null;
  // Masih mencoba — ini progres, bukan kegagalan.
  if (serverLoginError === 'Menghubungkan server pusat…') return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 border-b border-rose-300/60 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 px-4 sm:px-8 py-2.5 shrink-0"
    >
      <ServerCrash className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
        <p className="font-bold text-rose-900 dark:text-rose-200">
          Belum tersambung ke server pusat — data tidak akan muncul.
        </p>
        <p className="text-rose-800 dark:text-rose-300/90 mt-0.5">{serverLoginError}</p>
        {/*
         * Petunjuk yang paling sering relevan.
         *
         * Kredensial diisi dari Manajemen Akun, dan akun itu sendiri belum
         * tentu sudah punya — jadi "coba login ulang" bukan jawaban yang selalu
         * benar, dan mengarahkan orang ke Beranda hanya memindahkannya ke
         * tempat yang sama patahnya.
         */}
        <p className="text-rose-800 dark:text-rose-300/90 mt-0.5">
          Login otomatis memakai NIP, password server, dan IMEI yang tersimpan di{' '}
          <span className="font-semibold">Manajemen Akun &rarr; Ubah Akun &rarr; Login Server Pusat</span>.
          Administrator perlu mengisinya untuk akun ini.
        </p>
      </div>
    </div>
  );
}
