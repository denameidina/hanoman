/* CustomAgentsPanel — katalog custom agent (SPEC-450 · ADR-0094). SATU komponen untuk DUA
   permukaan: Skills › Agen dan Settings (`projectId={null}` → agen global) serta Pengaturan project
   di detail Projects (`projectId="<id>"` → himpunan EFEKTIF, agen global tampil read-only bertanda
   "warisan global" supaya tak ada pertanyaan "lalu yang global mana").

   Yang penting ditampilkan apa adanya: kolom Tools merender HASIL RESOLUSI (`resolveTools`),
   bukan ketikan operator — jadi pencabutan `Task` untuk agen daun TERLIHAT, bukan tersembunyi.
   Itu lapis 2 anti-loop, dan lapis yang tak terlihat adalah lapis yang dikira tak ada.

   Redesign 3K: form agen jadi modal dengan tiga tab (Dasar · Tools & Mention · Lanjutan); jumlah
   galat per tab tampil sebagai angka di tab, sehingga field yang salah tak tersembunyi. Kartu
   memuat paling banyak tiga aksi (Ubah, aktif/nonaktif, ⋯ berisi Hapus). Bukti penggunaan dan
   sampel invocation ada di lipatan "Bukti". */
import React from "react";
import { useModelCatalog } from "../api/model-catalog";
import { Button, Badge, Input, Switch, MultiSelect, Select, Field, HnTextarea, StateBlock, Callout, Modal,
  OverflowActions, Tabs, TabPanel, useConfirm } from "../ds";
import { api, ApiError } from "../api/client";
import { failureMessage } from "../lib/report-error";
import { CustomAgentMetrics } from "./CustomAgentMetrics";
import {
  AGENT_NAME_RE, DEFAULT_AGENT_TOOLS, ALL_TOOLS, resolveTools, modelsForRuntime,
  effortsForRuntimeModel,
  type CustomAgentView, type AgentCatalogView, type AgentRuntime, type AgentMetricsView,
  type AgentDisposition, type AgentEffort,
} from "@hanoman/shared";
import "./styles/skills.css";
import "./styles/projects.css";

// SPEC-484 · ADR-0101 · tools/model/mention/runtime memakai KONTROL PILIHAN bersumber API. Ketikan
// bebas untuk ketiganya adalah kelas kegagalan yang sudah diukur ADR-0094 M4.
type Draft = {
  name: string; description: string; instructions: string;
  tools: string[]; model: string; mentions: string[]; runtime: string; enabled: boolean;
  activation: string; effort: string; workspacePolicy: string;
  maxTurns: string; timeoutSeconds: string;
};

type ModalTab = "dasar" | "tools" | "lanjutan";

const emptyDraft = (): Draft => ({
  name: "", description: "", instructions: "", tools: [], model: "", mentions: [],
  runtime: "", enabled: true, activation: "always", effort: "", workspacePolicy: "inherit",
  maxTurns: "", timeoutSeconds: "",
});

const draftOf = (a: CustomAgentView): Draft => ({
  name: a.name, description: a.description, instructions: a.instructions,
  tools: a.tools ?? [], model: a.model ?? "",
  mentions: a.mentions, runtime: a.runtime ?? "", enabled: a.enabled,
  activation: a.activation ?? "always", effort: a.effort ?? "",
  workspacePolicy: a.workspacePolicy ?? "inherit",
  maxTurns: a.maxTurns == null ? "" : String(a.maxTurns),
  timeoutSeconds: a.timeoutSeconds == null ? "" : String(a.timeoutSeconds),
});

const optionalIntValid = (value: string, min: number, max: number): boolean =>
  value === "" || (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max);

/**
 * Terjemahkan penolakan server jadi kalimat yang bisa ditindaklanjuti. 409 bersiklus membawa
 * jalurnya (`cycle`) dan scope mana yang pecah — tanpa itu operator cuma melihat "409".
 */
function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return (e as Error)?.message ?? "gagal";
  const d = (e.detail ?? {}) as {
    error?: unknown; cycle?: string[]; scope?: string; unknown?: string[];
    unknownTools?: string[]; model?: string; runtime?: string | null;
  };
  if (Array.isArray(d.cycle) && d.cycle.length) {
    return `Mention membentuk siklus di scope ${d.scope ?? "?"}: ${d.cycle.join(" → ")}`;
  }
  if (Array.isArray(d.unknown) && d.unknown.length) {
    return `Mention tak dikenal: ${d.unknown.join(", ")}`;
  }
  // SPEC-484 · penolakan katalog membawa nilainya — "400" saja tak bisa ditindaklanjuti.
  if (Array.isArray(d.unknownTools) && d.unknownTools.length) {
    return `Tool tak dikenal di mesin ini: ${d.unknownTools.join(", ")}`;
  }
  if (typeof d.model === "string") {
    return `Model "${d.model}" tak tersedia untuk runtime ${d.runtime ?? "warisi"}.`;
  }
  if (typeof d.error === "string") return d.error;
  return `Gagal (${e.status})`;
}

const failed = (action: string, e: unknown): string => failureMessage(action, new Error(errorText(e)));

const NAME_ERROR = "Nama tidak sah: pakai huruf kecil, angka, dan tanda hubung; minimal 2 karakter.";

/** Atribut ARIA yang mengikat kontrol ke pesan galatnya; kosong bila field sah. */
const invalidAria = (id: string, message: string | null) =>
  message ? { "aria-invalid": true as const, "aria-describedby": id } : {};

/** Hint field + pesan galat terlihat di bawahnya (ditunjuk `aria-describedby` kontrolnya). */
const hintWithError = (hint: React.ReactNode, id: string, message: string | null) => (
  <>
    {hint}
    {message && <span id={id} role="alert" className="hn-agent-error">{message}</span>}
  </>
);

const stamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("id-ID") : "—");

export type CustomAgentsPanelProps = {
  projectId: string | null;
  runtime?: AgentRuntime;
  onToast?: (msg: string, kind?: string, icon?: string) => void;
};

export function CustomAgentsPanel({ projectId, runtime: sessionRuntime, onToast }: CustomAgentsPanelProps) {
  const [rows, setRows] = React.useState<CustomAgentView[] | null>(null);
  const [catalog, setCatalog] = React.useState<AgentCatalogView | null>(null);
  const [metrics, setMetrics] = React.useState<AgentMetricsView | null>(null);
  const [reviews, setReviews] = React.useState<Record<string, {
    disposition: string; note: string; reworkRequired?: boolean | null;
  }>>({});
  const [metricsError, setMetricsError] = React.useState(false);
  const [err, setErr] = React.useState<string>("");
  const [editing, setEditing] = React.useState<{ id: string | null; draft: Draft } | null>(null);
  const [modalTab, setModalTab] = React.useState<ModalTab>("dasar");
  const [busy, setBusy] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const { confirm, dialog } = useConfirm();
  const fieldId = React.useId();

  const load = React.useCallback(async () => {
    let nextRows: CustomAgentView[] | null = null;
    let nextCatalog: AgentCatalogView = { tools: [], models: [], runtimes: [] };
    let nextMetrics: AgentMetricsView | null = null;
    setMetricsError(false); setLoadError("");
    try { nextRows = await api.listCustomAgents(projectId ?? undefined, sessionRuntime); }
    catch (e) { setLoadError(failed("memuat daftar agen", e)); }
    // Katalog gagal dimuat TIDAK boleh menyembunyikan daftar agen: ia jatuh ke katalog kosong, dan
    // setiap nilai tersimpan lalu tampil sebagai chip bertanda — terlihat, bukan hilang senyap.
    try { nextCatalog = await api.getCustomAgentCatalog(projectId ?? undefined); }
    catch { /* katalog kosong tetap menampilkan nilai tersimpan sebagai invalid */ }
    try {
      nextMetrics = await api.getCustomAgentMetrics({
        projectId: projectId ?? undefined,
        from: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
      });
    } catch { setMetricsError(true); }
    setCatalog(nextCatalog); setMetrics(nextMetrics);
    if (nextRows) setRows(nextRows);
  }, [projectId, sessionRuntime]);

  const reloadMetrics = React.useCallback(async () => {
    try {
      setMetrics(await api.getCustomAgentMetrics({
        projectId: projectId ?? undefined,
        from: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
      }));
      setMetricsError(false);
    } catch { setMetricsError(true); }
  }, [projectId]);

  React.useEffect(() => { void load(); }, [load]);

  // Agen yang boleh disebut dari draft ini: semua yang terlihat, kecuali dirinya sendiri.
  const mentionable = (rows ?? []).filter((a) => a.name !== editing?.draft.name);
  const nameValid = !editing?.draft.name || AGENT_NAME_RE.test(editing.draft.name);

  // Runtime menyetir daftar model: `null` (warisi) = gabungan kedua katalog, cermin server.
  const runtime = (editing?.draft.runtime || null) as AgentRuntime | null;
  const catalogToolIds = (catalog?.tools ?? []).map((t) => t.id);
  const toolOptions = (catalog?.tools ?? []).map((t) => ({
    value: t.id, label: t.label, ...(t.group === "mcp" ? { group: "MCP" } : {}),
  }));
  useModelCatalog();
  const modelOptions = modelsForRuntime(runtime)
    .map((m) => ({ value: m.id, label: runtime ? m.label : `${m.label} · ${m.runtime}` }));
  const mentionOptions = mentionable.map((m) => ({ value: m.name, label: m.name }));
  const invalidTools = (editing?.draft.tools ?? []).filter((t) => !catalogToolIds.includes(t));
  const invalidMentions = (editing?.draft.mentions ?? [])
    .filter((m) => !mentionOptions.some((o) => o.value === m));
  const modelInvalid = Boolean(editing?.draft.model)
    && !modelOptions.some((o) => o.value === editing!.draft.model);
  const effortOptions = effortsForRuntimeModel(runtime, editing?.draft.model || null);
  const effortInvalid = Boolean(editing?.draft.effort)
    && !effortOptions.includes(editing!.draft.effort as never);
  // Validasi server KERAS (ADR-0101 keputusan 5): nilai lama yang tak lagi ada di katalog TETAP
  // terbaca, tapi tak bisa disimpan ulang apa adanya.
  const profileInvalid = editing ? (
    !optionalIntValid(editing.draft.maxTurns, 1, 200)
    || !optionalIntValid(editing.draft.timeoutSeconds, 30, 3_600)
    || (editing.draft.runtime === "antigravity" && editing.draft.workspacePolicy === "read-only")
    || (editing.draft.workspacePolicy === "isolated-worktree"
      && editing.draft.runtime !== "claude")
  ) : false;
  const blocked = invalidTools.length > 0 || invalidMentions.length > 0
    || modelInvalid || effortInvalid || profileInvalid;
  const draftNow = editing?.draft;
  const errors = {
    name: nameValid ? null : NAME_ERROR,
    model: modelInvalid ? `Model "${draftNow?.model}" tak ada di katalog untuk runtime ini.` : null,
    effort: effortInvalid ? `Effort "${draftNow?.effort}" tak didukung oleh model ini.` : null,
    maxTurns: draftNow && !optionalIntValid(draftNow.maxTurns, 1, 200) ? "Isi bilangan bulat 1–200, atau kosongkan." : null,
    timeoutSeconds: draftNow && !optionalIntValid(draftNow.timeoutSeconds, 30, 3_600) ? "Isi bilangan bulat 30–3600, atau kosongkan." : null,
    workspacePolicy: draftNow?.runtime === "antigravity" && draftNow.workspacePolicy === "read-only"
      ? "Read-only enforced belum tersedia untuk Antigravity; ubah kebijakan secara eksplisit."
      : draftNow?.workspacePolicy === "isolated-worktree" && draftNow.runtime !== "claude"
      ? "Worktree terisolasi hanya tersedia untuk runtime Claude; pilih runtime Claude atau ganti kebijakan." : null,
  };
  const errorId = (field: keyof typeof errors) => `${fieldId}-${field}`;
  // Jumlah galat per tab: tampil sebagai angka di tab, supaya field yang salah tak tersembunyi.
  const tabErrors: Record<ModalTab, number> = {
    dasar: (errors.name ? 1 : 0) + (errors.model ? 1 : 0),
    tools: invalidTools.length + invalidMentions.length,
    lanjutan: [errors.effort, errors.maxTurns, errors.timeoutSeconds, errors.workspacePolicy].filter(Boolean).length,
  };
  const openEditor = (next: { id: string | null; draft: Draft }) => { setErr(""); setModalTab("dasar"); setEditing(next); };
  const closeEditor = () => { setEditing(null); setErr(""); };

  /** `*` dan nama eksplisit saling meniadakan — cermin aturan server, ditegakkan di kontrol. */
  const setTools = (next: string[]) => {
    if (!editing) return;
    const justAddedAll = next.includes(ALL_TOOLS) && !editing.draft.tools.includes(ALL_TOOLS);
    const clean = justAddedAll ? [ALL_TOOLS] : next.filter((t) => t !== ALL_TOOLS);
    setEditing({ ...editing, draft: { ...editing.draft, tools: clean } });
  };

  /** Menukar runtime yang membuat model terpilih tak sah MENGOSONGKANNYA — bukan mengirim 400. */
  const setRuntime = (next: string) => {
    if (!editing) return;
    const allowed = modelsForRuntime((next || null) as AgentRuntime | null).map((m) => m.id);
    const model = allowed.includes(editing.draft.model) ? editing.draft.model : "";
    const workspacePolicy = next === "codex" && editing.draft.workspacePolicy === "isolated-worktree"
      ? "inherit" : editing.draft.workspacePolicy;
    const effort = effortsForRuntimeModel((next || null) as AgentRuntime | null, model || null)
      .includes(editing.draft.effort as never) ? editing.draft.effort : "";
    setEditing({ ...editing, draft: {
      ...editing.draft, runtime: next, model, effort, workspacePolicy,
    } });
  };

  const setModel = (model: string) => {
    if (!editing) return;
    const effort = effortsForRuntimeModel(runtime, model || null).includes(editing.draft.effort as never)
      ? editing.draft.effort : "";
    setEditing({ ...editing, draft: { ...editing.draft, model, effort } });
  };

  async function save() {
    if (!editing) return;
    const d = editing.draft;
    setBusy(true); setErr("");
    try {
      const payload = {
        description: d.description, instructions: d.instructions,
        // Kosong → `null` = pakai DEFAULT_AGENT_TOOLS (bukan `[]`, yang berarti TANPA tool).
        tools: d.tools.length ? d.tools : null, model: d.model || null,
        mentions: d.mentions, runtime: (d.runtime || null) as AgentRuntime | null,
        enabled: d.enabled, activation: d.activation as "always" | "smart",
        effort: (d.effort || null) as AgentEffort | null,
        workspacePolicy: d.workspacePolicy as "inherit" | "read-only" | "isolated-worktree",
        maxTurns: d.maxTurns === "" ? null : Number(d.maxTurns),
        timeoutSeconds: d.timeoutSeconds === "" ? null : Number(d.timeoutSeconds),
      };
      if (editing.id) await api.updateCustomAgent(editing.id, payload);
      else await api.createCustomAgent({ ...payload, name: d.name, projectId });
      setEditing(null);
      await load();
      onToast?.(editing.id ? "Agen diperbarui" : "Agen dibuat", "ok");
    } catch (e) { setErr(failed("menyimpan agen", e)); }
    finally { setBusy(false); }
  }

  async function toggleEnabled(a: CustomAgentView, on: boolean) {
    setErr("");
    try { await api.updateCustomAgent(a.id, { enabled: on }); await load(); }
    catch (e) { setErr(failed(on ? "mengaktifkan agen" : "menonaktifkan agen", e)); }
  }

  async function remove(a: CustomAgentView) {
    setErr("");
    const mentionedBy = (rows ?? []).filter((r) => r.id !== a.id && r.mentions.includes(a.name)).map((r) => r.name);
    try {
      const deleted = await confirm({
        title: `Hapus agen ${a.name}?`, eyebrow: projectId ? "agen project" : "agen global", tone: "danger",
        message: a.description || undefined, confirmLabel: "Hapus agen", cancelLabel: "Batal",
        impact: [
          "Definisi agen dihapus permanen dan tak bisa dipulihkan dari sini.",
          mentionedBy.length
            ? `Agen yang menyebutnya di Mention akan menunjuk agen yang tak ada: ${mentionedBy.join(", ")}.`
            : "Tak ada agen lain yang menyebutnya di Mention.",
        ],
        run: () => api.deleteCustomAgent(a.id),
      });
      if (!deleted) return;
      await load();
      onToast?.("Agen dihapus", "ok");
    } catch (e) { setErr(failed("menghapus agen", e)); }
  }

  async function judge(id: string) {
    const review = reviews[id];
    if (!review?.disposition) return;
    setBusy(true); setErr("");
    try {
      await api.updateAgentInvocationDisposition(id, {
        disposition: review.disposition as Exclude<AgentDisposition, "pending">,
        note: review.note,
        ...(review.reworkRequired !== undefined ? { reworkRequired: review.reworkRequired } : {}),
      });
      await reloadMetrics();
      onToast?.("Penilaian invocation disimpan", "ok");
    } catch (e) { setErr(failed("menyimpan penilaian invocation", e)); }
    finally { setBusy(false); }
  }

  if (rows === null && loadError) {
    return <StateBlock kind="error" title="Gagal memuat custom agent" hint={loadError}
      action={() => void load()} actionLabel="Coba lagi" />;
  }
  if (rows === null) return <StateBlock kind="loading" title="Memuat custom agent…" />;

  // Bukti tingkat panel: catatan telemetri & peringatan. Galat muat bukti TETAP terlihat di luar lipatan.
  const telemetryNotes = (
    <>
      {!metricsError && metrics && metrics.agents.length === 0 && <Callout tone="info">
        Belum ada bukti invocation dalam periode ini. Ini tidak membuktikan agent belum pernah dipakai;
        pengiriman event dapat tidak tercatat.
      </Callout>}
      {!metricsError && metrics?.telemetry?.state === "observed" && <p className="hn-agent-note">
        Event terakhir tercatat: {stamp(metrics.telemetry.lastEventAt)}
        {` · ${metrics.telemetry.incompleteCount} invocation belum memiliki bukti lengkap.`}
        {" Catatan ini tidak menjamin seluruh event berhasil dikirim."}
      </p>}
      {metrics?.telemetry?.relay && <p className="hn-agent-note">
        Pengiriman event: {metrics.telemetry.relay.state === "unobserved" ? "belum diperiksa"
          : metrics.telemetry.relay.state === "degraded" ? "terganggu" : "antrean dapat diproses"}
        {` · ${metrics.telemetry.relay.retryPending} pengiriman ditunda pada pemeriksaan terakhir`}
        {` · ${metrics.telemetry.relay.droppedEvents} event ditolak sejak server menyala`}
        {metrics.telemetry.relay.lastIssueAt && ` · kendala terakhir ${stamp(metrics.telemetry.relay.lastIssueAt)}`}
      </p>}
    </>
  );

  return (
    <div className="hn-agents">
      <div className="hn-agents-head">
        <p className="hn-agents-scope">
          {projectId
            ? "Agen project ini, ditambah agen global yang berlaku di sini. Agen project menimpa agen global bernama sama."
            : "Agen global — tersedia di semua project. Satu project bisa menimpanya dengan agen bernama sama."}
        </p>
        <Button size="sm" leftIcon="plus" onClick={() => openEditor({ id: null, draft: emptyDraft() })}>
          Agen baru
        </Button>
      </div>

      {err && !editing && <Callout tone="err">{err}</Callout>}
      {loadError && <Callout tone="err">
        {loadError}
        <Button size="sm" variant="ghost" onClick={() => void load()}>Coba lagi</Button>
      </Callout>}
      {metricsError && <Callout tone="warn">
        Bukti penggunaan gagal dimuat. Angka yang masih terlihat berasal dari pemuatan sebelumnya.
        <Button size="sm" variant="ghost" onClick={() => void reloadMetrics()}>Muat ulang bukti</Button>
      </Callout>}
      {(metrics || metricsError) && (
        <details className="hn-agent-evidence">
          <summary className="hn-agent-evidence-summary">Bukti penggunaan</summary>
          <div className="hn-agent-evidence-body">{telemetryNotes}</div>
        </details>
      )}

      {rows.length === 0 && !loadError && (
        <StateBlock kind="empty" compact title="Belum ada custom agent"
          hint="Custom agent adalah persona yang bisa dipilih sesi Claude, Codex & Antigravity — misalnya peninjau keamanan atau penulis migration." />
      )}

      {rows.map((a) => {
        // `*` ikut ter-expand secara TAMPILAN: kartu harus memperlihatkan apa yang benar-benar
        // diterima agen, bukan pintasannya (cermin ekspansi di `agentDefsFor`).
        const shownTools = (a.tools ?? []).includes(ALL_TOOLS)
          ? (catalog?.tools ?? []).map((t) => t.id).filter((id) => id !== ALL_TOOLS)
          : a.tools;
        const tools = resolveTools({ tools: shownTools, mentions: a.mentions });
        const readOnly = Boolean(projectId && a.inherited);
        const recent = metrics?.samples
          ? metrics.samples.filter((entry) => entry.agentName === a.name)
          : (metrics?.recent ?? []).filter((entry) => entry.agentName === a.name).slice(0, 5);
        // Maks dua lencana per kartu: asal (bawaan/warisan) dan status bila perlu perhatian.
        const origin = readOnly ? "warisan global" : a.builtin ? (a.builtinEdited ? "bawaan · disunting" : "bawaan") : null;
        const status = !a.enabled ? "nonaktif" : a.available === false ? "tidak tersedia" : null;
        return (
          <article key={a.id} className="hn-agent-card" aria-label={`Agen ${a.name}`}>
            <div className="hn-agent-head">
              <span className="hn-agent-name">{a.name}</span>
              {origin && <Badge tone="neutral" size="sm" data-testid={a.builtin ? `builtin-${a.name}` : undefined}>{origin}</Badge>}
              {status && <Badge tone="warn" size="sm">{status}</Badge>}
              <span className="hn-grow" />
              <Switch checked={a.enabled} disabled={readOnly} aria-label={`Aktifkan ${a.name}`}
                onChange={(on) => void toggleEnabled(a, on)} />
              <Button size="sm" variant="ghost" disabled={readOnly}
                onClick={() => openEditor({ id: a.id, draft: draftOf(a) })}>Ubah</Button>
              <OverflowActions label={`Aksi untuk agen ${a.name}`} icon="ellipsis" items={[
                { key: "delete", label: "Hapus agen…", icon: "trash-2", tone: "danger",
                  disabled: readOnly || a.builtin, onSelect: () => void remove(a) },
              ]} />
            </div>
            {a.description && <p className="hn-agent-desc">{a.description}</p>}
            {a.builtin && (
              <p className="hn-agent-note" id={`${fieldId}-builtin-${a.id}`}>Agen bawaan tak bisa dihapus</p>
            )}
            <dl className="hn-agent-meta">
              {/* HASIL RESOLUSI, bukan ketikan operator: `Task` muncul hanya untuk agen ber-mention,
                  dan dicabut untuk agen daun walau operator mengetiknya (lapis 2 anti-loop). */}
              <div><dt>Tools</dt><dd data-testid={`tools-${a.name}`}>{tools.join(", ")}</dd></div>
              <div><dt>Mention</dt><dd data-testid={`mentions-${a.name}`}>
                {a.mentions.length ? a.mentions.map((m) => `@${m}`).join(", ") : "—"}</dd></div>
              {a.runtime && <div><dt>Runtime</dt><dd data-testid={`runtime-${a.name}`}>{a.runtime}</dd></div>}
              {a.model && <div><dt>Model</dt><dd>{a.model}</dd></div>}
              <div><dt>Aktivasi</dt><dd>{a.activation ?? "always"}</dd></div>
              <div><dt>Workspace</dt><dd>{a.workspacePolicy ?? "inherit"}</dd></div>
              {a.maxTurns != null && <div><dt>Batas kerja</dt><dd>{a.maxTurns} giliran (native Claude; instruksi pada Codex)</dd></div>}
              {a.timeoutSeconds != null && <div><dt>Target waktu</dt><dd>{a.timeoutSeconds} detik (instruksi; tidak menghentikan proses otomatis)</dd></div>}
            </dl>
            {a.selectionReason && <p className="hn-agent-note">{a.selectionReason}</p>}
            {a.activation === "smart" && <p className="hn-agent-note">
              Tersedia sepanjang sesi yang kompatibel. Dipanggil saat tugas, fase, dan perubahan terbaru membutuhkan perannya.
            </p>}
            {a.workspacePolicy === "read-only" && <p className="hn-agent-note">
              Pemeriksaan statis; perintah test dan eksperimen memerlukan lingkungan terisolasi.
            </p>}
            {a.available === false && a.availabilityReason && (
              <Callout tone="warn">{a.availabilityReason}</Callout>
            )}
            <details className="hn-agent-evidence">
              <summary className="hn-agent-evidence-summary">Bukti{recent.length > 0 ? ` · ${recent.length} sampel` : ""}</summary>
              <div className="hn-agent-evidence-body">
                <CustomAgentMetrics name={a.name} metrics={metrics} />
                {recent.length > 0 && (
                  <div className="hn-agent-samples">
                    {recent.map((invocation) => {
                      const review = reviews[invocation.id];
                      const disposition = review?.disposition
                        ?? (invocation.disposition === "pending" ? "" : invocation.disposition);
                      const note = review?.note ?? invocation.dispositionNote ?? "";
                      const rework = review?.reworkRequired !== undefined
                        ? review.reworkRequired : invocation.reworkRequired ?? null;
                      return <div key={invocation.id} className="hn-agent-sample">
                        <div className="hn-agent-sample-meta">
                          {stamp(invocation.startedAt)} · {invocation.runtime}
                          {` · ${invocation.model ?? "model tidak tercatat"} · versi ${invocation.definitionHash?.slice(0, 12) ?? "tidak tercatat"}`}
                          {invocation.resultExcerpt ? ` · ${invocation.resultExcerpt}` : ""}
                        </div>
                        <div className="hn-agent-sample-form">
                          <Select aria-label={`Disposition ${invocation.id}`} value={disposition}
                            options={[
                              { value: "", label: "Pilih disposition" },
                              { value: "accepted", label: "Diterima" },
                              { value: "partial", label: "Parsial" },
                              { value: "rejected", label: "Ditolak" },
                              { value: "false-positive", label: "False-positive" },
                            ]}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setReviews({
                              ...reviews, [invocation.id]: { ...review, disposition: e.target.value, note },
                            })} />
                          <Select aria-label={`Kerja ulang ${invocation.id}`} value={rework === null ? "" : rework ? "yes" : "no"}
                            options={[
                              { value: "", label: "Kerja ulang belum dinilai" },
                              { value: "yes", label: "Perlu kerja ulang" },
                              { value: "no", label: "Tidak perlu kerja ulang" },
                            ]}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setReviews({
                              ...reviews, [invocation.id]: { ...review, disposition, note,
                                reworkRequired: e.target.value === "" ? null : e.target.value === "yes" },
                            })} />
                          <Input aria-label={`Catatan ${invocation.id}`} value={note} maxLength={500}
                            placeholder="mis. perlu cek null di handler"
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReviews({
                              ...reviews, [invocation.id]: { ...review, disposition, note: e.target.value },
                            })} />
                          <Button size="sm" aria-label={`Nilai ${invocation.id}`} loading={busy}
                            disabled={!disposition} onClick={() => void judge(invocation.id)}>Nilai</Button>
                        </div>
                      </div>;
                    })}
                  </div>
                )}
              </div>
            </details>
          </article>
        );
      })}

      {/* Form agen sebagai MODAL dengan tiga tab. Tiap tab tetap di DOM (hidden), jadi isian tak
          hilang saat pindah tab. Galat per tab ditampilkan sebagai angka di tab itu. */}
      {editing && (
        <Modal open onClose={closeEditor}
          icon="bot" eyebrow={projectId ? "agen project" : "agen global"}
          title={editing.id ? `Ubah ${editing.draft.name}` : "Agen baru"} width={640}
          footer={<>
            <Button variant="ghost" onClick={closeEditor}>Batal</Button>
            <Button onClick={() => void save()} loading={busy} disabled={!nameValid || blocked}>Simpan</Button>
          </>}>
          {err && <Callout tone="err">{err}</Callout>}
          <Tabs variant="underline" value={modalTab} onChange={(v) => setModalTab(v as ModalTab)} tabs={[
            { value: "dasar", label: "Dasar", count: tabErrors.dasar || undefined },
            { value: "tools", label: "Tools & Mention", count: tabErrors.tools || undefined },
            { value: "lanjutan", label: "Lanjutan", count: tabErrors.lanjutan || undefined },
          ]}>
            <TabPanel value="dasar">
              <Field label="Nama" hint={hintWithError(editing.id
                ? "Nama tak bisa diubah — hapus lalu buat baru (definisi ini menyeberang lewat sync)."
                : "huruf kecil, angka, dan tanda hubung; minimal 2 karakter", errorId("name"), errors.name)}>
                <Input value={editing.draft.name} aria-label="Nama" disabled={Boolean(editing.id)}
                  invalid={!nameValid} {...invalidAria(errorId("name"), errors.name)}
                  placeholder="mis. peninjau-keamanan" className="hn-prj-full"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
              </Field>
              <Field label="Deskripsi" hint="Kapan agen ini dipakai — inilah yang dibaca agen untuk MEMILIH.">
                <Input value={editing.draft.description} aria-label="Deskripsi" className="hn-prj-full"
                  placeholder="mis. Dipakai saat meninjau perubahan yang menyentuh auth"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEditing({ ...editing, draft: { ...editing.draft, description: e.target.value } })} />
              </Field>
              <Field label="Instruksi" hint="System prompt agen.">
                <HnTextarea value={editing.draft.instructions} aria-label="Instruksi" rows={8}
                  placeholder="mis. Kamu peninjau keamanan. Baca diff, laporkan temuan berurut dari yang paling berbahaya, sebut file:line."
                  onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, instructions: e.target.value } })} />
              </Field>
              <div className="hn-grid-mobile hn-agent-grid2">
                <Field label="Model" hint={hintWithError("Kosongkan untuk mewarisi model sesi.", errorId("model"), errors.model)}>
                  <Select aria-label="Model" value={editing.draft.model || (runtime === "antigravity" ? "inherit" : "")} invalid={modelInvalid}
                    {...invalidAria(errorId("model"), errors.model)}
                    options={[...(runtime === "antigravity" ? [] : [{ value: "", label: "Ikut sesi induk" }]), ...modelOptions,
                      ...(modelInvalid ? [{ value: editing.draft.model, label: `⚠ ${editing.draft.model} — tak ada di katalog` }] : [])]}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setModel(e.target.value)} />
                </Field>
                <Field label="Aktivasi" hint="Smart hanya masuk saat flow dan diff relevan.">
                  <Select aria-label="Aktivasi" value={editing.draft.activation}
                    options={[{ value: "always", label: "Selalu" }, { value: "smart", label: "Smart" }]}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEditing({
                      ...editing, draft: { ...editing.draft, activation: e.target.value },
                    })} />
                </Field>
              </div>
            </TabPanel>

            <TabPanel value="tools">
              <Field label="Tools" hint={`Kosongkan untuk memakai default: ${DEFAULT_AGENT_TOOLS.join(", ")}. Alat delegasi (Task) diatur otomatis dari Mention.`}>
                <MultiSelect aria-label="Tools" options={toolOptions} value={editing.draft.tools}
                  invalidValues={invalidTools} onChange={setTools}
                  placeholder="Pilih tools…" searchPlaceholder="mis. Read atau Bash" />
              </Field>
              <Field label="Mention" hint="Agen yang boleh dipanggil agen ini. Graf mention wajib asiklik — server menolak yang membentuk lingkaran.">
                <MultiSelect aria-label="Mention" options={mentionOptions} value={editing.draft.mentions}
                  invalidValues={invalidMentions}
                  onChange={(mentions: string[]) => setEditing({ ...editing, draft: { ...editing.draft, mentions } })}
                  placeholder="Pilih agen…" searchPlaceholder="mis. peninjau-keamanan"
                  emptyText="Belum ada agen lain." />
              </Field>
            </TabPanel>

            <TabPanel value="lanjutan">
              <Field label="Runtime agent" hint="Mesin sesi yang memakai agen ini. Kosongkan untuk ikut sesi induk.">
                <Select aria-label="Runtime agent" value={editing.draft.runtime}
                  options={[{ value: "", label: "Ikut sesi induk" },
                    ...(catalog?.runtimes ?? []).map((r) => ({ value: r.id, label: r.label }))]}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRuntime(e.target.value)} />
              </Field>
              <Field label="Effort" hint={hintWithError(runtime === "antigravity" ? "Effort child native tidak diketahui; konfigurasi effort independen belum tersedia." : "Kosongkan untuk mewarisi sesi.", errorId("effort"), errors.effort)}>
                <Select aria-label="Effort" disabled={runtime === "antigravity"} value={editing.draft.effort} invalid={effortInvalid}
                  {...invalidAria(errorId("effort"), errors.effort)}
                  options={[{ value: "", label: "Ikut sesi induk" },
                    ...effortOptions.map((effort) => ({ value: effort, label: effort })),
                    ...(effortInvalid
                      ? [{ value: editing.draft.effort, label: `⚠ ${editing.draft.effort} — tak didukung` }]
                      : [])]}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEditing({
                    ...editing, draft: { ...editing.draft, effort: e.target.value },
                  })} />
              </Field>
              <Field label="Kebijakan workspace"
                hint={hintWithError(runtime === "antigravity" ? "Read-only enforced dan worktree terisolasi belum tersedia untuk Antigravity. Profil lama yang tidak kompatibel tidak dipilih." : "Read-only dipagari hook; isolated hanya tersedia untuk Claude.", errorId("workspacePolicy"), errors.workspacePolicy)}>
                <Select aria-label="Kebijakan workspace" value={editing.draft.workspacePolicy}
                  invalid={Boolean(errors.workspacePolicy)} {...invalidAria(errorId("workspacePolicy"), errors.workspacePolicy)}
                  options={[
                    { value: "inherit", label: "Ikut parent" },
                    { value: "read-only", label: "Hanya baca", disabled: runtime === "antigravity" },
                    { value: "isolated-worktree", label: "Worktree terisolasi", disabled: editing.draft.runtime !== "claude" },
                  ]}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEditing({
                    ...editing, draft: { ...editing.draft, workspacePolicy: e.target.value },
                  })} />
              </Field>
              <div className="hn-grid-mobile hn-agent-grid2">
                <Field label="Maksimum giliran" hint={hintWithError("Kosong = warisi; 1–200.", errorId("maxTurns"), errors.maxTurns)}>
                  <Input aria-label="Maksimum giliran" type="number" min={1} max={200} placeholder="mis. 40"
                    invalid={Boolean(errors.maxTurns)} {...invalidAria(errorId("maxTurns"), errors.maxTurns)}
                    value={editing.draft.maxTurns}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({
                      ...editing, draft: { ...editing.draft, maxTurns: e.target.value },
                    })} />
                </Field>
                <Field label="Timeout detik"
                  hint={hintWithError("Kosong = tanpa batas Hanoman; 30–3600.", errorId("timeoutSeconds"), errors.timeoutSeconds)}>
                  <Input aria-label="Timeout detik" type="number" min={30} max={3600} placeholder="mis. 600"
                    invalid={Boolean(errors.timeoutSeconds)} {...invalidAria(errorId("timeoutSeconds"), errors.timeoutSeconds)}
                    value={editing.draft.timeoutSeconds}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({
                      ...editing, draft: { ...editing.draft, timeoutSeconds: e.target.value },
                    })} />
                </Field>
              </div>
            </TabPanel>
          </Tabs>
          {blocked && (
            <Callout tone="warn">
              Ada nilai yang tak ada di katalog mesin ini (ditandai ⚠). Buang dulu sebelum menyimpan —
              server menolak nilai yang tak dikenal.
            </Callout>
          )}
        </Modal>
      )}
      {dialog}
    </div>
  );
}
