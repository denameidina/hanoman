/* VpsScreen — daftar VPS: reachable/hardened, audit per check, tombol
   Audit / Harden / Sesi Claude (SPEC-164). Screen mandiri (pola SettingsScreen):
   memuat datanya sendiri, App hanya memasang Shell. */
import React from "react";
import { Button, Modal, Field, Input, StateBlock, StatusPill, Icon } from "../ds";
import { api } from "../api/client";
import { subscribe } from "../api/events";
import type { VpsView } from "@hanoman/shared";
import { VpsChecklistModal } from "./VpsChecklist";
import { usePersistedState, nullableStr } from "../ui-state";

// reachable = healthcheck terakhir sukses dalam 2× interval 5 menit (SPEC-164 §4).
export const isReachable = (v: VpsView, now: number = Date.now()): boolean =>
  !!v.lastSeenAt && now - new Date(v.lastSeenAt).getTime() < 10 * 60_000;
export const hardenedLabel = (v: VpsView): "hardened" | "belum" | "unknown" =>
  !v.lastAuditAt ? "unknown" : v.hardened ? "hardened" : "belum";

// Kosakata status StatusPill yang ada: ok (hijau) · broken (merah) · idle (abu).
const HARDENED_PILL = {
  hardened: { status: "ok", label: "hardened" },
  belum: { status: "broken", label: "belum hardened" },
  unknown: { status: "idle", label: "belum diaudit" },
} as const;

export type VpsForm = { name: string; host: string; user: string; port: string; keyPath: string; password: string };

// Field kosong TIDAK dikirim: string kosong akan ditolak zod (min(1)), dan `keyPath: ""`
// bukan cara mengosongkan keyPath — itu `null`, lewat modal Edit.
export function vpsFormToBody(f: VpsForm) {
  const b: Record<string, unknown> = {
    name: f.name.trim(), host: f.host.trim(), user: f.user.trim(), port: Number(f.port) || 22 };
  if (f.keyPath.trim()) b.keyPath = f.keyPath.trim();
  if (f.password) b.password = f.password;
  return b as { name: string; host: string; user: string; port: number; keyPath?: string; password?: string };
}

const PASSWORD_HINT = "opsional — dipakai sekali untuk memasang key hanoman, tidak disimpan";

// Satu form untuk daftar & edit: bedanya cuma judul, tombol, dan nilai awal.
function VpsModal({ open, title, submitLabel, initial, onClose, onSubmit }:
  { open: boolean; title: string; submitLabel: string; initial: VpsForm;
    onClose: () => void; onSubmit: (f: VpsForm) => void }) {
  const [f, setF] = React.useState(initial);
  React.useEffect(() => { if (open) setF(initial); }, [open, initial]);
  const set = (k: keyof VpsForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const canSubmit = !!(f.name.trim() && f.host.trim() && f.user.trim());
  return (
    <Modal open={open} onClose={onClose} icon="server" eyebrow="infra" title={title}
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" onClick={() => canSubmit && onSubmit(f)}>{submitLabel}</Button>
      </>}>
      <Field label="Nama"><Input value={f.name} onChange={set("name")} placeholder="mis. web-1" style={{ width: "100%" }} /></Field>
      <Field label="Host" hint="hostname atau IP — tanpa user@">
        <Input value={f.host} onChange={set("host")} mono placeholder="203.0.113.10" style={{ width: "100%" }} /></Field>
      <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <Field label="User SSH" hint="root atau user ber-passwordless-sudo">
          <Input value={f.user} onChange={set("user")} mono placeholder="deploy" style={{ width: "100%" }} /></Field>
        <Field label="Port"><Input value={f.port} onChange={set("port")} mono placeholder="22" style={{ width: "100%" }} /></Field>
      </div>
      <Field label="Password SSH" hint={PASSWORD_HINT}>
        <Input type="password" value={f.password} onChange={set("password")}
          placeholder="••••••••" style={{ width: "100%" }} /></Field>
      <Field label="Key path" hint="kosongkan bila memakai password di atas, atau key default mesin server">
        <Input value={f.keyPath} onChange={set("keyPath")} mono placeholder="~/.ssh/id_ed25519" style={{ width: "100%" }} /></Field>
    </Modal>
  );
}

const BLANK: VpsForm = { name: "", host: "", user: "", port: "22", keyPath: "", password: "" };
const formOf = (v: VpsView): VpsForm => ({
  name: v.name, host: v.host, user: v.user, port: String(v.port), keyPath: v.keyPath ?? "", password: "" });

export function VpsScreen({ onToast, onGotoTerminal }:
  { onToast: (msg: string, kind?: string, icon?: string) => void; onGotoTerminal: () => void }) {
  const [list, setList] = React.useState<VpsView[]>([]);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState<string | null>(null); // "<aksi>:<id>"
  // null = tertutup · "new" = daftar · VpsView = edit
  const [modal, setModal] = React.useState<null | "new" | VpsView>(null);
  // VPS yang detail+checklist-nya sedang dibuka di modal (null = tertutup). UI 2026-07-18 ·
  // menggantikan side panel: klik baris membuka satu modal berisi seluruh detail + checklist.
  // SPEC-740 · ADR-0115 · yang disimpan id-nya; barisnya diresolusi ulang dari daftar hidup
  // (didorong WS) supaya modal tak pernah merender snapshot basi.
  const [detailId, setDetailId] = usePersistedState<string | null>("vps", "detailId", null, nullableStr);
  const detailVps = React.useMemo(() => list.find((v) => v.id === detailId) ?? null, [list, detailId]);
  const setDetailVps = React.useCallback((v: VpsView | null) => setDetailId(v ? v.id : null), [setDetailId]);

  const load = React.useCallback(() => {
    api.listVps().then((l) => { setList(l); setStatus("ready"); })
      .catch(() => setStatus("error"));
  }, []);
  // SPEC-199 · daftar VPS didorong lewat WS siar (grup "vps"), bukan poll 30s. `load()` awal
  // tetap untuk paint pertama; snapshot penuh saat connect menyusul.
  React.useEffect(() => {
    load();
    return subscribe((m) => { if (m.t === "vps") { setList(m.vps); setStatus("ready"); } });
  }, [load]);

  async function run(label: string, id: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(`${label}:${id}`);
    try { await fn(); load(); onToast(okMsg, "ok", "server"); }
    catch { onToast(`Gagal ${label}`, "err", "x-circle"); }
    finally { setBusy(null); }
  }
  const audit = (v: VpsView) => run("audit", v.id, () => api.auditVps(v.id), `${v.name} · audit selesai`);
  function harden(v: VpsView) {
    // window.confirm cukup (pola deleteProject di App): sebut persis apa yang berubah.
    if (!window.confirm(
      `Harden "${v.name}"?\n\nYang diterapkan: firewall (allow ${v.port}/80/443), fail2ban, ` +
      `auto security update, PermitRootLogin & PasswordAuthentication off, NTP.\n` +
      `Pastikan akses key SSH non-password kamu sudah bekerja.`)) return;
    void run("harden", v.id, () => api.hardenVps(v.id), `${v.name} · harden selesai`);
  }
  const session = (v: VpsView) =>
    run("sesi", v.id, async () => { await api.vpsSession(v.id); onGotoTerminal(); }, `${v.name} · sesi Claude dibuka`);
  // SPEC-211 · test connection (transien, tak sentuh state) & open console (shell ssh di tmux).
  const testConn = (v: VpsView) => run("test", v.id, async () => {
    const r = await api.testVps(v.id);
    if (!r.ok) throw new Error(r.out);
  }, `${v.name} · koneksi ok`);
  const openConsole = (v: VpsView) =>
    run("console", v.id, async () => { await api.vpsConsole(v.id); onGotoTerminal(); }, `${v.name} · console dibuka`);
  async function remove(v: VpsView) {
    if (!window.confirm(`Hapus registrasi VPS "${v.name}"? Server-nya sendiri tak disentuh.`)) return;
    await api.deleteVps(v.id).then(load).catch(() => onToast("Gagal hapus", "err", "x-circle"));
  }

  async function create(f: VpsForm) {
    try {
      const v = await api.createVps(vpsFormToBody(f));
      setModal(null); load();
      onToast(f.password ? `${v.name} terdaftar · key hanoman terpasang · password dibuang`
                         : `${v.name} terdaftar · jalankan audit`, "ok", "server");
    } catch { onToast("Gagal mendaftarkan VPS — cek host/user, atau password SSH-nya", "err", "x-circle"); }
  }

  async function save(target: VpsView, f: VpsForm) {
    try {
      const v = await api.updateVps(target.id, vpsFormToBody(f));
      setModal(null); load();
      onToast(f.password ? `${v.name} diperbarui · key hanoman terpasang · password dibuang`
                         : `${v.name} diperbarui`, "ok", "server");
    } catch { onToast("Gagal memperbarui VPS", "err", "x-circle"); }
  }

  if (status === "loading") return <StateBlock kind="loading" title="Memuat daftar VPS…" />;
  if (status === "error") return <StateBlock kind="error" title="Gagal memuat daftar VPS"
    hint="Pastikan server hanoman berjalan." action={load} />;
  if (list.length === 0) return (
    <>
      <StateBlock kind="empty" icon="server" title="Belum ada VPS"
        hint="Daftarkan VPS untuk mulai audit & hardening." action={() => setModal("new")} actionLabel="Daftarkan VPS" />
      <VpsModal open={modal === "new"} title="Daftarkan VPS" submitLabel="Daftarkan"
        initial={BLANK} onClose={() => setModal(null)} onSubmit={create} />
    </>
  );

  return (
    <div>
      <div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <Button size="sm" leftIcon="plus" onClick={() => setModal("new")}>Daftarkan VPS</Button>
        </div>
        {list.map((v) => {
          const h = HARDENED_PILL[hardenedLabel(v)];
          return (
            <div key={v.id} className="hn-vps-row"
              onClick={() => setDetailVps(v)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", cursor: "pointer",
                border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", marginBottom: 8 }}>
              <button type="button" aria-label={`Buka detail ${v.name}`}
                onClick={(event) => { event.stopPropagation(); setDetailVps(v); }}
                style={{ all: "unset", display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer" }}>
                <Icon name="server" size={16} color="var(--brass-700)" />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{v.name}</span>
                  <span style={{ display: "block", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-subtle)" }}>
                    {v.user}@{v.host}{v.port !== 22 ? `:${v.port}` : ""}</span>
                </span>
              </button>
              <StatusPill size="sm" status={isReachable(v) ? "ok" : "broken"}>
                {isReachable(v) ? "reachable" : "unreachable"}</StatusPill>
              <StatusPill size="sm" status={h.status}>{h.label}</StatusPill>
              <Button size="sm" variant="ghost" leftIcon="plug-zap" loading={busy === `test:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void testConn(v); }}>Test</Button>
              <Button size="sm" variant="ghost" leftIcon="terminal-square" loading={busy === `console:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void openConsole(v); }}>Console</Button>
              <Button size="sm" variant="secondary" leftIcon="radar" loading={busy === `audit:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void audit(v); }}>Audit</Button>
              <Button size="sm" leftIcon="shield" loading={busy === `harden:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); harden(v); }}>Harden</Button>
              <Button size="sm" variant="ghost" leftIcon="terminal" loading={busy === `sesi:${v.id}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void session(v); }}>Sesi Claude</Button>
              <Button size="sm" variant="ghost" leftIcon="pencil" title={`Edit ${v.name}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); setModal(v); }} />
              <Button size="sm" variant="ghost" leftIcon="trash-2"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); void remove(v); }} />
            </div>
          );
        })}
      </div>
      {/* SPEC-220/221 · UI 2026-07-18 · klik baris → satu modal: detail VPS + checklist penuh. */}
      {detailVps && (
        <VpsChecklistModal vpsId={detailVps.id} vpsName={detailVps.name}
          lastAuditAt={detailVps.lastAuditAt} health={detailVps.health}
          onClose={() => { setDetailVps(null); load(); }} onToast={onToast} />
      )}
      <VpsModal open={modal === "new"} title="Daftarkan VPS" submitLabel="Daftarkan"
        initial={BLANK} onClose={() => setModal(null)} onSubmit={create} />
      {modal && modal !== "new" && (
        <VpsModal open title={`Edit ${modal.name}`} submitLabel="Simpan" initial={formOf(modal)}
          onClose={() => setModal(null)} onSubmit={(f) => save(modal, f)} />
      )}
    </div>
  );
}
