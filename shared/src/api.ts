export const API = "/api";
export const paths = {
  projects: `${API}/projects`,
  project: (id: string) => `${API}/projects/${id}`,
  // SPEC-255 · ADR-0064 · rename slug project (efek: DSN, Help Center, sync).
  projectRename: (id: string) => `${API}/projects/${encodeURIComponent(id)}/rename`,
  branches: (id: string) => `${API}/projects/${id}/branches`,
  // SPEC-360 · ADR-0077 · branch ter-merge (nilai turunan git) + hapus batch local/origin.
  branchesUnused: (id: string, base?: string) =>
    `${API}/projects/${id}/branches/unused${base ? `?base=${encodeURIComponent(base)}` : ""}`,
  branchesDelete: (id: string) => `${API}/projects/${id}/branches/delete`,
  // SPEC-217 · path per-mesin (LocalBinding, tak disync) + clone dari gitRemote
  binding: (id: string) => `${API}/projects/${id}/binding`,
  clone: (id: string) => `${API}/projects/${id}/clone`,
  specs: `${API}/specs`,
  spec: (id: string) => `${API}/specs/${id}`,
  specDocs: (id: string) => `${API}/specs/${id}/docs`,
  specDocFile: (id: string, path: string) => `${API}/specs/${id}/docs/${path}`,
  // SPEC-340 · ADR-0076 · rekomendasi tindak lanjut audit (turunan blok json dokumen audit).
  specEscalation: (id: string) => `${API}/specs/${id}/escalation`,
  specIntegrate: (id: string) => `${API}/specs/${id}/integrate`,
  // SPEC-546 · ADR-0109 · ubah type/source item in-place (operasi khusus, bukan field PATCH).
  specSource: (id: string) => `${API}/specs/${id}/source`,
  specReview: (id: string) => `${API}/specs/${id}/review`,
  specReviewFile: (id: string, path: string) => `${API}/specs/${id}/review/${path}`,
  settings: `${API}/settings`,
  notifications: `${API}/notifications`,
  limits: `${API}/limits`,
  // SPEC-339 · versi codex CLI (peringatan lunak model GPT-5.6).
  codexVersion: `${API}/codex/version`,
  // SPEC-489 · panduan AI agent — markdown MENTAH & PUBLIC (tanpa auth). Satu definisi URL untuk
  // klien web dan untuk tautan yang disalin operator ke agennya.
  agentDoc: `${API}/agent-integration.md`,
  docs: (id: string) => `${API}/projects/${id}/docs`,
  docFile: (id: string, path: string) => `${API}/projects/${id}/docs/${path}`,
  // SPEC-210 · dokumen PRD project (freshest-wins: worktree sesi prd hidup > repoDir)
  prds: (id: string) => `${API}/projects/${id}/prds`,
  allPrds: `${API}/prds`, // perbaikan SPEC-210 · daftar PRD lintas-project (filter "Semua project")
  prdFile: (id: string, path: string) => `${API}/projects/${id}/prds/${path}`,
  // SPEC-273 · manifest breakdown sebuah PRD (freshest-wins) + materialize batch.
  breakdown: (id: string, prd: string) => `${API}/projects/${id}/breakdown?prd=${encodeURIComponent(prd)}`,
  specsBatch: `${API}/specs/batch`,
  // SPEC-182 · IDE Visual
  ideTree: (id: string, ref = "") => `${API}/projects/${id}/tree${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
  ideFile: (id: string, path?: string, ref = "") =>
    `${API}/projects/${id}/file${path ? `?path=${encodeURIComponent(path)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}` : ""}`,
  ideGraph: (id: string, limit = 200, opts?: { branches?: string[]; showRemote?: boolean; showTags?: boolean }) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (opts?.branches?.length) p.set("branches", opts.branches.join(","));
    if (opts?.showRemote === false) p.set("showRemote", "false");
    if (opts?.showTags === false) p.set("showTags", "false");
    return `${API}/projects/${id}/graph?${p.toString()}`;
  },
  ideStatus: (id: string) => `${API}/projects/${id}/status`, // SPEC-233 · status working tree
  ideSearch: (id: string, q: string, by = "all") => `${API}/projects/${id}/graph/search?q=${encodeURIComponent(q)}&by=${by}`, // SPEC-233
  ideStashes: (id: string) => `${API}/projects/${id}/stashes`, // SPEC-233 · daftar stash
  // SPEC-233 · remote mgmt + pr-url + archive
  ideRemotes: (id: string) => `${API}/projects/${id}/remotes`,
  ideRemote: (id: string, name: string) => `${API}/projects/${id}/remotes/${encodeURIComponent(name)}`,
  idePrUrl: (id: string, branch: string, base?: string) =>
    `${API}/projects/${id}/pr-url?branch=${encodeURIComponent(branch)}${base ? `&base=${encodeURIComponent(base)}` : ""}`,
  ideArchive: (id: string, ref: string, format = "zip") => `${API}/projects/${id}/archive?ref=${encodeURIComponent(ref)}&format=${format}`,

  ideCommit: (id: string, sha: string) => `${API}/projects/${id}/commit/${sha}`,
  // SPEC-233 · diff satu file di commit (vs parent)
  ideCommitFile: (id: string, sha: string, path: string) => `${API}/projects/${id}/commit/${sha}/file?path=${encodeURIComponent(path)}`,
  // SPEC-233 · compare dua commit
  ideCompare: (id: string, from: string, to: string) => `${API}/projects/${id}/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  ideCompareFile: (id: string, from: string, to: string, path: string) =>
    `${API}/projects/${id}/compare/file?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&path=${encodeURIComponent(path)}`,
  ideGit: (id: string) => `${API}/projects/${id}/git`,
  ideGitMerge: (id: string) => `${API}/projects/${id}/git/merge`, // SPEC-229 · merge git graph isolasi
  // SPEC-234 · status working tree (staged/unstaged) + diff satu file working tree
  // catat: /working-status dibedakan dari /status milik SPEC-233 (repoStatus graph) — beda bentuk respons.
  ideWorkingStatus: (id: string) => `${API}/projects/${id}/working-status`,
  ideFileDiff: (id: string, path: string, staged: boolean) =>
    `${API}/projects/${id}/file-diff?path=${encodeURIComponent(path)}${staged ? "&staged=1" : ""}`,
  ideGitRebase: (id: string) => `${API}/projects/${id}/git/rebase`, // SPEC-233 · rebase isolasi
  ideGitPull: (id: string) => `${API}/projects/${id}/git/pull`,     // SPEC-233 · pull isolasi
  ideGitDrop: (id: string) => `${API}/projects/${id}/git/drop`,     // SPEC-233 · drop commit isolasi
  fsBrowse: (path?: string) => `${API}/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
  terminalSessions: `${API}/terminal/sessions`,
  terminalSession: (id: string) => `${API}/terminal/sessions/${id}`,
  terminalSteer: (id: string) => `${API}/terminal/sessions/${id}/steer`,
  terminalInterrupt: (id: string) => `${API}/terminal/sessions/${id}/interrupt`,
  terminalPhases: (id: string) => `${API}/terminal/sessions/${id}/phases`,
  // SPEC-230 · review + integrate ber-skop sesi (sesi project-level PRD, tanpa Spec).
  sessionReview: (id: string) => `${API}/terminal/sessions/${id}/review`,
  sessionReviewFile: (id: string, path: string) => `${API}/terminal/sessions/${id}/review/${path}`,
  sessionIntegrate: (id: string) => `${API}/terminal/sessions/${id}/integrate`,
  terminalWs: (id: string) => `${API}/terminal/sessions/${id}/ws`,
  // SPEC-362 · ADR-0079 · riwayat sesi. Di bawah prefix /terminal supaya ikut capability
  // `sessions` yang sudah ada (services/agent-capabilities.ts) tanpa menambah domain baru.
  sessionHistory: (qs = "") => `${API}/terminal/history${qs}`,
  sessionHistoryItem: (id: string) => `${API}/terminal/history/${encodeURIComponent(id)}`,
  sessionTranscript: (id: string) => `${API}/terminal/history/${encodeURIComponent(id)}/transcript`,
  eventsWs: `${API}/events/ws`,   // SPEC-199 · WebSocket siar dashboard (global, bukan per-sesi)
  vps: `${API}/vps`,
  vpsOne: (id: string) => `${API}/vps/${id}`,
  vpsAudit: (id: string) => `${API}/vps/${id}/audit`,
  vpsHarden: (id: string) => `${API}/vps/${id}/harden`,
  vpsSession: (id: string) => `${API}/vps/${id}/session`,
  vpsTest: (id: string) => `${API}/vps/${id}/test`,
  vpsConsole: (id: string) => `${API}/vps/${id}/console`,
  // SPEC-220 · kepatuhan checklist
  vpsChecklist: (id: string) => `${API}/vps/${id}/checklist`,
  vpsItemNa: (id: string, itemId: string) => `${API}/vps/${id}/items/${itemId}/na`,
  vpsItemNaBulk: (id: string) => `${API}/vps/${id}/items/na-bulk`,
  vpsItemAttest: (id: string, itemId: string) => `${API}/vps/${id}/items/${itemId}/attest`,
  vpsRemediatePreview: (id: string) => `${API}/vps/${id}/remediate/preview`,
  vpsRemediate: (id: string) => `${API}/vps/${id}/remediate`,
  // SPEC-169 · auth
  authStatus: `${API}/auth/status`,
  authSetup: `${API}/auth/setup`,
  authLogin: `${API}/auth/login`,
  authLogout: `${API}/auth/logout`,
  authUsers: `${API}/auth/users`,
  authUser: (id: string) => `${API}/auth/users/${id}`,
  authChangePassword: `${API}/auth/change-password`,
  // SPEC-213 · device token + activity log
  deviceTokens: `${API}/device-tokens`,
  deviceToken: (id: string) => `${API}/device-tokens/${id}`,
  sessionResults: (projectId?: string) =>
    `${API}/session-results${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
  // SPEC-215 · config runtime
  config: `${API}/config`,
  configKey: (key: string) => `${API}/config/${encodeURIComponent(key)}`,
  // SPEC-299 · panel scheduler (daun #6) — konsumen read-only fondasi SPEC-294/ADR-0072.
  schedulerConfig: `${API}/scheduler/config`,
  schedulerState: `${API}/scheduler/state`,
  // SPEC-522 · ADR-0106 · batalkan / antre lagi SATU baris antrean. Di bawah prefix `scheduler`
  // supaya capability-nya turunan peta yang sudah ada (settings, MENURUT METHOD) — tanpa baris peta baru.
  schedulerQueueCancel: (id: string) => `${API}/scheduler/queue/${encodeURIComponent(id)}/cancel`,
  schedulerQueueRequeue: (id: string) => `${API}/scheduler/queue/${encodeURIComponent(id)}/requeue`,
  // SPEC-523 · antrean sebagai daftar berhalaman (page/limit + status), lepas dari `state`.
  schedulerQueue: `${API}/scheduler/queue`,
  // SPEC-409 · ADR-0091 · hanoman-lead. Semua HTTP (polling) — tak ada kanal WS baru (AC-26).
  leadConfig: `${API}/lead/config`,
  leadStatus: `${API}/lead/status`,
  leadDecisions: `${API}/lead/decisions`,
  leadDecisionOverride: (id: string) => `${API}/lead/decisions/${encodeURIComponent(id)}/override`,
  leadDecisionCancel: (id: string) => `${API}/lead/decisions/${encodeURIComponent(id)}/cancel`,
  // SPEC-485 · ADR-0102 · rantai keputusan. Di bawah prefix `lead` supaya capability-nya turunan
  // method (lead:read/lead:write) tanpa peta baru — kelas bug SPEC-405 sudah ditutup di sana.
  leadFlows: `${API}/lead/flows`,
  leadFlowSubmit: (id: string) => `${API}/lead/flows/${encodeURIComponent(id)}/submit`,
  leadFlowCancel: (id: string) => `${API}/lead/flows/${encodeURIComponent(id)}/cancel`,
  // SPEC-450 · ADR-0094 · katalog custom agent. `?projectId=` → himpunan EFEKTIF (global+project).
  customAgents: `${API}/custom-agents`,
  // SPEC-484 · ADR-0101 · sumber daftar tools/model/runtime untuk form (mention dari `customAgents`).
  customAgentCatalog: `${API}/custom-agents/catalog`,
  // SPEC-481 · ADR-0100 · webhook keluar (cookie-only)
  webhooks: `${API}/webhooks`,
  webhook: (id: string) => `${API}/webhooks/${encodeURIComponent(id)}`,
  webhookTest: (id: string) => `${API}/webhooks/${encodeURIComponent(id)}/test`,
  webhookDeliveries: (id: string) => `${API}/webhooks/${encodeURIComponent(id)}/deliveries`,
  webhookDeliveryRetry: (id: string) => `${API}/webhooks/deliveries/${encodeURIComponent(id)}/retry`,
  customAgent: (id: string) => `${API}/custom-agents/${encodeURIComponent(id)}`,
  // SPEC-476 · ADR-0096 · observability/context/reply kanal Telegram.
  telegramStatus: `${API}/telegram/status`,
  telegramContext: (chatId: string) => `${API}/telegram/chats/${encodeURIComponent(chatId)}/context`,
  telegramMemories: (chatId: string) => `${API}/telegram/chats/${encodeURIComponent(chatId)}/memories`,
  telegramMemory: (chatId: string, id: string) =>
    `${API}/telegram/chats/${encodeURIComponent(chatId)}/memories/${encodeURIComponent(id)}`,
  telegramReplies: `${API}/telegram/replies`,
  telegramAudit: `${API}/telegram/audit`,
  // SPEC-477 · ADR-0097 · permukaan kredensial (cookie-only, bukan agent token).
  telegramSettings: `${API}/telegram/settings`,
  telegramTest: `${API}/telegram/test`,
  telegramCredentials: `${API}/telegram/credentials`,
  // SPEC-268 · ADR-0066 · pemicu sync manual (cookie-authed)
  syncNow: `${API}/sync/now`,
  // SPEC-270 · ADR-0067 · antrean konflik rekonsil (cookie-authed)
  syncConflicts: `${API}/sync/conflicts`,
  syncConflictResolve: (entity: string, recordId: string) =>
    `${API}/sync/conflicts/${encodeURIComponent(entity)}/${encodeURIComponent(recordId)}/resolve`,
  // SPEC-257 · ADR-0065 · agent token (kelola cookie-only) + katalog capability
  agentTokens: `${API}/agent-tokens`,
  agentToken: (id: string) => `${API}/agent-tokens/${id}`,
  agentCapabilities: `${API}/agent-tokens/capabilities`,
  // SPEC-253 · Help Center publik (bypass gate cookie; otorisasi helpEnabled + kunci opaque tiket).
  help: (slug: string) => `${API}/help/${encodeURIComponent(slug)}`,
  helpTickets: (slug: string) => `${API}/help/${encodeURIComponent(slug)}/tickets`,
  helpStatus: (slug: string, key: string) =>
    `${API}/help/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(key)}`,
  // SPEC-253 · triase (di belakang gate cookie)
  projectHelpCenter: (id: string) => `${API}/projects/${encodeURIComponent(id)}/help-center`,
  tickets: `${API}/tickets`,
  ticket: (id: string) => `${API}/tickets/${id}`,
  ticketAttachment: (id: string, attId: string) => `${API}/tickets/${id}/attachments/${attId}`,
  ticketAccept: (id: string) => `${API}/tickets/${id}/accept`,
  ticketUnlink: (id: string) => `${API}/tickets/${id}/unlink`,  // SPEC-271 · lepas tautan backlog
  ticketReject: (id: string) => `${API}/tickets/${id}/reject`,
  // SPEC-471 · ADR-0095 · tarik & triase issue GitHub (di belakang gate cookie, capability `support`).
  // hanoman TIDAK PERNAH menulis ke GitHub — tak ada path komentar/close di sini, dan itu disengaja.
  githubPull: (id: string) => `${API}/projects/${encodeURIComponent(id)}/github/pull`,
  // SPEC-516 · ADR-0105 · changelog per project
  changelog: (id: string) => `${API}/projects/${encodeURIComponent(id)}/changelog`,
  changelogSources: (id: string) => `${API}/projects/${encodeURIComponent(id)}/changelog/sources`,
  changelogItem: (id: string, cid: string) =>
    `${API}/projects/${encodeURIComponent(id)}/changelog/${encodeURIComponent(cid)}`,
  githubIssues: (id: string) => `${API}/projects/${encodeURIComponent(id)}/github/issues`,
  githubIssuesAccept: `${API}/github-issues/accept`,
  githubIssueAccept: (id: string) => `${API}/github-issues/${encodeURIComponent(id)}/accept`,
  githubIssueReject: (id: string) => `${API}/github-issues/${encodeURIComponent(id)}/reject`,
  githubIssueUnlink: (id: string) => `${API}/github-issues/${encodeURIComponent(id)}/unlink`,
  // SPEC-361 · ADR-0078 · unduh dokumen: query ditempelkan ke URL endpoint dokumen yang sudah ada
  // (tak ada endpoint ekspor terpisah). `base` bisa sudah membawa query, mis. ideFile(?path=…).
  download: (base: string, fmt: "md" | "pdf") => `${base}${base.includes("?") ? "&" : "?"}download=${fmt}`,
} as const;

// SPEC-215 · view config untuk UI. Secret: tanpa `value`, pakai `masked` + `hasValue`.
export type ConfigEntryView = {
  key: string; group: string; label: string; help?: string;
  kind: import("./config-registry").ConfigKind;
  apply: import("./config-registry").ApplyMode;
  category: import("./config-registry").ConfigCategory;
  min?: number; max?: number;
  editable: boolean; source: "db" | "env" | "default";
  value?: string | null;        // non-secret
  masked?: string | null;       // secret & bootstrap secret
  hasValue?: boolean;           // secret: apakah ada nilai efektif
};
export type ConfigResponse = { entries: ConfigEntryView[]; sync: { running: boolean; connected: boolean } };

// SPEC-477 · ADR-0097 · view kredensial Telegram. Secret: tanpa `value`, pakai `masked`+`hasValue`.
// `source === "env"` = nilai masih datang dari `.env` (deprecated), bukan dari Settings.
export type TelegramCredentialFieldView = {
  key: string; label: string; help?: string;
  kind: "secret" | "string";
  source: "db" | "env" | "default";
  hasValue: boolean;
  masked?: string | null;
  value?: string | null;
};
export type TelegramCredentialsView = { fields: TelegramCredentialFieldView[] };
// SPEC-491 · Test Connection lama hanya `getMe` + `sendMessage` dengan BOT token, jadi hijau-nya
// bisa berdampingan dengan jalur MASUK yang mati total. `inbound` membawa gerbang yang sama dengan
// `installTelegramGateway` supaya "uji koneksi" tak lagi berarti "uji separuh".
export type TelegramInboundReadinessView = {
  ok: boolean;
  reason: string | null;
  missingCapabilities: string[];
  polling: boolean;
};
export type TelegramTestResult =
  | { ok: true; botUsername: string | null; chatId: string; inbound: TelegramInboundReadinessView }
  | { ok: false; error: string; inbound: TelegramInboundReadinessView };
export type TelegramClearResult = { cleared: string[]; envFallback: string[] };

// SPEC-270 · ADR-0067 · konflik sync dua-sisi menunggu keputusan manusia (modal rekonsil).
export type SyncConflictView = {
  entity: string; recordId: string;
  localData: unknown; localVersion: number; localUpdatedAt: string;
  serverData: unknown; serverVersion: number; serverUpdatedAt: string; detectedAt: string;
};
