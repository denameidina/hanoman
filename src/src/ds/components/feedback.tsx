// Primitif umpan balik: Badge, Callout, ProgressBar, StatusPill, Tooltip.
// Warna TEKS memakai token teks yang lolos 4,5:1 (lihat design-system.md, "Primitif layout").
// Token fill (--amber-600, --brass-600, --clay-600 …) hanya untuk titik, batas, dan isian progres.
import React from "react";
import { Icon } from "../icon";
import "./feedback.css";
const _extends = Object.assign;

type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";

// Titik status: dekoratif. Maknanya selalu ikut sebagai teks di sebelahnya (`aria-hidden`).
function StatusDot({ color, size, pulse = false }: { color: string; size: number; pulse?: boolean }) {
  return React.createElement("span", {
    "aria-hidden": "true",
    className: pulse ? "hn-status-dot hn-status-dot-pulse" : "hn-status-dot",
    style: { width: size, height: size, borderRadius: "50%", background: color, flex: "0 0 auto" },
  });
}

type BadgeVariant = "soft" | "solid" | "outline" | "dot";
type BadgeProps = { children?: React.ReactNode; tone?: Tone; icon?: string; variant?: BadgeVariant;
  size?: "sm" | "md"; style?: React.CSSProperties } & Record<string, any>;

// `text` = warna teks (lolos 4,5:1 di atas `bg`); `dot` = fill titik (boleh di bawah 4,5:1, tak pernah teks).
const BADGE_TONES: Record<Tone, { bg: string; text: string; dot: string; bd: string }> = {
  neutral: { bg: "var(--bone-200)", text: "var(--ink-600)", dot: "var(--ink-500)", bd: "var(--bone-400)" },
  brass: { bg: "var(--brass-100)", text: "var(--brass-700)", dot: "var(--brass-500)", bd: "var(--brass-300)" },
  info: { bg: "var(--wind-100)", text: "var(--wind-700)", dot: "var(--wind-600)", bd: "var(--wind-500)" },
  ok: { bg: "var(--status-ok-tint)", text: "var(--leaf-600)", dot: "var(--leaf-600)", bd: "var(--leaf-500)" },
  warn: { bg: "var(--status-warn-tint)", text: "var(--status-warn)", dot: "var(--amber-600)", bd: "var(--amber-500)" },
  err: { bg: "var(--status-err-tint)", text: "var(--clay-600)", dot: "var(--clay-600)", bd: "var(--clay-500)" },
};

export function Badge({ children, tone = "neutral", icon, variant = "soft", size = "md", className = "", style = {}, ...rest }: BadgeProps) {
  const t = BADGE_TONES[tone] || BADGE_TONES.neutral!;
  const sm = size === "sm";
  const solid = variant === "solid";
  const outline = variant === "outline";
  const dot = variant === "dot";
  const base: React.CSSProperties = dot
    ? { display: "inline-flex", alignItems: "center", gap: sm ? 5 : 6, fontFamily: "var(--font-ui)",
      fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)", fontWeight: "var(--weight-medium)", lineHeight: 1,
      color: t.text, whiteSpace: "nowrap" }
    : { display: "inline-flex", alignItems: "center", gap: sm ? 4 : 5, height: sm ? 18 : 22,
      padding: sm ? "0 7px" : "0 9px", borderRadius: "var(--radius-pill)", fontFamily: "var(--font-ui)",
      fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)", fontWeight: "var(--weight-medium)", lineHeight: 1,
      letterSpacing: "0.01em", background: solid ? t.text : outline ? "transparent" : t.bg,
      color: solid ? "var(--bone-000)" : t.text,
      border: `1px solid ${outline ? t.bd : solid ? t.text : "transparent"}`, whiteSpace: "nowrap" };
  return React.createElement("span", _extends({ className, style: { ...base, ...style } }, rest),
    dot && React.createElement(StatusDot, { color: t.dot, size: sm ? 6 : 7 }),
    icon && !dot && React.createElement(Icon, { name: icon, size: sm ? 11 : 13 }),
    children);
}

// `danger` = nama kanonik lintas DS (Button, ConfirmDialog, Field) untuk `err`: warna sama, role sama.
type CalloutTone = "info" | "ok" | "warn" | "err" | "danger" | "brass";
type CalloutProps = { children?: React.ReactNode; tone?: CalloutTone;
  title?: React.ReactNode; icon?: string; action?: React.ReactNode; role?: string;
  style?: React.CSSProperties } & Record<string, any>;
// `role` mengikuti keparahan: err/danger = alert (diumumkan segera), warn/ok = status (sopan), info/brass = note.
// Pemanggil boleh menimpa lewat prop `role`. Warna tiap tone ada di feedback.css (`data-tone`).
const CALLOUT_TONES: Record<CalloutTone, { icon: string; role: string }> = {
  info: { icon: "info", role: "note" },
  ok: { icon: "check-circle-2", role: "status" },
  warn: { icon: "alert-triangle", role: "status" },
  err: { icon: "octagon-alert", role: "alert" },
  danger: { icon: "octagon-alert", role: "alert" },
  brass: { icon: "sparkles", role: "note" },
};
export function Callout({ children, tone = "info", title, icon, action, role, className = "", style = {}, ...rest }: CalloutProps) {
  const key: CalloutTone = CALLOUT_TONES[tone] ? tone : "info";
  const t = CALLOUT_TONES[key]!;
  return React.createElement("div", _extends({
    className: `hn-callout ${className}`.trim(), "data-tone": key, role: role ?? t.role,
    style: { display: "flex", gap: 12, padding: "14px 16px", borderRadius: "var(--radius-md)", ...style },
  }, rest),
    React.createElement(Icon, { name: icon || t.icon, size: 19, style: { marginTop: 1 } }),
    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      title && React.createElement("div", { style: { fontFamily: "var(--font-ui)", fontSize: "var(--text-md)",
        fontWeight: "var(--weight-semibold)", color: "var(--text-strong)", marginBottom: children ? 3 : 0 } }, title),
      children && React.createElement("div", { style: { fontSize: "var(--text-sm)", lineHeight: "var(--leading-normal)",
        color: "var(--text-body)" } }, children),
      action && React.createElement("div", { style: { marginTop: 10 } }, action)));
}

// `danger` = nama kanonik untuk `err` (token --status-err); keduanya isian yang sama.
type ProgressProps = { value?: number; max?: number; tone?: "brass" | "ok" | "warn" | "err" | "danger" | "info";
  size?: "sm" | "md" | "lg";
  /** Persen terlihat di atas bar. Persen itu TAK memberi nama: pasang `aria-label`, `aria-labelledby`
   *  (diteruskan ke track), atau `label` string. Tanpa salah satunya track tak bernama (axe). */
  showLabel?: boolean;
  /** Keterangan yang terlihat di atas bar. Bila string dan tanpa `aria-label`, ia juga nama aksesibelnya. */
  label?: React.ReactNode;
  /** Teks nilai untuk pembaca layar (`aria-valuetext`), mis. "3 dari 8 tahap". */
  valueText?: string;
  style?: React.CSSProperties } & Record<string, any>;
const PROGRESS_TONES = new Set<string>(["brass", "ok", "warn", "err", "danger", "info"]);
export function ProgressBar({ value = 0, max = 100, tone = "brass", size = "md", showLabel = false, label,
  valueText, className = "", style = {}, ...rest }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const h = size === "sm" ? 5 : size === "lg" ? 10 : 7;
  const toneKey = PROGRESS_TONES.has(tone) ? tone : "brass";
  // `aria-*` berjalan ke elemen `role="progressbar"` (track), bukan ke pembungkus visualnya.
  const ariaProps: Record<string, unknown> = {};
  const wrapperProps: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rest)) {
    if (key.startsWith("aria-")) ariaProps[key] = val;
    else wrapperProps[key] = val;
  }
  const accessibleName = (ariaProps["aria-label"] as string | undefined)
    ?? (typeof label === "string" ? label : undefined);
  return React.createElement("div", _extends({ className, style: { ...style } }, wrapperProps),
    (showLabel || label) && React.createElement("div", { style: { display: "flex", justifyContent: "space-between",
      alignItems: "baseline", marginBottom: 6 } },
      React.createElement("span", { style: { fontSize: "var(--text-sm)", color: "var(--text-body)" } }, label),
      showLabel && React.createElement("span", { "aria-hidden": "true", style: { fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)", color: "var(--text-muted)" } }, Math.round(pct), "%")),
    React.createElement("div", _extends({
      role: "progressbar", "aria-valuemin": 0, "aria-valuenow": value, "aria-valuemax": max,
      "aria-label": accessibleName, "aria-valuetext": valueText,
      style: { height: h, background: "var(--bone-300)", borderRadius: "var(--radius-pill)", overflow: "hidden" },
    }, ariaProps),
      React.createElement("div", { className: "hn-progress-fill", "data-tone": toneKey,
        style: { width: pct + "%", height: "100%", borderRadius: "var(--radius-pill)",
          transition: "width var(--dur-slow) var(--ease-out)" } })));
}

type StatusPillProps = { status?: string; children?: React.ReactNode; size?: "sm" | "md";
  /** `pill` = kapsul berlatar (default). `dot` = titik status + teks tanpa latar. */
  variant?: "pill" | "dot"; style?: React.CSSProperties } & Record<string, any>;
// `dot` = warna titik (fill), `text` = warna teks (lolos 4,5:1 di atas `bg`).
const STATUS: Record<string, { label: string; dot: string; text: string; bg: string; pulse: boolean }> = {
  ok: { label: "On convention", dot: "var(--leaf-600)", text: "var(--leaf-600)", bg: "var(--status-ok-tint)", pulse: false },
  drift: { label: "Drifting", dot: "var(--amber-600)", text: "var(--status-warn)", bg: "var(--status-warn-tint)", pulse: false },
  broken: { label: "Off convention", dot: "var(--clay-600)", text: "var(--clay-600)", bg: "var(--status-err-tint)", pulse: false },
  running: { label: "Running", dot: "var(--brass-600)", text: "var(--brass-700)", bg: "var(--brass-100)", pulse: true },
  // Berdenyut: prosesnya hidup dan sedang menunggumu — tidak diam seperti `paused`.
  awaiting: { label: "Menunggu keputusan", dot: "var(--amber-600)", text: "var(--status-warn)", bg: "var(--status-warn-tint)", pulse: true },
  queued: { label: "Queued", dot: "var(--wind-600)", text: "var(--wind-700)", bg: "var(--wind-100)", pulse: false },
  done: { label: "Done", dot: "var(--leaf-600)", text: "var(--leaf-600)", bg: "var(--status-ok-tint)", pulse: false },
  failed: { label: "Failed", dot: "var(--clay-600)", text: "var(--clay-600)", bg: "var(--status-err-tint)", pulse: false },
  paused: { label: "Paused", dot: "var(--amber-600)", text: "var(--status-warn)", bg: "var(--status-warn-tint)", pulse: false },
  stopped: { label: "Stopped", dot: "var(--ink-500)", text: "var(--ink-500)", bg: "var(--bone-200)", pulse: false },
  scanning: { label: "Scanning", dot: "var(--wind-600)", text: "var(--wind-700)", bg: "var(--wind-100)", pulse: true },
  idle: { label: "Idle", dot: "var(--ink-500)", text: "var(--ink-500)", bg: "var(--bone-200)", pulse: false },
};
export function StatusPill({ status = "idle", children, size = "md", variant = "pill", className = "", style = {}, ...rest }: StatusPillProps) {
  const s = STATUS[status] || STATUS.idle!;
  const sm = size === "sm";
  const dot = variant === "dot";
  return React.createElement("span", _extends({
    className,
    style: {
      display: "inline-flex", alignItems: "center", gap: sm ? 5 : 6,
      height: dot ? "auto" : sm ? 20 : 24,
      padding: dot ? 0 : sm ? "0 8px 0 7px" : "0 10px 0 8px",
      borderRadius: "var(--radius-pill)", background: dot ? "transparent" : s.bg, color: s.text,
      fontFamily: "var(--font-ui)", fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)",
      fontWeight: "var(--weight-medium)", lineHeight: 1, whiteSpace: "nowrap", ...style },
  }, rest),
    React.createElement(StatusDot, { color: s.dot, size: sm ? 6 : 7, pulse: s.pulse }),
    children || s.label);
}

type TooltipProps = { content?: React.ReactNode; children?: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right"; style?: React.CSSProperties } & Record<string, any>;
export function Tooltip({ content, children, placement = "top", className = "", style = {}, ...rest }: TooltipProps) {
  const [show, setShow] = React.useState(false);
  const pos = ({
    top: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
  } as Record<string, any>)[placement];
  return React.createElement("span", _extends({
    className, onMouseEnter: () => setShow(true), onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true), onBlur: () => setShow(false),
    style: { position: "relative", display: "inline-flex", ...style },
  }, rest), children,
    React.createElement("span", { role: "tooltip", style: { position: "absolute", zIndex: 40, ...pos,
      padding: "5px 9px", background: "var(--ink-900)", color: "var(--bone-100)", fontFamily: "var(--font-ui)",
      fontSize: "var(--text-xs)", lineHeight: 1.3, fontWeight: "var(--weight-medium)", borderRadius: "var(--radius-sm)",
      boxShadow: "var(--shadow-lg)", whiteSpace: "nowrap", pointerEvents: "none", opacity: show ? 1 : 0,
      transform: `${pos.transform} translateY(${show ? "0" : placement === "top" ? "2px" : "-2px"})`,
      transition: "opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)" } }, content));
}
