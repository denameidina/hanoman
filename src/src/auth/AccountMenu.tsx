import React from "react";
import { Icon } from "../ds/icon";
import { usePopoverFocus } from "../ds/popover";
import { useAuth } from "./AuthContext";

// Widget topbar akun — mirror NotificationBell: konsumsi context, klik-luar menutup.
// user null (default context / belum login) → tak merender apa-apa.
export function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const popover = usePopoverFocus(open, () => setOpen(false), "menu");

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!user) return null;
  const initial = user.email.slice(0, 1).toUpperCase();

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button ref={popover.triggerRef} aria-label="Akun" aria-haspopup="menu" aria-controls={popover.panelId} aria-expanded={open} title={user.email} onClick={() => setOpen((v) => !v)} style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
        border: "none", background: open ? "var(--bone-200)" : "transparent",
        borderRadius: "var(--radius-sm)", cursor: "pointer",
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
          borderRadius: "50%", background: "var(--brass-100)", color: "var(--brass-700)",
          fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, lineHeight: 1,
        }}>{initial}</span>
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="menu" tabIndex={-1} onKeyDown={popover.onKeyDown} className="hn-viewport-popover" style={{
          position: "absolute", top: 40, right: 0, width: 220, background: "var(--surface-card)",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-xl)", zIndex: 200, padding: 6,
        }}>
          <div style={{ padding: "8px 10px 6px" }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-subtle)", marginBottom: 3 }}>
              Masuk sebagai
            </div>
            <div style={{ fontSize: 13, color: "var(--text-strong)", wordBreak: "break-all" }}>{user.email}</div>
          </div>
          <button role="menuitem" onClick={() => { setOpen(false); void logout(); }} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 4, padding: "9px 10px",
            border: "none", borderTop: "1px solid var(--border-hair)", background: "transparent",
            cursor: "pointer", color: "var(--text-body)", fontSize: 13, fontFamily: "var(--font-ui)", textAlign: "left",
          }}>
            <Icon name="log-out" size={16} color="var(--text-muted)" /> Keluar
          </button>
        </div>
      )}
    </div>
  );
}
