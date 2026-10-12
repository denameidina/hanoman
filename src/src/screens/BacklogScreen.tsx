/* BacklogScreen — item backlog di sepanjang siklus brainstorm → execute.

   Redesign Audit UI/UX 2026-10 · Fase 3D:
   - Tampilan utama = DAFTAR (RowList) ber-segmen tahap. Papan (kolom = tahap, drag-drop) tetap ada
     sebagai tampilan sekunder dengan hint terlihat; tombol di kartu adalah jalur keyboard yang sama.
   - Tiap baris/kartu: judul + tahap + titik prioritas + SATU aksi primer sadar-tahap; sisanya ⋯.
   - Metadata (project, penulis, tanggal, branch) pindah ke detail. Detail berurutan: Ringkasan →
     Jalankan → Review/Dokumen/Lampiran → Lanjutan (terlipat) → Zona berbahaya.
   - Segmen tahap dikelompokkan di klien (server hanya menyaring satu nilai `stage` persis). Karena
     itu daftar mengambil himpunan terfilter penuh lalu dipaginasi di klien — kontrak API tak berubah.
   - Ported; spec.project → spec.projectId; window → ds imports. */
import React from "react";
import {
  Badge, Button, Icon, OverflowActions, Tabs, Select, Checkbox, Input, Field, HnTextarea, Modal,
  StateBlock, Pager, serverPage, SkeletonList, StatusPill, FilterBar, RowList, DenseRow, Stack,
  useConfirm, useToast, ToastHost, type OverflowItem, type FilterChip,
} from "../ds";
import { api, ApiError, type SourceResetPending } from "../api/client";
import { failureMessage } from "../lib/report-error";
import { PRIORITY_LABEL, REVIEW_SCOPE_LABEL, WORKTREE_SCOPE_LABEL } from "../lib/labels";
import { mergeSlim } from "../lib/specs-digest";
import {
  WORKTREE_SCOPE_OPTS, scopeByWorktree, type WorktreeScope,
  REVIEW_SCOPE_OPTS, scopeByReview, type ReviewScope,
} from "./backlog-worktree";
import { SpecDocsModal } from "./SpecDocsModal";
import { SpecAttachmentsPanel, type AttachmentToast } from "./SpecAttachments";
import { IntegrateDialog } from "./IntegrateDialog";
import { SyncButton } from "./SyncButton";
import { branchOptions } from "./branch";
import {
  SOURCE_META, sourceMeta, SHAPE_FIELDS, PRIO_OPTS, SEV_OPTS,
} from "./source-meta";
import { ChangeSourceDialog } from "./ChangeSourceDialog";
import { MarkDoneDialog, type MarkDoneResult } from "./MarkDoneDialog";
import {
  usePersistedState, useScrollRestore, useResetOnChange, oneOf, isStr, isNum, nullableStr,
} from "../ui-state";
import type { Spec, SpecListItem, SpecSlim } from "./types";
import type { ProjectVM } from "./types";
import type { AuditEscalation } from "@hanoman/shared";
import { AUTO_MERGE_OFF, autoMergeSummary, resolveAutoMerge, payloadShapeFor, type AutoMerge } from "@hanoman/shared";
import { PresenceChip } from "./PresenceChip";
import "./styles/backlog.css";

// Kosakata stage frontend (key → label). Di-reuse oleh BacklogPicker di TerminalScreen (SPEC-179).
export const B_STAGES = [
  { key: "brainstorming", label: "Brainstorm" }, { key: "objective", label: "Objective" },
  { key: "spec-ready", label: "Spec" }, { key: "planned", label: "Plan" },
  { key: "executing", label: "Execute" }, { key: "done", label: "Done" },
];
const bStageIndex = (k: string) => B_STAGES.findIndex((s) => s.key === k);
// Keterangan tiap tahap untuk tooltip & pembaca layar: istilah Objective/Spec/Plan dijelaskan di sini.
const STAGE_HINT: Record<string, string> = {
  brainstorming: "Brainstorm: ide digali bersama agen sebelum tujuan dikunci",
  objective: "Objective: tujuan terukur dikunci sebelum spec ditulis",
  "spec-ready": "Spec: dokumen spesifikasi ditulis",
  planned: "Plan: rencana langkah disusun",
  executing: "Execute: kode dikerjakan di worktree sesi",
  done: "Done: item selesai",
};

// Segmen tahap di baris filter. Enam tahap lifecycle dikelompokkan jadi empat segmen. "Review" BUKAN
// segmen: model data tak punya tahap review (`Spec.stage` berhenti di `done`); tinjauan adalah aksi
// "Review perubahan" pada item, bukan posisinya di siklus.
export type StageGroup = "all" | "brainstorm" | "spec" | "doing" | "done";
export const STAGE_GROUPS: readonly { key: StageGroup; label: string; stages: readonly string[] }[] = [
  { key: "all", label: "Semua", stages: B_STAGES.map((s) => s.key) },
  { key: "brainstorm", label: "Brainstorm", stages: ["brainstorming", "objective"] },
  { key: "spec", label: "Spec", stages: ["spec-ready", "planned"] },
  { key: "doing", label: "Dikerjakan", stages: ["executing"] },
  { key: "done", label: "Selesai", stages: ["done"] },
];
export const inStageGroup = (stage: string, group: StageGroup): boolean =>
  group === "all" || (STAGE_GROUPS.find((g) => g.key === group)?.stages.includes(stage) ?? false);
// Nama segmen dipakai juga sebagai label pil tahap di baris, supaya kosakatanya sama dengan segmen.
const groupLabelOf = (stage: string): string =>
  STAGE_GROUPS.find((g) => g.key !== "all" && g.stages.includes(stage))?.label ?? stage;
const STAGE_STATUS: Record<string, "idle" | "queued" | "running" | "done"> = {
  brainstorming: "idle", objective: "idle", "spec-ready": "queued", planned: "queued", executing: "running", done: "done",
};

// Satu kata kerja untuk memulai/melanjutkan sesi agen. Dipakai baris DAN kartu DAN detail.
const startLabel = (stage: string) => (stage === "brainstorming" ? "Mulai" : "Lanjutkan");
// Satu sumber label prioritas untuk papan, daftar, dan detail. Warnanya aksen (brass), BUKAN
// `err`: `err` dipesan untuk gagal/terblokir, dan sumber QA sudah memakainya.
const B_PRIO: Record<string, { tone: "brass" | "neutral"; label: string; level: "high" | "mid" | "low" }> = {
  tinggi: { tone: "brass", label: PRIORITY_LABEL.tinggi, level: "high" },
  sedang: { tone: "neutral", label: PRIORITY_LABEL.sedang, level: "mid" },
  rendah: { tone: "neutral", label: PRIORITY_LABEL.rendah, level: "low" },
};
const prioMeta = (priority: string) => B_PRIO[priority] ?? B_PRIO.sedang!;
// Opsi sumber di popover Filter. Label sama dengan tab lama supaya kosakatanya tak bergeser.
const SOURCE_FILTER_OPTS = [
  { value: "all", label: "Semua sumber" }, { value: "brief", label: "Dari brief" },
  { value: "qa", label: "Dari QA" }, { value: "audit", label: "Audit" }, { value: "goal", label: "Goal" },
  { value: "help", label: "Help Center" }, { value: "no_effort", label: "Tanpa effort" },
];
const PRIO_FILTER_OPTS = [
  { value: "all", label: "Semua prioritas" }, { value: "tinggi", label: "Tinggi" },
  { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" },
];
// Keterangan sumber dengan istilah teknis. Sumber tanpa entri tak menampilkan apa pun.
const TAB_HINT: Record<string, string> = {
  audit: "Audit: hasil pemeriksaan project. Dari sini bisa dinaikkan jadi Finding QA, feature brief, atau PRD.",
  goal: "Goal: item dengan tujuan terukur. Dikerjakan dua fase (Goal lalu Verifikasi) tanpa tahap perencanaan.",
  no_effort: "Tanpa effort: tugas remeh yang dikerjakan satu fase, tanpa perencanaan maupun verifikasi.",
};
// SPEC-546 · ADR-0109 · katalog source (lencana, opsi, daftar field per bentuk) pindah ke
// `source-meta.ts` supaya dialog "Ubah type" memakai katalog yang SAMA — dua katalog pasti
// berselisih. Re-export menjaga pemakai lama (TerminalScreen, test) tetap tersambung.
export { SOURCE_META, sourceMeta };

// SPEC-447 · ADR-0093 · alasan sebuah item tertahan. Label hidup di UI (server mengirim slug),
// pola yang sama dengan B_PRIO/SOURCE_META.
export const blockLabel = (reason: string): string =>
  reason === "missing" ? "tak ditemukan" : reason === "unmerged" ? "belum ter-merge" : "belum selesai";

function BlockedBadge({ spec }: { spec: SpecListItem }) {
  const bl = spec.blockedBy ?? [];
  if (!bl.length) return null;
  return (
    <Badge tone="warn" size="sm" icon="lock"
      title={bl.map((b) => `${b.id} — ${blockLabel(b.reason)}`).join(" · ")}>Terblokir</Badge>
  );
}

// Titik prioritas: bentuk (penuh / berisi / berlubang) + teks tersembunyi, jadi maknanya tetap
// terbaca tanpa warna. Label lengkapnya ada di detail.
function PrioDot({ priority }: { priority: string }) {
  const p = prioMeta(priority);
  return (
    <span className={`hn-bl-prio hn-bl-prio-${p.level}`} title={`Prioritas ${p.label}`}>
      <span className="hn-sr-only">Prioritas {p.label}</span>
    </span>
  );
}

// Asal item (brief/QA/audit/…) sebagai teks meta, bukan lencana: menentukan jalur lanjutnya, dan
// tak dihitung ke batas dua lencana per baris.
function SourceTag({ source }: { source: string }) {
  const m = sourceMeta(source);
  return (
    <span className="hn-bl-source">
      <Icon name={m.icon} size={12} color={m.color} />
      {m.label}
    </span>
  );
}

function StagePill({ stage }: { stage: string }) {
  return (
    <StatusPill status={STAGE_STATUS[stage] ?? "idle"} size="sm" variant="dot" className="hn-bl-stage-pill"
      title={STAGE_HINT[stage]}>{groupLabelOf(stage)}</StatusPill>
  );
}

// Progres tahap penuh untuk detail. role="progressbar": tahap aktif sebagai nilai (0 = Brainstorm …
// 5 = Done); nama aksesibel tetap "Status <tahap>" (dipakai test & layar).
function StageBar({ stage }: { stage: string }) {
  const idx = bStageIndex(stage);
  const label = B_STAGES[idx]?.label ?? stage;
  return (
    <div role="progressbar" aria-label={`Status ${label}`} aria-valuemin={0}
      aria-valuemax={B_STAGES.length - 1} aria-valuenow={Math.max(idx, 0)} aria-valuetext={label}
      className="hn-bl-stagebar">
      {B_STAGES.map((s, i) => {
        const done = i < idx || stage === "done";
        const active = i === idx && stage !== "done";
        const state = done ? "done" : active ? "active" : "todo";
        return (
          <span key={s.key} className="hn-bl-stage" data-state={state} title={STAGE_HINT[s.key]}>
            <span className="hn-bl-stage-dot" aria-hidden="true" />
            {active && <span className="hn-bl-stage-label">{s.label}</span>}
          </span>
        );
      })}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="hn-bl-field">
      <div className="hn-eyebrow">{label}</div>
      <div className="hn-bl-field-value">{value || "—"}</div>
    </div>
  );
}

// SPEC-340 · ADR-0076 · label & penekanan tombol menurut rekomendasi audit.
const ESC_LABEL: Record<string, string> = {
  qa: "Finding QA — ada yang perlu diperbaiki.",
  brief: "Feature brief — kebutuhan yang bentuknya sudah jelas.",
  prd: "PRD — kebutuhan produk yang perlu didefinisikan dulu.",
};
// Target rekomendasi menonjol; sisanya tetap tersedia (manusia terakhir yang memutuskan).
const escVariant = (e: AuditEscalation | null, target: string): "primary" | "secondary" =>
  e && e.target === target ? "primary" : "secondary";
// Source yang berujung dokumen audit — berhak atas ketiga pintu eskalasi.
const isAuditSource = (source: string) => source === "audit";

// SPEC-1267 · `payload`/`sourceHistory` tak ikut daftar maupun frame siar; `undefined` = detail penuh
// belum dimuat (`null` = memang tak punya payload).
type DetailSpec = SpecListItem & { payload?: Spec["payload"]; sourceHistory?: Spec["sourceHistory"] };

// Aksi yang dibawa daftar & papan. Satu tempat supaya baris, kartu, dan detail membaca kontrak yang sama.
type ItemActions = {
  onStart?: (s: SpecSlim) => void; onDelete?: (s: SpecSlim) => void; onOpenRun?: (s: SpecSlim) => void;
  onOpenReview?: (s: SpecSlim) => void;
  onMarkDone?: (s: SpecSlim, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
  onMarkReviewed?: (s: SpecSlim, reviewed: boolean) => Promise<void>;   // ADR-0218
  running?: boolean;
};

function SpecDetail({ spec, onClose, onEditBranch, onRevertStage, onMarkDone, onOpenReview, onStart, onIntegrate, onEditSpec, onPromoteToQa, onPromoteToBrief, onPromoteToPrd, onEditDeps, onEditAutoMerge, onChangeSource, onRequestDelete, onUndoable, projectPolicy, allSpecs, onAttachmentToast, running, onOpenRun, projectName, presenceOn }:
  {
    spec: DetailSpec | null; onClose: () => void; onEditBranch?: (s: SpecSlim, b: string | null) => void;
    onRevertStage?: (s: SpecSlim, target: string, confirmDelete?: boolean) => Promise<any>;
    // SPEC-804 · ADR-0120 · maju ke `done` tanpa sesi. Bersebelahan dengan revert: satu blok,
    // dua arah.
    onMarkDone?: (s: SpecSlim, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    onOpenReview?: (s: SpecSlim) => void;
    onStart?: (s: SpecSlim) => void;
    onIntegrate?: (s: SpecSlim, op: "merge" | "rebase", target: string) => void;
    onEditSpec?: (s: SpecSlim, patch: { title?: string; priority?: string; payload?: unknown }) => void;
    // SPEC-237 · naikkan audit → Finding QA. SPEC-340 · ADR-0076 · dua pintu lagi (brief & PRD);
    // argumen kedua = rekomendasi terbaca (null bila dokumen audit belum punya blok escalation).
    onPromoteToQa?: (s: SpecListItem, e: AuditEscalation | null) => void;
    onPromoteToBrief?: (s: SpecListItem, e: AuditEscalation | null) => void;
    onPromoteToPrd?: (s: SpecListItem, e: AuditEscalation | null) => void;
    // SPEC-447 · ADR-0093 · dependency bisa diperbaiki kapan saja (termasuk sesudah item dimulai):
    // gerbangnya soal peluncuran BERIKUTNYA, bukan konten yang sedang dikerjakan sesi hidup.
    onEditDeps?: (s: SpecSlim, ids: string[]) => void;
    // SPEC-486 · ADR-0103 · override kebijakan auto-merge item ini (null = kembali ikut project).
    onEditAutoMerge?: (s: SpecSlim, v: AutoMerge | null) => void;
    // SPEC-546 · ADR-0109 · ubah type/source item in-place. ADR-0149 · mengembalikan rencana reset
    // (atau null) supaya dialog bisa menampilkan daftar apa yang hilang sebelum satu byte terhapus.
    onChangeSource?: (s: SpecListItem, source: string, payload?: unknown, confirmReset?: boolean)
      => Promise<SourceResetPending | null> | void;
    // Hapus = konfirmasi dulu (useConfirm di BacklogScreen). Tombolnya ada di zona berbahaya.
    onRequestDelete?: (s: SpecSlim) => void;
    // Aksi yang bisa dibatalkan: dipanggil dengan pesan dan fungsi urung. Toast dirender BacklogScreen.
    onUndoable?: (message: string, undo: () => void) => void;
    projectPolicy?: unknown;   // Project.autoMerge — untuk label "Ikut project (…)"
    projectName?: string;
    allSpecs?: SpecSlim[];
    // SPEC-843 · ADR-0124 · hasil unggah/hapus lampiran. Bentuknya `AttachmentToast`, bukan
    // `onToast` layar (yang bersignature toast App); panel lampiran tak perlu tahu ikon.
    onAttachmentToast?: AttachmentToast;
    // Sesi hidup untuk item ini: CTA berubah jadi "Buka sesi" (sama dengan kartunya).
    running?: boolean; onOpenRun?: (s: SpecSlim) => void;
    // SPEC-919 · ADR-0147 · penanda LIVE lintas device untuk item ini.
    presenceOn?: string[];
  }) {
  // Hook HARUS mendahului early-return `if (!spec)` — rules-of-hooks.
  const [branches, setBranches] = React.useState<string[]>([]);
  const [remoteOnly, setRemoteOnly] = React.useState<Set<string>>(new Set());   // SPEC-244 · branch origin-only
  const [confirm, setConfirm] = React.useState<{ target: string; files: string[] } | null>(null);
  const [stageTarget, setStageTarget] = React.useState("");
  const [markDone, setMarkDone] = React.useState(false);
  const [stageBusy, setStageBusy] = React.useState(false);
  const stageBusyRef = React.useRef(false);
  const [showIntegrate, setShowIntegrate] = React.useState(false);
  const [showDocs, setShowDocs] = React.useState(false);
  // SPEC-546 · ADR-0109 · dialog "Ubah type".
  const [showSource, setShowSource] = React.useState(false);
  // SPEC-186 · konten hanya boleh diubah selagi item masih di backlog & belum pernah dimulai.
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const editable = spec?.stage === "brainstorming" && spec?.baseSha == null && !!onEditSpec && spec.payload !== undefined;
  const startEdit = () => {
    if (!spec) return;
    const pp = (spec.payload || {}) as Record<string, string>;
    setForm({ title: spec.title, priority: spec.priority, ...pp });
    setEditing(true);
  };
  const setField = (k: string) => (e: React.ChangeEvent<any>) => setForm((s) => ({ ...s, [k]: e.target.value }));
  // SPEC-340 · ADR-0076 · rekomendasi eskalasi = turunan dokumen audit, dimuat saat detail dibuka.
  // Hanya untuk source yang memang berujung dokumen audit; source lain tak menyentuh endpoint.
  const [esc, setEsc] = React.useState<AuditEscalation | null>(null);
  const escSpecId = spec && isAuditSource(spec.source) ? spec.id : null;
  React.useEffect(() => {
    setEsc(null);
    if (!escSpecId) return;
    let alive = true;
    api.getEscalation?.(escSpecId)
      .then((r) => { if (alive) setEsc(r.escalation); })
      .catch(() => { if (alive) setEsc(null); });
    return () => { alive = false; };
  }, [escSpecId]);
  const saveEdit = () => {
    if (!spec || !onEditSpec) return;
    const patch = spec.source === "qa"
      // SPEC-826 · `?? ""` bukan hiasan: item qa yang lahir sebelum spec ini tak punya field ini
      // di payload, jadi `form.constraints` undefined sampai operator mengetiknya.
      ? { title: form.title, payload: { severity: form.severity, steps: form.steps, expected: form.expected,
          actual: form.actual, env: form.env, constraints: form.constraints ?? "" } }
      // SPEC-407 · bentuk payload terikat source di boundary server (zPatchSpec + superRefine
      // POST); mengirim bentuk brief untuk item goal akan ditolak dan menghapus goal-nya.
      // SPEC-825 · digerbangi BENTUK, bukan nama source — `no_effort` memakai bentuk yang sama.
      : payloadShapeFor(spec.source) === "goal"
      ? { title: form.title, priority: form.priority, payload: { goal: form.goal, done: form.done ?? "", constraints: form.constraints ?? "", priority: form.priority } }
      : { title: form.title, priority: form.priority, payload: { context: form.context, outcome: form.outcome, constraints: form.constraints, priority: form.priority } };
    onEditSpec(spec, patch);
    setEditing(false);
  };
  // Prioritas diubah langsung (tanpa form), dan bisa diurungkan. Hanya selagi item masih boleh diedit.
  const changePriority = (next: string) => {
    if (!spec || !onEditSpec || next === spec.priority) return;
    const prev = spec.priority;
    onEditSpec(spec, { priority: next });
    onUndoable?.(`Prioritas ${spec.id} diubah ke ${prioMeta(next).label}`, () => onEditSpec(spec, { priority: prev }));
  };
  const projectId = spec?.projectId;
  React.useEffect(() => {
    if (!projectId) { setBranches([]); setRemoteOnly(new Set()); return; }
    let alive = true;
    api.listBranches(projectId)
      .then((r) => { if (alive) { const combined = [...new Set([...r.branches, ...r.remotes])].sort();
        setBranches(combined); setRemoteOnly(new Set(r.remotes.filter((b) => !r.branches.includes(b)))); } })
      .catch(() => { if (alive) { setBranches([]); setRemoteOnly(new Set()); } });
    return () => { alive = false; };
  }, [projectId]);
  React.useEffect(() => {
    if (stageTarget) setStageTarget("");
    if (confirm) setConfirm(null);
  }, [spec?.id, spec?.stage]);
  async function runStageChange(change: () => Promise<any>) {
    if (stageBusyRef.current) return undefined;
    stageBusyRef.current = true;
    setStageBusy(true);
    try {
      return await change();
    } finally {
      stageBusyRef.current = false;
      setStageBusy(false);
    }
  }
  // SPEC-167 · revert backward-only. Dry-run mengembalikan { pending } → tampilkan dialog.
  async function saveStage() {
    if (!spec || !onRevertStage || !stageTarget) return;
    const res = await runStageChange(() => onRevertStage(spec, stageTarget));
    if (res && res.pending) setConfirm({ target: stageTarget, files: res.wouldDelete });
    else if (res) setStageTarget("");
  }
  async function confirmRevert() {
    if (!spec || !onRevertStage || !confirm) return;
    const res = await runStageChange(() => onRevertStage(spec, confirm.target, true));
    if (res) {
      setConfirm(null);
      setStageTarget("");
    }
  }
  function closeDetail() {
    if (confirm || stageBusyRef.current) return;
    setEditing(false);
    onClose();
  }
  if (!spec) return null;
  const earlier = B_STAGES.slice(0, bStageIndex(spec.stage));
  const currentStageLabel = B_STAGES.find((s) => s.key === spec.stage)?.label ?? spec.stage;
  const targetStageLabel = B_STAGES.find((s) => s.key === stageTarget)?.label ?? stageTarget;
  const qa = spec.source === "qa";
  const shape = payloadShapeFor(spec.source);   // SPEC-407/825 · goal & no_effort sebentuk
  const p = (spec.payload || {}) as Record<string, string>;
  // SPEC-447 · kandidat dependency = backlog project yang sama, kecuali diri sendiri (server pun
  // menolak keduanya). Diambil dari daftar yang sudah dimuat layar — tanpa fetch tambahan.
  const depPickList = (allSpecs ?? []).filter((c) => c.projectId === spec.projectId && c.id !== spec.id);
  const fields: readonly (readonly [string, string, string])[] = SHAPE_FIELDS[shape]!;
  const src = sourceMeta(spec.source);
  return (
    <Modal open title={spec.title} eyebrow={spec.id}
      icon={src.icon} onClose={closeDetail} width={600}>
      <div className="hn-bl-detail">
        {/* 1 · Ringkasan: keadaan, rincian, dan isi item. */}
        <section className="hn-bl-section" aria-labelledby="bl-sec-ringkasan">
          <h3 id="bl-sec-ringkasan" className="hn-bl-section-title">Ringkasan</h3>
          <div className="hn-bl-summary-meta">
            <StagePill stage={spec.stage} />
            <span className="hn-bl-prio-text">
              <PrioDot priority={spec.priority} />{prioMeta(spec.priority).label}
            </span>
            <BlockedBadge spec={spec} />
            <PresenceChip names={presenceOn} />
          </div>
          <StageBar stage={spec.stage} />
          {editing ? (
            <Field label="Judul"><Input value={form.title ?? ""} onChange={setField("title")}
              placeholder="mis. Jadwal invoice berulang" className="hn-bl-full" /></Field>
          ) : (
            <DetailRow label="Tujuan" value={spec.objective} />
          )}
          {/* Rincian yang dulu memenuhi kartu: project, penulis, tanggal, branch asal. */}
          <dl className="hn-bl-facts">
            <div><dt>Project</dt><dd>{projectName ?? spec.projectId}</dd></div>
            <div><dt>Penulis</dt><dd>{spec.author || "—"}</dd></div>
            <div><dt>Dibuat</dt><dd>{fmtCreated(spec.createdAt) || "—"}</dd></div>
            <div><dt>Branch asal</dt><dd>{spec.branchFrom || "—"}</dd></div>
          </dl>
          {editable && !editing && (
            <div className="hn-bl-inline-row">
              <Select size="sm" aria-label="Prioritas item ini" value={spec.priority}
                onChange={(e) => changePriority(e.target.value)}
                options={PRIO_OPTS} />
              <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}>Edit</Button>
            </div>
          )}
          {editing ? (
            <>
              {!qa && (
                <Field label="Prioritas">
                  <Select value={form.priority ?? "sedang"} onChange={setField("priority")} options={PRIO_OPTS} className="hn-bl-full" />
                </Field>
              )}
              {fields.map(([k, label, ph]) => (
                <Field key={k} label={label}>
                  {k === "severity"
                    ? <Select value={form[k] ?? "major"} onChange={setField(k)} options={SEV_OPTS} className="hn-bl-full" />
                    : <HnTextarea value={form[k] ?? ""} onChange={setField(k)} rows={2} placeholder={ph} />}
                </Field>
              ))}
              <div className="hn-bl-inline-row hn-bl-end">
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Batal</Button>
                <Button size="sm" variant="primary" leftIcon="check" onClick={saveEdit}>Simpan</Button>
              </div>
            </>
          ) : (
            fields.map(([k, label]) => <DetailRow key={k} label={label} value={p[k] ?? ""} />)
          )}
          {/* SPEC-804 · ADR-0120 · jejak penandaan manual. Hanya muncul bila item memang ditandai manusia. */}
          {spec.manualDone && (
            <div className="hn-bl-field" data-testid="manual-done-trail">
              <div className="hn-eyebrow">Ditandai selesai manual</div>
              <div className="hn-bl-field-value hn-bl-muted">
                {spec.manualDone.by} · {new Date(spec.manualDone.at).toLocaleString("id-ID")}
                {spec.manualDone.reason ? <div className="hn-bl-gap-top">{spec.manualDone.reason}</div> : null}
              </div>
            </div>
          )}
        </section>

        {/* 2 · CTA utama: satu aksi, semua tahap. Sesi hidup = "Buka sesi". */}
        <div className="hn-bl-cta">
          {running && onOpenRun && (
            <Button variant="primary" leftIcon="terminal" onClick={() => onOpenRun(spec)}>Buka sesi</Button>
          )}
          {!running && onStart && (
            <Button variant="primary" leftIcon="play" onClick={() => onStart(spec)}>Jalankan</Button>
          )}
          {spec.stage === "done" && (
            <span className="hn-bl-hint">Sesi baru melanjutkan sisa kerja item ini.</span>
          )}
        </div>

        {/* 3 · Review, dokumen, lampiran. */}
        <section className="hn-bl-section" aria-labelledby="bl-sec-review">
          <h3 id="bl-sec-review" className="hn-bl-section-title">Review, dokumen, dan lampiran</h3>
          <div className="hn-bl-inline-row">
            {onOpenReview && (
              <Button size="sm" variant="secondary" leftIcon="git-compare"
                onClick={() => { onOpenReview(spec); onClose(); }}>Review perubahan</Button>
            )}
            <Button size="sm" variant="secondary" leftIcon="file-text" onClick={() => setShowDocs(true)}>Lihat dokumen</Button>
          </div>
          {/* SPEC-237 · audit tetap doc-of-record. SPEC-340 · ADR-0076 · tiga pintu eskalasi:
              target rekomendasi disorot (primary + badge), sisanya secondary — ketiganya selalu
              tersedia karena manusia yang terakhir memutuskan. */}
          {isAuditSource(spec.source) && (onPromoteToQa || onPromoteToBrief || onPromoteToPrd) && (
            <div className="hn-bl-subsection">
              <div className="hn-eyebrow">Tindak lanjut</div>
              {esc && (
                <div className="hn-bl-hint">
                  {esc.target === "none"
                    ? <span>Audit menilai <strong>cukup jawaban</strong> — tak perlu perbaikan.</span>
                    : <span><Badge tone="brass" size="sm">direkomendasikan hanoman</Badge>{" "}{ESC_LABEL[esc.target]}</span>}
                  {esc.reason ? <div className="hn-bl-gap-top">{esc.reason}</div> : null}
                </div>
              )}
              <div className="hn-bl-inline-row">
                {onPromoteToQa && (
                  <Button size="sm" variant={escVariant(esc, "qa")} leftIcon="bug"
                    onClick={() => onPromoteToQa(spec, esc)}>Jadikan Finding QA</Button>
                )}
                {onPromoteToBrief && (
                  <Button size="sm" variant={escVariant(esc, "brief")} leftIcon="lightbulb"
                    onClick={() => onPromoteToBrief(spec, esc)}>Jadikan Feature brief</Button>
                )}
                {onPromoteToPrd && (
                  <Button size="sm" variant={escVariant(esc, "prd")} leftIcon="scroll-text"
                    onClick={() => onPromoteToPrd(spec, esc)}>Jadikan PRD</Button>
                )}
              </div>
            </div>
          )}
          {/* SPEC-843 · ADR-0124 · lampiran boleh ditambah/dihapus KAPAN SAJA, termasuk selagi sesi
              berjalan — server memateralisasi ulang dan fase berikutnya membacanya. */}
          <SpecAttachmentsPanel specId={spec.id} onToast={onAttachmentToast ?? (() => {})} />
        </section>

        {/* 4 · Lanjutan: terlipat, karena tak dibutuhkan setiap kali item dibuka. */}
        <details className="hn-bl-advanced" data-testid="spec-advanced">
          <summary>Lanjutan</summary>
          <div className="hn-bl-advanced-body">
            {/* SPEC-143 · dapat diubah selama item masih di backlog; hanya menentukan basis run berikutnya. */}
            <div className="hn-bl-subsection">
              <div className="hn-eyebrow">Branch worktree</div>
              <Select size="sm" value={spec.branchFrom ?? ""} disabled={!branches.length}
                onChange={(e) => onEditBranch && onEditBranch(spec, e.target.value || null)}
                options={branchOptions(branches, remoteOnly)} />
            </div>
            {/* SPEC-447 · ADR-0093 · siapa yang ditunggu item ini, dan kenapa. */}
            <div className="hn-bl-subsection">
              <div className="hn-eyebrow">Bergantung pada</div>
              {(spec.dependsOn ?? []).length === 0 ? (
                <div className="hn-bl-hint">— berdiri sendiri</div>
              ) : (
                <div className="hn-bl-stack-list">
                  {(spec.dependsOn ?? []).map((depId) => {
                    const b = (spec.blockedBy ?? []).find((x) => x.id === depId);
                    return (
                      <div key={depId} className="hn-bl-dep">
                        <span className="hn-bl-id">{depId}</span>
                        {b
                          ? <Badge tone="warn" size="sm">{blockLabel(b.reason)}</Badge>
                          : <Badge tone="ok" size="sm" icon="check">selesai &amp; ter-merge</Badge>}
                      </div>
                    );
                  })}
                </div>
              )}
              {onEditDeps && depPickList.length > 0 && (
                <div className="hn-bl-checklist">
                  {depPickList.map((c) => {
                    const on = (spec.dependsOn ?? []).includes(c.id);
                    return (
                      <Checkbox key={c.id} aria-label={`Bergantung pada ${c.id}`} checked={on}
                        label={`${c.id} · ${c.title}`}
                        onChange={() => onEditDeps(spec, on
                          ? (spec.dependsOn ?? []).filter((x) => x !== c.id)
                          : [...(spec.dependsOn ?? []), c.id])} />
                    );
                  })}
                </div>
              )}
            </div>
            {/* SPEC-486 · ADR-0103 · override kebijakan auto-merge item ini. Pilihan pertama
                menyebut kebijakan project apa adanya supaya tak pernah ada pertanyaan "lalu ini pakai apa". */}
            {onEditAutoMerge && (
              <div className="hn-bl-subsection">
                <div className="hn-eyebrow">Auto-merge saat selesai</div>
                <Select size="sm" aria-label="Auto-merge item ini"
                  value={spec.autoMerge ? spec.autoMerge.mode : "inherit"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "inherit") return onEditAutoMerge(spec, null);
                    if (v === "off") return onEditAutoMerge(spec, { ...AUTO_MERGE_OFF });
                    onEditAutoMerge(spec, {
                      ...(spec.autoMerge ?? AUTO_MERGE_OFF),
                      mode: v as AutoMerge["mode"],
                      branch: v === "branch" ? (spec.autoMerge?.branch ?? branches[0] ?? null) : null,
                    });
                  }}
                  options={[
                    { value: "inherit", label: `Ikut project (${autoMergeSummary(resolveAutoMerge(projectPolicy, null))})` },
                    { value: "off", label: "Tanpa auto-merge untuk item ini" },
                    { value: "default-branch", label: "Auto-merge ke default branch repo" },
                    { value: "branch", label: "Auto-merge ke branch tujuan…" },
                  ]} />
                {spec.autoMerge?.mode === "branch" && (
                  <div className="hn-bl-gap-top">
                    <Select size="sm" aria-label="Branch tujuan item ini" value={spec.autoMerge.branch ?? ""}
                      onChange={(e) => onEditAutoMerge(spec, { ...spec.autoMerge!, branch: e.target.value || null })}
                      options={[{ value: "", label: "Pilih branch…" },
                        ...branches.map((b) => ({ value: b, label: b }))]} />
                  </div>
                )}
              </div>
            )}
            {/* SPEC-804 · ADR-0120 · satu blok, dua arah: maju ke selesai di sini, mundur di bawah. */}
            {(onRevertStage || onMarkDone) && (
              <div className="hn-bl-subsection">
                <div className="hn-eyebrow">Ubah status</div>
                <div className="hn-bl-status-now">{`Status saat ini: ${currentStageLabel}`}</div>
                {spec.stage !== "done" && onMarkDone && (
                  <div className="hn-bl-gap-bottom">
                    <Button size="sm" variant="secondary" leftIcon="circle-check"
                      onClick={() => setMarkDone(true)}>Tandai selesai</Button>
                  </div>
                )}
                {!onRevertStage ? null : earlier.length > 0 ? (
                  <>
                    <Select size="sm" aria-label="Kembalikan stage" value={stageTarget}
                      onChange={(e) => setStageTarget(e.target.value)} disabled={stageBusy}
                      placeholder="Pilih status lebih awal…"
                      options={earlier.map((s) => ({ value: s.key, label: "← " + s.label }))} />
                    <div className="hn-bl-hint hn-bl-gap-top">
                      Status saat ini dan status berikutnya tidak dapat dipilih. Kemajuan hanya berasal dari fase sesi.
                    </div>
                    {stageTarget && (
                      <div className="hn-bl-callout">
                        <div className="hn-bl-callout-title">{currentStageLabel} → {targetStageLabel}</div>
                        Fase sesi yang sudah berjalan tidak dibatalkan. Dokumen Spec/Plan di atas target
                        mungkin perlu dihapus setelah konfirmasi; kode dan commit tidak disentuh.
                      </div>
                    )}
                    <div className="hn-bl-gap-top">
                      <Button size="sm" variant="secondary" leftIcon="rotate-ccw"
                        disabled={!stageTarget} loading={stageBusy} onClick={saveStage}>Simpan status</Button>
                    </div>
                  </>
                ) : (
                  <div className="hn-bl-hint">
                    {currentStageLabel} adalah status paling awal. Kemajuan hanya berasal dari fase sesi.
                  </div>
                )}
              </div>
            )}
            {/* SPEC-175 · rebase/merge branch hasil done spec ke target pilihan (lokal/origin). */}
            {spec.stage === "done" && onIntegrate && (
              <div className="hn-bl-subsection">
                <div className="hn-eyebrow">Integrasi</div>
                <Button size="sm" variant="secondary" leftIcon="git-merge" onClick={() => setShowIntegrate(true)}>
                  Rebase / Merge
                </Button>
              </div>
            )}
            {/* SPEC-546 · ADR-0109 · ubah type/source in-place. Tak digerbangi `editable`. */}
            {onChangeSource && (
              <div className="hn-bl-subsection">
                <div className="hn-eyebrow">Type</div>
                <Button size="sm" variant="secondary" leftIcon="shuffle" onClick={() => setShowSource(true)}>Ubah type</Button>
              </div>
            )}
            {/* SPEC-546 · ADR-0109 · jejak konversi type. Hanya muncul bila item pernah dikonversi. */}
            {(spec.sourceHistory ?? []).length > 0 && (
              <div className="hn-bl-subsection" data-testid="source-trail">
                <div className="hn-eyebrow">Jejak konversi type</div>
                <div className="hn-bl-stack-list">
                  {(spec.sourceHistory ?? []).map((h, i) => (
                    <div key={`${h.at}-${i}`} className="hn-bl-trail">
                      <span className="hn-bl-id">{h.from} → {h.to}</span>
                      {" · "}{new Date(h.at).toLocaleString("id-ID")}{" · "}{h.by}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>

        {/* 5 · Zona berbahaya: satu-satunya tempat Hapus. Selalu lewat konfirmasi (useConfirm). */}
        {onRequestDelete && (
          <section className="hn-bl-danger" aria-labelledby="bl-sec-bahaya">
            <h3 id="bl-sec-bahaya" className="hn-bl-section-title">Zona berbahaya</h3>
            <div className="hn-bl-hint">Menghapus item tak bisa dibatalkan. Kode dan commit di repo tidak disentuh.</div>
            <div className="hn-bl-gap-top">
              <Button size="sm" variant="danger" leftIcon="trash-2" onClick={() => onRequestDelete(spec)}>Hapus spec</Button>
            </div>
          </section>
        )}
      </div>

      {confirm && (
        <Modal open title="Kembalikan status & hapus dokumen fase" icon="rotate-ccw"
          eyebrow={spec.id + " → " + confirm.target}
          onClose={stageBusy ? undefined : () => setConfirm(null)}>
          <div className="hn-bl-confirm-lead">
            {confirm.files.length} berkas docs akan dihapus dari disk (kode & commit tak disentuh):
          </div>
          <ul className="hn-bl-file-list">
            {confirm.files.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <div className="hn-bl-inline-row hn-bl-end">
            <Button size="sm" variant="secondary" disabled={stageBusy}
              onClick={() => setConfirm(null)}>Batal</Button>
            <Button size="sm" variant="danger" leftIcon="trash-2" loading={stageBusy}
              onClick={confirmRevert}>Hapus & kembalikan</Button>
          </div>
        </Modal>
      )}
      {showIntegrate && onIntegrate && (
        <IntegrateDialog projectId={spec.projectId}
          ownBranch={`hanoman/${spec.id.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`} eyebrow={spec.id}
          onClose={() => setShowIntegrate(false)}
          onIntegrate={(op, target) => { setShowIntegrate(false); onIntegrate(spec, op, target); }} />
      )}
      {markDone && onMarkDone && (
        <MarkDoneDialog spec={spec} onClose={() => setMarkDone(false)} onSubmit={onMarkDone} />
      )}
      {showDocs && <SpecDocsModal specId={spec.id} onClose={() => setShowDocs(false)} />}
      {/* SPEC-546 · ADR-0109 · dialog pilih source tujuan + form field bentuk barunya. */}
      {showSource && onChangeSource && spec.payload !== undefined && (
        // ADR-0149 · dialog yang menutup dirinya sendiri lewat `onClose`: submit PERTAMA pada
        // jalur reset justru harus membuatnya tetap terbuka untuk menampilkan daftar konfirmasi.
        <ChangeSourceDialog spec={spec as Spec} onClose={() => setShowSource(false)}
          onSubmit={(source, payload, confirmReset) =>
            Promise.resolve(onChangeSource(spec, source, payload, confirmReset) ?? null)} />
      )}
    </Modal>
  );
}

/* Aksi per-item. Dipakai baris, kartu, dan papan. Satu aksi primer sadar-tahap (Mulai / Lanjutkan /
   Buka sesi / Review perubahan untuk item selesai); sisanya di menu ⋯. Dialognya hidup DI LUAR menu:
   menu menutup dirinya lebih dulu, lalu aksinya membuka dialog ini. */
function SpecActions({ spec, onStart, onDelete, onOpenRun, onOpenReview, onMarkDone, onMarkReviewed, running }:
  { spec: SpecListItem } & ItemActions) {
  const [docs, setDocs] = React.useState(false);
  const [markDone, setMarkDone] = React.useState(false);
  const open = spec.stage !== "done";
  const primary: { label: string; icon: string; run: () => void } | null = running
    ? (onOpenRun ? { label: "Buka sesi", icon: "terminal", run: () => onOpenRun(spec) } : null)
    : open
      ? (onStart ? { label: startLabel(spec.stage), icon: "play", run: () => onStart(spec) } : null)
      : (onOpenReview ? { label: "Review perubahan", icon: "git-compare", run: () => onOpenReview(spec) } : null);
  const reviewInMenu = Boolean(onOpenReview) && primary?.label !== "Review perubahan";
  const items: OverflowItem[] = [
    ...(reviewInMenu && onOpenReview ? [{ key: "review", label: "Review perubahan", icon: "git-compare", onSelect: () => onOpenReview(spec) }] : []),
    { key: "docs", label: "Lihat dokumen", icon: "file-text", onSelect: () => setDocs(true) },
    ...(!open && onStart ? [{ key: "rerun", label: "Jalankan lagi", icon: "play", onSelect: () => onStart(spec) }] : []),
    // SPEC-804 · ADR-0120 · maju ke `done` tanpa sesi — untuk item yang beres di luar hanoman.
    ...(open && onMarkDone ? [{ key: "done", label: "Tandai selesai", icon: "circle-check", onSelect: () => setMarkDone(true) }] : []),
    // ADR-0218 · penanda "sudah ditinjau" untuk item selesai. Jalan keluar dari "Perlu ditinjau" bagi item
    // yang worktree-nya sudah dihapus: layar Review berkeadaan kosong dan tak punya bar keputusan.
    ...(!open && onMarkReviewed ? [{
      key: "reviewed", label: spec.reviewedAt ? "Batalkan tanda ditinjau" : "Tandai ditinjau",
      icon: spec.reviewedAt ? "rotate-ccw" : "circle-check",
      onSelect: () => void onMarkReviewed(spec, !spec.reviewedAt),
    }] : []),
    ...(onDelete ? [{ key: "delete", label: "Hapus spec", icon: "trash-2", tone: "danger" as const, onSelect: () => onDelete(spec) }] : []),
  ];
  return (
    <div className="hn-bl-actions">
      {primary && (
        <Button size="sm" variant="primary" leftIcon={primary.icon} onClick={primary.run}>{primary.label}</Button>
      )}
      <OverflowActions label={`Aksi lain ${spec.id}`} items={items} />
      {markDone && onMarkDone && (
        <MarkDoneDialog spec={spec} onClose={() => setMarkDone(false)} onSubmit={onMarkDone} />
      )}
      {docs && <SpecDocsModal specId={spec.id} onClose={() => setDocs(false)} />}
    </div>
  );
}

/** Tanggal dibuat spec, ringkas ("20 Sep 2026"); string kosong bila tak terbaca. */
export const fmtCreated = (iso?: string | null): string => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime())
    ? t.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "";
};

function TitleButton({ spec, onOpenDetail, className = "hn-bl-title" }:
  { spec: SpecListItem; onOpenDetail?: (s: SpecSlim) => void; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => onOpenDetail && onOpenDetail(spec)}>
      {spec.title}
    </button>
  );
}

/* ── Daftar (tampilan utama) ─────────────────────────────────────────────────
   Satu baris per item: titik prioritas, judul, lalu id, tahap, dan lencana status. Aksi primer dan
   ⋯ di luar elemen klik (DenseRow), jadi tak ada tombol di dalam tombol. */
type RowProps = ItemActions & {
  spec: SpecListItem; presenceOn?: string[]; onOpenDetail?: (s: SpecSlim) => void; projectName?: string;
};
function SpecRow({ spec, presenceOn, onOpenDetail, projectName, ...actions }: RowProps) {
  return (
    <DenseRow onClick={onOpenDetail ? () => onOpenDetail(spec) : undefined}
      actions={<SpecActions spec={spec} {...actions} />}>
      <PrioDot priority={spec.priority} />
      <span className="hn-bl-row-body">
        <span className="hn-bl-row-title">{spec.title}</span>
        <span className="hn-bl-row-meta">
          <span className="hn-bl-id">{spec.id}</span>
          {projectName && <span className="hn-bl-proj" title={`Project: ${projectName}`}>{projectName}</span>}
          <SourceTag source={spec.source} />
          <StagePill stage={spec.stage} />
          <BlockedBadge spec={spec} />
          {/* SPEC-919 · ADR-0147 · penanda LIVE lintas device. */}
          <PresenceChip names={presenceOn} />
        </span>
      </span>
    </DenseRow>
  );
}

/* ── Papan (tampilan sekunder) ───────────────────────────────────────────────
   Kolom = tahap (+ backlog di depan, success di belakang). Enam kolom tengah dimiliki runner:
   `spec.stage` cuma cermin fase run (SPEC-009), jadi kartu di sana tak bisa diangkat. Yang bisa
   didrag hanya kolom Backlog, dan drop-nya memanggil aksi yang memang ada tombolnya. */
const BACKLOG_COL = "backlog", SUCCESS_COL = "success";
const FIRST_STAGE = B_STAGES[0]!.key;   // brainstorming
const COLUMNS: { key: string; label: string; icon?: string }[] = [
  { key: BACKLOG_COL, label: "Backlog", icon: "inbox" },
  ...B_STAGES.slice(0, 5).map((s) => ({ key: s.key, label: s.label })),
  { key: SUCCESS_COL, label: "Success", icon: "check-circle-2" },
];

/* Kolom sebuah spec. `hasSession` = ada sesi claude yang hidup untuknya (SPEC-162). Spec
   yang belum pernah dikerjakan tapi stage-nya sudah maju tetap tampil di kolom stage-nya —
   bukan diklaim balik ke Backlog. */
export function specColumn(spec: SpecListItem, hasSession?: boolean): string {
  if (spec.stage === "done") return SUCCESS_COL;
  if (!hasSession && spec.stage === "brainstorming") return BACKLOG_COL;
  return spec.stage;
}

/* Satu-satunya aturan drop, dan ia menuruti kontrak kanban: kartu mendarat di kolom
   tempat ia dijatuhkan. Sesi selalu mulai dari awal pipeline, jadi spec yang baru
   dijalankan berakhir di stage `brainstorming` — maka Brainstorm satu-satunya tujuan
   yang jujur. Drop berujung pada POST /terminal/sessions, tak pernah menulis field spec. */
export const canDrop = (from: string, to: string): boolean =>
  from === BACKLOG_COL && to === FIRST_STAGE;

function BoardCard({ spec, col, onOpenDetail, presenceOn, projectName, onDragStart, onDragEnd, dragging, ...actions }:
  ItemActions & {
    spec: SpecListItem; col: string; projectName?: string; onOpenDetail?: (s: SpecSlim) => void; presenceOn?: string[];
    onDragStart: () => void; onDragEnd: () => void; dragging: boolean
  }) {
  const draggable = col === BACKLOG_COL;
  return (
    <div draggable={draggable} className="hn-bl-card" data-dragging={dragging || undefined}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", spec.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      title={draggable ? "Seret ke Brainstorm untuk memulai sesi"
        : "Stage mengikuti fase yang dilaporkan agen — kartu tak bisa dipindah"}
      data-draggable={draggable || undefined}>
      <div className="hn-bl-card-head">
        <PrioDot priority={spec.priority} />
        <span className="hn-bl-id">{spec.id}</span>
        <SourceTag source={spec.source} />
      </div>
      <TitleButton spec={spec} onOpenDetail={onOpenDetail} />
      {projectName && <span className="hn-bl-proj" title={`Project: ${projectName}`}>{projectName}</span>}
      {(spec.blockedBy ?? []).length > 0 || presenceOn?.length ? (
        <div className="hn-bl-card-badges">
          <BlockedBadge spec={spec} />
          <PresenceChip names={presenceOn} />
        </div>
      ) : null}
      {/* HTML5 drag-and-drop mati di keyboard dan di layar sentuh. Tombol ini jalur satu-satunya di sana. */}
      <div className="hn-bl-card-foot">
        <SpecActions spec={spec} {...actions} />
      </div>
    </div>
  );
}

function Board({ specs, activeSpecs, presenceBySpec, onOpenDetail, projectNameOf, ...actions }:
  ItemActions & {
    projectNameOf?: (projectId: string) => string | undefined;
    specs: SpecListItem[]; activeSpecs?: Set<string>; presenceBySpec?: Map<string, string[]>;
    onOpenDetail?: (s: SpecSlim) => void;
  }) {
  const [drag, setDrag] = React.useState<{ spec: SpecListItem; from: string } | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  // SPEC-197 · di-memo: Board re-render tiap drag (setOver), tak perlu bangun ulang Map tiap kali.
  const byCol = React.useMemo(() => {
    const m = new Map<string, SpecListItem[]>(COLUMNS.map((c) => [c.key, []]));
    for (const s of specs) m.get(specColumn(s, activeSpecs?.has(s.id)))?.push(s);
    return m;
  }, [specs, activeSpecs]);

  const drop = (to: string) => {
    if (drag && canDrop(drag.from, to) && actions.onStart) actions.onStart(drag.spec);
    setDrag(null); setOver(null);
  };
  return (
    /* Baris kolom menggulir mendatar; tiap KOLOM menggulir tegak sendiri, jadi judul
       kolom tak pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. */
    <div data-testid="backlog-board" className="hn-board-local-overflow hn-bl-board">
      {COLUMNS.map((c) => {
        const items = byCol.get(c.key)!;
        const active = !!drag && canDrop(drag.from, c.key);
        const hot = active && over === c.key;
        return (
          <div key={c.key} className="hn-bl-col" data-active={active || undefined} data-hot={hot || undefined}
            data-dimmed={drag && !active || undefined}
            onDragOver={(e) => { if (active) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(c.key); } }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c.key); }}>
            <div className="hn-bl-col-head">
              {c.icon && <Icon name={c.icon} size={13} color="var(--text-muted)" />}
              <span className="hn-eyebrow">{c.label}</span>
              <span className="hn-bl-col-count">{items.length}</span>
            </div>
            {/* Zona drop mencakup ruang kosong di bawah kartu: event menggelembung ke kolom. */}
            <div className="hn-bl-col-body">
              {items.map((s) => (
                <BoardCard key={s.id} spec={s} col={c.key} onOpenDetail={onOpenDetail}
                  projectName={projectNameOf?.(s.projectId)}
                  presenceOn={presenceBySpec?.get(s.id)} {...actions}
                  dragging={drag?.spec.id === s.id}
                  running={activeSpecs?.has(s.id)}
                  onDragStart={() => setDrag({ spec: s, from: c.key })}
                  onDragEnd={() => { setDrag(null); setOver(null); }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Dua tampilan: daftar (utama) dan papan (sekunder, ikon saja dengan nama aksesibel).
const VIEWS = [
  { value: "list", label: "Daftar", icon: "list" },
  { value: "board", label: "Papan", icon: "kanban" },
];

function ViewToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="hn-bl-view-toggle" role="group" aria-label="Mode tampilan">
      {VIEWS.map((v) => (
        <button key={v.value} type="button" className="hn-bl-view-btn hn-touch-target"
          aria-pressed={value === v.value} aria-label={v.label} title={v.label}
          onClick={() => onChange(v.value)}>
          <Icon name={v.icon} size={15} />
        </button>
      ))}
    </div>
  );
}

// Ringkasan skeleton saat muat pertama: tiga baris yang tak tampak seperti "kosong".
const LOADING_ROWS = 5;
// Nilai bawaan `reviewSpecIds`: himpunan kosong yang sama identitasnya tiap render (memo stabil).
const NO_REVIEW_SPECS: ReadonlySet<string> = new Set<string>();

export function BacklogScreen({ backlog, projects, pageSize = 20, onStart, activeSpecs, presenceBySpec, reviewSpecIds = NO_REVIEW_SPECS, onDelete, onOpenRun, onOpenReview, onNew, onEditBranch, onRevertStage, onMarkDone, onMarkReviewed, onIntegrate, onEditSpec, onEditDeps, onEditAutoMerge, onChangeSource, onPromoteToQa, onPromoteToBrief, onPromoteToPrd, projectFilter, onProjectFilter, dataVersion, onToast, initialDetailId }:
  {
    backlog: SpecSlim[]; projects: ProjectVM[]; pageSize?: number;
    onStart?: (s: SpecSlim) => void; activeSpecs?: Set<string>; presenceBySpec?: Map<string, string[]>;
    // Gelombang 7 · filter "Perlu ditinjau": id item yang sesinya menunggu jawaban manusia. App menghitungnya
    // dari daftar sesi (`reviewSpecIdsOf`); tanpa prop, filter ini hanya menghasilkan daftar kosong.
    reviewSpecIds?: ReadonlySet<string>;
    onDelete?: (s: SpecSlim) => void | Promise<void>; onOpenRun?: (s: SpecSlim) => void; onOpenReview?: (s: SpecSlim) => void; onNew?: () => void;
    onEditBranch?: (s: SpecSlim, b: string | null) => void;
    onRevertStage?: (s: SpecSlim, target: string, confirmDelete?: boolean) => Promise<any>;
    // SPEC-804 · ADR-0120 · tandai selesai manual; `needConfirm` = server minta konfirmasi karena
    // ada sesi hidup untuk item ini.
    onMarkDone?: (s: SpecSlim, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    // ADR-0218 · tandai/batalkan "sudah ditinjau" pada item selesai. Galat dari App sudah ditangani di sana.
    onMarkReviewed?: (s: SpecSlim, reviewed: boolean) => Promise<void>;
    onIntegrate?: (s: SpecSlim, op: "merge" | "rebase", target: string) => void;
    onEditSpec?: (s: SpecSlim, patch: { title?: string; priority?: string; payload?: unknown }) => void;
    // SPEC-447 · ADR-0093 · ubah dependency item (di luar gerbang edit SPEC-186).
    onEditDeps?: (s: SpecSlim, ids: string[]) => void;
    // SPEC-486 · ADR-0103 · ubah kebijakan auto-merge item (null = kembali ikut project).
    onEditAutoMerge?: (s: SpecSlim, v: AutoMerge | null) => void;
    // SPEC-546 · ADR-0109 · ubah type/source item in-place (id/riwayat/dependency tetap).
    // ADR-0149 · signature harus SAMA dengan yang dipakai `SpecDetail`: tipe 3-argumen tetap
    // lolos tsc (arity lebih sedikit assignable), jadi ia berbohong tanpa satu pun error.
    onChangeSource?: (s: SpecListItem, source: string, payload?: unknown, confirmReset?: boolean)
      => Promise<SourceResetPending | null> | void;
    // SPEC-237 · naikkan audit → Finding QA. SPEC-340 · ADR-0076 · + feature brief & PRD;
    // argumen kedua = rekomendasi hanoman yang terbaca dari dokumen audit (bisa null).
    onPromoteToQa?: (s: SpecListItem, e: AuditEscalation | null) => void;
    onPromoteToBrief?: (s: SpecListItem, e: AuditEscalation | null) => void;
    onPromoteToPrd?: (s: SpecListItem, e: AuditEscalation | null) => void;
    projectFilter: string; onProjectFilter: (id: string) => void; dataVersion?: number;
    onToast?: (msg: string, kind?: string, icon?: string) => void; // SPEC-268 · hasil tombol Sync
    initialDetailId?: string | null;     // SPEC-293 · deep-link #spec= → buka SpecDetail saat mount
  }) {
  // SPEC-740 · ADR-0115 · seluruh state tampilan layar ini persisten berkunci `backlog`.
  const [tab, setTab] = usePersistedState("backlog", "tab", "all", isStr);
  // SPEC-268 · bump untuk re-fetch daftar sesudah tombol Sync menarik data baru.
  const [syncNonce, setSyncNonce] = React.useState(0);
  // Daftar adalah tampilan utama; papan sekunder. Nilai lama (`grid`) jatuh ke daftar.
  const [view, setView] = usePersistedState<string>("backlog", "view", "list", oneOf<string>("list", "board"));
  // Segmen tahap: kunci baru (`stageGroup`) supaya nilai tahap lama di penyimpanan jatuh ke "all".
  const [stage, setStage] = usePersistedState<StageGroup>("backlog", "stageGroup", "all",
    oneOf<StageGroup>("all", "brainstorm", "spec", "doing", "done"));
  // SPEC-178 · search + filter prioritas, semua view-local (tak diangkat ke App).
  const [q, setQ] = usePersistedState("backlog", "q", "", isStr);
  const [prioFilter, setPrioFilter] = usePersistedState("backlog", "prio", "all", isStr);
  // ADR-0214 · "Ber-worktree": item yang pernah dibuatkan worktree (`baseSha`). Disaring di klien.
  const [wt, setWt] = usePersistedState<WorktreeScope>("backlog", "worktree", "all",
    oneOf<WorktreeScope>("all", "worktree"));
  // Gelombang 7 · "Perlu ditinjau": item yang sesinya menunggu jawaban manusia (lihat backlog-worktree.ts).
  const [review, setReview] = usePersistedState<ReviewScope>("backlog", "review", "all",
    oneOf<ReviewScope>("all", "review"));
  // SPEC-408 · ADR-0090 · rentang tanggal. `dateField` memilih sumbunya (dibuat / dikerjakan);
  // `from`/`to` = "YYYY-MM-DD" apa adanya dari <input type="date">, inklusif, boleh sendirian.
  const [dateField, setDateField] = usePersistedState<"created" | "started">(
    "backlog", "dateField", "created", oneOf("created", "started"));
  const [from, setFrom] = usePersistedState("backlog", "from", "", isStr);
  const [to, setTo] = usePersistedState("backlog", "to", "", isStr);
  // Filter project dimiliki App (SPEC-146): detail project membuka layar ini sudah tersaring.
  const proj = projectFilter;
  const setProj = onProjectFilter;
  // keep the id, not the object: backlog re-polls and the stage bar must stay live
  const [detailId, setDetailId] = usePersistedState<string | null>("backlog", "detailId", null, nullableStr);
  // SPEC-293 · deep-link: buka SpecDetail untuk id yang diberikan App (dari hash #spec=).
  React.useEffect(() => { if (initialDetailId) setDetailId(initialDetailId); }, [initialDetailId]);
  const projectNameOf = React.useCallback(
    (id: string) => (projects ?? []).find((p) => p.id === id)?.name, [projects]);
  const projOptions = projects || [...new Set(backlog.map((s) => s.projectId))].map((id) => ({ id, name: id }));
  // Himpunan terfilter penuh dari server (tanpa page/limit). Segmen tahap dikelompokkan di klien,
  // karena server hanya menyaring SATU nilai `stage` persis; paginasi pun dipegang klien.
  const [data, setData] = React.useState<SpecListItem[]>(() => backlog.map((s) => ({ objective: "", ...s })));
  // Yang dipulihkan `page` (bukan `limit`) — SPEC-523 · ADR-0107.
  const [page, setPage] = usePersistedState("backlog", "page", 1, isNum);
  // Di-seed dari `q` yang DIPULIHKAN, bukan dari string kosong (lihat catatan SPEC-178 di git history).
  const [dq, setDq] = React.useState(() => q.trim());
  // SPEC-857 · ADR-0131 · kegagalan refetch tak lagi ditelan: `data` bertahan pada nilai terakhir
  // yang BERHASIL dan layar menandainya sebagai data mungkin usang.
  const [stale, setStale] = React.useState(false);
  // Refetch yang sedang berjalan. Daftar lama TETAP tampil selama menunggu.
  const [refreshing, setRefreshing] = React.useState(false);
  // Muat pertama selesai (skeleton hanya sebelum ini; sesudahnya refetch tak mengosongkan layar).
  const [loaded, setLoaded] = React.useState(false);
  // Refetch ikut tiap `dataVersion` (tiap frame siar WS), jadi toast digerbangi TRANSISI
  // sehat→gagal lewat ref — bukan setiap kegagalan, yang akan jadi hujan toast saat hub sakit.
  const staleRef = React.useRef(false);
  // Toast dengan aksi "Urungkan" untuk perubahan yang reversibel. Hapus TIDAK lewat sini (konfirmasi).
  const [toast, showToast] = useToast();
  const undoable = React.useCallback((message: string, undo: () => void) => {
    showToast(message, "ok", undefined, { action: { label: "Urungkan", onAction: undo } });
  }, [showToast]);
  // Filter yang dipulihkan wajib TERLIHAT menyala: daftar yang tampak kosong tak boleh
  // terbaca sebagai backlog kosong.
  const activeFilters = [
    tab !== "all", proj !== "all", q.trim() !== "", stage !== "all",
    prioFilter !== "all", from !== "", to !== "", wt !== "all", review !== "all",
  ].filter(Boolean).length;
  // Scroll dipulihkan sesudah potongan pertama dari server mendarat — sebelum itu tinggi
  // daftar belum final dan posisinya meleset.
  const listRef = useScrollRestore("backlog", "scroll", data.length > 0);
  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useResetOnChange(
    JSON.stringify([tab, proj, stage, prioFilter, dq, dateField, from, to, wt, review]),
    () => setPage(1));
  React.useEffect(() => {
    let alive = true;
    // sentinel "all" → undefined di call-site; server yang menyaring. Tanpa page/limit = himpunan penuh.
    const p = api.listSpecs?.({
      project: proj === "all" ? undefined : proj,
      source: tab === "all" ? undefined : tab,
      q: dq || undefined,
      priority: prioFilter === "all" ? undefined : prioFilter,
      // Kirim sumbu HANYA saat rentangnya aktif — tanpa itu `dateField` jadi kebisingan di setiap request.
      dateField: from || to ? dateField : undefined,
      from: from || undefined,
      to: to || undefined,
    });
    // `!!p`: klien tanpa `listSpecs` tak pernah menyelesaikan refetch — jangan biarkan indikator menyala.
    setRefreshing(!!p);
    p?.then((r) => {
      if (!alive) return;
      setData(r.items);
      setLoaded(true);
      staleRef.current = false;
      setStale(false);
      setRefreshing(false);
    }).catch(() => {
      if (!alive) return;
      if (!staleRef.current) {
        staleRef.current = true;
        onToast?.("Gagal menyegarkan backlog — data di layar mungkin usang", "warn");
      }
      setStale(true);
      setRefreshing(false);
    });
    return () => { alive = false; };
  }, [tab, proj, prioFilter, dq, dateField, from, to, dataVersion, syncNonce]);
  const backlogById = React.useMemo(() => new Map(backlog.map((s) => [s.id, s])), [backlog]);
  // Frame siar lebih segar daripada daftar HTTP, tapi tak membawa `objective`: yang ringan ditimpa
  // dari siar, sisanya tetap dari HTTP.
  const items = React.useMemo(
    () => data.map((s) => mergeSlim(s, backlogById.get(s.id))),
    [data, backlogById],
  );
  // Himpunan setelah filter worktree dan "Perlu ditinjau" (keduanya AND): angka segmen dan isi daftar
  // memakai himpunan ini.
  const scoped = React.useMemo(
    () => scopeByReview(scopeByWorktree(items, wt), review, reviewSpecIds),
    [items, wt, review, reviewSpecIds]);
  // Hitungan per segmen dari himpunan yang SAMA dengan daftar: satu sumber untuk angka dan isi.
  const counts = React.useMemo(() => {
    const out = {} as Record<StageGroup, number>;
    for (const g of STAGE_GROUPS) out[g.key] = scoped.filter((s) => inStageGroup(s.stage, g.key)).length;
    return out;
  }, [scoped]);
  const visible = React.useMemo(() => scoped.filter((s) => inStageGroup(s.stage, stage)), [scoped, stage]);
  const sp = serverPage(visible.length, page, pageSize);
  const pageItems = visible.slice((sp.page - 1) * pageSize, sp.page * pageSize);
  const [detail, setDetail] = React.useState<Spec | null>(null);
  // Detail penuh dimuat saat item dibuka dan disegarkan tiap `dataVersion` (edit/stage mengubah
  // digest siar); item yang lenyap (404) menutup dialog.
  React.useEffect(() => {
    if (!detailId || !api.getSpec) { setDetail(null); return; }
    let alive = true;
    api.getSpec(detailId).then((d) => { if (alive) setDetail(d); }).catch((e) => {
      if (!alive || !(e instanceof ApiError) || e.status !== 404) return;
      setDetailId(null);
      onToast?.(`${detailId} sudah tidak ada`, "warn");
    });
    return () => { alive = false; };
  }, [detailId, dataVersion]);
  const detailSpec: DetailSpec | null = React.useMemo(() => {
    if (!detailId) return null;
    const slim = backlogById.get(detailId);
    if (detail?.id === detailId) return mergeSlim(detail, slim);
    const listed = data.find((s) => s.id === detailId);
    return listed ? mergeSlim(listed, slim) : slim ? { objective: "", ...slim } : null;
  }, [detailId, detail, data, backlogById]);
  // Hapus spec = konfirmasi dulu: nama & ID objeknya, dampaknya sebagai daftar, label aksi eksplisit.
  // Satu dialog untuk baris, kartu, detail, dan menu; dirender sekali di bawah layar (lihat `{dialog}`).
  const { confirm: confirmDelete, dialog } = useConfirm();
  const requestDelete = onDelete ? (s: SpecSlim) => {
    const projectName = projects.find((x) => x.id === s.projectId)?.name ?? s.projectId;
    confirmDelete({
      title: `Hapus ${s.id}?`,
      message: `"${s.title}" dihapus dari backlog ${projectName}.`,
      impact: [
        "Tindakan ini tidak bisa dibatalkan.",
        "Lampiran item ini ikut dihapus dari disk.",
        "Sesi yang masih berjalan untuk item ini tidak ikut dihentikan.",
        "Item lain yang menunggu item ini tidak lagi bergantung padanya.",
        "Kode dan commit di repo tidak disentuh.",
      ],
      confirmLabel: "Hapus spec", tone: "danger", icon: "trash-2",
      run: async () => {
        await onDelete(s);
        // Detail yang menampilkan item ini ikut tertutup: item-nya sudah tak ada.
        if (detailId === s.id) setDetailId(null);
      },
    }).catch((e: unknown) => onToast?.(failureMessage(`menghapus ${s.id}`, e), "err", "x-circle"));
  } : undefined;
  const resetAll = () => {
    setTab("all"); setProj("all"); setQ(""); setStage("all"); setPrioFilter("all");
    setDateField("created"); setFrom(""); setTo(""); setWt("all"); setReview("all"); setPage(1);
  };
  // Chip untuk filter yang ada di popover. Tahap tak perlu chip: ia sudah segmen yang tampak.
  const chips: FilterChip[] = [
    ...(tab !== "all" ? [{ key: "tab", label: `Sumber: ${SOURCE_FILTER_OPTS.find((o) => o.value === tab)?.label ?? tab}`,
      onRemove: () => setTab("all") }] : []),
    ...(proj !== "all" ? [{ key: "proj", label: `Project: ${projOptions.find((x) => x.id === proj)?.name ?? proj}`,
      onRemove: () => setProj("all") }] : []),
    ...(prioFilter !== "all" ? [{ key: "prio", label: `Prioritas: ${prioMeta(prioFilter).label}`,
      onRemove: () => setPrioFilter("all") }] : []),
    ...(from || to ? [{ key: "date", label: `Tanggal ${dateField === "created" ? "dibuat" : "dikerjakan"}: ${from || "…"} – ${to || "…"}`,
      onRemove: () => { setFrom(""); setTo(""); } }] : []),
    ...(wt !== "all" ? [{ key: "wt", label: WORKTREE_SCOPE_LABEL.worktree, onRemove: () => setWt("all") }] : []),
    ...(review !== "all" ? [{ key: "review", label: REVIEW_SCOPE_LABEL.review, onRemove: () => setReview("all") }] : []),
  ];
  // Isi popover "Filter": sumber, project, prioritas, dan rentang tanggal. Dibuka dari satu tombol.
  const filtersPanel = (
    <Stack gap={3}>
      <Field label="Sumber">
        <Select size="sm" aria-label="Filter sumber" value={tab} onChange={(e) => setTab(e.target.value)} options={SOURCE_FILTER_OPTS} />
      </Field>
      <Field label="Project">
        <Select size="sm" aria-label="Filter project" value={proj} onChange={(e) => setProj(e.target.value)}
          options={[{ value: "all", label: "Semua project" }].concat(projOptions.map((p) => ({ value: p.id, label: p.name })))} />
      </Field>
      <Field label="Prioritas">
        <Select size="sm" aria-label="Filter prioritas" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)} options={PRIO_FILTER_OPTS} />
      </Field>
      {/* ADR-0214 · predikat jujur: hanya "pernah dibuatkan worktree", bukan "belum ditinjau". */}
      <Field label="Worktree" hint="Hanya item yang pernah dibuatkan worktree oleh hanoman. Pekerjaan di luar hanoman tidak terhitung.">
        <Select size="sm" aria-label="Filter worktree" value={wt} onChange={(e) => setWt(e.target.value as WorktreeScope)}
          options={WORKTREE_SCOPE_OPTS.map((o) => ({ value: o.value, label: o.label }))} />
      </Field>
      {/* Gelombang 7 · "Perlu ditinjau" berdampingan dengan Worktree. ADR-0218 memperluasnya: item selesai
          yang belum ditandai "sudah ditinjau" ikut tersaring. Penanda itu ditulis operator, bukan diturunkan
          dari diff; tinjauan diff tetap lewat "Review perubahan" per item. */}
      <Field label="Tinjauan" hint="Item yang sesinya menunggu jawabanmu, dan item selesai yang belum kamu tandai sudah ditinjau. Tandai lewat menu item atau di Review perubahan.">
        <Select size="sm" aria-label="Filter perlu ditinjau" value={review} onChange={(e) => setReview(e.target.value as ReviewScope)}
          options={REVIEW_SCOPE_OPTS.map((o) => ({ value: o.value, label: o.label }))} />
      </Field>
      {/* SPEC-408 · ADR-0090 · rentang tanggal: satu sumbu + dua batas inklusif. */}
      <Field label="Tanggal">
        <div className="hn-bl-date-row">
          <Select size="sm" aria-label="Filter tanggal berdasarkan" value={dateField}
            onChange={(e) => setDateField(e.target.value as "created" | "started")}
            options={[{ value: "created", label: "Dibuat" }, { value: "started", label: "Dikerjakan" }]} />
          <Input size="sm" type="date" aria-label="Tanggal dari" value={from}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} />
          <span className="hn-eyebrow" aria-hidden="true">→</span>
          <Input size="sm" type="date" aria-label="Tanggal sampai" value={to}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} />
        </div>
      </Field>
    </Stack>
  );
  const firstLoad = !loaded && items.length === 0 && refreshing;
  const sharedActions: ItemActions = {
    onStart, onDelete: requestDelete, onOpenRun, onOpenReview, onMarkDone, onMarkReviewed,
  };
  const openDetail = (s: SpecSlim) => setDetailId(s.id);
  const stageLabel = STAGE_GROUPS.find((g) => g.key === stage)?.label ?? "";
  return (
    <div className="hn-bl-screen">
      <section className="hn-bl-toolbar" role="region" aria-label="Kontrol backlog">
        <FilterBar label="Penyaring backlog"
          search={{ value: q, onChange: setQ, label: "Cari backlog", placeholder: "mis. invoice atau SPEC-412" }}
          chips={chips} filters={filtersPanel} filtersLabel="Filter"
          onReset={activeFilters > 0 ? resetAll : undefined} resetLabel="Reset filter"
          actions={<>
            <ViewToggle value={view} onChange={setView} />
            <SyncButton onDone={() => setSyncNonce((n) => n + 1)} onToast={onToast ?? (() => {})} />
          </>} />
        <Tabs variant="pill" aria-label="Tahap backlog" value={stage} onChange={(v) => setStage(v as StageGroup)}
          className="hn-bl-stage-tabs"
          tabs={STAGE_GROUPS.map((g) => ({ value: g.key, label: g.label, count: counts[g.key] }))} />
        {/* Keterangan sumber yang namanya bukan kata sehari-hari — terlihat, bukan hanya tooltip. */}
        {TAB_HINT[tab] && (
          <p className="hn-bl-hint" data-testid="backlog-tab-hint">{TAB_HINT[tab]}</p>
        )}
        {/* SPEC-857 · ADR-0131 · saat refetch gagal, angka ini TIDAK boleh tampil sebagai kebenaran. */}
        <div className="hn-bl-status-line">
          {stale && (
            <span role="status" className="hn-bl-stale"
              title="Server tak menjawab saat menyegarkan — angka ini dari muatan terakhir yang berhasil">
              Data mungkin usang: server tak menjawab saat menyegarkan.
            </span>
          )}
          {refreshing && (
            <span data-testid="backlog-refreshing" className="hn-bl-muted">Memuat…</span>
          )}
        </div>
      </section>

      {firstLoad ? (
        <SkeletonList rows={LOADING_ROWS} label="Memuat backlog" />
      ) : scoped.length === 0 ? (
        // Kosong karena filter cakupan (atau item memang tak ada): keduanya dijawab dengan keadaan "filter",
        // bukan "tahap kosong", supaya "Perlu ditinjau" yang kosong tak terbaca sebagai tahap tanpa item.
        backlog.length === 0
          ? <StateBlock kind="empty" illustration="PST-002" title="Backlog masih kosong"
            hint="Ajukan feature brief atau Finding QA — hanoman menjalankannya dari brainstorm sampai execute."
            action={onNew} actionLabel="Tambah spec" />
          : <StateBlock kind="empty" icon="filter" title="Tidak ada spec untuk filter ini"
            hint={`${backlog.length} spec ada di backlog, tapi tak ada yang cocok dengan filter aktif.`}
            action={resetAll} actionLabel="Reset filter" actionIcon="rotate-ccw" />
      ) : visible.length === 0 ? (
        <StateBlock kind="empty" compact icon="filter" title={`Tidak ada spec di tahap ${stageLabel}`}
          hint="Tahap lain tetap memuat item yang sama." action={() => setStage("all")}
          actionLabel="Tampilkan semua" actionIcon="x" />
      ) : view === "board" ? (
        // Papan tak dipaginasi: kolomnya sendiri yang menjadi pengelompokan.
        <div className="hn-bl-body">
          {/* Hint drag terlihat di layar, bukan hanya `title` — tombol di kartu adalah jalur yang sama. */}
          <p data-testid="board-drag-hint" className="hn-bl-hint">
            Seret kartu dari kolom Backlog ke Brainstorm untuk memulai sesi. Tombol di kartu melakukan hal yang sama.
          </p>
          <Board specs={visible} activeSpecs={activeSpecs} presenceBySpec={presenceBySpec}
            projectNameOf={projectNameOf} onOpenDetail={openDetail} {...sharedActions} />
        </div>
      ) : (
        <div className="hn-bl-body">
          <div ref={listRef} data-testid="backlog-scroll" aria-busy={refreshing || undefined} className="hn-bl-list-scroll">
            <RowList label="Daftar backlog">
              {pageItems.map((s) => (
                <SpecRow key={s.id} spec={s} presenceOn={presenceBySpec?.get(s.id)} projectName={projectNameOf(s.projectId)}
                  running={activeSpecs?.has(s.id)} onOpenDetail={openDetail} {...sharedActions} />
              ))}
            </RowList>
          </div>
          <div className="hn-bl-pager">
            <Pager page={sp.page} pageCount={sp.pageCount} total={visible.length} from={sp.from} to={sp.to} onPage={setPage} unit="spec" />
          </div>
        </div>
      )}
      <SpecDetail spec={detailSpec} onClose={() => setDetailId(null)}
        running={!!detailId && !!activeSpecs?.has(detailId)} onOpenRun={onOpenRun}
        presenceOn={detailId ? presenceBySpec?.get(detailId) : undefined}
        onEditBranch={onEditBranch} onRevertStage={onRevertStage} onMarkDone={onMarkDone} onOpenReview={onOpenReview} onStart={onStart} onIntegrate={onIntegrate} onEditSpec={onEditSpec} onPromoteToQa={onPromoteToQa}
        onPromoteToBrief={onPromoteToBrief} onPromoteToPrd={onPromoteToPrd}
        onEditDeps={onEditDeps} onEditAutoMerge={onEditAutoMerge} onChangeSource={onChangeSource}
        onRequestDelete={requestDelete} onUndoable={undoable}
        projectPolicy={(projects.find((x) => x.id === backlog.find((s) => s.id === detailId)?.projectId) as { autoMerge?: unknown } | undefined)?.autoMerge}
        projectName={projects.find((x) => x.id === detailSpec?.projectId)?.name}
        allSpecs={backlog}
        onAttachmentToast={(m, tone) => onToast?.(m, tone ?? "ok", "paperclip")} />
      <ToastHost toast={toast} />
      {dialog}
    </div>
  );
}
