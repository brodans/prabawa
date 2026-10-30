/**
 * Klien aktivasi langganan.
 *
 * ## Kenapa tidak menulis Firestore langsung
 *
 * Sebelumnya modul ini memanggil `catatPembayaran()` yang menulis
 * `masaAkhir` dari peramban. Siapa pun yang bisa menjalankan JavaScript
 * di konsol bisa memanggil fungsi yang sama dengan nilai pilihannya
 * sendiri — termasuk `durasiHari: 36500`. Aturan "wajib berlangganan"
 * seperti itu tidak enforceable.
 *
 * Sekarang peramban hanya memanggil `POST /api/billing/aktivasi`. Server
 * yang:
 * - membaca nama akun dari **token** (field `username` tidak pernah dikirim),
 * - mengambil harga dan durasi dari konfigurasi sendiri,
 * - memverifikasi status Midtrans (untuk `qris_midtrans`),
 * - menulis dokumennya dengan Admin SDK.
 *
 * `firestore.rules` menutup jalur tulis langsung dari klien, jadi tidak
 * ada jalan kedua.
 *
 * ## Batas yang jujur
 *
 * QRIS manual dan transfer bank tidak bisa diverifikasi dari server —
 * tidak ada API bank yang bisa ditanyakan. Server tetap menjaga nominal
 * dan durasinya, tapi fakta "sudah benar-benar membayar" hanya bisa
 * dipastikan oleh admin yang memeriksa mutasi. Midtrans adalah jalur yang
 * benar-benar otomatis.
 */

import { tokenAktif } from './sessionManager';

/** Hasil aktivasi, sama bentuknya dengan balasan server. */
export interface HasilAktivasiKlien {
  ok: boolean;
  masaAkhir?: string;
  masaMulai?: string;
  nominal?: number;
  durasiHari?: number;
  sumber?: 'midtrans' | 'manual';
  statusTransaksi?: string;
  pesan?: string;
}

/**
 * Minta server mengaktifkan (atau memperpanjang) langganan.
 *
 * Server sudah idempoten terhadap `orderId`, jadi memanggil fungsi ini
 * beberapa kali untuk tagihan yang sama tidak menambah masa aktif
 * berulang.
 *
 * ⚠️ Token sesi ikut dikirim, dan field `username` **tidak ada** di
 * parameter. Server membaca nama akun dari token — itulah yang menutup
 * jalan mengaktifkan langganan orang lain hanya dengan mengubah satu
 * field di request. Gerbang langganan hanya tampil setelah login panel
 * berhasil, jadi setiap pemanggil yang sah sudah memegang token.
 */
export async function aktifkanLangganan(params: {
  orderId: string;
  metode: 'qris' | 'qris_midtrans' | 'transfer';
  nominal?: number;
}): Promise<HasilAktivasiKlien> {
  const response = await fetch('/api/billing/aktivasi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${tokenAktif()}`,
    },
    body: JSON.stringify(params),
  });

  let data: HasilAktivasiKlien;
  let teks: string;
  try {
    teks = await response.text();
  } catch {
    return {
      ok: false,
      pesan:
        `Respons endpoint aktivasi tidak bisa dibaca (HTTP ${response.status}). ` +
        'Transaksi tetap tercatat di Midtrans; jangan bayar ulang. Hubungi administrator.',
    };
  }
  try {
    const hasil: unknown = JSON.parse(teks);
    if (
      typeof hasil !== 'object' ||
      hasil === null ||
      typeof (hasil as Record<string, unknown>).ok !== 'boolean'
    ) {
      throw new TypeError('Bentuk respons aktivasi tidak valid.');
    }
    data = hasil as HasilAktivasiKlien;
  } catch {
    return {
      ok: false,
      pesan:
        `Endpoint aktivasi tidak mengembalikan respons JSON yang valid (HTTP ${response.status}). ` +
        'Transaksi tetap tercatat di Midtrans; jangan bayar ulang. Hubungi administrator.',
    };
  }

  if (response.status === 401) {
    return {
      ok: false,
      pesan: data?.pesan ?? 'Sesi berakhir. Login ulang lalu ulangi pembayaran.',
    };
  }
  if (!response.ok && !data?.pesan) {
    return { ok: false, pesan: `Server menolak (HTTP ${response.status}).` };
  }
  return data;
}
