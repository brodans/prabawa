/**
 * Vercel Serverless Function — aktivasi langganan.
 *
 * Padanan persis dari route `POST /api/billing/aktivasi` di
 * `src/api/server.ts`, memakai modul yang sama (`lib/serverBilling.ts`).
 * Logikanya tidak diduplikasi di sini supaya Express dan Vercel tidak
 * bisa berbeda perilaku.
 *
 * ## Keamanan
 *
 * - **Token panel wajib.** `aktifkanLangganan()` membaca nama akun dari
 *   token, jadi `username` di body **diabaikan sepenuhnya**. Dulu body itu
 *   dibaca begitu saja tanpa ada satu pun pemeriksaan token — artinya
 *   endpoint ini bisa dipanggil siapa saja yang tahu URL-nya untuk
 *   mengaktifkan langganan orang lain. Gerbang langganan hanya tampil
 *   setelah login panel berhasil, jadi setiap pemanggil yang sah sudah
 *   memegang token; tidak ada alasan melepaskannya.
 * - `Server Key` Midtrans hanya dibaca di server.
 * - Penulisan Firestore memakai Admin SDK, sehingga aturan Firestore
 *   menutup jalur tulis dari klien sepenuhnya.
 * - Rate limit sederhana per IP instance.
 * - `origin` dibatasi allow-list, sama seperti proxy JSON-RPC — tanpa itu
 *   endpoint ini bisa dipanggil siapa saja yang tahu URL-nya.
 */

import { aktifkanLangganan, adminTersedia } from '../lib/serverBilling';

const BATAS_AKTIVASI = 20;
const JENDALA_AKTIVASI_MS = 60_000;

// Vercel mengisolasi tiap instance, jadi penghitung ini hanya menahan
// percobaan dalam satu instance. Cukup untuk menahan pembalikan; untuk
// perlindungan DoS yang sesungguhnya, andalkan limit platform Vercel.
const riwayat = new Map<string, { jumlah: number; mulai: number }>();

import { terapkanCors } from './_cors';

/** Token dari `Authorization: Bearer …`; body hanya untuk `curl`/skrip uji. */
function bacaToken(req: any, body: Record<string, unknown>): string {
  const header = String(req.headers?.authorization ?? '').trim();
  if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim();
  return typeof body.token === 'string' ? body.token.trim() : '';
}

export default async function handler(req: any, res: any) {
  // Allow-list origin — lihat `api/_cors.ts`.
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ ok: false, pesan: 'Origin tidak diizinkan.' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, pesan: 'Method tidak diizinkan.' });
  }

  // Rate limit.
  const ip =
    (req.headers?.['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'tak-diketahui';
  const sekarangMs = Date.now();
  const catat = riwayat.get(ip);
  if (catat && sekarangMs - catat.mulai < JENDALA_AKTIVASI_MS) {
    if (catat.jumlah >= BATAS_AKTIVASI) {
      const tunggu = Math.ceil((JENDALA_AKTIVASI_MS - (sekarangMs - catat.mulai)) / 1000);
      res.setHeader('Retry-After', String(tunggu));
      return res
        .status(429)
        .json({ ok: false, pesan: `Terlalu banyak permintaan. Coba lagi dalam ${tunggu} detik.` });
    }
    catat.jumlah += 1;
  } else {
    riwayat.set(ip, { jumlah: 1, mulai: sekarangMs });
  }

  if (!adminTersedia()) {
    return res.status(503).json({
      ok: false,
      pesan:
        'Server belum dikonfigurasi untuk menulis langganan. Isi FIREBASE_SERVICE_ACCOUNT di dashboard Vercel.',
    });
  }

  const { orderId, metode, nominal } = (req.body ?? {}) as {
    orderId?: string;
    metode?: string;
    nominal?: number;
  };

  try {
    const hasil = await aktifkanLangganan(
      bacaToken(req, (req.body ?? {}) as Record<string, unknown>),
      {
        orderId: String(orderId ?? ''),
        metode:
          metode === 'qris' || metode === 'transfer'
            ? (metode as 'qris' | 'transfer')
            : 'qris_midtrans',
        nominalKlien: typeof nominal === 'number' ? nominal : undefined,
      }
    );
    return res.status(hasil.ok ? 200 : hasil.kode ?? 400).json(hasil);
  } catch (err: unknown) {
    console.error('Aktivasi langganan gagal:', err);
    return res.status(500).json({ ok: false, pesan: 'Gagal memproses pembayaran di server.' });
  }
}
