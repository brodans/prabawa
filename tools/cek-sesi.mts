/**
 * Sesi panel: akun yang sama setelah refresh, dan tidak ada akun bercampur.
 *
 * ## Bug yang menutupi modul ini
 *
 * `loadSession()` versi lama menelusuri `sessionStorage` dan mengembalikan
 * **sesi valid pertama yang ditemukan**:
 *
 * ```ts
 * for (let index = 0; index < sessionStorage.length; index++) {
 *   const key = sessionStorage.key(index);
 *   ...
 *   return session;   // yang pertama, bukan "yang sedang dipakai"
 * }
 * ```
 *
 * Begitu ada dua sesi di storage, akun mana yang muncul setelah **refresh**
 * ditentukan oleh urutan internal `sessionStorage` — bukan oleh akun yang
 * sedang dipakai. Admin yang sedang bekerja lalu refresh bisa mendarat di
 * akun user. Gejalanya persis yang dilaporkan: "saya di akun admin tapi
 * saya refresh malah kembali ke user".
 *
 * Perbaikannya: `epresensi_jatim_sesi_aktif` menunjuk akun yang sedang
 * dipakai, dan `saveSession()` membuang sesi peran lain sehingga admin dan
 * user tidak pernah hidup berdampingan.
 *
 * ## Layer kedua: token
 *
 * Penunjuk akun itu sendiri sudah tidak cukup, dan sekarang bukan lagi satu
 *-satunya. Yang disimpan di storage **bukan** objek akun, melainkan token
 * bertanda tangan dari `POST /api/panel-auth`, dan `role` di dalamnya bukan
 * sumber kebenaran — `AppContext` memverifikasi token ke server setiap kali
 * aplikasi dibuka dan memakai peran yang dibaca ulang dari dokumen.
 *
 * Jadi skrip ini memakai token tiruan yang **mempunyai bentuk**(token bertanda
 * tangan). Bentuk itu bukan mungkin yang diuji di sini: yang diuji di sini
 * adalah apa yang terjadi pada storage ketika beberapa akun ada bersamaan.
 * Keaslian token diuji di `cek-panel-auth.ts`.
 */
import { readFileSync } from 'node:fs';
import type { TabPermissions } from '../src/lib/userManager';

const root = new URL('..', import.meta.url).pathname;

// ── Penyimpanan tiruan yang perilakunya meniru peramban ──
/*
 * PENTING: `sessionStorage` tiruan ini **menyisipkan kunci baru di akhir**
 * dan `key(i)` mengembalikan kunci berdasarkan urutan sisip — sama seperti
 * peramban. Kalau ia memakai `Object.keys()` pada objek biasa, urutan kunci
 * akan terurut, dan bug "sesi pertama yang ditemukan" justru tidak akan
 * pernah muncul di sini. Bug itu justru bisa tertutupi oleh tiruan yang
 * salah, jadi urutannya harus benar.
 */
/** `Storage` tiruan dengan satu tambahan: urutan kunci apa adanya. */
interface StorageUji extends Storage {
  /** Hanya untuk uji: urutan kunci apa adanya. */
  semuaKunci: () => string[];
}

function buatStorage(): StorageUji {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    getItem: (k: string) => (data.has(k) ? data.get(k) ?? null : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    /** Hanya untuk uji: urutan kunci apa adanya. */
    semuaKunci: () => [...data.keys()],
  };
}
const sessionStorageUji = buatStorage();
const localStorageUji = buatStorage();
globalThis.sessionStorage = sessionStorageUji;
globalThis.localStorage = localStorageUji;
globalThis.window = {
  sessionStorage: sessionStorageUji,
  localStorage: localStorageUji,
} as unknown as Window & typeof globalThis;

const SM = await import('../src/lib/sessionManager.ts');

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};
const PREFIX = 'epresensi_jatim_session_';
const AKTIF = 'epresensi_jatim_sesi_aktif';

/** Bentuk akun yang dipakai skrip ini; sama dengan hasil `loadSession()`. */
interface AkunUji {
  username: string;
  role: string;
  permissions: Record<string, boolean>;
  createdAt: string;
}

const akun = (username: string, role: string, izin: Record<string, boolean> = {}): AkunUji => ({
  username,
  role,
  permissions: izin,
  createdAt: '2026-01-01T00:00:00.000Z',
});
/*
 * ⚠️ `createAdminUserAccount()` **sudah dihapus** dari `sessionManager.ts`.
 *
 * Fungsi itu menyusun akun `role: 'admin'` dari peramban tanpa token server —
 * persis jalur yang membuat `role` bisa dipercaya dari storage. Sekarang
 * seluruh autentikasi lewat `POST /api/panel-auth`, dan `saveSession()`
 * mewajibkan token. Akun admin di sini karena itu disusun lokal, sama
 * seperti akun biasa; yang diuji modul ini adalah bentuk sesinya, bukan
 * bagaimana peran itu diperoleh.
 */
const admin = () => akun('admin', 'admin');
const user = (u: string): AkunUji => akun(u, 'user');

/**
 * Token tiruan.
 *
 * Hanya precisam **bentuk** yang benar: `<payload>.<signature>` base64url.
 * `bacaSatu()` memeriksa bentuk itu sebelum storage dibaca lebih jauh, dan
 * `AppContext` yang memanggil server untuk memeriksa keasliannya — bukan
 * modul ini. Jadi token di sini tidak pernah perlu benar-benar ditandatangani.
 *
 * Dibuat berbeda per akun+sesi supaya kalau ada bug yang menyalin token antar
 * akun, skrip ini bisaSEE-nya: `token untuk X != token untuk Y`.
 */
let tokenUrut = 0;
const tokenUntuk = (username: string): string => {
  tokenUrut += 1;
  const payload = Buffer.from(
    JSON.stringify({ v: 1, sub: username, jti: `uji-${tokenUrut}` }),
    'utf8'
  ).toString('base64url');
  return `${payload}.${Buffer.from(`tanda-${tokenUrut}`, 'utf8').toString('base64url')}`;
};

/**
 * `saveSession` dengan token otomatis untuk akun tersebut.
 *
 * Izin yang belum disebut tetap `false` — persis seperti pemanggil produksi,
 * yang mengirim `TabPermissions` lengkap.
 */
const simpan = (a: AkunUji, izin: Partial<TabPermissions>): void =>
  SM.saveSession(
    a as unknown as Parameters<typeof SM.saveSession>[0],
    { ...izin } as TabPermissions,
    tokenUntuk(a.username),
  );

const sesiTersimpan = (): string[] =>
  sessionStorageUji.semuaKunci().filter((k: string) => k.startsWith(PREFIX));
const reset = () => sessionStorage.clear();

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Refresh mengembalikan akun yang sama');
// ═════════════════════════════════════════════════════════════════════
for (const [label, a] of [
  ['admin', admin()],
  ['user', user('budi')],
] as Array<[string, AkunUji]>) {
  reset();
  simpan(a, { tabPresensi: true });
  // Refresh = muat ulang dari storage, state React dibuang.
  const setelahRefresh = SM.loadSession();
  cek(`refresh setelah login sebagai ${label} → ${label} yang sama`,
    setelahRefresh?.currentUser?.username === a.username,
    `dapat ${setelahRefresh?.currentUser?.username} (peran ${setelahRefresh?.boundRole})`);
  cek(`refresh setelah login sebagai ${label} → peran tidak berubah`,
    setelahRefresh?.boundRole === a.role);
  cek(`refresh setelah login sebagai ${label} → izin ikut termuat`,
    setelahRefresh?.tabPermissions?.tabPresensi === true);
}

// Refresh berulang harus tetap sama.
reset();
simpan(admin(), { tabPresensi: true });
for (let i = 1; i <= 5; i++) {
  cek(`refresh #${i} tetap admin`, SM.loadSession()?.currentUser?.username === 'admin');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Admin dan user TIDAK bisa hidup berdampingan');
// ═════════════════════════════════════════════════════════════════════
/*
 * Ini akar masalah dari laporan: "saya di akun admin tapi saya refresh
 * malah kembali ke user".
 *
 * Kalau dua sesi boleh berdampingan, `loadSession()` yang mencari "sesi
 * pertama" akan sewajarnya bisa mengembalikan yang salah — dan tidak ada
 * yang bisa memperbaikinya, karena tidak ada yang tahu akun mana yang
 * seharusnya dipakai.
 */
reset();
// Login sebagai user dulu — ini yang ditulis lebih awal.
simpan(user('budi'), { tabPresensi: true });
cek('sesi user tersimpan', sesiTersimpan().length === 1);
// Sekarang login sebagai admin, tanpa pemanggil melakukan apa pun.
simpan(admin(), { tabManajemenAkun: true });
cek('hanya satu sesi tersisa setelah login admin', sesiTersimpan().length === 1, sesiTersimpan().join(', '));
cek('sesi yang tersisa adalah admin', sesiTersimpan()[0] === `${PREFIX}admin`);
cek('refresh → admin, bukan user', SM.loadSession()?.currentUser?.username === 'admin',
  `dapat ${SM.loadSession()?.currentUser?.username}`);

// Urutan terbalik: admin dulu, lalu user.
reset();
simpan(admin(), { tabManajemenAkun: true });
simpan(user('siti'), { tabPresensi: true });
cek('hanya satu sesi tersisa setelah login user', sesiTersimpan().length === 1, sesiTersimpan().join(', '));
cek('refresh → user, bukan admin', SM.loadSession()?.currentUser?.username === 'siti',
  `dapat ${SM.loadSession()?.currentUser?.username}`);

// Tiga akun beda-beda, semuanya user.
reset();
simpan(user('budi'), {});
simpan(user('siti'), {});
cek('ganti akun user membuang sesi user sebelumnya', sesiTersimpan().length === 1, sesiTersimpan().join(', '));
cek('refresh → akun user yang terakhir', SM.loadSession()?.currentUser?.username === 'siti');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Penunjuk akun aktif');
// ═════════════════════════════════════════════════════════════════════
reset();
simpan(admin(), {});
cek('penunjuk = admin', sessionStorage.getItem(AKTIF) === 'admin', String(sessionStorage.getItem(AKTIF)));
simpan(user('budi'), {});
cek('penunjuk = budi setelah ganti akun', sessionStorage.getItem(AKTIF) === 'budi');
SM.clearAllSessions();
cek('penunjuk ikut terhapus saat logout', sessionStorage.getItem(AKTIF) === null,
  `dapat ${sessionStorage.getItem(AKTIF)}`);
cek('penunjuk tidak ikut dihitung sebagai sesi', sesiTersimpan().length === 0);

// Penunjuk yang menunjuk sesi hilang → harus TIDAK mencari akun lain.
reset();
simpan(user('budi'), {});
sessionStorage.removeItem(`${PREFIX}budi`); // sesi hilang, penunjuk masih ada
cek('penunjuk yatim → tidak menebak akun lain', SM.loadSession() === null,
  `dapat ${SM.loadSession()?.currentUser?.username ?? 'null'}`);
cek('penunjuk yatim dibersihkan', sessionStorage.getItem(AKTIF) === null);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Situasi ambigu: lebih dari satu sesi tanpa penunjuk');
// ═════════════════════════════════════════════════════════════════════
/*
 * Menulis langsung ke storage, melewati `saveSession()` — meniru bug lama
 * atau storage sisa. `loadSession()` tidak boleh memilih salah satu.
 */
/**
 * Tulis sesi **langsung ke storage**, melewati `saveSession()`.
 *
 * Ini yang perlu diuji: meniru storage sisa, atau bug lama yang menulis di
 * sana. Penunjuk sesi aktif sengaja **tidak** ikut ditulis — justru itu yang
 * membuat `loadSession()` faced situation ambigu.
 *
 * `version: 2` + token, jadi sesinya lolos pemeriksaan bentuk `bacaSatu()`.
 * Sesi versi 1 (tanpa token) diuji terpisah di bagian 5 — dan harus ditolak.
 */
const suntik = (u: string, role: string): void =>
  sessionStorage.setItem(
    `${PREFIX}${u}`,
    JSON.stringify({
      version: 2,
      currentUser: akun(u, role),
      tabPermissions: {},
      authTime: Date.now(),
      boundRole: role,
      token: tokenUntuk(u),
    })
  );

reset();
suntik('admin', 'admin');
suntik('budi', 'user');
cek('dua sesi tanpa penunjuk terdeteksi', sesiTersimpan().length === 2);
const hasilAmbigu = SM.loadSession();
cek('ambigu → TIDAK menebak, hasilnya null', hasilAmbigu === null,
  `dapat ${hasilAmbigu?.currentUser?.username ?? 'null'}`);
cek('ambigu → semua sesi dibuang', sesiTersimpan().length === 0, sesiTersimpan().join(', '));
cek('ambigu → penunjuk ikut dibuang', sessionStorage.getItem(AKTIF) === null);
cek('setelah ambigu, loadSession tetap null (tidak muncul dari mana mana)', SM.loadSession() === null);

// Tepat satu sesi tanpa penunjuk → boleh dipakai, lalu penunjuk ditulis.
reset();
suntik('budi', 'user');
const satu = SM.loadSession();
cek('tepat satu sesi tanpa penunjuk → dipakai', satu?.currentUser?.username === 'budi');
cek('penunjuk langsung ditulis agar tidak perlu ditebak lagi', sessionStorage.getItem(AKTIF) === 'budi');
cek('load berikutnya tetap sama', SM.loadSession()?.currentUser?.username === 'budi');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Sesi kedaluwarsa & rusak');
// ═════════════════════════════════════════════════════════════════════
/** Sesi valid bentuknya, tapi `authTime`-nya sudah lama. */
const aged = (ms: number): void =>
  sessionStorage.setItem(
    `${PREFIX}budi`,
    JSON.stringify({
      version: 2,
      currentUser: user('budi'),
      tabPermissions: {},
      authTime: Date.now() - ms,
      boundRole: 'user',
      token: tokenUntuk('budi'),
    })
  );

reset();
aged(31 * 60 * 1000);
cek('sesi lewat 30 menit ditolak', SM.loadSession() === null);
cek('sesi kedaluwarsa dihapus dari storage', sesiTersimpan().length === 0);

reset();
simpan(user('budi'), {});
sessionStorage.setItem(`${PREFIX}budi`, '{{{ bukan json');
cek('sesi rusak tidak bikin crash', SM.loadSession() === null);
cek('sesi rusak dihapus', sesiTersimpan().length === 0);

/*
 * ⚠️ Sesi **versi 1** harus dibuang, bukan dibaca lalu "divalidasi".
 *
 * Versi 1 adalah `{ currentUser, tabPermissions, boundRole }` — JSON polos yang
 * peramban bisa bebas menyusun. Tidak ada pemeriksaan apa pun yang bisa
 * dijalankan di peramban dan tetap berarti, jadi satu-satunya jalan aman adalah
 * membuangnya. Setiap orang yang sedang login saat versi ini dipasang akan diminta
 * login ulang sekali.
 */
reset();
sessionStorage.setItem(
  `${PREFIX}budi`,
  JSON.stringify({
    version: 1,
    currentUser: user('budi'),
    tabPermissions: { tabManajemenAkun: true },
    authTime: Date.now(),
    boundRole: 'user',
  })
);
cek('sesi versi 1 (tanpa token) ditolak', SM.loadSession() === null);
cek('sesi versi 1 dihapus dari storage', sesiTersimpan().length === 0);
cek('izin admin pada sesi versi 1 tidak pernah dipakai', SM.loadSession() === null);

// Versi masa depan — bentuk tidak dikenal, jadi tidak boleh dipakai.
reset();
sessionStorage.setItem(
  `${PREFIX}budi`,
  JSON.stringify({
    version: 999,
    currentUser: user('budi'),
    tabPermissions: {},
    authTime: Date.now(),
    boundRole: 'user',
    token: tokenUntuk('budi'),
  })
);
cek('versi sesi tidak dikenal ditolak', SM.loadSession() === null);

// Sesi versi 2 tanpa token — ditulis ulang peramban supaya commissioner bypass
// pemeriksaan versi. Token kosong tidak bisa diverifikasi siapa pun.
reset();
sessionStorage.setItem(
  `${PREFIX}budi`,
  JSON.stringify({
    version: 2,
    currentUser: user('budi'),
    tabPermissions: { tabManajemenAkun: true },
    authTime: Date.now(),
    boundRole: 'user',
    token: '',
  })
);
cek('sesi versi 2 tanpa token ditolak', SM.loadSession() === null);
cek('token kosong = tidak bisa dipercaya, meski versinya benar', sesiTersimpan().length === 0);

// Token yang bukan bentuk `<payload>.<signature>`.
reset();
sessionStorage.setItem(
  `${PREFIX}budi`,
  JSON.stringify({
    version: 2,
    currentUser: user('budi'),
    tabPermissions: {},
    authTime: Date.now(),
    boundRole: 'user',
    token: 'cuma-satu-bagian-tanpa-titik',
  })
);
cek('token tanpa tanda tangan ditolak sebelum memanggil server', SM.loadSession() === null);

// Peran tidak cocok (percobaan eskalasi lewat DevTools).
reset();
sessionStorage.setItem(
  `${PREFIX}budi`,
  JSON.stringify({ version: 1, currentUser: akun('budi', 'admin'), tabPermissions: {}, authTime: Date.now(), boundRole: 'user' })
);
cek('peran currentUser ≠ boundRole ditolak', SM.loadSession() === null);
cek('sesi dengan peran tidak cocok dihapus', sesiTersimpan().length === 0);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. touchSession memperpanjang masa berlaku');
// ═════════════════════════════════════════════════════════════════════
reset();
aged(29 * 60 * 1000); // 29 menit — masih valid tapi hampir habis
cek('29 menit masih valid', SM.loadSession()?.currentUser?.username === 'budi');
SM.touchSession();
cek('setelah touch, masih valid (1 menit lagi pun aman)', SM.loadSession()?.currentUser?.username === 'budi');
reset();
SM.touchSession();
cek('touch tanpa sesi tidak melempar', true);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. clearSessionByRole & clearAllSessions');
// ═════════════════════════════════════════════════════════════════════
reset();
simpan(admin(), {});
simpan(user('budi'), {});
cek('hanya admin yang tersisa setelah ganti akun', sesiTersimpan().length === 1);
simpan(admin(), {}); // admin lagi
cek('admin dikembalikan', SM.loadSession()?.currentUser?.username === 'admin');

reset();
suntik('admin', 'admin');
suntik('budi', 'user');
suntik('siti', 'user');
cek('tiga sesi disuntik', sesiTersimpan().length === 3);
SM.clearSessionByRole('user');
cek('clearSessionByRole(user) membuang 2 sesi user', sesiTersimpan().length === 1, sesiTersimpan().join(', '));
cek('sesi admin tersisa', sesiTersimpan()[0] === `${PREFIX}admin`);
SM.clearSessionByRole('admin');
cek('clearSessionByRole(admin) membuang sisanya', sesiTersimpan().length === 0);

reset();
suntik('admin', 'admin');
suntik('budi', 'user');
SM.clearAllSessions();
cek('clearAllSessions membuang semua sesi', sesiTersimpan().length === 0);
cek('clearAllSessions membuang penunjuk', sessionStorage.getItem(AKTIF) === null);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 8. Kunci lain di sessionStorage tidak ikut tersentuh');
// ═════════════════════════════════════════════════════════════════════
reset();
sessionStorage.setItem('jatim_titik_budi', 'data');
sessionStorage.setItem('jatim_developer_mode', 'false');
simpan(admin(), {});
simpan(user('budi'), {});
cek('kunci non-sesi tetap ada setelah ganti akun', sessionStorage.getItem('jatim_titik_budi') === 'data');
SM.clearAllSessions();
cek('clearAllSessions tidak menghapus kunci non-sesi', sessionStorage.getItem('jatim_titik_budi') === 'data');
cek('clearAllSessions tidak menghapus setelan non-sesi', sessionStorage.getItem('jatim_developer_mode') === 'false');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 9. Bentuk kode yang mencegah bug ini kembali');
// ═════════════════════════════════════════════════════════════════════
const src = readFileSync(`${root}src/lib/sessionManager.ts`, 'utf8');
/** `src` tanpa komentar — untuk pola yang bisa muncul di JSDoc. */
const srcKode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
cek('loadSession tidak lagi memakai loop "kembalikan yang pertama"',
  !/loadSession\(\)[\s\S]{0,400}for \(let index[\s\S]{0,400}return session;\s*\}\s*\}\s*catch/.test(src),
  'pola "return sesi valid pertama" adalah penyebab bug-nya');
cek('ada penunjuk akun aktif', src.includes('epresensi_jatim_sesi_aktif'));
cek('penunjuk dibaca loadSession', /const aktif = akunAktif\(\)/.test(src));
cek('saveSession membuang SEMUA sesi lain, bukan hanya beda peran',
  /for \(const key of semuaKunciSesi\(\)\) \{\s*if \(key !== kunci\) sessionStorage\.removeItem\(key\);/.test(src),
  'sisa sesi di storage = kredensial yang tidak perlu ada dan bisa terbaca lagi');
cek('saveSession TIDAK hanya membuang beda peran (itu aturan lama)',
  !/boundRole !== user\.role/.test(src));
cek('saveSession menulis penunjuk', /setAkunAktif\(user\.username\)/.test(src));
cek('clearAllSessions menghapus penunjuk', /removeItem\(ACTIVE_KEY\)/.test(src));
cek('penunjuk tidak memakai awalan sesi (tidak ikut teriterasi)', !/ACTIVE_KEY = SESSION_KEY_PREFIX/.test(src));
cek('situasi ambigu membuang semua, bukan menebak', /valid\.length > 1[\s\S]{0,900}clearAllSessions\(\)/.test(src));

const ctxSrc = readFileSync(`${root}src/context/AppContext.tsx`, 'utf8');
// Komentar dibuang dulu: JSDoc di atas sengaja mengutip bentuk kode lama
// ("const initialSession = loadSession();"), jadi tanpa ini pola salah itu
// akan selalu "ditemukan" di komentar.
const ctxKode = ctxSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
cek('AppContext memanggil loadSession hanya sekali (useState initializer)',
  /useState\(\(\) => loadSession\(\)\)/.test(ctxSrc) &&
  !/const initialSession = loadSession\(\);/.test(ctxKode),
  'panggilan langsung di badan komponen mengulang pembacaan storage tiap render');
cek('AppContext tidak menyimpan penengah loadSession di luar state',
  !/const\s+initialSession\s*=\s*loadSession\(\)/.test(ctxKode));

/*
 * ⚠️ Tidak ada lagi pembangun sesi **tanpa token**.
 *
 * `createAdminUserAccount()` menyusun `UserAccountSafe` dengan
 * `role: 'admin'` dari peramban, tanpa pernah menyentuh server. Semula dipakai
 * `LoginScreen`; sekarang autentikasi sepenuhnya lewat `POST /api/panel-auth`.
 *
 * Fungsi seperti ini berbahaya justru karena tidak terpakai: sekali diimpor
 * lagi, ia menyediakan jalan membuat sesi admin lokal yang tidak perlu
 * diverifikasi siapa pun. Dan `saveSession()` sudah menolak sesi tanpa token,
 * jadi nilai yang dikembalikan fungsi itu memang tidak bisa dipakai.
 */
// Komentar dibuang dulu: catatan di atas sengaja menyebut nama funksinya,
// jadi tanpa ini polanya akan selalu "ditemukan" di JSDoc.
cek('tidak ada pembangun sesi admin tanpa token',
  !/createAdminUserAccount/.test(srcKode),
  'peran harus datang dari server, bukan dari peramban');
cek('saveSession mewajibkan token (bukan opsional)',
  /saveSession\([\s\S]{0,300}?token: string[\s\S]{0,800}?throw new Error/.test(src));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 10. Sesi tanpa token tidak bisa dibuat');
/*
 * Ini lapis kedua. Penunjuk akun aktif (bagian 1–9) menjawab "akun mana yang
 * sedang dipakai"; token menjawab "apakah akun ini benar-benar punya izin, dan
 * dengan hak apa".
 *
 * Tanpa token, storage menyimpan `role` yang tidak punya bukti. Mengeditnya di
 * DevTools akan bertahan sampai 30 menit idle timeout — dan itulah celah yang
 * dipakai untuk "refresh jadi admin". Jadi `saveSession()` **melempar** kalau
 * token tidak ada: bukan diam-diam menyimpan, dan bukan juga menyimpan apa adanya.
 */
cek('saveSession mewajibkan token',
  /export function saveSession\([\s\S]{0,120}token: string/.test(src),
  'parameter wajib = pemanggil lama tidak bisa lagi kompilasi tanpa memperhatikannya');
cek('saveSession melempar kalau token kosong',
  /typeof token !== 'string' \|\| !token\.trim\(\)[\s\S]{0,320}throw new Error/.test(src));
cek('pesan throw menjelaskan alasan token dibutuhkan',
  /butuh token server/.test(src),
  'pesan harus menjelaskan aturannya, bukan hanya menuntut');
cek('bacaSatu menolak sesi tanpa token',
  /typeof session\.token !== 'string' \|\| !session\.token/.test(src));
cek('bacaSatu menolak token yang bukan dua bagian',
  /session\.token\.split\('\.'\)\.length !== 2/.test(src));
cek('versi sesi 2 — versi 1 yang bisa disunting dibuang',
  /SESSION_VERSION = 2/.test(src),
  'tanpa kenaikan versi, sesi lama yang tanpa token akan tetap terbaca');
cek('token bisa diganti tanpa mengganti akun',
  /export function perbaruiTokenSesi/.test(src));
cek('tokenAktif tersedia untuk modul yang butuh header Authorization',
  /export function tokenAktif/.test(src));
cek('AppContext memverifikasi token ke server',
  /verifikasiSesiPanel/.test(ctxSrc),
  'tanpa ini, storage = sumber kebenaran dan role bisa disunting');
cek('AppContext memakai peran dari server, bukan dari storage',
  /batasiIzin\(hasil\.akun\.permissions, hasil\.akun\.role\)/.test(ctxSrc));
cek('AppContext membuang sesi yang ditolak server',
  /clearAllSessions\(\)/.test(ctxSrc));
cek('AppContext punya state cekingSesi untuk menunda render',
  /cekingSesi/.test(ctxSrc) && /UNAUTHENTICATED_PERMISSIONS/.test(ctxSrc));

const appSrc = readFileSync(`${root}src/App.tsx`, 'utf8');
cek('App tidak memakai storage sebagai isAuthenticated',
  !/useState\(\(\)\s*=>\s*!!loadSession\(\)\)[\s\S]{0,80}isAuthenticated/.test(appSrc),
  'isAuthenticated dari storage = aplikasi dirender dengan role yang belum diverifikasi');
cek('App memeriksa token secara berkala',
  /verifikasiSesiPanel/.test(appSrc) && /5 \* 60 \* 1000/.test(appSrc),
  'token bisa dicabut server kapan saja (nonaktif, ganti peran)');

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
