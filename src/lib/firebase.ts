/**
 * Konfigurasi Firebase sisi peramban — **hanya untuk memeriksa**.
 *
 * ## Kenapa modul ini tidak lagi memuat SDK
 *
 * Semula modul ini mengimpor `firebase/app` dan
 * `firebase/firestore` secara dinamis, lalu mengekspor `db` dan `fstore()`.
 * Pemanggilnya `langgananFirestore.ts` yang membaca `jatim_langganan` dan
 * `jatim_tagihan` langsung dari peramban.
 *
 * Itu dihapus, dan dua hal hilang sekaligus:
 *
 * 1. **Keamanan.** `firestore.rules` membiarkan kedua koleksi dengan
 *    `allow read: if true` — dengan alasan "peramban perlu tahu masa aktif".
 *    Tapi aplikasi ini tidak memakai Firebase Authentication, jadi
 *    `request.auth` selalu `null` dan `if true` berarti **seluruh koleksi
 *    terbuka untuk siapa pun yang punya API key**. Dan API key itu ada di
 *    `VITE_FIREBASE_API_KEY`, yang Vite suntikkan ke bundle peramban — jadi
 *    bisa diambil dari DevTools lalu dipakai lewat REST API tanpa membuka
 *    aplikasi sama sekali.
 *
 *    Yang bocor bukan data teknis: `nip`, `masaAkhir`, `gratis` (siapa yang
 *    tidak membayar), dan di tagihan juga `usernameLabel`, `nominal`, serta
 *    `buktiUrl` (tautan bukti transfer).
 *
 * 2. **Ukuran.** `firebase/firestore` 140 kB gzip — 35% bundle. Dengan semua
 *    pembacaan lewat `POST /api/panel-auth` (yang sudah ada di jalur muat
 *    awal), SDK itu tidak perlu diunduh siapa pun, dan tidak ada lagi
 *    `modulepreload` yang ditulis ke `index.html`.
 *
 * Sekarang modul ini cuma menjawab satu pertanyaan: **apakah konfigurasi
 * Firebase terisi di sisi peramban?** Satu-satunya pemanggilnya
 * `GerbangLangganan`, untuk memutuskan apakah layanan langganan bisa
 * diverifikasi sama sekali.
 *
 * ## Kenapa gerbang masih memerlukannya
 *
 * Tanpa Firestore **di server**, `bacaLanggananSaya()` tidak punya sumber
 * kebenaran, dan setiap akun terbaca "belum bayar" — lalu tidak ada yang bisa
 * membayar, karena pembayaran juga butuh Firestore. Hasilnya seluruh aplikasi
 * terkunci permanen.
 *
 * Jadi gerbang dilewati begitu saja kalau konfigurasi peramban kosong, dengan
 * catatan di `GerbangLangganan` yang menjelaskan gejalanya: aplikasi terbuka
 * tanpa pemeriksaan langganan — bentuk yang lebih halus dari "tidak bisa
 * login", karena tidak ada yang gagal.
 *
 * Yang tersisa di sini bukan lazy-loading yang bisa dihapus: `VITE_FIREBASE_*`
 * masih dibaca peramban, jadi env-nya masih menentukan perilaku gerbang.
 */

/**
 * Konfigurasi Firebase.
 *
 * `import.meta.env?.` (dengan `?.`) supaya modul ini bisa diimpor di luar
 * Vite — mis. skrip uji yang berjalan di Node murni, tempat
 * `import.meta.env` tidak ada. Di aplikasi, Vite selalu mengisinya, jadi
 * hasilnya identik.
 */
const firebaseConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env?.VITE_FIREBASE_APP_ID,
};

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

/** True bila environment variable Firebase sudah lengkap. */
const konfigurasiLengkap = missingKeys.length === 0;

if (!konfigurasiLengkap && typeof console !== 'undefined') {
  // Jangan crash — gerbang akan dilewati, dan penjelasan sebenarnya ada di
  // UI, bukan di log konsol yang tidak pernah dibuka.
  console.warn(
    `[firebase] Konfigurasi peramban belum lengkap (${missingKeys.join(', ')}). ` +
      'Gerbang langganan akan dilewati. Autentikasi panel tidak terpengaruh — ' +
      'ia lewat server.'
  );
}

/**
 * True bila `VITE_FIREBASE_*` terisi di peramban.
 *
 * ⚠️ Ini **tidak** memuat SDK, dan memang tidak ada SDK lagi yang bisa
 * dimuat. Satu-satunya gunanya: memberi tahu `GerbangLangganan` apakah
 * pemeriksaan langganan punya sumber kebenaran.
 *
 * Catatan: "siap" di sini berarti "konfigurasi peramban ada", **bukan**
 * "server bisa menghubungi Firestore". Yang kedua dicek `/api/health` dan
 * hanya_admin yang bisa memperbaikinya.
 */
export const isFirebaseReady = (): boolean => konfigurasiLengkap;
