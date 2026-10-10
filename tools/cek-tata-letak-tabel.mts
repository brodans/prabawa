/**
 * Tata letak tabel & panel pengaturan.
 *
 * Skrip lain membuktikan fitur **berfungsi**. Skrip ini membuktikan
 * tampilannya **terbaca** — kelas yang salah tidak pernah menghasilkan error,
 * hanya nominal yang tidak terlihat dan tabel yang escalate jadi dua baris.
 *
 * Yang diuji:
 *
 * 1. **Aksi baris pakai satu menu, bukan tumpukan ikon.** Empat ikon 36 px
 *    tidak muat di kolom 168 px, jadi `flex-wrap` memecahnya jadi dua baris
 *    dan tinggi setiap baris tabel ikut naik.
 * 2. **Kolom tanggal punya lebar eksplisit.** Tanpa itu kolomnya bersaing
 *    dengan kolom `truncate`, dan truncate-lah yang kalah — tanggal ikut
 *    terpotong padahal formatnya cuma 10 karakter.
 * 3. **Penyaring memberi lebar sesuai isi field.** `DatePicker` yang hanya
 *    dapat 2 dari 12 kolom akan terpotong.
 * 4. **Judul halaman ikut berubah saat tab berganti.**
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const baca = (p: string): string => readFileSync(join(root, p), 'utf8');
/** Buang komentar supaya hanya kode yang benar-benar dijalankan. */
const kode = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

let fail = 0;
const cek = (nama: string, ok: unknown, detail = ''): void => {
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nama}${detail ? ` — ${detail}` : ''}`);
};

const langganan = kode(baca('src/pages/Langganan.tsx'));
const laporan = kode(baca('src/pages/Laporan.tsx'));
const manajemen = kode(baca('src/pages/ManajemenAkun.tsx'));
const login = kode(baca('src/components/LoginScreen.tsx'));
const statusMidtrans = kode(baca('src/components/StatusMidtrans.tsx'));
const perizinan = kode(baca('src/pages/Perizinan.tsx'));
const surface = kode(baca('src/components/ui/Surface.tsx'));

// ═══ 1. Aksi baris: satu menu ═══════════════════════════════════════

console.log('\n=== 1. Aksi baris tabel Langganan');

/*
 * ⚠️ Empat tombol ikon 36 px = 144 px + celah, sedangkan kolom aksinya hanya
 * 168 px. `flex-wrap` memecah sisanya ke baris kedua, dan tinggi tiap baris
 * tabel ikut naik. Di tabel tagihan lebih parah: tiga tombol (108 px) di
 * 92 px.
 *
 * Satu tombol "⋯" memakai 40 px, jadi kolom aksi menyusut dan lebar yang
 * dibebaskan kembali ke kolom yang butuh.
 */
const kolomAksi = [...langganan.matchAll(/key: 'aksi'[\s\S]{0,400}?className: '([^']+)'/g)];
cek('tabel tagihan punya satu kolom aksi', kolomAksi.length === 1,
  `${kolomAksi.length} ditemukan`);

for (const m of kolomAksi) {
  const lebar = m[1];
  const px = Number((lebar.match(/w-\[(\d+)px\]/) ?? [])[1] ?? 0);
  cek(`kolom aksi cukup untuk satu tombol (${lebar})`, px > 0 && px <= 64,
    'lebar di atas 64 px berarti ada tempat untuk ikon bertumpuk yang tidak muat');
}
cek('kolom aksi memakai AksiMenu, bukan tumpukan AksiIcon',
  (langganan.match(/<AksiMenu/g) ?? []).length === 1,
  'AksiIcon dipakai di kolom aksi = tombol akan membungkus');
cek('AksiMenu punya label aksesibel per baris',
  /ariaLabel=\{`Aksi tagihan \$\{item\.orderId\}`\}/.test(langganan),
  'tanpa label, pembaca layar tidak tahu tagihan yang dipilih');
cek('tabel akun menggabungkan aksi langganan ke satu menu per akun',
  /key: 'aksi'[\s\S]{0,1200}<AksiMenu[\s\S]{0,100}ariaLabel=\{`Kelola langganan \$\{row\.akun\.username\}`\}/.test(manajemen),
  'aksi langganan harus mengikuti tabel akun gabungan, bukan tabel pantau terpisah');
cek('item menu punya id stabil untuk React',
  !/items=\{\[[\s\S]{0,200}?id: ['"]\d/.test(langganan),
  'id berbasis index membuat React salah mencocokkan item saat daftar berubah');

// ═══ 2. Menu melayang: satu implementasi, dipakai semua ══════════════

console.log('\n=== 2. Menu melayang (AksiMenu & TombolMenu)');
{
  /*
   * ⚠️ Perilaku menu ini **tidak lagi hidup di `AksiMenu.tsx`**. Saat
   * `TombolMenu` (pilihan format unduhan) ditambahkan, penempatan panelnya
   * disalin — lalu dua salinan mulai berbeda: `TombolMenu` lupa
   * `fokusKembali`, ambangnya mulai melenceng, dan tidak ada yang bisa
   * bilang mana yang benar.
   *
   * Sekarang aturannya satu: `menuTerdapat.ts` (`useMenuLayang`). Yang
   * diuji di sini adalah **aturan itu**, dan yang diuji di kedua pemanggil
   * hanyalah bahwa mereka benar-benar memakainya — bukan menyalin
   *Placement-nya lagi.
   */
  const menu = kode(baca('src/components/ui/menuTerdapat.ts'));
  const aksi = kode(baca('src/components/ui/AksiMenu.tsx'));
  const tombol = kode(baca('src/components/ui/TombolMenu.tsx'));

  cek('menuTerdapat.ts ada', menu.includes('export function useMenuLayang'));
  cek('kedua menu memakai useMenuLayang, bukan implementasi sendiri',
    /useMenuLayang\(\{/.test(aksi) && /useMenuLayang\(\{/.test(tombol),
    'satu menu menyalin placement = dua angka yang bisa berbeda');
  cek('tidak ada lagi getBoundingClientRect di luar menuTerdapat',
    !/getBoundingClientRect/.test(aksi) && !/getBoundingClientRect/.test(tombol),
    'mengukur sendiri di pemanggil berarti aturan placement bocor lagi');
  cek('menu diposisikan fixed, bukan absolute',
    /KELAS_PANEL_MENU =[\s\S]*?'fixed /.test(menu) && /z-\[61\]/.test(menu),
    'absolute akan terpotong oleh overflow-x-auto pada DataTable');
  cek('ada penutup layar penuh di kedua menu',
    /fixed inset-0/.test(aksi) && /fixed inset-0/.test(tombol),
    'tanpa itu menu hanya bisa ditutup dengan klik tepat di panel');
  cek('Escape menutup menu dan mengembalikan fokus',
    /Escape/.test(menu) && /pemicuRef\.current\?\.focus\(\)/.test(menu) &&
      /fokusKembali = true/.test(menu),
    'bawaan true: menu yang menutup tapi tidak mengembalikan fokus membuat pengguna papan ketik kehilangan tempatnya');
  cek('menu ikut tertutup saat tabel di-scroll',
    /addEventListener\('scroll', tutup, true\)/.test(menu),
    'panel fixed akan tertinggal di baris yang sudah tidak ada');
  cek('arah buka dihitung dari ruang, bukan angka tetap',
    /getBoundingClientRect/.test(menu) && /ruangBawah/.test(menu) && /ruangAtas/.test(menu));
  cek('peran ARIA menu diisi di kedua menu',
    /role="menu"/.test(aksi) && /role="menuitem"/.test(aksi) &&
      /role="menu"/.test(tombol) && /role="menuitem"/.test(tombol));
  /*
   * Item ber-`hint` tidak boleh dihitung setinggi item biasa: kalau tidak,
   * menu format unduhan opened ke atas memakai tinggi yang terlalu kecil.
   */
  cek('perkiraan tinggi memperhitungkan item ber-hint',
    /item\.hint \? TINGGI_ITEM_HINT : TINGGI_ITEM/.test(menu) &&
      /TINGGI_ITEM_HINT = 6\d/.test(menu),
    'satu rumus untuk dua bentuk menu = salah satu salah tempat');
  cek('panel yang memuat hint boleh lebih lebar dan hint-nya membungkus',
    /LEBAR_PANEL_HINT = 2\d\d/.test(menu) &&
      /lebar: adaHint \? LEBAR_PANEL_HINT : LEBAR_PANEL/.test(tombol) &&
      !/truncate[^"]*">\{item\.hint\}/.test(tombol) && /break-words/.test(tombol),
    'di 200 px + truncate, "…(riwayat + rekap)…" terpotong dan alasan pilihannya hilang');
}

// ═══ 3. Kolom tanggal punya lebar eksplisit ══════════════════════════

console.log('\n=== 3. Kolom tanggal Laporan tidak boleh ikut terpotong');
for (const namaKolom of ['tanggal', 'waktu']) {
  const m = laporan.match(new RegExp(`key: '${namaKolom}'[\\s\\S]{0,400}?className: 'w-\\[\\d+px\\]'`));
  cek(`kolom "${namaKolom}" punya lebar eksplisit`, Boolean(m),
    'tanpa w-*, kolom ini bersaing dengan kolom truncate dan kalah');
}
cek('kolom Pegawai tetap boleh truncate',
  /key: 'nama'[\s\S]{0,300}?truncate/.test(laporan),
  'memotong namaPegawai itu wajar; memotong tanggal tidak');
/*
 * ⚠️ `truncate` **tidak membatasi apa pun** tanpa plafon `max-width`.
 *
 * Di tabel `table-layout: auto`, min-content sebuah sel tetap sebesar teks
 * penuhnya: `white-space: nowrap` tidak pernah membungkus, jadi `overflow:
 * hidden` + `text-overflow: ellipsis` tidak punya apa pun untuk dipotong.
 * Diukur di DOM, nama panjang + departemen panjang membuat kolom Pegawai
 * melebar 277 px dan tabel 686 px — sedangkan wadah di 1024 px hanya 644 px
 * (sidebar melebar ke `w-64` tepat di titik itu, jadi wadah justru menyempit
 * dibanding 768 px). Kolom paling kanan keluar layar justru di lebar yang
 * biasanya dianggap aman.
 *
 * Yang benar-benar menurunkan min-content hanyalah `max-width` pada sel
 * atau isinya: `min-w-0` saja, begitu juga `max-w-0 w-full`, keduanya tetap
 * mengukur teks penuh. Karena itu plafonnya wajib ada di setiap kolom yang
 * isinya `truncate` dan tidak dikunci lebarnya.
 */
/*
 * Guard yang sama, tapi untuk **semua** tabel — bukan hanya Laporan.
 *
 * Alasannya di atas: `truncate` tanpa plafon `max-width` tidak memotong apa
 * pun, dan tabel yang melebar melebihi wadahnya mendorong kolom paling kanan
 * keluar layar persis di lebar yang biasanya dianggap aman (1024 px, ketika
 * sidebar melebar ke `w-64` dan wadah justru menyempit).
 *
 * Blok kolom dibaca dengan memotong pada `key:` berikutnya, jadi skrip ini
 * tidak perlu menebak-nebak batas blok dengan jendela karakter — yang dulu
 * gagal diam-diam begitu ada satu kolom lagi.
 */
console.log('\n=== 3b. Setiap kolom ber-truncate wajib punya plafon lebar');
for (const [namaBerkas, sumber] of [
  ['Laporan', laporan],
  ['Perizinan', perizinan],
  ['Langganan', langganan],
  ['Manajemen Akun', manajemen],
]) {
  const kunci = [...sumber.matchAll(/key: '([\w-]+)'/g)];
  const bermasalah: string[] = [];
  kunci.forEach((m, i) => {
    const awal = m.index;
    // Batas blok: `key:` berikutnya, atau tutup daftar kolom (`  ];`) kalau
    // kolom ini yang terakhir. Tanpa batas kedua itu, kolom terakhir ikut
    // menelan seluruh isi berkas dan `truncate` di helper lain di bagian
    // bawah ikut terhitung sebagai miliknya.
    const tutup = sumber.indexOf('\n  ];', awal);
    const akhir = Math.min(
      kunci[i + 1]?.index ?? sumber.length,
      tutup === -1 ? sumber.length : tutup
    );
    const blok = sumber.slice(awal, akhir);
    if (!/\btruncate\b/.test(blok)) return;
    if (/max-w-\[/.test(blok)) return;
    // Kolom yang dikunci `w-[..px]` masih boleh: lebarnya sudah pasti.
    if (/className: '[^']*w-\[\d+px\]/.test(blok)) return;
    bermasalah.push(m[1]);
  });
  cek(
    `kolom ber-truncate di ${namaBerkas} semuanya punya plafon`,
    bermasalah.length === 0,
    bermasalah.length
      ? `kolom ini: ${bermasalah.join(', ')} — min-content-nya ikut seluruh teks dan tabel keluar wadahnya`
      : ''
  );
}

// ═══ 3c. Kartu ↔ tabel ditentukan pengukuran, bukan breakpoint ═══════

console.log('\n=== 3c. DataTable mengukur, bukan menebak breakpoint');
{
  /*
   * ⚠️ Ini yang menggantikan `md:hidden` / `hidden md:block`.
   *
   * Breakpoint viewport **tidak bisa** jadi penentu, dan alasannya sudah
   * diukur dua kali:
   *
   *   1. min-content tiap tabel berbeda jauh — Laporan 629 px, Perizinan
   *      817 px, Riwayat Izin 994 px. Satu ambang yang benar untuk Laporan
   *      membuat Riwayat Izin tetap tergulir horizontal di viewport yang
   *      sama.
   *   2. lebar wadah **tidak monoton** terhadap lebar viewport. Sidebar
   *      melebar ke `w-64` tepat pada `lg` (1024 px), jadi wadah di 1024 px
   *      (644 px) justru lebih sempit daripada di 768 px (660 px) — tepat di
   *      layar yang biasanya dianggap aman. Jendela yang dikecilkan juga
   *      menggeser lebar tanpa menyentuh breakpoint sama sekali.
   *
   * CSS murni tidak bisa membaca salah satu dari keduanya. Jadi `DataTable`
   * mengukur min-content tabel dari klon tersembunyi lalu membandingkannya
   * dengan lebar wadah sebenarnya.
   */
  cek('memakai ResizeObserver untuk mengulang pengukuran',
    /new ResizeObserver\(/.test(surface),
    'tanpa observer, menggeser jendela tidak pernah mengubah pilihan kartu/tabel');
  cek('mengukur min-content lewat wadah min-content',
    /width:min-content/.test(surface) && /cloneNode\(true\)/.test(surface),
    'lebar klon harus dipaksa min-content; mengukur `offsetWidth` tabel asli selalu salah karena `w-full`');
  cek('keputusan muat/tidak memakai state, bukan kelas breakpoint',
    /setMuatTabel\(/.test(surface) && /TOLERANSI_PX/.test(surface),
    'tanpa toleransi, selisih pecahan piksel dari getBoundingClientRect bisa menukar tampilan');
  cek('hanya satu dari kartu/tabel yang dirender lewat satu flag',
    /const \[muatTabel, setMuatTabel\] = useState/.test(surface),
    'dua kondisi independen bisa menampilkan keduanya sekaligus');
  cek('kartu disembunyikan kalau tabel muat',
    /muatTabel \? 'hidden ' : ''/.test(surface) && /muatTabel \? '' : 'hidden '/.test(surface));
  cek('override cetak tetap ada setelah visibility pindah ke JS',
    /print:!block/.test(surface) && /print:hidden/.test(surface),
    'media query cetak menilai lebar kertas, bukan lebar wadah layar');
  cek('wadah lebar 0 tidak dianggap "tidak muat"',
    /tersedia <= 0\) return/.test(surface),
    'tab tersembunyi punya clientWidth 0; menghitungnya sebagai "tidak muat" merusak tampilan saat tab dibuka lagi');
  cek('pengukuran diulang saat rows/columns berubah',
    /ukurRef\.current\(\);\s*\}, \[rows, columns\]\)/.test(surface),
    'isi baris ikut menentukan min-content; tabel bisa berhenti muat setelah disaring');
  cek('tidak ada pasangan breakpoint lama yang tersisa',
    !/md:hidden/.test(surface) && !/hidden md:block/.test(surface) && !/AMBANG_TABEL/.test(surface),
    'salah satunya masih ada berarti salah satu dari dua tampilan bisa bocor');
  cek('kartu mobile DataTable memakai baris label/nilai yang simetris',
    /dl className="divide-y[^\"]*"[\s\S]*?grid min-w-0 grid-cols-\[minmax\(0,0\.9fr\)_minmax\(0,1\.1fr\)\][\s\S]*?text-right text-sm/.test(surface),
    'label dan isi harus tetap satu baris dan dipisahkan garis, bukan menumpuk bebas');
  cek('tidak ada peta ambang container-query',
    !/@min-\[/.test(surface),
    'kunci container-query harus literal per ambang dan cepat basi begitu ada kolom baru');
}

// ═══ 4. Lebar penyaring mengikuti isi field ═════════════════════════

console.log('\n=== 4. Penyaring Laporan & Paket Langganan');
{
  /*
   * ⚠️ Yang dijaga di sini berubah, dan sama sekali bukan detail kecil.
   *
   * Semula ada empat field — Jenis Laporan, Dari, Sampai, dan "Format
   * Unduhan" — yang dibagi `lg:col-span` 4 + 2 + 2 + 4 supaya totalnya tepat
   * 12. Field "Format Unduhan" **dihapus**, karena nilainya tidak pernah
   * dibaca apa pun: tombol "Cetak" selalu mencetak dan "Ekspor" selalu
   * mengunduh CSV, apa pun yang dipilih di sana. Memilihannya juga menyalakan
   * ulang `hasLoadedOnce`, jadi satu pilihan menembakkan ulang seluruh
   * 1 + jumlah hari permintaan `history_absen` — sampai 63 — untuk data yang
   * hasilnya identik.
   *
   * Sisa tiga field memakai `grid-cols-1 sm:grid-cols-3`: setiap field dapat
   * ruang yang sama, dan tidak ada lagi porsi satu atau dua kolom yang
   * membuat `DatePicker` (ikon kalender + tanggal + chevron) terpotong di
   * lebar tablet. Itulah yang dilaporkan sebagai "kolom tanggal kepotong".
   */
  cek('penyaring Laporan memakai tiga kolom sejak layar kecil',
    /grid grid-cols-1 sm:grid-cols-3 gap-4/.test(laporan),
    'tiga field, tiga kolom — setiap field dapat ruang yang sama');
  cek('tidak ada lagi porsi satu atau dua kolom di penyaring',
    !/lg:col-span-[12]\b/.test(laporan),
    'porsi di bawah 3 dari 12 membuat kolom tanggal terpotong');
  cek('tidak ada lagi field "Format Unduhan"',
    !/aria-label="Format unduhan"/.test(laporan) && !/patch\(\{ format/.test(laporan),
    'nilainya tidak pernah dibaca; hanya menambah satu kolom dan satu muatan ulang');

  /*
   * Baris paket: tidak boleh 12 kolom sejak `sm`. Di 640 px satu kolom hanya
   * ±34 px, jadi field Harga (prefix "Rp" + angka beribu-ribu) terpotong.
   */
  const awal = langganan.indexOf('draft.paket.map');
  const akhir = langganan.indexOf('paketEfektif(draft)', awal);
  const blok = langganan.slice(awal, akhir);
  cek('tidak ada grid 12+ kolom di breakpoint kecil',
    !/(?:^|[\s:])sm:grid-cols-(?:1[2-9]|[2-9]\d)/.test(blok),
    'grid 12 kolom sejak 640 px = field Harga terpotong');
  cek('field Harga dapat minimal 3 dari 12 kolom',
    /xl:col-span-([3-9]|1\d)[^"]*"[^>]*>\s*<Field label="Harga"/.test(blok),
    '"Rp 1.500.000" tidak muat di bawah 3/12');
}

// ═══ 5. Judul konsisten di paling atas ══════════════════════════════

console.log('\n=== 5. Tab Manajemen Akun terpadu');
/*
 * Judul halaman dihapus karena nama menu sudah terlihat di top bar. Halaman
 * langsung dimulai dari tiga tab yang masing-masing menjelaskan isinya.
 */
cek('judul halaman duplikat tidak dirender',
  !/<PageHeader/.test(manajemen) && !/<PageHeader/.test(langganan),
  'nama halaman sudah tersedia di top bar');
cek('tiga tab menjelaskan isi halaman',
  /label: 'Manajemen Akun'/.test(manajemen) &&
    /label: 'Riwayat Pembayaran'/.test(manajemen) &&
    /label: 'Metode Pembayaran'/.test(manajemen),
  'daftar akun, riwayat tagihan, dan konfigurasi pembayaran terpisah jelas');
cek('tablist mendahului isi tab',
  manajemen.indexOf('role="tablist"') < manajemen.indexOf('<KelolaAkun'),
  'halaman dimulai dari navigasi tanpa header duplikat');
cek('ringkasan angka tidak diulang di subjudul',
  !/Pantau \$\{statistik/.test(langganan),
  'angka yang sama sudah ditulis di StatTile tepat di bawahnya');
cek('aksi riwayat pembayaran tetap tersedia',
  /Muat Ulang/.test(langganan) && /Hapus Semua/.test(langganan),
  'aksi muat ulang dan hapus semua tetap berada di kartu riwayat pembayaran');
cek('keterangan "Admin memantau" dihapus dari tab langganan',
  !/Admin memantau/.test(langganan));

// ═══ 6. Baris paket: kolom lurus ═══════════════════════════════════

console.log('\n=== 6. Kolom baris paket sejajar');
/*
 * `Field` merender `label → input → hint`, jadi field ber-hint **lebih
 * tinggi** daripada yang tidak punya. Dengan `items-end`, yang sejajar adalah
 * bawah wrapper — sehingga field ber-hint terlihat melayang, dan tombol yang
 * tidak punya `Field` mendarat di garis paling bawah: sejajar dengan teks
 * hint, bukan dengan input.
 *
 * Karena itu syaratnya: **tidak ada `hint` di field mana pun dalam baris
 * paket**. Penjelasan dipindah ke baris ringkasan di bawahnya.
 */
{
  const awal = langganan.indexOf('draft.paket.map');
  const akhir = langganan.indexOf('paketEfektif(draft)', awal);
  const blok = langganan.slice(awal, akhir);
  cek('tidak ada `hint` di field dalam baris paket',
    !/<Field[^>]*label="[^"]*"[^>]*\bhint=/.test(blok),
    'field ber-hint lebih tinggi → dengan items-end, input-nya melayang');
  cek('penjelasan durasi tetap ada di baris ringkasan',
    /Dipakai pengguna sebagai/.test(blok) && /deskripsiDurasi/.test(blok),
    'hint satuan dihapus, jadi ringkasannya yang memikul penjelasannya');
  cek('tombol hapus setinggi Input dan melebar aman di mobile sempit',
    /className="h-10 w-full min-w-0 sm:w-10"/.test(blok),
    'tinggi 40 px sama dengan Input; lebar ikut sel pada mobile dan kembali 40 px di desktop');
  cek('AksiIcon menerima className',
    /className = ''/.test(langganan) && /\$\{className\}/.test(langganan),
    'tanpa ini penyesuaian tinggi tidak bisa lewat dari pemanggil');
}

// ═══ 7. Teks yang diminta dihapus ═══════════════════════════════════

console.log('\n=== 7. Teks yang diminta untuk dihapus');
cek('nomor versi tidak lagi di layar login',
  !/v\{APP_VERSION\}/.test(login),
  'user meminta "1.0.0" di login screen dihapus');
cek('StatusMidtrans tidak lagi menampilkan nama env var',
  !/VITE_MIDTRANS_CLIENT_KEY/.test(statusMidtrans) &&
    !/label: 'MIDTRANS_SERVER_KEY'/.test(statusMidtrans),
  'nama env var tidak bisa diisi dari panel, jadi tidak membantu');
cek('StatusMidtrans tidak lagi mengulang status toggle',
  !/label: 'Toggle di halaman ini'/.test(statusMidtrans),
  'mengulang checkbox 20 px di atasnya');
cek('StatusMidtrans tidak lagi mengulang "metode akan muncul"',
  (statusMidtrans.match(/Metode ini tampil untuk pengguna/g) ?? []).length === 1);

// ═══ 8. Panel developer: tombol tutup & ketahanan layout ═════════════

console.log('\n=== 8. Panel developer & top bar');
{
  const dev = kode(baca('src/components/DeveloperInspector.tsx'));
  const app = kode(baca('src/App.tsx'));
  const mq = kode(baca('src/hooks/useMediaQuery.ts'));

  /*
   * ⚠️ Tombol "×" pernah memanggil
   * `window.dispatchEvent(new Event('close-developer-inspector'))` — dan
   * **tidak ada listener untuk event itu di mana pun**. Tombolnya terlihat
   * berfungsi dan sama sekali tidak melakukan apa pun.
   *
   * Yang dijaga: panel menerima `onClose` dan `App.tsx` meneruskannya ke
   * `setDeveloperMode(false)`. Tidak ada event yang bisa kehilangan pendengar.
   */
  cek('tidak ada lagi event close-developer-inspector', !/close-developer-inspector/.test(dev));
  cek('DeveloperInspector menerima onClose', /onClose: \(\) => void/.test(dev));
  cek('App.tsx meneruskan setDeveloperMode ke onClose',
    /<DeveloperInspector[\s\S]{0,300}onClose=\{\(\) => setDeveloperMode\(false\)\}/.test(app),
    'tanpa ini tombol × kembali jadi tidak berfungsi');

  /*
   * Breakpoint harus berupa **state**, bukan `window.innerWidth` saat render.
   *
   * Versi lama membacanya langsung di badan render, sehingga memutar HP
   * tidak memindahkan panel ke mode yang benar — gejalanya "tampilan rusak
   * setelah diputar".
   */
  cek('DeveloperInspector memakai useMediaQuery', /useMediaQuery\(/.test(dev));
  cek('tidak ada percabangan mode yang bergantung pada innerWidth',
    !/window\.innerWidth\s*<|window\.innerWidth\s*>/.test(dev),
    'pola ini tidak bereaksi pada perubahan ukuran/orientasi');
  cek('useMediaQuery melepas listener saat unmount',
    /removeEventListener\('change'/.test(mq),
    'tanpa pelepasan, listener menumpuk setiap kali komponen dipasang ulang');
  cek('breakpoint inspector dinaikkan ke 1280',
    /BP_INSPECTOR_SIDEBAR = 1280/.test(mq),
    'di 1024–1279 px, sidebar + panel menyisakan hanya ~420 px untuk konten');

  /*
   * Nilai harus benar sejak render pertama.
   *
   * `useState(false)` + `useEffect` reaktif tapi render pertamanya selalu salah:
   * di desktop tombol kecil muncul satu frame sebelum melenting menjadi panel
   * lebar. `useSyncExternalStore` membaca `matchMedia` secara sinkron saat
   * render sekaligus tetap reaktif — dua-duanya benar.
   */
  cek('useMediaQuery memakai useSyncExternalStore',
    /useSyncExternalStore\(/.test(mq),
    'useEffect + useState kilat frame pertama di desktop');
  cek('useMediaQuery tidak memulai dari nilai default',
    !/useState\(false\)/.test(mq),
    'render pertama selalu salah, lalu melenting');
  cek('subscribe dilepas saat unmount',
    /removeEventListener\('change'/.test(mq) && /return \(\) => mql\.removeEventListener/.test(mq),
    'tanpa pelepasan, listener menumpuk setiap kali komponen dipasang ulang');
  cek('MediaQueryList di-cache per query',
    /cacheMql/.test(mq),
    'tanpa cache, setiap render mengalokasikan objek matchMedia baru');
}

// ═══ 9. Top bar: tidak boleh meluber ═══════════════════════════════════
//
// ⚠️ Blok kiri topbar semula `flex items-center gap-3` — tanpa `min-w-0`.
// Flex item seperti itu menolak menyusut, jadi `truncate` di dalam tidak
// pernah aktif. Begitu panel developer ikut membuka ruangnya (atau di HP
// sempit), judul meluber sampai ke tombol akun dan tombol itu terdorong
// keluar header.
//
// Syaratnya berpasangan: `min-w-0 flex-1` di kiri (teks boleh menyusut dan
// terpotong) dan `shrink-0` di kanan (tombol tidak boleh tergesot).

console.log('\n=== 9. Top bar tidak meluber di layar sempit');
{
  const app = kode(baca('src/App.tsx'));
  const akun = kode(baca('src/components/ui/AkunDropdown.tsx'));
  cek('blok kiri topbar boleh menyusut (min-w-0 flex-1)',
    /className="flex items-center gap-3 min-w-0 flex-1"/.test(app),
    'tanpa min-w-0, truncate tidak pernah aktif dan judul meluber');
  cek('blok kanan topbar tidak ikut tergesot (shrink-0)',
    /className="flex items-center gap-3 sm:gap-4 shrink-0"/.test(app));
  cek('judul halaman tidak lagi dibatasi max-w tetap',
    !/truncate max-w-\[150px\]/.test(app),
    'max-w tetap membuat judul terpotong di layar lebar padahal ruang cukup');

  /*
   * Tombol akun = lingkaran.
   *
   * Kapsul berisi nama punya lebar yang bergantung pada isi. Di HP sempit —
   * apalagi saat panel developer memakai ruang layout — tombol itu meluber ke
   * luar header. Avatar lingkaran punya lebar tetap (32 px) di ukuran layar
   * berapa pun, dan identitas orang tetap terbaca lewat inisial.
   */
  cek('tombol akun memakai avatar lingkaran',
    /rounded-full/.test(akun) && /sm:pr-2\.5/.test(akun),
    'avatar + nama dalam pil = lebar bergantung isi');
  cek('nama di tombol disembunyikan di layar sempit',
    /hidden sm:inline[^\n]*truncate/.test(akun),
    'kapsul dengan nama meluber di bawah breakpoint sm');
  cek('menu akun punya lebar yang dihitung dari ruang tersedia',
    /Math\.min\(LEBAR_MENU/.test(akun),
    'lebar tetap (w-64) melewati tepi layar ketika ruang menyempit');
  cek('menu akun membungkus hint, bukan memotongnya',
    /break-words/.test(akun),
    'hint seperti "update_profil · update_foto" terpotong di tengah kata');
  cek('menu akun punya aria-label yang menyebut nama',
    /aria-label=\{`Menu akun — \$\{displayName\}`\}/.test(akun),
    'tombol lingkaran tanpa nama perlu label yang menjelaskan');
  cek('Escape di menu akun tidak menjatuhkan panel lain',
    /event\.stopPropagation\(\)/.test(akun),
    'tanpa stopPropagation, Escape menutup menu sekaligus developer panel');

  /*
   * Menu baris tabel harus **di-portal** ke `document.body`.
   *
   * ⚠️ `position: fixed` saja tidak cukup. Setiap leluhur yang punya
   * `transform` / `filter` / `backdrop-filter` / `will-change` membuat
   * containing block sendiri untuk keturunannya yang `fixed` — jadi koordinat
   * `getBoundingClientRect()` (relatif viewport) diletakkan relatif kotak
   * leluhur itu, dan menu meleset dari barisnya.
   *
   * Leluhur seperti itu nyata di sini: `App.tsx` membungkus tiap halaman
   * dengan `motion.div` (`y: 10 → 0`). Motion menulis `transform: none` setelah
   * animasi selesai, jadi gejalanya intermiten — meleset hanya dalam 300 ms
   * pertama perpindahan halaman.
   */
  const aksi = kode(baca('src/components/ui/AksiMenu.tsx'));
  cek('AksiMenu merender panel lewat createPortal ke document.body',
    /createPortal\([\s\S]{0,3000}document\.body/.test(aksi),
    'fixed di dalam pohon DOM bisa meleset saat leluhur punya transform');
  cek('tombol toggle AksiMenu di atas penutup layar',
    /relative z-\[62\]/.test(aksi),
    'tanpa ini penutup layar menutupi tombol, dan klik kedua membukanya lagi');
  /*
   * Penutupan dengan `mousedown` hidup di `useMenuLayang` — jadi yang diuji
   * adalah hook-nya, bukan `AksiMenu` (lihat bagian 2).
   */
  const melayang = kode(baca('src/components/ui/menuTerdapat.ts'));
  cek('menu menutup pakai mousedown, bukan click',
    /addEventListener\('mousedown'/.test(melayang) && !/addEventListener\('click'/.test(melayang),
    'dengan click, klik pertama menutup dan klik kedua membuka lagi');

  /*
   * Arah buka: **ke bawah adalah bawaan**, di kedua menu.
   *
   * ⚠️ Semula `tinggi > ruangBawah && ruangAtas > ruangBawah`. Daftar di baris
   * tabel ketiga dari bawah akan melompat ke atas hanya karena daftarnya
   * panjang, padahal di bawahnya masih ada 300 px yang cukup. Mata harus
   * mencari ulang tiap arah berubah, dan isinya aksi yang menghapus atau
   * mengubah langganan — salah pilih berarti salah aksi.
   *
   * Sekarang: selama ada minimal 120 px di bawah, tetap ke bawah dan panelnya
   * yang digulir. Sama seperti `Dropdown.tsx`.
   */
  const dd = kode(baca('src/components/ui/Dropdown.tsx'));

  // `AksiMenu` & `TombolMenu` satu sumber: `useMenuLayang`.
  for (const [nama, src, namaConst] of [
    ['Dropdown', dd, 'TINGGI_MINIMUM'],
    ['Menu melayang (AksiMenu + TombolMenu)', melayang, 'TINGGI_MINIMUM'],
  ]) {
    cek(`${nama} menentukan arah dari ruang minimum`,
      new RegExp(`const keAtas = ruangBawah < ${namaConst} && ruangAtas > ruangBawah`).test(src),
      'daftar harus tetap ke bawah selama masih ada ruang yang berguna');
    cek(`${nama} tidak memakai tinggi daftar sebagai penentu arah`,
      !/ruangBawah < tinggiDibutuhkan/.test(src) && !/tinggi > ruangBawah/.test(src),
      'ini yang membuat menu melompat ke atas terlalu sering');
    cek(`${nama} punya ambang ruang minimum yang terdefinisi`,
      new RegExp(`const ${namaConst} = 1\\d\\d`).test(src),
      'ambang hilang = arah balik ke aturan lama');
    cek(`${nama} membatasi tinggi dengan ruang tersedia`,
      new RegExp(`Math\\.max\\(${namaConst}`).test(src),
      'tanpa ini daftar panjang keluar layar');
  }
  cek('ambang minimum sama di ketiga menu',
    (baca('src/components/ui/Dropdown.tsx').match(/const TINGGI_MINIMUM = (\d+)/) || [])[1] ===
      (baca('src/components/ui/menuTerdapat.ts').match(/const TINGGI_MINIMUM = (\d+)/) || [])[1],
    'beda ambang berarti satu menu melompat ke atas saat yang lain tidak');
}

// ═══ 10. Grid lebar tetap tidak boleh masuk ke modal ═══════════════════

console.log('\n=== 10. Grid >=3 kolom tetap di dalam panel sempit');
{
  /*
   * ⚠️ `grid-cols-N` tanpa prefix responsif, di dalam modal, hampir selalu
   * meluber di HP — dan tidak ada error, tidak ada jejak overflow di kode,
   * hanya tombol terakhir yang keluar dari panel.
   *
   * Hitungannya nyata untuk grid bank di `Langganan.tsx`: tiap sel punya
   * lebar minimum 52 px (ikon 32 + `p-2` 16 + `border-2` 4) yang tidak bisa
   * dikecilkan, jadi lima kolom butuh 5 x 52 + 4 x 8 = **292 px**. Modal di
   * HP 360 pxlebarnya `min(100%, 100vw - 2rem)` = 328 px, dikurangi `px-5`
   * isinya cuma 288 px — jadi grid meluber 4 px, dan di HP 320 px jadi 44 px.
   *
   * Grid 1 atau 2 kolom tidak masuk daftar: dua kolom di 288 px masih
   * 140 px per kolom, jauh di bawah lebar minimum sel mana pun di repo ini.
   *
   * Setiap grid >= 3 kolom tanpa prefix responsif harus terdaftar di
   * `KECUALI` berikut, dengan alasannya. Daftar ini sengaja sempit: kalau
   * nanti ada grid baru yang meluber, menambahkannya ke sini hanya boleh
   * dilakukan setelah mengukur ruang yang benar-benar tersedia.
   */
  const KECUALI = [
    {
      berkas: 'src/components/ui/DatePicker.tsx',
      kolom: [3, 7],
      alasan:
        'Kalender: panel di-portal ke body dengan lebar terukur, dan 7 kolom ' +
        'memang bentuk kalender. Lebarnya tidak bergantung pada viewport.',
    },
    {
      berkas: 'src/components/KartuQris.tsx',
      kolom: [5],
      alasan:
        'Siluet modul QR 5x5: `aria-hidden`, bukan interaktif, lebar tetap 96 px.',
    },
    {
      berkas: 'src/components/BayarLanggananModal.tsx',
      kolom: [5],
      alasan:
        'Skeleton siluet QR 5x5, sama seperti di KartuQris: `aria-hidden`, 96 px.',
    },
    {
      berkas: 'src/App.tsx',
      kolom: [3],
      alasan: 'Skeleton tab manajemen akun mengikuti tiga tab aktual.',
    },
    {
      berkas: 'src/pages/ManajemenAkun.tsx',
      kolom: [3],
      alasan: 'Navigasi tiga tab yang lebarnya sama, dengan teks dapat membungkus.',
    },
    {
      berkas: 'src/pages/Langganan.tsx',
      kolom: [6],
      alasan:
        'Editor paket mobile sengaja membagi Nama+Harga lalu Durasi+Satuan+Hapus; ' +
        'grid 6 kolom memberi span 3/3 dan 2/3/1 tanpa membuat tombol hapus meluber.',
    },
  ];

  const semuaBerkas: string[] = [];
  (function jalan(dir: string): void {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) jalan(p);
      else if (ent.name.endsWith('.tsx')) semuaBerkas.push(relative(root, p));
    }
  })(join(root, 'src'));

  const offenders: string[] = [];
  for (const f of semuaBerkas) {
    const baris = kode(baca(f)).split('\n');
    baris.forEach((isi: string, i: number) => {
      // Tanpa prefix responsif: `(?<![:\w-])` memastikan `sm:grid-cols-5`
      // tidak ikut tertangkap, karena `:` ada di depan `grid`.
      const m = isi.match(/(?<![:\w-])grid-cols-(\d+)/);
      if (!m) return;
      const kolom = Number(m[1]);
      if (kolom < 3) return;
      // Prefix responsif di class yang sama = sengaja, mis. `grid-cols-2
      // sm:grid-cols-5`. Grid itu berubah jumlah kolomnya, bukan meluber.
      if (new RegExp(`(sm|md|lg|xl):grid-cols-${kolom}\\b`).test(isi)) return;
      const boleh = KECUALI.find(k => k.berkas === f && k.kolom.includes(kolom));
      if (boleh) return;
      offenders.push(`${f}:${i + 1}  grid-cols-${kolom}  ${isi.trim().slice(0, 56)}`);
    });
  }

  cek(
    'setiap grid >=3 kolom tetap terdaftar di KECUALI (dengan alasan)',
    offenders.length === 0,
    offenders.slice(0, 4).join(' | ')
  );

  // Grid bank harus benar-benar responsif — inilah yang meluber 44 px di HP 320.
  cek('grid bank di Langganan responsif',
    /grid-cols-2 sm:grid-cols-5/.test(langganan),
    'lima kolom tetap butuh 292 px, modal HP 360 px hanya menyediakan 288 px');
  cek('nama bank membungkus, bukan memaksa lebar minimum',
    /break-words[\s\S]{0,80}\{item\.nama\}/.test(langganan),
    'kata panjang pada tombol bank menaikkan min-content dan melebarkan grid');
  cek('paket mobile menempatkan nama/harga lalu durasi/satuan/hapus',
    /grid grid-cols-6 gap-2 items-end sm:grid-cols-2 sm:gap-2\.5 xl:grid-cols-12/.test(langganan) &&
      /col-span-2 sm:col-span-2 xl:col-span-4/.test(langganan) &&
      /col-span-4 min-w-0 sm:col-span-1 xl:col-span-3/.test(langganan) &&
      /col-span-2 min-w-0 sm:col-span-1 xl:col-span-2/.test(langganan) &&
      /col-span-3 min-w-0 sm:col-span-1 xl:col-span-2/.test(langganan) &&
      /h-10 w-full min-w-0 sm:w-10/.test(langganan));
  cek('field harga menyembunyikan stepper hanya di mobile agar nominal muat',
    /hideSteppersBelowSm/.test(langganan) &&
      /hideSteppersBelowSm \? 'hidden sm:flex'/.test(surface));
  cek('prefix Rp menyatu dalam satu field harga, bukan kotak terpisah',
    /prefix\s*\?[\s\S]{0,500}overflow-hidden rounded-xl border border-slate-200 bg-white/.test(surface) &&
      /items-center px-3 text-xs font-semibold text-slate-500/.test(surface) &&
      /prefix[\s\S]{0,250}border-0 bg-transparent/.test(surface));
  cek('tombol Simpan Pengaturan berada di tengah pada mobile',
    /flex justify-center sm:justify-end/.test(langganan));
  cek('nomor WhatsApp memakai keypad numerik mobile',
    /label="Nomor WhatsApp"[\s\S]{0,600}inputMode="numeric"/.test(langganan));
}

console.log(fail === 0 ? '\nSEMUA LULUS' : `\n${fail} KEGAGALAN`);
process.exit(fail === 0 ? 0 : 1);
