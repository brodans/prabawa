import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, FileCheck2, RefreshCw, Send } from 'lucide-react';
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
  LoadingBlock,
  PageHeader,
  Textarea,
  type Column,
} from '../components/ui/Surface';
import DatePicker from '../components/ui/DatePicker';
import {
  rpcAddIjin,
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
import { getTodayWIB, getTodayWIBWithDaysOffset } from '../lib/dateFormatter';
import Dropdown from '../components/ui/Dropdown';

/** Berapa baris yang diambil per halaman dari `list_ijin`. */
const LIST_PAGE_LIMIT = 100;
/** Riwayat yang ditampilkan di bawah formulir. */
const RECENT_WINDOW_DAYS = 60;
/**
 * Batas lampiran.
 *
 * ⚠️ Lampiran TIDAK lagi dikirim sebagai base64 di dalam `add_ijin`.
 * Berkas diunggah terpisah ke `POST /importfile` (multipart) memakai
 * `id` izin yang baru dibuat — persis seperti aplikasi v89. Batas 5 MB
 * mengikuti limit route `/api/upload`.
 */
const MAX_ATTACHMENT_BYTES = 5_000_000;

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
  const { pegawai, tabPermissions, setActivePage } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();

  // Katalog izin datang dari tiga endpoint terpisah:
  //   `jenis_ijin`        → daftar jenis izin (Id, Nama, TipeId)
  //   `getmastertipeijin` → pengelompokan (Id, Nama, Tipe[] = id tipe yang valid)
  //   `tipe_ijin`         → peta id tipe → label
  const [jenisList, setJenisList] = useState<JenisIjinView[]>([]);
  const [masterList, setMasterList] = useState<MasterTipeIjinView[]>([]);
  const [tipeMap, setTipeMap] = useState<TipeIjinMap>({});
  const [rows, setRows] = useState<IjinView[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  /** Berkas lampiran yang dipilih — dikirim ke `/importfile`, bukan ke JSON. */
  const [lampiran, setLampiran] = useState<File | null>(null);

  const loadData = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      // `list_ijin` hanya menerima page + limit — penyaringan tanggal
      // dilakukan lokal karena tidak ada param rentang tanggal di server.
      const [master, jenis, tipe, all] = await Promise.all([
        rpcGetMasterTipeIjin(context),
        rpcJenisIjin(context, { masterTipeIjin: 0, absen: 0 }),
        rpcTipeIjin(context),
        rpcListIjin(context, { page: 1, limit: LIST_PAGE_LIMIT }),
      ]);
      setMasterList(master);
      setJenisList(jenis);
      setTipeMap(tipe);

      const until = getTodayWIB();
      const since = getTodayWIBWithDaysOffset(-RECENT_WINDOW_DAYS);
      const recent = all.filter(row => (row.tglDari ?? '') >= since && (row.tglDari ?? '') <= until);
      recent.sort((a, b) => String(b.tglDari).localeCompare(String(a.tglDari)));
      setRows(recent);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data perizinan.');
    } finally {
      setLoading(false);
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
      await loadData();
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
          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{row.jenisIjinNama || '-'}</p>
        </div>
      ),
    },
    {
      key: 'periode',
      header: 'Periode',
      className: 'w-[190px]',
      render: row => (
        <span className="font-mono text-xs whitespace-nowrap">
          {row.tglDari || '-'} → {row.tglSampai || row.tglDari || '-'}
        </span>
      ),
    },
    {
      key: 'alasan',
      header: 'Alasan',
      /*
       * Alasan izin bisa satu paragraf. Tanpa plafon, satu alasan panjang
       * saja sudah cukup untuk jadi lebar tabel itu sendiri, dan kolom
       * paling kanan (Status) justru yang pertama keluar layar.
       */
      className: 'max-w-[260px]',
      render: row => (
        <span className="text-xs block min-w-0 truncate">{row.alasan || '-'}</span>
      ),
    },
    {
      key: 'berkas',
      header: 'Lampiran',
      render: row => (row.berkas ? <Badge tone="violet">Ada</Badge> : <span className="text-slate-300">-</span>),
    },
    {
      key: 'status',
      header: 'Status',
      render: row => <IjinStatusBadge row={row} />,
    },
  ];

  if (!ready || !pegawai) {
    return (
      <div className="space-y-6">
        <PageHeader title="Perizinan" subtitle="Hubungkan akun ke server pusat terlebih dahulu" icon={<FileCheck2 className="w-5 h-5" />} />
        <Card>
          <EmptyState message="Belum terhubung ke server pusat." />
          <div className="flex justify-center">
            <ActionButton onClick={() => setActivePage('tabBeranda')}>Ke Beranda</ActionButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Perizinan"
        subtitle="Ajukan izin, cuti, atau izin tidak masuk kantor"
        icon={<FileCheck2 className="w-5 h-5" />}
        action={
          <ActionButton variant="ghost" size="sm" onClick={() => void loadData()} icon={<RefreshCw className="w-4 h-4" />}>
            Muat Ulang
          </ActionButton>
        }
      />

      {error && <Alert tone="rose">{error}</Alert>}

      <div className="grid grid-cols-1 gap-6">
        {/* ── Formulir ────────────────────────────────────────────── */}
        <Card>
          <CardTitle>Formulir Pengajuan</CardTitle>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field
              label="Jenis Izin"
              hint={
                jenisList.length === 0
                  ? 'Katalog jenis izin belum dimuat dari server pusat.'
                  : 'Katalog dari object jenis_ijin, dikelompokkan dengan getmastertipeijin.'
              }
            >
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

            <Field
              label="Tipe Izin"
              hint={
                selectedMaster
                  ? `Tipe yang valid untuk "${selectedMaster.nama}", sesuai daftar server.`
                  : 'Pilih jenis izin terlebih dahulu.'
              }
            >
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

            <Field label="Alasan" hint="Wajib diisi — disimpan pada field `alasan` oleh server.">
              <Textarea
                value={form.alasan}
                onChange={event => setForm(prev => ({ ...prev, alasan: event.target.value.slice(0, 500) }))}
                placeholder="Contoh: Cuti Tahunan, sakit, tugas luar kantor..."
              />
            </Field>

            <Field
              label="Lampiran"
              hint={`Opsional — JPG atau PDF, maks ${Math.round(
                MAX_ATTACHMENT_BYTES / 1_000_000
              )} MB. Bisa diklik atau langsung diseret ke kotaknya. Diunggah ke endpoint \`/service/importfile\` memakai id izin, sama seperti aplikasi Android (bukan base64 di dalam JSON).`}
            >
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

      {/* ── Pengajuan terbaru ──────────────────────────────────── */}
      <Card>
        <CardTitle action={<Badge tone="slate">{rows.length} pengajuan</Badge>}>
          <span className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" /> Pengajuan {RECENT_WINDOW_DAYS} Hari Terakhir
          </span>
        </CardTitle>
        {loading ? (
          <LoadingBlock />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            keyOf={(row, index) => String(row.id || index)}
            emptyMessage="Belum ada pengajuan izin."
          />
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Sub-komponen
// ═══════════════════════════════════════════════════════════════════════

/**
 * Status izin dari server pusat.
 *
 * `list_ijin` mengirim `status` (int: 1 disetujui, 2 menunggu,
 * 3 ditolak) selain `approval` (boolean). Ketiga nilai dipakai di sini;
 * `toIjinView` sudah jatuh ke `approval` bila `status` tidak dikirim.
 */
function IjinStatusBadge({ row }: { row: IjinView }) {
  if (row.status === 'approved') return <Badge tone="emerald">Disetujui</Badge>;
  if (row.status === 'ditolak') return <Badge tone="rose">Ditolak</Badge>;
  return <Badge tone="amber">Menunggu</Badge>;
}

