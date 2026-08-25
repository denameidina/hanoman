/* SettingsScreen — workspace settings. Ported; persistence moved from
   localStorage to the API (GET/PUT /settings). Model per pipeline step. */
import React from "react";
import { Card, Switch, Select, Button, Input, Field, HnTextarea, Icon, StateBlock, Badge, Callout, ConfirmDialog, useConfirm, useResponsiveTier } from "../ds";
import { api, ApiError } from "../api/client";
import { CAPABILITY_DOMAINS, SCHEDULER_DEFAULTS, GOAL_DEFAULTS, CODEX_DEFAULTS, CONFLICT_DEFAULTS, LEAD_DEFAULTS, TELEGRAM_DEFAULTS, CHANGELOG_ENGINE_DEFAULTS, PORTAL_CHAT_DEFAULTS, CODEX_MODELS, MODELS, EFFORTS, METHODS, METHOD_IDS, DEFAULT_METHOD, resolveMethod, codexEfforts, coerceCodexEffort, codexModel, codexClientTooOld, configEntry } from "@hanoman/shared";
import type { Setting, UserView, DeviceTokenView, SessionResultView, ConfigResponse, ConfigEntryView, AgentTokenView, CapabilityInfo, TelegramGatewayStatus, TelegramCredentialsView, TelegramTestResult, MethodStatusResponse, MethodSkillStatus, SetupStatus } from "@hanoman/shared";
import type { ShowToast } from "../ds";
import { playNotifySound, type NotifySound } from "../notifications/sound";
import { CustomAgentsPanel } from "./CustomAgentsPanel";
import { ClientAccessPanel } from "./ClientAccessPanel";   // SPEC-617 · ADR-0110 · kelola akses klien
import { WebhooksPanel } from "./WebhooksPanel";
import { WebhookDocs } from "./WebhookDocs";
import { McpPanel } from "./McpPanel";   // SPEC-482 · ADR-0099 · pemasangan MCP siap salin
import { SetupWizard } from "./SetupWizard";   // SPEC-884 · ADR-0139 · setup awal, bisa diulang
import { AgentDocCard } from "./AgentDocCard";   // SPEC-489 · halaman dokumentasi AI Agent
import { usePersistedState, isStr } from "../ui-state";

// SPEC-383 · katalog claude dibaca dari @hanoman/shared — sumber yang SAMA dengan picker Start
// (App.tsx). Sebelumnya tab ini menyalinnya (`S_MODELS`/`S_EFFORT` + komentar "keep in sync"),
// jadi Settings dan Start bisa menampilkan daftar model claude yang berbeda.
const S_MODELS = MODELS.map((m) => ({ value: m.id, label: m.label }));
const S_EFFORT = EFFORTS.map((v) => ({ value: v, label: v === "xhigh" ? "x-high" : v }));
// SPEC-252 · ADR-0061 · matrix model/effort per fase (SPEC-238) dicabut — model/effort kini per SESI,
// dipilih saat Start (StartSessionModal). Yang tersisa di sini hanya default global.
// SPEC-180 · nada notifikasi backlog selesai (durasi bervariasi). "off" = senyap (toast+daftar tetap jalan).
const S_SOUNDS = [
  { value: "blip", label: "Blip · 0.1s" }, { value: "pop", label: "Pop · 0.1s" },
  { value: "short", label: "Short · 0.15s" }, { value: "ping", label: "Ping · 0.2s" },
  { value: "coin", label: "Coin · 0.3s" }, { value: "alert", label: "Alert · 0.3s" },
  { value: "medium", label: "Medium · 0.4s" }, { value: "chime", label: "Chime · 0.4s" },
  { value: "success", label: "Success · 0.4s" }, { value: "bell", label: "Bell · 0.5s" },
  { value: "marimba", label: "Marimba · 0.6s" }, { value: "long", label: "Long · 0.8s" },
  { value: "fanfare", label: "Fanfare · 0.9s" }, { value: "off", label: "Senyap" },
];
const S_DEFAULTS: Setting = {
  model: "claude-opus-5", effort: "xhigh",
  autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false,
  scheduler: SCHEDULER_DEFAULTS,   // SPEC-294 · knob scheduler (panel dibangun daun #6)
  goal: GOAL_DEFAULTS,             // SPEC-332 · ADR-0073 · mode goal (default mati)
  agent: "claude",                 // SPEC-338 · ADR-0074 · mesin sesi default
  codex: CODEX_DEFAULTS,           // SPEC-338 · ADR-0074 · model/effort codex
  verifyScope: "changed",          // SPEC-376 · ADR-0080 · uji hanya yang berubah
  method: DEFAULT_METHOD,          // SPEC-734 · ADR-0113 · metode workflow default
  conflict: CONFLICT_DEFAULTS,     // SPEC-383 · ADR-0081 · default sesi konflik (opt-in, mati)
  lead: LEAD_DEFAULTS,             // SPEC-409 · ADR-0091 · hanoman-lead (master switch mati)
  telegram: TELEGRAM_DEFAULTS,     // SPEC-476 · ADR-0096 · gateway Telegram opt-in
  changelog: CHANGELOG_ENGINE_DEFAULTS, // SPEC-518 · agen pembuat changelog (opt-in, mati)
  portalChat: PORTAL_CHAT_DEFAULTS, // SPEC-854 · ADR-0130 · chat portal klien (opt-in, mati)
  // SPEC-881 · stempel suntingan agen bawaan. Wajib di tipe `Setting` (entities.ts:374) tapi
  // terlewat di default ini, jadi `pnpm --filter ./src typecheck` merah di base sebelum SPEC-884.
  builtinAgents: {},
};

// SPEC-383 · label agen dipakai di judul grup model DAN di baris warisan kartu konflik — satu
// sumber supaya "Codex CLI" di dua tempat tak bisa berbeda.
const AGENT_LABEL: Record<"claude" | "codex", string> = { claude: "Claude Code", codex: "Codex CLI" };

// SPEC-383 · penanda blok mana yang benar-benar dipakai sesi baru. Tanpa ini judul kartu
// ("default global") terbaca sebagai klaim atas KEDUA blok, padahal `sessionAgentDefaults()`
// hanya membaca blok milik `Setting.agent`.
function AgentGroupHeader({ id, label, active }: { id: "claude" | "codex"; label: string; active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-strong)" }}>{label}</div>
      <span data-testid={`agent-badge-${id}`} style={{
        fontSize: 11, fontFamily: "var(--font-mono)", padding: "2px 7px", borderRadius: 999,
        background: active ? "var(--brass-100)" : "transparent",
        color: active ? "var(--brass-700)" : "var(--text-subtle)",
        border: active ? "none" : "1px solid var(--border-hair)",
      }}>{active ? "dipakai sesi baru" : "tidak dipakai sekarang"}</span>
    </div>
  );
}

function SettingRow({ title, desc, children, last }: { title: string; desc?: string; children?: React.ReactNode; last?: boolean }) {
  return (
    <div className="hn-setting-row" style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--border-hair)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{title}</div>
        {desc && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      <div className="hn-setting-control" style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

// SPEC-169 · Akun: email, logout, ganti password sendiri.
function AccountPanel({ me, onLoggedOut, onToast }: { me: UserView; onLoggedOut: () => void; onToast?: ShowToast }) {
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const canChange = cur.length >= 1 && next.length >= 8 && !busy;
  async function changePw() {
    if (!canChange) return;
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: cur, newPassword: next });
      setCur(""); setNext("");
      onToast?.("Password diganti · perangkat lain ter-logout", "ok", "key-round");
    } catch (e) {
      onToast?.(e instanceof ApiError && e.status === 400 ? "Password lama salah" : "Gagal ganti password", "err", "x-circle");
    } finally { setBusy(false); }
  }
  async function logout() { try { await api.logout(); } finally { onLoggedOut(); } }
  return (
    <Card eyebrow="akun" title="Akun"
      actions={<Button size="sm" variant="ghost" leftIcon="log-out" onClick={logout}>Logout</Button>}>
      <SettingRow title="Masuk sebagai" desc={me.email}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{me.id}</span>
      </SettingRow>
      <div style={{ paddingTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 10 }}>Ganti password</div>
        <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <Field label="Password lama"><Input type="password" autoComplete="current-password" placeholder="••••••••" value={cur}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCur(e.target.value)} style={{ width: "100%" }} /></Field>
          <Field label={<>Password baru <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}>· min 8</span></>}>
            <Input type="password" autoComplete="new-password" placeholder="minimal 8 karakter" value={next}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNext(e.target.value)} style={{ width: "100%" }} /></Field>
          {/* marginBottom = Field.marginBottom (kit.tsx). alignItems:end mendasarkan tombol
              ke dasar baris, tapi margin bawah Field mengangkat input 14px dari sana; tanpa
              ini tombol jatuh 14px di bawah input. */}
          <Button size="sm" leftIcon="key-round" disabled={!canChange} onClick={changePw}
            style={{ marginBottom: 14 }}>Ganti</Button>
        </div>
      </div>
    </Card>
  );
}

// SPEC-169 · Users: daftar, invite (set password langsung), hapus. Tanpa RBAC — semua setara.
function UsersPanel({ me, onToast }: { me: UserView; onToast?: ShowToast }) {
  // SPEC-847 · ADR-0127 · konfirmasi destruktif memakai dialog aplikasi, bukan window.confirm.
  const { confirm, dialog } = useConfirm();
  const [users, setUsers] = React.useState<UserView[] | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => { api.listUsers().then(setUsers).catch(() => setUsers([])); }, []);
  React.useEffect(() => { load(); }, [load]);
  const canInvite = /\S+@\S+\.\S+/.test(email) && password.length >= 8 && !busy;
  async function invite() {
    if (!canInvite) return;
    setBusy(true);
    try {
      await api.inviteUser({ email, password });
      setEmail(""); setPassword(""); load();
      onToast?.("User " + email + " diundang", "ok", "user-plus");
    } catch (e) {
      onToast?.(e instanceof ApiError && e.status === 409 ? "Email sudah dipakai" : "Gagal mengundang user", "err", "x-circle");
    } finally { setBusy(false); }
  }
  async function remove(u: UserView) {
    try {
      if (!await confirm({
        title: `Hapus user "${u.email}"?`,
        message: "User ini kehilangan akses ke dashboard seketika.",
        impact: ["Semua sesi login miliknya ikut dicabut.", "Tindakan ini tak bisa dibatalkan."],
        confirmLabel: "Hapus user",
        run: () => api.deleteUser(u.id),
      })) return;
      load(); onToast?.("User " + u.email + " dihapus", "warn", "trash-2");
    }
    catch (e) { onToast?.(e instanceof ApiError && e.status === 400 ? "Tak bisa hapus user terakhir" : "Gagal hapus user", "err", "x-circle"); }
  }
  return (
    <Card eyebrow="users" title="Users">
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Undang user lain dengan menetapkan password-nya langsung — tanpa email undangan.
      </div>
      {users === null ? <StateBlock kind="loading" compact title="Memuat users…" /> : users.map((u, i) => (
        <SettingRow key={u.id} title={u.email} last={i === users.length - 1}
          desc={"dibuat " + new Date(u.createdAt).toLocaleDateString("id-ID") + (u.id === me.id ? " · kamu" : "")}>
          <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={users.length <= 1} onClick={() => remove(u)}>Hapus</Button>
        </SettingRow>
      ))}
      <div style={{ paddingTop: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 10 }}>Invite user</div>
        <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <Field label="Email"><Input type="email" value={email} placeholder="user@nafanesia.id"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} style={{ width: "100%" }} /></Field>
          <Field label={<>Password <span style={{ fontWeight: 400, color: "var(--text-subtle)" }}>· min 8</span></>}>
            <Input type="password" autoComplete="new-password" placeholder="minimal 8 karakter" value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} style={{ width: "100%" }} /></Field>
          {/* marginBottom = Field.marginBottom — sejajarkan dasar tombol dengan dasar input (lihat AccountPanel). */}
          <Button size="sm" leftIcon="user-plus" disabled={!canInvite} onClick={invite}
            style={{ marginBottom: 14 }}>Invite</Button>
        </div>
      </div>
      {dialog}
    </Card>
  );
}

// SPEC-213 · Perangkat: device token per-device untuk auth sync ke hub. Token plaintext hanya
// ditampilkan SEKALI saat dibuat (server simpan hash). Revoke = cabut satu device, yang lain aman.
export function DeviceTokensPanel({ onToast }: { onToast?: ShowToast }) {
  const { confirm, dialog } = useConfirm();
  const [tokens, setTokens] = React.useState<DeviceTokenView[] | null>(null);
  const [name, setName] = React.useState("");
  const [fresh, setFresh] = React.useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => { api.listDeviceTokens().then(setTokens).catch(() => setTokens([])); }, []);
  React.useEffect(() => { load(); }, [load]);
  async function create() {
    if (name.trim().length < 1 || busy) return;
    setBusy(true);
    try {
      const t = await api.createDeviceToken({ name: name.trim() });
      setFresh({ name: t.name, token: t.token }); setName(""); load();
      onToast?.("Token perangkat dibuat — salin sekarang", "ok", "key-round");
    } catch { onToast?.("Gagal membuat token", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function revoke(t: DeviceTokenView) {
    try {
      if (!await confirm({
        title: `Cabut token perangkat "${t.name}"?`,
        message: "Perangkat itu tak bisa sync lagi sampai token baru dibuat.",
        confirmLabel: "Cabut token",
        icon: "key-round",
        run: () => api.revokeDeviceToken(t.id),
      })) return;
      load(); onToast?.("Token dicabut", "warn", "trash-2");
    }
    catch { onToast?.("Gagal mencabut token", "err", "x-circle"); }
  }
  const active = (tokens ?? []).filter((t) => !t.revokedAt);
  return (
    <Card eyebrow="perangkat" title="Device tokens">
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Token per-perangkat untuk menyinkronkan instance lokal ke hub (Bearer). Tempel di
        <code style={{ margin: "0 4px" }}>SYNC_DEVICE_TOKEN</code> pada instance client. Plaintext hanya tampil sekali.
      </div>
      {fresh && (
        <div style={{ padding: 12, marginBottom: 12, border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)", background: "var(--brass-100)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Token untuk “{fresh.name}” — salin sekarang, tak akan ditampilkan lagi:</div>
          <code style={{ display: "block", wordBreak: "break-all", fontSize: 12 }}>{fresh.token}</code>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(fresh.token); onToast?.("Disalin", "ok", "copy"); }}>Salin</Button>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Tutup</Button>
          </div>
        </div>
      )}
      {tokens === null ? <StateBlock kind="loading" compact title="Memuat token…" />
        : active.length === 0 ? <div style={{ fontSize: 13, color: "var(--text-subtle)", padding: "8px 0" }}>Belum ada token perangkat.</div>
        : active.map((t, i) => (
          <SettingRow key={t.id} title={t.name} last={i === active.length - 1}
            desc={"dibuat " + new Date(t.createdAt).toLocaleDateString("id-ID") + (t.lastSeenAt ? " · terlihat " + new Date(t.lastSeenAt).toLocaleString("id-ID") : " · belum dipakai")}>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => revoke(t)}>Cabut</Button>
          </SettingRow>
        ))}
      <div className="hn-grid-mobile" style={{ paddingTop: 14, display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <Field label="Nama perangkat"><Input value={name} placeholder="laptop-dena"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} style={{ width: "100%" }} /></Field>
        <Button size="sm" leftIcon="plus" disabled={name.trim().length < 1 || busy} onClick={create} style={{ marginBottom: 14 }}>Buat token</Button>
      </div>
      {dialog}
    </Card>
  );
}

// SPEC-213 · Aktivitas: activity log ringkasan hasil sesi (append-only, disync dari semua device).
function ActivityPanel({ onToast }: { onToast?: ShowToast }) {
  const { confirm, dialog } = useConfirm();
  const [projectId, setProjectId] = React.useState("");
  const [rows, setRows] = React.useState<SessionResultView[] | null>(null);
  const load = React.useCallback(() => { api.listSessionResults(projectId || undefined).then(setRows).catch(() => setRows([])); }, [projectId]);
  React.useEffect(() => { load(); }, [load]);
  async function purge() {
    if (!projectId) { onToast?.("Isi project id untuk purge", "warn", "alert-triangle"); return; }
    try {
      if (!await confirm({
        title: `Purge activity log project "${projectId}"?`,
        message: "Seluruh entri hasil sesi project ini dihapus dari device ini.",
        impact: ["Log bersifat append-only — entri yang dihapus tak bisa dipulihkan."],
        confirmLabel: "Purge",
        run: async () => {
          const r = await api.purgeSessionResults(projectId);
          onToast?.(`${r.purged} entri dihapus`, "warn", "trash-2");
        },
      })) return;
      load();
    }
    catch { onToast?.("Gagal purge", "err", "x-circle"); }
  }
  return (
    <Card eyebrow="aktivitas" title="Activity log">
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Ringkasan hasil sesi lintas device (transisi stage, commit, PR) — append-only. Filter per project.
      </div>
      <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end", marginBottom: 12 }}>
        <Field label="Project id (opsional)"><Input value={projectId} placeholder="mis. hanoman — kosong = semua project"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectId(e.target.value)} style={{ width: "100%" }} /></Field>
        <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={!projectId} onClick={purge} style={{ marginBottom: 14 }}>Purge</Button>
      </div>
      {rows === null ? <StateBlock kind="loading" compact title="Memuat aktivitas…" />
        : rows.length === 0 ? <div style={{ fontSize: 13, color: "var(--text-subtle)", padding: "8px 0" }}>Belum ada aktivitas.</div>
        : rows.map((r, i) => (
          <SettingRow key={r.id} last={i === rows.length - 1}
            title={`${r.specId ?? r.projectId}${r.oldStage && r.newStage ? ` · ${r.oldStage} → ${r.newStage}` : ""}`}
            desc={[r.status, r.commitSha ? r.commitSha.slice(0, 8) : null, r.branch, r.author, new Date(r.createdAt).toLocaleString("id-ID")].filter(Boolean).join(" · ")}>
            {r.prUrl && <a href={r.prUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" leftIcon="external-link">PR</Button></a>}
          </SettingRow>
        ))}
      {dialog}
    </Card>
  );
}

// SPEC-215 · atur env non-bootstrap via Settings. Secret: mask + "Ganti"; bootstrap read-only.
const GROUP_LABEL: Record<string, string> = {
  sync: "Sync", claude: "Claude", vps: "VPS", runtime: "Runtime", bootstrap: "Bootstrap (read-only)",
};
function ConfigPanel({ onToast }: { onToast?: ShowToast }) {
  const [data, setData] = React.useState<ConfigResponse | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const load = React.useCallback(() => { api.getConfig().then(setData).catch(() => setData(null)); }, []);
  React.useEffect(() => { load(); }, [load]);
  if (!data) return <StateBlock kind="loading" title="Memuat konfigurasi…" />;

  const clearDraft = (key: string) => setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
  const save = async (e: ConfigEntryView) => {
    const v = drafts[e.key] ?? "";
    try { await api.putConfig(e.key, v); clearDraft(e.key); load();
      onToast?.(`${e.label} disimpan`, "ok", "check-circle-2"); }
    catch { onToast?.(`Gagal menyimpan ${e.label}`, "err", "x-circle"); }
  };
  const reset = async (e: ConfigEntryView) => {
    try { await api.deleteConfig(e.key); clearDraft(e.key); load(); onToast?.(`${e.label} direset`, "warn", "rotate-ccw"); }
    catch { onToast?.("Gagal reset", "err", "x-circle"); }
  };

  const groups = [...new Set(data.entries.map((e) => e.group))];
  return (
    <>
      {groups.map((g) => (
        <Card key={g} eyebrow={g} title={GROUP_LABEL[g] ?? g}>
          {g === "sync" && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 8 }}>
              {data.sync.running ? (data.sync.connected ? "● Tersambung ke hub" : "◐ Sync aktif, menyambung…") : "○ Tidak sync (HUB murni)"}
            </div>
          )}
          {data.entries.filter((e) => e.group === g).map((e) => (
            <SettingRow key={e.key} title={e.label} desc={e.help}>
              <ConfigField entry={e} draft={drafts[e.key]}
                onDraft={(v) => setDrafts((d) => ({ ...d, [e.key]: v }))}
                onSave={() => save(e)} onReset={() => reset(e)} />
            </SettingRow>
          ))}
        </Card>
      ))}
    </>
  );
}

function ConfigField({ entry, draft, onDraft, onSave, onReset }: {
  entry: ConfigEntryView; draft?: string; onDraft: (v: string) => void; onSave: () => void; onReset: () => void;
}) {
  const badge = <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-subtle)", marginRight: 8 }}>{entry.source} · {entry.apply}</span>;
  if (!entry.editable) { // bootstrap read-only
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      <code style={{ fontSize: 12 }}>{entry.masked ?? entry.value ?? "—"}</code></div>;
  }
  if (entry.kind === "secret") {
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      {entry.hasValue && draft === undefined
        ? <><code style={{ fontSize: 12 }}>{entry.masked}</code>
            <Button size="sm" variant="ghost" leftIcon="pencil" onClick={() => onDraft("")}>Ganti</Button>
            <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={onReset}>Hapus</Button></>
        : <><Input aria-label={entry.label} type="password"
              placeholder={entry.hasValue ? "biarkan kosong = pertahankan" : (configEntry(entry.key)?.example ?? "tempel token…")}
              value={draft ?? ""} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => onDraft(ev.target.value)} style={{ width: 240 }} />
            <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button></>}
    </div>;
  }
  if (entry.kind === "bool") {
    const on = (draft ?? entry.value) === "1";
    return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
      <Switch checked={on} onChange={(v: boolean) => { onDraft(v ? "1" : "0"); }} />
      {draft !== undefined && <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button>}</div>;
  }
  // url | int | string | path
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{badge}
    <Input aria-label={entry.label} type={entry.kind === "int" ? "number" : "text"}
      placeholder={configEntry(entry.key)?.example}
      value={draft ?? entry.value ?? ""} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => onDraft(ev.target.value)} style={{ width: 240 }} />
    <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button>
    {entry.source === "db" && <Button size="sm" variant="ghost" leftIcon="rotate-ccw" onClick={onReset}>Reset</Button>}</div>;
}

// ADR-0155 · token yang HAKNYA MENYEMPIT saat empat capability berbahaya dipecah dari `:write`.
// Data murni, bukan logika tersebar: menambah pecahan berikutnya = menambah satu baris di sini.
// Kalimatnya menyebut HAK YANG HILANG — checkbox kosong baru tak berbicara apa-apa kepada orang
// yang tak membaca release note, dan diamnya integrasi yang patah adalah kelas kegagalan SPEC-491.
const LOST_RIGHTS: { had: string; needs: string; sentence: string }[] = [
  { had: "sessions:write", needs: "sessions:spawn", sentence: "dulu bisa membuka sesi baru" },
  { had: "ide:write", needs: "ide:git", sentence: "dulu bisa merge/rebase & menghapus branch" },
  { had: "backlog:write", needs: "backlog:lifecycle", sentence: "dulu bisa integrate & menghapus backlog" },
  { had: "vps:write", needs: "vps:exec", sentence: "dulu bisa menjalankan perintah di VPS" },
];

function lostRights(caps: string[]): string[] {
  return LOST_RIGHTS.filter((l) => caps.includes(l.had) && !caps.includes(l.needs)).map((l) => l.sentence);
}

// SPEC-257 · ADR-0065 · Akses AI Agent: master switch + agent token + capability per-domain.
export function AgentAccessPanel({ onToast }: { onToast?: ShowToast } = {}) {
  const { confirm, dialog } = useConfirm();
  const [caps, setCaps] = React.useState<CapabilityInfo[]>([]);
  const [items, setItems] = React.useState<AgentTokenView[] | null>(null);
  const [setting, setSetting] = React.useState<Setting | null>(null);
  const [name, setName] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [fresh, setFresh] = React.useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => { api.listAgentTokens().then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  React.useEffect(() => {
    api.getSettings().then(setSetting).catch(() => {});
    api.getAgentCapabilities().then((r) => setCaps(r.capabilities)).catch(() => {});
    load();
  }, [load]);

  async function toggleMaster(next: boolean) {
    if (!setting) return;
    const updated = { ...setting, agentAccessEnabled: next };
    setSetting(updated);
    try { await api.putSettings(updated); onToast?.("Akses AI agent " + (next ? "aktif" : "nonaktif"), next ? "ok" : "warn", "bot"); }
    catch { onToast?.("Gagal menyimpan", "err", "x-circle"); setSetting(setting); }
  }
  const toggleCap = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  async function create() {
    if (name.trim().length < 1 || busy) return;
    setBusy(true);
    try {
      const t = await api.createAgentToken({ name: name.trim(), capabilities: picked });
      setFresh({ name: t.name, token: t.token }); setName(""); setPicked([]); load();
      onToast?.("Agent token dibuat — salin sekarang", "ok", "key-round");
    } catch { onToast?.("Gagal membuat token", "err", "x-circle"); }
    finally { setBusy(false); }
  }
  async function revoke(t: AgentTokenView) {
    try {
      if (!await confirm({
        title: `Cabut agent token "${t.name}"?`,
        message: "Agen yang memakainya langsung kehilangan akses.",
        confirmLabel: "Cabut token",
        icon: "key-round",
        run: () => api.revokeAgentToken(t.id),
      })) return;
      load(); onToast?.("Token dicabut", "warn", "trash-2");
    }
    catch { onToast?.("Gagal mencabut token", "err", "x-circle"); }
  }
  async function setEnabled(t: AgentTokenView, enabled: boolean) {
    try { await api.patchAgentToken(t.id, { enabled }); load(); }
    catch { onToast?.("Gagal mengubah token", "err", "x-circle"); }
  }

  // Kelompokkan capability per domain → baris {domain, read?, write?} untuk grid checkbox.
  const domains = Array.from(new Set(caps.map((c) => c.domain)));
  const active = (items ?? []).filter((t) => !t.revokedAt);

  return (
    <>
      {/* SPEC-489 · panduannya mendahului tokennya: baca dulu, baru buat kredensial. */}
      <AgentDocCard onToast={onToast} />

      <Card eyebrow="ai agent" title="Akses AI Agent">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Beri AI agent eksternal kendali hanoman lewat token (header <code>Authorization: Bearer</code>).
          Tiap fitur dibuka per <b>capability</b>. Selagi master switch mati, semua token ditolak.
        </div>
        <SettingRow title="Aktifkan akses AI agent" last
          desc="Master switch. Nonaktif → semua agent token 401, apa pun capability-nya.">
          <Switch checked={!!setting?.agentAccessEnabled} onChange={(v: boolean) => void toggleMaster(v)} />
        </SettingRow>
      </Card>

      <Card eyebrow="token" title="Agent tokens">
        {fresh && (
          <div style={{ padding: 12, marginBottom: 12, border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)", background: "var(--brass-100)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Token “{fresh.name}” — salin sekarang, tak akan ditampilkan lagi:</div>
            <code style={{ display: "block", wordBreak: "break-all", fontSize: 12 }}>{fresh.token}</code>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <Button size="sm" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(fresh.token); onToast?.("Disalin", "ok", "copy"); }}>Salin</Button>
              <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Tutup</Button>
            </div>
          </div>
        )}
        {items === null ? <StateBlock kind="loading" compact title="Memuat token…" />
          : active.length === 0 ? <div style={{ fontSize: 13, color: "var(--text-subtle)", padding: "8px 0" }}>Belum ada agent token.</div>
          : active.map((t, i) => (
            <SettingRow key={t.id} title={t.name} last={i === active.length - 1}
              desc={`${t.tokenPrefix}… · ${t.capabilities.length} capability · `
                + (t.lastUsedAt ? "terpakai " + new Date(t.lastUsedAt).toLocaleString("id-ID") : "belum dipakai")
                // ADR-0155 · peringatan hak yang menyempit ikut di `desc` supaya ia terbaca di
                // baris yang sama dengan tokennya, bukan sebagai blok terpisah yang mudah dilewati.
                + (lostRights(t.capabilities).length
                  ? ` — token ini ${lostRights(t.capabilities).join(", ")}; sekarang tidak, sampai capability berbahayanya dicentang. Cabut lalu buat ulang bila memang perlu.`
                  : "")}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Switch size="sm" checked={t.enabled} onChange={(v: boolean) => void setEnabled(t, v)} />
                <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => revoke(t)}>Cabut</Button>
              </div>
            </SettingRow>
          ))}

        <div style={{ paddingTop: 14 }}>
          <Field label="Nama token"><Input value={name} placeholder="mis. agent-ci"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} style={{ width: "100%" }} /></Field>
          <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)" }}>Capability</div>
          {/* ADR-0155 · TIGA tingkat akses, bukan dua. Kolom `berbahaya` hanya terisi untuk empat
              domain yang punya pecahannya; sisanya sengaja kosong — sel kosong lebih jujur daripada
              checkbox yang tak memetakan ke capability mana pun. */}
          <div className="hn-grid-mobile" style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "6px 14px", alignItems: "center" }}>
            <div /><div style={{ fontSize: 11.5, color: "var(--text-subtle)", textAlign: "center" }}>baca</div>
            <div style={{ fontSize: 11.5, color: "var(--text-subtle)", textAlign: "center" }}>tulis</div>
            <div style={{ fontSize: 11.5, color: "var(--status-err)", textAlign: "center" }}>berbahaya</div>
            {domains.map((d) => {
              const r = caps.find((c) => c.domain === d && c.access === "read");
              const w = caps.find((c) => c.domain === d && c.access === "write");
              const x = caps.find((c) => c.domain === d && c.access === "danger");
              const meta = CAPABILITY_DOMAINS.find((m) => m.domain === d);
              return (
                <React.Fragment key={d}>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    <div style={{ fontWeight: 600, color: "var(--text-strong)" }}>{meta?.label ?? d}{w?.risk || x?.risk ? " ⚠" : ""}</div>
                    {meta?.desc && <div style={{ fontSize: 11.5, color: "var(--text-subtle)", lineHeight: 1.4, marginTop: 1 }}>{meta.desc}</div>}
                    {x && <div style={{ fontSize: 11.5, color: "var(--status-err)", lineHeight: 1.4, marginTop: 2 }}>{x.label.replace(/^[^—]+—\s*/, "berbahaya: ")} — {x.desc}</div>}
                  </div>
                  <div style={{ textAlign: "center" }}>{r && <input type="checkbox" aria-label={r.id} checked={picked.includes(r.id)} onChange={() => toggleCap(r.id)} />}</div>
                  <div style={{ textAlign: "center" }}>{w && <input type="checkbox" aria-label={w.id} checked={picked.includes(w.id)} onChange={() => toggleCap(w.id)} />}</div>
                  <div style={{ textAlign: "center" }}>{x && <input type="checkbox" aria-label={x.id} checked={picked.includes(x.id)} onChange={() => toggleCap(x.id)} />}</div>
                </React.Fragment>
              );
            })}
          </div>
          <div style={{ marginTop: 14 }}>
            <Button size="sm" leftIcon="plus" disabled={name.trim().length < 1 || busy} onClick={() => void create()}>Buat token</Button>
          </div>
        </div>
        {dialog}
      </Card>

      {/* SPEC-482 · ADR-0099 · memasang MCP server dan memberi capability adalah satu pekerjaan
          manusia; panelnya duduk di tab yang sama dengan master switch & daftar token. */}
      <McpPanel />
    </>
  );
}

// Grup navigasi settings — sidebar kiri. Akun & Users tak bergantung GET /settings; umum/model/
// sesi bergantung dan menampilkan loading/error-nya sendiri.
/**
 * SPEC-884 · ADR-0139 · setup awal bisa ditinjau & diubah kapan saja. Jalur ini TAK PERNAH
 * menyentuh akun — hanya peruntukan dan hardening; akun tetap lahir sekali di AuthScreen.
 */
function SetupPanel() {
  const [setup, setSetup] = React.useState<SetupStatus | null>(null);
  const [rerun, setRerun] = React.useState(false);
  const load = React.useCallback(() => {
    api.setupStatus().then(setSetup).catch(() => setSetup(null));
  }, []);
  React.useEffect(load, [load]);
  if (!setup) return <StateBlock kind="loading" title="Memuat setup…" />;
  if (rerun) return <SetupWizard status={setup} onDone={() => { setRerun(false); load(); }} />;
  return (
    <div data-testid="setup-card">
      <Card eyebrow="setup" title="Setup awal">
        <div style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
          Peruntukan: {setup.deployment === "local" ? "Device saya sendiri" : "Diakses orang lain"}
          <br />
          {setup.hardening ? "Hardening menyala" : "Hardening mati"}
          {setup.hardeningLocked ? " — dipasang lewat env, tak bisa diubah dari sini" : ""}
        </div>
        <Button onClick={() => setRerun(true)}>Jalankan ulang setup</Button>
      </Card>
    </div>
  );
}

const S_SECTIONS = [
  { key: "akun", label: "Akun", icon: "user-round" },
  { key: "users", label: "Users", icon: "users" },
  { key: "akses-klien", label: "Akses klien", icon: "user-check" }, // SPEC-617 · ADR-0110 · portal klien
  { key: "perangkat", label: "Perangkat", icon: "key-round" },   // SPEC-213 · device tokens
  { key: "agent", label: "Akses AI Agent", icon: "bot" },        // SPEC-257 · agent token + capability
  { key: "custom-agent", label: "Custom agent", icon: "bot" },   // SPEC-450 · ADR-0094 · katalog agen global
  { key: "aktivitas", label: "Aktivitas", icon: "activity" },    // SPEC-213 · activity log
  { key: "konfigurasi", label: "Konfigurasi", icon: "sliders" }, // SPEC-215 · env runtime
  { key: "setup", label: "Setup awal", icon: "shield" },         // SPEC-884 · ADR-0139 · profil & hardening
  { key: "telegram", label: "Telegram", icon: "send" },          // SPEC-476 · operator gateway
  { key: "webhook", label: "Webhook", icon: "webhook" },         // SPEC-481 · ADR-0100 · webhook keluar
  { key: "umum", label: "Umum", icon: "sliders-horizontal" },
  { key: "model", label: "Model sesi", icon: "cpu" },
  { key: "sesi", label: "Sesi", icon: "bell" },
] as const;

export function SettingsScreen({ onToast, me, onLoggedOut }:
  { onToast?: ShowToast; me: UserView; onLoggedOut: () => void }) {
  const [s, setS] = React.useState<Setting | null>(null);
  const [failed, setFailed] = React.useState(false);
  // SPEC-740 · ADR-0115 · sub-tab aktif bertahan; refresh tak melempar balik ke Akun.
  const [tab, setTab] = usePersistedState<string>("settings", "tab", "akun", isStr);
  const tier = useResponsiveTier();
  const mobile = tier === "mobile";
  // SPEC-481 · halaman dokumentasi webhook hidup DI DALAM tab-nya (bukan modal): brief
  // meminta "halaman", dan modal di atas Settings membuat Escape ambigu (pola SPEC-385).
  const [webhookDocs, setWebhookDocs] = React.useState(false);
  const [telegramStatus, setTelegramStatus] = React.useState<TelegramGatewayStatus | null>(null);
  const [telegramFailed, setTelegramFailed] = React.useState(false);
  // SPEC-339 · versi codex CLI, untuk peringatan LUNAK saja. Gagal-diam: endpoint yang error tak
  // boleh membuat layar Settings gagal render.
  const [codexVer, setCodexVer] = React.useState<{ version: string | null; minRequired: string } | null>(null);
  React.useEffect(() => { api.getCodexVersion().then(setCodexVer).catch(() => {}); }, []);
  // SPEC-739 · ADR-0114 · kesiapan skill metode per agen. Gagal-diam seperti codexVer: kartu
  // Metode harus tetap bisa dipakai walau endpoint statusnya error — ini observabilitas,
  // bukan gerbang.
  const [methodStatuses, setMethodStatuses] = React.useState<MethodStatusResponse | null>(null);
  // Pemasangan butuh project yang ter-bind ke checkout lokal: pane lahir di repoDir-nya.
  const [installProject, setInstallProject] = React.useState("");
  React.useEffect(() => {
    if (tab !== "sesi") return;
    api.getMethodStatus().then(setMethodStatuses).catch(() => setMethodStatuses(null));
    api.listProjects({ limit: 100 })
      .then((r) => setInstallProject((p) => p || (r.items.find((x) => x.binding ?? x.repoDir)?.id ?? "")))
      .catch(() => {});
  }, [tab]);
  // Jangan fallback ke S_DEFAULTS saat GET gagal: toggle berikutnya akan mem-PUT
  // default itu menimpa pengaturan asli di server.
  const load = React.useCallback(() => {
    setFailed(false); setS(null);
    api.getSettings().then(setS).catch(() => setFailed(true));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const loadTelegram = React.useCallback(() => {
    setTelegramFailed(false); setTelegramStatus(null);
    api.getTelegramStatus().then(setTelegramStatus).catch(() => setTelegramFailed(true));
  }, []);
  React.useEffect(() => { if (tab === "telegram") loadTelegram(); }, [tab, loadTelegram]);
  // SPEC-477 · ADR-0097 · kredensial Telegram kini hidup di store config, bukan .env.
  const [tgCreds, setTgCreds] = React.useState<TelegramCredentialsView | null>(null);
  const [tgDraft, setTgDraft] = React.useState<Record<string, string>>({});
  const [tgTest, setTgTest] = React.useState<TelegramTestResult | "sending" | null>(null);
  const [tgConfirm, setTgConfirm] = React.useState(false);
  const loadTgCreds = React.useCallback(() => {
    api.getTelegramCredentials().then((v) => { setTgCreds(v); setTgDraft({}); }).catch(() => setTgCreds(null));
  }, []);
  React.useEffect(() => { if (tab === "telegram") loadTgCreds(); }, [tab, loadTgCreds]);

  // Kartu yang bergantung settings (umum/model/sesi). Loading/failed hanya relevan di sini.
  function prefs() {
    if (failed) return <StateBlock kind="error" title="Gagal memuat pengaturan"
      hint="Pengaturan tidak ditampilkan agar tidak menimpa nilai di server." action={load} />;
    if (!s) return <StateBlock kind="loading" title="Memuat pengaturan…" />;
    const persist = (next: Setting, msg?: string, tone?: string, icon?: string) => {
      setS(next);
      api.putSettings(next).catch(() => {});
      if (msg && onToast) onToast(msg, tone || "ok", icon || "check-circle-2");
    };
    const save = (patch: Partial<Setting>, msg: string) => persist({ ...s, ...patch }, msg);
    const sw = (k: keyof Setting, msg: string) => (v: boolean) => save({ [k]: v } as Partial<Setting>, msg + (v ? " · aktif" : " · nonaktif"));
    // SPEC-739 · ADR-0114 · pemasangan lewat SESI TERMINAL (ADR-0056). Yang dikirim hanya metode
    // + agen; perintahnya diturunkan SERVER dari katalog, jadi UI tak pernah memegang literalnya.
    const installMethod = async (m: MethodSkillStatus) => {
      if (!installProject) return;
      try {
        await api.createShell(installProject, { method: m.method, agent: m.agent });
        onToast?.(`Pemasangan ${m.label} · ${AGENT_LABEL[m.agent]} berjalan di Terminal`, "ok", "terminal");
      } catch { onToast?.("Gagal membuka sesi terminal pemasangan", "err", "alert-triangle"); }
    };
    // SPEC-338 · ADR-0074 · server selalu mengirim `agent`/`codex` (zod .default()), TAPI SPA yang
    // masih ter-cache dari sebelum SPEC-338 bisa bicara dengan server lama saat rolling update.
    // Tanpa fallback ini layar Settings mati total (`undefined.model`) alih-alih sekadar
    // memperlihatkan default.
    const codex = s.codex ?? CODEX_DEFAULTS;
    const agent = s.agent ?? "claude";

    if (tab === "telegram") {
      const telegram = s.telegram ?? TELEGRAM_DEFAULTS;
      const readiness = telegramStatus?.readiness ?? "memuat";
      // `source === "env"` = nilai masih datang dari .env — jalur warisan yang sengaja dibiarkan
      // hidup (ADR-0049 resolver DB → env → default), tapi ditandai agar operator memindahkannya.
      const sourceBadge = (src: "db" | "env" | "default") =>
        src === "db" ? <Badge tone="ok">tersimpan</Badge>
          : src === "env" ? <Badge tone="warn">dari .env · deprecated</Badge>
            : <Badge>belum diisi</Badge>;
      const saveCreds = () => {
        const patch = Object.fromEntries(Object.entries(tgDraft).filter(([, v]) => v !== ""));
        if (!Object.keys(patch).length) { onToast?.("Tak ada perubahan", "info", "info"); return; }
        api.putTelegramCredentials(patch)
          .then((v) => {
            setTgCreds(v); setTgDraft({}); setTgTest(null);
            onToast?.("Kredensial Telegram disimpan", "ok", "check-circle-2");
            loadTelegram();
          })
          .catch((e: Error) => onToast?.(e.message || "Gagal menyimpan", "err", "alert-triangle"));
      };
      const runTest = () => {
        setTgTest("sending");
        api.testTelegramConnection().then(setTgTest)
          .catch((e: Error) => setTgTest({
            ok: false, error: e.message || "Gagal menghubungi server",
            inbound: { ok: false, reason: "Status jalur masuk tak terbaca — server tak menjawab.", missingCapabilities: [], polling: false },
          }));
      };
      const removeCreds = () => {
        setTgConfirm(false);
        api.deleteTelegramCredentials().then((r) => {
          onToast?.(r.envFallback.length
            ? `Kredensial dihapus — ${r.envFallback.length} nilai masih datang dari .env`
            : "Kredensial Telegram dihapus", "ok", "check-circle-2");
          setTgTest(null); loadTgCreds(); loadTelegram();
        }).catch((e: Error) => onToast?.(e.message || "Gagal menghapus", "err", "alert-triangle"));
      };
      return (
        <>
          <Card eyebrow="telegram" title="Kredensial Telegram">
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
              Disimpan terenkripsi di database dan berlaku langsung — tanpa mengedit <code>.env</code>,
              tanpa restart. Nilai <code>.env</code> lama tetap dipakai selama field-nya masih kosong.
            </div>
            {!tgCreds ? <StateBlock kind="loading" compact title="Memuat kredensial…" />
              : <>
                {tgCreds.fields.map((f, i) => (
                  <SettingRow key={f.key} title={f.label} desc={f.help} last={i === tgCreds.fields.length - 1}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {sourceBadge(f.source)}
                      <Input
                        aria-label={f.label}
                        mono
                        type={f.kind === "secret" ? "password" : "text"}
                        placeholder={f.kind === "secret"
                          ? (f.masked ?? configEntry(f.key)?.example ?? "belum diisi")
                          : (configEntry(f.key)?.example ?? "belum diisi")}
                        value={tgDraft[f.key] ?? (f.kind === "secret" ? "" : (f.value ?? ""))}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setTgDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                        style={{ width: 300 }}
                      />
                    </div>
                  </SettingRow>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <Button size="sm" leftIcon="save" onClick={saveCreds}>Simpan kredensial</Button>
                </div>
              </>}
          </Card>

          <Card eyebrow="uji" title="Uji koneksi & hapus"
            actions={<Button size="sm" variant="ghost" leftIcon="refresh-cw" onClick={loadTgCreds}>Refresh</Button>}>
            <SettingRow title="Test Connection"
              desc="Mengirim satu pesan percobaan ke chat tujuan. Batas 10 detik — tak pernah menggantung.">
              <Button size="sm" leftIcon="send" disabled={tgTest === "sending"} onClick={runTest}>Test Connection</Button>
            </SettingRow>
            {tgTest && tgTest !== "sending" && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {tgTest.ok
                  ? <Callout tone="ok">Berhasil — bot @{tgTest.botUsername ?? "?"} mengirim ke chat {tgTest.chatId}.</Callout>
                  : <Callout tone="err">{tgTest.error}</Callout>}
                {/* SPEC-491 · uji di atas hanya jalur KELUAR (bot token). Hijau di sana pernah
                    berdampingan dengan jalur masuk yang mati total — itulah keluhan "diam
                    total": pesan tak pernah tertangkap dan tak ada balasan sama sekali. */}
                {tgTest.inbound?.ok
                  ? <Callout tone="ok">Jalur masuk siap — gateway sedang long polling dan AgentToken-nya sah.</Callout>
                  : <Callout tone="warn">
                      Jalur masuk BELUM siap: {tgTest.inbound?.reason ?? "status tak terbaca."}
                      {!!tgTest.inbound?.missingCapabilities.length && (
                        <> Capability yang kurang: <code>{tgTest.inbound.missingCapabilities.join(", ")}</code>.</>
                      )}
                      {" "}Selama ini merah, pesan Telegram tidak akan pernah tertangkap.
                    </Callout>}
              </div>
            )}
            <SettingRow title="Hapus kredensial" last
              desc="Menghapus keempat nilai dari database. Bila .env lama masih terisi, nilainya kembali dipakai.">
              <Button size="sm" variant="danger" leftIcon="trash-2" onClick={() => setTgConfirm(true)}>Hapus kredensial</Button>
            </SettingRow>
            <ConfirmDialog
              open={tgConfirm}
              title="Hapus kredensial Telegram?"
              message="Gateway berhenti kecuali nilai .env lama masih tersedia."
              confirmLabel="Hapus"
              onConfirm={removeCreds}
              onCancel={() => setTgConfirm(false)}
            />
          </Card>

          <Card eyebrow="gateway" title="Gateway Telegram"
            actions={<Button size="sm" variant="ghost" leftIcon="refresh-cw" onClick={loadTelegram}>Refresh</Button>}>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
              Satu private chat yang diizinkan terikat ke satu session operator Hanoman persisten.
              Bahasa natural tetap antarmuka utama; command hanya shortcut ke session yang sama.
            </div>
            <SettingRow title="Gateway aktif"
              desc="Menyalakan long polling in-process seketika. Mematikan tidak membunuh session tmux atau memory.">
              <Switch label="Gateway aktif" checked={telegram.enabled} onChange={(enabled: boolean) => {
                persist({ ...s, telegram: { ...telegram, enabled } }, `Gateway Telegram · ${enabled ? "aktif" : "nonaktif"}`);
              }} />
            </SettingRow>
            <SettingRow title="Kirim progress ringkas"
              desc="Hanya progress eksplisit dan fakta status Hanoman; layar PTY/reasoning tidak pernah diteruskan.">
              <Switch label="Kirim progress ringkas" checked={telegram.progress} onChange={(progress: boolean) => {
                persist({ ...s, telegram: { ...telegram, progress } }, `Progress Telegram · ${progress ? "aktif" : "nonaktif"}`);
              }} />
            </SettingRow>
            {telegramFailed ? <StateBlock kind="error" compact title="Gagal membaca status Telegram" action={loadTelegram} />
              : !telegramStatus ? <StateBlock kind="loading" compact title="Memuat status Telegram…" />
              : <>
                <SettingRow title={`Readiness · ${readiness}`}
                  desc={telegramStatus.running ? "Long poll aktif." : telegramStatus.lastError ?? "Gateway belum polling."}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {telegramStatus.botUsername ? `@${telegramStatus.botUsername}` : "bot belum terverifikasi"}
                  </span>
                </SettingRow>
                <SettingRow title="Allowlist" last={!telegramStatus.missingCapabilities.length}
                  desc={`${telegramStatus.allowlistCount} Telegram numeric user id diizinkan.`}>
                  <span>{telegramStatus.configured ? "kredensial lengkap" : "kredensial belum lengkap"}</span>
                </SettingRow>
                {telegramStatus.missingCapabilities.length > 0 && <SettingRow title="Capability kurang" last
                  desc={telegramStatus.missingCapabilities.join(", ")} />}
              </>}
            <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.7 }}>
              <b>Onboarding</b>
              <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                <li>Buat satu bot private-chat lewat BotFather, salin token-nya.</li>
                <li>Di Akses AI Agent, aktifkan master switch dan buat AgentToken dengan capability yang ditampilkan status.</li>
                <li>Isi keempat field di kartu Kredensial lalu Simpan.</li>
                <li>Tekan Test Connection sampai hijau.</li>
                <li>Nyalakan gateway di atas dan kirim <code>/status</code> dari Telegram.</li>
              </ol>
            </div>
          </Card>
        </>
      );
    }

    if (tab === "umum") return (
      <>
        <Card eyebrow="general" title="Umum">
          <SettingRow title="Full-auto sebagai default"
            desc="Run baru jalan sendiri sampai selesai. Manusia tetap bisa steer / interupsi kapan pun.">
            <Switch checked={s.autoDefault} onChange={sw("autoDefault", "Full-auto default")} />
          </SettingRow>
          <SettingRow title="Auto-scaffold doc index" last
            desc="Project from-scratch otomatis di-scaffold doc index-nya setelah objective terkunci.">
            <Switch checked={s.autoScaffold} onChange={sw("autoScaffold", "Auto-scaffold")} />
          </SettingRow>
        </Card>
        {/* Reset menyentuh SEMUA settings → taruh di grup umum saja, tak diulang tiap tab. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 2px", color: "var(--text-subtle)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <span>hanoman · nafanesia.id</span>
          <Button size="sm" variant="ghost" leftIcon="rotate-ccw"
            onClick={() => persist(JSON.parse(JSON.stringify(S_DEFAULTS)), "Pengaturan dikembalikan ke default", "warn", "rotate-ccw")}>
            Reset ke default
          </Button>
        </div>
      </>
    );
    if (tab === "model") {
      // SPEC-339 · catatan LUNAK versi codex CLI. Seluruh aturannya di codexClientTooOld (shared) —
      // Settings dan picker Start memakai fungsi yang sama, jadi keduanya tak bisa berbeda pendapat.
      const codexNote = (model: string) => {
        const have = codexVer?.version ?? null;
        if (!codexClientTooOld(model, have)) return null;
        return (
          <div data-testid="codex-version-note" style={{
            fontSize: 12, lineHeight: 1.5, marginBottom: 10, padding: "8px 10px",
            borderRadius: 8, background: "var(--warn-bg, #fdf6e3)", color: "var(--text-muted)",
          }}>
            Codex CLI terpasang <b>{have}</b>, sedangkan <b>{model}</b> butuh <b>{codexModel(model)?.minClient}</b>.
            Sesi tetap boleh dijalankan, tapi modelnya belum tentu dikenali CLI ini.
            Perbarui dengan <code>npm i -g @openai/codex@latest</code>.
          </div>
        );
      };
      // SPEC-339 · nilai di luar katalog (mis. dari PUT ber-AgentToken) ditambahkan apa adanya
      // supaya picker tak tampil kosong. Effort-nya pun tak dikoersi — konsisten dengan aturan
      // "model tak dikenal → apa adanya" di coerceCodexEffort.
      const codexOptions = (model: string) => (CODEX_MODELS.some((m) => m.id === model)
        ? CODEX_MODELS.map((m) => ({ value: m.id, label: m.label }))
        : [{ value: model, label: model }, ...CODEX_MODELS.map((m) => ({ value: m.id, label: m.label }))]);
      // SPEC-383 · ADR-0081 · blok konflik. `?? CONFLICT_DEFAULTS` karena respons GET /settings yang
      // ter-cache dari sebelum SPEC-383 belum punya kunci ini — layar tak boleh mati `undefined.enabled`.
      const conflict = s.conflict ?? CONFLICT_DEFAULTS;
      const saveConflict = (patch: Partial<Setting["conflict"]>, msg: string) =>
        save({ conflict: { ...conflict, ...patch } }, msg);
      // Warisan yang berlaku saat override mati — persis yang dihitung `sessionAgentDefaults()`.
      const inherited = agent === "codex"
        ? { agent: "codex" as const, model: codex.model, effort: codex.effort }
        : { agent: "claude" as const, model: s.model, effort: s.effort };
      // SPEC-488 · blok `Setting.lead.engine` — agen yang MENJALANKAN hanoman-lead. `?? LEAD_DEFAULTS`
      // sama alasannya dengan `?? CONFLICT_DEFAULTS`: respons GET /settings yang ter-cache dari
      // instance lama belum punya kuncinya, dan layar tak boleh mati `undefined.engine`.
      const lead = s.lead ?? LEAD_DEFAULTS;
      const engine = lead.engine ?? LEAD_DEFAULTS.engine;
      // Kartu ini menulis lewat PUT /lead/config, BUKAN `save()` (PUT /settings) seperti kartu
      // konflik — dan itu perbedaan sadar. `persist()` mengirim SELURUH objek Setting dari snapshot
      // yang dimuat sekali saat mount, sementara blok `lead` punya penulis KEDUA: LeadScreen
      // (rem darurat Pause, denyut, batas waktu, opt-in per project). Urutan "buka Settings →
      // tekan Pause di layar Lead → ganti model lead di Settings" akan mengembalikan `paused` ke
      // nilai snapshot, yakni rem darurat yang lepas sendiri tanpa satu pun klik yang mengatakannya.
      // Karena itu: baca blok lead SEGAR, tempel `engine`-nya, tulis balik lewat endpoint lead.
      const saveEngine = async (patch: Partial<Setting["lead"]["engine"]>, msg: string) => {
        const prev = lead;
        setS({ ...s, lead: { ...lead, engine: { ...engine, ...patch } } });   // optimistis
        try {
          const fresh = await api.getLeadConfig();
          const saved = await api.putLeadConfig({
            ...fresh, engine: { ...(fresh.engine ?? LEAD_DEFAULTS.engine), ...patch },
          });
          setS((p) => (p ? { ...p, lead: saved } : p));
          onToast?.(msg, "ok", "check-circle-2");
        } catch {
          setS((p) => (p ? { ...p, lead: prev } : p));
          onToast?.("Gagal menyimpan setelan lead", "err", "alert-triangle");
        }
      };
      // SPEC-492 · blok `Setting.telegram.engine`. `?? TELEGRAM_DEFAULTS` sama alasannya dengan
      // `?? CONFLICT_DEFAULTS`: respons GET /settings ter-cache dari instance lama belum punya
      // kuncinya, dan layar tak boleh mati `undefined.engine`.
      const telegram = s.telegram ?? TELEGRAM_DEFAULTS;
      const tgEngine = telegram.engine ?? TELEGRAM_DEFAULTS.engine;
      // Membaca ULANG sebelum menulis, bukan mengirim snapshot `s` — sejak SPEC-492 blok
      // `telegram` punya penulis KEDUA di luar browser: command `/runtime|/model|/effort` dari
      // chat Telegram. Mengirim snapshot yang dimuat saat mount akan mengembalikan setelan yang
      // baru saja diubah dari ponsel, tanpa satu klik pun yang mengatakannya (kelas SPEC-488).
      const saveTgEngine = async (patch: Partial<Setting["telegram"]["engine"]>, msg: string) => {
        const prev = s;
        setS({ ...s, telegram: { ...telegram, engine: { ...tgEngine, ...patch } } });   // optimistis
        try {
          const fresh = await api.getSettings();
          const freshTg = fresh.telegram ?? TELEGRAM_DEFAULTS;
          const next = {
            ...fresh,
            telegram: { ...freshTg, engine: { ...(freshTg.engine ?? TELEGRAM_DEFAULTS.engine), ...patch } },
          };
          const saved = await api.putSettings(next);
          setS(saved ?? next);
          onToast?.(msg, "ok", "check-circle-2");
        } catch {
          setS(prev);
          onToast?.("Gagal menyimpan setelan operator Telegram", "err", "alert-triangle");
        }
      };
      // SPEC-518 · blok `Setting.changelog` — runtime/model/effort agen PEMBUAT CHANGELOG.
      // `?? CHANGELOG_ENGINE_DEFAULTS` sama alasannya dengan `?? CONFLICT_DEFAULTS`: respons
      // GET /settings dari instance lama belum punya kuncinya, dan layar tak boleh mati
      // `undefined.enabled`.
      const changelog = s.changelog ?? CHANGELOG_ENGINE_DEFAULTS;
      // Menulis lewat `save()` (PUT /settings), BUKAN endpoint khusus seperti kartu lead dan bukan
      // baca-ulang seperti kartu Telegram. Keduanya melakukannya karena bloknya punya PENULIS
      // KEDUA — `LeadScreen` untuk lead, command `/runtime|/model|/effort` dari chat untuk
      // telegram — sehingga menulis dari snapshot mount akan mengembalikan nilai yang baru saja
      // diubah di tempat lain. Blok `changelog` tak punya penulis kedua: kartu ini satu-satunya.
      const saveChangelog = (patch: Partial<Setting["changelog"]>, msg: string) =>
        save({ changelog: { ...changelog, ...patch } }, msg);
      // SPEC-854 · ADR-0130 · blok chat portal. Cermin `changelog`: satu-satunya penulisnya kartu
      // ini, jadi menulis dari snapshot mount aman.
      const portalChat = s.portalChat ?? PORTAL_CHAT_DEFAULTS;
      const savePortalChat = (patch: Partial<Setting["portalChat"]>, msg: string) =>
        save({ portalChat: { ...portalChat, ...patch } }, msg);
      const jatah = (nilai: string, fallback: number) => {
        const n = Math.floor(Number(nilai));
        return Number.isFinite(n) && n >= 0 ? n : fallback;
      };
      return (
      <>
      {/* SPEC-338 · ADR-0074 · mesin sesi default. Berlaku untuk SEMUA sesi yang men-spawn agen
          (backlog, reverse, prd, scaffold, breakdown, terminal); backlog masih bisa di-override
          saat Start. SPEC-383 · katalog model/effort kedua agen pindah ke kartu di bawah, supaya
          kartu ini menjawab satu pertanyaan saja: agen mana yang dipakai. */}
      <Card eyebrow="agen" title="Agen sesi">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Mesin yang menjalankan sesi baru. Perilaku sesi identik — worktree terisolasi, fase, stage,
          review, integrate. Yang berbeda hanya CLI-nya, dan karenanya katalog model/effort-nya.
          Indikator limit hanya membaca kuota Anthropic, jadi sesi codex tak muncul di sana.
        </div>
        <SettingRow title="Agen default" last desc="Sesi backlog masih bisa memilih agen lain saat Start.">
          <Select size="sm" aria-label="Agen default" value={agent} style={{ width: 190 }}
            options={[{ value: "claude", label: AGENT_LABEL.claude }, { value: "codex", label: AGENT_LABEL.codex }]}
            onChange={(e) => save({ agent: e.target.value as Setting["agent"] }, "Agen → " + e.target.value)} />
        </SettingRow>
      </Card>
      {/* SPEC-252 · ADR-0061 · default global saja. Model & effort dipilih PER SESI saat Start
          (picker StartSessionModal); matrix per-fase (SPEC-238) dicabut. Manusia tetap bebas mengetik
          `/model`/`/effort` di dalam terminal — itu justru gunanya interaktif.
          SPEC-383 · dua agen berdampingan, MASING-MASING berjudul namanya dan bertanda mana yang
          sedang dipakai — dulu blok claude hanya berbunyi "Model"/"Effort" tanpa menyebut agennya,
          sementara judul "default global" tetap terpampang meski agen aktifnya codex. */}
      <Card eyebrow="model" title="Model sesi — default global">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Default untuk sesi baru; bisa di-override per sesi saat <b>Start</b>. Di terminal, <code>/model</code>
          mengubahnya kapan saja. Sesi = satu proses, satu model seumur hidup. Yang benar-benar dipakai
          adalah blok milik agen terpilih di atas — yang satunya tersimpan, menunggu giliran.
        </div>
        <div data-testid="agent-group-claude">
          <AgentGroupHeader id="claude" label={AGENT_LABEL.claude} active={agent === "claude"} />
          <SettingRow title="Model" desc="Diteruskan apa adanya ke `claude --model`.">
            <Select size="sm" aria-label="Model claude" value={s.model} options={S_MODELS} style={{ width: 190 }}
              onChange={(e) => save({ model: e.target.value }, "Model claude → " + e.target.value)} />
          </SettingRow>
          <SettingRow title="Effort" last desc="Anggaran berpikir per giliran (`claude --effort`).">
            <Select size="sm" aria-label="Effort claude" value={s.effort} options={S_EFFORT} style={{ width: 130 }}
              onChange={(e) => save({ effort: e.target.value }, "Effort claude → " + e.target.value)} />
          </SettingRow>
        </div>
        <div data-testid="agent-group-codex" style={{ borderTop: "1px solid var(--border-hair)", marginTop: 6 }}>
          <AgentGroupHeader id="codex" label={AGENT_LABEL.codex} active={agent === "codex"} />
          {codexNote(codex.model)}
          <SettingRow title="Model" desc="Diteruskan apa adanya ke `codex -m`.">
            <Select size="sm" aria-label="Model codex" value={codex.model} style={{ width: 190 }}
              options={codexOptions(codex.model)}
              onChange={(e) => {
                // SPEC-339 · effort ikut dikoreksi: memilih Luna saat effort `ultra` harus menyimpan
                // pasangan yang sah, bukan pasangan yang nanti ditolak codex saat sesi lahir.
                const model = e.target.value;
                save({ codex: { model, effort: coerceCodexEffort(model, codex.effort) } }, "Model codex → " + model);
              }} />
          </SettingRow>
          <SettingRow title="Effort" last desc="Diteruskan ke `codex -c model_reasoning_effort`.">
            <Select size="sm" aria-label="Effort codex" value={codex.effort} style={{ width: 130 }}
              options={codexEfforts(codex.model).map((v) => ({ value: v, label: v }))}
              onChange={(e) => save({ codex: { ...codex, effort: e.target.value } }, "Effort codex → " + e.target.value)} />
          </SettingRow>
        </div>
      </Card>
      {/* SPEC-383 · ADR-0081 · sesi penyelesai konflik rebase/merge boleh punya default sendiri.
          Opt-in: mati = mewarisi blok di atas, persis perilaku sebelum SPEC-383. */}
      <Card eyebrow="konflik" title="Konflik rebase & merge">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Saat rebase/merge berkonflik, hanoman menyerahkan worktree-nya ke satu sesi agen untuk
          dibereskan. Pekerjaannya sempit dan tak berfase, jadi ia boleh memakai model & effort yang
          berbeda dari sesi kerja. Berlaku untuk ketiga pintu integrasi: backlog, git graph, dan PRD.
        </div>
        <SettingRow title="Pakai setelan sendiri"
          desc="Mati = ikut default global di atas. Hidup = sesi konflik memakai pilihan di bawah.">
          <Switch aria-label="Override agen konflik" checked={conflict.enabled}
            onChange={(v: boolean) => saveConflict({ enabled: v },
              "Setelan konflik" + (v ? " · aktif" : " · ikut default global"))} />
        </SettingRow>
        {!conflict.enabled ? (
          <div data-testid="conflict-inherited" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 0 2px", lineHeight: 1.5 }}>
            Sesi konflik memakai default global: <b>{AGENT_LABEL[inherited.agent]}</b> ·{" "}
            <code>{inherited.model}</code> · <code>{inherited.effort}</code>.
          </div>
        ) : (
          <>
            <SettingRow title="Agen" desc="Mesin yang membereskan konflik. Bisa beda dari agen sesi kerja.">
              <Select size="sm" aria-label="Agen konflik" value={conflict.agent} style={{ width: 190 }}
                options={[{ value: "claude", label: AGENT_LABEL.claude }, { value: "codex", label: AGENT_LABEL.codex }]}
                onChange={(e) => {
                  // Cermin `pickAgent` di StartSessionModal: menukar agen HARUS menukar model+effort
                  // sekalian ke default agen itu — kalau tidak sesi lahir `codex -m claude-opus-5`.
                  const a = e.target.value as "claude" | "codex";
                  const d = a === "codex" ? codex : { model: s.model, effort: s.effort };
                  saveConflict({ agent: a, model: d.model, effort: a === "codex" ? coerceCodexEffort(d.model, d.effort) : d.effort },
                    "Agen konflik → " + a);
                }} />
            </SettingRow>
            {conflict.agent === "codex" && codexNote(conflict.model)}
            <SettingRow title="Model">
              <Select size="sm" aria-label="Model konflik" value={conflict.model} style={{ width: 190 }}
                options={conflict.agent === "codex" ? codexOptions(conflict.model) : S_MODELS}
                onChange={(e) => {
                  const model = e.target.value;
                  saveConflict({ model, ...(conflict.agent === "codex"
                    ? { effort: coerceCodexEffort(model, conflict.effort) } : {}) },
                    "Model konflik → " + model);
                }} />
            </SettingRow>
            <SettingRow title="Effort" last desc="Konflik biasanya mekanis — effort rendah sering cukup.">
              {/* Label effort claude mengikuti kartu di atas (`x-high`), bukan slug mentah —
                  dua tempat yang menampilkan katalog yang sama harus terbaca sama. */}
              <Select size="sm" aria-label="Effort konflik" value={conflict.effort} style={{ width: 130 }}
                options={conflict.agent === "codex"
                  ? codexEfforts(conflict.model).map((v) => ({ value: v, label: v }))
                  : S_EFFORT}
                onChange={(e) => saveConflict({ effort: e.target.value }, "Effort konflik → " + e.target.value)} />
            </SettingRow>
          </>
        )}
      </Card>
      {/* SPEC-488 · agen yang MENJALANKAN hanoman-lead. Bloknya (`Setting.lead.engine`) ada sejak
          SPEC-409/ADR-0091 tapi tak pernah punya permukaan operator — satu-satunya jalan
          menyetelnya adalah `curl PUT /api/lead/config` dengan blok `Lead` utuh dirakit tangan.
          Opt-in seperti kartu konflik: mati = lead memakai default global di atas. */}
      <Card eyebrow="lead" title="Agen hanoman-lead">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Mesin yang menjalankan agen pemimpin — panggilan sekali-jalan non-interaktif yang membaca
          docs, plan, kode, dan riwayat git sebelum memutuskan. Berlaku untuk ketiga pintu lead
          (kontrak, deteksi otomatis, denyut) dan dipakai putusan berikutnya, tanpa restart. Rem
          darurat, denyut, dan opt-in per project tetap diurus di layar <b>Lead</b>.
        </div>
        <SettingRow title="Pakai setelan sendiri"
          desc="Mati = ikut default global di atas. Hidup = lead memakai pilihan di bawah.">
          <Switch aria-label="Override agen lead" checked={engine.enabled}
            onChange={(v: boolean) => saveEngine({ enabled: v },
              "Setelan lead" + (v ? " · aktif" : " · ikut default global"))} />
        </SettingRow>
        {!engine.enabled ? (
          <div data-testid="lead-engine-inherited" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 0 2px", lineHeight: 1.5 }}>
            hanoman-lead memakai default global: <b>{AGENT_LABEL[inherited.agent]}</b> ·{" "}
            <code>{inherited.model}</code> · <code>{inherited.effort}</code>.
          </div>
        ) : (
          <>
            <SettingRow title="Runtime" desc="Mesin yang menjalankan lead. Bisa beda dari agen sesi kerja.">
              <Select size="sm" aria-label="Runtime lead" value={engine.agent} style={{ width: 190 }}
                options={[{ value: "claude", label: AGENT_LABEL.claude }, { value: "codex", label: AGENT_LABEL.codex }]}
                onChange={(e) => {
                  // Cermin `pickAgent`/kartu konflik: menukar runtime HARUS menukar model+effort
                  // sekalian, kalau tidak lead lahir dengan `codex -m claude-opus-5`.
                  const a = e.target.value as "claude" | "codex";
                  const d = a === "codex" ? codex : { model: s.model, effort: s.effort };
                  saveEngine({ agent: a, model: d.model,
                    effort: a === "codex" ? coerceCodexEffort(d.model, d.effort) : d.effort },
                    "Runtime lead → " + a);
                }} />
            </SettingRow>
            {engine.agent === "codex" && codexNote(engine.model)}
            <SettingRow title="Model">
              <Select size="sm" aria-label="Model lead" value={engine.model} style={{ width: 190 }}
                options={engine.agent === "codex" ? codexOptions(engine.model) : S_MODELS}
                onChange={(e) => {
                  const model = e.target.value;
                  saveEngine({ model, ...(engine.agent === "codex"
                    ? { effort: coerceCodexEffort(model, engine.effort) } : {}) },
                    "Model lead → " + model);
                }} />
            </SettingRow>
            <SettingRow title="Effort" last
              desc="Putusan lead menuntut membaca bukti — SoT, ADR, plan, kode, riwayat git. Effort rendah memangkas kedalamannya.">
              <Select size="sm" aria-label="Effort lead" value={engine.effort} style={{ width: 130 }}
                options={engine.agent === "codex"
                  ? codexEfforts(engine.model).map((v) => ({ value: v, label: v }))
                  : S_EFFORT}
                onChange={(e) => saveEngine({ effort: e.target.value }, "Effort lead → " + e.target.value)} />
            </SettingRow>
          </>
        )}
      </Card>
      {/* SPEC-492 · sesi operator Telegram boleh punya runtime/model/effort sendiri. Bebannya beda
          jauh dari sesi kerja: ia sebagian besar membaca API lalu merangkum, bukan menulis kode —
          terukur 95 dtk untuk satu giliran `/start` pada effort xhigh, sementara ongkos kirim ke
          Telegram sendiri 0,4 dtk. Opt-in seperti kartu konflik & lead: mati = mewarisi. */}
      <Card eyebrow="telegram" title="Agen operator Telegram">
        <div data-testid="telegram-engine-desc"
          style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Mesin yang menjalankan sesi operator Telegram — satu sesi persisten per chat, yang membaca
          API hanoman lalu merangkum. Berlaku untuk sesi operator <b>berikutnya</b> yang dibuat; sesi
          yang sedang jalan tetap memakai setelan lamanya (satu proses, satu model seumur hidup) dan
          tidak di-restart diam-diam — tutup dari chat dengan <code>/engine restart</code>. Setelan
          yang sama juga bisa diubah dari chat: <code>/engine</code>, <code>/runtime</code>,{" "}
          <code>/model</code>, <code>/effort</code>. Berlaku global untuk semua chat.
        </div>
        <SettingRow title="Pakai setelan sendiri"
          desc="Mati = ikut default global di atas. Hidup = sesi operator Telegram memakai pilihan di bawah.">
          <Switch aria-label="Override agen Telegram" checked={tgEngine.enabled}
            onChange={(v: boolean) => saveTgEngine({ enabled: v },
              "Setelan operator Telegram" + (v ? " · aktif" : " · ikut default global"))} />
        </SettingRow>
        {!tgEngine.enabled ? (
          <div data-testid="telegram-engine-inherited" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 0 2px", lineHeight: 1.5 }}>
            Sesi operator Telegram memakai default global: <b>{AGENT_LABEL[inherited.agent]}</b> ·{" "}
            <code>{inherited.model}</code> · <code>{inherited.effort}</code>.
          </div>
        ) : (
          <>
            <SettingRow title="Runtime" desc="Mesin yang menjalankan sesi operator. Bisa beda dari agen sesi kerja.">
              <Select size="sm" aria-label="Runtime Telegram" value={tgEngine.agent} style={{ width: 190 }}
                options={[{ value: "claude", label: AGENT_LABEL.claude }, { value: "codex", label: AGENT_LABEL.codex }]}
                onChange={(e) => {
                  // Cermin `pickAgent`/kartu konflik/kartu lead: menukar runtime HARUS menukar
                  // model+effort sekalian, kalau tidak sesi lahir `codex -m claude-opus-5`.
                  const a = e.target.value as "claude" | "codex";
                  const d = a === "codex" ? codex : { model: s.model, effort: s.effort };
                  saveTgEngine({ agent: a, model: d.model,
                    effort: a === "codex" ? coerceCodexEffort(d.model, d.effort) : d.effort },
                    "Runtime operator Telegram → " + a);
                }} />
            </SettingRow>
            {tgEngine.agent === "codex" && codexNote(tgEngine.model)}
            <SettingRow title="Model">
              <Select size="sm" aria-label="Model Telegram" value={tgEngine.model} style={{ width: 190 }}
                options={tgEngine.agent === "codex" ? codexOptions(tgEngine.model) : S_MODELS}
                onChange={(e) => {
                  const model = e.target.value;
                  saveTgEngine({ model, ...(tgEngine.agent === "codex"
                    ? { effort: coerceCodexEffort(model, tgEngine.effort) } : {}) },
                    "Model operator Telegram → " + model);
                }} />
            </SettingRow>
            <SettingRow title="Effort" last
              desc="Operator Telegram jarang menulis kode — effort rendah memangkas latensi balasan secara langsung.">
              <Select size="sm" aria-label="Effort Telegram" value={tgEngine.effort} style={{ width: 130 }}
                options={tgEngine.agent === "codex"
                  ? codexEfforts(tgEngine.model).map((v) => ({ value: v, label: v }))
                  : S_EFFORT}
                onChange={(e) => saveTgEngine({ effort: e.target.value }, "Effort operator Telegram → " + e.target.value)} />
            </SettingRow>
          </>
        )}
      </Card>
      {/* SPEC-518 · agen pembuat changelog (SPEC-516/ADR-0105) boleh punya runtime/model/effort
          sendiri. Pekerjaannya merangkum judul backlog/commit jadi prosa rilis pendek — jauh lebih
          ringan dari sesi kerja, dan tak selalu pantas memakai model termahal. Opt-in seperti
          kartu konflik/lead/Telegram: mati = mewarisi. */}
      <Card eyebrow="changelog" title="Agen changelog">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Mesin yang menulis narasi changelog per project — panggilan sekali-jalan non-interaktif
          yang merangkum backlog selesai, rentang commit, atau isi sebuah rilis menjadi teks pendek
          berorientasi pemakai. Berlaku pada pembangkitan <b>berikutnya</b>, tanpa restart. Agen yang
          gagal tak menggagalkan changelog: barisnya tetap lahir sebagai draf ringkas ber-catatan.
        </div>
        <SettingRow title="Pakai setelan sendiri"
          desc="Mati = ikut default global di atas. Hidup = pembuat changelog memakai pilihan di bawah.">
          <Switch aria-label="Override agen changelog" checked={changelog.enabled}
            onChange={(v: boolean) => saveChangelog({ enabled: v },
              "Setelan changelog" + (v ? " · aktif" : " · ikut default global"))} />
        </SettingRow>
        {!changelog.enabled ? (
          <div data-testid="changelog-engine-inherited" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 0 2px", lineHeight: 1.5 }}>
            Pembuat changelog memakai default global: <b>{AGENT_LABEL[inherited.agent]}</b> ·{" "}
            <code>{inherited.model}</code> · <code>{inherited.effort}</code>.
          </div>
        ) : (
          <>
            <SettingRow title="Runtime" desc="Mesin yang menulis changelog. Bisa beda dari agen sesi kerja.">
              <Select size="sm" aria-label="Runtime changelog" value={changelog.agent} style={{ width: 190 }}
                options={[{ value: "claude", label: AGENT_LABEL.claude }, { value: "codex", label: AGENT_LABEL.codex }]}
                onChange={(e) => {
                  // Cermin `pickAgent`/kartu konflik/lead/Telegram: menukar runtime HARUS menukar
                  // model+effort sekalian, kalau tidak changelog lahir `codex -m claude-opus-5`.
                  const a = e.target.value as "claude" | "codex";
                  const d = a === "codex" ? codex : { model: s.model, effort: s.effort };
                  saveChangelog({ agent: a, model: d.model,
                    effort: a === "codex" ? coerceCodexEffort(d.model, d.effort) : d.effort },
                    "Runtime changelog → " + a);
                }} />
            </SettingRow>
            {changelog.agent === "codex" && codexNote(changelog.model)}
            <SettingRow title="Model">
              <Select size="sm" aria-label="Model changelog" value={changelog.model} style={{ width: 190 }}
                options={changelog.agent === "codex" ? codexOptions(changelog.model) : S_MODELS}
                onChange={(e) => {
                  const model = e.target.value;
                  saveChangelog({ model, ...(changelog.agent === "codex"
                    ? { effort: coerceCodexEffort(model, changelog.effort) } : {}) },
                    "Model changelog → " + model);
                }} />
            </SettingRow>
            <SettingRow title="Effort" last
              desc="Merangkum judul jadi prosa pendek — effort rendah biasanya cukup dan memangkas ongkos setiap pembangkitan.">
              <Select size="sm" aria-label="Effort changelog" value={changelog.effort} style={{ width: 130 }}
                options={changelog.agent === "codex"
                  ? codexEfforts(changelog.model).map((v) => ({ value: v, label: v }))
                  : S_EFFORT}
                onChange={(e) => saveChangelog({ effort: e.target.value }, "Effort changelog → " + e.target.value)} />
            </SettingRow>
          </>
        )}
      </Card>

      {/* SPEC-854 · ADR-0130 · obrolan portal klien. TANPA pemilih runtime: gerbang tool
          (`--tools`) yang menjaga fitur ini adalah flag claude, dan bentuk one-shot codex hanya
          punya bypass penuh — menawarkan pilihan agen di sini berarti menjanjikan penjagaan yang
          separuhnya tak bisa ditegakkan (ADR-0129 gotcha 5). */}
      <Card eyebrow="portal" title="Obrolan portal klien">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Permukaan obrolan di portal klien: klien memilih <b>Brainstorming</b> (digali sampai jelas,
          keluarannya PRD draft untuk Anda review) atau <b>Bertanya</b> (dijawab langsung dari dokumen
          project). Jatah berlaku <b>per project</b> dan dihitung bulanan; brainstorming dan
          pertanyaan punya jatah masing-masing. Mati = tab Obrolan tak muncul di portal.
        </div>
        <SettingRow title="Aktifkan obrolan"
          desc="Mati = klien hanya punya Pekerjaan & Help desk, persis seperti sebelumnya.">
          <Switch aria-label="Aktifkan obrolan portal" checked={portalChat.enabled}
            onChange={(v: boolean) => savePortalChat({ enabled: v },
              "Obrolan portal" + (v ? " · aktif" : " · mati"))} />
        </SettingRow>
        {portalChat.enabled && (
          <>
            <SettingRow title="Jatah brainstorming" desc="Berapa sesi brainstorming per project tiap bulan. 0 = tertutup.">
              <Input aria-label="Jatah brainstorming" type="number" min={0} max={1000}
                style={{ width: 110 }} defaultValue={portalChat.brainstormPerMonth}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) => savePortalChat(
                  { brainstormPerMonth: jatah(e.target.value, portalChat.brainstormPerMonth) },
                  "Jatah brainstorming → " + e.target.value)} />
            </SettingRow>
            <SettingRow title="Jatah pertanyaan" desc="Berapa sesi tanya-jawab per project tiap bulan. 0 = tertutup.">
              <Input aria-label="Jatah pertanyaan" type="number" min={0} max={10000}
                style={{ width: 110 }} defaultValue={portalChat.askPerMonth}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) => savePortalChat(
                  { askPerMonth: jatah(e.target.value, portalChat.askPerMonth) },
                  "Jatah pertanyaan → " + e.target.value)} />
            </SettingRow>
            <SettingRow title="Model" desc="Mesin obrolan selalu Claude — gerbang tool yang menjaganya tak ada di runtime lain.">
              <Select size="sm" aria-label="Model obrolan portal" value={portalChat.model}
                style={{ width: 190 }} options={S_MODELS}
                onChange={(e) => savePortalChat({ model: e.target.value },
                  "Model obrolan portal → " + e.target.value)} />
            </SettingRow>
            <SettingRow title="Effort">
              <Select size="sm" aria-label="Effort obrolan portal" value={portalChat.effort}
                style={{ width: 130 }} options={S_EFFORT}
                onChange={(e) => savePortalChat({ effort: e.target.value },
                  "Effort obrolan portal → " + e.target.value)} />
            </SettingRow>
            <SettingRow title="Batas waktu satu jawaban" last
              desc="Detik. Lewat dari ini klien menerima kalimat 'coba lagi sebentar', bukan layar menggantung.">
              <Input aria-label="Batas waktu obrolan portal" type="number" min={10} max={900}
                style={{ width: 110 }} defaultValue={portalChat.timeoutSec}
                onBlur={(e: React.FocusEvent<HTMLInputElement>) => savePortalChat(
                  { timeoutSec: jatah(e.target.value, portalChat.timeoutSec) },
                  "Batas waktu obrolan → " + e.target.value)} />
            </SettingRow>
          </>
        )}
      </Card>
      </>
      );
    }
    return ( // sesi
      <>
      <Card eyebrow="sesi" title="Sesi & notifikasi">
        <SettingRow title="Notifikasi backlog selesai"
          desc="Toast + sound saat sebuah backlog mencapai stage done. Daftar lonceng tetap terisi meski dimatikan.">
          <Switch checked={s.notifyDone} onChange={sw("notifyDone", "Notifikasi backlog selesai")} />
        </SettingRow>
        <SettingRow title="Sound notifikasi" desc="Durasi nada saat backlog selesai.">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Select size="sm" value={s.notifySound} options={S_SOUNDS} style={{ width: 160 }}
              onChange={(e) => save({ notifySound: e.target.value as NotifySound }, "Sound → " + e.target.value)} />
            <Button size="sm" variant="ghost" leftIcon="volume-2" disabled={s.notifySound === "off"}
              onClick={() => playNotifySound(s.notifySound as NotifySound)}>Preview</Button>
          </div>
        </SettingRow>
        <SettingRow title="Notifikasi butuh keputusan"
          desc="Toast + sound saat sesi Claude berhenti menunggu keputusanmu. Nada sengaja beda dari selesai.">
          <Switch checked={s.notifyDecision} onChange={sw("notifyDecision", "Notifikasi keputusan")} />
        </SettingRow>
        <SettingRow title="Sound keputusan" desc="Nada saat sebuah sesi menunggu keputusan.">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Select size="sm" value={s.notifyDecisionSound} options={S_SOUNDS} style={{ width: 160 }}
              onChange={(e) => save({ notifyDecisionSound: e.target.value as NotifySound }, "Sound keputusan → " + e.target.value)} />
            <Button size="sm" variant="ghost" leftIcon="volume-2" disabled={s.notifyDecisionSound === "off"}
              onClick={() => playNotifySound(s.notifyDecisionSound as NotifySound)}>Preview</Button>
          </div>
        </SettingRow>
        <SettingRow title="Notifikasi saat sesi gagal" last desc="Kirim notifikasi ketika sesi Claude Code berakhir dengan error.">
          <Switch checked={s.notifyFail} onChange={sw("notifyFail", "Notifikasi gagal")} />
        </SettingRow>
      </Card>
      {/* SPEC-332 · ADR-0073 · mode goal: sesi menolak berhenti sampai kondisi terbukti. Ini default
          global untuk sesi backlog; setiap Start masih bisa meng-override. Berlaku untuk KEDUA agen
          sejak SPEC-397/ADR-0085 — claude lewat Stop hook prosa + `/goal`, codex lewat gate sh
          deterministik + goal native codex — jadi teksnya sengaja netral-agen. */}
      <Card eyebrow="goal" title="Mode goal — sesi backlog">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Sesi backlog lahir dengan gate <code>Stop</code>: ia menolak berhenti sampai kondisinya terbukti
          di transkrip. Interupsi manusia (<code>Esc</code>) tetap bekerja; melepas gate sepenuhnya =
          hentikan sesinya. Sesi scheduler mengikuti setelan ini.
        </div>
        <SettingRow title="Aktif sebagai default"
          desc="Sesi backlog baru lahir dengan mode goal. Masih bisa dimatikan per sesi saat Start.">
          <Switch aria-label="Mode goal default" checked={s.goal.enabled}
            onChange={(v: boolean) => save({ goal: { ...s.goal, enabled: v } },
              "Mode goal" + (v ? " · aktif" : " · nonaktif"))} />
        </SettingRow>
        <SettingRow title="Kondisi (template global)" last
          desc="Kosong = kondisi bawaan hanoman: semua fase tercatat di phase file, plan tak menyisakan task, push sukses.">
          <div style={{ width: 320 }}>
            {/* SPEC-490 · `SettingRow` bukan <label>, jadi textarea ini tak punya nama yang bisa
                dipegang pembaca layar maupun test — placeholder bukan penggantinya. */}
            <HnTextarea value={s.goal.condition} rows={4} mono aria-label="Kondisi mode goal"
              placeholder="Kosong = kondisi bawaan hanoman · mis. semua fase tercatat & plan tanpa - [ ]"
              onChange={(e) => persist({ ...s, goal: { ...s.goal, condition: e.target.value } })} />
          </div>
        </SettingRow>
      </Card>
      {/* SPEC-376 · ADR-0080 · scope verifikasi: default global untuk sesi backlog; tiap Start
          masih bisa meng-override. Bukan gerbang — sesi diarahkan lewat klausa prompt, tak ada
          hook yang menolak perintah (ADR-0037 utuh). */}
      <Card eyebrow="verifikasi" title="Scope verifikasi — sesi backlog">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Beberapa sesi berjalan bersamaan di mesin ini. <b>Hanya yang berubah</b> menyuruh sesi menguji
          berkas yang benar-benar ia sentuh (<code>vitest --changed</code>, typecheck per paket, lint per
          berkas) alih-alih seluruh project — RAM & CPU tetap tersisa untuk sesi lain. Suite penuh, lint
          penuh, dan build penuh tetap dijalankan manusia sebelum merge.
        </div>
        <SettingRow title="Scope default" last
          desc="Sesi backlog baru lahir dengan scope ini. Masih bisa diubah per sesi saat Start.">
          <Select size="sm" aria-label="Scope verifikasi default" value={s.verifyScope ?? "changed"} style={{ width: 220 }}
            options={[
              { value: "changed", label: "Hanya yang berubah" },
              { value: "full", label: "Seluruh project" },
            ]}
            onChange={(e) => save({ verifyScope: e.target.value as Setting["verifyScope"] },
              "Scope verifikasi → " + e.target.value)} />
        </SettingRow>
      </Card>
      {/* SPEC-734 · ADR-0113 · metode workflow: default global untuk sesi backlog; tiap Start masih
          bisa meng-override, dan item yang sudah pernah jalan memakai metode tercatatnya. */}
      <Card eyebrow="metode" title="Metode workflow — sesi backlog">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Metode menentukan <b>skill mana yang dimuat di tiap fase</b> dan <b>di direktori mana plan
          &amp; spec ditulis</b>. Fase-fasenya sendiri tak berubah. Gerbang plan memindai direktori
          SEMUA metode, jadi item yang berpindah metode tak pernah lolos lewat direktori kosong.
        </div>
        <SettingRow title="Metode default" last
          desc="Sesi backlog baru lahir dengan metode ini. Masih bisa diubah per sesi saat Start.">
          <Select size="sm" aria-label="Metode default" style={{ width: 220 }}
            value={resolveMethod(s.method).id}
            options={METHOD_IDS.map((id) => ({ value: id, label: METHODS[id]!.label }))}
            onChange={(e) => save({ method: e.target.value }, "Metode → " + e.target.value)} />
        </SettingRow>
        {/* SPEC-739 · ADR-0114 · checklist kesiapan menggantikan baris statis "Butuh terpasang: …":
            field itu punya nol pembaca runtime sampai spec ini, jadi hanoman menjanjikan
            metodologi yang tak pernah ia pastikan ada. Metode yang belum siap DITANDAI, tak
            pernah diblokir — sesi tetap boleh lahir (ADR-0037). */}
        {methodStatuses && (
          <div data-testid="method-status" style={{ marginTop: 4, display: "grid", gap: 10 }}>
            {METHOD_IDS.map((id) => (
              <div key={id} style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{METHODS[id]!.label}</div>
                {methodStatuses.methods.filter((m) => m.method === id).map((m) => (
                  <div key={m.agent} data-testid={`method-status-${m.method}-${m.agent}`}
                    style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                    <Badge tone={m.ready ? "ok" : "warn"}>{m.ready ? "siap" : "belum siap"}</Badge>
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <b>{AGENT_LABEL[m.agent]}</b>
                      {!m.ready && (
                        <div style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                          {m.missingPackages.length > 0 && (
                            <div>paket kurang: <code>{m.missingPackages.join(" · ")}</code></div>)}
                          {m.missingSkills.length > 0 && (
                            <div>skill kurang: <code>{m.missingSkills.join(" · ")}</code></div>)}
                        </div>
                      )}
                    </div>
                    {!m.ready && (
                      <Button size="sm" variant="ghost" leftIcon="download" disabled={!installProject}
                        onClick={() => installMethod(m)}>Pasang</Button>
                    )}
                  </div>
                ))}
              </div>
            ))}
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {installProject
                ? <>Pemasangan berjalan di <b>sesi terminal</b> project <code>{installProject}</code> — outputnya
                  bisa ditonton di Terminal. hanoman sendiri tak pernah memasang apa pun.</>
                : <>Pemasangan butuh satu project yang sudah di-bind ke checkout lokal: perintahnya
                  dijalankan di sesi terminal project itu.</>}
            </div>
          </div>
        )}
      </Card>
      </>
    );
  }

  const content = tab === "setup" ? <SetupPanel />
    : tab === "akun" ? <AccountPanel me={me} onLoggedOut={onLoggedOut} onToast={onToast} />
    : tab === "users" ? <UsersPanel me={me} onToast={onToast} />
    : tab === "akses-klien" ? <ClientAccessPanel />
    : tab === "perangkat" ? <DeviceTokensPanel onToast={onToast} />
    : tab === "agent" ? <AgentAccessPanel onToast={onToast} />
    // SPEC-450 · ADR-0094 · permukaan GLOBAL katalog custom agent. Komponen yang sama dipakai
    // Project detail dengan projectId terisi — satu panel, dua scope.
    : tab === "custom-agent" ? (
      <Card eyebrow="agen" title="Custom agent — global">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Persona yang tersedia untuk <b>setiap sesi baru</b> di semua project. Sesi <b>claude</b>
          menerimanya sebagai subagent sungguhan; sesi <b>codex</b> menerimanya sebagai peran yang
          diadopsi di dalam sesi. Agen boleh saling memanggil lewat <i>Mention</i>, dan grafnya wajib
          asiklik — agen tanpa mention tak diberi alat delegasi sama sekali.
        </div>
        <CustomAgentsPanel projectId={null} onToast={onToast} />
      </Card>
    )
    : tab === "aktivitas" ? <ActivityPanel onToast={onToast} />
    : tab === "konfigurasi" ? <ConfigPanel onToast={onToast} />
    : tab === "webhook" ? (webhookDocs
      ? <WebhookDocs onBack={() => setWebhookDocs(false)} />
      : <WebhooksPanel onToast={onToast} onOpenDocs={() => setWebhookDocs(true)} />)
    : prefs();

  return (
    <div className="hn-settings-layout" data-layout={tier} style={{ display: "grid", gridTemplateColumns: mobile ? "minmax(0, 1fr)" : tier === "tablet" ? "160px minmax(0, 1fr)" : "196px minmax(0, 1fr)", gap: tier === "tablet" ? 16 : 24, alignItems: "start", maxWidth: 920 }}>
      {mobile ? (
        <Select aria-label="Bagian pengaturan" value={tab} onChange={(event) => setTab(event.target.value)}
          options={S_SECTIONS.map((section) => ({ value: section.key, label: section.label }))} />
      ) : <nav aria-label="Navigasi pengaturan" style={{ display: "flex", flexDirection: "column", gap: 2, position: "sticky", top: 0 }}>
        {S_SECTIONS.map((sec) => {
          const on = sec.key === tab;
          return (
            <button key={sec.key} aria-current={on ? "page" : undefined} onClick={() => setTab(sec.key)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px",
              border: "none", cursor: "pointer", textAlign: "left", borderRadius: "var(--radius-sm)",
              background: on ? "var(--brass-100)" : "transparent",
              color: on ? "var(--brass-700)" : "var(--text-muted)", fontWeight: on ? 600 : 500,
              fontFamily: "var(--font-ui)", fontSize: 13.5,
            }}>
              <Icon name={sec.icon} size={16} color={on ? "var(--brass-700)" : "var(--text-subtle)"} />
              {sec.label}
            </button>
          );
        })}
      </nav>}
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>{content}</div>
    </div>
  );
}
