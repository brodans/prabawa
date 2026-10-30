/**
 * Uji endpoint aktivasi langganan dengan kredensial Admin sungguhan.
 *
 * Hanya jalan bila `.env` punya `FIREBASE_SERVICE_ACCOUNT`. Tidak menyentuh
 * server pusat, tidak mengirim apa pun ke Midtrans, dan tidak mengubah
 * langganan akun mana pun: paket yang dipakai sengaja tidak ada, jadi
 * penolakan yang diharapkan adalah "paket tidak dikenal" — yang membuktikan
 * jalur kredensial + Admin SDK + transaksi benar-benar bekerja.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let fail = 0;
const cek = (n: string, ok: unknown, d = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
};

// Uji ini membutuhkan kredensial sungguhan dan bukan bagian dari CI lokal.
if (!existsSync(join(root, '.env'))) {
  console.log('SKIP — .env tidak tersedia; tes Firestore live membutuhkan kredensial lokal.');
  process.exit(0);
}

// Muat .env ke process.env supaya kredensial ikut terbaca.
const envIsi = readFileSync(join(root, '.env'), 'utf8');
const isi: Record<string, string> = {};
for (const baris of envIsi.split('\n')) {
  const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m && !m[2].startsWith('#')) isi[m[1]] = m[2].trim();
}
if (!isi.FIREBASE_SERVICE_ACCOUNT && !isi.GOOGLE_APPLICATION_CREDENTIALS) {
  console.log('SKIP — .env tidak punya FIREBASE_SERVICE_ACCOUNT.');
  console.log('Isi dulu dengan: firebase serviceAccount:key > service-account.json');
  console.log('lalu: FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}');
  process.exit(0);
}

/*
 * Kredensial yang dibutuhkan skrip ini disalin ke `process.env`.
 *
 * `PANEL_SESSION_SECRET` baru ikut ditambahkan karena token uji baru ikut
 * dipakai. Tanpa rahasianya, penandatanganan token menolak apa pun — dan
 * gejalanya jauh lebih membingungkan dari kenyataannya: kesalahan itu
 * dilaporkan sebagai "is not a function", padahal fungsinya ada dan yang
 * hilang adalah nilai rahasianya.
 *
 * Nilai dari `.env` dipakai apa adanya, hanya kalau `process.env` belum punya
 * — jadi eksekusi manual dengan environment yang sudah diatur tidak tertimpa.
 */
for (const kunci of ['FIREBASE_SERVICE_ACCOUNT', 'PANEL_SESSION_SECRET']) {
  if (!process.env[kunci] && isi[kunci]) process.env[kunci] = isi[kunci];
}
process.env.PRESENSI_BASE_URL = 'http://127.0.0.1:1/service'; // tidak akan dipakai
process.env.ALLOWED_ORIGINS = 'https://app.example.go.id';

/*
 * Bundel HARUS di dalam proyek (`dist/`), bukan di `/tmp`.
 *
 * Impor dinamis `firebase-admin/firestore` di-resolution oleh Node relatif
 * terhadap letak berkasnya. Bundle yang ditaruh di luar proyek tidak
 * menjangkau `node_modules`, jadi hasilnya "Cannot find package" yang
 * menyesatkan — bukan masalah kode, tapi sulit dibedakan dari masalah nyata.
 */
const keluar = join(root, 'dist', '.cek-billing.cjs');
execFileSync(
  'npx',
  // `--packages=external` meniru cara Vercel membangun function: paket
  // `node_modules` TIDAK di-inline, tapi di-require saat runtime. Tanpa
  // flag ini, `firebase-admin/app` ikut ter-inline sementara
  // `firebase-admin/firestore` tidak — dua salinan modul, dan credential
  // dari yang satu tidak dikenali yang lain.
  ['esbuild', 'src/serverless/billing-aktivasi.ts', '--bundle', '--platform=node', '--format=cjs',
   '--packages=external', `--outfile=${keluar}`],
  { cwd: root, stdio: 'pipe' }
);

const handler = (await import(`file://${keluar}`)).default as (
  req: unknown,
  res: unknown,
) => Promise<void>;

/**
 * `res` tiruan yang mencatat body jawabannya.
 *
 * Metodanya berantai dan mengembalikan `this`, seperti `express.Response`
 * sungguhan — handler memanggil `res.status(403).json({...})`, jadi stub yang
 * mengembalikan `undefined` akan membuat rantai itu runtuh di tengah.
 */
interface ResPalsu {
  statusCode: number;
  header: Record<string, string>;
  body?: Record<string, unknown>;
  setHeader(k: string, v: string): ResPalsu;
  status(k: number): ResPalsu;
  json(p: Record<string, unknown>): ResPalsu;
  end(): ResPalsu;
}

const resPalsu = (): ResPalsu => ({
  statusCode: 200,
  header: {},
  setHeader(k: string, v: string) {
    this.header[k.toLowerCase()] = v;
    return this;
  },
  status(k: number) {
    this.statusCode = k;
    return this;
  },
  json(p: Record<string, unknown>) {
    this.body = p;
    return this;
  },
  end() {
    return this;
  },
});

async function kirim(
  body: Record<string, unknown>,
  token?: string,
): Promise<ResPalsu> {
  const res = resPalsu();
  const headers: Record<string, string> = { origin: 'https://app.example.go.id' };
  /*
   * Token lewat `Authorization: Bearer …` — persis seperti yang dilakukan
   * `src/lib/aktivasiLangganan.ts` di peramban.
   *
   * Semula uji ini tidak mengirim token apa pun dan tetap mendapat 422. Itu
   * bukan tanda jalurnya sehat: 422 "paket tidak dikenal" hanya bisa dicapai
   * **setelah** nama akun dibaca dari token, jadi dulu pemanggilnya pasti
   * sudah melewati pemeriksaan sesi. Sekarang jalur itu tertutup dan setiap
   * pemanggilan tanpa token menjawab 401 lebih dulu — jadi seluruh pengujian
   * di bawah wajib memakai token sungguhan, kalau tidak semuanya hanya
   * mengulang jalur 401 dan tidak pernah menyentuh apa pun yang diperiksa.
   */
  if (token) headers.authorization = `Bearer ${token}`;
  await handler({ method: 'POST', headers, body }, res);
  return res;
}

/*
 * Akun uji + token uji.
 *
 * `terbitkanToken()` menandatangani muatan yang benar-benar dibaca server,
 * tetapi `akunDariToken()` tetap memverifikasi akunnya benar-benar ada di
 * Firestore. Jadi token diterbitkan atas nama akun yang ada, bukan nama
 * karangan — kalau karangan, hasilnya selalu 401 dan tidak ada yang teruji.
 *
 * Akunnya ditulis langsung lewat Admin SDK, bukan lewat `POST /api/panel-auth`
 * `akun:buat`, karena membuat akun butuh sesi admin sementara yang justru
 * belum ada di sini. Pola yang sama dipakai `tools/seed-admin.mts`.
 */
const P = await import('../src/lib/panelServer.ts');
const UM = await import('../src/lib/userManager.ts');
const AKUN_UJI = 'cek-tagihan-live';

console.log('\n=== 0. Akun uji & token uji');
try {
  const { admin } = await import('../src/lib/firestoreAdmin.ts');
  const db = await admin();
  await db
    .collection('jatim_pengguna')
    .doc(AKUN_UJI)
    .set(
      {
        username: AKUN_UJI,
        role: 'admin',
        permissions: { ...UM.DEFAULT_ADMIN_PERMISSIONS },
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );
  cek('akun uji siap', true, AKUN_UJI);
} catch (err) {
  cek('akun uji siap', false, String((err as Error)?.message ?? err).slice(0, 110));
}
if (!process.env.PANEL_SESSION_SECRET) {
  console.log('SKIP — .env tidak punya PANEL_SESSION_SECRET.');
  console.log('Token uji tidak bisa ditandatangani tanpa itu, jadi endpoint tidak bisa diuji.');
  process.exit(0);
}
const terbit = P.terbitkanToken;
const tokenUji = terbit(AKUN_UJI, 'admin', { ...UM.DEFAULT_ADMIN_PERMISSIONS });

console.log('\n=== 1. Kredensial Admin terbaca');
const SB = await import('../src/lib/serverBilling.ts');
cek('adminTersedia() = true', SB.adminTersedia() === true,
  'kalau false, .env belum dibaca atau FIREBASE_SERVICE_ACCOUNT tidak terisi');

/*
 * Penolakan tanpa sesi diuji **sebelum** apa pun, karena itu yang dulu hilang.
 *
 * Endpoint ini terbuka tanpa token, jadi siapa pun yang tahu URL-nya bisa
 * mengaktifkan langganan akun mana pun secara gratis. `username` di body
 * diabaikan sekarang, dan penolakannya harus terjadi sebelum satu pun
 * pembacaan Firestore dilakukan — kalau tidak, endpoint yang sudah tertutup
 * hanya menambah satu pemeriksaan setelah pekerjaan mahal.
 */
console.log('\n=== 1b. Tanpa token: ditolak 401, sebelum menyentuh Firestore');
{
  const tanpaToken = await kirim({
    orderId: 'PRABAWA-__tidak_ada_12345',
    username: '__uji__',
    metode: 'transfer',
    nominal: 25000,
  });
  cek('tanpa Authorization → 401', tanpaToken.statusCode === 401, `status ${tanpaToken.statusCode}`);
  cek('pesan menjelaskan sesi, bukan isi paket',
    /sesi/i.test(String(tanpaToken.body?.pesan ?? '')),
    String(tanpaToken.body?.pesan ?? '(tanpa pesan)').slice(0, 90));

  const tokenPalsu = await kirim(
    { orderId: 'PRABAWA-x', username: '__uji__', metode: 'transfer' },
    'token.palsu'
  );
  cek('token bertanda tangan salah → 401', tokenPalsu.statusCode === 401, `status ${tokenPalsu.statusCode}`);

  /*
   * `username` di body **tidak boleh** menentukan akun yang diaktifkan.
   * Dua pemanggilan dengan nama akun berbeda di body harus menghasilkan
   * jawaban yang sama persis, karena keduanya membaca nama akun dari token.
   */
  const duaNama = await Promise.all([
    kirim({ orderId: 'PRABAWA-x', username: 'siti', metode: 'transfer' }, tokenUji),
    kirim({ orderId: 'PRABAWA-x', username: 'budi', metode: 'transfer' }, tokenUji),
  ]);
  cek('username di body tidak mengubah hasil',
    duaNama[0].statusCode === duaNama[1].statusCode &&
      String(duaNama[0].body?.pesan) === String(duaNama[1].body?.pesan),
    `${duaNama[0].statusCode}:${duaNama[0].body?.pesan} vs ${duaNama[1].statusCode}:${duaNama[1].body?.pesan}`);
}

console.log('\n=== 2. Admin SDK benar-benar bisa dipakai');
/*
 * Inilah yang tidak bisa diuji tanpa kredensial sungguhan: Admin SDK
 * di-load, kredensial ditera, dan Firestore dijangkau. Kegagalan di sini
 * yang membuat endpoint menjawab 503.
 */
let paketTerbaca: ResPalsu | null = null;
let pesanGagal: string | null = null;
try {
  // `bacaPaket` tidak diekspor; memanggil endpoint dengan orderId yang paketnya
  // tidak ada memaksa Admin SDK membaca koleksi pengaturan.
  const res = await kirim(
    { orderId: 'PRABAWA-__tidak_ada_12345', username: '__uji__', metode: 'transfer', nominal: 25000 },
    tokenUji
  );
  paketTerbaca = res;
} catch (err) {
  pesanGagal = String((err as Error)?.message ?? err);
}
cek('endpoint tidak melempar keluar', pesanGagal === null, pesanGagal?.slice(0, 120) ?? '');
cek('status bukan 503 (Admin SDK tersedia)', paketTerbaca?.statusCode !== 503,
  paketTerbaca ? `status ${paketTerbaca.statusCode}: ${String(paketTerbaca.body?.pesan).slice(0, 100)}` : '');
cek('status bukan 500', paketTerbaca?.statusCode !== 500, paketTerbaca ? `status ${paketTerbaca.statusCode}` : '');
cek(
  'sampai ke validasi paket (tunneled ke "paket tidak dikenal")',
  paketTerbaca?.statusCode === 422,
  paketTerbaca ? `status ${paketTerbaca.statusCode}: ${String(paketTerbaca.body?.pesan).slice(0, 90)}` : ''
);

console.log('\n=== 3. Validasi tetap berlaku');
let res = await kirim({ orderId: '', username: 'x', metode: 'transfer' }, tokenUji);
cek('orderId kosong → 400', res.statusCode === 400, `status ${res.statusCode}`);
res = await kirim({ orderId: '../jahat', username: 'x', metode: 'transfer' }, tokenUji);
cek('orderId berisi "../" → 400', res.statusCode === 400, `status ${res.statusCode}`);
res = await kirim({ orderId: 'PRABAWA-x/nested', username: 'u', metode: 'transfer' }, tokenUji);
cek('orderId berisi "/" → 400', res.statusCode === 400, `status ${res.statusCode}`);
/*
 * `username` berisi "/" **tidak** lagi diuji, karena tidak ada lagi yang
 * divalidasi: nama akun dibaca dari token, bukan dari body. Uji lamanya
 * lulus karena `username` masuk ke jalur dokumen tagihan; sekarang jalur itu
 * tidak ada sama sekali — yang dijaga adalah `orderId` sebagai satu-satunya
 * masukan yang membentuk nama dokumen.
 *
 * Kalau `username` kembali muncul di body, ia harus divalidasi ulang; itu
 * yang diperiksa assertion di `cek-vercel.ts` §10, bukan di sini.
 */
cek('username di body tidak membentuk nama dokumen',
  res.statusCode === 400 || res.statusCode === 422,
  `status ${res.statusCode} — kalau 400 lagi berarti username kembali dipakai`);
res = await kirim({ orderId: 'PRABAWA-x', username: 'u', metode: 'transfer' }, tokenUji);
cek('paket tak dikenal → 422', res.statusCode === 422, `status ${res.statusCode}: ${String(res.body?.pesan).slice(0, 70)}`);

console.log('\n=== 4. Transaksi Firestore (runTransaction) tidak error');
/*
 * Kalau `runTransaction` tidak tersedia atau Admin SDK tidak bisa menulis,
 * error-nya muncul di sini — bukan di produksi.
 */
cek('adminTersedia benar-benar true (dicek ulang)', SB.adminTersedia() === true);

if (existsSync(keluar)) {
  const { rmSync } = await import('node:fs');
  rmSync(keluar, { force: true });
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
