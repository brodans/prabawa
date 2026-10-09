/**
 * Dua hal yang harus benar dan mudah rusak:
 *
 * 1. **Titik yang dipilih dikirim sebagai lokasi sungguhan, bukan mock.**
 *
 *    `mock` adalah pernyataan klien — di aplikasi Android nilainya datang
 *    dari `Location.isMock()`. Aplikasi ini tidak punya GPS: koordinatnya
 *    dari titik yang dipilih pengguna di peta. Yang perlu dijaga adalah
 *    bahwa aplikasi **tidak pernah** mengirim `mock: 1`, karena itu akan
 *    membuat server mencatat absen sebagai lokasi simulasi.
 *
 *    Yang diperiksa di sini bukan hanya kode sumber, tapi **payload yang
 *    benar-benar sampai ke gateway**: klien → proxy → gateway. Assert
 *    sumber saja bisa lulus sementara `rpcAbsen` membalikkan nilainya di
 *    suatu tempat di tengah.
 *
 * 2. **Pergantian titik langsung terasa, tanpa jeda.**
 *
 *    `useServerContext` menyegarkan koordinat tiap 5 detik supaya perubahan
 *    dari halaman Lokasi Absen terpakai. Untuk perubahan yang dilakukan di
 *    halaman yang sama, 5 detik itu terlalu lambat: klik "Cek Absensi"
 *    sesaat setelah mengganti titik akan mengirim koordinat **sebelumnya**.
 *    Gejalanya tidak kelihatan di layar — daftar sudah menampilkan titik
 *    yang benar — tapi server mencatat jarak untuk titik yang lain.
 *
 *    Karena itu setter titik wajib memanggil `segarkanTitik()`.
 */
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const baca = (p: string): string => readFileSync(`${root}${p}`, 'utf8');
const kode = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1. Titik pilihan dikirim sebagai lokasi nyata (bukan mock)');

// Dilakukan sungguhan: bangun payload, lewati proxy, periksa yang keluar.
{
  process.env.ALLOWED_ORIGINS = 'https://uji.vercel.app';

  const store = new Map<string, string>();
  const st: Storage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) ?? null : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  globalThis.localStorage = st;
  globalThis.window = { localStorage: st } as unknown as Window & typeof globalThis;

  const { rpcAbsen, rpcCekAbsen } = await import('../src/lib/apiCalls.ts');
  const { default: proxy } = await import('../src/serverless/rpc.ts');
  const { formatLatLong } = await import('../src/lib/presensiContract.ts');
  const { idPerangkat } = await import('../src/lib/idPerangkat.ts');

  const TITIK = { latitude: -7.2900712345, longitude: 112.7031234567 };
  const ctx = {
    apiKey: 'TOKEN',
    lastLatLong: formatLatLong(TITIK.latitude, TITIK.longitude),
    imei: idPerangkat('budi'),
  };

  /**
   * Badan request yang terakhir terlihat, untuk proxy (`/`) dan gateway.
   *
   * Bentuknya objek berisi satu properti, bukan variabel yang di-*assign*
   * dari dalam closure `fetch`. TypeScript tidak melihat assignment di
   * dalam closure, jadi variabel langsung akan disempitkan jadi `null` di
   * semua titik pemakaian — dan `keProxy.param` jadi error yang menyesatkan.
   */
  interface Badan { param: Record<string, unknown> }
  const tether: { proxy: Badan | null; gateway: Badan | null } = { proxy: null, gateway: null };
  /**
   * Body terakhir ke proxy / ke gateway.
   *
   * Keduanya dibaca lewat fungsi, bukan properti langsung. Menulis `tether.X = null`
   * membuat TypeScript menyempitkan `tether.X` jadi `null` sampai baris berikutnya,
   * dan `?.param` di atas `null` itu jadi `never` — bukan `undefined`.
   */
  const paramKeProxy = (): Record<string, unknown> => tether.proxy?.param ?? {};
  const paramKeGateway = (): Record<string, unknown> => tether.gateway?.param ?? {};

  globalThis.fetch = (async (u: URL | RequestInfo, o?: RequestInit) => {
    const body = JSON.parse(String(o?.body ?? '{}')) as Badan;
    if (String(u).startsWith('/')) tether.proxy = body;
    else tether.gateway = body;
    return new Response(
      JSON.stringify({ jsonrpc: 2, id_req: 'X', result: { absen: true, message: 'ok' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;

  /**
   * `res` tiruan: handler proxy hanya butuh method berantai ini, dan
   * chainable stub memastikan setiap panggilan tidak melempar.
   */
  const res = {
    setHeader() { return this; },
    status() { return this; },
    json() { return this; },
    end() { return this; },
    send() { return this; },
  };

  /** Jalankan `param` lewat handler proxy, kembalikan yang sampai ke gateway. */
  const lewatProxy = async (param: Record<string, unknown>): Promise<Record<string, unknown>> => {
    tether.gateway = null;
    await proxy(
      { method: 'POST', headers: { origin: 'https://uji.vercel.app' },
        body: { jsonrpc: '2', method: 'POST', version: 89, object: 'absen', param } },
      res
    );
    return paramKeGateway();
  };

  // `mock: false` persis seperti Presensi mengirimnya.
  await rpcAbsen(ctx, { checkType: 1, workCode: 12, isWfh: false, withIjin: false, mock: false });
  const p1 = await lewatProxy(paramKeProxy());

  cek('mock sampai ke gateway sebagai 0', p1.mock === 0, `nilai=${JSON.stringify(p1.mock)}`);
  cek('mock tidak pernah bernilai 1', p1.mock !== 1);
  cek('tidak ada "mock":true di payload mana pun',
    !JSON.stringify(p1).includes('"mock":true'));

  cek('koordinat identik dengan titik yang dipilih',
    p1.last_latlong === formatLatLong(TITIK.latitude, TITIK.longitude),
    String(p1.last_latlong));

  // Bahkan kalau klien mengirimi `mock: true`, server tidak boleh
  // meneruskannya apa adanya — ini titik yang paling mudah dilewatkan.
  const curang = await lewatProxy({ ...paramKeProxy(), mock: 1 });
  cek('proxy meneruskan mock apa adanya (tidak menyaring)',
    curang.mock === 1,
    'kalau nilai 1 bisa lolos, aplikasi harus menyaringnya sendiri di satu tempat');

  // `cekabsen` tidak punya parameter `mock` sama sekali.
  tether.proxy = null;
  await rpcCekAbsen(ctx, { checkType: 1, workCode: 12, isWfh: false });
  const p2 = await lewatProxy(paramKeProxy());
  cek('cekabsen tidak mengirim mock', !('mock' in p2), Object.keys(p2).join(','));

  // Sumber: tidak ada tempat yang mengarang `mock: true`.
  const presensi = kode(baca('src/pages/Presensi.tsx'));
  cek('Presensi tidak pernah mengirim mock: true', !/mock:\s*true/.test(presensi));
  cek('Presensi mengirim mock secara eksplisit', /mock:\s*false/.test(presensi),
    'kirim 0, bukan andalkan server mengabaikannya');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Koordinat yang dipilih tidak pernah dianggap simulasi');
{
  cek('mock didokumentasikan sebagai pernyataan klien',
    /location\.isMock|isMock\(\)/.test(baca('src/lib/presensiContract.ts')),
    'dokumentasi ini yang menjelaskan kenapa nilainya selalu 0');
  cek('last_latlong disuntik apa adanya dari ctx',
    /last_latlong: ctx\.lastLatLong \?\? ''/.test(baca('src/lib/apiCalls.ts')));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Ganti titik langsung terasa — tidak ada jeda 5 detik');
{
  const ctxSrc = kode(baca('src/hooks/useServerContext.ts'));
  cek('useServerContext mengekspor segarkanTitik',
    /segarkanTitik/.test(ctxSrc),
    'tanpa ini, koordinat baru baru terpakai setelah polling 5 detik');

  // Setiap tempat yang bisa mengganti titik aktif wajib memanggilnya.
  const pemakai = [
    { f: 'src/pages/Presensi.tsx', minimal: 1, why: 'hanya dropdown titik tersimpan; koordinat peta sementara tidak mengubah titik aktif' },
    { f: 'src/pages/LokasiAbsen.tsx', minimal: 2, why: 'pakai titik, salin dari titik server' },
  ];
  for (const { f, minimal, why } of pemakai) {
    const n = (kode(baca(f)).match(/segarkanTitik\(\)/g) ?? []).length;
    cek(`${f.split('/').pop()} memanggil segarkanTitik()`, n >= minimal,
      `${n}x, minimal ${minimal}x (${why})`);
  }

  // Dan memo titikPakai harus bergantung pada state, bukan cuma username.
  // Komentar dibuang: penjelasan kenapa pola lama salah justru menyebut
  // pola itu, dan penyebutan di sana bukan pemakaian.
  const presensi = kode(baca('src/pages/Presensi.tsx'));
  cek('titikPakai diturunkan dari state, bukan hanya dari username',
    /titikPakai = useMemo\(\s*\(\) => titikSaya\.find/.test(presensi),
    'kalau hanya bergantung pada username, kartu koordinat & jarak tidak pernah ikut berubah');
  cek('tidak ada lagi memo titikPakai yang hanya bergantung pada username',
    !/useMemo\(\(\) => bacaTitikAktif\(username\), \[username\]\)/.test(presensi),
    'pola lama masih ada di kode');
  cek('pilihan peta sementara tidak disimpan sebagai titik lokal',
    !/simpanTitik|setTitikAktif/.test(presensi.slice(presensi.indexOf('pilihOpen && ('))),
    'pilihan sementara tidak boleh mengubah daftar/titik aktif di Lokasi Absen');
  cek('koordinat sementara dikirim sebagai last_latlong untuk absensi',
    /lastLatLong:\s*formatLatLong\(koordinat\.latitude,\s*koordinat\.longitude\)/.test(presensi));
  cek('dropdown tetap menandai titik tersimpan yang dipilih di Lokasi Absen',
    /value=\{titikPakai\?\.id \?\? ''\}/.test(presensi));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Absensi tetap mensyaratkan titik');
{
  const presensi = kode(baca('src/pages/Presensi.tsx'));
  cek('tombol Cek Absensi mensyaratkan koordinat',
    /disabled=\{!tabPermissions\.aksiAbsen \|\| !workCodeId \|\| !koordinat\}/.test(presensi),
    'server menghitung geofence dari koordinat yang dikirim — tanpa titik, jarak tidak berarti');
  cek('handleCek menolak kalau koordinat kosong', /if \(!koordinat\)/.test(presensi));
  cek('ada baris jarak ke titik server',
    /Jarak ke Titik Server/.test(baca('src/pages/Presensi.tsx')));
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
if (fail > 0) process.exitCode = 1;
