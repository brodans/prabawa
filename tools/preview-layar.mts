/**
 * Pratinjau visual — menulis HTML statis dari komponen yang sungguhan.
 *
 * Dipakai untuk memeriksa tata letak di lebar layar sempit tanpa perlu
 * menjalankan aplikasi dan masuk ke Firebase. Ini alat bantu lokal, bukan
 * bagian dari `npm test`.
 *
 * Jalankan: `npm run preview:layar`, lalu buka
 * `/tmp/opencode/preview/*.html` di peramban dan perkecil jendela sampai
 * selebar HP.
 *
 * ⚠️ Tailwind dimuat dari CDN, jadi ini **perkiraan** tampilan, bukan
 * build asli. Cukup untuk memeriksa jarak, lebar, dan urutan elemen — bukan
 * untuk menilai warna atau font.
 */
import { writeFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.window = globalThis.window ?? {};

const { LayarLanggananHabis, LayarTungguVerifikasi } = await import(
  '../src/components/GerbangLangganan.tsx'
);
const { TombolKonfirmasiWa } = await import('../src/components/BayarLanggananModal.tsx');
const { ToastProvider } = await import('../src/components/ui/Toast.tsx');
const { ringkasanLangganan, PAKET_BAWAAN, BILLING_DEFAULT } = await import('../src/lib/langganan.ts');

/** Bungkus komponen yang butuh ToastProvider. */
const denganToast = (node: React.ReactNode) => React.createElement(ToastProvider, null, node);

const SEKARANG = new Date('2026-09-29T10:00:00+07:00');
const kedaluwarsa = ringkasanLangganan(
  'budi.santoso',
  {
    username: 'budi.santoso',
    paketId: 'bulanan',
    masaMulai: '2026-07-01T00:00:00+07:00',
    masaAkhir: '2026-08-01T00:00:00+07:00',
    gratis: false,
    totalBayar: 25000,
    jumlahBayar: 1,
    createdAt: '2026-07-01T00:00:00+07:00',
  },
  PAKET_BAWAAN,
  'user',
  SEKARANG
);

const tanpaAksi = () => {};

const layar = renderToStaticMarkup(
  denganToast(React.createElement(LayarLanggananHabis, {
    ringkasan: kedaluwarsa,
    namaPegawai: 'BUDI SANTOSO, S.Kom.',
    username: 'budi.santoso',
    paket: PAKET_BAWAAN,
    tagihan: [],
    pengaturan: BILLING_DEFAULT,
    bayar: false,
    setBayar: tanpaAksi,
    muatUlang: tanpaAksi,
    muatUlangLokal: async () => {},
    lanjutkan: null,
    setLanjutkan: tanpaAksi,
    paketTerpilih: null,
    setPaketTerpilih: tanpaAksi,
    mulaiLewatTagihan: tanpaAksi,
    onSelesai: async () => {},
    onTungguVerifikasi: tanpaAksi,
    onKeluar: tanpaAksi,
  }))
);

const tunggu = renderToStaticMarkup(
  React.createElement(LayarTungguVerifikasi, {
    info: {
      username: 'budi.santoso',
      orderId: 'PRABAWA-BULANAN-1759000000000',
      paket: '1 Bulan',
      nominal: 25000,
      berakhirAt: Date.now() + 240000,
    },
    sisaDetik: 277,
  })
);

const tombol = renderToStaticMarkup(
  React.createElement(TombolKonfirmasiWa, {
    url: 'https://wa.me/6281234567890?text=Halo',
    bekerja: false,
    onKonfirmasi: tanpaAksi,
  })
);

const template = (isi: string): string => `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pratinjau PRABAWA</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .label { font: 700 12px ui-monospace, monospace; color: #64748b; padding: 10px 14px 0; }
</style>
</head><body class="bg-slate-100">${isi}</body></html>`;

/*
 * Keadaan memuat & gagal untuk kartu QRIS.
 *
 * `renderToStaticMarkup` tidak menjalankan `useEffect`, jadi yang dirender
 * persis keadaan bermasalahnya: `qrisString` sudah ada, PNG belum. Itulah
 * keadaan yang dulu menghasilkan ikon gambar rusak di pojok kiri.
 */
const kartuQris = (await import('../src/components/KartuQris.tsx')).default;
const kartuMemuat = renderToStaticMarkup(
  React.createElement(kartuQris, { qrisString: '00020101021126', lebar: 264 })
);
const kartuKosong = renderToStaticMarkup(
  React.createElement(kartuQris, { qrisString: '', lebar: 264 })
);
const kartuGagal = renderToStaticMarkup(
  React.createElement(kartuQris, { qrisString: 'bukan-qris', lebar: 264 })
);

const files = {
  'qris-memuat.html': template(
    `<p class="label">4. Kartu QRIS — sedang digambar (dulu: gambar rusak di pojok kiri)</p>
     <div class="p-4 flex gap-4 flex-wrap items-start">
       
       <div>${kartuMemuat}</div>
     </div>`
  ),
  'qris-kosong.html': template(
    `<p class="label">5. Kartu QRIS — string belum ada</p><div class="p-4">${kartuKosong}</div>`
  ),
  'qris-gagal.html': template(
    `<p class="label">6. Kartu QRIS — gagal digambar</p><div class="p-4">${kartuGagal}</div>`
  ),
  'langganan-habis.html': template(`<p class="label">1. Layar "Langganan Habis"</p>${layar}`),
  'mohon-tunggu.html': template(`<p class="label">2. Layar "Mohon Tunggu" (5 menit terkunci)</p>${tunggu}`),
  'tombol-wa.html': template(
    `<p class="label">3. Tombol konfirmasi (dalam kartu QR)</p><div class="p-4 max-w-sm">${tombol}</div>`
  ),
};

for (const [nama, isi] of Object.entries(files)) {
  writeFileSync(`/tmp/opencode/preview/${nama}`, isi);
  console.log(nama);
}
