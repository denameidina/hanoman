/* SPEC-523 · arsip notifikasi. Bell adalah BAKI yang didorong WebSocket (50 teratas, live);
   arsip adalah DAFTAR yang ditarik HTTP dan berhalaman. Dua peran, dua permukaan — menaruh
   halaman 2+ di dalam dropdown 320px berarti satu komponen memegang dua sumber data hidup. */
import React from "react";
import type { Notification } from "@hanoman/shared";
import { api } from "../api/client";
import { useNotifications } from "./NotificationsContext";
// Impor dari ds/kit LANGSUNG, bukan dari barrel ../ds: barrel mengekspor shell.tsx yang
// mengimpor NotificationBell, dan itu menutup siklus impor.
import { Modal, Pager, serverPage } from "../ds/kit";
import { Icon } from "../ds/icon";
import { relativeTime } from "../lib/time-format";
import "./notifications.css";

const PAGE = 20;

export function NotificationsArchiveModal({ onClose, onOpen }:
  { onClose: () => void; onOpen?: (n: Notification) => void }) {
  // ADR-0204 · "Buka"/"Jawab" di arsip juga menandai item itu terbaca (lihat NotificationsContext.markRead).
  const { markRead } = useNotifications();
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

  return (
    <Modal open title="Semua notifikasi" icon="bell" onClose={onClose} width={720}>
      <div className="hn-notif-archive-list">
        {loading && items.length === 0 ? <div className="hn-notif-empty">memuat…</div>
          : items.length === 0 ? <div className="hn-notif-empty">Belum ada notifikasi</div>
            : items.map((n) => {
              const decision = n.type === "decision";
              return (
              <div key={n.id} className="hn-notif-archive-row">
                <Icon name="bell" size={14} color="var(--text-subtle)" />
                <span className="hn-notif-archive-title">
                  {n.specId ? `${n.specId} · ${n.title}` : n.title}
                </span>
                <span className="hn-notif-archive-time">{relativeTime(n.createdAt) || "—"}</span>
                {onOpen && (
                  <button onClick={() => { markRead(n.id); onOpen(n); onClose(); }}
                    className={decision ? "hn-notif-open hn-notif-open--primary" : "hn-notif-open"}>
                    {decision ? "Jawab" : "Buka"}
                  </button>
                )}
              </div>
              );
            })}
      </div>
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
        onPage={setPage} unit="notifikasi" />
    </Modal>
  );
}
