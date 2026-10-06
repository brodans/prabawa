/**
 * Konfigurasi PostCSS.
 *
 * ⚠️ Berkas `.ts` hanya dibaca kalau `postcss-load-config` punya pemuat
 * TypeScript — di proyek ini itu `tsx`, yang sudah dipakai untuk build dan
 * seluruh skrip uji. Kalau pemuatnya hilang, Tailwind tidak dijalankan sama
 * sekali dan CSS hasil build hanya berisi aturan yang memang ditulis di
 * `index.css`: build tetap hijau, hanya tampilannya rusak.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};

export default config;