/**
 * Tanggal & waktu dalam zona WIB.
 *
 * Semua fungsi di sini mengembalikan **WIB** apa pun zona waktu perangkatnya.
 * Ini bukan detail: `getTodayWIB()` dipakai untuk batas tanggal di filter
 * laporan dan tanggal cutoff pengajuan izin. Kalau ikut zona perangkat, satu
 * orang di WIB dan satu orang di UTC melihat "hari ini" yang berbeda, dan
 * laporan harian mereka tidak akan cocok.
 *
 * Fallback manual dipakai kalau `Intl` tidak mendukung `Asia/Jakarta` (JSC
 * tanpa data zona, beberapa peramban lawas, dan lingkungan tanpa ICU). Tanpa
 * fallback, modul ini ikut melempar — dan ini dipanggil dari dalam filter halaman.
 */

/** `YYYY-MM-DD` dalam WIB. */
export function getTodayWIB(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return geserKeWib(d).toISOString().slice(0, 10);
  }
}

/** `HH:MM` dalam WIB. */
export function getNowWIBTime(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return geserKeWib(d).toISOString().slice(11, 16);
  }
}

/** `YYYY-MM-DD` dalam WIB, digeser `hari` hari dari hari ini. */
export function getTodayWIBWithDaysOffset(hari: number): string {
  const dasar = geserKeWib(new Date());
  dasar.setDate(dasar.getDate() + hari);
  return dasar.toISOString().slice(0, 10);
}

/**
 * Ubah `HH:MM` menjadi jumlah menit sejak tengah malam.
 *
 * Mengembalikan `null` untuk input yang tidak berbentuk waktu — pemanggil
 * memakai `?? 0`, jadi input rusak berarti "tidak sebelum jam kerja", bukan
 * `NaN` yang merusak seluruh perhitungan jam.
 */
export function timeToMinutes(value: string | null | undefined): number | null {
  const cocok = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(value ?? ''));
  if (!cocok) return null;
  const jam = Number(cocok[1]);
  const menit = Number(cocok[2]);
  if (!Number.isFinite(jam) || !Number.isFinite(menit)) return null;
  if (jam > 23 || menit > 59) return null;
  return jam * 60 + menit;
}

/**
 * Timestamp yang bisa dibaca manusia, untuk daftar dan tabel.
 *
 * Mengembalikan string kosong untuk input kosong — bukan "-". Daftar ini
 * disalin pengguna ke laporan, dan "-" di sana terbaca sebagai data yang
 * hilang, bukan field yang memang tidak diisi.
 */
export function formatCompactDateTime(val: string | null | undefined): string {
  if (!val) return '';
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) return '';

  // `getTodayWIB()` juga memakai WIB, jadi perbandingan "hari ini" di sini
  // konsisten dengan batas tanggal di filter.
  const hariIni = getTodayWIB();
  const tanggal = getTodayWIB(date);
  if (tanggal === hariIni) return `Hari ini, ${getNowWIBTime(date)}`;

  const kemarin = geserKeWib(new Date());
  kemarin.setDate(kemarin.getDate() - 1);
  if (tanggal === getTodayWIB(kemarin)) return `Kemarin, ${getNowWIBTime(date)}`;

  return `${tanggal.split('-').reverse().join('/')} ${getNowWIBTime(date)}`;
}

/** Singkatan bulan untuk `DatePicker` dan label kalender. */
export const SHORT_MONTHS_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agt',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

/** Nama bulan penuh, untuk header kalender. */
export const MONTHS_FULL_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

/**
 * Geser `Date` ke WIB dan kembalikan sebagai tanggal *naif*.
 *
 * Hasilnya adalah `Date` yang FIELD-nya sama dengan jam WIB. `toISOString()`
 * pada objek semacam ini selalu mengembalikan `...T00:00`, jadi aman dipakai
 * untuk membentuk `YYYY-MM-DD` tanpa pergeseran timezone.
 */
function geserKeWib(d: Date): Date {
  const offsetDetik = (7 * 60 + d.getTimezoneOffset()) * 60_000;
  return new Date(d.getTime() + offsetDetik);
}
