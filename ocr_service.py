#!/usr/bin/env python3
"""Layanan OCR captcha e-Presensi BKD Jatim.

Model ddddocr dimuat SEKALI lalu melayani banyak permintaan (HTTP lokal),
supaya proses login di frontend tidak perlu menunggu pemuatan model tiap kali.

Endpoint:
  GET  /health  -> {"ok": true, "engine": "ddddocr", "panjang": 4}
  POST /ocr     -> body = byte gambar captcha (GIF/PNG/JPG), balasan:
                   {"ok": true, "text": "1452", "kandidat": [...], "yakin": true}

Dipakai oleh dev-server Vite (lihat plugin `ocrCaptcha()` di vite.config.js).
Dijalankan otomatis; bisa juga manual:
    python3 ocr_service.py --port 8791
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Panjang captcha e-Presensi (4 digit).
PANJANG_CAPTCHA = 4
MAX_BODY = 2 * 1024 * 1024  # 2 MB, jauh lebih dari cukup untuk captcha 180x40

_engine = None
_wrapper = None  # PENTING: __del__ milik objek ddddocr memanggil cleanup()
# yang mengosongkan session. Referensi ini menahannya agar tetap hidup.
_charset = None
_digit_idx = None
_lock = threading.Lock()


def muat_model():
    """Muat ddddocr sekali saja (lazy)."""
    global _engine, _wrapper, _charset, _digit_idx
    if _engine is not None:
        return _engine
    with _lock:
        if _engine is not None:
            return _engine
        try:
            import ddddocr  # noqa: PLC0415
        except Exception as exc:  # pragma: no cover - jalur kegagalan
            raise SystemExit(
                "ddddocr tidak terpasang. Jalankan: pip install ddddocr\n"
                f"Detail: {exc}"
            ) from exc

        wrapper = ddddocr.DdddOcr(show_ad=False)
        # OCREngine baru menyimpan session + charset di dalam objeknya.
        internal = getattr(wrapper, "ocr_engine", None) or wrapper
        charset = internal.charset_manager.get_charset()
        digit_idx = [i for i, c in enumerate(charset) if c in "0123456789" and i != 0]

        _engine, _wrapper, _charset, _digit_idx = internal, wrapper, charset, digit_idx
        return _engine


def _logits(gambar: bytes):
    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415
    import io  # noqa: PLC0415

    eng = muat_model()
    img = Image.open(io.BytesIO(gambar))
    arr = eng._preprocess_image(img, False)
    nama = eng.session.get_inputs()[0].name
    out = eng.session.run(None, {nama: arr})[0]
    if getattr(out, "ndim", 2) == 3:
        out = out[0] if out.shape[0] == 1 else out[:, 0, :]
    return out


def _ctc_decode(indeks, charset) -> str:
    """CTC greedy decode: buang blank (index 0) dan duplikat berurutan."""
    hasil = []
    sebelumnya = None
    for i in indeks:
        i = int(i)
        if i != sebelumnya and i != 0:
            hasil.append(charset[i])
        sebelumnya = i
    return "".join(hasil)


def selesaikan_captcha(gambar: bytes) -> dict:
    """Kembalikan hasil OCR: teks utama + kandidat alternatif."""
    import numpy as np  # noqa: PLC0415

    logits = _logits(gambar)
    charset = _charset

    # Kandidat 1: argmax dibatasi ke digit 0-9. Index 0 (blank CTC) WAJIB ikut
    # disertakan, kalau tidak, penggabungan karakter CTC rusak.
    diizinkan = _digit_idx + [0]
    tertutup = np.full(logits.shape, -1e9, dtype=np.float32)
    tertutup[:, diizinkan] = logits[:, diizinkan]
    teks_digit = _ctc_decode(np.argmax(tertutup, axis=1), charset)

    # Kandidat 2: argmax penuh (bisa memuat huruf mirip, mis. 'z' untuk '1').
    teks_bebas = _ctc_decode(np.argmax(logits, axis=1), charset)

    kandidat = []
    for t in (teks_digit, teks_bebas):
        if t and t not in kandidat:
            kandidat.append(t)

    # Pilih kandidat terbaik: utamakan 4 digit murni, lalu panjang 4, terakhir
    # kandidat pertama yang tersedia.
    utama = (
        next((k for k in kandidat if len(k) == PANJANG_CAPTCHA and k.isdigit()), None)
        or next((k for k in kandidat if len(k) == PANJANG_CAPTCHA), None)
        or (kandidat[0] if kandidat else "")
    )

    return {
        "ok": True,
        "text": utama,
        "kandidat": kandidat,
        "yakin": utama.isdigit() and len(utama) == PANJANG_CAPTCHA,
        "panjang": PANJANG_CAPTCHA,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ePresensiOCR/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # senyapkan log default
        if os.environ.get("OCR_DEBUG"):
            sys.stderr.write("ocr: " + fmt % args + "\n")

    def _kirim(self, kode: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(kode)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] in ("/health", "/"):
            try:
                muat_model()
                self._kirim(200, {"ok": True, "engine": "ddddocr", "panjang": PANJANG_CAPTCHA})
            except SystemExit as exc:
                self._kirim(503, {"ok": False, "error": str(exc)})
        else:
            self._kirim(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/ocr":
            self._kirim(404, {"ok": False, "error": "not found"})
            return
        try:
            panjang = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            panjang = 0
        if panjang <= 0 or panjang > MAX_BODY:
            self._kirim(400, {"ok": False, "error": "body gambar kosong/terlalu besar"})
            return
        gambar = self.rfile.read(panjang)
        try:
            hasil = selesaikan_captcha(gambar)
        except Exception as exc:  # pragma: no cover - jalur kegagalan
            self._kirim(500, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})
            return
        self._kirim(200, hasil)


def main() -> int:
    p = argparse.ArgumentParser(description="OCR captcha e-Presensi (ddddocr)")
    p.add_argument("--host", default=os.environ.get("EPRESENSI_OCR_HOST", "127.0.0.1"))
    p.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("EPRESENSI_OCR_PORT", "8791")),
    )
    p.add_argument("--warmup", action="store_true", help="muat model sebelum melayani")
    args = p.parse_args()

    if args.warmup:
        muat_model()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    print(f"[ocr] ddddocr siap di http://{args.host}:{args.port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
