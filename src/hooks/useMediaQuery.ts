import { useCallback, useSyncExternalStore } from 'react';

/**
 * Ikuti media query CSS — nilainya benar sejak render pertama, dan tetap
 * benar saat jendela berubah ukurannya.
 *
 * ## Kenapa `useSyncExternalStore`, bukan `useEffect` + `useState`
 *
 * Dua implementasi naif, dan keduanya salah dengan cara berbeda:
 *
 * **1. `window.innerWidth` langsung di badan render.**
 * Nilainya benar pada render pertama, tapi komponen hanya dirender ulang
 * ketika state-nya berubah. Memutar HP atau mengubah ukuran jendela tidak
 * mengubah state, jadi panel tetap di mode yang salah sampai ada interaksi
 * lain. Gejalanya persis "tampilan rusak setelah diputar".
 *
 * **2. `useState(false)` + `useEffect` yang menyinkronkan.**
 * Kali ini reaktif, tapi render pertama selalu memakai nilai default. Untuk
 * panel yang cabangnya menentukan Tata letak, itu berarti satu frame
 * kilat: di desktop tombol kecil muncul lebih dulu, lalu melenting menjadi
 * panel lebar. Persis yang tidak boleh terjadi pada elemen fixed yang
 * menempel di tepi layar.
 *
 * `useSyncExternalStore` menyelesaikan keduanya. `getSnapshot` dibaca secara
 * sinkron saat render (jadi tidak pernah salah di frame pertama), dan
 * `subscribe` yang memberi tahu React saat nilai berubah (jadi reaktif).
 * React 19 membacanya dalam mode yang konsisten, sehingga tearing — tampilan
 * separuh lama, separuh baru — tidak mungkin terjadi.
 *
 * ## SSR / Node
 *
 * `matchMedia` tidak ada di luar peramban. `getServerSnapshot` mengembalikan
 * `false` supaya pemanggil tidak melempar, dan komponen degrade ke tampilan
 * non-interaktif. Aplikasi ini SPA, jadi jalurnya hanya relevan untuk
 * pratinjau/uji.
 *
 * ## Catatan performa
 *
 * Objek `MediaQueryList` disimpan di cache per query. `getSnapshot` dipanggil
 * pada setiap render, dan `window.matchMedia()` membuat objek baru setiap
 * kali — tanpa cache, satu breakpoint yang dipakai di beberapa tempat akan
 * mengalokasikan objek di setiap frame.
 *
 * `addEventListener` pada `MediaQueryList` dipakai, bukan `addListener` yang
 * sudah usang. Listener dilepas saat unsubscribe, jadi komponen yang dipasang
 * ulang tidak menambah listener setiap kali — itu yang membuat penghitung
 * listener membengkak tanpa terlihat.
 */

/** `MediaQueryList` per query, supaya tidak dialokasikan ulang tiap render. */
const cacheMql = new Map<string, MediaQueryList>();

function mqlUntuk(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  let mql = cacheMql.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    cacheMql.set(query, mql);
  }
  return mql;
}

/**
 * @param query  media query CSS, mis. `'(min-width: 1280px)'`.
 * @returns `true` kalau query-nya sedang cocok.
 */
export function useMediaQuery(query: string): boolean {
  const mql = mqlUntuk(query);

  // Ketiganya `useCallback` supaya identitasnya stabil. Tanpa itu React
  // unsubscribe lalu subscribe ulang pada setiap render, dan setiap
  // subscribe menambah listener baru ke `MediaQueryList` yang sama.
  const subscribe = useCallback(
    (onPerubahan: () => void) => {
      if (!mql) return () => {};
      mql.addEventListener('change', onPerubahan);
      return () => mql.removeEventListener('change', onPerubahan);
    },
    [mql]
  );

  const getSnapshot = useCallback(() => mql?.matches ?? false, [mql]);

  // Nilai untuk renderer yang tidak punya `window`. `false` dipilih karena
  // itu cabang yang tidak interaktif — lebih baik tidak tampil daripada
  // menampilkan panel yang belum bisa dipakai.
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Breakpoint yang sama dengan `DeveloperInspector`.
 *
 * Di BAWAH ini panel menjadi **overlay** (drawer layar penuh) dan tidak lagi
 * mengambil ruang layout. Di atas atau sama dengan, panel menjadi kolom
 * tersendiri.
 *
 * ⚠️ Angka 1280, bukan 1024. Pada 1024–1279 px, sidebar (256 px) + panel
 * (±348 px) menyisakan hanya ±420 px untuk konten — topbar lalu memampatkan
 * tombol akun sampai meluber, dan tabel jadi bergulir horizontal terus.
 * Overlay tidak punya masalah itu, jadi batasnya dinaikkan.
 */
export const BP_INSPECTOR_SIDEBAR = 1280;
