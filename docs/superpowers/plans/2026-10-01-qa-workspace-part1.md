# Workspace QA — Bagian 1 (Fondasi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Setiap selesai satu task: centang checklist-nya di file ini (`- [ ]` → `- [x]`) lalu jalankan test yang tersentuh (CLAUDE.md).

**Goal:** Workspace QA per project: laporan QA terstruktur (test case + temuan + lampiran), template/ekspor/impor Markdown (ZIP), API + capability + tool MCP, dan UI `QaWorkspace`.

**Architecture:** Kontrak murni (zod, tipe, penomoran tampil, statistik, render/parse Markdown) di `shared`. Empat model Prisma baru (`QaReport`, `QaCase`, `QaFinding`, `QaAttachment`) di bawah `Project`, **local-only** di bagian ini tetapi ber-`version` agar bagian 3 (sync) cukup menambah `FIELDS`. Route Fastify tipis di atas service; lampiran memakai ulang `upload-pipeline`. UI mengikuti pola `SkillsWorkspace`.

**Tech Stack:** TypeScript strict, Fastify, Prisma 6 (SQLite), zod, React + Vite, vitest. Tanpa dependensi baru (ZIP ditulis/dibaca sendiri, mode *stored* + inflate bawaan `node:zlib`).

## Global Constraints

- Bagian 1 **local-only**: JANGAN memanggil `notifySynced`, JANGAN menambah entitas ke `FIELDS`/changefeed sync. `QaAttachment.syncState` selalu `"local-only"`.
- Penomoran: `id` acak (`cuid`); nomor tampil `QA-007` (per project), `F-01` (temuan per laporan), `TC-03` (test case per laporan) **dihitung saat render** dari urutan `createdAt` (seri → `id`). Tidak pernah disimpan.
- Lampiran: maks **10 MB/file**, maks 30 berkas dan 100 MB per laporan; tipe png/jpeg/webp (didekode ulang), pdf, md, txt, log, json, csv. Nama berkas disanitasi, path traversal ditolak.
- Laporan `closed` read-only (409) kecuali dibuka kembali lewat `PATCH {status}`. `submitted`/`closed` mensyaratkan `verdict` terisi (400).
- Severity: `blocker|critical|major|minor|trivial`; prioritas terpisah `P0..P3`.
- Capability baru `qa:read` / `qa:write`; route `/api/projects/:id/qa/**` dan `/api/qa/**`.
- Tanpa skema tanpa migration + ADR (CLAUDE.md). Docs tersentuh diperbarui di commit yang sama + tertaut di `internal/docs/README.md`.
- Test: jalankan serial dengan DB terisolasi — `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan `env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run <path> --no-file-parallelism`. Jangan suite penuh / `pnpm -r typecheck`; typecheck paket tersentuh saja (`pnpm --filter ./server typecheck`).
- Jangan `git stash`, jangan `pkill -f`. Kerjakan di **git worktree** terpisah (bukan working tree utama), lalu `pnpm install` (postinstall menjalankan `prisma generate`).
- Komentar kode & pesan UI berbahasa Indonesia, gaya sama dengan berkas tetangga.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/qa.ts` (+`qa.test.ts`) | enum, zod, tipe view, `assignCodes`, `qaStats` |
| `shared/src/qa-markdown.ts` (+test) | `renderQaMarkdown`, `parseQaMarkdown`, `qaTemplateMarkdown`, `QaMarkdownError` |
| `shared/src/mcp-catalog/qa.ts` | tool MCP `hanoman_qa_*` |
| `shared/src/agent.ts`, `server/src/services/agent-capabilities.ts` | capability `qa` |
| `server/prisma/schema.prisma` + migration | model QA |
| `server/src/services/qa.ts` | view builder, daftar/detail laporan, kode tampil |
| `server/src/services/qa-attachment.ts` | simpan/hapus lampiran QA (pipeline unggahan) |
| `server/src/services/zip.ts` | `writeZip` / `readZip` (stored + deflate, berpagar) |
| `server/src/services/qa-transfer.ts` | ekspor ZIP, impor (upsert) |
| `server/src/routes/qa.ts`, `qa-attachments.ts`, `qa-transfer.ts` | route tipis |
| `src/src/api/client.ts`, `routes.ts`, `ds/shell.tsx`, `App.tsx` | klien API, rute `/qa`, nav, cabang layar |
| `src/src/screens/qa/*` | `QaWorkspace`, list, editor, cases, findings, attachments, preview |
| `internal/docs/**`, ADR baru | dokumentasi |

---

### Task 1: Kontrak bersama `shared/src/qa.ts`

**Files:**
- Create: `shared/src/qa.ts`, `shared/src/qa.test.ts`
- Modify: `shared/src/index.ts` (tambah `export * from "./qa";`)

**Interfaces:**
- Produces (dipakai semua task berikutnya): konstanta `QA_REPORT_STATUSES`, `QA_VERDICTS`, `QA_CASE_STATUSES`, `QA_SEVERITIES`, `QA_PRIORITIES`, `QA_FINDING_STATUSES`, `QA_OWNER_TYPES`; zod `zCreateQaReport`, `zPatchQaReport`, `zCreateQaCase`, `zPatchQaCase`, `zCreateQaFinding`, `zPatchQaFinding`; tipe `CreateQaReport = z.input<…>` dst; `assignCodes(rows, prefix, pad)`; `qaStats(cases, findings)`; tipe view `QaAttachmentView`, `QaCaseView`, `QaFindingView`, `QaStats`, `QaReportView`, `QaReportDetail`.

- [x] **Step 1: Tulis test yang gagal** — `shared/src/qa.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  assignCodes, qaStats, zCreateQaCase, zCreateQaFinding, zCreateQaReport, zPatchQaReport,
} from "./qa";

describe("zCreateQaReport", () => {
  it("hanya title yang wajib; sisanya default", () => {
    const r = zCreateQaReport.parse({ title: "Smoke 0.9.12" });
    expect(r).toMatchObject({ title: "Smoke 0.9.12", buildVersion: "", environment: {}, scope: "", tester: "", summary: "", verdict: null });
  });
  it("menolak title kosong dan environment > 20 entri", () => {
    expect(zCreateQaReport.safeParse({ title: " " }).success).toBe(false);
    const env = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect(zCreateQaReport.safeParse({ title: "x", environment: env }).success).toBe(false);
  });
  it("patch tak menulis ulang default (partial mematikannya)", () => {
    expect(zPatchQaReport.parse({ summary: "ok" })).toEqual({ summary: "ok" });
  });
  it("patch menerima status tetapi create tidak", () => {
    expect(zPatchQaReport.parse({ status: "closed" })).toEqual({ status: "closed" });
    expect(zCreateQaReport.parse({ title: "x", status: "closed" })).not.toHaveProperty("status");
  });
});

describe("zCreateQaFinding / zCreateQaCase", () => {
  it("finding: default severity major, prioritas P2, status open", () => {
    expect(zCreateQaFinding.parse({ title: "Tombol mati" })).toMatchObject({
      severity: "major", priority: "P2", area: "", steps: [], status: "open", caseId: null,
    });
  });
  it("finding menolak severity/prioritas liar dan status `sent` (hanya server yang boleh)", () => {
    expect(zCreateQaFinding.safeParse({ title: "x", severity: "gawat" }).success).toBe(false);
    expect(zCreateQaFinding.safeParse({ title: "x", priority: "P9" }).success).toBe(false);
    expect(zCreateQaFinding.safeParse({ title: "x", status: "sent" }).success).toBe(false);
  });
  it("case: default status todo", () => {
    expect(zCreateQaCase.parse({ title: "Login" })).toMatchObject({ status: "todo", steps: "", expected: "", actual: "" });
  });
});

describe("assignCodes", () => {
  const t = (s: string) => new Date(s);
  it("urut createdAt, seri dipecah id; urutan input dipertahankan", () => {
    const rows = [
      { id: "b", createdAt: t("2026-10-01T10:00:00Z") },
      { id: "a", createdAt: t("2026-10-01T10:00:00Z") },
      { id: "c", createdAt: t("2026-09-30T10:00:00Z") },
    ];
    const out = assignCodes(rows, "F-", 2);
    expect(out.map((r) => [r.id, r.code])).toEqual([["b", "F-03"], ["a", "F-02"], ["c", "F-01"]]);
  });
  it("menerima createdAt string ISO dan melebar melewati pad", () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: `i${String(i).padStart(3, "0")}`, createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }));
    expect(assignCodes(rows, "QA-", 3)[100]!.code).toBe("QA-101");
  });
});

describe("qaStats", () => {
  it("menghitung status case, passRate atas yang dieksekusi, dan temuan per severity", () => {
    const s = qaStats(
      [{ status: "pass" }, { status: "pass" }, { status: "fail" }, { status: "blocked" }, { status: "skipped" }, { status: "todo" }],
      [{ severity: "major", status: "open" }, { severity: "minor", status: "wontfix" }, { severity: "major", status: "sent" }],
    );
    expect(s.cases).toMatchObject({ total: 6, pass: 2, fail: 1, blocked: 1, skipped: 1, todo: 1 });
    expect(s.passRate).toBeCloseTo(0.5);
    expect(s.findings).toMatchObject({ total: 3, major: 2, minor: 1, blocker: 0, open: 1 });
  });
  it("passRate null bila belum ada yang dieksekusi", () => {
    expect(qaStats([{ status: "todo" }], []).passRate).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/src/qa.test.ts --no-file-parallelism`
Expected: FAIL — `Cannot find module './qa'`.

- [x] **Step 3: Implementasi** — `shared/src/qa.ts`

```ts
import { z } from "zod";

// Workspace QA · bagian 1 · kontrak murni. Nol I/O: dipakai server (validasi + serialisasi), tool
// MCP, dan UI dari satu sumber.
//
// Nomor tampil (QA-007 / F-01 / TC-03) TIDAK disimpan: `assignCodes` menghitungnya saat render dari
// urutan `createdAt`. Id acak tak pernah bentrok antar perangkat sesudah sync (bagian 3); harganya,
// nomor bisa bergeser bila baris yang lebih tua dari perangkat lain masuk — ekspor Markdown
// membekukan nomor pada saat ekspor dan menyertakan `id` untuk impor.

export const QA_REPORT_STATUSES = ["draft", "submitted", "closed"] as const;
export type QaReportStatus = (typeof QA_REPORT_STATUSES)[number];
export const QA_VERDICTS = ["go", "no-go", "conditional"] as const;
export type QaVerdict = (typeof QA_VERDICTS)[number];
export const QA_CASE_STATUSES = ["todo", "pass", "fail", "blocked", "skipped"] as const;
export type QaCaseStatus = (typeof QA_CASE_STATUSES)[number];
export const QA_SEVERITIES = ["blocker", "critical", "major", "minor", "trivial"] as const;
export type QaSeverity = (typeof QA_SEVERITIES)[number];
export const QA_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type QaPriority = (typeof QA_PRIORITIES)[number];
/** `sent` (sudah jadi backlog) hanya ditulis server di bagian 2 — bukan input operator. */
export const QA_FINDING_STATUSES = ["open", "sent", "wontfix"] as const;
export type QaFindingStatus = (typeof QA_FINDING_STATUSES)[number];
export const QA_OWNER_TYPES = ["report", "case", "finding"] as const;
export type QaOwnerType = (typeof QA_OWNER_TYPES)[number];

export const zQaEnvironment = z
  .record(z.string().trim().min(1).max(60), z.string().max(500))
  .refine((e) => Object.keys(e).length <= 20, "maksimal 20 entri environment");

const zSteps = z.array(z.string().trim().min(1).max(2_000)).max(50);

export const zCreateQaReport = z.object({
  title: z.string().trim().min(1).max(300),
  buildVersion: z.string().trim().max(120).default(""),
  environment: zQaEnvironment.default({}),
  scope: z.string().max(5_000).default(""),
  tester: z.string().trim().max(200).default(""),
  summary: z.string().max(20_000).default(""),
  verdict: z.enum(QA_VERDICTS).nullable().default(null),
});
export type CreateQaReport = z.input<typeof zCreateQaReport>;

// `.partial()` mematikan default — PATCH yang tak menyebut field harus membiarkannya utuh.
export const zPatchQaReport = zCreateQaReport.partial().extend({ status: z.enum(QA_REPORT_STATUSES).optional() });
export type PatchQaReport = z.input<typeof zPatchQaReport>;

export const zCreateQaCase = z.object({
  title: z.string().trim().min(1).max(300),
  steps: z.string().max(10_000).default(""),
  expected: z.string().max(10_000).default(""),
  actual: z.string().max(10_000).default(""),
  status: z.enum(QA_CASE_STATUSES).default("todo"),
  order: z.number().finite().optional(),
});
export type CreateQaCase = z.input<typeof zCreateQaCase>;
export const zPatchQaCase = zCreateQaCase.partial();
export type PatchQaCase = z.input<typeof zPatchQaCase>;

export const zCreateQaFinding = z.object({
  title: z.string().trim().min(1).max(300),
  caseId: z.string().max(120).nullable().default(null),
  severity: z.enum(QA_SEVERITIES).default("major"),
  priority: z.enum(QA_PRIORITIES).default("P2"),
  area: z.string().trim().max(120).default(""),
  steps: zSteps.default([]),
  expected: z.string().max(10_000).default(""),
  actual: z.string().max(10_000).default(""),
  status: z.enum(["open", "wontfix"]).default("open"),
});
export type CreateQaFinding = z.input<typeof zCreateQaFinding>;
export const zPatchQaFinding = zCreateQaFinding.partial();
export type PatchQaFinding = z.input<typeof zPatchQaFinding>;

/** Nomor tampil: urut `createdAt` (seri → `id`) per himpunan baris; urutan array input dipertahankan. */
export function assignCodes<T extends { id: string; createdAt: Date | string }>(
  rows: readonly T[], prefix: string, pad: number,
): (T & { code: string })[] {
  const ts = (r: T) => new Date(r.createdAt).getTime();
  const rank = new Map(
    [...rows]
      .sort((a, b) => ts(a) - ts(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r, i) => [r.id, i + 1] as const),
  );
  return rows.map((r) => ({ ...r, code: `${prefix}${String(rank.get(r.id)).padStart(pad, "0")}` }));
}

export type QaStats = {
  cases: Record<QaCaseStatus, number> & { total: number };
  /** pass / (pass+fail+blocked); null bila belum ada yang dieksekusi. */
  passRate: number | null;
  findings: Record<QaSeverity, number> & { total: number; open: number };
};

export function qaStats(
  cases: readonly { status: string }[], findings: readonly { severity: string; status: string }[],
): QaStats {
  const c = { total: cases.length, todo: 0, pass: 0, fail: 0, blocked: 0, skipped: 0 };
  for (const x of cases) if ((QA_CASE_STATUSES as readonly string[]).includes(x.status)) c[x.status as QaCaseStatus] += 1;
  const f = { total: findings.length, open: 0, blocker: 0, critical: 0, major: 0, minor: 0, trivial: 0 };
  for (const x of findings) {
    if ((QA_SEVERITIES as readonly string[]).includes(x.severity)) f[x.severity as QaSeverity] += 1;
    if (x.status === "open") f.open += 1;
  }
  const executed = c.pass + c.fail + c.blocked;
  return { cases: c, passRate: executed ? c.pass / executed : null, findings: f };
}

export type QaAttachmentView = {
  id: string; reportId: string; ownerType: QaOwnerType; ownerId: string;
  filename: string; mimeType: string; size: number; sha256: string;
  syncState: "local-only"; createdAt: string;
};
export type QaCaseView = {
  id: string; reportId: string; code: string; title: string; steps: string; expected: string;
  actual: string; status: QaCaseStatus; order: number; createdAt: string; updatedAt: string;
};
export type QaFindingView = {
  id: string; reportId: string; code: string; caseId: string | null; caseCode: string | null;
  title: string; severity: QaSeverity; priority: QaPriority; area: string; steps: string[];
  expected: string; actual: string; status: QaFindingStatus; backlogId: string | null;
  createdAt: string; updatedAt: string;
};
export type QaReportView = {
  id: string; projectId: string; code: string; title: string; buildVersion: string;
  environment: Record<string, string>; scope: string; tester: string; summary: string;
  status: QaReportStatus; verdict: QaVerdict | null; createdAt: string; updatedAt: string;
  stats: QaStats;
};
export type QaReportDetail = QaReportView & {
  cases: QaCaseView[]; findings: QaFindingView[]; attachments: QaAttachmentView[];
};
```

Lalu tambahkan `export * from "./qa";` di `shared/src/index.ts` (di bawah `export * from "./telegram";` atau sejenisnya).

- [x] **Step 4: Jalankan, pastikan lulus + typecheck**

Run: `pnpm vitest --run shared/src/qa.test.ts --no-file-parallelism && pnpm --filter ./shared typecheck`
Expected: PASS (semua test), typecheck bersih. (Bila skrip `typecheck` shared tak ada: `pnpm exec tsc --noEmit -p shared`.)

- [x] **Step 5: Commit**

```bash
git add shared/src/qa.ts shared/src/qa.test.ts shared/src/index.ts
git commit -m "feat(qa): kontrak bersama workspace QA (zod, penomoran tampil, statistik)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Capability `qa:read` / `qa:write`

**Files:**
- Modify: `shared/src/agent.ts` (CAPABILITIES + CAPABILITY_DOMAINS), `server/src/services/agent-capabilities.ts`
- Create: `server/test/qa-capabilities.test.ts`

**Interfaces:**
- Consumes: `capabilityForRoute(method, path)`, `checkAgentCapability(caps, method, path)`.
- Produces: capability `qa:read|qa:write`; route `/api/projects/:id/qa/**` dan `/api/qa/**` terpetakan MENURUT METHOD.

- [x] **Step 1: Tulis test yang gagal** — `server/test/qa-capabilities.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@hanoman/shared";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";

describe("capability domain qa", () => {
  it("terdaftar sebagai qa:read dan qa:write", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(ids).toContain("qa:read");
    expect(ids).toContain("qa:write");
  });

  it("route QA dipetakan menurut METHOD (bukan prefix)", () => {
    expect(capabilityForRoute("GET", "/api/projects/p1/qa/reports")).toBe("qa:read");
    expect(capabilityForRoute("POST", "/api/projects/p1/qa/reports")).toBe("qa:write");
    expect(capabilityForRoute("PATCH", "/api/projects/p1/qa/reports/r1/findings/f1")).toBe("qa:write");
    expect(capabilityForRoute("DELETE", "/api/projects/p1/qa/reports/r1")).toBe("qa:write");
    expect(capabilityForRoute("GET", "/api/projects/p1/qa/reports/r1/export")).toBe("qa:read");
    expect(capabilityForRoute("POST", "/api/projects/p1/qa/import")).toBe("qa:write");
    expect(capabilityForRoute("GET", "/api/qa/template.md")).toBe("qa:read");
  });

  it("tak lagi jatuh ke projects:*", () => {
    expect(capabilityForRoute("GET", "/api/projects/p1")).toBe("projects:read");
    expect(capabilityForRoute("GET", "/api/projects/p1/qa/reports")).not.toBe("projects:read");
  });

  it("token tanpa qa:* ditolak dengan `need`; qa:write mengimplikasikan qa:read", () => {
    expect(checkAgentCapability(["projects:write"], "GET", "/api/projects/p1/qa/reports"))
      .toMatchObject({ ok: false, status: 403, need: "qa:read" });
    expect(checkAgentCapability(["qa:write"], "GET", "/api/projects/p1/qa/reports")).toEqual({ ok: true });
    expect(checkAgentCapability(["qa:read"], "POST", "/api/projects/p1/qa/reports"))
      .toMatchObject({ ok: false, need: "qa:write" });
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run server/test/qa-capabilities.test.ts --no-file-parallelism`
Expected: FAIL (`qa:read` belum terdaftar).

- [x] **Step 3: Implementasi**

`shared/src/agent.ts` — tambahkan `"qa:read", "qa:write",` ke daftar `CAPABILITY_IDS` (tepat sesudah `"team:read", "team:write",`; tanpa ini `Capability` tak mengenalnya dan typecheck merah — vitest tak menangkapnya), lalu tambah dua entri tepat setelah `team:write` (sebelum komentar `ADR-0155`):

```ts
  { id: "qa:read", domain: "qa", access: "read", label: "QA — baca", desc: "Lihat laporan QA, test case, temuan, dan lampirannya." },
  { id: "qa:write", domain: "qa", access: "write", label: "QA — tulis", desc: "Buat/ubah/hapus laporan QA, test case, temuan, lampiran; impor laporan Markdown/ZIP." },
```

dan di `CAPABILITY_DOMAINS` setelah entri `team`:

```ts
  { domain: "qa", label: "QA", desc: "Laporan QA per project: test case, temuan, lampiran, ekspor/impor." },
```

`server/src/services/agent-capabilities.ts` — dalam cabang `top === "projects"`, SEBELUM baris `if (sub === "docs" || …)`:

```ts
    // Workspace QA · laporan QA adalah domain TERSENDIRI. Tanpa baris ini `/projects/:id/qa/**` jatuh
    // ke `rw("projects")` — agen harus dipercaya menyunting & menghapus project hanya untuk menulis
    // laporan. `rw()` menurunkan read/write DARI METHOD (kelas bug SPEC-405).
    if (sub === "qa") return rw("qa");
```

dan sebelum `if (top === "terminal")`:

```ts
  // Workspace QA · `/api/qa/template.md` (template unduhan, tak terikat project).
  if (top === "qa") return rw("qa");
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run server/test/qa-capabilities.test.ts server/test/agent-capabilities.test.ts --no-file-parallelism`
Expected: PASS. Bila test lain yang menghitung/snapshot CAPABILITIES merah (mis. Settings), perbarui angka/snapshot-nya dan sebut di pesan commit.

- [x] **Step 5: Commit**

```bash
git add shared/src/agent.ts server/src/services/agent-capabilities.ts server/test/qa-capabilities.test.ts
git commit -m "feat(qa): capability qa:read/qa:write dipetakan menurut method

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Skema Prisma + migration + ADR

**Files:**
- Modify: `server/prisma/schema.prisma`, `server/test/factory.ts` (`resetDb`), `docs/superpowers/specs/2026-10-01-qa-workspace-design.md`, `internal/docs/architecture/data-model.md`, `internal/docs/README.md`
- Create: `server/prisma/migrations/<timestamp>_qa_workspace/migration.sql` (dihasilkan Prisma), `internal/docs/adr/<NNNN>-workspace-qa.md`, `server/test/qa-model.test.ts`

**Interfaces:**
- Produces: `prisma.qaReport`, `prisma.qaCase`, `prisma.qaFinding`, `prisma.qaAttachment`. `QaAttachment.reportId` FK cascade (penyimpangan kecil dari spec: dibutuhkan untuk kuota per laporan + cascade; ditulis ke spec di langkah 6). `QaFinding.caseId` **soft-link tanpa FK** (cermin `Task.specId`).

- [x] **Step 1: Tulis test yang gagal** — `server/test/qa-model.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { makeProject, resetDb } from "./factory";

beforeEach(async () => { await resetDb(); await makeProject({ id: "p1" }); });

describe("model QA", () => {
  it("default kolom + cascade project → laporan → case/finding/lampiran", async () => {
    const r = await prisma.qaReport.create({ data: { projectId: "p1", title: "Smoke" } });
    expect(r).toMatchObject({ status: "draft", verdict: null, buildVersion: "", version: 0 });
    await prisma.qaCase.create({ data: { reportId: r.id, title: "Login" } });
    await prisma.qaFinding.create({ data: { reportId: r.id, title: "Bug", steps: ["a", "b"] } });
    await prisma.qaAttachment.create({ data: {
      reportId: r.id, projectId: "p1", ownerType: "report", ownerId: r.id,
      filename: "a.png", mimeType: "image/png", size: 1, sha256: "x", storageKey: "k",
    } });
    expect((await prisma.qaFinding.findFirstOrThrow()).steps).toEqual(["a", "b"]);
    expect((await prisma.qaAttachment.findFirstOrThrow()).syncState).toBe("local-only");

    await prisma.project.delete({ where: { id: "p1" } });
    expect(await prisma.qaReport.count()).toBe(0);
    expect(await prisma.qaCase.count()).toBe(0);
    expect(await prisma.qaFinding.count()).toBe(0);
    expect(await prisma.qaAttachment.count()).toBe(0);
  });

  it("QaFinding.caseId bukan FK: boleh menunjuk case yang tak ada tanpa error", async () => {
    const r = await prisma.qaReport.create({ data: { projectId: "p1", title: "x" } });
    await expect(prisma.qaFinding.create({ data: { reportId: r.id, title: "y", caseId: "hantu" } })).resolves.toBeTruthy();
  });
});
```

- [x] **Step 2: Tambah model ke `server/prisma/schema.prisma`**

Di `model Project` tambahkan setelah `tasks        Task[]`:

```prisma
  qaReports    QaReport[]            // Workspace QA · laporan QA project ini
```

Tambahkan di akhir berkas:

```prisma
// Workspace QA · bagian 1 · laporan QA per project (design 2026-10-01).
//
// LOCAL-only di bagian ini, tetapi `version` sudah ada pada tiga entitas utama supaya bagian 3
// (sync) cukup menambah entri FIELDS tanpa migrasi ulang. Nomor tampil (QA-007/F-01/TC-03) TIDAK
// disimpan — dihitung saat render dari urutan createdAt (`assignCodes` di shared/qa.ts): id acak
// tak pernah bentrok antar perangkat.
model QaReport {
  id           String         @id @default(cuid())
  projectId    String
  title        String
  buildVersion String         @default("")
  environment  Json?          // {os, browser, device, url, branch, …} — null dibaca sebagai {}
  scope        String         @default("")
  tester       String         @default("")
  summary      String         @default("")
  status       String         @default("draft") // draft | submitted | closed (QA_REPORT_STATUSES)
  verdict      String?        // go | no-go | conditional
  version      Int            @default(0)
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  project      Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  cases        QaCase[]
  findings     QaFinding[]
  attachments  QaAttachment[]

  @@index([projectId, createdAt])
}

model QaCase {
  id        String   @id @default(cuid())
  reportId  String
  title     String
  steps     String   @default("")
  expected  String   @default("")
  actual    String   @default("")
  status    String   @default("todo") // todo | pass | fail | blocked | skipped
  order     Float    @default(0)      // Float: titik tengah tetangga, cermin Task.order
  version   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  report    QaReport @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId, order])
}

// `caseId` soft-link TANPA FK (cermin Task.specId): changefeed bisa memancarkan temuan sebelum
// case-nya mendarat (kelas SPEC-382) dan FK akan menolaknya. `backlogId` diisi bagian 2.
model QaFinding {
  id        String   @id @default(cuid())
  reportId  String
  caseId    String?
  title     String
  severity  String   @default("major") // blocker | critical | major | minor | trivial
  priority  String   @default("P2")    // P0..P3 — terpisah dari severity
  area      String   @default("")
  steps     Json?    // string[] repro bernomor — null dibaca sebagai []
  expected  String   @default("")
  actual    String   @default("")
  status    String   @default("open")  // open | sent | wontfix
  backlogId String?
  version   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  report    QaReport @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId])
}

// Tanpa `version`: byte tak lewat changefeed (bagian 3 mengunggahnya terpisah per sha256).
// `reportId` FK cascade + denormal `projectId`: kuota per laporan dan isolasi per project.
// `ownerType/ownerId` polimorfik tanpa FK — service menghapus lampiran pemilik sebelum pemiliknya.
model QaAttachment {
  id         String   @id @default(cuid())
  reportId   String
  projectId  String
  ownerType  String   // report | case | finding
  ownerId    String
  filename   String
  mimeType   String
  size       Int
  sha256     String   // sha256 byte TERSIMPAN (sesudah normalisasi gambar), kunci dedup bagian 3
  storageKey String
  syncState  String   @default("local-only") // local-only | uploaded | available (bagian 3)
  createdAt  DateTime @default(now())
  report     QaReport @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId])
  @@index([ownerType, ownerId])
}
```

- [x] **Step 3: Hasilkan migration pada DB sekali-pakai (JANGAN DB operasional)**

```bash
cd server && DATABASE_URL="file:$(mktemp -d)/m.db" pnpm exec prisma migrate dev --name qa_workspace --schema prisma/schema.prisma && cd ..
git status --short server/prisma
```
Expected: satu folder baru `server/prisma/migrations/<ts>_qa_workspace/migration.sql` berisi `CREATE TABLE "QaReport"`, `"QaCase"`, `"QaFinding"`, `"QaAttachment"` + index; `prisma generate` ikut jalan. Tidak ada `ALTER`/`DROP` tabel lain — bila ada, hentikan dan periksa drift.

- [x] **Step 4: `resetDb`** — di `server/test/factory.ts`, dalam `$transaction` sebelum `prisma.project.deleteMany()`:

```ts
    prisma.qaReport.deleteMany(),    // Workspace QA · cascade ke case/finding/attachment
```

- [x] **Step 5: Jalankan test**

Run: `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"; pnpm vitest --run server/test/qa-model.test.ts --no-file-parallelism && pnpm --filter ./server typecheck`
Expected: PASS.

- [x] **Step 6: ADR + docs**
  - Buat `internal/docs/adr/<NNNN>-workspace-qa.md` (NNNN = nomor bebas berikutnya: `ls internal/docs/adr | tail -3`; saat ini sesudah 0173). Salin struktur berkas ADR tetangga (`0173-…`): konteks, keputusan (empat model; nomor tampil dihitung saat render; local-only sekarang, siap sync; lampiran memakai pipeline unggahan yang ada; `caseId` soft-link; `reportId` pada lampiran), konsekuensi (nomor bisa bergeser pasca-sync, ekspor membekukan).
  - Tambahkan tabel QA ke `internal/docs/architecture/data-model.md` (pola entri `Task`).
  - Tautkan ADR di `internal/docs/README.md` (`pnpm exec hanoman docs link internal/docs/adr/<NNNN>-workspace-qa.md` atau tambah baris manual lalu `hanoman docs index --check`).
  - Di `docs/superpowers/specs/2026-10-01-qa-workspace-design.md` §1 tambahkan `reportId` (FK cascade) pada `QaAttachment` dan catat bahwa `submitted`/`closed` mensyaratkan `verdict`.

- [x] **Step 7: Commit**

```bash
git add server/prisma server/test/factory.ts server/test/qa-model.test.ts internal/docs docs/superpowers/specs
git commit -m "feat(qa): skema QaReport/QaCase/QaFinding/QaAttachment + migration + ADR

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


---

### Task 4: Service + route laporan, test case, temuan

**Files:**
- Create: `server/src/services/qa.ts`, `server/src/services/qa-attachment.ts`, `server/src/routes/qa.ts`, `server/test/qa-reports.route.test.ts`
- Modify: `server/src/app.ts` (impor + `await api.register(qa);` di dekat `tasks`)

**Interfaces:**
- Consumes (Task 1/3): zod + tipe view dari `@hanoman/shared`; `prisma.qa*`.
- Produces tambahan (Step 3b): `server/src/services/qa-attachment.ts` — `addQaAttachments`, `removeQaAttachments(where)`, `ownerExists`, `QA_ATTACHMENT_LIMITS`; dipakai route laporan (membuang byte sebelum menghapus pemilik) dan route lampiran (Task 5).
- Produces: `listReports(projectId): Promise<QaReportView[]>`, `reportDetail(projectId, reportId): Promise<QaReportDetail | null>`, `reportCodes(projectId)`, `attachmentView(row)`, `envOf`, `stepsOf`, `asJson`. REST:
  - `GET/POST /api/projects/:pid/qa/reports` → `{ items, total }` / `201 QaReportDetail`
  - `GET/PATCH/DELETE /api/projects/:pid/qa/reports/:rid` → `QaReportDetail` / `QaReportDetail` / `{ ok: true }`
  - `POST …/:rid/cases`, `PATCH|DELETE …/:rid/cases/:cid`, `POST …/:rid/findings`, `PATCH|DELETE …/:rid/findings/:fid` → **selalu `QaReportDetail` terbaru** (POST = 201).
  - Error: 400 validasi (`{error: zodFlatten}` atau `{error: "..."}`), 404 lintas-project/tak ada, 409 laporan `closed`.

- [x] **Step 1: Tulis test yang gagal** — `server/test/qa-reports.route.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { makeProject, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const tick = () => new Promise((r) => setTimeout(r, 5)); // createdAt beda ≥ 1 ms → nomor tampil deterministik

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeProject({ id: "p2" });
});

const url = (p: string, tail = "") => `/api/projects/${p}/qa/reports${tail}`;
const post = (u: string, payload: unknown) => app.inject({ method: "POST", url: u, payload: payload as object });
const patch = (u: string, payload: unknown) => app.inject({ method: "PATCH", url: u, payload: payload as object });
const mk = async (title = "Smoke", p = "p1") => (await post(url(p), { title })).json();

describe("laporan", () => {
  it("membuat, mendaftar, dan membaca dengan nomor tampil + statistik", async () => {
    const res = await post(url("p1"), { title: "Smoke 0.9.12", buildVersion: "0.9.12", environment: { os: "macOS" }, tester: "Dena" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      code: "QA-001", title: "Smoke 0.9.12", status: "draft", verdict: null,
      environment: { os: "macOS" }, cases: [], findings: [], attachments: [],
    });
    const list = (await app.inject({ method: "GET", url: url("p1") })).json();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ code: "QA-001", stats: { cases: { total: 0 }, passRate: null } });
    expect((await app.inject({ method: "GET", url: url("p1", `/${res.json().id}`) })).statusCode).toBe(200);
  });

  it("nomor QA berurut per project dan mulai lagi dari 001 di project lain", async () => {
    const a = await mk("A"); await tick(); const b = await mk("B"); const c = await mk("C", "p2");
    expect([a.code, b.code, c.code]).toEqual(["QA-001", "QA-002", "QA-001"]);
  });

  it("400 title kosong; 404 project tak ada; 404 laporan milik project lain", async () => {
    expect((await post(url("p1"), { title: " " })).statusCode).toBe(400);
    expect((await post(url("hantu"), { title: "x" })).statusCode).toBe(404);
    const r = await mk();
    expect((await app.inject({ method: "GET", url: url("p2", `/${r.id}`) })).statusCode).toBe(404);
    expect((await patch(url("p2", `/${r.id}`), { title: "z" })).statusCode).toBe(404);
  });

  it("submit/close mensyaratkan verdict (400), lalu lolos setelah diisi", async () => {
    const r = await mk();
    const bad = await patch(url("p1", `/${r.id}`), { status: "submitted" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/verdict/);
    const ok = await patch(url("p1", `/${r.id}`), { status: "submitted", verdict: "no-go" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: "submitted", verdict: "no-go" });
  });

  it("PATCH hanya menulis field yang dikirim", async () => {
    const r = (await post(url("p1"), { title: "T", scope: "checkout", tester: "Dena" })).json();
    const res = await patch(url("p1", `/${r.id}`), { summary: "ok" });
    expect(res.json()).toMatchObject({ title: "T", scope: "checkout", tester: "Dena", summary: "ok" });
  });

  it("laporan closed read-only (409) kecuali dibuka kembali lewat PATCH {status}", async () => {
    const r = await mk();
    await patch(url("p1", `/${r.id}`), { status: "closed", verdict: "go" });
    expect((await patch(url("p1", `/${r.id}`), { title: "baru" })).statusCode).toBe(409);
    expect((await post(url("p1", `/${r.id}/cases`), { title: "c" })).statusCode).toBe(409);
    expect((await post(url("p1", `/${r.id}/findings`), { title: "f" })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: url("p1", `/${r.id}`) })).statusCode).toBe(409);
    const reopen = await patch(url("p1", `/${r.id}`), { status: "draft" });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().status).toBe("draft");
    expect((await post(url("p1", `/${r.id}/cases`), { title: "c" })).statusCode).toBe(201);
  });

  it("DELETE menghapus laporan beserta anak-anaknya", async () => {
    const r = await mk();
    await post(url("p1", `/${r.id}/cases`), { title: "c" });
    expect((await app.inject({ method: "DELETE", url: url("p1", `/${r.id}`) })).json()).toEqual({ ok: true });
    expect(await prisma.qaReport.count()).toBe(0);
    expect(await prisma.qaCase.count()).toBe(0);
  });

  it("LOCAL-only: tak satu pun tulisan QA masuk changefeed sync", async () => {
    const r = await mk();
    await post(url("p1", `/${r.id}/cases`), { title: "c" });
    await post(url("p1", `/${r.id}/findings`), { title: "f" });
    expect(await prisma.syncLog.count({ where: { entity: { startsWith: "qa" } } })).toBe(0);
  });
});

describe("test case", () => {
  it("order otomatis menaik; status bisa diubah; statistik ikut", async () => {
    const r = await mk();
    await post(url("p1", `/${r.id}/cases`), { title: "Login" });
    const d = (await post(url("p1", `/${r.id}/cases`), { title: "Checkout" })).json();
    expect(d.cases.map((c: { code: string; title: string }) => [c.code, c.title])).toEqual([["TC-01", "Login"], ["TC-02", "Checkout"]]);
    const caseId = d.cases[0].id;
    const upd = await patch(url("p1", `/${r.id}/cases/${caseId}`), { status: "pass" });
    expect(upd.json().cases[0]).toMatchObject({ status: "pass" });
    expect(upd.json().stats).toMatchObject({ passRate: 1, cases: { total: 2, pass: 1, todo: 1 } });
  });

  it("menghapus case melepas caseId temuan (bukan menghapus temuannya)", async () => {
    const r = await mk();
    const c = (await post(url("p1", `/${r.id}/cases`), { title: "Login" })).json().cases[0];
    await post(url("p1", `/${r.id}/findings`), { title: "Bug", caseId: c.id });
    const del = await app.inject({ method: "DELETE", url: url("p1", `/${r.id}/cases/${c.id}`) });
    expect(del.statusCode).toBe(200);
    expect(del.json().cases).toEqual([]);
    expect(del.json().findings[0]).toMatchObject({ title: "Bug", caseId: null, caseCode: null });
  });

  it("404 case dari laporan lain", async () => {
    const a = await mk("A"); const b = await mk("B");
    const c = (await post(url("p1", `/${a.id}/cases`), { title: "x" })).json().cases[0];
    expect((await patch(url("p1", `/${b.id}/cases/${c.id}`), { status: "pass" })).statusCode).toBe(404);
  });
});

describe("temuan", () => {
  it("default severity major / P2 / open; steps tersimpan; kode F-01, F-02 menurut createdAt", async () => {
    const r = await mk();
    await post(url("p1", `/${r.id}/findings`), { title: "Pertama", steps: ["buka", "klik"] });
    await tick();
    const d = (await post(url("p1", `/${r.id}/findings`), { title: "Kedua", severity: "blocker", priority: "P0" })).json();
    expect(d.findings.map((f: { code: string }) => f.code)).toEqual(["F-01", "F-02"]);
    expect(d.findings[0]).toMatchObject({ severity: "major", priority: "P2", status: "open", steps: ["buka", "klik"], backlogId: null });
    expect(d.findings[1]).toMatchObject({ severity: "blocker", priority: "P0" });
    expect(d.stats.findings).toMatchObject({ total: 2, blocker: 1, major: 1, open: 2 });
  });

  it("400 caseId dari laporan lain; 400 status `sent`; 400 severity liar", async () => {
    const a = await mk("A"); const b = await mk("B");
    const c = (await post(url("p1", `/${a.id}/cases`), { title: "x" })).json().cases[0];
    const res = await post(url("p1", `/${b.id}/findings`), { title: "f", caseId: c.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().caseId).toBe(c.id);
    expect((await post(url("p1", `/${b.id}/findings`), { title: "f", status: "sent" })).statusCode).toBe(400);
    expect((await post(url("p1", `/${b.id}/findings`), { title: "f", severity: "gawat" })).statusCode).toBe(400);
  });

  it("PATCH mengubah severity/status dan mengosongkan caseId; DELETE menghapus", async () => {
    const r = await mk();
    const c = (await post(url("p1", `/${r.id}/cases`), { title: "Login" })).json().cases[0];
    const f = (await post(url("p1", `/${r.id}/findings`), { title: "Bug", caseId: c.id })).json().findings[0];
    expect(f.caseCode).toBe("TC-01");
    const upd = await patch(url("p1", `/${r.id}/findings/${f.id}`), { severity: "minor", status: "wontfix", caseId: null });
    expect(upd.json().findings[0]).toMatchObject({ severity: "minor", status: "wontfix", caseId: null });
    const del = await app.inject({ method: "DELETE", url: url("p1", `/${r.id}/findings/${f.id}`) });
    expect(del.json().findings).toEqual([]);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"; env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/qa-reports.route.test.ts --no-file-parallelism`
Expected: FAIL — semua 404 (route belum ada).

- [x] **Step 3: Service** — `server/src/services/qa.ts`

```ts
import type { Prisma, QaAttachment, QaCase, QaFinding, QaReport } from "@prisma/client";
import {
  assignCodes, qaStats,
  type QaAttachmentView, type QaCaseStatus, type QaCaseView, type QaFindingStatus, type QaFindingView,
  type QaOwnerType, type QaPriority, type QaReportDetail, type QaReportStatus, type QaReportView,
  type QaSeverity, type QaVerdict,
} from "@hanoman/shared";
import { prisma } from "../db";

// Workspace QA · domain laporan. Route tinggal tipis. Kolom status/severity adalah TEXT yang kelak
// menyeberang sync dari mesin yang boleh lebih baru, jadi cast di bawah hanya untuk dirender.

const iso = (d: Date): string => d.toISOString();

export const envOf = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Record<string, string>;
};
export const stepsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
export const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/** Nomor tampil QA-001… per project, dari urutan createdAt. */
export async function reportCodes(projectId: string): Promise<Map<string, string>> {
  const rows = await prisma.qaReport.findMany({ where: { projectId }, select: { id: true, createdAt: true } });
  return new Map(assignCodes(rows, "QA-", 3).map((r) => [r.id, r.code]));
}

const reportView = (
  r: QaReport, code: string,
  cases: readonly { status: string }[], findings: readonly { severity: string; status: string }[],
): QaReportView => ({
  id: r.id, projectId: r.projectId, code, title: r.title, buildVersion: r.buildVersion,
  environment: envOf(r.environment), scope: r.scope, tester: r.tester, summary: r.summary,
  status: r.status as QaReportStatus, verdict: (r.verdict ?? null) as QaVerdict | null,
  createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), stats: qaStats(cases, findings),
});

export const attachmentView = (a: QaAttachment): QaAttachmentView => ({
  id: a.id, reportId: a.reportId, ownerType: a.ownerType as QaOwnerType, ownerId: a.ownerId,
  filename: a.filename, mimeType: a.mimeType, size: a.size, sha256: a.sha256,
  syncState: "local-only", createdAt: iso(a.createdAt),
});

/** Ditampilkan menurut `order`; nomor TC-nn tetap menurut createdAt. */
export function caseViews(rows: QaCase[]): QaCaseView[] {
  return assignCodes(rows, "TC-", 2)
    .map((r) => ({
      id: r.id, reportId: r.reportId, code: r.code, title: r.title, steps: r.steps, expected: r.expected,
      actual: r.actual, status: r.status as QaCaseStatus, order: r.order,
      createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
    }))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

/** `rows` WAJIB terurut [createdAt asc, id asc] — urutan itu juga urutan tampil. */
export function findingViews(rows: QaFinding[], cases: QaCaseView[]): QaFindingView[] {
  const caseCode = new Map(cases.map((c) => [c.id, c.code]));
  return assignCodes(rows, "F-", 2).map((r) => ({
    id: r.id, reportId: r.reportId, code: r.code, caseId: r.caseId,
    caseCode: r.caseId ? (caseCode.get(r.caseId) ?? null) : null,
    title: r.title, severity: r.severity as QaSeverity, priority: r.priority as QaPriority, area: r.area,
    steps: stepsOf(r.steps), expected: r.expected, actual: r.actual, status: r.status as QaFindingStatus,
    backlogId: r.backlogId, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  }));
}

export async function listReports(projectId: string): Promise<QaReportView[]> {
  const rows = await prisma.qaReport.findMany({
    where: { projectId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { cases: { select: { status: true } }, findings: { select: { severity: true, status: true } } },
  });
  const codes = await reportCodes(projectId);
  return rows.map((r) => reportView(r, codes.get(r.id)!, r.cases, r.findings));
}

export async function reportDetail(projectId: string, reportId: string): Promise<QaReportDetail | null> {
  const row = await prisma.qaReport.findFirst({
    where: { id: reportId, projectId },
    include: {
      cases: true,
      findings: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!row) return null;
  const code = (await reportCodes(projectId)).get(row.id)!;
  const cases = caseViews(row.cases);
  return {
    ...reportView(row, code, row.cases, row.findings),
    cases, findings: findingViews(row.findings, cases), attachments: row.attachments.map(attachmentView),
  };
}
```

- [x] **Step 3b: Service lampiran** — `server/src/services/qa-attachment.ts` (dipakai route Task 4 untuk membuang byte; route-nya sendiri di Task 5)

```ts
// Workspace QA · lampiran per laporan/test case/temuan. Memakai ulang PIPELINE unggahan
// (`upload-pipeline.ts`: magic bytes, normalisasi gambar, pemindaian) seperti lampiran backlog
// (ADR-0124) — bukan salinan yang bisa berselisih. Kuota/limit-nya milik QA sendiri.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { QaAttachmentView, QaOwnerType } from "@hanoman/shared";
import { prisma } from "../db";
import { deleteUpload, readUpload } from "./uploads";
import { DOCUMENT_TYPES, UploadError, processDocumentUpload, processUpload, type SafeUpload } from "./upload-pipeline";
import { IMAGE_TYPES, attachmentExt, type RejectReason, type SpecUpload } from "./spec-attachment";
import { attachmentView } from "./qa";

export const QA_ATTACHMENT_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  perReport: 30,
  reportBytes: 100 * 1024 * 1024,
} as const;

export type QaUpload = SpecUpload;
export type QaOwner = { ownerType: QaOwnerType; ownerId: string };

// Kode pemindai & kuota TIDAK diciutkan jadi "type" (alasan sama dengan lampiran backlog).
const reasonFor = (code: UploadError["code"]): RejectReason =>
  code === "UPLOAD_QUOTA" ? "quota" : code === "UPLOAD_SCAN" ? "scan" : "type";

export async function ownerExists(reportId: string, type: string, id: string): Promise<boolean> {
  if (type === "report") return id === reportId;
  if (type === "case") return !!(await prisma.qaCase.findFirst({ where: { id, reportId }, select: { id: true } }));
  if (type === "finding") return !!(await prisma.qaFinding.findFirst({ where: { id, reportId }, select: { id: true } }));
  return false;
}

export async function addQaAttachments(
  report: { id: string; projectId: string }, owner: QaOwner, files: QaUpload[],
): Promise<{ saved: QaAttachmentView[]; rejected: { filename: string; reason: RejectReason }[] }> {
  const existing = await prisma.qaAttachment.findMany({ where: { reportId: report.id }, select: { size: true } });
  let count = existing.length;
  let bytes = existing.reduce((n, a) => n + a.size, 0);

  const saved: QaAttachmentView[] = [];
  const rejected: { filename: string; reason: RejectReason }[] = [];
  for (const f of files) {
    const name = f.name || "lampiran";
    if (count >= QA_ATTACHMENT_LIMITS.perReport) { rejected.push({ filename: name, reason: "count" }); continue; }
    // `truncated` datang dari @fastify/multipart: berkas oversize tiba TERPOTONG, bukan sebagai error.
    if (f.truncated || f.buf.byteLength === 0 || f.buf.byteLength > QA_ATTACHMENT_LIMITS.fileBytes) {
      rejected.push({ filename: name, reason: "size" }); continue;
    }
    if (bytes + f.buf.byteLength > QA_ATTACHMENT_LIMITS.reportBytes) { rejected.push({ filename: name, reason: "quota" }); continue; }
    const ext = attachmentExt(name);
    let safe: SafeUpload;
    try {
      const image = IMAGE_TYPES[f.mime];
      if (image) {
        if (!image.includes(ext)) throw new UploadError("UPLOAD_TYPE", "extension mismatch");
        safe = await processUpload({ buffer: f.buf, clientName: name, clientMime: f.mime, projectId: report.projectId, parentBytes: bytes });
      } else if (DOCUMENT_TYPES[f.mime]) {
        safe = await processDocumentUpload({ buffer: f.buf, clientName: name, clientMime: f.mime, clientExt: ext });
      } else {
        throw new UploadError("UPLOAD_TYPE", "unsupported type");
      }
    } catch (error) {
      if (!(error instanceof UploadError)) throw error;
      rejected.push({ filename: name, reason: reasonFor(error.code) });
      continue;
    }
    try {
      // sha256 dari byte TERSIMPAN (gambar sudah didekode-ulang), bukan byte kiriman: itulah kunci
      // dedup yang dipakai bagian 3 (sync lampiran).
      const sha256 = createHash("sha256").update(await readUpload(safe.storageKey)).digest("hex");
      const row = await prisma.qaAttachment.create({ data: {
        reportId: report.id, projectId: report.projectId, ownerType: owner.ownerType, ownerId: owner.ownerId,
        filename: safe.filename, mimeType: safe.mimeType, size: safe.size, sha256, storageKey: safe.storageKey,
      } });
      saved.push(attachmentView(row));
    } catch (error) {
      await deleteUpload(safe.storageKey);   // byte sudah mendarat; tanpa ini jadi yatim tanpa baris
      throw error;
    }
    count += 1;
    bytes += safe.size;
  }
  return { saved, rejected };
}

/** Hapus baris DAN byte. Cascade DB tak menyentuh disk, jadi pemanggil menghapus pemilik SESUDAH ini. */
export async function removeQaAttachments(where: Prisma.QaAttachmentWhereInput): Promise<number> {
  const rows = await prisma.qaAttachment.findMany({ where, select: { id: true, storageKey: true } });
  if (!rows.length) return 0;
  await prisma.qaAttachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  for (const r of rows) await deleteUpload(r.storageKey).catch(() => { /* sudah tak ada */ });
  return rows.length;
}
```

- [x] **Step 4: Route** — `server/src/routes/qa.ts`

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodError } from "zod";
import {
  zCreateQaCase, zCreateQaFinding, zCreateQaReport, zPatchQaCase, zPatchQaFinding, zPatchQaReport,
} from "@hanoman/shared";
import { prisma } from "../db";
import { asJson, listReports, reportDetail } from "../services/qa";
import { removeQaAttachments } from "../services/qa-attachment";

// Workspace QA · CRUD laporan/test case/temuan. LOCAL-only di bagian 1: sengaja TANPA
// `notifySynced` (entitas belum masuk FIELDS sync). Capability `qa:*` dipetakan menurut METHOD di
// `capabilityForRoute`. Setiap mutasi anak menjawab `QaReportDetail` terbaru — klien tak perlu
// menghitung ulang nomor tampil atau statistik.

const bad = (reply: FastifyReply, err: ZodError) => reply.code(400).send({ error: err.flatten() });
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "not found" });
const locked = (reply: FastifyReply) =>
  reply.code(409).send({ error: "laporan sudah closed — buka kembali (status=draft) sebelum mengubahnya" });

const findReport = (pid: string, rid: string) => prisma.qaReport.findFirst({ where: { id: rid, projectId: pid } });
const touch = (rid: string) => prisma.qaReport.update({ where: { id: rid }, data: { updatedAt: new Date() } });

// Path ditulis LITERAL di tiap `app.<method>("…")`: `server/test/mcp-coverage.test.ts` membaca inventaris route
// dengan regex dari sumber, dan path berbentuk variabel/template tak pernah terhitung (gerbang hijau palsu).
export default async function qa(app: FastifyInstance) {
  type Ids = { pid: string; rid: string; cid: string; fid: string };

  app.get("/projects/:pid/qa/reports", async (req, reply) => {
    const { pid } = req.params as Ids;
    if (!(await prisma.project.findUnique({ where: { id: pid }, select: { id: true } }))) return notFound(reply);
    const items = await listReports(pid);
    return { items, total: items.length };
  });

  app.post("/projects/:pid/qa/reports", async (req, reply) => {
    const { pid } = req.params as Ids;
    if (!(await prisma.project.findUnique({ where: { id: pid }, select: { id: true } }))) return notFound(reply);
    const parsed = zCreateQaReport.safeParse(req.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;
    const row = await prisma.qaReport.create({ data: {
      projectId: pid, title: p.title, buildVersion: p.buildVersion, environment: asJson(p.environment),
      scope: p.scope, tester: p.tester, summary: p.summary, verdict: p.verdict,
    } });
    return reply.code(201).send(await reportDetail(pid, row.id));
  });

  app.get("/projects/:pid/qa/reports/:rid", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    return (await reportDetail(pid, rid)) ?? notFound(reply);
  });

  app.patch("/projects/:pid/qa/reports/:rid", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const existing = await findReport(pid, rid);
    if (!existing) return notFound(reply);
    const parsed = zPatchQaReport.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;

    // closed hanya boleh dibuka kembali: satu-satunya ubahan yang lolos adalah PATCH {status≠closed}.
    if (existing.status === "closed") {
      const keys = Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined);
      if (!(keys.length === 1 && keys[0] === "status" && p.status !== "closed")) return locked(reply);
    }
    const nextStatus = p.status ?? existing.status;
    const nextVerdict = p.verdict === undefined ? existing.verdict : p.verdict;
    if ((nextStatus === "submitted" || nextStatus === "closed") && !nextVerdict)
      return reply.code(400).send({ error: "verdict wajib diisi sebelum laporan di-submit atau di-close" });

    await prisma.qaReport.update({ where: { id: rid }, data: {
      title: p.title, buildVersion: p.buildVersion, scope: p.scope, tester: p.tester, summary: p.summary,
      verdict: p.verdict, status: p.status,
      environment: p.environment === undefined ? undefined : asJson(p.environment),
    } });
    return reportDetail(pid, rid);
  });

  app.delete("/projects/:pid/qa/reports/:rid", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const existing = await findReport(pid, rid);
    if (!existing) return notFound(reply);
    if (existing.status === "closed") return locked(reply);
    // Cascade DB tak menyentuh disk: bayt lampiran dibuang SEBELUM barisnya.
    await removeQaAttachments({ reportId: rid });
    await prisma.qaReport.delete({ where: { id: rid } });
    return { ok: true };
  });

  // ── test case ────────────────────────────────────────────────────────────
  app.post("/projects/:pid/qa/reports/:rid/cases", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r) return notFound(reply);
    if (r.status === "closed") return locked(reply);
    const parsed = zCreateQaCase.safeParse(req.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;
    const last = await prisma.qaCase.findFirst({ where: { reportId: rid }, orderBy: { order: "desc" }, select: { order: true } });
    await prisma.qaCase.create({ data: {
      reportId: rid, title: p.title, steps: p.steps, expected: p.expected, actual: p.actual,
      status: p.status, order: p.order ?? (last ? last.order + 1 : 1),
    } });
    await touch(rid);
    return reply.code(201).send(await reportDetail(pid, rid));
  });

  app.patch("/projects/:pid/qa/reports/:rid/cases/:cid", async (req, reply) => {
    const { pid, rid, cid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r || !(await prisma.qaCase.findFirst({ where: { id: cid, reportId: rid }, select: { id: true } })))
      return notFound(reply);
    if (r.status === "closed") return locked(reply);
    const parsed = zPatchQaCase.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, parsed.error);
    await prisma.qaCase.update({ where: { id: cid }, data: parsed.data });
    await touch(rid);
    return reportDetail(pid, rid);
  });

  app.delete("/projects/:pid/qa/reports/:rid/cases/:cid", async (req, reply) => {
    const { pid, rid, cid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r || !(await prisma.qaCase.findFirst({ where: { id: cid, reportId: rid }, select: { id: true } })))
      return notFound(reply);
    if (r.status === "closed") return locked(reply);
    await removeQaAttachments({ reportId: rid, ownerType: "case", ownerId: cid });
    await prisma.$transaction([
      prisma.qaFinding.updateMany({ where: { reportId: rid, caseId: cid }, data: { caseId: null } }),
      prisma.qaCase.delete({ where: { id: cid } }),
    ]);
    await touch(rid);
    return reportDetail(pid, rid);
  });

  // ── temuan ───────────────────────────────────────────────────────────────
  // `caseId` soft-link tanpa FK: rujukan yang salah tak ditolak DB, jadi digerbang di sini dan
  // pesannya menyebut NILAI yang salah.
  const caseProblem = async (rid: string, caseId: string | null | undefined) =>
    caseId && !(await prisma.qaCase.findFirst({ where: { id: caseId, reportId: rid }, select: { id: true } }))
      ? { error: "test case tak ditemukan di laporan ini", caseId } : null;

  app.post("/projects/:pid/qa/reports/:rid/findings", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r) return notFound(reply);
    if (r.status === "closed") return locked(reply);
    const parsed = zCreateQaFinding.safeParse(req.body);
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;
    const problem = await caseProblem(rid, p.caseId);
    if (problem) return reply.code(400).send(problem);
    await prisma.qaFinding.create({ data: {
      reportId: rid, caseId: p.caseId, title: p.title, severity: p.severity, priority: p.priority,
      area: p.area, steps: asJson(p.steps), expected: p.expected, actual: p.actual, status: p.status,
    } });
    await touch(rid);
    return reply.code(201).send(await reportDetail(pid, rid));
  });

  app.patch("/projects/:pid/qa/reports/:rid/findings/:fid", async (req, reply) => {
    const { pid, rid, fid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r || !(await prisma.qaFinding.findFirst({ where: { id: fid, reportId: rid }, select: { id: true } })))
      return notFound(reply);
    if (r.status === "closed") return locked(reply);
    const parsed = zPatchQaFinding.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, parsed.error);
    const p = parsed.data;
    const problem = await caseProblem(rid, p.caseId);
    if (problem) return reply.code(400).send(problem);
    await prisma.qaFinding.update({ where: { id: fid }, data: {
      caseId: p.caseId, title: p.title, severity: p.severity, priority: p.priority, area: p.area,
      steps: p.steps === undefined ? undefined : asJson(p.steps), expected: p.expected, actual: p.actual,
      status: p.status,
    } });
    await touch(rid);
    return reportDetail(pid, rid);
  });

  app.delete("/projects/:pid/qa/reports/:rid/findings/:fid", async (req, reply) => {
    const { pid, rid, fid } = req.params as Ids;
    const r = await findReport(pid, rid);
    if (!r || !(await prisma.qaFinding.findFirst({ where: { id: fid, reportId: rid }, select: { id: true } })))
      return notFound(reply);
    if (r.status === "closed") return locked(reply);
    await removeQaAttachments({ reportId: rid, ownerType: "finding", ownerId: fid });
    await prisma.qaFinding.delete({ where: { id: fid } });
    await touch(rid);
    return reportDetail(pid, rid);
  });
}
```

`server/src/app.ts`: tambahkan `import qa from "./routes/qa";` bersama impor route lain, dan di blok `api.register` setelah `tasks`:

```ts
    await api.register(qa);           // Workspace QA · laporan/test case/temuan per project (capability `qa`)
```

- [x] **Step 5: Jalankan test + typecheck**

Run: `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"; env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/qa-reports.route.test.ts server/test/qa-model.test.ts --no-file-parallelism && pnpm --filter ./server typecheck`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/services/qa.ts server/src/services/qa-attachment.ts server/src/routes/qa.ts server/src/app.ts server/test/qa-reports.route.test.ts
git commit -m "feat(qa): route laporan, test case, dan temuan (local-only, 409 saat closed)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Lampiran QA (simpan, daftar, unduh, hapus)

**Files:**
- Create: `server/src/routes/qa-attachments.ts`, `server/test/qa-attachments.route.test.ts`
- Modify: `server/src/app.ts` (register `qaAttachments`)

**Interfaces:**
- Consumes (Task 4 Step 3b): `QA_ATTACHMENT_LIMITS`, `QaUpload`, `addQaAttachments`, `removeQaAttachments`, `ownerExists`; `readUpload` (`uploads.ts`).
- Produces REST: `POST /api/projects/:pid/qa/reports/:rid/attachments?ownerType=&ownerId=` (multipart `files`, `201 {saved, rejected}`), `GET …/attachments/:aid` (`?download=1` memaksa unduh), `DELETE …/attachments/:aid` → `{ ok: true }`.

- [x] **Step 1: Tulis test yang gagal** — `server/test/qa-attachments.route.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { readUpload } from "../src/services/uploads";
import { makeProject, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
// Multipart dirakit tangan: `app.inject` tak punya pembangun form-data (pola spec-attachments.route.test).
function multipart(files: { name: string; type: string; body: Buffer }[]) {
  const boundary = "----hanomanqatest";
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`, "utf8"), f.body, Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

let rid = ""; let fid = "";
const base = () => `/api/projects/p1/qa/reports/${rid}/attachments`;
const upload = (files: { name: string; type: string; body: Buffer }[], owner = `ownerType=report&ownerId=${rid}`) =>
  app.inject({ method: "POST", url: `${base()}?${owner}`, ...multipart(files) });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  rid = (await app.inject({ method: "POST", url: "/api/projects/p1/qa/reports", payload: { title: "Smoke" } })).json().id;
  const d = (await app.inject({ method: "POST", url: `/api/projects/p1/qa/reports/${rid}/findings`, payload: { title: "Bug" } })).json();
  fid = d.findings[0].id;
});

describe("lampiran QA", () => {
  it("unggah ke laporan dan ke temuan; muncul di detail dengan sha256 + syncState local-only", async () => {
    const a = await upload([{ name: "layar.png", type: "image/png", body: PNG }]);
    expect(a.statusCode).toBe(201);
    expect(a.json().saved[0]).toMatchObject({ filename: "layar.png", ownerType: "report", ownerId: rid, syncState: "local-only" });
    expect(a.json().saved[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const b = await upload([{ name: "log.txt", type: "text/plain", body: Buffer.from("boom\n") }], `ownerType=finding&ownerId=${fid}`);
    expect(b.json().saved[0]).toMatchObject({ ownerType: "finding", ownerId: fid });
    const detail = (await app.inject({ method: "GET", url: `/api/projects/p1/qa/reports/${rid}` })).json();
    expect(detail.attachments).toHaveLength(2);
  });

  it("400 owner tak valid (ownerType liar / ownerId bukan milik laporan ini)", async () => {
    expect((await upload([{ name: "a.png", type: "image/png", body: PNG }], "ownerType=banana&ownerId=x")).statusCode).toBe(400);
    expect((await upload([{ name: "a.png", type: "image/png", body: PNG }], "ownerType=finding&ownerId=hantu")).statusCode).toBe(400);
    expect((await upload([{ name: "a.png", type: "image/png", body: PNG }], "ownerType=report&ownerId=lain")).statusCode).toBe(400);
  });

  it("tipe tak didukung ditolak tanpa menggagalkan berkas lain", async () => {
    const res = await upload([
      { name: "jahat.sh", type: "application/x-sh", body: Buffer.from("rm -rf /") },
      { name: "ok.md", type: "text/markdown", body: Buffer.from("# hai\n") },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().saved).toHaveLength(1);
    expect(res.json().rejected).toEqual([{ filename: "jahat.sh", reason: "type" }]);
  });

  it("gambar disajikan inline + nosniff; berkas lain & ?download=1 sebagai attachment", async () => {
    const png = (await upload([{ name: "layar.png", type: "image/png", body: PNG }])).json().saved[0];
    const txt = (await upload([{ name: "log.txt", type: "text/plain", body: Buffer.from("x") }])).json().saved[0];
    const img = await app.inject({ method: "GET", url: `${base()}/${png.id}` });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(String(img.headers["content-disposition"])).toMatch(/^inline/);
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(String((await app.inject({ method: "GET", url: `${base()}/${png.id}?download=1` })).headers["content-disposition"])).toMatch(/^attachment/);
    expect(String((await app.inject({ method: "GET", url: `${base()}/${txt.id}` })).headers["content-disposition"])).toMatch(/^attachment/);
  });

  it("DELETE menghapus baris DAN byte di disk; 404 lampiran laporan lain", async () => {
    const a = (await upload([{ name: "layar.png", type: "image/png", body: PNG }])).json().saved[0];
    const row = await prisma.qaAttachment.findUniqueOrThrow({ where: { id: a.id } });
    expect((await app.inject({ method: "DELETE", url: `${base()}/${a.id}` })).json()).toEqual({ ok: true });
    expect(await prisma.qaAttachment.count()).toBe(0);
    await expect(readUpload(row.storageKey)).rejects.toBeTruthy();
    expect((await app.inject({ method: "DELETE", url: `${base()}/${a.id}` })).statusCode).toBe(404);
  });

  it("menghapus temuan / laporan ikut membuang lampirannya (baris + byte)", async () => {
    const a = (await upload([{ name: "l.png", type: "image/png", body: PNG }], `ownerType=finding&ownerId=${fid}`)).json().saved[0];
    const key = (await prisma.qaAttachment.findUniqueOrThrow({ where: { id: a.id } })).storageKey;
    await app.inject({ method: "DELETE", url: `/api/projects/p1/qa/reports/${rid}/findings/${fid}` });
    expect(await prisma.qaAttachment.count()).toBe(0);
    await expect(readUpload(key)).rejects.toBeTruthy();

    const b = (await upload([{ name: "l2.png", type: "image/png", body: PNG }])).json().saved[0];
    const key2 = (await prisma.qaAttachment.findUniqueOrThrow({ where: { id: b.id } })).storageKey;
    await app.inject({ method: "DELETE", url: `/api/projects/p1/qa/reports/${rid}` });
    await expect(readUpload(key2)).rejects.toBeTruthy();
  });

  it("laporan closed menolak unggah dan hapus lampiran (409)", async () => {
    const a = (await upload([{ name: "l.png", type: "image/png", body: PNG }])).json().saved[0];
    await app.inject({ method: "PATCH", url: `/api/projects/p1/qa/reports/${rid}`, payload: { status: "closed", verdict: "go" } });
    expect((await upload([{ name: "l2.png", type: "image/png", body: PNG }])).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `${base()}/${a.id}` })).statusCode).toBe(409);
  });

  it("400 bukan multipart; 400 tanpa berkas", async () => {
    expect((await app.inject({ method: "POST", url: `${base()}?ownerType=report&ownerId=${rid}`, payload: { a: 1 } })).statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"; env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/qa-attachments.route.test.ts --no-file-parallelism`
Expected: FAIL (404 route belum ada).

- [x] **Step 3: Route** — `server/src/routes/qa-attachments.ts`

```ts
import type { FastifyInstance } from "fastify";
import { QA_OWNER_TYPES, type QaOwnerType } from "@hanoman/shared";
import { prisma } from "../db";
import { QA_ATTACHMENT_LIMITS, addQaAttachments, ownerExists, removeQaAttachments, type QaUpload } from "../services/qa-attachment";
import { readUpload } from "../services/uploads";

// Workspace QA · lampiran. Capability `qa:*` dari prefix `/projects/:id/qa` (`capabilityForRoute`).
// Batas multipart dipasang PER-REQUEST (registrasi global milik lampiran gambar SPEC-816 tak boleh naik).
const INLINE = new Set(["image/png", "image/jpeg", "image/webp"]);

export default async function qaAttachments(app: FastifyInstance) {
  type Ids = { pid: string; rid: string; aid: string };

  app.post("/projects/:pid/qa/reports/:rid/attachments", async (req, reply) => {
    const { pid, rid } = req.params as Ids;
    const report = await prisma.qaReport.findFirst({ where: { id: rid, projectId: pid }, select: { id: true, projectId: true, status: true } });
    if (!report) return reply.code(404).send({ error: "not found" });
    if (report.status === "closed") return reply.code(409).send({ error: "laporan sudah closed" });

    const q = req.query as { ownerType?: string; ownerId?: string };
    if (!(QA_OWNER_TYPES as readonly string[]).includes(q.ownerType ?? "") || !q.ownerId
      || !(await ownerExists(rid, q.ownerType!, q.ownerId)))
      return reply.code(400).send({ error: "ownerType/ownerId tak valid untuk laporan ini", ownerType: q.ownerType, ownerId: q.ownerId });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    const files: QaUpload[] = [];
    try {
      for await (const part of (req as any).parts({
        limits: { fileSize: QA_ATTACHMENT_LIMITS.fileBytes, files: QA_ATTACHMENT_LIMITS.perReport + 2 },
      })) {
        if (part.type !== "file") continue;
        const buf = await part.toBuffer();   // menguras stream — tanpa ini busboy menggantung
        files.push({ buf, mime: part.mimetype, name: String(part.filename ?? "lampiran"), truncated: part.file?.truncated === true });
      }
    } catch { return reply.code(400).send({ error: "unggahan tak valid" }); }
    if (!files.length) return reply.code(400).send({ error: "tak ada berkas" });

    const result = await addQaAttachments(report, { ownerType: q.ownerType as QaOwnerType, ownerId: q.ownerId }, files);
    await prisma.qaReport.update({ where: { id: rid }, data: { updatedAt: new Date() } });
    return reply.code(201).send(result);
  });

  app.get("/projects/:pid/qa/reports/:rid/attachments/:aid", async (req, reply) => {
    const { pid, rid, aid } = req.params as Ids;
    const a = await prisma.qaAttachment.findFirst({ where: { id: aid, reportId: rid, projectId: pid } });
    if (!a) return reply.code(404).send({ error: "not found" });
    const buf = await readUpload(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    const forceDownload = (req.query as { download?: string }).download === "1";
    const inline = INLINE.has(a.mimeType) && !forceDownload;
    reply.header("content-type", a.mimeType);
    reply.header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${a.filename.replace(/["\\\r\n]/g, "_")}"`);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");
    return reply.send(buf);
  });

  app.delete("/projects/:pid/qa/reports/:rid/attachments/:aid", async (req, reply) => {
    const { pid, rid, aid } = req.params as Ids;
    const report = await prisma.qaReport.findFirst({ where: { id: rid, projectId: pid }, select: { status: true } });
    if (!report || !(await prisma.qaAttachment.findFirst({ where: { id: aid, reportId: rid }, select: { id: true } })))
      return reply.code(404).send({ error: "not found" });
    if (report.status === "closed") return reply.code(409).send({ error: "laporan sudah closed" });
    await removeQaAttachments({ id: aid });
    return { ok: true };
  });
}
```

`server/src/app.ts`: `import qaAttachments from "./routes/qa-attachments";` dan `await api.register(qaAttachments);` tepat setelah `qa`.

- [x] **Step 4: Jalankan test + typecheck**

Run: `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"; env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/qa-attachments.route.test.ts server/test/qa-reports.route.test.ts --no-file-parallelism && pnpm --filter ./server typecheck`
Expected: PASS. Catatan: test "bukan multipart" memukul gerbang `isMultipart` — bila `app.inject` dengan JSON body justru kena 415 dari Fastify, ubah ekspektasi menjadi `[400, 415]` (`expect([400, 415]).toContain(…)`).

- [x] **Step 5: Commit**

```bash
git add server/src/routes/qa-attachments.ts server/src/app.ts server/test/qa-attachments.route.test.ts
git commit -m "feat(qa): lampiran QA lewat pipeline unggahan (sha256, kuota, 409 saat closed)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


---

### Task 6: Render + parse Markdown laporan (murni, `shared`)

**Files:**
- Create: `shared/src/qa-markdown.ts`, `shared/src/qa-markdown.test.ts`
- Modify: `shared/src/index.ts` (`export * from "./qa-markdown";`)

**Interfaces:**
- Consumes (Task 1): `QaReportDetail`, `QaAttachmentView`, enum `QA_*`.
- Produces: `renderQaMarkdown(detail, paths?: Record<attachmentId, string>): string`; `parseQaMarkdown(text): QaParsedReport` (melempar `QaMarkdownError` ber-`line`); `qaTemplateMarkdown(): string`; tipe `QaParsedReport`, `QaParsedCase`, `QaParsedFinding`; kelas `QaMarkdownError`. `paths` memetakan id lampiran → path relatif di ZIP (default `attachments/<filename>`).

Format (kontrak yang dikunci test): front-matter YAML (`hanoman-qa: 1`, nilai string berbentuk JSON), judul `# QA-007 · Judul`, blockquote ringkasan angka (diabaikan parser), lalu seksi `## Ringkasan`, `## Test case` (tabel 7 kolom: Kode · Judul · Langkah · Diharapkan · Aktual · Status · Ref), `## Temuan` (`### F-01 · [major/P1] Judul` + komentar `<!-- hanoman:{json} -->` + `**Area:**`/`**Test case:**` + blok `**Repro**` (daftar bernomor) / `**Expected**` / `**Actual**` / `**Lampiran**`), `## Lampiran`, `## Lampiran test case` (`### TC-01` + daftar). Teks bebas di-escape agar tak bisa meniru struktur: baris yang diawali `#`, `**`, atau `\` diberi awalan `\`; sel tabel meng-escape `\` dan `|` serta mengubah baris baru jadi `<br>`.

- [x] **Step 1: Tulis test yang gagal** — `shared/src/qa-markdown.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { qaStats, type QaReportDetail } from "./qa";
import { QaMarkdownError, parseQaMarkdown, qaTemplateMarkdown, renderQaMarkdown } from "./qa-markdown";

const at = "2026-10-01T10:00:00.000Z";
const base = { createdAt: at, updatedAt: at };
const cases = [
  { ...base, id: "c1", reportId: "r1", code: "TC-01", title: "Login | valid", steps: "1. buka\n2. isi", expected: "masuk", actual: "masuk", status: "pass" as const, order: 1 },
  { ...base, id: "c2", reportId: "r1", code: "TC-02", title: "Bayar", steps: "", expected: "form bayar", actual: "diam", status: "fail" as const, order: 2 },
];
const findings = [{
  ...base, id: "f1", reportId: "r1", code: "F-01", caseId: "c2", caseCode: "TC-02", title: "Tombol bayar mati",
  severity: "major" as const, priority: "P1" as const, area: "checkout", steps: ["buka keranjang", "klik bayar"],
  expected: "form bayar", actual: "tidak ada reaksi\nkonsol error", status: "open" as const, backlogId: null,
}];
const att = (id: string, ownerType: "report" | "case" | "finding", ownerId: string, filename: string, mimeType: string) =>
  ({ id, reportId: "r1", ownerType, ownerId, filename, mimeType, size: 1, sha256: "x", syncState: "local-only" as const, createdAt: at });
const detail: QaReportDetail = {
  ...base, id: "r1", projectId: "p1", code: "QA-007", title: 'Smoke "checkout" 0.9', buildVersion: "0.9.12",
  environment: { os: "macOS", browser: "Chrome" }, scope: "checkout\nlogin", tester: "Dena",
  summary: "Hasil baik.\n## Bukan heading\n**Repro** bukan label\n\\garis miring", status: "submitted", verdict: "conditional",
  stats: qaStats(cases, findings), cases, findings,
  attachments: [
    att("a1", "report", "r1", "ringkas.pdf", "application/pdf"),
    att("a2", "finding", "f1", "layar.png", "image/png"),
    att("a3", "case", "c2", "log.txt", "text/plain"),
  ],
};
const paths = { a1: "attachments/QA-007-1-ringkas.pdf", a2: "attachments/F-01-1-layar.png", a3: "attachments/TC-02-1-log.txt" };

describe("renderQaMarkdown", () => {
  const md = renderQaMarkdown(detail, paths);
  it("memuat front-matter, judul, tabel, dan blok temuan yang terbaca manusia", () => {
    expect(md.startsWith("---\nhanoman-qa: 1\n")).toBe(true);
    expect(md).toContain("# QA-007 · Smoke \"checkout\" 0.9");
    expect(md).toContain("### F-01 · [major/P1] Tombol bayar mati");
    expect(md).toContain("**Test case:** TC-02");
    expect(md).toContain("1. buka keranjang\n2. klik bayar");
    expect(md).toContain("- ![layar.png](attachments/F-01-1-layar.png)");
    expect(md).toContain("- [ringkas.pdf](attachments/QA-007-1-ringkas.pdf)");
  });
  it("tanpa `paths`, tautan lampiran memakai attachments/<filename>", () => {
    expect(renderQaMarkdown(detail)).toContain("(attachments/layar.png)");
  });
});

describe("parseQaMarkdown · round-trip", () => {
  const p = parseQaMarkdown(renderQaMarkdown(detail, paths));
  it("meta laporan", () => {
    expect(p).toMatchObject({
      reportId: "r1", title: 'Smoke "checkout" 0.9', buildVersion: "0.9.12", tester: "Dena",
      scope: "checkout\nlogin", status: "submitted", verdict: "conditional", environment: { os: "macOS", browser: "Chrome" },
    });
  });
  it("teks bebas yang meniru struktur tetap utuh", () => {
    expect(p.summary).toBe("Hasil baik.\n## Bukan heading\n**Repro** bukan label\n\\garis miring");
  });
  it("test case, termasuk pipa & baris baru di sel", () => {
    expect(p.cases).toHaveLength(2);
    expect(p.cases[0]).toMatchObject({ id: "c1", code: "TC-01", title: "Login | valid", steps: "1. buka\n2. isi", status: "pass", attachments: [] });
    expect(p.cases[1]).toMatchObject({ id: "c2", status: "fail", attachments: [paths.a3] });
  });
  it("temuan lengkap", () => {
    expect(p.findings).toHaveLength(1);
    expect(p.findings[0]).toMatchObject({
      id: "f1", caseId: "c2", caseCode: "TC-02", title: "Tombol bayar mati", severity: "major", priority: "P1",
      area: "checkout", status: "open", steps: ["buka keranjang", "klik bayar"], expected: "form bayar",
      actual: "tidak ada reaksi\nkonsol error", attachments: [paths.a2],
    });
  });
  it("lampiran tingkat laporan", () => {
    expect(p.attachments).toEqual([paths.a1]);
  });
});

describe("parseQaMarkdown · galat berbaris", () => {
  const good = renderQaMarkdown(detail, paths);
  const lineOf = (needle: string) => good.split("\n").findIndex((l) => l.includes(needle)) + 1;
  const expectLine = (text: string, line: number) => {
    try { parseQaMarkdown(text); } catch (e) {
      expect(e).toBeInstanceOf(QaMarkdownError);
      expect((e as QaMarkdownError).line).toBe(line);
      return;
    }
    throw new Error("seharusnya melempar");
  };
  it("front-matter hilang → baris 1", () => expectLine("# hanya judul\n", 1));
  it("status tak dikenal → baris status", () => expectLine(good.replace("status: submitted", "status: selesai"), lineOf("status: submitted")));
  it("severity tak dikenal → baris judul temuan", () => {
    expectLine(good.replace("[major/P1]", "[gawat/P1]"), lineOf("### F-01"));
  });
  it("judul temuan tak berformat → baris itu", () => {
    expectLine(good.replace("### F-01 · [major/P1] Tombol bayar mati", "### Temuan bebas"), lineOf("### F-01"));
  });
  it("baris tabel test case bukan 7 kolom → baris itu", () => {
    const bad = good.split("\n").map((l) => (l.startsWith("| TC-02") ? "| TC-02 | cuma | tiga |" : l)).join("\n");
    expectLine(bad, lineOf("| TC-02"));
  });
  it("langkah repro tak bernomor → baris itu", () => {
    expectLine(good.replace("2. klik bayar", "klik bayar tanpa nomor"), lineOf("2. klik bayar"));
  });
});

describe("qaTemplateMarkdown", () => {
  it("dapat diurai apa adanya: tanpa reportId, satu contoh case dan satu temuan", () => {
    const p = parseQaMarkdown(qaTemplateMarkdown());
    expect(p.reportId).toBeNull();
    expect(p.status).toBe("draft");
    expect(p.cases).toHaveLength(1);
    expect(p.cases[0]!.id).toBeNull();
    expect(p.findings).toHaveLength(1);
    expect(p.findings[0]).toMatchObject({ id: null, severity: "major", status: "open" });
  });
  it("memuat panduan pengisian", () => {
    expect(qaTemplateMarkdown()).toMatch(/Severity/i);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/src/qa-markdown.test.ts --no-file-parallelism`
Expected: FAIL — modul belum ada.

- [x] **Step 3: Implementasi** — `shared/src/qa-markdown.ts`

```ts
import {
  QA_CASE_STATUSES, QA_FINDING_STATUSES, QA_PRIORITIES, QA_REPORT_STATUSES, QA_SEVERITIES, QA_VERDICTS,
  qaStats,
  type QaAttachmentView, type QaCaseStatus, type QaFindingStatus, type QaPriority, type QaReportDetail,
  type QaReportStatus, type QaSeverity, type QaVerdict,
} from "./qa";

// Workspace QA · format Markdown laporan (template, ekspor, impor). Murni — nol I/O.
// Kontrak formatnya dikunci `qa-markdown.test.ts`; ubah keduanya bersama.

export class QaMarkdownError extends Error {
  constructor(message: string, readonly line: number) {
    super(`baris ${line}: ${message}`);
    this.name = "QaMarkdownError";
  }
}

export type QaParsedCase = {
  id: string | null; code: string; title: string; steps: string; expected: string; actual: string;
  status: QaCaseStatus; attachments: string[];
};
export type QaParsedFinding = {
  id: string | null; caseId: string | null; caseCode: string | null; code: string; title: string;
  severity: QaSeverity; priority: QaPriority; area: string; status: QaFindingStatus;
  steps: string[]; expected: string; actual: string; attachments: string[];
};
export type QaParsedReport = {
  reportId: string | null; title: string; buildVersion: string; tester: string; scope: string;
  status: QaReportStatus; verdict: QaVerdict | null; environment: Record<string, string>;
  summary: string; cases: QaParsedCase[]; findings: QaParsedFinding[]; attachments: string[];
};

// ── escape ──────────────────────────────────────────────────────────────────
// Teks bebas tak boleh meniru struktur (judul seksi, label **Repro**). Baris yang diawali `#`, `**`,
// atau `\` diberi awalan `\`; unesc adalah kebalikan persisnya.
const esc = (s: string) => s.replace(/^(#|\*\*|\\)/gm, "\\$1");
const unesc = (s: string) => s.replace(/^\\(#|\*\*|\\)/gm, "$1");
const block = (lines: string[]) => unesc(lines.join("\n").replace(/^\s*\n|\n\s*$/g, "").trim());
const oneLine = (s: string) => s.replace(/\s*\r?\n\s*/g, " ").trim();
const q = (s: string) => JSON.stringify(s);
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && i + 1 < line.length) { cur += line[++i]; continue; }
    if (c === "|") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.slice(1, -1).map((s) => s.trim().replace(/<br>/g, "\n"));
}

// ── render ──────────────────────────────────────────────────────────────────
export function renderQaMarkdown(d: QaReportDetail, paths: Record<string, string> = {}): string {
  const att = (type: string, id: string) => d.attachments.filter((a) => a.ownerType === type && a.ownerId === id);
  const link = (a: QaAttachmentView) => {
    const name = a.filename.replace(/[[\]]/g, "_");
    return `- ${a.mimeType.startsWith("image/") ? "!" : ""}[${name}](${paths[a.id] ?? `attachments/${a.filename}`})`;
  };
  const s = d.stats;
  const L: string[] = [
    "---", "hanoman-qa: 1", `reportId: ${q(d.id)}`, `project: ${q(d.projectId)}`, `code: ${q(d.code)}`,
    `title: ${q(oneLine(d.title))}`, `build: ${q(d.buildVersion)}`, `tester: ${q(d.tester)}`,
    `status: ${d.status}`, `verdict: ${d.verdict ?? "null"}`, `scope: ${q(d.scope)}`,
    `environment: ${JSON.stringify(d.environment)}`, "---", "",
    `# ${d.code} · ${oneLine(d.title)}`, "",
    `> Test case: ${s.cases.total} · pass ${s.cases.pass} · fail ${s.cases.fail} · blocked ${s.cases.blocked} · skipped ${s.cases.skipped} · todo ${s.cases.todo}`
      + ` · pass rate ${s.passRate === null ? "—" : `${Math.round(s.passRate * 100)}%`}`,
    `> Temuan: ${s.findings.total} (blocker ${s.findings.blocker} · critical ${s.findings.critical} · major ${s.findings.major} · minor ${s.findings.minor} · trivial ${s.findings.trivial}) · open ${s.findings.open}`,
    `> Keputusan: ${d.verdict ?? "belum diputuskan"}`, "",
    "## Ringkasan", "", esc(d.summary), "",
    "## Test case", "",
    "| Kode | Judul | Langkah | Diharapkan | Aktual | Status | Ref |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...d.cases.map((c) => `| ${c.code} | ${cell(c.title)} | ${cell(c.steps)} | ${cell(c.expected)} | ${cell(c.actual)} | ${c.status} | ${c.id} |`),
    "", "## Temuan", "",
  ];
  for (const f of d.findings) {
    const meta = JSON.stringify({ id: f.id, caseId: f.caseId, status: f.status }).replace(/>/g, "\\u003e");
    L.push(`### ${f.code} · [${f.severity}/${f.priority}] ${oneLine(f.title)}`, `<!-- hanoman:${meta} -->`, "");
    if (f.area) L.push(`**Area:** ${oneLine(f.area)}`, "");
    if (f.caseCode) L.push(`**Test case:** ${f.caseCode}`, "");
    L.push("**Repro**", "", ...(f.steps.length ? f.steps.map((t, i) => `${i + 1}. ${oneLine(t)}`) : []), "");
    L.push("**Expected**", "", esc(f.expected), "", "**Actual**", "", esc(f.actual), "");
    const a = att("finding", f.id);
    if (a.length) L.push("**Lampiran**", "", ...a.map(link), "");
  }
  L.push("## Lampiran", "", ...att("report", d.id).map(link), "");
  L.push("## Lampiran test case", "");
  for (const c of d.cases) {
    const a = att("case", c.id);
    if (a.length) L.push(`### ${c.code}`, "", ...a.map(link), "");
  }
  return L.join("\n").trimEnd() + "\n";   // tanpa pemadatan baris kosong: teks bebas harus kembali identik
}

// ── parse ───────────────────────────────────────────────────────────────────
const fmValue = (v: string): unknown => { try { return JSON.parse(v); } catch { return v.trim(); } };
const pathsIn = (lines: string[]) =>
  lines.flatMap((l) => { const m = /\]\((attachments\/[^)\s]+)\)/.exec(l); return m ? [m[1]!] : []; });
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], what: string, line: number): T => {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new QaMarkdownError(`${what} tak dikenal: "${String(v)}" (pilihan: ${allowed.join(", ")})`, line);
};

export function parseQaMarkdown(text: string): QaParsedReport {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new QaMarkdownError("front-matter (---) tidak ditemukan di awal berkas", 1);

  const fm: Record<string, unknown> = {};
  const fmLine: Record<string, number> = {};
  let i = 1;
  for (; i < lines.length && lines[i]!.trim() !== "---"; i++) {
    if (lines[i]!.trim() === "") continue;
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!m) throw new QaMarkdownError(`front-matter tak valid: "${lines[i]}"`, i + 1);
    fm[m[1]!] = fmValue(m[2]!);
    fmLine[m[1]!] = i + 1;
  }
  if (i >= lines.length) throw new QaMarkdownError("front-matter tidak ditutup dengan ---", lines.length);
  if (fm["hanoman-qa"] !== 1) throw new QaMarkdownError("bukan laporan hanoman-qa versi 1 (butuh `hanoman-qa: 1`)", fmLine["hanoman-qa"] ?? 2);
  const fs = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : "");

  const status = fm.status === undefined ? "draft" : oneOf(fm.status, QA_REPORT_STATUSES, "status", fmLine.status!);
  const verdict = fm.verdict === undefined || fm.verdict === null || fm.verdict === "null"
    ? null : oneOf(fm.verdict, QA_VERDICTS, "verdict", fmLine.verdict!);
  if (!fs("title").trim()) throw new QaMarkdownError("title wajib diisi di front-matter", fmLine.title ?? 2);
  const environment: Record<string, string> = {};
  if (fm.environment && typeof fm.environment === "object" && !Array.isArray(fm.environment))
    for (const [k, v] of Object.entries(fm.environment)) if (typeof v === "string") environment[k] = v;

  // seksi `## …`; nomor baris absolut (1-based) untuk baris ke-idx sebuah seksi = start + idx + 2
  type Sec = { name: string; start: number; lines: string[] };
  const secs: Sec[] = [];
  let cur: Sec | null = null;
  for (let j = i + 1; j < lines.length; j++) {
    const m = /^## (.+?)\s*$/.exec(lines[j]!);
    if (m) { cur = { name: m[1]!.toLowerCase(), start: j, lines: [] }; secs.push(cur); continue; }
    cur?.lines.push(lines[j]!);
  }
  const sec = (name: string) => secs.find((s) => s.name === name);
  const abs = (s: Sec, idx: number) => s.start + idx + 2;

  const cases: QaParsedCase[] = [];
  const cs = sec("test case");
  if (cs) {
    const rows = cs.lines.map((l, idx) => ({ l, idx })).filter((x) => x.l.trimStart().startsWith("|")).slice(2);
    for (const { l, idx } of rows) {
      const c = splitRow(l.trim());
      if (c.length !== 7) throw new QaMarkdownError(`baris tabel test case harus 7 kolom, ditemukan ${c.length}`, abs(cs, idx));
      if (!c[1]) throw new QaMarkdownError("judul test case kosong", abs(cs, idx));
      cases.push({
        id: c[6] || null, code: c[0]!, title: c[1], steps: c[2]!, expected: c[3]!, actual: c[4]!,
        status: oneOf(c[5], QA_CASE_STATUSES, "status test case", abs(cs, idx)), attachments: [],
      });
    }
  }

  const findings: QaParsedFinding[] = [];
  const fs2 = sec("temuan");
  if (fs2) {
    const heads = fs2.lines.map((l, idx) => ({ l, idx })).filter((x) => x.l.startsWith("### "));
    heads.forEach((h, n) => {
      const hm = /^### (F-\d+) · \[(\w+)\/(P\d)\] (.+)$/.exec(h.l);
      if (!hm) throw new QaMarkdownError("judul temuan tak valid; format: `### F-01 · [major/P1] Judul`", abs(fs2, h.idx));
      const severity = oneOf(hm[2], QA_SEVERITIES, "severity", abs(fs2, h.idx));
      const priority = oneOf(hm[3], QA_PRIORITIES, "prioritas", abs(fs2, h.idx));
      const end = n + 1 < heads.length ? heads[n + 1]!.idx : fs2.lines.length;
      let meta: { id?: unknown; caseId?: unknown; status?: unknown } = {};
      let area = "";
      let caseCode: string | null = null;
      let part: "head" | "repro" | "expected" | "actual" | "att" = "head";
      const b = { repro: [] as { l: string; idx: number }[], expected: [] as string[], actual: [] as string[], att: [] as string[] };
      for (let k = h.idx + 1; k < end; k++) {
        const l = fs2.lines[k]!;
        const mm = /^<!-- hanoman:(.*) -->$/.exec(l);
        if (mm) {
          try { meta = JSON.parse(mm[1]!); } catch { throw new QaMarkdownError("metadata temuan (<!-- hanoman:… -->) bukan JSON valid", abs(fs2, k)); }
          continue;
        }
        const am = /^\*\*Area:\*\* ?(.*)$/.exec(l);
        if (am) { area = am[1]!.trim(); continue; }
        const tm = /^\*\*Test case:\*\* ?(TC-\d+)\s*$/.exec(l);
        if (tm) { caseCode = tm[1]!; continue; }
        if (l === "**Repro**") { part = "repro"; continue; }
        if (l === "**Expected**") { part = "expected"; continue; }
        if (l === "**Actual**") { part = "actual"; continue; }
        if (l === "**Lampiran**") { part = "att"; continue; }
        if (part === "repro") b.repro.push({ l, idx: k });
        else if (part === "expected") b.expected.push(l);
        else if (part === "actual") b.actual.push(l);
        else if (part === "att") b.att.push(l);
      }
      const steps = b.repro.filter((x) => x.l.trim() !== "").map((x) => {
        const sm = /^\d+\. (.+)$/.exec(x.l);
        if (!sm) throw new QaMarkdownError("langkah repro harus berformat `1. teks`", abs(fs2, x.idx));
        return sm[1]!.trim();
      });
      findings.push({
        id: typeof meta.id === "string" && meta.id ? meta.id : null,
        caseId: typeof meta.caseId === "string" && meta.caseId ? meta.caseId : null,
        caseCode, code: hm[1]!, title: hm[4]!.trim(), severity, priority, area,
        status: meta.status === undefined ? "open" : oneOf(meta.status, QA_FINDING_STATUSES, "status temuan", abs(fs2, h.idx)),
        steps, expected: block(b.expected), actual: block(b.actual), attachments: pathsIn(b.att),
      });
    });
  }

  const ls = sec("lampiran test case");
  if (ls) {
    let code: string | null = null;
    for (const l of ls.lines) {
      const hm = /^### (TC-\d+)\s*$/.exec(l);
      if (hm) { code = hm[1]!; continue; }
      const c = code ? cases.find((x) => x.code === code) : undefined;
      if (c) c.attachments.push(...pathsIn([l]));
    }
  }

  return {
    reportId: fs("reportId") || null, title: fs("title").trim(), buildVersion: fs("build"), tester: fs("tester"),
    scope: fs("scope"), status, verdict, environment, summary: block(sec("ringkasan")?.lines ?? []),
    cases, findings, attachments: pathsIn(sec("lampiran")?.lines ?? []),
  };
}

// ── template ────────────────────────────────────────────────────────────────
const GUIDE = [
  "> **Cara mengisi** — hapus baris contoh, isi sendiri, lalu unggah berkas ini lewat tombol *Impor* di Workspace QA.",
  "> - **Severity** (dampak teknis): blocker · critical · major · minor · trivial. **Prioritas** (urutan perbaikan): P0–P3. Keduanya tidak selalu sama.",
  "> - **Status test case**: todo · pass · fail · blocked · skipped. **Keputusan** (front-matter `verdict`): go · no-go · conditional.",
  "> - Satu temuan = satu masalah. Tulis **Repro** sebagai langkah bernomor yang bisa diulang orang lain, lalu **Expected** vs **Actual**.",
  "> - Lampiran: taruh berkas di folder `attachments/` (ZIP) dan tautkan dengan `![nama](attachments/nama.png)` di bawah **Lampiran** temuan.",
  "> - Biarkan kolom **Ref** dan baris `<!-- hanoman:… -->` apa adanya; kosongkan untuk entri baru.",
];

export function qaTemplateMarkdown(): string {
  const at = new Date(0).toISOString();
  const caseRow = { id: "", reportId: "", code: "TC-01", title: "Contoh: login dengan akun valid", steps: "1. Buka /login\n2. Isi email & kata sandi\n3. Klik Masuk", expected: "Masuk ke dashboard", actual: "Masuk ke dashboard", status: "pass" as const, order: 1, createdAt: at, updatedAt: at };
  const finding = { id: "", reportId: "", code: "F-01", caseId: null, caseCode: "TC-01", title: "Contoh: tombol Masuk tidak bereaksi di Safari", severity: "major" as const, priority: "P1" as const, area: "auth", steps: ["Buka /login di Safari 18", "Isi kredensial valid", "Klik Masuk"], expected: "Masuk ke dashboard", actual: "Tidak ada reaksi; konsol menampilkan TypeError", status: "open" as const, backlogId: null, createdAt: at, updatedAt: at };
  const d: QaReportDetail = {
    id: "", projectId: "", code: "QA-001", title: "Judul laporan — mis. Smoke test rilis 1.0", buildVersion: "1.0.0",
    environment: { os: "macOS 15", browser: "Chrome 130", device: "MacBook Pro", url: "https://staging.example.com", branch: "main" },
    scope: "Apa yang diuji dan apa yang sengaja tidak diuji.", tester: "Nama penguji",
    summary: "Ringkasan hasil dalam 2–3 kalimat: keputusan go/no-go dan alasannya.", status: "draft", verdict: null,
    createdAt: at, updatedAt: at, stats: qaStats([caseRow], [finding]), cases: [caseRow], findings: [finding], attachments: [],
  };
  return renderQaMarkdown(d).replace(/^(# .*\n)/m, `$1\n${GUIDE.join("\n")}\n`);
}
```

Tambahkan `export * from "./qa-markdown";` di `shared/src/index.ts`.

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run shared/src/qa-markdown.test.ts shared/src/qa.test.ts --no-file-parallelism && pnpm --filter ./shared typecheck`
Expected: PASS. Bila satu case round-trip gagal, jangan melonggarkan test — perbaiki escape/parse (kontrak: teks bebas kembali **identik**).

- [x] **Step 5: Commit**

```bash
git add shared/src/qa-markdown.ts shared/src/qa-markdown.test.ts shared/src/index.ts
git commit -m "feat(qa): render/parse Markdown laporan + template (round-trip, galat berbaris)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ZIP, ekspor, impor, dan template (server)

**Files:**
- Create: `server/src/services/zip.ts`, `server/src/services/qa-transfer.ts`, `server/src/routes/qa-transfer.ts`, `server/test/zip.test.ts`, `server/test/qa-transfer.route.test.ts`
- Modify: `server/src/app.ts` (register `qaTransfer`)

**Interfaces:**
- Consumes (Task 4–6): `reportDetail`, `asJson`, `attachmentView`; `addQaAttachments`, `QA_ATTACHMENT_LIMITS`; `renderQaMarkdown`, `parseQaMarkdown`, `qaTemplateMarkdown`, `QaMarkdownError`; `readUpload`.
- Produces: `writeZip(entries)`, `readZip(buf, opts)`, `ZipError`, `crc32`; `exportReport(projectId, reportId)`, `importReport(projectId, file)`, `QaImportError(status, message)`. REST: `GET /api/projects/:pid/qa/reports/:rid/export` (ZIP; `?format=md` = hanya Markdown), `POST /api/projects/:pid/qa/import` (multipart satu berkas `.zip`/`.md` → `201|200 { reportId, created, cases, findings, attachments: { saved, rejected } }`), `GET /api/qa/template.md`.

Semantik impor: `reportId` di berkas yang cocok dengan laporan di project ini → **upsert** (case/temuan dicocokkan lewat id; yang tak ada di berkas dibiarkan; lampiran dengan nama sama pada pemilik yang sama dilewati); selain itu laporan **baru** dengan id baru (id dari berkas tak dipakai, `caseId` di-remap). Status temuan `sent` dari berkas dipulihkan jadi `open`. `status` ∈ {submitted, closed} tanpa `verdict` → 400. Target `closed` → 409.

- [x] **Step 1: Test ZIP yang gagal** — `server/test/zip.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ZipError, crc32, readZip, writeZip } from "../src/services/zip";

describe("zip", () => {
  it("crc32 nilai baku", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it("round-trip: stored + deflate, biner & nama unicode", () => {
    const bin = Buffer.from([0, 1, 2, 255, 254, 0, 7]);
    const txt = Buffer.from("halo dunia ".repeat(200));
    const zip = writeZip([
      { name: "report.md", data: txt, deflate: true },
      { name: "attachments/layar ✓.png", data: bin },
      { name: "kosong.txt", data: Buffer.alloc(0), deflate: true },
    ]);
    expect(zip.length).toBeLessThan(txt.length); // deflate benar-benar memampatkan
    const out = readZip(zip);
    expect([...out.keys()]).toEqual(["report.md", "attachments/layar ✓.png", "kosong.txt"]);
    expect(out.get("report.md")!.equals(txt)).toBe(true);
    expect(out.get("attachments/layar ✓.png")!.equals(bin)).toBe(true);
    expect(out.get("kosong.txt")!.length).toBe(0);
  });
  it("menolak bukan-ZIP, nama tak aman, terlalu banyak entri, dan melewati batas ukuran", () => {
    expect(() => readZip(Buffer.from("bukan zip"))).toThrow(ZipError);
    expect(() => readZip(writeZip([{ name: "../evil.txt", data: Buffer.from("x") }]))).toThrow(/tak aman/);
    expect(() => readZip(writeZip([{ name: "/abs.txt", data: Buffer.from("x") }]))).toThrow(/tak aman/);
    const many = writeZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from("x") })));
    expect(() => readZip(many, { maxEntries: 3 })).toThrow(/terlalu banyak/);
    expect(() => readZip(writeZip([{ name: "a.bin", data: Buffer.alloc(100) }]), { maxTotalBytes: 50 })).toThrow(/melebihi batas/);
  });
  it("mendeteksi entri rusak (CRC)", () => {
    const zip = Buffer.from(writeZip([{ name: "a.txt", data: Buffer.from("halo") }]));
    const at = 30 + "a.txt".length;
    zip[at] = zip[at]! ^ 0xff; // balik satu byte data
    expect(() => readZip(zip)).toThrow(/rusak/);
  });
});
```

- [x] **Step 2: Implementasi** — `server/src/services/zip.ts`

```ts
import { deflateRawSync, inflateRawSync } from "node:zlib";

// Workspace QA · ZIP minimal tanpa dependensi baru. Menulis: metode 0 (stored) atau 8 (deflate);
// membaca: kedua metode itu, DIPAGARI (jumlah entri, total ukuran terdekompresi, nama entri) karena
// berkasnya datang dari luar — zip-slip dan zip-bomb adalah ancaman nyata di jalur impor.

export class ZipError extends Error {}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = 0x21; // 1980-01-01 — nilai tetap, keluaran deterministik

export function writeZip(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const packed = e.deflate && e.data.length ? deflateRawSync(e.data) : e.data;
    const method = packed === e.data ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, name, packed);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}

export function readZip(buf: Buffer, o: { maxEntries?: number; maxTotalBytes?: number } = {}): Map<string, Buffer> {
  const maxEntries = o.maxEntries ?? 200;
  const maxTotal = o.maxTotalBytes ?? 150 * 1024 * 1024;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError("bukan berkas ZIP yang valid");
  const total = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (total > maxEntries) throw new ZipError(`terlalu banyak entri (maks ${maxEntries})`);

  const out = new Map<string, Buffer>();
  let p = cdOff;
  let sum = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("direktori pusat ZIP rusak");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const next = p + 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p = next;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new ZipError("ZIP terenkripsi tidak didukung");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new ZipError(`nama entri tak aman: ${name}`);
    sum += usize;
    if (sum > maxTotal) throw new ZipError("ukuran terdekompresi melebihi batas");
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new ZipError(`header lokal rusak: ${name}`);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) throw new ZipError(`entri terpotong: ${name}`);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = usize === 0 ? Buffer.alloc(0) : inflateRawSync(raw, { maxOutputLength: usize });
    else throw new ZipError(`metode kompresi ${method} tidak didukung`);
    if (data.length !== usize || crc32(data) !== crc) throw new ZipError(`entri rusak: ${name}`);
    out.set(name, data);
  }
  return out;
}
```

Jalankan: `pnpm vitest --run server/test/zip.test.ts --no-file-parallelism` → PASS. (Test "CRC rusak" membalik byte data pertama: offset `30 + nama.length` = awal data entri pertama karena `a.txt` disimpan stored.)

- [x] **Step 3: Test transfer yang gagal** — `server/test/qa-transfer.route.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { parseQaMarkdown } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { readZip, writeZip } from "../src/services/zip";
import { makeProject, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function multipart(name: string, type: string, body: Buffer) {
  const boundary = "----hanomanqaimport";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`, "utf8"),
    body, Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
const importFile = (pid: string, name: string, type: string, body: Buffer) =>
  app.inject({ method: "POST", url: `/api/projects/${pid}/qa/import`, ...multipart(name, type, body) });
const R = (pid: string, tail = "") => `/api/projects/${pid}/qa/reports${tail}`;
const json = (method: "POST" | "PATCH", url: string, payload: unknown) => app.inject({ method, url, payload: payload as object });

// Laporan lengkap: 1 case, 1 temuan ber-caseId, lampiran PNG pada temuan.
async function seed() {
  const r = (await json("POST", R("p1"), { title: "Smoke 0.9", buildVersion: "0.9.12", tester: "Dena" })).json();
  const c = (await json("POST", R("p1", `/${r.id}/cases`), { title: "Bayar", status: "fail", steps: "1. klik" })).json().cases[0];
  const f = (await json("POST", R("p1", `/${r.id}/findings`), { title: "Tombol mati", caseId: c.id, steps: ["buka", "klik"], expected: "ok", actual: "diam" })).json().findings[0];
  const b = "----seed";
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="layar.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  await app.inject({ method: "POST", url: R("p1", `/${r.id}/attachments?ownerType=finding&ownerId=${f.id}`), payload, headers: { "content-type": `multipart/form-data; boundary=${b}` } });
  return r.id as string;
}

beforeEach(async () => { await resetDb(); await makeProject({ id: "p1" }); await makeProject({ id: "p2" }); });

describe("GET /qa/template.md", () => {
  it("mengirim template sebagai unduhan dan dapat diurai", async () => {
    const res = await app.inject({ method: "GET", url: "/api/qa/template.md" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toMatch(/text\/markdown/);
    expect(String(res.headers["content-disposition"])).toMatch(/attachment; filename="qa-template\.md"/);
    expect(parseQaMarkdown(res.body).findings).toHaveLength(1);
  });
});

describe("ekspor", () => {
  it("ZIP berisi report.md + attachments/ dengan tautan relatif yang cocok", async () => {
    const rid = await seed();
    const res = await app.inject({ method: "GET", url: R("p1", `/${rid}/export`) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(String(res.headers["content-disposition"])).toMatch(/QA-001\.zip/);
    const files = readZip(res.rawPayload);
    expect([...files.keys()].sort()).toEqual(["attachments/F-01-1-layar.png", "report.md"]);
    const md = files.get("report.md")!.toString("utf8");
    expect(md).toContain("### F-01 · [major/P2] Tombol mati");
    expect(md).toContain("![layar.png](attachments/F-01-1-layar.png)");
  });
  it("?format=md hanya Markdown; 404 laporan project lain", async () => {
    const rid = await seed();
    const md = await app.inject({ method: "GET", url: R("p1", `/${rid}/export?format=md`) });
    expect(String(md.headers["content-type"])).toMatch(/text\/markdown/);
    expect(md.body).toContain("hanoman-qa: 1");
    expect((await app.inject({ method: "GET", url: R("p2", `/${rid}/export`) })).statusCode).toBe(404);
  });
});

describe("impor", () => {
  it("round-trip ZIP ke project lain → laporan BARU lengkap dengan lampiran dan tautan caseId", async () => {
    const rid = await seed();
    const zip = (await app.inject({ method: "GET", url: R("p1", `/${rid}/export`) })).rawPayload;
    const res = await importFile("p2", "QA-001.zip", "application/zip", zip);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created: true, cases: 1, findings: 1 });
    expect(res.json().attachments.saved).toBe(1);
    const d = (await app.inject({ method: "GET", url: R("p2", `/${res.json().reportId}`) })).json();
    expect(d).toMatchObject({ code: "QA-001", title: "Smoke 0.9", buildVersion: "0.9.12", tester: "Dena" });
    expect(d.id).not.toBe(rid);
    expect(d.cases[0]).toMatchObject({ title: "Bayar", status: "fail" });
    expect(d.findings[0]).toMatchObject({ title: "Tombol mati", caseCode: "TC-01", steps: ["buka", "klik"], expected: "ok", actual: "diam" });
    expect(d.attachments).toHaveLength(1);
    expect(d.attachments[0]).toMatchObject({ ownerType: "finding", ownerId: d.findings[0].id, filename: "layar.png" });
  });

  it("impor ulang ke project yang sama = UPSERT: tak menggandakan case/temuan/lampiran", async () => {
    const rid = await seed();
    const zip = (await app.inject({ method: "GET", url: R("p1", `/${rid}/export`) })).rawPayload;
    const res = await importFile("p1", "QA-001.zip", "application/zip", zip);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: false, reportId: rid });
    const d = (await app.inject({ method: "GET", url: R("p1", `/${rid}`) })).json();
    expect([d.cases.length, d.findings.length, d.attachments.length]).toEqual([1, 1, 1]);
  });

  it("template tanpa ZIP → laporan baru (1 case, 1 temuan) dengan lampiran 0", async () => {
    const tpl = (await app.inject({ method: "GET", url: "/api/qa/template.md" })).rawPayload;
    const res = await importFile("p1", "qa-template.md", "text/markdown", tpl);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created: true, cases: 1, findings: 1 });
  });

  it("400 berbaris untuk Markdown salah; 400 ZIP tanpa report.md; 400 ZIP berisi path traversal", async () => {
    const bad = await importFile("p1", "x.md", "text/markdown", Buffer.from("# tanpa front-matter\n"));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/baris 1/);
    expect((await importFile("p1", "x.zip", "application/zip", writeZip([{ name: "a.txt", data: Buffer.from("x") }]))).statusCode).toBe(400);
    expect((await importFile("p1", "x.zip", "application/zip", writeZip([{ name: "../report.md", data: Buffer.from("x") }]))).statusCode).toBe(400);
  });

  it("400 submitted tanpa verdict; 409 bila laporan target closed; 404 project tak ada", async () => {
    const tpl = (await app.inject({ method: "GET", url: "/api/qa/template.md" })).body;
    const noVerdict = tpl.replace("status: draft", "status: submitted");
    expect((await importFile("p1", "x.md", "text/markdown", Buffer.from(noVerdict))).statusCode).toBe(400);

    const rid = await seed();
    const md = (await app.inject({ method: "GET", url: R("p1", `/${rid}/export?format=md`) })).body;
    await json("PATCH", R("p1", `/${rid}`), { status: "closed", verdict: "go" });
    expect((await importFile("p1", "x.md", "text/markdown", Buffer.from(md))).statusCode).toBe(409);
    expect((await importFile("hantu", "x.md", "text/markdown", Buffer.from(tpl))).statusCode).toBe(404);
  });

  it("LOCAL-only: impor tak menulis changefeed sync", async () => {
    const tpl = (await app.inject({ method: "GET", url: "/api/qa/template.md" })).rawPayload;
    await importFile("p1", "t.md", "text/markdown", tpl);
    expect(await prisma.syncLog.count({ where: { entity: { startsWith: "qa" } } })).toBe(0);
  });
});
```

Run (gagal): `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"; env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/qa-transfer.route.test.ts --no-file-parallelism` → FAIL (404).

- [x] **Step 4: Service** — `server/src/services/qa-transfer.ts`

```ts
import { basename } from "node:path";
import {
  QaMarkdownError, parseQaMarkdown, renderQaMarkdown, type QaParsedReport,
} from "@hanoman/shared";
import { prisma } from "../db";
import { asJson, reportDetail } from "./qa";
import { QA_ATTACHMENT_LIMITS, addQaAttachments, type QaUpload } from "./qa-attachment";
import { readUpload } from "./uploads";
import { ZipError, readZip, writeZip } from "./zip";

// Workspace QA · ekspor ZIP (report.md + attachments/) dan impor (upsert). Bentuk Markdown-nya milik
// `shared/qa-markdown.ts`; di sini hanya I/O: baca byte lampiran, tulis/baca ZIP, tulis DB.

export class QaImportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf",
  md: "text/markdown", txt: "text/plain", log: "text/plain", json: "application/json", csv: "text/csv",
};
/** Nama hasil ekspor `F-01-1-layar.png` → `layar.png`, supaya ekspor→impor berulang tak menumpuk awalan. */
const originalName = (path: string) => basename(path).replace(/^(?:QA-\d+|F-\d+|TC-\d+)-\d+-/, "");

export async function exportReport(projectId: string, reportId: string) {
  const full = await reportDetail(projectId, reportId);
  if (!full) return null;
  const codeOf = (type: string, id: string) =>
    type === "report" ? full.code
      : type === "case" ? full.cases.find((c) => c.id === id)?.code ?? "TC-00"
      : full.findings.find((f) => f.id === id)?.code ?? "F-00";

  const paths: Record<string, string> = {};
  const files: { name: string; data: Buffer }[] = [];
  const seq = new Map<string, number>();
  const present = [];
  for (const a of full.attachments) {
    const row = await prisma.qaAttachment.findUnique({ where: { id: a.id }, select: { storageKey: true } });
    const data = row ? await readUpload(row.storageKey).catch(() => null) : null;
    if (!data) continue;                       // byte hilang dari disk — jangan tautkan yang tak ada
    const owner = codeOf(a.ownerType, a.ownerId);
    const n = (seq.get(owner) ?? 0) + 1;
    seq.set(owner, n);
    paths[a.id] = `attachments/${owner}-${n}-${safe(a.filename)}`;
    files.push({ name: paths[a.id]!, data });
    present.push(a);
  }
  const markdown = renderQaMarkdown({ ...full, attachments: present }, paths);
  const zip = writeZip([{ name: "report.md", data: Buffer.from(markdown, "utf8"), deflate: true }, ...files]);
  return { code: full.code, markdown, zip };
}

export type QaImportResult = {
  reportId: string; created: boolean; cases: number; findings: number;
  attachments: { saved: number; rejected: { filename: string; reason: string }[] };
};

export async function importReport(projectId: string, file: { name: string; buf: Buffer }): Promise<QaImportResult> {
  if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })))
    throw new QaImportError(404, "project tak ditemukan");

  let markdown: string;
  let assets = new Map<string, Buffer>();
  let dir = "";
  const isZip = file.buf.length >= 4 && file.buf.readUInt32LE(0) === 0x04034b50;
  if (isZip) {
    try {
      const entries = readZip(file.buf);
      const mdName = [...entries.keys()].find((k) => /(^|\/)report\.md$/i.test(k))
        ?? [...entries.keys()].find((k) => /\.md$/i.test(k) && !/(^|\/)attachments\//.test(k));
      if (!mdName) throw new QaImportError(400, "ZIP tak memuat report.md");
      markdown = entries.get(mdName)!.toString("utf8");
      dir = mdName.includes("/") ? mdName.slice(0, mdName.lastIndexOf("/") + 1) : "";
      assets = entries;
    } catch (e) {
      if (e instanceof ZipError) throw new QaImportError(400, `ZIP tak valid: ${e.message}`);
      throw e;
    }
  } else {
    markdown = file.buf.toString("utf8");
  }

  let parsed: QaParsedReport;
  try { parsed = parseQaMarkdown(markdown); }
  catch (e) { if (e instanceof QaMarkdownError) throw new QaImportError(400, e.message); throw e; }
  if ((parsed.status === "submitted" || parsed.status === "closed") && !parsed.verdict)
    throw new QaImportError(400, "verdict wajib diisi untuk laporan berstatus submitted/closed");

  const existing = parsed.reportId
    ? await prisma.qaReport.findFirst({ where: { id: parsed.reportId, projectId } }) : null;
  if (existing?.status === "closed") throw new QaImportError(409, "laporan target sudah closed — buka kembali sebelum mengimpor");

  const now = Date.now();
  const owners: { ownerType: "report" | "case" | "finding"; ownerId: string; paths: string[] }[] = [];
  const out = await prisma.$transaction(async (tx) => {
    const data = {
      title: parsed.title, buildVersion: parsed.buildVersion, environment: asJson(parsed.environment),
      scope: parsed.scope, tester: parsed.tester, summary: parsed.summary, status: parsed.status, verdict: parsed.verdict,
    };
    const report = existing
      ? await tx.qaReport.update({ where: { id: existing.id }, data })
      : await tx.qaReport.create({ data: { projectId, ...data, createdAt: new Date(now) } });
    owners.push({ ownerType: "report", ownerId: report.id, paths: parsed.attachments });

    const knownCases = new Set((await tx.qaCase.findMany({ where: { reportId: report.id }, select: { id: true } })).map((c) => c.id));
    const caseByFileId = new Map<string, string>();
    const caseByCode = new Map<string, string>();
    for (const [idx, c] of parsed.cases.entries()) {
      const fields = { title: c.title, steps: c.steps, expected: c.expected, actual: c.actual, status: c.status, order: idx + 1 };
      const row = c.id && knownCases.has(c.id)
        ? await tx.qaCase.update({ where: { id: c.id }, data: fields })
        // createdAt bergeser 1 ms per baris: nomor TC-nn deterministik = urutan di berkas
        : await tx.qaCase.create({ data: { reportId: report.id, ...fields, createdAt: new Date(now + 1 + idx) } });
      if (c.id) caseByFileId.set(c.id, row.id);
      caseByCode.set(c.code, row.id);
      owners.push({ ownerType: "case", ownerId: row.id, paths: c.attachments });
    }

    const knownFindings = new Set((await tx.qaFinding.findMany({ where: { reportId: report.id }, select: { id: true } })).map((f) => f.id));
    for (const [idx, f] of parsed.findings.entries()) {
      const caseId = (f.caseId && caseByFileId.get(f.caseId)) || (f.caseCode && caseByCode.get(f.caseCode)) || null;
      const fields = {
        caseId, title: f.title, severity: f.severity, priority: f.priority, area: f.area,
        steps: asJson(f.steps), expected: f.expected, actual: f.actual,
        status: f.status === "sent" ? "open" : f.status,   // `sent` tanpa backlogId di mesin ini tak bermakna
      };
      const row = f.id && knownFindings.has(f.id)
        ? await tx.qaFinding.update({ where: { id: f.id }, data: fields })
        : await tx.qaFinding.create({ data: { reportId: report.id, ...fields, createdAt: new Date(now + 1 + idx) } });
      owners.push({ ownerType: "finding", ownerId: row.id, paths: f.attachments });
    }
    return report;
  });

  // Lampiran SESUDAH transaksi: byte lewat pipeline unggahan (async + pemindaian), tak boleh menahan DB.
  let saved = 0;
  const rejected: { filename: string; reason: string }[] = [];
  const have = await prisma.qaAttachment.findMany({ where: { reportId: out.id }, select: { ownerType: true, ownerId: true, filename: true } });
  for (const o of owners) {
    const uploads: QaUpload[] = [];
    for (const path of o.paths) {
      const buf = assets.get(dir + path);
      const name = originalName(path);
      if (!buf) { rejected.push({ filename: name, reason: "missing" }); continue; }
      if (have.some((h) => h.ownerType === o.ownerType && h.ownerId === o.ownerId && h.filename === name)) continue;  // sudah ada
      const mime = MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""];
      if (!mime) { rejected.push({ filename: name, reason: "type" }); continue; }
      uploads.push({ buf, mime, name, truncated: buf.length > QA_ATTACHMENT_LIMITS.fileBytes });
    }
    if (!uploads.length) continue;
    const r = await addQaAttachments({ id: out.id, projectId }, { ownerType: o.ownerType, ownerId: o.ownerId }, uploads);
    saved += r.saved.length;
    rejected.push(...r.rejected);
  }
  return {
    reportId: out.id, created: !existing, cases: parsed.cases.length, findings: parsed.findings.length,
    attachments: { saved, rejected },
  };
}
```

- [x] **Step 5: Route** — `server/src/routes/qa-transfer.ts`

```ts
import type { FastifyInstance } from "fastify";
import { qaTemplateMarkdown } from "@hanoman/shared";
import { QA_ATTACHMENT_LIMITS } from "../services/qa-attachment";
import { QaImportError, exportReport, importReport } from "../services/qa-transfer";

// Workspace QA · template, ekspor, impor. Capability `qa:*` menurut METHOD (`capabilityForRoute`).
// Batas multipart PER-REQUEST (registrasi global 5 MB milik lampiran gambar tak boleh naik): impor ZIP
// boleh sebesar kuota satu laporan (100 MB) + Markdown-nya.
const IMPORT_MAX = QA_ATTACHMENT_LIMITS.reportBytes + 5 * 1024 * 1024;

export default async function qaTransfer(app: FastifyInstance) {
  app.get("/qa/template.md", async (_req, reply) => {
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="qa-template.md"');
    return reply.send(qaTemplateMarkdown());
  });

  app.get("/projects/:pid/qa/reports/:rid/export", async (req, reply) => {
    const { pid, rid } = req.params as { pid: string; rid: string };
    const out = await exportReport(pid, rid);
    if (!out) return reply.code(404).send({ error: "not found" });
    if ((req.query as { format?: string }).format === "md") {
      reply.header("content-type", "text/markdown; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="${out.code}.md"`);
      return reply.send(out.markdown);
    }
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="${out.code}.zip"`);
    return reply.send(out.zip);
  });

  app.post("/projects/:pid/qa/import", async (req, reply) => {
    const { pid } = req.params as { pid: string };
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });
    let file: { name: string; buf: Buffer } | null = null;
    try {
      for await (const part of (req as any).parts({ limits: { fileSize: IMPORT_MAX, files: 1 } })) {
        if (part.type !== "file" || file) continue;
        const buf = await part.toBuffer();
        if (part.file?.truncated) return reply.code(413).send({ error: "berkas terlalu besar" });
        file = { name: String(part.filename ?? "import"), buf };
      }
    } catch { return reply.code(400).send({ error: "unggahan tak valid" }); }
    if (!file || file.buf.length === 0) return reply.code(400).send({ error: "tak ada berkas" });
    try {
      const r = await importReport(pid, file);
      return reply.code(r.created ? 201 : 200).send(r);
    } catch (e) {
      if (e instanceof QaImportError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
}
```

`server/src/app.ts`: `import qaTransfer from "./routes/qa-transfer";` + `await api.register(qaTransfer);` setelah `qaAttachments`.

- [x] **Step 6: Jalankan test + typecheck**

Run: `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"; env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/zip.test.ts server/test/qa-transfer.route.test.ts server/test/qa-attachments.route.test.ts server/test/qa-reports.route.test.ts --no-file-parallelism && pnpm --filter ./server typecheck`
Expected: PASS. Bila `res.rawPayload` tak ada pada versi `light-my-request` ini, pakai `Buffer.from(res.body, "binary")`.

- [x] **Step 7: Commit**

```bash
git add server/src/services/zip.ts server/src/services/qa-transfer.ts server/src/routes/qa-transfer.ts server/src/app.ts server/test/zip.test.ts server/test/qa-transfer.route.test.ts
git commit -m "feat(qa): template, ekspor ZIP, dan impor upsert (berpagar zip-slip/zip-bomb)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


---

### Task 8: Tool MCP `hanoman_qa_*`

**Files:**
- Create: `shared/src/mcp-catalog/qa.ts`, `shared/src/mcp-catalog.qa.test.ts`
- Modify: `shared/src/mcp-catalog/index.ts`, `server/test/mcp-coverage.test.ts` (`UNWRAPPED`), tempat lain yang mendaftar nama tool (lihat Step 5)

**Interfaces:**
- Consumes (Task 1/2): `QA_*` enum; capability `qa:read|qa:write`; route Task 4/5/7.
- Produces: `QA_TOOLS` — `hanoman_qa_reports_list`, `hanoman_qa_report_get`, `hanoman_qa_report_create`, `hanoman_qa_report_update`, `hanoman_qa_case_create`, `hanoman_qa_case_update`, `hanoman_qa_finding_create`, `hanoman_qa_finding_update`.

> **Catatan urutan:** sejak Task 4 `server/test/mcp-coverage.test.ts` MERAH (route baru belum bertool) — itu gerbang yang bekerja, bukan regresi. Task ini yang menghijaukannya. Jangan menambah route `qa` lain sebelum Task ini selesai.

- [ ] **Step 1: Tulis test yang gagal** — `shared/src/mcp-catalog.qa.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "./mcp";

const tool = (name: string) => {
  const t = MCP_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} tak ada`);
  return t;
};

describe("katalog MCP · qa", () => {
  it("delapan tool terdaftar dengan capability qa:read / qa:write sesuai mode", () => {
    const names = MCP_TOOLS.filter((t) => t.name.startsWith("hanoman_qa_")).map((t) => [t.name, t.capability, t.mode]);
    expect(names).toEqual([
      ["hanoman_qa_reports_list", "qa:read", "read"],
      ["hanoman_qa_report_get", "qa:read", "read"],
      ["hanoman_qa_report_create", "qa:write", "write"],
      ["hanoman_qa_report_update", "qa:write", "write"],
      ["hanoman_qa_case_create", "qa:write", "write"],
      ["hanoman_qa_case_update", "qa:write", "write"],
      ["hanoman_qa_finding_create", "qa:write", "write"],
      ["hanoman_qa_finding_update", "qa:write", "write"],
    ]);
  });

  it("list/get merakit path project + laporan dengan encoding", () => {
    expect(tool("hanoman_qa_reports_list").build({ project: "p 1" })).toEqual({ method: "GET", path: "/projects/p%201/qa/reports" });
    expect(tool("hanoman_qa_report_get").build({ project: "p1", report: "r1" })).toEqual({ method: "GET", path: "/projects/p1/qa/reports/r1" });
  });

  it("create laporan: environment `k=v` per baris/`;` jadi objek; hanya field terisi ikut", () => {
    const r = tool("hanoman_qa_report_create").build({ project: "p1", title: "Smoke", environment: "os=macOS; browser=Chrome\nurl=https://x.id?a=b", tester: "" });
    expect(r).toEqual({
      method: "POST", path: "/projects/p1/qa/reports",
      body: { title: "Smoke", environment: { os: "macOS", browser: "Chrome", url: "https://x.id?a=b" } },
    });
  });

  it("update laporan: status/verdict dikirim apa adanya", () => {
    expect(tool("hanoman_qa_report_update").build({ project: "p1", report: "r1", status: "submitted", verdict: "go" }))
      .toEqual({ method: "PATCH", path: "/projects/p1/qa/reports/r1", body: { status: "submitted", verdict: "go" } });
  });

  it("finding create: steps satu-per-baris dipecah, nomor di awal dibuang", () => {
    const r = tool("hanoman_qa_finding_create").build({
      project: "p1", report: "r1", title: "Tombol mati", severity: "major", priority: "P1",
      steps: "1. buka keranjang\n2) klik bayar\n\n- amati", testCase: "c1",
    });
    expect(r).toEqual({
      method: "POST", path: "/projects/p1/qa/reports/r1/findings",
      body: { title: "Tombol mati", severity: "major", priority: "P1", steps: ["buka keranjang", "klik bayar", "amati"], caseId: "c1" },
    });
  });

  it("finding update: `testCase` KOSONG = lepas tautan (null); tak disebut = biarkan", () => {
    const clear = tool("hanoman_qa_finding_update").build({ project: "p1", report: "r1", finding: "f1", testCase: "" });
    expect(clear).toEqual({ method: "PATCH", path: "/projects/p1/qa/reports/r1/findings/f1", body: { caseId: null } });
    const keep = tool("hanoman_qa_finding_update").build({ project: "p1", report: "r1", finding: "f1", status: "wontfix" });
    expect(keep).toEqual({ method: "PATCH", path: "/projects/p1/qa/reports/r1/findings/f1", body: { status: "wontfix" } });
  });

  it("case create/update merakit body", () => {
    expect(tool("hanoman_qa_case_create").build({ project: "p1", report: "r1", title: "Login", steps: "1. buka", status: "todo" }))
      .toEqual({ method: "POST", path: "/projects/p1/qa/reports/r1/cases", body: { title: "Login", steps: "1. buka", status: "todo" } });
    expect(tool("hanoman_qa_case_update").build({ project: "p1", report: "r1", case: "c1", status: "fail", actual: "diam" }))
      .toEqual({ method: "PATCH", path: "/projects/p1/qa/reports/r1/cases/c1", body: { status: "fail", actual: "diam" } });
  });

  it("deskripsi memperingatkan agen: laporan closed read-only dan severity ≠ prioritas", () => {
    expect(tool("hanoman_qa_report_update").description).toMatch(/closed/);
    expect(tool("hanoman_qa_finding_create").description).toMatch(/severity/i);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/src/mcp-catalog.qa.test.ts --no-file-parallelism`
Expected: FAIL — tool belum ada.

- [ ] **Step 3: Implementasi** — `shared/src/mcp-catalog/qa.ts`

```ts
// Workspace QA · katalog tool domain `qa` (`/api/projects/:id/qa/**`). Delapan tool: baca laporan, tulis
// laporan/test case/temuan. SENGAJA tanpa tool hapus/lampiran/ekspor/impor (lihat UNWRAPPED di
// server/test/mcp-coverage.test.ts): hapus tak punya jalan pulang, lampiran & ZIP adalah biner.
//
// Dua sifat yang WAJIB terbaca agen di deskripsi karena sudah terukur di servernya:
//   1. Laporan `closed` read-only (409) — buka kembali dulu dengan `status: draft`.
//   2. `severity` (dampak teknis) BUKAN `priority` (urutan perbaikan); keduanya diisi terpisah.
import { QA_CASE_STATUSES, QA_PRIORITIES, QA_REPORT_STATUSES, QA_SEVERITIES, QA_VERDICTS } from "../qa";
import { enumStr, obj, str } from "../mcp-schema";
import { enc, s } from "./helpers";
import type { Args, McpToolDef } from "./types";

const PROJECT = str("Id project, seperti muncul di hanoman_projects_list.");
const REPORT = str("Id laporan QA (cuid), seperti muncul di hanoman_qa_reports_list — BUKAN nomor tampil `QA-007`, yang dihitung saat render.");
const CASE = str("Id test case (cuid), dari hanoman_qa_report_get.");
const FINDING = str("Id temuan (cuid), dari hanoman_qa_report_get.");

const base = (a: Args) => `/projects/${enc(String(a.project))}/qa/reports`;
const one = (a: Args) => `${base(a)}/${enc(String(a.report))}`;

/** `k=v` dipisah baris atau `;` → objek. Baris tanpa `=` jadi kunci bernilai kosong. */
const parseEnv = (v: unknown): Record<string, string> | undefined => {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const out: Record<string, string> = {};
  for (const part of v.split(/[\n;]/)) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    const k = (i < 0 ? t : t.slice(0, i)).trim();
    if (k) out[k] = i < 0 ? "" : t.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
};
/** Satu langkah per baris; awalan `1.`, `2)`, `-`, `*` dibuang supaya server yang menomori. */
const parseSteps = (v: unknown): string[] | undefined =>
  typeof v === "string" && v.trim()
    ? v.split("\n").map((l) => l.trim().replace(/^(?:\d+[.)]|[-*])\s+/, "")).filter(Boolean)
    : undefined;
/** Tiga keadaan seperti tool papan Tim: tak disebut = biarkan, "" = kosongkan (null), string = isi. */
const nullable = (v: unknown): string | null | undefined => (typeof v !== "string" ? undefined : v === "" ? null : v);

const put = (body: Record<string, unknown>, key: string, v: unknown) => { if (v !== undefined) body[key] = v; };

const REPORT_FIELDS = {
  title: str("Judul laporan, satu baris."),
  buildVersion: str("Versi/build yang diuji, mis. `0.9.12`."),
  environment: str("Lingkungan uji: `kunci=nilai` dipisah baris atau `;`, mis. `os=macOS 15; browser=Chrome 130; url=https://staging.x.id`. Maks 20 entri."),
  scope: str("Cakupan: apa yang diuji dan apa yang sengaja tidak."),
  tester: str("Nama penguji."),
  summary: str("Ringkasan hasil, 2–3 kalimat, memuat alasan keputusan."),
  verdict: enumStr(QA_VERDICTS, "Keputusan rilis. Wajib terisi sebelum `status` boleh `submitted`/`closed`."),
};
const reportBody = (a: Args): Record<string, unknown> => {
  const b: Record<string, unknown> = {};
  for (const k of ["title", "buildVersion", "scope", "tester", "summary", "verdict", "status"] as const) put(b, k, s(a[k]));
  put(b, "environment", parseEnv(a.environment));
  return b;
};
const caseBody = (a: Args): Record<string, unknown> => {
  const b: Record<string, unknown> = {};
  for (const k of ["title", "steps", "expected", "actual", "status"] as const) put(b, k, s(a[k]));
  return b;
};
const findingBody = (a: Args): Record<string, unknown> => {
  const b: Record<string, unknown> = {};
  for (const k of ["title", "severity", "priority", "area", "expected", "actual", "status"] as const) put(b, k, s(a[k]));
  put(b, "steps", parseSteps(a.steps));
  put(b, "caseId", nullable(a.testCase));
  return b;
};

const CASE_FIELDS = {
  title: str("Judul test case."),
  steps: str("Langkah uji (teks bebas)."),
  expected: str("Hasil yang diharapkan."),
  actual: str("Hasil aktual."),
  status: enumStr(QA_CASE_STATUSES, "Status eksekusi."),
};
const FINDING_FIELDS = {
  title: str("Judul temuan — satu masalah, satu baris."),
  severity: enumStr(QA_SEVERITIES, "Dampak TEKNIS. Bukan prioritas."),
  priority: enumStr(QA_PRIORITIES, "Urutan perbaikan P0 (paling mendesak)–P3. Terpisah dari severity: bug minor di halaman checkout bisa P0."),
  area: str("Area/fitur, mis. `checkout`."),
  steps: str("Langkah reproduksi, SATU PER BARIS (penomoran `1.` di awal dibuang; server menomori)."),
  expected: str("Yang seharusnya terjadi."),
  actual: str("Yang benar-benar terjadi."),
  status: enumStr(["open", "wontfix"], "`open` atau `wontfix`. `sent` (sudah jadi backlog) hanya ditulis server."),
  testCase: str("Id test case terkait, dari hanoman_qa_report_get. String KOSONG melepas tautan; tak menyebutnya membiarkan apa adanya."),
};

export const QA_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_qa_reports_list",
    title: "Daftar laporan QA",
    description:
      "Laporan QA sebuah project, terbaru-diubah dulu, dengan nomor tampil (`QA-001`), status (`draft|submitted|closed`), keputusan (`go|no-go|conditional`), dan statistik (pass-rate dari yang dieksekusi, temuan per severity, jumlah open). Nomor tampil dihitung dari urutan pembuatan — pakai `id`, bukan nomor, saat memanggil tool lain.",
    inputSchema: obj({ properties: { project: PROJECT }, required: ["project"] }),
    mode: "read", capability: "qa:read", samplePath: "/projects/p1/qa/reports", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: base(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_report_get",
    title: "Detail laporan QA",
    description:
      "Satu laporan QA lengkap: header, test case (`TC-01…`), temuan (`F-01…`, dengan repro bernomor, severity, prioritas, `caseCode`), dan metadata lampiran (nama, tipe, ukuran — bukan byte).",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT }, required: ["project", "report"] }),
    mode: "read", capability: "qa:read", samplePath: "/projects/p1/qa/reports/r1", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: one(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_report_create",
    title: "Buat laporan QA",
    description: "Membuat laporan QA berstatus `draft`. Hanya `project` dan `title` yang wajib. Test case dan temuan ditambahkan lewat tool terpisah.",
    inputSchema: obj({ properties: { project: PROJECT, ...REPORT_FIELDS }, required: ["project", "title"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: base(a), body: reportBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_report_update",
    title: "Ubah laporan QA",
    description:
      "Mengubah header laporan; hanya field yang disebut yang ditulis. `status`: `draft → submitted → closed`; `submitted`/`closed` DITOLAK 400 bila `verdict` belum terisi. Laporan `closed` read-only (409) untuk semua tool QA — satu-satunya ubahan yang lolos adalah `status: draft` untuk membukanya kembali.",
    inputSchema: obj({
      properties: { project: PROJECT, report: REPORT, ...REPORT_FIELDS, status: enumStr(QA_REPORT_STATUSES, "Status laporan.") },
      required: ["project", "report"],
    }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: one(a), body: reportBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_case_create",
    title: "Tambah test case",
    description: "Menambah test case ke akhir daftar laporan. Hanya `title` yang wajib; status awal `todo`. Jawabannya adalah laporan terbaru (test case baru = entri terakhir `cases`).",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, ...CASE_FIELDS }, required: ["project", "report", "title"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/cases", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${one(a)}/cases`, body: caseBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_case_update",
    title: "Ubah test case",
    description: "Mengubah test case; hanya field yang disebut yang ditulis. Biasa dipakai untuk mencatat hasil: `status` (`pass|fail|blocked|skipped`) dan `actual`.",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, case: CASE, ...CASE_FIELDS }, required: ["project", "report", "case"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/cases/c1", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: `${one(a)}/cases/${enc(String(a.case))}`, body: caseBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_finding_create",
    title: "Catat temuan QA",
    description:
      "Mencatat satu temuan (bug) di laporan. Isi `severity` (dampak teknis) DAN `priority` (urutan perbaikan) secara terpisah — keduanya tak selalu sama. Tulis `steps` sebagai langkah reproduksi yang bisa diulang orang lain, satu per baris. Temuan baru berstatus `open`; jawabannya laporan terbaru (temuan baru = entri terakhir `findings`).",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, ...FINDING_FIELDS }, required: ["project", "report", "title"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/findings", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${one(a)}/findings`, body: findingBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_finding_update",
    title: "Ubah temuan QA",
    description: "Mengubah temuan; hanya field yang disebut yang ditulis. `status`: `open` atau `wontfix`.",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, finding: FINDING, ...FINDING_FIELDS }, required: ["project", "report", "finding"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/findings/f1", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: `${one(a)}/findings/${enc(String(a.finding))}`, body: findingBody(a) }),
    shape: (raw) => raw,
  },
];
```

`shared/src/mcp-catalog/index.ts`: `import { QA_TOOLS } from "./qa";` dan sisipkan `...QA_TOOLS,` tepat sesudah `...TEAM_TOOLS,` (sebelum `...SYSTEM_TOOLS`).

- [ ] **Step 4: Daftarkan pengecualian cakupan** — `server/test/mcp-coverage.test.ts`, tambahkan ke `UNWRAPPED` (sebelum `]);`):

```ts
  // Workspace QA · sengaja tanpa tool: hapus tak punya jalan pulang (dilakukan manusia di dashboard),
  // sisanya biner/multipart. Agen membaca laporan lewat hanoman_qa_report_get.
  ["DELETE /projects/:pid/qa/reports/:rid", "destruktif — dihapus manusia di dashboard"],
  ["DELETE /projects/:pid/qa/reports/:rid/cases/:cid", "destruktif — dihapus manusia di dashboard"],
  ["DELETE /projects/:pid/qa/reports/:rid/findings/:fid", "destruktif — dihapus manusia di dashboard"],
  ["POST /projects/:pid/qa/reports/:rid/attachments", "multipart"],
  ["GET /projects/:pid/qa/reports/:rid/attachments/:aid", "biner (unduhan lampiran)"],
  ["DELETE /projects/:pid/qa/reports/:rid/attachments/:aid", "destruktif — dihapus manusia di dashboard"],
  ["GET /projects/:pid/qa/reports/:rid/export", "biner (ZIP) / Markdown unduhan; agen memakai hanoman_qa_report_get"],
  ["POST /projects/:pid/qa/import", "multipart"],
  ["GET /qa/template.md", "unduhan template untuk manusia"],
```

- [ ] **Step 5: Jalankan test, lalu cari daftar nama tool yang perlu diperbarui**

Run: `export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"; env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run shared/src/mcp-catalog.qa.test.ts shared/src/mcp-catalog.test.ts shared/src/mcp-catalog.docs.test.ts shared/src/mcp-catalog.team.test.ts server/test/mcp-coverage.test.ts server/test/mcp-capability.test.ts server/test/agent-tool-catalog.test.ts --no-file-parallelism && pnpm --filter ./shared typecheck`
Expected: PASS. Bila `mcp-catalog.test.ts` menghitung jumlah tool / `mcp-catalog.docs.test.ts` menuntut dokumentasi, perbarui angka/dokumennya (itu bagian perubahan ini, bukan regresi).
Lalu: `grep -rln "hanoman_task_unlink" --include=*.md --include=*.ts --include=*.tsx . | grep -v node_modules` — setiap berkas non-test yang mendaftar tool domain `team` (daftar tool di docs/skill `internal/skills/hanoman/SKILL.md`, `internal/docs/**`, panel Settings MCP) harus mendapat padanan `hanoman_qa_*`. Catat berkas yang diubah di pesan commit.

- [ ] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog shared/src/mcp-catalog.qa.test.ts server/test/mcp-coverage.test.ts internal
git commit -m "feat(qa): tool MCP hanoman_qa_* (baca/tulis laporan, test case, temuan)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Klien API, rute `/qa`, navigasi, dan cabang layar

**Files:**
- Modify: `shared/src/api.ts`, `shared/src/qa.ts` (+`QaImportResult`), `server/src/services/qa-transfer.ts` (pakai tipe bersama), `src/src/api/client.ts`, `src/src/routes.ts`, `src/src/routes.test.ts`, `src/src/ds/shell.tsx`, `src/src/App.tsx`
- Create: `src/test/qa-nav.test.tsx`

**Interfaces:**
- Produces: `paths.qa*`; `api.qaReports/qaReport/createQaReport/patchQaReport/deleteQaReport/createQaCase/patchQaCase/deleteQaCase/createQaFinding/patchQaFinding/deleteQaFinding/uploadQaAttachments/deleteQaAttachment/importQaReport/qaExportUrl/qaAttachmentUrl/qaTemplateUrl`; rute `/qa` & `/qa/<projectId>` (`{section:"qa", projectId?}`); nav key `qa`.

- [ ] **Step 1: Test rute + nav yang gagal**

Tambahkan di `src/src/routes.test.ts` (perluas `KEYS` jadi `["overview", "projects", "backlog", "skills", "qa", "settings"]`):

```ts
describe("routes · qa", () => {
  it("/qa = tanpa project, /qa/<projectId> = satu project; round-trip dengan encoding", () => {
    expect(parseRoute("/qa", KEYS)).toEqual({ section: "qa" });
    expect(parseRoute("/qa/p1", KEYS)).toEqual({ section: "qa", projectId: "p1" });
    expect(routePath({ section: "qa" })).toBe("/qa");
    expect(routePath({ section: "qa", projectId: "p 1" })).toBe("/qa/p%201");
    expect(parseRoute(routePath({ section: "qa", projectId: "p 1" }), KEYS)).toEqual({ section: "qa", projectId: "p 1" });
    expect(parseRoute("/qa/a/b", KEYS)).toBeNull();
  });
});
```

`src/test/qa-nav.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { HN_NAV } from "../src/ds/shell";

describe("entri nav QA", () => {
  // `toEqual` eksak: sekaligus mengunci bahwa entri ini tak ber-`gate`. Ikon salah nama jatuh ke
  // `Circle` tanpa error (SPEC-906) — `clipboard-check` didaftarkan di icon-registry (Task 11).
  it("terdaftar sebagai 'QA' ber-ikon clipboard-check, tanpa gate, tepat sesudah Tim", () => {
    expect(HN_NAV.find((n) => n.key === "qa")).toEqual({ key: "qa", label: "QA", icon: "clipboard-check" });
    const keys = HN_NAV.map((n) => n.key);
    expect(keys[keys.indexOf("team") + 1]).toBe("qa");
  });
});
```

Run: `pnpm vitest --run src/src/routes.test.ts src/test/qa-nav.test.tsx --no-file-parallelism` → FAIL.

- [ ] **Step 2: `shared/src/api.ts`** — tambahkan di blok `paths`, tepat sesudah `skillFork`:

```ts
  // Workspace QA · laporan QA per project. Semua di bawah /projects/:id/qa (capability `qa`).
  qaReports: (pid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/reports`,
  qaReport: (pid: string, rid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/reports/${encodeURIComponent(rid)}`,
  qaCases: (pid: string, rid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/reports/${encodeURIComponent(rid)}/cases`,
  qaCase: (pid: string, rid: string, cid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/reports/${encodeURIComponent(rid)}/cases/${encodeURIComponent(cid)}`,
  qaFindings: (pid: string, rid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/reports/${encodeURIComponent(rid)}/findings`,
  qaFinding: (pid: string, rid: string, fid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/reports/${encodeURIComponent(rid)}/findings/${encodeURIComponent(fid)}`,
  qaAttachments: (pid: string, rid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/reports/${encodeURIComponent(rid)}/attachments`,
  qaAttachment: (pid: string, rid: string, aid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/reports/${encodeURIComponent(rid)}/attachments/${encodeURIComponent(aid)}`,
  qaImport: (pid: string) => `${API}/projects/${encodeURIComponent(pid)}/qa/import`,
  qaTemplate: `${API}/qa/template.md`,
```

`shared/src/qa.ts` — tambahkan di akhir:

```ts
export type QaImportResult = {
  reportId: string; created: boolean; cases: number; findings: number;
  attachments: { saved: number; rejected: { filename: string; reason: string }[] };
};
```
dan di `server/src/services/qa-transfer.ts` hapus deklarasi lokal `export type QaImportResult = {…}`, ganti dengan `import type { QaImportResult } from "@hanoman/shared";` (dan `export type { QaImportResult };` bila ada pemakai lain).

- [ ] **Step 3: `src/src/api/client.ts`** — tambah impor (baris baru di bawah impor `@hanoman/shared` yang ada):

```ts
import type {
  CreateQaCase, CreateQaFinding, CreateQaReport, PatchQaCase, PatchQaFinding, PatchQaReport,
  QaAttachmentView, QaImportResult, QaOwnerType, QaReportDetail, QaReportView,
} from "@hanoman/shared";
```
dan di dalam literal yang dikembalikan `createApi`, sesudah `skillFork`/`createSkill` (dekat method skills):

```ts
  // Workspace QA · setiap mutasi anak menjawab QaReportDetail terbaru (nomor tampil + statistik dihitung server).
  qaReports: (pid: string) => j<{ items: QaReportView[]; total: number }>(paths.qaReports(pid)),
  qaReport: (pid: string, rid: string) => j<QaReportDetail>(paths.qaReport(pid, rid)),
  createQaReport: (pid: string, b: CreateQaReport) => j<QaReportDetail>(paths.qaReports(pid), { method: "POST", ...body(b) }),
  patchQaReport: (pid: string, rid: string, b: PatchQaReport) => j<QaReportDetail>(paths.qaReport(pid, rid), { method: "PATCH", ...body(b) }),
  deleteQaReport: (pid: string, rid: string) => j<{ ok: true }>(paths.qaReport(pid, rid), { method: "DELETE" }),
  createQaCase: (pid: string, rid: string, b: CreateQaCase) => j<QaReportDetail>(paths.qaCases(pid, rid), { method: "POST", ...body(b) }),
  patchQaCase: (pid: string, rid: string, cid: string, b: PatchQaCase) => j<QaReportDetail>(paths.qaCase(pid, rid, cid), { method: "PATCH", ...body(b) }),
  deleteQaCase: (pid: string, rid: string, cid: string) => j<QaReportDetail>(paths.qaCase(pid, rid, cid), { method: "DELETE" }),
  createQaFinding: (pid: string, rid: string, b: CreateQaFinding) => j<QaReportDetail>(paths.qaFindings(pid, rid), { method: "POST", ...body(b) }),
  patchQaFinding: (pid: string, rid: string, fid: string, b: PatchQaFinding) => j<QaReportDetail>(paths.qaFinding(pid, rid, fid), { method: "PATCH", ...body(b) }),
  deleteQaFinding: (pid: string, rid: string, fid: string) => j<QaReportDetail>(paths.qaFinding(pid, rid, fid), { method: "DELETE" }),
  uploadQaAttachments: (pid: string, rid: string, owner: { ownerType: QaOwnerType; ownerId: string }, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return jUpload<{ saved: QaAttachmentView[]; rejected: { filename: string; reason: string }[] }>(
      paths.qaAttachments(pid, rid) + qs(owner), form);
  },
  deleteQaAttachment: (pid: string, rid: string, aid: string) => j<{ ok: true }>(paths.qaAttachment(pid, rid, aid), { method: "DELETE" }),
  importQaReport: (pid: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return jUpload<QaImportResult>(paths.qaImport(pid), form);
  },
  // URL untuk <a href>/<img src> — `rebase` supaya ikut target remote (relay) seperti fetch lain.
  qaExportUrl: (pid: string, rid: string, format?: "md") => rebase(paths.qaReport(pid, rid) + "/export" + (format ? `?format=${format}` : "")),
  qaAttachmentUrl: (pid: string, rid: string, aid: string, download = false) => rebase(paths.qaAttachment(pid, rid, aid) + (download ? "?download=1" : "")),
  qaTemplateUrl: () => rebase(paths.qaTemplate),
```
(`QaOwnerType` dsb. tersedia dari `@hanoman/shared`; bila `qs()` menolak tipe objek, ubah parameternya jadi `Record<string, string>` — `qs` menerima `Record<string, string | number | boolean | undefined>`.)

- [ ] **Step 4: `src/src/routes.ts`**

Komentar bentuk URL, tambahkan baris `//   /qa[/<projectId>]                  laporan QA project terpilih (default: project pertama)`. Pada `Route.projectId` komentar: tambah "`qa`". Di `routePath` sebelum `default`:

```ts
    case "qa": return r.projectId ? `/qa/${seg(r.projectId)}` : "/qa";
```
Di `parseRoute` sesudah baris `skills`:

```ts
  if (head === "qa" && parts.length === 2) return { section: "qa", projectId: a };
```

- [ ] **Step 5: Nav + App**

`src/src/ds/shell.tsx` — sisipkan tepat sesudah entri `team`:

```ts
  // Workspace QA · laporan QA per project (test case, temuan, lampiran) → perbaikan project.
  { key: "qa", label: "QA", icon: "clipboard-check" },
```

`src/src/App.tsx` — impor `import { QaWorkspace } from "./screens/qa/QaWorkspace";` (di dekat impor `SkillsWorkspace`) dan cabang baru tepat sebelum `} else if (section === "skills") {`:

```tsx
  } else if (section === "qa") {
    // Workspace QA · /qa → project pertama; /qa/<projectId> → laporan project itu.
    const qaProjectId = route?.projectId ?? projects[0]?.id;
    screen = (
      <Shell active="qa" title="QA" wide onNavigate={setSection} breadcrumb="qa · laporan per project">
        {gate(<QaWorkspace key={qaProjectId ?? "none"} projects={projects} projectId={qaProjectId}
          onSelectProject={(id) => navigate(routePath({ section: "qa", projectId: id }))} onToast={showToast} />)}
      </Shell>
    );
```
(Cek nama `navigate`/`routePath`/`gate`/`showToast` di berkas — dipakai persis begitu di cabang `skills` dan `goProject`.)

- [ ] **Step 6: Lanjut ke Task 10 sebelum menjalankan** — `App.tsx` mengimpor `QaWorkspace` yang dibuat di Task 10, jadi typecheck/test App baru hijau sesudah Task 10. Task 9 dan 10 di-commit bersama (satu commit "UI QA") atau Task 10 Step 1–3 dikerjakan dulu. Yang boleh dijalankan sekarang: `pnpm vitest --run src/src/routes.test.ts src/test/qa-nav.test.tsx --no-file-parallelism` (hijau) dan `pnpm --filter ./shared typecheck`.

---

### Task 10: UI `QaWorkspace` — daftar, editor, test case, temuan

**Files:**
- Create: `src/src/screens/qa/qa-ui.ts`, `QaWorkspace.tsx`, `QaReportList.tsx`, `QaReportEditor.tsx`, `QaCasesPanel.tsx`, `QaFindingsPanel.tsx`, `QaWorkspace.test.tsx`
- (Lampiran & pratinjau = Task 11; Task 10 memakai stub `QaAttachments`/`QaPreview` yang diganti di sana — atau kerjakan Task 11 Step 1–2 lebih dulu.)

**Interfaces:**
- Consumes: `useApi()` (Task 9), tipe view dari `@hanoman/shared`, ds `Button/Card/Field/Input/Select/Modal/StateBlock/Badge/Tabs/HnTextarea/useConfirm`.
- Produces: `<QaWorkspace projects projectId onSelectProject onToast />`; internal: `QaReportList`, `QaReportEditor`, `QaCasesPanel`, `QaFindingsPanel` (props `PanelProps` di bawah); `qa-ui.ts` (`SEVERITY_TONE`, `CASE_TONE`, `REPORT_TONE`, `VERDICT_TONE`, `pct`, `errText`, `envToText`, `textToEnv`).

Teks UI yang dikunci test: tombol `Laporan baru`, `Impor`, `Unduh template`; editor `Kembali`, `Simpan`, `Buka kembali`; tab `Test case`/`Temuan`/`Lampiran`/`Pratinjau`; input `Judul test case baru` + tombol `Tambah`; tombol `Temuan baru` + modal `Simpan temuan`.

- [ ] **Step 1: Tulis test yang gagal** — `src/src/screens/qa/QaWorkspace.test.tsx`

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaWorkspace } from "./QaWorkspace";

const at = "2026-10-01T10:00:00.000Z";
const stats = {
  cases: { total: 2, pass: 1, fail: 1, blocked: 0, skipped: 0, todo: 0 }, passRate: 0.5,
  findings: { total: 1, open: 1, blocker: 0, critical: 0, major: 1, minor: 0, trivial: 0 },
};
const view = {
  id: "r1", projectId: "p1", code: "QA-001", title: "Smoke 0.9", buildVersion: "0.9.12", environment: { os: "macOS" },
  scope: "", tester: "Dena", summary: "", status: "draft", verdict: null, createdAt: at, updatedAt: at, stats,
};
const mkCase = (id: string, code: string, title: string, status = "todo") =>
  ({ id, reportId: "r1", code, title, steps: "", expected: "", actual: "", status, order: 1, createdAt: at, updatedAt: at });
const detail = {
  ...view,
  cases: [mkCase("c1", "TC-01", "Login")],
  findings: [{
    id: "f1", reportId: "r1", code: "F-01", caseId: "c1", caseCode: "TC-01", title: "Tombol mati", severity: "major", priority: "P1",
    area: "checkout", steps: ["buka", "klik"], expected: "ok", actual: "diam", status: "open", backlogId: null, createdAt: at, updatedAt: at,
  }],
  attachments: [],
};
const projects = [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }];
const json = (v: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v } as Response);

function mockFetch(extra: (u: string, init?: RequestInit) => Promise<Response> | null = () => null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const u = String(url);
    const x = extra(u, init);
    if (x) return x;
    if (u.endsWith("/api/projects/p1/qa/reports") && (!init?.method || init.method === "GET")) return json({ items: [view], total: 1 });
    if (u.endsWith("/api/projects/p1/qa/reports/r1")) return json(detail);
    return json({});
  });
}
const renderWs = (over: Partial<React.ComponentProps<typeof QaWorkspace>> = {}) =>
  render(<QaWorkspace projects={projects} projectId="p1" onSelectProject={() => {}} {...over} />);
afterEach(() => vi.restoreAllMocks());

describe("QaWorkspace", () => {
  it("daftar: nomor, judul, status, pass-rate, dan temuan open", async () => {
    mockFetch();
    renderWs();
    expect(await screen.findByText("QA-001")).toBeTruthy();
    expect(screen.getByText("Smoke 0.9")).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(screen.getByText(/1 open/)).toBeTruthy();
    expect(screen.getByText("Laporan baru")).toBeTruthy();
    expect(screen.getByText("Unduh template")).toBeTruthy();
  });

  it("tanpa project: keadaan kosong, tanpa memanggil API", async () => {
    const spy = mockFetch();
    renderWs({ projectId: undefined, projects: [] });
    expect(await screen.findByText(/belum ada project/i)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("membuka laporan menampilkan editor; tab Temuan memuat F-01 beserta severity/prioritas", async () => {
    mockFetch();
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    expect(await screen.findByDisplayValue("Smoke 0.9")).toBeTruthy();
    expect(screen.getByDisplayValue("Login")).toBeTruthy();   // tab Test case aktif lebih dulu (judul = nilai Input)
    fireEvent.click(screen.getByRole("tab", { name: /Temuan/ }));
    expect(await screen.findByText("F-01")).toBeTruthy();
    expect(screen.getByText("Tombol mati")).toBeTruthy();
    expect(screen.getByText("major")).toBeTruthy();
    expect(screen.getByText("P1")).toBeTruthy();
  });

  it("menambah test case: POST ke /cases lalu menampilkan hasil jawaban server", async () => {
    const posted: { url: string; body: unknown }[] = [];
    mockFetch((u, init) => {
      if (u.endsWith("/qa/reports/r1/cases") && init?.method === "POST") {
        posted.push({ url: u, body: JSON.parse(String(init.body)) });
        return json({ ...detail, cases: [mkCase("c1", "TC-01", "Login"), mkCase("c2", "TC-02", "Checkout")] }, 201);
      }
      return null;
    });
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    const input = await screen.findByLabelText("Judul test case baru");
    fireEvent.change(input, { target: { value: "Checkout" } });
    fireEvent.click(screen.getByText("Tambah"));
    expect(await screen.findByDisplayValue("Checkout")).toBeTruthy();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toMatchObject({ title: "Checkout" });
  });

  it("laporan closed: tombol Buka kembali ada, Simpan dan Tambah tak ada", async () => {
    mockFetch((u) => (u.endsWith("/qa/reports/r1") ? json({ ...detail, status: "closed", verdict: "go" }) : null));
    renderWs();
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    expect(await screen.findByText("Buka kembali")).toBeTruthy();
    expect(screen.queryByText("Tambah")).toBeNull();
    expect((screen.getByText("Simpan").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("galat server (409/400) ditampilkan lewat onToast, bukan ditelan", async () => {
    const toast = vi.fn();
    mockFetch((u, init) => (u.endsWith("/qa/reports/r1") && init?.method === "PATCH"
      ? json({ error: "verdict wajib diisi sebelum laporan di-submit atau di-close" }, 400) : null));
    renderWs({ onToast: toast });
    fireEvent.click(await screen.findByText("Smoke 0.9"));
    fireEvent.click(await screen.findByText("Submit"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/verdict wajib/)));
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `pnpm vitest --run src/src/screens/qa/QaWorkspace.test.tsx --no-file-parallelism` → FAIL (modul belum ada).

- [ ] **Step 3: `qa-ui.ts`**

```ts
import type { QaCaseStatus, QaReportStatus, QaSeverity, QaVerdict } from "@hanoman/shared";

export type Tone = "neutral" | "brass" | "info" | "ok" | "warn" | "err";
export const SEVERITY_TONE: Record<QaSeverity, Tone> = { blocker: "err", critical: "err", major: "warn", minor: "info", trivial: "neutral" };
export const CASE_TONE: Record<QaCaseStatus, Tone> = { todo: "neutral", pass: "ok", fail: "err", blocked: "warn", skipped: "info" };
export const REPORT_TONE: Record<QaReportStatus, Tone> = { draft: "neutral", submitted: "brass", closed: "ok" };
export const VERDICT_TONE: Record<QaVerdict, Tone> = { go: "ok", "no-go": "err", conditional: "warn" };
export const VERDICT_LABEL: Record<QaVerdict, string> = { go: "Go", "no-go": "No-go", conditional: "Conditional" };

export const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** Pesan galat dari ApiError (`detail.error` string) atau Error biasa. */
export function errText(e: unknown): string {
  const d = (e as { detail?: { error?: unknown } } | null)?.detail?.error;
  if (typeof d === "string") return d;
  return e instanceof Error ? e.message : "Gagal";
}

export const envToText = (e: Record<string, string>): string =>
  Object.entries(e).map(([k, v]) => `${k}=${v}`).join("\n");
export const textToEnv = (t: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of t.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    const i = l.indexOf("=");
    const k = (i < 0 ? l : l.slice(0, i)).trim();
    if (k) out[k] = i < 0 ? "" : l.slice(i + 1).trim();
  }
  return out;
};

export const fmtSize = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
```

- [ ] **Step 4: `QaWorkspace.tsx`**

```tsx
// src/src/screens/qa/QaWorkspace.tsx
// Workspace QA · satu komponen untuk /qa/<projectId>: daftar laporan ↔ editor satu laporan.
// Pola SkillsWorkspace. Setiap mutasi anak menjawab QaReportDetail terbaru, jadi editor cukup
// menggantikan state-nya — tak ada penghitungan nomor/statistik di klien.
import React from "react";
import type { QaReportDetail, QaReportView } from "@hanoman/shared";
import { Button, Field, Input, Modal, Select, StateBlock } from "../../ds";
import { useApi } from "../../api/instance";
import { QaReportEditor } from "./QaReportEditor";
import { QaReportList } from "./QaReportList";
import { errText } from "./qa-ui";

type Props = {
  projects: { id: string; name: string }[];
  projectId: string | undefined;
  onSelectProject: (id: string) => void;
  onToast?: (m: string) => void;
};

export function QaWorkspace({ projects, projectId, onSelectProject, onToast }: Props) {
  const api = useApi();
  const [reports, setReports] = React.useState<QaReportView[] | null>(null);
  const [error, setError] = React.useState(false);
  const [open, setOpen] = React.useState<QaReportDetail | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  const reload = React.useCallback(async () => {
    if (!projectId) return;
    setError(false);
    try { setReports((await api.qaReports(projectId)).items); } catch { setError(true); }
  }, [api, projectId]);
  React.useEffect(() => { setOpen(null); setReports(null); void reload(); }, [reload]);

  if (!projectId) {
    return <StateBlock kind="empty" title="Belum ada project" hint="Buat atau muat project di halaman Projects, lalu buka QA lagi." />;
  }

  const openReport = async (id: string) => {
    try { setOpen(await api.qaReport(projectId, id)); } catch (e) { onToast?.(errText(e)); }
  };
  const create = async () => {
    const t = title.trim();
    if (!t) return;
    try {
      const d = await api.createQaReport(projectId, { title: t });
      setCreating(false); setTitle(""); setOpen(d); void reload();
    } catch (e) { onToast?.(errText(e)); }
  };
  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await api.importQaReport(projectId, file);
      const rej = r.attachments.rejected.length ? `, ${r.attachments.rejected.length} lampiran ditolak` : "";
      onToast?.(`${r.created ? "Diimpor" : "Diperbarui"}: ${r.cases} test case, ${r.findings} temuan, ${r.attachments.saved} lampiran${rej}`);
      await reload();
      await openReport(r.reportId);
    } catch (e) { onToast?.(errText(e)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Select aria-label="Project" value={projectId} onChange={(e) => onSelectProject(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        {!open && (
          <>
            <Button leftIcon="plus" onClick={() => setCreating(true)}>Laporan baru</Button>
            <Button variant="secondary" leftIcon="upload" onClick={() => fileRef.current?.click()}>Impor</Button>
            <Button variant="ghost" leftIcon="download" as="a" href={api.qaTemplateUrl()} download="qa-template.md">Unduh template</Button>
            <input ref={fileRef} type="file" accept=".zip,.md" hidden aria-label="Berkas impor laporan"
              onChange={(e) => void doImport(e.target.files?.[0])} />
          </>
        )}
      </div>

      {open ? (
        <QaReportEditor detail={open} projectId={projectId} onChange={setOpen} onToast={onToast}
          onBack={() => { setOpen(null); void reload(); }}
          onDeleted={() => { setOpen(null); void reload(); }} />
      ) : error ? (
        <StateBlock kind="error" title="Gagal memuat laporan QA" action={() => void reload()} actionLabel="Coba lagi" />
      ) : reports === null ? (
        <StateBlock kind="loading" />
      ) : (
        <QaReportList reports={reports} onOpen={(id) => void openReport(id)} />
      )}

      <Modal open={creating} title="Laporan QA baru" onClose={() => setCreating(false)}
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Batal</Button><Button onClick={() => void create()} disabled={!title.trim()}>Buat</Button></>}>
        <Field label="Judul" hint="mis. Smoke test rilis 0.9.12">
          <Input value={title} autoFocus onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void create(); }} />
        </Field>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 5: `QaReportList.tsx`**

```tsx
import type { QaReportView } from "@hanoman/shared";
import { Badge, Card, StateBlock } from "../../ds";
import { REPORT_TONE, VERDICT_LABEL, VERDICT_TONE, pct } from "./qa-ui";

export function QaReportList({ reports, onOpen }: { reports: QaReportView[]; onOpen: (id: string) => void }) {
  if (reports.length === 0)
    return <StateBlock kind="empty" title="Belum ada laporan QA" hint="Buat laporan baru, atau impor dari template Markdown." />;
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))" }}>
      {reports.map((r) => (
        <Card key={r.id} interactive padding={16} onClick={() => onOpen(r.id)} style={{ cursor: "pointer" }}
          role="button" tabIndex={0} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") onOpen(r.id); }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <Badge tone="brass" variant="outline" size="sm">{r.code}</Badge>
            <Badge tone={REPORT_TONE[r.status]} size="sm">{r.status}</Badge>
            {r.verdict && <Badge tone={VERDICT_TONE[r.verdict]} size="sm">{VERDICT_LABEL[r.verdict]}</Badge>}
          </div>
          <div style={{ fontWeight: 600, color: "var(--text-strong)", marginBottom: 4, overflowWrap: "anywhere" }}>{r.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-subtle)" }}>
            {[r.buildVersion && `build ${r.buildVersion}`, r.tester].filter(Boolean).join(" · ") || "—"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 }}>
            {r.stats.cases.pass}/{r.stats.cases.total} pass ({pct(r.stats.passRate)}) · {r.stats.findings.total} temuan ({r.stats.findings.open} open)
          </div>
        </Card>
      ))}
    </div>
  );
}
```
(tambahkan `import React from "react";` bila JSX runtime klasik dipakai di berkas tetangga — ikuti `SkillsWorkspace.tsx`.)

- [ ] **Step 6: `QaReportEditor.tsx`** — header + tab; `QaAttachments`/`QaPreview` dari Task 11

```tsx
import React from "react";
import { QA_VERDICTS, type QaReportDetail, type QaReportStatus } from "@hanoman/shared";
import { Badge, Button, Field, HnTextarea, Input, Select, Tabs, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import { QaCasesPanel } from "./QaCasesPanel";
import { QaFindingsPanel } from "./QaFindingsPanel";
import { QaPreview } from "./QaPreview";
import { REPORT_TONE, envToText, errText, textToEnv } from "./qa-ui";

export type PanelProps = {
  detail: QaReportDetail; projectId: string; locked: boolean;
  onChange: (d: QaReportDetail) => void; onToast?: (m: string) => void;
};
type Props = {
  detail: QaReportDetail; projectId: string; onChange: (d: QaReportDetail) => void;
  onBack: () => void; onDeleted: () => void; onToast?: (m: string) => void;
};

const seed = (d: QaReportDetail) => ({
  title: d.title, buildVersion: d.buildVersion, tester: d.tester, scope: d.scope, summary: d.summary,
  verdict: d.verdict ?? "", env: envToText(d.environment),
});

export function QaReportEditor({ detail, projectId, onChange, onBack, onDeleted, onToast }: Props) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const locked = detail.status === "closed";
  const [tab, setTab] = React.useState("cases");
  const [f, setF] = React.useState(() => seed(detail));
  const [busy, setBusy] = React.useState(false);
  // Hanya id: updatedAt berubah di setiap mutasi anak dan akan menimpa ketikan header yang belum disimpan.
  React.useEffect(() => { setF(seed(detail)); }, [detail.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fields = () => ({
    title: f.title, buildVersion: f.buildVersion, tester: f.tester, scope: f.scope, summary: f.summary,
    verdict: (f.verdict || null) as QaReportDetail["verdict"], environment: textToEnv(f.env),
  });
  const patch = async (extra: { status?: QaReportStatus } = {}) => {
    setBusy(true);
    try { onChange(await api.patchQaReport(projectId, detail.id, { ...(locked ? {} : fields()), ...extra })); }
    catch (e) { onToast?.(errText(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Hapus ${detail.code}?`, message: "Test case, temuan, dan lampirannya ikut terhapus.", tone: "danger", confirmLabel: "Hapus" }))) return;
    try { await api.deleteQaReport(projectId, detail.id); onDeleted(); } catch (e) { onToast?.(errText(e)); }
  };
  const set = (k: keyof ReturnType<typeof seed>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" };
  const panel: PanelProps = { detail, projectId, locked, onChange, onToast };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="ghost" leftIcon="arrow-left" onClick={onBack}>Kembali</Button>
        <Badge tone="brass" variant="outline">{detail.code}</Badge>
        <Badge tone={REPORT_TONE[detail.status]}>{detail.status}</Badge>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id)}>Ekspor ZIP</Button>
        {!locked && <Button variant="ghost" leftIcon="trash-2" onClick={() => void remove()}>Hapus</Button>}
      </div>

      <div style={grid}>
        <Field label="Judul"><Input value={f.title} disabled={locked} onChange={set("title")} /></Field>
        <Field label="Build / versi"><Input value={f.buildVersion} disabled={locked} onChange={set("buildVersion")} /></Field>
        <Field label="Penguji"><Input value={f.tester} disabled={locked} onChange={set("tester")} /></Field>
        <Field label="Keputusan" hint="Wajib sebelum Submit/Close">
          <Select aria-label="Keputusan" value={f.verdict} disabled={locked} onChange={set("verdict")}
            options={[{ value: "", label: "— belum diputuskan —" }, ...QA_VERDICTS.map((v) => ({ value: v, label: v }))]} />
        </Field>
      </div>
      <div style={grid}>
        <Field label="Lingkungan" hint="satu per baris: kunci=nilai (os, browser, device, url, branch)">
          <HnTextarea rows={4} mono value={f.env} disabled={locked} onChange={set("env")} />
        </Field>
        <Field label="Cakupan"><HnTextarea rows={4} value={f.scope} disabled={locked} onChange={set("scope")} /></Field>
        <Field label="Ringkasan hasil"><HnTextarea rows={4} value={f.summary} disabled={locked} onChange={set("summary")} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => void patch()} disabled={locked || busy} loading={busy}>Simpan</Button>
        {detail.status === "draft" && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "submitted" })}>Submit</Button>}
        {detail.status === "submitted" && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "closed" })}>Close</Button>}
        {locked && <Button variant="secondary" disabled={busy} onClick={() => void patch({ status: "draft" })}>Buka kembali</Button>}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "cases", label: "Test case", count: detail.cases.length },
        { value: "findings", label: "Temuan", count: detail.findings.length },
        { value: "attachments", label: "Lampiran", count: detail.attachments.filter((a) => a.ownerType === "report").length },
        { value: "preview", label: "Pratinjau" },
      ]} />
      {tab === "cases" && <QaCasesPanel {...panel} />}
      {tab === "findings" && <QaFindingsPanel {...panel} />}
      {tab === "attachments" && <QaAttachments {...panel} ownerType="report" ownerId={detail.id} />}
      {tab === "preview" && <QaPreview detail={detail} projectId={projectId} />}
      {dialog}
    </div>
  );
}
```
Catatan: `Simpan` sengaja `disabled` saat `locked` (test mengunci ini); `Submit` mengirim `{...fields(), status}` sehingga `verdict` yang baru diisi ikut tersimpan dalam satu permintaan.

- [ ] **Step 7: `QaCasesPanel.tsx`**

```tsx
import React from "react";
import { QA_CASE_STATUSES, type QaCaseStatus, type QaCaseView } from "@hanoman/shared";
import { Badge, Button, Card, HnTextarea, Input, Select, StateBlock } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import type { PanelProps } from "./QaReportEditor";
import { CASE_TONE, errText } from "./qa-ui";

export function QaCasesPanel(p: PanelProps) {
  const api = useApi();
  const [title, setTitle] = React.useState("");
  const run = async (fn: () => Promise<PanelProps["detail"]>) => {
    try { p.onChange(await fn()); return true; } catch (e) { p.onToast?.(errText(e)); return false; }
  };
  const add = async () => {
    const t = title.trim();
    if (!t) return;
    if (await run(() => api.createQaCase(p.projectId, p.detail.id, { title: t }))) setTitle("");
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {p.detail.cases.length === 0 && <StateBlock kind="empty" compact title="Belum ada test case" hint="Tambahkan langkah uji pertama di bawah." />}
      {p.detail.cases.map((c) => <CaseCard key={c.id} c={c} p={p} run={run} />)}
      {!p.locked && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <Input aria-label="Judul test case baru" placeholder="Judul test case baru" value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") void add(); }} />
          </div>
          <Button leftIcon="plus" onClick={() => void add()} disabled={!title.trim()}>Tambah</Button>
        </div>
      )}
    </div>
  );
}

function CaseCard({ c, p, run }: { c: QaCaseView; p: PanelProps; run: (fn: () => Promise<PanelProps["detail"]>) => Promise<boolean> }) {
  const api = useApi();
  const [d, setD] = React.useState({ title: c.title, steps: c.steps, expected: c.expected, actual: c.actual });
  React.useEffect(() => { setD({ title: c.title, steps: c.steps, expected: c.expected, actual: c.actual }); }, [c.id, c.title, c.steps, c.expected, c.actual]);
  // Simpan saat blur, hanya bila berubah — ketikan tak membanjiri server.
  const commit = (k: "title" | "steps" | "expected" | "actual") => {
    if (d[k] === c[k] || (k === "title" && !d.title.trim())) return;
    void run(() => api.patchQaCase(p.projectId, p.detail.id, c.id, { [k]: d[k] }));
  };
  const bind = (k: keyof typeof d) => ({
    value: d[k], disabled: p.locked, onBlur: () => commit(k),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((s) => ({ ...s, [k]: e.target.value })),
  });
  const grid: React.CSSProperties = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" };
  return (
    <Card padding={14}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <Badge tone="neutral" variant="outline" size="sm">{c.code}</Badge>
        <div style={{ flex: "1 1 200px" }}><Input aria-label={`Judul ${c.code}`} {...bind("title")} /></div>
        <Select aria-label={`Status ${c.code}`} value={c.status} disabled={p.locked}
          onChange={(e) => void run(() => api.patchQaCase(p.projectId, p.detail.id, c.id, { status: e.target.value as QaCaseStatus }))}
          options={QA_CASE_STATUSES.map((s) => ({ value: s, label: s }))} />
        <Badge tone={CASE_TONE[c.status]} size="sm">{c.status}</Badge>
        {!p.locked && (
          <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${c.code}`}
            onClick={() => void run(() => api.deleteQaCase(p.projectId, p.detail.id, c.id))} />
        )}
      </div>
      <div style={grid}>
        <HnTextarea rows={3} placeholder="Langkah" aria-label={`Langkah ${c.code}`} {...bind("steps")} />
        <HnTextarea rows={3} placeholder="Diharapkan" aria-label={`Diharapkan ${c.code}`} {...bind("expected")} />
        <HnTextarea rows={3} placeholder="Aktual" aria-label={`Aktual ${c.code}`} {...bind("actual")} />
      </div>
      <QaAttachments {...p} ownerType="case" ownerId={c.id} compact />
    </Card>
  );
}
```
(Badge status ganda dengan Select adalah sengaja: Select untuk mengubah, Badge memberi warna sekilas — hapus Badge bila tampilan terasa redundan.)

- [ ] **Step 8: `QaFindingsPanel.tsx`**

```tsx
import React from "react";
import {
  QA_PRIORITIES, QA_SEVERITIES, type QaFindingView, type QaPriority, type QaSeverity,
} from "@hanoman/shared";
import { Badge, Button, Card, Field, HnTextarea, Input, Modal, Select, StateBlock, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { QaAttachments } from "./QaAttachments";
import type { PanelProps } from "./QaReportEditor";
import { SEVERITY_TONE, errText } from "./qa-ui";

type Draft = {
  id: string | null; title: string; severity: QaSeverity; priority: QaPriority; area: string;
  caseId: string; steps: string; expected: string; actual: string; status: "open" | "wontfix";
};
const blank: Draft = { id: null, title: "", severity: "major", priority: "P2", area: "", caseId: "", steps: "", expected: "", actual: "", status: "open" };
const fromFinding = (f: QaFindingView): Draft => ({
  id: f.id, title: f.title, severity: f.severity, priority: f.priority, area: f.area, caseId: f.caseId ?? "",
  steps: f.steps.join("\n"), expected: f.expected, actual: f.actual, status: f.status === "wontfix" ? "wontfix" : "open",
});

export function QaFindingsPanel(p: PanelProps) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    const body = {
      title: draft.title.trim(), severity: draft.severity, priority: draft.priority, area: draft.area,
      caseId: draft.caseId || null, expected: draft.expected, actual: draft.actual, status: draft.status,
      steps: draft.steps.split("\n").map((l) => l.trim().replace(/^\d+[.)]\s+/, "")).filter(Boolean),
    };
    try {
      p.onChange(draft.id
        ? await api.patchQaFinding(p.projectId, p.detail.id, draft.id, body)
        : await api.createQaFinding(p.projectId, p.detail.id, body));
      setDraft(null);
    } catch (e) { p.onToast?.(errText(e)); }
  };
  const remove = async (f: QaFindingView) => {
    if (!(await confirm({ title: `Hapus ${f.code}?`, message: f.title, tone: "danger", confirmLabel: "Hapus" }))) return;
    try { p.onChange(await api.deleteQaFinding(p.projectId, p.detail.id, f.id)); } catch (e) { p.onToast?.(errText(e)); }
  };
  const set = <K extends keyof Draft>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => (d ? { ...d, [k]: e.target.value as Draft[K] } : d));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!p.locked && <div><Button leftIcon="bug" onClick={() => setDraft({ ...blank })}>Temuan baru</Button></div>}
      {p.detail.findings.length === 0 && <StateBlock kind="empty" compact title="Belum ada temuan" hint="Satu temuan = satu masalah, lengkap dengan langkah repro yang bisa diulang." />}
      {p.detail.findings.map((f) => (
        <Card key={f.id} padding={14}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <Badge tone="neutral" variant="outline" size="sm">{f.code}</Badge>
            <Badge tone={SEVERITY_TONE[f.severity]} size="sm">{f.severity}</Badge>
            <Badge tone="brass" size="sm">{f.priority}</Badge>
            {f.status !== "open" && <Badge tone="info" size="sm">{f.status}</Badge>}
            {f.area && <span style={{ fontSize: 12.5, color: "var(--text-subtle)" }}>{f.area}</span>}
            {f.caseCode && <span style={{ fontSize: 12.5, color: "var(--text-subtle)" }}>· {f.caseCode}</span>}
            <span style={{ flex: 1 }} />
            {!p.locked && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDraft(fromFinding(f))}>Ubah</Button>
                <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${f.code}`} onClick={() => void remove(f)} />
              </>
            )}
          </div>
          <div style={{ fontWeight: 600, color: "var(--text-strong)", overflowWrap: "anywhere" }}>{f.title}</div>
          {f.steps.length > 0 && <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 13 }}>{f.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {(f.expected || f.actual) && (
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", marginTop: 8, fontSize: 13 }}>
              <div><b>Expected</b><div style={{ whiteSpace: "pre-wrap" }}>{f.expected || "—"}</div></div>
              <div><b>Actual</b><div style={{ whiteSpace: "pre-wrap" }}>{f.actual || "—"}</div></div>
            </div>
          )}
          <QaAttachments {...p} ownerType="finding" ownerId={f.id} compact />
        </Card>
      ))}

      <Modal open={!!draft} width={640} title={draft?.id ? "Ubah temuan" : "Temuan baru"} onClose={() => setDraft(null)}
        footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Batal</Button><Button onClick={() => void save()} disabled={!draft?.title.trim()}>Simpan temuan</Button></>}>
        {draft && (
          <>
            <Field label="Judul"><Input value={draft.title} onChange={set("title")} autoFocus /></Field>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
              <Field label="Severity" hint="dampak teknis">
                <Select aria-label="Severity" value={draft.severity} onChange={set("severity")} options={QA_SEVERITIES.map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Prioritas" hint="urutan perbaikan">
                <Select aria-label="Prioritas" value={draft.priority} onChange={set("priority")} options={QA_PRIORITIES.map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Area"><Input value={draft.area} onChange={set("area")} /></Field>
              <Field label="Test case">
                <Select aria-label="Test case" value={draft.caseId} onChange={set("caseId")}
                  options={[{ value: "", label: "— tidak terkait —" }, ...p.detail.cases.map((c) => ({ value: c.id, label: `${c.code} · ${c.title}` }))]} />
              </Field>
            </div>
            <Field label="Langkah repro" hint="satu langkah per baris; nomor ditambahkan otomatis">
              <HnTextarea rows={5} value={draft.steps} onChange={set("steps")} />
            </Field>
            <Field label="Expected"><HnTextarea rows={3} value={draft.expected} onChange={set("expected")} /></Field>
            <Field label="Actual"><HnTextarea rows={3} value={draft.actual} onChange={set("actual")} /></Field>
            {draft.id && (
              <Field label="Status">
                <Select aria-label="Status temuan" value={draft.status} onChange={set("status")}
                  options={[{ value: "open", label: "open" }, { value: "wontfix", label: "wontfix" }]} />
              </Field>
            )}
          </>
        )}
      </Modal>
      {dialog}
    </div>
  );
}
```

- [ ] **Step 9: (setelah Task 11 Step 3) jalankan test + typecheck**

Run: `pnpm vitest --run src/src/screens/qa src/src/routes.test.ts src/test/qa-nav.test.tsx src/test/changelog-nav.test.tsx --no-file-parallelism && pnpm --filter ./src typecheck`
Expected: PASS. Bila `getByText("major")` bentrok dengan opsi `<select>` (tak mungkin: modal tertutup), perketat query dengan `within(...)`. Jangan melonggarkan asersi tanpa alasan.

- [ ] **Step 10: Commit (bersama Task 9 + 11 bila dikerjakan beruntun)**

```bash
git add shared/src/api.ts shared/src/qa.ts server/src/services/qa-transfer.ts src/src/api/client.ts src/src/routes.ts src/src/routes.test.ts src/src/ds/shell.tsx src/src/App.tsx src/test/qa-nav.test.tsx src/src/screens/qa
git commit -m "feat(qa): UI Workspace QA — daftar, editor, test case, temuan, rute /qa

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: UI lampiran, pratinjau, ikon

**Files:**
- Create: `src/src/screens/qa/QaAttachments.tsx`, `src/src/screens/qa/QaPreview.tsx`, `src/src/screens/qa/QaAttachments.test.tsx`
- Modify: `src/src/ds/icon-registry.ts` (dibangkitkan), `src/src/ds/icon-names.ts` bila skrip memerlukannya

**Interfaces:**
- Consumes: `PanelProps` (Task 10), `api.uploadQaAttachments/deleteQaAttachment/qaAttachmentUrl/qaExportUrl/qaReport`, `renderQaMarkdown` (Task 6), `MarkdownView`.
- Produces: `<QaAttachments {...PanelProps} ownerType ownerId compact? />` — daftar lampiran pemilik + unggah (tombol, drag-drop, tempel screenshot), pratinjau gambar; `<QaPreview detail projectId />`.

- [ ] **Step 1: Tulis test yang gagal** — `src/src/screens/qa/QaAttachments.test.tsx`

```tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaAttachments } from "./QaAttachments";

const at = "2026-10-01T10:00:00.000Z";
const att = (id: string, filename: string, mimeType: string, ownerId = "f1") =>
  ({ id, reportId: "r1", ownerType: "finding", ownerId, filename, mimeType, size: 2048, sha256: "x", syncState: "local-only", createdAt: at });
const base = {
  id: "r1", projectId: "p1", code: "QA-001", title: "T", buildVersion: "", environment: {}, scope: "", tester: "", summary: "",
  status: "draft", verdict: null, createdAt: at, updatedAt: at, cases: [], findings: [],
  stats: { cases: { total: 0, pass: 0, fail: 0, blocked: 0, skipped: 0, todo: 0 }, passRate: null, findings: { total: 0, open: 0, blocker: 0, critical: 0, major: 0, minor: 0, trivial: 0 } },
};
const detail = { ...base, attachments: [att("a1", "layar.png", "image/png"), att("a2", "log.txt", "text/plain"), att("a3", "lain.png", "image/png", "f2")] };
const json = (v: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v } as Response);
afterEach(() => vi.restoreAllMocks());

const props = (over = {}) => ({ detail, projectId: "p1", locked: false, onChange: vi.fn(), onToast: vi.fn(), ownerType: "finding" as const, ownerId: "f1", ...over });

describe("QaAttachments", () => {
  it("hanya menampilkan lampiran pemiliknya; gambar bertautan ke URL penyajian, berkas lain bernama + ukuran", () => {
    render(<QaAttachments {...props()} />);
    const img = screen.getByAltText("layar.png") as HTMLImageElement;
    expect(img.src).toContain("/api/projects/p1/qa/reports/r1/attachments/a1");
    expect(screen.getByText("log.txt")).toBeTruthy();
    expect(screen.getAllByText(/2 KB/)).toHaveLength(2);   // gambar (nama · ukuran) + berkas log
    expect(screen.queryByAltText("lain.png")).toBeNull();
  });

  it("menempel screenshot (clipboard) mengunggah ke owner yang benar lalu memuat ulang laporan", async () => {
    const calls: { url: string; method?: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
      calls.push({ url: String(url), method: init?.method });
      if (init?.method === "POST") return json({ saved: [att("a9", "image.png", "image/png")], rejected: [] }, 201);
      return json({ ...detail, attachments: [...detail.attachments, att("a9", "image.png", "image/png")] });
    });
    const onChange = vi.fn();
    const { container } = render(<QaAttachments {...props({ onChange })} />);
    const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    fireEvent.paste(container.firstElementChild!, { clipboardData: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls[0]!.url).toContain("/qa/reports/r1/attachments?ownerType=finding&ownerId=f1");
    expect(calls[0]!.method).toBe("POST");
  });

  it("berkas > 10 MB ditolak di klien tanpa memanggil API; penolakan server dilaporkan lewat toast", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => json({ saved: [], rejected: [{ filename: "x.sh", reason: "type" }] }, 201));
    const onToast = vi.fn();
    const { container } = render(<QaAttachments {...props({ onToast })} />);
    const big = new File([new Uint8Array(1)], "besar.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    fireEvent.paste(container.firstElementChild!, { clipboardData: { files: [big] } });
    expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/besar\.png.*10 MB/));
    expect(spy).not.toHaveBeenCalled();

    const sh = new File(["rm"], "x.sh", { type: "application/x-sh" });
    fireEvent.paste(container.firstElementChild!, { clipboardData: { files: [sh] } });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/x\.sh/)));
  });

  it("laporan closed: tanpa tombol Lampirkan dan Hapus", () => {
    render(<QaAttachments {...props({ locked: true })} />);
    expect(screen.queryByText("Lampirkan")).toBeNull();
    expect(screen.queryByLabelText(/Hapus lampiran/)).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `pnpm vitest --run src/src/screens/qa/QaAttachments.test.tsx --no-file-parallelism` → FAIL.

- [ ] **Step 3: `QaAttachments.tsx`**

```tsx
import React from "react";
import type { QaOwnerType } from "@hanoman/shared";
import { Button } from "../../ds";
import { useApi } from "../../api/instance";
import type { PanelProps } from "./QaReportEditor";
import { errText, fmtSize } from "./qa-ui";

const MAX = 10 * 1024 * 1024;   // sama dengan QA_ATTACHMENT_LIMITS.fileBytes di server
const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.md,.txt,.log,.json,.csv";

type Props = PanelProps & { ownerType: QaOwnerType; ownerId: string; compact?: boolean };

export function QaAttachments({ detail, projectId, locked, onChange, onToast, ownerType, ownerId, compact }: Props) {
  const api = useApi();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const items = detail.attachments.filter((a) => a.ownerType === ownerType && a.ownerId === ownerId);

  const upload = async (files: File[]) => {
    if (locked || !files.length) return;
    const ok = files.filter((f) => {
      if (f.size > MAX) { onToast?.(`${f.name} melebihi batas 10 MB`); return false; }
      return true;
    });
    if (!ok.length) return;
    setBusy(true);
    try {
      const r = await api.uploadQaAttachments(projectId, detail.id, { ownerType, ownerId }, ok);
      if (r.rejected.length) onToast?.(`Ditolak: ${r.rejected.map((x) => `${x.filename} (${x.reason})`).join(", ")}`);
      onChange(await api.qaReport(projectId, detail.id));
    } catch (e) { onToast?.(errText(e)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const remove = async (id: string) => {
    try { await api.deleteQaAttachment(projectId, detail.id, id); onChange(await api.qaReport(projectId, detail.id)); }
    catch (e) { onToast?.(errText(e)); }
  };

  return (
    // Wadah dapat difokus supaya Ctrl/Cmd+V menempel screenshot langsung ke pemilik ini.
    <div tabIndex={locked ? -1 : 0} style={{ marginTop: compact ? 10 : 0, outline: "none" }}
      onPaste={(e) => { const fs = [...(e.clipboardData?.files ?? [])]; if (fs.length) { e.preventDefault(); void upload(fs); } }}
      onDragOver={(e) => { if (!locked) e.preventDefault(); }}
      onDrop={(e) => { if (locked) return; e.preventDefault(); void upload([...e.dataTransfer.files]); }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        {items.map((a) => {
          const url = api.qaAttachmentUrl(projectId, detail.id, a.id);
          return (
            <div key={a.id} style={{ display: "grid", gap: 4, maxWidth: 160 }}>
              {a.mimeType.startsWith("image/") ? (
                <a href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt={a.filename} loading="lazy"
                    style={{ height: compact ? 64 : 96, maxWidth: 160, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)" }} />
                </a>
              ) : (
                <a href={api.qaAttachmentUrl(projectId, detail.id, a.id, true)} style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{a.filename}</a>
              )}
              <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>
                {a.mimeType.startsWith("image/") ? a.filename + " · " : ""}{fmtSize(a.size)}
              </span>
              {!locked && (
                <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus lampiran ${a.filename}`} onClick={() => void remove(a.id)} />
              )}
            </div>
          );
        })}
        {!locked && (
          <>
            <Button size="sm" variant="secondary" leftIcon="paperclip" loading={busy} onClick={() => input.current?.click()}>Lampirkan</Button>
            <input ref={input} type="file" multiple accept={ACCEPT} hidden aria-label="Pilih lampiran"
              onChange={(e) => void upload([...(e.target.files ?? [])])} />
          </>
        )}
      </div>
      {!locked && !compact && (
        <p style={{ fontSize: 11.5, color: "var(--text-subtle)", margin: "8px 0 0" }}>
          Seret berkas ke sini atau tempel screenshot (Ctrl/Cmd+V). Maks 10 MB per berkas: png, jpg, webp, pdf, md, txt, log, json, csv.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `QaPreview.tsx`**

```tsx
import { renderQaMarkdown, type QaReportDetail } from "@hanoman/shared";
import { Button, MarkdownView } from "../../ds";
import { useApi } from "../../api/instance";

// Pratinjau baca-saja = dokumen Markdown yang SAMA dengan yang diekspor (satu renderer, bukan dua
// yang bisa berselisih), dengan tautan lampiran diarahkan ke URL penyajian server supaya gambar tampil.
export function QaPreview({ detail, projectId }: { detail: QaReportDetail; projectId: string }) {
  const api = useApi();
  const paths = Object.fromEntries(detail.attachments.map((a) => [a.id, api.qaAttachmentUrl(projectId, detail.id, a.id)]));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id)}>Unduh ZIP (laporan + lampiran)</Button>
        <Button variant="ghost" leftIcon="download" as="a" href={api.qaExportUrl(projectId, detail.id, "md")}>Unduh .md</Button>
      </div>
      <MarkdownView text={renderQaMarkdown(detail, paths)} name={`${detail.code}.md`} />
    </div>
  );
}
```

- [ ] **Step 5: Ikon** — ikon baru yang dipakai: `clipboard-check`, `plus`, `upload`, `download`, `trash-2`, `paperclip`, `bug`, `arrow-left`. Bangkitkan ulang registry dan periksa test-nya:

```bash
pnpm --filter ./src gen:icons
pnpm vitest --run src/src/ds/icon-registry.test.ts --no-file-parallelism
git diff --stat src/src/ds/icon-registry.ts
```
Expected: registry bertambah hanya ikon yang belum ada; test hijau. Bila nama ikon tak ada di lucide, pakai padanan (mis. `clipboard-list`) dan sesuaikan `shell.tsx` + `qa-nav.test.tsx`.

- [ ] **Step 6: Jalankan semua test UI QA + typecheck**

Run: `pnpm vitest --run src/src/screens/qa src/src/routes.test.ts src/test/qa-nav.test.tsx src/test/changelog-nav.test.tsx src/test/team-nav.test.tsx --no-file-parallelism && pnpm --filter ./src typecheck`
Expected: PASS.

- [ ] **Step 7: Periksa responsif nyata** (invarian test saja tak cukup — memori proyek: "invariant lulus tapi terpotong"). Jalankan dashboard + browser CDP sesuai memori `hanoman-browser-smoke-via-cdp`, buka `/qa/<projectId>` pada lebar **390, 768, 1280 px**: daftar laporan, editor (header, kartu test case, modal temuan), pratinjau. Tak boleh ada scroll horizontal halaman atau teks terpotong. Perbaiki gaya bila ada (hanya `minmax(min(100%, …))`/`flexWrap`).

- [ ] **Step 8: Commit**

```bash
git add src/src/screens/qa src/src/ds/icon-registry.ts
git commit -m "feat(qa): UI lampiran (unggah/seret/tempel) dan pratinjau Markdown

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Dokumentasi + verifikasi nyata

**Files:**
- Modify: `internal/docs/architecture/api-contract.md`, `internal/docs/README.md`, `internal/skills/hanoman/SKILL.md` (bila memuat daftar domain/tool)
- Create: panduan pemakai `internal/docs/<kategori>/qa-workspace.md` (lihat `ls internal/docs`; letakkan di direktori panduan fitur yang sudah ada), mis. cara mengisi, severity vs prioritas, template, ekspor/impor

- [ ] **Step 1: Dokumen**
  - `api-contract.md`: tabel endpoint QA (Task 4/5/7), kode galat 400/404/409/413, capability `qa:read|write`, catatan "local-only (tak masuk changefeed)".
  - Panduan pemakai: alur (buat laporan → isi test case → catat temuan + lampiran → Submit dengan keputusan → ekspor ZIP), definisi severity vs prioritas (tabel), format Markdown/ZIP dan cara mengimpor template, batas lampiran, perilaku upsert impor, catatan "nomor bisa bergeser setelah sync, ekspor membekukannya".
  - Tautkan semua doc baru di `internal/docs/README.md` (`pnpm exec hanoman docs link <path> --category <kategori>` lalu `pnpm exec hanoman docs index --check`).
  - Daftar tool MCP: perbarui bila `internal/skills/hanoman/SKILL.md`/doc lain mendaftar domain tool (hasil grep Task 8 Step 5).

- [ ] **Step 2: Test tersentuh, serial, DB terisolasi**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
pnpm --filter ./server typecheck && pnpm --filter ./shared typecheck && pnpm --filter ./src typecheck
```
(`HANOMAN_BASE_SHA` = SHA basis worktree; bila tak terpasang, `git merge-base HEAD origin/main`.) Expected: hijau. Jebakan `--changed`: nol test terlihat hijau — pastikan daftar yang berjalan memuat berkas `qa-*` / `zip` / `mcp-*`. Kegagalan 404/P2022 ramai = isolasi DB (lihat AGENTS.md), bukan regresi.

- [ ] **Step 3: Uji API nyata di local** (CLAUDE.md: sekali di akhir, tiap task yang menyentuh endpoint) — DB khusus, bukan DB operasional:

```bash
SMOKE="$(mktemp -d)"
export DATABASE_URL="file:$SMOKE/smoke.db" HANOMAN_DATABASE_URL="file:$SMOKE/smoke.db"
(cd server && pnpm exec prisma migrate deploy)
(cd server && pnpm exec node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.project.create({data:{id:'smoke',name:'Smoke',desc:'',kind:'existing'}}).then(()=>p.\$disconnect())")
pnpm dev   # di terminal lain; catat port dari lognya
```
Lalu skrip `urllib` (JANGAN `curl | jq`: memori `rtk-curl-merusak-json-pipe`) — simpan di scratchpad dan jalankan:

```python
import json, urllib.request as u, uuid
B = "http://127.0.0.1:PORT/api"          # ganti PORT
def call(m, p, body=None, raw=None, ct="application/json"):
    req = u.Request(B + p, method=m, data=raw if raw is not None else (json.dumps(body).encode() if body is not None else None))
    if raw is not None or body is not None: req.add_header("content-type", ct)
    try:
        r = u.urlopen(req); return r.status, r.read(), r.headers
    except Exception as e:
        return e.code, e.read(), e.headers
J = lambda t: json.loads(t[1])
s, b, _ = call("POST", "/projects/smoke/qa/reports", {"title": "Smoke nyata", "environment": {"os": "macOS"}}); rep = json.loads(b); rid = rep["id"]; print(s, rep["code"])
c = J(call("POST", f"/projects/smoke/qa/reports/{rid}/cases", {"title": "Login", "status": "fail"}))["cases"][0]
f = J(call("POST", f"/projects/smoke/qa/reports/{rid}/findings", {"title": "Tombol mati", "caseId": c["id"], "steps": ["buka", "klik"]}))["findings"][0]
png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108040000007fa8f25000000000b4944415478da63f80f00010501012718e3660000000049454e44ae426082")
bd = uuid.uuid4().hex
body = (f"--{bd}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"layar.png\"\r\nContent-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{bd}--\r\n".encode()
print(call("POST", f"/projects/smoke/qa/reports/{rid}/attachments?ownerType=finding&ownerId={f['id']}", raw=body, ct=f"multipart/form-data; boundary={bd}")[0])
s, zip_, h = call("GET", f"/projects/smoke/qa/reports/{rid}/export"); print(s, h["content-type"], len(zip_)); open("qa-smoke.zip", "wb").write(zip_)
print(call("GET", "/qa/template.md")[0])
```
Verifikasi manual: `unzip -l qa-smoke.zip` (harus `report.md` + `attachments/F-01-1-layar.png`); `unzip -p qa-smoke.zip report.md` terbaca rapi; impor ZIP itu kembali lewat dashboard (tombol **Impor**) ke project lain dan pastikan test case/temuan/lampiran utuh. Bunuh server per-PID (`lsof -ti:PORT` → `kill <pid>`), JANGAN `pkill -f`.

- [ ] **Step 4: Centang checklist plan ini + commit docs**

```bash
git add internal docs/superpowers/plans
git commit -m "docs(qa): kontrak API, panduan pemakai, dan tautan index workspace QA

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (spec → task)

| Bagian spec | Task |
|---|---|
| §1 Data (QaReport/Case/Finding/Attachment, version, nomor dihitung saat render) | 1 (`assignCodes`), 3 (skema), 4 (view) |
| §1 Lampiran: pipeline, 10 MB, kuota, sanitasi, traversal | 5 (service + route) |
| §2 CRUD + sub-resource, 400/404/409/413, closed read-only | 4, 5, 7 |
| §2 Ekspor ZIP / impor / template | 6 (format), 7 (I/O) |
| §2 Capability `qa:*` + tool MCP | 2, 8 |
| §3 UI daftar/editor/pratinjau, paste/drag-drop, responsif | 9, 10, 11 |
| §4 Template & ekspor Markdown (front-matter, blok temuan, ZIP relatif, impor round-trip, galat berbaris) | 6, 7 |
| §5 Pengujian + docs + uji nyata | tiap task (TDD), 12 |
| Dikeluarkan: sync, kirim-ke-backlog, docx/xlsx/PDF | bagian 2–4 — kolom `version`, `backlogId`, `syncState`, `sha256` sudah disiapkan |

Penyimpangan yang dicatat: `QaAttachment.reportId` (FK cascade) ditambahkan ke skema spec; `submitted/closed` mensyaratkan `verdict`; impor ZIP boleh hingga 105 MB.
