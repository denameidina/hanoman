/* Ported from .prototype/app/Shell.jsx — sidebar + topbar chrome.
   ESM + typed; window globals removed. No visual change. */
import React from "react";
import { Icon } from "./icon";
import { Input } from "./components/forms";
import { Mark } from "./marks";
import { NotificationBell } from "../notifications/NotificationBell";
import { LimitBadge, CodexLimitBadge } from "../screens/LimitIndicator";
import { UpdateBadge, ReloadBadge } from "../screens/UpdateIndicator";
import { AccountMenu } from "../auth/AccountMenu";
import { useResponsiveTier } from "./responsive";
// Dari `../ui-state/hooks`, BUKAN barrel `../ui-state`: barrel itu memuat ResetViewButton
// yang mengimpor komponen DS, dan lewat sana `ds → shell → ui-state → ds` jadi lingkaran impor.
import { useScrollRestore } from "../ui-state/hooks";

// Setiap key WAJIB punya cabang `section === …` di App.tsx. Bila tidak, `screen` tetap
// null dan App merender kosong — sidebar ikut hilang, pengguna terjebak sampai reload.
// `runs` dan `triggers` pernah begitu: screen-nya lenyap bersama subsistem run (SPEC-162),
// entri navnya tertinggal. Kontraknya kini dijaga test: `src/test/changelog-nav.test.tsx`.
export type NavItem = { key: string; label: string; icon: string };
export const HN_NAV: NavItem[] = [
  { key: "overview", label: "Overview", icon: "layout-dashboard" },
  { key: "dalang", label: "Dalang Hanoman", icon: "drama" },   // panggung orkestrasi sinematik
  { key: "projects", label: "Projects", icon: "layout-grid" },
  { key: "prd", label: "PRD", icon: "scroll-text" },
  { key: "backlog", label: "Backlog", icon: "list-checks" },
  { key: "triage", label: "Triase", icon: "inbox" },
  { key: "scheduler", label: "Scheduler", icon: "calendar-clock" },
  { key: "lead", label: "Lead", icon: "compass" },   // SPEC-409 · ADR-0091 · hanoman-lead
  { key: "terminal", label: "Terminal", icon: "terminal" },
  { key: "ide", label: "IDE", icon: "code-2" },
  { key: "vps", label: "VPS", icon: "server" },
  { key: "docs", label: "Docs · SoT", icon: "book-open" },
  { key: "changelog", label: "Changelog", icon: "megaphone" },   // SPEC-519 · rilis untuk pemakai
  { key: "settings", label: "Settings", icon: "settings" },
];

// SPEC-740 · ADR-0115 · gerbang bagi `section` yang dipulihkan dari storage: hanya halaman
// bernavigasi yang boleh jadi titik mendarat. `project`/`review` bergantung pada state
// transien (`proj`/`review`) yang tak ikut dipulihkan — memulihkannya = mendarat di layar
// kosong; key mati (`runs`/`triggers`) membuat App merender kosong berikut sidebar-nya.
export const NAV_KEYS: string[] = HN_NAV.map((n) => n.key);

function HnWordmark() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: "var(--radius-sm)",
          background: "var(--accent)", color: "var(--ink-900)",
        }}>
          <Mark id="buntut" size={17} color="#fff" />
        </span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 500,
          letterSpacing: "-0.01em", color: "var(--text-strong)",
        }}>
          hanoman
        </span>
      </div>
    </div>
  );
}

function HnSidebarItem({ item, active, onNavigate }: { item: NavItem; active?: string; onNavigate?: (key: string) => void }) {
  const on = active === item.key;
  const [hover, setHover] = React.useState(false);
  const interactive = !!onNavigate;
  return (
    <button
      type="button"
      onClick={interactive ? () => onNavigate!(item.key) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-current={on ? "page" : undefined}
      aria-label={item.label}
      title={item.label}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        minHeight: 44, padding: "8px 10px", cursor: interactive ? "pointer" : "default",
        borderRadius: "var(--radius-sm)", textAlign: "left",
        border: "none",
        background: on ? "var(--brass-100)" : (hover && interactive ? "var(--bone-200)" : "transparent"),
        color: on ? "var(--brass-700)" : "var(--text-body)",
        fontFamily: "var(--font-ui)", fontSize: "var(--text-md)",
        fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)",
        transition: "background var(--dur-fast, 120ms) ease",
      }}
    >
      <Icon name={item.icon} size={17} color={on ? "var(--accent-hover)" : "var(--text-muted)"} />
      <span className="hn-nav-label">{item.label}</span>
    </button>
  );
}

export function Shell({ active, title, breadcrumb, actions, showSearch = false, searchValue = "", onSearchChange, onNavigate, wide = false, children }:
  { active?: string; title?: React.ReactNode; breadcrumb?: React.ReactNode; actions?: React.ReactNode;
    showSearch?: boolean; searchValue?: string; onSearchChange?: (v: string) => void;
    onNavigate?: (key: string) => void; wide?: boolean; children?: React.ReactNode }) {
  // SPEC-740 · ADR-0115 · scroll tingkat-halaman dipulihkan dari SATU titik: tiap layar —
  // termasuk yang belum ada — ikut dapat perilakunya tanpa menyentuh kodenya. Kunci per
  // `active` supaya posisi Backlog tak terbawa ke Triase.
  const mainRef = useScrollRestore(`page@${active ?? "-"}`, "scroll");
  const tier = useResponsiveTier();
  const mobile = tier === "mobile";
  const [navOpen, setNavOpen] = React.useState(false);
  const navRef = React.useRef<HTMLElement>(null);
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const columnRef = React.useRef<HTMLDivElement>(null);
  const restoreNavFocus = React.useRef(false);

  const closeNavigation = React.useCallback((restoreFocus = true) => {
    restoreNavFocus.current = restoreFocus;
    setNavOpen(false);
  }, []);

  React.useLayoutEffect(() => {
    navRef.current?.toggleAttribute("inert", mobile && !navOpen);
    columnRef.current?.toggleAttribute("inert", mobile && navOpen);
  }, [mobile, navOpen]);

  React.useLayoutEffect(() => {
    if (!mobile || !navOpen) return;
    navRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [mobile, navOpen]);

  React.useLayoutEffect(() => {
    if (navOpen || !restoreNavFocus.current) return;
    restoreNavFocus.current = false;
    toggleRef.current?.focus();
  }, [navOpen]);

  React.useEffect(() => {
    if (!mobile || !navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNavigation();
        return;
      }
      if (event.key !== "Tab" || !navRef.current) return;
      const controls = Array.from(navRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeNavigation, mobile, navOpen]);

  React.useEffect(() => {
    if (!mobile) setNavOpen(false);
  }, [mobile]);

  return (
    <div className="hn-shell" data-layout={tier} data-nav-open={navOpen ? "true" : "false"}>
      {mobile && navOpen && (
        <button className="hn-shell-backdrop" type="button" aria-label="Tutup navigasi" onClick={() => closeNavigation()} />
      )}
      <aside ref={navRef} id="hn-primary-navigation" className="hn-shell-sidebar" aria-hidden={mobile && !navOpen ? "true" : undefined}>
        <div className="hn-shell-wordmark"><HnWordmark /></div>

        <div className="hn-eyebrow hn-shell-workspace">Workspace</div>
        <nav className="hn-shell-nav" aria-label="Navigasi utama">
          {HN_NAV.map((n) => (
            <HnSidebarItem
              key={n.key}
              item={n}
              active={active}
              onNavigate={onNavigate ? (key) => {
                onNavigate(key);
                if (mobile) closeNavigation();
              } : undefined}
            />
          ))}
        </nav>
      </aside>

      <div ref={columnRef} className="hn-shell-column" aria-hidden={mobile && navOpen ? "true" : undefined}>
        <header className="hn-shell-topbar">
          <button
            ref={toggleRef}
            className="hn-shell-menu"
            type="button"
            aria-label="Buka navigasi"
            aria-controls="hn-primary-navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="hn-shell-heading">
            {breadcrumb && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", marginBottom: 1 }}>
                {breadcrumb}
              </div>
            )}
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600,
              letterSpacing: "-0.02em", color: "var(--text-strong)", lineHeight: 1.1,
            }}>
              {title}
            </div>
          </div>
          <div className="hn-shell-tools">
            {showSearch && (
              <Input className="hn-shell-search" placeholder="mis. hanoman atau erp" leftIcon="search" size="sm"
                value={searchValue}
                onChange={onSearchChange ? (e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value) : undefined}
                readOnly={!onSearchChange} />
            )}
            <UpdateBadge />
            <ReloadBadge />
            <NotificationBell />
            <LimitBadge />
            <CodexLimitBadge />
            {actions}
            <AccountMenu />
          </div>
        </header>

        {/* Content. `minHeight: 100%` (bukan `height`), supaya layar yang isinya lebih
            tinggi dari viewport tetap tumbuh dan digulir <main> — kalau `height`, anak-anaknya
            jadi flex item bertinggi tetap dan ikut menyusut. Layar berdaftar memilih ikut
            rantai ini dengan LIST_SCREEN_STYLE di root-nya; sisanya berperilaku seperti dulu.
            `border-box` wajib: tanpa itu padding menambah tinggi di atas 100% dan menciptakan
            scrollbar kedua. */}
        <main ref={mainRef} data-testid="shell-main" className="hn-shell-main">
          <div className="hn-shell-content" style={{ maxWidth: wide ? "none" : "var(--content-max)" }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
