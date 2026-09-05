/* CustomAgentsPanel — katalog custom agent (SPEC-450 · ADR-0094). SATU komponen untuk DUA
   permukaan: Settings (`projectId={null}` → agen global) dan Project detail (`projectId="<id>"`
   → himpunan EFEKTIF, agen global tampil read-only bertanda "warisan global" supaya tak ada
   pertanyaan "lalu yang global mana").

   Yang penting ditampilkan apa adanya: kolom Tools merender HASIL RESOLUSI (`resolveTools`),
   bukan ketikan operator — jadi pencabutan `Task` untuk agen daun TERLIHAT, bukan tersembunyi.
   Itu lapis 2 anti-loop, dan lapis yang tak terlihat adalah lapis yang dikira tak ada. */
import React from "react";
import { useModelCatalog } from "../api/model-catalog";
import { Card, Button, Badge, Input, Switch, MultiSelect, Select, Field, HnTextarea, StateBlock, Callout, Modal } from "../ds";
import { api, ApiError } from "../api/client";
import { CustomAgentMetrics } from "./CustomAgentMetrics";
import {
  AGENT_NAME_RE, DEFAULT_AGENT_TOOLS, ALL_TOOLS, resolveTools, modelsForRuntime,
  effortsForRuntimeModel,
  type CustomAgentView, type AgentCatalogView, type AgentRuntime, type AgentMetricsView,
  type AgentDisposition, type AgentEffort,
} from "@hanoman/shared";

// SPEC-484 · ADR-0101 · tools/model/mention/runtime memakai KONTROL PILIHAN bersumber API. Ketikan
// bebas untuk ketiganya adalah kelas kegagalan yang sudah diukur ADR-0094 M4: nama tool tak dikenal
// DIBUANG claude tanpa satu pun pesan, jadi salah ketik baru terbaca saat agen sudah berjalan.
type Draft = {
  name: string; description: string; instructions: string;
  tools: string[]; model: string; mentions: string[]; runtime: string; enabled: boolean;
  activation: string; effort: string; workspacePolicy: string;
  maxTurns: string; timeoutSeconds: string;
};

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
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    let nextRows: CustomAgentView[] = [];
    let nextCatalog: AgentCatalogView = { tools: [], models: [], runtimes: [] };
    let nextMetrics: AgentMetricsView | null = null;
    setMetricsError(false);
    try { nextRows = await api.listCustomAgents(projectId ?? undefined, sessionRuntime); }
    catch (e) { setErr(errorText(e)); }
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
    setCatalog(nextCatalog); setMetrics(nextMetrics); setRows(nextRows);
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
  // terbaca, tapi tak bisa disimpan ulang apa adanya. Menguncinya di sini = operator melihat
  // sebabnya sebelum menekan Simpan, bukan sesudah menerima 400.
  const profileInvalid = editing ? (
    !optionalIntValid(editing.draft.maxTurns, 1, 200)
    || !optionalIntValid(editing.draft.timeoutSeconds, 30, 3_600)
    || (editing.draft.workspacePolicy === "isolated-worktree"
      && editing.draft.runtime !== "claude")
  ) : false;
  const blocked = invalidTools.length > 0 || invalidMentions.length > 0
    || modelInvalid || effortInvalid || profileInvalid;

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
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }

  async function toggleEnabled(a: CustomAgentView, on: boolean) {
    setErr("");
    try { await api.updateCustomAgent(a.id, { enabled: on }); await load(); }
    catch (e) { setErr(errorText(e)); }
  }

  async function remove(a: CustomAgentView) {
    setErr("");
    try { await api.deleteCustomAgent(a.id); await load(); onToast?.("Agen dihapus", "ok"); }
    catch (e) { setErr(errorText(e)); }
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
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }

  if (rows === null) return <StateBlock kind="loading" title="Memuat custom agent…" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          {projectId
            ? "Agen project ini, ditambah agen global yang berlaku di sini. Agen project menimpa agen global bernama sama."
            : "Agen global — tersedia di semua project. Satu project bisa menimpanya dengan agen bernama sama."}
        </div>
        <Button size="sm" onClick={() => { setErr(""); setEditing({ id: null, draft: emptyDraft() }); }}>
          Agen baru
        </Button>
      </div>

      {err && !editing && <Callout tone="err">{err}</Callout>}
      {metricsError && <Callout tone="warn">
        Bukti penggunaan gagal dimuat. Angka yang masih terlihat berasal dari pemuatan sebelumnya.
        <Button size="sm" variant="ghost" onClick={() => void reloadMetrics()}>Muat ulang bukti</Button>
      </Callout>}
      {!metricsError && metrics && metrics.agents.length === 0 && <Callout tone="info">
        Belum ada bukti invocation dalam periode ini. Ini tidak membuktikan agent belum pernah dipakai;
        pengiriman event dapat tidak tercatat.
      </Callout>}
      {!metricsError && metrics?.telemetry?.state === "observed" && <div style={{
        fontSize: "var(--text-xs)", color: "var(--text-subtle)",
      }}>
        Event terakhir tercatat: {metrics.telemetry.lastEventAt
          ? new Date(metrics.telemetry.lastEventAt).toLocaleString("id-ID") : "—"}
        {` · ${metrics.telemetry.incompleteCount} invocation belum memiliki bukti lengkap.`}
        {" Catatan ini tidak menjamin seluruh event berhasil dikirim."}
      </div>}
      {metrics?.telemetry?.relay && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
        Pengiriman event: {metrics.telemetry.relay.state === "unobserved" ? "belum diperiksa"
          : metrics.telemetry.relay.state === "degraded" ? "terganggu" : "antrean dapat diproses"}
        {` · ${metrics.telemetry.relay.retryPending} pengiriman ditunda pada pemeriksaan terakhir`}
        {` · ${metrics.telemetry.relay.droppedEvents} event ditolak sejak server menyala`}
        {metrics.telemetry.relay.lastIssueAt && ` · kendala terakhir ${new Date(metrics.telemetry.relay.lastIssueAt).toLocaleString("id-ID")}`}
      </div>}

      {rows.length === 0 && (
        <StateBlock kind="empty" compact title="Belum ada custom agent"
          hint="Custom agent adalah persona yang bisa dipilih sesi claude & codex — misalnya peninjau keamanan atau penulis migration." />
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
        return (
          <Card key={a.id} padding={14}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-strong)" }}>{a.name}</span>
              {readOnly && <Badge tone="neutral" size="sm">warisan global</Badge>}
              {/* SPEC-881 · ADR-0136 · keduanya field TURUNAN dari response, bukan kolom skema. */}
              {a.builtin && (
                <Badge tone="neutral" size="sm" data-testid={`builtin-${a.name}`}>
                  {a.builtinEdited ? "bawaan · disunting" : "bawaan"}
                </Badge>
              )}
              {!a.enabled && <Badge tone="warn" size="sm">nonaktif</Badge>}
              {a.available === false && <Badge tone="warn" size="sm">tidak tersedia</Badge>}
              {a.runtime && <Badge tone="neutral" size="sm" data-testid={`runtime-${a.name}`}>{a.runtime}</Badge>}
              <span style={{ flex: 1 }} />
              <Switch checked={a.enabled} disabled={readOnly} aria-label={`Aktifkan ${a.name}`}
                onChange={(on) => void toggleEnabled(a, on)} />
              <Button size="sm" variant="ghost" disabled={readOnly}
                onClick={() => { setErr(""); setEditing({ id: a.id, draft: draftOf(a) }); }}>Ubah</Button>
              <Button size="sm" variant="ghost" disabled={readOnly}
                onClick={() => void remove(a)}>Hapus</Button>
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 6 }}>{a.description}</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
              {/* HASIL RESOLUSI, bukan ketikan operator: `Task` muncul hanya untuk agen ber-mention,
                  dan dicabut untuk agen daun walau operator mengetiknya (lapis 2 anti-loop). */}
              <span data-testid={`tools-${a.name}`}>Tools: {tools.join(", ")}</span>
              <span data-testid={`mentions-${a.name}`}>
                Mention: {a.mentions.length ? a.mentions.map((m) => `@${m}`).join(", ") : "—"}
              </span>
              {a.model && <span>Model: {a.model}</span>}
              <span>Aktivasi: {a.activation ?? "always"}</span>
              <span>Workspace: {a.workspacePolicy ?? "inherit"}</span>
              {a.maxTurns != null && <span>Batas kerja: {a.maxTurns} giliran
                {" (native Claude; instruksi pada Codex)"}</span>}
              {a.timeoutSeconds != null && <span>Target waktu: {a.timeoutSeconds} detik
                {" (instruksi; tidak menghentikan proses otomatis)"}</span>}
            </div>
            {a.selectionReason && <div style={{ fontSize: "var(--text-xs)", marginTop: 6 }}>{a.selectionReason}</div>}
            {a.activation === "smart" && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 6 }}>
              Tersedia sepanjang sesi yang kompatibel. Dipanggil saat tugas, fase, dan perubahan terbaru membutuhkan perannya.
            </div>}
            {a.workspacePolicy === "read-only" && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 6 }}>
              Pemeriksaan statis; perintah test dan eksperimen memerlukan lingkungan terisolasi.
            </div>}
            {a.available === false && a.availabilityReason && (
              <Callout tone="warn">{a.availabilityReason}</Callout>
            )}
            <CustomAgentMetrics name={a.name} metrics={metrics} />
            {recent.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  {recent.length} sampel bukti
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {recent.map((invocation) => {
                    const review = reviews[invocation.id];
                    const disposition = review?.disposition
                      ?? (invocation.disposition === "pending" ? "" : invocation.disposition);
                    const note = review?.note ?? invocation.dispositionNote ?? "";
                    const rework = review?.reworkRequired !== undefined
                      ? review.reworkRequired : invocation.reworkRequired ?? null;
                    return <div key={invocation.id} style={{
                      padding: 8, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
                    }}>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginBottom: 6 }}>
                        {new Date(invocation.startedAt).toLocaleString("id-ID")} · {invocation.runtime}
                        {` · ${invocation.model ?? "model tidak tercatat"} · versi ${invocation.definitionHash?.slice(0, 12) ?? "tidak tercatat"}`}
                        {invocation.resultExcerpt ? ` · ${invocation.resultExcerpt}` : ""}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
                            ...reviews, [invocation.id]: { disposition, note,
                              reworkRequired: e.target.value === "" ? null : e.target.value === "yes" },
                          })} />
                        <Input aria-label={`Catatan ${invocation.id}`} value={note} maxLength={500}
                          placeholder="Catatan opsional"
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReviews({
                            ...reviews, [invocation.id]: { ...review, disposition, note: e.target.value },
                          })} />
                        <Button size="sm" aria-label={`Nilai ${invocation.id}`} loading={busy}
                          disabled={!disposition} onClick={() => void judge(invocation.id)}>Nilai</Button>
                      </div>
                    </div>;
                  })}
                </div>
              </details>
            )}
          </Card>
        );
      })}

      {/* Form agen sebagai MODAL, bukan kartu yang tumbuh di bawah daftar. Formnya tujuh field
          (satu di antaranya textarea enam baris): sebagai kartu inline ia mendorong tombol Simpan
          ke luar viewport, dan dari kartu "Ubah" paling bawah operator harus menggulir ke bawah
          lagi untuk menemukan formnya. Modal memberi isian yang menggulir sendiri dengan aksi
          yang tetap terlihat di footer. */}
      {editing && (
        <Modal open onClose={() => { setEditing(null); setErr(""); }}
          icon="bot" eyebrow={projectId ? "agen project" : "agen global"}
          title={editing.id ? `Ubah ${editing.draft.name}` : "Agen baru"} width={640}
          footer={<>
            <Button variant="ghost" onClick={() => { setEditing(null); setErr(""); }}>Batal</Button>
            <Button onClick={() => void save()} loading={busy} disabled={!nameValid || blocked}>Simpan</Button>
          </>}>
          {err && <Callout tone="err">{err}</Callout>}
          <Field label="Nama" hint={editing.id
            ? "Nama tak bisa diubah — hapus lalu buat baru (definisi ini menyeberang lewat sync)."
            : "huruf kecil, angka, dan tanda hubung; minimal 2 karakter"}>
            <Input value={editing.draft.name} aria-label="Nama" disabled={Boolean(editing.id)}
              invalid={!nameValid} placeholder="mis. peninjau-keamanan" style={{ width: "100%" }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
          </Field>
          <Field label="Deskripsi" hint="Kapan agen ini dipakai — inilah yang dibaca agen untuk MEMILIH.">
            <Input value={editing.draft.description} aria-label="Deskripsi" style={{ width: "100%" }}
              placeholder="mis. Dipakai saat meninjau perubahan yang menyentuh auth"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setEditing({ ...editing, draft: { ...editing.draft, description: e.target.value } })} />
          </Field>
          <Field label="Instruksi" hint="System prompt agen.">
            <HnTextarea value={editing.draft.instructions} aria-label="Instruksi" rows={8}
              placeholder="mis. Kamu peninjau keamanan. Baca diff, laporkan temuan berurut dari yang paling berbahaya, sebut file:line."
              onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, instructions: e.target.value } })} />
          </Field>
          <Field label="Tools" hint={`Kosongkan untuk memakai default: ${DEFAULT_AGENT_TOOLS.join(", ")}. Alat delegasi (Task) diatur otomatis dari Mention.`}>
            <MultiSelect aria-label="Tools" options={toolOptions} value={editing.draft.tools}
              invalidValues={invalidTools} onChange={setTools}
              placeholder="Pilih tools…" searchPlaceholder="mis. Read atau Bash" />
          </Field>
          {/* Runtime menyetir Model — berdampingan supaya penyempitannya terlihat saat terjadi. */}
          <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Runtime agent" hint="Mesin sesi yang memakai agen ini. Kosongkan untuk ikut sesi induk.">
              <Select aria-label="Runtime agent" value={editing.draft.runtime}
                options={[{ value: "", label: "Ikut sesi induk" },
                  ...(catalog?.runtimes ?? []).map((r) => ({ value: r.id, label: r.label }))]}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRuntime(e.target.value)} />
            </Field>
            <Field label="Model" hint="Kosongkan untuk mewarisi model sesi.">
              <Select aria-label="Model" value={editing.draft.model} invalid={modelInvalid}
                options={[{ value: "", label: "Ikut sesi induk" }, ...modelOptions,
                  ...(modelInvalid ? [{ value: editing.draft.model, label: `⚠ ${editing.draft.model} — tak ada di katalog` }] : [])]}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setModel(e.target.value)} />
            </Field>
          </div>
          <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Aktivasi" hint="Smart hanya masuk saat flow dan diff relevan.">
              <Select aria-label="Aktivasi" value={editing.draft.activation}
                options={[{ value: "always", label: "Selalu" }, { value: "smart", label: "Smart" }]}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEditing({
                  ...editing, draft: { ...editing.draft, activation: e.target.value },
                })} />
            </Field>
            <Field label="Effort" hint="Kosongkan untuk mewarisi sesi.">
              <Select aria-label="Effort" value={editing.draft.effort} invalid={effortInvalid}
                options={[{ value: "", label: "Ikut sesi induk" },
                  ...effortOptions.map((effort) => ({ value: effort, label: effort })),
                  ...(effortInvalid
                    ? [{ value: editing.draft.effort, label: `⚠ ${editing.draft.effort} — tak didukung` }]
                    : [])]}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEditing({
                  ...editing, draft: { ...editing.draft, effort: e.target.value },
                })} />
            </Field>
          </div>
          <Field label="Kebijakan workspace" hint="Read-only dipagari hook; isolated hanya tersedia untuk Claude.">
            <Select aria-label="Kebijakan workspace" value={editing.draft.workspacePolicy}
              options={[
                { value: "inherit", label: "Ikut parent" },
                { value: "read-only", label: "Hanya baca" },
                { value: "isolated-worktree", label: "Worktree terisolasi", disabled: editing.draft.runtime !== "claude" },
              ]}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEditing({
                ...editing, draft: { ...editing.draft, workspacePolicy: e.target.value },
              })} />
          </Field>
          <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Maksimum giliran" hint="Kosong = warisi; 1–200.">
              <Input aria-label="Maksimum giliran" type="number" min={1} max={200} placeholder="mis. 40"
                invalid={!optionalIntValid(editing.draft.maxTurns, 1, 200)} value={editing.draft.maxTurns}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({
                  ...editing, draft: { ...editing.draft, maxTurns: e.target.value },
                })} />
            </Field>
            <Field label="Timeout detik" hint="Kosong = tanpa batas Hanoman; 30–3600.">
              <Input aria-label="Timeout detik" type="number" min={30} max={3600} placeholder="mis. 600"
                invalid={!optionalIntValid(editing.draft.timeoutSeconds, 30, 3_600)}
                value={editing.draft.timeoutSeconds}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({
                  ...editing, draft: { ...editing.draft, timeoutSeconds: e.target.value },
                })} />
            </Field>
          </div>
          <Field label="Mention" hint="Agen yang boleh dipanggil agen ini. Graf mention wajib asiklik — server menolak yang membentuk lingkaran.">
            <MultiSelect aria-label="Mention" options={mentionOptions} value={editing.draft.mentions}
              invalidValues={invalidMentions}
              onChange={(mentions: string[]) => setEditing({ ...editing, draft: { ...editing.draft, mentions } })}
              placeholder="Pilih agen…" searchPlaceholder="mis. peninjau-keamanan"
              emptyText="Belum ada agen lain." />
          </Field>
          {blocked && (
            <Callout tone="warn">
              Ada nilai yang tak ada di katalog mesin ini (ditandai ⚠). Buang dulu sebelum menyimpan —
              server menolak nilai yang tak dikenal.
            </Callout>
          )}
        </Modal>
      )}
    </div>
  );
}
