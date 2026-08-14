// Ported verbatim from _ds_bundle.js (navigation/Tabs). ESM + typed props. No visual change.
import React from "react";
import { Icon } from "../icon";
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
      style: { display: "inline-flex", alignItems: "center", gap: 6, padding: pill ? "6px 12px" : "9px 14px",
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
