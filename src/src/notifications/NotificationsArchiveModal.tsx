/* SPEC-523 · arsip notifikasi. Bell adalah BAKI yang didorong WebSocket (50 teratas, live);
   arsip adalah DAFTAR yang ditarik HTTP dan berhalaman. Dua peran, dua permukaan — menaruh
   halaman 2+ di dalam dropdown 320px berarti satu komponen memegang dua sumber data hidup. */
import React from "react";
import type { Notification } from "@hanoman/shared";
import { api } from "../api/client";
// Impor dari ds/kit LANGSUNG, bukan dari barrel ../ds: barrel mengekspor shell.tsx yang
// mengimpor NotificationBell, dan itu menutup siklus impor.
import { Modal, Pager, serverPage } from "../ds/kit";
import { Icon } from "../ds/icon";

const PAGE = 20;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "baru saja";
  const m = Math.round(s / 60); if (m < 60) return `${m}m lalu`;
  const h = Math.round(m / 60); if (h < 24) return `${h}j lalu`;
  return `${Math.round(h / 24)}h lalu`;
}

export function NotificationsArchiveModal({ onClose, onOpen }:
  { onClose: () => void; onOpen?: (n: Notification) => void }) {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api.listNotifications({ page, limit: PAGE })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); } })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page]);

  const sp = serverPage(total, page, PAGE);
  const blank = { padding: "18px 10px", textAlign: "center" as const, color: "var(--text-subtle)", fontSize: 13 };

  return (
    <Modal open title="Semua notifikasi" icon="bell" onClose={onClose} width={720}>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: "60vh", overflowY: "auto" }}>
        {loading && items.length === 0 ? <div style={blank}>memuat…</div>
          : items.length === 0 ? <div style={blank}>Belum ada notifikasi</div>
            : items.map((n) => (
              <div key={n.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 8px",
                borderBottom: "1px solid var(--border-hair)",
              }}>
                <Icon name="bell" size={14} color="var(--text-subtle)" />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-strong)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {n.specId ? `${n.specId} · ${n.title}` : n.title}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>
                  {timeAgo(n.createdAt)}
                </span>
                {onOpen && (
                  <button onClick={() => { onOpen(n); onClose(); }} style={{
                    border: "none", background: "transparent", cursor: "pointer",
                    color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-ui)",
                  }}>Buka</button>
                )}
              </div>
            ))}
      </div>
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
        onPage={setPage} unit="notifikasi" />
    </Modal>
  );
}
