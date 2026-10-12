// Pengaturan · shell tipis (Audit UI/UX 2026-10 · Fase 3C). Empat niat (intent):
//   Sesi harian · Agen & model · Integrasi & akses · Lanjutan (tertutup default).
// Isi tiap bagian ada di screens/settings/**. Di sini hanya: store snapshot, pilihan bagian (persist
// `settings/tab`, ADR-0115, plus deep link `#bagian=<kunci>`), navigasi, dan "Cari pengaturan".
import React from "react";
import "./styles/settings.css";
import { Icon, Select, StateBlock, useResponsiveTier } from "../ds";
import type { ShowToast } from "../ds";
import { api } from "../api/client";
import { failureMessage } from "../lib/report-error";
import type { Setting, UserView } from "@hanoman/shared";
import { usePersistedState, isStr } from "../ui-state";
import { ClientAccessPanel } from "./ClientAccessPanel";
import { RemoteControlPanel } from "./RemoteControlPanel";
import {
  DEFAULT_SECTION, SETTINGS_INTENTS, intentOf, normalizeSection, readHashSection, sectionPath,
  type CodexVersionState, type SectionDef, type SectionKey,
} from "./settings/model";
import { useSettingsStore } from "./settings/useSettingsStore";
import { SettingsSearch, searchSections, useSettingsFilter } from "./settings/SettingsSearch";
import { SessionSettings } from "./settings/SessionSettings";
import { AgentsModels } from "./settings/AgentsModels";
import { TelegramSection, WebhookSection } from "./settings/Integrations";
import { AgentAccessPanel } from "./settings/AgentAccess";
import { DeviceTokensPanel } from "./settings/DeviceTokens";
import {
  AccountPanel, ActivityPanel, ConfigPanel, CustomAgentCard, DangerZone, SetupPanel, UsersPanel,
} from "./settings/Advanced";

// Dipakai pemanggil lama (dan test) yang mengimpornya dari berkas ini.
export { AgentAccessPanel, DeviceTokensPanel };

/** Bagian yang membaca snapshot settings: tampil loading/galat sampai GET /settings berhasil. */
const NEEDS_SETTINGS: ReadonlySet<SectionKey> = new Set<SectionKey>(["sesi", "model", "telegram", "zona-bahaya"]);

/** Pemilih mobile: semua bagian dengan awalan niatnya ("Integrasi & akses · Telegram"). */
const SECTION_OPTIONS = SETTINGS_INTENTS.flatMap((intent) =>
  intent.sections.map((sec) => ({ value: sec.key, label: sectionPath(sec.key) })));

export function SettingsScreen({ onToast, me, onLoggedOut }:
  { onToast?: ShowToast; me: UserView; onLoggedOut: () => void }) {
  const store = useSettingsStore(onToast);
  const tier = useResponsiveTier();
  const mobile = tier === "mobile";
  // SPEC-740 · ADR-0115 · bagian aktif bertahan; refresh tak melempar balik ke bagian awal.
  const [persisted, setPersisted] = usePersistedState<string>("settings", "tab", DEFAULT_SECTION, isStr);
  const section = normalizeSection(persisted);
  const intent = intentOf(section);
  // Deep link `/settings#bagian=telegram` (tanpa route baru). Hanya dibaca saat dibuka, supaya
  // navigasi biasa tak meninggalkan hash yang ikut terbawa ke layar berikutnya.
  React.useEffect(() => {
    const fromHash = readHashSection(window.location.hash);
    if (fromHash) setPersisted(fromHash);
  }, []);

  // Versi codex CLI untuk peringatan LUNAK. Galatnya tampil sebagai toast; layar tak boleh gagal render.
  const [codexVer, setCodexVer] = React.useState<CodexVersionState | null>(null);
  React.useEffect(() => {
    api.getCodexVersion().then(setCodexVer)
      .catch((e: unknown) => onToast?.(failureMessage("membaca versi Codex CLI", e), "err", "alert-triangle"));
  }, []);

  // Niat "Lanjutan" tertutup secara default; terbuka saat bagian aktifnya memang ada di dalamnya.
  const [lanjutanOpen, setLanjutanOpen] = React.useState(intent.key === "lanjutan");
  React.useEffect(() => { if (intent.key === "lanjutan") setLanjutanOpen(true); }, [intent.key]);

  const navigate = (key: SectionKey) => setPersisted(key);

  // "Cari pengaturan": filter DOM bagian yang tampil + daftar bagian yang cocok lintas bagian.
  const [query, setQuery] = React.useState("");
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const shown = useSettingsFilter(bodyRef, query, section);
  const hits = React.useMemo(() => searchSections(query), [query]);

  const s = store.s;
  const settingsReady = !NEEDS_SETTINGS.has(section) || s !== null;
  let content: React.ReactNode;
  if (!settingsReady) {
    content = store.failed
      ? <StateBlock kind="error" title="Gagal memuat pengaturan"
          hint="Pengaturan tidak ditampilkan agar tidak menimpa nilai di server." action={store.load} />
      : <StateBlock kind="loading" title="Memuat pengaturan…" />;
  } else {
    content = renderSection(section, s, { store, onToast, codexVer, onLoggedOut, me, onNavigate: navigate });
  }

  return (
    <div className="hn-settings" data-layout={tier}>
      <SettingsSearch value={query} onChange={setQuery} hits={hits} onPick={(key) => navigate(key)} />
      <div className="hn-settings-layout" data-layout={tier}>
        {mobile ? (
          <Select aria-label="Bagian pengaturan" value={section} className="hn-set-full"
            options={SECTION_OPTIONS}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => navigate(normalizeSection(e.target.value))} />
        ) : (
          <nav aria-label="Navigasi pengaturan" className="hn-set-nav">
            {SETTINGS_INTENTS.map((it) => {
              const active = it.key === intent.key;
              if (it.collapsible) {
                return (
                  <div key={it.key} className="hn-set-navgroup">
                    <button type="button" className="hn-set-nav-item" aria-expanded={lanjutanOpen}
                      aria-controls={lanjutanOpen ? "hn-set-lanjutan" : undefined} onClick={() => setLanjutanOpen((o) => !o)}>
                      <Icon name={it.icon} size={16} color="var(--text-subtle)" />
                      <span className="hn-set-nav-label">{it.label}</span>
                      <span className="hn-set-chev" aria-hidden="true">{lanjutanOpen ? "▾" : "▸"}</span>
                    </button>
                    {lanjutanOpen && (
                      <div id="hn-set-lanjutan" className="hn-set-sub">
                        {it.sections.map((sec) => <SectionButton key={sec.key} sec={sec} active={section} onPick={navigate} />)}
                      </div>
                    )}
                  </div>
                );
              }
              if (it.sections.length === 1) {
                const only = it.sections[0]!;
                return <SectionButton key={it.key} sec={only} active={section} onPick={navigate} />;
              }
              return (
                <div key={it.key} className="hn-set-navgroup">
                  <button type="button" className={`hn-set-nav-item${active ? " hn-set-nav-item--parent" : ""}`}
                    onClick={() => { if (!active) navigate(it.sections[0]!.key); }}>
                    <Icon name={it.icon} size={16} color="var(--text-subtle)" />
                    <span className="hn-set-nav-label">{it.label}</span>
                  </button>
                  {active && (
                    <div className="hn-set-sub">
                      {it.sections.map((sec) => <SectionButton key={sec.key} sec={sec} active={section} onPick={navigate} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        )}
        <div className="hn-set-main">
          {query.trim() !== "" && settingsReady && shown === 0 && (
            <div className="hn-set-nomatch" role="status">
              Tak ada pengaturan di bagian ini yang cocok dengan “{query.trim()}”.
              {hits.length > 0 && " Lihat bagian yang cocok di atas."}
            </div>
          )}
          <div className="hn-set-body" ref={bodyRef} data-section={section}>{content}</div>
        </div>
      </div>
    </div>
  );
}

/** Tombol satu bagian di navigasi. `aria-current` menandai bagian yang sedang tampil. */
function SectionButton({ sec, active, onPick }: { sec: SectionDef; active: SectionKey; onPick: (key: SectionKey) => void }) {
  const on = sec.key === active;
  return (
    <button type="button" className={`hn-set-nav-item${on ? " hn-set-nav-item--on" : ""}`}
      aria-current={on ? "page" : undefined} onClick={() => onPick(sec.key)}>
      <Icon name={sec.icon} size={14} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
      <span className="hn-set-nav-label">{sec.label}</span>
    </button>
  );
}

type RenderCtx = {
  store: ReturnType<typeof useSettingsStore>;
  onToast?: ShowToast;
  codexVer: CodexVersionState | null;
  onLoggedOut: () => void;
  me: UserView;
  onNavigate: (key: SectionKey) => void;
};

/** Isi satu bagian. Bagian yang butuh snapshot hanya dirender setelah `s` ada (lihat `settingsReady`). */
function renderSection(section: SectionKey, s: Setting | null, ctx: RenderCtx): React.ReactNode {
  const { store, onToast, codexVer, onLoggedOut, me } = ctx;
  switch (section) {
    case "sesi":
      return s ? <SessionSettings s={s} store={store} onToast={onToast} codexVer={codexVer} /> : null;
    case "model":
      return s ? <AgentsModels s={s} store={store} onToast={onToast} codexVer={codexVer} onNavigate={ctx.onNavigate} /> : null;
    case "telegram":
      return s ? <TelegramSection s={s} store={store} onToast={onToast} codexVer={codexVer} /> : null;
    case "zona-bahaya":
      return <DangerZone s={s} store={store} onToast={onToast} />;
    case "agent":
      return <AgentAccessPanel onToast={onToast} />;
    case "webhook":
      return <WebhookSection onToast={onToast} />;
    case "akses-klien":
      return <ClientAccessPanel onToast={onToast} />;
    case "perangkat":
      return <DeviceTokensPanel onToast={onToast} />;
    case "kendali-jarak-jauh":
      return <RemoteControlPanel onToast={onToast} />;
    case "akun":
      return <AccountPanel me={me} onLoggedOut={onLoggedOut} onToast={onToast} />;
    case "users":
      return <UsersPanel me={me} onToast={onToast} />;
    case "setup":
      return <SetupPanel />;
    case "konfigurasi":
      return <ConfigPanel onToast={onToast} />;
    case "aktivitas":
      return <ActivityPanel onToast={onToast} />;
    case "custom-agent":
      return <CustomAgentCard runtime={s?.agent} onToast={onToast} />;
  }
}
