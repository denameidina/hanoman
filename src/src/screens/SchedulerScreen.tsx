/* SchedulerScreen — tab Scheduler di hub Otonom (ADR-0205). Redesign Audit UI/UX 2026-10 · Fase 3I:
   - Strip status satu baris di atas: state (Berjalan/Dijeda/Berhenti), kapasitas "N dari M sesi", limit
     ringkas, dan kendali. Jeda/Lanjutkan biasa; Hentikan rem darurat (danger, lewat konfirmasi).
   - Lima tab: Antre · Berjalan · Riwayat (Selesai/Gagal/Dibatalkan sebagai filter chip) · Cron · Setelan.
     Tab aktif bertahan di `hn.ui` (ADR-0115). Tab kosong hanya menampilkan satu baris keterangan.
   - Setelan memakai bahasa biasa dengan draft + Simpan. Orkestrasi per flow ada di bawahnya sebagai
     baris yang bisa dibuka, dan tersimpan saat diubah (pola Settings 3C).
   Realtime tetap lewat `/events/ws` (SPEC-908): `schedulerState` untuk strip dan tab Berjalan,
   `schedulerQueue` per seksi antrean yang sedang tampil. HTTP hanya untuk muat awal dan fallback. */
import React from "react";
import {
  Badge, Button, Field, Input, Select, StateBlock, Switch, Pager, serverPage, LiveConnectionBadge, useConfirm,
  Tabs, TabPanel, RowList, DenseRow, ProgressBar, StatusPill, SkeletonList,
} from "../ds";
import { LimitBadge, CodexLimitBadge } from "./LimitIndicator";
import { api } from "../api/client";
import { useLiveTopic } from "../api/live";
import type {
  Orchestration, Setting, SchedulerStateView, SchedulerQueueItemView, SchedulerSessionView, SchedulerSourceView,
  Scheduler, LaunchStatus, OrchestrationFlow, TopicParams,
} from "@hanoman/shared";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";
import type { ProjectVM, SpecSlim } from "./types";
import { specDeepLink } from "./deeplink";
import { SchedulerCrons } from "./SchedulerCrons";
import { OrchestrationPanel, FLOW_LABEL } from "./OrchestrationPanel";
import { usePersistedState, isNum, oneOf } from "../ui-state";
import { failureMessage } from "../lib/report-error";
import { PRIORITY_LABEL, QUEUE_SOURCE_LABEL, labelOf } from "../lib/labels";
import { agoLabel, untilLabel, clampNumber, InlineError, useServerDraft } from "./sched-lead-shared";
import { rebaseEdits } from "./settings-rebase";
import "./styles/scheduler.css";

// SPEC-908 · tinggal kadens FALLBACK; jalur normalnya langganan `/events/ws`.
const POLL_MS = 5000;
const QUEUE_PAGE = 10;
// Status antrean yang punya seksinya sendiri — disempitkan dari `string` supaya cocok
// dengan skema parameter topik `schedulerQueue`.
type QueueStatus = TopicParams["schedulerQueue"]["status"];
type Tone = NonNullable<React.ComponentProps<typeof Badge>["tone"]>;

type MainTab = "antre" | "berjalan" | "riwayat" | "cron" | "setelan";
const MAIN_TABS: readonly MainTab[] = ["antre", "berjalan", "riwayat", "cron", "setelan"];
type HistoryStatus = "done" | "failed" | "canceled";
const HISTORY_STATUSES: readonly HistoryStatus[] = ["done", "failed", "canceled"];
// Label huruf-besar untuk chip riwayat. `QUEUE_STATUS_LABEL` sengaja huruf kecil (dipakai dalam kalimat).
const HISTORY_LABEL: Record<HistoryStatus, string> = { done: "Selesai", failed: "Gagal", canceled: "Dibatalkan" };

// Istilah baku per enum ada di lib/labels.ts: layar tak pernah menampilkan nilai mentah (`backlog`, `tinggi`, …).
const PRIO_TONE: Record<string, Tone> = { tinggi: "err", sedang: "warn", rendah: "neutral" };
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

function RowTitle({ specId, ctx }: { specId: string; ctx: Ctx }) {
  return <span className="hn-sched-row-title">{titleFor(specId, ctx.backlog)}</span>;
}

// ---------------------------------------------------------------- baris per status antrean

function QueuedRow({ q, ctx, busy, onCancel }:
  { q: SchedulerQueueItemView; ctx: Ctx; busy: boolean; onCancel: (id: string) => void }) {
  // SPEC-522 · tanpa dialog konfirmasi: tindakannya reversibel lewat "Antre lagi" di Riwayat.
  return (
    <DenseRow actions={<Button size="sm" variant="ghost" leftIcon="ban" disabled={busy} onClick={() => onCancel(q.id)}>Batalkan</Button>}>
      <span className="hn-sched-row-text">
        <span className="hn-sched-row-head">
          <RowTitle specId={q.specId} ctx={ctx} />
          <Badge tone={PRIO_TONE[q.priority] ?? "neutral"} size="sm">{labelOf(PRIORITY_LABEL, q.priority)}</Badge>
        </span>
        <span className="hn-sched-row-meta">
          {ctx.projectName(q.projectId)} · {labelOf(QUEUE_SOURCE_LABEL, q.source)}{q.note ? ` · ${q.note}` : ""}
        </span>
      </span>
    </DenseRow>
  );
}

function SessionRow({ s, ctx, onGotoTerminal }:
  { s: SchedulerSessionView; ctx: Ctx; onGotoTerminal: (sessionId: string) => void }) {
  const flow = s.flow ? (FLOW_LABEL[s.flow as OrchestrationFlow] ?? s.flow) : "";
  return (
    <DenseRow actions={<Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGotoTerminal(s.id)}>Buka terminal</Button>}>
      <span className="hn-sched-row-text">
        <span className="hn-sched-row-head">
          <RowTitle specId={s.specId} ctx={ctx} />
          {s.decision && <Badge tone="warn" icon="bell" size="sm">menunggu kamu</Badge>}
        </span>
        <span className="hn-sched-row-meta">{ctx.projectName(s.projectId)}{flow ? ` · ${flow}` : ""}</span>
      </span>
    </DenseRow>
  );
}

function DoneRow({ q, ctx, onToast }:
  { q: SchedulerQueueItemView; ctx: Ctx; onToast: SchedulerScreenProps["onToast"] }) {
  const link = specDeepLink(q.specId);
  return (
    <DenseRow actions={<>
      <Button size="sm" variant="ghost" leftIcon="external-link" onClick={() => window.open(link, "_blank", "noreferrer")}>Buka review</Button>
      <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => { void navigator.clipboard?.writeText(link); onToast("Link review disalin", "ok", "copy"); }}>Salin</Button>
    </>}>
      <span className="hn-sched-row-text">
        <RowTitle specId={q.specId} ctx={ctx} />
        {/* SPEC-431 · baris yang ditutup gerbang "spec sudah selesai" tak pernah punya sesi;
            "selesai —" akan terbaca seolah scheduler yang menyelesaikannya. */}
        <span className="hn-sched-row-meta">
          {ctx.projectName(q.projectId)} · {labelOf(QUEUE_SOURCE_LABEL, q.source)} · {q.launchedAt ? `selesai ${agoLabel(q.launchedAt)}` : (q.note ?? "tidak diluncurkan")}
        </span>
      </span>
    </DenseRow>
  );
}

// Gagal punya jalan keluar: "Antre ulang" mengembalikan item ke antrean (server: ADR-0204, butuh sessions:spawn).
function FailedRow({ q, ctx, onRequeue, busy }:
  { q: SchedulerQueueItemView; ctx: Ctx; onRequeue: (id: string) => void; busy: boolean }) {
  return (
    <DenseRow actions={<Button size="sm" variant="secondary" leftIcon="rotate-ccw" disabled={busy} onClick={() => onRequeue(q.id)}>Antre ulang</Button>}>
      <span className="hn-sched-row-text">
        <RowTitle specId={q.specId} ctx={ctx} />
        <span className="hn-sched-row-meta">{ctx.projectName(q.projectId)} · {q.note ?? "gagal tanpa alasan tercatat"}</span>
      </span>
    </DenseRow>
  );
}

// SPEC-522 · ADR-0106 · baris tombstone: ia sengaja TIDAK dihapus — `enqueue` (`upsert` ber-`update:{}`)
// karena itu tak bisa menghidupkannya lagi saat checker `backlog` menjumpai spec yang sama.
function CanceledRow({ q, ctx, onRequeue, busy }:
  { q: SchedulerQueueItemView; ctx: Ctx; onRequeue: (id: string) => void; busy: boolean }) {
  return (
    <DenseRow actions={<Button size="sm" variant="ghost" leftIcon="rotate-ccw" disabled={busy} onClick={() => onRequeue(q.id)}>Antre lagi</Button>}>
      <span className="hn-sched-row-text">
        <RowTitle specId={q.specId} ctx={ctx} />
        <span className="hn-sched-row-meta">
          {ctx.projectName(q.projectId)} · {labelOf(QUEUE_SOURCE_LABEL, q.source)} · {q.note ?? "dibatalkan"}
        </span>
      </span>
    </DenseRow>
  );
}

/* SPEC-523 · satu seksi antrean = satu daftar berhalaman yang memuat datanya sendiri (status + halaman).
   Galat muat TAMPIL sebagai galat dengan Coba lagi — bukan sebagai "Antrean kosong", yang berbohong.
   Tanpa `count` > 0 seksi tak memuat apa pun: tab kosong cukup satu baris keterangan. */
function QueueSection({ what, status, count, empty, render }: {
  what: string; status: QueueStatus; count: number; empty: string;
  render: (q: SchedulerQueueItemView) => React.ReactNode;
}) {
  const [items, setItems] = React.useState<SchedulerQueueItemView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // SPEC-740 · ADR-0115 · tiga seksi antrean memakai komponen yang SAMA — kuncinya wajib
  // memuat `status`, kalau tidak ketiganya berbagi satu nomor halaman.
  const [page, setPage] = usePersistedState("scheduler", `queue-${status}-page`, 1, isNum);

  const load = React.useCallback(() => {
    api.getSchedulerQueue({ status, page, limit: QUEUE_PAGE })
      .then((r) => { setItems(r.items); setTotal(r.total); setError(null); setLoaded(true); })
      .catch((e) => { setError(failureMessage(`memuat ${what}`, e)); setLoaded(true); });
  }, [status, page, what]);
  React.useEffect(() => { load(); }, [load]);
  // SPEC-908 · tiap seksi berlangganan (status, halaman)-nya SENDIRI.
  useLiveTopic({
    topic: "schedulerQueue", params: { status, page, limit: QUEUE_PAGE },
    apply: (m) => { setItems(m.data.items); setTotal(m.data.total); setError(null); setLoaded(true); },
    refetch: () => { load(); }, pollMs: POLL_MS,
  });

  if (error) return <InlineError message={error} onRetry={load} />;
  if (count === 0) return <p className="hn-sched-empty">{empty}</p>;
  if (!loaded) return <SkeletonList rows={3} label={`Memuat ${what}…`} />;
  const sp = serverPage(total, page, QUEUE_PAGE);
  return (
    <>
      <RowList label={what}>{items.map((q) => render(q))}</RowList>
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
        onPage={setPage} unit="item" />
    </>
  );
}

// Riwayat: chip status (hanya yang punya isi) + satu seksi antrean untuk status yang dipilih.
// Status awal = yang paling perlu perhatian: Gagal, lalu Selesai, lalu Dibatalkan.
function HistoryPanel({ counts, ctx, busyId, onRowAction, onToast }: {
  counts: Record<HistoryStatus, number>; ctx: Ctx; busyId: string | null;
  onRowAction: (id: string, kind: "cancel" | "requeue") => void | Promise<void>;
  onToast: SchedulerScreenProps["onToast"];
}) {
  const available = HISTORY_STATUSES.filter((s) => (counts[s] ?? 0) > 0);
  const initial: HistoryStatus = (counts.failed ?? 0) > 0 ? "failed" : (counts.done ?? 0) > 0 ? "done" : "canceled";
  const [picked, setPicked] = usePersistedState<HistoryStatus>("scheduler", "riwayatStatus", initial,
    oneOf<HistoryStatus>("done", "failed", "canceled"));
  if (available.length === 0) return <p className="hn-sched-empty">Belum ada riwayat.</p>;
  const active: HistoryStatus = available.includes(picked) ? picked : (available[0] as HistoryStatus);
  const requeue = (id: string) => void onRowAction(id, "requeue");
  const render = (q: SchedulerQueueItemView) => {
    const busy = busyId === q.id;
    if (active === "done") return <DoneRow key={q.id} q={q} ctx={ctx} onToast={onToast} />;
    if (active === "failed") return <FailedRow key={q.id} q={q} ctx={ctx} onRequeue={requeue} busy={busy} />;
    return <CanceledRow key={q.id} q={q} ctx={ctx} onRequeue={requeue} busy={busy} />;
  };
  return (
    <>
      <div role="group" aria-label="Filter riwayat" className="hn-sched-chips">
        {available.map((s) => (
          <button key={s} type="button" className="hn-sched-chip hn-touch-target" aria-pressed={s === active}
            onClick={() => setPicked(s)}>
            {HISTORY_LABEL[s]}
            <span className="hn-sched-chip-count">{counts[s]}</span>
          </button>
        ))}
      </div>
      <QueueSection key={active} what={`item ${HISTORY_LABEL[active].toLowerCase()}`} status={active}
        count={counts[active] ?? 0} empty="Belum ada riwayat." render={render} />
    </>
  );
}

// ---------------------------------------------------------------- strip status

/* Strip satu baris: state, kapasitas, limit ringkas, dan kendali. Jeda/Lanjutkan memakai tombol biasa;
   Hentikan rem darurat (danger, dipisah garis) dan MINTA KONFIRMASI lewat `onAsk`. */
function StatusStrip({ cfg, cap, liveCount, onWrite, onAsk, busy }:
  { cfg: Scheduler; cap: number; liveCount: number;
    onWrite: (next: Scheduler, msg: string) => void;
    onAsk: (next: Scheduler, kind: "jeda" | "hentikan") => void; busy: boolean }) {
  const state = !cfg.enabled
    ? { status: "stopped", label: "Berhenti" }
    : cfg.paused ? { status: "paused", label: "Dijeda" } : { status: "running", label: "Berjalan" };
  const full = liveCount >= cap;
  return (
    <section aria-label="Status scheduler" className="hn-sched-strip">
      <StatusPill status={state.status} variant="dot">{state.label}</StatusPill>
      <div className="hn-sched-capacity">
        <ProgressBar value={liveCount} max={Math.max(cap, 1)} size="sm" tone={full ? "warn" : "brass"}
          label={`${liveCount} dari ${cap} sesi`} />
      </div>
      <div className="hn-sched-limits">
        <LimitBadge />
        <CodexLimitBadge />
      </div>
      <LiveConnectionBadge />
      <div className="hn-sched-strip-actions">
        {cfg.enabled
          ? (cfg.paused
            ? <Button size="sm" leftIcon="play" disabled={busy}
                onClick={() => onWrite({ ...cfg, paused: false }, "Scheduler dilanjutkan")}>Lanjutkan</Button>
            : <Button size="sm" variant="secondary" leftIcon="pause" disabled={busy}
                onClick={() => onAsk({ ...cfg, paused: true }, "jeda")}>Jeda</Button>)
          : <Button size="sm" leftIcon="play" disabled={busy}
              onClick={() => onWrite({ ...cfg, enabled: true }, "Scheduler diaktifkan")}>Aktifkan</Button>}
        {cfg.enabled && (
          <>
            <span className="hn-sched-strip-divider" aria-hidden="true" />
            <Button size="sm" variant="danger" leftIcon="square" disabled={busy}
              onClick={() => onAsk({ ...cfg, enabled: false }, "hentikan")}>Hentikan</Button>
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- setelan

// Pemeriksaan sebelum peluncuran (launchGuard, ADR-0161/0170) — status saat ini, bahasa biasa.
function AdmissionLine({ status }: { status: LaunchStatus }) {
  return (
    <div aria-label="Status pemeriksaan peluncuran" className="hn-sched-guard-status">
      <div>Pemeriksaan {status.enabled ? "aktif" : "nonaktif"} · {status.liveCount} dari batas {status.maxConcurrent} sesi berjalan ({status.liveAgentCount} di antaranya agen)</div>
      <div>Beban CPU per inti: {status.loadStatus === "available" && status.loadPerCore !== null
        ? status.loadPerCore.toFixed(2) : "tidak tersedia"}
        {status.loadStatus === "unsupported" ? " (tidak didukung platform)" : ""} · batas {status.maxLoadPerCore}</div>
      <div>Memori bebas: {status.memStatus === "available" && status.memAvailablePct !== null
        ? `${status.memAvailablePct.toFixed(0)}%` : "tidak tersedia"} · minimal {status.minMemAvailablePct}%</div>
      <div className="hn-sched-note">
        Berlaku juga saat scheduler berhenti. Terminal dan shell tetap bisa dibuka, dan keduanya ikut dihitung dalam batas sesi.
      </div>
    </div>
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

const sourceFacts = (s: SchedulerSourceView): string =>
  `${s.lastRunAt ? `terakhir ${agoLabel(s.lastRunAt)}` : "belum pernah dicek"} · ${s.nextRunAt ? `berikutnya ${untilLabel(s.nextRunAt)}` : "belum dijadwalkan"}`;

function SettingsPanel({ cfg, sources, admission, onWrite, busy }: {
  cfg: Scheduler; sources: SchedulerSourceView[]; admission: LaunchStatus | undefined;
  onWrite: (next: Scheduler) => void; busy: boolean;
}) {
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
    <div className="hn-sched-panel">
      <section className="hn-sched-group" aria-labelledby="sched-set-sesi">
        <h3 id="sched-set-sesi" className="hn-sched-group-title">Sesi</h3>
        <div className="hn-sched-grid">
          <Field label="Batas sesi bersamaan" hint="Termasuk terminal dan shell yang kamu buka sendiri.">
            <Input type="number" min={1} value={draft.maxConcurrent} aria-label="Batas sesi bersamaan" placeholder="mis. 6"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, maxConcurrent: e.target.value }))}
              onBlur={blur} onKeyDown={enterCommits} />
          </Field>
          <Field label="Saat ada keputusan yang belum jelas" hint="Keputusan yang ambigu tetap ditanyakan ke lead atau kamu.">
            <Select value={draft.autonomy} aria-label="Mode otonomi"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, autonomy: e.target.value as Scheduler["autonomy"] }))}
              options={AUTONOMY_OPTIONS} />
          </Field>
        </div>
      </section>

      <section className="hn-sched-group" aria-labelledby="sched-set-peluncuran">
        <h3 id="sched-set-peluncuran" className="hn-sched-group-title">Peluncuran</h3>
        <Switch label="Tahan peluncuran saat server sibuk" checked={draft.guardOn}
          onChange={(on: boolean) => setDraft((d) => ({ ...d, guardOn: on }))} />
        <p className="hn-sched-group-hint">
          Mencegah sesi baru diluncurkan saat batas sesi penuh, beban CPU per inti terlalu tinggi, atau memori
          bebas terlalu sedikit. Berlaku juga untuk peluncuran manual. Mematikannya melewati ketiga pemeriksaan
          itu. Terpisah dari saklar scheduler dan sumber.
        </p>
        <div className="hn-sched-grid">
          <Field label="Batas beban CPU per inti" hint="Di atas angka ini, sesi baru tidak diluncurkan.">
            <Input type="number" min={0.1} step="any" value={draft.maxLoad} aria-label="Batas beban CPU per inti" placeholder="mis. 2.5"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, maxLoad: e.target.value }))}
              onBlur={blur} onKeyDown={enterCommits} />
          </Field>
          <Field label="Memori bebas minimal (%)" hint="Di bawah angka ini, sesi baru tidak diluncurkan.">
            <Input type="number" min={0} max={100} step="any" value={draft.minMem} aria-label="Memori bebas minimal (%)" placeholder="mis. 15"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, minMem: e.target.value }))}
              onBlur={blur} onKeyDown={enterCommits} />
          </Field>
        </div>
        {admission && <AdmissionLine status={admission} />}
      </section>

      <section className="hn-sched-group" aria-labelledby="sched-set-sumber">
        <h3 id="sched-set-sumber" className="hn-sched-group-title">Sumber otomatis</h3>
        {(["backlog", "triase"] as const).map((k) => {
          const src = sources.find((s) => s.id === k);
          return (
            <div key={k} className="hn-sched-source">
              <Switch label={QUEUE_SOURCE_LABEL[k]} checked={draft.sources[k].enabled} onChange={(next: boolean) => setSrc(k, { enabled: next })} />
              <span className="hn-sched-spacer" />
              <label className="hn-sched-inline-field">
                cek tiap
                <Input type="number" min={1} aria-label={`Interval cek ${QUEUE_SOURCE_LABEL[k]}`}
                  placeholder="mis. 30" value={draft.sources[k].everyMin}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSrc(k, { everyMin: e.target.value })}
                  onBlur={blur} onKeyDown={enterCommits} />
                menit
              </label>
              {src && <span className="hn-sched-source-facts">{sourceFacts(src)}</span>}
            </div>
          );
        })}
      </section>

      <div className="hn-sched-savebar">
        {dirty && <span role="status" className="hn-sched-note">Ada perubahan yang belum disimpan.</span>}
        <Button leftIcon="save" disabled={busy} onClick={commit}>Simpan setelan</Button>
      </div>
    </div>
  );
}

// Izin per project (dulu "opt-in"): hanya project yang diizinkan yang disentuh scheduler.
function OptInPanel({ projects, onToggle, busyId }:
  { projects: ProjectVM[]; onToggle: (id: string, next: boolean) => void; busyId: string | null }) {
  return (
    <section className="hn-sched-group" aria-labelledby="sched-set-project">
      <h3 id="sched-set-project" className="hn-sched-group-title">Project yang diizinkan</h3>
      <p className="hn-sched-group-hint">Scheduler hanya menyentuh project yang diizinkan. Default: tidak diizinkan.</p>
      {projects.length === 0
        ? <p className="hn-sched-empty">Belum ada project.</p>
        : (
          <RowList label="Project yang diizinkan">
            {projects.map((p) => (
              <DenseRow key={p.id} actions={p.schedulerOptIn
                ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busyId === p.id} onClick={() => onToggle(p.id, false)}>Cabut izin</Button>
                : <Button size="sm" leftIcon="check" disabled={busyId === p.id} onClick={() => onToggle(p.id, true)}>Izinkan</Button>}>
                <span className="hn-sched-row-text">
                  <span className="hn-sched-row-head">
                    <span className="hn-sched-row-title">{p.name}</span>
                    <Badge tone={p.schedulerOptIn ? "ok" : "neutral"} size="sm">{p.schedulerOptIn ? "diizinkan" : "tidak diizinkan"}</Badge>
                  </span>
                </span>
              </DenseRow>
            ))}
          </RowList>
        )}
    </section>
  );
}

/* Orkestrasi per flow: dibaca dari `GET /settings` dan ditulis dengan pola Settings (rebase ke DB terbaru
   sebelum PUT, supaya snapshot tab ini tak membalik perubahan lain). Setiap perubahan tersimpan langsung. */
function useSettingsSnapshot(onToast: SchedulerScreenProps["onToast"]) {
  const [setting, setSetting] = React.useState<Setting | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    api.getSettings()
      .then((s) => { setSetting(s); setError(null); })
      .catch((e: unknown) => setError(failureMessage("memuat orkestrasi", e)));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const writeOrchestration = React.useCallback(async (next: Orchestration, msg: string) => {
    if (!setting) return;
    const base = setting;
    setSetting({ ...base, orchestration: next });
    try {
      const fresh = await api.getSettings().catch(() => undefined);
      await api.putSettings(rebaseEdits(base, { ...base, orchestration: next }, fresh));
      onToast(msg, "ok", "check-circle-2");
    } catch (e) {
      setSetting(base);
      onToast(failureMessage("menyimpan orkestrasi", e), "err", "alert-triangle");
    }
  }, [setting, onToast]);
  return { setting, error, load, writeOrchestration };
}

function OrchestrationSection({ snap }: { snap: ReturnType<typeof useSettingsSnapshot> }) {
  return (
    <section className="hn-sched-group" aria-labelledby="sched-set-orkestrasi">
      <h3 id="sched-set-orkestrasi" className="hn-sched-group-title">Orkestrasi subagen per fase</h3>
      <p className="hn-sched-group-hint">Perubahan tersimpan saat diubah. Buka satu flow untuk mengatur model dan effort per fase.</p>
      {snap.error
        ? <InlineError message={snap.error} onRetry={snap.load} />
        : !snap.setting
          ? <SkeletonList rows={2} label="Memuat orkestrasi…" />
          : <OrchestrationPanel variant="accordion" orchestration={snap.setting.orchestration}
              onChange={(next, msg) => void snap.writeOrchestration(next, msg)} />}
    </section>
  );
}

// ---------------------------------------------------------------- layar

export function SchedulerScreen({ projects, backlog, onProjectChanged, onToast, onGotoTerminal }: SchedulerScreenProps) {
  const { confirm, dialog } = useConfirm();
  const [state, setState] = React.useState<SchedulerStateView | null>(null);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [tab, setTab] = usePersistedState<MainTab>("scheduler", "tab", "antre", oneOf<MainTab>(...MAIN_TABS));
  const snap = useSettingsSnapshot(onToast);
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

  if (phase === "loading") return <SkeletonList rows={4} label="Memuat scheduler…" />;
  if (phase === "error" || !state) return <StateBlock kind="error" hint="Gagal memuat state scheduler." action={() => load()} actionLabel="Coba lagi" />;

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "Project lain";
  const ctx: Ctx = { backlog, projectName };
  const counts = state.queueCounts;
  const historyCount = (counts.done ?? 0) + (counts.failed ?? 0) + (counts.canceled ?? 0);
  // Angka tab hanya tampil bila > 0: tab kosong tak menambah kebisingan.
  const tabs = [
    { value: "antre", label: "Antre", count: counts.queued || undefined },
    { value: "berjalan", label: "Berjalan", count: state.sessions.length || undefined },
    { value: "riwayat", label: "Riwayat", count: historyCount || undefined },
    { value: "cron", label: "Cron" },
    { value: "setelan", label: "Setelan" },
  ];

  return (
    <div className="hn-sched">
      <StatusStrip cfg={state.config} cap={state.cap} liveCount={state.liveCount} onWrite={writeConfig} onAsk={askControl} busy={busy} />

      <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v as MainTab)}>
        <TabPanel value="antre" className="hn-sched-panel">
          <QueueSection what="antrean" status="queued" count={counts.queued} empty="Antrean kosong."
            render={(q) => <QueuedRow key={q.id} q={q} ctx={ctx} busy={busyId === q.id}
              onCancel={(id) => void rowAction(id, "cancel")} />} />
        </TabPanel>

        <TabPanel value="berjalan" className="hn-sched-panel">
          {state.sessions.length === 0
            ? <p className="hn-sched-empty">Tidak ada sesi dari scheduler yang sedang berjalan.</p>
            : (
              <RowList label="Sesi berjalan">
                {state.sessions.map((s) => <SessionRow key={s.id} s={s} ctx={ctx} onGotoTerminal={onGotoTerminal} />)}
              </RowList>
            )}
        </TabPanel>

        <TabPanel value="riwayat" className="hn-sched-panel">
          {tab === "riwayat" && <HistoryPanel counts={counts as Record<HistoryStatus, number>} ctx={ctx}
            busyId={busyId} onRowAction={rowAction} onToast={onToast} />}
        </TabPanel>

        <TabPanel value="cron" className="hn-sched-panel">
          {/* SPEC-646 · cron dimuat saat tabnya dibuka; zona waktu dari server (ADR-0204). */}
          {tab === "cron" && <SchedulerCrons projects={projects} onProjectChanged={onProjectChanged} onToast={onToast}
            timeZone={state.serverTimeZone} />}
        </TabPanel>

        <TabPanel value="setelan" className="hn-sched-panel">
          <SettingsPanel cfg={state.config} sources={state.sources} admission={state.admission}
            onWrite={(next) => void writeConfig(next)} busy={busy} />
          <OptInPanel projects={projects} onToggle={toggleOptIn} busyId={busyId} />
          <OrchestrationSection snap={snap} />
        </TabPanel>
      </Tabs>
      {dialog}
    </div>
  );
}
