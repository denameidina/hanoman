/* SchedulerScreen — panel scheduler otonom (SPEC-299, daun #6 ADR-0072). Screen mandiri (pola
   VpsScreen): memuat state fondasi sendiri + silent poll. Menampilkan status per
   source, antrean, sesi berjalan, done + link review, gagal + alasan; panel setelan menulis semua
   knob (PUT /api/scheduler/config), opt-in per project (pola helpEnabled → PATCH /projects/:id),
   dan rem darurat Pause/Stop. Konsumen API read-only GET /api/scheduler/state — tanpa endpoint baru. */
import React from "react";
import { Card, Button, Badge, Select, Switch, Input, StateBlock, Icon, Pager, serverPage } from "../ds";
import { api } from "../api/client";
import type { SchedulerStateView, SchedulerQueueItemView, SchedulerSessionView, SchedulerSourceView, Scheduler } from "@hanoman/shared";
import type { ProjectVM, Spec } from "./types";
import { specDeepLink } from "./deeplink";
import { SchedulerCrons } from "./SchedulerCrons";
import { usePersistedState, isNum } from "../ui-state";

const POLL_MS = 5000;
const QUEUE_PAGE = 10;

// Waktu relatif ringkas. null → "—".
function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const d = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(d / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j`;
  return `${Math.floor(h / 24)}h`;
}
// Waktu ke depan ringkas untuk next-run.
function until(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime() - now;
  if (d <= 0) return "jatuh tempo";
  const m = Math.ceil(d / 60_000);
  if (m < 60) return `${m}m lagi`;
  return `${Math.ceil(m / 60)}j lagi`;
}
const PRIO_TONE: Record<string, string> = { tinggi: "err", sedang: "warn", rendah: "neutral" };

export type SchedulerScreenProps = {
  projects: ProjectVM[]; backlog: Spec[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onGotoTerminal: () => void;
};

function titleFor(specId: string, backlog: Spec[]): string {
  return backlog.find((s) => s.id === specId)?.title ?? specId;
}

function SourceCard({ s }: { s: SchedulerSourceView }) {
  return (
    <div style={{ padding: "12px 14px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
      background: "var(--surface-card)", display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 180 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-strong)" }}>{s.id}</span>
        <Badge tone={s.enabled ? "ok" : "neutral"} size="sm">{s.enabled ? "aktif" : "nonaktif"}</Badge>
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
        tiap {s.everyMin}m
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        terakhir {ago(s.lastRunAt)} · berikutnya {until(s.nextRunAt)}
      </div>
    </div>
  );
}

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function QueueRow({ q, backlog, onCancel, busy }:
  { q: SchedulerQueueItemView; backlog: Spec[]; onCancel: (id: string) => void; busy: boolean }) {
  return (
    <RowShell>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {q.projectId} · {q.source}{q.note ? ` · ${q.note}` : ""}
        </span>
      </span>
      <Badge tone={(PRIO_TONE[q.priority] ?? "neutral") as never} size="sm">{q.priority}</Badge>
      {/* SPEC-522 · tanpa dialog konfirmasi: tindakannya reversibel lewat "Antre lagi", dan
          konfirmasi untuk tindakan reversibel adalah gesekan tanpa hasil. */}
      <Button size="sm" variant="ghost" leftIcon="ban" disabled={busy} onClick={() => onCancel(q.id)}>Batalkan</Button>
    </RowShell>
  );
}

// SPEC-522 · ADR-0106 · baris tombstone: ia sengaja TIDAK dihapus — `enqueue` (`upsert`
// ber-`update:{}`) karena itu tak bisa menghidupkannya lagi saat checker `backlog` menjumpai spec
// yang sama pada cadence berikutnya.
function CanceledRow({ q, backlog, onRequeue, busy }:
  { q: SchedulerQueueItemView; backlog: Spec[]; onRequeue: (id: string) => void; busy: boolean }) {
  return (
    <RowShell>
      <Icon name="ban" size={16} color="var(--text-subtle)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {q.projectId} · {q.source} · {q.note ?? "dibatalkan"}
        </span>
      </span>
      <Button size="sm" variant="ghost" leftIcon="rotate-ccw" disabled={busy} onClick={() => onRequeue(q.id)}>Antre lagi</Button>
    </RowShell>
  );
}

function SessionRow({ s, backlog, onGotoTerminal }: { s: SchedulerSessionView; backlog: Spec[]; onGotoTerminal: () => void }) {
  return (
    <RowShell>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(s.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>{s.projectId}{s.flow ? ` · ${s.flow}` : ""}</span>
      </span>
      {s.decision && <Badge tone="warn" icon="bell" size="sm">menunggu keputusan</Badge>}
      <Button size="sm" variant="ghost" leftIcon="terminal" onClick={onGotoTerminal}>Buka terminal</Button>
    </RowShell>
  );
}

function DoneRow({ q, backlog, onToast }: { q: SchedulerQueueItemView; backlog: Spec[]; onToast: SchedulerScreenProps["onToast"] }) {
  const link = specDeepLink(q.specId);
  return (
    <RowShell>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {/* SPEC-431 · baris yang ditutup gerbang "spec sudah selesai" tak pernah punya sesi;
              "selesai —" akan terbaca seolah scheduler yang menyelesaikannya. */}
          {q.projectId} · {q.source} · {q.launchedAt ? `selesai ${ago(q.launchedAt)}` : (q.note ?? "tak diluncurkan")}
          {q.sessionId ? ` · hanoman/${q.sessionId}` : ""}
        </span>
      </span>
      <Button size="sm" variant="ghost" leftIcon="external-link" onClick={() => window.open(link, "_blank", "noreferrer")}>Buka review</Button>
      <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(link); onToast("Link review disalin", "ok", "copy"); }}>Salin</Button>
    </RowShell>
  );
}

function FailedRow({ q, backlog }: { q: SchedulerQueueItemView; backlog: Spec[] }) {
  return (
    <RowShell>
      <Icon name="x-circle" size={16} color="var(--clay-500)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {q.projectId} · {q.note ?? "gagal tanpa alasan tercatat"}
        </span>
      </span>
    </RowShell>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children?: React.ReactNode }) {
  return (
    <Card eyebrow="scheduler" title={`${title}${count ? ` · ${count}` : ""}`}>
      {count === 0 ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>{empty}</div> : children}
    </Card>
  );
}

/* SPEC-523 · satu bagian antrean = satu daftar berhalaman yang memuat datanya sendiri.
   Sebelumnya ketiganya `filter()` di klien atas array `state.queue` yang tak berbatas — dan
   array itu ikut di setiap poll 5 detik, tumbuh seiring umur instalasi. */
function QueueSection({ title, status, count, empty, nonce, render }: {
  title: string; status: string; count: number; empty: string; nonce: number;
  render: (q: SchedulerQueueItemView) => React.ReactNode;
}) {
  const [items, setItems] = React.useState<SchedulerQueueItemView[]>([]);
  const [total, setTotal] = React.useState(0);
  // SPEC-740 · ADR-0115 · tiga seksi antrean memakai komponen yang SAMA — kuncinya wajib
  // memuat `status`, kalau tidak ketiganya berbagi satu nomor halaman.
  const [page, setPage] = usePersistedState("scheduler", `queue-${status}-page`, 1, isNum);

  React.useEffect(() => {
    let alive = true;
    api.getSchedulerQueue({ status, page, limit: QUEUE_PAGE })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); } })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } });
    return () => { alive = false; };
  }, [status, page, nonce]);

  const sp = serverPage(total, page, QUEUE_PAGE);
  return (
    <Card eyebrow="scheduler" title={`${title}${count ? ` · ${count}` : ""}`}>
      {count === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>{empty}</div>
        : <>
          {items.map((q) => render(q))}
          <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
            onPage={setPage} unit="item" />
        </>}
    </Card>
  );
}

// Rem darurat: master enable (Stop/Aktifkan) + Pause/Lanjutkan. Menulis blok config penuh.
function ControlBar({ cfg, cap, liveCount, onWrite, busy }:
  { cfg: Scheduler; cap: number; liveCount: number; onWrite: (next: Scheduler) => void; busy: boolean }) {
  const stopped = !cfg.enabled;
  const tone = stopped ? "neutral" : cfg.paused ? "warn" : "ok";
  const label = stopped ? "berhenti" : cfg.paused ? "dijeda" : "aktif";
  return (
    <Card eyebrow="scheduler · rem darurat" title="Kendali">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Badge tone={tone as never}>{label}</Badge>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{liveCount} / {cap} sesi hidup</span>
        <span style={{ flex: 1 }} />
        {cfg.enabled && (
          <Button size="sm" variant="secondary" leftIcon={cfg.paused ? "play" : "pause"} disabled={busy}
            onClick={() => onWrite({ ...cfg, paused: !cfg.paused })}>{cfg.paused ? "Lanjutkan" : "Pause"}</Button>
        )}
        {cfg.enabled
          ? <Button size="sm" variant="ghost" leftIcon="square" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: false })}>Stop</Button>
          : <Button size="sm" leftIcon="play" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: true })}>Aktifkan</Button>}
      </div>
    </Card>
  );
}

// Panel setelan: form lokal disemai dari config, tombol Simpan menulis blok penuh (zScheduler).
function SettingsPanel({ cfg, onWrite, busy }: { cfg: Scheduler; onWrite: (next: Scheduler) => void; busy: boolean }) {
  const [draft, setDraft] = React.useState<Scheduler>(cfg);
  React.useEffect(() => { setDraft(cfg); }, [cfg]);
  const setSrc = (k: "backlog" | "triase", patch: Record<string, unknown>) =>
    setDraft((d) => ({ ...d, sources: { ...d.sources, [k]: { ...d.sources[k], ...patch } } }));
  const num = (v: string, min = 1) => Math.max(min, Number(v) || min);
  return (
    <Card eyebrow="scheduler · setelan" title="Konfigurasi"
      actions={<Button size="sm" leftIcon="save" disabled={busy} onClick={() => onWrite(draft)}>Simpan setelan</Button>}>
      <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="hn-eyebrow">Cap concurrent</span>
          <Input type="number" min={1} value={String(draft.maxConcurrent)} aria-label="Cap concurrent" placeholder="6"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, maxConcurrent: num(e.target.value) }))} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="hn-eyebrow">Autonomy</span>
          <Select value={draft.autonomy} aria-label="Autonomy"
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, autonomy: e.target.value as Scheduler["autonomy"] }))}
            options={[{ value: "butuh-keputusan", label: "butuh-keputusan" }, { value: "full-control", label: "full-control" }]} />
        </label>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {(["backlog", "triase"] as const).map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "10px 12px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
            <Switch label={k} checked={draft.sources[k].enabled} onChange={(next: boolean) => setSrc(k, { enabled: next })} />
            <span style={{ flex: 1 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
              tiap
              <Input type="number" min={1} style={{ width: 84 }} aria-label={`cadence ${k}`}
                placeholder="30" value={String(draft.sources[k].everyMin)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSrc(k, { everyMin: num(e.target.value) })} />
              menit
            </label>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Opt-in per project (pola helpEnabled): tombol Opt-in / Cabut opt-in per baris.
function OptInPanel({ projects, onToggle, busyId }:
  { projects: ProjectVM[]; onToggle: (id: string, next: boolean) => void; busyId: string | null }) {
  return (
    <Card eyebrow="scheduler · opt-in project" title="Project yang diizinkan">
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginBottom: 10 }}>
        Scheduler hanya menyentuh project yang di-opt-in. Default mati.
      </div>
      {projects.length === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada project.</div>
        : projects.map((p) => (
          <RowShell key={p.id}>
            <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)", fontWeight: 500 }}>{p.name}</span>
            <Badge tone={p.schedulerOptIn ? "ok" : "neutral"} size="sm">{p.schedulerOptIn ? "opt-in" : "mati"}</Badge>
            {p.schedulerOptIn
              ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busyId === p.id} onClick={() => onToggle(p.id, false)}>Cabut opt-in</Button>
              : <Button size="sm" leftIcon="check" disabled={busyId === p.id} onClick={() => onToggle(p.id, true)}>Opt-in</Button>}
          </RowShell>
        ))}
    </Card>
  );
}

export function SchedulerScreen({ projects, backlog, onProjectChanged, onToast, onGotoTerminal }: SchedulerScreenProps) {
  const [state, setState] = React.useState<SchedulerStateView | null>(null);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // SPEC-523 · penanda muat-ulang untuk QueueSection. Poll state 5 detik ikut menyegarkan halaman
  // antrean yang sedang tampil TANPA memindahkan operator dari halaman yang sedang dilihatnya.
  const [nonce, setNonce] = React.useState(0);

  const load = React.useCallback((silent = false) => {
    if (!silent) setPhase("loading");
    api.getSchedulerState()
      .then((s) => { setState(s); setPhase("ready"); setNonce((n) => n + 1); })
      .catch(() => { if (!silent) setPhase("error"); });   // silent poll tak pernah mem-blank
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const writeConfig = React.useCallback(async (next: Scheduler) => {
    setBusy(true);
    try { await api.putSchedulerConfig(next); onToast("Setelan scheduler tersimpan", "ok", "save"); load(true); }
    catch { onToast("Gagal menyimpan setelan", "err", "x-circle"); }
    finally { setBusy(false); }
  }, [load, onToast]);

  const toggleOptIn = React.useCallback(async (id: string, next: boolean) => {
    setBusyId(id);
    try { await api.updateProject(id, { schedulerOptIn: next }); await onProjectChanged(id); onToast(next ? "Project di-opt-in" : "Opt-in dicabut", "ok"); }
    catch { onToast("Gagal mengubah opt-in", "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [onProjectChanged, onToast]);

  // SPEC-522 · satu handler untuk kedua arah. `load(true)` dijalankan pada sukses MAUPUN gagal:
  // penolakan 409 berarti keadaan sebenarnya berbeda dari yang dilihat operator, jadi memuat ulang
  // adalah bagian dari jawabannya.
  const rowAction = React.useCallback(async (id: string, kind: "cancel" | "requeue") => {
    setBusyId(id);
    try {
      if (kind === "cancel") { await api.cancelSchedulerQueueItem(id); onToast("Item antrean dibatalkan", "ok", "ban"); }
      else { await api.requeueSchedulerQueueItem(id); onToast("Item dikembalikan ke antrean", "ok", "rotate-ccw"); }
    } catch (e) {
      // 409 membawa kalimatnya sendiri ("sesinya sudah berjalan — tutup dari Terminal"); toast
      // "gagal" saja menyembunyikan satu-satunya keterangan yang bisa ditindaklanjuti.
      const detail = (e as { detail?: { error?: string } }).detail;
      onToast(detail?.error ?? "Gagal mengubah item antrean", "err", "x-circle");
    } finally { setBusyId(null); load(true); }
  }, [load, onToast]);

  if (phase === "loading") return <StateBlock kind="loading" />;
  if (phase === "error" || !state) return <StateBlock kind="error" hint="Gagal memuat state scheduler." action={() => load()} actionLabel="Coba lagi" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      <ControlBar cfg={state.config} cap={state.cap} liveCount={state.liveCount} onWrite={writeConfig} busy={busy} />

      <Card eyebrow="scheduler · observabilitas" title="Status per source">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {state.sources.map((s) => <SourceCard key={s.id} s={s} />)}
        </div>
      </Card>

      {/* SPEC-646 · ADR-0112 · cronjob per project: jadwal HH:MM yang ditunda ADR-0072. */}
      <SchedulerCrons projects={projects} onProjectChanged={onProjectChanged} onToast={onToast} />

      <QueueSection title="Antrean" status="queued" count={state.queueCounts.queued} empty="Antrean kosong."
        nonce={nonce} render={(q) => <QueueRow key={q.id} q={q} backlog={backlog}
          onCancel={(id) => void rowAction(id, "cancel")} busy={busyId === q.id} />} />

      {/* SPEC-522 · tombstone punya seksinya sendiri; SPEC-523 · dibaca berhalaman lewat
          `GET /scheduler/queue?status=canceled`, bukan dari `state`. */}
      <QueueSection title="Dibatalkan" status="canceled" count={state.queueCounts.canceled}
        empty="Tak ada item yang dibatalkan." nonce={nonce}
        render={(q) => <CanceledRow key={q.id} q={q} backlog={backlog}
          onRequeue={(id) => void rowAction(id, "requeue")} busy={busyId === q.id} />} />

      <Section title="Sesi berjalan" count={state.sessions.length} empty="Tak ada sesi scheduler berjalan.">
        {state.sessions.map((s) => <SessionRow key={s.id} s={s} backlog={backlog} onGotoTerminal={onGotoTerminal} />)}
      </Section>

      <QueueSection title="Selesai (done)" status="done" count={state.queueCounts.done} empty="Belum ada hasil selesai."
        nonce={nonce} render={(q) => <DoneRow key={q.id} q={q} backlog={backlog} onToast={onToast} />} />

      <QueueSection title="Gagal" status="failed" count={state.queueCounts.failed} empty="Tak ada sesi gagal."
        nonce={nonce} render={(q) => <FailedRow key={q.id} q={q} backlog={backlog} />} />

      <SettingsPanel cfg={state.config} onWrite={writeConfig} busy={busy} />
      <OptInPanel projects={projects} onToggle={toggleOptIn} busyId={busyId} />
    </div>
  );
}
