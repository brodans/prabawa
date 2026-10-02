/**
 * Vercel Serverless Function — autentikasi & otorisasi panel.
 *
 * Handler tipis: seluruh logika ada di `src/serverless/_panel.ts` yang juga
 * dipakai Express (`src/api/server.ts`), supaya dua lingkungan tidak bisa
 * berbeda perilaku.
 *
 * Endpoint ini mengembalikan **403 untuk origin yang tidak ada di
 * `ALLOWED_ORIGINS`** dan **503 dengan pesan perbaikannya** kalau
 * `PANEL_SESSION_SECRET` belum diisi. Dua-duanya disengaja: endpoint
 * autentikasi yang diam-diam gagal hanya membuat orang menebak-nebak.
 */

import { tanganiPanelAuth } from './_panel';

export default async function handler(req: any, res: any) {
  try {
    return await tanganiPanelAuth(req, res);
  } catch (err: unknown) {
    console.error('[panel-auth] handler gagal:', err);
    return res.status(500).json({ ok: false, kode: 500, pesan: 'Gagal memproses di server.' });
  }
}
