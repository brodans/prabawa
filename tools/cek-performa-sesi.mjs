/**
 * Sesi & performa render — hal yang **tidak boleh** terjadi.
 *
 * Skrip `cek-sesi.mjs` membuktikan sesi bekerja. Skrip ini membuktikan
 * dua kelas kesalahan yang keduanya muncul sebagai "lag" atau "reload
 * terus", bukan sebagai error:
 *
 * 1. **Re-render yang tidak perlu.** `AppContext` dibaca 13 komponen.
 *    Kalau nilai context-nya dibuat baru pada setiap render provider,
 *    seluruh 13 komponen itu merender ulang setiap kali apa pun berubah —
 *    termasuk state yang tidak ada hubungannya dengan mereka.
 *
 * 2. **Pekerjaan sinkron pada event berfrekuensi tinggi.** `scroll` bisa
 *    turun ratusan kali per detik. Kalau setiap satu memanggil
 *    `touchSession()` — yang menelusuri `sessionStorage` dan `JSON.parse`
 *    — menggulir halaman terasa berat di perangkat kecil.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const baca = p => readFileSync(join(root, p), 'utf8');
/** Buang komentar supaya hanya kode yang benar-benar dijalankan. */
const kode = src =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\//gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const ctx = kode(baca('src/context/AppContext.tsx'));
const app = kode(baca('src/App.tsx'));
const sesi = kode(baca('src/lib/sessionManager.ts'));

// ═══ 1. Nilai context harus di-memo ════════════════════════════════

cek(
  'nilai AppContext.Provider di-useMemo',
  /useMemo<[^>]*AppContextType>|<AppContextType>\s*\(/.test(ctx) ||
    /useMemo\s*\(\s*\(\)\s*=>\s*\(\{[\s\S]*?pegawai/.test(ctx),
  'objek literal baru = seluruh 13 pemanggil merender ulang tiap render'
);
cek('AppContext tidak lagi menulis value={{}} langsung', !/value=\{\{/.test(ctx));

// Setter yang dipakai sebagai dependensi `useEffect` harus stabil.
//
// ⚠️ `setDatePickerStyle` sengaja **tidak** ada di daftar ini. Gaya kalender
// "klasik" beserta prefs-nya sudah dihapus, jadi setternya tidak lagi ada di
// `AppContext` sama sekali. Meminta setternya `useCallback` akan menjaga
// perubahan yang sudah dibatalkan.
for (const setter of ['setActivePage', 'setDeveloperMode']) {
  cek(
    `${setter} dibungkus useCallback`,
    new RegExp(`const ${setter} = useCallback\\(`).test(ctx),
    'kalau berubah tiap render, efek yang memakainya berjalan terus-menerus'
  );
}

// Pengaman: prefs gaya kalender tidak boleh muncul lagi di mana pun.
cek(
  'prefs gaya kalender klasik sudah dihapus dari AppContext',
  !/datePickerStyle|jatim_date_picker_style/.test(ctx),
  'gaya klasik dihapus; prefsnya tidak boleh tersisa'
);

// `setCurrentUser` sudah `useCallback` — menjaga agar tidak regresi.
cek('setCurrentUser dibungkus useCallback', /const setCurrentUser = React\.useCallback\(|const setCurrentUser = useCallback\(/.test(ctx));

// ═══ 2. `visiblePages` harus di-memo ═══════════════════════════════
//
// `filter()` selalu mengembalikan array baru. Tanpa memo, identitasnya
// berubah tiap render → efek dependensinya berjalan tiap render →
// `setActivePage` → render lagi.

cek(
  'visiblePages di-React.useMemo',
  /const visiblePages = React\.useMemo\(/.test(app),
  'tanpa memo, effect penormalisasi halaman berjalan setiap render'
);

// ═══ 3. Event aktivitas tidak boleh tanpa throttle ═════════════════

cek(
  'perpanjang dibatasi lajunya',
  /PERPANJANG_MIN_MS/.test(app),
  'scroll bisa ratusan kali/detik; touchSession() menelusuri storage'
);
cek(
  'perpanjang tidak dipanggil pada `click`',
  !/activityEvents\s*=\s*\[[^\]]*'click'/.test(app),
  '`mousedown` sudah menyala pada interaksi yang sama'
);
cek(
  'listener aktivitas didaftarkan sebagai passive',
  /addEventListener\(event, perpanjang, \{ passive: true \}\)/.test(app),
  'scroll blocking_main thread tanpa perlu'
);

// ═══ 4. `tokenAktif()` tidak boleh memindai storage tiap request ════

cek('tokenAktif memakai cache', /tokenCache/.test(sesi));
cek(
  'cache token punya batas umur',
  /TOKEN_CACHE_MS/.test(sesi),
  'selamanya = header Authorization bisa basi'
);
for (const pemanggil of ['saveSession', 'perbaruiTokenSesi']) {
  cek(
    `${pemanggil} membatalkan cache token`,
    new RegExp(`${pemanggil}\\([\\s\\S]{0,3000}?invalidasiTokenCache\\(\\)`).test(sesi),
    'tanpa ini request berikutnya masih memakai token lama'
  );
}
cek(
  'clearAllSessions membatalkan cache token',
  /clearAllSessions\(\)[\s\S]{0,600}?invalidasiTokenCache\(\)/.test(sesi)
);

// ═══ 5. Tidak ada pembangun sesi tanpa token ═══════════════════════

cek(
  'createAdminUserAccount tidak ada lagi',
  !/createAdminUserAccount/.test(sesi),
  'fungsi menyusun akun role=admin dari peramban tanpa token server'
);
cek(
  'saveSession mewajibkan token',
  /saveSession\([\s\S]{0,400}?token: string[\s\S]{0,600}?throw new Error/.test(sesi),
  'sesi tanpa token berarti role tanpa bukti'
);

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
