/* LeadScreen — panel hanoman-lead (SPEC-409, ADR-0091). Screen mandiri (pola SchedulerScreen /
   VpsScreen): memuat statusnya sendiri lewat HTTP, lalu disegarkan langganan berparameter di
   kanal `/events/ws` yang SUDAH ADA (SPEC-908) — tetap tanpa kanal WebSocket baru (AC-26).

   Urutan halaman (Audit UI/UX 2026-10 · 1G): "Menunggu kamu" paling atas — itu satu-satunya hal yang
   menuntut mata operator — lalu kendali, project, rangkaian keputusan, dan jejak keputusan
   (pertanyaan → jawaban → alasan → rujukan) dengan aksi Ubah jawaban & Batalkan per baris. */
import React from "react";
import { Card, Button, Badge, Input, Select, StateBlock, Icon, Checkbox, Radio, Pager, serverPage, LiveConnectionBadge, useConfirm } from "../ds";
import type { ConfirmOptions } from "../ds";
import { api } from "../api/client";
import { useLiveTopic } from "../api/live";
import type { Lead, LeadStatusView, LeadDecisionView, LeadFlowView } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { usePersistedState, useResetOnChange, ResetViewButton, isStr, isNum } from "../ui-state";
import { failureMessage } from "../lib/report-error";
import { agoLabel, clampNumber, InlineError, useServerDraft } from "./sched-lead-shared";

// SPEC-908 · tinggal kadens FALLBACK; jalur normalnya langganan `/events/ws`.
const POLL_MS = 5000;
// SPEC-523 · ukuran halaman kedua daftar lead. 393 baris jejak di instalasi hidup dulu dibalas
// tanpa `total` dan berplafon `take` 50 — data lama tak terjangkau dari layar.
const LIST_PAGE = 20;
const QUESTION_MAX = 400;

/* Pembungkus tipis Pager DS supaya kedua daftar lead memakai ukuran halaman yang sama dan
   perhitungan `serverPage` tak diduplikasi. */
function LeadPager({ total, page, onPage, unit }:
  { total: number; page: number; onPage: (n: number) => void; unit: string }) {
  const sp = serverPage(total, page, LIST_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />;
}

// Tone DS (feedback.tsx) — disempitkan supaya salah tulis nada tertangkap tsc, bukan tampil pucat.
type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
// Istilah baku per enum. Layar tak pernah menampilkan nilai mentah (`ragu`, `pulse`, `integrate-main`).
const CONF_LABEL: Record<string, string> = { tinggi: "yakin tinggi", sedang: "yakin sedang", ragu: "ragu-ragu" };
const CONF_TONE: Record<string, Tone> = { tinggi: "ok", sedang: "neutral", ragu: "warn" };
const DECISION_STATUS_LABEL: Record<string, string> = { berlaku: "Berlaku", ditimpa: "Ditimpa", dibatalkan: "Dibatalkan", gagal: "Gagal" };
const STATUS_TONE: Record<string, Tone> = { berlaku: "ok", ditimpa: "warn", dibatalkan: "neutral", gagal: "err" };
const KIND_LABEL: Record<string, string> = {
  answer: "jawaban", order: "urutan kerja", collision: "tabrakan area",
  quality: "mutu hasil", refusal: "tindakan ditolak",
};
const GATE_LABEL: Record<string, string> = {
  contract: "kontrak", detected: "deteksi otomatis", pulse: "pemeriksaan berkala",
};
const ACTION_LABEL: Record<string, string> = {
  "answer-session": "jawab di sesi", "start-session": "mulai sesi", "stop-session": "hentikan sesi",
  "resume-session": "lanjutkan sesi", "restart-session": "ulangi dari awal", "order-queue": "atur urutan antrean",
  "hold-work": "tunda pekerjaan", "push-branch": "dorong branch", "integrate-main": "integrasi ke main",
  "run-migration": "jalankan migrasi lokal",
};
// SPEC-485 · ADR-0102 · status satu RANTAI keputusan. `menunggu` diberi nada peringatan: alur yang
// terbuka tanpa satu pun jawaban berlaku memang keadaan yang menuntut mata operator.
const FLOW_TONE: Record<string, Tone> = {
  menunggu: "warn", sebagian: "info", selesai: "ok", dibatalkan: "neutral",
};
const FLOW_LABEL: Record<string, string> = {
  menunggu: "Menunggu kamu", sebagian: "Sebagian terjawab", selesai: "Selesai", dibatalkan: "Dibatalkan",
};
const FLOW_OPEN = new Set(["menunggu", "sebagian"]);
const FLOW_CLOSE_LABEL: Record<string, string> = {
  tunggal: "sekali jalan", submit: "dikirim", operator: "ditutup oleh kamu", kedaluwarsa: "kedaluwarsa",
};

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
      background: "var(--surface-card)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

/** Rem darurat + knob. Jeda menghentikan keputusan BARU; sesi yang berjalan tak disentuh (AC-27).
    Kolom angka disimpan saat kehilangan fokus / Enter, memakai draft lokal — tak ada PUT per ketukan,
    dan tak ada kolom yang dinonaktifkan selagi menyimpan (itu yang dulu merampas fokus). */
function ControlBar({ cfg, onWrite, ask }: {
  cfg: Lead;
  onWrite: (next: Lead, quiet?: boolean) => Promise<boolean>;
  ask: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const { draft: nums, setDraft: setNums } = useServerDraft({
    everyMin: String(cfg.everyMin), timeoutSec: String(cfg.timeoutSec), maxAutoAnswers: String(cfg.maxAutoAnswers),
  });
  const [save, setSave] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  // Patch berturutan tak boleh saling menimpa: tiap patch memakai hasil patch sebelumnya, bukan cfg
  // yang belum sempat dimuat ulang dari server.
  const latestServer = React.useRef(cfg);
  latestServer.current = cfg;
  const pending = React.useRef(cfg);
  React.useEffect(() => { pending.current = cfg; }, [cfg]);
  const patch = (p: Partial<Lead>, quiet = false): Promise<boolean> => {
    pending.current = { ...pending.current, ...p };
    return onWrite(pending.current, quiet).then((ok) => {
      if (!ok) pending.current = latestServer.current;   // tulisan gagal: kembali ke yang diketahui server
      return ok;
    });
  };

  const commit = (key: "everyMin" | "timeoutSec" | "maxAutoAnswers", min: number, max: number) => {
    const v = clampNumber(nums[key], min, max, pending.current[key]);
    setNums((d) => ({ ...d, [key]: String(v) }));
    if (v === pending.current[key]) return;   // tak ada yang berubah → tak perlu PUT
    setSave("saving");
    void patch({ [key]: v }, true).then((ok) => setSave(ok ? "saved" : "error"));
  };
  const enterCommits = (key: "everyMin" | "timeoutSec" | "maxAutoAnswers", min: number, max: number) =>
    (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); commit(key, min, max); } };

  const askMatikan = () => {
    void ask({
      title: "Matikan lead?",
      eyebrow: "lead · kendali",
      message: "Lead berhenti memutuskan untuk semua project. Sesi yang sudah berjalan tidak diubah, dan pertanyaan yang menunggu tetap menunggu kamu.",
      confirmLabel: "Matikan lead",
      icon: "ban",
      tone: "danger",
      run: () => patch({ enabled: false, paused: false }),
    });
  };

  return (
    <Card eyebrow="lead · kendali" title="hanoman-lead">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Badge tone={cfg.enabled ? (cfg.paused ? "warn" : "ok") : "neutral"}>
          {cfg.enabled ? (cfg.paused ? "dijeda" : "aktif") : "mati"}
        </Badge>
        {cfg.enabled
          ? <Button size="sm" variant="danger" leftIcon="ban" onClick={askMatikan}>Matikan</Button>
          : <Button size="sm" leftIcon="play" onClick={() => void patch({ enabled: true })}>Nyalakan</Button>}
        {cfg.enabled && (cfg.paused
          ? <Button size="sm" leftIcon="play" onClick={() => void patch({ paused: false })}>Lanjutkan</Button>
          : <Button size="sm" variant="secondary" leftIcon="pause" onClick={() => void patch({ paused: true })}>Jeda</Button>)}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          lead memeriksa tiap
          <Input type="number" min={1} style={{ width: 76 }} aria-label="lead memeriksa tiap (menit)"
            placeholder="5" value={nums.everyMin}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNums((d) => ({ ...d, everyMin: e.target.value }))}
            onBlur={() => commit("everyMin", 1, 1440)} onKeyDown={enterCommits("everyMin", 1, 1440)} />
          menit
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          batas waktu keputusan
          <Input type="number" min={10} max={900} style={{ width: 84 }} aria-label="batas waktu keputusan (detik)"
            placeholder="600" value={nums.timeoutSec}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNums((d) => ({ ...d, timeoutSec: e.target.value }))}
            onBlur={() => commit("timeoutSec", 10, 900)} onKeyDown={enterCommits("timeoutSec", 10, 900)} />
          detik
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          jawaban otomatis per sesi (maks)
          <Input type="number" min={1} max={20} style={{ width: 76 }} aria-label="maksimum jawaban otomatis per sesi"
            placeholder="3" value={nums.maxAutoAnswers}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNums((d) => ({ ...d, maxAutoAnswers: e.target.value }))}
            onBlur={() => commit("maxAutoAnswers", 1, 20)} onKeyDown={enterCommits("maxAutoAnswers", 1, 20)} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)" }}>
          syarat integrasi ke main
          <Select size="sm" aria-label="syarat integrasi ke main"
            value={cfg.requireGreenBeforeIntegrate ? "wajib" : "bebas"}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              void patch({ requireGreenBeforeIntegrate: e.target.value === "wajib" })}
            options={[{ value: "wajib", label: "plan harus tuntas dulu" }, { value: "bebas", label: "tanpa syarat" }]} />
        </label>
        <span role="status" aria-live="polite"
          style={{ fontSize: "var(--text-xs)", color: save === "error" ? "var(--clay-500)" : "var(--text-subtle)" }}>
          {save === "saving" ? "Menyimpan…" : save === "saved" ? "Tersimpan" : save === "error" ? "Gagal menyimpan. Ubah lagi untuk mencoba ulang." : ""}
        </span>
      </div>
      {/* SPEC-488 · mesin yang MENJALANKAN lead. Disetel di Settings → Model sesi (satu tempat,
          bersama katalog model kedua agen); ditampilkan di sini karena inilah layar tempat
          operator mengurus lead. `?.` disengaja: dashboard bisa lebih baru daripada server yang
          dilayaninya (paket npm global, ADR-0087) dan server lama tak mengirim blok `engine`. */}
      <div data-testid="lead-engine-line" style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 10 }}>
        Model lead: {cfg.engine?.enabled
          ? <>{cfg.engine.agent === "codex" ? "Codex CLI" : "Claude Code"} · <code>{cfg.engine.model}</code> · <code>{cfg.engine.effort}</code></>
          : <>ikut default global · atur di Settings → Model sesi</>}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginTop: 6 }}>
        Lead memutuskan lalu melapor. Produksi/VPS dan penghapusan data terkunci secara teknis, apa pun setelannya.
      </div>
    </Card>
  );
}

/**
 * SPEC-485 · ADR-0102 · kontrol yang MENYATAKAN bentuk pilihannya: radio untuk tunggal, checkbox
 * untuk jamak. Pilihan tunggal berupa `radiogroup` dengan panah (pola WAI-ARIA): panah memindahkan
 * pilihan sekaligus fokus.
 */
function ChoicePicker({ label, options, multi, value, onChange }: {
  label: string; options: string[]; multi: boolean; value: string[]; onChange: (next: string[]) => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const toggle = (o: string) => {
    if (!multi) { onChange([o]); return; }   // tunggal: yang terakhir dipilih menang
    onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (multi) return;
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1
      : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step || options.length === 0) return;
    e.preventDefault();
    const cur = value.length ? options.indexOf(value[0]!) : -1;
    const base = cur < 0 ? (step > 0 ? -1 : options.length) : cur;
    const next = (base + step + options.length) % options.length;
    onChange([options[next]!]);
    box.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div ref={box} role={multi ? "group" : "radiogroup"} aria-label={label} onKeyDown={onKeyDown}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {options.map((o) => multi
        ? <Checkbox key={o} checked={value.includes(o)} label={o} onChange={() => toggle(o)} />
        : <Radio key={o} checked={value.includes(o)} label={o} onChange={() => toggle(o)} />)}
    </div>
  );
}

function DecisionRow({ d, projectName, onOverride, onCancel, busyId }: {
  d: LeadDecisionView;
  projectName: (id: string) => string;
  onOverride: (id: string, answer: string, choices: string[]) => Promise<boolean>;
  onCancel: (d: LeadDecisionView) => void;
  busyId: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [draftChoices, setDraftChoices] = React.useState<string[]>([]);
  // SPEC-485 · `choices` bentuk yang berlaku; baris dari server LAMA hanya punya pasangan skalar,
  // dan `?? []` di sepanjang berkas ini bukan kehati-hatian berlebih — dashboard bisa lebih baru
  // daripada server yang dilayaninya (paket npm global, ADR-0087).
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
  // Draft jawaban dikosongkan HANYA setelah API sukses; galat menyisakan ketikan operator utuh.
  const submit = async () => {
    const ok = await onOverride(d.id, draft.trim() || draftChoices.join("; "), draftChoices);
    if (ok) closeForm();
  };
  return (
    <div style={{ padding: "10px 12px", border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-sm)", background: "var(--surface-card)", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge tone={STATUS_TONE[d.status] ?? "neutral"} size="sm">{DECISION_STATUS_LABEL[d.status] ?? d.status}</Badge>
        <Badge tone={CONF_TONE[d.confidence] ?? "neutral"} size="sm">{CONF_LABEL[d.confidence] ?? d.confidence}</Badge>
        <Badge tone="neutral" size="sm">{KIND_LABEL[d.kind] ?? d.kind}</Badge>
        <Badge tone="neutral" size="sm">{GATE_LABEL[d.gate] ?? d.gate}</Badge>
        {d.weighty && <Badge tone="warn" size="sm">berbobot</Badge>}
        {/* SPEC-480 · pilihan sebagai data: operator membacanya sekilas, bukan dari prosanya.
            `?? []` bukan kehati-hatian berlebih — dashboard bisa lebih baru daripada server yang
            dilayaninya (paket npm global, ADR-0087), dan baris tanpa field ini akan meruntuhkan
            SELURUH panel, bukan cuma badge-nya. */}
        {picked.length > 0 && options.length > 0 &&
          <Badge tone="brass" size="sm">
            {picked.length > 1
              ? `${picked.length} dari ${options.length} opsi`
              : `opsi ${picked[0]!.index} dari ${options.length}`}
          </Badge>}
        {(d.missing ?? []).length > 0 && <Badge tone="warn" size="sm">kurang konteks</Badge>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{agoLabel(d.createdAt)}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: "var(--text-sm)", color: "var(--text-subtle)", whiteSpace: "pre-wrap" }}>
        {question}
      </div>
      <div style={{ marginTop: 4, color: "var(--text-strong)", fontWeight: 500, whiteSpace: "pre-wrap" }}>
        {/* Label opsi terpilih menang atas prosa: itulah yang benar-benar dikirim ke peminta.
            SPEC-485 · SEMUA yang terpilih, bukan hanya yang pertama. */}
        {picked.length
          ? picked.map((c) => c.option).join(" · ")
          : (d.answer || <em style={{ fontWeight: 400, color: "var(--text-muted)" }}>tidak ada jawaban</em>)}
      </div>
      <div style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-subtle)", whiteSpace: "pre-wrap" }}>
        {d.reason}
      </div>
      {d.refs.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {d.refs.map((r) => (
            <span key={r} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)",
              color: "var(--text-muted)", border: "1px solid var(--border-hair)",
              borderRadius: "var(--radius-sm)", padding: "1px 6px" }}>{r}</span>
          ))}
        </div>
      )}
      {(d.missing ?? []).length > 0 && (
        <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
          Yang kurang: {d.missing.join(" · ")}
        </div>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          {where}{action ? ` · ${action}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {d.status === "berlaku" && !open &&
          <Button size="sm" variant="ghost" leftIcon="edit-3" onClick={() => setOpen(true)}>Ubah jawaban</Button>}
        {d.status === "berlaku" &&
          <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busyHere}
            onClick={() => onCancel(d)}>Batalkan</Button>}
      </div>
      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {options.length > 0 && (
            <ChoicePicker label={`Pilihan jawaban${d.specId ? ` untuk ${d.specId}` : ""}`}
              options={options} multi={multi} value={draftChoices} onChange={setDraftChoices} />
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input style={{ flex: 1, minWidth: 180 }} aria-label={`Jawaban kamu${d.specId ? ` untuk ${d.specId}` : ""}`}
              placeholder="mis. pilih opsi 2, pakai Node 22"
              value={draft} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} />
            {/* Centang saja sudah cukup: labelnya yang jadi jawaban bila kolom prosanya kosong. */}
            <Button size="sm" variant="ghost" disabled={busyHere} onClick={closeForm}>Batal</Button>
            <Button size="sm" leftIcon="check"
              disabled={(!draft.trim() && draftChoices.length === 0) || busyHere}
              onClick={() => void submit()}>Kirim jawaban</Button>
          </div>
        </div>
      )}
    </div>
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
  // SPEC-740 · ADR-0115 · penyaring project & nomor halaman kedua daftar bertahan.
  const [filter, setFilter] = usePersistedState("lead", "filter", "all", isStr);
  // Sudah ada data yang tampil? Kalau ya, muat ulang (ganti filter/halaman) TIDAK kembali ke loading
  // penuh — layar tetap memegang data lama dan draft di dalam barisnya sampai data baru datang.
  const hasData = React.useRef(false);

  const projectName = React.useCallback((id: string) => projects.find((p) => p.id === id)?.name ?? "Project lain", [projects]);

  const load = React.useCallback((silent = false) => {
    if (!silent && !hasData.current) setPhase("loading");
    Promise.all([
      api.getLeadStatus(),
      api.getLeadDecisions({ projectId: filter === "all" ? undefined : filter, page: decPage, limit: LIST_PAGE }),
      // SPEC-485 · rantai. Instance lama tak punya endpoint ini; kegagalannya tak boleh menjatuhkan
      // seluruh panel (ADR-0087: dashboard bisa lebih baru daripada server yang dilayaninya). Ia
      // ditandai sebagai galat di kartunya — bukan dibiarkan tampil sebagai "belum ada rangkaian".
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
  // AC-15 · GANTI penyaring = kembali ke halaman 1. Tanpa ini, halaman 5 dari filter lama
  // menjawab daftar filter baru yang cuma punya 2 halaman → daftar kosong tanpa sebab.
  // `useResetOnChange`, bukan `useEffect([filter])`: effect ber-dependensi juga menyala saat
  // MOUNT dan akan menghapus nomor halaman yang dipersistensi SPEC-740/ADR-0115.
  useResetOnChange(filter, () => { setDecPage(1); setFlowPage(1); });
  // SPEC-908 · satu topik untuk ketiga daftar — cermin `load()` yang memang sudah satu
  // `Promise.all`. Memecahnya jadi tiga topik berarti tiga frame yang bisa mendarat terpisah, dan
  // layar akan menampilkan campuran dua generasi data yang hari ini tak mungkin terjadi.
  // POLL_MS tinggal kadens fallback (server lama / WS terhalang).
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

  // SPEC-485 · menutup rangkaian adalah tindakan operator, bukan keputusan lead — tak ada agen yang
  // dipanggil untuknya. Dijalankan dari dialog konfirmasi (lihat askCloseFlow).
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

  if (phase === "loading") return <StateBlock kind="loading" />;
  if (phase === "error" || !state) {
    return <StateBlock kind="error" hint="Gagal memuat status lead." action={() => load()} actionLabel="Coba lagi" />;
  }

  const optIn = new Set(state.projects.map((p) => p.projectId));
  const waiting = state.waiting;
  const deciding = new Set(state.deciding);
  // SPEC-479 · `queued`/`gate` punya default di `zLeadStatusView`, tapi respons instance lama
  // (atau hub yang belum di-update) tetap bisa datang tanpa keduanya — jangan andalkan zod di sini.
  const queued = new Set(state.queued ?? []);
  const gate = state.gate ?? { inFlight: 0, queued: 0, capacity: 1 };
  // Sesi di "Menunggu kamu" hanya dikenal sebagai ID. Namanya dicari dari jejak keputusan yang sedang
  // tampil; bila tak ada di halaman ini, dinyatakan apa adanya (bukan ID mentah).
  const sessionTitle = (id: string) => {
    const d = decisions.find((x) => x.sessionId === id);
    return d ? [projectName(d.projectId), d.specId].filter(Boolean).join(" · ") : "Sesi (rincian ada di jejak keputusan)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      {/* SPEC-479 · gerbang konkurensi. Ditampilkan hanya saat ia benar-benar mengikat: batas yang diam
          tak perlu diumumkan, batas yang menahan antrean wajib. Tanpa baris ini "lead sedang penuh"
          tak terbedakan dari "lead diam" — salah baca yang melahirkan tiket SPEC-479. */}
      <Card eyebrow="lead · menunggu kamu" title={`Menunggu kamu (${waiting.length})`}>
        {gate.queued > 0 && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 8 }}>
            Antrean keputusan penuh: {gate.inFlight} dari {gate.capacity} sedang diputuskan, {gate.queued} menunggu giliran.
          </div>
        )}
        {waiting.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Tidak ada sesi yang menunggu keputusanmu. Lead menangani sisanya.</div>
          : waiting.map((id) => {
            // TIGA keadaan, bukan dua. Di pane ketiganya terlihat sama — marker terisi, agen diam —
            // tapi hanya "Menunggu kamu" yang benar-benar butuh manusia.
            const label = deciding.has(id) ? "Sedang diputuskan" : queued.has(id) ? "Antre giliran" : "Menunggu kamu";
            const needsYou = !deciding.has(id) && !queued.has(id);
            return (
              <RowShell key={id}>
                <Icon name={deciding.has(id) ? "loader" : queued.has(id) ? "clock" : "help-circle"} />
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)" }}>{sessionTitle(id)}</span>
                <Badge tone={needsYou ? "warn" : "ok"} size="sm">{label}</Badge>
                <Button size="sm" variant="ghost" leftIcon="terminal" onClick={() => onGotoTerminal(id)}>Buka di Terminal</Button>
              </RowShell>
            );
          })}
      </Card>

      <ControlBar cfg={state.config} onWrite={writeConfig} ask={confirm} />

      <Card eyebrow="lead · project" title="Project yang diurus lead">
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", marginBottom: 10 }}>
          Lead hanya menyentuh project yang diserahkan kepadanya. Default: tidak diserahkan.
        </div>
        {projects.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>Belum ada project.</div>
          : projects.map((p) => {
            const row = state.projects.find((x) => x.projectId === p.id);
            const handled = optIn.has(p.id);
            return (
              <RowShell key={p.id}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)", fontWeight: 500 }}>{p.name}</span>
                {row && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  {row.decisions24h} keputusan 24 jam terakhir · {row.openSessions} sesi terbuka
                </span>}
                <Badge tone={handled ? (row?.paused ? "warn" : "ok") : "neutral"} size="sm">
                  {handled ? (row?.paused ? "dijeda" : "diurus lead") : "tidak diurus"}
                </Badge>
                {handled && (row?.paused
                  ? <Button size="sm" variant="ghost" leftIcon="play" disabled={busy} onClick={() => togglePause(p.id, false)}>Lanjutkan</Button>
                  : <Button size="sm" variant="ghost" leftIcon="pause" disabled={busy} onClick={() => togglePause(p.id, true)}>Jeda</Button>)}
                {handled
                  ? <Button size="sm" variant="ghost" leftIcon="ban" disabled={busyId === p.id} onClick={() => toggleOptIn(p.id, false)}>Tarik dari lead</Button>
                  : <Button size="sm" leftIcon="check" disabled={busyId === p.id} onClick={() => toggleOptIn(p.id, true)}>Serahkan ke lead</Button>}
              </RowShell>
            );
          })}
      </Card>

      {/* SPEC-485 · ADR-0102 · satu rangkaian = satu urusan, dari pertanyaan pertama sampai dikirim.
          Statusnya dijawab satu kolom, bukan disimpulkan ulang dari kumpulan baris jejak. */}
      <Card eyebrow="lead · rangkaian keputusan" title={`Rangkaian keputusan (${flowTotal})`}>
        {flowsError && <InlineError message="Gagal memuat rangkaian keputusan." onRetry={() => load()} />}
        {!flowsError && flows.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
              Belum ada rangkaian. Satu rangkaian adalah satu urusan: beberapa pertanyaan berurutan sampai kamu kirim.
            </div>
          : flows.map((f) => (
            <RowShell key={f.id}>
              <Badge tone={FLOW_TONE[f.status] ?? "neutral"} size="sm">{FLOW_LABEL[f.status] ?? f.status}</Badge>
              <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)" }}>{f.title}</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {f.steps} langkah · {agoLabel(f.openedAt)}
                {f.closeReason ? ` · ${FLOW_CLOSE_LABEL[f.closeReason] ?? f.closeReason}` : ""}
              </span>
              {FLOW_OPEN.has(f.status) && <>
                <Button size="sm" leftIcon="check" disabled={busyId === f.id}
                  onClick={() => askCloseFlow(f, "submit")}>Kirim rangkaian</Button>
                <Button size="sm" variant="ghost" leftIcon="x-circle" disabled={busyId === f.id}
                  onClick={() => askCloseFlow(f, "cancel")}>Batalkan rangkaian</Button>
              </>}
            </RowShell>
          ))}
        <LeadPager total={flowTotal} page={flowPage} onPage={setFlowPage} unit="rangkaian" />
      </Card>

      <Card eyebrow="lead · jejak keputusan" title={`Keputusan (${decTotal})`}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Select size="sm" value={filter} aria-label="saring project"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
              options={[{ value: "all", label: "semua project" },
                ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
            <ResetViewButton screen="lead" active={filter === "all" ? 0 : 1} />
            <LiveConnectionBadge />
          </div>
        }>
        {loadError && <InlineError message={loadError} onRetry={() => load()} />}
        {decisions.length === 0
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
              Belum ada keputusan. Lead menulis satu baris di sini setiap kali ia memutuskan.
            </div>
          : decisions.map((d) => (
            <DecisionRow key={d.id} d={d} projectName={projectName} onOverride={override} onCancel={askCancelDecision} busyId={busyId} />
          ))}
        <LeadPager total={decTotal} page={decPage} onPage={setDecPage} unit="keputusan" />
      </Card>
      {dialog}
    </div>
  );
}
