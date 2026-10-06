import { useState, useEffect } from 'react';
import { bacaStorage, tulisStorage } from '../lib/storageAman';

export function useDarkMode() {
  /*
   * `bacaStorage`, bukan `localStorage.getItem` langsung.
   *
   * Baris ini jalan di fase render — sebelum React memasang tree. Satu
   * lemparan di sini (Safari mode privat, penyimpanan diblokir kebijakan
   * situs) berarti komponen gagal mounting dan seluruh aplikasi tidak
   * pernah tampil: layar putih, tanpa form login. Penyimpanan yang tidak
   * bisa diakses diperlakukan sebagai "tema belum pernah dipilih", yang
   * membuat aplikasi tetap terbuka dengan tema sistem.
   */
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = bacaStorage('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const metaThemeColor = document.getElementById('theme-color-meta') || document.querySelector('meta[name="theme-color"]');

    if (isDarkMode) {
      root.classList.add('dark');
      root.classList.remove('light');
      tulisStorage('theme', 'dark');
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#1e293b');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
      tulisStorage('theme', 'light');
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#ffffff');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  return { isDarkMode, toggleDarkMode };
}
