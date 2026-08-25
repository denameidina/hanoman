/* BacklogScreen — specs on the brainstorm → execute lifecycle.
   Ported; spec.project → spec.projectId; window → ds imports. */
import React from "react";
import {
  Card, Badge, Tabs, Select, Button, IconButton, Icon, Checkbox, serverPage, Pager, Modal, StateBlock, Input,
  Field, HnTextarea, LIST_SCROLL_STYLE, LIST_SCREEN_STYLE, FIXED_ROW_STYLE
} from "../ds";
import { api, type SourceResetPending } from "../api/client";
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
  usePersistedState, useScrollRestore, useResetOnChange, ResetViewButton,
  oneOf, isStr, isNum, nullableStr,
} from "../ui-state";
import type { Spec } from "./types";
import type { ProjectVM } from "./types";
import type { AuditEscalation } from "@hanoman/shared";
import { AUTO_MERGE_OFF, autoMergeSummary, resolveAutoMerge, payloadShapeFor, type AutoMerge } from "@hanoman/shared";
import { PresenceChip } from "./PresenceChip";

// Kosakata stage frontend (key → label). Di-reuse oleh BacklogPicker di TerminalScreen (SPEC-179).
export const B_STAGES = [
  { key: "brainstorming", label: "Brainstorm" }, { key: "objective", label: "Objective" },
  { key: "spec-ready", label: "Spec" }, { key: "planned", label: "Plan" },
  { key: "executing", label: "Execute" }, { key: "done", label: "Done" },
];
const bStageIndex = (k: string) => B_STAGES.findIndex((s) => s.key === k);
const B_PRIO: Record<string, { tone: any; label: string }> = {
  tinggi: { tone: "err", label: "prioritas tinggi" },
  sedang: { tone: "neutral", label: "prioritas sedang" },
  rendah: { tone: "neutral", label: "prioritas rendah" },
};
// SPEC-546 · ADR-0109 · katalog source (lencana, opsi, daftar field per bentuk) pindah ke
// `source-meta.ts` supaya dialog "Ubah type" memakai katalog yang SAMA — dua katalog pasti
// berselisih. Re-export menjaga pemakai lama (TerminalScreen, test) tetap tersambung.
export { SOURCE_META, sourceMeta };

// SPEC-447 · ADR-0093 · alasan sebuah item tertahan. Label hidup di UI (server mengirim slug),
// pola yang sama dengan B_PRIO/SOURCE_META.
export const blockLabel = (reason: string): string =>
  reason === "missing" ? "tak ditemukan" : reason === "unmerged" ? "belum ter-merge" : "belum selesai";

function BlockedBadge({ spec }: { spec: Spec }) {
  const bl = spec.blockedBy ?? [];
  if (!bl.length) return null;
  return (
    <Badge tone="warn" size="sm" icon="lock"
      title={bl.map((b) => `${b.id} — ${blockLabel(b.reason)}`).join(" · ")}>Terblokir</Badge>
  );
}
function StageBar({ stage }: { stage: string }) {
  const idx = bStageIndex(stage);
  const label = B_STAGES[idx]?.label ?? stage;
  return (
    <div aria-label={`Status ${label}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {B_STAGES.map((s, i) => {
        const done = i < idx || stage === "done";
        const active = i === idx && stage !== "done";
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: active ? "3px 9px" : 0, borderRadius: "var(--radius-pill)",
              background: active ? "var(--brass-100)" : "transparent",
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: done ? "var(--leaf-500)" : active ? "var(--brass-500)" : "var(--bone-400)"
              }} />
              {active && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: "var(--brass-700)" }}>{s.label}</span>}
            </span>
            {i < B_STAGES.length - 1 && (
              <span style={{ width: 12, height: 1.5, background: (i < idx || stage === "done") ? "var(--leaf-500)" : "var(--bone-300)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="hn-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {value || "—"}
      </div>
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

function SpecDetail({ spec, onClose, onEditBranch, onRevertStage, onMarkDone, onOpenReview, onStart, onIntegrate, onEditSpec, onPromoteToQa, onPromoteToBrief, onPromoteToPrd, onEditDeps, onEditAutoMerge, onChangeSource, projectPolicy, allSpecs, onAttachmentToast }:
  {
    spec: Spec | null; onClose: () => void; onEditBranch?: (s: Spec, b: string | null) => void;
    onRevertStage?: (s: Spec, target: string, confirmDelete?: boolean) => Promise<any>;
    // SPEC-804 · ADR-0120 · maju ke `done` tanpa sesi. Bersebelahan dengan revert: satu blok,
    // dua arah.
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    onOpenReview?: (s: Spec) => void;
    onStart?: (s: Spec) => void;
    onIntegrate?: (s: Spec, op: "merge" | "rebase", target: string) => void;
    onEditSpec?: (s: Spec, patch: { title?: string; priority?: string; payload?: unknown }) => void;
    // SPEC-237 · naikkan audit → Finding QA. SPEC-340 · ADR-0076 · dua pintu lagi (brief & PRD);
    // argumen kedua = rekomendasi terbaca (null bila dokumen audit belum punya blok escalation).
    onPromoteToQa?: (s: Spec, e: AuditEscalation | null) => void;
    onPromoteToBrief?: (s: Spec, e: AuditEscalation | null) => void;
    onPromoteToPrd?: (s: Spec, e: AuditEscalation | null) => void;
    // SPEC-447 · ADR-0093 · dependency bisa diperbaiki kapan saja (termasuk sesudah item dimulai):
    // gerbangnya soal peluncuran BERIKUTNYA, bukan konten yang sedang dikerjakan sesi hidup.
    onEditDeps?: (s: Spec, ids: string[]) => void;
    // SPEC-486 · ADR-0103 · override kebijakan auto-merge item ini (null = kembali ikut project).
    // Alasan yang sama dengan onEditDeps: ia menggerbangi apa yang terjadi SESUDAH kerja.
    onEditAutoMerge?: (s: Spec, v: AutoMerge | null) => void;
    // SPEC-546 · ADR-0109 · ubah type/source item in-place. Boleh ditawarkan kapan saja:
    // gerbangnya ditegakkan server, dan dialog mencerminkannya.
    // ADR-0149 · mengembalikan rencana reset (atau null) supaya dialog bisa menampilkan daftar
    // apa yang hilang dan meminta konfirmasi sebelum satu byte pun terhapus.
    onChangeSource?: (s: Spec, source: string, payload?: unknown, confirmReset?: boolean)
      => Promise<SourceResetPending | null> | void;
    projectPolicy?: unknown;   // Project.autoMerge — untuk label "Ikut project (…)"
    allSpecs?: Spec[];
    // SPEC-843 · ADR-0124 · hasil unggah/hapus lampiran. Bentuknya `AttachmentToast`, bukan
    // `onToast` layar (yang bersignature toast App); panel lampiran tak perlu tahu ikon.
    onAttachmentToast?: AttachmentToast;
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
  // SPEC-546 · ADR-0109 · dialog "Ubah type".
  const [showSource, setShowSource] = React.useState(false);
  // SPEC-186 · konten hanya boleh diubah selagi item masih di backlog & belum pernah dimulai.
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const editable = spec?.stage === "brainstorming" && spec?.baseSha == null && !!onEditSpec;
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
  return (
    <Modal open title={spec.title} eyebrow={spec.id + " · " + spec.projectId}
      icon={sourceMeta(spec.source).icon} onClose={closeDetail}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <Badge tone={sourceMeta(spec.source).tone} size="sm">{sourceMeta(spec.source).label}</Badge>
        <Badge tone={(B_PRIO[spec.priority] || B_PRIO.sedang!).tone} size="sm" variant="outline">
          {(B_PRIO[spec.priority] || B_PRIO.sedang!).label}
        </Badge>
        <Badge tone="neutral" size="sm">{spec.author}</Badge>
        <span style={{ flex: 1 }} />
        {/* SPEC-186 · edit konten selagi item masih di backlog & belum dimulai. */}
        {editable && !editing && (
          <Button size="sm" variant="secondary" leftIcon="pencil" onClick={startEdit}>Edit</Button>
        )}
        {/* SPEC-546 · ADR-0109 · ubah type/source in-place. Tak digerbangi `editable`: item yang
            sudah dimulai tetap boleh berpindah ke source ber-flow sama (dialog yang menyaring). */}
        {onChangeSource && (
          <Button size="sm" variant="secondary" leftIcon="shuffle"
            onClick={() => setShowSource(true)}>Ubah type</Button>
        )}
        {/* SPEC-171 · buka layar review all files + file changed dari worktree. */}
        {onOpenReview && (
          <Button size="sm" variant="secondary" leftIcon="git-compare"
            onClick={() => { onOpenReview(spec); onClose(); }}>Review perubahan</Button>
        )}
      </div>
      <div style={{ marginBottom: 18 }}>
        <StageBar stage={spec.stage} />
        {/* SPEC-172 · reopen sesi hanya di detail (bukan list/grid/board): spec yang keburu
            `done` bisa dibuka lagi untuk melanjutkan sisa kerja (lanjut di fase Execute). */}
        {spec.stage === "done" && onStart && (
          <div style={{ marginTop: 12 }}>
            <Button size="sm" variant="primary" leftIcon="play" onClick={() => onStart(spec)}>
              Buka sesi lagi
            </Button>
          </div>
        )}
        {/* SPEC-237 · audit tetap doc-of-record. SPEC-340 · ADR-0076 · tiga pintu eskalasi:
            target rekomendasi disorot (primary + badge), sisanya secondary — ketiganya selalu
            tersedia karena manusia yang terakhir memutuskan. */}
        {isAuditSource(spec.source) && (onPromoteToQa || onPromoteToBrief || onPromoteToPrd) && (
          <div style={{ marginTop: 12 }}>
            <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Tindak lanjut</div>
            {esc && (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 8 }}>
                {esc.target === "none"
                  ? <span>Audit menilai <strong>cukup jawaban</strong> — tak perlu perbaikan.</span>
                  : <span><Badge tone="brass" size="sm">direkomendasikan hanoman</Badge>{" "}{ESC_LABEL[esc.target]}</span>}
                {esc.reason ? <div style={{ marginTop: 4 }}>{esc.reason}</div> : null}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
        {/* SPEC-175 · rebase/merge branch hasil done spec ke target pilihan (lokal/origin). */}
        {spec.stage === "done" && onIntegrate && (
          <div style={{ marginTop: 12 }}>
            <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Integrasi</div>
            <Button size="sm" variant="secondary" leftIcon="git-merge" onClick={() => setShowIntegrate(true)}>
              Rebase / Merge
            </Button>
          </div>
        )}
        {(onRevertStage || onMarkDone) && (
          <div style={{ marginTop: 12 }}>
            <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Ubah status</div>
            <div style={{ fontSize: 13, color: "var(--text-strong)", fontWeight: 600, marginBottom: 6 }}>
              {`Status saat ini: ${currentStageLabel}`}
            </div>
            {/* SPEC-804 · ADR-0120 · satu blok, dua arah: maju ke selesai di sini, mundur di bawah. */}
            {spec.stage !== "done" && onMarkDone && (
              <div style={{ marginBottom: 10 }}>
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
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 6 }}>
                  Status saat ini dan status berikutnya tidak dapat dipilih. Kemajuan hanya berasal dari fase sesi.
                </div>
                {stageTarget && (
                  <div style={{
                    border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
                    background: "var(--bone-100)", padding: 10, marginTop: 8, fontSize: 12.5,
                    color: "var(--text-muted)", lineHeight: 1.5,
                  }}>
                    <div style={{ color: "var(--text-strong)", fontWeight: 600 }}>
                      {currentStageLabel} → {targetStageLabel}
                    </div>
                    Fase sesi yang sudah berjalan tidak dibatalkan. Dokumen Spec/Plan di atas target
                    mungkin perlu dihapus setelah konfirmasi; kode dan commit tidak disentuh.
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <Button size="sm" variant="secondary" leftIcon="rotate-ccw"
                    disabled={!stageTarget} loading={stageBusy} onClick={saveStage}>Simpan status</Button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {currentStageLabel} adalah status paling awal. Kemajuan hanya berasal dari fase sesi.
              </div>
            )}
          </div>
        )}
      </div>
      {/* SPEC-804 · ADR-0120 · jejak penandaan manual. Hanya muncul bila item memang ditandai
          manusia — item yang selesai lewat sesi tak punya barisnya. */}
      {spec.manualDone && (
        <div style={{ marginBottom: 14 }} data-testid="manual-done-trail">
          <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Ditandai selesai manual</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {spec.manualDone.by} · {new Date(spec.manualDone.at).toLocaleString("id-ID")}
            {spec.manualDone.reason ? <div style={{ marginTop: 4 }}>{spec.manualDone.reason}</div> : null}
          </div>
        </div>
      )}
      {/* SPEC-546 · ADR-0109 · jejak konversi type. Hanya muncul bila item pernah dikonversi —
          item yang tak pernah berpindah tak perlu barisnya. */}
      {(spec.sourceHistory ?? []).length > 0 && (
        <div style={{ marginBottom: 14 }} data-testid="source-trail">
          <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Jejak konversi type</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(spec.sourceHistory ?? []).map((h, i) => (
              <div key={`${h.at}-${i}`} style={{ fontSize: 13, color: "var(--text-muted)" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-strong)" }}>
                  {h.from} → {h.to}
                </span>
                {" · "}{new Date(h.at).toLocaleString("id-ID")}{" · "}{h.by}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* SPEC-486 · ADR-0103 · override kebijakan auto-merge untuk item ini. Pilihan pertama
          menyebut kebijakan project apa adanya supaya tak pernah ada pertanyaan "lalu ini pakai apa". */}
      {onEditAutoMerge && (
        <div style={{ marginBottom: 14 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Auto-merge saat selesai</div>
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
            <div style={{ marginTop: 6 }}>
              <Select size="sm" aria-label="Branch tujuan item ini" value={spec.autoMerge.branch ?? ""}
                onChange={(e) => onEditAutoMerge(spec, { ...spec.autoMerge!, branch: e.target.value || null })}
                options={[{ value: "", label: "Pilih branch…" },
                  ...branches.map((b) => ({ value: b, label: b }))]} />
            </div>
          )}
        </div>
      )}
      {editing ? (
        <Field label="Judul"><Input value={form.title ?? ""} onChange={setField("title")}
          placeholder="mis. Jadwal invoice berulang" style={{ width: "100%" }} /></Field>
      ) : (
        <DetailRow label="Objective" value={spec.objective} />
      )}
      {/* SPEC-143 · dapat diubah selama item masih di backlog; hanya menentukan basis run berikutnya. */}
      <div style={{ marginBottom: 14 }}>
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Branch worktree</div>
        <Select size="sm" value={spec.branchFrom ?? ""} disabled={!branches.length}
          onChange={(e) => onEditBranch && onEditBranch(spec, e.target.value || null)}
          options={branchOptions(branches, remoteOnly)} />
      </div>
      {/* SPEC-843 · ADR-0124 · lampiran boleh ditambah/dihapus KAPAN SAJA, termasuk selagi sesi
          berjalan — server memateralisasi ulang dan fase berikutnya membacanya. */}
      <SpecAttachmentsPanel specId={spec.id} onToast={onAttachmentToast ?? (() => {})} />
      {/* SPEC-447 · ADR-0093 · siapa yang ditunggu item ini, dan kenapa. */}
      <div style={{ marginBottom: 14 }}>
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Bergantung pada</div>
        {(spec.dependsOn ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-subtle)" }}>— berdiri sendiri</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(spec.dependsOn ?? []).map((depId) => {
              const b = (spec.blockedBy ?? []).find((x) => x.id === depId);
              return (
                <div key={depId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-strong)" }}>{depId}</span>
                  {b
                    ? <Badge tone="warn" size="sm">{blockLabel(b.reason)}</Badge>
                    : <Badge tone="ok" size="sm" icon="check">selesai &amp; ter-merge</Badge>}
                </div>
              );
            })}
          </div>
        )}
        {onEditDeps && depPickList.length > 0 && (
          <div style={{
            maxHeight: 132, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6,
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 8, marginTop: 8,
          }}>
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
      {editing ? (
        <>
          {!qa && (
            <Field label="Prioritas">
              <Select value={form.priority ?? "sedang"} onChange={setField("priority")} options={PRIO_OPTS} style={{ width: "100%" }} />
            </Field>
          )}
          {fields.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              {k === "severity"
                ? <Select value={form[k] ?? "major"} onChange={setField(k)} options={SEV_OPTS} style={{ width: "100%" }} />
                : <HnTextarea value={form[k] ?? ""} onChange={setField(k)} rows={2} placeholder={ph} />}
            </Field>
          ))}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Batal</Button>
            <Button size="sm" variant="primary" leftIcon="check" onClick={saveEdit}>Simpan</Button>
          </div>
        </>
      ) : (
        fields.map(([k, label]) => <DetailRow key={k} label={label} value={p[k] ?? ""} />)
      )}
      {confirm && (
        <Modal open title="Kembalikan stage & hapus artefak" icon="rotate-ccw"
          eyebrow={spec.id + " → " + confirm.target}
          onClose={stageBusy ? undefined : () => setConfirm(null)}>
          <div style={{ fontSize: 13.5, color: "var(--text-strong)", marginBottom: 12 }}>
            {confirm.files.length} berkas docs akan dihapus dari disk (kode & commit tak disentuh):
          </div>
          <ul style={{
            fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)",
            marginBottom: 16, paddingLeft: 18
          }}>
            {confirm.files.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button size="sm" variant="secondary" disabled={stageBusy}
              onClick={() => setConfirm(null)}>Batal</Button>
            <Button size="sm" variant="primary" leftIcon="trash-2" loading={stageBusy}
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
      {/* SPEC-546 · ADR-0109 · dialog pilih source tujuan + form field bentuk barunya. */}
      {showSource && onChangeSource && (
        // ADR-0149 · dialog yang menutup dirinya sendiri lewat `onClose`: submit PERTAMA pada
        // jalur reset justru harus membuatnya tetap terbuka untuk menampilkan daftar konfirmasi.
        <ChangeSourceDialog spec={spec} onClose={() => setShowSource(false)}
          onSubmit={(source, payload, confirmReset) =>
            Promise.resolve(onChangeSource(spec, source, payload, confirmReset) ?? null)} />
      )}
    </Modal>
  );
}

/* Aksi per-spec. Dipakai grid, list, danZ board — satu-satunya jalan keyboard ke
   "mulai sesi", jadi board tetap bisa dipakai tanpa drag. */
function SpecActions({ spec, onStart, onDelete, onOpenRun, onOpenReview, onMarkDone, running }:
  {
    spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void;
    // SPEC-804 · ADR-0120 · tandai selesai manual. Dua langkahnya ditangani MarkDoneDialog.
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    running?: boolean
  }) {
  const [docs, setDocs] = React.useState(false);
  const [markDone, setMarkDone] = React.useState(false);
  return (
    <div className="hn-row-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* SPEC-171 · review all files + file changed dari worktree. Berguna kapan pun
          worktree ada, jadi tampil di semua stage. */}
      {onOpenReview && (
        <Button size="sm" variant="ghost" leftIcon="git-compare" onClick={() => onOpenReview(spec)}>Review</Button>
      )}
      {spec.stage !== "done" && running && (
        <Button size="sm" variant="secondary" leftIcon="terminal" onClick={() => onOpenRun && onOpenRun(spec)}>
          Buka sesi
        </Button>
      )}
      {spec.stage !== "done" && !running && (
        <Button size="sm" variant="primary" leftIcon="play" onClick={() => onStart && onStart(spec)}>
          {spec.stage === "brainstorming" ? "Mulai" : "Lanjutkan"}
        </Button>
      )}
      {spec.stage === "done" && <Badge tone="ok" size="sm" icon="check-circle-2">selesai</Badge>}
      {/* SPEC-804 · ADR-0120 · maju ke `done` tanpa sesi — untuk item yang beres di luar hanoman. */}
      {spec.stage !== "done" && onMarkDone && (
        <IconButton size="sm" variant="ghost" icon="circle-check" label="Tandai selesai"
          onClick={() => setMarkDone(true)} />
      )}
      <IconButton size="sm" variant="ghost" icon="file-text" label="Lihat dokumen" onClick={() => setDocs(true)} />
      {onDelete && <IconButton size="sm" variant="ghost" icon="trash-2" label="Hapus spec" onClick={() => onDelete(spec)} />}
      {markDone && onMarkDone && (
        <MarkDoneDialog spec={spec} onClose={() => setMarkDone(false)} onSubmit={onMarkDone} />
      )}
      {docs && <SpecDocsModal specId={spec.id} onClose={() => setDocs(false)} />}
    </div>
  );
}

function TitleButton({ spec, onOpenDetail, size = 15 }:
  { spec: Spec; onOpenDetail?: (s: Spec) => void; size?: number }) {
  return (
    <button onClick={() => onOpenDetail && onOpenDetail(spec)} style={{
      border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer",
      fontFamily: "var(--font-sans)", fontSize: size, fontWeight: 600, color: "var(--text-strong)",
    }}>
      {spec.title}
    </button>
  );
}

function SpecCard({ spec, onStart, onDelete, onOpenRun, onOpenReview, onOpenDetail, onMarkDone, running, presenceOn }:
  {
    spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void; onOpenDetail?: (s: Spec) => void;
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    running?: boolean; presenceOn?: string[]
  }) {
  const prio = B_PRIO[spec.priority] || B_PRIO.sedang!;
  return (
    <Card padding={16}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{spec.id}</span>
            <Badge tone={sourceMeta(spec.source).tone} size="sm" icon={sourceMeta(spec.source).icon}>
              {sourceMeta(spec.source).label}
            </Badge>
            {spec.branchFrom && <Badge tone="neutral" size="sm" icon="git-branch">{spec.branchFrom}</Badge>}
            <BlockedBadge spec={spec} />
            {/* SPEC-919 · ADR-0147 · penanda LIVE lintas device. */}
            <PresenceChip names={presenceOn} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>· {spec.projectId}</span>
          </div>
          <div style={{ marginTop: 8 }}><TitleButton spec={spec} onOpenDetail={onOpenDetail} /></div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>{spec.objective}</div>
        </div>
        <Badge tone={prio.tone} size="sm" variant={spec.priority === "tinggi" ? "soft" : "outline"}>{prio.label}</Badge>
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hair)" }}>
        <StageBar stage={spec.stage} />
        <div className="hn-card-footer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{spec.author}</span>
          <SpecActions spec={spec} onStart={onStart} onDelete={onDelete} onOpenRun={onOpenRun} onOpenReview={onOpenReview} onMarkDone={onMarkDone} running={running} />
        </div>
      </div>
    </Card>
  );
}

/* ── List view ─────────────────────────────────────────────────────────────
   Baris padat: satu spec per baris, stage bar inline, aksi di kanan. */
function SpecRow({ spec, onStart, onDelete, onOpenRun, onOpenReview, onOpenDetail, onMarkDone, running, presenceOn }:
  {
    spec: Spec; onStart?: (s: Spec) => void; onDelete?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void; onOpenDetail?: (s: Spec) => void;
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    running?: boolean; presenceOn?: string[]
  }) {
  const prio = B_PRIO[spec.priority] || B_PRIO.sedang!;
  return (
    <div className="hn-backlog-row" style={{
      display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
      borderBottom: "1px solid var(--border-hair)", background: "var(--surface-card)"
    }}>
      <Icon name={sourceMeta(spec.source).icon} size={15} color={sourceMeta(spec.source).color} />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)", flex: "0 0 84px" }}>{spec.id}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TitleButton spec={spec} onOpenDetail={onOpenDetail} size={14} />
        <div style={{
          fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap"
        }}>{spec.objective}</div>
      </div>
      {spec.branchFrom && <Badge tone="neutral" size="sm" icon="git-branch">{spec.branchFrom}</Badge>}
      <BlockedBadge spec={spec} />
      <Badge tone={prio.tone} size="sm" variant={spec.priority === "tinggi" ? "soft" : "outline"}>{prio.label}</Badge>
      {/* SPEC-919 · ADR-0147 · penanda LIVE lintas device — beda dari StageBar yang stage tersimpan. */}
      <PresenceChip names={presenceOn} />
      <div style={{ flex: "0 0 auto" }}><StageBar stage={spec.stage} /></div>
      <SpecActions spec={spec} onStart={onStart} onDelete={onDelete} onOpenRun={onOpenRun} onOpenReview={onOpenReview} onMarkDone={onMarkDone} running={running} />
    </div>
  );
}

/* ── Board view ────────────────────────────────────────────────────────────
   Kolom = stage (+ backlog di depan, success/failed di belakang). Enam kolom
   tengah dimiliki runner: `spec.stage` cuma cermin fase run (SPEC-009), jadi
   kartu di sana tak bisa diangkat. Yang bisa didrag hanya dua kolom ujung,
   dan drop-nya memanggil aksi yang memang ada tombolnya: mulai / jalankan lagi. */
const BACKLOG_COL = "backlog", SUCCESS_COL = "success";
const FIRST_STAGE = B_STAGES[0]!.key;   // brainstorming
const COLUMNS: { key: string; label: string; icon?: string }[] = [
  { key: BACKLOG_COL, label: "Backlog", icon: "inbox" },
  ...B_STAGES.slice(0, 5).map((s) => ({ key: s.key, label: s.label })),
  { key: SUCCESS_COL, label: "Success", icon: "check-circle-2" },
];

/* Kolom sebuah spec. `hasSession` = ada sesi claude yang hidup untuknya (SPEC-162). Spec
   yang belum pernah dikerjakan tapi stage-nya sudah maju tetap tampil di kolom stage-nya —
   bukan diklaim balik ke Backlog.

   Kolom "Failed" hilang bersama tabel Run: sebuah sesi tak punya status terminal yang bisa
   dibaca dari luar. Yang gagal terlihat di terminalnya sendiri, dan itu satu-satunya tempat
   yang jujur. */
export function specColumn(spec: Spec, hasSession?: boolean): string {
  if (spec.stage === "done") return SUCCESS_COL;
  if (!hasSession && spec.stage === "brainstorming") return BACKLOG_COL;
  return spec.stage;
}

/* Satu-satunya aturan drop, dan ia menuruti kontrak kanban: kartu mendarat di kolom
   tempat ia dijatuhkan. Sesi selalu mulai dari awal pipeline, jadi spec yang baru
   dijalankan berakhir di stage `brainstorming` — maka Brainstorm satu-satunya tujuan
   yang jujur. Kolom kerja lain sengaja menolak: dulu drop di Execute diterima lalu
   kartunya melompat empat kolom ke kiri.

   Drop berujung pada POST /terminal/sessions, tak pernah menulis field spec. */
export const canDrop = (from: string, to: string): boolean =>
  from === BACKLOG_COL && to === FIRST_STAGE;

function BoardCard({ spec, col, onOpenDetail, onStart, onOpenRun, onOpenReview, onMarkDone, running, presenceOn, onDragStart, onDragEnd, dragging }:
  {
    spec: Spec; col: string; onOpenDetail?: (s: Spec) => void; onStart?: (s: Spec) => void;
    onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void;
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    running?: boolean; presenceOn?: string[];
    onDragStart: () => void; onDragEnd: () => void; dragging: boolean
  }) {
  const prio = B_PRIO[spec.priority] || B_PRIO.sedang!;
  const draggable = col === BACKLOG_COL;
  return (
    <div draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", spec.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      title={draggable ? "Seret ke Brainstorm untuk memulai sesi"
        : "Stage mengikuti fase yang dilaporkan agen — kartu tak bisa dipindah"}
      style={{
        // `0 0 auto`: tanpa ini kartu menyusut mengisi kolom, bukan kolomnya yang menggulir.
        flex: "0 0 auto",
        background: "var(--surface-card)", border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-md)", padding: 10, boxShadow: "var(--shadow-xs)",
        cursor: draggable ? "grab" : "default", opacity: dragging ? 0.4 : 1,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Icon name={sourceMeta(spec.source).icon} size={13} color={sourceMeta(spec.source).color} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{spec.id}</span>
        <span style={{ flex: 1 }} />
        <Badge tone={prio.tone} size="sm" variant={spec.priority === "tinggi" ? "soft" : "outline"}>{spec.priority}</Badge>
      </div>
      <TitleButton spec={spec} onOpenDetail={onOpenDetail} size={13} />
      {spec.branchFrom && (
        <div style={{ marginTop: 6 }}><Badge tone="neutral" size="sm" icon="git-branch">{spec.branchFrom}</Badge></div>
      )}
      {(spec.blockedBy ?? []).length > 0 && (
        <div style={{ marginTop: 6 }}><BlockedBadge spec={spec} /></div>
      )}
      {presenceOn?.length ? (
        <div style={{ marginTop: 6 }}><PresenceChip names={presenceOn} /></div>
      ) : null}
      {/* HTML5 drag-and-drop mati di keyboard dan di layar sentuh. Tombol ini jalur
          satu-satunya di sana — termasuk retry spec di kolom Failed. */}
      <div style={{ marginTop: 8 }}>
        <SpecActions spec={spec} onStart={onStart} onOpenRun={onOpenRun} onOpenReview={onOpenReview} onMarkDone={onMarkDone} running={running} />
      </div>
    </div>
  );
}

function Board({ specs, activeSpecs, presenceBySpec, onStart, onOpenRun, onOpenReview, onOpenDetail, onMarkDone }:
  {
    specs: Spec[]; activeSpecs?: Set<string>; presenceBySpec?: Map<string, string[]>;
    onStart?: (s: Spec) => void; onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void; onOpenDetail?: (s: Spec) => void;
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
  }) {
  const [drag, setDrag] = React.useState<{ spec: Spec; from: string } | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  // SPEC-197 · di-memo: Board re-render tiap drag (setOver), tak perlu bangun ulang Map tiap kali.
  const byCol = React.useMemo(() => {
    const m = new Map<string, Spec[]>(COLUMNS.map((c) => [c.key, []]));
    for (const s of specs) m.get(specColumn(s, activeSpecs?.has(s.id)))?.push(s);
    return m;
  }, [specs, activeSpecs]);

  const drop = (to: string) => {
    if (drag && canDrop(drag.from, to) && onStart) onStart(drag.spec);
    setDrag(null); setOver(null);
  };
  return (
    /* Baris kolom menggulir mendatar; tiap KOLOM menggulir tegak sendiri, jadi judul
       kolom tak pernah tergulir keluar dan kolom terpanjang tak menyeret yang lain. */
    <div data-testid="backlog-board" className="hn-board-local-overflow" style={{
      flex: "1 1 auto", minHeight: 0, display: "flex", gap: 10,
      overflowX: "auto", overflowY: "hidden", alignItems: "stretch", paddingBottom: 4
    }}>
      {COLUMNS.map((c) => {
        const items = byCol.get(c.key)!;
        const active = !!drag && canDrop(drag.from, c.key);
        const hot = active && over === c.key;
        return (
          <div key={c.key}
            onDragOver={(e) => { if (active) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(c.key); } }}
            onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); drop(c.key); }}
            style={{
              flex: "0 0 244px", display: "flex", flexDirection: "column", minHeight: 0, padding: 10,
              borderRadius: "var(--radius-lg)",
              background: hot ? "var(--brass-100)" : "var(--bone-100)",
              border: `1px ${active ? "dashed" : "solid"} ${hot ? "var(--brass-500)" : "var(--border-hair)"}`,
              opacity: drag && !active ? 0.5 : 1, transition: "var(--transition-fast)",
            }}>
            <div style={{ ...FIXED_ROW_STYLE, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              {c.icon && <Icon name={c.icon} size={13} color="var(--text-muted)" />}
              <span className="hn-eyebrow">{c.label}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>{items.length}</span>
            </div>
            {/* Zona drop mencakup ruang kosong di bawah kartu: event menggelembung ke kolom. */}
            <div style={{ ...LIST_SCROLL_STYLE, display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((s) => (
                <BoardCard key={s.id} spec={s} col={c.key} onOpenDetail={onOpenDetail}
                  onStart={onStart} onOpenRun={onOpenRun} onOpenReview={onOpenReview}
                  onMarkDone={onMarkDone} running={activeSpecs?.has(s.id)}
                  presenceOn={presenceBySpec?.get(s.id)}
                  dragging={drag?.spec.id === s.id}
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

const VIEWS = [
  { value: "grid", label: "Grid", icon: "layout-grid" },
  { value: "list", label: "List", icon: "list" },
  { value: "board", label: "Board", icon: "kanban" },
];

export function BacklogScreen({ backlog, projects, pageSize = 20, onStart, activeSpecs, presenceBySpec, onDelete, onOpenRun, onOpenReview, onNew, onEditBranch, onRevertStage, onMarkDone, onIntegrate, onEditSpec, onEditDeps, onEditAutoMerge, onChangeSource, onPromoteToQa, onPromoteToBrief, onPromoteToPrd, projectFilter, onProjectFilter, dataVersion, onToast, initialDetailId }:
  {
    backlog: Spec[]; projects: ProjectVM[]; pageSize?: number;
    onStart?: (s: Spec) => void; activeSpecs?: Set<string>; presenceBySpec?: Map<string, string[]>;
    onDelete?: (s: Spec) => void; onOpenRun?: (s: Spec) => void; onOpenReview?: (s: Spec) => void; onNew?: () => void;
    onEditBranch?: (s: Spec, b: string | null) => void;
    onRevertStage?: (s: Spec, target: string, confirmDelete?: boolean) => Promise<any>;
    // SPEC-804 · ADR-0120 · tandai selesai manual; `needConfirm` = server minta konfirmasi karena
    // ada sesi hidup untuk item ini.
    onMarkDone?: (s: Spec, reason: string, confirm: boolean) => Promise<MarkDoneResult>;
    onIntegrate?: (s: Spec, op: "merge" | "rebase", target: string) => void;
    onEditSpec?: (s: Spec, patch: { title?: string; priority?: string; payload?: unknown }) => void;
    // SPEC-447 · ADR-0093 · ubah dependency item (di luar gerbang edit SPEC-186).
    onEditDeps?: (s: Spec, ids: string[]) => void;
    // SPEC-486 · ADR-0103 · ubah kebijakan auto-merge item (null = kembali ikut project).
    onEditAutoMerge?: (s: Spec, v: AutoMerge | null) => void;
    // SPEC-546 · ADR-0109 · ubah type/source item in-place (id/riwayat/dependency tetap).
    // ADR-0149 · signature harus SAMA dengan yang dipakai `SpecDetail`: tipe 3-argumen tetap
    // lolos tsc (arity lebih sedikit assignable), jadi ia berbohong tanpa satu pun error —
    // dan `confirmReset` yang tak terbaca berarti konfirmasi operator tak pernah sampai.
    onChangeSource?: (s: Spec, source: string, payload?: unknown, confirmReset?: boolean)
      => Promise<SourceResetPending | null> | void;
    // SPEC-237 · naikkan audit → Finding QA. SPEC-340 · ADR-0076 · + feature brief & PRD;
    // argumen kedua = rekomendasi hanoman yang terbaca dari dokumen audit (bisa null).
    onPromoteToQa?: (s: Spec, e: AuditEscalation | null) => void;
    onPromoteToBrief?: (s: Spec, e: AuditEscalation | null) => void;
    onPromoteToPrd?: (s: Spec, e: AuditEscalation | null) => void;
    projectFilter: string; onProjectFilter: (id: string) => void; dataVersion?: number;
    onToast?: (msg: string, kind?: string, icon?: string) => void; // SPEC-268 · hasil tombol Sync
    initialDetailId?: string | null;     // SPEC-293 · deep-link #spec= → buka SpecDetail saat mount
  }) {
  // SPEC-740 · ADR-0115 · seluruh state tampilan layar ini persisten berkunci `backlog`.
  const [tab, setTab] = usePersistedState("backlog", "tab", "all", isStr);
  // SPEC-268 · bump untuk re-fetch daftar sesudah tombol Sync menarik data baru.
  const [syncNonce, setSyncNonce] = React.useState(0);
  // `string`, bukan union: `Tabs.onChange` memberi string. Guard-nya tetap ketat, jadi
  // nilai di luar daftar tetap jatuh ke "grid".
  const [view, setView] = usePersistedState<string>("backlog", "view", "grid", oneOf<string>("grid", "list", "board"));
  // SPEC-178 · search + filter stage/prioritas, semua view-local (tak diangkat ke App).
  const [q, setQ] = usePersistedState("backlog", "q", "", isStr);
  const [stageFilter, setStageFilter] = usePersistedState("backlog", "stage", "all", isStr);
  const [prioFilter, setPrioFilter] = usePersistedState("backlog", "prio", "all", isStr);
  // SPEC-408 · ADR-0090 · rentang tanggal. `dateField` memilih sumbunya (dibuat / dikerjakan);
  // `from`/`to` = "YYYY-MM-DD" apa adanya dari <input type="date">, inklusif, boleh sendirian.
  // View-local seperti filter SPEC-178 — tak diangkat ke App.
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
  const projOptions = projects || [...new Set(backlog.map((s) => s.projectId))].map((id) => ({ id, name: id }));
  // SPEC-198 · search/filter/paginasi via API. Seed dari prop `backlog` (App tetap memuat set
  // penuh utk Overview/board/poll) → render instan + tahan mock parsial di test; lalu refetch
  // potongan terfilter/terpaginasi dari server. Board minta set terfilter penuh (tanpa page).
  const [data, setData] = React.useState<{ items: Spec[]; total: number }>(
    () => ({ items: backlog, total: backlog.length }));
  // Yang dipulihkan `page`, BUKAN `limit` — `limit` tanpa `page` berperilaku sebagai
  // PLAFON (SPEC-523 · ADR-0107). `pageSize` tetap prop konstanta.
  const [page, setPage] = usePersistedState("backlog", "page", 1, isNum);
  // Di-seed dari `q` yang DIPULIHKAN, bukan dari string kosong: `dq` yang menyusul 250 ms
  // kemudian akan terbaca sebagai pergantian penyaring dan menghapus halaman tersimpan — dan
  // sebelum itu layar sempat menampilkan hasil TANPA filter yang sedang menyala.
  const [dq, setDq] = React.useState(() => q.trim());
  // SPEC-857 · ADR-0131 · kegagalan refetch dulu ditelan `.catch(() => { })`: `data` bertahan pada
  // nilai terakhir yang BERHASIL dan layar menyajikan jumlah basi seolah itu kebenaran, tanpa satu
  // pun tanda. Itulah bentuk keluhan "backlog saya berkurang" — hub yang tercekik `P1008 Socket
  // timeout` (change-feed tak berbatas, ADR-0131) membuat sebagian refetch gagal dan sisanya lolos,
  // jadi angkanya berubah-ubah sementara DB-nya sendiri tak pernah kehilangan satu baris pun.
  const [stale, setStale] = React.useState(false);
  // Refetch ikut tiap `dataVersion` (tiap frame siar WS), jadi toast digerbangi TRANSISI
  // sehat→gagal lewat ref — bukan setiap kegagalan, yang akan jadi hujan toast saat hub sakit.
  const staleRef = React.useRef(false);
  // Filter yang dipulihkan wajib TERLIHAT menyala: daftar yang tampak kosong tak boleh
  // terbaca sebagai backlog kosong.
  const activeFilters = [
    tab !== "all", proj !== "all", q.trim() !== "", stageFilter !== "all",
    prioFilter !== "all", from !== "", to !== "",
  ].filter(Boolean).length;
  // Scroll dipulihkan sesudah potongan pertama dari server mendarat — sebelum itu tinggi
  // daftar belum final dan posisinya meleset.
  const listRef = useScrollRestore("backlog", "scroll", data.items.length > 0);
  // `proj` dimiliki App (SPEC-146) sehingga di luar jangkauan resetUiState("backlog").
  const resetView = () => setProj("all");
  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useResetOnChange(
    JSON.stringify([tab, proj, stageFilter, prioFilter, dq, view, dateField, from, to]),
    () => setPage(1));
  React.useEffect(() => {
    let alive = true;
    // sentinel "all" → undefined di call-site; server yang menyaring/memotong.
    const p = api.listSpecs?.({
      project: proj === "all" ? undefined : proj,
      source: tab === "all" ? undefined : tab,
      q: dq || undefined,
      stage: stageFilter === "all" ? undefined : stageFilter,
      priority: prioFilter === "all" ? undefined : prioFilter,
      // Kirim sumbu HANYA saat rentangnya aktif — tanpa itu `dateField` jadi kebisingan di
      // setiap request dan test kontrak param lama ikut goyah.
      dateField: from || to ? dateField : undefined,
      from: from || undefined,
      to: to || undefined,
      page: view === "board" ? undefined : page,
      limit: view === "board" ? undefined : pageSize,
    });
    p?.then((r) => {
      if (!alive) return;
      setData({ items: r.items, total: r.total });
      staleRef.current = false;
      setStale(false);
    }).catch(() => {
      if (!alive) return;
      if (!staleRef.current) {
        staleRef.current = true;
        onToast?.("Gagal menyegarkan backlog — jumlah & daftar di layar mungkin basi", "warn");
      }
      setStale(true);
    });
    return () => { alive = false; };
  }, [tab, proj, stageFilter, prioFilter, dq, view, page, pageSize, dataVersion, syncNonce, dateField, from, to]);
  const backlogById = React.useMemo(() => new Map(backlog.map((s) => [s.id, s])), [backlog]);
  const items = React.useMemo(
    () => data.items.map((s) => backlogById.get(s.id) ?? s),
    [data.items, backlogById],
  );
  const sp = serverPage(data.total, page, pageSize);
  return (
    <div style={LIST_SCREEN_STYLE}>
      <div className="hn-backlog-controls" role="region" aria-label="Kontrol backlog" style={{ ...FIXED_ROW_STYLE, marginBottom: 18 }}>
        <div className="hn-backlog-topline" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <Tabs aria-label="Sumber backlog" variant="pill" value={tab} onChange={setTab} tabs={[
            { value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" },
            { value: "qa", label: "Dari QA" }, { value: "audit", label: "Audit" },
            // SPEC-521 · ADR-0089 · backlog goal punya alur sendiri (dua fase, tanpa perencanaan),
            // jadi ia butuh pintunya sendiri — tanpa tab ini item goal hanya muncul tercampur di
            // "Semua spec". `tab` menyeberang apa adanya sebagai `source` ke GET /specs.
            { value: "goal", label: "Goal" },
            // SPEC-546 · ADR-0109 · `help` kini tujuan konversi yang sah, jadi ia butuh pintunya
            // sendiri — tanpa tab ini item Help Center hanya muncul tercampur di "Semua spec".
            { value: "help", label: "Help Center" },
            // SPEC-825 · ADR-0123 · item no_effort punya alur sendiri (satu fase), jadi ia butuh
            // pintunya sendiri — tanpa tab ini ia hanya muncul tercampur di "Semua spec".
            { value: "no_effort", label: "Tanpa effort" },
          ]} />
          <div className="hn-backlog-view-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Tabs variant="pill" value={view} onChange={setView} tabs={VIEWS} aria-label="Mode tampilan" />
            <SyncButton onDone={() => setSyncNonce((n) => n + 1)} onToast={onToast ?? (() => {})} />
            <ResetViewButton screen="backlog" active={activeFilters} onReset={resetView} />
            {/* SPEC-857 · ADR-0131 · saat refetch gagal, jumlah ini TIDAK boleh tampil sebagai
                kebenaran — operator harus tahu ia sedang membaca nilai basi, bukan backlog yang
                menyusut. `role="status"` supaya perubahannya juga terdengar pembaca layar. */}
            <span className="hn-eyebrow" role="status"
              style={stale ? { color: "var(--amber-600)" } : undefined}
              title={stale ? "Server tak menjawab saat menyegarkan — angka ini dari muatan terakhir yang berhasil" : undefined}>
              {data.total} spec{stale ? " · basi" : ""}
            </span>
          </div>
        </div>
        {/* SPEC-178 · baris penyaring: search + project + stage + prioritas. */}
        <div className="hn-backlog-filters" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Input size="sm" leftIcon="search" placeholder="mis. invoice atau SPEC-412" aria-label="Cari backlog"
            value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} style={{ flex: "1 1 220px" }} />
          <Select size="sm" aria-label="Filter project" value={proj} onChange={(e) => setProj(e.target.value)}
            options={[{ value: "all", label: "Semua project" }].concat(projOptions.map((p) => ({ value: p.id, label: p.name })))} />
          <Select size="sm" aria-label="Filter stage" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
            options={[{ value: "all", label: "Semua stage" }].concat(B_STAGES.map((s) => ({ value: s.key, label: s.label })))} />
          <Select size="sm" aria-label="Filter prioritas" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)}
            options={[
              { value: "all", label: "Semua prioritas" }, { value: "tinggi", label: "Tinggi" },
              { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" },
            ]} />
          {/* SPEC-408 · ADR-0090 · rentang tanggal: satu sumbu + dua batas inklusif. DS `Input`
              meneruskan ...rest ke <input>, jadi type="date" jalan tanpa mengubah design system. */}
          <Select size="sm" aria-label="Filter tanggal berdasarkan" value={dateField}
            onChange={(e) => setDateField(e.target.value as "created" | "started")}
            options={[{ value: "created", label: "Dibuat" }, { value: "started", label: "Dikerjakan" }]} />
          <Input size="sm" type="date" aria-label="Tanggal dari" value={from}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)}
            style={{ flex: "0 0 auto" }} />
          <span className="hn-eyebrow" aria-hidden="true">→</span>
          <Input size="sm" type="date" aria-label="Tanggal sampai" value={to}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)}
            style={{ flex: "0 0 auto" }} />
        </div>
      </div>
      {data.total === 0 ? (
        backlog.length === 0
          ? <StateBlock kind="empty" illustration="PST-002" title="Backlog masih kosong"
            hint="Filekan feature brief atau QA finding — hanoman menjalankannya dari brainstorm sampai execute."
            action={onNew} actionLabel="Tambah spec" />
          : <StateBlock kind="empty" icon="filter" title="Tidak ada spec untuk filter ini"
            hint={`${backlog.length} spec ada di backlog, tapi tak ada yang cocok dengan filter aktif.`}
            action={() => { setTab("all"); setProj("all"); setQ(""); setStageFilter("all"); setPrioFilter("all"); setDateField("created"); setFrom(""); setTo(""); }} actionLabel="Reset filter" actionIcon="rotate-ccw" />
      ) : view === "board" ? (
        // Board tak dipaginasi: minta set terfilter penuh dari server (fetch tanpa page/limit).
        <Board specs={items} activeSpecs={activeSpecs} presenceBySpec={presenceBySpec} onMarkDone={onMarkDone}
          onStart={onStart} onOpenRun={onOpenRun} onOpenReview={onOpenReview} onOpenDetail={(x) => setDetailId(x.id)} />
      ) : (
        <>
          {view === "list" ? (
            // overflowX, bukan `overflow` — `overflow: hidden` akan menimpa overflowY dari spread.
            <div ref={listRef} data-testid="backlog-scroll" className="hn-backlog-list" style={{
              ...LIST_SCROLL_STYLE, border: "1px solid var(--border-hair)",
              borderRadius: "var(--radius-lg)", overflowX: "hidden"
            }}>
              {items.map((s) => <SpecRow key={s.id} spec={s} onStart={onStart}
                running={activeSpecs?.has(s.id)} presenceOn={presenceBySpec?.get(s.id)} onDelete={onDelete} onOpenRun={onOpenRun}
                onOpenReview={onOpenReview} onMarkDone={onMarkDone}
                onOpenDetail={(x) => setDetailId(x.id)} />)}
            </div>
          ) : (
            <div ref={listRef} data-testid="backlog-scroll" className="hn-backlog-grid" style={{
              ...LIST_SCROLL_STYLE, display: "grid", gap: 12,
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))"
            }}>
              {items.map((s) => <SpecCard key={s.id} spec={s} onStart={onStart}
                running={activeSpecs?.has(s.id)} presenceOn={presenceBySpec?.get(s.id)} onDelete={onDelete} onOpenRun={onOpenRun}
                onOpenReview={onOpenReview} onMarkDone={onMarkDone}
                onOpenDetail={(x) => setDetailId(x.id)} />)}
            </div>
          )}
          <div style={{ ...FIXED_ROW_STYLE, marginTop: 14, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <Pager page={sp.page} pageCount={sp.pageCount} total={data.total} from={sp.from} to={sp.to} onPage={setPage} unit="spec" />
          </div>
        </>
      )}
      <SpecDetail spec={backlog.find((s) => s.id === detailId) || null} onClose={() => setDetailId(null)}
        onEditBranch={onEditBranch} onRevertStage={onRevertStage} onMarkDone={onMarkDone} onOpenReview={onOpenReview} onStart={onStart} onIntegrate={onIntegrate} onEditSpec={onEditSpec} onPromoteToQa={onPromoteToQa}
        onPromoteToBrief={onPromoteToBrief} onPromoteToPrd={onPromoteToPrd}
        onEditDeps={onEditDeps} onEditAutoMerge={onEditAutoMerge} onChangeSource={onChangeSource}
        projectPolicy={(projects.find((x) => x.id === backlog.find((s) => s.id === detailId)?.projectId) as { autoMerge?: unknown } | undefined)?.autoMerge}
        allSpecs={backlog}
        onAttachmentToast={(m, tone) => onToast?.(m, tone ?? "ok", "paperclip")} />
    </div>
  );
}
