import { unduhTeks } from './unduh';

/**
 * Penulis berkas Excel tanpa dependensi.
 *
 * ## Kenapa bukan `xlsx` / `exceljs`
 *
 * Dua pustaka spreadsheet yang umum menambah sekitar 400 kB ke bundel, dan
 * aplikasi ini sudah punya anggaran ukuran bundel yang dijaga
 * (`cek-bundle-awal.mjs` masih memastikan SDK Firebase tidak ikut terbawa di
 * muatan awal). Untuk satu laporan berisi ratusan baris, itu harga yang tidak
 * sepadan.
 *
 * Yang dipakai di sini adalah **SpreadsheetML 2003** — format XML milik
 * Microsoft yang tetap dibuka sebagai dokumen Excel sungguhan oleh Excel,
 * LibreOffice, dan Google Sheets, tanpa peringatan "formatnya berbeda".
 *
 * ## Kelebihannya untuk laporan absensi
 *
 * - Angka ditulis `ss:Type="Number"`, jadi kolom Jarak bisa dijumlahkan dan
 *   diurutkan di dalam Excel. CSV menyimpan segalanya sebagai teks.
 * - Beberapa lembar dalam satu berkas, jadi riwayat dan rekap bisa ikut
 *   diunduh sekaligus.
 * - Baris kepala bisa dibekukan dan lebar kolom bisa diatur, jadi laporan
 *   60 halaman tidak perlu digulir ke atas untuk tahu kolom apa yang sedang
 *   dibaca.
 *
 * ## Keamanan
 *
 * Sel bertipe `String` di SpreadsheetML **bukan** rumus — rumus butuh
 * `ss:Formula`. Jadi teks seperti `=HYPERLINK(...)` yang muncul di kolom
 * "Nama" diekspor sebagai teks biasa dan tidak pernah dieksekusi.
 *
 * Kebalikannya CSV: di sana Excel membaca sel yang diawali `=`, `+`, `-`, atau
 * `@` sebagai rumus. `selCsv` di bawah menutup celah itu.
 */

/** Satu sel: teks, atau angka yang boleh dihitung Excel. */
export type SelExcel = string | number | null | undefined;

export interface LembarExcel {
  /** Nama lembar. Maksimal 31 karakter, tanpa `[]:*?/\`. */
  nama: string;
  /** Baris kepala. */
  header: string[];
  /** Isi tabel. Panjang baris boleh lebih pendek dari `header`. */
  baris: SelExcel[][];
  /** Lebar kolom dalam satuan karakter Excel. */
  lebar?: number[];
}

/** Batas nama lembar di Excel. Lebih panjang dipotong oleh Excel sendiri. */
const MAKS_NAMA_LEMBAR = 31;

/**
 * Karakter yang tidak boleh muncul di XML 1.0.
 *
 * Satu karakter korup saja membuat `XMLReader` menolak **seluruh** dokumen,
 * jadi berkasnya gagal dibuka sama sekali — bukan hanya selnya yang kosong.
 * Karakter begitu bisa datang dari data server, bukan dari kode ini, jadi
 * dibuang di satu tempat.
 */
const KARAKTER_TIDAK_SAH = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Escape teks untuk isi XML. */
function escapeXml(teks: string): string {
  return teks
    .replace(KARAKTER_TIDAK_SAH, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Nama lembar yang sah.
 *
 * Excel menolak `[]:*?/\` di nama lembar, dan memotong nama lebih dari 31
 * karakter. Dua-duanya gagal tanpa pesan yang berguna di beberapa versi,
 * jadi dirapikan di sini supaya berkasnya benar-benar bisa dibuka.
 */
export function bersihkanNamaLembar(nama: string): string {
  const bersih = nama.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (bersih || 'Lembar').slice(0, MAKS_NAMA_LEMBAR);
}

/**
 * Satu sel.
 *
 * Angka harus jadi `Number`; sisanya `String`. `NaN` dan `Infinity` **tidak**
 * boleh jadi `Number` — Excel menolaknya dengan pesan yang tidak berguna, jadi
 * diperlakukan sebagai teks kosong saja.
 */
function selXml(nilai: SelExcel, gaya?: string): string {
  const atributGaya = gaya ? ` ss:StyleID="${gaya}"` : '';
  if (typeof nilai === 'number' && Number.isFinite(nilai)) {
    return `<Cell${atributGaya}><Data ss:Type="Number">${nilai}</Data></Cell>`;
  }
  /*
   * `NaN` jadi sel kosong, bukan teks "NaN".
   *
   * `NaN` muncul ketika `jarak` di server bukan angka — kolom Jarak dibaca
   * dari string yang tidak bisa diurai. Ditampilkan apa adanya, kalimat
   * "NaN" terbaca di lembar kerja sebagai kegagalan perhitungan, padahal
   * laporan ini memang tidak punya angka untuk sel itu. Kosongkan saja: itu
   * yang dimaksud di Excel, dan tidak perlu ditafsirkan lebih jauh.
   */
  const kosong =
    nilai === null ||
    nilai === undefined ||
    (typeof nilai === 'number' && !Number.isFinite(nilai));
  const teks = kosong ? '' : String(nilai);
  return `<Cell${atributGaya}><Data ss:Type="String">${escapeXml(teks)}</Data></Cell>`;
}

/**
 * Bekukan baris kepala.
 *
 * Tanpa ini, menggulir 60 halaman laporan berarti kembali ke atas setiap kali
 * ingin tahu kolom mana yang sedang dibaca.
 */
const BEKU_PANEL =
  '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">' +
  '<FreezePanes/><SplitHorizontal>1</SplitHorizontal>' +
  '<TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane>' +
  '</WorksheetOptions>';

/** Tabel satu lembar: lebar kolom, baris kepala, lalu isi. */
function tabelXml(lembar: LembarExcel): string {
  const kolom = (lembar.lebar ?? []).map(w => `<Column ss:Width="${w}"/>`).join('');

  /*
   * Kepala ditulis dengan `ss:Index="1"` supaya Excel memandangnya sebagai
   * kepala saat memfilter. Tanpa itu, filter otomatis menganggap baris pertama
   * sebagai data — dan "Nama" ikut terfilter bersama nama pegawai.
   */
  const kepala = `<Row ss:Index="1">${lembar.header.map(h => selXml(h, 'kepala')).join('')}</Row>`;

  const isi = lembar.baris
    .map((baris, i) => {
      const sel: string[] = [];
      // Panjang baris dipaksa sama dengan `header`, jadi kolom yang tidak
      // terisi tidak membuat Excel menggeser kolom berikutnya ke atas.
      for (let k = 0; k < lembar.header.length; k++) sel.push(selXml(baris[k]));
      // `Index` berbasis 1 dan kepala sudah memakai 1, jadi data pertama = 2.
      return `<Row ss:Index="${i + 2}">${sel.join('')}</Row>`;
    })
    .join('');

  const nama = escapeXml(bersihkanNamaLembar(lembar.nama));
  return `<Worksheet ss:Name="${nama}"><Table>${kolom}${kepala}${isi}</Table>${BEKU_PANEL}</Worksheet>`;
}

/**
 * Susun satu berkas Excel berisi satu atau beberapa lembar.
 *
 * Berisi deklarasi `progid="Excel.Sheet"` — tanpa itu Excel membuka berkas
 * `.xls` dengan peringatan "formatnya mungkin tidak cocok dengan ekstensi".
 */
export function susunExcel(lembar: LembarExcel[]): string {
  const isiLembar = lembar.map(tabelXml).join('');

  const gaya = [
    '<Styles>',
    '<Style ss:ID="Default" ss:Name="Normal">',
    '<Alignment ss:Vertical="Center"/>',
    '<Font ss:FontName="Calibri" ss:Size="11"/>',
    '</Style>',
    '<Style ss:ID="kepala">',
    '<Font ss:Bold="1" ss:Color="#1E293B"/>',
    '<Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>',
    '<Alignment ss:Vertical="Center" ss:WrapText="1"/>',
    '</Style>',
    '</Styles>',
  ].join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    gaya +
    isiLembar +
    '</Workbook>'
  );
}

/** Unduh satu atau beberapa lembar sebagai `.xls` (SpreadsheetML 2003). */
export function unduhExcel(namaBerkas: string, lembar: LembarExcel[]): void {
  const nama = namaBerkas.endsWith('.xls') ? namaBerkas : namaBerkas + '.xls';
  unduhTeks(nama, susunExcel(lembar), 'application/vnd.ms-excel');
}

/**
 * Sel CSV yang aman.
 *
 * ⚠️ Awalan `=`, `+`, `-`, dan `@` membuat Excel memperlakukan sel sebagai
 * rumus. Nama seperti `=HYPERLINK("http://x","klik")` akan dieksekusi begitu
 * berkasnya dibuka — dan peringatan keamanannya sudah lama diabaikan karena
 * file-nya memang diunduh sendiri.
 *
 * Awalan kutip tunggal memaksa Excel memperlakukannya sebagai teks. Isi aslinya
 * tetap utuh; kutip tunggal hanya diabaikan saat ditampilkan.
 */
export function selCsv(nilai: unknown): string {
  let teks = nilai === null || nilai === undefined ? '' : String(nilai);
  if (/^[=+\-@\t\r]/.test(teks)) teks = "'" + teks;
  return '"' + teks.replace(/"/g, '""') + '"';
}
