import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Clock, CreditCard, LogOut, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Badge } from './ui/Surface';
import { useAppContext } from '../context/AppContext';
import { useToast } from './ui/Toast';
import { batalkanTagihan } from '../lib/akunFirestore';
import { clearServerSessionCache } from '../lib/cacheManager';
import { resetAutoLogin } from '../lib/serverAutoLogin';
import { isFirebaseReady } from '../lib/firebase';
import {
  STATUS_LABEL,
  STATUS_TONE,
  bolehMasuk,
  deskripsiDurasi,
  formatRupiah,
  paketEfektif,
  ringkasanLangganan,
  tambahDurasi,
  type DokumenTagihan,
  type PaketLangganan,
  type PengaturanBilling,
  type RingkasanLangganan,
} from '../lib/langganan';
import { APP_FULL_NAME, APP_LOGO, APP_NAME, APP_VERSION } from '../lib/appIdentity';
import { formatTanggalLokal } from '../lib/tanggal';
import BayarLanggananModal from './BayarLanggananModal';
import IkonWa from './ui/IkonWa';

/**
 * Lamanya kunci "Mohon Tunggu", dalam detik.
 *
 * Dipakai juga sebagai pembatas: begitu habis, pengguna otomatis dikembalikan
 * ke halaman pembayaran — bukan dibiarkan menatap layar yang tidak akan
 * berubah.
 */
export const TUNGGU_VERIFIKASI_DETIK = 300;

/** Berapa sering status langganan dicek ulang selama masa tunggu. */
const JEDA_CEK_VERIFIKASI_MS = 3000;

/**
 * `sessionStorage` hanya ada di peramban.
 *
 * Pola yang sama dipakai `sessionManager.ts`, `cacheManager.ts`, dan
 * `lokasiTersimpan.ts` — masing-masing punya salinan kecil sendiri, bukan
 * satu modul bersama, supaya komponen yang hanya butuh satu cek tidak ikut
 * memuat logika penyimpanan yang lain.
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Kunci di `sessionStorage`, bukan state biasa.
 *
 * Alasannya nyata: membuka WhatsApp dari HP sering memuat ulang halaman — di
 * Android `wa.me` dipindah ke tab/aplikasi lain dan beberapa peramban
 * membuang seluruh state React saat kembali. Tanpa kunci ini, masa tunggu 5
 * menit akan hilang tepat di detik pengguna menekan tombol, dan countdown
 * mulai lagi dari nol — atau lebih buruk, aplikasi langsung balik ke
 * pembayaran padahal uangnya sudah dikirim.
 */
const KUNCI_TUNGGU = 'epresensi_jatim_tunggu_verifikasi';

interface InfoTungguVerifikasi {
  username: string;
  orderId: string;
  paket: string;
  nominal: number;
  /** Batas akhir masa tunggu, epoch milidetik. */
  berakhirAt: number;
}

/** Baca kunci masa tunggu; `null` kalau tidak ada, rusak, atau sudah lewat. */
function bacaTungguVerifikasi(): InfoTungguVerifikasi | null {
  if (!isBrowser()) return null;
  try {
    const mentah = sessionStorage.getItem(KUNCI_TUNGGU);
    if (!mentah) return null;
    const data = JSON.parse(mentah) as Partial<InfoTungguVerifikasi>;
    if (!data?.username || !data.orderId || typeof data.berakhirAt !== 'number') return null;
    if (data.berakhirAt <= Date.now()) {
      sessionStorage.removeItem(KUNCI_TUNGGU);
      return null;
    }
    return {
      username: String(data.username),
      orderId: String(data.orderId),
      paket: String(data.paket ?? ''),
      nominal: Number(data.nominal) || 0,
      berakhirAt: data.berakhirAt,
    };
  } catch {
    // `sessionStorage` bisa melempar di mode privat / iframe terisolasi.
    return null;
  }
}

function simpanTungguVerifikasi(info: InfoTungguVerifikasi): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(KUNCI_TUNGGU, JSON.stringify(info));
  } catch {
    /* memori saja — tanpa kunci, masa tunggu tetap berjalan di state. */
  }
}

function hapusTungguVerifikasi(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(KUNCI_TUNGGU);
  } catch {
    /* diam-diam — tidak ada yang bisa dilakukan. */
  }
}

/** `04:37` — sisa waktu dalam format jam:menit. */
export function formatHitungMundur(detik: number): string {
  const total = Math.max(0, Math.floor(detik));
  const menit = Math.floor(total / 60);
  return `${String(menit).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Gerbang langganan.
 *
 * ## Kenapa satu titik, bukan di tiap halaman
 *
 * "Wajib berlangganan" hanya bisa dijamin kalau ada **satu** tempat yang
 * bisa menolak. Kalau tiap halaman memeriksa sendiri, pasti ada satu yang
 * lupa — dan langganan berhenti jadi wajib di halaman itu.
 *
 * Jadi `MainApp` (beserta sidebar, topbar, dan seluruh halaman yang di-lazy
 * load) dirender **di dalam** komponen ini. Akun yang tidak berhak tidak
 * akan pernah sampai ke `MainApp`, artinya:
 *
 * - Auto-login server pusat tidak dijalankan — efeknya ada di `MainApp`.
 * - Tidak ada satu pun menu yang ter-render, jadi tidak bisa dinavigasi.
 * - `resetAutoLogin()` + `clearServerSessionCache()` dipanggil eksplisit
 *   supaya request yang mungkin sudah berjalan ikut berhenti.
 *
 * ## Pengecualian
 *
 * Hanya dua: akun `admin` (kalau admin ikut terkunci, tidak ada yang bisa
 * membukanya lagi) dan akun yang ditandai gratis oleh admin.
 *
 * ## Modal muncul sendiri
 *
 * Begitu statusnya ketahuan tidak entitled, dialog pembayaran langsung
 * dibuka. Minta pengguna mencari tombol dulu adalah langkah yang tidak
 * perlu — tujuannya jelas, dan menunda hanya menambah gesekan. Tombolnya
 * tetap ada di bawah supaya kalau dialog ditutup masih ada jalan kembali.
 *
 * ## Masa tunggu setelah menekan tombol konfirmasi
 *
 * Satu tombol "Saya Sudah Bayar" sekaligus membuka WhatsApp dengan detail
 * tagihan dan mengirim pernyataan bayar ke server. Setelah itu dialog ditutup
 * dan seluruh aplikasi diganti `LayarTungguVerifikasi` selama 5 menit: tidak
 * ada satu pun tombol yang bisa ditekan.
 *
 * Tujuannya bukan menunda — tujuannya memastikan satu keputusan punya satu
 * akibat, dan memberi waktu bagi admin membaca pesan di WhatsApp sebelum
 * pengguna memutuskan untuk membayar lagi.
 */
export default function GerbangLangganan({
  children,
  onKeluar,
  fallbackLoading,
}: {
  children: ReactNode;
  onKeluar: () => void;
  fallbackLoading?: ReactNode;
}) {
  const { currentUser, pegawai } = useAppContext();
  const toast = useToast();

  const username = currentUser?.username ?? '';
  const role = currentUser?.role ?? 'user';

  const [ringkasan, setRingkasan] = useState<RingkasanLangganan | null>(null);
  const [pengaturan, setPengaturan] = useState<PengaturanBilling | null>(null);
  const [tagihan, setTagihan] = useState<DokumenTagihan[]>([]);
  const [loading, setLoading] = useState(true);
  const [bayar, setBayar] = useState(false);
  /** Non-null selama masa tunggu verifikasi — lihat `LayarTungguVerifikasi`. */
  const [tunggu, setTunggu] = useState<InfoTungguVerifikasi | null>(null);
  const [sisaDetik, setSisaDetik] = useState(TUNGGU_VERIFIKASI_DETIK);
  /** Dialog hanya boleh auto-terbuka sekali per mount — bukan tiap render. */
  const sudahAutoBuka = useRef(false);

  /*
   * `orderId` tagihan `menunggu` yang sedang diselesaikan, bukan yang baru.
   *
   * Ada di parent, bukan di `LayarLanggananHabis`, karena **auto-open** juga
   * perlu menyetelnya — dan auto-open terjadi sebelum layar itu dirender.
   */
  const [lanjutkan, setLanjutkan] = useState<string | null>(null);
  /** Paket yang diklik di kartu — dialog langsung ke "pilih metode". */
  const [paketTerpilih, setPaketTerpilih] = useState<string | null>(null);

  /** Buka dialog untuk menyelesaikan tagihan yang sudah ada. */
  const mulaiLewatTagihan = useCallback((orderId: string) => {
    setPaketTerpilih(null);
    setLanjutkan(orderId);
    setBayar(true);
  }, []);

  /**
   * Nomor urut muatan — penjaga tumpang-tindih.
   *
   * `muat()` dipanggil dari tiga tempat: sekali saat gerbang dibuka, lalu
   * setiap 3 detik selama masa tunggu, dan sekali lagi setelah pembayaran.
   * Jeda 3 detik itu lebih pendek daripada waktu muatan saat jaringan
   * sedang lambat, jadi dua permintaan bisa hidup bersamaan. Karena
   * jaringan tidak menjamin urutan, respons yang **lebih lama** bisa tiba
   * belakangan dan menimpa state dengan data yang sudah basi.
   *
   * Akibatnya bukan sekadar tabel yang salah: efek di bawah membaca
   * `ringkasan` dan langsung memanggil `resetAutoLogin()` serta
   * `clearServerSessionCache()` kalau hasilnya belum entitle. Jadi satu
   * respons basi yang kebetulan mendarat belakangan bisa **memutus sesi
   * server orang yang pembayarannya baru saja berhasil**, persis di saat
   * aplikasi sedang keluar dari layar tunggu.
   */
  const muatanSeq = useRef(0);

  const muat = useCallback(async () => {
    if (!username) return;
    const seq = ++muatanSeq.current;
    const usang = () => seq !== muatanSeq.current;
    try {
      /*
       * Impor dinamis, bukan statis di atas file.
       *
       * `GerbangLangganan` ada di jalur muat awal, dan `langgananFirestore`
       * menarik `akunFirestore` yang ikut menarik modul lain. Selama impornya
       * statis, Vite menulis `modulepreload` untuk berkas-berkas itu ke
       * `index.html`, jadi setiap orang membayarnya sebelum sempat melihat apa
       * pun.
       *
       * ⚠️ Alasannya **bukan lagi** SDK Firestore — modul itu sudah tidak
       * dipakai di peramban sama sekali. `firebase/firestore` (140 kB gzip,
       * 35% bundle) hilang dari bundle karena pembacaan langganan & tagihan
       * sekarang lewat `POST /api/panel-auth`, yang memverifikasi token.
       *
       * Yang dipisah modul murni tetap diimpor statis di atas: label status,
       * format rupiah, dan perhitungan durasi itu murah, dan gerbang butuh
       * mereka untuk menggambar tampilan sebelum data datang.
       *
       * `tools/analisis-graf-muat.mts` menjaga hal ini.
       */
      const { loadLangganan, loadPengaturanBilling, loadTagihan } =
        await import('../lib/langgananFirestore');

      /*
       * Tiga request, bukan satu Firestore read.
       *
       * Semuanya paralel dan ketiganya kecil: satu dokumen langganan milik
       * pemanggil, satu dokumen pengaturan billing, dan 10 tagihan terakhir.
       * Server yang memfilter tagihan berdasarkan nama akun dari token — jadi
       * tidak ada permintaan yang bisa diarahkan ke akun lain.
       */
      const [doc, setting, daftarTagihan] = await Promise.all([
        loadLangganan(username),
        loadPengaturanBilling(),
        loadTagihan(username, 10),
      ]);
      if (usang()) return;
      setRingkasan(ringkasanLangganan(username, doc, paketEfektif(setting), role));
      setPengaturan(setting);
      setTagihan(daftarTagihan);
    } catch (err: any) {
      if (usang()) return;
      toast.error(err?.message ?? 'Gagal memeriksa status langganan.');
    } finally {
      if (!usang()) setLoading(false);
    }
  }, [username, role, toast]);

  useEffect(() => {
    setLoading(true);
    void muat();
  }, [muat]);

  /**
   * Lanjutkan masa tunggu yang tertinggal dari sebelum halaman dimuat ulang.
   *
   * Membuka WhatsApp di HP sering memicu reload, jadi tanpa ini pengguna akan
   * melihat halaman pembayaran lagi padahal uangnya sudah dikirim. Kunci milik
   * akun lain dibuang sekalian — masa tunggu bukan milik yang bisa diwariskan.
   */
  useEffect(() => {
    const info = bacaTungguVerifikasi();
    if (!info || info.username !== username) {
      hapusTungguVerifikasi();
      return;
    }
    setTunggu(info);
    setSisaDetik(Math.max(0, Math.ceil((info.berakhirAt - Date.now()) / 1000)));
  }, [username]);

  /**
   * Hitung mundur.
   *
   * Sisa waktu dihitung ulang dari `berakhirAt`, bukan dikurangi satu per
   * detik. Menghitung dari tenggat berarti angkanya tetap benar meski tab
   * kehilangan fokus — HP yang dipakai untuk mengirim pesan WhatsApp
   * membekukan `setInterval` — atau peramban menunda frame saat tidak terlihat.
   */
  useEffect(() => {
    if (!tunggu) return;
    const id = setInterval(() => {
      const sisa = Math.max(0, Math.ceil((tunggu.berakhirAt - Date.now()) / 1000));
      setSisaDetik(sisa);
      if (sisa <= 0) {
        hapusTungguVerifikasi();
        setTunggu(null);
        setBayar(true);
        toast.info('Waktu verifikasi habis. Silakan ulangi pembayaran.');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [tunggu, toast]);

  /**
   * Periksa status selama masa tunggu.
   *
   * `muat()` sengaja tidak menyentuh `loading`, jadi polling tidak membuat
   * layar berganti jadi spinner penuh setiap 3 detik. Yang berubah hanya
   * "Mohon Tunggu" → aplikasi.
   */
  useEffect(() => {
    if (!tunggu) return;
    const id = setInterval(() => {
      void muat();
    }, JEDA_CEK_VERIFIKASI_MS);
    return () => clearInterval(id);
  }, [tunggu, muat]);

  /**
   * Keluar dari masa tunggu begitu langganan benar-benar aktif.
   *
   * Selain kehabisan waktu, inikah satu-satunya jalan keluar. Pengecekan
   * tetap lewat `bolehMasuk()` yang sama seperti di tempat lain — kalau
   * screen ini punya aturan sendiri, akan ada akun yang lolos dari satu
   * jalur dan tidak dari jalur yang lain.
   */
  useEffect(() => {
    if (!tunggu || !ringkasan || loading) return;
    if (!bolehMasuk(ringkasan, role)) return;
    hapusTungguVerifikasi();
    setTunggu(null);
    toast.success('Pembayaran diterima. Selamat datang kembali.');
  }, [tunggu, ringkasan, role, loading, toast]);

  /**
   * Auto-login server ikut dibatalkan saat terkunci.
   *
   * Ini disengaja: masa aktif yang sudah habis harus terasa
   * konsekuensinya. Auto-login yang tetap berjalan berarti pengguna masih
   * bisa absen tanpa membayar, jadi gerbang ini hanya jadi hiasan.
   */
  useEffect(() => {
    if (loading || !ringkasan) return;
    if (bolehMasuk(ringkasan, role)) return;
    resetAutoLogin();
    if (username) clearServerSessionCache(username);
  }, [loading, ringkasan, role, username]);

  /*
   * Buka dialog pembayaran begitu diketahui tidak entitled.
   *
   * Auto-open ini yang bikin keadaan buntu terasa otomatis: pengguna dengan
   * tagihan `menunggu` mendarat langsung di dialog **"pilih paket"**, memilih
   * satu, lalu `mulai()` membuat tagihan baru yang pasti ditolak 409.
   *
   * Jadi: kalau sudah ada tagihan menunggu, yang dibuka adalah tagihan itu —
   * `mulaiLewatTagihan()` sudah menyetel `lanjutkan`, jadi dialog langsung ke
   * "pilih metode" untuk paket yang ada di tagihan, tanpa membuat dokumen
   * baru.
   */
  useEffect(() => {
    if (loading || !ringkasan || sudahAutoBuka.current) return;
    if (bolehMasuk(ringkasan, role)) return;
    sudahAutoBuka.current = true;
    const menunggu = tagihan.filter(item => item.status === 'menunggu');
    if (menunggu.length > 0) {
      mulaiLewatTagihan(menunggu[0].orderId);
      return;
    }
    setBayar(true);
  }, [loading, ringkasan, role, tagihan, mulaiLewatTagihan]);

  /** Mulai masa tunggu dari tombol konfirmasi di dialog pembayaran. */
  const mulaiTunggu = useCallback(
    (info: { username: string; orderId: string; paket: string; nominal: number }) => {
      const baru: InfoTungguVerifikasi = {
        ...info,
        berakhirAt: Date.now() + TUNGGU_VERIFIKASI_DETIK * 1000,
      };
      simpanTungguVerifikasi(baru);
      setBayar(false);
      setTunggu(baru);
      setSisaDetik(TUNGGU_VERIFIKASI_DETIK);
    },
    []
  );

  const paket = useMemo(() => (pengaturan ? paketEfektif(pengaturan) : []), [pengaturan]);

  if (loading && (!ringkasan || ringkasan.username !== username || !pengaturan)) {
    return fallbackLoading ? <>{fallbackLoading}</> : null;
  }

  /*
   * ⚠️ Tanpa sumber kebenaran, gerbang **dikunci permanen** — jadi dilewati.
   *
   * Dua kondisi yang membuat `ringkasan` kosong:
   *
   * 1. `VITE_FIREBASE_*` belum terisi di peramban (`isFirebaseReady()` false).
   * 2. Permintaan ke server gagal, jadi `loadLangganan()` mengembalikan
   *    `null` — dokumen langganannya tidak terbaca.
   *
   * Kenapa gerbang dilewati, bukan diperketat: kalau gate tetap tertutup saat
   * sumber kebacanya tidak ada, **setiap** akun terbaca "belum bayar" —
   * termasuk yang sudah membayar. Dan tidak ada yang bisa membayar, karena
   * pembayaran juga butuh dokumen yang sama. Hasilnya seluruh aplikasi
   * terkunci dan tidak ada jalan keluar dari dalam aplikasi.
   *
   * ⚠️ Yang membuat "terkunci permanen" sulit noticed adalah bentuknya: aplikasi
   * terbuka, tidak ada yang gagal, dan tidak ada yang complains. Perbaikan
   * satu-satunya di luar aplikasi — `/api/health` yang melapor apakah
   * kredensial Admin terpasang di server.
   *
   * Catatan: "tidak bisa login" **bukan** gejalanya. Autentikasi panel sudah
   * pindah ke server (`POST /api/panel-auth`, yang memakai Admin SDK dan tidak
   * butuh `VITE_*` sama sekali), jadi login tetap berhasil sementara status
   * langganan tidak terbaca.
   */
  if (!isFirebaseReady() || !ringkasan) {
    return <>{children}</>;
  }

  /*
   * Masa tunggu diperiksa **sebelum** `bolehMasuk`. Kalau tidak, layar
   * "Mohon Tunggu" akan dilewati begitu polling pertama melihat langganan
   * sudah aktif — padahal tekanannya baru beberapa detik lalu, dan justru
   * layarlah yang perlu dilihat. Efek di atas sudah membersihkan `tunggu`
   * pada render berikutnya, jadi layar ini hanya tampil satu frame.
   */
  if (tunggu) {
    return <LayarTungguVerifikasi info={tunggu} sisaDetik={sisaDetik} />;
  }

  // Lolos → aplikasi normal, tanpa apa pun tambahan di layar.
  if (bolehMasuk(ringkasan, role)) {
    return <>{children}</>;
  }

  return (
    <LayarLanggananHabis
      ringkasan={ringkasan}
      namaPegawai={pegawai?.nama}
      username={username}
      paket={paket}
      tagihan={tagihan}
      pengaturan={pengaturan}
      bayar={bayar}
      setBayar={setBayar}
      lanjutkan={lanjutkan}
      setLanjutkan={setLanjutkan}
      paketTerpilih={paketTerpilih}
      setPaketTerpilih={setPaketTerpilih}
      mulaiLewatTagihan={mulaiLewatTagihan}
      muatUlang={() => {
        setLoading(true);
        void muat();
      }}
      muatUlangLokal={async () => {
        await muat();
      }}
      onSelesai={async () => {
        setBayar(false);
        await muat();
      }}
      onTungguVerifikasi={mulaiTunggu}
      onKeluar={onKeluar}
    />
  );
}

/**
 * Layar "langganan habis" — presentasi murni.
 *
 * Dipisah dari `GerbangLangganan` supaya bisa di-render sendiri di skrip
 * uji: komponen gerbang melakukan pemuatan data asynchron, yang tidak jalan
 * di `renderToStaticMarkup`. Dengan memisahkan presentasi dari keputusan,
 * isi layarnya bisa diperiksa langsung dari HTML yang benar-benar dihasilkan
 * React — bukan dari pembacaan source.
 */
export function LayarLanggananHabis({
  ringkasan,
  namaPegawai,
  username,
  paket,
  tagihan,
  pengaturan,
  bayar,
  setBayar,
  lanjutkan,
  setLanjutkan,
  paketTerpilih,
  setPaketTerpilih,
  mulaiLewatTagihan,
  muatUlang,
  muatUlangLokal,
  onSelesai,
  onTungguVerifikasi,
  onKeluar,
}: {
  ringkasan: RingkasanLangganan;
  namaPegawai?: string;
  username: string;
  paket: PaketLangganan[];
  tagihan: DokumenTagihan[];
  pengaturan: PengaturanBilling | null;
  bayar: boolean;
  setBayar: (nilai: boolean) => void;
  /**
   * `orderId` tagihan `menunggu` yang sedang diselesaikan.
   *
   * Diambil dari parent (`GerbangLangganan`), bukan state lokal, karena
   * auto-open juga perlu menyetelnya — dan auto-open terjadi sebelum layar ini
   * dirender.
   */
  lanjutkan: string | null;
  setLanjutkan: (orderId: string | null) => void;
  paketTerpilih: string | null;
  setPaketTerpilih: (paketId: string | null) => void;
  mulaiLewatTagihan: (orderId: string) => void;
  muatUlang: () => void;
  /** Sama seperti `muatUlang`, tapi bisa di-`await` — dipakai setelah pembatalan. */
  muatUlangLokal: () => Promise<void>;
  onSelesai: () => Promise<void>;
  onTungguVerifikasi: (info: {
    username: string;
    orderId: string;
    paket: string;
    nominal: number;
  }) => void;
  onKeluar: () => void;
}) {
  const menunggu = tagihan.filter(item => item.status === 'menunggu');

  /*
   * Buka dialog pembayaran.
   *
   * Tiga pemanggil, tiga titik masuk yang berbeda — dan bedanya harus terlihat
   * oleh pengguna, bukan disembunyikan di balik satu tombol:
   *
   * - `paketId` diisi (kartu paket diklik): paketnya sudah dipilih, jadi
   *   dialog langsung ke "pilih metode".
   * - Tagihan `menunggu` ada: yang dibayar adalah tagihan itu. Paket kartu
   *   diabaikan — bukan karena tidak dippedulikan, tapi karena server pasti
   *   menolak pembuatan tagihan kedua, jadi mengabaikannya hanya memindahkan
   *   kegagalan ke langkah terakhir.
   * - Tidak ada keduanya: dialog mulai dari "pilih paket". Hanya ini yang
   *   benar untuk tombol atas, karena di titik itu memang belum ada pilihan.
   */
  const bukaPaket = useCallback((paketId: string) => {
    setPaketTerpilih(menunggu.length > 0 ? null : paketId);
    setLanjutkan(menunggu.length > 0 ? menunggu[0].orderId : null);
    setBayar(true);
  }, [menunggu]);

  /*
   * Buang mode "lanjutkan" begitu tidak ada lagi tagihan menunggu.
   *
   * Ini yang membuat "setelah dibatalkan, pembayaran berikutnya benar-benar
   * baru" bisa dijamin. Tanpa efek ini, `lanjutkan` masih berisi `orderId`
   * lama: dialog berikutnya akan mencoba membayar tagihan yang sudah `batal`
   * dan menampilkan "Tagihan ini sudah tidak menunggu pembayaran" — persis
   * keluhan "saya sudah hapus, kok masih muncul selesai pembayaran yang
   * sebelumnya".
   *
   * Dipicu oleh perubahan apa pun pada `tagihan`, bukan hanya oleh pembatalan
   * yang dilakukan di layar ini. Jadi tagihan yang dibatalkan admin, atau yang
   * jadi lunas karena pembayaran terverifikasi, juga ikut dibersihkan.
   */
  useEffect(() => {
    if (menunggu.length === 0) {
      setLanjutkan(null);
      setPaketTerpilih(null);
    }
  }, [menunggu]);

  const muatUlangTagihan = useCallback(async () => {
    await muatUlangLokal();
  }, [muatUlangLokal]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100 dark:bg-[#070B14]">
      {/* ─── Kepala ─────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60">
        <div className="max-w-3xl mx-auto px-4 py-3.5 flex items-center gap-3">
          <img src={APP_LOGO} alt={`Logo ${APP_NAME}`} className="w-9 h-9 rounded-xl object-contain shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{APP_NAME}</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{APP_FULL_NAME}</p>
          </div>
          <button
            type="button"
            onClick={onKeluar}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Ganti akun
          </button>
        </div>
      </header>

      {/* ─── Isi ─────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-4">
          <div className="rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-5">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                    Langganan Habis
                  </h1>
                  <Badge tone={STATUS_TONE[ringkasan.status]}>{STATUS_LABEL[ringkasan.status]}</Badge>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                  Akun <strong>{username}</strong>
                  {namaPegawai ? ` (${namaPegawai})` : ''} tidak bisa masuk ke server pusat maupun membuka
                  menu apa pun sampai langganan diperpanjang.
                </p>
                {ringkasan.masaAkhir && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Masa aktif terakhir:{' '}
                    <span className="font-mono">{formatTanggalLokal(ringkasan.masaAkhir)}</span>
                    {ringkasan.sisaHari < 0 && (
                      <span className="text-rose-500"> (sudah lewat {-ringkasan.sisaHari} hari)</span>
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* ── Aksi utama ──────────────────────────────────────────── */}
            {/*
             * Satu tombol untuk dua keadaan, dan perilakunya yang berbeda —
             * itu sebabnya judulnya berubah, bukan tombolnya.
             *
             * - **Ada tagihan `menunggu`** →"Lanjut Bayar Tagihan".
             *   Membuka dialog untuk tagihan itu, langsung ke "pilih metode"
             *   dengan paket dari dokumen tagihan. **Tidak** membuat tagihan
             *   baru: server pasti menolak yang kedua, jadi tombol yang selalu
             *   berakhir dengan "Gagal menyiapkan pembayaran." lebih buruk
             *   daripada tombol yang tidak ada.
             * - **Tidak ada tagihan** → "Lakukan Pembayaran". Membuka dialog di
             *   "pilih paket" — di titik ini memang belum ada paket yang
             *   dipilih, jadi itu satu-satunya langkah yang benar.
             *
             * Kartu paket di bawah juga membuka dialog, tapi ke "pilih metode"
             * untuk paket itu — paket sudah dipilih di situ, jadi tidak boleh
             * meminta memilih ulang.
             */}
            <button
              type="button"
              onClick={() => {
                if (menunggu.length > 0) {
                  // Tagihan yang ada yang dibayar. Paket kartu sengaja
                  // diabaikan: membuat tagihan kedua pasti ditolak server.
                  mulaiLewatTagihan(menunggu[0].orderId);
                  return;
                }
                // Mulai dari nol. Buang mode lanjutkan dan paket yang pernah
                // diklik, kalau tidak tombol ini diam-diam membayar tagihan
                // lama alih-alih membuka pemilihan paket.
                setLanjutkan(null);
                setPaketTerpilih(null);
                setBayar(true);
              }}
              disabled={paket.length === 0}
              className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold shadow-[0_8px_20px_rgb(79,70,229,0.22)] hover:from-blue-500 hover:to-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CreditCard className="w-4 h-4" />
              {menunggu.length > 0 ? 'Lanjut Bayar Tagihan' : 'Lakukan Pembayaran'}
            </button>
            {paket.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                Belum ada paket yang tersedia. Hubungi administrator.
              </p>
            )}
          </div>

          {/*
           * Tagihan yang masih `menunggu` — dengan jalan keluar.
           *
           * Semula ini hanya `Alert` biru yang menyebutkan jumlahnya, lalu
           * tombol "Lakukan Pembayaran" tetap membuat tagihan baru. Server
           * menolak dengan "Masih ada 5 tagihan yang belum diselesaikan", dan
           * karena tidak ada tombol lanjut/batal di layar itu, akun terkunci:
           * tidak bisa membayar, tidak bisa membuat tagihan baru, tidak ada
           * jalan keluar. Satu-satunya jalan keluar lama: admin yang menghapus
           * tagihannya manual.
           *
           * Sekarang tagihan yang ada ditampilkan utuh — paket, nominal, nomor —
           * dengan dua aksi: lanjutkan pembayarannya, atau batalkan kalau mau
           * memilih paket lain. Setelah dibatalkan, tombol pembayaran kembali
           * membuat tagihan baru.
           *
           * Aturan server: satu akun hanya boleh punya satu tagihan `menunggu`.
           * Jadi daftar ini maksimal satu baris dalam keadaan normal. Kalau
           * ternyata lebih dari satu (dokumen lama dari sebelum aturan ini),
           * semuanya tetap ditampilkan dan **yang paling lama** yang
           * ditawarkan untuk dilanjutkan — menumpuk tagihan di layar justru
           * membuat pengguna bingung harus bayar yang mana.
           */}
          {menunggu.length > 0 && (
            <PanelTagihanMenunggu
              tagihan={menunggu}
              setBayarTagihan={mulaiLewatTagihan}
              muatUlang={muatUlangTagihan}
            />
          )}

          {/* Paket — sekaligus daftar ringkas, supaya pengguna tahu berapa
              yang harus dibayar sebelum masuk ke dialog. */}
          {paket.length > 0 && (
            <div className="rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-5">
              <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Pilihan Paket</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3.5">
                {paket.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => bukaPaket(item.id)}
                    className="p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                  >
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.label}</p>
                    <p className="text-xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">
                      {formatRupiah(item.harga)}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                      {deskripsiDurasi(item.durasi, item.satuan)} sejak tanggal bayar
                    </p>
                    {/* Tanggal berakhir yang konkret, sama seperti di dialog
                        pembayaran. "1 bulan" tanpa tanggal masih bisa dibaca
                        dua cara; "berakhir 29 Okt 2026" tidak. */}
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                      berakhir{' '}
                      {formatTanggalLokal(
                        tambahDurasi(new Date(), item.durasi, item.satuan).toISOString()
                      )}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-1">
            <button
              type="button"
              onClick={muatUlang}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sudah bayar? Periksa lagi
            </button>
            <button
              type="button"
              onClick={onKeluar}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Keluar
            </button>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />v{APP_VERSION} · {APP_FULL_NAME}
            </span>
          </div>
        </div>
      </div>

      {/* ─── Dialog pembayaran ───────────────────────────────────────── */}
      {pengaturan && (
        <BayarLanggananModal
          // Dialog dibuka hanya setelah ada aksi pengguna (klik tombol atau
          // paket). Tanpa `bayar ?` di sini, `ringkasan` selalu non-null dan
          // modal akan terbuka begitu halaman dirender.
          ringkasan={bayar ? ringkasan : null}
          pengaturan={pengaturan}
          paket={paket}
          lanjutkanOrderId={lanjutkan}
          paketTerpilihAwal={paketTerpilih}
          tagihan={tagihan}
          onClose={() => {
            setBayar(false);
            /*
             * Muat ulang tagihan saat dialog ditutup.
             *
             * Tanpa ini, tagihan yang **baru saja dibuat** (pengguna menekan
             * "Saya Sudah Bayar" lalu menutup dialog) tidak terlihat sampai
             * muatan manual — padahal di server dokumennya sudah ada dan
             * berstatus `menunggu`. Akibatnya panel "tagihan belum dibayar"
             * tidak muncul, dan pengguna menekan "Lakukan Pembayaran" lagi
             * laluLOAT kena 409.
             *
             * Muatannya paralel dan kecil (satu dokumen langganan, satu
             * pengaturan, 10 tagihan), jadi tidak terasa berat.
             */
            void muatUlangTagihan();
            // Menutup dialog bukan berarti membatalkan tagihan. Kalau masih ada
            // tagihan `menunggu`, mode lanjutkan harus tetap aktif supaya
            // menekan "Lanjutkan Pembayaran" lagi tidak membuat dokumen baru.
            if (tagihan.filter(item => item.status === 'menunggu').length === 0) {
              setLanjutkan(null);
            }
          }}
          onSelesai={onSelesai}
          onTungguVerifikasi={onTungguVerifikasi}
        />
      )}
    </div>
  );
}

/**
 * Kartu tagihan yang masih `menunggu`, dengan jalan keluar.
 *
 * Ini perbaikan atas keadaan buntu yang pernah ada: server menolak pembuatan
 * tagihan baru selama masih ada tagihan `menunggu`, tapi layarnya hanya
 * menampilkan jumlahnya. Tidak ada tombol untuk melanjutkan pembayaran tagihan
 * itu, dan tidak ada untuk membatalkannya — sehingga akun yang salah pilih
 * paket tidak bisa apa-apa sampai admin menghapus tagihannya manual.
 *
 * Dua aksi, dan hanya dua, sesuai aturan server:
 *
 * - **Lanjutkan pembayaran** → membuka dialog pembayaran untuk `orderId` yang
 *   sudah ada. Tidak ada dokumen baru, jadi tidak ada duplikat.
 * - **Batalkan** → `tagihan:status` dengan `batal`. Server memverifikasi dokumen
 *   itu milik pemanggil dan masih `menunggu`, lalu menghapusnya.
 *
 * Setelah batal, daftar dimuat ulang dan tagihan `menunggu` habis — tombol
 * "Lakukan Pembayaran" kembali bekerja seperti biasa.
 */
function PanelTagihanMenunggu({
  tagihan,
  setBayarTagihan,
  muatUlang,
}: {
  tagihan: DokumenTagihan[];
  setBayarTagihan: (orderId: string) => void;
  muatUlang: () => Promise<void>;
}) {
  const toast = useToast();
  const [sibuk, setSibuk] = useState(false);

  /*
   * Kalau ternyata ada lebih dari satu (dokumen lama dari sebelum aturan
   * satu-tagihan), yang ditawarkan untuk dilanjutkan adalah yang paling lama.
   * Menampilkan semuanya sekaligus untuk dibayar adalah cara tercepat membuat
   * pengguna membayar dua kali. Sisanya tetap terlihat di halaman Langganan
   * setelah masuk, dan bisa dibatalkan satu per satu dari sana.
   */
  const urut = useMemo(
    () =>
      [...tagihan].sort((a, b) =>
        String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
      ),
    [tagihan]
  );
  const utama = urut[0];

  /*
   * ⚠️ Panel ini **tidak** pernah menulis `lanjutkan` sendiri.
   *
   * Semula ada `useEffect` yang memaksa `setLanjutkan(utama.orderId)` setiap
   * kali panel ini muncul. Itu sumber kebenaran kedua: begitu daftar tagihan
   * ter-muat ulang (pembatalan, pembayaran terverifikasi, muatan berkala),
   * efek itu menulis ulang `lanjutkan` — termasuk setelah tagihan dibatalkan,
   * saat nilainya harus kosong.
   *
   * Gejalanya persis keluhan "sudah saya hapus, kok masih muncul 'selesaikan
   * pembayaran sebelumnya'": tagihannya sudah `batal` di server, tapi dialog
   * tetap mencoba memakai `orderId` lama.
   *
   * Jadi panel ini hanya **membaca** tagihan apa adanya. Satu-satunya yang
   * menulis `lanjutkan` adalah aksi pengguna (`mulaiLewatTagihan`) dan efek
   * pembersih di `LayarLanggananHabis` saat tagihan kosong.
   */

  const batalkan = async (orderId: string) => {
    if (sibuk) return;
    setSibuk(true);
    try {
      await batalkanTagihan(orderId);
      toast.success('Tagihan dibatalkan dan dihapus. Silakan buat tagihan baru.');
      await muatUlang();
    } catch (galat) {
      toast.error(
        galat instanceof Error
          ? galat.message
          : 'Gagal membatalkan tagihan. Muat ulang halaman lalu coba lagi.'
      );
    } finally {
      setSibuk(false);
    }
  };

  return (
    <div className="rounded-2xl bg-blue-50 dark:bg-blue-950/25 border border-blue-200 dark:border-blue-900/60 p-5">
      <div className="flex items-start gap-3.5">
        <div className="w-11 h-11 rounded-xl bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0">
          <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
            Ada tagihan yang belum dibayar
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
            Satu akun hanya boleh punya satu tagihan aktif. Selesaikan tagihan ini
            dulu, atau batalkan kalau mau memilih paket lain.
          </p>
        </div>
      </div>

      {utama && (
        <div className="mt-4 rounded-xl bg-white dark:bg-slate-800/60 border border-blue-100 dark:border-slate-700 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {utama.usernameLabel || utama.username}
              </p>
              <p className="text-2xl font-black text-blue-600 dark:text-blue-400 font-mono mt-0.5">
                {formatRupiah(utama.nominal)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 break-all">
                <span className="font-mono">{utama.orderId}</span>
              </p>
              {utama.durasi !== undefined && utama.satuan && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {deskripsiDurasi(utama.durasi, utama.satuan)}
                  {utama.createdAt && <> · dibuat {formatTanggalLokal(utama.createdAt)}</>}
                </p>
              )}
            </div>
            <Badge tone="amber">Menunggu pembayaran</Badge>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <button
              type="button"
              disabled={sibuk}
              onClick={() => setBayarTagihan(utama.orderId)}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold shadow-[0_6px_16px_rgb(79,70,229,0.20)] hover:from-blue-500 hover:to-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CreditCard className="w-4 h-4" />
              Lanjutkan Pembayaran
            </button>
            <button
              type="button"
              disabled={sibuk}
              onClick={() => void batalkan(utama.orderId)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
              Batalkan Tagihan
            </button>
          </div>
        </div>
      )}

      {urut.length > 1 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-3 leading-relaxed">
          Ada {urut.length - 1} tagihan lama lain yang juga menunggu. Selesaikan atau
          batalkan satu per satu di halaman Langganan setelah masuk.
        </p>
      )}
    </div>
  );
}

/**
 * Layar "Mohon Tunggu" — kunci 5 menit setelah menekan tombol konfirmasi.
 *
 * ## Kenapa tidak ada satu pun tombol
 *
 * Ini keputusan yang disengaja, bukan kelupaan. Setelah menekan "Saya Sudah
 * Bayar — Konfirmasi", ada dua jalan keluar dari masa tunggu: pembayaran
 * tercatat, atau 5 menit habis. Tombol "Batal" di sini berarti pengguna bisa
 * membatalkan satu detik setelah menyatakan sudah membayar — dan daftar
 * tagihan jadi penuh permintaan yang dibatalkan sendiri, yang justru
 * membingungkan admin yang sedang memverifikasi mutasi rekening.
 *
 * "Ganti akun" juga dihilangkan: menekan keluar di sini tidak menghapus
 * apa pun — masa tunggu dilanjutkan dari `sessionStorage`, bukan diulang dari
 * nol.
 *
 * Yang tetap ada: kata-kata yang jujur. Layar ini tidak menjanjikan
 * "pembayaran diproses dalam 5 menit"; ia hanya mengatakan apa yang terjadi
 * sekarang, dan apa yang terjadi kalau tidak ada perubahan.
 *
 * ## Tata letak
 *
 * Satu kolom, lebar maksimum `sm`, semua teks `break-words`. Di HP 360 px,
 * nomor tagihan `PRABAWA-BULANAN-1759...` tidak boleh menggeserkan isi kartu.
 */
export function LayarTungguVerifikasi({
  info,
  sisaDetik,
}: {
  info: InfoTungguVerifikasi;
  sisaDetik: number;
}) {
  const persen = Math.max(0, Math.min(100, (sisaDetik / TUNGGU_VERIFIKASI_DETIK) * 100));

  return (
    <div className="min-h-[100dvh] bg-slate-100 dark:bg-[#070B14] flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="relative w-16 h-16 flex items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-[#25D366]/15 animate-ping" aria-hidden="true" />
            <span className="relative w-16 h-16 rounded-full bg-[#25D366] flex items-center justify-center shadow-[0_8px_24px_rgb(37,211,102,0.35)]">
              <IkonWa className="w-8 h-8 text-white" />
            </span>
          </div>

          <h1 className="mt-5 text-lg font-extrabold text-slate-800 dark:text-slate-100">
            Mohon Tunggu…
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed px-2 text-center">
            Konfirmasi pembayaran <strong className="break-all">{info.orderId}</strong> sudah
            tercatat. Masa aktifmu terbuka otomatis setelah pembayaran
            dikonfirmasi.
          </p>
        </div>

        {/* Hitung mundur. Monospace + `tabular-nums` supaya lebarnya tetap:
            angka yang bergeser-geser tiap detik membuat seluruh kartu ikut
            berdenyut, dan itu terbaca sebagai "ada yang tidak beres". */}
        <div className="mt-6 rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-5">
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 text-center">
            Sisa waktu tunggu
          </p>
          <p
            className="mt-1 text-4xl font-black text-slate-800 dark:text-slate-100 text-center font-mono tabular-nums"
            role="timer"
            aria-live="off"
          >
            {formatHitungMundur(sisaDetik)}
          </p>

          <div
            className="mt-3.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={TUNGGU_VERIFIKASI_DETIK}
            aria-valuenow={sisaDetik}
            aria-label="Sisa waktu tunggu verifikasi"
          >
            <div
              className="h-full rounded-full bg-[#25D366] transition-[width] duration-1000 ease-linear"
              style={{ width: `${persen}%` }}
            />
          </div>

          <dl className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 space-y-1.5 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400 shrink-0">Akun</dt>
              <dd className="font-mono font-bold text-slate-700 dark:text-slate-200 break-all text-right min-w-0">
                {info.username}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400 shrink-0">Paket</dt>
              <dd className="font-bold text-slate-700 dark:text-slate-200 text-right min-w-0">
                {info.paket}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500 dark:text-slate-400 shrink-0">Nominal</dt>
              <dd className="font-mono font-bold text-slate-700 dark:text-slate-200 text-right min-w-0">
                {formatRupiah(info.nominal)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-4 space-y-2.5">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Jangan tutup halaman ini. Selesaikan kirim pesan di WhatsApp, lalu tunggu administrator
            memeriksa tagihan.
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Kalau 5 menit berlalu tanpa perubahan, halaman ini otomatis kembali ke formulir
            pembayaran. Bayar hanya sekali — jangan transfer dua kali.
          </p>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400 dark:text-slate-500">
          <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
          {APP_NAME} · v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}
