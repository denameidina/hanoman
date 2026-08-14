// Ported verbatim from _ds_bundle.js (surfaces/Card). ESM + typed props. No visual change.
import React from "react";
const _extends = Object.assign;

/* `fill`: kartu ikut rantai flex layar dan menyerap sisa tinggi, dan area anaknya jadi
   kolom flex — dipakai kartu yang membungkus header + daftar bergulir + Pager, supaya
   daftarnya yang menyusut, bukan Pager-nya yang terdorong ke luar layar. Tanpa `fill`,
   Card berperilaku persis seperti sebelumnya (anak = blok biasa). */
type CardProps = { children?: React.ReactNode; title?: React.ReactNode; eyebrow?: React.ReactNode;
  actions?: React.ReactNode; footer?: React.ReactNode; elevation?: "flat" | "raised" | "float";
  interactive?: boolean; padding?: number; fill?: boolean; style?: React.CSSProperties } & Record<string, any>;
export function Card({ children, title, eyebrow, actions, footer, elevation = "raised", interactive = false,
  padding = 20, fill = false, className = "", style = {}, ...rest }: CardProps) {
  const [hover, setHover] = React.useState(false);
  const shadow = ({ flat: "none", raised: "var(--shadow-sm)", float: "var(--shadow-md)" } as Record<string, string>)[elevation] || "var(--shadow-sm)";
  const hasHeader = title || eyebrow || actions;
  return React.createElement("div", _extends({
    className, onMouseEnter: () => interactive && setHover(true), onMouseLeave: () => interactive && setHover(false),
    style: { background: "var(--surface-card)", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)",
      boxShadow: interactive && hover ? "var(--shadow-md)" : shadow,
      transform: interactive && hover ? "translateY(-1px)" : "none", transition: "var(--transition-base)",
      cursor: interactive ? "pointer" : "default", overflow: "hidden",
      ...(fill ? { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } : null), ...style },
  }, rest),
    hasHeader && React.createElement("div", { className: "hn-card-header",
      style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
        padding: `${padding}px ${padding}px ${title && children ? 0 : padding}px` },
    },
      React.createElement("div", { style: { minWidth: 0 } },
        eyebrow && React.createElement("div", { className: "hn-eyebrow",
          style: { fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", fontWeight: "var(--weight-medium)",
            letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 } }, eyebrow),
        title && React.createElement("div", { style: { fontFamily: "var(--font-display)", fontSize: "var(--text-xl)",
          fontWeight: "var(--weight-semibold)", letterSpacing: "var(--tracking-tight)", color: "var(--text-strong)", lineHeight: 1.2 } }, title)),
      actions && React.createElement("div", { className: "hn-card-actions", style: { flex: "0 0 auto" } }, actions)),
    children && React.createElement("div", { style: { padding: hasHeader ? `12px ${padding}px ${padding}px` : padding,
      ...(fill ? { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } : null) } }, children),
    footer && React.createElement("div", { style: { padding: `12px ${padding}px`, borderTop: "1px solid var(--border-hair)",
      background: "var(--bone-100)" } }, footer));
}
