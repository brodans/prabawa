/**
 * Penulis PDF laporan — satu tabel, satu berkas, tanpa pustaka tabel.
 *
 * ## Kenapa `jsPDF`, bukan `html2canvas`
 *
 * `html2canvas` memotret halaman jadi gambar lalu memasukkannya ke PDF. Hasilnya
 * buruk: teks tidak bisa dicari, satu piksel salah ketik membuat seluruh
 * berkas di-render ulang, ukurannya jauh lebih besar, dan tabel yang melebar
 * harus dipotong atau diperkecil supaya muat. Laporan absensi justru salah
 * satu berkas yang paling sering dicari isinya.
 *
 * Yang dipakai di sini adalah gambar vektor asli: `rect`, `line`, dan `text`.
 * Teksnya tetap teks, ukurannya tetap kecil, dan yang dicetak tetap sama dengan
 * yang di layar.
 *
 * Pustakanya sendiri dimuat **saat tombol ditekan** (`import()` dinamis), bukan
 * di muatan awal. Prinsipnya sama dengan `KartuQris`: muatan awal dijaga
 * `cek-bundle-awal.mjs`, dan satu pustaka yang hanya berguna saat mengunduh
 * laporan tidak berhak menambah bobot layar login.
 *
 * ## Bentuk dokumen
 *
 * A4 mendatar. Tegak hanya muat lima dari tujuh kolom laporan absensi, jadi
 * kolom "Departemen" dan "Persetujuan" terpotong — dan laporan yang kolomnya
 * terpotong bukan laporan.
 *
 * Kepala tabel digambar ulang di tiap halaman, jadi halaman 40 tidak butuh
 * kembali ke halaman 1 untuk tahu kolom apa yang sedang dibaca.
 */

import { APP_FULL_NAME, APP_NAME } from './appIdentity';
import { unduhBlob } from './unduh';
import { formatTanggalWaktuLokal } from './tanggal';

/* ═══════════════════════════════════════════════════════════════════════
 *  Bentuk masukan
 * ═══════════════════════════════════════════════════════════════════════ */

export type RataPdf = 'kiri' | 'tengah' | 'kanan';

/** Satu sel. Angka tetap angka, jadi tidak ada yang perlu "dihitung ulang". */
export type SelPdf = string | number | null | undefined;

export interface TabelPdf {
  /** Baris kepala. */
  header: string[];
  /** Isi tabel. Baris boleh lebih pendek dari `header`. */
  baris: SelPdf[][];
  /**
   * Bobot lebar kolom relatif — bukan milimeter.
   *
   * Bobot, bukan lebar, karena lebar milimeter bergantung pada ukuran kertas
   * dan margin. Yang dibutuhkan di sini hanya "kolom Pegawai dua kali kolom Jam".
   */
  lebar: number[];
  /** Rata setiap kolom. Default: kiri semua. */
  rata?: RataPdf[];
}

export interface MuatanPdf {
  /** Nama berkas tanpa ekstensi. */
  nama: string;
  /** Judul besar di kepala dokumen. */
  judul: string;
  /** Baris kedua, mis. rentang tanggal. */
  subjudul?: string;
  /** Baris kecil di bawahnya: sumber data, akun, waktu dibuat. */
  meta?: string[];
  tabel: TabelPdf;
  /** Teks kecil di kaki laporan. */
  catatan?: string;
}

/* ═══════════════════════════════════════════════════════════════════════
 *  Ukuran halaman — satuan milimeter
 * ═══════════════════════════════════════════════════════════════════════ */

const LEBAR_HALAMAN = 297;
const TINGGI_HALAMAN = 210;
const MARGIN = 12;

/** Lebar area isi, setelah margin kiri dan kanan. */
const LEBAR_ISI = LEBAR_HALAMAN - MARGIN * 2;

/** Tinggi satu baris data. */
const TINGGI_BARIS = 5.4;

/** Tinggi baris kepala tabel — sedikit lebih tinggi, isinya huruf besar. */
const TINGGI_KEPALA = 8;

/** Ruang untuk garis pemisah dan nomor halaman di kaki. */
const RUANG_KAKI = 12;

/** Batas bawah area tabel. */
const BAWAH_TABEL = TINGGI_HALAMAN - MARGIN - RUANG_KAKI;

/** Darurat di dalam sel: ruang teks dikurangi dua kali ini. */
const KENDALA_SEL = 2.4;

/* ═══════════════════════════════════════════════════════════════════════
 *  Warna
 * ═══════════════════════════════════════════════════════════════════════ */

/** Ekspektasi: segitiga warna 0\u2013255, sama seperti api `setFillColor`. */
type Rgb = [number, number, number];

const WARNA = {
  aksen: [37, 99, 235] as Rgb,
  judul: [15, 23, 42] as Rgb,
  teks: [51, 65, 85] as Rgb,
  redup: [100, 116, 139] as Rgb,
  kepalaLatar: [30, 64, 175] as Rgb,
  kepalaTeks: [255, 255, 255] as Rgb,
  zebra: [248, 250, 252] as Rgb,
  garis: [226, 232, 240] as Rgb,
  garisKaki: [203, 213, 225] as Rgb,
};

/* ═══════════════════════════════════════════════════════════════════════
 *  Teks
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Karakter yang sering muncul di data server tapi tidak punya glyph di font
 * standar PDF.
 *
 * Font bawaan PDF memakai **WinAnsiEncoding** — satu byte untuk karakter Latin-1
 * saja. Kutip-kutip curly dan garis NON-BREAKING SPACE punya kode di sana, jadi
 * cukup dipetakan. Sisanya (CJK, Arab, emoji) tidak punya, dan tanpa
 * penanganan akan muncul sebagai kotak-kotak atau huruf acak di tengah nama.
 */
const PETA_KARAKTER: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2026': '...',
  '\u00A0': ' ',
};

/** Kontrol, lebar nol, dan pemisah baris \u2014 semuanya jadi satu spasi. */
const KARAKTER_TAK_TERLIHAT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;

/** Di luar WinAnsi. */
const KARAKTER_DI_LUAR = /[\u0100-\uFFFF]/g;

/**
 * Teks yang benar-benar bisa digambar.
 *
 * `NaN` dan `Infinity` jadi string kosong, sama seperti di `excelXml.ts` —
 * menampilkan "NaN" di laporan terbaca sebagai kegagalan perhitungan, padahal
 * laporan ini memang tidak punya angka untuk sel itu.
 */
export function amanTeks(nilai: SelPdf): string {
  if (typeof nilai === 'number' && !Number.isFinite(nilai)) return '';
  let teks = nilai === null || nilai === undefined ? '' : String(nilai);
  teks = teks.replace(KARAKTER_TAK_TERLIHAT, ' ');
  teks = teks.replace(/[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00A0]/g, m => PETA_KARAKTER[m] ?? ' ');
  teks = teks.replace(/\s+/g, ' ').trim();
  return teks.replace(KARAKTER_DI_LUAR, '?');
}

/* ═══════════════════════════════════════════════════════════════════════
 *  Dokumen
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Subset dari dokumen jsPDF \u2014 hanya metode yang benar-benar dipakai di sini.
 *
 * Ditulis tangan, bukan `import type { jsPDF }`, supaya berkas ini tidak punya
 * dependensi sama sekali dengan pustakanya. Kalau nama metodenya berubah di
 * versi berikutnya, `tsc` akan ikut gagal di sini — bukan diam-diam di berkas lain.
 */
interface DokumenPdf {
  setFont(nama: string, gaya?: string): void;
  setFontSize(ukuran: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setFillColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setLineWidth(lebar: number): void;
  text(
    teks: string,
    x: number,
    y: number,
    opsi?: { align?: 'left' | 'center' | 'right' }
  ): void;
  rect(x: number, y: number, w: number, h: number, gaya?: string): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  getTextWidth(teks: string): number;
  getNumberOfPages(): number;
  setPage(urutan: number): void;
  addPage(format?: string, orientasi?: string): void;
  output(tipe: 'blob'): Blob;
}

/** Rata kiri/tengah/kanan di bawah, ke api jsPDF di atas. */
const RATA_JS: Record<RataPdf, 'left' | 'center' | 'right'> = {
  kiri: 'left',
  tengah: 'center',
  kanan: 'right',
};

/**
 * Potong teks supaya muat di dalam lebar sel.
 *
 * Dipotong per karakter, bukan per kata, dan hanya untuk sel tabel yang
 * memang satu baris. Nama pegawai panjang lebih baik jadi "Budi Santoso…"
 * daripada turun ke baris kedua yang membuat tinggi baris tidak seragam.
 */
function potongTeks(doc: DokumenPdf, teks: string, lebar: number): string {
  if (lebar <= 0) return '';
  if (doc.getTextWidth(teks) <= lebar) return teks;
  let dipotong = teks;
  while (dipotong.length > 1 && doc.getTextWidth(`${dipotong}\u2026`) > lebar) {
    dipotong = dipotong.slice(0, -1);
  }
  return `${dipotong}\u2026`;
}

/**
 * Lebar kolom dalam milimeter, dari bobot relatif.
 *
 * `lebar` boleh lebih pendek daripada `header` \u2014 kolom yang tidak disebut
 * mendapat bobot 1, bukan `NaN` yang kemudian menggagalkan seluruh gambar.
 */
export function lebarKolomPdf(header: readonly string[], lebar: readonly number[]): number[] {
  const bobot = header.map((_, i) => (Number.isFinite(lebar[i]) ? Math.max(0, lebar[i]) : 1));
  const total = bobot.reduce((a, b) => a + b, 0) || 1;
  return bobot.map(b => (b / total) * LEBAR_ISI);
}

/** Area tabel yang sudah tergambar di satu halaman, untuk garis pemisah. */
interface AreaHalaman {
  atas: number;
  bawah: number;
}

/** Gambar baris kepala tabel; kembalikan koordinat `y` baris pertama. */
function gambarKepala(
  doc: DokumenPdf,
  lebarKolom: number[],
  header: readonly string[],
  rata: RataPdf[],
  y: number
): number {
  doc.setFillColor(...WARNA.kepalaLatar);
  doc.rect(MARGIN, y, LEBAR_ISI, TINGGI_KEPALA, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...WARNA.kepalaTeks);

  let x = MARGIN;
  header.forEach((h, i) => {
    const w = lebarKolom[i] ?? 0;
    const r = rata[i] ?? 'kiri';
    const teks = potongTeks(doc, amanTeks(h), w - KENDALA_SEL * 2);
    const tx = r === 'kanan' ? x + w - KENDALA_SEL : r === 'tengah' ? x + w / 2 : x + KENDALA_SEL;
    doc.text(teks, tx, y + TINGGI_KEPALA / 2 + 1, { align: RATA_JS[r] });
    x += w;
  });
  return y + TINGGI_KEPALA;
}

/** Gambar satu baris data; kembalikan koordinat `y` baris berikutnya. */
function gambarBaris(
  doc: DokumenPdf,
  lebarKolom: number[],
  header: readonly string[],
  rata: RataPdf[],
  baris: SelPdf[],
  y: number,
  zebra: boolean
): number {
  if (zebra) {
    doc.setFillColor(...WARNA.zebra);
    doc.rect(MARGIN, y, LEBAR_ISI, TINGGI_BARIS, 'F');
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...WARNA.teks);

  let x = MARGIN;
  header.forEach((_, i) => {
    const w = lebarKolom[i] ?? 0;
    const r = rata[i] ?? 'kiri';
    const teks = potongTeks(doc, amanTeks(baris[i]), w - KENDALA_SEL * 2);
    const tx = r === 'kanan' ? x + w - KENDALA_SEL : r === 'tengah' ? x + w / 2 : x + KENDALA_SEL;
    doc.text(teks, tx, y + TINGGI_BARIS / 2 + 1, { align: RATA_JS[r] });
    x += w;
  });

  doc.setDrawColor(...WARNA.garis);
  doc.setLineWidth(0.15);
  doc.line(MARGIN, y + TINGGI_BARIS, LEBAR_HALAMAN - MARGIN, y + TINGGI_BARIS);
  return y + TINGGI_BARIS;
}

/** Kaki setiap halaman: nama aplikasi dan nomor halaman. */
function gambarKaki(doc: DokumenPdf, waktu: string): void {
  const total = doc.getNumberOfPages();
  const dasar = TINGGI_HALAMAN - MARGIN + 2;

  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...WARNA.garisKaki);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, dasar - 4.5, LEBAR_HALAMAN - MARGIN, dasar - 4.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...WARNA.redup);
    doc.text(APP_NAME, MARGIN, dasar);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...WARNA.redup);
    doc.text(APP_FULL_NAME, MARGIN + 16, dasar);
    doc.text(`Halaman ${p} dari ${total}`, LEBAR_HALAMAN - MARGIN, dasar, { align: 'right' });
    doc.text(waktu, LEBAR_HALAMAN - MARGIN, dasar + 3.5, { align: 'right' });
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Masukan
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Susun dan unduh satu berkas PDF.
 *
 * Pustakanya dimuat di sini, bukan di level modul — lihat header berkas.
 * Karena itu fungsi ini `async`, dan pemanggilnya harus menunggunya — biasanya
 * di dalam `onClick` ber-`void` yang sudah memasang penanda memuat.
 */
export async function unduhPdf(muatan: MuatanPdf): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as unknown as DokumenPdf;

  const { header, baris, lebar, rata } = muatan.tabel;
  const lebarKolom = lebarKolomPdf(header, lebar);
  const perataan = header.map((_, i) => rata?.[i] ?? 'kiri');

  const waktu = `Dibuat ${formatTanggalWaktuLokal(new Date().toISOString())} WIB`;

  /* ── Kepala dokumen, hanya di halaman pertama ───────────────────────── */
  let y = MARGIN;

  doc.setFillColor(...WARNA.aksen);
  doc.rect(MARGIN, y, 3, 15, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WARNA.aksen);
  doc.text(`${APP_NAME} \u00B7 ${APP_FULL_NAME}`, MARGIN + 6, y + 3.5);
  y += 9;

  doc.setFontSize(16);
  doc.setTextColor(...WARNA.judul);
  doc.text(potongTeks(doc, amanTeks(muatan.judul), LEBAR_ISI), MARGIN, y + 4);
  y += 8;

  if (muatan.subjudul) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...WARNA.teks);
    doc.text(potongTeks(doc, amanTeks(muatan.subjudul), LEBAR_ISI), MARGIN, y + 2.5);
    y += 6;
  }

  for (const barisMeta of muatan.meta ?? []) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...WARNA.redup);
    doc.text(potongTeks(doc, amanTeks(barisMeta), LEBAR_ISI), MARGIN, y + 2);
    y += 4;
  }

  y += 3;
  doc.setDrawColor(...WARNA.garis);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, LEBAR_HALAMAN - MARGIN, y);
  y += 5;

  /* ── Tabel ──────────────────────────────────────────────────────────── */
  const area: AreaHalaman[] = [];
  let atasHalaman = y;

  y = gambarKepala(doc, lebarKolom, header, perataan, y);

  baris.forEach((satuBaris, index) => {
    if (y + TINGGI_BARIS > BAWAH_TABEL) {
      area.push({ atas: atasHalaman, bawah: y });
      doc.addPage('a4', 'landscape');
      y = MARGIN;
      y = gambarKepala(doc, lebarKolom, header, perataan, y);
      atasHalaman = y;
    }
    y = gambarBaris(doc, lebarKolom, header, perataan, satuBaris, y, index % 2 === 1);
  });

  area.push({ atas: atasHalaman, bawah: y });

  /* Garis tegak pemisah kolom, digambar setelah isi selesai supaya tidak
     tergambar di atas teks pada halaman yang sama. */
  doc.setDrawColor(...WARNA.garis);
  doc.setLineWidth(0.15);
  for (const satu of area) {
    let x = MARGIN;
    for (let i = 0; i < lebarKolom.length - 1; i++) {
      x += lebarKolom[i];
      doc.line(x, satu.atas, x, satu.bawah);
    }
  }

  /* ── Catatan kaki laporan ───────────────────────────────────────────── */
  if (muatan.catatan) {
    if (y + 8 > BAWAH_TABEL) {
      area.push({ atas: y, bawah: y });
      doc.addPage('a4', 'landscape');
      y = MARGIN;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...WARNA.redup);
    doc.text(potongTeks(doc, amanTeks(muatan.catatan), LEBAR_ISI), MARGIN, y + 4);
  }

  gambarKaki(doc, waktu);

  unduhBlob(`${muatan.nama}.pdf`, doc.output('blob'));
}
