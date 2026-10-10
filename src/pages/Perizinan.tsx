import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, Download, FileCheck2, FileText, History, RefreshCw, Send, Trash2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { useToast } from '../components/ui/Toast';
import Dropzone from '../components/ui/Dropzone';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  Field,
  SkeletonTable,
  StatTile,
  Textarea,
  type Column,
} from '../components/ui/Surface';
import DatePicker from '../components/ui/DatePicker';
import {
  rpcAddIjin,
  rpcDeleteIjin,
  rpcGetMasterTipeIjin,
  rpcJenisIjin,
  rpcListIjin,
  rpcTipeIjin,
  rpcUploadLampiranIjin,
  type IjinView,
  type JenisIjinView,
  type MasterTipeIjinView,
  type TipeIjinMap,
} from '../lib/apiCalls';
import { formatCompactDateTime, getTodayWIB, getTodayWIBWithDaysOffset } from '../lib/dateFormatter';
import Dropdown from '../components/ui/Dropdown';
import { selCsv } from '../lib/excelXml';
import { unduhTeks } from '../lib/unduh';

/**
 * Batas lampiran.
 *
 * ⚠️ Lampiran TIDAK lagi dikirim sebagai base64 di dalam `add_ijin`.
 * Berkas diunggah terpisah ke `POST /importfile` (multipart) memakai
 * `id` izin yang baru dibuat — persis seperti aplikasi v89. Batas 5 MB
 * mengikuti limit route `/api/upload`.
 */
const MAX_ATTACHMENT_BYTES = 5_000_000;
type TabPerizinan = 'pengajuan' | 'riwayat';
type StatusFilter = 'all' | 'pending' | 'approved' | 'ditolak';

const LIMIT_RIWAYAT = 200;
const FILTER_STATUS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'pending', label: 'Menunggu' },
  { value: 'approved', label: 'Disetujui' },
  { value: 'ditolak', label: 'Ditolak' },
];

const EMPTY_FORM = {
  jenisIjin: '',
  tipeIjin: '',
  alasan: '',
  tglIjinDari: getTodayWIB(),
  tglIjinSampai: getTodayWIB(),
  /** Nama berkas lampiran yang dipilih; '' = tidak ada. */
  berkasName: '',
};

export default function Perizinan() {
  const { pegawai, currentUser, tabPermissions, setActivePage } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();
  const [tabAktif, setTabAktif] = useState<TabPerizinan>('pengajuan');

  // Katalog izin datang dari tiga endpoint terpisah:
  //   `jenis_ijin`        → daftar jenis izin (Id, Nama, TipeId)
  //   `getmastertipeijin` → pengelompokan (Id, Nama, Tipe[] = id tipe yang valid)
  //   `tipe_ijin`         → peta id tipe → label
  const [jenisList, setJenisList] = useState<JenisIjinView[]>([]);
  const [masterList, setMasterList] = useState<MasterTipeIjinView[]>([]);
  const [tipeMap, setTipeMap] = useState<TipeIjinMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  /** Berkas lampiran yang dipilih — dikirim ke `/importfile`, bukan ke JSON. */
  const [lampiran, setLampiran] = useState<File | null>(null);

  const loadData = useCallback(async () => {
    if (!ready) return;
    setError(null);
    try {
      // `list_ijin` hanya menerima page + limit — penyaringan tanggal
      // dilakukan lokal karena tidak ada param rentang tanggal di server.
      const [master, jenis, tipe] = await Promise.all([
        rpcGetMasterTipeIjin(context),
        rpcJenisIjin(context, { masterTipeIjin: 0, absen: 0 }),
        rpcTipeIjin(context),
      ]);
      setMasterList(master);
      setJenisList(jenis);
      setTipeMap(tipe);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data perizinan.');
    }
  }, [context, ready]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Katalog terkelompok ───────────────────────────────────────────
  // `getmastertipeijin` memberi kelompok (mis. "Izin", "Cuti") beserta
  // daftar id `tipe_ijin` yang valid; `jenis_ijin` punya `TipeId` yang
  // menunjuk ke `Id` kelompok tersebut.
  const grouped = useMemo(() => {
    const byMaster = new Map<number, JenisIjinView[]>();
    for (const item of jenisList) {
      const bucket = byMaster.get(item.tipeId) ?? [];
      bucket.push(item);
      byMaster.set(item.tipeId, bucket);
    }
    return masterList
      .map(master => ({ master, items: byMaster.get(master.id) ?? [] }))
      .filter(group => group.items.length > 0);
  }, [jenisList, masterList]);

  const selectedJenis = useMemo(
    () => jenisList.find(item => String(item.id) === form.jenisIjin) ?? null,
    [jenisList, form.jenisIjin]
  );

  const selectedMaster = useMemo(
    () => (selectedJenis ? (masterList.find(item => item.id === selectedJenis.tipeId) ?? null) : null),
    [masterList, selectedJenis]
  );

  /** Opsi tipe yang valid untuk jenis izin terpilih. */
  const tipeOptions = useMemo(() => {
    const ids = selectedMaster?.tipe ?? [];
    return ids.map(id => ({ id, label: tipeMap[String(id)] || `Tipe ${id}` }));
  }, [selectedMaster, tipeMap]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!form.jenisIjin) {
      setError('Pilih jenis izin.');
      return;
    }
    if (!form.tipeIjin) {
      setError('Pilih tipe izin.');
      return;
    }
    if (!form.alasan.trim()) {
      setError('Alasan wajib diisi.');
      return;
    }
    if (form.tglIjinSampai < form.tglIjinDari) {
      setError('Tanggal selesai tidak boleh lebih awal dari tanggal mulai.');
      return;
    }

    setSubmitting(true);
    try {
      // Lima param wajib `add_ijin`: tgl_ijin, tgl_ijin_sampai, alasan,
      // jenis_ijin, tipe_ijin. Lampiran TIDAK ikut — lihat langkah 2.
      const result = await rpcAddIjin(context, {
        jenisIjin: form.jenisIjin,
        tipeIjin: form.tipeIjin,
        alasan: form.alasan.trim(),
        tglIjin: form.tglIjinDari,
        tglIjinSampai: form.tglIjinSampai,
      });

      if (result === null) {
        setError('Server pusat menolak pengajuan. Periksa kembali data Anda.');
        return;
      }

      // Langkah 2 — lampiran. `add_ijin` mengembalikan `id` izin; berkas
      // baru bisa diunggah setelah id itu ada, karena
      // `POST /service/importfile` mengaitkan berkas lewat `id` — bukan
      // lewat `add_ijin`.
      //
      // ⚠️ Endpoint unggah belum terverifikasi di sisi server (ENDPOINT.md
      // §2.1), jadi kegagalan di sini tidak boleh menjatuhkan pengajuan
      // yang sudah tercatat: keduanya dilaporkan terpisah.
      const izinId = Number((result as { id?: number }).id ?? 0);
      if (lampiran && izinId > 0) {
        setUploading(true);
        try {
          const upload = await rpcUploadLampiranIjin(context, { id: izinId, file: lampiran });
          if (upload === null) {
            // Pengajuan sudah tercatat; hanya lampiran yang gagal.
            toast.error('Pengajuan tersimpan, tetapi lampiran gagal diunggah.');
          } else {
            toast.success('Pengajuan dan lampiran berhasil dikirim.');
          }
        } catch (err: any) {
          toast.error(
            `Pengajuan tersimpan, tetapi lampiran gagal: ${err?.message ?? 'tidak diketahui'}`
          );
        } finally {
          setUploading(false);
        }
      } else {
        toast.success('Pengajuan izin berhasil dikirim.');
      }

      setForm({ ...EMPTY_FORM, tglIjinDari: getTodayWIB(), tglIjinSampai: getTodayWIB() });
      setLampiran(null);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal mengirim pengajuan izin.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Pilih lampiran. Berkas disimpan apa adanya — tidak diubah jadi base64.
   *
   * Aplikasi v89 hanya menerima `image/jpeg` dan `application/pdf`
   * (lihat `PickFileContract`), jadi jenis lain ditolak di sini agar
   * tidak gagal saat diunggah.
   */
  const handleFile = (file: File | null) => {
    /*
     * ⚠️ `null` berarti **hapus**, bukan "abaikan".
     *
     * Semula `if (!file) return` ada di baris pertama, jadi ketika `Dropzone`
     * mengirim `null` dari tombol hapus, lampiran lama **tidak** ikut
     * terhapus — nama berkasnya hilang dari layar tapi `File`-nya masih
     * terkirim saat pengajuan. Hasilnya berkas yang sudah dihapus tetap
     * terunggah.
     */
    if (!file) {
      setLampiran(null);
      setForm(prev => ({ ...prev, berkasName: '' }));
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(`Lampiran maksimal ${Math.round(MAX_ATTACHMENT_BYTES / 1_000_000)} MB.`);
      return;
    }
    const tipe = file.type.toLowerCase();
    const didukung = tipe === 'image/jpeg' || tipe === 'application/pdf';
    if (!didukung) {
      toast.error('Lampiran harus berupa foto JPG atau berkas PDF.');
      return;
    }
    setLampiran(file);
    setForm(prev => ({ ...prev, berkasName: file.name }));
  };

  if (!ready || !pegawai) {
    return (
      <Card>
        {error && <Alert tone="rose">{error}</Alert>}
        <EmptyState message="Belum terhubung ke server pusat." />
        <div className="flex justify-center">
          <ActionButton onClick={() => setActivePage('tabBeranda')}>Ke Beranda</ActionButton>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800/60">
        <div className="px-3 py-3 sm:px-5">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900/70" role="tablist" aria-label="Bagian Perizinan">
            {([
              { id: 'pengajuan', label: 'Pengajuan Izin', icon: FileCheck2 },
              { id: 'riwayat', label: 'Riwayat Izin', icon: History },
            ] as const).map(tab => {
              const Icon = tab.icon;
              const aktif = tabAktif === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`tab-perizinan-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={aktif}
                  aria-controls={`panel-perizinan-${tab.id}`}
                  onClick={() => setTabAktif(tab.id)}
                  className={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-center text-[11px] font-bold leading-tight transition-colors sm:gap-2 sm:px-3 sm:text-sm ${
                    aktif
                      ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section
        id="panel-perizinan-pengajuan"
        role="tabpanel"
        aria-labelledby="tab-perizinan-pengajuan"
        hidden={tabAktif !== 'pengajuan'}
        className="min-w-0"
      >
        <div className="space-y-6">
            {error && <Alert tone="rose">{error}</Alert>}

        {/* ── Formulir ────────────────────────────────────────────── */}
        <Card>
          <CardTitle>Formulir Pengajuan</CardTitle>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Jenis Izin">
              <Dropdown
                value={form.jenisIjin}
                onChange={value =>
                  setForm(prev => ({
                    ...prev,
                    jenisIjin: value,
                    // Tipe harus diulang karena tiap jenis punya daftar tipe sendiri.
                    tipeIjin: '',
                  }))
                }
                opsi={[
                  { value: '', label: '— Pilih jenis —' },
                  ...grouped.flatMap(group =>
                    group.items.map(item => ({
                      value: String(item.id),
                      label: item.nama,
                      hint: group.master.nama,
                      group: group.master.nama,
                    }))
                  ),
                ]}
                disabled={jenisList.length === 0}
                searchable
                placeholder="— Pilih jenis izin —"
                aria-label="Jenis izin"
              />
            </Field>

            <Field label="Tipe Izin">
              <Dropdown
                value={form.tipeIjin}
                onChange={value => setForm(prev => ({ ...prev, tipeIjin: value }))}
                opsi={[
                  { value: '', label: '— Pilih tipe —' },
                  ...tipeOptions.map(item => ({ value: String(item.id), label: item.label })),
                ]}
                disabled={!selectedJenis || tipeOptions.length === 0}
                placeholder="— Pilih tipe izin —"
                aria-label="Tipe izin"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DatePicker
                className="w-full"
                label="Tanggal Mulai"
                value={form.tglIjinDari}
                onChange={value =>
                  setForm(prev => ({
                    ...prev,
                    tglIjinDari: value,
                    // Jenis setengah hari hanya berlaku satu hari.
                    tglIjinSampai: selectedJenis?.setengahHari ? value : prev.tglIjinSampai,
                  }))
                }
                max={getTodayWIBWithDaysOffset(365)}
              />
              <DatePicker
                className="w-full"
                label="Tanggal Selesai"
                value={form.tglIjinSampai}
                onChange={value => setForm(prev => ({ ...prev, tglIjinSampai: value }))}
                min={form.tglIjinDari}
                max={getTodayWIBWithDaysOffset(365)}
                disabled={selectedJenis?.setengahHari ?? false}
              />
            </div>

            {selectedJenis?.setengahHari && (
              <Alert tone="blue">
                Jenis <span className="font-semibold">{selectedJenis.nama}</span> ditandai
                <span className="font-semibold"> setengah hari</span> di server, jadi tanggal selesai
                otomatis disamakan dengan tanggal mulai.
              </Alert>
            )}

            <Field label="Alasan">
              <Textarea
                value={form.alasan}
                onChange={event => setForm(prev => ({ ...prev, alasan: event.target.value.slice(0, 500) }))}
                placeholder="Contoh: Cuti Tahunan, sakit, tugas luar kantor..."
              />
            </Field>

            <Field label="Lampiran">
              {/*
               * `Dropzone` — Area seret, plus tombol "Pilih Berkas" di
               * dalamnya. `handleFile` tetap satu-satunya tempat validasi
               * jenis dan ukuran; komponen ini tidak menyalin aturannya, jadi
               * tidak ada jalan (klik atau seret) yang bisa melewati
               * pemeriksaan.
               */}
              <Dropzone
                value={form.berkasName}
                onPilih={handleFile}
                accept="image/jpeg,application/pdf"
                label="Seret berkas ke sini, atau klik untuk memilih"
                hint={`JPG atau PDF, maks ${Math.round(MAX_ATTACHMENT_BYTES / 1_000_000)} MB`}
              />
            </Field>

            <div className="flex flex-wrap gap-2 pt-1">
              <ActionButton
                type="submit"
                loading={submitting || uploading}
                disabled={!tabPermissions.aksiAjukanIzin}
                icon={<Send className="w-4 h-4" />}
              >
                {uploading ? 'Mengunggah Lampiran...' : 'Kirim Pengajuan'}
              </ActionButton>
              <ActionButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setForm({ ...EMPTY_FORM, tglIjinDari: getTodayWIB(), tglIjinSampai: getTodayWIB() });
                  setLampiran(null);
                }}
              >
                Reset Form
              </ActionButton>
            </div>

            {!tabPermissions.aksiAjukanIzin && (
              <Alert tone="amber">Akun Anda tidak memiliki hak untuk mengajukan izin.</Alert>
            )}
          </form>
        </Card>
        </div>
      </section>
      <section
        id="panel-perizinan-riwayat"
        role="tabpanel"
        aria-labelledby="tab-perizinan-riwayat"
        hidden={tabAktif !== 'riwayat'}
        className="min-w-0"
      >
        <RiwayatIzinPanel key={currentUser?.username ?? ''} aktif={tabAktif === 'riwayat'} />
      </section>
    </div>
  );
}

function RiwayatIzinPanel({ aktif }: { aktif: boolean }) {
  const { tabPermissions, riwayatPerizinanState: state, setRiwayatPerizinanState: setState } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const muatanSeq = useRef(0);

  const loadData = useCallback(async () => {
    if (!ready) return;
    const seq = ++muatanSeq.current;
    const usang = () => seq !== muatanSeq.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await rpcListIjin(context, { page: 1, limit: LIMIT_RIWAYAT });
      if (usang()) return;
      setState(prev => ({ ...prev, rows, hasLoadedOnce: true }));
    } catch (err: any) {
      if (usang()) return;
      setError(err?.message ?? 'Gagal memuat riwayat izin.');
    } finally {
      if (!usang()) setLoading(false);
    }
  }, [context, ready]);

  useEffect(() => {
    if (!aktif || state.hasLoadedOnce) return;
    void loadData();
  }, [aktif, state.hasLoadedOnce, loadData]);

  const inWindow = state.rows.filter(row => inRange(row, state.dateStart, state.dateEnd));
  const filtered = inWindow.filter(row => filter === 'all' || row.status === filter);
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

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.info('Tidak ada data untuk diekspor.');
      return;
    }
    unduhTeks(
      `riwayat-izin-${state.dateStart}_${state.dateEnd}.csv`,
      '\ufeff' + rowsToCsv(filtered),
      'text/csv'
    );
    toast.success(`${filtered.length} baris diekspor ke CSV.`);
  };

  const columns: Column<IjinView>[] = [
    {
      key: 'jenis',
      header: 'Jenis / Tipe',
      className: 'max-w-[220px]',
      render: row => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-700 dark:text-slate-200">{row.tipeIjinText || '-'}</p>
          <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">{row.jenisIjinNama || '-'}</p>
        </div>
      ),
    },
    {
      key: 'nama',
      header: 'Pengaju',
      className: 'max-w-[220px]',
      render: row => (
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{row.nama || '-'}</p>
          <p className="truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">{row.nip || '-'}</p>
        </div>
      ),
    },
    {
      key: 'periode',
      header: 'Periode',
      className: 'w-[190px]',
      render: row => <PeriodeCell row={row} />,
    },
    {
      key: 'alasan',
      header: 'Alasan',
      render: row => (
        <div className="min-w-0">
          <p className="max-w-[220px] truncate text-xs">{row.alasan || '-'}</p>
          {row.berkas && <p className="max-w-[220px] truncate text-[11px] text-slate-400 dark:text-slate-500">Lampiran: {namaBerkas(row.berkas)}</p>}
          {row.catatan && <p className="max-w-[220px] truncate text-[11px] text-rose-500 dark:text-rose-400">Catatan: {row.catatan}</p>}
        </div>
      ),
    },
    {
      key: 'diajukan',
      header: 'Diajukan',
      className: 'w-[120px]',
      render: row => <span className="whitespace-nowrap text-xs">{formatCompactDateTime(row.createdAt || null)}</span>,
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
      render: row => row.status === 'pending' && tabPermissions.aksiAjukanIzin ? (
        <button
          type="button"
          onClick={() => void removeRow(String(row.id))}
          disabled={deletingId === String(row.id)}
          className="rounded-lg p-1.5 text-rose-500 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:hover:bg-rose-900/30"
          aria-label="Hapus pengajuan"
          title="Hapus pengajuan"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      {error && <Alert tone="rose">{error}</Alert>}
      <Card className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="grid max-w-md flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
            <DatePicker
              className="w-full"
              label="Dari Tanggal"
              value={state.dateStart}
              onChange={value => setState(prev => ({ ...prev, dateStart: value }))}
              max={getTodayWIBWithDaysOffset(365)}
            />
            <DatePicker
              className="w-full"
              label="Sampai Tanggal"
              value={state.dateEnd}
              onChange={value => setState(prev => ({ ...prev, dateEnd: value }))}
              min={state.dateStart}
              max={getTodayWIB()}
            />
          </div>
          <ActionButton onClick={() => void loadData()} loading={loading} icon={<FileText className="h-4 w-4" />}>
            Tampilkan
          </ActionButton>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/60 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">Status Pengajuan</p>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_STATUS.map(item => {
              const jumlah = jumlahStatus(item.value, inWindow);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  aria-pressed={filter === item.value}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase transition-colors ${
                    filter === item.value
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                  }`}
                >
                  {item.label}
                  <span className={`rounded-md px-1.5 py-px font-mono text-[10px] ${filter === item.value ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700'}`}>
                    {jumlah}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total" value={stats.total} tone="blue" icon={<CalendarRange className="h-4 w-4" />} />
        <StatTile label="Menunggu" value={stats.pending} tone="amber" />
        <StatTile label="Disetujui" value={stats.approved} tone="emerald" />
        <StatTile label="Tanggal Persetujuan" value={stats.sudahDisetujui} tone="slate" />
      </div>

      <Card padded={false} className="p-5 sm:p-6">
        <CardTitle
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge tone="slate">{filtered.length} baris</Badge>
              <ActionButton variant="ghost" size="sm" onClick={() => void loadData()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>
                Muat Ulang
              </ActionButton>
              <ActionButton variant="secondary" size="sm" onClick={exportCsv} disabled={filtered.length === 0} icon={<Download className="h-4 w-4" />}>
                CSV
              </ActionButton>
            </div>
          }
        >
          Daftar Pengajuan
        </CardTitle>
        {loading ? (
          <SkeletonTable columns={columns.length} rows={6} />
        ) : filtered.length === 0 ? (
          <EmptyState message="Tidak ada pengajuan pada rentang ini." hint="Ubah rentang tanggal atau ajukan izin baru." />
        ) : (
          <DataTable columns={columns} rows={filtered} keyOf={(row, index) => String(row.id || index)} />
        )}
      </Card>
    </div>
  );
}

function inRange(row: IjinView, start: string, end: string): boolean {
  const from = row.tglDari ?? '';
  const to = row.tglSampai ?? from;
  if (!from && !to) return false;
  return (from || '0000-00-00') <= end && (to || from || '0000-00-00') >= start;
}

const HEADER_IJIN = [
  'ID', 'Nama', 'NIP', 'Jenis', 'Tipe', 'Mulai', 'Selesai',
  'Alasan', 'Berkas', 'Diajukan', 'Status', 'Catatan',
] as const;

function rowsToCsv(rows: IjinView[]): string {
  const values = rows.map(row => [
    row.id,
    row.nama,
    row.nip,
    row.jenisIjinNama,
    row.tipeIjinText,
    row.tglDari ?? '',
    row.tglSampai ?? '',
    (row.alasan ?? '').replace(/[\r\n]+/g, ' '),
    namaBerkas(row.berkas),
    row.createdAt,
    row.status,
    (row.catatan ?? '').replace(/[\r\n]+/g, ' '),
  ]);
  return [HEADER_IJIN.map(selCsv).join(','), ...values.map(row => row.map(selCsv).join(','))].join('\n');
}

function jumlahStatus(status: StatusFilter, rows: IjinView[]): number {
  if (status === 'all') return rows.length;
  return rows.filter(row => row.status === status).length;
}

function PeriodeCell({ row }: { row: IjinView }) {
  const dari = row.tglDari || '-';
  const sampai = row.tglSampai || row.tglDari || '-';
  const satuHari = dari === sampai;
  return (
    <div className="min-w-0 text-[11px] leading-tight">
      <p className="font-mono font-semibold text-slate-700 dark:text-slate-200">{dari}</p>
      <p className="font-mono text-slate-400 dark:text-slate-500">{satuHari ? <span className="italic">satu hari</span> : `s/d ${sampai}`}</p>
    </div>
  );
}

function StatusBadge({ row }: { row: IjinView }) {
  if (row.status === 'approved') {
    return <Badge tone="emerald">{row.approvedAt ? 'Disetujui' : 'Disetujui (tanpa tanggal)'}</Badge>;
  }
  if (row.status === 'ditolak') return <Badge tone="rose">Ditolak</Badge>;
  return <Badge tone="amber">Menunggu</Badge>;
}

function namaBerkas(value: string): string {
  const path = value.split(/[\\/]/).pop() ?? value;
  return path.length > 0 ? path : '-';
}
