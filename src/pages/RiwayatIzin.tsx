import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarRange, Download, FileText, History, RefreshCw, Trash2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { selCsv } from '../lib/excelXml';
import type { SelExcel } from '../lib/excelXml';
import { unduhTeks } from '../lib/unduh';
import { useToast } from '../components/ui/Toast';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  LoadingBlock,
  PageHeader,
  StatTile,
  type Column,
} from '../components/ui/Surface';
import DatePicker from '../components/ui/DatePicker';
import { rpcDeleteIjin, rpcListIjin, type IjinView } from '../lib/apiCalls';
import { formatCompactDateTime, getTodayWIB, getTodayWIBWithDaysOffset } from '../lib/dateFormatter';

/** `list_ijin` hanya menerima page + limit — rentang tanggal disaring lokal. */
const LIST_PAGE_LIMIT = 200;

type StatusFilter = 'all' | 'pending' | 'approved' | 'ditolak';

/**
 * Filter status izin.
 *
 * `list_ijin` mengirim `status` (int) selain `approval` (boolean), dan
 * aplikasi v89 membacanya — 1 disetujui, 2 menunggu, 3 ditolak. Jadi
 * status "Ditolak" sekarang bisa ditampilkan. `toIjinView` sudah
 * menormalkan ke bentuk ini, dengan `approval` sebagai cadangan bila
 * `status` tidak dikirim server.
 */
const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'pending', label: 'Menunggu' },
  { value: 'approved', label: 'Disetujui' },
  { value: 'ditolak', label: 'Ditolak' },
];

/**
 * Record izin yang mulai (atau berakhir) di dalam rentang [start, end].
 *
 * `list_ijin` tidak menerima filter tanggal, jadi rentang disaring di
 * klien. Tanggal sudah dinormalkan ke ISO oleh `toIjinView`.
 */
function inRange(row: IjinView, start: string, end: string): boolean {
  const from = row.tglDari ?? '';
  const to = row.tglSampai ?? from;
  if (!from && !to) return false;
  // Beririsan bila mulai <= end DAN selesai >= start.
  return (from || '0000-00-00') <= end && (to || from || '0000-00-00') >= start;
}

/** Header CSV Riwayat Izin, juga dipakai sebagai kepala lembar Excel. */
const HEADER_IJIN = [
  'ID', 'Nama', 'NIP', 'Jenis', 'Tipe', 'Mulai', 'Selesai',
  'Alasan', 'Berkas', 'Diajukan', 'Status', 'Catatan',
] as const;

/** Baris dibuat satu kali, lalu dipakai CSV maupun Excel. */
function isiIjin(rows: IjinView[]): SelExcel[][] {
  return rows.map(row => [
    row.id,
    row.nama,
    row.nip,
    row.jenisIjinNama,
    row.tipeIjinText,
    row.tglDari ?? '',
    row.tglSampai ?? '',
    // Huruf baru disisipkan sebagai spasi: satu baris tambahan di dalam sel
    // membuat baris berikutnya ikut terpotong di Excel.
    (row.alasan ?? '').replace(/[\r\n]+/g, ' '),
    namaBerkas(row.berkas),
    row.createdAt,
    row.status,
    (row.catatan ?? '').replace(/[\r\n]+/g, ' '),
  ]);
}

function barisIjinCsv(rows: IjinView[]): string {
  return [
    HEADER_IJIN.map(h => selCsv(h)).join(','),
    ...isiIjin(rows).map(r => r.map(selCsv).join(',')),
  ].join('\n');
}

export default function RiwayatIzin() {
  const { currentUser, tabPermissions, riwayatIzinState, setRiwayatIzinState } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { dateStart, dateEnd, rows, hasLoadedOnce } = riwayatIzinState;
  const [filter, setFilter] = useState<StatusFilter>('all');

  /** Nomor urut muatan; lihat penjelasan di `loadData`. */
  const muatanSeq = useRef(0);

  const loadData = useCallback(async () => {
    if (!ready) return;
    const seq = ++muatanSeq.current;
    const usang = () => seq !== muatanSeq.current;
    setLoading(true);
    setError(null);
    try {
      const all = await rpcListIjin(context, { page: 1, limit: LIST_PAGE_LIMIT });
      // Muat ulang yang lebih lama boleh selesai lebih dulu; kalau tidak
      // dicek, tabel menampilkan daftar dari permintaan lama.
      if (usang()) return;
      setRiwayatIzinState(prev => ({ ...prev, rows: all, hasLoadedOnce: true }));
    } catch (err: any) {
      if (usang()) return;
      setError(err?.message ?? 'Gagal memuat riwayat izin.');
    } finally {
      if (!usang()) setLoading(false);
    }
  }, [context, ready, setRiwayatIzinState]);

  /*
   * Muat sekali saja, saat halaman dibuka.
   *
   * ⚠️ `dateStart` / `dateEnd` **tidak** ada di dependensi. Keduanya hanya
   * dipakai penyaring lokal (lihat `inWindow` di bawah) — `list_ijin` tidak
   * punya parameter tanggal, jadi mengubah rentang tidak mengubah satu byte
   * pun dari respons. Semula dep itu ada, jadi setiap kali tanggal digeser
   * halaman menembakkan ulang seluruh daftar dari server; karena `patch()`
   * menyalakan `hasLoadedOnce` lagi, tabel ikut berkedip kosong di tengahnya
   * untuk data yang sudah ada di memori.
   */
  useEffect(() => {
    if (hasLoadedOnce) return;
    void loadData();
  }, [hasLoadedOnce, ready, loadData]);

  // Penyaring tanggal diterapkan lokal — `list_ijin` tidak punya param tanggal.
  const inWindow = rows.filter(row => inRange(row, dateStart, dateEnd));
  const filtered = inWindow.filter(row => (filter === 'all' ? true : row.status === filter));

  const stats = {
    total: inWindow.length,
    pending: inWindow.filter(row => row.status === 'pending').length,
    approved: inWindow.filter(row => row.status === 'approved').length,
    sudahDisetujui: inWindow.filter(row => row.status === 'approved' && Boolean(row.approvedAt)).length,
  };

  const removeRow = async (id: string) => {
    setDeletingId(id);
    try {
      const result = await rpcDeleteIjin(context, id);
      if (result === null) {
        toast.error('Server pusat menolak penghapusan pengajuan ini.');
        return;
      }
      toast.success('Pengajuan izin dihapus.');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message ?? 'Gagal menghapus pengajuan.');
    } finally {
      setDeletingId(null);
    }
  };

  /*
   * Ekspor CSV lewat helper yang sama dengan Laporan.
   *
   * Semula halaman ini menyalin sendiri seluruh cara mengunduh berkas:
   * `createObjectURL`, `<a download>`, `revokeObjectURL`, dan pengescap-an
   * sel yang hanya meng-escape tanda kutip. Dua salinan berarti dua tempat
   * untuk diperbaiki — dan `selCsv` di `lib/excelXml` juga menutup celah
   * injeksi rumus yang salinan lama biarkan terbuka: nama pengaju atau alasan
   * yang diawali `=` dieksekusi Excel begitu CSV dibuka.
   */
  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.info('Tidak ada data untuk diekspor.');
      return;
    }
    unduhTeks(
      `riwayat-izin-${dateStart}_${dateEnd}.csv`,
      '\ufeff' + barisIjinCsv(filtered),
      'text/csv'
    );
    toast.success(`${filtered.length} baris diekspor ke CSV.`);
  };

  const columns: Column<IjinView>[] = [
    {
      key: 'jenis',
      header: 'Jenis / Tipe',
      // `truncate` tanpa plafon `max-width` tidak memotong apa pun: di
      // `table-layout: auto` min-content sel tetap sebesar teks penuhnya.
      // Lihat catatan panjang di `DataTable`.
      className: 'max-w-[220px]',
      render: row => (
        <div className="min-w-0">
          <p className="font-semibold text-slate-700 dark:text-slate-200 truncate">
            {row.tipeIjinText || '-'}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
            {row.jenisIjinNama || '-'}
          </p>
        </div>
      ),
    },
    {
      key: 'nama',
      header: 'Pengaju',
      className: 'max-w-[220px]',
      render: row => (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{row.nama || '-'}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">{row.nip || '-'}</p>
        </div>
      ),
    },
    {
      key: 'periode',
      header: 'Periode',
      // Kolom tanggal dikecilkan dan dipatok lebarnya supaya tabel tidak
      // menyisakan ruang kosong besar di tengah — masalahnya muncul karena
      // kolom ini dulunya `w-full` (ikut melar) sementara isinya cuma
      // 23 karakter.
      className: 'w-[190px]',
      render: row => <PeriodeCell row={row} />,
    },
    {
      key: 'alasan',
      header: 'Alasan',
      render: row => (
        <div className="min-w-0">
          <p className="text-xs truncate max-w-[220px]">{row.alasan || '-'}</p>
          {row.berkas && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[220px]">
              Lampiran: {namaBerkas(row.berkas)}
            </p>
          )}
          {row.catatan && (
            <p className="text-[11px] text-rose-500 dark:text-rose-400 truncate max-w-[220px]">
              Catatan: {row.catatan}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'diajukan',
      header: 'Diajukan',
      className: 'w-[120px]',
      render: row => <span className="text-xs whitespace-nowrap">{formatCompactDateTime(row.createdAt || null)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-[132px]',
      render: row => <StatusBadge row={row} />,
    },
    {
      key: 'aksi',
      header: '',
      className: 'w-10',
      render: row =>
        row.status === 'pending' && tabPermissions.aksiAjukanIzin ? (
          <button
            type="button"
            onClick={() => void removeRow(String(row.id))}
            disabled={deletingId === String(row.id)}
            className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors disabled:opacity-40"
            aria-label="Hapus pengajuan"
            title="Hapus pengajuan"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Riwayat Izin"
        subtitle={`${currentUser?.username ?? '-'} · ${dateStart} s/d ${dateEnd}`}
        icon={<History className="w-5 h-5" />}
        action={
          <>
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => void loadData()}
              loading={loading}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              Muat Ulang
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              icon={<Download className="w-4 h-4" />}
            >
              CSV
            </ActionButton>
          </>
        }
      />

      {error && <Alert tone="rose">{error}</Alert>}

      {/* ── Penyaring ──────────────────────────────────────────────
       *
       * Susunan dua baris, bukan satu baris `justify-between` seperti
       * sebelumnya. Denyut « space-between » itu yang bikin jelek: di
       * layar lebar, kelompok tanggal menempel di kiri dan filter status
       * melayang di kanan dengan celah besar menganga di tengah. Sekarang
       * setiap kelompok punya lebar yang dikunci, jadi susunannya rapat dan
       * tetap terbaca saat melebar.
       */}
      <Card className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="grid grid-cols-2 flex-1 gap-3">
            <DatePicker
              className="w-full"
              label="Dari Tanggal"
              value={dateStart}
              onChange={value => setRiwayatIzinState(prev => ({ ...prev, dateStart: value }))}
              max={getTodayWIBWithDaysOffset(365)}
            />
            <DatePicker
              className="w-full"
              label="Sampai Tanggal"
              value={dateEnd}
              onChange={value => setRiwayatIzinState(prev => ({ ...prev, dateEnd: value }))}
              min={dateStart}
              max={getTodayWIB()}
            />
          </div>

          <ActionButton onClick={() => void loadData()} loading={loading} icon={<FileText className="w-4 h-4" />}>
            Tampilkan
          </ActionButton>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 dark:border-slate-700/60 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Status Pengajuan
          </p>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(item => {
              const jumlah = jumlahStatus(item.value, inWindow);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  aria-pressed={filter === item.value}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors border ${
                    filter === item.value
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {item.label}
                  <span
                    className={`rounded-md px-1.5 py-px text-[10px] font-mono ${
                      filter === item.value ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'
                    }`}
                  >
                    {jumlah}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ── Statistik ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Total" value={stats.total} tone="blue" icon={<CalendarRange className="w-4 h-4" />} />
        <StatTile label="Menunggu" value={stats.pending} tone="amber" />
        <StatTile label="Disetujui" value={stats.approved} tone="emerald" />
        <StatTile label="Tanggal Persetujuan" value={stats.sudahDisetujui} tone="slate" />
      </div>

      {/* ── Tabel ────────────────────────────────────────────────── */}
      <Card padded={false} className="p-5 sm:p-6">
        <CardTitle action={<Badge tone="slate">{filtered.length} baris</Badge>}>Daftar Pengajuan</CardTitle>
        {loading ? (
          <LoadingBlock />
        ) : filtered.length === 0 ? (
          <EmptyState message="Tidak ada pengajuan pada rentang ini." hint="Ubah rentang tanggal atau ajukan izin baru." />
        ) : (
          <DataTable columns={columns} rows={filtered} keyOf={(row, index) => String(row.id || index)} />
        )}
      </Card>
    </div>
  );
}

/** Jumlah baris per status, untuk angka pada tombol filter. */
function jumlahStatus(status: StatusFilter, rows: IjinView[]): number {
  if (status === 'all') return rows.length;
  return rows.filter(row => row.status === status).length;
}

/**
 * Periode izin, dua baris: tanggal mulai di atas, tanggal selesai di bawah.
 *
 * Semula satu baris `2026-09-01 → 2026-09-03` dalam `font-mono`. Masalahnya
 * bukan format angkanya, melainkan baris itu dipaksakan `whitespace-nowrap`
 * di dalam kolom yang ikut melar, sehingga panjangnya memanggil seluruh
 * tabel jadi lebar dan kolom lain ikut tergeser. Dua baris pendek membuat
 * lebar kolomnya tetap.
 *
 * Kolom ini menampilkan nilai mentah `YYYY-MM-DD`, sama seperti aslinya
 * dari server, jadi tidak ada yang perlu ditebak ulang.
 */
function PeriodeCell({ row }: { row: IjinView }) {
  const dari = row.tglDari || '-';
  const sampai = row.tglSampai || row.tglDari || '-';
  const satuHari = dari === sampai;

  return (
    <div className="min-w-0 text-[11px] leading-tight">
      <p className="font-semibold text-slate-700 dark:text-slate-200 font-mono">{dari}</p>
      <p className="text-slate-400 dark:text-slate-500 font-mono">
        {satuHari ? <span className="italic">satu hari</span> : `s/d ${sampai}`}
      </p>
    </div>
  );
}

/**
 * Status izin.
 *
 * `status` (int) dipakai kalau server mengirimnya — 1 disetujui,
 * 2 menunggu, 3 ditolak. `toIjinView` sudah menormalkannya, jadi di sini
 * tinggal membaca. `approval` (boolean) hanya dipakai sebagai cadangan
 * ketika `status` tidak dikirim server.
 */
function StatusBadge({ row }: { row: IjinView }) {
  if (row.status === 'approved') {
    return <Badge tone="emerald">{row.approvedAt ? 'Disetujui' : 'Disetujui (tanpa tanggal)'}</Badge>;
  }
  if (row.status === 'ditolak') {
    return <Badge tone="rose">Ditolak</Badge>;
  }
  return <Badge tone="amber">Menunggu</Badge>;
}

/**
 * Nama berkas dari nilai `berkas` milik server.
 *
 * Field ini diisi `POST /importfile`, jadi isinya bisa berupa path penuh
 * (mis. `uploads/ijin/174338988-image.jpg`). Yang ditampilkan ke pengguna
 * hanya nama berkasnya.
 */
function namaBerkas(value: string): string {
  const path = value.split(/[\\/]/).pop() ?? value;
  return path.length > 0 ? path : '-';
}
