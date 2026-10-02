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
  LoadingBlock,
  PageHeader,
  StatTile,
} from '../components/ui/Surface';
import {
  rpcAbsen,
  rpcCekAbsen,
  rpcGetLokasiAbsen,
  rpcGetWorkCode,
  rpcHistoryAbsen,
  type CekAbsenResult,
  type HistoryAbsenModel,
  type LokasiView,
  type WorkCodeView,
} from '../lib/apiCalls';
import { getNowWIBTime, getTodayWIB, timeToMinutes } from '../lib/dateFormatter';
import { ABSEN_CHECK_TYPE, TIPE_IJIN_LABEL } from '../lib/presensiContract';
import { checkGeofence } from '../lib/geo';
import { isCheckType, jamTampil, labelCheckType, pilihWorkCodeUntukHari } from '../lib/viewModels';
import PetaAbsen, { type TitikPeta } from '../components/ui/PetaAbsen';
import {
  bacaTitik,
  setTitikAktif,
  simpanTitik,
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

  useEffect(() => {
    setTitikSaya(bacaTitik(username));
  }, [username]);

  // ── Percakapan konfirmasi ───────────────────────────────────────
  const [cek, setCek] = useState<CekAbsenResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /**
   * Batas akhir konfirmasi absensi (epoch ms).
   *
   * Diisi setelah `cekabsen` membolehkan absensi, memakai `absen_timeout`
   * dari `login`. Sifatnya seperti `PendingAttendanceResult` di aplikasi
   * Android: jendela konfirmasi punya masa berlaku, dan lewatnya jendela
   * membuat `absen` ditolak.
   */
  const [konfirmasiBerlaku, setKonfirmasiBerlaku] = useState<number | null>(null);
  /** Detik berjalan — hanya untuk menghitung mundur. */
  const [detik, setDetik] = useState(0);

  // Detik untuk hitung mundur konfirmasi absensi.
  useEffect(() => {
    if (konfirmasiBerlaku === null) return;
    const timer = setInterval(() => setDetik(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [konfirmasiBerlaku]);

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
          radius: 100,
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
   * sebelumnya belum ada titik, sehingga tombol "Cek Absensi" tetap terkunci
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
      titikPakai
        ? { latitude: titikPakai.latitude, longitude: titikPakai.longitude }
        : null,
    [titikPakai]
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

  const nowMinutes = timeToMinutes(getNowWIBTime().slice(0, 5)) ?? 0;
  const batasMasuk = timeToMinutes(schedule?.jam.jam_masuk_awal ?? null);
  const batasKeluar = timeToMinutes(schedule?.jam.jam_keluar_akhir ?? null);

  // WFH hanya diizinkan hari Jumat.
  const hariWfh =
    new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' })
      .format(new Date(`${today}T00:00:00Z`))
      .toLowerCase() === 'jumat';

  /**
   * Apakah waktu sekarang berada di dalam rentang jam kerja work code.
   *
   * ⚠️ INI PURELY INFORMATIF — tidak pernah memblokir absensi.
   *
   * Dulu gate ini mematikan tombol "Cek Absensi" di luar jam kerja. Itu
   * salah untuk dua alasan:
   *
   * 1. **Server adalah satu-satunya penentu.** `absen` dan `cekabsen` tidak
   *    pernah menerima jam sebagai param — penentuannya 100% di sisi
   *    server. Menolak lebih awal di klien hanya menebak-nebak, dan
   *    menebak-nebak keliru berarti absensi yang sah jadi tidak bisa
   *    dikirim.
   * 2. `jam_masuk_awal` bisa `null` / `"00:00:00"` untuk work code
   *    EVENT, sehingga gate lama ikut mematikan absensi pada hari dengan
   *    jadwal tidak lazim.
   *
   * Sekarang rentang ini hanya ditampilkan sebagai informasi, dan
   * `server` yang memutuskan. Kalau server menolak, pesannya tampil
   * apa adanya di dialog konfirmasi.
   */
  const dalamRentangJam =
    checkType === ABSEN_CHECK_TYPE.PULANG
      ? batasKeluar === null || nowMinutes <= batasKeluar
      : batasMasuk === null || nowMinutes >= batasMasuk;

  /**
   * Rentang jam kerja work code, mis. "06:30 – 17:00".
   *
   * Keterangan saja. Untuk work code EVENT yang jamnya kosong, teksnya
   * "tidak ditentukan" — bukan "–", supaya tidak terbaca seperti error.
   */
  const rentangJam = useMemo(() => {
    const jam = schedule?.jam;
    const potong = (v?: string) => (v && v.length >= 5 ? v.slice(0, 5) : '');
    if (checkType === ABSEN_CHECK_TYPE.PULANG) {
      const tutup = potong(jam?.jam_keluar_akhir) || potong(jam?.jam_keluar);
      return tutup ? `sampai ${tutup}` : 'tidak ditentukan';
    }
    const buka = potong(jam?.jam_masuk_awal) || potong(jam?.jam_masuk);
    return buka ? `sejak ${buka}` : 'tidak ditentukan';
  }, [schedule, checkType]);

  // ── Langkah 1: cek ke server ─────────────────────────────────────
  const handleCek = async () => {
    setError(null);
    if (!workCodeId) {
      setError('Work Code wajib dipilih — server menolak tanpa itu.');
      return;
    }
    if (!koordinat) {
      setError('Koordinat belum dipilih. Pilih titik di peta lebih dulu.');
      return;
    }
    setChecking(true);
    try {
      const result = await rpcCekAbsen(context, {
        checkType,
        workCode: workCodeId,
        isWfh,
      });
      if (result === null) {
        setError('Server pusat tidak menjawab pengecekan absensi.');
        return;
      }
      setCek(result);
      // `absen_timeout` dari `login` (= 300.000 ms secara default) adalah
      // masa berlaku konfirmasi ini. Kalau sudah lewat, window-nya
      // kedaluwarsa dan `absen` kemungkinan ditolak — jadi peringatkan
      // lebih awal daripada membiarkan server menolak butanya.
      if (result.absen) {
        setKonfirmasiBerlaku(Date.now() + (pegawai?.absenTimeout ?? 300_000));
      } else {
        setKonfirmasiBerlaku(null);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Gagal mengecek absensi ke server pusat.');
    } finally {
      setChecking(false);
    }
  };

  // Sisa waktu konfirmasi dalam detik, dihitung tiap detik.
  const sisaKonfirmasi = useMemo(() => {
    if (!konfirmasiBerlaku) return null;
    return Math.max(0, Math.ceil((konfirmasiBerlaku - Date.now()) / 1000));
  }, [konfirmasiBerlaku, detik]);

  const konfirmasiKedaluwarsa = konfirmasiBerlaku !== null && sisaKonfirmasi === 0;

  // ── Langkah 2: kirim absensi ─────────────────────────────────────
  const submitAbsen = async () => {
    setError(null);
    if (!workCodeId) {
      setError('Work Code wajib dipilih — server menolak tanpa itu.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await rpcAbsen(context, {
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
        setError('Server pusat menolak absensi. Periksa lokasi, jam kerja, dan duplikasi absen.');
        return;
      }
      if (result.absen === false) {
        setError(result.message || 'Server menolak absensi ini.');
        setCek({ absen: false, message: result.message ?? '' });
        return;
      }

      toast.success(`Absen ${labelCheckType(String(checkType))} tercatat pada ${getNowWIBTime().slice(0, 5)} WIB.`);
      setCek(null);
      setKeterangan('');
      setKirimIjin(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message ?? 'Gagal mengirim absensi ke server pusat.');
    } finally {
      setSubmitting(false);
    }
  };

  // Tombol kembali menutup dialog konfirmasi lebih dulu.
  useBackButton(
    cek !== null,
    () => {
      if (!cek) return false;
      setCek(null);
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
          <ActionButton variant="ghost" size="sm" onClick={() => void loadData()} icon={<RefreshCw className="w-4 h-4" />}>
            Muat Ulang
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
          value={titikPakai ? 'Titik Peta' : 'Belum Ada'}
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
                dikirim apa adanya sebagai `last_latlong` ke cekabsen
                dan absen. */}
            <Field
              label="Koordinat Absen"
              hint="Dikirim sebagai last_latlong. Pilih titik di peta, lalu geser penandanya untuk menyetel posisi."
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Dropdown
                      value={titikPakai?.id ?? ''}
                      onChange={value => {
                        setTitikAktif(username, value);
                        setTitikSaya(prev =>
                          prev.map(item => ({ ...item, dipakai: item.id === value }))
                        );
                        // `context.lastLatLong` ikut segar sekarang juga, bukan
                        // menunggu polling 5 detik — kalau tidak, klik "Cek
                        // Absensi" sesaat setelah ini mengirim koordinat lama.
                        segarkanTitik();
                        setCek(null);
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
                    onClick={() => setPilihOpen(true)}
                    icon={<MapPin className="w-4 h-4" />}
                  >
                    Pilih di Peta
                  </ActionButton>
                </div>

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
                      Titik ini di luar radius ({geofence.radius} m). Server tetap mungkin
                      menerima, tetapi jarak akan tercatat pada riwayat.
                    </p>
                  )}
                </div>
              </div>
            </Field>

            <Field
              label="Work Code"
              hint="Wajib — server membalas 'Work Kode wajib dipilih' bila kosong. Nilai dikirim apa adanya dari getworkcode."
            >
              <Dropdown
                value={workCodeId}
                onChange={value => {
                  setWorkCodeId(value);
                  setCek(null);
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

            <Field label="Jenis Absensi" hint="Dikirim sebagai parameter `checktype`.">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {CHECK_TYPES.map(item => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      setCheckType(item.value);
                      setCek(null);
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

            <Field
              label="Mode Kerja"
              hint={
                hariWfh
                  ? 'Hari Jumat — Work-From-Home boleh dipilih (iswfh = 1).'
                  : 'Work-From-Home hanya diizinkan hari Jumat; server menolak iswfh = 1 pada hari lain.'
              }
            >
              <Checkbox
                checked={isWfh}
                disabled={!hariWfh}
                onChange={checked => {
                  setIsWfh(checked);
                  setCek(null);
                }}
                label="Absen dari rumah (WFH)"
              />
            </Field>

            <Field
              label="Serta Pengajuan Izin"
              hint="Object absen juga menerima pengajuan izin pada panggilan yang sama lewat parameter ijin, type_ijin, dan keterangan."
            >
              <Checkbox
                checked={kirimIjin}
                onChange={checked => {
                  setKirimIjin(checked);
                  setCek(null);
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
                      setCek(null);
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
                Belum ada titik absen. Pilih koordinat lewat tombol &ldquo;Pilih di Peta&rdquo; di
                atas — server membutuhkan koordinat untuk mencatat absensi.
              </Alert>
            ) : !tabPermissions.aksiAbsen ? (
              <Alert tone="amber">Akun Anda tidak memiliki hak untuk melakukan absensi.</Alert>
            ) : (
              /*
               * ⚠️ Di luar jam kerja tetap BISA absen — server yang
               * menentukan. Jadwal work code hanya ditampilkan sebagai
               * informasi, tidak dipakai memblokir.
               *
               * Karena itu nadanya bukan peringatan di kedua sisi:
               *
               * - `emerald` (centang) saat **di dalam** rentang. Ini kabar
               *   baik: waktu sekarang wajar, tidak ada hal yang perlu diketahui
               *   pengguna selain waktunya. Kalau nada ini amber/biru,
               *   setiap absensi normal terlihat seperti ada masalah.
               * - `amber` (perhatian) saat **di luar** rentang. Bukan
               *   larangan — teksnya sudah menjelaskan itu — tapi memang
               *   perlu disebut supaya orang tidak kaget saat server menolak.
               */
              <Alert tone={dalamRentangJam ? 'emerald' : 'amber'}>
                Waktu sekarang{' '}
                <span className="font-mono">{getNowWIBTime().slice(0, 5)} WIB</span>
                {schedule ? ` · jadwal ${schedule.nama}` : ''}
                {dalamRentangJam
                  ? ' berada di dalam rentang jam kerja.'
                  : ` di luar rentang jam kerja (${rentangJam}). Server tetap yang memutuskan — penolakan bila ada akan muncul di dialog konfirmasi.`}
              </Alert>
            )}

            <div className="space-y-2.5">
              <ActionButton
                block
                size="lg"
                loading={checking}
                // Tiga syarat nyata: hak akses, work code, dan koordinat.
                // Jam TIDAK lagi menjadi syarat.
                disabled={!tabPermissions.aksiAbsen || !workCodeId || !koordinat}
                onClick={handleCek}
                icon={<Fingerprint className="w-5 h-5" />}
              >
                Cek Absensi
              </ActionButton>
            </div>
          </div>
        </Card>

        {/* ── Riwayat absensi hari ini ─────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardTitle>Riwayat Absensi Hari Ini</CardTitle>
            {loading ? (
              <LoadingBlock />
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
      {cek && (
        <Modal
          open
          onClose={() => setCek(null)}
          size="md"
          title={`Konfirmasi ${labelCheckType(String(checkType))}`}
          icon={<ShieldCheck className="w-5 h-5 text-blue-500" />}
          footer={
            <div className="flex gap-2">
              <ActionButton
                variant="ghost"
                block
                onClick={() => setCek(null)}
                icon={<XCircle className="w-4 h-4" />}
              >
                Batal
              </ActionButton>
              <ActionButton
                block
                loading={submitting}
                // ⚠️ Hanya `cek.absen` yang memblokir — server sudah
                // menyatakan boleh atau tidak lewat `cekabsen`.
                //
                // Masa berlaku konfirmasi (`absen_timeout`) sengaja TIDAK
                // dipakai untuk menonaktifkan tombol: field itu dari
                // `login` dan belum terverifikasi bahwa server memakainya
                // untuk menolak. Menonaktifkan di sini berisiko memblokir
                // absensi yang sebenarnya sah, jadi cukup diperingatkan
                // (lihat Alert di atas).
                disabled={!cek.absen}
                onClick={() => void submitAbsen()}
                icon={<CheckCircle2 className="w-4 h-4" />}
              >
                Kirim
              </ActionButton>
            </div>
          }
        >
          <div className="space-y-4">
              {cek.message && (
                /*
                 * Ikonnya sekarang berasal dari `Alert` sendiri, lewat
                 * `tone`. Versi ini menaruh `AlertTriangle`/`XCircle` di
                 * dalam `children` — jadi segitiga peringatan tampil dua
                 * kali, persis di baris yang paling perlu dibaca dengan
                 * tenang (hasil "Cek Absensi").
                 */
                <Alert tone={cek.absen ? 'amber' : 'rose'}>{cek.message}</Alert>
              )}

              <div className="space-y-2 text-sm">
                <ConfirmRow label="Waktu" value={`${getNowWIBTime().slice(0, 8)} WIB`} />
                <ConfirmRow label="Work Code" value={selectedWorkCode?.nama ?? '-'} />
                <ConfirmRow label="Tipe" value={cek.kode ?? labelCheckType(String(checkType))} />
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

              {/* Masa berlaku konfirmasi — berasal dari `absen_timeout`
                  di `login`, sama seperti `PendingAttendanceResult`
                  (Valid / Expired) pada aplikasi Android.

                  ⚠️ INI KETERANGAN SAJA, bukan blokir. `absen_timeout`
                  belum terverifikasi dipakai server untuk menolak, jadi
                  tombol Kirim sengaja tetap aktif. Kalau ternyata
                  ditolak, pesan server tampil apa adanya di sini. */}
              {sisaKonfirmasi !== null &&
                (konfirmasiKedaluwarsa ? (
                  <Alert tone="amber">
                        Konfirmasi sudah lewat{' '}
                        {Math.round((pegawai?.absenTimeout ?? 300_000) / 1000)} detik menurut{' '}
                        <span className="font-mono">absen_timeout</span>. Anda
                        tetap bisa mencoba — server yang menentukan. Kalau ditolak, tekan
                        &ldquo;Cek Absensi&rdquo; lagi.
                  </Alert>
                ) : (
                  <Alert tone="blue">
                    Sisa waktu konfirmasi{' '}
                    <span className="font-mono">{formatSisaDetik(sisaKonfirmasi)}</span> — dari{' '}
                    <span className="font-mono">absen_timeout</span> pada <span className="font-mono">login</span>.
                  </Alert>
                ))}
          </div>
        </Modal>
      )}

      {/* ── Peta pemilih koordinat ─────────────────────────────── */}
      {pilihOpen && (
        <Modal open onClose={() => setPilihOpen(false)} size="xl" title="Pilih Titik Absen">
          <div className="space-y-3">
            <Alert tone="blue">
              Klik peta untuk menandai koordinat, lalu geser penandanya untuk menempatkan titik
              sedekat mungkin dengan kantor. Koordinat yang dipakai inilah yang dikirim ke server
              sebagai <span className="font-mono">last_latlong</span> — GPS tidak diperlukan.
            </Alert>

            <PetaAbsen
              titik={titikPeta}
              draggableId={drafPeta ? '__draf__' : null}
              onKlikPeta={koordinat => {
                setDrafPeta(koordinat);
                setCek(null);
              }}
              onGeser={(_id, koordinat) => setDrafPeta(koordinat)}
              fokus={
                drafPeta
                  ? { latitude: drafPeta.latitude, longitude: drafPeta.longitude }
                  : titikPakai
                    ? { id: titikPakai.id }
                    : activeLocation
                      ? { id: `server-${activeLocation.id}` }
                      : null
              }
              height="440px"
            />

            {titikSaya.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Titik Tersimpan
                </p>
                <div className="flex flex-wrap gap-2">
                  {titikSaya.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setTitikAktif(username, item.id);
                        setTitikSaya(prev =>
                          prev.map(x => ({ ...x, dipakai: x.id === item.id }))
                        );
                        segarkanTitik();
                        setCek(null);
                        setPilihOpen(false);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-colors ${
                        item.dipakai
                          ? 'border-violet-400 dark:border-violet-500/50 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {item.nama}
                      <span className="ml-1.5 font-mono opacity-60">
                        {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                variant="secondary"
                onClick={() => {
                  if (!drafPeta) return;
                  /*
                   * `simpanTitik` menerima daftar, bukan satu titik — jadi
                   * titik lama ikut ditulis ulang. Baris di bawah memastikan
                   * hanya titik baru yang ditandai "dipakai": kalau tidak,
                   * dua titik bisa sama-sama aktif dan `bacaTitikAktif`
                   * akan mengembalikan yang mana saja depending urutan.
                   */
                  const baru: TitikAbsen = {
                    id: `t${Date.now().toString(36)}`,
                    nama: `Titik ${titikSaya.length + 1}`,
                    latitude: drafPeta.latitude,
                    longitude: drafPeta.longitude,
                    dipakai: true,
                    dibuatPada: Date.now(),
                  };
                  const daftar = simpanTitik(username, [
                    ...titikSaya.map(item => ({ ...item, dipakai: false })),
                    baru,
                  ]);
                  setTitikSaya(daftar);
                  setDrafPeta(null);
                  segarkanTitik();
                  setCek(null);
                }}
                disabled={!drafPeta}
              >
                Simpan sebagai titik baru
              </ActionButton>
              {drafPeta && (
                <ActionButton variant="ghost" onClick={() => setDrafPeta(null)}>
                  Batalkan draf
                </ActionButton>
              )}
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}

/** "4:59" untuk sisa waktu konfirmasi absensi. */
function formatSisaDetik(detik: number): string {
  const menit = Math.floor(detik / 60);
  const sisa = detik % 60;
  return `${menit}:${String(sisa).padStart(2, '0')}`;
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
