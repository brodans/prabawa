/**
 * Penyimpanan titik absen — **milik satu akun, tidak berbagi**.
 *
 * ## Bug yang ditutup modul ini
 *
 * Versi lama memakai dua kunci `localStorage` yang bersifat global:
 *
 * ```
 * epresensi_jatim_lokasi_saya
 * epresensi_jatim_lokasi_aktif
 * ```
 *
 * Artinya: whoever login terakhir di peramban itu yang "memiliki" titiknya.
 * Login sebagai `budi` lalu logout, login sebagai `sari`, dan Sari langsung
 * melihat seluruh titik yang Budi buat — lengkap dengan koordinat Gamma
 * kantor. Sebaliknya, menimpa titik Budi karena membuat titik sendiri.
 *
 * Ini bukan sekadar tidak rapi. Titik absen menentukan koordinat yang dikirim
 * ke `absen` / `cekabsen` sebagai `last_latlong`, dan titik aktif menentukan
 * geofence. Dua orang berbagi satu daftar berarti satu orang bisa absen dengan
 * titik milik orang lain.
 *
 * ## Namespace per akun
 *
 * Kunci sekarang berakhiran username yang sudah disanitasi:
 * `epresensi_jatim_lokasi__budi`. Akun A tidak pernah membaca akun B karena
 * kuncinya berbeda, dan mengosongkan akun B tidak menyentuh akun A.
 *
 * ## Migrasi
 *
 * Data kunci lama **tidak** dipindahkan ke akun mana pun secara otomatis.
 * Mengambilnya secara otomatis justru mempertahankan kebocoran yang sama:
 * data bersama tidak bisa diketahui milik siapa. Admin cukup menyuruh pengguna
 * membuat titiknya sekali lagi.
 */

export interface TitikAbsen {
  id: string;
  nama: string;
  latitude: number;
  longitude: number;
  /** Tandai sebagai koordinat yang dipakai untuk absensi. */
  dipakai: boolean;
  dibuatPada: number;
}

/** Batas jumlah titik agar `localStorage` tidak membengkak. */
const MAX_TITIK = 40;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Sanitasi username untuk dipakai sebagai bagian kunci.
 *
 * Sama persis dengan aturan Firestore: `/` dan `#` tidak boleh muncul di
 * nama dokumen, dan mengizinkan apa adanya berarti `budi/../sari` bisa
 * menimpa kunci akun lain.
 */
function kunciAkun(username: string): string {
  const bersih = String(username ?? '')
    .trim()
    .replace(/[/\\.#$[\]]/g, '_')
    .slice(0, 64);
  return bersih || 'tanpa-nama';
}

/** `localStorage` key untuk daftar titik milik satu akun. */
export function kunciTitik(username: string): string {
  return `epresensi_jatim_lokasi__${kunciAkun(username)}`;
}

/** `localStorage` key untuk titik aktif milik satu akun. */
function kunciTitikAktif(username: string): string {
  return `epresensi_jatim_lokasi_aktif__${kunciAkun(username)}`;
}

/**
 * Guard untuk pemanggil tanpa akun.
 *
 * Melempar error jauh lebih baik daripada menulis ke kunci bersama: aksi
 * yang ditolak dengan jelas bisa diperbaiki, sedangkan yang diam-diam ditulis
 * ke tempat yang salah akan ditemukan weeks kemudian.
 */
function namaKosong(): never {
  throw new Error('Username wajib diisi untuk menyimpan titik absen.');
}

// ═══════════════════════════════════════════════════════════════════════
//  Daftar titik
// ═══════════════════════════════════════════════════════════════════════

/** Baca daftar titik milik `username`; selalu mengembalikan array valid. */
export function bacaTitik(username: string): TitikAbsen[] {
  if (!isBrowser()) return [];
  if (!username) return [];
  try {
    const raw = localStorage.getItem(kunciTitik(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed) return [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(saringTitik)
      .filter((item): item is TitikAbsen => item !== null);
  } catch {
    return [];
  }
}

/** Buang entri yang tidak valid, sekaligus isi field yang hilang. */
function saringTitik(item: any): TitikAbsen | null {
  if (!item || typeof item !== 'object') return null;
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  // Koordinat di luar bumi berarti data rusak, bukan lokasi yang valid.
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    id: String(item.id ?? `lokal-${Math.random().toString(36).slice(2, 10)}`),
    nama: String(item.nama ?? 'Tanpa nama').slice(0, 120),
    latitude,
    longitude,
    dipakai: Boolean(item.dipakai),
    dibuatPada: Number(item.dibuatPada) || Date.now(),
  };
}

/** Simpan daftar titik milik `username`; mengembalikan yang benar-benar tersimpan. */
export function simpanTitik(username: string, items: TitikAbsen[]): TitikAbsen[] {
  if (!username) namaKosong();
  const trimmed = items.slice(0, MAX_TITIK);
  if (isBrowser()) {
    try {
      localStorage.setItem(kunciTitik(username), JSON.stringify(trimmed));
    } catch {
      // `localStorage` penuh atau ditolak — daftar di memori tetap jalan.
    }
  }
  return trimmed;
}

/** Tambahkan titik baru ke awal daftar. */
export function tambahTitik(
  username: string,
  titik: Omit<TitikAbsen, 'id' | 'dibuatPada'>
): TitikAbsen[] {
  if (!username) namaKosong();
  const entry: TitikAbsen = {
    ...titik,
    id: `lokal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dibuatPada: Date.now(),
  };
  return simpanTitik(username, [entry, ...bacaTitik(username)]);
}

/** Hapus satu titik milik `username`. */
export function hapusTitik(username: string, id: string): TitikAbsen[] {
  return simpanTitik(
    username,
    bacaTitik(username).filter(item => item.id !== id)
  );
}

/** Bersihkan seluruh titik milik `username` — dan hanya miliknya. */
export function bersihkanSemua(username: string): void {
  if (!isBrowser() || !username) return;
  try {
    localStorage.removeItem(kunciTitik(username));
    localStorage.removeItem(kunciTitikAktif(username));
  } catch {
    // diam-diam
  }
}

/**
 * Ringkasan titik milik `username`, untuk dikirim ke server.
 *
 * Admin memakai ini untuk melihat lokasi setiap akun, jadi bentuknya
 * sengaja ringkas: nama + koordinat, tanpa `id` internal dan tanpa
 * `dibuatPada` yang tidak berguna di tabel.
 */
export interface RingkasanTitik {
  nama: string;
  latitude: number;
  longitude: number;
  dipakai: boolean;
}

export function ringkasanTitik(username: string): RingkasanTitik[] {
  return bacaTitik(username).map(item => ({
    nama: item.nama,
    latitude: item.latitude,
    longitude: item.longitude,
    dipakai: item.dipakai,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
//  Titik yang dipakai untuk absensi
// ═══════════════════════════════════════════════════════════════════════

/**
 * Titik yang ditandai "dipakai" di halaman Lokasi, milik `username`.
 *
 * Halaman Presensi memakainya sebagai koordinat yang dikirim ke `absen` /
 * `cekabsen` lewat `last_latlong`, jadi pengguna tidak perlu GPS sama
 * sekali. Kalau akun ini belum punya yang ditandai, pemanggil harus
 * menanyakan lewat peta — **bukan** jatuh ke titik milik akun lain.
 */
export function bacaTitikAktif(username: string): TitikAbsen | null {
  if (!isBrowser() || !username) return null;
  try {
    const id = localStorage.getItem(kunciTitikAktif(username));
    if (!id) return null;
    return bacaTitik(username).find(item => item.id === id) ?? null;
  } catch {
    return null;
  }
}

/** Tandai titik sebagai koordinat absen (radio — satu titik saja). */
export function setTitikAktif(username: string, id: string): void {
  if (!isBrowser() || !username) return;
  // Radio: tandai yang baru, lepas yang lain. Dua titik "aktif" sekaligus
  // membuat `bacaTitikAktif` mengembalikan yang pertama, dan pengguna tidak
  // pernah tahu absennya sebenarnya pakai titik yang mana.
  const sekarang = bacaTitik(username);
  const ada = sekarang.some(item => item.id === id);
  if (!ada) return;
  simpanTitik(
    username,
    sekarang.map(item => ({ ...item, dipakai: item.id === id }))
  );
  try {
    localStorage.setItem(kunciTitikAktif(username), id);
  } catch {
    // abaikan
  }
}

/** Kosongkan pilihan titik absen milik `username`. */
export function clearTitikAktif(username: string): void {
  if (!isBrowser() || !username) return;
  try {
    localStorage.removeItem(kunciTitikAktif(username));
  } catch {
    // abaikan
  }
}

/**
 * Kunci satu titik milik `username` sebagai satu-satunya yang dipakai.
 *
 * Dipakai setelah absen berhasil: server memvalidasi geofence terhadap
 * koordinat yang dikirim, jadi memindahkan titik "dipakai" ke lokasi yang
 * baru saja dipakai membuat absen berikutnya konsisten.
 */
export function jadikanAktif(username: string, titik: Omit<TitikAbsen, 'id' | 'dibuatPada'>): TitikAbsen[] {
  const list = bacaTitik(username);
  const ada = list.find(
    item =>
      Math.abs(item.latitude - titik.latitude) < 1e-6 && Math.abs(item.longitude - titik.longitude) < 1e-6
  );

  if (ada) {
    setTitikAktif(username, ada.id);
    return simpanTitik(
      username,
      list.map(item => ({ ...item, dipakai: item.id === ada.id }))
    );
  }

  /*
   * Titik baru.
   *
   * ⚠️ Penunjuk aktif **harus** ditulis di sini juga, bukan cuma flag
   * `dipakai`. `bacaTitikAktif()` membaca kunci terpisah, bukan mencari
   * titik yang `dipakai` — jadi kalau hanya flag-nya yang di-set, fungsi itu
   * mengembalikan `null`, `useServerContext` mengirim `last_latlong: ''`, dan
   * tombol "Cek Absensi" tetap terkunci walaupun titik baru saja dibuat.
   *
   * Gejalanya menipu: pengguna melihat "Kantor Pusat" ditandai aktif
   * di daftar, lalu absennya ditolak karena koordinat kosong — dan tidak ada
   * yang menyuruh dia melihat ke mana pun untuk memperbaikinya.
   */
  const baru = tambahTitik(username, { ...titik, dipakai: true })[0];
  if (baru) setTitikAktif(username, baru.id);
  return bacaTitik(username);
}

// ═══════════════════════════════════════════════════════════════════════
//  Kebersihan
// ═══════════════════════════════════════════════════════════════════════

/**
 * Kunci lama yang menyimpan daftar titik **bersama**.
 *
 * Hanya dihapus, tidak pernah dibaca. Membacanya lalu memindahkannya ke
 * akun yang sedang login justru meneruskan kebocoran yang sama: data yang
 * tidak diketahui asalnya dipindahkan ke orang yang kebetulan masuk terakhir.
 */
const KUNCI_LEGACY = ['epresensi_jatim_lokasi_saya', 'epresensi_jatim_lokasi_aktif'] as const;

/** Buang kunci lama yang menyimpan titik bersama antar akun. */
export function buangTitikLegacy(): void {
  if (!isBrowser()) return;
  try {
    for (const kunci of KUNCI_LEGACY) localStorage.removeItem(kunci);
  } catch {
    // diam-diam
  }
}
