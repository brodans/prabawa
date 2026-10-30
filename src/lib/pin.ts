/**
 * Hash PIN/password panel — SHA-256 → bcrypt.
 *
 * ## Kenapa modul ini dipisah dari `encryption.ts`
 *
 * `encryption.ts` membaca `VITE_APP_SECRET` dari `import.meta.env`. `import.meta`
 * hanya ada di bundel ESM peramban; di bundel CJS server (hasil esbuild
 * `src/api/server.ts`) tidak ada kutipan itu, jadi modul itu tidak boleh ikut
 * terbawa ke jalur server.
 *
 * Yang di sini justru **harus** dipakai server: sejak autentikasi panel pindah
 * ke server (lihat `lib/panelServer.ts`), hashing dan verifikasi PIN adalah
 * pekerjaan server — bukan lagi pekerjaan peramban. Jadi fungsi-fungsi ini
 * dipisah ke modul yang bebas `import.meta`, dan `encryption.ts` meneruskannya
 * supaya pemanggil lama tidak ikut berubah.
 *
 * ## Bentuknya
 *
 * ```
 * hash   = bcrypt(SHA256(plain + SALT))
 * verify = bcrypt.compare(SHA256(plain + SALT), hash)
 * ```
 *
 * ⚠️ SHA-256 di tengah **harus deterministik**. Versi lama memakai
 * `bcrypt → SHA-256 → bcrypt`; karena bcrypt meng-hash dengan salt acak tiap
 * dipanggil, hash langkah pertama selalu berbeda sehingga `verifyPinLayered`
 * tidak pernah bisa cocok — login mustahil berhasil. SHA-256 dihitung lebih
 * dulu, lalu bcrypt (yang sudah menangani salt-nya sendiri lewat
 * `bcrypt.compare`) yang melindungi dari kamus.
 *
 * Salt-nya **tetap**, bukan per-akun: nilai yang sama dipakai klien dan
 * server supaya hash lama masih terverifikasi setelah pindah ke server.
 */

import CryptoJS from 'crypto-js';
import bcrypt from 'bcryptjs';

/**
 * Salt tetap untuk hashing PIN.
 *
 * ⚠️ JANGAN diubah. Mengganti string ini membuat seluruh `passwordHash` yang
 * sudah tersimpan tidak bisa diverifikasi lagi — semua orang terkunci dari
 * panel tanpa cara masuk. Sama seperti kunci enkripsi, ini nilai yang harus
 * tetap selamanya.
 */
export const PIN_SALT = 'epresensi-jatim-pin-salt-v1';

/** SHA-256 deterministik + salt. Satu-satunya tempat bentuk ini ditulis. */
function lapisSatu(plain: string): string {
  return CryptoJS.SHA256(`${plain}${PIN_SALT}`).toString(CryptoJS.enc.Hex);
}

export async function hashPinLayered(plain: string): Promise<string> {
  return bcrypt.hash(lapisSatu(plain), 10);
}

export async function verifyPinLayered(plain: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await bcrypt.compare(lapisSatu(plain), storedHash);
  } catch {
    return false;
  }
}
