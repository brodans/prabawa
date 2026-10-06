/**
 * Pembungkus typed untuk seluruh panggilan JSON-RPC.
 *
 * Halaman-halaman tidak boleh memanggil `rpc()` langsung — supaya
 * nama RPC dan bentuk param terkumpul di satu tempat dan mudah diaudit
 * terhadap hasil probe langsung ke gateway live
 * (lihat `presensiContract.ts` dan `ENDPOINT.md`).
 *
 * Semua nama RPC di sini sudah diverifikasi terhadap gateway asli
 * `presensi.bkd.jatimprov.go.id` pada version 89.
 */

import { rpc, uploadMultipart } from '../api';
import {
  RPC_OBJECTS,
  ABSEN_CHECK_TYPE,
  GATE_PERANGKAH_TERIKAT,
  IMPORTFILE_FIELDS,
  formatLatLong,
  type AbsenCheckType,
  type AbsenParam,
  type AbsenResult,
  type AddIjinParam,
  type CekAbsenParam,
  type CekAbsenResult,
  type DeleteIjinParam,
  type HistoryAbsenModel,
  type HistoryParam,
  type IjinModel,
  type JenisIjinParam,
  type JenisIjinModel,
  type ListIjinParam,
  type LokasiModel,
  type LoginResult,
  type MasterTipeIjinModel,
  type SimpleResult,
  type TipeIjinMap,
  type UpdateFotoParam,
  type UpdateFotoResult,
  type UpdateProfilParam,
  type WorkCodeModel,
  INJECTED_PARAM_KEYS,
} from './presensiContract';
import {
  toIjinView,
  toJenisIjinView,
  toLokasiView,
  toMasterTipeIjinView,
  toWorkCodeView,
  type IjinView,
  type JenisIjinView,
  type LokasiView,
  type MasterTipeIjinView,
  type WorkCodeView,
} from './viewModels';

// Direkspor ulang supaya halaman cukup mengimpor dari satu modul.
export type {
  AbsenCheckType,
  AbsenResult,
  CekAbsenResult,
  HistoryAbsenModel,
  LoginResult,
  SimpleResult,
  TipeIjinMap,
  UpdateFotoResult,
} from './presensiContract';
export {
  GATE_NIP_SALAH,
  GATE_OBJECT_TIDAK_ADA,
  GATE_PARAM_SALAH,
  GATE_PERANGKAH_TERIKAT,
  LOGIN_MODUL_KEYS,
  modulAktif,
  type LoginModulKey,
} from './presensiContract';
export type { IjinView, JenisIjinView, LokasiView, MasterTipeIjinView, WorkCodeView } from './viewModels';

/** Konteks yang wajib ada di hampir semua panggilan. */
export interface ServerContext {
  apiKey?: string;
  lastLatLong?: string;
  imei?: string;
}

/**
 * Gabungkan payload dengan tiga field yang selalu disuntik klien.
 *
 * ⚠️ Urutan spread penting: `param` ditulis DULU, lalu `api_key`,
 * `last_latlong`, dan `imei` menimpanya. Kalau dibalik, payload pemanggil
 * bisa menimpa `last_latlong` dengan string kosong — persis bug yang dulu
 * membuat koordinat absensi tidak pernah sampai ke server.
 *
 * `last_latlong` sengaja TIDAK pernah di-override oleh `param`, dan
 * `latlong` juga tidak boleh dipakai di sini: field `latlong` hanya dibaca
 * pada `login` (lihat `LoginParam`). Untuk `absen` dan `cekabsen`,
 * koordinat harus lewat `last_latlong` — ubah `ctx.lastLatLong` bila
 * perlu mengirim koordinat tertentu.
 *
 * ⚠️ `param` ditulis DULU, baru kunci suntikan menimpanya. Urutan itu
 * dijaga lewat dua langkah terpisah (spreading, lalu pengisian dari
 * `INJECTED_PARAM_KEYS`) — bukan lewat satu objek literal — supaya
 * "tulis dulu, suntik kemudian" tidak bisa terbalik tanpa terlihat di diff.
 *
 * Daftar kuncinya sendiri diambil dari `presensiContract.ts`, sama seperti
 * yang dilakukan `src/api/server.ts` dan `api/rpc.ts`. Ketiga tempat
 * menyuntik field yang sama tidak boleh punya tiga daftar sendiri.
 */
function withContext<T extends Record<string, unknown>>(
  param: T,
  ctx: ServerContext
): T & { api_key: string; last_latlong: string; imei: string } {
  const hasil = { ...param } as T & { api_key: string; last_latlong: string; imei: string };
  const disuntik: Record<string, string> = {
    api_key: ctx.apiKey ?? '',
    last_latlong: ctx.lastLatLong ?? '',
    imei: ctx.imei ?? '',
  };
  for (const kunci of INJECTED_PARAM_KEYS) {
    (hasil as Record<string, string>)[kunci] = disuntik[kunci];
  }
  return hasil;
}

/** Ungkap baris dari balisan yang bisa berupa array atau `{ result: [...] }`. */
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const inner = (result as Record<string, unknown>).result;
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════
//  Autentikasi
// ═══════════════════════════════════════════════════════════════════════

/**
 * `login.latlong` dikirim apa adanya sebagai `0,0`.
 *
 * ⚠️ Fungsi ini **tidak** pernah memanggil `navigator.geolocation`. Dulu
 * iya, dan itulah sumber dialog "situs ini ingin mengetahui lokasi
 * Anda" yang muncul di tengah proses login.
 *
 * Aplikasi ini memang tidak memakai GPS: koordinat absen berasal dari titik
 * yang dipilih pengguna di peta (`lokasiTersimpan.ts`), lalu dikirim sebagai
 * `last_latlong` pada `cekabsen` dan `absen`. Yang dikirim di `login` cuma
 * formalitas, dan `0,0` adalah nilai yang benar untuk "tidak ada koordinat":
 *
 * 1. **Field-nya wajib.** Tanpa `latlong`, server membalas
 *    `-32602 Invalid params` sebelum sempat memeriksa NIP.
 * 2. **`0,0` netral dan jujur.** Angka itu berarti "tidak ada koordinat",
 *    bukan "berada di Samudra Hindia", dan tidak dipakai menghitung apa pun.
 *
 * Aplikasi asli (APK v89) mengirim `latlong` dari LocationManager; pada
 * perangkat tanpa GPS, nilai yang muncul juga `0,0`. Jadi ini perilaku yang
 * sama pada kasus yang sama — bukan penyederhanaan.
 */
const LATLONG_TANPA_GPS = '0,0';

/**
 * Hasil percobaan `login` — dipisah dari error supaya UI bisa memberi
 * petunjuk yang tepat untuk tiap penyebab kegagalan.
 */
export type HasilLogin =
  | { ok: true; data: LoginResult }
  | {
      ok: false;
      /** Kode gateway: 401 (kredensial), 402 (perangkat lain), atau -32602. */
      kode?: number;
      pesan: string;
      /** true bila akun terkunci ke perangkat lain → tampilkan kolom IMEI. */
      perangkatTerikat: boolean;
    };

/**
 * object: "login" — NIP + password.
 *
 * ⚠️ **Dipakai server, bukan peramban.** Jangan dipanggil dari UI.
 *
 * Auto-login ke server pusat sekarang lewat aksi `pusat:login` di
 * `POST /api/panel-auth`: server yang mendekripsi password dan memanggil
 * gateway. Kalau peramban yang melakukannya, password server pusat setiap
 * pengguna harus ada di peramban — dan kuncinya ada di bundle, jadi seluruh
 * password itu bisa diambil dari Firebase Console.
 *
 * Fungsinya tetap dipakai karena dua hal: (1) bentuk envelopenya adalah kontrak
 * yang harus sama persis dengan yang dikirim server, dan (2) `tools/cek-payload-absen.mts`
 * memverifikasi bentuk itu. Keduanya beri nilai **pakai fungsi ini** di dalam
 * `panelServer.ts` — bukan implementasi terpisah yang bisa melenceng diam-diam.
 *
 * Wajib: `email` (NIP), `password`, `latlong`, `imei`. Tanpa `latlong`
 * atau `imei` server membalas `-32602 Invalid params`.
 *
 * ⚠️ `imei` mengikat akun ke perangkat, dan gate 402 itu nyata tapi bisa
 * aktif atau dilepas server kapan saja (statusnya berbeda antar akun,
 * bahkan berubah di tengah hari). Saat aktif, NIP yang terdaftar pada
 * perangkat lain dijawab `402 User already registered with other device`
 * untuk semua nilai `imei`; ceknya berjalan sebelum password divalidasi,
 * jadi 402 tidak membocorkan apakah password benar.
 *
 * Karena `rpc` melempar error, fungsi ini tidak melempar: kegagalan
 * dikembalikan sebagai objek berisi kode dan pesan supaya pemanggil bisa
 * menampilkan petunjuk yang tepat untuk tiap penyebabnya.
 */
export async function rpcLogin(
  nip: string,
  password: string,
  options: { latLong?: string; imei?: string; signal?: AbortSignal } = {}
): Promise<HasilLogin> {
  const latlong = options.latLong ?? LATLONG_TANPA_GPS;
  try {
    const data = await rpc<LoginResult>(
      RPC_OBJECTS.LOGIN,
      {
        email: nip,
        password,
        latlong,
        // `imei` wajib ada di envelope. Nilai kosong akan diganti proxy
        // dengan TechMark proses, yang tidak mungkin cocok dengan akun
        // terkunci — jadi string kosong tetap dikirim apa adanya.
        imei: options.imei ?? '',
      },
      { signal: options.signal }
    );
    if (data === null) {
      return {
        ok: false,
        pesan: 'Server pusat tidak mengembalikan sesi login.',
        perangkatTerikat: false,
      };
    }
    return { ok: true, data };
  } catch (err: any) {
    const kode = typeof err?.code === 'number' ? err.code : undefined;
    return {
      ok: false,
      kode,
      pesan: String(err?.message ?? 'Gagal menghubungi server pusat.'),
      perangkatTerikat: kode === GATE_PERANGKAH_TERIKAT,
    };
  }
}

/**
 * Profil pegawai hasil login, dinormalkan ke bentuk yang dipakai UI.
 *
 * `login` sendiri sudah mengirim `nama`, `jabatan`, `departemen`,
 * `logo_departemen`, `foto_profile`, dan keempat flag modul — jadi tidak
 * ada endpoint profil terpisah yang perlu dipanggil.
 */
export interface ProfilPegawai extends LoginResult {
  /** NIP yang dipakai saat login — server tidak mengembalikannya. */
  nip: string;
}

/**
 * Normalkan hasil `login` menjadi bentuk profil.
 *
 * Pada kondisi normal `login` sudah cukup. Fallback ke
 * `list_ijin` / `history_absen` hanya dipakai bila nama kosong — mis.
 * untuk akun yang datanya belum lengkap di sisi server. Kegagalan tidak
 * dilempar: profil kosong lebih baik daripada menggagalkan login yang
 * sebenarnya sudah berhasil.
 */
export async function rpcLengkapiProfil(
  ctx: ServerContext,
  login: LoginResult,
  nip: string
): Promise<ProfilPegawai> {
  const base: ProfilPegawai = { ...login, nama: login.nama ?? '', nip };
  if (base.nama.trim().length > 0) return base;

  const rows = await rpcListIjin(ctx, { page: 1, limit: 1 });
  const first = rows[0];
  if (first?.nama) return { ...base, nama: first.nama, departemen: first.departemen };

  const hariIni = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const punches = await rpcHistoryAbsen(ctx, { tgl: hariIni, page: 1, limit: 1 });
  const row = punches[0];
  if (row?.nama) return { ...base, nama: row.nama, departemen: row.departemen };

  return base;
}

/** object: "logout" — mengakhiri sesi di server pusat. */
export async function rpcLogout(ctx: ServerContext): Promise<unknown> {
  return rpc(RPC_OBJECTS.LOGOUT, withContext({}, ctx));
}

// ═══════════════════════════════════════════════════════════════════════
//  Data referensi
// ═══════════════════════════════════════════════════════════════════════

/**
 * object: "getworkcode" — konfigurasi jam kerja pegawai. Tanpa param khusus.
 *
 * `options.signal` dipakai `tokenMasihValid()` untuk menguji apakah `api_key`
 * hasil cache masih berlaku.
 */
export async function rpcGetWorkCode(
  ctx: ServerContext,
  options: { signal?: AbortSignal } = {}
): Promise<WorkCodeView[]> {
  const rows = await rpc<unknown>(RPC_OBJECTS.GET_WORK_CODE, withContext({}, ctx), options);
  return toRows<WorkCodeModel>(rows).map(toWorkCodeView);
}

/** object: "getlokasiabsen" — titik absen / geofence pegawai. */
export async function rpcGetLokasiAbsen(ctx: ServerContext): Promise<LokasiView[]> {
  const rows = await rpc<unknown>(RPC_OBJECTS.GET_LOKASI_ABSEN, withContext({}, ctx));
  return toRows<LokasiModel>(rows).map(toLokasiView);
}

/**
 * object: "getmastertipeijin" — grup master jenis izin.
 *
 * Hasilnya [{ Id, Nama, Tipe: [id tipe yang valid] }]. Dipakai untuk
 * mengelompokkan katalog dari `jenis_ijin`.
 */
export async function rpcGetMasterTipeIjin(ctx: ServerContext): Promise<MasterTipeIjinView[]> {
  const rows = await rpc<unknown>(RPC_OBJECTS.GET_MASTER_TIPE_IJIN, withContext({}, ctx));
  return toRows<MasterTipeIjinModel>(rows).map(toMasterTipeIjinView);
}

/**
 * object: "jenis_ijin" — katalog jenis izin. Wajib: `absen` + `master_tipe_ijin`.
 *
 * - `absen` = 1 → hanya jenis yang relevan untuk absensi (mis. "Lupa Absen").
 * - `master_tipe_ijin` = 1 → batasi ke master "Kehadiran" (TipeId 1),
 *   menambah 8 jenis; = 0 → seluruh katalog.
 */
export async function rpcJenisIjin(
  ctx: ServerContext,
  options: { absen?: number; masterTipeIjin?: number } = {}
): Promise<JenisIjinView[]> {
  const rows = await rpc<unknown>(
    RPC_OBJECTS.JENIS_IJIN,
    withContext(
      {
        absen: options.absen ?? 0,
        master_tipe_ijin: options.masterTipeIjin ?? 0,
      } satisfies JenisIjinParam,
      ctx
    )
  );
  return toRows<JenisIjinModel>(rows).map(toJenisIjinView);
}

/**
 * object: "tipe_ijin" — peta id → label tipe izin.
 *
 * Hasilnya objek datar, bukan array:
 *   { "": "-- Pilih Tipe Ijin --", "1": "ijin penuh", "2": ..., "3": ... }
 */
export async function rpcTipeIjin(ctx: ServerContext): Promise<TipeIjinMap> {
  const result = await rpc<unknown>(RPC_OBJECTS.TIPE_IJIN, withContext({}, ctx));
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as TipeIjinMap;
  }
  return {};
}

/** object: "syncdata" — tarik ulang data referensi ke perangkat. */
export async function rpcSyncData(ctx: ServerContext): Promise<SimpleResult | null> {
  return rpc<SimpleResult>(RPC_OBJECTS.SYNC_DATA, withContext({}, ctx));
}

// ═══════════════════════════════════════════════════════════════════════
//  Absensi
// ═══════════════════════════════════════════════════════════════════════

export interface CekAbsenOptions {
  checkType: AbsenCheckType | number;
  workCode: number | string;
  /** true = absen Work-From-Home; server hanya mengizinkan hari Jumat. */
  isWfh?: boolean;
}

/**
 * object: "cekabsen" — apakah absensi jenis tertentu boleh dilakukan.
 *
 * Wajib: `checktype` + `iswfh` (skema) dan `work_code` (bisnis — tanpa itu
 * server membalas `{absen:false, message:"Work Kode wajib dipilih"}`).
 *
 * `result.message` berisi alasan penolatan ATAU peringatan, misalnya
 * "anda terlambat 16 jam 26 menit 8 detik, lanjutkan presensi ?".
 * Lihat ABSEN_CHECK_TYPE untuk daftar nilai `checktype`.
 *
 * ⚠️ Koordinat dikirim lewat **`last_latlong`**, bukan `latlong`.
 * `latlong` hanya dibaca pada `login` (lihat LoginParam); untuk `absen`
 * dan `cekabsen` field itu diabaikan, sehingga koordinat yang diletakkan
 * di sana tidak pernah sampai ke perhitungan geofence server.
 */
export async function rpcCekAbsen(
  ctx: ServerContext,
  options: CekAbsenOptions
): Promise<CekAbsenResult | null> {
  return rpc<CekAbsenResult>(
    RPC_OBJECTS.CEK_ABSEN,
    withContext(
      {
        checktype: Number(options.checkType),
        work_code: options.workCode,
        iswfh: options.isWfh ? 1 : 0,
      } satisfies CekAbsenParam,
      ctx
    )
  );
}

export interface AbsenOptions {
  checkType: AbsenCheckType | number;
  workCode: number | string;
  isWfh?: boolean;
  /** true bila sekaligus mengirim pengajuan izin. */
  withIjin?: boolean;
  /** Alasan izin — dipakai bila `withIjin` = true. */
  keterangan?: string;
  /** id tipe izin 1/2/3 — dipakai bila `withIjin` = true. */
  typeIjin?: number | string;
  /**
   * Penanda lokasi simulasi.
   *
   * Aplikasi mengisi `mock` dari `Location.isMock()` dan
   * `isFromMockProvider()`. Panel ini tidak pernah memakai GPS, jadi
   * nilainya selalu 0 — tapi key-nya tetap dikirim agar payload
   * identik dengan aplikasi.
   */
  mock?: boolean;
}

/**
 * object: "absen" — kirim absensi.
 *
 * Enam key wajib: `checktype`, `work_code`, `iswfh`, `ijin`,
 * `keterangan`, `type_ijin`. Semuanya harus dikirim apa adanya meski
 * `ijin` = 0 — server menolak dengan `-32602` bila ada yang hilang.
 *
 * `mock` bukan key wajib, tapi ada di payload aplikasi (lihat
 * `AbsenOptions.mock`).
 *
 * ⚠️ Koordinat dikirim lewat **`last_latlong`**, bukan `latlong` — sama
 * seperti `rpcCekAbsen`. `latlong` hanya dibaca pada `login`.
 */
export async function rpcAbsen(
  ctx: ServerContext,
  options: AbsenOptions
): Promise<AbsenResult | null> {
  const withIjin = options.withIjin ?? false;
  return rpc<AbsenResult>(
    RPC_OBJECTS.ABSEN,
    withContext(
      {
        checktype: Number(options.checkType),
        work_code: options.workCode,
        iswfh: options.isWfh ? 1 : 0,
        ijin: withIjin ? 1 : 0,
        keterangan: options.keterangan ?? '',
        type_ijin: options.typeIjin ?? 0,
        mock: options.mock ? 1 : 0,
      } satisfies AbsenParam,
      ctx
    )
  );
}

/** object: "history_absen" — riwayat absensi satu tanggal. Wajib: `tgl`+`page`+`limit`. */
export async function rpcHistoryAbsen(
  ctx: ServerContext,
  params: { tgl: string; page?: number; limit?: number }
): Promise<HistoryAbsenModel[]> {
  return toRows<HistoryAbsenModel>(
    await rpc<unknown>(
      RPC_OBJECTS.HISTORY_ABSEN,
      withContext(
        {
          tgl: params.tgl,
          page: params.page ?? 1,
          limit: params.limit ?? 30,
        } satisfies HistoryParam,
        ctx
      )
    )
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Perizinan
// ═══════════════════════════════════════════════════════════════════════

export interface AddIjinPayload {
  /** id dari `jenis_ijin`. */
  jenisIjin: number | string;
  /** id dari `tipe_ijin`: 1 = ijin penuh, 2 = tidak absen masuk, 3 = tidak absen pulang. */
  tipeIjin: number | string;
  /** "YYYY-MM-DD". */
  tglIjin: string;
  tglIjinSampai: string;
  alasan: string;
}

/**
 * object: "add_ijin" — ajukan izin/cuti. Lima param wajib, lihat AddIjinParam.
 *
 * ⚠️ Lampiran TIDAK ikut di sini. Aplikasi v89 mengunggah berkas
 * terpisah ke `POST /importfile` memakai `id` yang dikembalikan server —
 * kirim base64 pada `berkas` hanya menghasilkan file 0 byte (dan
 * menimpa lampiran lama dengan sampah). Pakai `rpcUploadLampiranIjin`.
 *
 * `id` tetap dikirim sebagai string kosong, sama seperti aplikasi,
 * karena `add_ijin` juga dipakai untuk menyesuaikan izin yang sudah ada.
 */
export async function rpcAddIjin(
  ctx: ServerContext,
  payload: AddIjinPayload
): Promise<SimpleResult | null> {
  return rpc<SimpleResult>(
    RPC_OBJECTS.ADD_IJIN,
    withContext(
      {
        id: '',
        tgl_ijin: payload.tglIjin,
        tgl_ijin_sampai: payload.tglIjinSampai,
        alasan: payload.alasan,
        jenis_ijin: payload.jenisIjin,
        tipe_ijin: payload.tipeIjin,
      } satisfies AddIjinParam,
      ctx
    )
  );
}

/**
 * object: "list_ijin" — daftar pengajuan izin. Wajib: `page` + `limit`.
 *
 * Server tidak menerima filter apa pun, jadi penyaringan tanggal/status/
 * pegawai harus dilakukan di sisi klien. Balasan juga membawa
 * `total`, `page`, dan `view` di level envelope.
 *
 * ⚠️ Tidak ada endpoint approve/reject — lihat RPC_OBJECTS_LEGACY.
 */
export async function rpcListIjin(
  ctx: ServerContext,
  params: { page?: number; limit?: number } = {}
): Promise<IjinView[]> {
  const rows = await rpc<unknown>(
    RPC_OBJECTS.LIST_IJIN,
    withContext(
      {
        page: params.page ?? 1,
        limit: params.limit ?? 50,
      } satisfies ListIjinParam,
      ctx
    )
  );
  return toRows<IjinModel>(rows).map(toIjinView);
}

/** object: "delete_ijin" — hapus pengajuan izin. Wajib: `id`. */
export async function rpcDeleteIjin(
  ctx: ServerContext,
  id: number | string): Promise<SimpleResult | null> {
  return rpc<SimpleResult>(RPC_OBJECTS.DELETE_IJIN, withContext({ id } satisfies DeleteIjinParam, ctx));
}

// ═══════════════════════════════════════════════════════════════════════
//  Profil
// ═══════════════════════════════════════════════════════════════════════

/**
 * object: "update_foto" — simpan foto profil (dan opsional vektor wajah).
 *
 * ⚠️ Koreksi atas catatan versi sebelumnya: unggahan foto profil **bisa**
 * lewat JSON-RPC. `image` memang hanya nama berkas, tapi isi berkasnya
 * dikirim lewat `image64` (base64 polos) — param itu yang dipakai
 * `UploadPhotoViewModel` di APK v89 dan belum pernah dicoba di sini.
 *
 * `vektor` (embedding wajah, teks float dipisah koma) boleh ikut
 * dikirim; biarkan kosong kalau tidak ada vektor yang mau didaftarkan.
 *
 * Bentuk `result` sama dengan balasan `update_foto` di aplikasi:
 * `{ url, message }`. Setelah berhasil, `foto_profile` pada `login`
 * berikutnya menunjuk ke URL baru.
 */
export async function rpcUpdateFoto(
  ctx: ServerContext,
  payload: { image64: string; image?: string; vektor?: string }
): Promise<UpdateFotoResult | null> {
  /*
   * `vektor` ikut spreading, bukan di-assign terpisah.
   *
   * `satisfies` mempertahankan tipe harfiah objek, jadi `param.vektor = …`
   * setelahnya ditolak: `vektor` memang tidak ada pada `{image, image64}`.
   * conditional spread membuat field itu bagian dari objek sejak awal, dan
   * `UpdateFotoParam` yang tetap yang menentukan bentuk akhirnya.
   */
  const param = {
    // Aplikasi selalu mengirim nama berkas tetap "foto.png".
    image: payload.image ?? 'foto.png',
    image64: payload.image64,
    ...(payload.vektor ? { vektor: payload.vektor } : {}),
  } satisfies UpdateFotoParam;
  return rpc<UpdateFotoResult>(RPC_OBJECTS.UPDATE_FOTO, withContext(param, ctx));
}

/**
 * object: "update_profil" — ganti password server pusat.
 *
 * Hanya dua key yang dikirim, persis seperti `ProfileFragment` di APK v89:
 * `password_lama` + `password`. Konfirmasi password hanya dibandingkan
 * di sisi klien, tidak pernah masuk ke request.
 */
export async function rpcUpdateProfil(
  ctx: ServerContext,
  payload: { passwordLama: string; passwordBaru: string }
): Promise<SimpleResult | null> {
  return rpc<SimpleResult>(
    RPC_OBJECTS.UPDATE_PROFIL,
    withContext(
      {
        password_lama: payload.passwordLama,
        password: payload.passwordBaru,
      } satisfies UpdateProfilParam,
      ctx
    )
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Lampiran izin — endpoint multipart (bukan JSON-RPC)
// ═══════════════════════════════════════════════════════════════════════

/**
 * `POST /service/importfile` — unggah lampiran (scan/foto) pengajuan izin.
 *
 * ⚠️ Ini satu-satunya endpoint di luar `/service` itu sendiri, dan bukan
 * JSON-RPC: formatnya `multipart/form-data` (lihat
 * `PRESENSI_IMPORTFILE_URL`). Karena itu tidak bisa lewat `rpc()` —
 * request diteruskan apa adanya oleh route `/api/upload`.
 *
 * ⚠️ **Belum terverifikasi di sisi server.** Path-nya terbukti hidup
 * (dijawab 200 + JSON-RPC, bukan 404 seperti path karangan), tetapi
 * semua variasi body yang dicoba — multipart lengkap maupun JSON — dijawab
 * `-32605 Invalid Request` yang sama. Jadi pemanggil harus memperlakukan
 * kegagalan unggahan sebagai mungkin, bukan pasti: pengajuan izin sudah
 * tercatat sebelum langkah ini, dan hanya lampirannya yang bisa hilang.
 *
 * Bentuknya diambil dari `PerizinanFragment$uploadImage$multipartRequest$1`
 * (APK v89):
 *
 * | bagian | nama    | nilai                            |
 * |--------|---------|----------------------------------|
 * | field  | api_key | token sesi                       |
 * | field  | id      | id izin dari `add_ijin`          |
 * | field  | last_latlong | `""` (selalu kosong di app) |
 * | field  | type    | `"ijin"`                          |
 * | part   | image   | berkas (jpg / pdf)               |
 *
 * Pemanggil harus sudah punya `id` izin, jadi urutannya
 * `rpcAddIjin` → lalu fungsi ini.
 *
 * Melempar `RpcError` kalau gateway menolak — pemanggil harus memisahkan
 * "pengajuan gagal" dari "lampiran gagal".
 */
export async function rpcUploadLampiranIjin(
  ctx: ServerContext,
  payload: { id: number | string; file: File }
): Promise<UpdateFotoResult | null> {
  return uploadMultipart<UpdateFotoResult>('/importfile', {
    [IMPORTFILE_FIELDS.API_KEY]: ctx.apiKey ?? '',
    [IMPORTFILE_FIELDS.ID]: String(payload.id),
    // Aplikasi mengirim string kosong di sini, bukan koordinat.
    [IMPORTFILE_FIELDS.LAST_LATLONG]: '',
    [IMPORTFILE_FIELDS.TYPE]: IMPORTFILE_FIELDS.TYPE_IJIN,
    [IMPORTFILE_FIELDS.FILE_PART]: payload.file,
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Helper
// ═══════════════════════════════════════════════════════════════════════

export { ABSEN_CHECK_TYPE, formatLatLong };
