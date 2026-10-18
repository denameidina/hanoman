/* Ported from .prototype/app/Shell.jsx — sidebar + topbar chrome.
   ESM + typed; window globals removed. No visual change. */
import React from "react";
import "../styles/app-shell.css";
import { Icon } from "./icon";
import { Input } from "./components/forms";
import { Mark } from "./marks";
import { NotificationBell } from "../notifications/NotificationBell";
import { LimitBadge, CodexLimitBadge, AntigravityLimitBadge } from "../screens/LimitIndicator";
import { UpdateBadge, ReloadBadge } from "../screens/UpdateIndicator";
import { AccountMenu } from "../auth/AccountMenu";
import { useResponsiveTier } from "./responsive";
import { pendingLabel, type PendingCounts } from "@hanoman/shared";
// Dari `../ui-state/hooks`, BUKAN barrel `../ui-state`: barrel itu memuat ResetViewButton
// yang mengimpor komponen DS, dan lewat sana `ds → shell → ui-state → ds` jadi lingkaran impor.
import { useScrollRestore, usePersistedState } from "../ui-state/hooks";
import { openPalette } from "../palette/ui-store";
import { ProjectScopeContext, ProjectSwitcher, PROJECT_SCOPED_KEYS, scopeProjectName } from "../palette/ProjectSwitcher";
import { isMacPlatform, paletteShortcutLabel } from "../palette/shortcuts";
import { HN_GROUPS, HN_HUBS, hubBadge, hubOf, hubTarget, tabOf, tabsOf, type NavHub } from "../nav-hubs";

// `HN_NAV` = SEMUA rute yang valid (parseRoute, palet, shortcut `g`). Sidebar TIDAK lagi merender
// daftar ini mentah: ia merender `HN_HUBS` (ADR-0205), dan tiap section yang tak punya hub hanya
// bisa dicapai lewat palet (`PALETTE_ONLY_SECTIONS`). Kontrak "tak ada section yatim" dijaga
// `src/src/nav-hubs.test.ts`.
//
// Setiap key WAJIB punya cabang `section === …` di App.tsx. Bila tidak, `screen` tetap
// null dan App merender kosong — sidebar ikut hilang, pengguna terjebak sampai reload.
// `runs` dan `triggers` pernah begitu: screen-nya lenyap bersama subsistem run (SPEC-162),
// entri navnya tertinggal. Kontraknya kini dijaga test: `src/test/nav-pending-badge.test.tsx`.
export type NavItem = { key: string; label: string; icon: string; gate?: string };
export const HN_NAV: NavItem[] = [
  { key: "overview", label: "Overview", icon: "layout-dashboard" },
  { key: "dalang", label: "Dalang Hanoman", icon: "drama" },   // panggung orkestrasi sinematik
  { key: "projects", label: "Projects", icon: "layout-grid" },
  { key: "prd", label: "PRD", icon: "scroll-text" },
  { key: "backlog", label: "Backlog", icon: "list-checks" },
  // SPEC-946 · ADR-0150 · papan kerja MANUSIA. Kolomnya `Task.status`, bukan `Spec.stage` —
  // papan LAIN, bukan mode kedua board Backlog.
  { key: "team", label: "Tim", icon: "users" },
  // Workspace QA · laporan QA per project (test case, temuan, lampiran) → perbaikan project.
  { key: "qa", label: "QA", icon: "clipboard-check" },
  // ADR-0181 · memori project bersama: antrean review, aktif, arsip. Key = kunci PendingCounts.
  { key: "triage", label: "Triase", icon: "inbox" },
  { key: "scheduler", label: "Scheduler", icon: "calendar-clock" },
  { key: "lead", label: "Lead", icon: "compass" },   // SPEC-409 · ADR-0091 · hanoman-lead
  { key: "terminal", label: "Terminal", icon: "terminal" },
  { key: "ide", label: "IDE", icon: "code-2" },
  // Skills library · skill global hanoman/user/plugin + skill per project dalam satu halaman.
  { key: "skills", label: "Skills", icon: "sparkles" },
  { key: "vps", label: "VPS", icon: "server" },
  // SPEC-919 · ADR-0147 · device yang sinkron ke hub ini + sesi hidupnya. Digerbangi supaya
  // instalasi satu mesin (nol device token) tak berubah tampilannya sama sekali.
  { key: "clients", label: "Klien", icon: "monitor", gate: "clients" },
  { key: "docs", label: "Docs · SoT", icon: "book-open" },
  { key: "settings", label: "Settings", icon: "settings" },
];

// SPEC-740 · ADR-0115 · gerbang bagi `section` yang dipulihkan dari storage: hanya halaman
// bernavigasi yang boleh jadi titik mendarat. `project`/`review` bergantung pada state
// transien (`proj`/`review`) yang tak ikut dipulihkan — memulihkannya = mendarat di layar
// kosong; key mati (`runs`/`triggers`) membuat App merender kosong berikut sidebar-nya.
export const NAV_KEYS: string[] = HN_NAV.map((n) => n.key);

function HnWordmark() {
  return (
    <div className="hn-wordmark-stack">
      <div className="hn-wordmark-row">
        <span className="hn-wordmark-mark">
          <Mark id="buntut" size={17} color="#fff" />
        </span>
        <span className="hn-wordmark-text">
          hanoman
        </span>
      </div>
    </div>
  );
}

/* SPEC-961 · angka "butuh pengajuan" per entri nav, berkunci `NavItem.key`. Context dengan alasan
   yang sama persis seperti `NavGate` di bawah: `Shell` dirender di belasan cabang `App`, dan prop
   baru di semuanya adalah undangan bagi cabang yang terlewat — cabang begitu tak akan error, ia
   hanya kehilangan badge-nya, senyap. `null` = belum ada frame (server lama, ADR-0087) dan sengaja
   berbeda dari nol: yang pertama tak merender apa pun, yang kedua juga tak merender apa pun tetapi
   karena memang tak ada yang menunggu. */
export const NavPending = React.createContext<PendingCounts | null>(null);

/* Maskot pet dibuat SEKALI di App dan disalurkan lewat konteks ini, lalu Shell yang menaruhnya di slot-nya:
   footer sidebar di desktop, lajur di bawah kolom di tablet dan ponsel. Konteks, bukan portal, sebab pet
   harus tetap berdiri di tempat yang sama di DOM selama Shell hidup — navigasi antar-layar tak boleh
   melahirkannya kembali. Nilai `null` = pet mati atau layar tanpa Shell (Dalang). */
export const PetDockContext = React.createContext<React.ReactNode>(null);

function HnNavBadge({ count }: { count: number }) {
  return (
    // `aria-hidden`: angkanya SUDAH masuk ke nama tombolnya (`aria-label` di bawah). Tanpa ini
    // pembaca layar menyebutkan "3" dua kali — sekali sebagai nama, sekali sebagai isi.
    <span className="hn-nav-badge" data-testid="nav-badge" aria-hidden="true">
      {pendingLabel(count)}
    </span>
  );
}

/* ADR-0205 · satu entri sidebar = satu hub. `target` sudah diselesaikan pemanggil (tab terakhir di hub
   itu, atau default), jadi klik cukup meneruskannya ke App seperti sebelumnya. */
/* Susunan dan keadaan item (aktif, hover) hidup di `.hn-nav-item` (app.css), bukan di inline style: rail tablet
   mengubahnya jadi ikon di atas label kecil, dan hover lewat `:hover` (tanpa state React per baris). */
function HnHubItem({ hub, on, target, badge, onNavigate }:
  { hub: NavHub; on: boolean; target: string; badge?: number; onNavigate?: (key: string) => void }) {
  const interactive = !!onNavigate;
  // Angka ikut ke dalam nama yang dibacakan & tooltip: di lebar tablet label-nya tampil kecil di bawah
  // ikon, dan badge-nya hanya angka di pojok; tanpa ini pembaca layar tak mendengar tiga yang menunggu.
  const name = badge ? `${hub.label}, ${badge} butuh pengajuan` : hub.label;
  return (
    <button
      type="button"
      className="hn-nav-item"
      data-interactive={interactive ? "true" : undefined}
      onClick={interactive ? () => onNavigate!(target) : undefined}
      aria-current={on ? "page" : undefined}
      aria-label={name}
      title={name}
    >
      <Icon name={hub.icon} size={17} color={on ? "var(--accent-hover)" : "var(--text-muted)"} />
      <span className="hn-nav-label">{hub.label}</span>
      {badge !== undefined && <HnNavBadge count={badge} />}
    </button>
  );
}

/* ADR-0205 · ingatan tab terakhir per hub (hub key → section). Dibaca dan ditulis hanya oleh Shell:
   klik hub kembali ke tab yang terakhir dibuka di hub itu, dan itu cukup — tak perlu state di App. */
const isLastTab = (v: unknown): v is Record<string, string> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

/* SPEC-919 · gerbang nav berbasis kemampuan instance. Context, bukan prop: `Shell` dirender di
   belasan cabang `App`, dan menambah prop ke semuanya adalah undangan bagi cabang yang terlewat.
   Default kosong = entri bergerbang TERSEMBUNYI — layar yang tak menyediakan gerbangnya tak
   pernah menampilkan halaman yang tak bisa ia isi. */
export const NavGate = React.createContext<Record<string, boolean>>({});

/* Cue gulir daftar hub (QA run3: di viewport pendek "Pengaturan" tak terlihat dan tak ada tanda bahwa daftarnya
   masih berlanjut). Tepi daftar hanya diberi gradasi saat ia meluap dan tepinya belum sampai ujung — sama dengan
   `.hn-tabs` (ds/components/ui.tsx). Dihitung dari scroll dan ukuran kotak, bukan dari jumlah hub. */
type NavEdges = { start: boolean; end: boolean };
function useNavCue(ref: React.RefObject<HTMLElement>): NavEdges {
  const [edges, setEdges] = React.useState<NavEdges>({ start: false, end: false });
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const next = { start: el.scrollTop > 1, end: max > 1 && el.scrollTop < max - 1 };
    setEdges((cur) => (cur.start === next.start && cur.end === next.end ? cur : next));
  }, [ref]);
  // Tanpa deps: isi daftar bisa berubah tanpa mengubah ukuran kotaknya (gerbang klien, badge). `setEdges`
  // dengan nilai yang sama tak me-render ulang, jadi mengukur di tiap render Shell itu murah.
  React.useLayoutEffect(() => { measure(); });
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

// Audit UI/UX 2026-10 · skip link. Tak ada kelas `:focus` untuk ini di DS, jadi gayanya berpindah
// lewat state fokus: tersembunyi secara visual (tetap terbaca pembaca layar), muncul saat menerima fokus.
const SKIP_LINK_HIDDEN: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap",
};
const SKIP_LINK_SHOWN: React.CSSProperties = {
  position: "fixed", left: 12, top: 12, zIndex: 300, padding: "8px 12px",
  borderRadius: "var(--radius-sm)", background: "var(--surface-card)", color: "var(--text-strong)",
  border: "1px solid var(--border-hair)", boxShadow: "var(--shadow-md)",
  fontFamily: "var(--font-ui)", fontSize: 13, textDecoration: "none",
};

export function Shell({ active, title, breadcrumb, actions, showSearch = false, searchValue = "", onSearchChange, onNavigate, wide = false, children }:
  { active?: string; title?: React.ReactNode; breadcrumb?: React.ReactNode; actions?: React.ReactNode;
    showSearch?: boolean; searchValue?: string; onSearchChange?: (v: string) => void;
    onNavigate?: (key: string) => void; wide?: boolean; children?: React.ReactNode }) {
  const [skipShown, setSkipShown] = React.useState(false);
  // SPEC-740 · ADR-0115 · scroll tingkat-halaman dipulihkan dari SATU titik: tiap layar —
  // termasuk yang belum ada — ikut dapat perilakunya tanpa menyentuh kodenya. Kunci per
  // `active` supaya posisi Backlog tak terbawa ke Triase.
  const gates = React.useContext(NavGate);
  // Project switcher tunggal (Fase 2C): hanya layar yang benar-benar membaca `projectFilter` yang
  // menampilkannya, dan nama scope-nya ikut ke breadcrumb agar pengguna tahu apa yang tersaring.
  const scope = React.useContext(ProjectScopeContext);
  const scoped = !!scope && PROJECT_SCOPED_KEYS.has(active ?? "");
  const scopeName = scoped && scope ? scopeProjectName(scope) : undefined;
  // ADR-0205 · hub yang memuat layar ini dan tab-nya. Crumb "Hub › Tab" hanya bagi hub yang punya
  // lebih dari satu tab yang tampil: hub berisi satu layar (Overview, Triase, Skills) tak butuh crumb.
  const pendingCounts = React.useContext(NavPending);
  const activeHub = hubOf(active);
  const activeTab = tabOf(active);
  const [lastTab, setLastTab] = usePersistedState<Record<string, string>>("nav", "lastTab", {}, isLastTab);
  React.useEffect(() => {
    if (!activeHub || !activeTab || lastTab[activeHub.key] === activeTab) return;
    setLastTab((cur) => ({ ...cur, [activeHub.key]: activeTab }));
  }, [active]);
  const visibleTabs = activeHub ? tabsOf(activeHub, gates) : [];
  const hubCrumb = activeHub && visibleTabs.length > 1
    ? [activeHub.label, visibleTabs.find((t) => t.section === activeTab)?.label].filter(Boolean).join(" › ")
    : undefined;
  const isMac = isMacPlatform();
  const shortcutHint = paletteShortcutLabel(isMac);
  const mainRef = useScrollRestore(`page@${active ?? "-"}`, "scroll");
  const tier = useResponsiveTier();
  const mobile = tier === "mobile";
  const crumbHub = mobile ? undefined : hubCrumb;
  const pet = React.useContext(PetDockContext);
  // Baris kedua topbar (pilihan project, kotak cari layar, aksi halaman) hanya ada bila layar memakainya.
  const hasSubrow = (scope && scoped) || showSearch || !!actions;
  const [navOpen, setNavOpen] = React.useState(false);
  const navRef = React.useRef<HTMLElement>(null);
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const columnRef = React.useRef<HTMLDivElement>(null);
  const restoreNavFocus = React.useRef(false);
  const navListRef = React.useRef<HTMLElement>(null);
  const navEdges = useNavCue(navListRef);
  // Hub yang aktif selalu terlihat di daftar yang meluap: pindah layar menggulir daftar ke barisnya saja
  // (`nearest`, tak menggeser apa pun bila ia sudah kelihatan).
  React.useEffect(() => {
    navListRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest" });
  }, [activeHub?.key]);

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
      {/* Elemen fokusable pertama di halaman: melompati navigasi langsung ke <main>. */}
      <a href="#main-content" onFocus={() => setSkipShown(true)} onBlur={() => setSkipShown(false)}
        style={skipShown ? SKIP_LINK_SHOWN : SKIP_LINK_HIDDEN}>Lewati ke konten</a>
      {mobile && navOpen && (
        <button className="hn-shell-backdrop" type="button" aria-label="Tutup navigasi" onClick={() => closeNavigation()} />
      )}
      <aside ref={navRef} id="hn-primary-navigation" className="hn-shell-sidebar" aria-hidden={mobile && !navOpen ? "true" : undefined}>
        <div className="hn-shell-wordmark"><HnWordmark /></div>

        {/* ADR-0205 · delapan hub dalam tiga grup berlabel. Grup berlabel supaya pembaca layar
            mendengar konteks tiap hub; di rail tablet labelnya disembunyikan CSS dan grup tinggal
            dipisah garis tipis, sehingga kedelapan ikon muat tanpa gulir. */}
        <nav ref={navListRef} className="hn-shell-nav" aria-label="Navigasi utama"
          data-cue-start={navEdges.start ? "true" : undefined} data-cue-end={navEdges.end ? "true" : undefined}>
          {HN_GROUPS.map((g) => (
            <div key={g.key} className="hn-nav-group" role="group" aria-labelledby={`hn-nav-group-${g.key}`}>
              <div id={`hn-nav-group-${g.key}`} className="hn-eyebrow hn-nav-group-label">{g.label}</div>
              {HN_HUBS.filter((h) => h.group === g.key).map((h) => (
                <HnHubItem
                  key={h.key}
                  hub={h}
                  on={activeHub?.key === h.key}
                  target={hubTarget(h, lastTab, gates)}
                  badge={hubBadge(h, pendingCounts, gates)}
                  onNavigate={onNavigate ? (key) => {
                    onNavigate(key);
                    if (mobile) closeNavigation();
                  } : undefined}
                />
              ))}
            </div>
          ))}
        </nav>
        {/* Footer sidebar: pet "tinggal" di sini di desktop. `:empty` di CSS menutupnya bila pet tak tampil. */}
        <div className="hn-shell-dock" data-pet-slot="sidebar">{tier === "desktop" ? pet : null}</div>
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
            {/* Di ponsel crumb disembunyikan CSS (app.css `.hn-shell-crumb`): judulnya sudah nama layar (h1) dan
                barisnya dijajar tab hub di atas konten. Crumb hub sudah dikosongkan di atas (`crumbHub`). */}
            {(crumbHub || breadcrumb || scopeName) && (
              <div className="hn-shell-crumb">
                {crumbHub && <span data-testid="hub-crumb">{crumbHub}</span>}
                {crumbHub && (breadcrumb || scopeName) ? " · " : ""}
                {/* Deskripsi layar dibungkus sendiri: teksnya tetap bisa dicari utuh (getByText) walau
                    kini berdampingan dengan crumb hub. */}
                {breadcrumb && <span>{breadcrumb}</span>}
                {scopeName && <span data-testid="scope-crumb">{breadcrumb || crumbHub ? " · " : ""}project: {scopeName}</span>}
              </div>
            )}
            {/* h1: judul layar adalah heading utama halaman. `margin: 0` menimpa base.css. */}
            <h1 className="hn-shell-title">
              {title}
            </h1>
          </div>
          {/* Baris kedua: hanya layar yang memakainya. Di desktop ia duduk di kiri kluster alat; di ponsel
              ia turun ke barisnya sendiri setinggi 40px (app.css). */}
          {hasSubrow && (
            <div className="hn-shell-subrow">
              {scope && scoped && <ProjectSwitcher scope={scope} />}
              {showSearch && (
                <Input className="hn-shell-search" aria-label="Cari" placeholder="mis. hanoman atau erp" leftIcon="search" size="sm"
                  value={searchValue}
                  onChange={onSearchChange ? (e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value) : undefined}
                  readOnly={!onSearchChange} />
              )}
              {actions}
            </div>
          )}
          <div className="hn-shell-tools">
            {/* Pintu palet perintah (⌘K). Nama "Cari" tetap milik tombol ini; kotak cari layar
                (showSearch) tetap ada untuk pencarian yang memfilter daftar. Di ponsel ia ikon saja. */}
            <button type="button" className="hn-shell-cmdk" aria-label="Cari"
              aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"} title={`Palet perintah (${shortcutHint})`}
              onClick={() => openPalette()}>
              <Icon name="search" size={16} />
              <kbd className="hn-kbd" aria-hidden="true">{shortcutHint}</kbd>
            </button>
            {/* Lencana status sekunder: di ponsel disembunyikan (tercapai dari palet dan Pengaturan). */}
            <div className="hn-topbar-extra"><UpdateBadge /></div>
            <ReloadBadge />
            <NotificationBell />
            <div className="hn-topbar-extra"><LimitBadge /><CodexLimitBadge /><AntigravityLimitBadge /></div>
            <AccountMenu />
          </div>
        </header>

        {/* Content. `minHeight: 100%` (bukan `height`), supaya layar yang isinya lebih
            tinggi dari viewport tetap tumbuh dan digulir <main> — kalau `height`, anak-anaknya
            jadi flex item bertinggi tetap dan ikut menyusut. Layar berdaftar memilih ikut
            rantai ini dengan LIST_SCREEN_STYLE di root-nya; sisanya berperilaku seperti dulu.
            `border-box` wajib: tanpa itu padding menambah tinggi di atas 100% dan menciptakan
            scrollbar kedua. */}
        <main ref={mainRef} id="main-content" tabIndex={-1} data-testid="shell-main" className="hn-shell-main">
          <div className={wide ? "hn-shell-content hn-shell-content--wide" : "hn-shell-content hn-shell-content--capped"}>
            {children}
          </div>
        </main>
        {/* Lajur pet di tablet dan ponsel: berada DI BAWAH <main>, sehingga area gulir berakhir di atasnya
            dan tak ada kontrol yang tertutup. Kosong (`:empty`) = tak memesan ruang sama sekali. */}
        <div className="hn-shell-lane" data-pet-slot="lane">{tier === "desktop" ? null : pet}</div>
      </div>
    </div>
  );
}
