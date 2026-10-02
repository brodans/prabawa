/**
 * Identitas aplikasi — sumber tunggal untuk nama, versi, dan logo.
 *
 * ## Nama: `PRABAWA` / *Portal Presensi Jawa Timur*
 *
 * ⚠️ `APP_NAME` dan `APP_FULL_NAME` **bukan akronim satu sama lain** lagi.
 *
 * Semula `PRABAWA` adalah singkatan dari "Praktis Basis Absensi Jawa Timur".
 * Nama panjangnya kemudian diganti menjadi "Portal Presensi Jawa Timur" —
 * keputusan sadar, dan `APP_NAME` sengaja dipertahankan karena sudah jadi
 * nama yang dikenal, muncul sebagai nama merchant QRIS, dan jadi bagian
 * `order_id` tagihan yang sudah tercatat di produksi.
 *
 * Konsekuensinya harus jujur: setiap tempat yang menampilkan keduanya
 * berdampingan akan menampilkan dua nama yang berbeda. Itu disengaja, dan
 * lebih baik daripada menulis akronim yang tidak lagi sesuai.
 *
 * Yang **tidak** berubah, dan tidak boleh diubah karena nama tampilan:
 *
 * - `prabawa.vercel.app` — domain produksi, ada di `ALLOWED_ORIGINS`.
 * - `createHmac('sha256', 'prabawa-kredensial')` di `panelServer.ts` —
 *   turunan kunci enkripsi kredensial server. Mengubahnya membuat setiap
 *   password server pusat yang tersimpan tidak bisa didekripsi lagi, dan
 *   auto-login semua orang langsung mati.
 * - `PREFIX_ORDER_ID = 'PRABAWA'` — awalan `order_id`. Mengubahnya membuat
 *   tagihan yang sudah tersimpan tidak dikenali lagi.
 *
 * Aplikasi juga tidak memakai nama "E-Presensi" di mana pun yang dilihat
 * pengguna. Bandingkan dengan `presensiContract.ts`, yang memang masih
 * menyebut "E-Presensi" — itu disengaja: berkas itu mendokumentasikan
 * gateway milik *aplikasi Android lain*, dan nama itu fakta teknis, bukan
 * merek aplikasi ini.
 *
 * ## Kenapa `APP_DESCRIPTION` dan `APP_ICONS` tidak ada di sini
 *
 * Keduanya pernah diekspor tapi tidak pernah diimpor. `index.html` dan
 * `public/manifest.json` tidak melewati bundler, jadi keduanya **harus**
 * menyebut deskripsi dan daftar ikon sebagai literal — konstanta di sini
 * tidak mungkin menjadi sumbernya, hanya menduplikasi.
 *
 * Duplikasi itulah yang berbahaya: versi dan nama bisa ikut berubah di satu
 * tempat lalu tertinggal di tempat lain, dan tidak ada yang mengetahuinya
 * karena kodenya "benar" di kedua berkas.
 *
 * Sebagai gantinya, `tools/cek-identitas.mjs` membandingkan ketiga
 * berkas itu langsung dan menggagalkan kalau ada yang berbeda. Untuk
 * deskripsi dan ikon, yang perlu dijaga adalah **keberadaannya dan
 * konsistensinya**, bukan konstantanya — jadi yang diperiksa adalah
 * isi `index.html` dan `manifest.json` satu sama lain.
 *
 * Angka versi (`APP_VERSION`) tetap diekspor karena bisa dipakai di dalam
 * bundler, dan `cek-identitas.mjs` membandingkannya dengan `package.json`
 * serta `manifest.json`.
 */

/** Nama singkat — judul, nama PWA, logo sidebar, dan nama merchant QRIS. */
export const APP_NAME = 'PRABAWA';

/** Nama panjang yang tampil di layar. */
export const APP_FULL_NAME = 'Portal Presensi Jawa Timur';

/** Versi aplikasi. */
export const APP_VERSION = '1.0.0';

/**
 * Logo aplikasi, dari `public/assets/`.
 *
 * ⚠️ Hanya file yang benar-benar ada di folder itu yang boleh dipakai.
 * Sebelumnya `index.html` dan `manifest.json` menunjuk
 * `android-chrome-192x192.png` dan `favicon-16x16.png` — file yang tidak
 * ada, sehingga logo tidak pernah termuat. Daftar di bawah dicocokkan
 * dengan isi folder `public/assets/`.
 *
 * Path yang sama juga muncul di `index.html` dan `manifest.json`, yang
 * tidak melewati bundler. `cek-identitas.mjs` memverifikasi ketiganya
 * menunjuk file yang benar-benar ada.
 */
export const APP_LOGO = '/assets/icon-192.png';
