/**
 * Uji DatePicker + tata letak halaman yang memakainya.
 *
 * Dua hal yang diverifikasi, keduanya soal regresi yang sulit terlihat
 * dari kode saja:
 *
 * 1. **Popup lewat portal.** `DatePicker` dipakai di dalam `Modal`
 *    (form Perizinan), dan body modal diberi `overflow-y-auto`. Kalau
 *    popup-nya `absolute`, kalender terpotong di tepi panel. Jadi popup
 *    wajib `createPortal` ke `document.body` + `position: fixed`.
 * 2. **Pemilih bulan/tahun jadi grid.** Dua `Dropdown` di header dulu
 *    membuat panel tinggi dan sempit, dan tiap `Dropdown` membawa popup
 *    + animasinya sendiri. Sekarang keduanya grid di panel yang sama.
 *
 * Bagian tata letak (kolom tanggal RiwayatIzin, kartu penyaring Laporan)
 * diuji sebagai assertion statis: lebar kolom dipatok, tidak ada lagi
 * `col-span` yang menyisakan kolom kosong, dan tombol utama tidak lagi
 * sendirian di baris `justify-end`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const baca = (p: string): string => readFileSync(join(root, p), 'utf8');
const dp = baca('src/components/ui/DatePicker.tsx');
const css = baca('src/index.css');
const riwayat = baca('src/pages/RiwayatIzin.tsx');
const laporan = baca('src/pages/Laporan.tsx');
const perizinan = baca('src/pages/Perizinan.tsx');

// ═════════════════════════════════════════════════════════════════════
console.log('=== Popup dirender lewat portal (fixed, bukan absolute)');
cek('pakai createPortal', dp.includes('createPortal'));
cek('pakai <Portal> ke document.body', /createPortal\([\s\S]*?document\.body/.test(dp));
cek('popup position: fixed', /position:\s*'fixed'/.test(dp));
cek('popup bukan absolute', !/absolute[^"]*z-\[9999\]/.test(dp));
cek('ada overlay penutup layar penuh', /fixed inset-0 z-\[9998\]/.test(dp));
cek('z-index popup di atas modal (z-95)', /z-\[9999\]/.test(dp));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Panel membalik ke atas kalau ruang di bawah tidak cukup');
cek('mengukur tinggi panel', dp.includes('popupRef.current?.offsetHeight'));
cek('menghitung spaceBelow & spaceAbove', dp.includes('spaceBelow') && dp.includes('spaceAbove'));
cek('membalik ke atas', /openAbove/.test(dp));
cek('reposisi saat scroll', /addEventListener\('scroll', hitungPosisi, true\)/.test(dp));
cek('reposisi saat resize', /addEventListener\('resize', hitungPosisi\)/.test(dp));
cek('menghormati --dev-panel-right-offset', dp.includes('--dev-panel-right-offset'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Escape hanya menutup kalender, bukan modalnya');
cek('keydown dipasang fase capture', /addEventListener\('keydown', onKeyDown, true\)/.test(dp));
cek('stopPropagation di handler Escape', /onKeyDown[\s\S]{0,400}stopPropagation/.test(dp));
cek('listener dilepas dengan flag sama', /removeEventListener\('keydown', onKeyDown, true\)/.test(dp));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Bulan & tahun: grid, bukan Dropdown');
cek('sudah tidak mengimpor Dropdown', !/from '\.\/Dropdown'/.test(dp));
cek('tidak memakai <Dropdown>', !/<Dropdown[\s>]/.test(dp));
cek('ada view bulan', dp.includes("view === 'months'"));
cek('ada view tahun', dp.includes("view === 'years'"));
cek('grid bulan 3 kolom', /view === 'months'[\s\S]{0,600}grid-cols-3/.test(dp));
cek('grid tahun 3 kolom', /view === 'years'[\s\S]{0,600}grid-cols-3/.test(dp));
cek('jumlah tahun habis dibagi 3 (tinggi panel tetap)', /TAHUN_PER_GRID = 12/.test(dp));
cek('kembali ke tampilan hari setelah pilih', (dp.match(/setView\('days'\)/g) ?? []).length >= 3);
cek('panel kembali ke hari saat ditutup', /else \{\s*setView\('days'\);/.test(dp));
cek('tahun dihitung relatif tahun berjalan', /new Date\(\)\.getFullYear\(\)/.test(dp));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Animasi popup: keyframe sendiri, transform-only');
cek('ada keyframe popInBelow', css.includes('@keyframes popInBelow'));
cek('ada keyframe popInAbove', css.includes('@keyframes popInAbove'));
cek('kelas .animate-pop-in-below ada', css.includes('.animate-pop-in-below'));
cek('kelas .animate-pop-in-above ada', css.includes('.animate-pop-in-above'));
cek('popup memakai kelas itu', dp.includes('animate-pop-in-below') && dp.includes('animate-pop-in-above'));
cek('hanya opacity + transform', !/popIn(Below|Above)\s*\{[^}]*scale/.test(css));
cek('hormati prefers-reduced-motion', /prefers-reduced-motion[\s\S]{0,300}animate-pop-in-below/.test(css));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Batasan min/max tetap ditegakkan');
cek('min dipakai di pilihTanggal', /if \(min && iso < min\) return;/.test(dp));
cek('max dipakai di pilihTanggal', /if \(max && iso > max\) return;/.test(dp));
cek('sel di luar rentang didisable', /disabledDay/.test(dp));
cek('pintasan "Hari ini" ikut|max|', /disabled=\{Boolean\(max && todayIso > max\)\}/.test(dp));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Lebar: DatePicker tidak memaksa w-full sendiri');
// `w-full` bawaan akan mengalahkan `max-w-*` dari pemanggil depending on
// urutan CSS, jadi pemanggil yang menentukan lebar lewat `className`.
cek('tidak ada w-full hardcoded di wrapper', !/className=\{`relative w-full/.test(dp));
cek('wrapper menerima className', dp.includes('`relative ${className}`'));
for (const [file, nama] of [
  ['src/pages/Laporan.tsx', 'Laporan'],
  ['src/pages/RiwayatIzin.tsx', 'RiwayatIzin'],
  ['src/pages/Perizinan.tsx', 'Perizinan'],
]) {
  const isi = baca(file);
  const total = (isi.match(/<DatePicker/g) ?? []).length;
  const explicit = (isi.match(/<DatePicker\s+className="w-full/g) ?? []).length;
  cek(`${nama}: ${total} DatePicker, semua berlebar eksplisit`, total === explicit, `${explicit}/${total}`);
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== RiwayatIzin: kolom tanggal rapat, tidak melebar');
cek('kolom Periode dipatok lebarnya', /key: 'periode'[\s\S]{0,400}w-\[190px\]/.test(riwayat));
cek('kolom Diajukan dipatok', /key: 'diajukan'[\s\S]{0,200}w-\[120px\]/.test(riwayat));
cek('kolom Status dipatok', /key: 'status'[\s\S]{0,200}w-\[132px\]/.test(riwayat));
cek('kolom Pengaju ditambahkan', riwayat.includes("key: 'nama'"));
cek('kolom Periode tidak lagi satu baris nowrap', !/whitespace-nowrap[\s\S]{0,80}→/.test(riwayat));
cek('PeriodeCell dipakai', riwayat.includes('<PeriodeCell row={row} />'));
cek('PeriodeCell dua baris', /function PeriodeCell[\s\S]{0,900}<p className="font-semibold/.test(riwayat));
cek('tanggal satu hari diberi label', /satu hari/.test(riwayat));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== RiwayatIzin: tidak ada celah kosong menganga');
cek('tidak lagi pakai justify-between untuk penyaring', !/sm:items-end sm:justify-between/.test(riwayat));
cek('kelompok tanggal dikuncilebarnya', /grid grid-cols-1 sm:grid-cols-2 flex-1 max-w-md/.test(riwayat));
cek('filter status dipisah baris', /Status Pengajuan/.test(riwayat));
cek('filter status menampilkan jumlah', riwayat.includes('jumlahStatus('));
cek('tombol Tampilkan punya status memuat', riwayat.includes('loading={loading}'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Laporan: kartu penyaring penuh, tanpa kolom kosong');
cek('tidak lagi lg:col-span-2 pada Jenis Laporan', !/label="Jenis Laporan" className="lg:col-span-2"/.test(laporan));
cek('grid tiga kolom sejak layar kecil', /grid grid-cols-1 sm:grid-cols-3 gap-4/.test(laporan));

/*
 * ⚠️ Tiga field, bukan empat.
 *
 * Semula penyaring Laporan punya empat field: Jenis Laporan, Dari, Sampai, dan
 * "Format Unduhan", dibagi 4 + 2 + 2 + 4 di atas grid 12 kolom. Field
 * terakhirnya **dihapus** karena nilainya tidak pernah dibaca apa pun — tombol
 * "Cetak" selalu mencetak dan "Ekspor" selalu mengunduh CSV, apa pun yang
 * dipilih — sementara mengubahnya menyalakan ulang `hasLoadedOnce` sehingga
 * satu pilihan menembakkan ulang seluruh 1 + jumlah hari request
 * `history_absen` (sampai 63) untuk data yang hasilnya identik.
 *
 * Efeknya: tiga field, tiga kolom. Yang dijaga di sini adalah aturan aslinya,
 * yaitu setiap field mendapat ruang yang sama dan tidak ada kolom yang
 * dikunci di bawah 3/12 — karena itulah yang membuat `DatePicker` (ikon
 * kalender + tanggal + chevron) terpotong di lebar tablet.
 */
{
  cek('tidak ada lagi kolom kosong di baris penyaring',
    !/label="Jenis Laporan" className="lg:col-span-/.test(laporan),
    'tiga field, tiga kolom — tidak perlu lagi span eksplisit');
  // Nama "Format Unduhan" masih boleh muncul di **komentar** yang menjelaskan
  // kenapa field itu dihapus, jadi yang diperiksa adalah pemakaiannya.
  cek('tidak ada lagi field "Format Unduhan"',
    !/aria-label="Format unduhan"/.test(laporan) && !/patch\(\{ format/.test(laporan),
    'nilainya tidak pernah dibaca; hanya menambah satu kolom dan satu muatan ulang');
  cek('kedua tanggal tidak lagi dipatok di bawah 3 kolom',
    !/label="(?:Dari|Sampai) Tanggal"[\s\S]{0,200}?lg:col-span-[12]/.test(laporan),
    'di bawah 3/12 tanggal terpotong — itu yang dilaporkan sebagai "kolom tanggal kepotong"');
  cek('tidak ada eksplisit span < 3 di mana pun pada penyaring',
    ![...laporan.matchAll(/lg:col-span-([12])\b/g)].length,
    'porsi satu atau dua kolom tidak pernah dipakai untuk field penyaring');
}
cek('ada label Rentang cepat', laporan.includes('Rentang cepat'));
cek('baris aksi dipisah dengan border', /border-t border-slate-100 dark:border-slate-700\/60 pt-4/.test(laporan));
cek('Dari tidak lagi dibatasi ke +365 hari', /label="Dari Tanggal"[\s\S]{0,300}max=\{dateEnd\}/.test(laporan));
cek('Sampai dibatasi ke +365 hari', /label="Sampai Tanggal"[\s\S]{0,300}max=\{getTodayWIBWithDaysOffset\(365\)\}/.test(laporan));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Laporan: tiga format unduhan, semuanya benar-benar jalan');
/*
 * Semula ada dropdown "Format Unduhan" yang menjanjikan "Excel / CSV",
 * padahal nilainya tidak pernah dibaca: tombol Ekspor selalu menghasilkan
 * CSV. Dropdown-nya dihapus, dan pertanyaannya — "di mana ekspor Excel-nya?"
 * — dijawab dengan memberi opsi yang benar-benar menulis format Excel.
 *
 * Tiga hal yang harus tetap dijaga:
 *
 * 1. **Headernya dibagi satu sumber.** Semula CSV dan Excel masing-masing
 *    punya daftar header sendiri; dua daftar itu bisa menyimpang. Sekarang
 *    `HEADER_RIWAYAT` dan `HEADER_REKAP` dipakai berdua.
 * 2. **Kolom yang bisa dihitung tetap angka.** Kalau `jarak` diekspor sebagai
 *    teks, seluruh POINT export Excel jadi tidak berguna untuk rekap.
 * 3. **Tiga format, satu tombol.** Tidak seperti tiga tombol terpisah — di
 *    360 px, baris aksinya meluber. Detailnya di bawah.
 */
{
  const excelSrc = baca('src/lib/excelXml.ts');
  /*
   * ⚠️ Tiga format, **satu** tombol.
   *
   * Semula ada tombol "Excel", tombol "CSV", dan tombol "Cetak" berdampingan.
   * Di layar 360 px yang tersedia hanya 328 px, jadi tombol terakhir terdorong
   * keluar viewport tanpa ada yang memberi tahu — persis keluhan "mepet di
   * kanan".
   *
   * Sekarang satu `TombolMenu` berlabel "Ekspor" dengan tiga opsi. Yang dijaga
   * di sini bukan jumlahnya, tapi **isi** menunya: ketiga format harus benar-benar
   * menulis formatnya, dan tidak boleh ada lagi format keempat yang hilang
   * (dropdown "Format Unduhan" sudah dihapus karena nilainya tidak pernah dibaca).
   *
   * Ekstensi ikut disebut di setiap opsi. "Excel" tanpa ekstensi ambigu —
   * banyak aplikasi memanggil `.csv` itu "Excel".
   */
  /*
   * Opsi dibaca per-objek, bukan dengan searches berkarakter. Jendela
   * `[\s\S]{0,200}` pernah gagal bukan karena menunya salah, tapi karena ada
   * komentar penjelasan di antara `label` dan `hint`. Yang diuji memang
   * substansinya: tiap opsi punya label, hint, dan onClick-nya sendiri — dan
   * tidak ada opsi keempat yang tersembunyi.
   */
  const opsiEkspor = new Map();
  for (const blok of laporan.split(/\bid: '/).slice(1)) {
    opsiEkspor.set(blok.slice(0, blok.indexOf("'")), blok);
  }
  cek('satu tombol "Ekspor" dengan tiga opsi format',
    (laporan.match(/<TombolMenu/g) ?? []).length === 1 &&
    /label="Ekspor"/.test(laporan),
    'tiga tombol terpisah totalnya ±354 px — di 360 px tombol terakhir keluar layar');
  for (const [id, format, ekstensi] of [
    ['excel', 'Excel', '\\.xls'],
    ['pdf', 'PDF', '\\.pdf'],
    ['csv', 'CSV', '\\.csv'],
  ]) {
    const opsi = opsiEkspor.get(id) ?? '';
    cek(`opsi ${format} ada di menu Ekspor`,
      new RegExp(`label: '${format}'`).test(opsi) && /onClick:/.test(opsi),
      `${format} harus punya onClick-nya sendiri, bukan label yang tidak`);
    cek(`opsi ${format} menyebut ekstensi berkasnya`,
      new RegExp(`hint: '[^']*${ekstensi}`).test(opsi),
      `tanpa ekstensi, pengguna menebak format mana yang diunduh`);
  }
  cek('menu Ekspor tidak punya opsi keempat',
    opsiEkspor.size === 3,
    `terdaftar ${opsiEkspor.size} opsi — ada format yang hilang tanpa jejak`);
  cek('tidak ada tombol format terpisah di luar menu',
    !/label="Excel"[\s\S]{0,80}ActionButton/.test(laporan) &&
    !/label="CSV"[\s\S]{0,80}ActionButton/.test(laporan),
    'format yang punya tombol sendiri lagi berarti tombol keempat di baris aksi');
  cek('aksi Laporan mati saat tabel kosong',
    (laporan.match(/disabled=\{visible\.length === 0\}/g) ?? []).length === 2,
    'Cetak dan Ekspor punya syarat yang sama — nol baris tidak bisa dicetak');
  cek('tidak ada lagi dropdown "Format Unduhan" yang menggantung',
    !/aria-label="Format unduhan"/.test(laporan) && !/patch\(\{ format/.test(laporan));
  cek('kepala tabel didefinisikan sekali lalu dipakai berdua',
    /const HEADER_RIWAYAT = \[/.test(laporan) && /const HEADER_REKAP = \[/.test(laporan) &&
    /function riwayatCsv[\s\S]*?barisCsv\(HEADER_RIWAYAT/.test(laporan) &&
    /function rekapCsv[\s\S]*?barisCsv\(HEADER_REKAP/.test(laporan),
    'dua daftar header = dua berkas yang bisa berbeda isi');
  cek('kolom Jarak diekspor sebagai angka, bukan teks',
    /jarak,\n  \]\)/.test(laporan),
    'kalau teks, kolom Jarak tidak bisa dijumlahkan di Excel');
  cek('ekspor Excel menulis dua lembar sekaligus',
    /lembarRiwayat\(filtered\)[\s\S]*?lembarRekap\(rekap\)/.test(laporan),
    'rekap harian yang sudah dihitung tidak perlu dicari ulang di berkas lain');
  cek('penulis Excel tanpa dependensi baru',
    /ss:Type="Number"/.test(excelSrc) &&
    /progid="Excel\.Sheet"/.test(excelSrc) &&
    !/from '(xlsx|exceljs|sheetjs)'/.test(excelSrc),
    'pustaka spreadsheet menambah sekitar 400 kB ke muatan awal');
  cek('baris kepala dibekukan dan lebarnya diatur',
    /<Column ss:Width=/.test(excelSrc) && /FreezePanes/.test(excelSrc));
  /*
   * ⚠️ Unduhan pindah ke `src/lib/unduh.ts` — satu fungsi untuk teks, Excel, dan
   * PDF. Semula tiap format punya jalurnya sendiri (jsPDF memakai `doc.save()`),
   * jadi ada dua tempat untuk salah urus object URL, dan salah urus object URL
   * berarti berkas 0 byte tanpa pesan apa pun.
   */
  const unduhSrc = baca('src/lib/unduh.ts');
  cek('semua unduhan lewat satu fungsi', /export function unduhTeks/.test(unduhSrc) &&
    /export function unduhBlob/.test(unduhSrc) && /unduhTeks\(nama, susunExcel/.test(excelSrc),
    'dua jalur unduhan = dua tempat untuk salah urus object URL');
  cek('PDF pun lewat unduhBlob, bukan doc.save()',
    /unduhBlob\(/.test(baca('src/lib/pdfTabel.ts')) && !/doc\.save\(/.test(baca('src/lib/pdfTabel.ts')),
    'doc.save() memakai pustaka internal yang tidak bisa diperiksa di sini');
  cek('URL objek dicabut setelah tautan diklik',
    (unduhSrc.match(/URL\.revokeObjectURL\(url\)/g) ?? []).length === 1 &&
    unduhSrc.indexOf('link.click()') < unduhSrc.indexOf('URL.revokeObjectURL(url)'),
    'revoke sebelum click menghasilkan berkas 0 byte');
  cek('nama berkas dibersihkan sebelum jadi link.download',
    /bersihkanNamaBerkas/.test(unduhSrc) && /link\.download = bersihkanNamaBerkas/.test(unduhSrc),
    'nama berisi "/" atau ":" membuat berkas mendarat di tempat yang tidak seharusnya');
  cek('nama lembar dibersihkan sebelum ditulis',
    /bersihkanNamaLembar/.test(excelSrc) && /MAKS_NAMA_LEMBAR/.test(excelSrc),
    'nama >31 karakter ditolak Excel tanpa pesan yang berguna');
  /*
   * ⚠️ `flex-wrap` **dan** `shrink-0` — keduanya wajib, dan alasan keduanya
   * berbeda.
   *
   * `flex-wrap`: baris aksi pernah lewat tiga tombol. Empat tombol "Muat Ulang,
   * Cetak, Excel, CSV" totaling ±354 px, dan di layar 360 px yang tersedia hanya
   * 328 px — tombol terakhir terdorong keluar viewport tanpa ada yang memberi tahu.
   * Sekarang tinggal "Cetak" + "Ekspor", tapi `Muat Ulang` masih ikut dan
   * `flex-wrap` tidak yang menahan.
   *
   * `shrink-0`: tanpa itu, yang ditekan lebih dulu adalah **tombolnya**, bukan
   * judul. Judul sudah punya `min-w-0` + `truncate` jadi aman menyusut; tombol
   * tidak — label "Muat Ulang" lalu turun ke dua baris di dalam tombol setinggi
   * 30 px, dan terakhir hurufnya terpotong. Itu tampilan yang paling sering
   * dilaporkan sebagai "mepet di kanan".
   */
  cek('grup aksi PageHeader boleh membungkus di layar sempit',
    /flex[^"']*flex-wrap[^"']*items-center[^"']*gap-2[^"']*sm:justify-end/.test(baca('src/components/ui/Surface.tsx')),
    'tanpa wrap tombol terakhir terdorong keluar layar');
  cek('grup aksi PageHeader tidak boleh ikut tergesot',
    /flex[^"']*shrink-0[^"']*flex-wrap/.test(baca('src/components/ui/Surface.tsx')),
    'tanpa shrink-0, tombol yang menyusut lebih dulu dari judul — labelnya jadi dua baris');
  cek('sel CSV dilindungi dari injeksi rumus',
    /\^\[=\+\\-\@\\t\\r\]/.test(excelSrc) && /selCsv/.test(laporan),
    'nama diawali "=" dieksekusi Excel saat CSV dibuka');
}

/*
 * ═══ Xml-nya benar-benar boleh dibuka ═══════════════════════════════════
 *
 * SpreadsheetML bukan HTML: satu karakter `&` atau `<` yang tidak di-escape
 * membuat `XMLReader` menolak **seluruh** dokumen, jadi berkasnya gagal dibuka
 * sama sekali — bukan hanya selnya yang kosong. Satu nama pegawai berisi "&"
 * sudah cukup untuk membuat unduhan itu tidak berguna.
 *
 * `xmlish()` di bawah adalah pemeriksa bentuk tag yang cukup untuk menangkap itu:
 * ia menolak kurung sudut telanjang di luar tag, `&` yang tidak diikuti
 * entity, dan tag yang tidak tertutup. Ini bukan parser XML penuh, dan tidak perlu —
 * yang diuji justru apa yang bisa merusak dokumen.
 */
{
  const { susunExcel, bersihkanNamaLembar, selCsv } = await import(
    join(root, 'src/lib/excelXml.ts')
  );

  /*
   * `<?xml …?>` dan `<?mso-application …?>` ikut dicocokkan sebagai "tag".
   * Tanpa itu keduanya terbaca sebagai kurung sudut telanjang, dan setiap
   * berkas yang dihasilkan pasti ditolak — bukan karena berkasnya rusak.
   */
  const xmlish = (xml: string) => {
    const tag = /<\?[^<>]*\?>|<\/?([A-Za-z][\w:.-]*)(\s[^<>]*?)?\/?>/g;
    const tumpuk = [];
    let sawTag = false;
    let last = 0;
    let m;
    while ((m = tag.exec(xml)) !== null) {
      sawTag = true;
      // Teks di antara dua tag harus bebas kurung sudut dan `&` telanjang.
      const teks = xml.slice(last, m.index);
      if (/[<>]/.test(teks)) return false;
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(teks)) return false;
      if (m[1] === undefined) {
        // Instruksi pemrosesan `<?…?>`: tidak punya nama tag, jadi tidak
        // ikut berpasangan. Melewatinya, bukan pushing `undefined`.
      } else if (m[0].startsWith('</')) {
        if (tumpuk.pop() !== m[1]) return false;
      } else if (!m[0].endsWith('/>')) {
        tumpuk.push(m[1]);
      }
      last = m.index + m[0].length;
    }
    return sawTag && tumpuk.length === 0 && !/[<>]/.test(xml.slice(last));
  };

  const contoh = susunExcel([
    {
      nama: 'Riwayat',
      header: ['Nama', 'Jarak', 'Catatan'],
      baris: [
        ['Budi Santoso, S.Pd.', 12.5, '=HYPERLINK("http://x","klik")'],
        ['Siti & Amin <b> "kutip"', 0, ''],
        ['\u0000kendali', Number.NaN, null],
        ['الصفة العربية', 7, 'a\tb\rc'],
      ],
      lebar: [200, 64, 120],
    },
    { nama: 'Rekap Harian', header: ['Tanggal', 'Status'], baris: [['2026-09-30', 'Hadir']] },
  ]);

  cek('berkas yang dihasilkan benar-benar berbentuk XML yang utuh',
    xmlish(contoh), 'tag tidak berpasangan atau ada karakter yang telanjang');
  cek('tanda kutip, & dan < dari data tetap utuh setelah dibuka',
    contoh.includes('&amp;') && contoh.includes('&lt;b&gt;') && contoh.includes('&quot;kutip&quot;'),
    'escape hilang = isi sel membuat seluruh dokumen rusak');
  cek('karakter kendali dibuang, bukan diteruskan ke XML',
    !/[\u0000-\u0008]/.test(contoh) && !contoh.includes('\u0000'),
    'satu karakter terlarang membuat Excel menolak seluruh berkas');
  cek('NaN tidak ditulis sebagai angka — Excel menolaknya tanpa pesan',
    !/ss:Type="Number">NaN/.test(contoh) && !/Infinity/.test(contoh));
  cek('angka tetap bertipe Number supaya bisa dijumlahkan',
    /<Data ss:Type="Number">12\.5<\/Data>/.test(contoh),
    'kalau teks, kolom Jarak tidak bisa dijumlahkan');
  cek('teks berawalan "=" tetap teks, bukan rumus',
    /<Data ss:Type="String">=HYPERLINK/.test(contoh) && !/ss:Formula/.test(contoh),
    'sel ini bertipe String, jadi Excel tidak memperlakukannya sebagai rumus');
  cek('nilai kosong ditulis sebagai String kosong, bukan sel hilang',
    /<Data ss:Type="String"><\/Data>/.test(contoh) &&
    (contoh.match(/<Cell[^>]*><\/Cell>/g) ?? []).length === 0,
    'sel yang hilang menggeser kolom berikutnya ke atas');
  cek('jumlah baris data = jumlah baris kepala + jumlah data',
    (contoh.match(/ss:Index="\d+"/g) ?? []).length === 4 + 2 + 1,
    'satu sel yang hilang membuat seluruh baris bergeser');
  cek('kepala ditulis sebagai baris 1 yang beku',
    /<Row ss:Index="1">/.test(contoh) && /FreezePanes/.test(contoh));
  cek('lebar kolom ditulis sesuai jumlah kolom',
    (contoh.match(/<Column ss:Width=/g) ?? []).length === 3);
  cek('nama lembar dipangkas 31 karakter dan dibuang karakternya terlarang',
    bersihkanNamaLembar('a'.repeat(60)).length === 31 &&
    bersihkanNamaLembar('Rekap [Harian] 2026/09') === 'Rekap Harian 2026 09',
    JSON.stringify(bersihkanNamaLembar('Rekap [Harian] 2026/09')));
  cek('nama lembar kosong tidak boleh kosong',
    bersihkanNamaLembar('   ') === 'Lembar');
  cek('hanya sel berawalan rumus yang diberi awalan kutip pada CSV',
    selCsv('=1+1') === '"\'=1+1"' && selCsv('Budi') === '"Budi"' && selCsv('+a') === '"\'+a"',
    JSON.stringify([selCsv('=1+1'), selCsv('Budi'), selCsv('+a')]));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== tidak ada utilitas Tailwind yang tidak dipakai');
// `xs:` breakpoint tidak didefinisikan di tailwind v4 tanpa config, jadi
// kelas `xs:grid-cols-2` tidak pernah berlaku.
cek('tidak pakai breakpoint xs: (tak terdefinisi)', !/\bxs:/.test(riwayat + laporan + perizinan + dp));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 15. Gaya kalender klasik dihapus seluruhnya');
/*
 * Permintaan eksplisit: "hilangkan aja fitur kalender dropdown klasik
 * seluruhnya", termasuk dari menu Pengaturan di modal.
 *
 * Semuanya dihapus, bukan disembunyikan:
 *
 * - `datePickerStyle` / `setDatePickerStyle` dari `AppContext`
 * - prefs `jatim_date_picker_style` dari `sessionStorage`
 * - kartu "Gaya Pemilih Tanggal" dari `SettingAkunModal`
 * - prop `style` dan seluruh cabang `isCompact` dari `DatePicker`
 *
 * Menyisakan prefs yang tidak pernah dibaca hanya menambah satu kunci storage
 * basi per pengguna dan satu jalur kode yang tidak bisa diuji.
 */
// `dp` sudah dibaca di bagian atas modul ini. `baca()` di sini menerima path
// relatif terhadap root proyek, bukan ke folder `tools/`.
const ctxSrc = baca('src/context/AppContext.tsx');
const setSrc = baca('src/components/SettingAkunModal.tsx');

cek('tidak ada lagi prefs gaya kalender di AppContext',
  !/datePickerStyle|jatim_date_picker_style/.test(ctxSrc),
  'prefs yang tidak pernah dibaca hanya menambah kunci storage basi');
cek('tidak ada lagi setter-nya', !/setDatePickerStyle/.test(ctxSrc));
cek('kartu Gaya Pemilih Tanggal hilang dari Pengaturan',
  !/Gaya Pemilih Tanggal|Klasik Dropdown|Kalender Modern/.test(setSrc),
  'permintaan: hapus juga dari menu Pengaturan di modal');
cek('DatePicker tidak punya lagi prop style', !/style\?: 'modern' \| 'klasik'/.test(dp));
cek('tidak ada lagi cabang compact', !/isCompact/.test(dp));
cek('lebar panel klasik dibuang', !/POPUP_WIDTH_KLASIK/.test(dp));
cek('bulan tidak lagi bisa disingkat',
  !/isCompact \? SHORT_MONTHS_ID\[month\]/.test(dp),
  'panel modern sudah menampilkan nama bulan penuh');
cek('bulan tetap tampil penuh', /\{MONTHS_FULL_ID\[month\]\}/.test(dp));
cek('satu-satunya lebar panel', /Math\.min\(POPUP_WIDTH,/.test(dp),
  'dua lebar hanya menyisakan satu yang pernah terpakai');
// `dpKode` = sumber tanpa komentar. `useAppContext` masih boleh disebut di
// komentar yang menjelaskan kenapa pembacanya dihapus; yang diperiksa adalah
// ketiadaannya di kode yang dijalankan.
const dpKode = dp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
cek('DatePicker tidak lagi membaca AppContext',
  !/useAppContext/.test(dpKode),
  'gaya tidak lagi bisa berbeda antar pemakaian');

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
