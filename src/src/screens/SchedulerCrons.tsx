/* SchedulerCrons — cronjob per project (SPEC-646 · ADR-0112), tab Cron di hub Otonom (Audit UI/UX 2026-10 ·
   Fase 3I). Dipasang di SchedulerScreen, TANPA entri HN_NAV baru: setiap key nav wajib punya cabang
   `section === …` di App.tsx, dan menambahkannya di sini tak memberi apa pun (SPEC-519).

   Susunan: satu tabel (desktop) yang menjadi kartu di mobile lewat CSS; setiap cron punya menu ⋯ (Ubah ·
   Jalankan sekarang · Riwayat · Hapus lewat konfirmasi). Form memakai dua tab: Dasar (nama, jadwal, prompt)
   dan Lanjutan (runtime, model, effort). Pilihan lanjutan baru terlihat setelah tab-nya dibuka.

   Zona waktu (ADR-0204, ADR-0212): semua INSTAN dari server (jalan berikutnya, terakhir, riwayat) dan
   preview "jalan berikutnya" di FORM dihitung dalam zona server `timeZone`. Preview memakai
   `nextRunFor(expr, now, zone)`, jadi tampil akurat walau zona browser berbeda. */
import React from "react";
import {
  Badge, Button, Select, Input, Switch, Modal, Field, HnTextarea, Pager, serverPage, LocalOverflow, OverflowActions,
  RowList, DenseRow, SkeletonList, Tabs, TabPanel, Icon, useConfirm, type OverflowItem,
} from "../ds";
import { api } from "../api/client";
import { QUEUE_STATUS_LABEL, labelOf } from "../lib/labels";
import {
  describeCron, nextRunFor, exprToPreset, presetToExpr, parseCron, WEEKDAY_LABELS,
  type CronPreset, type SchedulerCronView, type SchedulerCronRunView, type Agent,
} from "@hanoman/shared";
import { runtimeModels, runtimeEfforts } from "./session-runtime";
import { usePersistedState, isNum, isStr, nullableStr } from "../ui-state";
import type { ProjectVM } from "./types";
import { failureMessage } from "../lib/report-error";
import { InlineError, clampNumber, fmtAt, browserTimeZone } from "./sched-lead-shared";
import { CronReports } from "./CronReports";
import "./styles/scheduler.css";

const PAGE = 10;

// 409 dan penolakan lain membawa kalimatnya sendiri di `detail.error`; itu lebih berguna daripada
// "gagal" saja, jadi didahulukan.
const serverReason = (e: unknown): string | undefined => (e as { detail?: { error?: string } }).detail?.error;

type PresetKind = CronPreset["kind"] | "lanjutan";
type FormTab = "dasar" | "lanjutan";

// Bentuk form: preset + komponennya, atau expr mentah. `exprToPreset` yang memutuskan mana yang
// dipakai saat sebuah cron dibuka untuk diubah — preset tak pernah disimpan, selalu diturunkan.
// `everyHours` berupa teks: kolomnya boleh kosong saat diketik dan baru dijepit saat blur/Enter.
type Draft = {
  name: string; prompt: string; enabled: boolean;
  kind: PresetKind; time: string; weekday: number; everyHours: string; expr: string;
  agent: "" | Agent; model: string; effort: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const draftFrom = (c?: SchedulerCronView): Draft => {
  const base: Draft = {
    name: c?.name ?? "", prompt: c?.prompt ?? "", enabled: c?.enabled ?? false,
    kind: "lanjutan", time: "07:00", weekday: 1, everyHours: "6", expr: c?.expr ?? "0 7 * * *",
    agent: (c?.agent as Agent | null) ?? "", model: c?.model ?? "", effort: c?.effort ?? "",
  };
  const p = c ? exprToPreset(c.expr) : ({ kind: "harian", hour: 7, minute: 0 } as const);
  if (!p) return base;
  if (p.kind === "tiap-n-jam") return { ...base, kind: p.kind, everyHours: String(p.everyHours), time: `00:${pad2(p.minute)}` };
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
    case "tiap-n-jam": return presetToExpr({ kind: "tiap-n-jam", everyHours: clampNumber(d.everyHours, 1, 23, 6), minute: m });
  }
};

type Tone = NonNullable<React.ComponentProps<typeof Badge>["tone"]>;
const STATUS_TONE: Record<string, Tone> = { launched: "ok", queued: "neutral", skipped: "warn", failed: "err" };

type At = (iso: string | null) => string;

function RunHistory({ cronId, at }: { cronId: string; at: At }) {
  const [items, setItems] = React.useState<SchedulerCronRunView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = usePersistedState("scheduler", "cronRunsPage", 1, isNum);
  const load = React.useCallback(() => {
    let alive = true;
    api.listCronRuns(cronId, { page, limit: PAGE })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); setLoaded(true); setError(null); } })
      .catch((e) => { if (alive) { setError(failureMessage("memuat riwayat", e)); setLoaded(true); } });
    return () => { alive = false; };
  }, [cronId, page]);
  React.useEffect(() => load(), [load]);
  // Galat memuat TAMPIL sebagai galat — bukan "Belum ada eksekusi", yang akan berbohong.
  if (error) return <InlineError message={error} onRetry={() => { load(); }} />;
  if (!loaded) return <SkeletonList rows={2} label="Memuat riwayat…" />;
  if (total === 0) return <p className="hn-sched-empty">Belum ada eksekusi.</p>;
  const sp = serverPage(total, page, PAGE);
  return (
    <>
      <RowList label="Riwayat eksekusi">
        {items.map((r) => (
          <DenseRow key={r.id}>
            <span className="hn-sched-row-text">
              <span className="hn-sched-row-head">
                <Badge tone={STATUS_TONE[r.status] ?? "neutral"} size="sm">{labelOf(QUEUE_STATUS_LABEL, r.status)}</Badge>
              </span>
              <span className="hn-sched-row-meta">
                jatuh tempo {at(r.dueAt)}
                {r.startedAt ? ` · mulai ${at(r.startedAt)}` : ""}
                {r.manual ? " · uji coba" : ""}
                {r.note ? ` · ${r.note}` : ""}
              </span>
            </span>
          </DenseRow>
        ))}
      </RowList>
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={setPage} unit="run" />
    </>
  );
}

export type SchedulerCronsProps = {
  projects: ProjectVM[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  /** Zona waktu server (ADR-0204). Tanpa prop, zona browser dipakai. */
  timeZone?: string;
};

export function SchedulerCrons({ projects, onProjectChanged, onToast, timeZone }: SchedulerCronsProps) {
  const { confirm, dialog } = useConfirm();
  // Zona server dipakai untuk SEMUA jam (instan dan preview). Browser hanya cadangan bila server belum
  // melaporkan zonanya (state lama tanpa `serverTimeZone`).
  const zone = timeZone ?? browserTimeZone();
  const at: At = (iso) => fmtAt(iso, zone);
  // SPEC-740 · ADR-0115 · project yang dipilih & seksi riwayat yang ter-expand bertahan.
  const [projectId, setProjectId] = usePersistedState("scheduler", "cronProject", projects[0]?.id ?? "", isStr);
  const [items, setItems] = React.useState<SchedulerCronView[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  // `undefined` = modal tertutup; `null` = form cron BARU; objek = sedang mengubah cron itu.
  const [editing, setEditing] = React.useState<SchedulerCronView | null | undefined>(undefined);
  const [draft, setDraft] = React.useState<Draft>(draftFrom());
  const [formTab, setFormTab] = React.useState<FormTab>("dasar");
  const [openRuns, setOpenRuns] = usePersistedState<string | null>("scheduler", "cronOpenRuns", null, nullableStr);
  const [busy, setBusy] = React.useState(false);

  const project = projects.find((p) => p.id === projectId);

  const load = React.useCallback(() => {
    if (!projectId) { setItems([]); setListError(null); setLoaded(true); return; }
    api.listCrons({ projectId, page: 1, limit: 100 })
      .then((r) => { setItems(r.items); setListError(null); setLoaded(true); })
      .catch((e) => { setListError(failureMessage("memuat daftar cron", e)); setLoaded(true); });
  }, [projectId]);
  // Ganti project = kosongkan dulu daftar project lama, supaya cron-nya tak tampil di bawah nama baru.
  React.useEffect(() => { setItems([]); setLoaded(false); load(); }, [load]);

  const openForm = (c?: SchedulerCronView) => { setEditing(c ?? null); setDraft(draftFrom(c)); setFormTab("dasar"); };

  const expr = exprOf(draft);
  const validExpr = parseCron(expr) !== null;
  // ADR-0212: preview dihitung dalam zona server, bukan zona browser.
  const preview = validExpr ? nextRunFor(expr, new Date(), zone) : null;

  const save = async () => {
    if (!validExpr) { onToast("Ekspresi cron tidak sah", "err", "x-circle"); return; }
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
      onToast(serverReason(e) ?? failureMessage("menyimpan cron", e), "err", "x-circle");
    } finally { setBusy(false); }
  };

  const runNow = async (id: string) => {
    setBusy(true);
    try { await api.runCronNow(id); onToast("Uji coba masuk antrean; sesi dibuka pada siklus berikutnya", "ok", "play"); }
    catch (e) { onToast(serverReason(e) ?? failureMessage("menjalankan cron", e), "err", "x-circle"); }
    finally { setBusy(false); load(); }
  };

  const removeNow = async (id: string) => {
    setBusy(true);
    try { await api.deleteCron(id); onToast("Cron dihapus", "ok", "trash"); }
    catch (e) { onToast(serverReason(e) ?? failureMessage("menghapus cron", e), "err", "x-circle"); }
    finally { setBusy(false); load(); }
  };

  // Hapus = hard delete (tak ada jalan pulih), jadi lewat dialog dengan dampak yang disebut.
  const askRemove = (c: SchedulerCronView) => {
    void confirm({
      title: "Hapus cron ini?",
      eyebrow: "scheduler · cronjob",
      impact: [
        `Cron "${c.name}" di project ${project?.name ?? "ini"} dihapus permanen.`,
        "Jadwalnya berhenti dan tidak akan dijalankan lagi.",
        "Tindakan ini tidak bisa dibatalkan.",
      ],
      confirmLabel: "Hapus cron",
      icon: "trash-2",
      tone: "danger",
      run: () => removeNow(c.id),   // removeNow menangani galatnya sendiri (toast)
    });
  };

  const optIn = async () => {
    if (!projectId) return;
    try {
      await api.updateProject(projectId, { schedulerOptIn: true });
      await onProjectChanged(projectId);
      onToast("Project diizinkan untuk scheduler", "ok");
    } catch (e) { onToast(failureMessage("mengizinkan project", e), "err", "x-circle"); }
  };

  // Menu ⋯ per cron: semua aksinya ada di sini, supaya baris tabel tetap satu baris.
  const itemsFor = (c: SchedulerCronView): OverflowItem[] => [
    { key: "edit", label: "Ubah", icon: "pencil", onSelect: () => openForm(c) },
    { key: "run", label: "Jalankan sekarang", icon: "play", disabled: busy, onSelect: () => void runNow(c.id) },
    { key: "runs", label: openRuns === c.id ? "Sembunyikan riwayat" : "Riwayat", icon: "list",
      onSelect: () => setOpenRuns(openRuns === c.id ? null : c.id) },
    { key: "remove", label: "Hapus", icon: "trash", tone: "danger", disabled: busy, onSelect: () => askRemove(c) },
  ];

  const agentForCatalog: Agent = draft.agent || "claude";

  // Kolom angka diperbaiki saat kehilangan fokus / Enter, bukan saat diketik.
  const commitEveryHours = () => setDraft((d) => ({ ...d, everyHours: String(clampNumber(d.everyHours, 1, 23, 6)) }));

  const previewText = !validExpr
    ? "Jadwal tidak sah, jadi tidak ada jalan berikutnya."
    : preview
      ? `Perkiraan jalan berikutnya: ${at(preview.toISOString())}`
      : `Preview belum bisa dihitung untuk zona ${zone}. Jam jalan berikutnya tampil di daftar cron.`;

  return (
    <div className="hn-sched-panel">
      <div className="hn-sched-toolbar">
        <Select value={projectId} aria-label="Project"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProjectId(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        <Button size="sm" leftIcon="plus" disabled={!projectId} onClick={() => openForm()}>Cron baru</Button>
      </div>
      <p className="hn-sched-caption">
        Jam ditampilkan dalam zona server <b>{zone}</b>
        {timeZone === undefined ? " (server belum melaporkan zonanya, jadi zona browser yang dipakai)" : ""}.
      </p>

      {/* Gerbang yang tak terlihat terbaca sebagai "cron rusak"; ia dinyatakan di sini DAN dicatat
          sebagai alasan di riwayat run (SPEC-479 memakai jalan yang sama untuk lencana "antre"). */}
      {project && !project.schedulerOptIn && (
        <div className="hn-sched-notice">
          <div className="hn-dense-row" role="note">
            <Icon name="alert-triangle" size={16} color="var(--clay-600)" />
            <span className="hn-grow hn-sched-notice-text">
              Project ini belum diizinkan untuk scheduler, jadi cron-nya tidak akan pernah dijalankan.
            </span>
            {/* Label sengaja TIDAK memuat kata "izinkan" yang sama dengan tombol di `OptInPanel` pada layar
                yang sama — dua tombol beraksesibel-nama sama di satu halaman membingungkan pembaca layar. */}
            <Button size="sm" leftIcon="check" onClick={() => void optIn()}>Aktifkan scheduler di project ini</Button>
          </div>
        </div>
      )}

      {listError
        ? <InlineError message={listError} onRetry={load} busy={busy} />
        : !loaded
          ? <SkeletonList rows={3} label="Memuat daftar cron…" />
          : items.length === 0
            ? <p className="hn-sched-empty">Belum ada cron di project ini.</p>
            : (
              <LocalOverflow>
                <table className="hn-sched-table">
                  <thead>
                    <tr>
                      <th scope="col">Cron</th>
                      <th scope="col">Jadwal</th>
                      <th scope="col">Terakhir</th>
                      <th scope="col">Berikutnya</th>
                      <th scope="col"><span className="hn-sr-only">Aksi</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <React.Fragment key={c.id}>
                        <tr>
                          <td data-label="Cron">
                            <span className="hn-sched-row-head">
                              <span className="hn-sched-row-title">{c.name}</span>
                              <Badge tone={c.enabled ? "ok" : "neutral"} size="sm">{c.enabled ? "aktif" : "nonaktif"}</Badge>
                            </span>
                          </td>
                          <td data-label="Jadwal">{describeCron(c.expr)}</td>
                          <td data-label="Terakhir">{at(c.lastRunAt)}</td>
                          <td data-label="Berikutnya">{at(c.nextRunAt)}</td>
                          <td className="hn-sched-cell-actions">
                            <OverflowActions label={`Aksi untuk cron ${c.name}`} title={c.name} items={itemsFor(c)} />
                          </td>
                        </tr>
                        {openRuns === c.id && (
                          <tr className="hn-sched-runs">
                            <td colSpan={5}>
                              <div id={`cron-runs-${c.id}`}><RunHistory cronId={c.id} at={at} /></div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </LocalOverflow>
            )}

      {projectId && (
        <section className="hn-sched-reports" aria-label="Laporan run cron">
          <h3>Laporan run cron</h3>
          <CronReports projectId={projectId} />
        </section>
      )}

      <Modal open={editing !== undefined} title={editing ? "Ubah cron" : "Cron baru"} eyebrow="scheduler"
        onClose={() => setEditing(undefined)} width={640}
        footer={
          <div className="hn-sched-savebar">
            <Button size="sm" variant="ghost" onClick={() => setEditing(undefined)}>Batal</Button>
            <Button size="sm" leftIcon="save" disabled={busy} onClick={() => void save()}>Simpan</Button>
          </div>
        }>
        <Tabs tabs={[{ value: "dasar", label: "Dasar" }, { value: "lanjutan", label: "Lanjutan" }]}
          value={formTab} onChange={(v) => setFormTab(v as FormTab)}>
          <TabPanel value="dasar" className="hn-sched-panel">
            <Field label="Nama cron">
              <Input aria-label="Nama cron" placeholder="mis. Cek error produksi pagi" value={draft.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Field>

            <div className="hn-sched-form-grid">
              <Field label="Preset jadwal">
                <Select aria-label="Preset jadwal" value={draft.kind}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, kind: e.target.value as PresetKind }))}
                  options={[
                    { value: "harian", label: "Setiap hari" },
                    { value: "hari-kerja", label: "Hari kerja" },
                    { value: "mingguan", label: "Mingguan" },
                    { value: "tiap-n-jam", label: "Tiap N jam" },
                    { value: "lanjutan", label: "Ekspresi cron (lanjutan)" },
                  ]} />
              </Field>
              {draft.kind !== "lanjutan" && (
                <Field label={draft.kind === "tiap-n-jam" ? "Menit pada setiap jam" : "Jam"}>
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
                    value={draft.everyHours}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, everyHours: e.target.value }))}
                    onBlur={commitEveryHours}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); commitEveryHours(); } }} />
                </Field>
              )}
            </div>

            {draft.kind === "lanjutan" && (
              <Field label="Ekspresi cron" hint="Lima bagian: menit, jam, tanggal, bulan, hari dalam minggu.">
                <Input aria-label="Ekspresi cron" placeholder="mis. 0 7 * * 1-5" value={draft.expr}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, expr: e.target.value }))} />
              </Field>
            )}

            <p data-testid="cron-next-preview" className={`hn-sched-note${preview ? "" : " hn-sched-preview-warn"}`}>
              {previewText}
            </p>
            <p className="hn-sched-note">Jadwal berlaku menurut zona waktu server <b>{zone}</b>.</p>

            <Field label="Prompt" hint="Instruksi bebas untuk agen. Temuan sebaiknya dicatat sebagai item backlog baru.">
              <HnTextarea aria-label="Prompt" rows={6}
                placeholder="mis. Periksa error 5xx sejak kemarin, lalu catat temuannya sebagai QA finding."
                value={draft.prompt}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft((d) => ({ ...d, prompt: e.target.value }))} />
            </Field>

            <Switch label="Aktif" checked={draft.enabled} onChange={(next: boolean) => setDraft((d) => ({ ...d, enabled: next }))} />
          </TabPanel>

          <TabPanel value="lanjutan" className="hn-sched-panel">
            <p className="hn-sched-group-hint">
              Kosongkan untuk mengikuti default sesi. Model dan effort baru tersedia setelah runtime dipilih.
            </p>
            <div className="hn-sched-form-grid">
              <Field label="Runtime">
                <Select aria-label="Runtime" value={draft.agent}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setDraft((d) => ({ ...d, agent: e.target.value as "" | Agent, model: "", effort: "" }))}
                  options={[
                    { value: "", label: "Ikuti default sesi" },
                    { value: "claude", label: "Claude Code" },
                    { value: "codex", label: "Codex CLI" },
                  ]} />
              </Field>
              <Field label="Model">
                <Select aria-label="Model" value={draft.model} disabled={!draft.agent}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, model: e.target.value, effort: "" }))}
                  options={[{ value: "", label: "Ikuti default" },
                    ...runtimeModels(agentForCatalog).map((m) => ({ value: m.id, label: m.label }))]} />
              </Field>
              <Field label="Effort">
                <Select aria-label="Effort" value={draft.effort} disabled={!draft.agent}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDraft((d) => ({ ...d, effort: e.target.value }))}
                  options={[{ value: "", label: "Ikuti default" },
                    ...runtimeEfforts(agentForCatalog, draft.model || runtimeModels(agentForCatalog)[0]!.id)
                      .map((x) => ({ value: x, label: x }))]} />
              </Field>
            </div>
          </TabPanel>
        </Tabs>
      </Modal>
      {dialog}
    </div>
  );
}
