# SPEC-947 — Eskalasi kartu tim ke backlog · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kartu papan tim bisa dieskalasi jadi backlog item hanoman (`POST /api/tasks/:id/escalate`) dan dilepas lagi (`DELETE`), lewat dialog di kartu yang meminta source + prioritas + project bila perlu.

**Architecture:** Operasi khusus di samping CRUD `Task`, sejajar `acceptTicket()`/`acceptGithubIssue()`. Inti di `server/src/services/task-escalate.ts` (dipisah dari route supaya jalur non-HTTP bisa memakainya nanti), route tipis di `routes/tasks.ts`, kontrak murni di `shared/src/team.ts`. **Nol migration** — `Task.specId` sudah ada sejak SPEC-945; cermin stage `spec: { id, stage, priority }` sudah dihitung `buildTasksPage` dan sudah dirender `team-board.tsx`. Yang ditambah hanya jalur yang MENGISI kolom itu, plus aksinya di UI.

**Tech Stack:** TypeScript strict · Fastify + Prisma 6 (SQLite) · zod di `shared/` · React 18 + Vite · vitest (+ @testing-library/react untuk jsdom).

Spec: [`docs/superpowers/specs/2026-08-25-spec-947-eskalasi-kartu-tim-design.md`](../specs/2026-08-25-spec-947-eskalasi-kartu-tim-design.md)

## Global Constraints

- **Nol perubahan schema Prisma, nol migration.** `Task.specId`, `Spec.*` dipakai apa adanya.
- **Nol pendaftaran sync baru.** `member`/`task` sudah di `SYNCED` + `FIELDS` sejak ADR-0150.
- **Nol entri `capabilityForRoute` / `clientRouteAllowed`.** Keduanya deny-by-default; route `/tasks` sudah tertutup untuk agent token dan role `client` (ADR-0065 · ADR-0110). Menambahkannya justru MEMBUKA.
- **`specId` tetap absen dari `zCreateTask`/`zPatchTask`** (ADR-0150 keputusan 5). Jangan tergoda menambahkannya.
- **Stage tak pernah ditulis balik ke `Task`** (ADR-0150 keputusan 4).
- **Teks kartu TANPA penanda `UNTRUSTED_*`** — kartu ditulis anggota tim di dashboard ber-auth.
- **`prisma.spec.create` wajib dibungkus retry `P2002` ≤3×** di sekitar `nextSpecId` (SPEC-197). Ini call site kelima; empat lainnya sudah begitu.
- **Bahasa komentar & pesan galat: Indonesia**, mengikuti berkas di sekitarnya.
- Menjalankan test: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>` untuk test server (satu berkas DB dibagi semua worktree; tanpa ini run tetangga menghapusnya di tengah run — SPEC-479).

---

### Task 1: Kontrak murni `zEscalateTask`

**Files:**
- Modify: `shared/src/team.ts` (append, sesudah `PatchTaskInput`)
- Modify: `shared/src/api.ts:218` (sesudah `task:`)
- Test: `shared/src/team.test.ts` (append)

**Interfaces:**
- Consumes: `zPriority` dari `./enums` (sudah diimpor di `team.ts`)
- Produces: `ESCALATE_SOURCES`, `EscalateSource`, `zEscalateTask`, `EscalateTask`, `EscalateTaskInput`, `paths.taskEscalate(id)`

- [x] **Step 1: Tulis test yang gagal**

Append ke `shared/src/team.test.ts` (impor `zEscalateTask` di baris impor teratas berkas itu):

```ts
describe("zEscalateTask", () => {
  it("default brief + sedang; body kosong sah", () => {
    const r = zEscalateTask.safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ source: "brief", priority: "sedang" });
  });

  // Enum EKSPLISIT tiga: `goal`/`no_effort` butuh bentuk payload `goal` (goal + done) yang hanya
  // operator bisa tulis, dan `help` menjanjikan asal-usul Help Center yang bukan ini.
  it("menolak source di luar tiga", () => {
    for (const s of ["goal", "no_effort", "help", "apa saja"])
      expect(zEscalateTask.safeParse({ source: s }).success).toBe(false);
  });

  it("menerima ketiga source yang sah", () => {
    for (const s of ["brief", "qa", "audit"])
      expect(zEscalateTask.safeParse({ source: s }).success).toBe(true);
  });

  it("menolak prioritas di luar kosakata zPriority", () => {
    expect(zEscalateTask.safeParse({ priority: "normal" }).success).toBe(false);
  });

  it("projectId opsional", () => {
    expect(zEscalateTask.safeParse({ projectId: "hanoman" }).success).toBe(true);
    expect(zEscalateTask.safeParse({}).success).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/team.test.ts`
Expected: FAIL — `zEscalateTask is not exported` / import error.

- [x] **Step 3: Implementasi minimal**

Append ke `shared/src/team.ts`:

```ts
/**
 * SPEC-947 · tiga dari enam `zSpecSource`. `goal`/`no_effort` memakai bentuk payload `goal` yang
 * mewajibkan `goal` + `done` — dua kalimat yang hanya operator bisa tulis, dan menurunkannya dari
 * judul kartu berarti mengarang. `help` milik tiket Help Center dan lencananya menjanjikan
 * asal-usul yang bukan ini.
 *
 * Enum EKSPLISIT, bukan `zSpecSource` yang disaring belakangan: source ketujuh yang kelak
 * ditambahkan tak boleh diam-diam menjadi tujuan eskalasi.
 */
export const ESCALATE_SOURCES = ["brief", "qa", "audit"] as const;
export type EscalateSource = (typeof ESCALATE_SOURCES)[number];

export const zEscalateTask = z.object({
  source: z.enum(ESCALATE_SOURCES).default("brief"),
  priority: zPriority.default("sedang"),
  // Dipakai HANYA saat kartunya belum punya project (`nextSpecId` butuh repo, dan repo milik
  // project). Route menolak 400 bila ia menyebut project LAIN — kartu tak boleh berpindah project
  // sebagai efek samping yang tak diminta.
  projectId: z.string().max(120).optional(),
});
export type EscalateTask = z.infer<typeof zEscalateTask>;
export type EscalateTaskInput = z.input<typeof zEscalateTask>;
```

Tambahkan di `shared/src/api.ts`, tepat sesudah baris `task: (id: string) => …`:

```ts
  // SPEC-947 · eskalasi kartu → backlog. POST membuat Spec & mengisi specId; DELETE melepasnya.
  taskEscalate: (id: string) => `${API}/tasks/${encodeURIComponent(id)}/escalate`,
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/src/team.test.ts`
Expected: PASS (semua `describe` di berkas itu hijau, termasuk lima kasus baru).

- [x] **Step 5: Commit**

```bash
git add shared/src/team.ts shared/src/api.ts shared/src/team.test.ts
git commit -m "feat(947): kontrak zEscalateTask + path escalate"
```

---

### Task 2: `POST /api/tasks/:id/escalate`

**Files:**
- Create: `server/src/services/task-escalate.ts`
- Modify: `server/src/routes/tasks.ts` (impor + satu route baru di akhir `export default`)
- Test: `server/test/tasks-escalate.route.test.ts` (baru)

**Interfaces:**
- Consumes: `zEscalateTask`, `EscalateSource` (Task 1) · `taskView` dari `../services/tasks-list` · `nextSpecId` dari `./id` · `resolveRepoDir` dari `./local-binding` · `notifySynced` dari `./sync-notify` · `launchPrincipal` dari `../services/launch-authority` · `severityFromPriority`, `payloadShapeFor` dari `@hanoman/shared`
- Produces: `escalateTask(task, opts) => Promise<{ spec: Spec; task: Task; created: boolean }>` dengan `opts: { projectId: string; source: EscalateSource; priority: Priority; author: string; launchApprovedBy?: string | null }`

- [x] **Step 1: Tulis test yang gagal**

Create `server/test/tasks-escalate.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { payloadMatchesSource } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject } from "./factory";

const app = buildApp({ requireAuth: false });

const makeTask = (over: Record<string, unknown> = {}) =>
  prisma.task.create({ data: {
    id: "t1", title: "Perbaiki halaman harga", detail: "Harga paket pro salah di mobile",
    status: "doing", priority: "tinggi", projectId: "p1", ...over } });

const escalate = (id: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: `/api/tasks/${id}/escalate`, payload });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeProject({ id: "p2" });
  await prisma.member.create({ data: { id: "a@x.id", name: "Adi", email: "a@x.id" } });
});

describe("POST /tasks/:id/escalate", () => {
  it("membuat Spec dari kartu dan mengisi task.specId", async () => {
    await makeTask();
    const res = await escalate("t1", { source: "brief", priority: "tinggi" });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.created).toBe(true);
    expect(b.spec.id).toMatch(/^SPEC-\d+$/);
    expect(b.spec).toMatchObject({
      projectId: "p1", title: "Perbaiki halaman harga",
      source: "brief", stage: "brainstorming", priority: "tinggi",
    });
    expect(b.task.specId).toBe(b.spec.id);
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.specId).toBe(b.spec.id);
  });

  // Cermin stage dihitung saat baca (ADR-0150 keputusan 4) — jawaban POST sudah membawanya.
  it("mengembalikan TaskView dengan cermin stage terisi", async () => {
    await makeTask();
    const b = (await escalate("t1")).json();
    expect(b.task.spec).toMatchObject({ id: b.spec.id, stage: "brainstorming" });
  });

  it("idempoten: panggilan kedua 200 created:false, Spec tak bertambah", async () => {
    await makeTask();
    const first = (await escalate("t1")).json();
    const res = await escalate("t1", { source: "qa" });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
    expect(res.json().spec.id).toBe(first.spec.id);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("menolak 400 kartu tanpa project, menyebut sebabnya", async () => {
    await makeTask({ projectId: null });
    const res = await escalate("t1");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/project/i);
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.specId).toBeNull();
  });

  it("kartu tanpa project + projectId di body: Spec lahir DAN kartu ikut pindah", async () => {
    await makeTask({ projectId: null });
    const res = await escalate("t1", { projectId: "p2" });
    expect(res.statusCode).toBe(201);
    expect(res.json().spec.projectId).toBe("p2");
    expect(res.json().task.projectId).toBe("p2");
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.projectId).toBe("p2");
  });

  it("menolak 400 bila body menyebut project LAIN dari milik kartu", async () => {
    await makeTask();
    const res = await escalate("t1", { projectId: "p2" });
    expect(res.statusCode).toBe(400);
    expect(res.json().projectId).toBe("p1");
    expect(await prisma.spec.count()).toBe(0);
  });

  it("menerima body yang menyebut project yang SAMA", async () => {
    await makeTask();
    expect((await escalate("t1", { projectId: "p1" })).statusCode).toBe(201);
  });

  it("menolak 400 projectId yang tak ada, menyebut nilainya", async () => {
    await makeTask({ projectId: null });
    const res = await escalate("t1", { projectId: "hantu" });
    expect(res.statusCode).toBe(400);
    expect(res.json().projectId).toBe("hantu");
  });

  it("menolak 400 source di luar tiga", async () => {
    await makeTask();
    expect((await escalate("t1", { source: "goal" })).statusCode).toBe(400);
  });

  it("404 untuk kartu yang tak ada", async () => {
    expect((await escalate("hantu")).statusCode).toBe(404);
  });
});

// Bentuk payload WAJIB cocok source: `zCreateSpec.superRefine` menuntutnya (SPEC-197/546), dan
// baris ini akan lewat `zSpec`/`zPatchSpec`/validasi sync kelak.
describe("POST /tasks/:id/escalate · bentuk payload", () => {
  it("brief & audit memakai bentuk brief, lengkap dengan priority", async () => {
    for (const source of ["brief", "audit"]) {
      await prisma.task.deleteMany({});
      await prisma.spec.deleteMany({});
      await makeTask();
      const spec = (await escalate("t1", { source, priority: "rendah" })).json().spec;
      expect(payloadMatchesSource(source, spec.payload)).toBe(true);
      expect(spec.payload.priority).toBe("rendah");
      expect(spec.payload.context).toContain("Harga paket pro salah di mobile");
    }
  });

  it("qa memakai bentuk qa, severity DITURUNKAN dari prioritas", async () => {
    await makeTask();
    const spec = (await escalate("t1", { source: "qa", priority: "rendah" })).json().spec;
    expect(payloadMatchesSource("qa", spec.payload)).toBe(true);
    expect(spec.payload.severity).toBe("minor");
    expect(spec.payload.actual).toContain("Harga paket pro salah di mobile");
  });

  it("severity major untuk prioritas tinggi", async () => {
    await makeTask();
    const spec = (await escalate("t1", { source: "qa", priority: "tinggi" })).json().spec;
    expect(spec.payload.severity).toBe("major");
  });

  // Pembungkus UNTRUSTED ada karena tiket datang dari PUBLIK. Kartu tim ditulis anggota tim di
  // dashboard ber-auth; memperlakukannya sebagai racun melatih agen mengabaikan konteks yang
  // justru sengaja diberikan.
  it("TIDAK membungkus teks kartu dengan penanda untrusted", async () => {
    await makeTask();
    const spec = (await escalate("t1")).json().spec;
    expect(JSON.stringify(spec.payload)).not.toContain("UNTRUSTED");
  });

  it("membawa konteks kartu yang tak dipunyai Spec: kolom, assignee, jadwal", async () => {
    await makeTask({ memberId: "a@x.id", dueDate: new Date("2026-09-08T00:00:00.000Z") });
    const spec = (await escalate("t1")).json().spec;
    expect(spec.payload.context).toContain("Adi");
    expect(spec.payload.context).toContain("doing");
    expect(spec.payload.context).toContain("2026-09-08");
  });

  it("mengisi launchApprovedBy dari operator (SPEC-761)", async () => {
    await makeTask();
    const id = (await escalate("t1")).json().spec.id;
    const spec = await prisma.spec.findUnique({ where: { id } });
    expect(spec!.launchApprovedBy).not.toBeNull();
    expect(spec!.launchApprovedAt).not.toBeNull();
  });

  it("mencatat version-stamp sync untuk spec DAN task", async () => {
    await makeTask();
    const id = (await escalate("t1")).json().spec.id;
    expect(await prisma.syncLog.findFirst({ where: { entity: "spec", recordId: id } })).not.toBeNull();
    expect(await prisma.syncLog.findFirst({ where: { entity: "task", recordId: "t1" } })).not.toBeNull();
  });
});

// `specId` terisi tanpa Spec = tautan putus (ADR-0150 keputusan 5). API tak boleh punya keadaan
// buntu: eskalasi ulang menyembuhkannya.
describe("POST /tasks/:id/escalate · tautan putus", () => {
  it("membuat Spec baru saat specId menunjuk Spec yang sudah terhapus", async () => {
    await makeTask({ specId: "SPEC-hantu" });
    const before = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(before.json().items[0]).toMatchObject({ specId: "SPEC-hantu", spec: null });

    const res = await escalate("t1");
    expect(res.statusCode).toBe(201);
    expect(res.json().created).toBe(true);
    expect(res.json().task.specId).not.toBe("SPEC-hantu");

    const after = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(after.json().items[0].spec).toMatchObject({ stage: "brainstorming" });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks-escalate.route.test.ts`
Expected: FAIL — seluruh kasus `404` karena route belum terdaftar (Fastify menjawab 404 untuk path tak dikenal).

- [x] **Step 3: Implementasi service**

Create `server/src/services/task-escalate.ts`:

```ts
import { payloadShapeFor, severityFromPriority } from "@hanoman/shared";
import type { EscalateSource, Priority } from "@hanoman/shared";
import type { Member, Spec, Task } from "@prisma/client";
import { prisma } from "../db";
import { nextSpecId } from "./id";
import { resolveRepoDir } from "./local-binding";
import { notifySynced } from "./sync-notify";

// SPEC-947 · jembatan kartu papan tim → backlog item. Cermin services/ticket-accept.ts (ADR-0062)
// dan services/github-accept.ts (ADR-0095): idempoten lewat back-pointer, bentuk payload mengikuti
// source, retry P2002 di sekitar nextSpecId. Ini call site prisma.spec.create KELIMA di server.
//
// Dipisah dari routes/tasks.ts karena alasan yang sama seperti acceptTicket: ia inti yang bisa
// dipanggil jalur non-HTTP (scheduler, lead) tanpa menyalin satu barisnya.

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Konteks yang dipunyai KARTU dan tak dipunyai `Spec`. Tanpa penanda `UNTRUSTED_*`: pembungkus itu
 * ada karena tiket Help Center datang dari publik, sementara kartu tim ditulis anggota tim di
 * dalam dashboard ber-auth (route ini COOKIE_ONLY dua arah). Memperlakukannya sebagai racun
 * melatih agen mengabaikan konteks yang justru sengaja diberikan.
 */
function contextOf(task: Task, member: Member | null, backlink: string): string {
  const lines = [
    task.detail?.trim() || "(kartu tanpa detail)",
    "",
    backlink,
    `Kolom papan: ${task.status} · prioritas kartu: ${task.priority}`,
    `Ditugaskan: ${member ? `${member.name} <${member.email}>` : "belum ditugaskan"}`,
  ];
  const from = day(task.startDate);
  const to = day(task.dueDate);
  if (from || to) lines.push(`Jadwal kartu: ${from ?? "—"} → ${to ?? "—"}`);
  return lines.join("\n");
}

export async function escalateTask(
  task: Task,
  opts: {
    projectId: string; source: EscalateSource; priority: Priority;
    author: string; launchApprovedBy?: string | null;
  },
): Promise<{ spec: Spec; task: Task; created: boolean }> {
  if (task.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: task.specId } });
    // `specId` terisi TANPA Spec = tautan putus (ADR-0150 keputusan 5) — jatuh ke pembuatan baru,
    // cermin acceptGithubIssue. `spec!` seperti acceptTicket akan mengembalikan undefined sebagai
    // Spec dan meledak di pemanggil, bukan di sini.
    if (spec) return { spec, task, created: false };
  }

  const member = task.memberId
    ? await prisma.member.findUnique({ where: { id: task.memberId } })
    : null;
  const backlink = `Dari kartu papan tim hanoman "${task.title}" (kartu ${task.id}, project ${opts.projectId}).`;
  const context = contextOf(task, member, backlink);

  // Bentuk payload WAJIB cocok dengan source — zCreateSpec.superRefine menuntutnya (SPEC-197/546).
  // `priority` ikut di payload brief karena zBriefPayload MEWAJIBKANNYA (zQaPayload tidak);
  // `severity` diturunkan dari prioritas yang baru saja dipilih operator di dialog yang sama,
  // bukan dihardcode "major" seperti dua call site lama yang tak punya nilai itu (ADR-0109).
  const payload = payloadShapeFor(opts.source) === "qa"
    ? { severity: severityFromPriority(opts.priority), steps: "Reproduksi dari isi kartu.",
        expected: "Perilaku yang diharapkan penulis kartu.", actual: context,
        env: "", constraints: "" }
    : { context, outcome: "", constraints: "", priority: opts.priority };

  const repoDir = await resolveRepoDir(opts.projectId);
  // SPEC-197 · nextSpecId TOCTOU → retry P2002 (≤3), bukan 500. Cermin keempat call site lain.
  let spec: Spec | null = null;
  for (let attempt = 0; attempt < 3 && !spec; attempt++) {
    const sid = await nextSpecId(repoDir);
    try {
      spec = await prisma.spec.create({
        data: {
          id: sid, projectId: opts.projectId, title: task.title, source: opts.source,
          stage: "brainstorming", priority: opts.priority, author: `Tim · ${opts.author}`,
          objective: `${task.title}. ${backlink}`, payload,
          launchApprovedAt: opts.launchApprovedBy ? new Date() : null,
          launchApprovedBy: opts.launchApprovedBy ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }

  // `projectId` ikut ditulis: kartu yang mengaku "tanpa project" sambil menunjuk Spec di dalam
  // sebuah project adalah kebenaran kedua yang langsung drift — papan menyaring per-project, dan
  // kartu itu takkan muncul di papan project yang backlog item-nya sedang dikerjakan.
  const updated = await prisma.task.update({
    where: { id: task.id }, data: { specId: spec!.id, projectId: opts.projectId },
  });
  await notifySynced("spec", spec!.id);
  await notifySynced("task", task.id);
  return { spec: spec!, task: updated, created: true };
}
```

- [x] **Step 4: Daftarkan route**

Di `server/src/routes/tasks.ts`, tambahkan ke baris impor teratas:

```ts
import { zCreateTask, zEscalateTask, zPatchTask } from "@hanoman/shared";
import { launchPrincipal } from "../services/launch-authority";
import { escalateTask } from "../services/task-escalate";
```

Lalu tambahkan route ini SEBELUM `app.delete("/tasks/:id", …)` di dalam `export default`:

```ts
  // SPEC-947 · eskalasi kartu → backlog item. Operasi khusus, bukan field `zPatchTask`: `specId`
  // sengaja absen dari CRUD (ADR-0150 keputusan 5) supaya kartu tak bisa mengaku tertaut pada Spec
  // yang tak pernah menyetujuinya. Cermin POST /tickets/:id/accept.
  app.post("/tasks/:id/escalate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zEscalateTask.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { source, priority, projectId: wanted } = parsed.data;

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "not found" });

    // Kartu yang sudah punya project tak boleh berpindah sebagai efek samping eskalasi. "Diterima
    // lalu terjadi hal lain" adalah bug yang tak terlihat operator.
    if (wanted && task.projectId && wanted !== task.projectId)
      return reply.code(400).send({ error: "kartu ini milik project lain", projectId: task.projectId });

    const projectId = task.projectId ?? wanted ?? null;
    // `nextSpecId(repoDir)` butuh repo dan repoDir milik project (ADR-0150 keputusan 3). Sebabnya
    // DISEBUT, tak ditolak dengan diam (kelas bug SPEC-546); dialog mendahuluinya dengan gerbang.
    if (!projectId)
      return reply.code(400).send({ error: "kartu tanpa project tak bisa dieskalasi — pilih project dulu" });
    if (!(await prisma.project.findUnique({ where: { id: projectId } })))
      return reply.code(400).send({ error: "project tak ditemukan", projectId });

    const r = await escalateTask(task, {
      projectId, source, priority,
      author: req.user?.email ?? "system", launchApprovedBy: launchPrincipal(req),
    });
    const view = taskView(r.task, { id: r.spec.id, stage: r.spec.stage, priority: r.spec.priority });
    return reply.code(r.created ? 201 : 200).send({ created: r.created, spec: r.spec, task: view });
  });
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks-escalate.route.test.ts`
Expected: PASS — 18 test hijau, nol skip.

- [x] **Step 6: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`
Expected: exit 0, tanpa output error.

- [x] **Step 7: Commit**

```bash
git add server/src/services/task-escalate.ts server/src/routes/tasks.ts server/test/tasks-escalate.route.test.ts
git commit -m "feat(947): POST /tasks/:id/escalate — kartu tim jadi backlog item"
```

---

### Task 3: `DELETE /api/tasks/:id/escalate` — lepas tautan

**Files:**
- Modify: `server/src/routes/tasks.ts` (satu route, tepat sesudah `POST …/escalate`)
- Test: `server/test/tasks-escalate.route.test.ts` (append `describe` baru)

**Interfaces:**
- Consumes: `taskView` (sudah diimpor), `notifySynced` (sudah diimpor)
- Produces: `DELETE /api/tasks/:id/escalate -> 200 TaskView`

- [x] **Step 1: Tulis test yang gagal**

Append ke `server/test/tasks-escalate.route.test.ts`:

```ts
const unlink = (id: string) =>
  app.inject({ method: "DELETE", url: `/api/tasks/${id}/escalate` });

describe("DELETE /tasks/:id/escalate", () => {
  it("mengosongkan specId dan mengembalikan TaskView", async () => {
    await makeTask();
    await escalate("t1");
    const res = await unlink("t1");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "t1", specId: null, spec: null });
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.specId).toBeNull();
  });

  // Non-destruktif, cermin POST /tickets/:id/unlink: Spec dibiarkan dan dihapus manual dari
  // Backlog bila memang salah.
  it("TIDAK menghapus Spec-nya", async () => {
    await makeTask();
    const id = (await escalate("t1")).json().spec.id;
    await unlink("t1");
    expect(await prisma.spec.findUnique({ where: { id } })).not.toBeNull();
  });

  it("idempoten: kartu yang belum tertaut menjawab 200, bukan 404", async () => {
    await makeTask();
    expect((await unlink("t1")).statusCode).toBe(200);
    await escalate("t1");
    expect((await unlink("t1")).statusCode).toBe(200);
    expect((await unlink("t1")).statusCode).toBe(200);
  });

  it("melepas tautan PUTUS juga", async () => {
    await makeTask({ specId: "SPEC-hantu" });
    expect((await unlink("t1")).json().specId).toBeNull();
  });

  it("mencatat version-stamp sync", async () => {
    await makeTask();
    await escalate("t1");
    await prisma.syncLog.deleteMany({ where: { entity: "task" } });
    await unlink("t1");
    expect(await prisma.syncLog.findFirst({ where: { entity: "task", recordId: "t1" } })).not.toBeNull();
  });

  it("404 untuk kartu yang tak ada", async () => {
    expect((await unlink("hantu")).statusCode).toBe(404);
  });

  // Kartu tetap DI PAPAN sesudah lepas tautan — eskalasi tak pernah memindahkannya keluar.
  it("kartu tetap ada di papan", async () => {
    await makeTask();
    await escalate("t1");
    await unlink("t1");
    const list = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({ id: "t1", status: "doing" });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks-escalate.route.test.ts -t "DELETE /tasks/:id/escalate"`
Expected: FAIL — `expected 404 to be 200` (route belum ada).

- [x] **Step 3: Implementasi**

Di `server/src/routes/tasks.ts`, tepat sesudah `app.post("/tasks/:id/escalate", …)`:

```ts
  // SPEC-947 · lepas tautan (kebalikan eskalasi, cermin POST /tickets/:id/unlink). Non-destruktif:
  // Spec dibiarkan — dihapus manual dari Backlog bila memang salah-eskalasi.
  app.delete("/tasks/:id/escalate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "not found" });
    // Idempoten: "tak ada yang perlu dilepas" bukan galat, dan klien papan bisa mengirim dua kali
    // karena frame WS memperbarui kartu tepat sebelum jawaban pertama mendarat.
    if (!task.specId) return taskView(task, null);
    const row = await prisma.task.update({ where: { id }, data: { specId: null } });
    await notifySynced("task", id);
    return taskView(row, null);
  });
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks-escalate.route.test.ts`
Expected: PASS — 25 test hijau (18 dari Task 2 + 7 baru).

- [x] **Step 5: Test regresi CRUD `Task` tak berubah**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tasks.route.test.ts server/test/tasks-list.test.ts`
Expected: PASS, nol gagal. (Route `/tasks/:id` dan `/tasks/:id/escalate` berbeda path — bila ada yang merah, urutan pendaftaran route-lah tersangkanya.)

- [x] **Step 6: Commit**

```bash
git add server/src/routes/tasks.ts server/test/tasks-escalate.route.test.ts
git commit -m "feat(947): DELETE /tasks/:id/escalate — lepas tautan, idempoten"
```

---

### Task 4: Klien API + `EscalateDialog`

**Files:**
- Modify: `src/src/api/client.ts` (sesudah `deleteTask`)
- Create: `src/src/screens/EscalateDialog.tsx`
- Test: `src/test/team-escalate.test.tsx` (baru)

**Interfaces:**
- Consumes: `paths.taskEscalate`, `EscalateTaskInput`, `ESCALATE_SOURCES` (Task 1) · `sourceMeta`, `PRIO_OPTS` dari `./source-meta` · `Modal`, `Button`, `Field`, `Select` dari `../ds`
- Produces:
  - `api.escalateTask(id, body) => Promise<{ created: boolean; spec: Spec; task: TaskView }>`
  - `api.unlinkTaskSpec(id) => Promise<TaskView>`
  - `<EscalateDialog task projects onClose onDone onToast />`

- [x] **Step 1: Tulis test yang gagal**

Create `src/test/team-escalate.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskView } from "@hanoman/shared";
import { EscalateDialog } from "../src/screens/EscalateDialog";
import { api } from "../src/api/client";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p1", title: "Perbaiki halaman harga", detail: null, status: "doing",
  priority: "tinggi", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
  ...over,
});
const projects = [
  { id: "p1", name: "hanoman" } as any,
  { id: "p2", name: "erp" } as any,
];

function open(t: TaskView) {
  const onDone = vi.fn(), onClose = vi.fn(), onToast = vi.fn();
  render(<EscalateDialog task={t} projects={projects}
    onClose={onClose} onDone={onDone} onToast={onToast} />);
  return { onDone, onClose, onToast };
}
const submit = () => screen.getByRole("button", { name: /eskalasi/i });

beforeEach(() => vi.restoreAllMocks());

describe("EscalateDialog", () => {
  it("default source brief, prioritas PREFILLED dari kartu", async () => {
    const spy = vi.spyOn(api, "escalateTask").mockResolvedValue(
      { created: true, spec: { id: "SPEC-9" } as any, task: task({ specId: "SPEC-9" }) });
    open(task());
    fireEvent.click(submit());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![1]).toMatchObject({ source: "brief", priority: "tinggi" });
  });

  it("mengirim source & prioritas yang dipilih operator", async () => {
    const spy = vi.spyOn(api, "escalateTask").mockResolvedValue(
      { created: true, spec: { id: "SPEC-9" } as any, task: task({ specId: "SPEC-9" }) });
    open(task());
    fireEvent.change(screen.getByLabelText(/source/i), { target: { value: "qa" } });
    fireEvent.change(screen.getByLabelText(/prioritas/i), { target: { value: "rendah" } });
    fireEvent.click(submit());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![1]).toMatchObject({ source: "qa", priority: "rendah" });
  });

  /* Gerbang project hidup HANYA di JSX; unit test aturan takkan menangkapnya. Kelas bug SPEC-546:
     menolak dengan diam. Di sini penolakannya bernama DAN mendahului request. */
  it("kartu tanpa project: kirim MATI sampai project dipilih, dengan sebab yang tertulis", async () => {
    const spy = vi.spyOn(api, "escalateTask");
    open(task({ projectId: null }));
    expect(submit()).toBeDisabled();
    expect(screen.getByText(/nomor spec/i)).toBeInTheDocument();
    fireEvent.click(submit());
    expect(spy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/project/i), { target: { value: "p2" } });
    expect(submit()).not.toBeDisabled();
  });

  it("kartu tanpa project: projectId yang dipilih ikut terkirim", async () => {
    const spy = vi.spyOn(api, "escalateTask").mockResolvedValue(
      { created: true, spec: { id: "SPEC-9" } as any, task: task({ specId: "SPEC-9", projectId: "p2" }) });
    open(task({ projectId: null }));
    fireEvent.change(screen.getByLabelText(/project/i), { target: { value: "p2" } });
    fireEvent.click(submit());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![1]).toMatchObject({ projectId: "p2" });
  });

  it("kartu BER-project tak merender pemilih project", () => {
    open(task());
    expect(screen.queryByLabelText(/project/i)).toBeNull();
  });

  it("sukses: onDone membawa kartu terbaru, toast menyebut nomor SPEC", async () => {
    const updated = task({ specId: "SPEC-9", spec: { id: "SPEC-9", stage: "brainstorming", priority: "tinggi" } });
    vi.spyOn(api, "escalateTask").mockResolvedValue({ created: true, spec: { id: "SPEC-9" } as any, task: updated });
    const { onDone, onClose, onToast } = open(task());
    fireEvent.click(submit());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(updated));
    expect(onClose).toHaveBeenCalled();
    expect(onToast.mock.calls[0]![0]).toContain("SPEC-9");
  });

  // Isian operator tak boleh hilang gara-gara jaringan.
  it("galat API: dialog TETAP terbuka, toast galat", async () => {
    vi.spyOn(api, "escalateTask").mockRejectedValue(new Error("boom"));
    const { onClose, onToast } = open(task());
    fireEvent.click(submit());
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(onToast.mock.calls[0]![1]).toBe("err");
    expect(onClose).not.toHaveBeenCalled();
    expect(submit()).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/team-escalate.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/screens/EscalateDialog"`.

- [x] **Step 3: Tambahkan klien API**

Di `src/src/api/client.ts`, tambahkan `type EscalateTaskInput` ke daftar impor dari `@hanoman/shared` (baris 1), lalu sisipkan tepat sesudah `deleteTask:`:

```ts
  // SPEC-947 · eskalasi kartu → backlog. `specId` sengaja tak bisa ditulis lewat patchTask
  // (ADR-0150 keputusan 5), jadi ini satu-satunya jalur yang mengisinya.
  escalateTask: (id: string, b: EscalateTaskInput) =>
    j<{ created: boolean; spec: Spec; task: TaskView }>(paths.taskEscalate(id), { method: "POST", ...body(b) }),
  unlinkTaskSpec: (id: string) => j<TaskView>(paths.taskEscalate(id), { method: "DELETE" }),
```

- [x] **Step 4: Implementasi dialog**

Create `src/src/screens/EscalateDialog.tsx`:

```tsx
import React from "react";
import { ESCALATE_SOURCES, type EscalateSource, type TaskView } from "@hanoman/shared";
import { Button, Field, Modal, Select } from "../ds";
import { api } from "../api/client";
import { PRIO_OPTS, sourceMeta } from "./source-meta";
import type { ProjectVM } from "./types";

/* SPEC-947 · satu-satunya jembatan papan tim ke dunia agen. Kartu TETAP di papan sesudahnya —
   yang lahir adalah backlog item, bukan pemindahan.

   Label & ikon source datang dari `sourceMeta()` (SPEC-546 · source-meta.ts), bukan literal baru:
   katalog yang disalin pasti berselisih dengan lencananya di layar Backlog. */

const SOURCE_OPTS = ESCALATE_SOURCES.map((value) => ({ value, label: sourceMeta(value).label }));

type Priority = TaskView["priority"];

export function EscalateDialog({ task, projects, onClose, onDone, onToast }: {
  task: TaskView; projects: ProjectVM[];
  onClose: () => void;
  /** Kartu terbaru dari server — papan memperbaruinya seketika, tak menunggu frame WS. */
  onDone: (task: TaskView) => void;
  onToast: (msg: string, kind?: string, icon?: string) => void;
}) {
  const [source, setSource] = React.useState<EscalateSource>("brief");
  // Kartu sudah membawa prioritas; memaksa operator memilih ulang dari nol adalah pertanyaan yang
  // jawabannya sudah ada di layar. Nilai di luar kosakata (kolom TEXT lintas sync) jatuh ke sedang.
  const [priority, setPriority] = React.useState<string>(
    () => (PRIO_OPTS.some((o) => o.value === task.priority) ? task.priority : "sedang"));
  const [projectId, setProjectId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // `nextSpecId` mengambil lantai nomornya dari repo project, dan `Task.projectId` boleh null
  // (ADR-0150 keputusan 3). Gerbangnya di SINI supaya operator tak menabrak 400 server.
  const needsProject = task.projectId === null;
  const target = task.projectId ?? projectId;

  async function submit() {
    if (!target || busy) return;
    setBusy(true);
    try {
      const r = await api.escalateTask(task.id, {
        source, priority: priority as Priority,
        ...(task.projectId ? {} : { projectId }),
      });
      onToast(r.created ? `Dieskalasi jadi ${r.spec.id}` : `Sudah tertaut ke ${r.spec.id}`, "ok", "link");
      onDone(r.task);
      onClose();
    } catch {
      // Dialog TETAP terbuka: isian operator tak boleh hilang gara-gara jaringan.
      onToast("Gagal mengeskalasi kartu", "err", "x-circle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} icon="git-branch"
      eyebrow="Papan tim" title="Eskalasi ke backlog"
      footer={
        <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "center" }}>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={submit} loading={busy} disabled={!target} leftIcon="git-branch">
            Eskalasi
          </Button>
        </div>}>
      <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55, marginBottom: 14 }}>
        Kartu <strong>{task.title}</strong> tetap di papan. Yang lahir adalah backlog item baru
        yang bisa dikerjakan sesi agen, dan kartu ini menampilkan stage-nya.
      </div>

      {needsProject && (
        <Field label="Project">
          <Select aria-label="Project" value={projectId} style={{ width: "100%" }}
            onChange={(e) => setProjectId(e.target.value)}
            options={[{ value: "", label: "Pilih project…" },
              ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>
            Nomor SPEC diambil dari repo project, jadi kartu tanpa project belum bisa dieskalasi.
          </div>
        </Field>
      )}

      <Field label="Source">
        <Select aria-label="Source" value={source} style={{ width: "100%" }}
          onChange={(e) => setSource(e.target.value as EscalateSource)} options={SOURCE_OPTS} />
      </Field>

      <Field label="Prioritas">
        <Select aria-label="Prioritas" value={priority} style={{ width: "100%" }}
          onChange={(e) => setPriority(e.target.value)} options={PRIO_OPTS} />
      </Field>
    </Modal>
  );
}
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/team-escalate.test.tsx`
Expected: PASS — 7 test hijau.

- [x] **Step 6: Typecheck frontend**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0.

- [x] **Step 7: Commit**

```bash
git add src/src/api/client.ts src/src/screens/EscalateDialog.tsx src/test/team-escalate.test.tsx
git commit -m "feat(947): EscalateDialog + klien escalate/unlink"
```

---

### Task 5: Aksi di kartu + wiring papan

**Files:**
- Modify: `src/src/screens/team-board.tsx` (props `TaskCard`/`TeamBoard`, baris lencana)
- Modify: `src/src/screens/TeamScreen.tsx` (state dialog, handler, render)
- Test: `src/test/team-board.test.tsx` (append), `src/test/team-escalate.test.tsx` (append)

**Interfaces:**
- Consumes: `EscalateDialog` (Task 4), `api.unlinkTaskSpec` (Task 4), `replaceCard` dari `./team-rules`
- Produces: prop baru `onEscalate: (t: TaskView) => void` dan `onUnlink: (t: TaskView) => void` pada `TeamBoard`

- [x] **Step 1: Tulis test yang gagal**

Append ke `src/test/team-board.test.tsx` (tambahkan `onEscalate`/`onUnlink` ke helper `board()` dulu — ganti fungsi `board` yang ada dengan versi ini):

```tsx
function board(over: Partial<Board>, totals: Partial<Record<TaskStatus, number>> = {}) {
  const b = { ...emptyBoard(), ...over };
  const onMove = vi.fn(), onAssign = vi.fn(), onOpen = vi.fn(), onEscalate = vi.fn(), onUnlink = vi.fn();
  render(<TeamBoard board={b} totals={{ ...zeros, ...totals }} columns={TEAM_COLUMNS}
    members={[member("a@x.id", "Dena")]} onMove={onMove} onAssign={onAssign} onOpen={onOpen}
    onEscalate={onEscalate} onUnlink={onUnlink} />);
  return { onMove, onAssign, onOpen, onEscalate, onUnlink };
}
```

lalu append `describe` ini:

```tsx
/* SPEC-947 · jembatan ke dunia agen. Aksi eksplisit, bukan menu: drag mati di keyboard dan layar
   sentuh, dan alasan itu pula yang sudah melahirkan dua Select di kartu. */
describe("TeamBoard · eskalasi", () => {
  it("kartu belum tertaut membawa aksi Eskalasi", () => {
    const { onEscalate } = board({ backlog: [task({ id: "a" })] });
    fireEvent.click(screen.getByRole("button", { name: /eskalasi.*desain/i }));
    expect(onEscalate).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("kartu tertaut merender lencana SPEC + aksi Lepas tautan, TANPA aksi eskalasi", () => {
    const { onUnlink } = board({ backlog: [task({
      id: "a", specId: "SPEC-9", spec: { id: "SPEC-9", stage: "executing", priority: "tinggi" } })] });
    expect(screen.getByText("SPEC-9 · executing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /eskalasi/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /lepas tautan.*desain/i }));
    expect(onUnlink).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  // `specId` terisi + `spec` null = tautan putus. Yang ditawarkan lepas tautan, bukan eskalasi
  // ulang: operator perlu melihat keadaan itu dulu.
  it("tautan putus merender lencananya + aksi Lepas tautan", () => {
    const { onUnlink } = board({ backlog: [task({ id: "a", specId: "SPEC-hantu", spec: null })] });
    expect(screen.getByText(/tautan putus/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /lepas tautan.*desain/i }));
    expect(onUnlink).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/team-board.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /eskalasi/i`.

- [x] **Step 3: Implementasi kartu**

Di `src/src/screens/team-board.tsx`:

Tambahkan `Button` ke impor DS:

```tsx
import { Badge, Button, Icon, Select, LIST_SCROLL_STYLE, FIXED_ROW_STYLE } from "../ds";
```

Tambahkan dua prop ke signature `TaskCard` (sesudah `onAssign`):

```tsx
  onEscalate: (t: TaskView) => void;
  onUnlink: (t: TaskView) => void;
```

Ganti seluruh blok `{task.specId && ( … )}` dengan:

```tsx
      {/* SPEC-947 · satu baris, dua keadaan. `aria-label` memuat judul supaya papan berisi banyak
          kartu tetap punya nama yang unik bagi pembaca layar DAN bagi test — cermin dua Select
          di bawah. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        {task.specId ? (
          <>
            {/* ADR-0150 keputusan 5 · `specId` terisi tanpa `spec` = tautan putus. Bedanya dengan
                "tak pernah dieskalasi" harus terlihat, bukan diam-diam kosong. */}
            <Badge tone={task.spec ? "ok" : "warn"} size="sm" icon={task.spec ? "link" : "unlink"}>
              {task.spec ? `${task.spec.id} · ${task.spec.stage}` : "tautan putus"}
            </Badge>
            <Button size="sm" variant="ghost" leftIcon="unlink"
              aria-label={`Lepas tautan: ${task.title}`}
              onClick={() => onUnlink(task)}>Lepas tautan</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" leftIcon="git-branch"
            aria-label={`Eskalasi ke backlog: ${task.title}`}
            onClick={() => onEscalate(task)}>Eskalasi</Button>
        )}
      </div>
```

Tambahkan dua prop ke signature `TeamBoard` (sesudah `onOpen`):

```tsx
  onEscalate: (t: TaskView) => void;
  onUnlink: (t: TaskView) => void;
```

dan teruskan ke `<TaskCard …>`:

```tsx
                  onOpen={onOpen} onMove={onMove} onAssign={onAssign}
                  onEscalate={onEscalate} onUnlink={onUnlink} />
```

- [x] **Step 4: Jalankan test papan, pastikan LULUS**

Run: `pnpm vitest --run src/test/team-board.test.tsx`
Expected: PASS — test lama + 3 baru hijau.

- [x] **Step 5: Wiring `TeamScreen`**

Di `src/src/screens/TeamScreen.tsx`:

Tambahkan impor:

```tsx
import { EscalateDialog } from "./EscalateDialog";
```

Tambahkan state di samping `taskOpen`/`membersOpen`:

```tsx
  const [escalating, setEscalating] = React.useState<TaskView | null>(null);
```

Tambahkan handler tepat sesudah `assign()`:

```tsx
  // Lepas tautan tak butuh dialog: ia non-destruktif (Spec dibiarkan) dan reversibel lewat
  // eskalasi ulang, jadi konfirmasi di sini hanya menambah klik untuk tindakan yang murah.
  async function unlink(task: TaskView) {
    const before = board;
    setBoard(replaceCard(board, { ...task, specId: null, spec: null }));
    try {
      await api.unlinkTaskSpec(task.id);
      onToast("Tautan backlog dilepas", "ok", "unlink");
    } catch {
      setBoard(before);
      onToast("Gagal melepas tautan", "err", "x-circle");
    }
  }
```

Teruskan ke `<TeamBoard …>`:

```tsx
        : <TeamBoard board={board} totals={totals} columns={columns} members={members}
            onMove={move} onAssign={assign} onEscalate={setEscalating} onUnlink={unlink}
            onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />}
```

Render dialognya di samping `<TaskModal …>`:

```tsx
      {escalating && (
        <EscalateDialog task={escalating} projects={projects}
          onClose={() => setEscalating(null)}
          // Kartu dari server dipakai LANGSUNG: `projectId` bisa ikut berubah (kartu tanpa project
          // yang dieskalasi ikut pindah), jadi menambal `specId` saja akan meleset.
          onDone={(t) => setBoard((b) => replaceCard(b, t))}
          onToast={onToast} />
      )}
```

- [x] **Step 6: Tulis test wiring layar**

Append ke `src/test/team-escalate.test.tsx`:

```tsx
import { TeamScreen } from "../src/screens/TeamScreen";

const page = (items: TaskView[]) => ({ items, total: items.length, page: 1, pageSize: 200 });

describe("TeamScreen · wiring eskalasi", () => {
  beforeEach(() => {
    vi.spyOn(api, "listMembers").mockResolvedValue(page([]) as any);
  });

  it("klik Eskalasi membuka dialog untuk kartu itu", async () => {
    vi.spyOn(api, "listTasks").mockImplementation(async (p: any) =>
      page(p.status === "doing" ? [task()] : []) as any);
    render(<TeamScreen projects={projects} projectFilter="all"
      onProjectFilter={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /eskalasi ke backlog/i }));
    expect(await screen.findByText(/eskalasi ke backlog/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/source/i)).toBeInTheDocument();
  });

  it("klik Lepas tautan memanggil API dan mengosongkan lencana di papan", async () => {
    const linked = task({ specId: "SPEC-9", spec: { id: "SPEC-9", stage: "executing", priority: "tinggi" } });
    vi.spyOn(api, "listTasks").mockImplementation(async (p: any) =>
      page(p.status === "doing" ? [linked] : []) as any);
    const spy = vi.spyOn(api, "unlinkTaskSpec").mockResolvedValue(task({ specId: null }));
    render(<TeamScreen projects={projects} projectFilter="all"
      onProjectFilter={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /lepas tautan/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByText("SPEC-9 · executing")).toBeNull());
  });
});
```

- [x] **Step 7: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/team-escalate.test.tsx src/test/team-board.test.tsx src/test/team-screen.test.tsx`
Expected: PASS — nol gagal. (Bila `team-screen.test.tsx` merah karena mock parsial `api`, tambahkan mock `unlinkTaskSpec`/`escalateTask` di sana — kelas jebakan SPEC-884: satu panggilan `api` baru mematahkan test ber-mock parsial.)

- [x] **Step 8: Typecheck frontend**

Run: `pnpm --filter ./src typecheck`
Expected: exit 0.

- [x] **Step 9: Commit**

```bash
git add src/src/screens/team-board.tsx src/src/screens/TeamScreen.tsx src/test/team-board.test.tsx src/test/team-escalate.test.tsx
git commit -m "feat(947): aksi Eskalasi & Lepas tautan di kartu papan tim"
```

---

### Task 6: Docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0152-eskalasi-kartu-tim-ke-backlog.md`
- Modify: `internal/docs/adr/README.md` (append narasi ADR-0152)
- Modify: `internal/docs/README.md` (index — baris ADR-0152)
- Modify: `internal/docs/architecture/api-contract.md` (blok "Papan tim")
- Modify: `internal/skills/hanoman/SKILL.md` (paragraf "Papan Tim")

**Interfaces:**
- Consumes: keputusan 1–12 dari spec SPEC-947
- Produces: nomor ADR **0152** (verifikasi belum dipakai sebelum menulis — nomor bertabrakan antar-worktree konkuren)

- [x] **Step 1: Pastikan nomor ADR belum dipakai**

Run: `ls internal/docs/adr | grep -c '^0152' ; grep -c 'ADR-0152' internal/docs/README.md`
Expected: `0` dan `0`. Bila bukan nol, pakai nomor bebas berikutnya dan ganti SELURUH rujukan `0152` di plan ini serta di berkas spec.

- [x] **Step 2: Tulis ADR-0152**

Create `internal/docs/adr/0152-eskalasi-kartu-tim-ke-backlog.md` — struktur mengikuti `0151-papan-tim-langganan-per-kolom.md`: judul, `Status: berlaku`, `Tanggal: 2026-08-25`, `SPEC: SPEC-947`, `Memperluas: ADR-0150`, `Menegakkan: ADR-0062, ADR-0095, ADR-0109, ADR-0110/ADR-0065, ADR-0119`, lalu `## Konteks` dan `## Keputusan` bernomor. Isi keputusan diambil apa adanya dari §1–§12 spec:

1. Operasi khusus `POST`/`DELETE …/escalate`, bukan field `zPatchTask` — `specId` tetap absen dari CRUD.
2. Idempoten lewat `task.specId`; `201` pertama, `200 created:false` berikutnya.
3. Retry `P2002` ≤3× di sekitar `nextSpecId` — call site `prisma.spec.create` kelima.
4. Kartu tanpa project ditolak **dengan nama** (`400`), dialog mendahului dengan gerbang. `repoDir` null TIDAK ditolak.
5. `projectId` di body ditulis balik ke kartu; project lain → `400`.
6. Tiga source (`brief`/`qa`/`audit`), enum eksplisit — bukan `zSpecSource` yang disaring.
7. Bentuk payload mengikuti source; `severity` dari `severityFromPriority`, bukan hardcode `major`.
8. Tanpa penanda `UNTRUSTED_*`, berikut alasannya.
9. Stage tak pernah ditulis balik (menegakkan ADR-0150 keputusan 4).
10. Tautan putus: `POST` menyembuhkan (cermin `acceptGithubIssue`, bukan `acceptTicket` yang memakai `spec!`), `DELETE` membersihkan & idempoten.
11. `launchApprovedBy` dari `launchPrincipal(req)` (SPEC-761).
12. Nol pendaftaran sync/capability baru — dan itu keputusan, bukan kelalaian.

Tutup dengan `## Konsekuensi` yang menyebut: kartu tanpa project **berpindah** project saat dieskalasi (efek yang dinyatakan, bukan tersembunyi); `Spec` hasil eskalasi tak punya penanda asal-usul selain `author: "Tim · …"` dan backlink di `objective`.

- [x] **Step 3: Perbarui api-contract**

Di `internal/docs/architecture/api-contract.md`, di dalam blok berpagar ```` ``` ```` bagian "Papan tim", tepat sesudah baris `DELETE /api/tasks/:id  -> 204 …`, sisipkan:

```
POST   /api/tasks/:id/escalate   { source, priority, projectId? }   # SPEC-947 · ADR-0152
#   -> 201 { created: true,  spec, task }   kartu belum tertaut
#   -> 200 { created: false, spec, task }   sudah tertaut → Spec yang SAMA, tak pernah yang kedua
#   `source` EKSPLISIT tiga: brief (default) | qa | audit. `goal`/`no_effort` butuh bentuk payload
#   `goal` (goal + done) yang hanya operator bisa tulis; `help` menjanjikan asal-usul Help Center.
#   `priority` = kosakata zPriority, default "sedang"; UI mem-prefill dari `task.priority`.
#   `projectId` dipakai HANYA saat kartunya belum punya project — dan kartu itu IKUT pindah ke
#   sana (`task.projectId` diisi). 400 { error, projectId } bila body menyebut project LAIN:
#   kartu tak boleh berpindah project sebagai efek samping yang tak diminta.
#   400 kartu tanpa project & tanpa projectId — SEBABNYA disebut, tak ditolak dengan diam
#   (nextSpecId butuh repo, repoDir milik project). repoDir yang null TIDAK ditolak: itu keadaan
#   sah project from-scratch, dan nextSpecId(null) punya lantai-140-nya sendiri.
#   Spec lahir stage "brainstorming", author "Tim · <email>", objective = judul + backlink kartu.
#   Bentuk payload mengikuti source (zCreateSpec.superRefine): qa → severity DITURUNKAN dari
#   prioritas (severityFromPriority), bukan hardcode "major" seperti acceptTicket/acceptGithubIssue
#   yang tak punya nilai itu. brief/audit → { context, outcome, constraints, priority }.
#   Teks kartu TIDAK dibungkus UNTRUSTED_*: pembungkus itu ada karena tiket datang dari PUBLIK,
#   sementara kartu ditulis anggota tim di dashboard ber-auth (route COOKIE_ONLY dua arah).
#   `launchApprovedBy` diisi launchPrincipal(req) (SPEC-761). Retry P2002 ≤3× (SPEC-197).
#   `specId` menunjuk Spec TERHAPUS → membuat Spec BARU (cermin acceptGithubIssue): API tak boleh
#   punya keadaan buntu. 404 id kartu tak ada.
DELETE /api/tasks/:id/escalate   -> 200 TaskView (specId: null)
#   Lepas tautan untuk salah-eskalasi. NON-DESTRUKTIF: Spec dibiarkan (dihapus manual dari
#   Backlog). IDEMPOTEN: kartu yang belum tertaut menjawab 200, bukan 404. Melepas tautan PUTUS
#   juga. Kartu TETAP di papan — eskalasi tak pernah memindahkannya keluar. 404 id kartu tak ada.
```

Lalu tambahkan sesudah baris `> **Webhook:** sengaja TIDAK didaftarkan …`:

```
> **Eskalasi (SPEC-947 · [ADR-0152](../adr/0152-eskalasi-kartu-tim-ke-backlog.md)):** nol kolom,
> nol migration, nol entri sync/capability baru. `Task.specId` sudah ada sejak ADR-0150 dan
> sengaja absen dari `zCreateTask`/`zPatchTask`; jalur ini satu-satunya yang mengisinya.
```

- [x] **Step 4: Perbarui index & skill**

Di `internal/docs/README.md`, tambahkan baris ADR-0152 tepat sesudah baris ADR-0151, memakai format baris di sekitarnya (`[ADR-0152](adr/0152-eskalasi-kartu-tim-ke-backlog.md) — …`).

Di `internal/skills/hanoman/SKILL.md`, di paragraf "Papan Tim — kerja MANUSIA, papan LAIN", ubah kepala paragrafnya jadi `(SPEC-945/946/947 · **ADR-0150**+**ADR-0151**+**ADR-0152**…)` dan ganti kalimat penutup "Item **D** (Linimasa) & **E** (Lintas project) tak bisa menumpang topik ini apa adanya" dengan tambahan sebelum kalimat itu:

```
  **Eskalasi (SPEC-947/ADR-0152)** adalah satu-satunya jembatan papan ini ke dunia agen: `POST`/
  `DELETE /tasks/:id/escalate`, operasi khusus karena `specId` sengaja absen dari CRUD. Idempoten
  lewat `task.specId` (`created:false`, bukan Spec kedua); kartu **tanpa project** ditolak dengan
  SEBAB yang disebut karena `nextSpecId` butuh repo, dan `projectId` di body **memindahkan kartu**
  ke project itu — kartu yang mengaku "tanpa project" sambil menunjuk Spec di dalam project adalah
  kebenaran kedua yang langsung drift. `specId` menunjuk Spec terhapus = **tautan putus**: `POST`
  membuat yang baru (cermin `acceptGithubIssue`; `acceptTicket` memakai `spec!` dan akan
  mengembalikan `undefined`), `DELETE` membersihkannya dan **idempoten**. `severity` payload qa
  DITURUNKAN dari prioritas yang baru dipilih operator, bukan hardcode `major`, dan teks kartu
  **tak** dibungkus `UNTRUSTED_*` — pembungkus itu milik tiket publik.
```

- [x] **Step 5: Verifikasi tautan index terjangkau**

Run: `grep -c "0152-eskalasi-kartu-tim-ke-backlog" internal/docs/README.md internal/docs/architecture/api-contract.md`
Expected: masing-masing `1`.

- [x] **Step 6: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(947): ADR-0152 + api-contract + index + skill"
```

---

### Task 7: Verifikasi akhir

**Files:** tak ada perubahan kode — hanya menjalankan & melaporkan.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/tasks-escalate.route.test.ts server/test/tasks.route.test.ts \
  server/test/tasks-list.test.ts shared/src/team.test.ts \
  src/test/team-escalate.test.tsx src/test/team-board.test.tsx src/test/team-screen.test.tsx
```
Expected: semua PASS. **Jangan** terima "no test files" sebagai bukti — pastikan jumlah test yang berjalan bukan nol.

- [ ] **Step 2: Typecheck tiga paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck`
Expected: exit 0 bertiga. (Bukan `pnpm -r typecheck` — itu menyalakan satu proses tsc per paket sekaligus.)

- [x] **Step 3: Smoke endpoint di server hidup**

Boot server lalu:
```bash
curl -s -X POST localhost:3001/api/tasks -H 'content-type: application/json' \
  -d '{"title":"smoke 947","projectId":"<project nyata>"}'
curl -s -X POST localhost:3001/api/tasks/<id>/escalate -H 'content-type: application/json' \
  -d '{"source":"brief","priority":"sedang"}'
curl -s "localhost:3001/api/tasks?q=smoke%20947"
curl -s -X DELETE localhost:3001/api/tasks/<id>/escalate
```
Expected: `201` dengan `spec.id` `SPEC-nnn`; `GET` memperlihatkan `spec.stage: "brainstorming"`; `DELETE` mengembalikan `specId: null`.

**Hasil terukur (2026-08-25, server `tsx server/src/server.ts` di port 3947, `HANOMAN_HOME` & DB sementara):**
`POST` tanpa project → `400 {"error":"kartu tanpa project tak bisa dieskalasi — pilih project dulu"}`;
dengan `projectId` → `SPEC-948` `qa`/`brainstorming`/`rendah`, `author: "Tim · smoke@x.id"`,
`launchApprovedBy: "user:smoke@x.id"`, `payload.severity: "minor"` (turunan prioritas), nol
`UNTRUSTED`, `task.projectId` **ikut pindah**; panggilan kedua `200 created:false`; body ber-project
lain → `400 {"error":"kartu ini milik project lain","projectId":"smoke-947"}`; `GET /tasks?q=`
merender cermin `{id, stage, priority}`; `DELETE` → `200 specId:null` dan `200` lagi (idempoten),
`SPEC-948` **masih ada** di backlog.

**Dua jebakan env yang menghabiskan waktu, catat untuk lain kali:** (1) `HANOMAN_CONTROL_ORIGINS`
ambient membuat `classifyIngress` menjawab `denied` → **setiap** route test 404, terukur di BASE
(`tasks.route.test.ts` 22 gagal/24 dengan var itu, 24 lulus tanpanya); (2) `server/src/env.ts`
menaiki **enam** level dan menemukan `.env` checkout UTAMA, yang berisi
`DATABASE_URL=file:../../hanoman-dev.db` relatif terhadap `server/prisma` — jadi **meng-`unset`
`DATABASE_URL` justru MEMPERBURUK**: `.env` hanya mengisi var yang `undefined`, sehingga server boot
ke DB dev kosong dan menjawab `P2021 table main.User does not exist` padahal DB smoke-nya bermigrasi
sempurna. Sebutkan `DATABASE_URL` **eksplisit** — env nyata menang atas `.env`.

- [ ] **Step 4: Centang seluruh kotak plan ini**

Setiap `- [ ]` di berkas ini jadi `- [x]`. hanoman menahan backlog di `executing` selama masih ada kotak kosong.

- [ ] **Step 5: Commit & push**

```bash
git add docs/superpowers/plans/2026-08-25-spec-947-eskalasi-kartu-tim.md
git commit -m "docs(plan-947): centang tuntas"
git push origin HEAD:refs/heads/hanoman/spec-947
```
