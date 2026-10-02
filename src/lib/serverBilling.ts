/**
 * Aktivasi langganan — sisi server.
 *
 * ## Kenapa harus di server
 *
 * Versi sebelumnya aktivasi dilakukan dari peramban: klien memanggil
 * `catatPembayaran()` yang menulis `masaAkhir` ke Firestore dengan nilai
 * yang dikirim klien. Siapa pun yang bisa membuka DevTools bisa memanggil
 * fungsi yang sama dengan nilai pilihan sendiri — termasuk `durasiHari:
 * 36500` atau `masaAkhir: 2099-12-31`. Aturan "wajib bayar" seperti
 * itu bukan aturan, hanya hiasan.
 *
 * Yang dilakukan modul ini:
 *
 * 1. **Harga dan durasi selalu dihitung server** dari id paket yang ada di
 *    konfigurasi. Nilai yang dikirim klien hanya dipakai untuk mencocokkan,
 *    tidak pernah dipercaya.
 * 2. **Untuk Midtrans, status dicek ke API** memakai `Server Key`. Hanya
 *    `settlement` + `fraud_status: accept` yang mengaktifkan.
 * 3. Penulisan memakai Firebase Admin SDK, sehingga **tidak bisa** dilakukan
 *    dari sisi klien sama sekali — Firestore Rules menutup jalannya.
 *
 * ## Batas yang jujur
 *
 * QRIS manual dan transfer bank tidak bisa diverifikasi dari server: tidak
 * ada API bank yang bisa ditanyakan. Jadi aktivasi untuk metode itu tetap
 * berdasarkan keyakinan pengguna, dan akan tercatat dengan `sumber: 'manual'`
 * supaya admin bisa mengetaui mana yang perlu diperiksa mutasi. Yang
 *(server) jagakan adalah nominal dan durasinya — klien tidak bisa
 * memilihnya.
 */

export interface HasilAktivasi {
  ok: boolean;
  /** ISO timestamp masa aktif setelah pembayaran. */
  masaAkhir?: string;
  masaMulai?: string;
  /** Nominal yang benar-benar dipakai server. */
  nominal?: number;
  durasi?: number;
  satuan?: SatuanDurasi;
  sumber?: SumberAktivasi;
  /** Status transaksi Midtrans, kalau relevan. */
  statusTransaksi?: string;
  /** Alasan penolakan; selalu ada kalau `ok` false. */
  pesan?: string;
  kode?: number;
}

/* Admin SDK dimuat oleh firestoreAdmin.ts saat endpoint membutuhkannya. */
/*
 * Diimpor dari `durasi.ts`, bukan dari `langganan.ts`.
 *
 * `langganan.ts` mengimpor SDK Firebase klien. Kalau modul itu ikut
 * terbawa ke sini, bundel server ikut memuat konfigurasi yang dibaca dari
 * `import.meta.env` — yang kosong di bundel CJS — dan mencetak "Mode demo
 * aktif" di layar Admin setiap kali server dinyalakan, padahal server ini
 * memakai Admin SDK dan sama sekali tidak butuh konfigurasi itu.
 *
 * `durasi.ts` berisi fungsi yang sama tanpa satu pun impor Firebase. Lihat
 * `durasi.ts` untuk penjelasan lengkap.
 */
import {
  normalisasiDaftarPaket,
  PREFIX_ORDER_ID,
  tambahDurasi,
  type MetodePembayaran,
  type PaketLangganan,
  type SatuanDurasi,
} from './durasi';
import { bersihkanUndefined } from './firestoreAman';
/*
 * Instance Firestore Admin diambil dari modul bersama.
 *
 * Semula modul ini memuat `firebase-admin` sendiri. Sekarang
 * `lib/firestoreAdmin.ts` yang menyimpan satu salinannya, karena
 * `lib/panelServer.ts` juga butuh instance yang **sama** — dua app yang
 * diinisialisasi terpisah di satu proses membuat hanya satu kredensial yang
 * dikenali, dan gejalanya `Must initialize the SDK with a certificate
 * credential` yang muncul tiba-tiba di deployment tertentu.
 *
 * `adminTersedia()` diekspor ulang dari sini supaya pemanggil yang sudah
 * mengimpor dari modul ini (`src/serverless/billing-aktivasi.ts`) tidak ikut
 * berubah.
 */
import { admin, adminTersedia } from './firestoreAdmin';
import { midtransProduksi } from './midtransEnv';

export { adminTersedia };

/** Koleksi & dokumen — sama dengan `lib/firebase.ts` tapi di sisi server. */
const COLL_PENGATURAN = 'jatim_pengaturan';
const COLL_LANGGANAN = 'jatim_langganan';
const COLL_TAGIHAN = 'jatim_tagihan';
const DOC_BILLING = 'billing';

export type SumberAktivasi = 'midtrans' | 'manual';

/*
 * ⚠️ Pemuat `firebase-admin` TIDAK lagi ada di modul ini.
 *
 * Semula modul ini memuat sendiri, dan itu benar ketika modul ini satu-satunya
 * pemakai Admin SDK. Sekarang `lib/panelServer.ts` juga butuh instance yang sama,
 * dan dua app yang diinisialisasi terpisah di satu proses membuat hanya satu
 * kredensial yang dikenali — gejalanya
 *
 *     Must initialize the SDK with a certificate credential
 *
 * yang muncul justru saat billing terlihat bekerja di dev dan gagal di server.
 * Pemuat beserta catatan lengkap soal impor dinamis lewat variabel specifier
 * (supaya `@google-cloud/firestore` tidak jadi syarat build) dipindah ke
 * `lib/firestoreAdmin.ts`. Impor di atas mengambilnya.
 */
type TransactionDyn = import('firebase-admin/firestore').Transaction;


// ═══════════════════════════════════════════════════════════════════════
//  Helper
// ═══════════════════════════════════════════════════════════════════════

interface DokumenBilling {
  paket?: PaketLangganan[];
}

async function bacaPaket(): Promise<PaketLangganan[]> {
  const snap = await (await admin()).collection(COLL_PENGATURAN).doc(DOC_BILLING).get();
  const data = snap.data() as DokumenBilling | undefined;
  // `normalisasiDaftarPaket` sekaligus menyalin paket lama yang masih
  // memakai `durasiHari` ke bentuk satuan kalender.
  return normalisasiDaftarPaket(data?.paket);
}

/**
 * Ambil `orderId` → paket.
 *
 * `idTagihan()` membentuk `PRABAWA-<PAKET>-<WAKTU>`, jadi paket bisa dibaca
 * dari nama order. Awalan itu dicocokkan **sama persis**, dan id paketnya
 * dicocokkan dengan konfigurasi.
 *
 * Dua-duanya wajib. Kalau paket tidak ada (atau admin menghapusnya setelah
 * tagihan dibuat), aktivasi ditolak — bukan jatuh ke harga default.
 *
 * Tidak ada toleransi untuk awalan lain. Awalan bukan informasi: yang
 * menentukan harga hanyalah id paket, dan itu sudah dicocokkan ketat di
 * bawah. Awalan cukup sebagai pemisah supaya id paket dan cap waktu tidak
 * saling tertukar.
 */

function paketDariOrderId(orderId: string, paket: PaketLangganan[]): PaketLangganan | null {
  const atas = orderId.toUpperCase();
  const cocok = paket.find(item =>
    atas.startsWith(`${PREFIX_ORDER_ID}-${item.id.toUpperCase()}-`)
  );
  return cocok ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Verifikasi Midtrans
// ═══════════════════════════════════════════════════════════════════════

export interface HasilVerifikasiMidtrans {
  ok: boolean;
  status?: string;
  nominal?: number;
  waktuBayar?: string;
  pesan?: string;
}

/**
 * Tanya status transaksi ke Midtrans.
 *
 * `Server Key` hanya dibaca di sini. Nominal dikembalikan apa adanya supaya
 * pemanggil bisa membandingkannya dengan harga paket — membandingkan
 * `gross_amount` dengan yang diklaim klien.
 */
export async function verifikasiMidtrans(
  orderId: string,
  options: { serverKey: string; produksi: boolean }
): Promise<HasilVerifikasiMidtrans> {
  const base = options.produksi ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
  const auth = Buffer.from(`${options.serverKey}:`).toString('base64');

  try {
    const response = await fetch(
      `${base}/v2/${encodeURIComponent(orderId)}/status`,
      { headers: { Accept: 'application/json', Authorization: `Basic ${auth}` } }
    );
    const data: any = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        pesan:
          data?.error_messages?.[0] ||
          `Transaksi tidak ditemukan di Midtrans (HTTP ${response.status}).`,
      };
    }

    const status = String(data.transaction_status ?? '');
    const fraud = String(data.fraud_status ?? '');

    // `settlement` = uang masuk. `fraud_status` wajib `accept` —Midtrans
    // bisa menahan transaksi yang dicurigai, dan transaksi yang ditahan
    // TIDAK boleh mengaktifkan langganan.
    if (status !== 'settlement') {
      const pesan =
        status === 'pending'
          ? 'Pembayaran belum diterima (masih pending).'
          : status === 'expire'
            ? 'Kedaluwarsa sebelum dibayar.'
            : `Transaksi berstatus "${status || 'tidak diketahui'}", belum lunas.`;
      return { ok: false, status, nominal: Number(data.gross_amount ?? 0) || undefined, pesan };
    }
    if (fraud && fraud !== 'accept') {
      return { ok: false, status, pesan: `Transaksi ditahan Midtrans (fraud_status: ${fraud}).` };
    }

    /*
     * ⚠️ `gross_amount` WAJIB ada di respons settlement.
     *
     * Versi lama menulis `Number(data.gross_amount ?? 0) || undefined`, jadi
     * `gross_amount` yang hilang, `null`, `""`, atau `"0"` berakhir jadi
     * `undefined`. Di `aktifkanLangganan` pemeriksaannya berbunyi
     * `hasil.nominal !== undefined && hasil.nominal !== harga` — jadi saat
     * nominalnya `undefined`, seluruh pemeriksaan itu **dilewati begitu
     * saja** dan paket penuh diberikan.
     *
     * Justru itulah kasus yang paling Wanted: nominal yang tidak terbaca
     * berarti server tidak punya bukti nominal sama sekali, dan tidak punya
     * bukti berarti tidak boleh mengaktifkan apa pun. Transaksi dengan
     * nominal tak terbaca ditolak di sini, bukan diteruskan.
     */
    const nominal = typeof data.gross_amount === 'string' || typeof data.gross_amount === 'number'
      ? Math.round(Number(data.gross_amount))
      : NaN;
    if (!Number.isFinite(nominal) || nominal <= 0) {
      return {
        ok: false,
        status,
        pesan: 'Nominal transaksi tidak terbaca dari Midtrans, pembayaran tidak bisa diverifikasi.',
      };
    }

    return {
      ok: true,
      status,
      nominal,
      waktuBayar: typeof data.waktu_paid === 'string' ? data.waktu_paid : undefined,
    };
  } catch (err: any) {
    return { ok: false, pesan: `Gagal menghubungi Midtrans: ${err?.message ?? 'tidak diketahui'}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Operasi admin
//
//  Semuanya menulis ke `jatim_langganan` / `jatim_tagihan` /
//  `jatim_pengaturan/billing`, yang ketiganya `write: if false` di
//  `firestore.rules`. Jadi **tidak ada** versi peramban yang bisa bekerja —
//  pemanggilannya harus lewat server. Fungsi-fungsi di sini adalah satu-satunya
//  jalan tulis, dan seluruhnya memakai Admin SDK.
//
//  Yang ditolak dan alasannya:
//
//  - `totalBayar` / `jumlahBayar` tidak pernah naik dari perpanjangan manual.
//    Menaikkan angka tanpa uang masuk berarti rekap keuangan tidak lagi
//    mencerminkan apa yang benar-benar terjadi.
//  - Durasi dan tanggal akhir **dihitung server** dari nilai server. Nilai
//    dari klien hanya dicocokkan, tidak pernah dipakai — sama seperti harga
//    paket di `aktifkanLangganan()`.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Token pemanggil.
 *
 * ⚠️ Setiap fungsi di bawah **wajib** memverifikasi ini sebagai langkah
 * pertamanya, lewat `dindingAdmin()`.
 *
 * Parameternya sengaja ada di setiap fungsi, bukan diambil dari satu tempat,
 * karena "hanya admin" itu sendiri keputusan keamanan — dan keputusan yang
 * diambil sekali di awal lalu diteruskan diam-diam adalah tempat paling umum
 * aturan ini dilanggar.
 */
type AdminToken = string | undefined | null;

/**
 * Gerbang admin untuk operasi yang menulis langganan/billing/tagihan.
 *
 * Satu helper untuk semua operasi, karena "perlu admin" adalah satu fakta —
 * dan satu fakta yang diulang di tujuh tempat akan luber di tempat yang paling
 * terlupakan.
 *
 * Perannya dibaca dari dokumen (`akunDariToken()`), bukan dari token — jadi
 * `role: 'admin'` di body atau di storage tidak berarti apa-apa.
 */
async function dindingAdmin(
  token: AdminToken
): Promise<{ ok: true } | { ok: false; kode: number; pesan: string }> {
  const { adalahAdminToken } = await import('./panelServer');
  if (await adalahAdminToken(token)) return { ok: true };
  return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
}

/**
 * Akun pemanggil, dari token.
 *
 * Bentuknya sama dengan `dindingAdmin` di atas — pemuatan dinamis
 * `panelServer` — tapi mengembalikan akunnya, karena pembacaan di bawah
 * memerlukan **nama akun** dan tidak cukup tahu "dia admin atau bukan".
 *
 * Nama yang dikembalikan ini yang menentukan dokumen mana yang dibaca, jadi
 * pemanggilnya tidak boleh pernah meneruskan nama dari `input` atau `body`.
 */
async function akunPemanggil(
  token: AdminToken
): Promise<{ username: string; role: string } | null> {
  const { akunDariToken } = await import('./panelServer');
  return akunDariToken(token);
}

/** Bentuk dokumen langganan, seperlunya — server tidak butuh semua field. */
interface DokumenLanggananSebagian {
  paketId?: string;
  masaMulai?: string;
  masaAkhir?: string;
  gratis?: boolean;
  alasanGratis?: string;
  totalBayar?: number;
  jumlahBayar?: number;
  pembayaranTerakhir?: unknown;
  createdAt?: string;
}

/**
 * Sisa hari sampai `masaAkhir`; negatif berarti sudah lewat.
 *
 * Dibulatkan ke **atas** supaya 12 jam tersisa masih dihitung "1 hari" —
 * sama seperti `sisaHari()` di `lib/langganan.ts`. Kalau server dan peramban
 * menghitung berbeda, satuhitung mundur di layar admin akan melenceng satu
 * hari dari yang sebenarnya.
 */
function sisaHari(masaAkhir: string | undefined, dari: Date): number {
  if (!masaAkhir) return -1;
  const akhir = new Date(masaAkhir).getTime();
  if (!Number.isFinite(akhir)) return -1;
  return Math.ceil((akhir - dari.getTime()) / 86_400_000);
}

/** Tanggal setelah `n` hari dari `dari` — identik dengan versi peramban. */
function tambahHari(dari: Date, n: number): Date {
  const hasil = new Date(dari.getTime());
  hasil.setDate(hasil.getDate() + n);
  return hasil;
}

function usernameValid(username: string): boolean {
  return Boolean(username) && !/[\\/]/.test(username) && username.length <= 64;
}

/**
 * Perpanjang masa aktif tanpa mencatat pembayaran — khusus admin.
 *
 * Perpanjangan ditumpangkan di atas `masaAkhir` yang sudah ada kalau masih
 * hidup, dan dihitung dari hari ini kalau sudah lewat. Jadi "tambah 3 bulan"
 * yang diklik hari ini benar-benar 3 bulan ke depan, bukan 3 bulan sejak
 * pembelian pertama.
 */
export async function perpanjangManualServer(
  _token: AdminToken,
  input: { username: string; durasi?: number; satuan?: SatuanDurasi; catatan?: string }
): Promise<{ ok: boolean; kode: number; pesan?: string; dokumen?: Record<string, unknown> }> {
  if (!(await dindingAdmin(_token)).ok) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  const { username } = input;
  if (!usernameValid(username)) {
    return { ok: false, kode: 400, pesan: 'Username tidak valid.' };
  }

  const durasi = Number(input.durasi ?? 1);
  const satuan: SatuanDurasi =
    input.satuan === 'hari' || input.satuan === 'tahun' ? input.satuan : 'bulan';
  if (!Number.isFinite(durasi) || durasi <= 0 || durasi > 3650) {
    // 3650 = 10 tahun. Di atas itu hampir pasti salah input, dan salah input
    // seperti ini tidak disadari selama berbulan-bulan.
    return { ok: false, kode: 400, pesan: 'Durasi tidak valid (maksimal 10 tahun).' };
  }

  const db = await admin();
  const sekarang = new Date();
  const ref = db.collection(COLL_LANGGANAN).doc(username.trim());
  const snap = await ref.get();
  const lama = (snap.data() ?? {}) as DokumenLanggananSebagian;

  const sisa = sisaHari(lama.masaAkhir, sekarang);
  const dasar = sisa > 0 ? tambahHari(sekarang, sisa) : sekarang;
  const masaAkhirBaru = tambahDurasi(dasar, durasi, satuan);

  const dokumen = bersihkanUndefined({
    username: username.trim(),
    paketId: lama.paketId ?? 'bulanan',
    masaMulai: lama.masaMulai ?? sekarang.toISOString(),
    masaAkhir: masaAkhirBaru.toISOString(),
    gratis: lama.gratis ?? false,
    alasanGratis: lama.alasanGratis,
    // ⚠️ `totalBayar` dan `jumlahBayar` **tidak** dinaikkan. Perpanjangan
    //    manual bukan pembayaran; kalau angka ini naik, rekap keuangan
    //    menunjukkan uang yang tidak pernah masuk.
    totalBayar: lama.totalBayar ?? 0,
    jumlahBayar: lama.jumlahBayar ?? 0,
    pembayaranTerakhir: lama.pembayaranTerakhir,
    createdAt: lama.createdAt ?? sekarang.toISOString(),
    updatedAt: sekarang.toISOString(),
  });

  await ref.set(dokumen, { merge: true });
  return { ok: true, kode: 200, dokumen: dokumen as Record<string, unknown> };
}

/**
 * Setel masa aktif ke waktu tertentu — koreksi admin.
 *
 * `iso` divalidasi dan **di-parse server**. Nilai mentah dari klien tidak
 * pernah disimpan: `masaAkhir` dibaca di banyak tempat, dan string yang tidak
 * bisa di-parse akan membuat `sisaHari()` diam-diam menghasilkan `NaN`.
 */
export async function setMasaAkhirServer(
  _token: AdminToken,
  input: { username: string; iso: string }
): Promise<{ ok: boolean; kode: number; pesan?: string }> {
  if (!(await dindingAdmin(_token)).ok) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  const { username, iso } = input;
  if (!usernameValid(username)) return { ok: false, kode: 400, pesan: 'Username tidak valid.' };

  const waktu = new Date(iso);
  if (!Number.isFinite(waktu.getTime())) {
    return { ok: false, kode: 400, pesan: 'Tanggal tidak valid.' };
  }

  await (await admin())
    .collection(COLL_LANGGANAN)
    .doc(username.trim())
    .set(
      { username: username.trim(), masaAkhir: waktu.toISOString(), updatedAt: new Date().toISOString() },
      { merge: true }
    );
  return { ok: true, kode: 200 };
}

/**
 * Tandai akun sebagai gratis (exempt) atau kembalikan ke normal.
 *
 * ⚠️ `gratis` menang atas `masaAkhir` — jadi ini jalur yang tidak perlu
 * menyentuh tanggal sama sekali untuk membebaskan akun, dan itu disengaja:
 * diskon adalah keputusan admin, bukan keputusan pembayaran.
 *
 * Memindahkan status gratis **tidak pernah** menggeser `masaAkhir`. Kalau
 * iya, membatalkan diskon akan memotong masa aktif yang sudah dibayar.
 */
export async function setGratisServer(
  _token: AdminToken,
  input: { username: string; gratis: boolean; alasan?: string }
): Promise<{ ok: boolean; kode: number; pesan?: string }> {
  if (!(await dindingAdmin(_token)).ok) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  const { username } = input;
  if (!usernameValid(username)) return { ok: false, kode: 400, pesan: 'Username tidak valid.' };

  const gratis = Boolean(input.gratis);
  await (await admin())
    .collection(COLL_LANGGANAN)
    .doc(username.trim())
    .set(
      bersihkanUndefined({
        username: username.trim(),
        gratis,
        alasanGratis: gratis ? input.alasan || 'Ditandai gratis oleh admin' : '',
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }
    );
  return { ok: true, kode: 200 };
}

/*
 * Batas tagihan `menunggu` milik satu akun.
 *
 * Tanpa batas ini, `tagihan:buat` yang terbuka untuk semua akun berubah jadi
 * alat menulis dokumen Firestore yang tidak perlu dibayar: satu klik tombol
 * gagal, satu dokumen baru. Dan dokumen `menunggu` tidak pernah dihapus
 * otomatis — hanya admin yang bisa menghapusnya lewat `hapusTagihanServer`.
 * Biaya baca/tulis langsung naik, dan tagihan lama menumpuk tanpa pernah
 * dibersihkan.
 *
 * Lima masih jauh melebihi kebutuhan nyata: satu orang yang menekan tombol
 * beberapa kali karena koneksi lambat, atau satu orang yang menggeser dari
 * pembayaran manual lalu berubah pikiran.
 *
 * Jadi kembalikan 429 dengan pesan yang bisa ditindaklanjuti, bukan diam-diam
 * menimpa tagihan lama.
 */

/** Batas tagihan `menunggu` per akun. */
const BATAS_TAGIHAN_MENUNGGU = 5;

/** Berapa banyak dokumen tagihan yang dibaca per pengecekan batas. */
const BACA_TAGIHAN_BATAS = 20;

/**
 * Buat dokumen tagihan berstatus `menunggu` — sebelum pembayaran dikirim.
 *
 * ⚠️ Fungsi ini **tidak** memakai `dindingAdmin`.
 *
 * Semula iya, dan akibatnya pengguna biasa tidak bisa membayar: legendanya
 * "Akses khusus admin." muncul tepat di halaman pembayaran yang seharusnya
 * milik orang yang belum membayar. Tagihan adalah dokumen milik pemanggil
 * sendiri, jadi yang dibutuhkan bukan hak admin — hanya sesi yang sah.
 *
 * Tapi membuka pintu ini berarti tiga angka yang tadinya dipercaya dari
 * klien tidak boleh dipercaya lagi. Semuanya sekarang dihitung ulang di
 * sini:
 *
 * - **Akun** diambil dari token, bukan dari `input.username`. Tanpa ini,
 *   siapa pun bisa membuat tagihan atas nama orang lain.
 * - **Harga, durasi, dan satuan** diambil dari konfigurasi paket server,
 *   bukan dari `input`. Tanpa ini, `nominal: 1` di body akan tersimpan
 *   apa adanya — dan `aktifkanLangganan` membaca nominal itu saat menampilkan
 *   ringkasan.
 * - **Paket** dibaca dari `orderId` dengan `paketDariOrderId()`, cara yang sama
 *   dengan `aktifkanLangganan()`. Jadi `paketId` yang diklaim klien hanya
 *   dipakai sebagai pemeriksa: kalau berbeda, ditolak, bukan diabaikan.
 *
 * Pengaktifan tetap aman: `aktifkanLangganan()` memverifikasi Midtrans dan
 * menolak nominal yang tidak sama persis dengan harga paket, jadi tagihan
 * palsuan tidak pernah mengubah masa aktif.
 */
export async function buatTagihanServer(
  token: AdminToken,
  input: {
    orderId: string;
    /** Diabaikan — username selalu dari token. */
    username?: string;
    usernameLabel?: string;
    /** Hanya pemeriksa; yang menentukan paket tetap `orderId`. */
    paketId?: string;
    /** Diabaikan — harga selalu dari konfigurasi server. */
    nominal?: number;
    metode: MetodePembayaran;
    /** Diabaikan — durasi selalu dari konfigurasi server. */
    durasi?: number;
    /** Diabaikan — satuan selalu dari konfigurasi server. */
    satuan?: SatuanDurasi;
  }
): Promise<{ ok: boolean; kode: number; pesan?: string }> {
  const pemanggil = await akunPemanggil(token);
  if (!pemanggil) {
    return {
      ok: false,
      kode: 401,
      pesan: 'Sesi tidak valid atau sudah berakhir. Login ulang lalu coba lagi.',
    };
  }
  const username = pemanggil.username;

  const { orderId } = input;
  if (!orderId || orderId.length > 80 || /[\\/]/.test(orderId)) {
    return { ok: false, kode: 400, pesan: 'orderId tidak valid.' };
  }

  // Paket dari `orderId`, persis seperti saat aktivasi.
  const paket = await bacaPaket();
  const terpilih = paketDariOrderId(orderId, paket);
  if (!terpilih) {
    return {
      ok: false,
      kode: 422,
      pesan: 'Paket pada tagihan tidak dikenal atau sudah tidak dijual. Hubungi administrator.',
    };
  }
  if (input.paketId && input.paketId !== terpilih.id) {
    return {
      ok: false,
      kode: 409,
      pesan: 'Paket yang dipilih tidak lagi sama dengan harga yang berlaku. Muat ulang halaman.',
    };
  }

  // Batas tagihan menunggu milik akun ini.
  const snap = await (await admin())
    .collection(COLL_TAGIHAN)
    .where('username', '==', username)
    .limit(BACA_TAGIHAN_BATAS)
    .get();
  const menunggu = snap.docs.filter(
    doc => String((doc.data() as { status?: string }).status ?? '') === 'menunggu'
  ).length;
  if (menunggu >= BATAS_TAGIHAN_MENUNGGU) {
    return {
      ok: false,
      kode: 429,
      pesan: `Masih ada ${menunggu} tagihan yang belum diselesaikan. Selesaikan atau hapus dulu sebelum membuat tagihan baru.`,
    };
  }

  const label = typeof input.usernameLabel === 'string' ? input.usernameLabel.slice(0, 120) : '';

  await (await admin())
    .collection(COLL_TAGIHAN)
    .doc(orderId)
    .set(
      bersihkanUndefined({
        orderId,
        username,
        usernameLabel: label || username,
        paketId: terpilih.id,
        // Harga dari server, bukan dari klien.
        nominal: Math.round(terpilih.harga),
        metode: input.metode,
        durasi: terpilih.durasi,
        satuan: terpilih.satuan,
        status: 'menunggu',
        createdAt: new Date().toISOString(),
      })
    );
  return { ok: true, kode: 200 };
}

/**
 * Tandai tagihan lunas / batal — **tanpa** menambah masa aktif.
 *
 * ⚠️ Ini hanya mengubah label. Perpanjangan hanya boleh lewat
 * `aktifkanLangganan()` (terverifikasi pembayaran) atau
 * `perpanjangManualServer()` (keputusan admin, tanpa menambah total bayar).
 * Dua-duanya hitung ulang `masaAkhir` sendiri.
 */
export async function setStatusTagihanServer(
  _token: AdminToken,
  input: { orderId: string; status: 'lunas' | 'menunggu' | 'batal'; catatan?: string }
): Promise<{ ok: boolean; kode: number; pesan?: string }> {
  if (!(await dindingAdmin(_token)).ok) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  const { orderId } = input;
  if (!orderId || orderId.length > 80 || /[\\/]/.test(orderId)) {
    return { ok: false, kode: 400, pesan: 'orderId tidak valid.' };
  }
  const status =
    input.status === 'lunas' || input.status === 'batal' ? input.status : 'menunggu';

  await (await admin())
    .collection(COLL_TAGIHAN)
    .doc(orderId)
    .set({ status, catatan: input.catatan ?? '', updatedAt: new Date().toISOString() }, { merge: true });
  return { ok: true, kode: 200 };
}

/** Hapus tagihan — untuk tagihan yang batal atau salah input. */
export async function hapusTagihanServer(
  _token: AdminToken,
  orderId: string
): Promise<{ ok: boolean; kode: number; pesan?: string }> {
  if (!(await dindingAdmin(_token)).ok) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  if (!orderId || orderId.length > 80 || /[\\/]/.test(orderId)) {
    return { ok: false, kode: 400, pesan: 'orderId tidak valid.' };
  }
  await (await admin()).collection(COLL_TAGIHAN).doc(orderId).delete();
  return { ok: true, kode: 200 };
}

// ═══════════════════════════════════════════════════════════════════════
//  Pembacaan untuk peramban
//
//  ⚠️ Kenapa baca-baca ini ada di server, bukan di peramban
//
//  `firestore.rules` punya `allow read: if true` untuk `jatim_langganan` dan
//  `jatim_tagihan` — alasannya "Gerbang Langganan butuh tahu masa aktif".
//  Tapi aplikasi ini **tidak memakai Firebase Authentication**: setiap
//  permintaan dari peramban datang sebagai anonim.
//
//  `allow read: if true` tanpa syarat identitas berarti **siapa pun** yang
//  punya API key bisa membaca **seluruh** koleksi. Dan API key itu bukan
//  rahasia — ia ada di dalam bundle peramban, jadi siapa pun bisa mengambilnya
//  dari DevTools lalu membacanya lewat REST API tanpa membuka aplikasi
//  sama sekali.
//
//  Yang bocor bukan hal sepele:
//
//  - `jatim_langganan` — nama lengkap dan NIP tiap akun, masa aktifnya,
//    dan apakah ditandai gratis oleh admin (yaitu siapa yang belum bayar).
//  - `jatim_tagihan`  — `usernameLabel` (nama orang), `nominal`, `buktiUrl`
//    (tautan bukti transfer), dan catatan admin.
//
//  Membacanya lewat `GET /api/panel-auth` menutupnya: server memverifikasi
//  token, dan untuk `tagihan:saya` nama akun diambil dari **token** —
//  bukan dari body — jadi satu akun tidak bisa membaca tagihan akun lain
//  hanya dengan mengubah `username` di request.
//
//  Sisa aturan di `firestore.rules` menjadi `if false` untuk keduanya.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Dokumen langganan **milik pemanggil sendiri**.
 *
 * Nama akun diambil dari `akunDariToken(token)`, bukan dari `input` — jadi
 * tidak ada parameter yang bisa menunjuk akun lain. Peramban pernah memanggil
 * ini dengan `username` dari context, dan pemanggil yang sama tidak bisa
 * mengarahkan pembacaan ke dokumen orang lain.
 */
export async function bacaLanggananSaya(
  token: AdminToken
): Promise<{ ok: boolean; kode: number; pesan?: string; dokumen?: Record<string, unknown> }> {
  const pemanggil = await akunPemanggil(token);
  if (!pemanggil) return { ok: false, kode: 401, pesan: 'Sesi tidak valid.' };

  const snap = await (await admin())
    .collection(COLL_LANGGANAN)
    .doc(pemanggil.username.trim())
    .get();
  if (!snap.exists) return { ok: true, kode: 200 };

  const data = snap.data() as Record<string, unknown>;
  return {
    ok: true,
    kode: 200,
    dokumen: { ...data, username: pemanggil.username },
  };
}

/**
 * Tagihan milik pemanggil, terbaru dulu.
 *
 * Sama seperti di atas: `username` berasal dari token. `where` + `orderBy`
 * bukan composite index, jadi `where('username', '==', …)` saja — urutan
 * dikerjakan ulang di sini, dan hanya untuk dokumen milik orang yang sedang
 * login, jadi tidak ada kebocoran lewat pola jumlah dokumen.
 */
export async function bacaTagihanSaya(
  token: AdminToken,
  batas = 20
): Promise<{ ok: boolean; kode: number; pesan?: string; tagihan?: Record<string, unknown>[] }> {
  const pemanggil = await akunPemanggil(token);
  if (!pemanggil) return { ok: false, kode: 401, pesan: 'Sesi tidak valid.' };

  const db = await admin();
  const batasAman = Math.min(Math.max(Number(batas) || 20, 1), 200);
  const snap = await db
    .collection(COLL_TAGIHAN)
    .where('username', '==', pemanggil.username)
    .limit(Math.min(batasAman * 3, 200))
    .get();

  const tagihan = snap.docs
    .map(d => d.data() as Record<string, unknown>)
    .sort((a, b) => {
      const selisih = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
      return selisih !== 0 ? selisih : String(b.orderId ?? '').localeCompare(String(a.orderId ?? ''));
    })
    .slice(0, batasAman);

  return { ok: true, kode: 200, tagihan };
}

/**
 * Semua dokumen langganan — **khusus admin**.
 *
 * Dipakai halaman Langganan & Manajemen Akun yang memang menampilkan seluruh
 * daftar. Tapi hanya admin yang boleh: tanpa itu, `allow read: if true` yang
 * lama berarti data langganan **seluruh** pengguna terbuka untuk siapa pun
 * yang punya API key, bukan cuma untuk admin yang sedang login.
 *
 * Dibatasi `limit(500)` supaya satu akun dengan ribuan dokumen tidak membuat
 * satu respons yang sangat besar.
 */
export async function bacaSemuaLangganan(
  token: AdminToken
): Promise<{ ok: boolean; kode: number; pesan?: string; daftar?: Record<string, unknown>[] }> {
  if (!(await dindingAdmin(token)).ok) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }
  const snap = await (await admin()).collection(COLL_LANGGANAN).limit(500).get();
  return {
    ok: true,
    kode: 200,
    daftar: snap.docs.map(d => ({ ...(d.data() as Record<string, unknown>), username: d.id })),
  };
}

/**
 * Semua tagihan — **khusus admin**, untuk rekap di halaman Langganan.
 *
 * `buktiUrl` ikut di sini karena admin memang membukanya untuk memeriksa
 * mutasi rekening. Akun biasa tidak pernah menerima field ini lewat
 * `bacaTagihanSaya`, dan `buktiUrl` miliknya sendiri pun tetap theirs.
 */
export async function bacaSemuaTagihan(
  token: AdminToken
): Promise<{ ok: boolean; kode: number; pesan?: string; tagihan?: Record<string, unknown>[] }> {
  if (!(await dindingAdmin(token)).ok) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }
  const snap = await (await admin()).collection(COLL_TAGIHAN).limit(200).get();
  const tagihan = snap.docs
    .map(d => d.data() as Record<string, unknown>)
    .sort((a, b) => {
      const selisih = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
      return selisih !== 0 ? selisih : String(b.orderId ?? '').localeCompare(String(a.orderId ?? ''));
    });
  return { ok: true, kode: 200, tagihan };
}

/**
 * Pengaturan billing untuk semua orang, termasuk yang belum login.
 *
 * Satu-satunya koleksi yang tetap boleh dibaca peramban: isinya paket,
 * rekening, QRIS, dan nomor WA — bukan rahasia, dan memang harus tampil
 * sebelum pengguna masuk. `firestore.rules` membiarkan `jatim_pengaturan/billing`
 * terbuka untuk baca; fungsi ini hanya membatasi **bentuk** yang dikirim,
 * supaya field baru yang tidak sengaja ditambahkan tidak ikut terbawa.
 */
export async function bacaPengaturanBilling(
  token: AdminToken
): Promise<{ ok: boolean; kode: number; pesan?: string; nilai?: Record<string, unknown> }> {
  // Token di sini hanya untuk memastikan pemanggil memang punya sesi — bukan
  // untuk membatasi data, karena isinya memang publik.
  const pemanggil = await akunPemanggil(token);
  if (!pemanggil) return { ok: false, kode: 401, pesan: 'Sesi tidak valid.' };

  const snap = await (await admin()).collection(COLL_PENGATURAN).doc('billing').get();
  if (!snap.exists) return { ok: true, kode: 200, nilai: { paket: normalisasiDaftarPaket(undefined) } };

  const data = snap.data() as Record<string, unknown>;
  return {
    ok: true,
    kode: 200,
    nilai: {
      // Hanya field yang di layar yang dikirim. Daftar ini eksplisit supaya
      // field baru di dokumen tidak ikut bocor tanpa disadari.
      namaMerchant: String(data.namaMerchant ?? ''),
      qrisStatis: String(data.qrisStatis ?? ''),
      rekening: Array.isArray(data.rekening) ? data.rekening : [],
      paket: normalisasiDaftarPaket(data.paket as never),
      metodeAktif: Array.isArray(data.metodeAktif) ? data.metodeAktif : [],
      nomorWa: String(data.nomorWa ?? ''),
      templateWa: String(data.templateWa ?? ''),
    },
  };
}

/**
 * Simpan pengaturan billing (paket, QRIS, rekening, nomor WA).
 *
 * ⚠️ Ini mengizinkan admin **mengubah harga paket** — dan itulah risikonya,
 * bukan bentuk request-nya. Batasannya ada di luar fungsi ini: harga yang
 * benar-benar dieksekusi tetap dihitung `aktifkanLangganan()` dari
 * konfigurasi server, dan nilainya divalidasi terhadap harga yang benar-benar
 * dibayar di Midtrans.
 *
 * Jadi mengubah harga di sini hanya mengubah **tampilan** — dan justru itu
 * yang perlu diperhatikan: kalau harga yang tampil berbeda dari harga yang
 * ditagih, pengguna akan membayar jumlah yang tidak terduga.
 */
export async function simpanBillingServer(
  _token: AdminToken,
  nilai: Record<string, unknown>
): Promise<{ ok: boolean; kode: number; pesan?: string }> {
  if (!(await dindingAdmin(_token)).ok) {
    return { ok: false, kode: 403, pesan: 'Akses khusus admin.' };
  }

  /*
   * ⚠️ Hanya field yang di layar-layar yang ditulis, dan `paket` memakai
   * hasil normalisasi — bukan objek mentah dari body.
   *
   * Dulu baris tulisnya `{ ...nilai }`: seluruh body diteruskan apa adanya ke
   * dokumen `jatim_pengaturan/billing`. Dua masalah sekaligus:
   *
   * 1. **Mass assignment.** Field apa pun yang tidak sengaja ikut —
   *    `createdAt`, `internal`, atau apa pun yang ditambahkan klien —
   *    tersimpan permanen di dokumen yang dibaca semua orang.
   * 2. **Validasi yang dihitung lalu dibuang.** `normalisasiDaftarPaket()` dan
   *    cek harga di bawahnya tetap berjalan, tapi hasilnya tidak pernah
   *    dipakai untuk menulis — yang ditulis tetap `nilai.paket` mentah. Jadi
   *    paket dengan `harga: -5` lolos ke dokumen padahal server sudah
   *    menghitungnya tidak valid. Pemeriksaan yang tidak memengaruhi hasilnya
   *    lebih buruk daripada tidak ada, karena ia terlihat sudah aman.
   */
  const paket = normalisasiDaftarPaket(nilai.paket);
  if (paket.length === 0) {
    return { ok: false, kode: 400, pesan: 'Minimal satu paket harus ada.' };
  }
  for (const item of paket) {
    if (!Number.isFinite(item.harga) || item.harga <= 0) {
      return { ok: false, kode: 400, pesan: `Harga paket "${item.id}" tidak valid.` };
    }
  }
  const daftarRekening = Array.isArray(nilai.rekening) ? nilai.rekening : [];
  const metodeAktif = Array.isArray(nilai.metodeAktif)
    ? nilai.metodeAktif.filter(item => typeof item === 'string')
    : [];

  await (await admin())
    .collection(COLL_PENGATURAN)
    .doc(DOC_BILLING)
    .set(
      bersihkanUndefined({
        namaMerchant: String(nilai.namaMerchant ?? ''),
        qrisStatis: String(nilai.qrisStatis ?? ''),
        rekening: daftarRekening,
        paket,
        metodeAktif,
        nomorWa: String(nilai.nomorWa ?? ''),
        templateWa: String(nilai.templateWa ?? ''),
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }
    );
  return { ok: true, kode: 200 };
}

// ═══════════════════════════════════════════════════════════════════════
//  Aktivasi
// ═══════════════════════════════════════════════════════════════════════

export interface PermintaanAktivasi {
  orderId: string;
  metode: MetodePembayaran;
  /**
   * Dikirim klien hanya untuk dicocokkan; tidak pernah dipercaya.
   *
   * ⚠️ Tidak ada `username` di sini, dan itu disengaja. Dulu field itu ada
   * dan dibaca dari body request — sehingga `POST /api/billing/aktivasi`
   * bisa dipanggil **tanpa token sama sekali** untuk mengaktifkan langganan
   * akun siapa pun. Nama akun sekarang hanya boleh datang dari token.
   */
  nominalKlien?: number;
}

/**
 * Perpanjang masa aktif — jalur tunggal untuk mengaktifkan langganan.
 *
 * ⚠️ `token` wajib, dan **nama akun dibaca dari token** — bukan dari
 * permintaan. Ini satu-satunya penjaga endpoint aktivasi: peramban hanya
 * menampilkan gerbang langganan **setelah** berhasil login panel, jadi
 * setiap pemanggil yang sah sudah memegang token. Tanpa token, tidak ada
 * alasan endpoint ini boleh mengaktifkan apa pun.
 *
 * Kenapa ini bukan formalitas semata: jalur `qris` dan `transfer` tidak bisa
 * diverifikasi ke bank (lihat catatan panjang di `lib/aktivasiLangganan.ts`),
 * jadi bagi keduanya "sudah membayar" adalah klaim, bukan bukti. Kalau nama
 * akun boleh datang dari body, klaim itu tidak lagi milik siapa pun — siapa
 * pun bisa menulis langganan aktif untuk akun mana pun. Yang belum
 * dibayar sudah bisa aktif.
 *
 * Idempoten terhadap `orderId`: tagihan yang sudah pernah dicatat tidak
 * menambah masa aktif lagi. Ini penting karena verifikasi Midtrans bisa
 * dipanggil berulang, dan karena pengguna bisa menekan tombol beberapa kali.
 */
export async function aktifkanLangganan(
  token: AdminToken,
  permintaan: PermintaanAktivasi
): Promise<HasilAktivasi> {
  const { orderId, metode } = permintaan;

  const pemanggil = await akunPemanggil(token);
  if (!pemanggil) {
    return {
      ok: false,
      kode: 401,
      pesan: 'Sesi tidak valid atau sudah berakhir. Login ulang lalu coba lagi.',
    };
  }
  const username = pemanggil.username;

  if (!orderId) {
    return { ok: false, pesan: 'orderId wajib diisi.', kode: 400 };
  }
  // `orderId` masuk ke path dokumen Firestore — pola yang sama seperti
  // username, untuk mencegah ../ style traversal membentuk dokumen lain.
  if (/[\\/]/.test(orderId) || /[\\/]/.test(username) || orderId.length > 80 || username.length > 64) {
    return { ok: false, pesan: 'orderId atau username tidak valid.', kode: 400 };
  }

  const db = await admin();
  const refLangganan = db.collection(COLL_LANGGANAN).doc(username);
  const refTagihan = db.collection(COLL_TAGIHAN).doc(orderId);

  /*
   * 1. Jalur cepat: tagihan ini sudah pernah diproses?
   *
   * Ini hanya penghematan bandwidth — dengan begini kita tidak perlu
   * memanggil API Midtrans lagi untuk tagihan yang sudah lunas.
   *
   * ⚠️ Ini **bukan** yang menjamin idempotensi. Pemeriksaan yang menentukan
   * ada atau tidaknya perpanjangan ada di dalam transaksi (langkah 4),
   * karena pemeriksaan di sini bisa dilewati dua permintaan yang berjalan
   * bersamaan: keduanya melihat dokumen yang belum ada.
   */
  const tagihanAda = await refTagihan.get();
  if (tagihanAda.exists) {
    const lama = tagihanAda.data() as any;
    if (lama?.masaAkhirSetelah) {
      return {
        ok: true,
        masaAkhir: String(lama.masaAkhirSetelah),
        nominal: Number(lama.nominal ?? 0) || undefined,
        durasi: Number(lama.durasi ?? 0) || undefined,
        sumber: (lama.sumber as SumberAktivasi) ?? 'manual',
      };
    }
  }

  // 2. Harga & durasi SELALU dari konfigurasi server.
  const paket = await bacaPaket();
  const paketTerpilih = paketDariOrderId(orderId, paket);
  if (!paketTerpilih) {
    return {
      ok: false,
      pesan: 'Paket pada tagihan tidak dikenal atau sudah tidak dijual. Hubungi administrator.',
      kode: 422,
    };
  }

  // 3. Untuk Midtrans, verifikasi ke API. `manual` tidak bisa diverifikasi
  //    dari server (tidak ada API bank) — dicatat apa adanya.
  let sumber: SumberAktivasi = 'manual';
  let waktuBayar = new Date().toISOString();

  if (metode === 'qris_midtrans') {
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    if (!serverKey) {
      return { ok: false, pesan: 'Server belum dikonfigurasi untuk Midtrans.', kode: 500 };
    }
    const hasil = await verifikasiMidtrans(orderId, {
      serverKey,
      produksi: midtransProduksi(),
    });
    if (!hasil.ok) {
      return { ok: false, pesan: hasil.pesan, kode: 402, statusTransaksi: hasil.status };
    }
    // Nominal dari Midtrans harus sama persis dengan harga paket. Tanpa
    // ini, orang bisa membuat transaksi Rp 1 lalu mengaktifkan paket tahunan.
    // ⚠️ Tanpa `!== undefined` di sini. `verifikasiMidtrans` sudah
    // menjamin `nominal` berupa angka > 0 pada jalur sukses, jadi `undefined`
    // di sini berarti ada bug, bukan "nominal tidak dikirim" — dan nominal
    // yang tidak diketahui tidak boleh diperlakukan sebagai cocok.
    if (hasil.nominal !== paketTerpilih.harga) {
      return {
        ok: false,
        pesan: `Nominal tidak cocok: dibayar ${hasil.nominal}, paket apa adanya ${paketTerpilih.harga}.`,
        kode: 409,
      };
    }
    sumber = 'midtrans';
    if (hasil.waktuBayar) waktuBayar = hasil.waktuBayar;
  } else if (permintaan.nominalKlien !== undefined && permintaan.nominalKlien !== paketTerpilih.harga) {
    // Klien boleh mengirim nominal, tapi kalau berbeda dari harga paket,
    // itu berarti form sudah dimanipulasi. Midtrans sudah divalidasi di atas;
    // untuk manual, paling tidak jangan diam-diam diterima.
    return {
      ok: false,
      pesan: 'Nominal tidak sesuai harga paket. Muat ulang halaman.',
      kode: 409,
    };
  }

  /*
   * 4. Tulis — dalam **transaksi Firestore**, bukan `batch`.
   *
   * Kenapa bukan `batch`: `masaAkhir` dihitung dari dokumen langganan yang
   * dibaca, lalu dokumen itu ditulis balik. Dengan `batch`, pembacaan dan
   * penulisan itu tidak terikat — di antara keduanya ada dua pembulatan
   * jaringan (`bacaPaket()`, `verifikasiMidtrans()`), jadi jendela race-nya
   * bukan milidetik, tapi **ratusan milidetik sampai beberapa detik**.
   *
   * Yang terjadi di jendela itu: pengguna membayar dua bulan dalam dua
   * tagihan berdekatan. Kedua permintaan membaca `masaAkhir` yang sama,
   * menghitung tanggal akhir yang sama dari dasar yang sama, lalu menimpanya.
   * `batch.set(..., { merge: true })` tidak penjumlahan — hasil akhirnya
   * **satu bulan, padahal dua bulan sudah dibayar**. Uang hilang tanpa
   * jejak: `jatim_tagihan` mencatat dua tagihan lunas, `jatim_langganan`
   * hanya bertambah satu.
   *
   * `runTransaction` mengunci dokumen yang dibaca, dan Firestore
   * mengulang seluruh callback dari awal kalau ada konflik — jadi request
   * kedua menghitung ulang dari state yang sudah diperbarui, dan
   * idempotensi tagihan dijamin, bukan kebetulan.
   *
   * Verifikasi Midtrans dan pembacaan paket sengaja **di luar** transaksi:
   * transaksi punya batas durasi dan retry sendiri, sedangkan panggilan
   * jaringan ke luar tidak boleh ikut diulang-ulang.
   */
  const sekarang = new Date(waktuBayar);

  return db.runTransaction(async (tx: TransactionDyn) => {
    // Semua pembacaan dulu, semua penulisan sesudahnya — Firestore
    // menolak transaksi yang menulis sebelum membaca.
    const snapTagihan = await tx.get(refTagihan);
    const snapLangganan = await tx.get(refLangganan);

    // Sudah pernah diproses? Kembalikan hasil yang sama persis, jangan
    // menambah masa aktif lagi. Di dalam transaksi, pemeriksaan ini
    // tidak bisa dilewati oleh request lain yang berjalan bersamaan.
    if (snapTagihan.exists) {
      const tagihanLama = snapTagihan.data() as any;
      if (tagihanLama?.masaAkhirSetelah) {
        return {
          ok: true as const,
          masaAkhir: String(tagihanLama.masaAkhirSetelah),
          nominal: Number(tagihanLama.nominal ?? 0) || undefined,
          durasi: Number(tagihanLama.durasi ?? 0) || undefined,
          sumber: (tagihanLama.sumber as SumberAktivasi) ?? 'manual',
        };
      }
    }

    const lama = snapLangganan.data() as any;
    const masaAkhirLama = typeof lama?.masaAkhir === 'string' ? lama.masaAkhir : '';
    const masihAktif = Boolean(masaAkhirLama) && masaAkhirLama > sekarang.toISOString();
    const dasar = masihAktif ? new Date(masaAkhirLama) : sekarang;
    // Perpanjangan memakai **kalender**, bukan jumlah hari: satu bulan dari
    // tanggal 31 berakhir di akhir bulan berikutnya, bukan 30 hari kemudian.
    const masaAkhirBaru = tambahDurasi(dasar, paketTerpilih.durasi, paketTerpilih.satuan).toISOString();
    const masaMulaiBaru = masihAktif ? lama.masaMulai : sekarang.toISOString();

    tx.set(
      refLangganan,
      // ⚠️ WAJIB `bersihkanUndefined`. `lama?.alasanGratis` menghasilkan
      // `undefined` untuk akun yang belum pernah ditandai gratis, dan
      // Firestore menolak `undefined` outright — bukan mengabaikannya.
      // Gejalanya: "Function setDoc() called with invalid data. Unsupported
      // field value: undefined (found in field alasanGratis)".
      bersihkanUndefined({
        username,
        paketId: paketTerpilih.id,
        masaMulai: masaMulaiBaru,
        masaAkhir: masaAkhirBaru,
        gratis: lama?.gratis ?? false,
        alasanGratis: lama?.alasanGratis,
        totalBayar: (Number(lama?.totalBayar ?? 0) || 0) + paketTerpilih.harga,
        jumlahBayar: (Number(lama?.jumlahBayar ?? 0) || 0) + 1,
        pembayaranTerakhir: {
          orderId,
          nominal: paketTerpilih.harga,
          metode,
          sumber,
          waktu: waktuBayar,
        },
        createdAt: lama?.createdAt ?? sekarang.toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }
    );
    tx.set(
      refTagihan,
      bersihkanUndefined({
        orderId,
        username,
        usernameLabel: lama?.username ?? username,
        paketId: paketTerpilih.id,
        nominal: paketTerpilih.harga,
        metode,
        sumber,
        durasi: paketTerpilih.durasi,
        satuan: paketTerpilih.satuan,
        status: 'lunas',
        catatan: '',
        buktiUrl: '',
        waktuBayar,
        masaAkhirSetelah: masaAkhirBaru,
        createdAt: snapTagihan.exists ? (snapTagihan.data() as any)?.createdAt : new Date().toISOString(),
      }),
      { merge: true }
    );

    return {
      ok: true as const,
      masaAkhir: masaAkhirBaru,
      masaMulai: masaMulaiBaru,
      nominal: paketTerpilih.harga,
      durasi: paketTerpilih.durasi,
      satuan: paketTerpilih.satuan,
      sumber,
    };
  });
}
