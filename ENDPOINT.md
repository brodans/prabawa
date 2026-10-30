# PRABAWA — Peta Endpoint Server Pusat

> Nama panjang yang tampil di layar adalah *Portal Presensi Jawa Timur*.
> "PRABAWA" bukan lagi singkatan dari nama itu — ia dipertahankan sebagai
> nama singkat, nama merchant QRIS, dan bagian `order_id` yang sudah tercatat
> di produksi. Bandingkan `src/lib/appIdentity.ts`.
> Gateway yang didokumentasikan di bawah adalah milik aplikasi Android
> terpisah yang bernama "E-Presensi Jatim" — itu fakta teknis yang tidak
> boleh diubah, bukan nama aplikasi ini. Bandingkan `src/lib/appIdentity.ts`.

Dokumen ini adalah **ground truth** hasil probe black-box langsung ke gateway
produksi `presensi.bkd.jatimprov.go.id`, ditambah pembacaan string-pool APK.

| | |
|---|---|
| APK yang dianalisis | `Jatim+Presensi_1.11.21_APKPure.xapk` |
| Package | `dev.nullpointer.bkdattendance` |
| versionName / versionCode | `1.11.21` / **89** |
| Tanggal verifikasi | 2026-09-27 (probe) · 2026-09-28 (decompilasi) |

Semua 16 object di bawah **sudah diverifikasi live** dengan satu akun NIP
nyata. Nama object yang tidak ada di daftar ini selalu dibalas
`-32601 Object not found` — termasuk 2.378 nama kandidat yang diambil dari
string-pool APK v89 (lihat §7).

> ### underwent decompilasi penuh (revisi 2026-09-28)
>
> Versi dokumen sebelumnya bekerja tanpa jadx. Sekarang `classes4.dex`
> (seluruh 2.992 class aplikasi) sudah didekompilasi dengan jadx 1.5.0, dan
> hasilnya **membetulkan tiga kesimpulan lama** sekaligus menemukan satu
> endpoint yang tadinya tidak diketahui:
>
> | Temuan | Akibatnya |
> |---|---|
> | `POST /service/importfile` (multipart) | **Endpoint baru** — lampiran pengajuan izin. Tidak bisa ditemukan lewat probe nama object karena bukan JSON-RPC. Path-nya terbukti ada, tapi belum menerima body apa pun (§2.1) |
> | `update_foto` memakai `image64` | Kesimpulan lama "foto tidak bisa diunggah" **salah**. Isi berkasnya ada di `image64`, bukan multipart. |
> | `update_profil` = `password_lama` + `password` | Key `konfirmasi_password` yang ditebak sebelumnya **tidak ada**. |
> | `absen` punya param `mock` | Key tambahan yang tidak tercatat sebelumnya. |
> | `list_ijin` punya `status` / `catatan` | Status "ditolak" ternyata **ada** (int), bukan mustahil. |
> | `login` punya `absen_timeout` | Membentuk masa berlaku konfirmasi absensi. |
>
> Rinciannya di §2.1 dan §10.

---

## 1. Transport

| | |
|---|---|
| URL | `https://presensi.bkd.jatimprov.go.id/service` |
| Method | `POST` (satu gateway untuk **semua** fungsi) |
| Content-Type | `application/json; charset=UTF-8` |
| User-Agent | `okhttp/4.12.0` (dipertahankan agar gateway tidak menolak) |
| Protokol | JSON-RPC 2.0 |

Aplikasi Android tidak memakai REST path per-fungsi. Dispatch lewat field
`object` di dalam body:

```http
POST /service HTTP/1.1
Content-Type: application/json; charset=UTF-8
User-Agent: okhttp/4.12.0

{
  "jsonrpc": 2,
  "method": "POST",
  "version": 89,
  "object": "login",
  "param": { "...": "..." }
}
```

### Envelope

| Field | Tipe | Keterangan |
|---|---|---|
| `jsonrpc` | `2` | konstanta |
| `method` | `"POST"` | konstanta |
| `version` | number | **89** (lihat §5) |
| `object` | string | nama RPC, hanya **16** yang valid (lihat §2) |
| `param` | object | payload + field yang disuntik interceptor |

> Field `filter` pernah ada di `UploadPhotoRequestBody` era v78, tetapi pada
> v89 server mengabaikannya sepenuhnya — sudah dihapus dari proxy.

Field yang **selalu** ada di dalam `param` (disuntik
`RestServices.insertAuthorizationInterceptor`):

```
api_key      : token sesi hasil object "login"
last_latlong : "<lat>,<long>" cache koordinat terakhir
imei         : androidId perangkat
```

Object `login` satu-satunya yang **tidak** memakai `api_key` dan menambah
`latlong` (bukan `last_latlong`).

> ### Device binding — bisa aktif per akun, dan bisa dilepas server
>
> ⚠️ Gate `402` ("User already registered with other device") **pernah
> terbukti nyata** pada 2026-09-28 pukul 00:10 WIB, lalu **hilang** pada
> pukul 02:00 WIB — tanpa ada interaksi dari sisi kita. Urutannya:
>
> | Waktu | NIP `200011082023081001` | Bukti |
> |---|---|---|
> | 00:10 | **Selalu 402** | 7 percobaan: UUID acak, `""`, `null`, `0`, `" "`, `[]`, `imei` dihilangkan |
> | 00:10 | Password benar maupun salah sama-sama 402 | `login` bukan oracle password saat terkunci |
> | 02:00 | **Sukses** | 10 percobaan beruntun dengan UUID acak berbeda, semua OK |
>
> Kesimpulannya: `imei` adalah pengikat perangkat yang **dapat aktif atau
> dilepas oleh administrator** kapan saja, dan statusnya bisa berbeda
> antar akun pada waktu yang sama. Dua akun yang diuji pada 00:10 punya
> status berbeda: `200308062025101001` bebas, `200011082023081001` terkunci.
>
> Sifat gate saat aktif, semuanya terverifikasi:
>
> 1. **Dicek sebelum password divalidasi** — password benar maupun salah
>    sama-sama dijawab 402.
> 2. **Tidak bisa dilewati** — `""`, `null`, `0`, `" "`, `[]`, dan UUID acak
>    semuanya ditolak. Menghilangkan `imei` memberi `-32602 Invalid params`,
>    jadi field-nya wajib ada, bukan opsional.
> 3. **Tidak ada endpoint untuk melepas atau memindahkan binding** —
>    2.378 nama kandidat dari string-pool semuanya `-32601`.
> 4. **Satu-satunya solusi adalah IMEI yang benar** — androidId perangkat
>    yang dipakai saat pendaftaran pertama.
>
> Implementasi web karena itu selalu menyediakan kolom **IMEI Perangkat** di
> form login Beranda (bisa dibuka manual, dan otomatis muncul begitu server
> membalas 402). Nilainya disimpan di `sessionStorage` — bukan rahasia,
> hanya pengenal perangkat — lalu disuntik ke setiap panggilan berikutnya
> lewat `config.imei`, persis seperti `api_key`.

### Balasan

```jsonc
{
  "jsonrpc": "2.0",
  "id_req": "<request id>",
  "result": { /* ... */ },
  "total": 0,   // hanya pada history_absen & list_ijin
  "page": 1,    // hanya pada history_absen & list_ijin
  "view": "..." // hanya pada list_ijin
}
```

> **Kegagalan bisnis tidak memakai HTTP error.** `result` bernilai `null`
> beserta `message` di dalamnya, atau `result: { absen: false, message }`.
> Yang tetap memakai HTTP error hanya hal yang tidak lolos validasi
> (lihat §6).

---

## 2. Daftar object (16, semuanya terverifikasi)

| # | object | kelompok | param wajib selain base |
|---|---|---|---|
| 1 | `login` | Autentikasi | `email`, `password`, `latlong` |
| 2 | `logout` | Autentikasi | — |
| 3 | `getworkcode` | Data referensi | — |
| 4 | `getlokasiabsen` | Data referensi | — |
| 5 | `getmastertipeijin` | Data referensi | — |
| 6 | `jenis_ijin` | Data referensi | `absen`, `master_tipe_ijin` |
| 7 | `tipe_ijin` | Data referensi | — |
| 8 | `syncdata` | Data referensi | — |
| 9 | `cekabsen` | Absensi | `checktype`, `iswfh`, `work_code` |
| 10 | `absen` | Absensi | `checktype`, `ijin`, `iswfh`, `keterangan`, `type_ijin`, `work_code` |
| 11 | `history_absen` | Absensi | `tgl`, `page`, `limit` |
| 12 | `add_ijin` | Perizinan | `tgl_ijin`, `tgl_ijin_sampai`, `alasan`, `jenis_ijin`, `tipe_ijin` |
| 13 | `list_ijin` | Perizinan | `page`, `limit` |
| 14 | `delete_ijin` | Perizinan | `id` |
| 15 | `update_foto` | Profil | `image`, `image64`, `vektor` |
| 16 | `update_profil` | Profil | `password_lama`, `password` |

`jenis_ijin` (#6) dan `tipe_ijin` (#7) **tidak ada** di era v78 — keduanya
muncul bersamaan dengan naiknya versi, dan itulah alasan `absen` sekarang
menerima `ijin`, `type_ijin`, dan `keterangan` di samping param absensi.

`getmastertipeijin` (#5) ternyata **bukan** katalog jenis izin, melainkan
pengelompokan dua tingkat. Katalog sebenarnya ada di `jenis_ijin` (#6).
Asumsi v78 yang salah inilah yang membuat formulir perizinan lama menaruh
master di `select` datar.

### 2.1 `POST /service/importfile` — endpoint multipart

Satu-satunya path yang dipakai APK selain `/service` sendiri. **Bukan
JSON-RPC**, jadi tidak bisa ditemukan lewat probe nama object — hanya
decompilasi yang menyingkapnya (`PerizinanFragment.uploadImage()` dan
`AbsenIjinFragment` memanggil `VolleyMultipartRequest` ke
`server + "/importfile"`).

⚠️ URL-nya `/service/importfile`, **bukan** `/importfile`: nilai `SERVER`
di SharedPreferences sudah memuat `/service`, lalu path-nya ditambahkan di
belakangnya. Petunjuk pendukung: `UploadPhotoService` memakai
`@POST("../service")` dengan baseUrl `server + "/"`.

```
POST https://presensi.bkd.jatimprov.go.id/service/importfile
Content-Type: multipart/form-data; boundary=…

  api_key      = <token sesi>
  id           = <id izin dari add_ijin>
  last_latlong = ""          ← sengaja kosong di aplikasi
  type         = "ijin"
  image        = berkas       ← part bernama "image", JPG atau PDF
```

Method-nya `POST` (konstanta `Request.Method.POST` = 1 di
`VolleyMultipartRequest$uploadImage$multipartRequest$1`). Balasan dibaca
`response.get("result")` lalu `result.url` dan `result.message` — bentuknya
sama persis dengan balasan `update_foto`.

#### Bentuk persisnya belum diterima gateway

Path-nya **terbukti ada** (perbandingan dengan path yang dikarang):

| Path | Hasil |
|---|---|
| `/service` | JSON-RPC normal (`-32602` untuk `api_key` palsu) |
| `/service/totallyfake` | **404** HTML |
| `/importfile` | **404** HTML |
| **`/service/importfile`** | **200** + JSON-RPC `-32605 Invalid Request` |

Jadi path-nya memang hidup — hanya bentuk request-nya yang belum ketemu.
Seluruh variasi berikut **semuanya** dijawab `-32605` yang sama, tanpa
perbedaan sama sekali:

- multipart: 5 field lengkap (`api_key`, `id`, `last_latlong`, `type`, `image`)
- multipart: tanpa `type` · tanpa `id` · tanpa `image` · tanpa field apa pun
- multipart: nama part `file` alih-alih `image`
- JSON: envelope `object: "importfile"` (di `/service` → `-32601`)
- JSON: body datar `{api_key, id, type, image64}`
- tanpa body sama sekali

`-32605` belum pernah muncul di tabel §6, jadi ini kemungkinan pemeriksa
layanan lain (bukan JSON-RPC dispatcher) yang menjawab. Dua kemungkinan:
`_FILES`/auth di reverse proxy menolak sebelum router, atau memang
dimatikan di sisi server. **Belum terverifikasi** — perlu `api_key` sesi
nyata untuk menyingkirkan kemungkinan kedua.

Konsekuensi di panel web: lampiran izin **tidak lagi dikirim sebagai
base64 di dalam `add_ijin`** (yang menghasilkan file 0 byte), melainkan
dicoba unggah ke sini memakai `id` izin yang baru dibuat. Bila gateway
tetap menolak, pengajuan izin tetap tercatat dan hanya lampirannya yang
gagal — UI melaporkan keduanya secara terpisah.

### Yang TIDAK ada di server (dan akibatnya di UI)

| Kemampuan | Status | Dampak di aplikasi |
|---|---|---|
| Setujui / tolak izin | `approve_ijin` & `ijin_bawahan` → `-32601` | Menu **Persetujuan Izin dihapus**; hanya `delete_ijin` yang bisa |
| Tambah / pindah / hapus titik absen | tidak ada object; 2.378 kandidat → `-32601` | Peta Leaflet + titik lokal di peramban; juga jadi sumber `last_latlong` |
| Hitung vektor wajah | model FaceNet hanya di dalam APK | Foto profil bisa diunggah, tapi `vektor` tidak bisa dihitung dari peramban |
| Nama/jabatan dari endpoint lain | sudah ada di `login` | Tidak perlu workaround |
| Riwayat dari panel web lama | butuh cookie sesi (login CAPTCHA) | **Tidak diintegrasikan** — lihat catatan di bawah |

> ⚠️ **Dua baris tabel versi sebelumnya sudah usang dan dihapus:**
> "Unggah foto profil → tidak mungkin" (§8) dan "Status penolakan izin →
> `approval` hanya boolean". Keduanya salah; masing-masing sudah
> diimplementasikan. Lihat §10.

> Panel web lama (`/index.php/checkinout`, `/index.php/perizinan`,
> `/index.php/laporan/resumeAjax`) memang punya kolom yang lebih kaya —
> `Imei`, `Kode Kerja`, `WFH/WFO`, `Selisih waktu`, `Catatan`, `Berkas` —
> dan tabelnya bisa difilter per NIP/pegawai/departemen. Tapi setiap
> halamannya hanya bisa dibaca setelah login melalui form yang memuat
> **CAPTCHA**. Tidak ada endpoint JSON, dan cookie sesinya tidak dapat
> diperoleh tanpa melewati CAPTCHA tersebut. Karena itu panel lama tidak
> dipakai sebagai sumber data: aplikasinya tetap memakai `history_absen` +
> `list_ijin` yang sudah terverifikasi.

### Object yang TIDAK ada (dibalas `-32601`)

`presensi`, `laporan`, `approve_ijin`, `ijin_bawahan`, `history_ijin`,
`history_ijin_bawahan`, `ijin_absen`, `absen_ijin`, `cek_tipe`,
`upload_photo`, `upload_wajah`, `setybdet`, dan ~2.370 nama lain dari
string-pool APK.

Konsekuensi yang terasa di UI:

- **Laporan "Rekap"** adalah agregasi lokal di atas `history_absen`.
- **Persetujuan izin** hanya baca + `delete_ijin`. Tidak ada endpoint
  setujui/tolak, jadi approve harus lewat aplikasi resmi atau admin server.
- **Sakelar verifikasi wajah** tidak bisa ditampilkan — `setybdet` sudah
  dihapus. (Field `using_wajah` sendiri **ada** di balasan `login`; yang
  hilang hanya endpoint untuk menyalakannya.)

> Decompilasi v89 menguatkan kesimpulan di atas: `add_ijin` hanya dipanggil
> dari `PerizinanFragment.submitIjin()`, dan tidak ada satu pun panggilan
> approve/tolak di seluruh 2.992 class. Modul Admin di aplikasi punya
> layar "izin bawahan", tapi itu hanya `list_ijin` biasa — tombol
> "Daftar Bawahan"-nya justru kosong (`toListBawahan()` tidak melakukan
> apa-apa). Jadi tidak ada endpoint yang hilang dari daftar di sini.

---

## 3. Bentuk balasan (disalin dari respons live)

### `login`

⚠️ Koreksi penting terhadap versi dokumen sebelumnya: **`login` mengirim profil
pegawai yang lengkap**, bukan hanya token sesi. Balasan live (dipotong di
field `api_key`):

```jsonc
{
  "message": "sukses login",
  "api_key": "…",
  "pegawai_id": 113866,
  "user_id": 98241,
  "departemen_id": 34379,
  "group_id": 2,
  "group_name": "pegawai",
  "nama": "RAYHAN ALIF DARMAWAN S.Tr.I.P",
  "jabatan": "Analis Sumber Daya Manusia Aparatur Ahli Pertama (III/a)",
  "departemen": "SUB BAGIAN UMUM DAN KEPEGAWAIAN",
  "logo_departemen": "https://presensi.bkd.jatimprov.go.id/images/jatim.png",
  "upload_wajah": 1,
  "allow_wfh": 1,
  "foto_profile": "https://presensi.bkd.jatimprov.go.id/uploads/foto_profil/…",
  "vektor_profile": "",
  "vektor_approved": 0,
  "home": 1,
  "presensi": 1,
  "perizinan": 1,
  "laporan": 1,
  "label_wfh": "WFH"
}
```

Empat field modul (`home`, `presensi`, `perizinan`, `laporan`) adalah gating
server per pegawai — `0` berarti modul itu tidak boleh dibuka. Ini terpisah
dari hak akses lokal aplikasi (Firestore).

Yang **benar-benar tidak** ada di `login`: `instansi`, `kode_instansi`,
`kode_unor`, dan `id_lokasi`. Tidak ada endpoint profil lain untuk
mengambilnya, jadi keempatnya kosong di UI.

`foto_profile` perlu diperiksa sebelum dipakai: `update_foto` membentuk nama
berkas dari nilai `image` yang dikirim, dan `image` kosong menghasilkan URL
yang diakhiri tanda hubung dengan file 0 byte. `fotoProfileValid()` di
`src/lib/viewModels.ts` membuang URL seperti itu agar `<img>` tidak rusak.

`rpcLengkapiProfil` tidak lagi dibutuhkan sebagai pengambil nama — `login`
sudah menyediakannya. Fungsi itu dipertahankan sebagai fallback yang hanya
dipanggil bila `nama` kosong (mis. akun dengan data server belum lengkap),
dengan urutan `list_ijin` page 1 limit 1 lalu `history_absen` hari ini.

### `cekabsen`

```jsonc
{ "absen": true,  "message": "anda terlambat 16 jam 26 menit 8 detik, lanjutkan presensi ?", "kode": "Datang" }
{ "absen": false, "message": "Tidak diperbolehkan melakukan absensi saat ini." }
```

`message` bisa berisi **penolakan** maupun **peringatan** (keterlambatan).
`kode` hanya muncul saat `absen: true`. Tanpa `work_code` server membalas
`{absen: false, message: "Work Kode wajib dipilih"}`.

### `getworkcode`

```jsonc
[
  {
    "id": 12,
    "nama": "Senin",
    "hari": {
      "nama": "Minggu",              // ⚠️ tidak konsisten, jangan dipakai
      "jam": {
        "jam_masuk_awal": "06:30:00",
        "jam_masuk":      "07:00:00",
        "jam_keluar":     "15:00:00",
        "jam_keluar_akhir":"17:00:00"
      }
    }
  }
]
```

Jam bersarang **tiga tingkat** (`[].hari.jam.jam_masuk`). Nilai `hari.nama`
tidak bisa dipercaya untuk memilih hari — beberapa work code bahkan
bernama `(EVENT) …` untuk hari yang sama.

### `getlokasiabsen`

```jsonc
[{ "tipe": "default", "id": 159, "data": "SUB BAGIAN UMUM DAN KEPEGAWAIAN",
   "latlong": "-7.29007,112.703", "lokasi": "BADAN KESATUAN BANGSA DAN POLITIK",
   "radius": 100, "deskripsi": "… Lokasi Satuan Kerja", "prioritas": 1 }]
```

Koordinat datang sebagai **satu string** `latlong`, bukan dua field terpisah.

### `getmastertipeijin`

```jsonc
[{ "Id": 1, "Nama": "Izin", "Tipe": [1, 2, 3] }]
```

Dua tingkat: `Id`/`Nama` adalah kelompok, `Tipe` berisi id `tipe_ijin` yang
valid di dalam kelompok itu.

### `jenis_ijin` vs `tipe_ijin`

`jenis_ijin` → katalog datar:

```jsonc
[{ "Id": 4, "Nama": "Cuti Tahunan", "Kode": "CT", "SetengahHari": false,
   "CreatedAt": "…", "TipeId": 1, "Potongan": "0", "IsAktif": 1 }]
```

`TipeId` menunjuk ke `Id` dari `getmastertipeijin`. Param `master_tipe_ijin: 1`
menyaring katalog; `0` mengembalikan semuanya. Param `absen: 0/1` tidak
mempengaruhi hasil.

`tipe_ijin` → peta datar id → label, termasuk placeholder `""`:

```jsonc
{ "1": "ijin penuh", "2": "Ijin Tidak Absen Masuk", "3": "Ijin Tidak Absen Pulang" }
```

### `history_absen`

```jsonc
[{ "nama": "…", "departemen": "…", "jarak": "12,509,838",
   "checktype": "Datang", "approval": true, "approval_text": "Disetujui",
   "waktu": "2026-09-27 23:31:24" }]
```

⚠️ **Satu baris per PUKULAN, bukan per hari** — satu baris "Datang", satu
baris "Pulang". Envelope `total` bisa bohong (`total: 0` dengan 1 baris),
jadi andalkan isi `result`, bukan `total`.

Tidak ada kolom status, NIP, jam masuk, atau jam keluar. Keterlambatan harus
dihitung lokal terhadap `jam_masuk_awal` work code.

### `list_ijin`

```jsonc
[{ "id": 174338988, "approval": true, "approval_at": "2026-09-28 08:10:00",
   "email": "20030806…", "nama": "…", "departemen": "…",
   "tipe_ijin": 1, "tipe_ijin_text": "ijin penuh",
   "jenis_ijin": 4, "jenis_ijin_text": "Cuti Tahunan",
   "master_jenis_ijin": 1,
   "tgl_ijin": "09 September 2026  s/d  09 September 2026",
   "tgl_ijin_dari": "09 September 2026", "tgl_ijin_sampai": "09 September 2026",
   "alasan": "…", "berkas": "", "created_at": "2026-09-14 09:42:04" }]
```

Catatan penting:

- **Tidak ada filter apa pun** — hanya `page` + `limit`. Penyaringan tanggal,
  status, dan pegawai harus di sisi klien.
- **NIP ada di field `email`.**
- **`status` (int) ada selain `approval` (boolean)** — 1 disetujui,
  2 menunggu, 3 ditolak. Diff §10.5. Implementasi web memakai `status`
  bila dikirim, dan jatuh ke `approval` bila tidak.
- `catatan`, `updated_at`, `updated_user`, `pegawai_id`, dan `user_id`
  juga dibaca aplikasi v89 (§10.1); `catatan` ditampilkan di riwayat izin.
- Tanggal izin diformat bahasa Indonesia (`09 September 2026`), sedangkan
  `history_absen` memakai ISO penuh — `tanggalKeIso()` di
  `src/lib/viewModels.ts` menormalkan keduanya.
- `berkas` diisi oleh `POST /importfile` (§2.1), bukan oleh `add_ijin`.

### `absen` / `add_ijin` / `delete_ijin` / `syncdata`

```jsonc
{ "absen": true, "id": 174338988, "pegawai_id": 113866, "nama": "…",
  "departemen": "…", "message": "…" }
{ "code": 1, "message": "sukses memperbarui data" }
```

---

## 4. Semantik nilai absensi

### `checktype`

| Nilai | Arti | Catatan |
|---|---|---|
| `1` | Datang | |
| `2` | Pulang | |
| `3` | Absen siang | **hanya pukul 12:00 – 13:00** |

Nilai lain (termasuk `0` dan `99`) ditolak dengan
`"Tidak diperbolehkan melakukan absensi saat ini."`.

### `iswfh`

Boolean Work-From-Home. **Hanya boleh diaktifkan hari Jumat** — server
menolak di luar hari itu.

### `type_ijin`

Dipakai bersama `absen` ketika `ijin: 1`. Nilainya 1/2/3, sama dengan kunci
peta `tipe_ijin`.

### `mock`

`1` bila koordinat berasal dari lokasi simulasi. Nilainya ditentukan
aplikasi dari `Location.isMock()` / `isFromMockProvider()` — jadi ini
**pernyataan klien**, bukan hasil pemeriksaan server, dan tidak ada di
`cekabsen`. Panel web selalu mengirim `0` karena koordinatnya berasal dari
titik peta, bukan GPS.

### Foto & vektor wajah

`absen` **tidak punya** parameter foto maupun vektor wajah pada v89.
Enam parameternya hanya: `checktype`, `work_code`, `iswfh`, `ijin`,
`keterangan`, `type_ijin`, ditambah koordinat dan `mock`. Verifikasi wajah
justru berjalan penuh di perangkat (§8) dan vektor terdaftar dikirim lewat
`update_foto`, bukan lewat `absen` (§10.3).

### `absen_timeout`

Berasal dari `login`, satuan **milidetik** (default aplikasi 300.000).
Menentukan masa berlaku konfirmasi setelah `cekabsen` membalas peringatan —
setelah itu `absen` ditolak. Diperlakukan sebagai hitung mundur di dialog
konfirmasi Presensi, dengan tombol Kirim dinonaktifkan saat kedaluwarsa.

---

## 5. Gate versi

| `version` | Hasil |
|---|---|
| 78, 80 | Endpoint data **jawab normal**, tapi `absen` / `cekabsen` / `add_ijin` membalas `{"absen": false, "message": "aplikasi terbaru telah tersedia, harp update untuk melakukan absen"}` |
| 81, 85, **89** | Lolos penuh |

`89` = versionCode APK resmi, jadi tidak ada versi yang perlu dinaikkan. Gate ini
bersifat **lunak**: tidak menolak koneksi, hanya memblokir tiga endpoint
tersebut.

---

## 6. Kode error sebagai oracle

| Kode / HTTP | Makna | Dipakai untuk |
|---|---|---|
| `-32601 Object not found` | Nama object tidak dikenal | Menentukan apakah object benar-benar ada |
| `-32602 Invalid params` | Object ada, bentuk param salah | **Memakai ini untuk memverifikasi param wajib** |
| `-32604 InvalidToken {expired: true}` | Bentuk param OK, `api_key` hilang/salah | Penanda bahwa bentuk sudah benar |
| HTTP `401 Invalid Nip` | `email` bukan NIP | Validasi field `login` |
| HTTP `402` | Akun terkunci ke perangkat lain (`imei` tidak cocok) | Memicu kolom IMEI di UI |
| HTTP `500` | `work_code` non-numerik | Validasi tipe `work_code` |
| `result: null` | Kegagalan bisnis, bukan error protokol | Pesan penolakan normal |

Server **mengabaikan key `param` yang tidak dikenal** — superset 29.394
kandidat dari string-pool APK diterima tanpa error. Ini yang membuat
`-32602` bisa dipakai sebagai oracle: `-32602` berarti ada yang **wajib
hilang**, bukan ada yang **dilebihkan**.

### Cara memverifikasi daftar param wajib

1. Kirim hanya param base (`api_key`, `last_latlong`, `imei`) → catat hasil.
2. Kirim kandidat superset yang jauh lebih besar → hasil **tetap sama**, jadi
   key yang ditambahkan tidak wajib.
3. Kurangi superset secara biner (delta debugging) sampai saat menghapus
   masing-masing key membuat server berubah dari "ok" menjadi `-32602` atau
   pesan bisnis baru. Key yang hilang pada titik itu adalah **wajib**.

Contoh: `absen` butuh 6 key. Menghapus satu saja (mis. `keterangan`)
menghasilkan `-32602`, jadi keenamnya wajib meski `ijin` = 0.

---

## 7. Metode verifikasi

Dua tahap — probe black-box dulu, decompilasi penuh menyusul (28 Sep 2026).

### Tahap 1 — probe black-box (2026-09-27)

Waktu itu jadx belum tersedia dan RAM mesin ~3 GB, sehingga:

1. **Ekstraksi string-pool DEX** dengan parser DEX khusus
   (`/tmp/opencode/dexstr.py`) — pool itu berisi ~29.394 nama key kandidat.
2. **Diff antar versi** (v78 vs v89) untuk melihat key yang baru muncul.
3. **Probe langsung** tiap nama object ke gateway dengan akun NIP nyata.
4. **Delta debugging** atas key param memakai kode error §6 sebagai oracle.

Hasilnya: 16 object valid, sisanya `-32601`.

### Tahap 2 — decompilasi `classes4.dex` (2026-09-28)

XAPK dipecah, lalu `dev.pti.bkdattendance.apk` (105 MB, 5 dex) di-decompile
dengan jadx 1.5.0. Semua kode aplikasi ternyata hanya ada di **`classes4.dex`**
(2.992 class; 4 dex lain murni library), jadi cukup mendekompilasi satu
berkas itu — bukan 105 MB. Sumber daya di-decode terpisah dengan
`apktool -r`.

Semua klaim §2.1, §10, dan koreksi di §8 diturunkan dari sini: nama object
diambil dari `const-string` tepat sebelum `arrayMap.put("object", …)`, dan
bentuk param dari urutan `jSONObject.accumulate(...)` di kelas yang sama.

---

## 8. Batasan yang belum terpecahkan (terbuka)

> ⚠️ Dua sub-bagian di bawah sudah **selesai** pada revisi 2026-09-28 dan
> dipindahkan ke §10. Yang tersisa hanya "Koordinat absen", "Vektor wajah",
> dan "Panel web lama".

### ~~`update_profil` — nama key password baru belum terverifikasi~~ → §10.4

### ~~`update_foto` — binary tidak bisa dikirim~~ → §10.3

Kedua kesimpulan lama ini terbukti salah oleh decompilasi.

### Koordinat absen bukan milik server

`absen` dan `cekabsen` menerima `last_latlong` sebagai teks `"<lat>,<long>"`.
Tidak ada endpoint yang mengubah atau mengunci koordinat — server hanya
mencatat apa yang dikirim. Aplikasi web karena itu tidak memakai GPS sama
sekali: pengguna memilih titik di peta Leaflet (klik untuk menambah, geser
untuk menyetel) dan titik itulah yang dikirim sebagai `last_latlong`.
Tidak ada permintaan izin lokasi ke peramban.

Ini pilihan klien, bukan wewenang server: hasil absen tetap dihitung dari
koordinat yang Anda kirim, dan titik yang menentukan geofence tetap titik
milik server.

### `absen` — verifikasi wajah tidak bisa dihitung di peramban

Object `absen` v89 memang tidak punya param `foto`/`vektor` (§4), jadi
penilaian kecocokan wajah tidak bisa direplikasi. Tapi bukan karena
server tidak bisa — melainkan karena **seluruhnya berjalan di perangkat**:
aplikasi menghitung embedding dengan FaceNet di HP, membandingkannya
dengan `vektor_profile` dari `login`, lalu mengirim vektor terdaftar lewat
`update_foto`. Tidak ada endpoint terpisah; `checktype` 3 (absen siang)
adalah satu-satunya jenis absensi tambahan.

### Panel web lama — tetap tidak diintegrasikan

Butuh cookie sesi yang hanya didapat lewat form ber-CAPTCHA, sehingga tetap
dipakai `history_absen` + `list_ijin` yang sudah terverifikasi.

---

## 9. Ringkasan perubahan dari versi dokumen sebelumnya

| Aspek | v78 (dokumen lama) | v89 (dokumen ini) |
|---|---|---|
| Object valid | 14| **16** (`jenis_ijin`, `tipe_ijin` baru)|
| `version` | 81 (dinaikkan)| **89** (native)|
| Device binding | dianggap sudah dihapus | **aktif per akun** (§1)|
| Param `absen` | belum terverifikasi | 6 param terverifikasi |
| Param `cekabsen` | belum terverifikasi | `checktype` + `iswfh` + `work_code` |
| Field `filter` | ada | dihapus |
| `getmastertipeijin` | dianggap katalog jenis izin | pengelompokan dua tingkat |
| Sumber katalog izin | `getmastertipeijin` | `jenis_ijin` + `tipe_ijin` |
| `history_absen` | dianggap satu baris per hari | **satu baris per pukulan** |
| Unggah foto | "base64 ke `update_foto`" | `image64` + `vektor` (§10.3) |
| Key password baru | tidak diketahui | `password` saja, tanpa `konfirmasi_password` (§10.4) |
| Lampiran izin | dianggap mustahil | `POST /importfile` (§2.1) |
| Metode | probe black-box | + decompilasi `classes4.dex` (§7) |

> Baris "Status izin" versi dokumen ini pernah menulis `status` int =
> "hanya `approval` boolean". Itu **salah** — `status` (int) ada dan dibaca
> aplikasi v89; lihat §10.5.

---

## 10. Koreksi hasil decompilasi (2026-09-28)

Lima koreksi berikut membatalkan kesimpulan lama. Semuanya diturunkan dari
kelas di `classes4.dex`; nama file dan baris merujuk ke hasil jadx.

### 10.1 Field yang tidak tercatat sebelumnya

| Object | Field | Sumber | Fungsi |
|---|---|---|---|
| `login` | `absen_timeout` | `LoginActivity.lambda$loginProcess$4` | Masa berlaku konfirmasi absensi, ms. Default aplikasi 300.000 (5 menit) di `HomeVM.pendingTimeoutMillis()`. |
| `absen` | `mock` | `HomeFragment.ProsesAbsen` | 1 bila `Location.isMock()` atau `isFromMockProvider()`. Pernyataan client, bukan pemeriksaan server. |
| `list_ijin` | `status` | `ListIjinBawahanFragment.parseIjinLists` | int: 1 disetujui, 2 menunggu, 3 ditolak. |
| `list_ijin` | `catatan` | idem | Catatan atasan. |
| `list_ijin` | `updated_at`, `updated_user` | idem | Jejak perubahan oleh atasan. |
| `list_ijin` | `pegawai_id`, `user_id` | idem | Dasar penyaringan "izin bawahan". |
| `add_ijin` | `id` | `PerizinanFragment.submitIjin` | Dikirim apa adanya (string kosong saat membuat baru). |
| `jenis_ijin` | `absen: 0/1` | `ApproveIjinFragment.approveIjin` | 1 = batasi ke jenis izin yang relevan untuk absensi. Tidak mempengaruhi hasil. |

### 10.2 `filter` di envelope — dihapus dari APK, bukan dari server

`UploadPhotoRequestBody` masih punya field `filter`, dan `login` /
`add_ijin` masih mengirimkannya (`filter: 1`). Tapi interceptor
`RestServices.insertAuthorizationInterceptor$lambda$4` tidak pernah
menyisipkannya, dan verifikasi live menunjukkan server mengabaikannya
sama sekali. Field itu sisa era v78 — sama seperti `version` yang dulu
78 dan sekarang 89.

### 10.3 `update_foto` — unggahan foto profil **bisa** lewat JSON

Kesimpulan lama ("binary tidak bisa dikirim") arose karena hanya param
`image` yang dicoba, dan itu memang dibaca server sebagai **nama file**,
bukan isi. Tapi `UploadPhotoViewModel.uploadPhoto()` mengirim tiga key
sekaligus:

```ts
api_key : <token sesi>
image   : "foto.png"              // nama berkas, konstan
image64 : <base64 isi berkas>     // ← inilah yang sebenarnya tersimpan
vektor  : "0.12,-0.44,…"          // embedding wajah, opsional
```

Jadi unggahan foto profil **tidak** butuh multipart sama sekali. Konsekuensi
di panel web: menu "Ubah Foto" yang tadinya dihapus karena dianggap mustahil
kini ada, mengirim base64 lewat `image64` dan membaca `result.url` dari
balasan untuk memperbarui foto di header.

Bagian yang tetap tidak bisa: menghitung `vektor`. Face recognition di
aplikasi berjalan penuh di perangkat (FaceNet `facenet_512.tflite` +
model spoof `spoof_model_*.tflite`, assets di dalam APK), dan vektor
hanya dibandingkan lokal terhadap `vektor_profile` dari `login`.

### 10.4 `update_profil` — hanya dua key

`ProfileFragment` mengirim tepat:

```ts
api_key, password_lama, password
```

Key `konfirmasi_password` yang ditebak versi terdahulu **tidak ada** —
konfirmasi hanya dibandingkan di sisi klien sebelum request, termasuk
pemeriksaan kebijakan (≥ 8 karakter, huruf besar, angka, karakter
spesial). `password_lama` tetap terverifikasi live: salah →
`{result: false, message: "password lama tidak sesuai"}`.

### 10.5 Status izin — "ditolak" itu ada

Dokumen sebelumnya menyatakan `approval` hanya boolean sehingga izin yang
ditolak tidak dapat dibedakan dari yang menunggu. Betul bahwa `approval`
sendiri boolean, tapi `list_ijin` juga mengirim `status` (int) yang dibaca
`ListIjinBawahanFragment`: 1 = disetujui, 2 = menunggu, 3 = ditolak.
Ditambah `catatan` untuk keterangan penolakan.

Karena belum diverifikasi apakah server *selalu* mengirim `status`,
`toIjinView` memakainya bila ada (> 0) dan jatuh ke `approval` sebagai
cadangan. Konsekuensinya panel web sekarang punya filter **"Ditolak"** dan
kolom catatan pada tabel riwayat izin.

### 10.6 Modul Admin di aplikasi — sebagian kosong

Sebagai efek samping decompilasi, catat bahwa sebagian layar admin di
aplikasi resmi memang tidak berfungsi, sehingga tidak ada endpoint yang
"hilang" untuk ditiru:

| Layar | Kenyataan |
|---|---|
| Admin → "Daftar Bawahan" | `toListBawahan()` hanya `Log.i(...)`, tidak terjadi apa-apa. |
| Admin → "Atur Izin" | `AdminFragment.toAturIjin()` membuka `ListIjinBawahanFragment` (fragment 8), yang memakai `list_ijin` biasa. |
| `ApproveIjinFragment` | Meskipun namanya begitu, tidak memanggil endpoint approve apa pun — hanya `jenis_ijin` untuk mengisi dropdown. Seluruh 2.992 class tidak memuat satu pun pemanggilan approve/tolak. |
| Mengubah peran / flag modul | Tidak ada endpoint; `update_profil` hanya ganti password. |

---

## 11. Endpoint milik PRABAWA sendiri (bukan server pusat)

Bagian 1–10 di atas semuanya tentang `presensi.bkd.jatimprov.go.id` — kontrak
dari server pusat. Yang di bawah ini endpoint yang kita Exposure sendiri, dan
semuanya **tidak pernah** menyentuh server pusat secara langsung.

| Endpoint | Env | Gunanya |
| --- | --- | --- |
| `POST /api/rpc` | `PRESENSI_BASE_URL`, `ALLOWED_ORIGINS` | Proxy JSON-RPC ke server pusat |
| `POST /api/upload` | idem | Proxy multipart lampiran izin |
| `POST /api/panel-auth` | `ALLOWED_ORIGINS`, **`PANEL_SESSION_SECRET`**, Firebase Admin | Login panel, peran, sesi, kelola akun |
| `POST /api/billing/aktivasi` | `MIDTRANS_SERVER_KEY`, Firebase Admin | Aktivasi langganan setelah verifikasi pembayaran |
| `POST /api/midtrans-charge` | `MIDTRANS_SERVER_KEY` | Mulai transaksi |
| `GET /api/midtrans-status` | `MIDTRANS_SERVER_KEY` | Status transaksi |
| `GET /api/health` | — | Diagnosa konfigurasi |

### 11.1 `POST /api/panel-auth`

Satu endpoint untuk seluruh operasi panel, ditentukan field `aksi` di body.
Satu endpoint — bukan satu per operasi — dipilih supaya "wajib periksa token"
menjadi satu aturan yang berlaku seragam, bukan sesuatu yang bisa dilupakan di
satu route saja.

Token dibaca dari `Authorization: Bearer …` (bukan query string — URL masuk log
server dan `Referer`).

| `aksi` | Akses | Field lain |
| --- | --- | --- |
| `masuk` | publik | `username`, `password` |
| `verifikasi` | token | `perbarui` (opsional) |
| `pusat:login` | akun sendiri / admin | `username`, `imei` (opsional) |
| `akun:daftar` | admin | — |
| `akun:buat` | admin | `username`, `password`, `role`, `permissions?`, `namaLengkap`, `nip?`, `catatan?` |
| `akun:ubah` | admin | `username`, plus field mana pun |
| `akun:hapus` | admin | `username` |
| `kredensial:simpan` | akun sendiri / admin | `username`, `nip`, `password`, `imei?` |
| `kredensial:ringkas` | akun sendiri / admin | `username` |
| `kredensial:hapus` | akun sendiri / admin | `username` |
| `password:ganti` | akun sendiri | `passwordLama`, `passwordBaru` |
| `admin:ubah` | admin | `passwordLama`, `usernameBaru?`, `passwordBaru?` |
| `langganan:perpanjang` | admin | `username`, `durasi`, `satuan` |
| `langganan:set-masa-akhir` | admin | `username`, `iso` |
| `langganan:set-gratis` | admin | `username`, `gratis`, `alasan?` |
| `tagihan:buat` | akun sendiri / admin | `orderId`, `username`, `paketId`, `nominal`, `metode`, `durasi`, `satuan` |
| `tagihan:status` | admin | `orderId`, `status`, `catatan?` |
| `tagihan:hapus` | admin | `orderId` |
| `billing:simpan` | admin | `nilai` (paket, QRIS, rekening, nomor WA) |
| `admin:nama` | admin | — |

#### Operasi langganan

Semuanya **server-only** dan tidak pernah punya versi peramban:
`jatim_langganan`, `jatim_tagihan`, dan `jatim_pengaturan/billing` semuanya
`write: if false` untuk klien. Fungsi yang dulu ada di `langgananFirestore.ts`
tidak bisa berhasil — hanya terlihat berhasil kalau rules yang aktif di proyek
ternyata longgar.

Aturan yang ditegakkan server, bukan UI:

- `langganan:perpanjang` **tidak** menaikkan `totalBayar`/`jumlahBayar`.
  Perpanjangan manual bukan pembayaran; menaikkannya membuat rekap keuangan
  menunjukkan uang yang tidak pernah masuk.
- Durasi dibatasi 10 tahun. Di atas itu hampir pasti salah ketik.
- `langganan:set-masa-akhir` **mem-parse** tanggalnya, jadi `masaAkhir` yang
  tersimpan selalu ISO yang bisa dibaca.
- `tagihan:buat` hanya menulis `status: 'menunggu'`. `status`, `masaAkhirSetelah`,
  dan `waktuBayar` diisi `POST /api/billing/aktivasi` setelah pembayaran
  terverifikasi — kalau klien boleh mengisi `status`, "lunas" bisa muncul
  tanpa uang masuk.
- `orderId` divalidasi ketat karena ia jadi kunci dokumen.

#### Bentuk respons

Selalu `{ ok, kode, pesan?, ... }` dengan kode HTTP yang sesuai.

| HTTP | Arti | Yang harus dilakukan klien |
| --- | --- | --- |
| `401` | Password salah / token tidak valid / akun tidak ditemukan | Tampilkan "kredensial salah" atau keluarkan sesi |
| `403` | Token sah tapi tidak cukup hak; akun dinonaktifkan | Jangan ulang; tampilkan akses ditolak |
| `409` | Konflik: username terpakai, atau ini admin terakhir | Tampilkan `pesan` apa adanya |
| `422` | Permintaan tidak valid / kredensial tidak terbaca | Tampilkan `pesan`; jangan hitung sebagai percobaan gagal |
| `429` | Terlalu banyak percobaan | Hormati `terkunci` (sisa detik) |
| `503` | Server belum dikonfigurasi | Tampilkan `pesan` — **jangan** tunggu percobaan login |

⚠️ `503` sengaja tidak disamarkan jadi `401`. Bentuk `401` sama persis dengan
"password salah", dan itu membuat orang menebak-nebak tanpa petunjuk bahwa
masalahnya ada di konfigurasi server.

#### Yang tidak pernah dikembalikan

- `passwordHash` — di aksi mana pun, termasuk `akun:daftar`.
- `passwordEncrypted` — kredensial server pusat hanya lewat
  `kredensial:ringkas`, dan yang dikirim hanya `nip`, `imei`, `terbaca`, `updatedAt`.

#### Yang tidak pernah dipercaya dari request

- **`role`** — selalu dibaca dari dokumen. Nilai di body hanya diterima kalau
  persis `'admin'` atau `'user'`; nilai lain dipaksa jadi `user`.
- **`kode`** — kode HTTP menentukan apa yang terjadi; `kode` di body diabaikan.

### 11.2 Token sesi

```
<base64url(payload)>.<base64url(HMAC-SHA256(base64url(payload), PANEL_SESSION_SECRET))>
```

Payload: `{ v, sub, role, perms, iat, exp, jti }`. Umur 30 menit — sama dengan
idle timeout di peramban.

⚠️ `role` dan `perms` di dalam token **bukan sumber kebenaran**. Token hanya
membuktikan "sesi ini diterbitkan server untuk nama ini"; peran sebenarnya
selalu dibaca ulang dari dokumen Firestore. inmersi yang diedit di DevTools
gagal tanda tangannya, dan dokumen yang diubah di luar aplikasi langsung
berlaku di verifikasi berikutnya.

### 11.3 Batas yang jujur

- **Tidak ada pencabutan token.** Sesi stateless: logout membersihkan
  penyimpanan lokal, dan token yang tertinggal tetap berlaku sampai `exp`.
  Yang benar-benar dicabut adalah aksesnya — lewat `nonaktif` atau penurunan
  peran, yang langsung berlaku di verifikasi berikutnya.
- **Pembatas percobaan per-instance.** Vercel menyalakan instance baru tiap
  kali, jadi yang tertahan adalah percobaan yang wajar, bukan serangan otomatis berskala
  besar. Rate limit platform tetap lapisan yang sesungguhnya.
- **Login ke server pusat lewat server** (aksi `pusat:login`). Ini konsekuensi
  dari memindahkan password keluar dari peramban: gateway pusat dipanggil dari
  server, jadi yang tercatat di log gateway adalah IP server, bukan milik
  pengguna.
