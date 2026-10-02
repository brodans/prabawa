/**
 * Ketahanan penyimpanan — diuji dengan storage yang benar-benar melempar.
 *
 * ## Kenapa diuji secara perilaku, bukan dengan membaca kode
 *
 * Menilai "apakah baris ini berada di dalam `try`" dari teks sumber hanya
 * perkiraan: blok bisa berupa `if`, loop, atau callback, dan `try` yang
 * lupa ditutup akan tetap lolos pemeriksaan teks tapi meledak saat dijalankan.
 *
 * Yang diuji di sini adalah perilakunya: storage diganti dengan versi yang
 * **selalu melempar** — persis kondisi Safari mode privat, penyimpanan yang
 * diblokir kebijakan situs, dan kiosk yang menonaktifkannya — lalu setiap
 * fungsi publik dipanggil.
 *
 * Yang dianggap benar: fungsi mengembalikan nilai fallback, atau melempar
 * error yang memang sengaja diteruskan ke pemanggil yang menanganinya.
 *
 * Yang dianggap salah: `SecurityError`/`QuotaExceededError` yang keluar dari
 * fungsi publik tanpa sengaja — itu jadi layar putih, atau handler yang
 * menggagalkan aksi pengguna seperti login.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable no-control-regex */
const root = new URL('..', import.meta.url).pathname;

/** Penyimpanan yang selalu melempar — meniru mode privat / storage diblokir. */
function buatMelempar() {
  const err = () => {
    const e = new Error('storage diblokir');
    e.name = 'SecurityError';
    return e;
  };
  return {
    get length() { throw err(); },
    getItem: () => { throw err(); },
    setItem: () => { throw err(); },
    removeItem: () => { throw err(); },
    clear: () => { throw err(); },
    key: () => { throw err(); },
  };
}

let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/** Panggil `fn`; laporkan kalau error yang lolos ke luar. */
function amanPanggil(nama, fn) {
  try {
    const nilai = fn();
    cek(nama, true, nilai === undefined ? 'selesai tanpa nilai' : `→ ${ringkas(nilai)}`);
    return nilai;
  } catch (err) {
    cek(nama, false, `melempar ${err?.name}: ${String(err?.message).slice(0, 60)}`);
    return undefined;
  }
}

function ringkas(nilai) {
  try {
    const t = Array.isArray(nilai) ? `array(${nilai.length})` : typeof nilai;
    return `${t}${(nilai && typeof nilai === 'object' && !Array.isArray(nilai)) ? ' {…}' : ''}`;
  } catch {
    return '?';
  }
}

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Modul penyimpanan tidak melempar ke pemanggil');
// ═════════════════════════════════════════════════════════════════════

const S = await import('../src/lib/storageAman.ts');

// Ganti penyimpanan global dengan yang melempar.
const asliWindow = globalThis.window;
const asliLocal = globalThis.localStorage;
const asliSession = globalThis.sessionStorage;
const pasang = () => {
  const m = buatMelempar();
  globalThis.window = { ...(asliWindow ?? {}), localStorage: m, sessionStorage: m };
  globalThis.localStorage = m;
  globalThis.sessionStorage = m;
};
const lepas = () => {
  globalThis.window = asliWindow;
  globalThis.localStorage = asliLocal;
  globalThis.sessionStorage = asliSession;
};

pasang();
cek('bacaStorage tidak melempar', (() => { try { S.bacaStorage('x'); return true; } catch { return false; } })());
cek('bacaStorage memakai cadangan', S.bacaStorage('x', 'cadangan') === 'cadangan');
cek('tulisStorage melaporkan gagal, tidak melempar', (() => { try { return S.tulisStorage('x', 'y') === false; } catch { return false; } })());
cek('hapusStorage tidak melempar', (() => { try { S.hapusStorage('x'); return true; } catch { return false; } })());
cek('tidak ada helper sessionStorage (tak terpakai)', typeof S.bacaSesi === 'undefined' && typeof S.tulisSesi === 'undefined' && typeof S.hapusSesi === 'undefined',
  'kalau muncul lagi, pastikan ada pemanggil nyata');
cek('tidak ada storageTersedia (tak terpakai)', typeof S.storageTersedia === 'undefined');
lepas();

console.log('\n=== 2. Helper berfungsi benar saat storage normal');
/*
 * Storage yang berfungsi normal — Node 20 tidak menyediakan `localStorage`,
 * jadi bagian ini tidak boleh dilewati: kalau dilewati, skrip ini hanya
 * membuktikan bahwa helper tidak melempar, bukan bahwa ia benar-benar
 * menyimpan dan membaca.
 */
const storageAsli = typeof asliLocal?.setItem === 'function';
if (!storageAsli) {
  // Simpanan sederhana yang berfungsi penuh, dipasang hanya selama uji.
  const data = new Map();
  const sementara = {
    get length() { return data.size; },
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear(),
    key: i => [...data.keys()][i] ?? null,
  };
  globalThis.window = { ...(asliWindow ?? {}), localStorage: sementara, sessionStorage: sementara };
  globalThis.localStorage = sementara;
  globalThis.sessionStorage = sementara;
  console.log('  (Node tidak menyediakan localStorage — dipakai storage in-memory)');
}
{
  const probe = '__prabawa_probe__';
  cek('tulisStorage melaporkan sukses', S.tulisStorage(probe, 'tulisan') === true);
  cek('bacaStorage membaca yang ditulis', S.bacaStorage(probe) === 'tulisan');
  cek('tulisan kedua menimpa, bukan menambah', (() => {
    S.tulisStorage(probe, 'kedua');
    return S.bacaStorage(probe) === 'kedua';
  })());
  S.hapusStorage(probe);
  cek('hapusStorage menghapus', S.bacaStorage(probe) === '');
  cek('kunci hilang -> cadangan', S.bacaStorage('__tidak_ada__', 'fb') === 'fb');
  cek('kunci hilang -> string kosong', S.bacaStorage('__tidak_ada__') === '');
  cek('nilai kosong yang tersimpan bukan "hilang"', (() => {
    S.tulisStorage(probe, '');
    return S.bacaStorage(probe, 'fb') === '';
  })());
  cek('nilai "0" tidak dianggap hilang', (() => {
    S.tulisStorage(probe, '0');
    return S.bacaStorage(probe, 'fb') === '0';
  })());
  S.hapusStorage(probe);
}
lepas();

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Modul lain tetap bertahan saat storage melempar');
// ═════════════════════════════════════════════════════════════════════
/*
 * Modul-modul ini memakai `localStorage`/`sessionStorage` langsung, tapi
 * dibungkus `try`/`catch` di berkasnya masing-masing. Yang diuji di sini
 * apakah bungkusannya benar-benar bekerja: storage diganti dengan yang
 * melempar, lalu fungsi publiknya dipanggil.
 *
 * Ini yang membedakan "sudah ditangani" dari "tampaknya ditangani" —
 * pada kode yang memakai `??` di dalam literal objek, `try` yang lupa
 * ditutup akan lolos ke pemeriksaan teks tapi tetap meledak saat dijalankan.
 */
pasang();
// Setiap entri: [nama, modul, namaFungsi, argumen]
/*
 * Bentuk argumen untuk fungsi sesi sudah berubah dua kali, dan setiap kali
 * skrip ini ikut menyesuaikan — kalau tidak, "lulus" di sini hanya berarti
 * tidak ada yang memanggil.
 *
 * Sekarang: `saveSession(user, permissions, token)`. Token **wajib** — sesi
 * tanpa token berarti `role` tanpa bukti, dan modul itu menolak menyimpannya
 * (lihat `tools/cek-sesi.mjs` §10). Argumen di sini memakai token tiruan
 * supaya yang diuji memang "storage melempar", bukan "argumen salah".
 */
const SESI = {
  currentUser: { username: 'u', nip: '1', role: 'user', nama: 'U', passwordHash: 'x' },
  boundRole: 'user',
  loginTime: 1,
};
/** Token tiruan — bentuk saja, bukan token bertanda tangan sungguhan. */
const TOKEN_UJI = 'eyJ2IjoxLCJzdWIiOiJ1In0.dummy-signature';
const KASUS = [
  ['sessionManager.loadSession', '../src/lib/sessionManager.ts', 'loadSession', ['u']],
  ['sessionManager.saveSession', '../src/lib/sessionManager.ts', 'saveSession', [SESI, {}, TOKEN_UJI]],
  /*
   * `touchSession()` **tidak menerima argumen** — ia membaca sesi aktif sendiri
   * dari storage. Semula `SESI` dikirim sebagai argumen pertama; itu diabaikan,
   * jadi baris ini sendiri tidak penyebab apa pun.
   */
  ['sessionManager.touchSession', '../src/lib/sessionManager.ts', 'touchSession', []],
  ['sessionManager.clearSessionByRole', '../src/lib/sessionManager.ts', 'clearSessionByRole', ['user']],
  ['sessionManager.clearAllSessions', '../src/lib/sessionManager.ts', 'clearAllSessions', []],
  ['cacheManager.getServerSessionCache', '../src/lib/cacheManager.ts', 'getServerSessionCache', ['u']],
  ['cacheManager.setServerSessionCache', '../src/lib/cacheManager.ts', 'setServerSessionCache', ['u', {}]],
  ['cacheManager.clearServerSessionCache', '../src/lib/cacheManager.ts', 'clearServerSessionCache', ['u']],
  // `lokasiTersimpan` dihapus bersama GPS dan peta. Tidak ada titik absen
  // yang disimpan di peramban, jadi tidak ada lagi yang bisa bocor antar akun.
  ['storageAman.bacaStorage', '../src/lib/storageAman.ts', 'bacaStorage', ['theme']],
  ['storageAman.tulisStorage', '../src/lib/storageAman.ts', 'tulisStorage', ['theme', 'dark']],
  ['storageAman.hapusStorage', '../src/lib/storageAman.ts', 'hapusStorage', ['theme']],
  ['serverAutoLogin.sudahKeluarServer', '../src/lib/serverAutoLogin.ts', 'sudahKeluarServer', ['u']],
  ['serverAutoLogin.tandaiKeluarServer', '../src/lib/serverAutoLogin.ts', 'tandaiKeluarServer', ['u']],
  ['serverAutoLogin.imeiStabil', '../src/lib/serverAutoLogin.ts', 'imeiStabil', ['u']],
  ['serverAutoLogin.simpanImei', '../src/lib/serverAutoLogin.ts', 'simpanImei', ['u', 'imei-123']],
];
const cacheModul = new Map();
for (const [nama, muat, fn, args] of KASUS) {
  let M = cacheModul.get(muat);
  if (!M) {
    try {
      M = await import(muat);
    } catch (err) {
      cek(`${nama} bisa diimpor`, false, String(err?.message).slice(0, 60));
      continue;
    }
    cacheModul.set(muat, M);
  }
  if (typeof M[fn] !== 'function') {
    cek(`${nama} tersedia`, false, `tidak ada ekspor bernama "${fn}" — cek daftar ekspor modul`);
    continue;
  }
  /*
   * `console.warn` dari modul di bawah **diharapkan**, bukan tanda galat.
   *
   * Section ini memasang stub storage yang **selalu melempar**
   * (`SecurityError`), lalu memanggil setiap fungsi modul satu per satu. Modul
   * yang benar harus menangkap sendiri dan bertahan; sebagian melakukannya lewat
   * `console.warn` sebelum swallow — persis yang harus terlihat di sini,
   * karena storage-nya memang ditolak.
   *
   * Tanpa catatan ini pesannya mudah dibaca sebagai kegagalan, padahal justru
   * bukti bahwa lapisan penanganan galatnya bekerja.
   */
  amanPanggil(nama, () => M[fn](...args));
}
lepas();

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Inisialisasi useState tidak menyentuh storage langsung');
// ═════════════════════════════════════════════════════════════════════
/*
 * Bagian 3 membuktikan modul-modul data bertahan. Tapi ada kelas kegagalan
 * yang tidak terlihat di situ: initializer `useState` berjalan pada fase
 * render, sebelum React memasang tree.
 *
 * `AppContext` membungkus seluruh aplikasi, jadi satu lemparan di
 * initializer-nya berarti tidak ada satu pun layar yang muncul — layar putih,
 * tanpa form login. `useDarkMode` punya sifat yang sama.
 *
 * Yang diperiksa: di dalam blok `useState(() => …)` tidak boleh ada
 * `localStorage`/`sessionStorage` langsung. `bacaStorage` boleh, karena ia
 * tidak pernah melempar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
const buangKomentar = t =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const semuaBerkas = [];
(function jalan(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.vite'].includes(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (['api', 'tools'].includes(e.name) && d === root) continue;
      jalan(p);
    } else if (/\.tsx?$/.test(e.name)) {
      semuaBerkas.push(p);
    }
  }
})(root);

// Cari initializer `useState(() => {…})` dan ambil badannya.
const egregious = [];
for (const f of semuaBerkas) {
  const kode = buangKomentar(readFileSync(f, 'utf8'));
  for (const m of kode.matchAll(/useState(?:<[^>]*>)?\(\s*\(\s*\)\s*=>\s*\{/g)) {
    // Ambil blok hingga penutup kurung kurawal yang seimbang.
    let depth = 0, akhir = -1;
    for (let i = m.index + m[0].length - 1; i < kode.length; i++) {
      if (kode[i] === '{') depth++;
      else if (kode[i] === '}') { depth--; if (depth === 0) { akhir = i; break; } }
    }
    if (akhir < 0) continue;
    const badan = kode.slice(m.index, akhir);
    if (/\b(?:window\.)?(?:localStorage|sessionStorage)\s*\./.test(badan)) {
      const ln = kode.slice(0, m.index).split('\n').length;
      egregious.push(`${f.replace(root, '')}:${ln}  ${badan.slice(0, 70).replace(/\s+/g, ' ')}`);
    }
  }
}
cek(
  'tidak ada storage langsung di initializer useState',
  egregious.length === 0,
  egregious.join(' | ')
);

// useDarkMode dan AppContext wajib sudah memakai helper.
for (const [f, wajib] of [
  ['src/hooks/useDarkMode.ts', ['bacaStorage', 'tulisStorage']],
  ['src/context/AppContext.tsx', ['bacaStorage', 'tulisStorage']],
  ['src/components/LoginScreen.tsx', ['tulisStorage']],
]) {
  const kode = buangKomentar(readFileSync(join(root, f), 'utf8'));
  for (const nama of wajib) {
    cek(`${f} memakai ${nama}`, new RegExp(`\\b${nama}\\(`).test(kode));
  }
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
