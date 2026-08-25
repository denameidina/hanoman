# MCP Rencana 4 — Katalog domain `sessions`, `backlog`, `projects`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 34 tool baru — 15 di `sessions`, 11 di `backlog`, 8 di `projects` — sehingga agen bisa menjalankan dan mengendalikan sesi, menuntaskan siklus hidup backlog, dan mengelola project lewat MCP.

**Architecture:** Tiga berkas katalog. `sessions.ts`, `backlog.ts`, dan `projects.ts` sudah ada sejak Rencana 2 (memuat 9 tool lama); rencana ini **menambah** entri ke ketiganya, bukan membuat berkas baru. Tool paling tajam di seluruh proyek ada di sini: `hanoman_session_create` menuntut `sessions:spawn`, satu-satunya capability yang ditandai `risk: "rce"`.

**Tech Stack:** TypeScript strict, JSON Schema polos, vitest.

## Global Constraints

- Rencana 1, 2, 3 **wajib selesai**.
- **Skema parameter diturunkan dari handler.** Tabel di bawah menyebut `berkas:baris`. Baca handler, jangan menebak.
- `hanoman_session_create` **wajib** memuat kalimat "menjalankan agen dengan izin penuh di worktree" di deskripsinya. Agen yang memanggilnya harus tahu apa yang ia mulai.
- `hanoman_backlog_stage_set` memanggil `PATCH /specs/:id` dengan `{stage}` — gerbangnya ada di **handler** (Rencana 1 Task 3), bukan di `capabilityForRoute`. `samplePath`-nya karena itu memetakan ke `backlog:write`, bukan `backlog:lifecycle`; assert kedua `mcp-coverage.test.ts` akan menuntutnya demikian. Ini **benar** dan harus diberi komentar di katalog agar tak "diperbaiki" seseorang kelak.
- `MCP_TOOL_SCHEMA_VERSION` tetap 1.

---

## File Structure

- Modify: `shared/src/mcp-catalog/sessions.ts` (+15), `backlog.ts` (+11), `projects.ts` (+8)
- Modify: `shared/src/mcp-catalog.test.ts` (`DESTRUCTIVE_BUT_WRITE`)
- Test: `shared/src/mcp-catalog.sessions.test.ts`, `.backlog.test.ts`, `.projects.test.ts`

---

### Task 1: `backlog.ts` — 11 tool baru (total 17)

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_backlog_batch_create` | POST `/specs/batch` | `specs.ts:151` | write | `backlog:write` |
| `hanoman_backlog_source_set` | POST `/specs/:id/source` | `specs.ts:254` | write | `backlog:write` |
| `hanoman_backlog_mark_done` | POST `/specs/:id/done` | `specs.ts:323` | write | `backlog:write` |
| `hanoman_backlog_attachments_list` | GET `/specs/:id/attachments` | `specs.ts:348` | read | `backlog:read` |
| `hanoman_backlog_attachment_read` | GET `/specs/:id/attachments/:attId` | `specs.ts:385` | read | `backlog:read` |
| `hanoman_backlog_attachment_delete` | DELETE `/specs/:id/attachments/:attId` | `specs.ts:398` | write | `backlog:write` |
| `hanoman_backlog_escalation_get` | GET `/specs/:id/escalation` | `specs.ts:428` | read | `backlog:read` |
| `hanoman_backlog_review` | GET `/specs/:id/review` (+`/review/*` bila `path` diisi) | `specs.ts:521`, `:533` | read | `backlog:read` |
| `hanoman_backlog_delete` | DELETE `/specs/:id` | `specs.ts:435` | **danger** | `backlog:lifecycle` |
| `hanoman_backlog_integrate` | POST `/specs/:id/integrate` | `specs.ts:464` | **danger** | `backlog:lifecycle` |
| `hanoman_backlog_stage_set` | PATCH `/specs/:id` `{stage}` | `specs.ts:191` | **danger** | `backlog:write` ⚠ |

⚠ Lihat Global Constraints: capability-nya `backlog:write` **dengan sengaja**, karena gerbang `backlog:lifecycle`-nya hidup di handler.

**Tidak dibungkus:** `POST /specs/:id/attachments` (`specs.ts:357`) — multipart, sudah di `UNWRAPPED`.

- [ ] **Step 1: Baca handler**

```bash
sed -n '151,200p' server/src/routes/specs.ts
sed -n '254,270p;323,345p;348,410p;428,480p;521,545p' server/src/routes/specs.ts
```

- [ ] **Step 2: Tulis test yang gagal**

`shared/src/mcp-catalog.backlog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BACKLOG_TOOLS } from "./mcp-catalog/backlog";

const by = (n: string) => BACKLOG_TOOLS.find((t) => t.name === n)!;

describe("katalog backlog", () => {
  it("17 tool, tiga bermode danger", () => {
    expect(BACKLOG_TOOLS).toHaveLength(17);
    expect(BACKLOG_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name).sort())
      .toEqual(["hanoman_backlog_delete", "hanoman_backlog_integrate", "hanoman_backlog_stage_set"]);
  });

  it("delete & integrate menuntut backlog:lifecycle", () => {
    expect(by("hanoman_backlog_delete").capability).toBe("backlog:lifecycle");
    expect(by("hanoman_backlog_integrate").capability).toBe("backlog:lifecycle");
  });

  it("stage_set menuntut backlog:write di katalog — gerbang lifecycle-nya ada di handler", () => {
    expect(by("hanoman_backlog_stage_set").capability).toBe("backlog:write");
    expect(by("hanoman_backlog_stage_set").description).toMatch(/backlog:lifecycle/);
  });

  it("backlog_update TETAP tak punya stage — memisahkannya adalah inti rencana ini", () => {
    expect(by("hanoman_backlog_update").inputSchema.properties.stage).toBeUndefined();
  });

  it("review memilih /review/* hanya saat path diisi", () => {
    expect(by("hanoman_backlog_review").build({ spec: "SPEC-1" })?.path).toBe("/specs/SPEC-1/review");
    expect(by("hanoman_backlog_review").build({ spec: "SPEC-1", path: "a/b.ts" })?.path)
      .toBe("/specs/SPEC-1/review/a/b.ts");
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/mcp-catalog.backlog.test.ts`
Expected: FAIL — masih 6 tool.

- [ ] **Step 4: Tambahkan sebelas entri**

Entri `stage_set` **wajib** membawa komentar ini tepat di atasnya:

```ts
  // ADR-0155 · capability-nya `backlog:write`, BUKAN `backlog:lifecycle`, dan itu BENAR:
  // `capabilityForRoute` memetakan PATCH /specs/:id ke `backlog:write` dan sengaja tak pernah
  // melihat body. Gerbang `backlog:lifecycle` untuk `{stage}` hidup di handler (routes/specs.ts).
  // Menaikkan nilai di sini akan MEMBUAT uji kontrak `mcp-coverage.test.ts` merah, bukan
  // memperbaiki keamanan. Deskripsinya yang memberitahu agen capability apa yang sebenarnya
  // dituntut server.
  {
    name: "hanoman_backlog_stage_set",
    title: "Geser stage backlog (BERBAHAYA)",
    description:
      "BERBAHAYA — menggeser stage backlog menghapus artefak dokumen tahap sebelumnya. Server menuntut capability `backlog:lifecycle` untuk operasi ini meskipun route-nya sama dengan hanoman_backlog_update; token yang hanya punya `backlog:write` akan menerima 403 yang menyebutnya. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        stage: enumStr(STAGE_ENUM, "Stage tujuan. Menggeser mundur menghapus artefak tahap yang dilewati."),
      },
      required: ["spec", "stage"],
    }),
    mode: "danger",
    capability: "backlog:write",
    samplePath: "/specs/SPEC-1",
    sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: `/specs/${enc(String(a.spec))}`, body: { stage: a.stage } }),
    shape: (raw) => raw,
  },
```

Sepuluh entri lain mengikuti pola yang sama; isi `inputSchema` dari Step 1.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/mcp-catalog.backlog.test.ts shared/src/mcp-catalog.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog/backlog.ts shared/src/mcp-catalog.backlog.test.ts
git commit -m "feat(mcp): 11 tool backlog termasuk siklus hidup di balik --danger"
```

---

### Task 2: `projects.ts` — 8 tool baru (total 10)

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_project_create` | POST `/projects` | `projects.ts:48` | write | `projects:write` |
| `hanoman_project_update` | PATCH `/projects/:id` | `projects.ts:79` | write | `projects:write` |
| `hanoman_project_branches` | GET `/projects/:id/branches` | `projects.ts:137` | read | `projects:read` |
| `hanoman_help_center_get` | GET `/projects/:id/help-center` | `projects.ts:152` | read | `projects:read` |
| `hanoman_help_center_set` | POST `/projects/:id/help-center` | `projects.ts:159` | write | `projects:write` |
| `hanoman_help_center_delete` | DELETE `/projects/:id/help-center` | `projects.ts:168` | write | `projects:write` |
| `hanoman_project_rename` | POST `/projects/:id/rename` | `projects.ts:106` | **danger** | `projects:write` |
| `hanoman_project_delete` | DELETE `/projects/:id` | `projects.ts:121` | **danger** | `projects:write` |

Dua tool `danger` di sini bercapability `:write` — keduanya masuk `DESTRUCTIVE_BUT_WRITE` (Task 4).

**`hanoman_project_rename` layak `danger` meski hanya mengganti nama:** `Project.id` adalah kunci yang menyeberang sync antar-instance. Deskripsinya wajib menyebut itu.

- [ ] **Step 1: Baca handler**

```bash
sed -n '42,180p' server/src/routes/projects.ts
```

- [ ] **Step 2: Tulis test yang gagal**

```ts
describe("katalog projects", () => {
  it("10 tool, dua bermode danger", () => {
    expect(PROJECTS_TOOLS).toHaveLength(10);
    expect(PROJECTS_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name).sort())
      .toEqual(["hanoman_project_delete", "hanoman_project_rename"]);
  });

  it("rename menyebut akibat lintas-sync di deskripsinya", () => {
    expect(PROJECTS_TOOLS.find((t) => t.name === "hanoman_project_rename")!.description)
      .toMatch(/sync/i);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL** — Run: `pnpm vitest --run shared/src/mcp-catalog.projects.test.ts`

- [ ] **Step 4: Tambahkan delapan entri.** Deskripsi `rename`:

```ts
    description:
      "BERBAHAYA — mengganti id project. Id project adalah kunci yang menyeberang sync antar-instance hanoman: instance lain yang belum melihat rename akan memperlakukan project ini sebagai project BARU, dan riwayat sync-nya tak menyatu kembali sendiri. Hanya muncul saat tingkat `--danger` menyala.",
```

- [ ] **Step 5: Jalankan test, pastikan LULUS** — Run: `pnpm vitest --run shared/src/mcp-catalog.projects.test.ts shared/src/mcp-catalog.test.ts`

- [ ] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog/projects.ts shared/src/mcp-catalog.projects.test.ts
git commit -m "feat(mcp): 8 tool projects termasuk rename & delete di balik --danger"
```

---

### Task 3: `sessions.ts` — 15 tool baru (total 16)

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_session_phases` | GET `/terminal/sessions/:id/phases` | `terminal.ts:326` | read | `sessions:read` |
| `hanoman_session_dialog_get` | GET `/terminal/sessions/:id/dialog` | `terminal.ts:356` | read | `sessions:read` |
| `hanoman_session_review` | GET `/terminal/sessions/:id/review` (+`/review/*` bila `path`) | `terminal.ts:424`, `:429` | read | `sessions:read` |
| `hanoman_session_cleanups` | GET `/terminal/cleanups` | `terminal.ts:478` | read | `sessions:read` |
| `hanoman_session_history_list` | GET `/terminal/history` | `session-history.ts:8` | read | `sessions:read` |
| `hanoman_session_history_get` | GET `/terminal/history/:id` | `session-history.ts:15` | read | `sessions:read` |
| `hanoman_session_history_transcript` | GET `/terminal/history/:id/transcript` | `session-history.ts:20` | read | `sessions:read` |
| `hanoman_session_steer` | POST `/terminal/sessions/:id/steer` | `terminal.ts:336` | write | `sessions:write` |
| `hanoman_session_interrupt` | POST `/terminal/sessions/:id/interrupt` | `terminal.ts:344` | write | `sessions:write` |
| `hanoman_session_dialog_answer` | POST `/terminal/sessions/:id/dialog/answer` | `terminal.ts:366` | write | `sessions:write` |
| `hanoman_session_dialog_takeover` | POST `/terminal/sessions/:id/dialog/takeover` | `terminal.ts:400` | write | `sessions:write` |
| `hanoman_session_create` | POST `/terminal/sessions` | `terminal.ts:80` | **danger** | `sessions:spawn` |
| `hanoman_session_integrate` | POST `/terminal/sessions/:id/integrate` | `terminal.ts:444` | **danger** | `sessions:write` |
| `hanoman_session_delete` | DELETE `/terminal/sessions/:id` | `terminal.ts:482` | **danger** | `sessions:write` |
| `hanoman_session_history_clear` | DELETE `/terminal/history` | `session-history.ts:27` | **danger** | `sessions:write` |

**Tidak dibungkus:** `POST /terminal/sessions/:id/attachments` (`terminal.ts:490`, multipart) dan `GET /terminal/sessions/:id/ws` (`terminal.ts:508`, WebSocket) — keduanya sudah di `UNWRAPPED`.

- [ ] **Step 1: Baca handler**

```bash
sed -n '78,120p;326,500p' server/src/routes/terminal.ts
sed -n '1,40p' server/src/routes/session-history.ts
```

Perhatikan khusus body `POST /terminal/sessions` (`terminal.ts:80`): ia menentukan project, backlog, runtime, model, dan effort. Setiap parameter itu harus muncul di `inputSchema` dengan deskripsi yang menyebut nilainya yang sah — jangan mengandalkan default senyap.

- [ ] **Step 2: Tulis test yang gagal**

```ts
describe("katalog sessions", () => {
  it("16 tool, empat bermode danger", () => {
    expect(SESSIONS_TOOLS).toHaveLength(16);
    expect(SESSIONS_TOOLS.filter((t) => t.mode === "danger")).toHaveLength(4);
  });

  it("HANYA session_create yang menuntut sessions:spawn", () => {
    const spawn = SESSIONS_TOOLS.filter((t) => t.capability === "sessions:spawn");
    expect(spawn.map((t) => t.name)).toEqual(["hanoman_session_create"]);
  });

  it("mengendalikan sesi yang ada TIDAK menuntut spawn", () => {
    for (const n of ["hanoman_session_steer", "hanoman_session_interrupt", "hanoman_session_dialog_answer"])
      expect(SESSIONS_TOOLS.find((t) => t.name === n)!.capability, n).toBe("sessions:write");
  });

  it("session_create menyebut izin penuh di worktree", () => {
    expect(SESSIONS_TOOLS.find((t) => t.name === "hanoman_session_create")!.description)
      .toMatch(/izin penuh di worktree/i);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL** — Run: `pnpm vitest --run shared/src/mcp-catalog.sessions.test.ts`

- [ ] **Step 4: Tambahkan lima belas entri.** Deskripsi `session_create`:

```ts
    description:
      "BERBAHAYA — membuka sesi agen BARU: hanoman menjalankan claude/codex dengan izin penuh di worktree project, dan sesi itu bisa menulis berkas, menjalankan perintah, serta membuat commit tanpa manusia di pane. Menuntut capability `sessions:spawn`; `sessions:write` (yang cukup untuk mengendalikan sesi yang SUDAH ada) tidak cukup. Hanya muncul saat tingkat `--danger` menyala. Pakai hanoman_sessions_list untuk melihat sesi yang sudah berjalan sebelum membuka yang baru.",
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/mcp-catalog.sessions.test.ts shared/src/mcp-catalog.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog/sessions.ts shared/src/mcp-catalog.sessions.test.ts
git commit -m "feat(mcp): 15 tool sessions termasuk session_create di balik sessions:spawn"
```

---

### Task 4: Daftar-kecuali & bukti ujung-ke-ujung

- [ ] **Step 1: Tambahkan enam nama ke `DESTRUCTIVE_BUT_WRITE`**

```ts
  "hanoman_project_delete", "hanoman_project_rename",
  "hanoman_session_integrate", "hanoman_session_delete", "hanoman_session_history_clear",
  "hanoman_backlog_stage_set",   // gerbang lifecycle-nya di handler, bukan capabilityForRoute
```

- [ ] **Step 2: Jalankan test, pastikan LULUS** — Run: `pnpm vitest --run shared/src/mcp-catalog.test.ts`

- [ ] **Step 3: Buktikan `sessions:spawn` menahan, dengan server hidup**

```bash
pnpm dev   # terminal lain
pnpm -F hanoman build
# token ber-`sessions:write` TANPA `sessions:spawn`:
HANOMAN_MCP_DANGER=1 HANOMAN_HOST=http://localhost:8787 HANOMAN_AGENT_TOKEN=hnm_agt_… \
  node cli/dist/hanoman.js mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hanoman_session_create","arguments":{"project":"hanoman"}}}'
```
Expected: `isError: true`, pesan menyebut `sessions:spawn`. **Tak boleh ada sesi tmux baru yang lahir** — periksa dengan `tmux ls`.

Lalu ulangi dengan token yang punya `sessions:spawn`: sesi lahir. Tutup lagi dengan `hanoman_session_delete`.

- [ ] **Step 4: Commit**

```bash
git add shared/src/mcp-catalog.test.ts docs/superpowers/plans/2026-08-25-mcp-4-katalog-sessions-backlog-projects.md
git commit -m "test(mcp): daftar destruktif sessions/backlog/projects + bukti gerbang spawn"
```
