import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { cekMidtransServer, midtransTersedia } from '../lib/midtrans';

/**
 * Status Midtrans dalam **satu baris**.
 *
 * ## Kenapa bilek, bukan daftar
 *
 * Versi sebelumnya menampilkan lima baris — tiga syarat (toggle, client key,
 * server key) plus dua paragraf penjelasan:
 *
 * ```
 * ⃝ Toggle di halaman ini — aktif
 * ✓ VITE_MIDTRANS_CLIENT_KEY — terpasang
 * ✓ MIDTRANS_SERVER_KEY — terpasang di server
 * ✓ Midtrans aktif. Metode ini akan muncul untuk pengguna.
 * ⚠ Midtrans membaca MIDTRANS_SERVER_KEY di server. Kalau key belum diisi, …
 * ```
 *
 * Yang terjadi di layar: kotak pengaturan jadi setengah penuh teks tentang
 * environment variable. Empat dari lima baris itu **hanya mengulang** bahwa
 * Midtrans hidup — dan itu sudah terlihat dari toggle di atasnya, yang menyala.
 * Dua env var yang disebut tidak bisa diisi dari sini, jadi membaca namanya
 * tidak membantu siapa pun memperbaiki apa pun.
 *
 * Yang benar-benar perlu ditampilkan hanya satu kondisi: **Midtrans siap atau
 * belum**. Kalau belum, sebutkan satu hal yang harus diperbaiki — bukan
 * inventory.
 *
 * ## Yang dihapus, dan kenapa tidak ada yang hilang
 *
 * - **`VITE_MIDTRANS_CLIENT_KEY` / `MIDTRANS_SERVER_KEY`** — hanya bisa diisi
 *   di dashboard Vercel, bukan di panel. Menampilkan namanya di sini tidak
 *   memberi siapa pun tindakan.
 * - **"Toggle di halaman ini — aktif"** — mengulang toggle yang berada 20 px di
 *   atasnya.
 * - **"Metode ini akan muncul untuk pengguna"** — sudah jelas dari checkbox yang
 *   menyala.
 *
 * Maju satu langkah soal "`build ulang`": build di Vercel terjadi otomatis
 * setiap kali ada commit ke branch produksi, jadi env `VITE_` baru **tidak**
 * bisa dipasang tanpa deploy. Karena itu tidak disebut — menyebut "isi lalu
 * build ulang" membuat orangubo menunggu sesuatu yang tidak pernah mereka
 * lakukan sendiri.
 */
export function StatusMidtrans({ aktif, className = '' }: { aktif: boolean; className?: string }) {
  /*
   * `null` = belum tahu. Tanpa nilai ketiga ini, layar sempat menampilkan
   * "belum siap" selama satu frame sebelum pemeriksaan selesai — dan itu
   * membuat admin mengisi ulang env yang sebenarnya sudah benar.
   */
  const [serverPunyaKey, setServerPunyaKey] = useState<boolean | null>(null);

  useEffect(() => {
    let hidup = true;
    void cekMidtransServer().then(ada => {
      if (hidup) setServerPunyaKey(ada);
    });
    return () => {
      hidup = false;
    };
  }, []);

  if (serverPunyaKey === null) {
    return (
      <p className={`flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 ${className}`}>
        <CircleDashed className="w-3.5 h-3.5 shrink-0" />
        Memeriksa ketersediaan Midtrans…
      </p>
    );
  }

  /*
   * Dua syarat, dan urutannya penting.
   *
   * Kalau `aktif` false, itu **pilihan admin** — bukan kegagalan
   * konfigurasi, dan tidak perlu dijelaskan. Yang perlu dijelaskan hanya
   * kasus "menyala tapi tetap tidak jalan", karena di situ toggle terlihat
   * seperti tidak berfungsi padahal server memang belum siap.
   */
  const siap = aktif && midtransTersedia() && serverPunyaKey;

  if (siap) {
    return (
      <p className={`flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 ${className}`}>
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        Midtrans siap. Metode ini tampil untuk pengguna.
      </p>
    );
  }

  if (!aktif) {
    // Toggle sengaja mati — bukan masalah, jadi tidak perlu peringatan apa pun.
    return null;
  }

  return (
    <p className={`flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 ${className}`}>
      <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
      <span>
        Midtrans belum siap. Though toggle menyala, metode ini belum tampil untuk
        pengguna. Periksa <code className="font-mono">MIDTRANS_SERVER_KEY</code> di
        dashboard Vercel, lalu deploy ulang.
      </span>
    </p>
  );
}
