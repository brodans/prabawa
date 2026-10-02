import { useCallback, useRef, useState, type DragEvent } from 'react';
import { FileUp, Paperclip, Trash2 } from 'lucide-react';

/**
 * Area unggah berkas: bisa diklik **dan** bisa diseret.
 *
 * ## Kenapa perlu komponen, bukan `drop` di `<input type="file">`
 *
 * `<input type="file">` punya `drop` yang **tidak** bisa diandalkan sama sekali
 * di peramban mana pun — di sebagian besar, melepaskan berkas di atasnya hanya
 * memuat halaman pertama (navigasi), bukan mengisi input. Yang bisa diandalkan
 * hanya `dragover` + `drop` pada elemen yang dikontrol sendiri, lalu meneruskan
 * `File` ke pemanggil.
 *
 * Jadi `<input type="file">` tetap ada — disembunyikan, dan tetap jadi jalan
 * yang bisa dioperasikan keyboard dan pembaca layar. Visible area hanyalah
 * permukaan visual di atasnya.
 *
 * ## Hitungan `dragenter` / `dragleave`
 *
 * Kedua event itu **menyala di setiap elemen anak** yang dilewati kursor, bukan
 * hanya saat benar-benar masuk atau keluar area. Tanpa penghitung, tiap
 * gerakan kursor kecil di atas teks di dalam kotak akan mengubah status
 * `dragover` menjadi `false` lalu `true` lagi — sorotan berkedip.
 *
 * Penghitung di sini incremented/decremented, jadi hanya perpindahan
 * benar-benar keluar area yang menonaktifkan.
 *
 * ## Validasi di satu tempat
 *
 * Pemanggil sudah punya `handleFile()` yang menolak jenis dan ukuran salah.
 * `Dropzone` **tidak** menyalin aturan itu. Validasi tetap di satu tempat,
 * supaya tidak ada jalan (klik atau seret) yang lolos dari pemeriksaan.
 * Yang dilakukan di sini hanya hal yang tidak boleh terlewat di jalur seret:
 * `dataTransfer.files` yang kosong, dan `preventDefault()` pada `drop` supaya
 * peramban tidak memuat berkas sebagai halaman.
 */

/** Bentuk `accept` HTML, mis. `"image/jpeg,application/pdf"`. */
export interface DropzoneProps {
  /** Nama berkas yang sudah dipilih; `''` = belum ada. */
  value: string;
  onPilih: (file: File | null) => void;
  /** Atribut `accept` untuk `<input type="file">`. */
  accept: string;
  /** Label tombol & area saat kosong. */
  label?: string;
  /** Penjelasan singkat di dalam area saat kosong. */
  hint?: string;
  /** Nonaktifkan interaksi. */
  disabled?: boolean;
  className?: string;
}

export default function Dropzone({
  value,
  onPilih,
  accept,
  label = 'Pilih Berkas',
  hint,
  disabled = false,
  className = '',
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Penghitung `dragenter`/`dragleave` — lihat penjelasan di header. */
  const depthRef = useRef(0);
  const [seret, setSeret] = useState(false);

  const pilih = useCallback(
    (file: File | null) => {
      /*
       * `input.value` dikosongkan setiap kali berkas dipilih.
       *
       * Tanpa ini, memilih berkas yang sama dua kali berturut-turut tidak
       * memicu `change` — peramban melihat nilainya tidak berubah, dan
       * pengunggahan kedua diam-diam tidak terjadi. Gejalanya: pengguna memilih
       * ulang berkas yang sama, menekan Simpan, dan tidak terjadi apa-apa.
       */
      if (inputRef.current) inputRef.current.value = '';
      onPilih(file);
    },
    [onPilih]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      // `preventDefault` di `drop` adalah satu-satunya cara mencegah peramban
      // memuat berkas yang dijatuhkan sebagai halaman. Tanpa ini, satu
      // seretan yang salah membuat seluruh tab hilang isinya.
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = 0;
      setSeret(false);
      if (disabled) return;
      pilih(event.dataTransfer.files?.[0] ?? null);
    },
    [disabled, pilih]
  );

  const adaBerkas = value !== '';

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        disabled={disabled}
        onChange={event => pilih(event.target.files?.[0] ?? null)}
      />

      {adaBerkas ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3.5 py-2.5">
          <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate min-w-0 flex-1">
            {value}
          </span>
          <button
            type="button"
            onClick={() => pilih(null)}
            disabled={disabled}
            className="p-1 rounded-md text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors shrink-0 disabled:opacity-40"
            aria-label="Hapus lampiran"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={event => {
            if (disabled) return;
            // Enter dan Space adalah aktivasi yang diharapkan untuk elemen
            // `role="button"`. Tanpa keduanya, area ini hanya bisa dipakai
            // dengan tetikus — dan `div` bukan elemen yang bisa difokus
            // otomatis ke keyboard.
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragEnter={event => {
            event.preventDefault();
            event.stopPropagation();
            depthRef.current += 1;
            if (!disabled) setSeret(true);
          }}
          onDragOver={event => {
            // Wajib: tanpa `preventDefault` di `dragover`, `drop` tidak pernah
            // menyala dan peramban menganggap area ini bukan tujuan seret.
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={event => {
            event.preventDefault();
            event.stopPropagation();
            depthRef.current = Math.max(0, depthRef.current - 1);
            if (depthRef.current === 0) setSeret(false);
          }}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
            disabled
              ? 'cursor-not-allowed opacity-50 border-slate-200 dark:border-slate-700'
              : 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
          } ${
            seret
              ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
              : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
          }`}
        >
          <FileUp
            className={`w-5 h-5 ${seret ? 'text-blue-500' : 'text-slate-400'} transition-colors`}
          />
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {seret ? 'Lepaskan di sini' : label}
          </p>
          {hint && <p className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
        </div>
      )}
    </div>
  );
}
