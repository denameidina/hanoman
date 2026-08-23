/* App.tsx — navigation + state, wired to the API. Ported from the
   prototype App.jsx: window.HN → api.* on mount; every mutating handler
   calls the client and updates state from the response. */
import React from "react";
import { NotificationsProvider } from "./notifications/NotificationsContext";
import { notifTarget } from "./notifications/target";
import { Shell, NAV_KEYS, Modal, Field, HnTextarea, Button, StatusPill, Select, Input, Switch, Checkbox, MultiSelect, Tabs, Toast, useToast, StateBlock, useConfirm } from "./ds";
import { usePersistedState, pruneUiState, oneOf, isStr } from "./ui-state";
import { api, ApiError, type TerminalSession } from "./api/client";
import { subscribe } from "./api/events";
import type { ProjectView, Spec, AuthStatus, UserView, Notification, BreakdownItem, DeviceTokenView, HandledByEntry, SetupStatus, SessionAsk } from "@hanoman/shared";
import { flowForSource, isGoalShapedFlow, payloadShapeFor, coerceCodexEffort, codexModel, codexClientTooOld, CODEX_DEFAULTS, METHODS, METHOD_IDS, resolveMethod, type Agent, type VerifyScope, type AutoMerge, type MethodSkillStatus } from "@hanoman/shared";
// SPEC-517 · katalog runtime picker hidup di satu berkas, dipakai bersama picker "Sesi baru"
// di halaman Terminal — dua picker yang berselisih pendapat adalah kelas bug yang sudah mahal.
import { runtimeModels, runtimeEfforts, runtimeFor, type RuntimeDefs } from "./screens/session-runtime";
import { AttachmentPicker } from "./screens/SpecAttachments";
import { AuthScreen } from "./screens/AuthScreen";
import { SetupWizard, UnhardenedBanner } from "./screens/SetupWizard";
import { ClientPortal } from "./portal/ClientPortal";
import { AuthProvider } from "./auth/AuthContext";
import type { ProjectVM } from "./screens/types";
import { branchOptions } from "./screens/branch";
import { FolderPicker } from "./screens/FolderPicker";
import { HandledByChips } from "./screens/HandledByChips";
import { repoBasename, cloneErrorText } from "./screens/git-remote";
import { parseSpecHash, parseChangelogHash, changelogDeepLink } from "./screens/deeplink";
import { OverviewScreen } from "./screens/OverviewScreen";
import { DalangHanomanScreen } from "./screens/DalangHanomanScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { ProjectDetailScreen } from "./screens/ProjectDetailScreen";
import { BacklogScreen } from "./screens/BacklogScreen";
import { TriageScreen } from "./screens/TriageScreen";
import { PrdScreen, NewPrdModal, type PrdPrefill, type PrdBriefForm } from "./screens/PrdScreen";
import type { AuditEscalation } from "@hanoman/shared";
import { TerminalScreen } from "./screens/TerminalScreen";
import { IdeScreen } from "./screens/IdeScreen";
import { VpsScreen } from "./screens/VpsScreen";
import { SchedulerScreen } from "./screens/SchedulerScreen";
import { LeadScreen } from "./screens/LeadScreen";
import { DocsWorkspace } from "./screens/DocsWorkspace";
import { ChangelogScreen } from "./screens/ChangelogScreen";
// SPEC-585 · pet maskot. Dipasang di App, BUKAN di dalam Shell: <Shell> ditulis ulang di tiap
// cabang `section`, jadi pet yang tinggal di sana lahir kembali tiap navigasi — animasi idle mulai
// dari nol dan keadaan transient hilang persis saat operator pindah layar untuk melihatnya.
import { HanomanPet } from "./screens/HanomanPet";
import { ReviewScreen } from "./screens/ReviewScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

const SEVERITY =[{ value: "critical", label: "Critical" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" }];
const PRIORITY = [{ value: "tinggi", label: "Tinggi" }, { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" }];

type SpecForm = { kind: string; project: string; title: string; context: string; outcome: string; constraints: string;
  priority: string; severity: string; steps: string; expected: string; actual: string; env: string; branchFrom: string; fromAudit: string;
  // SPEC-407 · ADR-0089 · backlog goal: goal yang dikejar + bukti berhentinya.
  goal: string; done: string;
  // SPEC-447 · ADR-0093 · backlog yang harus selesai & ter-merge sebelum item ini boleh jalan.
  dependsOn: string[];
  // SPEC-843 · ADR-0124 · lampiran yang ditahan di memori sampai item lahir — ia butuh specId.
  attachments: File[] };
// SPEC-210 (PRD take-to-backlog) + SPEC-237 (promosi audit → Finding QA) menyeed NewSpecModal.
// Semua opsional → PrdPrefill (field wajib) tetap assignable ke sini.
// SPEC-244 · branchFrom (teruskan branch PRD/audit) + fromAudit (sinyal skip-audit) juga di-seed.
type SpecPrefill = { project?: string; title?: string; context?: string; outcome?: string; prdPath?: string;
  kind?: string; steps?: string; actual?: string; severity?: string; branchFrom?: string; fromAudit?: string;
  // SPEC-826 · batasan pengerjaan kini dimiliki KETIGA bentuk payload, jadi ia bisa ikut di-seed.
  constraints?: string;
  goal?: string; done?: string };   // SPEC-407 · seed dari "Take ke backlog → sebagai goal"

// SPEC-252 · ADR-0061 — picker model & effort PER SESI saat Start backlog. Default = setelan global
// (GET /settings); nilai terpilih dikirim ke POST /terminal/sessions dan jadi argv `--model`/`--effort`
// saat sesi lahir. Sesi = satu proses satu model seumur hidup (matrix per-fase ADR-0058 dicabut).
export function StartSessionModal({ open, spec, onClose, onStarted, onError }:
  // SPEC-394 · `resumed` diteruskan apa adanya dari server: pemanggil yang memutuskan cara
  // menyampaikannya (toast di App), modal ini tak menebak-nebak.
  { open: boolean; spec: Spec | null; onClose: () => void;
    onStarted: (id: string, resumed?: boolean) => void; onError?: (e: unknown) => void }) {
  const [model, setModel] = React.useState("claude-opus-5");
  const [effort, setEffort] = React.useState("xhigh");
  // SPEC-338 · ADR-0074 · agen sesi. Model/effort dipilih dari katalog agen terpilih — mengganti
  // agen HARUS menukar keduanya, kalau tidak sesi lahir dengan `codex -m claude-opus-5`.
  const [agent, setAgent] = React.useState<Agent>("claude");
  // Default per agen dari setelan global, dipakai saat picker agen berpindah.
  const [defs, setDefs] = React.useState<RuntimeDefs>({
    claude: { model: "claude-opus-5", effort: "xhigh" },
    codex: { ...CODEX_DEFAULTS },
  });
  // SPEC-332 · ADR-0073 · mode goal per sesi. Prefill dari default global; kondisi kosong dikirim
  // sebagai undefined supaya server yang memilih template global lalu default DoD bawaan.
  const [goalOn, setGoalOn] = React.useState(false);
  const [goalCond, setGoalCond] = React.useState("");
  // SPEC-376 · ADR-0080 · scope verifikasi per sesi. Prefill dari default global; `?? "changed"`
  // karena respons GET /settings yang ter-cache sebelum SPEC-376 belum punya kunci ini.
  const [verifyScope, setVerifyScope] = React.useState<VerifyScope>("changed");
  // SPEC-734 · ADR-0113 · metode workflow per sesi. Prefill dari default global; `resolveMethod`
  // menjaga id yang tak dikenal (mis. ikut sync dari hub) tak membuat picker-nya kosong.
  const [method, setMethod] = React.useState<string>(resolveMethod().id);
  const [busy, setBusy] = React.useState(false);
  // SPEC-339 · versi codex CLI terpasang; null = tak terdeteksi (dan itu tak memicu peringatan).
  const [codexVer, setCodexVer] = React.useState<string | null>(null);
  // SPEC-739 · ADR-0114 · kesiapan skill metode di mesin ini. Gagal-diam dengan alasan yang sama
  // dengan codexVer: modal harus tetap bisa dipakai, dan ketiadaan bukti bukan bukti ketiadaan.
  const [methodStatuses, setMethodStatuses] = React.useState<MethodSkillStatus[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    api.getSettings().then((s) => {
      // `?? `: server selalu mengirim keduanya (zod .default()), tapi respons yang di-cache
      // sebelum SPEC-338 belum punya — jangan sampai picker-nya kosong.
      const d: RuntimeDefs = {
        claude: { model: s.model, effort: s.effort },
        codex: { ...CODEX_DEFAULTS, ...(s.codex ?? {}) },
      };
      const a: Agent = s.agent === "codex" ? "codex" : "claude";
      setDefs(d); setAgent(a); setModel(d[a].model); setEffort(d[a].effort);
      // SPEC-407 · ADR-0089 · backlog goal membawa kondisinya sendiri (server menurunkannya dari
      // item), jadi (a) mode goal-nya tak boleh bisa dimatikan — itulah yang membedakan source ini
      // dari brief — dan (b) template global TIDAK ikut di-prefill: mengirimnya sebagai override
      // per-sesi akan menggantikan goal item dengan kalimat generik.
      const goalLockedNow = !!spec && isGoalShapedFlow(flowForSource(spec.source));
      setGoalOn(goalLockedNow || s.goal.enabled);
      setGoalCond(goalLockedNow ? "" : s.goal.condition);
      setVerifyScope(s.verifyScope ?? "changed");
      setMethod(resolveMethod(s.method).id);
    }).catch(() => {});
    // SPEC-339 · versi codex CLI untuk catatan lunak. Gagal-diam: modal harus tetap bisa dipakai.
    api.getCodexVersion().then((v) => setCodexVer(v.version)).catch(() => {});
    // SPEC-739 · ADR-0114 · kesiapan metode × agen, diturunkan live dari disk oleh server.
    api.getMethodStatus().then((r) => setMethodStatuses(r.methods)).catch(() => setMethodStatuses(null));
    // SPEC-407 · `spec` ikut jadi dependency: prefill mode goal bergantung source-nya.
  }, [open, spec]);
  const pickAgent = (a: Agent) => {
    setAgent(a);
    // SPEC-339 · default global bisa saja pasangan lama yang kini tak sah — koreksi saat dipasang.
    // SPEC-517 · aturannya (blok agen terpilih + koersi effort codex) hidup di session-runtime.ts,
    // sumber yang sama dengan picker "Sesi baru" di Terminal.
    const r = runtimeFor(defs, a);
    setModel(r.model);
    setEffort(r.effort);
  };
  // SPEC-339 · menukar model bisa membuat effort terpilih jadi tak sah (Luna tak punya `ultra`).
  // Turunkan SEKARANG supaya perubahannya terlihat di picker, bukan diam-diam saat sesi lahir.
  const pickModel = (id: string) => {
    setModel(id);
    if (agent === "codex") setEffort((e) => coerceCodexEffort(id, e));
  };
  const models = runtimeModels(agent);
  // SPEC-339 · effort adalah properti MODEL untuk codex — daftarnya menyempit mengikuti pilihan.
  const efforts = runtimeEfforts(agent, model);
  if (!spec) return null;
  const s = spec;
  const flow = flowForSource(s.source);
  // SPEC-407 · ADR-0089 · SPEC-825 · ADR-0123 · sesi backlog goal & no_effort selalu lahir
  // bermode goal (server pun memaksanya — ini cerminan UI-nya, bukan gerbangnya).
  const goalLocked = isGoalShapedFlow(flow);
  // SPEC-447 · ADR-0093 · gerbang dependency ada di SERVER (409); ini cerminannya supaya operator
  // tahu apa yang ia paksa sebelum menekannya. `force` tak pernah terkirim bila daftar ini kosong.
  const blockers = s.blockedBy ?? [];
  const isBlocked = blockers.length > 0;
  // SPEC-739 · ADR-0114 · status untuk pasangan (metode, agen) yang SEDANG dipilih — dua-duanya,
  // karena superpowers bisa siap untuk claude dan kosong untuk codex di mesin yang sama.
  const methodStat = methodStatuses?.find((m) => m.method === method && m.agent === agent) ?? null;
  async function start() {
    setBusy(true);
    try {
      const { id, resumed } = await api.startSession({
        spec: s.id, flow, model, effort, agent,
        goal: goalOn, goalCondition: goalOn && goalCond.trim() ? goalCond.trim() : undefined,
        verifyScope, method,
        ...(isBlocked ? { force: true } : {}),   // SPEC-447 · ADR-0093
      });
      onStarted(id, resumed); onClose();
    }
    catch (e) { onError?.(e); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} icon="play" eyebrow={`${s.id} · ${flow}`} title="Mulai sesi"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button leftIcon={isBlocked ? "lock" : "play"} variant={isBlocked ? "danger" : "primary"}
          disabled={busy} onClick={start}>{isBlocked ? "Mulai tetap" : "Mulai"}</Button>
      </>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Agen, model & effort untuk sesi ini. Default dari setelan global; ubah bila perlu. Sesi lahir dengan pilihan
        ini untuk seluruh hidupnya (satu proses) — <code>/model</code> di terminal tetap bisa mengubahnya.
      </div>
      {/* SPEC-447 · ADR-0093 · daftar pemblokir DI DEPAN tombol: memaksa peluncuran itu sah, tapi
          operator harus melihat dulu apa yang ia lewati. Worktree sesi lahir `--detach` dari
          basisnya, jadi pekerjaan dependency yang belum ter-merge memang TAK ADA di dalamnya. */}
      {isBlocked && (
        <div data-testid="dep-blocked-note" style={{
          fontSize: 12.5, lineHeight: 1.55, marginBottom: 12, padding: "9px 11px",
          borderRadius: 8, background: "var(--warn-bg, #fdf6e3)", color: "var(--text-strong)",
        }}>
          Backlog ini menunggu{" "}
          <b>{blockers.map((b) => `${b.id} (${b.reason === "missing" ? "tak ditemukan"
            : b.reason === "unmerged" ? "belum ter-merge" : "belum selesai"})`).join(", ")}</b>.
          Sesi tetap bisa dimulai, tapi worktree-nya lahir dari basis yang belum memuat pekerjaan itu.
        </div>
      )}
      {/* SPEC-338 · ADR-0074 · mesin sesi. Perilaku sesi identik (worktree, fase, stage, review);
          yang berbeda hanya CLI yang dijalankan — dan karenanya katalog model/effort-nya. */}
      <Field label="Agen" hint="Mesin yang menjalankan sesi ini. Perilaku sesi sama; hanya CLI-nya berbeda.">
        <Select aria-label="Agen" value={agent} style={{ width: "100%" }}
          options={[{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex CLI" }]}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickAgent(e.target.value as Agent)} />
      </Field>
      <Field label="Model">
        <Select aria-label="Model" value={model} style={{ width: "100%" }}
          options={models.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickModel(e.target.value)} />
      </Field>
      <Field label="Effort">
        <Select aria-label="Effort" value={effort} style={{ width: "100%" }}
          options={efforts.map((v) => ({ value: v, label: v }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffort(e.target.value)} />
      </Field>
      {/* SPEC-339 · catatan LUNAK: CLI terlalu tua untuk model terpilih. Tidak memblokir Mulai —
          aturannya sama persis dengan kartu Settings karena keduanya memanggil codexClientTooOld. */}
      {agent === "codex" && codexClientTooOld(model, codexVer) && (
        <div data-testid="codex-version-note" style={{
          fontSize: 12, lineHeight: 1.5, marginBottom: 12, padding: "8px 10px",
          borderRadius: 8, background: "var(--warn-bg, #fdf6e3)", color: "var(--text-muted)",
        }}>
          Codex CLI terpasang <b>{codexVer}</b>, sedangkan <b>{model}</b> butuh <b>{codexModel(model)?.minClient}</b>.
          Sesi tetap boleh dijalankan, tapi modelnya belum tentu dikenali CLI ini.
        </div>
      )}
      {/* SPEC-332 · ADR-0073 · mode goal: sesi menolak berhenti sampai kondisinya terbukti di
          transkrip. Interupsi manusia (Esc) tetap bekerja; melepas gate = hentikan sesinya. */}
      <Field label="Mode goal"
        hint={goalLocked
          ? "Backlog goal selalu berjalan dalam mode goal — sesi menolak berhenti sampai goal item ini terbukti tercapai. Kosongkan kondisi untuk memakai goal item apa adanya."
          : "Sesi menolak berhenti sampai kondisinya terbukti. Kosongkan kondisi untuk memakai bawaan hanoman: semua fase tercatat, plan tak menyisakan task, push sukses."}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: goalOn ? 10 : 0 }}>
          <Switch aria-label="Mode goal" checked={goalOn} disabled={goalLocked}
            onChange={(v: boolean) => { if (!goalLocked) setGoalOn(v); }} />
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {goalLocked ? "aktif · terkunci" : goalOn ? "aktif" : "nonaktif"}
          </span>
        </div>
        {goalOn && <HnTextarea value={goalCond} rows={4} mono
          placeholder={goalLocked
            ? "Kosong = goal backlog item ini · mis. semua fase tercatat & plan tanpa - [ ]"
            : "Kosong = kondisi bawaan hanoman · mis. semua fase tercatat & plan tanpa - [ ]"}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGoalCond(e.target.value)} />}
      </Field>
      {/* SPEC-376 · ADR-0080 · scope verifikasi: sesi menguji berkas yang berubah saja supaya
          RAM & CPU tetap tersisa untuk sesi lain di mesin yang sama. */}
      <Field label="Scope verifikasi"
        hint="Hanya yang berubah = test/typecheck/lint hanya menyentuh berkas yang disentuh sesi ini. Suite penuh tetap dijalankan manusia sebelum merge.">
        <Select aria-label="Scope verifikasi" value={verifyScope} style={{ width: "100%" }}
          options={[
            { value: "changed", label: "Hanya yang berubah — hemat RAM & CPU" },
            { value: "full", label: "Seluruh project" },
          ]}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setVerifyScope(e.target.value as VerifyScope)} />
      </Field>
      {/* SPEC-734 · ADR-0113 · metode workflow: skill mana yang dimuat per fase, dan di direktori
          mana plan & spec ditulis. Opsi datang dari katalog METHODS — metode ketiga muncul di sini
          tanpa satu pun perubahan di berkas ini. */}
      <Field label="Metode"
        hint="Metodologi kerja sesi ini: skill per fase + direktori plan/spec. Fase-fasenya sendiri tak berubah. Item yang sudah pernah dijalankan memakai metode tercatatnya saat dilanjutkan.">
        <Select aria-label="Metode" value={method} style={{ width: "100%" }}
          options={METHOD_IDS.map((id) => ({ value: id, label: METHODS[id]!.label }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMethod(e.target.value)} />
        <div data-testid="method-requires"
          style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          Butuh terpasang: {METHODS[method]?.requires.join(" · ") ?? "—"}
        </div>
        {/* SPEC-739 · ADR-0114 · sampai spec ini `requires` cuma teks: hanoman menjanjikan
            metodologi yang tak pernah ia pastikan ada. Peringatan ini LUNAK — Mulai tetap
            hidup (ADR-0037, cermin catatan versi codex SPEC-339) — tapi wajib menyebut AGEN:
            skill yang hilang tak mematikan sesi, ia menghapus gerbang yang disebut prompt. */}
        {methodStat && !methodStat.ready && (
          <div data-testid="method-status-note" style={{
            fontSize: 12, lineHeight: 1.5, marginTop: 8, padding: "8px 10px", overflowWrap: "anywhere",
            borderRadius: 8, background: "var(--warn-bg, #fdf6e3)", color: "var(--text-muted)",
          }}>
            <b>{methodStat.label}</b> belum siap untuk <b>{agent === "codex" ? "Codex CLI" : "Claude Code"}</b> di
            mesin ini
            {methodStat.missingPackages.length > 0 && <> · paket kurang: <code>{methodStat.missingPackages.join(" · ")}</code></>}
            {methodStat.missingSkills.length > 0 && <> · skill kurang: <code>{methodStat.missingSkills.join(" · ")}</code></>}.
            {" "}Sesi tetap boleh dijalankan, tapi gerbang yang disebut prompt tak akan ada.
            Pasang dari Settings → Sesi.
          </div>
        )}
      </Field>
    </Modal>
  );
}

export function NewSpecModal({ open, onClose, projects, defaultProject, onCreate, prefill, specs }:
  { open: boolean; onClose: () => void; projects: ProjectVM[]; defaultProject: string; onCreate: (f: SpecForm) => void;
    // SPEC-210 · seed dari "Take ke backlog" PRD (kind brief). SPEC-237 · promosi audit → Finding QA
    // (kind qa) membawa `kind` + field qa. Semua opsional; PrdPrefill (semua wajib) tetap assignable.
    prefill?: SpecPrefill;
    // SPEC-447 · ADR-0093 · kandidat dependency. Diambil dari state backlog App (set penuh dari
    // siar WS) — sengaja TANPA fetch baru: daftar yang sama sudah ada di memori.
    specs?: Spec[] }) {
  const blank: SpecForm = { kind: prefill?.kind ?? "brief", project: prefill?.project || defaultProject,
    title: prefill?.title ?? "", context: prefill?.context ?? "", outcome: prefill?.outcome ?? "",
    constraints: prefill?.constraints ?? "",
    priority: "sedang", severity: prefill?.severity ?? "major", steps: prefill?.steps ?? "",
    expected: "", actual: prefill?.actual ?? "", env: "", branchFrom: prefill?.branchFrom ?? "", fromAudit: prefill?.fromAudit ?? "",
    goal: prefill?.goal ?? "", done: prefill?.done ?? "",   // SPEC-407
    dependsOn: [],                                          // SPEC-447
    attachments: [] };                                      // SPEC-843
  const [f, setF] = React.useState<SpecForm>(blank);
  React.useEffect(() => {
    if (open) setF({ ...blank, project: prefill?.project || defaultProject });
  }, [open, defaultProject, prefill]);
  const [branches, setBranches] = React.useState<string[]>([]);
  // SPEC-244 · branch yang hanya ada di origin (branch PRD/audit di-push detached) — kandidat branchFrom penuh.
  const [remoteOnly, setRemoteOnly] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (!open || !f.project) { setBranches([]); setRemoteOnly(new Set()); return; }
    let alive = true;
    api.listBranches(f.project)
      .then((r) => {
        if (!alive) return;
        const combined = [...new Set([...r.branches, ...r.remotes])].sort();
        setBranches(combined);
        setRemoteOnly(new Set(r.remotes.filter((b) => !r.branches.includes(b))));
        // ganti project → branch pilihan lama bisa tak ada di repo baru; server akan menolaknya (400)
        setF((s) => (s.branchFrom && !combined.includes(s.branchFrom) ? { ...s, branchFrom: "" } : s));
      })
      .catch(() => { if (alive) { setBranches([]); setRemoteOnly(new Set()); } });
    return () => { alive = false; };
  }, [open, f.project]);
  const set = (k: keyof SpecForm) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const isQa = f.kind === "qa";
  const isAudit = f.kind === "audit";                       // SPEC-237 · audit-only (dokumen, tanpa perbaikan)
  const isGoal = f.kind === "goal";                         // SPEC-407 · backlog goal (Goal → Verifikasi)
  const isNoEffort = f.kind === "no_effort";                // SPEC-825 · task remeh (Kerjakan)
  // Keduanya berbagi BENTUK payload, jadi validasi & daftar field-nya satu (ADR-0123).
  const isGoalShape = payloadShapeFor(f.kind) === "goal";
  // SPEC-447 · ADR-0093 · dependency adalah properti ITEM, bukan properti bentuk payload → picker
  // ini hidup di luar cabang kind. Kandidatnya hanya project terpilih: dependency lintas project
  // menuntut merge lintas repo dan ditolak server.
  const depCandidates = (specs ?? []).filter((s) => s.projectId === f.project);
  const toggleDep = (id: string) => setF((s) => ({
    ...s, dependsOn: s.dependsOn.includes(id) ? s.dependsOn.filter((x) => x !== id) : [...s.dependsOn, id],
  }));
  // SPEC-407 · goal wajib: `Spec.objective` diturunkan darinya, dan item ber-objective kosong
  // melahirkan sesi tanpa sasaran.
  const submit = () => { if (!f.title.trim() || (isGoalShape && !f.goal.trim())) return; onCreate(f); };
  return (
    <Modal open={open} onClose={onClose}
      icon={isQa ? "bug" : isAudit ? "search" : isNoEffort ? "zap" : isGoal ? "target" : "lightbulb"} eyebrow="human → hanoman"
      title={isQa ? "QA finding baru" : isAudit ? "Audit baru"
        : isNoEffort ? "Task remeh baru" : isGoal ? "Goal baru" : "Feature brief baru"}
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon={isQa ? "radar" : isAudit ? "search" : isNoEffort ? "zap" : isGoal ? "target" : "messages-square"} onClick={submit}>
          {isQa ? "Filekan finding → audit"
            : isAudit ? "Buat audit → investigasi"
            : isNoEffort ? "Buat task → sesi satu fase"
            : isGoal ? "Buat goal → sesi goal" : "Buat brief → brainstorm"}
        </Button>
      </>}>
      <div style={{ marginBottom: 16 }}>
        <Tabs variant="pill" value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v }))} tabs={[
          { value: "brief", label: "Feature brief", icon: "lightbulb" },
          { value: "qa", label: "QA finding", icon: "bug" },
          { value: "audit", label: "Audit", icon: "search" },
          // SPEC-407 · ADR-0089 · backlog goal: cukup goal-nya, tanpa ritual perencanaan.
          { value: "goal", label: "Goal", icon: "target" },
          // SPEC-825 · ADR-0123 · task remeh: satu fase, bahkan tanpa fase pembuktian terpisah.
          { value: "no_effort", label: "Tanpa effort", icon: "zap" },
        ]} />
        <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 8, lineHeight: 1.5 }}>
          {isNoEffort ? "Sesi satu fase (Kerjakan): langsung mengerjakan lalu berhenti — tanpa brainstorm, spec, plan, maupun fase pembuktian terpisah. Untuk ganti copy, bump konstanta, perbaiki typo docs, tambah satu baris allowlist."
            : isGoal ? "Sesi goal langsung mengejar goal-nya — tanpa brainstorm, spec, atau plan (fase: Goal → Verifikasi). Sesi lahir dengan mode goal aktif dan menolak berhenti sampai buktinya ada di transkrip."
            : isQa ? "Finding masuk lewat alur audit → spec → plan → execute. hanoman menelusuri akar masalah dulu."
            : isAudit ? "Audit HANYA menghasilkan dokumen (audit → laporan) — tanpa perbaikan kode. Bisa dinaikkan jadi Finding QA bila perlu diperbaiki."
            : "Brief masuk lewat alur brainstorm → objective → spec → plan → execute."}
        </div>
      </div>
      <Field label="Project">
        <Select value={f.project} onChange={set("project")} style={{ width: "100%" }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label="Branch" hint="branch yang di-copy ke git worktree saat run">
        <Select value={f.branchFrom} onChange={set("branchFrom")} disabled={!branches.length}
          style={{ width: "100%" }} options={branchOptions(branches, remoteOnly)} />
      </Field>
      {/* SPEC-447 · ADR-0093 · sesi item ini tak akan lahir sebelum semua yang dicentang selesai
          DAN commit-nya ada di branch basis. Otomasi memblokirnya keras; Start manual masih bisa
          dipaksa lewat konfirmasi. */}
      <Field label="Bergantung pada"
        hint="Backlog yang harus selesai & ter-merge lebih dulu. Kosongkan bila item ini berdiri sendiri.">
        {depCandidates.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-subtle)" }}>
            Belum ada backlog lain di project ini.
          </div>
        ) : (
          <div style={{
            maxHeight: 132, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6,
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 8,
          }}>
            {depCandidates.map((s) => (
              <Checkbox key={s.id} aria-label={`Bergantung pada ${s.id}`}
                checked={f.dependsOn.includes(s.id)} onChange={() => toggleDep(s.id)}
                label={`${s.id} · ${s.title}`} />
            ))}
          </div>
        )}
      </Field>
      <Field label="Judul">
        <Input aria-label="Judul" value={f.title} onChange={set("title")}
          placeholder={isQa ? "mis. Funnel double-count sesi lintas tengah malam"
            : isNoEffort ? "mis. Label tombol Simpan di form backlog"
            : isGoal ? "mis. Latensi daftar backlog" : "mis. Jadwal invoice berulang"}
          style={{ width: "100%" }} />
      </Field>
      {/* SPEC-407 · ADR-0089 · bentuk payload goal: goal + bukti berhenti + batasan. Sengaja
          BUKAN konteks/outcome — server mengikat source ↔ bentuk payload di boundary. */}
      {isGoalShape ? (
        <>
          <Field label="Goal" hint="Keadaan yang harus tercapai — inilah yang dikejar sesi sampai terbukti">
            <HnTextarea aria-label="Goal" value={f.goal} onChange={set("goal")} rows={3}
              placeholder="mis. p95 GET /api/specs di bawah 200 ms" />
          </Field>
          <Field label="Selesai bila" hint="Bukti yang harus muncul di transkrip; kosongkan bila goal-nya sudah jadi buktinya sendiri">
            <HnTextarea aria-label="Selesai bila" value={f.done} onChange={set("done")} rows={2}
              placeholder="mis. output benchmark menunjukkan < 200 ms" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
            <Field label="Batasan" hint="opsional">
              <Input aria-label="Batasan" value={f.constraints} onChange={set("constraints")}
                placeholder="mis. tanpa cache eksternal" style={{ width: "100%" }} />
            </Field>
            <Field label="Prioritas">
              <Select aria-label="Prioritas" value={f.priority} onChange={set("priority")} style={{ width: "100%" }} options={PRIORITY} />
            </Field>
          </div>
        </>
      ) : isQa ? (
        <>
          <Field label="Severity">
            <Select value={f.severity} onChange={set("severity")} style={{ width: "100%" }} options={SEVERITY} />
          </Field>
          <Field label="Langkah reproduksi">
            <HnTextarea value={f.steps} onChange={set("steps")} rows={3} mono placeholder={"1. Buka …\n2. Lakukan …\n3. Amati …"} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Diharapkan"><HnTextarea value={f.expected} onChange={set("expected")} rows={2} placeholder="mis. total funnel sama dengan jumlah baris laporan harian" /></Field>
            <Field label="Aktual"><HnTextarea value={f.actual} onChange={set("actual")} rows={2} placeholder="mis. total funnel dua kali lipat untuk sesi yang melewati tengah malam" /></Field>
          </div>
          <Field label="Environment" hint="build / kanal tempat finding muncul">
            <Input value={f.env} onChange={set("env")} placeholder="prod · web · v0.9.2" style={{ width: "100%" }} />
          </Field>
          <Field label="Batasan" hint="opsional — batasan pengerjaan yang sudah kamu ketahui">
            <Input aria-label="Batasan" value={f.constraints} onChange={set("constraints")}
              placeholder="mis. jangan ubah kontrak API" style={{ width: "100%" }} />
          </Field>
        </>
      ) : (
        <>
          <Field label={isAudit ? "Apa yang diaudit / pertanyaan" : "Konteks"}
            hint={isAudit ? "Isu atau pertanyaan yang mau ditelusuri" : "Latar belakang & alasan fitur ini dibutuhkan"}>
            <HnTextarea value={f.context} onChange={set("context")} rows={3}
              placeholder={isAudit ? "mis. apakah funnel double-count? cek log sesi lintas tengah malam…" : "mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu"} />
          </Field>
          <Field label={isAudit ? "Temuan/jawaban yang diharapkan" : "Hasil yang diharapkan"}>
            <HnTextarea value={f.outcome} onChange={set("outcome")} rows={2}
              placeholder={isAudit ? "Jawaban/kepastian yang dicari…" : "mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu"} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
            <Field label="Batasan" hint="opsional">
              <Input value={f.constraints} onChange={set("constraints")} placeholder="mis. reuse queue yang ada" style={{ width: "100%" }} />
            </Field>
            <Field label="Prioritas">
              <Select value={f.priority} onChange={set("priority")} style={{ width: "100%" }} options={PRIORITY} />
            </Field>
          </div>
        </>
      )}
      {/* SPEC-843 · ADR-0124 · lampiran jadi konteks sesi agen, jadi ia bagian dari pengisian item —
          bukan sesuatu yang baru bisa ditempel sesudahnya. */}
      <Field label="Lampiran" hint="Gambar, log, CSV, JSON, atau PDF — sesi agen membacanya sebagai konteks">
        <AttachmentPicker files={f.attachments} onChange={(list) => setF((s) => ({ ...s, attachments: list }))} />
      </Field>
    </Modal>
  );
}

type ProjectForm = { kind: string; mode: "local" | "clone"; name: string; desc: string; dir: string; gitRemote: string; objective: string };
function NewProjectModal({ open, onClose, onCreate }:
  { open: boolean; onClose: () => void; onCreate: (f: ProjectForm) => void | Promise<void> }) {
  const blank: ProjectForm = { kind: "from-scratch", mode: "local", name: "", desc: "", dir: "", gitRemote: "", objective: "" };
  const [f, setF] = React.useState<ProjectForm>(blank);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setF(blank); setBusy(false); } }, [open]);
  const set = (k: keyof ProjectForm) => (e: React.ChangeEvent<any>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const scratch = f.kind === "from-scratch";
  const clone = !scratch && f.mode === "clone";
  // SPEC-217/218 · path opsional (mode lokal): nama ATAU dir. Mode clone: URL + folder tujuan wajib.
  const canSubmit = scratch ? (!!f.name.trim() && !!f.dir.trim())
    : clone ? (!!f.gitRemote.trim() && !!f.dir.trim())
    : (!!f.name.trim() || !!f.dir.trim());
  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try { await onCreate(f); } finally { setBusy(false); }
  };
  const [picker, setPicker] = React.useState(false);
  const submitLabel = scratch ? "Buat → brainstorm objective"
    : clone ? (busy ? "Meng-clone…" : "Clone → reverse-engineer docs")
    : "Tambah → reverse-engineer docs";
  return (
    <Modal open={open} onClose={onClose} icon="box" eyebrow="workspace" title="Project baru"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Batal</Button>
        <Button size="sm" leftIcon={scratch ? "messages-square" : clone ? "git-branch" : "radar"}
          onClick={submit} disabled={!canSubmit || busy}>{submitLabel}</Button>
      </>}>
      <div style={{ marginBottom: 16 }}>
        <Tabs variant="pill" value={f.kind} onChange={(v) => setF((s) => ({ ...s, kind: v }))} tabs={[
          { value: "from-scratch", label: "From scratch", icon: "sparkles" },
          { value: "existing", label: "Existing codebase", icon: "folder-git-2" },
        ]} />
        <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 8, lineHeight: 1.5 }}>
          {scratch ? "hanoman brainstorm sampai MVP objective terkunci, lalu scaffold seluruh doc index sebagai Source of Truth."
            : "hanoman reverse-engineer docs dari codebase yang ada, lalu menyusun Source of Truth-nya."}
        </div>
      </div>
      {scratch ? (
        <>
          <Field label="Nama project" hint="lowercase, tanpa spasi">
            <Input value={f.name} onChange={set("name")} placeholder="mis. kirana" style={{ width: "100%" }} />
          </Field>
          <Field label="Direktori" hint="folder tempat repo baru di-init (mesin ini)">
            <div style={{ display: "flex", gap: 8 }}>
              <Input value={f.dir} onChange={set("dir")} leftIcon="folder" mono placeholder="/path/ke/project-baru" style={{ flex: 1 }} />
              <Button size="sm" variant="secondary" leftIcon="folder-open" onClick={() => setPicker(true)}>Pilih folder</Button>
            </div>
          </Field>
          <FolderPicker open={picker} onClose={() => setPicker(false)}
            start={f.dir} onPick={(p) => setF((s) => ({ ...s, dir: p }))} />
          <Field label="Ide awal" hint="bahan brainstorm objective → jadi deskripsi & seed scaffold">
            <HnTextarea value={f.objective} onChange={set("objective")} rows={2} placeholder="mis. POS ritel dengan stok multi-gudang dan laporan harian" />
          </Field>
        </>
      ) : (
        <>
          {/* SPEC-218 · dua cara menambah existing: folder lokal, atau clone dari URL git. */}
          <div style={{ marginBottom: 12 }}>
            <Tabs variant="pill" value={f.mode} onChange={(v) => setF((s) => ({ ...s, mode: v as "local" | "clone" }))} tabs={[
              { value: "local", label: "Dari folder lokal", icon: "folder" },
              { value: "clone", label: "Clone dari URL git", icon: "git-branch" },
            ]} />
          </div>
          {clone ? (
            <Field label="URL repository" hint="GitHub/GitLab · https atau ssh">
              <Input value={f.gitRemote} onChange={set("gitRemote")} leftIcon="git-branch" mono
                placeholder="https://github.com/org/repo.git" style={{ width: "100%" }} />
            </Field>
          ) : null}
          <Field label={clone ? "Folder tujuan clone" : "Direktori"}
            hint={clone ? "path lokal tempat repo di-clone (mesin ini)" : "opsional · path checkout lokal (bisa diedit belakangan per-mesin)"}>
            <div style={{ display: "flex", gap: 8 }}>
              <Input value={f.dir} onChange={set("dir")} leftIcon="folder" mono placeholder="/path/ke/repo" style={{ flex: 1 }} />
              <Button size="sm" variant="secondary" leftIcon="folder-open" onClick={() => setPicker(true)}>Pilih folder</Button>
            </div>
          </Field>
          <FolderPicker open={picker} onClose={() => setPicker(false)}
            start={f.dir} onPick={(p) => setF((s) => ({ ...s, dir: p }))} />
          <Field label="Deskripsi" hint="opsional">
            <Input value={f.desc} onChange={set("desc")} placeholder="mis. POS ritel + inventori" style={{ width: "100%" }} />
          </Field>
        </>
      )}
    </Modal>
  );
}

export function EditProjectModal({ open, project, onClose, onSave }:
  { open: boolean; project?: ProjectVM; onClose: () => void;
    onSave: (f: { id: string; name: string; desc: string; dir: string; gitRemote: string;
      handledBy?: HandledByEntry[] }) => void }) {
  // SPEC-217 · `dir` = override path per-mesin (LocalBinding). Diisi dari binding project;
  // kosong = pakai path default project. Tak disync antar-mesin.
  // SPEC-218 · `gitRemote` = remote resmi (disync) agar device lain bisa clone.
  // SPEC-255 · `id` = slug renameable; ganti berdampak Help Center & sync ke server.
  const [f, setF] = React.useState({ id: "", name: "", desc: "", dir: "", gitRemote: "" });
  const [picker, setPicker] = React.useState(false);
  // SPEC-880 · ADR-0135 · katalog device instance ini. `[]` = instance ini tak memegang katalognya
  // (client) → editor jatuh ke BACA-SAJA dan `handledBy` tak ikut disimpan sama sekali: mengirim
  // `[]` dari sini akan MENGHAPUS nilai yang di-set di hub, dan penghapusan itu menyeberang.
  const [devices, setDevices] = React.useState<DeviceTokenView[] | null>(null);
  const [handled, setHandled] = React.useState<HandledByEntry[]>([]);
  const canEditHandled = !!devices?.length;
  React.useEffect(() => {
    if (open && project) {
      setF({ id: project.id, name: project.name, desc: project.desc, dir: project.binding ?? "", gitRemote: project.gitRemote ?? "" });
      setHandled((project.handledBy ?? []).map((h) => ({ deviceId: h.deviceId, name: h.name })));
    }
  }, [open, project]);
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    api.listDeviceTokens?.()
      .then((list) => { if (alive) setDevices(list); })
      .catch(() => { if (alive) setDevices([]); });
    return () => { alive = false; };
  }, [open]);
  const slugOk = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(f.id.trim());
  const canSubmit = !!f.name.trim() && slugOk;
  return (
    <Modal open={open} onClose={onClose} icon="pencil" eyebrow={project ? project.id : "project"}
      title="Edit project"
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon="check" onClick={() => canSubmit && onSave({
          ...f, handledBy: canEditHandled ? handled : undefined,
        })}>Simpan</Button>
      </>}>
      {/* SPEC-255 · ADR-0064 · `id` kini renameable lewat operasi khusus (cascade + rambat sync). */}
      <Field label="ID project" hint="slug unik · huruf-kecil/angka/hubung · ganti = pengaruh Help Center & sync ke server">
        <Input value={f.id} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, id: e.target.value }))}
          leftIcon="hash" mono placeholder="mis. erp-tumbuh-ai" style={{ width: "100%" }} />
      </Field>
      <Field label="Nama project" hint="label tampilan — boleh berbeda dari id">
        <Input value={f.name} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, name: e.target.value }))}
          placeholder="mis. ERP Tumbuh AI" style={{ width: "100%" }} />
      </Field>
      <Field label="Deskripsi">
        <Input value={f.desc} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, desc: e.target.value }))}
          placeholder="mis. ERP manufaktur + inventori" style={{ width: "100%" }} />
      </Field>
      {/* SPEC-858 · picker folder yang sama dengan modal Project baru; ketik manual tetap jalan. */}
      <Field label="Path (mesin ini)" hint="opsional · disimpan lokal, tak disync · kosongkan = pakai default">
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={f.dir} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, dir: e.target.value }))}
            leftIcon="folder" mono placeholder="/path/ke/repo (mesin ini)" style={{ flex: 1, minWidth: 0 }} />
          <Button size="sm" variant="secondary" leftIcon="folder-open" onClick={() => setPicker(true)}>Pilih folder</Button>
        </div>
      </Field>
      <FolderPicker open={picker} onClose={() => setPicker(false)}
        start={f.dir} onPick={(p) => setF((s) => ({ ...s, dir: p }))} />
      {/* SPEC-218 · remote resmi (disync) — device lain bisa clone project ini. */}
      <Field label="Git remote" hint="opsional · remote resmi agar device lain bisa clone project ini · disync antar-device">
        <Input value={f.gitRemote} onChange={(e: React.ChangeEvent<any>) => setF((s) => ({ ...s, gitRemote: e.target.value }))}
          leftIcon="git-branch" mono placeholder="https://github.com/org/repo.git" style={{ width: "100%" }} />
      </Field>
      {/* SPEC-880 · ADR-0135 · "ditangani oleh" — pernyataan DISYNC, beda dari "Path (mesin ini)"
          di atas. Nilai tersimpan yang device-nya tak ada di katalog mesin ini (dicabut, atau
          milik instance lain) dirender MultiSelect sebagai chip bertanda, bukan dibuang senyap. */}
      <Field label="Ditangani oleh"
        hint={canEditHandled
          ? "hanoman client yang memegang project ini · disync ke semua mesin · boleh kosong"
          : "disync ke semua mesin · hanya bisa diubah dari instance yang memegang katalog device"}>
        {canEditHandled ? (
          <MultiSelect aria-label="Pilih hanoman client" placeholder="Pilih client…"
            emptyText="Tak ada device terdaftar yang cocok."
            value={handled.map((h) => h.deviceId)}
            invalidValues={handled
              .filter((h) => !devices!.some((d) => d.id === h.deviceId && !d.revokedAt))
              .map((h) => h.deviceId)}
            options={devices!.filter((d) => !d.revokedAt).map((d) => ({
              value: d.id,
              label: d.lastSeenAt ? `${d.name} · terakhir ${new Date(d.lastSeenAt).toLocaleDateString("id-ID")}` : d.name,
            }))}
            onChange={(next) => setHandled(next.map((id) => handled.find((h) => h.deviceId === id)
              ?? { deviceId: id, name: devices!.find((d) => d.id === id)?.name ?? id }))} />
        ) : (
          <HandledByChips list={project?.handledBy} />
        )}
      </Field>
    </Modal>
  );
}

export default function App() {
  // SPEC-740 · ADR-0115 · halaman terakhir yang dibuka ikut dipulihkan; refresh tak lagi
  // melempar balik ke Overview. Guard NAV_KEYS menutup section transien (project/review)
  // dan key yang sudah tak ada (`runs`/`triggers`, SPEC-162).
  const [section, setSection] = usePersistedState("app", "section", "overview", oneOf(...NAV_KEYS));
  // SPEC-293 · deep-link #spec=<id> (buka backlog + SpecDetail saat mount). Diteruskan ke BacklogScreen.
  const [openSpecId, setOpenSpecId] = React.useState<string | null>(null);
  // SPEC-519 · deep-link #changelog=<projectId>[&cl=<id>] — rilis yang harus terbuka saat mount.
  const [openChangelogId, setOpenChangelogId] = React.useState<string | null>(null);
  const [projects, setProjects] = React.useState<ProjectView[]>([]);
  const [backlog, setBacklog] = React.useState<Spec[]>([]);
  // SPEC-198 · dinaikkan tiap backlog/sessions berubah (load + poll). Layar daftar yang
  // self-fetch (Backlog, Projects) me-refetch saat ini berubah — tanpa poll ganda.
  const [dataVersion, setDataVersion] = React.useState(0);
  // Pekerjaan yang berjalan adalah sesi tmux, bukan baris Run (SPEC-162).
  const [sessions, setSessions] = React.useState<TerminalSession[]>([]);
  // SPEC-909 · ADR-0146 · pertanyaan sesi yang hidup, langsung dari payload hook agennya. Server
  // yang lebih tua tak pernah mengirim frame ini (ADR-0087) → daftarnya tetap kosong, dan pet jatuh
  // ke perilaku sebelum SPEC ini.
  const [leadAsks, setLeadAsks] = React.useState<SessionAsk[]>([]);
  const [projectId, setProjectId] = usePersistedState("app", "projectId", "", isStr);
  // SPEC-171/230 · target review: backlog item (spec) atau sesi project-level PRD (session).
  const [review, setReview] = React.useState<{ id: string; kind: "spec" | "session"; title: string } | null>(null);
  // Pemilik tunggal "daftar disaring ke project mana?" (SPEC-146). Sengaja terpisah dari
  // `projectId` ("project yang sedang dibuka Docs/detail"): menyatukannya membuat klik
  // sidebar Runs diam-diam menyaring ke project terakhir yang dibuka Docs.
  const [projectFilter, setProjectFilter] = usePersistedState("app", "projectFilter", "all", isStr);
  // SPEC-184 · sesi yang harus difokuskan di Terminal setelah klik aksi notifikasi.
  const [focusSession, setFocusSession] = React.useState<string | null>(null);
  const openTerminal = React.useCallback((sessionId?: string | null) => {
    setFocusSession(sessionId ?? null);
    setSection("terminal");
  }, [setSection]);
  // Kotak pencarian di topbar hanya dipakai layar Projects — kuncinya ikut layar itu,
  // meski state-nya hidup di App.
  const [search, setSearch] = usePersistedState("projects", "q", "", isStr);
  const [modal, setModal] = React.useState<string | null>(null);
  // SPEC-847 · ADR-0127 · konfirmasi destruktif memakai dialog aplikasi, bukan window.confirm.
  const { confirm, dialog } = useConfirm();
  // SPEC-210 · prefill NewSpecModal saat "Take ke backlog" dari sebuah PRD.
  const [specPrefill, setSpecPrefill] = React.useState<SpecPrefill | null>(null);
  // SPEC-340 · ADR-0076 · eskalasi audit → PRD: modal brief PRD ter-prefill + asal auditnya.
  const [prdFromAudit, setPrdFromAudit] = React.useState<
    { project: string; branchFrom: string; fromAudit: string;
      title: string; context: string; outcome: string } | null>(null);
  const [toast, showToast] = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  // SPEC-169 · gate auth. null = belum tahu (splash). Sesi kedaluwarsa (401) → balik ke Login.
  const [auth, setAuth] = React.useState<AuthStatus | null>(null);
  const onLoggedOut = React.useCallback(() => setAuth({ needsSetup: false, user: null }), []);
  React.useEffect(() => { api.authStatus().then(setAuth).catch(() => setAuth({ needsSetup: false, user: null })); }, []);
  // SPEC-884 · ADR-0139 · wizard setup awal berdiri DI DEPAN AuthScreen: pilihannya menentukan
  // apakah akun pertama nanti diminta setup token. Status yang sama juga menyalakan penanda
  // permanen sesudah login, jadi ia dimuat pada kedua keadaan.
  const [setupStatus, setSetupStatus] = React.useState<SetupStatus | null>(null);
  const [setupDone, setSetupDone] = React.useState(false);
  React.useEffect(() => {
    if (auth?.needsSetup || auth?.user) api.setupStatus().then(setSetupStatus).catch(() => setSetupStatus(null));
  }, [auth?.needsSetup, auth?.user?.id]);
  // SPEC-740 · ADR-0115 · state dari versi kunci lama tak pernah dibaca lagi (versi hidup
  // di dalam kunci) — disapu sekali di sini supaya storage tak tumbuh selamanya.
  React.useEffect(() => { pruneUiState(); }, []);

  // SPEC-293 · deep-link backlog: buka `${origin}${pathname}#spec=<id>` (mis. dari tab baru tombol
  // "Buka backlog" di Triase) → langsung ke section backlog + SpecDetail. Hash dibersihkan
  // agar tak memicu ulang. Sekali-mount (ADR-0071); bukan router SPA umum.
  React.useEffect(() => {
    const clean = () => window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const id = parseSpecHash(window.location.hash);
    if (id) {
      setSection("backlog");
      setOpenSpecId(id);
      clean();
      return;
    }
    // SPEC-519 · `#changelog=<projectId>[&cl=<id>]`, saling eksklusif dengan `#spec=`: satu hash,
    // satu section. `setProjectId` di sini menang atas default `load()` — load memakai
    // `(cur) => cur || items[0]`, jadi nilai dari hash tak ditimpa.
    const cl = parseChangelogHash(window.location.hash);
    if (cl) {
      setSection("changelog");
      setProjectId(cl.projectId);
      setOpenChangelogId(cl.changelogId);
      clean();
    }
  }, []);

  const load = React.useCallback(() => {
    setStatus("loading");
    Promise.all([api.listProjects(), api.listSpecs(), api.listTerminals()])
      .then(([p, s, t]) => {
        setProjects(p.items); setBacklog(s.items); setSessions(t);
        setProjectId((cur) => cur || p.items[0]?.id || "");
        setDataVersion((v) => v + 1);
        setStatus("ready");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) { onLoggedOut(); return; }
        setStatus("error");
        showToast("Gagal memuat data dari server", "err", "x-circle");
      });
  }, [showToast, onLoggedOut]);
  // Muat data hanya setelah login; run baru pada perubahan status login.
  React.useEffect(() => { if (auth?.user) load(); }, [load, auth?.user]);

  // ProjectVM dulu membawa daftar tipe trigger per project; trigger sudah tak ada (SPEC-162).
  const projectsView: ProjectVM[] = projects;

  // SPEC-258 · refetch satu VM project ke state sesudah mutasi in-card (Help Center). State `projects`
  // hanya dimuat saat login (WS cuma dorong specs/sessions), jadi tanpa ini status Help Center yang baru
  // di-generate "hilang" saat layar re-mount/refresh (baca prop basi). Cermin updateProject().
  const refreshProject = React.useCallback(async (id: string) => {
    try {
      const fresh = await api.getProject(id);
      setProjects((list) => list.map((x) => (x.id === fresh.id ? fresh : x)));
    } catch { /* biarkan; load()/refresh berikutnya menyusul */ }
  }, []);

  // Spec yang punya sesi claude hidup. Kartunya menawarkan "Buka sesi", bukan "Mulai".
  const activeSpecs = React.useMemo(
    () => new Set(sessions.filter((s) => s.specId && !s.exited).map((s) => s.specId as string)),
    [sessions]);

  // SPEC-199 · board didorong lewat WebSocket siar (ADR-0039), bukan poll 3s. `load()` awal
  // tetap (muat projects). Server kirim snapshot penuh tiap connect → state re-sync sendiri.
  // Stage tetap forward-only & write-through di server (liveSpecs) — board hanya menampilkan.
  // SPEC-198 · bump dataVersion tiap snapshot specs tiba supaya layar self-fetch (Backlog,
  // Projects) yang berpaginasi-server ikut me-refetch dan tetap segar selama sesi hidup.
  React.useEffect(() => subscribe((m) => {
    if (m.t === "specs") { setBacklog(m.specs); setDataVersion((v) => v + 1); }
    else if (m.t === "sessions") setSessions(m.sessions as TerminalSession[]);
    else if (m.t === "leadAsks") setLeadAsks(m.asks);
  }), []);

  const proj = projectsView.find((p) => p.id === projectId) || projectsView[0];
  // SPEC-198 · search project via API di ProjectsScreen (bukan filter klien di App).

  function openProject(p: ProjectVM) { setProjectId(p.id); setSection("project"); }
  // SPEC-171 · buka layar review file worktree sebuah backlog item.
  function openReview(s: Spec) { setReview({ id: s.id, kind: "spec", title: s.title }); setSection("review"); }
  // SPEC-171 · dari Terminal (Cell spec): id spec saja → cari judulnya di backlog.
  function openReviewSpecId(id: string) {
    setReview({ id, kind: "spec", title: backlog.find((s) => s.id === id)?.title ?? id }); setSection("review");
  }
  // SPEC-230 · review worktree sesi project-level (PRD, tanpa Spec).
  function openSessionReview(id: string, title: string) {
    setReview({ id, kind: "session", title }); setSection("review");
  }

  // SPEC-184 · klik aksi notifikasi. `sessions` = daftar ter-poll (cek liveness untuk notif done).
  const openNotification = React.useCallback((nt: Notification) => {
    const t = notifTarget(nt, sessions);
    if (t.projectFilter) setProjectFilter(t.projectFilter);
    if (t.focus) setFocusSession(t.focus);
    setSection(t.section);
  }, [sessions]);

  async function updateProject(f: { id: string; name: string; desc: string; dir: string; gitRemote: string;
    handledBy?: HandledByEntry[] }) {
    if (!proj) return;
    const newId = f.id.trim();
    try {
      // SPEC-255 · ADR-0064 · rename id lebih dulu (operasi khusus): konfirmasi dampak → renameProject.
      // Efek merambat: Help /help/<id> dan sync ke server (hub ikut berganti).
      if (newId && newId !== proj.id) {
        if (!await confirm({
          title: `Ganti ID project "${proj.id}" → "${newId}"?`,
          message: "Ini berpengaruh ke SEMUA yang terkait project:",
          impact: [
            <>Link Help Center publik berubah jadi <code>/help/{newId}</code> — tautan lama rusak.</>,
            "Perubahan dirambatkan (sync) ke server; server ikut berganti id.",
          ],
          confirmLabel: "Ganti ID",
          icon: "pencil",
        })) return;
        const r = await api.renameProject(proj.id, newId);
        if (r.helpUrl) showToast("Help Center baru: " + r.helpUrl, "ok", "life-buoy");
      }
      const effId = newId && newId !== proj.id ? newId : proj.id;
      // SPEC-218 · gitRemote disync; "" = kosongkan (endpoint clone cek `!gitRemote`, falsy).
      // SPEC-880 · `handledBy` HANYA disertakan bila instance ini memegang katalog device —
      // `undefined` di sini berarti "jangan sentuh", bukan "kosongkan".
      await api.updateProject(effId, {
        name: f.name.trim(), desc: f.desc.trim(), gitRemote: f.gitRemote.trim(),
        ...(f.handledBy ? { handledBy: f.handledBy } : {}),
      });
      // SPEC-217 · path per-mesin lewat binding (tak disync). Set bila berubah; kosong = hapus override.
      const dir = f.dir.trim();
      if (dir !== (proj.binding ?? "")) {
        if (dir) await api.putBinding(effId, dir); else await api.deleteBinding(effId);
      }
      const fresh = await api.getProject(effId);   // view segar (binding + gitRemote + coverage terbarui)
      // Id bisa berubah: buang baris lama & baru dari list lalu sisipkan yang segar; sorot id baru.
      setProjects((list) => [...list.filter((x) => x.id !== proj.id && x.id !== fresh.id), fresh]);
      setProjectId(fresh.id);
      setModal(null);
      showToast("Project " + fresh.name + " diperbarui", "ok", "box");
    } catch { showToast("Gagal memperbarui project", "err", "x-circle"); }
  }

  async function createProject(f: ProjectForm) {
    const scratch = f.kind === "from-scratch";
    const clone = !scratch && f.mode === "clone";
    // SPEC-218 · mode clone: turunkan nama dari basename URL bila user tak isi (buang .git & host).
    // SPEC-867 · perhitungan yang sama dipakai kartu tanpa-dir untuk menyusun folder tujuan clone.
    const fromUrl = repoBasename(f.gitRemote);
    const name = f.name.trim() || (clone ? fromUrl : (f.dir.split("/").filter(Boolean).pop() || "repo"));
    let created;
    try {
      created = await api.createProject({
        name, kind: f.kind, desc: scratch ? (f.objective.trim() || f.desc.trim()) : f.desc.trim(),
        repoDir: scratch ? f.dir.trim() : (clone ? undefined : f.dir),
        gitRemote: clone ? f.gitRemote.trim() : undefined,
      });
    } catch { showToast("Gagal membuat project", "err", "x-circle"); return; }
    // SPEC-218 · project sudah ada; clone di jalur terpisah agar gagal-clone tak menghapus project.
    // SPEC-867 · remote tersimpan, jadi clone bisa diulang dari kartu "Belum ada checkout di mesin
    // ini" di detail project — cabang catch di bawah mendaratkan operator tepat di kartu itu. AC-8.
    if (clone) {
      try {
        await api.cloneProject(created.id, f.dir.trim());
        created = await api.getProject(created.id);   // binding hasil clone
      } catch (e) {
        // SPEC-867 · `ApiError.message` hanya "POST /api/… → 409"; yang bisa ditindaklanjuti adalah
        // pesan endpoint-nya.
        const { error } = cloneErrorText(e);
        setProjects((list) => [created!, ...list]);
        setProjectId(created.id); setModal(null); setSection("project");
        showToast(`Project ${created.id} dibuat, tapi clone gagal · ${error} · clone ulang dari detail project`,
          "warn", "git-branch");
        return;
      }
    }
    setProjects((list) => [created!, ...list]);
    setModal(null);
    // SPEC-222 · from-scratch: auto-start scaffold bila autoScaffold on (default), lalu ke Terminal;
    // selain itu ke layar project tempat tombol "Scaffold docs" berada.
    if (scratch) {
      let auto = true;
      try { auto = (await api.getSettings()).autoScaffold; } catch { /* default on */ }
      if (auto) {
        try {
          const { id } = await api.scaffoldDocs(created.id);
          setProjectId(created.id); openTerminal(id);
          showToast(`Project ${created.id} dibuat · scaffold docs · sesi ${id} dimulai`, "ok", "sparkles");
          return;
        } catch { /* jatuh ke layar project di bawah */ }
      }
      setProjectId(created.id); setSection("project");
      showToast(`Project ${created.id} dibuat · tekan "Scaffold docs" untuk menyusun SoT`, "ok", "box");
      return;
    }
    // SPEC-848 · existing: CTA-nya sendiri berbunyi "→ reverse-engineer docs", jadi sesinya lahir di
    // sini — cermin cabang scaffold di atas, dan pemicu manusia yang dimaksud ADR-0026. Membuka Docs
    // tanpa sesi berarti menjanjikan proses lalu menyodorkan pohon docs yang memang belum disusun.
    setProjectId(created.id);
    try {
      const { id } = await api.reverseDocs(created.id);
      openTerminal(id);
      showToast(`Project ${created.id} dibuat · reverse docs · sesi ${id} dimulai`, "ok", "radar");
    } catch (e) {
      // Project dipertahankan (cermin kegagalan clone di atas): mendarat di detail project, tempat
      // pintu "Reverse docs" jadi retry-nya — bukan Docs kosong yang tak menawarkan langkah apa pun.
      const detail = (e as { detail?: { error?: string } }).detail?.error;
      setSection("project");
      showToast(`Project ${created.id} dibuat, tapi reverse docs gagal dimulai`
        + (detail ? ` · ${detail}` : "") + ` · ulangi lewat "Reverse docs"`, "warn", "radar");
    }
  }

  // Cascade di DB ikut menghapus spec project ini — cermin state lokalnya.
  async function deleteProject(p: ProjectVM) {
    try {
      if (!await confirm({
        title: `Hapus project "${p.name}"?`,
        message: `Project "${p.id}" dan seluruh isinya dihapus dari dashboard ini.`,
        impact: ["Semua backlog item project ini ikut terhapus.", "Tindakan ini tak bisa dibatalkan."],
        confirmLabel: "Hapus project",
        run: () => api.deleteProject(p.id),
      })) return;
      setProjects((list) => list.filter((x) => x.id !== p.id));
      setBacklog((b) => b.filter((s) => s.projectId !== p.id));
      setSessions((t) => t.filter((x) => x.projectId !== p.id));
      setProjectId((cur) => (cur === p.id ? "" : cur));
      setProjectFilter((cur) => (cur === p.id ? "all" : cur));
      if (section === "docs" || section === "project") setSection("projects");
      showToast("Project " + p.id + " dihapus", "warn", "trash-2");
    } catch (e) {
      const busy = e instanceof ApiError && e.status === 409;
      showToast("Gagal hapus " + p.id + (busy ? " · masih ada sesi aktif" : ""), "err", "x-circle");
    }
  }

  // SPEC-162 · Start membuka sesi interaktif di worktree backlog item ini.
  // SPEC-341 · sesudah sukses tetap di Backlog; Terminal dibuka lewat aksi eksplisit "Buka sesi".
  // `branchFrom` tak dikirim — server membacanya dari baris Spec (SPEC-143).
  // SPEC-252 · ADR-0061 · Start membuka picker model/effort per sesi dulu (StartSessionModal);
  // konfirmasi picker-lah yang memanggil api.startSession dengan pilihan itu.
  const [startSpec, setStartSpec] = React.useState<Spec | null>(null);
  function startSession(spec: Spec) { setStartSpec(spec); }

  // SPEC-175 · rebase/merge branch hasil sebuah done spec. Bersih → toast; conflict → pindah ke
  // Terminal tempat sesi claude membereskan konflik (pola startSession).
  async function integrateSpec(spec: Spec, op: "merge" | "rebase", target: string) {
    try {
      const r = await api.integrateSpec(spec.id, op, target);
      if (r.status === "conflict") {
        openTerminal(r.sessionId);
        showToast(`${spec.id} · konflik ${op} — selesaikan di Terminal`, "warn", "git-merge");
      } else {
        showToast(`${spec.id} · ${op} berhasil · ${r.detail}`, "ok", "git-merge");
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      showToast(`${spec.id} · gagal ${op}` + (code === 409 ? " · cek target/branch" : ""), "err", "x-circle");
    }
  }

  // SPEC-230 · rebase/merge branch sesi project-level (PRD). Cermin integrateSpec: konflik → Terminal.
  async function integrateSession(session: TerminalSession, op: "merge" | "rebase", target: string) {
    try {
      const r = await api.sessionIntegrate(session.id, op, target);
      if (r.status === "conflict") {
        openTerminal(r.sessionId);
        showToast(`${session.id} · konflik ${op} — selesaikan di Terminal`, "warn", "git-merge");
      } else {
        showToast(`${session.id} · ${op} berhasil · ${r.detail}`, "ok", "git-merge");
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.status : 0;
      showToast(`${session.id} · gagal ${op}` + (code === 409 ? " · cek target/branch" : ""), "err", "x-circle");
    }
  }

  // SPEC-166 · Reverse docs: sesi interaktif menyusun Source of Truth dari kode. Fase
  // Wawancara hidup di layar Terminal — di sanalah manusia menjawab agen.
  async function reverseDocs(p: ProjectVM) {
    try {
      const { id } = await api.reverseDocs(p.id);
      openTerminal(id);
      showToast(p.id + " · reverse docs · sesi " + id + " dimulai", "info", "radar");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast(p.id + " · gagal mulai reverse" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
    }
  }

  // SPEC-222 · Scaffold docs: sesi interaktif menyusun Source of Truth dari ide (from-scratch).
  async function scaffoldDocs(p: ProjectVM) {
    try {
      const { id } = await api.scaffoldDocs(p.id);
      openTerminal(id);
      showToast(p.id + " · scaffold docs · sesi " + id + " dimulai", "info", "sparkles");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast(p.id + " · gagal mulai scaffold" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
    }
  }

  // SPEC-210 · buka sesi prd project-level (brainstorm interaktif → dokumen PRD), lalu ke Terminal.
  // SPEC-340 · ADR-0076 · opts terisi bila PRD ini eskalasi dari audit (branch audit + dokumennya).
  async function startPrd(project: string, brief: PrdBriefForm,
                          opts?: { branchFrom?: string; fromAudit?: string }) {
    try {
      const { id } = await api.startPrd(project, brief, opts);
      openTerminal(id);
      showToast(`PRD · sesi ${id} dimulai`, "info", "scroll-text");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast("gagal mulai PRD" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
    }
  }
  // SPEC-210 · take PRD → backlog: prefill NewSpecModal (brief) dari PRD, buka modal-nya.
  function takeToBacklog(pf: PrdPrefill) { setSpecPrefill(pf); setModal("brief"); }
  // SPEC-273 · mulai sesi breakdown PRD (menulis manifest usulan backlog paralel-independen).
  async function startBreakdown(project: string, prdPath: string) {
    try {
      const { id } = await api.startBreakdown(project, prdPath);
      openTerminal(id);
      showToast(`Breakdown · sesi ${id} dimulai`, "info", "split");
    } catch (e) {
      const noRepo = e instanceof ApiError && (e.status === 422 || e.status === 400);
      showToast("gagal mulai breakdown" + (noRepo ? " · project belum punya repoDir/PRD" : ""), "warn", "x-circle");
    }
  }
  // SPEC-273 · materialize usulan breakdown → N spec independen; balik jumlah dibuat.
  async function materializeBreakdown(project: string, prdPath: string, items: BreakdownItem[]): Promise<number> {
    try {
      const { created } = await api.createSpecsBatch({ project, items, prdPath });
      setBacklog((b) => [...created, ...b]);
      setSection("backlog");
      showToast(`${created.length} backlog dibuat dari breakdown`, "ok", "list-checks");
      return created.length;
    } catch {
      showToast("Gagal membuat backlog dari breakdown", "err", "x-circle");
      return 0;
    }
  }
  // SPEC-237 · naikkan audit → Finding QA (audit tetap doc-of-record). Buka NewSpecModal source qa
  // ter-prefill (title + backlink audit di langkah); qa menjalankan audit→spec→plan→execute (perbaikan).
  // SPEC-340 · ADR-0076 · prefill kini boleh datang dari rekomendasi audit yang terbaca mesin;
  // bila tak ada, jatuh ke turunan lama (judul + objective) supaya audit pra-SPEC-340 tetap bisa naik.
  function promoteToQa(spec: Spec, e: AuditEscalation | null) {
    const pf = e?.prefill;
    const backlink = `Dari audit ${spec.id}: ${spec.objective}`;
    setSpecPrefill({ project: spec.projectId, kind: "qa", title: pf?.title || spec.title,
      steps: (pf?.steps || backlink).slice(0, 500), actual: pf?.context || spec.objective,
      severity: pf?.severity && ["critical", "major", "minor"].includes(pf.severity) ? pf.severity : "major",
      // SPEC-826 · `zEscalationPrefill.constraints` sudah ada sejak SPEC-340 tapi tak punya tujuan
      // di bentuk qa; sejak spec ini ia punya.
      constraints: pf?.constraints ?? "",
      // SPEC-244 · teruskan branch audit (hanoman/<audit-id>) + sinyal skip fase Audit (ADR-0059).
      branchFrom: `hanoman/${spec.id.toLowerCase()}`, fromAudit: spec.id });
    setModal("brief");
  }
  // SPEC-340 · ADR-0076 · audit → feature brief. Branch audit diteruskan supaya dokumen audit ada
  // di worktree; `fromAudit` membuat prompt memakainya sebagai bahan Brainstorm (TANPA skip fase).
  function promoteToBrief(spec: Spec, e: AuditEscalation | null) {
    const pf = e?.prefill;
    setSpecPrefill({ project: spec.projectId, kind: "brief", title: pf?.title || spec.title,
      context: pf?.context || `Dari audit ${spec.id}: ${spec.objective}`,
      outcome: pf?.outcome || "", branchFrom: `hanoman/${spec.id.toLowerCase()}`, fromAudit: spec.id });
    setModal("brief");
  }
  // SPEC-340 · ADR-0076 · audit → PRD. PRD bukan Spec (ADR-0041): yang dibuka modal brief PRD,
  // lalu sesi prd lahir dari branch audit dengan dokumen auditnya disematkan server ke prompt.
  function promoteToPrd(spec: Spec, e: AuditEscalation | null) {
    const pf = e?.prefill;
    setPrdFromAudit({ project: spec.projectId, branchFrom: `hanoman/${spec.id.toLowerCase()}`,
      fromAudit: spec.id, title: pf?.title || spec.title,
      context: pf?.context || `Dari audit ${spec.id}: ${spec.objective}`, outcome: pf?.outcome || "" });
  }

  // SPEC-143. Hanya menentukan basis run BERIKUTNYA; run yang sudah jalan diubah dari layar Runs.
  async function editBranch(spec: Spec, branchFrom: string | null) {
    try {
      const updated = await api.patchSpec(spec.id, { branchFrom });
      if ("pending" in updated) return; // dry-run hanya untuk revert stage — tak mungkin di sini
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " · branch " + (branchFrom ?? "main (default project)"), "ok", "git-branch");
    } catch { showToast("Gagal mengubah branch " + spec.id, "err", "x-circle"); }
  }

  // SPEC-186 · edit konten backlog selagi belum dimulai. 409 = keburu dimulai sesi lain.
  async function editSpec(spec: Spec, patch: { title?: string; priority?: string; payload?: unknown }) {
    try {
      const updated = await api.patchSpec(spec.id, patch);
      if ("pending" in updated) return;
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " diperbarui", "ok", "check");
    } catch (e) {
      const started = e instanceof ApiError && e.status === 409;
      showToast(started ? spec.id + " sudah dimulai — tak bisa diedit" : "Gagal menyimpan " + spec.id, "warn", "x-circle");
    }
  }

  // SPEC-546 · ADR-0109 · ubah type/source item in-place — id SPEC-nnn, riwayat, dan dependency
  // tetap. 409 = gerbang flow (item sudah dimulai, tujuannya beda alur kerja); 400 = bentuk
  // payload tak cocok source tujuan.
  async function changeSourceOfSpec(spec: Spec, source: string, payload?: unknown) {
    try {
      const updated = await api.changeSpecSource(spec.id, { source, payload });
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(`${spec.id} · type ${spec.source} → ${source}`, "ok", "shuffle");
    } catch (e) {
      const locked = e instanceof ApiError && e.status === 409;
      showToast(locked
        ? `${spec.id} sudah dimulai — type hanya bisa pindah ke alur kerja yang sama`
        : `Gagal mengubah type ${spec.id}`, "warn", "x-circle");
    }
  }

  // SPEC-447 · ADR-0093 · dependency bisa diubah kapan saja — ia menggerbangi peluncuran
  // BERIKUTNYA, bukan konten sesi berjalan (karena itu di luar gerbang SPEC-186). 400 = validasi
  // server (id asing, lintas project, siklus).
  async function editDeps(spec: Spec, dependsOn: string[]) {
    try {
      const updated = await api.patchSpec(spec.id, { dependsOn });
      if ("pending" in updated) return;
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " · dependency diperbarui", "ok", "lock");
    } catch (e) {
      const bad = e instanceof ApiError && e.status === 400;
      showToast(bad ? "Dependency ditolak server" : "Gagal menyimpan dependency " + spec.id, "warn", "x-circle");
    }
  }

  // SPEC-486 · ADR-0103 · override kebijakan auto-merge item; `null` = kembali ikut project.
  // Alasan yang sama dengan editDeps: ia menggerbangi apa yang terjadi SESUDAH kerja, jadi
  // boleh diubah kapan saja. 400/409 = gerbang server (branch karangan / project tanpa repoDir).
  async function editAutoMerge(spec: Spec, autoMerge: AutoMerge | null) {
    try {
      const updated = await api.patchSpec(spec.id, { autoMerge });
      if ("pending" in updated) return;
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " · auto-merge diperbarui", "ok", "git-merge");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Gagal menyimpan auto-merge " + spec.id;
      showToast(msg, "warn", "x-circle");
    }
  }

  // SPEC-167 · revert backward-only. Respons `pending` = dry-run: kembalikan ke pemanggil
  // supaya dialog konfirmasi muncul; hanya panggilan confirmDelete yang mengubah state.
  async function revertStage(spec: Spec, target: string, confirmDelete?: boolean) {
    try {
      const res = await api.patchSpec(spec.id, { stage: target, confirmDelete });
      if ("pending" in res) return res;
      setBacklog((b) => b.map((s) => (s.id === res.id ? res : s)));
      showToast(spec.id + " dikembalikan ke " + target, "warn", "rotate-ccw");
      return res;
    } catch { showToast("Gagal mengembalikan stage " + spec.id, "err", "x-circle"); return undefined; }
  }

  // SPEC-804 · ADR-0120 · tandai item selesai manual. 409 `confirm-required` bukan kegagalan:
  // server memberi tahu ada sesi hidup, dan dialog mengirim ulang dengan `confirm: true`.
  async function markSpecDone(spec: Spec, reason: string, confirm: boolean) {
    try {
      const updated = await api.markSpecDone(spec.id, { reason: reason || undefined, confirm });
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(spec.id + " ditandai selesai", "ok", "circle-check");
      return updated;
    } catch (e) {
      const detail = e instanceof ApiError
        ? (e.detail as { error?: string; session?: { id?: string } } | null) : null;
      if (detail?.error === "confirm-required")
        return { needConfirm: true as const, sessionId: detail.session?.id };
      showToast(detail?.error === "backlog item sudah selesai"
        ? spec.id + " sudah selesai" : "Gagal menandai selesai " + spec.id, "warn", "x-circle");
      return undefined;
    }
  }

  async function deleteSpec(spec: Spec) {
    await api.deleteSpec(spec.id);
    setBacklog((b) => b.filter((s) => s.id !== spec.id));
    showToast(spec.id + " dihapus dari backlog", "warn", "trash-2");
  }

  async function createSpec(f: SpecForm) {
    const isQa = f.kind === "qa";
    // SPEC-407 · ADR-0089 · SPEC-825 · ADR-0123 · goal & no_effort berbagi bentuk payload;
    // predikat bentuknya satu (`payloadShapeFor`), sumber yang sama dengan gerbang server.
    const isGoalShape = payloadShapeFor(f.kind) === "goal";
    const payload = isQa
      // SPEC-244 · fromAudit (bila qa dinaikkan dari audit) → runner lewati fase Audit (ADR-0059).
      ? { severity: f.severity, steps: f.steps, expected: f.expected, actual: f.actual, env: f.env,
          constraints: f.constraints,
          ...(f.fromAudit ? { fromAudit: f.fromAudit } : {}) }
      // Brief dari "Take ke backlog" menaut PRD lewat teks Konteks ("Dari PRD: …"), bukan field
      // payload terpisah — zBriefPayload strip key tak dikenal, dan tak ada yang mengonsumsinya.
      // SPEC-340 · ADR-0076 · brief yang dinaikkan dari audit membawa asal-usulnya ke prompt
      // (zBriefPayload kini menerima fromAudit; tanpa itu zod membuangnya di boundary).
      // SPEC-407 · ADR-0089 · backlog goal punya bentuk payload sendiri (zGoalPayload); server
      // mengikat source ↔ bentuk payload, jadi bentuk brief di sini akan ditolak 400.
      : isGoalShape
      ? { goal: f.goal.trim(), done: f.done, constraints: f.constraints, priority: f.priority }
      : { context: f.context, outcome: f.outcome, constraints: f.constraints, priority: f.priority,
          ...(f.fromAudit ? { fromAudit: f.fromAudit } : {}) };
    try {
      const created = await api.createSpec({ project: f.project, source: f.kind, title: f.title.trim(),
        priority: f.priority, payload, branchFrom: f.branchFrom || undefined,
        // SPEC-447 · ADR-0093 · dikirim hanya bila ada isinya; server yang memvalidasi.
        ...(f.dependsOn.length ? { dependsOn: f.dependsOn } : {}) });
      setBacklog((b) => [created, ...b]);
      // SPEC-843 · ADR-0124 · unggah SESUDAH item lahir — lampiran butuh specId. Kegagalannya tak
      // boleh membatalkan item yang sudah jadi; operator bisa mengulang unggah dari detail backlog.
      if (f.attachments.length) {
        const up = await api.uploadSpecAttachments(created.id, f.attachments).catch(() => null);
        if (!up) showToast("Item dibuat, tapi lampiran gagal diunggah", "warn", "paperclip");
        else if (up.rejected.length)
          showToast(`${up.rejected.length} lampiran ditolak: ${up.rejected.map((x) => x.filename).join(", ")}`,
            "warn", "paperclip");
      }
      setModal(null); setSpecPrefill(null); setSection("backlog");
      const toastMsg = f.kind === "audit" ? " dibuat · audit-only (dokumen)"
        : f.kind === "no_effort" ? " dibuat · sesi satu fase (Kerjakan)"
        : f.kind === "goal" ? " dibuat · sesi goal (Goal → Verifikasi)"
        : isQa ? " difilekan · masuk audit" : " dibuat · masuk brainstorm";
      showToast(created.id + toastMsg, "ok",
        f.kind === "audit" ? "search" : f.kind === "no_effort" ? "zap"
          : f.kind === "goal" ? "target" : isQa ? "bug" : "lightbulb");
    } catch { showToast("Gagal membuat spec", "err", "x-circle"); }
  }

  // Fetch awal dipakai semua screen kecuali Settings, jadi loading/error-nya
  // digerbangkan satu kali di sini.
  const gate = (body: React.ReactNode) =>
    status === "loading" ? <StateBlock kind="loading" title="Memuat workspace…" />
      : status === "error" ? <StateBlock kind="error" illustration="PST-006"
          title="Gagal memuat data dari server"
          hint="Pastikan server hanoman berjalan, lalu coba lagi." action={load} />
      : body;

  // SPEC-169 · gerbang auth: splash → Setup/Login → app.
  if (!auth) return <StateBlock kind="loading" title="Memuat hanoman…" />;
  if (auth.needsSetup && setupStatus?.needed && !setupDone)
    return <SetupWizard status={setupStatus} onDone={() => setSetupDone(true)} />;
  if (!auth.user) return <AuthScreen needsSetup={auth.needsSetup}
    setupTokenRequired={auth.setupTokenRequired ?? false}
    onDone={(u) => setAuth({ needsSetup: false, user: u })} />;
  // SPEC-617 · ADR-0110 · akun klien mendarat di permukaannya sendiri, bukan dashboard operator.
  // Percabangan di SINI (bukan di dalam Shell) supaya tak satu pun state/efek dashboard operator
  // pernah berjalan untuk klien — termasuk poll yang endpointnya memang 403 baginya.
  if (auth.user.role === "client")
    return <ClientPortal user={auth.user} onLoggedOut={onLoggedOut} />;
  const me: UserView = auth.user;

  let screen: React.ReactNode = null;
  if (section === "overview") {
    screen = (
      <Shell active="overview" title="Overview" breadcrumb="nafanesia.id · ringkasan workspace" onNavigate={setSection}>
        {gate(<OverviewScreen projects={projectsView} backlog={backlog} sessions={sessions}
          onOpenProject={openProject} onGoto={setSection}
          onOpenSession={(id) => { setFocusSession(id); setSection("terminal"); }} />)}
      </Shell>
    );
  } else if (section === "dalang") {
    screen = (
      <Shell active="dalang" title="Dalang Hanoman" breadcrumb="nafanesia.id · panggung orkestrasi" onNavigate={setSection}>
        {gate(<DalangHanomanScreen projects={projectsView} backlog={backlog} sessions={sessions}
          onOpenProject={openProject} onGoto={setSection}
          onOpenSession={(id) => { setFocusSession(id); setSection("terminal"); }} />)}
      </Shell>
    );
  } else if (section === "projects") {
    screen = (
      <Shell active="projects" title="Projects" breadcrumb="nafanesia.id · workspace"
        showSearch searchValue={search} onSearchChange={setSearch} onNavigate={setSection}
        actions={<Button size="sm" leftIcon="plus" onClick={() => setModal("project")}>Project baru</Button>}>
        {gate(
          projectsView.length === 0
            ? <StateBlock kind="empty" icon="box" title="Belum ada project"
                hint="Mulai dari nol atau tambahkan codebase yang sudah ada — hanoman menyusun Source of Truth-nya."
                action={() => setModal("project")} actionLabel="Project baru" />
            : <ProjectsScreen projects={projectsView} variant="list" onOpen={openProject} onDelete={deleteProject}
                pageSize={20} search={search} dataVersion={dataVersion} onClearSearch={() => setSearch("")} />)}
      </Shell>
    );
  } else if (section === "project") {
    screen = (
      <Shell active="projects" title={proj ? proj.name : "Project"}
        breadcrumb={proj ? "projects · " + proj.id : "projects"} onNavigate={setSection}>
        {/* SPEC-848 · gerbang pintu Reverse/Scaffold memakai path EFEKTIF, cermin `resolveRepoDir`
            di server: project hasil clone disimpan sebagai LocalBinding (SPEC-213/217/218) dan
            `repoDir`-nya tetap null — digerbangi `repoDir` saja, pintunya tak pernah muncul justru
            untuk project yang paling butuh jalan kembali. */}
        {gate(proj
          ? <ProjectDetailScreen p={proj} onEdit={() => setModal("project-edit")} onToast={showToast}
              onProjectChanged={refreshProject}
              onGotoDocs={() => setSection("docs")}
              onGotoTerminal={() => { setProjectFilter(proj.id); openTerminal(); }}
              onGotoBacklog={() => { setProjectFilter(proj.id); setSection("backlog"); }}
              onGotoChangelog={() => setSection("changelog")}
              onReverse={proj.kind === "existing" && (proj.binding ?? proj.repoDir) ? () => reverseDocs(proj) : undefined}
              onScaffold={proj.kind === "from-scratch" && (proj.binding ?? proj.repoDir) ? () => scaffoldDocs(proj) : undefined}
              onDelete={() => deleteProject(proj)} />
          : <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="Mulai dari nol atau tambahkan codebase yang sudah ada."
              action={() => setModal("project")} actionLabel="Project baru" />)}
      </Shell>
    );
  } else if (section === "backlog") {
    screen = (
      <Shell active="backlog" title="Backlog" breadcrumb="specs · brainstorm → execute" onNavigate={setSection}
        actions={<Button size="sm" leftIcon="plus" onClick={() => setModal("brief")}>Tambah</Button>}>
        {gate(<BacklogScreen backlog={backlog} projects={projectsView} pageSize={20}
          onStart={startSession} activeSpecs={activeSpecs} onNew={() => setModal("brief")}
          onDelete={deleteSpec}
          onOpenRun={(spec) => openTerminal(sessions.find((s) => s.specId === spec.id && !s.exited)?.id)}
          onOpenReview={openReview}
          onEditBranch={editBranch} onRevertStage={revertStage} onMarkDone={markSpecDone} onIntegrate={integrateSpec} onEditSpec={editSpec} onEditDeps={editDeps} onEditAutoMerge={editAutoMerge}
          onChangeSource={changeSourceOfSpec}
          onPromoteToQa={promoteToQa} onPromoteToBrief={promoteToBrief} onPromoteToPrd={promoteToPrd}
          onToast={showToast} initialDetailId={openSpecId}
          projectFilter={projectFilter} onProjectFilter={setProjectFilter} dataVersion={dataVersion} />)}
      </Shell>
    );
  } else if (section === "triage") {
    // SPEC-253 · Help Center: antrean triase keluhan publik → terima jadi Spec / tolak.
    // Screen mandiri (pola VPS) — memuat datanya sendiri (HTTP polling), tak lewat `gate`.
    screen = (
      <Shell active="triage" title="Triase" breadcrumb="keluhan · lapor → triase → backlog" onNavigate={setSection}>
        <TriageScreen projects={projectsView} onToast={showToast}
          onAccepted={(spec, already) => {
            showToast(already ? `Tiket sudah jadi ${spec.id}` : `Diterima → ${spec.id}`, "ok", "arrow-up-right");
            setProjectFilter(spec.projectId);
            setSection("backlog");
          }} />
      </Shell>
    );
  } else if (section === "prd") {
    // SPEC-210 · PRD: PM/PO menulis brief + brainstorm → dokumen PRD (docs/prd/), preview, take ke backlog.
    screen = (
      <Shell active="prd" title="PRD" breadcrumb="brief → brainstorm → dokumen" onNavigate={setSection}>
        {gate(projectsView.length === 0
          ? <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="PRD butuh project dengan repoDir untuk menulis docs/prd/."
              action={() => setModal("project")} actionLabel="Project baru" />
          : <PrdScreen projects={projectsView} projectFilter={projectFilter} onProjectFilter={setProjectFilter}
              onNewPrd={startPrd} onTakeToBacklog={takeToBacklog}
              onStartBreakdown={startBreakdown} onMaterialize={materializeBreakdown}
              dataVersion={dataVersion} />)}
      </Shell>
    );
  } else if (section === "terminal") {
    screen = (
      <Shell active="terminal" title="Terminal" breadcrumb="Claude Code · sesi interaktif" onNavigate={setSection} wide>
        {gate(projectsView.length === 0
          ? <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="Terminal butuh project dengan repoDir untuk dijalankan."
              action={() => setModal("project")} actionLabel="Project baru" />
          : <TerminalScreen userId={me.id} projects={projectsView} backlog={backlog} focusSession={focusSession}
              onOpenReview={openReviewSpecId} onOpenSessionReview={openSessionReview}
              titleOf={(id) => backlog.find((s) => s.id === id)?.title}
              onIntegrate={integrateSpec} onIntegrateSession={integrateSession}
              specOf={(id) => backlog.find((s) => s.id === id)} />)}
      </Shell>
    );
  } else if (section === "ide") {
    // SPEC-182 · IDE Visual: explorer + branch switch + git graph, difilter per project.
    screen = (
      <Shell active="ide" title="IDE" breadcrumb={proj ? proj.name : "workspace"} onNavigate={setSection} wide>
        {gate(projectsView.length === 0
          ? <StateBlock kind="empty" icon="box" title="Belum ada project"
              hint="IDE butuh project dengan repoDir." action={() => setModal("project")} actionLabel="Project baru" />
          : <IdeScreen projects={projectsView} projectId={proj ? proj.id : projectsView[0]!.id}
              onProject={(id) => setProjectId(id)} onToast={showToast}
              onGotoTerminal={openTerminal} />)}
      </Shell>
    );
  } else if (section === "vps") {
    // VpsScreen memuat datanya sendiri — tak lewat `gate`, yang menunggu project/backlog.
    screen = (
      <Shell active="vps" title="VPS" breadcrumb="infra · audit → harden" onNavigate={setSection}>
        <VpsScreen onToast={showToast} onGotoTerminal={openTerminal} />
      </Shell>
    );
  } else if (section === "scheduler") {
    // SPEC-299 · Panel Scheduler otonom: observabilitas + setelan + opt-in + rem darurat.
    // Screen mandiri (pola VPS) — memuat state fondasi sendiri (HTTP polling), tak lewat `gate`.
    screen = (
      <Shell active="scheduler" title="Scheduler" breadcrumb="otonom · jadwal → antrean → sesi" onNavigate={setSection}>
        <SchedulerScreen projects={projectsView} backlog={backlog}
          onProjectChanged={refreshProject} onToast={showToast}
          onGotoTerminal={openTerminal} />
      </Shell>
    );
  } else if (section === "lead") {
    // SPEC-409 · ADR-0091 · Panel hanoman-lead: jejak keputusan + rem darurat + opt-in per project.
    // Screen mandiri (pola Scheduler/VPS) — memuat statusnya sendiri lewat HTTP polling, tak lewat `gate`.
    screen = (
      <Shell active="lead" title="Lead" breadcrumb="otonom · keputusan → jejak → kendali" onNavigate={setSection}>
        <LeadScreen projects={projectsView} onProjectChanged={refreshProject} onToast={showToast}
          onGotoTerminal={openTerminal} />
      </Shell>
    );
  } else if (section === "docs") {
    screen = (
      <Shell active="docs" title="Source of Truth" breadcrumb={proj ? proj.name : "workspace"}
        onNavigate={setSection} wide
        actions={proj && <>
          <Select size="sm" value={proj.id} onChange={(e) => setProjectId(e.target.value)}
            options={projectsView.map((p) => ({ value: p.id, label: p.name }))} />
          <Button size="sm" variant="ghost" leftIcon="trash-2" onClick={() => deleteProject(proj)}>Hapus project</Button>
        </>}>
        {gate(proj
          ? <DocsWorkspace projectId={proj.id} projectName={proj.name} docStatus={proj.docStatus} />
          : <StateBlock kind="empty" icon="book-open" title="Belum ada project"
              hint="Source of Truth muncul setelah ada project yang dipantau."
              action={() => setModal("project")} actionLabel="Project baru" />)}
      </Shell>
    );
  } else if (section === "changelog") {
    // SPEC-519 · halaman changelog: entri sidebar sendiri + deep-link `#changelog=<projectId>`.
    // Pemilih project di `actions` mengikuti pola section "docs" — satu sumber "project yang
    // sedang dibuka" (projectId), bukan `projectFilter` yang bermakna "daftar disaring ke mana".
    screen = (
      <Shell active="changelog" title="Changelog"
        breadcrumb={proj ? proj.name + " · rilis untuk pemakai" : "workspace"} onNavigate={setSection}
        actions={proj && <>
          <Select size="sm" aria-label="Project" value={proj.id} onChange={(e) => setProjectId(e.target.value)}
            options={projectsView.map((x) => ({ value: x.id, label: x.name }))} />
          <Button size="sm" variant="ghost" leftIcon="link" onClick={() => {
            void navigator.clipboard?.writeText(changelogDeepLink(proj.id));
            showToast("Link halaman changelog disalin", "ok", "link");
          }}>Salin link</Button>
        </>}>
        {gate(proj
          ? <ChangelogScreen p={proj} onToast={showToast} initialChangelogId={openChangelogId} />
          : <StateBlock kind="empty" icon="megaphone" title="Belum ada project"
              hint="Changelog muncul setelah ada project yang dipantau."
              action={() => setModal("project")} actionLabel="Project baru" />)}
      </Shell>
    );
  } else if (section === "review") {
    // SPEC-171/230 · layar review file worktree — backlog item (spec) ATAU sesi PRD (session).
    const back = review?.kind === "session" ? "terminal" : "backlog";
    screen = (
      <Shell active="backlog" title="Review" wide onNavigate={setSection}
        breadcrumb={review ? (review.kind === "session" ? "terminal · " : "backlog · ") + review.id : "review"}
        actions={<Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={() => setSection(back)}>Kembali</Button>}>
        {gate(review
          ? <ReviewScreen specId={review.id} kind={review.kind} title={review.title} onBack={() => setSection(back)} />
          : <StateBlock kind="empty" icon="git-compare" title="Pilih item untuk di-review"
              hint="Buka Review dari Backlog atau dari sel sesi di Terminal." action={() => setSection("backlog")} actionLabel="Ke Backlog" />)}
      </Shell>
    );
  } else if (section === "settings") {
    screen = (
      <Shell active="settings" title="Settings" breadcrumb="nafanesia.id · workspace" onNavigate={setSection}>
        <SettingsScreen onToast={showToast} me={me} onLoggedOut={onLoggedOut} />
      </Shell>
    );
  }

  return (
    <AuthProvider user={me} onLoggedOut={onLoggedOut}>
      <NotificationsProvider showToast={showToast} onOpen={openNotification}>
        {/* SPEC-884 · ADR-0139 · instance publik yang perlindungannya turun jadi satu password
            tidak boleh terlihat sama dengan yang dikeraskan. Di luar ClientPortal: klien tak
            punya kuasa mengubahnya, jadi baginya ini cuma kecemasan tanpa tombol. */}
        <UnhardenedBanner status={setupStatus} />
        {screen}
        <HanomanPet sessions={sessions} backlog={backlog} asks={leadAsks}
          onOpen={(t) => { if (t.sessionId) setFocusSession(t.sessionId); setSection(t.section); }} />
        <NewSpecModal open={modal === "brief"} onClose={() => { setModal(null); setSpecPrefill(null); }}
          projects={projectsView} defaultProject={proj ? proj.id : ""} onCreate={createSpec}
          prefill={specPrefill ?? undefined} specs={backlog} />   {/* SPEC-447 · kandidat dependency */}
        {/* SPEC-340 · ADR-0076 · eskalasi audit → PRD: brief PRD ter-prefill, project terkunci ke
            asal audit; sesi lahir dari branch audit dengan dokumen auditnya tersemat di prompt. */}
        {prdFromAudit && (
          <NewPrdModal projects={projectsView} defaultProject={prdFromAudit.project} lockProject
            prefill={{ title: prdFromAudit.title, context: prdFromAudit.context, outcome: prdFromAudit.outcome }}
            onClose={() => setPrdFromAudit(null)}
            onCreate={(project, brief) => {
              startPrd(project, brief, { branchFrom: prdFromAudit.branchFrom, fromAudit: prdFromAudit.fromAudit });
              setPrdFromAudit(null);
            }} />
        )}
        <NewProjectModal open={modal === "project"} onClose={() => setModal(null)} onCreate={createProject} />
        <EditProjectModal open={modal === "project-edit"} project={proj} onClose={() => setModal(null)} onSave={updateProject} />
        {/* SPEC-252 · ADR-0061 · picker model/effort per sesi saat Start backlog.
            SPEC-394 · ADR-0084 · toast membedakan "dilanjutkan" dari "dimulai": tombolnya memang
            berbunyi "Lanjutkan", jadi toast yang selalu berkata "dimulai" ikut menegaskan kesan
            keliru bahwa pekerjaan sebelumnya dibuang. */}
        <StartSessionModal open={!!startSpec} spec={startSpec} onClose={() => setStartSpec(null)}
          onStarted={(id, resumed) => showToast(
            (startSpec?.id ?? "") + " · sesi " + id + (resumed ? " dilanjutkan" : " dimulai"),
            "info", "play")}
          onError={(e) => {
            const noRepo = e instanceof ApiError && (e.status === 400 || e.status === 422);
            showToast((startSpec?.id ?? "") + " · gagal mulai sesi" + (noRepo ? " · project belum punya repoDir" : ""), "warn", "x-circle");
          }} />
        {dialog}
        <Toast toast={toast} />
      </NotificationsProvider>
    </AuthProvider>
  );
}
