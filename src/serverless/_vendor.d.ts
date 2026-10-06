/**
 * Deklarasi tipe untuk paket yang tidak menyertakan `.d.ts`.
 *
 * Dimuat lewat `src/serverless/ocr.ts`, yang memakai `any` untuk
 * `onnxruntime-node` dan `sharp` karena dua paket itu tidak punya tipe.
 *
 * ⚠️ Kedua paket itu **tidak lagi jadi dependency** — dicabut saat OCR
 * dihapus dari Vercel. Berkas ini tetap disimpan karena `ocr.ts` masih ada
 * sebagai sumber: menyalakannya di node lokal berarti memasang dua paket itu
 * lagi, dan tanpa deklarasi ini `npm run typecheck` gagal dengan
 * "Cannot find module" — bukan error yang menjelaskan penyebabnya.
 *
 * Kalau `src/serverless/ocr.ts` dihapus suatu hari, hapus berkas ini sekaligus.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module 'onnxruntime-node' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const InferenceSession: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Tensor: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const env: any;
}

declare module 'sharp' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sharp(input?: any, options?: any): any;
  export = sharp;
  export default sharp;
}