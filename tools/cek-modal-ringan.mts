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
  /konten-gulir flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto/.test(appSrc) &&
    /poni-konten flex-1 min-w-0 overflow-x-hidden w-full/.test(appSrc));
cek('padding halaman tidak mendorong scrollbar dari tepi viewport',
  /padding-left:\s*max\(1rem, var\(--poni-kiri\)\)/.test(cssSrc) &&
    /padding-right:\s*max\(1rem, var\(--poni-kanan\)\)/.test(cssSrc));
cek('satu aturan global scrollbar, tanpa deklarasi yang saling menimpa',
  (cssSrc.match(/\*::-webkit-scrollbar\s*\{/g) ?? []).length === 1 &&
    (cssSrc.match(/^\s*::-webkit-scrollbar\s*\{/gm) ?? []).length === 0);

console.log('\n=== Overlay lain');
cek('App: overlay menu mobile tanpa blur', !/fixed inset-0 bg-slate-900\/60 backdrop-blur/.test(appSrc));
cek('App: konten utama tidak di-blur', !/isMobileMenuOpen \? 'blur-sm/.test(appSrc));

console.log('\n=== SettingAkunModal');
cek('shell modal tanpa motion.div', !/<motion\.div[^>]*className="modal-layer/.test(akunKode));
cek('shell modal tanpa backdrop-blur', !/modal-layer[^"]*backdrop-blur/.test(akunKode));
cek('pakai keyframe CSS yang sama', akunSrc.includes('modal-panel-enter'));
cek('punya role=dialog', akunSrc.includes('role="dialog"'));

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
