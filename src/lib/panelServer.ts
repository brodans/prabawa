/**
 * Autentikasi & otorisasi panel — **sisi server**.
 *
 * ## Kenapa modul ini harus ada
 *
 * Sebelumnya seluruh autentikasi panel berjalan **di peramban**: `LoginScreen`
 * membaca `jatim_pengguna/{username}` lalu membandingkan hash password dengan
 * bcrypt di dalam browser. Konsekuensinya bukan teoritis:
 *
 * - `firestore.rules` harus `allow read/write: if true` pada `jatim_pengguna`,
 *   jadi **hash password semua orang** bisa dibaca siapa pun, dan **role bisa
 *   ditulis sendiri**: `setDoc({ role: 'admin' })` lalu refresh → jadi admin.
 * - Pemeriksaan peran hanya ada di peramban.
 * - Sesi disimpan sebagai JSON polos di `sessionStorage`. `boundRole` hanya
 *   memeriksa konsistensi **dalam** — kalau `role` dan `boundRole` sama-sama
 *   diedit, pemeriksaannya lolos.
 * - Penguncian brute force ada di `localStorage` — dihapus dengan satu baris.
 *
 * Semua itu hilang begitu modul ini ada, karena tiga aturan yang dipegangnya:
 *
 * 1. **Password diverifikasi server.** Hash tidak pernah keluar dari Firestore.
 * 2. **Peran hanya dibaca server**, dari dokumen, setiap kali dibutuhkan. Nilai
 *    peran di dalam token bukan sumber kebenaran — hanya cache yang selalu
 *    dicocokkan ulang ke dokumen sebelum dipakai.
 * 3. **Token sesi ditandatangani HMAC-SHA256** dengan rahasia yang tidak pernah
 *    sampai ke peramban. Mengedit payload di DevTools tidak menghasilkan token
 *    yang valid.
 *
 * ## Bentuk token
 *
 * ```
 * <base64url(payload)>.<base64url(HMAC-SHA256(base64url(payload), SECRET))>
 * ```
 *
 * Stateless: tidak ada tabel sesi di server, jadi tidak ada state yang bisa
 * basi. Yang dibutuhkan — mencabut token milik orang lain — memang tidak ada
 * di arsitektur ini; logout membersihkan penyimpanan lokal, dan token yang
 * tertinggal hanya berlaku sampai `exp`.
 *
 * ## Rahasia
 *
 * `PANEL_SESSION_SECRET` **wajib ada**, minimal 32 karakter. Tidak ada nilai
 * bawaan yang bisa dipakai: nilai bawaan adalah rahasia publik — siapa pun yang
 * membaca repositori bisa menandatangani token admin sendiri, dan seluruh
 * jaminan modul ini berubah jadi tidak ada. Tanpa env itu modul menolak bekerja
 * (503), bukan melonggarkan aturannya.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { Buffer as NodeBuffer } from 'node:buffer';
import { admin, adminTersedia } from './firestoreAdmin';
import { hashPinLayered, verifyPinLayered } from './pin';
import { buildRpcEnvelope } from './presensiContract';
import { bersihkanUndefined } from './firestoreAman';
import {
  batasiIzin,
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  normalizeUserPermissions,
  sanitizeString,
  validatePassword,
  validateUsername,
  type TabPermissions,
  type UserAccount,
  type UserAccountSafe,
  type UserRole,
} from './userManager';

/** Koleksi & dokumen — sama dengan `lib/firebase.ts` tapi di sisi server. */
const COLL_PENGGUNA = 'jatim_pengguna';
const COLL_PENGATURAN = 'jatim_pengaturan';
const COLL_LANGGANAN = 'jatim_langganan';
const COLL_TAGIHAN = 'jatim_tagihan';

/**
 * Batas jumlah akun panel yang boleh dipindai penuh.
 *
 * ⚠️ Dua aksi memindai seluruh `jatim_pengguna`: `daftarAkun` (daftar untuk
 * Manajemen Akun) dan `ringkasSemuaKredensial` (kolom NIP/IMEI). Keduanya
 * memang butuh isi keseluruhan — tidak ada operator "ambil semua yang
 * berawalan" di Firestore, dan daftar akun tidak bisa dipotong diam-diam
 * karena admin akan melihat tabel yang terlihat lengkap padahal tidak.
 *
 * Jadi pemindaiannya dibatasi, dan kalau lewat batas ia **menolak** dengan
 * pesan jelas, bukan memotong hasil. Panel ini dipakai satu instansi; angka
 * seribu akun bahkan tidak mungkin tercapai di sini, sehingga batasnya
 * praktis hanya menangkap kondisi yang tidak normal — sementara biaya
 * pemindaian tak terbatas tidak.
 */
const BATAS_AKUN_PANEL = 1000;
const DOC_AUTH = 'auth';

/** Umur token. 30 menit — sama dengan idle timeout yang sudah ada sebelumnya. */
const TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Ambang perpanjangan.
 *
 * `/verify` menerbitkan token baru kalau sisa umur di bawah ini, jadi klien
 * tidak perlu memanggil server terus-menerus hanya untuk memperpanjang.
 */
const PERBARU_BILA_SISA_MS = 10 * 60 * 1000;

/** Versi bentuk token. Dinaikkan kalau bentuk payload berubah. */
const TOKEN_V = 1;

/** Username admin bawaan ketika `adminUsername` belum pernah diisi. */
export const NAMA_ADMIN_BAWAAN = 'admin';

/** Host gateway pusat, sama dengan bawaan `src/api/server.ts`. */
const GATEWAY_BAWAAN = 'https://presensi.bkd.jatimprov.go.id/service';

// ═══════════════════════════════════════════════════════════════════════
//  Rahasia
// ═══════════════════════════════════════════════════════════════════════

function rahasia(): string {
  const nilai = process.env.PANEL_SESSION_SECRET?.trim();
  if (!nilai) {
    throw new Error(
      'PANEL_SESSION_SECRET belum diisi. Tambahkan di dashboard Vercel ' +
        '(Settings → Environment Variables) sebagai string acak minimal 32 karakter, lalu deploy ulang. ' +
        'Autentikasi panel berhenti tanpa nilai ini — bukan memakai nilai bawaan.'
    );
  }
  if (nilai.length < 32) {
    throw new Error(
      `PANEL_SESSION_SECRET terlalu pendek (minimal 32 karakter). Panjang saat ini: ${nilai.length}.`
    );
  }
  return nilai;
}

/** Kunci turunan untuk enkripsi kredensial server pusat. */
function kunciKredensial(): NodeBuffer {
  return createHmac('sha256', 'prabawa-kredensial').update(rahasia()).digest();
}

/** Ringkasan untuk `/api/health` — hanya keberadaan, tidak pernah nilainya. */
export function ringkasanPanelAuth(): {
  siap: boolean;
  secretAda: boolean;
  secretCukupPanjang: boolean;
} {
  const nilai = process.env.PANEL_SESSION_SECRET?.trim() ?? '';
  return {
    siap: adminTersedia() && nilai.length >= 32,
    secretAda: nilai.length > 0,
    secretCukupPanjang: nilai.length >= 32,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Token sesi
// ═══════════════════════════════════════════════════════════════════════

export interface MuatanToken {
  /** Nama akun panel. */
  sub: string;
  /** Peran saat token diterbitkan — cache, bukan sumber kebenaran. */
  role: UserRole;
  /** Izin saat token diterbitkan — cache, bukan sumber kebenaran. */
  perms: TabPermissions;
  /** Issued-at, ms epoch. */
  iat: number;
  /** Expires-at, ms epoch. */
  exp: number;
  /** Nonce, supaya dua token untuk akun yang sama tetap berbeda. */
  jti: string;
}

function tanda(payloadB64: string): string {
  return createHmac('sha256', rahasia()).update(payloadB64).digest('base64url');
}

/**
 * Terbitkan token sesi.
 *
 * Peran dan izin ikut dibawa supaya klien tidak perlu memanggil server sekali
 * lagi hanya untuk tahu menu apa yang boleh ditampilkan. Keduanya **cache**:
 * `verifikasiToken()` selalu membacanya ulang dari dokumen sebelum mengizinkan
 * apa pun, dan akun yang dikembalikan adalah hasil pembacaan itu.
 */
export function terbitkanToken(sub: string, role: UserRole, perms: TabPermissions): string {
  const sekarang = Date.now();
  const muatan: MuatanToken = {
    v: TOKEN_V,
    sub,
    role,
    perms,
    iat: sekarang,
    exp: sekarang + TOKEN_TTL_MS,
    jti: randomUUID(),
  } as MuatanToken;
  const payloadB64 = NodeBuffer.from(JSON.stringify(muatan), 'utf8').toString('base64url');
  return `${payloadB64}.${tanda(payloadB64)}`;
}

/**
 * Periksa tanda tangan dan masa berlaku.
 *
 * Mengembalikan `null` untuk **apa pun** yang tidak persis — tanda tangan
 * salah, bentuk bukan dua bagian, JSON rusak, `exp` lewat, versi tidak cocok.
 * Tidak ada "peringatan sebagian": token yang tidak terbukti benar
 * diperlakukan sama dengan tidak ada.
 */
export function bacaToken(token: string | undefined | null): MuatanToken | null {
  if (typeof token !== 'string' || !token) return null;
  const titik = token.indexOf('.');
  if (titik <= 0 || titik === token.length - 1) return null;

  const payloadB64 = token.slice(0, titik);
  const signature = token.slice(titik + 1);

  let diharapkan: string;
  try {
    diharapkan = tanda(payloadB64);
  } catch {
    // Rahasia belum diisi — perlakukan semua token tidak valid.
    return null;
  }

  // `timingSafeEqual` melempar kalau panjang berbeda, jadi panjang dicek dulu.
  // Panjang tanda HMAC selalu tetap untuk payload yang valid, jadi yang
  // dibocorkan bukan informasi berguna.
  const a = NodeBuffer.from(signature);
  const b = NodeBuffer.from(diharapkan);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let muatan: MuatanToken;
  try {
    muatan = JSON.parse(NodeBuffer.from(payloadB64, 'base64url').toString('utf8')) as MuatanToken;
  } catch {
    return null;
  }
  if (!muatan || typeof muatan !== 'object') return null;
  if ((muatan as { v?: number }).v !== TOKEN_V) return null;
  if (typeof muatan.sub !== 'string' || !muatan.sub) return null;
  if (muatan.role !== 'admin' && muatan.role !== 'user') return null;
  if (typeof muatan.exp !== 'number' || typeof muatan.iat !== 'number') return null;
  if (Date.now() >= muatan.exp) return null;
  // `iat` di masa depan berarti jam server meleset jauh, atau payload dirakit
  // sendiri. Dua-duanya tidak layak dipercaya.
  if (muatan.iat > Date.now() + 60_000) return null;

  return muatan;
}

// ═══════════════════════════════════════════════════════════════════════
//  Firestore: akun & admin bawaan
// ═══════════════════════════════════════════════════════════════════════

/** Id dokumen. Sama persis dengan `akunFirestore.ts` versi lama. */
function kunciAkun(username: string): string {
  return username.trim().replace(/\//g, '_');
}

function dokKredensial(username: string): string {
  return `kredensial_server__${kunciAkun(username)}`;
}

/** Username admin bawaan yang sah, apa adanya isinya di dokumen. */
async function namaAdmin(): Promise<string> {
  const snap = await (await admin()).collection(COLL_PENGATURAN).doc(DOC_AUTH).get();
  const data = snap.data() as Record<string, any> | undefined;
  const nama =
    typeof data?.adminUsername === 'string' ? data.adminUsername.toLowerCase().trim() : '';
  return nama || NAMA_ADMIN_BAWAAN;
}

/**
 * Bentuk akun yang aman dikirim ke klien — tanpa hash, tanpa field internal.
 *
 * Peran dan izin **selalu dihitung ulang di sini**, tidak pernah diambil apa
 * adanya dari dokumen. Jadi dokumen yang isinya rusak (izin admin bernilai
 * `true` pada akun user, misalnya) tidak pernah sampai ke klien apa adanya.
 */
function akunAman(doc: Record<string, any>, fallbackUsername: string): UserAccountSafe {
  const role: UserRole = doc.role === 'admin' ? 'admin' : 'user';
  const permissions: TabPermissions =
    role === 'admin'
      ? { ...DEFAULT_ADMIN_PERMISSIONS }
      : batasiIzin(
          normalizeUserPermissions(doc.permissions as Record<string, unknown> | undefined),
          role
        );
  return {
    username: sanitizeString(doc.username ?? fallbackUsername, 32) || fallbackUsername,
    usernameSebelumnya: Array.isArray(doc.usernameSebelumnya)
      ? doc.usernameSebelumnya
          .filter((nama: unknown): nama is string => typeof nama === 'string')
          .map((nama: string) => sanitizeString(nama, 32))
          .filter(Boolean)
          .slice(-20)
      : undefined,
    role,
    permissions,
    createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : '',
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : undefined,
    lastLoginAt: typeof doc.lastLoginAt === 'string' ? doc.lastLoginAt : undefined,
    lastNip: typeof doc.lastNip === 'string' ? doc.lastNip : undefined,
    namaLengkap: typeof doc.namaLengkap === 'string' ? doc.namaLengkap : undefined,
    nip: typeof doc.nip === 'string' ? doc.nip : undefined,
    catatan: typeof doc.catatan === 'string' ? doc.catatan : undefined,
    nonaktif: Boolean(doc.nonaktif),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Pembatas percobaan login
// ═══════════════════════════════════════════════════════════════════════

/*
 * Dua lapis: per-IP dan per-akun.
 *
 * Per-IP menahan penyebar dari satu mesin. Per-akun menahan serangan
 * terdistribusi terhadap satu akun — justru bentuk serangan yang paling
 * motivated, dan tidak bisa dihentikan hanya dengan per-IP.
 *
 * ⚠️ Peta ini **per-instance**. Vercel menyalakan instance baru tiap kali, jadi
 * yang tertahan adalah percobaan yang wajar (membuat tebakan satu per satu
 * tidak praktis), bukan serangan otomatis berskala besar. Lapis sesungguhnya
 * adalah rate limit platform; yang di sini membuat tebakan satu per satu
 * tidak layak.
 */
const BATAS_PER_IP = 20;
const BATAS_PER_AKUN = 8;
const JENDALA_MS = 10 * 60 * 1000;

type Catatan = { jumlah: number; mulai: number };
const percobaanIp = new Map<string, Catatan>();
const percobaanAkun = new Map<string, Catatan>();

/** Sisa detik penguncian; `0` berarti belum terkunci. */
function sisaKunci(peta: Map<string, Catatan>, kunci: string, batas: number): number {
  const c = peta.get(kunci);
  if (!c) return 0;
  const lewat = Date.now() - c.mulai;
  if (lewat >= JENDALA_MS) {
    peta.delete(kunci);
    return 0;
  }
  if (c.jumlah < batas) return 0;
  return Math.ceil((JENDALA_MS - lewat) / 1000);
}

/**
 * Catat satu percobaan **yang gagal**.
 *
 * ⚠️ Hanya dipanggil dari jalur kegagalan (lihat `masukPanel`). Fungsi ini
 * sengaja tidak pernah dipanggil setelah kredensial terbukti benar: kalau
 * login berhasil ikut dihitung, batasnya bukan lagi batas "percobaan" tapi
 * batas "orang yang boleh masuk", dan orang yang benar-benar login justru
 * yang jadi terkunci.
 */
function catatGagal(peta: Map<string, Catatan>, kunci: string): void {
  const c = peta.get(kunci);
  if (!c || Date.now() - c.mulai >= JENDALA_MS) {
    peta.set(kunci, { jumlah: 1, mulai: Date.now() });
    return;
  }
  c.jumlah += 1;
}

/** Batas isi peta sebelum pemangkasan paksa. */
const BATAS_ENTRI_PEMBATAS = 500;

/**
 * Bersihkan peta supaya tidak tumbuh tanpa batas di instance yang sudah lama.
 *
 * ⚠️ Dua tahap, dan tahap kedua itu yang menentukan. Versi sebelumnya hanya
 * menghapus entri yang sudah lewat jendela lalu berhenti — padahal serangan
 * yang paling umum adalah mengirim banyak kunci berbeda dalam jendela yang
 * sama, sehingga **tidak ada** entri yang boleh dihapus, dan peta tumbuh terus
 * sampai instance kehabisan memori. Kalau setelah tahap pertama peta masih di
 * atas batas, entri terlama dibuang paksa: yang hilang paling banter satu
 * penyerang, sedangkan yang tidak dibuang adalah seluruh instance.
 */
function pangkas(peta: Map<string, Catatan>): void {
  if (peta.size < BATAS_ENTRI_PEMBATAS) return;
  const sekarang = Date.now();
  for (const [kunci, nilai] of peta) {
    if (sekarang - nilai.mulai >= JENDALA_MS) peta.delete(kunci);
  }
  if (peta.size <= BATAS_ENTRI_PEMBATAS) return;
  const urut = [...peta.entries()].sort((a, b) => a[1].mulai - b[1].mulai);
  const kelebihan = urut.length - BATAS_ENTRI_PEMBATAS;
  for (let i = 0; i < kelebihan; i++) peta.delete(urut[i][0]);
}

/** Bersihkan seluruh pembatas. Dipakai skrip uji. */
export function resetPembatasPercobaan(): void {
  percobaanIp.clear();
  percobaanAkun.clear();
}

// ═══════════════════════════════════════════════════════════════════════
//  Hasil
// ═══════════════════════════════════════════════════════════════════════

export interface HasilAuth {
  ok: boolean;
  kode: number;
  pesan?: string;
  /** Sisa detik penguncian; `0`/absent kalau tidak terkunci. */
  terkunci?: number;
  token?: string;
  akun?: UserAccountSafe;
}

const pesanGagal = 'ID pengguna atau kata sandi salah.';

// ═══════════════════════════════════════════════════════════════════════
//  Login
// ═══════════════════════════════════════════════════════════════════════

/**
 * Verifikasi satu percobaan login.
 *
 * ## Urutannya penting
 *
 * 1. **Admin bawaan dicek lebih dulu**, tapi **hanya** kalau username sama
 *    persis dengan `adminUsername` yang sah.
 *
 *    Ini menutup celah paling berbahaya di versi lama. Semuanya berbunyi
 *    `if (storedAdmin ? username === storedAdmin : true)` — jadi ketika
 *    `adminUsername` belum pernah diisi, **username apa pun** + password admin
 *    menghasilkan admin penuh. Sekarang field kosong berarti `admin` (nama
 *    bawaan yang sama dengan yang ditampilkan di dialog Pengaturan), bukan
 *    "apa pun".
 *
 * 2. Baru dicoba dokumen `jatim_pengguna`. Akun dengan username yang sama
 *    tetap bisa masuk lewat jalurnya sendiri, jadi admin bawaan tidak
 *    "menabrak" akun panel bernama sama.
 *
 * 3. `nonaktif` **selalu** menolak. Versi lama tidak pernah membacanya, jadi
 *    akun yang dinonaktifkan admin masih bisa login.
 *
 * ⚠️ Pesan kegagalan sengaja sama untuk "user tidak ada", "password salah",
 * dan "akun nonaktif". Bedanya adalah informasi yang mempercepat tebakan.
 */
export async function masukPanel(
  username: string,
  password: string,
  info: { ip?: string } = {}
): Promise<HasilAuth> {
  const nama = String(username ?? '').trim().toLowerCase();
  const sandi = String(password ?? '');
  if (!nama || !sandi) {
    return { ok: false, kode: 400, pesan: 'ID pengguna dan kata sandi wajib diisi.' };
  }
  if (nama.length > 32 || sandi.length > 128) {
    return { ok: false, kode: 400, pesan: 'ID pengguna atau kata sandi tidak valid.' };
  }

  const ip = info.ip || 'tak-diketahui';
  pangkas(percobaanIp);
  pangkas(percobaanAkun);

  const kunciPerIp = sisaKunci(percobaanIp, ip, BATAS_PER_IP);
  if (kunciPerIp) {
    return {
      ok: false,
      kode: 429,
      terkunci: kunciPerIp,
      pesan: 'Terlalu banyak percobaan dari perangkat ini.',
    };
  }
  const kunciPerAkun = sisaKunci(percobaanAkun, nama, BATAS_PER_AKUN);
  if (kunciPerAkun) {
    return {
      ok: false,
      kode: 429,
      terkunci: kunciPerAkun,
      pesan: 'Terlalu banyak percobaan untuk akun ini.',
    };
  }

  const db = await admin();
  let akun: UserAccountSafe | null = null;
  let refAkun: { update(data: Record<string, unknown>): Promise<unknown> } | null = null;

  // 1. Admin bawaan — hanya untuk username admin yang sah.
  const namaAdminSah = await namaAdmin();
  if (nama === namaAdminSah) {
    const authSnap = await db.collection(COLL_PENGATURAN).doc(DOC_AUTH).get();
    const auth = (authSnap.data() ?? {}) as Record<string, any>;
    // `pinHash` dicek lebih dulu: hanya bentuk yang benar-benar rahasia.
    const sah =
      (typeof auth.pinHash === 'string' && auth.pinHash
        ? await verifyPinLayered(sandi, auth.pinHash)
        : false) ||
      (typeof auth.pinEncrypted === 'string' && auth.pinEncrypted
        ? await verifikasiLegacyPin(auth.pinEncrypted, sandi)
        : false);
    if (sah) {
      akun = {
        username: namaAdminSah,
        role: 'admin',
        permissions: { ...DEFAULT_ADMIN_PERMISSIONS },
        createdAt: typeof auth.createdAt === 'string' ? auth.createdAt : '',
      };
    }
  }

  // 2. Dokumen akun.
  if (!akun) {
    const snap = await db.collection(COLL_PENGGUNA).doc(kunciAkun(nama)).get();
    if (snap.exists) {
      const doc = snap.data() as Record<string, any>;
      const valid = await verifyPinLayered(sandi, String(doc.passwordHash ?? ''));
      if (valid && !doc.nonaktif) {
        akun = akunAman(doc, nama);
        refAkun = snap.ref as unknown as { update(d: Record<string, unknown>): Promise<unknown> };
      }
    }
  }

  /*
   * ⚠️ Penhitungan hanya jalan di jalur **gagal** — lihat `catatGagal()`.
   *
   * Semula kedua baris penhitungan berjalan untuk semua percobaan, termasuk
   * yang berhasil. Akibatnya batas "20 percobaan per IP" sebenarnya adalah
   * batas 20 *login*, dan batas "8 percobaan per akun" adalah batas 8 *login
   * berhasil*. Dua-duanya salah untuk orang sungguhan: satu kantor yang
   * berbagi satu IP di belakang NAT terkunci seluruhnya setelah 20 orang
   * masuk dalam 10 menit, dan tiap akun terkunci setelah 8 kali login
   * benar — persis kebalikan dari yang biasanya diharapkan.
   *
   * Login yang berhasil tidak dihitung, jadi login berulang (memuat ulang
   * halaman, token kedaluwarsa lalu login lagi) tidak pernah mengunci siapa pun.
   */
  if (!akun) {
    catatGagal(percobaanIp, ip);
    catatGagal(percobaanAkun, nama);
    return { ok: false, kode: 401, pesan: pesanGagal };
  }

  // Waktu login terakhir — hanya untuk akun berbasis dokumen.
  if (refAkun) {
    try {
      await refAkun.update({ lastLoginAt: new Date().toISOString() });
    } catch {
      // Tidak boleh menggagalkan login kalau pencatatan gagal.
    }
  }

  return {
    ok: true,
    kode: 200,
    token: terbitkanToken(akun.username, akun.role, akun.permissions),
    akun,
  };
}

/**
 * Bandingkan PIN admin dengan `pinEncrypted` versi lama.
 *
 * ## Bentuk yang harus diurai
 *
 * `pinEncrypted` dibuat dengan `CryptoJS.AES.encrypt(plain, passphrase)`, yang
 * menghasilkan **OpenSSL "Salted__"**, bukan ciphertext AES mentah:
 *
 * ```
 * base64( "Salted__" || salt[8] || aes-256-cbc(plain, key, iv) )
 * ```
 *
 * Yang krusial: **key dan IV bukan dari passphrase langsung.** CryptoJS
 * memakai turunan OpenSSL `EVP_BytesToKey` (MD5 iterated) dari `passphrase` +
 * `salt`. Dan IV-nya **berbeda setiap kali**, karena diambil dari salt acak.
 *
 * ## Bug yang ditutup fungsi ini
 *
 * Versi sebelumnya melakukan:
 *
 * ```ts
 * const turunan = createHmac('sha256', 'prabawa-legacy').update(legacy).digest();
 * const dekrip = createDecipheriv('aes-256-cbc', turunan, Buffer.alloc(16));
 * dekrip.update(Buffer.from(pinEncrypted, 'base64'));   // ← "Salted__" ikut ter-dekripsi
 * ```
 *
 * Tiga kesalahan sekaligus, dan ketiganya membuat fungsi ini **selalu**
 * mengembalikan `false`:
 *
 * 1. `Salted__` + salt ikut diperlakukan sebagai ciphertext, jadi blok
 *    pertamanya bukan blok AES yang valid.
 * 2. Kuncinya diturunkan dengan HMAC-SHA256, sementara aslinya
 *    `EVP_BytesToKey` (MD5 iterated) — kuncinya tidak pernah sama.
 * 3. IV-nya `Buffer.alloc(16)` (nol semua), sedangkan aslinya diturunkan dari
 *    salt. Bahkan kalau 1 dan 2 benar, dekripsi tetap gagal.
 *
 * Akibatnya jalur kompatibilitas ini tidak pernah bekerja: admin dengan
 * dokumen format lama selalu ditolak, dan tidak ada yang bisa memperbaikinya
 * karena gejalanya_identik_ dengan "password salah".
 *
 * Perbaikannya mengurai header OpenSSL dengan benar dan menurunkan key/IV
 * persis seperti `EVP_BytesToKey` — satu-satunya cara ciphertext lama bisa
 * dibaca lagi.
 *
 * ## Batasnya, dan itu disengaja
 *
 * Kuncinya `VITE_APP_SECRET`, yang ada di bundle peramban. Jadi membaca
 * `pinEncrypted` **tidak menambah kebocoran baru** — ciphertext-nya sudah bisa
 * dibuka siapa pun yang punya kunci itu. Yang ditambahkan fungsi ini hanya
 * kompatibilitas, bukan keamanan.
 *
 * Begitu admin mengganti password lewat server, dokumen ditulis dengan
 * `pinHash` (bcrypt) saja dan `pinEncrypted` dihapus — jalur ini mati
 * permanen, dan tidak ada lagi yang bergantung padanya.
 *
 * Kalau `VITE_APP_SECRET` tidak diisi di environment server, hasilnya `false`
 * dan akun tersebut diminta menyimpan ulang. Itu memang batasnya: kunci lama
 * ada di peramban, jadi tidak ada alasan menghapusnya dari server juga.
 */
async function verifikasiLegacyPin(pinEncrypted: string, sandi: string): Promise<boolean> {
  const legacy = process.env.VITE_APP_SECRET?.trim();
  if (!legacy) return false;
  try {
    const sandiSalt = uraiOpenSslSalted(pinEncrypted);
    if (!sandiSalt) return false;
    const { key, iv } = evpBytesToKey(legacy, sandiSalt.salt, 32, 16);
    const dekrip = createDecipheriv('aes-256-cbc', key, iv);
    const teks = NodeBuffer.concat([
      dekrip.update(NodeBuffer.from(sandiSalt.ciphertext)),
      dekrip.final(),
    ]).toString('utf8');
    // `timingSafeEqual` bukan di sini: yang dibandingkan adalah hasil dekripsi
    // dengan input pengguna, dan panjangnya sudah pasti berbeda saat inputnya
    // bukan password yang benar. Perbandingan biasa cukup, dan tidak membocorkan
    // apa pun yang belum bocor dari panjang ciphertext.
    return teks.length > 0 && teks === sandi;
  } catch {
    return false;
  }
}

/** Header OpenSSL "Salted__" yang di-encode base64. */
const OPENSSL_SALTED_MAGIC = NodeBuffer.from('Salted__', 'utf8');

/** Bentuk hasil penguraian header OpenSSL. */
interface BlobSalted {
  salt: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Ambil salt + ciphertext dari blob `base64("Salted__" || salt || ciphertext)`.
 *
 * ## ⚠️ Kenapa modul ini memakai `NodeBuffer`, bukan `Buffer` global
 *
 * `Buffer` **tidak** diimpor di berkas ini. Tanpa impor, `tsc` menyelesaikannya
 * ke tipe `Buffer` bawaan DOM, yang bentuknya **hanya interface** — bukan
 * konstruktor. Di balik modul yang berjalan (`tsx` → ESM), ekspresi `Buffer`
 * global bisa berubah menjadi objek proxy yang punya nama property tapi tidak
 * punya prototipe `Uint8Array` aslinya, sehingga:
 *
 * - `Buffer.from('x')` mengembalikan `[object Object]`, bukan `Buffer`;
 * - `NodeBuffer.concat([obj])` melempar
 *   `The first argument must be of type string or an instance of Buffer…`.
 *
 * Gejalanya sangat menyesatkan: kode yang **identik** dengan yang berhasil saat
 * ditulis ulang di berkas lain akan gagal di sini saja, dan `tsc` tidak
 * memberi tahu apa pun — `Buffer.from` bertipe mengembalikan `Buffer`, sesuai
 * tipe yang di-*interface*-kan DOM.
 *
 * Yang membuat bug ini bertahan lama: `bacaToken()` di berkas yang sama
 * memakai `Buffer` global dan **berhasil** — karena `Buffer.from(...)` di sana
 * kebetulan dipanggil pada jalur yang tidak melewati kode tersebut. Jadi ada
 * "bukti" bahwa global `Buffer` aman, dan bukti itu salah.
 *
 * Solusinya sederhana: impor eksplisit dari `node:buffer` dan pakai nama itu
 * di seluruh fungsi kripto di berkas ini. Fungsi yang tidak memakai
 * `NodeBuffer` sama sekali tidak terpengaruh.
 *
 * Tipe kembaliannya `Uint8Array` — `NodeBuffer.subarray()` mengembalikan
 * `Uint8Array`, dan mengonversinya ke `Buffer` lebih dekat ke tempat yang
 * benar-benar butuh (yaitu API kripto Node) adalah pilihan yang lebih aman.
 */
function uraiOpenSslSalted(blob: string): BlobSalted | null {
  let raw: NodeBuffer;
  try {
    raw = NodeBuffer.from(String(blob ?? ''), 'base64');
  } catch {
    return null;
  }
  if (raw.length <= OPENSSL_SALTED_MAGIC.length + 16 + 1) return null;
  if (!raw.subarray(0, OPENSSL_SALTED_MAGIC.length).equals(OPENSSL_SALTED_MAGIC)) return null;
  // Header 8 byte + salt 8 byte = 16 byte, lalu ciphertext (kelipatan 16).
  const ciphertext = raw.subarray(16);
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return null;
  return { salt: raw.subarray(8, 16), ciphertext };
}

/**
 * Turunan kunci OpenSSL `EVP_BytesToKey` dengan MD5 — persis yang dipakai
 * CryptoJS dan `openssl enc -md md5`.
 *
 * ```
 * D_1 = MD5(passphrase || salt)
 * D_i = MD5(D_{i-1} || passphrase || salt)
 * key || iv = D_1 || D_2 || D_3 …
 * ```
 *
 * Fungsi ini **hanya** untuk membaca dokumen `v1` yang sudah terlanjur
 * tertulis. Semua penulisan baru memakai AES-256-GCM dengan kunci turunan
 * HMAC dari `PANEL_SESSION_SECRET` — lihat `enkripsi()`.
 */
function evpBytesToKey(
  passphrase: string,
  salt: Uint8Array,
  keyLen: number,
  ivLen: number
): { key: NodeBuffer; iv: NodeBuffer } {
  const total = keyLen + ivLen;
  const turunan = NodeBuffer.alloc(total);
  let terisi = 0;
  let blok = NodeBuffer.alloc(0);

  while (terisi < total) {
    blok = createHash('md5')
      .update(NodeBuffer.concat([blok, NodeBuffer.from(passphrase, 'utf8'), NodeBuffer.from(salt)]))
      .digest();
    blok.copy(turunan, terisi, 0, Math.min(blok.length, total - terisi));
    terisi += blok.length;
  }

  /*
   * `NodeBuffer.from(…)` lalu `subarray`, bukan `subarray` langsung.
   *
   * `NodeBuffer.prototype.subarray()` mengembalikan `Uint8Array`, dan itulah yang
   * membuat `createDecipheriv` melempar
   * `The "list[2]" argument must be an instance of Buffer or Uint8Array.
   * Received an instance of Object`.
   *
   * Reactor internal Node memeriksa `instanceof`, dan setelah bundel CJS
   * (`esbuild --format=cjs`, lihat script `build`) `Uint8Array` dari domain
   * yang berbeda tidak lagi mengenali diri sebagai `Uint8Array` milik realm
   * itu. Gejalanya: **hanya muncul di produksi** — `tsx` menjalankan ESM apa
   * adanya dan lulus, bundel yang gagal.
   *
   * `NodeBuffer.from(…subarray)` memaksa objek baru yang benar-benar `Buffer` di
   * realm yang sama, jadi aman di kedua jalur — `tsx` (ESM) dan bundel CJS
   * yang dipakai Vercel.
   */
  return {
    key: NodeBuffer.from(turunan.subarray(0, keyLen)),
    iv: NodeBuffer.from(turunan.subarray(keyLen, total)),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Verifikasi token
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cocokkan token dengan dokumen — **ini** titik penentu peran.
 *
 * Yang dikembalikan adalah akun dengan `role` dan `permissions` dibaca **dari
 * Firestore saat ini**, bukan dari token. Token hanya membuktikan "sesi ini
 * memang diterbitkan server untuk nama ini".
 *
 * Akibatnya:
 *
 * - Mengedit `role` di token → tanda tangan tidak cocok → `null` → keluar.
 * - Admin menurunkan peran di Firestore → sesi berikutnya langsung user.
 * - Admin menonaktifkan akun → verifikasi berikutnya menolak.
 */
export async function verifikasiToken(
  token: string | undefined | null,
  opsi: { perbarui?: boolean } = {}
): Promise<HasilAuth> {
  const muatan = bacaToken(token);
  if (!muatan) return { ok: false, kode: 401, pesan: 'Sesi tidak valid atau sudah berakhir.' };

  const db = await admin();
  const snap = await db.collection(COLL_PENGGUNA).doc(kunciAkun(muatan.sub)).get();

  let akun: UserAccountSafe;
  if (snap.exists) {
    const doc = snap.data() as Record<string, any>;
    if (doc.nonaktif) {
      return { ok: false, kode: 403, pesan: 'Akun ini dinonaktifkan. Hubungi administrator.' };
    }
    // Nama akun harus sama persis dengan yang ditandatangani.
    if (sanitizeString(doc.username ?? muatan.sub, 32) !== muatan.sub) {
      return { ok: false, kode: 401, pesan: 'Sesi tidak valid.' };
    }
    akun = akunAman(doc, muatan.sub);
  } else {
    // Tidak ada dokumen → satu-satunya kemungkinan adalah admin bawaan, dan
    // hanya selama `adminUsername` masih menunjuk ke nama itu.
    const namaAdminSah = await namaAdmin();
    if (muatan.sub !== namaAdminSah) {
      return { ok: false, kode: 401, pesan: 'Akun tidak ditemukan.' };
    }
    const authSnap = await db.collection(COLL_PENGATURAN).doc(DOC_AUTH).get();
    const auth = (authSnap.data() ?? {}) as Record<string, any>;
    if (typeof auth.pinHash !== 'string' || !auth.pinHash) {
      return { ok: false, kode: 401, pesan: 'Kredensial admin sudah tidak berlaku.' };
    }
    akun = {
      username: namaAdminSah,
      role: 'admin',
      permissions: { ...DEFAULT_ADMIN_PERMISSIONS },
      createdAt: typeof auth.createdAt === 'string' ? auth.createdAt : '',
    };
  }

  const perluBaru = opsi.perbarui === true && muatan.exp - Date.now() < PERBARU_BILA_SISA_MS;
  return {
    ok: true,
    kode: 200,
    token: perluBaru ? terbitkanToken(akun.username, akun.role, akun.permissions) : undefined,
    akun,
  };
}

/** Akun dari token, atau `null`. Satu-satunya jalan tahu siapa pemanggil. */
export async function akunDariToken(
  token: string | undefined | null
): Promise<UserAccountSafe | null> {
  const hasil = await verifikasiToken(token);
  return hasil.ok ? (hasil.akun ?? null) : null;
}

/**
 * True hanya untuk akun admin — dibaca dari dokumen, bukan dari token.
 *
 * Satu-satunya cara modul ini mengizinkan perubahan data sensitif.
 */
export async function adalahAdminToken(token: string | undefined | null): Promise<boolean> {
  const akun = await akunDariToken(token);
  return akun?.role === 'admin';
}

// ═══════════════════════════════════════════════════════════════════════
//  Kredensial admin bawaan
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ganti username dan/atau password admin bawaan.
 *
 * Password lama selalu diminta dan selalu diverifikasi terhadap dokumen, jadi
 * langkah "ganti username" yang dulu hanya diminta password admin di peramban
 * tidak bisa lagi dijalankan oleh siapa pun yang punya sesi admin di storage
 * saja.
 *
 * Setelah berhasil, `pinEncrypted` dihapus dari dokumen. Nilainya
 * `AES(password, VITE_APP_SECRET)` dengan kunci yang ada di bundle peramban —
 * menyimpannya hanya menambah satu Representation plaintext yang bisa dibaca
 * siapa pun yang punya hash-nya.
 */
export async function ubahAdminBawaan(
  token: string | undefined | null,
  isi: { passwordBaru?: string; usernameBaru?: string; passwordLama: string }
): Promise<HasilAuth> {
  if (!(await adalahAdminToken(token))) {
    return { ok: false, kode: 403, pesan: 'Hanya admin yang bisa mengubah kredensial admin.' };
  }
  const passwordLama = String(isi.passwordLama ?? '');
  if (!passwordLama) {
    return { ok: false, kode: 400, pesan: 'Password admin saat ini wajib diisi.' };
  }

  const db = await admin();
  const ref = db.collection(COLL_PENGATURAN).doc(DOC_AUTH);
  const auth = ((await ref.get()).data() ?? {}) as Record<string, any>;

  const sah =
    (typeof auth.pinHash === 'string' && auth.pinHash
      ? await verifyPinLayered(passwordLama, auth.pinHash)
      : false) ||
    (typeof auth.pinEncrypted === 'string' && auth.pinEncrypted
      ? await verifikasiLegacyPin(auth.pinEncrypted, passwordLama)
      : false);
  if (!sah) return { ok: false, kode: 401, pesan: 'Password admin saat ini salah.' };

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  let adaPerubahan = false;

  if (isi.usernameBaru !== undefined) {
    const nama = String(isi.usernameBaru).trim().toLowerCase();
    const galat = validateUsername(nama);
    if (galat) return { ok: false, kode: 400, pesan: galat };
    // Username admin yang sama dengan username akun panel akan membuat dua
    // identitas berbagi satu nama sesi. Tolak saja: tidak ada gunanya dan
    // sumber kebinguan yang besar.
    if ((await db.collection(COLL_PENGGUNA).doc(kunciAkun(nama)).get()).exists) {
      return { ok: false, kode: 409, pesan: 'Username itu sudah dipakai akun panel lain.' };
    }
    patch.adminUsername = nama;
    adaPerubahan = true;
  }

  if (isi.passwordBaru) {
    const galat = validatePassword(isi.passwordBaru);
    if (galat) return { ok: false, kode: 400, pesan: galat };
    patch.pinHash = await hashPinLayered(isi.passwordBaru);
    // Import literal ini ditelusuri Vercel; import dinamis tetap menunda
    // pemuatan sampai aksi penghapusan field diperlukan.
    const hapus = await hapusField();
    patch.pinEncrypted = hapus;
    adaPerubahan = true;
  }

  if (!adaPerubahan) return { ok: false, kode: 400, pesan: 'Tidak ada yang diubah.' };

  await ref.set(patch, { merge: true });
  return { ok: true, kode: 200, pesan: 'Kredensial admin diperbarui. Silakan login ulang.' };
}

/** `FieldValue.delete()` dari salinan `firebase-admin/firestore` yang sama. */
async function hapusField(): Promise<unknown> {
  const modul = (await import('firebase-admin/firestore')) as {
    FieldValue: { delete(): unknown };
  };
  return modul.FieldValue.delete();
}

// ═══════════════════════════════════════════════════════════════════════
//  Kelola akun (admin)
// ═══════════════════════════════════════════════════════════════════════

type HasilAksi = { ok: boolean; kode: number; pesan?: string };

/**
 * Daftar seluruh akun panel.
 *
 * ⚠️ Field respons bernama `daftar`, **bukan** `akun`.
 *
 * `akun` sudah dipakai untuk satu objek akun pada aksi-aksi lain
 * (`masuk`, `verifikasi`, `akun:buat`). Dua bentuk berbeda di nama yang sama
 * memaksa setiap pemanggil melakukan type assertion, dan assertion itulah yang
 * membuat bug menyelinap lewat — termasuk yang baru saja diperbaiki di sisi
 * klien. Satu nama, satu bentuk.
 */
export async function daftarAkun(
  token: string | undefined | null
): Promise<HasilAksi & { daftar?: UserAccount[] }> {
  if (!(await adalahAdminToken(token))) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }
  const snap = await (await admin()).collection(COLL_PENGGUNA).limit(BATAS_AKUN_PANEL + 1).get();
  // `+1` supaya "tepat di batas" dan "melebihi batas" bisa dibedakan tanpa
  // pemindaian kedua.
  if (snap.size > BATAS_AKUN_PANEL) {
    return {
      ok: false,
      kode: 409,
      pesan: `Jumlah akun melewati batas ${BATAS_AKUN_PANEL}. Daftar sengaja tidak dipotong — hubungi pengelola sistem.`,
    };
  }
  return {
    ok: true,
    kode: 200,
    daftar: snap.docs.map(d => akunAman(d.data() as Record<string, any>, d.id)) as UserAccount[],
  };
}

export async function buatAkun(
  token: string | undefined | null,
  isi: {
    username: string;
    password: string;
    role: UserRole;
    permissions?: Partial<TabPermissions>;
    namaLengkap?: string;
    nip?: string;
    catatan?: string;
  }
): Promise<HasilAksi & { akun?: UserAccountSafe }> {
  if (!(await adalahAdminToken(token))) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  const nama = String(isi.username ?? '').trim();
  const galatNama = validateUsername(nama);
  if (galatNama) return { ok: false, kode: 400, pesan: galatNama };
  const sandi = String(isi.password ?? '');
  const galatSandi = validatePassword(sandi);
  if (galatSandi) return { ok: false, kode: 400, pesan: galatSandi };
  const namaLengkap = sanitizeString(isi.namaLengkap ?? '', 120);
  if (!namaLengkap) return { ok: false, kode: 400, pesan: 'Nama lengkap wajib diisi.' };

  const db = await admin();
  const ref = db.collection(COLL_PENGGUNA).doc(kunciAkun(nama));
  if ((await ref.get()).exists) return { ok: false, kode: 409, pesan: 'Username sudah dipakai.' };

  const role: UserRole = isi.role === 'admin' ? 'admin' : 'user';
  const permissions: TabPermissions =
    role === 'admin'
      ? { ...DEFAULT_ADMIN_PERMISSIONS }
      : normalizeUserPermissions({ ...DEFAULT_USER_PERMISSIONS, ...(isi.permissions ?? {}) });

  const now = new Date().toISOString();
  const record: UserAccount = {
    username: nama,
    passwordHash: await hashPinLayered(sandi),
    role,
    permissions,
    namaLengkap,
    nip: sanitizeString(isi.nip ?? '', 32),
    catatan: sanitizeString(isi.catatan ?? '', 500),
    nonaktif: false,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(bersihkanUndefined(record));
  const { passwordHash: _hash, ...safe } = record;
  void _hash;
  return { ok: true, kode: 200, akun: safe };
}

export async function ubahAkun(
  token: string | undefined | null,
  username: string,
  isi: {
    usernameBaru?: string;
    password?: string;
    role?: UserRole;
    permissions?: Partial<TabPermissions>;
    namaLengkap?: string;
    nip?: string;
    catatan?: string;
    nonaktif?: boolean;
  }
): Promise<HasilAksi> {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil || pemanggil.role !== 'admin') {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  const nama = String(username ?? '').trim();
  const db = await admin();
  const ref = db.collection(COLL_PENGGUNA).doc(kunciAkun(nama));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, kode: 404, pesan: 'Pengguna tidak ditemukan.' };

  const sekarang = snap.data() as Record<string, any>;
  const roleBaru: UserRole = isi.role ?? (sekarang.role === 'admin' ? 'admin' : 'user');

  /*
   * Admin terakhir tidak boleh mengunci dirinya sendiri.
   *
   * Admin yang terakhir menurunkan peran atau dinonaktifkan akan mengunci
   * seluruh panel, jadi pemeriksaan harus selesai sebelum migrasi username
   * mulai menulis data.
   */
  const kehilanganAdmin =
    sekarang.role === 'admin' && (roleBaru !== 'admin' || isi.nonaktif === true);
  if (kehilanganAdmin) {
    const adminLain = await db
      .collection(COLL_PENGGUNA)
      .where('role', '==', 'admin')
      .limit(2)
      .get();
    const adaAdminLain = adminLain.docs.some(d => d.id !== kunciAkun(nama));
    if (!adaAdminLain) {
      return {
        ok: false,
        kode: 409,
        pesan:
          'Ini admin terakhir. Tunjuk admin lain sebelum menurunkan atau menonaktifkan akun ini.',
      };
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (isi.password) {
    const galat = validatePassword(isi.password);
    if (galat) return { ok: false, kode: 400, pesan: galat };
    patch.passwordHash = await hashPinLayered(isi.password);
  }
  if (isi.role) {
    patch.role = isi.role;
    if (isi.role === 'admin') patch.permissions = { ...DEFAULT_ADMIN_PERMISSIONS };
  }
  if (isi.permissions) {
    patch.permissions = batasiIzin(
      normalizeUserPermissions({ ...sekarang.permissions, ...isi.permissions }),
      roleBaru
    );
  }
  if (isi.namaLengkap !== undefined) {
    const namaLengkap = sanitizeString(isi.namaLengkap, 120);
    if (!namaLengkap) return { ok: false, kode: 400, pesan: 'Nama lengkap wajib diisi.' };
    patch.namaLengkap = namaLengkap;
  }
  if (isi.nip !== undefined) patch.nip = sanitizeString(isi.nip, 32);
  if (isi.catatan !== undefined) patch.catatan = sanitizeString(isi.catatan, 500);
  if (isi.nonaktif !== undefined) patch.nonaktif = Boolean(isi.nonaktif);

  const usernameBaru =
    isi.usernameBaru === undefined ? nama : String(isi.usernameBaru).trim().toLowerCase();
  const galatUsername = validateUsername(usernameBaru);
  if (galatUsername) return { ok: false, kode: 400, pesan: galatUsername };
  const gantiUsername = kunciAkun(nama) !== kunciAkun(usernameBaru);
  if (gantiUsername) {
    const kunciBaru = kunciAkun(usernameBaru);
    if (usernameBaru === (await namaAdmin())) {
      return { ok: false, kode: 409, pesan: 'Username tersebut dipakai admin bawaan.' };
    }
    const refAkunBaru = db.collection(COLL_PENGGUNA).doc(kunciBaru);
    const refLanggananLama = db.collection(COLL_LANGGANAN).doc(nama);
    const refLanggananBaru = db.collection(COLL_LANGGANAN).doc(usernameBaru);
    const refKredensialLama = db.collection(COLL_PENGATURAN).doc(dokKredensial(nama));
    const refKredensialBaru = db.collection(COLL_PENGATURAN).doc(dokKredensial(usernameBaru));
    const idMigrasi = `rename_akun__${kunciAkun(nama)}`;
    const refMigrasi = db.collection(COLL_PENGATURAN).doc(idMigrasi);
    const [akunBaru, langgananBaru, kredensialBaru, migrasi, tagihanNamaBaru] =
      await Promise.all([
        refAkunBaru.get(),
        refLanggananBaru.get(),
        refKredensialBaru.get(),
        refMigrasi.get(),
        db.collection(COLL_TAGIHAN).where('username', '==', usernameBaru).get(),
      ]);
    const dataMigrasi = migrasi.exists ? (migrasi.data() as Record<string, unknown>) : null;
    if (
      migrasi.exists &&
      (dataMigrasi?.dari !== nama || dataMigrasi?.ke !== usernameBaru)
    ) {
      return { ok: false, kode: 409, pesan: 'Migrasi username akun lain sedang berlangsung.' };
    }
    if (
      !migrasi.exists &&
      (akunBaru.exists ||
        langgananBaru.exists ||
        kredensialBaru.exists ||
        tagihanNamaBaru.docs.length > 0)
    ) {
      return { ok: false, kode: 409, pesan: 'Username baru sudah digunakan atau memiliki data.' };
    }

    if (!migrasi.exists) {
      await refMigrasi.set({
        dari: nama,
        ke: usernameBaru,
        dibuatPada: new Date().toISOString(),
      });
    }

    const tagihanLama = await db
      .collection(COLL_TAGIHAN)
      .where('username', '==', nama)
      .get();
    for (let mulai = 0; mulai < tagihanLama.docs.length; mulai += 400) {
      const batch = db.batch();
      for (const tagihan of tagihanLama.docs.slice(mulai, mulai + 400)) {
        const data = tagihan.data() as Record<string, unknown>;
        batch.set(
          db.collection(COLL_TAGIHAN).doc(tagihan.id),
          {
            ...data,
            username: usernameBaru,
            ...(data.usernameLabel === nama ? { usernameLabel: usernameBaru } : {}),
          },
          { merge: true }
        );
      }
      await batch.commit();
    }

    const [akunTujuan, langgananAsal, kredensialAsal] = await Promise.all([
      refAkunBaru.get(),
      refLanggananLama.get(),
      refKredensialLama.get(),
    ]);
    if (akunTujuan.exists) {
      await refMigrasi.delete();
      return { ok: false, kode: 409, pesan: 'Username baru sudah digunakan akun lain.' };
    }
    const batch = db.batch();
    batch.set(
      refAkunBaru,
      bersihkanUndefined({
        ...sekarang,
        ...patch,
        username: usernameBaru,
        usernameSebelumnya: [
          ...new Set([
            ...(Array.isArray(sekarang.usernameSebelumnya)
              ? sekarang.usernameSebelumnya.filter((nama: unknown): nama is string => typeof nama === 'string')
              : []),
            nama,
          ]),
        ].slice(-20),
      })
    );
    batch.delete(ref);
    if (langgananAsal.exists) {
      batch.set(refLanggananBaru, {
        ...(langgananAsal.data() as Record<string, unknown>),
        username: usernameBaru,
      });
      batch.delete(refLanggananLama);
    }
    if (kredensialAsal.exists) {
      batch.set(refKredensialBaru, kredensialAsal.data() as Record<string, unknown>);
      batch.delete(refKredensialLama);
    }
    batch.delete(refMigrasi);
    await batch.commit();
    return {
      ok: true,
      kode: 200,
      pesan: 'Username dan data akun berhasil dipindahkan.',
    };
  }

  await ref.set(bersihkanUndefined({ ...sekarang, ...patch }), { merge: true });
  return { ok: true, kode: 200 };
}

export async function hapusAkun(
  token: string | undefined | null,
  username: string
): Promise<HasilAksi> {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil || pemanggil.role !== 'admin') {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  const nama = String(username ?? '').trim();
  if (kunciAkun(nama) === kunciAkun(pemanggil.username)) {
    return { ok: false, kode: 409, pesan: 'Admin tidak bisa menghapus akunnya sendiri.' };
  }

  const db = await admin();
  const ref = db.collection(COLL_PENGGUNA).doc(kunciAkun(nama));
  if ((await ref.get()).exists) await ref.delete();
  await db.collection(COLL_PENGATURAN).doc(dokKredensial(nama)).delete();
  return { ok: true, kode: 200 };
}

// ═══════════════════════════════════════════════════════════════════════
//  Kredensial server pusat
// ═══════════════════════════════════════════════════════════════════════

/*
 * Kenapa kredensial pindah ke server.
 *
 * Semula `jatim_pengaturan/kredensial_server__*` bisa dibaca siapa pun
 * (`allow read: if true`), dan isinya `AES(password, VITE_APP_SECRET)` dengan
 * kunci yang ada di bundle peramban. Artinya password server pusat **semua
 * pengguna** bisa diambil dari Firebase Console lalu didekripsi di luar
 * aplikasi.
 *
 * Sekarang dokumennya hanya bisa ditulis dan dibaca server, dan sandinya
 * dienkripsi dengan kunci turunan `PANEL_SESSION_SECRET` yang tidak pernah
 * masuk bundle peramban.
 *
 * Konsekuensi yang jujur: dokumen lama yang dienkripsi dengan kunci `v1` tidak
 * bisa dibaca tanpa `VITE_APP_SECRET` di environment server juga. Kalau
 * variabel itu tidak ada, akun tersebut harus menyimpan ulang kredensialnya —
 * dan permintaannya dibuat eksplisit lewat `pesan`, bukan gagal diam-diam.
 */

function enkripsi(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', kunciKredensial(), iv);
  const data = NodeBuffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v2',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    data.toString('base64url'),
  ].join('.');
}

function dekripsi(teks: string): string | null {
  const bagian = String(teks ?? '').split('.');
  if (bagian.length !== 4 || bagian[0] !== 'v2') return null;
  try {
    const iv = NodeBuffer.from(bagian[1], 'base64url');
    const tag = NodeBuffer.from(bagian[2], 'base64url');
    const data = NodeBuffer.from(bagian[3], 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', kunciKredensial(), iv);
    decipher.setAuthTag(tag);
    return NodeBuffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Siapa yang boleh menyentuh kredensial sebuah akun.
 *
 * Dua pihak, keduanya sah karena peran keduanya dibaca dari dokumen:
 *
 * - **akun itu sendiri** — untuk auto-login dan pengaturan miliknya.
 * - **admin** — menu Manajemen Akun harus bisa mengatur NIP/password/IMEI
 *   untuk semua akun. Ini duty yang nyata di aplikasi ini, bukan pengecualian
 *   yang diselipkan: tanpa itu admin tidak bisa menyiapkan akun orang lain.
 *
 * ⚠️ Yang **tidak** ada di sini: peran yang diambil dari body request. Satu
 * username di body tidak pernah membuat siapa pun jadi admin.
 *
 * Perbandingan nama selalu melewati `kunciAkun()`, persis seperti saat
 * penulisan, jadi `../` atau bentuk lain yang menyamar tidak bisa membaca
 * dokumen orang lain.
 */
async function cekPemilik(
  token: string | undefined | null,
  username: string
): Promise<UserAccountSafe | null> {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil) return null;
  if (kunciAkun(pemanggil.username) !== kunciAkun(String(username ?? ''))) {
    return pemanggil.role === 'admin' ? pemanggil : null;
  }
  return pemanggil;
}

/**
 * Nama dokumen kredensial milik **akun yang dituju**.
 *
 * ## ⚠️ Ini sumber bug yang membuat fitur "admin atur kredensial akun lain"
 * ## tidak pernah bekerja
 *
 * `cekPemilik()` mengembalikan **pemanggil** — orang yang mengirim request.
 * Untuk akun biasa, pemanggil = akun tujuan, jadi `pemanggil.username` terlihat
 * benar. Untuk **admin** keduanya berbeda, dan tiga fungsi kredensial
 * menulis/membaca `dokKredensial(pemanggil.username)`:
 *
 * - `simpanKredensial` — admin menyimpan untuk "budi" → tersimpan di dokumen
 *   **admin**. Kredensial "budi" tidak pernah ada, dan kredensial admin sendiri
 *   tertimpa.
 * - `ringkasKredensial` — dialog edit admin membaca ringkasan **admin**, jadi
 *   NIP/IMEI yang ditampilkan bukan milik akun yang sedang diedit.
 * - `hapusKredensial` — admin menghapus untuk "budi" → dokumen **admin** yang
 *   terhapus.
 *
 * Gejalanya tidak pernah muncul sebagai error — server membalas `{ ok: true }`.
 * Yang gagal adalah hal yang tidak terlihat: auto-login "budi" tidak pernah
 * berhasil karena kredensialnya tidak pernah ada di dokumen miliknya.
 *
 * Jadi semua fungsi kredensial memakai nama **target** untuk nama dokumennya,
 * setelah `cekPemilik()` membuktikan request-nya sah. Untuk non-admin,
 * `cekPemilik()` hanya lolos bila targetnya sama dengan dirinya — jadi memakai
 * nama target di sini tidak membuka dokumen akun lain.
 *
 * `toLowerCase()` wajib: `cekPemilik()` membandingkan lewat `kunciAkun()`, yang
 * **tidak** melakukan lowercase, jadi "Budi" dan "budi" lolos sebagai yang sama.
 * Tanpa lowercase di sini, `dokKredensial('Budi')` dan `dokKredensial('budi')`
 * akan menjadi dua dokumen berbeda untuk satu akun.
 */
function dokKredensialTarget(username: string): string {
  return dokKredensial(String(username ?? '').trim().toLowerCase());
}

/**
 * Metadata kredensial tanpa passwordnya.
 *
 * Yang dikembalikan hanya `nip`, `imei`, dan apakah password-nya masih bisa
 * dibaca server. Field `passwordEncrypted` tidak ikut respons metadata ini;
 * pengembalian password hanya terjadi lewat aksi Web tersendiri yang diminta
 * pengguna dan selalu menentukan akun dari token.
 */
export async function ringkasKredensial(
  token: string | undefined | null,
  username: string
): Promise<HasilAksi & { ringkasan?: RingkasanKredensial }> {
  const pemanggil = await cekPemilik(token, username);
  if (!pemanggil) return { ok: false, kode: 403, pesan: 'Hanya untuk akun sendiri.' };

  // ⚠️ Dokumen **target**, bukan `pemanggil.username` — lihat `dokKredensialTarget`.
  // Dengan `pemanggil.username`, admin yang mengedit akun orang lain selalu
  // membaca ringkasan miliknya sendiri, jadi NIP/IMEI yang tampil di form
  // bukan milik akun yang sedang diedit.
  const snap = await (await admin())
    .collection(COLL_PENGATURAN)
    .doc(dokKredensialTarget(username))
    .get();
  if (!snap.exists) return { ok: false, kode: 404, pesan: 'Kredensial server belum diatur.' };

  const data = snap.data() as Record<string, any>;
  const terbaca = dekripsi(String(data.passwordEncrypted ?? '')) !== null;

  return {
    ok: true,
    kode: 200,
    ringkasan: bersihkanUndefined({
      nip: String(data.nip ?? ''),
      imei: String(data.imei ?? ''),
      terbaca,
      updatedAt: String(data.updatedAt ?? ''),
      pesan: terbaca
        ? undefined
        : 'Kredensial lama belum bisa dibaca server. Simpan ulang password server pusat dari menu Manajemen Akun.',
    }) as RingkasanKredensial,
  };
}

/**
 * Kredensial Web untuk akun dari token saat ini.
 *
 * Password hanya dikirim ke browser untuk mengisi formulir Web setelah
 * pemanggil meminta fitur ini. Tidak menerima username dari body: akun target
 * selalu ditentukan oleh token, sehingga kredensial akun lain tidak dapat
 * diminta bahkan oleh admin.
 */
export async function kredensialWebSendiri(
  token: string | undefined | null
): Promise<HasilAksi & { kredensial?: { nip: string; password: string } }> {
  const akun = await akunDariToken(token);
  if (!akun) return { ok: false, kode: 401, pesan: 'Sesi tidak valid. Login ulang.' };

  const snap = await (await admin())
    .collection(COLL_PENGATURAN)
    .doc(dokKredensialTarget(akun.username))
    .get();
  if (!snap.exists) {
    return { ok: false, kode: 404, pesan: 'Kredensial server belum diatur.' };
  }

  const data = snap.data() as Record<string, any>;
  const nip = String(data.nip ?? '');
  const password = dekripsi(String(data.passwordEncrypted ?? ''));
  if (!nip || password === null) {
    return { ok: false, kode: 422, pesan: 'Password server tersimpan tidak dapat dibaca. Simpan ulang kredensial.' };
  }

  return { ok: true, kode: 200, kredensial: { nip, password } };
}

/**
 * Metadata kredensial **semua** akun — hanya untuk admin.
 *
 * ## Kenapa perlu ada
 *
 * Halaman Manajemen Akun menampilkan kolom NIP/IMEI untuk setiap akun. Tanpa
 * fungsi ini, `ringkasanKredensial()` dipanggil dalam `loop`: 40 akun berarti
 * 40 request HTTP, dan tiap request memanggil `cekPemilik()` → `akunDariToken()`
 * → `verifikasiToken()` → **satu pembacaan Firestore untuk token**. Jadi 40
 * akun = 40 request + 40 pembacaan token + 40 pembacaan kredensial.
 *
 * Semua pekerjaan itu berulang: tokennya sama, otorisasinya sama, dan yang
 * berbeda hanya nama dokumen. Di sini jadi satu request, satu verifikasi, dan
 * satu `getAll()` — pembacaan batch, bukan NWI.
 *
 * `getAll()` mengembalikan dokumen yang ada saja. Akun tanpa dokumen kredensial
 * tidak muncul di hasil, dan pemanggil memaparkannya ke "belum diatur" — sama
 * seperti `ringkasanKredensial()` yang mengembalikan 404.
 *
 * ⚠️ `passwordEncrypted` **tidak pernah** ikut. Yang dikirim hanya `nip`,
 * `imei`, dan apakah password-nya masih bisa dibaca server.
 */
export async function ringkasSemuaKredensial(
  token: string | undefined | null
): Promise<HasilAksi & { daftar?: Record<string, RingkasanKredensial> }> {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil || pemanggil.role !== 'admin') {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  const db = await admin();

  /*
   * `getAll()` tidak bisa "ambil semua dokumen dengan awalan nama" — Firestore
   * tidak punya operator awalan. Jadi daftar nama dokumen harus diketahui lebih
   * dulu, dan sumbernya adalah koleksi akun.
   */
  const akunSnap = await db.collection(COLL_PENGGUNA).limit(BATAS_AKUN_PANEL + 1).get();
  if (akunSnap.size > BATAS_AKUN_PANEL) {
    return {
      ok: false,
      kode: 409,
      pesan: `Jumlah akun melewati batas ${BATAS_AKUN_PANEL}. Daftar sengaja tidak dipotong — hubungi pengelola sistem.`,
    };
  }
  const akun = akunSnap.docs.map(d => ({
    username: String((d.data() as Record<string, any>).username ?? d.id),
    ref: db.collection(COLL_PENGATURAN).doc(dokKredensial(String((d.data() as Record<string, any>).username ?? d.id))),
  }));

  const hasil: Record<string, RingkasanKredensial> = {};

  // Batch read: satu round-trip untuk semua dokumen, bukan satu per akun.
  // `Firestore.getAll()` dibatasi 300 dokumen per panggilan.
  for (let i = 0; i < akun.length; i += 300) {
    const potongan = akun.slice(i, i + 300);
    const snaps = await db.getAll(...potongan.map(a => a.ref));
    snaps.forEach((s: { exists: boolean; data: () => Record<string, any> | undefined }, idx: number) => {
      if (!s.exists) return;
      const data = s.data() as Record<string, any>;
      const terbaca = dekripsi(String(data.passwordEncrypted ?? '')) !== null;
      hasil[potongan[idx].username] = bersihkanUndefined({
        nip: String(data.nip ?? ''),
        imei: String(data.imei ?? ''),
        terbaca,
        updatedAt: String(data.updatedAt ?? ''),
        pesan: terbaca
          ? undefined
          : 'Kredensial lama belum bisa dibaca server. Simpan ulang password server pusat dari menu Manajemen Akun.',
      }) as RingkasanKredensial;
    });
  }

  return { ok: true, kode: 200, daftar: hasil };
}

/** Bentuk ringkasan kredensial — sama dengan yang dikirim per-akun. */
export interface RingkasanKredensial {
  nip: string;
  imei: string;
  /** true = password tersimpan dan bisa dibaca server. */
  terbaca: boolean;
  updatedAt: string;
  /** Penjelasan server kalau `terbaca` false. */
  pesan?: string;
}

/**
 * Simpan (atau perbarui sebagian) kredensial server pusat.
 *
 * `password` kosong berarti **"jangan diubah passwordnya"** — `passwordEncrypted`
 * yang ada tidak ikut ditulis karena `merge: true` dan field itu tidak dikirim.
 * Ini mungkin karena server yang mengenkripsi: tidak ada bentuk "tulis ulang
 * dari plaintext yang sudah ada", jadi sebagian update harus tetap mungkin.
 *
 * Kalau dokumennya belum ada dan password kosong, ditolak: dokumen tanpa
 * password tidak akan pernah bisa dipakai auto-login, dan menyimpan yang tidak
 * berguna lebih baik ditolak sekarang dengan pesan yang jelas.
 */
export async function simpanKredensial(
  token: string | undefined | null,
  isi: { username: string; nip: string; password: string; imei?: string }
): Promise<HasilAksi> {
  const pemanggil = await cekPemilik(token, isi.username);
  if (!pemanggil) return { ok: false, kode: 403, pesan: 'Hanya untuk akun sendiri.' };

  const nip = sanitizeString(isi.nip, 32);
  const sandi = String(isi.password ?? '');
  if (!nip) return { ok: false, kode: 400, pesan: 'NIP wajib diisi.' };

  const db = await admin();
  // ⚠️ Dokumen **target**. `pemanggil.username` akan menulis kredensial "budi"
  // ke dokumen admin — dan kredensial admin sendiri ikut tertimpa.
  const ref = db.collection(COLL_PENGATURAN).doc(dokKredensialTarget(isi.username));
  const snap = await ref.get();

  if (!sandi && !snap.exists) {
    return { ok: false, kode: 400, pesan: 'Password server wajib diisi untuk kredensial baru.' };
  }

  const patch: Record<string, unknown> = {
    nip,
    imei: sanitizeString(isi.imei ?? '', 64),
    updatedAt: new Date().toISOString(),
  };
  if (sandi) patch.passwordEncrypted = enkripsi(sandi);

  await ref.set(bersihkanUndefined(patch), { merge: true });
  return { ok: true, kode: 200 };
}

export async function hapusKredensial(
  token: string | undefined | null,
  username: string
): Promise<HasilAksi> {
  const pemanggil = await cekPemilik(token, username);
  if (!pemanggil) return { ok: false, kode: 403, pesan: 'Hanya untuk akun sendiri.' };
  // ⚠️ Dokumen **target**, bukan `pemanggil.username` — lihat `dokKredensialTarget`.
  await (await admin())
    .collection(COLL_PENGATURAN)
    .doc(dokKredensialTarget(username))
    .delete();
  return { ok: true, kode: 200 };
}

// ═══════════════════════════════════════════════════════════════════════
//  Auto-login ke server pusat
// ═══════════════════════════════════════════════════════════════════════

/**
 * Login ke **server pusat** atas nama akun panel.
 *
 * ## Kenapa langkah ini harus di server
 *
 * Auto-login butuh password server pusat, dan password itu tersimpan terenkripsi
 * di dokumen milik pengguna. Kalau peramban yang mendekripsi lalu mengirimkannya,
 * kuncinya (`VITE_APP_SECRET`) harus ada di bundle — yang membuat seluruh
 * password server pusat bisa diambil dari Firebase Console dan didekripsi di
 * luar aplikasi.
 *
 * Jadi sekarang: peramban hanya memberi tahu **akun mana**, server mendekripsi,
 * server yang memanggil gateway, dan yang kembali ke peramban hanya `api_key`
 * plus profil. Password polos tidak pernah dikembalikan oleh aksi ini ke
 * peramban.
 *
 * `api_key` sendiri memang sudah selalu ada di peramban — itu nature dari sesi
 * gateway, dan tidak berubah karena langkah ini dipindah. Yang hilang adalah
 * password yang **juga** ada di sana.
 */
export async function autoLoginPusat(
  token: string | undefined | null,
  username: string,
  opsi: { imei?: string } = {}
): Promise<
  { ok: true; apiKey: string; profil: Record<string, unknown> } | { ok: false; kode: number; pesan: string }
> {
  const pemanggil = await cekPemilik(token, username);
  if (!pemanggil) return { ok: false, kode: 403, pesan: 'Hanya untuk akun sendiri.' };

  const db = await admin();
  // ⚠️ Dokumen **target**. Auto-login selalu untuk akun pemanggil sendiri, jadi
  // di jalur ini keduanya sama — tapi memakai `pemanggil.username` menjebak
  // pembacaan ini pada dokumen yang salah begitu pun dipanggil untuk akun lain.
  const snap = await db.collection(COLL_PENGATURAN).doc(dokKredensialTarget(username)).get();
  if (!snap.exists) {
    return { ok: false, kode: 404, pesan: 'Kredensial server pusat belum diatur.' };
  }

  const data = snap.data() as Record<string, any>;
  const nip = String(data.nip ?? '');
  const sandi = dekripsi(String(data.passwordEncrypted ?? ''));
  if (!nip || sandi === null) {
    return {
      ok: false,
      kode: 422,
      pesan:
        'Kredensial server pusat belum bisa dibaca server. Simpan ulang dari menu Manajemen Akun.',
    };
  }

  /*
   * ## Urutan IMEI: **dokumen kredensial menang**
   *
   * ⚠️ Semula `opsi.imei ?? data.imei ?? ''`, dan itu membatalkan tujuan
   * fitur "admin isi IMEI dari Manajemen Akun".
   *
   * Dua sumber, dan keduanya hampir selalu berisi:
   *
   * 1. `data.imei` — yang diisi admin di Manajemen Akun.
   * 2. `opsi.imei` — TechMark dari peramban (`imeiStabil()`), UUID yang
   *    di-generate sekali lalu disimpan di `localStorage`.
   *
   * `??` hanya memakai nomor 2 kalau nomor 1 `null`/`undefined`. Tapi UUID dari
   * peramban **tidak pernah kosong** — jadi `opsi.imei` selalu menang dan IMEI
   * yang diisi admin selalu dibuang. Untuk akun yang servernya mengunci ke satu
   * perangkat, itu berarti login ditolak 402 apa pun yang diisi admin.
   *
   * `||` membalik prioritasnya dengan benar: IMEI dari admin dipakai kalau ada,
   * dan TechMark peramban hanya jadi pengganti saat admin belum mengisinya —
   * yaitu persis akun yang tidak terkunci ke perangkat, di mana nilai IMEI
   * memang tidak dibandingkan.
   */
  const imei = sanitizeString(data.imei || opsi.imei || '', 64);

  /*
   * `latlong` wajib berisi koordinat pada envelope `login`. Aplikasi ini
   * tidak memakai GPS saat login, jadi kirim nilai netral yang sama dengan
   * form web: `0,0`.
   */
  const envelope = buildRpcEnvelope('login', {
    email: nip,
    password: sandi,
    latlong: '0,0',
    imei,
    api_key: '',
    last_latlong: '',
  });

  try {
    const upstream = await fetch(process.env.PRESENSI_BASE_URL || GATEWAY_BAWAAN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': 'okhttp/4.12.0',
        'Accept-Encoding': 'gzip',
      },
      body: JSON.stringify(envelope),
    });

    const teks = await upstream.text();
    type BalasanGateway = { result?: Record<string, unknown>; error?: unknown };
    let parsed: BalasanGateway | null = null;
    try {
      parsed = JSON.parse(teks) as BalasanGateway;
    } catch {
      return { ok: false, kode: 502, pesan: 'Server pusat mengembalikan respons yang bukan JSON.' };
    }

    const galat = parsed?.error as { message?: string; code?: number } | string | undefined;
    if (galat) {
      const pesan =
        typeof galat === 'string' ? galat : galat.message ?? 'Permintaan ditolak server pusat.';
      const kodeGateway = typeof galat === 'object' && galat ? galat.code : undefined;
      // 402 = akun terkunci ke perangkat lain. Dibawa apa adanya supaya UI
      // menampilkan kolom IMEI, bukan pesan umum.
      return { ok: false, kode: kodeGateway === 402 ? 402 : 401, pesan };
    }

    const hasil = parsed?.result as Record<string, unknown> | undefined;
    const apiKey = String(hasil?.api_key ?? '');
    if (!hasil || !apiKey) {
      return { ok: false, kode: 401, pesan: 'NIP atau password server pusat tidak cocok.' };
    }

    return { ok: true, apiKey, profil: { ...hasil, nip, imei } };
  } catch (err: any) {
    return {
      ok: false,
      kode: 502,
      pesan: `Gagal menghubungi server pusat: ${err?.message ?? 'tidak diketahui'}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Password akun panel milik sendiri
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ganti password akun sendiri.
 *
 * Untuk akun berbasis dokumen; admin bawaan ditangani `ubahAdminBawaan`.
 * Password lama diverifikasi terhadap dokumen, jadi sesi yang dibajak saja
 * tidak cukup untuk mengunci pemilik akun.
 */
export async function gantiPasswordSendiri(
  token: string | undefined | null,
  isi: { passwordLama: string; passwordBaru: string }
): Promise<HasilAuth> {
  const pemanggil = await akunDariToken(token);
  if (!pemanggil) return { ok: false, kode: 401, pesan: 'Sesi tidak valid.' };

  const baru = String(isi.passwordBaru ?? '');
  const galat = validatePassword(baru);
  if (galat) return { ok: false, kode: 400, pesan: galat };

  const db = await admin();
  const ref = db.collection(COLL_PENGGUNA).doc(kunciAkun(pemanggil.username));
  const snap = await ref.get();

  if (!snap.exists) {
    return {
      ok: false,
      kode: 400,
      pesan: 'Akun admin bawaan — ganti lewat bagian "Ganti Password" yang sama.',
    };
  }

  const sekarang = snap.data() as Record<string, any>;
  const sah = await verifyPinLayered(
    String(isi.passwordLama ?? ''),
    String(sekarang.passwordHash ?? '')
  );
  if (!sah) return { ok: false, kode: 401, pesan: 'Password lama tidak valid.' };

  await ref.set(
    { passwordHash: await hashPinLayered(baru), updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return { ok: true, kode: 200, pesan: 'Password berhasil diperbarui.' };
}
