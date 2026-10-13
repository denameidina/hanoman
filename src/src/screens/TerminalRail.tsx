import React from "react";
import { OverflowActions, StatusPill, type OverflowItem } from "../ds";
import type { TerminalSession } from "../api/client";
import { relativeTime } from "../lib/time-format";
import { railTarget, type RailStatus, type RailTone } from "./terminal-rail";

// Rail sesi (Audit UI/UX 2026-10 · Fase 3E): satu baris per sesi, urutan sudah diputuskan pemanggil
// (`sortRail`). Baris klik = tombol fokus; aksi sekunder ada di menu ⋯ milik baris itu sendiri,
// tak pernah di dalam tombol klik (aturan DenseRow DS).
export type RailItem = {
  session: TerminalSession;
  label: string;
  projectName: string;
  status: RailStatus;
  startedMs: number | null;
};

// Lencana status memakai kosakata StatusPill DS yang sama dengan Cell grid.
export const RAIL_PILL: Record<RailTone, "awaiting" | "running" | "idle" | "failed" | "done"> = {
  attention: "awaiting", running: "running", open: "idle", failed: "failed", done: "done",
};

// Waktu relatif di rail perlu bergeser pelan tanpa me-render ulang seluruh layar.
function useNowTick(periodMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);
  return now;
}

export function SessionRail({ items, focusedId, onFocus, menuFor, label = "Daftar sesi" }: {
  items: readonly RailItem[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  menuFor: (session: TerminalSession) => OverflowItem[];
  label?: string;
}) {
  const now = useNowTick(30_000);
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  // Judul grup hanya bila ada lebih dari satu project; satu project tak butuh pengelompokan.
  const grouped = new Set(items.map((item) => item.session.projectId)).size > 1;
  const focusedIndex = items.findIndex((item) => item.session.id === focusedId);

  // Panah memindahkan fokus DAN memilih, seperti tab. Hanya tombol baris yang ditangani: menu ⋯
  // dan dialognya (yang bisa berada di bawah pohon React yang sama lewat portal) dilewati.
  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const from = buttons.current.indexOf(event.target as HTMLButtonElement);
    if (from < 0) return;
    const next = railTarget(from, event.key, items.length);
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onFocus(item.session.id);
    buttons.current[next]?.focus();
  };

  return (
    <ul role="list" aria-label={label} className="hn-terminal-rail-list" onKeyDown={onKeyDown}>
      {items.map((item, index) => {
        const { session, status } = item;
        const focused = session.id === focusedId;
        // Roving tabindex: satu tombol tabbable (yang terpilih, atau baris pertama bila belum ada).
        const tabbable = focused || (focusedIndex < 0 && index === 0);
        const ago = item.startedMs !== null ? relativeTime(item.startedMs, now) : "";
        return (
          <React.Fragment key={session.id}>
          {grouped && item.session.projectId !== items[index - 1]?.session.projectId && (
            <li role="presentation" className="hn-terminal-rail-group">{item.projectName}</li>
          )}
          <li className="hn-terminal-rail-item">
            <div className={`hn-terminal-rail-row${focused ? " is-focused" : ""}`} data-tone={status.tone}>
              <button type="button" className="hn-terminal-rail-main"
                ref={(el) => { buttons.current[index] = el; }}
                tabIndex={tabbable ? 0 : -1}
                aria-current={focused ? "true" : undefined}
                title={item.label}
                onClick={() => onFocus(session.id)}>
                <span className="hn-terminal-rail-name">{item.label}</span>
                <span className="hn-terminal-rail-meta">
                  <StatusPill status={RAIL_PILL[status.tone]} variant="dot" size="sm">{status.label}</StatusPill>
                  {ago && <span className="hn-terminal-rail-time">{ago}</span>}
                </span>
              </button>
              <OverflowActions label={`Aksi sesi ${session.id} di daftar`} items={menuFor(session)} />
            </div>
          </li>
          </React.Fragment>
        );
      })}
    </ul>
  );
}
