/* RemoteBanner (SPEC-1218 · ADR-0165 §11) — bar identitas di atas RemoteInstanceView: klien mana
   yang sedang dicermin, badge baca-saja, dan peringatan bila versi hub ≠ versi klien. */
import { Badge } from "../ds";
import type { PresenceDeviceView } from "@hanoman/shared";

export function RemoteBanner({ device, hubVersion, onClose }:
  { device: PresenceDeviceView; hubVersion: string; onClose?: () => void }) {
  const mismatchVersion = device.control!.version !== hubVersion;
  return (
    <div role="status" data-testid="remote-banner" style={{
      display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
    }}>
      <span>Sedang melihat klien {device.name} · v{device.control!.version}</span>
      <Badge tone="neutral" size="sm">baca-saja</Badge>
      {mismatchVersion && <Badge tone="warn" size="sm">versi hub berbeda</Badge>}
      {onClose && <button type="button" onClick={onClose}>Tutup</button>}
    </div>
  );
}
