// Audit UI/UX 2026-10 · Fase 1G — helper bersama layar Scheduler dan Lead:
//  - `InlineError`: galat muat yang TAMPIL sebagai galat (dengan Coba lagi), bukan daftar kosong.
//  - `useServerDraft`: draft form yang disemai dari data server tetapi tak pernah ditimpa selagi
//    pengguna sedang mengubahnya (snapshot live yang datang saat Pause/Stop tak menghapus ketikan).
//  - `clampNumber`: kolom angka boleh kosong saat diketik; nilainya dijepit saat blur/Enter.
//  - `agoLabel` / `untilLabel`: waktu relatif dalam bahasa biasa ("5 menit lalu").
import React from "react";
import { Button } from "../ds";
import { relativeTime } from "../lib/time-format";

export function agoLabel(iso: string | null, now = Date.now()): string {
  return relativeTime(iso, now) || "—";
}

export function untilLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime() - now;
  if (d <= 0) return "jatuh tempo";
  const m = Math.ceil(d / 60_000);
  if (m < 60) return `${m} menit lagi`;
  return `${Math.ceil(m / 60)} jam lagi`;
}

/** Angka dari kolom teks. Kosong atau bukan angka → `fallback` (nilai tersimpan), selain itu dijepit ke [min, max]. */
export function clampNumber(raw: string, min: number, max: number, fallback: number, integer = true): number {
  const n = raw.trim() === "" ? NaN : Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  const v = integer ? Math.round(n) : n;
  return Math.min(max, Math.max(min, v));
}

/** Galat muat yang tampil sebagai galat dengan jalan keluar. Pemanggil memutuskan kapan dipakai. */
export function InlineError({ message, onRetry, busy = false }: { message: string; onRetry: () => void; busy?: boolean }) {
  return (
    <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0",
      fontSize: "var(--text-sm)", color: "var(--clay-500)" }}>
      <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
      <Button size="sm" variant="secondary" leftIcon="rotate-ccw" disabled={busy} onClick={onRetry}>Coba lagi</Button>
    </div>
  );
}

/**
 * Draft form yang disemai dari `server`. Snapshot server baru hanya menggantikan draft bila draft
 * masih identik dengan snapshot sebelumnya (= belum diedit). Perbandingan memakai ISI (JSON), bukan
 * identitas objek, karena tiap snapshot live membawa objek baru dengan isi yang sama.
 */
export function useServerDraft<T extends Record<string, unknown>>(server: T) {
  const [draft, setDraft] = React.useState<T>(server);
  const prev = React.useRef<T>(server);
  const key = JSON.stringify(server);
  React.useEffect(() => {
    const before = JSON.stringify(prev.current);
    prev.current = server;
    setDraft((d) => (JSON.stringify(d) === before ? server : d));
    // `key` adalah isi `server`; efek sengaja tak bergantung pada identitas objeknya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Tak identik dengan server terakhir = ada perubahan yang belum tersimpan.
  const dirty = JSON.stringify(draft) !== key;
  return { draft, setDraft, dirty };
}
