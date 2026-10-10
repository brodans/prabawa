import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  CloudDownload,
  Fingerprint,
  LogIn,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCircle,
  XCircle,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { useToast } from '../components/ui/Toast';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  Field,
  Input,
  PageHeader,
  PasswordField,
  StatTile,
} from '../components/ui/Surface';
import {
  rpcGetLokasiAbsen,
  rpcHistoryAbsen,
  rpcLengkapiProfil,
  rpcLogin,
  rpcSyncData,
  type HistoryAbsenModel,
  type LokasiView,
} from '../lib/apiCalls';
import { setServerSessionCache } from '../lib/cacheManager';
import { getTodayWIB } from '../lib/dateFormatter';
import {
  ringkasanKredensial,
  saveServerCredential,
} from '../lib/akunFirestore';
import {
  imeiStabil,
  simpanImei,
  tandaiAktifServer,
  toPegawaiProfile,
} from '../lib/serverAutoLogin';
import { isCheckType, jamTampil } from '../lib/viewModels';
import { ABSEN_CHECK_TYPE, GATE_NIP_SALAH } from '../lib/presensiContract';
import { APP_FULL_NAME, APP_VERSION } from '../lib/appIdentity';

export default function Beranda() {
  const {
    currentUser,
    pegawai,
    setPegawai,
    setServerConnected,
    serverLoginError,
    serverAutoLoginPending,
    setServerLoginError,
    setServerLogoutRequested,
    loginForm,
    setLoginForm,
    setConfig,
    setActivePage,
    tabPermissions,
  } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();

  // ── Login server pusat ───────────────────────────────────────────
  const [authenticating, setAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState('');

  // ── Data beranda ─────────────────────────────────────────────────
  // Work code TIDAK dimuat di sini — jadwal kerja sudah pindah ke
  // halaman Presensi. Beranda hanya butuh titik absen dan rekaman absen hari ini.
  const [locations, setLocations] = useState<LokasiView[]>([]);
  const [todayPunches, setTodayPunches] = useState<HistoryAbsenModel[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const today = getTodayWIB();

  // Isi form dengan NIP + IMEI terakhir yang tersimpan, supaya saat
  // Auto-login gagal (mis. 402) → pengguna tinggal mengoreksi IMEI-nya, tidak
  // perlu mengingat NIP-nya juga.
  //
  // ⚠️ Yang dibaca hanya metadata: NIP, IMEI, dan apakah password-nya masih
  // bisa dipakai server. Password-nya sendiri tidak pernah sampai di peramban.
  useEffect(() => {
    if (!currentUser?.username) return;
    let hidup = true;
    void ringkasanKredensial(currentUser.username)
      .then(stored => {
        if (!hidup || !stored) return;
        const imei = stored.imei || imeiStabil(currentUser.username);
        setLoginForm(prev => ({ ...prev, username: stored.nip, imei: prev.imei || imei }));
      })
      .catch(() => {
        // Metadata tidak terbaca bukan alasan menutup halaman — auto-login
        // sudah punya pesannya sendiri kalau kredensialnya memang masalah.
      });
    return () => {
      hidup = false;
    };
  }, [currentUser?.username, setLoginForm]);

  const loadDashboard = useCallback(async () => {
    if (!ready) return;
    setLoadError(null);
    try {
      const [lokasis, punches] = await Promise.all([
        rpcGetLokasiAbsen(context),
        rpcHistoryAbsen(context, { tgl: today, page: 1, limit: 20 }),
      ]);
      setLocations(lokasis);
      setTodayPunches(punches);
    } catch (err: any) {
      setLoadError(err?.message ?? 'Gagal memuat data dari server pusat.');
    }
  }, [context, ready, today]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // ── Aksi ─────────────────────────────────────────────────────────
  const handleServerLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');

    const nip = loginForm.username.replace(/\s/g, '').trim();
    const password = loginForm.password.replace(/\s/g, '');
    if (!nip || !password) {
      setLoginError('NIP dan password wajib diisi.');
      return;
    }

    setAuthenticating(true);
    try {
      // IMEI wajib sebagai faktor ketiga. Kalau kolomnya kosong, pakai
      // tech mark stabil akun ini — nilainya konsisten antar sesi, jadi
      // auto-login berikutnya punya faktor yang sama.
      const imei = loginForm.imei.trim() || imeiStabil(currentUser?.username ?? '');
      if (loginForm.imei.trim()) simpanImei(currentUser?.username ?? '', imei);
      const hasil = await rpcLogin(nip, password, { imei });
      if (!hasil.ok) {
        // 402 = akun terkunci ke perangkat lain. Server menolak SEMUA
        // nilai imei dalam keadaan ini (bahkan string kosong), jadi satu-
        //-satunya jalan adalah memasukkan IMEI perangkat yang benar-benar
        // terdaftar pada akun tersebut.
        if (hasil.perangkatTerikat) {
          setLoginError(
            'Akun ini sudah terdaftar pada perangkat lain. Isi kolom IMEI dengan androidId / IMEI perangkat yang dipakai saat pertama kali login, lalu coba lagi.'
          );
          return;
        }
        if (hasil.kode === GATE_NIP_SALAH) {
          setLoginError('NIP atau password salah.');
          return;
        }
        setLoginError(hasil.pesan);
        return;
      }

      const result = hasil.data;
      // `login` sudah mengirim profil lengkap (nama, jabatan, departemen,
      // logo, URL foto, flag modul). Fallback ke endpoint lain hanya
      // dipanggil bila nama kosong.
      const profil = await rpcLengkapiProfil({ apiKey: result.api_key, imei }, result, nip);

      const profile = toPegawaiProfile(profil, imei);

      setPegawai(profile);
      setServerConnected(true);
      setServerLoginError(null);
      // Login manual = "sambungkan lagi", jadi penanda keluar server
      // dibersihkan dan auto-login aktif kembali untuk sesi berikutnya.
      setServerLogoutRequested(false);
      if (currentUser?.username) {
        tandaiAktifServer(currentUser.username);
        simpanImei(currentUser.username, imei);
      }
      setConfig(prev => ({
        ...prev,
        imei,
        idLokasi: profile.idLokasi,
        kodeInstansi: profile.kodeInstansi,
        kodeUnor: profile.kodeUnor,
      }));
      setLoginForm({ username: nip, password: '', imei });

      if (currentUser?.username) {
        setServerSessionCache(currentUser.username, {
          apiKey: profile.apiKey ?? '',
          nip: profile.nip ?? '',
          pegawaiId: profile.id ?? '',
          idLokasi: profile.idLokasi ?? '',
          kodeInstansi: profile.kodeInstansi ?? '',
          kodeUnor: profile.kodeUnor ?? '',
          nama: profile.nama ?? '',
          jabatan: profile.jabatan ?? '',
          instansi: profile.instansi ?? '',
          departemen: profile.departemen ?? '',
          group: profile.group ?? '',
          profilePic: profile.profilePic ?? '',
          usingWajah: profile.usingWajah ?? 0,
          workCode: '',
          imei,
        });
        // Kredensial SELALU disimpan — inilah yang membuat server pusat
        // terhubung otomatis di setiap pembukaan aplikasi. Tidak ada
        // centang "ingat kredensial" karena auto-login adalah syarat,
        // bukan pilihan.
        //
        // IMEI ikut tersimpan: tanpa itu, auto-login untuk akun yang
        // terkunci ke satu perangkat akan selalu dijawab 402.
        void saveServerCredential(currentUser.username, nip, password, imei).catch(err =>
          console.warn('[Beranda] gagal menyimpan kredensial:', err)
        );
      }

      toast.success(`Selamat datang, ${profile.nama || nip}.`);
    } catch (err: any) {
      setLoginError(err?.message ?? 'Gagal menghubungi server pusat.');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleSyncData = async () => {
    setSyncing(true);
    try {
      await rpcSyncData(context);
      toast.success('Data referensi berhasil disinkronkan.');
      await loadDashboard();
    } catch (err: any) {
      toast.error(err?.message ?? 'Sinkronisasi gagal.');
    } finally {
      setSyncing(false);
    }
  };

  // ── Absensi hari ini ────────────────────────────────────────────
  // Jam kerja tidak dihitung di halaman ini — sudah pindah ke Presensi
  // bersama tabel work code-nya. Yang tersisa di sini hanya catatan
  // rekaman dari `history_absen` (satu baris per rekaman).
  const punchMasuk = todayPunches.find(row => isCheckType(row.checktype, ABSEN_CHECK_TYPE.DATANG));
  const punchPulang = todayPunches.find(row => isCheckType(row.checktype, ABSEN_CHECK_TYPE.PULANG));
  const jamMasukAktif = jamTampil(punchMasuk?.waktu);
  const jamPulangAktif = jamTampil(punchPulang?.waktu);
  const lokasiAktif = locations[0] ?? null;

  // ═══ Belum login ke server pusat ═══════════════════════════════
  if (!pegawai && serverAutoLoginPending) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Beranda"
          subtitle={`Menghubungkan akun ke server ${APP_FULL_NAME}`}
          icon={<UserCircle className="w-5 h-5" />}
        />
        <Card>
          <div className="flex items-center gap-3 py-3" role="status" aria-live="polite">
            <LoaderCircle className="w-5 h-5 animate-spin text-blue-500" />
            <p className="text-sm text-slate-600 dark:text-slate-300">Menyiapkan akun tersambung…</p>
          </div>
        </Card>
      </div>
    );
  }

  if (!pegawai) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Beranda"
          subtitle={`Silakan hubungkan akun ini ke server ${APP_FULL_NAME}`}
          icon={<UserCircle className="w-5 h-5" />}
        />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <Card className="lg:col-span-3">
            <CardTitle>Login Server Pusat</CardTitle>
            <form onSubmit={handleServerLogin} className="space-y-4" autoComplete="off">
              <Field label="NIP">
                <Input
                  value={loginForm.username}
                  onChange={event => setLoginForm(prev => ({ ...prev, username: event.target.value.replace(/\s/g, '').slice(0, 32) }))}
                  placeholder="Nomor Induk Pegawai"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>

              <Field label="Password Presensi">
                <PasswordField
                  value={loginForm.password}
                  onChange={password =>
                    setLoginForm(prev => ({ ...prev, password: password.replace(/\s/g, '').slice(0, 64) }))
                  }
                  placeholder="••••••••"
                  maxLength={64}
                  autoComplete="current-password"
                />
              </Field>

              <Field
                label="IMEI"
                hint="IMEI perangkat terdaftar, jika diwajibkan."
              >
                <Input
                  value={loginForm.imei}
                  onChange={event =>
                    setLoginForm(prev => ({ ...prev, imei: event.target.value.slice(0, 64) }))
                  }
                  placeholder={imeiStabil(currentUser?.username ?? '') || 'androidId perangkat'}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>

              {/* Alasan auto-login gagal. Tanpa ini, kegagalannya diam-diam
                  muncul sebagai form login kosong tanpa penjelasan. */}
              {serverLoginError && serverLoginError !== loginError && (
                <Alert tone={authenticating ? 'blue' : 'amber'}>
                      Login otomatis: {serverLoginError}
                      {authenticating && ' Mohon tunggu sebentar…'}
                </Alert>
              )}

              {loginError && <Alert tone="rose">{loginError}</Alert>}

              <ActionButton type="submit" loading={authenticating} icon={<LogIn className="w-4 h-4" />}>
                Hubungkan Akun
              </ActionButton>

              <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                Kredensial tersimpan terenkripsi untuk login otomatis.
              </p>
            </form>
          </Card>

          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardTitle>Tentang Aplikasi</CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                <span className="font-semibold">{APP_FULL_NAME}</span> (PRABAWA) versi {APP_VERSION}.
                Panel web pengganti aplikasi Android resmi — seluruh permintaan diteruskan ke
                gateway JSON-RPC yang sama, hanya lewat proxy server-side supaya CORS dan identitas
                perangkat tidak terekspos ke browser.
              </p>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ═══ Sudah login ═══════════════════════════════════════════════
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Halo, ${pegawai.nama?.split(' ')[0] || 'Pegawai'}`}
        subtitle={pegawai.departemen || APP_FULL_NAME}
        icon={<Sparkles className="w-5 h-5" />}
        action={
          <>
            <ActionButton
              variant="ghost"
              size="sm"
              loading={syncing}
              disabled={!tabPermissions.aksiSyncData}
              onClick={handleSyncData}
              icon={<CloudDownload className="w-4 h-4" />}
              aria-label="Sinkronkan data"
              title="Sinkronkan data"
            >
              <span className="hidden sm:inline">Sync Data</span>
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => void loadDashboard()}
              icon={<RefreshCw className="w-4 h-4" />}
              aria-label="Muat ulang beranda"
              title="Muat ulang"
            >
              <span className="hidden sm:inline">Muat Ulang</span>
            </ActionButton>
          </>
        }
      />

      {loadError && <Alert tone="rose">{loadError}</Alert>}

      {/* ── Ringkasan ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Status Hari Ini"
          value={jamMasukAktif ? 'Hadir' : 'Belum Absen'}
          hint={
            jamMasukAktif
              ? `Masuk ${jamMasukAktif}`
              : todayPunches.length > 0
                ? `${todayPunches.length} rekaman absen`
                : 'Belum ada catatan'
          }
          tone={jamMasukAktif ? 'emerald' : 'amber'}
          icon={jamMasukAktif ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
        />
        <StatTile
          label="Jam Masuk"
          value={jamMasukAktif ?? '--:--'}
          hint="Absen Datang hari ini"
          tone="blue"
          icon={<CalendarClock className="w-4 h-4" />}
        />
        <StatTile
          label="Jam Pulang"
          value={jamPulangAktif ?? '--:--'}
          hint="Absen Pulang hari ini"
          tone="violet"
          icon={<CalendarClock className="w-4 h-4" />}
        />
        {/*
         * Ini lokasi yang TERDAFTAR di server pusat — titik absen milik
         * instansi, bukan koordinat perangkat. Tidak ada GPS di aplikasi ini,
         * dan tidak ada permintaan izin lokasi ke peramban sama sekali.
         */}
        <StatTile
          label="Lokasi Absen"
          value={lokasiAktif ? 'Terdaftar' : 'Belum'}
          hint={lokasiAktif ? lokasiAktif.nama : 'Belum terdaftar di server pusat'}
          tone={lokasiAktif ? 'emerald' : 'slate'}
          icon={<MapPin className="w-4 h-4" />}
        />
      </div>

      {/* ── Grid utama ────────────────────────────────────────────
          Jam kerja tidak lagi tampil di sini — sudah pindah ke halaman
          Presensi, tempat jadwal itu benar-benar dipakai untuk
          menentukan boleh/tidaknya absen dikirim. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Identitas */}
        <Card>
          <CardTitle>Identitas Presensi</CardTitle>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shrink-0">
              {pegawai.profilePic ? (
                <img src={pegawai.profilePic} alt={pegawai.nama} className="w-full h-full rounded-2xl object-cover" />
              ) : (
                <UserCircle className="w-8 h-8" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{pegawai.nama || '-'}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{pegawai.nip || '-'}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge tone="blue">ID {pegawai.id || '-'}</Badge>
                {punchPulang && <Badge tone="emerald">Sudah absen pulang</Badge>}
              </div>
            </div>
          </div>

          {/* Hanya field yang benar-benar ada di balasan server. `login`
              hanya mengembalikan api_key + tiga id; nama dan unit kerja
              diambil dari `list_ijin` (lihat rpcLengkapiProfil). */}
          <div className="space-y-2.5 text-sm">
            <Row label="NIP" value={pegawai.nip || '-'} mono />
            <Row label="Satuan Kerja" value={pegawai.departemen || '-'} icon={<Building2 className="w-3.5 h-3.5" />} />
            <Row label="Instansi" value={lokasiAktif?.nama || '-'} />
            <Row label="ID Lokasi" value={lokasiAktif?.id || '-'} mono />
            <Row label="Titik Absen" value={lokasiAktif?.satuanKerja || '-'} />
            <Row label="Rekaman Absen Hari Ini" value={`${todayPunches.length} baris`} />
          </div>
        </Card>

        {/* Aksi cepat */}
        <Card>
          <CardTitle>Aksi Cepat</CardTitle>
          <div className="space-y-2.5">
            <QuickAction
              enabled={tabPermissions.aksiAbsen}
              icon={<Fingerprint className="w-5 h-5" />}
              title="Lakukan Absen"
              hint="Catat kehadiran hari ini"
              onClick={() => setActivePage('tabPresensi')}
            />
            <QuickAction
              enabled={tabPermissions.aksiAjukanIzin}
              icon={<CalendarClock className="w-5 h-5" />}
              title="Ajukan Izin"
              hint="Cuti, sakit,WFH"
              onClick={() => setActivePage('tabPerizinan')}
            />
            <QuickAction
              enabled={tabPermissions.tabLaporan}
              icon={<ShieldCheck className="w-5 h-5" />}
              title="Laporan"
              hint="Rekap presensi"
              onClick={() => setActivePage('tabLaporan')}
            />
          </div>


        </Card>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Sub-komponen
// ═══════════════════════════════════════════════════════════════════════

function Row({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 shrink-0">{icon}{label}</span>
      <span className={`text-xs font-semibold text-slate-700 dark:text-slate-200 text-right truncate ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

function QuickAction({
  enabled,
  icon,
  title,
  hint,
  onClick,
}: {
  enabled: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-left transition-all hover:border-blue-300 dark:hover:border-blue-500/40 hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed group"
    >
      <div className="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{title}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{hint}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all shrink-0" />
    </button>
  );
}
