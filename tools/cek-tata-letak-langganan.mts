/**
 * Jaga tata letak Pengaturan Langganan.
 *
 * Dua masalah nyata yang pernah muncul di layar ini, keduanya tanpa error
 * — hanya terlihat salah, jadi tidak pernah dilaporkan sebagai bug:
 *
 * 1. **Jumlah span grid melebihi jumlah kolom.** Baris paket memakai
 *    `sm:grid-cols-11` dengan span 4+3+2+3+2 = 14. Kelebihannya membuat
 *    sisanya turun ke baris kedua: tombol hapus melayang di bawah, tidak
 *    sejajar dengan field lain, dan di layar sempit seluruh baris jadi
 *    berantakan. Builds tetap hijau, tes tetap lulus.
 *
 * 2. **Angka ribuan tidak terlihat.** Harga ditulis `100000` — Nobody
 *    bisa langsung membaca apakah itu 100 ribu atau 1 juta. Lebih buruk: mengetik `100.000` dengan tangan tidak akan
 *    mengubah apa pun, karena
 *    `NumberField` membuang semua yang bukan digit dan hasilnya
 *    `100000` — jadi gesture yang menghapus ribuannya justru menerima
 *    angka yang sama.
 *
 * Yang diperiksa di sini: setiap grid harus balance, dan harga harus
 * diformat saat tampil **tanpa** mengubah apa yang tersimpan.
 */
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const baca = (p: string): string => readFileSync(`${root}${p}`, 'utf8');
const kode = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const langganan = baca('src/pages/Langganan.tsx');
const langgananKode = kode(langganan);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1. Setiap grid di baris paket seimbang');
{
  // Ambil blok grid di dalam peta `draft.paket`.
  const awal = langgananKode.indexOf('draft.paket.map');
  const akhir = langgananKode.indexOf('paketEfektif(draft)', awal);
  cek('blok peta paket ditemukan', awal > 0 && akhir > awal, `${awal}..${akhir}`);
  const blok = langgananKode.slice(awal, akhir);

  /*
   * ⚠️ Invariant yang benar: **setiap baris harus penuh**.
   *
   * Versi pemeriksaan ini memakai "jumlah span = jumlah kolom", dan itu hanya
   * berlaku untuk grid **satu baris**. Sekarang baris paket sengaja
   * multi-baris (1 kolom di HP, 2 di tablet, 12 di monitor) — jadi
   * "jumlah span = 12" bukan lagi syarat, dan memaksanya justru membuat
   * tata letak yang benar dianggap salah.
   *
   * Yang benar-benar merusak tampilan bukan total span, tapi span yang
   * **tidak habis dibagi** jumlah kolom: sisanya jadi kolom kosong menganga
   * di ujung baris. Jadi syaratnya:
   *
   * ```
   * total_span % jumlah_kolom == 0
   * ```
   *
   * Contoh: 4+3+2+2+1 = 12 pada 12 kolom → satu baris penuh (12 % 12 = 0).
   * 2+1+1+1+1 = 6 pada 2 kolom → tiga baris penuh (6 % 2 = 0).
   */

  // Lebar grid per breakpoint, taken straight from the class.
  const titikBreak = [...blok.matchAll(/(?:^|\s)(grid-cols-(\d+)|([a-z]{2}):grid-cols-(\d+))/g)];
  cek('ada kelas grid-cols di baris paket', titikBreak.length > 0, `${titikBreak.length} kemunculan`);

  /*
   * Hitung span anak **untuk satu breakpoint tertentu**.
   *
   * Dua hal yang mudah salah di sini:
   *
   * 1. Pemisah sebelum `sm:` adalah tanda kutip pembuka `className="sm:…`,
   *    jadi kelas karakternya harus memuat `"` dan `'` — bukan hanya whitespace
   *    dan titik dua. Tanpa itu semua span bernilai 0.
   *
   * 2. Prefiks breakpoint **wajib** dicocokkan persis. Kalau opsional,
   *    `className="sm:col-span-2 xl:col-span-4"` ikut terhitung untuk
   *    `sm:` maupun `xl:`, sehingga setiap breakpoint menjumlahkan span milik
   *    breakpoint lain — dan hasilnya selalu "tidak habis dibagi" dengan angka
   *    yang tidak menjelaskan apa pun.
   */
  const spanUntuk = (prefix: string, wajib: boolean): number[] => {
    const pola = wajib
      ? new RegExp(`["'\\s:]${prefix}:col-span-(\\d+)`, 'g')
      : /["'\s]col-span-(\d+)/g;
    return [...blok.matchAll(pola)].map(m => Number(m[1]));
  };
  const JUMLAH_ANAK = 5; // Nama, Harga, Durasi, Satuan, Hapus

  for (const g of titikBreak) {
    const prefix = g[3] ?? '';
    const kolom = Number(g[4] ?? g[2]);
    const span = spanUntuk(prefix, Boolean(prefix));
    // Anak tanpa span eksplisit di breakpoint ini tetap 1 kolom.
    const total = span.reduce((a, b) => a + b, 0) + (JUMLAH_ANAK - span.length);
    cek(
      `${prefix ? `${prefix}: ` : ''}grid-cols-${kolom} membagi rata`,
      total % kolom === 0,
      `jumlah span = ${total}, sisa ${total % kolom} kolom menganga di ujung baris`
    );
  }

  /*
   * ⚠️ Larangan eksplisit: **tidak boleh** 12 kolom sejak `sm` (640 px).
   *
   * Ini bug yang pernah ada dan tidak terlihat dari kode mana pun: grid 12
   * kolom di 640 px memberi tiap kolom ±34 px, jadi field Harga (yang memuat
   * prefix "Rp" + angka beribu-ribu) **terpotong** — persis laporan yang
   * diterima. Kolom sebanyak itu hanya masuk akal di layar lebar, jadi
   * harusnya `xl:` atau `2xl:`, bukan `sm:`.
   */
  cek('tidak ada grid 12+ kolom di breakpoint kecil',
    !/(?:^|[\s:])sm:grid-cols-(?:1[2-9]|[2-9]\d)/.test(blok),
    '12 kolom sejak 640 px = field Harga terpotong');

  /*
   * Field Harga harus dapat porsi **terbesar kedua** di layout 12 kolom.
   *
   * Dasarnya isi kolom, bukan urutan tampil: `Nama Paket` adalah teks pendek
   * yang boleh mentok, `Satuan` cuma "Bulan"/"Tahun", `Durasi` satu atau dua
   * digit. Hanya `Harga` yang memuat prefix "Rp" plus angka beribu-ribu, jadi
   * hanya dia yang benar-benar tidak muat kalau dikecilkan.
   *
   * Dulu urutannya 3+2+2+3+2: kolom terkecil justru diberikan ke Harga,
   * persis kebalikannya dari yang dibutuhkan.
   */
  {
    const spanHarga = blok.match(/xl:col-span-(\d+)[^"]*"[^>]*>\s*<Field label="Harga"/);
    cek('field Harga punya lebar eksplisit di layout lebar',
      Boolean(spanHarga),
      'tanpa span, Harga hanya dapat 1 dari 12 kolom dan angkanya terpotong');
    cek('field Harga dapat minimal 3 dari 12 kolom',
      Number(spanHarga?.[1] ?? 0) >= 3,
      `sekarang ${spanHarga?.[1] ?? 0}/12 — "Rp 1.500.000" tidak muat di bawah itu`);
  }
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Harga di baris paket diformat, dan tetap angka saat disimpan');
{
  const awal = langgananKode.indexOf('draft.paket.map');
  const akhir = langgananKode.indexOf('paketEfektif(draft)', awal);
  const blok = langgananKode.slice(awal, akhir);

  cek('NumberField harga memakai prefix "Rp"', /prefix="Rp"/.test(blok),
    'tanpa prefix, "100.000" bisa tertukar dengan 100');
  cek('NumberField harga memformat ribuan', /format=\{formatRuang\}/.test(blok),
    'formatRuang mengubah 100000 menjadi "100.000"');
  cek('harga di Field ditulis "Harga", bukan "Harga (Rp)"',
    /label=" Harga"/.test(blok) || /label="Harga"/.test(blok),
    'prefix "Rp" sudah ada di dalam field, jangan dua kali');
  cek('ada ringkasan yang bisa dibaca orang', /formatRupiah\(item\.harga\)/.test(blok),
    'ringkasan "Rp 100.000 per 1 bulan" lebih jelas daripada angka polos');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. NumberField: format hanya tampilan, tidak mengubah nilai');
{
  const surface = baca('src/components/ui/Surface.tsx');
  const surfaceKode = kode(surface);

  cek('NumberField menerima prop `prefix`', /prefix\?: string/.test(surface));
  cek('NumberField menerima prop `format`', /format\?: \(value: number\) => string/.test(surface));
  cek('prefix dipakai di markup', /\{prefix && \(/.test(surfaceKode));
  cek('format dipakai untuk nilai input',
    /format \? format\(Math\.round\(value\)\)/.test(surfaceKode));
  /*
   * Yang paling penting: `onChange` tetap menerima angka polos. Kalau
   * `dariTeks` ikut memformat, mengetik "100.000" akan menyimpan
   * "100.000" sebagai string, dan `Number("100.000")` = 100 — seratus
   * rupiah, bukan seratus ribu. Itu kesalahan yang tidak akan terlihat
   * sampai tagihannya sampai Rp 100.
   */
  cek('onChange tetap menerima angka polos',
    /const bersih = teks\.replace\(\/\\D\/g, ''\)/.test(surfaceKode) &&
      /onChange\(Number\(bersih\)\)|onChange\(min \?\? 0\)/.test(surfaceKode),
    'hanya `format` yang mengubah tampilan; yang tersimpan tetap angka');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. AksiIcon punya area sentuh yang layak');
{
    const blok = langgananKode.slice(langgananKode.indexOf('function AksiIcon'));
  cek('AksiIcon punya ukuran tetap 36 px',
    /h-9 w-9/.test(blok.slice(0, 1200)),
    '28 px (p-1.5 + ikon 14 px) terlalu kecil untuk layar sentuh');
  cek('ikon di dalam AksiIcon sedikit lebih besar', /w-4 h-4/.test(blok.slice(0, 1200)));
  cek('AksiIcon punya fokus yang terlihat', /focus-visible:ring/.test(blok.slice(0, 1200)),
    'tanpa ini, navigasi keyboard tidak menunjukkan posisi tombol');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Status Midtrans ditampilkan apa adanya');
{
  cek('StatusMidtrans dipakai di Pengaturan', /<StatusMidtrans/.test(langgananKode),
    'toggle saja tidak cukup — Midtrans butuh tiga syarat, bukan satu');
  cek('StatusMidtrans menerima status toggle', /aktif=\{draft\.midtransAktif\}/.test(langgananKode));

  const status = baca('src/components/StatusMidtrans.tsx');
  cek('menyebut ketiga syarat yang berbeda tempat',
    /VITE_MIDTRANS_CLIENT_KEY/.test(status) && /MIDTRANS_SERVER_KEY/.test(status));
  cek('menyatakan belum-tahu sebagai keadaan tersendiri',
    /useState<boolean \| null>\(null\)/.test(status),
    'null = belum dicek; kalau langsung false, layar sempat berbohong');
  cek('tidak pernah mengirim nilai key ke peramban',
    !/import\.meta\.env\?\.(MIDTRANS_SERVER_KEY)/.test(status),
    'Server Key tidak boleh masuk bundle');
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
if (fail > 0) process.exitCode = 1;
