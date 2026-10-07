# Memori Project Bersama — Tahap 1 (Fondasi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memori project yang bisa diusulkan, dicari, dikoreksi, dan direview lewat REST `/api/memories/*` dan tool MCP `hanoman_memory_*`, dengan project ditentukan oleh proses (identitas repo / sesi cookie) — tidak pernah oleh model.

**Architecture:** Tiga model Prisma baru (`ProjectMemory`, `MemoryEvent`, `MemoryLocalState`) + kolom `AgentToken.projectIds`. Logika dipecah menjadi unit murni (`rules.ts`), pembungkus git async (`git.ts`), resolusi lingkup (`resolve.ts`), dan store (`store.ts`) di `server/src/services/memory/`. Proses MCP CLI menghitung identitas repo (remote, root commit, HEAD) dan blob SHA jangkar dari cwd-nya, lalu mengirimnya di header `x-hanoman-repo` dan body; server memverifikasi ulang bila checkout project tersedia.

**Tech Stack:** Node ≥20 + TypeScript strict, Fastify 5, Prisma 6 (SQLite), zod 3, vitest, `@modelcontextprotocol/server`.

**Spec:** [`docs/superpowers/specs/2026-10-07-shared-project-memory-design.md`](../specs/2026-10-07-shared-project-memory-design.md) — plan ini = **§8 butir 1**. Butir 2 (suntik ke sesi + spike codex + skill), 3 (sync), 4 (UI) masing-masing plan tersendiri.

## Global Constraints

- Jangan ubah skema tanpa migration + ADR (CLAUDE.md). ADR baru = **ADR-0178**.
- Tool memori **tidak menerima** parameter `project`; agent token yang mengirim `projectId` → `400`.
- Token tanpa `projectIds` (null/kosong) → `403 {need:"projectIds"}` di setiap route memori.
- `content` satu fakta, **≤ 500 karakter**; `kind` ∈ `convention | gotcha | decision | fact`.
- Lattice status: `proposed(0) < active(1) < invalidated(2) = rejected(2)`; tak pernah mundur.
- Auto-aktif hanya bila: `kind ≠ decision` ∧ jangkar ≥ 1 ∧ jangkar **diverifikasi server** ∧ `trusted`.
- `activate` / `reject` hanya cookie (COOKIE_ONLY untuk agent token). Hapus permanen di luar tahap ini (tahap sync, via `SyncTombstone`).
- Jalankan git **async** (`execFile` promisified) — jalur request tak boleh memblokir event loop (SPEC-878).
- Test server: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run <path> --no-file-parallelism`.
- Setiap task selesai: centang checkbox di berkas ini, jalankan test yang tersentuh.
- Komentar & pesan galat berbahasa Indonesia, gaya `// SPEC/ADR · …` seperti kode sekitar.

### Penyimpangan sadar dari spec (dicatat di ADR-0178)

1. **FTS5 ditunda.** Pencarian tahap 1 = filter token di JS atas ≤ 500 memori per project. Alasan: memori per project berjumlah ratusan; tabel virtual FTS5 + shadow table berisiko drift `prisma migrate diff`. FTS5 dipertimbangkan bila jumlah memori melewati ribuan.
2. **`sourceDeviceId` nullable** — diisi tahap sync.
3. **Kolom tambahan `reviewReason String?`** — alasan masuk antrean review, agar UI tak perlu membaca event.
4. **`sourceRuntime` menambah `human`** untuk memori yang dibuat lewat dashboard.
5. **`trusted` = `true` untuk agent token & cookie di tahap 1.** Sumber tak tepercaya (sesi yang membaca issue/tiket/Telegram) baru ada di tahap 2. Penjaga tahap 1 terhadap poisoning: auto-aktif butuh jangkar yang **diverifikasi server**.

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `server/prisma/schema.prisma` (modify) | 3 model baru + `AgentToken.projectIds` + relasi `Project.memories` |
| `server/prisma/migrations/20261007120000_project_memory/migration.sql` (create) | DDL |
| `internal/docs/adr/0178-memori-project-bersama.md` (create) | keputusan |
| `shared/src/memory.ts` (create) | konstanta, zod DTO, tipe view, header repo |
| `shared/src/agent.ts` (modify) | capability `memory:*`, domain, `projectIds` di DTO token |
| `server/src/services/memory/rules.ts` (create) | murni: normalisasi remote, lattice, alasan review, duplikat, secret, glob, validasi path |
| `server/src/services/memory/git.ts` (create) | git async: HEAD, root commit, ada-commit, blob SHA |
| `server/src/services/memory/resolve.ts` (create) | principal + header → lingkup project |
| `server/src/services/memory/store.ts` (create) | propose/supersede/reverify/invalidate/review/get/search |
| `server/src/routes/memories.ts` (create) | REST |
| `server/src/services/agent-capabilities.ts`, `agent-auth.ts`, `agent-token.ts`, `routes/agent-tokens.ts`, `app.ts` (modify) | gerbang + token |
| `shared/src/mcp-catalog/types.ts`, `memory.ts`, `index.ts` (modify/create) | katalog tool |
| `cli/src/mcp/repo-context.ts` (create), `server.ts`, `client.ts` (modify) | enrichment identitas repo |
| `docs/agent-integration.md`, `internal/docs/architecture/data-model.md`, `api-contract.md`, `internal/docs/README.md` (modify) | docs |

---

### Task 1: Skema, migration, ADR, DTO shared

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Project` ±baris 10–41, `AgentToken` ±baris 435)
- Create: `server/prisma/migrations/20261007120000_project_memory/migration.sql`
- Create: `internal/docs/adr/0178-memori-project-bersama.md`
- Create: `shared/src/memory.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/memory.test.ts`, `server/test/memory-schema.test.ts`

**Interfaces:**
- Produces (shared): `MEMORY_KINDS`, `MEMORY_STATUSES`, `MEMORY_RUNTIMES`, `MemoryKind`, `MemoryStatus`, `zMemoryAnchorIn`, `zMemoryPropose`, `zMemoryReverify`, `zMemoryInvalidate`, `zMemoryReview`, `zRepoIdentity`, `RepoIdentity`, `REPO_HEADER = "x-hanoman-repo"`, `encodeRepoHeader(r)`, `decodeRepoHeader(v): RepoIdentity | null`, `MemoryAnchor`, `MemoryView`, `MemoryEventView`, `MEMORY_CONTENT_MAX = 500`.
- Produces (prisma): `prisma.projectMemory`, `prisma.memoryEvent`, `prisma.memoryLocalState`, `AgentToken.projectIds`.

- [x] **Step 1: Tulis test DTO shared yang gagal**

`shared/test/memory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MEMORY_CONTENT_MAX, decodeRepoHeader, encodeRepoHeader, zMemoryPropose,
} from "../src/memory";

const repo = { remote: "git@github.com:a/b.git", rootCommit: "a".repeat(40), head: "b".repeat(40) };

describe("DTO memori", () => {
  it("header repo bolak-balik tanpa kehilangan isi", () => {
    expect(decodeRepoHeader(encodeRepoHeader(repo))).toEqual(repo);
  });

  it("header rusak / bukan string → null, tak pernah melempar", () => {
    for (const v of [undefined, 42, "", "%%%", Buffer.from("{}").toString("base64url")])
      expect(decodeRepoHeader(v)).toBeNull();
  });

  it("propose menolak content kosong dan > batas", () => {
    const base = { kind: "fact", scopePaths: [], anchors: [] };
    expect(zMemoryPropose.safeParse({ ...base, content: "" }).success).toBe(false);
    expect(zMemoryPropose.safeParse({ ...base, content: "x".repeat(MEMORY_CONTENT_MAX + 1) }).success).toBe(false);
    expect(zMemoryPropose.safeParse({ ...base, content: "satu fakta" }).success).toBe(true);
  });

  it("propose menolak kind di luar katalog dan field project", () => {
    expect(zMemoryPropose.safeParse({ kind: "rule", content: "x", scopePaths: [], anchors: [] }).success).toBe(false);
    // strict: field tak dikenal (mis. projectId dari model) ditolak, bukan diabaikan diam-diam
    expect(zMemoryPropose.safeParse({ kind: "fact", content: "x", scopePaths: [], anchors: [], projectId: "p" }).success).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run shared/test/memory.test.ts`
Expected: FAIL — `Cannot find module '../src/memory'`.

- [x] **Step 3: Tulis `shared/src/memory.ts`**

```ts
import { z } from "zod";

// ADR-0178 · memori project bersama lintas runtime. Satu sumber untuk server, CLI MCP, dan UI.
export const MEMORY_KINDS = ["convention", "gotcha", "decision", "fact"] as const;
export const MEMORY_STATUSES = ["proposed", "active", "invalidated", "rejected"] as const;
// `human` = dibuat dari dashboard (cookie). `external` = agent token di luar sesi hanoman.
export const MEMORY_RUNTIMES = ["claude", "codex", "external", "human"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryRuntime = (typeof MEMORY_RUNTIMES)[number];

export const MEMORY_CONTENT_MAX = 500;
const SHA = /^[0-9a-f]{40,64}$/;

export const zMemoryAnchorIn = z.object({
  path: z.string().min(1).max(500),
  lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
  // Diisi PROSES (CLI MCP), bukan model. Server menimpanya bila checkout project tersedia.
  blobSha: z.string().regex(SHA).optional(),
}).strict();

export const zMemoryPropose = z.object({
  kind: z.enum(MEMORY_KINDS),
  content: z.string().trim().min(1).max(MEMORY_CONTENT_MAX),
  scopePaths: z.array(z.string().min(1).max(300)).max(20).default([]),
  anchors: z.array(zMemoryAnchorIn).max(10).default([]),
}).strict();

export const zMemoryReverify = z.object({ anchors: z.array(zMemoryAnchorIn).min(1).max(10) }).strict();
export const zMemoryInvalidate = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const zMemoryReview = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const zRepoIdentity = z.object({
  remote: z.string().min(1).max(500),
  rootCommit: z.string().regex(SHA),
  head: z.string().regex(SHA),
}).strict();
export type RepoIdentity = z.infer<typeof zRepoIdentity>;

// Header, bukan body/query: model tak pernah melihat atau mengisinya lewat inputSchema tool.
export const REPO_HEADER = "x-hanoman-repo";
export const encodeRepoHeader = (r: RepoIdentity): string =>
  Buffer.from(JSON.stringify(r), "utf8").toString("base64url");
export function decodeRepoHeader(v: unknown): RepoIdentity | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const p = zRepoIdentity.safeParse(JSON.parse(Buffer.from(v, "base64url").toString("utf8")));
    return p.success ? p.data : null;
  } catch { return null; }
}

export type MemoryAnchor = { path: string; blobSha: string; lines?: [number, number] };

export type MemoryView = {
  id: string; projectId: string; kind: MemoryKind; content: string;
  scopePaths: string[]; anchors: MemoryAnchor[]; status: MemoryStatus;
  supersedesId: string | null; reviewReason: string | null; trusted: boolean;
  source: {
    runtime: MemoryRuntime; sessionId: string | null; tokenId: string | null;
    deviceId: string | null; commitSha: string | null;
  };
  createdAt: string; updatedAt: string;
};

export type MemoryEventView = {
  id: string; op: string; actorKind: string; actorId: string | null;
  reason: string | null; createdAt: string;
};
```

Tambahkan di `shared/src/index.ts` (setelah `export * from "./agent";`):

```ts
export * from "./memory";
```

- [x] **Step 4: Jalankan test shared, pastikan lulus**

Run: `pnpm vitest --run shared/test/memory.test.ts`
Expected: PASS (4 test).

- [x] **Step 5: Ubah skema Prisma**

Di `model Project`, tambahkan relasi setelah baris `qaReports …`:

```prisma
  memories     ProjectMemory[]       // ADR-0178 · memori project bersama lintas runtime
```

Di `model AgentToken`, setelah `capabilities Json`:

```prisma
  // ADR-0178 · allowlist project. null/[] = token tak boleh menyentuh route memori sama sekali.
  projectIds   Json?
```

Tambahkan di akhir berkas:

```prisma
// ADR-0178 · satu fakta per baris. content/anchors/scopePaths/kind TAK PERNAH diedit — koreksi =
// baris baru dengan `supersedesId`. Hanya `status` yang bergerak, dan hanya naik (lattice).
model ProjectMemory {
  id              String   @id @default(cuid())
  projectId       String
  project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  kind            String   // convention | gotcha | decision | fact
  content         String
  scopePaths      Json     // string[] glob relatif root repo; [] = seluruh project
  anchors         Json     // [{path, blobSha, lines?}]
  status          String   // proposed | active | invalidated | rejected
  supersedesId    String?
  reviewReason    String?  // decision | no-anchor | anchor-unverified | untrusted-source
  sourceRuntime   String   // claude | codex | external | human
  sourceSessionId String?
  sourceTokenId   String?
  sourceDeviceId  String?  // diisi tahap sync
  commitSha       String?
  trusted         Boolean  @default(true)
  version         Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  events          MemoryEvent[]

  @@index([projectId, status])
}

// ADR-0178 · jejak audit append-only. Tak pernah di-update atau dihapus kecuali ikut cascade.
model MemoryEvent {
  id        String        @id @default(cuid())
  memoryId  String
  memory    ProjectMemory @relation(fields: [memoryId], references: [id], onDelete: Cascade)
  op        String        // propose | activate | reject | invalidate | supersede | reverify
  actorKind String        // user | token | session | system
  actorId   String?
  reason    String?
  createdAt DateTime      @default(now())

  @@index([memoryId, createdAt])
}

// ADR-0178 · LOCAL-ONLY (tak pernah disync): hasil verifikasi jangkar bergantung HEAD mesin ini.
model MemoryLocalState {
  memoryId       String    @id
  verdict        String    // valid | stale | unverifiable
  verifiedHead   String?
  lastVerifiedAt DateTime?
  lastUsedAt     DateTime?
}
```

- [x] **Step 6: Bangkitkan migration**

```bash
cd server
TMP=$(mktemp -d)
DATABASE_URL="file:$TMP/m.db" npx prisma migrate deploy --schema prisma/schema.prisma
DATABASE_URL="file:$TMP/m.db" npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script \
  > /tmp/project_memory.sql
mkdir -p prisma/migrations/20261007120000_project_memory
{ echo "-- ADR-0178 · memori project bersama lintas runtime"; cat /tmp/project_memory.sql; } \
  > prisma/migrations/20261007120000_project_memory/migration.sql
cat prisma/migrations/20261007120000_project_memory/migration.sql
```

Expected: SQL berisi `ALTER TABLE "AgentToken" ADD COLUMN "projectIds" JSONB;` (atau `TEXT`/`JSONB` sesuai Prisma SQLite), `CREATE TABLE "ProjectMemory"`, `"MemoryEvent"`, `"MemoryLocalState"`, dan dua `CREATE INDEX`. **Tidak** boleh ada `DROP` apa pun — bila ada, hentikan dan selidiki drift.

Verifikasi nol drift:

```bash
TMP2=$(mktemp -d)
DATABASE_URL="file:$TMP2/v.db" npx prisma migrate deploy --schema prisma/schema.prisma
DATABASE_URL="file:$TMP2/v.db" npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code && echo NO-DRIFT
npx prisma generate --schema prisma/schema.prisma
cd ..
```

Expected: `NO-DRIFT`.

- [x] **Step 7: Tulis test skema server**

`server/test/memory-schema.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";

const clean = async () => {
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.memoryLocalState.deleteMany();
  await prisma.project.deleteMany({ where: { id: "mem-schema" } });
};
beforeEach(clean);
afterAll(clean);

describe("skema memori (ADR-0178)", () => {
  it("memori + event tersimpan, dan ikut terhapus cascade bersama project", async () => {
    await prisma.project.create({ data: { id: "mem-schema", name: "m", desc: "", kind: "app" } });
    const m = await prisma.projectMemory.create({
      data: {
        projectId: "mem-schema", kind: "fact", content: "x", scopePaths: [], anchors: [],
        status: "proposed", sourceRuntime: "human",
        events: { create: { op: "propose", actorKind: "user", actorId: "u1" } },
      },
    });
    expect(await prisma.memoryEvent.count({ where: { memoryId: m.id } })).toBe(1);
    await prisma.project.delete({ where: { id: "mem-schema" } });
    expect(await prisma.projectMemory.count({ where: { id: m.id } })).toBe(0);
    expect(await prisma.memoryEvent.count({ where: { memoryId: m.id } })).toBe(0);
  });

  it("AgentToken.projectIds opsional (null default)", async () => {
    const t = await prisma.agentToken.create({
      data: { name: "t", tokenHash: "h-mem-schema", tokenPrefix: "p", capabilities: [] },
    });
    expect(t.projectIds).toBeNull();
    await prisma.agentToken.delete({ where: { id: t.id } });
  });
});
```

- [x] **Step 8: Jalankan test skema**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memory-schema.test.ts --no-file-parallelism`
Expected: PASS (2 test).

- [x] **Step 9: Tulis ADR-0178**

`internal/docs/adr/0178-memori-project-bersama.md`:

```markdown
# 0178 — Memori project bersama lintas runtime: entity SQLite, project ditentukan proses, lattice status

Tanggal: 2026-10-07 · Status: diterima · Spec: [desain](../../../docs/superpowers/specs/2026-10-07-shared-project-memory-design.md) · Riset: [shared agent memory](../research/research-shared-agent-memory.md)

## Konteks

Memori bawaan tiap runtime (Claude Code auto memory, Codex memories, Gemini) terpisah per runtime dan
per mesin. Operator ingin satu memori per project yang dipakai semua agen — sesi hanoman, agen luar
via MCP, lintas mesin/tim — dan **akurat** serta **tepat ke project-nya**.

## Keputusan

1. **Sumber kebenaran = SQLite hanoman** (`ProjectMemory`, `MemoryEvent` append-only,
   `MemoryLocalState` LOCAL-only). Markdown/vault hanya proyeksi di masa depan. Tanpa vector store
   atau graph DB (ADR-0086: satu berkas SQLite).
2. **Satu fakta per baris, immutable kecuali `status`.** Koreksi = baris baru ber-`supersedesId`;
   yang lama `invalidated` saat penggantinya `active`. Tak ada penghapusan diam-diam.
3. **Lattice status** `proposed < active < invalidated = rejected`; transisi hanya naik. Inilah yang
   kelak membuat merge sync deterministik tanpa modal `SyncConflict`.
4. **Project ditentukan proses, tak pernah model.** Cookie → `projectId` eksplisit dari UI. Agent
   token → header `x-hanoman-repo` (remote + root commit + HEAD) yang dihitung CLI MCP dari cwd,
   dicocokkan ke `Project.gitRemote` ternormalisasi, dibatasi allowlist `AgentToken.projectIds`.
   Agent token yang mengirim `projectId` ditolak 400; token tanpa allowlist ditolak 403.
5. **Auto-aktif bersyarat**: `kind ≠ decision` ∧ jangkar ≥ 1 ∧ jangkar diverifikasi server
   (`git rev-parse <head>:<path>` di checkout project) ∧ sumber tepercaya. Selain itu antrean review
   manusia; `activate`/`reject` cookie-only.
6. Capability baru `memory:read` / `memory:write` (domain `memory`).

## Penyimpangan dari spec di tahap 1

FTS5 ditunda (filter token di JS atas ≤ 500 baris per project; FTS5 berisiko drift migrate diff);
`sourceDeviceId` nullable sampai tahap sync; kolom `reviewReason`; runtime `human`; `trusted=true`
untuk semua sumber tahap 1 (sumber tak tepercaya lahir bersama suntik sesi di tahap 2).

## Konsekuensi

- Memori hanya seakurat jangkarnya; memori tanpa jangkar selalu lewat manusia.
- Device tanpa checkout project tak bisa memverifikasi jangkar → usulan dari sana tak auto-aktif.
- `TelegramMemory` tetap terpisah (scope `chatId`, ADR-0096).
```

- [x] **Step 10: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20261007120000_project_memory \
  shared/src/memory.ts shared/src/index.ts shared/test/memory.test.ts \
  server/test/memory-schema.test.ts internal/docs/adr/0178-memori-project-bersama.md
git commit -m "feat(memory): skema ProjectMemory/MemoryEvent/MemoryLocalState + DTO + ADR-0178"
```

---

### Task 2: Capability `memory:*`, allowlist `projectIds` pada agent token

**Files:**
- Modify: `shared/src/agent.ts` (`CAPABILITY_IDS`, `CAPABILITIES`, `CAPABILITY_DOMAINS`, `zAgentTokenView`, `zAgentTokenCreate`, `zAgentTokenPatch`)
- Modify: `server/src/services/agent-token.ts`, `server/src/services/agent-auth.ts:6-19`
- Modify: `server/src/services/agent-capabilities.ts` (di `capabilityForRoute`, sebelum cabang `scheduler`)
- Modify: `docs/agent-integration.md` (tabel domain, dekat baris `telegram` ±114)
- Test: `server/test/memory-token.test.ts`

**Interfaces:**
- Consumes: `prisma.agentToken.projectIds` (Task 1).
- Produces: `req.agent: { id: string; capabilities: string[]; projectIds: string[] | null }`; `verifyAgentToken(token)` mengembalikan bentuk yang sama; `issueAgentToken({name, capabilities, projectIds?, createdBy?})`; `patchAgentToken(id, {…, projectIds?})`; `AgentTokenView.projectIds: string[] | null`; `capabilityForRoute(m, "/api/memories…")` → `memory:read|write`, `/api/memories/:id/activate|reject` → `COOKIE_ONLY`.

- [x] **Step 1: Tulis test yang gagal**

`server/test/memory-token.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken, patchAgentToken, verifyAgentToken } from "../src/services/agent-token";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const app = buildApp();
const clean = async () => { await prisma.agentToken.deleteMany(); };
beforeEach(clean);
afterAll(clean);

describe("agent token · allowlist project (ADR-0178)", () => {
  it("projectIds tersimpan, terbaca di view dan di verifikasi", async () => {
    const { view, token } = await issueAgentToken({ name: "b", capabilities: ["memory:read"], projectIds: ["p1"] });
    expect(view.projectIds).toEqual(["p1"]);
    expect((await verifyAgentToken(token))?.projectIds).toEqual(["p1"]);
  });

  it("token lama tanpa projectIds → null, bukan []", async () => {
    const { view, token } = await issueAgentToken({ name: "b", capabilities: [] });
    expect(view.projectIds).toBeNull();
    expect((await verifyAgentToken(token))?.projectIds).toBeNull();
  });

  it("patch mengganti allowlist", async () => {
    const { view } = await issueAgentToken({ name: "b", capabilities: [], projectIds: ["p1"] });
    expect((await patchAgentToken(view.id, { projectIds: ["p2", "p3"] }))?.projectIds).toEqual(["p2", "p3"]);
  });
});

describe("peta capability /api/memories", () => {
  it("baca → memory:read, tulis → memory:write", () => {
    expect(capabilityForRoute("GET", "/api/memories")).toBe("memory:read");
    expect(capabilityForRoute("GET", "/api/memories/abc")).toBe("memory:read");
    expect(capabilityForRoute("POST", "/api/memories")).toBe("memory:write");
    expect(capabilityForRoute("POST", "/api/memories/abc/invalidate")).toBe("memory:write");
  });

  it("review manusia cookie-only", () => {
    expect(capabilityForRoute("POST", "/api/memories/abc/activate")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/memories/abc/reject")).toBe("COOKIE_ONLY");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memory-token.test.ts --no-file-parallelism`
Expected: FAIL (tipe `projectIds` tak dikenal / capability `memory:read` bukan anggota enum / `capabilityForRoute` mengembalikan nilai lain).

- [x] **Step 3: Ubah `shared/src/agent.ts`**

Di `CAPABILITY_IDS`, sebelum blok komentar `// ADR-0155 · akses KETIGA`:

```ts
  // ADR-0178 · memori project bersama. Domain TERSENDIRI, MENURUT METHOD: menulis memori mengubah
  // konteks yang dibaca SETIAP agen berikutnya di project itu. Review (activate/reject) cookie-only.
  "memory:read", "memory:write",
```

Di array `CAPABILITIES`, setelah entri `docs:read`, tambahkan:

```ts
  { id: "memory:read", domain: "memory", access: "read", label: "Memori — baca", desc: "Cari & baca memori project (dibatasi allowlist project token)." },
  { id: "memory:write", domain: "memory", access: "write", label: "Memori — tulis", desc: "Usulkan, gantikan, verifikasi ulang, batalkan memori project." },
```

Di `CAPABILITY_DOMAINS`, setelah entri `qa`:

```ts
  { domain: "memory", label: "Memori", desc: "Memori project bersama lintas runtime; butuh allowlist project pada token." },
```

Ganti tiga skema token:

```ts
export const zAgentTokenView = z.object({
  id: z.string(), name: z.string(), tokenPrefix: z.string(),
  capabilities: z.array(zCapability), enabled: z.boolean(),
  // ADR-0178 · null = token tak boleh menyentuh route memori.
  projectIds: z.array(z.string()).nullable(),
  createdBy: z.string().nullable(), createdAt: z.string(),
  lastUsedAt: z.string().nullable(), revokedAt: z.string().nullable(),
});
export type AgentTokenView = z.infer<typeof zAgentTokenView>;

export const zAgentTokenCreate = z.object({
  name: z.string().min(1),
  capabilities: z.array(zCapability),
  projectIds: z.array(z.string().min(1)).max(100).optional(),
});
export const zAgentTokenPatch = z.object({
  name: z.string().min(1).optional(),
  capabilities: z.array(zCapability).optional(),
  enabled: z.boolean().optional(),
  projectIds: z.array(z.string().min(1)).max(100).nullable().optional(),
});
```

- [x] **Step 4: Ubah `server/src/services/agent-token.ts`**

Tambah `projectIds: unknown;` di `type Row`, lalu:

```ts
const idsOf = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
```

Di `toAgentTokenView`, tambahkan setelah `capabilities: …,`:

```ts
    projectIds: idsOf(t.projectIds),
```

`issueAgentToken` — tanda tangan dan `data`:

```ts
export async function issueAgentToken(input: {
  name: string; capabilities: string[]; projectIds?: string[]; createdBy?: string;
}): Promise<{ view: AgentTokenView; token: string }> {
  const token = "hnm_agt_" + randomBytes(24).toString("hex"); // 48 hex chars
  const row = await prisma.agentToken.create({
    data: {
      name: input.name, tokenHash: hash(token), tokenPrefix: token.slice(0, 16),
      capabilities: input.capabilities, createdBy: input.createdBy ?? null,
      ...(input.projectIds !== undefined ? { projectIds: input.projectIds } : {}),
    },
  });
  return { view: toAgentTokenView(row as Row), token };
}
```

`verifyAgentToken` — tipe kembalian dan baris return:

```ts
export async function verifyAgentToken(token: string):
  Promise<{ id: string; capabilities: string[]; projectIds: string[] | null } | null> {
  // … isi tetap …
  return {
    id: row.id,
    capabilities: (Array.isArray(row.capabilities) ? row.capabilities : []) as string[],
    projectIds: idsOf(row.projectIds),
  };
}
```

`patchAgentToken` — tipe patch menerima `projectIds?: string[] | null`, dan di `data` tambahkan:

```ts
      ...(patch.projectIds !== undefined
        ? { projectIds: patch.projectIds === null ? Prisma.JsonNull : patch.projectIds } : {}),
```

dengan import `import { Prisma } from "@prisma/client";` di atas berkas.

- [x] **Step 5: Ubah `server/src/services/agent-auth.ts`**

```ts
declare module "fastify" {
  interface FastifyRequest { agent?: { id: string; capabilities: string[]; projectIds: string[] | null } }
}
```

dan tipe kembalian `authenticateAgent` menjadi `Promise<{ id: string; capabilities: string[]; projectIds: string[] | null } | null>`.

`server/src/services/launch-authority.ts:7` memakai `agent?: { id: string; capabilities: string[] } | null` — itu subset struktural, biarkan.

- [x] **Step 6: Ubah `capabilityForRoute`**

Di `server/src/services/agent-capabilities.ts`, tepat sebelum `if (top === "scheduler") {`:

```ts
  // ADR-0178 · memori project. Review (activate/reject) mengubah apa yang disuntik ke SETIAP sesi
  // berikutnya tanpa jangkar yang terverifikasi — itu keputusan manusia, bukan capability.
  if (top === "memories") {
    if (seg[2] === "activate" || seg[2] === "reject") return "COOKIE_ONLY";
    return rw("memory");
  }
```

- [x] **Step 7: Perbarui `docs/agent-integration.md`**

Di tabel domain capability, setelah baris `| \`telegram\` | …`:

```markdown
| `memory` | `/api/memories*` kecuali `…/activate` dan `…/reject` (cookie-only) | memori project bersama. Token **wajib** punya allowlist project (`projectIds`); project ditentukan dari header `x-hanoman-repo` yang diisi CLI MCP, bukan dari parameter (ADR-0178) |
```

- [x] **Step 8: Jalankan test**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memory-token.test.ts server/test/agent-gate.test.ts server/test/agent-doc-contract.test.ts shared/test/agent.test.ts --no-file-parallelism`
Expected: PASS semua. Bila `shared/test/agent.test.ts` menghitung jumlah capability secara literal, perbarui angkanya (+2) dan domain (+1).

- [x] **Step 9: Commit**

```bash
git add shared/src/agent.ts server/src/services/agent-token.ts server/src/services/agent-auth.ts \
  server/src/services/agent-capabilities.ts docs/agent-integration.md server/test/memory-token.test.ts shared/test/agent.test.ts
git commit -m "feat(memory): capability memory:* dan allowlist projectIds pada agent token"
```

---

### Task 3: Aturan murni (`rules.ts`)

**Files:**
- Create: `server/src/services/memory/rules.ts`
- Test: `server/test/memory-rules.test.ts`

**Interfaces:**
- Consumes: `MemoryKind`, `MemoryStatus` (Task 1).
- Produces:
  - `normalizeRemote(url: string): string | null`
  - `statusRank(s: MemoryStatus): number`, `canTransition(from, to): boolean`, `mergeStatus(a, b): MemoryStatus`
  - `reviewReason(i: { kind: MemoryKind; anchorsCount: number; anchorsVerified: boolean; trusted: boolean }): ReviewReason | null` dengan `type ReviewReason = "decision" | "no-anchor" | "anchor-unverified" | "untrusted-source"`
  - `isNearDuplicate(a: string, b: string): boolean`
  - `findSecret(text: string): string | null` (nama pola)
  - `safeRepoPath(p: string): boolean`
  - `globMatch(glob: string, path: string): boolean`, `scopeMatches(scopePaths: string[], paths: string[]): boolean`
  - `tokens(text: string): string[]`

- [x] **Step 1: Tulis test yang gagal**

`server/test/memory-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canTransition, findSecret, globMatch, isNearDuplicate, mergeStatus, normalizeRemote,
  reviewReason, safeRepoPath, scopeMatches,
} from "../src/services/memory/rules";

describe("normalizeRemote", () => {
  it("scp, https, ssh, dengan/tanpa .git → bentuk sama", () => {
    const want = "github.com/denameidina/hanoman";
    for (const u of [
      "git@github.com:denameidina/hanoman.git",
      "https://github.com/denameidina/hanoman",
      "https://github.com/DenaMeidina/Hanoman.git/",
      "ssh://git@github.com/denameidina/hanoman.git",
      "https://user:pass@github.com/denameidina/hanoman.git",
    ]) expect(normalizeRemote(u), u).toBe(want);
  });
  it("host berbeda → hasil berbeda (tak pernah salah cocok lintas host)", () => {
    expect(normalizeRemote("git@gitlab.com:denameidina/hanoman.git")).not.toBe(normalizeRemote("git@github.com:denameidina/hanoman.git"));
  });
  it("path lokal / file:// / sampah → null", () => {
    for (const u of ["/srv/repo", "file:///srv/repo", "", "nonsense"]) expect(normalizeRemote(u), u).toBeNull();
  });
});

describe("lattice status", () => {
  it("hanya naik", () => {
    expect(canTransition("proposed", "active")).toBe(true);
    expect(canTransition("active", "invalidated")).toBe(true);
    expect(canTransition("proposed", "rejected")).toBe(true);
    expect(canTransition("active", "proposed")).toBe(false);
    expect(canTransition("invalidated", "active")).toBe(false);
    expect(canTransition("rejected", "invalidated")).toBe(false);
    expect(canTransition("active", "active")).toBe(false);
  });
  it("merge: yang lebih tinggi menang, seri → yang pertama", () => {
    expect(mergeStatus("active", "invalidated")).toBe("invalidated");
    expect(mergeStatus("invalidated", "active")).toBe("invalidated");
    expect(mergeStatus("rejected", "invalidated")).toBe("rejected");
    expect(mergeStatus("proposed", "active")).toBe("active");
  });
});

describe("reviewReason", () => {
  const ok = { kind: "fact" as const, anchorsCount: 1, anchorsVerified: true, trusted: true };
  it("semua syarat terpenuhi → null (auto-aktif)", () => expect(reviewReason(ok)).toBeNull());
  it("urutan alasan", () => {
    expect(reviewReason({ ...ok, kind: "decision" })).toBe("decision");
    expect(reviewReason({ ...ok, anchorsCount: 0 })).toBe("no-anchor");
    expect(reviewReason({ ...ok, anchorsVerified: false })).toBe("anchor-unverified");
    expect(reviewReason({ ...ok, trusted: false })).toBe("untrusted-source");
  });
});

describe("isNearDuplicate", () => {
  it("beda kapitalisasi/tanda baca → duplikat", () => {
    expect(isNearDuplicate("Test server wajib --no-file-parallelism.", "test server WAJIB --no-file-parallelism")).toBe(true);
  });
  it("fakta berbeda → bukan duplikat", () => {
    expect(isNearDuplicate("Test server wajib --no-file-parallelism", "Migration butuh ADR baru")).toBe(false);
  });
});

describe("findSecret", () => {
  it("mendeteksi pola kredensial umum", () => {
    expect(findSecret("token hnm_agt_" + "a".repeat(48))).toBe("hanoman-token");
    expect(findSecret("ghp_" + "A".repeat(36))).toBe("github-token");
    expect(findSecret("AKIA" + "B".repeat(16))).toBe("aws-key");
    expect(findSecret("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe("private-key");
    expect(findSecret("sk-ant-" + "x".repeat(30))).toBe("api-key");
  });
  it("teks biasa → null", () => expect(findSecret("pakai pnpm vitest --run")).toBeNull());
});

describe("path & glob", () => {
  it("safeRepoPath menolak absolut dan ..", () => {
    expect(safeRepoPath("server/src/a.ts")).toBe(true);
    for (const p of ["/etc/passwd", "../x", "a/../../b", "a\\b", ""]) expect(safeRepoPath(p), p).toBe(false);
  });
  it("globMatch: ** lintas segmen, * dalam segmen", () => {
    expect(globMatch("server/src/**", "server/src/services/pty.ts")).toBe(true);
    expect(globMatch("server/*/x.ts", "server/src/x.ts")).toBe(true);
    expect(globMatch("server/*/x.ts", "server/src/a/x.ts")).toBe(false);
    expect(globMatch("src/**/*.tsx", "src/src/screens/A.tsx")).toBe(true);
  });
  it("scopeMatches: scope kosong = seluruh project", () => {
    expect(scopeMatches([], ["anything"])).toBe(true);
    expect(scopeMatches(["server/**"], ["src/a.ts"])).toBe(false);
    expect(scopeMatches(["server/**"], ["src/a.ts", "server/b.ts"])).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run server/test/memory-rules.test.ts`
Expected: FAIL — modul tak ditemukan.

- [x] **Step 3: Tulis `server/src/services/memory/rules.ts`**

```ts
// ADR-0178 · aturan murni memori project: tanpa DB, tanpa git, tanpa jam. Semua keputusan
// "boleh/tidak" yang bisa diuji tanpa I/O tinggal di sini.
import type { MemoryKind, MemoryStatus } from "@hanoman/shared";

/** `host/owner/repo` huruf kecil tanpa `.git`; null bila bukan remote jaringan yang dikenali. */
export function normalizeRemote(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  let host: string; let path: string;
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(t);
  if (scp && !t.includes("://")) { host = scp[1]!; path = scp[2]!; }
  else {
    let u: URL;
    try { u = new URL(t); } catch { return null; }
    if (!/^(https?|ssh|git):$/.test(u.protocol)) return null;
    host = u.hostname; path = u.pathname;
  }
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!host || !path.includes("/")) return null;
  return `${host.toLowerCase()}/${path.toLowerCase()}`;
}

const RANK: Record<MemoryStatus, number> = { proposed: 0, active: 1, invalidated: 2, rejected: 2 };
export const statusRank = (s: MemoryStatus): number => RANK[s];
export const canTransition = (from: MemoryStatus, to: MemoryStatus): boolean => RANK[to] > RANK[from];
/** Lattice monoton: yang lebih tinggi menang; seri → `a` (yang tercatat lebih dulu). */
export const mergeStatus = (a: MemoryStatus, b: MemoryStatus): MemoryStatus => (RANK[b] > RANK[a] ? b : a);

export type ReviewReason = "decision" | "no-anchor" | "anchor-unverified" | "untrusted-source";
export function reviewReason(i: {
  kind: MemoryKind; anchorsCount: number; anchorsVerified: boolean; trusted: boolean;
}): ReviewReason | null {
  if (i.kind === "decision") return "decision";
  if (i.anchorsCount === 0) return "no-anchor";
  if (!i.anchorsVerified) return "anchor-unverified";
  if (!i.trusted) return "untrusted-source";
  return null;
}

export const tokens = (text: string): string[] =>
  text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((w) => w.length >= 2);

/** Jaccard token ≥ 0.8. Sengaja kasar: tujuannya mengarahkan agen ke `supersede`, bukan dedup semantik. */
export function isNearDuplicate(a: string, b: string): boolean {
  const A = new Set(tokens(a)); const B = new Set(tokens(b));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.8;
}

const SECRETS: [string, RegExp][] = [
  ["hanoman-token", /hnm_(agt|dev)_[0-9a-f]{16,}/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["api-key", /\bsk-[A-Za-z0-9_-]{20,}/],
];
export function findSecret(text: string): string | null {
  for (const [name, re] of SECRETS) if (re.test(text)) return name;
  return null;
}

export const safeRepoPath = (p: string): boolean =>
  p.length > 0 && !p.startsWith("/") && !p.includes("\\") && !p.split("/").includes("..");

const globCache = new Map<string, RegExp>();
export function globMatch(glob: string, path: string): boolean {
  let re = globCache.get(glob);
  if (!re) {
    let src = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i]!;
      if (c === "*" && glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; src += "(?:.*/)?"; } else src += ".*";
      } else if (c === "*") src += "[^/]*";
      else if (c === "?") src += "[^/]";
      else src += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    re = new RegExp(`^${src}$`);
    globCache.set(glob, re);
  }
  return re.test(path);
}

export const scopeMatches = (scopePaths: string[], paths: string[]): boolean =>
  scopePaths.length === 0 || paths.some((p) => scopePaths.some((g) => globMatch(g, p)));
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run server/test/memory-rules.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/memory/rules.ts server/test/memory-rules.test.ts
git commit -m "feat(memory): aturan murni — normalisasi remote, lattice status, alasan review, duplikat, secret, glob"
```

---

### Task 4: Pembungkus git async (`git.ts`)

**Files:**
- Create: `server/src/services/memory/git.ts`
- Test: `server/test/memory-git.test.ts`

**Interfaces:**
- Consumes: `safeRepoPath` (Task 3).
- Produces: `repoHead(dir): Promise<string | null>`, `rootCommits(dir): Promise<string[]>`, `hasCommit(dir, sha): Promise<boolean>`, `blobShaAt(dir, commit, path): Promise<string | null>`.

- [x] **Step 1: Tulis test yang gagal**

`server/test/memory-git.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { blobShaAt, hasCommit, repoHead, rootCommits } from "../src/services/memory/git";

let dir = ""; let first = ""; let second = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-git-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), "one\n"); g("add", "."); g("commit", "-qm", "1"); first = g("rev-parse", "HEAD");
  writeFileSync(join(dir, "src/a.ts"), "two\n"); g("commit", "-qam", "2"); second = g("rev-parse", "HEAD");
});

describe("git memori", () => {
  it("HEAD dan root commit", async () => {
    expect(await repoHead(dir)).toBe(second);
    expect(await rootCommits(dir)).toEqual([first]);
  });
  it("hasCommit: ada / tak ada / bukan sha", async () => {
    expect(await hasCommit(dir, first)).toBe(true);
    expect(await hasCommit(dir, "f".repeat(40))).toBe(false);
    expect(await hasCommit(dir, "HEAD; rm -rf /")).toBe(false);
  });
  it("blobShaAt mengikuti commit, bukan working tree", async () => {
    const a = await blobShaAt(dir, first, "src/a.ts");
    const b = await blobShaAt(dir, second, "src/a.ts");
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).not.toBe(b);
    expect(b).toBe(g("rev-parse", `${second}:src/a.ts`));
  });
  it("path tak ada / direktori / path berbahaya → null", async () => {
    expect(await blobShaAt(dir, second, "src/none.ts")).toBeNull();
    expect(await blobShaAt(dir, second, "src")).toBeNull();
    expect(await blobShaAt(dir, second, "../etc/passwd")).toBeNull();
  });
  it("direktori bukan repo → null / []", async () => {
    const plain = mkdtempSync(join(tmpdir(), "mem-plain-"));
    expect(await repoHead(plain)).toBeNull();
    expect(await rootCommits(plain)).toEqual([]);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run server/test/memory-git.test.ts`
Expected: FAIL — modul tak ditemukan.

- [x] **Step 3: Tulis `server/src/services/memory/git.ts`**

```ts
// ADR-0178 · git untuk verifikasi jangkar memori. ASYNC dengan sengaja: dipanggil di jalur request,
// dan `execFileSync` di sana memblokir event loop (SPEC-878). Setiap kegagalan → null/[]/false;
// pemanggil yang memutuskan arti "tak bisa memverifikasi".
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safeRepoPath } from "./rules";

const run = promisify(execFile);
const SHA = /^[0-9a-f]{7,64}$/;

async function git(dir: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 5000 });
    return stdout.trim();
  } catch { return null; }
}

export const repoHead = (dir: string): Promise<string | null> => git(dir, ["rev-parse", "HEAD"]);

export async function rootCommits(dir: string): Promise<string[]> {
  const out = await git(dir, ["rev-list", "--max-parents=0", "HEAD"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

export async function hasCommit(dir: string, sha: string): Promise<boolean> {
  if (!SHA.test(sha)) return false;
  return (await git(dir, ["cat-file", "-e", `${sha}^{commit}`])) !== null;
}

/** Blob SHA berkas `path` pada `commit`; null bila path tak ada, bukan berkas, atau tak aman. */
export async function blobShaAt(dir: string, commit: string, path: string): Promise<string | null> {
  if (!SHA.test(commit) || !safeRepoPath(path)) return null;
  const spec = `${commit}:${path}`;
  if ((await git(dir, ["cat-file", "-t", spec])) !== "blob") return null;
  return git(dir, ["rev-parse", "--verify", "--quiet", spec]);
}
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run server/test/memory-git.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/memory/git.ts server/test/memory-git.test.ts
git commit -m "feat(memory): pembungkus git async untuk verifikasi jangkar"
```

---

### Task 5: Resolusi lingkup project (`resolve.ts`)

**Files:**
- Create: `server/src/services/memory/resolve.ts`
- Test: `server/test/memory-resolve.test.ts`

**Interfaces:**
- Consumes: `decodeRepoHeader`, `RepoIdentity` (Task 1); `normalizeRemote` (Task 3); `rootCommits`, `hasCommit`, `repoHead` (Task 4); `resolveRepoDir` dari `server/src/services/local-binding.ts`.
- Produces:
  ```ts
  type Principal =
    | { kind: "user"; userId: string }
    | { kind: "agent"; tokenId: string; projectIds: string[] | null };
  type MemoryScope = { projectId: string; repoDir: string | null; head: string | null; headVerified: boolean };
  type Fail = { ok: false; status: 400 | 403 | 404 | 409; body: Record<string, unknown> };
  type ResolveResult = { ok: true; scope: MemoryScope } | Fail;
  resolveMemoryScope(p: Principal, input: { repoHeader?: unknown; projectId?: string }): Promise<ResolveResult>
  ```

- [x] **Step 1: Tulis test yang gagal**

`server/test/memory-resolve.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encodeRepoHeader } from "@hanoman/shared";
import { prisma } from "../src/db";
import { resolveMemoryScope } from "../src/services/memory/resolve";

let dir = ""; let root = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const hdr = (o: Partial<{ remote: string; rootCommit: string; head: string }> = {}) =>
  encodeRepoHeader({ remote: "git@github.com:acme/alpha.git", rootCommit: root, head, ...o });
const agent = (projectIds: string[] | null) => ({ kind: "agent" as const, tokenId: "t1", projectIds });

const clean = async () => {
  await prisma.localBinding.deleteMany({ where: { projectId: { in: ["mr-a", "mr-b", "mr-c"] } } });
  await prisma.project.deleteMany({ where: { id: { in: ["mr-a", "mr-b", "mr-c"] } } });
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-res-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "a"), "1"); g("add", "."); g("commit", "-qm", "1");
  root = g("rev-parse", "HEAD"); head = root;
});
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "mr-a", name: "a", desc: "", kind: "app", gitRemote: "https://github.com/acme/alpha", repoDir: dir } });
  await prisma.project.create({ data: { id: "mr-b", name: "b", desc: "", kind: "app", gitRemote: "https://github.com/acme/beta" } });
});
afterAll(clean);

describe("resolveMemoryScope · agent token", () => {
  it("remote cocok + diizinkan → scope dengan head terverifikasi", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr() });
    expect(r).toEqual({ ok: true, scope: { projectId: "mr-a", repoDir: dir, head, headVerified: true } });
  });
  it("agent mengirim projectId → 400", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr(), projectId: "mr-a" });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
  it("token tanpa allowlist → 403 need projectIds", async () => {
    for (const ids of [null, []]) {
      const r = await resolveMemoryScope(agent(ids), { repoHeader: hdr() });
      expect(r).toMatchObject({ ok: false, status: 403, body: { need: "projectIds" } });
    }
  });
  it("tanpa header / header rusak → 400", async () => {
    expect(await resolveMemoryScope(agent(["mr-a"]), {})).toMatchObject({ ok: false, status: 400 });
    expect(await resolveMemoryScope(agent(["mr-a"]), { repoHeader: "rusak" })).toMatchObject({ ok: false, status: 400 });
  });
  it("ANTI-BOCOR: token untuk A dengan remote B → 403, bukan scope B", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr({ remote: "git@github.com:acme/beta.git" }) });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it("remote tak dikenal → 404", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr({ remote: "git@github.com:acme/zzz.git" }) });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
  it("root commit beda dari checkout project → 404 (remote dipalsukan)", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr({ rootCommit: "c".repeat(40) }) });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
  it("head tak ada di checkout server → headVerified false", async () => {
    const r = await resolveMemoryScope(agent(["mr-a"]), { repoHeader: hdr({ head: "d".repeat(40) }) });
    expect(r).toMatchObject({ ok: true, scope: { headVerified: false } });
  });
  it("project tanpa checkout → scope tanpa repoDir, headVerified false", async () => {
    const r = await resolveMemoryScope(agent(["mr-b"]), { repoHeader: hdr({ remote: "git@github.com:acme/beta.git" }) });
    expect(r).toEqual({ ok: true, scope: { projectId: "mr-b", repoDir: null, head, headVerified: false } });
  });
  it("dua project se-remote yang sama-sama diizinkan → 409", async () => {
    await prisma.project.create({ data: { id: "mr-c", name: "c", desc: "", kind: "app", gitRemote: "git@github.com:acme/alpha.git" } });
    const r = await resolveMemoryScope(agent(["mr-a", "mr-c"]), { repoHeader: hdr() });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("resolveMemoryScope · cookie", () => {
  it("projectId wajib", async () => {
    expect(await resolveMemoryScope({ kind: "user", userId: "u" }, {})).toMatchObject({ ok: false, status: 400 });
  });
  it("project tak ada → 404", async () => {
    expect(await resolveMemoryScope({ kind: "user", userId: "u" }, { projectId: "nope" })).toMatchObject({ ok: false, status: 404 });
  });
  it("head diambil dari checkout project", async () => {
    const r = await resolveMemoryScope({ kind: "user", userId: "u" }, { projectId: "mr-a" });
    expect(r).toEqual({ ok: true, scope: { projectId: "mr-a", repoDir: dir, head, headVerified: true } });
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memory-resolve.test.ts --no-file-parallelism`
Expected: FAIL — modul tak ditemukan.

- [x] **Step 3: Tulis `server/src/services/memory/resolve.ts`**

```ts
// ADR-0178 · siapa memanggil + dari repo mana → project yang SAH. Model tak pernah memilih project:
// cookie memilih lewat UI, agent token ditentukan identitas repo yang dihitung CLI MCP.
import { decodeRepoHeader } from "@hanoman/shared";
import { prisma } from "../../db";
import { resolveRepoDir } from "../local-binding";
import { hasCommit, repoHead, rootCommits } from "./git";
import { normalizeRemote } from "./rules";

export type Principal =
  | { kind: "user"; userId: string }
  | { kind: "agent"; tokenId: string; projectIds: string[] | null };
export type MemoryScope = { projectId: string; repoDir: string | null; head: string | null; headVerified: boolean };
export type Fail = { ok: false; status: 400 | 403 | 404 | 409; body: Record<string, unknown> };
export type ResolveResult = { ok: true; scope: MemoryScope } | Fail;

const fail = (status: Fail["status"], error: string, extra: Record<string, unknown> = {}): Fail =>
  ({ ok: false, status, body: { error, ...extra } });

export async function resolveMemoryScope(
  p: Principal, input: { repoHeader?: unknown; projectId?: string },
): Promise<ResolveResult> {
  if (p.kind === "user") {
    if (!input.projectId) return fail(400, "projectId wajib");
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) return fail(404, "project tidak ditemukan");
    const repoDir = await resolveRepoDir(project.id);
    const head = repoDir ? await repoHead(repoDir) : null;
    return { ok: true, scope: { projectId: project.id, repoDir, head, headVerified: head !== null } };
  }

  if (input.projectId)
    return fail(400, "projectId tidak diterima dari agent token; project ditentukan dari identitas repo");
  if (!p.projectIds?.length)
    return fail(403, "agent token tanpa allowlist project", { need: "projectIds" });
  const repo = decodeRepoHeader(input.repoHeader);
  if (!repo) return fail(400, "header x-hanoman-repo wajib (diisi CLI MCP hanoman dari direktori kerja)");
  const want = normalizeRemote(repo.remote);
  if (!want) return fail(404, "remote repo tidak dikenali");

  const candidates = await prisma.project.findMany({ where: { gitRemote: { not: null } }, select: { id: true, gitRemote: true } });
  const matches = candidates.filter((c) => normalizeRemote(c.gitRemote!) === want).map((c) => c.id);
  if (!matches.length) return fail(404, "tidak ada project dengan remote ini");
  const allowed = matches.filter((id) => p.projectIds!.includes(id));
  if (!allowed.length) return fail(403, "project repo ini tidak diizinkan untuk token ini", { need: "projectIds" });
  if (allowed.length > 1) return fail(409, "remote cocok dengan lebih dari satu project", { candidates: allowed });

  const projectId = allowed[0]!;
  const repoDir = await resolveRepoDir(projectId);
  let headVerified = false;
  if (repoDir) {
    const roots = await rootCommits(repoDir);
    // Remote bisa disalin siapa saja; root commit tidak. Checkout yang ada adalah pembanding.
    if (roots.length && !roots.includes(repo.rootCommit)) return fail(404, "root commit tidak cocok dengan checkout project");
    headVerified = await hasCommit(repoDir, repo.head);
  }
  return { ok: true, scope: { projectId, repoDir, head: repo.head, headVerified } };
}
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memory-resolve.test.ts --no-file-parallelism`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/memory/resolve.ts server/test/memory-resolve.test.ts
git commit -m "feat(memory): resolusi lingkup project dari principal + identitas repo"
```

---

### Task 6: Store memori (`store.ts`)

**Files:**
- Create: `server/src/services/memory/store.ts`
- Test: `server/test/memory-store.test.ts`

**Interfaces:**
- Consumes: `MemoryScope` (Task 5); `blobShaAt` (Task 4); `reviewReason`, `canTransition`, `isNearDuplicate`, `findSecret`, `safeRepoPath`, `scopeMatches`, `tokens` (Task 3); zod DTO & tipe view (Task 1).
- Produces:
  ```ts
  type Actor = { kind: "user"; id: string } | { kind: "token"; id: string };
  type StoreFail = { ok: false; status: 404 | 409 | 422; body: Record<string, unknown> };
  type Ok<T> = { ok: true } & T;
  proposeMemory(scope, actor, input: MemoryProposeInput): Promise<Ok<{ memory: MemoryView }> | StoreFail>
  supersedeMemory(scope, actor, id, input: MemoryProposeInput): Promise<Ok<{ memory: MemoryView }> | StoreFail>
  reverifyMemory(scope, actor, id, anchors: MemoryAnchorIn[]): Promise<Ok<{ memory: MemoryView }> | StoreFail>
  invalidateMemory(scope, actor, id, reason: string): Promise<Ok<{ memory: MemoryView }> | StoreFail>
  reviewMemory(projectId, userId, id, decision: "activate" | "reject", reason?: string): Promise<Ok<{ memory: MemoryView }> | StoreFail>
  getMemory(projectId, id): Promise<Ok<{ memory: MemoryView; events: MemoryEventView[] }> | StoreFail>
  searchMemories(projectId, q: { q?: string; paths?: string[]; status?: MemoryStatus }): Promise<{ items: MemoryView[]; total: number }>
  ```
  dengan `MemoryProposeInput = z.infer<typeof zMemoryPropose>`, `MemoryAnchorIn = z.infer<typeof zMemoryAnchorIn>`.

- [x] **Step 1: Tulis test yang gagal**

`server/test/memory-store.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import type { MemoryScope } from "../src/services/memory/resolve";
import {
  getMemory, invalidateMemory, proposeMemory, reverifyMemory, reviewMemory, searchMemories, supersedeMemory,
} from "../src/services/memory/store";

let dir = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const actor = { kind: "token" as const, id: "tok1" };
let scope: MemoryScope;
const unverified = (): MemoryScope => ({ ...scope, repoDir: null, headVerified: false });
const base = { kind: "gotcha" as const, scopePaths: [] as string[], anchors: [] as { path: string; blobSha?: string }[] };

const clean = async () => {
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.project.deleteMany({ where: { id: { in: ["ms-a", "ms-b"] } } });
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-store-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  mkdirSync(join(dir, "server")); writeFileSync(join(dir, "server/db.ts"), "x\n");
  g("add", "."); g("commit", "-qm", "1"); head = g("rev-parse", "HEAD");
});
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "ms-a", name: "a", desc: "", kind: "app", repoDir: dir } });
  await prisma.project.create({ data: { id: "ms-b", name: "b", desc: "", kind: "app" } });
  scope = { projectId: "ms-a", repoDir: dir, head, headVerified: true };
});
afterAll(clean);

const anchored = { ...base, anchors: [{ path: "server/db.ts" }] };

describe("proposeMemory", () => {
  it("jangkar terverifikasi server → langsung active, blobSha diisi server, event propose+activate", async () => {
    const r = await proposeMemory(scope, actor, { ...anchored, content: "DB test dihapus global-setup tiap run" });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.memory.status).toBe("active");
    expect(r.memory.anchors[0]!.blobSha).toBe(g("rev-parse", `${head}:server/db.ts`));
    expect(r.memory.source).toMatchObject({ runtime: "external", tokenId: "tok1", commitSha: head });
    const ev = await prisma.memoryEvent.findMany({ where: { memoryId: r.memory.id }, orderBy: { createdAt: "asc" } });
    // propose & activate lahir dalam satu transaksi → createdAt bisa seri; urutan tak dijanjikan.
    expect(ev.map((e) => e.op).sort()).toEqual(["activate", "propose"]);
  });

  it("tanpa jangkar → proposed, reviewReason no-anchor", async () => {
    const r = await proposeMemory(scope, actor, { ...base, content: "fakta tanpa jangkar" });
    expect(r).toMatchObject({ ok: true, memory: { status: "proposed", reviewReason: "no-anchor" } });
  });

  it("decision selalu review walau jangkar valid", async () => {
    const r = await proposeMemory(scope, actor, { ...anchored, kind: "decision", content: "pakai SQLite" });
    expect(r).toMatchObject({ ok: true, memory: { status: "proposed", reviewReason: "decision" } });
  });

  it("jangkar path tak ada → 422, tak tersimpan", async () => {
    const r = await proposeMemory(scope, actor, { ...base, anchors: [{ path: "nope.ts" }], content: "x y z" });
    expect(r).toMatchObject({ ok: false, status: 422, body: { anchor: "nope.ts" } });
    expect(await prisma.projectMemory.count()).toBe(0);
  });

  it("blobSha dari klien tak cocok dengan server → 422", async () => {
    const r = await proposeMemory(scope, actor, { ...base, anchors: [{ path: "server/db.ts", blobSha: "e".repeat(40) }], content: "a b c" });
    expect(r).toMatchObject({ ok: false, status: 422 });
  });

  it("server tak bisa memverifikasi: blobSha klien wajib, hasil proposed anchor-unverified", async () => {
    expect(await proposeMemory(unverified(), actor, { ...anchored, content: "a b c" })).toMatchObject({ ok: false, status: 422 });
    const r = await proposeMemory(unverified(), actor, { ...base, anchors: [{ path: "server/db.ts", blobSha: "e".repeat(40) }], content: "a b c" });
    expect(r).toMatchObject({ ok: true, memory: { status: "proposed", reviewReason: "anchor-unverified" } });
  });

  it("secret / path berbahaya → 422", async () => {
    expect(await proposeMemory(scope, actor, { ...base, content: "token ghp_" + "A".repeat(36) })).toMatchObject({ ok: false, status: 422 });
    expect(await proposeMemory(scope, actor, { ...base, scopePaths: ["../x"], content: "a b" })).toMatchObject({ ok: false, status: 422 });
  });

  it("duplikat memori active di project sama → 409 duplicateOf; di project lain boleh", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "Test server wajib no-file-parallelism" });
    if (!a.ok) throw new Error("setup");
    const dup = await proposeMemory(scope, actor, { ...anchored, content: "test server WAJIB no-file-parallelism." });
    expect(dup).toMatchObject({ ok: false, status: 409, body: { duplicateOf: a.memory.id } });
    const other = await proposeMemory({ projectId: "ms-b", repoDir: null, head, headVerified: false }, actor,
      { ...base, content: "Test server wajib no-file-parallelism" });
    expect(other.ok).toBe(true);
  });
});

describe("koreksi & review", () => {
  it("supersede: pengganti active → lama invalidated dengan event supersede", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "port default 8787" });
    if (!a.ok) throw new Error("setup");
    const b = await supersedeMemory(scope, actor, a.memory.id, { ...anchored, content: "port default 8787 kecuali PORT di-set" });
    expect(b).toMatchObject({ ok: true, memory: { status: "active", supersedesId: a.memory.id } });
    expect((await prisma.projectMemory.findUnique({ where: { id: a.memory.id } }))?.status).toBe("invalidated");
  });

  it("supersede yang masuk review: lama tetap active sampai pengganti disetujui manusia", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "fakta lama sekali" });
    if (!a.ok) throw new Error("setup");
    const b = await supersedeMemory(scope, actor, a.memory.id, { ...base, content: "fakta baru tanpa jangkar" });
    if (!b.ok) throw new Error("setup b");
    expect(b.memory.status).toBe("proposed");
    expect((await prisma.projectMemory.findUnique({ where: { id: a.memory.id } }))?.status).toBe("active");
    await reviewMemory("ms-a", "u1", b.memory.id, "activate");
    expect((await prisma.projectMemory.findUnique({ where: { id: a.memory.id } }))?.status).toBe("invalidated");
  });

  it("reverify membuat baris baru berisi sama dengan jangkar segar", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "isi yang sama" });
    if (!a.ok) throw new Error("setup");
    const r = await reverifyMemory(scope, actor, a.memory.id, [{ path: "server/db.ts" }]);
    expect(r).toMatchObject({ ok: true, memory: { content: "isi yang sama", supersedesId: a.memory.id, status: "active" } });
  });

  it("invalidate: alasan tercatat; tak bisa diulang (409)", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "akan salah" });
    if (!a.ok) throw new Error("setup");
    expect(await invalidateMemory(scope, actor, a.memory.id, "salah sejak SPEC-1")).toMatchObject({ ok: true, memory: { status: "invalidated" } });
    expect(await invalidateMemory(scope, actor, a.memory.id, "lagi")).toMatchObject({ ok: false, status: 409 });
  });

  it("review hanya untuk proposed; reject wajib alasan", async () => {
    const p = await proposeMemory(scope, actor, { ...base, content: "butuh review" });
    if (!p.ok) throw new Error("setup");
    expect(await reviewMemory("ms-a", "u1", p.memory.id, "reject")).toMatchObject({ ok: false, status: 422 });
    expect(await reviewMemory("ms-a", "u1", p.memory.id, "reject", "tak relevan")).toMatchObject({ ok: true, memory: { status: "rejected" } });
    expect(await reviewMemory("ms-a", "u1", p.memory.id, "activate")).toMatchObject({ ok: false, status: 409 });
  });

  it("ANTI-BOCOR: id milik project lain → 404 di semua operasi", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "rahasia project a" });
    if (!a.ok) throw new Error("setup");
    const sb: MemoryScope = { projectId: "ms-b", repoDir: null, head, headVerified: false };
    expect(await getMemory("ms-b", a.memory.id)).toMatchObject({ ok: false, status: 404 });
    expect(await invalidateMemory(sb, actor, a.memory.id, "x")).toMatchObject({ ok: false, status: 404 });
    expect(await supersedeMemory(sb, actor, a.memory.id, { ...base, content: "y" })).toMatchObject({ ok: false, status: 404 });
    expect(await reviewMemory("ms-b", "u1", a.memory.id, "activate")).toMatchObject({ ok: false, status: 404 });
    expect((await searchMemories("ms-b", {})).items).toEqual([]);
  });
});

describe("get & search", () => {
  it("get mengembalikan riwayat event", async () => {
    const a = await proposeMemory(scope, actor, { ...anchored, content: "punya riwayat" });
    if (!a.ok) throw new Error("setup");
    const r = await getMemory("ms-a", a.memory.id);
    if (!r.ok) throw new Error("get");
    expect(r.events.map((e) => e.op).sort()).toEqual(["activate", "propose"]);
  });

  it("search: default active, token query, filter path", async () => {
    await proposeMemory(scope, actor, { ...anchored, scopePaths: ["server/**"], content: "prisma migrate butuh ADR" });
    await proposeMemory(scope, actor, { ...anchored, scopePaths: ["src/**"], content: "komponen react pakai design system" });
    await proposeMemory(scope, actor, { ...base, content: "prisma usulan belum direview" });
    expect((await searchMemories("ms-a", { q: "prisma" })).items.map((m) => m.content)).toEqual(["prisma migrate butuh ADR"]);
    expect((await searchMemories("ms-a", { paths: ["src/x.tsx"] })).items.map((m) => m.content)).toEqual(["komponen react pakai design system"]);
    expect((await searchMemories("ms-a", { status: "proposed" })).total).toBe(1);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memory-store.test.ts --no-file-parallelism`
Expected: FAIL — modul tak ditemukan.

- [x] **Step 3: Tulis `server/src/services/memory/store.ts`**

```ts
// ADR-0178 · store memori project. Setiap fungsi menerima lingkup yang SUDAH diresolusi
// (resolve.ts) dan tak pernah membaca projectId dari input pemanggil. Semua query baca/tulis
// difilter `projectId` — id milik project lain berperilaku persis seperti id yang tak ada (404).
import type {
  MemoryAnchor, MemoryEventView, MemoryKind, MemoryStatus, MemoryView, zMemoryAnchorIn, zMemoryPropose,
} from "@hanoman/shared";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db";
import { blobShaAt } from "./git";
import type { MemoryScope } from "./resolve";
import {
  canTransition, findSecret, isNearDuplicate, reviewReason, safeRepoPath, scopeMatches, tokens,
} from "./rules";

export type MemoryProposeInput = z.infer<typeof zMemoryPropose>;
export type MemoryAnchorIn = z.infer<typeof zMemoryAnchorIn>;
export type Actor = { kind: "user"; id: string } | { kind: "token"; id: string };
export type StoreFail = { ok: false; status: 404 | 409 | 422; body: Record<string, unknown> };
type Ok<T> = { ok: true } & T;
type Row = Prisma.ProjectMemoryGetPayload<object>;

const SEARCH_CAP = 500;
const fail = (status: StoreFail["status"], error: string, extra: Record<string, unknown> = {}): StoreFail =>
  ({ ok: false, status, body: { error, ...extra } });

export function toMemoryView(r: Row): MemoryView {
  return {
    id: r.id, projectId: r.projectId, kind: r.kind as MemoryKind, content: r.content,
    scopePaths: (r.scopePaths as string[]) ?? [], anchors: (r.anchors as MemoryAnchor[]) ?? [],
    status: r.status as MemoryStatus, supersedesId: r.supersedesId, reviewReason: r.reviewReason,
    trusted: r.trusted,
    source: {
      runtime: r.sourceRuntime as MemoryView["source"]["runtime"], sessionId: r.sourceSessionId,
      tokenId: r.sourceTokenId, deviceId: r.sourceDeviceId, commitSha: r.commitSha,
    },
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

const actorKind = (a: Actor) => (a.kind === "user" ? "user" : "token");

function validate(input: MemoryProposeInput): StoreFail | null {
  const secret = findSecret(input.content);
  if (secret) return fail(422, "content tampak berisi kredensial; memori tak boleh menyimpan secret", { reason: secret });
  for (const p of [...input.scopePaths, ...input.anchors.map((a) => a.path)])
    if (!safeRepoPath(p)) return fail(422, "path harus relatif root repo tanpa `..`", { path: p });
  return null;
}

/** Server menimpa blobSha bila ia bisa membaca commit-nya; selain itu blobSha klien wajib ada. */
async function verifyAnchors(scope: MemoryScope, anchors: MemoryAnchorIn[]):
  Promise<Ok<{ anchors: MemoryAnchor[]; verified: boolean }> | StoreFail> {
  if (!anchors.length) return { ok: true, anchors: [], verified: false };
  const out: MemoryAnchor[] = [];
  if (scope.repoDir && scope.head && scope.headVerified) {
    for (const a of anchors) {
      const actual = await blobShaAt(scope.repoDir, scope.head, a.path);
      if (!actual) return fail(422, "jangkar tidak ditemukan pada commit pengusul", { anchor: a.path });
      if (a.blobSha && a.blobSha !== actual) return fail(422, "blob SHA jangkar tidak cocok", { anchor: a.path });
      out.push({ path: a.path, blobSha: actual, ...(a.lines ? { lines: a.lines } : {}) });
    }
    return { ok: true, anchors: out, verified: true };
  }
  for (const a of anchors) {
    if (!a.blobSha) return fail(422, "jangkar tanpa blobSha tak dapat diverifikasi di mesin ini", { anchor: a.path });
    out.push({ path: a.path, blobSha: a.blobSha, ...(a.lines ? { lines: a.lines } : {}) });
  }
  return { ok: true, anchors: out, verified: false };
}

/** Saat sebuah memori menjadi active, yang digantikannya (bila masih bisa) menjadi invalidated. */
async function retireSuperseded(tx: Prisma.TransactionClient, m: Row, actor: { kind: string; id: string | null }) {
  if (!m.supersedesId) return;
  const old = await tx.projectMemory.findFirst({ where: { id: m.supersedesId, projectId: m.projectId } });
  if (!old || !canTransition(old.status as MemoryStatus, "invalidated")) return;
  await tx.projectMemory.update({ where: { id: old.id }, data: { status: "invalidated", version: { increment: 1 } } });
  await tx.memoryEvent.create({
    data: { memoryId: old.id, op: "supersede", actorKind: actor.kind, actorId: actor.id, reason: `digantikan ${m.id}` },
  });
}

async function create(
  scope: MemoryScope, actor: Actor, input: MemoryProposeInput,
  opts: { supersedesId?: string; skipDuplicate?: boolean } = {},
): Promise<Ok<{ memory: MemoryView }> | StoreFail> {
  const bad = validate(input);
  if (bad) return bad;
  const v = await verifyAnchors(scope, input.anchors);
  if (!v.ok) return v;

  if (!opts.skipDuplicate) {
    const actives = await prisma.projectMemory.findMany({
      where: { projectId: scope.projectId, status: "active", ...(opts.supersedesId ? { id: { not: opts.supersedesId } } : {}) },
      select: { id: true, content: true }, take: SEARCH_CAP,
    });
    const dup = actives.find((a) => isNearDuplicate(a.content, input.content));
    if (dup) return fail(409, "memori serupa sudah ada; pakai supersede bila ingin mengoreksinya", { duplicateOf: dup.id });
  }

  const trusted = true; // ADR-0178 · tahap 1: semua sumber tepercaya; sesi tak tepercaya lahir di tahap 2.
  const reason = reviewReason({ kind: input.kind, anchorsCount: v.anchors.length, anchorsVerified: v.verified, trusted });
  const status: MemoryStatus = reason ? "proposed" : "active";
  const who = { kind: actorKind(actor), id: actor.id };

  const row = await prisma.$transaction(async (tx) => {
    const m = await tx.projectMemory.create({
      data: {
        projectId: scope.projectId, kind: input.kind, content: input.content,
        scopePaths: input.scopePaths, anchors: v.anchors, status, reviewReason: reason,
        supersedesId: opts.supersedesId ?? null,
        sourceRuntime: actor.kind === "user" ? "human" : "external",
        sourceTokenId: actor.kind === "token" ? actor.id : null,
        commitSha: scope.head, trusted,
      },
    });
    await tx.memoryEvent.create({ data: { memoryId: m.id, op: "propose", actorKind: who.kind, actorId: who.id, reason } });
    if (status === "active") {
      await tx.memoryEvent.create({ data: { memoryId: m.id, op: "activate", actorKind: "system", actorId: null, reason: "auto: jangkar terverifikasi" } });
      await retireSuperseded(tx, m, who);
    }
    return m;
  });
  return { ok: true, memory: toMemoryView(row) };
}

export const proposeMemory = (scope: MemoryScope, actor: Actor, input: MemoryProposeInput) => create(scope, actor, input);

async function findActive(projectId: string, id: string): Promise<Row | StoreFail> {
  const m = await prisma.projectMemory.findFirst({ where: { id, projectId } });
  if (!m) return fail(404, "memori tidak ditemukan");
  if (m.status !== "active") return fail(409, `memori berstatus ${m.status}, bukan active`);
  return m;
}

export async function supersedeMemory(scope: MemoryScope, actor: Actor, id: string, input: MemoryProposeInput) {
  const old = await findActive(scope.projectId, id);
  if ("ok" in old) return old;
  return create(scope, actor, input, { supersedesId: old.id });
}

export async function reverifyMemory(scope: MemoryScope, actor: Actor, id: string, anchors: MemoryAnchorIn[]) {
  const old = await findActive(scope.projectId, id);
  if ("ok" in old) return old;
  return create(scope, actor, {
    kind: old.kind as MemoryKind, content: old.content, scopePaths: old.scopePaths as string[], anchors,
  }, { supersedesId: old.id, skipDuplicate: true });
}

export async function invalidateMemory(scope: MemoryScope, actor: Actor, id: string, reason: string):
  Promise<Ok<{ memory: MemoryView }> | StoreFail> {
  const m = await prisma.projectMemory.findFirst({ where: { id, projectId: scope.projectId } });
  if (!m) return fail(404, "memori tidak ditemukan");
  if (!canTransition(m.status as MemoryStatus, "invalidated")) return fail(409, `memori berstatus ${m.status}`);
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.projectMemory.update({ where: { id }, data: { status: "invalidated", version: { increment: 1 } } });
    await tx.memoryEvent.create({ data: { memoryId: id, op: "invalidate", actorKind: actorKind(actor), actorId: actor.id, reason } });
    return u;
  });
  return { ok: true, memory: toMemoryView(row) };
}

export async function reviewMemory(projectId: string, userId: string, id: string, decision: "activate" | "reject", reason?: string):
  Promise<Ok<{ memory: MemoryView }> | StoreFail> {
  const m = await prisma.projectMemory.findFirst({ where: { id, projectId } });
  if (!m) return fail(404, "memori tidak ditemukan");
  if (m.status !== "proposed") return fail(409, `hanya memori proposed yang bisa direview (sekarang ${m.status})`);
  if (decision === "reject" && !reason?.trim()) return fail(422, "penolakan wajib menyertakan alasan");
  const to: MemoryStatus = decision === "activate" ? "active" : "rejected";
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.projectMemory.update({ where: { id }, data: { status: to, version: { increment: 1 } } });
    await tx.memoryEvent.create({ data: { memoryId: id, op: decision, actorKind: "user", actorId: userId, reason: reason?.trim() || null } });
    if (to === "active") await retireSuperseded(tx, u, { kind: "user", id: userId });
    return u;
  });
  return { ok: true, memory: toMemoryView(row) };
}

export async function getMemory(projectId: string, id: string):
  Promise<Ok<{ memory: MemoryView; events: MemoryEventView[] }> | StoreFail> {
  const m = await prisma.projectMemory.findFirst({
    where: { id, projectId }, include: { events: { orderBy: { createdAt: "asc" } } },
  });
  if (!m) return fail(404, "memori tidak ditemukan");
  return {
    ok: true, memory: toMemoryView(m),
    events: m.events.map((e) => ({
      id: e.id, op: e.op, actorKind: e.actorKind, actorId: e.actorId, reason: e.reason, createdAt: e.createdAt.toISOString(),
    })),
  };
}

export async function searchMemories(projectId: string, q: { q?: string; paths?: string[]; status?: MemoryStatus }):
  Promise<{ items: MemoryView[]; total: number }> {
  const rows = await prisma.projectMemory.findMany({
    where: { projectId, status: q.status ?? "active" }, orderBy: { createdAt: "desc" }, take: SEARCH_CAP,
  });
  const want = q.q ? tokens(q.q) : [];
  const items = rows
    .filter((r) => want.every((w) => r.content.toLowerCase().includes(w)))
    .filter((r) => !q.paths?.length || scopeMatches(r.scopePaths as string[], q.paths))
    .map(toMemoryView);
  return { items, total: items.length };
}
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memory-store.test.ts --no-file-parallelism`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/memory/store.ts server/test/memory-store.test.ts
git commit -m "feat(memory): store — propose/supersede/reverify/invalidate/review/get/search"
```

---

### Task 7: REST `/api/memories/*`

**Files:**
- Create: `server/src/routes/memories.ts`
- Modify: `server/src/app.ts` (import ±baris 62, register ±baris 276–280)
- Test: `server/test/memories.route.test.ts`

**Interfaces:**
- Consumes: `resolveMemoryScope`, `Principal` (Task 5); fungsi store (Task 6); `REPO_HEADER`, zod DTO (Task 1); `req.agent.projectIds` (Task 2).
- Produces (HTTP, prefix `/api`):

| Method & path | Principal | Body / query | Sukses |
|---|---|---|---|
| `GET /memories` | cookie (`?projectId=`) / token (header repo) | `q?`, `paths?` (dipisah koma), `status?` | `200 {items,total}` |
| `GET /memories/:id` | sama | — | `200 {memory, events}` |
| `POST /memories` | sama | `zMemoryPropose` (+ `projectId` hanya cookie) | `201 {memory}` |
| `POST /memories/:id/supersede` | sama | `zMemoryPropose` | `201 {memory}` |
| `POST /memories/:id/reverify` | sama | `zMemoryReverify` | `201 {memory}` |
| `POST /memories/:id/invalidate` | sama | `zMemoryInvalidate` | `200 {memory}` |
| `POST /memories/:id/activate` | cookie saja | `zMemoryReview` + `?projectId=` | `200 {memory}` |
| `POST /memories/:id/reject` | cookie saja | `zMemoryReview` + `?projectId=` | `200 {memory}` |

- [ ] **Step 1: Tulis test yang gagal**

`server/test/memories.route.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REPO_HEADER, encodeRepoHeader } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";

const app = buildApp();
let dir = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const repoA = () => encodeRepoHeader({ remote: "git@github.com:acme/alpha.git", rootCommit: head, head });
const repoB = () => encodeRepoHeader({ remote: "git@github.com:acme/beta.git", rootCommit: head, head });

const blob = { model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true };
const clean = async () => {
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.project.deleteMany({ where: { id: { in: ["rt-a", "rt-b"] } } });
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-route-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "x\n"); g("add", "."); g("commit", "-qm", "1"); head = g("rev-parse", "HEAD");
});
beforeEach(async () => {
  await clean();
  await prisma.setting.create({ data: { id: 1, data: blob } });
  await prisma.project.create({ data: { id: "rt-a", name: "a", desc: "", kind: "app", gitRemote: "https://github.com/acme/alpha", repoDir: dir } });
  await prisma.project.create({ data: { id: "rt-b", name: "b", desc: "", kind: "app", gitRemote: "https://github.com/acme/beta" } });
});
afterAll(clean);

const tokenFor = async (projectIds: string[] | undefined, caps = ["memory:write"]) =>
  (await issueAgentToken({ name: "bot", capabilities: caps as never, projectIds })).token;
const H = (token: string, repo = repoA()) => ({ authorization: `Bearer ${token}`, [REPO_HEADER]: repo });
const fact = { kind: "fact", content: "README ada di root", scopePaths: [], anchors: [{ path: "README.md" }] };

describe("/api/memories · agent token", () => {
  it("propose → 201 active, lalu search & get menemukannya", async () => {
    const t = await tokenFor(["rt-a"]);
    const p = await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: fact });
    expect(p.statusCode).toBe(201);
    const id = p.json().memory.id;
    expect(p.json().memory.status).toBe("active");
    const s = await app.inject({ method: "GET", url: "/api/memories?q=readme", headers: H(t) });
    expect(s.json().items.map((m: { id: string }) => m.id)).toEqual([id]);
    const gg = await app.inject({ method: "GET", url: `/api/memories/${id}`, headers: H(t) });
    expect(gg.json().events.length).toBe(2);
  });

  it("tanpa capability → 403 need memory:read", async () => {
    const t = await tokenFor(["rt-a"], ["projects:read"]);
    const r = await app.inject({ method: "GET", url: "/api/memories", headers: H(t) });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("memory:read");
  });

  it("token tanpa allowlist → 403 need projectIds", async () => {
    const t = await tokenFor(undefined);
    const r = await app.inject({ method: "GET", url: "/api/memories", headers: H(t) });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("projectIds");
  });

  it("agent mengirim projectId (query/body) → 400", async () => {
    const t = await tokenFor(["rt-a"]);
    expect((await app.inject({ method: "GET", url: "/api/memories?projectId=rt-a", headers: H(t) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: { ...fact, projectId: "rt-a" } })).statusCode).toBe(400);
  });

  it("ANTI-BOCOR: token A + repo B → 403; token A tak bisa membaca id memori B", async () => {
    const tA = await tokenFor(["rt-a"]); const tB = await tokenFor(["rt-b"]);
    expect((await app.inject({ method: "GET", url: "/api/memories", headers: H(tA, repoB()) })).statusCode).toBe(403);
    const pb = await app.inject({ method: "POST", url: "/api/memories", headers: H(tB, repoB()),
      payload: { kind: "fact", content: "rahasia beta", scopePaths: [], anchors: [] } });
    expect(pb.statusCode).toBe(201);
    const idB = pb.json().memory.id;
    expect((await app.inject({ method: "GET", url: `/api/memories/${idB}`, headers: H(tA) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/memories/${idB}/invalidate`, headers: H(tA), payload: { reason: "x" } })).statusCode).toBe(404);
  });

  it("activate/reject cookie-only untuk agent token", async () => {
    const t = await tokenFor(["rt-a"]);
    const r = await app.inject({ method: "POST", url: "/api/memories/abc/activate", headers: H(t), payload: {} });
    expect(r.statusCode).toBe(403);
  });

  it("galat terpetakan: 422 jangkar, 409 duplikat, 400 body", async () => {
    const t = await tokenFor(["rt-a"]);
    const bad = await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: { ...fact, anchors: [{ path: "none.md" }] } });
    expect(bad.statusCode).toBe(422);
    await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: fact });
    const dup = await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: fact });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().duplicateOf).toEqual(expect.any(String));
    expect((await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: { kind: "x" } })).statusCode).toBe(400);
  });
});
```

Blok cookie memakai pola `POST /api/auth/setup` (user pertama → cookie) seperti `server/test/remote-control.route.test.ts:22-26`. Karena setup hanya berhasil saat belum ada user, `clean` di atas wajib ikut menghapus sesi & user — tambahkan `await prisma.session.deleteMany(); await prisma.user.deleteMany();` ke dalamnya. Lalu tambahkan:

```ts
const cookieHeader = async () => {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return { cookie: (r.headers["set-cookie"] as string).split(";")[0]! };
};

describe("/api/memories · cookie", () => {
  it("cookie wajib projectId; review activate memindahkan proposed → active", async () => {
    const c = await cookieHeader();
    expect((await app.inject({ method: "GET", url: "/api/memories", headers: c })).statusCode).toBe(400);
    const p = await app.inject({ method: "POST", url: "/api/memories", headers: c,
      payload: { projectId: "rt-a", kind: "decision", content: "pakai SQLite", scopePaths: [], anchors: [] } });
    expect(p.statusCode).toBe(201);
    expect(p.json().memory).toMatchObject({ status: "proposed", source: { runtime: "human" } });
    const a = await app.inject({ method: "POST", url: `/api/memories/${p.json().memory.id}/activate?projectId=rt-a`, headers: c, payload: {} });
    expect(a.statusCode).toBe(200);
    expect(a.json().memory.status).toBe("active");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memories.route.test.ts --no-file-parallelism`
Expected: FAIL — 404 pada semua route.

- [ ] **Step 3: Tulis `server/src/routes/memories.ts`**

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  MEMORY_STATUSES, REPO_HEADER, zMemoryInvalidate, zMemoryPropose, zMemoryReverify, zMemoryReview,
} from "@hanoman/shared";
import { resolveMemoryScope, type MemoryScope, type Principal } from "../services/memory/resolve";
import {
  getMemory, invalidateMemory, proposeMemory, reverifyMemory, reviewMemory, searchMemories, supersedeMemory,
  type Actor,
} from "../services/memory/store";

// ADR-0178 · memori project bersama. Project TAK PERNAH dibaca dari input agen: cookie memilih
// lewat `projectId`, agent token lewat header identitas repo yang diisi CLI MCP.
const zSearch = z.object({
  q: z.string().max(200).optional(),
  paths: z.string().max(2000).optional(),
  status: z.enum(MEMORY_STATUSES).optional(),
  projectId: z.string().optional(),
});
const zWithProject = <T extends z.ZodRawShape>(s: z.ZodObject<T>) => s.extend({ projectId: z.string().optional() });

function principalOf(req: FastifyRequest): Principal | null {
  if (req.user) return { kind: "user", userId: req.user.id };
  if (req.agent) return { kind: "agent", tokenId: req.agent.id, projectIds: req.agent.projectIds };
  return null;
}
const actorOf = (p: Principal): Actor => (p.kind === "user" ? { kind: "user", id: p.userId } : { kind: "token", id: p.tokenId });

async function scopeOr(req: FastifyRequest, reply: FastifyReply, projectId?: string):
  Promise<{ scope: MemoryScope; principal: Principal } | null> {
  const principal = principalOf(req);
  if (!principal) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const r = await resolveMemoryScope(principal, { repoHeader: req.headers[REPO_HEADER], projectId });
  if (!r.ok) { reply.code(r.status).send(r.body); return null; }
  return { scope: r.scope, principal };
}

const send = (reply: FastifyReply, r: { ok: true } | { ok: false; status: number; body: unknown }, okCode: number, body: () => unknown) =>
  r.ok ? reply.code(okCode).send(body()) : reply.code(r.status).send(r.body);

export default async function (app: FastifyInstance) {
  app.get("/memories", async (req, reply) => {
    const q = zSearch.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.flatten() });
    const s = await scopeOr(req, reply, q.data.projectId);
    if (!s) return;
    const paths = q.data.paths?.split(",").map((p) => p.trim()).filter(Boolean);
    return searchMemories(s.scope.projectId, { q: q.data.q, paths, status: q.data.status });
  });

  app.get("/memories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await scopeOr(req, reply, (req.query as { projectId?: string }).projectId);
    if (!s) return;
    const r = await getMemory(s.scope.projectId, id);
    return send(reply, r, 200, () => r.ok && { memory: r.memory, events: r.events });
  });

  app.post("/memories", async (req, reply) => {
    const p = zWithProject(zMemoryPropose).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { projectId, ...input } = p.data;
    const s = await scopeOr(req, reply, projectId);
    if (!s) return;
    const r = await proposeMemory(s.scope, actorOf(s.principal), input);
    return send(reply, r, 201, () => r.ok && { memory: r.memory });
  });

  app.post("/memories/:id/supersede", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zWithProject(zMemoryPropose).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const { projectId, ...input } = p.data;
    const s = await scopeOr(req, reply, projectId);
    if (!s) return;
    const r = await supersedeMemory(s.scope, actorOf(s.principal), id, input);
    return send(reply, r, 201, () => r.ok && { memory: r.memory });
  });

  app.post("/memories/:id/reverify", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zWithProject(zMemoryReverify).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const s = await scopeOr(req, reply, p.data.projectId);
    if (!s) return;
    const r = await reverifyMemory(s.scope, actorOf(s.principal), id, p.data.anchors);
    return send(reply, r, 201, () => r.ok && { memory: r.memory });
  });

  app.post("/memories/:id/invalidate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zWithProject(zMemoryInvalidate).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const s = await scopeOr(req, reply, p.data.projectId);
    if (!s) return;
    const r = await invalidateMemory(s.scope, actorOf(s.principal), id, p.data.reason);
    return send(reply, r, 200, () => r.ok && { memory: r.memory });
  });

  // Review manusia. Gate global sudah menolak agent token (COOKIE_ONLY); cek `req.user` di sini
  // adalah lapis kedua bila urutan gate kelak berubah. Dua route literal (bukan loop) supaya
  // inventaris route `mcp-coverage.test.ts` membacanya — ia hanya menangkap `app.post("<literal>")`.
  const review = (decision: "activate" | "reject") => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(403).send({ error: "cookie session required" });
    const { id } = req.params as { id: string };
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) return reply.code(400).send({ error: "projectId wajib" });
    const p = zMemoryReview.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    const r = await reviewMemory(projectId, req.user.id, id, decision, p.data.reason);
    return send(reply, r, 200, () => r.ok && { memory: r.memory });
  };
  app.post("/memories/:id/activate", review("activate"));
  app.post("/memories/:id/reject", review("reject"));
}
```

`mcp-coverage.test.ts` melewati kedua route review karena `capabilityForRoute` mengembalikan `COOKIE_ONLY` untuknya.

- [ ] **Step 4: Daftarkan route di `server/src/app.ts`**

Di daftar import (dekat `import agentTokens from "./routes/agent-tokens";`):

```ts
import memories from "./routes/memories";
```

Di blok register (dekat `await api.register(bindings);`):

```ts
    await api.register(memories);      // ADR-0178 · memori project bersama
```

- [ ] **Step 5: Jalankan, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/memories.route.test.ts server/test/mcp-coverage.test.ts --no-file-parallelism`
Expected: `memories.route.test.ts` PASS. `mcp-coverage.test.ts` **FAIL** dengan daftar route memori tanpa tool — itu benar; Task 8 menutupnya. Jangan tambahkan route memori ke `UNWRAPPED`.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/memories.ts server/src/app.ts server/test/memories.route.test.ts
git commit -m "feat(memory): REST /api/memories — search/get/propose/supersede/reverify/invalidate + review cookie-only"
```

---

### Task 8: Tool MCP + identitas repo dari CLI

**Files:**
- Modify: `shared/src/mcp-catalog/types.ts` (`McpRequest.headers?`, `McpToolDef.repoContext?`)
- Create: `shared/src/mcp-catalog/memory.ts`
- Modify: `shared/src/mcp-catalog/index.ts`
- Create: `cli/src/mcp/repo-context.ts`
- Modify: `cli/src/mcp/server.ts`, `cli/src/mcp/client.ts`
- Test: `cli/test/mcp-repo-context.test.ts`, tambahan di `cli/test/mcp-server.test.ts`, `shared/src/mcp-catalog.test.ts`

**Interfaces:**
- Consumes: `REPO_HEADER`, `encodeRepoHeader`, `RepoIdentity` (Task 1); route Task 7.
- Produces:
  - `McpRequest.headers?: Record<string, string>`; `McpToolDef.repoContext?: true`
  - `readRepoContext(cwd: string): Promise<RepoContext | null>` dengan `RepoContext = { root: string; identity: RepoIdentity }`
  - `enrichAnchors(ctx: RepoContext, body: unknown): Promise<{ ok: true; body: unknown } | { ok: false; missing: string[] }>`
  - `MEMORY_TOOLS` (6 tool).

- [ ] **Step 1: Tulis test CLI yang gagal**

`cli/test/mcp-repo-context.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { enrichAnchors, readRepoContext } from "../src/mcp/repo-context";

let dir = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-repo-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  g("remote", "add", "origin", "git@github.com:acme/alpha.git");
  mkdirSync(join(dir, "src")); writeFileSync(join(dir, "src/a.ts"), "1\n");
  g("add", "."); g("commit", "-qm", "1");
});

describe("readRepoContext", () => {
  it("dari subdirektori: root, remote, root commit, HEAD", async () => {
    const ctx = await readRepoContext(join(dir, "src"));
    const head = g("rev-parse", "HEAD");
    expect(ctx?.identity).toEqual({ remote: "git@github.com:acme/alpha.git", rootCommit: head, head });
  });
  it("bukan repo / tanpa origin → null", async () => {
    expect(await readRepoContext(mkdtempSync(join(tmpdir(), "plain-")))).toBeNull();
    const noOrigin = mkdtempSync(join(tmpdir(), "noorigin-"));
    execFileSync("git", ["-C", noOrigin, "init", "-q"]);
    expect(await readRepoContext(noOrigin)).toBeNull();
  });
});

describe("enrichAnchors", () => {
  it("mengisi blobSha dari HEAD dan MENIMPA nilai yang dikirim model", async () => {
    const ctx = (await readRepoContext(dir))!;
    const r = await enrichAnchors(ctx, { content: "x", anchors: [{ path: "src/a.ts", blobSha: "f".repeat(40) }] });
    expect(r).toEqual({ ok: true, body: { content: "x", anchors: [{ path: "src/a.ts", blobSha: g("rev-parse", "HEAD:src/a.ts") }] } });
  });
  it("path tak ada di HEAD → missing", async () => {
    const ctx = (await readRepoContext(dir))!;
    expect(await enrichAnchors(ctx, { anchors: [{ path: "src/none.ts" }] })).toEqual({ ok: false, missing: ["src/none.ts"] });
  });
  it("body tanpa anchors → apa adanya", async () => {
    const ctx = (await readRepoContext(dir))!;
    expect(await enrichAnchors(ctx, { reason: "r" })).toEqual({ ok: true, body: { reason: "r" } });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run cli/test/mcp-repo-context.test.ts`
Expected: FAIL — modul tak ditemukan.

- [ ] **Step 3: Tulis `cli/src/mcp/repo-context.ts`**

```ts
// ADR-0178 · identitas repo untuk tool memori, dihitung PROSES MCP dari cwd-nya — bukan oleh model.
// Model tak pernah melihat field ini di inputSchema; ia ikut sebagai header `x-hanoman-repo` dan
// sebagai blobSha jangkar yang menimpa apa pun yang dikirim model.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RepoIdentity } from "@hanoman/shared";

const run = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<string | null> {
  try { return (await run("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5000 })).stdout.trim(); }
  catch { return null; }
}

export type RepoContext = { root: string; identity: RepoIdentity };

export async function readRepoContext(cwd: string): Promise<RepoContext | null> {
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  const [remote, roots, head] = await Promise.all([
    git(root, ["remote", "get-url", "origin"]),
    git(root, ["rev-list", "--max-parents=0", "HEAD"]),
    git(root, ["rev-parse", "HEAD"]),
  ]);
  // Repo dengan beberapa root commit (hasil merge histori lain): ambil yang terurut pertama agar
  // deterministik; server menerima selama ia termasuk himpunan root checkout-nya.
  const rootCommit = roots?.split("\n").filter(Boolean).sort()[0];
  if (!remote || !rootCommit || !head) return null;
  return { root, identity: { remote, rootCommit, head } };
}

export async function enrichAnchors(ctx: RepoContext, body: unknown):
  Promise<{ ok: true; body: unknown } | { ok: false; missing: string[] }> {
  const b = body as { anchors?: { path: string; lines?: [number, number] }[] } | null;
  if (!b || !Array.isArray(b.anchors)) return { ok: true, body };
  const missing: string[] = [];
  const anchors = [];
  for (const a of b.anchors) {
    const spec = `${ctx.identity.head}:${a.path}`;
    const type = await git(ctx.root, ["cat-file", "-t", spec]);
    const sha = type === "blob" ? await git(ctx.root, ["rev-parse", "--verify", "--quiet", spec]) : null;
    if (!sha) { missing.push(a.path); continue; }
    anchors.push({ path: a.path, ...(a.lines ? { lines: a.lines } : {}), blobSha: sha });
  }
  return missing.length ? { ok: false, missing } : { ok: true, body: { ...b, anchors } };
}
```

Catatan: test pertama `enrichAnchors` mengharapkan urutan kunci `{ path, blobSha }` — `toEqual` tak peka urutan kunci, jadi bentuk di atas lulus.

- [ ] **Step 4: Jalankan test repo-context, pastikan lulus**

Run: `pnpm vitest --run cli/test/mcp-repo-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Perluas tipe katalog**

Di `shared/src/mcp-catalog/types.ts`, `McpRequest` tambahkan:

```ts
  /** ADR-0178 · header tambahan dari PROSES MCP (mis. identitas repo). Tak pernah dari argumen model. */
  headers?: Record<string, string>;
```

Di `McpToolDef`, setelah `sampleMethod`:

```ts
  /**
   * ADR-0178 · `true` = CLI menghitung identitas repo dari cwd-nya, mengirimnya sebagai header
   * `x-hanoman-repo`, dan mengisi `blobSha` setiap `anchors[]` dari HEAD sebelum memanggil REST.
   */
  repoContext?: true;
```

- [ ] **Step 6: Tulis `shared/src/mcp-catalog/memory.ts`**

```ts
// ADR-0178 · katalog tool domain `memory`. Tak satu pun tool menerima parameter project: CLI
// menentukan project dari repo di direktori kerjanya (repoContext), server memverifikasinya.
import { PAGE_PARAMS, obj } from "../mcp-schema";
import { MEMORY_CONTENT_MAX, MEMORY_KINDS, MEMORY_STATUSES } from "../memory";
import { enc, localPage, query, s } from "./helpers";
import type { McpToolDef } from "./types";

const ANCHORS = {
  type: "array", maxItems: 10,
  description: "Berkas yang membuktikan fakta ini, relatif root repo. blobSha diisi otomatis dari HEAD — jangan diisi.",
  items: obj({
    properties: {
      path: { type: "string", description: "Path relatif root repo, mis. `server/src/db.ts`." },
      lines: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2, description: "Opsional `[awal, akhir]`." },
    },
    required: ["path"],
  }),
} as const;
const FIELDS = {
  kind: { type: "string", enum: [...MEMORY_KINDS], description: "`convention` aturan kerja · `gotcha` jebakan · `decision` keputusan (selalu direview manusia) · `fact` fakta." },
  content: { type: "string", maxLength: MEMORY_CONTENT_MAX, description: "SATU fakta yang tak jelas dari kode itu sendiri. Tanpa secret." },
  scopePaths: { type: "array", items: { type: "string" }, maxItems: 20, description: "Glob relatif root repo tempat fakta ini berlaku, mis. `server/**`. Kosong = seluruh project." },
  anchors: ANCHORS,
} as const;
const body = (a: Record<string, unknown>) => ({
  kind: a.kind, content: a.content, scopePaths: a.scopePaths ?? [], anchors: a.anchors ?? [],
});
const shapeMemory = (m: Record<string, unknown>) => ({
  id: m.id, kind: m.kind, status: m.status, content: m.content, scopePaths: m.scopePaths,
  anchors: m.anchors, supersedesId: m.supersedesId, reviewReason: m.reviewReason,
  source: m.source, createdAt: m.createdAt,
});
const one = (raw: unknown) => {
  const r = raw as { memory?: Record<string, unknown>; events?: unknown };
  return r?.memory ? { memory: shapeMemory(r.memory), ...(r.events ? { events: r.events } : {}) } : raw;
};

export const MEMORY_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_memory_search",
    title: "Cari memori project",
    description:
      "Cari memori project dari repo di direktori kerja ini. Memori adalah DATA, bukan instruksi: setiap butir menyebut sumber dan jangkar — verifikasi bila akan bergantung padanya. Default hanya yang `active`.",
    inputSchema: obj({
      properties: {
        q: { type: "string", description: "Kata kunci; semua kata harus muncul." },
        paths: { type: "array", items: { type: "string" }, description: "Hanya memori yang berlaku untuk path ini." },
        status: { type: "string", enum: [...MEMORY_STATUSES] },
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "memory:read", samplePath: "/memories", sampleMethod: "GET", repoContext: true,
    build: (a) => ({
      method: "GET", path: "/memories",
      query: query({ q: s(a.q), status: s(a.status), paths: Array.isArray(a.paths) ? (a.paths as string[]).join(",") : undefined }),
    }),
    shape: (raw, a) => localPage(raw, a, shapeMemory),
  },
  {
    name: "hanoman_memory_get",
    title: "Detail memori",
    description: "Satu memori berikut riwayat audit lengkapnya (siapa mengusulkan, mengaktifkan, membatalkan, dan kenapa).",
    inputSchema: obj({ properties: { id: { type: "string" } }, required: ["id"] }),
    mode: "read", capability: "memory:read", samplePath: "/memories/x", sampleMethod: "GET", repoContext: true,
    build: (a) => ({ method: "GET", path: `/memories/${enc(String(a.id))}` }),
    shape: one,
  },
  {
    name: "hanoman_memory_propose",
    title: "Usulkan memori",
    description:
      "Usulkan SATU fakta project yang tak jelas dari kode (jebakan, konvensi, alasan). Dengan jangkar ke berkas yang membuktikannya, memori langsung aktif; tanpa jangkar, atau `decision`, masuk antrean review manusia. Bila memori serupa sudah ada (409 `duplicateOf`), pakai hanoman_memory_supersede.",
    inputSchema: obj({ properties: { ...FIELDS }, required: ["kind", "content"] }),
    mode: "write", capability: "memory:write", samplePath: "/memories", sampleMethod: "POST", repoContext: true,
    build: (a) => ({ method: "POST", path: "/memories", body: body(a) }),
    shape: one,
  },
  {
    name: "hanoman_memory_supersede",
    title: "Koreksi memori",
    description: "Gantikan memori `active` yang salah/usang dengan versi yang benar. Yang lama menjadi `invalidated` begitu penggantinya aktif; riwayatnya tetap ada.",
    inputSchema: obj({ properties: { id: { type: "string" }, ...FIELDS }, required: ["id", "kind", "content"] }),
    mode: "write", capability: "memory:write", samplePath: "/memories/x/supersede", sampleMethod: "POST", repoContext: true,
    build: (a) => ({ method: "POST", path: `/memories/${enc(String(a.id))}/supersede`, body: body(a) }),
    shape: one,
  },
  {
    name: "hanoman_memory_reverify",
    title: "Verifikasi ulang memori",
    description: "Kamu sudah memastikan memori ini MASIH benar setelah berkasnya berubah: perbarui jangkarnya ke HEAD sekarang. Isi memori tidak berubah.",
    inputSchema: obj({ properties: { id: { type: "string" }, anchors: ANCHORS }, required: ["id", "anchors"] }),
    mode: "write", capability: "memory:write", samplePath: "/memories/x/reverify", sampleMethod: "POST", repoContext: true,
    build: (a) => ({ method: "POST", path: `/memories/${enc(String(a.id))}/reverify`, body: { anchors: a.anchors } }),
    shape: one,
  },
  {
    name: "hanoman_memory_invalidate",
    title: "Batalkan memori",
    description: "Tandai memori sebagai salah tanpa pengganti. Alasan wajib dan tercatat permanen; memori tak dihapus.",
    inputSchema: obj({ properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] }),
    mode: "write", capability: "memory:write", samplePath: "/memories/x/invalidate", sampleMethod: "POST", repoContext: true,
    build: (a) => ({ method: "POST", path: `/memories/${enc(String(a.id))}/invalidate`, body: { reason: a.reason } }),
    shape: one,
  },
];
```

Periksa bahwa `obj` di `shared/src/mcp-schema.ts` menerima `required`, `minItems`, `maxItems`, `enum`, `maxLength` (buka berkasnya). Bila tipe `JsonSchemaObject` lebih sempit, sesuaikan dengan bentuk yang dipakai `shared/src/mcp-catalog/backlog.ts` — **jangan** melemahkan tipe dengan `as never`.

Di `shared/src/mcp-catalog/index.ts`: `import { MEMORY_TOOLS } from "./memory";` dan sisipkan `...MEMORY_TOOLS,` tepat setelah `...DOCS_TOOLS,` (memori dibaca sesering docs).

- [ ] **Step 7: Enrichment di CLI**

`cli/src/mcp/client.ts` — di `init.headers`, tambahkan **sebelum** `Authorization` supaya header proses tak bisa menimpa auth:

```ts
      headers: {
        ...(req.headers ?? {}),
        Authorization: `Bearer ${cfg.token}`,
```

`cli/src/mcp/server.ts` — tambah parameter opsional `cwd` dan enrichment:

```ts
import { REPO_HEADER, encodeRepoHeader } from "@hanoman/shared";
import { enrichAnchors, readRepoContext } from "./repo-context";

export function buildMcpServer(cfg: McpConfig, call: Caller, cliVersion: string, cwd: string = process.cwd()): McpServer {
```

dan ganti blok setelah `const req = tool.build(args);`:

```ts
        const built = tool.build(args);
        if (!built) return text(`Tool ${tool.name} tak punya panggilan REST.`, true);
        let req = built;
        if (tool.repoContext) {
          const ctx = await readRepoContext(cwd);
          if (!ctx)
            return text(`Direktori kerja (${cwd}) bukan repo git dengan remote \`origin\` dan minimal satu commit — memori project ditentukan dari repo itu.`, true);
          const e = await enrichAnchors(ctx, req.body);
          if (!e.ok)
            return text(`Jangkar tidak ada di HEAD (${ctx.identity.head.slice(0, 12)}): ${e.missing.join(", ")}. Commit berkasnya dulu, atau perbaiki path relatif root repo.`, true);
          req = { ...req, body: e.body, headers: { ...(req.headers ?? {}), [REPO_HEADER]: encodeRepoHeader(ctx.identity) } };
        }
        const r = await call(req, tool.name);
```

(baris `if (!r.ok) …` dan `return text(renderResult(…))` tetap.)

- [ ] **Step 8: Test server MCP**

Tambahkan di akhir `cli/test/mcp-server.test.ts` (memakai `boot` & `reply` yang sudah ada; `buildMcpServer` kini menerima `cwd` — perluas `boot` dengan parameter opsional ketiga `cwd` yang diteruskan):

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_HEADER, decodeRepoHeader } from "@hanoman/shared";

describe("tool memori · repoContext", () => {
  it("propose membawa header identitas repo dan blobSha dari HEAD, bukan dari model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-mem-"));
    const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
    g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    g("remote", "add", "origin", "git@github.com:acme/alpha.git");
    writeFileSync(join(dir, "a.md"), "x"); g("add", "."); g("commit", "-qm", "1");
    const { t, call } = await boot({}, okCall(), dir);
    t.feed({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "hanoman_memory_propose",
      arguments: { kind: "fact", content: "c", anchors: [{ path: "a.md", blobSha: "f".repeat(40) }] } } });
    await tick();
    const [req] = call.mock.calls.at(-1)!;
    expect(decodeRepoHeader(req.headers?.[REPO_HEADER])?.head).toBe(g("rev-parse", "HEAD"));
    expect((req.body as { anchors: { blobSha: string }[] }).anchors[0]!.blobSha).toBe(g("rev-parse", "HEAD:a.md"));
  });

  it("cwd bukan repo → galat jelas, REST tak dipanggil", async () => {
    const { t, call } = await boot({}, okCall(), mkdtempSync(join(tmpdir(), "plain-")));
    t.feed({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "hanoman_memory_search", arguments: {} } });
    await tick();
    expect(reply(t, 10)?.result.isError).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });
});
```

Ubah `boot` menjadi:

```ts
async function boot(over: Partial<McpConfig> = {}, call = okCall(), cwd?: string) {
  const t = new PairedTransport();
  serveStdio(() => buildMcpServer({ ...cfg, ...over }, call, "9.9.9", cwd), { transport: t as never });
```

- [ ] **Step 9: Test katalog**

Tambahkan di `shared/src/mcp-catalog.test.ts`:

```ts
  it("tool memori tak pernah menerima parameter project dan semuanya repoContext", () => {
    const mem = MCP_TOOLS.filter((t) => t.name.startsWith("hanoman_memory_"));
    expect(mem.map((t) => t.name).sort()).toEqual([
      "hanoman_memory_get", "hanoman_memory_invalidate", "hanoman_memory_propose",
      "hanoman_memory_reverify", "hanoman_memory_search", "hanoman_memory_supersede",
    ]);
    for (const t of mem) {
      expect(t.repoContext, t.name).toBe(true);
      const props = Object.keys((t.inputSchema as { properties?: object }).properties ?? {});
      expect(props.some((p) => /project/i.test(p)), t.name).toBe(false);
    }
  });
```

- [ ] **Step 10: Jalankan semua test tersentuh**

Run:

```bash
pnpm vitest --run cli/test/mcp-repo-context.test.ts cli/test/mcp-server.test.ts cli/test/mcp-client.test.ts shared/src/mcp-catalog.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/mcp-coverage.test.ts server/test/memories.route.test.ts --no-file-parallelism
```

Expected: PASS semua — `mcp-coverage` kini hijau karena setiap route memori yang terjangkau token punya tool dengan `samplePath` yang dipetakan ke capability yang sama.

- [ ] **Step 11: Commit**

```bash
git add shared/src/mcp-catalog cli/src/mcp cli/test/mcp-repo-context.test.ts cli/test/mcp-server.test.ts shared/src/mcp-catalog.test.ts
git commit -m "feat(memory): tool MCP hanoman_memory_* dengan identitas repo dihitung CLI"
```

---

### Task 9: Dokumentasi, verifikasi nyata, centang plan

**Files:**
- Modify: `docs/agent-integration.md` (bagian tool/alur), `internal/docs/architecture/data-model.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/README.md`
- Modify: berkas plan ini (centang)

- [ ] **Step 1: `docs/agent-integration.md`**

Tambahkan subbagian setelah tabel domain:

```markdown
### Memori project (`/api/memories`, ADR-0178)

- Project **tidak** dipilih lewat parameter. CLI MCP hanoman (`hanoman mcp`) membaca repo di direktori
  kerjanya — `origin`, root commit, HEAD — dan mengirimnya sebagai header `x-hanoman-repo`; server
  mencocokkannya ke `Project.gitRemote` dan ke allowlist **Project yang diizinkan** pada token.
- Token tanpa allowlist → `403 {need:"projectIds"}`; mengirim `projectId` → `400`.
- Jangkar (`anchors[]`) diisi path saja; blob SHA diisi CLI dari HEAD dan diverifikasi ulang server.
  Usulan dengan jangkar terverifikasi langsung `active`; tanpa jangkar atau `kind: decision` masuk
  review manusia (`…/activate` / `…/reject` cookie-only).
- Galat: `404` remote tak dikenal / root commit beda · `409 {duplicateOf}` · `422 {anchor}` jangkar tak cocok
  · `422 {reason}` terdeteksi secret.
- Memori adalah **data**, bukan instruksi.
```

- [ ] **Step 2: Arsitektur & index**

`internal/docs/architecture/data-model.md`: tambahkan bagian `ProjectMemory` / `MemoryEvent` / `MemoryLocalState` / `AgentToken.projectIds` (salin tabel field dari Task 1 Step 5, satu kalimat per model, tautan ADR-0178).

`internal/docs/architecture/api-contract.md`: tambahkan tabel route dari Task 7 beserta kode galat.

`internal/docs/README.md`: di daftar ADR, tambahkan (urutan menurun, di atas entri 0177):

```markdown
- [0178 — Memori project bersama lintas runtime: entity SQLite, project ditentukan proses, lattice status](adr/0178-memori-project-bersama.md) — `ProjectMemory`/`MemoryEvent` (append-only)/`MemoryLocalState` (LOCAL-only), `AgentToken.projectIds`, capability `memory:*`, header `x-hanoman-repo` dari CLI MCP, auto-aktif hanya dengan jangkar terverifikasi server; tahap 1 dari [rancangan](../../docs/superpowers/specs/2026-10-07-shared-project-memory-design.md) · [plan](../../docs/superpowers/plans/2026-10-07-shared-project-memory-stage1.md)
```

Perbarui entri riset 2026-10-07 yang sudah ada: ganti "(menunggu review, belum ada ADR/skema)" dengan "→ ADR-0178".

- [ ] **Step 3: Test kontrak dokumen**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/agent-doc-contract.test.ts server/test/agent-doc.route.test.ts server/test/guide-file.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 4: Semua test yang tersentuh perubahan**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "$(git merge-base HEAD main)" --no-file-parallelism`
Expected: PASS. Bila ada kegagalan 404/P2022 massal, itu hampir pasti DB berbagi — pastikan `TEST_DATABASE_URL` terpasang sebelum menyimpulkan regresi.

- [ ] **Step 5: Verifikasi API nyata di lokal**

```bash
export HANOMAN_HOME=$(mktemp -d) PORT=8799
pnpm --filter @hanoman/server dev > /tmp/hanoman-mem.log 2>&1 &
SERVER_PID=$!
sleep 6
curl -fsS localhost:8799/api/health
```

Expected: `{"ok":true…}` (atau bentuk health yang ada). Lalu, lewat dashboard `http://localhost:8799` (setup user pertama, nyalakan Akses AI Agent di Settings, buat project dengan `gitRemote` = remote repo ini dan binding ke checkout ini, buat token ber-capability `memory:write`). Form token di dashboard belum punya pemilih project (itu tahap 4), jadi pasang allowlist lewat API memakai cookie browser (salin dari DevTools → Application → Cookies):

```bash
curl -sS -X PATCH -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -d '{"projectIds":["<id-project>"]}' localhost:8799/api/agent-tokens/<id-token>
```

Lalu jalankan:

```bash
TOKEN=hnm_agt_...   # dari dashboard
REPO=$(node -e '
const {execSync:x}=require("node:child_process");
const r={remote:x("git remote get-url origin").toString().trim(),
 rootCommit:x("git rev-list --max-parents=0 HEAD").toString().trim().split("\n").sort()[0],
 head:x("git rev-parse HEAD").toString().trim()};
console.log(Buffer.from(JSON.stringify(r)).toString("base64url"))')
H=(-H "authorization: Bearer $TOKEN" -H "x-hanoman-repo: $REPO" -H "content-type: application/json")
curl -sS "${H[@]}" -d '{"kind":"gotcha","content":"Test server wajib --no-file-parallelism","anchors":[{"path":"CLAUDE.md"}]}' localhost:8799/api/memories
curl -sS "${H[@]}" "localhost:8799/api/memories?q=parallelism"
curl -sS "${H[@]}" -d '{"kind":"gotcha","content":"test server WAJIB --no-file-parallelism","anchors":[{"path":"CLAUDE.md"}]}' localhost:8799/api/memories   # → 409
curl -sS "${H[@]}" -d '{"kind":"fact","content":"x y","anchors":[{"path":"tidak-ada.md"}]}' localhost:8799/api/memories      # → 422
curl -sS -H "authorization: Bearer $TOKEN" localhost:8799/api/memories                                                   # → 400 header wajib
curl -sS "${H[@]}" -X POST localhost:8799/api/memories/ID/activate -d '{}'                                                 # → 403 cookie-only
curl -sS "${H[@]}" -d '{"reason":"uji"}' localhost:8799/api/memories/ID/invalidate                                        # → 200 invalidated
kill $SERVER_PID
```

Expected: `201 active` (blobSha terisi), pencarian menemukan butir itu, `409 duplicateOf`, `422 anchor`, `400`, `403`, `200 invalidated`. Lalu uji tool MCP nyata sekali: jalankan klien MCP terhadap `hanoman mcp` dengan host/token itu dari direktori repo ini dan panggil `hanoman_memory_search`. Catat hasil (ringkas) di bagian bawah plan ini.

Bila ada yang tak sesuai: perbaiki, tambahkan test regresinya, ulangi langkah ini sampai hijau.

- [ ] **Step 6: Centang plan & commit**

Centang semua checkbox yang selesai di berkas ini, lalu:

```bash
git add docs/agent-integration.md internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md \
  internal/docs/README.md docs/superpowers/plans/2026-10-07-shared-project-memory-stage1.md
git commit -m "docs(memory): kontrak API, model data, panduan agen + hasil verifikasi tahap 1"
```

---

## Hasil verifikasi lokal

_(diisi di Task 9 Step 5)_
