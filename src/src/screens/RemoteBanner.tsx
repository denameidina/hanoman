/* RemoteBanner (SPEC-1218 · ADR-0165 §11) — bar identitas di atas RemoteInstanceView: perangkat mana
   yang sedang dilihat, penanda hanya-baca, dan peringatan bila versi server pusat ≠ versi perangkat.
   Latar & border sengaja kuat: ini satu-satunya tanda bahwa layar di bawahnya milik perangkat LAIN.
   Tombol Tutup memakai Button DS (`hn-touch-target`, ≥44px pada pointer kasar). */
import { Badge, Button } from "../ds";
import type { PresenceDeviceView } from "@hanoman/shared";

export function RemoteBanner({ device, hubVersion, onClose }:
  { device: PresenceDeviceView; hubVersion: string; onClose?: () => void }) {
  const mismatchVersion = device.control!.version !== hubVersion;
  return (
    <div role="status" data-testid="remote-banner" style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
      padding: "10px 12px", marginBottom: 12,
      background: "var(--brass-050)", border: "1px solid var(--brass-400)",
      borderLeft: "3px solid var(--brass-600)", borderRadius: "var(--radius-md)",
      color: "var(--text-strong)", fontSize: 13, lineHeight: 1.4,
    }}>
      <span style={{ flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere" }}>
        Sedang melihat perangkat <b>{device.name}</b> · versi {device.control!.version}
      </span>
      <Badge tone="neutral" size="sm">hanya baca</Badge>
      {mismatchVersion && <Badge tone="warn" size="sm">versi server pusat berbeda</Badge>}
      {onClose && <Button size="sm" variant="secondary" onClick={onClose}>Tutup</Button>}
    </div>
  );
}
