// SPEC-481 · ADR-0100 · sumber TUNGGAL peristiwa webhook: katalog ini menyetir tap Prisma
// (server/src/services/webhooks/tap.ts) DAN halaman dokumentasi in-app. Menambah peristiwa =
// menambah entri di sini; tak ada jalan lain, jadi dokumentasi tak bisa basi.
import { z } from "zod";

export const WEBHOOK_SPEC_VERSION = "hanoman.webhook/1";
export const WEBHOOK_API_VERSION = 1;

/** Jeda SEBELUM percobaan ke-n (detik). Tabel, bukan rumus — supaya bisa didokumentasikan apa adanya. */
export const WEBHOOK_BACKOFF_SEC = [0, 30, 120, 600, 1800, 7200] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_BACKOFF_SEC.length;
/** Pengiriman `failed` beruntun yang menonaktifkan endpoint. */
export const WEBHOOK_FAIL_LIMIT = 5;
/** Batas baris `pending` per endpoint; kelebihannya lahir sebagai `dropped` yang TERLIHAT. */
export const WEBHOOK_QUEUE_CAP = 1000;
/** Riwayat yang disimpan per endpoint. */
export const WEBHOOK_HISTORY_KEEP = 200;
export const WEBHOOK_MAX_BYTES = 64 * 1024;
export const WEBHOOK_FIELD_MAX_CHARS = 2000;
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Toleransi timestamp yang disarankan ke penerima (anti-replay). */
export const WEBHOOK_TOLERANCE_SEC = 300;
export const WEBHOOK_DEFAULT_PER_MINUTE = 60;
export const WEBHOOK_PING_TYPE = "webhook.ping";
export const WEBHOOK_USER_AGENT = "hanoman-webhooks/1";

export const WEBHOOK_HEADERS = {
  event: "X-Hanoman-Event",
  eventId: "X-Hanoman-Event-Id",
  delivery: "X-Hanoman-Delivery",
  attempt: "X-Hanoman-Attempt",
  timestamp: "X-Hanoman-Timestamp",
  signature: "X-Hanoman-Signature",
} as const;

export type WebhookActorKind = "user" | "agent" | "lead" | "scheduler" | "system";
export interface WebhookActor { kind: WebhookActorKind; id: string | null; label: string }
export const SYSTEM_ACTOR: WebhookActor = { kind: "system", id: null, label: "hanoman" };

export type WebhookAction = "created" | "updated" | "deleted";

export interface WebhookEnvelope {
  specVersion: string;
  id: string;
  type: string;
  createdAt: string;
  project: { id: string; name: string } | null;
  actor: WebhookActor;
  data: {
    entity: string;
    id: string;
    action: WebhookAction;
    changed: string[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    cascade?: Record<string, number>;
  };
  truncated: boolean;
  truncatedFields: string[];
}

/** Peristiwa turunan MENGGANTIKAN `updated` saat salah satu `changed` cocok. */
export interface WebhookDerived { type: string; label: string; when: string; changed: string[] }

export interface WebhookEntityDef {
  entity: string;
  /** Nama model Prisma yang di-tap. */
  model: string;
  label: string;
  /** ALLOWLIST — yang tak disebut tak pernah keluar. Pagar data sensitif sekaligus kontrak payload. */
  fields: string[];
  projectIdField: string | null;
  events: Partial<Record<WebhookAction, { type: string; label: string; when: string }>>;
  derived?: WebhookDerived[];
  /** Baris yang cocok predikat ini tak memancarkan apa pun (mis. notifikasi bertipe `webhook`). */
  skipWhen?: { field: string; equals: unknown };
  /** Model anak yang ikut terhapus cascade DB; dihitung sebelum delete → `data.cascade`. */
  cascade?: string[];
  sample: Record<string, unknown>;
}

// Field yang TAK PERNAH dihitung sebagai perubahan: keduanya bergerak sendiri (stempel sync &
// Prisma), dan tanpa pengecualian ini overlay stage-live `liveSpecs` jadi banjir peristiwa kosong.
const IGNORED_FIELDS = new Set(["version", "updatedAt"]);

export const WEBHOOK_ENTITIES: WebhookEntityDef[] = [
  {
    entity: "spec", model: "Spec", label: "Backlog item",
    fields: ["id", "projectId", "title", "source", "stage", "priority", "author", "objective",
      "branchFrom", "baseSha", "headSha", "dependsOn", "autoMerge", "createdAt", "startedAt", "updatedAt"],
    projectIdField: "projectId",
    events: {
      created: { type: "spec.created", label: "Backlog dibuat", when: "Sebuah item backlog difilekan — lewat UI, POST /specs, breakdown PRD, triase tiket, atau tarik issue GitHub." },
      updated: { type: "spec.updated", label: "Backlog diubah", when: "Field backlog selain stage berubah: judul, objective, prioritas, dependency, branch, atau SHA basis/ujung." },
      deleted: { type: "spec.deleted", label: "Backlog dihapus", when: "Item backlog dihapus operator." },
    },
    derived: [{
      type: "spec.stage_changed", label: "Stage backlog berpindah", changed: ["stage"],
      when: "Stage berpindah — baik oleh fase sesi yang tercatat (otomatis) maupun revert manual operator. Menggantikan spec.updated untuk perubahan itu.",
    }, {
      // SPEC-546 · ADR-0109 · konversi type item. Pola yang sama dengan stage_changed: peristiwa
      // turunan MENGGANTIKAN spec.updated, supaya penerima bisa bereaksi pada "type berpindah"
      // tanpa mendiff dua amplop.
      type: "spec.source_changed", label: "Type backlog berpindah", changed: ["source"],
      when: "Type/source item backlog dikonversi lewat POST /specs/:id/source (mis. brief → qa). Menggantikan spec.updated untuk perubahan itu.",
    }],
    sample: {
      id: "SPEC-481", projectId: "hanoman", title: "Webhook keluar untuk setiap perubahan",
      source: "brief", stage: "executing", priority: "sedang", author: "dena@nafanesia.id",
      objective: "hanoman mengirim webhook HTTP POST ke endpoint yang didaftarkan pengguna.",
      branchFrom: null, baseSha: "5117298c5a3e63af76cbadaa46e2edfa50921d7", headSha: null,
      dependsOn: null, autoMerge: null,
      createdAt: "2026-08-01T02:10:00.000Z", startedAt: "2026-08-01T02:12:31.000Z",
      updatedAt: "2026-08-01T09:41:22.000Z",
    },
  },
  {
    entity: "project", model: "Project", label: "Project",
    fields: ["id", "name", "desc", "kind", "gitRemote", "stack", "helpEnabled",
      "schedulerOptIn", "leadOptIn", "autoMerge", "createdAt", "updatedAt"],
    projectIdField: "id",
    cascade: ["spec", "ticket", "customAgent", "githubIssue"],
    events: {
      created: { type: "project.created", label: "Project ditambah", when: "Project baru terdaftar di workspace." },
      updated: { type: "project.updated", label: "Project diubah", when: "Nama, deskripsi, stack, remote, atau opt-in scheduler/lead/Help Center berubah." },
      deleted: { type: "project.deleted", label: "Project dihapus", when: "Project dihapus. data.cascade menyebut jumlah anak yang ikut terhapus — anaknya sendiri TIDAK memancarkan deleted, sebab cascade dieksekusi SQLite, di luar jangkauan tap." },
    },
    sample: {
      id: "hanoman", name: "hanoman", desc: "Orchestrator + dashboard docs-driven",
      kind: "web", gitRemote: "git@github.com:nafanesia/hanoman.git", stack: "ts",
      helpEnabled: false, schedulerOptIn: true, leadOptIn: false, autoMerge: null,
      createdAt: "2026-05-02T04:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z",
    },
  },
  {
    entity: "session", model: "SessionHistory", label: "Sesi terminal",
    fields: ["id", "sessionId", "projectId", "specId", "title", "kind", "flow", "agent",
      "model", "effort", "branch", "startedAt", "endedAt", "exitCode"],
    projectIdField: "projectId",
    events: {
      created: { type: "session.started", label: "Sesi mulai", when: "Sebuah sesi agen lahir di tmux — backlog, PRD, reverse, scaffold, breakdown, konflik integrasi, terminal, atau konsol VPS." },
    },
    derived: [{
      type: "session.ended", label: "Sesi selesai atau gagal", changed: ["endedAt"],
      when: "Sesi ditutup dan endedAt terisi. exitCode bukan 0 berarti pane mati gagal; null berarti tak terbaca, misalnya tmux mati di luar hanoman.",
    }],
    sample: {
      id: "6f0c1c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", sessionId: "spec_481", projectId: "hanoman",
      specId: "SPEC-481", title: "Webhook keluar untuk setiap perubahan", kind: "spec",
      flow: "feature", agent: "claude", model: "claude-opus-5", effort: "xhigh",
      branch: "hanoman/spec-481",
      startedAt: "2026-08-01T02:12:31.000Z", endedAt: "2026-08-01T09:44:02.000Z", exitCode: 0,
    },
  },
  {
    entity: "ticket", model: "Ticket", label: "Tiket Help Center",
    fields: ["id", "projectId", "number", "category", "title", "detail", "reporterEmail",
      "status", "specId", "createdAt", "updatedAt"],
    projectIdField: "projectId",
    events: {
      created: { type: "ticket.created", label: "Tiket masuk", when: "Pelapor mengirim keluhan lewat halaman Help Center publik project." },
      updated: { type: "ticket.updated", label: "Tiket ditriase", when: "Status tiket berubah (new menjadi accepted atau rejected) atau isinya disunting operator." },
    },
    sample: {
      id: "ckt7f2a1b9c0d3e4f5", projectId: "hanoman", number: 12, category: "bug",
      title: "Terminal tak bisa digulir", detail: "Di layar 13 inci pane terpotong.",
      reporterEmail: "pelapor@contoh.id", status: "accepted", specId: "SPEC-393",
      createdAt: "2026-07-28T01:00:00.000Z", updatedAt: "2026-07-28T02:00:00.000Z",
    },
  },
  {
    entity: "lead_decision", model: "LeadDecision", label: "Putusan hanoman-lead",
    fields: ["id", "projectId", "specId", "sessionId", "gate", "kind", "question", "answer",
      "reason", "refs", "confidence", "action", "status", "weighty", "choice", "choiceIndex",
      "missing", "createdAt"],
    projectIdField: "projectId",
    events: {
      created: { type: "lead.decision", label: "Lead memutuskan", when: "hanoman-lead menerbitkan satu baris jejak keputusan — lewat kontrak POST /lead/decisions, deteksi sesi yang menunggu, atau denyut proaktif." },
    },
    sample: {
      id: "cld3a9f1b2c4d5e6f7", projectId: "hanoman", specId: "SPEC-481", sessionId: "spec_481",
      gate: "detected", kind: "answer", question: "Pakai tap Prisma atau emit manual?",
      answer: "Tap Prisma — satu choke point.", reason: "Kelas bug SPEC-431/448/475.",
      refs: ["internal/docs/adr/0100-webhook-keluar-peristiwa.md"], confidence: "tinggi",
      action: "none", status: "berlaku", weighty: false, choice: "Tap di layer Prisma",
      choiceIndex: 1, missing: null, createdAt: "2026-08-01T03:00:00.000Z",
    },
  },
  {
    entity: "notification", model: "Notification", label: "Notifikasi",
    fields: ["id", "type", "key", "specId", "sessionId", "projectId", "title", "createdAt"],
    projectIdField: "projectId",
    // Nonaktif otomatis melahirkan notifikasi; meneruskannya berarti kegagalan satu endpoint
    // mengirim lalu lintas ke endpoint lain. Rantainya berhenti sendiri, tapi tak berguna.
    skipWhen: { field: "type", equals: "webhook" },
    events: {
      created: { type: "notification.created", label: "Notifikasi baru", when: "hanoman menerbitkan notifikasi: backlog selesai (done), sesi gagal (fail), sesi menunggu keputusan (decision), putusan lead (lead), tiket baru (ticket), atau drift kepatuhan VPS (drift). Notifikasi bertipe webhook sengaja TIDAK diteruskan." },
    },
    sample: {
      id: "cnt5b1c2d3e4f5a6b7", type: "done", key: "done:SPEC-480", specId: "SPEC-480",
      sessionId: "spec_480", projectId: "hanoman",
      title: "Putusan lead ringkas & terstruktur", createdAt: "2026-08-01T01:20:00.000Z",
    },
  },
  {
    entity: "github_issue", model: "GithubIssue", label: "Issue GitHub",
    fields: ["id", "projectId", "repoSlug", "number", "title", "authorLogin", "labels", "url",
      "issueState", "status", "specId", "issueCreatedAt", "issueUpdatedAt", "pulledAt"],
    projectIdField: "projectId",
    events: {
      created: { type: "github_issue.pulled", label: "Issue GitHub ditarik", when: "Issue baru tercermin ke backlog lewat tarik manual atau checker triase." },
      updated: { type: "github_issue.updated", label: "Issue GitHub berubah", when: "Cermin lokal issue diperbarui — judul, label, atau keadaan di GitHub, maupun status triase di hanoman." },
    },
    sample: {
      id: "hanoman:nafanesia/hanoman#912", projectId: "hanoman", repoSlug: "nafanesia/hanoman",
      number: 912, title: "Tambah webhook keluar", authorLogin: "rekan",
      labels: ["enhancement"], url: "https://github.com/nafanesia/hanoman/issues/912",
      issueState: "open", status: "accepted", specId: "SPEC-481",
      issueCreatedAt: "2026-07-30T02:00:00.000Z", issueUpdatedAt: "2026-07-31T02:00:00.000Z",
      pulledAt: "2026-08-01T00:10:00.000Z",
    },
  },
];

const BY_MODEL = new Map(WEBHOOK_ENTITIES.map((d) => [d.model, d]));
export function entityDefForModel(model: string): WebhookEntityDef | undefined {
  return BY_MODEL.get(model);
}

export interface WebhookEventDef {
  type: string; entity: string; entityLabel: string; label: string; when: string;
  sample: Record<string, unknown>;
}

export const WEBHOOK_EVENTS: WebhookEventDef[] = [
  ...WEBHOOK_ENTITIES.flatMap((d) => [
    ...Object.values(d.events).map((e) => ({
      type: e.type, entity: d.entity, entityLabel: d.label, label: e.label, when: e.when, sample: d.sample,
    })),
    ...(d.derived ?? []).map((e) => ({
      type: e.type, entity: d.entity, entityLabel: d.label, label: e.label, when: e.when, sample: d.sample,
    })),
  ]),
  {
    type: WEBHOOK_PING_TYPE, entity: "webhook", entityLabel: "Webhook",
    label: "Ping percobaan",
    when: "Operator menekan tombol Test di Settings, tab Webhook. Satu-satunya peristiwa yang tak berasal dari perubahan data.",
    sample: { endpoint: "Dashboard internal", message: "ping dari hanoman" },
  },
];

export const webhookEventTypes = (): string[] => WEBHOOK_EVENTS.map((e) => e.type);

/** `["*"]` = semua; `"spec.*"` = satu keluarga; selain itu cocok persis. */
export function matchesEvent(subscribed: string[], type: string): boolean {
  for (const s of subscribed) {
    if (s === "*") return true;
    if (s === type) return true;
    if (s.endsWith(".*") && type.startsWith(s.slice(0, -1))) return true;
  }
  return false;
}

const iso = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);

/** Proyeksi allowlist. Yang tak disebut katalog tak pernah keluar. */
export function projectRow(def: WebhookEntityDef, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) if (f in row) out[f] = iso(row[f]);
  return out;
}

/** Field allowlist yang benar-benar berubah, di luar stempel mekanis. */
export function diffFields(
  def: WebhookEntityDef, before: Record<string, unknown>, after: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const f of def.fields) {
    if (IGNORED_FIELDS.has(f)) continue;
    if (JSON.stringify(iso(before[f]) ?? null) !== JSON.stringify(iso(after[f]) ?? null)) out.push(f);
  }
  return out;
}

/** `null` = tak ada peristiwa untuk kombinasi ini (mis. SessionHistory diperbarui tanpa `endedAt`). */
export function eventTypeFor(
  def: WebhookEntityDef, action: WebhookAction, changed: string[],
): string | null {
  if (action === "updated") {
    for (const d of def.derived ?? [])
      if (d.changed.some((f) => changed.includes(f))) return d.type;
  }
  return def.events[action]?.type ?? null;
}

/** Amplop yang melewati batas dipangkas BERTAHAP: string panjang dulu, `before` terakhir. */
export function clampEnvelope(env: WebhookEnvelope): WebhookEnvelope {
  const size = (e: WebhookEnvelope) => JSON.stringify(e).length;
  if (size(env) <= WEBHOOK_MAX_BYTES) return env;
  const fields: string[] = [];
  const trim = (side: "before" | "after") => {
    const obj = env.data[side];
    if (!obj) return;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && v.length > WEBHOOK_FIELD_MAX_CHARS) {
        next[k] = v.slice(0, WEBHOOK_FIELD_MAX_CHARS) + "…";
        fields.push(`${side}.${k}`);
      } else next[k] = v;
    }
    env.data[side] = next;
  };
  trim("before"); trim("after");
  if (size(env) > WEBHOOK_MAX_BYTES && env.data.before) {
    env.data.before = null;
    fields.push("before");
  }
  if (size(env) > WEBHOOK_MAX_BYTES && env.data.after) {
    env.data.after = null;
    fields.push("after");
  }
  return { ...env, truncated: true, truncatedFields: fields };
}

/** Amplop contoh untuk halaman dokumentasi — dibangun dari katalog, bukan ditulis tangan. */
export function sampleEnvelope(type: string): WebhookEnvelope {
  const def = WEBHOOK_EVENTS.find((e) => e.type === type);
  const entity = WEBHOOK_ENTITIES.find((d) => d.entity === def?.entity);
  const after = { ...(def?.sample ?? {}) };
  const created = type.endsWith(".created") || type === "github_issue.pulled"
    || type === "session.started" || type === WEBHOOK_PING_TYPE;
  const deleted = type.endsWith(".deleted");
  const changed = type === "spec.stage_changed" ? ["stage"]
    : type === "spec.source_changed" ? ["source"]     // SPEC-546 · ADR-0109
    : type === "session.ended" ? ["endedAt", "exitCode"]
      : created || deleted ? [] : ["title"];
  return {
    specVersion: WEBHOOK_SPEC_VERSION,
    id: "evt_9f2c4b1e7a3d4c58",
    type,
    createdAt: "2026-08-01T09:41:22.108Z",
    project: entity?.projectIdField ? { id: "hanoman", name: "hanoman" } : null,
    actor: { kind: "user", id: "usr_2k1", label: "dena@nafanesia.id" },
    data: {
      entity: def?.entity ?? "webhook",
      id: String(after.id ?? "evt"),
      action: created ? "created" : deleted ? "deleted" : "updated",
      changed,
      before: created ? null
        : changed.length ? Object.fromEntries(changed.map((f) => [f, null])) : null,
      after: deleted ? null : after,
    },
    truncated: false,
    truncatedFields: [],
  };
}

// ——— DTO ———

export const zCreateWebhookEndpoint = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.string().min(1)).min(1).max(64),
  projectIds: z.array(z.string().min(1)).nullable().optional(),
  enabled: z.boolean().optional(),
  allowPrivate: z.boolean().optional(),
  /** Batas laju per endpoint; melindungi PENERIMA, bukan hanoman. */
  maxPerMinute: z.number().int().min(1).max(600).optional(),
  /** Kosong = hanoman membangkitkan 32 byte acak. */
  secret: z.string().min(16).max(200).optional(),
});
export type CreateWebhookEndpoint = z.infer<typeof zCreateWebhookEndpoint>;

export const zUpdateWebhookEndpoint = zCreateWebhookEndpoint.partial()
  .extend({ rotateSecret: z.boolean().optional() });
export type UpdateWebhookEndpoint = z.infer<typeof zUpdateWebhookEndpoint>;

export interface WebhookEndpointView {
  id: string; name: string; url: string; events: string[]; projectIds: string[] | null;
  enabled: boolean; allowPrivate: boolean; apiVersion: number; maxPerMinute: number;
  secretHint: string;
  disabledAt: string | null; disabledReason: string | null;
  lastSuccessAt: string | null; lastFailureAt: string | null; failureStreak: number;
  pending: number;
  createdAt: string; updatedAt: string;
  /** HANYA pada respons create/rotate — sekali seumur hidup. */
  secret?: string;
}

export type WebhookDeliveryStatus = "pending" | "sending" | "sent" | "failed" | "dropped";

export interface WebhookDeliveryView {
  id: string; endpointId: string; eventId: string; eventType: string; projectId: string | null;
  status: WebhookDeliveryStatus;
  attempt: number; maxAttempts: number;
  httpStatus: number | null; durationMs: number | null; error: string | null;
  nextAttemptAt: string | null; createdAt: string; sentAt: string | null;
  payload: unknown;
}

export interface WebhookTestResult {
  ok: boolean; httpStatus: number | null; durationMs: number; error: string | null;
}
