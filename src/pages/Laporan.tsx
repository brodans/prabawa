import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarRange,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { selCsv, unduhExcel } from '../lib/excelXml';
import type { SelExcel } from '../lib/excelXml';
import { unduhTeks } from '../lib/unduh';
import { unduhPdf } from '../lib/pdfTabel';
import { useToast } from '../components/ui/Toast';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  SkeletonTable,
  StatTile,
  type Column,
} from '../components/ui/Surface';
import DatePicker from '../components/ui/DatePicker';
import { TombolMenu } from '../components/ui/TombolMenu';
import { rpcGetWorkCode, rpcHistoryAbsen, type HistoryAbsenModel, type WorkCodeView } from '../lib/apiCalls';
import { getTodayWIB, getTodayWIBWithDaysOffset, timeToMinutes } from '../lib/dateFormatter';
import { ABSEN_CHECK_TYPE } from '../lib/presensiContract';
import Dropdown from '../components/ui/Dropdown';
import {
  jamTampil,
  labelCheckType,
  pilihWorkCodeUntukHari,
  tanggalKeIso,
  terlambatCompared,
  type AbsensiHarianView,
} from '../lib/viewModels';

type ReportType = 'riwayat' | 'rekap';

/**
 * Server pusat hanya punya satu endpoint laporan: `history_absen`.
 * Object `laporan` dan `presensi` sama-sama dibalas `-32601 Object not
 * found`, jadi "Rekap" di sini adalah agregasi lokal dari `history_absen`.
 *
 * `history_absen` mengembalikan SATU BARIS PER PUKUL (satu baris "Datang",
 * satu baris "Pulang"), bukan satu baris per hari. Karena itu laporan
 * punya dua tampilan: "Riwayat" menampilkan baris mentah apa adanya
 * seperti aplikasi asli, "Rekap" memivotnya menjadi satu baris per
 * pegawai per tanggal.
 */
const REPORT_TYPES: { value: ReportType; label: string; rpc: string; hint: string }[] = [
  {
    value: 'riwayat',
    label: 'Riwayat Absen',
    rpc: 'history_absen',
    hint: 'Baris mentah dari server pusat: satu baris per rekaman absensi.',
  },
  {
    value: 'rekap',
    label: 'Rekap Harian',
    rpc: 'history_absen',
    hint: 'Rekap absensi per pegawai per tanggal.',
  },
];

/** Berapa baris yang ditarik per halaman `history_absen`. */
const HISTORY_PAGE_LIMIT = 200;
/** Batas hari yang dijahit per muatan — `history_absen` satu tanggal per panggilan. */
const MAX_REPORT_DAYS = 62;

export default function Laporan() {
  const { currentUser, laporanLogState, setLaporanLogState } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();

  const { dateStart, dateEnd, reportType, hasLoadedOnce } = laporanLogState;

  const [rows, setRows] = useState<HistoryAbsenModel[]>([]);
  const [workCodes, setWorkCodes] = useState<WorkCodeView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Nomor urut muatan yang sedang berjalan.
   *
   * ⚠️ Tanpa ini, dua muatan yang tumpang tindih bisa saling menimpa.
   * `dateStart`/`dateEnd` bisa diganti beberapa kali dengan cepat, dan
   * `loadData` menembakkan satu request **per hari** (sampai 62). Rentang
   * yang lebih baru belum tentu selesai lebih dulu — jaringan tidak menjamin
   * urutan — jadi muatan lama yang telat selesai akan menimpa hasilnya dan
   * tabel menampilkan data untuk rentang yang sudah tidak dipilih.
   *
   * Pola yang dipakai: setiap muatan mengambil nomor, dan hanya muatan dengan
   * nomor terbesar yang boleh menulis state. `ref` dipakai karena nomor harus
   * terbaca di dalam continuation async, bukan di deps effect.
   */
  const muatanSeq = useRef(0);

  const activeReport = useMemo(
    () => REPORT_TYPES.find(item => item.value === reportType) ?? REPORT_TYPES[0],
    [reportType]
  );

  // ── Muat data ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!ready) return;
    const seq = ++muatanSeq.current;
    const usang = () => seq !== muatanSeq.current;
    setLoading(true);
    setError(null);
    try {
      // Satu-satunya sumber data: `history_absen` per tanggal, dijahit
      // harian karena server hanya menerima satu `tgl` per panggilan.
      // Work code diambil bersamaan untuk mengetahui batas jam masuk saat rekap.
      const [codes, ...pages] = await Promise.all([
        rpcGetWorkCode(context),
        ...eachDate(dateStart, dateEnd).map(tgl =>
          rpcHistoryAbsen(context, { tgl, page: 1, limit: HISTORY_PAGE_LIMIT })
        ),
      ]);
      if (usang()) return;
      setWorkCodes(codes);
      setRows(pages.flat());
      setLaporanLogState(prev => ({ ...prev, hasLoadedOnce: true }));
    } catch (err: any) {
      if (usang()) return;
      setError(err?.message ?? 'Gagal memuat laporan.');
      setRows([]);
    } finally {
      if (!usang()) setLoading(false);
    }
  }, [context, ready, dateStart, dateEnd, setLaporanLogState]);

  /*
   * Muat saat rentang tanggal berubah, atau saat pertama kali halaman dibuka.
   *
   * ⚠️ `reportType` **tidak** ada di dependensi, dan itu disengaja. Kedua
   * jenis laporan — "Riwayat Absen" dan "Rekap Harian" — memakai RPC yang
   * sama persis (`history_absen`); rekap hanya pivot lokal dari baris yang
   * sudah ada. Memuat ulang saat jenis diganti berarti menembakkan ulang
   * seluruh 1 + jumlah hari request hanya untuk menggambar ulang tabel yang
   * datanya identik — dan karena `patch()` menyalakan `hasLoadedOnce` lagi,
   * tabel ikut berkedip kosong di tengahnya.
   */
  useEffect(() => {
    if (hasLoadedOnce) return;
    void loadData();
  }, [hasLoadedOnce, ready, dateStart, dateEnd, loadData]);

  // Semua baris dari rentang tanggal ditampilkan apa adanya. Penyaring
  // tanggal sudah berasal dari rentang yang dipilih, dan penyaring tambahan
  // tidak dimungkinkan karena `history_absen` tidak punya kolom NIP.
  const filtered = rows;

  // ── Rekap harian (pivot per pegawai per tanggal) ────────────────
  const rekap = useMemo(() => buildRekap(filtered, workCodes), [filtered, workCodes]);

  // ── Statistik ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const days = new Set<string>();
    for (const row of filtered) {
      const iso = tanggalKeIso(row.waktu);
      if (iso) days.add(iso);
    }
    const terlambat = rekap.filter(item => item.status === 'terlambat').length;
    return {
      total: filtered.length,
      hari: days.size,
      hadir: rekap.length - terlambat,
      terlambat,
      tanpaPulang: rekap.filter(item => item.jamPulang === null).length,
      rataMasuk: averageMinutes(rekap.map(item => item.jamMasuk)),
      rataKeluar: averageMinutes(rekap.map(item => item.jamPulang)),
    };
  }, [filtered, rekap]);

  const patch = (next: Partial<typeof laporanLogState>) =>
    setLaporanLogState(prev => ({ ...prev, ...next, hasLoadedOnce: false }));

  // ── Ekspor ────────────────────────────────────────────────────────
  /*
   * Satu tombol, tiga format — dan tiap format memang beda kegunaan nyata.
   *
   * Semula ada dropdown "Format Unduhan" yang menjanjikan "Excel / CSV",
   * padahal nilainya tidak pernah dibaca: tombol Ekspor selalu menghasilkan
   * CSV. Dropdown itu dihapus, dan spreadsheet sungguhan ditulis sendiri
   * (`lib/excelXml.ts`) supaya pilihan "Excel" bukan janji kosong.
   *
   * Namun ketiga format langsung jadi tiga tombol di kepala halaman, dan baris
   * aksinya jadi ±354 px — di layar 360 px yang tersedia hanya 328 px, sehingga
   * tombol terakhir keluar viewport tanpa ada yang memberi tahu.
   *
   * Sekarang format berhenti jadi tombol dan **pilihannya** yang jadi menu.
   * Format dipakai rutin, jadi namanya harus terlihat tanpa klik; yang layak
   * disembunyikan hanya daftar pilihannya.
   */
  const tanpaData = useCallback(() => {
    toast.info('Tidak ada data untuk diekspor.');
    return true;
  }, [toast]);

  /** `laporan-riwayat-2026-09-01_2026-09-30` — sama untuk tiga format. */
  const namaBerkas = `laporan-${reportType}-${dateStart}_${dateEnd}`;

  const exportExcel = () => {
    if (filtered.length === 0) return void tanpaData();
    unduhExcel(namaBerkas, [lembarRiwayat(filtered), lembarRekap(rekap)]);
    toast.success(`${filtered.length} baris diekspor ke Excel, lengkap dengan rekap harian.`);
  };

  const exportCsv = () => {
    if (filtered.length === 0) return void tanpaData();
    unduhTeks(
      `${namaBerkas}.csv`,
      '\ufeff' + (reportType === 'rekap' ? rekapCsv(rekap) : riwayatCsv(filtered)),
      'text/csv'
    );
    toast.success(`${filtered.length} baris diekspor ke CSV.`);
  };

  const [sibukPdf, setSibukPdf] = useState(false);

  const exportPdf = async () => {
    if (filtered.length === 0) return void tanpaData();
    setSibukPdf(true);
    try {
      await unduhPdf({
        nama: namaBerkas,
        judul: activeReport.label,
        subjudul: `Periode ${dateStart} sampai ${dateEnd}`,
        meta: [
          'Sumber data: presensi.bkd.jatimprov.go.id/service',
          `Akun: ${currentUser?.username ?? '-'} · ${filtered.length} baris`,
        ],
        catatan:
          reportType === 'rekap'
            ? 'Rekap harian dihitung lokal dari riwayat absensi.'
            : 'Baris ditampilkan apa adanya seperti pada aplikasi asli.',
        tabel:
          reportType === 'rekap'
            ? {
                header: [...HEADER_REKAP],
                baris: isiRekap(rekap),
                // Bobot, bukan milimeter: kolom Pegawai memang butuh ruang
                // dua kali kolom Jam Masuk, dan angka ini ikut menentukan
                // berapa karakter yang muat sebelum dipotong.
                lebar: [34, 22, 13, 11, 12, 11, 11],
                rata: ['kiri', 'kiri', 'kiri', 'tengah', 'tengah', 'kanan', 'tengah'],
              }
            : {
                header: [...HEADER_RIWAYAT],
                baris: isiRiwayat(filtered),
                lebar: [32, 22, 12, 10, 12, 13, 10],
                rata: ['kiri', 'kiri', 'kiri', 'tengah', 'tengah', 'tengah', 'kanan'],
              },
      });
      toast.success('Laporan PDF berhasil dibuat.');
    } catch (galat) {
      console.error('[laporan] gagal membuat PDF', galat);
      toast.error('PDF gagal dibuat. Coba lagi, atau pakai Excel kalau browsernya tidak mendukung.');
    } finally {
      setSibukPdf(false);
    }
  };

  const visible = reportType === 'rekap' ? rekap : filtered;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan"
        subtitle={`${activeReport.label} · ${dateStart} s/d ${dateEnd}`}
        icon={<FileText className="w-5 h-5" />}
      />

      {error && <Alert tone="rose">{error}</Alert>}

      {/* Jenis laporan dan rentang tanggal berbagi lebar yang seimbang. */}
      <Card className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Jenis Laporan">
            <Dropdown
              value={reportType}
              onChange={value => patch({ reportType: value })}
              opsi={REPORT_TYPES.map(item => ({
                value: item.value,
                label: item.label,
                hint: item.hint,
              }))}
              aria-label="Jenis laporan"
            />
          </Field>

          <DatePicker
            className="w-full"
            label="Dari Tanggal"
            value={dateStart}
            onChange={value => patch({ dateStart: value })}
            max={dateEnd}
          />
          <DatePicker
            className="w-full"
            label="Sampai Tanggal"
            value={dateEnd}
            onChange={value => patch({ dateEnd: value })}
            min={dateStart}
            max={getTodayWIBWithDaysOffset(365)}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 dark:border-slate-700/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Rentang cepat
            </span>
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => patch({ dateStart: getTodayWIBWithDaysOffset(-7), dateEnd: getTodayWIB() })}
            >
              7 Hari
            </ActionButton>
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => patch({ dateStart: getTodayWIBWithDaysOffset(-30), dateEnd: getTodayWIB() })}
            >
              30 Hari
            </ActionButton>
          </div>

          <ActionButton onClick={() => void loadData()} loading={loading} icon={<BarChart3 className="w-4 h-4" />}>
            Tampilkan Laporan
          </ActionButton>
        </div>
      </Card>

      {/* ── Statistik ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Total Baris"
          value={stats.total}
          tone="blue"
          icon={<CalendarRange className="w-4 h-4" />}
          hint={`${stats.hari} hari terliput`}
        />
        <StatTile label="Hadir" value={stats.hadir} tone="emerald" hint={formatMinutes(stats.rataMasuk)} />
        <StatTile label="Terlambat" value={stats.terlambat} tone="amber" hint={formatMinutes(stats.rataKeluar)} />
        <StatTile label="Belum Absen Pulang" value={stats.tanpaPulang} tone="rose" hint="Absen pulang belum tercatat" />
      </div>

      {/* ── Tabel laporan ────────────────────────────────────────── */}
      <Card padded={false} className="p-5 sm:p-6 print:shadow-none print:border-0">
        <CardTitle
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ActionButton
                variant="ghost"
                size="sm"
                onClick={() => void loadData()}
                loading={loading}
                icon={<RefreshCw className="w-4 h-4" />}
              >
                Muat Ulang
              </ActionButton>
              <TombolMenu
                label="Ekspor"
                icon={<Download className="w-4 h-4" />}
                variant="primary"
                disabled={visible.length === 0}
                loading={sibukPdf}
                items={[
                  {
                    id: 'excel',
                    label: 'Excel',
                    hint: '.xls · dua lembar (riwayat + rekap) · kolom Jarak bisa dijumlahkan',
                    icon: FileSpreadsheet,
                    onClick: exportExcel,
                  },
                  {
                    id: 'pdf',
                    label: 'PDF',
                    hint: '.pdf · A4 mendatar · teksnya bisa dicari, bukan gambar',
                    icon: FileDown,
                    onClick: () => void exportPdf(),
                  },
                  {
                    id: 'csv',
                    label: 'CSV',
                    hint: '.csv · untuk diimpor ke sistem lain',
                    icon: FileText,
                    onClick: exportCsv,
                  },
                ]}
              />
            </div>
          }
        >
          {activeReport.label}
        </CardTitle>
        {loading ? (
          <SkeletonTable columns={reportType === 'rekap' ? rekapColumns.length : riwayatColumns.length} rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState message="Belum ada data laporan." hint="Ubah rentang tanggal atau jenis laporan, lalu muat ulang." />
        ) : reportType === 'rekap' ? (
          <DataTable
            columns={rekapColumns}
            rows={rekap}
            keyOf={(row, index) => `${row.nama}-${row.tanggal}-${index}`}
          />
        ) : (
          <DataTable
            columns={riwayatColumns}
            rows={filtered}
            keyOf={(row, index) => `${row.nama}-${row.waktu}-${index}`}
          />
        )}

        {visible.length > 0 && (
          <p className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-400 dark:text-slate-500 print:hidden">
            Sumber data: <span className="font-mono">presensi.bkd.jatimprov.go.id/service</span> · akun{' '}
            {currentUser?.username ?? '-'}
            {reportType === 'rekap' && ' · rekap dihitung lokal'}
          </p>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Pivot baris per rekaman → satu baris per pegawai per tanggal
// ═══════════════════════════════════════════════════════════════════════

/**
 * Kelompokkan baris `history_absen` menjadi satu entri per
 * (pegawai, tanggal).
 *
 * `jam_masuk_awal` diambil dari work code yang cocok dengan tanggal
 * tersebut supaya keterlambatan bisa dihitung lokal — `history_absen`
 * tidak mengirim kolom status sama sekali.
 */
function buildRekap(rows: HistoryAbsenModel[], codes: WorkCodeView[]): AbsensiHarianView[] {
  const groups = new Map<string, HistoryAbsenModel[]>();
  for (const row of rows) {
    const iso = tanggalKeIso(row.waktu);
    if (!iso) continue;
    const key = `${row.nama ?? ''}|${iso}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const out: AbsensiHarianView[] = [];
  for (const [key, bucket] of groups) {
    const iso = key.slice(key.lastIndexOf('|') + 1);
    const schedule = pilihWorkCodeUntukHari(codes, iso);
    const punches = bucket.slice().sort((a, b) => String(a.waktu).localeCompare(String(b.waktu)));
    const masuk = punches.find(row => isDatang(row.checktype));
    const pulang = punches.find(row => isPulang(row.checktype));
    const reference = masuk ?? punches[0];
    const jamMasuk = jamTampil(masuk?.waktu ?? reference?.waktu);

    out.push({
      tanggal: iso,
      nama: String(reference?.nama ?? ''),
      departemen: String(reference?.departemen ?? ''),
      jamMasuk,
      jamPulang: jamTampil(pulang?.waktu),
      jarak: String(masuk?.jarak ?? reference?.jarak ?? ''),
      // Toleransi 15 menit tidak ditulis di sini. Angkanya hidup di satu
      // tempat (`terlambatCompared`); dua salinan berarti diam-diam bisa
      // berbeda begitu salah satu diubah.
      status: terlambatCompared(jamMasuk, schedule?.jam.jam_masuk_awal) ? 'terlambat' : 'hadir',
      punches,
    });
  }

  return out.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || a.nama.localeCompare(b.nama));
}

function isDatang(checktype: unknown): boolean {
  const text = String(checktype ?? '').trim().toLowerCase();
  return text === 'datang' || text === String(ABSEN_CHECK_TYPE.DATANG);
}

function isPulang(checktype: unknown): boolean {
  const text = String(checktype ?? '').trim().toLowerCase();
  return text === 'pulang' || text === String(ABSEN_CHECK_TYPE.PULANG);
}

// ═══════════════════════════════════════════════════════════════════════
//  Kolom tabel
// ═══════════════════════════════════════════════════════════════════════

/** Baris mentah `history_absen` — ditampilkan apa adanya seperti aplikasi asli. */
const riwayatColumns: Column<HistoryAbsenModel>[] = [
  {
    key: 'nama',
    header: 'Pegawai',
    /*
     * ⚠️ `max-w-[220px]` itu **wajib**, bukan hiasan.
     *
     * `truncate` sendirian tidak membatasi apa pun: di dalam tabel
     * `table-layout: auto`, lebar min-content sebuah sel tetap sebesar
     * teks penuhnya, karena nowrap tidak pernah membungkus. Diukur di DOM,
     * nama seperti "Agus Prasetyo / UPT Informatika Dinas Komunikasi dan
     * Informatika" membuat kolom Pegawai melebar **277 px**, dan tabel
     * 686 px — sedangkan wadah di 1024 px hanya **644 px** (sidebar
     * melebar ke `w-64` tepat di titik itu, jadi wadah justru menyempit
     * dibanding 768 px). Akibatnya kolom paling kanan keluar layar persis
     * di lebar yang biasanya dianggap aman.
     *
     * Yang menurunkan min-content hanyalah `max-width` pada sel/isi —
     * `max-w-0 w-full` atau `min-w-0` saja tidak, keduanya tetap mengukur
     * teks penuh. Dengan plafon 220 px tabel jadi 629 px, di bawah kuota
     * 644 px, dan truncate akhirnya berfungsi seperti seharusnya.
     */
    className: 'max-w-[220px]',
    render: row => (
      <div className="min-w-0">
        <p className="font-semibold text-slate-700 dark:text-slate-200 truncate">
          {row.nama || '-'}
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
          {row.departemen || '-'}
        </p>
      </div>
    ),
  },
  {
    key: 'tanggal',
    header: 'Tanggal',
    /*
     * Lebar eksplisit, bukan "biarkan meyakinkan diri sendiri".
     *
     * Tanpa `w-*`, `DataTable` memakai auto-layout dan kolom ini bersaing
     * dengan kolom yang isinya `truncate` — dan truncate-lah yang kalah,
     * karena ia mau menyusut. Akibatnya tanggal ikut terpotong padahal
     * formatnya `2026-03-01` yang hanya 10 karakter.
     *
     * `whitespace-nowrap` saja tidak menolong: ia mencegah pembungkusan baris,
     * bukan pemampatan kolom — dan `w-full` + `min-w-[640px]` tetap membuat
     * browser membagi ruang sesuai proporsi konten yang bisa menyusut.
     */
    className: 'w-[110px]',
    render: row => (
      <span className="font-mono text-xs whitespace-nowrap">{tanggalKeIso(row.waktu) ?? '-'}</span>
    ),
  },
  {
    key: 'waktu',
    header: 'Waktu',
    // `HH:MM` — 5 karakter, selalu muat; lebarnya dikunci supaya kolom Jam
    // Masuk/Pulang di tabel rekap tidak ikut bergeser-bergeser.
    className: 'w-[80px]',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{jamTampil(row.waktu) ?? '-'}</span>,
  },
  {
    key: 'checktype',
    header: 'Jenis Absen',
    render: row => <Badge tone={isDatang(row.checktype) ? 'blue' : isPulang(row.checktype) ? 'violet' : 'slate'}>{labelCheckType(row.checktype)}</Badge>,
  },
  {
    key: 'approval',
    header: 'Persetujuan',
    render: row => (row.approval ? <Badge tone="emerald">{row.approval_text || 'Disetujui'}</Badge> : <Badge tone="amber">-</Badge>),
  },
  {
    key: 'jarak',
    header: 'Jarak',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{row.jarak || '-'}</span>,
  },
];

/** Baris rekap harian hasil pivot lokal. */
const rekapColumns: Column<AbsensiHarianView>[] = [
  {
    key: 'nama',
    header: 'Pegawai',
    // Sama seperti di `riwayatColumns`: `truncate` tanpa plafon `max-width`
    // tidak membatasi apa pun, dan kolom Pegawai ikut melebar sampai
    // 277 px di kondisi terburuk. Lihat catatan panjang di sana.
    className: 'max-w-[220px]',
    render: row => (
      <div className="min-w-0">
        <p className="font-semibold text-slate-700 dark:text-slate-200 truncate">{row.nama || '-'}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{row.departemen || '-'}</p>
      </div>
    ),
  },
  {
    key: 'tanggal',
    header: 'Tanggal',
    // Sama seperti di `riwayatColumns`: lebar eksplisit supaya tidak bersaing
    // dengan kolom `truncate`. Lihat catatan panjang di sana.
    className: 'w-[110px]',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{row.tanggal}</span>,
  },
  {
    key: 'masuk',
    header: 'Jam Masuk',
    render: row => (
      <span
        className={`font-mono text-xs whitespace-nowrap ${
          row.status === 'terlambat' ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''
        }`}
      >
        {row.jamMasuk ?? '-'}
      </span>
    ),
  },
  {
    key: 'keluar',
    header: 'Jam Pulang',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{row.jamPulang ?? '-'}</span>,
  },
  {
    key: 'jarak',
    header: 'Jarak',
    render: row => <span className="font-mono text-xs whitespace-nowrap">{row.jarak || '-'}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: row =>
      row.status === 'terlambat' ? <Badge tone="amber">Terlambat</Badge> : <Badge tone="emerald">Hadir</Badge>,
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  Ekspor
// ═══════════════════════════════════════════════════════════════════════

/*
 * Kepala tabel didefinisikan **sekali** dan dipakai berdua oleh CSV dan Excel.
 *
 * Semula tiap format punya daftar header sendiri. Dua daftar itu pernah
 * berbeda satu kolom — dan karena yang tampil di layar menjadi acuan,
 * berkas yang diunduh jadi menyesatkan. Sekarang `riwayatCsv` dan
 * `lembarRiwayat` membaca header yang sama, jadi tidak mungkin lagi menyimpang.
 */
const HEADER_RIWAYAT = [
  'Nama', 'Departemen', 'Tanggal', 'Waktu', 'Jenis Absen', 'Persetujuan', 'Jarak',
] as const;

/** Lebar kolom Excel dalam satuan karakter, mengikuti isi tiap kolom. */
const LEBAR_RIWAYAT = [200, 140, 96, 96, 110, 110, 64];
const LEBAR_REKAP = [200, 140, 96, 96, 96, 64, 110];

function isiRiwayat(rows: HistoryAbsenModel[]): SelExcel[][] {
  return rows.map(row => [
    row.nama,
    row.departemen,
    tanggalKeIso(row.waktu),
    row.waktu,
    labelCheckType(row.checktype),
    row.approval ? row.approval_text || 'Disetujui' : 'Belum disetujui',
    // Angka, bukan teks: di Excel kolom ini bisa dijumlahkan dan diurutkan.
    row.jarak,
  ]);
}

function isiRekap(rows: AbsensiHarianView[]): SelExcel[][] {
  return rows.map(row => [
    row.nama,
    row.departemen,
    row.tanggal,
    row.jamMasuk,
    row.jamPulang,
    row.jarak,
    row.status,
  ]);
}

const HEADER_REKAP = [
  'Nama', 'Departemen', 'Tanggal', 'Jam Masuk', 'Jam Pulang', 'Jarak', 'Status',
] as const;

/** Lembar Excel "Riwayat". */
function lembarRiwayat(rows: HistoryAbsenModel[]) {
  return {
    nama: 'Riwayat',
    header: [...HEADER_RIWAYAT],
    baris: isiRiwayat(rows),
    lebar: LEBAR_RIWAYAT,
  };
}

/** Lembar Excel "Rekap Harian". */
function lembarRekap(rows: AbsensiHarianView[]) {
  return {
    nama: 'Rekap Harian',
    header: [...HEADER_REKAP],
    baris: isiRekap(rows),
    lebar: LEBAR_REKAP,
  };
}

/*
 * ⚠️ `selCsv` dari `lib/excelXml`, bukan versi lokal lagi.
 *
 * Versi lokal hanya meng-escape tanda kutip, jadi sel yang diawali `=`, `+`,
 * `-`, atau `@` tetap dibaca Excel sebagai rumus. Nama pegawai yang isinya
 * `=HYPERLINK(...)` akan dieksekusi begitu CSV dibuka.
 */
function barisCsv(header: readonly string[], isi: SelExcel[][]): string {
  return [header.map(h => selCsv(h)).join(','), ...isi.map(r => r.map(selCsv).join(','))].join('\n');
}

function riwayatCsv(rows: HistoryAbsenModel[]): string {
  return barisCsv(HEADER_RIWAYAT, isiRiwayat(rows));
}

function rekapCsv(rows: AbsensiHarianView[]): string {
  return barisCsv(HEADER_REKAP, isiRekap(rows));
}

// ═══════════════════════════════════════════════════════════════════════
//  Helper
// ═══════════════════════════════════════════════════════════════════════

/**
 * Daftar tanggal `yyyy-mm-dd` dari `start` sampai `end` (inklusif).
 *
 * `history_absen` hanya menerima satu `tgl` per panggilan, jadi rentang
 * laporan dijahit dengan mengulang endpoint per hari. Dibatasi `maxDays`
 * agar rentang yang tidak masuk akal tidak menembak server.
 */
function eachDate(start: string, end: string, maxDays = MAX_REPORT_DAYS): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return out;
  while (cursor <= last && out.length < maxDays) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Rata-rata menit sejak tengah malam dari daftar jam "HH:MM". */
function averageMinutes(values: (string | null)[]): number | null {
  let total = 0;
  let count = 0;
  for (const value of values) {
    const minutes = timeToMinutes(value ?? '');
    if (minutes === null) continue;
    total += minutes;
    count += 1;
  }
  return count === 0 ? null : Math.round(total / count);
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `rata-rata ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
