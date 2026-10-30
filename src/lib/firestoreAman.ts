/**
 *ulisan Firestore yang aman dari `undefined`.
 *
 * ## Bug yang menutupi modul ini
 *
 * Firestore **menolak** nilai `undefined`:
 *
 * ```
 * Function setDoc() called with invalid data.
 * Unsupported field value: undefined (found in field alasanGratis
 * in document jatim_langganan/basith)
 * ```
 *
 * Itu bukan kode yang ditulis salah — `alasanGratis: lama?.alasanGratis`
 * benar secara TypeScript, karena `DokumenLangganan` memang declares
 * `alasanGratis?: string`. Tapi `?.` mengembalikan `undefined` saat dokumen
 * lama belum punya field itu, dan Firestore memperlakukan `undefined`
 * sebagai "nilai tidak valid", bukan "hapus field".
 *
 * Yang membuat bug ini sulit dicari: field tersebut **opsional**. TypeScript tidak
 * pernah mengeluh, dan dokumen yang sudah punya field-nya berjalan
 * normal. Gagal hanya pada akun yang belum pernah disentuh — yaitu akun yang
 * baru dibuat, persis akun yang paling banyak dipakai saat pengujian.
 *
 * ## Kenong tidak per-field
 *
 * Ada belasan fungsi tulis di `langganan.ts` dan `userManager.ts`, dan
 * semuanya memakai pola `lama?.field` yang sama. Menambal satu field
 * berarti menambal ulang di empat belas tempat lain setiap kali ada field
 * baru.
 * Jadi semua tulisan difilter lewat sini: `undefined` dihapus di seluruh
 * kedalaman, `null` (yang berarti "hapus field" dan memang sah) dibiarkan.
 *
 * `Date`, `Buffer`, dan kelas lain **dibiarkan utuh** — Firestore menyimpan
 * semuanya apa adanya, dan membongkar `Date` jadi objek kosong akan merusak
 * nilainya. Hanya objek biasa dan array yang disaring.
 */

/** Adakah nilai ini objek polos (bukan `Date`, `Buffer`, atau instance kelas)? */
function objekPolos(nilai: unknown): nilai is Record<string, unknown> {
  if (nilai === null || typeof nilai !== 'object') return false;
  const proto = Object.getPrototypeOf(nilai);
  return proto === Object.prototype || proto === null;
}

/** Buang `undefined` dari satu nilai, rekursif. Panjang lingkaran dibatasi. */
function bersihkanNilai(nilai: unknown, dalam: number): unknown {
  // Batas kedalaman menjaga agar data yang saling menunjuk tidak berputar
  // tanpa henti. Nilai yang terlalu dalam diteruskan apa adanya — lebih baik
  // daripada stack overflow, dan Firestore akan menolak datanya sendiri.
  if (dalam > 20) return nilai;
  if (Array.isArray(nilai)) {
    return nilai.map(item => bersihkanNilai(item, dalam + 1));
  }
  if (!objekPolos(nilai)) return nilai;
  const hasil: Record<string, unknown> = {};
  for (const [kunci, isi] of Object.entries(nilai)) {
    if (isi === undefined) continue;
    hasil[kunci] = bersihkanNilai(isi, dalam + 1);
  }
  return hasil;
}

/**
 * Buang `undefined` dari objek, **sepanjang seluruh kedalaman**.
 *
 * Ini dulu hanya satu level, dan satu level itu tidak cukup: `undefined`
 * tidak pernah muncul di field atas dokumen saja. Firestore menolaknya di
 * mana pun dalam dokumen — termasuk di dalam objek yang tersimpan di dalam
 * array. Gejalanya tetap sama, hanya jalannya lebih jauh:
 * `found in field paket.0.keterangan` gagal padahal `paket` sendiri sudah
 * bersih, karena `keterangan` di dalam tiap paket masih `undefined`.
 *
 * Yang tidak ditembus adalah `Date`, `Buffer`, dan instance kelas lain —
 * semuanya bukan objek polos, jadi diteruskan apa adanya.
 */
export function bersihkanUndefined<T extends Record<string, any>>(data: T): Partial<T> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (data === null || data === undefined) return {} as Partial<T>;
  if (!objekPolos(data)) return data as Partial<T>;

  const hasil: Record<string, any> = {};
  for (const [kunci, nilai] of Object.entries(data)) {
    if (nilai === undefined) continue;
    if (Array.isArray(nilai)) {
      // Elemen `undefined` di dalam array dihapus, dan tiap elemen objek
      // ikut disaring — Firestore menyimpan array apa adanya, jadi
      // `undefined` di dalam elemennya tetap tidak valid.
      hasil[kunci] = nilai
        .filter(item => item !== undefined)
        .map(item => bersihkanNilai(item, 1));
      continue;
    }
    hasil[kunci] = bersihkanNilai(nilai, 1);
  }
  return hasil as Partial<T>;
}
