// SPEC-482 · ADR-0099 · pemadat balasan tool MCP.
//
// Kenapa ada: `GET /projects` mengembalikan puluhan kilobita, dan konteks agen bukan tempat
// membuang isi tabel. Dua lapis — (1) proyeksi field per bentuk, (2) plafon byte yang memotong
// SAMBIL tetap menghasilkan JSON yang sah plus penanda terbaca mesin. JSON terpotong di tengah
// lebih buruk daripada tak dikirim: agen akan menganggapnya galat parsing, bukan batas.

export const DEFAULT_MAX_BYTES = 24 * 1024;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const OBJECTIVE_CLIP = 200;
const MARK = "… (dipotong)";

export function clip<T>(value: T, max: number): T | string {
  if (typeof value !== "string") return value;
  return value.length <= max ? value : value.slice(0, max) + MARK;
}

const pick = <K extends string>(row: Record<string, unknown>, keys: readonly K[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  return out;
};

export const shapeProject = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, ["id", "name", "kind", "desc", "backlog", "topStage", "coverage", "schedulerOptIn", "leadOptIn"]);

export const shapeProjectDetail = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, [
    "id", "name", "kind", "desc", "stack", "gitRemote", "docStatus", "coverage",
    "backlog", "topStage", "session", "activity", "commit",
    "helpEnabled", "schedulerOptIn", "leadOptIn", "createdAt",
  ]);

const SPEC_BASE = [
  "id", "projectId", "title", "source", "stage", "priority",
  "createdAt", "startedAt", "branchFrom", "dependsOn", "blockedBy",
] as const;

export function shapeSpec(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pick(row, SPEC_BASE),
    objective: clip(row.objective, OBJECTIVE_CLIP),
    // Turunan yang menghemat satu panggilan balik: "boleh diedit / belum dimulai" adalah pertanyaan
    // yang selalu diajukan agen sesudah membaca daftar, dan jawabannya sudah ada di kedua kolom ini.
    startable: row.stage !== "done",
    editable: row.stage === "brainstorming" && row.baseSha === null,
  };
}

export const shapeSpecDetail = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, [...SPEC_BASE, "objective", "payload", "author", "baseSha", "headSha", "updatedAt"]),
  startable: row.stage !== "done",
  editable: row.stage === "brainstorming" && row.baseSha === null,
});

export const shapeSession = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, ["id", "projectId", "specId", "flow", "agent", "branch", "exited", "exitCode", "decision"]);

export const shapeNotification = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, ["id", "type", "projectId", "specId", "sessionId", "createdAt", "readAt"]),
  title: clip(row.title, 300),
});

export const shapeTicket = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, ["id", "projectId", "number", "category", "title", "status", "specId", "attachmentCount", "createdAt"]);

export const shapeGithubIssue = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, ["id", "projectId", "repoSlug", "number", "title", "authorLogin", "labels", "url", "issueState", "status", "specId", "issueUpdatedAt"]),
  body: clip(row.body, 500),
});

// ADR-0157 · kartu papan Tim. `detail` dipotong seperti `objective` backlog: ia menampung sampai
// 20 000 karakter (zCreateTask) dan satu kartu bisa menghabiskan seluruh plafon balasan sendirian.
// `spec` (cermin backlog) dilewatkan APA ADANYA — tiga field, dan justru itu yang menjawab
// "kartu ini sudah jadi backlog atau belum" tanpa panggilan kedua.
export const shapeTask = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, ["id", "projectId", "title", "status", "priority", "memberId",
    "startDate", "dueDate", "order", "specId", "spec", "createdAt", "updatedAt"]),
  detail: clip(row.detail, 500),
});

export const shapeMember = (row: Record<string, unknown>): Record<string, unknown> =>
  pick(row, ["id", "name", "email", "role", "active"]);

export const shapeLeadDecision =(row: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(row, ["id", "projectId", "specId", "sessionId", "gate", "kind", "status", "confidence", "action", "choice", "createdAt"]),
  question: clip(row.question, 300),
  answer: clip(row.answer, 500),
  reason: clip(row.reason, 500),
});

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export function paginateLocal<T>(items: T[], page?: number, limit?: number): Page<T> {
  const size = Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const p = Math.max(1, Math.floor(page ?? 1));
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size };
}

/**
 * JSON dengan plafon byte. Bila muat → apa adanya. Bila tidak → hasilnya TETAP JSON sah:
 * daftar dipangkas item demi item sampai muat, non-daftar diganti amplop bertanda. Penanda
 * `truncated`/`shown`/`total`/`hint` dibuat terbaca mesin supaya agen tahu ini batas, bukan galat.
 */
export function renderResult(value: unknown, maxBytes: number): string {
  const full = JSON.stringify(value);
  if (full === undefined) return "null";
  if (full.length <= maxBytes) return full;

  const asPage = value as { items?: unknown[]; total?: number };
  if (Array.isArray(asPage.items)) {
    const total = typeof asPage.total === "number" ? asPage.total : asPage.items.length;
    const rest = { ...(value as Record<string, unknown>) };
    delete rest.items;
    for (let n = asPage.items.length - 1; n >= 0; n--) {
      const candidate = JSON.stringify({
        ...rest,
        truncated: true, shown: n, total,
        hint: `balasan dipotong pada plafon ${maxBytes} byte — persempit filter atau minta halaman berikutnya lewat parameter page/limit`,
        items: asPage.items.slice(0, n),
      });
      if (candidate.length <= maxBytes) return candidate;
    }
  }
  const head = full.slice(0, Math.max(0, maxBytes - 400));
  return JSON.stringify({
    truncated: true, shown: 0, total: 1,
    hint: `balasan dipotong pada plafon ${maxBytes} byte — persempit permintaan atau ambil bagiannya lewat tool yang lebih spesifik (parameter page/limit tersedia di tool daftar)`,
    preview: head,
  }).slice(0, maxBytes);
}
