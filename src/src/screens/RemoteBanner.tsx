/* RemoteBanner (SPEC-1218 · ADR-0165 §11) — bar identitas di atas RemoteInstanceView: perangkat mana
   yang sedang dilihat, penanda baca-saja, dan peringatan bila versi server pusat ≠ versi perangkat.

   Audit UI/UX 2026-10 · Fase 3G: bar brass solid yang menempel (sticky) di atas saat mirror terbuka,
   karena ia satu-satunya tanda bahwa layar di bawahnya milik perangkat LAIN. Tombol "Keluar" memakai
   Button DS dengan `hn-touch-target` (≥44px pada pointer kasar). */
import { Button } from "../ds";
import type { PresenceDeviceView } from "@hanoman/shared";

export function RemoteBanner({ device, hubVersion, onClose }:
  { device: PresenceDeviceView; hubVersion: string; onClose?: () => void }) {
  const version = device.control!.version;
  const mismatchVersion = version !== hubVersion;
  return (
    <div role="status" data-testid="remote-banner" className="kl-banner">
      <span className="kl-banner-text">
        <b>{device.name}</b> · Baca-saja · v{version} · {device.online ? "online" : "offline"}
        {mismatchVersion && " · versi server pusat berbeda"}
      </span>
      {onClose && (
        <Button size="sm" variant="secondary" className="hn-touch-target" onClick={onClose}>Keluar</Button>
      )}
    </div>
  );
}
