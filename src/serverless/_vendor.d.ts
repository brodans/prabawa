// Deklarasi tipe minimal untuk paket yang tidak menyertakan .d.ts
// Dipakai oleh src/serverless/ocr.ts (dibangun dengan esbuild, bukan tsc)

/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'onnxruntime-node' {
  export const InferenceSession: any;
  export const Tensor: any;
  export const env: any;
  export default { InferenceSession, Tensor, env } as any;
}

declare module 'sharp' {
  function sharp(input?: any, options?: any): any;
  export = sharp;
  export default sharp;
}
