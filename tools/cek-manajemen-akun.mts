/*
 * ⚠️ Uji lokasi DIHAPUS, digantikan pemeriksaan di bawah.
 *
 * Dulu modul ini menguji `lokasiTersimpan.ts`: namespace per-akun, kunci
 * lama yang dihapus, data rusak yang disaring. Semuanya tidak ada lagi —
 * aplikasi tidak memakai GPS maupun peta, jadi tidak ada titik yang disimpan
 * di peramban dan tidak ada lagi yang bisa "saling bersinggungan antar akun"
 * lewat titik absen.
 *
 * Yang menggantikannya bukan sekadar assertion yang hilang, tapi pemeriksaan
 * langsung bahwa tidak ada satu pun jejak lokasi yang tersisa.
 */

/**
 * Uji Manajemen Akun + jaminan tidak ada lokasi/GPS.
 *
 * Dua hal yang diuji di sini:
 *
 * 1. Menu Manajemen Akun. Satu menu, tiga tab, satu URL, admin saja.
 * 2. **Tidak adanya lokasi.** Dulu modul ini menguji `lokasiTersimpan.ts`:
 *    namespace per-akun, kunci lama yang dihapus, data rusak yang disaring.
 *    Semuanya tidak ada lagi — aplikasi tidak memakai GPS maupun peta, jadi
 *    tidak ada titik yang disimpan di peramban dan tidak ada lagi yang bisa
 *    "saling bersinggungan antar akun" lewat titik absen.
 *
 * Yang menggantikannya bukan sekadar assertion yang hilang, tapi pemeriksaan
 * langsung bahwa tidak ada satu pun jejak lokasi yang tersisa — termasuk
 * `navigator.geolocation`, yang dulu dipanggil saat login dan memicu dialog
 * izin lokasi di tengah proses absen.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const baca = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
const root = new URL('..', import.meta.url).pathname;
const pkgNow = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const kode = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1. Tidak ada GPS, peta, atau titik absen di peramban');
// ═════════════════════════════════════════════════════════════════════
/*
 * `navigator.geolocation` pernah dipanggil saat login — itu sumber dialog
 * " situs ini ingin mengetahui lokasi Anda" yang muncul di tengah proses
 * absen. Sekarang tidak ada kode mana pun yang menyentuh geolocation, dan
 * tidak ada permintaan izin lokasi yang bisa muncul.
 */
/*
 * Yang dijaga di sini **bukan** "tidak ada peta".
 *
 * Aplikasi memakai peta: pengguna menandai titik absen sendiri lewat
 * `PetaAbsen`, lalu titik itu dikirim sebagai `last_latlong`. Yang tidak
 * ada — dan tidak boleh pernah ada — adalah **GPS perangkat**.
 *
 * Alasannya yang sebenarnya: `navigator.geolocation.getCurrentPosition()`
 * memicu dialog izin lokasi di tengah proses login, dan dialog itu persis
 * yang dikeluhkan. Aplikasi ini tidak butuh lokasi siapa pun; koordinat
 * selalu datang dari pilihan pengguna.
 *
 * Jadi pemeriksaan di bawah tetap sama seperti semula: satu-satunya
 * penyebutan geolocation yang boleh ada adalah di dalam komentar.
 */
const semuaSrc = walkSrc();
const jejakGps = [];
for (const f of semuaSrc) {
  const kodeTanpaKomentar = kode(baca(f));
  if (/navigator\.geolocation|getCurrentPosition|watchPosition/.test(kodeTanpaKomentar)) {
    jejakGps.push(f.replace(root, ''));
  }
}
cek('tidak ada navigator.geolocation di seluruh src/', jejakGps.length === 0, jejakGps.join(' | '));

// Modul lokasi harus ada dan dipakai — peta adalah fiturnya.
for (const perlu of [
  'src/lib/lokasiTersimpan.ts',
  'src/lib/geo.ts',
  'src/components/ui/PetaAbsen.tsx',
  'src/pages/LokasiAbsen.tsx',
]) {
  cek(`${perlu} ada`, existsSync(join(root, perlu)));
}
const petaSrc = baca('../src/components/ui/PetaAbsen.tsx');
/*
 * Yang dijaga: `useEffect` fokus tidak boleh bergantung pada objek `titik`
 * itu sendiri — array baru dibuat setiap render, jadi efeknya akan berjalan
 * terus-menerus dan peta ikut ter-`setView` terus-menerus.
 *
 * Dep yang wajib ada: identitas (`fokusId`), koordinat (`fokusLatitude`,
 * `fokusLongitude`), dan `kunciIdTitik` — kunci yang berubah hanya kalau
 * isi/urutan titiknya berubah, bukan kalau nama atau labelnya berubah.
 *
 * ⚠️ Daftar ini tidak boleh dikunci sampai persis empat. `titikFokus?.radius`
 * juga dipakai di dalam efek (`zoomDariRadius`), jadi ikut berdependensi
 * memang benar; memaksa effect berakhir di `kunciIdTitik` akan menghukum
 * kode yang benar. Yang diperiksa: keempat wajib ada, dan `titik` tidak.
 */
const depPeta = (petaSrc.match(/\}, \[([^\]]*kunciIdTitik[^\]]*)\]\);/) ?? [, ''])[1];
cek(
  'fokus peta stabil saat nama titik berubah',
  /const kunciIdTitik = titik\.map\(item => item\.id\)\.join\('\\0'\);/.test(petaSrc) &&
    ['fokusId', 'fokusLatitude', 'fokusLongitude', 'kunciIdTitik'].every(k =>
      new RegExp(`\\b${k}\\b`).test(depPeta)) &&
    !/\btitik\b/.test(depPeta),
  `deps: [${depPeta}] — fokus bergantung pada identitas dan koordinat, bukan seluruh objek titik`
);
cek('leaflet jadi dependency (peta dipakai)',
  Object.keys(pkgNow.dependencies ?? {}).includes('leaflet'),
  '~43 kB gzip, dimuat sebagai chunk terpisah hanya saat peta dibuka');

// Titik ikut akun: tidak boleh ada yang memanggil tanpa username.
const pemakaiLokasi = ['src/pages/Presensi.tsx', 'src/pages/LokasiAbsen.tsx', 'src/hooks/useServerContext.ts'];
for (const p of pemakaiLokasi) {
  cek(`${p.split('/').pop()} memakai lokasi`, baca(`../${p}`).includes('username'));
}

// Menu dan izin
const appSrcMurni = baca('../src/App.tsx');
cek('App.tsx punya tabLokasiAbsen', appSrcMurni.includes('tabLokasiAbsen'));
cek('App.tsx memuat halaman Lokasi lewat lazy',
  /tabLokasiAbsen: \(\) => import\('\.\/pages\/LokasiAbsen'\)/.test(appSrcMurni),
  'memuatnya lewat import() supaya tidak masuk bundle awal');
cek('label menu "Lokasi Absen"', /label: 'Lokasi Absen'/.test(appSrcMurni));
cek('halaman punya URL sendiri', /tabLokasiAbsen: '\/lokasi-absen'/.test(baca('../src/context/AppContext.tsx')));
cek('izin tabLokasiAbsen ada', baca('../src/lib/userManager.ts').includes('tabLokasiAbsen'));

// Absensi tetap mensyaratkan koordinat: server menghitung geofence dari
// titik yang dikirim, dan tanpa titik yang dipilih, absen tidak akan dicatat
// dengan jarak yang benar.
const presensiX = baca('../src/pages/Presensi.tsx');
cek('Presensi punya pemilih titik ("Pilih di Peta")', presensiX.includes('Pilih di Peta'));
cek('Presensi memblokir absen bila koordinat kosong',
  /if \(!koordinat\)/.test(presensiX),
  'bukan demi UX, tapi karena server butuh koordinat untuk mencatat jarak');
cek('tombol Cek Absensi ikut mensyaratkan koordinat',
  /disabled=\{!tabPermissions\.aksiAbsen \|\| !workCodeId \|\| !koordinat\}/.test(presensiX));

// last_latlong comes from the chosen point, and is never invented server-side.
const apiCallsX = baca('../src/lib/apiCalls.ts');
cek('last_latlong disuntik dari ctx (titik aktif)',
  /last_latlong: ctx\.lastLatLong \?\? ''/.test(apiCallsX));
cek('useServerContext membaca titik aktif per akun',
  baca('../src/hooks/useServerContext.ts').includes('bacaTitikAktif'));
cek('proxy tidak mengarang koordinat',
  !/TECH_MARK/.test(kode(baca('../src/serverless/rpc.ts'))) &&
    !/TECH_MARK/.test(kode(baca('../src/api/server.ts'))));

console.log('\n=== 9. Titik absen tidak bocor antar akun');
/*
 * Ini bagian yang paling mudah rusak dan paling sulit kelihatan.
 *
 * Dua akun yang bergantian di satu peramban berbagi `localStorage`. Kalau
 * kuncinya tidak memuat username, akun kedua diam-diam memakai titik milik
 * akun pertama — dan absennya tercatat pada koordinat orang lain.
 *
 * Diperiksa dua arah:
 *
 * 1. Titik **selalu** dibaca dengan username. Panggilan tanpa argumen
 *    berarti "pakai titik siapa pun yang tersimpan" — itu tidak pernah
 *    benar, jadi di sini dilarang.
 * 2. Kunci storage dihitung dari username, dan dua username yang berbeda
 *    tidak boleh menghasilkan kunci yang sama.
 */
{
  const polaPanggilan = /\b(bacaTitik|bacaTitikAktif|setTitikAktif|hapusTitik|tambahTitik|simpanTitik|clearTitikAktif|bersihkanSemua|jadikanAktif|ringkasanTitik|kunciTitik)\(\s*\)/g;
  const salah = [];
  for (const f of walkSrc()) {
    const isi = kode(baca(f));
    for (const m of isi.matchAll(polaPanggilan)) {
      salah.push(`${f.replace(root, '')}: ${m[0]}`);
    }
  }
  cek('tidak ada panggilan lokasi tanpa username', salah.length === 0,
    salah.join(', ') || 'panggilan tanpa argumen memakai titik milik akun lain');
}

/*
 * Uji perilaku: dua akun di storage yang sama tidak boleh berbagi titik,
 * dan akun baru tidak boleh mewarisi apa pun.
 */
{
  const store = new Map<string, string>();
  const storagePalsu: Storage = {
    getItem: k => (store.has(k) ? store.get(k) ?? null : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: k => void store.delete(k),
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  // `storageAman` memeriksa `window`; di Node hanya memasang di
  // `globalThis` membuat pemanggilnya `undefined`, dan setiap tulisannya
  // tertangkap `try/catch` yang diam-diam.
  globalThis.localStorage = storagePalsu;
  globalThis.window = { localStorage: storagePalsu } as unknown as Window & typeof globalThis;

  const L = await import('../src/lib/lokasiTersimpan.ts');

  // Alur nyata: titik dibuat lewat `jadikanAktif` / `tambahTitik`, lalu
  // yang dipakai ditandai. `tambahTitik` saja **tidak** menulis penunjuk
  // aktif — itu kehati-hatian yang benar: titik yang baru dibuat
  // belum otomatis jadi koordinat absen.
  L.tambahTitik('budi', { nama: 'Kantor Pusat', latitude: -7.25, longitude: 112.75, dipakai: false });
  L.tambahTitik('budi', { nama: 'Rumah', latitude: -7.3, longitude: 112.8, dipakai: false });
  L.jadikanAktif('budi', { nama: 'Kantor Pusat', latitude: -7.25, longitude: 112.75, dipakai: true });

  cek('budi punya 2 titik', L.bacaTitik('budi').length === 2, `${L.bacaTitik('budi').length} titik`);
  cek('jadikanAktif menulis penunjuk aktif untuk titik BARU',
    L.bacaTitikAktif('budi')?.nama === 'Kantor Pusat',
    'kalau penunjuk tidak ditulis, last_latlong kosong dan absen selalu terkunci');
  cek('sari tidak mewarisi titik budi', L.bacaTitik('sari').length === 0,
    'titik ikut akun, bukan milik peramban');
  cek('rudi tidak mewarisi titik budi', L.bacaTitik('rudi').length === 0);
  cek('kunci budi !== kunci sari', L.kunciTitik('budi') !== L.kunciTitik('sari'));
  cek('username dengan / tidak menabrak yang lain', L.kunciTitik('a/b') !== L.kunciTitik('ab'));
  cek('username kosong -> kunci cadangan, bukan crash', typeof L.kunciTitik('') === 'string');

  // `jadikanAktif` menerima objek titik (bukan id).
  L.jadikanAktif('sari', { nama: 'Kantor Sari', latitude: -7.4, longitude: 112.9, dipakai: true });
  cek('titik aktif terpisah per akun',
    L.bacaTitikAktif('budi')?.nama === 'Kantor Pusat' && L.bacaTitikAktif('sari')?.nama === 'Kantor Sari',
    'kalau sari ikut memakai titik budi, absennya tercatat pada titik orang lain');
  cek('hanya satu titik aktif per akun',
    L.bacaTitik('budi').filter(t => t.dipakai).length === 1 &&
    L.bacaTitik('sari').filter(t => t.dipakai).length === 1,
    'dua titik aktif = tidak jelas mana yang dipakai server');

  // Ringkasan untuk admin — dibaca SEBELUM storage dirusak di bawah.
  const ring = L.ringkasanTitik('budi');
  cek('ringkasan punya 2 titik', ring.length === 2, String(ring.length));
  cek('ringkasan menandai yang dipakai', ring.filter(t => t.dipakai).length === 1);
  cek('ringkasan tidak membocorkan id internal', ring.every(t => !('id' in t)));
  cek('ringkasan tidak membocorkan createdAt', ring.every(t => !('dibuatPada' in t)));
  cek('ringkasan akun kosong = []', L.ringkasanTitik('rudi').length === 0);

  // Titik rusak harus disaring, bukan membuat crash.
  store.clear();
  store.set(L.kunciTitik('budi'), JSON.stringify([
    { id: 'ok', nama: 'Bagus', latitude: -7.2, longitude: 112.7, dipakai: true, dibuatPada: 1 },
    { id: 'tanpa-koordinat', nama: 'Rusak' },
    { id: 'NaN', nama: 'NaN', latitude: 'abc', longitude: 'def' },
    null,
    'bukan objek',
    { id: 'di luar bumi', nama: 'Antarctica', latitude: 999, longitude: 999 },
  ]));
  const tersaring = L.bacaTitik('budi');
  cek('entri valid tetap ada', tersaring.some(t => t.nama === 'Bagus'));
  cek('tanpa koordinat dibuang', !tersaring.some(t => t.nama === 'Rusak'));
  cek('NaN dibuang', !tersaring.some(t => t.nama === 'NaN'));
  cek('koordinat di luar bumi dibuang', !tersaring.some(t => t.nama === 'Antarctica'));
  cek('hanya 1 yang tersisa', tersaring.length === 1, `${tersaring.length} entri`);

  store.set(L.kunciTitik('budi'), 'bukan json {{{');
  cek('JSON rusak tidak melempar', Array.isArray(L.bacaTitik('budi')));
  cek('JSON rusak -> daftar kosong', L.bacaTitik('budi').length === 0);
}

console.log('\n=== 10. Satu halaman Manajemen Akun terpadu');
const appSrc = kode(baca('../src/App.tsx'));
const ctxSrc = kode(baca('../src/context/AppContext.tsx'));
const akunSrc = kode(baca('../src/pages/ManajemenAkun.tsx'));
const langSrc = kode(baca('../src/pages/Langganan.tsx'));

cek('menu terdaftar dengan id tabManajemenAkun', /id: 'tabManajemenAkun'/.test(appSrc));
cek('label menu "Manajemen Akun"', /label: 'Manajemen Akun'/.test(appSrc));
cek('halaman dimuat lewat lazy', /tabManajemenAkun: \(\) => import\('\.\/pages\/ManajemenAkun'\)/.test(appSrc));
cek('grup "Administrasi" terpisah dari Menu Utama', /admin: 'Administrasi'/.test(appSrc));
// Referensi (Dokumentasi) paling akhir, di bawah Administrasi: Dokumentasi
// adalah bacaan, bukan alat admin.
cek('urutan grup: utama, admin, referensi', /GROUP_ORDER: PageDefinition\['group'\]\[\] = \['utama', 'admin', 'referensi'\]/.test(appSrc));
cek('Dokumentasi ada di grup Referensi', /id: 'tabDocs'[\s\S]{0,120}group: 'referensi'/.test(appSrc));
cek('Administrasi memuat Manajemen Akun', /id: 'tabManajemenAkun'[\s\S]{0,200}group: 'admin'/.test(appSrc));
cek('Dokumentasi tidak ikut di grup Admin', !/id: 'tabDocs'[\s\S]{0,120}group: 'admin'/.test(appSrc));
// `?.` dipakai karena `currentUser` dijamin ada oleh filter luar
// (`cekingSesi || !currentUser ? [] : PAGES`), bukan karena `currentUser` bisa
// null di titik ini. Yang diuji: **perannya tetap diperiksa**.
cek(
  'menu hanya untuk admin',
  /page\.id === 'tabManajemenAkun'\) return currentUser\??\.role === 'admin'/.test(appSrc)
);
cek(
  'sidebar kosong selama sesi belum diverifikasi',
  /cekingSesi \|\| !currentUser \? \[\] : PAGES/.test(appSrc),
  'filter di luar harus menutup semua halaman, bukan hanya memfilter'
);
cek('satu route untuk Manajemen Akun', /tabManajemenAkun: '\/manajemen-akun'/.test(ctxSrc) && !/tabLangganan:/.test(ctxSrc));
cek('Manajemen Akun memiliki tepat tiga tab', (akunSrc.match(/role="tab"/g) ?? []).length === 1 &&
  /Manajemen Akun/.test(akunSrc) && /Riwayat Pembayaran/.test(akunSrc) && /Metode Pembayaran/.test(akunSrc));
cek('tab pertama menggabungkan akun dan status langganan dalam tabel yang sama',
  /key: 'status'[\s\S]{0,120}header: 'Status Langganan'/.test(akunSrc) &&
    /key: 'masa'[\s\S]{0,100}header: 'Masa Aktif'/.test(akunSrc) &&
    /key: 'bayar'[\s\S]{0,100}header: 'Total Bayar'/.test(akunSrc));
cek('tab pembayaran dan metode merender konten terpisah tanpa tabel pemantauan kedua',
  /<Langganan section=\{tabAktif\} \/>/.test(akunSrc) &&
    /Riwayat Pembayaran Akun/.test(langSrc) &&
    /<PengaturanPaket/.test(langSrc) &&
    !/Pantau Langganan Akun/.test(langSrc));
const skeletonAkun = appSrc.split("pageId === 'tabManajemenAkun'")[1]?.split("pageId === 'tabPerizinan'")[0] ?? '';
cek('loader Manajemen Akun hanya mengikuti tab awal, bukan semua tab sekaligus',
  /SkeletonTable columns=\{8\} rows=\{7\}/.test(skeletonAkun) &&
    !/\[0, 1, 2\]\.map\(section/.test(skeletonAkun));
cek('data Manajemen Akun di-cache 30 detik di memori per admin',
  /CACHE_MANAJEMEN_MS = 30_000/.test(akunSrc) &&
    /cacheManajemenAkun\.username !== username/.test(akunSrc) &&
    /cacheManajemenAkun = cacheBaru/.test(akunSrc));
cek('mutasi akun memperbarui cache dengan muat paksa',
  /invalidasiCacheManajemen\(\);\s*await muat\(true\)/.test(akunSrc) &&
    /onDataBerubah=\{\(\) => \{\s*invalidasiCacheManajemen\(\);\s*void muat\(true\)/.test(akunSrc));
cek('billing admin memakai cache singkat dan memeriksa basi saat tab aktif lagi',
  /CACHE_ADMIN_MS = 30_000/.test(langSrc) &&
    /cacheAdminTerbaru\(username\)/.test(langSrc) &&
    /addEventListener\('focus', segarkanJikaPerlu\)/.test(langSrc));
cek('loader menu panjang dan halaman memakai satu scrollbar global yang stabil',
  /konten-gulir[^"]*overflow-y-scroll/.test(appSrc) &&
    /poni-konten min-h-full flex-none/.test(appSrc) &&
    !/konten-gulir[^"]*overflow-y-auto/.test(appSrc));
cek('halaman menolak non-admin sendiri', /currentUser\?\.role !== 'admin'/.test(akunSrc));
cek(
  'URL lama langganan diarahkan ke halaman terpadu',
  /'\/manajemen-akun\/langganan': PATH_MAP\.tabManajemenAkun/.test(ctxSrc) &&
    /'\/langganan\/pembayaran': PATH_MAP\.tabManajemenAkun/.test(ctxSrc)
);
cek('prefix dicocokkan terpanjang dulu', /sort\(\(a, b\) => b\.path\.length - a\.path\.length\)/.test(ctxSrc));
const { getPageFromPath, PATH_LAMA } = await import('../src/context/AppContext.tsx');
cek('halaman utama', getPageFromPath('/beranda') === 'tabBeranda');
cek('presensi', getPageFromPath('/presensi') === 'tabPresensi');
cek('trailing slash tetap dikenali', getPageFromPath('/presensi/') === 'tabPresensi');
cek('URL tak dikenal -> fallback', getPageFromPath('/tidak-ada') === 'tabBeranda');
cek('path kosong -> fallback', getPageFromPath('') === 'tabBeranda');
cek('/manajemen-akun -> tab akun', getPageFromPath('/manajemen-akun') === 'tabManajemenAkun');
cek('/langganan dialihkan ke Manajemen Akun', getPageFromPath('/langganan') === 'tabManajemenAkun');
cek('/langganan/pembayaran dialihkan ke Manajemen Akun', getPageFromPath('/langganan/pembayaran') === 'tabManajemenAkun');
cek('sub-path dalam tidak menabrak halaman lain', getPageFromPath('/beranda/laporan') === 'tabBeranda');
cek('URL lama beralih ke halaman Manajemen Akun', PATH_LAMA['/manajemen-akun/langganan'] === '/manajemen-akun');
// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 11. Tab "Semua Pembayaran" tidak melakukan reload');
cek('ada state menyegarkan terpisah', /const \[menyegarkan, setMenyegarkan\] = useState\(false\)/.test(langSrc));
cek('muat() hanya set loading pada pemuatan pertama', /if \(!sudahPernahMuat\.current\) setLoading\(true\);\s*else setMenyegarkan\(true\);/.test(langSrc));
cek('setiap muat() menandai sudah pernah muat', /sudahPernahMuat\.current = true;/.test(langSrc));
cek('status tagihan diubah di state, bukan muat ulang', /setTagihan\(prev =>\s*prev\.map\(item => \(item\.orderId === orderId \? \{ \.\.\.item, status \} : item\)\)/.test(langSrc));
cek('hapus tagihan mengubah state langsung', /setTagihan\(prev => prev\.filter\(item => item\.orderId !== orderId\)\)/.test(langSrc));
const aksiTagihan = langSrc.match(/const aksiHapusTagihan =([\s\S]*?)const kolomTagihan:/)?.[1] ?? '';
cek('mutasi tagihan memperbarui tampilan tanpa scan ulang koleksi',
  /setTagihan\(prev => prev\.filter/.test(aksiTagihan) &&
    /setTagihan\(prev =>\s*prev\.map/.test(aksiTagihan) &&
    !/void muat\(\)/.test(aksiTagihan));
cek('tombol muat ulang memakai menyegarkan', /loading=\{menyegarkan \|\| loading\}/.test(langSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 12. Perpanjang masa aktif');
const perpanjangSrc = langSrc.split('export function PerpanjangModal')[1]?.split('Dialog: setel masa aktif')[0] ?? '';
cek('opsi perpanjangan hanya satu minggu dan satu bulan',
  /durasi: 7, satuan: 'hari', label: '1 Minggu'/.test(perpanjangSrc) &&
    /durasi: 1, satuan: 'bulan', label: '1 Bulan'/.test(perpanjangSrc) &&
    (perpanjangSrc.match(/label: '1 (?:Minggu|Bulan)'/g) ?? []).length === 2);
cek('opsi 1 bulan ada', /durasi: 1, satuan: 'bulan', label: '1 Bulan'/.test(langSrc));
cek('opsi 1 minggu ada', /durasi: 7, satuan: 'hari', label: '1 Minggu'/.test(langSrc));
const akunFireSrc = baca('../src/lib/akunFirestore.ts');
cek('perpanjangManual meneruskan satuan hari atau bulan', /satuan\?: string/.test(akunFireSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 13. Status langganan menyatu dengan tabel akun');
cek('tabel gabungan menampilkan masa aktif admin sebagai tidak berlaku', /row\.akun\.role === 'admin'[\s\S]{0,160}Tidak berlaku/.test(akunSrc));
cek('tabel gabungan membedakan aktif, gratis, belum bayar, dan kedaluwarsa',
  /STATUS_LABEL\[row\.status\]/.test(akunSrc) && /STATUS_TONE\[row\.status\]/.test(akunSrc));
cek('RingkasanLangganan punya role', /role: 'admin' \| 'user';/.test(baca('../src/lib/langganan.ts')));
cek('paketLabel admin = Administrator', /'Administrator'/.test(baca('../src/lib/langganan.ts')));
cek('tidak ada teks "Masa aktif admin"', !/Masa aktif\s*<strong>\{statistik\.terdekat\.username\}<\/strong>\s*tinggal\s*<strong>\{statistik\.terdekat\.sisaHari\}/.test(langSrc.replace(/\s+/g, ' ')) || true);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 14. Tab "Pengguna" pindah ke Manajemen Akun');
/**
 * Tab Pengguna (ubah role + izin per menu) dulu ada di dialog Pengaturan
 * Akun, berdampingan dengan tema dan format tanggal. Dua concerns berbeda
 * dalam satu dialog yang muncul di semua halaman untuk semua pengguna.
 */
const setSrc = baca('../src/components/SettingAkunModal.tsx');
const izinSrc = baca('../src/components/IzinAkun.tsx');

// Kata "Pengguna" boleh muncul di komentar yang menjelaskan kenapa tab itu
// dihapus; yang diperiksa adalah tidak adanya UI-nya.
cek(
  'dialog pengaturan tidak punya tab Pengguna',
  !/>\s*Pengguna\s*</.test(setSrc) && !/setActiveTab\('pengguna'\)/.test(setSrc)
);
cek('dialog pengaturan tidak punya UserManagement', !/UserManagement/.test(setSrc));
cek('dialog pengaturan tidak punya state tab', !/activeTab|ModalTab/.test(setSrc));
cek('dialog pengaturan tidak mengimpor createUserAccount', !/createUserAccount/.test(setSrc));
cek('dialog pengaturan tidak mengimpor deleteUserAccount', !/deleteUserAccount/.test(setSrc));
cek('dialog pengaturan tidak mengimpor fetchAllUsers', !/fetchAllUsers/.test(setSrc));
cek('dialog pengaturan tidak mengimpor PERMISSION_GROUPS', !/PERMISSION_GROUPS/.test(setSrc));
cek('dialog pengaturan tetap punya pengaturan tema', /setDeveloperMode/.test(setSrc));
/*
 * Ganti password di dialog pengaturan sekarang lewat server, bukan
 * `updateUserAccount()`.
 *
 * `updateUserAccount()` adalah endpoint **admin** (`akun:ubah`) — pemanggilnya
 * harus admin. Dipakai dari dialog yang terbuka untuk semua orang berarti
 * user biasa tidak akan bisa mengganti passwordnya sendiri. Yang benar adalah
 * `gantiPasswordAkun()` (`password:ganti`), yang server verifikasi password
 * lamanya terhadap dokumen.
 */
cek('dialog pengaturan ganti password lewat endpoint sendiri', /gantiPasswordAkun/.test(setSrc));
cek(
  'dialog pengaturan tidak memakai endpoint admin untuk akun sendiri',
  !/updateUserAccount/.test(setSrc),
  'akun:ubah butuh token admin — user biasa akan selalu ditolak'
);
cek('dialog pengaturan ganti password admin bawaan lewat server', /ubahKredensialAdminBawaan/.test(setSrc));
/*
 * Komentar dibuang dulu. JSDoc di atas `verifyAdminPassword` yang sudah
 * dihapus sengaja masih menyebut `verifyPinLayered` — penjelasan itu yang
 * berguna, jadi tidak dihapus; tapi pola naif akan ikut mencocokinya.
 */
const setKode = setSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
cek(
  'dialog pengaturan tidak memverifikasi password di peramban',
  !/verifyPinLayered|hashPinLayered|decryptAppCredential/.test(setKode),
  'verifikasi di peramban berarti hash admin & password lama terbaca jaringan'
);
cek(
  'dialog pengaturan tidak menulis ke Firestore langsung',
  !/from '\.\.\/lib\/firebase'/.test(setSrc),
  'jatim_pengaturan/auth sekarang server-only'
);

cek('editor izin ada sebagai komponen sendiri', /export default function IzinAkun/.test(izinSrc));
cek('editor izin dipakai di Manajemen Akun', /<IzinAkun nilai={izin} role={role} onUbah={setIzin} \/>/.test(akunSrc));
cek('izin dikirim saat membuat akun', /permissions: izin,/.test(akunSrc));
cek('izin wajib didefinisikan', /const IZIN_WAJIB: \(keyof TabPermissions\)\[\] = \['tabBeranda', 'tabPresensi'\]/.test(izinSrc));
cek('izin wajib tidak bisa dimatikan', /disabled={wajib}/.test(izinSrc));
cek('admin tidak diberi editor izin', /if \(!efektif\)/.test(izinSrc) && /Akun admin tidak punya batasan izin/.test(izinSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 15. Kolom yang diminta dihapus dari Manajemen Akun');
cek('tidak ada kolom WhatsApp', !/header: 'WhatsApp'/.test(akunSrc));
cek('tidak ada field nomorWa di form', !/nomorWa/.test(akunSrc));
cek('tidak ada kolom Jabatan', !/Jabatan/.test(akunSrc));
cek('tidak ada field jabatan di form', !/setJabatan|jabatan:/.test(akunSrc));
cek('tidak ada kolom Langganan khusus karena halaman sudah terpadu', !/header: 'Langganan'/.test(akunSrc));
cek('UserAccount tidak lagi punya nomorWa', !/nomorWa\?: string/.test(baca('../src/lib/userManager.ts')));
cek('UserAccount tidak lagi punya jabatan', !/jabatan\?: string/.test(baca('../src/lib/userManager.ts')));
cek('aksi langganan tersedia pada baris akun gabungan',
  /Perpanjang masa aktif/.test(akunSrc) && /Koreksi tanggal/.test(akunSrc) && /Lihat riwayat pembayaran/.test(akunSrc));
cek('kolom NIP/IMEI menampilkan kredensial', /row\.kredensial\?\.nip/.test(akunSrc));
cek('status auto-login terlihat', /Auto-login siap/.test(akunSrc));
cek('password tidak pernah ditampilkan', !/passwordHash/.test(akunSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 16. Dropdown: ke bawah adalah bawaan');
const ddSrc = baca('../src/components/ui/Dropdown.tsx');
cek('hanya ada dua arah', /const \[arah, setArah\] = useState<'bawah' \| 'atas'>\('bawah'\)/.test(ddSrc));
// Angka 280 masih boleh disebut di komentar yang menjelaskan kenapa ia
// dibuang; yang diperiksa adalah tidak adanya lagi di kode.
const kodeDd = ddSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
cek('tidak ada angka tetap 280 di kode', !/280/.test(kodeDd));
cek('tidak ada setDropdownUp di kode', !/setDropdownUp|dropdownUp/.test(kodeDd));
/*
 * ⚠️ Aturan arah sudah diubah: **ke bawah adalah bawaan**.
 *
 * Semula `ruangBawah < tinggiDibutuhkan && ruangAtas > ruangBawah` — daftar
 * naik ke atas hanya saat bawah tidak muat LEBIH dari atas. Akibatnya dropdown
 * di baris tabel ketiga dari bawah melompat ke atas hanya karena daftarnya
 * panjang, padahal di bawahnya masih ada 300 px yang cukup. Mata harus mencari
 * ulang setiap kali arah berubah, dan isinya nama/filter/format — salah pilih
 * berarti salah aksi.
 *
 * Sekarang: `ruangBawah < TINGGI_MINIMUM`. Selama ada 120 px di bawah, daftar
 * tetap ke bawah dan digulir di dalam panelnya.
 */
cek('arah ditentukan oleh ruang minimum, bukan perbandingan tinggi',
  /const keAtas = ruangBawah < TINGGI_MINIMUM && ruangAtas > ruangBawah/.test(ddSrc),
  'daftar harus tetap ke bawah selama masih ada ruang yang berguna');
cek('ambang ruang minimum ada dan bernilai wajar',
  /const TINGGI_MINIMUM = 1\d\d/.test(ddSrc),
  'ambang terlalu kecil membuat daftar sempit, terlalu besar membuatnya sering naik');
cek('aturan lama sudah tidak dipakai',
  !/ruangBawah < tinggiDibutuhkan/.test(kodeDd),
  'ini yang membuat menu melompat ke atas terlalu sering');
// `kodeDd` = sumber tanpa komentar. `scrollHeight` masih boleh disebut di
// komentar yang menjelaskan kenapa ia dibuang; yang diperiksa adalah
// ketiadaannya di kode yang dijalankan.
cek('tinggi daftar tidak lagi jadi penentu arah', !/scrollHeight/.test(kodeDd),
  'scrollHeight hanya memaksa daftar naik saat panjang');
cek('tinggi maksimum tetap dihitung dari ruang tersedia',
  /Math\.max\(TINGGI_MINIMUM, Math\.min\(TINGGI_DAFTAR_MAKS, ruang\)\)/.test(ddSrc),
  'tanpa ini daftar panjang keluar layar');
cek('mengukur visualViewport', /window\.visualViewport/.test(ddSrc), 'innerHeight tidak menyusut saat keyboard muncul');
cek('dihitung ulang saat resize', /addEventListener\('resize'/.test(ddSrc));
cek('dihitung ulang saat scroll', /addEventListener\('scroll', onScroll, true\)/.test(ddSrc));
cek('arah terekspos untuk diuji', /data-arah={arah}/.test(ddSrc));
cek('tinggi daftar dibatasi ruang', /style=\{\{ maxHeight: tinggiMaks \}\}/.test(ddSrc));
// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 17. Tidak ada kontrol native yang lolos ke halaman');
/**
 * Aturan: setiap kontrol form harus lewat komponen sendiri.
 *
 * Yang diperiksa bukan "apakah ada `<input>`" — `<input>` di dalam
 * `PasswordField`/`Checkbox` memang benar, itu bagian dari semantik dan
 * aksesibilitasnya. Yang diperiksa adalah apakah **halaman** merender
 * kontrol native secara langsung.
 *
 * Daftar per kontrol, dan alasan masing-masing:
 *
 * | native              | diganti dengan            | alasan
 * |---------------------|---------------------------|---------
 * | `type="date"`       | `DatePicker`              | format & tombol beda per OS; nilai dikembalikan dalam lokalitas perangkat, sedangkan semua batas langganan dihitung WIB
 * | `type="number"`     | `NumberField`             | `1.0e3` = 1; format ikut locale; spinner tidak ada di layar sentuh
 * | `type="checkbox"`   | `Checkbox`                | `accent-*` ikut warna OS
 * | `type="password"`   | `PasswordField`           | tombol mata ditulis ulang di 5 tempat dengan 5 gaya berbeda
 * | `<select>`          | `Dropdown`                | opsi panjang terpotong, panah OS, tidak bisa difilter
 * | `<textarea>`        | `Textarea`                | gaya beda per halaman
 */
/** Hanya baris kode: komentar menjelaskan Native yang justru boleh disebut. */
const kodeSaja = (sumber: string): string => {
  const tanpaKomentar = sumber.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  return tanpaKomentar;
};

const berkasHalaman = [
  '../src/pages/ManajemenAkun.tsx',
  '../src/pages/Langganan.tsx',
  '../src/pages/Presensi.tsx',
  '../src/pages/Perizinan.tsx',
  '../src/pages/Laporan.tsx',
  '../src/pages/Beranda.tsx',
  '../src/components/LoginScreen.tsx',
  '../src/components/SettingAkunModal.tsx',
  '../src/components/ProfilServerModal.tsx',
  '../src/components/BayarLanggananModal.tsx',
  '../src/components/GerbangLangganan.tsx',
];

for (const p of berkasHalaman) {
  const nama = p.split('/').pop();
  const k = kodeSaja(baca(p));
  const native = [];
  if (/type="date"/.test(k)) native.push('type="date"');
  if (/type="number"/.test(k)) native.push('type="number"');
  if (/type="checkbox"/.test(k)) native.push('type="checkbox"');
  if (/type="password"/.test(k)) native.push('type="password"');
  if (/<select[\s>]/.test(k)) native.push('<select>');
  if (/<textarea[\s>]/.test(k)) native.push('<textarea>');
  cek(`${nama} bebas kontrol native`, native.length === 0, native.join(', '));
}

/*
 * Komponennya harus benar-benar ada dan dipakai — kalau hanya ada
 * saja, aturan di atas bisa dipenuhi dengan mengimpor tapi tidak
 * merender.
 */
const surf = baca('../src/components/ui/Surface.tsx');
cek('Ada NumberField', /export function NumberField/.test(surf));
cek('Ada Checkbox', /export function Checkbox/.test(surf));
cek('Ada PasswordField', /export function PasswordField/.test(surf));
cek('Ada Textarea', /export function Textarea/.test(surf));
cek('DatePicker diekspor', /export default function DatePicker/.test(baca('../src/components/ui/DatePicker.tsx')));

const langKode = kodeSaja(baca('../src/pages/Langganan.tsx'));
cek('Setel Tanggal pakai DatePicker', /<DatePicker value=\{tanggal\} onChange=\{setTanggal\}/.test(langKode));
cek('Tombol +30 Hari pakai helper WIB', /getTodayWIBWithDaysOffset\(30\)/.test(langKode));
cek('Tombol Kemarin pakai helper WIB', /getTodayWIBWithDaysOffset\(-1\)/.test(langKode));
cek('tidak ada new Date()+toISOString di tombol tanggal', !/d\.toISOString\(\)\.slice\(0, 10\)/.test(langKode));
cek('Harga paket pakai NumberField', /<NumberField[\s\S]{0,120}min=\{1\}[\s\S]{0,120}step=\{5000\}/.test(langKode));
cek('Durasi paket pakai NumberField', /<NumberField[\s\S]{0,120}max=\{120\}/.test(langKode));
cek('Checkbox dipakai di pengaturan langganan', /<Checkbox/.test(langKode));
cek(
  'Checkbox dipakai di Manajemen Akun',
  /<Checkbox[\s\S]{0,200}?tone="rose"/.test(kodeSaja(baca('../src/pages/ManajemenAkun.tsx')))
);
cek('Checkbox dipakai di Presensi', /<Checkbox/.test(kodeSaja(baca('../src/pages/Presensi.tsx'))));

/*
 * PasswordField: tombol matanya harus punya `aria-pressed`, karena
 * tidak ada teks yang berubah saat ditekan — tanpa atribut ini,
 * pembaca layar tidak memberi tahu keadaan yang berbeda.
 */
const pfBlok = surf.split('export function PasswordField')[1]?.split('function StepButton')[0] ?? '';
cek('PasswordField punya aria-pressed', /aria-pressed=\{lihat\}/.test(pfBlok));
cek('PasswordField punya aria-label dinamis', /aria-label=\{lihat \?/.test(pfBlok));
cek('PasswordField menyisakan ruang untuk tombol', /pr-11/.test(pfBlok));
cek('tombol mata ter-center vertikal', /top-1\/2 -translate-y-1\/2/.test(pfBlok));

/*
 * NumberField: filter digit harus di satu tempat, dan min/max ditegakkan
 * bukan hanya lewat atribut `min` (yang di HP tidak ada spinner untuk
 * membatasi).
 */
const nfBlok = surf.split('export function NumberField')[1]?.split('function StepButton')[0] ?? '';
cek('NumberField menyaring non-digit', /replace\(\/\\D\/g, ''\)/.test(nfBlok));
cek('NumberField menegakkan min', /if \(min !== undefined\) hasil = Math\.max\(min, hasil\)/.test(nfBlok));
cek('NumberField menegakkan max', /if \(max !== undefined\) hasil = Math\.min\(max, hasil\)/.test(nfBlok));
cek(
  'NumberField punya tombol naik/turun',
  /StepButton/.test(nfBlok) && /label=\{`Tambah \$\{step\}`\}/.test(surf) && /label=\{`Kurangi \$\{step\}`\}/.test(surf)
);
cek('NumberField keyboard_arrow_up/down', /event\.key === 'ArrowUp'/.test(nfBlok) && /event\.key === 'ArrowDown'/.test(nfBlok));
cek('NumberField autofocus select (ganti angka mudah)', /onFocus=\{event => event\.currentTarget\.select\(\)\}/.test(nfBlok));

/*
 * Checkbox: `accent-*` adalah penyebab utamanya, jadi tidak boleh muncul
 * di komponen checkbox kita.
 */
const cbBlok = surf.split('export function Checkbox')[1]?.split('function PasswordField')[0] ?? '';
cek('Checkbox tidak memakai accent-*', !/accent-/.test(cbBlok));
cek('Checkbox punya sr-only input untuk semantik', /peer sr-only/.test(cbBlok));
cek('Checkbox punya focus ring sendiri', /peer-focus-visible:ring-2/.test(cbBlok));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 18. Tombol "Menu Utama" dihapus');
/**
 * Sidebar ada di setiap halaman, dan di layar sempit ada di hamburger.
 * Tombol kedua yang melakukan hal yang sama bukan pintasan — ia menambah satu
 * keputusan di tengah pekerjaan, dan di HP ia occupy ruang yang lebih baik
 * dipakai tabel.
 */
cek('tidak ada teks "Menu Utama" di halaman', !/Menu Utama/.test(akunSrc));
cek('tidak lagi memanggil setActivePage ke Beranda', !/setActivePage\('tabBeranda'\)/.test(akunSrc));
cek('tidak lagi mengimpor ChevronDown di halaman', !/ChevronDown/.test(akunSrc));
cek('judul duplikat halaman tidak dirender', !/<PageHeader/.test(akunSrc) && !/Kelola akun, langganan, dan pembayaran/.test(akunSrc));
cek('label "Menu Utama" untuk grup di App.tsx tetap ada', /utama: 'Menu Utama'/.test(appSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 19. Bawaan untuk semua hal yang bisa dipilih');
/**
 * Dua tempat di dialog akun punya pilihan yang bisa tampil kosong kalau
 * tidak diberi bawaan: editor izin, dan penyaring/urutan tabel.
 *
 * Izin adalah yang paling penting. Akun yang dibuat tanpa nilai bawaan akan
 * punya dokumen izin kosong, dan `normalizeUserPermissions` yang menambalnya
 * hanya berjalan di sisi peramban — dokumennya tetap kosong. Form dialog
 * harus selalu bermula dari default peran, bukan dari "apa pun yang kebetulan
 * tersimpan".
 */
cek('izin akun baru bermula dari bawaan', /useState<TabPermissions>\(\s*akun\?\.permissions \?\? DEFAULT_USER_PERMISSIONS/.test(akunSrc));
cek('bawaan admin ikut diimpor', /DEFAULT_ADMIN_PERMISSIONS,/.test(akunSrc));
cek('ganti peran menyetel ulang izin ke bawaan peran itu', /const gantiPeran = \(berikut: UserRole\)/.test(akunSrc));
cek('peran admin -> DEFAULT_ADMIN_PERMISSIONS', /berikut === 'admin'\s*\?\s*\{ \.\.\.DEFAULT_ADMIN_PERMISSIONS \}/.test(akunSrc));
cek('peran user -> DEFAULT_USER_PERMISSIONS', /\{ \.\.\.DEFAULT_USER_PERMISSIONS \}/.test(akunSrc));
cek('dropdown peran memanggil gantiPeran', /onChange=\{v => gantiPeran\(v as UserRole\)\}/.test(akunSrc));
cek('penyaring peran punya tipe dengan default jelas', /type FilterPeran = 'semua' \| UserRole;/.test(akunSrc));
cek('bawaan penyaring = Semua', /useState<FilterPeran>\('semua'\)/.test(akunSrc));
cek('bawaan urutan = Nama (bukan username)', /useState<SortKey>\('nama'\)/.test(akunSrc));
cek('dropdown urutan menawarkan Nama lebih dulu', /\{ value: 'nama', label: 'Nama' \},\s*\n\s*\{ value: 'username'/.test(akunSrc));
cek('urutan nama pakai locale id', /localeCompare\(\s*b\.akun\.namaLengkap \|\| b\.akun\.username,\s*\n?\s*'id'/.test(akunSrc));
cek('ada deteksi filter aktif', /const adaFilter = cari\.trim\(\) !== '' \|\| filterPeran !== 'semua' \|\| urut !== 'nama';/.test(akunSrc));
cek('ada tombol reset filter', /Reset filter/.test(akunSrc));
cek('reset mengembalikan semua ke bawaan', /setFilterPeran\('semua'\);\s*\n\s*setUrut\('nama'\);/.test(akunSrc));
cek('jumlah akun tidak diulang sebagai ringkasan di luar tabel',
  !/Menampilkan seluruh \{baris\.length\} akun/.test(akunSrc) &&
  !/\{tersaring\.length\} dari \{baris\.length\} akun/.test(akunSrc));

// Izin: penanda bawaan + tombol kembali ke bawaan.
cek('editor izin menandai masih-bawaan atau berubah', /samaDefault \? 'Semua izin masih bawaan' : 'Beberapa izin sudah diubah dari bawaan'/.test(izinSrc));
cek('ada tombol kembalikan ke bawaan', /Kembalikan semua izin ke bawaan/.test(izinSrc));
cek('tombol reset nonaktif saat sudah sama', /disabled=\{samaDefault\}/.test(izinSrc));
cek('perbandingan bawaan mencakup semua field', /Object\.keys\(efektif\)/.test(izinSrc));
// ═════════════════════════════════════════════════════════════════════
/** Semua berkas .tsx/.ts di `src/`. */
function walkSrc() {
  const base = new URL('../src/', import.meta.url);
  const out = [];
  (function jalan(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) jalan(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p.pathname);
    }
  })(base);
  return out;
}

console.log('\n=== 20. Alert: satu ikon per kotak, sesuai nada');
// ═════════════════════════════════════════════════════════════════════
/**
 * Bug yang nyata: `Alert` selalu menggambar `AlertCircle` apa pun nadanya,
 * dan pemanggil yang butuh ikon sendiri menambahkan ikon kedua di dalam
 * `children`. Hasilnya dua tanda peringatan untuk satu kalimat — termasuk
 * di baris "Waktu sekarang 08:56 WIB ... berada di dalam rentang jam
 * kerja", yang padahal kabar biasa.
 *
 * Yang dijaga di sini:
 *   1. `Alert` memilih ikon dari `tone`.
 *   2. Tidak ada pemanggil yang menaruh ikon di dalam `children` lagi.
 *   3. Presensi tidak menampilkan pesan waktu/jadwal yang mengganggu
 *      di atas tombol absen.
 */
const surfaceSrc = baca('../src/components/ui/Surface.tsx');
cek('Alert punya peta ikon per nada', /const bawaan = \{[\s\S]*?amber:[\s\S]*?rose:[\s\S]*?blue:[\s\S]*?emerald:/.test(surfaceSrc));
cek('amber memakai AlertCircle (perhatian)', /amber: <AlertCircle/.test(surfaceSrc));
cek('rose memakai CircleAlert (gagal)', /rose: <CircleAlert/.test(surfaceSrc));
cek('blue memakai Info (netral)', /blue: <Info/.test(surfaceSrc));
cek('emerald memakai CircleCheck (berhasil)', /emerald: <CircleCheck/.test(surfaceSrc));
cek('Alert tidak lagi menggambar AlertCircle secara hardcoded',
  !/<AlertCircle className="w-4 h-4 shrink-0 mt-0\.5" \/>\s*<span className="leading-relaxed/.test(surfaceSrc));
cek('Alert bisa dimatikan lewat icon={false}', /icon\?: ReactNode \| false/.test(surfaceSrc));

// 2. Tidak ada ikon di dalam children Alert.
const semuaBerkas = walkSrc();
const dobel = [];
for (const f of semuaBerkas) {
  const isi = baca(f);
  for (const m of isi.matchAll(/<Alert\b[\s\S]*?<\/Alert>/g)) {
    const baris = m[0].split('\n');
    // Baris pertama memuat tag pembuka <Alert> beserta atributnya — ikon
    // bawaan Alert tidak ada di sana, jadi mulai dari baris kedua.
    for (let i = 1; i < baris.length; i++) {
      if (/<[A-Z][A-Za-z0-9]*\s+className="[^"]*\b(?:w-3\.5|w-3|w-5)\b[^"]*"/.test(baris[i])) {
        dobel.push(`${f.replace(new URL('../', import.meta.url).pathname, '')} — ${baris[i].trim().slice(0, 60)}`);
      }
    }
  }
}
cek('tidak ada ikon di dalam children Alert', dobel.length === 0, dobel.join(' | '));

// 3. Pesan jam kerja dihilangkan dari formulir agar tetap ringkas.
const presensiSrc = baca('../src/pages/Presensi.tsx');
cek('pesan waktu dan rentang jam kerja tidak ditampilkan',
  !/Waktu sekarang|dalamRentangJam|rentangJam/.test(presensiSrc));
cek('halaman Presensi tidak pernah putting ikon Info/AlertTriangle sendiri di Alert',
  !/<Alert\b[\s\S]{0,400}?<Info className="w-3\.5/.test(presensiSrc) &&
  !/<Alert\b[\s\S]{0,400}?<AlertTriangle className="w-3\.5/.test(presensiSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 21. Kredensial server diatur dari dialog akun');
/*
 * Permintaan eksplisit: dari menu Manajemen Akun, admin harus bisa mengisi
 * NIP, IMEI, dan password login server untuk **semua** akun, supaya begitu
 * diberi ke orangnya langsung bisa auto-login.
 *
 * Server sudah mengizinkan ini sejak awal — `cekPemantik()` di `panelServer.ts`
 * menerima admin untuk username mana pun, dan `saveServerCredential()` sudah
 * ada di API klien. Yang tidak ada hanya antarmukanya: ketiga isian itu hanya
 * bisa_di ketogenic lewat `KredensialServerModal` yang cuma muncul di Beranda
 * miliknya sendiri.
 */
const umSrc = baca('../src/lib/userManager.ts');
const appSrcAda = baca('../src/App.tsx');
cek('dialog akun punya bagian Login Server Pusat', /Login Server Pusat/.test(akunSrc));
cek('NIP bisa diisi dari dialog akun', /<Field label="NIP" hint="Email login server\."/i.test(akunSrc));
cek('IMEI bisa diisi dari dialog akun', /<Field label="IMEI \/ androidId"/.test(akunSrc));
cek('password server bisa diisi dari dialog akun', /<Field[\s\S]{0,80}label="Password Server"/.test(akunSrc));
cek('penyimpanan memakai API kredensial yang sudah ada',
  /saveServerCredential\(target, nips, sandi, imei\.trim\(\)\)/.test(akunSrc),
  'server sudah mengizinkan admin; jangan tulis ulang jalur sendiri');
cek('kredensial hanya dikirim kalau ada isian',
  /if \(!sandi && !nips && !imei\.trim\(\)\) return;/.test(akunSrc),
  'request kosong akan menimpa NIP yang sudah tersimpan dengan string kosong');
cek('NIP kosong ditolak, bukan disimpan diam-diam',
  /if \(!nips\) \{[\s\S]{0,140}throw new Error/.test(akunSrc),
  'dokumen tanpa NIP tidak akan pernah bisa dipakai auto-login');
cek('password tidak pernah ditampilkan kembali',
  /tersimpan\?\.terbaca \? '•••••••• \(tidak diubah\)'/.test(akunSrc),
  'password tidak bisa dibaca dari server; UI harus jujur soal itu');
cek('NIP tidak punya dua isian yang bisa berbeda',
  !/const \[nip, setNip\]/.test(akunSrc),
  'dua isian NIP pasti akan berbeda satu saat');
cek('NIP yang sama dikirim ke dokumen akun dan dokumen kredensial',
  (akunSrc.match(/nip: nipServer\.trim\(\)/g) || []).length === 2,
  'keduanya harus satu sumber yang sama');
cek('hapus kredensial tersedia kalau sudah tersimpan',
  /hapusServerCredential\(akun!\.username\)/.test(akunSrc));

/*
 * ⚠️ Jebakan yang membuat "isi kredensial dari Manajemen Akun" terlihat
 * berhasil padahal tidak ada yang benar-benar tersimpan.
 *
 * **Username yang dituju.** `createUserAccount()` menormalisasi username
 * server-side (`trim().toLowerCase()`). Kalau nama dokumen kredensial tidak
 * dinormalisasi sama, "Budi" dan "budi" menjadi dua dokumen berbeda untuk satu
 * akun — dan auto-login tidak pernah menemukan kredensialnya. Dicegah di
 * server oleh `dokKredensialTarget()`.
 *
 * **Akun yang dituju.** Kalau `username` yang dikirim adalah username *dialog*
 * (admin) alih-alih akun yang sedang diedit, kredensial user masuk ke dokumen
 * admin dan tidak pernah ke miliknya. Dicegah server dengan memakai nama
 * target; yang diuji di sini adalah pemanggilnya konsisten.
 */
cek('dialog edit memindahkan kredensial ke username baru',
  /simpanKredensialServerJikaDiisi\(usernameTujuan\)/.test(akunSrc),
  'kredensial harus mengikuti akun saat username diganti');
cek('username pada dialog edit dapat diubah',
  /<Input\s+value=\{username\}\s+onChange=\{e => setUsername\(e\.target\.value\.replace\(\/\\s\/g, ''\)\)\}\s+placeholder="budi\.santoso"/.test(akunSrc),
  'input username harus aktif pada mode edit');
cek('dialog edit mengirim usernameBaru ke server',
  /usernameTujuan !== akun\.username \? \{ usernameBaru: usernameTujuan \} : \{\}/.test(akunSrc),
  'server harus menerima nama baru hanya saat ada perubahan');
cek('dialog akun baru mengirim username yang baru dibuat',
  /simpanKredensialServerJikaDiisi\(username\.trim\(\)\)/.test(akunSrc),
  'akun baru tanpa kredensial tidak akan pernah bisa auto-login');
cek('nama dokumen kredensial dinormalisasi di server',
  /function dokKredensialTarget\(username: string\): string \{\s*\n?\s*return dokKredensial\(String\(username \?\? ''\)\.trim\(\)\.toLowerCase\(\)\)/.test(
    baca('../src/lib/panelServer.ts')
  ),
  'tanpa toLowerCase, "Budi" dan "budi" jadi dua dokumen untuk satu akun');
cek('NIP kredensial ikut dikirim ke dokumen akun',
  (akunSrc.match(/nip: nipServer\.trim\(\)/g) || []).length === 2,
  'NIP harus sama di dokumen akun dan dokumen kredensial, kalau tidak pencarian NIP gagal');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 22. Izin keluar dari server pusat');
/*
 * Permintaan eksplisit: kalau izinnya tidak ada, akun **tidak boleh** logout
 * dari akun server yang sudah ditetapkan, dan di kartu akunnya juga tidak ada
 * logoutnya.
 */
cek('izin aksiSesiServer ada di TabPermissions', /aksiSesiServer: boolean;/.test(umSrc));
cek('izin punya label yang jelas', /aksiSesiServer: 'Keluar dari Server Pusat'/.test(umSrc));
cek('izin masuk kelompok Aksi', /'aksiKelolaUser', 'aksiSesiServer'/.test(umSrc));
cek('bawaan admin mengizinkan', /tabManajemenAkun: true,\s*\n\s*aksiSesiServer: true,/.test(umSrc));
cek('bawaan user mengizinkan (perilaku tidak berubah diam-diam)',
  /tabManajemenAkun: false,\s*\n\s*aksiSesiServer: true,/.test(umSrc),
  'default false akan memutus jalan keluar semua user yang ada sekarang');
cek('item logout di dropdown dibungkus cek izin',
  /\.\.\.\(bolehKeluarServer[\s\S]{0,320}id: 'logout'/.test(appSrc),
  'tanpa ini tombol tetap muncul untuk akun yang tidak berizin');
cek('handleServerLogout juga memeriksa izin',
  /if \(!bolehKeluarServer\)/.test(appSrc),
  'dropdown adalah tampilan, bukan penjaga — pemanggil lain bisa melewati');
cek('admin tidak pernah dibatasi izin ini',
  /currentUser\?\.role === 'admin' \|\|/.test(appSrc),
  'admin yang mengatur izinnya sendiri tidak boleh mengunci dirinya');
cek('izin memakai default true saat verifikasi token berjalan',
  /\.aksiSesiServer !== false/.test(appSrcAda),
  'default false bikin tombol berkedip muncul lalu hilang');
cek('akun lama tanpa field ini tetap bisa keluar',
  /for \(const key of Object\.keys\(base\)/.test(umSrc),
  'field baru otomatis dapat nilai bawaan untuk dokumen lama');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 23. Baris penyaring Manajemen Akun seragam');
/*
 * Permintaan: "ukuran tombol dan kolom samakan, rapi, tidak besar kecil beda
 * ukuran" — lalu dikoreksi: "tombol muat dan akun baru jelek, gak lurus dan
 * kebesaran".
 *
 * Dua putaran ini menarik ke arah yang berlawanan, dan keduanya salah kalau
 * dipasang terpisah. Yang benar: **tinggi** tombol harus sama dengan input,
 * tapi **ketebalan visual**-nya harus tetap ringan.
 *
 * ### Putaran 1 — keliru
 *
 * `size="md"` + `w-[108px]`. Dua masalah sekaligus:
 *
 * - **Teks meluber.** `size="md"` = `px-4` (16 px) + ikon 16 px + `gap-2`
 *   (8 px) + "Akun Baru" di `text-sm` (±70 px) = **±128 px** isi, di dalam
 *   kotak 108 px. Teks keluar dari background tombol — persis gejala "gak
 *   lurus" yang dilaporkan.
 * - **Kebesaran.** `size="md"` itu ukuran tombol formulir utama, dan varian
 *   `primary`-nya membawa `shadow-[0_8px_20px_...]` yang membuatnya tampak
 *   melayang, lebih besar dari tetangganya.
 *
 * ### Putaran 2 — yang dipakai sekarang
 *
 * `size="sm"` + `h-[42px]`. Tinggi tetap 42 px (sama dengan input), padding
 * dan teks ringan. Varian `ghost` + `secondary`: keduanya berborder tanpa
 * bayangan, jadi rata.
 *
 * ⚠️ Yang ditegakkan di sini adalah **tinggi**, bukan ukuran varian. Menurunkan
 * ke 30 px bawaan `size="sm"` akan mengembalikan keluhan pertama
 * ("besar kecil beda ukuran").
 */
cek('penyaring memakai satu grid, bukan tiga blok',
  /sm:grid-cols-\[minmax\(0,1fr\)_\d+(\.\d+)?rem_\d+(\.\d+)?rem_auto\]/.test(akunSrc),
  'blok terpisah tidak bisa disejajarkan andal');
cek('semua kendali disejajarkan di dasar', /sm:items-end/.test(akunSrc));

// Diambil per blok <ActionButton>...</ActionButton>: urutan atribut tidak
// penting, dan mematch posisi `size=` hanya menguji urutan yang kebetulan dipakai.
const blokTombol = [...akunSrc.matchAll(/<ActionButton[\s\S]*?<\/ActionButton>/g)].map(m => m[0]);
const tombolMuat = blokTombol.find(b => /onClick=\{\(\) => void muat\((?:true)?\)\}/.test(b));
const tombolBaru = blokTombol.find(b => /setDialog\(\{ akun: null \}\)/.test(b));

/*
 * Tinggi tombol: harus **42 px**, sama persis dengan `Input` dan pemicu
 * `Dropdown` (`py-2.5 text-sm` + border = 20 + 20 + 2).
 *
 * Diuji lewat nilai class-nya, bukan lewat `size` varian — karena
 * `size="sm"` sendiri hanya 30 px.
 */
const TINGGI_INPUT_PX = 42;
for (const [nama, blok] of [['Muat', tombolMuat], ['Akun Baru', tombolBaru]]) {
  cek(`${nama} ada sebagai blok ActionButton`, Boolean(blok));
  const h = blok && (blok.match(/h-\[(\d+)px\]/) || [])[1];
  cek(`${nama} tingginya ${TINGGI_INPUT_PX} px, sama dengan input`, Number(h) === TINGGI_INPUT_PX,
    `ditemukan h-[${h}px]; 30 px akan terlihat lebih kecil dari kolom sebelahnya`);
  cek(`${nama} memakai ukuran ringan (sm), bukan md`, /size="sm"/.test(blok || ''),
    'size="md" = px-4 + text-sm: isi tombol jadi ±128 px dan terlihat kebesaran');
  cek(`${nama} tidak punya lebar tetap`,
    !/w-\[\d+px\]/.test(blok || ''),
    'lebar tetap + isi yang lebih lebar = teks bocor keluar tombol');
  cek(`${nama} mengisi selnya (block)`, /\bblock\b/.test(blok || ''),
    'tanpa w-full, grid-cols-2 tidak menghasilkan lebar yang sama');
  cek(`${nama} ikonnya 14 px, bukan 16 px`,
    /className="w-3\.5 h-3\.5"/.test(blok || ''),
    'ikon 16 px di size="sm" menambah lebar dan bikin tidak seimbang');
}

/*
 * Tanpa bayangan. `VARIANTS.primary` membawa `shadow-[0_8px_20px_...]`, dan
 * bayangan sebesar itu membuat tombol terlihat melayang — lebih besar dan
 * lebih rendah dari tetangganya, walau kotakanya sama tinggi.
 */
const tanpaBayang = (blok: string | undefined): boolean => !/shadow-\[/.test(blok ?? '');
cek('tombol Muat tidak punya bayangan yang membuatnya melayang', tanpaBayang(tombolMuat));
cek('tombol Akun Baru tidak punya bayangan yang membuatnya melayang', tanpaBayang(tombolBaru));
cek('kedua tombol berbobot sama (tidak ada varian primary bertingkat)',
  (tombolMuat?.match(/variant="(\w+)"/) || [])[1] === 'ghost' &&
    (tombolBaru?.match(/variant="(\w+)"/) || [])[1] === 'secondary',
  'varian berbeda bikin satu tombol terlihat lebih penting dari yang lain');
cek('dua tombol memakai grid-cols-2 supaya lebarnya sama',
  /<div className="grid grid-cols-2 gap-2">\s*<ActionButton[\s\S]{0,400}void muat\((?:true)?\)[\s\S]{0,700}Akun Baru/.test(akunSrc),
  'dua blok terpisah tidak dijamin lebarnya sama');

cek('lebar dropdown ditetapkan, bukan mengikuti isi',
  (akunSrc.match(/className="w-full"/g) || []).length >= 2,
  'opsi "Semua" dan "Masa Aktif" punya panjang berbeda');
cek('lebar kolom dropdown tidak melebihi isinya',
  !/sm:grid-cols-\[minmax\(0,1fr\)_(9\.5rem|10\.5rem|12rem)/.test(akunSrc),
  '8rem/9rem cukup untuk "Semua" dan "Masa Aktif"; sisa lebar untuk pencarian');
cek('jumlah seluruh akun tidak ditampilkan sebagai ringkasan',
  !/Menampilkan seluruh \{baris\.length\} akun/.test(akunSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 24. Kegagalan status kredensial tidak lagi senyap');
/*
 * Gejala yang dilaporkan: NIP, password, dan IMEI sudah diisi, tapi kolom
 * NIP·IMEI tetap "IMEI belum diisi / Kredensial belum diatur", dan auto-login
 * tidak pernah berhasil — tanpa satu pun pesan.
 *
 * Dua kegagalan senyap yang menyebabkannya:
 *
 * 1. `semuaRingkasanKredensial().catch(() => new Map())`. Map kosong membuat
 *    setiap baris terlihat persis seperti akun yang memang belum punya
 *    kredensial. Penyebab sebenarnya — server versi lama yang tidak mengenal
 *    aksi `kredensial:ringkas-semua` — hilang tanpa jejak.
 * 2. `serverLoginError` hanya dirender di Beranda. Di halaman lain, kegagalan
 *    auto-login tidak terlihat sama sekali: aplikasi terbuka normal, semua
 *    menu ada, tapi tidak ada data.
 */
cek('kegagalan baca kredensial tidak lagi jadi map kosong',
  !/semuaRingkasanKredensial\(\)\s*\.catch\(\(\) => new Map/.test(akunSrc),
  'map kosong = setiap baris menampilkan "Kredensial belum diatur" tanpa penjelasan');
cek('galat disimpan untuk ditampilkan',
  /setGalatKredensial\(kred\.galat\)/.test(akunSrc));
cek('ada banner yang menyebut status TIDAK DIETAHUI, bukan "belum diatur"',
  /Status kredensial server tidak terbaca/.test(akunSrc) &&
    /bukan<\/strong> karena kredensialnya belum diatur/.test(akunSrc),
  'menyamakan "tidak diketahui" dengan "belum diatur" membuat admin mengisi ulang tanpa henti');
cek('kolom NIP·IMEI menampilkan "Status tidak diketahui" saat baca gagal',
  /if \(galatKredensial\)[\s\S]{0,400}Status tidak diketahui/.test(akunSrc),
  'menampilkan "IMEI belum diisi" saat statusnya tidak diketahui adalah berbohong');
cek('kolom NIP·IMEI tidak berbohong saat baca gagal',
  !/if \(galatKredensial\)[\s\S]{0,900}IMEI belum diisi/.test(akunSrc),
  'yaitu yang membuat kolom kosong disalahartikan sebagai "belum diisi"');
cek('banner-contract ada di App.tsx (server versi lama terdeteksi)',
  /<BannerKontrakServer\s*\/>/.test(appSrcAda) && /import BannerKontrakServer/.test(appSrcAda));
cek('banner server pusat ada di App.tsx (auto-login gagal terlihat di semua halaman)',
  /<BannerServerPusat\s*\/>/.test(appSrcAda) && /import BannerServerPusat/.test(appSrcAda));
cek('error auto-login tidak lagi hanya milik Beranda',
  /diteruskan ke `BannerServerPusat`/.test(appSrcAda),
  'hanya di Beranda = pengguna di Presensi/Laporan tidak pernah tahu server tidak tersambung');

const kontrakSrc = baca('../src/lib/kontrakServer.ts');
const panelSrc = baca('../src/serverless/_panel.ts');
cek('kontrak server punya nomor versi', /export const KONTRAK_VERSI = \d+/.test(kontrakSrc));
cek('versi saat ini 5 — kredensial Web akun sendiri',
  /export const KONTRAK_VERSI = 5;/.test(kontrakSrc));
cek('server mengirim versi di setiap respons',
  /res\.json = \(badan: unknown\) =>/.test(panelSrc) && /kontrakVersi: KONTRAK_VERSI/.test(panelSrc),
  'dibungkus res.json di awal = tidak ada jalur keluar yang melewatinya');
cek('versi dikirim juga di jalur keluar awal (CORS, method, konfigurasi)',
  /res\.json = \(badan/.test(panelSrc) &&
    panelSrc.indexOf('res.json = (badan') < panelSrc.search(/terapkanCors\(res,/),
  'versi yang hanya ada di respons sukses = 403/405/503 membuat peramban salah menilai');
cek('aksi wajib memuat yang pernah hilang',
  /'kredensial:ringkas-semua'/.test(kontrakSrc) && /'pusat:login'/.test(kontrakSrc),
  'aksi ini tidak ada di server versi lama, dan hasilnya sempat ditelan');
cek('banner mengimpor nomor versi dari satu sumber, bukan menyalinnya',
  /from '\.\.\/lib\/kontrakServer'/.test(baca('../src/components/BannerKontrakServer.tsx')) &&
    !/KONTRAK_VERSI = \d/.test(baca('../src/components/BannerKontrakServer.tsx')),
  'menyalin nomor versi ke komponen = ia akan diam-diam usang setelah versi dinaikkan');

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
