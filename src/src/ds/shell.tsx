/* Ported from .prototype/app/Shell.jsx — sidebar + topbar chrome.
   ESM + typed; window globals removed. No visual change. */
import React from "react";
import { Icon } from "./icon";
import { Input } from "./components/forms";
import { Mark } from "./marks";
import { NotificationBell } from "../notifications/NotificationBell";
import { LimitBadge, CodexLimitBadge } from "../screens/LimitIndicator";
import { UpdateBadge } from "../screens/UpdateIndicator";
import { AccountMenu } from "../auth/AccountMenu";
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
    <div
      onClick={interactive ? () => onNavigate!(item.key) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "8px 10px", cursor: interactive ? "pointer" : "default",
        borderRadius: "var(--radius-sm)", textAlign: "left",
        background: on ? "var(--brass-100)" : (hover && interactive ? "var(--bone-200)" : "transparent"),
        color: on ? "var(--brass-700)" : "var(--text-body)",
        fontFamily: "var(--font-ui)", fontSize: "var(--text-md)",
        fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)",
        transition: "background var(--dur-fast, 120ms) ease",
      }}
    >
      <Icon name={item.icon} size={17} color={on ? "var(--accent-hover)" : "var(--text-muted)"} />
      {item.label}
    </div>
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
  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--surface-page)", color: "var(--text-body)" }}>
      {/* Sidebar */}
      <aside style={{
        width: "var(--sidebar-w)", flex: "0 0 auto", display: "flex", flexDirection: "column",
        borderRight: "1px solid var(--border-hair)", background: "var(--bone-100)",
        padding: "18px 14px",
      }}>
        <div style={{ padding: "2px 4px 20px" }}><HnWordmark /></div>

        <div className="hn-eyebrow" style={{ padding: "0 10px 8px" }}>Workspace</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {HN_NAV.map((n) => <HnSidebarItem key={n.key} item={n} active={active} onNavigate={onNavigate} />)}
        </nav>
      </aside>

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <header style={{
          height: "var(--topbar-h)", flex: "0 0 auto", display: "flex", alignItems: "center",
          gap: 16, padding: "0 22px", borderBottom: "1px solid var(--border-hair)",
          background: "color-mix(in srgb, var(--bone-100) 80%, transparent)",
          backdropFilter: "blur(8px)",
          // backdropFilter bikin stacking context: tanpa ini popover Notifikasi/Limit terjebak
          // di konteks header dan tertimpa konten <main>. z 90: di atas isi halaman, di bawah
          // overlay terminal fullscreen (100), Modal (150), Toast (200).
          position: "relative", zIndex: 90,
        }}>
          <div style={{ minWidth: 0 }}>
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
          <div style={{ flex: 1 }} />
          {showSearch && (
            <Input placeholder="mis. hanoman atau erp" leftIcon="search" size="sm" style={{ width: 220 }}
              value={searchValue}
              onChange={onSearchChange ? (e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value) : undefined}
              readOnly={!onSearchChange} />
          )}
          {/* Muncul hanya saat ada versi baru; self-fetch via useUpdate (SPEC-214). */}
          <UpdateBadge />
          <NotificationBell />
          {/* Selalu tampil di semua layar; self-fetch via useLimits — 9 call-site <Shell> tak berubah. */}
          <LimitBadge />
          {/* SPEC-338 · badge limit codex, self-fetch via useCodexLimits. Merender null sampai ada
              snapshot codex pertama, jadi operator yang hanya memakai claude tak melihat apa pun. */}
          <CodexLimitBadge />
          {actions}
          {/* SPEC-216 · akun + logout, anchor kanan-jauh. Konsumsi AuthContext (default aman:
              user null → tak merender), jadi 9 call-site <Shell> tetap tanpa prop baru. */}
          <AccountMenu />
        </header>

        {/* Content. `minHeight: 100%` (bukan `height`), supaya layar yang isinya lebih
            tinggi dari viewport tetap tumbuh dan digulir <main> — kalau `height`, anak-anaknya
            jadi flex item bertinggi tetap dan ikut menyusut. Layar berdaftar memilih ikut
            rantai ini dengan LIST_SCREEN_STYLE di root-nya; sisanya berperilaku seperti dulu.
            `border-box` wajib: tanpa itu padding menambah tinggi di atas 100% dan menciptakan
            scrollbar kedua. */}
        <main ref={mainRef} data-testid="shell-main" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <div style={{ maxWidth: wide ? "none" : "var(--content-max)", margin: "0 auto",
            padding: "24px 28px 32px", boxSizing: "border-box", minHeight: "100%",
            display: "flex", flexDirection: "column" }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
