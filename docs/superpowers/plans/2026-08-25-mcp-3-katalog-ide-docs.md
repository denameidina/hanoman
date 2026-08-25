# MCP Rencana 3 — Katalog domain `ide` & `docs`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 39 tool baru — 27 di domain `ide`, 12 di domain `docs` — sehingga agen di klien MCP mana pun bisa membaca dan menyunting kode serta dokumen project tanpa checkout repo.

**Architecture:** Dua berkas katalog baru di `shared/src/mcp-catalog/`, dirangkai di `index.ts`. Tak ada endpoint server baru dan tak ada perubahan `capabilityForRoute` — Rencana 1 sudah memetakan semuanya. Gerbang mode ⇔ capability dari Rencana 2 menegakkan bahwa lima tool git dan tiga tool hapus bermode `danger`.

**Tech Stack:** TypeScript strict, JSON Schema polos (bukan zod — lihat `shared/src/mcp-schema.ts:1-10`), vitest.

## Global Constraints

- Rencana 1 & 2 **wajib selesai**.
- **Skema parameter diturunkan dari handler, bukan dari ingatan.** Setiap tabel tool di rencana ini menyebut `berkas:baris` handler-nya. Buka handler itu, baca query/body yang benar-benar dibaca, baru tulis `inputSchema`. Menebak nama parameter menghasilkan tool yang selalu 400 — dan 400 itulah yang seharusnya dicegah katalog (ADR-0099 gotcha #2).
- Deskripsi parameter **wajib menyebut jebakan yang sudah diketahui** langsung di tempat, bukan menunjuk dokumen lain (batasan SPEC-482).
- Balasan yang bisa besar (isi berkas, diff, graph) mengandalkan `renderResult` memangkas — jangan menambah pemotongan sendiri, dan jangan mengembalikan buffer biner.
- `MCP_TOOL_SCHEMA_VERSION` tetap 1: menambah tool bersifat aditif.

---

## File Structure

- Create: `shared/src/mcp-catalog/ide.ts` — `IDE_TOOLS` (27)
- Create: `shared/src/mcp-catalog/docs.ts` — `DOCS_TOOLS` (12)
- Modify: `shared/src/mcp-catalog/index.ts` — rangkai keduanya
- Modify: `shared/src/mcp-shape.ts` — shaper baru bila balasan mentah terlalu gemuk
- Modify: `shared/src/mcp-catalog.test.ts` — isi `DESTRUCTIVE_BUT_WRITE`
- Test: `shared/src/mcp-catalog.ide.test.ts`, `shared/src/mcp-catalog.docs.test.ts`

---

### Task 1: `docs.ts` — 12 tool

**Files:**
- Create: `shared/src/mcp-catalog/docs.ts`
- Modify: `shared/src/mcp-catalog/index.ts`
- Test: `shared/src/mcp-catalog.docs.test.ts`

**Interfaces:**
- Consumes: `McpToolDef` & `McpMode` dari `./types`; `enc`, `query`, `s`, `n`, `localPage` dari `./helpers`; `obj`, `str`, `int`, `bool` dari `../mcp-schema`.
- Produces: `export const DOCS_TOOLS: readonly McpToolDef[]`.

**Peta tool → route.** Semua `capability` di kolom terakhir sudah berlaku sejak Rencana 1; jangan mengubah `capabilityForRoute`.

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_docs_list` | GET `/projects/:id/docs` | `docs.ts:9` | read | `docs:read` |
| `hanoman_docs_read` | GET `/projects/:id/docs/*` | `docs.ts:37` | read | `docs:read` |
| `hanoman_docs_write` | PUT `/projects/:id/docs/*` | `docs.ts:48` | write | `docs:write` |
| `hanoman_docs_delete` | DELETE `/projects/:id/docs/*` | `docs.ts:61` | **danger** | `docs:write` |
| `hanoman_prds_list` | GET `/prds` **atau** `/projects/:id/prds` | `docs.ts:12`, `:15` | read | `docs:read` |
| `hanoman_prd_read` | GET `/projects/:id/prds/*` | `docs.ts:18` | read | `docs:read` |
| `hanoman_breakdown_get` | GET `/projects/:id/breakdown` | `docs.ts:31` | read | `docs:read` |
| `hanoman_changelog_sources` | GET `/projects/:id/changelog/sources` | `changelog.ts:27` | read | `docs:read` |
| `hanoman_changelog_list` | GET `/projects/:id/changelog` | `changelog.ts:47` | read | `docs:read` |
| `hanoman_changelog_get` | GET `/projects/:id/changelog/:cid` | `changelog.ts:57` | read | `docs:read` |
| `hanoman_changelog_create` | POST `/projects/:id/changelog` | `changelog.ts:70` | write | `docs:write` |
| `hanoman_changelog_delete` | DELETE `/projects/:id/changelog/:cid` | `changelog.ts:80` | **danger** | `docs:write` |

`hanoman_docs_delete` dan `hanoman_changelog_delete` bermode `danger` **tanpa** capability `danger` — keduanya masuk `DESTRUCTIVE_BUT_WRITE` di Task 3.

- [ ] **Step 1: Baca handler, turunkan parameter**

```bash
sed -n '1,90p' server/src/routes/docs.ts
sed -n '20,95p' server/src/routes/changelog.ts
```

Catat untuk tiap route: nama query string yang dibaca, bentuk body yang divalidasi, dan bentuk balasan. **Jangan lanjut sebelum ini dilakukan** — sisa task ini menuliskan apa yang kamu baca.

- [ ] **Step 2: Tulis test yang gagal**

`shared/src/mcp-catalog.docs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DOCS_TOOLS } from "./mcp-catalog/docs";

const by = (n: string) => DOCS_TOOLS.find((t) => t.name === n)!;

describe("katalog docs", () => {
  it("12 tool, dua bermode danger", () => {
    expect(DOCS_TOOLS).toHaveLength(12);
    expect(DOCS_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name).sort())
      .toEqual(["hanoman_changelog_delete", "hanoman_docs_delete"]);
  });

  it("path dokumen di-encode PER SEGMEN — `a/b.md` tetap dua segmen, bukan %2F", () => {
    expect(by("hanoman_docs_read").build({ project: "p", path: "docs/a b.md" })?.path)
      .toBe("/projects/p/docs/docs/a%20b.md");
  });

  it("prds_list bekerja dengan dan tanpa project", () => {
    expect(by("hanoman_prds_list").build({})?.path).toBe("/prds");
    expect(by("hanoman_prds_list").build({ project: "p" })?.path).toBe("/projects/p/prds");
  });

  it("docs_write menuntut isi — menulis berkas kosong tak pernah disengaja", () => {
    expect(by("hanoman_docs_write").inputSchema.required).toContain("content");
  });

  it("setiap tool menyebut capability yang benar", () => {
    for (const t of DOCS_TOOLS)
      expect(t.capability, t.name).toBe(t.sampleMethod === "GET" ? "docs:read" : "docs:write");
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/mcp-catalog.docs.test.ts`
Expected: FAIL — modul `./mcp-catalog/docs` belum ada.

- [ ] **Step 4: Tulis `docs.ts`**

Kepala berkas:

```ts
// ADR-0099 · ADR-0155 · katalog tool domain `docs`: dokumen SoT project, PRD, dan changelog.
// Tiga permukaan yang di REST hidup di dua berkas route (docs.ts, changelog.ts) tapi satu domain
// capability — `capabilityForRoute` memetakan `projects/:id/{docs,prds,changelog}` ke `docs:*`
// (agent-capabilities.ts), justru supaya membaca changelog tak menuntut hak menyunting project.
import { bool, int, obj, str } from "../mcp-schema";
import { enc, localPage, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

/** Path dokumen di-encode PER SEGMEN. `encodeURIComponent` atas seluruh path akan mengubah `/`
 *  menjadi `%2F` dan route wildcard Fastify tak lagi cocok — jebakan yang sama sudah ada di
 *  `hanoman_backlog_doc_read` (mcp-catalog/backlog.ts). */
const encPath = (p: string) => p.split("/").map(enc).join("/");

export const DOCS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_docs_read",
    title: "Baca dokumen project",
    description:
      "Isi satu berkas .md di direktori dokumen project. Pakai hanoman_docs_list lebih dulu untuk mendapat jalur yang sah — jalur ditolak bila keluar dari direktori dokumen. Balasan panjang dipotong di batas ukuran dan ditandai `truncated`.",
    inputSchema: obj({
      properties: {
        project: str("Id project, mis. `hanoman`. Dapatkan dari hanoman_projects_list."),
        path: str("Jalur relatif dokumen, mis. `architecture/stack.md`. Salin apa adanya dari hanoman_docs_list — jangan menambah prefix `docs/` sendiri."),
      },
      required: ["project", "path"],
    }),
    mode: "read",
    capability: "docs:read",
    samplePath: "/projects/hanoman/docs/a.md",
    sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/docs/${encPath(String(a.path))}` }),
    shape: (raw) => raw,
  },
  // … sebelas entri lain, bentuknya identik; isi `inputSchema` dari apa yang dibaca di Step 1.
];
```

Sebelas entri sisanya mengikuti bentuk yang sama persis. Yang wajib berbeda per entri: `name`, `title`, `description`, `inputSchema`, `mode`, `capability`, `samplePath`, `sampleMethod`, `build`, dan `shape`. Untuk tool daftar (`docs_list`, `prds_list`, `changelog_list`), pakai `localPage(raw, a, (r) => r)` bila server tak memberi amplop paginasi, atau `reshapePage` bila memberi — Step 1 sudah memberitahu yang mana.

Untuk dua tool `danger`, deskripsi **wajib** dibuka dengan penandaan:

```ts
    description:
      "BERBAHAYA — menghapus berkas dokumen secara permanen dari working tree project. Tak ada undo lewat hanoman; pemulihannya lewat git. Hanya muncul saat manusia menyalakan tingkat `--danger` di klien MCP ini.",
```

- [ ] **Step 5: Rangkai di `index.ts`**

```ts
import { DOCS_TOOLS } from "./docs";
// … di dalam MCP_TOOLS, sesudah BACKLOG_TOOLS:
  ...DOCS_TOOLS,
```

- [ ] **Step 6: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/mcp-catalog.docs.test.ts shared/src/mcp-catalog.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts
```
Expected: PASS. Assert "setiap samplePath katalog memang menuntut capability yang diakui tool-nya" di `mcp-coverage.test.ts` adalah gerbang sesungguhnya di sini — ia membuktikan dua belas tool ini memang menuntut apa yang mereka klaim.

- [ ] **Step 7: Commit**

```bash
git add shared/src/mcp-catalog/docs.ts shared/src/mcp-catalog/index.ts shared/src/mcp-catalog.docs.test.ts
git commit -m "feat(mcp): 12 tool domain docs (dokumen, PRD, changelog)"
```

---

### Task 2: `ide.ts` — 27 tool

**Files:**
- Create: `shared/src/mcp-catalog/ide.ts`
- Modify: `shared/src/mcp-catalog/index.ts`
- Test: `shared/src/mcp-catalog.ide.test.ts`

**Interfaces:**
- Consumes: sama dengan Task 1.
- Produces: `export const IDE_TOOLS: readonly McpToolDef[]`.

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_ide_tree` | GET `/projects/:id/tree` | `ide.ts:82` | read | `ide:read` |
| `hanoman_ide_file_read` | GET `/projects/:id/file` | `ide.ts:89` | read | `ide:read` |
| `hanoman_ide_working_status` | GET `/projects/:id/working-status` | `ide.ts:112` | read | `ide:read` |
| `hanoman_ide_file_diff` | GET `/projects/:id/file-diff` | `ide.ts:119` | read | `ide:read` |
| `hanoman_ide_file_write` | PUT `/projects/:id/file` | `ide.ts:136` | write | `ide:write` |
| `hanoman_ide_entry_create` | POST `/projects/:id/entry` | `ide.ts:148` | write | `ide:write` |
| `hanoman_ide_entry_rename` | PATCH `/projects/:id/entry` | `ide.ts:159` | write | `ide:write` |
| `hanoman_ide_entry_delete` | DELETE `/projects/:id/entry` | `ide.ts:170` | **danger** | `ide:write` |
| `hanoman_ide_graph` | GET `/projects/:id/graph` (+`/graph/search` bila `q` diisi) | `ide.ts:240`, `:254` | read | `ide:read` |
| `hanoman_ide_git_status` | GET `/projects/:id/status` | `ide.ts:263` | read | `ide:read` |
| `hanoman_ide_stashes` | GET `/projects/:id/stashes` | `ide.ts:270` | read | `ide:read` |
| `hanoman_ide_remotes_list` | GET `/projects/:id/remotes` | `ide.ts:277` | read | `ide:read` |
| `hanoman_ide_remote_add` | POST `/projects/:id/remotes` | `ide.ts:282` | write | `ide:write` |
| `hanoman_ide_remote_update` | PATCH `/projects/:id/remotes/:name` | `ide.ts:291` | write | `ide:write` |
| `hanoman_ide_remote_delete` | DELETE `/projects/:id/remotes/:name` | `ide.ts:301` | write | `ide:write` |
| `hanoman_ide_pr_url` | GET `/projects/:id/pr-url` | `ide.ts:311` | read | `ide:read` |
| `hanoman_ide_commit` | GET `/projects/:id/commit/:sha` (+`/file` bila `path` diisi) | `ide.ts:335`, `:371` | read | `ide:read` |
| `hanoman_ide_compare` | GET `/projects/:id/compare` (+`/file` bila `path` diisi) | `ide.ts:344`, `:352` | read | `ide:read` |
| `hanoman_ide_branches_unused` | GET `/projects/:id/branches/unused` | `ide.ts:463` | read | **`projects:read`** ⚠ |
| `hanoman_ide_worktrees_list` | GET `/projects/:id/worktrees` (+`stats` bila `stats: true`) | `ide.ts:500`, `:510` | read | `ide:read` |
| `hanoman_ide_git_run` | POST `/projects/:id/git` | `ide.ts:390` | **danger** | `ide:git` |
| `hanoman_ide_git_merge` | POST `/projects/:id/git/merge` | `ide.ts:411` | **danger** | `ide:git` |
| `hanoman_ide_git_rebase` | POST `/projects/:id/git/rebase` | `ide.ts:426` | **danger** | `ide:git` |
| `hanoman_ide_git_pull` | POST `/projects/:id/git/pull` | `ide.ts:437` | **danger** | `ide:git` |
| `hanoman_ide_git_drop` | POST `/projects/:id/git/drop` | `ide.ts:449` | **danger** | `ide:git` |
| `hanoman_ide_branch_delete` | POST `/projects/:id/branches/delete` | `ide.ts:477` | **danger** | `ide:git` |
| `hanoman_ide_worktree_delete` | POST `/projects/:id/worktrees/delete` | `ide.ts:526` | **danger** | `ide:git` |

⚠ **`hanoman_ide_branches_unused` menuntut `projects:read`, bukan `ide:read`** — diverifikasi
terhadap kode saat Rencana 1 dieksekusi. `branches` sengaja bukan anggota `IDE_SUBS` (SPEC-360),
jadi seluruh `branches/*` yang membaca tetap permukaan `projects`; hanya `branches/delete` yang
pindah ke `ide:git` (ADR-0155). Asimetri ini disengaja, dan uji kontrak `mcp-coverage.test.ts`
akan menolak katalog yang mengklaim sebaliknya. Namanya tetap berprefix `ide_` karena UI-nya
memang hidup di layar IDE — nama tool tak wajib mencerminkan domain capability.

Tujuh tool bercapability `ide:git` **wajib** bermode `danger` — gerbang Rencana 2 Task 4 menolak kalau tidak. `hanoman_ide_entry_delete` bermode `danger` dengan capability `ide:write`, jadi ia masuk `DESTRUCTIVE_BUT_WRITE`.

**Tidak dibungkus:** `POST /projects/:id/upload` (`ide.ts:183`) dan `GET /projects/:id/archive` (`ide.ts:321`) — sudah terdaftar di `UNWRAPPED` pada `server/test/mcp-coverage.test.ts`.

- [ ] **Step 1: Baca handler, turunkan parameter**

```bash
sed -n '82,200p'  server/src/routes/ide.ts
sed -n '240,360p' server/src/routes/ide.ts
sed -n '371,540p' server/src/routes/ide.ts
```

Perhatikan khusus: nama query pada `/file`, `/file-diff`, `/compare`, `/graph/search`; bentuk body pada `/entry`, `/git/*`, `/branches/delete`, `/worktrees/delete`. Beberapa handler menuntut konfirmasi eksplisit di body — kalau ada, jadikan ia parameter **wajib** bertipe boolean dengan deskripsi yang menyebut akibatnya, jangan diisi otomatis oleh `build`.

- [ ] **Step 2: Tulis test yang gagal**

`shared/src/mcp-catalog.ide.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IDE_TOOLS } from "./mcp-catalog/ide";

const by = (n: string) => IDE_TOOLS.find((t) => t.name === n)!;

describe("katalog ide", () => {
  it("27 tool", () => expect(IDE_TOOLS).toHaveLength(27));

  it("tujuh tool git menuntut ide:git dan bermode danger", () => {
    const git = IDE_TOOLS.filter((t) => t.capability === "ide:git");
    expect(git.map((t) => t.name).sort()).toEqual([
      "hanoman_ide_branch_delete", "hanoman_ide_git_drop", "hanoman_ide_git_merge",
      "hanoman_ide_git_pull", "hanoman_ide_git_rebase", "hanoman_ide_git_run",
      "hanoman_ide_worktree_delete",
    ]);
    for (const t of git) expect(t.mode, t.name).toBe("danger");
  });

  it("membaca daftar worktree TIDAK menuntut ide:git", () => {
    expect(by("hanoman_ide_worktrees_list").capability).toBe("ide:read");
  });

  // Diverifikasi terhadap kode saat Rencana 1 dieksekusi: `branches` BUKAN anggota `IDE_SUBS`
  // (SPEC-360 sengaja menjauhkannya), jadi seluruh `branches/*` yang MEMBACA dipetakan ke
  // `projects:*`. Menuliskannya `ide:read` di katalog akan membuat uji kontrak merah.
  it("membaca daftar branch adalah permukaan project, bukan ide", () => {
    expect(by("hanoman_ide_branches_unused").capability).toBe("projects:read");
    expect(by("hanoman_ide_branch_delete").capability).toBe("ide:git");
  });

  it("graph memilih /graph/search hanya saat q diisi", () => {
    expect(by("hanoman_ide_graph").build({ project: "p" })?.path).toBe("/projects/p/graph");
    expect(by("hanoman_ide_graph").build({ project: "p", q: "fix" })?.path).toBe("/projects/p/graph/search");
  });

  it("commit memilih /file hanya saat path diisi", () => {
    expect(by("hanoman_ide_commit").build({ project: "p", sha: "abc" })?.path).toBe("/projects/p/commit/abc");
    expect(by("hanoman_ide_commit").build({ project: "p", sha: "abc", path: "a.ts" })?.path)
      .toBe("/projects/p/commit/abc/file");
  });

  it("setiap tool danger membuka deskripsinya dengan penandaan", () => {
    for (const t of IDE_TOOLS.filter((x) => x.mode === "danger"))
      expect(t.description.slice(0, 12), t.name).toMatch(/BERBAHAYA/);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/mcp-catalog.ide.test.ts`
Expected: FAIL — modul belum ada.

- [ ] **Step 4: Tulis `ide.ts`**

Kepala berkas:

```ts
// ADR-0099 · ADR-0155 · katalog tool domain `ide`: tree, isi berkas, status git, graph, dan operasi
// git. DUA capability, bukan satu: membaca & menulis berkas working tree = `ide:read|write`;
// merge/rebase/pull/drop dan penghapusan branch/worktree = `ide:git` (ADR-0155), karena keduanya
// mengubah sejarah atau menghapus pekerjaan yang tak dipegang berkas mana pun.
```

Contoh entri berparameter kondisional — pola yang dipakai `graph`, `commit`, `compare`, `worktrees_list`:

```ts
  {
    name: "hanoman_ide_graph",
    title: "Graf commit project",
    description:
      "Graf commit project, berhalaman. Isi `q` untuk mencari commit menurut pesan/penulis — pencarian memakai endpoint terpisah dan mengabaikan kursor halaman. Balasan panjang dipotong di batas ukuran.",
    inputSchema: obj({
      properties: {
        project: str("Id project, mis. `hanoman`."),
        q: str("Kata kunci pencarian commit. Kosongkan untuk mengambil graf berurutan alih-alih hasil pencarian."),
        page: int("Halaman, mulai 1.", { minimum: 1 }),
        limit: int("Item per halaman.", { minimum: 1, maximum: 200 }),
      },
      required: ["project"],
    }),
    mode: "read",
    capability: "ide:read",
    samplePath: "/projects/hanoman/graph",
    sampleMethod: "GET",
    build: (a) => {
      const q = s(a.q);
      return {
        method: "GET",
        path: `/projects/${enc(String(a.project))}/graph${q ? "/search" : ""}`,
        query: query({ q, page: n(a.page)?.toString(), limit: n(a.limit)?.toString() }),
      };
    },
    shape: (raw, a) => localPage(raw, a, (r) => r),
  },
```

Contoh entri `danger` — pola yang dipakai ketujuh tool `ide:git`:

```ts
  {
    name: "hanoman_ide_git_merge",
    title: "Merge branch (BERBAHAYA)",
    description:
      "BERBAHAYA — menjalankan git merge di working tree project. Bisa menghasilkan konflik yang meninggalkan working tree setengah jadi, dan hanoman tidak menyelesaikan konflik untukmu. Menuntut capability `ide:git` pada agent token; `ide:write` tidak cukup. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        project: str("Id project, mis. `hanoman`."),
        /* … field lain diturunkan dari body yang dibaca ide.ts:411 … */
      },
      required: ["project" /* … */],
    }),
    mode: "danger",
    capability: "ide:git",
    samplePath: "/projects/hanoman/git/merge",
    sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/projects/${enc(String(a.project))}/git/merge`, body: { /* … */ } }),
    shape: (raw) => raw,
  },
```

- [ ] **Step 5: Rangkai di `index.ts`**

```ts
import { IDE_TOOLS } from "./ide";
// … di dalam MCP_TOOLS, sesudah DOCS_TOOLS:
  ...IDE_TOOLS,
```

- [ ] **Step 6: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/mcp-catalog.ide.test.ts shared/src/mcp-catalog.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src/mcp-catalog/ide.ts shared/src/mcp-catalog/index.ts shared/src/mcp-catalog.ide.test.ts
git commit -m "feat(mcp): 27 tool domain ide, tujuh di antaranya menuntut ide:git"
```

---

### Task 3: Isi daftar-kecuali & buktikan tingkat mode bekerja

**Files:**
- Modify: `shared/src/mcp-catalog.test.ts` (`DESTRUCTIVE_BUT_WRITE`)

- [ ] **Step 1: Tambahkan tiga nama ke daftar**

```ts
const DESTRUCTIVE_BUT_WRITE = new Set([
  "hanoman_docs_delete",        // menghapus berkas .md; capability tetap docs:write
  "hanoman_changelog_delete",   // menghapus entri changelog; capability tetap docs:write
  "hanoman_ide_entry_delete",   // menghapus berkas/folder working tree; capability tetap ide:write
]);
```

Buang komentar "Diisi bertahap oleh Rencana 3–6 … Kosong sekarang BUKAN kelalaian" — ia sudah tak benar.

- [ ] **Step 2: Tambahkan test tingkat mode dengan angka nyata**

```ts
it("tingkat default menyembunyikan sepuluh tool berbahaya dari ide & docs", () => {
  const hidden = MCP_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name);
  expect(hidden).toEqual(expect.arrayContaining([
    "hanoman_docs_delete", "hanoman_changelog_delete", "hanoman_ide_entry_delete",
    "hanoman_ide_git_run", "hanoman_ide_git_merge", "hanoman_ide_git_rebase",
    "hanoman_ide_git_pull", "hanoman_ide_git_drop", "hanoman_ide_branch_delete",
    "hanoman_ide_worktree_delete",
  ]));
  for (const n of hidden) expect(mcpToolsFor("default").map((t) => t.name)).not.toContain(n);
});
```

- [ ] **Step 3: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/src/mcp-catalog.test.ts`
Expected: PASS.

- [ ] **Step 4: Uji ujung-ke-ujung terhadap server hidup**

```bash
pnpm dev   # terminal lain
pnpm -F hanoman build
# token ber-`ide:read` SAJA:
HANOMAN_HOST=http://localhost:8787 HANOMAN_AGENT_TOKEN=hnm_agt_… \
  node cli/dist/hanoman.js mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -c hanoman_ide
```
Expected: 20 (27 dikurangi 7 tool `ide:git` yang bermode danger). Lalu dengan `--danger`: 27.

Panggil satu tool berbahaya dengan token yang tak punya `ide:git`:
```bash
HANOMAN_MCP_DANGER=1 HANOMAN_HOST=… HANOMAN_AGENT_TOKEN=… node cli/dist/hanoman.js mcp <<< \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"hanoman_ide_git_merge","arguments":{"project":"hanoman"}}}'
```
Expected: `isError: true`, pesannya menyebut `ide:git`. **Ini bukti bahwa tingkat mode bukan gerbangnya — capability-lah gerbangnya.**

- [ ] **Step 5: Commit**

```bash
git add shared/src/mcp-catalog.test.ts docs/superpowers/plans/2026-08-25-mcp-3-katalog-ide-docs.md
git commit -m "test(mcp): daftar destruktif ide & docs + bukti gerbang capability"
```
