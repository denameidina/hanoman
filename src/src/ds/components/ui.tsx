// Navigasi dan menu aksi: Tabs (+ TabPanel opsional) dan OverflowActions.
import React from "react";
import { Icon } from "../icon";
import { Modal } from "../kit";
import { IconButton } from "./forms";
import "./ui.css";
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

// Tepi strip tab yang masih menyimpan tab di luar kotaknya. `start` = ada tab di kiri yang belum terlihat,
// `end` = ada di kanan. Hanya saat strip benar-benar meluap; di ujungnya gradasi berhenti.
export type ScrollEdges = { start: boolean; end: boolean };
const readEdges = (el: HTMLElement): ScrollEdges => {
  // Strip yang dibiarkan `overflow: visible` (tab yang MEMBUNGKUS, mis. Scheduler ≤420 px) bukan penggulir:
  // tak ada tab tersembunyi di tepinya, dan gradasi tak boleh mengubah tampilannya.
  if (getComputedStyle(el).overflowX === "visible") return { start: false, end: false };
  const max = el.scrollWidth - el.clientWidth;
  return { start: el.scrollLeft > 1, end: max > 1 && el.scrollLeft < max - 1 };
};
// Dipakai juga oleh papan tombol terminal (`TerminalKeys`): gradasi tepi hanya saat ada isi yang tersembunyi.
export function useScrollEdges(ref: React.RefObject<HTMLElement>): ScrollEdges {
  const [edges, setEdges] = React.useState<ScrollEdges>({ start: false, end: false });
  // `setEdges` dengan nilai yang sama tak me-render ulang, jadi mengukur di tiap render itu murah.
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = readEdges(el);
    setEdges((cur) => (cur.start === next.start && cur.end === next.end ? cur : next));
  }, [ref]);
  // Tanpa deps: label dan angka tab bisa berubah tanpa mengubah ukuran kotaknya.
  React.useEffect(() => { measure(); });
  // Scroll, dan perubahan ukuran kotak (lebar layar, rotasi, sidebar). jsdom tak punya ResizeObserver.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro?.disconnect(); };
  }, [ref, measure]);
  return edges;
}

// Tab yang dipilih harus terlihat di strip (lewat panah, URL, atau tab di luar layar). Hanya kotak strip
// yang digulir: scrollIntoView ikut menggulir halaman bila strip-nya tertutup di sumbu-Y. Tab yang tak utuh
// terlihat diletakkan 24 px dari tepi, sebesar gradasi (app.css); `scroll-padding-inline` `.hn-tabs` memberi
// titik snap di posisi yang sama, jadi scroll-snap tak menggesernya lagi.
const TAB_FADE_PX = 24;
function revealTab(list: HTMLElement, tab: HTMLElement) {
  const lr = list.getBoundingClientRect();
  const tr = tab.getBoundingClientRect();
  const start = tr.left - lr.left - list.clientLeft + list.scrollLeft;
  const end = start + tr.width;
  if (start < list.scrollLeft + TAB_FADE_PX || end > list.scrollLeft + list.clientWidth - TAB_FADE_PX) {
    list.scrollLeft = Math.max(0, start - TAB_FADE_PX);
  }
}

type TabsProps = { tabs?: Tab[]; value?: string; defaultValue?: string; onChange?: (v: string) => void;
  variant?: "underline" | "pill"; style?: React.CSSProperties; children?: React.ReactNode } & Record<string, any>;
export function Tabs({ tabs = [], value, defaultValue, onChange, variant = "underline", className = "", style = {}, children, ...rest }: TabsProps) {
  const norm = tabs.map((t) => (typeof t === "string" ? { value: t, label: t } : t)) as { value: string; label?: React.ReactNode; icon?: string; count?: number }[];
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? (norm[0] && norm[0].value));
  const active = isControlled ? value : inner;
  const baseId = React.useId();
  const listRef = React.useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(listRef);
  // Efek layout: tab terpilih digulir masuk sebelum frame dilukis, tak sempat tampil di luar strip.
  React.useLayoutEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (list && tab) revealTab(list, tab);
  }, [active]);
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
    ref: listRef, className: `hn-tabs ${className}`.trim(), role: "tablist",
    // Gradasi tepi (app.css `.hn-tabs[data-fade-*]`) hanya saat ada tab yang belum terlihat di sisi itu.
    "data-fade-start": edges.start ? "true" : undefined, "data-fade-end": edges.end ? "true" : undefined,
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
  /** `danger` untuk aksi merusak (hapus, reset). Tetap menu item biasa; hanya warnanya yang berubah. */
  tone?: "default" | "danger";
};

// Kontrol yang bisa dituju Tab; selektornya sama dengan jebakan fokus `Modal` (kit.tsx).
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// SPEC-800 · ember untuk aksi yang tidak muat. Panelnya tetap `Modal` DS (focus trap, Escape, restorasi
// fokus, bentuk bottom-sheet di ponsel), dan DI DALAM panel itu item tersusun sebagai menu ARIA:
// `role="menu"` berisi `role="menuitem"`, roving tabindex (satu item tabbable), ↑/↓ berputar, Home/End,
// huruf pertama melompat ke item berawalan huruf itu. Tab dari menu menutup panel dan fokus kembali ke
// pemicu. Shift+Tab juga menutup, kecuali ada kontrol di `children`: fokus lalu kembali ke sana.
// `children` (unduhan, slider, dsb.) dirender DI LUAR `role="menu"`, karena ARIA tak mengizinkan input
// di dalam menu. Pemicu memakai `aria-haspopup="menu"` bila ada item, `"dialog"` bila hanya children.
export function OverflowActions({ label, title, items, icon = "more-horizontal", size = "sm", children }: {
  /** Nama aksesibel pemicu (wajib; juga nama dialog bila `title` tak diisi). */
  label: string;
  /** Judul di dalam dialog. Default: `label`. */
  title?: string;
  items: readonly OverflowItem[]; icon?: string;
  size?: "sm" | "md" | "lg"; children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  // Indeks item yang tabbable (roving tabindex).
  const [active, setActive] = React.useState(0);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const extraRef = React.useRef<HTMLDivElement>(null);
  const triggerId = React.useId();
  // Fokus dikembalikan ke pemicu hanya bila menutup lewat keyboard (Esc, ×, Tab). Pilihan item tidak:
  // aksinya sering membuka dialog lain, dan pemicu di belakangnya sudah inert.
  const restoreFocus = React.useRef(false);
  const wasOpen = React.useRef(false);

  React.useEffect(() => {
    if (wasOpen.current && !open && restoreFocus.current) {
      restoreFocus.current = false;
      document.getElementById(triggerId)?.focus();
    }
    wasOpen.current = open;
  }, [open, triggerId]);

  // Hook harus dipanggil sebelum return dini di bawah.
  if (!items.length && !children) return null;

  const enabled = items.flatMap((item, i) => (item.disabled ? [] : [i]));
  const firstEnabled = Math.max(0, items.findIndex((item) => !item.disabled));
  const openPanel = () => { setActive(firstEnabled); setOpen(true); };
  const closeByKey = () => { restoreFocus.current = true; setOpen(false); };
  const focusItem = (i: number) => { setActive(i); itemRefs.current[i]?.focus(); };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((el) => el === event.target);
    if (event.key === "Tab") {
      // Stop propagation: jebakan Tab milik Modal (listener window) tak boleh ikut mengulang fokus.
      if (event.shiftKey && extraRef.current?.querySelector(FOCUSABLE)) return;
      event.preventDefault();
      event.stopPropagation();
      closeByKey();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const n = enabled.length;
      if (!n) return;
      const pos = enabled.indexOf(current);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = pos < 0 ? enabled[step > 0 ? 0 : n - 1] : enabled[(pos + step + n) % n];
      if (next !== undefined) focusItem(next);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? enabled[0] : enabled[enabled.length - 1];
      if (target !== undefined) focusItem(target);
      return;
    }
    // Typeahead: satu huruf, mulai dari item sesudah yang aktif lalu berputar.
    if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const ch = event.key.toLowerCase();
      const order = [...enabled.filter((i) => i > current), ...enabled.filter((i) => i <= current)];
      const hit = order.find((i) => (items[i]?.label ?? "").trim().toLowerCase().startsWith(ch));
      if (hit !== undefined) focusItem(hit);
    }
  };

  return (
    <>
      <IconButton id={triggerId} size={size} icon={icon} label={label}
        aria-haspopup={items.length ? "menu" : "dialog"} aria-expanded={open} onClick={openPanel} />
      {open && (
        <Modal open title={title ?? label} icon={icon} width={420} onClose={closeByKey}>
          {children != null && <div ref={extraRef}>{children}</div>}
          {items.length > 0 && (
            <div role="menu" aria-label={title ?? label} className="hn-overflow-menu" onKeyDown={onMenuKeyDown}>
              {items.map((item, i) => {
                const danger = item.tone === "danger";
                return (
                  <button key={item.key} ref={(el) => { itemRefs.current[i] = el; }} type="button"
                    role="menuitem" tabIndex={i === active ? 0 : -1} disabled={item.disabled} title={item.title}
                    data-initial-focus={i === active ? "" : undefined}
                    onFocus={() => setActive(i)}
                    onClick={() => { setOpen(false); item.onSelect(); }}
                    className={`hn-overflow-item${danger ? " hn-overflow-item-danger" : ""}`}>
                    {item.icon && <Icon name={item.icon} size={15} />}
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
