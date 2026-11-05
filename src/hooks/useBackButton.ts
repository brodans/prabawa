import { useEffect } from 'react';

type BackHandler = (...args: unknown[]) => boolean;

/**
 * Mendaftarkan handler untuk tombol "kembali".
 *
 * App memakai routing berbasis state + history.pushState (bukan
 * react-router), sehingga popstate diintercept App.tsx. Handler yang
 * terdaftar di sini dipanggil berurutan dari yang terakhir.
 *
 * @param aktif     hanya aktif saat true
 * @param handler   return true bila handler sudah-itulah yang menangani
 */
export function useBackButton(aktif: boolean, handler: BackHandler) {
  useEffect(() => {
    if (!aktif) return;

    const w = window as unknown as { customBackHandlers?: BackHandler[] };
    if (!w.customBackHandlers) w.customBackHandlers = [];

    w.customBackHandlers.push(handler);
    return () => {
      const list = w.customBackHandlers;
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  }, [aktif, handler]);
}
