// Ported verbatim from _ds_bundle.js (navigation/Tabs). ESM + typed props. No visual change.
import React from "react";
import { Icon } from "../icon";
import { Modal } from "../kit";
import { IconButton } from "./forms";
const _extends = Object.assign;

type Tab = string | { value: string; label?: React.ReactNode; icon?: string; count?: number };
type TabsProps = { tabs?: Tab[]; value?: string; defaultValue?: string; onChange?: (v: string) => void;
  variant?: "underline" | "pill"; style?: React.CSSProperties } & Record<string, any>;
export function Tabs({ tabs = [], value, defaultValue, onChange, variant = "underline", className = "", style = {}, ...rest }: TabsProps) {
  const norm = tabs.map((t) => (typeof t === "string" ? { value: t, label: t } : t)) as { value: string; label?: React.ReactNode; icon?: string; count?: number }[];
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? (norm[0] && norm[0].value));
  const active = isControlled ? value : inner;
  const select = (v: string) => { if (!isControlled) setInner(v); onChange && onChange(v); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % norm.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + norm.length) % norm.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = norm.length - 1;
    else return;
    event.preventDefault();
    const tab = norm[next];
    if (!tab) return;
    select(tab.value);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  const pill = variant === "pill";
  return React.createElement("div", _extends({
    className: `hn-tabs ${className}`.trim(), role: "tablist",
    style: { display: "inline-flex", gap: pill ? 4 : 0, padding: pill ? 4 : 0,
      background: pill ? "var(--bone-200)" : "transparent", borderRadius: pill ? "var(--radius-md)" : 0,
      borderBottom: pill ? "none" : "1px solid var(--border-hair)", ...style },
  }, rest), norm.map((t, index) => {
    const on = t.value === active;
    return React.createElement("button", {
      key: t.value, role: "tab", "aria-selected": on, tabIndex: on ? 0 : -1,
      onClick: () => select(t.value), onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, index),
      // SPEC-763 · `.hn-tabs` sudah `overflow-x: auto`, tapi tanpa `flex: 0 0 auto` tab menyusut
      // sampai `min-width` target sentuh (44px) dan label `nowrap`-nya TUMPAH ke tab tetangga alih-alih
      // memicu scroll — terukur di 390px: strip Backlog tumpah 67px total, "Semua spec" menimpa
      // "Dari brief". Dengan flex-shrink mati: tumpahan 0px, strip menggulir (konten 499 > kotak 362).
      style: { flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6, padding: pill ? "6px 12px" : "9px 14px",
        marginBottom: pill ? 0 : -1, border: "none", background: pill && on ? "var(--surface-card)" : "transparent",
        boxShadow: pill && on ? "var(--shadow-xs)" : "none", borderRadius: pill ? "var(--radius-sm)" : 0,
        borderBottom: pill ? "none" : `2px solid ${on ? "var(--accent)" : "transparent"}`,
        color: on ? "var(--text-strong)" : "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-md)",
        fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)", cursor: "pointer",
        transition: "var(--transition-fast)", whiteSpace: "nowrap" },
    },
      t.icon && React.createElement(Icon, { name: t.icon, size: 15 }),
      t.label,
      t.count != null && React.createElement("span", {
        style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)",
          color: on ? "var(--accent-hover)" : "var(--text-subtle)", background: on ? "var(--brass-100)" : "var(--bone-300)",
          borderRadius: "var(--radius-pill)", padding: "1px 6px" } }, t.count));
  }));
}

export type OverflowItem = {
  key: string; label: string; icon?: string;
  onSelect: () => void; disabled?: boolean; title?: string;
};

// SPEC-800 · ember untuk aksi yang tidak muat. Panelnya `Modal` DS — bukan popover terposisi —
// karena Modal sudah membawa focus trap, Escape, restorasi fokus, dan bentuk bottom-sheet mobile
// (app.css `.hn-modal-overlay { align-items: flex-end }`) tanpa satu pun hitungan tepi viewport.
export function OverflowActions({ label, items, icon = "more-horizontal", size = "sm", children }: {
  label: string; items: readonly OverflowItem[]; icon?: string;
  size?: "sm" | "md" | "lg"; children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  if (!items.length && !children) return null;
  return (
    <>
      <IconButton size={size} icon={icon} label={label} aria-haspopup="dialog"
        aria-expanded={open} onClick={() => setOpen(true)} />
      {open && (
        <Modal open title={label} icon={icon} width={420} onClose={() => setOpen(false)}>
          {children}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((item) => (
              <button key={item.key} type="button" disabled={item.disabled} title={item.title}
                onClick={() => { setOpen(false); item.onSelect(); }}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%",
                  minHeight: "var(--touch-target)", padding: "8px 10px", textAlign: "left",
                  border: "none", borderRadius: "var(--radius-sm)", background: "transparent",
                  color: item.disabled ? "var(--text-subtle)" : "var(--text-body)",
                  font: "var(--weight-medium) var(--text-md)/1.3 var(--font-ui)",
                  cursor: item.disabled ? "not-allowed" : "pointer",
                  opacity: item.disabled ? 0.5 : 1 }}>
                {item.icon && <Icon name={item.icon} size={15} />}
                {item.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
