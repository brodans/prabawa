type ResponsSnap = Record<string, unknown> & {
  token: string;
};

export function responsSnapBerhasil(data: unknown): data is ResponsSnap {
  return (
    typeof data === 'object' &&
    data !== null &&
    'token' in data &&
    typeof data.token === 'string' &&
    data.token.trim().length > 0
  );
}

export function pesanGalatSnap(data: unknown, statusHttp: number): string {
  if (typeof data === 'object' && data !== null) {
    const detail = data as Record<string, unknown>;
    const pesanMidtrans = Array.isArray(detail.error_messages)
      ? detail.error_messages.find((item): item is string => typeof item === 'string' && item.trim() !== '')
      : undefined;
    if (pesanMidtrans) return pesanMidtrans;
    if (typeof detail.status_message === 'string' && detail.status_message.trim()) {
      return detail.status_message;
    }
    if (typeof detail.status_code === 'string' || typeof detail.status_code === 'number') {
      return `Midtrans menolak transaksi (kode ${detail.status_code}, HTTP ${statusHttp}).`;
    }
  }
  return `Gagal memproses transaksi Midtrans (HTTP ${statusHttp}).`;
}
