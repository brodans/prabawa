import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ImageLightbox from '../components/ui/ImageLightbox';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Monitor,
  Cpu,
  UserSquare2,
  FileText,
  LogIn,
  LogOut,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Map,
  Eye,
  EyeOff,
  Download,
  X,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Shield,
} from 'lucide-react';
import {
  ambilBerkas,
  ambilDetailPegawai,
  ambilIjinPegawai,
  ambilImei,
  ambilKehadiran,
  ambilLatlong,
  ambilPerizinan,
  login,
  logout,
  muatCaptcha,
  selesaikanCaptcha,
  urlBerkas,
  type BarisIjin,
  type BarisKehadiran,
  type DetailPegawai,
  type HasilImei,
  type HasilKehadiran,
  type HasilPerizinan,
} from '../lib/webPresensi';
import { useAppContext, type WebPresensiTab } from '../context/AppContext';

// ═══════════════════════════════════════════════════════════════════════
//  Konstanta
// ═══════════════════════════════════════════════════════════════════════

/**
 * Berapa kali mencoba captcha baru sebelum menyerah dan meminta input manual.
 *
 * Hanya dipakai kalau `OCR_LOKAL` — di produksi tidak ada percobaan ulang.
 */
const MAX_PERCOBAAN_OCR = 3;
const KUNCI_SESI_WEB = 'prabawa:web-presensi-session';

interface SesiWebTersimpan {
  versi: 1;
  username: string;
  nip: string;
  hasilImei: HasilImei;
  tab: WebPresensiTab;
}

function hapusSesiWeb() {
  try {
    sessionStorage.removeItem(KUNCI_SESI_WEB);
  } catch (error) {
    console.warn('Status sesi Web Presensi tidak dapat dihapus dari browser.', error);
  }
}

function bacaSesiWeb(username: string): SesiWebTersimpan | null {
  try {
    const raw = sessionStorage.getItem(KUNCI_SESI_WEB);
    if (!raw) return null;
    const nilai: unknown = JSON.parse(raw);
    if (
      typeof nilai !== 'object' || nilai === null || Array.isArray(nilai)
    ) {
      hapusSesiWeb();
      return null;
    }
    const record = nilai as Record<string, unknown>;
    const hasil = record.hasilImei;
    if (typeof hasil !== 'object' || hasil === null || Array.isArray(hasil)) {
      hapusSesiWeb();
      return null;
    }
    const imeiRecord = hasil as Record<string, unknown>;
    const profil = imeiRecord.profil;
    const profilValid = profil === null || (
      typeof profil === 'object' && profil !== null && !Array.isArray(profil) &&
      'nama' in profil && typeof profil.nama === 'string' &&
      'nip' in profil && typeof profil.nip === 'string'
    );
    if (
      record.versi !== 1 ||
      record.username !== username ||
      typeof record.nip !== 'string' ||
      (imeiRecord.imei !== null && typeof imeiRecord.imei !== 'string') ||
      !profilValid ||
      !['imei', 'kehadiran', 'detail', 'perizinan'].includes(String(record.tab))
    ) {
      hapusSesiWeb();
      return null;
    }

    return {
      versi: 1,
      username,
      nip: record.nip,
      hasilImei: {
        imei: imeiRecord.imei as string | null,
        profil: profil as HasilImei['profil'],
      },
      tab: record.tab as WebPresensiTab,
    };
  } catch (error) {
    console.warn('Status sesi Web Presensi tersimpan tidak dapat dibaca.', error);
    hapusSesiWeb();
    return null;
  }
}

function adaSesiWebTersimpan(username: string): boolean {
  if (!username) return false;
  try {
    return sessionStorage.getItem(KUNCI_SESI_WEB) !== null;
  } catch (error) {
    console.warn('Status sesi Web Presensi tidak dapat diperiksa dari browser.', error);
    return false;
  }
}

/**
 * Apakah captcha boleh diisi otomatis.
 *
 * `import.meta.env.DEV` bernilai `true` **hanya** di `npm run dev`, dan `false`
 * di build produksi. Itu persis batas yang diinginkan: OCR tetap jalan saat
 * developers locally, dan tidak pernah menyentuh jaringan di Vercel.
 *
 * ## Kenapa produksi tidak memakai OCR
 *
 * Modelnya adalah `onnxruntime-node` — 844 MB di `node_modules`, dan itu yang
 * membuat storage Function Vercel melonjak. Setelah dipangkas masih 38 MB per
 * deployment, tapi-stubbornly itu adalah **biaya** untuk fitur yang bisa
 * dihindari: captcha 4 digit yang bisa diketik orang dalam dua detik.
 *
 * Menghapus `api/ocr.ts` dari Vercel membuat storage function turun ke handful
 * MB, dan satu dependensi native (beserta advisory-nya) hilang dari produksi.
 *
 * Vite dead-code-eliminates blok OCR di build produksi, jadi `fetch` ke
 * `/api/ocr` benar-benar tidak ada di bundle — bukan sekadar tidak terpakai.
 */
const OCR_LOKAL = import.meta.env.DEV;

const DAFTAR_TAB = [
  { id: 'imei',      label: 'IMEI',          icon: Cpu },
  { id: 'kehadiran', label: 'Kehadiran',      icon: Monitor },
  { id: 'detail',    label: 'Detail Pegawai', icon: UserSquare2 },
  { id: 'perizinan', label: 'Perizinan',      icon: FileText },
] as const;

// TabId sekarang dari context (WebPresensiTab)

// ═══════════════════════════════════════════════════════════════════════
//  Helper: pisah & format tanggal+jam dari string datetime server
// ═══════════════════════════════════════════════════════════════════════

/**
 * Format tanggal ke DD/MM/YYYY dari berbagai format input.
 * Format yang mungkin datang dari server e-Presensi:
 *   "2025-04-01"       → "01/04/2025"
 *   "01-04-2025"       → "01/04/2025"
 *   "01/04/2025"       → "01/04/2025"
 *   "2025/04/01"       → "01/04/2025"
 */
function formatTanggal(raw: string): string {
  if (!raw || raw === '—') return raw;
  const bersih = raw.trim();

  // ISO: YYYY-MM-DD atau YYYY/MM/DD
  const isoM = bersih.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoM) return `${isoM[3].padStart(2,'0')}/${isoM[2].padStart(2,'0')}/${isoM[1]}`;

  // DD-MM-YYYY atau DD/MM/YYYY
  const dmyM = bersih.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyM) return `${dmyM[1].padStart(2,'0')}/${dmyM[2].padStart(2,'0')}/${dmyM[3]}`;

  // Sudah dalam format lain yang tidak dikenali — kembalikan apa adanya
  return bersih;
}

/**
 * Pisah string datetime menjadi { tanggal, jam }.
 * Output tanggal selalu dalam format DD/MM/YYYY.
 * Jam dalam format HH:MM:SS atau HH:MM (hapus detik jika :00).
 */
function pisahWaktu(raw: string): { tanggal: string; jam: string } {
  if (!raw || !raw.trim() || raw.trim() === '—') return { tanggal: '—', jam: '' };

  const bersih = raw.trim();

  // ISO dengan T: "2025-04-01T07:30:45[.000Z]"
  if (bersih.includes('T')) {
    const [tglPart, jamPart] = bersih.split('T');
    const jamBersih = jamPart.replace(/\.\d+Z?$/, '');
    return { tanggal: formatTanggal(tglPart), jam: jamBersih };
  }

  // "YYYY-MM-DD HH:MM:SS" atau "DD-MM-YYYY HH:MM:SS" dll. (spasi sebagai pemisah)
  const spaceIdx = bersih.search(/\s+/);
  if (spaceIdx > 0) {
    const tglPart = bersih.slice(0, spaceIdx).trim();
    const jamPart = bersih.slice(spaceIdx).trim();
    // Validasi jam: harus mengandung ":" agar tidak salah parse "1 April 2025" dst.
    if (/^\d{1,2}:\d{2}/.test(jamPart)) {
      return { tanggal: formatTanggal(tglPart), jam: jamPart };
    }
    // Format multi-kata ("01 Apr 2025 07:30") — pisah dari belakang
    const bagian = bersih.split(/\s+/);
    const jamKandidat = bagian[bagian.length - 1];
    if (/^\d{1,2}:\d{2}/.test(jamKandidat)) {
      const tglBagian = bagian.slice(0, -1).join(' ');
      return { tanggal: formatTanggal(tglBagian), jam: jamKandidat };
    }
    // Tidak ada jam — kembalikan seluruh string sebagai tanggal
    return { tanggal: formatTanggal(bersih), jam: '' };
  }

  // Hanya tanggal tanpa jam
  return { tanggal: formatTanggal(bersih), jam: '' };
}

function CellWaktu({ nilai }: { nilai: string }) {
  const { tanggal, jam } = pisahWaktu(nilai);
  if (tanggal === '—' && !jam) return <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>;
  return (
    <div>
      <div className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{tanggal}</div>
      {jam && <div className="font-mono text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{jam}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Komponen UI kecil
// ═══════════════════════════════════════════════════════════════════════

function Lencana({ nilai, ya = 'Disetujui', tidak = 'Ditolak' }: { nilai: boolean | null; ya?: string; tidak?: string }) {
  if (nilai === true)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <Check className="w-3 h-3" />
        {ya}
      </span>
    );
  if (nilai === false)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
        <X className="w-3 h-3" />
        {tidak}
      </span>
    );
  return <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>;
}

function Pesan({ tipe, children }: { tipe: 'info' | 'error' | 'sukses'; children: React.ReactNode }) {
  const kelas = {
    info:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800/40',
    error:  'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800/40',
    sukses: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/40',
  }[tipe];
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${kelas}`}>
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function SkeletonBaris({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="animate-pulse">
      {[...Array(cols)].map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <div className="h-3.5 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${55 + (i * 13) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Modal profesional dengan animasi dan bezel tipis
// ═══════════════════════════════════════════════════════════════════════

type ModalProps = {
  judul: string;
  onTutup: () => void;
  children: React.ReactNode;
  lebar?: boolean;
  kotak?: boolean;
  /** Untuk modal gambar/PDF — padding minimal */
  mediaMod?: boolean;
};

function Modal({ judul, onTutup, children, lebar = false, kotak = false, mediaMod = false }: ModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger masuk animation
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  function tutup() {
    setVisible(false);
    // Tunggu animasi keluar selesai sebelum unmount
    setTimeout(onTutup, 180);
  }

  useEffect(() => {
    function esc(e: KeyboardEvent) { if (e.key === 'Escape') tutup(); }
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxW = lebar ? 'max-w-4xl' : kotak ? 'max-w-sm' : 'max-w-lg';

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 transition-all duration-150 ${
        visible ? 'bg-black/40 backdrop-blur-[2px]' : 'bg-black/0 backdrop-blur-none'
      }`}
      onClick={tutup}
      role="presentation"
    >
      <div
        className={`relative bg-white dark:bg-slate-900 rounded-2xl flex flex-col
          max-h-[92vh] w-full ${maxW}
          border border-slate-200/80 dark:border-slate-700/80
          shadow-2xl shadow-black/20 dark:shadow-black/60
          transition-all duration-180 ease-out
          ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.97] translate-y-2'}
        `}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={judul}
      >
        {/* Header tipis */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate pr-4">{judul}</h3>
          <button
            type="button"
            onClick={tutup}
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Konten */}
        <div className={`overflow-y-auto flex-1 ${mediaMod ? 'p-0' : 'p-5'}`}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Viewer berkas — gambar + PDF profesional
// ═══════════════════════════════════════════════════════════════════════

type BerkasState = { nama: string; url: string | null; tipe: string; loading: boolean; err: string };

function ViewerBerkas({ berkas, onTutup }: { berkas: BerkasState; onTutup: () => void }) {
  const isPdf   = /pdf/i.test(berkas.tipe);
  const isImage = /^image\//i.test(berkas.tipe);

  // Loading/error tetap pakai Modal biasa
  if (berkas.loading || berkas.err || !berkas.url) {
    return (
      <Modal judul={berkas.nama} onTutup={onTutup} lebar>
        {berkas.loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            <span className="text-sm">Memuat berkas...</span>
          </div>
        )}
        {berkas.err && <div className="p-5"><Pesan tipe="error">{berkas.err}</Pesan></div>}
      </Modal>
    );
  }

  // Foto — pakai ImageLightbox fullscreen
  if (isImage) {
    return (
      <ImageLightbox
        src={berkas.url}
        title={berkas.nama}
        onClose={onTutup}
      />
    );
  }

  // PDF — iframe
  if (isPdf) {
    return (
      <Modal judul={berkas.nama} onTutup={onTutup} lebar mediaMod>
        <iframe
          src={berkas.url}
          title={berkas.nama}
          className="w-full rounded-b-2xl"
          style={{ height: '78vh', border: 'none' }}
        />
      </Modal>
    );
  }

  // Tipe lain — unduh saja
  return (
    <Modal judul={berkas.nama} onTutup={onTutup} lebar>
      <div className="p-5 space-y-3">
        <Pesan tipe="info">Pratinjau tidak tersedia untuk tipe: {berkas.tipe || 'tidak diketahui'}.</Pesan>
        <a
          href={berkas.url}
          download={berkas.nama}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          <Download className="w-4 h-4" />
          Unduh berkas
        </a>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Peta Leaflet
// ═══════════════════════════════════════════════════════════════════════

function Peta({ lat, lng, judul }: { lat: number; lng: number; judul?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<ReturnType<typeof L.map> | null>(null);
  const markerRef = useRef<ReturnType<typeof L.circleMarker> | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const map = L.map(el, { zoomControl: true }).setView([lat, lng], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const marker = L.circleMarker([lat, lng], { radius: 9, color: '#4f46e5', weight: 3, fillColor: '#4f46e5', fillOpacity: 0.5 })
      .addTo(map)
      .bindPopup(judul || 'Lokasi presensi')
      .openPopup();
    mapRef.current = map;
    markerRef.current = marker;

    // ResizeObserver memastikan peta resize mengikuti container tanpa animasi glitch
    let rafId: number;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => map.invalidateSize());
    });
    ro.observe(el);
    // Paksa invalidate sekali setelah mount
    const t = setTimeout(() => map.invalidateSize(), 50);

    return () => {
      clearTimeout(t);
      cancelAnimationFrame(rafId);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLatLng([lat, lng]).bindPopup(judul || 'Lokasi presensi').openPopup();
    map.setView([lat, lng], map.getZoom(), { animate: false });
  }, [lat, lng, judul]);
  return <div ref={ref} className="aspect-square w-full rounded-b-2xl overflow-hidden" />;
}

// ═══════════════════════════════════════════════════════════════════════
//  Paginasi
// ═══════════════════════════════════════════════════════════════════════

function Paginasi({ halaman, totalHalaman, onPilih, disabled }: { halaman: number; totalHalaman: number; onPilih: (h: number) => void; disabled?: boolean }) {
  if (!totalHalaman || totalHalaman <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-4">
      <button type="button" onClick={() => onPilih(halaman - 1)} disabled={disabled || halaman <= 1}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:bg-slate-800 transition-colors">
        <ChevronLeft className="w-4 h-4" />Sebelumnya
      </button>
      <span className="text-sm text-slate-500 dark:text-slate-400">{halaman} / {totalHalaman}</span>
      <button type="button" onClick={() => onPilih(halaman + 1)} disabled={disabled || halaman >= totalHalaman}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed dark:text-slate-400 dark:hover:bg-slate-800 transition-colors">
        Berikutnya<ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Tabel
// ═══════════════════════════════════════════════════════════════════════

function Tabel({ kolom, children, lebar }: { kolom: string[]; children: React.ReactNode; lebar?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className={`text-sm ${lebar || 'w-full'}`}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
            {kolom.map((k) => (
              <th key={k} className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 whitespace-nowrap">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">{children}</tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Aplikasi utama
// ═══════════════════════════════════════════════════════════════════════

export default function WebPresensi() {
  // ── State yang di-persist ke AppContext (bertahan saat pindah menu) ──
  const { webPresensiState, setWebPresensiState, currentUser } = useAppContext();
  const username = currentUser?.username ?? '';

  const sudahLogin = webPresensiState.sudahLogin;
  const hasilImei  = webPresensiState.hasilImei;
  const tab        = webPresensiState.tab;
  const kehadiran  = webPresensiState.kehadiran;
  const detail     = webPresensiState.detail;
  const ijinAjax   = webPresensiState.ijinAjax;
  const perizinan  = webPresensiState.perizinan;
  const semuaPerizinan = webPresensiState.semuaPerizinan;

  /** Helper untuk update sebagian field WebPresensiState. */
  const patch = useCallback(
    (updates: Partial<typeof webPresensiState>) =>
      setWebPresensiState((prev) => ({ ...prev, ...updates })),
    [setWebPresensiState]
  );

  const setSudahLogin      = useCallback((v: boolean)                    => patch({ sudahLogin: v }), [patch]);
  const setPemilikSesi     = useCallback((v: string | null)               => patch({ pemilikSesi: v }), [patch]);
  const setHasilImei       = useCallback((v: HasilImei | null)           => patch({ hasilImei: v }), [patch]);
  const setTab             = useCallback((v: typeof tab)                 => patch({ tab: v }), [patch]);
  const setKehadiran       = useCallback((v: HasilKehadiran | null)      => patch({ kehadiran: v }), [patch]);
  const setDetail          = useCallback((v: DetailPegawai | null)       => patch({ detail: v }), [patch]);
  const setIjinAjax        = useCallback((v: BarisIjin[] | null)         => patch({ ijinAjax: v }), [patch]);
  const setPerizinan       = useCallback((v: HasilPerizinan | null)      => patch({ perizinan: v }), [patch]);
  const setSemuaPerizinan  = useCallback((v: BarisIjin[] | null)         => patch({ semuaPerizinan: v }), [patch]);

  // ── State UI ephemeral (lokal, boleh hilang saat unmount) ────────────
  // Form login
  const [nip, setNip]               = useState('');
  const [password, setPassword]     = useState('');
  const [lihatPassword, setLihatPassword] = useState(false);
  const [captcha, setCaptcha]       = useState('');
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [captchaInfo, setCaptchaInfo] = useState('');
  const [ocrTersedia, setOcrTersedia] = useState<boolean | null>(null);

  // Loading & status
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);
  const [loadingProses, setLoadingProses]   = useState(false);
  const [loadingLogout, setLoadingLogout]   = useState(false);
  const [memulihkanSesi, setMemulihkanSesi] = useState(() => adaSesiWebTersimpan(username));

  const [error, setError]   = useState('');
  const [status, setStatus] = useState('');
  const [copied, setCopied]           = useState('');

  // Data per tab — loading & error tetap lokal
  const [kehadiranErr, setKehadiranErr]     = useState('');
  const [kehadiranLoading, setKehadiranLoading] = useState(false);

  const [detailErr, setDetailErr]           = useState('');
  const [detailLoading, setDetailLoading]   = useState(false);
  const [ijinAjaxErr, setIjinAjaxErr]       = useState('');
  const [ijinAjaxLoading, setIjinAjaxLoading] = useState(false);

  const [perizinanErr, setPerizinanErr]     = useState('');
  const [perizinanLoading, setPerizinanLoading] = useState(false);
  const [memuatSemua, setMemuatSemua]       = useState(false);

  type PetaState = { judul: string; lat: number | null; lng: number | null; loading?: boolean; err: string; sumber?: string; alamat?: string };
  const [peta, setPeta]     = useState<PetaState | null>(null);
  const [berkas, setBerkas] = useState<BerkasState | null>(null);

  const captchaRef = useRef('');
  /**
   * `dimuatRef` merefleksikan `webPresensiState.dimuat` agar callback
   * yang ter-close tidak membaca nilai basi dari ref.
   */
  const dimuatRef  = useRef(webPresensiState.dimuat);

  // Sinkronisasi dimuatRef dengan context state supaya callback async
  // selalu melihat nilai terbaru tanpa membutuhkan re-render.
  useEffect(() => {
    dimuatRef.current = webPresensiState.dimuat;
  }, [webPresensiState.dimuat]);

  function simpanCaptcha(nilai: string) {
    captchaRef.current = nilai;
    setCaptcha(nilai);
  }

  // ── Refresh captcha ────────────────────────────────────────────────
  const refreshCaptcha = useCallback(async (alasan = '') => {
    setLoadingCaptcha(true);
    simpanCaptcha('');
    setCaptchaInfo(alasan || 'Memuat captcha...');

    let blob: Blob | null = null;

    try {
      const hasil = await muatCaptcha();
      setCaptchaImg(hasil.url);
      setCaptchaInfo(
        (alasan ? alasan + ' ' : '') +
          (OCR_LOKAL ? 'Membaca captcha otomatis...' : 'Ketik kode captcha dari gambar di atas.')
      );
      blob = hasil.blob;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCaptchaImg(null);
      setOcrTersedia(false);
      setCaptchaInfo(`⚠ Gagal memuat captcha — ${msg}. Klik ikon refresh untuk coba lagi.`);
      setLoadingCaptcha(false);
      return '';
    }

    /*
     * Percobaan OCR hanya ada di build dev.
     *
     * `OCR_LOKAL` adalah `import.meta.env.DEV`, yang Vite ganti jadi `false`
     * saat build produksi. Karena itu cabang `if (OCR_LOKAL)` berikut di-constant-
     * fold dan seluruh isinya — termasuk pemanggilan `selesaikanCaptcha` —
     * dibuang oleh minifier. `/api/ocr` tidak ada di bundle Vercel sama sekali,
     * bukan sekadar tak terpakai.
     *
     * Bentuknya `if` lalu `return`, bukan syarat di `for`, karena minifier
     * membuang blok `if (false)` secara utuh. Syarat di `for` hanya membuat
     * body jadi tidak terjangkau. Minifier biasanya membuangnya juga, tapi itu
     * bergantung keadaannya dan tidak layak untuk diandalkan.
     */
    if (OCR_LOKAL) {
      try {
        for (let i = 1; i <= MAX_PERCOBAAN_OCR; i++) {
          const hasilOcr = await selesaikanCaptcha(blob);
          if (hasilOcr.teks) {
            simpanCaptcha(hasilOcr.teks);
            setOcrTersedia(true);
            setCaptchaInfo(
              (alasan ? alasan + ' ' : '') +
                `Terbaca: ${hasilOcr.teks}` +
                (hasilOcr.yakin ? ' ✓' : ' (kurang yakin — ketik ulang jika perlu)')
            );
            setLoadingCaptcha(false);
            return hasilOcr.teks;
          }
          if (i < MAX_PERCOBAAN_OCR) {
            setCaptchaInfo(`Mencoba captcha baru (${i}/${MAX_PERCOBAAN_OCR})...`);
            try {
              const { url: url2, blob: blob2 } = await muatCaptcha();
              setCaptchaImg(url2);
              blob = blob2;
            } catch { break; }
          }
        }
      } catch {
        // Gagal memanggil /api/ocr (mis. ocr_service.py belum jalan di lokal).
        // Falls through ke input manual di bawah.
      }
    }

    setOcrTersedia(false);
    setCaptchaInfo('Ketik kode captcha dari gambar di atas.');
    setLoadingCaptcha(false);
    return '';
  }, []);

  useEffect(() => {
    let hidup = true;
    if (sudahLogin && webPresensiState.pemilikSesi === username) {
      setMemulihkanSesi(false);
      return () => { hidup = false; };
    }
    if (sudahLogin) {
      patch({
        sudahLogin: false,
        pemilikSesi: null,
        hasilImei: null,
        tab: 'imei',
        kehadiran: null,
        detail: null,
        ijinAjax: null,
        perizinan: null,
        semuaPerizinan: null,
        dimuat: { kehadiran: false, detail: false, perizinan: false },
      });
    }
    const tersimpan = username ? bacaSesiWeb(username) : null;
    if (!tersimpan) {
      setMemulihkanSesi(false);
      if (!sudahLogin) void refreshCaptcha();
      return () => { hidup = false; };
    }

    setMemulihkanSesi(true);
    setError('');
    setStatus('Memverifikasi sesi Web Presensi...');
    void ambilImei()
      .then((hasil) => {
        if (!hidup) return;
        const hasilTerverifikasi = {
          ...hasil,
          profil: hasil.profil ?? tersimpan.hasilImei.profil ?? (
            tersimpan.nip ? { nama: '', nip: tersimpan.nip } : null
          ),
        };
        setHasilImei(hasilTerverifikasi);
        setSudahLogin(true);
        setPemilikSesi(username);
        setTab(tersimpan.tab);
        dimuatRef.current = { kehadiran: false, detail: false, perizinan: false };
      })
      .catch((error: unknown) => {
        if (!hidup) return;
        const err = error as Error & { sesiHabis?: boolean };
        if (err.sesiHabis) hapusSesiWeb();
        setError(err.sesiHabis
          ? 'Sesi Web Presensi sudah berakhir. Silakan login kembali.'
          : `Gagal memverifikasi sesi Web Presensi: ${err.message}`);
        void refreshCaptcha();
      })
      .finally(() => {
        if (!hidup) return;
        setMemulihkanSesi(false);
        setStatus('');
      });

    return () => { hidup = false; };
  // Sesi diperiksa sekali setiap halaman Web Presensi dipasang.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  useEffect(() => {
    if (!sudahLogin || !username || !hasilImei) return;
    const sesi: SesiWebTersimpan = {
      versi: 1,
      username,
      nip: hasilImei.profil?.nip ?? nip.trim(),
      hasilImei,
      tab,
    };
    try {
      sessionStorage.setItem(KUNCI_SESI_WEB, JSON.stringify(sesi));
    } catch (error) {
      console.warn('Status sesi Web Presensi tidak dapat disimpan.', error);
      setError('Login berhasil, tetapi status sesi tidak dapat disimpan di browser ini.');
    }
  }, [sudahLogin, username, hasilImei, tab, nip]);

  // ── Kosongkan data sesi ────────────────────────────────────────────
  const kosongkanData = useCallback(() => {
    setHasilImei(null);
    setKehadiran(null);   setKehadiranErr('');
    setDetail(null);      setDetailErr('');
    setIjinAjax(null);    setIjinAjaxErr('');
    setPerizinan(null);   setPerizinanErr('');
    setSemuaPerizinan(null);
    setPeta(null);
    dimuatRef.current = { kehadiran: false, detail: false, perizinan: false };
  }, []);

  type ApiError = Error & { sesiHabis?: boolean };

  const tanganiSesiHabis = useCallback(
    async (pesan = 'Sesi berakhir, silakan login ulang.') => {
      hapusSesiWeb();
      setSudahLogin(false);
      setPemilikSesi(null);
      kosongkanData();
      setTab('imei');
      setError(pesan);
      await refreshCaptcha('Captcha baru dimuat.');
    },
    [kosongkanData, refreshCaptcha]
  );

  const jalankan = useCallback(
    function jalankanImpl<T>(opts: {
      fn: () => Promise<T>;
      setData: (d: T) => void;
      setErr: (e: string) => void;
      setLoading: (b: boolean) => void;
    }) {
      const { fn, setData, setErr, setLoading } = opts;
      setErr('');
      setLoading(true);
      return fn()
        .then((data) => { setData(data); return data as T | null; })
        .catch(async (e: unknown) => {
          const err = e as ApiError;
          if (err.sesiHabis) await tanganiSesiHabis(err.message);
          else setErr(err.message);
          return null as T | null;
        })
        .finally(() => setLoading(false));
    },
    [tanganiSesiHabis]
  );

  const muatKehadiran = useCallback(
    (halaman = 1) => jalankan({ fn: () => ambilKehadiran({ halaman }), setData: setKehadiran, setErr: setKehadiranErr, setLoading: setKehadiranLoading }),
    [jalankan]
  );

  const muatDetail = useCallback(
    () => jalankan({
      fn: async () => {
        const d = await ambilDetailPegawai();
        if (d.idPegawai) {
          setIjinAjaxErr(''); setIjinAjaxLoading(true);
          try {
            const ij = await ambilIjinPegawai(d.idPegawai);
            setIjinAjax(ij.baris);
          } catch (e) {
            const err = e as ApiError;
            if (err.sesiHabis) await tanganiSesiHabis(err.message);
            else setIjinAjaxErr(err.message);
          } finally { setIjinAjaxLoading(false); }
        }
        return d;
      },
      setData: setDetail, setErr: setDetailErr, setLoading: setDetailLoading,
    }),
    [jalankan, tanganiSesiHabis]
  );

  const muatPerizinan = useCallback(
    (halaman = 1) => jalankan({ fn: () => ambilPerizinan({ halaman }), setData: setPerizinan, setErr: setPerizinanErr, setLoading: setPerizinanLoading }),
    [jalankan]
  );

  const muatSemuaPerizinan = useCallback(async () => {
    setPerizinanErr(''); setMemuatSemua(true);
    try {
      const pertama = await ambilPerizinan({ halaman: 1 });
      let semua = [...pertama.baris];
      for (let p = 2; p <= pertama.totalHalaman; p++) {
        setStatus(`Memuat halaman ${p}/${pertama.totalHalaman}...`);
        semua = semua.concat((await ambilPerizinan({ halaman: p })).baris);
      }
      setSemuaPerizinan(semua);
      setStatus(`${semua.length} baris dari ${pertama.totalHalaman} halaman.`);
    } catch (e) {
      const err = e as ApiError;
      if (err.sesiHabis) await tanganiSesiHabis(err.message);
      else setPerizinanErr(err.message);
    } finally {
      setMemuatSemua(false);
      setTimeout(() => setStatus(''), 4000);
    }
  }, [tanganiSesiHabis]);

  useEffect(() => {
    if (!sudahLogin) return;
    if (tab === 'kehadiran' && !dimuatRef.current.kehadiran) { dimuatRef.current.kehadiran = true; muatKehadiran(1); }
    if (tab === 'detail'    && !dimuatRef.current.detail)    { dimuatRef.current.detail    = true; muatDetail(); }
    if (tab === 'perizinan' && !dimuatRef.current.perizinan) { dimuatRef.current.perizinan = true; muatPerizinan(1); }
  }, [tab, sudahLogin, muatKehadiran, muatDetail, muatPerizinan]);

  // ── Login ──────────────────────────────────────────────────────────
  async function proses(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setHasilImei(null); setLoadingProses(true);
    try {
      const kode = captchaRef.current.trim();
      if (!kode) { setError('Captcha belum terisi. Tunggu OCR selesai atau ketik manual.'); return; }
      await login({ nip: nip.trim(), password, captcha: kode });
      setStatus('Mengambil IMEI...');
      const data = await ambilImei();
      setHasilImei(data); setSudahLogin(true); setPemilikSesi(username); setTab('imei');
      dimuatRef.current = { kehadiran: false, detail: false, perizinan: false };
      setStatus(data.imei ? 'Selesai.' : 'Login berhasil, tidak ada IMEI.');
    } catch (err) {
      const ae = err as (Error & { sesiHabis?: boolean; perluCaptchaBaru?: boolean });
      setError(ae.message);
      if (ae.sesiHabis || ae.perluCaptchaBaru) await refreshCaptcha('Captcha baru dimuat.');
    } finally { setLoadingProses(false); setStatus(''); }
  }

  // ── Logout — tidak muter karena loadingLogout terpisah dari loadingProses ──
  async function keluar() {
    setLoadingLogout(true);
    try {
      await logout();
    } finally {
      // Reset state setelah logout selesai (sukses maupun gagal)
      hapusSesiWeb();
      setSudahLogin(false);
      setPemilikSesi(null);
      kosongkanData();
      setTab('imei');
      setError('');
      setStatus('');
      setLoadingLogout(false);
      // Muat ulang captcha untuk login berikutnya
      refreshCaptcha();
    }
  }

  async function salin(nilai: string) {
    try {
      await navigator.clipboard.writeText(nilai);
      setCopied(nilai);
      setTimeout(() => setCopied(''), 1500);
    } catch { setError('Gagal menyalin ke clipboard.'); }
  }

  // ── Peta ───────────────────────────────────────────────────────────
  const bukaPeta = useCallback(
    async (row: BarisKehadiran) => {
      const judul = [row.nama, row.created_at].filter(Boolean).join(' — ') || 'Lokasi presensi';
      if (row.lat == null || row.lng == null) {
        setPeta({ judul, lat: null, lng: null, loading: false, err: 'Baris ini tidak punya koordinat.', alamat: '' });
        return;
      }

      // Kalau ada idMap, fetch koordinat presisi DULU sebelum buka modal
      // agar modal tidak resize dari loading → peta.
      if (row.idMap) {
        // Buka modal langsung dengan koordinat tabel (sudah ada), tanpa loading
        setPeta({ judul, lat: row.lat, lng: row.lng, loading: false, err: '', alamat: row.alamatPresensi || '' });
        // Update koordinat presisi di background — kalau dapat, perbarui diam-diam
        try {
          const k = await ambilLatlong(row.idMap);
          if (k.lat != null && k.lng != null) {
            setPeta((p) => p ? { ...p, lat: k.lat!, lng: k.lng! } : p);
          }
        } catch (e) {
          const err = e as Error & { sesiHabis?: boolean };
          if (err.sesiHabis) { await tanganiSesiHabis(err.message); return; }
          // Gagal dapat koordinat presisi — tidak apa-apa, koordinat tabel sudah tampil
        }
      } else {
        setPeta({ judul, lat: row.lat, lng: row.lng, loading: false, err: '', alamat: row.alamatPresensi || '' });
      }
    },
    [tanganiSesiHabis]
  );

  // ── Berkas ─────────────────────────────────────────────────────────
  const lihatBerkas = useCallback(
    async (path: string) => {
      const nama = String(path).split('/').pop() || 'berkas';
      const proxyUrl = urlBerkas(path);

      // Deteksi tipe dari ekstensi untuk foto — buka lightbox langsung
      // tanpa fetch blob dulu agar instan
      const ext = nama.split('.').pop()?.toLowerCase() || '';
      const isImageExt = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);

      if (isImageExt && proxyUrl) {
        setBerkas({ nama, loading: false, err: '', url: proxyUrl, tipe: 'image/jpeg' });
        return;
      }

      // PDF dan tipe lain — fetch blob (butuh untuk iframe PDF)
      setBerkas({ nama, loading: true, err: '', url: null, tipe: '' });
      try {
        const { url, tipe } = await ambilBerkas(path);
        setBerkas({ nama, loading: false, err: '', url, tipe });
      } catch (e) {
        const err = e as Error & { sesiHabis?: boolean };
        if (err.sesiHabis) { await tanganiSesiHabis(err.message); return; }
        setBerkas({ nama, loading: false, err: err.message, url: null, tipe: '' });
      }
    },
    [tanganiSesiHabis]
  );

  const tutupBerkas = useCallback(() => {
    setBerkas((b) => { if (b?.url) URL.revokeObjectURL(b.url); return null; });
  }, []);

  const barisPerizinanTampil = semuaPerizinan || (perizinan ? perizinan.baris : []);
  const berkasUnik = semuaPerizinan
    ? [...new Set(semuaPerizinan.map((r) => r.berkas).filter(Boolean))].length
    : 0;

  // ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Form Login ─────────────────────────────────────────────── */}
      <form onSubmit={proses} className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-500" />
          <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-200">Login e-Presensi</h2>
        </div>

        {sudahLogin && (
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60 sm:flex-row sm:items-center">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Berhasil login</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Nama</p>
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                    {hasilImei?.profil?.nama || 'Pegawai'}
                  </p>
                </div>
                <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">NIP</p>
                  <p className="break-all text-sm font-medium text-slate-800 dark:text-slate-200">
                    {hasilImei?.profil?.nip || nip.trim() || '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!sudahLogin && !memulihkanSesi && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* NIP */}
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5" htmlFor="web-nip">NIP</label>
              <input
                id="web-nip" value={nip} onChange={(e) => setNip(e.target.value)}
                placeholder="NIP 18 digit" required autoComplete="off"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition"
              />
            </div>
            {/* Password dengan toggle mata */}
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5" htmlFor="web-password">Password</label>
              <div className="relative">
                <input
                  id="web-password" value={password} onChange={(e) => setPassword(e.target.value)}
                  type={lihatPassword ? 'text' : 'password'}
                  placeholder="Password" required autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-4 pr-11 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition"
                />
                <button
                  type="button"
                  onClick={() => setLihatPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                  aria-label={lihatPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {lihatPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Captcha */}
        {!sudahLogin && !memulihkanSesi && (
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5" htmlFor="web-captcha">
                Captcha
              </label>
              <input
                id="web-captcha" value={captcha} onChange={(e) => simpanCaptcha(e.target.value)}
                placeholder={ocrTersedia && OCR_LOKAL ? 'Terisi otomatis' : 'Ketik kode captcha'}
                autoComplete="off" inputMode="numeric" maxLength={4}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {captchaImg ? (
                <button type="button" onClick={() => refreshCaptcha()}
                  className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 hover:border-indigo-400 transition relative"
                  title="Klik untuk ganti captcha">
                  <img src={captchaImg} alt="captcha" className="h-11 w-auto" />
                  {loadingCaptcha && (
                    <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                    </div>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => refreshCaptcha()}
                  disabled={loadingCaptcha}
                  title="Klik untuk muat captcha"
                  className="h-11 w-20 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-center hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition disabled:opacity-40"
                >
                  {loadingCaptcha
                    ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                    : <RefreshCw className="w-4 h-4 text-slate-400" />}
                </button>
              )}
              <button type="button" onClick={() => refreshCaptcha()} disabled={loadingCaptcha}
                className="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 disabled:opacity-40 dark:hover:text-indigo-400 transition"
                title="Ganti captcha">
                <RefreshCw className={`w-4 h-4 ${loadingCaptcha ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        )}

        {!sudahLogin && !memulihkanSesi && captchaInfo && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">{captchaInfo}</p>}

        {status && (
          <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">
            {memulihkanSesi && !loadingProses
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Loader2 className="w-4 h-4 animate-spin" />}
            {status}
          </div>
        )}

        {error && <Pesan tipe="error">{error}</Pesan>}

        <div className="flex flex-wrap gap-3 pt-1">
          {!sudahLogin && (
          <button type="submit" disabled={loadingProses || loadingCaptcha || memulihkanSesi}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95">
            {loadingProses ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {loadingProses ? 'Memproses...' : memulihkanSesi ? 'Memulihkan sesi...' : 'Login & Ambil Data'}
          </button>
          )}
          {sudahLogin && (
            <button type="button" onClick={keluar} disabled={loadingLogout}
              className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors">
              {loadingLogout ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              {loadingLogout ? 'Keluar...' : 'Logout'}
            </button>
          )}
        </div>
      </form>

      {/* ── Tab navigasi & konten ────────────────────────────────── */}
      {sudahLogin && (
        <div className="space-y-4">
          {/* Tabbar */}
          <div className="flex gap-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-sm">
            {DAFTAR_TAB.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                    tab === t.id
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                  }`}>
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* ─────── IMEI ─────── */}
          {tab === 'imei' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-indigo-500" />IMEI Device
              </h2>
              {hasilImei?.imei ? (
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-5 py-4">
                  <code className="flex-1 font-mono text-base font-semibold text-indigo-600 dark:text-indigo-400 tracking-wider break-all">{hasilImei.imei}</code>
                  <button type="button" onClick={() => salin(hasilImei.imei!)}
                    className={`shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                      copied === hasilImei.imei
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
                    }`}>
                    {copied === hasilImei.imei ? <><Check className="w-4 h-4" />Tersalin!</> : <><Copy className="w-4 h-4" />Salin</>}
                  </button>
                </div>
              ) : (
                <Pesan tipe="info">Tidak ada IMEI pada halaman kehadiran.</Pesan>
              )}
            </div>
          )}

          {/* ─────── KEHADIRAN ─────── */}
          {tab === 'kehadiran' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-indigo-500" />Riwayat Kehadiran
                </h2>
                <button type="button" onClick={() => muatKehadiran(kehadiran?.halaman ?? 1)} disabled={kehadiranLoading}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors">
                  <RefreshCw className={`w-3.5 h-3.5 ${kehadiranLoading ? 'animate-spin' : ''}`} />
                  {kehadiranLoading ? 'Memuat...' : 'Muat ulang'}
                </button>
              </div>

              {kehadiranErr && <Pesan tipe="error">{kehadiranErr}</Pesan>}

              {kehadiranLoading && !kehadiran && (
                <Tabel kolom={['Waktu', 'Jenis', 'IMEI', 'Jarak', 'Lokasi', 'Status', '']}>
                  {[...Array(5)].map((_, i) => <SkeletonBaris key={i} cols={7} />)}
                </Tabel>
              )}

              {kehadiran && kehadiran.baris.length > 0 && (
                <>
                  <Tabel kolom={['Waktu', 'Jenis', 'IMEI', 'Jarak', 'Lokasi Presensi', 'Status', '']}>
                    {kehadiran.baris.map((r, i) => (
                      <tr key={`${r.id || i}-${r.created_at}`}
                        className="text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors align-top">
                        {/* Waktu: tanggal di atas, jam di bawah */}
                        <td className="px-3 py-2.5 w-28">
                          <CellWaktu nilai={r.created_at} />
                        </td>
                        {/* Jenis: checktype di atas, WFH di bawah */}
                        <td className="px-3 py-2.5 w-24">
                          <div className="text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{r.checktype}</div>
                          {r.wfh && (
                            <span className="inline-flex mt-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
                              {r.wfh}
                            </span>
                          )}
                        </td>
                        {/* IMEI: wrap */}
                        <td className="px-3 py-2.5 max-w-[140px]">
                          <code className="text-[11px] text-slate-500 dark:text-slate-400 break-all leading-relaxed">{r.imei || '—'}</code>
                        </td>
                        {/* Jarak */}
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.jarak || '—'}</td>
                        {/* Lokasi: lebih luas */}
                        <td className="px-3 py-2.5 text-xs min-w-[180px] max-w-[260px]">
                          {r.alamatPresensi
                            ? <div className="text-slate-600 dark:text-slate-300 leading-relaxed">{r.alamatPresensi}</div>
                            : <span className="text-slate-400">—</span>}
                          {r.unitKerja && (
                            <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{r.unitKerja}</div>
                          )}
                        </td>
                        {/* Status: lencana di atas, waktu approval di bawah */}
                        <td className="px-3 py-2.5 w-28">
                          <Lencana nilai={r.disetujui} />
                          {r.waktuApproval && (
                            <CellWaktu nilai={r.waktuApproval} />
                          )}
                        </td>
                        {/* Tombol peta */}
                        <td className="px-3 py-2.5 w-14">
                          <button type="button" onClick={() => bukaPeta(r)} disabled={r.lat == null}
                            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 disabled:cursor-not-allowed dark:text-indigo-400 dark:hover:bg-indigo-950/30 transition-colors">
                            <Map className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Tabel>
                  <Paginasi halaman={kehadiran.halaman} totalHalaman={kehadiran.totalHalaman} onPilih={muatKehadiran} disabled={kehadiranLoading} />
                </>
              )}
              {!kehadiranLoading && !kehadiranErr && kehadiran && kehadiran.baris.length === 0 && (
                <Pesan tipe="info">Tidak ada baris kehadiran.</Pesan>
              )}
            </div>
          )}

          {/* ─────── DETAIL PEGAWAI ─────── */}
          {tab === 'detail' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <UserSquare2 className="w-5 h-5 text-indigo-500" />Detail Pegawai
                </h2>
                <button type="button" onClick={muatDetail} disabled={detailLoading}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors">
                  <RefreshCw className={`w-3.5 h-3.5 ${detailLoading ? 'animate-spin' : ''}`} />
                  {detailLoading ? 'Memuat...' : 'Muat ulang'}
                </button>
              </div>

              {detailErr && <Pesan tipe="error">{detailErr}</Pesan>}
              {detailLoading && !detail && (
                <div className="animate-pulse space-y-2">
                  {[...Array(6)].map((_, i) => <div key={i} className="h-4 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${40+i*8}%` }} />)}
                </div>
              )}

              {detail && (
                <>
                  <div className="flex gap-5">
                    {detail.foto && (
                      <img src={detail.foto.startsWith('/ep') ? detail.foto : `/ep${detail.foto}`}
                        alt="Foto pegawai"
                        className="w-24 h-24 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    )}
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                      {Object.entries(detail.profil).map(([k, v]) => (
                        <div key={k} className="flex flex-col">
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">{k}</span>
                          <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Riwayat Login / Perangkat</h3>
                    {detail.logLogin && detail.logLogin.baris.length > 0 ? (
                      <Tabel kolom={detail.logLogin.header}>
                        {detail.logLogin.baris.map((row, i) => (
                          <tr key={i} className="text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            {row.map((c, j) => <td key={j} className="px-3 py-2.5 text-xs">{c}</td>)}
                          </tr>
                        ))}
                      </Tabel>
                    ) : <Pesan tipe="info">Tidak ada data login/perangkat.</Pesan>}
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Foto Terunggah</h3>
                    {detail.fotoUpload && detail.fotoUpload.baris.length > 0 ? (
                      <Tabel kolom={detail.fotoUpload.header}>
                        {detail.fotoUpload.baris.map((row, i) => (
                          <tr key={i} className="text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            {row.map((c, j) => <td key={j} className="px-3 py-2.5 text-xs">{c}</td>)}
                          </tr>
                        ))}
                      </Tabel>
                    ) : <Pesan tipe="info">Tidak ada foto terunggah.</Pesan>}
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Daftar Ijin</h3>
                    {ijinAjaxErr && <Pesan tipe="error">{ijinAjaxErr}</Pesan>}
                    {ijinAjaxLoading && (
                      <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                        <Loader2 className="w-4 h-4 animate-spin" />Memuat daftar ijin...
                      </div>
                    )}
                    {ijinAjax && ijinAjax.length > 0 ? (
                      <Tabel kolom={['Tipe', 'Jenis', 'Tgl Ijin', 'Alasan', 'Status', '']}>
                        {ijinAjax.map((r, i) => (
                          <tr key={i} className="text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors align-top">
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.tipeIjin}</td>
                            <td className="px-3 py-2.5 text-xs">{r.jenisIjin}</td>
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.tglIjin}</td>
                            <td className="px-3 py-2.5 text-xs max-w-[200px]">{r.alasan || '—'}</td>
                            <td className="px-3 py-2.5"><Lencana nilai={r.disetujui} /></td>
                            <td className="px-3 py-2.5">
                              {r.berkas ? (
                                <button type="button" onClick={() => lihatBerkas(r.berkas!)}
                                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30 transition-colors">
                                  <Eye className="w-3.5 h-3.5" />Lihat
                                </button>
                              ) : <span className="text-slate-400 text-xs">—</span>}
                            </td>
                          </tr>
                        ))}
                      </Tabel>
                    ) : (!ijinAjaxLoading && !ijinAjaxErr && <Pesan tipe="info">Tidak ada data ijin.</Pesan>)}
                  </div>
                </>
              )}
              {!detail && !detailLoading && !detailErr && <Pesan tipe="info">Memuat data detail pegawai...</Pesan>}
            </div>
          )}

          {/* ─────── PERIZINAN ─────── */}
          {tab === 'perizinan' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-500" />Perizinan / Cuti
                </h2>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { setSemuaPerizinan(null); muatPerizinan(perizinan?.halaman ?? 1); }}
                    disabled={perizinanLoading || memuatSemua}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-700">
                    <RefreshCw className={`w-3.5 h-3.5 ${perizinanLoading ? 'animate-spin' : ''}`} />
                    {perizinanLoading ? 'Memuat...' : 'Muat ulang'}
                  </button>
                  <button type="button" onClick={muatSemuaPerizinan} disabled={memuatSemua || perizinanLoading}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-400 dark:hover:bg-indigo-950/30 transition-colors border border-indigo-200 dark:border-indigo-800/40">
                    {memuatSemua ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {memuatSemua ? 'Memuat...' : 'Semua halaman'}
                  </button>
                </div>
              </div>

              {perizinanErr && <Pesan tipe="error">{perizinanErr}</Pesan>}
              {memuatSemua && status && (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />{status}
                </div>
              )}

              {semuaPerizinan && (
                <div className="flex items-center justify-between rounded-xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/40 px-4 py-3 text-sm text-indigo-700 dark:text-indigo-300">
                  <span>
                    <strong>{semuaPerizinan.length}</strong> baris{berkasUnik > 0 && <> · <strong>{berkasUnik}</strong> berkas unik</>}
                  </span>
                  <button type="button" onClick={() => setSemuaPerizinan(null)} className="text-xs underline hover:no-underline">Per halaman</button>
                </div>
              )}

              {perizinanLoading && !perizinan && (
                <Tabel kolom={['Tipe / Jenis', 'Tgl Izin', 'Alasan', 'Status', 'Dibuat', '']}>
                  {[...Array(5)].map((_, i) => <SkeletonBaris key={i} cols={6} />)}
                </Tabel>
              )}

              {barisPerizinanTampil.length > 0 && (
                <>
                  <Tabel kolom={['Tipe / Jenis', 'Tgl Izin', 'Alasan', 'Status', 'Dibuat', '']}>
                    {barisPerizinanTampil.map((r, i) => (
                      <tr key={`${r.id || i}-${r.createdAt}`}
                        className="text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors align-top">
                        {/* Tipe/Jenis */}
                        <td className="px-3 py-2.5 text-xs min-w-[100px]">
                          <div className="font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{r.tipeIjin}</div>
                          <div className="text-slate-400 dark:text-slate-500 mt-0.5 whitespace-nowrap">{r.jenisIjin}</div>
                        </td>
                        {/* Tgl Izin: wrap kalau range "dd-mm-yyyy s/d dd-mm-yyyy" */}
                        <td className="px-3 py-2.5 text-xs min-w-[90px] max-w-[130px]">
                          {r.tglIjin
                            ? r.tglIjin.includes('s/d') || r.tglIjin.includes(' - ')
                              ? (() => {
                                  // Pisah "tgl1 s/d tgl2" atau "tgl1 - tgl2"
                                  const sep = r.tglIjin.includes('s/d') ? 's/d' : '-';
                                  const [tgl1, tgl2] = r.tglIjin.split(new RegExp(`\\s*${sep}\\s*`));
                                  return (
                                    <div>
                                      <div className="whitespace-nowrap">{tgl1?.trim()}</div>
                                      <div className="text-slate-400 dark:text-slate-500 whitespace-nowrap">s/d {tgl2?.trim()}</div>
                                    </div>
                                  );
                                })()
                              : <div className="whitespace-nowrap">{r.tglIjin}</div>
                            : <span className="text-slate-400">—</span>}
                        </td>
                        {/* Alasan: lengkap, wrap */}
                        <td className="px-3 py-2.5 text-xs min-w-[140px] max-w-[240px]">
                          <div className="leading-relaxed">{r.alasan || '—'}</div>
                          {r.catatan && <div className="text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">Catatan: {r.catatan}</div>}
                        </td>
                        {/* Status: lencana di atas, waktu approval di bawah */}
                        <td className="px-3 py-2.5 min-w-[90px]">
                          <Lencana nilai={r.disetujui} />
                          {r.approvalAt && <CellWaktu nilai={r.approvalAt} />}
                        </td>
                        {/* Dibuat: tanggal atas, jam bawah */}
                        <td className="px-3 py-2.5">
                          <CellWaktu nilai={r.createdAt} />
                        </td>
                        {/* Berkas */}
                        <td className="px-3 py-2.5 w-14">
                          {r.berkas ? (
                            <button type="button" onClick={() => lihatBerkas(r.berkas!)}
                              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30 transition-colors">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          ) : <span className="text-slate-400 text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </Tabel>
                  {!semuaPerizinan && perizinan && (
                    <Paginasi halaman={perizinan.halaman} totalHalaman={perizinan.totalHalaman} onPilih={muatPerizinan} disabled={perizinanLoading} />
                  )}
                </>
              )}
              {!perizinanLoading && !perizinanErr && barisPerizinanTampil.length === 0 && (
                <Pesan tipe="info">Tidak ada data perizinan.</Pesan>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─────── MODAL PETA ─────── */}
      {peta && (
        <Modal judul="Lokasi Presensi" kotak onTutup={() => setPeta(null)} mediaMod={peta.lat != null}>
          {peta.err && <div className="p-5"><Pesan tipe="error">{peta.err}</Pesan></div>}
          {peta.lat != null && peta.lng != null && (
            <>
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{peta.judul}</p>
                {peta.alamat && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{peta.alamat}</p>}
              </div>
              <Peta lat={peta.lat} lng={peta.lng} judul={peta.judul} />
            </>
          )}
          {peta.lat == null && !peta.err && (
            <div className="p-5"><Pesan tipe="info">Tidak ada koordinat untuk ditampilkan.</Pesan></div>
          )}
        </Modal>
      )}

      {/* ─────── MODAL BERKAS ─────── */}
      {berkas && <ViewerBerkas berkas={berkas} onTutup={tutupBerkas} />}

    </div>
  );
}
