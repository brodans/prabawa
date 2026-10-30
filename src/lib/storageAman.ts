/**
 * Pembacaan penyimpanan peramban yang tidak pernah melempar.
 *
 * ## Bug yang menutupi modul ini
 *
 * `localStorage.getItem()` bisa melempar, dan tidak selalu karena bug:
 *
 * - Safari mode privat: `setItem` melempar `QuotaExceededError`.
 * - Firefox/Chrome dengan penyimpanan diblokir, atau kebijakan situs:
 *   `getItem` melempar `SecurityError`.
 * - Beberapa mode kiosk dan webview institutional menonaktifkan penyimpanan
 *   sepenuhnya.
 *
 * Yang membuatnya berbahaya adalah **di mana** pemanggilannya berada.
 * `useDarkMode` memanggilnya di dalam inisialisasi `useState`:
 *
 * ```ts
 * const [isDarkMode, setIsDarkMode] = useState(() => {
 *   const saved = localStorage.getItem('theme');   // ← di sini
 *   ...
 * });
 * ```
 *
 * Inisialisasi `useState` berjalan pada fase render, **sebelum** React
 * memasang tree. Satu lemparan di situ berarti komponen gagal mounting,
 * seluruh aplikasi tidak pernah tampil — layar putih, tanpa form login
 * sama sekali. Bukan "tema tidak tersimpan", tapi aplikasi tidak jalan,
 * di perangkat yang tidak bisa di diagnosable dari luar.
 *
 * Di `LoginScreen` masalahnya lebih halus tapi sama: `setItem` untuk
 * penghitung percobaan dan masa tunggu lempar di tengah handler login,
 * jadi login gagal dan tidak ada yang menjelaskan kenapa.
 *
 * ## Sifatnya
 *
 * Semua fungsi di sini tidak pernah melempar. Penyimpanan yang tidak bisa
 * diakses dianggap sama dengan penyimpanan yang kosong — itu pilihan yang
 * benar untuk preferensi tampilan: lebih baik tema kembali ke bawaan
 * daripada aplikasi tidak bisa dibuka sama sekali.
 */

/** Baca nilai; `null` bila tidak ada atau penyimpanan tidak bisa diakses. */
export function bacaStorage(kunci: string, cadangan = ''): string {
  if (typeof window === 'undefined') return cadangan;
  try {
    return window.localStorage.getItem(kunci) ?? cadangan;
  } catch {
    return cadangan;
  }
}

/** Tulis nilai. Mengembalikan false bila tidak tersimpan (tidak melempar). */
export function tulisStorage(kunci: string, nilai: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(kunci, nilai);
    return true;
  } catch {
    // `QuotaExceededError` di sini tidak boleh menggagalkan aksi pengguna —
    // preferensi yang gagal disimpan hanya hilang di muat berikutnya.
    return false;
  }
}

/** Hapus kunci. Selalu aman dipanggil. */
export function hapusStorage(kunci: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(kunci);
  } catch {
    // Tidak ada yang bisa dilakukan, dan tidak perlu gagalkan apa pun.
  }
}

/*
 * Hanya `localStorage` yang dilayani modul ini.
 *
 * Accessories `sessionStorage` sengaja tidak ada. Modul yang memakai
 * `sessionStorage` — `sessionManager`, `cacheManager`, `GerbangLangganan` —
 * sudah membungkus setiap aksesnya di `try`/`catch` dengan fallback yang
 * terukur: sesi yang tidak terbaca berarti "tidak masuk", cache yang tidak
 * terbaca berarti "hubungkan ulang", kunci tunggu yang gagal disimpan
 * berarti tunggu berjalan di memory saja. Ketiganya sudah diuji dengan
 * storage yang benar-benar melempar (lihat `tools/cek-storage.mts`).
 *
 * Yang berbahaya ada di dua tempat saja, dan keduanya sudah diperbaiki
 * di sini: initializer `useState` (fase render, satu lemparan = aplikasi
 * tidak tampil sama sekali) dan handler login (penulisan penghitung
 * percobaan di dalam `catch`).
 */
