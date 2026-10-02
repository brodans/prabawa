/**
 * Kontrak server — diverifikasi, bukan sekadar dikomentari.
 *
 * `presensiContract.ts` dan `encryption.ts` menyimpan konstanta dan fungsi
 * yang menjawab pertanyaan "kenapa kodenya begini?". Semuanya diturunkan dari
 * APK asli dan dari balasan server, dan tidak satu pun dipanggil di jalur
 * runtime saat ini.
 *
 * ## Kenapa tidak dianggap dead code
 *
 * Ekspor yang tidak pernah diimpor tetap punya nilai kalau isinya adalah
 * **dokumentasi yang bisa diverifikasi**. Kalau suatu saat server menolak
 * `version: 78/80` atau `sign` berubah, orang pertama yang perlu tahu adalah
 * siapa pun yang sedang menyelidiki — dan jawabannya harus ada di repo, bukan
 * di ingatan orang yang menulisnya dulu.
 *
 * Skrip ini yang membuat ekspor itu hidup: nilainya diuji, jadi kalau ada yang
 * mengeditnya tanpa sengaja, skrip gagal. Itu lebih baik daripada menghapus,
 * dan jauh lebih baik daripada membiarkan tak teruji.
 *
 * Kalau suatu saat memang tidak relevan, hapus **dari sini juga** — jangan
 * hanya dari modul, karena pemeriksaan yang sudah tidak menguji apa pun adalah
 * pemeriksaan yang tidak menjalankan diri sendiri.
 */
let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const C = await import('../src/lib/presensiContract.ts');

// ═════════════════════════════════════════════════════════════════════
console.log('=== 1. Gate versi');
cek('PRESENSI_VERSION = 89 (dipakai gateway)', C.PRESENSI_VERSION === 89, String(C.PRESENSI_VERSION));
cek('APK_VERSION_CODE_versionCode APK', C.APK_VERSION_CODE === 89, String(C.APK_VERSION_CODE));
cek('nama versi tercatat', typeof C.PRESENSI_VERSION_NAME === 'string' && C.PRESENSI_VERSION_NAME.length > 0, C.PRESENSI_VERSION_NAME);
// Gerbang ini ditemukan dari balasan server, bukan dari dokumentasi. Angka
// yang berubah di sini tanpa menguji respons server = Versi dikirim salah.
cek('versi minimum 81', C.VERSION_GATE.MIN_VERSION === 81, String(C.VERSION_GATE.MIN_VERSION));
cek('versi 89 lolos gerbang minimum', C.PRESENSI_VERSION >= C.VERSION_GATE.MIN_VERSION);
cek('78/80 termasuk yang diblokir', C.PRESENSI_VERSION > 80, 'versi saat ini bukan yang diblokir');
cek('tiga object diblokir saat versi basi', C.VERSION_GATE.BLOCKED_OBJECTS.length === 3, C.VERSION_GATE.BLOCKED_OBJECTS.join(', '));
cek('pesan basi tercatat', /terbaru telah tersedia/.test(C.VERSION_GATE.STALE_MESSAGE));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Param yang disuntik klien ke tiap request');
cek('tiga kunci wajib ada', C.INJECTED_PARAM_KEYS.length === 3, C.INJECTED_PARAM_KEYS.join(', '));
cek('api_key disuntik', C.INJECTED_PARAM_KEYS.includes('api_key'));
cek('last_latlong disuntik', C.INJECTED_PARAM_KEYS.includes('last_latlong'));
cek('imei disuntik', C.INJECTED_PARAM_KEYS.includes('imei'));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Envelope JSON-RPC');
/*
 * `jsonrpc` dan `method` punya bentuk yang tidak seperti JSON-RPC biasa:
 * `jsonrpc` berupa **angka** `2` (bukan string "2.0") dan `method` selalu
 * `POST`. Itu memang bentuk yang dibaca gateway — dan bentuk itulah yang
 * diuji di sini, bukan versi normatif JSON-RPC yang biasa kita kira.
 */
const env = C.buildRpcEnvelope('absen', { param: { absen: true, cek: false } });
cek('jsonrpc berupa angka 2', env.jsonrpc === 2, String(env.jsonrpc));
cek('method tetap POST', env.method === 'POST', String(env.method));
cek('object punya field sendiri', env.object === 'absen', String(env.object));
cek('version ikut', env.version === C.PRESENSI_VERSION, String(env.version));
cek('param diteruskan utuh', env.param?.param?.absen === true);
cek('kunci param wajib absen lengkap', C.RPC_REQUIRED_PARAMS.absen.length === 6, `${C.RPC_REQUIRED_PARAMS.absen.length} kunci`);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Kode error & gerbang server');
cek('GATE_NIP_SALAH = 401', C.GATE_NIP_SALAH === 401, String(C.GATE_NIP_SALAH));
cek('GATE_PERANGKAH_TERIKAT', C.GATE_PERANGKAH_TERIKAT === 402, String(C.GATE_PERANGKAH_TERIKAT));
cek('GATE_OBJECT_TIDAK_ADA', C.GATE_OBJECT_TIDAK_ADA === -32601, String(C.GATE_OBJECT_TIDAK_ADA));
cek('GATE_PARAM_SALAH', C.GATE_PARAM_SALAH === -32602, String(C.GATE_PARAM_SALAH));
cek('RPC_ERROR_CODES bertipe objek', C.RPC_ERROR_CODES && typeof C.RPC_ERROR_CODES === 'object');
cek('RPC_ERROR_CODES punya isi', Object.keys(C.RPC_ERROR_CODES ?? {}).length > 0, `${Object.keys(C.RPC_ERROR_CODES ?? {}).length} kode`);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Daftar object RPC (hasil delta-debugging)');
cek('16 object terverifikasi', C.RPC_OBJECTS && Object.keys(C.RPC_OBJECTS).length === 16, `${Object.keys(C.RPC_OBJECTS ?? {}).length} object`);
cek('object inti ada', Boolean(C.RPC_OBJECTS?.ABSEN && C.RPC_OBJECTS?.CEK_ABSEN && C.RPC_OBJECTS?.ADD_IJIN), 'kunci screaming snake_case');
cek('daftar legacy terpisah', Array.isArray(C.RPC_OBJECTS_LEGACY) && C.RPC_OBJECTS_LEGACY.length > 0);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6.Timeout absen');
cek('default 5 menit', C.DEFAULT_ABSEN_TIMEOUT_MS === 300_000, `${C.DEFAULT_ABSEN_TIMEOUT_MS} ms`);
cek('absenTimeoutMs(null) jatuh ke default', C.absenTimeoutMs(null) === C.DEFAULT_ABSEN_TIMEOUT_MS);
// `0` dianggap "tidak diisi" dan jatuh ke default — bukan timeout nol.
cek('absenTimeoutMs(0) jatuh ke default', C.absenTimeoutMs({ absen_timeout: 0 }) === C.DEFAULT_ABSEN_TIMEOUT_MS, String(C.absenTimeoutMs({ absen_timeout: 0 })));
cek('absenTimeoutMs("60000") dipakai apa adanya', C.absenTimeoutMs({ absen_timeout: '60000' }) === 60000, 'string numerik diterima');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Kriptografi sisi klien — tidak boleh ada sama sekali');
/*
 * Modul `lib/encryption.ts` **dihapus** beserta seluruh isinya.
 *
 * Yang pernah ada di sana, dan kenapa tidak bisa kembali:
 *
 * 1. `encryptPayload` / `decryptPayload` (format `ENC$…$SEC`) +
 *    `PAYLOAD_ENCRYPTION_KEY` — tidak pernah dipanggil, kuncinya tidak pernah
 *    diisi. Codec yang tidak pernah dieksekusi tidak pernah diuji.
 * 2. `encryptAppCredential` — `CryptoJS.AES.encrypt(plain, VITE_APP_SECRET)`.
 *    Kuncinya ada di `import.meta.env`, yang Vite suntikkan ke bundle
 *    peramban, jadi ciphertext-nya bisa dibuka siapa pun yang punya
 *    ciphertext-nya.
 * 3. `decryptAppCredential` — pembaca dokumen lama `v1`. Server punya
 *    `verifikasiLegacyPin()` sendiri, jadi peramban tidak perlu membacanya.
 * 4. `decryptPanelCredential` — validator bentuk `v2`. Bentuk `v2` hanya
 *    dihasilkan server dan hanya server yang membacanya; tidak ada satu pun
 *    bentuk respons yang mengirimkannya ke peramban.
 *
 * Semuanya bisa hilang karena satu hal: password server pusat tidak pernah
 * lagi melewati peramban. `POST /api/panel-auth` aksi `pusat:login` mendekripsi
 * dan memanggil gateway, dan yang kembali ke peramban hanya `api_key` — yang
 * memang selalu ada di sana, itu nature dari sesi gateway.
 *
 * Yang menggantikannya ada di `lib/pin.ts` (bcrypt, dipakai **server**) dan
 * `lib/panelServer.ts` (AES-256-GCM dari `PANEL_SESSION_SECRET`).
 *
 * Pemeriksaan di bawah menjaga dua hal: tidak ada kode yang memanggil fungsi
 * enkripsi kredensial, dan `crypto-js` tidak masuk jalur muat awal.
 */
function kumpulkanSrc(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p2 = join(dir, ent.name);
    if (ent.isDirectory()) kumpulkanSrc(p2, out);
    else if (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx')) out.push(p2);
  }
  return out;
}
const semuaSrc = kumpulkanSrc(join(root, 'src'));

// Komentar dibuang dulu: JSDOC sengaja menyebut nama fungsi yang sudah
// dihapus, jadi pola naif akan ikut mencocokinya.
const tanpaKomentar = f =>
  readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

cek('modul encryption.ts sudah tidak ada',
  !semuaSrc.some(f => f.endsWith(join('lib', 'encryption.ts'))),
  'kuncinya ada di bundle — tidak boleh ada di peramban');

const pemanggilKredensial = semuaSrc.filter(f =>
  /\b(encryptAppCredential|decryptAppCredential|encryptPayload|decryptPayload)\s*\(/.test(tanpaKomentar(f))
);
cek('tidak ada kode yang memanggil fungsi enkripsi kredensial',
  pemanggilKredensial.length === 0,
  pemanggilKredensial.map(f => f.replace(`${root}/`, '')).join(', '));

const pemanggilCrypto = semuaSrc.filter(f => /from 'crypto-js'/.test(tanpaKomentar(f)));
cek('crypto-js hanya dipakai di server (lib/pin.ts)',
  pemanggilCrypto.length > 0 &&
    pemanggilCrypto.every(f => f.endsWith(join('lib', 'pin.ts'))),
  pemanggilCrypto.map(f => f.replace(`${root}/`, '')).join(', '));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 8. Konstanta dari APK yang dipakai vs dihapus');
cek('IMPORTFILE_FIELDS lengkap', Boolean(C.IMPORTFILE_FIELDS), Object.keys(C.IMPORTFILE_FIELDS ?? {}).join(', '));
cek('TIPE_IJIN_LABEL punya isi', Object.keys(C.TIPE_IJIN_LABEL ?? {}).length > 0);
cek('ABSEN_CHECK_TYPE punya isi', Object.keys(C.ABSEN_CHECK_TYPE ?? {}).length > 0);
cek('LOGIN_MODUL_KEYS 4 modul', C.LOGIN_MODUL_KEYS.length === 4, C.LOGIN_MODUL_KEYS.join(', '));
cek('modulAktif ikut modul aktif', C.modulAktif({ presensi: 1 }, 'presensi') === true);
cek('modulAktif menolak modul mati', C.modulAktif({ presensi: 0 }, 'presensi') === false);

/*
 * Kode status izin sekarang bernama (`IJIN_STATUS_KODE`) dan dipakai
 * `viewModels.toIjinView()` — sebelumnya angka 1 dan 3 ditulis langsung di
 * sana, terpisah dari peta label di modul kontrak.
 */
cek('kode status izin bernama', C.IJIN_STATUS_KODE.DISETUJUI === 1 && C.IJIN_STATUS_KODE.MENUNGGU === 2 && C.IJIN_STATUS_KODE.DITOLAK === 3,
  JSON.stringify(C.IJIN_STATUS_KODE));
const vmSrc = readFileSync(new URL('../src/lib/viewModels.ts', import.meta.url), 'utf8');
cek('toIjinView memakai kode bernama, bukan angka telanjang',
  vmSrc.includes('IJIN_STATUS_KODE.DISETUJUI') && vmSrc.includes('IJIN_STATUS_KODE.DITOLAK') &&
  !/statusRaw === [0-9]/.test(vmSrc),
  'angka mentah di sini kembali berarti pemetaan bisa melenceng diam-diam');

/*
 * `CONSTANTS` / `EXTRA_KEYS` (nama key SharedPreferences dari APK) dan
 * `IJIN_STATUS_LABEL` dihapus: tidak ada pemanggilnya. Konstanya tetap ada
 * berarti terlihat "dipakai" padahal tidak, dan bisa berbeda dari
 * kenyataan tanpa ada yang salah.
 */
cek('CONSTANTS sudah tidak ada', typeof C.CONSTANTS === 'undefined');
cek('EXTRA_KEYS sudah tidak ada', typeof C.EXTRA_KEYS === 'undefined');
cek('IJIN_STATUS_LABEL sudah tidak ada (label ada di toIjinView)', typeof C.IJIN_STATUS_LABEL === 'undefined');

// Versi: `PRESENSI_VERSION` diturunkan dari `APK_VERSION_CODE`, jadi tidak
// ada dua konstanta dengan angka 89 yang bisa berbeda.
cek('PRESENSI_VERSION diturunkan dari APK_VERSION_CODE', C.PRESENSI_VERSION === C.APK_VERSION_CODE);
cek('APK_VERSION_CODE = 89', C.APK_VERSION_CODE === 89, String(C.APK_VERSION_CODE));

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
