/**
 * Instance Firebase Admin — dipakai bersama oleh seluruh kode server.
 *
 * ## Kenapa modul ini ada
 *
 * Semula setiap modul server memuat `firebase-admin` sendiri:
 * `serverBilling.ts` (aktivasi langganan) dan, sejak autentikasi panel dipindah
 * ke server, `panelServer.ts` (login, peran, sesi). Dua pemuat terpisah berarti
 * dua app yang berbeda bisa diinisialisasi di proses yang sama, dan hanya satu
 * di antaranya yang kredensialnya dikenali — gejalanya `Must initialize the SDK
 * with a certificate credential` yang muncul tiba-tiba di deployment tertentu.
 *
 * Sekarang ada satu pemuat. `app` dan `firestore` selalu datang dari satu
 * `import()` yang sama, jadi dijamin satu salinan modul.
 *
 * ## Kenapa impornya dinamis
 *
 * Modul Admin hanya dibutuhkan oleh handler billing dan panel-auth, jadi
 * pemuatan tetap ditunda sampai ada pemanggilnya. Specifier harus literal agar
 * Vercel dapat menelusuri dan menyertakan paket eksternal ke function bundle.
 * `@google-cloud/firestore` juga dependency langsung agar tersedia saat build
 * dan runtime, bukan sekadar optional dependency dari firebase-admin.
 *
 * Build memakai `--packages=external`, sehingga import literal tetap mengarah
 * ke satu salinan SDK di node_modules dan tidak menggandakan modul.
 *
 * ## Batasnya
 *
 * Modul ini hanya boleh diimpor dari kode server. `tools/cek-keamanan.mjs`
 * menjaga itu: berkasnya ada di daftar `SERVER_ONLY`, sehingga `process.env`
 * yang dibacanya tidak dihitung sebagai kebocoran ke peramban.
 */

import { existsSync, readFileSync } from 'node:fs';

type AppDyn = import('firebase-admin/app').App;
type FirestoreDyn = import('firebase-admin/firestore').Firestore;

type AdminModul = {
  cert: typeof import('firebase-admin/app').cert;
  getApps: typeof import('firebase-admin/app').getApps;
  initializeApp: typeof import('firebase-admin/app').initializeApp;
  getFirestore: typeof import('firebase-admin/firestore').getFirestore;
};

let adminModul: AdminModul | null = null;
/** App yang sudah diinisialisasi, disimpan per-instance fungsi. */
let adminApp: AppDyn | null = null;

async function muatAdmin(): Promise<AdminModul> {
  if (adminModul) return adminModul;
  try {
    const [app, firestore] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
    ]);
    adminModul = {
      cert: app.cert,
      getApps: app.getApps,
      initializeApp: app.initializeApp,
      getFirestore: firestore.getFirestore,
    } as AdminModul;
  } catch (err) {
    throw new Error(
      'Paket "@google-cloud/firestore" tidak tersedia di server ini. Pasang dengan ' +
        '`npm i @google-cloud/firestore` (butuh Node >= 22). ' +
        `(${String((err as Error).message).slice(0, 160)})`
    );
  }
  return adminModul;
}

/**
 * Firestore yang dipakai, bisa ditimpa untuk pengujian.
 *
 * ⚠️ Hanya untuk skrip uji (`tools/cek-panel-auth.mjs`). Menimpanya berarti
 * modul berhenti membaca Firestore sungguhan — dan hanya jalan kalau skrip itu
 * yang memanggil. Tidak ada jalur di produksi yang menyentuh ini, dan
 * `tools/cek-keamanan.mjs` menjaga agar `process.env` yang dibaca modul ini
 * tidak pernah ikut ter-bundle ke peramban.
 */
let firestoreTiruan: FirestoreDyn | null = null;

export function __setFirestoreTiruan(tiruan: FirestoreDyn | null): void {
  firestoreTiruan = tiruan;
}

/**
 * True bila kredensial Admin tersedia — atau Firestore sedang ditirukan.
 *
 * Siruan tiruan membuat skrip uji bisa menguji handler HTTP tanpa service
 * account. Tanpa penyesuaian ini, `ringkasanPanelAuth()` akan melaporkan "belum
 * siap" dan `/api/panel-auth` menjawab 503 untuk semua permintaan — termasuk
 * yang seharusnya menguji penolakan peran.
 */
export function adminTersedia(): boolean {
  if (firestoreTiruan) return true;
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT ||
      (process.env.GOOGLE_APPLICATION_CREDENTIALS &&
        existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.K_SERVICE
  );
}

/**
 * Firestore dengan hak Admin.
 *
 * `async` karena `firebase-admin/firestore` dimuat saat pemanggilan, bukan saat
 * modul diimpor. Semua pemanggilnya sudah `async`, jadi bentuk pemanggilannya
 * tidak berubah.
 */
export async function admin(): Promise<FirestoreDyn> {
  if (firestoreTiruan) return firestoreTiruan;
  const { cert, getApps, initializeApp, getFirestore } = await muatAdmin();
  if (adminApp) return getFirestore(adminApp);

  /*
   * Aplikasi yang sudah ada dipakai ulang, apa pun sumber kredensialnya.
   *
   * Ketiga cabang di bawah dulu memanggil `initializeApp()` tanpa melihat
   * `[DEFAULT]` lebih dulu. Label yang belum pernah berarti berhasil selama hanya
   * ada satu salinan modul ini di satu proses — dan itulah asumsinya yang
   * rapuh. Begitu modul termuat dua kali (bundel serverless yang dipanggil
   * berdampingan dengan modul sumber pada skrip uji, hot-reload di
   * pengembangan), pemanggilan kedua gagal dengan:
   *
   *     Firebase app named "[DEFAULT]" already exists and initializeApp was
   *     invoked with an optional Credential.
   *
   * Dua masalah sekaligus. Yang teknis: SDK tidak bisa memastikan kedua objek
   * kredensial sama, jadi ia menolak alih-alih memakai yang sudah ada. Yang
   * lebih buruk: pesan itu dibungkus jadi `FIREBASE_SERVICE_ACCOUNT tidak
   * valid` — padahal kredensialnya **sah**, dan yang membuat gagal adalah
   * pemanggilan kedua. Operator bisa menghabiskan waktu berjam-jam
   * mengganti berkas JSON service account yang sebenarnya sudah benar.
   *
   * `getApps()` sudah diimpor untuk cabang metadata; sekarang dipakai di
   * semua cabang, dan urutannya sama: aplikasi yang ada menang, `initializeApp`
   * hanya jalan kalau memang belum ada.
   */
  const aplikasiAda = getApps();
  if (aplikasiAda.length) {
    adminApp = aplikasiAda[0];
    return getFirestore(adminApp);
  }

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    try {
      adminApp = initializeApp({
        credential: cert(JSON.parse(inline)),
        ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}),
      });
      return getFirestore(adminApp);
    } catch (err) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT tidak valid: ${(err as Error).message}`);
    }
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath && existsSync(credentialPath)) {
    adminApp = initializeApp({
      credential: cert(JSON.parse(readFileSync(credentialPath, 'utf8'))),
      ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {}),
    });
    return getFirestore(adminApp);
  }

  // Metadata Google Cloud (Cloud Run / App Engine / GCE).
  // Tanpa kredensial eksplisit, project diambil dari metadata Google Cloud.
  // Mengirim `projectId: undefined` di sini menimpanya dengan `undefined`.
  adminApp = process.env.FIREBASE_PROJECT_ID
    ? initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
    : initializeApp({});
  return getFirestore(adminApp);
}

