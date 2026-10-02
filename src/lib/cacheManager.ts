/**
 * Cache hasil login ke server pusat (api_key + profil pegawai).
 *
 * Disimpan di `sessionStorage` dengan TTL pendek supaya token server cepat
 * kedaluwarsa dan tidak bocor ke tab lain.
 *
 * Satu akun = satu kunci. Ini penting: cache berisi `api_key` yang sah, jadi
 * satu kunci global akan memberi akses server milik akun terakhir ke akun
 * berikutnya yang login di peramban yang sama.
 */

const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = 'epresensi_jatim_srvcache_';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

export interface ServerSessionCache {
  version: number;
  apiKey: string;
  nip: string;
  pegawaiId: string;
  idLokasi: string;
  kodeInstansi: string;
  kodeUnor: string;
  nama: string;
  jabatan: string;
  instansi: string;
  departemen: string;
  group: string;
  profilePic: string;
  usingWajah: number;
  workCode: string;
  /**
   * IMEI yang dipakai saat login. Wajib untuk akun yang masih terkunci ke
   * satu perangkat — diisi ulang ke `config.imei` agar request berikutnya
   * memakai nilai yang sama.
   */
  imei: string;
  cachedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function cacheKey(username: string): string {
  return `${CACHE_KEY_PREFIX}${username.trim()}`;
}

export function setServerSessionCache(username: string, cache: Omit<ServerSessionCache, 'version' | 'cachedAt'>): void {
  if (!isBrowser()) return;
  try {
    const payload: ServerSessionCache = {
      version: CACHE_VERSION,
      cachedAt: Date.now(),
      ...cache,
    };
    sessionStorage.setItem(cacheKey(username), JSON.stringify(payload));
  } catch (err) {
    console.warn('[cacheManager] Gagal menyimpan cache sesi server:', err);
  }
}

export function getServerSessionCache(username: string): ServerSessionCache | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(username));
    if (!raw) return null;
    const cache = JSON.parse(raw) as ServerSessionCache;
    if (cache.version !== CACHE_VERSION) {
      sessionStorage.removeItem(cacheKey(username));
      return null;
    }
    if (Date.now() - cache.cachedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey(username));
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

export function clearServerSessionCache(username: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(cacheKey(username));
  } catch {
    // abaikan
  }
}
