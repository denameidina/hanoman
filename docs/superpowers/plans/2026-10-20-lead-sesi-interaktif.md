# Lead Sesi Interaktif + Gerbang Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengganti "brain" sekali-panggil hanoman-lead dengan satu sesi tmux interaktif per proyek yang memeriksa dulu sebelum memutuskan, dibatasi gerbang server deterministik (jatah resource, aturan ambil backlog, syarat merge, wewenang per tindakan + approval), dan bisa di-attach/di-steer manusia.

**Architecture:** `decide()` tetap choke point tunggal ketiga pintu; `DecideDeps.think` diganti `thinkViaSession` yang menulis `LeadEvent` ke inbox DB dan menunggu lead menjawab. `courier` menyuntik batch event ke pane `lead-<proyek>` saat diam; lead membaca situasi lewat `GET /api/lead-pane/brief` dan menjawab lewat `POST /api/lead-pane/act` (HMAC token sesi). `guard.ts` + `budget.ts` menegakkan aturan objektif; tindakan mode `ask` atau sensitif menjadi `LeadApproval` (UI + Telegram).

**Tech Stack:** TypeScript strict, Fastify, Prisma 6 (SQLite), Zod (`@hanoman/shared`), vitest, tmux (`server/src/services/pty.ts`), React+Vite (`src/`).

**Spec:** `docs/superpowers/specs/2026-10-20-lead-sesi-interaktif-design.md` (baca bagian "Koreksi pasca-penelusuran kode" lebih dulu).

## Global Constraints

- Satu SPEC, satu branch, satu rilis; fase hanya urutan kerja. Tak ada flag transisi `lead.mode`.
- Default angka (verbatim dari spec): `quotaStopPct` 85, `rampStep` 1, `rampProbeMin` 10, `failStreak` 2, `answerSlaSec` 300, `deliverTimeoutSec` 600, `approvalTtlMin` 1440, `rotateAfterEvents` 40, `targetBranch` "main", `verifyCommand` "" .
- Default wewenang: `answer-session`=auto, `start-session`=auto, `integrate-main`=ask, `stop-session`/`resume-session`/`restart-session`=auto, sisanya auto.
- Data limit tak terbaca ⇒ jatah 0 (gagal aman). `verifyCommand` kosong ⇒ `integrate-main` selalu `butuh-izin`.
- `requireGreenBeforeIntegrate` tak bisa mematikan syarat integrasi jalur lead (knob tetap dibaca untuk kompatibilitas, diabaikan).
- Sesi lead: id `lead-<projectId sanitized>`, `SessionKind` `"lead"`, `launchClass: "terminal"` (tak makan slot), worktree `<repo>/.worktrees/lead-<id>` di HEAD `targetBranch`.
- Tak ada timer baru (ADR-0024): semua sapuan menumpang tick 60 dtk `lead/engine.ts`.
- Skema berubah ⇒ migration Prisma + ADR-0228 dalam commit yang sama. API baru ⇒ keputusan MCP (tool atau `COOKIE_ONLY` beralasan) dalam commit yang sama (ADR-0202).
- Docs `internal/docs/**` yang tersentuh diperbarui dalam commit yang sama dan ditautkan di `internal/docs/README.md`.
- Bahasa: komentar & teks UI Bahasa Indonesia, gaya komentar repo (rujuk SPEC/ADR).
- **Perintah test** (dipakai semua task; ganti `<paths>`; buat direktori DB sekali per task):

```bash
mkdir -p /private/tmp/hanoman-lead-test && /usr/bin/env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR -u HANOMAN_SESSION_ID -u HANOMAN_EVENT_URL -u HANOMAN_EVENT_TOKEN -u HANOMAN_EVENT_DIR -u HANOMAN_EVENT_HOST TEST_DATABASE_URL=file:/private/tmp/hanoman-lead-test/t.test.db pnpm vitest --run <paths> --no-file-parallelism
```

- Kerjakan di worktree terpisah (bukan working tree utama). Commit per task, akhiri pesan dengan `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/lead.ts` (modify) | `zLeadProject`, `LEAD_AUTHORITY_DEFAULTS`, `zLeadAct`, `LeadEventView`, `LeadApprovalView`, `LeadSessionView`, `LEAD_SENSITIVE_TERMS`, `isSensitiveText()` |
| `shared/src/entities.ts` (modify) | `zLead` +knob baru, `projects` per proyek; cabut `maxConcurrent`/`queueWaitSec`/`timeoutSec` di Task 15 |
| `shared/src/session-kind.ts` (modify) | `"lead"` |
| `shared/src/agent.ts` (modify) | capability `lead:approve` |
| `server/prisma/schema.prisma` + migration | `LeadEvent`, `LeadApproval`, `LeadDecision.eventId` |
| `server/src/services/lead/project-config.ts` (create) | `leadProjectConfig(cfg, projectId)` — gabung default per proyek |
| `server/src/services/lead/budget.ts` (create) | `launchBudget()` |
| `server/src/services/lead/guard.ts` (create) | `checkAct()` |
| `server/src/services/lead/inbox.ts` (create) | CRUD `LeadEvent`, waiter in-process, batch, sapuan |
| `server/src/services/lead/session-think.ts` (create) | `thinkViaSession()` — pengganti `brain.think` |
| `server/src/services/lead/lead-session.ts` (create) | buka/rotasi/hentikan pane lead, backoff |
| `server/src/services/lead/lead-prompt.ts` (create) | prompt sistem sesi lead + format batch |
| `server/src/services/lead/courier.ts` (create) | suntik batch saat pane diam |
| `server/src/services/lead/act.ts` (create) | proses `act`: validasi → guard → approval / selesaikan event |
| `server/src/services/lead/approvals.ts` (create) | `LeadApproval` CRUD, putuskan, kedaluwarsa, push Telegram |
| `server/src/services/lead/verify.ts` (create) | jalankan `verifyCommand` di worktree |
| `server/src/routes/lead-pane.ts` (create) | `/lead-pane/brief`, `/lead-pane/act` (HMAC) |
| `server/src/routes/lead.ts` (modify) | inbox, approvals, session start/stop/rotate |
| `server/src/services/lead/apply.ts` (modify) | `integrate-main` diperketat |
| `server/src/services/lead/pulse.ts` (modify) | `pickReadyWork` berbasis jatah, pemutus beruntun |
| `server/src/services/lead/decide.ts` (modify) | lepas `runGated`, pakai `thinkViaSession` |
| `server/src/services/lead/engine.ts` (modify) | sapuan inbox/approval/courier/sesi |
| `server/src/routes/session-events.ts` (modify) | Stop dari `lead-*` → courier |
| `server/src/services/pty.ts` (modify) | `sessionKind` lead, catat input manusia di pane lead |
| `server/src/services/telegram/gateway.ts` + `notify.ts` (modify) | tombol `tgla:` |
| `server/src/services/lead/views.ts` (modify) | `LeadStatusView` + inbox/approvals/sessions |
| `shared/src/mcp-catalog/lead.ts` (modify) | tool MCP baru |
| `server/src/services/agent-capabilities.ts` (modify) | peta route baru |
| `src/src/screens/LeadScreen.tsx` + `src/src/screens/lead/*` (modify/create) | panel Sesi, Inbox, Izin, Wewenang |
| hapus: `lead/brain.ts`, `lead/gate.ts`, test terkait | Task 15 |

---

## Fase 1 — Data & ADR

### Task 1: Kontrak shared (setelan per proyek, act, view, jenis sesi, capability)

**Files:**
- Modify: `shared/src/lead.ts` (tambah di akhir berkas)
- Modify: `shared/src/entities.ts:375-411` (`zLead`)
- Modify: `shared/src/session-kind.ts:6-21`
- Modify: `shared/src/agent.ts:19`, `:115`, daftar capability danger
- Test: `shared/src/lead-session.test.ts` (create)

**Interfaces:**
- Produces:
  - `zLeadProject`, `type LeadProject = { authority: Partial<Record<LeadAction, LeadAuthorityMode>>; targetBranch: string; verifyCommand: string; quotaStopPct: number; rampStep: number; rampProbeMin: number; failStreak: number; answerSlaSec: number }`
  - `type LeadAuthorityMode = "auto" | "ask" | "off"`, `LEAD_AUTHORITY_DEFAULTS: Record<LeadAction, LeadAuthorityMode>`
  - `zLeadAct` → `{ eventId: string; verdict: LeadVerdict; evidence: string[] }`
  - `LeadEventKind = "ask" | "session-ended" | "pulse" | "human" | "rejected" | "integrate-failed"`, `LeadEventStatus = "open" | "delivered" | "done" | "late" | "human"`
  - `LeadEventView`, `LeadApprovalView`, `LeadSessionView`, `LeadActResult = { outcome: "lolos" | "butuh-izin" | "ditolak"; code?: LeadRefusalCode; detail: string; approvalId?: string }`
  - `LeadRefusalCode` (union, lihat kode)
  - `LEAD_SENSITIVE_TERMS: readonly string[]`, `isSensitiveText(s: string): boolean`
  - `zLead` menambah: `answerSlaSec`, `deliverTimeoutSec`, `rotateAfterEvents`, `approvalTtlMin`, `projects: Record<string, LeadProjectInput>`, default proyek: `projectDefaults: zLeadProject`
  - `SessionKind` += `"lead"`; capability `"lead:approve"`

- [x] **Step 1: Tulis test yang gagal**

`shared/src/lead-session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  LEAD_ACTIONS, LEAD_AUTHORITY_DEFAULTS, zLeadAct, zLeadProject, isSensitiveText,
  zLead, SESSION_KINDS, CAPABILITY_IDS,
} from "./index";

describe("kontrak sesi lead", () => {
  it("memberi mode wewenang untuk SETIAP tindakan, merge = ask", () => {
    for (const a of LEAD_ACTIONS) expect(LEAD_AUTHORITY_DEFAULTS[a]).toBeDefined();
    expect(LEAD_AUTHORITY_DEFAULTS["integrate-main"]).toBe("ask");
    expect(LEAD_AUTHORITY_DEFAULTS["answer-session"]).toBe("auto");
    expect(LEAD_AUTHORITY_DEFAULTS["start-session"]).toBe("auto");
  });

  it("default proyek memakai angka spec", () => {
    const p = zLeadProject.parse({});
    expect(p).toMatchObject({
      targetBranch: "main", verifyCommand: "", quotaStopPct: 85, rampStep: 1,
      rampProbeMin: 10, failStreak: 2, answerSlaSec: 300, authority: {},
    });
  });

  it("zLead menambah knob global sesi lead tanpa merusak baris lama", () => {
    const l = zLead.parse({ enabled: true });
    expect(l.deliverTimeoutSec).toBe(600);
    expect(l.approvalTtlMin).toBe(1440);
    expect(l.rotateAfterEvents).toBe(40);
    expect(l.projects).toEqual({});
  });

  it("act menuntut eventId + verdict; evidence default kosong", () => {
    const ok = zLeadAct.parse({ eventId: "e1", verdict: { decision: "d", reason: "r" } });
    expect(ok.evidence).toEqual([]);
    expect(ok.verdict.action).toBe("none");
    expect(zLeadAct.safeParse({ verdict: { decision: "d", reason: "r" } }).success).toBe(false);
  });

  it("mengenali teks sensitif tanpa peka huruf besar", () => {
    expect(isSensitiveText("Deploy ke PRODUKSI sekarang")).toBe(true);
    expect(isSensitiveText("Bootstrap director sementara khusus staging untuk membuat akun uji")).toBe(true);
    expect(isSensitiveText("Pakai netSalary alokasi versi aktif")).toBe(false);
  });

  it("jenis sesi & capability baru terdaftar", () => {
    expect(SESSION_KINDS).toContain("lead");
    expect(CAPABILITY_IDS).toContain("lead:approve");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/src/lead-session.test.ts`
Expected: FAIL (`LEAD_AUTHORITY_DEFAULTS` tak diekspor).

- [x] **Step 3: Implementasi**

Tambahkan di akhir `shared/src/lead.ts`:

```ts
// ── Sesi lead (ADR-0228) ─────────────────────────────────────────────────────────────────────
// Lead bukan lagi `claude -p` sekali-panggil melainkan satu pane tmux per proyek. Yang hidup di
// sini hanya KONTRAK yang dibagi server & UI: mode wewenang per tindakan, bentuk `act`, dan view.

export const LEAD_AUTHORITY_MODES = ["auto", "ask", "off"] as const;
export type LeadAuthorityMode = (typeof LEAD_AUTHORITY_MODES)[number];
export const zLeadAuthorityMode = z.enum(LEAD_AUTHORITY_MODES);

/** Default wewenang (spec §3): merge minta izin, sisanya jalan sendiri selama gerbang lolos. */
export const LEAD_AUTHORITY_DEFAULTS: Record<LeadAction, LeadAuthorityMode> = {
  none: "auto", "answer-session": "auto", "start-session": "auto", "stop-session": "auto",
  "resume-session": "auto", "restart-session": "auto", "order-queue": "auto", "hold-work": "auto",
  "push-branch": "auto", "integrate-main": "ask", "run-migration": "auto",
};

export const zLeadProject = z.object({
  authority: z.record(zLeadAction, zLeadAuthorityMode).default({}),
  targetBranch: z.string().min(1).default("main"),
  verifyCommand: z.string().default(""),
  quotaStopPct: z.number().int().min(1).max(100).default(85),
  rampStep: z.number().int().min(1).max(16).default(1),
  rampProbeMin: z.number().int().min(1).max(240).default(10),
  failStreak: z.number().int().min(1).max(20).default(2),
  answerSlaSec: z.number().int().min(30).max(3600).default(300),
});
export type LeadProject = z.infer<typeof zLeadProject>;
export type LeadProjectInput = z.input<typeof zLeadProject>;

/** Bentuk yang dikirim pane lead ke `POST /api/lead-pane/act`. `verdict` = `zLeadVerdict` apa adanya. */
export const zLeadAct = z.object({
  eventId: z.string().min(1),
  verdict: zLeadVerdict,
  evidence: z.array(z.string()).default([]),
});
export type LeadAct = z.infer<typeof zLeadAct>;

export const LEAD_EVENT_KINDS = ["ask", "session-ended", "pulse", "human", "rejected", "integrate-failed"] as const;
export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];
export const LEAD_EVENT_STATUSES = ["open", "delivered", "done", "late", "human"] as const;
export type LeadEventStatus = (typeof LEAD_EVENT_STATUSES)[number];
/** Prioritas kelas (spec §1): kecil = didahulukan. */
export const LEAD_EVENT_PRIORITY: Record<LeadEventKind, number> = {
  ask: 0, "session-ended": 1, "integrate-failed": 1, human: 2, rejected: 2, pulse: 3,
};

export type LeadRefusalCode =
  | "event-closed" | "authority-off" | "budget-zero" | "spec-done" | "spec-not-approved"
  | "spec-empty" | "blocked" | "session-live" | "no-reason" | "no-evidence"
  | "not-waiting" | "plan-open" | "worktree-dirty" | "conflict" | "verify-failed"
  | "integrate-busy" | "no-session" | "action-locked";

export type LeadActResult = {
  outcome: "lolos" | "butuh-izin" | "ditolak";
  code?: LeadRefusalCode;
  detail: string;
  approvalId?: string;
};

export type LeadEventView = {
  id: string; projectId: string; kind: LeadEventKind; status: LeadEventStatus; priority: number;
  question: string; specId: string | null; sessionId: string | null;
  deadlineAt: string | null; deliveredAt: string | null; createdAt: string; decisionId: string | null;
};
export type LeadApprovalView = {
  id: string; eventId: string; projectId: string; action: string; target: string | null;
  reason: string; evidence: string[]; gateReport: string[];
  status: "pending" | "approved" | "rejected" | "expired";
  decidedBy: string | null; decidedAt: string | null; note: string | null; createdAt: string;
};
export type LeadSessionView = {
  projectId: string; sessionId: string; alive: boolean; idle: boolean;
  humanActive: boolean; delivered: number; restarts: number;
};

/**
 * Daftar sensitif (spec §2): jawaban yang menyentuh salah satunya SELALU minta izin, apa pun mode
 * wewenangnya. Kata, bukan regex bebas — operator harus bisa membaca daftarnya.
 */
export const LEAD_SENSITIVE_TERMS = [
  "produksi", "production", "prod ", "kredensial", "credential", "secret", "password", "token",
  "akun", "account", "director", "hapus data", "delete data", "drop table", "truncate",
  "migrasi produksi", "deploy", "rollback", "force push", "--force",
] as const;
export function isSensitiveText(s: string): boolean {
  const t = ` ${s.toLowerCase()} `;
  return LEAD_SENSITIVE_TERMS.some((w) => t.includes(w));
}
```

Di `shared/src/entities.ts`, impor `zLeadProject` dari `./lead` (cek tak ada impor sirkular: `lead.ts` tak mengimpor `entities.ts`; bila ada, pindahkan `zLeadProject` ke `shared/src/lead-project.ts` dan re-ekspor dari `lead.ts`). Tambah di dalam `zLead` sebelum `engine`:

```ts
  // ADR-0228 · sesi lead. Knob GLOBAL: tenggat antar-jemput event dan umur approval.
  deliverTimeoutSec: z.number().int().min(60).max(3600).default(600),
  approvalTtlMin: z.number().int().min(5).max(10080).default(1440),
  rotateAfterEvents: z.number().int().min(5).max(500).default(40),
  // Setelan PER PROYEK (wewenang, branch target, perintah verifikasi, jatah). Kosong = default
  // `zLeadProject`. Record, bukan kolom Project: blok lead hidup di Setting.data (tanpa migration).
  projects: z.record(z.string(), zLeadProject.partial()).default({}),
```

`shared/src/session-kind.ts`: tambah `"lead"` ke `SESSION_KINDS` dan `lead: "Lead"` ke `SESSION_KIND_LABEL`. Jangan masukkan `lead` ke `RESTARTABLE`.

`shared/src/agent.ts`: tambah `"lead:approve"` setelah `"lead:read", "lead:write"` di `CAPABILITY_IDS`; tambah deskriptor setelah baris `lead:write` (`:115`):

```ts
  { id: "lead:approve", domain: "lead", access: "danger", label: "Lead — setujui", desc: "Setujui/tolak tindakan hanoman-lead yang menunggu izin (bisa merge ke branch target).", risk: "exec" },
```

Ikuti pola `sessions:decide` (`agent.ts:145`) untuk entri `access: "danger"`. Perbarui `shared/src/lead.test.ts:134-139` bila ia mengunci daftar capability lead.

- [x] **Step 4: Jalankan test**

Run: `pnpm vitest --run shared/src/lead-session.test.ts shared/src/lead.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src
git commit -m "feat(shared): kontrak sesi lead — wewenang per tindakan, act, view, kind lead, lead:approve"
```

### Task 2: Migration `LeadEvent` / `LeadApproval` + ADR-0228

**Files:**
- Modify: `server/prisma/schema.prisma` (setelah `model LeadDecision`)
- Create: `server/prisma/migrations/20261020120000_lead_session_inbox/migration.sql`
- Create: `internal/docs/adr/0228-lead-sesi-interaktif-gerbang-server.md`
- Modify: `internal/docs/architecture/data-model.md`, `internal/docs/README.md`
- Test: `server/test/lead-inbox-schema.test.ts` (create)

**Interfaces:**
- Produces: `prisma.leadEvent`, `prisma.leadApproval`, kolom `LeadDecision.eventId`.

- [x] **Step 1: Test skema yang gagal**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/db";

afterAll(async () => { await prisma.leadApproval.deleteMany(); await prisma.leadEvent.deleteMany(); });

describe("skema inbox lead (ADR-0228)", () => {
  it("menyimpan event, approval, dan tautan keputusan", async () => {
    const e = await prisma.leadEvent.create({ data: {
      projectId: "p", kind: "ask", priority: 0, question: "q", payload: { prompt: "x" },
    } });
    expect(e.status).toBe("open");
    const a = await prisma.leadApproval.create({ data: {
      eventId: e.id, projectId: "p", action: "integrate-main", reason: "r", evidence: [], gateReport: [], verdict: {},
    } });
    expect(a.status).toBe("pending");
    const d = await prisma.leadDecision.create({ data: {
      projectId: "p", gate: "pulse", kind: "quality", question: "q", answer: "a", reason: "r",
      refs: [], confidence: "tinggi", eventId: e.id,
    } });
    expect(d.eventId).toBe(e.id);
    await prisma.leadDecision.delete({ where: { id: d.id } });
  });
});
```

- [x] **Step 2: Jalankan → FAIL** (`prisma.leadEvent` undefined). Pakai perintah test Global Constraints dengan `<paths>` = `server/test/lead-inbox-schema.test.ts`.

- [x] **Step 3: Skema + migration**

Tambah ke `schema.prisma` (LOCAL-ONLY seperti `LeadDecision`, tanpa FK ke Project):

```prisma
// SPEC-<nnn> · ADR-0228 · inbox sesi lead. Satu baris = satu hal yang harus diputuskan pane
// `lead-<proyek>`. LOCAL-ONLY (cermin LeadDecision): menunjuk sesi tmux mesin ini.
model LeadEvent {
  id          String    @id @default(cuid())
  projectId   String
  kind        String    // ask | session-ended | pulse | human | rejected | integrate-failed
  priority    Int       // LEAD_EVENT_PRIORITY — kecil didahulukan
  status      String    @default("open") // open | delivered | done | late | human
  question    String    // baris yang dibaca manusia di inbox
  payload     Json      // { prompt, gate, leadKind, options?, select?, notes? }
  sessionId   String?
  specId      String?
  deadlineAt  DateTime?
  deliveredAt DateTime?
  attempts    Int       @default(0)
  closedAt    DateTime?
  decisionId  String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([projectId, status, priority, createdAt])
}

// ADR-0228 · tindakan lead yang menunggu izin manusia. Tak pernah jalan sendiri saat kedaluwarsa.
model LeadApproval {
  id         String    @id @default(cuid())
  eventId    String
  projectId  String
  action     String
  target     String?
  reason     String
  evidence   Json      // string[]
  gateReport Json      // string[]
  verdict    Json      // zLeadVerdict yang ditahan — dilepas apa adanya saat disetujui
  status     String    @default("pending") // pending | approved | rejected | expired
  decidedBy  String?
  decidedAt  DateTime?
  note       String?
  createdAt  DateTime  @default(now())

  @@index([projectId, status])
  @@index([eventId])
}
```

Tambah ke `model LeadDecision`: `eventId String? // ADR-0228 · event inbox yang dijawab baris ini`.

`migration.sql`:

```sql
CREATE TABLE "LeadEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "question" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "sessionId" TEXT,
  "specId" TEXT,
  "deadlineAt" DATETIME,
  "deliveredAt" DATETIME,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "closedAt" DATETIME,
  "decisionId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "LeadEvent_projectId_status_priority_createdAt_idx" ON "LeadEvent"("projectId", "status", "priority", "createdAt");
CREATE TABLE "LeadApproval" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target" TEXT,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "gateReport" JSONB NOT NULL,
  "verdict" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "decidedBy" TEXT,
  "decidedAt" DATETIME,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LeadApproval_projectId_status_idx" ON "LeadApproval"("projectId", "status");
CREATE INDEX "LeadApproval_eventId_idx" ON "LeadApproval"("eventId");
ALTER TABLE "LeadDecision" ADD COLUMN "eventId" TEXT;
```

Bandingkan tipe `Json` dengan migration lama (`grep -n JSONB server/prisma/migrations/*/migration.sql | head`); bila repo memakai `TEXT` untuk Json di SQLite, ikuti itu. Jalankan `pnpm --filter server exec prisma migrate diff --from-migrations server/prisma/migrations --to-schema-datamodel server/prisma/schema.prisma --shadow-database-url file:/private/tmp/hanoman-lead-test/shadow.db --script` → harus kosong setelah migration ditambahkan. Lalu `pnpm --filter server exec prisma generate`.

- [x] **Step 4: ADR-0228** — tulis `internal/docs/adr/0228-lead-sesi-interaktif-gerbang-server.md` dengan format ADR repo (Status Accepted, Tanggal 2026-10-20, Terkait: menggantikan bagian brain ADR-0091/0146/0223, mengamandemen ADR-0167, ADR-0161/0170 dipakai, ADR-0024 dipatuhi). Isi: Konteks (tabel bukti dari spec), Keputusan (10 poin: sesi per proyek, think-seam, lead-pane HMAC, inbox DB, batch+prioritas+tenggat, guard+budget, wewenang+approval, verifyCommand/targetBranch, kind `lead` launchClass terminal, pencabutan brain), Konsekuensi. Tambah baris tautan di `internal/docs/README.md` bagian ADR, dan bagian model `LeadEvent`/`LeadApproval` di `internal/docs/architecture/data-model.md`.

- [x] **Step 5: Test → PASS**, lalu commit:

```bash
git add server/prisma internal/docs server/test/lead-inbox-schema.test.ts
git commit -m "feat(db): inbox & approval sesi lead + ADR-0228"
```

---

## Fase 2 — Gerbang & jatah

### Task 3: `project-config.ts` + `budget.ts`

**Files:**
- Create: `server/src/services/lead/project-config.ts`, `server/src/services/lead/budget.ts`
- Test: `server/test/lead-budget.test.ts`

**Interfaces:**
- Consumes: `Lead`, `LeadProject`, `zLeadProject` (Task 1), `launchStatus` (`server/src/services/session-admission.ts:20`), `getLimits`/`getCodexLimits`/`getAntigravityLimits`, `sessionAgentDefaults` (`server/src/services/settings`).
- Produces:
  - `leadProjectConfig(cfg: Lead, projectId: string): LeadProject`
  - `authorityFor(cfg: Lead, projectId: string, action: LeadAction): LeadAuthorityMode`
  - `type BudgetInput = { slotsFree: number; hostOk: boolean; quota: { status: "ok" | "error"; maxUsedPct: number } ; inProbe: number; failStreak: number; cfg: LeadProject }`
  - `type Budget = { n: number; reasons: string[]; tripped: boolean }`
  - `computeBudget(i: BudgetInput): Budget` (murni)
  - `launchBudget(projectId: string, deps?: BudgetDeps): Promise<Budget>`
  - `type BudgetDeps = { cfg; status: () => Promise<{ slotsFree: number; hostOk: boolean }>; quota: () => Promise<{ status: "ok"|"error"; maxUsedPct: number }>; leadItems: (projectId: string) => Promise<{ status: string; launchedAt: Date | null }[]>; now: () => number }`

- [x] **Step 1: Test gagal**

```ts
import { describe, it, expect } from "vitest";
import { zLeadProject, LEAD_DEFAULTS } from "@hanoman/shared";
import { computeBudget, launchBudget } from "../src/services/lead/budget";
import { leadProjectConfig, authorityFor } from "../src/services/lead/project-config";

const cfg = zLeadProject.parse({});
const base = { slotsFree: 3, hostOk: true, quota: { status: "ok" as const, maxUsedPct: 10 }, inProbe: 0, failStreak: 0, cfg };

describe("computeBudget", () => {
  it("dibatasi ramp walau slot banyak", () => {
    expect(computeBudget(base).n).toBe(1);
  });
  it("nol saat masih ada sesi dalam probe", () => {
    expect(computeBudget({ ...base, inProbe: 1 }).n).toBe(0);
  });
  it("nol saat kuota ≥ quotaStopPct", () => {
    const b = computeBudget({ ...base, quota: { status: "ok", maxUsedPct: 85 } });
    expect(b.n).toBe(0);
    expect(b.reasons.join(" ")).toContain("kuota");
  });
  it("nol (gagal aman) saat data limit tak terbaca", () => {
    expect(computeBudget({ ...base, quota: { status: "error", maxUsedPct: 0 } }).n).toBe(0);
  });
  it("nol saat host menolak atau slot habis", () => {
    expect(computeBudget({ ...base, hostOk: false }).n).toBe(0);
    expect(computeBudget({ ...base, slotsFree: 0 }).n).toBe(0);
  });
  it("pemutus beruntun menyala pada failStreak", () => {
    const b = computeBudget({ ...base, failStreak: 2 });
    expect(b.n).toBe(0);
    expect(b.tripped).toBe(true);
  });
});

describe("launchBudget", () => {
  it("menghitung probe & deret gagal dari baris antrean source=lead", async () => {
    const now = Date.parse("2026-10-20T07:00:00Z");
    const b = await launchBudget("p", {
      cfg: async () => LEAD_DEFAULTS,
      status: async () => ({ slotsFree: 4, hostOk: true }),
      quota: async () => ({ status: "ok", maxUsedPct: 5 }),
      leadItems: async () => [
        { status: "failed", launchedAt: new Date(now - 60 * 60_000) },
        { status: "failed", launchedAt: new Date(now - 61 * 60_000) },
      ],
      now: () => now,
    });
    expect(b.tripped).toBe(true);
    expect(b.n).toBe(0);
  });
});

describe("project-config", () => {
  it("menggabung default dengan override per proyek", () => {
    const l = { ...LEAD_DEFAULTS, projects: { p: { targetBranch: "develop", authority: { "integrate-main": "auto" as const } } } };
    expect(leadProjectConfig(l, "p").targetBranch).toBe("develop");
    expect(leadProjectConfig(l, "q").targetBranch).toBe("main");
    expect(authorityFor(l, "p", "integrate-main")).toBe("auto");
    expect(authorityFor(l, "q", "integrate-main")).toBe("ask");
  });
});
```

- [x] **Step 2: Jalankan → FAIL** (modul tak ada).

- [x] **Step 3: Implementasi**

`server/src/services/lead/project-config.ts`:

```ts
import { zLeadProject, LEAD_AUTHORITY_DEFAULTS, type Lead, type LeadProject, type LeadAction, type LeadAuthorityMode } from "@hanoman/shared";

// ADR-0228 · setelan lead PER PROYEK. Satu fungsi penggabung supaya default tak pernah disalin ke
// tiap pemanggil (kelas bug SPEC-431/448/475).
export function leadProjectConfig(cfg: Lead, projectId: string): LeadProject {
  return zLeadProject.parse(cfg.projects?.[projectId] ?? {});
}

export function authorityFor(cfg: Lead, projectId: string, action: LeadAction): LeadAuthorityMode {
  return leadProjectConfig(cfg, projectId).authority[action] ?? LEAD_AUTHORITY_DEFAULTS[action];
}
```

`server/src/services/lead/budget.ts`:

```ts
import type { Lead, LeadProject } from "@hanoman/shared";
import { prisma } from "../../db";
import { getLead } from "./config";
import { leadProjectConfig } from "./project-config";
import { launchStatus } from "../session-admission";
import { getScheduler } from "../scheduler/config";
import { listSessionsAsync } from "../pty";
import { hostLoad } from "../host-load";
import { getLimits } from "../limits";
import { getCodexLimits } from "../codex-limits";
import { getAntigravityLimits } from "../antigravity-limits";
import { sessionAgentDefaults } from "../settings";

// ADR-0228 · JATAH PELUNCURAN. Server yang menentukan BERAPA; lead hanya memilih YANG MANA.
// Kasus 2026-10-20: 7 backlog crm diluncurkan dalam 30 dtk lalu 7/7 gagal — tak ada satu pun
// pembacaan kuota, beban, atau hasil sesi sebelumnya di jalur lead.

export type BudgetInput = {
  slotsFree: number; hostOk: boolean;
  quota: { status: "ok" | "error"; maxUsedPct: number };
  inProbe: number; failStreak: number; cfg: LeadProject;
};
export type Budget = { n: number; reasons: string[]; tripped: boolean };

export function computeBudget(i: BudgetInput): Budget {
  const reasons: string[] = [];
  let n = Math.max(0, i.slotsFree);
  if (n === 0) reasons.push("slot scheduler penuh");
  if (!i.hostOk) { n = 0; reasons.push("host menolak (beban/memori, ADR-0161)"); }
  if (i.quota.status !== "ok") { n = 0; reasons.push("data kuota tak terbaca — gagal aman"); }
  else if (i.quota.maxUsedPct >= i.cfg.quotaStopPct) {
    n = 0; reasons.push(`kuota ${Math.round(i.quota.maxUsedPct)}% ≥ ${i.cfg.quotaStopPct}%`);
  }
  const ramp = Math.max(0, i.cfg.rampStep - i.inProbe);
  if (ramp < n) { n = ramp; reasons.push(`ramp: ${i.inProbe} sesi masih dalam probe ${i.cfg.rampProbeMin} menit`); }
  const tripped = i.failStreak >= i.cfg.failStreak;
  if (tripped) { n = 0; reasons.push(`${i.failStreak} sesi lead gagal beruntun — pemutus menyala`); }
  return { n, reasons, tripped };
}

export type BudgetDeps = {
  cfg: () => Promise<Lead>;
  status: () => Promise<{ slotsFree: number; hostOk: boolean }>;
  quota: () => Promise<{ status: "ok" | "error"; maxUsedPct: number }>;
  leadItems: (projectId: string) => Promise<{ status: string; launchedAt: Date | null }[]>;
  now: () => number;
};

async function prodStatus(): Promise<{ slotsFree: number; hostOk: boolean }> {
  const sched = await getScheduler();
  const st = launchStatus(await listSessionsAsync(), sched, await hostLoad());
  const loadOk = st.loadPerCore === null || st.loadPerCore <= st.maxLoadPerCore;
  const memOk = st.memAvailablePct === null || st.memAvailablePct >= st.minMemAvailablePct;
  return { slotsFree: st.maxConcurrent - st.liveAgentCount, hostOk: !st.enabled || (loadOk && memOk) };
}

/** Kuota engine yang AKAN dipakai sesi pekerja; jendela aktif terpakai terbesar. */
async function prodQuota(): Promise<{ status: "ok" | "error"; maxUsedPct: number }> {
  const { agent } = await sessionAgentDefaults();
  const dto = agent === "codex" ? await getCodexLimits()
    : agent === "antigravity" ? await getAntigravityLimits() : await getLimits();
  if (dto.status !== "ok") return { status: "error", maxUsedPct: 0 };
  return { status: "ok", maxUsedPct: Math.max(0, ...dto.windows.map((w) => w.usedPct)) };
}

export const prodBudgetDeps: BudgetDeps = {
  cfg: getLead,
  status: prodStatus,
  quota: () => prodQuota().catch(() => ({ status: "error" as const, maxUsedPct: 0 })),
  leadItems: (projectId) => prisma.schedulerQueueItem.findMany({
    where: { projectId, source: "lead", launchedAt: { not: null } },
    orderBy: { launchedAt: "desc" }, take: 20, select: { status: true, launchedAt: true },
  }),
  now: Date.now,
};

export async function launchBudget(projectId: string, deps: BudgetDeps = prodBudgetDeps): Promise<Budget> {
  const lead = await deps.cfg();
  const cfg = leadProjectConfig(lead, projectId);
  const [status, quota, items] = await Promise.all([deps.status(), deps.quota(), deps.leadItems(projectId)]);
  const probeMs = cfg.rampProbeMin * 60_000;
  const inProbe = items.filter((i) => i.status === "launched" && i.launchedAt
    && deps.now() - i.launchedAt.getTime() < probeMs).length;
  let failStreak = 0;
  for (const i of items) { if (i.status === "failed") failStreak++; else if (i.status !== "launched") break; else break; }
  return computeBudget({ ...status, quota, inProbe, failStreak, cfg });
}
```

Catatan untuk implementer: `hostLoad` — cari pembaca beban host yang dipakai `session-launch-gate.ts`/`createLaunchGate` (`session-admission.ts:58`) dan impor fungsi yang sama; jangan menulis pembaca kedua. Nama `getCodexLimits`/`getAntigravityLimits` mengembalikan DTO dengan `status`+`windows` (`shared/src/dto.ts:685-697`); bila tipe DTO codex/antigravity berbeda, petakan ke `{status, windows}` di `prodQuota` saja. Cek nilai `Agent` untuk antigravity di `shared/src/enums.ts` dan pakai literal yang benar.

- [x] **Step 4: Test → PASS.**
- [x] **Step 5: Commit** `feat(lead): jatah peluncuran — slot, host, kuota, ramp, pemutus beruntun`

### Task 4: `verify.ts` + pengetatan `integrate-main`

**Files:**
- Create: `server/src/services/lead/verify.ts`
- Modify: `server/src/services/lead/apply.ts:130-174` (`integrateMain`), `ApplyDeps`
- Test: `server/test/lead-verify.test.ts` (create), `server/test/lead-apply.test.ts` (modify)

**Interfaces:**
- Produces:
  - `runVerify(cwd: string, command: string, timeoutMs: number): Promise<{ ok: boolean; code: number | null; tail: string }>`
  - `ApplyDeps` += `verify: typeof runVerify; dirty: (cwd: string) => Promise<boolean>; targetOf: (projectId: string) => Promise<{ branch: string; verifyCommand: string }>`
  - `integrateMain` mengembalikan `ApplyResult` dengan `detail` diawali kode penolakan (`plan-open:`, `worktree-dirty:`, `verify-failed:`, `conflict:`, `integrate-busy:`) supaya Task 11 bisa memetakan ke event `integrate-failed`.
  - `export const integrateLocks: Set<string>` (mutex per proyek, in-process)

- [ ] **Step 1: Test gagal**

`server/test/lead-verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerify } from "../src/services/lead/verify";

const dir = mkdtempSync(join(tmpdir(), "lead-verify-"));
describe("runVerify", () => {
  it("hijau untuk exit 0", async () => {
    expect((await runVerify(dir, "echo ok", 5000)).ok).toBe(true);
  });
  it("merah + ekor keluaran untuk exit ≠ 0", async () => {
    const r = await runVerify(dir, "echo gagal-test >&2; exit 3", 5000);
    expect(r).toMatchObject({ ok: false, code: 3 });
    expect(r.tail).toContain("gagal-test");
  });
  it("merah saat melewati batas waktu", async () => {
    expect((await runVerify(dir, "sleep 5", 200)).ok).toBe(false);
  });
});
```

Tambah ke `server/test/lead-apply.test.ts` (perluas `harness` dengan deps baru: `verify: async () => ({ ok: true, code: 0, tail: "" })`, `dirty: async () => false`, `targetOf: async () => ({ branch: "develop", verifyCommand: "pnpm test" })`):

```ts
describe("integrate-main diperketat (ADR-0228)", () => {
  it("menolak worktree kotor", async () => {
    const h = harness({ dirty: async () => true });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(false);
    expect(r.detail.startsWith("worktree-dirty:")).toBe(true);
    expect(h.t.integrated).toEqual([]);
  });
  it("menolak saat test merah, walau requireGreenBeforeIntegrate dimatikan", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: true, requireGreenBeforeIntegrate: false });
    const h = harness({ verify: async () => ({ ok: false, code: 1, tail: "1 failed" }) });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.detail.startsWith("verify-failed:")).toBe(true);
    expect(h.t.integrated).toEqual([]);
  });
  it("mengintegrasikan ke branch target proyek, bukan main terpatok", async () => {
    const seen: string[] = [];
    const h = harness({ integrate: (async (_r: string, _s: string, _op: string, target: string) => { seen.push(target); return { status: "clean", detail: "ok" }; }) as never });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(true);
    expect(seen).toEqual(["local:develop"]);
  });
});
```

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi**

`server/src/services/lead/verify.ts`:

```ts
import { spawn } from "node:child_process";

// ADR-0228 · bukti hijau dijalankan SERVER, bukan diklaim lead. Asinkron + timeout: integrasi
// dipanggil dari jalur request/tick; spawnSync akan memblokir event loop (SPEC-197).
export function runVerify(cwd: string, command: string, timeoutMs: number):
  Promise<{ ok: boolean; code: number | null; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (b: Buffer) => { out = (out + b.toString()).slice(-4000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !signal, code, tail: signal ? `${out}\n[dihentikan: ${signal}]` : out });
    });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, code: null, tail: e.message }); });
  });
}
```

Catatan: env server bisa berisi `HANOMAN_*` (memori proyek: test server gagal 404 bila env itu bocor). Hapus kunci `HANOMAN_SESSION_ID`, `HANOMAN_EVENT_*`, `HANOMAN_CONTROL_ORIGINS`, `HANOMAN_SUPERVISOR`, `HANOMAN_WEB_DIR` dari `env` yang diteruskan ke `spawn`.

Di `apply.ts`: tambah ke `ApplyDeps` dan `prodApplyDeps`:

```ts
  verify: typeof runVerify;
  dirty: (cwd: string) => Promise<boolean>;
  targetOf: (projectId: string) => Promise<{ branch: string; verifyCommand: string }>;
```

```ts
  verify: runVerify,
  dirty: async (cwd) => {
    const r = await execFileAsync("git", ["status", "--porcelain"], { cwd }).catch(() => ({ stdout: "?" }));
    return r.stdout.trim().length > 0;
  },
  targetOf: async (projectId) => {
    const p = leadProjectConfig(await getLead(), projectId);
    return { branch: p.targetBranch, verifyCommand: p.verifyCommand };
  },
```

(`execFileAsync = promisify(execFile)` dari `node:child_process`/`node:util`.)

Ganti badan `integrateMain` (pertahankan komentar AC-19/SPEC-451 yang ada, ganti paragraf OQ-3 dengan rujukan ADR-0228):

```ts
export const integrateLocks = new Set<string>();

async function integrateMain(row: LeadDecision, deps: ApplyDeps): Promise<ApplyResult> {
  if (!row.specId || !row.sessionId) return { ok: false, detail: "no-session: keputusan ini tak menunjuk sesi/backlog" };
  const repoDir = await deps.repoDir(row.projectId);
  if (!repoDir) return { ok: false, detail: "no-session: project belum di-bind ke checkout lokal" };
  const cwd = worktreeDir(repoDir, row.specId);
  // ADR-0228 · syarat objektif TAK BISA dimatikan untuk jalur lead (`requireGreenBeforeIntegrate`
  // diabaikan di sini). Urutan: murah → mahal.
  if (!deps.planDone(cwd, row.specId)) return { ok: false, detail: "plan-open: plan masih menyisakan `- [ ]`" };
  if (await deps.dirty(cwd)) return { ok: false, detail: "worktree-dirty: worktree punya perubahan belum di-commit" };
  if (integrateLocks.has(row.projectId)) return { ok: false, detail: "integrate-busy: integrasi lain sedang berjalan di proyek ini" };
  integrateLocks.add(row.projectId);
  try {
    const target = await deps.targetOf(row.projectId);
    if (target.verifyCommand) {
      const v = await deps.verify(cwd, target.verifyCommand, 15 * 60_000);
      if (!v.ok) return { ok: false, detail: `verify-failed: \`${target.verifyCommand}\` keluar ${v.code}\n${v.tail.slice(-1500)}` };
    }
    const r = await deps.integrate(repoDir, row.specId, "merge", `local:${target.branch}`);
    if (r.status === "conflict") return { ok: false, detail: `conflict: konflik terhadap ${target.branch} — worktree ${r.worktree}` };
    if (r.status === "error") return { ok: false, detail: `conflict: integrasi gagal (${r.code}) ${r.error}` };
    if (deps.sessionExists(row.sessionId)) deps.killSession(row.sessionId);
    return { ok: true, detail: `terintegrasi ke ${target.branch}; pane dilepas, worktree utuh` };
  } finally {
    integrateLocks.delete(row.projectId);
  }
}
```

Sebelum mengganti, baca `apply.ts:130-174` yang asli dan pertahankan perilaku yang tak disebut di atas (mis. format catatan bukti `Bukti integrasi:` pada `detail`, pengecekan pane masih ada). `worktreeDir` sudah diimpor dari `../spec-review`. Bila `verifyCommand` kosong, integrasi tetap jalan di sini — kewajiban izin untuk kasus itu ditegakkan `guard.ts` (Task 5), bukan eksekutor.

- [ ] **Step 4: Test → PASS** (`server/test/lead-verify.test.ts server/test/lead-apply.test.ts`).
- [ ] **Step 5: Commit** `feat(lead): integrasi lead diperketat — test dijalankan server, worktree bersih, branch target, mutex`

### Task 5: `guard.ts`

**Files:**
- Create: `server/src/services/lead/guard.ts`
- Test: `server/test/lead-guard.test.ts`

**Interfaces:**
- Consumes: `authorityFor`, `leadProjectConfig` (Task 3), `launchBudget` (Task 3), `isSensitiveText`, `LeadRefusalCode`, `leadActionAllowed` (shared), `blockersForSpec` (`server/src/services/spec-deps.ts:134`), `assertLaunchApproved` (`server/src/services/launch-authority.ts:28`), `planComplete`, `sessionIdForSpec`.
- Produces:
  - `type GuardInput = { projectId: string; eventKind: LeadEventKind; eventOpen: boolean; action: string; specId: string | null; sessionId: string | null; decision: string; choices: string[]; reason: string; evidence: string[] }`
  - `type GuardResult = { outcome: "lolos" | "butuh-izin" | "ditolak"; code?: LeadRefusalCode; report: string[] }`
  - `checkAct(i: GuardInput, deps?: GuardDeps): Promise<GuardResult>`
  - `type GuardDeps = { cfg: () => Promise<Lead>; budget: (projectId: string) => Promise<Budget>; spec: (id: string) => Promise<GuardSpec | null>; blockers: (spec: GuardSpec) => Promise<string[]>; sessionLive: (id: string) => boolean; sessionWaiting: (id: string) => boolean; approved: (spec: GuardSpec) => boolean }`
  - `type GuardSpec = { id: string; projectId: string; stage: string; baseSha: string | null; objective: string; launchApprovedAt: Date | null; dependsOn: unknown; branchFrom: string | null }`

- [ ] **Step 1: Test gagal**

```ts
import { describe, it, expect } from "vitest";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { checkAct, type GuardDeps, type GuardInput } from "../src/services/lead/guard";

const spec = { id: "SPEC-1", projectId: "p", stage: "spec-ready", baseSha: null, objective: "o", launchApprovedAt: new Date(), dependsOn: [], branchFrom: null };
const deps = (over: Partial<GuardDeps> = {}): GuardDeps => ({
  cfg: async () => LEAD_DEFAULTS,
  budget: async () => ({ n: 1, reasons: [], tripped: false }),
  spec: async () => spec,
  blockers: async () => [],
  sessionLive: () => false,
  sessionWaiting: () => true,
  approved: () => true,
  ...over,
});
const inp = (over: Partial<GuardInput> = {}): GuardInput => ({
  projectId: "p", eventKind: "pulse", eventOpen: true, action: "start-session", specId: "SPEC-1",
  sessionId: null, decision: "mulai SPEC-1", choices: [], reason: "paling mendesak", evidence: ["SPEC-1"], ...over,
});

describe("checkAct", () => {
  it("event tertutup selalu ditolak", async () => {
    expect((await checkAct(inp({ eventOpen: false }), deps())).code).toBe("event-closed");
  });
  it("tindakan di luar allowlist ditolak", async () => {
    expect((await checkAct(inp({ action: "deploy" }), deps())).code).toBe("action-locked");
  });
  it("start-session: jatah 0 → budget-zero", async () => {
    const r = await checkAct(inp(), deps({ budget: async () => ({ n: 0, reasons: ["kuota 90%"], tripped: false }) }));
    expect(r).toMatchObject({ outcome: "ditolak", code: "budget-zero" });
    expect(r.report.join(" ")).toContain("kuota 90%");
  });
  it("start-session: blocker, sesi hidup, tanpa alasan/bukti", async () => {
    expect((await checkAct(inp(), deps({ blockers: async () => ["SPEC-0"] }))).code).toBe("blocked");
    expect((await checkAct(inp(), deps({ sessionLive: () => true }))).code).toBe("session-live");
    expect((await checkAct(inp({ reason: " " }), deps())).code).toBe("no-reason");
    expect((await checkAct(inp({ evidence: ["docs/x.md"] }), deps())).code).toBe("no-evidence");
    expect((await checkAct(inp(), deps({ approved: () => false }))).code).toBe("spec-not-approved");
  });
  it("start-session lolos saat semua syarat terpenuhi", async () => {
    expect((await checkAct(inp(), deps())).outcome).toBe("lolos");
  });
  it("answer-session: sensitif → butuh-izin walau mode auto", async () => {
    const r = await checkAct(inp({ eventKind: "ask", action: "answer-session", sessionId: "spec-1",
      decision: "Bootstrap director sementara di staging", choices: ["Bootstrap director sementara"] }), deps());
    expect(r.outcome).toBe("butuh-izin");
  });
  it("answer-session: sesi tak lagi menunggu → not-waiting", async () => {
    const r = await checkAct(inp({ eventKind: "ask", action: "answer-session", sessionId: "spec-1" }), deps({ sessionWaiting: () => false }));
    expect(r.code).toBe("not-waiting");
  });
  it("integrate-main default butuh-izin; auto + verifyCommand kosong tetap butuh-izin", async () => {
    const i = inp({ eventKind: "session-ended", action: "integrate-main", sessionId: "spec-1" });
    expect((await checkAct(i, deps())).outcome).toBe("butuh-izin");
    const auto = { ...LEAD_DEFAULTS, projects: { p: { authority: { "integrate-main": "auto" as const } } } };
    const r = await checkAct(i, deps({ cfg: async () => auto }));
    expect(r.outcome).toBe("butuh-izin");
    expect(r.report.join(" ")).toContain("tak ada perintah verifikasi");
    const withVerify = { ...LEAD_DEFAULTS, projects: { p: { verifyCommand: "pnpm test", authority: { "integrate-main": "auto" as const } } } };
    expect((await checkAct(i, deps({ cfg: async () => withVerify }))).outcome).toBe("lolos");
  });
  it("mode off menolak", async () => {
    const off = { ...LEAD_DEFAULTS, projects: { p: { authority: { "start-session": "off" as const } } } };
    expect((await checkAct(inp(), deps({ cfg: async () => off }))).code).toBe("authority-off");
  });
});
```

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi** `server/src/services/lead/guard.ts`:

```ts
import { isSensitiveText, leadActionAllowed, type Lead, type LeadAction, type LeadEventKind, type LeadRefusalCode } from "@hanoman/shared";
import { prisma } from "../../db";
import { getLead } from "./config";
import { authorityFor, leadProjectConfig } from "./project-config";
import { launchBudget, type Budget } from "./budget";
import { blockersForSpec } from "../spec-deps";
import { resolveRepoDir } from "../local-binding";
import { assertLaunchApproved } from "../launch-authority";
import { getSession } from "../pty";
import { liveAsks } from "./ask";

// ADR-0228 · GERBANG TINDAKAN LEAD. Deterministik, di server, tak bisa dilewati pane lead. Lead
// boleh salah menilai; ia tak boleh salah BERTINDAK. Urutan: event → allowlist → aturan objektif
// → wewenang. Aturan objektif dinilai lebih dulu supaya `butuh-izin` tak pernah diminta untuk
// tindakan yang mustahil lolos.

export type GuardSpec = {
  id: string; projectId: string; stage: string; baseSha: string | null; objective: string;
  launchApprovedAt: Date | null; dependsOn: unknown; branchFrom: string | null;
};
export type GuardInput = {
  projectId: string; eventKind: LeadEventKind; eventOpen: boolean; action: string;
  specId: string | null; sessionId: string | null; decision: string; choices: string[];
  reason: string; evidence: string[];
};
export type GuardResult = { outcome: "lolos" | "butuh-izin" | "ditolak"; code?: LeadRefusalCode; report: string[] };
export type GuardDeps = {
  cfg: () => Promise<Lead>;
  budget: (projectId: string) => Promise<Budget>;
  spec: (id: string) => Promise<GuardSpec | null>;
  blockers: (spec: GuardSpec) => Promise<string[]>;
  sessionLive: (id: string) => boolean;
  sessionWaiting: (id: string) => boolean;
  approved: (spec: GuardSpec) => boolean;
};

export const prodGuardDeps: GuardDeps = {
  cfg: getLead,
  budget: (p) => launchBudget(p),
  spec: (id) => prisma.spec.findUnique({ where: { id }, select: {
    id: true, projectId: true, stage: true, baseSha: true, objective: true,
    launchApprovedAt: true, dependsOn: true, branchFrom: true } }),
  blockers: async (s) => (await blockersForSpec(s, await resolveRepoDir(s.projectId))).map((b) => b.id),
  sessionLive: (id) => { try { const s = getSession(id); return !!s && !s.exited; } catch { return false; } },
  sessionWaiting: (id) => liveAsks().some((a) => a.sessionId === id),
  approved: (s) => { try { assertLaunchApproved(s); return true; } catch { return false; } },
};

const no = (code: LeadRefusalCode, ...report: string[]): GuardResult => ({ outcome: "ditolak", code, report });

export async function checkAct(i: GuardInput, deps: GuardDeps = prodGuardDeps): Promise<GuardResult> {
  if (!i.eventOpen) return no("event-closed", "event sudah ditutup (dijawab manusia atau lewat tenggat)");
  if (!leadActionAllowed(i.action)) return no("action-locked", `tindakan "${i.action}" di luar permukaan tindakan lead`);
  const action = i.action as LeadAction;
  const cfg = await deps.cfg();
  const mode = authorityFor(cfg, i.projectId, action);
  if (mode === "off") return no("authority-off", `wewenang "${action}" dimatikan untuk proyek ini`);
  const report: string[] = [];
  let mustAsk = mode === "ask";
  if (mustAsk) report.push(`wewenang "${action}" = minta izin`);

  switch (action) {
    case "start-session": {
      if (!i.reason.trim()) return no("no-reason", "alasan kosong");
      if (!i.specId) return no("spec-empty", "tak menunjuk backlog");
      if (!i.evidence.some((e) => e.toLowerCase().includes(i.specId!.toLowerCase())))
        return no("no-evidence", `bukti tak merujuk ${i.specId} — baca spec/plan-nya dulu`);
      const s = await deps.spec(i.specId);
      if (!s || s.projectId !== i.projectId) return no("spec-empty", `backlog ${i.specId} tak ada di proyek ini`);
      if (s.stage === "done") return no("spec-done", `${s.id} sudah selesai`);
      if (!s.objective.trim()) return no("spec-empty", `${s.id} belum punya objective`);
      if (!deps.approved(s)) return no("spec-not-approved", `${s.id} belum disetujui untuk diluncurkan`);
      const blocked = await deps.blockers(s);
      if (blocked.length) return no("blocked", `menunggu ${blocked.join(", ")}`);
      if (deps.sessionLive(sessionIdOf(s.id))) return no("session-live", `${s.id} sudah punya sesi hidup`);
      const b = await deps.budget(i.projectId);
      if (b.n < 1) return no("budget-zero", ...b.reasons);
      report.push(`jatah tersisa ${b.n}`);
      break;
    }
    case "answer-session": {
      if (!i.sessionId) return no("no-session", "tak menunjuk sesi");
      if (!deps.sessionWaiting(i.sessionId)) return no("not-waiting", `sesi ${i.sessionId} tak lagi menunggu jawaban`);
      const text = [i.decision, ...i.choices].join(" \n ");
      if (isSensitiveText(text)) { mustAsk = true; report.push("jawaban menyentuh daftar sensitif"); }
      break;
    }
    case "integrate-main": {
      if (!i.sessionId || !i.specId) return no("no-session", "tak menunjuk sesi/backlog");
      if (!leadProjectConfig(cfg, i.projectId).verifyCommand.trim()) {
        mustAsk = true; report.push("tak ada perintah verifikasi — test tak bisa dibuktikan server");
      }
      break;
    }
    case "stop-session": case "resume-session": case "restart-session": {
      if (!i.sessionId && !i.specId) return no("no-session", "tak menunjuk sesi/backlog");
      break;
    }
    default: break;
  }
  return { outcome: mustAsk ? "butuh-izin" : "lolos", report };
}

function sessionIdOf(specId: string): string {
  // Satu definisi id sesi spec: `server/src/services/session-id.ts`.
  return sessionIdForSpec(specId);
}
import { sessionIdForSpec } from "../session-id";
```

Rapikan: pindahkan `import { sessionIdForSpec }` ke blok impor atas dan hapus helper `sessionIdOf` bila tak perlu. `blockersForSpec` mengembalikan `SpecBlocker[]` — cek field id-nya (`spec-deps.ts:13`) dan sesuaikan `.map`. `liveAsks()` mengembalikan `SessionAsk[]` dengan `sessionId` (`ask.ts:114`).

- [ ] **Step 4: Test → PASS.**
- [ ] **Step 5: Commit** `feat(lead): guard tindakan — allowlist, aturan objektif, sensitif, wewenang per proyek`

---

## Fase 3 — Inbox, think-seam, approval

### Task 6: `inbox.ts` (event + waiter + batch + sapuan)

**Files:**
- Create: `server/src/services/lead/inbox.ts`
- Test: `server/test/lead-inbox.test.ts`

**Interfaces:**
- Produces:
  - `openEvent(i: { projectId: string; kind: LeadEventKind; question: string; payload: LeadEventPayload; sessionId?: string | null; specId?: string | null; deadlineMs?: number | null }): Promise<LeadEvent>` — juga memanggil `onEventOpened` (hook courier, set di Task 9)
  - `type LeadEventPayload = { prompt: string; gate: LeadGate; leadKind: LeadKind; options: string[]; select: LeadSelect | null; mode?: "wait" | "post"; request?: PostedRequest; flowId?: string; step?: number }` — `mode: "post"` = tak ada penunggu; dieksekusi saat `act`/izin (Task 7b). `PostedRequest` didefinisikan di Task 7b; di Task 6 cukup `request?: unknown`.
  - `awaitEvent(id: string, timeoutMs: number): Promise<{ status: "answered"; verdict: LeadVerdict; evidence: string[] } | { status: "late" | "human" | "rejected" }>`
  - `resolveEvent(id: string, r: { verdict: LeadVerdict; evidence: string[]; decisionId?: string }): Promise<boolean>` (open/delivered → done; men-resolve waiter)
  - `closeEvent(id: string, status: "late" | "human" | "rejected"): Promise<boolean>`
  - `isEventOpen(id: string): Promise<boolean>`
  - `pendingBatch(projectId: string): Promise<LeadEvent[]>` (status open, urut priority asc, createdAt asc)
  - `markDelivered(ids: string[]): Promise<void>`
  - `sweepInbox(now: number, deliverTimeoutMs: number): Promise<{ late: number; requeued: number }>` — open/delivered lewat `deadlineAt` → `late` (+ waiter "late"); delivered lebih lama dari `deliverTimeoutMs` → `open`, `attempts++`
  - `setEventOpenedHook(fn: (projectId: string) => void): void`
  - `toEventView(e: LeadEvent): LeadEventView`
  - `__resetInbox(): void`

- [ ] **Step 1: Test gagal**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  openEvent, awaitEvent, resolveEvent, closeEvent, pendingBatch, markDelivered, sweepInbox,
  isEventOpen, setEventOpenedHook, __resetInbox,
} from "../src/services/lead/inbox";

const payload = { prompt: "p", gate: "detected" as const, leadKind: "answer" as const, options: [], select: null };
const verdict = { decision: "d", reason: "r", refs: [], confidence: "tinggi" as const, action: "none", choice: "", choices: [], missing: [] };
beforeEach(async () => { await prisma.leadEvent.deleteMany(); __resetInbox(); });
afterAll(async () => { await prisma.leadEvent.deleteMany(); });

describe("inbox lead", () => {
  it("batch diurutkan prioritas kelas lalu umur", async () => {
    await openEvent({ projectId: "p", kind: "pulse", question: "denyut", payload });
    await openEvent({ projectId: "p", kind: "ask", question: "tanya", payload });
    await openEvent({ projectId: "q", kind: "ask", question: "lain", payload });
    expect((await pendingBatch("p")).map((e) => e.question)).toEqual(["tanya", "denyut"]);
  });
  it("waiter selesai saat event dijawab", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    const w = awaitEvent(e.id, 5000);
    expect(await resolveEvent(e.id, { verdict, evidence: ["a"] })).toBe(true);
    expect(await w).toMatchObject({ status: "answered", evidence: ["a"] });
    expect(await isEventOpen(e.id)).toBe(false);
  });
  it("jawaban ganda ditolak; event yang diambil manusia tertutup untuk lead", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    expect(await closeEvent(e.id, "human")).toBe(true);
    expect(await resolveEvent(e.id, { verdict, evidence: [] })).toBe(false);
  });
  it("waiter kembali late saat batas waktu", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    expect(await awaitEvent(e.id, 50)).toEqual({ status: "late" });
  });
  it("sapuan: tenggat lewat → late; terkirim kelamaan → open lagi", async () => {
    const a = await openEvent({ projectId: "p", kind: "ask", question: "a", payload, deadlineMs: Date.now() - 1 });
    const b = await openEvent({ projectId: "p", kind: "pulse", question: "b", payload });
    await markDelivered([b.id]);
    await prisma.leadEvent.update({ where: { id: b.id }, data: { deliveredAt: new Date(Date.now() - 700_000) } });
    const r = await sweepInbox(Date.now(), 600_000);
    expect(r).toEqual({ late: 1, requeued: 1 });
    expect((await prisma.leadEvent.findUnique({ where: { id: a.id } }))?.status).toBe("late");
    expect((await prisma.leadEvent.findUnique({ where: { id: b.id } }))).toMatchObject({ status: "open", attempts: 1 });
  });
  it("membangunkan courier saat event dibuka", async () => {
    const seen: string[] = [];
    setEventOpenedHook((p) => seen.push(p));
    await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    expect(seen).toEqual(["p"]);
  });
});
```

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi** `server/src/services/lead/inbox.ts`:

```ts
import type { LeadEvent, Prisma } from "@prisma/client";
import {
  LEAD_EVENT_PRIORITY, type LeadEventKind, type LeadEventView, type LeadGate, type LeadKind,
  type LeadSelect, type LeadVerdict,
} from "@hanoman/shared";
import { prisma } from "../../db";

// ADR-0228 · INBOX SESI LEAD. Barisnya di DB (selamat dari restart); yang in-memory hanya waiter —
// janji milik pemanggil yang sedang menunggu di proses ini. Restart memutus waiter, dan itu benar:
// pemanggilnya (rantai dialog, route kontrak) ikut mati bersama proses.

export type LeadEventPayload = {
  prompt: string; gate: LeadGate; leadKind: LeadKind; options: string[]; select: LeadSelect | null;
  // ADR-0228 · `post` = event TANPA penunggu (denyut/tindak lanjut sesi): dieksekusi saat `act`
  // atau saat izin disetujui — bukan oleh pemanggil yang menunggu. Lihat Task 7b.
  mode?: "wait" | "post";
  request?: unknown;
  flowId?: string;
  step?: number;
};
type Outcome =
  | { status: "answered"; verdict: LeadVerdict; evidence: string[] }
  | { status: "late" | "human" | "rejected" };

const waiters = new Map<string, (o: Outcome) => void>();
let opened: (projectId: string) => void = () => {};
export function setEventOpenedHook(fn: (projectId: string) => void): void { opened = fn; }
export function __resetInbox(): void { waiters.clear(); opened = () => {}; }

const OPEN = ["open", "delivered"];

export async function openEvent(i: {
  projectId: string; kind: LeadEventKind; question: string; payload: LeadEventPayload;
  sessionId?: string | null; specId?: string | null; deadlineMs?: number | null;
}): Promise<LeadEvent> {
  const e = await prisma.leadEvent.create({ data: {
    projectId: i.projectId, kind: i.kind, priority: LEAD_EVENT_PRIORITY[i.kind],
    question: i.question.slice(0, 2000), payload: i.payload as unknown as Prisma.InputJsonValue,
    sessionId: i.sessionId ?? null, specId: i.specId ?? null,
    deadlineAt: i.deadlineMs ? new Date(i.deadlineMs) : null,
  } });
  try { opened(i.projectId); } catch { /* courier gagal dibangunkan; tick berikutnya menyusul */ }
  return e;
}

export function awaitEvent(id: string, timeoutMs: number): Promise<Outcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      void closeEvent(id, "late").finally(() => resolve({ status: "late" }));
    }, timeoutMs);
    waiters.set(id, (o) => { clearTimeout(timer); waiters.delete(id); resolve(o); });
  });
}

/** Tutup atomik: hanya baris yang MASIH terbuka yang berpindah — jawaban ganda kalah di sini. */
async function transition(id: string, data: Prisma.LeadEventUpdateManyMutationInput): Promise<boolean> {
  const r = await prisma.leadEvent.updateMany({ where: { id, status: { in: OPEN } }, data });
  return r.count === 1;
}

export async function resolveEvent(id: string, r: { verdict: LeadVerdict; evidence: string[]; decisionId?: string }): Promise<boolean> {
  const ok = await transition(id, { status: "done", closedAt: new Date(), decisionId: r.decisionId ?? null });
  if (ok) waiters.get(id)?.({ status: "answered", verdict: r.verdict, evidence: r.evidence });
  return ok;
}

export async function closeEvent(id: string, status: "late" | "human" | "rejected"): Promise<boolean> {
  const ok = await transition(id, { status: status === "rejected" ? "done" : status, closedAt: new Date() });
  if (ok) waiters.get(id)?.({ status });
  return ok;
}

export async function isEventOpen(id: string): Promise<boolean> {
  return !!(await prisma.leadEvent.findFirst({ where: { id, status: { in: OPEN } }, select: { id: true } }));
}

export function pendingBatch(projectId: string): Promise<LeadEvent[]> {
  return prisma.leadEvent.findMany({
    where: { projectId, status: "open" }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: 20,
  });
}

export async function markDelivered(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.leadEvent.updateMany({ where: { id: { in: ids }, status: "open" }, data: { status: "delivered", deliveredAt: new Date() } });
}

export async function sweepInbox(now: number, deliverTimeoutMs: number): Promise<{ late: number; requeued: number }> {
  const due = await prisma.leadEvent.findMany({
    where: { status: { in: OPEN }, deadlineAt: { lt: new Date(now) } }, select: { id: true },
  });
  let late = 0;
  for (const e of due) if (await closeEvent(e.id, "late")) late++;
  const stale = await prisma.leadEvent.updateMany({
    where: { status: "delivered", deliveredAt: { lt: new Date(now - deliverTimeoutMs) } },
    data: { status: "open", deliveredAt: null, attempts: { increment: 1 } },
  });
  return { late, requeued: stale.count };
}

export function toEventView(e: LeadEvent): LeadEventView {
  return {
    id: e.id, projectId: e.projectId, kind: e.kind as LeadEventView["kind"], status: e.status as LeadEventView["status"],
    priority: e.priority, question: e.question, specId: e.specId, sessionId: e.sessionId,
    deadlineAt: e.deadlineAt?.toISOString() ?? null, deliveredAt: e.deliveredAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(), decisionId: e.decisionId,
  };
}
```

`LeadGate`, `LeadKind`, `LeadSelect` sudah diekspor `@hanoman/shared` (dipakai `decide.ts:28-44`); verifikasi nama persisnya dengan `grep -n "export type Lead\(Gate\|Kind\|Select\)" shared/src/lead.ts`.

- [ ] **Step 4: Test → PASS.**
- [ ] **Step 5: Commit** `feat(lead): inbox event persisten + waiter + batch berprioritas + sapuan tenggat`

### Task 7: `thinkViaSession` + `decide()` tanpa `runGated`

**Files:**
- Create: `server/src/services/lead/session-think.ts`
- Modify: `server/src/services/lead/decide.ts:44-60` (`DecideDeps`, `prodDecideDeps`), `:150-180` (blok `runGated`)
- Test: `server/test/lead-session-think.test.ts` (create); `server/test/lead-decide.test.ts` (modify)

**Interfaces:**
- Consumes: `openEvent`, `awaitEvent` (Task 6), `leadProjectConfig` (Task 3), `ensureLeadSession` (Task 8 — disuntik sebagai dep, default no-op sampai Task 8)
- Produces:
  - `DecideDeps.think` berubah bentuk: `(prompt: string, o: ThinkCtx) => Promise<string>` dengan `type ThinkCtx = { projectId: string; gate: LeadGate; kind: LeadKind; question: string; options: string[]; select: LeadSelect | null; sessionId: string | null; specId: string | null; timeoutMs: number }`
  - `thinkViaSession(prompt: string, o: ThinkCtx, deps?: SessionThinkDeps): Promise<string>` — mengembalikan JSON string `zLeadVerdict` (+ `evidence` diabaikan verdict), atau melempar `LeadLateError` / `LeadRejectedError`
  - `class LeadLateError extends Error`, `class LeadRejectedError extends Error`
  - `eventKindFor(gate: LeadGate, kind: LeadKind): LeadEventKind` — `detected`/`contract` → `ask`, `pulse`+`quality` → `session-ended`, `pulse`+`order` → `pulse`, lainnya → `human`
  - Waktu: `ask` → `answerSlaSec` proyek; lainnya → `deliverTimeoutSec` × 2.

- [ ] **Step 1: Test gagal**

`server/test/lead-session-think.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { thinkViaSession, LeadLateError, eventKindFor } from "../src/services/lead/session-think";
import { pendingBatch, resolveEvent, __resetInbox } from "../src/services/lead/inbox";

beforeEach(async () => { await prisma.leadEvent.deleteMany(); __resetInbox(); });
const ctx = { projectId: "p", gate: "detected" as const, kind: "answer" as const, question: "Pilih A atau B?",
  options: ["A", "B"], select: null, sessionId: "spec-1", specId: "SPEC-1", timeoutMs: 2000 };

describe("thinkViaSession", () => {
  it("menulis event lalu mengembalikan verdict yang dijawab pane", async () => {
    const started: string[] = [];
    const p = thinkViaSession("PROMPT", ctx, { ensure: async (id) => { started.push(id); } });
    await new Promise((r) => setTimeout(r, 20));
    const [e] = await pendingBatch("p");
    expect(e.kind).toBe("ask");
    expect((e.payload as { prompt: string }).prompt).toBe("PROMPT");
    await resolveEvent(e.id, { verdict: { decision: "A", reason: "r", refs: [], confidence: "tinggi", action: "answer-session", choice: "A", choices: [], missing: [] }, evidence: [] });
    expect(JSON.parse(await p).decision).toBe("A");
    expect(started).toEqual(["p"]);
  });
  it("melempar LeadLateError saat tenggat lewat", async () => {
    await expect(thinkViaSession("P", { ...ctx, timeoutMs: 30 }, { ensure: async () => {} })).rejects.toBeInstanceOf(LeadLateError);
  });
  it("memetakan pintu ke jenis event", () => {
    expect(eventKindFor("contract", "answer")).toBe("ask");
    expect(eventKindFor("pulse", "quality")).toBe("session-ended");
    expect(eventKindFor("pulse", "order")).toBe("pulse");
  });
});
```

Di `server/test/lead-decide.test.ts`: cari setiap `think:` palsu dan sesuaikan tanda tangan opsi ke `ThinkCtx`; hapus test yang menguji `LeadBusyError`/`runGated` (pindahkan cakupan "tenggat lewat → baris `gagal`" ke test baru di file itu):

```ts
it("tenggat sesi lead lewat → baris gagal, alasan menyebut manusia", async () => {
  const row = await decide(req, { ...deps, think: async () => { throw new LeadLateError("tenggat 300 dtk lewat — diserahkan ke manusia"); } });
  expect(row?.status).toBe("gagal");
  expect(row?.reason).toContain("manusia");
});
```

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi**

`server/src/services/lead/session-think.ts`:

```ts
import type { LeadEventKind, LeadGate, LeadKind, LeadSelect } from "@hanoman/shared";
import { getLead } from "./config";
import { leadProjectConfig } from "./project-config";
import { openEvent, awaitEvent } from "./inbox";

// ADR-0228 · OTAK = SESI. Pengganti `brain.think`: prompt yang sama (`leadPrompt`) menjadi satu
// event di inbox, dan jawaban pane (bentuk `zLeadVerdict`) dikembalikan sebagai teks JSON supaya
// `decide()` mem-parse-nya lewat `parseLeadVerdict` persis seperti keluaran `claude -p` dulu.

export class LeadLateError extends Error {}
export class LeadRejectedError extends Error {}

export type ThinkCtx = {
  projectId: string; gate: LeadGate; kind: LeadKind; question: string; options: string[];
  select: LeadSelect | null; sessionId: string | null; specId: string | null; timeoutMs: number;
};
export type SessionThinkDeps = { ensure: (projectId: string) => Promise<void> };

let defaultEnsure: (projectId: string) => Promise<void> = async () => {};
/** Dipasang `lead-session.ts` (Task 8) — menghindari impor sirkular. */
export function setEnsureLeadSession(fn: (projectId: string) => Promise<void>): void { defaultEnsure = fn; }

export function eventKindFor(gate: LeadGate, kind: LeadKind): LeadEventKind {
  if (gate === "detected" || gate === "contract") return "ask";
  if (gate === "pulse" && kind === "order") return "pulse";
  if (gate === "pulse") return "session-ended";
  return "human";
}

/** Tenggat per jenis: pertanyaan pekerja memakai SLA proyek; sisanya dua kali tenggat antar. */
export async function thinkTimeoutMs(projectId: string, gate: LeadGate, kind: LeadKind): Promise<number> {
  const cfg = await getLead();
  return eventKindFor(gate, kind) === "ask"
    ? leadProjectConfig(cfg, projectId).answerSlaSec * 1000
    : cfg.deliverTimeoutSec * 2000;
}

export async function thinkViaSession(prompt: string, o: ThinkCtx,
  deps: SessionThinkDeps = { ensure: (p) => defaultEnsure(p) }): Promise<string> {
  await deps.ensure(o.projectId).catch(() => { /* sesi gagal lahir: event tetap menunggu, tenggat yang memutus */ });
  const e = await openEvent({
    projectId: o.projectId, kind: eventKindFor(o.gate, o.kind), question: o.question,
    payload: { prompt, gate: o.gate, leadKind: o.kind, options: o.options, select: o.select },
    sessionId: o.sessionId, specId: o.specId,
    deadlineMs: eventKindFor(o.gate, o.kind) === "ask" ? Date.now() + o.timeoutMs : null,
  });
  const r = await awaitEvent(e.id, o.timeoutMs);
  if (r.status === "answered") return JSON.stringify(r.verdict);
  if (r.status === "rejected") throw new LeadRejectedError("tindakan lead ditolak manusia — diserahkan ke manusia");
  throw new LeadLateError(`sesi lead tak menjawab dalam ${Math.round(o.timeoutMs / 1000)} dtk — diserahkan ke manusia`);
}
```

Di `decide.ts`:
1. `DecideDeps.think` → `(prompt: string, o: ThinkCtx) => Promise<string>`; `prodDecideDeps.think = thinkViaSession`; hapus `defaults` dari deps bila hanya dipakai untuk `think` (cek pemakai lain).
2. Ganti blok `runGated(...)` (`decide.ts:150-180`) dengan:

```ts
  // ADR-0228 · tak ada lagi gerbang konkurensi: proses mahal kini satu pane per proyek yang
  // hidup terus, dan antreannya adalah inbox (DB), bukan slot in-memory. `markDeciding` tetap
  // dipasang supaya route terminal tahu sesi pekerja sedang ditunggu jawabannya.
  if (req.sessionId) markDeciding(req.sessionId);
  let raw: string;
  try {
    raw = await deps.think(prompt, {
      projectId: req.projectId, gate: req.gate, kind: req.kind, question: req.question,
      options, select: req.select ?? null, sessionId: req.sessionId ?? null, specId: req.specId ?? null,
      timeoutMs: await thinkTimeoutMs(req.projectId, req.gate, req.kind),
    });
  } catch (e) {
    return closeAfter(await fail(req, deps, `lead tak menghasilkan keputusan: ${(e as Error).message}`, flow.id, step), flow.id, req.chain);
  } finally {
    if (req.sessionId) clearDeciding(req.sessionId);
  }
```

3. `timeoutSec` di `LeadContext` (`decide.ts:121`): ganti dengan `await thinkTimeoutMs(...) / 1000` (prompt menyebut anggaran waktu yang sama dengan tenggat sebenarnya — prinsip SPEC-432).
4. Hapus impor `runGated`, `LeadBusyError`, `markQueued`, `clearQueued` dari `decide.ts`. Semua pemakai `LeadBusyError` lain (`pulse.ts` `decideOrSkip`, `routes/lead.ts:131-147`, `detect.ts`, `ask.ts`) diperbarui di Task 15; untuk sekarang biarkan kelasnya tetap diekspor dari `gate.ts` agar kompilasi lulus.
5. Saat `decide()` menulis baris jejak, isi `eventId`: `thinkViaSession` tak mengembalikan id event — tambahkan ke `ThinkCtx` sebuah callback `onEvent?: (id: string) => void` yang `thinkViaSession` panggil setelah `openEvent`, dan `decide()` menyimpan id itu lalu menyertakannya ke `recordDecision` (tambah field `eventId?: string | null` di `TrailInput`, `trail.ts:15`). Setelah baris tercatat, panggil `prisma.leadEvent.update({ where: { id }, data: { decisionId: row.id } })`.

- [ ] **Step 4: Test → PASS** (`server/test/lead-session-think.test.ts server/test/lead-decide.test.ts server/test/lead-detect.test.ts server/test/lead-ask.test.ts server/test/lead-pulse.test.ts`). Perbaiki test lain yang menyuntik `think` dengan tanda tangan lama.
- [ ] **Step 5: Commit** `feat(lead): otak lead = sesi — decide() menulis event inbox dan menunggu jawaban pane`

### Task 7b: Event tanpa penunggu — `postDecision` + `executeEventVerdict`

**Mengapa:** denyut berjalan di tick lead. Bila ia menunggu jawaban pane lewat `decide()` (hingga `deliverTimeoutSec × 2`), seluruh tick macet; dan izin merge yang menunggu manusia berjam-jam akan kedaluwarsa sebelum disetujui. Maka event dari pintu **denyut** (`gate: "pulse"` — sesi selesai/gagal, tabrakan, ambil backlog, integrasi gagal) dan event `rejected` dibuka **tanpa penunggu**: pembukanya langsung kembali; keputusan **dieksekusi saat `act` lolos atau saat izin disetujui**. Pintu `detected`/`contract` tetap memakai penunggu (Task 7) karena peminta memang menunggu jawabannya.

**Files:**
- Modify: `server/src/services/lead/decide.ts` (pecah jadi `prepareDecision` + `finalizeDecision`)
- Create: `server/src/services/lead/post.ts`
- Test: `server/test/lead-post.test.ts`

**Interfaces:**
- Produces (di `decide.ts`):
  - `type PreparedDecision = { req: DecideRequest; flowId: string; step: number; prompt: string; repoDir: string | null; options: string[]; bounds: SelectBounds }`
  - `prepareDecision(req: DecideRequest, deps?: DecideDeps): Promise<PreparedDecision | null>` — seluruh isi `decide()` SEBELUM pemanggilan `think` (gerbang `leadActive`, buka/gabung alur, kumpulkan konteks, susun prompt). `null` = lead tak aktif.
  - `finalizeDecision(p: PreparedDecision, raw: string, deps?: DecideDeps, eventId?: string | null): Promise<LeadDecision>` — seluruh isi `decide()` SESUDAH `think` (parse verdict, saring rujukan, pilihan, tulis jejak, notifikasi, tutup alur).
  - `decide(req, deps)` = `prepareDecision` → `think` → `finalizeDecision` (perilaku tak berubah).
- Produces (di `post.ts`):
  - `type PostedRequest = DecideRequest` (disimpan di `payload.request`)
  - `postDecision(req: DecideRequest, kind?: LeadEventKind): Promise<LeadEvent | null>` — `prepareDecision` → `openEvent({ …, payload: { prompt, gate, leadKind, options, select, mode: "post", request: req, flowId, step } })`; `null` bila lead tak aktif.
  - `hasOpenPosted(projectId: string, questionPrefix: string): Promise<boolean>` — dedupe pengganti "jejak dengan awalan pertanyaan" selama event belum dijawab.
  - `executeEventVerdict(eventId: string, verdict: LeadVerdict, deps?: Partial<ExecuteDeps>, opts?: { alreadyClosed?: boolean }): Promise<{ row: LeadDecision; applied: ApplyResult | null }>` — tanpa `alreadyClosed`, ia menutup event lebih dulu (`resolveEvent`) dan melempar bila event sudah tertutup; muat event (`mode: "post"`), `finalizeDecision(prepared-from-payload, JSON.stringify(verdict), …, eventId)`, lalu:
    - baris `berlaku` ∧ `action === "start-session"` ∧ `request.kind === "order"` → `enqueue` setiap `choices` (id via `specIdOfOption`, `source: "lead"`, priority dari spec)
    - baris `berlaku` ∧ action lain ≠ `none` → `applyAction(row)`
    - `applied.ok === false` ∧ `detail` berawalan `verify-failed:`/`conflict:`/`worktree-dirty:`/`plan-open:` → `postDecision({ … kind: "quality", question: \`Integrasi ${specId} gagal: ${detail}. …\`, options: ["resume-session — …", "none — eskalasi ke manusia, isi missing"] }, "integrate-failed")`
  - `type ExecuteDeps = { apply: typeof applyAction; enqueue: typeof enqueue; finalize: typeof finalizeDecision }`

`PreparedDecision` dibangun ulang dari `payload.request` saat eksekusi: panggil `prepareDecision(req)` dengan `flowId: payload.flowId` agar langkah rantainya sama — ATAU (lebih sederhana dan disarankan) simpan `flowId`/`step`/`options`/`bounds` di payload dan susun `PreparedDecision` langsung tanpa membuka alur kedua. Pakai cara kedua; `prompt` tak perlu disusun ulang.

- [ ] **Step 1: Test gagal** `server/test/lead-post.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { postDecision, executeEventVerdict, hasOpenPosted } from "../src/services/lead/post";
import { __resetInbox } from "../src/services/lead/inbox";

const v = (over = {}) => ({ decision: "d", reason: "r", refs: [], confidence: "tinggi" as const, action: "none", choice: "", choices: [] as string[], missing: [], ...over });
beforeEach(async () => {
  for (const m of [prisma.leadEvent, prisma.leadDecision, prisma.leadFlow, prisma.schedulerQueueItem, prisma.notification, prisma.spec, prisma.project, prisma.setting] as { deleteMany: () => Promise<unknown> }[]) await m.deleteMany();
  __resetInbox();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
  await prisma.spec.create({ data: { id: "SPEC-2", projectId: "demo", title: "t", source: "brief", stage: "spec-ready", priority: "tinggi", author: "t", objective: "o" } });
  await setLead({ ...LEAD_DEFAULTS, enabled: true });
});

describe("event tanpa penunggu", () => {
  it("postDecision langsung kembali dengan event mode post", async () => {
    const e = await postDecision({ projectId: "demo", gate: "pulse", kind: "order", question: "Jatah 1. Pilih", options: ["SPEC-2 · [tinggi] t"], select: { mode: "multi", min: 0, max: 1 } });
    expect(e?.kind).toBe("pulse");
    expect((e?.payload as { mode: string }).mode).toBe("post");
    expect(await hasOpenPosted("demo", "Jatah 1")).toBe(true);
  });
  it("eksekusi start-session mengantrekan HANYA pilihan lead", async () => {
    const e = (await postDecision({ projectId: "demo", gate: "pulse", kind: "order", question: "Jatah 1. Pilih", options: ["SPEC-2 · [tinggi] t"], select: { mode: "multi", min: 0, max: 1 } }))!;
    const r = await executeEventVerdict(e.id, v({ action: "start-session", choices: ["SPEC-2 · [tinggi] t"] }));
    expect(r.row.status).toBe("berlaku");
    expect(r.row.eventId).toBe(e.id);
    expect((await prisma.schedulerQueueItem.findMany()).map((q) => q.specId)).toEqual(["SPEC-2"]);
  });
  it("integrasi gagal membuka event integrate-failed", async () => {
    const e = (await postDecision({ projectId: "demo", specId: "SPEC-2", sessionId: "spec-2", gate: "pulse", kind: "quality", question: "Backlog SPEC-2 sudah selesai", options: ["integrate-main — merge"] }))!;
    await executeEventVerdict(e.id, v({ action: "integrate-main", choice: "integrate-main — merge" }), {
      apply: async () => ({ ok: false, detail: "verify-failed: `pnpm test` keluar 1" }),
    });
    const f = await prisma.leadEvent.findFirst({ where: { kind: "integrate-failed" } });
    expect(f?.question).toContain("verify-failed");
  });
});
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi.** Pecah `decide()` tepat di batas `think` tanpa mengubah urutan langkahnya (komentar AC-2: jejak ditulis sebelum jawaban sampai ke peminta — tetap benar karena `finalizeDecision` menulis jejak sebelum `executeEventVerdict` menjalankan tindakan). `executeEventVerdict` menutup event lewat `resolveEvent` HANYA bila event masih terbuka (dipanggil dari `act`: Task 10 sudah menutupnya → jangan menutup dua kali; terima `alreadyClosed` sebagai opsi).
- [ ] **Step 4: Test → PASS** (`server/test/lead-post.test.ts server/test/lead-decide.test.ts`).
- [ ] **Step 5: Commit** `feat(lead): event denyut tanpa penunggu — dieksekusi saat act/izin, tick tak pernah menunggu pane`

### Task 8: `lead-session.ts` + `lead-prompt.ts` + kind `lead` di pty

**Files:**
- Create: `server/src/services/lead/lead-session.ts`, `server/src/services/lead/lead-prompt.ts`
- Modify: `server/src/services/pty.ts:770-779` (`sessionKind`), `:1779` (`writeTo` — catat input manusia)
- Test: `server/test/lead-session.test.ts`

**Interfaces:**
- Consumes: `createSession` (`pty.ts:813`), `getSessionAsync`, `killSession`, `realGit` (`@hanoman/runner`), `resolveRepoDir`, `leadAgentDefaults` (`lead/config.ts:27`), `ensureCodexTrust`, `withSessionAdmission` **tidak** dipakai (sesi lead tak boleh ditolak gerbang slot; ia `launchClass: "terminal"`).
- Produces:
  - `leadSessionId(projectId: string): string` → `lead-<sanitized>`
  - `isLeadSessionId(id: string): boolean`
  - `ensureLeadSession(projectId: string, deps?: LeadSessionDeps): Promise<{ id: string; started: boolean } | null>` — null bila proyek tak opt-in / lead tak aktif / dalam backoff
  - `stopLeadSession(projectId: string): boolean`, `rotateLeadSession(projectId: string): Promise<void>`
  - `noteHumanInput(id: string, at?: number): void`, `humanActiveAt(id: string): number | null`
  - `leadSessionStates(): LeadSessionView[]`
  - `noteDelivered(projectId: string, n: number): void` (dipakai courier; memicu rotasi ≥ `rotateAfterEvents`)
  - `leadSystemPrompt(i: { projectId: string; projectName: string; targetBranch: string }): string`
  - `formatBatch(events: LeadEvent[], brief: string): string`
- Env yang dipasang ke pane: `HANOMAN_LEAD_URL=http://127.0.0.1:<port>/api/lead-pane`, `HANOMAN_LEAD_PROJECT=<projectId>` (token & id sesi sudah dipasang pty: `HANOMAN_SESSION_ID`, `HANOMAN_EVENT_TOKEN`, `pty.ts:669-671`).

- [ ] **Step 1: Test gagal**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { leadSessionId, isLeadSessionId, ensureLeadSession, noteHumanInput, humanActiveAt, __resetLeadSessions, type LeadSessionDeps } from "../src/services/lead/lead-session";
import { leadSystemPrompt, formatBatch } from "../src/services/lead/lead-prompt";
import { sessionKind } from "../src/services/pty";

beforeEach(() => __resetLeadSessions());
const deps = (over: Partial<LeadSessionDeps> = {}): LeadSessionDeps & { created: string[] } => {
  const created: string[] = [];
  return {
    created,
    active: async () => true,
    live: async () => false,
    repoDir: async () => "/repo",
    prepareWorktree: () => "/repo/.worktrees/lead-p",
    agent: async () => ({ agent: "claude", model: "m", effort: "high" }),
    create: (id) => { created.push(id); },
    kill: () => true,
    project: async () => ({ name: "P", targetBranch: "main" }),
    now: () => 1_000_000,
    ...over,
  } as LeadSessionDeps & { created: string[] };
};

describe("sesi lead", () => {
  it("id deterministik & dikenali", () => {
    expect(leadSessionId("erp-tumbuh-ai")).toBe("lead-erp-tumbuh-ai");
    expect(isLeadSessionId("lead-x")).toBe(true);
    expect(isLeadSessionId("spec-1")).toBe(false);
  });
  it("membuka pane sekali; pane hidup tak dibuka ulang", async () => {
    const d = deps();
    expect(await ensureLeadSession("p", d)).toEqual({ id: "lead-p", started: true });
    const d2 = deps({ live: async () => true });
    expect(await ensureLeadSession("p", d2)).toEqual({ id: "lead-p", started: false });
    expect(d2.created).toEqual([]);
  });
  it("lead tak aktif → null, tak membuka apa pun", async () => {
    const d = deps({ active: async () => false });
    expect(await ensureLeadSession("p", d)).toBeNull();
    expect(d.created).toEqual([]);
  });
  it("backoff 1/2/5 menit setelah gagal lahir", async () => {
    let t = 1_000_000;
    const d = deps({ create: () => { throw new Error("tmux"); }, now: () => t });
    await expect(ensureLeadSession("p", d)).rejects.toThrow();
    t += 30_000;
    expect(await ensureLeadSession("p", d)).toBeNull();      // masih dalam backoff 1 menit
  });
  it("mencatat input manusia", () => {
    noteHumanInput("lead-p", 5);
    expect(humanActiveAt("lead-p")).toBe(5);
  });
  it("kind sesi lead", () => {
    expect(sessionKind({ id: "lead-p" }, "p", "/repo/.worktrees/lead-p")).toBe("lead");
  });
  it("prompt sistem menjelaskan cara memeriksa & bertindak", () => {
    const s = leadSystemPrompt({ projectId: "p", projectName: "P", targetBranch: "main" });
    expect(s).toContain("$HANOMAN_LEAD_URL/brief");
    expect(s).toContain("$HANOMAN_LEAD_URL/act");
    expect(s).toContain("eventId");
  });
  it("batch memuat id event dan prompt tiap event", () => {
    const txt = formatBatch([{ id: "e1", kind: "ask", question: "q", payload: { prompt: "PROMPT-1" } } as never], "BRIEF");
    expect(txt).toContain("e1");
    expect(txt).toContain("PROMPT-1");
    expect(txt).toContain("BRIEF");
  });
});
```

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi**

`pty.ts` `sessionKind` — tambah baris pertama sesudah `specId`:

```ts
  if (o.id.startsWith("lead-")) return "lead";            // ADR-0228 · pane hanoman-lead per proyek
```

`pty.ts` `writeTo(id, d, from?)` — tambah di awal badan fungsi:

```ts
  // ADR-0228 · manusia mengetik di pane lead → courier menahan suntikan event (spec §3).
  if (id.startsWith("lead-")) noteHumanInput(id);
```

(impor `noteHumanInput` dari `./lead/lead-session`; bila menimbulkan impor sirkular, pindahkan `noteHumanInput`/`humanActiveAt` ke berkas kecil `server/src/services/lead/human-input.ts` tanpa dependensi dan re-ekspor dari `lead-session.ts`.)

`server/src/services/lead/lead-prompt.ts`:

```ts
import type { LeadEvent } from "@prisma/client";

// ADR-0228 · prompt SISTEM pane lead. Ditulis sekali saat pane lahir; tiap batch event menyusul
// sebagai pesan biasa. Lead memeriksa dulu, baru bertindak — dan satu-satunya cara bertindak
// adalah `act`, yang digerbangi server.
export function leadSystemPrompt(i: { projectId: string; projectName: string; targetBranch: string }): string {
  return [
    `Kamu hanoman-lead untuk proyek "${i.projectName}" (${i.projectId}). Branch target: ${i.targetBranch}.`,
    "Kamu memimpin sesi agen pekerja: menjawab pertanyaan mereka, memilih backlog yang diluncurkan, dan memutuskan nasib sesi yang selesai/gagal (integrasi, review, lanjutkan, hentikan).",
    "",
    "ATURAN KERJA",
    "1. Server akan mengirimimu BATCH event. Tiap event punya `eventId` dan prompt lengkapnya sendiri.",
    "2. PERIKSA DULU sebelum memutuskan: jalankan `curl -s \"$HANOMAN_LEAD_URL/brief\" -H \"x-hanoman-session: $HANOMAN_SESSION_ID\" -H \"authorization: Bearer $HANOMAN_EVENT_TOKEN\"` untuk jatah peluncuran, kuota, sesi hidup, backlog siap, dan inbox. Baca spec/plan/diff/git log di worktree ini bila keputusan menyangkut kode.",
    "3. Beberapa pertanyaan independen dalam satu batch: kumpulkan buktinya PARALEL dengan subagent (satu per pertanyaan). Keputusan tetap kamu tulis sendiri.",
    "4. Jawab SETIAP event dengan tepat satu panggilan:",
    "   curl -s -X POST \"$HANOMAN_LEAD_URL/act\" -H \"x-hanoman-session: $HANOMAN_SESSION_ID\" -H \"authorization: Bearer $HANOMAN_EVENT_TOKEN\" -H 'content-type: application/json' -d @- <<'JSON'",
    "   {\"eventId\":\"<id>\",\"verdict\":{\"decision\":\"…\",\"reason\":\"…\",\"refs\":[\"path/berkas\"],\"confidence\":\"tinggi|sedang|ragu\",\"action\":\"<tindakan>\",\"choices\":[\"<label opsi persis>\"]},\"evidence\":[\"<apa yang kamu periksa: id spec, path, sha>\"]}",
    "   JSON",
    "5. Jawab pertanyaan sesi yang sedang TERTAHAN lebih dulu. Event denyut paling akhir.",
    "6. Balasan `act`: `lolos` = sudah dijalankan; `butuh-izin` = menunggu manusia, jangan diulang; `ditolak` = baca `code`+`detail`, perbaiki alasan/bukti atau pilih tindakan lain. Jangan mengulang tindakan yang ditolak dengan isi yang sama.",
    "7. Kamu BOLEH menyatakan konteks tak cukup: isi `missing` dan pilih `none` — event itu akan jatuh ke manusia. Jangan menebak untuk hal yang menyentuh produksi, kredensial, akun, data, atau deploy.",
    "8. Jangan mengubah berkas di worktree ini; ia hanya untuk membaca. Pekerjaan kode dilakukan sesi pekerja.",
    "9. Manusia bisa mengetik di pane ini kapan saja. Perintah manusia mengalahkan event.",
  ].join("\n");
}

export function formatBatch(events: Pick<LeadEvent, "id" | "kind" | "question" | "payload">[], brief: string): string {
  const parts = events.map((e, n) => {
    const prompt = (e.payload as { prompt?: string } | null)?.prompt ?? e.question;
    return `### Event ${n + 1}/${events.length} · eventId=${e.id} · ${e.kind}\n${prompt}`;
  });
  return [`[hanoman] ${events.length} event menunggu keputusanmu.`, "", "## Situasi sekarang", brief, "", ...parts].join("\n");
}
```

`server/src/services/lead/lead-session.ts`:

```ts
import type { Agent, LeadSessionView } from "@hanoman/shared";
import { realGit } from "@hanoman/runner";
import { prisma } from "../../db";
import { createSession, getSessionAsync, killSession } from "../pty";
import { resolveRepoDir } from "../local-binding";
import { ensureCodexTrust } from "../codex-trust";
import { getLead, leadActive, leadAgentDefaults, leadProjects } from "./config";
import { leadProjectConfig } from "./project-config";
import { leadSystemPrompt } from "./lead-prompt";
import { setEnsureLeadSession } from "./session-think";
import { serverPort } from "../server-port";

// ADR-0228 · SATU pane lead per proyek. Id deterministik (pola `cronSessionId`, ADR-0112): pane
// hidup `lead-<proyek>` adalah satu-satunya bukti yang dibutuhkan dan selamat dari restart.
// `launchClass: "terminal"` — pane lead bukan pekerjaan backlog dan tak boleh memakan slot.

export const leadSessionId = (projectId: string) =>
  `lead-${projectId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
export const isLeadSessionId = (id: string) => id.startsWith("lead-");

const BACKOFF_MS = [60_000, 120_000, 300_000];
type State = { failures: number; retryAt: number; delivered: number; restarts: number };
const states = new Map<string, State>();
const human = new Map<string, number>();
export function __resetLeadSessions(): void { states.clear(); human.clear(); }
const st = (p: string): State => states.get(p) ?? (states.set(p, { failures: 0, retryAt: 0, delivered: 0, restarts: 0 }), states.get(p)!);

export function noteHumanInput(id: string, at: number = Date.now()): void { human.set(id, at); }
export function humanActiveAt(id: string): number | null { return human.get(id) ?? null; }

export type LeadSessionDeps = {
  active: (projectId: string) => Promise<boolean>;
  live: (id: string) => Promise<boolean>;
  repoDir: (projectId: string) => Promise<string | null>;
  prepareWorktree: (repoDir: string, id: string, branch: string) => string;
  agent: () => Promise<{ agent: Agent; model: string; effort: string }>;
  create: (id: string, projectId: string, cwd: string, o: { agent: Agent; model: string; effort: string; prompt: string; env: Record<string, string> }) => void;
  kill: (id: string) => boolean;
  project: (projectId: string) => Promise<{ name: string; targetBranch: string } | null>;
  now: () => number;
};

export const prodLeadSessionDeps: LeadSessionDeps = {
  active: async (p) => leadActive(await getLead(), p) && (await leadProjects()).includes(p),
  live: async (id) => { const s = await getSessionAsync(id); return !!s && !s.exited; },
  repoDir: resolveRepoDir,
  prepareWorktree: (repoDir, id, branch) => {
    const wt = `${repoDir}/.worktrees/${id}`;
    // Worktree BACA: dibuat ulang tiap kelahiran supaya lead melihat HEAD target terbaru.
    if (realGit.worktreeAlive(wt)) realGit.removeWorktree(repoDir, wt);
    realGit.addWorktree(repoDir, wt, branch);
    return wt;
  },
  agent: leadAgentDefaults,
  create: (id, projectId, cwd, o) => {
    if (o.agent === "codex") ensureCodexTrust(cwd);
    createSession(projectId, cwd, { id, agent: o.agent, model: o.model, effort: o.effort, prompt: o.prompt, env: o.env, launchClass: "terminal" });
  },
  kill: (id) => { try { return killSession(id); } catch { return false; } },
  project: async (p) => {
    const row = await prisma.project.findUnique({ where: { id: p }, select: { name: true } });
    return row ? { name: row.name, targetBranch: leadProjectConfig(await getLead(), p).targetBranch } : null;
  },
  now: Date.now,
};

export async function ensureLeadSession(projectId: string, deps: LeadSessionDeps = prodLeadSessionDeps):
  Promise<{ id: string; started: boolean } | null> {
  const id = leadSessionId(projectId);
  if (!(await deps.active(projectId))) return null;
  if (await deps.live(id)) return { id, started: false };
  const s = st(projectId);
  if (deps.now() < s.retryAt) return null;
  const project = await deps.project(projectId);
  const repoDir = await deps.repoDir(projectId);
  if (!project || !repoDir) return null;
  try {
    const cwd = deps.prepareWorktree(repoDir, id, project.targetBranch);
    const { agent, model, effort } = await deps.agent();
    deps.create(id, projectId, cwd, {
      agent, model, effort,
      prompt: leadSystemPrompt({ projectId, projectName: project.name, targetBranch: project.targetBranch }),
      env: { HANOMAN_LEAD_URL: `http://127.0.0.1:${serverPort()}/api/lead-pane`, HANOMAN_LEAD_PROJECT: projectId },
    });
    s.failures = 0; s.retryAt = 0; s.delivered = 0; s.restarts++;
    return { id, started: true };
  } catch (e) {
    s.retryAt = deps.now() + BACKOFF_MS[Math.min(s.failures, BACKOFF_MS.length - 1)];
    s.failures++;
    throw e;
  }
}

/** 3× gagal lahir beruntun → pemanggil (engine) mem-pause proyek + notifikasi. */
export function leadSessionFailures(projectId: string): number { return st(projectId).failures; }

export function stopLeadSession(projectId: string, deps: LeadSessionDeps = prodLeadSessionDeps): boolean {
  return deps.kill(leadSessionId(projectId));
}

export async function rotateLeadSession(projectId: string, deps: LeadSessionDeps = prodLeadSessionDeps): Promise<void> {
  deps.kill(leadSessionId(projectId));
  st(projectId).retryAt = 0;
  await ensureLeadSession(projectId, deps);
}

export function noteDelivered(projectId: string, n: number): number {
  const s = st(projectId); s.delivered += n; return s.delivered;
}

export async function leadSessionStates(idle: (id: string) => boolean): Promise<LeadSessionView[]> {
  const out: LeadSessionView[] = [];
  for (const p of await leadProjects()) {
    const id = leadSessionId(p);
    const s = await getSessionAsync(id);
    const h = humanActiveAt(id);
    out.push({ projectId: p, sessionId: id, alive: !!s && !s.exited, idle: idle(id),
      humanActive: h !== null && Date.now() - h < 120_000,
      delivered: st(p).delivered, restarts: st(p).restarts });
  }
  return out;
}

setEnsureLeadSession(async (p) => { await ensureLeadSession(p); });
```

Catatan implementer:
- `CreateOpts` (`pty.ts:793-811`) belum punya `launchClass`. Tambah `launchClass?: "agent" | "terminal"` ke `CreateOpts` dan teruskan ke penyimpanan `@hanoman_launch_class` yang dibaca `pty.ts:542/570` (cari cara `launchClass` ditulis saat ini — mungkin diturunkan dari kind; bila diturunkan, buat `lead` → `"terminal"` di titik turunan itu dan hapus opsi eksplisit).
- `realGit.removeWorktree` — cek nama metode persis di `runner/src` (`grep -n "worktree" runner/src/git*.ts`). Bila tak ada, pakai `git worktree remove --force` lewat helper runner yang ada.
- `serverPort()` — cari sumber port yang dipakai `pty.ts:670` untuk `HANOMAN_EVENT_URL` dan pakai fungsi yang sama.
- `leadProjects()` mengembalikan proyek `leadOptIn` (`config.ts:48`).

- [ ] **Step 4: Test → PASS.**
- [ ] **Step 5: Commit** `feat(lead): pane lead per proyek — lahir di worktree baca, backoff, prompt sistem, kind lead`

### Task 9: `courier.ts` + Stop hook pane lead

**Files:**
- Create: `server/src/services/lead/courier.ts`
- Modify: `server/src/routes/session-events.ts:56-60` (sebelum blok cron `Stop`)
- Test: `server/test/lead-courier.test.ts`

**Interfaces:**
- Consumes: `pendingBatch`, `markDelivered`, `setEventOpenedHook` (Task 6); `leadSessionId`, `humanActiveAt`, `noteDelivered`, `rotateLeadSession`, `ensureLeadSession` (Task 8); `formatBatch` (Task 8); `buildBrief` (Task 10 — disuntik); `sendToPane` (`pty.ts:1311`).
- Produces:
  - `markLeadIdle(sessionId: string): void` (dipanggil hook Stop), `isLeadIdle(id: string): boolean`
  - `deliver(projectId: string, deps?: CourierDeps): Promise<number>` (jumlah event terkirim)
  - `deliverAll(projects: string[]): Promise<void>`
  - Aturan: kirim hanya bila pane hidup ∧ idle ∧ tak ada input manusia < 120 dtk ∧ batch tak kosong. Setelah kirim: idle=false. Bila `noteDelivered` ≥ `rotateAfterEvents` dan batch berikutnya kosong → `rotateLeadSession`.

- [ ] **Step 1: Test gagal**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { deliver, markLeadIdle, isLeadIdle, __resetCourier, type CourierDeps } from "../src/services/lead/courier";

beforeEach(() => __resetCourier());
const ev = (id: string) => ({ id, kind: "ask", question: "q", payload: { prompt: `P-${id}` } });
const deps = (over: Partial<CourierDeps> = {}): CourierDeps & { sent: string[]; marked: string[][] } => {
  const sent: string[] = []; const marked: string[][] = [];
  return {
    sent, marked,
    live: async () => true,
    batch: async () => [ev("e1"), ev("e2")] as never,
    human: () => null,
    brief: async () => "BRIEF",
    send: async (_id, text) => { sent.push(text); return true; },
    markDelivered: async (ids) => { marked.push(ids); },
    ensure: async () => {},
    now: () => 1_000_000,
    ...over,
  } as CourierDeps & { sent: string[]; marked: string[][] };
};

describe("courier", () => {
  it("menyuntik satu batch saat pane diam", async () => {
    markLeadIdle("lead-p");
    const d = deps();
    expect(await deliver("p", d)).toBe(2);
    expect(d.sent[0]).toContain("eventId=e1");
    expect(d.sent[0]).toContain("eventId=e2");
    expect(d.marked).toEqual([["e1", "e2"]]);
    expect(isLeadIdle("lead-p")).toBe(false);
  });
  it("tak menyuntik saat pane sibuk", async () => {
    const d = deps();
    expect(await deliver("p", d)).toBe(0);
    expect(d.sent).toEqual([]);
  });
  it("tak menyuntik saat manusia baru mengetik", async () => {
    markLeadIdle("lead-p");
    const d = deps({ human: () => 1_000_000 - 30_000 });
    expect(await deliver("p", d)).toBe(0);
  });
  it("pane mati → minta dilahirkan, tak mengirim", async () => {
    markLeadIdle("lead-p");
    const started: string[] = [];
    const d = deps({ live: async () => false, ensure: async (p) => { started.push(p); } });
    expect(await deliver("p", d)).toBe(0);
    expect(started).toEqual(["p"]);
  });
  it("kirim gagal → event tetap open", async () => {
    markLeadIdle("lead-p");
    const d = deps({ send: async () => false });
    expect(await deliver("p", d)).toBe(0);
    expect(d.marked).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi** `server/src/services/lead/courier.ts`:

```ts
import type { LeadEvent } from "@prisma/client";
import { sendToPane, getSessionAsync } from "../pty";
import { getLead } from "./config";
import { pendingBatch, markDelivered, setEventOpenedHook } from "./inbox";
import { leadSessionId, humanActiveAt, noteDelivered, rotateLeadSession, ensureLeadSession } from "./lead-session";
import { formatBatch } from "./lead-prompt";

// ADR-0228 · KURIR. Satu-satunya yang mengetik ke pane lead. Ia menunggu pane DIAM (hook Stop) dan
// manusia tak sedang mengetik — event yang datang selama lead bekerja ikut batch berikutnya.
// Pane yang baru lahir dianggap diam setelah giliran pertamanya (Stop pertama) — bukan saat lahir.

const idle = new Set<string>();
const sending = new Set<string>();
export function __resetCourier(): void { idle.clear(); sending.clear(); }
export function markLeadIdle(sessionId: string): void { idle.add(sessionId); }
export function isLeadIdle(id: string): boolean { return idle.has(id); }

const HUMAN_QUIET_MS = 120_000;

export type CourierDeps = {
  live: (id: string) => Promise<boolean>;
  batch: (projectId: string) => Promise<LeadEvent[]>;
  human: (id: string) => number | null;
  brief: (projectId: string) => Promise<string>;
  send: (id: string, text: string) => Promise<boolean>;
  markDelivered: (ids: string[]) => Promise<void>;
  ensure: (projectId: string) => Promise<void>;
  now: () => number;
};

let briefFn: (projectId: string) => Promise<string> = async () => "(brief tak tersedia)";
/** Dipasang route lead-pane (Task 10) — sumber `brief` yang sama dengan GET /lead-pane/brief. */
export function setBriefBuilder(fn: (projectId: string) => Promise<string>): void { briefFn = fn; }

export const prodCourierDeps: CourierDeps = {
  live: async (id) => { const s = await getSessionAsync(id); return !!s && !s.exited; },
  batch: pendingBatch,
  human: humanActiveAt,
  brief: (p) => briefFn(p),
  send: (id, text) => sendToPane(id, text),
  markDelivered,
  ensure: async (p) => { await ensureLeadSession(p).catch(() => null); },
  now: Date.now,
};

export async function deliver(projectId: string, deps: CourierDeps = prodCourierDeps): Promise<number> {
  const id = leadSessionId(projectId);
  if (sending.has(id)) return 0;
  if (!(await deps.live(id))) { await deps.ensure(projectId); return 0; }
  if (!idle.has(id)) return 0;
  const h = deps.human(id);
  if (h !== null && deps.now() - h < HUMAN_QUIET_MS) return 0;
  const events = await deps.batch(projectId);
  if (!events.length) return 0;
  sending.add(id);
  try {
    const text = formatBatch(events, await deps.brief(projectId));
    if (!(await deps.send(id, text))) return 0;
    idle.delete(id);
    await deps.markDelivered(events.map((e) => e.id));
    return events.length;
  } finally { sending.delete(id); }
}

/** Dipanggil tick engine & hook pembukaan event. Tak pernah merotasi — itu milik `onLeadStop`. */
export async function deliverAll(projects: string[]): Promise<void> {
  for (const p of projects) {
    try {
      const n = await deliver(p);
      if (n) noteDelivered(p, n);
    } catch (e) { console.error(`courier lead ${p}:`, e); }
  }
}

export type StopDeps = {
  rotateAfter: () => Promise<number>;
  delivered: (projectId: string) => number;
  openCount: (projectId: string) => Promise<number>;   // event open + delivered
  rotate: (projectId: string) => Promise<void>;
  deliver: (projectId: string) => Promise<number>;
};
export const prodStopDeps: StopDeps = {
  rotateAfter: async () => (await getLead()).rotateAfterEvents,
  delivered: (p) => noteDelivered(p, 0),
  openCount: (p) => prisma.leadEvent.count({ where: { projectId: p, status: { in: ["open", "delivered"] } } }),
  rotate: (p) => rotateLeadSession(p),
  deliver: async (p) => { const n = await deliver(p); if (n) noteDelivered(p, n); return n; },
};

/**
 * Giliran pane lead selesai (hook Stop). Rotasi HANYA di sini: pane diam dan tak ada event yang
 * masih terbuka — merotasi di tengah giliran memutus lead yang sedang mengerjakan batch.
 */
export async function onLeadStop(sessionId: string, projectId: string, deps: StopDeps = prodStopDeps): Promise<"rotated" | "delivered" | "idle"> {
  markLeadIdle(sessionId);
  if (deps.delivered(projectId) >= await deps.rotateAfter() && (await deps.openCount(projectId)) === 0) {
    await deps.rotate(projectId);
    return "rotated";
  }
  return (await deps.deliver(projectId)) ? "delivered" : "idle";
}

setEventOpenedHook((p) => { void deliverAll([p]); });
```

(`prisma` diimpor dari `../../db`.) Tambah test ke `server/test/lead-courier.test.ts`:

```ts
import { onLeadStop, type StopDeps } from "../src/services/lead/courier";

const stop = (over: Partial<StopDeps> = {}): StopDeps & { rotated: string[] } => {
  const rotated: string[] = [];
  return { rotated, rotateAfter: async () => 40, delivered: () => 0, openCount: async () => 0,
    rotate: async (p) => { rotated.push(p); }, deliver: async () => 0, ...over } as StopDeps & { rotated: string[] };
};
describe("onLeadStop", () => {
  it("rotasi saat ambang tercapai dan inbox kosong", async () => {
    const d = stop({ delivered: () => 40 });
    expect(await onLeadStop("lead-p", "p", d)).toBe("rotated");
    expect(d.rotated).toEqual(["p"]);
    expect(isLeadIdle("lead-p")).toBe(true);
  });
  it("tak merotasi selama masih ada event terbuka", async () => {
    const d = stop({ delivered: () => 40, openCount: async () => 1, deliver: async () => 1 });
    expect(await onLeadStop("lead-p", "p", d)).toBe("delivered");
    expect(d.rotated).toEqual([]);
  });
  it("di bawah ambang → kirim batch berikutnya", async () => {
    const d = stop({ deliver: async () => 2 });
    expect(await onLeadStop("lead-p", "p", d)).toBe("delivered");
  });
});
```

Di `session-events.ts`, tepat sebelum blok cron (`:56`):

```ts
    // ADR-0228 · giliran pane lead selesai → ia diam, kurir boleh mengirim batch berikutnya.
    // Pertanyaan DARI pane lead tak pernah masuk inbox lead sendiri (ADR-0192): jatuh ke manusia.
    if (sessionId.startsWith("lead-")) {
      if (lifecycle === "Stop") void onLeadStop(sessionId, s.projectId);
      if (lifecycle === "Stop" || lifecycle === "PreToolUse") return reply.code(202).send({ lead: true });
    }
```

- [ ] **Step 4: Test → PASS** (`server/test/lead-courier.test.ts`, `server/test/lead-detect-event.test.ts`).
- [ ] **Step 5: Commit** `feat(lead): kurir — batch event disuntik ke pane lead saat diam, hormati ketikan manusia`

### Task 10: Route `lead-pane` (brief + act) dan `act.ts`

**Files:**
- Create: `server/src/services/lead/act.ts`, `server/src/services/lead/brief.ts`, `server/src/routes/lead-pane.ts`
- Modify: `server/src/app.ts:223` (bypass), registrasi route; `server/src/services/agent-capabilities.ts:81` (peta `COOKIE_ONLY`)
- Test: `server/test/lead-pane.route.test.ts`, `server/test/lead-act.test.ts`

**Interfaces:**
- Consumes: `checkAct` (Task 5), `resolveEvent`/`isEventOpen` (Task 6), `createApproval` (Task 11 — disuntik; sebelum Task 11 ada, pakai stub yang membuat baris `LeadApproval` langsung), `applyAction` (`apply.ts`), `recordDecision`, `launchBudget`, `setBriefBuilder` (Task 9).
- Produces:
  - `processAct(projectId: string, act: LeadAct, deps?: ActDeps): Promise<LeadActResult>`
  - `buildBrief(projectId: string): Promise<{ text: string; data: LeadBrief }>`, `type LeadBrief = { budget: Budget; live: {id; specId; exited}[]; ready: {id; title; priority}[]; inbox: LeadEventView[]; approvals: LeadApprovalView[] }`
  - `GET /api/lead-pane/brief` → `{ text, data }`; `POST /api/lead-pane/act` → `LeadActResult` (200), 400 bentuk salah, 401 token, 403 pane bukan lead / proyek lain, 404 event tak ada.

Alur `processAct`:
1. Muat event; bukan milik proyek pane → 403 (`ditolak`, `event-closed` tak cukup: route mengembalikan 403).
2. `action` = `verdict.action`; `choices` = `verdict.choices` (atau `[verdict.choice]`).
3. `checkAct({ eventKind, eventOpen, action, specId: event.specId ?? verdict target, sessionId: event.sessionId, decision, choices, reason, evidence })`.
   - Untuk event `pulse` dengan `action: "start-session"`: lead memilih backlog lewat `choices` (label opsi `SPEC-x · …`); guard dijalankan **per spec terpilih** (id = token pertama label). Semua harus lolos atau ditolak seluruhnya.
4. `ditolak` → kembalikan apa adanya (event tetap terbuka).
5. `butuh-izin` → `createApproval({ event, verdict, evidence, report })`; event tetap terbuka (waiter tetap menunggu sampai disetujui/ditolak/tenggat) → `{ outcome: "butuh-izin", approvalId }`.
6. `lolos` → `resolveEvent(event.id, { verdict, evidence })`. Waiter (rantai dialog / route kontrak / `pulse`) yang menjalankan `decide()` → baris jejak + tindakan. Tak ada waiter (proses restart) → event tetap `done`; pemanggilnya sudah mati sehingga **tak ada eksekusi ganda** — catat di `detail`: "tak ada penunggu; keputusan dicatat saja".

- [ ] **Step 1: Test gagal**

`server/test/lead-act.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { processAct, type ActDeps } from "../src/services/lead/act";
import { openEvent, awaitEvent, __resetInbox } from "../src/services/lead/inbox";

const payload = { prompt: "p", gate: "detected" as const, leadKind: "answer" as const, options: ["A", "B"], select: null };
const verdict = (over = {}) => ({ decision: "A", reason: "r", refs: [], confidence: "tinggi" as const, action: "answer-session", choice: "A", choices: [], missing: [], ...over });
beforeEach(async () => { await prisma.leadApproval.deleteMany(); await prisma.leadEvent.deleteMany(); __resetInbox(); });

const executed: string[] = [];
const deps = (outcome: "lolos" | "butuh-izin" | "ditolak"): ActDeps => ({
  guard: async () => ({ outcome, report: ["r"], ...(outcome === "ditolak" ? { code: "not-waiting" as const } : {}) }),
  createApproval: async () => ({ id: "ap1" }),
  execute: async (id) => { executed.push(id); return { applied: { ok: true, detail: "dijalankan" } }; },
});

describe("processAct", () => {
  it("lolos → event selesai dan penunggu menerima verdict", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload, sessionId: "spec-1" });
    const w = awaitEvent(e.id, 2000);
    const r = await processAct("p", { eventId: e.id, verdict: verdict(), evidence: ["x"] }, deps("lolos"));
    expect(r.outcome).toBe("lolos");
    expect((await w).status).toBe("answered");
  });
  it("butuh-izin → approval dibuat, event tetap terbuka", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    const r = await processAct("p", { eventId: e.id, verdict: verdict(), evidence: [] }, deps("butuh-izin"));
    expect(r).toMatchObject({ outcome: "butuh-izin", approvalId: "ap1" });
    expect((await prisma.leadEvent.findUnique({ where: { id: e.id } }))?.status).toBe("open");
  });
  it("ditolak → kode dikembalikan, event tetap terbuka", async () => {
    const e = await openEvent({ projectId: "p", kind: "ask", question: "q", payload });
    const r = await processAct("p", { eventId: e.id, verdict: verdict(), evidence: [] }, deps("ditolak"));
    expect(r).toMatchObject({ outcome: "ditolak", code: "not-waiting" });
  });
  it("event mode post dieksekusi langsung oleh act", async () => {
    executed.length = 0;
    const e = await openEvent({ projectId: "p", kind: "pulse", question: "q", payload: { ...payload, mode: "post" } });
    const r = await processAct("p", { eventId: e.id, verdict: verdict({ action: "none" }), evidence: [] }, deps("lolos"));
    expect(r.outcome).toBe("lolos");
    expect(executed).toEqual([e.id]);
  });
  it("event proyek lain → ditolak event-closed", async () => {
    const e = await openEvent({ projectId: "q", kind: "ask", question: "q", payload });
    const r = await processAct("p", { eventId: e.id, verdict: verdict(), evidence: [] }, deps("lolos"));
    expect(r.code).toBe("event-closed");
  });
});
```

`server/test/lead-pane.route.test.ts` (pola `lead-routes.test.ts`, token dari `sessionEventToken`):

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { sessionEventToken } from "../src/services/session-event-token";
import { createSession, killSession } from "../src/services/pty";
import { openEvent } from "../src/services/lead/inbox";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = buildApp();
const payload = { prompt: "p", gate: "pulse" as const, leadKind: "order" as const, options: [], select: null };
beforeEach(async () => {
  await prisma.leadEvent.deleteMany();
  await prisma.project.deleteMany();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
});
afterAll(() => { try { killSession("lead-demo"); } catch { /* */ } });

const h = (id: string) => ({ "x-hanoman-session": id, authorization: `Bearer ${sessionEventToken(id)}` });

describe("/api/lead-pane", () => {
  it("401 tanpa token sah", async () => {
    const r = await app.inject({ method: "GET", url: "/api/lead-pane/brief", headers: { "x-hanoman-session": "lead-demo", authorization: "Bearer salah" } });
    expect(r.statusCode).toBe(401);
  });
  it("403 untuk pane yang bukan pane lead", async () => {
    const r = await app.inject({ method: "GET", url: "/api/lead-pane/brief", headers: h("spec-1") });
    expect(r.statusCode).toBe(403);
  });
  it("brief & act untuk pane lead yang hidup", async () => {
    createSession("demo", mkdtempSync(join(tmpdir(), "lp-")), { id: "lead-demo", command: ["sh"] });
    const b = await app.inject({ method: "GET", url: "/api/lead-pane/brief", headers: h("lead-demo") });
    expect(b.statusCode).toBe(200);
    expect(b.json().data.budget).toBeDefined();
    const e = await openEvent({ projectId: "demo", kind: "pulse", question: "q", payload });
    const a = await app.inject({ method: "POST", url: "/api/lead-pane/act", headers: h("lead-demo"),
      payload: { eventId: e.id, verdict: { decision: "tak ada", reason: "r", action: "none" } } });
    expect(a.statusCode).toBe(200);
    expect(a.json().outcome).toBe("lolos");
  });
});
```

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi**

`server/src/services/lead/act.ts`:

```ts
import type { LeadAct, LeadActResult, LeadEventKind, LeadVerdict } from "@hanoman/shared";
import { prisma } from "../../db";
import { checkAct, type GuardResult, type GuardInput } from "./guard";
import { resolveEvent } from "./inbox";
import { executeEventVerdict } from "./post";

// ADR-0228 · SATU-SATUNYA pintu tindakan pane lead. Guard dulu, lalu tiga cabang: tolak (lead
// membaca alasannya), tahan sebagai approval, atau lepaskan ke penunggu event.

export type ActDeps = {
  guard: (i: GuardInput) => Promise<GuardResult>;
  createApproval: (i: { eventId: string; projectId: string; act: LeadAct; report: string[]; target: string | null }) => Promise<{ id: string }>;
  execute: (eventId: string, verdict: LeadVerdict) => Promise<{ applied: { ok: boolean; detail: string } | null }>;
};

let createApprovalImpl: ActDeps["createApproval"] = async () => { throw new Error("approvals belum terpasang"); };
export function setCreateApproval(fn: ActDeps["createApproval"]): void { createApprovalImpl = fn; }
export const prodActDeps: ActDeps = {
  guard: (i) => checkAct(i),
  createApproval: (i) => createApprovalImpl(i),
  execute: (id, v) => executeEventVerdict(id, v, undefined, { alreadyClosed: true }),
};

/** Label opsi denyut berbentuk `SPEC-123 · [tinggi] judul` — id = token pertama. */
export const specIdOfOption = (label: string): string => label.trim().split(/\s+/)[0] ?? "";

export async function processAct(projectId: string, act: LeadAct, deps: ActDeps = prodActDeps): Promise<LeadActResult> {
  const e = await prisma.leadEvent.findUnique({ where: { id: act.eventId } });
  if (!e || e.projectId !== projectId) return { outcome: "ditolak", code: "event-closed", detail: "event tak ada untuk proyek ini" };
  const v = act.verdict;
  const choices = v.choices.length ? v.choices : (v.choice.trim() ? [v.choice] : []);
  const open = e.status === "open" || e.status === "delivered";
  const base: Omit<GuardInput, "specId"> = {
    projectId, eventKind: e.kind as LeadEventKind, eventOpen: open, action: v.action,
    sessionId: e.sessionId, decision: v.decision, choices, reason: v.reason, evidence: act.evidence,
  };
  // Denyut memilih BEBERAPA backlog sekaligus: tiap pilihan digerbangi sendiri, semuanya atau tidak sama sekali.
  const targets = e.kind === "pulse" && v.action === "start-session"
    ? choices.map(specIdOfOption).filter(Boolean)
    : [e.specId];
  const report: string[] = [];
  let ask = false;
  for (const specId of targets.length ? targets : [null]) {
    const g = await deps.guard({ ...base, specId });
    if (g.outcome === "ditolak") return { outcome: "ditolak", code: g.code, detail: `${specId ?? ""} ${g.report.join("; ")}`.trim() };
    if (g.outcome === "butuh-izin") ask = true;
    report.push(...g.report);
  }
  if (ask) {
    const ap = await deps.createApproval({ eventId: e.id, projectId, act, report, target: targets.filter(Boolean).join(",") || e.sessionId });
    return { outcome: "butuh-izin", approvalId: ap.id, detail: report.join("; ") || "menunggu izin manusia" };
  }
  const ok = await resolveEvent(e.id, { verdict: v, evidence: act.evidence });
  if (!ok) return { outcome: "ditolak", code: "event-closed", detail: "event sudah ditutup" };
  // Task 7b · event tanpa penunggu (denyut) dieksekusi DI SINI; event ber-penunggu dieksekusi
  // pemanggil yang menunggu (rantai dialog / route kontrak) begitu `resolveEvent` melepasnya.
  if ((e.payload as { mode?: string } | null)?.mode === "post") {
    const r = await deps.execute(e.id, v);
    return { outcome: "lolos", detail: r.applied ? r.applied.detail : (report.join("; ") || "dicatat") };
  }
  return { outcome: "lolos", detail: report.join("; ") || "diteruskan" };
}
```

Catatan: guard `start-session` di jatah: N pilihan > jatah → guard per spec memanggil `budget` yang sama (n tak berkurang di antara panggilan). Tambahkan pemeriksaan di `processAct` sebelum loop: bila `e.kind === "pulse"` dan `targets.length > (await launchBudget(projectId)).n` → `ditolak`/`budget-zero` "memilih N melebihi jatah M". Tambah test untuk itu.

`server/src/services/lead/brief.ts`:

```ts
import type { LeadApprovalView, LeadEventView } from "@hanoman/shared";
import { prisma } from "../../db";
import { listSessionsAsync } from "../pty";
import { UNSTARTED_SPEC_WHERE } from "../scheduler/queue";
import { launchBudget, type Budget } from "./budget";
import { toEventView } from "./inbox";
import { toApprovalView } from "./approvals";

// ADR-0228 · "periksa dulu" yang murah: satu panggilan memberi lead jatah, kuota, sesi hidup,
// backlog siap, dan inbox. Sumber yang SAMA dipakai kurir untuk bagian "Situasi" tiap batch.
export type LeadBrief = {
  budget: Budget;
  live: { id: string; specId: string | null; exited: boolean }[];
  ready: { id: string; title: string; priority: string }[];
  inbox: LeadEventView[];
  approvals: LeadApprovalView[];
};

export async function buildBrief(projectId: string): Promise<{ text: string; data: LeadBrief }> {
  const [budget, sessions, ready, inbox, approvals] = await Promise.all([
    launchBudget(projectId),
    listSessionsAsync().catch(() => []),
    prisma.spec.findMany({ where: { ...UNSTARTED_SPEC_WHERE, projectId }, select: { id: true, title: true, priority: true }, orderBy: { id: "asc" }, take: 30 }),
    prisma.leadEvent.findMany({ where: { projectId, status: { in: ["open", "delivered"] } }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: 30 }),
    prisma.leadApproval.findMany({ where: { projectId, status: "pending" }, orderBy: { createdAt: "asc" } }),
  ]);
  const live = sessions.filter((s) => s.projectId === projectId && !s.id.startsWith("lead-"))
    .map((s) => ({ id: s.id, specId: s.specId ?? null, exited: s.exited }));
  const data: LeadBrief = { budget, live, ready, inbox: inbox.map(toEventView), approvals: approvals.map(toApprovalView) };
  const text = [
    `Jatah peluncuran: ${budget.n}${budget.reasons.length ? ` (${budget.reasons.join("; ")})` : ""}`,
    `Sesi pekerja: ${live.map((s) => `${s.id}${s.exited ? " (mati)" : ""}`).join(", ") || "tak ada"}`,
    `Backlog siap: ${ready.map((r) => `${r.id} [${r.priority}]`).join(", ") || "tak ada"}`,
    `Inbox terbuka: ${inbox.length} · Menunggu izin: ${approvals.length}`,
  ].join("\n");
  return { text, data };
}
```

(`toApprovalView` dibuat di Task 11. Sampai Task 11 selesai, buat `approvals.ts` minimal dengan `toApprovalView` saja agar kompilasi lulus, atau kerjakan Task 11 sebelum menjalankan test route Task 10.)

`server/src/routes/lead-pane.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { zLeadAct } from "@hanoman/shared";
import { verifySessionEventToken } from "../services/session-event-token";
import { getSessionAsync } from "../services/pty";
import { isLeadSessionId } from "../services/lead/lead-session";
import { processAct } from "../services/lead/act";
import { buildBrief } from "../services/lead/brief";
import { setBriefBuilder } from "../services/lead/courier";

// ADR-0228 · permukaan PANE LEAD. Kredensialnya token HMAC turunan per sesi (ADR-0146) — pola
// `/api/session-events`, dan karena itu COOKIE_ONLY di peta capability: agen yang bisa meniru
// "pane lead proyek X" bisa menggerakkan seluruh proyek itu. Itu peniruan identitas, bukan izin.

const bearer = (h: unknown) => typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : "";

async function paneOf(req: FastifyRequest): Promise<{ code: number; projectId?: string; error?: string }> {
  const id = String(req.headers["x-hanoman-session"] ?? "");
  const tok = bearer(req.headers.authorization);
  if (!id || !tok || !verifySessionEventToken(id, tok)) return { code: 401, error: "unauthorized" };
  if (!isLeadSessionId(id)) return { code: 403, error: "bukan pane lead" };
  const s = await getSessionAsync(id);
  if (!s || s.exited) return { code: 404, error: "pane lead tak hidup" };
  return { code: 200, projectId: s.projectId };
}

export default async function leadPane(app: FastifyInstance): Promise<void> {
  setBriefBuilder(async (p) => (await buildBrief(p)).text);

  app.get("/lead-pane/brief", async (req, reply) => {
    const p = await paneOf(req);
    if (p.code !== 200) return reply.code(p.code).send({ error: p.error });
    return buildBrief(p.projectId!);
  });

  app.post("/lead-pane/act", async (req, reply) => {
    const p = await paneOf(req);
    if (p.code !== 200) return reply.code(p.code).send({ error: p.error });
    const parsed = zLeadAct.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return processAct(p.projectId!, parsed.data);
  });
}
```

`app.ts`: tambah `if (path.startsWith("/api/lead-pane/")) return;` tepat setelah baris `/api/session-events` (`:223`) dengan komentar ADR-0228 yang sama polanya; registrasikan `leadPane` di blok route `/api` yang sama dengan `sessionEvents`. `agent-capabilities.ts:81`: `if (top === "session-events" || top === "lead-pane") return "COOKIE_ONLY";` dan tambah kalimat ADR-0228 ke komentar paragraf di atasnya. Perbarui `server/test/agent-capabilities.test.ts` bila ia mengunci daftar route COOKIE_ONLY.

- [ ] **Step 4: Test → PASS** (`server/test/lead-act.test.ts server/test/lead-pane.route.test.ts server/test/agent-capabilities.test.ts`).
- [ ] **Step 5: Commit** `feat(lead): pane lead memeriksa (brief) & bertindak (act) lewat token sesi, digerbangi server`

### Task 11: `approvals.ts` + Telegram Setujui/Tolak + route manusia

**Files:**
- Create: `server/src/services/lead/approvals.ts`
- Modify: `server/src/routes/lead.ts` (route baru), `server/src/services/telegram/notify.ts:45-80`, `server/src/services/telegram/gateway.ts:99-109`, `:172-174` (parser callback)
- Test: `server/test/lead-approvals.test.ts`, `server/test/lead-routes.test.ts` (tambah kasus)

**Interfaces:**
- Consumes: `resolveEvent`/`closeEvent`/`openEvent` (Task 6), `setCreateApproval` (Task 10), `recordLeadDecision` (notifikasi), `pushDecisionToTelegram` (`telegram/notify.ts:59`).
- Produces:
  - `createApproval(i: { eventId; projectId; act: LeadAct; report: string[]; target: string | null }): Promise<{ id: string }>` — menyimpan, notifikasi weighty, push Telegram dengan tombol
  - `decideApproval(id: string, d: { approve: boolean; by: string; note?: string }): Promise<LeadApprovalView | null>` — `approved` → `resolveEvent(eventId, verdict)`; `rejected` → `closeEvent(eventId, "rejected")` + `openEvent({ kind: "rejected", question: "Manusia menolak …", payload: { prompt: <ringkasan + note> } })`. Idempoten: hanya `pending` yang berpindah (updateMany count).
  - `expireApprovals(now: number, ttlMs: number): Promise<number>` — pending lewat TTL → `expired` + `closeEvent(eventId, "rejected")` + event `rejected` ke lead
  - `toApprovalView(a: LeadApproval): LeadApprovalView`
  - Route: `GET /lead/approvals?projectId&status&page&limit`, `POST /lead/approvals/:id/decide` body `{ approve: boolean, note?: string }` (409 bila bukan pending), `GET /lead/inbox?projectId&status&page&limit`, `POST /lead/inbox/:id/take` (manusia mengambil event → `closeEvent(id,"human")`, 409 bila tertutup)
  - Telegram callback `tgla:<approvalId>:approve|deny` → `decideApproval(id, { approve, by: "telegram:<userId>" })`

- [ ] **Step 1: Test gagal** `server/test/lead-approvals.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { createApproval, decideApproval, expireApprovals } from "../src/services/lead/approvals";
import { openEvent, awaitEvent, __resetInbox } from "../src/services/lead/inbox";
import { postDecision } from "../src/services/lead/post";

const payload = { prompt: "p", gate: "pulse" as const, leadKind: "quality" as const, options: [], select: null };
const act = (eventId: string) => ({ eventId, verdict: { decision: "merge", reason: "hijau", refs: [], confidence: "tinggi" as const, action: "integrate-main", choice: "", choices: [], missing: [] }, evidence: ["SPEC-1"] });
beforeEach(async () => { await prisma.leadApproval.deleteMany(); await prisma.leadEvent.deleteMany(); await prisma.notification.deleteMany(); __resetInbox(); });

describe("approval lead", () => {
  it("setujui → penunggu event menerima verdict yang ditahan", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload, sessionId: "spec-1", specId: "SPEC-1" });
    const w = awaitEvent(e.id, 2000);
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: ["wewenang ask"], target: "spec-1" });
    const v = await decideApproval(id, { approve: true, by: "operator" });
    expect(v?.status).toBe("approved");
    const r = await w;
    expect(r.status).toBe("answered");
  });
  it("setujui event denyut (mode post) → tindakan dijalankan tanpa penunggu", async () => {
    await prisma.leadDecision.deleteMany(); await prisma.leadFlow.deleteMany();
    await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.setting.deleteMany();
    await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
    await setLead({ ...LEAD_DEFAULTS, enabled: true });
    const e = (await postDecision({ projectId: "demo", gate: "pulse", kind: "quality", question: "Backlog X sudah selesai", options: ["none — biarkan"] }))!;
    const { id } = await createApproval({ eventId: e.id, projectId: "demo", act: { ...act(e.id), verdict: { ...act(e.id).verdict, action: "none" } }, report: [], target: null });
    await decideApproval(id, { approve: true, by: "operator" });
    const row = await prisma.leadDecision.findFirst({ where: { eventId: e.id } });
    expect(row?.status).toBe("berlaku");
  });
  it("tolak → event lead ditutup + event `rejected` baru untuk lead", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: null });
    await decideApproval(id, { approve: false, by: "operator", note: "tunggu review" });
    const rej = await prisma.leadEvent.findFirst({ where: { kind: "rejected" } });
    expect(rej?.question).toContain("menolak");
    expect(JSON.stringify(rej?.payload)).toContain("tunggu review");
  });
  it("keputusan kedua ditolak (idempoten)", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: null });
    await decideApproval(id, { approve: true, by: "a" });
    expect(await decideApproval(id, { approve: false, by: "b" })).toBeNull();
  });
  it("kedaluwarsa tak pernah menjalankan tindakan", async () => {
    const e = await openEvent({ projectId: "p", kind: "session-ended", question: "q", payload });
    const { id } = await createApproval({ eventId: e.id, projectId: "p", act: act(e.id), report: [], target: null });
    await prisma.leadApproval.update({ where: { id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect(await expireApprovals(Date.now(), 86_400_000)).toBe(1);
    expect((await prisma.leadApproval.findUnique({ where: { id } }))?.status).toBe("expired");
  });
});
```

Tambah ke `lead-routes.test.ts`: `POST /api/lead/approvals/:id/decide` 200 lalu 409 untuk keputusan kedua; `POST /api/lead/inbox/:id/take` 200 lalu 409.

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi** `server/src/services/lead/approvals.ts`:

```ts
import type { LeadApproval, Prisma } from "@prisma/client";
import { zLeadVerdict, type LeadAct, type LeadApprovalView } from "@hanoman/shared";
import { prisma } from "../../db";
import { closeEvent, openEvent, resolveEvent } from "./inbox";
import { setCreateApproval } from "./act";
import { executeEventVerdict } from "./post";
import { recordLeadNotice } from "../notifications";
import { pushApprovalToTelegram } from "../telegram/notify";

// ADR-0228 · ANTREAN IZIN. Verdict lead DITAHAN apa adanya; persetujuan melepaskannya ke penunggu
// event yang sama, jadi tindakan yang jalan persis yang dilihat manusia. Kedaluwarsa = ditolak:
// tak ada tindakan lead yang pernah jalan karena manusia diam.

const str = (j: unknown): string[] => Array.isArray(j) ? j.map(String) : [];
export function toApprovalView(a: LeadApproval): LeadApprovalView {
  return {
    id: a.id, eventId: a.eventId, projectId: a.projectId, action: a.action, target: a.target,
    reason: a.reason, evidence: str(a.evidence), gateReport: str(a.gateReport),
    status: a.status as LeadApprovalView["status"], decidedBy: a.decidedBy,
    decidedAt: a.decidedAt?.toISOString() ?? null, note: a.note, createdAt: a.createdAt.toISOString(),
  };
}

export async function createApproval(i: { eventId: string; projectId: string; act: LeadAct; report: string[]; target: string | null }): Promise<{ id: string }> {
  const a = await prisma.leadApproval.create({ data: {
    eventId: i.eventId, projectId: i.projectId, action: i.act.verdict.action, target: i.target,
    reason: i.act.verdict.reason, evidence: i.act.evidence as Prisma.InputJsonValue,
    gateReport: i.report as Prisma.InputJsonValue, verdict: i.act.verdict as unknown as Prisma.InputJsonValue,
  } });
  const title = `Lead minta izin · ${a.action}${a.target ? ` ${a.target}` : ""}: ${i.act.verdict.decision.slice(0, 90)}`;
  await recordLeadNotice(title, i.projectId).catch(() => null);
  await pushApprovalToTelegram({ id: a.id, title, reason: a.reason, report: i.report }).catch(() => 0);
  return { id: a.id };
}

export async function decideApproval(id: string, d: { approve: boolean; by: string; note?: string }): Promise<LeadApprovalView | null> {
  const moved = await prisma.leadApproval.updateMany({
    where: { id, status: "pending" },
    data: { status: d.approve ? "approved" : "rejected", decidedBy: d.by, decidedAt: new Date(), note: d.note ?? null },
  });
  if (moved.count !== 1) return null;
  const a = (await prisma.leadApproval.findUnique({ where: { id } }))!;
  if (d.approve) {
    const v = zLeadVerdict.parse(a.verdict);
    const ev = await prisma.leadEvent.findUnique({ where: { id: a.eventId }, select: { payload: true } });
    const ok = await resolveEvent(a.eventId, { verdict: v, evidence: str(a.evidence) });
    if (!ok) await prisma.leadApproval.update({ where: { id }, data: { note: `${a.note ?? ""} (event sudah tertutup — tak ada yang dijalankan)`.trim() } });
    // Task 7b · event denyut tak punya penunggu: izin yang disetujui MENJALANKANNYA di sini.
    else if ((ev?.payload as { mode?: string } | null)?.mode === "post")
      await executeEventVerdict(a.eventId, v, undefined, { alreadyClosed: true });
  } else {
    await rejectBack(a, d.note ?? null, "menolak");
  }
  return toApprovalView((await prisma.leadApproval.findUnique({ where: { id } }))!);
}

async function rejectBack(a: LeadApproval, note: string | null, verb: string): Promise<void> {
  await closeEvent(a.eventId, "rejected");
  await openEvent({
    projectId: a.projectId, kind: "rejected",
    question: `Manusia ${verb} ${a.action}${a.target ? ` ${a.target}` : ""}`,
    payload: { prompt: `Manusia ${verb} tindakanmu \`${a.action}\`${a.target ? ` untuk ${a.target}` : ""}.\nAlasanmu: ${a.reason}\nCatatan manusia: ${note ?? "(tanpa catatan)"}\nSesuaikan langkahmu; jawab event ini dengan action \`none\` setelah kamu mencatat penyesuaiannya.`, gate: "contract", leadKind: "answer", options: [], select: null },
  });
}

export async function expireApprovals(now: number, ttlMs: number): Promise<number> {
  const due = await prisma.leadApproval.findMany({ where: { status: "pending", createdAt: { lt: new Date(now - ttlMs) } } });
  let n = 0;
  for (const a of due) {
    const moved = await prisma.leadApproval.updateMany({ where: { id: a.id, status: "pending" }, data: { status: "expired", decidedAt: new Date(now) } });
    if (moved.count === 1) { n++; await rejectBack(a, null, "tak menjawab (kedaluwarsa)"); }
  }
  return n;
}

setCreateApproval(createApproval);
```

Catatan:
- `recordLeadNotice(title, projectId)` — cari fungsi notifikasi weighty yang paling dekat di `server/src/services/notifications.ts` (`recordLeadDecision` butuh decisionId). Bila tak ada yang cocok, tambah `recordLeadNotice` di sana mengikuti pola `recordLeadDecision`.
- `pushApprovalToTelegram` baru di `telegram/notify.ts`, salin pola `pushDecisionToTelegram` (`:59-80`) tetapi kirim `reply_markup: { inline_keyboard: [[{ text: "Setujui", callback_data: `tgla:${id}:approve` }, { text: "Tolak", callback_data: `tgla:${id}:deny` }]] }` (bentuk `gateway.ts:172-174`). Teks: judul, alasan, laporan gerbang (≤ 1500 karakter).
- `gateway.ts`: perluas parser callback (cari pembentuk `input.callbackToken`/`callbackAction`) supaya `tgla:` menghasilkan `input.leadApprovalId` + `callbackAction`. Di cabang `input.kind === "callback"` (`:99`), sebelum `resolveConfirmation`, tambah:

```ts
      if (input.leadApprovalId && input.callbackAction && input.callbackQueryId) {
        // ADR-0228 · tombol izin lead. Identitas chat/operator sudah diverifikasi gerbang di atas.
        const v = await this.deps.decideLeadApproval(input.leadApprovalId, {
          approve: input.callbackAction === "approve", by: `telegram:${input.userId}`,
        });
        await this.deps.client.answerCallbackQuery({ callbackQueryId: input.callbackQueryId,
          text: v ? (v.status === "approved" ? "Disetujui" : "Ditolak") : "Sudah diputuskan / tak berlaku" });
        await this.deps.store.markDispatched(input.updateId);
        return;
      }
```

  tambah `decideLeadApproval` ke deps gateway (prod = `decideApproval`). Tambah test di test gateway yang ada (`server/test/telegram-gateway*.test.ts`) untuk callback `tgla:`.
- Route di `routes/lead.ts` (cookie atau agent token — capability lewat `agent-capabilities.ts`, Task 13):

```ts
  app.get("/lead/approvals", async (req) => {
    const q = req.query as { projectId?: string; status?: string; page?: string; limit?: string };
    return listApprovalsPage(q);
  });
  app.post("/lead/approvals/:id/decide", async (req, reply) => {
    const body = z.object({ approve: z.boolean(), note: z.string().max(2000).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const by = actorLabel(req);   // cookie user / agent token id — pakai helper aktor yang dipakai override (`routes/lead.ts:170`)
    const v = await decideApproval((req.params as { id: string }).id, { ...body.data, by });
    return v ?? reply.code(409).send({ error: "izin sudah diputuskan atau tak ada" });
  });
  app.get("/lead/inbox", async (req) => listInboxPage(req.query as { projectId?: string; status?: string; page?: string; limit?: string }));
  app.post("/lead/inbox/:id/take", async (req, reply) => {
    const ok = await closeEvent((req.params as { id: string }).id, "human");
    return ok ? { ok: true } : reply.code(409).send({ error: "event sudah ditutup" });
  });
```

  `listApprovalsPage`/`listInboxPage` mengikuti pola paginasi `listDecisions` (`trail.ts:79`, `{ items, total, page, pageSize }`, default 20, maks 100). Taruh di `approvals.ts` dan `inbox.ts`.

- [ ] **Step 4: Test → PASS** (`server/test/lead-approvals.test.ts server/test/lead-routes.test.ts` + test gateway Telegram).
- [ ] **Step 5: Commit** `feat(lead): antrean izin — setujui/tolak di UI & Telegram, kedaluwarsa = ditolak`

---

## Fase 4 — Denyut, pemutus, engine

### Task 12: `pulse.ts` — ambil backlog berbasis jatah, pemutus beruntun, opsi tindak lanjut

**Files:**
- Modify: `server/src/services/lead/pulse.ts:142-158` (`lastReadySig`, `pulse`), `:171-232` (`followUpFinished` opsi), `:250-335` (`followUpComplete` opsi), `:337-421` (`orderReadyWork`/`orderProject` → `pickReadyWork`)
- Test: `server/test/lead-pulse.test.ts` (modify)

**Interfaces:**
- Consumes: `launchBudget` (Task 3), `specIdOfOption` (Task 10).
- Produces: `PulseDeps` += `budget: (projectId: string) => Promise<Budget>`, `pauseProject: (projectId: string, why: string) => Promise<void>`; `PulseResult` += `picked: number; tripped: number`.

**Semua sub-pintu denyut** (`followUpFinished`, `followUpComplete`, `detectCollisions`, `pickProject`) memakai `postDecision` (Task 7b) — **bukan** `decideOrSkip`/`decide` — dan langsung kembali; eksekusi (apply/enqueue/event `integrate-failed`) terjadi di `executeEventVerdict` saat lead `act` atau izin disetujui. Dedupe tiap sub-pintu: pemeriksaan jejak yang ada (`leadDecision.findFirst … startsWith mark`) **ditambah** `hasOpenPosted(projectId, mark)` supaya event yang belum dijawab tak dibuka ulang tiap denyut. `PulseResult` menghitung event yang DIBUKA.

Perilaku baru `pickProject(projectId)`:
1. Gerbang lama dipertahankan: scheduler aktif, `schedulerOptIn`.
2. `budget = deps.budget(projectId)`; `budget.tripped` → `deps.pauseProject(projectId, reasons)` sekali (pause = tambahkan ke `pausedProjects` + notifikasi weighty) → return 0.
3. `budget.n < 1` → 0 (tak ada event).
4. `pending` dihitung seperti `orderProject` (ready ∧ tanpa blocker ∧ belum antre), **tanpa** syarat "≥ 2" dan **tanpa** `lastReadySig` (dedupe kini: tak membuka event pulse baru bila masih ada event `pulse` terbuka untuk proyek itu — cek `prisma.leadEvent.findFirst({ where: { projectId, kind: "pulse", status: { in: ["open","delivered"] } } })`).
5. `postDecision` dengan `kind: "order"`, pertanyaan: `Jatah peluncuran ${budget.n}. Pilih paling banyak ${budget.n} backlog yang paling layak diluncurkan SEKARANG (periksa spec/plan/dependensinya dulu), atau action \`none\` bila tak ada yang layak. Action: \`start-session\`; isi \`choices\` dengan label opsi persis.`, `options` label `id · [prio] judul`, `select: { mode: "multi", min: 0, max: budget.n }`.
6. Enqueue **hanya** pilihan lead terjadi di `executeEventVerdict` (Task 7b), sesudah guard `act` (Task 10). Tidak ada lagi "sisa masuk antrean di belakang", dan `pulse` sendiri tak pernah meng-enqueue.

Opsi `followUpComplete` menjadi:
```ts
      options: [
        `integrate-main — merge branch sesi ini ke ${target}; server menjalankan verifikasi lebih dulu, panenya dilepas, worktree utuh`,
        "resume-session — lanjutkan sesi: masih ada yang perlu dikerjakan sebelum integrasi (tulis apa di `decision`)",
        "stop-session — lepas panenya tanpa mengintegrasikan (worktree tetap utuh)",
        "none — biarkan sesinya berdiri, sertakan alasan kenapa slot itu layak ditahan",
      ],
```
(`target` = `leadProjectConfig(cfg, s.projectId).targetBranch`; ganti kata "main" di pertanyaan dengan `target`). `followUpFinished` mendapat opsi tambahan `"stop-session — hentikan; worktree utuh"`. Integrasi gagal → event `integrate-failed` dibuka oleh `executeEventVerdict` (Task 7b), bukan oleh `pulse`.

- [ ] **Step 1: Test gagal** — tambah ke `server/test/lead-pulse.test.ts` (harness pulse yang ada sudah menyuntik `decide`, `enqueue`, `sessions`; tambahkan `budget`, `pauseProject`):

```ts
describe("denyut berbasis jatah (ADR-0228)", () => {
  it("regresi 2026-10-20: 7 backlog siap, jatah 1 → event meminta paling banyak 1 pilihan", async () => {
    // 7 spec siap di proyek demo (schedulerOptIn); post palsu merekam permintaan
    const h = harness({ budget: async () => ({ n: 1, reasons: [], tripped: false }) });
    await pulse(h.deps);
    expect(h.t.posted).toHaveLength(1);
    expect(h.t.posted[0].select).toMatchObject({ mode: "multi", max: 1 });
    expect(h.t.enqueued).toEqual([]);        // denyut tak pernah meng-enqueue sendiri
  });
  it("jatah 0 → tak ada event denyut", async () => {
    const h = harness({ budget: async () => ({ n: 0, reasons: ["kuota 90%"], tripped: false }) });
    await pulse(h.deps);
    expect(h.t.posted.filter((r) => r.kind === "order")).toEqual([]);
  });
  it("pemutus menyala → proyek di-pause sekali", async () => {
    const h = harness({ budget: async () => ({ n: 0, reasons: ["2 gagal"], tripped: true }) });
    await pulse(h.deps); await pulse(h.deps);
    expect(h.t.paused).toEqual(["demo"]);
  });
  it("event denyut masih terbuka → tak membuka yang baru", async () => {
    const h = harness({ budget: async () => ({ n: 1, reasons: [], tripped: false }), openPosted: async () => true });
    await pulse(h.deps);
    expect(h.t.posted.filter((r) => r.kind === "order")).toEqual([]);
  });
  it("pulse tak pernah menunggu jawaban pane", async () => {
    const h = harness({ budget: async () => ({ n: 1, reasons: [], tripped: false }) });
    const t0 = Date.now();
    await pulse(h.deps);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
```

Ganti dep `decide`/`decideDeps` di `PulseDeps` dengan `post: typeof postDecision` dan `openPosted: typeof hasOpenPosted`; harness merekam `posted` (request yang dikirim). Sesuaikan nama field dengan `server/test/lead-pulse.test.ts` yang ada (baca dulu). Penolakan "memilih melebihi jatah" diuji di `lead-act.test.ts` (Task 10); enqueue hanya-pilihan diuji di `lead-post.test.ts` (Task 7b). Hapus test lama yang mengunci "minimal dua item", "sisa masuk antrean di belakang", dan `apply` yang dipanggil dari dalam `pulse`.

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi** sesuai uraian di atas. Hapus `lastReadySig`/`__resetPulse` (perbarui pemanggil test). `prodPulseDeps.budget = (p) => launchBudget(p)`; `prodPulseDeps.pauseProject`:

```ts
  pauseProject: async (projectId, why) => {
    const cfg = await getLead();
    if (cfg.pausedProjects.includes(projectId)) return;
    await setLead({ ...cfg, pausedProjects: [...cfg.pausedProjects, projectId] });
    await recordLeadNotice(`Lead menjeda ${projectId}: ${why}`, projectId).catch(() => null);
  },
```

- [ ] **Step 4: Test → PASS** (`server/test/lead-pulse.test.ts server/test/lead-engine.test.ts`).
- [ ] **Step 5: Commit** `feat(lead): denyut memilih ≤ jatah backlog, pemutus beruntun mem-pause proyek, integrasi gagal jadi event`

### Task 13: Engine tick + route sesi lead + MCP + capability

**Files:**
- Modify: `server/src/services/lead/engine.ts:69-130`
- Modify: `server/src/routes/lead.ts` (route sesi)
- Modify: `shared/src/mcp-catalog/lead.ts` (tool baru), `shared/src/mcp-catalog.test.ts:114-115`
- Modify: `server/src/services/agent-capabilities.ts` (route `lead/*` baru → capability)
- Test: `server/test/lead-engine.test.ts`, `server/test/lead-routes.test.ts`, `shared/src/mcp-catalog.test.ts`, `server/test/agent-capabilities.test.ts`

**Interfaces:**
- Produces:
  - Tick menambah (urut): `sweepInbox(now, deliverTimeoutSec*1000)`; `expireApprovals(now, approvalTtlMin*60_000)`; per proyek opt-in & aktif: `ensureLeadSession` (bila ada event open atau pane mati) dengan pause+notifikasi saat `leadSessionFailures(p) >= 3`; `deliverAll(projects)`.
  - Route: `POST /lead/sessions/:projectId/start` → `{ id, started }` (409 lead tak aktif), `POST /lead/sessions/:projectId/stop` → `{ stopped }`, `POST /lead/sessions/:projectId/rotate` → `{ ok }`.
  - Peta capability: `GET /lead/approvals`, `GET /lead/inbox` → `lead:read`; `POST /lead/approvals/:id/decide` → `lead:approve`; `POST /lead/inbox/:id/take` → `lead:write`; `POST /lead/sessions/*` → `lead:write`.
  - MCP tools: `hanoman_lead_inbox` (read, `lead:read`), `hanoman_lead_approvals_list` (read, `lead:read`), `hanoman_lead_approval_decide` (danger, `lead:approve`), `hanoman_lead_inbox_take` (write, `lead:write`), `hanoman_lead_session_start`/`_stop`/`_rotate` (danger, `lead:write`).

- [ ] **Step 1: Test gagal**
  - `lead-engine.test.ts`: tick memanggil sweep inbox & approval sekali per tick (suntik deps); 3 kegagalan lahir → proyek masuk `pausedProjects`.
  - `agent-capabilities.test.ts`:

```ts
it("ADR-0228 · route lead baru dipetakan per method", () => {
  expect(capabilityForRoute("GET", "/api/lead/approvals")).toBe("lead:read");
  expect(capabilityForRoute("POST", "/api/lead/approvals/a1/decide")).toBe("lead:approve");
  expect(capabilityForRoute("POST", "/api/lead/inbox/e1/take")).toBe("lead:write");
  expect(capabilityForRoute("POST", "/api/lead/sessions/p/start")).toBe("lead:write");
  expect(capabilityForRoute("POST", "/api/lead-pane/act")).toBe("COOKIE_ONLY");
});
```

  - `mcp-catalog.test.ts`: tambah ketujuh nama ke daftar tool lead yang dikunci; `hanoman_lead_approval_decide` `mode: "danger"`, capability `lead:approve`.

- [ ] **Step 2: Jalankan → FAIL.**

- [ ] **Step 3: Implementasi**
  - `agent-capabilities.ts`: prefix `lead` saat ini dipetakan ke `lead:read`/`lead:write` (`:140`). Tambah sebelum pemetaan umum itu:

```ts
  // ADR-0228 · memutuskan izin lead bisa MERGE ke branch target — capability danger tersendiri,
  // bukan `lead:write` (pane lead & agen peminta putusan memegang write; mereka tak boleh
  // menyetujui tindakannya sendiri — ADR-0192).
  if (top === "lead" && method === "POST" && seg.length === 4 && seg[1] === "approvals" && seg[3] === "decide") return "lead:approve";
```

  - MCP entries, pola `hanoman_lead_decision_cancel` (`shared/src/mcp-catalog/lead.ts:167-177`), contoh:

```ts
  {
    name: "hanoman_lead_approval_decide",
    title: "Setujui/tolak tindakan lead (BERBAHAYA)",
    description:
      "BERBAHAYA — menyetujui atau menolak tindakan hanoman-lead yang menunggu izin. Menyetujui MENJALANKAN tindakan itu apa adanya (mis. merge branch sesi ke branch target setelah server memverifikasi). Baca dulu kartunya lewat hanoman_lead_approvals_list. Izin yang sudah diputuskan menjawab 409. Butuh capability `lead:approve`.",
    inputSchema: obj({ properties: {
      approval: str("Id izin."), approve: { type: "boolean", description: "true = setujui, false = tolak." },
      note: str("Catatan untuk lead (opsional)."),
    }, required: ["approval", "approve"] }),
    mode: "danger", capability: "lead:approve",
    samplePath: "/lead/approvals/a1/decide", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/lead/approvals/${enc(String(a.approval))}/decide`,
      body: { approve: Boolean(a.approve), ...(s(a.note) ? { note: s(a.note) } : {}) } }),
    shape: (raw) => raw,
  },
```

  Tulis enam lainnya dengan pola yang sama (list memakai `page`/`limit`, `projectId`, `status`; session tools `{ project }` → `/lead/sessions/${enc(project)}/start|stop|rotate`, `mode: "danger"`). `hanoman_lead_ask`: perbarui `description` — "pertanyaan masuk inbox sesi lead proyek dan dijawab pane lead; menunggu sampai tenggat `answerSlaSec`, lalu 504 bila tak terjawab".
  - Route sesi di `routes/lead.ts`:

```ts
  app.post("/lead/sessions/:projectId/start", async (req, reply) => {
    const r = await ensureLeadSession((req.params as { projectId: string }).projectId).catch((e) => ({ error: (e as Error).message }));
    if (!r) return reply.code(409).send({ error: "lead tidak aktif untuk project ini (atau sedang backoff)" });
    if ("error" in r) return reply.code(500).send(r);
    return r;
  });
  app.post("/lead/sessions/:projectId/stop", async (req) => ({ stopped: stopLeadSession((req.params as { projectId: string }).projectId) }));
  app.post("/lead/sessions/:projectId/rotate", async (req) => { await rotateLeadSession((req.params as { projectId: string }).projectId); return { ok: true }; });
```

  - `routes/lead.ts` `POST /lead/decisions` (kontrak): ganti cabang `LeadBusyError` 503 → hapus; `row.status === "gagal"` tetap 504 (kini berarti "lead tak menjawab dalam tenggat — manusia"). Perbarui komentar.
  - `engine.ts` tick: tambah blok setelah `expireFlows`:

```ts
    // ADR-0228 · sapuan sesi lead menumpang tick yang sama (ADR-0024: tanpa timer baru).
    const cfg = await getLead();
    await sweepInbox(now, cfg.deliverTimeoutSec * 1000).catch(() => null);
    await expireApprovals(now, cfg.approvalTtlMin * 60_000).catch(() => null);
    if (cfg.enabled && !cfg.paused) {
      const projects = (await leadProjects()).filter((p) => leadActive(cfg, p));
      for (const p of projects) {
        const hasWork = !!(await prisma.leadEvent.findFirst({ where: { projectId: p, status: "open" }, select: { id: true } }));
        if (hasWork) await ensureLeadSession(p).catch(() => null);
        if (leadSessionFailures(p) >= 3) await pauseLeadProject(p, "pane lead gagal lahir 3× beruntun");
        // Spec §4 · lead diam terlalu lama: event yang sudah dua kali dikembalikan sapuan berarti
        // pane macet di gilirannya — rotasi, sekali per event (attempts dinaikkan sapuan).
        const stuck = await prisma.leadEvent.findFirst({ where: { projectId: p, status: "open", attempts: { gte: 2 } }, select: { id: true } });
        if (stuck) {
          await prisma.leadEvent.updateMany({ where: { projectId: p, status: "open", attempts: { gte: 2 } }, data: { attempts: 0 } });
          await rotateLeadSession(p).catch(() => null);
        }
      }
      await deliverAll(projects);
    }
```

  `pauseLeadProject` = fungsi yang sama dengan `prodPulseDeps.pauseProject` (Task 12) — ekstrak ke `lead/config.ts` sebagai `pauseLeadProject(projectId, why)` dan pakai di kedua tempat. Pastikan `engine.ts` mengimpor `./courier` dan `./approvals` (memasang hook `setEventOpenedHook`/`setCreateApproval` saat start).

- [ ] **Step 4: Test → PASS.**
- [ ] **Step 5: Commit** `feat(lead): engine menyapu inbox/izin & menghidupkan pane lead; route sesi, MCP & capability lead:approve`

---

## Fase 5 — View, realtime, UI

### Task 14: `LeadStatusView` + LeadScreen (Sesi, Inbox, Izin, Wewenang)

**Files:**
- Modify: `shared/src/dto.ts` (`LeadStatusView` — tambah `inbox`, `approvals`, `sessions`), `server/src/services/lead/views.ts:16-55`
- Modify: `src/src/screens/LeadScreen.tsx`, `src/src/api.ts` (atau klien API yang dipakai `api.putLeadConfig`)
- Create: `src/src/screens/lead/LeadSessionsPanel.tsx`, `src/src/screens/lead/LeadInboxPanel.tsx`, `src/src/screens/lead/LeadApprovalsPanel.tsx`, `src/src/screens/lead/LeadAuthorityPanel.tsx`
- Test: `server/test/lead-views.test.ts` (create), `src/src/screens/lead/LeadApprovalsPanel.test.tsx` (create; ikuti pola test komponen yang ada — `ls src/src/**/*.test.tsx | head`)

**Interfaces:**
- Produces: `LeadStatusView` += `inbox: LeadEventView[]` (open/delivered/late 24 jam terakhir, maks 50), `approvals: LeadApprovalView[]` (pending), `sessions: LeadSessionView[]`. Topik ws `lead` (`events-topics.ts`) otomatis membawanya karena memakai `buildLeadStatus()`.
- Klien API: `api.leadApprovalDecide(id, approve, note?)`, `api.leadInboxTake(id)`, `api.leadSessionStart(p)`, `api.leadSessionStop(p)`, `api.leadSessionRotate(p)`.

UI (ikuti `internal/docs/design-system/**`: editorial, bone paper, brass accent; baca dulu komponen panel yang sudah dipakai LeadScreen dan pakai ulang primitifnya):
- **Sesi Lead** (per proyek opt-in): status hidup/mati/diam/manusia-aktif, jumlah event terkirim, tombol **Buka terminal** (`onGotoTerminal(sessionId)` — prop sudah ada di `LeadScreenProps`), **Mulai**, **Hentikan**, **Rotasi**.
- **Menunggu izin**: kartu per approval — tindakan, target, alasan lead, bukti (daftar), laporan gerbang (daftar), umur; tombol **Setujui** / **Tolak** (Tolak membuka input catatan opsional). Setelah aksi, toast + daftar diperbarui dari frame ws berikutnya (jangan mutasi state lokal secara optimistis untuk status).
- **Inbox**: tabel event (jenis, pertanyaan terpangkas, status, umur, tenggat tersisa untuk `ask`); tombol **Ambil alih** untuk event `open`/`delivered` → `api.leadInboxTake` lalu `onGotoTerminal(event.sessionId)` bila ada.
- **Wewenang & proyek** (di panel setelan yang ada, `useServerDraft`): per proyek — pilih mode `auto/ask/off` untuk `answer-session`, `start-session`, `integrate-main`, `stop-session`, `resume-session`; field `targetBranch`, `verifyCommand` (dengan teks bantu: "kosong = merge selalu minta izin"), `quotaStopPct`, `rampStep`, `rampProbeMin`, `failStreak`, `answerSlaSec`. Hapus kontrol `maxConcurrent`/`queueWaitSec`/`timeoutSec` dari form (Task 15 mencabut knobnya).

- [ ] **Step 1: Test gagal**
  - `server/test/lead-views.test.ts`: buat 1 event open, 1 approval pending → `buildLeadStatus()` memuat keduanya; event `done` tak muncul.
  - `LeadApprovalsPanel.test.tsx`: render 1 approval → tombol Setujui memanggil `onDecide(id, true)`; Tolak + catatan memanggil `onDecide(id, false, "catatan")`.

- [ ] **Step 2: Jalankan → FAIL** (`pnpm vitest --run src/src/screens/lead` untuk frontend; perintah Global Constraints untuk server).
- [ ] **Step 3: Implementasi.** Komponen panel menerima data + callback lewat props (tanpa fetch sendiri); `LeadScreen` mengisinya dari `state` (frame `lead`) dan memanggil `api.*`. Contoh kerangka `LeadApprovalsPanel.tsx`:

```tsx
import * as React from "react";
import type { LeadApprovalView } from "@hanoman/shared";

export type LeadApprovalsPanelProps = {
  approvals: LeadApprovalView[];
  busy: boolean;
  onDecide: (id: string, approve: boolean, note?: string) => void;
};

// ADR-0228 · kartu izin: manusia melihat PERSIS apa yang akan dijalankan — tindakan, target,
// alasan lead, bukti, dan laporan gerbang server.
export function LeadApprovalsPanel({ approvals, busy, onDecide }: LeadApprovalsPanelProps) {
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  if (!approvals.length) return <p className="lead-empty">Tak ada tindakan yang menunggu izin.</p>;
  return (
    <ul className="lead-approvals">
      {approvals.map((a) => (
        <li key={a.id} className="lead-approval">
          <header><strong>{a.action}</strong>{a.target ? <> · {a.target}</> : null}</header>
          <p>{a.reason}</p>
          {a.evidence.length > 0 && <><h4>Bukti</h4><ul>{a.evidence.map((e) => <li key={e}>{e}</li>)}</ul></>}
          {a.gateReport.length > 0 && <><h4>Gerbang</h4><ul>{a.gateReport.map((g) => <li key={g}>{g}</li>)}</ul></>}
          {rejecting === a.id ? (
            <div className="lead-approval-reject">
              <label>Catatan untuk lead<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <button disabled={busy} onClick={() => { onDecide(a.id, false, note || undefined); setRejecting(null); setNote(""); }}>Kirim penolakan</button>
              <button onClick={() => setRejecting(null)}>Batal</button>
            </div>
          ) : (
            <div className="lead-approval-actions">
              <button disabled={busy} onClick={() => onDecide(a.id, true)}>Setujui</button>
              <button disabled={busy} onClick={() => setRejecting(a.id)}>Tolak</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
```

  Nama kelas CSS: pakai kelas/komponen panel yang sudah dipakai LeadScreen (baca `LeadScreen.tsx` bagian render), bukan kelas baru, kecuali tak ada padanan. Tiga panel lain dibuat dengan pola props yang sama.

- [ ] **Step 4: Test → PASS.** Lalu bukti render: boot dev server (`pnpm dev`), buka layar Lead, ambil screenshot (skill `run`/browser-testing bila tersedia) di lebar desktop dan 390px.
- [ ] **Step 5: Commit** `feat(ui): layar Lead — sesi lead, inbox, antrean izin, wewenang per proyek`

---

## Fase 6 — Pencabutan brain

### Task 15: Hapus brain, gerbang konkurensi, knob lama

**Files:**
- Delete: `server/src/services/lead/brain.ts`, `server/src/services/lead/gate.ts`, `server/test/lead-brain.test.ts`, `server/test/lead-engine-argv.test.ts` (bila hanya menguji argv brain), `server/test/lead-gate.test.ts`
- Modify: `shared/src/entities.ts` (`zLead`: hapus `maxConcurrent`, `queueWaitSec`, `timeoutSec` — `zod` default mengabaikan kunci lama pada baris Setting yang ada; pastikan skema tidak `.strict()`), `server/src/services/lead/ask.ts:79-104` (`AskDeps.maxConcurrent`), `server/src/services/lead/pulse.ts` (`decideOrSkip` tanpa `LeadBusyError`), `server/src/services/lead/detect.ts` (pemakai `LeadBusyError`), `server/src/routes/lead.ts`, `server/src/services/lead/prompt.ts:44-54` (paragraf anggaran waktu — kini dari `thinkTimeoutMs`), `server/test/lead-routes.test.ts` (hapus `vi.mock("../src/services/lead/brain")` dan suntik `think` lewat mock `session-think`), `server/test/antigravity-lead-defaults.test.ts` (periksa: bila menguji argv brain, hapus; bila menguji `leadAgentDefaults`, pertahankan)
- Test: seluruh `server/test/lead-*.test.ts`, `shared/src/lead*.test.ts`

- [ ] **Step 1:** `grep -rn "brain\|runGated\|LeadBusyError\|queueWaitSec\|maxConcurrent\|timeoutSec\|__resetLeadGate\|markQueued\|clearQueued" server/src/services/lead server/src/routes/lead.ts server/test/lead-* shared/src src/src/screens/LeadScreen.tsx` — catat setiap pemakai.
- [ ] **Step 2:** Hapus/ubah tiap pemakai:
  - `decideOrSkip` → panggil `deps.decide` langsung (tak ada lagi backpressure untuk ditangkap); hapus komentar SPEC-479 yang tak berlaku, sisakan satu baris rujukan ADR-0228.
  - `ask.ts` worker: hapus `maxConcurrent` dari deps dan pembatas paralel antar-sesi yang memakainya — antrean per sesi tetap (ADR-0223); paralelisme kini milik inbox.
  - `deciding.ts`: hapus `markQueued`/`clearQueued`/`isQueued` bila tak ada pemakai lagi; `views.ts` `queued` di `LeadStatusView` → diganti `inbox` (hapus field `queued`, `deciding` tetap).
  - `routes/lead.ts:131-147`: hapus cabang 503.
  - Test: setiap `vi.mock(".../brain")` diganti `vi.mock("../src/services/lead/session-think", async (orig) => ({ ...(await orig()), thinkViaSession: async () => leadOutput.raw }))`.
- [ ] **Step 3:** Jalankan seluruh test lead + shared:

```bash
mkdir -p /private/tmp/hanoman-lead-test && /usr/bin/env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR -u HANOMAN_SESSION_ID -u HANOMAN_EVENT_URL -u HANOMAN_EVENT_TOKEN -u HANOMAN_EVENT_DIR -u HANOMAN_EVENT_HOST TEST_DATABASE_URL=file:/private/tmp/hanoman-lead-test/t.test.db pnpm vitest --run server/test/lead- shared/src/lead server/test/agent-capabilities.test.ts server/test/session-events --no-file-parallelism
```

Expected: semua PASS. Lalu `pnpm --filter server exec tsc --noEmit` dan `pnpm --filter shared exec tsc --noEmit` dan `pnpm --filter src exec tsc --noEmit` (nama filter: cek `pnpm-workspace.yaml`) — 0 error.
- [ ] **Step 4: Commit** `refactor(lead): cabut brain sekali-panggil, gerbang konkurensi, dan knob lamanya`

---

## Fase 7 — Docs & verifikasi nyata

### Task 16: Docs SoT

**Files:**
- Modify: `internal/docs/architecture/stack.md`, `internal/docs/architecture/api-contract.md` (route `/lead-pane/*`, `/lead/approvals*`, `/lead/inbox*`, `/lead/sessions/*`, perubahan 503→hilang di `POST /lead/decisions`), `internal/docs/architecture/data-model.md` (sudah di Task 2 — periksa lengkap), `internal/docs/requirements/frd.md` (bagian lead), `internal/docs/frontend/frontend-implementation.md`, `internal/docs/frontend/glossary.md` (Sesi lead, Inbox lead, Izin lead, Jatah peluncuran, Wewenang), `internal/skills/hanoman/SKILL.md` (lead = sesi; tool MCP baru), `CLAUDE.md` (kalimat Konteks: lead berjalan sebagai sesi `lead-<proyek>`), `internal/docs/README.md` (tautan)
- Modify: ADR-0091, 0146, 0167, 0223 — tambah baris "Diamandemen/digantikan sebagian oleh [0228]" di header masing-masing.

- [ ] **Step 1:** Perbarui tiap berkas di atas; setiap klaim harus cocok dengan kode yang sudah ditulis (nama route, field, default).
- [ ] **Step 2:** `grep -rn "claude -p\|brain\|maxConcurrent" internal/docs/architecture internal/docs/requirements internal/skills/hanoman | grep -i lead` → tak ada klaim usang tentang lead.
- [ ] **Step 3: Commit** `docs: lead sebagai sesi interaktif + gerbang server (ADR-0228)`

### Task 17: Verifikasi nyata di lokal

- [ ] **Step 1:** Build & boot: `pnpm -r build` lalu `node server/dist/server.js` dengan `HANOMAN_HOME` sementara (`/usr/bin/env HANOMAN_HOME=/private/tmp/hanoman-lead-e2e node server/dist/server.js`) agar DB operasional tak tersentuh. Login/buat user lewat alur setup yang ada.
- [ ] **Step 2:** Siapkan proyek uji: buat repo git sementara (`git init /private/tmp/lead-e2e-repo` + satu commit), `POST /api/projects` dengan binding ke repo itu, `leadOptIn: true`, `schedulerOptIn: true`; `PUT /api/lead/config` `{ enabled: true, projects: { <id>: { verifyCommand: "true" } } }`.
- [ ] **Step 3:** curl tiap endpoint baru dan catat status:
  - `POST /api/lead/sessions/<id>/start` → 200 `{ started: true }`; `tmux ls` memuat `lead-<id>`.
  - `GET /api/lead-pane/brief` dengan header token pane (ambil `HANOMAN_EVENT_TOKEN` dari env pane: `tmux show-environment -t <nama tmux pane lead> HANOMAN_EVENT_TOKEN`) → 200; tanpa token → 401; header sesi `spec-x` → 403.
  - Buat event lewat `POST /api/lead/decisions` (kontrak) dengan pertanyaan + 2 opsi → amati batch tersuntik ke pane lead (`tmux capture-pane -p -t <pane>`), lead memanggil `act`, request kontrak kembali 201.
  - Buat pertanyaan sensitif ("deploy ke produksi?") → `act` menghasilkan `butuh-izin`; `GET /api/lead/approvals` memuat kartunya; `POST /api/lead/approvals/<id>/decide {approve:false}` → 200, kedua kali → 409.
  - `POST /api/lead/inbox/<id>/take` → 200 lalu 409.
  - `POST /api/lead/sessions/<id>/rotate` → pane baru lahir; `stop` → pane hilang.
- [ ] **Step 4:** Skenario regresi 7 backlog: buat 7 spec siap (stage `spec-ready`, approved) di proyek uji, nyalakan scheduler; tunggu satu denyut → hanya ≤ 1 baris `SchedulerQueueItem` `source=lead` baru; `brief` melaporkan ramp.
- [ ] **Step 5:** Bila ada yang gagal, perbaiki dan ulangi dari step yang gagal sampai hijau. Catat hasil (perintah + status) di deskripsi PR. Hentikan server, `tmux kill-session` pane uji, hapus `/private/tmp/lead-e2e-*`.
- [ ] **Step 6: Commit** (bila ada perbaikan) dan centang seluruh kotak plan ini.
