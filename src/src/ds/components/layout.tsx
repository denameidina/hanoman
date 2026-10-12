// Primitif layout dan daftar (Audit UI/UX 2026-10 · Fase 2A): PageHeader, FilterBar, RowList/DenseRow,
// Stack, Inline, Text. Susunan memakai kelas `hn-*` di app.css; inline hanya untuk nilai token
// (`var(--space-*)`, `var(--text-*)`, `var(--weight-*)`), tak pernah angka mentah. Hover dan fokus
// baris hidup di CSS (`:hover`, `:focus-within`), bukan `useState`.
import React from "react";
import { Icon } from "../icon";
import { Button, Input } from "./forms";
import { usePopoverFocus } from "../popover";

/* ---------------------------------------------------------------- PageHeader */

type PageHeaderProps = {
  title: React.ReactNode;
  /** Kicker mono kecil di atas judul. Pakai hanya untuk level seksi (audit aturan minimalis #8). */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  /** Aksi halaman (satu aksi primer + maks dua sekunder). */
  actions?: React.ReactNode;
  className?: string;
};

// Judul layar = `<h2>`: shell sudah memegang `<h1>` di topbar. Tak ada margin bawaan base.css.
export function PageHeader({ title, eyebrow, description, actions, className = "" }: PageHeaderProps) {
  return (
    <header className={`hn-page-header ${className}`.trim()}>
      <div className="hn-page-header-text">
        {eyebrow && <div className="hn-eyebrow hn-page-eyebrow">{eyebrow}</div>}
        <h2 className="hn-page-title">{title}</h2>
        {description && <p className="hn-page-description">{description}</p>}
      </div>
      {actions && <div className="hn-page-actions">{actions}</div>}
    </header>
  );
}

/* ---------------------------------------------------------------- FilterBar */

export type FilterChip = { key: string; label: string; onRemove: () => void };

type FilterBarProps = {
  /** Nama aksesibel wilayah filter. */
  label: string;
  search?: { value: string; onChange: (value: string) => void; label: string; placeholder: string };
  /** Filter yang sedang aktif, tampil sebagai chip yang bisa dilepas satu per satu. */
  chips?: readonly FilterChip[];
  /** Isi popover "Filter" (kontrol filter lanjutan). Tanpa prop ini, tombol Filter tak muncul. */
  filters?: React.ReactNode;
  filtersLabel?: string;
  /** Muncul hanya ketika ada filter/pencarian aktif. */
  onReset?: () => void;
  resetLabel?: string;
  /** Kontrol tambahan di ujung baris (mis. "Tambah"). */
  actions?: React.ReactNode;
};

function FilterPopover({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const { triggerRef, panelRef, panelId, onKeyDown } = usePopoverFocus(open, close, "dialog");
  return (
    <div className="hn-filter-popover-anchor">
      <button ref={triggerRef} type="button" className="hn-filter-trigger hn-touch-target"
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}>
        <Icon name="sliders" size={14} />
        {label}
        {count > 0 && <span className="hn-filter-count">{count}<span className="hn-sr-only"> aktif</span></span>}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-label={label} className="hn-filter-popover"
          onKeyDown={onKeyDown}>
          {children}
        </div>
      )}
    </div>
  );
}

// Baris pencarian + chip filter aktif + popover "Filter" + Reset. Satu pola untuk semua daftar.
export function FilterBar({ label, search, chips = [], filters, filtersLabel = "Filter", onReset,
  resetLabel = "Reset", actions }: FilterBarProps) {
  const hasActive = chips.length > 0 || Boolean(search?.value);
  const showReset = Boolean(onReset) && hasActive;
  return (
    <div role={search ? "search" : "group"} aria-label={label} className="hn-filter-bar">
      <div className="hn-filter-bar-row">
        {search && (
          <div className="hn-filter-search">
            <Input type="search" size="sm" leftIcon="search" aria-label={search.label}
              placeholder={search.placeholder} value={search.value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => search.onChange(e.target.value)} />
          </div>
        )}
        {filters != null && <FilterPopover label={filtersLabel} count={chips.length}>{filters}</FilterPopover>}
        {actions && <div className="hn-filter-actions">{actions}</div>}
      </div>
      {(chips.length > 0 || showReset) && (
        <div className="hn-filter-bar-chips">
          {chips.map((chip) => (
            <button key={chip.key} type="button" className="hn-filter-chip" onClick={chip.onRemove}
              aria-label={`Hapus filter ${chip.label}`}>
              <span>{chip.label}</span>
              <Icon name="x" size={12} />
            </button>
          ))}
          {showReset && <Button size="sm" variant="ghost" onClick={onReset}>{resetLabel}</Button>}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- RowList / DenseRow */

// Daftar berbaris. Pola tunggal untuk baris klik dan baris non-klik.
export function RowList({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <ul role="list" aria-label={label} className={`hn-row-list ${className}`.trim()}>{children}</ul>;
}

type DenseRowProps = {
  children: React.ReactNode;
  /** Membuat baris menjadi `<button>` sungguhan. */
  onClick?: () => void;
  /** Membuat baris menjadi `<a>` sungguhan. Diabaikan bila `onClick` juga ada. */
  href?: string;
  /** Baris yang sedang dipilih (`aria-current`). */
  selected?: boolean;
  /** Aksi sekunder. Selalu di LUAR elemen klik, supaya tak ada tombol di dalam tombol. */
  actions?: React.ReactNode;
};

export function DenseRow({ children, onClick, href, selected = false, actions }: DenseRowProps) {
  const interactive = Boolean(onClick || href);
  const current = selected ? "true" : undefined;
  let main: React.ReactNode;
  if (href && !onClick) {
    main = <a href={href} className="hn-row-main" aria-current={current}>{children}</a>;
  } else if (interactive) {
    main = <button type="button" className="hn-row-main" onClick={onClick} aria-current={current}>{children}</button>;
  } else {
    main = <div className="hn-row-main">{children}</div>;
  }
  const cls = ["hn-row", interactive && "hn-row-interactive", selected && "hn-row-selected"].filter(Boolean).join(" ");
  return (
    <li className={cls}>
      {main}
      {actions && <div className="hn-row-actions">{actions}</div>}
    </li>
  );
}

/* ---------------------------------------------------------------- Stack / Inline */

// Skala gap = skala spacing token (4px grid). Angka hanya memilih token; nilainya tetap `var(--space-N)`.
export type SpaceStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type Align = "start" | "center" | "end" | "stretch" | "baseline";

type StackProps = { gap?: SpaceStep; align?: Align; as?: "div" | "section" | "ul" | "ol";
  children?: React.ReactNode; className?: string; style?: React.CSSProperties };
export function Stack({ gap = 3, align, as = "div", children, className = "", style }: StackProps) {
  return React.createElement(as, {
    className: `hn-stack ${className}`.trim(),
    style: { gap: `var(--space-${gap})`, alignItems: align, ...style },
  }, children);
}

type InlineProps = { gap?: SpaceStep; align?: Align; justify?: "start" | "center" | "end" | "between";
  wrap?: boolean; as?: "div" | "span" | "section"; children?: React.ReactNode; className?: string; style?: React.CSSProperties };
const JUSTIFY: Record<NonNullable<InlineProps["justify"]>, string> = {
  start: "flex-start", center: "center", end: "flex-end", between: "space-between",
};
export function Inline({ gap = 2, align = "center", justify, wrap = true, as = "div", children, className = "", style }: InlineProps) {
  return React.createElement(as, {
    className: `hn-inline${wrap ? "" : " hn-inline-nowrap"} ${className}`.trim(),
    style: { gap: `var(--space-${gap})`, alignItems: align, justifyContent: justify ? JUSTIFY[justify] : undefined, ...style },
  }, children);
}

/* ---------------------------------------------------------------- Text */

// Skala ukuran TERBATAS pada token 11/12/13/14/16. Angka lain tak bisa diketik (type-level).
export type TextSize = 11 | 12 | 13 | 14 | 16;
export type TextTone = "body" | "muted" | "subtle" | "strong";

const TEXT_SIZE: Record<TextSize, string> = {
  11: "var(--text-2xs)", 12: "var(--text-xs)", 13: "var(--text-sm)", 14: "var(--text-md)", 16: "var(--text-base)",
};
const TEXT_TONE: Record<TextTone, string> = {
  body: "var(--text-body)", muted: "var(--text-muted)", subtle: "var(--text-subtle)", strong: "var(--text-strong)",
};

type TextProps = { size?: TextSize; tone?: TextTone; as?: "span" | "p" | "div"; children?: React.ReactNode;
  className?: string; style?: React.CSSProperties };
export function Text({ size = 14, tone = "body", as = "span", children, className = "", style }: TextProps) {
  return React.createElement(as, {
    className: `hn-text ${className}`.trim(),
    style: { fontSize: TEXT_SIZE[size], color: TEXT_TONE[tone], ...style },
  }, children);
}
