/**
 * Id perangkat — meniru `Settings.Secure.ANDROID_ID` di aplikasi Android asli.
 *
 * ## Apa ini untuk apa
 *
 * Server pusat mengikat sebagian akun ke perangkat **pertama** yang berhasil
 * login. Akun yang terikat akan menjawab `402` kalau `imei` yang dikirim
 * berbeda. Field-nya sendiri wajib ada di `login` — tanpa `imei`, server
 * membalas `-32602 Invalid params` sebelum sempat memeriksa NIP.
 *
 * Jadi aplikasi harus selalu mengirim *sesuatu*, dan "sesuatu" itu harus:
 *
 * 1. **Stabil** — nilai yang sama di perangkat yang sama,across restart.
 *    Kalau berubah tiap muat halaman, akun terkunci langsung gagal login.
 * 2. **Unik per perangkat** — inilah justru yang paling penting untuk
 *    aplikasi yang dipakai banyak perangkat. Satu id bersama untuk semua
 *    orang justru menghapus makna pengikatannya: begitu id itu bocor,
 *    siapa pun bisa login dari mana saja.
 * 3. **Bisa diganti manual** — kalau admin sudah memberikan id perangkat
 *    yang benar, nilai itu harus menang, bukan ditimpa di sini.
 *
 * ## Kenapa tidak dari `navigator.userAgent` atau yang serupa
 *
 * Semuanya bisa dipalsukan, dan tidak ada yang bisa dijamin stabil.
 * Yang dipakai di sini adalah UUID acak, disimpan sekali lalu dibaca
 * seterusnya — persis sama bentuknya dengan `androidId`.
 *
 * ## Kenapa per-akun
 *
 * Dua akun yang bergantian di satu peramban tidak boleh memakai id yang
 * sama. Kalau iya, id perangkat itu bocor dari akun A ke akun B, dan
 * setelah keduanya mengikat perangkat yang sama, akun A bisa di-device-id
 * oleh akun B. Kuncinya karena itu diberi prefix username, sama seperti
 * `sessionManager` melakukan untuk sesi.
 */
import { bacaStorage, tulisStorage } from './storageAman';

/** Awalan kunci. `sessionManager` punya yang serupa untuk sesi. */
const KUNCI = 'epresensi_jatim_idperangkat__';

/** Bentuk UUID v4, dibuat tanpa dependensi. */
function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback untuk konteks yang tidak punya `randomUUID` (mis. HTTP lama).
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // versi 4
  b[8] = (b[8] & 0x3f) | 0x80; // varian
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
/**
 * Username dibersihkan supaya tidak bisa jadi bagian dari kunci storage
 * milik akun lain.
 *
 * ⚠️ Mengganti karakter — `replace(/\//g, '_')` — **tidak aman di sini**,
 * dan itu sempat dipakai. Penggantian itu bukan pemetaan satu-ke-satu:
 * username `a/b` dan `a_b` berubah jadi kunci yang sama, sehingga dua akun
 * berbeda berbagi satu id perangkat. Baru ketahuan karena
 * `cek-id-perangkat.ts` mengujinya secara langsung.
 *
 * `encodeURIComponent` yang dipakai sekarang bersifat satu-ke-satu, jadi
 * tidak mungkin ada dua input yang keluar sama. Username yang memang valid
 * (`[a-zA-Z0-9._-]`) tetap terbaca apa adanya, jadi kunci storage-nya masih
 * enak dibaca ketika perlu diagnosa.
 */
function kunciAkun(username: string): string {
  return encodeURIComponent(username.trim());
}

/** Bentuk id yang dipakai untuk `imei`. Panjang 36, aman untuk field server. */
function bentukId(): string {
  return `WEB-${uuid().replace(/-/g, '').slice(0, 24).toUpperCase()}`;
}

/**
 * Id perangkat milik satu akun di peramban ini.
 *
 * Dibuat sekali lalu disimpan, jadi appel berikutnya membaca nilai yang
 * sama. `null` hanya kalau `localStorage` tidak tersedia (mode privat
 * beberapa peramban) — pemanggil harus tetap mengirim `''` dalam keadaan
 * itu, karena mengirim `undefined` membuat server menjawab `-32602`.
 *
 * Nilai yang dikembalikan **sudah bisa dipakai apa adanya** sebagai
 * `imei`; tidak ada format khusus yang harus dibungkus.
 */
export function idPerangkat(username: string): string {
  if (!username) return '';
  const kunci = `${KUNCI}${kunciAkun(username)}`;

  const ada = bacaStorage(kunci, '');
  if (ada) return ada;

  const baru = bentukId();
  // Gagal menulis tidak apa-apa: nilai ini masih dipakai untuk sesi ini,
  // dan It'll dibuat ulang dengan nilai berbeda di muat berikutnya — lebih
  // baik daripada aplikasi gagal total.
  tulisStorage(kunci, baru);
  return baru;
}
