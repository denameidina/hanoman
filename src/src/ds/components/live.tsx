import React from "react";
import { Badge } from "./feedback";
import { useEventsStatus } from "../../api/live";

// SPEC-897 · grace yang menelan tiga percobaan reconnect (backoff 0,5 → 1 → 2 dtk) supaya satu
// blip jaringan tak melahirkan lencana yang berkedip.
const OFFLINE_MS = 6_000;

/**
 * SPEC-908 · "terputus adalah kondisi, bukan ketiadaan kondisi". Dibangun di atas `eventsStatus`
 * yang sudah ada — tanpa channel, endpoint, atau poll baru (ADR-0039).
 *
 * `paused` (tab tersembunyi; socket ditutup ATAS PERMINTAAN KITA, api/events.ts) bukan gangguan
 * dan tak pernah menampilkan apa pun: menyebutnya gangguan berarti tiap kembali dari tab lain
 * memunculkan peringatan palsu.
 */
export function LiveConnectionBadge({ className = "", style = {} }:
  { className?: string; style?: React.CSSProperties }) {
  const s = useEventsStatus();
  const down = !s.connected && !s.paused;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!down) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [down, s.since]);
  if (!down || now - s.since < OFFLINE_MS) return null;
  return (
    <Badge tone="warn" variant="soft" icon="wifi-off" className={className} style={style}>
      koneksi terputus · menyambung ulang…
    </Badge>
  );
}
