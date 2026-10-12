// Audit UI/UX 2026-10 · Fase 3C · niat "Lanjutan": akun, pengguna, setup awal, konfigurasi env, log
// aktivitas, custom agent, dan zona bahaya. Tertutup secara default di navigasi; isinya dipindah dari
// SettingsScreen tanpa perubahan perilaku (SPEC-169, SPEC-213, SPEC-215, SPEC-884, SPEC-450).
import React from "react";
import { Button, Card, Field, Input, StateBlock, Switch, useConfirm } from "../../ds";
import type { ShowToast } from "../../ds";
import { api, ApiError } from "../../api/client";
import { failureMessage } from "../../lib/report-error";
import { configEntry } from "@hanoman/shared";
import type { ConfigEntryView, ConfigResponse, SessionResultView, SetupStatus, UserView, Setting } from "@hanoman/shared";
import { SetupWizard } from "../SetupWizard";
import { CustomAgentsPanel } from "../CustomAgentsPanel";
import { S_DEFAULTS } from "./model";
import { BlockedHint, Prose, SettingRow } from "./rows";
import type { SettingsStore } from "./useSettingsStore";

// ── Akun ──────────────────────────────────────────────────────────────────────

// SPEC-169 · Akun: email, logout, ganti password sendiri.
export function AccountPanel({ me, onLoggedOut, onToast }: { me: UserView; onLoggedOut: () => void; onToast?: ShowToast }) {
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const hintId = React.useId();
  const blocked = !cur ? "Isi password lama dulu." : next.length < 8 ? "Password baru minimal 8 karakter." : null;
  const canChange = !blocked && !busy;
  async function changePw() {
    if (!canChange) return;
    setBusy(true);
    try {
      await api.changePassword({ currentPassword: cur, newPassword: next });
      setCur(""); setNext("");
      onToast?.("Password diganti · perangkat lain ter-logout", "ok", "key-round");
    } catch (e) {
      onToast?.(e instanceof ApiError && e.status === 400 ? "Password lama salah" : failureMessage("mengganti password", e), "err", "x-circle");
    } finally { setBusy(false); }
  }
  async function logout() { try { await api.logout(); } finally { onLoggedOut(); } }
  return (
    <Card eyebrow="akun" title="Akun" data-setting-card data-search="akun password logout email"
      actions={<Button size="sm" variant="ghost" leftIcon="log-out" onClick={logout}>Logout</Button>}>
      <SettingRow title="Masuk sebagai" desc={me.email}>
        <span className="hn-set-mono hn-set-muted">{me.id}</span>
      </SettingRow>
      <div className="hn-set-block">
        <div className="hn-set-subhead">Ganti password</div>
        {/* <form>: Enter di kolom mana pun mengirim, sama dengan menekan Ganti. */}
        <form onSubmit={(ev) => { ev.preventDefault(); void changePw(); }}>
          <div className="hn-grid-mobile hn-set-form3">
            <Field label="Password lama"><Input type="password" autoComplete="current-password" placeholder="••••••••" value={cur}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCur(e.target.value)} className="hn-set-full" /></Field>
            <Field label={<>Password baru <span className="hn-set-hintlabel">· min 8</span></>}>
              <Input type="password" autoComplete="new-password" placeholder="minimal 8 karakter" value={next}
                aria-invalid={next.length > 0 && next.length < 8 ? true : undefined}
                invalid={next.length > 0 && next.length < 8}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNext(e.target.value)} className="hn-set-full" /></Field>
            <Button size="sm" type="submit" leftIcon="key-round" disabled={!canChange}
              aria-describedby={blocked ? hintId : undefined} className="hn-set-btn-align">Ganti</Button>
          </div>
          <BlockedHint id={hintId} text={blocked} />
        </form>
      </div>
    </Card>
  );
}

// ── Pengguna ──────────────────────────────────────────────────────────────────

// SPEC-169 · Pengguna: daftar, undang (set password langsung), hapus. Tanpa RBAC — semua setara.
export function UsersPanel({ me, onToast }: { me: UserView; onToast?: ShowToast }) {
  // SPEC-847 · ADR-0127 · konfirmasi destruktif memakai dialog aplikasi, bukan window.confirm.
  const { confirm, dialog } = useConfirm();
  const [users, setUsers] = React.useState<UserView[] | null>(null);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const hintId = React.useId();
  const load = React.useCallback(() => { api.listUsers().then(setUsers).catch(() => setUsers([])); }, []);
  React.useEffect(() => { load(); }, [load]);
  const emailBad = email.length > 0 && !/\S+@\S+\.\S+/.test(email);
  const blocked = !email ? "Isi email pengguna dulu."
    : emailBad ? "Format email belum benar."
    : password.length < 8 ? "Password minimal 8 karakter."
    : null;
  const canInvite = !blocked && !busy;
  async function invite() {
    if (!canInvite) return;
    setBusy(true);
    try {
      await api.inviteUser({ email, password });
      setEmail(""); setPassword(""); load();
      onToast?.("Pengguna " + email + " diundang", "ok", "user-plus");
    } catch (e) {
      onToast?.(e instanceof ApiError && e.status === 409 ? "Email sudah dipakai" : failureMessage("mengundang pengguna", e), "err", "x-circle");
    } finally { setBusy(false); }
  }
  async function remove(u: UserView) {
    try {
      if (!await confirm({
        title: `Hapus pengguna "${u.email}"?`,
        message: "Pengguna ini kehilangan akses ke dashboard seketika.",
        impact: ["Semua sesi login miliknya ikut dicabut.", "Tindakan ini tak bisa dibatalkan."],
        confirmLabel: "Hapus pengguna",
        run: () => api.deleteUser(u.id),
      })) return;
      load(); onToast?.("Pengguna " + u.email + " dihapus", "warn", "trash-2");
    }
    catch (e) { onToast?.(e instanceof ApiError && e.status === 400 ? "Tak bisa hapus pengguna terakhir" : failureMessage("menghapus pengguna", e), "err", "x-circle"); }
  }
  return (
    <Card eyebrow="users" title="Pengguna" data-setting-card data-search="pengguna undang hapus email password">
      <Prose>Undang pengguna lain dengan menetapkan password-nya langsung — tanpa email undangan.</Prose>
      {users === null ? <StateBlock kind="loading" compact title="Memuat pengguna…" /> : users.map((u, i) => (
        <SettingRow key={u.id} title={u.email} last={i === users.length - 1}
          desc={"dibuat " + new Date(u.createdAt).toLocaleDateString("id-ID") + (u.id === me.id ? " · kamu" : "")}>
          <Button size="sm" variant="ghost" leftIcon="trash-2" disabled={users.length <= 1} onClick={() => remove(u)}>Hapus</Button>
        </SettingRow>
      ))}
      <div className="hn-set-block">
        <div className="hn-set-subhead">Undang pengguna</div>
        <form onSubmit={(ev) => { ev.preventDefault(); void invite(); }}>
          <div className="hn-grid-mobile hn-set-form3">
            <Field label="Email"><Input type="email" value={email} placeholder="user@nafanesia.id"
              aria-invalid={emailBad ? true : undefined} invalid={emailBad}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} className="hn-set-full" /></Field>
            <Field label={<>Password <span className="hn-set-hintlabel">· min 8</span></>}>
              <Input type="password" autoComplete="new-password" placeholder="minimal 8 karakter" value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} className="hn-set-full" /></Field>
            <Button size="sm" type="submit" leftIcon="user-plus" disabled={!canInvite}
              aria-describedby={blocked ? hintId : undefined} className="hn-set-btn-align">Undang</Button>
          </div>
          <BlockedHint id={hintId} text={blocked} />
        </form>
      </div>
      {dialog}
    </Card>
  );
}

// ── Setup awal ────────────────────────────────────────────────────────────────

/**
 * SPEC-884 · ADR-0139 · setup awal bisa ditinjau & diubah kapan saja. Jalur ini TAK PERNAH menyentuh
 * akun — hanya peruntukan dan hardening; akun tetap lahir sekali di AuthScreen.
 */
export function SetupPanel() {
  const [setup, setSetup] = React.useState<SetupStatus | null>(null);
  const [rerun, setRerun] = React.useState(false);
  const load = React.useCallback(() => {
    api.setupStatus().then(setSetup).catch(() => setSetup(null));
  }, []);
  React.useEffect(load, [load]);
  if (!setup) return <StateBlock kind="loading" title="Memuat setup…" />;
  if (rerun) return <SetupWizard status={setup} onDone={() => { setRerun(false); load(); }}
    onCancel={() => setRerun(false)} />;
  return (
    <div data-testid="setup-card" data-setting-card>
      <Card eyebrow="setup" title="Setup awal" data-search="setup awal peruntukan hardening ulang">
        <div className="hn-set-setupstatus">
          Peruntukan: {setup.deployment === "local" ? "Perangkat ini" : "Diakses orang lain"}
          <br />
          {setup.hardening ? "Hardening menyala" : "Hardening mati"}
          {setup.hardeningLocked ? " — dipasang lewat env, tak bisa diubah dari sini" : ""}
        </div>
        <Button onClick={() => setRerun(true)}>Jalankan ulang setup</Button>
      </Card>
    </div>
  );
}

// ── Konfigurasi (env) ─────────────────────────────────────────────────────────

// SPEC-215 · atur env non-bootstrap via Settings. Secret: mask + "Ganti"; bootstrap read-only.
const GROUP_LABEL: Record<string, string> = {
  sync: "Sync", claude: "Claude", vps: "VPS", runtime: "Runtime", bootstrap: "Bootstrap (read-only)",
};
// Jargon `source · apply` diterjemahkan: dari mana nilainya, dan kapan ia berlaku.
const SOURCE_WORD: Record<ConfigEntryView["source"], string> = {
  db: "tersimpan di database", env: "dari .env", default: "bawaan",
};
const APPLY_WORD: Record<ConfigEntryView["apply"], string> = {
  live: "langsung berlaku", "new-session": "untuk sesi baru", restart: "perlu restart",
};
const APPLY_NOTE: Record<ConfigEntryView["apply"], string> = {
  live: "Berlaku langsung.", "new-session": "Berlaku untuk sesi baru.", restart: "Berlaku setelah server di-restart.",
};

export function ConfigPanel({ onToast }: { onToast?: ShowToast }) {
  const { confirm, dialog } = useConfirm();
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
    catch (err) { onToast?.(failureMessage(`menyimpan ${e.label}`, err), "err", "x-circle"); }
  };
  // Reset menghapus nilai override di database: yang berlaku kembali nilai .env atau bawaan.
  const reset = async (e: ConfigEntryView) => {
    const secret = e.kind === "secret";
    try {
      if (!await confirm({
        title: secret ? `Hapus nilai "${e.label}"?` : `Reset "${e.label}" ke bawaan?`,
        message: secret ? "Nilai rahasia ini hilang dari database." : "Nilai yang Anda atur untuk setelan ini dihapus.",
        impact: [
          "Yang berlaku kembali nilai dari .env atau nilai bawaan aplikasi.",
          APPLY_NOTE[e.apply],
          "Tindakan ini tak bisa dibatalkan — nilai lama tidak disimpan sebagai cadangan.",
        ],
        confirmLabel: secret ? "Hapus nilai" : "Reset",
        tone: "danger",
        icon: secret ? "trash-2" : "rotate-ccw",
        run: () => api.deleteConfig(e.key),
      })) return;
      clearDraft(e.key); load(); onToast?.(`${e.label} direset`, "warn", "rotate-ccw");
    } catch (err) { onToast?.(failureMessage(`mereset ${e.label}`, err), "err", "x-circle"); }
  };

  const groups = [...new Set(data.entries.map((e) => e.group))];
  return (
    <>
      <Prose>Setiap baris disimpan lewat tombolnya sendiri. Nilai bawaan tak berubah sampai Anda mereset setelan itu.</Prose>
      {groups.map((g) => (
        <Card key={g} eyebrow={g} title={GROUP_LABEL[g] ?? g} data-setting-card data-search={`${g} ${GROUP_LABEL[g] ?? g} konfigurasi env`}>
          {g === "sync" && (
            <div className="hn-set-muted hn-set-syncline">
              {data.sync.running ? (data.sync.connected ? "● Tersambung ke server pusat" : "◐ Sinkron aktif, menyambung…") : "○ Tidak sinkron (instance ini adalah server pusat)"}
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
      {dialog}
    </>
  );
}

function ConfigField({ entry, draft, onDraft, onSave, onReset }: {
  entry: ConfigEntryView; draft?: string; onDraft: (v: string) => void; onSave: () => void; onReset: () => void;
}) {
  const badge = <span title={APPLY_NOTE[entry.apply]} className="hn-set-badgeword">{SOURCE_WORD[entry.source]} · {APPLY_WORD[entry.apply]}</span>;
  if (!entry.editable) { // bootstrap read-only
    return <div className="hn-set-inline">{badge}
      <code className="hn-set-codeinline">{entry.masked ?? entry.value ?? "—"}</code></div>;
  }
  // <form>: Enter di kolom mengirim, sama dengan menekan Simpan.
  const submit = (ev: React.FormEvent) => { ev.preventDefault(); onSave(); };
  if (entry.kind === "secret") {
    return <div className="hn-set-inline hn-set-wrap">{badge}
      {entry.hasValue && draft === undefined
        ? <><code className="hn-set-codeinline">{entry.masked}</code>
            <Button size="sm" variant="ghost" leftIcon="pencil" onClick={() => onDraft("")}>Ganti</Button>
            <Button size="sm" variant="danger-outline" leftIcon="trash-2" onClick={onReset}>Hapus</Button></>
        : <form onSubmit={submit} className="hn-set-inline hn-set-wrap">
            <Input aria-label={entry.label} type="password"
              placeholder={entry.hasValue ? "biarkan kosong = pertahankan" : (configEntry(entry.key)?.example ?? "tempel token…")}
              value={draft ?? ""} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => onDraft(ev.target.value)} className="hn-set-w-input" />
            <Button size="sm" type="submit" leftIcon="save">Simpan</Button>
          </form>}
    </div>;
  }
  if (entry.kind === "bool") {
    const on = (draft ?? entry.value) === "1";
    return <div className="hn-set-inline">{badge}
      <Switch checked={on} aria-label={entry.label} onChange={(v: boolean) => { onDraft(v ? "1" : "0"); }} />
      {draft !== undefined && <Button size="sm" leftIcon="save" onClick={onSave}>Simpan</Button>}</div>;
  }
  // url | int | string | path
  return <form onSubmit={submit} className="hn-set-inline hn-set-wrap">{badge}
    <Input aria-label={entry.label} type={entry.kind === "int" ? "number" : "text"}
      placeholder={configEntry(entry.key)?.example}
      value={draft ?? entry.value ?? ""} onChange={(ev: React.ChangeEvent<HTMLInputElement>) => onDraft(ev.target.value)} className="hn-set-w-input" />
    <Button size="sm" type="submit" leftIcon="save">Simpan</Button>
    {entry.source === "db" && <Button size="sm" variant="danger-outline" leftIcon="rotate-ccw" onClick={onReset}>Reset</Button>}</form>;
}

// ── Log aktivitas ─────────────────────────────────────────────────────────────

// SPEC-213 · Log aktivitas: ringkasan hasil sesi lintas perangkat (append-only, disync dari semua perangkat).
export function ActivityPanel({ onToast }: { onToast?: ShowToast }) {
  const { confirm, dialog } = useConfirm();
  const [projectId, setProjectId] = React.useState("");
  const [rows, setRows] = React.useState<SessionResultView[] | null>(null);
  const hintId = React.useId();
  const load = React.useCallback(() => { api.listSessionResults(projectId || undefined).then(setRows).catch(() => setRows([])); }, [projectId]);
  React.useEffect(() => { load(); }, [load]);
  const blocked = projectId ? null : "Isi nama project dulu untuk menghapus log satu project.";
  async function purge() {
    if (blocked) return;
    try {
      if (!await confirm({
        title: `Hapus log aktivitas project "${projectId}"?`,
        message: "Seluruh entri hasil sesi project ini dihapus dari perangkat ini.",
        impact: ["Log aktivitas hanya bisa ditambah, jadi entri yang dihapus tak bisa dipulihkan."],
        confirmLabel: "Hapus log",
        run: async () => {
          const r = await api.purgeSessionResults(projectId);
          onToast?.(`${r.purged} entri dihapus`, "warn", "trash-2");
        },
      })) return;
      load();
    }
    catch (e) { onToast?.(failureMessage("menghapus log aktivitas", e), "err", "x-circle"); }
  }
  return (
    <Card eyebrow="aktivitas" title="Log aktivitas" data-setting-card data-search="log aktivitas hasil sesi project hapus">
      <Prose>Ringkasan hasil sesi dari semua perangkat (perpindahan tahap, commit, PR). Hanya bisa ditambah. Saring per project.</Prose>
      <div className="hn-grid-mobile hn-set-form2 hn-set-spaced">
        <Field label="Project (opsional)"><Input value={projectId} placeholder="mis. hanoman — kosong = semua project"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProjectId(e.target.value)} className="hn-set-full" /></Field>
        <Button size="sm" variant="danger-outline" leftIcon="trash-2" disabled={!!blocked}
          aria-describedby={blocked ? hintId : undefined} onClick={purge} className="hn-set-btn-align">Hapus log</Button>
      </div>
      <BlockedHint id={hintId} text={blocked} />
      {rows === null ? <StateBlock kind="loading" compact title="Memuat aktivitas…" />
        : rows.length === 0 ? <div className="hn-set-empty">Belum ada aktivitas.</div>
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

// ── Custom agent ──────────────────────────────────────────────────────────────

/** SPEC-450 · ADR-0094 · permukaan GLOBAL katalog custom agent. Komponen yang sama dipakai Project detail. */
export function CustomAgentCard({ runtime, onToast }: { runtime?: Setting["agent"]; onToast?: ShowToast }) {
  return (
    <Card eyebrow="agen" title="Custom agent — global" data-setting-card data-search="custom agent global persona mention katalog">
      <Prose>
        Persona yang tersedia untuk <b>setiap sesi baru</b> di semua project. Sesi <b>claude</b>
        dan <b>codex</b> menerima child native dengan konteks terpisah. Agen boleh saling memanggil
        lewat <i>Mention</i>, dan grafnya wajib asiklik — agen tanpa mention tak diberi alat delegasi sama sekali.
      </Prose>
      <CustomAgentsPanel projectId={null} runtime={runtime} onToast={onToast} />
    </Card>
  );
}

// ── Zona bahaya ───────────────────────────────────────────────────────────────

/**
 * Reset ke default menyentuh SEMUA Setting, termasuk kendali jarak jauh & log yang punya halamannya
 * sendiri — dialognya harus menyebut itu, bukan membiarkan reset diam-diam mematikannya.
 */
export function DangerZone({ s, store, onToast }: { s: Setting | null; store: SettingsStore; onToast?: ShowToast }) {
  const { confirm, dialog } = useConfirm();
  const resetDefaults = async () => {
    if (!await confirm({
      title: "Kembalikan semua setelan ke default?",
      message: "Setelan di seluruh halaman ini kembali ke nilai default hanoman.",
      impact: [
        "Sesi, model, notifikasi, mode goal, scope verifikasi, metode, konflik, lead, Telegram, dan obrolan portal kembali ke default.",
        "Orkestrasi (model dan effort per fase) dan penanda suntingan agen bawaan ikut kembali ke default.",
        "Kendali jarak jauh, pengiriman log, dan retensi log ikut kembali ke default (mati).",
        "Nilai yang sudah Anda atur tidak disimpan sebagai cadangan.",
      ],
      confirmLabel: "Kembalikan ke default",
      tone: "danger",
      icon: "rotate-ccw",
    })) return;
    void store.persist(JSON.parse(JSON.stringify(S_DEFAULTS)) as Setting,
      "Pengaturan dikembalikan ke default", "warn", "rotate-ccw");
  };
  return (
    <Card eyebrow="bahaya" title="Zona bahaya" data-setting-card data-search="zona bahaya reset ke default kembalikan semua setelan">
      <Prose>Tindakan di sini menyentuh seluruh pengaturan. Setiap tindakan meminta konfirmasi dan menyebut dampaknya.</Prose>
      <SettingRow title="Reset ke default" last
        desc="Mengembalikan semua setelan Pengaturan ke nilai bawaan hanoman. Nilai yang sudah diatur tidak disimpan sebagai cadangan.">
        <Button size="sm" variant="danger" leftIcon="rotate-ccw" disabled={!s} onClick={() => void resetDefaults()}>
          Reset ke default
        </Button>
      </SettingRow>
      {dialog}
    </Card>
  );
}
