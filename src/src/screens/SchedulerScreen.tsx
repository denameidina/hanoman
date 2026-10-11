/* SchedulerScreen — panel scheduler otonom (SPEC-299, daun #6 ADR-0072). Screen mandiri (pola
   VpsScreen): memuat state fondasi sendiri lewat HTTP. Menampilkan status per sumber, sesi berjalan,
   antrean, gagal + alasan, done + link review; panel setelan menulis semua knob
   (PUT /api/scheduler/config), opt-in per project (pola helpEnabled → PATCH /projects/:id), dan rem
   darurat Jeda/Hentikan (keduanya lewat dialog konfirmasi yang menyebut dampaknya).
   SPEC-908 · realtime kini lewat langganan berparameter di `/events/ws` — topik `schedulerState`
   untuk layar dan `schedulerQueue` per seksi antrean; HTTP tinggal muat awal + fallback saat
   server belum punya topiknya. Penanda `nonce` SPEC-523 dicabut bersamanya.
   Audit UI/UX 2026-10 (1G): antrean di atas, setelan di bawah; seksi kosong (Gagal, Dibatalkan)
   disembunyikan; galat muat tampil sebagai galat; input angka tak memaksa nilai saat diketik. */
import React from "react";
import { Card, Button, Badge, Select, Switch, Input, StateBlock, Icon, Pager, serverPage, LiveConnectionBadge, useConfirm } from "../ds";
import { api } from "../api/client";
import { useLiveTopic } from "../api/live";
import type {
  SchedulerStateView, SchedulerQueueItemView, SchedulerSessionView, SchedulerSourceView, Scheduler,
  TopicParams, LaunchStatus, OrchestrationFlow,
} from "@hanoman/shared";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";
import type { ProjectVM, SpecSlim } from "./types";
import { specDeepLink } from "./deeplink";
import { SchedulerCrons } from "./SchedulerCrons";
import { FLOW_LABEL } from "./OrchestrationPanel";
import { usePersistedState, isNum } from "../ui-state";
import { failureMessage } from "../lib/report-error";
import { PRIORITY_LABEL, QUEUE_SOURCE_LABEL, labelOf } from "../lib/labels";
import { agoLabel, untilLabel, clampNumber, InlineError, useServerDraft } from "./sched-lead-shared";

// SPEC-908 · tinggal kadens FALLBACK; jalur normalnya langganan `/events/ws`.
const POLL_MS = 5000;
const QUEUE_PAGE = 10;
// Status antrean yang punya seksinya sendiri — disempitkan dari `string` supaya cocok
// dengan skema parameter topik `schedulerQueue`.
type QueueStatus = TopicParams["schedulerQueue"]["status"];

// Istilah baku per enum ada di lib/labels.ts: layar tak pernah menampilkan nilai mentah (`backlog`, `tinggi`, …).
const PRIO_TONE: Record<string, string> = { tinggi: "err", sedang: "warn", rendah: "neutral" };
const AUTONOMY_OPTIONS = [
  { value: "butuh-keputusan", label: "Berhenti dan minta keputusan dulu" },
  { value: "full-control", label: "Jalan sampai selesai tanpa berhenti" },
];

export type SchedulerScreenProps = {
  projects: ProjectVM[]; backlog: SpecSlim[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onGotoTerminal: (sessionId: string) => void;
};

// Konteks tampilan bersama: judul spec dari backlog dan nama project (bukan ID mentah).
type Ctx = { backlog: SpecSlim[]; projectName: (id: string) => string };

const serverReason = (e: unknown): string | undefined => (e as { detail?: { error?: string } }).detail?.error;

function titleFor(specId: string, backlog: SpecSlim[]): string {
  return backlog.find((s) => s.id === specId)?.title ?? specId;
}

function SourceCard({ s }: { s: SchedulerSourceView }) {
  return (
    <div style={{ padding: "12px 14px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
      background: "var(--surface-card)", display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 180 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{labelOf(QUEUE_SOURCE_LABEL, s.id)}</span>
        <Badge tone={s.enabled ? "ok" : "neutral"} size="sm">{s.enabled ? "aktif" : "nonaktif"}</Badge>
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
        cek tiap {s.everyMin} menit
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        {s.lastRunAt ? `terakhir ${agoLabel(s.lastRunAt)}` : "belum pernah dicek"}
        {" · "}
        {s.nextRunAt ? `berikutnya ${untilLabel(s.nextRunAt)}` : "belum dijadwalkan"}
      </div>
    </div>
  );
}

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function QueueRow({ q, ctx, onCancel, busy }:
  { q: SchedulerQueueItemView; ctx: Ctx; onCancel: (id: string) => void; busy: boolean }) {
  return (
    <RowShell>
      <span className="hn-grow" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, ctx.backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {ctx.projectName(q.projectId)} · {labelOf(QUEUE_SOURCE_LABEL, q.source)}{q.note ? ` · ${q.note}` : ""}
        </span>
      </span>
      <Badge tone={(PRIO_TONE[q.priority] ?? "neutral") as never} size="sm">{labelOf(PRIORITY_LABEL, q.priority)}</Badge>
      {/* SPEC-522 · tanpa dialog konfirmasi: tindakannya reversibel lewat "Antre lagi", dan
          konfirmasi untuk tindakan reversibel adalah gesekan tanpa hasil. */}
      <Button size="sm" variant="ghost" leftIcon="ban" disabled={busy} onClick={() => onCancel(q.id)}>Batalkan</Button>
    </RowShell>
  );
}

// SPEC-522 · ADR-0106 · baris tombstone: ia sengaja TIDAK dihapus — `enqueue` (`upsert`
// ber-`update:{}`) karena itu tak bisa menghidupkannya lagi saat checker `backlog` menjumpai spec
// yang sama pada cadence berikutnya.
function CanceledRow({ q, ctx, onRequeue, busy }:
  { q: SchedulerQueueItemView; ctx: Ctx; onRequeue: (id: string) => void; busy: boolean }) {
  return (
    <RowShell>
      <Icon name="ban" size={16} color="var(--text-subtle)" />
      <span className="hn-grow" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, ctx.backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {ctx.projectName(q.projectId)} · {labelOf(QUEUE_SOURCE_LABEL, q.source)} · {q.note ?? "dibatalkan"}
        </span>
      </span>
      <Button size="sm" variant="ghost" leftIcon="rotate-ccw" disabled={busy} onClick={() => onRequeue(q.id)}>Antre lagi</Button>
    </RowShell>
  );
}

function SessionRow({ s, ctx, onGotoTerminal }: { s: SchedulerSessionView; ctx: Ctx; onGotoTerminal: (sessionId: string) => void }) {
  const flow = s.flow ? (FLOW_LABEL[s.flow as OrchestrationFlow] ?? s.flow) : "";
  return (
    <RowShell>
      <span className="hn-grow" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(s.specId, ctx.backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {ctx.projectName(s.projectId)}{flow ? ` · ${flow}` : ""}
        </span>
      </span>
      {s.decision && <Badge tone="warn" icon="bell" size="sm">menunggu kamu</Badge>}
      <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGotoTerminal(s.id)}>Buka terminal</Button>
    </RowShell>
  );
}

function DoneRow({ q, ctx, onToast }: { q: SchedulerQueueItemView; ctx: Ctx; onToast: SchedulerScreenProps["onToast"] }) {
  const link = specDeepLink(q.specId);
  return (
    <RowShell>
      <span className="hn-grow" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, ctx.backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {/* SPEC-431 · baris yang ditutup gerbang "spec sudah selesai" tak pernah punya sesi;
              "selesai —" akan terbaca seolah scheduler yang menyelesaikannya. */}
          {ctx.projectName(q.projectId)} · {labelOf(QUEUE_SOURCE_LABEL, q.source)} · {q.launchedAt ? `selesai ${agoLabel(q.launchedAt)}` : (q.note ?? "tidak diluncurkan")}
        </span>
      </span>
      <Button size="sm" variant="ghost" leftIcon="external-link" onClick={() => window.open(link, "_blank", "noreferrer")}>Buka review</Button>
      <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(link); onToast("Link review disalin", "ok", "copy"); }}>Salin</Button>
    </RowShell>
  );
}

// Gagal punya jalan keluar: "Antre ulang" mengembalikan item ke antrean (lihat rowAction).
function FailedRow({ q, ctx, onRequeue, busy }:
  { q: SchedulerQueueItemView; ctx: Ctx; onRequeue: (id: string) => void; busy: boolean }) {
  return (
    <RowShell>
      <Icon name="x-circle" size={16} color="var(--clay-500)" />
      <span className="hn-grow" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{titleFor(q.specId, ctx.backlog)}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {ctx.projectName(q.projectId)} · {q.note ?? "gagal tanpa alasan tercatat"}
        </span>
      </span>
      <Button size="sm" variant="secondary" leftIcon="rotate-ccw" disabled={busy} onClick={() => onRequeue(q.id)}>Antre ulang</Button>
    </RowShell>
  );
}

/* SPEC-523 · satu bagian antrean = satu daftar berhalaman yang memuat datanya sendiri.
   Galat muat TAMPIL sebagai galat dengan Coba lagi — bukan sebagai "Antrean kosong", yang berbohong. */
function QueueSection({ title, what, status, count, empty, render }: {
  title: string; what: string; status: QueueStatus; count: number; empty: string;
  render: (q: SchedulerQueueItemView) => React.ReactNode;
}) {
  const [items, setItems] = React.useState<SchedulerQueueItemView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  // SPEC-740 · ADR-0115 · tiga seksi antrean memakai komponen yang SAMA — kuncinya wajib
  // memuat `status`, kalau tidak ketiganya berbagi satu nomor halaman.
  const [page, setPage] = usePersistedState("scheduler", `queue-${status}-page`, 1, isNum);

  const load = React.useCallback(() => {
    api.getSchedulerQueue({ status, page, limit: QUEUE_PAGE })
      .then((r) => { setItems(r.items); setTotal(r.total); setError(null); })
      .catch((e) => setError(failureMessage(`memuat ${what}`, e)));
  }, [status, page, what]);
  React.useEffect(() => { load(); }, [load]);
  // SPEC-908 · tiap seksi berlangganan (status, halaman)-nya SENDIRI, jadi penanda muat-ulang
  // `nonce` (SPEC-523) — yang dulu di-bump oleh poll state 5 dtk — tak punya pekerjaan lagi.
  useLiveTopic({
    topic: "schedulerQueue", params: { status, page, limit: QUEUE_PAGE },
    apply: (m) => { setItems(m.data.items); setTotal(m.data.total); setError(null); },
    refetch: () => { load(); }, pollMs: POLL_MS,
  });

  const sp = serverPage(total, page, QUEUE_PAGE);
  return (
    <Card eyebrow="scheduler" title={`${title}${count ? ` · ${count}` : ""}`}>
      {error
        ? <InlineError message={error} onRetry={load} />
        : count === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>{empty}</div>
          : <>
            {items.map((q) => render(q))}
            <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
              onPage={setPage} unit="item" />
          </>}
    </Card>
  );
}

// Rem darurat. Jeda & Hentikan MINTA KONFIRMASI (dialog menyebut dampaknya) lewat `onAsk`; Hentikan
// memakai varian `danger` supaya hierarkinya terbaca: rem darurat, bukan tombol sekunder biasa.
function ControlBar({ cfg, cap, liveCount, onWrite, onAsk, busy }:
  { cfg: Scheduler; cap: number; liveCount: number;
    onWrite: (next: Scheduler, msg: string) => void;
    onAsk: (next: Scheduler, kind: "jeda" | "hentikan") => void; busy: boolean }) {
  const stopped = !cfg.enabled;
  const tone = stopped ? "neutral" : cfg.paused ? "warn" : "ok";
  const label = stopped ? "berhenti" : cfg.paused ? "dijeda" : "aktif";
  return (
    <Card eyebrow="scheduler · kendali" title="Kendali scheduler">
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Badge tone={tone as never}>{label}</Badge>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{liveCount} / {cap} sesi hidup</span>
        <LiveConnectionBadge />
        <span style={{ flex: 1 }} />
        {cfg.enabled && (cfg.paused
          ? <Button size="sm" variant="secondary" leftIcon="play" disabled={busy}
              onClick={() => onWrite({ ...cfg, paused: false }, "Scheduler dilanjutkan")}>Lanjutkan</Button>
          : <Button size="sm" variant="secondary" leftIcon="pause" disabled={busy}
              onClick={() => onAsk({ ...cfg, paused: true }, "jeda")}>Jeda</Button>)}
        {cfg.enabled
          ? <Button size="sm" variant="danger" leftIcon="square" disabled={busy}
              onClick={() => onAsk({ ...cfg, enabled: false }, "hentikan")}>Hentikan</Button>
          : <Button size="sm" leftIcon="play" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: true }, "Scheduler diaktifkan")}>Aktifkan</Button>}
      </div>
    </Card>
  );
}

// Pemeriksaan sebelum peluncuran (launchGuard, ADR-0161/0170) — status saat ini, bahasa biasa.
function AdmissionStatus({ status }: { status: LaunchStatus }) {
  return (
    <Card eyebrow="host · peluncuran sesi" title="Pemeriksaan sebelum peluncuran">
      <div aria-label="Status pemeriksaan peluncuran" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", lineHeight: 1.6 }}>
        <div>Pemeriksaan {status.enabled ? "aktif" : "nonaktif"} · {status.liveCount} dari batas {status.maxConcurrent} sesi berjalan ({status.liveAgentCount} di antaranya agen)</div>
        <div>Beban CPU per inti: {status.loadStatus === "available" && status.loadPerCore !== null
          ? status.loadPerCore.toFixed(2) : "tidak tersedia"}
          {status.loadStatus === "unsupported" ? " (tidak didukung platform)" : ""} · batas {status.maxLoadPerCore}</div>
        <div>Memori bebas: {status.memStatus === "available" && status.memAvailablePct !== null
          ? `${status.memAvailablePct.toFixed(0)}%` : "tidak tersedia"} · minimal {status.minMemAvailablePct}%</div>
        <div style={{ fontSize: "var(--text-xs)", marginTop: 6 }}>
          Berlaku juga saat scheduler berhenti. Terminal dan shell tetap bisa dibuka, dan keduanya ikut dihitung dalam batas sesi.
        </div>
      </div>
    </Card>
  );
}

// Setelan: draft lokal berisi TEKS untuk kolom angka (boleh kosong saat diketik). Angka dijepit saat
// kolom kehilangan fokus, dan disimpan saat Enter atau tombol "Simpan setelan". Snapshot server yang
// datang di tengah edit (Jeda/Hentikan, langganan live) tak menghapus draft ini.
type SettingsForm = {
  maxConcurrent: string; autonomy: Scheduler["autonomy"]; guardOn: boolean; maxLoad: string; minMem: string;
  sources: Record<"backlog" | "triase", { enabled: boolean; everyMin: string }>;
};
const formOf = (cfg: Scheduler): SettingsForm => {
  const g = cfg.launchGuard ?? SCHEDULER_DEFAULTS.launchGuard;
  return {
    maxConcurrent: String(cfg.maxConcurrent), autonomy: cfg.autonomy, guardOn: g.enabled,
    maxLoad: String(g.maxLoadPerCore), minMem: String(g.minMemAvailablePct),
    sources: {
      backlog: { enabled: cfg.sources.backlog.enabled, everyMin: String(cfg.sources.backlog.everyMin) },
      triase: { enabled: cfg.sources.triase.enabled, everyMin: String(cfg.sources.triase.everyMin) },
    },
  };
};
// Bentuk tersimpan: TIMPA hanya kolom setelan. `enabled` dan `paused` diambil dari `cfg` terbaru,
// bukan dari draft — supaya menyimpan setelan tak pernah membatalkan Jeda/Hentikan yang baru ditekan.
const payloadFrom = (f: SettingsForm, cfg: Scheduler): Scheduler => {
  const g = cfg.launchGuard ?? SCHEDULER_DEFAULTS.launchGuard;
  const bl = cfg.sources.backlog, tr = cfg.sources.triase;
  return {
    ...cfg,
    maxConcurrent: clampNumber(f.maxConcurrent, 1, Infinity, cfg.maxConcurrent),
    autonomy: f.autonomy,
    launchGuard: {
      ...g,
      enabled: f.guardOn,
      maxLoadPerCore: clampNumber(f.maxLoad, 0.1, Infinity, g.maxLoadPerCore, false),
      minMemAvailablePct: clampNumber(f.minMem, 0, 100, g.minMemAvailablePct, false),
    },
    sources: {
      ...cfg.sources,
      backlog: { ...bl, enabled: f.sources.backlog.enabled, everyMin: clampNumber(f.sources.backlog.everyMin, 1, Infinity, bl.everyMin) },
      triase: { ...tr, enabled: f.sources.triase.enabled, everyMin: clampNumber(f.sources.triase.everyMin, 1, Infinity, tr.everyMin) },
    },
  };
};

function SettingsPanel({ cfg, onWrite, busy }: { cfg: Scheduler; onWrite: (next: Scheduler) => void; busy: boolean }) {
  const { draft, setDraft, dirty } = useServerDraft<SettingsForm>(formOf(cfg));
  // Jepit semua angka ke rentang yang sah dan tampilkan hasilnya (tanpa menyimpan).
  const normalize = (d: SettingsForm): SettingsForm => formOf(payloadFrom(d, cfg));
  const blur = () => setDraft((d) => normalize(d));
  const commit = () => {
    const next = payloadFrom(draft, cfg);
    setDraft(formOf(next));
    onWrite(next);
  };
  const enterCommits = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
  };
  const setSrc = (k: "backlog" | "triase", patch: Partial<SettingsForm["sources"]["backlog"]>) =>
    setDraft((d) => ({ ...d, sources: { ...d.sources, [k]: { ...d.sources[k], ...patch } } }));
  return (
    <Card eyebrow="scheduler · setelan" title="Setelan"
      actions={<Button size="sm" leftIcon="save" disabled={busy} onClick={commit}>Simpan setelan</Button>}>
      <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="hn-eyebrow">Batas sesi berjalan</span>
          <Input type="number" min={1} value={draft.maxConcurrent} aria-label="Batas sesi berjalan" placeholder="mis. 6"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, maxConcurrent: e.target.value }))}
            onBlur={blur} onKeyDown={enterCommits} />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="hn-eyebrow">Mode otonomi</span>
            <Select value={draft.autonomy} aria-label="Mode otonomi"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, autonomy: e.target.value as Scheduler["autonomy"] }))}
              options={AUTONOMY_OPTIONS} />
          </label>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
            Keputusan yang ambigu tetap ditanyakan ke lead atau kamu.
          </span>
        </div>
      </div>
      <div style={{ marginTop: 14, padding: "10px 12px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
        <Switch label="Pemeriksaan sebelum peluncuran" checked={draft.guardOn}
          onChange={(on: boolean) => setDraft((d) => ({ ...d, guardOn: on }))} />
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Mencegah sesi baru diluncurkan saat batas sesi penuh, beban CPU per inti terlalu tinggi, atau memori
          bebas terlalu sedikit. Berlaku juga untuk peluncuran manual. Mematikannya melewati ketiga pemeriksaan
          itu. Terpisah dari saklar scheduler dan sumber.
        </p>
        <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="hn-eyebrow">Batas beban CPU per inti</span>
              <Input type="number" min={0.1} step="any" value={draft.maxLoad} aria-label="Batas beban CPU per inti" placeholder="mis. 2.5"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, maxLoad: e.target.value }))}
                onBlur={blur} onKeyDown={enterCommits} />
            </label>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>Di atas angka ini, sesi baru tidak diluncurkan.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="hn-eyebrow">Memori bebas minimal (%)</span>
              <Input type="number" min={0} max={100} step="any" value={draft.minMem} aria-label="Memori bebas minimal (%)" placeholder="mis. 15"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, minMem: e.target.value }))}
                onBlur={blur} onKeyDown={enterCommits} />
            </label>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>Di bawah angka ini, sesi baru tidak diluncurkan.</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {(["backlog", "triase"] as const).map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "10px 12px", border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)" }}>
            <Switch label={QUEUE_SOURCE_LABEL[k]} checked={draft.sources[k].enabled} onChange={(next: boolean) => setSrc(k, { enabled: next })} />
            <span style={{ flex: 1 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
              cek tiap
              <Input type="number" min={1} style={{ width: 84 }} aria-label={`Interval cek ${QUEUE_SOURCE_LABEL[k]}`}
                placeholder="30" value={draft.sources[k].everyMin}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSrc(k, { everyMin: e.target.value })}
                onBlur={blur} onKeyDown={enterCommits} />
              menit
            </label>
          </div>
        ))}
      </div>
      {dirty && (
        <div role="status" style={{ marginTop: 12, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          Ada perubahan yang belum disimpan.
        </div>
      )}
    </Card>
  );
}

// Izin per project (dulu "opt-in"): hanya project yang diizinkan yang disentuh scheduler.
function OptInPanel({ projects, onToggle, busyId }:
  { projects: ProjectVM[]; onToggle: (id: string, next: boolean) => void; busyId: string | null }) {
  return (
    <Card eyebrow="scheduler · project" title="Project yang diizinkan">
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginBottom: 10 }}>
        Scheduler hanya menyentuh project yang diizinkan. Default: tidak diizinkan.
      </div>
      {projects.length === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada project.</div>
        : projects.map((p) => (
          <RowShell key={p.id}>
            <span className="hn-grow" style={{ flex: 1, minWidth: 0, color: "var(--text-strong)", fontWeight: 500 }}>{p.name}</span>
            <Badge tone={p.schedulerOptIn ? "ok" : "neutral"} size="sm">{p.schedulerOptIn ? "diizinkan" : "tidak diizinkan"}</Badge>
            {p.schedulerOptIn
              ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busyId === p.id} onClick={() => onToggle(p.id, false)}>Cabut izin</Button>
              : <Button size="sm" leftIcon="check" disabled={busyId === p.id} onClick={() => onToggle(p.id, true)}>Izinkan</Button>}
          </RowShell>
        ))}
    </Card>
  );
}

export function SchedulerScreen({ projects, backlog, onProjectChanged, onToast, onGotoTerminal }: SchedulerScreenProps) {
  const { confirm, dialog } = useConfirm();
  const [state, setState] = React.useState<SchedulerStateView | null>(null);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const load = React.useCallback((silent = false) => {
    if (!silent) setPhase("loading");
    api.getSchedulerState()
      .then((s) => { setState(s); setPhase("ready"); })
      .catch(() => { if (!silent) setPhase("error"); });   // silent poll tak pernah mem-blank
  }, []);
  React.useEffect(() => { load(); }, [load]);
  // SPEC-908 · state scheduler didorong lewat langganan `/events/ws`; POLL_MS tinggal kadens
  // fallback saat server belum punya topiknya (ADR-0087) atau WS terhalang.
  useLiveTopic({
    topic: "schedulerState", params: {},
    apply: (m) => { setState(m.state); setPhase("ready"); },
    refetch: () => load(true), pollMs: POLL_MS,
  });

  const writeConfig = React.useCallback(async (next: Scheduler, msg = "Setelan scheduler tersimpan") => {
    setBusy(true);
    try { await api.putSchedulerConfig(next); onToast(msg, "ok", "save"); load(true); }
    catch (e) { onToast(serverReason(e) ?? failureMessage("menyimpan setelan", e), "err", "x-circle"); }
    finally { setBusy(false); }
  }, [load, onToast]);

  // Jeda & Hentikan = rem darurat: dialog menyebut dampaknya; tombol konfirmasi baru menulis setelah
  // dialog setuju (dialog tetap terbuka dan sibuk selama tulisannya berjalan).
  const askControl = React.useCallback((next: Scheduler, kind: "jeda" | "hentikan") => {
    const jeda = kind === "jeda";
    void confirm({
      title: jeda ? "Jeda scheduler?" : "Hentikan scheduler?",
      eyebrow: "scheduler · rem darurat",
      message: jeda
        ? "Scheduler berhenti meluncurkan sesi baru dari antrean sampai kamu melanjutkannya. Sesi yang sudah berjalan tidak dihentikan."
        : undefined,
      impact: jeda ? undefined : [
        "Sumber backlog dan triase tidak lagi diperiksa sampai diaktifkan lagi.",
        "Antrean tetap tersimpan dan tidak diproses selama berhenti.",
        "Sesi yang sudah berjalan tetap berjalan.",
      ],
      confirmLabel: jeda ? "Jeda scheduler" : "Hentikan scheduler",
      icon: jeda ? "pause" : "square",
      tone: jeda ? "default" : "danger",
      run: () => writeConfig(next, jeda ? "Scheduler dijeda" : "Scheduler dihentikan"),
    });
  }, [confirm, writeConfig]);

  const toggleOptIn = React.useCallback(async (id: string, next: boolean) => {
    setBusyId(id);
    try { await api.updateProject(id, { schedulerOptIn: next }); await onProjectChanged(id); onToast(next ? "Project diizinkan untuk scheduler" : "Izin scheduler dicabut", "ok"); }
    catch (e) { onToast(failureMessage("mengubah izin project", e), "err", "x-circle"); }
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
      const action = kind === "cancel" ? "membatalkan item antrean" : "mengembalikan item ke antrean";
      onToast(serverReason(e) ?? failureMessage(action, e), "err", "x-circle");
    } finally { setBusyId(null); load(true); }
  }, [load, onToast]);

  if (phase === "loading") return <StateBlock kind="loading" />;
  if (phase === "error" || !state) return <StateBlock kind="error" hint="Gagal memuat state scheduler." action={() => load()} actionLabel="Coba lagi" />;

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "Project lain";
  const ctx: Ctx = { backlog, projectName };
  const counts = state.queueCounts;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      <ControlBar cfg={state.config} cap={state.cap} liveCount={state.liveCount} onWrite={writeConfig} onAsk={askControl} busy={busy} />

      <Card eyebrow="scheduler · sumber" title="Sumber otomatis">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {state.sources.map((s) => <SourceCard key={s.id} s={s} />)}
        </div>
      </Card>

      {/* Urutan kerja: yang sedang berjalan dan yang antre di atas; yang perlu tindakan segera (Gagal)
          tepat di bawahnya; riwayat (Selesai, Dibatalkan) di bawah. Seksi kosong disembunyikan. */}
      <Card eyebrow="scheduler" title={`Sesi berjalan${state.sessions.length ? ` · ${state.sessions.length}` : ""}`}>
        {state.sessions.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Tidak ada sesi dari scheduler yang sedang berjalan.</div>
          : state.sessions.map((s) => <SessionRow key={s.id} s={s} ctx={ctx} onGotoTerminal={onGotoTerminal} />)}
      </Card>

      <QueueSection title="Antrean" what="antrean" status="queued" count={counts.queued} empty="Antrean kosong."
        render={(q) => <QueueRow key={q.id} q={q} ctx={ctx}
          onCancel={(id) => void rowAction(id, "cancel")} busy={busyId === q.id} />} />

      {counts.failed > 0 && (
        <QueueSection title="Gagal" what="item yang gagal" status="failed" count={counts.failed} empty="Tidak ada sesi gagal."
          render={(q) => <FailedRow key={q.id} q={q} ctx={ctx}
            onRequeue={(id) => void rowAction(id, "requeue")} busy={busyId === q.id} />} />
      )}

      <QueueSection title="Selesai" what="item yang selesai" status="done" count={counts.done} empty="Belum ada hasil selesai."
        render={(q) => <DoneRow key={q.id} q={q} ctx={ctx} onToast={onToast} />} />

      {/* SPEC-522 · tombstone punya seksinya sendiri; SPEC-523 · dibaca berhalaman lewat
          `GET /scheduler/queue?status=canceled`, bukan dari `state`. */}
      {counts.canceled > 0 && (
        <QueueSection title="Dibatalkan" what="item yang dibatalkan" status="canceled" count={counts.canceled} empty="Tak ada item yang dibatalkan."
          render={(q) => <CanceledRow key={q.id} q={q} ctx={ctx}
            onRequeue={(id) => void rowAction(id, "requeue")} busy={busyId === q.id} />} />
      )}

      {/* SPEC-646 · ADR-0112 · cronjob per project: jadwal HH:MM yang ditunda ADR-0072. */}
      <SchedulerCrons projects={projects} onProjectChanged={onProjectChanged} onToast={onToast} />

      <SettingsPanel cfg={state.config} onWrite={(next) => void writeConfig(next)} busy={busy} />
      {state.admission && <AdmissionStatus status={state.admission} />}
      <OptInPanel projects={projects} onToggle={toggleOptIn} busyId={busyId} />
      {dialog}
    </div>
  );
}
