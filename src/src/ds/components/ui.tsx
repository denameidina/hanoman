// Navigasi dan menu aksi: Tabs (+ TabPanel opsional) dan OverflowActions.
import React from "react";
import { Icon } from "../icon";
import { Modal } from "../kit";
import { IconButton } from "./forms";
const _extends = Object.assign;

type Tab = string | { value: string; label?: React.ReactNode; icon?: string; count?: number };

// Id DOM untuk pasangan tab ↔ panel. Nilai tab bebas (bisa berspasi), jadi disanitasi.
const domId = (base: string, kind: "tab" | "panel", value: string) =>
  `${base}-${kind}-${value.replace(/[^A-Za-z0-9_-]/g, "_")}`;

type TabsContextValue = { baseId: string; active: string };
const TabsContext = React.createContext<TabsContextValue | null>(null);

type TabPanelProps = { value: string; children?: React.ReactNode; className?: string; style?: React.CSSProperties };
// Panel tab. Diletakkan sebagai anak langsung `<Tabs>`. Panel yang tak aktif tetap di DOM dengan
// `hidden` (bukan dilepas), supaya state di dalamnya tak hilang saat pindah tab dan `aria-controls`
// selalu menunjuk ke elemen yang ada.
export function TabPanel({ value, children, className = "", style }: TabPanelProps) {
  const ctx = React.useContext(TabsContext);
  const active = !ctx || ctx.active === value;
  return React.createElement("div", {
    role: "tabpanel",
    id: ctx ? domId(ctx.baseId, "panel", value) : undefined,
    "aria-labelledby": ctx ? domId(ctx.baseId, "tab", value) : undefined,
    hidden: !active,
    className: `hn-tabpanel ${className}`.trim(),
    style,
  }, children);
}

type TabsProps = { tabs?: Tab[]; value?: string; defaultValue?: string; onChange?: (v: string) => void;
  variant?: "underline" | "pill"; style?: React.CSSProperties; children?: React.ReactNode } & Record<string, any>;
export function Tabs({ tabs = [], value, defaultValue, onChange, variant = "underline", className = "", style = {}, children, ...rest }: TabsProps) {
  const norm = tabs.map((t) => (typeof t === "string" ? { value: t, label: t } : t)) as { value: string; label?: React.ReactNode; icon?: string; count?: number }[];
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? (norm[0] && norm[0].value));
  const active = isControlled ? value : inner;
  const baseId = React.useId();
  // Hanya tab yang punya TabPanel sungguhan yang diberi `aria-controls`; selebihnya akan menunjuk ke id yang tak ada.
  const panelValues = new Set(React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<{ value?: string }>(child) && child.type === TabPanel && child.props.value !== undefined
      ? [child.props.value] : []));
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
  const tablist = React.createElement("div", _extends({
    className: `hn-tabs ${className}`.trim(), role: "tablist",
    style: { display: "inline-flex", gap: pill ? 4 : 0, padding: pill ? 4 : 0,
      background: pill ? "var(--bone-200)" : "transparent", borderRadius: pill ? "var(--radius-md)" : 0,
      borderBottom: pill ? "none" : "1px solid var(--border-hair)", ...style },
  }, rest), norm.map((t, index) => {
    const on = t.value === active;
    return React.createElement("button", {
      key: t.value, id: domId(baseId, "tab", t.value), role: "tab", "aria-selected": on, tabIndex: on ? 0 : -1,
      "aria-controls": panelValues.has(t.value) ? domId(baseId, "panel", t.value) : undefined,
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
      // Teks di atas tint brass-100 memakai brass-700 (5,45:1); brass-600 hanya 3,96:1 dan tak lolos AA.
      t.count != null && React.createElement("span", {
        style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)",
          color: on ? "var(--brass-700)" : "var(--text-subtle)", background: on ? "var(--brass-100)" : "var(--bone-300)",
          borderRadius: "var(--radius-pill)", padding: "1px 6px" } }, t.count));
  }));
  if (children === undefined || children === null) return tablist;
  return React.createElement(TabsContext.Provider, { value: { baseId, active: active ?? "" } }, tablist, children);
}

export type OverflowItem = {
  key: string; label: string; icon?: string;
  onSelect: () => void; disabled?: boolean; title?: string;
  /** `danger` untuk aksi merusak (hapus, reset). Tetap berupa tombol biasa; hanya warnanya yang berubah. */
  tone?: "default" | "danger";
};

// SPEC-800 · ember untuk aksi yang tidak muat. Panelnya `Modal` DS — bukan popover terposisi —
// karena Modal sudah membawa focus trap, Escape, restorasi fokus, dan bentuk bottom-sheet mobile
// (app.css `.hn-modal-overlay { align-items: flex-end }`) tanpa satu pun hitungan tepi viewport.
// Audit 2026-10 · panel tetap `dialog` (bukan `role=menu`): pemakai dan test-nya mencari item sebagai
// `button` di dalam dialog; mengganti role memutus ~11 berkas test sekaligus. Lihat design-system.md.
export function OverflowActions({ label, title, items, icon = "more-horizontal", size = "sm", children }: {
  /** Nama aksesibel pemicu (wajib; juga nama dialog bila `title` tak diisi). */
  label: string;
  /** Judul di dalam dialog. Default: `label`. */
  title?: string;
  items: readonly OverflowItem[]; icon?: string;
  size?: "sm" | "md" | "lg"; children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  if (!items.length && !children) return null;
  return (
    <>
      <IconButton size={size} icon={icon} label={label} aria-haspopup="dialog"
        aria-expanded={open} onClick={() => setOpen(true)} />
      {open && (
        <Modal open title={title ?? label} icon={icon} width={420} onClose={() => setOpen(false)}>
          {children}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((item) => {
              const danger = item.tone === "danger";
              return (
                <button key={item.key} type="button" disabled={item.disabled} title={item.title}
                  onClick={() => { setOpen(false); item.onSelect(); }}
                  className={`hn-overflow-item${danger ? " hn-overflow-item-danger" : ""}`}>
                  {item.icon && <Icon name={item.icon} size={15} />}
                  {item.label}
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
