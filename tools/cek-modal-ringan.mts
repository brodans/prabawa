/**
 * Uji ringan modal: memastikan sumber dan CSS build benar-benar ringan.
 *
 * Yang diperiksa:
 *  1. Tidak ada `backdrop-filter` di kelas modal (penyebab utama "lemot").
 *  2. Keyframe modal hanya menganimasikan `opacity` dan `transform`.
 *  3. Tidak ada `scale` di animasi modal (scale memicu hitung ulang isi).
 *  4. Animasi keluar sudah dihapus (tidak ada element yang ditahan di DOM).
 *  5. `Modal` tidak mengimpor `motion/react` lagi.
 *  6. Hanya area konten aplikasi yang menggulir; dokumen tidak punya scroll kedua.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

// ── 1. Sumber ────────────────────────────────────────────────────────
const modalSrc = readFileSync(join(root, 'src/components/ui/Modal.tsx'), 'utf8');
const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const akunSrc = readFileSync(join(root, 'src/components/SettingAkunModal.tsx'), 'utf8');
const cssSrc = readFileSync(join(root, 'src/index.css'), 'utf8');
const webSrc = readFileSync(join(root, 'src/pages/WebPresensi.tsx'), 'utf8');
const htmlSrc = readFileSync(join(root, 'index.html'), 'utf8');

/**
 * Buang komentar lebih dulu sebelum memeriksa.
 *
 * Module ini sengaja mendokumentasikan *kenapa* `motion`/`AnimatePresence`
 * dibuang, jadi nama-nama itu muncul di dalam komentar. Tanpa sheds
 * komentar, pemeriksa akan selalu gagal.
 */
const tanpaKomentar = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const modalKode = tanpaKomentar(modalSrc);
const akunKode = tanpaKomentar(akunSrc);

console.log('=== Modal.tsx');
cek('tidak mengimpor motion/react', !/^import .*motion\/react/m.test(modalKode));
cek('tidak memakai AnimatePresence', !modalKode.includes('AnimatePresence'));
cek('tidak ada motion.div', !modalKode.includes('motion.div'));
cek('overlay tanpa backdrop-blur', !/modal-layer[^"]*backdrop-blur/.test(modalKode));
cek('pakai keyframe CSS masuk', modalSrc.includes('modal-panel-enter'));
cek('panel punya role=dialog', modalSrc.includes('role="dialog"'));
cek('fokus pakai preventScroll', modalSrc.includes('preventScroll'));
cek('kunci gulir pakai refcount', modalSrc.includes('kunciGulir') && modalSrc.includes('bukaGulirHalaman'));
cek('modal dirender di portal dokumen agar berada di atas menu baris',
  /typeof document === 'undefined' \? modal : createPortal\(modal, document\.body\)/.test(modalSrc));
cek('modal tetap bisa dirender oleh server tanpa document',
  /const modal = \([\s\S]*?return typeof document === 'undefined' \? modal/.test(modalSrc));
cek('isi modal membatasi scroll chaining dan dapat menyusut di panel flex',
  /min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y/.test(modalSrc));
cek('klik di dalam panel tidak dianggap klik backdrop',
  /event\.target === event\.currentTarget/.test(modalSrc));
cek(
  'onClose disimpan di ref (efek tidak ulang tiap render)',
  modalSrc.includes('onCloseRef') && /\}, \[open\]\)/.test(modalSrc)
);
cek('shell mengunci gulir dokumen', /app-shell-active/.test(appSrc) && /html\.app-shell-active body[\s\S]*?overflow:\s*hidden/.test(cssSrc));
cek('tidak ada gutter scrollbar permanen', !/scrollbar-gutter:\s*stable/.test(cssSrc));
cek('kolom kanan mengikuti tinggi shell, bukan menambah 100svh di bawah header',
  /flex-1 flex flex-col min-w-0 h-full min-h-0 relative overflow-hidden/.test(appSrc) &&
    !/flex-1 flex flex-col min-w-0 h-\[100svh\] relative overflow-hidden/.test(appSrc));
cek('scroll vertikal halaman hanya berada pada kontainer konten',
  /konten-gulir flex-1 flex flex-col min-w-0 min-h-0 overflow-y-scroll/.test(appSrc) &&
    /poni-konten min-h-full flex-none min-w-0 overflow-x-hidden w-full/.test(appSrc));
cek('padding halaman tidak mendorong scrollbar dari tepi viewport',
  /padding-left:\s*max\(1rem, var\(--poni-kiri\)\)/.test(cssSrc) &&
    /padding-right:\s*max\(1rem, var\(--poni-kanan\)\)/.test(cssSrc));
cek('satu aturan global scrollbar, tanpa deklarasi yang saling menimpa',
  (cssSrc.match(/\*::-webkit-scrollbar\s*\{/g) ?? []).length === 1 &&
    (cssSrc.match(/^\s*::-webkit-scrollbar\s*\{/gm) ?? []).length === 0);

console.log('\n=== Overlay lain');
cek('App: overlay menu mobile tanpa blur', !/fixed inset-0 bg-slate-900\/60 backdrop-blur/.test(appSrc));
cek('App: konten utama tidak di-blur', !/isMobileMenuOpen \? 'blur-sm/.test(appSrc));
cek('skeleton Web mengikuti status sesi dan tidak menampilkan tab sebelum login',
  /webPresensiState\.sudahLogin[\s\S]*?login;/.test(appSrc));
cek('skeleton Web mengikuti tab aktif setelah login',
  /switch \(webPresensiState\.tab\)[\s\S]*?case 'imei'[\s\S]*?case 'kehadiran'[\s\S]*?case 'detail'[\s\S]*?case 'perizinan'/.test(appSrc));
const skeletonPerizinan = appSrc.match(/pageId === 'tabPerizinan'([\s\S]*?)pageId === 'tabLaporan'/)?.[1] ?? '';
cek('skeleton Perizinan mengikuti tab formulir awal',
  /grid grid-cols-2 gap-1[\s\S]*?filterFields\(2\)[\s\S]*?h-28 w-full rounded-xl[\s\S]*?h-10 w-36 rounded-xl/.test(skeletonPerizinan) &&
    !/SkeletonTable/.test(skeletonPerizinan));
cek('skeleton Laporan mengikuti tabel enam kolom tanpa badge duplikat',
  /pageId === 'tabLaporan'[\s\S]*?SkeletonTable[\s\S]*?columns=\{6\}/.test(appSrc) &&
    /stats\(4, \[0\]\)/.test(appSrc) &&
    !/pageId === 'tabLaporan'[\s\S]*?Skeleton className="h-6 w-24 rounded-full"/.test(appSrc));
cek('skeleton Presensi mengikuti kartu statistik dan seluruh kontrol formulir',
  /pageId === 'tabPresensi' && pegawai[\s\S]*?stats\(4, \[2, 3\]\)[\s\S]*?grid grid-cols-1 gap-2 sm:grid-cols-3[\s\S]*?SkeletonList rows=\{4\}/.test(appSrc));
cek('skeleton Lokasi Absen memuat peta, titik pengguna, dan titik server',
  /pageId === 'tabLokasiAbsen'[\s\S]*?h-\[480px\][\s\S]*?w-44[\s\S]*?SkeletonList rows=\{3\}/.test(appSrc));
cek('skeleton tanpa judul halaman mengikuti header yang benar-benar dirender',
  /const adaHeaderHalaman =\s*pageId === 'tabBeranda' \|\| pageId === 'tabPresensi' \|\| pageId === 'tabDocs'/.test(appSrc) &&
    /\{adaHeaderHalaman && header\}/.test(appSrc));
cek('rute aktif mulai di-prefetch selama login atau verifikasi sesi',
  /loadPageModule\(activePage\)\.catch\(\(\) => undefined\)/.test(appSrc));
cek('pemeriksaan sesi menampilkan shell workspace tanpa blur latar belakang',
  /GROUP_ORDER\.map\(group =>[\s\S]*?PageLoading pageId=\{pageId\}/.test(appSrc) &&
    !/Menyiapkan ruang kerja Anda/.test(appSrc));
cek('hard refresh menampilkan boot shell sebelum React mount',
  /<div id="root">\s*<div class="boot-shell"/.test(htmlSrc) &&
    /<script type="module" src="\/src\/main\.tsx"><\/script>/.test(htmlSrc));
cek('captcha punya ukuran slot tetap saat gambar belum/sudah dimuat',
  /h-11 w-20 shrink-0 overflow-hidden/.test(webSrc) &&
    /h-full w-full object-contain/.test(webSrc));
cek('captcha loading memakai shimmer tanpa spinner pada gambar',
  /captcha-shimmer absolute inset-0/.test(webSrc) &&
    /@keyframes captchaShimmer/.test(cssSrc) &&
    !/captchaImg[\s\S]{0,600}Loader2/.test(webSrc));
cek('captcha hanya punya satu tombol reload',
  (webSrc.match(/title="Muat ulang captcha"/g) ?? []).length === 1 &&
    !/Klik untuk muat captcha|Klik untuk ganti captcha/.test(webSrc));

console.log('\n=== SettingAkunModal');
cek('shell modal tanpa motion.div', !/<motion\.div[^>]*className="modal-layer/.test(akunKode));
cek('shell modal tanpa backdrop-blur', !/modal-layer[^"]*backdrop-blur/.test(akunKode));
cek('pakai keyframe CSS yang sama', akunSrc.includes('modal-panel-enter'));
cek('punya role=dialog', akunSrc.includes('role="dialog"'));
cek('tinggi minimum Pengaturan PRABAWA proporsional',
  akunSrc.includes('min-h-[min(32rem,calc(100dvh-2rem))]'));

// ── 2. CSS build ─────────────────────────────────────────────────────
const distAssets = join(root, 'dist/assets');
let cssFile = '';
try {
  cssFile = readdirSync(distAssets).find((f) => f.endsWith('.css')) ?? '';
} catch {
  /* build belum ada */
}

if (!cssFile) {
  console.log('\n(lewat — dist/assets/*.css belum ada, jalankan `npm run build`)');
} else {
  const css = readFileSync(join(distAssets, cssFile), 'utf8');
  console.log(`\n=== CSS build (${cssFile})`);

  // Ambil blok aturan untuk kelas modal saja.
  const aturanModal = css.match(/\.modal-[a-z-]+\{[^}]*\}/g) ?? [];
  const gabungModal = aturanModal.join('\n');
  cek(
    'tidak ada backdrop-filter di kelas modal',
    !/backdrop-filter/.test(gabungModal),
    `${aturanModal.length} aturan diperiksa`
  );

  const keyframe = (nama: string): string | null => {
    const m = css.match(new RegExp(`@keyframes ${nama}\\{([^}]*)\\}`));
    return m ? m[1] : null;
  };

  const kOverlay = keyframe('modal-overlay-in');
  cek('keyframe overlay ada', kOverlay !== null);
  if (kOverlay) {
    cek('overlay hanya opacity', !/transform|width|height|filter|blur/.test(kOverlay), kOverlay);
  }

  const kPanel = keyframe('modal-panel-in');
  cek('keyframe panel ada', kPanel !== null);
  if (kPanel) {
    cek('panel memakai transform', /transform/.test(kPanel));
    cek(
      'panel TIDAK memakai scale',
      !/scale/.test(kPanel),
      'scale memicu hitung ulang isi tiap frame'
    );
    cek(
      'panel tidak menganimasikan property layout',
      !/width|height|margin|padding|top|left/.test(kPanel)
    );
  }

  cek('tidak ada gutter scrollbar permanen', !/scrollbar-gutter:\s*stable/.test(css));
  cek('dukungan prefers-reduced-motion ada', /prefers-reduced-motion/.test(css));
  cek('durasi animasi pendek (<= 200ms)', /\.modal-panel-enter\{animation:\.16s/.test(css), '.16s');
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
