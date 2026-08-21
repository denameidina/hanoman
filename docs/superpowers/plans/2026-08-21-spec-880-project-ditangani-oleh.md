# SPEC-880 — Penanda "ditangani oleh" pada Project · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project punya penanda "ditangani oleh" berisi satu atau lebih hanoman client, di-set manusia, disync, dan terlihat sama di hub maupun di setiap client.

**Architecture:** Satu kolom `Project.handledBy` (`Json?`, nullable, nol backfill) berisi array snapshot device `{ deviceId, name }`. Kolom itu **masuk** `FIELDS.project` di `server/src/services/sync.ts` (sejajar `gitRemote`) sehingga menyeberang ke setiap instance; `name` ikut tersimpan karena `DeviceToken` **tidak** ikut `SYNCED` dan client penerima tak punya baris device untuk di-join. `toProjectView` memperkaya nilai tersimpan jadi `{ deviceId, name, revoked }` dari indeks `DeviceToken` lokal — penyimpanan tetap mentah, tampilan yang menghitung.

**Tech Stack:** TypeScript strict · Prisma 6 + SQLite · Fastify · zod (`@hanoman/shared`) · React 18 + Vite · Vitest + Testing Library.

## Global Constraints

- **Tak boleh mengubah perilaku eksekusi.** Penanda ini tak menggerbangi start sesi, worktree, auto-merge, scheduler, maupun lead. Murni informasi.
- **Skema berubah → wajib migration Prisma + ADR baru** (CLAUDE.md). ADR baru = **ADR-0135** (`0134` adalah nomor terpakai terakhir).
- **Field baru WAJIB masuk `FIELDS.project`.** `upsert` yang tak menyebut sebuah kolom TETAP berhasil, jadi kolom yang terlewat mendarat sebagai null palsu di tiap client tanpa satu pun galat (kelas gagal-senyap ADR-0090/0093/0105).
- **Migration ditulis tangan, aditif murni, tanpa backfill.** `migrate dev` me-reset DB saat ada drift worktree tetangga. Preseden: `server/prisma/migrations/20260815130000_spec_manual_done/migration.sql`.
- **Jangan menyentuh nilai LOCAL-only yang sudah ada:** `repoDir`, `LocalBinding`, `schedulerOptIn`, `leadOptIn`, `autoMerge`.
- **Design system** `internal/docs/design-system/**` (editorial, bone paper, brass accent). Chip **tidak boleh** memecah baris kepala di layar sempit (pelajaran SPEC-879).
- **Perbarui `internal/docs` yang tersentuh dalam commit yang sama** dan tautkan di `internal/docs/README.md`.
- **Perintah test WAJIB memakai env bersih.** Env sesi terkontaminasi: `HANOMAN_CONTROL_ORIGINS` membuat SETIAP test route 404 gagal palsu, `NODE_ENV=development` membuat WS 401, `DATABASE_URL` menunjuk DB produksi. Terverifikasi di worktree ini: `sync-client.test.ts` **2 gagal** dengan env apa adanya → **8/8 lulus** dengan env bersih, nol baris kode berubah. Gunakan alias ini di setiap langkah "Run":

```bash
# TES = perintah test standar plan ini. Jalankan sekali per shell:
TES() { env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR -u DATABASE_URL \
  NODE_ENV=test TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism "$@"; }
```

`--no-file-parallelism` wajib: run tingkat-root tak menghormati `fileParallelism: false` milik project server, dan test server berbagi satu berkas DB.

---

## File Structure

**Dibuat:**

| Berkas | Tanggung jawab |
|---|---|
| `server/prisma/migrations/20260821120000_project_handled_by/migration.sql` | satu `ALTER TABLE` aditif |
| `shared/src/handled-by.ts` | bentuk & parse toleran nilai `handledBy` (cermin `shared/src/auto-merge.ts`) |
| `server/src/services/handled-by.ts` | gerbang tulis: `deviceId` dikenal di instance ini bila daftarnya ada |
| `src/src/screens/HandledByChips.tsx` | satu komponen chip untuk daftar **dan** detail |
| `server/test/project-handled-by-contract.test.ts` | kontrak kolom + sync + webhook + zod |
| `server/test/project-handled-by.route.test.ts` | GET/POST/PATCH + filter + revoke |
| `server/test/project-handled-by-sync.test.ts` | round-trip client → hub → client kedua |
| `server/test/sync-push-partial-failure.test.ts` | satu record buruk tak meruntuhkan batch |
| `src/test/project-handled-by.test.tsx` | chip daftar & detail, editor read-only |
| `internal/docs/adr/0135-penanda-project-ditangani-hanoman-client.md` | ADR |

**Diubah:** `server/prisma/schema.prisma` · `server/src/services/sync.ts` · `server/src/services/project-view.ts` · `server/src/routes/projects.ts` · `server/src/routes/sync.ts` · `server/src/services/sync-client.ts` · `shared/src/index.ts` · `shared/src/dto.ts` · `shared/src/webhook.ts` · `src/src/api/client.ts` · `src/src/screens/ProjectsScreen.tsx` · `src/src/screens/ProjectDetailScreen.tsx` · `src/src/App.tsx` · `internal/docs/architecture/data-model.md` · `internal/docs/architecture/api-contract.md` · `internal/docs/adr/README.md` · `internal/docs/README.md`

---

## Task 1: Kolom, migration, bentuk bersama, dan kontrak sync

**Files:**
- Create: `server/prisma/migrations/20260821120000_project_handled_by/migration.sql`
- Create: `shared/src/handled-by.ts`
- Modify: `server/prisma/schema.prisma` (model `Project`)
- Modify: `shared/src/index.ts`
- Modify: `shared/src/webhook.ts:123-136` (entity def `project`)
- Modify: `server/src/services/sync.ts:41` (`FIELDS.project`) dan `:114-119` (`JSON_FIELDS`)
- Test: `server/test/project-handled-by-contract.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `zHandledByEntry`, `zHandledBy`, `zHandledByView`, `HANDLED_BY_MAX`
  - `type HandledByEntry = { deviceId: string; name: string }`
  - `type HandledByView = { deviceId: string; name: string; revoked: boolean }`
  - `handledByOf(raw: unknown): HandledByEntry[]`
  - kolom Prisma `Project.handledBy: Prisma.JsonValue | null`

- [x] **Step 1: Tulis test kontrak yang gagal**

Buat `server/test/project-handled-by-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { WEBHOOK_ENTITIES, zHandledBy, handledByOf, HANDLED_BY_MAX } from "@hanoman/shared";
import { __FIELDS, __DATE_FIELDS, __JSON_FIELDS } from "../src/services/sync";

const projectModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Project")!;

describe("SPEC-880 · kontrak kolom Project.handledBy", () => {
  it("kolomnya ada di skema sebagai Json opsional", () => {
    const col = projectModel.fields.find((f) => f.name === "handledBy");
    expect(col).toBeTruthy();
    expect(col!.type).toBe("Json");
    expect(col!.isRequired).toBe(false);
  });

  // Inti spec ini: penanda "ditangani oleh" HARUS menyeberang. Kelas gagal-senyap
  // ADR-0090/0093/0105 — `upsert` yang tak menyebut kolom TETAP berhasil, jadi kolom yang lupa
  // didaftarkan mendarat sebagai null palsu di tiap client tanpa satu pun galat.
  it("ikut menyeberang sync sebagai JSON, bukan DATE", () => {
    expect(__FIELDS.project).toContain("handledBy");
    expect(__JSON_FIELDS.has("project:handledBy")).toBe(true);
    expect(__DATE_FIELDS.project).not.toContain("handledBy");
  });

  // Kontrol negatif: nilai LOCAL-only tetap di luar sync (constraint SPEC-880).
  it("repoDir/schedulerOptIn/leadOptIn/autoMerge TETAP di luar FIELDS", () => {
    for (const f of ["repoDir", "schedulerOptIn", "leadOptIn", "autoMerge"]) {
      expect(__FIELDS.project).not.toContain(f);
    }
  });

  it("penerima webhook melihat handledBy", () => {
    const p = WEBHOOK_ENTITIES.find((d) => d.entity === "project")!;
    expect(p.fields).toContain("handledBy");
    expect(p.sample).toHaveProperty("handledBy");
  });

  it("zHandledBy: entri butuh deviceId & name, duplikat ditolak, ada batas panjang", () => {
    expect(zHandledBy.safeParse([]).success).toBe(true);
    expect(zHandledBy.safeParse([{ deviceId: "d1", name: "hm-dena" }]).success).toBe(true);
    expect(zHandledBy.safeParse([{ deviceId: "d1" }]).success).toBe(false);
    expect(zHandledBy.safeParse([{ deviceId: "", name: "x" }]).success).toBe(false);
    expect(zHandledBy.safeParse([
      { deviceId: "d1", name: "a" }, { deviceId: "d1", name: "b" },
    ]).success).toBe(false);
    const tooMany = Array.from({ length: HANDLED_BY_MAX + 1 }, (_, i) => ({ deviceId: `d${i}`, name: `n${i}` }));
    expect(zHandledBy.safeParse(tooMany).success).toBe(false);
  });

  // Kolom Json bisa berisi apa saja (ditulis versi lain, disunting tangan). Bentuk rusak → []
  // bukan melempar: daftar project tak boleh mati karena satu baris cacat (preseden autoMergeOf).
  it("handledByOf toleran terhadap isi kolom yang rusak", () => {
    expect(handledByOf(null)).toEqual([]);
    expect(handledByOf(undefined)).toEqual([]);
    expect(handledByOf("bukan array")).toEqual([]);
    expect(handledByOf([{ deviceId: "d1", name: "hm-dena" }])).toEqual([{ deviceId: "d1", name: "hm-dena" }]);
    expect(handledByOf([{ deviceId: "d1" }])).toEqual([]);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

```bash
TES server/test/project-handled-by-contract.test.ts
```

Expected: FAIL — `Cannot find module` / `zHandledBy is not exported` (berkas `shared/src/handled-by.ts` belum ada).

- [x] **Step 3: Buat `shared/src/handled-by.ts`**

```ts
import { z } from "zod";

// SPEC-880 · ADR-0135 · penanda "ditangani oleh": daftar hanoman client yang memegang sebuah
// project. Murni INFORMASIONAL — tak menggerbangi start sesi, worktree, auto-merge, scheduler,
// maupun lead.
//
// Tiap entri adalah SNAPSHOT device, bukan sekadar FK. `DeviceToken` tak ikut `SYNCED` (ia
// server-local di hub), jadi client penerima TAK punya baris device untuk di-join: tanpa `name`
// yang ikut tersimpan, chip di client tampil kosong tanpa satu pun error — kelas gagal-senyap
// ADR-0090/0093/0105.
//
// `revoked` sengaja TIDAK disimpan: ia turunan baris `DeviceToken` lokal dan berbeda per instance.
// Menyimpannya berarti membekukan fakta hub ke dalam record yang menyeberang.
export const zHandledByEntry = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
});
export type HandledByEntry = z.infer<typeof zHandledByEntry>;

// Batas atas supaya satu record project tak pernah mendekati plafon 1 MiB `MAX_SYNC_RECORD_BYTES`.
export const HANDLED_BY_MAX = 32;

export const zHandledBy = z.array(zHandledByEntry).max(HANDLED_BY_MAX)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const e of list) {
      if (seen.has(e.deviceId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `deviceId duplikat: ${e.deviceId}` });
        return;
      }
      seen.add(e.deviceId);
    }
  });
export type HandledBy = z.infer<typeof zHandledBy>;

// Bentuk TAMPILAN (turunan, tak pernah disimpan): `revoked` dihitung `toProjectView` dari baris
// DeviceToken instance ini. Di client yang tak punya barisnya, ia selalu false.
export const zHandledByView = zHandledByEntry.extend({ revoked: z.boolean().default(false) });
export type HandledByView = z.infer<typeof zHandledByView>;

/** Kolom `Json` bisa berisi apa saja. Bentuk rusak → `[]` = "belum ditetapkan", bukan melempar:
 *  daftar project tak boleh mati karena satu baris cacat (preseden `autoMergeOf`, ADR-0103). */
export function handledByOf(raw: unknown): HandledByEntry[] {
  if (raw === null || raw === undefined) return [];
  const p = zHandledBy.safeParse(raw);
  return p.success ? p.data : [];
}
```

- [x] **Step 4: Ekspor dari `shared/src/index.ts`**

Sisipkan tepat di bawah baris `export * from "./auto-merge";`:

```ts
export * from "./handled-by";
```

- [x] **Step 5: Tambah kolom di `server/prisma/schema.prisma`**

Di model `Project`, sisipkan tepat **setelah** blok `autoMerge Json?`:

```prisma
  // SPEC-880 · ADR-0135 · daftar hanoman client yang memegang project ini: [{deviceId,name}].
  // BERBEDA dari repoDir/schedulerOptIn/leadOptIn/autoMerge di atas — kolom ini MASUK FIELDS sync,
  // karena justru menyeberangnya nilai ini yang jadi inti SPEC-880. null = belum ditetapkan.
  handledBy      Json?
```

- [x] **Step 6: Tulis migration tangan**

Buat `server/prisma/migrations/20260821120000_project_handled_by/migration.sql`:

```sql
-- SPEC-880 · ADR-0135 · penanda "ditangani oleh": daftar hanoman client pemegang project.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu kolom NULLABLE tanpa default, tak ada tabel diredefinisi.
--
-- TANPA backfill, sengaja: sebelum spec ini penandanya memang tak ada di mana pun, dan menebaknya
-- dari SessionResult.deviceId akan mencampur "jejak eksekusi" dengan "pernyataan kepemilikan".
-- NULL = "belum ditetapkan", dan itu jawaban yang jujur.
ALTER TABLE "Project" ADD COLUMN "handledBy" JSONB;
```

- [x] **Step 7: Regenerate Prisma Client**

```bash
pnpm db:generate
```

Expected: `Generated Prisma Client`. Bila gagal dengan `Property 'dmmf' does not exist`, jalankan `pnpm install` dulu (postinstall paket `server` yang men-generate-nya).

- [x] **Step 8: Daftarkan kolom di `server/src/services/sync.ts`**

Ganti baris `FIELDS.project` (baris 41). Cari:

```ts
  project: ["name", "desc", "kind", "stack", "gitRemote", "updatedAt"],
```

Ganti jadi:

```ts
  // SPEC-880 · ADR-0135 · `handledBy` ikut menyeberang: "project ini dipegang mesin yang mana"
  // adalah pernyataan bersama, bukan setelan mesin — dan justru menyeberangnya nilai itu yang
  // jadi inti spec-nya. SENGAJA bukan cermin `repoDir`/`schedulerOptIn`/`autoMerge` yang LOCAL-only
  // (mereka properti checkout mesin ini). Tiap entri membawa `name` karena `DeviceToken` TIDAK
  // ikut SYNCED: penerima tak punya baris device untuk di-join. BUKAN DATE_FIELDS.
  project: ["name", "desc", "kind", "stack", "gitRemote", "handledBy", "updatedAt"],
```

Lalu di `JSON_FIELDS` (baris ~114), tambahkan `"project:handledBy",` sebagai entri pertama:

```ts
const JSON_FIELDS = new Set([
  "project:handledBy",
  "spec:payload", "spec:dependsOn", "spec:sourceHistory", "spec:manualDone",
  "vps:health", "vps:audit",
  "customAgent:tools", "customAgent:mentions",
  "githubIssue:labels",
]);
```

- [x] **Step 9: Daftarkan di allowlist webhook `shared/src/webhook.ts`**

Cari blok `entity: "project"` (baris ~122) dan ganti `fields` + `sample`:

```ts
    fields: ["id", "name", "desc", "kind", "gitRemote", "stack", "helpEnabled",
      // SPEC-880 · ADR-0135 · penerima harus bisa tahu mesin mana yang memegang project ini
      // tanpa mendiff dua amplop. Entrinya snapshot: [{deviceId,name}].
      "handledBy",
      "schedulerOptIn", "leadOptIn", "autoMerge", "createdAt", "updatedAt"],
```

```ts
    sample: {
      id: "hanoman", name: "hanoman", desc: "Orchestrator + dashboard docs-driven",
      kind: "web", gitRemote: "git@github.com:nafanesia/hanoman.git", stack: "ts",
      helpEnabled: false,
      handledBy: [{ deviceId: "clq0device1", name: "hm-dena" }],
      schedulerOptIn: true, leadOptIn: false, autoMerge: null,
      createdAt: "2026-05-02T04:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z",
    },
```

Dan pada `events.updated.when`, ganti kalimatnya jadi:

```ts
      updated: { type: "project.updated", label: "Project diubah", when: "Nama, deskripsi, stack, remote, penanda \"ditangani oleh\", atau opt-in scheduler/lead/Help Center berubah." },
```

- [x] **Step 10: Jalankan test — pastikan HIJAU**

```bash
TES server/test/project-handled-by-contract.test.ts
```

Expected: PASS — 6 test.

- [x] **Step 11: Pastikan kontrak sync yang sudah ada tak pecah**

```bash
TES server/test/sync-exclusions.test.ts server/test/sync.service.test.ts server/test/sync-client.test.ts server/test/webhook-payload.test.ts
```

Expected: PASS semua. (Bila `webhook-payload.test.ts` tak ada, hilangkan dari daftar — jalankan `ls server/test | grep webhook` untuk melihat berkas webhook yang nyata dan sertakan semuanya.)

- [x] **Step 12: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260821120000_project_handled_by \
  shared/src/handled-by.ts shared/src/index.ts shared/src/webhook.ts \
  server/src/services/sync.ts server/test/project-handled-by-contract.test.ts
git commit -m "feat(spec-880): kolom Project.handledBy + kontrak sync & webhook

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: View memperkaya penanda dengan status device

**Files:**
- Modify: `server/src/services/project-view.ts`
- Modify: `shared/src/dto.ts` (`zProjectView`)
- Modify: `server/src/routes/projects.ts:20-37` (GET list & detail)
- Test: `server/test/project-handled-by.route.test.ts` (bagian baca)

**Interfaces:**
- Consumes: `handledByOf`, `HandledByView` (Task 1)
- Produces:
  - `export type DeviceIndex = Map<string, { name: string; revoked: boolean }>`
  - `export async function loadDeviceIndex(): Promise<DeviceIndex>`
  - `toProjectView(p: Project, sessions: SessionInfo[], devices?: DeviceIndex): Promise<ProjectView>`
  - `ProjectView.handledBy: HandledByView[]` (default `[]`)

- [x] **Step 1: Tulis test baca yang gagal**

Buat `server/test/project-handled-by.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

// Gate lewat: uji perilaku data, bukan auth (cermin project-gitremote.route.test.ts).
const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function device(name: string, revoked = false) {
  const u = await prisma.user.findFirst()
    ?? await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return prisma.deviceToken.create({
    data: {
      userId: u.id, name, tokenHash: `hash-${name}-${Math.random()}`,
      revokedAt: revoked ? new Date() : null,
    },
  });
}
const project = (id: string, handledBy?: unknown) =>
  prisma.project.create({
    data: { id, name: id, desc: "d", kind: "existing", ...(handledBy ? { handledBy: handledBy as object } : {}) },
  });

describe("SPEC-880 · baca penanda 'ditangani oleh'", () => {
  it("project tanpa penanda → handledBy [] (bukan null), di list & detail", async () => {
    await project("polos");
    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].handledBy).toEqual([]);
    const one = await app.inject({ method: "GET", url: "/api/projects/polos" });
    expect(one.json().handledBy).toEqual([]);
  });

  it("nama HIDUP menang atas snapshot saat baris device ada di instance ini", async () => {
    const d = await device("hm-dena");
    await project("p1", [{ deviceId: d.id, name: "nama-lama" }]);
    const one = await app.inject({ method: "GET", url: "/api/projects/p1" });
    expect(one.json().handledBy).toEqual([{ deviceId: d.id, name: "hm-dena", revoked: false }]);
  });

  // AC-7 · revoke device TIDAK menghapus penanda; ia hanya diberi tanda.
  it("device dicabut tetap tampil, bertanda revoked", async () => {
    const d = await device("laptop-lama", true);
    await project("p2", [{ deviceId: d.id, name: "laptop-lama" }]);
    const one = await app.inject({ method: "GET", url: "/api/projects/p2" });
    expect(one.json().handledBy).toEqual([{ deviceId: d.id, name: "laptop-lama", revoked: true }]);
  });

  // Inti K2: di client tak ada baris DeviceToken untuk di-join. Tanpa `name` tersimpan chip kosong.
  it("tanpa baris device lokal, nama SNAPSHOT yang dipakai (bukan kosong)", async () => {
    await project("p3", [{ deviceId: "device-asal-hub", name: "hub-vps" }]);
    const one = await app.inject({ method: "GET", url: "/api/projects/p3" });
    expect(one.json().handledBy).toEqual([{ deviceId: "device-asal-hub", name: "hub-vps", revoked: false }]);
  });

  it("isi kolom yang rusak tak meruntuhkan daftar project", async () => {
    await project("rusak", { bukan: "array" });
    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].handledBy).toEqual([]);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

```bash
TES server/test/project-handled-by.route.test.ts
```

Expected: FAIL — `expected undefined to deeply equal []`.

- [x] **Step 3: Tambah `handledBy` ke `zProjectView`**

Di `shared/src/dto.ts`, tambahkan import `zHandledByView` pada baris import `zAutoMerge`:

```ts
import { zAutoMerge } from "./auto-merge";
import { zHandledByView } from "./handled-by";
```

Lalu di `zProjectView`, sisipkan sebelum baris `autoMerge:`:

```ts
  // SPEC-880 · ADR-0135 · penanda "ditangani oleh" yang SUDAH diperkaya: `name` = nama hidup bila
  // baris DeviceToken-nya ada di instance ini, else snapshot tersimpan; `revoked` diturunkan.
  // `[]` = belum ditetapkan — kolom NULL tak pernah bocor ke UI sebagai bentuk kedua "kosong".
  handledBy: zHandledByView.array().default([]),
```

- [x] **Step 4: Perkaya di `server/src/services/project-view.ts`**

Tambahkan pada blok import:

```ts
import { autoMergeOf, handledByOf, type HandledByView } from "@hanoman/shared";
```

(ganti baris `import { autoMergeOf } from "@hanoman/shared";` yang ada)

Sisipkan tepat di atas `export async function toProjectView`:

```ts
// SPEC-880 · ADR-0135 · indeks device instance ini, dipakai memperkaya penanda "ditangani oleh".
// `DeviceToken` TIDAK ikut SYNCED, jadi di client peta ini kosong dan `handledByView` jatuh ke
// nama snapshot — itulah sebabnya `name` ikut tersimpan.
export type DeviceIndex = Map<string, { name: string; revoked: boolean }>;

export async function loadDeviceIndex(): Promise<DeviceIndex> {
  const rows = await prisma.deviceToken.findMany({ select: { id: true, name: true, revokedAt: true } });
  return new Map(rows.map((d) => [d.id, { name: d.name, revoked: d.revokedAt !== null }]));
}

// Nama HIDUP menang saat barisnya ada (rename device ikut terlihat); snapshot jadi jaring
// pengamannya. `revoked` selalu false di instance yang tak memegang katalog device.
function handledByView(raw: unknown, devices: DeviceIndex): HandledByView[] {
  return handledByOf(raw).map((e) => {
    const d = devices.get(e.deviceId);
    return { deviceId: e.deviceId, name: d?.name ?? e.name, revoked: d?.revoked ?? false };
  });
}
```

Ubah tanda tangan fungsi (baris ~30). Cari:

```ts
export async function toProjectView(p: Project, sessions: SessionInfo[]): Promise<ProjectView> {
  const specs = await prisma.spec.findMany({ where: { projectId: p.id } });
```

Ganti jadi:

```ts
// SPEC-880 · `devices` OPSIONAL, cermin `sessions` (SPEC-197): GET /projects memuat indeksnya
// SEKALI per request; pemanggil satuan boleh mengabaikannya dan biarkan service memuatnya sendiri.
export async function toProjectView(
  p: Project, sessions: SessionInfo[], devices?: DeviceIndex,
): Promise<ProjectView> {
  const deviceIndex = devices ?? await loadDeviceIndex();
  const specs = await prisma.spec.findMany({ where: { projectId: p.id } });
```

Lalu di objek yang dikembalikan, sisipkan sebelum baris `autoMerge:`:

```ts
    // SPEC-880 · ADR-0135 · penanda "ditangani oleh" (DISYNC — beda dari repoDir/binding di atas
    // yang fakta mesin ini saja).
    handledBy: handledByView((p as { handledBy?: unknown }).handledBy, deviceIndex),
```

- [x] **Step 5: Muat indeks sekali per request di `server/src/routes/projects.ts`**

Tambahkan pada import `project-view`:

```ts
import { toProjectView, loadDeviceIndex } from "../services/project-view";
```

Di handler `GET /projects`, ganti:

```ts
    const sessions = listSessions();
    const views = await Promise.all(ps.map((p) => toProjectView(p, sessions)));
```

jadi:

```ts
    const sessions = listSessions();
    // SPEC-880 · satu query device untuk seluruh request (cermin listSessions), bukan N+1.
    const devices = await loadDeviceIndex();
    const views = await Promise.all(ps.map((p) => toProjectView(p, sessions, devices)));
```

- [x] **Step 6: Jalankan test — pastikan HIJAU**

```bash
TES server/test/project-handled-by.route.test.ts
```

Expected: PASS — 5 test.

- [x] **Step 7: Pastikan view lama tak pecah**

```bash
TES server/test/project-view.test.ts server/test/binding-aware.test.ts server/test/projects.route.test.ts server/test/project-gitremote.route.test.ts
```

Expected: PASS semua.

- [x] **Step 8: Commit**

```bash
git add shared/src/dto.ts server/src/services/project-view.ts server/src/routes/projects.ts \
  server/test/project-handled-by.route.test.ts
git commit -m "feat(spec-880): ProjectView membawa handledBy diperkaya status device

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Tulis (POST/PATCH) bergerbang + filter daftar

**Files:**
- Create: `server/src/services/handled-by.ts`
- Modify: `shared/src/dto.ts` (`zCreateProject`, `zUpdateProject`)
- Modify: `server/src/routes/projects.ts` (GET list filter, POST, PATCH)
- Test: `server/test/project-handled-by.route.test.ts` (tambah blok tulis)

**Interfaces:**
- Consumes: `zHandledBy`, `HandledByEntry` (Task 1); `loadDeviceIndex` (Task 2)
- Produces:
  - `export type HandledByGate = { ok: true } | { ok: false; code: number; error: string }`
  - `export async function checkHandledBy(list: HandledByEntry[]): Promise<HandledByGate>`
  - `GET /projects?handledBy=<deviceId>`
  - `POST /projects { …, handledBy? }` · `PATCH /projects/:id { …, handledBy? }`

- [x] **Step 1: Tulis test tulis yang gagal**

Tambahkan blok berikut di akhir `server/test/project-handled-by.route.test.ts` (sesudah `describe` yang sudah ada):

```ts
describe("SPEC-880 · tulis & filter penanda 'ditangani oleh'", () => {
  it("PATCH menerima daftar sah dan memulangkan view yang diperkaya", async () => {
    const d = await device("hm-dena");
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: d.id, name: "hm-dena" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().handledBy).toEqual([{ deviceId: d.id, name: "hm-dena", revoked: false }]);
    const row = await prisma.project.findUnique({ where: { id: "p1" } });
    expect(row!.handledBy).toEqual([{ deviceId: d.id, name: "hm-dena" }]);
  });

  it("PATCH menolak deviceId yang tak dikenal saat instance ini punya katalog device", async () => {
    await device("hm-dena");
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: "karangan", name: "?" }] },
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toContain("karangan");
  });

  it("PATCH menolak deviceId duplikat", async () => {
    const d = await device("hm-dena");
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: d.id, name: "a" }, { deviceId: d.id, name: "b" }] },
    });
    expect(r.statusCode).toBe(400);
  });

  // Instance tanpa katalog device (client) tak berhak menghakimi deviceId — katalognya hidup di hub.
  it("tanpa satu pun DeviceToken, deviceId apa pun diterima", async () => {
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: "device-asal-hub", name: "hub-vps" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().handledBy).toEqual([{ deviceId: "device-asal-hub", name: "hub-vps", revoked: false }]);
  });

  // Device dicabut TETAP sah: kalau tidak, PATCH yang cuma mengganti nama project akan menolak
  // nilai handledBy yang sudah tersimpan.
  it("deviceId yang sudah dicabut tetap boleh disimpan", async () => {
    const d = await device("laptop-lama", true);
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: d.id, name: "laptop-lama" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().handledBy[0].revoked).toBe(true);
  });

  it("null dan [] sama-sama mengosongkan penanda", async () => {
    const d = await device("hm-dena");
    for (const kosong of [null, []]) {
      await prisma.project.deleteMany();
      await project("p1", [{ deviceId: d.id, name: "hm-dena" }]);
      const r = await app.inject({ method: "PATCH", url: "/api/projects/p1", payload: { handledBy: kosong } });
      expect(r.statusCode).toBe(200);
      expect(r.json().handledBy).toEqual([]);
      expect((await prisma.project.findUnique({ where: { id: "p1" } }))!.handledBy).toBeNull();
    }
  });

  it("POST /projects menerima handledBy", async () => {
    const d = await device("hm-dena");
    const r = await app.inject({
      method: "POST", url: "/api/projects",
      payload: { name: "baru", kind: "existing", handledBy: [{ deviceId: d.id, name: "hm-dena" }] },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().handledBy).toEqual([{ deviceId: d.id, name: "hm-dena", revoked: false }]);
  });

  it("?handledBy=<deviceId> menyaring daftar ke project mesin itu saja", async () => {
    const a = await device("hm-dena");
    const b = await device("hub-vps");
    await project("punya-a", [{ deviceId: a.id, name: "hm-dena" }]);
    await project("punya-b", [{ deviceId: b.id, name: "hub-vps" }]);
    await project("tak-bertuan");
    const r = await app.inject({ method: "GET", url: `/api/projects?handledBy=${a.id}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.map((p: { id: string }) => p.id)).toEqual(["punya-a"]);
    expect(r.json().total).toBe(1);
  });

  it("?handledBy= bergabung dengan q, bukan menggantikannya", async () => {
    const a = await device("hm-dena");
    await project("alpha", [{ deviceId: a.id, name: "hm-dena" }]);
    await project("beta", [{ deviceId: a.id, name: "hm-dena" }]);
    const r = await app.inject({ method: "GET", url: `/api/projects?handledBy=${a.id}&q=beta` });
    expect(r.json().items.map((p: { id: string }) => p.id)).toEqual(["beta"]);
  });

  // AC-7 · revoke adalah operasi pada DeviceToken; ia tak pernah menyentuh Project.handledBy.
  it("revoke device tak menghapus penanda project", async () => {
    const d = await device("hm-dena");
    await project("p1", [{ deviceId: d.id, name: "hm-dena" }]);
    await prisma.deviceToken.update({ where: { id: d.id }, data: { revokedAt: new Date() } });
    const one = await app.inject({ method: "GET", url: "/api/projects/p1" });
    expect(one.json().handledBy).toEqual([{ deviceId: d.id, name: "hm-dena", revoked: true }]);
    expect((await prisma.project.findUnique({ where: { id: "p1" } }))!.handledBy).toHaveLength(1);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan MERAH**

```bash
TES server/test/project-handled-by.route.test.ts
```

Expected: FAIL — PATCH memulangkan 200 dengan `handledBy: []` (zod membuang field tak dikenal), dan filter `?handledBy=` diabaikan.

- [x] **Step 3: Buat gerbang `server/src/services/handled-by.ts`**

```ts
import { prisma } from "../db";
import type { HandledByEntry } from "@hanoman/shared";

// SPEC-880 · ADR-0135 · gerbang tulis penanda "ditangani oleh".
export type HandledByGate = { ok: true } | { ok: false; code: number; error: string };

// Instance yang TAK punya satu pun baris `DeviceToken` (client) sengaja TIDAK menghakimi
// `deviceId`: katalog device hidup di hub dan tak ikut SYNCED, jadi menolak di sini berarti
// menolak nilai yang sah hanya karena mesin ini kebetulan bukan pemegang katalognya.
//
// Device yang SUDAH DICABUT tetap sah (AC-7): kalau tidak, satu PATCH yang cuma mengganti nama
// project akan menolak nilai `handledBy` yang sudah tersimpan — jejak historis harus tetap terbaca.
export async function checkHandledBy(list: HandledByEntry[]): Promise<HandledByGate> {
  const known = await prisma.deviceToken.findMany({ select: { id: true } });
  if (!known.length) return { ok: true };
  const ids = new Set(known.map((d) => d.id));
  const asing = list.filter((e) => !ids.has(e.deviceId)).map((e) => e.deviceId);
  if (asing.length) return { ok: false, code: 400, error: `device tak dikenal: ${asing.join(", ")}` };
  return { ok: true };
}
```

- [x] **Step 4: Terima field di zod (`shared/src/dto.ts`)**

Tambahkan import:

```ts
import { zHandledBy, zHandledByView } from "./handled-by";
```

(gabungkan dengan import `zHandledByView` dari Task 2 — satu baris import saja)

Di `zCreateProject`, sisipkan sebelum `desc:`:

```ts
  // SPEC-880 · ADR-0135 · penanda "ditangani oleh" boleh di-set sejak awal (disync).
  handledBy: zHandledBy.optional(),
```

Di `zUpdateProject`, sisipkan sesudah baris `gitRemote:`:

```ts
  // SPEC-880 · ADR-0135 · daftar hanoman client pemegang project (DISYNC — beda dari repoDir &
  // opt-in di bawah yang lokal per-instance). `null` maupun `[]` = kosongkan. Digerbangi
  // `checkHandledBy`: deviceId wajib dikenal HANYA bila instance ini punya katalog device.
  handledBy: zHandledBy.nullable().optional(),
```

- [x] **Step 5: Pasang gerbang, normalisasi kosong, dan filter di `server/src/routes/projects.ts`**

Tambahkan import:

```ts
import { checkHandledBy } from "../services/handled-by";
```

**(a) GET list** — ganti pembacaan query dan pemotongan:

```ts
    const { q, handledBy, page, limit } = req.query as
      { q?: string; handledBy?: string; page?: string; limit?: string };
```

dan setelah blok `const filtered = …`, sisipkan:

```ts
    // SPEC-880 · ADR-0135 · "apa saja yang dipegang mesin X" dalam satu klik. Disaring di memori
    // bersama `q` — view sudah dihitung penuh, dan mem-filter JSON di SQLite tak memberi apa pun.
    const device = (handledBy ?? "").trim();
    const scoped = device
      ? filtered.filter((v) => v.handledBy.some((h) => h.deviceId === device))
      : filtered;
    return paginate(scoped, page, limit);
```

(hapus baris `return paginate(filtered, page, limit);` yang lama)

**(b) POST** — sesudah gate 409 "sudah ada" dan sebelum `realGit.initRepo`, sisipkan:

```ts
    if (b.handledBy?.length) {
      const gate = await checkHandledBy(b.handledBy);
      if (!gate.ok) return reply.code(gate.code).send({ error: gate.error });
    }
```

dan di `prisma.project.create({ data: { … } })`, sisipkan sesudah `gitRemote: b.gitRemote ?? null,`:

```ts
        ...(b.handledBy?.length ? { handledBy: b.handledBy } : {}),
```

**(c) PATCH** — sesudah blok gerbang `autoMerge`, sisipkan:

```ts
    // SPEC-880 · ADR-0135 · deviceId divalidasi terhadap katalog device instance ini (bila ada).
    if (parsed.data.handledBy?.length) {
      const gate = await checkHandledBy(parsed.data.handledBy);
      if (!gate.ok) return reply.code(gate.code).send({ error: gate.error });
    }
```

dan sesudah baris normalisasi `autoMerge`, sisipkan:

```ts
    // SPEC-880 · `null` dan `[]` sama-sama "belum ditetapkan" → satu representasi tersimpan.
    if ("handledBy" in data && !(data.handledBy as unknown[] | null)?.length) data.handledBy = Prisma.DbNull;
```

- [x] **Step 6: Jalankan test — pastikan HIJAU**

```bash
TES server/test/project-handled-by.route.test.ts
```

Expected: PASS — 15 test (5 dari Task 2 + 10 baru).

- [x] **Step 7: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```

Expected: keluar tanpa galat.

- [x] **Step 8: Commit**

```bash
git add server/src/services/handled-by.ts shared/src/dto.ts server/src/routes/projects.ts \
  server/test/project-handled-by.route.test.ts
git commit -m "feat(spec-880): POST/PATCH handledBy bergerbang + filter ?handledBy=

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Round-trip sync client → hub → client kedua

**Files:**
- Test: `server/test/project-handled-by-sync.test.ts`

**Interfaces:**
- Consumes: `FIELDS.project` + `handledBy` (Task 1); `applyPush`, `pull`, `snapshot`, `upsertLocal` dari `server/src/services/sync.ts`
- Produces: — (test murni; ia mengunci kontrak Task 1)

- [x] **Step 1: Tulis test round-trip**

Buat `server/test/project-handled-by-sync.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { applyPush, pull, snapshot, upsertLocal } from "../src/services/sync";

// SPEC-880 · ADR-0135 · penanda "ditangani oleh" HARUS menyeberang utuh — termasuk `name`, karena
// DeviceToken tak ikut SYNCED dan client kedua tak punya baris device untuk di-join.
const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.syncTombstone.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

const HANDLED = [
  { deviceId: "dev-hm-dena", name: "hm-dena" },
  { deviceId: "dev-hub", name: "hub-vps" },
];

describe("SPEC-880 · round-trip sync handledBy", () => {
  it("push client → hub: kolom tersimpan & terbit ke feed", async () => {
    const r = await applyPush("project", "arta", 0, {
      name: "arta", desc: "d", kind: "existing", stack: "", gitRemote: null, handledBy: HANDLED,
    });
    expect(r).toMatchObject({ ok: true, version: 1 });
    expect((await prisma.project.findUnique({ where: { id: "arta" } }))!.handledBy).toEqual(HANDLED);

    const feed = (await pull("0")).records.filter((x) => x.recordId === "arta");
    expect(feed).toHaveLength(1);
    expect(feed[0]!.data).toMatchObject({ handledBy: HANDLED });
  });

  it("pull ke client kedua: nama tetap utuh meski TAK ada baris DeviceToken", async () => {
    await applyPush("project", "arta", 0, {
      name: "arta", desc: "d", kind: "existing", stack: "", gitRemote: null, handledBy: HANDLED,
    });
    const snap = (await snapshot("project", "arta"))!;

    // "client kedua": buang barisnya, lalu terapkan record dari feed apa adanya.
    await prisma.project.deleteMany();
    expect(await prisma.deviceToken.count()).toBe(0);
    await upsertLocal("project", "arta", snap.version, snap.data);

    const landed = await prisma.project.findUnique({ where: { id: "arta" } });
    expect(landed!.handledBy).toEqual(HANDLED);
  });

  it("mengosongkan penanda ikut menyeberang (bukan diabaikan diam-diam)", async () => {
    await applyPush("project", "arta", 0, {
      name: "arta", desc: "d", kind: "existing", stack: "", gitRemote: null, handledBy: HANDLED,
    });
    const r = await applyPush("project", "arta", 1, {
      name: "arta", desc: "d", kind: "existing", stack: "", gitRemote: null, handledBy: null,
    });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((await prisma.project.findUnique({ where: { id: "arta" } }))!.handledBy).toBeNull();
  });

  // Kelas gagal-senyap ADR-0090/0093/0105 diuji dari sisi kebalikannya: kalau `handledBy` sampai
  // hilang dari FIELDS, snapshot berhenti membawanya dan test ini yang jatuh lebih dulu.
  it("snapshot project SELALU menyebut handledBy", async () => {
    await prisma.project.create({ data: { id: "polos", name: "polos", desc: "d", kind: "existing" } });
    const snap = (await snapshot("project", "polos"))!;
    expect(Object.keys(snap.data)).toContain("handledBy");
    expect(snap.data.handledBy).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test — pastikan HIJAU**

```bash
TES server/test/project-handled-by-sync.test.ts
```

Expected: PASS — 4 test. (Ia lulus di atas Task 1; ia ADA untuk menjaga kontrak itu tetap benar, dan akan merah begitu `handledBy` dicabut dari `FIELDS.project`.)

- [x] **Step 3: Verifikasi test ini benar-benar menjaga sesuatu**

Sementara, hapus `"handledBy", ` dari `FIELDS.project` di `server/src/services/sync.ts`, lalu:

```bash
TES server/test/project-handled-by-sync.test.ts
```

Expected: FAIL (minimal 3 test). Kembalikan baris itu dan jalankan lagi — harus PASS. Jangan commit dalam keadaan dicabut.

- [x] **Step 4: Commit**

```bash
git add server/test/project-handled-by-sync.test.ts
git commit -m "test(spec-880): round-trip sync handledBy client-hub-client

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `/sync/push` tak lagi meruntuhkan batch karena satu record

**Files:**
- Modify: `server/src/routes/sync.ts:48-60` (handler `POST /sync/push`)
- Modify: `server/src/services/sync-client.ts` (loop drain outbox)
- Test: `server/test/sync-push-partial-failure.test.ts`

**Interfaces:**
- Consumes: `applyPush` (sudah ada)
- Produces: bentuk hasil `{ id, ok: false, error: string }` per record — bentuk yang **sudah** dipakai route itu untuk `"unknown entity"`.

**Mengapa ini ada di plan SPEC-880:** `snapshot()` menyusun `data` dari **seluruh** `FIELDS`, jadi begitu Task 1 mendarat, client baru mengirim `handledBy: null` di **setiap** push project. `validateSyncData` melempar untuk field tak dikenal dan `applyPush` memanggilnya lebih dulu, sehingga hub versi lama menjawab **500 untuk seluruh batch** — bukan hanya untuk project yang penandanya diisi. Perbaikan ini **tak menolong hub lama** (ia tak punya perbaikannya; urutan rilis **hub dulu** yang menutup jendela itu) — ia menutup kelasnya untuk setiap penambahan field berikutnya dan mengubah kegagalan senyap jadi hasil yang terbaca.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/sync-push-partial-failure.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";

// SPEC-880 · satu record yang ditolak `validateSyncData` (mis. field dari instance yang lebih baru)
// dulu melempar keluar dari loop → 500 untuk SELURUH batch, dan client menganggap seluruh push
// gagal. Kini per-record: bentuk `{ id, ok:false, error }` yang sudah dipakai untuk "unknown entity".
const app = buildApp();
const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function token() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return (await issueDeviceToken(u.id, "laptop")).token;
}

describe("SPEC-880 · POST /sync/push tahan record buruk", () => {
  it("record dengan field tak dikenal ditolak sendiri; record lain di batch tetap diterima", async () => {
    const t = await token();
    const r = await app.inject({
      method: "POST", url: "/api/sync/push",
      headers: { authorization: `Bearer ${t}` },
      payload: {
        records: [
          { entity: "project", id: "buruk", baseVersion: 0,
            data: { name: "buruk", desc: "d", kind: "existing", stack: "", fieldDariMasaDepan: "x" } },
          { entity: "project", id: "baik", baseVersion: 0,
            data: { name: "baik", desc: "d", kind: "existing", stack: "" } },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const [buruk, baik] = r.json().results;
    expect(buruk).toMatchObject({ id: "buruk", ok: false });
    expect(String(buruk.error)).toContain("fieldDariMasaDepan");
    expect(baik).toMatchObject({ id: "baik", ok: true, version: 1 });
    expect(await prisma.project.findUnique({ where: { id: "buruk" } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "baik" } })).not.toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TES server/test/sync-push-partial-failure.test.ts
```

Expected: FAIL — `expected 500 to be 200`.

- [ ] **Step 3: Tangkap per-record di `server/src/routes/sync.ts`**

Cari di handler `POST /sync/push`:

```ts
      const r = await applyPush(rec.entity, rec.id, rec.baseVersion, data, req.device!.id, rec.op ?? "upsert");
      results.push({ id: rec.id, ...r });
```

Ganti jadi:

```ts
      // SPEC-880 · kegagalan SATU record (umumnya field dari instance yang lebih baru — validateSyncData
      // melempar) dulu keluar dari loop dan menjadikan SELURUH batch 500, sehingga client membaca
      // seluruh push-nya gagal dan mengulanginya tanpa ujung. Per-record: bentuk yang sama dengan
      // "unknown entity" di atas. Ini TIDAK membuat hub versi lama menerima field baru — urutan
      // rilis hub-dulu yang menutup jendela itu (ADR-0135); ini menutup kelasnya ke depan.
      try {
        const r = await applyPush(rec.entity, rec.id, rec.baseVersion, data, req.device!.id, rec.op ?? "upsert");
        results.push({ id: rec.id, ...r });
      } catch (e) {
        req.log.warn({ entity: rec.entity, recordId: rec.id, err: e }, "sync push record ditolak");
        results.push({ id: rec.id, ok: false, error: (e as Error).message });
      }
```

- [ ] **Step 4: Jalankan test — pastikan HIJAU**

```bash
TES server/test/sync-push-partial-failure.test.ts
```

Expected: PASS — 1 test.

- [ ] **Step 5: Buat kemacetan push terlihat di client**

Di `server/src/services/sync-client.ts`, di loop drain outbox, cari cabang terakhir:

```ts
    const res = await transport("POST", "/api/sync/push", {
      records: [{ entity: item.entity, id: item.recordId, baseVersion: snap.version, data: snap.data }],
    });
    const r = res.body?.results?.[0];
    if (r?.ok) {
```

Sisipkan tepat sesudah `const r = res.body?.results?.[0];`:

```ts
    // SPEC-880 · hub yang menolak record (500, atau `{ok:false,error}` per-record) dulu tak
    // meninggalkan jejak apa pun: item tetap di outbox dan diulang tiap siklus SELAMANYA tanpa
    // satu baris log. Gejala paling mungkin: hub lebih tua dari client, belum punya kolom yang
    // dikirim `snapshot()`. Non-destruktif & sembuh sendiri begitu hub naik versi — tapi ia harus
    // bisa didiagnosis, bukan ditebak.
    if (!r) {
      console.warn(`sync: push ${item.entity}:${item.recordId} tak dijawab hub (status ${res.status})`
        + " — tetap di outbox; periksa apakah hub lebih tua dari client ini");
    }
```

- [ ] **Step 6: Pastikan sync client & route yang ada tak pecah**

```bash
TES server/test/sync-push-partial-failure.test.ts server/test/sync-client.test.ts server/test/sync.route.test.ts server/test/sync-hub-origin-writes.test.ts server/test/sync-tombstone.compat.test.ts
```

Expected: PASS semua.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/sync.ts server/src/services/sync-client.ts server/test/sync-push-partial-failure.test.ts
git commit -m "fix(spec-880): /sync/push tolak per-record, bukan 500 seluruh batch

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Chip + kolom & filter di daftar project

**Files:**
- Create: `src/src/screens/HandledByChips.tsx`
- Modify: `src/src/api/client.ts` (`ProjectListParams`, `updateProject`, `listDeviceTokens` sudah ada)
- Modify: `src/src/screens/ProjectsScreen.tsx`
- Test: `src/test/project-handled-by.test.tsx`

**Interfaces:**
- Consumes: `ProjectView.handledBy` (Task 2); `api.listDeviceTokens()` (sudah ada, memulangkan `DeviceTokenView[]`)
- Produces:
  - `<HandledByChips list={p.handledBy} size?="sm"|"md" />`
  - `ProjectListParams` bertambah `handledBy?: string`
  - `api.updateProject(id, { …, handledBy?: HandledByEntry[] | null })`

- [ ] **Step 1: Tulis test frontend yang gagal**

Buat `src/test/project-handled-by.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/client", () => ({
  api: { listProjects: vi.fn(), listDeviceTokens: vi.fn() },
  ApiError: class extends Error {},
}));
import { ProjectsScreen } from "../src/screens/ProjectsScreen";
import { api } from "../src/api/client";

const P = (over: Record<string, unknown> = {}) => ({
  id: "arta", name: "arta", desc: "", kind: "existing", stack: "",
  docStatus: "ok", coverage: 90, createdAt: "", backlog: 3, topStage: "execute",
  session: { status: "idle", phase: "", flow: "feature" }, activity: "", commit: "",
  handledBy: [], ...over,
});
const envelope = (items: unknown[]): any => ({ items, total: items.length, page: 1, pageSize: 20 });

beforeEach(() => {
  vi.mocked(api.listProjects).mockReset();
  vi.mocked(api.listDeviceTokens).mockReset();
  vi.mocked(api.listDeviceTokens).mockResolvedValue([]);
});

describe("SPEC-880 · daftar project: kolom 'Ditangani'", () => {
  it("baris punya sel Ditangani dan merender nama client", () => {
    render(<ProjectsScreen projects={[P({
      handledBy: [{ deviceId: "d1", name: "hm-dena", revoked: false }],
    })] as never} onOpen={() => {}} />);
    const row = screen.getByRole("button", { name: "Buka project arta" }).closest(".hn-project-row")!;
    expect(row.querySelector('[data-label="Ditangani"]')).toBeInTheDocument();
    expect(screen.getByText("hm-dena")).toBeInTheDocument();
  });

  it("tanpa penanda → 'belum ditetapkan', bukan sel kosong", () => {
    render(<ProjectsScreen projects={[P()] as never} onOpen={() => {}} />);
    expect(screen.getByText("belum ditetapkan")).toBeInTheDocument();
  });

  it("device dicabut ditandai, bukan disembunyikan", () => {
    render(<ProjectsScreen projects={[P({
      handledBy: [{ deviceId: "d1", name: "laptop-lama", revoked: true }],
    })] as never} onOpen={() => {}} />);
    expect(screen.getByText(/laptop-lama · dicabut/)).toBeInTheDocument();
  });

  it("view lama tanpa field handledBy tak meruntuhkan baris", () => {
    const legacy = P();
    delete (legacy as Record<string, unknown>).handledBy;
    render(<ProjectsScreen projects={[legacy] as never} onOpen={() => {}} />);
    expect(screen.getByText("belum ditetapkan")).toBeInTheDocument();
  });

  it("instance tanpa katalog device: filter tak dirender", async () => {
    render(<ProjectsScreen projects={[P()] as never} pageSize={20} dataVersion={0} />);
    await waitFor(() => expect(api.listDeviceTokens).toHaveBeenCalled());
    expect(screen.queryByLabelText("Saring per client")).toBeNull();
  });

  it("dengan katalog device: filter dirender dan meneruskan handledBy ke API", async () => {
    vi.mocked(api.listDeviceTokens).mockResolvedValue([
      { id: "d1", name: "hm-dena", createdAt: "", lastSeenAt: null, revokedAt: null },
      { id: "d2", name: "sudah-dicabut", createdAt: "", lastSeenAt: null, revokedAt: "2026-08-01T00:00:00.000Z" },
    ] as never);
    vi.mocked(api.listProjects).mockResolvedValue(envelope([P()]));
    render(<ProjectsScreen projects={[P()] as never} pageSize={20} dataVersion={0} />);
    const select = await screen.findByLabelText("Saring per client");
    // device yang sudah dicabut tak ditawarkan sebagai pilihan baru
    expect(screen.queryByRole("option", { name: /sudah-dicabut/ })).toBeNull();
    (select as HTMLSelectElement).value = "d1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() =>
      expect(vi.mocked(api.listProjects).mock.calls.at(-1)![0]).toMatchObject({ handledBy: "d1" }));
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TES src/test/project-handled-by.test.tsx
```

Expected: FAIL — `Unable to find an element with the text: hm-dena`.

- [ ] **Step 3: Buat `src/src/screens/HandledByChips.tsx`**

```tsx
import React from "react";
import { Badge } from "../ds";
import type { HandledByView } from "@hanoman/shared";

/* SPEC-880 · ADR-0135 · chip "ditangani oleh" — satu komponen untuk daftar DAN detail: dua salinan
   berarti dua tempat yang bisa berbeda menjawab "device ini sudah dicabut atau belum".
   `list` boleh undefined: view dari instance/mock yang lebih tua tak membawanya. */
export function HandledByChips({ list, size = "sm" }:
  { list?: HandledByView[]; size?: "sm" | "md" }) {
  if (!list?.length) {
    return (
      <span data-testid="handled-by-empty"
        style={{ fontSize: 11.5, color: "var(--text-subtle)", fontFamily: "var(--font-ui)" }}>
        belum ditetapkan
      </span>
    );
  }
  return (
    // minWidth 0 + flex-wrap: chip memakan lebar yang tersedia dan MEMBUNGKUS, bukan mendorong
    // tetangganya keluar layar (pelajaran SPEC-879).
    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, minWidth: 0 }}>
      {list.map((h) => (
        <Badge key={h.deviceId} size={size} icon="monitor"
          tone={h.revoked ? "warn" : "brass"}
          title={h.revoked ? "device token sudah dicabut — jejaknya sengaja tak dihapus" : undefined}
          data-testid={`handled-by-${h.deviceId}`}>
          {h.revoked ? `${h.name} · dicabut` : h.name}
        </Badge>
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Perluas kontrak api client (`src/src/api/client.ts`)**

Ganti `ProjectListParams` (baris ~151):

```ts
// SPEC-880 · `handledBy` = deviceId; menjawab "apa saja yang dipegang mesin X" dalam satu klik.
export type ProjectListParams = { q?: string; handledBy?: string; page?: number; limit?: number };
```

Tambahkan `handledBy` pada body `updateProject`:

```ts
  updateProject: (id: string, b: { name?: string; desc?: string; gitRemote?: string; repoDir?: string | null; schedulerOptIn?: boolean; leadOptIn?: boolean;
    autoMerge?: AutoMerge | null;   // SPEC-486 · ADR-0103 · null = tanpa auto-merge
    handledBy?: HandledByEntry[] | null }) =>   // SPEC-880 · ADR-0135 · null/[] = belum ditetapkan
    j<ProjectView>(paths.project(id), { method: "PATCH", ...body(b) }),
```

dan tambahkan `HandledByEntry` ke baris import tipe dari `@hanoman/shared` di puncak berkas.

- [ ] **Step 5: Tambah kolom & filter di `src/src/screens/ProjectsScreen.tsx`**

Tambahkan import:

```ts
import { HandledByChips } from "./HandledByChips";
import type { DeviceTokenView } from "@hanoman/shared";
```

Dan tambahkan `isStr` + `Select` ke dua import yang sudah ada di puncak berkas — baris `../ds`
(`Select`) dan baris `../ui-state` (`isStr`, di samping `usePersistedState, useScrollRestore, isNum`).

Di `ProjectRow`, ganti `gridTemplateColumns` dan sisipkan sel baru **sebelum** sel `Aktivitas`:

```tsx
        display: "grid", gridTemplateColumns: "1.6fr 1fr 1.2fr 0.9fr 1.3fr 1.2fr",
```

```tsx
      <div data-label="Ditangani" style={{ minWidth: 0 }}><HandledByChips list={p.handledBy} /></div>
```

Di `ProjectsScreen`, ganti `cols` & `tmpl`:

```ts
  const cols = ["Project", "Status", "Docs · SoT", "Backlog", "Ditangani", "Aktivitas"];
  const tmpl = "1.6fr 1fr 1.2fr 0.9fr 1.3fr 1.2fr";
```

Tambahkan state filter tepat di bawah `const [page, setPage] = …`:

```ts
  // SPEC-880 · ADR-0135 · katalog device instance ini. `[]` = instance ini bukan pemegang katalog
  // (client) → filter tak punya arti di sini dan tak dirender. Panggilan opsional (`?.`) supaya
  // test/mock lama yang cuma menyediakan `listProjects` tak jatuh.
  const [devices, setDevices] = React.useState<DeviceTokenView[]>([]);
  const [handledBy, setHandledBy] = usePersistedState("projects", "handledBy", "", isStr);
  React.useEffect(() => {
    let alive = true;
    api.listDeviceTokens?.()
      .then((list) => { if (alive) setDevices(list); })
      .catch(() => { });
    return () => { alive = false; };
  }, []);
```

Reset halaman saat filter berubah — ganti efek reset yang ada:

```ts
  React.useEffect(() => { setPage(1); }, [search, handledBy]);
```

Teruskan ke API di efek fetch:

```ts
    const p = api.listProjects?.({ q: search || undefined, handledBy: handledBy || undefined, page, limit: pageSize });
```

dan tambahkan `handledBy` ke daftar dependensi efek itu.

Render kontrolnya di dalam `FIXED_ROW_STYLE` bersama `StatStrip` — ganti baris itu jadi:

```tsx
      <div style={FIXED_ROW_STYLE}>
        <StatStrip projects={projects} />
        {/* SPEC-880 · disembunyikan di instance tanpa katalog device: pilihan yang tak bisa diisi
            lebih buruk daripada tak ada pilihan. Device dicabut tak ditawarkan sebagai pilihan
            BARU, tapi nilai tersimpan tetap tampil sebagai chip di barisnya. */}
        {devices.some((d) => !d.revokedAt) && (
          <div className="hn-dense-row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span className="hn-eyebrow">Ditangani oleh</span>
            <Select aria-label="Saring per client" value={handledBy} style={{ minWidth: 180 }}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setHandledBy(e.target.value)}
              options={[{ value: "", label: "Semua client" },
                ...devices.filter((d) => !d.revokedAt).map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
        )}
      </div>
```

Tambahkan `Select` ke import `../ds` di puncak berkas.

- [ ] **Step 6: Jalankan test — pastikan HIJAU**

```bash
TES src/test/project-handled-by.test.tsx
```

Expected: PASS — 6 test.

- [ ] **Step 7: Pastikan test daftar project lama tak pecah**

```bash
TES src/test/projects-screen.test.tsx src/test/app-state-persist.test.tsx
```

Expected: PASS semua.

- [ ] **Step 8: Commit**

```bash
git add src/src/screens/HandledByChips.tsx src/src/screens/ProjectsScreen.tsx src/src/api/client.ts \
  src/test/project-handled-by.test.tsx
git commit -m "feat(spec-880): kolom Ditangani + filter per client di daftar project

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Detail project + editor multi-select (read-only di client)

**Files:**
- Modify: `src/src/screens/ProjectDetailScreen.tsx`
- Modify: `src/src/App.tsx` (`EditProjectModal`, `updateProject`)
- Test: `src/test/project-handled-by.test.tsx` (tambah blok)

**Interfaces:**
- Consumes: `<HandledByChips>` (Task 6); `api.listDeviceTokens()`; `api.updateProject(id, { handledBy })` (Task 6)
- Produces: `EditProjectModal.onSave(f)` bertambah field `handledBy: HandledByEntry[] | undefined` — **`undefined` berarti "jangan sentuh"**, dipakai mode baca-saja.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/test/project-handled-by.test.tsx`. Mengimpor `EditProjectModal` menarik
seluruh modul `App.tsx`; bila import itu meledak karena `api` yang di-mock kurang lengkap, tambahkan
fungsi yang diminta ke objek mock di puncak berkas (`vi.fn()` yang memulangkan Promise kosong sudah
cukup — modal ini hanya memakai `listDeviceTokens`).

```tsx
import { EditProjectModal } from "../src/App";
import { ProjectDetailScreen } from "../src/screens/ProjectDetailScreen";

const DETAIL_PROPS = {
  onEdit: () => {}, onGotoDocs: () => {}, onGotoTerminal: () => {}, onGotoBacklog: () => {},
  onGotoChangelog: () => {}, onDelete: () => {}, onToast: () => {},
};

describe("SPEC-880 · detail project", () => {
  it("penanda tampil di panel info dan dinyatakan DISYNC", () => {
    render(<ProjectDetailScreen p={P({
      handledBy: [{ deviceId: "d1", name: "hm-dena", revoked: false }],
    }) as never} {...DETAIL_PROPS} />);
    expect(screen.getByText("Ditangani oleh · disync")).toBeInTheDocument();
    expect(screen.getByText("hm-dena")).toBeInTheDocument();
  });

  it("repo tetap dinyatakan fakta mesin ini saja", () => {
    render(<ProjectDetailScreen p={P({ binding: "/tmp/arta" }) as never} {...DETAIL_PROPS} />);
    expect(screen.getByText("Repo · mesin ini")).toBeInTheDocument();
  });
});

describe("SPEC-880 · editor penanda di EditProjectModal", () => {
  it("dengan katalog device: multi-select dirender dan nilai tersimpan terpilih", async () => {
    vi.mocked(api.listDeviceTokens).mockResolvedValue([
      { id: "d1", name: "hm-dena", createdAt: "", lastSeenAt: null, revokedAt: null },
    ] as never);
    render(<EditProjectModal open project={P({
      handledBy: [{ deviceId: "d1", name: "hm-dena", revoked: false }],
    }) as never} onClose={() => {}} onSave={() => {}} />);
    expect(await screen.findByLabelText("Pilih hanoman client")).toBeInTheDocument();
    expect(screen.getByTestId("chip-d1")).toBeInTheDocument();
  });

  it("tanpa katalog device: baca-saja, nama tersimpan tetap terlihat, tak ada kontrol", async () => {
    vi.mocked(api.listDeviceTokens).mockResolvedValue([] as never);
    render(<EditProjectModal open project={P({
      handledBy: [{ deviceId: "dev-hub", name: "hub-vps", revoked: false }],
    }) as never} onClose={() => {}} onSave={() => {}} />);
    await waitFor(() => expect(api.listDeviceTokens).toHaveBeenCalled());
    expect(screen.getByText("hub-vps")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pilih hanoman client")).toBeNull();
    expect(screen.getByText(/hanya bisa diubah dari instance yang memegang katalog device/)).toBeInTheDocument();
  });

  // Inti K4: mengirim [] dari instance read-only akan MENGHAPUS nilai yang di-set di hub, dan
  // penghapusannya menyeberang. `undefined` = jangan sentuh.
  it("mode baca-saja menyimpan TANPA field handledBy", async () => {
    vi.mocked(api.listDeviceTokens).mockResolvedValue([] as never);
    const onSave = vi.fn();
    render(<EditProjectModal open project={P({
      handledBy: [{ deviceId: "dev-hub", name: "hub-vps", revoked: false }],
    }) as never} onClose={() => {}} onSave={onSave} />);
    await waitFor(() => expect(api.listDeviceTokens).toHaveBeenCalled());
    screen.getByRole("button", { name: "Simpan" }).click();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toHaveProperty("handledBy", undefined);
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

```bash
TES src/test/project-handled-by.test.tsx
```

Expected: FAIL — `Unable to find an element with the text: Ditangani oleh · disync`.

- [ ] **Step 3: Tampilkan penanda di `src/src/screens/ProjectDetailScreen.tsx`**

Tambahkan import:

```ts
import { HandledByChips } from "./HandledByChips";
```

Di grid meta header, sisipkan sel baru tepat **sesudah** `<Meta label="Git remote" …/>`:

```tsx
          {/* SPEC-880 · ADR-0135 · penanda "ditangani oleh" = pernyataan yang DISYNC ke setiap
              mesin; `Repo · mesin ini` di sebelahnya adalah fakta mesin ini saja. Pembedaan itu
              dinyatakan di labelnya, bukan disiratkan. */}
          <div>
            <div className="hn-eyebrow">Ditangani oleh · disync</div>
            <div style={{ marginTop: 4 }}><HandledByChips list={p.handledBy} /></div>
          </div>
```

- [ ] **Step 4: Tambahkan editor di `EditProjectModal` (`src/src/App.tsx`)**

Tambahkan `MultiSelect` ke import `./ds` dan `DeviceTokenView`/`HandledByEntry` ke import tipe `@hanoman/shared`.

Ganti tanda tangan + state komponen:

```tsx
export function EditProjectModal({ open, project, onClose, onSave }:
  { open: boolean; project?: ProjectVM; onClose: () => void;
    onSave: (f: { id: string; name: string; desc: string; dir: string; gitRemote: string;
      handledBy?: HandledByEntry[] }) => void }) {
```

Tambahkan state tepat di bawah `const [picker, setPicker] = React.useState(false);`:

```tsx
  // SPEC-880 · ADR-0135 · katalog device instance ini. `[]` = instance ini tak memegang katalognya
  // (client) → editor jatuh ke BACA-SAJA dan `handledBy` tak ikut disimpan sama sekali: mengirim
  // `[]` dari sini akan MENGHAPUS nilai yang di-set di hub, dan penghapusan itu menyeberang.
  const [devices, setDevices] = React.useState<DeviceTokenView[] | null>(null);
  const [handled, setHandled] = React.useState<HandledByEntry[]>([]);
  const canEditHandled = !!devices?.length;
```

Perluas efek yang mengisi form:

```tsx
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
```

Ganti tombol Simpan di `footer` agar mengoper `handledBy`:

```tsx
        <Button size="sm" leftIcon="check" onClick={() => canSubmit && onSave({
          ...f, handledBy: canEditHandled ? handled : undefined,
        })}>Simpan</Button>
```

Sisipkan Field baru tepat **sesudah** Field `Git remote`:

```tsx
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
```

Tambahkan `import { HandledByChips } from "./screens/HandledByChips";` di puncak `App.tsx`.

- [ ] **Step 5: Teruskan nilainya di `updateProject` (`src/src/App.tsx`)**

Ganti tanda tangan fungsi:

```tsx
  async function updateProject(f: { id: string; name: string; desc: string; dir: string; gitRemote: string;
    handledBy?: HandledByEntry[] }) {
```

dan panggilan PATCH-nya:

```tsx
      // SPEC-218 · gitRemote disync; "" = kosongkan (endpoint clone cek `!gitRemote`, falsy).
      // SPEC-880 · `handledBy` HANYA disertakan bila instance ini memegang katalog device —
      // `undefined` di sini berarti "jangan sentuh", bukan "kosongkan".
      await api.updateProject(effId, {
        name: f.name.trim(), desc: f.desc.trim(), gitRemote: f.gitRemote.trim(),
        ...(f.handledBy ? { handledBy: f.handledBy } : {}),
      });
```

- [ ] **Step 6: Jalankan test — pastikan HIJAU**

```bash
TES src/test/project-handled-by.test.tsx
```

Expected: PASS — 11 test.

- [ ] **Step 7: Pastikan alur project lama tak pecah**

```bash
TES src/test/projects-screen.test.tsx src/test/app-flows.test.tsx src/test/project-detail-changelog.test.tsx src/test/project-help-center.test.tsx src/test/missing-repo-card.test.tsx
```

Expected: PASS semua. (Bila `missing-repo-card.test.tsx` tak ada, hilangkan dari daftar.)

- [ ] **Step 8: Typecheck frontend**

```bash
pnpm --filter ./src typecheck
```

Expected: keluar tanpa galat. (Bila nama filter itu salah, jalankan `node -e "console.log(require('./src/package.json').name)"` dan pakai `pnpm --filter <nama> typecheck`.)

- [ ] **Step 9: Commit**

```bash
git add src/src/screens/ProjectDetailScreen.tsx src/src/App.tsx src/test/project-handled-by.test.tsx
git commit -m "feat(spec-880): penanda di detail project + editor multi-select (read-only di client)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: ADR-0135 + docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0135-penanda-project-ditangani-hanoman-client.md`
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/architecture/data-model.md` (seksi `## Project`)
- Modify: `internal/docs/architecture/api-contract.md` (seksi `## Projects` + catatan `/sync/push`)

**Interfaces:**
- Consumes: keputusan Task 1–7
- Produces: — (docs)

- [ ] **Step 1: Tulis ADR-0135**

Buat `internal/docs/adr/0135-penanda-project-ditangani-hanoman-client.md`:

```markdown
# ADR-0135 — Penanda "ditangani oleh" pada Project: kolom `Json` yang MASUK sync, berisi snapshot device

- Status: berlaku
- Tanggal: 2026-08-21
- SPEC: SPEC-880
- Menegakkan: ADR-0043, ADR-0044, ADR-0045 · Kontras dengan: ADR-0072, ADR-0091, ADR-0103

## Konteks

Satu instalasi hanoman dipakai dari beberapa mesin (hub VPS + instance lokal) yang saling sync
lewat device token (ADR-0044/0045). Yang tak ada di mana pun: keterangan **project ini dipegang
mesin yang mana**.

`ProjectsScreen` dan detail project hanya menampilkan `repoDir`/`binding`, dan keduanya justru
**LOCAL-only** — `Project.repoDir` sengaja di luar `FIELDS.project`, `LocalBinding` bahkan tak
punya entitas sync. Akibatnya di hub setiap project tampak sama tak bertuan.

`SessionResult.deviceId` ada dan ikut menyeberang, tapi itu **jejak eksekusi per-sesi**, bukan
pernyataan kepemilikan: project yang belum pernah dikerjakan tak punya jejak sama sekali.

## Keputusan

**1. Kolom `Project.handledBy` (`Json?`, nullable, nol backfill) yang MASUK `FIELDS.project`.**

Ini pembalikan yang disengaja dari pola empat kolom project sebelumnya. `repoDir` (SPEC-217),
`schedulerOptIn` (ADR-0072), `leadOptIn` (ADR-0091), dan `autoMerge` (ADR-0103) semuanya
LOCAL-only karena masing-masing adalah **properti mesin ini** — path checkout, apakah mesin ini
ikut menjalankan scheduler, branch tujuan di checkout ini. `handledBy` adalah **pernyataan tentang
dunia**, dan justru menyeberangnya nilai itu yang jadi seluruh gunanya.

`Json` tunggal, bukan tabel join `ProjectHandler`: nilainya dibaca utuh, tak pernah di-`orderBy`,
dan tabel join yang tak ikut `SYNCED` akan melahirkan kelas gagal yang sama yang keputusan ini
hendak tutup. Preseden: `Spec.dependsOn` (ADR-0093), `Setting.conflict` (ADR-0081).

**2. Tiap entri adalah SNAPSHOT device `{ deviceId, name }`, bukan sekadar FK.**

`DeviceToken` **tidak** ikut `SYNCED` — ia server-local di hub, dan `sync-exclusions.test.ts`
menegakkannya. Client penerima karena itu **tak punya baris device untuk di-join**. Tanpa `name`
yang ikut tersimpan, chip di client tampil **kosong tanpa satu pun error** — persis kelas
gagal-senyap ADR-0090/0093/0105.

`revoked` sengaja **tidak** disimpan: ia turunan baris `DeviceToken` lokal dan berbeda per
instance. Menyimpannya berarti membekukan fakta hub ke dalam record yang menyeberang.

**3. Penyimpanan mentah, tampilan yang menghitung.** `toProjectView` memperkaya nilai tersimpan
jadi `{ deviceId, name, revoked }`: nama **hidup** menang bila barisnya ada di instance ini
(rename device ikut terlihat), snapshot jadi jaring pengamannya, dan `revoked` selalu `false` di
instance yang tak memegang katalog device.

**4. Gerbang tulis menghakimi hanya bila ia berhak.** Instance tanpa satu pun baris `DeviceToken`
(client) menerima `deviceId` apa adanya — katalognya hidup di hub. Device yang **sudah dicabut**
tetap sah: kalau tidak, satu PATCH yang cuma mengganti nama project akan menolak nilai yang sudah
tersimpan. Revoke **tidak pernah** menghapus penanda; jejak historis tetap terbaca, bertanda
"dicabut".

**5. Editor jatuh ke baca-saja di instance tanpa katalog device**, dan pada mode itu `handledBy`
**dihilangkan sepenuhnya** dari body PATCH. Mengirim `[]` dari sana akan **menghapus** nilai yang
di-set di hub, dan penghapusan itu menyeberang.

**6. Murni informasional.** Penanda ini tak menggerbangi start sesi, worktree, auto-merge,
scheduler, maupun lead. Sesi tetap boleh dijalankan dari mesin mana pun.

## Kompatibilitas versi: rilis HUB DULU

`validateSyncData` **melempar** untuk field tak dikenal, dan `applyPush` memanggilnya lebih dulu.
Bahayanya lebih luas dari "project yang penandanya diisi": `snapshot()` menyusun `data` dari
**seluruh** `FIELDS`, jadi client baru mengirim `handledBy: null` di **setiap** push project.
Terhadap hub versi lama, **setiap** push project ditolak sampai hub di-upgrade.

Dua langkah, dan keduanya jujur soal batasnya:

1. **Urutkan rilis: hub dulu.** Tak ada kode di sisi client yang bisa membuat hub lama menerima
   field yang tak dikenalnya.
2. **`POST /sync/push` menangkap kegagalan per-record** → `{ id, ok: false, error }` alih-alih 500
   untuk seluruh batch (bentuk yang sudah dipakai route itu untuk `"unknown entity"`). Ini **tak
   menolong hub lama** — ia menutup kelasnya untuk setiap penambahan field berikutnya.

Kegagalan sisi client sendiri **sudah** non-destruktif dan sembuh sendiri: item outbox bertahan,
tak ada tulisan yang korup, dan ia lolos begitu hub naik versi. Yang ditambahkan hanya satu
`console.warn` supaya kemacetan itu bisa didiagnosis, bukan ditebak.

## Konsekuensi

**Baik.** "Apa saja yang dipegang mesin X" bisa dijawab satu klik (`GET /projects?handledBy=<id>`).
Hub berhenti menampilkan project tak bertuan. Setiap penambahan field sync ke depan tak lagi bisa
meruntuhkan satu batch push utuh.

**Buruk.** Nama device tersimpan **dua kali** (baris `DeviceToken` di hub + snapshot di tiap
project) — konsekuensi yang diterima sadar: satu-satunya alternatif adalah menyync `DeviceToken`,
dan itu memindahkan kredensial-adjacent ke setiap client. Nama basi hanya terlihat di instance
yang tak punya baris device-nya; di mana pun barisnya ada, nama hidup yang menang.

**Batas.** Penanda ini **bukan** otorisasi dan **bukan** routing. Ia tak dibaca satu pun jalur
eksekusi, dan tak boleh mulai dibaca tanpa ADR baru.
```

- [ ] **Step 2: Tautkan ADR di `internal/docs/adr/README.md`**

Buka berkasnya, temukan baris entri `0134`, dan sisipkan entri baru **di atasnya** (daftar terurut menurun) memakai format yang sama persis dengan tetangganya:

```markdown
- [0135 — Penanda "ditangani oleh" pada Project: kolom `Json` yang MASUK sync, berisi snapshot device](0135-penanda-project-ditangani-hanoman-client.md) — menegakkan 0043/0044/0045, kontras dengan 0072/0091/0103 (SPEC-880)
```

- [ ] **Step 3: Tautkan ADR di `internal/docs/README.md`**

Di seksi ADR (baris ~93, di atas entri `0131`… — daftarnya terurut menurun; sisipkan di puncak daftar ADR):

```markdown
- [0135 — Penanda "ditangani oleh" pada Project: kolom `Json` yang MASUK sync, berisi snapshot device](adr/0135-penanda-project-ditangani-hanoman-client.md) — menegakkan 0043/0044/0045 (SPEC-880)
```

- [ ] **Step 4: Perbarui `internal/docs/architecture/data-model.md`**

Di seksi `## Project`, sisipkan butir baru tepat **sesudah** butir `autoMerge` dan **sebelum** butir `docStatus`:

```markdown
- `handledBy` (Json?, SPEC-880 · [ADR-0135](../adr/0135-penanda-project-ditangani-hanoman-client.md)) —
  penanda **"ditangani oleh"**: daftar hanoman client yang memegang project ini, bentuknya
  `[{deviceId, name}]` (`zHandledBy`, `@hanoman/shared`). `null` = **belum ditetapkan** — default,
  nol backfill. **MASUK whitelist `FIELDS` sync**, dan di situlah ia berbeda dari keempat butir di
  atasnya: `repoDir`/`schedulerOptIn`/`leadOptIn`/`autoMerge` LOCAL-only karena masing-masing
  properti MESIN ini, sedangkan `handledBy` adalah pernyataan tentang dunia — justru menyeberangnya
  nilai itu yang jadi seluruh gunanya. Tiap entri **snapshot**, bukan FK: `DeviceToken` tak ikut
  `SYNCED`, jadi client penerima tak punya baris device untuk di-join dan chip akan kosong tanpa
  satu pun error kalau `name` tak ikut tersimpan (kelas ADR-0090/0093/0105). `revoked` **tidak**
  disimpan — ia diturunkan `toProjectView` dari baris `DeviceToken` lokal; revoke device **tak
  pernah** menghapus penanda. Diekspos `toProjectView` sebagai `handledBy: [{deviceId,name,revoked}]`
  (`[]` bila kolomnya null), editable via `PATCH /projects/:id` (digerbangi `checkHandledBy`:
  400 bila `deviceId` tak dikenal **dan** instance ini punya katalog device); **masuk** allowlist
  `WEBHOOK_ENTITIES`. Murni informasional — tak menggerbangi sesi, worktree, auto-merge, scheduler,
  maupun lead.
```

- [ ] **Step 5: Perbarui `internal/docs/architecture/api-contract.md`**

Di seksi `## Projects`, ganti tiga baris berikut:

```
GET  /projects?q=&page=&limit=      # -> { items: ProjectView[], total, page, pageSize } (SPEC-198)
#   q menyaring name+desc+stack; tanpa page/limit → seluruh item. coverage/docStatus tetap live-scan tiap panggil.
POST /projects            { name, kind, repoDir?, desc, gitRemote? }   # repoDir OPSIONAL (SPEC-217)
```

jadi:

```
GET  /projects?q=&handledBy=&page=&limit=   # -> { items: ProjectView[], total, page, pageSize } (SPEC-198)
#   q menyaring name+desc+stack; tanpa page/limit → seluruh item. coverage/docStatus tetap live-scan tiap panggil.
#   SPEC-880 · ADR-0135 · `handledBy=<deviceId>` menyaring ke project yang penandanya memuat device
#   itu — "apa saja yang dipegang mesin X" dalam satu klik. Bergabung dengan `q`, bukan menggantikannya.
POST /projects            { name, kind, repoDir?, desc, gitRemote?, handledBy? }   # repoDir OPSIONAL (SPEC-217)
```

Ganti baris `PATCH /projects/:id` jadi:

```
PATCH /projects/:id       { name?, desc?, gitRemote?, handledBy?, repoDir?, schedulerOptIn?, leadOptIn?, autoMerge? }   # 200 view; 400 name kosong; 404 tak ada.
```

dan sisipkan catatan berikut tepat sesudah baris `#   SPEC-217 · repoDir …`:

```
#   SPEC-880 · ADR-0135 · `handledBy` = penanda "ditangani oleh", `[{deviceId,name}]` — DISYNC
#   (beda dari repoDir/binding/schedulerOptIn/leadOptIn/autoMerge yang lokal per-instance).
#   `null` maupun `[]` mengosongkan. 400 bila deviceId duplikat, > 32 entri, atau tak dikenal
#   SEMENTARA instance ini punya katalog device; instance tanpa satu pun DeviceToken (client)
#   menerima apa adanya. Device DICABUT tetap sah — revoke tak pernah menghapus penanda.
#   View memulangkan `[{deviceId,name,revoked}]`: nama HIDUP bila barisnya ada di sini, snapshot
#   bila tidak. Picker memakai `GET /device-tokens` yang sudah ada — tak ada endpoint baru.
```

Terakhir, di seksi sync (cari baris `POST /sync/push`), sisipkan catatan:

```
#   SPEC-880 · hasil dinilai PER RECORD: record yang ditolak (mis. field dari instance yang lebih
#   baru) memulangkan { id, ok:false, error } dan record lain di batch yang sama TETAP diterima —
#   dulu ia melempar keluar loop dan menjadikan seluruh batch 500. Menambah kolom ke FIELDS tetap
#   menuntut urutan rilis HUB DULU: hub lama tak punya perbaikan ini (ADR-0135).
```

- [ ] **Step 6: Verifikasi integritas index docs**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || npx tsx cli/src/index.ts docs index --check
```

Expected: laporan tanpa entri hilang. (Bila kedua perintah tak jalan di worktree ini, verifikasi manual: `grep -c "0135-penanda-project-ditangani" internal/docs/README.md internal/docs/adr/README.md` harus memulangkan `1` untuk keduanya.)

- [ ] **Step 7: Commit**

```bash
git add internal/docs/adr/0135-penanda-project-ditangani-hanoman-client.md \
  internal/docs/adr/README.md internal/docs/README.md \
  internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md
git commit -m "docs(spec-880): ADR-0135 penanda 'ditangani oleh' + data-model & api-contract

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Verifikasi menyeluruh + smoke endpoint nyata

**Files:** —

**Interfaces:**
- Consumes: seluruh task sebelumnya
- Produces: bukti hijau sebelum push

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR -u DATABASE_URL \
  NODE_ENV=test TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism --changed "$HANOMAN_BASE_SHA"
```

Expected: PASS. **Jangan menerima "no test files" sebagai bukti** — `--changed` menyalakan
`passWithNoTests`, jadi nol test terlihat hijau. Pastikan berkas test SPEC-880 memang terdaftar di
keluaran; bila tidak, sebut path-nya langsung:

```bash
TES server/test/project-handled-by-contract.test.ts server/test/project-handled-by.route.test.ts \
    server/test/project-handled-by-sync.test.ts server/test/sync-push-partial-failure.test.ts \
    src/test/project-handled-by.test.tsx
```

Bila ada yang merah, ukur baseline di `$HANOMAN_BASE_SHA` sebelum menyimpulkan regresi —
`portal-chat`/`settings` sudah merah di base dan bukan urusan spec ini.

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: keluar tanpa galat. **Jangan** `pnpm -r typecheck`.

- [ ] **Step 3: Smoke endpoint nyata (sekali, di akhir)**

Spec ini menyentuh endpoint, jadi boot server terhadap DB khusus lalu curl.

```bash
SMOKE_DB="$(mktemp -d)/smoke.db"
env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR \
  NODE_ENV=test HANOMAN_DATABASE_URL="file:$SMOKE_DB" DATABASE_URL="file:$SMOKE_DB" \
  npx prisma migrate deploy --schema server/prisma/schema.prisma
env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_SUPERVISOR -u HANOMAN_WEB_DIR \
  NODE_ENV=test HANOMAN_DATABASE_URL="file:$SMOKE_DB" DATABASE_URL="file:$SMOKE_DB" PORT=8799 \
  npx tsx server/src/server.ts &
sleep 4
curl -s -X POST localhost:8799/api/projects -H 'content-type: application/json' \
  -d '{"name":"smoke-880","kind":"existing"}'
curl -s -X PATCH localhost:8799/api/projects/smoke-880 -H 'content-type: application/json' \
  -d '{"handledBy":[{"deviceId":"dev-x","name":"hm-dena"}]}'
curl -s 'localhost:8799/api/projects?handledBy=dev-x'
curl -s 'localhost:8799/api/projects?handledBy=tak-ada'
```

Expected:
- POST → 201 dengan `"handledBy":[]`
- PATCH → 200 dengan `"handledBy":[{"deviceId":"dev-x","name":"hm-dena","revoked":false}]`
- filter `dev-x` → `"total":1`
- filter `tak-ada` → `"total":0`

Bereskan prosesnya **per-PID**, jangan `pkill -f`:

```bash
kill "$(lsof -ti:8799)"
```

- [ ] **Step 4: Diff bersih & centang seluruh checklist plan**

```bash
git status --porcelain
```

Expected: kosong. Pastikan setiap `- [ ]` di plan ini sudah jadi `- [x]` — hanoman menahan backlog
di `executing` selama masih ada kotak kosong.

- [ ] **Step 5: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-880
```
