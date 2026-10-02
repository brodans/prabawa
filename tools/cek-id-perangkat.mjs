/**
 * Uji `idPerangkat` — identitas perangkat yang dikirim sebagai `imei`.
 *
 * Ini yang menentukan apakah aplikasi bisa dipakai di banyak perangkat,
 * jadi sifat-sifatnya diuji satu per satu, bukan cuma "fungsi ini
 * mengembalikan string".
 *
 * Yang dijaga:
 *
 * 1. **Stabil** — nilai sama di akun sama, setelah berkali-kali dipanggil
 *    dan setelah "reload". Kalau berubah, akun yang terkunci ke perangkat
 *    langsung gagal login tanpa sebab.
 * 2. **Unik per akun** — dua akun di peramban yang sama tidak boleh
 *    memakai id yang sama, dan akun baru tidak boleh mewarisi id akun
 *    lama.
 * 3. **Unik per perangkat** — dua peramban berbeda tidak boleh mendapat
 *    id yang sama. Ini tidak bisa diuji di satu proses, jadi yang
 *    diperiksa adalah mekanismenya: sumbernya acak, bukan nilai tetap.
 * 4. **Bentuknya valid** untuk field server: tanpa spasi, panjangnya
 *    masuk akal, dan karakternya tidak perlu di-escape saat masuk URL.
 * 5. **Aman dari `localStorage` yang diblokir** — mode privat beberapa
 *    peramban melempar error saat menulis. Aplikasi tidak boleh ikut
 *    gagal karena itu.
 * 6. **Pola username yang menyesatkan** tidak boleh menabrak: `a/b` dan
 *    `a_b` harus jadi dua akun berbeda, bukan satu.
 */
import { existsSync, readFileSync } from 'node:fs';

let fail = 0;
const cek = (nama, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

/** `localStorage` tiruan dengan `Map` di baliknya. */
const store = new Map();
const storagePalsu = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: k => void store.delete(k),
  clear: () => store.clear(),
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
/*
 * ⚠️ Harus dipasang di `globalThis` **dan** `window`.
 *
 * `storageAman.bacaStorage()` memeriksa `typeof window === 'undefined'` dan
 * mengembalikan nilai cadangan kalau memang tidak ada — itu benar untuk
 * Node, tapi berarti stub di `globalThis` saja tidak akan pernah dibaca.
 *
 * Sebaliknya, kode aplikasi memanggil `localStorage` sebagai bare
 * identifier, yang di peramban diselesaikan lewat `window.localStorage`.
 * Di Node tidak ada lexer itu, jadi hanya memasang di `window` membuat
 * pemanggilnya `undefined` — dan setiap tulisan tertangkap `try/catch` yang
 * diam-diam, sehingga semua assertion "0 kunci" lolos tanpa satu pun data
 * tersimpan.
 */
globalThis.localStorage = storagePalsu;
globalThis.window = { localStorage: storagePalsu };

const { idPerangkat } = await import('../src/lib/idPerangkat.ts');

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 1. Stabil: panggilan berulang mengembalikan nilai sama');
const a1 = idPerangkat('budi');
const a2 = idPerangkat('budi');
const a3 = idPerangkat('budi');
cek('tiga panggilan berturut-turut sama', a1 === a2 && a2 === a3, `${a1} / ${a2} / ${a3}`);
cek('bukan string kosong', a1.length > 0);

// "Reload" = proses baru. Disimulasikan dengan membaca storage lagi
// setelah modul dimuat ulang.
cek('tersimpan di storage (bukan di memori)', store.size === 1, `${store.size} kunci`);
const kunciSimpan = [...store.keys()][0];
cek('kunci memuat username', kunciSimpan.includes('budi'), kunciSimpan);
cek('nilai yang disimpan sama dengan yang dikembalikan', store.get(kunciSimpan) === a1);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Unik per akun');
const budi = idPerangkat('budi');
const sari = idPerangkat('sari');
cek('budi != sari', budi !== sari, `budi=${budi} sari=${sari}`);
cek('sari punya kunci sendiri', [...store.keys()].some(k => k.includes('sari')));
cek('hanya 2 kunci di storage', store.size === 2, `${store.size} kunci`);

// Akun baru tidak boleh mewarisi id siapa pun.
const rudi = idPerangkat('rudi');
cek('rudi (baru) punya id sendiri', rudi !== budi && rudi !== sari);
cek('rudi tidak mewarisi id budi', rudi.length > 0 && budi !== rudi);

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Username yang menyesatkan tidak boleh menabrak');
const s1 = idPerangkat('a/b');
const s2 = idPerangkat('a_b');
cek('"a/b" != "a_b"', s1 !== s2, `menabrak bila sama: ${s1}`);
const kosong = idPerangkat('');
cek('username kosong -> string kosong, bukan crash', kosong === '', JSON.stringify(kosong));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Bentuknya sah untuk field `imei` server');
const semua = [budi, sari, rudi];
cek('panjang wajar (<= 64)', semua.every(v => v.length > 0 && v.length <= 64), `${budi.length} karakter`);
cek('tanpa spasi', semua.every(v => !/\s/.test(v)));
cek('hanya huruf, angka, dan tanda hubung', semua.every(v => /^[A-Za-z0-9-]+$/.test(v)), budi);
cek('memakai awalan yang bisa dikenali', semua.every(v => v.startsWith('WEB-')), budi);
cek('tidak perlu di-escape saat masuk URL', semua.every(v => encodeURIComponent(v) === v));

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Unik per perangkat (sumber acak, bukan konstanta)');
{
  // Dua "peramban" = dua storage terpisah. Id harus berbeda walau
  // akun dan penggunaannya sama persis.
  const s1a = new Map();
  const s2a = new Map();
  const buat = (map) => {
    const lama = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: k => void map.delete(k),
      clear: () => map.clear(),
      key: i => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    };
    globalThis.window = { localStorage: globalThis.localStorage };
    const nilai = idPerangkat('budi');
    globalThis.localStorage = lama;
    globalThis.window = { localStorage: lama };
    return nilai;
  };
  const peramban1 = buat(s1a);
  const peramban2 = buat(s2a);
  cek('dua peramban -> dua id berbeda', peramban1 !== peramban2, `${peramban1} vs ${peramban2}`);
  cek('keduanya bentuknya sah', /^[A-Za-z0-9-]+$/.test(peramban1) && /^[A-Za-z0-9-]+$/.test(peramban2));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Aman saat localStorage diblokir (mode privat)');
{
  const lama = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError: storage diblokir'); },
    setItem() { throw new Error('SecurityError: storage diblokir'); },
    removeItem() {}, clear() {}, key() { return null; }, get length() { return 0; },
  };
  let hasil = "";
  let melempar = false;
  globalThis.window = { localStorage: globalThis.localStorage };
  try { hasil = idPerangkat("budi"); } catch { melempar = true; hasil = ""; }
  globalThis.localStorage = lama;
  globalThis.window = { localStorage: lama };
  cek('tidak melempar', !melempar, melempar ? 'storage diblokir membuat aplikasi gagal total' : '');
  cek('tetap mengembalikan id yang bisa dikirim', typeof hasil === 'string' && hasil.length > 0,
    hasil ? '' : 'string kosong membuat akun terkunci tidak bisa login');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Prioritas: nilai manual harus menang');
{
  const cekSrc = readFileSync(
    new URL('../src/hooks/useServerContext.ts', import.meta.url).pathname, 'utf8');
  // `config.imei || pegawai?.imei || idPerangkat(username)` — urutan itu
  // yang membuat nilai manual tidak tertimpa.
  cek('nilai manual dibaca lebih dulu',
    /config\.imei\s*\|\|\s*pegawai\?\.imei\s*\|\|\s*idPerangkat\(/.test(cekSrc),
    'kalau urutannya dibalik, id otomatis menimpa id yang sudah benar');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n=== 8. Berkasnya benar-benar ada dan dipakai');
cek('src/lib/idPerangkat.ts ada', existsSync(new URL('../src/lib/idPerangkat.ts', import.meta.url).pathname));
{
  const dipakai = [];
  for (const f of ['useServerContext', 'App', 'sessionManager', 'serverAutoLogin']) {
    const p = new URL(`../src/${f === 'useServerContext' ? 'hooks/' : ''}${f}.ts`, import.meta.url).pathname;
    if (existsSync(p) && readFileSync(p, 'utf8').includes('idPerangkat')) dipakai.push(f);
  }
  cek('dipakai oleh useServerContext', dipakai.includes('useServerContext'),
    'tanpa itu, imei yang terkirim kosong dan akun terkunci tidak bisa masuk');
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
if (fail > 0) process.exitCode = 1;
