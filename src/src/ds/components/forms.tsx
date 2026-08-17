// Ported verbatim from _ds_bundle.js (forms/*). ESM + typed props. No visual change.
import React from "react";
import { Icon } from "../icon";
const _extends = Object.assign;

type Size = "sm" | "md" | "lg";
const BTN_SIZES: Record<string, { h: number; px: number; fs: string; gap: number; icon: number }> = {
  sm: { h: 30, px: 12, fs: "var(--text-sm)", gap: 6, icon: 15 },
  md: { h: 38, px: 16, fs: "var(--text-md)", gap: 8, icon: 17 },
  lg: { h: 46, px: 22, fs: "var(--text-base)", gap: 9, icon: 19 },
};
function variantStyle(variant: string): React.CSSProperties {
  switch (variant) {
    case "secondary": return { background: "var(--surface-card)", color: "var(--text-strong)",
      border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-xs)" };
    case "ghost": return { background: "transparent", color: "var(--text-body)", border: "1px solid transparent" };
    case "danger": return { background: "var(--clay-600)", color: "#fff", border: "1px solid var(--clay-600)" };
    case "primary": default: return { background: "var(--accent)", color: "var(--accent-on)",
      border: "1px solid var(--accent)", boxShadow: "var(--shadow-xs)" };
  }
}
type ButtonProps = { children?: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: Size; leftIcon?: string; rightIcon?: string; loading?: boolean; disabled?: boolean; fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  // SPEC-361 · `as="a"` dipakai tombol unduh: unduhan butuh anchor sungguhan (atribut `download`)
  // agar nama berkas dari `content-disposition` server dihormati, bukan <button> ber-onClick.
  as?: "button" | "a";
  style?: React.CSSProperties } & Record<string, any>;
export function Button({ children, variant = "primary", size = "md", leftIcon, rightIcon, loading = false,
  disabled = false, fullWidth = false, type = "button", as: asTag = "button",
  className = "", style = {}, ...rest }: ButtonProps) {
  const s = BTN_SIZES[size] || BTN_SIZES.md!;
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const isDisabled = disabled || loading;
  const base = variantStyle(variant);
  const hoverOverlay: React.CSSProperties = variant === "ghost" ? { background: "var(--bone-200)" }
    : variant === "secondary" ? { background: "var(--bone-100)", borderColor: "var(--ink-300)" }
    : { filter: "brightness(0.95)" };
  const isAnchor = asTag === "a";
  // `type`/`disabled` bukan atribut sah pada <a>; padanannya aria-disabled. Dipisah ke variabel
  // ber-tipe longgar karena spread kondisional di dalam argumen createElement membuat TS
  // menyimpulkan union prop yang tak cocok overload mana pun.
  const tagProps: Record<string, unknown> = isAnchor
    ? { "aria-disabled": isDisabled || undefined }
    : { type, disabled: isDisabled };
  return React.createElement(isAnchor ? "a" : "button", _extends({
    ...tagProps,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => { setHover(false); setActive(false); },
    onMouseDown: () => setActive(true), onMouseUp: () => setActive(false), className: `hn-touch-target ${className}`.trim(),
    style: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: s.gap, height: s.h,
      textDecoration: "none",
      padding: `0 ${s.px}px`, width: fullWidth ? "100%" : "auto", font: `var(--weight-medium) ${s.fs}/1 var(--font-ui)`,
      letterSpacing: "0.005em", borderRadius: "var(--radius-sm)", cursor: isDisabled ? "not-allowed" : "pointer",
      opacity: isDisabled ? 0.5 : 1, transition: "var(--transition-fast)",
      transform: active && !isDisabled ? "translateY(0.5px)" : "none", outline: "none", whiteSpace: "nowrap",
      ...base, ...(hover && !isDisabled ? hoverOverlay : null), ...style },
  }, rest),
    loading && React.createElement(Icon, { name: "loader-2", size: s.icon, style: { animation: "hn-spin 0.7s linear infinite" } }),
    !loading && leftIcon && React.createElement(Icon, { name: leftIcon, size: s.icon }),
    children != null && React.createElement("span", null, children),
    !loading && rightIcon && React.createElement(Icon, { name: rightIcon, size: s.icon }),
    React.createElement("style", null, `@keyframes hn-spin{to{transform:rotate(360deg)}}`));
}

const IB_SIZES: Record<string, { box: number; icon: number }> = {
  sm: { box: 30, icon: 16 }, md: { box: 38, icon: 18 }, lg: { box: 46, icon: 20 },
};
type IconButtonProps = { icon: string; label?: string; variant?: "solid" | "outline" | "ghost";
  size?: Size; disabled?: boolean; style?: React.CSSProperties } & Record<string, any>;
export function IconButton({ icon, label, variant = "ghost", size = "md", disabled = false, className = "", style = {}, ...rest }: IconButtonProps) {
  const s = IB_SIZES[size] || IB_SIZES.md!;
  const [hover, setHover] = React.useState(false);
  const base: React.CSSProperties = variant === "solid" ? { background: "var(--accent)", color: "var(--accent-on)", border: "1px solid var(--accent)" }
    : variant === "outline" ? { background: "var(--surface-card)", color: "var(--text-body)", border: "1px solid var(--border-strong)" }
    : { background: "transparent", color: "var(--text-muted)", border: "1px solid transparent" };
  const hoverOverlay: React.CSSProperties = variant === "solid" ? { filter: "brightness(0.95)" }
    : variant === "outline" ? { background: "var(--bone-100)", borderColor: "var(--ink-300)", color: "var(--text-strong)" }
    : { background: "var(--bone-200)", color: "var(--text-strong)" };
  return React.createElement("button", _extends({
    type: "button", "aria-label": label, title: label, disabled,
    onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), className: `hn-touch-target ${className}`.trim(),
    style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: s.box, height: s.box,
      borderRadius: "var(--radius-sm)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      transition: "var(--transition-fast)", outline: "none", ...base, ...(hover && !disabled ? hoverOverlay : null), ...style },
  }, rest), React.createElement(Icon, { name: icon, size: s.icon }));
}

const INPUT_SIZES: Record<string, { h: number; px: number; fs: string; icon: number }> = {
  sm: { h: 30, px: 10, fs: "var(--text-sm)", icon: 15 },
  md: { h: 38, px: 12, fs: "var(--text-md)", icon: 17 },
  lg: { h: 46, px: 14, fs: "var(--text-base)", icon: 19 },
};
type InputProps = { size?: Size; leftIcon?: string; rightIcon?: string; invalid?: boolean; disabled?: boolean;
  mono?: boolean; style?: React.CSSProperties } & Record<string, any>;
export function Input({ size = "md", leftIcon, rightIcon, invalid = false, disabled = false, mono = false, className = "", style = {}, ...rest }: InputProps) {
  const s = INPUT_SIZES[size] || INPUT_SIZES.md!;
  const [focus, setFocus] = React.useState(false);
  const borderColor = invalid ? "var(--status-err)" : focus ? "var(--border-focus)" : "var(--border-strong)";
  return React.createElement("div", {
    className: `hn-touch-target ${className}`.trim(),
    style: { display: "flex", alignItems: "center", gap: 8, height: s.h, padding: `0 ${s.px}px`,
      background: disabled ? "var(--bone-200)" : "var(--surface-card)", border: `1px solid ${borderColor}`,
      borderRadius: "var(--radius-sm)", boxShadow: focus ? "var(--ring)" : invalid ? "none" : "var(--shadow-inset)",
      transition: "var(--transition-fast)", opacity: disabled ? 0.6 : 1, ...style },
  },
    leftIcon && React.createElement(Icon, { name: leftIcon, size: s.icon, color: "var(--text-subtle)" }),
    React.createElement("input", _extends({
      disabled,
      onFocus: (e: React.FocusEvent<HTMLInputElement>) => { setFocus(true); rest.onFocus && rest.onFocus(e); },
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => { setFocus(false); rest.onBlur && rest.onBlur(e); },
    }, rest, {
      style: { flex: 1, minWidth: 0, height: "100%", boxSizing: "border-box", border: "none", outline: "none", background: "transparent",
        color: "var(--text-strong)", fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", fontSize: s.fs, lineHeight: 1.2 },
    })),
    rightIcon && React.createElement(Icon, { name: rightIcon, size: s.icon, color: "var(--text-subtle)" }));
}

const SELECT_SIZES: Record<string, { h: number; px: number; fs: string }> = {
  sm: { h: 30, px: 10, fs: "var(--text-sm)" }, md: { h: 38, px: 12, fs: "var(--text-md)" }, lg: { h: 46, px: 14, fs: "var(--text-base)" },
};
type Option = string | { value: string; label: string };
type SelectProps = { options?: Option[]; value?: string; defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void; size?: Size; disabled?: boolean; invalid?: boolean;
  placeholder?: string; style?: React.CSSProperties } & Record<string, any>;
export function Select({ options = [], value, defaultValue, onChange, size = "md", disabled = false, invalid = false, placeholder, className = "", style = {}, ...rest }: SelectProps) {
  const s = SELECT_SIZES[size] || SELECT_SIZES.md!;
  const [focus, setFocus] = React.useState(false);
  const borderColor = invalid ? "var(--status-err)" : focus ? "var(--border-focus)" : "var(--border-strong)";
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return React.createElement("div", {
    className: `hn-touch-target hn-select ${className}`.trim(),
    style: { position: "relative", display: "inline-flex", alignItems: "center", height: s.h,
      background: disabled ? "var(--bone-200)" : "var(--surface-card)", border: `1px solid ${borderColor}`,
      borderRadius: "var(--radius-sm)", boxShadow: focus ? "var(--ring)" : "var(--shadow-inset)",
      transition: "var(--transition-fast)", opacity: disabled ? 0.6 : 1, ...style },
  },
    React.createElement("select", _extends({
      value, defaultValue, onChange, disabled, onFocus: () => setFocus(true), onBlur: () => setFocus(false),
    }, rest, {
      style: { appearance: "none", WebkitAppearance: "none", border: "none", outline: "none", background: "transparent",
        color: "var(--text-strong)", fontFamily: "var(--font-ui)", fontSize: s.fs, height: "100%",
        // Isi penuh lebar pembungkus supaya SELURUH field (bukan cuma teksnya) membuka dropdown.
        flex: 1, width: "100%", minWidth: 0, boxSizing: "border-box",
        padding: `0 ${s.px + 22}px 0 ${s.px}px`, cursor: disabled ? "not-allowed" : "pointer" },
    }),
      placeholder && React.createElement("option", { value: "", disabled: true }, placeholder),
      norm.map((o) => React.createElement("option", { key: o.value, value: o.value }, o.label))),
    React.createElement(Icon, { name: "chevron-down", size: 16, color: "var(--text-subtle)",
      style: { position: "absolute", right: s.px, pointerEvents: "none" } }));
}

type CheckboxProps = { checked?: boolean; defaultChecked?: boolean; onChange?: (next: boolean, e: React.MouseEvent | React.KeyboardEvent) => void;
  label?: React.ReactNode; description?: React.ReactNode; disabled?: boolean; style?: React.CSSProperties } & Record<string, any>;
export function Checkbox({ checked, defaultChecked, onChange, label, description, disabled = false, className = "", style = {}, ...rest }: CheckboxProps) {
  const textId = React.useId();
  const { "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...outerProps } = rest;
  const isControlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = isControlled ? checked : inner;
  const toggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (disabled) return;
    if (!isControlled) setInner((v) => !v);
    onChange && onChange(!on, e);
  };
  return React.createElement("label", _extends({
    className: `hn-choice-target ${className}`.trim(),
    style: { display: "inline-flex", alignItems: description ? "flex-start" : "center", gap: 10,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, ...style },
  }, outerProps),
    React.createElement("span", {
      // SPEC-485 · peran & keadaan dinyatakan eksplisit: pembaca layar (dan test) harus bisa
      // membedakan "centang beberapa" dari "pilih salah satu" tanpa membaca teks di sebelahnya.
      role: "checkbox", "aria-checked": on, "aria-disabled": disabled || undefined,
      "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy ?? (!ariaLabel && (label || description) ? textId : undefined),
      className: "hn-choice-control",
      tabIndex: disabled ? -1 : 0,
      onClick: toggle,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        toggle(e);
      },
      style: { display: "inline-grid", placeItems: "center", width: 18, height: 18,
        marginTop: description ? 2 : 0, flex: "0 0 auto" },
    }, React.createElement("span", { style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18,
      borderRadius: "var(--radius-xs)", background: on ? "var(--accent)" : "var(--surface-card)",
      border: `1.5px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
      boxShadow: on ? "none" : "var(--shadow-inset)", transition: "var(--transition-fast)" } },
    on && React.createElement(Icon, { name: "check", size: 13, stroke: 3, color: "var(--accent-on)" }))),
    (label || description) && React.createElement("span", { id: textId, onClick: toggle, style: { userSelect: "none" } },
      label && React.createElement("span", { style: { display: "block", fontSize: "var(--text-md)",
        color: "var(--text-strong)", lineHeight: 1.4 } }, label),
      description && React.createElement("span", { style: { display: "block", fontSize: "var(--text-sm)",
        color: "var(--text-muted)", lineHeight: 1.45 } }, description)));
}

// SPEC-485 · ADR-0102 · pilihan TUNGGAL butuh kontrol yang menyatakan dirinya tunggal. Cermin
// `Checkbox` di atas — bentuknya saja yang bundar dan `role`-nya `radio`. Sengaja TANPA keadaan
// internal: "salah satu dari sekumpulan" hanya benar bila yang memegang daftarnya satu pihak, dan
// itu induknya, bukan tiap tombol.
type RadioProps = { checked?: boolean; onChange?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  label?: React.ReactNode; description?: React.ReactNode; disabled?: boolean;
  style?: React.CSSProperties } & Record<string, any>;
export function Radio({ checked = false, onChange, label, description, disabled = false, className = "", style = {}, ...rest }: RadioProps) {
  const textId = React.useId();
  const { "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...outerProps } = rest;
  const pick = (e: React.MouseEvent | React.KeyboardEvent) => { if (!disabled) onChange && onChange(e); };
  return React.createElement("label", _extends({
    className: `hn-choice-target ${className}`.trim(),
    style: { display: "inline-flex", alignItems: description ? "flex-start" : "center", gap: 10,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, ...style },
  }, outerProps),
    React.createElement("span", {
      role: "radio", "aria-checked": checked, "aria-disabled": disabled || undefined,
      "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy ?? (!ariaLabel && (label || description) ? textId : undefined),
      className: "hn-choice-control",
      tabIndex: disabled ? -1 : 0, onClick: pick,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        pick(e);
      },
      style: { display: "inline-grid", placeItems: "center", width: 18, height: 18,
        marginTop: description ? 2 : 0, flex: "0 0 auto" },
    }, React.createElement("span", { style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18,
      borderRadius: "var(--radius-pill)", background: "var(--surface-card)",
      border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
      boxShadow: checked ? "none" : "var(--shadow-inset)", transition: "var(--transition-fast)" } },
    checked && React.createElement("span", { style: { width: 8, height: 8,
      borderRadius: "var(--radius-pill)", background: "var(--accent)" } }))),
    (label || description) && React.createElement("span", { id: textId, onClick: pick, style: { userSelect: "none" } },
      label && React.createElement("span", { style: { display: "block", fontSize: "var(--text-md)",
        color: "var(--text-strong)", lineHeight: 1.4 } }, label),
      description && React.createElement("span", { style: { display: "block", fontSize: "var(--text-sm)",
        color: "var(--text-muted)", lineHeight: 1.45 } }, description)));
}

const SWITCH_SIZES: Record<string, { w: number; h: number; knob: number }> = {
  sm: { w: 32, h: 18, knob: 14 }, md: { w: 40, h: 22, knob: 18 },
};
type SwitchProps = { checked?: boolean; defaultChecked?: boolean; onChange?: (next: boolean, e: React.MouseEvent | React.KeyboardEvent) => void;
  size?: "sm" | "md"; disabled?: boolean; label?: React.ReactNode; style?: React.CSSProperties } & Record<string, any>;
export function Switch({ checked, defaultChecked, onChange, size = "md", disabled = false, label, className = "", style = {}, ...rest }: SwitchProps) {
  const textId = React.useId();
  const { "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...outerProps } = rest;
  const s = SWITCH_SIZES[size] || SWITCH_SIZES.md!;
  const isControlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = isControlled ? checked : inner;
  const toggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (disabled) return;
    if (!isControlled) setInner((v) => !v);
    onChange && onChange(!on, e);
  };
  const track = React.createElement("span", {
    role: "switch", "aria-checked": on, "aria-disabled": disabled || undefined,
    "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy ?? (!ariaLabel && label ? textId : undefined),
    className: "hn-choice-control",
    tabIndex: disabled ? -1 : 0, onClick: toggle,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      toggle(e);
    },
    style: { display: "inline-grid", placeItems: "center", width: s.w, height: s.h,
      cursor: disabled ? "not-allowed" : "pointer", flex: "0 0 auto" },
  }, React.createElement("span", { style: { position: "relative", display: "inline-block", width: s.w, height: s.h,
    borderRadius: "var(--radius-pill)", background: on ? "var(--accent)" : "var(--ink-300)",
    border: "1px solid " + (on ? "var(--accent-hover)" : "var(--ink-300)"), transition: "var(--transition-fast)" } },
  React.createElement("span", {
    style: { position: "absolute", top: "50%", left: on ? s.w - s.knob - 3 : 2, transform: "translateY(-50%)",
      width: s.knob, height: s.knob, borderRadius: "50%", background: "var(--bone-000)", boxShadow: "var(--shadow-sm)",
      transition: "var(--transition-fast)" },
  })));
  if (!label) {
    return React.createElement("span", _extends({ className: `hn-choice-target ${className}`.trim(), style: { opacity: disabled ? 0.55 : 1, ...style } }, outerProps), track);
  }
  return React.createElement("label", _extends({
    className: `hn-choice-target ${className}`.trim(), style: { display: "inline-flex", alignItems: "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1, ...style },
  }, outerProps), track, React.createElement("span", { id: textId, onClick: toggle, style: { fontSize: "var(--text-md)", color: "var(--text-strong)",
    userSelect: "none" } }, label));
}

// SPEC-484 · ADR-0101 · pilihan jamak ber-pencarian + chip. SENGAJA INLINE, bukan portal/popover:
// portal menuntut outside-click & focus-trap, dan opsinya harus bisa diuji lewat `getByRole`
// alih-alih menembak <span> di dalam <label> seperti Checkbox/Switch DS (jebakan SPEC-299/360/447).
export type MultiOption = { value: string; label: string; group?: string };
export type MultiSelectProps = {
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Nilai yang TAK ada di katalog — dirender sebagai chip bertanda, bukan dibuang senyap. */
  invalidValues?: string[];
  disabled?: boolean;
  style?: React.CSSProperties;
} & Record<string, any>;

export function MultiSelect({
  options, value, onChange, placeholder = "Pilih…", searchPlaceholder = "Cari…",
  emptyText = "Tak ada yang cocok.", invalidValues = [], disabled = false, style = {}, ...rest
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const label = (rest["aria-label"] as string) ?? placeholder;
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => `${o.label} ${o.value} ${o.group ?? ""}`.toLowerCase().includes(needle))
    : options;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, ...style } },
    value.length > 0 && React.createElement("div",
      { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
      value.map((v) => {
        const bad = invalidValues.includes(v);
        return React.createElement("span", {
          key: v, "data-testid": `chip-${v}`,
          title: bad ? "tak ada di katalog mesin ini" : undefined,
          style: {
            display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px",
            borderRadius: "var(--radius-pill)", fontSize: "var(--text-xs)",
            fontFamily: "var(--font-mono)",
            background: "var(--bone-200)",
            color: bad ? "var(--status-err)" : "var(--text-strong)",
            border: `1px solid ${bad ? "var(--status-err)" : "var(--border-strong)"}`,
          },
        },
          bad ? "⚠ " : null,
          labelOf(v),
          React.createElement("button", {
            type: "button", "aria-label": `Hapus ${v}`, disabled,
            onClick: () => onChange(value.filter((x) => x !== v)),
            style: { border: "none", background: "transparent", cursor: "pointer",
              color: "inherit", padding: 0, lineHeight: 1, fontSize: "var(--text-sm)" },
          }, "×"));
      })),
    React.createElement(Button, {
      variant: "secondary", size: "sm", disabled,
      "aria-label": label, "aria-expanded": open,
      onClick: () => setOpen((v) => !v),
      rightIcon: open ? "chevron-up" : "chevron-down",
    }, value.length ? `${value.length} dipilih` : placeholder),
    open && React.createElement("div", {
      style: {
        display: "flex", flexDirection: "column", gap: 6, padding: 8,
        border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
        background: "var(--surface-card)",
      },
    },
      React.createElement(Input, {
        type: "search", role: "searchbox", size: "sm", value: q,
        placeholder: searchPlaceholder, "aria-label": `Cari ${label}`,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value),
      }),
      React.createElement("div", {
        role: "listbox", "aria-multiselectable": true,
        style: { display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto" },
      },
        shown.length === 0
          ? React.createElement("span", {
              style: { fontSize: "var(--text-xs)", color: "var(--text-subtle)", padding: "6px 4px" },
            }, emptyText)
          : shown.map((o) => React.createElement("button", {
              key: o.value, type: "button", role: "option",
              "aria-selected": value.includes(o.value), disabled,
              onClick: () => toggle(o.value),
              style: {
                display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
                border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                font: `var(--weight-medium) var(--text-sm)/1.3 var(--font-ui)`,
                color: value.includes(o.value) ? "var(--text-strong)" : "var(--text-body)",
              },
            },
              React.createElement(Icon, {
                name: value.includes(o.value) ? "check" : "circle", size: 14,
                color: value.includes(o.value) ? "var(--accent)" : "var(--text-subtle)",
              }),
              React.createElement("span", null, o.label),
              o.group && React.createElement("span", {
                style: { marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--text-subtle)" },
              }, o.group))))));
}
