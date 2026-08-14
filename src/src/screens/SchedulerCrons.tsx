/* SchedulerCrons — panel cronjob per project (SPEC-646 · ADR-0112). Dipasang di SchedulerScreen,
   TANPA entri HN_NAV baru: setiap key nav wajib punya cabang `section === …` di App.tsx, dan
   menambahkannya di sini tak memberi apa pun (SPEC-519).

   Preview "jalan berikutnya" di FORM dihitung lokal lewat `nextRunFor` karena ia menggambarkan expr
   yang belum tersimpan; `nextRunAt` di DAFTAR datang dari server (instan otoritatif) dan dirender di
   zona lokal browser. Keduanya memakai modul murni yang sama, jadi tak bisa berselisih. */
import React from "react";
import { Card, Button, Badge, Select, Input, Switch, Modal, Field, HnTextarea, Pager, serverPage, Icon } from "../ds";
import { api } from "../api/client";
import {
  describeCron, nextRunFor, exprToPreset, presetToExpr, parseCron, WEEKDAY_LABELS,
  type CronPreset, type SchedulerCronView, type SchedulerCronRunView, type Agent,
} from "@hanoman/shared";
import { runtimeModels, runtimeEfforts } from "./session-runtime";
import { usePersistedState, isNum, isStr, nullableStr } from "../ui-state";
import type { ProjectVM } from "./types";

const PAGE = 10;

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtLocal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

type PresetKind = CronPreset["kind"] | "lanjutan";

// Bentuk form: preset + komponennya, atau expr mentah. `exprToPreset` yang memutuskan mana yang
// dipakai saat sebuah cron dibuka untuk diubah — preset tak pernah disimpan, selalu diturunkan.
type Draft = {
  name: string; prompt: string; enabled: boolean;
  kind: PresetKind; time: string; weekday: number; everyHours: number; expr: string;
  agent: "" | Agent; model: string; effort: string;
};

const draftFrom = (c?: SchedulerCronView): Draft => {
  const base: Draft = {
    name: c?.name ?? "", prompt: c?.prompt ?? "", enabled: c?.enabled ?? false,
    kind: "lanjutan", time: "07:00", weekday: 1, everyHours: 6, expr: c?.expr ?? "0 7 * * *",
    agent: (c?.agent as Agent | null) ?? "", model: c?.model ?? "", effort: c?.effort ?? "",
  };
  const p = c ? exprToPreset(c.expr) : ({ kind: "harian", hour: 7, minute: 0 } as const);
  if (!p) return base;
  if (p.kind === "tiap-n-jam") return { ...base, kind: p.kind, everyHours: p.everyHours, time: `00:${pad2(p.minute)}` };
  const time = `${pad2(p.hour)}:${pad2(p.minute)}`;
  return p.kind === "mingguan"
    ? { ...base, kind: p.kind, time, weekday: p.weekday }
    : { ...base, kind: p.kind, time };
};

const exprOf = (d: Draft): string => {
  if (d.kind === "lanjutan") return d.expr.trim();
  const [h, m] = d.time.split(":").map(Number) as [number, number];
  switch (d.kind) {
    case "harian": return presetToExpr({ kind: "harian", hour: h, minute: m });
    case "hari-kerja": return presetToExpr({ kind: "hari-kerja", hour: h, minute: m });
    case "mingguan": return presetToExpr({ kind: "mingguan", hour: h, minute: m, weekday: d.weekday });
    case "tiap-n-jam": return presetToExpr({ kind: "tiap-n-jam", everyHours: d.everyHours, minute: m });
  }
};

const STATUS_TONE: Record<string, string> = { launched: "ok", queued: "neutral", skipped: "warn", failed: "err" };
const STATUS_LABEL: Record<string, string> = { launched: "berjalan", queued: "menunggu", skipped: "dilewati", failed: "gagal" };

function RunHistory({ cronId }: { cronId: string }) {
  const [items, setItems] = React.useState<SchedulerCronRunView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = usePersistedState("scheduler", "cronRunsPage", 1, isNum);
  React.useEffect(() => {
    let alive = true;
    api.listCronRuns(cronId, { page, limit: PAGE })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); } })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } });
    return () => { alive = false; };
  }, [cronId, page]);
  const sp = serverPage(total, page, PAGE);
  if (total === 0) return <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada eksekusi.</div>;
  return (
    <>
      {items.map((r) => (
        <div key={r.id} className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", marginBottom: 6 }}>
          <Badge tone={(STATUS_TONE[r.status] ?? "neutral") as never} size="sm">{STATUS_LABEL[r.status] ?? r.status}</Badge>
          <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            jatuh tempo {fmtLocal(r.dueAt)}
            {r.startedAt ? ` · mulai ${fmtLocal(r.startedAt)}` : ""}
            {r.sessionId ? ` · sesi ${r.sessionId}` : ""}
            {r.manual ? " · uji coba" : ""}
            {r.note ? ` · ${r.note}` : ""}
          </span>
        </div>
      ))}
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={setPage} unit="run" />
    </>
  );
}

export type SchedulerCronsProps = {
  projects: ProjectVM[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
};

export function SchedulerCrons({ projects, onProjectChanged, onToast }: SchedulerCronsProps) {
  // SPEC-740 · ADR-0115 · project yang dipilih & seksi riwayat yang ter-expand bertahan.
  const [projectId, setProjectId] = usePersistedState("scheduler", "cronProject", projects[0]?.id ?? "", isStr);
  const [items, setItems] = React.useState<SchedulerCronView[]>([]);
  // `undefined` = modal tertutup; `null` = form cron BARU; objek = sedang mengubah cron itu.
  const [editing, setEditing] = React.useState<SchedulerCronView | null | undefined>(undefined);
  const [draft, setDraft] = React.useState<Draft>(draftFrom());
  const [openRuns, setOpenRuns] = usePersistedState<string | null>("scheduler", "cronOpenRuns", null, nullableStr);
  const [busy, setBusy] = React.useState(false);

  const project = projects.find((p) => p.id === projectId);

  const load = React.useCallback(() => {
    if (!projectId) { setItems([]); return; }
    api.listCrons({ projectId, page: 1, limit: 100 })
      .then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [projectId]);
  React.useEffect(() => { load(); }, [load]);

  const openForm = (c?: SchedulerCronView) => { setEditing(c ?? null); setDraft(draftFrom(c)); };

  const expr = exprOf(draft);
  const preview = parseCron(expr) ? nextRunFor(expr, new Date()) : null;

  const save = async () => {
    if (!parseCron(expr)) { onToast("Cron expression tak sah", "err", "x-circle"); return; }
    setBusy(true);
    try {
      if (editing) {
        await api.patchCron(editing.id, {
          name: draft.name, expr, prompt: draft.prompt, enabled: draft.enabled,
          agent: draft.agent || null, model: draft.model || null, effort: draft.effort || null,
        });
      } else {
        await api.createCron({
          project: projectId, name: draft.name, expr, prompt: draft.prompt, enabled: draft.enabled,
          agent: draft.agent || undefined, model: draft.model || undefined, effort: draft.effort || undefined,
        });
      }
      onToast("Cron tersimpan", "ok", "save");
      setEditing(undefined); load();
    } catch (e) {
      onToast((e as { detail?: { error?: string } }).detail?.error ?? "Gagal menyimpan cron", "err", "x-circle");
    } finally { setBusy(false); }
  };

  const runNow = async (id: string) => {
    setBusy(true);
    try { await api.runCronNow(id); onToast("Uji coba diantrekan — sesi terbuka di tick berikutnya", "ok", "play"); }
    // 409 membawa kalimatnya sendiri ("scheduler sedang dijeda…"); toast "gagal" saja menyembunyikan
    // satu-satunya keterangan yang bisa ditindaklanjuti.
    catch (e) { onToast((e as { detail?: { error?: string } }).detail?.error ?? "Gagal menjalankan cron", "err", "x-circle"); }
    finally { setBusy(false); load(); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { await api.deleteCron(id); onToast("Cron dihapus", "ok", "trash"); }
    catch { onToast("Gagal menghapus cron", "err", "x-circle"); }
    finally { setBusy(false); load(); }
  };

  const optIn = async () => {
    if (!projectId) return;
    try {
      await api.updateProject(projectId, { schedulerOptIn: true });
      await onProjectChanged(projectId);
      onToast("Project di-opt-in", "ok");
    } catch { onToast("Gagal mengubah opt-in", "err", "x-circle"); }
  };

  const agentForCatalog: Agent = draft.agent || "claude";

  return (
    <Card eyebrow="scheduler · cronjob" title="Pengecekan rutin per project"
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Select value={projectId} aria-label="Project"
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProjectId(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          <Button size="sm" leftIcon="plus" disabled={!projectId} onClick={() => openForm()}>Cron baru</Button>
        </div>
      }>
      {/* Gerbang yang tak terlihat terbaca sebagai "cron rusak"; ia dinyatakan di sini DAN dicatat
          sebagai alasan di riwayat run (SPEC-479 memakai jalan yang sama untuk lencana "antre"). */}
      {project && !project.schedulerOptIn && (
        // SPEC-763 · tombol "Aktifkan scheduler di project ini" tak menyusut, jadi tanpa `hn-dense-row`
        // kalimat gerbang ini tersisa ~59px di 390px — terukur 9 baris, 8 karakter/baris.
        <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 12px",
          border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)" }}>
          <Icon name="alert-triangle" size={16} color="var(--clay-500)" />
          <span style={{ flex: 1, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            Project ini belum di-opt-in scheduler — cron-nya tak akan pernah dijalankan.
          </span>
          {/* Label sengaja TIDAK memuat kata "opt-in": `OptInPanel` di layar yang sama sudah punya
              tombol bernama persis itu, dan dua tombol beraksesibel-nama sama di satu halaman adalah
              ambiguitas nyata bagi pembaca layar — bukan cuma bagi query test. */}
          <Button size="sm" leftIcon="check" onClick={() => void optIn()}>Aktifkan scheduler di project ini</Button>
        </div>
      )}

      {items.length === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada cron di project ini.</div>
        : items.map((c) => (
          <div key={c.id} style={{ padding: "10px 12px", marginBottom: 6,
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "var(--text-strong)", fontWeight: 500 }}>{c.name}</span>
              <Badge tone={c.enabled ? "ok" : "neutral"} size="sm">{c.enabled ? "aktif" : "nonaktif"}</Badge>
              <span style={{ flex: 1 }} />
              <Button size="sm" variant="ghost" leftIcon="play" disabled={busy} onClick={() => void runNow(c.id)}>Jalankan sekarang</Button>
              <Button size="sm" variant="ghost" leftIcon="list" onClick={() => setOpenRuns(openRuns === c.id ? null : c.id)}>Riwayat</Button>
              <Button size="sm" variant="ghost" leftIcon="pencil" onClick={() => openForm(c)}>Ubah</Button>
              <Button size="sm" variant="ghost" leftIcon="trash" disabled={busy} onClick={() => void remove(c.id)}>Hapus</Button>
            </div>
            <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
              {describeCron(c.expr)} · terakhir {fmtLocal(c.lastRunAt)} · berikutnya {fmtLocal(c.nextRunAt)}
            </div>
            {openRuns === c.id && <div style={{ marginTop: 10 }}><RunHistory cronId={c.id} /></div>}
          </div>
        ))}

      <Modal open={editing !== undefined} title={editing ? "Ubah cron" : "Cron baru"} eyebrow="scheduler"
        onClose={() => setEditing(undefined)} width={620}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button size="sm" variant="ghost" onClick={() => setEditing(undefined)}>Batal</Button>
            <Button size="sm" leftIcon="save" disabled={busy} onClick={() => void save()}>Simpan</Button>
          </div>
        }>
        <Field label="Nama cron">
          <Input aria-label="Nama cron" placeholder="Cek error produksi pagi" value={draft.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </Field>

        <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
          <Field label="Preset jadwal">
            <Select aria-label="Preset jadwal" value={draft.kind}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, kind: e.target.value as PresetKind }))}
              options={[
                { value: "harian", label: "Setiap hari" },
                { value: "hari-kerja", label: "Hari kerja" },
                { value: "mingguan", label: "Mingguan" },
                { value: "tiap-n-jam", label: "Tiap N jam" },
                { value: "lanjutan", label: "Lanjutan (cron expression)" },
              ]} />
          </Field>
          {draft.kind !== "lanjutan" && (
            <Field label={draft.kind === "tiap-n-jam" ? "Menit (dari jam)" : "Jam"}>
              <Input type="time" aria-label="Jam" value={draft.time}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, time: e.target.value }))} />
            </Field>
          )}
          {draft.kind === "mingguan" && (
            <Field label="Hari">
              <Select aria-label="Hari" value={String(draft.weekday)}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}
                options={WEEKDAY_LABELS.map((l, i) => ({ value: String(i), label: l }))} />
            </Field>
          )}
          {draft.kind === "tiap-n-jam" && (
            <Field label="Tiap berapa jam">
              <Input type="number" min={1} max={23} aria-label="Tiap berapa jam" placeholder="mis. 6"
                value={String(draft.everyHours)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDraft((d) => ({ ...d, everyHours: Math.min(23, Math.max(1, Number(e.target.value) || 1)) }))} />
            </Field>
          )}
        </div>

        {draft.kind === "lanjutan" && (
          <Field label="Cron expression" hint="Lima field: menit jam tanggal bulan hari-pekan — zona waktu server.">
            <Input aria-label="Cron expression" placeholder="0 7 * * 1-5" value={draft.expr}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, expr: e.target.value }))} />
          </Field>
        )}

        <div data-testid="cron-next-preview" style={{ marginBottom: 14, fontSize: "var(--text-xs)",
          color: preview ? "var(--text-muted)" : "var(--clay-500)" }}>
          {preview
            ? `Jalan berikutnya: ${fmtLocal(preview.toISOString())} (waktu lokal)`
            : "Jadwal tak sah — tak ada jalan berikutnya"}
        </div>

        <Field label="Prompt" hint="Instruksi bebas untuk agen. Temuan sebaiknya difilekan sebagai backlog lewat POST /api/specs.">
          <HnTextarea aria-label="Prompt" rows={6}
            placeholder="mis. Periksa error 5xx sejak kemarin, lalu filekan temuannya sebagai QA finding."
            value={draft.prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft((d) => ({ ...d, prompt: e.target.value }))} />
        </Field>

        <div className="hn-grid-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
          <Field label="Runtime">
            <Select aria-label="Runtime" value={draft.agent}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setDraft((d) => ({ ...d, agent: e.target.value as "" | Agent, model: "", effort: "" }))}
              options={[
                { value: "", label: "Warisi default sesi" },
                { value: "claude", label: "Claude Code" },
                { value: "codex", label: "Codex CLI" },
              ]} />
          </Field>
          <Field label="Model">
            <Select aria-label="Model" value={draft.model} disabled={!draft.agent}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, model: e.target.value, effort: "" }))}
              options={[{ value: "", label: "Warisi" },
                ...runtimeModels(agentForCatalog).map((m) => ({ value: m.id, label: m.label }))]} />
          </Field>
          <Field label="Effort">
            <Select aria-label="Effort" value={draft.effort} disabled={!draft.agent}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, effort: e.target.value }))}
              options={[{ value: "", label: "Warisi" },
                ...runtimeEfforts(agentForCatalog, draft.model || runtimeModels(agentForCatalog)[0]!.id)
                  .map((x) => ({ value: x, label: x }))]} />
          </Field>
        </div>

        <Switch label="Aktif" checked={draft.enabled} onChange={(next: boolean) => setDraft((d) => ({ ...d, enabled: next }))} />
      </Modal>
    </Card>
  );
}
