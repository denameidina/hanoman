# SPEC-519 — Changelog terekspos dan mudah dijangkau · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changelog per project punya entri sidebar sendiri, halaman yang bisa dibuka langsung lewat
tautan, dan daftar rilis yang bisa digulir serta dicari — tanpa menyentuh mesin changelog SPEC-516.

**Architecture:** Satu entri `HN_NAV` baru + satu cabang `section === "changelog"` di `App.tsx`
(pasangan yang wajib lahir bersama — lihat Global Constraints). Layar barunya merakit komponen yang
sudah ada: `ChangelogPanel` (generator, dipangkas jadi generator murni) + daftar rilis bergulir yang
menyaring lewat **satu parameter query aditif** `?q=` pada endpoint yang sudah ada. Deep-link memakai
pola hash ADR-0071 yang sama dengan `#spec=`. Nol route baru, nol migration, nol sentuhan git.

**Tech Stack:** React 18 + TypeScript (Vite) · Fastify + Prisma 6/SQLite · Zod di `@hanoman/shared` ·
Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-08-04-spec-519-changelog-terekspos-design.md`](../specs/2026-08-04-spec-519-changelog-terekspos-design.md)

## Global Constraints

- **Jangan sentuh mesin changelog.** `server/src/services/changelog/{collect,generate,render,scrub}.ts`
  dan seluruh logika git tag (`listTags`) **tak boleh berubah satu baris pun** (batasan brief:
  "Reuse endpoint changelog yang sudah ada; jangan duplikasi logika git tag").
- **Tanpa route baru, tanpa model baru, tanpa migration, tanpa ADR baru.** Satu-satunya perubahan
  server adalah parameter query `q` pada `GET /projects/:id/changelog` yang sudah ada.
- **Setiap key di `HN_NAV` WAJIB punya cabang `section === "<key>"` di `App.tsx`** (`src/src/ds/shell.tsx:12`).
  Tanpa itu `screen` tetap `null` dan App merender kosong — sidebar ikut hilang dan pengguna terjebak
  sampai reload (`runs`/`triggers` pernah begitu, SPEC-162).
- **Design system:** `Input`/`Select` **tidak punya prop `label`** — nama aksesibilitas lewat
  `aria-label`, label terlihat lewat `Field`. `Select` menerima prop `options`, **bukan** anak
  `<option>` (anak JSX diabaikan senyap). Warna & jarak lewat token CSS (`var(--text-muted)`,
  `var(--border-hair)`, …), jangan hardcode hex.
- **Daftar bergulir memakai tinggi berbatas** (`maxHeight` + `overflowY: "auto"`), **bukan**
  `LIST_SCROLL_STYLE`: `Card` menyisipkan pembungkus `display:block` di sekitar `children` kecuali
  prop `fill` dipasang, dan rantai flex yang menembusnya putus (audit SPEC-393). Pane berbatas
  sendiri tak bergantung pada rantai itu.
- **Perintah test (jangan diubah):**
  - web: `env -u NODE_ENV pnpm --filter ./src exec vitest run <path>` — `NODE_ENV=production` di env
    shell membuat RTL `act` gagal massal (SPEC-293).
  - shared: `pnpm --filter ./shared exec vitest run <path>`
  - server: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server exec vitest run <path> --no-file-parallelism`
    — berkas DB test diturunkan dari `HANOMAN_HOME` dan dihapus tiap run, jadi sesi tetangga
    menghapusnya di tengah run kita (SPEC-479).
- **Typecheck hanya paket yang tersentuh** (`pnpm --filter ./src typecheck`), jangan `pnpm -r typecheck`.
- Komentar kode dalam bahasa Indonesia, mengikuti gaya berkas sekitarnya (sebutkan nomor SPEC saat
  menjelaskan alasan yang tak terbaca dari kode).

## File Structure

| Berkas | Tanggung jawab | Aksi |
|---|---|---|
| `shared/src/changelog.ts` | + `changelogMatches()` — predikat cari murni | Modify |
| `shared/src/changelog.test.ts` | test predikat cari | Modify |
| `server/src/routes/changelog.ts` | terima `?q=`, saring sebelum `paginate` | Modify (1 route) |
| `server/test/changelog.route.test.ts` | test `?q=` | Modify |
| `src/src/api/client.ts` | `listChangelogs({q})` + `getChangelog()` | Modify |
| `src/test/client.test.ts` | test query-string & URL | Modify |
| `src/src/screens/deeplink.ts` | + `parseChangelogHash` / `changelogDeepLink` | Modify |
| `src/test/changelog-deeplink.test.ts` | test parser & builder | Create |
| `src/src/screens/ChangelogPanel.tsx` | generator murni (tiga mode) + `onGenerated` | Modify |
| `src/src/screens/ChangelogPanel.test.tsx` | test generator | Modify |
| `src/src/screens/ChangelogScreen.tsx` | halaman: generator + daftar rilis + detail rilis | Create |
| `src/src/screens/ChangelogScreen.test.tsx` | test daftar, cari, pilih, keadaan kosong | Create |
| `src/src/ds/shell.tsx` | entri nav `Changelog`, `HN_NAV` diekspor | Modify |
| `src/src/App.tsx` | cabang `section === "changelog"` + efek deep-link | Modify |
| `src/test/changelog-nav.test.tsx` | entri nav + kontrak nav⇄cabang App | Create |
| `src/src/screens/ProjectDetailScreen.tsx` | panel → pintu "Changelog" | Modify |
| `internal/docs/architecture/api-contract.md` | dokumentasi `?q=` | Modify |
| `internal/docs/frontend/frontend-implementation.md` | section, nav, deep-link | Modify |
| `internal/skills/hanoman/SKILL.md` | butir SPEC-516 diperluas SPEC-519 | Modify |

---

### Task 1: Predikat cari `changelogMatches` (shared)

**Files:**
- Modify: `shared/src/changelog.ts` (tambahkan di akhir berkas)
- Test: `shared/src/changelog.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `changelogMatches(row: { title: string; body: string; mode: string }, q: string): boolean`
  — diekspor dari `@hanoman/shared` (barrel `shared/src/index.ts` sudah `export * from "./changelog"`,
  jadi tak ada perubahan barrel).

- [ ] **Step 1: Write the failing test**

Tambahkan di akhir `shared/src/changelog.test.ts` (impor di baris atas berkas ikut ditambah
`changelogMatches`):

```ts
import { changelogMatches } from "./changelog";

describe("changelogMatches (SPEC-519)", () => {
  const row = { title: "v1.2.0", body: "- **Unduh laporan** — sekarang bisa PDF.", mode: "version" };

  it("cocok pada judul, tanpa peduli besar-kecil huruf", () => {
    expect(changelogMatches(row, "V1.2")).toBe(true);
  });

  it("cocok pada isi rilis, bukan cuma judulnya", () => {
    expect(changelogMatches(row, "laporan")).toBe(true);
  });

  it("cocok pada mode", () => {
    expect(changelogMatches(row, "version")).toBe(true);
  });

  it("q kosong atau spasi doang meloloskan semua — kotak cari yang belum diketik tak mengosongkan daftar", () => {
    expect(changelogMatches(row, "")).toBe(true);
    expect(changelogMatches(row, "   ")).toBe(true);
  });

  it("tak cocok = false", () => {
    expect(changelogMatches(row, "telegram")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ./shared exec vitest run src/changelog.test.ts`
Expected: FAIL — `changelogMatches is not a function` / error impor.

- [ ] **Step 3: Write minimal implementation**

Tambahkan di akhir `shared/src/changelog.ts`:

```ts
/** SPEC-519 · predikat cari daftar rilis. Case-insensitive atas judul, isi, dan mode.
 *  `q` kosong / spasi doang → semua lolos: kotak cari yang belum diketik tak boleh mengosongkan
 *  daftar. Dipakai `GET /projects/:id/changelog?q=` — saring dulu, baru `paginate`, supaya
 *  `total` menghitung hasil cari (ADR-0038). */
export function changelogMatches(row: { title: string; body: string; mode: string }, q: string): boolean {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return true;
  return row.title.toLowerCase().includes(needle)
    || row.body.toLowerCase().includes(needle)
    || row.mode.toLowerCase().includes(needle);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter ./shared exec vitest run src/changelog.test.ts`
Expected: PASS — seluruh berkas hijau (test SPEC-516 lama ikut hijau).

- [ ] **Step 5: Commit**

```bash
git add shared/src/changelog.ts shared/src/changelog.test.ts
git commit -m "feat(spec-519): predikat cari changelogMatches di shared"
```

---

### Task 2: `GET /projects/:id/changelog?q=` menyaring di layer response

**Files:**
- Modify: `server/src/routes/changelog.ts:47-53` (route daftar)
- Test: `server/test/changelog.route.test.ts` (blok `describe("GET /projects/:id/changelog")`)

**Interfaces:**
- Consumes: `changelogMatches` dari `@hanoman/shared` (Task 1)
- Produces: endpoint yang sama, kini menerima `?q=<teks>`; envelope `Paginated<ChangelogView>`
  dengan `total` = jumlah baris yang **cocok** (bukan jumlah seluruh baris).

- [ ] **Step 1: Write the failing test**

Ganti isi blok `describe("GET /projects/:id/changelog", …)` di `server/test/changelog.route.test.ts`
menjadi (test lama dipertahankan, dua test baru ditambahkan):

```ts
describe("GET /projects/:id/changelog", () => {
  it("daftar terbaru lebih dulu, terpaginasi", async () => {
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    const res = await app.inject({ url: "/api/projects/p1/changelog?limit=1&page=1" });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.total).toBe(2);
    expect(j.items).toHaveLength(1);
  });

  // SPEC-519 · cari dijalankan SEBELUM paginate, jadi `total` ikut menyusut — kalau tidak,
  // Pager menjanjikan halaman yang isinya tak pernah ada.
  it("q menyaring dan total ikut hasil cari", async () => {
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    await prisma.changelog.create({ data: {
      projectId: "p1", mode: "version", title: "v9.9.9", params: {},
      body: "- **Telegram** — notifikasi masuk.", generator: "agent", itemCount: 1 } });

    const hit = await app.inject({ url: "/api/projects/p1/changelog?q=telegram" });
    expect(hit.json().total).toBe(1);
    expect(hit.json().items[0].title).toBe("v9.9.9");

    const miss = await app.inject({ url: "/api/projects/p1/changelog?q=zzzz" });
    expect(miss.json().total).toBe(0);
    expect(miss.json().items).toEqual([]);
  });

  it("q kosong berperilaku persis seperti tanpa q", async () => {
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    const withQ = await app.inject({ url: "/api/projects/p1/changelog?q=" });
    const without = await app.inject({ url: "/api/projects/p1/changelog" });
    expect(withQ.json().total).toBe(without.json().total);
    expect(withQ.json().total).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server exec vitest run test/changelog.route.test.ts --no-file-parallelism`
Expected: FAIL pada test `q menyaring…` — `total` = 2 (bukan 1), karena `q` masih diabaikan.

- [ ] **Step 3: Write minimal implementation**

Di `server/src/routes/changelog.ts`, ubah impor `@hanoman/shared` di baris 2 dan route daftar:

```ts
import { zChangelogRequest, defaultRange, changelogMatches } from "@hanoman/shared";
```

```ts
  app.get("/projects/:id/changelog", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!await prisma.project.findUnique({ where: { id } })) return reply.code(404).send({ error: "not found" });
    // SPEC-519 · `q` disaring di layer response SEBELUM `paginate` (ADR-0038) — kalau sesudah,
    // `total` menghitung seluruh baris dan Pager menjanjikan halaman yang isinya tak pernah ada.
    const { page, limit, q } = req.query as { page?: string; limit?: string; q?: string };
    const rows = await prisma.changelog.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
    return paginate(rows.filter((r) => changelogMatches(r, q ?? "")).map(view), page, limit);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm --filter ./server exec vitest run test/changelog.route.test.ts --no-file-parallelism`
Expected: PASS — seluruh berkas hijau.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/changelog.ts server/test/changelog.route.test.ts
git commit -m "feat(spec-519): GET changelog menerima ?q= (saring sebelum paginate)"
```

---

### Task 3: Klien API — `listChangelogs({q})` dan `getChangelog()`

**Files:**
- Modify: `src/src/api/client.ts:409-417` (blok changelog)
- Test: `src/test/client.test.ts`

**Interfaces:**
- Consumes: `paths.changelog(projectId)`, `paths.changelogItem(projectId, id)` (sudah ada di
  `shared/src/api.ts`), helper `qs`/`j` di berkas klien.
- Produces:
  - `api.listChangelogs(projectId: string, p?: { page?: number; limit?: number; q?: string }): Promise<Paginated<ChangelogView>>`
  - `api.getChangelog(projectId: string, id: string): Promise<ChangelogView>`

- [ ] **Step 1: Write the failing test**

Tambahkan di `src/test/client.test.ts`, di dalam `describe("api client", …)`:

```ts
  // SPEC-519 · kotak cari halaman Changelog mengirim `q` ke endpoint yang sudah ada.
  it("listChangelogs mengirim q/page/limit ke query string", async () => {
    globalThis.fetch = vi.fn(async () => envelope([])) as any;
    await api.listChangelogs("p1", { q: "laporan", page: 2, limit: 12 });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("/api/projects/p1/changelog?");
    expect(url).toContain("q=laporan");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=12");
  });

  it("listChangelogs membuang q kosong", async () => {
    globalThis.fetch = vi.fn(async () => envelope([])) as any;
    await api.listChangelogs("p1", { q: "" });
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("/api/projects/p1/changelog");
  });

  // SPEC-519 · deep-link `#changelog=<p>&cl=<id>` bisa menunjuk rilis yang tak ada di halaman 1.
  it("getChangelog mengambil satu rilis lewat endpoint item", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "c1" }),
      { status: 200, headers: { "content-type": "application/json" } })) as any;
    const r = await api.getChangelog("p1", "c1");
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("/api/projects/p1/changelog/c1");
    expect(r.id).toBe("c1");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/client.test.ts`
Expected: FAIL — `api.getChangelog is not a function`, dan URL `listChangelogs` tak memuat `q=laporan`.

- [ ] **Step 3: Write minimal implementation**

Di `src/src/api/client.ts`, ganti blok changelog:

```ts
  // SPEC-516 · ADR-0105 · changelog per project (capability `docs`).
  changelogSources: (projectId: string) =>
    j<ChangelogSources>(paths.changelogSources(projectId)),
  // SPEC-519 · `q` = cari judul/isi/mode; disaring server sebelum paginate.
  listChangelogs: (projectId: string, p: { page?: number; limit?: number; q?: string } = {}) =>
    j<Paginated<ChangelogView>>(paths.changelog(projectId) + qs({ page: p.page, limit: p.limit, q: p.q })),
  // SPEC-519 · satu rilis lewat id — deep-link bisa menunjuk rilis di luar halaman pertama.
  getChangelog: (projectId: string, id: string) =>
    j<ChangelogView>(paths.changelogItem(projectId, id)),
  generateChangelog: (projectId: string, req: ChangelogRequest) =>
    j<ChangelogView>(paths.changelog(projectId), { method: "POST", ...body(req) }),
  deleteChangelog: (projectId: string, id: string) =>
    j<void>(paths.changelogItem(projectId, id), { method: "DELETE" }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/test/client.test.ts
git commit -m "feat(spec-519): klien listChangelogs(q) + getChangelog"
```

---

### Task 4: Deep-link `#changelog=<projectId>[&cl=<id>]`

**Files:**
- Modify: `src/src/screens/deeplink.ts` (tambahkan di akhir)
- Test: `src/test/changelog-deeplink.test.ts` (Create)

**Interfaces:**
- Consumes: —
- Produces:
  - `parseChangelogHash(hash: string): { projectId: string; changelogId: string | null } | null`
  - `changelogDeepLink(projectId: string, changelogId?: string | null, loc?: { origin: string; pathname: string }): string`

- [ ] **Step 1: Write the failing test**

Buat `src/test/changelog-deeplink.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseChangelogHash, changelogDeepLink } from "../src/screens/deeplink";
import { parseSpecHash } from "../src/screens/deeplink";

const loc = { origin: "https://hanoman.test", pathname: "/" };

describe("SPEC-519 · deep-link changelog", () => {
  it("membaca projectId tanpa cl", () => {
    expect(parseChangelogHash("#changelog=arta")).toEqual({ projectId: "arta", changelogId: null });
  });

  it("membaca projectId + cl", () => {
    expect(parseChangelogHash("#changelog=arta&cl=c123"))
      .toEqual({ projectId: "arta", changelogId: "c123" });
  });

  it("meng-decode id yang ter-encode", () => {
    expect(parseChangelogHash("#changelog=a%2Fb")).toEqual({ projectId: "a/b", changelogId: null });
  });

  it("hash lain = null", () => {
    expect(parseChangelogHash("#spec=SPEC-9")).toBeNull();
    expect(parseChangelogHash("")).toBeNull();
  });

  // Dua parser hidup di berkas yang sama dan dibaca efek mount yang sama: kalau saling
  // menangkap, satu tautan membuka dua layar sekaligus.
  it("tak saling menangkap dengan #spec=", () => {
    expect(parseSpecHash("#changelog=arta&cl=c1")).toBeNull();
    expect(parseChangelogHash("#spec=SPEC-9")).toBeNull();
  });

  it("builder simetris dengan parser", () => {
    expect(changelogDeepLink("arta", null, loc)).toBe("https://hanoman.test/#changelog=arta");
    expect(changelogDeepLink("arta", "c1", loc)).toBe("https://hanoman.test/#changelog=arta&cl=c1");
    const url = changelogDeepLink("a/b", "c 1", loc);
    expect(parseChangelogHash(url.slice(url.indexOf("#"))))
      .toEqual({ projectId: "a/b", changelogId: "c 1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/changelog-deeplink.test.ts`
Expected: FAIL — `parseChangelogHash is not a function`.

- [ ] **Step 3: Write minimal implementation**

Tambahkan di akhir `src/src/screens/deeplink.ts`:

```ts
// SPEC-519 · deep-link changelog, pola & siklus hidup yang sama dengan `#spec=` (ADR-0071):
// `#changelog=<projectId>` membuka halaman changelog project itu, `&cl=<id>` langsung memilih satu
// rilis. Di-parse SEKALI saat mount lalu hash dibersihkan agar tak memicu ulang.
export function parseChangelogHash(hash: string): { projectId: string; changelogId: string | null } | null {
  const m = /(?:^|[#&])changelog=([^&]+)/.exec(hash || "");
  if (!m || !m[1]) return null;
  const c = /(?:^|[#&])cl=([^&]+)/.exec(hash);
  return { projectId: decodeURIComponent(m[1]), changelogId: c && c[1] ? decodeURIComponent(c[1]) : null };
}

// Bangun URL absolut ke halaman changelog (opsional: satu rilis) dari lokasi saat ini.
export function changelogDeepLink(projectId: string, changelogId?: string | null,
  loc: { origin: string; pathname: string } = window.location): string {
  const cl = changelogId ? `&cl=${encodeURIComponent(changelogId)}` : "";
  return `${loc.origin}${loc.pathname}#changelog=${encodeURIComponent(projectId)}${cl}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/changelog-deeplink.test.ts test/backlog-deeplink.test.tsx`
Expected: PASS keduanya (deep-link spec lama tak terganggu).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/deeplink.ts src/test/changelog-deeplink.test.ts
git commit -m "feat(spec-519): deep-link #changelog=<projectId>[&cl=<id>]"
```

---

### Task 5: `ChangelogPanel` jadi generator murni + `onGenerated`

**Files:**
- Modify: `src/src/screens/ChangelogPanel.tsx`
- Test: `src/src/screens/ChangelogPanel.test.tsx`

**Interfaces:**
- Consumes: `api.changelogSources`, `api.generateChangelog`
- Produces: `ChangelogPanel({ p, onToast, onGenerated }: { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void; onGenerated?: (v: ChangelogView) => void })`
  — panel **tidak lagi** merender hasil, daftar "Tersimpan", maupun tombol Salin/Unduh/Hapus; hasil
  generate diserahkan ke pemanggil lewat `onGenerated` (Task 6 merendernya di kartu detail, satu
  jalur render untuk semua rilis).

- [ ] **Step 1: Write the failing test**

Ganti `src/src/screens/ChangelogPanel.test.tsx` seluruhnya:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangelogPanel } from "./ChangelogPanel";

const sources = {
  hasRepo: true, tags: ["v1.1.0", "v1.0.0"], head: "abc1234", reason: null,
  backlog: { doneCount: 3, earliest: null, latest: null },
  defaultRange: { from: "2026-07-05", to: "2026-08-03" },
};

const made = {
  id: "c1", projectId: "p1", mode: "backlog", title: "Juli", params: {},
  body: "# Changelog — Juli\n\n- **Butir** — manfaatnya.\n",
  generator: "agent", warning: null, itemCount: 1, createdAt: "2026-08-03T00:00:00.000Z",
};

vi.mock("../api/client", () => ({
  api: {
    changelogSources: vi.fn(async () => sources),
    generateChangelog: vi.fn(async () => made),
  },
}));

const props = { p: { id: "p1", name: "p1" } as never, onToast: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe("ChangelogPanel", () => {
  it("mode backlog terpilih awal, rentang terisi default dari sources", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => expect(screen.getByLabelText("Dari tanggal")).toHaveValue("2026-07-05"));
    expect(screen.getByLabelText("Sampai tanggal")).toHaveValue("2026-08-03");
  });

  it("mode SHA menampilkan dua kolom revisi", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Rentang commit" }));
    fireEvent.click(screen.getByRole("button", { name: "Rentang commit" }));
    expect(screen.getByLabelText("Dari revisi")).toBeInTheDocument();
    expect(screen.getByLabelText("Sampai revisi")).toBeInTheDocument();
  });

  it("mode versi menawarkan tag dari sources", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Versi rilis" }));
    fireEvent.click(screen.getByRole("button", { name: "Versi rilis" }));
    await waitFor(() => expect(screen.getByLabelText("Versi")).toBeInTheDocument());
    expect(screen.getAllByRole("option", { name: "v1.1.0" }).length).toBeGreaterThan(0);
  });

  it("repo tanpa tag: mode versi menjelaskan alasannya, tanpa tombol mati tanpa sebab", async () => {
    const { api } = await import("../api/client");
    (api.changelogSources as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...sources, tags: [], reason: "repo project ini belum punya tag rilis",
    });
    render(<ChangelogPanel {...props} />);
    await waitFor(() => screen.getByRole("button", { name: "Versi rilis" }));
    fireEvent.click(screen.getByRole("button", { name: "Versi rilis" }));
    await waitFor(() => expect(screen.getByText(/belum punya tag rilis/)).toBeInTheDocument());
  });

  // SPEC-519 · panel tak lagi merender hasil; ia menyerahkannya supaya SATU kartu merender
  // badan rilis, entah rilis baru atau rilis lama yang dipilih dari daftar.
  it("Bangkitkan menyerahkan hasil lewat onGenerated", async () => {
    const { api } = await import("../api/client");
    const onGenerated = vi.fn();
    render(<ChangelogPanel {...props} onGenerated={onGenerated} />);
    await waitFor(() => screen.getByRole("button", { name: /Bangkitkan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bangkitkan/ }));
    await waitFor(() => expect(api.generateChangelog).toHaveBeenCalled());
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(made));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run src/screens/ChangelogPanel.test.tsx`
Expected: FAIL — mock klien tak lagi menyediakan `listChangelogs`/`deleteChangelog` yang masih
dipanggil panel (`TypeError: api.listChangelogs is not a function`), dan `onGenerated` tak pernah
dipanggil.

- [ ] **Step 3: Write minimal implementation**

Ganti `src/src/screens/ChangelogPanel.tsx` seluruhnya:

```tsx
/* ChangelogPanel (SPEC-516 · ADR-0105 · letak & jangkauan: SPEC-519) — generator changelog naratif
   per project lewat tiga mode. Panggilan agen bisa puluhan detik, jadi statusnya eksplisit: tombol
   berubah teks dan nonaktif, bukan spinner bisu.

   Sejak SPEC-519 panel ini generator MURNI: hasilnya diserahkan lewat `onGenerated` dan dirender
   ChangelogScreen di kartu detail yang sama dengan rilis lama. Satu jalur render untuk semua rilis
   — kalau panel ikut merender, hasil yang sama muncul dua kali begitu ia dipilih dari daftar. */
import React from "react";
import { Card, Button, Input, Select, Field, Callout } from "../ds";
import { api } from "../api/client";
import type { ChangelogView, ChangelogSources, ChangelogRequest } from "@hanoman/shared";
import type { ProjectVM } from "./types";

type Mode = "backlog" | "commit" | "version";
const MODE_TABS: Array<{ mode: Mode; label: string; hint: string }> = [
  { mode: "backlog", label: "Rentang tanggal", hint: "backlog yang selesai di rentang itu" },
  { mode: "commit", label: "Rentang commit", hint: "perubahan repo antara dua revisi" },
  { mode: "version", label: "Versi rilis", hint: "perubahan yang masuk ke sebuah versi" },
];

export function ChangelogPanel({ p, onToast, onGenerated }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void;
    onGenerated?: (v: ChangelogView) => void }) {
  const [mode, setMode] = React.useState<Mode>("backlog");
  const [src, setSrc] = React.useState<ChangelogSources | null>(null);
  const [from, setFrom] = React.useState(""); const [to, setTo] = React.useState("");
  const [fromSha, setFromSha] = React.useState(""); const [toSha, setToSha] = React.useState("");
  const [fromTag, setFromTag] = React.useState(""); const [toTag, setToTag] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await api.changelogSources(p.id);
        if (!alive) return;
        setSrc(s);
        setFrom(s.defaultRange.from); setTo(s.defaultRange.to);
        if (s.tags[0]) setToTag(s.tags[0]);
        if (s.head) setToSha(s.head);
      } catch { /* form tetap bisa diisi manual */ }
    })();
    return () => { alive = false; };
  }, [p.id]);

  const request = (): ChangelogRequest =>
    mode === "backlog" ? { mode, from: from || undefined, to: to || undefined }
      : mode === "commit" ? { mode, fromSha, toSha }
        : { mode, fromTag: fromTag || undefined, toTag };

  const ready = mode === "backlog" ? true
    : mode === "commit" ? fromSha.trim().length >= 4 && toSha.trim().length >= 4
      : toTag.trim().length > 0;

  async function generate() {
    setBusy(true);
    try {
      const r = await api.generateChangelog(p.id, request());
      onToast(r.generator === "agent" ? "Changelog dibangkitkan" : "Changelog dibangkitkan (draf ringkas)",
        r.generator === "agent" ? "ok" : "warn", "file-text");
      onGenerated?.(r);
    } catch (e) {
      onToast((e as Error).message || "Gagal membangkitkan changelog", "err", "x-circle");
    } finally { setBusy(false); }
  }

  const tagsMissing = mode === "version" && src !== null && src.tags.length === 0;
  const repoMissing = mode === "commit" && src !== null && !!src.reason && src.tags.length === 0;

  return (
    <Card eyebrow="changelog" title="Ringkasan perubahan untuk pemakai">
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Teks pendek berorientasi pemakai — apa yang berubah bagi mereka, bukan apa yang disentuh di dalam kode.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {MODE_TABS.map((t) => (
          <Button key={t.mode} size="sm" variant={mode === t.mode ? "primary" : "ghost"}
            onClick={() => setMode(t.mode)} title={t.hint}>{t.label}</Button>
        ))}
      </div>

      {/* `Input`/`Select` design system TAK punya prop `label` — keduanya menyebar `...rest` ke
          elemen native, jadi nama aksesibilitasnya dipasang lewat `aria-label` dan label yang
          TERLIHAT lewat `Field`. `Select` juga menerima `options`, bukan `children` <option>:
          anak JSX akan diabaikan senyap. */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
        {mode === "backlog" && (
          <>
            <Field label="Dari tanggal">
              <Input aria-label="Dari tanggal" type="date" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} />
            </Field>
            <Field label="Sampai tanggal">
              <Input aria-label="Sampai tanggal" type="date" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} />
            </Field>
          </>
        )}
        {mode === "commit" && (
          <>
            <Field label="Dari revisi">
              <Input aria-label="Dari revisi" mono placeholder="mis. v1.0.0 atau 4f2a1c9" value={fromSha}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFromSha(e.target.value)} />
            </Field>
            <Field label="Sampai revisi">
              <Input aria-label="Sampai revisi" mono placeholder="mis. HEAD atau 9d3b77e" value={toSha}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToSha(e.target.value)} />
            </Field>
          </>
        )}
        {mode === "version" && (
          <>
            <Field label="Sejak versi">
              <Select aria-label="Sejak versi" value={fromTag} onChange={(e) => setFromTag(e.target.value)}
                options={[{ value: "", label: "versi sebelumnya" }, ...(src?.tags ?? []).map((t) => ({ value: t, label: t }))]} />
            </Field>
            <Field label="Versi">
              <Select aria-label="Versi" value={toTag} onChange={(e) => setToTag(e.target.value)}
                options={(src?.tags ?? []).map((t) => ({ value: t, label: t }))} />
            </Field>
          </>
        )}
        <Button leftIcon="sparkles" onClick={() => void generate()} disabled={busy || !ready || tagsMissing || repoMissing}>
          {busy ? "Membangkitkan…" : "Bangkitkan"}
        </Button>
      </div>

      {(tagsMissing || repoMissing) && <Callout tone="warn">{src?.reason}</Callout>}
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run src/screens/ChangelogPanel.test.tsx`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/ChangelogPanel.tsx src/src/screens/ChangelogPanel.test.tsx
git commit -m "refactor(spec-519): ChangelogPanel jadi generator murni + onGenerated"
```

> Catatan: sesudah task ini `ProjectDetailScreen` masih mengimpor `ChangelogPanel` tanpa
> `onGenerated` (prop opsional) — kompilasi tetap jalan; pintunya dipasang di Task 8.

---

### Task 6: `ChangelogScreen` — daftar rilis bergulir, dicari, dan bisa dibuka

**Files:**
- Create: `src/src/screens/ChangelogScreen.tsx`
- Test: `src/src/screens/ChangelogScreen.test.tsx` (Create)

**Interfaces:**
- Consumes: `ChangelogPanel` + `onGenerated` (Task 5), `api.listChangelogs({q,page,limit})` &
  `api.getChangelog` (Task 3), `changelogDeepLink` (Task 4), `paths.changelogItem` dari
  `@hanoman/shared`.
- Produces: `ChangelogScreen({ p, onToast, initialChangelogId }: { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void; initialChangelogId?: string | null })`

- [ ] **Step 1: Write the failing test**

Buat `src/src/screens/ChangelogScreen.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangelogScreen } from "./ChangelogScreen";

const row = (over: Record<string, unknown> = {}) => ({
  id: "c1", projectId: "p1", mode: "version", title: "v1.2.0", params: {},
  body: "# v1.2.0\n\n- **Unduh laporan** — sekarang bisa PDF.\n",
  generator: "agent", warning: null, itemCount: 7, createdAt: "2026-08-01T03:00:00.000Z", ...over,
});

vi.mock("../api/client", () => ({
  api: {
    changelogSources: vi.fn(async () => ({
      hasRepo: true, tags: [], head: null, reason: null,
      backlog: { doneCount: 0, earliest: null, latest: null },
      defaultRange: { from: "2026-07-05", to: "2026-08-03" },
    })),
    generateChangelog: vi.fn(),
    listChangelogs: vi.fn(async () => ({ items: [row(), row({ id: "c2", title: "Juli 2026", mode: "backlog" })], total: 2, page: 1, pageSize: 12 })),
    getChangelog: vi.fn(async () => row({ id: "c9", title: "v0.9.0" })),
    deleteChangelog: vi.fn(async () => undefined),
  },
}));

const props = { p: { id: "p1", name: "p1" } as never, onToast: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe("ChangelogScreen (SPEC-519)", () => {
  it("menampilkan daftar rilis di area yang bisa digulir", async () => {
    render(<ChangelogScreen {...props} />);
    await waitFor(() => expect(screen.getByText("v1.2.0")).toBeInTheDocument());
    expect(screen.getByText("Juli 2026")).toBeInTheDocument();
    const list = screen.getByTestId("changelog-list");
    expect(list).toHaveStyle({ overflowY: "auto" });
  });

  it("mengetik di kotak cari memanggil daftar dengan q", async () => {
    const { api } = await import("../api/client");
    render(<ChangelogScreen {...props} />);
    await waitFor(() => expect(api.listChangelogs).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Cari rilis"), { target: { value: "laporan" } });
    await waitFor(() => expect(api.listChangelogs).toHaveBeenLastCalledWith("p1",
      expect.objectContaining({ q: "laporan", page: 1 })));
  });

  it("klik satu rilis merender badan changelog-nya", async () => {
    render(<ChangelogScreen {...props} />);
    await waitFor(() => expect(screen.getByText("v1.2.0")).toBeInTheDocument());
    fireEvent.click(screen.getByText("v1.2.0"));
    await waitFor(() => expect(screen.getByText("Unduh laporan")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Unduh .md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salin link" })).toBeInTheDocument();
  });

  it("cari tanpa hasil menjelaskan sebabnya, bukan daftar kosong bisu", async () => {
    const { api } = await import("../api/client");
    (api.listChangelogs as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    render(<ChangelogScreen {...props} />);
    fireEvent.change(screen.getByLabelText("Cari rilis"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText(/Tak ada rilis yang cocok/)).toBeInTheDocument());
  });

  it("belum ada rilis sama sekali: mengarahkan ke generator, bukan pesan cari", async () => {
    const { api } = await import("../api/client");
    (api.listChangelogs as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    render(<ChangelogScreen {...props} />);
    await waitFor(() => expect(screen.getByText(/Belum ada rilis/)).toBeInTheDocument());
  });

  // Deep-link `&cl=` bisa menunjuk rilis yang tak ada di halaman pertama — jadi diambil per-id,
  // bukan dicari di dalam daftar yang kebetulan termuat.
  it("initialChangelogId membuka rilis itu lewat getChangelog", async () => {
    const { api } = await import("../api/client");
    render(<ChangelogScreen {...props} initialChangelogId="c9" />);
    await waitFor(() => expect(api.getChangelog).toHaveBeenCalledWith("p1", "c9"));
    await waitFor(() => expect(screen.getByText("v0.9.0")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run src/screens/ChangelogScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./ChangelogScreen"`.

- [ ] **Step 3: Write minimal implementation**

Buat `src/src/screens/ChangelogScreen.tsx`:

```tsx
/* ChangelogScreen (SPEC-519) — halaman changelog satu project: generator (SPEC-516), daftar rilis
   yang bisa digulir & dicari, dan badan rilis terpilih. Mesin changelog & logika git tag tak
   disentuh; layar ini hanya memberi mereka tempat yang bisa dijangkau (entri sidebar + deep-link).

   Daftar memakai tinggi BERBATAS, bukan rantai flex `LIST_SCROLL_STYLE`: `Card` menyisipkan
   pembungkus `display:block` di sekitar `children` kecuali prop `fill` dipasang, dan rantai yang
   menembusnya putus (audit SPEC-393). Kartu ini duduk di antara dua kartu lain di kolom yang
   menggulir bersama <main>, jadi tinggi tetap memang bentuk yang benar di sini. */
import React from "react";
import { Card, Button, Badge, Input, StateBlock, MarkdownView, Callout, Pager, serverPage } from "../ds";
import { api } from "../api/client";
import { paths } from "@hanoman/shared";
import type { ChangelogView } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { ChangelogPanel } from "./ChangelogPanel";
import { changelogDeepLink } from "./deeplink";

const PAGE_SIZE = 12;
const MODE_LABEL: Record<string, string> = {
  backlog: "rentang tanggal", commit: "rentang commit", version: "versi rilis",
};
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

function ReleaseRow({ c, active, onOpen }:
  { c: ChangelogView; active: boolean; onOpen: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", cursor: "pointer",
        borderRadius: "var(--radius-sm)", borderBottom: "1px solid var(--border-hair)",
        background: active ? "var(--brass-100)" : "transparent",
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{c.title}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>
          {MODE_LABEL[c.mode] ?? c.mode} · {fmtDate(c.createdAt)} · {c.itemCount} perubahan
        </div>
      </div>
      <Badge tone={c.generator === "agent" ? "ok" : "warn"} size="sm">
        {c.generator === "agent" ? "naratif" : "draf ringkas"}
      </Badge>
    </div>
  );
}

export function ChangelogScreen({ p, onToast, initialChangelogId }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void;
    initialChangelogId?: string | null }) {
  const [items, setItems] = React.useState<ChangelogView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<ChangelogView | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  // Debounce ketikan: kotak cari memanggil server, bukan menyaring halaman yang kebetulan termuat
  // (kalau menyaring di klien, rilis di halaman lain tak akan pernah ketemu — bug yang sedang
  // diperbaiki, dalam bentuk baru).
  React.useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      api.listChangelogs(p.id, { q, page, limit: PAGE_SIZE })
        .then((r) => { if (!alive) return; setItems(r.items); setTotal(r.total); })
        .catch(() => { if (alive) { setItems([]); setTotal(0); } })
        .finally(() => { if (alive) setLoading(false); });
    }, q ? 220 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [p.id, q, page, reloadKey]);

  // Deep-link `&cl=<id>` diambil PER-ID: rilis yang ditunjuk belum tentu ada di halaman pertama.
  React.useEffect(() => {
    if (!initialChangelogId) return;
    let alive = true;
    api.getChangelog(p.id, initialChangelogId)
      .then((c) => { if (alive) setSelected(c); })
      .catch(() => { if (alive) onToast("Rilis yang ditautkan tak ditemukan", "warn", "link-2-off"); });
    return () => { alive = false; };
  }, [p.id, initialChangelogId, onToast]);

  // Ganti project = daftar & pilihan lama tak berlaku lagi.
  React.useEffect(() => { setSelected(null); setQ(""); setPage(1); }, [p.id]);

  const pg = serverPage(total, page, PAGE_SIZE);

  async function remove(c: ChangelogView) {
    if (!window.confirm(`Hapus changelog "${c.title}"?`)) return;
    try {
      await api.deleteChangelog(p.id, c.id);
      if (selected?.id === c.id) setSelected(null);
      setReloadKey((v) => v + 1);
      onToast("Changelog dihapus", "ok", "trash-2");
    } catch { onToast("Gagal menghapus changelog", "err", "x-circle"); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ChangelogPanel p={p} onToast={onToast}
        onGenerated={(c) => { setSelected(c); setPage(1); setReloadKey((v) => v + 1); }} />

      <Card eyebrow="rilis" title="Riwayat changelog"
        actions={<span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-subtle)" }}>
          {total} rilis
        </span>}>
        <Input aria-label="Cari rilis" leftIcon="search" placeholder="cari judul atau isi rilis…"
          value={q} style={{ width: "100%" }}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPage(1); setQ(e.target.value); }} />

        <div data-testid="changelog-list"
          style={{ maxHeight: 340, overflowY: "auto", marginTop: 10 }}>
          {loading && items.length === 0 && <StateBlock kind="loading" compact />}
          {!loading && items.length === 0 && (q.trim()
            ? <StateBlock kind="empty" icon="search" compact title="Tak ada rilis yang cocok"
                hint={`Tak ada rilis yang memuat “${q.trim()}”.`}
                action={() => setQ("")} actionLabel="Bersihkan pencarian" actionIcon="x" />
            : <StateBlock kind="empty" icon="megaphone" compact title="Belum ada rilis"
                hint="Bangkitkan changelog pertama project ini lewat kartu di atas." />)}
          {items.map((c) => (
            <ReleaseRow key={c.id} c={c} active={selected?.id === c.id} onOpen={() => setSelected(c)} />
          ))}
        </div>

        <Pager page={pg.page} pageCount={pg.pageCount} total={total} from={pg.from} to={pg.to}
          onPage={setPage} unit="rilis" />
      </Card>

      {selected && (
        <Card eyebrow={`rilis · ${MODE_LABEL[selected.mode] ?? selected.mode}`} title={selected.title}
          actions={
            <div style={{ display: "flex", gap: 6 }}>
              <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => {
                void navigator.clipboard?.writeText(selected.body); onToast("Changelog disalin", "ok", "copy");
              }}>Salin</Button>
              <Button as="a" size="sm" variant="ghost" leftIcon="download" download
                href={`${paths.changelogItem(p.id, selected.id)}?download=md`}
                aria-label="Unduh .md">Unduh .md</Button>
              <Button size="sm" variant="ghost" leftIcon="link" onClick={() => {
                void navigator.clipboard?.writeText(changelogDeepLink(p.id, selected.id));
                onToast("Link changelog disalin", "ok", "link");
              }}>Salin link</Button>
              <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${selected.title}`}
                onClick={() => void remove(selected)} />
            </div>}>
          {selected.warning && <Callout tone="warn">{selected.warning}</Callout>}
          <MarkdownView text={selected.body} name="changelog.md" />
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run src/screens/ChangelogScreen.test.tsx`
Expected: PASS (6 test).

- [ ] **Step 5: Typecheck paket web**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0, tanpa error.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/ChangelogScreen.tsx src/src/screens/ChangelogScreen.test.tsx
git commit -m "feat(spec-519): ChangelogScreen — daftar rilis bergulir, dicari, dan bisa dibuka"
```

---

### Task 7: Entri sidebar `Changelog` + cabang `section === "changelog"` + deep-link mount

**Files:**
- Modify: `src/src/ds/shell.tsx:16-30` (ekspor `HN_NAV` + entri baru)
- Modify: `src/src/App.tsx` (impor, state `openChangelogId`, efek deep-link ~baris 632, cabang section ~baris 1196)
- Test: `src/test/changelog-nav.test.tsx` (Create)

**Interfaces:**
- Consumes: `ChangelogScreen` (Task 6), `parseChangelogHash` (Task 4)
- Produces: `export type NavItem = { key: string; label: string; icon: string }` dan
  `export const HN_NAV: NavItem[]` dari `src/src/ds/shell.tsx`; section `"changelog"` di App.

- [ ] **Step 1: Write the failing test**

Buat `src/test/changelog-nav.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// Widget topbar yang self-fetch / butuh provider → di-noop agar Shell bisa dirender terisolasi.
vi.mock("../src/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("../src/screens/LimitIndicator", () => ({ LimitBadge: () => null, CodexLimitBadge: () => null }));
vi.mock("../src/screens/UpdateIndicator", () => ({ UpdateBadge: () => null }));
vi.mock("../src/auth/AccountMenu", () => ({ AccountMenu: () => null }));

import { Shell, HN_NAV } from "../src/ds/shell";

describe("Shell nav · Changelog (SPEC-519)", () => {
  it("merender item nav Changelog dan memanggil onNavigate('changelog')", () => {
    const onNavigate = vi.fn();
    render(<Shell active="overview" title="x" onNavigate={onNavigate}><div /></Shell>);
    const item = screen.getByText("Changelog");
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onNavigate).toHaveBeenCalledWith("changelog");
  });

  // Kontrak yang menjaga kelas bug `runs`/`triggers` (SPEC-162): entri nav tanpa cabang di App
  // membuat App merender KOSONG — sidebar ikut hilang dan pengguna terjebak sampai reload.
  it("setiap key HN_NAV punya cabang section di App.tsx", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const missing = HN_NAV.map((n) => n.key).filter((k) => !app.includes(`section === "${k}"`));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/changelog-nav.test.tsx`
Expected: FAIL — `HN_NAV` belum diekspor / teks "Changelog" tak ditemukan.

- [ ] **Step 3a: Ekspor `HN_NAV` + tambahkan entrinya**

Di `src/src/ds/shell.tsx`, ubah deklarasi nav (baris 16-30):

```tsx
export type NavItem = { key: string; label: string; icon: string };
export const HN_NAV: NavItem[] = [
  { key: "overview", label: "Overview", icon: "layout-dashboard" },
  { key: "projects", label: "Projects", icon: "layout-grid" },
  { key: "prd", label: "PRD", icon: "scroll-text" },
  { key: "backlog", label: "Backlog", icon: "list-checks" },
  { key: "triage", label: "Triase", icon: "inbox" },
  { key: "scheduler", label: "Scheduler", icon: "calendar-clock" },
  { key: "lead", label: "Lead", icon: "compass" },   // SPEC-409 · ADR-0091 · hanoman-lead
  { key: "terminal", label: "Terminal", icon: "terminal" },
  { key: "ide", label: "IDE", icon: "code-2" },
  { key: "vps", label: "VPS", icon: "server" },
  { key: "docs", label: "Docs · SoT", icon: "book-open" },
  { key: "changelog", label: "Changelog", icon: "megaphone" },   // SPEC-519 · rilis untuk pemakai
  { key: "settings", label: "Settings", icon: "settings" },
];
```

(Komentar blok di atasnya — "Setiap key WAJIB punya cabang `section === …` di App.tsx" — dibiarkan
apa adanya; tambahkan satu kalimat di akhirnya: `Kontraknya kini dijaga test:
src/test/changelog-nav.test.tsx.`)

- [ ] **Step 3b: Tambahkan cabang section + state + efek deep-link di `App.tsx`**

1. Impor (dekat impor screen lain, mis. setelah impor `DocsWorkspace`):

```tsx
import { ChangelogScreen } from "./screens/ChangelogScreen";
```

2. Impor deep-link — ubah baris impor `parseSpecHash` yang sudah ada menjadi:

```tsx
import { parseSpecHash, parseChangelogHash } from "./screens/deeplink";
```

3. State baru, tepat di bawah `const [openSpecId, setOpenSpecId] = React.useState<string | null>(null);`:

```tsx
  // SPEC-519 · deep-link #changelog=<projectId>[&cl=<id>] — rilis yang harus terbuka saat mount.
  const [openChangelogId, setOpenChangelogId] = React.useState<string | null>(null);
```

4. Efek deep-link (ganti efek `React.useEffect(() => { const id = parseSpecHash(...) …}, [])`):

```tsx
  React.useEffect(() => {
    const clean = () => window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const id = parseSpecHash(window.location.hash);
    if (id) {
      setSection("backlog");
      setOpenSpecId(id);
      clean();
      return;
    }
    // SPEC-519 · saling eksklusif dengan `#spec=`: satu hash, satu section. `setProjectId` di sini
    // menang atas default `load()` karena load memakai `(cur) => cur || items[0]`.
    const cl = parseChangelogHash(window.location.hash);
    if (cl) {
      setSection("changelog");
      setProjectId(cl.projectId);
      setOpenChangelogId(cl.changelogId);
      clean();
    }
  }, []);
```

5. Cabang section — sisipkan tepat SETELAH blok `} else if (section === "docs") { … }` dan sebelum
   `} else if (section === "review")`:

```tsx
  } else if (section === "changelog") {
    // SPEC-519 · halaman changelog: entri sidebar sendiri + deep-link `#changelog=<projectId>`.
    // Pemilih project di `actions` mengikuti pola section "docs" — satu sumber "project yang
    // sedang dibuka" (projectId), bukan `projectFilter` yang bermakna "daftar disaring ke mana".
    screen = (
      <Shell active="changelog" title="Changelog"
        breadcrumb={proj ? proj.name + " · rilis untuk pemakai" : "workspace"} onNavigate={setSection}
        actions={proj && <>
          <Select size="sm" aria-label="Project" value={proj.id} onChange={(e) => setProjectId(e.target.value)}
            options={projectsView.map((x) => ({ value: x.id, label: x.name }))} />
          <Button size="sm" variant="ghost" leftIcon="link" onClick={() => {
            void navigator.clipboard?.writeText(changelogDeepLink(proj.id));
            showToast("Link halaman changelog disalin", "ok", "link");
          }}>Salin link</Button>
        </>}>
        {gate(proj
          ? <ChangelogScreen p={proj} onToast={showToast} initialChangelogId={openChangelogId} />
          : <StateBlock kind="empty" icon="megaphone" title="Belum ada project"
              hint="Changelog muncul setelah ada project yang dipantau."
              action={() => setModal("project")} actionLabel="Project baru" />)}
      </Shell>
    );
```

6. Karena cabang itu memakai `changelogDeepLink`, ubah impor deep-link (langkah 2) menjadi:

```tsx
import { parseSpecHash, parseChangelogHash, changelogDeepLink } from "./screens/deeplink";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/changelog-nav.test.tsx`
Expected: PASS (2 test).

- [ ] **Step 5: Pastikan layar App yang sudah ada tak tergores**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/app-flows.test.tsx test/app-states.test.tsx test/backlog-deeplink.test.tsx test/scheduler-nav.test.tsx test/settings-nav.test.tsx`
Expected: PASS semuanya.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0.

- [ ] **Step 7: Commit**

```bash
git add src/src/ds/shell.tsx src/src/App.tsx src/test/changelog-nav.test.tsx
git commit -m "feat(spec-519): entri sidebar Changelog + section + deep-link mount"
```

---

### Task 8: Project detail — panel jadi pintu ke halaman Changelog

**Files:**
- Modify: `src/src/screens/ProjectDetailScreen.tsx` (impor baris 10, render baris 140-141, grid pintu baris 154-160, tanda tangan props baris 93-98)
- Modify: `src/src/App.tsx` (call site `ProjectDetailScreen`, ~baris 1091-1098)
- Test: `src/test/project-detail-changelog.test.tsx` (Create)

**Interfaces:**
- Consumes: section `"changelog"` (Task 7)
- Produces: prop baru `onGotoChangelog: () => void` pada `ProjectDetailScreen`.

- [ ] **Step 1: Write the failing test**

Buat `src/test/project-detail-changelog.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/api/client", () => ({ api: {}, ApiError: class extends Error {} }));
vi.mock("../src/screens/CustomAgentsPanel", () => ({ CustomAgentsPanel: () => null }));
vi.mock("../src/screens/AutoMergeCard", () => ({ AutoMergeCard: () => null }));

import { ProjectDetailScreen } from "../src/screens/ProjectDetailScreen";

const p = {
  id: "arta", name: "Arta", desc: "", kind: "existing", stack: "", docStatus: "ok", coverage: 90,
  backlog: 2, topStage: "execute", repoDir: "/tmp/arta", gitRemote: "", binding: null,
  helpEnabled: false, session: { status: "idle", phase: null },
} as never;

const noop = () => {};
const base = {
  p, onEdit: noop, onGotoDocs: noop, onGotoTerminal: noop, onGotoBacklog: noop,
  onDelete: noop, onToast: noop,
};

describe("ProjectDetailScreen · pintu Changelog (SPEC-519)", () => {
  it("menawarkan pintu Changelog dan memanggil onGotoChangelog", () => {
    const onGotoChangelog = vi.fn();
    render(<ProjectDetailScreen {...base} onGotoChangelog={onGotoChangelog} />);
    const door = screen.getByText("Changelog");
    fireEvent.click(door);
    expect(onGotoChangelog).toHaveBeenCalled();
  });

  // Generator pindah ke halaman changelog; dua salinan berarti dua tempat yang bisa berbeda perilaku.
  it("tidak lagi merender generator changelog di halaman detail", () => {
    render(<ProjectDetailScreen {...base} onGotoChangelog={noop} />);
    expect(screen.queryByRole("button", { name: /Bangkitkan/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/project-detail-changelog.test.tsx`
Expected: FAIL — tak ada elemen bertulisan "Changelog" sebagai pintu (yang ada kartu generator).

- [ ] **Step 3: Write minimal implementation**

Di `src/src/screens/ProjectDetailScreen.tsx`:

1. Hapus baris impor `import { ChangelogPanel } from "./ChangelogPanel";`.
2. Hapus blok render panel:

```tsx
      {/* SPEC-516 · ADR-0105 · changelog naratif per project (tiga mode). */}
      <ChangelogPanel p={p} onToast={onToast} />
```

3. Tambahkan prop pada tanda tangan komponen — sisipkan `onGotoChangelog` di daftar destructuring
   dan tipenya:

```tsx
export function ProjectDetailScreen({ p, onEdit, onGotoDocs, onGotoTerminal, onGotoBacklog, onGotoChangelog, onDelete, onReverse, onScaffold, onToast, onProjectChanged }:
  { p: ProjectVM; onEdit: () => void; onGotoDocs: () => void; onGotoTerminal: () => void;
    onGotoBacklog: () => void;
    // SPEC-519 · changelog punya halamannya sendiri (entri sidebar + deep-link); di sini ia pintu,
    // bukan panel — dua salinan generator berarti dua tempat yang bisa berbeda perilaku.
    onGotoChangelog: () => void;
    onDelete: () => void; onReverse?: () => void; onScaffold?: () => void;
    onToast: (msg: string, kind?: string, icon?: string) => void;
    // SPEC-258 · dipanggil sesudah mutasi in-card (Help Center) agar App refetch VM & status persist.
    onProjectChanged?: (id: string) => void | Promise<void> }) {
```

4. Ganti grid pintu (menghitung kolom manual jadi rapuh begitu pintunya bertambah — pakai auto-fit):

```tsx
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <Door icon="book-open" title="Source of Truth" hint="baca & sunting docs" onClick={onGotoDocs} />
        <Door icon="terminal" title="Buka terminal" hint="sesi claude project ini" onClick={onGotoTerminal} />
        <Door icon="list-checks" title="Lihat backlog" hint={`${p.backlog} spec terbuka`} onClick={onGotoBacklog} />
        <Door icon="megaphone" title="Changelog" hint="ringkasan rilis untuk pemakai" onClick={onGotoChangelog} />
        {onReverse && <Door icon="radar" title="Reverse docs" hint="susun Source of Truth dari kode" onClick={onReverse} />}
        {onScaffold && <Door icon="sparkles" title="Scaffold docs" hint="susun Source of Truth dari ide" onClick={onScaffold} />}
      </div>
```

Di `src/src/App.tsx`, cabang `section === "project"`, tambahkan prop pada call site (setelah
`onGotoBacklog=…`):

```tsx
              onGotoChangelog={() => setSection("changelog")}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/project-detail-changelog.test.tsx`
Expected: PASS (2 test).

- [ ] **Step 5: Typecheck + test tetangga yang menyentuh ProjectDetail**

Run: `pnpm --filter ./src typecheck`
Expected: keluar 0 (call site App wajib mengirim `onGotoChangelog` — prop-nya sengaja WAJIB, bukan
opsional, supaya pintu tak bisa hilang diam-diam).

Run: `env -u NODE_ENV pnpm --filter ./src exec vitest run test/app-flows.test.tsx test/app-states.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/ProjectDetailScreen.tsx src/src/App.tsx src/test/project-detail-changelog.test.tsx
git commit -m "feat(spec-519): project detail menunjuk ke halaman Changelog lewat pintu"
```

---

### Task 9: Docs Source of Truth (commit yang sama dengan kodenya)

**Files:**
- Modify: `internal/docs/architecture/api-contract.md` (bagian changelog SPEC-516)
- Modify: `internal/docs/frontend/frontend-implementation.md` (daftar section/nav)
- Modify: `internal/skills/hanoman/SKILL.md` (butir SPEC-516/ADR-0105)

**Interfaces:**
- Consumes: perilaku final dari Task 1-8
- Produces: docs yang menyatakan `?q=`, section `changelog`, dan bentuk deep-link.

- [ ] **Step 1: Perbarui `api-contract.md`**

Cari baris `GET /projects/:id/changelog` di `internal/docs/architecture/api-contract.md` dan
tambahkan parameter `q` pada deskripsinya, mis.:

```
- `GET /projects/:id/changelog?page&limit&q` — daftar changelog tersimpan, terbaru lebih dulu.
  `q` (SPEC-519) mencocokkan **judul, isi, dan mode** (case-insensitive) dan disaring **sebelum**
  `paginate`, jadi `total` menghitung hasil cari — bukan seluruh baris. `q` kosong = tanpa filter.
```

Sesuaikan bentuk kalimatnya dengan gaya baris tetangganya; jangan mengubah baris endpoint lain.

- [ ] **Step 2: Perbarui `frontend-implementation.md`**

Tambahkan section `changelog` ke daftar section/nav yang ada di dokumen itu, dengan isi:

```
- **`changelog`** (SPEC-519) — halaman changelog per project: entri sidebar `Changelog`
  (`HN_NAV`, ikon `megaphone`), pemilih project di `actions` (pola section `docs`), generator
  `ChangelogPanel` (SPEC-516), dan daftar rilis bergulir + kotak cari yang mengirim `?q=` ke
  endpoint yang sudah ada. Bisa dibuka langsung lewat `#changelog=<projectId>[&cl=<changelogId>]`
  (pola hash ADR-0071, di-parse sekali saat mount lalu hash dibersihkan). Halaman detail project
  tak lagi memuat generatornya — ia menunjuk ke sini lewat pintu.
```

Sesuaikan penempatannya dengan struktur dokumen (bila dokumen memakai tabel, tambahkan barisnya).

- [ ] **Step 3: Perbarui `internal/skills/hanoman/SKILL.md`**

Pada butir "**Changelog per project — `Spec.doneAt` berkolom…**" (SPEC-516/ADR-0105), tambahkan satu
kalimat di akhir butir:

```
  **Letak & jangkauan (SPEC-519, tanpa ADR):** changelog punya **entri sidebar sendiri** (`changelog`)
  dan halaman yang bisa dibuka langsung lewat `#changelog=<projectId>[&cl=<changelogId>]` (pola
  ADR-0071), dengan daftar rilis bergulir yang dicari lewat **satu parameter aditif `?q=`** pada
  `GET /projects/:id/changelog` — disaring **sebelum** `paginate` supaya `total` menghitung hasil
  cari (ADR-0038). Halaman detail project menunjuk ke sana lewat pintu, bukan menyalin generatornya.
  Setiap key `HN_NAV` wajib punya cabang `section === …` di `App.tsx` — kini dijaga test kontrak
  (`src/test/changelog-nav.test.tsx`), bukan hanya komentar.
```

- [ ] **Step 4: Verifikasi index docs tetap utuh**

Run: `node cli/dist/hanoman.js docs index --check 2>/dev/null || echo "cli belum ter-build — lewati"`
Expected: `ok` atau pesan "cli belum ter-build". Tak ada berkas doc BARU di spec ini, jadi
`internal/docs/README.md` tak perlu baris baru; pastikan tak ada yang terhapus:

Run: `git diff --stat internal/docs/README.md`
Expected: kosong (README tak berubah).

- [ ] **Step 5: Commit**

```bash
git add internal/docs/architecture/api-contract.md internal/docs/frontend/frontend-implementation.md internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-519): ?q= di api-contract, section changelog di frontend, butir SKILL"
```

---

### Task 10: Verifikasi ber-skop + smoke endpoint nyata

**Files:** —

**Interfaces:**
- Consumes: seluruh Task 1-9

- [ ] **Step 1: Jalankan test yang tersentuh perubahan (server + shared, serial & DB terisolasi)**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: semua hijau. **Jebakan:** `--changed` menyalakan `passWithNoTests`, jadi "no test files"
**bukan** bukti — pastikan jumlah berkas test yang berjalan ≥ 7 (changelog shared, route server,
client, deeplink, panel, screen, nav, project-detail). Bila 0 berkas berjalan, sebut path test-nya
langsung.

- [ ] **Step 2: Typecheck paket yang tersentuh saja**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: keluar 0 untuk ketiganya. **Jangan** `pnpm -r typecheck`.

- [ ] **Step 3: Smoke endpoint nyata (sekali, di akhir)**

Task ini menyentuh endpoint, jadi boot server dan curl-nya sungguhan dengan DB khusus supaya sesi
tetangga tak terganggu:

```bash
SMOKE=$(mktemp -d)
HANOMAN_HOME="$SMOKE" pnpm --filter ./server exec prisma migrate deploy
HANOMAN_HOME="$SMOKE" PORT=8799 pnpm --filter ./server dev &
sleep 6
curl -s "http://127.0.0.1:8799/api/health"
curl -s "http://127.0.0.1:8799/api/projects/tidak-ada/changelog?q=abc" -o /dev/null -w '%{http_code}\n'
```

Expected: `/api/health` menjawab JSON; endpoint changelog project tak dikenal menjawab `404`
(bukan 500) — membuktikan `q` tak merusak jalur galat. Matikan server **per-PID**:

```bash
kill $(lsof -ti:8799)
```

**JANGAN** `pkill -f node` / `pkill -f vitest` — prompt tiap sesi hidup di ARGV agennya dan pola itu
mematikan sesi tetangga (SPEC-402).

- [ ] **Step 4: Diff bersih & centang plan**

```bash
git status --porcelain
```

Expected: kosong selain berkas plan ini (yang kotaknya dicentang seiring jalan).

- [ ] **Step 5: Commit terakhir + push**

```bash
git add docs/superpowers/plans/2026-08-04-spec-519-changelog-terekspos.md
git commit -m "docs(spec-519): centang plan"
git push origin HEAD:refs/heads/hanoman/spec-519
```

---

## Self-Review

**Spec coverage:**

| Bagian spec | Task |
|---|---|
| Entri sidebar `Changelog` + pasangan cabang App | Task 7 |
| `ChangelogScreen` (pemilih project, generator, daftar, detail) | Task 6 + Task 7 |
| Daftar rilis **bisa digulir** | Task 6 (`maxHeight` + `overflowY`), diuji `changelog-list` |
| Daftar rilis **bisa dicari** | Task 1 (predikat) + Task 2 (route) + Task 3 (klien) + Task 6 (kotak cari) |
| Deep-link `#changelog=` | Task 4 (murni) + Task 7 (efek mount) + Task 6 (`&cl=` per-id) |
| Project detail: panel → pintu | Task 8 |
| Docs tersentuh diperbarui dalam commit yang sama | Task 9 |
| Batasan "jangan duplikasi logika git tag" | Tak satu pun task menyentuh `services/changelog/**` |
| Verifikasi ber-skop + smoke endpoint | Task 10 |

**Placeholder scan:** tak ada "TBD"/"TODO"/"tangani error dengan pantas"; setiap step yang mengubah
kode memuat kodenya utuh.

**Type consistency:** `changelogMatches(row, q)` dipakai persis begitu di Task 2.
`onGenerated?: (v: ChangelogView) => void` dideklarasikan di Task 5 dan dipanggil dengan
`(c) => {...}` di Task 6. `initialChangelogId?: string | null` dideklarasikan Task 6 dan dikirim
dari App (Task 7) sebagai `openChangelogId` bertipe `string | null`. `onGotoChangelog: () => void`
(wajib) dideklarasikan Task 8 dan dikirim dari App di task yang sama. `HN_NAV: NavItem[]` diekspor
Task 7 dan dibaca test di task yang sama.
