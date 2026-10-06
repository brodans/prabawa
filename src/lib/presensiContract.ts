/**
 * ═══════════════════════════════════════════════════════════════════════
 *  KONTRAK API SERVER PUSAT PRABAWA
 *  (hasil reverse engineering APK + verifikasi langsung ke gateway live)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  ⚠️ Nama "E-Presensi" yang muncul di berkas ini BUKAN nama aplikasi ini.
 *  Aplikasi ini adalah **PRABAWA** / *Portal Presensi Jawa Timur* —
 *  lihat `appIdentity.ts`. "E-Presensi Jatim" di sini adalah nama *aplikasi
 *  Android yang terpisah* dan nama gateway-nya, yang memang menjadi
 * ultimate sumber kontrak ini. Nama perlu dibedakan supaya tidak mengira
 * ini sisa penamaan yang belum dibersihkan.
 *
 *  APK  : Jatim+Presensi_1.11.21_APKPure.xapk
 *  PKG  : dev.pti.bkdattendance  (kode: dev.nullpointer.bkdattendance)
 *  VER  : 1.11.21 (versionCode 89)
 *
 *  ─── TRANSPORT ───────────────────────────────────────────────────────
 *  Aplikasi Android tidak memakai REST path per-fungsi. Semua request
 *  dikirim ke SATU JSON-RPC gateway:
 *
 *      POST https://presensi.bkd.jatimprov.go.id/service
 *      Content-Type: application/json; charset=UTF-8
 *      User-Agent: okhttp/4.12.0
 *
 *  Dispatch lewat field `object` di body, bukan lewat URL path.
 *
 *  ─── ENVELOPE REQUEST ────────────────────────────────────────────────
 *  {
 *    "jsonrpc": 2,
 *    "method": "POST",
 *    "version": 89,          // >= 81; v78/80 diblokir (lihat VERSION_GATE)
 *    "object": "<nama_rpc>",
 *    "param": { ...payload-specific... }
 *  }
 *
 *  Field yang disuntik klien ke dalam `param`:
 *    - api_key      : token sesi hasil login, wajib untuk semua object
 *                     selain login
 *    - last_latlong : cache koordinat terakhir, format "<lat>,<long>"
 *    - imei         : id perangkat (Settings.Secure.ANDROID_ID di Android)
 *
 *  ⚠️ `imei` WAJIB ada di `login` (dicek server sebagai pengikat
 *  perangkat → error 402). `api_key` & `last_latlong` boleh kosong di login.
 *
 *  ─── ENVELOPE RESPONSE ───────────────────────────────────────────────
 *  {
 *    "jsonrpc": 2,
 *    "id_req": "<id>",
 *    "result": <T | null>,
 *    "total": <n>,        // hanya pada list_ijin / history_absen
 *    "page":  <n>,
 *    "view":  <n>
 *  }
 *
 *  Kegagalan bisnis TIDAK memakai HTTP error status — hasilnya ada di
 *  `result`._some(hasil: {result:false, message:"..."}).
 *
 *  Server MENGABAIKAN key `param` yang tidak dikenal, jadi mengirim
 *  superset key aman.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Satu-satunya host JSON-RPC. */
export const PRESENSI_SERVICE_URL = 'https://presensi.bkd.jatimprov.go.id/service';

/**
 * Path unggah lampiran izin — **satu-satunya path di luar `/service`**.
 *
 * Ditemukan lewat decompilasi `classes4.dex` (jadx) pada APK 1.11.21:
 * `PerizinanFragment.uploadImage()` dan `AbsenIjinFragment` memanggil
 * `VolleyMultipartRequest` (method = 1 → POST) ke
 * `sessionManager.getString("server") + "/importfile"`.
 *
 * ⚠️ Perhatikan penyusunannya: nilai `SERVER` di SharedPreferences
 * adalah `"https://presensi.bkd.jatimprov.go.id/service"`,
 * jadi URL akhirnya adalah `/service/importfile` — **bukan**
 * `/importfile`. (Petunjuk pendukung: `UploadPhotoService` memakai
 * `@POST("../service")` dengan baseUrl `server + "/"`, yaitu
 * `.../service/` → `../service`.)
 *
 * ⚠️ Ini endpoint multipart, BUKAN JSON-RPC — tidak bisa lewat `/api/rpc`.
 * Bentuknya (dari `PerizinanFragment$uploadImage$multipartRequest$1`):
 *
 *   POST /importfile
 *   Content-Type: multipart/form-data
 *
 *   field  api_key      = <token sesi>
 *   field  id           = <id izin hasil add_ijin>
 *   field  last_latlong = ""            ← sengaja kosong di aplikasi
 *   field  type         = "ijin"
 *   part   image        = berkas (filename "image.jpg" / "file.pdf",
 *                                 content-type "image/jpeg" /
 *                                 "application/pdf")
 *
 * Response dibaca `response.get("result")` lalu `result.url` dan
 * `result.message` — bentuknya sama dengan `update_foto`.
 */
export const PRESENSI_IMPORTFILE_PATH = '/importfile';

/**
 * URL penuh endpoint lampiran izin.
 *
 * `SERVER` di aplikasi sudah memuat `/service`, dan path-nya ditambahkan
 * di belakangnya — jadi hasilnya `/service/importfile`.
 */
export const PRESENSI_IMPORTFILE_URL = `${PRESENSI_SERVICE_URL}${PRESENSI_IMPORTFILE_PATH}`;

/** Field form yang wajib ada pada `POST /importfile`. */
export const IMPORTFILE_FIELDS = {
  API_KEY: 'api_key',
  ID: 'id',
  LAST_LATLONG: 'last_latlong',
  TYPE: 'type',
  /** Nilai `type` untuk lampiran pengajuan izin. */
  TYPE_IJIN: 'ijin',
  /** Nama part berkas. */
  FILE_PART: 'image',
} as const;

/**
 * `BuildConfig.VERSION_CODE` dari APK 1.11.21.
 *
 * Ini angka yang dikirim sebagai `version` di envelope — bukan asal angka
 * yang kebetulan sama. `PRESENSI_VERSION` diturunkan darinya supaya tidak
 * ada dua konstanta dengan nilai 89 yang bisa berbeda diam-diam.
 */
export const APK_VERSION_CODE = 89;

/**
 * Versi klien yang dikirim di envelope.
 *
 * Dipakai `APK_VERSION_CODE` = versionCode APK 1.11.21 (versi terbaru yang
 * dianalisis). Gateway memblokir `absen`/`cekabsen`/`add_ijin` bila versi
 * < 81, tapi menerima >= 81 — 89 aman dan paling dekat dengan aplikasi
 * asli. Dapat di-override lewat env `PRESENSI_VERSION` (lihat
 * src/api/server.ts).
 */
export const PRESENSI_VERSION = APK_VERSION_CODE;

/** `BuildConfig.VERSION_NAME` dari APK 1.11.21. */
export const PRESENSI_VERSION_NAME = '1.11.21';

/**
 * Gate versi di server (diverifikasi live):
 *
 *   version 78 / 80 → result: {"absen":false,"message":"aplikasi terbaru
 *                        telah tersedia, harp update untuk melakukan absen"}
 *   version 81+     → lolos, masuk validasi param biasa
 *
 * Gate ini SOFT: hanya memblokir absen/cekabsen/add_ijin. Object lain
 * tetap jalan di v78, tapi tetap selalu kirim >= 81.
 */
export const VERSION_GATE = {
  MIN_VERSION: 81,
  BLOCKED_OBJECTS: ['absen', 'cekabsen', 'add_ijin'] as const,
  STALE_MESSAGE: 'aplikasi terbaru telah tersedia, harp update untuk melakukan absen',
} as const;

/** Field yang selalu disuntik klien ke dalam `param`. */
export const INJECTED_PARAM_KEYS = ['api_key', 'last_latlong', 'imei'] as const;

/**
 * Daftar nama RPC (`object`) — **16 nama, semuanya terverifikasi live**.
 *
 * Cara verifikasi: kirim envelope dengan `object` kandidat, lalu baca kode
 * error. `-32601 "Object not found"` = nama tidak dikenal; error lain
 * (`-32602`, `-32604`, `401`, `402`, atau `result` terisi) = nama ada.
 *
 * 2378 nama kandidat (seluruh string snake_case/lowercase yang ada di
 * `classes4.dex` tapi tidak ada di dex library) sudah di-probe satu per satu
 * — tidak ada nama lain yang hidup.
 *
 * `jenis_ijin` dan `tipe_ijin` TIDAK ada di APK era v78: keduanya baru
 * muncul di server versi ini.
 */
export const RPC_OBJECTS = {
  // ── Autentikasi ──
  LOGIN: 'login',
  LOGOUT: 'logout',

  // ── Data referensi (semua butuh api_key valid) ──
  GET_WORK_CODE: 'getworkcode',
  GET_LOKASI_ABSEN: 'getlokasiabsen',
  GET_MASTER_TIPE_IJIN: 'getmastertipeijin',
  JENIS_IJIN: 'jenis_ijin',
  TIPE_IJIN: 'tipe_ijin',
  SYNC_DATA: 'syncdata',

  // ── Absensi ──
  CEK_ABSEN: 'cekabsen',
  ABSEN: 'absen',
  HISTORY_ABSEN: 'history_absen',

  // ── Perizinan ──
  ADD_IJIN: 'add_ijin',
  DELETE_IJIN: 'delete_ijin',
  LIST_IJIN: 'list_ijin',

  // ── Profil ──
  UPDATE_FOTO: 'update_foto',
  UPDATE_PROFIL: 'update_profil',
} as const;

/**
 * Nama RPC era APK lama yang **tidak dikenal** gateway live.
 * Semua membalas `-32601 Object not found` — jangan dipanggil.
 *
 * Sebagian nama ini sebenarnya nama class/fragment Kotlin
 * (`ApproveIjinFragment`, `HistoryIjinBawahanFragment`), bukan nama RPC.
 * Catatan penting: **tidak ada endpoint approve izin di server**, jadi
 * persetujuan hanya bisa dibaca, tidak bisa dip Approve dari web.
 */
export const RPC_OBJECTS_LEGACY = [
  'presensi',
  'laporan',
  'approve_ijin',
  'ijin_bawahan',
  'history_ijin',
  'history_ijin_bawahan',
  'ijin_absen',
  'absen_ijin',
  'cek_tipe',
  'upload_photo',
  'upload_wajah',
  'setybdet',
] as const;

export type RpcObject = (typeof RPC_OBJECTS)[keyof typeof RPC_OBJECTS];

/**
 * Param WAJIB per object — **diturunkan dengan delta-debugging terhadap
 * gateway live**: kirim seluruh 29 394 nama key yang mungkin (string pool
 * `classes4.dex`), lalu chuck-out key yang tidak mengubah `-32602` →
 * `-32604`. Setiap key yang tersisa lalu diuji drop-one untuk memastikan
 * benar-benar wajib.
 *
 * Tanda "⚠" = tidak wajib di level skema JSON-RPC, tapi DIBUTUHKAN
 * oleh logika bisnis server (dicek setelah token valid).
 */
export const RPC_REQUIRED_PARAMS: Record<string, readonly string[]> = {
  [RPC_OBJECTS.LOGIN]: ['email', 'password', 'latlong', 'imei'],
  [RPC_OBJECTS.LOGOUT]: [],
  [RPC_OBJECTS.GET_WORK_CODE]: [],
  [RPC_OBJECTS.GET_LOKASI_ABSEN]: [],
  [RPC_OBJECTS.GET_MASTER_TIPE_IJIN]: [],
  [RPC_OBJECTS.JENIS_IJIN]: ['absen', 'master_tipe_ijin'],
  [RPC_OBJECTS.TIPE_IJIN]: [],
  [RPC_OBJECTS.SYNC_DATA]: [],
  // ⚠ cekabsen: work_code wajib secara bisnis ("Work Kode wajib dipilih")
  [RPC_OBJECTS.CEK_ABSEN]: ['checktype', 'iswfh', 'work_code'],
  [RPC_OBJECTS.ABSEN]: [
    'checktype',
    'ijin',
    'iswfh',
    'keterangan',
    'type_ijin',
    'work_code',
  ],
  [RPC_OBJECTS.HISTORY_ABSEN]: ['tgl', 'page', 'limit'],
  [RPC_OBJECTS.LIST_IJIN]: ['page', 'limit'],
  [RPC_OBJECTS.ADD_IJIN]: [
    'tgl_ijin',
    'tgl_ijin_sampai',
    'alasan',
    'jenis_ijin',
    'tipe_ijin',
  ],
  [RPC_OBJECTS.DELETE_IJIN]: ['id'],
  // update_foto: decompilasi v89 (UploadPhotoViewModel.uploadPhoto) mengirim
  // tiga key sekaligus — `image` = "foto.png", `image64` = base64 isi
  // berkas, `vektor` = embedding wajah (512 float, dipisah koma).
  [RPC_OBJECTS.UPDATE_FOTO]: ['image', 'image64', 'vektor'],
  // update_profil: ProfileFragment v89 hanya mengirim dua key ini.
  [RPC_OBJECTS.UPDATE_PROFIL]: ['password_lama', 'password'],
};

/**
 * Kode error yang dipakai gateway sebagai "oracle" — semua terverifikasi.
 */
export const RPC_ERROR_CODES = {
  /** Nama `object` tidak dikenal server. */
  OBJECT_NOT_FOUND: -32601,
  /** Nama `object` dikenal, tapi bentuk `param` salah / kurang. */
  INVALID_PARAMS: -32602,
  /** `api_key` tidak ada / kedaluwarsa. */
  INVALID_TOKEN: -32604,
  /** NIP tidak terdaftar — muncul sebagai HTTP 401. */
  INVALID_NIP: 401,
  /** Akun sudah terdaftar di perangkat lain. */
  DEVICE_BOUND: 402,
  /** Kesalahan server (mis. `work_code` non-numerik). */
  SERVER_ERROR: 500,
} as const;

/** Param minimal yang wajib ada di setiap request. */
export interface BaseRpcParam {
  api_key?: string;
  last_latlong?: string;
  imei?: string;
  [key: string]: unknown;
}

/** Body lengkap yang dikirim ke gateway. */
export interface RpcEnvelope<P extends BaseRpcParam = BaseRpcParam> {
  jsonrpc: 2;
  method: 'POST';
  version: number;
  object: RpcObject | string;
  param: P;
}

/** Body yang harus dikirim ke /api/rpc oleh frontend. */
export interface RpcRequestBody<P extends BaseRpcParam = BaseRpcParam> {
  object: RpcObject | string;
  param?: P;
}

/** Balasan gateway. `result` null berarti gagal secara bisnis. */
export interface RpcResponse<T = unknown> {
  jsonrpc: number;
  id_req: string;
  result: T | null;
  total?: number;
  page?: number;
  view?: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  PARAMETER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Param `login` — **terverifikasi terhadap gateway live**.
 *
 * Tanpa `latlong` atau tanpa `imei` server membalas `-32602 Invalid params`.
 * Dengan keduanya, server sudah mencapai validasi kredensial:
 *   - NIP tidak dikenal        → HTTP 401 `Invalid Nip`
 *   - NIP + password benar     → result berisi api_key
 *   - NIP + password benar
 *     tapi perangkat berbeda   → error 402 (lihat RPC_ERROR_CODES)
 *
 * `email` berisi NIP, bukan alamat surel.
 */
export interface LoginParam extends BaseRpcParam {
  email: string;
  password: string;
  /** "<lat>,<long>" — koordinat saat login. */
  latlong: string;
  /** Id perangkat. Wajib ada; nilai bebas (server hanya membandingkan). */
  imei: string;
}

/**
 * Param `absen` — **terverifikasi**. Enam key wajib, hasil delta-debugging
 * terhadap gateway live + uji drop-one.
 *
 * `absen` di server v89 adalah satu panggilan gabungan: selain mencatat
 * absensi, ia bisa sekaligus membuat pengajuan izin (ketika `ijin` = 1).
 * Karena itu ada `ijin`, `type_ijin` dan `keterangan` di sini, terpisah
 * dari `add_ijin` yang hanya untuk izin.
 */
export interface AbsenParam extends BaseRpcParam {
  /** 1 = Datang, 2 = Pulang, 3 = Absen siang. Lihat ABSEN_CHECK_TYPE. */
  checktype: number;
  /** id work code dari `getworkcode`. Wajib, non-numerik → HTTP 500. */
  work_code: number | string;
  /** 1 = absen Work-From-Home (hanya boleh hari Jumat). */
  iswfh: number | boolean;
  /** 1 bila ikut mengirim pengajuan izin pada panggilan yang sama. */
  ijin: number | boolean;
  /** Alasan/keterangan accompanying when `ijin` = 1. */
  keterangan: string;
  /** id tipe izin (1/2/3) dari `tipe_ijin`, dipakai bila `ijin` = 1. */
  type_ijin: number | string;
  /**
   * Penanda lokasi simulasi — `location.isMock() || isFromMockProvider()`.
   *
   * ⚠️ Ini pernyataan CLIENT, bukan hasil pemeriksaan server: nilainya
   * ditentukan aplikasi dari LocationManager. Tidak ada parameter `mock`
   * pada `cekabsen`, hanya pada `absen`.
   */
  mock?: number;
  /** Koordinat saat absen. */
  latlong?: string;
}

/** Param `cekabsen` — **terverifikasi**: `checktype` + `iswfh` (skema), `work_code` (bisnis). */
export interface CekAbsenParam extends BaseRpcParam {
  checktype: number;
  iswfh: number | boolean;
  work_code: number | string;
  latlong?: string;
}

/** Param `jenis_ijin` — **terverifikasi**: `absen` + `master_tipe_ijin`. */
export interface JenisIjinParam extends BaseRpcParam {
  /** 1 = hanya jenis izin yang relevan untuk absensi. */
  absen: number | boolean;
  /** 1 = batasi ke master "Kehadiran" (TipeId 1). */
  master_tipe_ijin: number | boolean;
}

/**
 * Param `add_ijin` — **terverifikasi terhadap gateway live**.
 *
 * Lima key wajib: `tgl_ijin`, `tgl_ijin_sampai`, `alasan`, `jenis_ijin`,
 * `tipe_ijin`. Tanpa salah satu → `-32602`.
 * `jenis_ijin` diambil dari `jenis_ijin`, `tipe_ijin` dari `tipe_ijin`.
 */
export interface AddIjinParam extends BaseRpcParam {
  tgl_ijin: string;
  tgl_ijin_sampai: string;
  alasan: string;
  /** id dari `jenis_ijin` (field `Id`). */
  jenis_ijin: number | string;
  /** id dari `tipe_ijin` (1 = ijin penuh, 2 = tidak absen masuk, 3 = tidak absen pulang). */
  tipe_ijin: number | string;
  /**
   * `id` izin. `PerizinanFragment` v89 mengirimnya apa adanya (string
   * kosong untuk pengajuan baru) — bukan param wajib, tapi memang ada
   * di payload aplikasi.
   */
  id?: string;
  /**
   * ⚠️ JANGAN isi base64 di sini.
   *
   * Aplikasi v89 **tidak** mengirim lampiran lewat `add_ijin`. Berkas
   * diunggah terpisah ke `POST /importfile` memakai `id` izin yang baru
   * dibuat. Balisan `list_ijin` menampilkan `berkas` sebagai nama/flag,
   * jadi yang tersimpan adalah hasil unggahan tersebut.
   */
  berkas?: string;
}

/**
 * Param `list_ijin` — **terverifikasi**: butuh `page` + `limit`.
 * Server tidak menerima filter tanggal/status/pegawai, jadi seluruh
 * penyaringan harus dilakukan di sisi klien.
 */
export interface ListIjinParam extends BaseRpcParam {
  page: number;
  limit: number;
}

/**
 * Param `history_absen` — **terverifikasi**: `tgl` + `page` + `limit`.
 * Hanya satu tanggal per panggilan; rentang tanggal harus dipecah
 * satu per hari di sisi klien.
 */
export interface HistoryParam extends BaseRpcParam {
  /** "YYYY-MM-DD". */
  tgl: string;
  page: number;
  limit: number;
}

/** Param `delete_ijin` — **terverifikasi**: butuh `id`. */
export interface DeleteIjinParam extends BaseRpcParam {
  id: number | string;
}

/**
 * Param `update_profil` — **terverifikasi lewat decompilasi v89**.
 *
 * `ProfileFragment` (APK 1.11.21) mengirim tepat dua key:
 *
 * ```
 * api_key, password_lama, password
 * ```
 *
 * Konfirmasi password **tidak** dikirim ke server — aplikasi mencocokkan
 * `password` dengan `konfirmasi` di sisi klien sebelum memanggil
 * `update_profil`, termasuk memeriksa kebijakan minimal 8 karakter +
 * huruf besar + angka + karakter spesial.
 *
 * `password_lama` sudah terverifikasi lewat gateway live: salah →
 * `{result: false, message: "password lama tidak sesuai"}`.
 */
export interface UpdateProfilParam extends BaseRpcParam {
  password_lama: string;
  password: string;
}

/**
 * Param `update_foto` — **terverifikasi lewat decompilasi v89**.
 *
 * `UploadPhotoViewModel.uploadPhoto()` mengirim tiga key:
 *
 * ```
 * api_key : token sesi
 * image   : "foto.png"              nama berkas, selalu konstan di aplikasi
 * image64 : base64(isi berkas)      inilah yang benar-benar tersimpan
 * vektor  : "0.12,-0.44,..."        embedding wajah, opsional
 * ```
 *
 * ⚠️ Koreksi atas versi dokumen sebelumnya: klaim "binary tidak bisa
 * dikirim lewat JSON-RPC" **tidak benar**. Yang hanya dibaca server
 * sebagai nama file memang `image`, tapi isi berkasnya lewat `image64`.
 * Foto profil karena itu bisa diperbarui dari web — cukup kirim base64.
 *
 * Response `result` berisi `{ url, message }` (lihat `UpdateFotoResult`).
 *
 * `vektor` tetap opsional dan belum diisi panel web: menghitungnya
 * butuh model FaceNet 512-dimensi (`facenet_512.tflite`) yang hanya ada
 * sebagai aset di dalam APK.
 */
export interface UpdateFotoParam extends BaseRpcParam {
  /** Selalu "foto.png" di aplikasi; aman ditiru apa adanya. */
  image?: string;
  /** Base64 polos, tanpa prefix `data:`. */
  image64: string;
  /** Embedding wajah sebagai teks float dipisah koma; opsional. */
  vektor?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  KONSTANTA DOMAIN
// ═══════════════════════════════════════════════════════════════════════

/**
 * `checktype` — jenis absensi. Diverifikasi dengan menguji 0..3 dan
 * membaca `kode` yang dikembalikan `cekabsen`:
 *
 *   1 → "Datang"    (jam_masuk)
 *   2 → "Pulang"    (jam_keluar)
 *   3 → absen siang, hanya boleh antara 12.00–13.00
 *   0 / nilai lain → "Tidak diperbolehkan melakukan absensi saat ini."
 */
export const ABSEN_CHECK_TYPE = {
  DATANG: 1,
  PULANG: 2,
  SIANG: 3,
} as const;

export type AbsenCheckType = (typeof ABSEN_CHECK_TYPE)[keyof typeof ABSEN_CHECK_TYPE];

/** Label `tipe_ijin` sesuai balisan `tipe_ijin`. */
export const TIPE_IJIN_LABEL: Record<string, string> = {
  '1': 'ijin penuh',
  '2': 'Ijin Tidak Absen Masuk',
  '3': 'Ijin Tidak Absen Pulang',
};

// ═══════════════════════════════════════════════════════════════════════
//  KODE ERROR GATEWAY
// ═══════════════════════════════════════════════════════════════════════

/** `login` membalas 401 bila `email` bukan NIP atau password salah. */
export const GATE_NIP_SALAH = 401;

/**
 * `login` membalas 402 bila `imei` tidak cocok dengan perangkat yang
 * terdaftar untuk akun tersebut.
 *
 * ⚠️ Gate ini **nyata tapi tidak stabil**, dan sifatnya per akun. Pada
 * 2026-09-28 pukul 00:10 WIB NIP `200011082023081001` terkunci — semua
 * `imei` yang dicoba (`""`, `null`, `0`, `" "`, `[]`, UUID acak) dijawab
 * 402, sementara NIP `200308062025101001` bebas. Pada pukul 02:00 WIB
 * NIP yang sama berhasil login dengan 10 UUID acak berbeda. Tidak ada
 * interaksi dari sisi kita di antara keduanya, jadi yang berubah adalah
 * status binding di sisi server.
 *
 * Sifat gate saat aktif, semuanya terverifikasi:
 *
 * 1. Dicek **sebelum** password divalidasi — password benar maupun salah
 *    sama-sama dijawab 402, jadi `login` bukan oracle password untuk akun
 *    terkunci.
 * 2. Tidak bisa dilewati — dan `imei` tidak boleh dihilangkan sama sekali
 *    (tanpanya server membalas `-32602 Invalid params`).
 * 3. Tidak ada endpoint untuk melepas atau memindahkan binding — 2.378
 *    nama kandidat dari string-pool semuanya `-32601`.
 *
 * Satu-satunya solusi saat terkunci adalah `imei` perangkat yang benar,
 * yaitu androidId yang dipakai saat pendaftaran pertama.
 */
export const GATE_PERANGKAH_TERIKAT = 402;

/** `-32601` — nama object tidak dikenal. */
export const GATE_OBJECT_TIDAK_ADA = -32601;

/** `-32602` — object ada, bentuk/kelengkapan param salah. */
export const GATE_PARAM_SALAH = -32602;

// ═══════════════════════════════════════════════════════════════════════
//  MODEL RESPONSE — semua disalin dari balasan gateway live
// ═══════════════════════════════════════════════════════════════════════

/**
 * `login` → result. SELURUH field di bawah ini terverifikasi dari balasan
 * gateway live pada 2026-09-28 — `login` ternyata mengembalikan profil
 * pegawai lengkap, bukan hanya token sesi.
 */
export interface LoginResult {
  message: string;

  // ── Identitas sesi ──
  /** Token sesi; wajib pada semua panggilan berikutnya. */
  api_key: string;
  pegawai_id: number;
  user_id: number;
  departemen_id: number;
  group_id: number;
  /** "pegawai" / "atasan" / "admin" — penentu modul yang boleh diakses. */
  group_name: string;

  // ── Profil pegawai ──
  nama: string;
  jabatan: string;
  departemen: string;
  logo_departemen: string;

  // ── Verifikasi wajah & WFH ──
  /** 1 = server mewajibkan pencocokan wajah saat absen. */
  upload_wajah: number;
  /** 1 = akun boleh absen Work-From-Home. */
  allow_wfh: number;
  /**
   * URL foto profil. ⚠️ Hanya valid bila nama berkasnya tidak kosong —
   * pemanggilan `update_foto` tanpa nama file menghasilkan URL yang diakhiri
   * tanda hubung dan file 0 byte.
   */
  foto_profile: string;
  /** Vektor wajah terdaftar; string kosong bila belum dibuat. */
  vektor_profile: string;
  /** 1 = vektor wajah sudah disetujui atasan. */
  vektor_approved: number;

  // ── Modul yang diizinkan server ──
  /** 1 = modul Beranda diizinkan. */
  home: number;
  /** 1 = modul Presensi diizinkan. */
  presensi: number;
  /** 1 = modul Perizinan diizinkan. */
  perizinan: number;
  /** 1 = modul Laporan diizinkan. */
  laporan: number;

  /** Label WFH yang dipakai server, mis. "WFH". */
  label_wfh: string;

  /**
   * Masa berlaku konfirmasi absensi, **dalam milidetik**.
   *
   * Dixcerpt dari `LoginActivity.lambda$loginProcess$4` (APK v89) yang
   * menyimpan `absen_timeout` ke SharedPreferences, lalu
   * `HomeVM.pendingTimeoutMillis()` membacanya (default 300.000 bila
   * kosong). Nilainya menjadi `PendingAttendanceResult.Expired` — jadi
   * setelah `cekabsen` membalas peringatan (mis. terlambat), pengguna
   * hanya punya jendela waktu sebesar ini untuk mengonfirmasi `absen`.
   */
  absen_timeout?: number | string | null;

  /** 1 = server mewajibkan vektor wajah (dikombinasikan dengan `upload_wajah`). */
  using_wajah?: number;
}

/** Default `absen_timeout` bila server tidak mengirimnya: 5 menit. */
export const DEFAULT_ABSEN_TIMEOUT_MS = 300_000;

/**
 * Ubah `absen_timeout` dari `login` menjadi milidetik.
 *
 * Nilai yang tidak bisa dibaca (null, string kosong, 0, NaN) jatuh ke
 * `DEFAULT_ABSEN_TIMEOUT_MS` — perilaku yang sama dengan
 * `HomeVM.pendingTimeoutMillis()` di aplikasi Android.
 */
export function absenTimeoutMs(login: Pick<LoginResult, 'absen_timeout'> | null | undefined): number {
  const raw = login?.absen_timeout;
  const value = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ABSEN_TIMEOUT_MS;
}

/**
 * Peta modul server → flag pada `LoginResult`.
 *
 * Keempat angka ini diuronkan server pusat dan dipakai aplikasi Android
 * untuk menyembunyikan modul yang tidak boleh diakses pegawai. Diperlakukan
 * sebagai gating di sisi server, terpisah dari hak akses lokal (Firestore).
 */
export const LOGIN_MODUL_KEYS = ['home', 'presensi', 'perizinan', 'laporan'] as const;

export type LoginModulKey = (typeof LOGIN_MODUL_KEYS)[number];

/** Baca flag modul dari hasil `login`; nilai selain 1 dianggap tidak aktif. */
export function modulAktif(login: Partial<LoginResult> | null | undefined, key: LoginModulKey): boolean {
  return Number(login?.[key] ?? 0) === 1;
}

/** `cekabsen` → result. */
export interface CekAbsenResult {
  /** true = absensi boleh dilanjutkan (bisa muncul peringatan terlambat). */
  absen: boolean;
  /** Alasan penolakan atau peringatan, bahasa Indonesia. */
  message: string;
  /** "Datang" / "Pulang", hanya saat absen = true. */
  kode?: string;
}

/** `absen` → result. */
export interface AbsenResult {
  absen: boolean;
  id?: number;
  pegawai_id?: number;
  nama?: string;
  departemen?: string;
  message?: string;
  [key: string]: unknown;
}

/** `getworkcode` → hasil. */
export interface JamModel {
  /** Batas awal absen masuk. */
  jam_masuk_awal: string;
  /** Jam absen masuk. */
  jam_masuk: string;
  /** Jam absen pulang. */
  jam_keluar: string;
  /** Batas akhir absen pulang. */
  jam_keluar_akhir: string;
}

/** `getworkcode` → hasil[].hari. */
export interface HariModel {
  nama: string;
  jam: JamModel;
}

/** `getworkcode` → hasil[]. */
export interface WorkCodeModel {
  /** id numerik; kirim apa adanya ke `work_code`. */
  id: number;
  nama: string;
  hari: HariModel;
}

/** `getlokasiabsen` → hasil[]. */
export interface LokasiModel {
  /** "default" untuk titik absen utama. */
  tipe: string;
  id: number;
  /** Nama satuan kerja. */
  data: string;
  /** "<lat>,<long>". */
  latlong: string;
  /** Nama instansi/lokasi. */
  lokasi: string;
  /** Radius geofence dalam meter. */
  radius: number;
  deskripsi: string;
  prioritas: number;
}

/** `getmastertipeijin` → hasil[]. Kelompok master jenis izin. */
export interface MasterTipeIjinModel {
  Id: number;
  Nama: string;
  /** id `tipe_ijin` yang valid untuk jenis ini, mis. [1,2,3]. */
  Tipe: number[];
}

/** `tipe_ijin` → hasil. Peta id → label, termasuk entry placeholder "". */
export type TipeIjinMap = Record<string, string>;

/** `jenis_ijin` → hasil[]. Katalog jenis izin. */
export interface JenisIjinModel {
  Id: number;
  Nama: string;
  /** Kode singkat, mis. "DLLK". */
  Kode: string;
  /** true bila jenis ini bisa dipilih setengah hari. */
  SetengahHari: boolean;
  CreatedAt: string | null;
  /** id master jenis izin (lihat MasterTipeIjinModel.Id). */
  TipeId: number;
  /** "1" bila memotong jatah. */
  Potongan: string;
  IsAktif: number;
}

/** `history_absen` → hasil[]. */
export interface HistoryAbsenModel {
  nama: string;
  departemen: string;
  /** Jarak dari titik absen, meter — format Indonesia ("12,509,838"). */
  jarak: string;
  /** "Datang" / "Pulang" / "Siang". */
  checktype: string;
  approval: boolean;
  /** "Disetujui" / teks lain. */
  approval_text: string;
  /** "YYYY-MM-DD HH:mm:ss". */
  waktu: string;
}

/** `list_ijin` → hasil[]. */
export interface IjinModel {
  id: number;
  approval: boolean;
  approval_at: string;
  /** NIP pemohon. */
  email: string;
  nama: string;
  departemen: string;
  tipe_ijin: number;
  tipe_ijin_text: string;
  jenis_ijin: number;
  jenis_ijin_text: string;
  /** id master jenis izin. */
  master_jenis_ijin: number;
  /** "09 September 2026  s/d  09 September 2026" — sudah diformat server. */
  tgl_ijin: string;
  tgl_ijin_dari: string;
  tgl_ijin_sampai: string;
  alasan: string;
  /**
   * Lampiran; string kosong bila tidak ada.
   *
   * Diisi oleh `POST /importfile` (multipart), bukan oleh `add_ijin`.
   * Nilai yang kembali bisa berupa nama berkas atau path, jadi UI hanya
   * memakainya sebagai penanda "ada/tidak".
   */
  berkas: string;
  created_at: string;

  // ── Field yang dibaca aplikasi v89 tapi belum terpetakan di versi
  //    kontrak sebelumnya (ListIjinBawahanFragment.parseIjinLists) ──

  /** id pegawai pemohon. */
  pegawai_id?: number;
  /** id user pemohon. */
  user_id?: number;
  /**
   * Catatan atasan.
   *
   * ⚠️ Tidak ada di `list_ijin` versi lama; dibaca `optString`, jadi
   * boleh kosong. Field ini yang membedakan izin yang ditolak dari
   * yang menunggu, selain `status`.
   */
  catatan?: string;
  /**
   * Status numerik izin.
   *
   * Nilai yang terlihat di aplikasi: 1 = disetujui, 2 = menunggu,
   * 3 = ditolak. Dibaca `getInt`, jadi 0 bila tidak dikirim.
   * ⚠️ `approval` (boolean) dan `status` (int) belum tentu konsisten —
   * pakai `status` kalau ada, `!approval` sebagai cadangan.
   */
  status?: number;
  updated_at?: string;
  updated_user?: string;
}

/**
 * Kode `status` izin — nilai yang dibaca aplikasi dengan `getInt`.
 *
 * Dipisah dari labelnya supaya tidak ada angka telanjang di tempat lain.
 * `viewModels.toIjinView()` sebelumnya menulis `statusRaw === 1` dan
 * `=== 3` secara langsung; kalau server pernah menambah status keempat,
 * kedua angka itu harus ditemukan dengan membaca satu tempat, bukan dengan
 * membaca halaman `RiwayatIjin`.
 *
 * Label yang setara (`1` Disetujui, `2` Menunggu, `3` Ditolak) tidak
 * dipisah sebagai konstanta: tidak ada layar yang menampilkan kode
 * mentah, dan label yang sudah dipetakan di `toIjinView()` hanya perlu
 * tiga nilai di atas. Konstanya dulu ada tapi tidak pernah dipakai.
 */
export const IJIN_STATUS_KODE = {
  DISETUJUI: 1,
  MENUNGGU: 2,
  DITOLAK: 3,
} as const;

/** `update_foto` → result. Bentuk identik dengan balasan `/importfile`. */
export interface UpdateFotoResult {
  result: boolean;
  /** URL file yang ditulis server. */
  url: string;
  message: string;
}

/** Bentuk `result` yang dipakai `update_profil` / `syncdata` / `add_ijin`. */
export interface SimpleResult {
  result?: boolean;
  code?: number;
  message: string;
  [key: string]: unknown;
}

/*
 * KONSTANTA SESSION (data/Constants.java) — DIHAPUS
 *
 * `CONSTANTS` dan `EXTRA_KEYS` pernah diekspor di sini berisi nama-nama key
 * SharedPreferences dari APK (`api_key`, `nip_pegawai`, `isloggedin`, …).
 * Semuanya tidak pernah dipakai: aplikasi ini tidak punya SharedPreferences
 * dan tidak pernah membaca Storage Android.
 *
 * Yang tersisa darinya cuma informasinya, dan informasi itu sudah aman di
 * dalam JSDoc modul ini: `INJECTED_PARAM_KEYS` memuat tiga key yang benar-
 * benar disuntik ke envelope, dan `EXTRA_KEYS` di atas tidak ada yang
 * menyentuhnya. Konstanta yang tidak pernah dibaca bukan dokumentasi — ia
 * hanya satu hal yang bisa salah diam-diam, karena tetap terlihat "dipakai".
 *
 * Kalau suatu saat nama key dari APK ini memang dibutuhkan, bariskan di
 * sini sebagai komentar, bukan sebagai `export` yang tidak dibaca siapa pun.
 */

// ═══════════════════════════════════════════════════════════════════════
//  HELPER
// ═══════════════════════════════════════════════════════════════════════

/** Builder envelope, mencerminkan interceptor Retrofit di aplikasi asli. */
export function buildRpcEnvelope<P extends BaseRpcParam>(
  object: RpcObject | string,
  param: P
): RpcEnvelope<P> {
  return {
    jsonrpc: 2,
    method: 'POST',
    version: PRESENSI_VERSION,
    object,
    param,
  };
}

/**
 * Format `last_latlong` seperti yang disimpan `SessionManager`.
 *
 * ⚠️ Angka **tidak** dibulatkan dan locale dipaksa `en-US` untuk nilai
 * numerik. Alasannya:
 *
 * 1. `last_latlong` di APK dikirim apa adanya dari `Location`, tanpa
 *    pembulatan. Membulatkan di sini membuat koordinat yang tercatat
 *    berbeda dari yang dihitung geofence, sehingga jarak di riwayat meleset.
 * 2. Kalau locale peramban memakai koma sebagai desimal, angka seperti
 *    `-7.29007` akan jadi `-7,29007` dan `"-7,29007,112,703"` tidak bisa
 *    diurai server.
 *
 * String yang sudah jadi (dari GPS pengguna) diteruskan apa adanya —
 * untuk kasus itu formatnya sudah benar dari sumbernya.
 */
export function formatLatLong(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined
): string {
  if (latitude === null || latitude === undefined || latitude === '') return '';
  if (longitude === null || longitude === undefined || longitude === '') return String(latitude);
  return `${angkaTitik(latitude)},${angkaTitik(longitude)}`;
}

/**
 * Angka → teks dengan desimal titik, tanpa pembulatan dan tanpa pemisah
 * ribuan.
 *
 * ⚠️ `maximumFractionDigits: 20` itu wajib, bukan hiasan. Tanpa itu,
 * `toLocaleString` memakai bawaan **3 desimal** — sehingga
 * `-7.2900712345` menjadi `"-7.29"`. Koordinat yang sampai ke server
 * kemudian berbeda ~7 meter dari titik yang/geofence pakai, dan jarak
 * yang tercatat pada riwayat ikut meleset.
 */
function angkaTitik(nilai: number | string): string {
  return typeof nilai === 'number'
    ? nilai.toLocaleString('en-US', {
        useGrouping: false,
        maximumFractionDigits: 20,
      })
    : nilai;
}

/**
 * Objek RPC yang **boleh** diulang otomatis setelah gagal.
 *
 * ⚠️ Daftar ini bukan "semua yang hanya membaca". `cekabsen` kelihatannya
 * hanya membaca — ia mengecek apakah sudah absen — tapi punya efek samping
 * yang nyata: membakar satu jatah absen di server. Mengulangnya diam-diam
 * setelah `503` bisa membuat satu hari tercatat dua kali. Jadi penyertaan
 * di sini selalu berarti dua hal sekaligus: hanya membaca, dan tidak
 * mengubah apa pun di sisi server.
 *
 * Setiap objek yang bisa mengubah data — `absen`, `cekabsen`, `add_ijin`,
 * `delete_ijin`, `update_foto`, `update_profil`, `login`, `logout`,
 * `syncdata` — sengaja tidak ada. Untuk objek seperti itu, kegagalan
 * sesaat dilaporkan ke pengguna, dan pengguna yang memutuskan mengulang.
 *
 * ⚠️ Hapus satu entri berarti satu pengaman hilang. Penambahan baru harus
 * disertai alasan di sini, bukan sekadar "coba dulu".
 */
export const RPC_BISA_ULANG: readonly string[] = [
  RPC_OBJECTS.GET_WORK_CODE,
  RPC_OBJECTS.GET_LOKASI_ABSEN,
  RPC_OBJECTS.GET_MASTER_TIPE_IJIN,
  RPC_OBJECTS.JENIS_IJIN,
  RPC_OBJECTS.TIPE_IJIN,
  RPC_OBJECTS.HISTORY_ABSEN,
  RPC_OBJECTS.LIST_IJIN,
];

/** true kalau objek ini aman diulang setelah proxy melaporkan `503`. */
export function bolehUlang(object: string): boolean {
  return RPC_BISA_ULANG.includes(object);
}

/**
 * Cuplikan singkat dari badan respons hulu, aman ditampilkan.
 *
 * ⚠️ Badan respons hulu tidak pernah dikembalikan utuh.
 *
 * Saat gateway tidak mengembalikan JSON, isinya bisa apa saja: halaman galat
 * HTML dari reverse proxy, teks berformat dari WAF, atau badan JSON dari
 * layanan lain. Men.returnkan 300 karakter mentah berarti semua itu sampai
 * ke peramban.
 *
 * Yang dibutuhkan untuk mendiagnosis jauh lebih sedikit: **baris pertama**
 * saja, dibersihkan dari tag HTML dan dipotong pendek. Untuk halaman galat
 * proxy, baris pertamanya sudah menyebut 403 atau 502; untuk JSON, baris
 * pertamanya adalah awal pesan. Sisanya tidak menambah informasi apa pun
 * dan hanya memperbesar yang bocor.
 */
export function cuplikanAman(teks: string): string {
  const barisPertama = teks.split(/\r?\n/).find(baris => baris.trim().length > 0) ?? '';
  return barisPertama
    /*
     * Karakter kendali dibuang **sebelum** tag HTML dibersihkan, dan ini
     * bukan cleanliness: `\u001b` (ESC) yang lolos sampai ke terminal operator
     * bisa menulis ulang judul baris log dan menyembunyikan baris sesudahnya.
     * Karakter tak terlihat lainnya bikin pesan galat terlihat kosong padahal
     * isinya ada.
     */
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Bentuk galat dari proxy saat server pusat tidak memberi JSON.
 *
 * ⚠️ Ada **dua** kasus yang selama ini jadi satu pesan, padahal obatnya
 * berbeda total.
 *
 * 1. **Gateway hidup, jawabannya 5xx dengan badan kosong.** Terverifikasi
 *    langsung terhadap `presensi.bkd.jatimprov.go.id/service`: `getlokasiabsen`
 *    sesekali membalas `HTTP 500` + `Content-Type: text/html` + badan
 *    **nol byte**. Header dan muatan sudah dicocokkan dengan yang dikirim
 *    aplikasi Android, dan permintaan yang identik berhasil pada percobaan
 *    berikutnya. Jadi ini kegagalan sesaat di sisi server pusat, bukan
 *    kesalahan pada permintaan.
 *
 * 2. **Halaman galat dari proxy atau WAF.** Badannya HTML, dan di sana
 *   biasanya ada penyebutan 403/502/504 yang berguna.
 *
 * Semula keduanya dijawab `502 { error: '…bukan JSON.' }` tanpa status
 * hulu, jadi kasus (1) — yang paling sering dan paling sementara — terlihat
 * seperti kasus (2): seperti ada yang salah yang mendasar.
 *
 * Yang paling terasa di `getlokasiabsen`: satu-satunya yang sampai ke
 * pengguna adalah "server tidak bisa dihubungi", padahal server pusatnya
 * sehat.
 *
 * Bentuk di bawah membuat perbedaannya terlihat: `huluStatus` memberi tahu
 * status yang benar-benar diterima, dan `huluKosong` menandai badan nol byte —
 * satu-satunya tanda yang tidak bisa disamarkan oleh gateway yang sehat.
 */
export interface GalatHulu {
  /** Pesan untuk ditampilkan ke pengguna. */
  error: string;
  /** Status HTTP yang benar-benar diterima dari server pusat, atau 0. */
  huluStatus: number;
  /** true kalau badan responsnya benar-benar kosong. */
  huluKosong: boolean;
  /** Cuplikan aman baris pertama — hanya untuk diagnostik. */
  cuplikan: string;
}

/**
 * Susun jawaban proxy untuk respons hulu yang tidak bisa dipakai.
 *
 * Kosong dan bukan-JSON dibedakan karena hanya kasus kedua yang mungkin
 * berarti ada yang perlu diperbaiki di sisi pemanggil.
 */
export function galatHulu(
  status: number,
  rawText: string,
  cuplikan: (teks: string) => string
): GalatHulu {
  const teks = rawText.trim();
  if (teks.length === 0) {
    return {
      // 503, bukan 502: 502 berarti "proxy gagal meneruskan", sedangkan di
      // sini sesasinya berhasil dan **server pusat** yang sedang bermasalah.
      // Klien memakai status ini untuk memutuskan apakah perlu mencoba lagi,
      // jadi 503 (hulu) dipetakan ke 503 (proxy) — bukan ke 502.
      error:
        'Server pusat sedang tidak melayani. Data belum berhasil ' +
        'dimuat — ini gangguan sesaat di sisi server pusat, bukan pada ' +
        'akun atau perangkat ini. Coba lagi beberapa saat lagi.',
      huluStatus: status,
      huluKosong: true,
      cuplikan: '',
    };
  }
  return {
    error:
      'Server pusat mengembalikan halaman galat, bukan data. ' +
      'Permintaan sudah diterima tetapi jawabannya tidak bisa dibaca.',
    huluStatus: status,
    huluKosong: false,
    cuplikan: cuplikan(teks),
  };
}
