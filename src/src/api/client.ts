import { paths, type Paginated, type ProjectView, type Spec, type Setting, type Notification, type VpsView, type VpsCheck, type ChecklistView, type RemediateStep, type AuthStatus, type UserView, type LimitsDTO, type PrdDoc, type DeviceTokenView, type SessionResultView, type SessionHistoryView, type ConfigResponse, type ConfigEntryView, type TicketView, type TicketDetail, type TicketEditInput, type AgentTokenView, type CapabilityInfo, type SyncConflictView, type BreakdownDoc, type BreakdownItem, type Scheduler, type SchedulerStateView, type SchedulerQueueItemView, type Agent, type AgentRuntime, type AuditEscalationView, type VerifyScope, type Lead, type LeadStatusView, type LeadDecisionView, type LeadFlowView, type CustomAgentView, type CreateCustomAgent, type UpdateCustomAgent, type AgentCatalogView, type AgentMetricsView, type AgentInvocationView, type AgentDisposition, type GithubIssueView, type TelegramGatewayStatus, type TelegramCredentialsView, type TelegramTestResult, type TelegramClearResult, type WebhookEndpointView, type WebhookDeliveryView, type WebhookTestResult, type CreateWebhookEndpoint, type UpdateWebhookEndpoint, type AutoMerge, type ChangelogView, type ChangelogSources, type ChangelogRequest, type ClientAccountView, type SchedulerCronView, type SchedulerCronRunView, type MethodStatusResponse, type WorktreeCleanupView, type TerminalWorkspaceSnapshot, type TerminalWorkspaceWrite, type SpecAttachmentView, type HandledByEntry, type PresenceView,
  type ProvisionComponent, type ComponentProbe, type ComponentId, type ProvisionProfile,
  type ProvisionStep, type ProvisionResult,
  type SessionDialogAnswer, type SessionDialogPayload,
  type SetupStatus, type SetupApplyResult,
  type TaskView, type MemberView, type CreateTaskInput, type EscalateTaskInput, type PatchTaskInput,
  type CreateMemberInput, type PatchMemberInput } from "@hanoman/shared";
// SPEC-450 · `detail` = body JSON respons galat (best-effort, null bila bukan JSON). Ditambahkan
// karena penolakan custom agent membawa informasi yang HARUS sampai ke operator — jalur siklus
// (`cycle`/`scope`) dan daftar mention tak dikenal (`unknown`); "409" saja tak bisa ditindaklanjuti.
// Opsional & aditif: pemanggil lama tak berubah sedikit pun.
export class ApiError extends Error {
  constructor(public status: number, msg: string, public detail: unknown = null) { super(msg); }
}
// SPEC-407 · ADR-0089 · +goal · sesi dua fase (Goal → Verifikasi), tanpa fase perencanaan.
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "goal" | "no_effort";
// SPEC-210 · dokumen PRD project (freshest-wins: worktree sesi prd hidup > repoDir). Tipe di @hanoman/shared.
export type { PrdDoc };
export type Phase = { name: string; state: "done" | "skipped" | "active" | "pending" };
export type TerminalSession = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  branch?: string;   // SPEC-230 · branch integrasi sesi (PRD: prd/<slug>)
  // SPEC-903 · ADR-0143 · KEADAAN TURUNAN: marker keputusan terisi DAN pane sudah diam. Jangan
  // menambah predikat kedua di atasnya — kosakata TerminalScreen & pet-state identik justru karena
  // keduanya membaca bit yang sama ini.
  decision?: boolean;
  // SPEC-402 · kode keluar pane mati (undefined selama hidup) — pembeda "Selesai" vs "Gagal".
  exitCode?: number;
  // SPEC-409 · ADR-0091 · hanoman-lead sedang MENYUSUN keputusan untuk sesi ini. Bentuknya di layar
  // sama persis dengan "mandek menunggu manusia" (diam, marker terisi), jadi tanpa penanda ini
  // operator membaca sesi yang justru sedang dilayani sebagai sesi yang terbengkalai.
  deciding?: boolean;
  // SPEC-898 · ADR-0141 · ISO onset episode "menunggu manusia". SPEC-903 · ADR-0143 · = `max(stempel
  // di marker, keluaran terakhir pane)`, yakni awal episode yang SEDANG berlangsung — satu episode
  // marker bisa memuat beberapa episode menunggu. Absen = tak diketahui; pet tak pernah
  // mengeskalasi tanpa stempel.
  decisionAt?: string;
};
// SPEC-167 · respons dry-run PATCH /specs/:id saat revert akan menghapus artefak.
export type RevertPending = { pending: true; stage: string; wouldDelete: string[] };
// ADR-0149 · dry-run perpindahan type LINTAS-ALUR: apa saja yang hilang bila operator lanjut.
// Daftarnya boleh kosong bertiga — konfirmasi tetap diminta, karena yang disetujui bukan cuma
// penghapusan melainkan mundurnya item ke `brainstorming`.
export type SourceResetPending = {
  pending: true; wouldDelete: string[]; worktree: string | null; branch: string | null;
};
// SPEC-170 · dokumen backlog item
export type DocKind = "audit" | "spec" | "plan" | "objective" | "brainstorm" | "other";
export type SpecDoc = { kind: DocKind; path: string; name: string };
// SPEC-171 · review worktree backlog item.
export type ChangedFile = { path: string; add: number; del: number; status: "A" | "M" | "D"; binary: boolean };
export type SpecReview = { base: string; files: string[]; changed: ChangedFile[] };
export type ReviewFile = {
  path: string; status: "A" | "M" | "D" | null; binary: boolean;
  truncated: boolean; diff: string | null; content: string | null;
};
// SPEC-182 · IDE Visual
export type RepoFile = { path: string; content: string | null; binary: boolean; truncated: boolean };
// Pohon berkas Explorer. `dirs` = direktori yang isinya BELUM dimuat (direktori terabaikan yang
// diruntuhkan server); `ignored` = entri yang .gitignore sembunyikan, untuk ditandai di UI.
export type IdeTree = { ref: string; files: string[]; dirs?: string[]; ignored?: string[]; truncated?: boolean };
// SPEC-234 · status working tree utama (staged/unstaged), diturunkan dari git.
export type WorkingStatus = { branch: string; staged: ChangedFile[]; unstaged: ChangedFile[] };
// ADR-0121 · unggahan selalu 200 selama badannya sah; kegagalan per-berkas hidup di `skipped`
// (pola POST /branches/delete), supaya satu berkas bentrok tak membatalkan 999 lainnya.
export type IdeUploadResult = {
  written: string[];
  skipped: { path: string; reason: "exists" | "too-large" | "budget" | "denied" }[];
};
// SPEC-908 · satu definisi di @hanoman/shared; dulu kembar dengan server/src/services/git-ide.ts.
import type { GraphCommit, RepoStatus, Stash } from "@hanoman/shared";
export type { GraphCommit, RepoStatus, Stash } from "@hanoman/shared";
export type CommitDetail = { sha: string; parents: string[]; author: string; at: string; subject: string; body: string; changed: ChangedFile[]; signed: boolean; committer: string; committedAt: string; authorEmail: string };
export type GitOp =
  | { op: "checkout"; ref: string; force?: boolean }
  | { op: "branch"; name: string; at?: string; checkout?: boolean }
  | { op: "merge"; ref: string; ff?: "no-ff" | "ff-only"; deleteBranch?: string; force?: boolean }
  | { op: "cherry-pick"; sha: string; force?: boolean }
  | { op: "revert"; sha: string; force?: boolean }
  // SPEC-206 · local (default true) dan/atau origin (remote)
  | { op: "delete-branch"; name: string; force?: boolean; local?: boolean; remote?: boolean }
  // SPEC-233 · reset branch current ke commit (soft/mixed/hard)
  | { op: "reset"; sha: string; mode: "soft" | "mixed" | "hard"; force?: boolean }
  // SPEC-233 · tag: buat (annotated bila message, di `at` bila ada, push opsional), hapus, push
  | { op: "tag"; name: string; message?: string; at?: string; push?: boolean; force?: boolean }
  | { op: "delete-tag"; name: string; remote?: boolean; force?: boolean }
  | { op: "push-tag"; name: string; force?: boolean }
  // SPEC-233 · operasi baris uncommitted
  | { op: "reset-worktree"; mode: "mixed" | "hard"; force?: boolean }
  | { op: "clean"; directories?: boolean; ignored?: boolean; force?: boolean }
  // SPEC-233 · stash (server: PR4)
  | { op: "stash"; message?: string; includeUntracked?: boolean; force?: boolean }
  | { op: "stash-apply"; ref: string; index?: boolean; force?: boolean }
  | { op: "stash-pop"; ref: string; index?: boolean; force?: boolean }
  | { op: "stash-drop"; ref: string; force?: boolean }
  | { op: "stash-branch"; ref: string; name: string; force?: boolean }
  // SPEC-233 · branch ref-only ops
  | { op: "rename-branch"; from: string; to: string; force?: boolean }
  | { op: "push-branch"; name: string; setUpstream?: boolean; force?: boolean }
  | { op: "fetch"; prune?: boolean; pruneTags?: boolean; force?: boolean };
export type Remote = { name: string; fetch: string; push: string };
export type GitOpResult = { ok: boolean; stdout: string; stderr: string; current: string; error?: string };
// SPEC-229 · hasil merge via git graph: bersih → detail; konflik → sesi claude (sessionId).
export type GraphMergeResult = { status: "clean"; detail: string } | { status: "conflict"; sessionId: string };
// SPEC-360 · ADR-0077 · branch & hapus batch. Cermin server/src/services/branch-cleanup.ts.
export type BranchLock = "current" | "base" | "worktree" | "spec-open" | "session";
export type BranchScope = "local" | "remote" | "both";
export type UnusedBranch = {
  name: string;
  // SPEC-859 · `local`/`remote` = ref itu ADA; merged-ness terpisah di tiga field di bawah.
  local: boolean; remote: boolean;
  merged: boolean; mergedLocal: boolean; mergedRemote: boolean;
  lastCommit: { sha: string; at: string; subject: string } | null;
  locks: BranchLock[];
  /** SPEC-861 · path worktree yang menahannya; ada hanya saat kunci `worktree` menyala. */
  worktree?: string;
};
export type UnusedReport = { base: string; baseRemote: string | null; current: string; branches: UnusedBranch[] };
export type BranchDeleteResult = { name: string; ok: boolean; scope: BranchScope | "none"; forced?: true; error?: string };
// Label badge kunci di UI — versi ringkas LOCK_REASON server (badge sempit, prosa panjang di error).
export const LOCK_LABEL: Record<BranchLock, string> = {
  current: "branch aktif",
  base: "base",
  worktree: "dipakai worktree",
  "spec-open": "backlog belum selesai",
  session: "sesi aktif",
};
// SPEC-861 · ADR-0132 · cermin server/src/services/worktree-list.ts + shared/src/dto.ts.
export type WorktreeView = {
  path: string; name: string; head: string; branch: string | null;
  prunable: boolean; locked: boolean; deletable: boolean; blocked: string | null;
  spec: { id: string; stage: string } | null;
  session: { id: string; specId: string | null } | null;
  createdAt: string | null;
};
export type WorktreeReport = { repoDir: string; worktrees: WorktreeView[] };
export type WorktreeStats = { name: string; sizeBytes: number | null; dirtyFiles: number; orphanCommits: number };
export type WorktreeDeleteResult = {
  name: string; ok: boolean; cleanup: string | null; closedSession?: string;
  branch?: { name: string; ok: boolean; error?: string }; error?: string;
};
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new ApiError(res.status, `${init?.method ?? "GET"} ${url} → ${res.status}`, detail);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
const body = (b: unknown) => ({ body: JSON.stringify(b) });
// SPEC-816 · multipart punya fetch sendiri: `j()` memaksa `content-type: application/json`, dan
// header itu MENGHAPUS boundary yang dihasilkan FormData → server tak bisa mem-parse body-nya.
async function jUpload<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, detail?.error ?? `POST ${url} → ${res.status}`, detail);
  }
  return res.json() as Promise<T>;
}
// SPEC-198 · bangun query-string; buang undefined/"" (caller memetakan sentinel "all" → undefined).
const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};
export type SpecListParams = {
  project?: string; source?: string; q?: string; stage?: string; priority?: string;
  startable?: boolean; page?: number; limit?: number;
  // SPEC-408 · ADR-0090 · rentang tanggal. `dateField` memilih sumbunya; `from`/`to` = `YYYY-MM-DD`
  // (bentuk yang dipancarkan `<input type="date">`), inklusif, boleh sendirian.
  dateField?: "created" | "started"; from?: string; to?: string;
};
// SPEC-880 · `handledBy` = deviceId; menjawab "apa saja yang dipegang mesin X" dalam satu klik.
export type ProjectListParams = { q?: string; handledBy?: string; page?: number; limit?: number };
export const api = {
  issueWsTicket: (target: "events" | `terminal:${string}`) =>
    j<{ ticket: string }>(paths.wsTickets, { method: "POST", ...body({ target }) }),
  // SPEC-816 · lampiran gambar sesi terminal. Yang kembali adalah PATH berkas di server; pane
  // mengetikkannya ke prompt dan agen membacanya sendiri dengan Read.
  uploadTerminalAttachment: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name || "lampiran");
    return jUpload<{ path: string }>(paths.terminalAttachments(sessionId), form);
  },
  listProjects: (params: ProjectListParams = {}) => j<Paginated<ProjectView>>(paths.projects + qs(params)),
  getProject: (id: string) => j<ProjectView>(paths.project(id)),
  createProject: (b: unknown) => j<ProjectView>(paths.projects, { method: "POST", ...body(b) }),
  deleteProject: (id: string) => j<void>(paths.project(id), { method: "DELETE" }),
  // SPEC-146 · hanya label. `id` tak pernah berubah, jadi respons selalu punya `id` yang sama.
  // SPEC-217 · `repoDir` = path default/server editable (null = kosongkan).
  updateProject: (id: string, b: { name?: string; desc?: string; gitRemote?: string; repoDir?: string | null; schedulerOptIn?: boolean; leadOptIn?: boolean;
    autoMerge?: AutoMerge | null;   // SPEC-486 · ADR-0103 · null = tanpa auto-merge
    handledBy?: HandledByEntry[] | null }) =>   // SPEC-880 · ADR-0135 · null/[] = belum ditetapkan
    j<ProjectView>(paths.project(id), { method: "PATCH", ...body(b) }),
  // SPEC-255 · ADR-0064 · rename slug project. Balik: id baru + DSN/Help URL baru (bila aktif) + affected.
  renameProject: (id: string, newId: string) =>
    j<{ id: string; dsnUrl?: string; helpUrl?: string; affected: Record<string, number> }>(
      paths.projectRename(id), { method: "POST", ...body({ newId }) }),
  // SPEC-217 · path per-mesin (LocalBinding, tak disync). put/delete = set/kosongkan override.
  getBinding: (id: string) => j<{ repoDir: string | null }>(paths.binding(id)),
  putBinding: (id: string, repoDir: string) =>
    j<{ repoDir: string }>(paths.binding(id), { method: "PUT", ...body({ repoDir }) }),
  deleteBinding: (id: string) => j<void>(paths.binding(id), { method: "DELETE" }),
  cloneProject: (id: string, dir: string) =>
    j<{ repoDir: string }>(paths.clone(id), { method: "POST", ...body({ dir }) }),
  listSpecs: (params: SpecListParams = {}) => j<Paginated<Spec>>(paths.specs + qs(params)),
  createSpec: (b: unknown) => j<Spec>(paths.specs, { method: "POST", ...body(b) }),
  deleteSpec: (id: string) => j<void>(paths.spec(id), { method: "DELETE" }),
  // SPEC-843 · ADR-0124 · lampiran backlog. Unggah lewat jUpload (bukan j): header
  // application/json menghapus boundary FormData.
  listSpecAttachments: (id: string) =>
    j<{ attachments: SpecAttachmentView[] }>(paths.specAttachments(id)),
  uploadSpecAttachments: (id: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f, f.name || "lampiran");
    return jUpload<{ saved: SpecAttachmentView[]; rejected: { filename: string; reason: string }[] }>(
      paths.specAttachments(id), form);
  },
  deleteSpecAttachment: (id: string, attId: string) =>
    j<{ ok: true }>(paths.specAttachment(id, attId), { method: "DELETE" }),
  // SPEC-143 · branch sumber worktree milik backlog item. `null` = default project (main).
  // SPEC-175 · `remotes` = branch origin, target rebase/merge.
  // SPEC-486 · ADR-0103 · `defaultBranch` memasok label opsi "default branch repo".
  listBranches: (id: string) => j<{ branches: string[]; remotes: string[]; defaultBranch?: string | null }>(paths.branches(id)),
  // SPEC-175 · rebase/merge branch hasil done spec.
  integrateSpec: (id: string, op: "merge" | "rebase", target: string) =>
    j<{ status: "clean"; detail: string } | { status: "conflict"; sessionId: string }>(
      paths.specIntegrate(id), { method: "POST", ...body({ op, target }) }),
  patchSpec: (id: string, b: { branchFrom?: string | null; stage?: string; confirmDelete?: boolean;
    title?: string; priority?: string; payload?: unknown;
    dependsOn?: string[];   // SPEC-447 · ADR-0093 · divalidasi server (400 bila tak sah)
    autoMerge?: AutoMerge | null }) =>   // SPEC-486 · ADR-0103 · null = kembali ikut project
    j<Spec | RevertPending>(paths.spec(id), { method: "PATCH", ...body(b) }),
  // SPEC-546 · ADR-0109 · ubah type/source item in-place. `payload` dihilangkan untuk item yang
  // sudah dimulai & SE-ALUR (server memakai payload lama apa adanya).
  // ADR-0149 · lintas-alur pada item yang sudah dimulai menjawab `SourceResetPending` sampai
  // `confirmReset: true` dikirim; 409 `session-live` = ada sesi yang masih berjalan.
  changeSpecSource: (id: string, b: { source: string; payload?: unknown; confirmReset?: boolean }) =>
    j<Spec | SourceResetPending>(paths.specSource(id), { method: "POST", ...body(b) }),
  // SPEC-804 · ADR-0120 · tandai item selesai manual. 409 `confirm-required` (detail memuat
  // `session`) = ada sesi hidup; kirim ulang dengan `confirm: true`.
  markSpecDone: (id: string, b: { reason?: string; confirm?: boolean }) =>
    j<Spec>(paths.specDone(id), { method: "POST", ...body(b) }),
  // SPEC-171 · all files + file changed dari worktree backlog item.
  specReview: (id: string) => j<SpecReview>(paths.specReview(id)),
  specReviewFile: (id: string, path: string) => j<ReviewFile>(paths.specReviewFile(id, path)),
  getSettings: () => j<Setting>(paths.settings),
  putSettings: (b: unknown) => j<Setting>(paths.settings, { method: "PUT", ...body(b) }),
  getTelegramStatus: () => j<TelegramGatewayStatus>(paths.telegramStatus),
  // SPEC-477 · ADR-0097 · kredensial Telegram dari Settings (cookie-only). Secret tak pernah
  // balik utuh — `masked` + `hasValue`; mengirim string kosong = pertahankan nilai lama.
  getTelegramCredentials: () => j<TelegramCredentialsView>(paths.telegramSettings),
  putTelegramCredentials: (patch: Record<string, string>) =>
    j<TelegramCredentialsView>(paths.telegramSettings, { method: "PUT", ...body(patch) }),
  testTelegramConnection: () => j<TelegramTestResult>(paths.telegramTest, { method: "POST", ...body({}) }),
  deleteTelegramCredentials: () => j<TelegramClearResult>(paths.telegramCredentials, { method: "DELETE" }),
  // SPEC-339 · versi codex CLI; dipakai catatan "CLI terlalu tua" di Settings & picker Start.
  getCodexVersion: () => j<{ version: string | null; minRequired: string; ok: boolean }>(paths.codexVersion),
  // SPEC-739 · ADR-0114 · kesiapan skill metode per agen. LOCAL-only, diturunkan live dari disk.
  getMethodStatus: () => j<MethodStatusResponse>(paths.methodStatus),
  // SPEC-215 · config runtime
  getConfig: () => j<ConfigResponse>(paths.config),
  putConfig: (key: string, value: string) => j<ConfigEntryView>(paths.config, { method: "PUT", ...body({ key, value }) }),
  deleteConfig: (key: string) => j<void>(paths.configKey(key), { method: "DELETE" }),
  // SPEC-268 · ADR-0066 · pemicu sync manual (tombol Backlog/Triase)
  // SPEC-382 · opts.full → tarik ulang feed dari awal (pemulihan baris yang terlewat kursor)
  // SPEC-799 · ADR-0119 · `deleted`/`dropped` ikut: tombstone yang menyeberang & record yang dibuang
  // sengaja (upsert basi atas id bertombstone, anak bagi induk bertombstone).
  syncNow: (opts?: { full?: boolean }) =>
    j<{ ok: boolean; reason?: string; full?: boolean; pulled?: number; pushed?: number;
        conflicts?: number; deleted?: number; dropped?: number }>(
      paths.syncNow, { method: "POST", ...body({ full: opts?.full === true }) }),
  // SPEC-799 · ADR-0119 · penghapusan yang masih menunggu jendela online (instance client offline).
  getSyncPending: () => j<{ deletes: { entity: string; recordId: string; deletedAt: string }[]; total: number }>(
    paths.syncPending),
  // SPEC-270 · ADR-0067 · rekonsil konflik
  listConflicts: () => j<{ conflicts: SyncConflictView[] }>(paths.syncConflicts),
  resolveConflict: (entity: string, recordId: string, choice: "local" | "server") =>
    j<{ ok: boolean; reason?: string }>(paths.syncConflictResolve(entity, recordId), { method: "POST", ...body({ choice }) }),
  // SPEC-180 · notifikasi backlog selesai
  // SPEC-523 · tanpa params → 50 teratas (perilaku bell yang didorong WS). Dengan page/limit →
  // halaman arsip. `total` selalu ada di kedua bentuk.
  listNotifications: (p: { page?: number; limit?: number } = {}) =>
    j<Paginated<Notification> & { unread: number }>(paths.notifications + qs(p)),
  markNotificationsRead: () => j<void>(paths.notifications + "/read", { method: "POST" }),
  clearNotifications: () => j<void>(paths.notifications, { method: "DELETE" }),
  getLimits: () => j<LimitsDTO>(paths.limits),
  getDocs: (id: string) => j<{ coverage: number; tree: any[] }>(paths.docs(id)),
  getDoc: (id: string, path: string) => j<{ path: string; content: string }>(paths.docFile(id, path)),
  getSpecDocs: (id: string) => j<{ files: SpecDoc[] }>(paths.specDocs(id)),
  getSpecDocFile: (id: string, path: string) => j<{ path: string; content: string }>(paths.specDocFile(id, path)),
  // SPEC-361 · ADR-0078 · URL unduh dokumen. Dipakai <a download>, BUKAN fetch: server yang
  // menamai berkas lewat content-disposition, dan cookie sesi ikut same-origin.
  specDocDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") => paths.download(paths.specDocFile(id, path), fmt),
  docDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") => paths.download(paths.docFile(id, path), fmt),
  prdDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") => paths.download(paths.prdFile(id, path), fmt),
  ideFileDownloadUrl: (id: string, path: string, ref: string, fmt: "md" | "pdf") =>
    paths.download(paths.ideFile(id, path, ref), fmt),
  // SPEC-385 · ADR-0078 · URL unduh untuk pratinjau di Review & pane diff IDE. Isi yang diunduh
  // = `ReviewFile.content` (isi SESUDAH perubahan), persis yang dirender DocPreviewModal.
  specReviewFileDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") =>
    paths.download(paths.specReviewFile(id, path), fmt),
  sessionReviewFileDownloadUrl: (id: string, path: string, fmt: "md" | "pdf") =>
    paths.download(paths.sessionReviewFile(id, path), fmt),
  ideFileDiffDownloadUrl: (id: string, path: string, staged: boolean, fmt: "md" | "pdf") =>
    paths.download(paths.ideFileDiff(id, path, staged), fmt),
  ideCommitFileDownloadUrl: (id: string, sha: string, path: string, fmt: "md" | "pdf") =>
    paths.download(paths.ideCommitFile(id, sha, path), fmt),
  ideCompareFileDownloadUrl: (id: string, from: string, to: string, path: string, fmt: "md" | "pdf") =>
    paths.download(paths.ideCompareFile(id, from, to, path), fmt),
  // SPEC-489 · naskah panduan AI agent — teks MENTAH, bukan JSON (`j()` akan mencoba mem-parse
  // dan gagal). Sengaja tanpa header auth: endpointnya publik, dan itulah yang membuat "cukup
  // diberi tautan" benar-benar berlaku.
  agentDoc: async (): Promise<string> => {
    const res = await fetch(paths.agentDoc, { headers: { accept: "text/markdown" } });
    if (!res.ok) throw new ApiError(res.status, `GET ${paths.agentDoc} → ${res.status}`);
    return res.text();
  },
  // SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit (turunan dokumen audit, bukan kolom DB).
  getEscalation: (id: string) => j<AuditEscalationView>(paths.specEscalation(id)),
  putDoc: (id: string, path: string, content: string) =>
    j<{ path: string; content: string }>(paths.docFile(id, path), { method: "PUT", ...body({ content }) }),
  deleteDoc: (id: string, path: string) => j<void>(paths.docFile(id, path), { method: "DELETE" }),
  ideTree: (id: string, ref = "", opts?: { hidden?: boolean; under?: string }) =>
    j<IdeTree>(paths.ideTree(id, ref, opts)),
  ideFile: (id: string, path: string, ref = "") => j<RepoFile>(paths.ideFile(id, path, ref)),
  putIdeFile: (id: string, path: string, content: string) =>
    j<{ path: string; content: string }>(paths.ideFile(id), { method: "PUT", ...body({ path, content }) }),
  // ADR-0121 · operasi berkas Explorer.
  ideCreateEntry: (id: string, path: string, kind: "file" | "dir") =>
    j<{ path: string }>(paths.ideEntry(id), { method: "POST", ...body({ path, kind }) }),
  ideRenameEntry: (id: string, from: string, to: string) =>
    j<{ from: string; to: string }>(paths.ideEntry(id), { method: "PATCH", ...body({ from, to }) }),
  ideDeleteEntry: (id: string, path: string) =>
    j<{ path: string; kind: "file" | "dir" }>(paths.ideEntry(id, path), { method: "DELETE" }),
  // Urutan append ADALAH kontrak: server membaca manifest sebelum part berkas pertama.
  ideUpload: (id: string, dir: string, files: { path: string; file: File }[], overwrite = false) => {
    const form = new FormData();
    form.append("dir", dir);
    if (overwrite) form.append("overwrite", "1");
    form.append("manifest", JSON.stringify(files.map((f) => f.path)));
    for (const f of files) form.append("file", f.file, f.path.split("/").pop() || "berkas");
    return jUpload<IdeUploadResult>(paths.ideUpload(id), form);
  },
  ideGraph: (id: string, limit = 200, opts?: { branches?: string[]; showRemote?: boolean; showTags?: boolean }) =>
    // SPEC-523 · `total` = commit terjangkau dari ref yang digambar. Graph tetap JENDELA
    // tumbuh (SPEC-351), bukan halaman diskrit — lane butuh commit kontigu (ADR-0107).
    j<{ commits: GraphCommit[]; current: string; total: number }>(paths.ideGraph(id, limit, opts)),
  // SPEC-233 · status working tree (baris uncommitted changes)
  ideStatus: (id: string) => j<RepoStatus>(paths.ideStatus(id)),
  ideSearch: (id: string, q: string, by = "all") => j<{ shas: string[] }>(paths.ideSearch(id, q, by)), // SPEC-233
  ideStashes: (id: string) => j<Stash[]>(paths.ideStashes(id)), // SPEC-233 · daftar stash
  // SPEC-233 · remote mgmt + pr-url + archive
  ideRemotes: (id: string) => j<Remote[]>(paths.ideRemotes(id)),
  ideAddRemote: (id: string, name: string, url: string) => j<Remote[]>(paths.ideRemotes(id), { method: "POST", ...body({ name, url }) }),
  idePatchRemote: (id: string, name: string, url: string) => j<Remote[]>(paths.ideRemote(id, name), { method: "PATCH", ...body({ url }) }),
  ideDeleteRemote: (id: string, name: string) => j<Remote[]>(paths.ideRemote(id, name), { method: "DELETE" }),
  idePrUrl: (id: string, branch: string, base?: string) => j<{ url: string | null }>(paths.idePrUrl(id, branch, base)),
  ideArchiveUrl: (id: string, ref: string, format = "zip") => paths.ideArchive(id, ref, format),
  ideCommit: (id: string, sha: string) => j<CommitDetail>(paths.ideCommit(id, sha)),
  ideCommitFile: (id: string, sha: string, path: string) => j<ReviewFile>(paths.ideCommitFile(id, sha, path)), // SPEC-233
  ideCompare: (id: string, from: string, to: string) => j<{ from: string; to: string; changed: ChangedFile[] }>(paths.ideCompare(id, from, to)),
  ideCompareFile: (id: string, from: string, to: string, path: string) => j<ReviewFile>(paths.ideCompareFile(id, from, to, path)),
  ideGit: (id: string, op: GitOp) => j<GitOpResult>(paths.ideGit(id), { method: "POST", ...body(op) }),
  // SPEC-229 · merge via git graph: deterministik di worktree isolasi; conflict → sesi claude.
  ideGitMerge: (id: string, b: { source: string; ff?: "no-ff" | "ff-only"; deleteBranch?: string }) =>
    j<GraphMergeResult>(paths.ideGitMerge(id), { method: "POST", ...body(b) }),
  // SPEC-234 · status working tree + diff satu file working tree (endpoint /working-status, beda dari ideStatus SPEC-233).
  ideWorkingStatus: (id: string) => j<WorkingStatus>(paths.ideWorkingStatus(id)),
  ideFileDiff: (id: string, path: string, staged: boolean) => j<ReviewFile>(paths.ideFileDiff(id, path, staged)),
  // SPEC-233 · rebase/pull/drop via git graph: isolasi + conflict → sesi claude (bentuk sama).
  ideGitRebase: (id: string, onto: string) => j<GraphMergeResult>(paths.ideGitRebase(id), { method: "POST", ...body({ onto }) }),
  ideGitPull: (id: string, b: { source: string; ff?: "no-ff" | "ff-only" }) => j<GraphMergeResult>(paths.ideGitPull(id), { method: "POST", ...body(b) }),
  ideGitDrop: (id: string, sha: string) => j<GraphMergeResult>(paths.ideGitDrop(id), { method: "POST", ...body({ sha }) }),
  // SPEC-360 · ADR-0077 · daftar branch + hapus batch (local/origin).
  // SPEC-859 · `include: "all"` memuat branch belum ter-merge; `allowUnmerged` membuka hapusnya.
  branchesUnused: (id: string, base?: string, include?: "all") =>
    j<UnusedReport>(paths.branchesUnused(id, base, include)),
  deleteBranches: (id: string, b: { names: string[]; scope?: BranchScope; base?: string; allowUnmerged?: boolean }) =>
    j<{ base: string; results: BranchDeleteResult[] }>(paths.branchesDelete(id), { method: "POST", ...body(b) }),
  // SPEC-861 · ADR-0132 · worktree hidup. `worktreeStats` terpisah karena `du` lambat: daftar
  // lahir dulu, sinyal mahal menyusul per baris.
  worktrees: (id: string) => j<WorktreeReport>(paths.worktrees(id)),
  worktreeStats: (id: string, name: string) => j<WorktreeStats>(paths.worktreeStats(id, name)),
  deleteWorktrees: (id: string, b: { names: string[]; deleteBranch?: boolean }) =>
    j<{ results: WorktreeDeleteResult[] }>(paths.worktreesDelete(id), { method: "POST", ...body(b) }),
  browseFs: (path?: string) =>
    j<{ path: string; parent: string | null; entries: { name: string; path: string }[] }>(paths.fsBrowse(path)),
  listTerminals: () => j<TerminalSession[]>(paths.terminalSessions),
  // SPEC-899 · ADR-0142 · inbox keputusan. `204` (pane tak menampilkan dialog yang bisa dijawab)
  // dinormalkan ke `null` supaya pemanggil tak perlu membedakannya dari "belum dimuat".
  sessionDialog: (id: string) =>
    j<SessionDialogPayload | undefined>(paths.terminalDialog(id)).then((p) => p ?? null),
  answerSessionDialog: (id: string, b: SessionDialogAnswer) =>
    j<{ accepted: true }>(paths.terminalDialogAnswer(id), { method: "POST", ...body(b) }),
  // SPEC-909 · ADR-0146 · AC-6 · ambil alih dari hanoman-lead. `409 reason:"answering"` = terlambat:
  // lead sudah mengirim jawabannya ke pane.
  takeoverSessionDialog: (id: string) =>
    j<{ accepted: true }>(paths.terminalDialogTakeover(id), { method: "POST" }),
  getTerminalWorkspace: () => j<TerminalWorkspaceSnapshot>(paths.terminalWorkspace),
  putTerminalWorkspace: (input: TerminalWorkspaceWrite) =>
    j<TerminalWorkspaceSnapshot>(paths.terminalWorkspace, { method: "PUT", ...body(input) }),
  // SPEC-517 · runtime PER SESI untuk terminal agen biasa (opsional; kosong → default global di
  // server). Tanpa `opts`, body byte-identik dengan sebelum SPEC-517.
  createTerminal: (project: string, opts?: { agent?: Agent; model?: string; effort?: string }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, ...(opts ?? {}) }) }),
  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project (tanpa flow).
  // SPEC-739 · ADR-0114 · `install` opsional membuat pane menjalankan perintah pemasangan metode
  // yang diturunkan SERVER dari katalog; tanpa argumen itu, body-nya byte-identik dengan sebelumnya.
  createShell: (project: string, install?: { method: string; agent: Agent }) =>
    j<{ id: string }>(paths.terminalSessions, {
      method: "POST", ...body({ project, shell: true, ...(install ? { install } : {}) }),
    }),
  // SPEC-162 · sesi claude interaktif untuk sebuah backlog item, di worktree-nya sendiri.
  // SPEC-252 · ADR-0061 · model/effort per sesi (opsional; kosong → default global di server).
  // SPEC-332 · ADR-0073 · mode goal per sesi (opsional; kosong → default global di server).
  startSession: (b: { spec: string; flow: Flow; model?: string; effort?: string; goal?: boolean; goalCondition?: string;
    agent?: Agent;                    // SPEC-338 · ADR-0074 · mesin sesi; kosong → Setting.agent
    verifyScope?: VerifyScope;        // SPEC-376 · ADR-0080 · scope verifikasi; kosong → Setting.verifyScope
    method?: string;                  // SPEC-734 · ADR-0113 · metode workflow; kosong → payload → Setting.method
    force?: boolean }) =>             // ADR-0093/0161 · lewati dependency + admission (jalur manusia)
    // SPEC-394 · ADR-0084 · `resumed` ada HANYA saat peluncuran melanjutkan artefak sesi sebelumnya
    // (worktree utuh atau tip branch sesi). Absen = sesi baru atau re-attach ke sesi hidup.
    j<{ id: string; resumed?: boolean }>(paths.terminalSessions, { method: "POST", ...body(b) }),
  // SPEC-166 · reverse: sesi project-level menyusun Source of Truth dari kode, di worktree-nya.
  reverseDocs: (project: string, opts?: { force?: boolean }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "reverse", ...(opts ?? {}) }) }),
  // SPEC-222 · scaffold: sesi project-level menyusun Source of Truth dari ide (from-scratch).
  scaffoldDocs: (project: string, opts?: { force?: boolean }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "scaffold", ...(opts ?? {}) }) }),
  // SPEC-362 · "Mulai lagi" sesi project-level dari riwayat (reverse/scaffold): bentuk
  // body-nya identik dengan reverseDocs/scaffoldDocs, hanya flow-nya yang datang dari baris riwayat.
  createTerminalFlow: (project: string, flow: Flow, opts?: { force?: boolean }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow, ...(opts ?? {}) }) }),
  // SPEC-210 · dokumen PRD. listPrds/getPrd baca freshest-wins; startPrd buka sesi prd.
  listPrds: (project: string) => j<{ items: PrdDoc[] }>(paths.prds(project)),
  // perbaikan SPEC-210 · daftar PRD lintas-project (filter "Semua project").
  listAllPrds: () => j<{ items: PrdDoc[] }>(paths.allPrds),
  getPrd: (project: string, path: string) =>
    j<{ path: string; content: string }>(paths.prdFile(project, path)),
  // SPEC-340 · ADR-0076 · opts = eskalasi audit → PRD: branchFrom (worktree dari branch audit) +
  // fromAudit (isi dokumen audit disematkan server ke prompt). Tanpa opts, body persis spt dulu.
  startPrd: (project: string, brief: { title: string; context: string; outcome: string; constraints?: string },
             opts?: { branchFrom?: string; fromAudit?: string; force?: boolean }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({
      project, flow: "prd", brief,
      ...(opts?.branchFrom ? { branchFrom: opts.branchFrom } : {}),
      ...(opts?.fromAudit ? { fromAudit: opts.fromAudit } : {}),
      ...(opts?.force !== undefined ? { force: opts.force } : {}) }) }),
  // SPEC-273 · breakdown PRD → N backlog. startBreakdown buka sesi; getBreakdown baca manifest;
  // createSpecsBatch materialize usulan (review manusia) jadi N spec independen.
  startBreakdown: (project: string, prdPath: string, opts?: { force?: boolean }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, flow: "breakdown", prdPath, ...(opts ?? {}) }) }),
  getBreakdown: (project: string, prdPath: string) =>
    j<BreakdownDoc>(paths.breakdown(project, prdPath)),
  createSpecsBatch: (b: { project: string; items: BreakdownItem[]; branchFrom?: string; prdPath?: string }) =>
    j<{ created: Spec[] }>(paths.specsBatch, { method: "POST", ...body(b) }),
  // SPEC-742 · ADR-0116 · 202, bukan 204: pane sudah lepas & path worktree sudah bebas, tapi
  // byte-nya masih dihapus penyapu latar. `cleanup` = nama entri yang tertunda (null bila sesi itu
  // memang tak punya worktree).
  deleteTerminal: (id: string) =>
    j<{ cleanup: string | null }>(paths.terminalSession(id), { method: "DELETE" }),
  listCleanups: () => j<{ items: WorktreeCleanupView[] }>(paths.terminalCleanups),
  // SPEC-919 · ADR-0147 · muat awal halaman Klien; sesudah itu grup siar `presence` yang mendorong.
  presence: () => j<PresenceView>(paths.presence),
  // SPEC-230 · review + integrate ber-skop sesi (sesi project-level PRD, tanpa Spec).
  sessionReview: (id: string) => j<SpecReview>(paths.sessionReview(id)),
  sessionReviewFile: (id: string, path: string) => j<ReviewFile>(paths.sessionReviewFile(id, path)),
  sessionIntegrate: (id: string, op: "merge" | "rebase", target: string) =>
    j<{ status: "clean"; detail: string } | { status: "conflict"; sessionId: string }>(
      paths.sessionIntegrate(id), { method: "POST", ...body({ op, target }) }),
  // SPEC-164 · modul VPS
  listVps: () => j<VpsView[]>(paths.vps),
  createVps: (b: { name: string; host: string; user: string; port?: number; keyPath?: string; password?: string }) =>
    j<VpsView>(paths.vps, { method: "POST", ...body(b) }),
  // SPEC-165 · `password` = bootstrap ulang key hanoman; tak pernah disimpan.
  updateVps: (id: string, b: {
    name?: string; host?: string; user?: string; port?: number;
    keyPath?: string | null; password?: string
  }) =>
    j<VpsView>(paths.vpsOne(id), { method: "PATCH", ...body(b) }),
  deleteVps: (id: string) => j<void>(paths.vpsOne(id), { method: "DELETE" }),
  auditVps: (id: string) => j<{ audit: VpsCheck[]; hardened: boolean; scoreTotal: number; scoreBySection: Record<string, number> }>(paths.vpsAudit(id), { method: "POST" }),
  // SPEC-220 · kepatuhan checklist
  vpsChecklist: (id: string) => j<ChecklistView>(paths.vpsChecklist(id)),
  markNa: (id: string, itemId: string, na: boolean, reason?: string) =>
    j<{ ok: boolean }>(paths.vpsItemNa(id, itemId), { method: "POST", ...body({ na, reason }) }),
  markNaBulk: (id: string, itemIds: string[], na: boolean, reason?: string) =>
    j<{ ok: boolean; count: number }>(paths.vpsItemNaBulk(id), { method: "POST", ...body({ itemIds, na, reason }) }),
  attestItem: (id: string, itemId: string, note?: string) =>
    j<{ ok: boolean }>(paths.vpsItemAttest(id, itemId), { method: "POST", ...body({ note }) }),
  remediatePreview: (id: string, items: string[]) =>
    j<{ steps: RemediateStep[] }>(paths.vpsRemediatePreview(id), { method: "POST", ...body({ items }) }),
  remediate: (id: string, items: string[]) =>
    j<{ steps: RemediateStep[]; audit: VpsCheck[] | null; scoreTotal: number; scoreBySection: Record<string, number> }>(
      paths.vpsRemediate(id), { method: "POST", ...body({ items }) }),
  // SPEC-883 · provisioning berbasis katalog
  listVpsComponents: () => j<{ components: ProvisionComponent[] }>(paths.vpsComponents()),
  probeVps: (id: string) =>
    j<{ components: ComponentProbe[]; checkedAt: string }>(paths.vpsProbe(id), { method: "POST" }),
  provisionPreview: (id: string, b: { items: ComponentId[]; profile: ProvisionProfile; domain?: string }) =>
    j<{ steps: ProvisionStep[] }>(paths.vpsProvisionPreview(id), { method: "POST", ...body(b) }),
  provisionVps: (id: string, b: {
    items: ComponentId[]; profile: ProvisionProfile; domain?: string; confirm: boolean; force?: boolean }) =>
    j<ProvisionResult>(paths.vpsProvision(id), { method: "POST", ...body(b) }),
  hardenVps: (id: string) => j<{ transcript: string; audit: VpsCheck[] | null; hardened: boolean }>(
    paths.vpsHarden(id), { method: "POST" }),
  vpsSession: (id: string) => j<{ id: string }>(paths.vpsSession(id), { method: "POST" }),
  // SPEC-211 · test connection + open console
  testVps: (id: string) => j<{ ok: boolean; out: string }>(paths.vpsTest(id), { method: "POST" }),
  vpsConsole: (id: string) => j<{ id: string }>(paths.vpsConsole(id), { method: "POST" }),
  // SPEC-169 · auth. Cookie sesi ikut otomatis (same-origin). 401 dari mana pun → App balik ke Login.
  authStatus: () => j<AuthStatus>(paths.authStatus),
  // SPEC-884 · ADR-0139 · wizard setup awal
  setupStatus: () => j<SetupStatus>(paths.setupStatus),
  applySetup: (b: { deployment: "local" | "public"; hardening: boolean; acknowledgedUnhardened?: boolean }) =>
    j<SetupApplyResult>(paths.setupApply, { method: "POST", ...body(b) }),
  setup: (b: { email: string; password: string; setupToken?: string }) => j<{ user: UserView }>(paths.authSetup, { method: "POST", ...body(b) }),
  login: (b: { email: string; password: string }) => j<{ user: UserView }>(paths.authLogin, { method: "POST", ...body(b) }),
  logout: () => j<void>(paths.authLogout, { method: "POST" }),
  listUsers: () => j<UserView[]>(paths.authUsers),
  inviteUser: (b: { email: string; password: string }) => j<UserView>(paths.authUsers, { method: "POST", ...body(b) }),
  deleteUser: (id: string) => j<void>(paths.authUser(id), { method: "DELETE" }),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    j<{ user: UserView }>(paths.authChangePassword, { method: "POST", ...body(b) }),
  // SPEC-213 · device token (identitas mesin) — token plaintext hanya balik di create (sekali).
  listDeviceTokens: () => j<DeviceTokenView[]>(paths.deviceTokens),
  createDeviceToken: (b: { name: string }) =>
    j<{ id: string; name: string; token: string }>(paths.deviceTokens, { method: "POST", ...body(b) }),
  revokeDeviceToken: (id: string) => j<void>(paths.deviceToken(id), { method: "DELETE" }),
  // SPEC-257 · agent token (kelola cookie-only) — token plaintext hanya balik di create (sekali).
  getAgentCapabilities: () => j<{ capabilities: CapabilityInfo[] }>(paths.agentCapabilities),
  listAgentTokens: () => j<{ items: AgentTokenView[] }>(paths.agentTokens),
  createAgentToken: (b: { name: string; capabilities: string[] }) =>
    j<AgentTokenView & { token: string }>(paths.agentTokens, { method: "POST", ...body(b) }),
  patchAgentToken: (id: string, b: { name?: string; capabilities?: string[]; enabled?: boolean }) =>
    j<AgentTokenView>(paths.agentToken(id), { method: "PATCH", ...body(b) }),
  revokeAgentToken: (id: string) => j<void>(paths.agentToken(id), { method: "DELETE" }),
  // SPEC-617 · ADR-0110 · kelola akun klien (cookie-only, admin). Path ditulis di sini, bukan di
  // `shared/src/api.ts`: modul itu diimpor hampir seluruh repo, dan menyentuhnya meledakkan
  // blast radius `vitest --changed` tanpa memberi apa pun (ADR-0080, preseden SPEC-385).
  listClientAccounts: () => j<{ items: ClientAccountView[] }>("/api/client-accounts"),
  createClientAccount: (input: { email: string; password: string; projects: string[] }) =>
    j<ClientAccountView>("/api/client-accounts", { method: "POST", body: JSON.stringify(input) }),
  updateClientAccount: (id: string, input: { projects?: string[]; disabled?: boolean; password?: string }) =>
    j<ClientAccountView>(`/api/client-accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteClientAccount: (id: string) =>
    j<void>(`/api/client-accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // SPEC-213 · activity log (ringkasan hasil sesi)
  listSessionResults: (projectId?: string) => j<SessionResultView[]>(paths.sessionResults(projectId)),
  purgeSessionResults: (projectId: string, before?: string) =>
    j<{ purged: number }>(`${paths.sessionResults(projectId)}${before ? `&before=${encodeURIComponent(before)}` : ""}`, { method: "DELETE" }),
  // SPEC-362 · ADR-0079 · riwayat sesi terminal. Paginasi di server (amplop Paginated); UI memakai
  // muat-lebih, jadi ia menaikkan `page` dan MENAMBAH item, bukan menggantinya.
  listSessionHistory: (p: { projectId?: string; kind?: string; q?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<SessionHistoryView>>(paths.sessionHistory(qs(p))),
  sessionTranscript: (id: string) => j<{ text: string; bytes: number }>(paths.sessionTranscript(id)),
  // SPEC-253 · Help Center — manajemen per project + triase tiket.
  getHelpCenter: (id: string) => j<{ enabled: boolean; publicUrl: string }>(paths.projectHelpCenter(id)),
  enableHelpCenter: (id: string) => j<{ enabled: boolean; publicUrl: string }>(paths.projectHelpCenter(id), { method: "POST" }),
  disableHelpCenter: (id: string) => j<void>(paths.projectHelpCenter(id), { method: "DELETE" }),
  listTickets: (params: Record<string, string | undefined> = {}) =>
    j<Paginated<TicketView> & { unreviewed: number }>(paths.tickets + qs(params)),
  getTicket: (id: string) => j<TicketDetail & { spec: Spec | null }>(paths.ticket(id)),
  acceptTicket: (id: string, priority?: string) =>
    j<{ spec: Spec; alreadyPromoted?: boolean }>(paths.ticketAccept(id), { method: "POST", ...body({ priority }) }),
  rejectTicket: (id: string) =>
    j<{ id: string; status: string }>(paths.ticketReject(id), { method: "POST", ...body({}) }),
  unlinkTicket: (id: string) =>
    j<{ id: string; status: string; specId: string | null }>(paths.ticketUnlink(id), { method: "POST", ...body({}) }),
  editTicket: (id: string, input: TicketEditInput) =>
    j<TicketDetail & { spec: Spec | null }>(paths.ticket(id), { method: "PATCH", ...body(input) }),
  deleteTicket: (id: string) => j<{ ok: boolean }>(paths.ticket(id), { method: "DELETE" }),
  // SPEC-945 · ADR-0150 · papan kerja MANUSIA. Bukan backlog: `status` di sini milik manusia,
  // sementara `Spec.stage` diturunkan dari fase sesi. `members` GLOBAL, bukan per project —
  // task boleh tanpa project (ADR-0150 keputusan 3).
  listTasks: (p: { projectId?: string; status?: string; memberId?: string; q?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<TaskView>>(paths.tasks + qs(p)),
  createTask: (b: CreateTaskInput) => j<TaskView>(paths.tasks, { method: "POST", ...body(b) }),
  patchTask: (id: string, b: PatchTaskInput) => j<TaskView>(paths.task(id), { method: "PATCH", ...body(b) }),
  deleteTask: (id: string) => j<void>(paths.task(id), { method: "DELETE" }),
  // SPEC-947 · eskalasi kartu → backlog. `specId` sengaja tak bisa ditulis lewat patchTask
  // (ADR-0150 keputusan 5), jadi ini satu-satunya jalur yang mengisinya.
  escalateTask: (id: string, b: EscalateTaskInput) =>
    j<{ created: boolean; spec: Spec; task: TaskView }>(paths.taskEscalate(id), { method: "POST", ...body(b) }),
  unlinkTaskSpec: (id: string) => j<TaskView>(paths.taskEscalate(id), { method: "DELETE" }),
  listMembers: (p: { active?: boolean; page?: number; limit?: number } = {}) =>
    j<Paginated<MemberView>>(paths.members + qs(p)),
  createMember: (b: CreateMemberInput) => j<MemberView>(paths.members, { method: "POST", ...body(b) }),
  // `email` sengaja tak ada di `PatchMemberInput`: id diturunkan darinya dan changefeed sync tak
  // punya operasi rename (ADR-0094/ADR-0150). Route menolaknya lagi dengan 400.
  patchMember: (id: string, b: PatchMemberInput) => j<MemberView>(paths.member(id), { method: "PATCH", ...body(b) }),
  deleteMember: (id: string) => j<void>(paths.member(id), { method: "DELETE" }),
  // SPEC-471 · ADR-0095 · tarik & triase issue GitHub. hanoman tak pernah menulis ke GitHub.
  // SPEC-523 · amplop Paginated (cermin listTickets).
  listGithubIssues: (projectId: string, p: { status?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<GithubIssueView>>(paths.githubIssues(projectId) + qs(p)),
  pullGithubIssues: (projectId: string, p: { state?: "open" | "all"; limit?: number } = {}) =>
    j<{ repo: string; pulled: number; created: number; updated: number; via: "gh" | "rest"; skippedPullRequests: number }>(
      paths.githubPull(projectId), { method: "POST", ...body(p) }),
  acceptGithubIssue: (id: string, priority?: string, source?: string) =>
    j<{ spec: Spec; alreadyPromoted?: boolean }>(paths.githubIssueAccept(id),
      { method: "POST", ...body({ priority, source }) }),
  acceptGithubIssues: (ids: string[], priority?: string) =>
    j<{ created: Spec[]; failed: Array<{ id: string; error: string }> }>(paths.githubIssuesAccept,
      { method: "POST", ...body({ ids, priority }) }),
  rejectGithubIssue: (id: string) =>
    j<{ id: string; status: string }>(paths.githubIssueReject(id), { method: "POST", ...body({}) }),
  unlinkGithubIssue: (id: string) =>
    j<{ id: string; status: string; specId: string | null }>(paths.githubIssueUnlink(id), { method: "POST", ...body({}) }),
  // SPEC-516 · ADR-0105 · changelog per project (capability `docs`).
  changelogSources: (projectId: string) =>
    j<ChangelogSources>(paths.changelogSources(projectId)),
  // SPEC-519 · `q` = cari judul/isi/mode; disaring server sebelum paginate.
  listChangelogs: (projectId: string, p: { page?: number; limit?: number; q?: string } = {}) =>
    j<Paginated<ChangelogView>>(paths.changelog(projectId) + qs({ page: p.page, limit: p.limit, q: p.q })),
  // SPEC-519 · satu rilis lewat id — deep-link bisa menunjuk rilis di luar halaman pertama.
  getChangelog: (projectId: string, id: string) =>
    j<ChangelogView>(paths.changelogItem(projectId, id)),
  generateChangelog: (projectId: string, req: ChangelogRequest) =>
    j<ChangelogView>(paths.changelog(projectId), { method: "POST", ...body(req) }),
  deleteChangelog: (projectId: string, id: string) =>
    j<void>(paths.changelogItem(projectId, id), { method: "DELETE" }),
  // SPEC-299 · ADR-0072 · panel scheduler (daun #6) — konsumen read-only fondasi.
  getSchedulerConfig: () => j<Scheduler>(paths.schedulerConfig),
  putSchedulerConfig: (cfg: Scheduler) => j<Scheduler>(paths.schedulerConfig, { method: "PUT", ...body(cfg) }),
  getSchedulerState: () => j<SchedulerStateView>(paths.schedulerState),
  // SPEC-522 · ADR-0106 · batalkan / antre lagi satu baris antrean. 409 membawa `{ error, status }`
  // di `ApiError.detail` — pemanggil menampilkannya apa adanya (kalimatnya yang memberi tahu
  // operator bahwa sesinya sudah berjalan dan harus ditutup dari Terminal).
  cancelSchedulerQueueItem: (id: string, reason?: string) =>
    j<SchedulerQueueItemView>(paths.schedulerQueueCancel(id), { method: "POST", ...body(reason ? { reason } : {}) }),
  requeueSchedulerQueueItem: (id: string) =>
    j<SchedulerQueueItemView>(paths.schedulerQueueRequeue(id), { method: "POST", ...body({}) }),
  // SPEC-523 · antrean scheduler sebagai daftar berhalaman (lepas dari `state`).
  getSchedulerQueue: (p: { status?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<SchedulerQueueItemView>>(paths.schedulerQueue + qs(p)),
  // SPEC-646 · ADR-0112 · cronjob per project. COOKIE_ONLY di server — tak pernah lewat agent token.
  listCrons: (p: { projectId?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<SchedulerCronView>>(paths.schedulerCrons + qs(p)),
  createCron: (b: {
    project: string; name: string; expr: string; prompt: string;
    agent?: Agent; model?: string; effort?: string; enabled?: boolean;
  }) => j<SchedulerCronView>(paths.schedulerCrons, { method: "POST", ...body(b) }),
  patchCron: (id: string, b: Record<string, unknown>) =>
    j<SchedulerCronView>(paths.schedulerCron(id), { method: "PATCH", ...body(b) }),
  deleteCron: (id: string) => j<void>(paths.schedulerCron(id), { method: "DELETE" }),
  // 409 membawa kalimatnya sendiri ("scheduler sedang dijeda…") di `ApiError.detail`.
  runCronNow: (id: string) =>
    j<SchedulerCronRunView>(paths.schedulerCronRunNow(id), { method: "POST", ...body({}) }),
  listCronRuns: (id: string, p: { page?: number; limit?: number } = {}) =>
    j<Paginated<SchedulerCronRunView>>(paths.schedulerCronRuns(id) + qs(p)),
  // SPEC-409 · ADR-0091 · hanoman-lead. Semua HTTP polling — tak ada kanal WS baru (AC-26).
  getLeadConfig: () => j<Lead>(paths.leadConfig),
  putLeadConfig: (cfg: Lead) => j<Lead>(paths.leadConfig, { method: "PUT", ...body(cfg) }),
  getLeadStatus: () => j<LeadStatusView>(paths.leadStatus),
  // SPEC-523 · amplop Paginated. `take` lama masih diterima server, tapi klien memakai page/limit.
  getLeadDecisions: (params: { projectId?: string; specId?: string; sessionId?: string; status?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<LeadDecisionView>>(paths.leadDecisions + qs(params)),
  // SPEC-485 · ADR-0102 · centang operator ikut sebagai DATA: ia disimpan dalam bentuk yang sama
  // dengan pilihan lead DAN diketikkan ke pane sebagai centang, bukan sebagai prosa.
  overrideLeadDecision: (id: string, answer: string, reason = "", choices: string[] = []) =>
    j<{ old: LeadDecisionView; next: LeadDecisionView; delivered: boolean }>(
      paths.leadDecisionOverride(id), { method: "POST", ...body({ answer, reason, choices }) }),
  cancelLeadDecision: (id: string) =>
    j<LeadDecisionView>(paths.leadDecisionCancel(id), { method: "POST", ...body({}) }),
  // SPEC-485 · rantai keputusan. Tetap polling HTTP — tak ada kanal WS baru (ADR-0039).
  getLeadFlows: (params: { projectId?: string; status?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<LeadFlowView>>(paths.leadFlows + qs(params)),
  submitLeadFlow: (id: string) => j<LeadFlowView>(paths.leadFlowSubmit(id), { method: "POST", ...body({}) }),
  cancelLeadFlow: (id: string) => j<LeadFlowView>(paths.leadFlowCancel(id), { method: "POST", ...body({}) }),
  // SPEC-450 · ADR-0094 · katalog custom agent. Tanpa projectId → global saja; dengan projectId →
  // himpunan EFEKTIF (global+project, baris global bertanda `inherited`).
  listCustomAgents: (projectId?: string, runtime?: AgentRuntime) =>
    j<CustomAgentView[]>(paths.customAgents + qs({
      ...(projectId ? { projectId } : {}), ...(runtime ? { runtime } : {}),
    })),
  // SPEC-484 · ADR-0101 · katalog pilihan form. `projectId` menambah server MCP ber-scope project.
  getCustomAgentCatalog: (projectId?: string) =>
    j<AgentCatalogView>(paths.customAgentCatalog + qs(projectId ? { projectId } : {})),
  createCustomAgent: (b: CreateCustomAgent) =>
    j<CustomAgentView>(paths.customAgents, { method: "POST", ...body(b) }),
  updateCustomAgent: (id: string, b: UpdateCustomAgent) =>
    j<CustomAgentView>(paths.customAgent(id), { method: "PATCH", ...body(b) }),
  deleteCustomAgent: (id: string) => j<void>(paths.customAgent(id), { method: "DELETE" }),
  getCustomAgentMetrics: (p: { projectId?: string; from?: string; to?: string } = {}) =>
    j<AgentMetricsView>(paths.customAgentMetrics + qs(p)),
  updateAgentInvocationDisposition: (id: string, b: {
    disposition: Exclude<AgentDisposition, "pending">; note?: string | null;
  }) => j<AgentInvocationView>(paths.customAgentInvocation(id), { method: "PATCH", ...body(b) }),
  // SPEC-481 · ADR-0100 · webhook keluar. Semua cookie-only; tak ada jalur agent token.
  listWebhooks: () => j<{ endpoints: WebhookEndpointView[]; eventTypes: string[] }>(paths.webhooks),
  createWebhook: (b: CreateWebhookEndpoint) =>
    j<WebhookEndpointView>(paths.webhooks, { method: "POST", ...body(b) }),
  updateWebhook: (id: string, b: UpdateWebhookEndpoint) =>
    j<WebhookEndpointView>(paths.webhook(id), { method: "PATCH", ...body(b) }),
  deleteWebhook: (id: string) => j<void>(paths.webhook(id), { method: "DELETE" }),
  testWebhook: (id: string) => j<WebhookTestResult>(paths.webhookTest(id), { method: "POST", ...body({}) }),
  listWebhookDeliveries: (id: string, limit = 50) =>
    j<{ items: WebhookDeliveryView[] }>(paths.webhookDeliveries(id) + qs({ limit })),
  retryWebhookDelivery: (id: string) =>
    j<WebhookDeliveryView>(paths.webhookDeliveryRetry(id), { method: "POST", ...body({}) }),
};

// SPEC-854 · ADR-0129 · permukaan OPERATOR untuk obrolan portal klien. Namespace sendiri, cermin
// `portalApi` di sisi klien: dua audiens yang sangat berbeda tak boleh berbagi satu objek yang
// autocomplete-nya menawarkan route audiens lain.
export type PortalChatSessionRow = {
  id: string; projectId: string; type: string; summary: string; periodKey: string;
  prdSiap: boolean; prdDocPath: string | null; prdReadyAt: string | null;
  clientEmail: string; createdAt: string; updatedAt: string;
};
export type PortalChatMessageRow = {
  id: string; seq: number; role: string; text: string; rawText: string | null;
  blocked: boolean; blockReasons: string[] | null; createdAt: string;
};
export type PortalChatQuotaRow = {
  enabled: boolean;
  brainstorm: { terpakai: number; jatah: number; sisa: number };
  tanya: { terpakai: number; jatah: number; sisa: number };
  resetPada: string;
};

export const portalChatApi = {
  listSessions: (project: string, params: { page?: number; limit?: number } = {}) =>
    j<{ items: PortalChatSessionRow[]; total: number; page: number; pageSize: number;
        kuota: PortalChatQuotaRow }>("/api/portal-chat/sessions" + qs({ project, ...params })),
  getSession: (id: string) =>
    j<PortalChatSessionRow & { prdMarkdown: string | null; messages: PortalChatMessageRow[] }>(
      `/api/portal-chat/sessions/${encodeURIComponent(id)}`),
  materializePrd: (id: string, slug: string) =>
    j<{ path: string }>(`/api/portal-chat/sessions/${encodeURIComponent(id)}/prd`,
      { method: "POST", ...body({ slug }) }),
};
