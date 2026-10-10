import React, { Suspense, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  Camera,
  Globe,
  MapPin,
  ChevronLeft,
  ChevronRight,
  FileCheck,
  FileText,
  History,
  Home,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  UserCog,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useDarkMode } from './hooks/useDarkMode';
import { AppProvider, useAppContext, PAGE_PATHS } from './context/AppContext';
import { ToastProvider } from './components/ui/Toast';
import LoginScreen from './components/LoginScreen';
import AkunDropdown from './components/ui/AkunDropdown';
import { ConfirmDialog } from './components/ui/Modal';
import { Skeleton, SkeletonList, SkeletonTable } from './components/ui/Surface';
import SettingAkunModal from './components/SettingAkunModal';
import ProfilServerModal from './components/ProfilServerModal';
import DeveloperInspector from './components/DeveloperInspector';
import BannerKontrakServer from './components/BannerKontrakServer';
import BannerServerPusat from './components/BannerServerPusat';
import GerbangLangganan from './components/GerbangLangganan';
import {
  mulaiAutoLogin,
  resetAutoLogin,
  sudahKeluarServer,
  tandaiKeluarServer,
  tokenMasihValid,
  ulangAutoLoginTanpaCache,
  type ProfilPegawaiResult,
} from './lib/serverAutoLogin';
import { clearServerSessionCache } from './lib/cacheManager';
import {
  loadSession,
  perbaruiTokenSesi,
  touchSession,
} from './lib/sessionManager';
import { PanelAuthError, verifikasiSesiPanel } from './lib/akunFirestore';
import { rpcLogout } from './lib/apiCalls';
import { APP_LOGO, APP_NAME } from './lib/appIdentity';

// ═══════════════════════════════════════════════════════════════════════
//  Lazy loading halaman (code splitting per halaman)
// ═══════════════════════════════════════════════════════════════════════

type PageModule = { default: React.ComponentType };

const pageImporters = {
  tabBeranda: () => import('./pages/Beranda'),
  tabPresensi: () => import('./pages/Presensi'),
  tabPerizinan: () => import('./pages/Perizinan'),
  tabRiwayatIzin: () => import('./pages/RiwayatIzin'),
  tabLaporan: () => import('./pages/Laporan'),
  tabLokasiAbsen: () => import('./pages/LokasiAbsen'),
  tabManajemenAkun: () => import('./pages/ManajemenAkun'),
  tabDocs: () => import('./pages/Docs'),
  tabWeb: () => import('./pages/WebPresensi'),
} satisfies Record<string, () => Promise<PageModule>>;

const pageModuleCache = new Map<string, Promise<PageModule>>();

const loadPageModule = (pageId: string): Promise<PageModule> => {
  const importer = pageImporters[pageId as keyof typeof pageImporters];
  if (!importer) return Promise.reject(new Error(`Halaman ${pageId} tidak tersedia.`));
  const cached = pageModuleCache.get(pageId);
  if (cached) return cached;
  const promise = importer().catch(error => {
    pageModuleCache.delete(pageId);
    throw error;
  });
  pageModuleCache.set(pageId, promise);
  return promise;
};

function LazyPage({ pageId }: { pageId: string }) {
  const module = React.use(loadPageModule(pageId));
  const Component = module.default;
  return <Component />;
}

const lazyPage = (pageId: string): React.ComponentType => () => <LazyPage pageId={pageId} />;
const Beranda = lazyPage('tabBeranda');
const Presensi = lazyPage('tabPresensi');
const Perizinan = lazyPage('tabPerizinan');
const RiwayatIzin = lazyPage('tabRiwayatIzin');
const Laporan = lazyPage('tabLaporan');
const LokasiAbsen = lazyPage('tabLokasiAbsen');
const ManajemenAkun = lazyPage('tabManajemenAkun');
const Docs = lazyPage('tabDocs');
const WebPresensi = lazyPage('tabWeb');

// ═══════════════════════════════════════════════════════════════════════
//  Daftar halaman & navigasi
// ═══════════════════════════════════════════════════════════════════════

interface PageDefinition {
  id: string;
  icon: LucideIcon;
  label: string;
  component: React.ComponentType;
  path: string;
  group: 'utama' | 'referensi' | 'admin';
}

const PAGES: PageDefinition[] = [
  { id: 'tabBeranda', icon: Home, label: 'Beranda', component: Beranda, path: PAGE_PATHS.tabBeranda, group: 'utama' },
  { id: 'tabPresensi', icon: Camera, label: 'Presensi', component: Presensi, path: PAGE_PATHS.tabPresensi, group: 'utama' },
  { id: 'tabPerizinan', icon: FileCheck, label: 'Perizinan', component: Perizinan, path: PAGE_PATHS.tabPerizinan, group: 'utama' },
  { id: 'tabRiwayatIzin', icon: History, label: 'Riwayat Izin', component: RiwayatIzin, path: PAGE_PATHS.tabRiwayatIzin, group: 'utama' },
  { id: 'tabLaporan', icon: FileText, label: 'Laporan', component: Laporan, path: PAGE_PATHS.tabLaporan, group: 'utama' },
  { id: 'tabLokasiAbsen', icon: MapPin, label: 'Lokasi Absen', component: LokasiAbsen, path: PAGE_PATHS.tabLokasiAbsen, group: 'utama' },
  { id: 'tabWeb', icon: Globe, label: 'WEB', component: WebPresensi, path: PAGE_PATHS.tabWeb, group: 'utama' },
  { id: 'tabDocs', icon: BookOpen, label: 'Dokumentasi', component: Docs, path: PAGE_PATHS.tabDocs, group: 'referensi' },
  // ⚠️ Manajemen Akun hanya untuk admin. Diperiksa dua kali: di
  // `visiblePages` (role) dan di `tabPermissions.tabManajemenAkun`, yang
  // `batasiIzin` paksa `false` untuk semua non-admin.
  //
  // Semua pengelolaan akun dan langganan berada pada satu halaman.
  {
    id: 'tabManajemenAkun',
    icon: UserCog,
    label: 'Manajemen Akun',
    component: ManajemenAkun,
    path: PAGE_PATHS.tabManajemenAkun,
    group: 'admin',
  },
];

const GROUP_LABELS: Record<PageDefinition['group'], string> = {
  utama: 'Menu Utama',
  referensi: 'Referensi',
  // Dipisah dari Menu Utama: admin punya halaman yang tidak ada artinya
  // bagi pengguna biasa, dan menaruhnya di "Menu Utama" membuat lima menu
  // untuk tiga halaman yang dipakai sehari-hari.
  admin: 'Administrasi',
};

/**
 * Urutan grup di sidebar.
 *
 * `referensi` (Dokumentasi) paling akhir, **di bawah** `admin` (Administrasi).
 * Alasannya: Dokumentasi adalah bacaan, bukan bagian dari pekerjaan. Taruh di
 * atas Administrasi membuatnya terlihat seperti salah satu alat admin,
 * padahal tidak ada hubungannya.
 *
 * Karena `Referensi` hanya berisi satu menu, ia jadi baris penutup sidebar —
 * hal yang wajar di navigasi yang panjang.
 */
const GROUP_ORDER: PageDefinition['group'][] = ['utama', 'admin', 'referensi'];

// ═══════════════════════════════════════════════════════════════════════
//  Komponen pendukung shell
// ═══════════════════════════════════════════════════════════════════════

function Clock() {
  const [time, setTime] = useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hidden sm:flex items-center gap-2.5 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-slate-200/50 dark:border-slate-700/50 shadow-sm transition-all hover:shadow-md">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
      </span>
      <span className="text-xs font-mono font-medium tracking-tight text-slate-700 dark:text-slate-200">
        {time.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })}
      </span>
      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">WIB</span>
    </div>
  );
}

function PageLoading({ pageId }: { pageId: string }) {
  const { webPresensiState, pegawai } = useAppContext();
  const header = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-2xl" />
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-6 w-44 max-w-full" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
      </div>
      {(pageId === 'tabBeranda' || pageId === 'tabPresensi') && (
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 shrink-0 rounded-xl" />
          {pageId === 'tabBeranda' && <Skeleton className="h-9 w-28 shrink-0 rounded-xl" />}
        </div>
      )}
    </div>
  );
  const stats = (count: number) => (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800/60">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-4 w-4 rounded" />
          </div>
          <Skeleton className="mt-2 h-7 w-1/3" />
          <Skeleton className="mt-1 h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
  const filterFields = (count = 4) =>
    Array.from({ length: count }, (_, index) => (
      <div key={index} className="space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    ));
  const filters = (count = 4) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{filterFields(count)}</div>
  );
  const table = (columns = 6, rows = 6) => (
    <div className="rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <SkeletonTable columns={columns} rows={rows} />
    </div>
  );
  const webTabPanel = (() => {
    switch (webPresensiState.tab) {
      case 'imei':
        return (
          <div className="space-y-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        );
      case 'kehadiran':
        return (
          <>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
            <SkeletonTable columns={7} rows={5} />
            <div className="flex justify-center gap-2">
              <Skeleton className="h-8 w-20 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </>
        );
      case 'detail':
        return (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
            {[0, 1, 2].map(section => (
              <div key={section} className="space-y-3">
                <Skeleton className="h-3 w-44" />
                <SkeletonTable columns={section === 2 ? 6 : 4} rows={3} />
              </div>
            ))}
          </div>
        );
      case 'perizinan':
        return (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Skeleton className="h-5 w-36" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-24 rounded-lg" />
                <Skeleton className="h-8 w-28 rounded-lg" />
              </div>
            </div>
            <SkeletonTable columns={6} rows={5} />
            <div className="flex justify-center gap-2">
              <Skeleton className="h-8 w-20 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </>
        );
    }
  })();

  let content: React.ReactNode;
  if (pageId === 'tabBeranda' && !pegawai) {
    content = (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6 lg:col-span-3">
          <Skeleton className="h-4 w-40" />
          {filterFields(3)}
          <Skeleton className="h-10 w-36 rounded-xl" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
            <Skeleton className="mb-3 h-4 w-40" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  } else if (pageId === 'tabBeranda') {
    content = (
      <>
        {stats(4)}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[0, 1].map(card => (
            <div key={card} className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
              <Skeleton className="mb-4 h-4 w-40" />
              {card === 0 ? (
                <>
                  <div className="mb-4 flex items-center gap-4">
                    <Skeleton className="h-16 w-16 shrink-0 rounded-2xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </div>
                  <SkeletonList rows={6} />
                </>
              ) : (
                <SkeletonList rows={3} />
              )}
            </div>
          ))}
        </div>
      </>
    );
  } else if (pageId === 'tabPresensi') {
    content = (
      <>
        {stats(4)}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 p-5 sm:p-6 space-y-5">
            <Skeleton className="h-4 w-32" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-32" />
              <div className="flex gap-2">
                <Skeleton className="h-[42px] flex-1 rounded-xl" />
                <Skeleton className="h-[42px] w-32 rounded-xl" />
              </div>
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-20 w-full rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-[42px] w-full rounded-xl" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map(item => <Skeleton key={item} className="h-10 rounded-xl" />)}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton className="h-10 rounded-xl" />
              <Skeleton className="h-10 rounded-xl" />
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <div className="lg:col-span-2 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 p-5 sm:p-6">
            <Skeleton className="mb-4 h-4 w-40" />
            <SkeletonList rows={4} />
          </div>
        </div>
      </>
    );
  } else if (pageId === 'tabLokasiAbsen') {
    content = (
      <>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <div className="mb-4 flex justify-between"><Skeleton className="h-4 w-36" /><Skeleton className="h-6 w-32 rounded-full" /></div>
          <div className="mb-3 flex flex-wrap items-center gap-4">
            {[0, 1, 2].map(item => <Skeleton key={item} className="h-3 w-20" />)}
            <Skeleton className="ml-auto h-3 w-40" />
          </div>
          <Skeleton className="h-[min(480px,65vh)] w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[0, 1].map(item => (
              <div key={item} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="mb-3 flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-7 w-28 rounded-lg" />
                  <Skeleton className="h-7 w-24 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[0, 1].map(item => (
              <div key={item} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <Skeleton className="mb-3 h-4 w-2/3" />
                <SkeletonList rows={3} />
              </div>
            ))}
          </div>
        </div>
      </>
    );
  } else if (pageId === 'tabManajemenAkun') {
    content = (
      <div className="space-y-5">
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-800/60">
          <div className="px-3 py-3 sm:px-5">
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900/70">
              {[0, 1, 2].map(tab => (
                <div key={tab} className="flex min-h-12 items-center justify-center gap-2 rounded-lg px-2 py-2">
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <Skeleton className="h-3 w-3/4 max-w-28" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-200/70 dark:border-slate-700/60 dark:bg-slate-700/60 sm:grid-cols-4">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="space-y-2 bg-white p-4 dark:bg-slate-800/60">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-5">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto] sm:items-end">
              {[0, 1, 2, 3].map(item => (
                <div key={item} className="space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-[42px] w-full rounded-xl" />
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex min-h-[26px] items-center">
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="mt-4">
              <SkeletonTable columns={8} rows={7} />
            </div>
          </div>
        </div>
      </div>
    );
  } else if (pageId === 'tabPerizinan') {
    content = (
      <>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <Skeleton className="mb-4 h-4 w-36" />
          <div className="space-y-4">
            {filterFields(2)}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{filterFields(2)}</div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-10 w-36 rounded-xl" />
              <Skeleton className="h-10 w-28 rounded-xl" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-52" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-8 w-28 rounded-lg" />
            </div>
          </div>
          <SkeletonTable columns={6} rows={5} />
        </div>
      </>
    );
  } else if (pageId === 'tabRiwayatIzin') {
    content = (
      <>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-3 sm:grid-cols-2 sm:max-w-md">
              {filterFields(2)}
            </div>
            <Skeleton className="h-10 w-28 rounded-xl" />
          </div>
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-700/60 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-3 w-32" />
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3].map(item => <Skeleton key={item} className="h-7 w-20 rounded-lg" />)}
            </div>
          </div>
        </div>
        {stats(4)}
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-36" />
            <div className="flex gap-2">
              {[0, 1, 2].map(item => <Skeleton key={item} className="h-8 w-24 rounded-lg" />)}
            </div>
          </div>
          <SkeletonTable columns={6} rows={6} />
        </div>
      </>
    );
  } else if (pageId === 'tabLaporan') {
    content = (
      <>
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{filterFields(3)}</div>
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-700/60 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16 rounded-lg" />
              <Skeleton className="h-8 w-16 rounded-lg" />
            </div>
            <Skeleton className="h-10 w-40 rounded-xl" />
          </div>
        </div>
        {stats(4)}
        <div className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-36" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </div>
          <SkeletonTable columns={7} rows={6} />
        </div>
      </>
    );
  } else if (pageId === 'tabWeb') {
    const login = (
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        {webPresensiState.sudahLogin ? (
          <>
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60 sm:flex-row sm:items-center">
              <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Skeleton className="h-14 rounded-lg" />
                  <Skeleton className="h-14 rounded-lg" />
                </div>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <Skeleton className="h-10 w-28 rounded-xl" />
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1].map(item => (
                <div key={item} className="space-y-2">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-[42px] w-full rounded-xl" />
                </div>
              ))}
            </div>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Skeleton className="h-11 w-20 rounded-xl" />
                <Skeleton className="h-11 w-10 rounded-xl" />
              </div>
            </div>
            <Skeleton className="h-10 w-40 rounded-xl" />
          </div>
        )}
      </div>
    );
    content = webPresensiState.sudahLogin ? (
      <>
        {login}
        <div className="space-y-4">
          <div className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-9 min-w-0 flex-1 rounded-xl" />)}
          </div>
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            {webTabPanel}
          </div>
        </div>
      </>
    ) : login;
  } else if (pageId === 'tabDocs') {
    content = (
      <>
        {stats(4)}
        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-slate-100/70 p-1.5 dark:border-slate-700 dark:bg-slate-800/50">
          {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-8 w-28 rounded-xl" />)}
        </div>
        {[0, 1, 2].map(card => (
          <div key={card} className="rounded-2xl border border-slate-200/70 bg-white p-5 dark:border-slate-700/60 dark:bg-slate-800/60 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-40" />
              {card === 0 && <Skeleton className="h-6 w-36 rounded-full" />}
            </div>
            {card === 0 ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12 rounded-xl" />)}
                </div>
                <Skeleton className="mt-4 h-40 w-full rounded-xl" />
              </>
            ) : card === 1 ? (
              <div className="space-y-3">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/3" />
                <div className="grid grid-cols-1 gap-2.5">
                  {[0, 1, 2].map(item => <Skeleton key={item} className="h-10 rounded-xl" />)}
                </div>
              </div>
            ) : (
              <>
                <Skeleton className="mb-3 h-3 w-4/5" />
                <Skeleton className="h-44 w-full rounded-xl" />
              </>
            )}
          </div>
        ))}
      </>
    );
  } else {
    content = (
      <>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 p-5 space-y-4">
            <Skeleton className="h-4 w-40" />
            {filters(3)}
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <Skeleton className="h-56 rounded-2xl" />
        </div>
        {stats(3)}
        {table(6, 4)}
      </>
    );
  }

  return (
    <div className={`w-full ${pageId === 'tabManajemenAkun' ? 'space-y-5' : 'space-y-6'}`} aria-label="Memuat halaman" role="status">
      {pageId !== 'tabWeb' && pageId !== 'tabManajemenAkun' && header}
      {content}
      <span className="sr-only">Memuat halaman...</span>
    </div>
  );
}

class PageErrorBoundary extends React.Component<
  React.PropsWithChildren<{ pageId: string }>,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  retry = () => {
    pageModuleCache.delete(this.props.pageId);
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center p-8 rounded-3xl border border-rose-200/50 bg-rose-50/50 dark:border-rose-900/30 dark:bg-rose-950/20 backdrop-blur-sm text-center">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mb-4">
          <X className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-semibold text-rose-900 dark:text-rose-200">Gagal Memuat Halaman</h3>
        <p className="mt-2 text-sm text-rose-600/80 dark:text-rose-300/80 max-w-md">
          Terjadi kesalahan saat mencoba memuat komponen ini. Sesi Anda tetap aman. Silakan coba muat ulang.
        </p>
        <button
          type="button"
          onClick={this.retry}
          className="mt-6 rounded-xl bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 transition-all active:scale-95"
        >
          Coba Lagi
        </button>
      </div>
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Auto-login ke server pusat
// ═══════════════════════════════════════════════════════════════════════

/**
 * Nama depan saja untuk kartu akun di top bar.
 *
 * Nama lengkap beserta NIP, jabatan, dan unit kerja sudah tampil di halaman Beranda
 * dan Dokumentasi — di sini cukup yang mudah dikenali.
 */
function namaDepan(nama: string | undefined): string {
  return (nama ?? '').trim().split(/\s+/)[0] ?? '';
}


// ═══════════════════════════════════════════════════════════════════════
//  Shell aplikasi
// ═══════════════════════════════════════════════════════════════════════

function MainApp({ onLogout, isDarkMode, toggleDarkMode }: { onLogout: () => void; isDarkMode: boolean; toggleDarkMode: () => void }) {
  const {
    pegawai,
    setPegawai,
    serverConnected,
    setServerConnected,
    setConfig,
    activePage,
    setActivePage,
    tabPermissions,
    currentUser,
    cekingSesi,
    developerMode,
    setDeveloperMode,
    setServerLoginError,
    setServerAutoLoginPending,
    setServerLogoutRequested,
  } = useAppContext();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isAkunModalOpen, setIsAkunModalOpen] = useState(false);
  const [isProfilServerOpen, setIsProfilServerOpen] = useState(false);
  /** Dialog konfirmasi keluar dari server — bukan window.confirm. */
  const [konfirmasiKeluarServer, setKonfirmasiKeluarServer] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  /** Dialog konfirmasi keluar dari aplikasi (akun panel). */
  const [konfirmasiKeluar, setKonfirmasiKeluar] = useState(false);

  /*
   * Filter halaman berdasarkan izin akses pengguna.
   *
   * ⚠️ Security: ini adalah **gerbang tampilan**, bukan sumber kebenaran.
   * `tabPermissions` sudah berasal dari server (hasil verifikasi token), jadi
   * nilainya sudah tepercaya. Tapi `MainApp` sengaja tetap memeriksa ulang
   * `currentUser.role === 'admin'` untuk halaman admin, dan `ManajemenAkun`
   * memeriksa lagi di badannya — tiga lapis untuk satu halaman, karena satu
   * saja yang lupa berarti halaman admin terbuka untuk semua orang.
   *
   * `cekingSesi` juga dicek di sini, bukan hanya di `App.tsx`: `MainApp` harus
   * tidak bisa dirender sama sekali tanpa akun, apa pun pemanggilnya.
   *
   * ⚠️ `useMemo` **wajib**, bukan "_optimasi_". `filter()` selalu mengembalikan
   * array baru, jadi tanpa memo `visiblePages` punya identitas berbeda pada
   * setiap render — dan efek di bawah yang memakainya sebagai dependensi
   * akan berjalan pada **setiap** render, lalu memanggil `setActivePage`,
   * yang memicu render lagi. Chain itu berhenti hanya karena kondisi
   * `some(...)` akhirnya terpenuhi, tapi selama berjalan ia membuat satu
   * render tambahan untuk setiap render — dan efek auto-login di bawahnya
   * ikut bergantung pada urutan itu.
   */
  const visiblePages = React.useMemo(
    () =>
      (cekingSesi || !currentUser ? [] : PAGES).filter(page => {
        if (page.id === 'tabManajemenAkun') return currentUser?.role === 'admin';
        return (tabPermissions as unknown as Record<string, boolean>)[page.id] === true;
      }),
    [cekingSesi, currentUser, tabPermissions]
  );

  /*
   * Boleh memutus sesi server pusat?
   *
   * `default: true` itu penting: `tabPermissions` masih bernilai default-nya
   * selama verifikasi token berjalan, jadi nilai `false` yang di sini sebelum
   * jawabannya tiba akan membuat tombolnya berkedip muncul lalu hilang.
   *
   * Admin tidak pernah dibatasi — sama seperti `tabManajemenAkun` di atas, dan
   * bukan karena alasan yang sama: dia yang *mengatur* izin ini, jadi
   * membatasi dirinya sendiri hanya menyulitkan pemulihan kalau aksesnya hilang.
   */
  const bolehKeluarServer =
    currentUser?.role === 'admin' ||
    (tabPermissions as unknown as Record<string, boolean>).aksiSesiServer !== false;

  React.useEffect(() => {
    if (visiblePages.length === 0) return;
    if (visiblePages.some(page => page.id === activePage)) return;
    setActivePage(visiblePages[0].id);
  }, [visiblePages, activePage, setActivePage]);

  // ── Auto-login ke server pusat ─────────────────────────────────────
  //
  // Aturan: server pusat harus selalu terhubung sendiri. Satu-satunya
  // pengecualian adalah tombol "Keluar dari Server" di kartu akun topbar,
  // yang menandai akun ini supaya tidak menghubungi server lagi.
  //
  // ⚠️ Efek ini **tidak** membatalkan request di cleanup, dan **tidak**
  // punya penjaga "sudah diproses" sendiri. Kenapa:
  //
  // 1. `React.StrictMode` menjalankan efek dua kali (mount → cleanup →
  //    mount). Dulu cleanup memanggil `controller.abort()` sementara body
  //    efek menolak percobaan kedua lewat `usernameDiproses.current` —
  //    jadi request pertama dibunuh lalu percobaan kedua dilewati begitu
  //    saja. Auto-login pun tidak pernah selesai, tanpa error apa pun.
  // 2. Membatalkan request saat cleanup juga salah: saat StrictMode
  //    melepas dan memasang ulang komponen, request yang sedang berjalan
  //    ikut hilang.
  //
  // Sebagai gantinya, orkestrasi percobaan dipindah ke modul
  // `serverAutoLogin`: `mulaiAutoLogin()` mengembalikan promise yang sama
  // bila percobaan untuk akun itu sudah berjalan, jadi pemanggilan kedua
  // dari StrictMode tidak memulai request baru dan tidak membuang yang lama.
  const setProfilServer = React.useCallback(
    (profil: ProfilPegawaiResult, imei: string) => {
      setPegawai(profil);
      setServerConnected(true);
      setConfig(prev => ({
        ...prev,
        // IMEI wajib ikut: akun terkunci ke perangkat tertentu akan
        // dijawab 402 pada request berikutnya bila ini kosong.
        imei,
        idLokasi: profil.idLokasi || prev.idLokasi,
        kodeInstansi: profil.kodeInstansi || prev.kodeInstansi,
        kodeUnor: profil.kodeUnor || prev.kodeUnor,
      }));
      setServerLoginError(null);
      setServerAutoLoginPending(false);
    },
    [setPegawai, setServerConnected, setConfig, setServerLoginError, setServerAutoLoginPending]
  );

  React.useEffect(() => {
    const username = currentUser?.username;
    if (!username) return;
    // Pengguna memang meminta keluar dari server — jangan hubungkan lagi.
    if (sudahKeluarServer(username)) {
      setServerLoginError(null);
      setServerAutoLoginPending(false);
      return;
    }

    let hidup = true;
    setServerLoginError('Menghubungkan server pusat…');
    setServerAutoLoginPending(true);

    void (async () => {
      const hasil = await mulaiAutoLogin(username);
      if (!hidup) return;

      const profil = hasil.profile;
      if (profil && (hasil.status === 'berhasil' || hasil.status === 'dari-cache')) {
        // Sesi dari cache perlu diuji dulu: `api_key` bisa sudah dicabut
        // server, dan tanpa pemeriksaan `useServerContext` akan menganggap
        // sesi siap lalu semua panggilan gagal dengan "Koneksi gagal".
        if (hasil.status === 'dari-cache' && hasil.imei) {
          const valid = await tokenMasihValid({ apiKey: profil.apiKey, imei: hasil.imei });
          if (!hidup) return;
          if (!valid) {
            // Cache ditolak — paksa login ulang dari kredensial terenkripsi.
            const { promise } = ulangAutoLoginTanpaCache(username);
            const ulang = await promise;
            if (!hidup) return;
            if (ulang.profile) {
              setProfilServer(ulang.profile, ulang.imei);
              return;
            }
            setServerConnected(false);
            setServerLoginError(ulang.pesan ?? 'Sesi server sudah tidak berlaku. Silakan masuk ulang.');
            setServerAutoLoginPending(false);
            return;
          }
        }
        setProfilServer(profil, hasil.imei);
        return;
      }

      // Gagal — alasannya diteruskan ke `BannerServerPusat`, yang menampilkannya
      // di halaman mana pun. Sebelumnya hanya dirender di Beranda, jadi orang
      // yang sedang di Presensi atau Laporan tidak pernah melihatnya.
      setServerConnected(false);
      setServerLoginError(
        hasil.status === 'belum-ada-kredensial' ? null : hasil.pesan ?? 'Gagal menghubungi server pusat.'
      );
      setServerAutoLoginPending(false);
    })();

    // Tidak ada `abort()` di sini — lihat catatan di atas.
    return () => {
      hidup = false;
    };
  }, [currentUser?.username, setServerLoginError, setServerConnected, setServerAutoLoginPending, setProfilServer]);

  // ── Putuskan sesi server pusat ─────────────────────────────────────
  // Memanggil `logout` yang memvalidasi api_key di sisi server, jadi
  // token lama benar-benar tidak berlaku lagi — bukan sekadar dihapus di
  // peramban. Cache sesi ikut dibuang supaya auto-login tidak memakai
  // token yang sudah dicabut. Akun panel TIDAK ikut keluar.
  //
  // ⚠️ Efek samping yang disengaja: aksi ini menandai akun ini di
  // localStorage sehingga auto-login **tidak** mencoba hubungkan lagi
  // sampai pengguna login manual. Itulah satu-satunya jalan untuk
  // mematikan auto-login.
  const handleServerLogout = async () => {
    /*
     * Penjaga izin — bukan sekadar penyembunyi tombol.
     *
     * `bolehKeluarServer` sudah menyembunyikan itemnya di dropdown, tapi itu
     * tampilan. Tanpa pemeriksaan di sini, siapa pun yang bisa memanggil
     * fungsi ini (atau menambahkan pemanggil baru di masa depan) akan melewati
     * aturan yang sama. Sesi server diputus, cache dibuang, dan
     * `tandaiKeluarServer` menutup auto-login sampai halaman di-reload.
     *
     * Yang dijaga di sini bukan siapa yang diputus — `tandaiKeluarServer()`
     * memakai username `currentUser`, jadi tidak mungkin salah sasaran. Yang
     * dijaga adalah *siapa yang boleh memanggilnya*.
     */
    if (!bolehKeluarServer) {
      setKonfirmasiKeluarServer(false);
      setServerLoginError(
        'Akun ini tidak punya izin untuk keluar dari server pusat. Hubungi administrator.'
      );
      return;
    }
    setKonfirmasiKeluarServer(false);
    setIsLoggingOut(true);
    try {
      if (pegawai?.apiKey) {
        try {
          // `lastLatLong` selalu kosong — aplikasi tidak memakai GPS maupun
          // peta, jadi tidak ada koordinat sesi yang perlu diteruskan.
          await rpcLogout({ apiKey: pegawai.apiKey, lastLatLong: '', imei: '' });
        } catch {
          // Token sudah invalid pun tetap harus keluar dari sisi lokal.
        }
      }
      if (currentUser?.username) {
        clearServerSessionCache(currentUser.username);
        tandaiKeluarServer(currentUser.username);
        // Status auto-login ikut dibuang. Tanpa ini, `mulaiAutoLogin` masih
        // punya entri "berhasil" untuk akun ini, dan setelah reload
        // tidak ada satu pun permintaan yang/sample dijalankan.
        resetAutoLogin();
      }
      setPegawai(null);
      setServerConnected(false);
      setConfig(prev => ({ ...prev, imei: '' }));
      setServerLoginError(null);
      setServerLogoutRequested(true);
      setActivePage('tabBeranda');
    } finally {
      setIsLoggingOut(false);
    }
  };

  // ── Tombol "kembali" (browser back / tombol fisik Android) ──────────
  React.useEffect(() => {
    const handlePopState = () => {
      const currentPage = PAGES.find(page => page.id === activePage) ?? PAGES[0];
      const path = currentPage.path || PAGE_PATHS.tabBeranda;
      window.history.pushState(null, '', path);

      const handlers =
        (window as unknown as { customBackHandlers?: ((...args: unknown[]) => boolean)[] })
          .customBackHandlers || [];
      if (handlers.length > 0) {
        handlers[handlers.length - 1]();
        return;
      }
      if (isProfilServerOpen) {
        setIsProfilServerOpen(false);
        return;
      }
      if (isAkunModalOpen) {
        setIsAkunModalOpen(false);
        return;
      }
      if (isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
        return;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAkunModalOpen, isProfilServerOpen, isMobileMenuOpen, activePage]);

  // ── Halaman aktif + fallback izin ──────────────────────────────────
  const activePageData = (() => {
    const found = PAGES.find(page => page.id === activePage);
    if (!found) return visiblePages[0] ?? PAGES[0];
    if (!visiblePages.some(page => page.id === activePage)) {
      const fallback = visiblePages[0] ?? PAGES[0];
      if (typeof window !== 'undefined' && window.location.pathname !== fallback.path) {
        window.history.replaceState(null, '', fallback.path);
      }
      return fallback;
    }
    return found;
  })();

  const ActiveComponent = activePageData.component;
  const isExpanded = isSidebarExpanded || isMobileMenuOpen;

  return (
    <div className="bg-slate-50 dark:bg-[#0B1120] text-slate-800 dark:text-slate-200 font-sans h-[100svh] w-full flex transition-colors duration-300 overflow-hidden relative">
      {/* ─── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={`poni-sidebar bg-[#0F172A] dark:bg-[#070B14] border-r border-slate-800/50 flex flex-col h-full fixed inset-y-0 left-0 lg:relative lg:inset-y-auto lg:left-auto lg:flex transition-all duration-300 ease-in-out z-40 shadow-2xl lg:shadow-none ${
          isSidebarExpanded ? 'w-64' : 'w-[84px]'
        } ${isMobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Header */}
        <div className="h-[56px] flex items-center px-5 border-b border-slate-800/60 justify-between shrink-0">
          <div
            className="group flex items-center gap-3 overflow-hidden"
          >
            <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-500 p-0.5 shadow-lg shadow-blue-500/20 transition-all duration-300 group-hover:scale-105 group-hover:shadow-blue-500/40">
              <div className="w-full h-full bg-[#0F172A] dark:bg-[#070B14] rounded-[0.7rem] p-1 flex items-center justify-center overflow-hidden">
                <img
                  src={APP_LOGO}
                  alt={`Logo ${APP_NAME}`}
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
            <span
              className={`overflow-hidden whitespace-nowrap font-bold text-lg tracking-tight text-white transition-[max-width,opacity,margin] duration-300 ${
                isExpanded ? 'ml-0 max-w-[160px] opacity-100' : 'ml-0 max-w-0 opacity-0'
              }`}
            >
              {APP_NAME}
            </span>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white flex-shrink-0 transition-colors p-1.5 rounded-lg hover:bg-slate-800"
            aria-label="Tutup menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tombol ciut dan melebar (desktop) */}
        <button
          onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
          className="hidden lg:flex absolute top-[84px] -right-3.5 w-7 h-7 bg-[#1E293B] dark:bg-[#0F172A] border border-slate-700/80 rounded-full items-center justify-center text-slate-400 hover:text-white shadow-lg transition-transform hover:scale-110 z-50 focus:outline-none"
          aria-label={isSidebarExpanded ? 'Ciutkan menu' : 'Perluas menu'}
        >
          {isSidebarExpanded ? <ChevronLeft className="w-4 h-4 ml-0.5" /> : <ChevronRight className="w-4 h-4 ml-0.5" />}
        </button>

        {/* Navigasi */}
        <nav className="flex-1 overflow-y-auto py-5 px-3.5 space-y-5 custom-scrollbar">
          {GROUP_ORDER.map(group => {
            const items = visiblePages.filter(page => page.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="space-y-1.5">
                <p
                  className={`px-3.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 transition-opacity duration-300 ${
                    isExpanded ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'
                  }`}
                >
                  {GROUP_LABELS[group]}
                </p>
                {items.map(page => {
                  const isActive = page.id === activePage;
                  const Icon = page.icon;
                  return (
                    <button
                      key={page.id}
                      onClick={() => {
                        setActivePage(page.id);
                        setIsMobileMenuOpen(false);
                      }}
                      onMouseEnter={() => void loadPageModule(page.id)}
                      onFocus={() => void loadPageModule(page.id)}
                      className={`w-full h-11 relative flex items-center rounded-xl text-left font-medium transition-all duration-200 group px-3.5 ${
                        isActive
                          ? 'bg-blue-600/10 text-blue-400'
                          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                      }`}
                      title={!isExpanded ? page.label : undefined}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeNav"
                          className="absolute left-0 top-2 bottom-2 w-1 bg-blue-500 rounded-r-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                        />
                      )}
                      <Icon
                        className={`w-5 h-5 shrink-0 transition-colors ${
                          isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'
                        }`}
                      />
                      <span
                        className={`truncate text-sm transition-[max-width,opacity,margin] duration-300 ${
                          isExpanded ? 'ml-3.5 max-w-[180px] opacity-100' : 'ml-0 max-w-0 opacity-0'
                        }`}
                      >
                        {page.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Footer: info akun + keluar */}
        <div className="mt-auto p-3.5 border-t border-slate-800/60 space-y-2.5 bg-gradient-to-b from-transparent to-slate-900/50 shrink-0">
          {currentUser && (
            <div
              className="min-h-[58px] overflow-hidden rounded-xl border border-slate-700/50 bg-[#1E293B]/50 p-3 backdrop-blur-sm"
              title={`Sesi: ${currentUser.username} (${currentUser.role})`}
            >
              <div
                className={`flex min-w-0 items-center transition-[gap,justify-content] duration-300 ${
                  isExpanded ? 'justify-start gap-2' : 'justify-center'
                }`}
              >
                <div
                  className={`min-w-0 overflow-hidden transition-[max-width,opacity] duration-300 ${
                    isExpanded ? 'max-w-[150px] flex-1 opacity-100' : 'max-w-0 opacity-0'
                  }`}
                >
                  <p className="mb-1.5 truncate text-[10px] font-bold uppercase leading-none tracking-widest text-slate-500">
                    {pegawai?.nama || 'Belum login server'}
                  </p>
                  <p className="truncate text-sm font-semibold text-slate-200">{currentUser.username}</p>
                </div>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider transition-colors duration-300 ${
                    currentUser.role === 'admin'
                      ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-400'
                      : 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                  }`}
                >
                  {isExpanded ? currentUser.role : currentUser.role === 'admin' ? 'ADM' : 'USR'}
                </span>
              </div>
            </div>
          )}

          <button
            onClick={() => setKonfirmasiKeluar(true)}
            className="w-full h-11 flex items-center rounded-xl text-left font-medium transition-all duration-200 group text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 px-3.5"
            title={!isExpanded ? 'Keluar Aplikasi' : undefined}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            <span
              className={`truncate text-sm transition-[max-width,opacity,margin] duration-300 ${
                isExpanded ? 'ml-3.5 max-w-[120px] opacity-100' : 'ml-0 max-w-0 opacity-0'
              }`}
            >
              Keluar
            </span>
          </button>
        </div>
      </aside>

      {/* Overlay menu mobile */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/70 z-30 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ─── Konten utama ────────────────────────────────────────────── */}
      {/*
        ⚠️ Tidak ada `blur` di sini. Dulu konten utama diberi
        `blur-sm` saat menu mobile terbuka, dan itu sangat berat:
        `filter: blur()` pada subtree besar + transisi 300ms membuat
        browser menyalin ulang dan mengaburkan seluruh halaman di
        setiap frame. Overlay gelap di atas (sudah ada) plus
        `pointer-events-none` sudah memberi efek "tidak aktif" yang
        sama tanpa biaya render.
      */}
      <div
        className={`flex-1 flex flex-col min-w-0 h-full min-h-0 relative overflow-hidden ${
          isMobileMenuOpen ? 'pointer-events-none lg:pointer-events-auto' : ''
        }`}
      >
        <header className="poni-header h-[56px] bg-slate-100/80 dark:bg-[#0B1120]/80 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3 transition-colors duration-300 shrink-0 z-20 shadow-sm dark:shadow-slate-900/50">
          {/*
           * `min-w-0 flex-1` di kiri, `shrink-0` di kanan.
           *
           * Tanpa itu, blok kiri memakai lebar naturalnya: judul halaman +
           * NIP/jabatan. Di HP 360 px, begitu panel developer ikut membuka
           * ruangnya, penjumlahannya melebihi lebar header — hasilnya judul
           * meluber sampai ke tombol akun, dan tombol akun terdorong keluar
           * header.
           *
           * `min-w-0` yang membuat `truncate` di dalam bisa bekerja: tanpa
           * itu, flex item menolak menyusut dan `overflow-hidden`-nya tidak
           * pernah aktif. `flex-1` memberi tahu browser ruang sisa topbar
           * dipakai untuk teks, dan `shrink-0` menjaga tombol di kanan agar
           * tidak ikut tergesot.
           */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors active:scale-95 shrink-0"
              aria-label="Buka menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex flex-col min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 truncate tracking-tight">
                {activePageData.label}
              </h2>
              {pegawai?.nama && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {pegawai.nip} · {pegawai.jabatan || '-'}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <Clock />

            <span
              className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
                serverConnected
                  ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${serverConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {serverConnected ? 'Terhubung' : 'Offline'}
            </span>

            {/* Diklik → dropdown berisi ganti password / kelola pengguna /
                keluar. Bukan lagi modal pengaturan akun yang panjang. */}
            {/*
             * Item "Keluar dari Server" **hanya muncul** kalau izinnya ada.
             *
             * Permintaan eksplisit: "kalau akun user nggak ada permission itu
             * maka nggak bisa logout dari akun server yang sudah ditetapkan,
             * jadi di kartu akunnya juga nggak ada logoutnya."
             *
             * Disembunyikan, bukan dinonaktifkan. Tombol yang selalu ada tapi
             * tidak bisa dipakailya hanya menimbulkan pertanyaan berulang
             * ("kenapa tidak bisa?") — dan tetap menyediakan jalan keluar lewat
             * pintu lain: dialog di Pengaturan Akun punya tombolnya sendiri.
             * Kalau aksinya memang dilarang, jalannya harus hilang total.
             *
             * `handleServerLogout()` tetap memeriksa izinnya lagi — dropdown
             * adalah tampilan, bukan penjaga. Kalau nanti ada pemanggil lain,
             * jalur ini tidak bisa dilewati diam-diam.
             */}
            <AkunDropdown
              displayName={namaDepan(pegawai?.nama) || currentUser?.username || 'Pengguna'}
              photoUrl={pegawai?.profilePic || undefined}
              role={currentUser?.role ?? 'user'}
              items={[
                {
                  // ⚠️ Sebelumnya item ini membuka SettingAkunModal, yaitu
                  // pengaturan akun PANEL (Firestore) — RPC `update_profil`
                  // tidak pernah terpanggil. Sekarang membuka modal yang
                  // benar-benar memanggil server pusat.
                  id: 'password',
                  label: 'Profil akun server',
                  hint: 'Ubah profil dan password di server',
                  icon: <KeyRound className="w-4 h-4 text-blue-500" />,
                  onClick: () => setIsProfilServerOpen(true),
                },
                {
                  id: 'akun-panel',
                  label: 'Akun Panel & Pengguna',
                  hint: 'Pengaturan akun panel ini, hak akses, dan mode pengembang',
                  icon: <Settings className="w-4 h-4 text-slate-500" />,
                  onClick: () => setIsAkunModalOpen(true),
                },
                ...(bolehKeluarServer
                  ? [
                      {
                        id: 'logout',
                        label: 'Keluar dari Server',
                        hint: 'Putuskan sesi dan kembali ke login',
                        icon: <LogOut className="w-4 h-4 text-rose-500" />,
                        tone: 'danger' as const,
                        onClick: () => setKonfirmasiKeluarServer(true),
                      },
                    ]
                  : []),
              ]}
            />

            <button
              onClick={toggleDarkMode}
              className="p-2 sm:p-2.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0 active:scale-95 border border-transparent dark:hover:border-slate-700"
              aria-label="Ganti tema"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/*
         * Banner kontrak server, di dalam kolom konten — bukan di luar
         * aplikasi, supaya ikut tergulir bersama halaman dan tidak menutupi
         * sidebar.
         *
         * Muncul hanya kalau server yang menjawab **tidak cocok** dengan
         * peramban — yaitu server autentikasi belum ter-deploy ulang. Tanpa
         * ini, "server versi lama" terlihat sebagai isi form yang tersimpan
         * tanpa sebab, dan tidak ada yang bisa menyadarinya.
         */}
        <BannerKontrakServer />
        <BannerServerPusat />

        {/* Satu-satunya area scroll halaman; scrollbar tetap di tepi shell. */}
        <div className="konten-gulir flex-1 flex flex-col min-w-0 min-h-0 overflow-y-scroll custom-scrollbar relative">
          <main className="poni-konten min-h-full flex-none min-w-0 overflow-x-hidden w-full">
            <div className="min-w-0 w-full">
              <PageErrorBoundary key={activePageData.id} pageId={activePageData.id}>
                <Suspense fallback={<PageLoading pageId={activePageData.id} />}>
                  <motion.div
                    key={activePageData.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <ActiveComponent />
                  </motion.div>
                </Suspense>
              </PageErrorBoundary>
            </div>
          </main>
        </div>
      </div>

      {isProfilServerOpen && <ProfilServerModal onClose={() => setIsProfilServerOpen(false)} />}
      {isAkunModalOpen && <SettingAkunModal onClose={() => setIsAkunModalOpen(false)} />}

      <ConfirmDialog
        open={konfirmasiKeluarServer}
        tone="danger"
        title="Keluar dari server pusat?"
        message={
          <>
            Token <span className="font-mono">api_key</span> akan dicabut di server. Anda kembali
            ke halaman login server dan harus memasukkan NIP, password, serta IMEI lagi.
          </>
        }
        confirmLabel="Ya, Keluar"
        cancelLabel="Batal"
        loading={isLoggingOut}
        onConfirm={() => void handleServerLogout()}
        onCancel={() => setKonfirmasiKeluarServer(false)}
      />

      <ConfirmDialog
        open={konfirmasiKeluar}
        tone="danger"
        title="Keluar dari aplikasi?"
        message={
          <>
            Anda akan kembali ke layar login akun panel dan harus login lagi. Sesi server pusat ikut
            terputus.
          </>
        }
        confirmLabel="Ya, Keluar"
        cancelLabel="Batal"
        onConfirm={() => {
          setKonfirmasiKeluar(false);
          onLogout();
        }}
        onCancel={() => setKonfirmasiKeluar(false)}
      />

      {/*
        * `onClose` meneruskan `setDeveloperMode(false)`, jadi tombol "×" benar-
        * benar mematikan panelnya.
        *
        * ⚠️ Sebelumnya tombol itu memanggil
        * `window.dispatchEvent(new Event('close-developer-inspector'))` — dan
        * **tidak ada listener untuk event itu di mana pun**. Tombolnya terlihat
        * berfungsi, dan sama sekali tidak melakukan apa-apa.
        */}
      <DeveloperInspector
        enabled={developerMode && (tabPermissions as unknown as Record<string, boolean>).tabDeveloper === true}
        onClose={() => setDeveloperMode(false)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Root
// ═══════════════════════════════════════════════════════════════════════

export default function App() {
  const { isDarkMode, toggleDarkMode } = useDarkMode();
  return (
    <AppProvider>
      <ToastProvider>
        <AppShell isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
      </ToastProvider>
    </AppProvider>
  );
}

function AppShell({ isDarkMode, toggleDarkMode }: { isDarkMode: boolean; toggleDarkMode: () => void }) {
  const {
    cekingSesi,
    currentUser,
    setCurrentUser,
    adaSesiSaatMuat,
  } = useAppContext();
  /*
   * `isAuthenticated` TIDAK lagi berarti "ada JSON di sessionStorage".
   *
   * Semula: `useState(() => !!loadSession())`. Itu membaca `currentUser` dan
   * `tabPermissions` apa adanya dari storage, jadi nilai `role` di sana
   * menentukan menu apa yang tampil — dan storage bisa disunting dari DevTools
   * atau, lebih buruk, ditulis bebas karena `firestore.rules` pernah membuka
   * `jatim_pengguna` untuk semua orang. Gejalanya persis yang dilaporkan:
   * "saya login user, terus refresh malah jadi admin".
   *
   * Sekarang: storage hanya menyimpan token bertanda tangan, dan `cekingSesi`
   * di provider menyatakan `true` sampai server memverifikasi token itu dan
   * mengembalikan peran yang dibaca ulang dari dokumen.
   *
    * Selama `cekingSesi`, tampilan disembunyikan tanpa layar login atau loader.
    * Setelah verifikasi, akun tampil; bila gagal, layar login kembali aktif.
    * `MainApp` tidak pernah dirender dengan hak yang belum diverifikasi.
   */
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  React.useLayoutEffect(() => {
    if (adaSesiSaatMuat || isAuthenticated) {
      document.documentElement.classList.add('app-shell-active');
      return () => document.documentElement.classList.remove('app-shell-active');
    }
    document.documentElement.classList.remove('app-shell-active');
  }, [adaSesiSaatMuat, isAuthenticated]);
  React.useEffect(() => {
    if (cekingSesi) return;
    setIsAuthenticated(currentUser !== null);
  }, [cekingSesi, currentUser]);

  const handleLogin = React.useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const handleLogout = React.useCallback(() => {
    setCurrentUser(null);
    setIsAuthenticated(false);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/login');
    }
  }, [setCurrentUser]);

  /*
   * Sesi idle.
   *
   * Dua lapis, dan keduanya perlu:
   *
   * - `watchdogUmum` (bawah) membuang sesi kedaluwarsa dari storage.
   * - `intervalToken` memanggil verifikasi token secara berkala.
   *
   * Kenapa yang kedua perlu: `loadSession()` hanya bisa memeriksa umur token
   * secara lokal, dan token bisa **dicabut server** kapan saja — admin yang
   * menonaktifkan akun, atau `nonaktif` yang berubah. Tanpa pemeriksaan
   * berkala, orang itu tetap punya sesi penuh sampai menutup tab.
   *
   * Jeda 5 menit, bukan 10 seperti sebelumnya: verifikasi selesai di RAM dan
   * satu request kecil, sementara henti aksesnya bisa berjam-jam. `cekingSesi`
   * sengaja **tidak** dinaikkan saat pemeriksaan ini berjalan — hasilnya hanya
   * berlaku kalau token ditolak, dan menolak membuat pengguna langsung
   * dikeluarkan, bukan ditahan di layar "memeriksa".
   */
  React.useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return;

    let berhenti = false;

    const watchdogUmum = () => {
      if (!loadSession()) handleLogout();
    };

    /*
     * Perpanjang sesi — **dibatasi lajunya**.
     *
     * Semuanya `mousedown`, `keydown`, `scroll`, `touchstart`, dan `click`
     * memanggil `touchSession()` secara langsung. `touchSession()` memanggil
     * `loadSession()`, yang menelusuri seluruh kunci `sessionStorage` dan
     * `JSON.parse` isinya — lalu `setItem` lagi. Itu-blocking di thread utama,
     * dan event seperti `scroll` bisa turun **ratus** kali per detik saat
     * pengguna sedang menggulir.
     *
     * Yang terjadi di layar: menggulir halaman terasa berat, dan setiap
     * ketukan mouse memicu seluruh parse storage. Sesi tidak perlu
     * diperpanjang lebih dari sekali per ~30 detik — `authTime` hanya dibaca
     * untuk menghitung idle timeout, jadi presisi di bawah itu tidak
     * menambah apa pun.
     *
     * `click` juga dihapus dari daftar: `mousedown` sudah menyala pada
     * interaksi yang sama, jadi itu penulisan ganda yang tidak pernah
     * terlihat.
     */
    const PERPANJANG_MIN_MS = 30_000;
    let terakhirPerpanjang = Date.now();
    const perpanjang = () => {
      const sekarang = Date.now();
      if (sekarang - terakhirPerpanjang < PERPANJANG_MIN_MS) return;
      terakhirPerpanjang = sekarang;
      touchSession();
    };

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(event => window.addEventListener(event, perpanjang, { passive: true }));

    /*
     * Pembuang sesi kedaluwarsa.
     *
     * `loadSession()` sudah memeriksa umur secara lokal, jadi tidak perlu
     * request server — cukup baca storage. 10 detik cukup: `perpanjang`
     * sudah menjamin `authTime` selalu mutakhir, jadi sesi benar-benar
     * kedaluwarsa hanya terjadi setelah 30 menit tanpa interaksi, dan
     * `periksaToken` di bawah akan menolaknya juga.
     */
    const intervalUmum = setInterval(watchdogUmum, 10_000);

    const periksaToken = async () => {
      const sesi = loadSession();
      if (!sesi || berhenti) return;
      try {
        const hasil = await verifikasiSesiPanel(sesi.token);
        if (berhenti) return;
        if (hasil.tokenBaru) perbaruiTokenSesi(hasil.tokenBaru);
      } catch (err) {
        /*
         * Token ditolak: kedaluwarsa, dicabut, atau akun dinonaktifkan.
         *
         * Jaringan mati **tidak** dihitung di sini: `verifikasiSesiPanel`
         * melempar `PanelAuthError` dengan `kode: 0` kalau `fetch` gagal, dan
         * itu ditahan. Jangan mengunci orang yang sedang offline — dia masih
         * punya token yang sah, hanya tidak bisa memverifikasi sekarang.
         */
        if (berhenti) return;
        if (err instanceof PanelAuthError && err.kode === 0) return;
        handleLogout();
      }
    };

    const intervalToken = setInterval(() => void periksaToken(), 5 * 60 * 1000);

    return () => {
      berhenti = true;
      activityEvents.forEach(event => window.removeEventListener(event, perpanjang));
      clearInterval(intervalUmum);
      clearInterval(intervalToken);
    };
  }, [isAuthenticated, handleLogout]);

  return (
    <>
        {/* Workspace baru dirender setelah server mengonfirmasi sesi tersimpan. */}
      {cekingSesi ? (
        <div className="fixed inset-0 bg-slate-50 dark:bg-[#0B1120]" aria-hidden="true" />
      ) : !isAuthenticated && !currentUser ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          style={{ minHeight: '100svh' }}
        >
          <LoginScreen
            onLogin={handleLogin}
            isDarkMode={isDarkMode}
            toggleDarkMode={toggleDarkMode}
          />
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className="h-dvh overflow-hidden"
        >
          {/*
            ⚠️ Gerbang langganan membungkus SELURUH aplikasi, termasuk
            sidebar dan topbar. Menempatkannya hanya di area konten akan
            menyisakan tombol yang bisa membuka halaman lain — jadi
            "wajib bayar" tidak benar-benar wajib. Pengecualian hanya dua:
            akun admin, dan akun yang ditandai gratis oleh admin.
          */}
          <GerbangLangganan
            onKeluar={handleLogout}
          >
            <MainApp onLogout={handleLogout} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />
          </GerbangLangganan>
        </motion.div>
      )}
    </>
  );
}
