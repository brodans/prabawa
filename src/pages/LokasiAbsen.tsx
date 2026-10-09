import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Star, Trash2, X } from 'lucide-react';
import { useServerContext } from '../hooks/useServerContext';
import { useToast } from '../components/ui/Toast';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  SkeletonList,
} from '../components/ui/Surface';
import PetaAbsen, { type TitikPeta } from '../components/ui/PetaAbsen';
import { ConfirmDialog } from '../components/ui/Modal';
import { rpcGetLokasiAbsen, type LokasiView } from '../lib/apiCalls';
import { checkGeofence } from '../lib/geo';
import {
  bacaTitik,
  bersihkanSemua,
  clearTitikAktif,
  hapusTitik,
  jadikanAktif,
  setTitikAktif,
  tambahTitik,
  type TitikAbsen,
} from '../lib/lokasiTersimpan';
import { buangTitikLegacy } from '../lib/lokasiTersimpan';
import { useAppContext } from '../context/AppContext';

/** Batas jumlah titik agar localStorage tidak membengkak. */
const MAX_TITIK = 40;

/** Kepresisian penulisan koordinat saat menyunting. */
const KOORD_DESIMAL = 6;

/**
 * Halaman Lokasi Absen.
 *
 * Peta Leaflet terpusat pada titik kantor yang terdaftar di server
 * (`getlokasiabsen`). Menambah titik langsung dari peta: klik lokasi,
 * geser penandanya, lalu simpan. Titik yang ditandai "Pakai" menjadi
 * koordinat `last_latlong` yang dikirim ke `absen` dan `cekabsen`.
 *
 * Server tidak menyediakan endpoint untuk menambah atau memindahkan titik,
 * jadi titik yang dibuat di sini tersimpan di peramban saja. Yang
 * menentukan geofence tetap titik milik server.
 */
export default function LokasiAbsen() {
  const { currentUser } = useAppContext();
  const { context, ready, titikAbsen, segarkanTitik } = useServerContext();
  const toast = useToast();

  // Titik milik **akun ini saja**. Dulu kuncinya global, jadi seluruh akun
  // yang bergantian di peramban yang sama berbagi satu daftar — dan satu
  // orang bisa absen memakai titik milik orang lain.
  const username = currentUser?.username ?? '';

  const [locations, setLocations] = useState<LokasiView[]>([]);
  const [milikSaya, setMilikSaya] = useState<TitikAbsen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Mode peta ────────────────────────────────────────────────────
  const [terpilih, setTerpilih] = useState<string | null>(null);
  const [draf, setDraf] = useState<{ latitude: string; longitude: string; nama: string } | null>(
    null
  );
  const [konfirmasiBersihkan, setKonfirmasiBersihkan] = useState(false);

  const loadData = useCallback(async () => {
    if (!ready) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setLocations(await rpcGetLokasiAbsen(context));
    } catch (err: any) {
      setError(err?.message ?? 'Gagal memuat daftar lokasi absen.');
    } finally {
      setLoading(false);
    }
  }, [context, ready]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Muat ulang saat ganti akun. `bacaTitik(username)` mengembalikan `[]` untuk
  // akun tanpa titik, jadi daftar lama langsung hilang.
  useEffect(() => {
    setMilikSaya(bacaTitik(username));
    // Buang kunci lama yang menyimpan titik BERSAMA antar akun. Sekali saja
    // per buka halaman — tidak dipindahkan ke akun mana pun, karena
    // data bersama tidak bisa diketahui milik siapa.
    buangTitikLegacy();
  }, [username]);

  // ── Titik untuk peta ─────────────────────────────────────────────
  // Titik server pakai radius asli dari server. Titik milik pengguna
  // tidak punya radius — yang menentukan jarak tetap titik server.
  const drafLatitude = draf?.latitude ?? null;
  const drafLongitude = draf?.longitude ?? null;
  const drafAktif = draf !== null;
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
        aktif: terpilih === `server-${item.id}`,
      }));

    const lokal: TitikPeta[] = milikSaya.map(item => ({
      id: item.id,
      nama: item.nama,
      latitude: item.latitude,
      longitude: item.longitude,
      radius: 0,
      dariServer: false,
      aktif: item.dipakai,
    }));

    const drafTitik: TitikPeta[] = drafAktif
      ? [
          {
            id: '__draf__',
            nama: 'Lokasi baru',
            latitude: Number(drafLatitude),
            longitude: Number(drafLongitude),
            radius: 0,
            dariServer: false,
            aktif: true,
          },
        ]
      : [];

    return [...server, ...lokal, ...drafTitik];
  }, [locations, milikSaya, terpilih, drafAktif, drafLatitude, drafLongitude]);

  // Fokus awal: titik kantor server, atau titik yang sedang dipakai.
  const fokusAwal = useMemo(
    () => (titikAbsen ? { id: titikAbsen.id } : (locations[0] ? { id: `server-${locations[0].id}` } : null)),
    [titikAbsen, locations]
  );

  // ── Aksi titik ──────────────────────────────────────────────────
  const mulaiDraf = (seed: { latitude: number; longitude: number; nama?: string }) => {
    setDraf({
      latitude: seed.latitude.toFixed(KOORD_DESIMAL),
      longitude: seed.longitude.toFixed(KOORD_DESIMAL),
      nama: seed.nama ?? '',
    });
    setTerpilih('__draf__');
  };

  const geserTitik = (_id: string, koordinat: { latitude: number; longitude: number }) => {
    setDraf(prev =>
      prev
        ? {
            ...prev,
            latitude: koordinat.latitude.toFixed(KOORD_DESIMAL),
            longitude: koordinat.longitude.toFixed(KOORD_DESIMAL),
          }
        : prev
    );
  };

  const simpanDraf = () => {
    if (!draf) return;
    const latitude = Number(draf.latitude);
    const longitude = Number(draf.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      toast.error('Latitude dan longitude harus berupa angka.');
      return;
    }
    if (latitude < -90 || latitude > 90) {
      toast.error('Latitude harus antara -90 dan 90.');
      return;
    }
    if (longitude < -180 || longitude > 180) {
      toast.error('Longitude harus antara -180 dan 180.');
      return;
    }
    if (milikSaya.length >= MAX_TITIK) {
      toast.error(`Maksimal ${MAX_TITIK} titik. Hapus yang lama dulu.`);
      return;
    }

    const entry = tambahTitik(username, {
      nama: draf.nama.trim() || `Titik ${milikSaya.length + 1}`,
      latitude,
      longitude,
      dipakai: false,
    });
    setMilikSaya(entry);
    setDraf(null);
    setTerpilih(null);
    toast.success('Titik disimpan di perangkat ini.');
  };

  const pakai = (id: string) => {
    setTitikAktif(username, id);
    setMilikSaya(prev => prev.map(item => ({ ...item, dipakai: item.id === id })));
    // Segarkan juga koordinat yang disuntik ke panggilan berikutnya. Tanpa
    // ini, `context.lastLatLong` masih koordinat lama sampai polling 5 detik
    // selesai — jadi navigasi ke Presensi dan langsung absen bisa mengirim
    // titik sebelumnya.
    segarkanTitik();
    const nama = milikSaya.find(item => item.id === id)?.nama ?? 'Titik';
    toast.success(`"${nama}" menjadi koordinat absen di halaman Presensi.`);
  };

  const pakaiTitikServer = (location: LokasiView) => {
    // Titik server bisa langsung dipakai sebagai koordinat absen dengan
    // menyalinnya ke daftar lokal — tidak perlu mengetik koordinat.
    // `jadikanAktif` menyalin titik kalau belum ada, lalu menandainya.
    // `tambahTitik` + `setTitikAktif` terpisah bisa menyisakan dua titik
    // "dipakai" kalau salah satunya gagal di tengah jalan.
    const entry = jadikanAktif(username, {
      nama: location.nama || location.satuanKerja || `Titik ${location.id}`,
      latitude: location.latitude as number,
      longitude: location.longitude as number,
      dipakai: true,
    });
    setMilikSaya(entry);
    segarkanTitik();
    toast.success('Titik kantor disalin ke daftar dan langsung dipakai untuk absensi.');
  };

  const hapus = (id: string) => {
    setMilikSaya(hapusTitik(username, id));
    if (terpilih === id) setTerpilih(null);
    if (titikAbsen?.id === id) clearTitikAktif(username);
    toast.success('Titik dihapus dari daftar akun ini.');
  };

  const bersihkan = () => {
    setKonfirmasiBersihkan(false);
    // Hanya titik akun ini. `bersihkanSemua()` tanpa username menghapus kunci
    // global — yang justru menjadi bug aslinya.
    bersihkanSemua(username);
    setMilikSaya([]);
    setTerpilih(null);
    toast.success('Semua titik lokal akun ini dihapus.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lokasi Absen"
        subtitle="Pilih koordinat absen langsung di peta"
        icon={<Building2 className="w-5 h-5" />}
      />

      {error && <Alert tone="rose">{error}</Alert>}

      {/* ── Peta ─────────────────────────────────────────────────── */}
      <Card>
        <CardTitle
          action={
            <Badge tone={titikAbsen ? 'emerald' : 'slate'}>
              {titikAbsen ? `Dipakai: ${titikAbsen.nama}` : 'Belum ada titik dipakai'}
            </Badge>
          }
        >
          Peta Titik Absen
        </CardTitle>

        <div className="flex flex-wrap items-center gap-4 mb-3 text-[11px] text-slate-500 dark:text-slate-400">
          <LegendSwatch color="bg-emerald-500" label="Titik server" />
          <LegendSwatch color="bg-violet-500" label="Titik Anda" />
          <LegendSwatch color="bg-blue-600" label="Sedang disunting" />
          <span className="ml-auto">Klik peta untuk menambah titik</span>
        </div>

        {loading && locations.length === 0 ? (
          <Skeleton className="h-[480px] w-full rounded-xl" />
        ) : (
          <PetaAbsen
            titik={titikPeta}
            draggableId={draf ? '__draf__' : null}
            onGeser={geserTitik}
            onKlikPeta={koordinat => mulaiDraf(koordinat)}
            onPilih={setTerpilih}
            fokus={
              terpilih === '__draf__'
                ? { id: '__draf__' }
                : terpilih
                  ? { id: terpilih }
                  : fokusAwal
            }
            height="480px"
          />
        )}

        {draf && (
          <div className="mt-4 p-4 rounded-2xl border border-blue-200 dark:border-blue-500/40 bg-blue-50/50 dark:bg-blue-500/5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Lokasi Baru
              </p>
              <button
                type="button"
                onClick={() => {
                  setDraf(null);
                  setTerpilih(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                aria-label="Batal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Nama" className="sm:col-span-3">
                <Input
                  value={draf.nama}
                  onChange={event =>
                    setDraf(prev => (prev ? { ...prev, nama: event.target.value.slice(0, 60) } : prev))
                  }
                  placeholder="mis. Lobby Kantor, Gerbang Timur, Area Parkir"
                />
              </Field>
              <Field label="Latitude">
                <Input
                  value={draf.latitude}
                  onChange={event =>
                    setDraf(prev => (prev ? { ...prev, latitude: event.target.value } : prev))
                  }
                  className="font-mono"
                  inputMode="decimal"
                />
              </Field>
              <Field label="Longitude">
                <Input
                  value={draf.longitude}
                  onChange={event =>
                    setDraf(prev => (prev ? { ...prev, longitude: event.target.value } : prev))
                  }
                  className="font-mono"
                  inputMode="decimal"
                />
              </Field>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Geser penanda di peta untuk menyetel titik, lalu simpan.
            </p>

            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={simpanDraf} icon={<Plus className="w-4 h-4" />}>
                Simpan Titik
              </ActionButton>
              <ActionButton
                variant="ghost"
                onClick={() => {
                  setDraf(null);
                  setTerpilih(null);
                }}
              >
                Batal
              </ActionButton>
            </div>
          </div>
        )}
      </Card>

      {/* ── Titik milik pengguna ─────────────────────────────────── */}
      <Card padded={false} className="p-5 sm:p-6">
        <CardTitle
          action={
            milikSaya.length > 0 ? (
              <button
                type="button"
                onClick={() => setKonfirmasiBersihkan(true)}
                className="text-[11px] font-semibold text-rose-500 hover:text-rose-600 transition-colors"
              >
                Hapus Semua
              </button>
            ) : undefined
          }
        >
          Titik Anda
        </CardTitle>

        {milikSaya.length === 0 ? (
          <EmptyState
            message="Belum ada titik yang Anda buat."
            hint="Klik peta di atas untuk menambah titik, atau pakai salah satu titik kantor di bawah."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {milikSaya.map(item => {
              const aktif = terpilih === item.id;
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 transition-colors ${
                    item.dipakai
                      ? 'border-violet-300 dark:border-violet-500/50 bg-violet-50/50 dark:bg-violet-500/5'
                      : aktif
                        ? 'border-blue-300 dark:border-blue-500/50 bg-blue-50/50 dark:bg-blue-500/5'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                        {item.nama}
                      </p>
                      <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate">
                        {item.latitude.toFixed(KOORD_DESIMAL)}, {item.longitude.toFixed(KOORD_DESIMAL)}
                      </p>
                    </div>
                    {item.dipakai && (
                      <Badge tone="violet">
                        <Star className="w-2.5 h-2.5" /> Dipakai
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {item.dipakai ? (
                      <span className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-violet-200 dark:border-violet-500/40 text-violet-700 dark:text-violet-300">
                        Koordinat absen aktif
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => pakai(item.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-300 dark:hover:border-violet-500/40 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                      >
                        <Star className="w-3 h-3" />
                        Pakai untuk absen
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setTerpilih(aktif ? null : item.id)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      {aktif ? 'Sembunyikan' : 'Fokus di peta'}
                    </button>
                    <button
                      type="button"
                      onClick={() => hapus(item.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Hapus
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Titik dari server ────────────────────────────────────── */}
      <Card padded={false} className="p-5 sm:p-6">
        <CardTitle action={<Badge tone="blue">object: getlokasiabsen</Badge>}>
          Titik Kantor dari Server
        </CardTitle>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SkeletonList rows={2} />
            <SkeletonList rows={2} />
          </div>
        ) : locations.length === 0 ? (
          <EmptyState
            message="Belum ada titik absen terdaftar."
            hint="Hubungkan akun ke server pusat lewat halaman Beranda."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {locations.map(location => {
              const fence = checkGeofence(
                titikAbsen?.latitude ?? null,
                titikAbsen?.longitude ?? null,
                location.latitude,
                location.longitude,
                location.radius
              );
              return (
                <div
                  key={String(location.id)}
                  className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-4"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                        {location.nama || location.satuanKerja || `Lokasi ${location.id}`}
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                        {location.satuanKerja || `id: ${location.id}`}
                      </p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <Cell label="Latitude" value={location.latitude?.toFixed(KOORD_DESIMAL) ?? '-'} mono />
                    <Cell label="Longitude" value={location.longitude?.toFixed(KOORD_DESIMAL) ?? '-'} mono />
                    <Cell label="Radius" value={`${fence.radius} m`} />
                    <Cell
                      label="Jarak dari koordinat"
                      value={
                        fence.distance === null
                          ? '-'
                          : `${Math.round(fence.distance).toLocaleString('id-ID')} m`
                      }
                      mono
                    />
                  </dl>

                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() =>
                        setTerpilih(
                          terpilih === `server-${location.id}` ? null : `server-${location.id}`
                        )
                      }
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      {terpilih === `server-${location.id}` ? 'Sembunyikan' : 'Fokus di peta'}
                    </button>
                    {location.latitude !== null && location.longitude !== null && (
                      <button
                        type="button"
                        onClick={() => pakaiTitikServer(location)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                      >
                        <Star className="w-3 h-3" />
                        Pakai untuk absen
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={konfirmasiBersihkan}
        tone="danger"
        title="Hapus semua titik Anda?"
        message={`${milikSaya.length} titik yang tersimpan di perangkat ini akan dihapus. Titik kantor dari server tidak tersentuh. Tindakan ini tidak bisa dibatalkan.`}
        confirmLabel="Ya, Hapus Semua"
        cancelLabel="Batal"
        onConfirm={bersihkan}
        onCancel={() => setKonfirmasiBersihkan(false)}
      />
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Cell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/70 dark:border-slate-700/50 px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-slate-700 dark:text-slate-200 truncate ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
