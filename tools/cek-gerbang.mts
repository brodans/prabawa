/**
 * Uji gerbang langganan.
 *
 * Mekanisme "wajib bayar" yang paling penting diuji secara **statis**, bukan
 * hanya lewat logika murni. Alasannya: kelemahannya bukan di aritmetika
 * status, tapi di *tempat gerbang dipasang*. Satu tag JSX yang salah tempat
 * membuat seluruh aturan ini hanya hiasan — semua menu tetap terbuka, hanya
 * tampilannya yang berbeda.
 *
 * Yang diverifikasi:
 *
 * 1. `MainApp` dirender **di dalam** gerbang, bukan sebaliknya. Kalau
 *    dibalik, sidebar dan topbar tetap bisa dipakai saat langganan habis.
 * 2. Menu Langganan hanya terbuka untuk `role === 'admin'`.
 * 3. `MainApp` hanya terbuka untuk admin atau akun gratis.
 * 4. Gerbang memanggil `resetAutoLogin()` + `clearServerSessionCache()`
 *    saat terkunci — tanpa itu, auto-login tetap jalan dan pengguna masih
 *    bisa absen tanpa membayar.
 * 5. Gerbang dilewati kalau Firestore belum siap (kalau tidak, seluruh
 *    aplikasi terkunci permanen karena pembayaran juga butuh Firestore).
 * 6. Dialog pembayaran terbuka otomatis dan tetap ada tombolnya.
 * 7. Admin **tidak** punya tombol mencatat pembayaran.
 */
import { existsSync, readFileSync } from 'node:fs';

const baca = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/** Buang komentar supaya yang dicari benar-benar kode yang dijalankan. */
const kode = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

const appSrc = baca('../src/App.tsx');
const gateSrc = baca('../src/components/GerbangLangganan.tsx');
const appKode = kode(appSrc);
const gateKode = kode(gateSrc);
const ctxSrc = kode(baca('../src/context/AppContext.tsx'));
const userSrc = kode(baca('../src/lib/userManager.ts'));
const izinSrc = kode(baca('../src/pages/Perizinan.tsx'));
/*
 * Dua modul, dua sumber kebenaran.
 *
 * Dua modul, dua sumber kebenaran.
 *
 * `langganan.ts` memuat bagian murni (paket, status, durasi, format), dan
 * `langgananFirestore.ts` memuat pembacaan serta penulisan. Bagian 8 memeriksa
 * aturan idempotensi di `catatPembayaran` dan `perpanjangManual` — keduanya
 * berada di modul Firestore, jadi itulah yang diperiksa di sini.
 *
 * Menunjuk modul murni membuat pemeriksaan ini lulus tanpa artinya: polanya
 * memang tidak ada di sana, dan "FAIL" akan terbaca sebagai jaminan yang
 * hilang, bukan sebagai uji yang diarahkan ke berkas yang salah.
 */
const langgananSrc = kode(baca('../src/lib/langganan.ts'));
const adminSrc = kode(baca('../src/pages/Langganan.tsx'));
const akunSrc = kode(baca('../src/pages/ManajemenAkun.tsx'));
const modalSrc = baca('../src/components/BayarLanggananModal.tsx');
const modalKode = kode(modalSrc);

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Gerbang membungkus seluruh MainApp');
cek('GerbangLangganan diimpor', appSrc.includes("import GerbangLangganan from './components/GerbangLangganan'"));

// Cara memverifikasi posisi: di dalam JSX, `<GerbangLangganan>` harus muncul
// SEBELUM `<MainApp` dan keduanya ditutup dengan `</GerbangLangganan>`
// setelah `/>` MainApp.
const bukaGate = appKode.indexOf('<GerbangLangganan');
const tutupGate = appKode.indexOf('</GerbangLangganan>');
const bukaMain = appKode.indexOf('<MainApp');
const tutupMain = appKode.indexOf('/>', bukaMain);

cek('GerbangLangganan dirender', bukaGate >= 0 && tutupGate > bukaGate);
cek('MainApp dirender', bukaMain >= 0 && tutupMain > bukaMain);
cek('Gerbang dibuka sebelum MainApp', bukaGate >= 0 && bukaMain > bukaGate, `${bukaGate} < ${bukaMain}`);
cek(
  'MainApp ditutup sebelum Gerbang',
  tutupMain >= 0 && tutupGate > tutupMain,
  `Main ${tutupMain} < Gate ${tutupGate}`
);
cek('Gerbang meneruskan onKeluar', /<GerbangLangganan[^>]*onKeluar=\{handleLogout\}/s.test(appKode));
cek('MainApp tetap memakai onLogout', /<MainApp onLogout=\{handleLogout\}/.test(appKode));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Menu Manajemen Akun hanya untuk admin');
cek('halaman terdaftar di PAGES', /id: 'tabManajemenAkun'/.test(appKode));
cek('riwayat izin tidak lagi menjadi menu/sidebar tersendiri',
  !/id: 'tabRiwayatIzin'/.test(appKode) && !/tabRiwayatIzin:\s*\(\) => import/.test(appKode) &&
    !/tabRiwayatIzin\s*:/.test(userSrc));
cek('Perizinan memiliki tab Pengajuan dan Riwayat yang accessible',
  /role="tablist"[\s\S]*?Pengajuan Izin[\s\S]*?Riwayat Izin/.test(izinSrc) &&
    /role="tabpanel"/.test(izinSrc));
cek('fungsi RiwayatIzin tertanam dalam Perizinan.tsx',
  /function RiwayatIzinPanel/.test(izinSrc) && /rpcListIjin/.test(izinSrc) &&
    /function jumlahStatus/.test(izinSrc));
cek('file RiwayatIzin.tsx sudah dihapus',
  !existsSync(new URL('../src/pages/RiwayatIzin.tsx', import.meta.url)));
const pathLama = ctxSrc.split('export const PATH_LAMA')[1]?.split('};')[0] ?? '';
cek('PATH_LAMA tidak lagi memuat route riwayat', !/riwayat/i.test(pathLama));
/*
 * Polanya `currentUser?.role`, bukan `currentUser.role`.
 *
 * `visiblePages` sekarang dijalankan di dalam filter yang lebih besar
 * (`cekingSesi || !currentUser ? [] : PAGES`), jadi `currentUser` sudah
 * dijamin ada oleh filter luar — tapi `?.` dipakai supaya barisnya tetap aman
 * kalau syaratnya dibalik atau ada yang menyederhanakannya nanti. Yang
 * diuji di sini adalah **perannya masih diperiksa**, bukan bentuk operator
 * aksesnya.
 */
cek(
  'filter halaman memeriksa role admin',
  /if \(page\.id === 'tabManajemenAkun'\) return currentUser\??\.role === 'admin';/.test(appKode)
);
cek(
  'halaman admin ditutup saat sesi belum diverifikasi',
  /cekingSesi \|\| !currentUser \? \[\] : PAGES/.test(appKode),
  'selama verifikasi berjalan, tidak boleh ada halaman yang bisa dirender'
);
// Satu menu dan satu URL; URL billing lama tetap diarahkan ke halaman akun.
cek('route akun', ctxSrc.includes("tabManajemenAkun: '/manajemen-akun'"));
cek(
  'route langganan tidak terpisah',
  !ctxSrc.includes('tabLangganan:')
);
cek('URL lama /manajemen-akun/langganan dialihkan', /'\/manajemen-akun\/langganan': PATH_MAP\.tabManajemenAkun/.test(ctxSrc));
cek('URL lama /langganan dialihkan', /'\/langganan': PATH_MAP\.tabManajemenAkun/.test(ctxSrc));
cek('pengalihan memakai replaceState (tidak menumpuk riwayat)', /replaceState\(null, '', tujuan\)/.test(ctxSrc));
cek('halaman menolak non-admin sendiri', /currentUser\?\.role !== 'admin'/.test(akunSrc));
cek('pesan akses ditolak ditampilkan', akunSrc.includes('Akses Ditolak'));
cek('tabManajemenAkun di bawah PERMISSION_KHUSUS_ADMIN', /PERMISSION_KHUSUS_ADMIN[\s\S]{0,80}tabManajemenAkun/.test(userSrc));

cek('Manajemen Akun memuat tiga tab di satu menu', /role="tablist"/.test(akunSrc) &&
  /Manajemen Akun/.test(akunSrc) && /Riwayat Pembayaran/.test(akunSrc) && /Metode Pembayaran/.test(akunSrc));
cek('halaman akun menampilkan billing sebagai tab lokal', /<Langganan section=\{tabAktif\} \/>/.test(akunSrc));
cek('menu administrasi dipisah dari Menu Utama', /admin: 'Administrasi'/.test(appKode));
cek('batasiIzin memaksa nilainya false', /for \(const key of PERMISSION_KHUSUS_ADMIN\) base\[key\] = false;/.test(userSrc));
cek('halaman di-filter juga oleh tabPermissions', /tabPermissions as unknown as Record<string, boolean>\)\[page\.id\] === true/.test(appKode));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Aturan boleh masuk di satu tempat');
cek('bolehMasuk mengizinkan admin tanpa syarat', /if \(role === 'admin'\) return true;/.test(langgananSrc));
cek(
  'bolehMasuk mengizinkan hanya aktif & gratis',
  /return ringkasan\.status === 'aktif' \|\| ringkasan\.status === 'gratis';/.test(langgananSrc)
);
cek('gratis menang atas kedaluwarsa', /if \(doc\?\.gratis\) return 'gratis';/.test(langgananSrc));

// Gerbang memakai fungsi yang sama — bukan menyalin logikanya.
cek('gerbang memakai bolehMasuk', /bolehMasuk\(ringkasan, role\)/.test(gateKode));
cek('gerbang tidak menyalin aturan sendiri', !/status === 'aktif' \|\|/.test(gateKode));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Auto-login server ikut mati saat terkunci');
cek('gerbang memanggil resetAutoLogin', /resetAutoLogin\(\);/.test(gateKode));
cek('gerbang membuang cache sesi server', /clearServerSessionCache\(username\)/.test(gateKode));
cek(
  'reset + cache hanya saat TIDAK boleh masuk',
  /if \(bolehMasuk\(ringkasan, role\)\) return;[\s\S]{0,200}resetAutoLogin\(\);[\s\S]{0,200}clearServerSessionCache\(username\);/.test(
    gateKode
  )
);
cek('import resetAutoLogin dari modul yang benar', gateSrc.includes("from '../lib/serverAutoLogin'"));
cek('efek auto-login ada di dalam MainApp', /function MainApp\(/.test(appKode) && /mulaiAutoLogin\(username\)/.test(appKode));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Gerbang dilewati kalau Firestore belum siap');
cek('cek isFirebaseReady', /if \(!isFirebaseReady\(\) \|\| !ringkasan\) \{/.test(gateKode));
cek(
  'melewatkan children saat Firestore kosong',
  /if \(!isFirebaseReady\(\) \|\| !ringkasan\) \{\s*return <>\{children\}<\/>;/.test(gateKode)
);
cek('kasih alasan di komentar', /terkunci permanen/.test(gateSrc));
cek(
  'layar langganan habis punya tinggi viewport dan area konten yang bisa digulir',
  /className="flex h-dvh min-h-0 flex-col overflow-hidden/.test(gateSrc) &&
    /className="min-h-0 flex-1 overflow-y-auto overscroll-contain"/.test(gateSrc)
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Dialog pembayaran untuk akun sendiri');
cek('modal diimpor ke gerbang', gateSrc.includes("from './BayarLanggananModal'"));
cek('modal hanya dirender saat bayar true', /ringkasan=\{bayar \? ringkasan : null\}/.test(gateKode));
cek('dialog dibuka otomatis sekali', /sudahAutoBuka\.current = true;/.test(gateKode));
cek('tombol Lakukan Pembayaran ada', /Lakukan Pembayaran/.test(gateKode));
/*
 * Tombol utama punya **dua** perilaku, jadi keduanya diperiksa.
 *
 * Semula hanya `setBayar(true)` yang dicari. Sekarang, kalau ada tagihan
 * `menunggu`, tombol itu membuka tagihan itu (`mulaiLewatTagihan`) — bukan
 * membuat tagihan baru yang pasti ditolak server. Kalau tidak, pengguna dengan
 * tagihan tertunggak menekan tombol, memilih paket, lalu kena 409.
 *
 * Dua-duanya harus ada; salah satu saja tidak cukup.
 */
cek('tombol membuka dialog pembayaran dari keadaan tanpa tagihan',
  /setLanjutkan\(null\);\s*\n\s*setPaketTerpilih\(null\);\s*\n\s*setBayar\(true\);/.test(gateKode));
cek('tombol membuka tagihan yang ada kalau ada',
  /if \(menunggu\.length > 0\) \{[\s\S]{0,220}?mulaiLewatTagihan\(menunggu\[0\]\.orderId\)/.test(gateKode),
  'tanpa ini tombol utama selalu membuat tagihan baru yang ditolak 409');
cek('ada tombol periksa lagi', /Sudah bayar\? Periksa lagi/.test(gateKode));
cek('ada jalan keluar', /Ganti akun/.test(gateKode));
cek('tidak ada apa-apa saat langganan aktif', /if \(bolehMasuk\(ringkasan, role\)\) \{\s*return <>\{children\}<\/>;/.test(gateKode));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Admin memantau, tidak mencatat pembayaran');
cek('admin tidak mengimpor modal pembayaran', !adminSrc.includes('BayarLanggananModal'));
cek('tidak ada aksi setDialogBayar', !/setDialogBayar/.test(adminSrc));
cek('tidak ada label Catat Pembayaran', !/Catat Pembayaran|Catat pembayaran/.test(adminSrc));
// Tapi alat administrasi tetap ada.
cek('toggle gratis tersedia pada baris akun', /Tandai gratis|Batalkan status gratis/i.test(akunSrc));
cek('perpanjangan manual tersedia pada baris akun', /Perpanjang masa aktif/.test(akunSrc));
cek('koreksi tanggal tersedia pada baris akun', /Koreksi tanggal/.test(akunSrc));
cek('kredensial server tetap dikelola dari form akun admin', /saveServerCredential/.test(akunSrc));
/*
 * ⚠️ Alert "Admin memantau, pengguna yang membayar" **dihapus** atas permintaan
 * pengguna.
 *
 * Ketiganya masih berlaku: tidak ada tombol catat pembayaran, dan alat
 * administrasi (gratis, perpanjang, koreksi) tetap ada. Yang hilang hanya
 * paragraf penjelasan — isinya sudah tersirat dari tidak adanya tombol catat
 * pembayaran, jadi blok biru itu cuma menambah tinggi layar.
 *
 * Yang **tetap dijaga** di sini adalah aturan yang benar-benar penting: tidak
 * ada jalur di tangan admin untuk mencatat pembayaran.
 */
cek('tidak ada tombol catat pembayaran di tangan admin',
  !/Catat Pembayaran|Catat pembayaran|catatPembayaran/.test(adminSrc),
  'admin bisa mengaktifkan langganan orang lain tanpa ada transfer sama sekali');
cek('penjelasan "Admin memantau" tidak lagi ditampilkan',
  !/Admin memantau/.test(adminSrc),
  'paragraf dihapus atas permintaan pengguna');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7b. Masa tunggu 5 menit mengunci, bukan menunda');
// Kehilangan masa tunggu = pengguna membayar dua kali. Jadi tiga hal diuji:
// kunci bertahan melewati reload, layar tunggu benar-benar tanpa jalan keluar,
// dan keluar hanya lewat dua pintu (aktif atau kehabisan waktu).
cek('masa tunggu disimpan di sessionStorage', /sessionStorage\.setItem\(KUNCI_TUNGGU/.test(gateKode));
cek('masa tunggu dipulihkan setelah reload', /bacaTungguVerifikasi\(\)/.test(gateKode));
cek('kunci diverifikasi milik akun yang sama', /info\.username !== username/.test(gateKode));
cek('hitung mundur dihitung dari tenggat, bukan dikurangi', /berakhirAt - Date\.now\(\)/.test(gateKode));
cek('batas 5 menit', /TUNGGU_VERIFIKASI_DETIK = 300/.test(gateSrc));
cek('lalu dihitung ulang tiap detik', /}, 1000\);/.test(gateKode));
cek('status dicek ulang selama menunggu dengan interval hemat',
  /JEDA_CEK_VERIFIKASI_MS = 5000/.test(gateSrc) &&
    /setInterval\(\(\) => \{\s*void muatStatusLangganan\(\);/.test(gateSrc));
cek('polling status hanya membaca langganan dan bukan seluruh billing/tagihan',
  /const muatStatusLangganan = useCallback[\s\S]*?loadLangganan\(username, true\)[\s\S]*?setRingkasan/.test(gateSrc) &&
    !/setInterval\(\(\) => \{\s*void muat\(\);/.test(gateSrc));
cek('polling meneruskan galat jaringan dan mempertahankan status terakhir',
  /teruskanGalatJaringan = false/.test(baca('../src/lib/langgananFirestore.ts')) &&
    /teruskanGalatJaringan\s*\?\s*await panelBatal/.test(baca('../src/lib/langgananFirestore.ts')));
cek('keluar begitu langganan aktif', /if \(!bolehMasuk\(ringkasan, role\)\) return;\s*hapusTungguVerifikasi\(\);\s*setTunggu\(null\);/.test(gateKode));
cek('kehabisan waktu mengembalikan ke pembayaran', /setBayar\(true\);\s*toast\.info\(/.test(gateKode));
cek('layar tunggu dirender sebelum cek boleh-masuk', gateKode.indexOf('<LayarTungguVerifikasi') < gateKode.indexOf('if (bolehMasuk(ringkasan, role)) {\n    return <>{children}</>;'));
cek('dialog ditutup saat masa tunggu mulai', /setBayar\(false\);\s*setTunggu\(baru\);/.test(gateKode));
cek('layar tunggu tidak punya prop aksi', /<LayarTungguVerifikasi info=\{tunggu\} sisaDetik=\{sisaDetik\} \/>/.test(gateKode));
cek('tidak ada <button> di komponen layar tunggu', !/<button/.test(kode(baca('../src/components/GerbangLangganan.tsx').split('export function LayarTungguVerifikasi')[1] ?? '')));
cek('tidak ada teks akses gratis / exempt lagi', !/exempt/i.test(gateSrc));
cek('dialog meneruskan awal masa tunggu ke gerbang', /onTungguVerifikasi/.test(modalKode));
cek('menekan tombol = buka WA sekaligus catat bayar', /onKonfirmasi\(\);\s*\}/.test(modalKode));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 8. Pembayaran diaktifkan lewat satu jalur — dan jalurnya di server');
// ⚠️ Klien TIDAK BOLEH menulis Firestore. `catatPembayaran()` masih ada di
// `lib/langganan.ts` (dipakai admin untuk koreksi), tapi tidak boleh
// diimpor komponen mana pun — yang mengaktifkan langganan hanya endpoint
// server, yang menghitung harga/durasi sendiri dan memverifikasi Midtrans.
cek('komponen tidak mengimpor catatPembayaran', !/\bcatatPembayaran\b/.test(modalKode));
cek('komponen hanya mengaktifkan lewat server', /aktifkanLangganan\(/.test(modalKode));
cek('klien memanggil /api/billing/aktivasi', /\/api\/billing\/aktivasi/.test(kode(baca('../src/lib/aktivasiLangganan.ts'))));
cek('klien menampilkan status HTTP jika endpoint aktivasi tidak memberi JSON',
  /Endpoint aktivasi tidak mengembalikan respons JSON yang valid \(HTTP \$\{response\.status\}\)/.test(
    kode(baca('../src/lib/aktivasiLangganan.ts'))
  ));
cek('tidak ada tulis Firestore di jalur aktivasi klien', !/setDoc/.test(baca('../src/lib/aktivasiLangganan.ts')));

// Sisi server.
const serverSrc = kode(baca('../src/lib/serverBilling.ts'));
cek('server memakai Firebase Admin SDK', /firebase-admin\/firestore/.test(serverSrc));
cek('server menghitung harga dari paket server sendiri', /paketDariOrderId/.test(serverSrc));
cek('server menolak harga yang tak cocok', /Nominal tidak cocok/.test(serverSrc));
cek('server memverifikasi Midtrans', /verifikasiMidtrans/.test(serverSrc));
cek('hanya settlement yang diterima', /status !== 'settlement'/.test(serverSrc));
cek('fraud_status harus accept', /fraud/.test(serverSrc));
cek('server idempoten terhadap orderId', /tagihanAda\.exists/.test(serverSrc));
cek('orderId/username divalidasi (anti path traversal)', /\[\\\\\/\]/.test(serverSrc));
/*
 * ⚠️ Kedua koleksi ini sekarang **server-only sepenuhnya** — bukan hanya
 * untuk tulis.
 *
 * Semula `allow read: if true` dengan alasan "gerbang perlu tahu masa aktif".
 * Tapi aplikasi tidak memakai Firebase Auth, jadi `request.auth` selalu `null`
 * dan `if true` berarti seluruh koleksi terbuka. API key-nya ada di bundle,
 * jadi siapa pun bisa membacanya lewat REST API: NIP, masa aktif, status
 * `gratis` (siapa yang tidak membayar), dan di tagihan juga nama orang,
 * nominal, serta `buktiUrl`.
 *
 * Sekarang lewat `POST /api/panel-auth`, yang memverifikasi token.
 */
const rulesGerbang = kode(baca('../firestore.rules'));
cek(
  'rules menutup langganan dari klien sepenuhnya (baca + tulis)',
  /match \/jatim_langganan\/\{username\}\s*\{\s*allow read, write: if false;/.test(rulesGerbang),
  'allow read: if true = NIP + masa aktif + status gratis terbuka untuk siapa pun'
);
cek(
  'rules menutup tagihan dari klien sepenuhnya (baca + tulis)',
  /match \/jatim_tagihan\/\{orderId\}\s*\{\s*allow read, write: if false;/.test(rulesGerbang),
  'allow read: if true = nama + nominal + buktiUrl terbuka untuk siapa pun'
);
// Akun panel juga wajib tertutup penuh — ini yang membuat "role bisa ditulis
// sendiri" tidak mungkin. Dijaga di `cek-panel-auth.ts` juga; di sini hanya
// sebagai pengingat bahwa rules punya dua sisi.
cek(
  'rules menutup akses klien ke jatim_pengguna',
  /jatim_pengguna\/\{username\}[\s\S]{0,160}allow read, write: if false;/.test(
    kode(baca('../firestore.rules'))
  )
);

/*
 * ⚠️ Kedua pemeriksaan ini bukan lagi tentang kode peramban.
 *
 * `perpanjangManual()`, `catatPembayaran()`, `savePengaturanBilling()`,
 * `setMasaAkhir()`, `setGratis()`, `buatTagihan()`, `setStatusTagihan()`, dan
 * `hapusTagihan()` **sudah tidak ada** di peramban — semuanya menulis ke
 * koleksi yang `firestore.rules` tutup untuk klien, jadi versi perambannya
 * pasti ditolak rules.
 *
 * Yang diperiksa di sini sekarang adalah sisi server-nya. Aturan yang sama
 * ("perpanjangan manual tidak menambah totalBayar", "aktivasi idempoten terhadap
 * orderId") masih berlaku — hanya tempatnya yang berubah, dan menapaknya di
 * server membuat aturan itu benar-benar ditegakkan, bukan sekadar Expedisi.
 *
 * Lihat `tools/cek-keamanan.mts` §7 yang menjaga `langgananFirestore` tidak
 * punya operasi tulis sama sekali.
 */
const billingSrc = kode(baca('../src/lib/serverBilling.ts'));
/*
 * Jendela karakter terlalu sempit sekarang — badan fungsi sudah bertambah
 * blok "dinding admin" dan validasi. Yang diuji bukan jarak, tapi **isi**:
 * `perpanjangManualServer` harus menyalin nilai lama apa adanya, bukan
 * menambahkannya.
 */
const perpanjangSrc = billingSrc
  .split('export async function perpanjangManualServer')[1]
  ?.split('export async function')[0] ?? '';
cek(
  'perpanjangManual (server) menyalin totalBayar, tidak menambah',
  /totalBayar: lama\.totalBayar \?\? 0/.test(perpanjangSrc) &&
    !/totalBayar:[^\n]*\+/.test(perpanjangSrc),
  'perpanjangan manual bukan pembayaran — totalBayar naik berarti rekap keuangan bohong'
);
cek(
  'perpanjangManual (server) menyalin jumlahBayar, tidak menambah',
  /jumlahBayar: lama\.jumlahBayar \?\? 0/.test(perpanjangSrc) &&
    !/jumlahBayar:[^\n]*\+/.test(perpanjangSrc)
);
cek(
  'perpanjangManual (server) tidak menerima pembayaran',
  !/catatPembayaran/.test(
    billingSrc.split('export async function perpanjangManualServer')[1]?.split('export async function')[0] ?? ''
  )
);

// Aktivasi idempoten terhadap `orderId` — sekarang satu-satunya jalur pembayaran.
cek(
  'aktivasi langganan idempoten terhadap orderId',
  /tagihanAda\.exists/.test(billingSrc) && /runTransaction/.test(billingSrc),
  'cek di dalam transaksi — di luar transaksi ada jendela race'
);
cek(
  'idempotensi dijelaskan di komentar',
  /Idempoten terhadap `orderId`/.test(baca('../src/lib/serverBilling.ts'))
);
cek(
  'harga paket selalu dari konfigurasi server, tidak pernah dari klien',
  /bacaPaket\(\)/.test(billingSrc) && /hasil\.nominal !== paketTerpilih\.harga/.test(billingSrc)
);
cek(
  'server menolak nominal yang tidak cocok',
  /Nominal tidak cocok/.test(billingSrc)
);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 9. Pustaka QR hanya dimuat saat dibutuhkan');
// `qrcode-generator` ~50 KB dan hanya dipakai saat dialog pembayaran
// terbuka. Kalau ikut masuk chunk `vendor`, `lazy()` jadi tidak berguna
// karena vendor dimuat di setiap halaman.
const viteSrc = baca('../vite.config.ts');

cek('KartuQris diimpor lewat lazy()', /const KartuQris = lazy\(\(\) => import\('.\/KartuQris'\)\);/.test(modalSrc));
cek('KartuQris tidak diimpor langsung', !/^import KartuQris from/m.test(modalSrc));
cek('ada Suspense + fallback', /<Suspense fallback=\{<KartuQrisSkeleton/.test(modalKode));
/*
 * ⚠️ Dua pemeriksaan di sini dulu membaca bentuk teks yang sudah tidak ada.
 * `vite.config.ts` sekarang mengecualikan beberapa pustaka sekaligus dalam
 * satu blok `if`, jadi pola `qrcode-generator') return undefined;` tidak lagi
 * cocok meski aturan itsinya persis sama.
 *
 * Yang dijaga adalah **aturannya**, bukan bentuk barisnya: setiap pustaka
 * yang hanya dipakai saat tombol ditekan harus dikecualikan dari `vendor`.
 * Daftar lengkapnya (termasuk `jspdf` beserta `optionalDependencies`-nya)
 * diurus `cek-bundle-awal.ts`; yang di sini cukup `qrcode-generator` sebagai
 * penanda bahwa pengecualian itu masih ada sama sekali.
 */
const blokChunks = viteSrc.slice(viteSrc.indexOf('manualChunks'));
cek('vite.config menyisihkan qrcode-generator dari vendor',
  /id\.includes\('qrcode-generator'\)/.test(blokChunks) &&
    /return undefined/.test(blokChunks),
  'tanpa ini qrcode-generator ikut ter-eager-load bersama layar login');
cek('penjelasan ada di vite.config',
  // `i`: yang dicari adalah kalimat penjelasan, bukan kapitalisasi tertentu.
  // Tanpa flag ini, penjelasannya tetap dianggap tidak ada hanya karena
  // dimulai huruf besar di awal baris.
  /ditunggu sampai tombol ditekan|saat tombol ditekan|jadi tidak berguna/i.test(viteSrc),
  'kode ini gelap tanpa alasan — nilai `lazy()` di sini tidak bisa dinilai dari diff');

// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== Sisa: muatan yang tumpang-tindih dan state yang salah tombol');
// ═══════════════════════════════════════════════════════════════════════
/*
 * Dua pola yang sama-sama menghasilkan "data lama menimpa data baru", dan
 * keduanya sudah pernah ada di berkas ini.
 *
 * **Muatan tumpang-tindih.** `muat()` dipanggil dari tiga tempat: saat gerbang
 * dibuka, tiap 3 detik selama masa tunggu, dan setelah pembayaran. Jeda 3
 * detik lebih pendek daripada waktu muatan saat jaringan lambat, jadi dua
 * permintaan bisa hidup bersamaan — dan jaringan tidak menjamin urutannya.
 * Di `Laporan` dan `RiwayatIzin` akibatnya tabel menampilkan hasil filter lama
 * setelah pengguna sudah memilih yang baru.
 *
 * Di `GerbangLangganan` akibatnya jauh lebih merusak: efek di bawah membaca
 * `ringkasan` dan langsung memanggil `resetAutoLogin()` plus
 * `clearServerSessionCache()` kalau hasilnya belum entitle. Satu respons basi
 * yang kebetulan mendarat belakangan bisa **memutus sesi server orang yang
 * pembayarannya baru saja berhasil**, persis di saat aplikasi sedang keluar
 * dari layar tunggu.
 *
 * **Reset berdasarkan identitas objek.** Efek reset di `BayarLanggananModal`
 * bergantung pada objek `ringkasan`, yang dibangun baru di setiap `muat()`.
 * Satu klik "Cek lagi" atau satu pembayaran selesai karena itu menghapus
 * seluruh isian yang sedang dikerjakan: paket yang sudah dipilih, `orderId`
 * yang sudah dibuat, QR yang sudah dirender. Kuncinya harus nama akun.
 */
{
  const req = [
    ['Laporan', baca('../src/pages/Laporan.tsx')],
    ['RiwayatIzinPanel', izinSrc],
    ['GerbangLangganan', baca('../src/components/GerbangLangganan.tsx')],
  ];
  for (const [nama, isi] of req) {
    cek(`${nama} punya nomor urut muatan`, /\bconst muatanSeq = useRef\(0\)/.test(isi),
      'tanpa penomoran, respons yang lebih lambat bisa menimpa respons yang lebih baru');
    cek(`${nama} melempar respons usang sebelum menyentuh state`,
      /const usang = \(\) => seq !== muatanSeq\.current;/.test(isi) &&
        [...isi.matchAll(/if \(usang\(\)\) return;/g)].length >= 2,
      'penomoran tanpa pemakaian sama saja tidak ada gunanya; minimal success dan error');
    cek(`${nama} menaikkan nomor urut di awal muatan`,
      /\+\+muatanSeq\.current/.test(isi),
      'kalau dinaikkan di akhir, dua muatan yang mulai bersamaan dapat nomor yang sama');
  }

  /*
   * Deteksi dependensi efek: ambil isi kurung siku terakhir sebelum
   * `);` penutup sebuah `useEffect`.
   *
   * Dulu diperiksa dengan `dateStart[\s\S]{0,120}dateEnd` di seluruh
   * berkas, dan itu tidak berguna — pola itu cocok karena kedua nama itu
   * memang dipakai berdekatan di bagian **lain** (filter baris, judul
   * subtitle, nama berkas CSV). Assertion yang selalu benar tidak menjaga
   * apa pun.
   */
  const depsEfek = (isi: string, polaMulai: RegExp): string => {
    const m = isi.slice(isi.search(polaMulai)).match(/\},\s*\[([^\]]*)\]\s*\);/);
    return m ? m[1] : '(tidak ketemu)';
  };
  const depsRiwayat = depsEfek(izinSrc, /if \(!aktif \|\| state\.hasLoadedOnce\) return;/);
  cek('RiwayatIzin tidak lagi memuat ulang saat tanggal berubah',
    !/dateStart|dateEnd/.test(depsRiwayat),
    `dependensi efek: [${depsRiwayat}]`);
  cek('Laporan tidak lagi memuat ulang saat jenis laporan berubah',
    !/reportType/.test(depsEfek(baca('../src/pages/Laporan.tsx'), /muatanSeq\.current/)),
    `dependensi efek: [${depsEfek(baca('../src/pages/Laporan.tsx'), /muatanSeq\.current/)}]`);

  const modal = baca('../src/components/BayarLanggananModal.tsx');
  cek('reset modal pembayaran bergantung pada nama akun, bukan objek ringkasan',
    /\[usernameRingkasan\]/.test(modal) && /const usernameRingkasan = ringkasan\?\.username/.test(modal),
    'dependensi objek berarti satu muatan ulang menghapus seluruh isian yang sudah diisi');
  cek('reset modal pembayaran tidak lagi bergantung pada objek ringkasan',
    !/^\s*\}, \[ringkasan\]\);/m.test(modal),
    'ini yang membuatnya terhapus tiap "Cek lagi"');

  const kelolaAkun = baca('../src/pages/ManajemenAkun.tsx');
  cek('kredensial server dikelola dari form akun admin',
    /Password Server/.test(kelolaAkun) && /saveServerCredential\(target/.test(kelolaAkun));
  cek('penghapusan kredensial menyegarkan ringkasan akun',
    /await hapusServerCredential\(akun!\.username\);\s*onDataBerubah\(\);/.test(kelolaAkun));
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
