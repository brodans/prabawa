import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/ui/Toast';
import { ringkasanTitik, type RingkasanTitik } from '../lib/lokasiTersimpan';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  PasswordField,
  StatTile,
  Textarea,
  type Column,
} from '../components/ui/Surface';
import Dropdown from '../components/ui/Dropdown';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import Langganan from './Langganan';
import {
  type StatusLangganan,
  formatRupiah,
  paketEfektif,
  ringkasanLangganan,
  type DokumenLangganan,
} from '../lib/langganan';
import {
  mapLangganan,
} from '../lib/langgananFirestore';
import {
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  type TabPermissions,
  type UserAccount,
  type UserRole,
} from '../lib/userManager';
import {
  createUserAccount,
  deleteUserAccount,
  fetchAllUsers,
  hapusServerCredential,
  ringkasanKredensial,
  saveServerCredential,
  semuaRingkasanKredensial,
  updateUserAccount,
  type RingkasanKredensial,
} from '../lib/akunFirestore';
import IzinAkun from '../components/IzinAkun';
import { formatTanggalLokal } from '../lib/tanggal';

/**
 * URL tiap tab. Satu tab = satu URL.
 *
 * Tab Langganan memakai `/langganan` — bukan `/manajemen-akun/langganan`.
 * Keduanya menunjuk ke satu menu, tapi URL-nya berdiri sendiri: tab itu punya
 * halaman penuh dengan tab-tabnya sendiri, dan `/manajemen-akun/langganan`
 * akan mengatakannya adalah "bagian dari" manajemen akun, padahal tidak.
 */
const PATH_TAB_AKUN = {
  akun: '/manajemen-akun',
  langganan: '/langganan',
};

const tabDariPath = (path: string): keyof typeof PATH_TAB_AKUN =>
  path === PATH_TAB_AKUN.langganan || path.startsWith(`${PATH_TAB_AKUN.langganan}/`)
    ? 'langganan'
    : 'akun';

/**
 * Satu baris tabel.
 *
 * ⚠️ Kolom "Langganan" (badge status) **sengaja tidak ada di sini**. Status
 * langganan punya tempatnya sendiri — tab Langganan — dan menampilkannya dua
 * kali berarti dua sumber yang bisa berbeda: satu dihitung ulang dari
 * dokumen, satu dari state tabel yang mungkin basi. Yang tersisa hanya angka
 * yang tidak ada di tempat lain (tanggal berakhir, total bayar) dan keduanya
 * menjadi tautan ke tab Langganan.
 */
interface BarisAkun {
  akun: UserAccount;
  status: StatusLangganan;
  masaAkhir: string;
  sisaHari: number;
  paketLabel: string;
  totalBayar: number;
  jumlahBayar: number;
  /** Jumlah titik absen yang tersimpan di peramban akun ini. */
  jumlahTitik: number;
  /** Titik yang ditandai dipakai — ini koordinat yang dikirim saat absen. */
  titikAktif: RingkasanTitik | null;
  /** Metadata kredensial server — tanpa passwordnya. */
  kredensial: RingkasanKredensial | null;
}

/**rottle: `null` = semua, angka = hanya indeks halaman itu. */
const UKURAN_HALAMAN = 25;

/**
 * Menu **Manajemen Akun** — satu menu, dua tab, dua URL.
 *
 * ## Kenapa satu menu
 *
 * Dulu hanya ada satu menu "Langganan" berisi Accounts, Payments, dan Methods
 * semuanya. duas concerns berbeda bercampur: satu tentang **orang** (siapa
 * saja yang ada, NIP/password/IMEI/lokasi), satu tentang **uang** (masa
 * aktif, tagihan, metode). Menjadikannya tab tidak mengubah apa pun — user
 * masih satu menu, dan masalahnya user tidak bisa menemukan akun tertentu
 * di antara 500 baris tagihan.
 *
 * Sekarang: satu menu dengan dua tab, masing-masing dengan URL sendiri.
 * `/manajemen-akun` untuk akun, `/manajemen-akun/langganan` untuk
 * langganan. Bisa dibagikan, bisa di-bookmark, dan tombol Back bekerja
 * seperti seharusnya.
 *
 * ## Kolom Lokasi
 *
 * ⚠️ Titik absen disimpan **di peramban tiap pengguna**, jadi admin tidak bisa
 * membacanya dari Firestore — `ringkasanTitik()` hanya membaca `localStorage`
 * peramban yang sedang berjalan. Yang tampil di kolom "Lokasi" adalah jumlah
 * titik yang terlihat, dan itu jujur: 0 berarti akun ini belum pernah membuat
 * titik, **atau** memakai peramban/device lain.
 *
 * Admin tidak boleh disodorkan angka yang terlihat pasti tapi sebenarnya
 * tidak diketahui. Itu alasan kolom ini berbatas, bukan alasan untuk
 * menyembunyikannya.
 */
export default function ManajemenAkun() {
  const { currentUser, pathname, setSubPath } = useAppContext();
  const toast = useToast();
  const tab = tabDariPath(pathname);

  /*
   * Gerbang admin.
   *
   * Tiga jalur sudah tertutup, dan ketiganya perlu:
   *
   * 1. `visiblePages` di `App.tsx` — menu tidak muncul di sidebar.
   * 2. `batasiIzin()` di `userManager.ts` — izin khusus admin dipaksa `false`
   *    untuk non-admin apa pun isi dokumennya.
   * 3. Pemeriksaan di bawah — mengetik `/manajemen-akun` di address bar
   *    merender modul ini **sebelum** `visiblePages` dievaluasi, jadi gerbang
   *    di sidebar saja tidak menutup jalur itu.
   *
   * Perannya sudah berasal dari server (hasil verifikasi token), jadi nilai
   * `role` di sini bukan tebakan peramban. Tetap dijaga di modul ini karena
   * modul ini boleh dirender sendiri — `cek-manajemen-akun.mjs` merendernya
   * langsung lewat `renderToStaticMarkup` untuk memeriksa pesan "Akses
   * Ditolak" benar-benar muncul di HTML.
   */
  if (currentUser?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="max-w-md text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-7 h-7 text-rose-500" />
          </div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Akses Ditolak</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Menu Manajemen Akun hanya bisa diakses oleh akun admin.
          </p>
        </div>
      </div>
    );
  }

  /*
   * Nama tab harus sama dengan **judul halaman yang dibuka tab itu**.
   *
   * "Langganan" membuka halaman berjudul "Langganan & Pembayaran" — jadi
   * setengah sesuai, dan yang dilewatkan justru bagian yang menjelaskan ada
   * dua tabel di dalamnya. "Manajemen Akun" sudah persis sama dengan
   * judulnya, jadi tidak diubah.
   */
  const TABS = [
    { value: 'akun' as const, label: 'Manajemen Akun', icon: Users, path: PATH_TAB_AKUN.akun },
    {
      value: 'langganan' as const,
      label: 'Langganan & Pembayaran',
      icon: CreditCard,
      path: PATH_TAB_AKUN.langganan,
    },
  ];

  return (
    <div className="space-y-5">
      {/*
       * ⚠️ Tidak ada tombol "Menu Utama" di sini.
       *
       * Sidebar sudah ada di setiap halaman, dan di layar sempit ia ada di
       * hamburger. Tombol kedua yang melakukan hal yang sama bukan pintasan —
       * ia hanya menambah satu keputusan di tengah pekerjaan. Yang dipindah
       * ke sini adalah **isi** halamannya: tab, filter, dan tabel.
       *
       * ⚠️ Judul **tidak** ikut berubah saat tab berganti.
       *
       * Dua percobaan sebelumnya sama-sama salah dan arahnya berlawanan:
       *
       * - Judul tetap "Manajemen Akun" + subjudul "…dan langganan" di kedua
       *   tab → menekan tab tidak mengubah apa pun di kepala.
       * - Judul disembunyikan di tab Langganan → tampilannya melompat ke bawah
       *   saat tab berganti, dan yang di atas tabel kehilangan konteks.
       *
       * Yang benar: satu blok judul yang **konsisten di paling atas**,
       * menjelaskan menu ini apa — bukan tab yang sedang aktif. Tab di
       * bawahnya yang berubah; posisinya tidak.
       *
       * Karena itu tab kedua bernama "Langganan & Pembayaran", sama persis
       * dengan judul halaman yang dibuka tab itu — bukan "Langganan" saja
       * yang setengah sesuai.
       */}
      <PageHeader
        title="Manajemen Akun"
        subtitle="Kelola seluruh akun dan kredensial server"
        icon={<UserCog className="w-5 h-5" />}
      />

      {/* Tab di atas konten — dipisah dari sidebar supaya satu menu ini
          terbaca sebagai satu tempat, bukan dua menu yang tidak terkait. */}
      <div
        className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-700/60 pb-2"
        role="tablist"
        aria-label="Tab Manajemen Akun"
      >
        {TABS.map(item => {
          const Icon = item.icon;
          const aktif = tab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={aktif}
              onClick={() => setSubPath(item.path)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                aktif
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === 'langganan' ? <Langganan /> : <KelolaAkun toast={toast} setSubPath={setSubPath} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Tab 1 — Kelola akun
// ═══════════════════════════════════════════════════════════════════════

type SortKey = 'nama' | 'username' | 'status' | 'masaAkhir';

/** Filter peran. Default `semua` — daftar lengkap yang ditampilkan. */
type FilterPeran = 'semua' | UserRole;

function KelolaAkun({ toast, setSubPath }: {
  toast: ReturnType<typeof useToast>;
  setSubPath: (path: string) => void;
}) {
  const [akun, setAkun] = useState<UserAccount[]>([]);
  const [langgananMap, setLanggananMap] = useState<Map<string, DokumenLangganan>>(new Map());
  /** Metadata NIP + IMEI, dibaca sekali untuk semua akun. */
  const [kredensialMap, setKredensialMap] = useState<Map<string, RingkasanKredensial>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [cari, setCari] = useState('');
  const [filterPeran, setFilterPeran] = useState<FilterPeran>('semua');
  // Bawaan `nama`: daftar ini dibaca manusia. `username` adalah kunci teknis
  // dan diurutkan ke tempat yang jauh dari yang dicari.
  const [urut, setUrut] = useState<SortKey>('nama');
  const [halaman, setHalaman] = useState(0);
  const [dialog, setDialog] = useState<{ akun: UserAccount | null } | null>(null);
  const [konfirmasiHapus, setKonfirmasiHapus] = useState<UserAccount | null>(null);
  /**
   * `null` = belum ada yang gagal. String = status kredensial **tidak diketahui**,
   * yang Very berbeda dari "belum diatur".
   */
  const [galatKredensial, setGalatKredensial] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      /*
       * Tiga request, bukan 2 + N.
       *
       * Semula metadata kredensial diambil dengan `Promise.all(daftar.map(...))`
       * — satu request `kredensial:ringkas` **per akun**. Yang worse, tiap
       * request itu memanggil `cekPemilik()` → `akunDariToken()` →
       * `verifikasiToken()`, jadi satu pembacaan Firestore untuk token yang
       * **sama persis** diulang sebanyak jumlah akun.
       *
       * 40 akun = 40 request HTTP + 40 pembacaan token + 40 pembacaan
       * kredensial. Sekarang: 1 request, 1 verifikasi, 1 batch read.
       */
      /*
       * ⚠️ Kegagalan baca kredensial **tidak lagi ditelan**.
       *
       * Semula: `semuaRingkasanKredensial().catch(() => new Map())`. Map kosong
       * membuat setiap baris menampilkan "IMEI belum diisi / Kredensial belum
       * diatur" — persis seperti akun yang memang tidak punya kredensial, dan
       * persis seperti yang terjadi setelah admin mengisinya.
       *
       * Yang sebenarnya terjadi: server versi lama tidak mengenal aksi
       * `kredensial:ringkas-semua`, jadi jawabannya 400, jadi ditelan, jadi
       * tidak ada satu pun tanda di layar. Admin mengisi ulang, menyimpan
       * ulang, dan tidak pernah tahu kenapa.
       *
       * Sekarang kegagalan itu tampil apa adanya, dan tabelnya sendiri
       * menandai bahwa statusnya tidak diketahui — bukan "belum diatur".
       */
      const [daftar, peta, kred] = await Promise.all([
        fetchAllUsers(),
        mapLangganan(),
        semuaRingkasanKredensial()
          .then(petaKred => ({ peta: petaKred, galat: null as string | null }))
          .catch((err: any) => ({
            peta: new Map<string, RingkasanKredensial>(),
            galat: err?.message ?? 'Gagal membaca status kredensial server.',
          })),
      ]);
      setAkun(daftar);
      setLanggananMap(peta);
      setKredensialMap(kred.peta);
      setGalatKredensial(kred.galat);
    } catch (err: any) {
      setGalatKredensial(null);
      toast.error(err?.message ?? 'Gagal memuat daftar akun.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const baris = useMemo<BarisAkun[]>(() => {
    const paket = paketEfektif({
      // `mapLangganan()` sudah membawa dokumennya; paket dipakai hanya untuk
      // mencari label. Kosongkan berarti labelnya jatuh ke `paketId` — cukup
      // untuk tabel, dan tidak memicu pembacaan pengaturan sekali lagi.
      paket: [],
    } as never);

    return akun
      .map(item => {
        const doc = langgananMap.get(item.username) ?? null;
        const ring = ringkasanLangganan(item.username, doc, paket, item.role);
        // Titik absen dibaca dari storage peramban **yang sedang berjalan**,
        // jadi untuk akun lain nilainya pasti kosong. Itu jujur: kolom ini
        // tidak boleh menampilkan angka yang terlihat pasti tapi sebenarnya
        // tidak diketahui.
        const titik = ringkasanTitik(item.username);
        return {
          akun: item,
          status: ring.status,
          masaAkhir: ring.masaAkhir,
          sisaHari: ring.sisaHari,
          paketLabel: ring.paketLabel,
          totalBayar: ring.totalBayar,
          jumlahBayar: ring.jumlahBayar,
          jumlahTitik: titik.length,
          titikAktif: titik.find(t => t.dipakai) ?? null,
          kredensial: kredensialMap.get(item.username) ?? null,
        } satisfies BarisAkun;
      })
      .sort((a, b) => {
        switch (urut) {
          case 'nama':
            // `localeCompare` dengan `'id'` supaya "Budi" mendahului "Bunga"
            // dan bukan sebelumnya karena urutan abjad latin.
            return (a.akun.namaLengkap || a.akun.username).localeCompare(
              b.akun.namaLengkap || b.akun.username,
              'id'
            );
          case 'status':
            return a.status.localeCompare(b.status);
          case 'masaAkhir':
            return (a.masaAkhir || '9999').localeCompare(b.masaAkhir || '9999');
          default:
            return a.akun.username.localeCompare(b.akun.username, 'id');
        }
      });
  }, [akun, langgananMap, kredensialMap, urut]);

  /*
   * Pencarian satu string untuk semua kolom.
   *
   * NIP dicari di dua tempat karena bisa berbeda: `akun.nip` yang diisi admin
   * dan `kredensial.nip` yang benar-benar dipakai auto-login. Mencari hanya
   * yang pertama berarti NIP yang terpakai tidak ketemu.
   */
  const tersaring = useMemo(() => {
    const kunci = cari.trim().toLowerCase();
    if (!kunci) {
      return filterPeran === 'semua'
        ? baris
        : baris.filter(row => row.akun.role === filterPeran);
    }
    return baris.filter(row => {
      if (filterPeran !== 'semua' && row.akun.role !== filterPeran) return false;
      const targets = [
        row.akun.username,
        row.akun.namaLengkap,
        row.akun.nip,
        row.akun.catatan,
        row.kredensial?.nip,
        row.kredensial?.imei,
        row.paketLabel,
      ];
      return targets.some(t => String(t ?? '').toLowerCase().includes(kunci));
    });
  }, [baris, cari, filterPeran]);

  /**
   * Apakah ada filter/urutan yang berubah dari bawaan.
   *
   * Hanya untuk menentukan apakah baris "Reset" ditampilkan — bukan untuk
   * logika. Menyaringnya sendiri tetap murni nilai `tersaring`.
   */
  const adaFilter = cari.trim() !== '' || filterPeran !== 'semua' || urut !== 'nama';

  const bersihkanFilter = () => {
    setCari('');
    setFilterPeran('semua');
    setUrut('nama');
    setHalaman(0);
  };

  const totalHalaman = Math.max(1, Math.ceil(tersaring.length / UKURAN_HALAMAN));
  const halamanAman = Math.min(halaman, totalHalaman - 1);
  const terlihat = tersaring.slice(
    halamanAman * UKURAN_HALAMAN,
    (halamanAman + 1) * UKURAN_HALAMAN
  );

  const statistik = useMemo(
    () => ({
      total: baris.length,
      admin: baris.filter(r => r.akun.role === 'admin').length,
      aktif: baris.filter(r => r.status === 'aktif' || r.status === 'gratis').length,
    }),
    [baris]
  );

  const kolom: Column<BarisAkun>[] = [
    {
      key: 'akun',
      header: 'Akun',
      /*
       * `max-w-[230px]` mengikuti `w-[230px]` — bukan duplikat.
       *
       * Di `table-layout: auto`, `w-*` cuma **permintaan** lebar; yang tetap
       * jadi lantai adalah min-content sel. Untuk sel ber-`truncate` itu
       * sebesar teks penuhnya, karena nowrap tidak pernah membungkus. Jadi
       * tanpa `max-w`, satu nama lengkap yang panjang menentukan lebar
       * seluruh tabel dan kolom paling kanan keluar layar.
       *
       * Lihat catatan panjang di `DataTable`.
       */
      className: 'w-[230px] max-w-[230px]',
      render: row => (
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
            {row.akun.namaLengkap || row.akun.username}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">
            {row.akun.username}
          </p>
        </div>
      ),
    },
    {
      key: 'peran',
      header: 'Peran',
      className: 'w-[96px]',
      render: row =>
        row.akun.role === 'admin' ? (
          <Badge tone="violet">Admin</Badge>
        ) : row.akun.nonaktif ? (
          <Badge tone="slate">Nonaktif</Badge>
        ) : (
          <Badge tone="slate">User</Badge>
        ),
    },
    {
      /*
       * NIP & IMEI untuk auto-login.
       *
       * NIP diambil dari `akun.nip` (yang diisi admin), tapi kalau kredensial
       * server yang tersimpan punya NIP berbeda, **kredensial itulah yang
       * dipakai** — itulah yang dikirim ke server pusat. Menampilkan NIP dari
       * dokumen akun padahal auto-login memakai NIP lain berarti admin
       * memperbaiki angka yang tidak berpengaruh apa pun.
       *
       * Password tidak pernah ditampilkan: yang tersimpan hanya hash-nya, dan
       * hash bukan password. Yang ditampilkan hanyalah Status + tombol Atur.
       */
      key: 'server',
      header: 'NIP · IMEI (auto-login)',
      // Sama seperti kolom "Akun": `w-*` saja tidak membatasi min-content
      // sel yang isinya `truncate`.
      className: 'w-[200px] max-w-[200px]',
      render: row => {
        /*
         * `galatKredensial` !== null berarti **tidak ada yang tahu** statusnya.
         *
         * Menampilkan "IMEI belum diisi" di kondisi itu adalah berbohong: yang
         * tidak diketahui bukan "apakah IMEI-nya ada", tapi "apakah kita sempat
         * membacanya". Admin lalu mengisi ulang field yang sebenarnya sudah
         * terisi, dan setiap kali tetap tidak muncul.
         */
        if (galatKredensial) {
          return (
            <div className="min-w-0 text-[11px] leading-tight space-y-0.5">
              <p className="text-slate-400 dark:text-slate-500 italic">Status tidak diketahui</p>
              {row.akun.nip && (
                <p className="font-mono text-slate-500 dark:text-slate-400 truncate">
                  NIP akun: {row.akun.nip}
                </p>
              )}
            </div>
          );
        }
        return (
          <div className="min-w-0 text-[11px] leading-tight space-y-0.5">
            <p className="font-mono text-slate-700 dark:text-slate-200 truncate">
              {row.kredensial?.nip || row.akun.nip || (
                <span className="text-slate-300 dark:text-slate-600">belum diisi</span>
              )}
            </p>
            <p className="font-mono text-slate-400 dark:text-slate-500 truncate">
              {row.kredensial?.imei || (
                <span className="text-slate-300 dark:text-slate-600">IMEI belum diisi</span>
              )}
            </p>
            <p className="truncate">
              {row.kredensial ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Auto-login siap
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  Kredensial belum diatur
                </span>
              )}
            </p>
          </div>
        );
      },
    },
    {
      key: 'lokasi',
      header: 'Lokasi Absen',
      // Sama seperti kolom "Akun": nama titik absen ber-`truncate` perlu plafon.
      className: 'w-[150px] max-w-[150px]',
      render: row => (
        <div className="min-w-0 text-[11px] leading-tight">
          {row.titikAktif ? (
            <>
              <p className="text-slate-700 dark:text-slate-200 font-semibold truncate">
                {row.titikAktif.nama}
              </p>
              <p className="font-mono text-slate-400 dark:text-slate-500">
                {row.titikAktif.latitude.toFixed(5)}, {row.titikAktif.longitude.toFixed(5)}
              </p>
            </>
          ) : (
            <>
              <p className="text-slate-400 dark:text-slate-500">
                {row.jumlahTitik > 0 ? `${row.jumlahTitik} titik, belum ada yang dipakai` : 'Belum ada'}
              </p>
              {row.jumlahTitik === 0 && (
                <p className="text-slate-300 dark:text-slate-600 text-[10px]">
                  device ini atau belum pernah membuat
                </p>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      /*
       * Masa Aktif & Total Bayar — dua angka yang tidak ada di tab Langganan
       * dengan bentuk yang bisa dipindai sekilas.
       *
       * Keduanya tautan ke tab Langganan. Tanpa itu, menghapus badge status
       * akan membuat layar ini jadi buntu: admin melihat "terlambat 3 hari"
       * tapi tidak punya jalan dari sana ke tempat perpanjangan berada.
       */
      key: 'masa',
      header: 'Masa Aktif',
      className: 'w-[150px]',
      render: row =>
        row.akun.role === 'admin' ? (
          <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">Tidak berlaku</span>
        ) : (
          <button
            type="button"
            onClick={() => setSubPath(PATH_TAB_AKUN.langganan)}
            title={`Kelola langganan ${row.akun.username}`}
            className="block w-full text-left min-w-0 text-[11px] leading-tight group"
          >
            {row.masaAkhir ? (
              <>
                <p className="font-mono font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {formatTanggalLokal(row.masaAkhir)}
                </p>
                <p
                  className={`font-mono ${
                    row.sisaHari <= 3 ? 'text-rose-500' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {row.sisaHari < 0 ? 'sudah lewat' : `${row.sisaHari} hari lagi`}
                </p>
              </>
            ) : (
              <span className="text-amber-500">Belum pernah bayar</span>
            )}
          </button>
        ),
    },
    {
      key: 'bayar',
      header: 'Total Bayar',
      className: 'w-[110px]',
      render: row => (
        <button
          type="button"
          onClick={() => setSubPath(PATH_TAB_AKUN.langganan)}
          title={`Riwayat pembayaran ${row.akun.username}`}
          className="block w-full text-left text-[11px] leading-tight group"
        >
          <p className="font-mono font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {formatRupiah(row.totalBayar)}
          </p>
          <p className="text-slate-400 dark:text-slate-500">{row.jumlahBayar}×</p>
        </button>
      ),
    },
    {
      key: 'aksi',
      header: '',
      className: 'w-[84px]',
      render: row => (
        <div className="flex items-center gap-1">
          <AksiIkon
            icon={UserCog}
            label="Ubah akun"
            onClick={() => setDialog({ akun: row.akun })}
          />
          <AksiIkon
            icon={Trash2}
            label="Hapus akun"
            tone="rose"
            onClick={() => setKonfirmasiHapus(row.akun)}
          />
        </div>
      ),
    },
  ];

  if (loading) return <LoadingBlock label="Memuat akun..." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Total Akun" value={statistik.total} tone="blue" icon={<Users className="w-4 h-4" />} />
        <StatTile label="Administrator" value={statistik.admin} tone="violet" icon={<ShieldCheck className="w-4 h-4" />} />
        <StatTile label="Berlangganan" value={statistik.aktif} tone="emerald" hint="Aktif atau gratis" />
      </div>

      <Card padded={false} className="p-4 sm:p-5">
        {/*
         * ⚠️ Satu grid, bukan tiga blok yang disejajarkan.
         *
         * Semula strukturnya `flex` berisi: (1) pencarian + dua dropdown
         * bersarang, (2) blok ringkasan filter yang **hanya muncul saat ada
         * filter aktif**, (3) dua tombol. Tiga masalah langsung:
         *
         * 1. **Tinggi tidak sama.** Input dan `Dropdown` setinggi 42 px
         *    (`py-2.5 text-sm`), tapi `ActionButton size="sm"` hanya 30 px
         *    (`py-1.5 text-xs`). Di baris yang sama, tombolnya jelas lebih
         *    kecil dari kolom di sebelahnya.
         * 2. **Lebar tidak sama.** Dua dropdown diletakkan di `grid-cols-2`
         *    tanpa lebar tetap, jadi kolomnya mengikuti isi ("Semua" vs
         *    "Masa Aktif") — lebarnya berbeda-beda.
         * 3. **Baris melompat.** Blok ringkasan yang kondisional menyisipkan
         *    `mt-2.5` di tengah, jadi saat filter pertama kali aktif, tombol
         *    Muat / Akun Baru terdorong dan tidak lagi sejajar dengan kolom.
         *
         * Sekarang: satu grid dengan `sm:items-end`, sehingga label dan
         * kendali semua sejajar di dasar. Lebar kedua dropdown ditetapkan —
         * panel popupnya tetap `min-w-[13rem]`, jadi trigger yang lebih
         * sempit tidak ikut membuat daftar opsinya sempit.
         */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto] sm:items-end">
          <Field label="Cari akun">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input
                value={cari}
                onChange={e => {
                  setCari(e.target.value);
                  setHalaman(0);
                }}
                placeholder="Nama, username, NIP, jabatan..."
                className="pl-8"
              />
              {cari && (
                <button
                  type="button"
                  onClick={() => {
                    setCari('');
                    setHalaman(0);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  aria-label="Bersihkan pencarian"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </Field>

          {/*
           * Filter & urutan.
           *
           * Keduanya punya **nilai bawaan yang terlihat**. Bawaan urutan
           * adalah "Nama", bukan "Username": daftar ini dibaca orang, bukan
           * mesin — `budi.santoso` dan `Budi Santoso` diurutkan ke tempat yang
           * sangat berbeda, dan yang kedua yang dicari.
           *
           * Lebarnya ditetapkan, bukan dibiarkan mengikuti isi: opsi "Semua"
           * (5 huruf) dan "Masa Aktif" (10 huruf) membuat dua kolom dengan
           * lebar berbeda di baris yang sama.
           */}
          <Field label="Peran">
            <Dropdown
              value={filterPeran}
              onChange={v => {
                setFilterPeran(v as FilterPeran);
                setHalaman(0);
              }}
              opsi={[
                { value: 'semua', label: 'Semua' },
                { value: 'admin', label: 'Admin' },
                { value: 'user', label: 'User' },
              ]}
              aria-label="Filter peran"
              className="w-full"
            />
          </Field>
          <Field label="Urutkan">
            <Dropdown
              value={urut}
              onChange={v => {
                setUrut(v as SortKey);
                setHalaman(0);
              }}
              opsi={[
                { value: 'nama', label: 'Nama' },
                { value: 'username', label: 'Username' },
                { value: 'status', label: 'Status' },
                { value: 'masaAkhir', label: 'Masa Aktif' },
              ]}
              aria-label="Urutkan"
              className="w-full"
            />
          </Field>

          {/*
           * Tombol: 42 px (sama persis dengan input), tapi ** ringan**.
           *
           * ⚠️ `size="md"` + `w-[108px]` yang dipakai sebelumnya itu salah
           * di dua hal sekaligus, dan keduanya terlihat langsung:
           *
           * 1. **Teks meluber.** `size="md"` = `px-4` (16 px) + ikon 16 px +
           *    `gap-2` (8 px) + "Akun Baru" di `text-sm` (±70 px) = **±128 px**,
           *    sedangkan kotaknya dibatasi 108 px. Teksnya bocor keluar
           *    background tombol — itu yang bikin terlihat "gak lurus".
           * 2. **Terlalu besar.** `size="md"` adalah ukuran tombol formulir
           *    utama: tinggi, tebal, dan varian primary-nya punya
           *    `shadow-[0_8px_20px_...]` yang membuatnya tampak melayang dan
           *    lebih besar dari tetangganya. Untuk dua aksi di baris penyaring,
           *    bobot visual itu berlebihan.
           *
           * Sekarang `size="sm"` (12 px horizontal, `text-xs`) dengan tinggi
           * dikunci ke `h-[42px]` — jadi **tinggi tetap sama** dengan
           * `Input` dan pemicu `Dropdown` (lihat perhitungan di bawah), tapi
           * tampilannya proporsional dengan baris penyaring.
           *
           * ```
           * Input : text-sm → 20 px baris + py-2.5 (20 px) + border (2 px) = 42 px
           * Tombol: h-[42px]                      → 42 px
           * ```
           *
           * ⚠️ Tinggi **tidak** boleh diturunkan ke 30 px bawaan `size="sm"`
           * hanya karena ukurannya kecil — itu persis ketidakseimbangan yang
         * dikeluhkan
           * sebelumnya ("besar kecil beda ukuran"). Yang dikecilkan adalah
           * ketebalan visualnya, bukan tingginya.
           *
           * Varian: `ghost` + `secondary`, bukan `ghost` + `primary`. Keduanya
           * berborder tanpa bayangan, jadi seragam dan rata. Tombol utama dengan
           * gradien + bayangan besar di baris penyaring akan terlihat seperti
           * menimpa baris itu, bukan bagian dari dalamnya.
           *
           * Lebar: `grid grid-cols-2` + `block`, **bukan** lebar tetap. Tinggi
           * kedua tombol sudah dijamin sama oleh grid, dan lebar mengikuti isi
           * — jadi tidak mungkin ada teks yang keluar kotak.
           */}
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              variant="ghost"
              size="sm"
              block
              onClick={() => void muat()}
              loading={loading}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              className="h-[42px]"
            >
              Muat
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              block
              onClick={() => setDialog({ akun: null })}
              icon={<Plus className="w-3.5 h-3.5" />}
              className="h-[42px]"
            >
              Akun Baru
            </ActionButton>
          </div>
        </div>

        {/*
         * Ringkasan filter di baris sendiri, dengan tinggi yang selalu ada.
         *
         * Semula blok ini hanya dirender saat `adaFilter`, jadi baris ikut
         * melompat dan tombol terdorong saat filter pertama kali aktif. Baris
         * kosong yang tetap ada membuat sudut pandang tidak berubah.
         */}
        <div className="mt-2.5 flex items-center justify-between gap-2 min-h-[26px]">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {adaFilter ? (
              <>
                {tersaring.length} dari {baris.length} akun
                {cari.trim() ? ` untuk "${cari.trim()}"` : ''}
              </>
            ) : (
              <span className="text-slate-400 dark:text-slate-500">
                Menampilkan seluruh {baris.length} akun
              </span>
            )}
          </p>
          {adaFilter && (
            <button
              type="button"
              onClick={bersihkanFilter}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors shrink-0"
            >
              <X className="w-3 h-3" />
              Reset filter
            </button>
          )}
        </div>

        {/*
         * Status kredensial **tidak diketahui** — bukan "belum diatur".
         *
         * Tanpa banner ini, kegagalan baca tampak sama persis dengan akun yang
         * memang belum punya kredensial: setiap kolom NIP·IMEI kosong, dan
         * "Kredensial belum diatur" muncul di setiap baris. Yang berbeda hanya penyebabnya — dan itu yang membuat orang mengisi ulang berkali-kali.
         */}
        {galatKredensial && (
          <Alert tone="rose">
            <strong>Status kredensial server tidak terbaca.</strong> {galatKredensial} — kolom
            &ldquo;NIP &middot; IMEI&rdquo; di bawah menampilkan kosong karena statusnya tidak
            diketahui, <strong>bukan</strong> karena kredensialnya belum diatur. Periksa
            deploy server dulu sebelum mengisi ulang.
          </Alert>
        )}

        <div className="mt-4">
          {tersaring.length === 0 ? (
            <EmptyState
              message={cari ? 'Tidak ada akun yang cocok' : 'Belum ada akun'}
              hint={
                cari
                  ? `Tidak ada akun yang cocok dengan "${cari}".`
                  : 'Buat akun pertama lewat tombol "Akun Baru".'
              }
            />
          ) : (
            <>
              <DataTable
                columns={kolom}
                rows={terlihat}
                keyOf={row => row.akun.username}
                emptyMessage="Tidak ada akun."
              />

              {/*
                Paginasi.
                *
                * `DataTable` merender semua baris yang diberi. Tanpa paginasi,
                * 500 akun jadi 500 elemen `<tr>` sekaligus — lambat di HP dan
                * tabelnya jadi sulit digulir. 25 baris per halaman cukup untuk
                * pemindaian visual, dan pencarian membuat baris yang dicari
                * selalu ditemukan tanpa menggulir.
                */}
              {totalHalaman > 1 && (
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    Menampilkan {halamanAman * UKURAN_HALAMAN + 1}–
                    {Math.min((halamanAman + 1) * UKURAN_HALAMAN, tersaring.length)} dari{' '}
                    {tersaring.length} akun
                  </p>
                  <div className="flex items-center gap-1.5">
                    <ActionButton
                      variant="ghost"
                      size="sm"
                      disabled={halamanAman === 0}
                      onClick={() => setHalaman(h => Math.max(0, h - 1))}
                    >
                      Sebelumnya
                    </ActionButton>
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 px-1">
                      {halamanAman + 1} / {totalHalaman}
                    </span>
                    <ActionButton
                      variant="ghost"
                      size="sm"
                      disabled={halamanAman >= totalHalaman - 1}
                      onClick={() => setHalaman(h => Math.min(totalHalaman - 1, h + 1))}
                    >
                      Berikutnya
                    </ActionButton>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {dialog && (
        <DialogAkun
          akun={dialog.akun}
          onClose={() => setDialog(null)}
          onSelesai={async pesan => {
            setDialog(null);
            toast.success(pesan);
            await muat();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(konfirmasiHapus)}
        title={`Hapus akun ${konfirmasiHapus?.username}?`}
        message={
          <>
            Akun, langganan, dan seluruh riwayat pembayarannya dihapus permanen. Tindakan ini tidak
            bisa dibatalkan.
          </>
        }
        confirmLabel="Ya, Hapus Akun"
        tone="danger"
        onConfirm={() => {
          const target = konfirmasiHapus;
          setKonfirmasiHapus(null);
          if (target) void hapusAkun(target);
        }}
        onCancel={() => setKonfirmasiHapus(null)}
      />
    </div>
  );

  async function hapusAkun(target: UserAccount) {
    try {
      await deleteUserAccount(target.username);
      toast.success(`Akun ${target.username} dihapus.`);
      await muat();
    } catch (err: any) {
      toast.error(err?.message ?? 'Gagal menghapus akun.');
    }
  }
}

/** Tombol ikon kecil di kolom aksi. */
function AksiIkon({
  icon: Icon,
  label,
  onClick,
  tone = 'slate',
}: {
  icon: typeof UserCog;
  label: string;
  onClick: () => void;
  tone?: 'slate' | 'rose';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-1.5 rounded-lg transition-colors ${
        tone === 'rose'
          ? 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40'
          : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 dark:hover:text-blue-400'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Dialog: buat / ubah akun
// ═══════════════════════════════════════════════════════════════════════

function DialogAkun({
  akun,
  onClose,
  onSelesai,
}: {
  akun: UserAccount | null;
  onClose: () => void;
  onSelesai: (pesan: string) => Promise<void>;
}) {
  const toast = useToast();
  const baru = akun === null;
  const [nama, setNama] = useState(akun?.namaLengkap ?? '');
  const [username, setUsername] = useState(akun?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(akun?.role ?? 'user');
  const [catatan, setCatatan] = useState(akun?.catatan ?? '');
  const [nonaktif, setNonaktif] = useState(Boolean(akun?.nonaktif));
  const [izin, setIzin] = useState<TabPermissions>(
    akun?.permissions ?? DEFAULT_USER_PERMISSIONS
  );

  /*
   * Kredensial server pusat — NIP, password, IMEI.
   *
   * Semula tiga hal ini hanya bisa diisi **pengguna itu sendiri**, lewat
   * `KredensialServerModal` yang hanya bisa dibuka dari Beranda miliknya.
   * Admin tidak punya jalan mengaturnya untuk orang lain, padahal inilah
   * tugasnya: menyiapkan akun orang lain agar langsung bisa masuk setelah diberi.
   *
   * Server sudah sejak awal mengizinkan admin (`cekPemilik()` menerima admin
   * untuk username mana pun) — yang tidak ada hanya antarmukanya. Sekarang
   * ketiganya diisi di dialog yang sama dengan nama, peran, dan izin.
   *
   * Password **tidak pernah** dikirim ke peramban. Yang dikirim ke server hanya
   * NIP, IMEI, dan password; server yang mengenkripsi dengan kunci turunan
   * `PANEL_SESSION_SECRET` yang tidak pernah masuk bundle.
   */
  const [nipServer, setNipServer] = useState(akun?.nip ?? '');
  const [passwordServer, setPasswordServer] = useState('');
  const [imei, setImei] = useState('');
  /** Ringkasan kredensial yang sudah tersimpan; `null` = belum pernah diisi. */
  const [tersimpan, setTersimpan] = useState<RingkasanKredensial | null>(null);
  const [memuatKredensial, setMemuatKredensial] = useState(false);

  // Muat NIP / IMEI yang tersimpan supaya admin tidak mengetiknya ulang dari
  // nol. Password memang tidak bisa dibaca — itu disengaja, dan tampilannya
  // mengatakannya.
  useEffect(() => {
    if (!akun) {
      setTersimpan(null);
      return;
    }
    let hidup = true;
    setMemuatKredensial(true);
    void ringkasanKredensial(akun.username)
      .then(hasil => {
        if (!hidup) return;
        setTersimpan(hasil);
        // Isi hanya kalau field masih kosong. Admin mungkin sudah mengetik
        // NIP sendiri sebelum pembacaan selesai — menimpanya akan menghapus
        // ketikan itu tanpa sebab.
        setNipServer(sekarang => sekarang || (hasil?.nip ?? akun.nip ?? ''));
        setImei(sekarang => sekarang || hasil?.imei || '');
      })
      .catch(() => {
        // Akun tanpa dokumen kredensial mengembalikan `null`, bukan error.
        // Kalau benar-benar gagal, form tetap bisa diisi manual — jadi
        // kegagalan baca tidak boleh memblokir admin.
        if (hidup) setTersimpan(null);
      })
      .finally(() => {
        if (hidup) setMemuatKredensial(false);
      });
    return () => {
      hidup = false;
    };
  }, [akun]);
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  /*
   * Ganti peran → set izin ke default peran itu.
   *
   * Tanpa ini, menandai user jadi admin lalu mem-tabsrng-admin hanya mengubah
   * satu bit: `peran`. Izinnya tetap berisi nilai `role: 'user'` yang lama,
   * jadi kalau role-nya nanti dikembalikan, akun itu kembali dengan izin yang
   * sudah disunting sebagian — bukan izin yang bersih.
   *
   * Admin memakai `DEFAULT_ADMIN_PERMISSIONS` (dan `setCurrentUser` juga
   * demikian), jadi menyalinnya di sini tidak mengubah perilaku, hanya
   * membuat yang terlihat di layar sama dengan yang benar-benar berlaku.
   */
  const gantiPeran = (berikut: UserRole) => {
    setRole(berikut);
    setIzin(
      berikut === 'admin'
        ? { ...DEFAULT_ADMIN_PERMISSIONS }
        : { ...DEFAULT_USER_PERMISSIONS }
    );
  };

  /**
   * Simpan kredensial server pusat — **hanya kalau ada yang diisi**.
   *
   * Admin sering ikut mengubah hal lain (nama, peran, catatan) tanpa menyentuh
   * bagian kredensial. Mengirim request kosong setiap kali itu akan menimpa
   * `nip` yang sudah tersimpan dengan string kosong. Dan karena `password` kosong
   * berarti "jangan diubah passwordnya", dokumennya berubah tanpa disengaja:
   * akun yang tadinya siap auto-login mendadak kehilangan NIP-nya.
   *
   * Jadi: tidak ada isian baru → tidak ada request. Password terisi → NIP dan
   * IMEI ikut dikirim, karena NIP wajib ada untuk dokumen yang bisa dipakai
   * auto-login.
   */
  const simpanKredensialServerJikaDiisi = async (target: string) => {
    const sandi = passwordServer.trim();
    const nips = nipServer.trim();
    if (!sandi && !nips && !imei.trim()) return;
    if (!nips) {
      throw new Error('NIP wajib diisi sebelum kredensial server disimpan.');
    }
    await saveServerCredential(target, nips, sandi, imei.trim());
    setPasswordServer('');
    setTersimpan(prev => (prev ? { ...prev, nip: nips, imei: imei.trim() } : prev));
  };

  const simpan = async () => {
    setMenyimpan(true);
    setGalat(null);
    try {
      if (baru) {
        if (password.length < 6) throw new Error('Password minimal 6 karakter.');
        await createUserAccount({
          username: username.trim(),
          password,
          role,
          permissions: izin,
          namaLengkap: nama.trim(),
          // NIP yang sama juga dikirim ke dokumen kredensial di bawah, jadi
          // tidak ada dua isian NIP yang bisa berbeda.
          nip: nipServer.trim(),
          catatan: catatan.trim(),
        });
        /*
         * Kredensial server disimpan setelah akunnya dibuat, bukan sekaligus.
         *
         * `saveServerCredential` butuh dokumen akun untuk menempelkan
         * kredensialnya, jadi urutannya tidak bisa dibalik. Dan `username`
         * di sini sudah dis-normalisasi server, jadi yang dikirim adalah
         * bentuk yang sama persis dengan yang jadi kunci dokumen kredensial.
         */
        await simpanKredensialServerJikaDiisi(username.trim());
        await onSelesai(`Akun ${username.trim()} dibuat.`);
      } else {
        await updateUserAccount(akun.username, {
          ...(password ? { password } : {}),
          role,
          permissions: izin,
          namaLengkap: nama.trim(),
          nip: nipServer.trim(),
          catatan: catatan.trim(),
          nonaktif,
        });
        await simpanKredensialServerJikaDiisi(akun.username);
        await onSelesai(`Akun ${akun.username} diperbarui.`);
      }
    } catch (err: any) {
      const pesan = err?.message ?? 'Gagal menyimpan akun.';
      setGalat(pesan);
      toast.error(pesan);
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={baru ? 'Buat Akun Baru' : `Ubah Akun — ${akun.username}`}
      icon={baru ? <Plus className="w-5 h-5 text-blue-500" /> : <UserCog className="w-5 h-5 text-blue-500" />}
      size="md"
      footer={
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={onClose}
            className="sm:flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void simpan()}
            disabled={menyimpan}
            className="sm:flex-[2] py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {menyimpan ? 'Menyimpan…' : baru ? 'Buat Akun' : 'Simpan Perubahan'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {galat && <Alert tone="rose">{galat}</Alert>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nama Lengkap" required>
            <Input value={nama} onChange={e => setNama(e.target.value)} placeholder="Budi Santoso, S.Kom." />
          </Field>
          <Field
            label="Username"
            required
            hint={baru ? 'Dipakai untuk login panel. Tidak bisa diubah nanti.' : 'Tidak bisa diubah'}
          >
            <Input
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={!baru}
              className={!baru ? 'opacity-60' : ''}
              placeholder="budi.santoso"
            />
          </Field>
          <Field
            label={baru ? 'Password' : 'Password Baru'}
            required={baru}
            hint={baru ? 'Minimal 6 karakter.' : 'Kosongkan kalau tidak ingin mengubahnya.'}
          >
            <PasswordField
              value={password}
              onChange={setPassword}
              placeholder={baru ? '••••••' : 'Tidak diubah'}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Peran">
            <Dropdown
              value={role}
              onChange={v => gantiPeran(v as UserRole)}
              opsi={[
                { value: 'user', label: 'User' },
                { value: 'admin', label: 'Admin' },
              ]}
              aria-label="Peran akun"
            />
          </Field>
          {!baru && (
            <Field label="Status Akun">
              <div className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <Checkbox
                  checked={nonaktif}
                  onChange={setNonaktif}
                  tone="rose"
                  label="Nonaktifkan (tidak bisa login)"
                />
              </div>
            </Field>
          )}
        </div>

        <Field label="Catatan Admin" hint="Hanya terlihat oleh admin.">
          <Textarea
            value={catatan}
            onChange={e => setCatatan(e.target.value)}
            rows={3}
            placeholder="Catatan internal, mis. sedang cuti."
          />
        </Field>

        {/*
         * Kredensial server pusat.
         *
         * Dulu tiga isian ini hanya bisa diisi pemiliknya sendiri, lewat
         * `KredensialServerModal` yang hanya muncul di Beranda miliknya. Admin
         * tidak punya jalan mengaturnya untuk akun orang lain — padahal
         *SoundsExactly-lah tugasnya: menyiapkan akun agar orangnya langsung bisa
         * masuk begitu diberi.
         *
         * Server sudah mengizinkan admin sejak awal (`cekPemilik()` menerima
         * admin untuk username mana pun). Yang hilang cuma antarmukanya.
         */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-slate-50/70 dark:bg-slate-900/30 p-3.5 space-y-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Login Server Pusat
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {tersimpan?.terbaca ? (
                <>
                  Kredensial tersimpan dan bisa dipakai auto-login. Isi ulang password hanya perlu
                  kalau password server berubah.
                </>
              ) : tersimpan ? (
                <>
                  Dokumen kredensial versi lama — <strong>{tersimpan.pesan}</strong>
                </>
              ) : (
                <>
                  Setelah ketiga isian ini disimpan, akun ini <strong>otomatis tersambung ke server
                  pusat</strong> setiap kali aplikasinya dibuka. Tidak perlu login manual.
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="NIP" hint="Dipakai sebagai email saat login server.">
              <Input
                value={nipServer}
                onChange={e => setNipServer(e.target.value)}
                placeholder="18 digit NIP"
                inputMode="numeric"
                className="font-mono"
                disabled={memuatKredensial}
              />
            </Field>
            <Field label="IMEI / androidId" hint="Kosongkan kalau tidak terkunci ke satu perangkat.">
              <Input
                value={imei}
                onChange={e => setImei(e.target.value)}
                placeholder="UUID perangkat"
                className="font-mono"
                disabled={memuatKredensial}
              />
            </Field>
          </div>

          <Field
            label="Password Server"
            hint={
              tersimpan?.terbaca
                ? 'Kosongkan kalau tidak ingin mengubahnya — NIP dan IMEI tetap bisa diubah terpisah.'
                : 'Wajib diisi untuk kredensial baru. Disimpan terenkripsi di server, tidak pernah bisa dibaca kembali.'
            }
          >
            <PasswordField
              value={passwordServer}
              onChange={setPasswordServer}
              placeholder={tersimpan?.terbaca ? '•••••••• (tidak diubah)' : 'Password server pusat'}
              autoComplete="new-password"
            />
          </Field>

          {tersimpan?.terbaca && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await hapusServerCredential(akun!.username);
                  setTersimpan(null);
                  setNipServer('');
                  setImei('');
                  setPasswordServer('');
                  toast.success('Kredensial server dihapus. Akun ini tidak lagi bisa auto-login.');
                } catch (err: any) {
                  toast.error(err?.message ?? 'Gagal menghapus kredensial server.');
                }
              }}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Hapus kredensial server
            </button>
          )}
        </div>

        <div className="pt-1">
          <IzinAkun nilai={izin} role={role} onUbah={setIzin} />
        </div>

        {role === 'admin' && (
          <Alert tone="amber">
            Akun admin <strong>tidak pernah dikunci</strong> oleh langganan dan tidak punya masa aktif.
            Pastikan hanya orang yang benar-benar perlu yang diberi peran ini.
          </Alert>
        )}
      </div>
    </Modal>
  );
}
