/**
 * Uji autentikasi & otorisasi panel — **menolak** apa yang tidak boleh terjadi.
 *
 * Ini skrip yang paling menentukan di proyek ini. Yang diuji bukan "fitur
 * berjalan", tapi **eskalasi peran tidak mungkin** — termasuk yang lewat
 * DevTools.
 *
 * ## Yang menguji bug yang dilaporkan
 *
 * "Saya login sebagai user, terus refresh malah jadi admin."
 *
 * Akar masalahnya bukan di komponen React: `firestore.rules` pernah
 * mengizinkan `allow read, write: if true` pada `jatim_pengguna`, dan peran
 * dibaca peramban saat login. `setDoc({ role: 'admin' })` pada dokumen sendiri
 * sudah cukup.
 *
 * Yang diuji di sini:
 *
 * 1. **Token tidak bisa dipalsukan.** Menubah `role`/`sub` di payload, mengganti
 *    tanda tangannya, memakai `PANEL_SESSION_SECRET` lain, atau kedaluwarsa —
 *    semuanya ditolak.
 * 2. **Peran selalu dibaca ulang dari dokumen.** Admin yang diturunkan di
 *    Firestore langsung kehilangan haknya di verifikasi berikutnya, meskipun
 *    tokennya masih valid.
 * 3. **Non-admin tidak bisa memanggil aksi admin.** Diuji dengan token user
 *    sungguhan, bukan dengan mengosongkan header.
 * 4. **`adminUsername` kosong tidak lagi berarti "username apa pun".** Ini
 *    bug `storedAdmin ? … : true` yang memberi admin penuh ke siapa pun yang
 *    tahu password admin.
 * 5. **`nonaktif` ditegakkan.** Akun yang dinonaktifkan admin tidak bisa login
 *    dan tidak bisa memakai token lamanya.
 * 6. **Rahasia wajib ada.** Tanpa `PANEL_SESSION_SECRET` endpoint menolak
 *    dengan 503, bukan memakai nilai bawaan yang bisa ditebak.
 *
 * ## Kenapa memakai instance Express sungguhan
 *
 * Handler yang diuji adalah `src/serverless/_panel.ts` yang sama dengan yang
 * dipakai Vercel. Memanggilnya lewat HTTP sungguhan memastikan allow-list
 * origin, parsing body, dan pemetaan kode status ikut teruji — bukan hanya
 * logikanya.
 *
 * Firestore diganti `firebase-admin` tiruan, jadi skrip ini jalan tanpa
 * kredensial dan tanpa jaringan.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// Dipakai untuk membuat ciphertext `pinEncrypted` yang **sungguhan** format
// OpenSSL "Salted__" pada uji kompatibilitas admin — bukan string karangan.
// Tanpa itu, uji hanya membandingkan kode terhadap dirinya sendiri.
import CryptoJS from 'crypto-js';

const root = new URL('..', import.meta.url).pathname;

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

// ── Environment variable server ─────────────────────────────────────
const SECRET = 'rahasia-uji-yang-panjang-sekali-1234567890';
process.env.PANEL_SESSION_SECRET = SECRET;
process.env.ALLOWED_ORIGINS = 'https://panel.example.go.id';
process.env.NODE_ENV = 'test';

/*
 * Firestore tiruan.
 *
 * Isinya persis bentuk dokumen yang dipakai produksi. Firestore tiruan ini
 * yang membuat bagian-bagian penting bisa diuji tanpa jaringan dan tanpa
 * kredensial nyata:
 *
 * - peran dibaca ulang dari dokumen (bukan dari token);
 * - admin yang diturunkan langsung kehilangan haknya;
 * - akun `nonaktif` ditolak saat login **dan** saat verifikasi token.
 *
 * Yang TIDAK diuji di sini: `bcrypt.compare` sungguhan, rate limit, dan
 * penulisan Admin SDK. Semuanya butuh kredensial nyata.
 */
const dokumen = new Map<string, Record<string, unknown>>();
const KUNCI = {
  pengguna: (u: string): string => `jatim_pengguna/${u}`,
  pengaturan: (d: string): string => `jatim_pengaturan/${d}`,
};

const adminDoc = {
  adminUsername: 'admin',
  // bcrypt("rahasia-admin") — hash palsu, hanya perlu non-kosong untuk lolos
  // pemeriksaan "apakah field ini ada".
  pinHash: '$2a$10$abcdefghijklmnopqrstuv',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** Seed dokumen uji. `passwordHash` di sini tidak pernah diverifikasi sungguhan. */
function seed() {
  dokumen.clear();
  dokumen.set(KUNCI.pengaturan('auth'), adminDoc);
  dokumen.set(KUNCI.pengguna('budi'), {
    username: 'budi',
    // bcrypt("rahasia-budi")
    passwordHash: '$2a$10$uvwxyzabcdefghijklmnopq',
    role: 'user',
    permissions: { tabBeranda: true, tabPresensi: true, tabLaporan: false },
    namaLengkap: 'Budi Santoso',
    createdAt: '2026-01-02T00:00:00.000Z',
  });
  dokumen.set(KUNCI.pengguna('siti'), {
    username: 'siti',
    passwordHash: '$2a$10$qrstuvwxyzabcdefghijk',
    role: 'admin',
    permissions: {},
    namaLengkap: 'Siti Aminah',
    createdAt: '2026-01-03T00:00:00.000Z',
  });
  dokumen.set(KUNCI.pengguna('nonaktif'), {
    username: 'nonaktif',
    passwordHash: '$2a$10$klmnopqrstuvwxyzabcde',
    role: 'user',
    nonaktif: true,
    permissions: {},
    namaLengkap: 'Akun Mati',
    createdAt: '2026-01-04T00:00:00.000Z',
  });
  // Kredensial server pusat. `passwordEncrypted` di sini **tidak** ciphertext v2
  // yang sah — hanya nilai yang bukan string kosong, karena uji ini tidak
  // memanggil dekripsi. Yang diuji adalah siapa yang boleh Membaca dokumennya.
  dokumen.set(KUNCI.pengaturan('kredensial_server__budi'), {
    nip: '200308062025101001',
    passwordEncrypted: 'v2.stub.stub.stub',
    imei: 'IMEI-BUDI',
    updatedAt: '2026-02-01T00:00:00.000Z',
  });
  // Format lama (`v1`): tidak bisa dibuka server tanpa `VITE_APP_SECRET`.
  dokumen.set(KUNCI.pengaturan('kredensial_server__siti'), {
    nip: '197001012000011001',
    passwordEncrypted: 'U2FsdGVkX1legacy',
    imei: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

function Collection(koleksi: string): any {
  return {
    doc(id: string) {
      return {
        id,
        koleksi,
        get: async () => {
          const data = dokumen.get(`${koleksi}/${id}`);
          return data
            ? { exists: true, id, data: () => data, ref: { update: async () => {} } }
            : { exists: false, id, data: () => undefined, ref: { update: async () => {} } };
        },
        set: async (data: Record<string, unknown>, opsi?: { merge?: boolean }) => {
          const key = `${koleksi}/${id}`;
          const lama = opsi?.merge ? (dokumen.get(key) ?? {}) : {};
          dokumen.set(key, { ...lama, ...data });
        },
        delete: async () => {
          dokumen.delete(`${koleksi}/${id}`);
        },
      };
    },
    get: async () => {
      const prefix = `${koleksi}/`;
      return {
        docs: [...dokumen.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data })),
      };
    },
    /*
     * `where()` — hanya `where('field', '==', nilai)` yang dipakai kode
     * produksi (`bacaTagihanSaya`). Operator lain sengaja tidak didukung:
     * kalau kode memakai yang tidak ada, harus gagal di sini juga, bukan
     * lolos karena tiruan mengabaikannya.
     *
     * ⚠️ `limit()` di-chain di atas `where()`, jadi filter **harus** dijalankan
     * lebih dulu. Firestore asli menegakkan urutan itu; tiruan yang salah
     * urutan akan membuat `where('username','==','budi').limit(3)` mengembalikan
     * tagihan orang lain — dan uji ini justru akan salah menyatakan aman.
     */
    where(field: string, operator: string, nilai: unknown) {
      if (operator !== '==') {
        throw new Error(`Tiruan tidak mendukung operator "${operator}" — tambahkan bila dipakai.`);
      }
      const prefix = `${koleksi}/`;
      const semua = () =>
        [...dokumen.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data }));
      // Filter dulu, baru potong — sama seperti Firestore.
      const tersaring = () => semua().filter(doc => doc.data()[field] === nilai);
      return {
        limit: (jumlah: number) => ({ get: async () => ({ docs: tersaring().slice(0, jumlah) }) }),
        get: async () => ({ docs: tersaring() }),
      };
    },
    limit: (jumlah: number) => ({
      get: async () => {
        const prefix = `${koleksi}/`;
        return {
          docs: [...dokumen.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data }))
            .slice(0, jumlah),
        };
      },
    }),
  };
}

/*
 * `getAll()` — batch read yang dipakai `ringkasSemuaKredensial()`.
 *
 * Firestore asli membatasinya 300 dokumen per panggilan; tiruan ini tidak
 * perlu, tapi batasnya ikut dijaga supaya uji tidak lulus untuk kode yang
 * akan gagal di produksi.
 */
async function getAll(...refs: Array<{ id: string }>): Promise<unknown[]> {
  return refs.map(ref => {
    const id = ref.id;
    const data = dokumen.get(`jatim_pengaturan/${id}`);
    return {
      exists: Boolean(data),
      id,
      data: () => data,
      ref: { update: async () => {} },
    };
  });
}

const firestoreTiruan = {
  collection: Collection,
  getAll,
  batch() {
    const writes: Array<
      | { kind: 'set'; ref: { koleksi: string; id: string }; data: Record<string, unknown>; merge: boolean }
      | { kind: 'delete'; ref: { koleksi: string; id: string } }
    > = [];
    return {
      set(ref: { koleksi: string; id: string }, data: Record<string, unknown>, opsi?: { merge?: boolean }) {
        writes.push({ kind: 'set', ref, data, merge: Boolean(opsi?.merge) });
        return this;
      },
      delete(ref: { koleksi: string; id: string }) {
        writes.push({ kind: 'delete', ref });
        return this;
      },
      async commit() {
        for (const write of writes) {
          const key = `${write.ref.koleksi}/${write.ref.id}`;
          if (write.kind === 'delete') {
            dokumen.delete(key);
          } else {
            const lama = write.merge ? (dokumen.get(key) ?? {}) : {};
            dokumen.set(key, { ...lama, ...write.data });
          }
        }
      },
    };
  },
} as unknown as Parameters<
  typeof adminModulLater['__setFirestoreTiruan']
>[0];

const adminModulLater = await import('../src/lib/firestoreAdmin.ts');
const UM = await import('../src/lib/userManager.ts');
import type { TabPermissions } from '../src/lib/userManager';
adminModulLater.__setFirestoreTiruan(firestoreTiruan);

console.log('=== 1. Token sesi: dasar kriptografinya');

// Impor dinamis setelah env diisi — `panelServer` membaca `process.env` saat
// token ditandatangani, bukan saat modul diimpor, tapi urutan ini tetap lebih
// aman untuk dibaca.
const P = await import('../src/lib/panelServer.ts');
// `serverBilling` diimpor di sini juga: fungsi pembacanya adalah pengganti
// pembacaan langsung dari peramban yang ditutup di `firestore.rules`.
const B = await import('../src/lib/serverBilling.ts');

/*
 * ⚠️ `panelServer` harus memakai `Buffer` dari `node:buffer`, bukan global.
 *
 * `Buffer` tidak diimpor di berkas itu, jadi `tsc` menyelesaikannya ke interface
 * `Buffer` bawaan DOM — yang bentuknya hanya interface, bukan konstruktor. Di
 * balik `tsx` (ESM), `Buffer.from('x')` lalu menjadi `[object Object]`, dan
 * `concat` melempar:
 *
 * ```
 * The first argument must be of type string or an instance of Buffer,
 * ArrayBuffer, or Array or an Array-like Object. Received an instance of Object
 * ```
 *
 * `tsc` tidak memberi tahu apa pun, karena `Buffer.from` memang bertipe
 * mengembalikan `Buffer`.
 *
 * Yang membuat bug ini bertahan: `bacaToken()` di berkas yang sama memakai
 * `Buffer` global dan **berhasil**, jadi ada "bukti" yang meyakinkan. Bukti itu
 * salah — ia hanya berhasil karena jalur eksekusinya berbeda.
 */
cek('panelServer mengimpor Buffer dari node:buffer',
  /import\s*\{[^}]*Buffer as NodeBuffer[^}]*\}\s*from\s*'node:buffer'/.test(
    readFileSync(new URL('../src/lib/panelServer.ts', import.meta.url), 'utf8')
  ),
  'Buffer global bisa jadi proxy tanpa prototipe Uint8Array');
{
  // Komentar dibuang dulu: catatan panjang di atas sengaja menyebut
  // `Buffer.from` untuk menjelaskan jebakannya, dan pola naif akan ikut
  // mencocokkannya.
  const isi = readFileSync(new URL('../src/lib/panelServer.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/NodeBuffer/g, '');
  cek('tidak ada pemakaian `Buffer` global yang tersisa di panelServer',
    !/(?<![\w.])Buffer\s*[.[]/.test(isi),
    'campuran NodeBuffer dan Buffer global = perilakunya bergantung urutan import');
}

const izinUser = { ...UM.DEFAULT_ADMIN_PERMISSIONS };

/**
 * Izin/token untuk kasus uji.
 *
 * `terbitkanToken()` menerima `TabPermissions` lengkap, tapi yang diuji di
 * sini justru peran dan nama akun — bukan isi izin. Izin di token sudah
 * tidak dipercaya sejak `panelServer` membacanya ulang dari dokumen, jadi
 * mengisi sebagian di sini sudah cukup — sisanya tidak dibaca karena
 * `panelServer` menghitung ulang izin dari dokumen, bukan dari token.
 */
function partial(p: Partial<TabPermissions>): TabPermissions {
  return { ...p } as TabPermissions;
}

const tokenUser = P.terbitkanToken('budi', 'user', izinUser);
const tokenAdmin = P.terbitkanToken('admin', 'admin', izinUser);

cek('token terbentuk', tokenUser.includes('.') && tokenUser.split('.').length === 2);
cek('token user terbaca', P.bacaToken(tokenUser)?.sub === 'budi');
cek('token admin terbaca', P.bacaToken(tokenAdmin)?.sub === 'admin');
cek('peran ikut terbaca dari token', P.bacaToken(tokenUser)?.role === 'user');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1b. Peran SELALU dibaca dari dokumen, bukan dari token');

seed();

/*
 * Bukti paling langsung dari laporan "refresh jadi admin".
 *
 * Sesi user dipulihkan dari token yang **sah** — tanda tangannya benar, belum
 * kedaluwarsa. Yang menentukan adalah apa yang dibaca server dari dokumen.
 * Kalau `role` di token yang jadi sumber kebenaran, peran yang dikembalikan di
 * sini akan datang dari storage dan bug-nya masih ada meski tokennya sudah
 * ditandatangani.
 */
const hasilUser = await P.verifikasiToken(tokenUser);
cek('token user sah -> masuk sebagai user', hasilUser.ok && hasilUser.akun?.role === 'user',
  `dapat ${hasilUser.akun?.role}`);
cek('nama akun dari token dipertahankan', hasilUser.akun?.username === 'budi');
cek('izin dihitung ulang dari dokumen, bukan apa adanya dari token',
  hasilUser.akun?.permissions?.tabPresensi === true);

const tokenSiti = P.terbitkanToken('siti', 'admin', partial({ tabManajemenAkun: true }));
const hasilAdmin = await P.verifikasiToken(tokenSiti);
cek('token admin -> admin (dokumen memang admin)', hasilAdmin.ok && hasilAdmin.akun?.role === 'admin');

/*
 * **Inilah skenario yang dilaporkan.**
 *
 * Peran diturunkan di dokumen — di luar aplikasi. Token-nya sendiri sama
 * sekali tidak disentuh: masih sah, masih berlaku, tanda tangannya benar.
 * Kalau peran datang dari token, sesi ini akan terus jadi admin sampai
 * 30 menit kedaluwarsa.
 */
(dokumen.get(KUNCI.pengguna('siti')) as Record<string, unknown>).role = 'user';
const setelahTurunkan = await P.verifikasiToken(tokenSiti);
cek('peran diturunkan di dokumen -> langsung hilang, meski tokennya sah',
  setelahTurunkan.ok && setelahTurunkan.akun?.role === 'user',
  `dapat ${setelahTurunkan.akun?.role} — ini bug "refresh jadi admin"`);
cek('izin khusus admin ikut hilang setelah penurunan',
  setelahTurunkan.akun?.permissions?.tabManajemenAkun === false);
(dokumen.get(KUNCI.pengguna('siti')) as Record<string, unknown>).role = 'admin';

/*
 * Arah sebaliknya: token diterbitkan sebagai `user`, dokumen sudah `admin`.
 *
 * Server melaporkan apa yang **ditemukan di dokumen**. Keputusan untuk memberi
 * akses ada di `masukPanel()` — yang menerbitkan token baru. Yang diuji di sini
 * hanya satu hal: server tidak pernah memakai `role` dari token.
 */
const tokenPenggunaDiSiti = P.terbitkanToken('siti', 'user', partial({ tabBeranda: true }));
const naikkan = await P.verifikasiToken(tokenPenggunaDiSiti);
cek('server melaporkan peran dari dokumen, bukan dari token',
  naikkan.akun?.role === 'admin',
  `token bilang user, dokumen bilang admin — server ikut dokumen: ${naikkan.akun?.role}`);

// ── Akun nonaktif ────────────────────────────────────────────────────
console.log('\n=== 1c. Akun nonaktif ditolak, token lamanya ikut mati');
const tokenMati = P.terbitkanToken('nonaktif', 'user', partial({ tabBeranda: true }));
const hasilMati = await P.verifikasiToken(tokenMati);
cek('token akun nonaktif ditolak', !hasilMati.ok, `dapat kode ${hasilMati.kode}`);
cek('kodenya 403, bukan 401 — "tidak-boleh-masuk" bukan "kredensial salah"',
  hasilMati.kode === 403, String(hasilMati.kode));
cek('pesan menyebut dinonaktifkan', /dinonaktifkan/i.test(hasilMati.pesan ?? ''));

// ── Dokumen hilang ───────────────────────────────────────────────────
console.log('\n=== 1d. Akun yang dihapus tidak bisa memakai token lamanya');
dokumen.delete(KUNCI.pengguna('budi'));
const hasilHilang = await P.verifikasiToken(tokenUser);
cek('akun dihapus -> token ditolak', !hasilHilang.ok, `dapat kode ${hasilHilang.kode}`);

// ═════════════════════════════════════════════════════════════════════

cek('token kosong ditolak', P.bacaToken('') === null);
cek('token null ditolak', P.bacaToken(null) === null);
cek('token tanpa titik ditolak', P.bacaToken('bukan-token') === null);
cek('token dengan titik berlebih ditolak', P.bacaToken('a.b.c') === null);
cek('token dengan tanda tangan kosong ditolak', P.bacaToken('payload.') === null);
cek('token dengan payload kosong ditolak', P.bacaToken('.signature') === null);

// ── Yang paling penting: manipulasi payload ─────────────────────────

// ── Admin bawaan: nama yang sah ──────────────────────────────────────
console.log('\n=== 1e. Admin bawaan: username kosong TIDAK berarti "apa pun"');

/*
 * Bug yang paling berbahaya di versi lama:
 *
 * ```ts
 * if (storedAdmin ? username === storedAdmin : true) { … }
 * ```
 *
 * Begitu `adminUsername` belum pernah diisi, `storedAdmin` kosong, cabang
 * `: true` diambil — jadi **username apa pun** + password admin = admin penuh,
 * dengan `role: 'admin'` dan semua izin.
 *
 * Server menutupnya dengan dua aturan:
 *
 * 1. Nama admin selalu dihitung, dengan nilai bawaan yang tetap (`admin`) —
 *    field kosong berarti `admin`, bukan "apa pun".
 * 2. Peran dan izin admin tidak pernah disusun di peramban. Keduanya bentuk
 *    server (`akunAman()`), dan yang disimpan di storage adalah token
 *    bertanda tangan, bukan objek akun.
 */

// `adminUsername` dihapus dari dokumen → nama yang berlaku tetap `admin`.
delete (dokumen.get(KUNCI.pengaturan('auth')) as Record<string, unknown>).adminUsername;
const tokenAdminDefault = P.terbitkanToken('admin', 'admin', partial({ tabManajemenAkun: true }));
const verifikasiDefault = await P.verifikasiToken(tokenAdminDefault);
cek('adminUsername kosong -> nama yang berlaku tetap "admin"', verifikasiDefault.ok,
  `dapat kode ${verifikasiDefault.kode}`);
cek('peran tetap admin, bukan ditolak', verifikasiDefault.akun?.role === 'admin');

// Nama lain tidak bisa dipakai sebagai admin bawaan: tidak ada dokumen dengan
// nama itu, jadi verifikasi menolak.
const tokenNamaAsing = P.terbitkanToken('entah', 'admin', partial({ tabManajemenAkun: true }));
const verifikasiAsing = await P.verifikasiToken(tokenNamaAsing);
cek('nama selain admin bawaan tidak diterima sebagai admin',
  !verifikasiAsing.ok, `dapat kode ${verifikasiAsing.kode}`);

// Dikembalikan supaya bagian berikutnya memakai kondisi yang sama dengan produksi.
(dokumen.get(KUNCI.pengaturan('auth')) as Record<string, unknown>).adminUsername = 'admin';

// ── Kompatibilitas dokumen admin format lama (`pinEncrypted`) ─────────
console.log('\n=== 1e2. Admin dengan dokumen format lama (pinEncrypted)');

/*
 * ⚠️ Jalur ini **pernah selalu gagal**, dan tidak ada yang bisa memperbaikinya
 * karena gejalanya identik dengan "password salah".
 *
 * `CryptoJS.AES.encrypt(plain, passphrase)` menghasilkan OpenSSL "Salted__":
 *
 *   base64( "Salted__" || salt[8] || aes-256-cbc(plain, key, iv) )
 *
 * Versi sebelumnya memperlakukannya sebagai ciphertext AES mentah: header dan
 * salt ikut didekripsi, kuncinya diturunkan dengan HMAC-SHA256 (aslinya
 * `EVP_BytesToKey`/MD5), dan IV-nya nol semua (aslinya dari salt). Tiga
 * kesalahan itu berarti `dekrip.final()` selalu melempar, jadi hasilnya
 * selalu `false` — admin dengan dokumen lama terkunci permanen.
 *
 * Uji ini membuat ciphertext **sungguhan** dengan CryptoJS, lalu memastikan
 * `masukPanel()` menerimanya. Kalau derivasi key-nya salah lagi, ciphertext-nya
 * tidak akan pernah bisa dibuka dan uji ini gagal.
 */
const LEGACY_SECRET = 'secret-lama-yang-pernah-di-bundle';
const SANDI_LEGACY = 'rahasia-admin-lama';

process.env.VITE_APP_SECRET = LEGACY_SECRET;
const legacyCipher = CryptoJS.AES.encrypt(SANDI_LEGACY, LEGACY_SECRET).toString();
cek('ciphertext uji benar-benar format OpenSSL Salted__',
  legacyCipher.startsWith('U2FsdGVkX1'),
  legacyCipher.slice(0, 16));

/*
 * ⚠️ Dokumen di sini harus disalin, bukan diubah di tempat.
 *
 * `seed()` menyimpan objek `adminDoc` yang sama ke peta **lewat referensi**.
 * Mengubah `pinEncrypted` di tempat akan bertahan sampai `seed()` berikutnya —
 * dan skrip ini punya beberapa bagian yang mengubah dokumen auth di antara
 * satu sama lain. Mengganti whole entri peta membuat bagian ini tidak
 * bergantung pada urutan, dan tidak bisa diam-diam menguji dokumen yang salah.
 */
const authLama: Record<string, unknown> = { ...dokumen.get(KUNCI.pengaturan('auth')), pinEncrypted: legacyCipher };
delete authLama.pinHash;
dokumen.set(KUNCI.pengaturan('auth'), authLama);

// `masukPanel()` menghitung percobaan per-IP **termasuk yang berhasil**, jadi
// limiter dibersihkan sebelum tiap percobaan. Tanpa ini, bagian ini bisa
// mendapat 429 alih-alih 401/200 dan menguji pembatas, bukan kompatibilitas.
P.resetPembatasPercobaan();
const legacyBenar = await P.masukPanel('admin', SANDI_LEGACY, { ip: 'uji-legacy' });
cek('admin dengan dokumen format lama bisa login', legacyBenar.ok,
  `dapat kode ${legacyBenar.kode} — jalur ini selalu gagal sebelum diperbaiki`);
cek('perannya tetap admin', legacyBenar.akun?.role === 'admin');

P.resetPembatasPercobaan();
const legacySalah = await P.masukPanel('admin', 'password-ngawur', { ip: 'uji-legacy' });
cek('password salah pada dokumen lama tetap ditolak', !legacySalah.ok);
cek('pesan penolakan tetap generik', legacySalah.pesan === 'ID pengguna atau kata sandi salah.',
  legacySalah.pesan ?? '(kosong)');

// Ciphertext rusak tidak boleh melempar.
P.resetPembatasPercobaan();
dokumen.set(KUNCI.pengaturan('auth'), { ...authLama, pinEncrypted: 'bukan-cipher-text' });
const legacyRusak = await P.masukPanel('admin', SANDI_LEGACY, { ip: 'uji-legacy' });
cek('ciphertext rusak ditolak, tidak melempar', !legacyRusak.ok);

// Tanpa `VITE_APP_SECRET` di server, jalur lama tidak boleh "cocok" buta.
P.resetPembatasPercobaan();
dokumen.set(KUNCI.pengaturan('auth'), authLama);
delete process.env.VITE_APP_SECRET;
const legacyTanpaKunci = await P.masukPanel('admin', SANDI_LEGACY, { ip: 'uji-legacy' });
cek('tanpa VITE_APP_SECRET, jalur lama selalu gagal', !legacyTanpaKunci.ok);
process.env.VITE_APP_SECRET = LEGACY_SECRET;

// Kembalikan ke kondisi normal untuk bagian berikutnya.
dokumen.set(KUNCI.pengaturan('auth'), { ...adminDoc });

// ── Akses daftar akun ─────────────────────────────────────────────────
console.log('\n=== 1f. Non-admin tidak bisa memakai aksi admin');
seed();

const tokenBudi = P.terbitkanToken('budi', 'user', partial({ tabBeranda: true }));
cek('token budi diverifikasi sebagai user',
  (await P.verifikasiToken(tokenBudi)).akun?.role === 'user');

const daftarOlehUser = await P.daftarAkun(tokenBudi);
cek('user tidak bisa daftar akun', !daftarOlehUser.ok, `dapat kode ${daftarOlehUser.kode}`);
cek('kodenya 403', daftarOlehUser.kode === 403, String(daftarOlehUser.kode));

const tokenSitiAdmin = P.terbitkanToken('siti', 'admin', partial({ tabManajemenAkun: true }));
const daftarOlehAdmin = await P.daftarAkun(tokenSitiAdmin);
cek('admin boleh daftar akun', daftarOlehAdmin.ok, `dapat kode ${daftarOlehAdmin.kode}`);
cek(
  'daftar akun tidak pernah menyertakan passwordHash',
  !JSON.stringify((daftarOlehAdmin as { akun?: unknown }).akun ?? []).includes('passwordHash'),
  'hash di respons = seluruh basis password panel bocor ke peramban'
);

cek('tanpa token, akses admin ditolak', !(await P.daftarAkun(undefined)).ok);
const denganTokenPalsu = await P.daftarAkun('eyJzdWIiOiJhZG1pbiJ9.coba');
cek('token bertanda tangan palsu ditolak', !denganTokenPalsu.ok,
  `dapat kode ${denganTokenPalsu.kode}`);


// ── Kredensial hanya untuk pemilik (atau admin) ─────────────────────
console.log('\n=== 1g. Kredensial server tidak bisa dibaca akun lain');

// `cekPemilik()` mengizinkan pemilik sendiri dan admin. Dua-duanya sah, tapi
// **perannya dibaca dari dokumen**, tidak pernah dari body request — jadi satu
// username di body tidak membuat siapa pun jadi admin.
const ringkasMilikSendiri = await P.ringkasKredensial(tokenBudi, 'budi');
cek('pemilik boleh membaca ringkasan kredensialnya sendiri', ringkasMilikSendiri.ok,
  `dapat kode ${ringkasMilikSendiri.kode}`);
/*
 * Yang diperiksa adalah **field**-nya, bukan kata "password" di teks.
 *
 * `terbaca` memang memuat kata itu — dan itu justru yang membuat naive check
 * salah: ia akan menyimpulkan ada kebocoran padahal yang bocor cuma label.
 * Yang tidak boleh ada adalah `passwordEncrypted` dan nilai sandinya.
 */
cek('ringkasan tidak menyertakan field passwordEncrypted',
  !('passwordEncrypted' in (ringkasMilikSendiri.ringkasan ?? {})),
  `field yang dikirim: ${Object.keys(ringkasMilikSendiri.ringkasan ?? {}).join(', ')}`);
cek('nilai ciphertext tidak ikut terkirim',
  !JSON.stringify(ringkasMilikSendiri.ringkasan ?? {}).includes('v2.stub'));
/*
 * Daftar field yang boleh dikirim. `pesan` ikut karena hanya muncul saat
 * `terbaca: false` — yang perlu memberitahu admin untuk menyimpan ulang.
 *
 * Daftar ini disengaja eksplisit: "tidak ada field sensitif" terlalu longgar,
 * karena field baru yang tidak sengaja ikut ter-*spread* akan lolos.
 */
const DAPAT_DIKIRIM = new Set(['nip', 'imei', 'terbaca', 'updatedAt', 'pesan']);
const fieldAsing = Object.keys(ringkasMilikSendiri.ringkasan ?? {}).filter(k => !DAPAT_DIKIRIM.has(k));
cek('tidak ada field lain yang ikut terkirim', fieldAsing.length === 0, fieldAsing.join(', '));

const ringkasOrangLain = await P.ringkasKredensial(tokenBudi, 'siti');
cek('user tidak bisa membaca kredensial akun lain', !ringkasOrangLain.ok,
  `dapat kode ${ringkasOrangLain.kode}`);
cek('kodenya 403', ringkasOrangLain.kode === 403, String(ringkasOrangLain.kode));

const ringkasOlehAdmin = await P.ringkasKredensial(tokenSitiAdmin, 'budi');
cek('admin boleh mengatur kredensial akun lain', ringkasOlehAdmin.ok,
  'menu Manajemen Akun butuh ini');

// Traversal: username berisi garis miring tidak boleh membuka dokumen lain.
const traversal = await P.ringkasKredensial(tokenBudi, '../pengaturan/auth');
cek('username berisi "/" tidak melewati pemeriksaan pemilik', !traversal.ok,
  `dapat kode ${traversal.kode}`);

// ── Bentuk batch: hanya admin, dan hanya field yang sama ─────────────
console.log('\n=== 1g2. Bentuk batch ringkasan kredensial — khusus admin');

/*
 * Aksi `kredensial:ringkas-semua` mengembalikan metadata semua akun
 * sekaligus. Kalau ini tidak dibatasi admin, setiap user bisa membaca
 * NIP + IMEI + status kredensial akun orang lain — yang persis hal yang
 * `kredensial:ringkas` per-akun lindungi.
 */
const batchOlehUser = await P.ringkasSemuaKredensial(tokenBudi);
cek('user biasa tidak boleh membaca ringkasan semua akun', !batchOlehUser.ok,
  `dapat kode ${batchOlehUser.kode}`);
cek('kodenya 403', batchOlehUser.kode === 403, String(batchOlehUser.kode));

const batchTanpaToken = await P.ringkasSemuaKredensial('');
cek('tanpa token ditolak', !batchTanpaToken.ok, `dapat kode ${batchTanpaToken.kode}`);

const batchOlehAdmin = await P.ringkasSemuaKredensial(tokenSitiAdmin);
cek('admin boleh membaca ringkasan semua akun', batchOlehAdmin.ok,
  `dapat kode ${batchOlehAdmin.kode}`);

const daftarBatch = batchOlehAdmin.daftar ?? {};
cek('batch memuat akun yang punya kredensial', Object.keys(daftarBatch).length > 0,
  `${Object.keys(daftarBatch).join(', ')}`);
cek('akun tanpa dokumen tidak muncul (bukan nilai kosong)',
  !('tanpaKredensial' in daftarBatch),
  'hanya dokumen yang benar-benar ada yang dikembalikan batch read');
cek('passwordEncrypted tidak ikut dalam batch',
  !JSON.stringify(daftarBatch).includes('passwordEncrypted'));
cek('nilai ciphertext tidak ikut dalam batch',
  !JSON.stringify(daftarBatch).includes('v2.stub'));
const fieldBatchAsing = Object.values(daftarBatch)
  .flatMap(v => Object.keys(v))
  .filter(k => !DAPAT_DIKIRIM.has(k));
cek('batch tidak mengirim field lain', fieldBatchAsing.length === 0,
  [...new Set(fieldBatchAsing)].join(', '));

// ── Pembacaan langganan & tagihan lewat server ───────────────────────
console.log('\n=== 1g3. Pembacaan langganan/tagihan — lewat server, bukan Firestore klien');

/*
 * Koleksi ini **dulu** dibaca langsung dari peramban dengan
 * `allow read: if true`. Karena aplikasi tidak memakai Firebase Auth,
 * `request.auth` selalu `null`, jadi `if true` berarti seluruh koleksi
 * terbuka untuk siapa pun yang punya API key — dan API key itu ada di bundle
 * peramban.
 *
 * Yang diuji di sini adalah penggantinya: nama dokumen berasal dari **token**,
 * bukan dari `input`, sehingga tidak ada request yang bisa diarahkan ke akun
 * lain.
 */
dokumen.set('jatim_langganan/budi', { masaAkhir: '2027-01-01T00:00:00.000Z', gratis: false });
dokumen.set('jatim_langganan/siti', { masaAkhir: '2027-06-01T00:00:00.000Z', gratis: true });
dokumen.set('jatim_tagihan/ORD-BUDI-1', {
  orderId: 'ORD-BUDI-1', username: 'budi', usernameLabel: 'Budi Santoso',
  nominal: 50000, status: 'lunas', createdAt: '2026-03-01T00:00:00.000Z',
});
dokumen.set('jatim_tagihan/ORD-BUDI-2', {
  orderId: 'ORD-BUDI-2', username: 'budi', usernameLabel: 'Budi Santoso',
  nominal: 75000, status: 'lunas', createdAt: '2026-02-01T00:00:00.000Z',
});
dokumen.set('jatim_tagihan/ORD-SITI-1', {
  orderId: 'ORD-SITI-1', username: 'siti', usernameLabel: 'Siti Aminah',
  nominal: 100000, status: 'lunas', createdAt: '2026-01-01T00:00:00.000Z',
});

const langgananBudi = await B.bacaLanggananSaya(tokenBudi);
cek('user membaca langganan sendiri', langgananBudi.ok, `dapat kode ${langgananBudi.kode}`);
cek('dokumen yang dikembalikan miliknya',
  langgananBudi.dokumen?.masaAkhir === '2027-01-01T00:00:00.000Z',
  JSON.stringify(langgananBudi.dokumen));
cek('nama akun ikut dikirim (UI butuh untuk label)',
  langgananBudi.dokumen?.username === 'budi');

cek('tanpa token, langganan ditolak',
  (await B.bacaLanggananSaya('')).kode === 401);
cek('token rusak, langganan ditolak',
  (await B.bacaLanggananSaya('bukan.token')).kode === 401);

const tagihanBudi = await B.bacaTagihanSaya(tokenBudi, 10);
cek('user membaca tagihan sendiri', tagihanBudi.ok, `dapat kode ${tagihanBudi.kode}`);
cek('hanya tagihan miliknya yang dikembalikan',
  (tagihanBudi.tagihan ?? []).every(t => t.username === 'budi'),
  JSON.stringify((tagihanBudi.tagihan ?? []).map(t => t.username)));
cek('tagihan terurut terbaru dulu',
  tagihanBudi.tagihan?.[0]?.orderId === 'ORD-BUDI-1',
  (tagihanBudi.tagihan ?? []).map(t => t.orderId).join(', '));
cek('jumlah tagihan sesuai batas',
  (await B.bacaTagihanSaya(tokenBudi, 1)).tagihan?.length === 1);

cek('tanpa token, tagihan ditolak', (await B.bacaTagihanSaya('')).kode === 401);

/* Batas `batas` tidak boleh jadi celah: server yang membatasi. */
const tagihanBesar = await B.bacaTagihanSaya(tokenBudi, 100_000);
cek('batas diklemah di server, bukan dipercaya dari klien',
  (tagihanBesar.tagihan ?? []).length <= 200,
  `${(tagihanBesar.tagihan ?? []).length} baris`);

cek('daftar langganan bukan hak user biasa',
  (await B.bacaSemuaLangganan(tokenBudi)).kode === 403);
cek('daftar tagihan bukan hak user biasa',
  (await B.bacaSemuaTagihan(tokenBudi)).kode === 403);

const semuaLangganan = await B.bacaSemuaLangganan(tokenSitiAdmin);
cek('admin boleh membaca semua langganan', semuaLangganan.ok, `dapat kode ${semuaLangganan.kode}`);
cek('daftar langganan tidak kosong', (semuaLangganan.daftar ?? []).length > 0);

const semuaTagihan = await B.bacaSemuaTagihan(tokenSitiAdmin);
cek('admin boleh membaca semua tagihan', semuaTagihan.ok, `dapat kode ${semuaTagihan.kode}`);
cek('daftar tagihan terurut terbaru dulu',
  String(semuaTagihan.tagihan?.[0]?.createdAt ?? '') >= String(semuaTagihan.tagihan?.[1]?.createdAt ?? ''),
  (semuaTagihan.tagihan ?? []).map(t => t.orderId).join(', '));

/*
 * ⚠️ Ini yang paling penting dari bagian ini.
 *
 * Fungsi-fungsi di atas **tidak punya parameter username**. Kalau suatu saat
 * ada yang menambahkannya dan memakainya untuk memilih dokumen, satu akun
 * bisa membaca tagihan akun lain hanya dengan mengubah satu field di body —
 * persis kebocoran yang `allow read: if true` ini bocorkan.
 */
/*
 * ⚠️ Ini yang paling penting dari bagian ini.
 *
 * Fungsi-fungsi di atas **tidak punya parameter username**. Kalau suatu saat
 * ada yang menambahkannya dan memakainya untuk memilih dokumen, satu akun
 * bisa membaca tagihan akun lain hanya dengan mengubah satu field di body —
 * persis kebocoran yang `allow read: if true` ini bocorkan.
 *
 * Yang diperiksa adalah **daftar parameter**nya, bukan isi badan fungsi:
 * badan memang wajib menyebut `pemanggil.username` — itulah mekanismenya.
 */
cek('tidak ada fungsi baca yang menerima username dari pemanggil', (() => {
  const src = String(B.bacaLanggananSaya) + String(B.bacaTagihanSaya);
  // Badannya hanya boleh menyebut `pemanggil.username` (dari token) dan
  // `pemanggilUsername` — tidak boleh menerima `username` sebagai argumen.
  const parameter = src.match(/baca\w+\(([^)]*)\)/)?.[1] ?? '';
  return !/\busername\b/.test(parameter);
})(), 'nama dokumen harus berasal dari token');

// ── Admin terakhir tidak boleh mengunci panel ─────────────────────────
console.log('\n=== 1h. Admin terakhir tidak bisa menonaktifkan/menurunkan dirinya');
// `siti` adalah satu-satunya admin pada seed ini.
const turunkanSendiri = await P.ubahAkun(tokenSitiAdmin, 'siti', { role: 'user' });
cek('menurunkan admin terakhir ditolak', !turunkanSendiri.ok, `dapat kode ${turunkanSendiri.kode}`);
cek('kodenya 409', turunkanSendiri.kode === 409, String(turunkanSendiri.kode));
cek('pesan menyebut alasannya', /admin terakhir/i.test(turunkanSendiri.pesan ?? ''));

const nonaktifSendiri = await P.ubahAkun(tokenSitiAdmin, 'siti', { nonaktif: true });
cek('menonaktifkan admin terakhir ditolak', !nonaktifSendiri.ok);

// Bellantahannya: setelah ada admin lain, operasi yang sama harusnya BOLEH.
// Kalau tidak, aturan ini justru membekukan seluruh panel — bukan mencegah apa
// pun. `budi` dinaikkan ke admin lebih dulu, lalu `siti` diturunkan.
await P.ubahAkun(tokenSitiAdmin, 'budi', { role: 'admin' });
const setelahAdaAdminLain = await P.ubahAkun(tokenSitiAdmin, 'siti', { role: 'user' });
cek('setelah ada admin lain, penurunan diizinkan', setelahAdaAdminLain.ok,
  `dapat kode ${setelahAdaAdminLain.kode} — ${setelahAdaAdminLain.pesan ?? ''}`);
cek('dokumen siti sekarang user', dokumen.get(KUNCI.pengguna('siti'))?.role === 'user');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Payload yang diubah tidak bisa dipakai');

/** Pecah token, ubah payload-nya, tanda tangan ikut "dihitung ulang" salah. */
function susunUlang(payloadObj: unknown, signature = 'dipalsukan'): string {
  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  return `${payload}.${signature}`;
}

const muatanAsli = JSON.parse(Buffer.from(tokenUser.split('.')[0], 'base64url').toString('utf8'));

cek('role diubah jadi admin → ditolak',
  P.bacaToken(susunUlang({ ...muatanAsli, role: 'admin' })) === null);
cek('sub diubah jadi admin → ditolak',
  P.bacaToken(susunUlang({ ...muatanAsli, sub: 'admin' })) === null);
cek('exp digeser jauh ke depan → ditolak',
  P.bacaToken(susunUlang({ ...muatanAsli, exp: Date.now() + 86_400_000 })) === null);
cek('iat digeser ke masa depan → ditolak',
  P.bacaToken(susunUlang({ ...muatanAsli, iat: Date.now() + 86_400_000 })) === null);
cek('versi payload diubah → ditolak',
  P.bacaToken(susunUlang({ ...muatanAsli, v: 99 })) === null);
cek('role di luar daftar → ditolak',
  P.bacaToken(susunUlang({ ...muatanAsli, role: 'superadmin' })) === null);

// Tanda tangan digeser satu karakter.
cek('tanda tangan diubah satu karakter → ditolak',
  P.bacaToken(tokenUser.slice(0, -1) + (tokenUser.endsWith('A') ? 'B' : 'A')) === null);

// Token yang payload-nya sama tapi tanda tangannya milik token lain.
const payloadUser = tokenUser.split('.')[0];
const signatureAdmin = tokenAdmin.split('.')[1];
cek('tanda tangan milik token lain → ditolak',
  P.bacaToken(`${payloadUser}.${signatureAdmin}`) === null);

// ── Pembatas percobaan login ─────────────────────────────────────────
console.log('\n=== 2b. Pembatas percobaan: per-IP dan per-akun');

/*
 * Yang diuji bukan "server menolak setelah N percobaan" — itu soal kalender
 * dan instance yang hidup. Yang penting adalah bahwa **dua lapis** ada dan
 * keduanya benar-benar dipanggil, karena satu lapis saja bisa dilewati dengan
 * serangan tersebar dari banyak IP.
 *
 * `resetPembatasPercobaan()` dipakai supaya bagian ini tidak bergantung pada
 * status yang ditinggalkan bagian sebelumnya.
 */
P.resetPembatasPercobaan();

// Password di seed memang tidak cocok dengan hash-nya. Yang diperiksa di sini
// hanya kode status dan pesannya — bukan berhasil/tidaknya login.
const kodePercobaan = [];
for (let i = 0; i < 10; i++) {
  kodePercobaan.push(await P.masukPanel('budi', 'sandi-salah', { ip: '10.0.0.9' }));
}

cek(
  'percobaan dengan password salah selalu ditolak',
  kodePercobaan.every(h => !h.ok),
  `${kodePercobaan.filter(h => h.ok).length} lolos dari 10`
);

const terkunci = kodePercobaan.find(h => h.kode === 429);
cek('pada akhirnya terkunci (429)', Boolean(terkunci),
  `kode yang muncul: ${[...new Set(kodePercobaan.map(h => h.kode))].join(', ')}`);
cek('penguncian menyebut sisa waktu',
  typeof terkunci?.terkunci === 'number' && terkunci.terkunci > 0,
  String(terkunci?.terkunci));
cek('penguncian menyebut akunnya, bukan IP', /akun ini/i.test(terkunci?.pesan ?? ''),
  terkunci?.pesan ?? '(tidak ada yang 429)');

// Akun terkunci tetap terkunci meski IP berubah — inilah pembatas per-akun
// yang tidak bisa dilewati dengan serangan tersebar.
const ipLain = await P.masukPanel('budi', 'sandi-salah', { ip: '10.0.0.99' });
cek('akun terkunci tetap terkunci meski IP berubah', ipLain.kode === 429,
  `dapat kode ${ipLain.kode} — inilah yang tidak dilewati dengan ganti IP`);

// IP yang mencoba banyak akun juga harus dikunci.
P.resetPembatasPercobaan();
const kodeIp = [];
for (let i = 0; i < 22; i++) {
  kodeIp.push(await P.masukPanel(`akun-${i}`, 'sandi-salah', { ip: '10.2.2.2' }));
}
cek('IP yang mencoba banyak akun juga dikunci',
  kodeIp.some(h => h.kode === 429) && kodeIp.some(h => /perangkat/i.test(h.pesan ?? '')),
  kodeIp.find(h => h.kode === 429)?.pesan ?? '(tidak ada yang 429)');

P.resetPembatasPercobaan();


// ── Rahasia yang berbeda ────────────────────────────────────────────
console.log('\n=== 3. Rahasia berbeda tidak bisa menandatangani');
const tua = process.env.PANEL_SESSION_SECRET;
process.env.PANEL_SESSION_SECRET = 'rahasia-yang-berbeda-sama-sekali-0987654321';
cek('token lama ditolak setelah rahasia diganti', P.bacaToken(tokenUser) === null);
// Token yang ditandatangani dengan rahasia lain: harus tetap ditolak oleh
// server yang memakai rahasia yang benar.
const tokenPalsu = P.terbitkanToken('admin', 'admin', izinUser);
process.env.PANEL_SESSION_SECRET = tua;
cek('token yang ditandatangani rahasia lain ditolak', P.bacaToken(tokenPalsu) === null);
cek('token asli diterima lagi', P.bacaToken(tokenUser) !== null);

// ── Rahasia wajib ada ───────────────────────────────────────────────
console.log('\n=== 4. Tanpa PANEL_SESSION_SECRET, modul menolak bekerja');
delete process.env.PANEL_SESSION_SECRET;
cek('tanpa secret, bacaToken menolak semua token', P.bacaToken(tokenUser) === null);
cek('tanpa secret, menerbitkan token melempar', (() => {
  try {
    P.terbitkanToken('admin', 'admin', izinUser);
    return false;
  } catch (err) {
    return /PANEL_SESSION_SECRET/.test(String((err as Error).message));
  }
})(), 'pesan harus menyebut variabel yang harus diisi');
cek('ringkasan melaporkan belum siap', P.ringkasanPanelAuth().siap === false);
cek('ringkasan melaporkan secret ada = false', P.ringkasanPanelAuth().secretAda === false);

// Secret yang terlalu pendek juga ditolak — nilai bawaan yang lemah sama
//Administration bohong dengan tidak ada secret.
process.env.PANEL_SESSION_SECRET = 'pendek';
cek('secret < 32 karakter ditolak', P.ringkasanPanelAuth().secretCukupPanjang === false);
cek('secret pendek tidak bisa menandatangani', (() => {
  try {
    P.terbitkanToken('admin', 'admin', izinUser);
    return false;
  } catch {
    return true;
  }
})());
process.env.PANEL_SESSION_SECRET = SECRET;
cek('secret dipulihkan', P.ringkasanPanelAuth().secretCukupPanjang === true);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Endpoint HTTP: allow-list, method, kode status');
const { tanganiPanelAuth } = await import('../src/serverless/_panel.ts');

/** Panggil handler dengan req/res tiruan, kembalikan { status, body }. */
/** Opsi pemanggilan endpoint: token lewat header, asal origin, dan method. */
interface OpsiPanggil {
  token?: string;
  origin?: string;
  method?: string;
}

/** Hasil pemanggilan: status HTTP dan body JSON-nya. */
interface HasilPanggil {
  status: number;
  body: Record<string, any> | null;
}

async function panggil(
  body: Record<string, unknown>,
  { token, origin, method = 'POST' }: OpsiPanggil = {},
): Promise<HasilPanggil> {
  const headers: Record<string, string> = { origin: origin ?? 'https://panel.example.go.id' };
  if (token) headers.authorization = `Bearer ${token}`;
  let status = 0;
  let payload: Record<string, any> | null = null;
  const res = {
    setHeader() {},
    status(kode: number) {
      status = kode;
      return res;
    },
    json(data: Record<string, any>) {
      payload = data;
      return data;
    },
    end() {
      return undefined;
    },
  };
  await tanganiPanelAuth({ method, headers, body, ip: '10.0.0.1' }, res);
  return { status, body: payload };
}

const origins = await panggil({ aksi: 'nonsense' }, { origin: 'https://penyerang.example.net' });
cek('origin tak dikenal ditolak 403', origins.status === 403, String(origins.status));
cek('pesan 403 menyebut ALLOWED_ORIGINS',
  /ALLOWED_ORIGINS/.test(origins.body?.pesan ?? ''),
  '403 tanpa penjelasan = "halaman ini bukan milik Anda", padahal penyebabnya konfigurasi');

const tanpaOrigin = await panggil({ aksi: 'nonsense' }, { origin: '' });
cek('tanpa Origin (curl) boleh lewat', tanpaOrigin.status !== 403, String(tanpaOrigin.status));

const salahMethod = await panggil({}, { method: 'GET' });
cek('GET ditolak 405', salahMethod.status === 405, String(salahMethod.status));

/*
 * Konfigurasi yang hilang harus menghasilkan **503 dengan pesan yang bisa
 * dikerjakan**, bukan 401.
 *
 * 401 bentuknya sama persis dengan "password salah" — dan itu kegagalan yang
 * paling membuat orang menebak-nebak, karena tidak ada satu pun petunjuk bahwa
 * masalahnya ada di konfigurasi server. Pemeriksaan ini menjaga agar kesalahan
 * konfigurasi tidak menyamar jadi kesalahan pengguna.
 *
 * Firestore tiruan sengaja dimatikan dulu: selama tiruan aktif,
 * `adminTersedia()` selalu `true` dan pemeriksaan ini tidak akan pernah kena.
 * Itu konsekuensi dari memakai tiruan, dan di sini kita reverses-nya.
 */
adminModulLater.__setFirestoreTiruan(null);
const secretAsli = process.env.PANEL_SESSION_SECRET;
const layananAsli = process.env.FIREBASE_SERVICE_ACCOUNT;
const kredensialAsli = process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

// (a) Secret ada, Admin SDK tidak.
const tanpaAdmin = await panggil({ aksi: 'masuk', username: 'budi', password: 'x' });
cek('Admin SDK hilang -> 503, bukan 401', tanpaAdmin.status === 503, String(tanpaAdmin.status));
cek('503 menyebut kredensial Firebase Admin',
  /FIREBASE_SERVICE_ACCOUNT|GOOGLE_APPLICATION_CREDENTIALS/.test(tanpaAdmin.body?.pesan ?? ''),
  tanpaAdmin.body?.pesan ?? '(tidak ada pesan)');

// (b) Secret juga hilang.
delete process.env.PANEL_SESSION_SECRET;
const tanpaKeduanya = await panggil({ aksi: 'masuk', username: 'budi', password: 'x' });
cek('secret + Admin SDK hilang -> 503', tanpaKeduanya.status === 503, String(tanpaKeduanya.status));
cek('503 menyebut PANEL_SESSION_SECRET',
  /PANEL_SESSION_SECRET/.test(tanpaKeduanya.body?.pesan ?? ''));
cek('503 menyebut kedua penyebab sekaligus',
  /PANEL_SESSION_SECRET/.test(tanpaKeduanya.body?.pesan ?? '') &&
    /FIREBASE_SERVICE_ACCOUNT|GOOGLE_APPLICATION_CREDENTIALS/.test(tanpaKeduanya.body?.pesan ?? ''),
  'satu pesan berisi semua yang harus diisi, bukan satu per satu');

// (c) Secret ada tapi terlalu pendek.
process.env.PANEL_SESSION_SECRET = 'pendek';
const secretPendek = await panggil({ aksi: 'masuk', username: 'budi', password: 'x' });
cek('secret < 32 karakter -> 503', secretPendek.status === 503, String(secretPendek.status));
cek('503 menjelaskan syarat panjangnya',
  /32 karakter/.test(secretPendek.body?.pesan ?? ''),
  secretPendek.body?.pesan ?? '(tidak ada pesan)');

// Dipulihkan untuk bagian-bagian berikutnya.
process.env.PANEL_SESSION_SECRET = secretAsli;
if (layananAsli) process.env.FIREBASE_SERVICE_ACCOUNT = layananAsli;
if (kredensialAsli) process.env.GOOGLE_APPLICATION_CREDENTIALS = kredensialAsli;
adminModulLater.__setFirestoreTiruan(firestoreTiruan);

const pulih = await panggil({ aksi: 'nonsense' });
cek('setelah konfigurasi dipulihkan, aksi tak dikenal kena 400 (bukan 503)',
  pulih.status === 400, String(pulih.status));

const opsiAsing = await panggil({ aksi: 'rahasia' }, { method: 'OPTIONS' });
cek('OPTIONS dijawab 200 (preflight)', opsiAsing.status === 200, String(opsiAsing.status));


// Header Authorization harus dipakai, bukan query string.
const viaHeader = await panggil({ aksi: 'verifikasi' }, { token: tokenUser });
cek('token lewat header dibaca (diverifikasi, lalu tolak karena dokumen tidak ada)', viaHeader.status !== 400);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5b. Endpoint menolak yang tidak bolehnya');

/*
 * Diuji lewat HTTP sungguhan (handler yang sama dengan yang dipakai Vercel),
 * bukan dengan memanggil fungsi server secara langsung — supaya allow-list
 * origin, parsing body, dan pemetaan kode status ikut teruji, bukan cuma
 * logikanya.
 *
 * Yang diperiksa di sini adalah hal yang **tidak bolehnya** terjadi, dan
 * semuanya punya bentuk yang sama: percobaan membuat atau mengubah sesuatu
 * yang tidak boleh diubah, memakai token yang tampak sah.
 */

// ── Tanpa token sama sekali ─────────────────────────────────────────
const tanpaTokenBuat = await panggil({
  aksi: 'akun:buat',
  username: 'sisip',
  password: 'rahasia123',
  role: 'admin',
  namaLengkap: 'Sisip Paksa',
});
cek('akun admin tidak bisa dibuat tanpa token', !tanpaTokenBuat.body?.ok,
  `dapat kode ${tanpaTokenBuat.status}`);
cek('kodenya 403', tanpaTokenBuat.status === 403, String(tanpaTokenBuat.status));

// ── Token user untuk aksi admin ──────────────────────────────────────
seed();
const tokenUserLokal = P.terbitkanToken('budi', 'user', partial({ tabBeranda: true }));
const buatOlehUser = await panggil(
  {
    aksi: 'akun:buat',
    username: 'sisip',
    password: 'rahasia123',
    role: 'admin',
    namaLengkap: 'Sisip Paksa',
  },
  { token: tokenUserLokal }
);
cek('user tidak bisa membuat akun admin', !buatOlehUser.body?.ok,
  `dapat kode ${buatOlehUser.status}`);
cek('dokumen sisip TIDAK pernah dibuat', !dokumen.has(KUNCI.pengguna('sisip')),
  'dokumen yang dibuat akan langsung bisa dipakai untuk masuk');

// ── Token admin, tapi `role` di body di luar daftar ──────────────────
const tokenAdminLokal = P.terbitkanToken('siti', 'admin', partial({ tabManajemenAkun: true }));
const buatOlehAdmin = await panggil(
  {
    aksi: 'akun:buat',
    username: 'murid',
    password: 'rahasia123',
    // Nilai di luar daftar — harus dinormalisasi, bukan dipakai mentah.
    role: 'superadmin',
    namaLengkap: 'Murid',
  },
  { token: tokenAdminLokal }
);
cek('admin boleh membuat akun', buatOlehAdmin.body?.ok, `dapat kode ${buatOlehAdmin.status}`);
cek(
  'role di luar daftar dipaksa jadi user, bukan superadmin',
  dokumen.get(KUNCI.pengguna('murid'))?.role === 'user',
  `tersimpan sebagai "${dokumen.get(KUNCI.pengguna('murid'))?.role}"`
);
cek(
  'izin khusus admin tidak ikut tersimpan pada akun user',
  (dokumen.get(KUNCI.pengguna('murid'))?.permissions as Record<string, unknown> | undefined)
    ?.tabManajemenAkun !== true
);

// ── Menonaktifkan admin terakhir ────────────────────────────────────
const nonaktifTerakhir = await panggil(
  { aksi: 'akun:ubah', username: 'siti', nonaktif: true },
  { token: tokenAdminLokal }
);
cek('admin terakhir tidak bisa dinonaktifkan lewat endpoint',
  !nonaktifTerakhir.body?.ok && nonaktifTerakhir.status === 409,
  `dapat kode ${nonaktifTerakhir.status}`);
cek('siti masih admin di dokumen', dokumen.get(KUNCI.pengguna('siti'))?.role === 'admin');

// ── Menghapus akun sendiri ──────────────────────────────────────────
const hapusSendiri = await panggil({ aksi: 'akun:hapus', username: 'siti' }, { token: tokenAdminLokal });
cek('admin tidak bisa menghapus akunnya sendiri', !hapusSendiri.body?.ok,
  `dapat kode ${hapusSendiri.status}`);
cek('dokumen siti masih ada', dokumen.has(KUNCI.pengguna('siti')));

// ── Traversal lewat username ────────────────────────────────────────
cek(
  'username berisi "/" tidak membentuk dokumen lain',
  !dokumen.has(KUNCI.pengguna('.._pengeksploitasi')) && !dokumen.has('pengeksploitasi'),
  'kunci dokumen mengganti "/" jadi "_", dan validateUsername juga menolak karakternya'
);

// ── Body rusak ──────────────────────────────────────────────────────
const bodyRusak = await panggil('bukan objek' as unknown as Record<string, unknown>);
cek('body yang bukan objek tidak membuat handler melempar',
  bodyRusak.status === 400 || bodyRusak.status === 503,
  `dapat kode ${bodyRusak.status}`);

// ── Operasi langganan: hanya admin ───────────────────────────────────
console.log('\n=== 5c. Operasi langganan juga butuh admin');

/*
 * Pemindahan operasi tulis ke server tidak boleh berhenti jadi "hanya pindah
 * tempat".
 *
 * Kalau `perpanjangManualServer()` dan sejenisnya tidak memeriksa token, maka
 * memindahkannya ke server **tidak menambah keamanan sama sekali** — peramban
 * masih bisa memanggilnya tanpa hak, dan sekarang lewat endpoint yang terlihat
 * seperti API resmi. Itu lebih buruk dari sebelumnya, karena conquer.now ada di
 * dokumentasi.
 *
 * Yang diuji: token user mendapat 403 untuk operasi **yang memang hak admin**,
 * dan dokumennya benar-benar tidak tersentuh.
 *
 * ⚠️ `tagihan:buat` **sengaja tidak ada** di daftar ini. Ia adalah satu-satunya
 * operasi langganan yang tidak butuh admin — tagihan milik pemanggil sendiri,
 * dan pendaftaran itulah yang membuat orang bisa membayar. Ujinya sendiri ada di
 * bagian 5d, karena aturan yang dijaga berlawanan arah: di sini "menolak user"
 * adalah pemeriksaan keamanan, di sana "menerima user" adalah pemeriksaan
 * kebenaran.
 */
seed();
const tokenBudiLokal = P.terbitkanToken('budi', 'user', partial({ tabBeranda: true }));

const langgananOperasi = [
  ['langganan:perpanjang', { username: 'budi', durasi: 1, satuan: 'bulan' }],
  ['langganan:set-masa-akhir', { username: 'budi', iso: '2099-01-01T00:00:00.000Z' }],
  ['langganan:set-gratis', { username: 'budi', gratis: true }],
  ['tagihan:status', { orderId: 'PRABAWA-BULANAN-1', status: 'lunas' }],
  ['tagihan:hapus', { orderId: 'PRABAWA-BULANAN-1' }],
  ['tagihan:hapus-semua', {}],
  [
    'billing:simpan',
    {
      nilai: {
        paket: [{ id: 'bulanan', label: 'Bulan', harga: 1, durasi: 1, satuan: 'bulan' }],
      },
    },
  ],
];

for (const [aksi, isi] of langgananOperasi as Array<[string, Record<string, unknown>]>) {
  const hasil = await panggil({ aksi, ...isi }, { token: tokenBudiLokal });
  cek(`${aksi} menolak user`, !hasil.body?.ok, `dapat kode ${hasil.status}`);
}

/*
 * Yang diuji bukan hanya kode 403 — tapi dokumennya benar-benar tidak
 * tersentuh. 403 tanpa efek tetap berarti penulisan kalau server ternyata menulis
 * sebelum memeriksa.
 */
cek(
  'masaAkhir 2099 tidak pernah tersimpan',
  ![...dokumen.values()].some(d => JSON.stringify(d).includes('2099-01-01')),
  'dokumen langganan tidak boleh tersentuh oleh permintaan tanpa hak'
);
cek('gratis tidak pernah tersimpan untuk budi',
  dokumen.get(KUNCI.pengguna('budi'))?.gratis !== true);
cek('dokumen billing tidak ditulis dari token user',
  !dokumen.has(KUNCI.pengaturan('billing')),
  'menulis billing = mengubah harga paket');

// ═════════════════════════════════════════════════════════════════════
//  5d. `tagihan:buat` — satu-satunya operasi langganan yang terbuka
// ═════════════════════════════════════════════════════════════════════

console.log('\n=== 5d. User biasa boleh membuat tagihan (pembayaran)');

/*
 * ⚠️ Bagian ini menguji arah yang **berlawanan** dengan 5c, dan itu disengaja.
 *
 * Bug yang dilaporkan: pengguna biasa menekan tombol bayar, lalu yang muncul
 * "Akses khusus admin." — di halaman yang seharusnya milik orang yang belum
 * membayar. Penyebabnya `dindingAdmin()` di `buatTagihanServer()`.
 *
 * Membuka pintu itu berarti tiga angka yang tadinya dipercaya dari klien tidak
 * boleh dipercaya lagi. Semuanya dihitung ulang di server:
 *
 * - **Akun** dari token, bukan dari `body.username`. Tanpa ini siapa pun bisa
 *   membuat tagihan atas nama orang lain.
 * - **Harga, durasi, satuan** dari konfigurasi paket server, bukan dari `body`.
 *   Tanpa ini `nominal: 1` akan tersimpan apa adanya — dan `aktifkanLangganan`
 *   membaca nominal itu saat menampilkan ringkasan.
 * - **Paket** dibaca dari `orderId`, jadi `paketId` yang diklaim klien hanya
 *   pemeriksa: kalau berbeda, ditolak dengan 409 — bukan diabaikan diam-diam.
 *
 * Uji ini sengaja memalsukan keempat field itu sekaligus. Kalau salah satu
 * diteruskan mentah, dokumen tagihan menyimpang dan aktivasi nanti salah
 * menghitung.
 */
seed();
/** Paket di server — satu-satunya sumber harga, durasi, dan satuan. */
dokumen.set(KUNCI.pengaturan('billing'), {
  paket: [
    { id: 'bulanan', label: 'Bulanan', harga: 50_000, durasi: 1, satuan: 'bulan' },
    { id: 'tahunan', label: 'Tahunan', harga: 500_000, durasi: 1, satuan: 'tahun' },
  ],
});
const tokenBudiBayar = P.terbitkanToken('budi', 'user', partial({ tabBeranda: true }));

// ── Tanpa sesi sama sekali ───────────────────────────────────────────
const tagihanTanpaToken = await panggil({
  aksi: 'tagihan:buat',
  orderId: 'PRABAWA-BULANAN-1',
  paketId: 'bulanan',
  metode: 'qris',
});
cek('tanpa token, tagihan ditolak 401', tagihanTanpaToken.status === 401,
  `dapat kode ${tagihanTanpaToken.status}`);
cek('dokumen tagihan tidak dibuat tanpa token',
  !dokumen.has('jatim_tagihan/PRABAWA-BULANAN-1'));

// ── Empat field dipalsukan ────────────────────────────────────────────
const tagihanUser = await panggil(
  {
    aksi: 'tagihan:buat',
    orderId: 'PRABAWA-BULANAN-1',
    // Semuanya di bawah HARUS diabaikan server:
    username: 'siti',
    usernameLabel: 'Siti Aminah',
    nominal: 1,
    durasi: 99,
    satuan: 'tahun',
    // Yang memang boleh dikirim klien, karena perannya sebagai pemeriksa:
    paketId: 'bulanan',
    metode: 'qris',
  },
  { token: tokenBudiBayar }
);
cek('pengguna biasa boleh membuat tagihan', tagihanUser.body?.ok === true,
  `dapat kode ${tagihanUser.status} — ${tagihanUser.body?.pesan ?? ''}`);

const tersimpan = dokumen.get('jatim_tagihan/PRABAWA-BULANAN-1');
cek('akun diambil dari token, bukan dari body.username',
  tersimpan?.username === 'budi', `tersimpan sebagai "${tersimpan?.username}"`);
cek('harga diambil dari konfigurasi server',
  tersimpan?.nominal === 50_000, `tersimpan ${tersimpan?.nominal}`);
cek('durasi diambil dari konfigurasi server',
  tersimpan?.durasi === 1, `tersimpan ${tersimpan?.durasi}`);
cek('satuan diambil dari konfigurasi server',
  tersimpan?.satuan === 'bulan', `tersimpan ${tersimpan?.satuan}`);
cek('tagihan baru berstatus menunggu',
  tersimpan?.status === 'menunggu', `status "${tersimpan?.status}"`);
/*
 * `usernameLabel` memang diteruskan — itu nama tampilan yang boleh diisi pemanggil
 * (mis. "Budi Santoso"), bukan penentu akun. Yang dijaga di sini hanya bahwa ia
 * tidak pernah menentukan **siapa** pemiliknya: `username` tetap "budi".
 */
cek('usernameLabel tetap boleh diisi pemanggil',
  tersimpan?.usernameLabel === 'Siti Aminah', `tersimpan "${tersimpan?.usernameLabel}"`);

// ── Nominal/reactif: paket yang diklaim tidak boleh diam-diam diabaikan ──
const paketSalah = await panggil(
  { aksi: 'tagihan:buat', orderId: 'PRABAWA-TAHUNAN-2', paketId: 'bulanan', metode: 'qris' },
  { token: tokenBudiBayar }
);
cek('paketId yang tidak cocok dengan orderId ditolak 409',
  paketSalah.status === 409, `dapat kode ${paketSalah.status}`);
cek('tagihan dengan paket salah tidak ditulis',
  !dokumen.has('jatim_tagihan/PRABAWA-TAHUNAN-2'));

const paketTidakDIjual = await panggil(
  { aksi: 'tagihan:buat', orderId: 'PRABAWA-MITRA-3', paketId: 'mitra', metode: 'qris' },
  { token: tokenBudiBayar }
);
cek('paket yang tidak ada di konfigurasi ditolak 422',
  paketTidakDIjual.status === 422, `dapat kode ${paketTidakDIjual.status}`);
cek('harga tidak jatuh ke default saat paket hilang',
  !dokumen.has('jatim_tagihan/PRABAWA-MITRA-3'));

const orderIdRusak = await panggil(
  { aksi: 'tagihan:buat', orderId: '../../jatim_pengguna/budi', paketId: 'bulanan', metode: 'qris' },
  { token: tokenBudiBayar }
);
cek('orderId berisi "../" ditolak', !orderIdRusak.body?.ok,
  `dapat kode ${orderIdRusak.status}`);

/*
 * ── Satu akun hanya boleh punya SATU tagihan `menunggu` ─────────────
 *
 * Semula batasnya 5 dan penolakannya 429. Itu menghasilkan keadaan buntu:
 * `GerbangLangganan` menampilkan "Masih ada 5 tagihan yang belum diselesaikan"
 * tanpa memberi jalan untuk melanjutkan atau membatalkan salah satunya, jadi
 * akun tidak bisa membayar, tidak bisa membuat tagihan baru, dan hanya admin
 * yang bisa membersihkan. Tagihan menumpuk justru karena tidak ada cara
 * menyelesaikan satu pun.
 *
 * Aturan sekarang: satu tagihan. Penolakannya **409** — bukan 429, karena ini
 * bukan "terlalu banyak permintaan, coba lagi nanti" — dan menyertakan
 * `orderId` tagihan yang ada, supaya peramban bisa melanjutkan pembayarannya.
 */
const tagihanKedua = await panggil(
  { aksi: 'tagihan:buat', orderId: 'PRABAWA-BULANAN-2', paketId: 'bulanan', metode: 'qris' },
  { token: tokenBudiBayar }
);
cek('tagihan kedua ditolak', tagihanKedua.status === 409,
  `dapat kode ${tagihanKedua.status} — 429 akan membuat pengguna mengulang tanpa hasil`);
cek('penolakan menyertakan orderId tagihan yang sudah ada',
  typeof tagihanKedua.body?.orderId === 'string' && tagihanKedua.body.orderId.startsWith('PRABAWA-BULANAN-'),
  `orderId=${tagihanKedua.body?.orderId ?? '(tidak ada)'}`);
cek('pesan penolakan menyebut dua jalan keluar',
  /Lanjutkan pembayaran/.test(tagihanKedua.body?.pesan ?? '') &&
  /batalkan/.test(tagihanKedua.body?.pesan ?? ''),
  tagihanKedua.body?.pesan ?? '(tidak ada pesan)');
cek('tagihan kedua tidak ditulis', !dokumen.has('jatim_tagihan/PRABAWA-BULANAN-2'));

/*
 * ── Jalan keluarnya: lanjutkan atau batalkan ────────────────────────
 *
 * Dua-duanya diuji lewat endpoint sungguhan, karena tidak ada yang berguna
 * kalau hanya dibuktikan dari membaca source.
 */

// Lanjutkan: tagihan yang sudah ada tetap `menunggu`, tidak ada dokumen baru.
const lanjutLagi = await panggil(
  { aksi: 'tagihan:buat', orderId: 'PRABAWA-BULANAN-3', paketId: 'bulanan', metode: 'qris' },
  { token: tokenBudiBayar }
);
cek('percobaan ketiga tetap ditolak dengan orderId yang sama',
  lanjutLagi.status === 409 && lanjutLagi.body?.orderId === tagihanKedua.body?.orderId,
  `kode=${lanjutLagi.status} orderId=${lanjutLagi.body?.orderId}`);
cek('tidak ada dokumen tagihan tambahan yang tertulis',
  !dokumen.has('jatim_tagihan/PRABAWA-BULANAN-3'));

// Batalkan tagihan sendiri → boleh.
const batalMilikSendiri = await panggil(
  { aksi: 'tagihan:status', orderId: tagihanKedua.body?.orderId, status: 'batal' },
  { token: tokenBudiBayar }
);
cek('pemilik tagihan boleh membatalkannya sendiri', batalMilikSendiri.body?.ok === true,
  `dapat kode ${batalMilikSendiri.status} — ${batalMilikSendiri.body?.pesan ?? ''}`);
cek('status tagihan jadi batal',
  dokumen.get('jatim_tagihan/' + tagihanKedua.body?.orderId)?.status === 'batal');
cek('penanda pembatalan dicatat', batalMilikSendiri.body?.ok === true);

// Setelah dibatalkan, boleh membuat tagihan baru.
const setelahBatal = await panggil(
  { aksi: 'tagihan:buat', orderId: 'PRABAWA-BULANAN-7', paketId: 'bulanan', metode: 'qris' },
  { token: tokenBudiBayar }
);
cek('setelah dibatalkan, tagihan baru boleh dibuat', setelahBatal.body?.ok === true,
  `dapat kode ${setelahBatal.status} — ${setelahBatal.body?.pesan ?? ''}`);

/*
 * Tagihan milik **orang lain** tidak boleh dibatalkan, dan jawabannya 404.
 *
 * `PRABAWA-BULANAN-1` milik **budi** sendiri (dibuat di bagian "Empat field
 * dipalsukan"), jadi tagihan milik `siti` perlu dibuat dulu untuk kasus ini.
 *
 * 404, bukan 403: kalau tagihannya milik orang lain dan jawabannya 403, maka
 * `orderId` milik orang lain bisa dipetakan hanya dengan mencoba-menebak —
 * setiap tebakan benar membocorkan "tagihan ini ada".
 */
await panggil(
  { aksi: 'tagihan:buat', orderId: 'PRABAWA-TAHUNAN-SITI', paketId: 'tahunan', metode: 'qris' },
  { token: P.terbitkanToken('siti', 'user', partial({})) }
);
const tagihanSitiUntukBudi = 'PRABAWA-TAHUNAN-SITI';
cek('tagihan siti benar-benar ada dan menunggu',
  dokumen.get('jatim_tagihan/' + tagihanSitiUntukBudi)?.status === 'menunggu');

const batalMilikOrang = await panggil(
  { aksi: 'tagihan:status', orderId: tagihanSitiUntukBudi, status: 'batal' },
  { token: tokenBudiBayar }
);
cek('tagihan milik akun lain tidak bisa dibatalkan', batalMilikOrang.body?.ok === false,
  `dapat kode ${batalMilikOrang.status}`);
cek('dijawab 404, bukan 403 (tidak bisa dipetakan)',
  batalMilikOrang.status === 404,
  `dapat kode ${batalMilikOrang.status} — 403 mengonfirmasi orderId itu ada milik orang lain`);
cek('status tagihan milik orang lain tidak berubah',
  dokumen.get('jatim_tagihan/' + tagihanSitiUntukBudi)?.status === 'menunggu',
  `status jadi "${dokumen.get('jatim_tagihan/' + tagihanSitiUntukBudi)?.status}"`);

/*
 * Tagihan yang sudah `batal` tidak bisa dibatalkan lagi, dan `orderId` yang
 * tidak ada sama sekali juga 404 — keduanya hasil yang sama supaya tidak bisa
 * dibedakan.
 */
const batalYangTidakAda = await panggil(
  { aksi: 'tagihan:status', orderId: 'PRABAWA-TIDAK-ADA-999', status: 'batal' },
  { token: tokenBudiBayar }
);
cek('orderId yang tidak ada juga 404',
  batalYangTidakAda.status === 404 && batalMilikOrang.status === 404,
  `hanya keduanya sama, orderId tidak bisa dipetakan`);

// `lunas` tetap khusus admin — pengguna biasa tidak boleh menandai lunas.
const lunasPengguna = await panggil(
  { aksi: 'tagihan:status', orderId: setelahBatal.body?.orderId, status: 'lunas' },
  { token: tokenBudiBayar }
);
cek('pengguna biasa tidak boleh menandai tagihannya lunas', lunasPengguna.status === 403,
  `dapat kode ${lunasPengguna.status} — kalau 200, siapa pun bisa mengaktifkan langganan gratis`);
cek('status tidak berubah jadi lunas',
  dokumen.get('jatim_tagihan/PRABAWA-BULANAN-7')?.status !== 'lunas');

/*
 * Aturannya **per akun**: tagihan orang lain tidak boleh ikut terhitung.
 *
 * `budi` masih punya tagihan `menunggu` (yang dia buat tadi), jadi kalau
 * Implementasinya salah — mis. menghitung seluruh koleksi — `siti` ikut
 * tertolak. `siti` harus **boleh** membuat tagihannya sendiri.
 */
/*
 * Tagihan `menunggu` pertama `siti` dibuat di blok "tagihan milik orang lain"
 * di atas, jadi ia harus **dibatalkan dulu** — kalau tidak, dia sedang
 * menguji aturan yang salah.
 */
const batalTagihanSiti = await panggil(
  { aksi: 'tagihan:status', orderId: 'PRABAWA-TAHUNAN-SITI', status: 'batal' },
  { token: P.terbitkanToken('siti', 'user', partial({})) }
);
cek('tagihan siti yang tadi bisa dibatalkan oleh pemiliknya',
  batalTagihanSiti.body?.ok === true,
  `dapat kode ${batalTagihanSiti.status}`);

const tokenSitiTagih = P.terbitkanToken('siti', 'user', partial({}));
const tagihanSiti = await panggil(
  { aksi: 'tagihan:buat', orderId: 'PRABAWA-TAHUNAN-9', paketId: 'tahunan', metode: 'qris' },
  { token: tokenSitiTagih }
);
cek('aturan satu-tagihan dihitung per akun, bukan global',
  tagihanSiti.body?.ok === true,
  `dapat kode ${tagihanSiti.status} — budi masih punya tagihan menunggu, jadi siti harus tetap boleh`);

// ── Admin boleh, dan batasnya ditegakkan ─────────────────────────────
const tokenAdminBilling = P.terbitkanToken('siti', 'admin', partial({ tabManajemenAkun: true }));

const setGratisOlehAdmin = await panggil(
  { aksi: 'langganan:set-gratis', username: 'budi', gratis: true, alasan: 'Uji' },
  { token: tokenAdminBilling }
);
cek('admin boleh menandai akun gratis', setGratisOlehAdmin.body?.ok,
  `dapat kode ${setGratisOlehAdmin.status}`);

// Durasi yang tidak masuk akal harus ditolak — ini salah ketik yang tidak
// disadari selama berbulan-bulan kalau tidak dibatasi.
const durasiGila = await panggil(
  { aksi: 'langganan:perpanjang', username: 'budi', durasi: 100_000, satuan: 'tahun' },
  { token: tokenAdminBilling }
);
cek('durasi 100000 tahun ditolak', !durasiGila.body?.ok, `dapat kode ${durasiGila.status}`);
cek('pesan menyebut batasnya', /maksimal 10 tahun/.test(durasiGila.body?.pesan ?? ''),
  durasiGila.body?.pesan ?? '(tidak ada pesan)');

// Tanggal yang tidak bisa di-parse harus ditolak, bukan disimpan mentah —
// `masaAkhir` dibaca di banyak tempat dan string rusak jadi NaN yang tidak
// pernah terlihat.
const tanggalRusak = await panggil(
  { aksi: 'langganan:set-masa-akhir', username: 'budi', iso: 'bukan-tanggal' },
  { token: tokenAdminBilling }
);
cek('tanggal tidak valid ditolak', !tanggalRusak.body?.ok, `dapat kode ${tanggalRusak.status}`);

// `orderId` jadi kunci dokumen — path traversal harus ditolak.
const traversalTagihan = await panggil(
  { aksi: 'tagihan:hapus', orderId: '../../jatim_pengguna/budi' },
  { token: tokenAdminBilling }
);
cek('orderId berisi "../" ditolak', !traversalTagihan.body?.ok,
  `dapat kode ${traversalTagihan.status}`);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Firestore rules menutup jalan yang dipakai bug lama');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Firestore rules menutup jalan yang dipakai bug lama');
const rules = readFileSync(`${root}firestore.rules`, 'utf8');
const rulesKode = rules.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

cek('rules pakai versi 2', /rules_version = '2'/.test(rules));
cek(
  'jatim_pengguna: TIDAK boleh baca maupun tulis dari klien',
  /match \/jatim_pengguna\/\{username\}\s*\{\s*allow read, write: if false;/.test(rulesKode),
  'allow read/write: if true di sini = eskalasi role lewat DevTools'
);
cek(
  'jatim_pengguna tidak punya allow ... if true',
  !/match \/jatim_pengguna\/\{username\}[\s\S]{0,120}if true/.test(rulesKode)
);
cek(
  'jatim_pengaturan (auth + kredensial server): server-only',
  /match \/jatim_pengaturan\/\{docId\}\s*\{\s*allow read, write: if false;/.test(rulesKode)
);
cek(
  'billing tetap boleh dibaca (harga paket harus tampil)',
  /match \/jatim_pengaturan\/billing\s*\{\s*allow read: if true;/.test(rulesKode)
);
cek('billing tetap tidak boleh ditulis dari klien',
  /match \/jatim_pengaturan\/billing[\s\S]{0,140}allow write: if false;/.test(rulesKode));
/*
 * ⚠️ Sekarang **server-only sepenuhnya**, bukan hanya untuk tulis.
 *
 * Semula `allow read: if true` dengan alasan "gerbang perlu tahu masa aktif".
 * Tapi aplikasi tidak memakai Firebase Auth, jadi `request.auth` selalu `null`
 * dan `if true` berarti seluruh koleksi terbuka untuk siapa pun yang punya
 * API key — dan API key itu ada di bundle peramban.
 *
 * Yang bocor: `nip`, `masaAkhir`, `gratis` (siapa yang tidak membayar), dan
 * di tagihan juga `usernameLabel`, `nominal`, serta `buktiUrl`.
 *
 * Penggantinya: `POST /api/panel-auth` dengan `langganan:saya` /
 * `tagihan:saya` / `langganan:daftar` / `tagihan:daftar`.
 */
cek('langganan: server-only, baca maupun tulis',
  /match \/jatim_langganan\/\{username\}\s*\{\s*allow read, write: if false;/.test(rulesKode),
  'allow read: if true = NIP + masa aktif + status gratis terbuka untuk semua');
cek('tagihan: server-only, baca maupun tulis',
  /match \/jatim_tagihan\/\{orderId\}\s*\{\s*allow read, write: if false;/.test(rulesKode),
  'allow read: if true = nama + nominal + buktiUrl terbuka untuk semua');
cek('default menolak semua yang tidak dicakup', /match \/\{document=\*\*\}/.test(rulesKode));
cek('rules menjelaskan akar bug login-user-refresh-jadi-admin',
  /reload jadi admin/.test(rules),
  'penjelasan ini yang membuat orang tahu rules HARUS di-deploy');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Kode klien tidak pernah menyentuh Firestore untuk akun');
const kode = (f: string): string =>
  readFileSync(`${root}${f}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const akunSrc = kode('src/lib/akunFirestore.ts');
cek('akunFirestore tidak mengimpor firebase/firestore', !/from 'firebase\/firestore'/.test(akunSrc),
  'impor ini berarti klien masih membaca/menulis dokumen akun langsung');
cek('akunFirestore tidak mengimpor ../lib/firebase', !/from '\.\/firebase'/.test(akunSrc));
cek('verifyUserPassword dihapus total',
  !/export\s+(async\s+)?function\s+verifyUserPassword/.test(akunSrc));

const loginSrc = kode('src/components/LoginScreen.tsx');
cek('LoginScreen tidak membandingkan hash sendiri', !/verifyPinLayered/.test(loginSrc));
cek('LoginScreen tidak membaca pinHash/pinEncrypted', !/pinHash|pinEncrypted/.test(loginSrc));
cek('LoginScreen tidak punya pola "adminUsername ? … : true"',
  !/storedAdmin\s*\?/.test(loginSrc),
  'pola ini = username apa pun + password admin = admin penuh');
cek('LoginScreen meneruskan token ke setCurrentUser',
  /setCurrentUser\(akun,\s*token\)/.test(loginSrc),
  'tanpa token, sesi tidak bisa diverifikasi saat muat berikutnya');

const appCtx = kode('src/context/AppContext.tsx');
cek('AppContext memverifikasi sesi ke server', /verifikasiSesiPanel/.test(appCtx));
cek('AppContext tidak menaruh role dari storage sebelum verifikasi',
  !/useState<UserAccountSafe \| null>\(\s*\(\)\s*=>\s*initialSession/.test(appCtx),
  'menaruh role dari storage = persis bug "refresh jadi admin"');
cek('AppContext punya state cekingSesi', /cekingSesi/.test(appCtx));

/*
 * ⚠️ `setTabPermissions()` harus TIDAK ada lagi di context.
 *
 * Semula ada, dan pemanggilnya bisa menulis izin tab/aksi apa saja dari
 * peramban. Selama setter itu ada, ada jalur membuat tampilan berbeda dari
 * yang server tahu — persis kelas bug yang sedang ditutup di sini.
 *
 * Menghapus setter itu bukan sekadar merapikan: ia menutup satu-satunya
 * cara membuat hak akses di layar yang tidak berasal dari server.
 */
cek('AppContext tidak mengekspor setTabPermissions',
  !/setTabPermissions:/.test(appCtx),
  'setter izin dari peramban = tampilan bisa berbeda dari server');
cek('setter-nya benar-benar hilang dari implementasinya',
  !/const setTabPermissions/.test(appCtx));
/*
 * Lima titik penulisan `tabPermissions`, dan **semuanya** punya alasan:
 *
 * 1. nilai awal saat mount — `UNAUTHENTICATED_PERMISSIONS`, bukan apa pun
 *    dari storage;
 * 2. hasil verifikasi server (`izinServer`);
 * 3–4. reset ke kosong — logout, dan `setCurrentUser()` tanpa token;
 * 5. `setCurrentUser()` dengan akun hasil login server.
 *
 * Yang tidak boleh ada: penulisan dari nilai yang datang dari storage atau dari
 * argumen UI. Itu yang dicek di sini — jumlahnya harus **tepat** lima, supaya
 * setter yang ditambahkan diam-diam akan terlihat.
 */
const titikTulis = appCtx.match(/setTabPermissionsState\(/g) ?? [];
cek('tabPermissions ditulis tepat 5 kali, semua dari server', titikTulis.length === 5,
  `${titikTulis.length} titik tulis — kalau bertambah, cek dari mana nilainya datang`);
cek('nilai awalnya UNAUTHENTICATED_PERMISSIONS',
  /useState<TabPermissions>\(UNAUTHENTICATED_PERMISSIONS\)/.test(appCtx),
  'role/izin dari storage TIDAK boleh dipasang sebelum server mengonfirmasi');
cek('reset ke kosong ada minimal 3 kali (logout, token hilang, setCurrentUser tanpa token)',
  (appCtx.match(/setTabPermissionsState\(UNAUTHENTICATED_PERMISSIONS\)/g) ?? []).length === 3);

/*
 * Izin harus **dimuat ulang** untuk berubah. Kalau tidak, admin yang menurunkan
 * izin tidak akan melihat efeknya sampai logout.
 */
cek(
  'AppContext memuat ulang izin dari server saat verifikasi',
  /batasiIzin\(hasil\.akun\.permissions, hasil\.akun\.role\)/.test(appCtx)
);
cek('selama cekingSesi, izin kosong', /UNAUTHENTICATED_PERMISSIONS/.test(appCtx));
cek('setCurrentUser menolak tanpa token', /setCurrentUser tanpa token/.test(appCtx));
cek('saveSession dipanggil dengan token', /saveSession\(user,\s*permissions,\s*token\)/.test(appCtx));

const appSrc = kode('src/App.tsx');
/*
 * `memeriksaSesi` memang boleh membaca `loadSession()` — itu hanya membandingkan
 * "ada token atau tidak", bukan mempercayai isinya. Yang dilarang adalah memakai
 * storage sebagai bukti **autentikasi**.
 *
 * Karena itu polanya di sini sengaja spesifik pada `isAuthenticated`, bukan
 * "tidak boleh ada `useState(() => !!loadSession())`" — yang akan salah
 * menandai pemakaian yang memang benar.
 */
cek('isAuthenticated dimulai false, bukan dari storage',
  /const \[isAuthenticated, setIsAuthenticated\] = useState\(false\)/.test(appSrc),
  'isAuthenticated dari storage = render aplikasi dengan role yang belum diverifikasi');
cek('tidak ada setIsAuthenticated yang membaca storage',
  !/setIsAuthenticated\(\s*\(\)\s*=>\s*!!loadSession/.test(appSrc));
cek('layar tunggu mengikuti status verifikasi dari AppContext',
  /const memeriksaSesi = cekingSesi/.test(appSrc) &&
  /if \(cekingSesi\) return;\s*setIsAuthenticated\(currentUser !== null\)/.test(appSrc),
  'verifikasi sukses membuka aplikasi; sesi yang ditolak tetap tidak terautentikasi');
cek('App menunda render saat memeriksa sesi', /memeriksaSesi|LayarMemeriksaSesi/.test(appSrc));
cek('request panel-auth punya timeout dan AbortSignal',
  /PANEL_AUTH_TIMEOUT_MS = 15_000/.test(akunSrc) &&
  /setTimeout\(\(\) => controller\.abort\(\), PANEL_AUTH_TIMEOUT_MS\)/.test(akunSrc) &&
  /signal: controller\.signal/.test(akunSrc),
  'request yang menggantung berakhir maksimal 15 detik');
cek('App memeriksa token secara berkala', /verifikasiSesiPanel/.test(appSrc));
cek('jaringan mati tidak mengunci pengguna', /err\.kode === 0/.test(appSrc));

// ── Sesi: token wajib ───────────────────────────────────────────────
console.log('\n=== 8. Sesi tanpa token ditolak modul sesi');
const sesSrc = kode('src/lib/sessionManager.ts');
cek('saveSession mewajibkan token', /typeof token !== 'string' \|\| !token\.trim\(\)/.test(sesSrc));
cek('saveSession melempar tanpa token', /throw new Error/.test(sesSrc));
cek('versi sesi dinaikkan ke 2 (sesi lama dibuang)',
  /SESSION_VERSION = 2/.test(sesSrc),
  'tanpa ini sesi versi 1 yang bisa disunting tetap dipakai');
cek('bacaSatu menolak sesi tanpa token', /typeof session\.token !== 'string' \|\| !session\.token/.test(sesSrc));
cek('bacaSatu menolak token yang bukan dua bagian', /session\.token\.split\('\.'\)\.length !== 2/.test(sesSrc));
cek('tokenAktif tersedia untuk modul lain', /export function tokenAktif/.test(sesSrc));
cek('perbaruiTokenSesi tersedia', /export function perbaruiTokenSesi/.test(sesSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 9. Password server pusat tidak pernah di peramban');
const panelSrc = kode('src/lib/panelServer.ts');
cek('autoLoginPusat ada di server', /export async function autoLoginPusat/.test(panelSrc));
cek('server yang mendekripsi kredensial', /dekripsi\(String\(data\.passwordEncrypted/.test(panelSrc));
cek('kredensial dienkripsi dengan kunci turunan server',
  /createCipheriv\('aes-256-gcm',\s*kunciKredensial\(\)/.test(panelSrc),
  'AES dengan VITE_APP_SECRET bukan rahasia — kuncinya ada di bundle');

const autoSrc = kode('src/lib/serverAutoLogin.ts');
cek('auto-login tidak mendekripsi password di peramban', !/decryptAppCredential/.test(autoSrc));
cek('auto-login tidak memanggil rpcLogin sendiri', !/\brpcLogin\b/.test(autoSrc));
cek('auto-login memakai endpoint server', /autoLoginServerPusat/.test(autoSrc));

/*
 * ⚠️ `src/lib/encryption.ts` **sudah tidak ada**.
 *
 * Modul itu hanya menyisakan pembaca v1 + validator v2, dan keduanya pun
 * tidak punya pemanggil: server punya `verifikasiLegacyPin()` sendiri, dan
 * ciphertext `v2` tidak pernah dikirim ke peramban. Kuncinya ada di
 * `VITE_APP_SECRET` yang Vite suntikkan ke bundle — jadi modul seperti itu
 * tidak boleh ada di sisi klien sama sekali. Yang menggantikannya:
 * `lib/pin.ts` (bcrypt, server) + `lib/panelServer.ts` (AES-256-GCM).
 */
cek('tidak ada modul encryption.ts di sisi klien',
  !existsSync(join(root, 'src/lib/encryption.ts')),
  'kuncinya ada di bundle peramban');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 10. Bentuk kode yang mencegah regresi');
cek('ada endpoint /api/panel-auth di Express',
  /app\.post\('\/api\/panel-auth'/.test(kode('src/api/server.ts')));
/*
 * Express mengimpor handler-nya secara dinamis (`await import(...)`) supaya
 * `firebase-admin` tidak ikut terbaca saat server dinyalakan — sama seperti
 * route billing. Jadi polanya bukan `from '...'`, tapi specifier di dalam
 * `import()`.
 */
cek('Express dan Vercel memakai handler yang sama',
  /import\('\.\.\/serverless\/_panel'\)/.test(kode('src/api/server.ts')) &&
    /from '\.\/_panel'/.test(kode('src/serverless/panel-auth.ts')));
cek('secret dibaca hanya dari process.env (tidak pernah import.meta.env)',
  /process\.env\.PANEL_SESSION_SECRET/.test(panelSrc) &&
    !/import\.meta\.env/.test(panelSrc),
  'import.meta.env ikut ter-bundle ke peramban — secret akan bocor ke sana');
cek('secret minimal 32 karakter ditegakkan', /nilai\.length < 32/.test(panelSrc));
cek('tidak ada nilai bawaan secret', !/PANEL_SESSION_SECRET \|\| ['"]/.test(panelSrc),
  'nilai bawaan = rahasia publik');
cek('perbandingan tanda tangan timing-safe', /timingSafeEqual/.test(panelSrc));
cek('login memakai dua lapis pembatas (IP + akun)',
  /BATAS_PER_IP/.test(panelSrc) && /BATAS_PER_AKUN/.test(panelSrc));
cek('nonaktif ditegakkan saat login', /!doc\.nonaktif/.test(panelSrc));
cek('nonaktif ditegakkan saat verifikasi token', /doc\.nonaktif/.test(panelSrc));
cek('username admin bawaan punya nilai bawaan yang tetap',
  /return nama \|\| NAMA_ADMIN_BAWAAN/.test(panelSrc),
  'field kosong harus berarti "admin", bukan "apa pun"');
cek('admin terakhir tidak bisa mengunci panel', /ini admin terakhir/i.test(panelSrc));
cek(
  'role di body hanya diterima sebagai admin/user — bukan nilai bebas',
  /role: \(str\(body\.role\) === 'admin' \? 'admin' : 'user'\) as UserRole/.test(kode('src/serverless/_panel.ts')),
  'peran dari body tanpa batas = pengguna akademis jadi admin'
);
cek('kredensial hanya untuk akun sendiri atau admin',
  /pemanggil\.role === 'admin' \? pemanggil : null/.test(panelSrc));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1h. Admin mengisi kredensial server → auto-login-benar jalan');
/*
 * Permintaan eksplisit: "untuk auto login akun user ke server dengan nip
 * password dan imei yg diatur dari manajemen akun itu harus berfungsi, harus
 * auto login berhasil ke server".
 *
 * ## Tiga bug yang membuat fitur ini tidak pernah berhasil
 *
 * Semuanya "tidak salah" menurut respons server: `{ ok: true }`. Yang gagal
 * adalah hal yang tidak terlihat.
 *
 * **1. Dokumen ditulis ke akun pemanggil, bukan akun tujuan.**
 * `simpanKredensial()` / `ringkasKredensial()` / `hapusKredensial()` memakai
 * `dokKredensial(pemanggil.username)`. Untuk akun biasa, pemanggil = tujuan,
 * jadi tidak kelihatan. Untuk **admin** — satu-satunya orang yang mengisi
 * kredensial akun orang lain — hasilnya: kredensial "budi" tersimpan di
 * dokumen admin, kredensial admin sendiri tertimpa, dan "Keluar dari Server"
 * di dialog edit membaca ringkasan admin.
 *
 * **2. Auto-login membaca dokumen yang sama salahnya.**
 * `autoLoginPusat()` memakai `dokKredensial(pemanggil.username)`. Di jalur
 * auto-login keduanya sama, jadi tidak salah *sekarang* — tapi menjebak
 * pembacaan ini pada dokumen yang salah begitu pun dipanggil untuk akun lain.
 *
 * **3. IMEI yang diisi admin selalu dibuang.**
 * `opsi.imei ?? data.imei` — `??` hanya memakai `data.imei` kalau `opsi.imei`
 * nullish. Tapi `opsi.imei` adalah TechMark dari peramban (`imeiStabil()`),
 * UUID yang **tidak pernah kosong**. Jadi UUID random itu selalu menang, dan
 * IMEI yang diketik admin dibuang. Untuk akun yang server-nya mengunci ke satu
 * perangkat, itu login ditolak 402 apa pun yang diisi admin.
 *
 * Uji di bawah menguji **hasil akhirnya**: isi lewat API yang dipanggil UI,
 * lalu jalankan auto-login dan periksa payload yang benar-benar dikirim ke
 * gateway.
 */
seed();
P.resetPembatasPercobaan();

/*
 * ⚠️ Semua nilai **harus berbeda dari nilai seed**.
 *
 * Seed menaruh `nip: '200308062025101001'` di dokumen budi. Kalau nilai uji
 * memakai NIP yang sama, assertion "NIP tersimpan di dokumen target" akan
 * lulus even though tidak ada yang tersimpan — dokumen lama punya NIP itu
 * juga. Uji yang tidak bisa membedakan "benar" dari "tidak terjadi" lebih
 * berbahaya daripada tidak ada uji.
 */
const CRED = {
  budi: { nip: '111111111111111111', sandi: 'Sandi-Budi-2026', imei: 'IMEI-DARI-ADMIN' },
  siti: { nip: '197001012000011001', sandi: 'Sandi-Siti-2026', imei: 'IMEI-SITI' },
};
cek('NIP uji berbeda dari NIP seed (uji ini harus bisa membedakan)',
  CRED.budi.nip !== '200308062025101001',
  'kalau sama, assertion di bawah lulus tanpa ada yang benar-benar tersimpan');

const simpanUntukBudi = await P.simpanKredensial(tokenSitiAdmin, {
  username: 'budi',
  nip: CRED.budi.nip,
  password: CRED.budi.sandi,
  imei: CRED.budi.imei,
});
cek('admin boleh menyimpan kredensial akun lain', simpanUntukBudi.ok,
  `dapat kode ${simpanUntukBudi.kode} — ${simpanUntukBudi.pesan ?? ''}`);

const dokBudi = dokumen.get(KUNCI.pengaturan('kredensial_server__budi'));
const dokSitiLama = dokumen.get(KUNCI.pengaturan('kredensial_server__siti'));

/*
 * ⚠️ Bug 1. Dokumen "budi" harus berisi NIP yang baru.
 *
 * Sebelum diperbaiki, `simpan()` menulis ke `kredensial_server__siti` (dokumen
 * admin), jadi dokumen budi tetap berisi NIP hasil seed.
 */
cek('NIP tersimpan di dokumen AKUN YANG DITUJU, bukan dokumen admin',
  dokBudi?.nip === CRED.budi.nip,
  `dokumen budi berisi nip="${dokBudi?.nip}" — seharusnya "${CRED.budi.nip}"`);
cek('IMEI tersimpan di dokumen akun yang dituju',
  dokBudi?.imei === CRED.budi.imei,
  `dokumen budi berisi imei="${dokBudi?.imei}"`);
cek('kredensial admin sendiri tidak tertimpa',
  dokSitiLama?.nip === '197001012000011001' && dokSitiLama?.imei === '',
  `dokumen admin berisi nip="${dokSitiLama?.nip}" imei="${dokSitiLama?.imei}"`);

// ⚠️ Bug 1 juga di jalur baca: ringkasan harus milik target.
const ringkasTarget = await P.ringkasKredensial(tokenSitiAdmin, 'budi');
cek('admin membaca ringkasan milik AKUN YANG DITUJU',
  ringkasTarget.ringkasan?.nip === CRED.budi.nip &&
    ringkasTarget.ringkasan?.imei === CRED.budi.imei,
  `dapat nip="${ringkasTarget.ringkasan?.nip}" imei="${ringkasTarget.ringkasan?.imei}"`);
cek('ringkasan target melaporkan password bisa dibaca',
  ringkasTarget.ringkasan?.terbaca === true,
  'password yang baru disimpan harus bisa didekripsi server');

// Case-insensitive: username disimpan lowercase, jadi "BUDI" harus mendarat
// di dokumen yang sama. Tanpa `toLowerCase()` di nama dokumen, ini jadi dua
// dokumen untuk satu akun dan auto-login gagal.
const simpanBudiHurufBesar = await P.simpanKredensial(tokenSitiAdmin, {
  username: 'BUDI',
  nip: CRED.budi.nip,
  password: '',
  imei: CRED.budi.imei,
});
cek('username huruf besar tetap mendarat di dokumen yang sama', simpanBudiHurufBesar.ok,
  `dapat kode ${simpanBudiHurufBesar.kode}`);
cek('tidak ada dokumen terpisah untuk "BUDI"',
  !dokumen.has(KUNCI.pengaturan('kredensial_server__BUDI')),
  'dua dokumen untuk satu akun = auto-login tidak pernah menemukan kredensialnya');

// ── Auto-login: buktikan payload yang benar-benar dikirim ke gateway ──
//
// Gateway ditiru supaya payload bisa diperiksa. Yang diperiksa adalah isi
// `params` pada envelope `login` — bukan hanya "tidak error", karena login
// yang ditolak 402 karena IMEI salah **tidak** melempar di peramban.
/**
 * Body request yang terakhir ditangkap.
 *
 * Ditulis dari dalam stub `fetch` dan dibaca dari luar, jadi disimpan di
 * objek: variabel biasa akan disempitkan TypeScript jadi `null` di setiap
 * titik baca.
 */
const tangkap: { payload: Record<string, any> | null } = { payload: null };
const payloadTertangkap = (): Record<string, any> => tangkap.payload ?? {};

const fetchAsli = globalThis.fetch;
globalThis.fetch = (async (_url: URL | RequestInfo, opsi?: RequestInit) => {
  tangkap.payload = JSON.parse(String(opsi?.body ?? '{}')) as Record<string, any>;
  return new Response(
      JSON.stringify({
        result: {
          nama: 'Budi Santoso',
          nip: '200308062025101001',
          jabatan: 'Analis',
          api_key: 'APIKEY-FAKE',
          id_lokasi: '',
          kode_instansi: '',
          kode_unor: '',
        },
      }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as typeof globalThis.fetch;

try {
  // TechMark peramban — sengaja dibuat **berbeda** dari IMEI yang diisi admin.
  // Kalau yang dikirim adalah ini, berarti bug 3 masih ada.
  const techMarkPeramban = 'UUID-RANDOM-DARI-PERAMBAN';
  const hasilAutoLogin = await P.autoLoginPusat(tokenBudi, 'budi', { imei: techMarkPeramban });

  cek('auto-login berhasil', hasilAutoLogin.ok,
    hasilAutoLogin.ok ? '' : `kode ${hasilAutoLogin.kode}: ${hasilAutoLogin.pesan}`);
  cek('api_key dikembalikan ke peramban',
    hasilAutoLogin.ok && hasilAutoLogin.apiKey === 'APIKEY-FAKE');

  // Bentuk envelope: `{ jsonrpc, method, version, object, param }`.
  // `method` selalu 'POST' — nama operasinya ada di `object`.
  const params = payloadTertangkap().param;
  cek('envelope yang dikirim adalah object=login', payloadTertangkap().object === 'login',
    `object="${payloadTertangkap().object}"`);
  cek('NIP yang dipakai login = NIP yang diisi admin',
    params.email === CRED.budi.nip,
    `email="${params?.email}" — dari NIP yang diisi admin`);
  cek('password yang dipakai login = password yang diisi admin',
    params?.password === CRED.budi.sandi,
    'password harus berasal dari dekripsi kredensial yang disimpan');
  cek('login mengirim latlong netral yang valid',
    params.latlong === '0,0',
    `latlong="${params.latlong}" — field kosong ditolak gateway v89`);
  /*
   * ⚠️ Bug 3. Ini assertion kunci dari seluruh bagian ini.
   *
   * Dengan `opsi.imei ?? data.imei`, yang terkirim adalah UUID random dari
   * peramban — dan untuk akun yang terkunci ke perangkat, server menjawab 402.
   * Manager Akun terlihat "berhasil" menyimpan, dan orangnya tidak bisa masuk.
   */
  cek('IMEI yang dipakai login = IMEI yang diisi admin, BUKAN TechMark peramban',
    params.imei === CRED.budi.imei,
    `imei="${params.imei}" — TechMark peramban akan ditolak 402 untuk akun terkunci`);
} finally {
  globalThis.fetch = fetchAsli;
}

/* Fallback: kalau admin belum mengisi IMEI, TechMark peramban tetap dipakai.
 * Itu penting — tanpa fallback, akun yang TIDAK terkunci ke perangkat akan
 * kehilangan faktor ketiga dan bisa ditolak. */
dokumen.set(KUNCI.pengaturan('kredensial_server__budi'), {
  ...dokBudi,
  imei: '',
});
const tangkapTanpaImei: { param: Record<string, any> } = { param: {} };
globalThis.fetch = (async (_url: URL | RequestInfo, opsi?: RequestInit) => {
  tangkapTanpaImei.param =
    (JSON.parse(String(opsi?.body ?? '{}')) as Record<string, any>).param ?? {};
  return new Response(JSON.stringify({ result: { nama: 'Budi', api_key: 'K2' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof globalThis.fetch;
try {
  const tanpaImei = await P.autoLoginPusat(tokenBudi, 'budi', { imei: 'UUID-PERAMBAN' });
  cek('auto-login tetap jalan saat admin belum mengisi IMEI', tanpaImei.ok,
    tanpaImei.ok ? '' : `kode ${tanpaImei.kode}: ${tanpaImei.pesan}`);
  cek('TechMark peramban dipakai sebagai pengganti',
    tangkapTanpaImei.param.imei === 'UUID-PERAMBAN',
    `imei="${tangkapTanpaImei.param.imei}"`);
} finally {
  globalThis.fetch = fetchAsli;
}

// Kembalikan IMEI agar pemeriksaan hapus di bawah tidak ambigu.
dokumen.set(KUNCI.pengaturan('kredensial_server__budi'), { ...dokBudi });

// ⚠️ Bug 1 pada hapus: menghapus kredensial "budi" tidak boleh menghapus
// dokumen admin.
const hapusUntukBudi = await P.hapusKredensial(tokenSitiAdmin, 'budi');
cek('admin boleh menghapus kredensial akun lain', hapusUntukBudi.ok,
  `dapat kode ${hapusUntukBudi.kode}`);
cek('dokumen target terhapus',
  !dokumen.has(KUNCI.pengaturan('kredensial_server__budi')));
cek('dokumen admin tidak ikut terhapus',
  dokumen.has(KUNCI.pengaturan('kredensial_server__siti')),
  'hapus untuk "budi" menghapus dokumen admin = admin kehilangan kredensialnya sendiri');

// Pengaman: tidak boleh ada nama dokumen kredensial yang dibangun dari pemanggil.
const funcsKredensial = ['simpanKredensial', 'ringkasKredensial', 'hapusKredensial', 'autoLoginPusat'];
for (const nama of funcsKredensial) {
  const badan = (P as unknown as Record<string, () => void>)[nama].toString();
  cek(`${nama} tidak memakai pemanggil.username untuk nama dokumen`,
    !/dokKredensial\(pemanggil\.username\)/.test(badan),
    'pemanggil=admin, target=akun lain — keduanya berbeda dokumen');
}

// ═════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1i. Lewat handler HTTP: yang dipakai peramban sungguhan');
/*
 * Bagian 1h memanggil `P.simpanKredensial()` / `P.autoLoginPusat()` **langsung**,
 * melewati `_panel.ts`. Itu membuktikan logikanya benar, tapi tidak
 * membuktikan apa pun tentang:
 *
 * - nama aksinya cocok antara klien dan server
 * - `str(body.x)` meneruskan nilainya dengan benar
 * - aksi `kredensial:ringkas-semua` benar-benar terdaftar di `switch`
 * - setiap respons membawa `kontrakVersi`
 *
 * Keempatnya bisa rusak tanpa satu pun assertion yang gagal. Dan ketiganya
 * sudah pernah rusak sungguhan: `kredensial:ringkas-semua` tidak ada di
 * versi server yang sedang ter-deploy, dan peramban memanggilnya di dalam
 * `.catch(() => new Map())` — jadi semua akun menampilkan "Kredensial belum
 * diatur" tanpa penjelasan.
 *
 * Jadi di sini alurnya dipanggil lewat `tanganiPanelAuth()`, persis seperti
 * `POST /api/panel-auth` dari peramban.
 */
{
  const { KONTRAK_VERSI } = await import('../src/lib/kontrakServer.ts');

  /*
   * Token diterbitkan langsung, bukan lewat `aksi: 'masuk'`.
   *
   * `pinHash` dan `passwordHash` di seed ini **palsu** — string bcrypt yang
   * tidak cocok dengan apa pun, dan memang tidak pernah diverifikasi. Jadi
   * `masuk` akan selalu 401, dan mengujinya hanya akan menguji hash.
   *
   * Yang sedang diuji di bagian ini adalah **routing dan bentuk data** di
   * `_panel.ts` — bukan verifikasi password.
   */
  seed();
  P.resetPembatasPercobaan();
  const tokenAdminHandler = P.terbitkanToken('siti', 'admin', partial({ tabManajemenAkun: true }));

  // 2. Admin menyimpan kredensial lewat handler.
  const simpan = await panggil(
    {
      aksi: 'kredensial:simpan',
      username: 'budi',
      nip: '222222222222222222',
      password: 'Sandi-Budi-Handler',
      imei: 'IMEI-HANDLER',
    },
    { token: tokenAdminHandler }
  );
  cek('kredensial:simpan lewat handler berhasil', simpan.status === 200,
    `status ${simpan.status}: ${simpan.body?.pesan ?? ''}`);
  cek('kredensial masuk ke dokumen AKUN YANG DITUJU',
    dokumen.get(KUNCI.pengaturan('kredensial_server__budi'))?.nip === '222222222222222222',
    `dokumen budi: nip="${dokumen.get(KUNCI.pengaturan('kredensial_server__budi'))?.nip}"`);
  cek('dokumen admin tidak tertimpa',
    dokumen.get(KUNCI.pengaturan('kredensial_server__siti'))?.nip === '197001012000011001');

  // 3. Aksi batch — yang dulu tidak ada di server versi lama.
  const batch = await panggil({ aksi: 'kredensial:ringkas-semua' }, { token: tokenAdminHandler });
  cek('kredensial:ringkas-semua terdaftar di handler', batch.status === 200,
    `status ${batch.status} — aksi ini tidak ada di server versi lama, dan hasilnya sempat ditelan tanpa jejak`);
  cek('batch memuat kredensial yang baru disimpan',
    batch.body?.daftar?.budi?.imei === 'IMEI-HANDLER',
    `daftar: ${JSON.stringify(batch.body?.daftar ?? {})}`);

  // 4. `pusat:login` — jalur auto-login yang dipakai peramban.
  const tokenBudiHandler = P.terbitkanToken('budi', 'user', partial({ tabBeranda: true }));

  const paramMasuk: { param: Record<string, any> } = { param: {} };
  const fetchAsliHandler = globalThis.fetch;
  globalThis.fetch = (async (_u: URL | RequestInfo, opsi?: RequestInit) => {
    paramMasuk.param =
      (JSON.parse(String(opsi?.body ?? '{}')) as Record<string, any>).param ?? {};
    return new Response(JSON.stringify({ result: { nama: 'Budi', api_key: 'K-HANDLER' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  try {
    const login = await panggil(
      { aksi: 'pusat:login', username: 'budi', imei: 'UUID-PERAMBAN' },
      { token: tokenBudiHandler }
    );
    cek('pusat:login lewat handler berhasil', login.status === 200,
      `status ${login.status}: ${login.body?.pesan ?? ''}`);
    cek('NIP dari kredensial admin dipakai', paramMasuk.param.email === '222222222222222222',
      `email="${paramMasuk.param.email}"`);
    cek('IMEI dari kredensial admin dipakai, bukan TechMark peramban',
      paramMasuk.param.imei === 'IMEI-HANDLER',
      `imei="${paramMasuk.param.imei}"`);
    cek('login lewat handler juga mengirim latlong netral yang valid',
      paramMasuk.param.latlong === '0,0',
      `latlong="${paramMasuk.param.latlong}" — field kosong ditolak gateway v89`);
  } finally {
    globalThis.fetch = fetchAsliHandler;
  }

  // 5. `kontrakVersi` ada di SETIAP respons — termasuk yang menolak.
  cek('respons berhasil membawa kontrakVersi',
    simpan.body?.kontrakVersi === KONTRAK_VERSI,
    `kontrakVersi=${simpan.body?.kontrakVersi}, diharapkan ${KONTRAK_VERSI}`);
  cek('respons Origin ditolak juga membawa kontrakVersi',
    (await panggil({ aksi: 'nonsense' }, { origin: 'https://penyerang.example.net' }))
      .body?.kontrakVersi === KONTRAK_VERSI,
    'tanpa ini, 403 CORS membuat peramban mengira servernya versi lama');
  cek('respons method salah juga membawa kontrakVersi',
    (await panggil({}, { method: 'GET' })).body?.kontrakVersi === KONTRAK_VERSI,
    'tanpa ini, 405 membuat peramban mengira servernya versi lama');
  cek('respons aksi tak dikenal juga membawa kontrakVersi',
    (await panggil({ aksi: 'aksi-yang-tidak-ada' }, { token: tokenAdminHandler }))
      .body?.kontrakVersi === KONTRAK_VERSI);
  cek('kontrakVersi tidak bisa ditimpa oleh isi body server',
    /\.\.\.\([^)]*badan[^)]*\),\s*\n\s*kontrakVersi: KONTRAK_VERSI/.test(
      readFileSync(new URL('../src/serverless/_panel.ts', import.meta.url), 'utf8')
    ),
    'spread SETELAH kontrakVersi = kode server bisa mengirim angka sendiri');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 12. Pembatas percobaan: hanya menghitung yang gagal');
// ═════════════════════════════════════════════════════════════════════
/*
 * ⚠️ Bagian yang paling mudah terbalik, dan paling merusak kalau terbalik.
 *
 * Semula kedua baris penhitungan berjalan untuk **semua** percobaan, termasuk
 * yang berhasil. Akibatnya batas "20 percobaan per IP" sebenarnya adalah batas
 * 20 *login*, dan batas "8 percobaan per akun" adalah batas 8 *login berhasil*:
 *
 * - satu kantor yang berbagi satu IP di belakang NAT terkunci seluruhnya
 *   setelah 20 orang masuk dalam 10 menit;
 * - tiap akun terkunci setelah 8 kali login **benar** — persis kebalikan dari
 *   yang dimaksud, dan terulang setiap kali token kedaluwarsa.
 *
 * Jadi penhitungan harus ada di cabang kegagalan saja, dan di dalam blok
 * yang sama dengan `return 401`. Diuji lewat kode karena bergantung pada alur
 * kontrol: tidak ada cara memicunya lewat handler tanpa fixture.
 */
{
  const src = readFileSync(new URL('../src/lib/panelServer.ts', import.meta.url), 'utf8');
  const polos = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const masuk = polos.slice(
    polos.indexOf('export async function masukPanel'),
    polos.indexOf('export async function', polos.indexOf('export async function masukPanel') + 10)
  );
  cek('penhitungan berada di dalam cabang "tidak ada akun"',
    /if \(!akun\) \{[\s\S]{0,300}catatGagal\(percobaanIp, ip\);[\s\S]{0,200}catatGagal\(percobaanAkun, nama\);[\s\S]{0,120}return \{ ok: false, kode: 401/.test(masuk),
    'dua-duanya harus di blok yang sama dengan return 401');
  cek('tidak ada penhitungan di jalur kredensial benar',
    !/kode: 401[\s\S]{0,120}\}\s*\n\s*catatGagal\(/.test(masuk),
    'penhitungan setelah kredensial terbukti benar = orang yang benar justru terkunci');
  cek('fungsi penhitungan bernama catatGagal, bukan catat',
    /function catatGagal\(/.test(polos) && !/\nfunction catat\(/m.test(polos),
    'nama `catat` tidak menyatakan bahwa itu hanya untuk kegagalan; `catatGagal` tidak bisa salah dibaca');
  cek('tidak ada pemanggilan catat() yang tersisa',
    !/(^|[^G])\bcatat\(/m.test(polos),
    'semua pemanggilan harus lewat catatGagal');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 13. Peta pembatas dan pindai akun tidak tumbuh tanpa batas');
// ═════════════════════════════════════════════════════════════════════
/*
 * Dua biaya tak terbatas yang bisa dipicu dari luar.
 *
 * 1. **Peta pembatas.** `pangkas()` dulu hanya menghapus entri yang sudah lewat
 *    jendela lalu berhenti. Padahal serangan yang paling umum adalah mengirim
 *    banyak kunci berbeda dalam jendela yang sama — sehingga tidak ada entri
 *    yang boleh dihapus, dan peta tumbuh terus sampai instance kehabisan memori.
 *    Sekarang ada tahap kedua: kalau masih di atas batas, entri terlama
 *    dibuang paksa. Yang hilang paling banter satu penyerang; yang tidak
 *    dibuang adalah seluruh instance.
 * 2. **Pindai koleksi akun.** `ubahAkun` mencari "admin lain" dengan membaca
 *    seluruh `jatim_pengguna`. Informasi yang dibutuhkan cuma satu, dan
 *    Firestore bisa menjawabnya langsung: `where('role','==','admin').limit(2)`.
 */
{
  const src = readFileSync(new URL('../src/lib/panelServer.ts', import.meta.url), 'utf8');
  const polos = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const pangkas = polos.slice(
    polos.indexOf('function pangkas(peta'),
    polos.indexOf('export function resetPembatasPercobaan')
  );
  cek('pangkas punya tahap kedua: buang entri terlama saat masih penuh',
    /BATAS_ENTRI_PEMBATAS/.test(pangkas) &&
      /\.sort\(\(a, b\) => a\[1\]\.mulai - b\[1\]\.mulai\)/.test(pangkas) &&
      /peta\.delete\(urut\[i\]\[0\]\)/.test(pangkas),
    'hapus entri kedaluwarsa saja tidak membatasi apa pun ketika semua kunci masih dalam jendela');

  const ubah = polos.slice(
    polos.indexOf('export async function ubahAkun'),
    polos.indexOf('export async function hapusAkun')
  );
  cek('pemeriksaan admin terakhir memakai query terarah',
    /where\('role', '==', 'admin'\)/.test(ubah) && /\.limit\(2\)/.test(ubah),
    'baca seluruh koleksi hanya untuk satu pertanyaan yang bisa dijawab server');
  cek('tidak ada .get() tanpa batas pada koleksi akun di dalam ubahAkun',
    !/\.collection\(COLL_PENGGUNA\)\.get\(\)/.test(ubah),
    'satu penurunan admin terakhir bisa membaca ratusan dokumen yang tidak relevan');

  cek('daftarAkun dibatasi dan menolak, bukan memotong diam-diam',
    /BATAS_AKUN_PANEL/.test(polos) &&
      /\.collection\(COLL_PENGGUNA\)\.limit\(BATAS_AKUN_PANEL \+ 1\)/.test(polos) &&
      /kode: 409/.test(polos),
    'memotong daftar membuat admin melihat tabel yang tampak lengkap padahal tidak');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== Rename username memindahkan seluruh data akun');
{
  dokumen.set('jatim_langganan/budi', {
    username: 'budi',
    masaAkhir: '2027-05-01T00:00:00.000Z',
    totalBayar: 100_000,
  });
  dokumen.set('jatim_tagihan/ORDER-BUDI-1', {
    orderId: 'ORDER-BUDI-1',
    username: 'budi',
    usernameLabel: 'budi',
    status: 'lunas',
  });
  dokumen.set('jatim_tagihan/ORDER-BUDI-2', {
    orderId: 'ORDER-BUDI-2',
    username: 'budi',
    usernameLabel: 'Budi Santoso',
    status: 'menunggu',
  });
  dokumen.set(KUNCI.pengaturan('kredensial_server__budi'), {
    nip: '200308062025101001',
    passwordEncrypted: 'v2.stub.stub.stub',
    imei: 'IMEI-BUDI',
  });

  const hasil = await P.ubahAkun(tokenAdmin, 'budi', { usernameBaru: 'budi.baru' });
  cek('rename akun berhasil', hasil.ok, hasil.pesan ?? '');
  cek('dokumen akun memakai username baru dan akun lama dihapus',
    dokumen.get(KUNCI.pengguna('budi.baru'))?.username === 'budi.baru' &&
      !dokumen.has(KUNCI.pengguna('budi')));
  cek('kredensial server ikut dipindahkan',
    dokumen.get(KUNCI.pengaturan('kredensial_server__budi.baru'))?.nip === '200308062025101001' &&
      !dokumen.has(KUNCI.pengaturan('kredensial_server__budi')));
  cek('masa aktif dipindahkan tanpa mengubah nilainya',
    dokumen.get('jatim_langganan/budi.baru')?.masaAkhir === '2027-05-01T00:00:00.000Z' &&
      !dokumen.has('jatim_langganan/budi'));
  cek('semua tagihan ikut ke username baru',
    dokumen.get('jatim_tagihan/ORDER-BUDI-1')?.username === 'budi.baru' &&
      dokumen.get('jatim_tagihan/ORDER-BUDI-1')?.usernameLabel === 'budi.baru' &&
      dokumen.get('jatim_tagihan/ORDER-BUDI-2')?.username === 'budi.baru' &&
      dokumen.get('jatim_tagihan/ORDER-BUDI-2')?.usernameLabel === 'Budi Santoso');
  cek('token dengan username lama tidak lagi berlaku',
    !(await P.verifikasiToken(tokenUser)).ok);
  const sesiBaru = await P.verifikasiToken(P.terbitkanToken('budi.baru', 'user', izinUser));
  cek('token username baru mengembalikan alias username lama',
    sesiBaru.ok && sesiBaru.akun?.usernameSebelumnya?.includes('budi') === true);
  cek('hasil migrasi tidak meninggalkan marker',
    !dokumen.has(KUNCI.pengaturan('rename_akun__budi')));
}

// ═════════════════════════════════════════════════════════════════════
console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
