import type { AccessRequestStatus, PresenceDeviceView } from "@hanoman/shared";

/* ADR-0217 · opsi C dari ADR-0216. Helper murni untuk dua sisi permintaan tingkat akses:
   - hub (Klien › Perangkat): tombol "Minta tingkat…" per perangkat remote;
   - perangkat ini (RemoteAccessCard): kartu persetujuan untuk permintaan yang masuk lewat relay.
   Berkas ini tanpa render supaya tiap cabangnya bisa diuji langsung. */

/** Label status untuk daftar permintaan. `pending` berarti menunggu OPERATOR PERANGKAT ITU, bukan hub. */
export const REQUEST_STATUS_LABEL: Readonly<Record<AccessRequestStatus, string>> = {
  pending: "menunggu persetujuan di perangkat itu",
  approved: "disetujui",
  rejected: "ditolak",
  expired: "kedaluwarsa",
};

/** Alasan tombol "Minta tingkat…" mati, dalam bahasa biasa. `null` = permintaan boleh dikirim. Tak
    memeriksa `sessions:read`: meminta Lihat tak membutuhkan grant apa pun di pihak peminta. */
export function requestBlockReason(d: PresenceDeviceView): string | null {
  if (!d.online) return "Perangkat sedang offline, jadi permintaan tak bisa dikirim.";
  if (d.control?.state === "protocol-mismatch") return "Versi protokol perangkat tak cocok dengan server ini.";
  if (!d.control) return "Kendali jarak jauh belum diizinkan di perangkat ini, jadi tak ada permintaan yang bisa dikirim.";
  return null;
}

/** Nama hub peminta untuk kalimat ke operator: host saja bila `from` URL sah (mis. `hub.example`). */
export function hostOf(from: string): string {
  try { return new URL(from).host || from; } catch { return from; }
}
