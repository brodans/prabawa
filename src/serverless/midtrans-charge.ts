/**
 * Vercel Serverless Function — buat transaksi Midtrans (Core API).
 *
 * ⚠️ `Server Key` hanya boleh dibaca di server. Fungsi ini adalah satu-satunya
 * tempat yang menentuhnya; peramban tidak pernah melihat nilainya.
 *
 * Pola ini disalin dari `Mesen.Ae-Capacitor/api/midtrans-charge.ts` — bedanya
 * hanya nama environment key dan pesan errornya.
 *
 * Keamanan tambahan: `origin` dibatasi ke daftar putih lewat
 * `ALLOWED_ORIGINS`, sama seperti proxy JSON-RPC. Tanpa itu, endpoint ini
 * bisa dipanggil siapa saja yang tahu URL-nya dan memakai server key kita
 * untuk membuat transaksi.
 */

// Mode produksi/sandbox diputuskan satu tempat — lihat `lib/midtransEnv.ts`.
import { midtransProduksi } from '../lib/midtransEnv';

const BASE_PRODUKSI = 'https://api.midtrans.com';
const BASE_SANDBOX = 'https://api.sandbox.midtrans.com';

const modeProduksi = midtransProduksi;

function serverKey(): string {
  return process.env.MIDTRANS_SERVER_KEY || '';
}

import { terapkanCors } from './_cors';

export default async function handler(req: any, res: any) {
  // Allow-list origin — lihat `api/_cors.ts`.
  if (!terapkanCors(res, req.headers?.origin)) {
    return res.status(403).json({ error_messages: ['Origin tidak diizinkan.'] });
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error_messages: [`Method ${req.method} not allowed`] });
  }

  const key = serverKey();
  if (!key) {
    // ⚠️ Pesan ini sengaja menyebut variabelnya — debugging di
    // dashboard Vercel jauh lebih cepat daripada menebak.
    return res.status(500).json({
      error_messages: ['Server misconfiguration: MIDTRANS_SERVER_KEY tidak ditemukan.'],
    });
  }

  // Wajib ada `order_id` — tanpa itu Midtrans menolak.
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  let parsedBody: any;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return res.status(400).json({ error_messages: ['Body harus berupa JSON yang valid.'] });
  }
  if (!parsedBody?.transaction_details?.order_id) {
    return res.status(400).json({
      error_messages: ['transaction_details.order_id wajib diisi.'],
    });
  }

  const auth = Buffer.from(`${key}:`).toString('base64');
  const baseUrl = modeProduksi() ? BASE_PRODUKSI : BASE_SANDBOX;

  try {
    const upstream = await fetch(`${baseUrl}/v2/charge`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body,
    });

    const text = await upstream.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return res.status(502).json({
        error_messages: ['Respons tidak valid dari Midtrans (bukan JSON).'],
      });
    }

    // Midtrans memakai status_code 200/201/202 untuk sukses.
    const sukses = ['200', '201', '202'].includes(String(data.status_code));
    if (!sukses) {
      return res.status(422).json({
        error_messages: [
          data.error_messages?.[0] || data.status_message || `Gagal memproses (status: ${data.status_code})`,
        ],
        raw: data,
      });
    }

    return res.status(200).json(data);
  } catch (err: unknown) {
    const pesan = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({
      error_messages: [`Gagal terhubung ke server pembayaran: ${pesan}`],
    });
  }
}
