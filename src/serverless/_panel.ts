/**
 * `POST /api/panel-auth` — satu-satunya pintu masuk untuk semua operasi
 * autentikasi & otorisasi panel.
 *
 * ## Kenapa satu endpoint, bukan satu per operasi
 *
 * Semuanya berbagi tiga hal yang tidak boleh diduplikasi: allow-list origin,
 * pembacaan body, dan **pemeriksaan token**. Kalau `daftar akun` punya route
 * sendiri sementara `hapus akun` punya route lain, cepat atau lambat salah satu
 * akan lupa memeriksa token — dan route yang lupa itu langsung jadi jalan
 * masuk. Satu handler dengan `aksi` di body membuat "wajib cek token" jadi
 * satu facts yang berlaku seragam.
 *
 * ## Yang DILARANG di sini
 *
 * - Peran **tidak pernah** diambil dari body atau query. Selalu dari
 *   `verifikasiToken()` yang membaca dokumen.
 * - `token` hanya diterima lewat header `Authorization: Bearer …` atau body.
 *   Tidak ada query string — URL masuk log server dan `Referer`.
 * - Tidak ada aksi yang menulis dokumen tanpa token admin kecuali `masuk`.
 *
 * Bentuk respons selalu `{ ok, kode?, pesan?, ... }` dengan kode HTTP yang
 * sesuai, jadi klien tidak perlu menebak artinya.
 */

import {
  masukPanel,
  autoLoginPusat,
  verifikasiToken,
  daftarAkun,
  buatAkun,
  ubahAkun,
  hapusAkun,
  simpanKredensial,
  ringkasKredensial,
  ringkasSemuaKredensial,
  hapusKredensial,
  ubahAdminBawaan,
  gantiPasswordSendiri,
  ringkasanPanelAuth,
} from '../lib/panelServer';
import type { TabPermissions, UserRole } from '../lib/userManager';
import { KONTRAK_VERSI } from '../lib/kontrakServer';
/*
 * CORS **dipakai langsung** dari `_cors.ts`, tanpa fungsi pembungkus sendiri.
 *
 * `_panel.ts` pernah punya allow-list kedua yang disalin dari `_cors.ts`, dan
 * salinan itu sudah menyimpang di bagian yang paling berbahaya:
 *
 * - menguji `ALLOWED_ORIGINS?.includes('*')` — itu pencarian **substring**.
 *   Satu entri pun yang memuat `*`, termasuk pola yang wajar untuk preview
 *   deployment, akan mematikan seluruh allow-list di endpoint yang mengunci
 *   setiap operasi peran dan kredensial. `_cors.ts` menguji
 *   `daftar.includes('*')`: hanya entri yang benar-benar `*`.
 * - melengkapi skema tanpa perlakuan khusus untuk `localhost`, sehingga
 *   `ALLOWED_ORIGINS=localhost:5173` menjadi `https://localhost:5173` dan
 *   tidak pernah cocok dengan `Origin: http://localhost:5173` — 403 di
 *   setiap panggilan panel saat pengembangan.
 *
 * Setelah duplikatnya dihapus, `terapkanCors` diimpor apa adanya. Tidak ada
 * lagi lapisan antara; kalau bentuk parameternya berubah, pemanggilnya ikut
 * gagal saat `tsc`, bukan diam-diam.
 *
 * `_cors.ts` tidak mengimpor apa pun, jadi mengimpornya di sini tidak menarik
 * dependensi baru ke `api/panel-auth.js`.
 */
import { terapkanCors } from './_cors';

/** Bentuk minimum yang dibutuhkan agar CORS & body bisa ditangani. */
export interface PermintaanHttp {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export interface BalasanHttp {
  status(kode: number): BalasanHttp;
  json(data: unknown): unknown;
  setHeader(nama: string, nilai: string): void;
  end(): unknown;
}

/** Header yang dibaca. Nama dinormalkan huruf kecil supaya tidak rapuh. */
type HeaderMap = Record<string, string>;

/** Batas panjang body sebelum di-parse — cukup untuk form yang realistis. */
const MAX_BODY_CHARS = 64 * 1024;

function header(req: PermintaanHttp, nama: string): string {
  const map = req.headers as HeaderMap;
  const kunci = nama.toLowerCase();
  const nilai = map[kunci] ?? map[kunci.toUpperCase()];
  if (Array.isArray(nilai)) return nilai[0] ?? '';
  return typeof nilai === 'string' ? nilai : '';
}

/**
 * Ambil token dari `Authorization: Bearer …`, lalu dari body.
 *
 * Body dipertahankan supaya skrip uji (dan `curl`) bisa memanggilnya tanpa
 * harus menyetel header — bukan karena token layak ada di sana.
 */
/**
 * Muat `serverBilling` saat dibutuhkan.
 *
 * Impor dinamis supaya `firebase-admin` tidak ikut terbaca saat server dinyalakan
 * — sama alasan dan pola seperti route `/api/billing/aktivasi` di
 * `src/api/server.ts`.
 */
async function muatBilling() {
  return import('../lib/serverBilling');
}


function bacaToken(req: PermintaanHttp, body: Record<string, unknown>): string {
  const auth = header(req, 'authorization').trim();
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  const dariBody = body.token;
  return typeof dariBody === 'string' ? dariBody.trim() : '';
}

/**
 * IP pemanggil, untuk pembatas percobaan login.
 *
 * ⚠️ Urutannya penting: `req.ip` **dulu**, baru `X-Forwarded-For`.
 *
 * `X-Forwarded-For` adalah header yang diisi *proxy*, dan hanya bisa dipercaya
 * kalau request-nya memang lewat proxy. Mengambilnya duluan berarti setiap
 * klien yang tahu endpoint ini bisa menulis header itu sendiri — dan karena
 * satu IP palsu bisa membuat penghitung percobaan selalu mulai dari nol,
 * pembatas login kehilangan seluruh artinya: batas 8 percobaan per akun bisa
 * ditekan ulang tak terbatas hanya dengan mengganti header.
 *
 * `req.ip` diisi platform, dan `server.ts` menyalakan `trust proxy`
 * supaya Express menghitungnya dari rantai proxy yang benar. Selain itu,
 * `X-Forwarded-For` tetap dibaca sebagai cadangan — lebih baik IP proxy
 * terbaca daripada semua orang dianggap satu IP.
 */
function ipPemanggil(req: PermintaanHttp): string {
  return (
    req.ip ||
    header(req, 'x-forwarded-for').split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'tak-diketahui'
  );
}

/**
 * Bentuk body yang aman dibaca: objek biasa, atau `{}` kalau tidak.
 *
 * ⚠️ Pemeriksaan ukuran berlaku untuk **kedua** bentuk body.
 *
 * Semula `MAX_BODY_CHARS` hanya dicek di cabang `typeof mentah === 'string'`.
 * Cabang itu praktis tidak pernah jalan di produksi: runtime Vercel sudah
 * mem-parse `application/json` sebelum handler dipanggil, jadi body-nya objek
 * dan batasnya tidak pernah dibaca. Yang dibatasi tanpa sengaja adalah jalur
 * yang tidak dipakai, sementara jalur yang dipakai — objek dari klien mana pun
 * — lolos tanpa batas apa pun.
 *
 * `Content-Length` diperiksa lebih dulu karena itu klaim peminta dan biayanya
 * nol. Kalau diklaim kecil tapi body-nya ternyata besar (permintaan yang tidak
 * mengirim header itu, atau yang berbohong), objeknya baru diukur ulang lewat
 * `JSON.stringify` — sekali, setelah parsing, jadi tidak menambah parse kedua.
 */
function bacaBody(req: PermintaanHttp): Record<string, unknown> {
  const panjangDiklaim = Number.parseInt(header(req, 'content-length'), 10);
  if (Number.isFinite(panjangDiklaim) && panjangDiklaim > MAX_BODY_CHARS) return {};

  const mentah = req.body;
  if (typeof mentah === 'string') {
    if (mentah.length > MAX_BODY_CHARS) return {};
    try {
      const parsed = JSON.parse(mentah);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (!mentah || typeof mentah !== 'object') return {};
  try {
    if (JSON.stringify(mentah).length > MAX_BODY_CHARS) return {};
  } catch {
    return {};
  }
  return mentah as Record<string, unknown>;
}

const str = (nilai: unknown): string => (typeof nilai === 'string' ? nilai : '');
const bool = (nilai: unknown): boolean => nilai === true;

/**
 * Tangani satu request.
 *
 * Dipakai Express (`src/api/server.ts`) dan Vercel (`api/panel-auth.js`) tanpa
 * perubahan — supaya keduanya tidak bisa berbeda perilaku, persis seperti
 * yang dilakukan `/api/rpc`.
 */
export async function tanganiPanelAuth(
  req: PermintaanHttp,
  res: BalasanHttp
): Promise<unknown> {
  /*
   * Setiap respons — termasuk 403 CORS, 405, dan 503 konfigurasi — dikunci
   * dengan `kontrakVersi`.
   *
   * Kenapa dibungkus di sini, bukan ditambahkan satu per satu di tiap
   * `res.json()`: ada puluhan jalur keluar (setiap `case`, plus tiga exit
   * awal), dan jalur yang **terlupa** justru yang paling berbahaya — versi
   * yang tidak dikirim pada respons 503 membuat peramban menganggap servernya
   * versi lama saat masalahnya sebenarnya env yang belum diisi.
   *
   * `res.json` dibungkus sekali di awal, jadi tidak ada jalan keluar yang
   * bisa melewatinya.
   *
   * ⚠️ `kontrakVersi` ditulis **setelah** spread-nya, bukan sebelumnya — itu
   * satu-satunya urutan yang benar di sini. Kalau muncul sebelum, maka
   * `badan.kontrakVersi` dari kode server bisa menimpanya, dan peramban akan
   * percaya angka yang bukan miliknya. Nilai server harus menang apa pun isi
   * badannya.
   *
   * Kurung di sekitar spread bukan gaya penulisan: `...a && b ? c : d`
   * dibaca sebagai `...((a && b) ? c : d)`, dan itu memang yang diinginkan —
   * tapi menuliskannya tanpa kurung membuat maksudnya mustahil dibaca.
   */
  const jsonAsli = res.json.bind(res);
  res.json = (badan: unknown) =>
    jsonAsli({
      ...(badan && typeof badan === 'object' ? badan : {}),
      kontrakVersi: KONTRAK_VERSI,
    });

  if (!terapkanCors(res, header(req, 'origin'))) {
    return res.status(403).json({
      ok: false,
      kode: 403,
      pesan:
        'Origin tidak diizinkan. Isi ALLOWED_ORIGINS di dashboard Vercel dengan domain aplikasi, ' +
        'pisah koma kalau lebih dari satu.',
    });
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, kode: 405, pesan: 'Method tidak diizinkan.' });
  }

  /*
   * Pemeriksaan konfigurasi dilakukan **sebelum** apa pun yang mahal, dan
   * pesannya menyebut perbaikannya.
   *
   * Tanpa ini, `PANEL_SESSION_SECRET` yang lupa diisi muncul sebagai 401
   * "kredensial salah" — bentuk yang sama persis dengan typosi password, dan
   * tidak ada yang menyuruh operator melihat env. Itu kegagalan yang pernah
   * terjadi berulang kali di proyek ini (`ALLOWED_ORIGINS` kosong → semua
   * request 403 tanpa penjelasan).
   */
  const konfigurasi = ringkasanPanelAuth();
  if (!konfigurasi.siap) {
    const belum: string[] = [];
    if (!konfigurasi.secretAda) belum.push('PANEL_SESSION_SECRET belum diisi');
    else if (!konfigurasi.secretCukupPanjang) {
      belum.push('PANEL_SESSION_SECRET harus minimal 32 karakter');
    }
    belum.push(
      'Kredensial Firebase Admin belum diisi (FIREBASE_SERVICE_ACCOUNT / GOOGLE_APPLICATION_CREDENTIALS)'
    );
    return res.status(503).json({
      ok: false,
      kode: 503,
      pesan: `Server belum siap untuk autentikasi panel: ${belum.join('; ')}.`,
    });
  }

  const body = bacaBody(req);
  const aksi = str(body.aksi) || header(req, 'x-panel-aksi');
  const token = bacaToken(req, body);

  try {
    switch (aksi) {
      // ── Login ────────────────────────────────────────────────────────
      case 'masuk': {
        const hasil = await masukPanel(str(body.username), str(body.password), {
          ip: ipPemanggil(req),
        });
        return res.status(hasil.kode).json({
          ok: hasil.ok,
          kode: hasil.kode,
          pesan: hasil.pesan,
          terkunci: hasil.terkunci,
          token: hasil.token,
          akun: hasil.akun,
        });
      }

      // ── Verifikasi sesi ──────────────────────────────────────────────
      /*
       * `perbarui: true` meminta token baru kalau umurnya hampir habis. Sisi
       * server tetap yang memutuskan — klien tidak bisa meminta token dengan
       * umur lebih panjang hanya dengan mengubah field ini.
       */
      case 'verifikasi': {
        const hasil = await verifikasiToken(token, { perbarui: bool(body.perbarui) });
        return res.status(hasil.kode).json({
          ok: hasil.ok,
          kode: hasil.kode,
          pesan: hasil.pesan,
          token: hasil.token,
          akun: hasil.akun,
        });
      }

      // ── Kelola akun (selalu butuh admin) ─────────────────────────────
      case 'akun:daftar': {
        const hasil = await daftarAkun(token);
        return res.status(hasil.kode).json(hasil);
      }
      case 'akun:buat': {
        const hasil = await buatAkun(token, {
          username: str(body.username),
          password: str(body.password),
          role: (str(body.role) === 'admin' ? 'admin' : 'user') as UserRole,
          permissions: body.permissions as Partial<TabPermissions> | undefined,
          namaLengkap: str(body.namaLengkap),
          nip: str(body.nip),
          catatan: str(body.catatan),
        });
        return res.status(hasil.kode).json(hasil);
      }
      case 'akun:ubah': {
        const hasil = await ubahAkun(token, str(body.username), {
          usernameBaru: body.usernameBaru === undefined ? undefined : str(body.usernameBaru),
          password: str(body.password) || undefined,
          role: body.role === 'admin' || body.role === 'user' ? (body.role as UserRole) : undefined,
          permissions: body.permissions as Partial<TabPermissions> | undefined,
          namaLengkap: body.namaLengkap === undefined ? undefined : str(body.namaLengkap),
          nip: body.nip === undefined ? undefined : str(body.nip),
          catatan: body.catatan === undefined ? undefined : str(body.catatan),
          nonaktif: body.nonaktif === undefined ? undefined : bool(body.nonaktif),
        });
        return res.status(hasil.kode).json(hasil);
      }
      case 'akun:hapus': {
        const hasil = await hapusAkun(token, str(body.username));
        return res.status(hasil.kode).json(hasil);
      }

      // ── Kredensial server pusat (hanya akun sendiri) ────────────────
      case 'kredensial:simpan': {
        const hasil = await simpanKredensial(token, {
          username: str(body.username),
          nip: str(body.nip),
          password: str(body.password),
          imei: str(body.imei),
        });
        return res.status(hasil.kode).json(hasil);
      }
      case 'kredensial:ringkas': {
        const hasil = await ringkasKredensial(token, str(body.username));
        return res.status(hasil.kode).json(hasil);
      }
      /*
       * Bentuk batch dari aksi di atas — **khusus admin**.
       *
       * Tanpa ini, halaman Manajemen Akun memanggil `kredensial:ringkas`
       * satu kali per akun: 40 akun = 40 request, dan tiap request
       * memverifikasi token lewat satu pembacaan Firestore. Yang sama
       * diulang 40 kali, sementara yang benar-benar berbeda hanya nama
       * dokumen.
       *
       * Di sini jadi satu request, satu verifikasi, dan satu batch read.
       */
      case 'kredensial:ringkas-semua': {
        const hasil = await ringkasSemuaKredensial(token);
        return res.status(hasil.kode).json(hasil);
      }
      case 'kredensial:hapus': {
        const hasil = await hapusKredensial(token, str(body.username));
        return res.status(hasil.kode).json(hasil);
      }

      // ── Auto-login ke server pusat ──────────────────────────────────
      /*
       * Peramban hanya menyebut akun mana; server yang mendekripsi kredensial
       * dan memanggil gateway. Password server pusat karena itu tidak pernah
       * melewati jaringan menuju peramban — lihat catatan panjang di
       * `autoLoginPusat()`.
       */
      case 'pusat:login': {
        const hasil = await autoLoginPusat(token, str(body.username), { imei: str(body.imei) });
        return res.status(hasil.ok ? 200 : hasil.kode).json(hasil);
      }

      // ── Baca langganan & tagihan (pemanggil sendiri) ───────────────
      /*
       * Ketiga aksi ini menggantikan pembacaan langsung dari peramban.
       *
       * Semula `firestore.rules` membiarkan `jatim_langganan` dan
       * `jatim_tagihan` dengan `allow read: if true`, karena aplikasi ini
       * tidak memakai Firebase Auth dan rules tidak punya identitas untuk
       * diperiksa. Akibatnya **seluruh** koleksi terbuka: API key-nya ada di
       * bundle peramban, jadi siapa pun bisa membacanya lewat REST API dan
       * melihat nama lengkap, NIP, masa aktif, `nominal`, serta `buktiUrl`
       * setiap tagihan.
       *
       * Di sini server yang memverifikasi token, dan nama akun diambil dari
       * token — bukan dari body. Jadi `username` di request tidak bisa
       * mengarahkan pembacaan ke dokumen orang lain, dan rules bisa ditutup
       * total.
       */
      case 'langganan:saya': {
        const { bacaLanggananSaya } = await muatBilling();
        const hasil = await bacaLanggananSaya(token);
        return res.status(hasil.kode).json(hasil);
      }
      case 'tagihan:saya': {
        const { bacaTagihanSaya } = await muatBilling();
        const hasil = await bacaTagihanSaya(token, Number(body.batas) || 20);
        return res.status(hasil.kode).json(hasil);
      }
      case 'billing:baca': {
        const { bacaPengaturanBilling } = await muatBilling();
        const hasil = await bacaPengaturanBilling(token);
        return res.status(hasil.kode).json(hasil);
      }
      case 'langganan:daftar': {
        const { bacaSemuaLangganan } = await muatBilling();
        const hasil = await bacaSemuaLangganan(token);
        return res.status(hasil.kode).json(hasil);
      }
      case 'tagihan:daftar': {
        const { bacaSemuaTagihan } = await muatBilling();
        const hasil = await bacaSemuaTagihan(token);
        return res.status(hasil.kode).json(hasil);
      }

      // ── Langganan & billing ───────────────────────────────────
      /*
       * Ketiga operasi ini **tidak punya versi peramban** — `firestore.rules`
       * menutup `jatim_langganan`, `jatim_tagihan`, dan `jatim_pengaturan/billing`
       * untuk tulis. Yang ada sebelumnya di `langgananFirestore.ts` akan
       * ditolak rules, jadi pemindahannya ke server bukan pilihan gaya tapi
       * memperbaiki operasi yang memang tidak bisa jalan.
       *
       * Otorisasi diperiksa di dalam `serverBilling` — setiap fungsinya
       * menerima token dan memverifikasinya lewat helper yang sama dengan
       * `panelServer`. Mendekentralkan authorization ke banyak tempat adalah cara
       * pasti lupa di salah satunya.
       *
       * Pengecualiannya satu: `tagihan:buat`. Tagihan milik pemanggil sendiri,
       * jadi syaratnya sesi yang sah, bukan peran admin. Lihat catatan di
       * casenya.
       */
      case 'langganan:perpanjang': {
        const { perpanjangManualServer } = await muatBilling();
        const hasil = await perpanjangManualServer(token, {
          username: str(body.username),
          durasi: typeof body.durasi === 'number' ? body.durasi : undefined,
          satuan: str(body.satuan) as never,
          catatan: str(body.catatan),
        });
        return res.status(hasil.kode).json(hasil);
      }
      case 'langganan:set-masa-akhir': {
        const { setMasaAkhirServer } = await muatBilling();
        const hasil = await setMasaAkhirServer(token, {
          username: str(body.username),
          iso: str(body.iso),
        });
        return res.status(hasil.kode).json(hasil);
      }
      case 'langganan:set-gratis': {
        const { setGratisServer } = await muatBilling();
        const hasil = await setGratisServer(token, {
          username: str(body.username),
          gratis: body.gratis === true,
          alasan: str(body.alasan),
        });
        return res.status(hasil.kode).json(hasil);
      }
      /*
       * ⚠️ `tagihan:buat` **tidak** butuh admin.
       *
       * Operasi ini pernah memakai `dindingAdmin()`, dan akibatnya
       * pengguna biasa tidak bisa membayar — legendanya "Akses khusus admin."
       * muncul di halaman pembayaran yang seharusnya milik orang yang belum
       * membayar. Tagihan adalah dokumen milik pemanggil sendiri.
       *
       * Yang tidak boleh ikut diteruskan: `username` (diambil dari token) dan
       * `nominal`/`durasi`/`satuan` (diambil dari konfigurasi paket server).
       * Semula ketiganya ikut dikirim dan sekarang diabaikan, jadi tidak ada
       * lagi sumber kedua yang bisa menyimpang dari harga yang sebenarnya.
       */
      case 'tagihan:buat': {
        const { buatTagihanServer } = await muatBilling();
        const hasil = await buatTagihanServer(token, {
          orderId: str(body.orderId),
          usernameLabel: str(body.usernameLabel),
          paketId: str(body.paketId),
          metode: (body.metode ?? 'qris') as never,
        });
        return res.status(hasil.kode).json(hasil);
      }
      case 'tagihan:status': {
        const { setStatusTagihanServer } = await muatBilling();
        const hasil = await setStatusTagihanServer(token, {
          orderId: str(body.orderId),
          status: str(body.status) as never,
          catatan: str(body.catatan),
        });
        return res.status(hasil.kode).json(hasil);
      }
      case 'tagihan:hapus': {
        const { hapusTagihanServer } = await muatBilling();
        const hasil = await hapusTagihanServer(token, str(body.orderId));
        return res.status(hasil.kode).json(hasil);
      }
      case 'tagihan:hapus-semua': {
        const { hapusSemuaTagihanServer } = await muatBilling();
        const hasil = await hapusSemuaTagihanServer(token);
        return res.status(hasil.kode).json(hasil);
      }
      case 'billing:simpan': {
        const { simpanBillingServer } = await muatBilling();
        const hasil = await simpanBillingServer(token, (body.nilai ?? {}) as Record<string, unknown>);
        return res.status(hasil.kode).json(hasil);
      }

      case 'password:ganti': {
        const hasil = await gantiPasswordSendiri(token, {
          passwordLama: str(body.passwordLama),
          passwordBaru: str(body.passwordBaru),
        });
        return res.status(hasil.kode).json(hasil);
      }

      /*
       * Nama admin bawaan.
       *
       * Hanya untuk ditampilkan, jadi satu-satunya bagian dari kredensial
       * admin yang boleh dibaca tanpa password. `SettingAkunModal`
       * memakainya untuk menampilkan "Username saat ini: @…". Nilai yang
       * dikembalikan adalah sumber yang **sama** dengan yang dipakai
       * `masukPanel()` saat membandingkan nama — bukan field terpisah yang
       * bisa berbeda.
       */
      case 'admin:nama': {
        const hasil = await verifikasiToken(token);
        if (!hasil.ok || hasil.akun?.role !== 'admin') {
          return res.status(403).json({ ok: false, kode: 403, pesan: 'Akses khusus admin.' });
        }
        return res.status(200).json({ ok: true, kode: 200, namaAdmin: hasil.akun.username });
      }

      // ── Kredensial admin bawaan ──────────────────────────────────────
      case 'admin:ubah': {
        const hasil = await ubahAdminBawaan(token, {
          passwordBaru: str(body.passwordBaru) || undefined,
          usernameBaru: body.usernameBaru === undefined ? undefined : str(body.usernameBaru),
          passwordLama: str(body.passwordLama),
        });
        return res.status(hasil.kode).json(hasil);
      }

      default:
        return res.status(400).json({
          ok: false,
          kode: 400,
          pesan: `Aksi "${aksi || '(kosong)'}" tidak dikenal.`,
        });
    }
  } catch (err: any) {
    /*
     * `PANEL_SESSION_SECRET` kosong adalah satu-satunya kesalahan
     * konfigurasi yang lolos dari pemeriksaan di atas — ia muncul saat token
     * ditandatangani, bukan saat endpoint dipanggil. Pesannya sengaja
     * menyebut perbaikannya, karena "internal server error" untuk masalah
     * env tidak pernah membuat ada yang mencari tahu.
     */
    const pesan = String(err?.message ?? '');
    if (/PANEL_SESSION_SECRET/.test(pesan)) {
      return res.status(503).json({ ok: false, kode: 503, pesan });
    }
    if (/google-cloud\/firestore|firebase-admin/.test(pesan)) {
      /*
       * Petunjuknya dikembalikan, detailnya tidak.
       *
       * Semula teks error aslinya ikut dikembalikan sampai 200 karakter. Error
       * itu dari `require()` Node, jadi isinya jalur absolut di server
       * (`/var/task/node_modules/...`), nama paket, dan baris kode — tidak
       * berguna bagi pemanggil, tapi peta struktur berkas untuk siapa pun yang
       * weary. Yang dibutuhkan hanya satu kalimat: apa yang harus diperbaiki.
       * Teks lengkapnya tetap masuk `console.error` di bawah supaya mudah
       * dicari di log.
       */
      return res.status(503).json({
        ok: false,
        kode: 503,
        pesan:
          'Server belum terpasang Firestore Admin SDK. Jalankan `npm i @google-cloud/firestore` (Node >= 22).',
      });
    }
    console.error('[panel-auth] gagal:', err);
    return res.status(500).json({ ok: false, kode: 500, pesan: 'Gagal memproses di server.' });
  }
}
