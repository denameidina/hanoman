import React from "react";
import { Icon } from "../ds/icon";
import { usePopoverFocus } from "../ds/popover";
import { useConfirm } from "../ds/useConfirm";
import { useAuth } from "./AuthContext";
import "../screens/styles/auth.css";

// Widget topbar akun — mirror NotificationBell: konsumsi context, klik-luar menutup.
// user null (default context / belum login) → tak merender apa-apa.
export function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const popover = usePopoverFocus(open, () => setOpen(false), "menu");
  // Audit UI/UX 2026-10 · "Keluar" tak lagi langsung memutus sesi login: satu konfirmasi ringan lewat
  // dialog aplikasi (ADR-0127). Tak ada akses ke daftar sesi dari widget ini, jadi tak ada "dampak"
  // yang bisa disebut — pesannya cukup menyatakan konsekuensi yang pasti: harus masuk lagi.
  const { confirm, dialog } = useConfirm();

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!user) return null;
  const initial = user.email.slice(0, 1).toUpperCase();

  async function signOut() {
    setOpen(false);
    if (!await confirm({
      title: "Keluar dari hanoman?",
      message: "Anda perlu masuk lagi untuk membuka dashboard ini.",
      confirmLabel: "Keluar",
      cancelLabel: "Tetap masuk",
      tone: "default",
      icon: "log-out",
    })) return;
    void logout();
  }

  return (
    <div ref={ref} className="hn-account">
      {/* hn-touch-target: pada pointer kasar/mobile trigger dipaksa ≥44×44 (app.css), 34 px hanya di desktop. */}
      <button ref={popover.triggerRef} className="hn-touch-target hn-account-trigger" aria-label="Akun" aria-haspopup="menu"
        aria-controls={open ? popover.panelId : undefined} aria-expanded={open} title={user.email} onClick={() => setOpen((v) => !v)}>
        <span className="hn-account-avatar">{initial}</span>
      </button>
      {open && (
        <div ref={popover.panelRef} id={popover.panelId} role="menu" tabIndex={-1} onKeyDown={popover.onKeyDown}
          className="hn-viewport-popover hn-account-menu">
          <div className="hn-account-who">
            <div className="hn-account-caption">Masuk sebagai</div>
            <div className="hn-account-email">{user.email}</div>
          </div>
          <button role="menuitem" className="hn-account-item" onClick={() => { void signOut(); }}>
            <Icon name="log-out" size={16} color="var(--text-muted)" /> Keluar
          </button>
        </div>
      )}
      {dialog}
    </div>
  );
}
