/**
 * Modul komunikasi dengan e-Presensi BKD Jatim.
 *
 * Semua path /ep/* diproxy ke https://presensi.bkd.jatimprov.go.id
 * - Local dev: lewat proxy dev-server Vite (vite.config.ts)
 * - Vercel: lewat serverless function api/ep.ts
 *
 * Captcha:
 * - Local dev: dipecahkan otomatis via OCR lokal (ocr_service.py, ddddocr)
 * - Vercel/production: diketik manual — OCR tidak di-deploy, bukan karena tidak
 *   bisa jalan, tapi karena modelnya 844 MB dan storage Function tidak sanggup
 *   menanggungnya. Lihat `OCR_LOKAL` di `WebPresensi.tsx`.
 */

const PROXY = '/ep';

const PESAN_JARINGAN =
  'Tidak bisa menjangkau server e-Presensi lewat proxy /ep. ' +
  'Pastikan aplikasi dijalankan dengan "npm run dev" atau gunakan Vercel deployment.';

/** fetch dengan credentials include dan pesan error yang jelas. */
async function req(url: string, opts: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { credentials: 'include', ...opts });
  } catch (e) {
    const err = new Error(PESAN_JARINGAN);
    (err as Error & { sebab: unknown }).sebab = e;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Utilitas penguraian HTML
// ---------------------------------------------------------------------------

/** Buang tag & entitas, ubah <br>/<hr> menjadi pemisah baris. */
export function teks(html: string): string {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b.length)
    .join('\n')
    .trim();
}

/** Satu baris teks (semua spasi/baris baru diringkas). */
export function teksSatu(html: string): string {
  return teks(html).replace(/\s+/g, ' ').trim();
}

/** Ambil isi <td> yang memiliki kelas sf_admin_list_td_<kelas>. */
function selAdmin(baris: string, kelas: string): string {
  const re = new RegExp(`<td[^>]*sf_admin_list_td_${kelas}\\b[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  const m = baris.match(re);
  return m ? m[1] : '';
}

/** Pisah isi sel berdasarkan <br> atau <hr>, lalu bersihkan tiap bagian. */
function bagian(html: string): string[] {
  return String(html)
    .split(/<br\s*\/?>|<hr\s*\/?>/i)
    .map((b) => teksSatu(b))
    .filter((b) => b.length);
}

/** Ambil semua <td> mentah (termasuk tagnya) dari sebuah <tr>. */
function selMentah(baris: string): string[] {
  return baris.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
}

/** Jumlah halaman maksimum dari tautan paginasi (?page=N). */
export function hitungTotalHalaman(html: string): number {
  let maks = 1;
  const re = /[?&]page=(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > maks) maks = n;
  }
  return maks;
}

/** Apakah HTML tersebut justru halaman login (sesi habis). */
function isHalamanLogin(html: string): boolean {
  return html.includes('m_user[email]') && html.includes('m_user[CAPTCHA]');
}

type ApiError = Error & { sesiHabis?: boolean; perluCaptchaBaru?: boolean; jenis?: string };

/** Lempar error bertanda sesiHabis bila respons ternyata halaman login. */
function pastikanBukanLogin(html: string): void {
  if (isHalamanLogin(html)) {
    const err = new Error('Sesi berakhir, silakan login ulang.') as ApiError;
    err.sesiHabis = true;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 1. Captcha + login
// ---------------------------------------------------------------------------

export interface CaptchaResult {
  url: string;
  blob: Blob;
}

/**
 * Minta session baru lalu ambil gambar captcha.
 * Mengembalikan { url, blob }: url object-URL untuk <img>, blob untuk OCR.
 */
export async function muatCaptcha(): Promise<CaptchaResult> {
  await req(`${PROXY}/p/`);
  const res = await req(`${PROXY}/p/captcha?r=${Math.random()}&reload=1`);
  if (!res.ok) throw new Error(`Gagal memuat captcha (HTTP ${res.status})`);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), blob };
}

export interface OcrResult {
  teks: string;
  kandidat: string[];
  yakin: boolean;
}

/**
 * Pecahkan captcha lewat endpoint /api/ocr`.
 *
 * ⚠️ **Hanya dipanggil di `npm run dev`.** Di build produksi, Vite membuang
 * seluruh blok yang memanggil ini karena `OCR_LOKAL` bernilai `false`
 * (lihat `WebPresensi.tsx`) — captcha diketik manual, dan tidak ada `api/ocr.ts`
 * yang ter-deploy. Fungsi ini tidak boleh dipanggil dari mana pun yang ikut
 * ke build produksi.
 *
 * Yang melayaninya di dev adalah `ocr_service.py` (ddddocr, port 8791) melalui
 * middleware Vite — endpoint dan format responsnya sama seperti yang pernah
 * dilayani `api/ocr.ts` di Vercel.
 */
export async function selesaikanCaptcha(blob: Blob): Promise<OcrResult> {
  let res: Response;
  try {
    res = await fetch('/api/ocr', {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  } catch {
    return { teks: '', kandidat: [], yakin: false };
  }
  const data = await res.json().catch(() => ({})) as { ok?: boolean; text?: string; kandidat?: string[]; yakin?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    return { teks: '', kandidat: [], yakin: false };
  }
  return { teks: data.text || '', kandidat: data.kandidat || [], yakin: !!data.yakin };
}

/**
 * POST /p/login.
 */
export async function login({ nip, password, captcha }: { nip: string; password: string; captcha: string }): Promise<boolean> {
  const body = new URLSearchParams({
    'm_user[email]': nip,
    'm_user[password]': password,
    'm_user[CAPTCHA]': captcha,
  });
  // Proxy (ep.js) sudah follow redirect internal untuk POST, jadi browser
  // menerima response final (200 dashboard atau 200 halaman login = gagal).
  const res = await req(`${PROXY}/p/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const html = await res.text();
  if (isHalamanLogin(html)) {
    const m = html.match(/<div class="alert alert-danger">([\s\S]*?)<\/div>/i);
    const pesan = m
      ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : 'Login gagal (periksa NIP, password, dan captcha).';
    const err = new Error(pesan) as ApiError;
    err.perluCaptchaBaru = true;
    err.jenis = /captcha/i.test(pesan) ? 'captcha' : 'kredensial';
    throw err;
  }
  if (!res.ok) {
    let pesan = `Login gagal menghubungi server e-Presensi (HTTP ${res.status}).`;
    try {
      const data = JSON.parse(html) as { error?: unknown; detail?: unknown };
      if (typeof data.error === 'string') {
        pesan = data.error;
        if (typeof data.detail === 'string' && data.detail) pesan += `: ${data.detail}`;
      }
    } catch {
      // Respons non-JSON tetap dilaporkan lewat status HTTP.
    }
    throw new Error(pesan);
  }
  return true;
}

/** Logout untuk mengakhiri session. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${PROXY}/p/default/logout`, { credentials: 'include' });
  } catch {
    /* biarkan: sesi akan hangat sendiri */
  }
}

// ---------------------------------------------------------------------------
// 2. Halaman kehadiran (checkinout)
// ---------------------------------------------------------------------------

export interface BarisKehadiran {
  id: string | null;
  idMap: string | null;
  nama: string;
  nip: string;
  statusPegawai: string;
  lat: number | null;
  lng: number | null;
  alamatPresensi: string;
  unitKerja: string;
  alamatRumah: string;
  jarak: string;
  checktype: string;
  imei: string;
  disetujui: boolean | null;
  waktuApproval: string;
  created_at: string;
  timezone: string;
  wfh: string;
  workCode: string;
}

export interface ProfilPegawaiWeb {
  nama: string;
  nip: string;
}

export interface HasilImei {
  imei: string | null;
  profil: ProfilPegawaiWeb | null;
}

export interface HasilKehadiran {
  baris: BarisKehadiran[];
  halaman: number;
  totalHalaman: number;
}

/** Ekstrak daftar nilai kolom IMEI dari HTML checkinout. */
export function extractImeis(html: string): string[] {
  const norm = html.replace(/\s+/g, ' ');
  const re = /sf_admin_list_td_imei">\s*([^<]+?)\s*<\//g;
  const hasil: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm))) {
    const v = m[1].trim();
    if (v && v !== '-') hasil.push(v);
  }
  return [...new Set(hasil)];
}

/** Nama & NIP pegawai dari sel pertama tabel kehadiran. */
export function extractProfil(html: string): ProfilPegawaiWeb | null {
  const norm = html.replace(/\s+/g, ' ');
  const m = norm.match(/>\s*([^<>]{3,90}?)\s*<br>\s*(\d{18})\s*<br>/);
  if (m) return { nama: m[1].trim(), nip: m[2] };
  return null;
}

/** Uraikan SELURUH baris tabel kehadiran menjadi objek terstruktur. */
export function parseKehadiran(html: string): BarisKehadiran[] {
  const hasil: BarisKehadiran[] = [];
  const barisSemua = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const r of barisSemua) {
    if (!/sf_admin_list_td_imei/i.test(r)) continue;

    const selPegawai = bagian(selAdmin(r, 'pegawai_id'));
    const selLatlong = selAdmin(r, 'latlong');
    const koord = selLatlong.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    const idMap = (selLatlong.match(/latlong=(\d+)/i) || [])[1] || null;
    const bagianLatlong = bagian(selLatlong);
    const alamatPresensi = bagianLatlong.slice(1).join(' ').replace(/^[-\d.,\s]+/, '').trim();

    const selDept = bagian(selAdmin(r, 'departemen'));
    const selApproval = selAdmin(r, 'approval');
    const bagianApproval = bagian(selApproval);
    const disetujui = /fa-check/i.test(selApproval)
      ? true
      : /fa-times/i.test(selApproval)
        ? false
        : null;

    hasil.push({
      id: (r.match(/name="ids\[\]"\s+value="(\d+)"/i) || [])[1] || idMap || null,
      idMap,
      nama: selPegawai[0] || '',
      nip: selPegawai[1] || '',
      statusPegawai: selPegawai[2] || '',
      lat: koord ? parseFloat(koord[1]) : null,
      lng: koord ? parseFloat(koord[2]) : null,
      alamatPresensi,
      unitKerja: selDept[0] || '',
      alamatRumah: selDept[1] || '',
      jarak: teksSatu(selAdmin(r, 'jarak')),
      checktype: teksSatu(selAdmin(r, 'checktype')),
      imei: teksSatu(selAdmin(r, 'imei')),
      disetujui,
      waktuApproval: bagianApproval.find((b) => /\d{4}/.test(b)) || '',
      created_at: teksSatu(selAdmin(r, 'created_at')),
      timezone: teksSatu(selAdmin(r, 'timezone')),
      wfh: teksSatu(selAdmin(r, 'iswfh')),
      workCode: teksSatu(selAdmin(r, 'work_code')),
    });
  }
  return hasil;
}

/** Ambil IMEI kehadiran dari HALAMAN PERTAMA saja. */
export async function ambilImei(): Promise<HasilImei> {
  const res = await req(`${PROXY}/p/checkinout`);
  if (!res.ok) throw new Error(`Gagal memuat kehadiran (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  const profil = extractProfil(html);
  const imeis = extractImeis(html);
  return { imei: imeis[0] || null, profil };
}

/** Ambil satu halaman daftar kehadiran lengkap. */
export async function ambilKehadiran({ halaman = 1 }: { halaman?: number } = {}): Promise<HasilKehadiran> {
  const url = `${PROXY}/p/checkinout${halaman > 1 ? `?page=${halaman}` : ''}`;
  const res = await req(url);
  if (!res.ok) throw new Error(`Gagal memuat kehadiran (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  return {
    baris: parseKehadiran(html),
    halaman,
    totalHalaman: hitungTotalHalaman(html),
  };
}

export interface KoordinatPresisi {
  lat: number | null;
  lng: number | null;
}

/** Uraikan koordinat dari fragmen latlong. */
export function parseLatlong(html: string): KoordinatPresisi {
  const lat = (html.match(/Latitude\s*:\s*(-?\d+(?:\.\d+)?)/i) || [])[1];
  const lng = (html.match(/Longitude\s*:\s*(-?\d+(?:\.\d+)?)/i) || [])[1];
  return {
    lat: lat ? parseFloat(lat) : null,
    lng: lng ? parseFloat(lng) : null,
  };
}

/** Ambil koordinat presisi untuk satu baris kehadiran. */
export async function ambilLatlong(idMap: string): Promise<KoordinatPresisi> {
  const res = await req(
    `${PROXY}/p/checkinout/load/action?latlong=${encodeURIComponent(idMap)}`,
  );
  if (!res.ok) throw new Error(`Gagal memuat lokasi (HTTP ${res.status})`);
  return parseLatlong(await res.text());
}

// ---------------------------------------------------------------------------
// 3. Halaman detail pegawai
// ---------------------------------------------------------------------------

export interface TabelData {
  header: string[];
  baris: string[][];
}

export interface DetailPegawai {
  profil: Record<string, string>;
  foto: string | null;
  idPegawai: string | null;
  urlIjin: string | null;
  logLogin: TabelData | null;
  fotoUpload: TabelData | null;
}

/** Cari tabel berdasarkan salah satu judul kolomnya. */
export function tabelDenganHeader(html: string, pola: RegExp): TabelData | null {
  const tabelSemua = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const t of tabelSemua) {
    const header = (t.match(/<th[^>]*>[\s\S]*?<\/th>/gi) || []).map((x) => teksSatu(x));
    if (!header.some((h) => pola.test(h))) continue;
    const baris = (t.match(/<tr[\s\S]*?<\/tr>/gi) || [])
      .filter((r) => /<td/i.test(r))
      .map((r) => selMentah(r).map((c) => teksSatu(c)));
    return { header, baris };
  }
  return null;
}

/** Uraikan halaman "Detail Pegawai". */
export function parseDetailPegawai(html: string): DetailPegawai {
  const profil: Record<string, string> = {};
  const reProfil =
    /<td[^>]*>\s*([^<>]{1,40}?)\s*<\/td>\s*<td[^>]*>\s*:\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let mp: RegExpExecArray | null;
  while ((mp = reProfil.exec(html))) {
    const label = teksSatu(mp[1]);
    if (label) profil[label] = teksSatu(mp[2]);
  }

  const foto = (html.match(/<img[^>]*width="150px"[^>]*src="([^"]+)"/i) || [])[1] || null;
  const idPegawai = (html.match(/\/index\.php\/pegawai\/(\d+)\/ijins/i) || [])[1] || null;
  const urlIjin = idPegawai ? `/p/pegawai/${idPegawai}/ijins` : null;

  return {
    profil,
    foto,
    idPegawai,
    urlIjin,
    logLogin: tabelDenganHeader(html, /^imei$/i),
    fotoUpload: tabelDenganHeader(html, /tanggal upload/i),
  };
}

/** Ambil halaman "Detail Pegawai" milik akun yang login. */
export async function ambilDetailPegawai(): Promise<DetailPegawai> {
  const res = await req(`${PROXY}/p/pegawai/details/action`);
  if (!res.ok) throw new Error(`Gagal memuat detail pegawai (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  return parseDetailPegawai(html);
}

// ---------------------------------------------------------------------------
// 4. Halaman perizinan + berkas lampiran
// ---------------------------------------------------------------------------

export interface BarisIjin {
  id: string | null;
  nama: string;
  nip: string;
  unitKerja: string;
  tipeIjin: string;
  jenisIjin: string;
  tglIjin: string;
  alasan: string;
  catatan: string;
  berkas: string | null;
  disetujui: boolean | null;
  approvalAt: string;
  createdAt: string;
}

export interface HasilPerizinan {
  baris: BarisIjin[];
  halaman: number;
  totalHalaman: number;
}

/** Ambil tautan berkas (uploads/...) pertama dari sebuah sel. */
function ambilBerkasDari(html: string): string | null {
  const m = String(html).match(/(?:href|src)="([^"]*uploads\/[^"]+)"/i);
  return m ? m[1] : null;
}

/** Status approval dari ikon fa-check / fa-times (null bila tidak jelas). */
function statusApproval(html: string): boolean | null {
  if (/fa-check/i.test(html)) return true;
  if (/fa-times/i.test(html)) return false;
  return null;
}

/** Uraikan baris tabel perizinan. */
export function parsePerizinan(html: string): BarisIjin[] {
  const hasil: BarisIjin[] = [];
  const barisSemua = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const r of barisSemua) {
    if (/sf_admin_list_td_jenis_ijin/i.test(r)) {
      const nama = bagian(selAdmin(r, 'nama'));
      hasil.push({
        id: (r.match(/name="ids\[\]"\s+value="(\d+)"/i) || [])[1] || null,
        nama: nama[0] || '',
        nip: nama[1] || '',
        unitKerja: teksSatu(selAdmin(r, 'MDepartemen')),
        tipeIjin: teksSatu(selAdmin(r, 'tipe_ijin')),
        jenisIjin: teksSatu(selAdmin(r, 'jenis_ijin')),
        tglIjin: teksSatu(selAdmin(r, 'tgl_ijin')),
        alasan: teksSatu(selAdmin(r, 'alasan')),
        catatan: teksSatu(selAdmin(r, 'catatan')),
        berkas: ambilBerkasDari(selAdmin(r, 'berkas')),
        disetujui: statusApproval(selAdmin(r, 'approval')),
        approvalAt: teksSatu(selAdmin(r, 'approval_at')),
        createdAt: teksSatu(selAdmin(r, 'created_at')),
      });
      continue;
    }

    const sel = selMentah(r);
    if (sel.length < 8 || !/uploads\/|scope="row"/i.test(r)) continue;
    const nilai = sel.map((c) => teksSatu(c));
    hasil.push({
      id: null,
      nama: '',
      nip: '',
      unitKerja: nilai[1] || '',
      tipeIjin: nilai[2] || '',
      jenisIjin: nilai[3] || '',
      tglIjin: nilai[4] || '',
      alasan: nilai[5] || '',
      catatan: '',
      berkas: ambilBerkasDari(sel[6] || ''),
      disetujui: statusApproval(sel[7] || ''),
      approvalAt: '',
      createdAt: nilai[8] || nilai[7] || '',
    });
  }
  return hasil;
}

/** Ambil "Daftar Ijin" milik pegawai (dimuat via ajax oleh halaman detail). */
export async function ambilIjinPegawai(idPegawai: string): Promise<{ baris: BarisIjin[]; html: string }> {
  const res = await req(`${PROXY}/p/pegawai/${encodeURIComponent(idPegawai)}/ijins`);
  if (!res.ok) throw new Error(`Gagal memuat daftar ijin (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  return { baris: parsePerizinan(html), html };
}

/** Ambil satu halaman daftar perizinan. */
export async function ambilPerizinan({ halaman = 1 }: { halaman?: number } = {}): Promise<HasilPerizinan> {
  const url = `${PROXY}/p/perizinan${halaman > 1 ? `?page=${halaman}` : ''}`;
  const res = await req(url);
  if (!res.ok) throw new Error(`Gagal memuat perizinan (HTTP ${res.status})`);
  const html = await res.text();
  pastikanBukanLogin(html);
  return {
    baris: parsePerizinan(html),
    halaman,
    totalHalaman: hitungTotalHalaman(html),
  };
}

/**
 * Ubah path berkas menjadi URL same-origin lewat proxy.
 */
export function urlBerkas(path: string): string | null {
  if (!path) return null;
  let p = String(path);
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      /* biarkan apa adanya */
    }
  }
  if (/^\/ep\//.test(p)) return p;
  if (!p.startsWith('/')) p = '/' + p;
  return `${PROXY}${p}`;
}

export interface HasilBerkas {
  blob: Blob;
  tipe: string;
  url: string;
}

/** Ambil berkas lampiran lewat proxy (sesi ikut terkirim). */
export async function ambilBerkas(path: string): Promise<HasilBerkas> {
  const url = urlBerkas(path);
  if (!url) throw new Error('Path berkas tidak valid');
  const res = await req(url);
  if (!res.ok) throw new Error(`Gagal memuat berkas (HTTP ${res.status})`);
  const tipe = res.headers.get('content-type') || '';
  const blob = await res.blob();
  return { blob, tipe, url: URL.createObjectURL(blob) };
}
