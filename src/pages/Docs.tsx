import { useMemo, useState } from 'react';
import {
  BookOpen,
  Copy,
  FileCode2,
  Globe,
  Layers,
  Radio,
  ShieldAlert,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useToast } from '../components/ui/Toast';
import {
  ActionButton,
  Alert,
  Badge,
  Card,
  CardTitle,
  PageHeader,
  StatTile,
} from '../components/ui/Surface';
import {
  GATE_NIP_SALAH,
  GATE_OBJECT_TIDAK_ADA,
  GATE_PARAM_SALAH,
  GATE_PERANGKAH_TERIKAT,
  PRESENSI_SERVICE_URL,
  PRESENSI_VERSION,
  PRESENSI_VERSION_NAME,
  RPC_OBJECTS,
  RPC_OBJECTS_LEGACY,
  RPC_REQUIRED_PARAMS,
  TIPE_IJIN_LABEL,
  ABSEN_CHECK_TYPE,
} from '../lib/presensiContract';
import { APP_FULL_NAME } from '../lib/appIdentity';

/**
 * Dokumentasi kontrak server pusat.
 *
 * Semua isi halaman ini berasal dari probe black-box ke
 * `presensi.bkd.jatimprov.go.id` dan pembacaan string-pool APK v89 —
 * bukan tebakan. Halaman ini menggantikan menu Admin lama: kontrak API
 * pindah ke sini, sedangkan kelola pengguna sudah ada di modal Pengaturan
 * Akun pada top bar.
 */

type Bagian = 'transport' | 'objects' | 'absensi' | 'izin' | 'referensi' | 'kode' | 'batas' | 'web';

const BAGIAN: { id: Bagian; label: string; icon: typeof Radio }[] = [
  { id: 'transport', label: 'Transport & Login', icon: Radio },
  { id: 'objects',   label: 'Daftar Object',     icon: Layers },
  { id: 'absensi',   label: 'Absensi',            icon: FileCode2 },
  { id: 'izin',      label: 'Perizinan',          icon: FileCode2 },
  { id: 'referensi', label: 'Data Referensi',     icon: Wrench },
  { id: 'kode',      label: 'Kode Error',         icon: Terminal },
  { id: 'batas',     label: 'Batasan Terbukti',   icon: ShieldAlert },
  { id: 'web',       label: 'Web Resmi',          icon: Globe },
];

export default function Docs() {
  const [bagian, setBagian] = useBagianAwal();
  const toast = useToast();

  const totalObject = Object.keys(RPC_OBJECTS).length;
  const totalParam = useMemo(
    () => Object.values(RPC_REQUIRED_PARAMS).reduce((sum, list) => sum + list.length, 0),
    []
  );

  const salin = async (teks: string, label: string) => {
    try {
      await navigator.clipboard.writeText(teks);
      toast.success(`${label} disalin ke papan klip.`);
    } catch {
      toast.error('Peramban menolak akses papan klip.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dokumentasi"
        subtitle={`Kontrak API server pusat ${APP_FULL_NAME} — hasil verifikasi langsung ke gateway produksi`}
        icon={<BookOpen className="w-5 h-5" />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Object Valid" value={totalObject} tone="emerald" hint="semuanya terverifikasi live" />
        <StatTile label="Param Wajib" value={totalParam} tone="blue" hint="dihitung dari delta debugging" />
        <StatTile label="Versi Protokol" value={PRESENSI_VERSION} tone="violet" hint={`APK ${PRESENSI_VERSION_NAME}`} />
        <StatTile label="Object Mati" value={RPC_OBJECTS_LEGACY.length} tone="rose" hint="semua dibalas -32601" />
      </div>

      {/* ── Navigasi bagian ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/50">
        {BAGIAN.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setBagian(item.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              bagian === item.id
                ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <item.icon className="w-3.5 h-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {bagian === 'transport' && <Transport onCopy={salin} />}
      {bagian === 'objects' && <Objects onCopy={salin} />}
      {bagian === 'absensi' && <Absensi />}
      {bagian === 'izin' && <Izin onCopy={salin} />}
      {bagian === 'referensi' && <Referensi />}
      {bagian === 'kode' && <Kode onCopy={salin} />}
      {bagian === 'batas' && <Batas />}
      {bagian === 'web' && <WebResmi onCopy={salin} />}
    </div>
  );
}

/** Bagian awal: selalu "Transport & Login" saat halaman dimuat. */
function useBagianAwal() {
  return useState<Bagian>('transport');
}

// ═══════════════════════════════════════════════════════════════════════
//  Transport & Login
// ═══════════════════════════════════════════════════════════════════════

function Transport({ onCopy }: { onCopy: (teks: string, label: string) => void }) {
  return (
    <>
      <Card>
        <CardTitle action={<Badge tone="blue">POST · JSON-RPC 2.0</Badge>}>Transport</CardTitle>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label="URL" value={PRESENSI_SERVICE_URL} mono />
          <Row label="Method" value="POST — satu gateway untuk semua fungsi" />
          <Row label="User-Agent" value="okhttp/4.12.0 (dipertahankan agar gateway tidak menolak)" mono />
          <Row label="Content-Type" value="application/json; charset=UTF-8" mono />
          <Row label="Versi protokol" value={`version: ${PRESENSI_VERSION}`} mono />
          <Row label="Object valid" value={`${Object.keys(RPC_OBJECTS).length} nama`} />
        </dl>

        <div className="mt-4 p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Envelope</p>
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => onCopy(ENVELOPE_CONTOH, 'Envelope')}
              icon={<Copy className="w-3.5 h-3.5" />}
            >
              Salin
            </ActionButton>
          </div>
          <pre className="text-[11px] font-mono text-emerald-400 whitespace-pre-wrap break-all">
{ENVELOPE_CONTOH}
          </pre>
        </div>
      </Card>

      <Card>
        <CardTitle>Field yang selalu disuntik</CardTitle>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Ditaruh di dalam <span className="font-mono">param</span> oleh proxy untuk setiap
          panggilan, meniru{' '}
          <span className="font-mono">RestServices.insertAuthorizationInterceptor</span> di APK.
        </p>
        <dl className="grid grid-cols-1 gap-2.5">
          <Row label="api_key" value="token sesi dari object login" mono />
          <Row label="last_latlong" value='"<lat>,<long>" koordinat titik yang dipilih di peta' mono />
          <Row label="imei" value="androidId perangkat — WAJIB ada di login" mono />
        </dl>

        <Alert tone="amber">
              <span className="font-mono">imei</span> mengikat akun ke perangkat dan gate{' '}
              <span className="font-mono">{GATE_PERANGKAH_TERIKAT}</span> itu nyata tapi bisa aktif
              atau dilepas server kapan saja — statusnya berbeda antar akun, bahkan berubah di tengah
              hari. Saat aktif, semua nilai <span className="font-mono">imei</span> ditolak dan
              satu-satunya jalan adalah androidId perangkat yang benar. Menghilangkannya memberi{' '}
              <span className="font-mono">-32602</span>.
        </Alert>
      </Card>

      <Card>
        <CardTitle>Balasan <span className="font-mono">login</span></CardTitle>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          <span className="font-mono">login</span> mengirim profil pegawai lengkap, bukan hanya token
          sesi. Yang benar-benar tidak ada: <span className="font-mono">instansi</span>,{' '}
          <span className="font-mono">kode_instansi</span>, <span className="font-mono">kode_unor</span>,
          dan <span className="font-mono">id_lokasi</span>.
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700">
          <pre className="text-[11px] font-mono text-amber-300 whitespace-pre-wrap break-all">
{BALASAN_LOGIN}
          </pre>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="blue">home · presensi · perizinan · laporan = gating server</Badge>
          <Badge tone="violet">upload_wajah · allow_wfh · vektor_approved</Badge>
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Daftar object
// ═══════════════════════════════════════════════════════════════════════

function Objects({ onCopy }: { onCopy: (teks: string, label: string) => void }) {
  const baris = useMemo(
    () =>
      Object.entries(RPC_OBJECTS).map(([, nama]) => ({
        nama,
        param: RPC_REQUIRED_PARAMS[nama] ?? [],
      })),
    []
  );

  const csv = useMemo(
    () => ['object,param_wajib', ...baris.map(item => `${item.nama},"${item.param.join(', ')}"`)].join('\n'),
    [baris]
  );

  return (
    <>
      <Card>
        <CardTitle
          action={
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => onCopy(csv, 'Daftar object CSV')}
              icon={<Copy className="w-3.5 h-3.5" />}
            >
              Salin CSV
            </ActionButton>
          }
        >
          {baris.length} object terverifikasi
        </CardTitle>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  object
                </th>
                <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  param wajib
                </th>
              </tr>
            </thead>
            <tbody>
              {baris.map(item => (
                <tr key={item.nama} className="border-b border-slate-100 dark:border-slate-800/60 last:border-0">
                  <td className="py-2 pr-3 font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    {item.nama}
                  </td>
                  <td className="py-2 font-mono text-slate-500 dark:text-slate-400">
                    {item.param.length === 0 ? (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    ) : (
                      item.param.join(' · ')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Alert tone="blue">
          Kolom di atas adalah param khusus tiap object; selainnya hanya{' '}
          <span className="font-mono">api_key</span>, <span className="font-mono">last_latlong</span>,
          dan <span className="font-mono">imei</span> yang selalu disuntik. Server mengabaikan key{' '}
          <span className="font-mono">param</span> yang tidak dikenal — superset 29.394 kandidat
          diterima tanpa error.
        </Alert>
      </Card>

      <Card>
        <CardTitle action={<Badge tone="violet">Non-JSON-RPC</Badge>}>
          Endpoint di luar /service
        </CardTitle>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Satu-satunya path selain <span className="font-mono">/service</span> yang dipakai APK
          v89 — ditemukan lewat decompilasi, bukan lewat probe nama object (karena ia bukan object
          JSON-RPC sama sekali):
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700">
          <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all">
{`POST /service/importfile   multipart/form-data
  api_key · id · last_latlong (kosong) · type=ijin · image`}
          </pre>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-3">
          Dipakai untuk lampiran pengajuan izin. ⚠️ Path-nya terbukti hidup (200 + JSON-RPC),
          tetapi gateway menjawab <span className="font-mono">-32605</span> untuk semua variasi
          body — lihat tab <strong>Perizinan</strong> untuk detailnya.
        </p>
      </Card>

      <Card>
        <CardTitle action={<Badge tone="rose">{RPC_OBJECTS_LEGACY.length} nama</Badge>}>
          Object yang sudah tidak ada
        </CardTitle>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Semua dijawab <span className="font-mono">-32601 Object not found</span>, termasuk 2.378
          nama lain dari string-pool APK v89. Decompilasi v89 mengonfirmasi hal ini: tidak ada
          panggilan <span className="font-mono">add_ijin</span> selain di{' '}
          <span className="font-mono">PerizinanFragment</span>, dan tidak ada endpoint approve
          sama sekali.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {RPC_OBJECTS_LEGACY.map(nama => (
            <span
              key={nama}
              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-500 dark:text-slate-400 line-through"
            >
              {nama}
            </span>
          ))}
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Absensi
// ═══════════════════════════════════════════════════════════════════════

function Absensi() {
  return (
    <>
      <Card>
        <CardTitle>Urutan absen</CardTitle>
        <ol className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
          {[
            'Pilih work code dari getworkcode — server membalas "Work Kode wajib dipilih" bila kosong.',
            'Kirim cekabsen dengan checktype, iswfh, dan work_code.',
            'Tampilkan {absen, message, kode} ke pengguna. message bisa berisi penolakan maupun peringatan keterlambatan.',
            'Baru setelah itu kirim absen dengan enam param wajibnya.',
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0">
                {index + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardTitle>checktype & iswfh</CardTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Row label="1 — Datang" value={String(ABSEN_CHECK_TYPE.DATANG)} mono />
          <Row label="2 — Pulang" value={String(ABSEN_CHECK_TYPE.PULANG)} mono />
          <Row label="3 — Absen siang" value="hanya pukul 12:00 – 13:00" mono />
        </div>
        <Alert tone="amber">
          Nilai lain (termasuk <span className="font-mono">0</span> dan{' '}
          <span className="font-mono">99</span>) ditolak dengan{' '}
          <span className="font-mono">"Tidak diperbolehkan melakukan absensi saat ini."</span>{' '}
          <span className="font-mono">iswfh</span> hanya boleh aktif hari Jumat.
        </Alert>
      </Card>

      <Card>
        <CardTitle>history_absen</CardTitle>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Satu baris per <span className="font-semibold">rekaman</span>, bukan per hari — satu baris
          &ldquo;Datang&rdquo;, satu baris &ldquo;Pulang&rdquo;. Envelope{' '}
          <span className="font-mono">total</span> bisa bohong, jadi andalkan isi{' '}
          <span className="font-mono">result</span>. Tidak ada kolom status, NIP, jam masuk, atau
          jam keluar; keterlambatan harus dihitung lokal terhadap{' '}
          <span className="font-mono">jam_masuk_awal</span> work code.
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700">
          <pre className="text-[11px] font-mono text-sky-300 whitespace-pre-wrap break-all">
{BALASAN_HISTORY}
          </pre>
        </div>
      </Card>

      <Card>
        <CardTitle>Koordinat</CardTitle>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <span className="font-mono">absen</span> dan <span className="font-mono">cekabsen</span>{' '}
          menerima <span className="font-mono">last_latlong</span> sebagai teks{' '}
          <span className="font-mono">"&lt;lat&gt;,&lt;long&gt;"</span>. Tidak ada endpoint yang
          mengubah atau mengunci koordinat — server hanya mencatat apa yang dikirim. Aplikasi web
          karena itu membiarkan pengguna memilih titik di peta dan mengirim titik itu, sehingga GPS
          tidak perlu dinyalakan.
        </p>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Perizinan
// ═══════════════════════════════════════════════════════════════════════

function Izin({ onCopy }: { onCopy: (teks: string, label: string) => void }) {
  return (
    <>
      <Card>
        <CardTitle>Tiga tingkat katalog izin</CardTitle>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <p>
            <span className="font-mono text-slate-700 dark:text-slate-200">getmastertipeijin</span>{' '}
            memberi <span className="font-semibold">kelompok</span>:{' '}
            <span className="font-mono">{'{{ Id, Nama, Tipe[] }}'}</span> — Tipe berisi id tipe
            yang valid di dalam kelompok itu.
          </p>
          <p>
            <span className="font-mono text-slate-700 dark:text-slate-200">jenis_ijin</span> memberi{' '}
            <span className="font-semibold">katalog datar</span>, dengan{' '}
            <span className="font-mono">TipeId</span> yang menunjuk ke{' '}
            <span className="font-mono">Id</span> kelompok.
          </p>
          <p>
            <span className="font-mono text-slate-700 dark:text-slate-200">tipe_ijin</span> memberi{' '}
            <span className="font-semibold">peta label</span> id tipe izin:
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          {Object.entries(TIPE_IJIN_LABEL).map(([id, label]) => (
            <div
              key={id}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono">
                {id}
              </p>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>list_ijin</CardTitle>
        <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          {[
            'Hanya menerima page + limit — tidak ada filter tanggal, status, atau pegawai.',
            'NIP ada di field email.',
            'status (int) dibaca selain approval (boolean): 1 disetujui, 2 menunggu, 3 ditolak. Ini yang membuat filter "Ditolak" bisa diisi.',
            'catatan, updated_at, updated_user, pegawai_id, dan user_id juga dibaca aplikasi v89 — dipakai untuk catatan atasan dan penyaringan izin bawahan.',
            'Tanggal izin diformat bahasa Indonesia; history_absen memakai ISO penuh.',
          ].map(item => (
            <li key={item} className="flex gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle
          action={
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => onCopy(BALASAN_LIST_IJIN, 'Contoh list_ijin')}
              icon={<Copy className="w-3.5 h-3.5" />}
            >
              Salin
            </ActionButton>
          }
        >
          Contoh baris list_ijin
        </CardTitle>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700">
          <pre className="text-[11px] font-mono text-violet-300 whitespace-pre-wrap break-all">
{BALASAN_LIST_IJIN}
          </pre>
        </div>
      </Card>

      <Card>
        <CardTitle
          action={
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => onCopy(CONTOH_IMPORTFILE, 'Contoh POST /service/importfile')}
              icon={<Copy className="w-3.5 h-3.5" />}
            >
              Salin
            </ActionButton>
          }
        >
          POST /service/importfile — lampiran izin
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Satu-satunya endpoint di luar <span className="font-mono">/service</span> itu sendiri,
          dan bukan JSON-RPC — formatnya{' '}
          <span className="font-mono">multipart/form-data</span>. Ditemukan lewat decompilasi:{' '}
          <span className="font-mono">PerizinanFragment.uploadImage()</span> memanggil{' '}
          <span className="font-mono">VolleyMultipartRequest</span> ke{' '}
          <span className="font-mono">server + "/importfile"</span> — dan nilai{' '}
          <span className="font-mono">server</span> sudah memuat <span className="font-mono">
            /service
          </span>
          , jadi URL akhirnya <span className="font-mono">/service/importfile</span>.
        </p>
        <Alert tone="amber">
              ⚠️ <strong>Path-nya hidup, tapi bentuk request-nya belum diterima.</strong> Diuji
              live 2026-09-28: <span className="font-mono">/service/importfile</span> menjawab 200
              + JSON-RPC <span className="font-mono">-32605</span>, sementara path karangan
              menjawab 404 HTML. Namun seluruh variasi body — multipart lengkap, multipart tanpa
              field, nama part alternatif, JSON datar, sampai tanpa body — dijawab{' '}
              <span className="font-mono">-32605</span> yang sama persis. Butuh{' '}
              <span className="font-mono">api_key</span> sesi nyata untuk menyingkirkan kemungkinan
              bahwa penolakan ini murni soal autentikasi. Konsekuensinya: pengajuan izin tetap
              tercatat walau lampiran gagal, dan UI melapor keduanya secara terpisah.
        </Alert>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700">
          <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all">
{CONTOH_IMPORTFILE}
          </pre>
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Data referensi
// ═══════════════════════════════════════════════════════════════════════

function Referensi() {
  return (
    <>
      <Card>
        <CardTitle>getworkcode</CardTitle>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 mb-3">
          <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all">
{BALASAN_WORKCODE}
          </pre>
        </div>
        <Alert tone="amber">
          Jam bersarang <span className="font-semibold">tiga tingkat</span> (
          <span className="font-mono">[].hari.jam.jam_masuk</span>) dan nilai{' '}
          <span className="font-mono">hari.nama</span> tidak konsisten — beberapa work code bahkan
          bernama <span className="font-mono">(EVENT) …</span> untuk hari yang sama. Pencocokan hari
          harus memakai awalan <span className="font-mono">nama</span>, bukan{' '}
          <span className="font-mono">hari.nama</span>.
        </Alert>
      </Card>

      <Card>
        <CardTitle>getlokasiabsen</CardTitle>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 mb-3">
          <pre className="text-[11px] font-mono text-sky-300 whitespace-pre-wrap break-all">
{BALASAN_LOKASI}
          </pre>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Koordinat datang sebagai satu string <span className="font-mono">latlong</span>, bukan dua
          field terpisah. Server hanya menyediakan operasi baca.
        </p>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Kode error
// ═══════════════════════════════════════════════════════════════════════

function Kode({ onCopy }: { onCopy: (teks: string, label: string) => void }) {
  const kode = [
    { code: String(GATE_OBJECT_TIDAK_ADA), meaning: 'Object not found', use: 'Menentukan apakah object benar-benar ada' },
    { code: String(GATE_PARAM_SALAH), meaning: 'Invalid params', use: 'Memakai ini untuk memverifikasi param wajib' },
    { code: '-32604', meaning: 'InvalidToken {expired:true}', use: 'Penanda bahwa bentuk param sudah benar' },
    { code: String(GATE_NIP_SALAH), meaning: 'Invalid Nip / Password Anda Salah', use: 'Validasi field login' },
    { code: String(GATE_PERANGKAH_TERIKAT), meaning: 'Already registered with other device', use: 'Akun terkunci ke perangkat lain' },
    { code: 'HTTP 500', meaning: 'work_code non-numerik', use: 'Validasi tipe work_code' },
    { code: 'result: null', meaning: 'Kegagalan bisnis, bukan error protokol', use: 'Pesan penolakan normal' },
  ];

  return (
    <>
      <Card>
        <CardTitle
          action={
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => onCopy(kode.map(k => `${k.code}\t${k.meaning}`).join('\n'), 'Tabel kode error')}
              icon={<Copy className="w-3.5 h-3.5" />}
            >
              Salin
            </ActionButton>
          }
        >
          Kode error sebagai oracle
        </CardTitle>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 w-24">
                  kode
                </th>
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  arti
                </th>
                <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  dipakai untuk
                </th>
              </tr>
            </thead>
            <tbody>
              {kode.map(item => (
                <tr key={item.code} className="border-b border-slate-100 dark:border-slate-800/60 last:border-0">
                  <td className="py-2 pr-3 font-mono text-rose-600 dark:text-rose-400 whitespace-nowrap">
                    {item.code}
                  </td>
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{item.meaning}</td>
                  <td className="py-2 text-slate-500 dark:text-slate-400">{item.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Cara daftar param wajib diverifikasi</CardTitle>
        <ol className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
          {[
            'Kirim hanya param base (api_key, last_latlong, imei) → catat hasilnya.',
            'Kirim kandidat superset yang jauh lebih besar → hasil tetap sama, jadi key tambahan tidak wajib.',
            'Kurangi superset dengan delta debugging sampai menghapus satu key mengubah server dari "ok" menjadi -32602.',
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-blue-500/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0">
                {index + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
          Server mengabaikan key yang tidak dikenal, jadi <span className="font-mono">-32602</span>{' '}
          berarti ada yang <span className="font-semibold">wajib hilang</span>, bukan ada yang{' '}
          <span className="font-semibold">dilebihkan</span>.
        </p>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Batasan
// ═══════════════════════════════════════════════════════════════════════

function Batas() {
  const batasan = [
    {
      judul: 'Setujui / tolak izin',
      status: 'Tidak ada endpoint',
      detail:
        'approve_ijin dan ijin_bawahan dibalas -32601. Persetujuan hanya bisa lewat aplikasi resmi atau administrator server. Menu Persetujuan Izin karena itu dihapus dari aplikasi ini.',
    },
    {
      judul: 'Tambah / pindah titik absen',
      status: 'Tidak ada endpoint',
      detail:
        'Server hanya bisa membaca lewat getlokasiabsen. Titik yang dibuat di aplikasi ini tersimpan di peramban dan hanya dipakai sebagai koordinat last_latlong; titik yang menentukan geofence tetap milik server.',
    },
    {
      judul: 'Verifikasi wajah dari peramban',
      status: 'Tidak ada parameter',
      detail:
        'object absen versi 89 tidak punya parameter foto maupun vektor wajah. Face recognition pada aplikasi Android berjalan penuh di perangkat (FaceNet + model spoof, assets facenet_512.tflite) dan vektor wajahnya hanya dibandingkan lokal dengan vektor_profile dari login.',
    },
    {
      judul: 'Pendaftaran vektor wajah',
      status: 'Belum diimplementasikan',
      detail:
        'update_foto memang menerima field vektor, jadi mendaftarkan vektor dari web secara teknis mungkin — tapi perhitungannya butuh model FaceNet 512-dimensi yang hanya tersedia sebagai .tflite di dalam APK. Modul "Profil & Password Server" hanya mengunggah foto tanpa vektor.',
    },
    {
      judul: 'Daftar & persetujuan izin bawahan',
      status: 'Tidak ada endpoint',
      detail:
        'Modul Admin di aplikasi Android punya layar izin bawahan, tapi hanya memakai list_ijin yang sudah dipakai modul ini, dan tombol "Daftar Bawahan" di aplikasi pun kosong (toListBawahan tidak melakukan apa pun). Jadi tidak ada endpoint khusus yang hilang di sini.',
    },
  ];

  return (
    <>
      <Alert tone="amber">
            Semua yang terverifikasi di bawah berasal dari probe black-box ke gateway produksi dengan
            satu akun NIP nyata. Yang tidak terverifikasi diberi tanda ⚠ beserta alasannya.
      </Alert>

      <div className="grid grid-cols-1 gap-4">
        {batasan.map(item => (
          <Card key={item.judul}>
            <CardTitle
              action={
                <Badge tone={item.status.startsWith('⚠') ? 'amber' : 'rose'}>{item.status}</Badge>
              }
            >
              {item.judul}
            </CardTitle>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{item.detail}</p>
          </Card>
        ))}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Sub-komponen & contoh
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
//  Web Resmi — dokumentasi menu WEB (e-Presensi BKD Jatim)
// ═══════════════════════════════════════════════════════════════════════

function WebResmi({ onCopy }: { onCopy: (teks: string, label: string) => void }) {
  return (
    <>
      {/* Overview */}
      <Card>
        <CardTitle action={<Badge tone="blue">Portal Presensi BKD Jatim</Badge>}>
          Gambaran Umum Menu WEB
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
          Menu <span className="font-semibold">WEB</span> mengakses langsung portal web resmi
          BKD Jatim di{' '}
          <span className="font-mono">presensi.bkd.jatimprov.go.id</span> — berbeda dari menu
          Presensi & Perizinan yang memakai JSON-RPC. Portal web ini berbasis PHP/Symfony,
          menggunakan form login + CAPTCHA, dan mengembalikan HTML — bukan JSON.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <RowWeb label="Target" value="https://presensi.bkd.jatimprov.go.id" mono />
          <RowWeb label="Autentikasi" value="Form login + CAPTCHA (4 digit numerik, GIF)" />
          <RowWeb label="Format respons" value="HTML — di-parse langsung oleh aplikasi" />
          <RowWeb label="Sesi" value="Cookie: epresensi-bkdjatim (HttpOnly, session)" mono />
          <RowWeb label="Captcha di produksi" value="Diketik manual — OCR tidak di-deploy" />
          <RowWeb label="Captcha di lokal" value="Otomatis: ddddocr via ocr_service.py — port 8791" mono />
        </div>
      </Card>

      {/* Proxy */}
      <Card>
        <CardTitle action={<Badge tone="violet">Same-origin proxy</Badge>}>
          Arsitektur Proxy
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Browser tidak bisa fetch langsung ke domain lain karena CORS. Semua request ke{' '}
          <span className="font-mono">/ep/*</span> diproksikan ke upstream — di lokal oleh Vite,
          di Vercel oleh serverless function <span className="font-mono">api/ep.js</span>.
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 mb-3">
          <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all">
{WEB_PROXY_DIAGRAM}
          </pre>
        </div>
        <div className="grid grid-cols-1 gap-2.5">
          <RowWeb label="Lokal dev" value="Vite server.proxy['/ep'] → upstream (rewrite Location header)" />
          <RowWeb label="Vercel" value="vercel.json rewrite /ep/:path* → /api/ep/:path*" />
          <RowWeb label="Cookie" value="Diteruskan dua arah; Set-Cookie domain dihapus agar browser menerimanya" />
          <RowWeb label="Redirect" value="Location header ditulis ulang dari https://presensi... → /ep/..." mono />
        </div>
      </Card>

      {/* Login & Captcha */}
      <Card>
        <CardTitle>Login & Captcha</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Login ke portal web melalui dua tahap: ambil gambar captcha lalu kirim form login.
          Captcha bersifat satu kali pakai dan terikat ke session cookie.
        </p>
        <ol className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300 mb-4">
          {[
            <>GET <span className="font-mono">/ep/index.php/</span> — inisialisasi session cookie.</>,
            <>GET <span className="font-mono">/ep/index.php/captcha?r=random&reload=1</span> — gambar GIF 4 digit.</>,
            <>POST <span className="font-mono">/api/ocr</span> body=byte gambar → JSON <span className="font-mono">{`{ok,text,yakin}`}</span> — <strong className="font-semibold">hanya di lokal</strong>.</>,
            <>POST <span className="font-mono">/ep/index.php/login</span> — form-urlencoded dengan NIP, password, CAPTCHA.<br />
              Sukses: redirect ke <span className="font-mono">/index.php/</span>.<br />
              Gagal: redirect kembali ke <span className="font-mono">/index.php/login</span> dengan div.alert-danger.</>,
            <>Retry otomatis hingga {MAX_PERCOBAAN_LOGIN_DOC}× bila jenis error adalah captcha; berhenti bila kredensial salah.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <Alert tone="blue">
          <strong className="font-semibold">Captcha di produksi diketik manual.</strong>{' '}
          Dulu ada <span className="font-mono">api/ocr.ts</span> yang menjalankan model ddddocr via{' '}
          <span className="font-mono">onnxruntime-node</span> — tapi paket itu <strong className="font-semibold">844 MB</strong>,
          dan itu penyebab storage Function Vercel melonjak. Model 13 MB untuk memecah
          empat digit tidak sebanding dengan biaya tersebut.
        </Alert>
        <Alert tone="blue">
          Di <span className="font-mono">npm run dev</span> OCR tetap otomatis:{' '}
          <span className="font-mono">ocr_service.py</span> (ddddocr, port 8791) melayaninya lewat
          middleware Vite. Blok OCR di build produksi di-constant-fold oleh Vite
          karena <span className="font-mono">import.meta.env.DEV</span> bernilai{' '}
          <span className="font-mono">false</span>, jadi <span className="font-mono">/api/ocr</span> tidak
          ada di bundle yang ter-deploy.
        </Alert>
      </Card>

      {/* Endpoint IMEI */}
      <Card>
        <CardTitle action={<Badge tone="emerald">Tab: IMEI</Badge>}>
          Pengambilan IMEI
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          IMEI diambil dari baris paling atas tabel kehadiran halaman pertama. Seluruh riwayat
          di halaman itu milik akun yang sedang login.
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 mb-3">
          <pre className="text-[11px] font-mono text-sky-300 whitespace-pre-wrap break-all">
{WEB_ENDPOINT_IMEI}
          </pre>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <RowWeb label="Fungsi" value="ambilImei()" mono />
          <RowWeb label="Sumber kolom" value="sf_admin_list_td_imei" mono />
          <RowWeb label="Hasil" value="{ imei: string|null, profil: { nama, nip } }" mono />
          <RowWeb label="Catatan" value="Hanya halaman pertama — satu IMEI paling atas sudah cukup" />
        </div>
      </Card>

      {/* Endpoint Kehadiran */}
      <Card>
        <CardTitle action={<Badge tone="emerald">Tab: Kehadiran</Badge>}>
          Riwayat Kehadiran
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Tabel kehadiran dipaginasi server-side. Setiap baris diurai dari HTML menjadi objek
          terstruktur. Koordinat presisi tersedia via endpoint terpisah.
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 mb-3">
          <pre className="text-[11px] font-mono text-sky-300 whitespace-pre-wrap break-all">
{WEB_ENDPOINT_KEHADIRAN}
          </pre>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs min-w-[480px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Field</th>
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Kolom HTML</th>
                <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {KEHADIRAN_FIELDS.map(f => (
                <tr key={f.field} className="border-b border-slate-100 dark:border-slate-800/60 last:border-0">
                  <td className="py-2 pr-3 font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">{f.field}</td>
                  <td className="py-2 pr-3 font-mono text-slate-500 dark:text-slate-400 text-[11px]">{f.kolom}</td>
                  <td className="py-2 text-slate-500 dark:text-slate-400">{f.ket}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Alert tone="amber">
          Koordinat di kolom <span className="font-mono">latlong</span> adalah perkiraan.
          Koordinat presisi dimuat via{' '}
          <span className="font-mono">/index.php/checkinout/load/action?latlong=ID</span> — hanya
          saat tombol Peta ditekan (lazy load).
        </Alert>
      </Card>

      {/* Endpoint Detail Pegawai */}
      <Card>
        <CardTitle action={<Badge tone="emerald">Tab: Detail Pegawai</Badge>}>
          Detail Pegawai
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Halaman profil pegawai — berisi data identitas, riwayat login perangkat, foto terunggah,
          dan daftar ijin via ajax.
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 mb-3">
          <pre className="text-[11px] font-mono text-violet-300 whitespace-pre-wrap break-all">
{WEB_ENDPOINT_DETAIL}
          </pre>
        </div>
        <div className="grid grid-cols-1 gap-2.5">
          <RowWeb label="Profil" value="Pola <td>Label</td><td>:</td><td>Nilai</td> — semua field identitas" />
          <RowWeb label="Foto" value="<img width=150px> — diproksikan via /ep/" mono />
          <RowWeb label="Riwayat login" value="Tabel dengan header 'IMEI' — perangkat terdaftar" />
          <RowWeb label="Foto upload" value="Tabel dengan header 'Tanggal Upload'" />
          <RowWeb label="Daftar ijin" value="Lazy: GET /index.php/pegawai/{id}/ijins — fragmen HTML posisional" mono />
        </div>
      </Card>

      {/* Endpoint Perizinan */}
      <Card>
        <CardTitle action={<Badge tone="emerald">Tab: Perizinan</Badge>}>
          Perizinan / Cuti (Portal Web)
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Tabel perizinan portal web — berbeda dari <span className="font-mono">list_ijin</span> JSON-RPC.
          Dipaginasi server-side, mendukung muat semua halaman sekaligus.
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 mb-3">
          <pre className="text-[11px] font-mono text-violet-300 whitespace-pre-wrap break-all">
{WEB_ENDPOINT_PERIZINAN}
          </pre>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs min-w-[480px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Field</th>
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Kolom HTML</th>
                <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {PERIZINAN_FIELDS.map(f => (
                <tr key={f.field} className="border-b border-slate-100 dark:border-slate-800/60 last:border-0">
                  <td className="py-2 pr-3 font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">{f.field}</td>
                  <td className="py-2 pr-3 font-mono text-slate-500 dark:text-slate-400 text-[11px]">{f.kolom}</td>
                  <td className="py-2 text-slate-500 dark:text-slate-400">{f.ket}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Alert tone="blue">
          Portal web punya dua bentuk tabel perizinan: (a) <span className="font-mono">/index.php/perizinan</span>{' '}
          berkelas <span className="font-mono">sf_admin_list_td_*</span>, dan (b) fragmen ajax{' '}
          <span className="font-mono">/pegawai/N/ijins</span> yang posisional. Parser mendeteksi
          otomatis dan menangani keduanya.
        </Alert>
      </Card>

      {/* Berkas lampiran */}
      <Card>
        <CardTitle>Berkas Lampiran (Viewer)</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Berkas izin (PDF/gambar) diproksikan lewat <span className="font-mono">/ep/</span>{' '}
          agar session cookie ikut dikirim. Setelah dimuat, URL object-URL sementara dibuat dan
          ditampilkan dalam modal viewer.
        </p>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700 mb-3">
          <pre className="text-[11px] font-mono text-amber-300 whitespace-pre-wrap break-all">
{WEB_BERKAS}
          </pre>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <RowWeb label="Fungsi" value="ambilBerkas(path)" mono />
          <RowWeb label="Path input" value="uploads/ijin/... atau URL absolut upstream" />
          <RowWeb label="Output" value="{ blob, tipe, url: ObjectURL }" mono />
          <RowWeb label="Viewer PDF" value="<iframe> full-height, bezel tipis" />
          <RowWeb label="Viewer gambar" value="Zoom ¼×–4×, pan via overflow scroll" />
          <RowWeb label="Cleanup" value="URL.revokeObjectURL() saat modal ditutup" />
        </div>
      </Card>

      {/* Parser HTML */}
      <Card>
        <CardTitle
          action={
            <ActionButton
              variant="ghost"
              size="sm"
              onClick={() => onCopy(WEB_PARSER_CONTOH, 'Contoh parser')}
              icon={<Copy className="w-3.5 h-3.5" />}
            >
              Salin
            </ActionButton>
          }
        >
          Parser HTML — teknik & fungsi utilitas
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Semua parsing HTML dilakukan tanpa DOMParser (agar bisa dipakai di Node.js/test).
          Hanya regex dan string manipulation.
        </p>
        <div className="grid grid-cols-1 gap-2.5 mb-4">
          {PARSER_UTILS.map(u => (
            <div key={u.fn} className="rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/70 dark:border-slate-700/50 px-3.5 py-2.5">
              <p className="font-mono text-xs text-indigo-600 dark:text-indigo-400">{u.fn}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{u.ket}</p>
            </div>
          ))}
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700">
          <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all">
{WEB_PARSER_CONTOH}
          </pre>
        </div>
      </Card>

      {/*
       * Detail OCR hanya relevan untuk `npm run dev`.
       *
       * Di produksi endpoint ini tidak ada sama sekali — bukan disembunyikan,
       * tapi tidak ikut ter-bundle (lihat `OCR_LOKAL` di `WebPresensi.tsx`).
       * Menampilkan kartu ini sebagai bagian alur produksi akan menyesatkan.
       */}
      {/* OCR detail */}
      <Card>
        <CardTitle action={<Badge tone="violet">Lokal saja — model ddddocr common_old.onnx</Badge>}>
          OCR Captcha — Detail Teknis (npm run dev)
        </CardTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <RowWeb label="Model" value="ddddocr common_old.onnx (13 MB)" />
          <RowWeb label="Input tensor" value="float32 [1, 1, 64, 224] — grayscale, normalized" mono />
          <RowWeb label="Output tensor" value="float32 [T, 1, 8210] — T=28 timestep CTC" mono />
          <RowWeb label="Decode" value="CTC greedy, digit-only argmax (charset index 0–9)" />
          <RowWeb label="Normalisasi" value="(pixel/255 − 0.5) / 0.5" mono />
          <RowWeb label="Charset" value="8.210 karakter (index 0 = CTC blank)" />
          <RowWeb label="Akurasi" value="4 digit murni, yakin=true bila panjang tepat 4" />
          <RowWeb label="Retry" value="Hingga 3× dengan gambar baru bila tidak yakin" />
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-700">
          <pre className="text-[11px] font-mono text-sky-300 whitespace-pre-wrap break-all">
{WEB_OCR_FLOW}
          </pre>
        </div>
        <Alert tone="blue">
          Endpoint <span className="font-mono">POST /api/ocr</span> dilayani middleware Vite yang
          meneruskan ke <span className="font-mono">ocr_service.py</span> (port 8791). Dulu
          Vercel melayaninya dengan handler Node.js sendiri, tapi itu sudah dihapus.
          Respons format: <span className="font-mono">{`{ok, text, kandidat[], yakin, panjang}`}</span>.
        </Alert>
      </Card>

      {/* Perbedaan vs JSON-RPC */}
      <Card>
        <CardTitle>Perbandingan: Portal Web vs JSON-RPC</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[540px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Aspek</th>
                <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-wider text-indigo-500">Portal Web</th>
                <th className="py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">JSON-RPC</th>
              </tr>
            </thead>
            <tbody>
              {PERBANDINGAN.map(r => (
                <tr key={r.aspek} className="border-b border-slate-100 dark:border-slate-800/60 last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-slate-700 dark:text-slate-200">{r.aspek}</td>
                  <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">{r.web}</td>
                  <td className="py-2.5 text-slate-600 dark:text-slate-300">{r.rpc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Kolom eksklusif portal web */}
      <Card>
        <CardTitle action={<Badge tone="emerald">Data eksklusif</Badge>}>
          Kolom hanya tersedia di portal web
        </CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Data berikut ada di tabel HTML portal web tapi tidak tersedia via JSON-RPC — alasan utama
          menu WEB dibuat sebagai akses langsung ke portal.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {KOLOM_EKSKLUSIF.map(k => (
            <div key={k.nama} className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 px-3.5 py-2.5">
              <p className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">{k.nama}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{k.ket}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

// ── Komponen Row khusus tab Web ──────────────────────────────────────
function RowWeb({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/70 dark:border-slate-700/50 px-3.5 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
      <p className={`mt-0.5 text-slate-700 dark:text-slate-200 break-all ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</p>
    </div>
  );
}

// ── Konstanta data Web Resmi ─────────────────────────────────────────

const MAX_PERCOBAAN_LOGIN_DOC = 6;

const WEB_PROXY_DIAGRAM = `Browser (fetch /ep/index.php/...)
  │
  ├─ [Local dev] Vite server.proxy['/ep']
  │      rewrite: /ep → ''
  │      target: https://presensi.bkd.jatimprov.go.id
  │      rewrite Location: https://presensi... → /ep/...
  │
  └─ [Vercel] vercel.json rewrite /ep/:path* → /api/ep/:path*
         api/ep.js serverless function
         → fetch(https://presensi.bkd.jatimprov.go.id/:path*)
         ← rewrite Location, strip Set-Cookie domain`;

const WEB_ENDPOINT_IMEI = `GET /ep/index.php/checkinout
← HTML: tabel dengan kolom sf_admin_list_td_imei

Fungsi: ambilImei()
Parser:
  extractProfil(html) → { nama, nip }   // regex baris <nama><br><NIP18><br>
  extractImeis(html)  → string[]         // regex sf_admin_list_td_imei
  → { imei: imeis[0] || null, profil }`;

const WEB_ENDPOINT_KEHADIRAN = `GET /ep/index.php/checkinout[?page=N]
← HTML: tabel paginasi

Fungsi: ambilKehadiran({ halaman }) → { baris[], halaman, totalHalaman }
Parser: parseKehadiran(html)
  Per baris <tr> yang mengandung sf_admin_list_td_imei:
    selAdmin(r, 'kolom') → teks isi <td class="...kolom...">
    bagian(html)         → split per <br>/<hr>, bersihkan tiap potongan
    hitungTotalHalaman() → max ?page=N di tautan paginasi

GET /ep/index.php/checkinout/load/action?latlong=ID
← HTML: "Latitude: -7.123" / "Longitude: 112.456"
Fungsi: ambilLatlong(idMap) → { lat, lng }  (lazy, saat klik Peta)`;

const WEB_ENDPOINT_DETAIL = `GET /ep/index.php/pegawai/details/action
← HTML: halaman profil pegawai

Fungsi: ambilDetailPegawai() → { profil, foto, idPegawai, logLogin, fotoUpload }
Parser: parseDetailPegawai(html)
  profil    : regex <td>Label</td><td>:</td><td>Nilai</td>
  foto      : <img width="150px" src="...">
  idPegawai : regex /pegawai/(\d+)/ijins
  logLogin  : tabelDenganHeader(html, /^imei$/i)
  fotoUpload: tabelDenganHeader(html, /tanggal upload/i)

GET /ep/index.php/pegawai/{idPegawai}/ijins
← HTML: fragmen tabel posisional (bukan berkelas)
Fungsi: ambilIjinPegawai(id) → { baris[] }  (lazy, dimuat setelah detail)`;

const WEB_ENDPOINT_PERIZINAN = `GET /ep/index.php/perizinan[?page=N]
← HTML: tabel paginasi berkelas sf_admin_list_td_*

Fungsi: ambilPerizinan({ halaman }) → { baris[], halaman, totalHalaman }
        muatSemuaPerizinan()        → fetch semua halaman, concat baris

Parser: parsePerizinan(html) — dua mode:
  (a) /index.php/perizinan     : kolom berkelas sf_admin_list_td_*
  (b) /pegawai/N/ijins (ajax)  : kolom posisional (scope="row")`;

const WEB_BERKAS = `// Mengonversi path berkas → URL proxy, lalu fetch
urlBerkas('/uploads/ijin/file.pdf')
  → '/ep/uploads/ijin/file.pdf'    // path relatif
urlBerkas('https://presensi.../uploads/...')
  → '/ep/uploads/...'              // URL absolut upstream

ambilBerkas(path):
  res = await fetch(urlBerkas(path), { credentials: 'include' })
  tipe = res.headers.get('content-type')   // 'application/pdf' / 'image/jpeg'
  url  = URL.createObjectURL(await res.blob())
  → { blob, tipe, url }

// Saat modal ditutup:
URL.revokeObjectURL(url)  // bebaskan memori`;

const WEB_OCR_FLOW = `POST /api/ocr
  Body: byte[] gambar captcha GIF (±1.5 kB)
  Content-Type: application/octet-stream

Response: {
  ok: true,
  text: "1234",        // 4 digit, hasil CTC greedy digit-only
  kandidat: ["1234"],  // alternatif (bebas + digit-only)
  yakin: true,         // panjang=4 && semua digit
  panjang: 4
}

Alur inferensi (api/ocr.js & ocr_service.py identik):
  sharp(gambar).resize(224,64).grayscale().raw()
    → Float32[64×224] = (pixel/255 - 0.5) / 0.5
    → Tensor [1,1,64,224]
  session.run({ input1: tensor })
    → output [28, 1, 8210]  (T=28 timestep, C=8210 kelas)
  argmax per timestep (hanya index digit 0-9 + blank)
    → CTC greedy decode → "1234"`;

const WEB_PARSER_CONTOH = `// Semua parser ada di src/lib/webPresensi.ts

teks(html)        // strip tag, decode entitas HTML, split per <br>/<hr>
teksSatu(html)    // teks() + collapse whitespace → satu baris

selAdmin(r, key)  // isi <td class="...sf_admin_list_td_{key}...">
bagian(html)      // pisah per <br>/<hr>, bersihkan tiap potongan → string[]
selMentah(r)      // semua <td>...</td> mentah dari satu <tr>

hitungTotalHalaman(html)  // max ?page=N di semua href/src
isHalamanLogin(html)      // cek 'm_user[email]' — sesi habis
pastikanBukanLogin(html)  // lempar {sesiHabis:true} bila perlu
tabelDenganHeader(html, /regex/)  // cari tabel by header, → {header,baris}`;

const PARSER_UTILS = [
  { fn: 'teks(html)',              ket: 'Strip semua tag, decode entitas HTML, split per <br>/<hr>' },
  { fn: 'teksSatu(html)',          ket: 'teks() + collapse whitespace → satu baris bersih' },
  { fn: 'selAdmin(baris, kelas)',  ket: 'Ambil isi <td> berkelas sf_admin_list_td_{kelas}' },
  { fn: 'bagian(html)',            ket: 'Pisah per <br>/<hr>, bersihkan tiap potongan → string[]' },
  { fn: 'selMentah(baris)',        ket: 'Semua <td>...</td> mentah dari satu <tr> → string[]' },
  { fn: 'hitungTotalHalaman(html)',ket: 'Cari max ?page=N di semua href, menentukan jumlah halaman' },
  { fn: 'tabelDenganHeader(html, /re/)', ket: 'Cari tabel berdasarkan salah satu header-nya → {header, baris}' },
];

const KEHADIRAN_FIELDS = [
  { field: 'created_at',    kolom: 'created_at',   ket: 'Waktu presensi — format DD/MM/YYYY HH:MM:SS di UI' },
  { field: 'checktype',     kolom: 'checktype',     ket: '"Datang" / "Pulang" / "Absen Siang"' },
  { field: 'imei',          kolom: 'imei',          ket: 'IMEI/AndroidId perangkat yang dipakai' },
  { field: 'wfh',           kolom: 'iswfh',         ket: 'Label WFH/WFO bila ada' },
  { field: 'jarak',         kolom: 'jarak',         ket: 'Jarak dari titik absen dalam meter' },
  { field: 'alamatPresensi',kolom: 'latlong',        ket: 'Alamat dari koordinat (diambil bagian teks dari sel latlong)' },
  { field: 'lat / lng',     kolom: 'latlong',        ket: 'Koordinat float dari regex (-?\\d+\\.\\d+,...)' },
  { field: 'idMap',         kolom: 'latlong',        ket: 'ID untuk ambilLatlong() — koordinat presisi via endpoint terpisah' },
  { field: 'unitKerja',     kolom: 'departemen',     ket: 'Unit kerja / OPD' },
  { field: 'disetujui',     kolom: 'approval',       ket: 'true/false/null dari ikon fa-check/fa-times' },
  { field: 'waktuApproval', kolom: 'approval',       ket: 'Waktu approval dari teks bagian sel approval' },
  { field: 'workCode',      kolom: 'work_code',      ket: 'Kode kerja yang dipakai saat absen' },
];

const PERIZINAN_FIELDS = [
  { field: 'tipeIjin',    kolom: 'tipe_ijin',     ket: '"ijin penuh", "setengah hari", dll.' },
  { field: 'jenisIjin',   kolom: 'jenis_ijin',    ket: '"Cuti Tahunan", "Sakit", dll.' },
  { field: 'tglIjin',     kolom: 'tgl_ijin',      ket: 'Rentang tanggal — di-parse UI ke "tgl1 s/d tgl2" bila range' },
  { field: 'alasan',      kolom: 'alasan',        ket: 'Alasan pengajuan — teks penuh, tidak dipotong' },
  { field: 'catatan',     kolom: 'catatan',       ket: 'Catatan tambahan (opsional)' },
  { field: 'berkas',      kolom: 'berkas',        ket: 'Path uploads/... untuk viewer lampiran' },
  { field: 'disetujui',   kolom: 'approval',      ket: 'true/false/null dari ikon fa-check/fa-times' },
  { field: 'approvalAt',  kolom: 'approval_at',   ket: 'Waktu approval — DD/MM/YYYY HH:MM:SS di UI' },
  { field: 'createdAt',   kolom: 'created_at',    ket: 'Waktu pengajuan dibuat' },
  { field: 'nama / nip',  kolom: 'nama',          ket: 'Nama dan NIP pegawai (hanya di /perizinan, bukan di fragmen ajax)' },
  { field: 'unitKerja',   kolom: 'MDepartemen',   ket: 'Unit kerja / OPD' },
];

const PERBANDINGAN = [
  { aspek: 'Autentikasi',    web: 'Form login + CAPTCHA → session cookie',         rpc: 'Field email+password+imei → api_key JWT' },
  { aspek: 'Format',         web: 'HTML — di-scrape dengan regex',                  rpc: 'JSON-RPC 2.0 — envelope terstruktur' },
  { aspek: 'Paginasi',       web: '?page=N — server-side, deteksi dari href',       rpc: 'page + limit di param' },
  { aspek: 'IMEI',           web: '✓ Ada di kolom — bisa dibaca tanpa absen dulu',  rpc: '— Tidak ada field IMEI di history_absen' },
  { aspek: 'Kode Kerja',     web: '✓ Ada di kolom work_code',                       rpc: '— Tidak tersedia di history_absen' },
  { aspek: 'WFH/WFO label',  web: '✓ Kolom iswfh — label teks',                    rpc: '— Tidak ada di history_absen' },
  { aspek: 'Berkas izin',    web: '✓ Path uploads/... → viewer PDF/gambar',         rpc: '⚠ /service/importfile hidup tapi -32605' },
  { aspek: 'Approve izin',   web: '— Tidak ada tombol/endpoint',                    rpc: '— approve_ijin dibalas -32601' },
  { aspek: 'Aksi absen',     web: '— Tidak bisa submit dari web',                   rpc: '✓ object: absen + cekabsen' },
  { aspek: 'Koordinat',      web: '✓ Tabel + endpoint presisi terpisah',            rpc: '✓ last_latlong di setiap request absen' },
];

const KOLOM_EKSKLUSIF = [
  { nama: 'imei',         ket: 'IMEI/AndroidId perangkat — sumber utama tujuan menu WEB, tidak ada di JSON-RPC' },
  { nama: 'work_code',    ket: 'Kode kerja yang dipakai saat presensi — hanya terlihat di portal web' },
  { nama: 'iswfh',        ket: 'Label WFH/WFO per baris presensi — tidak ada di history_absen' },
  { nama: 'timezone',     ket: 'Zona waktu yang dipakai saat absen' },
  { nama: 'berkas (PDF)', ket: 'Lampiran berkas izin bisa di-preview dan diunduh via proxy /ep/' },
  { nama: 'logLogin',     ket: 'Riwayat login perangkat — tabel di halaman detail pegawai' },
  { nama: 'fotoUpload',   ket: 'Daftar foto yang pernah diunggah — tabel di halaman detail pegawai' },
  { nama: 'koordinat presisi', ket: 'Via /checkinout/load/action?latlong=ID — lebih akurat dari koordinat tabel' },
];

// ── Komponen Row untuk tab lainnya ───────────────────────────────────
function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/70 dark:border-slate-700/50 px-3.5 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p
        className={`mt-0.5 text-slate-700 dark:text-slate-200 break-all ${
          mono ? 'font-mono text-xs' : 'text-sm'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

const ENVELOPE_CONTOH = `{
  "jsonrpc": 2,
  "method": "POST",
  "version": 89,
  "object": "login",
  "param": {
    "email": "<NIP>",
    "password": "<password>",
    "latlong": "<lat>,<long>",
    "imei": "<androidId>"
  }
}`;

const BALASAN_LOGIN = `{
  "message": "sukses login",
  "api_key": "…",
  "pegawai_id": 113866,
  "user_id": 98241,
  "departemen_id": 34379,
  "group_id": 2,
  "group_name": "pegawai",
  "nama": "…",
  "jabatan": "…",
  "departemen": "…",
  "logo_departemen": "…",
  "upload_wajah": 1,
  "allow_wfh": 1,
  "foto_profile": "…",
  "vektor_profile": "",
  "vektor_approved": 0,
  "home": 1,
  "presensi": 1,
  "perizinan": 1,
  "laporan": 1,
  "label_wfh": "WFH"
}`;

const BALASAN_HISTORY = `[{ "nama": "…", "departemen": "…",
   "jarak": "12,509,838",
   "checktype": "Datang",
   "approval": true, "approval_text": "Disetujui",
   "waktu": "2026-09-27 23:31:24" }]`;

const BALASAN_LIST_IJIN = `[{ "id": 174338988,
   "approval": true,
   "approval_at": "2026-09-28 08:10:00",
   "email": "<NIP>",
   "nama": "…", "departemen": "…",
   "tipe_ijin": 1, "tipe_ijin_text": "ijin penuh",
   "jenis_ijin": 4, "jenis_ijin_text": "Cuti Tahunan",
   "master_jenis_ijin": 1,
   "tgl_ijin_dari": "09 September 2026",
   "tgl_ijin_sampai": "09 September 2026",
   "alasan": "…", "berkas": "",
   "created_at": "2026-09-14 09:42:04",
   // Lima field berikut dibaca ListIjinBawahanFragment di APK v89.
   // Belum terverifikasi apakah server selalu mengirimnya — toIjinView
   // memperlakukannya opsional dan jatuh ke approval bila kosong.
   "status": 1,
   "catatan": "",
   "pegawai_id": 113866, "user_id": 98241,
   "updated_at": "", "updated_user": "" }]`;

const CONTOH_IMPORTFILE = `POST /service/importfile
Content-Type: multipart/form-data; boundary=…

  api_key       = <token sesi>
  id            = 174338988        ← id izin dari add_ijin
  last_latlong  =                  ← sengaja kosong, seperti aplikasi
  type          = ijin
  image         = berkas (JPG/PDF) ← nama part: "image"

⚠️ Catatan: path hidup (200 + JSON-RPC -32605), tapi semua variasi body
   dijawab -32605 yang sama. Belum terverifikasi sepenuhnya.`;

const BALASAN_WORKCODE = `[{ "id": 12, "nama": "Senin",
   "hari": {
     "nama": "Minggu",              // tidak konsisten
     "jam": {
       "jam_masuk_awal":  "06:30:00",
       "jam_masuk":       "07:00:00",
       "jam_keluar":      "15:00:00",
       "jam_keluar_akhir":"17:00:00"
     } } }]`;

const BALASAN_LOKASI = `[{ "tipe": "default", "id": 159,
   "data": "…",
   "latlong": "-7.29007,112.703",
   "lokasi": "…",
   "radius": 100,
   "deskripsi": "…",
   "prioritas": 1 }]`;
