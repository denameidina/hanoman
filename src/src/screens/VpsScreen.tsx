/* VpsScreen — daftar VPS. Audit UI/UX 2026-10 · Fase 3J:
   daftar berbentuk tabel ringkas (RowList): nama, status tiga langkah (Terhubung → Diaudit → Diperkuat)
   dengan teks, skor kepatuhan, dan satu aksi utama "Periksa". Sisanya (tes koneksi, console, sesi Claude,
   edit, harden, hapus) di menu ⋯. Harden dan hapus selalu lewat konfirmasi.
   Detail satu VPS terbuka sebagai modal bertab (Ringkasan · Checklist · Pemasangan · Akses).
   Screen mandiri (pola SettingsScreen): memuat datanya sendiri, App hanya memasang Shell. */
import React from "react";
import { Button, DenseRow, Field, Input, Modal, OverflowActions, RowList, StateBlock, Text, useConfirm, type OverflowItem } from "../ds";
import { api } from "../api/client";
import { errorMessage, failureMessage } from "../lib/report-error";
import { subscribe } from "../api/events";
import type { VpsView } from "@hanoman/shared";
import { VpsChecklistModal } from "./VpsChecklist";
import { usePersistedState, nullableStr } from "../ui-state";
import { VpsProvisionPanel, ComponentBadges } from "./VpsProvision";
import { isReachableAt, scoreText, vpsSteps, type VpsStep } from "./vps-status";
import "./styles/vps.css";

// reachable = healthcheck terakhir sukses dalam 2× interval 5 menit (SPEC-164 §4).
export const isReachable = (v: VpsView, now: number = Date.now()): boolean => isReachableAt(v, now);
export const hardenedLabel = (v: VpsView): "hardened" | "belum" | "unknown" =>
  !v.lastAuditAt ? "unknown" : v.hardened ? "hardened" : "belum";

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
      <div className="hn-grid-mobile vps-form-pair">
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

/** Tiga langkah status: tiap langkah punya teks sendiri, jadi keadaannya terbaca tanpa warna. */
export function VpsStepper({ steps, name }: { steps: VpsStep[]; name: string }) {
  return (
    <ol className="vps-stepper" aria-label={`Kemajuan ${name}`}>
      {steps.map((s) => (
        <li key={s.key} className={`vps-step vps-step-${s.state}`}>
          <span className="vps-step-label">{s.label}</span>
          <span className="vps-step-text">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function VpsScreen({ onToast, onGotoTerminal }:
  { onToast: (msg: string, kind?: string, icon?: string) => void; onGotoTerminal: (sessionId: string) => void }) {
  const [list, setList] = React.useState<VpsView[]>([]);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [loadErr, setLoadErr] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null); // "<aksi>:<id>"
  // null = tertutup · "new" = daftar · VpsView = edit
  const [modal, setModal] = React.useState<null | "new" | VpsView>(null);
  // VPS yang detailnya sedang dibuka di modal (null = tertutup). SPEC-740 · ADR-0115 · yang disimpan
  // id-nya; barisnya diresolusi ulang dari daftar hidup (didorong WS) supaya modal tak pernah basi.
  const [detailId, setDetailId] = usePersistedState<string | null>("vps", "detailId", null, nullableStr);
  const detailVps = React.useMemo(() => list.find((v) => v.id === detailId) ?? null, [list, detailId]);
  const setDetailVps = React.useCallback((v: VpsView | null) => setDetailId(v ? v.id : null), [setDetailId]);

  const load = React.useCallback(() => {
    api.listVps().then((l) => { setList(l); setStatus("ready"); })
      .catch((e) => { setLoadErr(errorMessage(e, "tak diketahui")); setStatus("error"); });
  }, []);
  // SPEC-199 · daftar VPS didorong lewat WS siar (grup "vps"), bukan poll 30s. `load()` awal
  // tetap untuk paint pertama; snapshot penuh saat connect menyusul.
  React.useEffect(() => {
    load();
    return subscribe((m) => { if (m.t === "vps") { setList(m.vps); setStatus("ready"); } });
  }, [load]);

  // SPEC-847 · ADR-0127 · konfirmasi mutasi VPS memakai dialog aplikasi.
  const { confirm, dialog } = useConfirm();

  // Galat selalu membawa alasannya (`failureMessage`): "Gagal tes koneksi: <out dari server>".
  async function run(key: string, id: string, fn: () => Promise<unknown>, okMsg: string, failAction: string) {
    setBusy(`${key}:${id}`);
    try { await fn(); load(); onToast(okMsg, "ok", "server"); }
    catch (e) { onToast(failureMessage(failAction, e), "err", "x-circle"); }
    finally { setBusy(null); }
  }
  // Audit menyimpan skornya (ADR-0211): daftar memuatnya ulang dari server, tanpa state skor terpisah.
  const audit = async (v: VpsView) => {
    setBusy(`audit:${v.id}`);
    try {
      await api.auditVps(v.id);
      load(); onToast(`${v.name} · audit selesai`, "ok", "server");
    } catch (e) { onToast(failureMessage("menjalankan audit", e), "err", "x-circle"); }
    finally { setBusy(null); }
  };
  async function harden(v: VpsView) {
    if (!await confirm({
      title: `Harden "${v.name}"?`,
      message: "Pastikan akses key SSH non-password kamu sudah bekerja sebelum melanjutkan.",
      impact: [
        `Firewall: izinkan ${v.port}/80/443.`,
        "fail2ban & auto security update dipasang.",
        "PermitRootLogin & PasswordAuthentication dimatikan.",
        "NTP disinkronkan.",
      ],
      confirmLabel: "Harden",
      icon: "shield",
    })) return;
    void run("harden", v.id, () => api.hardenVps(v.id), `${v.name} · harden selesai`, "menjalankan harden");
  }
  const session = (v: VpsView) =>
    run("sesi", v.id, async () => { const { id } = await api.vpsSession(v.id); onGotoTerminal(id); }, `${v.name} · sesi Claude dibuka`, "membuka sesi Claude");
  // SPEC-211 · test connection (transien, tak sentuh state) & open console (shell ssh di tmux).
  const testConn = (v: VpsView) => run("test", v.id, async () => {
    const r = await api.testVps(v.id);
    if (!r.ok) throw new Error(r.out);
  }, `${v.name} · koneksi ok`, "tes koneksi");
  const openConsole = (v: VpsView) =>
    run("console", v.id, async () => { const { id } = await api.vpsConsole(v.id); onGotoTerminal(id); }, `${v.name} · console dibuka`, "membuka console");
  async function remove(v: VpsView) {
    try {
      if (!await confirm({
        title: `Hapus registrasi VPS "${v.name}"?`,
        message: "Server-nya sendiri tak disentuh — hanya pendaftarannya di dashboard ini yang dihapus.",
        confirmLabel: "Hapus registrasi",
        run: () => api.deleteVps(v.id),
      })) return;
      load();
      onToast(`${v.name} dihapus dari daftar`, "ok", "check");
    } catch (e) { onToast(failureMessage("menghapus registrasi VPS", e), "err", "x-circle"); }
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

  // Aksi jarang dan aksi berbahaya di menu ⋯. Harden dan hapus selalu lewat konfirmasi (di fungsinya).
  const menuItems = (v: VpsView): OverflowItem[] => [
    { key: "tes", label: "Tes koneksi", icon: "plug-zap", onSelect: () => void testConn(v) },
    { key: "console", label: "Buka console", icon: "terminal-square", onSelect: () => void openConsole(v) },
    { key: "sesi", label: "Sesi Claude", icon: "terminal", onSelect: () => void session(v) },
    { key: "edit", label: "Edit", icon: "pencil", onSelect: () => setModal(v) },
    { key: "harden", label: "Harden", icon: "shield", tone: "danger", onSelect: () => void harden(v) },
    { key: "hapus", label: "Hapus registrasi", icon: "trash-2", tone: "danger", onSelect: () => void remove(v) },
  ];

  // Isi tab Ringkasan: status tiga langkah dan komponen yang terpasang.
  const summaryNode = (v: VpsView) => (
    <>
      <VpsStepper steps={vpsSteps(v)} name={v.name} />
      <div className="vps-summary-comp">
        <ComponentBadges components={v.components ?? null} checkedAt={v.componentsCheckedAt ?? null} />
      </div>
    </>
  );

  // Isi tab Akses: alamat dan kunci, plus aksi koneksi yang tadinya ada di baris daftar.
  const accessNode = (v: VpsView) => (
    <div className="vps-access">
      <dl className="vps-access-list">
        <div><dt>Host</dt><dd>{v.host}</dd></div>
        <div><dt>User SSH</dt><dd>{v.user}</dd></div>
        <div><dt>Port</dt><dd>{v.port}</dd></div>
        <div><dt>Key</dt><dd>{v.keyPath ?? "key default mesin server"}</dd></div>
      </dl>
      <div className="vps-access-actions">
        <Button size="sm" variant="secondary" leftIcon="plug-zap" loading={busy === `test:${v.id}`}
          onClick={() => void testConn(v)}>Tes koneksi</Button>
        <Button size="sm" variant="secondary" leftIcon="terminal-square" loading={busy === `console:${v.id}`}
          onClick={() => void openConsole(v)}>Buka console</Button>
        <Button size="sm" variant="secondary" leftIcon="terminal" loading={busy === `sesi:${v.id}`}
          onClick={() => void session(v)}>Sesi Claude</Button>
        <Button size="sm" variant="ghost" leftIcon="pencil" onClick={() => setModal(v)}>Edit</Button>
      </div>
    </div>
  );

  if (status === "loading") return <StateBlock kind="loading" title="Memuat daftar VPS…" />;
  if (status === "error") return <StateBlock kind="error" title="Gagal memuat daftar VPS"
    hint={`Alasan: ${loadErr}. Pastikan server hanoman berjalan.`} action={load} />;
  if (list.length === 0) return (
    <>
      <StateBlock kind="empty" icon="server" title="Belum ada VPS"
        hint="Daftarkan VPS untuk mulai audit & hardening." action={() => setModal("new")} actionLabel="Daftarkan VPS" />
      <VpsModal open={modal === "new"} title="Daftarkan VPS" submitLabel="Daftarkan"
        initial={BLANK} onClose={() => setModal(null)} onSubmit={create} />
    </>
  );

  return (
    <div className="vps-screen">
      <div className="vps-toolbar">
        <Text size={12} tone="muted">{list.length} VPS terdaftar</Text>
        <Button size="sm" leftIcon="plus" onClick={() => setModal("new")}>Daftarkan VPS</Button>
      </div>
      <RowList label="Daftar VPS">
        {list.map((v) => (
          <DenseRow key={v.id} actions={
            <>
              {/* Satu aksi utama per baris: periksa (audit). Harden berbahaya tinggal di menu ⋯ dan selalu dikonfirmasi. */}
              <Button size="sm" leftIcon="radar" loading={busy === `audit:${v.id}`}
                onClick={() => void audit(v)}>Periksa</Button>
              <OverflowActions label={`Aksi lain untuk ${v.name}`} title={v.name} items={menuItems(v)} />
            </>
          }>
            <div className="vps-row">
              <button type="button" aria-label={`Buka detail ${v.name}`} className="vps-row-open"
                onClick={() => setDetailVps(v)}>
                <span className="vps-row-name">{v.name}</span>
                <span className="vps-row-addr">{v.user}@{v.host}{v.port !== 22 ? `:${v.port}` : ""}</span>
              </button>
              <VpsStepper steps={vpsSteps(v)} name={v.name} />
              <span className="vps-row-score">{scoreText(v.scoreTotal)}</span>
            </div>
          </DenseRow>
        ))}
      </RowList>
      {/* SPEC-220/221 · klik baris → satu modal bertab: ringkasan, checklist, pemasangan, akses. */}
      {detailVps && (
        <VpsChecklistModal vpsId={detailVps.id} vpsName={detailVps.name}
          lastAuditAt={detailVps.lastAuditAt} health={detailVps.health}
          summary={summaryNode(detailVps)}
          provisioning={<VpsProvisionPanel vps={detailVps} onToast={onToast} onGotoTerminal={onGotoTerminal} />}
          access={accessNode(detailVps)}
          /* Checklist baru dimuat (mis. sesudah N/A/attest): muat ulang daftar supaya skor di baris ikut. */
          onScore={() => load()}
          onClose={() => { setDetailVps(null); load(); }} onToast={onToast} />
      )}
      <VpsModal open={modal === "new"} title="Daftarkan VPS" submitLabel="Daftarkan"
        initial={BLANK} onClose={() => setModal(null)} onSubmit={create} />
      {modal && modal !== "new" && (
        <VpsModal open title={`Edit ${modal.name}`} submitLabel="Simpan" initial={formOf(modal)}
          onClose={() => setModal(null)} onSubmit={(f) => save(modal, f)} />
      )}
      {dialog}
    </div>
  );
}
