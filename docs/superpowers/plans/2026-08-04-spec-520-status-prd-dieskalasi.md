# SPEC-520 — Status PRD turunan (draft · dieskalasi · terwujud) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Status `draft` hanya melekat pada PRD yang belum menurunkan backlog; PRD yang sudah
menurunkan backlog memakai `dieskalasi` (belum semua turunannya selesai) atau `terwujud` (semua
selesai), dan pembedaannya terlihat sebagai lencana + filter di daftar PRD.

**Architecture:** Status adalah **nilai turunan**, bukan kolom (ADR-0018/0019; PRD sendiri bukan
entitas DB, ADR-0041). Ia dihitung dari jejak eskalasi yang sudah ada di baris `Spec`: path PRD
utuh di `payload.context`/`payload.goal` (ketiga jalur take/breakdown menulisnya) atau
`branchFrom === "prd/<slug>"`. Logikanya fungsi murni di `shared/`, dipanggil
`server/src/services/project-prds.ts` saat daftar PRD dirakit, dan dikirim sebagai tiga field
aditif di `PrdDoc`.

**Tech Stack:** TypeScript strict · zod (`shared`) · Prisma 6 + SQLite (`server`) · Fastify ·
React 18 + Vite (`src`) · vitest.

## Global Constraints

- **Tanpa kolom baru, tanpa migration, tanpa ADR baru.** Kendala brief SPEC-520 eksplisit:
  "Jangan menambah kolom status baru bila relasi backlog sudah cukup menentukannya."
  ADR-0018/0019, ADR-0041, ADR-0069 **ditegakkan**, bukan diamandemen.
- **Tiga status, kosakata tetap:** `draft` · `dieskalasi` · `terwujud` (ditulis apa adanya di UI,
  huruf kecil).
- **Pencocokan berbasis path utuh** `docs/prd/<slug>.md`, **bukan** kata "PRD". Kontrol negatif
  nyata di DB hidup: SPEC-244, SPEC-273, SPEC-407 memuat kata "PRD" tanpa path.
- **Kandidat selalu disaring `projectId`** sebelum status dihitung.
- Bahasa komentar & UI: **Indonesia**. Komentar menyebut nomor SPEC/ADR seperti file sekitarnya.
- Scope verifikasi: hanya paket yang tersentuh. Test server **wajib**
  `--no-file-parallelism` + `TEST_DATABASE_URL` sendiri. Test web **wajib** `env -u NODE_ENV`.

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/prd-status.ts` *(baru)* | Kosakata status + pencocokan jejak + `prdStatusOf` — murni, nol dependensi DB/React |
| `shared/src/prd-status.test.ts` *(baru)* | Test murni: tiga jalur eskalasi, kontrol negatif, transisi status |
| `shared/src/index.ts` | Ekspor modul baru dari barrel |
| `shared/src/dto.ts` | `zPrdDoc` + tiga field aditif |
| `server/src/services/project-prds.ts` | Menarik trace (satu query) & menempelkan status ke tiap `PrdDoc` |
| `server/test/project-prds.test.ts` | Status per project, isolasi antar project, jalur lintas-project |
| `src/src/screens/PrdScreen.tsx` | Lencana status, ganti kata lencana `live`, filter status |
| `src/test/prd-screen.test.tsx` | Render lencana, filter menyempitkan daftar, empty state ber-status |
| `internal/docs/architecture/data-model.md` | Bagian PRD: status turunan + dua kunci jejak |
| `internal/docs/architecture/api-contract.md` | Field baru `PrdDoc` |
| `internal/skills/hanoman/SKILL.md` | Satu butir ringkas + gotcha |

---

## Task 1: Kosakata & derivasi status — `shared/src/prd-status.ts`

**Files:**
- Create: `shared/src/prd-status.ts`
- Test: `shared/src/prd-status.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `zod` (sudah dependensi `shared`).
- Produces — dipakai Task 2 & Task 3 persis dengan nama ini:
  - `PRD_STATUSES: readonly ["draft","dieskalasi","terwujud"]`
  - `zPrdStatus: z.ZodEnum<["draft","dieskalasi","terwujud"]>`
  - `type PrdStatus = "draft" | "dieskalasi" | "terwujud"`
  - `type PrdSpecTrace = { stage: string; payload: unknown; branchFrom: string | null }`
  - `prdBranchFor(prdPath: string): string | null`
  - `specDerivesFromPrd(spec: PrdSpecTrace, prdPath: string): boolean`
  - `prdStatusOf(prdPath: string, specs: readonly PrdSpecTrace[]): { status: PrdStatus; specCount: number; doneCount: number }`

- [ ] **Step 1: Tulis test yang gagal**

Buat `shared/src/prd-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PRD_STATUSES, zPrdStatus, prdBranchFor, specDerivesFromPrd, prdStatusOf, type PrdSpecTrace,
} from "./prd-status";

const PRD = "docs/prd/jadwal-invoice.md";
// Bentuk baris Spec seperlunya; default = brief tanpa jejak PRD apa pun.
const spec = (over: Partial<PrdSpecTrace> = {}): PrdSpecTrace =>
  ({ stage: "planned", payload: { context: "", outcome: "", constraints: "", priority: "sedang" },
     branchFrom: null, ...over });

describe("kosakata", () => {
  it("tiga status, urutan tetap", () =>
    expect(PRD_STATUSES).toEqual(["draft", "dieskalasi", "terwujud"]));
  it("zod menolak status karangan", () =>
    expect(zPrdStatus.safeParse("terpakai").success).toBe(false));
});

describe("prdBranchFor", () => {
  it("docs/prd/<slug>.md → prd/<slug>", () =>
    expect(prdBranchFor(PRD)).toBe("prd/jadwal-invoice"));
  it("bukan PRD → null", () => {
    expect(prdBranchFor("internal/docs/README.md")).toBeNull();
    expect(prdBranchFor("docs/prd/x.txt")).toBeNull();
    expect(prdBranchFor("docs/prd/.md")).toBeNull();
  });
});

describe("specDerivesFromPrd — tiga jalur eskalasi yang sudah ada", () => {
  it("take → feature brief: context 'Dari PRD: <path>'", () =>
    expect(specDerivesFromPrd(spec({ payload: { context: `Dari PRD: ${PRD}` } }), PRD)).toBe(true));
  it("breakdown (ADR-0069): context 'Dari PRD (breakdown): <path>\\n\\n…'", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { context: `Dari PRD (breakdown): ${PRD}\n\nScope A blok ringkasan` } }), PRD)).toBe(true));
  it("take → goal (ADR-0089): payload.goal 'Wujudkan PRD <path>'", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { goal: `Wujudkan PRD ${PRD}`, done: "", constraints: "", priority: "sedang" } }), PRD)).toBe(true));
  it("K2: branchFrom prd/<slug> tanpa jejak payload", () =>
    expect(specDerivesFromPrd(spec({ branchFrom: "prd/jadwal-invoice" }), PRD)).toBe(true));
});

describe("specDerivesFromPrd — kontrol negatif", () => {
  // Bentuk SPEC-244/273/407 di DB nyata: prosanya menyebut "PRD" tanpa path apa pun.
  it("prosa menyebut kata PRD tanpa path → tidak cocok", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { context: "saat ini belum ada breakdown dari PRD yang complex" } }), PRD)).toBe(false));
  it("PRD lain di project yang sama → tidak cocok", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { context: "Dari PRD: docs/prd/notifikasi.md" } }), PRD)).toBe(false));
  it("slug berawalan sama tidak saling cocok", () => {
    const auth = "docs/prd/auth.md";
    expect(specDerivesFromPrd(
      spec({ payload: { context: "Dari PRD: docs/prd/auth-device.md" } }), auth)).toBe(false);
    expect(specDerivesFromPrd(spec({ branchFrom: "prd/auth-device" }), auth)).toBe(false);
  });
  it("payload null / bentuk qa / non-objek tak melempar", () => {
    expect(specDerivesFromPrd(spec({ payload: null }), PRD)).toBe(false);
    expect(specDerivesFromPrd(
      spec({ payload: { severity: "major", steps: "", expected: "", actual: "", env: "" } }), PRD)).toBe(false);
    expect(specDerivesFromPrd(spec({ payload: "Dari PRD: " + PRD }), PRD)).toBe(false);
  });
  it("path bukan PRD tak pernah cocok", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { context: "Dari PRD: internal/docs/README.md" } }), "internal/docs/README.md")).toBe(false));
});

describe("prdStatusOf", () => {
  const from = (stage: string): PrdSpecTrace => spec({ stage, payload: { context: `Dari PRD: ${PRD}` } });
  it("nol turunan → draft", () =>
    expect(prdStatusOf(PRD, [])).toEqual({ status: "draft", specCount: 0, doneCount: 0 }));
  it("hanya backlog lain → tetap draft", () =>
    expect(prdStatusOf(PRD, [spec(), spec({ payload: { context: "Dari PRD: docs/prd/lain.md" } })]))
      .toEqual({ status: "draft", specCount: 0, doneCount: 0 }));
  it("ada turunan, belum semuanya done → dieskalasi", () =>
    expect(prdStatusOf(PRD, [from("done"), from("executing"), from("planned")]))
      .toEqual({ status: "dieskalasi", specCount: 3, doneCount: 1 }));
  it("semua turunan done → terwujud", () =>
    expect(prdStatusOf(PRD, [from("done"), from("done")]))
      .toEqual({ status: "terwujud", specCount: 2, doneCount: 2 }));
  it("satu turunan belum done → dieskalasi, bukan terwujud", () =>
    expect(prdStatusOf(PRD, [from("brainstorming")]).status).toBe("dieskalasi"));
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

Run: `pnpm vitest --run shared/src/prd-status.test.ts`
Expected: FAIL — `Failed to resolve import "./prd-status"`.

- [ ] **Step 3: Tulis `shared/src/prd-status.ts`**

```ts
import { z } from "zod";

// SPEC-520 · status PRD adalah NILAI TURUNAN dari backlog yang lahir darinya, bukan kolom.
// PRD sendiri bukan entitas DB (ADR-0041) — tak ada tempat menyimpannya sekalipun kita mau —
// dan relasi yang sudah ada memang cukup menentukan (ADR-0018/0019: turunkan bila bisa dihitung
// ulang dari sumber lain; cermin `ticket-status.ts` SPEC-293).
//
//   draft      = belum ada satu pun backlog turunan → masih perlu ditindaklanjuti
//   dieskalasi = ada turunan, belum semuanya `done`
//   terwujud   = ada turunan dan SEMUANYA `done` → bukan pekerjaan siapa pun lagi
export const PRD_STATUSES = ["draft", "dieskalasi", "terwujud"] as const;
export const zPrdStatus = z.enum(PRD_STATUSES);
export type PrdStatus = (typeof PRD_STATUSES)[number];

// Baris `Spec` seperlunya. Sengaja BUKAN tipe Prisma: `shared` tak boleh tahu DB, dan `payload`
// memang `Json?` sehingga null / bentuk qa / bentuk lama semuanya sah dan tak boleh melempar.
export type PrdSpecTrace = { stage: string; payload: unknown; branchFrom: string | null };

const PRD_DIR = "docs/prd/";

// docs/prd/<slug>.md → prd/<slug>, branch yang dibuat sesi prd (SPEC-244). null bila bukan PRD.
export function prdBranchFor(prdPath: string): string | null {
  if (!prdPath.startsWith(PRD_DIR) || !prdPath.endsWith(".md")) return null;
  const slug = prdPath.slice(PRD_DIR.length, -3);
  return slug ? `prd/${slug}` : null;
}

// Nilai payload yang bisa memuat path PRD. Ketiga jalur eskalasi menulis salah satunya:
//   take → brief : context = "Dari PRD: <path>"                        (PrdScreen)
//   take → goal  : goal    = "Wujudkan PRD <path>"                     (ADR-0089)
//   breakdown    : context = "Dari PRD (breakdown): <path>\n\n…"       (ADR-0069, routes/specs.ts)
function payloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const p = payload as Record<string, unknown>;
  return [p.context, p.goal].filter((v): v is string => typeof v === "string").join("\n");
}

// DUA kunci.
// K1 — path PRD **utuh** muncul di payload. Utuh, bukan kata "PRD": di DB nyata SPEC-244/273/407
//      menyebut "PRD" di prosanya tanpa path apa pun, dan pencocokan berbasis kata akan
//      menempelkan ketiganya ke PRD acak. Akhiran `.md` sekaligus membuat slug berawalan sama tak
//      saling cocok (`docs/prd/auth.md` bukan substring `docs/prd/auth-device.md`).
// K2 — `branchFrom` = branch PRD-nya. Terukur nol tambahan hari ini (jalur take-single selalu
//      menulis K1 sekaligus), tetap dipasang karena backlog yang dibuat manual dari branch PRD
//      adalah turunan PRD itu juga dan hanya K2 yang melihatnya.
export function specDerivesFromPrd(spec: PrdSpecTrace, prdPath: string): boolean {
  const branch = prdBranchFor(prdPath);
  if (!branch) return false;                     // bukan PRD → tak pernah punya turunan
  if (spec.branchFrom === branch) return true;
  return payloadText(spec.payload).includes(prdPath);
}

export type PrdStatusResult = { status: PrdStatus; specCount: number; doneCount: number };

// `specs` WAJIB sudah disaring ke project PRD-nya oleh pemanggil: dua project boleh punya
// `docs/prd/<slug>.md` bernama sama, dan tanpa penyaringan itu keduanya saling mewarnai.
export function prdStatusOf(prdPath: string, specs: readonly PrdSpecTrace[]): PrdStatusResult {
  const derived = specs.filter((s) => specDerivesFromPrd(s, prdPath));
  const specCount = derived.length;
  const doneCount = derived.filter((s) => s.stage === "done").length;
  const status: PrdStatus =
    specCount === 0 ? "draft" : doneCount === specCount ? "terwujud" : "dieskalasi";
  return { status, specCount, doneCount };
}
```

- [ ] **Step 4: Ekspor dari barrel**

Di `shared/src/index.ts`, tambahkan satu baris **setelah** `export * from "./ticket-status";`:

```ts
export * from "./prd-status";
```

- [ ] **Step 5: Jalankan test — pastikan HIJAU**

Run: `pnpm vitest --run shared/src/prd-status.test.ts`
Expected: PASS — 18 test hijau, 0 gagal.

- [ ] **Step 6: Typecheck paket shared**

Run: `pnpm --filter ./shared typecheck`
Expected: keluar 0, tanpa output error.

- [ ] **Step 7: Commit**

```bash
git add shared/src/prd-status.ts shared/src/prd-status.test.ts shared/src/index.ts
git commit -m "feat(spec-520): derivasi status PRD dari jejak eskalasi backlog

Fungsi murni di shared: dua kunci (path PRD utuh di payload.context/goal,
branchFrom prd/<slug>) -> draft | dieskalasi | terwujud. Tanpa kolom baru
(ADR-0018/0019 ditegakkan).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `PrdDoc` membawa status — DTO + `project-prds.ts`

**Files:**
- Modify: `shared/src/dto.ts` (blok `zPrdDoc`, ~baris 264-273)
- Modify: `server/src/services/project-prds.ts`
- Test: `server/test/project-prds.test.ts`

**Interfaces:**
- Consumes dari Task 1: `prdStatusOf`, `zPrdStatus`, `type PrdSpecTrace`.
- Produces — dipakai Task 3:
  - `PrdDoc` bertambah `status: PrdStatus`, `specCount: number`, `doneCount: number`
  - `listPrds(projectId: string, sessions?, traces?: readonly PrdSpecTrace[]): Promise<PrdDoc[]>`
    (parameter ketiga baru, opsional)
  - `listAllPrds(sessions?): Promise<PrdDoc[]>` (tanda tangan tak berubah)

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/project-prds.test.ts` (impor `makeSpec` dari factory —
ubah baris impor teratas jadi `import { resetDb, makeProject, makeTempRepo, makeSpec } from "./factory";`):

```ts
// SPEC-520 · status PRD = nilai turunan dari backlog yang lahir darinya (ADR-0018/0019).
describe("status PRD turunan", () => {
  const fromPrd = (id: string, prd: string, stage: string) =>
    makeSpec({ id, projectId: "p1", stage,
      payload: { context: `Dari PRD: ${prd}`, outcome: "", constraints: "", priority: "sedang" } });

  it("PRD tanpa backlog turunan → draft", async () => {
    const items = await listPrds("p1", []);
    const inv = items.find((i) => i.slug === "jadwal-invoice")!;
    expect(inv.status).toBe("draft");
    expect(inv.specCount).toBe(0);
    expect(inv.doneCount).toBe(0);
  });

  it("ada turunan belum semuanya done → dieskalasi + hitungan", async () => {
    await fromPrd("SPEC-1", "docs/prd/jadwal-invoice.md", "done");
    await fromPrd("SPEC-2", "docs/prd/jadwal-invoice.md", "executing");
    const items = await listPrds("p1", []);
    const inv = items.find((i) => i.slug === "jadwal-invoice")!;
    expect(inv).toMatchObject({ status: "dieskalasi", specCount: 2, doneCount: 1 });
    // PRD tetangga di project yang sama tak ikut terwarnai
    expect(items.find((i) => i.slug === "notifikasi")!.status).toBe("draft");
  });

  it("semua turunan done → terwujud", async () => {
    await fromPrd("SPEC-3", "docs/prd/notifikasi.md", "done");
    await fromPrd("SPEC-4", "docs/prd/notifikasi.md", "done");
    const items = await listPrds("p1", []);
    expect(items.find((i) => i.slug === "notifikasi")!)
      .toMatchObject({ status: "terwujud", specCount: 2, doneCount: 2 });
  });

  it("jalur goal (ADR-0089) & breakdown (ADR-0069) ikut terhitung", async () => {
    await makeSpec({ id: "SPEC-5", projectId: "p1", stage: "done", source: "goal",
      payload: { goal: "Wujudkan PRD docs/prd/jadwal-invoice.md", done: "", constraints: "", priority: "sedang" } });
    await makeSpec({ id: "SPEC-6", projectId: "p1", stage: "done",
      payload: { context: "Dari PRD (breakdown): docs/prd/jadwal-invoice.md\n\nScope A",
        outcome: "", constraints: "", priority: "sedang" } });
    const items = await listPrds("p1", []);
    expect(items.find((i) => i.slug === "jadwal-invoice")!)
      .toMatchObject({ status: "terwujud", specCount: 2, doneCount: 2 });
  });

  it("backlog project LAIN tak mewarnai status", async () => {
    const d2 = makeTempRepo({ "docs/prd/jadwal-invoice.md": "# Jadwal Invoice (project lain)" });
    await makeProject({ id: "p2", name: "Proyek B", repoDir: d2 });
    await makeSpec({ id: "SPEC-7", projectId: "p2", stage: "done",
      payload: { context: "Dari PRD: docs/prd/jadwal-invoice.md", outcome: "", constraints: "", priority: "sedang" } });
    const p1 = await listPrds("p1", []);
    expect(p1.find((i) => i.slug === "jadwal-invoice")!.status).toBe("draft");
    const p2 = await listPrds("p2", []);
    expect(p2.find((i) => i.slug === "jadwal-invoice")!).toMatchObject({ status: "terwujud", specCount: 1 });
  });

  it("listAllPrds memberi status yang benar untuk tiap project", async () => {
    const d2 = makeTempRepo({ "docs/prd/auth.md": "# Auth Device" });
    await makeProject({ id: "p2", name: "Proyek B", repoDir: d2 });
    await fromPrd("SPEC-8", "docs/prd/jadwal-invoice.md", "planned");
    await makeSpec({ id: "SPEC-9", projectId: "p2", stage: "done",
      payload: { context: "Dari PRD: docs/prd/auth.md", outcome: "", constraints: "", priority: "sedang" } });
    const items = await listAllPrds([]);
    expect(items.find((i) => i.slug === "jadwal-invoice")!.status).toBe("dieskalasi");
    expect(items.find((i) => i.slug === "auth")!.status).toBe("terwujud");
    expect(items.find((i) => i.slug === "notifikasi")!.status).toBe("draft");
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run \
  server/test/project-prds.test.ts --no-file-parallelism
```
Expected: FAIL — `expected undefined to be "draft"` (field `status` belum ada).

- [ ] **Step 3: Tambahkan tiga field di `zPrdDoc`**

Di `shared/src/dto.ts`, ganti blok `zPrdDoc`:

```ts
export const zPrdDoc = z.object({
  slug: z.string(),
  name: z.string(),
  path: z.string(),
  title: z.string(),
  live: z.boolean(),
  projectId: z.string(),
  projectName: z.string(),
  // SPEC-520 · status TURUNAN dari backlog yang lahir dari PRD ini (ADR-0018/0019) — bukan
  // kolom, bukan prosa di dalam dokumennya. `live` di atas menjawab pertanyaan LAIN
  // (freshest-wins dari worktree sesi prd hidup) dan sengaja tetap ortogonal.
  status: zPrdStatus,
  specCount: z.number().int().nonnegative(),
  doneCount: z.number().int().nonnegative(),
});
```

Tambahkan `zPrdStatus` ke impor `shared/src/dto.ts` — sisipkan baris baru setelah
`import { zAutoMerge } from "./auto-merge";`:

```ts
import { zPrdStatus } from "./prd-status";
```

- [ ] **Step 4: Hitung status di `project-prds.ts`**

Di `server/src/services/project-prds.ts`, ganti baris impor teratas dan tambahkan pemuat trace.

Impor (ganti baris 1):
```ts
import { prdStatusOf, type PrdDoc, type PrdSpecTrace } from "@hanoman/shared";
```

Sisipkan tepat di atas `export async function listPrds` (setelah `resolveDir`):
```ts
// SPEC-520 · trace backlog untuk menghitung status PRD. Empat kolom saja dan TANPA filter di
// SQL: `payload` bertipe `Json` sehingga `string_contains` Prisma tak seragam di SQLite,
// sementara tabelnya kecil (337 baris / 294 KB payload di instalasi hidup terbesar) — menyaring
// di JS lebih jujur dan sudah cukup.
async function loadTraces(projectIds: string[]): Promise<Map<string, PrdSpecTrace[]>> {
  const map = new Map<string, PrdSpecTrace[]>(projectIds.map((id) => [id, []]));
  if (!projectIds.length) return map;
  const rows = await prisma.spec.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, stage: true, payload: true, branchFrom: true },
  });
  for (const r of rows)
    map.get(r.projectId)?.push({ stage: r.stage, payload: r.payload, branchFrom: r.branchFrom });
  return map;
}
```

Ganti seluruh badan `listPrds`:
```ts
export async function listPrds(
  projectId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
  // SPEC-520 · trace boleh disuntik pemanggil supaya daftar lintas-project tak jadi N+1.
  traces?: readonly PrdSpecTrace[],
): Promise<PrdDoc[]> {
  const { dir, live } = await resolveDir(projectId, sessions);
  if (!dir) return [];
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  const projectName = project?.name ?? projectId;
  // Dihitung SESUDAH gerbang repoDir: project tanpa repoDir tak menyumbang PRD sama sekali,
  // jadi tak perlu query trace-nya.
  const specs = traces ?? (await loadTraces([projectId])).get(projectId) ?? [];
  return (await listRepoDocs(dir))
    .filter(isPrd)
    .map((rel) => {
      const slug = slugOf(rel);
      const { status, specCount, doneCount } = prdStatusOf(rel, specs);
      return {
        slug, name: rel.slice(rel.lastIndexOf("/") + 1), path: rel,
        title: titleOf(readDocFile(dir, rel), slug), live, projectId, projectName,
        status, specCount, doneCount,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
```

Ganti badan `listAllPrds`:
```ts
export async function listAllPrds(
  sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<PrdDoc[]> {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" }, select: { id: true },
  });
  // SPEC-520 · SATU query trace untuk semua project sekaligus; tanpa ini daftar lintas-project
  // menembak `loadTraces` sekali per project.
  const traces = await loadTraces(projects.map((p) => p.id));
  const nested = await Promise.all(
    projects.map((p) => listPrds(p.id, sessions, traces.get(p.id) ?? [])));
  return nested.flat();
}
```

- [ ] **Step 5: Jalankan test — pastikan HIJAU**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run \
  server/test/project-prds.test.ts --no-file-parallelism
```
Expected: PASS — seluruh berkas hijau (7 test lama + 6 test baru).

- [ ] **Step 6: Test tetangga yang menyentuh PRD masih hijau**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run \
  server/test/project-breakdowns.test.ts server/test/prd-from-audit.route.test.ts \
  server/test/specs-batch.route.test.ts --no-file-parallelism
```
Expected: PASS, tak ada regresi.

- [ ] **Step 7: Typecheck shared + server**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`
Expected: keluar 0.

- [ ] **Step 8: Commit**

```bash
git add shared/src/dto.ts server/src/services/project-prds.ts server/test/project-prds.test.ts
git commit -m "feat(spec-520): PrdDoc membawa status/specCount/doneCount

listPrds menghitung status dari trace Spec project itu; listAllPrds menarik
trace semua project dalam satu query (bukan N+1). Field aditif, live tak
disentuh.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Daftar PRD — lencana status + filter

**Files:**
- Modify: `src/src/screens/PrdScreen.tsx`
- Test: `src/test/prd-screen.test.tsx`

**Interfaces:**
- Consumes dari Task 1 & 2: `PRD_STATUSES`, `type PrdStatus` (dari `@hanoman/shared`),
  `PrdDoc.status` / `.specCount` / `.doneCount`.
- Produces: tak ada API baru untuk task lain — ini daun.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/prd-screen.test.tsx`, lengkapi **kedua** mock daftar dengan field baru
(tanpa ini TypeScript & assertion baru tak punya data), lalu tambahkan blok test.

Ganti isi `listPrds` & `listAllPrds` di blok `vi.mock`:

```ts
    listPrds: vi.fn(async () => ({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false, projectId: "p1", projectName: "P1", status: "draft", specCount: 0, doneCount: 0 },
      { slug: "notifikasi", name: "notifikasi.md", path: "docs/prd/notifikasi.md", title: "Notifikasi Realtime", live: true, projectId: "p1", projectName: "P1", status: "dieskalasi", specCount: 3, doneCount: 1 },
      { slug: "arsip", name: "arsip.md", path: "docs/prd/arsip.md", title: "Arsip Dokumen", live: false, projectId: "p1", projectName: "P1", status: "terwujud", specCount: 2, doneCount: 2 },
    ] })),
    listAllPrds: vi.fn(async () => ({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false, projectId: "p1", projectName: "P1", status: "draft", specCount: 0, doneCount: 0 },
      { slug: "auth", name: "auth.md", path: "docs/prd/auth.md", title: "Auth Device", live: false, projectId: "p2", projectName: "Proyek B", status: "terwujud", specCount: 1, doneCount: 1 },
    ] })),
```

Tambahkan blok test baru di dalam `describe("PrdScreen", …)`:

```ts
  // SPEC-520 · status PRD terlihat di daftar, dan kata "draft" tak lagi dipakai lencana live.
  // Assertion di-scope ke <aside aria-label="Daftar PRD">: Select filter merender
  // <option>draft</option> dkk, jadi getByText polos akan cocok GANDA.
  it("lencana status muncul dengan hitungan turunannya", async () => {
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    const list = within(screen.getByLabelText("Daftar PRD"));
    expect(list.getByText("draft")).toBeTruthy();          // specCount 0 → tanpa hitungan
    expect(list.getByText("dieskalasi 1/3")).toBeTruthy();
    expect(list.getByText("terwujud 2/2")).toBeTruthy();
  });

  it("lencana sesi hidup tak lagi berbunyi 'draft hidup'", async () => {
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Notifikasi Realtime")).toBeTruthy());
    expect(screen.getByText("sesi hidup")).toBeTruthy();
    expect(screen.queryByText("draft hidup")).toBeNull();
  });

  it("filter status menyempitkan daftar", async () => {
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Status PRD"), { target: { value: "draft" } });
    await waitFor(() => expect(screen.queryByText("Notifikasi Realtime")).toBeNull());
    expect(screen.getByText("Jadwal Invoice")).toBeTruthy();
    expect(screen.queryByText("Arsip Dokumen")).toBeNull();
  });

  it("filter tanpa hasil memberi empty state yang menyebut statusnya", async () => {
    (api.listPrds as any).mockResolvedValueOnce({ items: [
      { slug: "jadwal-invoice", name: "jadwal-invoice.md", path: "docs/prd/jadwal-invoice.md", title: "Jadwal Invoice", live: false, projectId: "p1", projectName: "P1", status: "draft", specCount: 0, doneCount: 0 },
    ] });
    render(<PrdScreen projects={projects} {...base} projectFilter="p1" onProjectFilter={() => {}} onNewPrd={() => {}} onTakeToBacklog={() => {}} />);
    await waitFor(() => expect(screen.getByText("Jadwal Invoice")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Status PRD"), { target: { value: "terwujud" } });
    await waitFor(() => expect(screen.getByText(/berstatus .terwujud./i)).toBeTruthy());
    expect(screen.queryByText("Jadwal Invoice")).toBeNull();
  });
```

- [ ] **Step 2: Jalankan test — pastikan MERAH**

Run: `env -u NODE_ENV pnpm vitest --run src/test/prd-screen.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Status PRD`, dan
`getByText("dieskalasi 1/3")` tak ketemu.

- [ ] **Step 3: Impor kosakata status di `PrdScreen.tsx`**

Ganti baris impor `@hanoman/shared` (baris 11):
```ts
import { PRD_STATUSES, type BreakdownItem, type PrdStatus } from "@hanoman/shared";
```

- [ ] **Step 4: Tambahkan komponen lencana status**

Sisipkan tepat di atas `function PrdPreviewPane`:

```tsx
// SPEC-520 · lencana status turunan (draft · dieskalasi · terwujud). Yang punya backlog turunan
// membawa hitungannya supaya "dieskalasi" tak perlu diklik untuk tahu seberapa jauh.
const PRD_STATUS_TONE: Record<PrdStatus, "neutral" | "info" | "ok"> = {
  draft: "neutral", dieskalasi: "info", terwujud: "ok",
};
function PrdStatusBadge({ prd }: { prd: PrdDoc }) {
  return (
    <Badge tone={PRD_STATUS_TONE[prd.status]} size="sm">
      {prd.specCount > 0 ? `${prd.status} ${prd.doneCount}/${prd.specCount}` : prd.status}
    </Badge>
  );
}
```

- [ ] **Step 5: Pasang lencana di sidebar & header preview, ganti kata lencana live**

Di `PrdSidebarItem`, ganti baris lencana:
```tsx
        <PrdStatusBadge prd={prd} />
        {/* SPEC-520 · dulu berbunyi "draft hidup"; kata "draft" kini milik status, dan PRD yang
            hidup SEKALIGUS sudah dieskalasi akan memakai dua lencana yang saling membantah. */}
        {prd.live && <Badge tone="brass" size="sm">sesi hidup</Badge>}
```

Di header `PrdPreviewPane`, ganti blok judul:
```tsx
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 18, fontWeight: 700, color: "var(--text-strong)" }}>{prd.title}</div>
            <PrdStatusBadge prd={prd} />
          </div>
```

- [ ] **Step 6: Tambahkan state + Select filter status**

Di `PrdScreen`, tepat setelah `const [creating, setCreating] = React.useState(false);`:
```tsx
  // SPEC-520 · filter status disaring di KLIEN: daftar PRD tak berpaginasi server (pola yang
  // sama dengan filter project di sebelahnya).
  const [statusFilter, setStatusFilter] = React.useState<"all" | PrdStatus>("all");
```

Ganti effect pembuang seleksi:
```tsx
  // Ganti project / status → buang seleksi (item terpilih bisa tak ada lagi di daftar).
  // Refresh data (dataVersion) tak membuangnya agar preview stabil.
  React.useEffect(() => { setSel(null); }, [projectFilter, statusFilter]);
```

Ganti perakitan `groups`:
```tsx
  const visible = statusFilter === "all" ? items : items.filter((p) => p.status === statusFilter);
  const groups = groupByProject(visible);
```

Di baris header, sisipkan Select kedua — bungkus kedua Select dalam satu div:
```tsx
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Select size="sm" value={projectFilter} aria-label="Project"
            onChange={(e) => onProjectFilter(e.target.value)} options={selOpts} />
          <Select size="sm" value={statusFilter} aria-label="Status PRD"
            onChange={(e) => setStatusFilter(e.target.value as "all" | PrdStatus)}
            options={[{ value: "all", label: "Semua status" }]
              .concat(PRD_STATUSES.map((s) => ({ value: s, label: s })))} />
        </div>
```

- [ ] **Step 7: Empty state yang membedakan "belum ada" dari "tersaring habis"**

Ganti cabang daftar kosong di `<aside>`:
```tsx
          {items.length === 0 ? (
            <StateBlock kind="empty" icon="scroll-text" title="Belum ada PRD"
              hint="Buat PRD dari brief + brainstorm; hanoman menulisnya ke docs/prd/ lalu bisa di-take jadi backlog."
              action={() => setCreating(true)} actionLabel="PRD baru" />
          ) : visible.length === 0 ? (
            /* SPEC-520 · tersaring habis ≠ belum ada PRD — menyebut statusnya supaya operator
               tahu filter mana yang harus dilonggarkan. */
            <StateBlock kind="empty" icon="filter" compact
              title={`Tak ada PRD berstatus "${statusFilter}"`}
              hint="Longgarkan filter status untuk melihat PRD lainnya."
              action={() => setStatusFilter("all")} actionLabel="Semua status" />
          ) : groups.map((g) => (
```

- [ ] **Step 8: Jalankan test — pastikan HIJAU**

Run: `env -u NODE_ENV pnpm vitest --run src/test/prd-screen.test.tsx`
Expected: PASS — seluruh berkas hijau (test lama + 4 test baru).

- [ ] **Step 9: Typecheck paket web**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0.

- [ ] **Step 10: Commit**

```bash
git add src/src/screens/PrdScreen.tsx src/test/prd-screen.test.tsx
git commit -m "feat(spec-520): lencana status + filter status di daftar PRD

Lencana draft/dieskalasi/terwujud dengan hitungan turunan di sidebar & header
preview, Select filter status di header, dan lencana live berganti kata jadi
'sesi hidup' agar kata 'draft' hanya milik status.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Docs Source of Truth + verifikasi menyeluruh

**Files:**
- Modify: `internal/docs/architecture/data-model.md` (bagian `## PRD`)
- Modify: `internal/docs/architecture/api-contract.md` (blok `## Docs (project SoT)`)
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: seluruh perilaku dari Task 1-3. Tak menghasilkan kode.

- [ ] **Step 1: Perbarui `data-model.md`**

Di `internal/docs/architecture/data-model.md`, tepat **sebelum** paragraf
`**Breakdown PRD (SPEC-273 …**`, sisipkan:

```markdown
**Status PRD (SPEC-520)** — **nilai turunan, bukan kolom** (ADR-0018/0019; PRD memang bukan
entitas DB sehingga tak ada tempat menyimpannya). `PrdDoc` membawa `status` (`draft` ·
`dieskalasi` · `terwujud`) + `specCount`/`doneCount`, dihitung `prdStatusOf()`
(`shared/src/prd-status.ts`, murni) atas baris `Spec` project itu: nol turunan → `draft`;
ada turunan tapi belum semuanya `done` → `dieskalasi`; semuanya `done` → `terwujud`.
Kandidat **wajib** disaring `projectId` lebih dulu — dua project boleh punya
`docs/prd/<slug>.md` bernama sama. Dua kunci jejak: **K1** path PRD **utuh** muncul di
`payload.context` (`Dari PRD: <path>` / `Dari PRD (breakdown): <path>`) atau `payload.goal`
(`Wujudkan PRD <path>`) — menanggung 25 dari 25 baris berjejak di instalasi hidup; **K2**
`branchFrom === "prd/<slug>"` (SPEC-244) — nol tambahan hari ini, dipasang untuk backlog yang
dibuat manual dari branch PRD. **Gotcha:** cocokkan **path utuh, bukan kata "PRD"** — SPEC-244,
SPEC-273, dan SPEC-407 memuat kata itu di prosanya tanpa path apa pun, dan akhiran `.md`
sekaligus yang membuat slug berawalan sama tak saling cocok (`docs/prd/auth.md` bukan substring
`docs/prd/auth-device.md`). Baris prosa `> Status: Draft …` di dalam dokumen PRD **bukan**
sumbernya: ia ditulis agen sekali saat PRD lahir dan tak punya penulis kedua. Field `live`
(freshest-wins worktree sesi `prd`) menjawab pertanyaan lain dan tetap ortogonal — lencananya
karena itu berbunyi **`sesi hidup`**, bukan lagi `draft hidup`.
```

- [ ] **Step 2: Perbarui `api-contract.md`**

Di blok `## Docs (project SoT)`, ganti dua baris PRD:

```
GET    /prds                            # SPEC-210 · { items:[PrdDoc] } daftar PRD LINTAS-project (filter "Semua project")
GET    /projects/:id/prds               # SPEC-210 · { items:[PrdDoc] } dokumen docs/prd/*.md project itu
#   SPEC-520 · PrdDoc membawa status TURUNAN dari backlog yang lahir dari PRD itu (ADR-0018/0019):
#   status: "draft" (nol turunan) | "dieskalasi" (ada, belum semua done) | "terwujud" (semua done),
#   + specCount/doneCount. Bukan kolom — dihitung prdStatusOf() atas Spec project yang sama.
```

- [ ] **Step 3: Perbarui `internal/skills/hanoman/SKILL.md`**

Tambahkan butir baru di bagian **Aturan Arsitektur**, tepat setelah butir SPEC-489
("Panduan AI agent punya URL"):

```markdown
- **Status PRD adalah nilai turunan, bukan kolom** (SPEC-520, tanpa ADR — ADR-0018/0019 &
  ADR-0041 & ADR-0069 **ditegakkan**): `PrdDoc.status` = `draft` (nol backlog turunan) ·
  `dieskalasi` (ada, belum semua `done`) · `terwujud` (semua `done`), + `specCount`/`doneCount`,
  dihitung `prdStatusOf()` (`shared/src/prd-status.ts`, murni) atas baris `Spec` **project yang
  sama**. Dua kunci jejak yang sudah ada: path PRD **utuh** di `payload.context`/`payload.goal`
  (25/25 baris berjejak di instalasi hidup) dan `branchFrom === "prd/<slug>"` (nol tambahan hari
  ini, dipasang untuk backlog manual dari branch PRD). **Tiga gotcha:** (1) cocokkan **path utuh,
  bukan kata "PRD"** — SPEC-244/273/407 menyebut kata itu tanpa path, dan akhiran `.md` yang
  membuat slug berawalan sama tak saling cocok; (2) `listAllPrds` menarik trace **semua** project
  dalam SATU query — memanggil `listPrds` polos per project mengubahnya jadi N+1; (3) baris prosa
  `> Status: Draft …` di dalam dokumen PRD bukan sumbernya (ditulis agen sekali, tak punya
  penulis kedua) dan lencana `live` karena itu berganti kata jadi **`sesi hidup`**.
```

- [ ] **Step 4: Jalankan seluruh test yang tersentuh perubahan ini**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV pnpm vitest --run \
  --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: PASS. **Pastikan test-nya memang berjalan** — `--changed` menyalakan
`passWithNoTests`, jadi "no test files" bukan bukti. Minimal `shared/src/prd-status.test.ts`,
`server/test/project-prds.test.ts`, dan `src/test/prd-screen.test.tsx` harus terlihat di daftar.

- [ ] **Step 5: Typecheck ketiga paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck`
Expected: keluar 0 untuk ketiganya. (Bukan `pnpm -r typecheck` — ADR-0080.)

- [ ] **Step 6: Smoke endpoint nyata (task ini menyentuh `GET /prds`)**

Boot server dengan DB khusus supaya run tetangga tak menghapusnya di tengah jalan, lalu curl:

```bash
pnpm --filter ./server build
HANOMAN_HOME="$(mktemp -d)" PORT=8799 node server/dist/server.js &
# tunggu sampai /api/health menjawab, lalu:
curl -s localhost:8799/api/prds | head -c 400
```
Expected: `{"items":[...]}` — tiap item memuat `status`, `specCount`, `doneCount`.
Instance kosong sah menjawab `{"items":[]}`; bila begitu, buat satu project ber-`repoDir`
menunjuk checkout ini lalu ulangi agar kelima PRD `docs/prd/*.md` terlihat beserta statusnya.
Matikan server **per-PID** (`kill <pid>` dari `lsof -ti:8799`) — jangan `pkill -f node`
(SPEC-402).

- [ ] **Step 7: Commit**

```bash
git add internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md \
  internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-520): status PRD turunan di data-model, api-contract, SKILL

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Centang plan & push**

Centang seluruh kotak plan ini, commit, lalu:
```bash
git push origin HEAD:refs/heads/hanoman/spec-520
```

---

## Catatan untuk pelaksana

- **Tak ada dokumen baru** di `internal/docs/**`, jadi `internal/docs/README.md` tidak bertambah
  baris — kedua berkas yang disentuh sudah ter-link di sana.
- **Tak ada migration, tak ada `prisma generate`.** Bila `prisma.spec` terasa undefined,
  itu worktree yang belum di-`pnpm install` + `prisma generate`, bukan akibat SPEC ini.
- Bila test server gagal ramai dengan **404/P2022**, itu hampir selalu DB test dipakai bersama
  (SPEC-479) — ulangi dengan `TEST_DATABASE_URL` sendiri sebelum mencurigai regresi.
