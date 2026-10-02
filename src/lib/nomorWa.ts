/**
 * Normalisasi nomor WhatsApp.
 *
 * Dipisah dari `langganan.ts` karena modul itu menarik Firestore. Modul ini
 * dibutuhkan `userManager.ts` (menyimpan nomor WhatsApp tiap akun) yang juga
 * dipakai saat login — dan menarik seluruh modul langganan ke sana hanya
 * demi satu fungsi string tidak perlu. `langganan.ts` meng-ekspor ulang
 * semuanya, jadi tidak ada yang berubah bagi pemanggil yang sudah ada.
 */

export interface HasilNormalisasiWa {
  ok: boolean;
  /** Nomor bersih dalam format internasional, mis. `6281234567890`. */
  nomor: string;
  pesan?: string;
}

/**
 * Normalisasi nomor WhatsApp ke format internasional.
 *
 * Admin mengetik dengan berbagai bentuk — `0812…`, `+62 812…`, `812…`,
 * `002812…`, dengan spasi, strip, atau kurung. Semuanya harus berakhir di
 * URL `wa.me` yang sama, jadi semuanya dinormalkan ke `628…` (tanpa `+`,
 * tanpa spasi).
 *
 * Aturannya:
 * - Semua non-angka dibuang.
 * - Nol di depan dibuang.
 * - Kalau sisa angka sudah diawali `62`, dipakai apa adanya.
 * - Kalau diawali `8`, `62` ditempelkan — inilah kasus `0812…` dan `812…`.
 * - Hasilnya **harus** diawali `628`. Semua nomor WhatsApp Indonesia adalah
 *   ponsel (`62` + `8`); nomor telepon tetap (`622…`) ditolak dengan pesan
 *   yang jelas, bukan diterima lalu gagal saat dikirim.
 * - Panjang akhir 9–14 digit. Kurang dari 9 hampir pasti salah ketik;
 *   lebih dari 14 bukan nomor Indonesia.
 */
export function normalisasiNomorWa(masuk: string): HasilNormalisasiWa {
  const mentah = String(masuk ?? '').trim();
  if (!mentah) return { ok: false, nomor: '', pesan: 'Nomor WhatsApp wajib diisi.' };

  // Buang apa pun kecuali angka. Tanda `+` tidak perlu ditangani
  // terpisah — setelah semua non-angka dibuang, `+62…` dan `62…` identik.
  let angka = mentah.replace(/\D/g, '');

  if (!angka) return { ok: false, nomor: '', pesan: 'Nomor tidak mengandung angka.' };

  // Buang nol di depan, lalu pasang ulang satu kali saja.
  //
  // ⚠️ Menempelkan `62` tanpa memeriksa sisa angka akan merusak input seperti
  // `0028123456789`: setelah nol dibuang tersisa `2812…`, lalu `62` ditempel
  // lagi jadi `6228…` — nomor yang tidak ada. Karena itu sisa angka
  // diperiksa dulu: kalau sudah membawa `62`, tidak perlu apa-apa.
  const sisa = angka.replace(/^0+/, '');
  if (sisa.startsWith('62')) {
    angka = sisa;
  } else if (sisa.startsWith('8')) {
    angka = `62${sisa}`;
  } else if (angka.startsWith('0') || angka.startsWith('8')) {
    angka = `62${sisa}`;
  }

  if (!angka.startsWith('62')) {
    return {
      ok: false,
      nomor: '',
      pesan: 'Nomor harus diawali 62 (kode negara Indonesia), contoh: 6281234567890.',
    };
  }

  // Semua nomor WhatsApp Indonesia adalah ponsel: 62 + 8. Nomor yang mulai
  // `622` (telepon tetap) ditolak dengan pesan yang jelas, bukan diterima
  // lalu gagal saat dikirim.
  if (!angka.startsWith('628')) {
    return {
      ok: false,
      nomor: '',
      pesan: 'Nomor harus diawali 628 (ponsel Indonesia), contoh: 6281234567890.',
    };
  }

  // Panjang minimal 628 + 6 digit = 9. Maksimal 628 + 11 = 14.
  if (angka.length < 9) return { ok: false, nomor: '', pesan: 'Nomor terlalu pendek (minimal 9 digit).' };
  if (angka.length > 14) return { ok: false, nomor: '', pesan: 'Nomor terlalu panjang (maksimal 14 digit).' };

  return { ok: true, nomor: angka };
}
