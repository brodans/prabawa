/**
 * Klien Midtrans.
 *
 * ## Kenapa tidak memanggil Midtrans langsung dari peramban
 *
 * `Server Key` tidak boleh ada di kode peramban — siapa pun yang membuka
 * DevTools bisa mengambilnya dan membuat transaksi atas nama merchant ini.
 * Jadi semua panggilan Midtrans melewati proxy server-side:
 *
 * - Express (self-hosted): route di `src/api/server.ts`
 * - Vercel: fungsi di `api/midtrans-charge.js`
 *
 * ⚠️ Endpoint "cek status transaksi" pernah ada di kedua platform dan sudah
 * dihapus: tidak ada satu pun pemanggil di aplikasi, sementara ia terbuka
 * tanpa token — siapa pun yang tahu URL-nya bisa memakai `Server Key` untuk
 * menebak-nebak `orderId` dan menghabiskan kuota API merchant. Endpoint itu
 * memang tak terpakai, jadi tidak ada yang kehilangan kemampuan apa pun.
 *
 * `Client Key` memang aman di sisi peramban (itu memang desain Snap),
 * jadi hanya itu yang dibaca dari `import.meta.env`.
 *
 * ## Midtrans opsional
 *
 * Modul ini tidak crash kalau Midtrans belum dikonfigurasi — pemanggil
 * cukup mengecek `midtransTersedia()` / `cekMidtransServer()` dan
 * menyembunyikan metode itu. QRIS manual dan transfer bank tetap berfungsi
 * tanpa Midtrans sama sekali.
 */

function modeProduksi(): boolean {
  return import.meta.env?.VITE_MIDTRANS_IS_PRODUCTION === 'true';
}

/**
 * Midtrans terlihat sudah dikonfigurasi **di sisi peramban**.
 *
 * Hanya melihat variabel `VITE_*`. `MIDTRANS_SERVER_KEY` tidak ada di sini
 * — memang begitu mestinya — jadi fungsi ini belum bisa melihat apakah
 * server punya key. Untuk itu pakai `cekMidtransServer()`.
 */
export function midtransTersedia(): boolean {
  return Boolean(import.meta.env?.VITE_MIDTRANS_CLIENT_KEY);
}

let cacheHealth: Promise<boolean> | null = null;

/**
 * Tanya server apakah `MIDTRANS_SERVER_KEY` terpasang.
 *
 * Satu-satunya cara peramban mengetahuinya tanpa membocorkan key: endpoint
 * `/api/health` membalas `midtrans: true|false` (boolean, bukan key).
 *
 * Hasilnya di-cache selama 60 detik — `/api/health` dipanggil dari beberapa
 * tempat (gate langganan, dialog pembayaran) dan tidak perlu dzieksekusi
 * ulang berkali-kali dalam satu sesi.
 */
export function cekMidtransServer(): Promise<boolean> {
  if (cacheHealth) return cacheHealth;
  cacheHealth = (async () => {
    try {
      const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
      if (!response.ok) return false;
      const data = (await response.json()) as { midtrans?: boolean };
      return Boolean(data?.midtrans);
    } catch {
      // Server tidak terjangkau — anggap tidak tersedia supaya metode
      // Midtrans tidak offered daripada menampilkan tombol yang pasti gagal.
      return false;
    }
  })().finally(() => {
    setTimeout(() => {
      cacheHealth = null;
    }, 60_000);
  });
  return cacheHealth;
}

/** Client key untuk Snap — aman di peramban, bukan rahasia. */
function midtransClientKey(): string {
  return import.meta.env?.VITE_MIDTRANS_CLIENT_KEY ?? '';
}

/** Sumber Snap yang sesuai mode. */
function midtransSnapUrl(): string {
  return modeProduksi() ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';
}

export interface DetailItemMidtrans {
  id?: string;
  price: number;
  quantity: number;
  name: string;
}

export interface KonfigurasiMidtrans {
  transaction_details: {
    order_id: string;
    gross_amount: number;
  };
  item_details?: DetailItemMidtrans[];
  customer_details?: { first_name: string; email?: string; phone?: string };
  /** Batasi metode; mis. `['qris']` atau `['bca_va']`. */
  enabled_payments?: string[];
  /** QRIS dinamis dengan nominal per transaksi. */
  qr_string?: string;
}

export interface HasilChargeMidtrans {
  transaction_id?: string;
  order_id?: string;
  gross_amount?: string;
  /** QR string untuk QRIS, VA number untuk transfer bank. */
  qr_string?: string;
  va_number?: string;
  bank_code?: string;
  payment_type?: string;
  transaction_status?: string;
  /** URL untuk e-wallet (GoPay / OVO / DANA / ShopeePay). */
  action_url?: string;
  redirect_url?: string;
  [key: string]: unknown;
}

async function posApi<T>(url: string, body: unknown, metode: 'POST' | 'GET'): Promise<T> {
  const response = await fetch(url, {
    method: metode,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(metode === 'POST' ? { body: JSON.stringify(body) } : {}),
  });

  const teks = await response.text();
  let data: any = {};
  try {
    data = teks ? JSON.parse(teks) : {};
  } catch {
    throw new Error('Respons server pembayaran bukan JSON.');
  }

  if (!response.ok) {
    const pesan =
      data?.error_messages?.[0] || data?.message || data?.status_message || 'Permintaan pembayaran ditolak.';
    throw new Error(pesan);
  }
  return data as T;
}

/**
 * Buat transaksi lewat Core API Midtrans.
 *
 * `qr_string` dipakai untuk QRIS ber-nominal. Kalau diisi, Midtrans membuat
 * QRIS dinamis dari string itu — tidak perlu `amount` terpisah, dan QR yang
 * muncul sudah terkunci ke nominal tagihan.
 */
export async function buatTransaksi(konfigurasi: KonfigurasiMidtrans): Promise<HasilChargeMidtrans> {
  return posApi<HasilChargeMidtrans>('/api/midtrans-charge', konfigurasi, 'POST');
}


declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        options: {
          onSuccess?: (result: unknown) => void;
          onPending?: (result: unknown) => void;
          onError?: (result: unknown) => void;
          onClose?: (result: unknown) => void;
        }
      ) => void;
    };
  }
}

/**
 * Muat skrip Snap sekali saja.
 *
 * `data-client-key` harus disetel sebelum skrip masuk DOM — kalau skrip
 * sudah termuat tanpa key, Snap akan menolak membuka.
 */
export function muatSnap(): Promise<void> {
  const clientKey = midtransClientKey();
  if (!clientKey) {
    return Promise.reject(
      new Error('VITE_MIDTRANS_CLIENT_KEY belum diisi — Snap tidak bisa dibuka.')
    );
  }

  return new Promise((resolve, reject) => {
    const ada = document.getElementById('midtrans-snap-script') as HTMLScriptElement | null;
    if (ada && window.snap) return resolve();
    if (ada) {
      ada.addEventListener('load', () => resolve(), { once: true });
      ada.addEventListener('error', () => reject(new Error('Gagal memuat Midtrans Snap.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.id = 'midtrans-snap-script';
    script.src = midtransSnapUrl();
    script.setAttribute('data-client-key', clientKey);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Gagal memuat Midtrans Snap.'));
    document.head.appendChild(script);
  });
}
