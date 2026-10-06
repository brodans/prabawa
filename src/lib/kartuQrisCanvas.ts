import qrcode from 'qrcode-generator';
import { ringkasQRIS } from './qris';

/**
 * Menggambar kartu QRIS ke kanvas.
 *
 * Dipisah dari komponen React supaya bisa diuji tanpa browser: modul ini
 * hanya butuh objek ber-ukuran, `getContext()`, `createPattern()`, dan
 * `measureText()`. Di aplikasi semuanya datang dari DOM; di skrip uji dari
 * perekam panggilan — sehingga apa yang benar-benar digambar bisa diperiksa
 * tanpa menebak.
 *
 * Fungsi ini **sinkron**. Menunggu font siap dan mengubah kanvas menjadi PNG
 * tetap urusan pemanggil (`KartuQris`).
 */

/** Lebar & tinggi kartu logis. */
export const KARTU_LEBAR = 400;
export const KARTU_TINGGI = 580;
/** Rasio kartu (lebar ÷ tinggi). */
export const KARTU_RASIO = KARTU_LEBAR / KARTU_TINGGI;
/** Panjang sisi QR dalam piksel logis. */
export const UKURAN_QR = 250;
/** Warna aksen segitiga (standar QRIS). */
export const WARNA_QRIS = '#DA291C';

/** Cuplikan kanvas yang dibutuhkan modul ini. */
export interface KanvasPenggambar {
  width: number;
  height: number;
  getContext(id: '2d'): Konteks2D | null;
}

/** Cuplikan context 2D yang dipakai modul ini. */
export interface Konteks2D {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  textAlign: string;
  imageSmoothingQuality: string;
  font: string;
  scale(x: number, y: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  createPattern(image: unknown, repetition: string): unknown;
}

/** Gambar yang sudah termuat — cukup ukuran untuk menggambarnya. */
export interface GambarMuat {
  width: number;
  height: number;
}

export interface OpsiGambarKartu {
  qrisString: string;
  /** Faktor render; 3 = tajam di layar retina. */
  skala?: number;
  /** Panjang font — harus sama dengan font yang sudah dimuat halaman. */
  fontFamily?: string;
  /**
   * Logo QRIS (black) di kiri kepala kartu.
   *
   * Sudah harus termuat (`img.complete && naturalWidth > 0`) sebelum
   * pemanggilan — menggambar `<img>` yang belum selesai diunduh membuat
   * canvas menggambar apa pun tanpa error, jadi logo hilang diam-diam.
   */
  logoQris?: GambarMuat | null;
  /** Logo GPN di kanan kepala kartu. */
  logoGpn?: GambarMuat | null;
}

/** Hasil gambar, termasuk matriks QR supaya bisa diuji terpisah. */
export interface HasilGambarKartu {
  /** Kanvas QR terpisah (belum diskalakan). */
  kanvasQr: KanvasPenggambar;
  /** Jumlah modul QR per sisi. */
  modul: number;
  /** Panjang satu modul dalam piksel. */
  px: number;
  /** Sisi QR yang benar-benar tergambar. */
  sisiQr: number;
}

/**
 * Menggambar kartu lengkap di atas `kanvasKartu`.
 *
 * @throws Error bila string QRIS tidak bisa di-encode.
 */
export function gambarKartuQris(
  kanvasKartu: KanvasPenggambar,
  buatKanvas: (lebar: number, tinggi: number) => KanvasPenggambar,
  opsi: OpsiGambarKartu
): HasilGambarKartu {
  const skala = opsi.skala ?? 3;
  const fontFamily = opsi.fontFamily ?? "'Plus Jakarta Sans', system-ui, sans-serif";
  const font = (weight: number, size: number) => `${weight} ${size}px ${fontFamily}`;

  // ── QR ke kanvas terpisah ────────────────────────────────────────
  const qr = qrcode(0, 'M');
  qr.addData(opsi.qrisString);
  qr.make();
  const modul = qr.getModuleCount();
  // `floor` supaya modul terakhir tidak pernah meluber keluar kotak.
  const px = Math.max(2, Math.floor(UKURAN_QR / modul));

  const kanvasQr = buatKanvas(modul * px, modul * px);
  const ctxQr = kanvasQr.getContext('2d');
  if (!ctxQr) throw new Error('Canvas 2D tidak tersedia.');
  ctxQr.fillStyle = '#ffffff';
  ctxQr.fillRect(0, 0, kanvasQr.width, kanvasQr.height);
  ctxQr.fillStyle = '#000000';
  for (let r = 0; r < modul; r++) {
    for (let c = 0; c < modul; c++) {
      if (!qr.isDark(r, c)) continue;
      ctxQr.fillRect(c * px, r * px, px, px);
    }
  }

  // ── Kartu ────────────────────────────────────────────────────────
  const ctx = kanvasKartu.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D tidak tersedia.');
  ctx.scale(skala, skala);

  const bulat = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // 1. Dasar putih.
  bulat(0, 0, KARTU_LEBAR, KARTU_TINGGI, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // 2. Motif kawung (batik Jawa) sebagai latar.
  ctx.save();
  bulat(0, 0, KARTU_LEBAR, KARTU_TINGGI, 24);
  ctx.clip();
  const pola = buatKanvas(56, 56);
  const pCtx = pola.getContext('2d');
  if (pCtx) {
    pCtx.strokeStyle = 'rgba(100, 116, 139, 0.18)';
    pCtx.lineWidth = 1.5;
    pCtx.strokeRect(12, 12, 32, 32);
    pCtx.strokeRect(20, 20, 16, 16);
    pCtx.beginPath();
    pCtx.moveTo(28, 0);
    pCtx.lineTo(28, 12);
    pCtx.moveTo(28, 44);
    pCtx.lineTo(28, 56);
    pCtx.moveTo(0, 28);
    pCtx.lineTo(12, 28);
    pCtx.moveTo(44, 28);
    pCtx.lineTo(56, 28);
    pCtx.stroke();
  }
  const pattern = ctx.createPattern(pola, 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.beginPath();
    ctx.moveTo(0, 230);
    ctx.lineTo(300, KARTU_TINGGI);
    ctx.lineTo(0, KARTU_TINGGI);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(KARTU_LEBAR, 230);
    ctx.lineTo(100, KARTU_TINGGI);
    ctx.lineTo(KARTU_LEBAR, KARTU_TINGGI);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 3. Aksen segitiga merah.
  ctx.save();
  bulat(0, 0, KARTU_LEBAR, KARTU_TINGGI, 24);
  ctx.clip();
  ctx.fillStyle = WARNA_QRIS;
  ctx.beginPath();
  ctx.moveTo(0, 150);
  ctx.lineTo(110, 250);
  ctx.lineTo(0, 360);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(250, KARTU_TINGGI);
  ctx.lineTo(KARTU_LEBAR, KARTU_TINGGI - 150);
  ctx.lineTo(KARTU_LEBAR, KARTU_TINGGI);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 4. Kepala: logo QRIS + GPN, dengan label di antaranya.
  //
  // Logo digambar dengan rasio aslinya (lebarTinggi dihitung dari
  // `width`/`height` gambar). Kalau dipaksa jadi persegi, bentuk logo
  // akan gepeng — dan QRIS maupun GPN keduanya logo yang memanjang.
  const tinggiLogo = 30;
  const rasioLogo = (g: GambarMuat) => (g.height > 0 ? g.width / g.height : 2.7);

  ctx.textAlign = 'left';
  let kiriTeks = 25;
  if (opsi.logoQris) {
    const lebarLogo = tinggiLogo * rasioLogo(opsi.logoQris);
    ctx.drawImage(opsi.logoQris, 25, 28, lebarLogo, tinggiLogo);
    kiriTeks = 25 + lebarLogo + 12;
  }
  ctx.fillStyle = '#0f172a';
  ctx.font = font(800, 14);
  ctx.fillText('QR Code Standar', kiriTeks, 44);
  ctx.fillStyle = '#334155';
  ctx.font = font(600, 13);
  ctx.fillText('Pembayaran Nasional', kiriTeks, 62);

  if (opsi.logoGpn) {
    const lebarGpn = tinggiLogo * rasioLogo(opsi.logoGpn);
    ctx.drawImage(opsi.logoGpn, KARTU_LEBAR - 25 - lebarGpn, 28, lebarGpn, tinggiLogo);
  }

  // 5. Nama merchant, diperkecil otomatis agar muat.
  const meta = ringkasQRIS(opsi.qrisString);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0f172a';
  let ukuran = 22;
  ctx.font = font(800, ukuran);
  let nama = meta.namaMerchant || 'PRABAWA';
  while (ctx.measureText(nama).width > 340 && ukuran > 14) {
    ukuran -= 1;
    ctx.font = font(800, ukuran);
  }
  if (ctx.measureText(nama).width > 340) {
    while (ctx.measureText(`${nama}...`).width > 340 && nama.length > 0) nama = nama.slice(0, -1);
    nama += '...';
  }
  ctx.fillText(nama, KARTU_LEBAR / 2, 120);

  // NMID diambil dari GUID di dalam Merchant Account Info.
  const nmid = opsi.qrisString.match(/0215(ID[A-Z0-9]{13})/)?.[1] ?? '';
  if (nmid) {
    ctx.fillStyle = '#64748b';
    ctx.font = font(500, 13);
    ctx.fillText(`NMID: ${nmid}`, KARTU_LEBAR / 2, 144);
  }

  // 6. Kotak putih QR.
  const sisiKotak = UKURAN_QR + 30;
  const xKotak = (KARTU_LEBAR - sisiKotak) / 2;
  const yKotak = 175;
  ctx.fillStyle = '#ffffff';
  bulat(xKotak, yKotak, sisiKotak, sisiKotak, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(kanvasQr, (KARTU_LEBAR - UKURAN_QR) / 2, yKotak + 15, UKURAN_QR, UKURAN_QR);

  // 7. Kaki kartu.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = font(700, 16);
  ctx.fillText('Scan dengan aplikasi apa pun', 25, 500);
  ctx.fillStyle = '#64748b';
  ctx.font = font(500, 13);
  ctx.fillText('GoPay · OVO · DANA · ShopeePay · m-banking', 25, 522);
  ctx.fillStyle = '#94a3b8';
  ctx.font = font(600, 12);
  ctx.fillText('QRIS Dinamis · nominal terkunci di dalam QR', 25, 552);

  return { kanvasQr, modul, px, sisiQr: modul * px };
}
