import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Landmark,
  LoaderCircle,
  Pencil,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/ui/Toast';
import { StatusMidtrans } from '../components/StatusMidtrans';
const KartuQrisPreview = lazy(() => import('../components/KartuQris'));
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  Input,
  NumberField,
  Skeleton,
  SkeletonList,
  SkeletonTable,
  Textarea,
  type Column,
} from '../components/ui/Surface';
import Dropdown from '../components/ui/Dropdown';
import { AksiMenu } from '../components/ui/AksiMenu';
import DatePicker from '../components/ui/DatePicker';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import {
  BILLING_DEFAULT,
  formatRuang,
  formatRupiah,
  paketById,
  DAFTAR_BANK,
  deskripsiDurasi,
  infoBank,
  LABEL_SATUAN,
  normalisasiNomorWa,
  paketEfektif,
  validasiKodeBank,
  TEMPLATE_WA_DEFAULT,
  BATAS_PESAN_WA,
  formatRuang as formatRuangWa,
  type DokumenTagihan,
  type MetodePembayaran,
  type PaketLangganan,
  type SatuanDurasi,
  type PengaturanBilling,
  type RekeningBank,
  type RingkasanLangganan,
} from '../lib/langganan';
import {
  loadPengaturanBilling,
  loadSemuaTagihan,
  loadTagihanAkunAdmin,
} from '../lib/langgananFirestore';
/*
 * ⚠️ Operasi tulis langganan datang dari `akunFirestore`, bukan
 * `langgananFirestore`.
 *
 * Bukan soal penataan berkas: `langgananFirestore` sekarang **hanya membaca**,
 * karena koleksi yang dibaca modul itu semuanya `write: if false` untuk klien.
 * Penulisannya lewat server (`POST /api/panel-auth`), jadi pemanggilnya hidup
 * di modul yang sama dengan operasi akun lainnya.
 *
 * Nama-namanya sama persis dengan yang lama, jadi baris pemanggil di bawah
 * tidak ikut berubah — yang berubah adalah ke mana request-nya pergi.
 */
import {
  hapusTagihan,
  hapusSemuaTagihan,
  savePengaturanBilling,
  setStatusTagihan,
} from '../lib/akunFirestore';
import { ringkasQRIS, validateQRIS } from '../lib/qris';
import { getTodayWIB, getTodayWIBWithDaysOffset } from '../lib/dateFormatter';
import { formatTanggalLokal } from '../lib/tanggal';

/** Label metode pembayaran untuk ditampilkan. */
const METODE_LABEL: Record<MetodePembayaran, string> = {
  qris: 'QRIS',
  qris_midtrans: 'QRIS (Midtrans)',
  transfer: 'Transfer Bank',
};

const METODE_ICON: Record<MetodePembayaran, typeof QrCode> = {
  qris: QrCode,
  qris_midtrans: Smartphone,
  transfer: Landmark,
};

const CACHE_ADMIN_MS = 30_000;

interface CacheLanggananAdmin {
  username: string;
  cachedAt: number;
  tagihan: DokumenTagihan[];
  pengaturan: PengaturanBilling;
}

let cacheLanggananAdmin: CacheLanggananAdmin | null = null;

function cacheAdminTerbaru(username: string): CacheLanggananAdmin | null {
  if (
    !cacheLanggananAdmin ||
    cacheLanggananAdmin.username !== username ||
    Date.now() - cacheLanggananAdmin.cachedAt >= CACHE_ADMIN_MS
  ) {
    return null;
  }
  return cacheLanggananAdmin;
}

function invalidasiCacheAdmin(): void {
  cacheLanggananAdmin = null;
}

export type LanggananSection = 'pembayaran' | 'metode';

export default function Langganan({ section }: { section: LanggananSection }) {
  const { currentUser, cekingSesi } = useAppContext();
  const toast = useToast();

  /*
   * Gerbang admin.
   *
   * Halaman ini dirender sebagai bagian Manajemen Akun. Pemeriksaan di sini
   * tetap menjaga akses admin apabila komponen digunakan secara terpisah.
   *
   * `cekingSesi` ikut diperiksa karena selama token belum diverifikasi
   * `currentUser` bernilai `null` — dan `null?.role !== 'admin'` memang sudah
   * menolak. Tidak eksplisitkan, tapi `cekingSesi` membuat maksudnya terbaca dan
   * menutup jalan kalau nanti ada penyederhanaan kondisi di kemudian hari.
   *
   * `role` di sini berasal dari server (hasil verifikasi token), bukan dari
   * dokumen Firestore yang bisa ditulis klien.
   */
  if (cekingSesi || currentUser?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
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

  return <LanggananInner toast={toast} section={section} username={currentUser.username} />;
}

/** Isi halaman — dipisah supaya aturan admin dievaluasi sekali di awal render. */
function LanggananInner({
  toast,
  section,
  username,
}: {
  toast: ReturnType<typeof useToast>;
  section: LanggananSection;
  username: string;
}) {
  const cacheAwal = cacheAdminTerbaru(username);
  const [loading, setLoading] = useState(() => cacheAwal === null);
  /** Muat ulang diam-diam setelah data pertama sampai — lihat `muat()`. */
  const [menyegarkan, setMenyegarkan] = useState(false);
  const sudahPernahMuat = useRef(cacheAwal !== null);
  const [tagihan, setTagihan] = useState<DokumenTagihan[]>(() => cacheAwal?.tagihan ?? []);
  const [pengaturan, setPengaturan] = useState<PengaturanBilling>(
    () => cacheAwal?.pengaturan ?? BILLING_DEFAULT
  );
  const muatanRef = useRef<Promise<void> | null>(null);

  // ── Dialog ────────────────────────────────────────────────────────
  const [dialogRekening, setDialogRekening] = useState<RekeningBank | null>(null);
  const [konfirmasiHapus, setKonfirmasiHapus] = useState<string | null>(null);
  const [konfirmasiHapusSemua, setKonfirmasiHapusSemua] = useState(false);
  const [menghapusSemua, setMenghapusSemua] = useState(false);
  const [menghapusTagihanId, setMenghapusTagihanId] = useState<string | null>(null);

  // ── Muat data ─────────────────────────────────────────────────────
  /**
   * Muat ulang data.
   *
   * ## Kenapa `loading` hanya untuk pemuatan pertama
   *
   * Versi lama selalu `setLoading(true)`, dan `loading`=swap seluruh
   * tabel dengan loader. Setiap aksi di tab "Semua Pembayaran" —
   * tandai lunas, batalkan, hapus — memanggil fungsi ini, jadi setiap klik
   * membuat tabel **dibongkar dan dirakit ulang**. Akibatnya yang dirasakan
   * admin:
   *
   * - posisi scroll kembali ke atas, jadi baris yang tadi diklik tidak ada
   *   lagi di layar;
   * - dialog tempat tombol itu berada ikut tertutup;
   * - di HP halaman terlihat "reload" setiap kali satu tagihan diubah.
   *
   * Perbaikan: blok "memuat" hanya untuk pemuatan pertama. Setelah itu, data
   * diperbarui di tempat dan tabel tetap di DOM — tidak ada yang bergeser.
   * `menyegarkan` tetap memberi tanda bahwa ada yang sedang jalan.
   */
  const muat = useCallback(async (paksa = false) => {
    const cache = cacheAdminTerbaru(username);
    if (!paksa && cache) {
      setTagihan(cache.tagihan);
      setPengaturan(cache.pengaturan);
      sudahPernahMuat.current = true;
      setLoading(false);
      return;
    }
    if (muatanRef.current) return muatanRef.current;
    if (!sudahPernahMuat.current) setLoading(true);
    else setMenyegarkan(true);
    const muatan = (async () => {
      try {
      const [semuaTagihan, setting] = await Promise.all([
        loadSemuaTagihan(),
        loadPengaturanBilling(),
      ]);
      setTagihan(semuaTagihan);
      setPengaturan(setting);
      cacheLanggananAdmin = { username, cachedAt: Date.now(), tagihan: semuaTagihan, pengaturan: setting };
      } catch (err: any) {
        toast.error(err?.message ?? 'Gagal memuat data langganan.');
      } finally {
        sudahPernahMuat.current = true;
        setLoading(false);
        setMenyegarkan(false);
      }
    })();
    muatanRef.current = muatan;
    try {
      await muatan;
    } finally {
      if (muatanRef.current === muatan) muatanRef.current = null;
    }
  }, [toast, username]);

  useEffect(() => {
    void muat();
  }, [muat]);

  useEffect(() => {
    const segarkanJikaPerlu = () => {
      if (document.visibilityState !== 'visible') return;
      if (!cacheAdminTerbaru(username)) void muat();
    };
    window.addEventListener('focus', segarkanJikaPerlu);
    document.addEventListener('visibilitychange', segarkanJikaPerlu);
    return () => {
      window.removeEventListener('focus', segarkanJikaPerlu);
      document.removeEventListener('visibilitychange', segarkanJikaPerlu);
    };
  }, [muat, username]);

  const paket = useMemo(() => paketEfektif(pengaturan), [pengaturan]);

  /*
   * Aksi tagihan diperbarui **di tempat**, bukan dengan `muat()`.
   *
   * `muat()` membaca ulang seluruh koleksi tagihan untuk mengubah satu baris.
   *  Itu mahal, dan — yang lebih penting — membuat tabel yang sedang dibaca
   * admin ikut berubah isinya: baris yang tadi diklik tiba-tiba hilang atau
   * berpindah tempat, jadi mata admin kehilangan targetnya di detik
   * terakhir. Memperbarui satu baris di state menjaga tabel diam.
   *
  * Statistik dihitung dari state `tagihan` yang sama, jadi perubahan lokal
  * sudah memperbarui tabel dan angkanya. Tidak perlu membaca ulang seluruh
  * koleksi hanya untuk mengonfirmasi perubahan yang baru saja berhasil.
   */
  const aksiHapusTagihan = async (orderId: string) => {
    setMenghapusTagihanId(orderId);
    try {
      await hapusTagihan(orderId);
      invalidasiCacheAdmin();
      setTagihan(prev => prev.filter(item => item.orderId !== orderId));
      setKonfirmasiHapus(null);
      toast.success('Tagihan dihapus.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Gagal menghapus tagihan.');
    } finally {
      setMenghapusTagihanId(null);
    }
  };

  const aksiHapusSemuaTagihan = async () => {
    setMenghapusSemua(true);
    try {
      const jumlah = await hapusSemuaTagihan();
      invalidasiCacheAdmin();
      setTagihan([]);
      setKonfirmasiHapusSemua(false);
      toast.success(jumlah > 0 ? `${jumlah} tagihan dihapus.` : 'Tidak ada tagihan untuk dihapus.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Gagal menghapus seluruh riwayat pembayaran.');
    } finally {
      setMenghapusSemua(false);
    }
  };

  const aksiSetStatusTagihan = async (orderId: string, status: 'lunas' | 'batal') => {
    try {
      await setStatusTagihan(orderId, status);
      invalidasiCacheAdmin();
      setTagihan(prev =>
        prev.map(item => (item.orderId === orderId ? { ...item, status } : item))
      );
      toast.success(status === 'lunas' ? 'Tagihan ditandai lunas.' : 'Tagihan dibatalkan.');
    } catch (err: any) {
      toast.error(err?.message ?? 'Gagal mengubah status tagihan.');
    }
  };

  const kolomTagihan: Column<DokumenTagihan>[] = [
    {
      key: 'order',
      header: 'Order',
      // Sama seperti kolom "Akun" di atas: `orderId` + label pengguna perlu
      // plafon, kalau tidak satu order yang panjang menentukan lebar tabel.
      className: 'max-w-[240px]',
      render: item => (
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-slate-700 dark:text-slate-200 truncate">
            {item.orderId}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
            {item.usernameLabel || item.username}
          </p>
        </div>
      ),
    },
    {
      key: 'paket',
      header: 'Paket',
      className: 'w-[130px]',
      render: item => (
        <span className="text-xs">
          {paketById(paket, item.paketId)?.label ?? item.paketId}
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {item.durasi && item.satuan
              ? ` · ${deskripsiDurasi(item.durasi, item.satuan)}`
              : item.durasiHari
                ? ` · ${item.durasiHari} hari`
                : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'metode',
      header: 'Metode',
      className: 'w-[150px]',
      render: item => {
        const Icon = METODE_ICON[item.metode] ?? QrCode;
        return (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <Icon className="w-3.5 h-3.5 text-slate-400" />
            {METODE_LABEL[item.metode]}
          </span>
        );
      },
    },
    {
      key: 'nominal',
      header: 'Nominal',
      className: 'w-[110px]',
      render: item => <span className="text-xs font-mono">{formatRupiah(item.nominal)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-[110px]',
      render: item => (
        <Badge tone={item.status === 'lunas' ? 'emerald' : item.status === 'batal' ? 'slate' : 'amber'}>
          {item.status === 'lunas' ? 'Lunas' : item.status === 'batal' ? 'Batal' : 'Menunggu'}
        </Badge>
      ),
    },
    {
      key: 'waktu',
      header: 'Waktu',
      className: 'w-[150px]',
      render: item => (
        <span className="text-[11px] font-mono whitespace-nowrap text-slate-500 dark:text-slate-400">
          {formatTanggalLokal(item.waktuBayar || item.createdAt)}
        </span>
      ),
    },
    {
      key: 'aksi',
      header: '',
      className: 'w-[56px]',
      render: item => (
        <AksiMenu
          ariaLabel={`Aksi tagihan ${item.orderId}`}
          items={
            item.status === 'menunggu'
              ? [
                  {
                    id: 'lunas',
                    label: 'Tandai lunas',
                    icon: CheckCircle2,
                    onClick: () => void aksiSetStatusTagihan(item.orderId, 'lunas'),
                  },
                  {
                    id: 'batal',
                    label: 'Batalkan tagihan',
                    icon: XCircle,
                    onClick: () => void aksiSetStatusTagihan(item.orderId, 'batal'),
                    pemisah: true,
                  },
                ]
              : [
                  {
                    id: 'hapus',
                    label: 'Hapus tagihan',
                    icon: Trash2,
                    onClick: () => setKonfirmasiHapus(item.orderId),
                    tone: 'danger' as const,
                  },
                ]
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {loading ? (
        section === 'pembayaran' ? (
          <div role="status" aria-label="Memuat riwayat pembayaran">
            <Card padded={false} className="p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-40" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-24 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            </div>
            <SkeletonTable columns={kolomTagihan.length} rows={6} />
            </Card>
          </div>
        ) : (
          <div className="space-y-5" role="status" aria-label="Memuat metode pembayaran">
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
              <div className="space-y-2.5">
                {[0, 1, 2].map(item => <Skeleton key={item} className="h-14 w-full rounded-xl" />)}
              </div>
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-700/60">
                <Skeleton className="h-5 w-56 rounded-lg" />
                <Skeleton className="h-4 w-64 max-w-full rounded-lg" />
                <Skeleton className="h-4 w-48 rounded-lg" />
              </div>
            </Card>
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="mb-3 h-3 w-3/4" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                <div className="space-y-3">
                  <Skeleton className="h-36 w-full rounded-xl" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
                <Skeleton className="mx-auto aspect-[440/580] w-40 rounded-2xl" />
              </div>
            </Card>
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="mb-2 h-3 w-32" />
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="mt-4 mb-2 h-3 w-28" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </Card>
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-8 w-28 rounded-lg" />
              </div>
              {[0, 1].map(item => (
                <div key={item} className="mb-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[0, 1, 2, 3].map(field => (
                      <div key={field} className="space-y-2">
                        <Skeleton className="h-3 w-1/3" />
                        <Skeleton className="h-10 w-full rounded-xl" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
            <div className="flex justify-end">
              <Skeleton className="h-10 w-44 rounded-xl" />
            </div>
          </div>
        )
      ) : section === 'pembayaran' ? (
        <Card padded={false} className="p-4 sm:p-5">
          <CardTitle
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <ActionButton
                  size="sm"
                  variant="ghost"
                  onClick={() => void muat(true)}
                  loading={menyegarkan || loading}
                  icon={<RefreshCw className="h-4 w-4" />}
                  aria-label="Muat ulang riwayat pembayaran"
                  title="Muat ulang"
                >
                  <span className="hidden sm:inline">Muat Ulang</span>
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="danger"
                  disabled={tagihan.length === 0 || menghapusSemua}
                  onClick={() => setKonfirmasiHapusSemua(true)}
                  icon={<Trash2 className="h-4 w-4" />}
                  aria-label="Hapus semua pembayaran"
                  title="Hapus semua"
                >
                  <span className="hidden sm:inline">Hapus Semua</span>
                </ActionButton>
              </div>
            }
          >
            Riwayat Pembayaran Akun
          </CardTitle>
          {tagihan.length === 0 ? (
            <EmptyState message="Belum ada tagihan." hint="Tagihan dibuat otomatis saat pengguna memilih paket." />
          ) : (
            <DataTable columns={kolomTagihan} rows={tagihan} keyOf={item => item.orderId} />
          )}
        </Card>
      ) : (
        <PengaturanPaket
          pengaturan={pengaturan}
          onMuatUlang={() => void muat(true)}
          menyegarkan={menyegarkan || loading}
          onSimpan={async nilai => {
            await savePengaturanBilling(nilai);
            invalidasiCacheAdmin();
            setPengaturan(nilai);
            toast.success('Pengaturan pembayaran disimpan.');
          }}
          onEditRekening={rek => setDialogRekening(rek)}
        />
      )}

      <RekeningModal
        rekening={dialogRekening}
        onClose={() => setDialogRekening(null)}
        onSimpan={async nilai => {
          const adaRekening = [...pengaturan.rekening];
          const index = adaRekening.findIndex(item => item.id === nilai.id);
          if (index >= 0) adaRekening[index] = nilai;
          else adaRekening.push(nilai);
          const baru = { ...pengaturan, rekening: adaRekening };
          await savePengaturanBilling(baru);
          invalidasiCacheAdmin();
          setPengaturan(baru);
          setDialogRekening(null);
          toast.success('Rekening disimpan.');
        }}
      />
      <ConfirmDialog
        open={Boolean(konfirmasiHapus)}
        title="Hapus Tagihan?"
        message={`Tagihan ${konfirmasiHapus} akan dihapus permanen. Riwayat pembayaran yang sudah tercatat di akun pengguna tidak ikut terhapus.`}
        confirmLabel="Ya, Hapus"
        tone="danger"
        loading={menghapusTagihanId === konfirmasiHapus}
        onConfirm={() => void aksiHapusTagihan(konfirmasiHapus ?? '')}
        onCancel={() => setKonfirmasiHapus(null)}
      />
      <ConfirmDialog
        open={konfirmasiHapusSemua}
        title="Hapus Semua Riwayat Pembayaran?"
        message="Seluruh tagihan akan dihapus permanen, termasuk yang sudah lunas. Masa aktif akun yang sudah diberikan tidak berubah."
        confirmLabel="Ya, Hapus Semua"
        tone="danger"
        loading={menghapusSemua}
        onConfirm={() => void aksiHapusSemuaTagihan()}
        onCancel={() => setKonfirmasiHapusSemua(false)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Komponen kecil
// ═══════════════════════════════════════════════════════════════════════

/** Tombol ikon tabel — dipakai untuk setiap aksi baris. */
function AksiIcon({
  icon: Icon,
  label,
  onClick,
  tone = 'slate',
  className = '',
}: {
  icon: typeof QrCode;
  label: string;
  onClick: () => void;
  tone?: 'emerald' | 'rose' | 'violet' | 'slate';
  /**
   * Kelas tambahan, khusus untuk penyesuaian tinggi.
   *
   * Ada karena `h-9 w-9` (36 px) tidak sama dengan tinggi `Input` (40 px).
   * Di dalam tabel selisih 4 px tidak terasa, tapi di baris form yang
   * disejajarkan dengan `items-end` justru terlihat meleset. Jadi pemanggil
   * boleh menimpanya dengan `h-10 w-10` saat butuh sejajar dengan field.
   */
  className?: string;
}) {
  /*
   * Warna dipisah jadi `teks` (warna ikon) dan `latar` (warna saat hover),
   * karena sekarang tombolnya punya bidang sungguhan — bukan lagi area
   * 28 px yang hanya kelihatan saat kursor menyentuhnya.
   */
  const warna = {
    emerald: { teks: 'text-emerald-500', latar: 'hover:bg-emerald-50 dark:hover:bg-emerald-950/40' },
    rose: { teks: 'text-rose-500', latar: 'hover:bg-rose-50 dark:hover:bg-rose-950/40' },
    violet: { teks: 'text-violet-500', latar: 'hover:bg-violet-50 dark:hover:bg-violet-950/40' },
    slate: { teks: 'text-slate-500', latar: 'hover:bg-slate-100 dark:hover:bg-slate-700' },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      /*
       * `h-9` + `w-9` memberi area sentuh 36 px, bukan 28 px seperti
       * `p-1.5` di sekeliling ikon 14 px. Di layar sentuh perbedaan itu
       * menentukan tombol dianggap atau tidak, dan `disabled:opacity-40`
       * disimpan supaya state mati tetap terbaca.
       */
      className={`h-9 w-9 inline-flex items-center justify-center rounded-xl border border-transparent
        transition-colors shrink-0 disabled:opacity-40 ${warna.teks} ${warna.latar} ${className}
        hover:border-current/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1
        focus-visible:ring-current dark:focus-visible:ring-offset-slate-900`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Pengaturan paket (tab Metode & Paket)
// ═══════════════════════════════════════════════════════════════════════

function PengaturanPaket({
  pengaturan,
  onSimpan,
  onEditRekening,
  onMuatUlang,
  menyegarkan,
}: {
  pengaturan: PengaturanBilling;
  onSimpan: (nilai: PengaturanBilling) => Promise<void>;
  onEditRekening: (rek: RekeningBank) => void;
  onMuatUlang: () => void;
  menyegarkan: boolean;
}) {
  return (
    <div className="space-y-6">
      <PengaturanBillingForm
        nilai={pengaturan}
        onSimpan={onSimpan}
        onEditRekening={onEditRekening}
        onMuatUlang={onMuatUlang}
        menyegarkan={menyegarkan}
      />
    </div>
  );
}

/**
 * Form pengaturan pembayaran.
 *
 * Form di dalam tab "Metode & Paket"; penyimpanan tetap ditangani pemilik tab
 * melalui `onSimpan`.
 */
function PengaturanBillingForm({
  nilai,
  onSimpan,
  onEditRekening,
  onMuatUlang,
  menyegarkan,
}: {
  nilai: PengaturanBilling;
  onSimpan: (nilai: PengaturanBilling) => Promise<void>;
  onEditRekening: (rek: RekeningBank) => void;
  onMuatUlang: () => void;
  menyegarkan: boolean;
}) {
  const [draft, setDraft] = useState<PengaturanBilling>(nilai);
  const [menyimpan, setMenyimpan] = useState(false);
  const [qrisError, setQrisError] = useState<string[]>([]);

  // Sinkronkan kalau nilai dari luar berubah (mis. setelah muat ulang).
  useEffect(() => {
    setDraft(nilai);
  }, [nilai]);

  const cekQris = (teks: string) => {
    setDraft(prev => ({ ...prev, qrisStatis: teks }));
    setQrisError(teks.trim() ? validateQRIS(teks).errors : []);
  };

  // Nomor WA divalidasi langsung saat admin mengetik — bukan hanya saat
  // disimpan — supaya kesalahan format kelihatan sebelum menekan Simpan.
  const waHasil = useMemo(() => normalisasiNomorWa(draft.nomorWa), [draft.nomorWa]);
  const waValid = waHasil.ok;
  const waPesan = waHasil.pesan ?? '';

  const ringkasanQris = useMemo(() => {
    if (!draft.qrisStatis.trim()) return null;
    const hasil = validateQRIS(draft.qrisStatis);
    if (!hasil.valid) return null;
    return ringkasQRIS(draft.qrisStatis);
  }, [draft.qrisStatis]);

  const ubahPaket = (id: string, patch: Partial<PaketLangganan>) => {
    setDraft(prev => ({
      ...prev,
      paket: prev.paket.map(item => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  const tambahPaket = () => {
    setDraft(prev => ({
      ...prev,
      paket: [
        ...prev.paket,
        {
          id: `paket-${Date.now()}`,
          label: 'Paket Baru',
          harga: 25_000,
          durasi: 1,
          satuan: 'bulan' as const,
          keterangan: '',
        },
      ],
    }));
  };

  const hapusPaket = (id: string) => {
    setDraft(prev => ({ ...prev, paket: prev.paket.filter(item => item.id !== id) }));
  };

  const simpan = async () => {
    // QRIS hanya divalidasi kalau diisi — QRIS opsional.
    if (draft.qrisStatis.trim()) {
      const hasil = validateQRIS(draft.qrisStatis);
      if (!hasil.valid) {
        setQrisError(hasil.errors);
        return;
      }
    }
    setMenyimpan(true);
    try {
      await onSimpan({
        ...draft,
        // Nomor disimpan dalam bentuk ternormalkan (`62…`), bukan apa yang
        // diketik — supaya semua bentuk yang sama berakhir di URL yang sama.
        nomorWa: normalisasiNomorWa(draft.nomorWa).nomor,
        // Rekening & paket dinormalkan: id kosong diganti, urutan dibersihkan.
        rekening: draft.rekening.map((rek, index) => ({
          ...rek,
          id: rek.id || `rek-${index}-${Date.now()}`,
          urutan: index,
        })),
      });
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Metode yang diizinkan */}
      <Card>
        <CardTitle
          action={
            <ActionButton
              size="sm"
              variant="ghost"
              onClick={onMuatUlang}
              loading={menyegarkan}
              icon={<RefreshCw className="h-4 w-4" />}
              aria-label="Muat ulang metode pembayaran"
              title="Muat ulang"
            >
              <span className="hidden sm:inline">Muat Ulang</span>
            </ActionButton>
          }
        >
          Metode Pembayaran
        </CardTitle>
        <div className="space-y-2.5">
          {([
            { value: 'qris', label: 'QRIS Manual', hint: 'QRIS statis dari bank, dibuat dinamis per tagihan' },
            { value: 'qris_midtrans', label: 'QRIS via Midtrans', hint: 'QRIS dinamis dari payment gateway' },
            { value: 'transfer', label: 'Transfer Bank', hint: 'Virtual account atau rekening manual' },
          ] as const).map(item => {
            const aktif = draft.metodeAktif.includes(item.value);
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setDraft(prev => {
                  const metodeAktif = aktif
                    ? prev.metodeAktif.filter(m => m !== item.value)
                    : [...prev.metodeAktif, item.value];
                  return {
                    ...prev,
                    metodeAktif,
                    ...(item.value === 'qris_midtrans' ? { midtransAktif: !aktif } : {}),
                  };
                })}
                className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
                  aktif
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <span
                  className={`mt-0.5 w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${
                    aktif ? 'border-blue-500 bg-blue-500' : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {aktif && <CheckCircle2 className="w-3 h-3 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                    {item.label}
                  </span>
                  <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {item.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-2.5 pt-4 border-t border-slate-100 dark:border-slate-700/60">
          <Checkbox
            checked={draft.midtransAktif}
            onChange={midtransAktif => setDraft(prev => ({
              ...prev,
              midtransAktif,
              metodeAktif: midtransAktif
                ? prev.metodeAktif.includes('qris_midtrans')
                  ? prev.metodeAktif
                  : [...prev.metodeAktif, 'qris_midtrans']
                : prev.metodeAktif.filter(metode => metode !== 'qris_midtrans'),
            }))}
            label="Aktifkan QRIS via Midtrans"
          />

          {/*
           * Status Midtrans yang SEBENARNYA.
           *
           * Toggle di atas hanya menulis `midtransAktif` ke Firestore.
           * Itu **satu dari tiga** syarat; Midtrans tetap tidak muncul
           * kalau dua sisanya belum terpenuhi. Sebelumnya layar ini hanya
           * menulis "kalau key belum diisi, metode ini disembunyikan" —
           * kalimat pasif yang membuat admin menebak-nebak, lalu toggle terlihat seperti tidak berfungsi saat sebenarnya memang
           * tidak.
           *
           * Sekarang ketiga syaratnya dicek dan ditampilkan apa adanya:
           * apa yang sudah siap, apa yang belum, dan harus diisi di mana.
           */}
          <StatusMidtrans
            aktif={draft.midtransAktif}
            className="ml-6.5 mt-2"
          />

          <Checkbox
            checked={draft.izinkanGratis}
            onChange={izinkanGratis => setDraft(prev => ({ ...prev, izinkanGratis }))}
            label="Izinkan admin menandai akun sebagai gratis (exempt)"
          />
        </div>
      </Card>

      {/* QRIS manual */}
      {draft.metodeAktif.includes('qris') && (
        <Card>
          <CardTitle action={<Badge tone={qrisError.length ? 'rose' : ringkasanQris ? 'emerald' : 'slate'}>
            {!draft.qrisStatis.trim() ? 'Belum diisi' : qrisError.length ? 'Tidak valid' : 'Valid'}
          </Badge>}>
            QRIS Manual
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Tempel string QRIS statis dari aplikasi bank. Nominal akan ditambahkan otomatis per tagihan.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:items-stretch sm:grid-cols-[minmax(0,1fr)_160px]">
            <div className="flex min-w-0 flex-col gap-3">
              <Textarea
                value={draft.qrisStatis}
                onChange={event => cekQris(event.target.value)}
                rows={6}
                placeholder="Tempel string QRIS dari aplikasi bank"
                className="font-mono text-xs"
              />
              {ringkasanQris && (
                <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="font-semibold text-slate-700 dark:text-slate-200">
                    {ringkasanQris.namaPenerbit || 'QRIS valid'} · {ringkasanQris.kotaMerchant}
                  </p>
                  <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                    {ringkasanQris.metode === 'dinamis' ? 'QRIS dinamis' : 'QRIS statis'} ·{' '}
                    {ringkasanQris.nominal ? `nominal ${ringkasanQris.nominal}` : 'nominal saat transaksi'}
                  </p>
                </div>
              )}
            </div>
            {ringkasanQris && (
              <div className="flex justify-center sm:justify-end">
                <Suspense
                  fallback={
                    <div className="flex aspect-[440/580] w-40 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                      <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  }
                >
                  <KartuQrisPreview
                    qrisString={draft.qrisStatis.trim()}
                    lebar={160}
                    keteranganFooter="QRIS Statis · nominal saat transaksi"
                  />
                </Suspense>
              </div>
            )}
          </div>
          {qrisError.length > 0 && (
            <ul className="mt-2 space-y-1">
              {qrisError.map((err, i) => (
                <li key={i} className="text-[11px] text-rose-500 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  {err}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Konfirmasi WhatsApp */}
      <Card>
        <CardTitle
          action={
            <Badge tone={waValid ? 'emerald' : draft.nomorWa.trim() ? 'rose' : 'slate'}>
              {waValid ? 'Aktif' : draft.nomorWa.trim() ? 'Nomor tidak valid' : 'Belum diisi'}
            </Badge>
          }
        >
          Konfirmasi WhatsApp
        </CardTitle>
        <div>
          <Field
            label="Nomor WhatsApp"
            hint={
              waValid
                ? `Akan disimpan sebagai +${waHasil.nomor}`
                : waPesan || 'Format bebas: 0812…, 812…, +62 812…'
            }
          >
            <Input
              value={draft.nomorWa}
              onChange={event => setDraft(prev => ({ ...prev, nomorWa: event.target.value }))}
              placeholder="0812-3456-7890"
              className="font-mono"
              inputMode="numeric"
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Template Pesan">
            <Textarea
              value={draft.templateWa}
              onChange={event => setDraft(prev => ({ ...prev, templateWa: event.target.value }))}
              rows={9}
              placeholder={TEMPLATE_WA_DEFAULT}
              className="font-mono text-xs"
            />
          </Field>
          {draft.templateWa.length > BATAS_PESAN_WA && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">
              Template lebih dari {formatRuangWa(BATAS_PESAN_WA)} karakter — sisanya akan dipotong saat
              dikirim.
            </p>
          )}
          <button
            type="button"
            onClick={() => setDraft(prev => ({ ...prev, templateWa: TEMPLATE_WA_DEFAULT }))}
            className="mt-2 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Kembalikan ke template bawaan
          </button>
        </div>

      </Card>

      {/* Rekening bank */}
      {draft.metodeAktif.includes('transfer') && (
        <Card>
          <CardTitle
            action={
              <ActionButton
                size="sm"
                variant="ghost"
                onClick={() =>
                  onEditRekening({
                    id: `rek-${Date.now()}`,
                    kodeBank: 'bri',
                    nomorRekening: '',
                    atasNama: '',
                    catatan: '',
                    urutan: draft.rekening.length,
                    aktif: true,
                  })
                }
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                Tambah
              </ActionButton>
            }
          >
            Rekening Transfer
          </CardTitle>
          {draft.rekening.filter(r => r.aktif).length === 0 ? (
            <EmptyState message="Belum ada rekening aktif." hint="Tambahkan minimal satu rekening supaya transfer bank bisa dipilih." />
          ) : (
            <div className="space-y-2">
              {draft.rekening.map(rek => (
                <div
                  key={rek.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {infoBank(rek.kodeBank) && (
                        <span
                          className="w-6 h-6 rounded-md flex items-center justify-center overflow-hidden shrink-0"
                          style={{ backgroundColor: infoBank(rek.kodeBank)!.warna }}
                        >
                          <img
                            src={infoBank(rek.kodeBank)!.ikon}
                            alt=""
                            className="w-full h-full object-contain p-0.5 bg-white"
                          />
                        </span>
                      )}
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        {infoBank(rek.kodeBank)?.nama ?? 'Bank tidak dikenal'}
                      </p>
                    </div>
                    <p className="text-sm font-mono text-slate-600 dark:text-slate-300 mt-0.5">
                      {rek.nomorRekening || '—'}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">a.n. {rek.atasNama || '—'}</p>
                  </div>
                  <AksiIcon icon={Pencil} label="Ubah" onClick={() => onEditRekening(rek)} />
                  <AksiIcon
                    icon={Trash2}
                    label="Hapus"
                    tone="rose"
                    onClick={() =>
                      setDraft(prev => ({ ...prev, rekening: prev.rekening.filter(r => r.id !== rek.id) }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Paket langganan */}
      <Card>
        <CardTitle
          action={
            <ActionButton size="sm" variant="ghost" onClick={tambahPaket} icon={<Plus className="w-3.5 h-3.5" />}>
              Tambah Paket
            </ActionButton>
          }
        >
          Paket Langganan
        </CardTitle>
        <div className="space-y-3">
          {draft.paket.map(item => (
            <div
              key={item.id}
              className="p-2 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30"
            >
              {/*
               * Tata letak tiga tahap, dan hanya yang terakhir yang 12 kolom.
               *
               * ⚠️ Versi sebelumnya `sm:grid-cols-12` — 12 kolom sejak 640 px.
               * Setelah `gap-2.5` dan padding kartu, satu kolom hanya dapat
               * ±34 px, jadi field Harga dapat ±70 px. Field itu punya prefix
               * "Rp" dan format ribuan ("Rp 1.500.000"), jadi angkanya
               * **terpotong** — persis yang dilaporkan: nominalnya tidak
               * terlihat.
               *
               * "12 kolom" terdengar seperti presisi, padahal efeknya
               * sebaliknya di lebar mana pun yang bukan monitor besar.
               *
               * Yang dipakai sekarang:
               *
               * | Lebar        | Kolom | Susunan                                      |
               * |--------------|-------|----------------------------------------------|
               * | < 640 px     |   6   | Nama (2) + Harga (4); Durasi/Satuan/Hapus   |
               * | 640–1279 px  |   2   | Nama penuh, lalu pasangan field               |
               * | ≥ 1280 px    |  12   | Nama/Harga/Durasi/Satuan/Hapus (4/3/2/2/1)   |
               *
               * Porsi lebar di layar monitor diberikan ke **Harga**, bukan ke
               * Nama atau Satuan. Alasannya isi kolom: `Nama Paket` berupa teks
               * pendek yang bisa mentok, `Satuan` cuma "Bulan"/"Tahun", dan
               * `Durasi` satu atau dua digit — tapi `Harga` harus memuat "Rp"
               * plus angka beribu-ribu, dan itu satu-satunya field yang benar-
               * benar tidak muat kalau dikecilkan.
               *
               * ## Kenapa TIDAK ADA `hint` di field mana pun
               *
               * `Field` merender `label → input → hint`. Jadi field ber-hint
               * punya tinggi **lebih besar** daripada yang tidak punya — dan
               * dengan `items-end`, yang sejajar adalah **bawah** wrapper, bukan
               * input-nya.
               *
               * Akibatnya dua field yang punya hint ("Harga" dan "Satuan")
               * terlihat melayang, dan tombol Hapus — yang tidak punya `Field`
               * sama sekali — mendarat di garis paling bawah, yaitu sejajar
               * dengan **teks hint**, bukan dengan input. Persis "kolomnya tidak
               * lurus" yang dilaporkan.
               *
               * Kedua hint itu memang tidak menambah informasi:
               *
               * - "Ribuan terlihat jelas." — input sudah punya prefix "Rp" dan
               *   angka beribu-ribu yang dititik. Petunjuknya sudah di tempatnya.
               * - `deskripsiDurasi(...)` — mengulang baris ringkasan tepat di
               *   bawah blok ini ("Dipakai pengguna sebagai Rp 100.000 per
               *   1 bulan").
               *
               * Sekarang keempat field sama tinggi, jadi `items-end`
               * menjajikannya benar-benar. Penjelasan dipindah ke satu tempat:
               * baris ringkasan.
               */}
              <div className="grid grid-cols-6 gap-2 items-end sm:grid-cols-2 sm:gap-2.5 xl:grid-cols-12">
                <div className="col-span-2 sm:col-span-2 xl:col-span-4">
                  <Field label="Nama Paket">
                    <Input
                      value={item.label}
                      onChange={event => ubahPaket(item.id, { label: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="col-span-4 min-w-0 sm:col-span-1 xl:col-span-3">
                  <Field label="Harga">
                    <NumberField
                      min={1}
                      step={5000}
                      value={item.harga}
                      onChange={harga => ubahPaket(item.id, { harga })}
                      aria-label={`Harga paket ${item.label}`}
                      prefix="Rp"
                      format={formatRuang}
                      hideSteppersBelowSm
                    />
                  </Field>
                </div>
                <div className="col-span-2 min-w-0 sm:col-span-1 xl:col-span-2">
                  <Field label="Durasi">
                    <NumberField
                      min={1}
                      max={120}
                      value={item.durasi}
                      onChange={durasi => ubahPaket(item.id, { durasi })}
                      aria-label={`Durasi paket ${item.label}`}
                    />
                  </Field>
                </div>
                <div className="col-span-3 min-w-0 sm:col-span-1 xl:col-span-2">
                  <Field label="Satuan">
                    <Dropdown
                      value={item.satuan}
                      onChange={(value: string) => ubahPaket(item.id, { satuan: value as SatuanDurasi })}
                      opsi={(['bulan', 'tahun', 'hari'] as const).map(satuan => ({
                        value: satuan,
                        label: LABEL_SATUAN[satuan],
                      }))}
                      aria-label="Satuan durasi"
                    />
                  </Field>
                </div>
                {/* Area hapus mengisi sel sempit di mobile; di layar lebar ikon
                  kembali berukuran tetap dan sejajar dengan field. */}
                <div className="col-span-1 flex justify-end sm:col-span-1">
                  <AksiIcon
                    icon={Trash2}
                    label={`Hapus paket ${item.label}`}
                    tone="rose"
                    className="h-10 w-full min-w-0 sm:w-10"
                    onClick={() => hapusPaket(item.id)}
                  />
                </div>
              </div>

              {/* Ringkasan yang dibaca orang, bukan yang diketik. */}
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                Dipakai pengguna sebagai{' '}
                <strong className="font-semibold text-slate-700 dark:text-slate-200">
                  {formatRupiah(item.harga)}
                </strong>{' '}
                per {deskripsiDurasi(item.durasi, item.satuan)}
              </p>
            </div>
          ))}
        </div>
        {paketEfektif(draft).length === 0 && (
          <Alert tone="amber">
            Tidak ada paket yang valid. Tambahkan minimal satu paket dengan harga dan durasi lebih dari nol —
            tanpa itu pengguna tidak punya apa pun untuk dibeli.
          </Alert>
        )}
      </Card>

      <div className="flex justify-center sm:justify-end">
        <ActionButton onClick={() => void simpan()} loading={menyimpan} icon={<BadgeCheck className="w-4 h-4" />}>
          Simpan Pengaturan
        </ActionButton>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Dialog: rekening
// ═══════════════════════════════════════════════════════════════════════

function RekeningModal({
  rekening,
  onClose,
  onSimpan,
}: {
  rekening: RekeningBank | null;
  onClose: () => void;
  onSimpan: (nilai: RekeningBank) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RekeningBank | null>(rekening);
  const [menyimpan, setMenyimpan] = useState(false);

  useEffect(() => {
    setDraft(rekening);
  }, [rekening]);

  if (!draft) return null;

  const simpan = async () => {
    if (!draft.nomorRekening.trim() || !draft.atasNama.trim()) return;
    if (validasiKodeBank(draft.kodeBank)) return;
    setMenyimpan(true);
    try {
      await onSimpan({ ...draft, aktif: true });
    } finally {
      setMenyimpan(false);
    }
  };

  return (
    <Modal
      open={Boolean(rekening)}
      onClose={onClose}
      title={rekening?.nomorRekening ? 'Ubah Rekening' : 'Tambah Rekening'}
      icon={<Landmark className="w-5 h-5 text-blue-500" />}
      size="sm"
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
            className="sm:flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {menyimpan ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <p className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 ml-1">
            Bank Tujuan
          </p>
          {/*
           * ⚠️ Responsive, bukan `grid-cols-5` tetap.
           *
           * Setiap sel punya lebar minimum yang tidak bisa dikecilkan: ikon
           * 32 px + `p-2` (16 px) + `border-2` (4 px) = 52 px, dan grid item
           * punya `min-width: auto` sehingga menolak menyusut di bawah itu.
           * Lima kolom berarti 5 × 52 + 4 × 8 = 292 px.
           *
           * Modal di HP 360 px lebarnya `min(100%, 100vw - 2rem)` = 328 px, dan
           * dikurangi `px-5` isinya cuma 288 px — jadi grid meluber ±4 px, dan
           * di HP 320 px jadi ±44 px. Tombol bank terakhir keluar dari modal.
           *
           * Dua kolom di layar sempit memberi tiap sel ~140 px, jauh di atas
           * kebutuhannya. Di `sm` ke atas modal sudah 384 px, jadi lima kolom
           * kembali muat dengan lega.
           */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {DAFTAR_BANK.map(item => {
              const dipilih = draft.kodeBank === item.kode;
              return (
                <button
                  key={item.kode}
                  type="button"
                  onClick={() => setDraft({ ...draft, kodeBank: item.kode })}
                  aria-pressed={dipilih}
                  title={item.nama}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-colors ${
                    dipilih
                      ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden"
                    style={{ backgroundColor: item.warna }}
                  >
                    <img src={item.ikon} alt={item.nama} className="w-full h-full object-contain p-1 bg-white" />
                  </span>
                  <span className="text-[9px] font-bold text-slate-600 dark:text-slate-300 leading-none text-center break-words">
                    {item.nama}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
            Hanya lima bank ini yang didukung — ikonnya dipakai di layar pembayaran pengguna.
          </p>
        </div>
        <Field label="Nomor Rekening">
          <Input
            value={draft.nomorRekening}
            onChange={event => setDraft({ ...draft, nomorRekening: event.target.value })}
            placeholder="1234567890"
            className="font-mono"
          />
        </Field>
        <Field label="Atas Nama">
          <Input
            value={draft.atasNama}
            onChange={event => setDraft({ ...draft, atasNama: event.target.value })}
            placeholder="PT Contoh"
          />
        </Field>
        <Field label="Catatan" hint="Contoh: Biaya admin Rp 2.500">
          <Input
            value={draft.catatan ?? ''}
            onChange={event => setDraft({ ...draft, catatan: event.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Dialog: perpanjang manual
// ═══════════════════════════════════════════════════════════════════════

export function PerpanjangModal({
  ringkasan,
  onClose,
  onPilih,
}: {
  ringkasan: RingkasanLangganan | null;
  onClose: () => void;
  onPilih: (durasi: number, satuan: SatuanDurasi) => void;
}) {
  const opsi: { durasi: number; satuan: SatuanDurasi; label: string }[] = [
    { durasi: 7, satuan: 'hari', label: '1 Minggu' },
    { durasi: 1, satuan: 'bulan', label: '1 Bulan' },
  ];

  return (
    <Modal
      open={Boolean(ringkasan)}
      onClose={onClose}
      title="Perpanjang Masa Aktif"
      icon={<Clock className="w-5 h-5 text-blue-500" />}
      size="sm"
    >
      {ringkasan && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Perpanjangan untuk <strong className="text-slate-700 dark:text-slate-200">{ringkasan.username}</strong>.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {opsi.map(item => (
              <button
                key={`${item.satuan}-${item.durasi}`}
                type="button"
                onClick={() => onPilih(item.durasi, item.satuan)}
                className="px-3 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-left hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors"
              >
                <span className="block text-sm font-bold text-slate-700 dark:text-slate-200">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Tidak mengubah riwayat pembayaran.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Dialog: setel masa aktif
// ═══════════════════════════════════════════════════════════════════════

export function SetMasaModal({
  ringkasan,
  onClose,
  onSimpan,
}: {
  ringkasan: RingkasanLangganan | null;
  onClose: () => void;
  onSimpan: (iso: string) => void;
}) {
  const [tanggal, setTanggal] = useState('');

  useEffect(() => {
    if (ringkasan?.masaAkhir) setTanggal(ringkasan.masaAkhir.slice(0, 10));
    else if (ringkasan) setTanggal(getTodayWIB());
  }, [ringkasan]);

  if (!ringkasan) return null;

  return (
    <Modal
      open={Boolean(ringkasan)}
      onClose={onClose}
      title="Setel Tanggal Masa Aktif"
      icon={<Clock className="w-5 h-5 text-blue-500" />}
      size="sm"
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
            onClick={() => onSimpan(new Date(`${tanggal}T23:59:59+07:00`).toISOString())}
            disabled={!tanggal}
            className="sm:flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            Simpan
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/*
         * `DatePicker`, bukan `<input type="date">`.
         *
         * Kolom tanggal native punya dua masalah yang tidak bisa diabaikan di
         * dialog ini. Pertama, format dan tombolnya beda per OS, jadi
         * "tampilan" dialog admin tidak sama sekali antara Android dan iPhone.
         * Kedua, dan lebih serius: nilainya dikembalikan sebagai
         * `YYYY-MM-DD` dalam **lokalitas perangkat**, sementara semua batas
         * langganan lain dihitung di WIB. Di perangkat yang jamnya tidak WIB,
         * tanggal yang sama akan tampil berbeda sehari.
         *
         * `DatePicker` sudah menampilkan kalender dan mengembalikan
         * `YYYY-MM-DD` lewat `getTodayWIB()`, jadi sumbernya satu: WIB.
         */}
        <Field
          label="Tanggal Berakhir"
          hint="Setel 23:59:59 WIB — akun baru terkunci setelah waktu ini lewat."
        >
          <DatePicker value={tanggal} onChange={setTanggal} aria-label="Tanggal berakhir" />
        </Field>
        {/*
         * `getTodayWIBWithDaysOffset`, bukan `new Date()` + `toISOString()`.
         *
         * `toISOString()` menghasilkan waktu **UTC**. Di WIB, `new Date()`
         * jam 07:00 atau lebih awal masih "hari kemarin" dalam UTC — jadi
         * "+30 Hari" yang diklik pukul 08:00 bisa menghasilkan tanggal satu
         * hari lebih cepat dari yang tertulis di tombolnya. Tombolnya sendiri
         * sudah terlihat benar, jadi yang melesetnya tidak akan ketahuan.
         */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTanggal(getTodayWIBWithDaysOffset(30))}
            className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            +30 Hari
          </button>
          <button
            type="button"
            onClick={() => setTanggal(getTodayWIBWithDaysOffset(-1))}
            className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Kemarin
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Dialog: riwayat pembayaran satu akun
// ═══════════════════════════════════════════════════════════════════════

export function RiwayatModal({
  ringkasan,
  onClose,
}: {
  ringkasan: RingkasanLangganan | null;
  onClose: () => void;
}) {
  const [tagihan, setTagihan] = useState<DokumenTagihan[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ringkasan) {
      setTagihan([]);
      return;
    }
    let hidup = true;
    setLoading(true);
    void loadTagihanAkunAdmin(ringkasan.username, 30)
      .then(data => {
        if (hidup) setTagihan(data);
      })
      .finally(() => {
        if (hidup) setLoading(false);
      });
    return () => {
      hidup = false;
    };
  }, [ringkasan]);

  return (
    <Modal
      open={Boolean(ringkasan)}
      onClose={onClose}
      title={`Riwayat — ${ringkasan?.username ?? ''}`}
      icon={<Receipt className="w-5 h-5 text-blue-500" />}
      size="lg"
    >
      {loading ? (
        <SkeletonList rows={4} />
      ) : tagihan.length === 0 ? (
        <EmptyState message="Belum ada pembayaran." hint="Riwayat akan muncul setelah ada pembayaran tercatat." />
      ) : (
        <div className="space-y-2">
          {tagihan.map(item => (
            <div
              key={item.orderId}
              className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30"
            >
              <div className="min-w-0">
                <p className="font-mono text-[11px] text-slate-700 dark:text-slate-200 truncate">
                  {item.orderId}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {METODE_LABEL[item.metode]} · {formatTanggalLokal(item.waktuBayar || item.createdAt)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-mono font-bold text-slate-700 dark:text-slate-200">
                  {formatRupiah(item.nominal)}
                </p>
                <Badge
                  tone={item.status === 'lunas' ? 'emerald' : item.status === 'batal' ? 'slate' : 'amber'}
                >
                  {item.status === 'lunas' ? 'Lunas' : item.status === 'batal' ? 'Batal' : 'Menunggu'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
