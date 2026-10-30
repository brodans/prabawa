import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { bacaTitikAktif, type TitikAbsen } from '../lib/lokasiTersimpan';
import { formatLatLong } from '../lib/presensiContract';
import { idPerangkat } from '../lib/idPerangkat';
import type { ServerContext } from '../lib/apiCalls';

/**
 * Menyusun `ServerContext` (api_key / last_latlong / imei) yang wajib
 * disuntik ke setiap request JSON-RPC.
 *
 * Padanan langsung dari `RestServices.insertAuthorizationInterceptor` di
 * APK v89, dengan satu perbedaan penting: `last_latlong` di sini diambil dari
 * titik yang dipilih pengguna di peta, bukan dari GPS perangkat. Aplikasi
 * ini tidak pernah meminta izin lokasi ke peramban.
 *
 * ## Titik ikut CurrentUser
 *
 * ⚠️ Titik absen dibaca per-akun (`bacaTitikAktif(username)`), bukan dari
 * satu kunci bersama. Kalau username ikut berubah, state **dikosongkan**
 * sekalian pada frame yang sama — bukan menunggu efek berjalan. Kalau tidak,
 * `useState(() => bacaTitikAktif())` masih memegang titik akun sebelumnya
 * sampai polling 5 detik selesai, dan satu request absen sempat terkirim
 * dengan koordinat orang lain.
 */
/**
 * Apakah dua titik absen menghasilkan state yang sama.
 *
 * Hanya tiga field yang dibandingkan, dan ketiganya adalah satu-satunya yang
 * benar-benar dipakai: `id` menentukan titik mana yang aktif, koordinat
 * menentukan `last_latlong` yang dikirim ke server, `dipakai` menentukan
 * sorotan di daftar.
 *
 * `nama` sengaja **tidak** dibandingkan. Mengganti nama titik tidak mengubah
 * satu pun request, dan memperbandingkannya akan membangun ulang state —
 * beserta `context` dan `loadData` — hanya karena label berubah.
 */
function titikSama(a: TitikAbsen | null, b: TitikAbsen | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.latitude === b.latitude && a.longitude === b.longitude && a.dipakai === b.dipakai;
}

export function useServerContext() {
  const { pegawai, currentUser, setConfig, config } = useAppContext();
  const [ready, setReady] = useState(false);
  const username = currentUser?.username ?? '';

  // Titik absen aktif dibaca ulang tiap 5 detik + tiap halaman difokuskan,
  // supaya perubahan di Lokasi Absen langsung terpakai di panggilan
  // berikutnya tanpa perlu memuat ulang.
  const [titik, setTitik] = useState<TitikAbsen | null>(() => bacaTitikAktif(username));

  /**
   * Baca ulang titik aktif **sekarang juga**, tanpa menunggu polling.
   *
   * ⚠️ Ada polling 5 detik supaya perubahan dari halaman Lokasi Absen
   * terpakai di panggilan berikutnya tanpa perlu memuat ulang. Tapi polling
   * itu terlalu lambat untuk perubahan yang dilakukan di halaman ini juga:
   * pengguna menekan "Simpan sebagai titik baru" lalu langsung menekan
   * "Cek Absensi", dan koordinat yang terkirim masih yang lama selama
   * jendela 5 detik itu. Gejalanya server mencatat absen pada koordinat
   * titik sebelumnya, atau menolak karena `last_latlong` kosong — padahal
   * di layarnya sudah kelihatan titik yang benar.
   *
   * Dipanggil juga oleh halaman Presensi setiap kali titik berubah di sana,
   * jadi `context` ikut terbarui pada frame yang sama.
   *
   * ## Kenapa hasilnya dibandingkan sebelum `setTitik`
   *
   * `bacaTitikAktif()` menyusun ulang objek dari JSON setiap dipanggil —
   * `bacaTitik()` memetakan dan menyalin tiap entri. Jadi dua pemanggilan
   * berturut-turut mengembalikan objek yang **identik isinya** tapi berbeda
   * identitasnya, dan `setState` membandingkan dengan `Object.is`.
   *
   * Tanpa perbandingan, polling 5 detik membuat state "berubah" terus —
   * komponen merender ulang, `context` dihitung ulang, dan `loadData` yang
   * bergantung padanya ikut dipanggil ulang. Untuk satu akun dengan satu
   * titik, itu 12 render sia-sia per menit di halaman yang isinya tabel
   * presensi.
   */
  const segarkanTitik = useCallback(() => {
    const baru = bacaTitikAktif(username);
    setTitik(lama => (titikSama(lama, baru) ? lama : baru));
  }, [username]);

  // Ganti akun → titik ikut akun lama harus langsung hilang, bukan satu
  // polling lagi. `setTitik(null)` ada di branch yang sama dengan
  // penggantian username supaya tidak ada render antara keduanya.
  useEffect(() => {
    segarkanTitik();
  }, [segarkanTitik]);

  useEffect(() => {
    if (!username) return;
    const sync = () => segarkanTitik();
    window.addEventListener('focus', sync);
    const timer = window.setInterval(sync, 5_000);
    return () => {
      window.removeEventListener('focus', sync);
      window.clearInterval(timer);
    };
    // `segarkanTitik` sudah stabil (dependensinya cuma `username`), jadi
    // efek ini hanya berjalan ulang saat akun benar-benar berganti.
  }, [username, segarkanTitik]);

  const lastLatLong = useMemo(() => {
    // `formatLatLong` tidak membulatkan dan memaksa desimal titik, sesuai
    // yang disimpan `SessionManager` di aplikasi asli.
    //
    // ⚠️ `config.lastLatLong` **tidak** dipakai sebagai cadangan. Itu milik
    // sesi yang sedang berjalan; memakainya sebagai fallback berarti
    // koordinat akun sebelumnya ikut terkirim kalau akun baru belum punya
    // titik. `config` di-reset saat ganti akun, jadi yang perlu dijaga
    // hanya agar tidak ada state yang lebih lama yang bertahan.
    if (titik) return formatLatLong(titik.latitude, titik.longitude);
    return '';
  }, [titik]);

  const context = useMemo<ServerContext>(
    () => ({
      apiKey: pegawai?.apiKey ?? '',
      lastLatLong,
      /*
       * Disuntik ke SETIAP panggilan, bukan hanya `login` — sama seperti
       * `RestServices.insertAuthorizationInterceptor` di APK yang menaruhnya
       * di tiap envelope.
       *
       * Urutannya penting dan tidak boleh dibalik:
       *
       * 1. Nilai yang sudah diisi manual (Kredensial Server) atau yang
       *    berasal dari profil server menang apa adanya. Kalau admin sudah
       *    memberikan id perangkat yang benar, menimpanya dengan id acak
       *    justru memutus pengikatan yang tadinya sudah benar.
       * 2. Barulah `idPerangkat()` — UUID yang dibuat sekali per akun di
       *    peramban ini, meniru `androidId` di aplikasi asli.
       *
       * Kenapa perlu langkah kedua: server pusat membalas `402` kalau
       * `imei` tidak cocok dengan perangkat yang terikat, dan `402` itu
       * mustahil diperbaiki sendiri. Tanpa id, akun yang kebetulan terikat
       * tidak akan pernah bisa masuk.
       *
       * Kenapa bukan satu id di environment variable: aplikasi ini dipakai
       * banyak perangkat. Satu id bersama menghapus makna pengikatan itu —
       * begitu id-nya bocor, siapa pun bisa login dari mana saja. Server
       * juga tidak boleh mengisinya: itu berarti semua perangkat memakai
       * satu identitas yang sama.
       */
      imei: config.imei || pegawai?.imei || idPerangkat(username),
    }),
    [pegawai?.apiKey, pegawai?.imei, config.imei, lastLatLong, username]
  );

  // Simpan koordinat terakhir supaya request berikutnya tidak kosong.
  useEffect(() => {
    if (!lastLatLong) return;
    setConfig(prev => (prev.lastLatLong === lastLatLong ? prev : { ...prev, lastLatLong }));
  }, [lastLatLong, setConfig]);

  useEffect(() => {
    setReady(Boolean(pegawai?.apiKey));
  }, [pegawai?.apiKey]);

  const refresh = useCallback(() => setReady(Boolean(pegawai?.apiKey)), [pegawai?.apiKey]);

  return { context, ready, refresh, titikAbsen: titik, segarkanTitik };
}
