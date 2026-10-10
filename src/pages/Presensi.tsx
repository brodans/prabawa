import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Fingerprint,
  MapPin,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { useBackButton } from '../hooks/useBackButton';
import { useToast } from '../components/ui/Toast';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SkeletonList,
  StatTile,
} from '../components/ui/Surface';
import {
  rpcAbsen,
  rpcGetLokasiAbsen,
  rpcGetWorkCode,
  rpcHistoryAbsen,
  type HistoryAbsenModel,
  type LokasiView,
  type WorkCodeView,
} from '../lib/apiCalls';
import { getNowWIBTime, getTodayWIB } from '../lib/dateFormatter';
import { ABSEN_CHECK_TYPE, formatLatLong, TIPE_IJIN_LABEL } from '../lib/presensiContract';
import { checkGeofence } from '../lib/geo';
import { isCheckType, jamTampil, labelCheckType, pilihWorkCodeUntukHari } from '../lib/viewModels';
import PetaAbsen, { type TitikPeta } from '../components/ui/PetaAbsen';
import {
  bacaTitik,
  setTitikAktif,
  type TitikAbsen,
} from '../lib/lokasiTersimpan';
import Dropdown from '../components/ui/Dropdown';
import { Modal } from '../components/ui/Modal';

/**
 * Opsi jenis absensi — nilai `checktype` yang diterima server.
 *
 * Hint pada "Absen Siang" menyebut rentang 12:00–13:00 karena itulah
 * yang server terapkan; panel ini tidak memblokir, hanya memberi informasi.
 */
const CHECK_TYPES = [
  { value: ABSEN_CHECK_TYPE.DATANG, label: 'Absen Datang', hint: 'Absen masuk harian' },
  { value: ABSEN_CHECK_TYPE.PULANG, label: 'Absen Pulang', hint: 'Absen keluar harian' },
  { value: ABSEN_CHECK_TYPE.SIANG, label: 'Absen Siang', hint: 'Umumnya pukul 12:00 – 13:00' },
] as const;

/** Opsi `type_ijin` ketika absensi dikirim bersama pengajuan izin. */
const TIPE_IJIN_OPTIONS = Object.entries(TIPE_IJIN_LABEL);

export default function Presensi() {
  const { pegawai, tabPermissions, setActivePage, currentUser } = useAppContext();

  const { context, ready, segarkanTitik } = useServerContext();
  // Titik absen milik akun ini saja — bukan satu daftar bersama untuk semua
  // akun yang bergantian di peramban yang sama.
  const username = currentUser?.username ?? '';
  const toast = useToast();

  const [workCodes, setWorkCodes] = useState<WorkCodeView[]>([]);
  const [history, setHistory] = useState<HistoryAbsenModel[]>([]);
  const [locations, setLocations] = useState<LokasiView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Pilihan yang dikirim ke server ───────────────────────────────
  const [workCodeId, setWorkCodeId] = useState('');
  const [checkType, setCheckType] = useState<number>(ABSEN_CHECK_TYPE.DATANG);
  const [isWfh, setIsWfh] = useState(false);
  const [kirimIjin, setKirimIjin] = useState(false);
  const [typeIjin, setTypeIjin] = useState('1');
  const [keterangan, setKeterangan] = useState('');

  // ── Pemilih titik absen (peta) ───────────────────────────────────
  const [titikSaya, setTitikSaya] = useState<TitikAbsen[]>([]);
  const [pilihOpen, setPilihOpen] = useState(false);
  /** Draft koordinat yang sedang digeser di peta. */
  const [drafPeta, setDrafPeta] = useState<{ latitude: number; longitude: number } | null>(null);
  /** Pilihan peta ini hanya berlaku selama halaman Presensi tetap terbuka. */
  const [koordinatSementara, setKoordinatSementara] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  useEffect(() => {
    setTitikSaya(bacaTitik(username));
    setKoordinatSementara(null);
    setDrafPeta(null);
  }, [username]);

  // ── Konfirmasi absensi ──────────────────────────────────────────
  const [dialogAbsenOpen, setDialogAbsenOpen] = useState(false);
  const [errorAbsen, setErrorAbsen] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const today = getTodayWIB();

  // ── Muat data ────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const [codes, lokasis, riwayat] = await Promise.all([
        rpcGetWorkCode(context),
        rpcGetLokasiAbsen(context),
        rpcHistoryAbsen(context, { tgl: today, page: 1, limit: 30 }),
      ]);
      setWorkCodes(codes);
      setLocations(lokasis);
      setHistory(riwayat);
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat data presensi.');
    } finally {
      setLoading(false);
    }
  }, [context, ready, today]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Titik untuk peta: server + milik pengguna + draf.
  const titikPeta: TitikPeta[] = useMemo(() => {
    const server: TitikPeta[] = locations
      .filter(item => item.latitude !== null && item.longitude !== null)
      .map(item => ({
        id: `server-${item.id}`,
        nama: item.nama || item.satuanKerja || item.kode,
        latitude: item.latitude as number,
        longitude: item.longitude as number,
        radius: item.radius,
        dariServer: true,
      }));

    const lokal: TitikPeta[] = titikSaya.map(item => ({
      id: item.id,
      nama: item.nama,
      latitude: item.latitude,
      longitude: item.longitude,
      radius: 100,
      dariServer: false,
      aktif: item.dipakai,
    }));

    const drafTitik: TitikPeta[] = drafPeta
      ? [{
          id: '__draf__',
          nama: 'Posisi baru',
          latitude: drafPeta.latitude,
          longitude: drafPeta.longitude,
          radius: 0,
          dariServer: false,
        }]
      : [];

    return [...server, ...lokal, ...drafTitik];
  }, [locations, titikSaya, drafPeta]);

  // ── Sumber koordinat ─────────────────────────────────────────────
  // Titik yang ditandai "Pakai" di halaman Lokasi Absen menggantikan GPS.
  // Dengan begitu koordinat absen bisa disetel dekat kantor lewat peta tanpa
  // perlu GPS, dan tidak ada permintaan izin lokasi ke peramban sama sekali.
  /*
   * Titik yang sedang dipakai — diturunkan dari `titikSaya`, bukan dibaca
   * ulang dari storage.
   *
   * ⚠️ Semula `useMemo(() => bacaTitikAktif(username), [username])`.
   * Dependensinya cuma `username`, jadi memo **tidak pernah dihitung ulang**
   * saat pengguna mengganti titik dari dropdown atau peta. Akibatnya kartu
   * koordinat, hitungan jarak, dan baris konfirmasi di dialog semuanya
   * masih menampilkan titik yang lama — dan `koordinat` tetap `null` kalau
  * sebelumnya belum ada titik, sehingga tombol "Absen" tetap terkunci
   * padahal titik baru saja dibuat.
   *
   * Diturunkan dari state yang sama dengan isi dropdown, jadi keduanya
   * tidak mungkin berbeda: yang tampil di daftar adalah yang akan dikirim.
   */
  const titikPakai = useMemo(
    () => titikSaya.find(item => item.dipakai) ?? null,
    [titikSaya]
  );
  // Titik server yang dipakai untuk mengecek geofence.
  const activeLocation = useMemo(() => {
    if (locations.length === 0) return null;
    const preferred = locations.find(item => String(item.id) === String(pegawai?.idLokasi ?? ''));
    return preferred ?? locations[0];
  }, [locations, pegawai?.idLokasi]);

  // Koordinat yang benar-benar dikirim.
  //
  // Tidak ada fallback ke GPS: aplikasi ini tidak pernah meminta izin lokasi
  // ke peramban. Kalau belum ada titik yang dipilih, koordinat kosong dan
  // absensi diblokir di UI dengan arahan memilih titik dulu.
  const koordinat = useMemo(
    () =>
      koordinatSementara ??
      (titikPakai
        ? { latitude: titikPakai.latitude, longitude: titikPakai.longitude }
        : null),
    [koordinatSementara, titikPakai]
  );

  // Jarak ke titik server dihitung dari koordinat yang akan dikirim,
  // sehingga angkanya sama dengan yang dilihat server.
  const geofence = useMemo(
    () =>
      checkGeofence(
        koordinat?.latitude ?? null,
        koordinat?.longitude ?? null,
        activeLocation?.latitude,
        activeLocation?.longitude,
        activeLocation?.radius
      ),
    [koordinat, activeLocation]
  );

  // ── Jadwal hari ini ──────────────────────────────────────────────
  const schedule = useMemo(() => pilihWorkCodeUntukHari(workCodes, today), [workCodes, today]);

  // Preselect work code yang cocok dengan hari ini, begitu daftar dimuat.
  useEffect(() => {
    if (workCodeId || !schedule) return;
    setWorkCodeId(String(schedule.id));
  }, [schedule, workCodeId]);

  const selectedWorkCode = useMemo(
    () => workCodes.find(code => String(code.id) === workCodeId) ?? null,
    [workCodes, workCodeId]
  );

  // ── Absensi hari ini ─────────────────────────────────────────────
  // `history_absen` mengembalikan satu baris per rekaman, jadi absen
  // datang/pulang hari ini dibaca dari sana — `cekabsen` hanya
  // hanya untuk satu jenis absensi dan selalu memerlukan work_code.
  const punchMasuk = history.find(row => isCheckType(row.checktype, ABSEN_CHECK_TYPE.DATANG));
  const punchPulang = history.find(row => isCheckType(row.checktype, ABSEN_CHECK_TYPE.PULANG));
  const jamMasukAktif = jamTampil(punchMasuk?.waktu);
  const jamPulangAktif = jamTampil(punchPulang?.waktu);

  // WFH hanya diizinkan hari Jumat.
  const hariWfh =
    new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' })
      .format(new Date(`${today}T00:00:00Z`))
      .toLowerCase() === 'jumat';

  // ── Buka konfirmasi ─────────────────────────────────────────────
  const handleAbsen = () => {
    setError(null);
    setErrorAbsen('');
    if (!workCodeId) {
      setError('Work Code wajib dipilih — server menolak tanpa itu.');
      return;
    }
    if (!koordinat) {
      setError('Koordinat belum dipilih. Pilih titik di peta lebih dulu.');
      return;
    }
    setDialogAbsenOpen(true);
  };

  // ── Kirim absensi ───────────────────────────────────────────────
  const submitAbsen = async () => {
    setError(null);
    setErrorAbsen('');
    if (!workCodeId) {
      setErrorAbsen('Work Code wajib dipilih — server menolak tanpa itu.');
      return;
    }
    if (!koordinat) {
      setErrorAbsen('Koordinat belum dipilih. Pilih titik di peta lebih dulu.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await rpcAbsen({
        ...context,
        lastLatLong: formatLatLong(koordinat.latitude, koordinat.longitude),
      }, {
        checkType,
        workCode: workCodeId,
        isWfh,
        withIjin: kirimIjin,
        keterangan: kirimIjin ? keterangan.trim() : '',
        typeIjin: kirimIjin ? typeIjin : 0,
        // Koordinat selalu dari titik peta, bukan GPS perangkat — jadi
        // tidak pernah berstatus mock location.
        mock: false,
      });

      if (result === null) {
        setErrorAbsen('Server pusat tidak mengembalikan hasil absensi. Coba lagi beberapa saat.');
        return;
      }
      if (result.absen === false) {
        setErrorAbsen(result.message || 'Server menolak absensi ini.');
        return;
      }

      toast.success(`Absen ${labelCheckType(String(checkType))} tercatat pada ${getNowWIBTime().slice(0, 5)} WIB.`);
      setDialogAbsenOpen(false);
      setKeterangan('');
      setKirimIjin(false);
      await loadData();
    } catch (err: any) {
      setErrorAbsen(err?.message ?? 'Gagal mengirim absensi ke server pusat.');
    } finally {
      setSubmitting(false);
    }
  };

  // Tombol kembali menutup dialog konfirmasi lebih dulu.
  useBackButton(
    dialogAbsenOpen,
    () => {
      if (!dialogAbsenOpen) return false;
      setDialogAbsenOpen(false);
      return true;
    }
  );

  if (!ready || !pegawai) {
    return (
      <div className="space-y-6">
        <PageHeader title="Presensi" subtitle="Hubungkan akun ke server pusat terlebih dahulu" icon={<Fingerprint className="w-5 h-5" />} />
        <Card>
          <EmptyState
            message="Belum terhubung ke server pusat."
            hint="Kembali ke Beranda untuk login menggunakan NIP dan password presensi."
          />
          <div className="flex justify-center">
            <ActionButton onClick={() => setActivePage('tabBeranda')} icon={<Fingerprint className="w-4 h-4" />}>
              Ke Beranda
            </ActionButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Presensi"
        subtitle={`${pegawai.nama} · ${today}`}
        icon={<Fingerprint className="w-5 h-5" />}
        action={
          <ActionButton variant="ghost" size="sm" onClick={() => void loadData()} icon={<RefreshCw className="w-4 h-4" />} aria-label="Muat ulang presensi" title="Muat ulang presensi">
            <span className="hidden sm:inline">Muat Ulang</span>
          </ActionButton>
        }
      />

      {error && <Alert tone="rose">{error}</Alert>}

      {/* ── Status ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Absen Datang"
          value={jamMasukAktif ?? '--:--'}
          hint={schedule?.jam.jam_masuk ? `Jadwal ${schedule.jam.jam_masuk}` : 'Jadwal belum tersedia'}
          tone={jamMasukAktif ? 'emerald' : 'slate'}
        />
        <StatTile
          label="Absen Pulang"
          value={jamPulangAktif ?? '--:--'}
          hint={schedule?.jam.jam_keluar ? `Jadwal ${schedule.jam.jam_keluar}` : 'Jadwal belum tersedia'}
          tone={jamPulangAktif ? 'emerald' : 'slate'}
        />
        <StatTile
          label="Koordinat Dipakai"
            value={koordinatSementara ? 'Sementara' : titikPakai ? 'Titik Peta' : 'Belum Ada'}
          hint={
            koordinat
              ? `${koordinat.latitude.toFixed(5)}, ${koordinat.longitude.toFixed(5)}`
              : 'Pilih titik di Lokasi Absen'
          }
          tone={koordinat ? 'emerald' : 'rose'}
          icon={<MapPin className="w-4 h-4" />}
        />
        <StatTile
          label="Waktu Sekarang"
          value={getNowWIBTime().slice(0, 5)}
          hint="WIB"
          tone="blue"
          icon={<Clock className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Panel aksi ──────────────────────────────────────────── */}
        <Card className="lg:col-span-3">
          <CardTitle>Kirim Absensi</CardTitle>

          <div className="space-y-4">
            {/* ── Koordinat absen ──────────────────────────────────
                Ini yang menggantikan GPS. Titik yang dipilih di sini
                dikirim apa adanya sebagai `last_latlong` ke server saat absen. */}
            <Field label="Koordinat Absen">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Dropdown
                      value={titikPakai?.id ?? ''}
                      onChange={value => {
                        setTitikAktif(username, value);
                        setKoordinatSementara(null);
                        setTitikSaya(prev =>
                          prev.map(item => ({ ...item, dipakai: item.id === value }))
                        );
                        // `context.lastLatLong` ikut segar sekarang juga, bukan
                        // menunggu polling 5 detik — kalau tidak, klik "Absen"
                        // sesaat setelah ini mengirim koordinat lama.
                        segarkanTitik();
                        setDialogAbsenOpen(false);
                      }}
                      opsi={
                        titikSaya.length === 0
                          ? [{ value: '', label: 'Belum ada titik', disabled: true }]
                          : titikSaya.map(item => ({
                              value: item.id,
                              label: item.nama,
                              hint: `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`,
                            }))
                      }
                      placeholder="— Belum ada titik —"
                      disabled={titikSaya.length === 0}
                      aria-label="Titik absen"
                    />
                  </div>
                  <ActionButton
                    variant="secondary"
                    onClick={() => {
                      const awal =
                        koordinatSementara ??
                        (titikPakai
                          ? { latitude: titikPakai.latitude, longitude: titikPakai.longitude }
                          : activeLocation?.latitude != null && activeLocation.longitude != null
                            ? {
                                latitude: activeLocation.latitude,
                                longitude: activeLocation.longitude,
                              }
                            : null);
                      setDrafPeta(awal);
                      setPilihOpen(true);
                    }}
                    icon={<MapPin className="w-4 h-4" />}
                  >
                    Pilih di Peta
                  </ActionButton>
                </div>
                {koordinatSementara && (
                  <button
                    type="button"
                    onClick={() => setKoordinatSementara(null)}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Kembali ke titik tersimpan
                  </button>
                )}

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">Jarak ke titik server</span>
                    <span
                      className={`font-semibold ${
                        geofence.distance === null
                          ? 'text-slate-400 dark:text-slate-500'
                          : geofence.withinRadius
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {geofence.distance === null
                        ? '—'
                        : `${Math.round(geofence.distance).toLocaleString('id-ID')} m`}
                    </span>
                  </div>
                  {koordinat && !geofence.withinRadius && (
                    <p className="text-amber-600 dark:text-amber-400">
                      Di luar radius {geofence.radius} m; keputusan tetap ditentukan server.
                    </p>
                  )}
                </div>
              </div>
            </Field>

            <Field label="Work Code">
              <Dropdown
                value={workCodeId}
                onChange={value => {
                  setWorkCodeId(value);
                  setDialogAbsenOpen(false);
                }}
                opsi={[
                  { value: '', label: '— Pilih work code —', disabled: true },
                  ...workCodes.map(code => {
                    const jam = code.jam;
                    const potong = (v?: string) => (v && v.length >= 5 ? v.slice(0, 5) : '--:--');
                    // Work code EVENT bisa punya batas kosong; tampilkan
                    // "—" daripada "--:--" yang terbaca seperti error.
                    return {
                      value: String(code.id),
                      label: code.nama,
                      hint: `${potong(jam.jam_masuk)} – ${potong(jam.jam_keluar)} · buka ${potong(
                        jam.jam_masuk_awal
                      )} · tutup ${potong(jam.jam_keluar_akhir)}`,
                    };
                  }),
                ]}
                placeholder="— Pilih work code —"
                disabled={workCodes.length === 0}
                searchable
                aria-label="Work code"
              />
            </Field>

            <Field label="Jenis Absensi">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {CHECK_TYPES.map(item => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      setCheckType(item.value);
                      setDialogAbsenOpen(false);
                    }}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      checkType === item.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{item.label}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">{item.hint}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Mode Kerja">
              <Checkbox
                checked={isWfh}
                disabled={!hariWfh}
                onChange={checked => {
                  setIsWfh(checked);
                  setDialogAbsenOpen(false);
                }}
                label="Absen dari rumah (WFH)"
              />
            </Field>

            <Field label="Serta Pengajuan Izin">
              <Checkbox
                checked={kirimIjin}
                onChange={checked => {
                  setKirimIjin(checked);
                  setDialogAbsenOpen(false);
                }}
                label="Kirim izin bersama absensi ini"
              />
            </Field>

            {kirimIjin && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Tipe Izin" className="sm:col-span-1">
                  <Dropdown
                    value={typeIjin}
                    onChange={value => {
                      setTypeIjin(value);
                      setDialogAbsenOpen(false);
                    }}
                    opsi={TIPE_IJIN_OPTIONS.map(([value, label]) => ({
                      value,
                      label: `${value} — ${label}`,
                    }))}
                    aria-label="Tipe izin"
                  />
                </Field>
                <Field label="Keterangan" className="sm:col-span-2">
                  <Input
                    value={keterangan}
                    onChange={event => setKeterangan(event.target.value.slice(0, 255))}
                    placeholder="Alasan singkat izin hari ini"
                  />
                </Field>
              </div>
            )}

            {!koordinat ? (
              <Alert tone="rose">
                Pilih titik absen di peta sebelum melakukan absensi.
              </Alert>
            ) : !tabPermissions.aksiAbsen ? (
              <Alert tone="amber">Akun Anda tidak memiliki hak untuk melakukan absensi.</Alert>
            ) : null}

            <div className="space-y-2.5">
              <ActionButton
                block
                size="md"
                // Tiga syarat nyata: hak akses, work code, dan koordinat.
                // Jam TIDAK lagi menjadi syarat.
                disabled={!tabPermissions.aksiAbsen || !workCodeId || !koordinat}
                onClick={handleAbsen}
                icon={<Fingerprint className="w-5 h-5" />}
              >
                Absen
              </ActionButton>
            </div>
          </div>
        </Card>

        {/* ── Riwayat absensi hari ini ─────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardTitle>Riwayat Absensi Hari Ini</CardTitle>
            {loading ? (
              <SkeletonList rows={4} />
            ) : history.length === 0 ? (
              <EmptyState message="Belum ada riwayat absensi untuk hari ini." />
            ) : (
              <div className="space-y-2">
                {history.map((row, index) => (
                  <div
                    key={`${row.waktu}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                        {row.nama || pegawai.nama}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        {jamTampil(row.waktu) ?? '-'} · {row.jarak || '-'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <Badge tone={isCheckType(row.checktype, ABSEN_CHECK_TYPE.DATANG) ? 'blue' : 'violet'}>
                        {labelCheckType(row.checktype)}
                      </Badge>
                      {row.approval_text && <Badge tone={row.approval ? 'emerald' : 'amber'}>{row.approval_text}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Dialog konfirmasi ───────────────────────────────────── */}
      {dialogAbsenOpen && (
        <Modal
          open
          onClose={() => setDialogAbsenOpen(false)}
          size="md"
          title={`Konfirmasi ${labelCheckType(String(checkType))}`}
          icon={<ShieldCheck className="w-5 h-5 text-blue-500" />}
          footer={
            <div className="flex justify-end gap-2">
              <ActionButton
                variant="ghost"
                onClick={() => setDialogAbsenOpen(false)}
                icon={<XCircle className="w-4 h-4" />}
              >
                Batal
              </ActionButton>
              <ActionButton
                loading={submitting}
                className="flex-1 min-w-0"
                onClick={() => void submitAbsen()}
                icon={<CheckCircle2 className="w-4 h-4" />}
              >
                Absen
              </ActionButton>
            </div>
          }
        >
          <div className="space-y-4">
              {errorAbsen && <Alert tone="rose">{errorAbsen}</Alert>}

              <div className="space-y-2 text-sm">
                <ConfirmRow label="Waktu" value={`${getNowWIBTime().slice(0, 8)} WIB`} />
                <ConfirmRow label="Work Code" value={selectedWorkCode?.nama ?? '-'} />
                <ConfirmRow label="Tipe" value={labelCheckType(String(checkType))} />
                <ConfirmRow label="Titik Absen" value={titikPakai?.nama ?? '-'} />
                <ConfirmRow
                  label="Koordinat"
                  value={koordinat ? `${koordinat.latitude.toFixed(6)}, ${koordinat.longitude.toFixed(6)}` : '-'}
                />
                <ConfirmRow
                  label="Jarak ke Titik Server"
                  value={geofence.distance !== null ? `${Math.round(geofence.distance).toLocaleString('id-ID')} m` : '-'}
                />
                <ConfirmRow label="WFH" value={isWfh ? 'Ya' : 'Tidak'} />
                {kirimIjin && <ConfirmRow label="Izin" value={TIPE_IJIN_LABEL[typeIjin] ?? typeIjin} />}
              </div>

          </div>
        </Modal>
      )}

      {/* ── Peta pemilih koordinat ─────────────────────────────── */}
      {pilihOpen && (
        <Modal
          open
          onClose={() => {
            setPilihOpen(false);
            setDrafPeta(null);
          }}
          size="lg"
          title="Pilih Titik Absen"
          footer={
            <div className="flex w-full items-center justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {drafPeta
                  ? `${drafPeta.latitude.toFixed(6)}, ${drafPeta.longitude.toFixed(6)}`
                  : 'Pilih koordinat'}
              </span>
              <div className="flex shrink-0 gap-2">
                <ActionButton
                  variant="ghost"
                  onClick={() => {
                    setPilihOpen(false);
                    setDrafPeta(null);
                  }}
                >
                  Batal
                </ActionButton>
                <ActionButton
                  variant="primary"
                  disabled={!drafPeta}
                  onClick={() => {
                    if (!drafPeta) return;
                    setKoordinatSementara(drafPeta);
                    setDrafPeta(null);
                    setPilihOpen(false);
                    setDialogAbsenOpen(false);
                  }}
                >
                  Gunakan sementara
                </ActionButton>
              </div>
            </div>
          }
        >
          <div className="aspect-square w-full overflow-hidden rounded-xl">
            <PetaAbsen
              titik={titikPeta}
              draggableId={drafPeta ? '__draf__' : null}
              onKlikPeta={koordinat => {
                setDrafPeta(koordinat);
                setDialogAbsenOpen(false);
              }}
              onGeser={(_id, koordinat) => setDrafPeta(koordinat)}
              fokus={drafPeta}
              height="100%"
            />
          </div>
        </Modal>
      )}

    </div>
  );
}

function ConfirmRow({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'rose' }) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'rose'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-slate-700 dark:text-slate-200';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-xs font-semibold text-right truncate ${color}`}>{value}</span>
    </div>
  );
}
