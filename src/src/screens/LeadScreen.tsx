/* LeadScreen — panel hanoman-lead (SPEC-409, ADR-0091). Screen mandiri (pola SchedulerScreen /
   VpsScreen): memuat statusnya sendiri + silent poll HTTP; TIDAK menambah kanal WebSocket (AC-26).

   Isinya empat: rem darurat + setelan (ControlBar), status per project + opt-in, sesi yang sedang
   dilayani (menunggu / sedang diputuskan), dan jejak keputusan — pertanyaan → jawaban → alasan →
   rujukan — dengan tombol Timpa & Batalkan per baris (AC-27/28, US-2/3/4). */
import React from "react";
import { Card, Button, Badge, Input, Select, StateBlock, Icon, Checkbox, Radio, Pager, serverPage } from "../ds";
import { api } from "../api/client";
import type { Lead, LeadStatusView, LeadDecisionView, LeadFlowView } from "@hanoman/shared";
import type { ProjectVM } from "./types";

const POLL_MS = 5000;
// SPEC-523 · ukuran halaman kedua daftar lead. 393 baris jejak di instalasi hidup dulu dibalas
// tanpa `total` dan berplafon `take` 50 — data lama tak terjangkau dari layar.
const LIST_PAGE = 20;

/* Pembungkus tipis Pager DS supaya kedua daftar lead memakai ukuran halaman yang sama dan
   perhitungan `serverPage` tak diduplikasi. */
function LeadPager({ total, page, onPage, unit }:
  { total: number; page: number; onPage: (n: number) => void; unit: string }) {
  const sp = serverPage(total, page, LIST_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />;
}

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const d = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(d / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}j` : `${Math.floor(h / 24)}h`;
}

// Tone DS (feedback.tsx) — disempitkan supaya salah tulis nada tertangkap tsc, bukan tampil pucat.
type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
const CONF_TONE: Record<string, Tone> = { tinggi: "ok", sedang: "neutral", ragu: "warn" };
const STATUS_TONE: Record<string, Tone> = { berlaku: "ok", ditimpa: "warn", dibatalkan: "neutral", gagal: "err" };
const KIND_LABEL: Record<string, string> = {
  answer: "jawaban", order: "urutan kerja", collision: "tabrakan area",
  quality: "mutu hasil", refusal: "tindakan ditolak",
};
const GATE_LABEL: Record<string, string> = {
  contract: "kontrak", detected: "deteksi otomatis", pulse: "denyut",
};
// SPEC-485 · ADR-0102 · status satu RANTAI keputusan. `menunggu` diberi nada peringatan: alur yang
// terbuka tanpa satu pun jawaban berlaku memang keadaan yang menuntut mata operator.
const FLOW_TONE: Record<string, Tone> = {
  menunggu: "warn", sebagian: "info", selesai: "ok", dibatalkan: "neutral",
};
const FLOW_OPEN = new Set(["menunggu", "sebagian"]);
const FLOW_CLOSE_LABEL: Record<string, string> = {
  tunggal: "sekali jalan", submit: "di-submit", operator: "dibatalkan operator", kedaluwarsa: "kedaluwarsa",
};

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
      background: "var(--surface-card)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Section({ title, count, empty, children }:
  { title: string; count: number; empty: string; children?: React.ReactNode }) {
  return (
    <Card eyebrow={`lead · ${title.toLowerCase()}`} title={`${title} (${count})`}>
      {count === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>{empty}</div>
        : children}
    </Card>
  );
}

/** Rem darurat + knob. Pause menghentikan keputusan BARU; sesi yang berjalan tak disentuh (AC-27). */
function ControlBar({ cfg, onWrite, busy }: { cfg: Lead; onWrite: (n: Lead) => void; busy: boolean }) {
  const num = (v: string, min: number) => Math.max(min, Number(v) || min);
  return (
    <Card eyebrow="lead · kendali" title="hanoman-lead">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Badge tone={cfg.enabled ? (cfg.paused ? "warn" : "ok") : "neutral"}>
          {cfg.enabled ? (cfg.paused ? "dijeda" : "aktif") : "mati"}
        </Badge>
        {cfg.enabled
          ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: false, paused: false })}>Matikan</Button>
          : <Button size="sm" leftIcon="play" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: true })}>Nyalakan</Button>}
        {cfg.enabled && (cfg.paused
          ? <Button size="sm" leftIcon="play" disabled={busy} onClick={() => onWrite({ ...cfg, paused: false })}>Lanjutkan</Button>
          : <Button size="sm" variant="ghost" leftIcon="pause" disabled={busy} onClick={() => onWrite({ ...cfg, paused: true })}>Pause</Button>)}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          denyut tiap
          <Input type="number" min={1} style={{ width: 76 }} aria-label="denyut lead (menit)"
            placeholder="5" value={String(cfg.everyMin)} disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onWrite({ ...cfg, everyMin: num(e.target.value, 1) })} />
          menit
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          batas waktu putusan
          <Input type="number" min={10} style={{ width: 84 }} aria-label="batas waktu putusan (detik)"
            placeholder="600" value={String(cfg.timeoutSec)} disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onWrite({ ...cfg, timeoutSec: num(e.target.value, 10) })} />
          detik
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          maks jawaban otomatis/sesi
          <Input type="number" min={1} style={{ width: 76 }} aria-label="maksimum jawaban otomatis per sesi"
            placeholder="3" value={String(cfg.maxAutoAnswers)} disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onWrite({ ...cfg, maxAutoAnswers: num(e.target.value, 1) })} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          syarat sebelum integrasi ke main
          <Select size="sm" aria-label="syarat sebelum integrasi ke main"
            value={cfg.requireGreenBeforeIntegrate ? "wajib" : "bebas"} disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onWrite({ ...cfg, requireGreenBeforeIntegrate: e.target.value === "wajib" })}
            options={[{ value: "wajib", label: "plan tuntas" }, { value: "bebas", label: "tanpa syarat" }]} />
        </label>
      </div>
      {/* SPEC-488 · mesin yang MENJALANKAN lead. Disetel di Settings → Model sesi (satu tempat,
          bersama katalog model kedua agen); ditampilkan di sini karena inilah layar tempat
          operator mengurus lead. `?.` disengaja: dashboard bisa lebih baru daripada server yang
          dilayaninya (paket npm global, ADR-0087) dan server lama tak mengirim blok `engine`. */}
      <div data-testid="lead-engine-line" style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 10 }}>
        mesin: {cfg.engine?.enabled
          ? <>{cfg.engine.agent === "codex" ? "Codex CLI" : "Claude Code"} · <code>{cfg.engine.model}</code> · <code>{cfg.engine.effort}</code></>
          : <>ikut default global · atur di Settings → Model sesi</>}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 6 }}>
        Lead memutuskan lalu melapor. Produksi/VPS dan penghapusan data terkunci secara teknis — apa pun setelannya.
      </div>
    </Card>
  );
}

/**
 * SPEC-485 · ADR-0102 · kontrol yang MENYATAKAN bentuk pilihannya: radio untuk tunggal, checkbox
 * untuk jamak. Sebelum spec ini "Timpa" cuma kotak teks, jadi operator harus menuliskan ulang label
 * opsi yang sudah ada di layar — dan salah ketik satu huruf membuat pilihannya tak terpetakan.
 */
function ChoicePicker({ options, multi, value, onChange }: {
  options: string[]; multi: boolean; value: string[]; onChange: (next: string[]) => void;
}) {
  const toggle = (o: string) => {
    if (!multi) { onChange([o]); return; }   // tunggal: yang terakhir dipilih menang
    onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {options.map((o) => multi
        ? <Checkbox key={o} checked={value.includes(o)} label={o} onChange={() => toggle(o)} />
        : <Radio key={o} checked={value.includes(o)} label={o} onChange={() => toggle(o)} />)}
    </div>
  );
}

function DecisionRow({ d, onOverride, onCancel, busyId }: {
  d: LeadDecisionView;
  onOverride: (id: string, answer: string, choices: string[]) => void;
  onCancel: (id: string) => void;
  busyId: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [draftChoices, setDraftChoices] = React.useState<string[]>([]);
  // SPEC-485 · `choices` bentuk yang berlaku; baris dari server LAMA hanya punya pasangan skalar,
  // dan `?? []` di sepanjang berkas ini bukan kehati-hatian berlebih — dashboard bisa lebih baru
  // daripada server yang dilayaninya (paket npm global, ADR-0087).
  const picked = (d.choices ?? []).length > 0
    ? d.choices
    : (d.choiceIndex != null && d.choice ? [{ index: d.choiceIndex, option: d.choice }] : []);
  const options = d.options ?? [];
  const multi = d.select?.mode === "multi";
  return (
    <div style={{ padding: "10px 12px", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge tone={STATUS_TONE[d.status] ?? "neutral"} size="sm">{d.status}</Badge>
        <Badge tone={CONF_TONE[d.confidence] ?? "neutral"} size="sm">{d.confidence}</Badge>
        <Badge tone="neutral" size="sm">{KIND_LABEL[d.kind] ?? d.kind}</Badge>
        <Badge tone="neutral" size="sm">{GATE_LABEL[d.gate] ?? d.gate}</Badge>
        {d.weighty && <Badge tone="warn" size="sm">berbobot</Badge>}
        {/* SPEC-480 · pilihan sebagai data: operator membacanya sekilas, bukan dari prosanya.
            `?? []` bukan kehati-hatian berlebih — dashboard bisa lebih baru daripada server yang
            dilayaninya (paket npm global, ADR-0087), dan baris tanpa field ini akan meruntuhkan
            SELURUH panel, bukan cuma badge-nya. */}
        {picked.length > 0 && options.length > 0 &&
          <Badge tone="brass" size="sm">
            {picked.length > 1
              ? `${picked.length} dari ${options.length} opsi`
              : `opsi ${picked[0]!.index}/${options.length}`}
          </Badge>}
        {(d.missing ?? []).length > 0 && <Badge tone="warn" size="sm">kurang konteks</Badge>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{ago(d.createdAt)}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: "var(--text-sm)", color: "var(--text-subtle)", whiteSpace: "pre-wrap" }}>
        {d.question.slice(0, 400)}
      </div>
      <div style={{ marginTop: 4, color: "var(--text-strong)", fontWeight: 500, whiteSpace: "pre-wrap" }}>
        {/* Label opsi terpilih menang atas prosa: itulah yang benar-benar dikirim ke peminta.
            SPEC-485 · SEMUA yang terpilih, bukan hanya yang pertama. */}
        {picked.length
          ? picked.map((c) => c.option).join(" · ")
          : (d.answer || <em style={{ fontWeight: 400, color: "var(--text-muted)" }}>tak ada jawaban</em>)}
      </div>
      <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-subtle)", whiteSpace: "pre-wrap" }}>
        {d.reason}
      </div>
      {d.refs.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {d.refs.map((r) => (
            <span key={r} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
              color: "var(--text-muted)", border: "1px solid var(--border-hair)",
              borderRadius: "var(--radius-sm)", padding: "1px 6px" }}>{r}</span>
          ))}
        </div>
      )}
      {(d.missing ?? []).length > 0 && (
        <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          Yang kurang: {d.missing.join(" · ")}
        </div>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {d.projectId}{d.specId ? ` · ${d.specId}` : ""}{d.sessionId ? ` · ${d.sessionId}` : ""}
          {d.action !== "none" ? ` · ${d.action}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {d.status === "berlaku" && !open &&
          <Button size="sm" variant="ghost" leftIcon="edit-3" onClick={() => setOpen(true)}>Timpa</Button>}
        {d.status === "berlaku" &&
          <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busyId === d.id}
            onClick={() => onCancel(d.id)}>Batalkan</Button>}
      </div>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {options.length > 0 && (
            <ChoicePicker options={options} multi={multi} value={draftChoices} onChange={setDraftChoices} />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Input style={{ flex: 1 }} aria-label={`jawaban operator untuk ${d.id}`}
              placeholder="mis. pilih opsi 2, pakai Node 22"
              value={draft} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} />
            {/* Centang saja sudah cukup: labelnya yang jadi jawaban bila kolom prosanya kosong. */}
            <Button size="sm" leftIcon="check"
              disabled={(!draft.trim() && draftChoices.length === 0) || busyId === d.id}
              onClick={() => {
                onOverride(d.id, draft.trim() || draftChoices.join("; "), draftChoices);
                setOpen(false); setDraft(""); setDraftChoices([]);
              }}>Simpan</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export type LeadScreenProps = {
  projects: ProjectVM[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onGotoTerminal: (sessionId?: string) => void;
};

export function LeadScreen({ projects, onProjectChanged, onToast, onGotoTerminal }: LeadScreenProps) {
  const [state, setState] = React.useState<LeadStatusView | null>(null);
  const [decisions, setDecisions] = React.useState<LeadDecisionView[]>([]);
  const [flows, setFlows] = React.useState<LeadFlowView[]>([]);
  const [decTotal, setDecTotal] = React.useState(0);
  const [decPage, setDecPage] = React.useState(1);
  const [flowTotal, setFlowTotal] = React.useState(0);
  const [flowPage, setFlowPage] = React.useState(1);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("all");

  const load = React.useCallback((silent = false) => {
    if (!silent) setPhase("loading");
    Promise.all([
      api.getLeadStatus(),
      api.getLeadDecisions({ projectId: filter === "all" ? undefined : filter, page: decPage, limit: LIST_PAGE }),
      // SPEC-485 · rantai. Instance lama tak punya endpoint ini; kegagalannya tak boleh menjatuhkan
      // seluruh panel (ADR-0087: dashboard bisa lebih baru daripada server yang dilayaninya).
      api.getLeadFlows({ projectId: filter === "all" ? undefined : filter, page: flowPage, limit: LIST_PAGE })
        .catch(() => ({ items: [] as LeadFlowView[], total: 0, page: 1, pageSize: LIST_PAGE })),
    ])
      .then(([s, d, f]) => {
        setState(s);
        setDecisions(d.items ?? []); setDecTotal(d.total ?? 0);
        setFlows(f.items ?? []); setFlowTotal(f.total ?? 0);
        setPhase("ready");
      })
      .catch(() => { if (!silent) setPhase("error"); });   // silent poll tak pernah mem-blank layar
  }, [filter, decPage, flowPage]);
  React.useEffect(() => { load(); }, [load]);
  // AC-15 · ganti penyaring = kembali ke halaman 1. Tanpa ini, halaman 5 dari filter lama
  // menjawab daftar filter baru yang cuma punya 2 halaman → daftar kosong tanpa sebab.
  React.useEffect(() => { setDecPage(1); setFlowPage(1); }, [filter]);
  React.useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const writeConfig = React.useCallback(async (next: Lead) => {
    setBusy(true);
    try { await api.putLeadConfig(next); onToast("Setelan lead tersimpan", "ok", "save"); load(true); }
    catch { onToast("Gagal menyimpan setelan lead", "err", "x-circle"); }
    finally { setBusy(false); }
  }, [load, onToast]);

  const toggleOptIn = React.useCallback(async (id: string, next: boolean) => {
    setBusyId(id);
    try { await api.updateProject(id, { leadOptIn: next }); await onProjectChanged(id); load(true); onToast(next ? "Project dipimpin lead" : "Project dilepas dari lead", "ok"); }
    catch { onToast("Gagal mengubah opt-in", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onProjectChanged, onToast]);

  const togglePause = React.useCallback(async (id: string, paused: boolean) => {
    if (!state) return;
    const set = new Set(state.config.pausedProjects);
    if (paused) set.add(id); else set.delete(id);
    await writeConfig({ ...state.config, pausedProjects: [...set] });
  }, [state, writeConfig]);

  const override = React.useCallback(async (id: string, answer: string, choices: string[] = []) => {
    setBusyId(id);
    try {
      const r = await api.overrideLeadDecision(id, answer, "", choices);
      onToast(r.delivered ? "Jawaban kamu dikirim ke sesi" : "Keputusan ditimpa", "ok", "check");
      load(true);
    } catch { onToast("Gagal menimpa keputusan", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onToast]);

  // SPEC-485 · menutup rantai adalah tindakan operator, bukan keputusan lead — tak ada agen yang
  // dipanggil untuknya.
  const closeFlow = React.useCallback(async (id: string, how: "submit" | "cancel") => {
    setBusyId(id);
    try {
      await (how === "submit" ? api.submitLeadFlow(id) : api.cancelLeadFlow(id));
      onToast(how === "submit" ? "Rantai di-submit" : "Rantai dibatalkan", "ok", "check");
      load(true);
    } catch { onToast("Gagal menutup rantai", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onToast]);

  const cancel = React.useCallback(async (id: string) => {
    setBusyId(id);
    try { await api.cancelLeadDecision(id); onToast("Keputusan dibatalkan", "ok"); load(true); }
    catch { onToast("Gagal membatalkan keputusan", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onToast]);

  if (phase === "loading") return <StateBlock kind="loading" />;
  if (phase === "error" || !state) {
    return <StateBlock kind="error" hint="Gagal memuat status lead." action={() => load()} actionLabel="Coba lagi" />;
  }

  const optIn = new Set(state.projects.map((p) => p.projectId));
  const waiting = state.waiting;
  const deciding = new Set(state.deciding);
  // SPEC-479 · `queued`/`gate` punya default di `zLeadStatusView`, tapi respons instance lama
  // (atau hub yang belum di-update) tetap bisa datang tanpa keduanya — jangan andalkan zod di sini.
  const queued = new Set(state.queued ?? []);
  const gate = state.gate ?? { inFlight: 0, queued: 0, capacity: 1 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      <ControlBar cfg={state.config} onWrite={writeConfig} busy={busy} />

      <Card eyebrow="lead · project" title="Project yang dipimpin">
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginBottom: 10 }}>
          Lead hanya menyentuh project yang di-opt-in. Default mati.
        </div>
        {projects.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada project.</div>
          : projects.map((p) => {
            const row = state.projects.find((x) => x.projectId === p.id);
            return (
              <RowShell key={p.id}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)", fontWeight: 500 }}>{p.name}</span>
                {row && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  {row.decisions24h} keputusan/24j · {row.openSessions} sesi
                </span>}
                <Badge tone={optIn.has(p.id) ? (row?.paused ? "warn" : "ok") : "neutral"} size="sm">
                  {optIn.has(p.id) ? (row?.paused ? "dijeda" : "dipimpin") : "mati"}
                </Badge>
                {optIn.has(p.id) && (row?.paused
                  ? <Button size="sm" variant="ghost" leftIcon="play" disabled={busy} onClick={() => togglePause(p.id, false)}>Lanjutkan</Button>
                  : <Button size="sm" variant="ghost" leftIcon="pause" disabled={busy} onClick={() => togglePause(p.id, true)}>Pause</Button>)}
                {optIn.has(p.id)
                  ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busyId === p.id} onClick={() => toggleOptIn(p.id, false)}>Lepas</Button>
                  : <Button size="sm" leftIcon="check" disabled={busyId === p.id} onClick={() => toggleOptIn(p.id, true)}>Pimpin</Button>}
              </RowShell>
            );
          })}
      </Card>

      <Section title="Sesi menunggu keputusan" count={waiting.length}
        empty="Tak ada sesi yang menunggu keputusan.">
        {/* SPEC-479 · gerbang konkurensi. Ditampilkan hanya saat ia benar-benar mengikat: batas
            yang diam tak perlu diumumkan, batas yang menahan antrean wajib. Tanpa baris ini
            "lead sedang penuh" tak terbedakan dari "lead diam" — salah baca yang melahirkan
            tiket SPEC-479. */}
        {gate.queued > 0 && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 8 }}>
            Gerbang lead: {gate.inFlight}/{gate.capacity} diputuskan · {gate.queued} antre menunggu slot.
          </div>
        )}
        {waiting.map((id) => {
          // TIGA keadaan, bukan dua. Di pane ketiganya terlihat sama — marker terisi, agen diam —
          // tapi hanya "menunggu" yang benar-benar butuh manusia.
          const state = deciding.has(id) ? "sedang diputuskan"
            : queued.has(id) ? "antre"
            : "menunggu";
          return (
            <RowShell key={id}>
              <Icon name={state === "sedang diputuskan" ? "loader" : state === "antre" ? "clock" : "help-circle"} />
              <span style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text-strong)" }}>{id}</span>
              <Badge tone={state === "menunggu" ? "warn" : "ok"} size="sm">{state}</Badge>
              <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGotoTerminal(id)}>Ambil alih</Button>
            </RowShell>
          );
        })}
      </Section>

      {/* SPEC-485 · ADR-0102 · satu rantai = satu urusan, dari pertanyaan pertama sampai submit.
          Statusnya dijawab satu kolom, bukan disimpulkan ulang dari kumpulan baris jejak. */}
      <Card eyebrow="lead · rantai keputusan" title={`Rantai (${flowTotal})`}>
        {flows.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
              Belum ada rantai. Satu rantai adalah satu urusan — beberapa pertanyaan berurutan sampai di-submit.
            </div>
          : flows.map((f) => (
            <RowShell key={f.id}>
              <Badge tone={FLOW_TONE[f.status] ?? "neutral"} size="sm">{f.status}</Badge>
              <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)" }}>{f.title}</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {f.steps} langkah · {ago(f.openedAt)}
                {f.closeReason ? ` · ${FLOW_CLOSE_LABEL[f.closeReason] ?? f.closeReason}` : ""}
              </span>
              {FLOW_OPEN.has(f.status) && <>
                <Button size="sm" leftIcon="check" disabled={busyId === f.id}
                  onClick={() => closeFlow(f.id, "submit")}>Submit</Button>
                <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busyId === f.id}
                  onClick={() => closeFlow(f.id, "cancel")}>Batalkan</Button>
              </>}
            </RowShell>
          ))}
        <LeadPager total={flowTotal} page={flowPage} onPage={setFlowPage} unit="rantai" />
      </Card>

      <Card eyebrow="lead · jejak keputusan" title={`Keputusan (${decTotal})`}
        actions={
          <Select size="sm" value={filter} aria-label="saring project"
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
            options={[{ value: "all", label: "semua project" },
              ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
        }>
        {decisions.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
              Belum ada keputusan. Lead menulis satu baris di sini setiap kali ia memutuskan.
            </div>
          : decisions.map((d) => (
            <DecisionRow key={d.id} d={d} onOverride={override} onCancel={cancel} busyId={busyId} />
          ))}
        <LeadPager total={decTotal} page={decPage} onPage={setDecPage} unit="keputusan" />
      </Card>
    </div>
  );
}
