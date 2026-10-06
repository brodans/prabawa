/**
 * Kontrak antara peramban dan server autentikasi.
 *
 * ## Kenapa berkas ini ada
 *
 * Server hidup di `api/panel-auth.js` — hasil build, di-deploy sendiri, dan
 * **tidak** ikut ter-deploy saat frontend di-build ulang. Dua kode itu bisa
 * saja tidak sinkron, dan gejalanya tidak pernah berupa error yang jujur.
 *
 * Yang benar-benar terjadi di proyek ini, dua kali berturut-turut:
 *
 * 1. Versi lama server menulis kredensial ke dokumen **akun admin**, bukan
 *    akun yang dituju. Peramban mendapat `{ ok: true }`, jadi dialog menampilkan
 *    "Akun diperbarui" dan tidak ada satu pun tanda gagal.
 * 2. Aksi `kredensial:ringkas-semua` belum ada di versi lama. Halaman Manajemen
 *    Akun memanggilnya di dalam `.catch(() => new Map())`, jadi setiap baris
 *    menampilkan "Kredensial belum diatur" — dan penyebab sebenarnya (server
 *    belum ter-deploy) tidak pernah terlihat.
 *
 * Dua-duanya berakhir sebagai "sudah saya isi, tapi tidak ada yang terjadi".
 *
 * ## Cara kerjanya
 *
 * `KONTRAK_VERSI` dinaikkan setiap kali bentuk request atau response berubah
 * dalam cara yang tidak kompatibel. Nilainya:
 *
 * - dikirim server di **setiap** respons `panel-auth`
 * - dibandingkan peramban saat memverifikasi sesi
 * - berbeda → banner merah di seluruh aplikasi, menyebut cara memperbaikinya
 *
 * ⚠️ Menaikkan versi **tidak** memperbaiki apa pun. Tujuannya satu: membuat
 * "server belum ter-deploy" terlihat dalam hitungan detik, bukan setelah
 * menelusuri log yang tidak terlihat.
 */

/**
 * Naikkan setiap kali ada perubahan yang tidak kompatibel.
 *
 * ### 2 — `kredensial_server__*` ditulis ke dokumen **pemanggil**, bukan target
 * `simpanKredensial`, `ringkasKredensial`, dan `hapusKredensial` memakai
 * `dokKredensial(pemanggil.username)`. Untuk akun biasa, pemanggil = target,
 * jadi tidak terlihat. Untuk admin, kredensial user tersimpan di dokumen admin
 * dan kredensial admin sendiri tertimpa.
 *
 * ### 3 — IMEI dari dokumen kredensial selalu dikalahkan TechMark peramban
 * `opsi.imei ?? data.imei`: UUID dari `imeiStabil()` tidak pernah nullish, jadi
 * `??` tidak pernah memakai nilai kedua. IMEI yang diisi admin dibuang, dan
 * akun yang terkunci ke satu perangkat ditolak 402.
 *
 * ### 4 — nama dokumen kredensial tidak dinormalisasi
 * `createUserAccount()` menyimpan username `trim().toLowerCase()`, sementara
 * `kunciAkun()` tidak melakukan lowercase. "Budi" dan "budi" jadi dua dokumen
 * untuk satu akun, dan auto-login tidak pernah menemukan kredensialnya.
 */
export const KONTRAK_VERSI = 4;

/**
 * Daftar aksi yang **wajib** ada di server.
 *
 * Dipakai untuk pesan error: kalau aksinya hilang sementara versinya sama, itu
 * berarti build yang lebih lama — dan menyebut nama aksinya membuat diagnosis
 * jauh lebih cepat daripada sekadar "coba deploy ulang".
 */
export const AKSI_WAJIB = [
  'masuk',
  'verifikasi',
  'akun:daftar',
  'akun:buat',
  'akun:ubah',
  'kredensial:simpan',
  'kredensial:ringkas',
  'kredensial:ringkas-semua',
  'kredensial:hapus',
  'pusat:login',
] as const;
