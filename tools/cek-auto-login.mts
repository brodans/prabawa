/**
 * Uji auto-login server: apakah selalu mencoba, dan apakah "Keluar dari
 * Server" benar-benar mematikannya.
 *
 * ⚠️ Yang diuji di sini adalah logika yang tidak bergantung pada server:
 * faktor `imei`, penanda keluar, jalur cache, dan orkestrator percobaan.
 *
 * ⚠️ Jalur kredensial **di-stub**, bukan diuji sungguhan.
 *
 * `cobaAutoLogin()` sekarang memanggil `POST /api/panel-auth` (aksi
 * `pusat:login`) — server yang mendekripsi password server pusat dan memanggil
 * gateway — jadi skrip ini memasang `fetch` tiruan. Yang asli diuji di
 * `tools/cek-panel-auth.mts`, yang memakai instance Express sungguhan.
 *
 * Bagian 7 sengaja mereproduksi urutan yang dulu membuat auto-login mati:
 * `React.StrictMode` memasang efek dua kali, dan percobaan kedua harus
 * memakai promise yang sama — bukan memulai request baru, dan bukan
 * membatalkan yang pertama.
 */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

void webcrypto; // crypto global sudah tersedia di Node 20

// ── Stub penyimpanan browser ─────────────────────────────────────────
function buatStorage(): Storage {
  const data = new Map<string, string>();
  const s = {
    getItem: (k: string) => (data.has(k) ? data.get(k) ?? null : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
  } as Storage;
  return s;
}
const localStorageTiruan = buatStorage();
const sessionStorageTiruan = buatStorage();
globalThis.localStorage = localStorageTiruan;
globalThis.sessionStorage = sessionStorageTiruan;
// Modul aplikasi mengecek `typeof window !== 'undefined'` sebelum menyentuh
// penyimpanan, jadi `window` perlu ada — di sinilah tempatnya.
globalThis.window = {
  localStorage: localStorageTiruan,
  sessionStorage: sessionStorageTiruan,
} as unknown as Window & typeof globalThis;

/*
 * Tiruan `fetch` untuk `/api/panel-auth`.
 *
 * `cobaAutoLogin()` tidak lagi membaca Firestore maupun mendekripsi password
 * sendiri — itu pindah ke server. Jadi tanpa stub di sini, setiap percobaan
 * akan gagal karena `fetch` tidak ada, dan bagian-bagian yang benar-benar
 * sedang diuji (jalur cache, faktor `imei`, orkestrator StrictMode) ikut
 * gagal hanya karena satu ketergantungan jaringan.
 *
 * `jawaban` bisa diganti skrip untuk menguji kasus tertentu; default-nya
 * "kredensial belum diatur", yaitu kondisi yang paling sering terjadi di
 * perkakas ini.
 */
interface JawabanPanelAuth {
  status: number;
  body: Record<string, unknown>;
}

let jawabanPanelAuth: JawabanPanelAuth = {
  status: 404,
  body: { ok: false, kode: 404, pesan: 'Kredensial server belum diatur.' },
};

/**
 * Stub `fetch` yang menjawab `Response` penuh.
 *
 * `new Response(...)` dipakai supaya bentuk balikannya benar-benar `Response`,
 * termasuk `headers` dan `ok`. Stub yang hanya meniru sebagian bentuk bisa
 * membuat skrip lulus karena bukan lagi menguji kode produksi.
 * `res.ok` dan `res.status`, jadi hand-rolled bisa meloloskan bug yang
 * justru ada di situ.
 */
globalThis.fetch = (async (url: URL | RequestInfo) => {
  const alamat = String(url);
  if (!alamat.includes('/api/panel-auth')) {
    return new Response(JSON.stringify({ error: `Stub tidak tahu ${alamat}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { status, body } = jawabanPanelAuth;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof globalThis.fetch;

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const {
  cobaAutoLogin,
  sudahKeluarServer,
  tandaiAktifServer,
  tandaiKeluarServer,
  imeiStabil,
  simpanImei,
  // Orkestrator modul (lihat bagian 7 di bawah).
  mulaiAutoLogin,
  ulangAutoLoginTanpaCache,
} = await import('../src/lib/serverAutoLogin.ts');
const { setServerSessionCache } = await import('../src/lib/cacheManager.ts');

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Faktor ketiga: imei dibuat sekali lalu konsisten');
localStorage.clear();
const imei1 = imeiStabil('admin');
cek('imei tidak kosong', !!imei1, imei1);
cek('imei kedua pemanggilan sama', imeiStabil('admin') === imei1);
cek('imei tersimpan di localStorage', localStorage.getItem('epresensi_jatim_imei_admin') === imei1);
cek('imei akun lain berbeda', imeiStabil('operator') !== imei1);

localStorage.clear();
const imeiSetelahBersih = imeiStabil('admin');
cek('tech mark dibuat ulang setelah storage dibersihkan', imeiSetelahBersih !== imei1);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. imei yang diketag pengguna disimpan untuk dipakai lagi');
localStorage.clear();
simpanImei('admin', 'IMEI-PERANGKAT-ASLI');
cek('nilai manual dibaca kembali', imeiStabil('admin') === 'IMEI-PERANGKAT-ASLI');
cek('tidak ditimpa tech mark', imeiStabil('admin') === 'IMEI-PERANGKAT-ASLI');
cek('nilai kosong diabaikan', (simpanImei('admin', ''), imeiStabil('admin') === 'IMEI-PERANGKAT-ASLI'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. "Keluar dari Server" mematikan auto-login');
cek('sebelum keluar: belum ditandai', sudahKeluarServer('admin') === false);
tandaiKeluarServer('admin');
cek('sesudah keluar: ditandai', sudahKeluarServer('admin') === true);
cek('hanya untuk akun itu', sudahKeluarServer('operator') === false);

tandaiAktifServer('admin');
cek('login manual membuka lagi penanda', sudahKeluarServer('admin') === false);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Auto-login memakai cache sesi tanpa jaringan');
localStorage.clear();
setServerSessionCache('admin', {
  apiKey: 'TOKEN-ABC',
  nip: '200308062025101001',
  pegawaiId: '113866',
  idLokasi: '',
  kodeInstansi: '',
  kodeUnor: '',
  nama: 'PEGAWAI UJI',
  jabatan: 'Analis',
  instansi: '',
  departemen: 'SUB BAGIAN',
  group: 'pegawai',
  profilePic: '',
  usingWajah: 0,
  workCode: '',
  imei: 'IMEI-DARI-CACHE',
});

const h = await cobaAutoLogin('admin');
cek('status dari-cache', h.status === 'dari-cache', h.status);
cek('apiKey terbaca', h.profile?.apiKey === 'TOKEN-ABC');
cek('nama terbaca', h.profile?.nama === 'PEGAWAI UJI');
cek('imei terbaca', h.imei === 'IMEI-DARI-CACHE', h.imei);
cek('modul aktif default (cache tak menyimpan flag server)', h.profile?.modul?.presensi === 1);
cek('absenTimeout kembali ke default', h.profile?.absenTimeout === 300_000, String(h.profile?.absenTimeout));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Tanpa cache dan tanpa kredensial → dilaporkan, bukan error');
localStorage.clear();
sessionStorage.clear();
const g = await cobaAutoLogin('akun-baru');
cek('status belum-ada-kredensial', g.status === 'belum-ada-kredensial', g.status);
cek('tidak melempar exception', true);
cek('tidak mengembalikan profil', g.profile === undefined);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Cache kedaluwarsa tidak dipakai');
localStorage.clear();
sessionStorage.clear();
setServerSessionCache('admin', {
  apiKey: 'TOKEN-LAMA',
  nip: '200308062025101001',
  pegawaiId: '1',
  idLokasi: '',
  kodeInstansi: '',
  kodeUnor: '',
  nama: 'X',
  jabatan: '',
  instansi: '',
  departemen: '',
  group: '',
  profilePic: '',
  usingWajah: 0,
  workCode: '',
  imei: '',
});
// Paksa TTL habis dengan menggeser `cachedAt` ke masa lalu.
const key = 'epresensi_jatim_srvcache_admin';
const cache = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, unknown>;
cache.cachedAt = Date.now() - 61 * 60 * 1000; // 61 menit lalu, TTL = 60 menit
sessionStorage.setItem(key, JSON.stringify(cache));

const l = await cobaAutoLogin('admin');
cek('cache basi dibuang', l.status !== 'dari-cache', l.status);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Percobaan paralel berbagi satu promise');
// Ini mereproduksi urutan yang dulu membatalkan auto-login di StrictMode:
// dua mount beruntun untuk akun yang sama, dengan jeda di antaranya.
localStorage.clear();
sessionStorage.clear();

// Hitung berapa kali cache dibaca — ini proksi jumlah percobaan yang benar
//-benar dijalankan, tanpa perlu hook khusus di kode produksi.
const asliGetItem = sessionStorage.getItem.bind(sessionStorage);
let bacaCache = 0;
sessionStorage.getItem = (k: string) => {
  if (typeof k === 'string' && k.startsWith('epresensi_jatim_srvcache_')) bacaCache++;
  return asliGetItem(k);
};

setServerSessionCache('admin', {
  apiKey: 'TOKEN-SHARED', nip: '1', pegawaiId: '1', idLokasi: '', kodeInstansi: '', kodeUnor: '',
  nama: 'Y', jabatan: '', instansi: '', departemen: '', group: '', profilePic: '',
  usingWajah: 0, workCode: '', imei: 'IMEI-SHARED',
});

// Mount #1
const p1 = mulaiAutoLogin('admin');
// Mount #2 (StrictMode) — harus memakai promise yang sama.
const p2 = mulaiAutoLogin('admin');
cek('panggilan kedua bukan request baru', p1 === p2);
const [h1, h2] = await Promise.all([p1, p2]);
cek('keduanya berhasil', h1.status === 'dari-cache' && h2.status === 'dari-cache');
cek('hanya satu percobaan dijalankan', bacaCache === 1, `${bacaCache}×`);

/*
 * ⚠️ Setelah selesai, entri percobaan dihapus — TIDAK ada penanda
 * "sudah berhasil" yang bertahan.
 *
 * Modul ini pernah mengekspor `autoLoginSudahBerhasil()` untuk itu, tapi
 * tidak ada pemanggilnya, dan `mulaiAutoLogin()` juga tidak pernah
 * membacanya. Jadi penandanya ditulis tapi tidak pernah dibaca: proteksi
 * yang diklaim di komentar kode tidak pernah benar-benar ada.
 *
 * Kedua fungsi itu sudah dihapus. Yang diuji di sini justru perilaku yang
 * benar: panggilan SETELAH percobaan selesai memulai percobaan baru, bukan
 * memakai hasil lama — supaya "sambung ulang" benar-benar bertanya ke server.
 */
const p3 = mulaiAutoLogin('admin');
cek('panggilan setelah selesai = percobaan baru', p3 !== p1, 'kalau sama, hasil lama dipakai ulang');
cek('percobaan baru tetap berhasil', (await p3).status === 'dari-cache');
sessionStorage.getItem = asliGetItem;

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 8. Cache yang ditolak server memicu login ulang');
// Simulasikan: cache berisi token mati, kredensial ada di Firestore.
localStorage.clear();
sessionStorage.clear();
setServerSessionCache('admin', {
  apiKey: 'TOKEN-MATI', nip: '1', pegawaiId: '1', idLokasi: '', kodeInstansi: '', kodeUnor: '',
  nama: 'Y', jabatan: '', instansi: '', departemen: '', group: '', profilePic: '',
  usingWajah: 0, workCode: '', imei: 'IMEI-X',
});
const dariCache = await mulaiAutoLogin('admin');
cek('pertama kali dari cache', dariCache.status === 'dari-cache');

// Paksa login ulang tanpa cache — harus melewati cache dan tidak diam-diam
// mengembalikan token yang sama.
const { promise: ulangPromise } = ulangAutoLoginTanpaCache('admin');
const ulang = await ulangPromise;
cek('login ulang tidak memakai cache', ulang.status !== 'dari-cache', ulang.status);
cek('cache ditolak → jatuh ke kredensial / dilaporkan', !!ulang.status);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 9. resetAutoLogin membebaskan akun untuk dicoba lagi');
/*
 * `resetAutoLogin()` harus melepas percobaan yang sedang berjalan, sehingga
 * panggilan berikutnya benar-benar memulai percobaan baru — bukan
 * menerima promise lama yang sudah selesai.
 *
 * Status yang dikembalikan setelah reset TIDAK diuji di sini: cache sesi
 * dibuat ulang oleh modul sendiri di beberapa langkah sebelumnya, jadi
 * nilainya bergantung pada urutan pemanggilan skrip, bukan pada perilaku
 * produksi. Yang diuji adalah identitas promise-nya.
 */
const setelahReset = mulaiAutoLogin('admin');
cek('setelah reset, promise baru (bukan yang lama)', setelahReset !== p1 && setelahReset !== p3);
cek('setelah reset, percobaan benar-benar dijalankan', (await setelahReset) !== undefined);
cek('resetAutoLogin() tidak melempar', true);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 10. Pemanggil di App.tsx tidak punya pola yang membatalkan');
// Bagian 7 membuktikan orkestrator-nya benar. Tapi kalau pemanggilnya
// masih `abort()` di cleanup, request pertama tetap terbunuh di dev.
// Pola lamanya: `useRef` penjaga + `controller.abort()` di return.
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
// Komentar di dalam blok sengaja menjelaskan bug lamanya dengan menyebut
// `abort()` dan `usernameDiproses`, jadi pola yang dicari hanya yang benar-benar
// dieksekusi — bukan teksnya.
const appKode = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// Jangkar's dipilih dari baris kode, bukan judul komentar — judulnya hilang
// setelah komentar dibuang.
const efekAutoLogin = appKode.slice(
  appKode.indexOf('const setProfilServer = React.useCallback('),
  appKode.indexOf('const handleServerLogout')
);
cek('blok efek auto-login ditemukan', efekAutoLogin.length > 0);
cek('tidak ada abort() di dalam efek', !/\.abort\(\)/.test(efekAutoLogin));
cek('tidak ada penjaga ref "sudah diproses"', !/usernameDiproses/.test(appKode));
cek('memakai orkestrator modul', efekAutoLogin.includes('mulaiAutoLogin('));
cek('cleanup hanya menandai komponen mati', /hidup = false;/.test(efekAutoLogin));
cek('tetap menghormati "Keluar dari Server"', efekAutoLogin.includes('sudahKeluarServer('));
cek('cache lama diuji sebelum dipakai', efekAutoLogin.includes('tokenMasihValid('));
cek('cache ditolak → login ulang', efekAutoLogin.includes('ulangAutoLoginTanpaCache('));
cek('logout server mereset status auto-login', appSrc.includes('resetAutoLogin()'));

/*
 * Login manual di Beranda tidak perlu menandai apa pun.
 *
 * Sebelumnya ada `tandaiBerhasil()` untuk itu, dan berkasnya beralasan
 * "tanpa ini, `mulaiAutoLogin` masih mengira akun ini gagal". Tapi
 * `mulaiAutoLogin()` tidak pernah membaca penandanya — jadi alasannya
 * tidak berlaku, dan `berhasilUntuk` hanya pernah ditulis, tidak pernah
 * dibaca.
 *
 * Yang perlu dijaga sebenarnya: login manual harus membersihkan penanda
 * "sudah keluar dari server" dan menyimpan IMEI-nya, supaya auto-login
 * tidak langsung mencoba login lagi dengan kredensial basi.
 */
const berandaSrc = readFileSync(new URL('../src/pages/Beranda.tsx', import.meta.url), 'utf8');
const autoLoginSrc = readFileSync(new URL('../src/lib/serverAutoLogin.ts', import.meta.url), 'utf8');
cek('login manual menandai server aktif', berandaSrc.includes('tandaiAktifServer('));
cek('login manual menyimpan IMEI', berandaSrc.includes('simpanImei('));
cek('login manual membesarkan penanda "keluar dari server"',
  /setServerLogoutRequested\(false\)/.test(berandaSrc));
cek('tidak ada penanda "berhasil" yang tidak pernah dibaca',
  !berandaSrc.includes('tandaiBerhasil(') && !autoLoginSrc.includes('berhasilUntuk'),
  'kalau muncul lagi, pastikan `mulaiAutoLogin()` MEMBACANYA');

// main.tsx memakai StrictMode — inilah yang memicu mount ganda.
const mainSrc = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
cek('main.tsx memang memakai StrictMode (alasan bug ini muncul)', mainSrc.includes('StrictMode'));

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
