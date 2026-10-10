import React from "react";
import { Icon } from "../ds/icon";
import { useNotifications } from "./NotificationsContext";
import { NotificationsArchiveModal } from "./NotificationsArchiveModal";
import { usePopoverFocus } from "../ds/popover";

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "baru saja";
  const m = Math.round(s / 60); if (m < 60) return `${m}m lalu`;
  const h = Math.round(m / 60); if (h < 24) return `${h}j lalu`;
  return `${Math.round(h / 24)}h lalu`;
}

export function NotificationBell() {
  const { items, unread, total, markAllRead, clear, onOpen } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const [archive, setArchive] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const popover = usePopoverFocus(open, () => setOpen(false), "menu");

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead(); // membuka = melihat
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button ref={popover.triggerRef} aria-label="Notifikasi" aria-haspopup="menu" aria-controls={popover.panelId} aria-expanded={open} onClick={toggle} style={{
        position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 34, height: 34, border: "none", background: open ? "var(--bone-200)" : "transparent",
        borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-muted)",
      }}>
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span style={{
            position: "absolute", top: 4, right: 4, minWidth: 16, height: 16, padding: "0 4px",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: "var(--clay-500)", color: "#fff", fontSize: 10, fontWeight: 700,
            borderRadius: "var(--radius-pill)", fontFamily: "var(--font-mono)", lineHeight: 1,
          }}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="menu" tabIndex={-1} onKeyDown={popover.onKeyDown} className="hn-viewport-popover" style={{
          position: "absolute", top: 40, right: 0, width: 320, maxHeight: 420, overflowY: "auto",
          background: "var(--surface-card)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", zIndex: 200, padding: 6,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px 6px" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>Notifikasi</span>
            {items.length > 0 && (
              <button role="menuitem" onClick={clear} style={{ border: "none", background: "transparent", cursor: "pointer",
                color: "var(--text-subtle)", fontSize: 12, fontFamily: "var(--font-ui)" }}>Bersihkan</button>
            )}
          </div>
          {items.length === 0 ? (
            <div style={{ padding: "18px 10px", textAlign: "center", color: "var(--text-subtle)", fontSize: 13 }}>
              Belum ada notifikasi
            </div>
          ) : items.map((n) => {
            const decision = n.type === "decision";
            const ticket = n.type === "ticket";
            // SPEC-253 · +ticket (keluhan Help Center). icon/warna/label per tipe.
            const icon = ticket ? "inbox" : decision ? "git-merge" : "check-circle-2";
            const accent = ticket ? "var(--brass-500)" : decision ? "var(--amber-600)" : "var(--leaf-500)";
            const label = ticket ? "keluhan baru" : decision ? "butuh keputusan" : "selesai";
            const openLabel = decision ? "Buka terminal" : ticket ? "Lihat triase" : "Buka";
            return (
            <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
              borderRadius: "var(--radius-sm)" }}>
              <Icon name={icon} size={16} color={accent} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "var(--text-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ticket ? n.title : `${n.specId ?? n.sessionId} · ${n.title}`}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>
                  {label} · {timeAgo(n.createdAt)}
                </div>
              </div>
              {onOpen && (
                <button role="menuitem" onClick={() => { onOpen(n); setOpen(false); }} style={{
                  flex: "0 0 auto", border: "none", background: "transparent", cursor: "pointer",
                  color: ticket ? "var(--brass-600)" : decision ? "var(--amber-600)" : "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-ui)", whiteSpace: "nowrap" }}>
                  {openLabel}
                </button>
              )}
              {!n.readAt && <span style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} />}
            </div>
            );
          })}
          {items.length > 0 && (
            <div style={{ display: "flex", marginTop: 4, borderTop: "1px solid var(--border-hair)" }}>
              <button role="menuitem" onClick={markAllRead} style={{ flex: 1, padding: "8px", border: "none",
                background: "transparent", cursor: "pointer",
                color: "var(--text-muted)", fontSize: 12.5, fontFamily: "var(--font-ui)" }}>Tandai semua dibaca</button>
              {/* SPEC-523 · bell menampilkan 50 teratas. Tanpa angka ini, 50 terbaca sebagai
                  "semuanya" — persis salah baca yang melahirkan backlog ini. */}
              <button role="menuitem" onClick={() => { setArchive(true); setOpen(false); }} style={{ flex: 1, padding: "8px", border: "none",
                borderLeft: "1px solid var(--border-hair)", background: "transparent", cursor: "pointer",
                color: "var(--brass-600)", fontSize: 12.5, fontFamily: "var(--font-ui)" }}>
                Lihat semua{total > items.length ? ` (${total})` : ""}
              </button>
            </div>
          )}
        </div>
      )}
      {archive && <NotificationsArchiveModal onClose={() => setArchive(false)} onOpen={onOpen} />}
    </div>
  );
}
