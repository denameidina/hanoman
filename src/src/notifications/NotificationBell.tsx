import React from "react";
import { Icon } from "../ds/icon";
import { useNotifications } from "./NotificationsContext";
import { NotificationsArchiveModal } from "./NotificationsArchiveModal";
import { usePopoverFocus } from "../ds/popover";
import { relativeTime } from "../lib/time-format";
import "./notifications.css";

export function NotificationBell() {
  const { items, unread, total, markAllRead, markRead, clear, onOpen } = useNotifications();
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

  // Audit UI/UX 2026-10 · membuka bell TIDAK menandai apa pun terbaca: itu membuat notifikasi yang
  // belum dilihat diam-diam hilang dari badge. Tandai terbaca lewat "Tandai semua dibaca" atau, per
  // item, lewat "Jawab"/"Buka" (ADR-0204): item yang dibuka memang sudah dilihat operator.
  function toggle() {
    setOpen((v) => !v);
  }

  return (
    <div ref={ref} className="hn-notif-anchor">
      <button ref={popover.triggerRef} aria-label="Notifikasi" aria-haspopup="menu" aria-controls={popover.panelId} aria-expanded={open} onClick={toggle}
        className={open ? "hn-notif-trigger is-open" : "hn-notif-trigger"}>
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="hn-notif-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="menu" tabIndex={-1} onKeyDown={popover.onKeyDown}
          className="hn-viewport-popover hn-notif-popover">
          <div className="hn-notif-head">
            <span className="hn-notif-title">Notifikasi</span>
            {items.length > 0 && (
              <button role="menuitem" onClick={clear} className="hn-notif-clear">Bersihkan</button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="hn-notif-empty">
              Belum ada notifikasi
            </div>
          ) : items.map((n) => {
            const decision = n.type === "decision";
            const ticket = n.type === "ticket";
            // SPEC-253 · +ticket (keluhan Help Center). icon/warna/label per tipe.
            const icon = ticket ? "inbox" : decision ? "git-merge" : "check-circle-2";
            const accent = ticket ? "var(--brass-500)" : decision ? "var(--amber-600)" : "var(--leaf-500)";
            const label = ticket ? "keluhan baru" : decision ? "butuh keputusan" : "selesai";
            // Keputusan: "Jawab" adalah aksi primer (Terminal terfokus ke sesinya). Lainnya tetap "Buka"/"Lihat triase".
            const openLabel = decision ? "Jawab" : ticket ? "Lihat triase" : "Buka";
            const openClass = decision ? "hn-notif-open hn-notif-open--primary"
              : ticket ? "hn-notif-open hn-notif-open--ticket" : "hn-notif-open";
            return (
            <div key={n.id} className="hn-notif-item">
              <Icon name={icon} size={16} color={accent} />
              <div className="hn-notif-text">
                <div className="hn-notif-item-title">
                  {ticket ? n.title : `${n.specId ?? n.sessionId} · ${n.title}`}
                </div>
                <div className="hn-notif-item-meta">
                  {label} · {relativeTime(n.createdAt) || "—"}
                </div>
              </div>
              {onOpen && (
                <button role="menuitem" onClick={() => { markRead(n.id); onOpen(n); setOpen(false); }} className={openClass}>
                  {openLabel}
                </button>
              )}
              {!n.readAt && <span className="hn-notif-dot" />}
            </div>
            );
          })}
          {items.length > 0 && (
            <div className="hn-notif-foot">
              <button role="menuitem" onClick={markAllRead} className="hn-notif-foot-btn">Tandai semua dibaca</button>
              {/* SPEC-523 · bell menampilkan 50 teratas. Tanpa angka ini, 50 terbaca sebagai
                  "semuanya" — persis salah baca yang melahirkan backlog ini. */}
              <button role="menuitem" onClick={() => { setArchive(true); setOpen(false); }}
                className="hn-notif-foot-btn hn-notif-foot-btn--archive">
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
