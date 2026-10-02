/**
 * Uji pra-deploy: apakah aplikasi ini benar-benar siap di Vercel?
 *
 * Sesi-sesi di sini menjawab pertanyaan yang tidak bisa dijawab `npm test`:
 *
 * 1. **Env Vercel terisi?** `/api/health` melaporkan `konfigurasi` dan
 *    `peringatan`. Kalau `ALLOWED_ORIGINS` kosong, gejalanya sangat menyesatkan
 *    — server "sehat", halaman termuat, tapi tiap panggilan API dapat 403.
 *    Health check dibuat justru untuk keadaan itu, tapi hanya berguna kalau
 *    yang didiagnosis benar-benar endpoint-nya. Sesi ini memanggilnya sungguhan.
 *
 * 2. **Login bisa jalan?** Dipakai NIP uji, bukan NIP asli. Yang diperiksa
 *    bentuk responsnya: 401 (NIP tidak dikenal) dan 200 (NIP + password
 *    benar) sama-sama berarti **jalur login sehat** — keduanya membuktikan
 *    proxy, bundel, dan gateway hidup. 403 berarti konfigurasi origin salah;
 *    500 berarti bundel rusak; 502 berarti gateway tak terjangkau.
 *
 * ⚠️ Endpoint produksi hanya dibaca. Tidak ada tagihan, tidak ada
 *    pembayaran, tidak ada penulisan dokumen.
 *
 * Cara pakai:
 *   node tools/cek-deploy-cek.js https://domain.vercel.app
 *
 * Tanpa argumen, hanya memeriksa local build dan keluar dengan kode 0 —
 * karena domain produksi tidak boleh diasumsikan dari repo.
 */
const [, , argumen] = process.argv;

const RETENSI = {
  ok: '\x1b[32m',
  gagal: '\x1b[31m',
  info: '\x1b[36m',
  redup: '\x1b[2m',
  mati: '\x1b[0m',
};

let gagal = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) gagal++;
  console.log(`${ok ? RETENSI.ok + 'OK  ' : RETENSI.gagal + 'FAIL'}${RETENSI.mati} ${nama}${detail ? RETENSI.redup + ` — ${detail}` + RETENSI.mati : ''}`);
};

async function cekHealth(base) {
  console.log(`\n${RETENSI.info}1. /api/health${RETENSI.mati} ${RETENSI.redup}${base}/api/health${RETENSI.mati}`);
  let res;
  try {
    res = await fetch(`${base}/api/health`, { headers: { Accept: 'application/json' } });
  } catch (err) {
    cek('endpoint bisa dihubungi', false, err.message);
    return null;
  }
  cek('endpoint bisa dihubungi', true, `HTTP ${res.status}`);
  if (!res.ok) {
    cek('health menjawab 200 JSON', false, `status ${res.status} — ini yang Vercel perlakukan "This page is unavailable"`);
    return null;
  }
  const data = await res.json().catch(() => null);
  cek('health menjawab JSON', Boolean(data));
  if (!data) return null;

  cek('server hidup', data.ok === true);
  cek('ALLOWED_ORIGINS terisi', data.konfigurasi?.origin === true,
    'kalau false, SETIUP panggilan API dari peramban dapat 403');
  cek('kredensial Firebase Admin ada', data.konfigurasi?.firebase === true,
    'tanpa ini, /api/billing/aktivasi menjawab 503 dan langganan tidak bisa diaktifkan');
  cek('MIDTRANS_SERVER_KEY ada', data.konfigurasi?.midtrans === true,
    'tanpa ini, QRIS otomatis disembunyikan (transfer manual tetap jalan)');
  cek('versi envelope >= 81', Number(data.version) >= 81,
    `versi ${data.version} — di bawah 81 server menolak absen`);

  if (Array.isArray(data.peringatan) && data.peringatan.length > 0) {
    console.log(`\n${RETENSI.gagal}  Peringatan dari server:${RETENSI.mati}`);
    for (const p of data.peringatan) console.log(`   - ${p}`);
  } else {
    console.log(`${RETENSI.ok}  tidak ada peringatan${RETENSI.mati}`);
  }
  return data;
}

async function cekLogin(base, origin) {
  console.log(`\n${RETENSI.info}2. POST /api/rpc object=login${RETENSI.mati}`);
  // NIP uji: formatnya benar, tapi tidak terdaftar. Ini yang membuat
  // balancer membalas 401 — tanda proxy, bundel, dan gateway sehat.
  const body = {
    jsonrpc: '2',
    method: 'POST',
    version: 89,
    object: 'login',
    param: { email: '198501012015011001', password: 'uji-saja-bukan-sandi', latlong: '0,0', imei: '' },
  };
  let res;
  try {
    res = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
  } catch (err) {
    cek('rpc bisa dihubungi', false, err.message);
    return;
  }
  const teks = await res.text();
  cek('rpc menjawab', res.status > 0, `HTTP ${res.status}`);

  if (res.status === 403) {
    cek('origin diterima', false, '403 — ALLOWED_ORIGINS tidak memuat domain ini, atau ditulis tanpa skema');
    return;
  }
  if (res.status === 502 || res.status === 504) {
    cek('gateway terjangkau', false, `status ${res.status} — proxy hidup tapi server pusat tidak menjawab`);
    return;
  }

  let data = null;
  try { data = JSON.parse(teks); } catch { /* dilaporkan di bawah */ }
  cek('rpc menjawab JSON-RPC', Boolean(data?.jsonrpc), teks.slice(0, 90));
  cek('envelope diteruskan (bukan error Vercel)', !/FUNCTION_INVOCATION_FAILED|This page is unavailable/i.test(teks),
    'kalau muncul, bundel api/*.js rusak — cek build log');

  // 200 dengan api_key, atau 401 dari gateway: dua-duanya healthy.
  const pesan = data?.result?.message ?? data?.error?.message ?? '';
  cek('jalur login sehat', res.status === 200 || res.status === 401,
    `status ${res.status}${pesan ? ` — "${String(pesan).slice(0, 60)}"` : ''}`);

  if (data?.error) {
    console.log(`   ${RETENSI.redup}JSON-RPC error: ${data.error.message}${RETENSI.mati}`);
  }
}

(async () => {
  const base = argumen?.replace(/\/$/, '');
  if (!base) {
    console.log('Pakai: node tools/cek-deploy-cek.js https://domain.vercel.app');
    console.log('Domain produksi tidak diasumsikan dari repo — harus diberikan eksplisit.');
    process.exit(0);
  }

  console.log(`${RETENSI.info}Memeriksa ${base}${RETENSI.mati}`);
  const health = await cekHealth(base);
  if (health?.konfigurasi?.origin) {
    await cekLogin(base, base);
  } else {
    console.log(`\n${RETENSI.redup}Login tidak diuji: allow-list origin kosong, hasilnya pasti 403 dan tidak membandingkan apa pun.${RETENSI.mati}`);
  }

  console.log(gagal === 0 ? `\n${RETENSI.ok}SEMUA LULUS${RETENSI.mati}` : `\n${RETENSI.gagal}${gagal} KEGAGALAN${RETENSI.mati}`);
  process.exitCode = gagal === 0 ? 0 : 1;
})();
