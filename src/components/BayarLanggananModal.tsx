import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  ClipboardCopy,
  Download,
  Landmark,
  Loader2,
  Maximize2,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useToast } from './ui/Toast';
import { Alert } from './ui/Surface';
import { Modal } from './ui/Modal';
import IkonWa from './ui/IkonWa';
import {
  formatRupiah,
  idTagihan,
  type MetodePembayaran,
  type PaketLangganan,
  type DokumenTagihan,
  type PengaturanBilling,
  type RekeningBank,
  type RingkasanLangganan,
  infoBank,
  deskripsiDurasi,
  isiPesanWa,
  tambahDurasi,
  tautanWa,
} from '../lib/langganan';
import { qrisDinamis } from '../lib/qris';
import { aktifkanLangganan } from '../lib/aktivasiLangganan';
import {
  buatTransaksi,
  cekMidtransServer,
  midtransTersedia,
  muatSnap,
} from '../lib/midtrans';
import { APP_NAME } from '../lib/appIdentity';
import { formatTanggalLokal, formatTanggalWaktuLokal } from '../lib/tanggal';

/** Langkah di dalam dialog pembayaran. */
type Langkah = 'pilih-paket' | 'pilih-metode' | 'qris' | 'transfer' | 'menunggu' | 'selesai';

/**
 * Kartu QRIS di-bundle terpisah.
 *
 * `qrcode-generator` berukuran ~50 KB dan HANYA dibutuhkan saat dialog
 * pembayaran terbuka. Kalau diimpor langsung, itu masuk ke chunk `vendor`
 * yang dimuat di setiap halaman — termasuk halaman yang tidak pernah
 * membayar. `lazy()` menundanya sampai benar-benar dipakai.
 */
const KartuQris = lazy(() => import('./KartuQris'));

/**
 * Placeholder selagi bundel `KartuQris` diunduh.
 *
 * ⚠️ Ini HANYA untuk `lazy()` — saat modulnya belum sampai. Setelah modul
 * Loaded, `KartuQris` sendiri yang menampilkan placeholder-nya (lihat
 * `RangkaKartu` di sana).
 *
 * Gelap dan datar karena memang belum ada yang bisa digambar, tapi tetap
 * memakai siluet kartu yang sama supaya transisinya dari "belum ada" ke "sedang
 * digambar" tidak melompat. Spin pucat di kotak putih polos — yang dulu
 * dipakai di sini — terbaca sebagai gambar gagal dimuat, dan pengguna menekan
 * "Periksa lagi" berulang kali.
 *
 * `aspectRatio`, bukan tinggi piksel: di layar 320 px ruang dialog hanya
 * ~248 px, dan skeleton yang dipaksa 383 px membuat layout melompat begitu QR
 * benar-benar muncul.
 */
function KartuQrisSkeleton({ lebar }: { lebar: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center overflow-hidden rounded-[20px] bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 h-auto"
      style={{ width: lebar, maxWidth: '100%', aspectRatio: '400 / 580' }}
      role="status"
      aria-live="polite"
    >
      {/*
       * Spinner tunggal, sama persis dengan `RangkaKartu` di `KartuQris.tsx`.
       *
       * Skeleton 5×5 modul QR pernah dipakai di sini juga, dan placeholder-nya
       * dibiarkan sama dengan placeholder "memuat" di `KartuQris` — jadi
       * `KartuQrisSkeleton` (saat `lazy()` belum selesai) dan `RangkaKartu`
       * (saat QR sedang digambar) tampil berbeda padahal keduanya menjawab
       * pertanyaan yang sama: "sedang memuat, tunggu". Dua bentuk untuk satu
       * keadaan berarti ada momen saat tampilan melompat dari satu ke yang lain.
       *
       * Bentuk 5×5 juga punya masalah yang sama seperti di `KartuQris`: kotak
       * berkedip berdenyut terbaca seperti QR yang rusak, dan tidak ada yang
       * mau memindai QR setengah jadi.
       */}
      <Loader2
        className="w-7 h-7 text-slate-400 dark:text-slate-500 motion-safe:animate-spin"
        strokeWidth={2}
        aria-hidden="true"
      />
      <p className="mt-3 px-4 text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        Memuat QR pembayaran…
      </p>
    </div>
  );
}

const METODE_LABEL: Record<MetodePembayaran, string> = {
  qris: 'QRIS',
  qris_midtrans: 'QRIS (Midtrans)',
  transfer: 'Transfer Bank',
};

const METODE_ICON: Record<MetodePembayaran, typeof Landmark> = {
  qris: Landmark,
  qris_midtrans: Smartphone,
  transfer: Banknote,
};

const METODE_HINT: Record<MetodePembayaran, string> = {
  qris: 'Scan QR dari GoPay, OVO, DANA, atau m-banking',
  qris_midtrans: 'QRIS dari Midtrans, terverifikasi otomatis',
  transfer: 'Transfer ke rekening merchant, verifikasi manual',
};

/**
 * Dialog pembayaran mandiri.
 *
 * ## Siapa yang membayar
 *
 * **Akunnya sendiri.** Menu Langganan milik admin hanya memantau; admin
 * sengaja tidak punya tombol "catat pembayaran" karena itu berarti mencatat
 * uang orang lain di atas namanya sendiri.
 *
 * ## Satu tombol, bukan tiga
 *
 * Untuk QRIS manual dan transfer, sebelumnya ada tiga hal yang harus
 * dilakukan terpisah: salin QR, tekan "Konfirmasi via WhatsApp", lalu tekan
 * "Saya Sudah Bayar". Itu bukan tiga langkah — itu satu keputusan yang
 * dipecah tiga, dan akibatnya pengguna sering berhenti di tengah karena tidak
 * tahu tombol mana yang sebenarnya mengaktifkan langganan.
 *
 * Sekarang **satu tombol** melakukan semuanya: membuka WhatsApp dengan pesan
 * konfirmasi (jumlah, paket, nomor tagihan) sekaligus menyatakan "saya sudah
 * bayar" ke server. Setelah itu dialog ditutup dan gerbang masuk ke layar
 * "Mohon Tunggu" selama 5 menit — lihat `LayarTungguVerifikasi`.
 *
 * ## Kenapa aktivasi-langganan ini cukup dengan satu tombol
 *
 * Untuk Midtrans tidak ada pilihan lain: status transaksi dicek ke API, dan
 * hanya `settlement` yang mengaktifkan. Untuk QRIS manual dan transfer,
 * verifikasi mutasi rekening memang tidak bisa dilakukan dari peramban —
 * jadi yang membayar sendiri yang menekan tombol, dan admin memantaunya di
 * riwayat pembayaran.
 *
 * Konsekuensinya harus jujur diketahui: tanpa Midtrans, siapa pun bisa
 * menekan tombol aktivasi tanpa benar-benar membayar. Kalau itu tidak bisa
 * diterima, Midtrans wajib dipakai — dan itu pilihan sadar, bukan
 * ketidaksengaja. Yang bisa diperkuat aplikasi hanyalah *sulit*-nya, bukan
 * *mustahil*-nya.
 *
 * ## Idempoten
 *
 * `catatPembayaran()` menolak `orderId` yang sudah pernah dicatat, jadi
 * menekan tombol berkali-kali tidak akan menambah bulan berulang.
 */
export default function BayarLanggananModal({
  ringkasan,
  pengaturan,
  paket,
  lanjutkanOrderId,
  tagihan,
  paketTerpilihAwal,
  onClose,
  onSelesai,
  onTungguVerifikasi,
}: {
  ringkasan: RingkasanLangganan | null;
  pengaturan: PengaturanBilling;
  paket: PaketLangganan[];
  /**
   * `orderId` tagihan yang **sudah ada** dan harus diselesaikan.
   *
   * Aturan server: satu akun hanya boleh punya satu tagihan `menunggu`. Kalau
   * tagihan itu ada, `GerbangLangganan` menawarkannya untuk dilanjutkan, dan
   * objek ini meneruskan `orderId`-nya ke sini.
   *
   * Dengan `orderId` ini, `mulai()` **tidak** membuat dokumen baru — ia melompat
   * langsung ke QR/instruksi transfer untuk tagihan yang sama. Tanpa ini,
   * menekan "Lanjutkan Pembayaran" akan ditolak server dengan 409, dan
   * pengguna terjebak persis di keadaan yang seharusnya kita perbaiki.
   */
  lanjutkanOrderId?: string | null;
  /**
   * Tagihan milik pemanggil, terbaru dulu.
   *
   * Dipakai untuk mengambil **nominal** tagihan yang sedang dilanjutkan. Sumber
   * itu penting: `qrisDinamis()` mengunci nominal ke dalam QR, jadi kalau
   * nominal dihitung ulang dari harga paket saat ini sementara tagihannya dibuat
   * dengan harga lama, QR-nya tidak cocok dengan tagihan dan verifikasi
   * pembayaran gagal jauh setelah pengguna transfer.
   */
  tagihan: DokumenTagihan[];
  /**
   * Paket yang harus langsung terpilih saat dialog dibuka.
   *
   * Kalau diisi, dialog **tidak** membuka langkah "pilih paket" — ia langsung ke
   * "pilih metode" untuk paket ini. Dipakai `GerbangLangganan` untuk dua hal:
   *
   * 1. **Kartu paket yang diklik** di layar gerbang. Di situ paketnya sudah
   *    dipilih oleh orang itu; memintanya memilih ulang adalah pekerjaan
   *    sia-sia. Kalau tidak, "pilih paket" jadi langkah pertama **setiap kali**,
   *    bukan hanya dari tombol atas.
   * 2. **Tagihan yang sudah ada** (`lanjutkanOrderId`), yang paketnya diketahui
   *    dari dokumen tagihan — bukan dari kartu mana pun yang diklik.
   *
   * `null` = mulai dari "pilih paket". Hanya itu yang benar untuk tombol
   * "Lakukan Pembayaran" di atas, karena di titik itu memang belum ada paket
   * yang dipilih.
   */
  paketTerpilihAwal?: string | null;
  onClose: () => void;
  onSelesai: () => Promise<void>;
  /**
   * Dipanggil setelah server menerima permintaan aktivasi manual.
   *
   * Gerbang memakainya untuk masuk ke layar "Mohon Tunggu" — dialog ini
   * lalu ditutup, jadi tidak ada tombol yang bisa ditekan selama masa
   * tunggu.
   */
  onTungguVerifikasi: (info: {
    username: string;
    orderId: string;
    paket: string;
    nominal: number;
  }) => void;
}) {
  const toast = useToast();
  const [langkah, setLangkah] = useState<Langkah>('pilih-paket');
  const [terpilih, setTerpilih] = useState<PaketLangganan | null>(null);
  const [orderId, setOrderId] = useState('');
  const [qrTeks, setQrTeks] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [rekening, setRekening] = useState<RekeningBank | null>(null);
  const [bekerja, setBekerja] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [masaAkhir, setMasaAkhir] = useState('');
  const [perbesar, setPerbesar] = useState(false);
  const snapAktifRef = useRef(false);

  // Midtrans baru dinyatakan siap setelah key klien dan server sama-sama terverifikasi.
  const [midtransAda, setMidtransAda] = useState<boolean | null>(null);

  useEffect(() => {
    if (!pengaturan.midtransAktif) {
      setMidtransAda(false);
      return;
    }
    setMidtransAda(null);
    let hidup = true;
    void cekMidtransServer().then(ada => {
      if (hidup) setMidtransAda(ada && midtransTersedia());
    });
    return () => {
      hidup = false;
    };
  }, [pengaturan.midtransAktif]);

  /*
   * Reset saat dibuka — state di atas bertahan antar pembukaan modal.
   *
   * ⚠️ Ketergantungannya `ringkasan?.username`, **bukan** objek `ringkasan`.
   *
   * Semula dependensinya objek itu. `GerbangLangganan` membangun ringkasan
   * baru di setiap `muat()` (`ringkasanLangganan(...)` selalu mengembalikan
   * objek baru), dan `muat()` dipanggil lagi setiap kali pengguna menekan
   * "Cek lagi" atau menyelesaikan pembayaran. Setiap pemanggilan itu berarti
   * objek baru dengan isi yang belum tentu berbeda — dan efek ini langsung
   * mengosongkan seluruh isian: paket yang sudah dipilih, `orderId` yang
   * sudah dibuat, QR yang sudah dirender, rekening yang sudah disalin.
   *
   * Yang dimaksud justru satu hal saja: "mulai dari nol untuk akun ini".
   * Jadi kuncinya nama akun. Perubahan akun = form baru; pemuatan ulang
   * untuk akun yang sama = hasil yang sama, tidak ada yang perlu di-reset.
   */
  const usernameRingkasan = ringkasan?.username ?? '';
  useEffect(() => {
    if (!usernameRingkasan) return;
    setLangkah('pilih-paket');
    setTerpilih(null);
    setOrderId('');
    setQrTeks('');
    setQrDataUrl(null);
    setRekening(null);
    setGalat(null);
    setMasaAkhir('');
    setPerbesar(false);
    setBekerja(false);
  }, [usernameRingkasan]);

  /**
   * Buka langsung di "pilih metode" kalau paketnya sudah diketahui.
   *
   * Berjalan **setiap** dialog dibuka (kuncinya `terbuka`), bukan hanya saat
   * akun berubah. Ini penting karena efek reset di atas tidak ikut berjalan
   * lagi pada pembukaan kedua untuk akun yang sama — tanpa efek ini, menutup
   * lalu membuka dialog akan kembali ke "pilih paket" dan mengabaikan paket
   * yang tadi diklik.
   *
   * Urutannya penting: efek reset (`usernameRingkasan`) didaftarkan lebih dulu,
   * jadi efek ini berjalan sesudahnya dan boleh menimpanya.
   */
  const terbuka = Boolean(ringkasan);
  useEffect(() => {
    if (!terbuka) return;

    /*
     * Dua sumber paket, dan urutannya penting: tagihan yang sedang
     * dilanjutkan menang. Kalau kartu paket diklik **sambil** ada tagihan
     * `menunggu`, yang dibayar harus tagihan itu — bukan paket baru. Membuat
     * tagihan kedua pasti ditolak server, jadi tanpa ini dialognya akan
     * terlihat seperti bekerja lalu gagal di langkah terakhir.
     */
    const idPaket = lanjutkanOrderId
      ? tagihan.find(item => item.orderId === lanjutkanOrderId)?.paketId
      : paketTerpilihAwal;

    if (!idPaket) return;
    const paketFound = paket.find(item => item.id === idPaket);
    if (!paketFound) {
      /*
       * Paket tagihan sudah tidak dijual (dihapus dari pengaturan, atau
       * dinonaktifkan). Menampilkan "pilih paket" di sini akan berakhir dengan
       * tagihan tetap menggantung dan tidak ada jalan keluar — jadi pengguna
       * dikasih tahu untuk membatalkan dulu.
       */
      setLangkah('pilih-paket');
      setGalat(
        'Paket pada tagihan ini sudah tidak tersedia, jadi tidak bisa dilanjutkan. ' +
          'Batalkan tagihannya dulu, lalu pilih paket yang lain.'
      );
      return;
    }
    setTerpilih(paketFound);
    setLangkah('pilih-metode');
  }, [terbuka, paketTerpilihAwal, lanjutkanOrderId, tagihan, paket]);

  /**
   * Metode yang benar-benar bisa dipakai.
   *
   * Disaring dari konfigurasi, bukan hanya dari `metodeAktif`: QRIS tanpa
   * string, transfer tanpa rekening, dan Midtrans tanpa server key
   * semuanya tidak bisa dipakai — menampilkannya hanya menghasilkan error
   * setelah pengguna memilih.
   */
  const metodeTersedia = useMemo(() => {
    const daftar: MetodePembayaran[] = [];
    if (pengaturan.metodeAktif.includes('qris') && pengaturan.qrisStatis.trim()) daftar.push('qris');
    if (
      pengaturan.midtransAktif &&
      pengaturan.metodeAktif.includes('qris_midtrans') &&
      midtransAda === true
    ) {
      daftar.push('qris_midtrans');
    }
    const rekAktif = pengaturan.rekening.filter(item => item.aktif && item.nomorRekening.trim());
    if (pengaturan.metodeAktif.includes('transfer') && rekAktif.length > 0) daftar.push('transfer');
    return daftar;
  }, [pengaturan, midtransAda]);
  const memeriksaMidtrans = pengaturan.midtransAktif && midtransAda === null;

  /** Buat tagihan, lalu siapkan QR atau instruksi transfer. */
  const mulai = useCallback(
    async (paketDipilih: PaketLangganan, metode: MetodePembayaran) => {
      if (!ringkasan) return;
      setBekerja(true);
      setGalat(null);
      const id = idTagihan(paketDipilih.id);
      setOrderId(id);

      /*
       * Melanjutkan tagihan yang sudah ada: jangan buat dokumen baru.
       *
       * Server menolak pembuatan tagihan kedua dengan 409, jadi memanggil
       * `buatTagihan` di sini akan berakhir dengan error — dan tombol
       * "Lanjutkan Pembayaran" menjadi tidak berguna. `idTagihan()` di atas
       * hanya dipakai untuk tagihan baru; saat melanjutkan, `orderId` milik
       * dokumen yang sudah ada yang dipakai.
       */
      const idLanjut = lanjutkanOrderId?.trim() || null;

      try {
        /*
         * Impor dinamis: `langgananFirestore` menarik SDK Firestore
         * (140 kB gzip). Modul ini diimpor secara statis oleh
         * `GerbangLangganan`, yang ada di jalur muat awal — jadi impor statis
         * di sini akan menarik SDK itu ke bundle awal dan memperlambat halaman
         * login untuk semua orang, termasuk yang langganannya masih aktif.
         *
         * `buatTagihan` baru dibutuhkan setelah orang menekan tombol bayar,
         * jadi di situ pula modulnya baru diunduh.
         *
         * ⚠️ Sekarang dari `akunFirestore`, bukan `langgananFirestore`:
         * penulisan tagihan harus lewat server, karena `jatim_tagihan` ditutup
         * untuk tulis klien. Lihat catatan panjang di kepala
         * `lib/langgananFirestore.ts`.
         */
        /*
         * Saat melanjutkan, nominal dan paket diambil dari **dokumen tagihan
         * yang sudah ada**, bukan dari paket yang dipilih di dialog.
         *
         * Kenapa: `qrisDinamis()` mengunci nominal ke dalam QR. Kalau nominal
         * dihitung ulang dari harga paket saat ini sementara tagihan lama
         * dibuat dengan harga lama, QR-nya jadi tidak cocok dengan tagihan —
         * dan verifikasi pembayaran akan gagal jauh setelah pengguna
         * transfer. Worst case: harga naik di tengah.
         */
        const idPakai = idLanjut ?? id;

        if (idLanjut) {
          const lanjut = tagihan.find(item => item.orderId === idLanjut);
          const nominalLanjut = Number(lanjut?.nominal);
          if (lanjutkanOrderId && Number.isFinite(nominalLanjut) && nominalLanjut > 0) {
            if (metode === 'qris') {
              setQrTeks(qrisDinamis(pengaturan.qrisStatis, { nominal: nominalLanjut }));
              setLangkah('qris');
            } else if (metode === 'transfer') {
              const rekAktif = pengaturan.rekening.filter(item => item.aktif && item.nomorRekening.trim());
              setRekening(rekAktif[0] ?? null);
              setLangkah('transfer');
            } else {
              await jalankanSnap(idPakai, paketDipilih, metode);
            }
            return;
          }
        }

        const { buatTagihan } = await import('../lib/akunFirestore');
        await buatTagihan({
          orderId: id,
          usernameLabel: ringkasan.username,
          paketId: paketDipilih.id,
          metode,
        });

        if (metode === 'qris') {
          // QRIS statis → dinamis. Nominal terkunci di dalam QR, jadi
          // pengguna tidak bisa membayar kurang dari yang ditagih.
          setQrTeks(qrisDinamis(pengaturan.qrisStatis, { nominal: paketDipilih.harga }));
          setLangkah('qris');
        } else if (metode === 'transfer') {
          const rekAktif = pengaturan.rekening.filter(item => item.aktif && item.nomorRekening.trim());
          setRekening(rekAktif[0] ?? null);
          setLangkah('transfer');
        } else {
          await jalankanSnap(id, paketDipilih, metode);
        }
      } catch (err: any) {
        setGalat(err?.message ?? 'Gagal menyiapkan pembayaran.');
        setLangkah('pilih-paket');
      } finally {
        setBekerja(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ringkasan, pengaturan, lanjutkanOrderId, tagihan]
  );

  /**
   * Buka Midtrans Snap lalu tunggu callback-nya.
   *
   * Snap hanya mendukung satu popup aktif; membuka yang kedua tanpa
   * menunggu yang pertama membuat keduanya tidak bisa dipakai.
   */
  const jalankanSnap = async (id: string, paketDipilih: PaketLangganan, metode: MetodePembayaran) => {
    if (snapAktifRef.current) {
      setGalat('Jendela Midtrans masih terbuka. Tutup dulu sebelum membuka lagi.');
      setLangkah('pilih-paket');
      return;
    }
    snapAktifRef.current = true;
    setLangkah('menunggu');
    setGalat(null);

    try {
      await muatSnap();
      const token = await snapToken(id, paketDipilih.harga, paketDipilih.label, ringkasan!.username);
      if (!window.snap) throw new Error('Midtrans Snap belum siap.');

      window.snap.pay(token, {
        onSuccess: () => {
          snapAktifRef.current = false;
          setelahMidtrans(id, paketDipilih, metode);
        },
        onPending: () => {
          snapAktifRef.current = false;
          setLangkah('pilih-metode');
          setGalat('Transaksi masih menunggu. Selesaikan pembayaran di aplikasi Midtrans lalu ulangi.');
        },
        onError: () => {
          snapAktifRef.current = false;
          setLangkah('pilih-metode');
          setGalat('Pembayaran gagal. Coba lagi atau pilih metode lain.');
        },
        onClose: () => {
          snapAktifRef.current = false;
          setLangkah('pilih-metode');
        },
      });
    } catch (err: any) {
      snapAktifRef.current = false;
      setLangkah('pilih-metode');
      setGalat(err?.message ?? 'Gagal membuka Midtrans Snap.');
    }
  };

  /**
   * Minta server memperpanjang masa aktif.
   *
   * ⚠️ Peramban tidak menulis Firestore lagi. Server yang menghitung harga
   * dan durasi, memverifikasi Midtrans, lalu menulis dokumennya — sehingga
   * mengedit `masaAkhir` lewat DevTools tidak punya efek apa pun
   * (`firestore.rules` menutup jalur tulis dari klien).
   *
   * Idempoten terhadap `orderId` di sisi server, jadi menekan tombol
   * berulang tidak menambah bulan berulang.
   *
   * Fungsi ini **tidak** memutuskan apa yang ditampilkan selanjutnya — hanya
   * melaporkan hasilnya. Midtrans membuka layar "Selesai", sedangkan QRIS dan
   * transfer menyerahkan kendali ke gerbang (layar "Mohon Tunggu"). Kalau
   * pemanggil menentukan sendiri kesalahannya, satu jalur yang lupa menangani
   * `ok: false` akan membuat pengguna mengira sudah bayar padahal tidak.
   */
  const terapkan = async (
    id: string,
    paketDipilih: PaketLangganan,
    metode: MetodePembayaran
  ): Promise<{ ok: boolean; pesan: string; masaAkhir: string }> => {
    const gagal = (pesan: string) => ({ ok: false, pesan, masaAkhir: '' });
    if (!ringkasan) return gagal('Sesi tidak valid. Muat ulang halaman.');
    setBekerja(true);
    setGalat(null);
    try {
      // Waktu pembayaran ditentukan server (dari Midtrans), bukan klien.
      // `username` juga tidak dikirim — server membacanya dari token sesi.
      const hasil = await aktifkanLangganan({
        orderId: id,
        metode,
        nominal: paketDipilih.harga,
      });
      if (!hasil.ok) return gagal(hasil.pesan ?? 'Server menolak pembayaran ini.');
      return { ok: true, pesan: '', masaAkhir: hasil.masaAkhir ?? '' };
    } catch (err: any) {
      return gagal(err?.message ?? 'Gagal menghubungi server pembayaran.');
    } finally {
      setBekerja(false);
    }
  };

  /**
   * Midtrans selesai — langsung minta server mengaktifkan.
   *
   * ⚠️ Verifikasi TIDAK dilakukan di sini. `onSuccess` Snap dipanggil saat
   * pengguna menekan "Kembali", yang sama sekali bukan bukti pembayaran —
   * pengguna bisa belum membayar apa pun. Verifikasi yang menentukan ada
   * di server (`/api/billing/aktivasi`), satu-satunya tempat yang punya
   * `Server Key`.
   */
  const setelahMidtrans = async (id: string, paketDipilih: PaketLangganan, metode: MetodePembayaran) => {
    // `bekerja` sudah ditangani di dalam `terapkan()`.
    const hasil = await terapkan(id, paketDipilih, metode);
    if (!hasil.ok) {
      setLangkah('pilih-metode');
      setGalat(hasil.pesan);
      return;
    }
    setMasaAkhir(hasil.masaAkhir);
    setLangkah('selesai');
    toast.success(`Langganan aktif sampai ${formatTanggalLokal(hasil.masaAkhir)}.`);
  };

  /**
   * Satu tombol untuk QRIS manual dan transfer bank.
   *
   * Tekanannya berarti dua hal sekaligus: "saya sudah membayar" (dikirim ke
   * server) dan "beri tahu admin" (WhatsApp terbuka dengan pesan terisi).
   *
   * ⚠️ Bila server menolak, **tidak** masuk ke layar tunggu — pesannya
   * ditampilkan apa adanya di dialog. Menunggu 5 menit padahal server sudah
   * menolak dari awal hanya membuang waktu orang yang uangnya benar-benar
   * sudah keluar.
   */
  const konfirmasiManual = async (metode: MetodePembayaran) => {
    if (!terpilih || !orderId) return;
    const hasil = await terapkan(orderId, terpilih, metode);
    if (!hasil.ok) {
      setGalat(hasil.pesan);
      return;
    }
    onTungguVerifikasi({
      username: ringkasan?.username ?? '',
      orderId,
      paket: terpilih.label,
      nominal: terpilih.harga,
    });
  };

  /**
   * Tautan konfirmasi WhatsApp.
   *
   * `null` bila nomor belum diisi atau formatnya tidak valid. Tombolnya tetap
   * muncul (dengan peringatan), bukan disembunyikan — menyembunyikannya akan
   * membuat tombol konfirmasi hilang total, dan pengguna tidak punya jalan
   * apa pun untuk mengaktifkan langganannya.
   */
  const pesanWa = useMemo(() => {
    if (!terpilih || !ringkasan) return null;
    return isiPesanWa(pengaturan.templateWa, {
      app: APP_NAME,
      nama: '',
      username: ringkasan.username,
      orderId,
      nominal: terpilih.harga,
      paket: terpilih.label,
      tanggal: formatTanggalWaktuLokal(new Date().toISOString()),
    });
  }, [terpilih, ringkasan, pengaturan.templateWa, orderId]);

  const urlWa = useMemo(
    () => (pesanWa ? tautanWa(pengaturan.nomorWa, pesanWa) : null),
    [pesanWa, pengaturan.nomorWa]
  );

  const unduh = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `qris-${ringkasan?.username ?? 'pembayaran'}-${orderId}.png`;
    link.click();
  };

  if (!ringkasan) return null;

  // Lebar kartu mengikuti ruang modal; di layar sempit QR tetap terbaca.
  const lebarKartu = 264;

  return (
    <>
      <Modal
        open={Boolean(ringkasan)}
        onClose={onClose}
        title={
          langkah === 'selesai'
            ? 'Pembayaran Berhasil'
            : `Perpanjang Langganan — ${ringkasan.username}`
        }
        icon={langkah === 'selesai' ? undefined : <Banknote className="w-5 h-5 text-blue-500" />}
        size="md"
      >
        <div className="space-y-4">
          {galat && <Alert tone="rose">{galat}</Alert>}

          {/* ── Pilih paket ──────────────────────────────────────────── */}
          {langkah === 'pilih-paket' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Masa aktif dihitung <strong>kalender</strong> dari tanggal pembayaran — bukan jumlah hari.
                Contoh: bayar 1 bulan tanggal 31 Januari berakhir 28 Februari, bayar lagi 1 bulan berakhir
                28 Maret.
              </p>

              {paket.length === 0 ? (
                <Alert tone="amber">
                  Belum ada paket yang tersedia. Hubungi administrator untuk mengaktifkan langganan.
                </Alert>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {paket.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={bekerja || (metodeTersedia.length === 0 && !memeriksaMidtrans)}
                      onClick={() => {
                        setTerpilih(item);
                        setLangkah('pilih-metode');
                      }}
                      className="p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 disabled:opacity-50"
                    >
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.label}</p>
                      <p className="text-xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">
                        {formatRupiah(item.harga)}
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                        {deskripsiDurasi(item.durasi, item.satuan)} sejak tanggal bayar
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                        berakhir {formatTanggalLokal(tambahDurasi(new Date(), item.durasi, item.satuan).toISOString())}
                      </p>
                      {item.keterangan && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                          {item.keterangan}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {paket.length > 0 && metodeTersedia.length === 0 && (
                <Alert tone="amber">
                  {memeriksaMidtrans ? (
                    <span className="inline-flex items-center gap-2" role="status">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Memeriksa metode pembayaran…
                    </span>
                  ) : (
                    <>
                      Belum ada metode pembayaran yang siap. Hubungi administrator — atau minta
                      akunmu ditandai gratis sementara.
                    </>
                  )}
                </Alert>
              )}
            </div>
          )}

          {/* ── Pilih metode ─────────────────────────────────────────── */}
          {langkah === 'pilih-metode' && terpilih && (
            <div className="space-y-3">
              <RingkasanPaket
                paket={terpilih}
                onKembali={() => setLangkah('pilih-paket')}
                onUbah={() => {
                  setTerpilih(null);
                                setOrderId('');
                  setLangkah('pilih-paket');
                }}
              />

              {orderId && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">Tagihan: {orderId}</p>
              )}

              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Metode Pembayaran
              </p>
              <div className="space-y-2">
                {metodeTersedia.map(metode => {
                  const Icon = METODE_ICON[metode];
                  return (
                    <button
                      key={metode}
                      type="button"
                      disabled={bekerja}
                      onClick={() => void mulai(terpilih, metode)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          {METODE_LABEL[metode]}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                          {METODE_HINT[metode]}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {metodeTersedia.length === 0 && memeriksaMidtrans && (
                <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Memeriksa metode pembayaran…
                </p>
              )}
            </div>
          )}

          {/* ── QRIS ─────────────────────────────────────────────────── */}
          {langkah === 'qris' && (
            <div className="space-y-3.5">
              <Nominal besar={terpilih?.harga ?? 0} username={ringkasan.username} />

              {/* Kartu bisa diklik untuk memperbesar — pemindai di HP
                  sering struggled dengan QR yang tampil kecil. */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setPerbesar(true)}
                  disabled={!qrDataUrl}
                  className="group relative rounded-[20px] transition-transform duration-200 hover:scale-[1.01] disabled:cursor-default"
                  aria-label="Perbesar kode QR"
                >
                  <Suspense fallback={<KartuQrisSkeleton lebar={lebarKartu} />}>
                    <KartuQris qrisString={qrTeks} lebar={lebarKartu} onSiap={setQrDataUrl} />
                  </Suspense>
                  {qrDataUrl && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-[20px] bg-slate-900/0 group-hover:bg-slate-900/40 transition-colors duration-200">
                      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 text-[11px] font-bold text-slate-800 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <Maximize2 className="w-3.5 h-3.5" />
                        Perbesar
                      </span>
                    </span>
                  )}
                </button>
              </div>

              {/*
                Hanya "Unduh". Tombol "Salin QR" dihapus: menyalin string
                QRIS tidak berguna bagi siapa pun — memindai QR butuh
                gambarnya, bukan teks TLV-nya — dan hanya menambah satu
                tombol yang bisa dikira sudah menyelesaikan pembayaran.
              */}
              <button
                type="button"
                onClick={unduh}
                disabled={!qrDataUrl}
                className="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Unduh QR (PNG)
              </button>

              <TombolKonfirmasiWa
                url={urlWa}
                bekerja={bekerja}
                onKonfirmasi={() => void konfirmasiManual('qris')}
              />
            </div>
          )}

          {/* ── Transfer bank ────────────────────────────────────────── */}
          {langkah === 'transfer' && terpilih && rekening && (
            <div className="space-y-3.5">
              <Nominal besar={terpilih.harga} username={ringkasan.username} />

              {/*
                Ikon bank memakai warna resmi bank, dengan logo putih di
                atasnya — itu yang membuat daftar lima bank ini terbaca
                sekilas, tanpa pengguna harus membaca teksnya.
              */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 text-center">
                {infoBank(rekening.kodeBank) && (
                  <div className="flex flex-col items-center gap-2 mb-3">
                    <span
                      className="w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden shadow-sm"
                      style={{ backgroundColor: infoBank(rekening.kodeBank)!.warna }}
                    >
                      <img
                        src={infoBank(rekening.kodeBank)!.ikon}
                        alt={infoBank(rekening.kodeBank)!.nama}
                        className="w-full h-full object-contain p-1.5 bg-white"
                      />
                    </span>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {infoBank(rekening.kodeBank)!.nama}
                    </p>
                  </div>
                )}
                <p className="text-2xl font-black font-mono text-slate-800 dark:text-slate-100 mt-1.5 tracking-tight">
                  {rekening.nomorRekening}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">a.n. {rekening.atasNama}</p>
                {rekening.catatan && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">{rekening.catatan}</p>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(rekening.nomorRekening);
                      toast.success('Nomor rekening tersalin.');
                    } catch {
                      toast.error('Tidak bisa menyalin. Catat manual nomornya.');
                    }
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <ClipboardCopy className="w-3.5 h-3.5" />
                  Salin rekening
                </button>
              </div>

              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono text-center break-all">
                Tagihan: {orderId}
              </p>

              <TombolKonfirmasiWa
                url={urlWa}
                bekerja={bekerja}
                onKonfirmasi={() => void konfirmasiManual('transfer')}
              />
            </div>
          )}

          {/* ── Menunggu Midtrans ────────────────────────────────────── */}
          {langkah === 'menunggu' && (
            <div className="flex flex-col items-center py-10 gap-3 text-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Menunggu pembayaran di Midtrans…
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">
                Selesaikan pembayaran di jendela Midtrans. Status akan dicek otomatis setelah kamu menekan
                &quot;Kembali&quot;.
              </p>
            </div>
          )}

          {/* ── Selesai ──────────────────────────────────────────────── */}
          {langkah === 'selesai' && (
            <div className="flex flex-col items-center py-6 gap-3 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">Langganan Aktif</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
                {ringkasan.username} aktif sampai <strong>{formatTanggalLokal(masaAkhir)}</strong>. Kamu
                sekarang bisa login ke server pusat dan memakai semua menu.
              </p>
              <button
                type="button"
                onClick={() => void onSelesai()}
                className="mt-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors"
              >
                Lanjut ke Aplikasi
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* ── Perbesar QR ────────────────────────────────────────────── */}
      {perbesar && qrDataUrl && (
        <Modal
          open={perbesar}
          onClose={() => setPerbesar(false)}
          title="Kode QR Pembayaran"
          icon={<Maximize2 className="w-5 h-5 text-blue-500" />}
          size="sm"
          footer={
            <button
              type="button"
              onClick={() => setPerbesar(false)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-600 px-4 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors"
            >
              Tutup
            </button>
          }
        >
          <div className="flex justify-center">
            <img
              src={qrDataUrl}
              alt="Kartu QRIS pembayaran"
              className="rounded-2xl shadow-sm max-w-full"
            />
          </div>
        </Modal>
      )}
    </>
  );
}

/** Ambil token Snap untuk satu transaksi. */
async function snapToken(
  orderId: string,
  nominal: number,
  labelPaket: string,
  username: string
): Promise<string> {
  const hasil = await buatTransaksi({
    transaction_details: {
      order_id: orderId,
      gross_amount: nominal,
    },
    item_details: [{ price: nominal, quantity: 1, name: `${APP_NAME} — ${labelPaket}` }],
    customer_details: { first_name: username },
    enabled_payments: ['qris'],
  });
  const token = (hasil as Record<string, unknown>).token;
  if (typeof token !== 'string' || !token) {
    throw new Error('Token Midtrans tidak diterima. Hubungi administrator.');
  }
  return token;
}

/** Nominal besar di atas QR / rekening. */
function Nominal({ besar, username }: { besar: number; username: string }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 p-4 text-center text-white">
      <p className="text-[10px] uppercase tracking-wider font-bold text-white/70">Total Pembayaran</p>
      <p className="text-2xl font-black mt-0.5 font-mono tracking-tight">{formatRupiah(besar)}</p>
      <p className="text-xs text-white/75 mt-1">{username}</p>
    </div>
  );
}

/** Ringkasan paket di langkah kedua, dengan tombol kembali. */
function RingkasanPaket({
  paket,
  onKembali,
  onUbah,
}: {
  paket: PaketLangganan;
  onKembali: () => void;
  onUbah: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={onKembali}
        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
        aria-label="Kembali ke pilihan paket"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{paket.label}</p>
        <p className="text-base font-black text-slate-800 dark:text-slate-100 font-mono mt-0.5">
          {formatRupiah(paket.harga)}
        </p>
      </div>
      <button
        type="button"
        onClick={onUbah}
        className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
      >
        Ubah
      </button>
    </div>
  );
}

/**
 * Satu-satunya tombol konfirmasi untuk QRIS manual dan transfer bank.
 *
 * ## Kenapa digabung
 *
 * Sebelumnya ada dua tombol terpisah: "Konfirmasi via WhatsApp" (memberi tahu
 * admin) dan "Saya Sudah Bayar" (mengaktifkan langganan). Keduanya menyatakan
 * hal yang sama — *saya sudah bayar* — dan tidak ada keadaan di mana salah satu
 * melakukan lebih banyak dari yang lain. Yang terjadi di lapangan: pengguna
 * menekan yang WhatsApp, mengira sudah selesai, lalu menunggu jawaban yang
 * tidak pernah datang.
 *
 * Sekarang satu tekanan tombol berarti dua hal sekaligus:
 *
 * 1. `onKonfirmasi()` → server menerima "saya sudah bayar" (menghitung
 *    durasi, menulis Firestore lewat Admin SDK).
 * 2. Tautan `wa.me` terbuka dengan pesan konfirmasi yang sudah terisi.
 *
 * ## Kenapa ikonnya inline, bukan `<img>`
 *
 * Tombolnya hijau `#25D366` — warna resmi WhatsApp — jadi ikon WhatsApp
 * berwarna hijau di atas hijau akan lenyap. Dulu ada `public/ico/wa.svg` untuk
 * dimuat lewat `<img>`, dan itu salah: `fill` di dalam SVG tidak mewarisi
 * `currentColor`, jadi warna ikonnya terkunci di hijau apa pun warna tombol.
 * Karena itu ikonnya `IkonWa`, komponen JSX dengan `fill="currentColor"`,
 * dan kelas `text-white` pada elemen induknya yang menentukan warnanya.
 *
 * Berkas `wa.svg`-nya sendiri sudah dihapus. Tidak ada yang memakainya —
 * favicon memakai PNG di `public/assets/`, dan satu-satunya tempat ikon WhatsApp
 * muncul adalah `IkonWa`. Berkas yang tidak dirujuk hanya menambah ukuran
 * unggahan dan menahan salinan glif yang sama dua kali.
 *
 * ## Tanpa nomor WhatsApp
 *
 * `url` null berarti nomor admin belum diisi atau formatnya salah. Tombolnya
 * tetap ada — kali ini sebagai `<button>` biasa yang hanya mengaktifkan —
 * beserta peringatan. Sembunyikan tombolnya sama dengan mengunci pengguna
 * yang uangnya sudah keluar di luar aplikasi.
 *
 * Diekspor supaya bisa diuji dengan `renderToStaticMarkup`. Tombol ini
 * berada di langkah yang butuh interaksi (pilih paket → pilih metode → QR),
 * sehingga tidak akan pernah muncul di render statis apa adanya.
 */
export function TombolKonfirmasiWa({
  url,
  bekerja,
  onKonfirmasi,
}: {
  url: string | null;
  bekerja: boolean;
  onKonfirmasi: () => void;
}) {
  const gayaTombol =
    'w-full px-4 py-3 rounded-xl text-white transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

  /*
   * Label dua baris, bukan satu.
   *
   * Satu baris harus memaksakan satu kalimat untuk dua hal yang berbeda:
   * memberitahu server "saya sudah bayar" dan membuka WhatsApp. Hasilnya
   * kalimat yang tidak jelas artinya. Dua baris menyelesaikannya tanpa
   * menambah tombol: baris pertama menyatakan niat, baris kedua akibatnya.
   */
  const isi = bekerja ? (
    <span className="text-sm font-bold">Memproses…</span>
  ) : (
    <span className="text-left leading-tight">
      <span className="block text-sm font-bold">Saya Sudah Bayar</span>
      <span className="block text-[11px] font-medium text-white/85">
        Buka WhatsApp &amp; kirim tagihan
      </span>
    </span>
  );

  return (
    <div className="space-y-2 pt-1">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={event => {
            // ⚠️ `preventDefault` hanya dipanggil saat sedang memproses.
            // Yang normal justru navigasi itu sendiri yang dibutuhkan:
            // membuka WhatsApp adalah bagian dari aksi ini, bukan efek
            // samping yang perlu ditahan.
            if (bekerja) {
              event.preventDefault();
              return;
            }
            onKonfirmasi();
          }}
          className={`${gayaTombol} bg-[#25D366] hover:bg-[#1eb855] active:bg-[#199c4a] ${
            bekerja ? 'pointer-events-none' : ''
          }`}
        >
          <IkonWa className="w-6 h-6 text-white shrink-0" />
          {isi}
        </a>
      ) : (
        <button
          type="button"
          onClick={onKonfirmasi}
          disabled={bekerja}
          className={`${gayaTombol} bg-[#25D366] hover:bg-[#1eb855] active:bg-[#199c4a]`}
        >
          <IkonWa className="w-6 h-6 text-white shrink-0" />
          {isi}
        </button>
      )}

      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed flex items-start gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Tekan sekali saja: WhatsApp terbuka dengan detail tagihan, dan pembayaranmu langsung tercatat.
        Setelah itu aplikasi menunggu 5 menit — jangan tutup halamannya.
      </p>

      {!url && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
          Nomor WhatsApp admin belum diisi atau formatnya salah, jadi konfirmasi tidak bisa dikirim. Bayar
          dulu, lalu minta administrator mengaktifkan langgananmu.
        </p>
      )}

      {/*
       * Tidak ada tombol "kembali ke pilihan metode" di sini.
       *
       * Semula ada, dan itu membuat **dua** jalan keluar dari langkah QR yang
       * melakukan hal sama: tombol itu dan tombol tutup (X) di header modal.
       * Hanya salah satunya yang terlihat, jadi yang lain Diam dan jelas tidak
       * melakukan apa-apa.
       *
       * Yang tersisa sekarang hanya tombol tutup, dan itu sudah cukup. Menutup
       * dialog sama dengan kembali ke "pilih paket": efek yang di atas me-reset
       * langkah ke `pilih-paket` setiap kali dialog dibuka — kuncinya nama akun,
       * bukan objek `ringkasan`, jadi tidak ikut ter-reset oleh render ulang.
       *
       * Yang **tidak** hilang adalah kemampuan ganti paket: tombol "Ubah" di
       * `RingkasanPaket` masih ada, dan `GerbangLangganan` menampilkannya lagi
       * begitu tagihan dibatalkan.
       */}
    </div>
  );
}
