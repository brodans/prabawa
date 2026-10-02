/**
 * Auto-login ke server pusat: pemetaan kode galat.
 *
 * `tools/cek-auto-login.mjs` menguji orkestrasi, cache, dan faktor `imei` —
 * semuanya tanpa jaringan. Skrip ini menguji bagian yang **hanya bisa salah
 * lewat kode**, yaitu penerjemahan `PanelAuthError` dari server jadi `status`
 * yang ditampilkan Beranda.
 *
 * Kenapa ini punya skrip sendiri: akibatnya terlihat oleh pengguna. Salah
 * menerjemahkan kode berarti orang melihat "Gagal menghubungi server pusat"
 * padahal server sudah menjawab dengan jelas — "akun ini terdaftar di perangkat
 * lain" — lalu mereka mengubah apa saja yang bukan penyebabnya.
 *
 * ## Yang paling rawan: `instanceof`
 *
 * `PanelAuthError` berasal dari modul yang diimpor **secara dinamis**
 * (`akunFirestore`, supaya tidak masuk jalur muat awal). `err instanceof
 * PanelAuthError` di dalam blok `catch` selalu `false`, karena kelas itu belum
 * ada di scope ketika blok itu ditulis. Akibatnya **semua** kode jatuh ke jalur
 * "gagal" — termasuk 402 yang punya petunjuk spesifik.
 *
 * Bentuk yang benar memeriksa `err.name`, yang memang di-*assign* konstruktor.
 * Bagian di bawah menguji keduanya: `instanceof` harus terlihat, dan
 * penerjemahannya harus benar untuk tiap kode.
 */

function buatStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear(),
    get length() {
      return data.size;
    },
    key: i => [...data.keys()][i] ?? null,
  };
}
globalThis.localStorage = buatStorage();
globalThis.sessionStorage = buatStorage();
globalThis.window = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };

let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/*
 * Jawaban `/api/panel-auth` untuk aksi `pusat:login`, per skenario.
 *
 * `fetch` tiruan memakai `aksi` di body supaya tiap skenario bisa diuji tanpa
 * benar-benar memanggil server.
 */
let jawaban = { status: 200, body: {} };
const panggilan = [];

globalThis.fetch = async (url, opsi) => {
  const body = JSON.parse(String(opsi?.body ?? '{}'));
  panggilan.push({ url: String(url), aksi: body.aksi, imei: body.imei });
  const { status, body: isi } = jawaban;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => isi,
    text: async () => JSON.stringify(isi),
  };
};

const S = await import('../src/lib/serverAutoLogin.ts');
const { PanelAuthError } = await import('../src/lib/akunFirestore.ts');

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Sukses → profil dibangun, cache ditulis');
// ═════════════════════════════════════════════════════════════════════
jawaban = {
  status: 200,
  body: {
    ok: true,
    kode: 200,
    apiKey: 'API_KEY_DARI_SERVER',
    profil: {
      api_key: 'API_KEY_DARI_SERVER',
      nip: '200308062025101001',
      pegawai_id: '113866',
      nama: 'PEGAWAI UJI',
      jabatan: 'Analis',
      departemen: 'SUB BAGIAN',
      group_name: 'pegawai',
      upload_wajah: 1,
      using_wajah: 1,
      allow_wfh: 1,
      vektor_approved: 1,
      absen_timeout: 900_000,
      presensi: 1,
      perizinan: 1,
      laporan: 1,
      home: 1,
    },
  },
};

panggilan.length = 0;
const sukses = await S.cobaAutoLogin('budi', { abaikanCache: true });
cek('status berhasil', sukses.status === 'berhasil', sukses.status);
cek('nama dari server', sukses.profile?.nama === 'PEGAWAI UJI', String(sukses?.profile?.nama));
cek('api_key dipakai', sukses.profile?.apiKey === 'API_KEY_DARI_SERVER');
cek('imei diteruskan ke server', Boolean(panggilan[0]?.imei), String(panggilan[0]?.imei ?? '(kosong)'));
cek('dipanggil lewat endpoint panel', panggilan[0]?.aksi === 'pusat:login', String(panggilan[0]?.aksi));
cek('url-nya endpoint yang benar', /\/api\/panel-auth$/.test(panggilan[0]?.url ?? ''), String(panggilan[0]?.url));
cek('flag modul ikut terbaca', sukses.profile?.modul?.presensi === 1);
cek('absenTimeout dari server (sudah dalam ms)', sukses.profile?.absenTimeout === 900_000,
  String(sukses?.profile?.absenTimeout));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Setiap kode server jadi status yang tepat');
// ═════════════════════════════════════════════════════════════════════

/**
 * Kode 402 punya petunjuk spesifik: server pusat menjawab begitu kalau akun
 * terkunci ke perangkat lain, dan UI harus menampilkan kolom IMEI. Kalau kode
 * ini jatuh ke "gagal", orang akan blamed jaringan.
 */
jawaban = { status: 402, body: { ok: false, kode: 402, pesan: 'Akun ini terdaftar di perangkat lain.' } };
const terkunci = await S.cobaAutoLogin('budi', { abaikanCache: true });
cek('402 → terkunci-perangkat', terkunci.status === 'terkunci-perangkat', terkunci.status);
cek(
  'pesan 402 menyebut IMEI',
  /IMEI|androidId|perangkat/i.test(terkunci.pesan ?? ''),
  terkunci.pesan ?? '(tidak ada pesan)'
);

/**
 * 404 = kredensial belum pernah diisi. 422 = kredensial ada tapi format lamanya
 * tidak bisa dibaca server.
 *
 * Keduanya `belum-ada-kredensial`, bukan `gagal`: instruksinya jelas dan bisa
 * langsung dikerjakan (simpan ulang lewat Manajemen Akun), sementara `gagal`
 * membuat orang mengira masalahnya jaringan lalu mencoba-coba tanpa hasil.
 */
for (const kode of [404, 422]) {
  jawaban = { status: kode, body: { ok: false, kode, pesan: 'Kredensial server belum diatur.' } };
  const hasil = await S.cobaAutoLogin('budi', { abaikanCache: true });
  cek(`${kode} → belum-ada-kredensial`, hasil.status === 'belum-ada-kredensial', hasil.status);
  cek(`${kode} tetap membawa pesan server`, Boolean(hasil.pesan), hasil.pesan ?? '(tidak ada pesan)');
}

/** 401 = NIP/password server pusat salah. */
jawaban = { status: 401, body: { ok: false, kode: 401, pesan: 'NIP atau password server pusat tidak cocok.' } };
const salah = await S.cobaAutoLogin('budi', { abaikanCache: true });
cek('401 → kredensial-salah', salah.status === 'kredensial-salah', salah.status);

/** Kode lain dari server pusat = kegagalan umum, pesannya tetap dibawa. */
jawaban = { status: 500, body: { ok: false, kode: 500, pesan: 'Server pusat sedang gangguan.' } };
const lain = await S.cobaAutoLogin('budi', { abaikanCache: true });
cek('kode tak dikenal → gagal', lain.status === 'gagal', lain.status);
cek('pesan server tetap dibawa', lain.pesan === 'Server pusat sedang gangguan.', lain.pesan ?? '(kosong)');

/**
 * Jaringan mati — `fetch` melempar, `akunFirestore` membungkusnya jadi
 * `PanelAuthError` dengan `kode: 0`.
 *
 * Ini yang harus **tidak** mengunci pengguna: dia masih punya token yang sah,
 * hanya tidak bisa sekarang.
 */
jawaban = { status: 0, body: null };
const lamaFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('Failed to fetch');
};
const offline = await S.cobaAutoLogin('budi', { abaikanCache: true });
globalThis.fetch = lamaFetch;
cek('jaringan mati → gagal, bukan terkunci', offline.status === 'gagal', offline.status);
cek('pesan jaringan dalam bahasa manusia',
  !/Failed to fetch/.test(offline.pesan ?? '') && Boolean(offline.pesan),
  offline.pesan ?? '(tidak ada pesan)');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Tidak ada jalur yang kembali ke PanelAuthError mentah');
// ═════════════════════════════════════════════════════════════════════
/*
 * Kalau `cobaAutoLogin` melempar apa adanya, `MainApp` yang memanggilnya tidak
 * punya `try` — dan seluruh efek auto-login hilang, termasuk yang sedang
 * berjalan. Jadi setiap kegagalan harus dikembalikan sebagai `status`.
 */
jawaban = { status: 402, body: { ok: false, kode: 402, pesan: 'x' } };
let melempar = false;
let hasilMentah;
try {
  hasilMentah = await S.cobaAutoLogin('budi', { abaikanCache: true });
} catch (err) {
  melempar = true;
  hasilMentah = err;
}
cek('cobaAutoLogin tidak melempar untuk 402', !melempar, String(hasilMentah?.message ?? ''));
cek('hasilnya object dengan status', typeof hasilMentah?.status === 'string', String(hasilMentah?.status));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Bentuk kode yang mencegah regresi');
// ═════════════════════════════════════════════════════════════════════
const { readFileSync } = await import('node:fs');
const root = new URL('..', import.meta.url).pathname;
const kode = f =>
  readFileSync(`${root}${f}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const src = kode('src/lib/serverAutoLogin.ts');

/*
 * `instanceof` harus **tidak ada**. Bukan prefers style: `PanelAuthError`
 * datang dari impor dinamis, jadi di dalam `catch` kelas itu belum ada di
 * scope dan pemeriksaannya selalu `false` — membuat seluruh kode error jatuh
 * ke jalur "gagal".
 */
cek('tidak memakai instanceof terhadap PanelAuthError',
  !/instanceof\s+(?:Galat)?PanelAuth/.test(src),
  'kelasnya dari impor dinamis — instanceof selalu false di dalam catch');
cek('memakai helper bentuk-error',
  /kodeGalatPanel/.test(src));
cek('helper memeriksa err.name, bukan instanceof',
  /name\s*!==\s*'PanelAuthError'/.test(kode('src/lib/serverAutoLogin.ts')),
  'name di-assign konstruktor, jadi ini pemeriksaan yang benar secara literal');
cek('PanelAuthError meng-assign name-nya',
  /this\.name = 'PanelAuthError'/.test(kode('src/lib/akunFirestore.ts')),
  'tanpa ini, name tidak pernah sama dan helper selalu mengembalikan 0');

cek('auto-login tidak mendekripsi password sendiri', !/decryptAppCredential/.test(src));
cek('auto-login tidak memanggil gateway sendiri', !/\brpcLogin\s*\(/.test(src));
cek('auto-login memakai endpoint server', /autoLoginServerPusat/.test(src));
cek('kode 402 dipetakan ke terkunci-perangkat',
  /kode === 402[\s\S]{0,120}terkunci-perangkat/.test(src));
cek('404 & 422 dipetakan ke belum-ada-kredensial',
  /kode === 404 \|\| kode === 422[\s\S]{0,120}belum-ada-kredensial/.test(src));
cek('kode 0 (jaringan) tidak dianggap sebagai penolakan',
  !/kode === 0[\s\S]{0,80}terkunci-perangkat/.test(src),
  'jaringan mati tidak boleh membuat orang mengira akunnya terkunci ke perangkat lain');

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
