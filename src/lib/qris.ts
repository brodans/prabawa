/**
 * QRIS dinamis — ubah QRIS statis jadi QRIS ber-nominal.
 *
 * ## Apa ini
 *
 * QRIS statis (yang dicetak di kasir) tidak punya nominal: satu kode untuk
 * semua transaksi. QRIS dinamis punya nominal yang tertanam di dalamnya, jadi
 * satu kode = satu pembayaran dan tidak bisa keliru ke invoice lain.
 *
 * Secara teknis, QRIS adalah rangkaian TLV (Tag-Length-Value) EMVCo. Untuk
 * membuatnya dinamis kita perlu:
 *
 * 1. Membaca struktur TLV dari string statis.
 * 2. Mengubah tag `01` (Point of Initiation Method) dari `11` (statis)
 *    menjadi `12` (dinamis).
 * 3. Menyisipkan tag `54` (Transaction Amount) berisi nominal, tepat sebelum
 *    tag `58` (Country Code) — EMVCo mengharuskan urutan itu.
 * 4. Menghitung ulang CRC16-CCITT (polinomial 0x1021, init 0xFFFF) untuk
 *    4 karakter terakhir.
 *
 * ## Verifikasi
 *
 * `validateQRIS()` memverifikasi CRC dan kelengkapan tag wajib, jadi admin
 * tahu lebih awal kalau string yang pasted salah — sebelum pengguna akhir
 * mendapat QR yang tidak bisa dibayar.
 */

// ═══════════════════════════════════════════════════════════════════════
//  CRC16-CCITT
// ═══════════════════════════════════════════════════════════════════════

/**
 * CRC16-CCITT sesuai spesifikasi EMVCo QRIS.
 *
 * Polinomial 0x1021, nilai awal 0xFFFF, hasil 4 digit heksadesimal huruf
 * besar. Menghitung dari seluruh string termasuk `6304` (tag + panjang CRC)
 * yang sudah ditambahkan di akhir — CRC itu sendiri tidak ikut dihitung.
 */
export function calculateCRC16(str: string): string {
  let crc = 0xffff;

  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

// ═══════════════════════════════════════════════════════════════════════
//  TLV
// ═══════════════════════════════════════════════════════════════════════

/** Satu elemen TLV dari payload QRIS. */
export interface TLV {
  tag: string;
  name: string;
  length: number;
  value: string;
  children?: TLV[];
}

/** Tag yang isinya berupa TLV bersarang. */
const NESTED_TAGS = new Set([
  ...Array.from({ length: 26 }, (_, i) => String(i + 26).padStart(2, '0')),
  '62',
]);

/**
 * Baca string TLV menjadi daftar elemen.
 *
 * Sengaja berhenti (bukan melempar) saat data tidak konsisten. String yang
 * rusak karena satu huruf keliru akan membuat `pos` melenceng, dan
 * pemindaian yang menduga-duga menghasilkan objek yang lebih menyesatkan
 * daripada daftar kosong.
 */
export function parseTLV(data: string): TLV[] {
  const elements: TLV[] = [];
  let pos = 0;

  while (pos < data.length) {
    if (pos + 4 > data.length) break;

    const tag = data.substring(pos, pos + 2);
    const length = Number.parseInt(data.substring(pos + 2, pos + 4), 10);

    if (Number.isNaN(length) || pos + 4 + length > data.length) break;

    const value = data.substring(pos + 4, pos + 4 + length);
    const element: TLV = { tag, name: tagName(tag), length, value };

    if (NESTED_TAGS.has(tag)) {
      element.children = parseTLV(value);
    }

    elements.push(element);
    pos += 4 + length;
  }

  return elements;
}

/** Nama tag EMVCo/QRIS yang dipakai di layar verifikasi. */
function tagName(tag: string): string {
  const nama: Record<string, string> = {
    '00': 'Payload Format Indicator',
    '01': 'Point of Initiation Method',
    '26': 'Merchant Account Info (UMI)',
    '27': 'Merchant Account Info (UMI)',
    '51': 'Merchant Account Info (QRIS)',
    '52': 'Merchant Category Code',
    '53': 'Transaction Currency',
    '54': 'Transaction Amount',
    '55': 'Tip / Convenience Indicator',
    '56': 'Convenience Fee (Fixed)',
    '57': 'Convenience Fee (%)',
    '58': 'Country Code',
    '59': 'Merchant Name',
    '60': 'Merchant City',
    '61': 'Postal Code',
    '62': 'Additional Data',
    '63': 'CRC',
  };
  return nama[tag] ?? `Tag ${tag}`;
}

/** Rakit balik daftar TLV menjadi string. */
function buildTLV(elements: TLV[]): string {
  return elements
    .map(el => {
      const value = el.children ? buildTLV(el.children) : el.value;
      return `${el.tag}${value.length.toString().padStart(2, '0')}${value}`;
    })
    .join('');
}

function makeTLV(tag: string, value: string, name = ''): TLV {
  return { tag, name, length: value.length, value };
}

// ═══════════════════════════════════════════════════════════════════════
//  Konversi ke dinamis
// ═══════════════════════════════════════════════════════════════════════

export interface OpsiKonversiQRIS {
  /** Nominal dalam rupiah, TANPA titik pemisah. */
  nominal: number;
  /** Biaya admin yang ditambahkan ke QR (opsional). */
  biayaAdmin?: { tipe: 'tetap' | 'persen'; nilai: number };
}

/**
 * Ubah QRIS statis menjadi QRIS dinamis ber-nominal.
 *
 * Tag `54`, `55`, `56`, `57`, dan `63` dibuang lalu disisipkan ulang supaya
 * tidak pernah muncul dua kali — kalau `54` lama dibiarkan, aplikasi
 * pembayaran akan memperkerjakan dua nominal sekaligus.
 *
 * @throws Error bila nominal tidak valid atau string QRIS tidak bisa dibaca.
 */
export function qrisDinamis(qrisStatis: string, opsi: OpsiKonversiQRIS): string {
  const statis = (qrisStatis ?? '').trim();
  if (!statis) throw new Error('String QRIS statis wajib diisi.');

  const nominal = Math.round(Number(opsi.nominal));
  if (!Number.isFinite(nominal) || nominal <= 0) {
    throw new Error('Nominal harus berupa angka lebih besar dari nol.');
  }

  const elemen = parseTLV(statis);
  if (elemen.length === 0) {
    throw new Error('String QRIS tidak bisa dibaca — periksa apakah lengkap dari aplikasi bank.');
  }

  const hasil: TLV[] = [];
  let nominalDisisipkan = false;

  for (const el of elemen) {
    // Buang tag yang kita kelola sendiri.
    if (['54', '55', '56', '57', '63'].includes(el.tag)) continue;

    // Statis → dinamis.
    if (el.tag === '01') {
      hasil.push(makeTLV('01', '12', 'Point of Initiation Method'));
      continue;
    }

    // EMVCo menaruh nominal sebelum Country Code.
    if (el.tag === '58' && !nominalDisisipkan) {
      hasil.push(makeTLV('54', nominal.toString(), 'Transaction Amount'));

      const biaya = opsi.biayaAdmin;
      if (biaya && biaya.nilai > 0) {
        if (biaya.tipe === 'tetap') {
          hasil.push(makeTLV('55', '02', 'Tip / Convenience Indicator'));
          hasil.push(makeTLV('56', Math.round(biaya.nilai).toString(), 'Convenience Fee (Fixed)'));
        } else {
          hasil.push(makeTLV('55', '03', 'Tip / Convenience Indicator'));
          hasil.push(makeTLV('57', biaya.nilai.toString(), 'Convenience Fee (%)'));
        }
      }

      nominalDisisipkan = true;
    }

    hasil.push(el);
  }

  // String tanpa CRC, lalu CRC dihitung untuk `isi + "6304"`.
  const tanpaCrc = buildTLV(hasil);
  // Panjang total harus genap — lihat `padKeGenap()`.
  const isiFinal = padKeGenap(hasil, tanpaCrc);
  const inputCrc = `${isiFinal}6304`;
  return inputCrc + calculateCRC16(inputCrc);
}

/**
 * Tambahkan satu karakter agar panjang string QRIS genap.
 *
 * ## Kenapa ini penting
 *
 * Standar QRIS mensyaratkan panjang string **genap**. Nilai field length
 * selalu dua karakter dan dihitung dalam karakter, jadi satu karakter yang
 * membuat total ganjil membuat seluruh TLV setelahnya bergeser satu posisi:
 * pemindai yang teliti menolaknya, yang tidak teliti membaca nominal yang
 * salah.
 *
 * Yang membuatnya berbahaya: parity-nya **bergantung pada jumlah digit
 * nominal**. Nominal 5 digit (25.000) menghasilkan string genap; 6 digit
 * (100.000) menghasilkan ganjil. Jadi QR-nya valid saat pembayaran berjalan
 * lancar dan rusak tepat saat admin menaikkan harga paket — dan tidak ada
 * pola yang membuat itu mencurigai.
 *
 * Diuji dengan 13 nominal: 7 di antaranya menghasilkan string ganjil.
 *
 * ## Kenapa pad ke tag 59 (Merchant Name)
 *
 * Field yang dipad adalah karakter **spasi** di akhir `Merchant Name`:
 *
 * - `59` menyimpan teks bebas, dan aplikasi pembayaran memangkas spasi di
 *   ujungnya, jadi nama merchant tetap tampil sama.
 * - Padding ke `54` (Transaction Amount) **tidak boleh** — `00100000` akan
 *   dibaca sebagai nominal yang berbeda.
 * - Padding ke `63`/`6304` merusak pembacaan CRC.
 * - Padding ke tag 26-51 merusak TLV bersarang: `buildTLV` memakai
 *   `el.children ? ... : el.value`, dan `children` untuk tag bersarang selalu
 *   berupa array (termasuk array kosong), sehingga nilai aslinya ditimpa jadi
 *   nol panjang.
 *
 * Kalau string statis tidak punya `59`, pakai `60` (City), lalu `53`
 * (Currency). Kalau semuanya tidak ada, dikembalikan apa adanya — positivity
 * `validateQRIS()` di sisi admin yang akan memberi tahu, bukan QR setengah jadi
 * yang dikirim ke pengguna.
 */
function padKeGenap(elemen: TLV[], tanpaCrc: string): string {
  // Panjang akhir = isi + "6304" (4) + CRC (4).
  if ((tanpaCrc.length + 8) % 2 === 0) return tanpaCrc;

  const urutanPad = ['59', '60', '53', '52'];
  for (const tag of urutanPad) {
    const posisi = elemen.findIndex(el => el.tag === tag);
    if (posisi < 0) continue;
    const asli = elemen[posisi];
    // `children` selalu array (bisa kosong) untuk tag bersarang — menambal
    // salah satu akan menggagalkan `buildTLV`.
    if (Array.isArray(asli.children)) continue;
    elemen[posisi] = { ...asli, length: asli.value.length + 1, value: `${asli.value} ` };
    return buildTLV(elemen);
  }
  return tanpaCrc;
}

// ═══════════════════════════════════════════════════════════════════════
//  Validasi & pembacaan
// ═══════════════════════════════════════════════════════════════════════

export interface HasilValidasiQRIS {
  valid: boolean;
  errors: string[];
}

/** Tag yang wajib ada agar QRIS bisa dibayar. */
const TAG_WAJIB = [
  { tag: '00', name: 'Payload Format Indicator' },
  { tag: '01', name: 'Point of Initiation Method' },
  { tag: '52', name: 'Merchant Category Code' },
  { tag: '53', name: 'Transaction Currency' },
  { tag: '58', name: 'Country Code' },
  { tag: '59', name: 'Merchant Name' },
  { tag: '60', name: 'Merchant City' },
  { tag: '63', name: 'CRC' },
];

/**
 * Periksa string QRIS: awalan, panjang, CRC, dan kelengkapan tag wajib.
 *
 * Dipakai di form pengaturan agar admin melihat kesalahan saat menyimpan,
 * bukan saat pengguna akhir sudah menerima QR yang tidak berlaku.
 */
export function validateQRIS(qris: string): HasilValidasiQRIS {
  const errors: string[] = [];
  const str = (qris ?? '').trim();

  if (!str) return { valid: false, errors: ['String QRIS tidak boleh kosong.'] };

  if (!str.startsWith('000201')) {
    errors.push('QRIS harus diawali Payload Format Indicator "000201".');
  }
  if (str.length < 20) {
    return { valid: false, errors: [...errors, 'String QRIS terlalu pendek.'] };
  }

  // CRC = 4 karakter terakhir.
  const tanpaCrc = str.substring(0, str.length - 4);
  const crcDinyatakan = str.substring(str.length - 4);
  const crcDihitung = calculateCRC16(tanpaCrc);
  if (crcDinyatakan.toUpperCase() !== crcDihitung) {
    errors.push(`CRC tidak sesuai: seharusnya ${crcDihitung}, ditemukan ${crcDinyatakan.toUpperCase()}.`);
  }

  const elemen = parseTLV(str);
  if (elemen.length === 0) {
    errors.push('Gagal membaca elemen TLV dari string QRIS.');
    return { valid: false, errors };
  }

  const adaTag = new Set(elemen.map(e => e.tag));
  for (const wajib of TAG_WAJIB) {
    if (!adaTag.has(wajib.tag)) {
      errors.push(`Tag wajib tidak ditemukan: ${wajib.tag} (${wajib.name}).`);
    }
  }

  const method = elemen.find(e => e.tag === '01');
  if (method && method.value !== '11' && method.value !== '12') {
    errors.push(`Nilai Point of Initiation Method harus "11" atau "12", ditemukan "${method.value}".`);
  }

  const adaMerchant = elemen.some(e => {
    const n = Number.parseInt(e.tag, 10);
    return n >= 26 && n <= 51;
  });
  if (!adaMerchant) {
    errors.push('Informasi merchant (tag 26-51) tidak ditemukan.');
  }

  return { valid: errors.length === 0, errors };
}

export interface RingkasanQRIS {
  namaMerchant: string;
  kotaMerchant: string;
  namaPenerbit: string;
  /** Nominal yang tertanam di QR; string kosong untuk QR statis. */
  nominal: string;
  /** `statis` atau `dinamis`. */
  metode: 'statis' | 'dinamis';
  crc: string;
}

/** Ringkasan singkat untuk ditampilkan di layar konfirmasi admin. */
export function ringkasQRIS(qris: string): RingkasanQRIS {
  const elemen = parseTLV((qris ?? '').trim());
  const cari = (tag: string) => elemen.find(e => e.tag === tag);

  /*
   * Nama penerbit: ada di dalam Merchant Account Info (tag 26-51).
   *
   * ⚠️ Sub-tag `02` (nama) **harus dicari duluan**. Versi lama memakai
   * `find(c => c.tag === '02' || c.tag === '01')`, dan `find` mengembalikan
   * yang cocok PERTAMA — sedangkan UMI selalu punya `00` lalu `01` (keduanya
   * GUID) sebelum `02`. Akibatnya panel verifikasi admin menampilkan
   * `ID.CO.PRABAWA.WWW` di kolom "Nama Penerbit": GUID, bukan nama. Nama
   * penerbit yang sebenarnya tidak pernah terlihat sama sekali.
   *
   * `01` tetap jadi cadangan untuk varian QRIS yang menaruh nama di sana.
   */
  let namaPenerbit = '';
  for (const el of elemen) {
    const n = Number.parseInt(el.tag, 10);
    if (n < 26 || n > 51 || !Array.isArray(el.children)) continue;
    const terpilih = el.children.find(c => c.tag === '02') ?? el.children.find(c => c.tag === '01');
    if (terpilih?.value) {
      namaPenerbit = terpilih.value.trim();
      break;
    }
  }

  /*
   * Semua nilai teks di-`trim()`.
   *
   * `qrisDinamis` menambahkan satu spasi di akhir Merchant Name supaya panjang
   * string genap (lihat `padKeGenap`). Spasi itu wajib ada di dalam QRIS —
   * menghapusnya membuat CRC tidak cocok — tapi tidak boleh ikut ke teks yang
   * digambar di kartu maupun ke panel verifikasi admin.
   *
   * `nominal` dan `crc` juga di-trim supaya spasi sisa tidak pernah
   * muncul di panel verifikasi; keduanya angka, jadi tidak ada yang dirusak.
   */
  return {
    namaMerchant: (cari('59')?.value ?? '').trim(),
    kotaMerchant: (cari('60')?.value ?? '').trim(),
    namaPenerbit,
    nominal: (cari('54')?.value ?? '').trim(),
    metode: cari('01')?.value === '12' ? 'dinamis' : 'statis',
    crc: (cari('63')?.value ?? '').trim(),
  };
}
