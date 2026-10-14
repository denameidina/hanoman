/* LeadScreen — kotak masuk operator hanoman-lead (SPEC-409, ADR-0091; Audit UI/UX 2026-10 · Fase 3F).
   Satu kalimat status di atas, lalu dua kolom: kolom utama memuat "Menunggu kamu" (opsi jawaban sekali klik
   untuk sesi yang menunggu operator) dan riwayat keputusan + rangkaian dalam satu timeline; kolom samping
   memuat mode Aktif/Jeda/Mati, callout keamanan, project yang dipimpin (lipat), dan pengaturan lead (lipat,
   draft lokal dengan Simpan eksplisit). Data disegarkan lewat langganan berparameter `lead` (SPEC-908). */
import React from "react";
import "./styles/lead.css";
import {
  Button, Badge, Input, Select, StateBlock, Checkbox, Radio, RadioGroup, Pager, serverPage, LiveConnectionBadge,
  useConfirm, FilterBar, Callout, SkeletonList, Stack, Field, RowList, DenseRow,
} from "../ds";
import type { ConfirmOptions, FilterChip } from "../ds";
import { api } from "../api/client";
import { useLiveTopic } from "../api/live";
import { AGENT_RUNTIME_LABELS } from "@hanoman/shared";
import type { Lead, LeadStatusView, LeadDecisionView, LeadFlowView } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { usePersistedState, useResetOnChange, ResetViewButton, isStr, isNum, oneOf } from "../ui-state";
import { failureMessage } from "../lib/report-error";
import { agoLabel, clampNumber, InlineError, useServerDraft } from "./sched-lead-shared";
import {
  LEAD_CONFIDENCE_LABEL as CONF_LABEL, LEAD_STATUS_LABEL as DECISION_STATUS_LABEL, LEAD_KIND_LABEL as KIND_LABEL,
  LEAD_GATE_LABEL as GATE_LABEL, LEAD_ACTION_LABEL as ACTION_LABEL, LEAD_FLOW_STATUS_LABEL as FLOW_LABEL,
  LEAD_FLOW_CLOSE_LABEL as FLOW_CLOSE_LABEL, labelOf,
} from "../lib/labels";

// SPEC-908 · tinggal kadens FALLBACK; jalur normalnya langganan `/events/ws`.
const POLL_MS = 5000;
// SPEC-523 · ukuran halaman riwayat. Daftar keputusan dan rangkaian dipaginasi per sumber.
const LIST_PAGE = 20;
const QUESTION_MAX = 400;

type Mode = "aktif" | "jeda" | "mati";
type Kind = "semua" | "keputusan" | "rangkaian";
const MODE_LABEL: Record<Mode, string> = { aktif: "aktif", jeda: "dijeda", mati: "mati" };
const KIND_CHIPS: { key: Kind; label: string }[] = [
  { key: "semua", label: "Semua" }, { key: "keputusan", label: "Keputusan" }, { key: "rangkaian", label: "Rangkaian" },
];

// Tone DS (feedback.tsx) — disempitkan supaya salah tulis nada tertangkap tsc, bukan tampil pucat.
type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
const CONF_TONE: Record<string, Tone> = { tinggi: "ok", sedang: "neutral", ragu: "warn" };
const STATUS_TONE: Record<string, Tone> = { berlaku: "ok", ditimpa: "warn", dibatalkan: "neutral", gagal: "err" };
// SPEC-485 · ADR-0102 · status satu RANTAI keputusan. `menunggu` diberi nada peringatan.
const FLOW_TONE: Record<string, Tone> = {
  menunggu: "warn", sebagian: "info", selesai: "ok", dibatalkan: "neutral",
};
const FLOW_OPEN = new Set(["menunggu", "sebagian"]);

// Pengaturan lead sebagai draft string: input angka boleh kosong saat diketik.
type SettingsDraft = { everyMin: string; timeoutSec: string; maxAutoAnswers: string; requireGreen: boolean };
const toDraft = (c: Lead): SettingsDraft => ({
  everyMin: String(c.everyMin), timeoutSec: String(c.timeoutSec),
  maxAutoAnswers: String(c.maxAutoAnswers), requireGreen: c.requireGreenBeforeIntegrate,
});
const EMPTY_DRAFT: SettingsDraft = { everyMin: "5", timeoutSec: "600", maxAutoAnswers: "3", requireGreen: true };

/* Pager sumber tunggal (keputusan atau rangkaian) — rentang & total eksak. */
function LeadPager({ total, page, onPage, unit }:
  { total: number; page: number; onPage: (n: number) => void; unit: string }) {
  const sp = serverPage(total, page, LIST_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />;
}

/* Timeline gabungan: dua sumber dipaginasi pada nomor halaman yang sama. Footer menyebut halaman saja. */
function CombinedPager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (n: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="hn-lead-footer">
      <span>Halaman {page} dari {pageCount} · keputusan dan rangkaian</span>
      <span className="hn-lead-chips">
        <Button size="sm" variant="ghost" aria-label="Sebelumnya" disabled={page <= 1} onClick={() => onPage(page - 1)}>Sebelumnya</Button>
        <Button size="sm" variant="ghost" aria-label="Berikutnya" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Berikutnya</Button>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- Menunggu kamu */

type DialogPayload = Awaited<ReturnType<typeof api.sessionDialog>>;

/* Satu sesi yang menunggu operator. Pertanyaannya dibaca dari layar sesi (GET dialog) dan opsinya
   dikirim sebagai tombol sekali klik; bila tak bisa dibaca dari sini, operator diarahkan ke Terminal. */
function WaitingCard({ sid, title, label, needsYou, onGoto, onAnswered, onError }: {
  sid: string; title: string; label: string; needsYou: boolean;
  onGoto: () => void; onAnswered: () => void; onError: (msg: string) => void;
}) {
  const [dlg, setDlg] = React.useState<DialogPayload>(null);
  const [dlgState, setDlgState] = React.useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [picked, setPicked] = React.useState<number[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!needsYou) return;
    let alive = true;
    setDlgState("loading");
    // `Promise.resolve().then` menangkap juga pelemparan sinkron, supaya galat baca tak meruntuhkan layar.
    Promise.resolve().then(() => api.sessionDialog(sid)).then(
      (p) => {
        if (!alive) return;
        setDlg(p);
        setDlgState(p && p.dialog.options.length > 0 ? "ready" : "unavailable");
      },
      () => { if (alive) setDlgState("unavailable"); });
    return () => { alive = false; };
  }, [sid, needsYou]);

  async function answer(choices: number[], single: boolean) {
    if (!dlg) return;
    setBusy(true);
    try {
      await api.answerSessionDialog(sid, single
        ? { screenHash: dlg.screenHash, choice: choices[0] }
        : { screenHash: dlg.screenHash, choices });
      setPicked([]);
      onAnswered();
    } catch (e) { onError(failureMessage("menjawab sesi", e)); }
    finally { setBusy(false); }
  }

  const togglePick = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  const d = dlg?.dialog;

  return (
    <li className="hn-lead-wait">
      <div className="hn-lead-wait-head">
        <span className="hn-lead-wait-title">{title}</span>
        <Badge tone={needsYou ? "warn" : "ok"} size="sm">{label}</Badge>
      </div>
      {needsYou && dlgState === "loading" && <p className="hn-lead-note">Membaca pertanyaannya…</p>}
      {needsYou && dlgState === "unavailable" && <p className="hn-lead-note">Pertanyaan ini belum bisa dijawab dari sini. Jawab di Terminal.</p>}
      {needsYou && dlgState === "ready" && d && (
        <>
          {d.title && <p className="hn-lead-wait-question">{d.title}</p>}
          {d.multi
            ? <>
                <div className="hn-lead-options-multi" role="group" aria-label={d.title || "Pilihan jawaban"}>
                  {d.options.map((o) => (
                    <Checkbox key={o.n} checked={picked.includes(o.n)} label={o.label} disabled={busy}
                      onChange={() => togglePick(o.n)} />
                  ))}
                </div>
                <div className="hn-lead-wait-foot">
                  <Button size="sm" disabled={busy || picked.length === 0} onClick={() => void answer(picked, false)}>
                    Kirim pilihan
                  </Button>
                </div>
              </>
            : <div className="hn-lead-options" role="group" aria-label={d.title || "Pilihan jawaban"}>
                {d.options.map((o) => (
                  <Button key={o.n} size="sm" variant="secondary" disabled={busy} onClick={() => void answer([o.n], true)}>
                    {o.label}
                  </Button>
                ))}
              </div>}
          {(d.freeIndex != null || d.notes) && <p className="hn-lead-note">Jawaban bebas: jawab di Terminal.</p>}
        </>
      )}
      <div className="hn-lead-wait-foot">
        <Button size="sm" variant="ghost" leftIcon="terminal" onClick={onGoto}>Buka di Terminal</Button>
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- riwayat */

/** Pilihan jawaban untuk "Ubah jawaban": tunggal = radio (satu klik), jamak = checkbox. */
function ChoicePicker({ label, options, multi, value, onChange }: {
  label: string; options: string[]; multi: boolean; value: string[]; onChange: (next: string[]) => void;
}) {
  if (!multi) {
    return (
      <RadioGroup aria-label={label} value={value[0] ?? ""} onChange={(v: string) => onChange([v])}>
        {options.map((o) => <Radio key={o} value={o} label={o} />)}
      </RadioGroup>
    );
  }
  return (
    <div role="group" aria-label={label} className="hn-lead-options-multi">
      {options.map((o) => (
        <Checkbox key={o} checked={value.includes(o)} label={o}
          onChange={() => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o])} />
      ))}
    </div>
  );
}

function DecisionItem({ d, projectName, onOverride, onCancel, busyId, ask }: {
  d: LeadDecisionView;
  projectName: (id: string) => string;
  onOverride: (id: string, answer: string, choices: string[]) => Promise<boolean>;
  onCancel: (d: LeadDecisionView) => void;
  busyId: string | null;
  ask: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [draftChoices, setDraftChoices] = React.useState<string[]>([]);
  // SPEC-485 · `choices` bentuk yang berlaku; baris dari server LAMA hanya punya pasangan skalar,
  // dan `?? []` di sepanjang berkas ini bukan kehati-hatian berlebih (ADR-0087).
  const picked = (d.choices ?? []).length > 0
    ? d.choices
    : (d.choiceIndex != null && d.choice ? [{ index: d.choiceIndex, option: d.choice }] : []);
  const options = d.options ?? [];
  const multi = d.select?.mode === "multi";
  const where = [projectName(d.projectId), d.specId].filter(Boolean).join(" · ");
  const action = d.action !== "none" ? ACTION_LABEL[d.action] : undefined;
  const question = d.question.length > QUESTION_MAX ? `${d.question.slice(0, QUESTION_MAX)}…` : d.question;
  const busyHere = busyId === d.id;
  const closeForm = () => { setOpen(false); setDraft(""); setDraftChoices([]); };
  const currentAnswer = picked.length
    ? picked.map((c) => c.option).join(" · ")
    : (d.answer || "tidak ada jawaban");
  const answerText = draft.trim() || draftChoices.join("; ");

  // Perubahan jawaban selalu dikonfirmasi dan menyebut jawaban lama → baru. Draft dikosongkan HANYA
  // bila server menerima; galat menyisakan ketikan operator utuh.
  const submit = async () => {
    let ok = false;
    await ask({
      title: "Ubah jawaban keputusan ini?", eyebrow: "lead · ubah jawaban",
      impact: [`Jawaban sekarang: ${currentAnswer}`, `Jadi: ${answerText}`],
      confirmLabel: "Ubah jawaban", icon: "edit-3", tone: "default",
      run: async () => { ok = await onOverride(d.id, answerText, draftChoices); },
    });
    if (ok) closeForm();
  };

  return (
    <li className="hn-lead-item">
      <div className="hn-lead-item-head">
        <Badge tone={STATUS_TONE[d.status] ?? "neutral"} size="sm">{DECISION_STATUS_LABEL[d.status] ?? d.status}</Badge>
        {d.weighty && <Badge tone="warn" size="sm">berbobot</Badge>}
        <span className="hn-lead-item-time">{agoLabel(d.createdAt)}</span>
      </div>
      <div className="hn-lead-item-question">{question}</div>
      {/* Label opsi terpilih menang atas prosa: itulah yang benar-benar dikirim ke peminta. */}
      <div className="hn-lead-item-answer">
        {picked.length
          ? picked.map((c) => c.option).join(" · ")
          : (d.answer || <em>tidak ada jawaban</em>)}
      </div>
      {d.reason && <div className="hn-lead-item-reason">{d.reason}</div>}
      <div className="hn-lead-item-meta">
        <span>{KIND_LABEL[d.kind] ?? d.kind}</span>
        <span>{GATE_LABEL[d.gate] ?? d.gate}</span>
        <span>{CONF_LABEL[d.confidence] ?? d.confidence}</span>
        {picked.length > 0 && options.length > 0 && <span>
          {picked.length > 1 ? `${picked.length} dari ${options.length} opsi` : `opsi ${picked[0]!.index} dari ${options.length}`}
        </span>}
        {(d.missing ?? []).length > 0 && <span>kurang konteks</span>}
        <span>{where}{action ? ` · ${action}` : ""}</span>
      </div>
      {(d.missing ?? []).length > 0 && <div className="hn-lead-item-reason">Yang kurang: {d.missing.join(" · ")}</div>}
      {d.refs.length > 0 && (
        <div className="hn-lead-refs">
          {d.refs.map((r) => <span key={r} className="hn-lead-ref">{r}</span>)}
        </div>
      )}
      {d.status === "berlaku" && !open && (
        <div className="hn-lead-item-foot">
          <span className="hn-lead-chips">
            <Button size="sm" variant="ghost" leftIcon="edit-3" onClick={() => setOpen(true)}>Ubah jawaban</Button>
            <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busyHere} onClick={() => onCancel(d)}>Batalkan</Button>
          </span>
        </div>
      )}
      {open && (
        <div className="hn-lead-change">
          {options.length > 0 && (
            <ChoicePicker label={`Pilihan jawaban${d.specId ? ` untuk ${d.specId}` : ""}`}
              options={options} multi={multi} value={draftChoices} onChange={setDraftChoices} />
          )}
          <div className="hn-lead-change-row">
            <Input className="hn-lead-change-input" aria-label={`Jawaban kamu${d.specId ? ` untuk ${d.specId}` : ""}`}
              placeholder="mis. pilih opsi 2, pakai Node 22"
              value={draft} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} />
            <Button size="sm" variant="ghost" disabled={busyHere} onClick={closeForm}>Batal</Button>
            <Button size="sm" leftIcon="check"
              disabled={(!draft.trim() && draftChoices.length === 0) || busyHere}
              onClick={() => void submit()}>Kirim jawaban</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function FlowItem({ f, busyId, onClose }: {
  f: LeadFlowView; busyId: string | null; onClose: (f: LeadFlowView, how: "submit" | "cancel") => void;
}) {
  return (
    <li className="hn-lead-item">
      <div className="hn-lead-item-head">
        <Badge tone={FLOW_TONE[f.status] ?? "neutral"} size="sm">{FLOW_LABEL[f.status] ?? f.status}</Badge>
        <span className="hn-lead-item-time">{agoLabel(f.openedAt)}</span>
      </div>
      <div className="hn-lead-item-answer">{f.title}</div>
      <div className="hn-lead-item-meta">
        <span>{f.steps} langkah</span>
        {f.closeReason && <span>{labelOf(FLOW_CLOSE_LABEL, f.closeReason)}</span>}
      </div>
      {FLOW_OPEN.has(f.status) && (
        <div className="hn-lead-item-foot">
          <span className="hn-lead-chips">
            <Button size="sm" leftIcon="check" disabled={busyId === f.id} onClick={() => onClose(f, "submit")}>Kirim rangkaian</Button>
            <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busyId === f.id} onClick={() => onClose(f, "cancel")}>Batalkan rangkaian</Button>
          </span>
        </div>
      )}
    </li>
  );
}

export type LeadScreenProps = {
  projects: ProjectVM[];
  onProjectChanged: (id: string) => void | Promise<void>;
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onGotoTerminal: (sessionId?: string) => void;
};

export function LeadScreen({ projects, onProjectChanged, onToast, onGotoTerminal }: LeadScreenProps) {
  const { confirm, dialog } = useConfirm();
  const [state, setState] = React.useState<LeadStatusView | null>(null);
  const [decisions, setDecisions] = React.useState<LeadDecisionView[]>([]);
  const [flows, setFlows] = React.useState<LeadFlowView[]>([]);
  const [flowsError, setFlowsError] = React.useState(false);
  const [decTotal, setDecTotal] = React.useState(0);
  const [decPage, setDecPage] = usePersistedState("lead", "decPage", 1, isNum);
  const [flowTotal, setFlowTotal] = React.useState(0);
  const [flowPage, setFlowPage] = usePersistedState("lead", "flowPage", 1, isNum);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // SPEC-740 · ADR-0115 · penyaring project, jenis riwayat, dan nomor halaman bertahan.
  const [filter, setFilter] = usePersistedState("lead", "filter", "all", isStr);
  const [kind, setKind] = usePersistedState<Kind>("lead", "kind", "semua", oneOf("semua", "keputusan", "rangkaian"));
  // Sudah ada data yang tampil? Muat ulang (ganti filter/halaman) TIDAK kembali ke loading penuh.
  const hasData = React.useRef(false);

  const projectName = React.useCallback((id: string) => projects.find((p) => p.id === id)?.name ?? "Project lain", [projects]);

  const load = React.useCallback((silent = false) => {
    if (!silent && !hasData.current) setPhase("loading");
    Promise.all([
      api.getLeadStatus(),
      api.getLeadDecisions({ projectId: filter === "all" ? undefined : filter, page: decPage, limit: LIST_PAGE }),
      // SPEC-485 · rantai. Instance lama tak punya endpoint ini; kegagalannya tak boleh menjatuhkan
      // seluruh panel (ADR-0087). Ia ditandai sebagai galat di riwayatnya.
      api.getLeadFlows({ projectId: filter === "all" ? undefined : filter, page: flowPage, limit: LIST_PAGE })
        .catch(() => null),
    ])
      .then(([s, d, f]) => {
        hasData.current = true;
        setState(s);
        setDecisions(d.items ?? []); setDecTotal(d.total ?? 0);
        if (f) { setFlows(f.items ?? []); setFlowTotal(f.total ?? 0); setFlowsError(false); }
        else setFlowsError(true);
        setLoadError(null);
        setPhase("ready");
      })
      .catch((e) => {
        if (!hasData.current) { setPhase("error"); return; }
        if (!silent) setLoadError(failureMessage("memuat keputusan", e));   // data lama tetap tampil
      });
  }, [filter, decPage, flowPage]);
  React.useEffect(() => { load(); }, [load]);
  // AC-15 · GANTI penyaring = kembali ke halaman 1 (`useResetOnChange`, bukan effect yang juga menyala saat mount).
  useResetOnChange(filter, () => { setDecPage(1); setFlowPage(1); });
  // SPEC-908 · satu topik untuk ketiga daftar — cermin `load()` yang memang satu `Promise.all`.
  useLiveTopic({
    topic: "lead",
    params: {
      projectId: filter === "all" ? undefined : filter,
      decPage, flowPage, limit: LIST_PAGE,
    },
    apply: (m) => {
      hasData.current = true;
      setState(m.status);
      setDecisions(m.decisions.items); setDecTotal(m.decisions.total);
      setFlows(m.flows.items); setFlowTotal(m.flows.total);
      setFlowsError(false); setLoadError(null);
      setPhase("ready");
    },
    refetch: () => load(true), pollMs: POLL_MS,
  });

  // Pengaturan: draft lokal yang disemai dari server; Simpan eksplisit, bukan tiap ketukan.
  const cfg = state?.config ?? null;
  const settings = useServerDraft<SettingsDraft>(cfg ? toDraft(cfg) : EMPTY_DRAFT);
  const settingsDirty = settings.dirty;

  const writeConfig = React.useCallback(async (next: Lead, quiet = false): Promise<boolean> => {
    setBusy(true);
    try {
      await api.putLeadConfig(next);
      if (!quiet) onToast("Setelan lead tersimpan", "ok", "save");
      load(true);
      return true;
    } catch (e) {
      onToast(failureMessage("menyimpan setelan lead", e), "err", "x-circle");
      return false;
    } finally { setBusy(false); }
  }, [load, onToast]);

  const saveSettings = async () => {
    if (!cfg) return;
    const next: Lead = {
      ...cfg,
      everyMin: clampNumber(settings.draft.everyMin, 1, 1440, cfg.everyMin),
      timeoutSec: clampNumber(settings.draft.timeoutSec, 10, 900, cfg.timeoutSec),
      maxAutoAnswers: clampNumber(settings.draft.maxAutoAnswers, 1, 20, cfg.maxAutoAnswers),
      requireGreenBeforeIntegrate: settings.draft.requireGreen,
    };
    // Kolom yang dikosongkan kembali ke nilai tersimpan: tak ada yang berubah, jadi tak ada tulisan.
    if (JSON.stringify(toDraft(next)) === JSON.stringify(toDraft(cfg))) { settings.setDraft(toDraft(cfg)); return; }
    // Nilai yang sudah dijepit ditampilkan apa adanya; server yang datang kemudian menyelaraskannya.
    settings.setDraft(toDraft(next));
    await writeConfig(next);
  };

  const toggleOptIn = React.useCallback(async (id: string, next: boolean) => {
    setBusyId(id);
    try { await api.updateProject(id, { leadOptIn: next }); await onProjectChanged(id); load(true); onToast(next ? "Project diserahkan ke lead" : "Project ditarik dari lead", "ok"); }
    catch (e) { onToast(failureMessage("mengubah lead untuk project", e), "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onProjectChanged, onToast]);

  const togglePause = React.useCallback(async (id: string, paused: boolean) => {
    if (!state) return;
    const set = new Set(state.config.pausedProjects);
    if (paused) set.add(id); else set.delete(id);
    await writeConfig({ ...state.config, pausedProjects: [...set] }, true);
  }, [state, writeConfig]);

  // Mengubah jawaban dipanggil dari dialog konfirmasi; `false` = server menolak (draft tetap utuh).
  const override = React.useCallback(async (id: string, answer: string, choices: string[] = []): Promise<boolean> => {
    setBusyId(id);
    try {
      const r = await api.overrideLeadDecision(id, answer, "", choices);
      onToast(r.delivered ? "Jawaban kamu dikirim ke sesi" : "Keputusan diubah", "ok", "check");
      load(true);
      return true;
    } catch (e) { onToast(failureMessage("mengubah keputusan", e), "err", "x-circle"); return false; }
    finally { setBusyId(null); }
  }, [load, onToast]);

  // SPEC-485 · menutup rangkaian adalah tindakan operator, bukan keputusan lead.
  const runCloseFlow = React.useCallback(async (id: string, how: "submit" | "cancel") => {
    setBusyId(id);
    try {
      await (how === "submit" ? api.submitLeadFlow(id) : api.cancelLeadFlow(id));
      onToast(how === "submit" ? "Rangkaian dikirim" : "Rangkaian ditutup tanpa dikirim", "ok", "check");
      load(true);
    } catch (e) { onToast(failureMessage("menutup rangkaian", e), "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onToast]);

  const runCancelDecision = React.useCallback(async (id: string) => {
    setBusyId(id);
    try { await api.cancelLeadDecision(id); onToast("Keputusan dibatalkan", "ok"); load(true); }
    catch (e) { onToast(failureMessage("membatalkan keputusan", e), "err", "x-circle"); }
    finally { setBusyId(null); }
  }, [load, onToast]);

  const askCloseFlow = (f: LeadFlowView, how: "submit" | "cancel") => {
    void confirm(how === "submit"
      ? {
        title: "Kirim rangkaian ini?", eyebrow: "lead · rangkaian",
        message: "Semua jawaban yang sudah terkumpul dikirim ke sesi peminta. Rangkaian lalu ditutup dan tidak bisa ditambah lagi.",
        confirmLabel: "Kirim rangkaian", icon: "check", tone: "default",
        run: () => runCloseFlow(f.id, "submit"),
      }
      : {
        title: "Batalkan rangkaian ini?", eyebrow: "lead · rangkaian",
        message: "Rangkaian ditutup tanpa dikirim. Jawaban yang sudah terkumpul tidak sampai ke sesi peminta.",
        confirmLabel: "Tutup tanpa mengirim", icon: "x-circle", tone: "danger",
        run: () => runCloseFlow(f.id, "cancel"),
      });
  };

  const askCancelDecision = (d: LeadDecisionView) => {
    void confirm({
      title: "Batalkan keputusan ini?", eyebrow: "lead · keputusan",
      message: "Keputusan ini ditandai dibatalkan dan tidak lagi berlaku.",
      confirmLabel: "Batalkan keputusan", icon: "x-circle", tone: "danger",
      run: () => runCancelDecision(d.id),
    });
  };

  // Mode: Aktif/Jeda menulis langsung; Mati minta konfirmasi dan menyebut efeknya.
  const setMode = (m: Mode) => {
    if (!cfg) return;
    if (m === "mati") {
      void confirm({
        title: "Matikan lead?",
        eyebrow: "lead · kendali",
        message: "Lead berhenti memutuskan untuk semua project. Sesi yang sudah berjalan tidak diubah, dan pertanyaan yang menunggu tetap menunggu kamu.",
        confirmLabel: "Matikan lead",
        icon: "ban",
        tone: "danger",
        run: () => writeConfig({ ...cfg, enabled: false, paused: false }).then(() => undefined),
      });
      return;
    }
    void writeConfig({ ...cfg, enabled: true, paused: m === "jeda" });
  };

  if (phase === "loading") return <SkeletonList rows={4} label="Memuat lead…" />;
  if (phase === "error" || !state) {
    return <StateBlock kind="error" hint="Gagal memuat status lead." action={() => load()} actionLabel="Coba lagi" />;
  }

  const mode: Mode = !state.config.enabled ? "mati" : state.config.paused ? "jeda" : "aktif";
  const optIn = new Set(state.projects.map((p) => p.projectId));
  const waiting = state.waiting;
  const deciding = new Set(state.deciding);
  // SPEC-479 · `queued`/`gate` punya default di `zLeadStatusView`, tapi respons instance lama bisa tanpa keduanya.
  const queued = new Set(state.queued ?? []);
  const gate = state.gate ?? { inFlight: 0, queued: 0, capacity: 1 };
  // Nama sesi: dari antrean scheduler (punya project & spec), lalu dari jejak keputusan yang tampil.
  const sessionTitle = (id: string) => {
    const qi = (state.queue ?? []).find((x) => x.sessionId === id);
    if (qi) return [projectName(qi.projectId), qi.specId].filter(Boolean).join(" · ");
    const d = decisions.find((x) => x.sessionId === id);
    return d ? [projectName(d.projectId), d.specId].filter(Boolean).join(" · ") : "Sesi (rincian ada di riwayat)";
  };

  // Timeline gabungan, terbaru di atas. Jenis yang tak dipilih tak dirender sama sekali.
  type TimelineItem = { key: string; at: string; d?: LeadDecisionView; f?: LeadFlowView };
  const timeline: TimelineItem[] = [
    ...(kind !== "rangkaian" ? decisions.map((d) => ({ key: `d:${d.id}`, at: d.createdAt, d })) : []),
    ...(kind !== "keputusan" && !flowsError ? flows.map((f) => ({ key: `f:${f.id}`, at: f.openedAt, f })) : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const merged = kind === "semua";
  const timelinePager = merged
    ? <CombinedPager page={decPage}
        pageCount={Math.max(serverPage(decTotal, decPage, LIST_PAGE).pageCount, serverPage(flowTotal, decPage, LIST_PAGE).pageCount)}
        onPage={(n) => { setDecPage(n); setFlowPage(n); }} />
    : kind === "keputusan"
      ? <LeadPager total={decTotal} page={decPage} onPage={setDecPage} unit="keputusan" />
      : <LeadPager total={flowTotal} page={flowPage} onPage={setFlowPage} unit="rangkaian" />;

  const chips: FilterChip[] = filter === "all" ? [] : [{ key: "project", label: `Project: ${projectName(filter)}`, onRemove: () => setFilter("all") }];

  return (
    <div className="hn-lead">
      <p className="hn-lead-summary">
        Lead {MODE_LABEL[mode]} · {waiting.length} menunggu kamu · {queued.size} antre
      </p>

      <div className="hn-lead-layout">
        <div className="hn-lead-main">
          <section className="hn-lead-section" aria-labelledby="lead-menunggu-h">
            <h2 id="lead-menunggu-h" className="hn-lead-h">Menunggu kamu ({waiting.length})</h2>
            {gate.queued > 0 && (
              <p className="hn-lead-note">
                Antrean keputusan penuh: {gate.inFlight} dari {gate.capacity} sedang diputuskan, {gate.queued} menunggu giliran.
              </p>
            )}
            {waiting.length === 0
              ? <p className="hn-lead-note">Tidak ada sesi yang menunggu keputusanmu. Lead menangani sisanya.</p>
              : <ul className="hn-lead-waits">
                  {waiting.map((id) => {
                    // TIGA keadaan, bukan dua: hanya "Menunggu kamu" yang benar-benar butuh manusia.
                    const label = deciding.has(id) ? "Sedang diputuskan" : queued.has(id) ? "Antre giliran" : "Menunggu kamu";
                    const needsYou = !deciding.has(id) && !queued.has(id);
                    return (
                      <WaitingCard key={id} sid={id} title={sessionTitle(id)} label={label} needsYou={needsYou}
                        onGoto={() => onGotoTerminal(id)}
                        onAnswered={() => { onToast("Jawaban kamu dikirim ke sesi", "ok", "check"); load(true); }}
                        onError={(msg) => onToast(msg, "err", "x-circle")} />
                    );
                  })}
                </ul>}
          </section>

          <section className="hn-lead-section" aria-labelledby="lead-riwayat-h">
            <h2 id="lead-riwayat-h" className="hn-lead-h">Riwayat</h2>
            <div className="hn-lead-chips" role="group" aria-label="Jenis riwayat">
              {KIND_CHIPS.map((c) => (
                <button key={c.key} type="button" className="hn-lead-chip" aria-pressed={kind === c.key}
                  onClick={() => {
                    if (c.key === "semua") setFlowPage(decPage);   // timeline gabungan: kedua halaman sejajar
                    setKind(c.key);
                  }}>{c.label}</button>
              ))}
            </div>
            <FilterBar label="Filter riwayat"
              chips={chips}
              filters={
                <Stack gap={3}>
                  <Select size="sm" value={filter} aria-label="saring project"
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
                    options={[{ value: "all", label: "semua project" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
                </Stack>
              }
              filtersLabel="Project"
              onReset={() => setFilter("all")}
              resetLabel="Hapus filter"
              actions={<>
                <ResetViewButton screen="lead" active={filter === "all" ? 0 : 1} />
                <LiveConnectionBadge />
              </>} />
            {loadError && <InlineError message={loadError} onRetry={() => load()} />}
            {flowsError && kind !== "keputusan" && <InlineError message="Gagal memuat rangkaian keputusan." onRetry={() => load()} />}
            {timeline.length === 0
              ? <p className="hn-lead-note">
                  {kind === "rangkaian"
                    ? "Belum ada rangkaian. Satu rangkaian adalah satu urusan: beberapa pertanyaan berurutan sampai kamu kirim."
                    : "Belum ada keputusan. Lead menulis satu baris di sini setiap kali ia memutuskan."}
                </p>
              : <ul className="hn-lead-timeline" aria-label="Riwayat keputusan dan rangkaian">
                  {timeline.map((item) => item.d
                    ? <DecisionItem key={item.key} d={item.d} projectName={projectName} onOverride={override}
                        onCancel={askCancelDecision} busyId={busyId} ask={confirm} />
                    : <FlowItem key={item.key} f={item.f!} busyId={busyId} onClose={askCloseFlow} />)}
                </ul>}
            {timelinePager}
          </section>
        </div>

        <aside className="hn-lead-side" aria-label="Kendali lead">
          <section className="hn-lead-section" aria-labelledby="lead-kendali-h">
            <h2 id="lead-kendali-h" className="hn-lead-h">Kendali</h2>
            <div className="hn-lead-mode">
              <RadioGroup label="Mode lead" value={mode} onChange={(v: string) => setMode(v as Mode)}>
                <Radio value="aktif" label="Aktif" description="Lead memutuskan untuk project yang diurusnya." disabled={busy} />
                <Radio value="jeda" label="Jeda" description="Keputusan baru berhenti. Sesi yang berjalan tidak diubah." disabled={busy} />
                <Radio value="mati" label="Mati" description="Lead berhenti total. Pertanyaan yang menunggu tetap menunggu kamu." disabled={busy} />
              </RadioGroup>
            </div>
            {/* Batas keamanan terlihat sebagai callout, bukan catatan kecil. */}
            <Callout tone="info" title="Dikunci secara teknis">
              Produksi, VPS, dan penghapusan data tetap terkunci untuk lead, apa pun setelannya.
            </Callout>
          </section>

          <details className="hn-lead-disclosure">
            <summary>Project yang dipimpin · {optIn.size} dari {projects.length} diurus lead</summary>
            <p className="hn-lead-hint">Lead hanya menyentuh project yang diserahkan kepadanya. Default: tidak diserahkan.</p>
            {projects.length === 0
              ? <p className="hn-lead-note">Belum ada project.</p>
              : <RowList label="Project yang dipimpin lead">
                  {projects.map((p) => {
                    const row = state.projects.find((x) => x.projectId === p.id);
                    const handled = optIn.has(p.id);
                    return (
                      <DenseRow key={p.id} actions={<>
                        {handled && (row?.paused
                          ? <Button size="sm" variant="ghost" leftIcon="play" disabled={busy} onClick={() => togglePause(p.id, false)}>Lanjutkan</Button>
                          : <Button size="sm" variant="ghost" leftIcon="pause" disabled={busy} onClick={() => togglePause(p.id, true)}>Jeda</Button>)}
                        {handled
                          ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busyId === p.id} onClick={() => toggleOptIn(p.id, false)}>Tarik dari lead</Button>
                          : <Button size="sm" leftIcon="check" disabled={busyId === p.id} onClick={() => toggleOptIn(p.id, true)}>Serahkan ke lead</Button>}
                      </>}>
                        <span className="hn-lead-project-name">{p.name}</span>
                        {row && <span className="hn-lead-project-meta">{row.decisions24h} keputusan 24 jam terakhir · {row.openSessions} sesi terbuka</span>}
                        <Badge tone={handled ? (row?.paused ? "warn" : "ok") : "neutral"} size="sm">
                          {handled ? (row?.paused ? "dijeda" : "diurus lead") : "tidak diurus"}
                        </Badge>
                      </DenseRow>
                    );
                  })}
                </RowList>}
          </details>

          <details className="hn-lead-disclosure">
            <summary>Pengaturan lead</summary>
            <div className="hn-lead-settings">
              <div className="hn-lead-settings-grid">
                <Field label="Lead memeriksa tiap (menit)" hint="1–1440. Berlaku setelah Simpan.">
                  <Input type="number" min={1} max={1440} aria-label="lead memeriksa tiap (menit)" placeholder="mis. 5"
                    value={settings.draft.everyMin} disabled={!cfg}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => settings.setDraft({ ...settings.draft, everyMin: e.target.value })} />
                </Field>
                <Field label="Batas waktu keputusan (detik)" hint="10–900. Lewat dari ini, keputusan gagal.">
                  <Input type="number" min={10} max={900} aria-label="batas waktu keputusan (detik)" placeholder="mis. 600"
                    value={settings.draft.timeoutSec} disabled={!cfg}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => settings.setDraft({ ...settings.draft, timeoutSec: e.target.value })} />
                </Field>
                <Field label="Jawaban otomatis per sesi (maks)" hint="1–20. Setelah batas, sesi diserahkan ke kamu.">
                  <Input type="number" min={1} max={20} aria-label="maksimum jawaban otomatis per sesi" placeholder="mis. 3"
                    value={settings.draft.maxAutoAnswers} disabled={!cfg}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => settings.setDraft({ ...settings.draft, maxAutoAnswers: e.target.value })} />
                </Field>
                <Field label="Syarat integrasi ke main" hint="Berlaku untuk integrasi yang diputuskan lead.">
                  <Select size="sm" aria-label="syarat integrasi ke main"
                    value={settings.draft.requireGreen ? "wajib" : "bebas"}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      settings.setDraft({ ...settings.draft, requireGreen: e.target.value === "wajib" })}
                    options={[{ value: "wajib", label: "plan harus tuntas dulu" }, { value: "bebas", label: "tanpa syarat" }]} />
                </Field>
              </div>
              {/* SPEC-488 · mesin yang MENJALANKAN lead. `?.` disengaja: dashboard bisa lebih baru daripada server. */}
              <div data-testid="lead-engine-line" className="hn-lead-note">
                Model lead: {state.config.engine?.enabled
                  ? <>{AGENT_RUNTIME_LABELS[state.config.engine.agent]} · <code>{state.config.engine.model}</code> · <code>{state.config.engine.effort}</code></>
                  : <>ikut default global · atur di Settings → Model sesi</>}
              </div>
              <div className="hn-lead-footer">
                <span role="status" aria-live="polite">{settingsDirty ? "Ada perubahan yang belum disimpan." : ""}</span>
                <span className="hn-lead-chips">
                  <Button size="sm" variant="ghost" disabled={!settingsDirty || busy} onClick={() => settings.setDraft(toDraft(state.config))}>Batal</Button>
                  <Button size="sm" leftIcon="check" disabled={!settingsDirty || busy || !cfg} onClick={() => void saveSettings()}>Simpan pengaturan</Button>
                </span>
              </div>
            </div>
          </details>
        </aside>
      </div>
      {dialog}
    </div>
  );
}
