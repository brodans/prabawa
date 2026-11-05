/**
 * Dua cara mengunduh berkas dari peramban, di satu tempat.
 *
 * Semula `unduhTeks` hidup di `excelXml.ts`. Ketika PDF ikut dibuat, jsPDF punya
 * jalurnya sendiri — `doc.save()`, yang memakai pustaka simpan-berkas internal
 * dan tidak bisa diperiksa di sini. Dua jalur unduhan yang berbeda berarti dua
 * tempat untuk salah urus object URL, dan salah urus object URL berarti berkas
 * 0 byte yang tidak bisa dijelaskan.
 *
 * Jadi keduanya memakai satu fungsi, dan PDF pun lewat sini.
 */

/** Karakter yang tidak boleh muncul di nama berkas. */
const KARAKTER_NAMA = /[/\\:*?"<>|]/g;

/**
 * Nama berkas yang aman untuk peramban dan sistem berkas di belakangnya.
 *
 * Nama yang mengandung `/` ditafsirkan sebagai path, dan yang mengandung
 * `:` sebagai drive Windows. Keduanya membuat berkas mendarat di tempat
 * yang tidak seharusnya, atau hilang tanpa jejak.
 */
export function bersihkanNamaBerkas(nama: string): string {
  const bersih = nama.replace(KARAKTER_NAMA, '-').replace(/\s+/g, ' ').trim();
  return (bersih || 'unduh').slice(0, 120);
}

/**
 * Unduh teks sebagai berkas.
 *
 * PENTING: `URL.revokeObjectURL` harus dipanggil SETELAH `link.click()`, bukan
 * sebelumnya. `click()` hanya menjadwalkan navigasi; object URL yang sudah
 * dicabut sebelum jadwal itu berjalan menghasilkan berkas 0 byte.
 */
export function unduhTeks(namaBerkas: string, isi: string, mime: string): void {
  unduhBlob(namaBerkas, new Blob([isi], { type: mime + ';charset=utf-8;' }));
}

/** Unduh `Blob` apa pun sebagai berkas — dipakai juga oleh PDF. */
export function unduhBlob(namaBerkas: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = bersihkanNamaBerkas(namaBerkas);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
