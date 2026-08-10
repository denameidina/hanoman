# SPEC-647 — Pagination di portal klien (daftar backlog & tiket) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daftar backlog dan daftar tiket di portal klien mengambil & merender **satu halaman**
per kali, dengan `Pager` design system yang sama dengan dashboard operator.

**Architecture:** Sisi server sudah beramplop `Paginated` dan sudah membaca `page`/`limit`
(`server/src/routes/portal.ts:44`, `:62`) — yang ditambahkan hanyalah **sisi klien**:
`src/src/api/portal.ts` mengirim `page` **dan** `limit` sebagai satu argumen tak-terpisah, dan
`src/src/portal/ClientPortal.tsx` menyimpan `{items,total}` + nomor halaman per daftar, merender
`Pager`, serta mengembalikan halaman ke 1 saat project/tab berganti. Satu perubahan server:
`GET /portal/projects` ikut memakai `paginate()` supaya seluruh namespace portal satu amplop.

**Tech Stack:** React 18 + TypeScript (Vite) · Fastify + Prisma/SQLite · vitest + @testing-library/react

## Global Constraints

- **Kirim `page` DAN `limit`, selalu berpasangan.** `limit` tanpa `page` bukan halaman melainkan
  **plafon** — jebakan terukur SPEC-523 (changelog: item ke-11 permanen tak terjangkau).
- **Seluruh pemanggilan portal tetap lewat `src/src/api/portal.ts`** (ADR-0110): tak ada endpoint
  operator yang boleh terjangkau dari layar klien.
- **Tanpa endpoint baru, tanpa kontrak baru, tanpa migration, tanpa ADR baru.** ADR-0107
  diterapkan; ADR-0110/0111 ditegakkan (scope project 404 dari server; tepat satu route tulis).
- **Paginator = `Pager` dari `src/src/ds`** + `serverPage()`. Tak ada tombol ad-hoc.
- **Ukuran halaman `PORTAL_PAGE = 20`** (cermin `TICKET_PAGE` `TriageScreen`, SPEC-523).
- **Angka di tab wajib `total`, bukan `items.length`** — lencana yang mengecil saat halaman 2
  dibuka adalah kebohongan (ADR-0107).
- Design system portal: editorial, bone paper, brass accent; tetap enak di layar sempit.
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama**.
- Test dijalankan hanya untuk berkas yang tersentuh:
  `env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest run --no-file-parallelism <path…>`
  (`env -u NODE_ENV` wajib untuk test web — `NODE_ENV=production` di shell membuat RTL `act` gagal;
  `TEST_DATABASE_URL` wajib untuk test server — DB test dibagi antar-worktree, SPEC-479.)

---

### Task 1: Server — `GET /portal/projects` beramplop `paginate()`

**Files:**
- Modify: `server/src/routes/portal.ts:38-42`
- Test: `server/test/portal.route.test.ts:45-50` (ubah ekspektasi), `:105-112` (ubah ekspektasi),
  `:151-155` (ubah ekspektasi), + test baru

**Interfaces:**
- Consumes: `paginate` (sudah diimpor di berkas itu), `toPortalProject` (`@hanoman/shared`).
- Produces: `GET /api/portal/projects[?page=&limit=]` → `{ items: PortalProject[], total, page, pageSize }`.
  Tanpa query: seluruh baris (`pageSize === total`) — dipakai pemilih project di UI.

- [ ] **Step 1: Ubah tiga ekspektasi lama + tambah test amplop yang gagal**

Di `server/test/portal.route.test.ts`, ganti tiga assertion `toEqual({ items: … })` menjadi
`toMatchObject` supaya field amplop tambahan tak membuatnya merah, lalu tambahkan satu test baru.

Ekspektasi lama yang diubah (persis tiga tempat):

```ts
    // "daftar project hanya yang ditugaskan"
    expect(r.json()).toMatchObject({ items: [{ id: "p1", name: "P1" }], total: 1 });
```

```ts
    // "klien tanpa keterikatan tak melihat apa pun"
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).json())
      .toMatchObject({ items: [], total: 0 });
```

```ts
    // "admin memakai portal → daftar mengikuti akses miliknya sendiri (kosong)"
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).json())
      .toMatchObject({ items: [], total: 0 });
```

Test baru, ditaruh tepat sesudah "daftar project hanya yang ditugaskan":

```ts
  // SPEC-647 · ADR-0107 · satu amplop untuk SELURUH daftar portal. Pemilih project di UI sengaja
  // tetap meminta daftar penuh (project terpilih tak boleh jatuh dari halaman), tapi kontraknya
  // memakai pola paginate() yang sama — bukan pola sendiri.
  it("daftar project beramplop Paginated dan menghormati page/limit", async () => {
    const { cookie } = await seed();
    await prisma.project.create({ data: { id: "p3", name: "P3", desc: "", kind: "existing" } });
    const u = await prisma.user.findFirstOrThrow({ where: { email: "klien@x.co" } });
    await prisma.clientProjectAccess.create({ data: { userId: u.id, projectId: "p3" } });

    const full = await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } });
    expect(full.json()).toMatchObject({ total: 2, page: 1, pageSize: 2 });
    expect(full.json().items.map((p: { id: string }) => p.id)).toEqual(["p1", "p3"]);

    const page2 = await app.inject({ method: "GET", url: "/api/portal/projects?page=2&limit=1", headers: { cookie } });
    expect(page2.json()).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page2.json().items.map((p: { id: string }) => p.id)).toEqual(["p3"]);
  });
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest run --no-file-parallelism server/test/portal.route.test.ts
```

Expected: FAIL — test baru merah karena respons tak punya `total`/`page`/`pageSize`.

- [ ] **Step 3: Implementasi minimal**

`server/src/routes/portal.ts`, ganti handler `GET /portal/projects`:

```ts
  // SPEC-647 · ADR-0107 · amplop yang SAMA dengan daftar portal lain. Tanpa query ia membalas
  // seluruh baris (`paginate` memakai pageSize = total), karena ini PEMILIH project, bukan daftar
  // yang ditelusuri: project terpilih yang jatuh dari halaman justru mematahkan syarat
  // "perpindahan halaman mempertahankan project terpilih".
  app.get("/portal/projects", async (req) => {
    const ids = await clientProjectIds(req.user!.id);
    const { page, limit } = req.query as { page?: string; limit?: string };
    const rows = await prisma.project.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
    return paginate(rows.map(toPortalProject), page, limit);
  });
```

- [ ] **Step 4: Jalankan test — harus lulus**

```bash
env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest run --no-file-parallelism server/test/portal.route.test.ts
```

Expected: PASS (semua test di berkas itu).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/portal.ts server/test/portal.route.test.ts
git commit -m "feat(spec-647): amplop Paginated untuk daftar project portal"
```

---

### Task 2: Server — bukti pemenggalan halaman backlog & tiket portal

Kontraknya sudah ada di kode; yang belum ada adalah **buktinya**. Task ini tak mengubah
`server/src`: ia mengunci perilaku `page`/`limit` supaya tak bisa hilang diam-diam.

**Files:**
- Test: `server/test/portal.route.test.ts` (tambah dua test + perluas `seed()`)

**Interfaces:**
- Consumes: `GET /api/portal/projects/:id/backlog?page=&limit=`,
  `GET /api/portal/projects/:id/tickets?page=&limit=` → `Paginated<…>`.
- Produces: —

- [ ] **Step 1: Tambah baris ekstra di `seed()` lalu tulis dua test yang gagal**

Di dalam `seed()`, tepat sesudah `SPEC-2` dibuat, tambahkan tiga spec + dua tiket lagi di `p1`
supaya ada cukup baris untuk dipenggal (`SPEC-1` sudah ada → total 4 spec & 3 tiket di `p1`):

```ts
  // SPEC-647 · baris tambahan supaya paginasi benar-benar punya sesuatu untuk dipenggal.
  for (const n of [3, 4, 5])
    await prisma.spec.create({ data: {
      id: `SPEC-${n}`, projectId: "p1", title: `Punya klien ${n}`, source: "brief", stage: "planned",
      priority: "sedang", author: "op@internal.co", objective: "hasil" } });
  for (const n of [2, 3])
    await prisma.ticket.create({ data: {
      id: `t1${n}`, projectId: "p1", number: n + 1, category: "bug", title: `Tombol mati ${n}`,
      detail: "repro", reporterEmail: "pelapor@luar.co", status: "new", accessKeyHash: `h1${n}` } });
```

Lalu perbaiki dua ekspektasi lama yang menghitung `total` di `p1` (keduanya kini bukan 1):

```ts
    // "backlog project sendiri: hanya field yang diizinkan"
    expect(body.total).toBe(4);
```

```ts
    // "tiket project sendiri: tanpa email pelapor, status kosakata publik"
    expect(body.total).toBe(3);
    expect(Object.keys(body.items[0]).sort()).toEqual([...PORTAL_TICKET_KEYS].sort());
```

> Catatan: test tiket lama meng-assert `body.items[0].status === "Sedang dikerjakan"` untuk tiket
> `t1` (spec tertaut `executing`). `orderBy createdAt desc` pada baris yang dibuat dalam
> milidetik yang sama tidak menjamin urutan, jadi ubah assertion itu menjadi pencarian by-id:
>
> ```ts
>     expect(body.items.find((t: { id: string }) => t.id === "t1").status).toBe("Sedang dikerjakan");
> ```

Dua test baru:

```ts
  // SPEC-647 · ADR-0107 · yang diuji adalah PEMENGGALANNYA, bukan kehadiran parameter: satu
  // halaman berisi `limit` baris, `total` tetap seluruh baris, halaman terakhir tak penuh, dan
  // halaman di luar batas kosong TANPA galat (halaman kosong bukan 404).
  it("backlog portal dipenggal per halaman, total tetap seluruh baris", async () => {
    const { cookie } = await seed();
    const at = async (qs: string) => (await app.inject({
      method: "GET", url: `/api/portal/projects/p1/backlog${qs}`, headers: { cookie } })).json();

    const p1 = await at("?page=1&limit=2");
    expect(p1).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(p1.items).toHaveLength(2);

    const p2 = await at("?page=2&limit=2");
    expect(p2.items).toHaveLength(2);
    // Halaman 2 bukan ulangan halaman 1 — inilah yang membuktikan `page` dipakai.
    expect(p2.items.map((s: { id: string }) => s.id)).not.toEqual(p1.items.map((s: { id: string }) => s.id));

    const p3 = await at("?page=3&limit=3");
    expect(p3.items).toHaveLength(1);          // 4 baris, halaman terakhir tak penuh

    const jauh = await at("?page=9&limit=2");
    expect(jauh.items).toEqual([]);
    expect(jauh.total).toBe(4);
  });

  it("tiket portal dipenggal per halaman", async () => {
    const { cookie } = await seed();
    const at = async (qs: string) => (await app.inject({
      method: "GET", url: `/api/portal/projects/p1/tickets${qs}`, headers: { cookie } })).json();

    const p1 = await at("?page=1&limit=2");
    expect(p1).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(p1.items).toHaveLength(2);

    const p2 = await at("?page=2&limit=2");
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0].id).not.toBe(p1.items[0].id);

    expect((await at("?page=9&limit=2")).items).toEqual([]);
  });
```

- [ ] **Step 2: Jalankan test**

```bash
env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest run --no-file-parallelism server/test/portal.route.test.ts
```

Expected: PASS seluruh berkas. Kalau ada yang merah, itu ekspektasi `total` lama yang belum
disesuaikan dengan baris seed tambahan — perbaiki angkanya, jangan mengurangi seed-nya.

- [ ] **Step 3: Commit**

```bash
git add server/test/portal.route.test.ts
git commit -m "test(spec-647): kunci pemenggalan halaman backlog & tiket portal"
```

---

### Task 3: Klien — `api/portal.ts` mengirim `page` dan `limit` yang tak bisa dipisah

**Files:**
- Modify: `src/src/api/portal.ts:14-18`
- Test: `src/test/portal-api-page.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type PortalPage = { page: number; limit: number };
  portalApi.listProjects(): Promise<Paginated<PortalProject>>
  portalApi.listBacklog(id: string, pg: PortalPage): Promise<Paginated<PortalSpec>>
  portalApi.listTickets(id: string, pg: PortalPage): Promise<Paginated<PortalTicket>>
  ```
  `listProjects` **tanpa** argumen halaman (pemilih project meminta daftar penuh).

- [ ] **Step 1: Tulis test yang gagal**

Create `src/test/portal-api-page.test.ts`:

```ts
/* SPEC-647 · ADR-0107 · `limit` TANPA `page` bukan halaman melainkan PLAFON — jebakan terukur
   SPEC-523 (changelog: item ke-11 permanen tak terjangkau). Yang diuji di sini adalah URL yang
   BENAR-BENAR dikirim: satu argumen `{page,limit}` membuat "limit sendirian" tak bisa lahir. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { portalApi } from "../src/api/portal";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const urlOf = () => String(fetchMock.mock.calls[0][0]);

describe("portalApi paginasi (SPEC-647)", () => {
  it("listBacklog mengirim page dan limit sekaligus", async () => {
    await portalApi.listBacklog("p1", { page: 3, limit: 20 });
    expect(urlOf()).toBe("/api/portal/projects/p1/backlog?page=3&limit=20");
  });

  it("listTickets mengirim page dan limit sekaligus", async () => {
    await portalApi.listTickets("p1", { page: 2, limit: 20 });
    expect(urlOf()).toBe("/api/portal/projects/p1/tickets?page=2&limit=20");
  });

  it("tak ada bentuk panggilan yang mengirim limit tanpa page", async () => {
    await portalApi.listBacklog("p1", { page: 1, limit: 20 });
    const u = urlOf();
    expect(u).toContain("limit=");
    expect(u).toContain("page=");
  });

  it("id project di-encode (klien tak boleh bisa menyusun path sendiri)", async () => {
    await portalApi.listTickets("p 1/x", { page: 1, limit: 20 });
    expect(urlOf()).toBe("/api/portal/projects/p%201%2Fx/tickets?page=1&limit=20");
  });

  // Pemilih project sengaja TANPA halaman — lihat design doc D8.
  it("listProjects tetap meminta daftar penuh", async () => {
    await portalApi.listProjects();
    expect(urlOf()).toBe("/api/portal/projects");
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/portal-api-page.test.ts
```

Expected: FAIL — URL yang terkirim masih `/api/portal/projects/p1/backlog` tanpa query
(dan TypeScript menolak argumen kedua).

- [ ] **Step 3: Implementasi minimal**

`src/src/api/portal.ts`, tepat di bawah `const p = …`:

```ts
// SPEC-647 · ADR-0107 · satu argumen, dua parameter. `limit` TANPA `page` bukan halaman melainkan
// PLAFON (jebakan terukur SPEC-523), jadi bentuknya sengaja tak bisa dikirim setengah.
export type PortalPage = { page: number; limit: number };
const q = ({ page, limit }: PortalPage) => `?page=${page}&limit=${limit}`;
```

lalu ganti dua entri daftar:

```ts
  listBacklog: (id: string, pg: PortalPage) => get<Paginated<PortalSpec>>(`${p(id)}/backlog${q(pg)}`),
  listTickets: (id: string, pg: PortalPage) => get<Paginated<PortalTicket>>(`${p(id)}/tickets${q(pg)}`),
```

dan `listProjects` ikut beramplop (Task 1):

```ts
  listProjects: () => get<Paginated<PortalProject>>("/api/portal/projects"),
```

- [ ] **Step 4: Jalankan test — harus lulus**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/portal-api-page.test.ts
```

Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add src/src/api/portal.ts src/test/portal-api-page.test.ts
git commit -m "feat(spec-647): api portal mengirim page+limit sebagai satu argumen"
```

---

### Task 4: Klien — `ClientPortal` merender satu halaman + `Pager`

**Files:**
- Modify: `src/src/portal/ClientPortal.tsx`
- Test: `src/test/client-portal.test.tsx` (perbarui mock + tambah blok test paginasi)

**Interfaces:**
- Consumes: `PortalPage` (Task 3), `Pager` + `serverPage` dari `../ds`.
- Produces: `data-testid="portal-list"` tetap ada (dipakai `portal-scroll.test.tsx`).

- [ ] **Step 1: Perbarui mock yang sudah ada supaya beramplop halaman**

`src/test/client-portal.test.tsx` — mock `listProjects` kini mengembalikan amplop, dan
`listBacklog`/`listTickets` mengembalikan `total` yang benar (halaman 1 dari 1):

```ts
  (portalApi.listProjects as any).mockResolvedValue({
    items: [{ id: "p1", name: "Toko Mekar" }], total: 1, page: 1, pageSize: 1 });
```

Ekspektasi lain di berkas itu tak berubah.

- [ ] **Step 2: Tulis test paginasi yang gagal**

Tambahkan di akhir `src/test/client-portal.test.tsx`, sebagai `describe` sendiri:

```ts
/* SPEC-647 · ADR-0107 · yang dibuktikan di sini adalah PEMENGGALANNYA: jumlah baris yang tampil
   dan query yang dikirim per klik halaman. Nol test render adalah cara bug ini lolos pertama
   kali (portal memanggil endpoint berhalaman tanpa satu pun parameter). */
describe("ClientPortal paginasi (SPEC-647)", () => {
  const PAGE = 20;
  const TOTAL = 25;
  const specOf = (n: number) => ({
    id: `SPEC-${n}`, title: `Pekerjaan ${n}`, priority: "sedang", stage: "planned",
    objective: "x", createdAt: "2026-08-01T00:00:00Z", startedAt: null, doneAt: null });
  const ticketOf = (n: number) => ({
    id: `t${n}`, number: n, category: "bug", title: `Keluhan ${n}`,
    status: "Sedang ditinjau", createdAt: "2026-08-01T00:00:00Z" });

  // Server memenggal; mock ini meniru pemenggalan itu supaya baris yang tampil per halaman
  // benar-benar berbeda — dengan mock yang selalu mengembalikan isi yang sama, test paginasi
  // tak bisa membedakan "halaman pindah" dari "tak terjadi apa-apa".
  const slice = <T,>(make: (n: number) => T, page: number) =>
    Array.from({ length: TOTAL }, (_, i) => make(i + 1)).slice((page - 1) * PAGE, page * PAGE);

  beforeEach(() => {
    (portalApi.listBacklog as any).mockImplementation(async (_id: string, pg: { page: number; limit: number }) =>
      ({ items: slice(specOf, pg.page), total: TOTAL, page: pg.page, pageSize: pg.limit }));
    (portalApi.listTickets as any).mockImplementation(async (_id: string, pg: { page: number; limit: number }) =>
      ({ items: slice(ticketOf, pg.page), total: TOTAL, page: pg.page, pageSize: pg.limit }));
  });

  const rows = () => within(screen.getByTestId("portal-list")).getAllByRole("button");

  it("hanya satu halaman yang dirender, dengan page+limit terkirim", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Pekerjaan 1");
    expect(rows()).toHaveLength(PAGE);                 // 20 baris, bukan 25
    expect(screen.queryByText("Pekerjaan 21")).toBeNull();
    expect(portalApi.listBacklog).toHaveBeenCalledWith("p1", { page: 1, limit: PAGE });
  });

  it("klik halaman 2 memuat halaman 2 dan menggantinya di layar", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Pekerjaan 1");
    fireEvent.click(screen.getByRole("button", { name: "Halaman 2" }));
    expect(await screen.findByText("Pekerjaan 21")).toBeTruthy();
    expect(portalApi.listBacklog).toHaveBeenLastCalledWith("p1", { page: 2, limit: PAGE });
    expect(rows()).toHaveLength(TOTAL - PAGE);         // halaman terakhir: 5 baris
    expect(screen.queryByText("Pekerjaan 1")).toBeNull();
    // Tab & project tak bergeser — perpindahan halaman mempertahankan konteks lain.
    expect(screen.getByRole("tab", { name: /pekerjaan/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("halaman terakhir tak menyisakan tombol Berikutnya yang aktif", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Pekerjaan 1");
    expect((screen.getByRole("button", { name: "Sebelumnya" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Halaman 2" }));
    await screen.findByText("Pekerjaan 21");
    expect((screen.getByRole("button", { name: "Berikutnya" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("angka di tab adalah TOTAL, bukan jumlah baris satu halaman", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Pekerjaan 1");
    const tab = screen.getByRole("tab", { name: /pekerjaan/i });
    expect(tab.textContent).toContain(String(TOTAL));
    fireEvent.click(screen.getByRole("button", { name: "Halaman 2" }));
    await screen.findByText("Pekerjaan 21");
    expect(screen.getByRole("tab", { name: /pekerjaan/i }).textContent).toContain(String(TOTAL));
  });

  it("ganti tab kembali ke halaman 1", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Pekerjaan 1");
    fireEvent.click(screen.getByRole("button", { name: "Halaman 2" }));
    await screen.findByText("Pekerjaan 21");
    fireEvent.click(screen.getByRole("tab", { name: /help desk/i }));
    expect(await screen.findByText("Keluhan 1")).toBeTruthy();
    await waitFor(() => expect(portalApi.listBacklog).toHaveBeenLastCalledWith("p1", { page: 1, limit: PAGE }));
  });

  it("ganti project kembali ke halaman 1", async () => {
    (portalApi.listProjects as any).mockResolvedValue({
      items: [{ id: "p1", name: "Toko Mekar" }, { id: "p3", name: "Warung Sari" }],
      total: 2, page: 1, pageSize: 2 });
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Pekerjaan 1");
    fireEvent.click(screen.getByRole("button", { name: "Halaman 2" }));
    await screen.findByText("Pekerjaan 21");
    fireEvent.click(screen.getByRole("button", { name: "Warung Sari" }));
    await waitFor(() => expect(portalApi.listBacklog).toHaveBeenLastCalledWith("p3", { page: 1, limit: PAGE }));
  });

  it("daftar kosong tak menampilkan kontrol halaman", async () => {
    (portalApi.listBacklog as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: PAGE });
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    expect(await screen.findByText(/belum ada pekerjaan/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Berikutnya" })).toBeNull();
  });

  // Tiket baru duduk paling atas (createdAt desc). Memuat ulang di halaman yang sedang aktif
  // membuat tiket yang baru dikirim tak terlihat — regresi yang lahir bersama paginasi.
  it("kirim keluhan mengembalikan daftar tiket ke halaman 1", async () => {
    (portalApi.createTicket as any).mockResolvedValue(ticketOf(99));
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Pekerjaan 1");
    fireEvent.click(screen.getByRole("tab", { name: /help desk/i }));
    await screen.findByText("Keluhan 1");
    fireEvent.click(screen.getByRole("button", { name: "Halaman 2" }));
    await screen.findByText("Keluhan 21");

    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Struk tak keluar" } });
    fireEvent.change(screen.getByLabelText("Detail"), { target: { value: "Setelah bayar, struk kosong" } });
    fireEvent.click(screen.getByRole("button", { name: /^kirim$/i }));

    await waitFor(() => expect(portalApi.listTickets).toHaveBeenLastCalledWith("p1", { page: 1, limit: PAGE }));
    expect(await screen.findByText("Keluhan 1")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Jalankan test — harus gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/client-portal.test.tsx
```

Expected: FAIL — `listBacklog` dipanggil tanpa argumen halaman, 25 baris dirender, tak ada
tombol "Halaman 2".

- [ ] **Step 4: Implementasi di `ClientPortal.tsx`**

(a) impor `Pager` + `serverPage` dari `../ds`, dan tipe `Paginated` dari shared:

```tsx
import type { Paginated, PortalProject, PortalSpec, PortalTicket, PortalTicketDetail, UserView } from "@hanoman/shared";
import {
  Button, Card, FIXED_ROW_STYLE, LIST_SCROLL_STYLE, Modal, Pager, serverPage, StateBlock,
  StatusPill, Tabs,
} from "../ds";
```

(b) tambahkan konstanta + tipe halaman tepat di bawah `STAGE_LABEL`:

```tsx
// SPEC-647 · ADR-0107 · ukuran halaman portal, cermin `TICKET_PAGE` TriageScreen (SPEC-523).
const PORTAL_PAGE = 20;

const EMPTY: Paginated<never> = { items: [], total: 0, page: 1, pageSize: PORTAL_PAGE };

/* Pager DS, satu bentuk untuk kedua daftar. `total` datang dari amplop server — bukan
   `items.length`, yang sesudah paginasi hanya menjawab "berapa baris yang kebetulan tampil". */
function PortalPager({ total, page, onPage, unit }:
  { total: number; page: number; onPage: (n: number) => void; unit: string }) {
  const sp = serverPage(total, page, PORTAL_PAGE);
  return (
    <div style={{ marginTop: 14, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />
    </div>
  );
}
```

(c) ganti state daftar + pemuatnya:

```tsx
  const [backlog, setBacklog] = React.useState<Paginated<PortalSpec>>(EMPTY);
  const [tickets, setTickets] = React.useState<Paginated<PortalTicket>>(EMPTY);
  // Satu nomor halaman per daftar: satu nomor bersama akan meminta halaman yang tak dimiliki
  // daftar tetangga, dan tab yang baru dibuka sempat merender keadaan kosong palsu.
  const [bPage, setBPage] = React.useState(1);
  const [tPage, setTPage] = React.useState(1);
  const [reload, setReload] = React.useState(0);
```

```tsx
  // Respons yang datang terlambat tak boleh menimpa halaman yang lebih baru: klik halaman
  // beruntun melahirkan dua permintaan yang tak dijamin selesai berurutan.
  const seqRef = React.useRef(0);
  const loadLists = React.useCallback((id: string, bp: number, tp: number) => {
    const seq = ++seqRef.current;
    // Kedua daftar dimuat bersama karena angka di tab wajib `total` — lencana yang mengecil
    // saat klien membuka halaman 2 adalah kebohongan (ADR-0107).
    void Promise.all([
      portalApi.listBacklog(id, { page: bp, limit: PORTAL_PAGE }),
      portalApi.listTickets(id, { page: tp, limit: PORTAL_PAGE }),
    ])
      .then(([b, t]) => { if (seq === seqRef.current) { setBacklog(b); setTickets(t); } })
      .catch(() => { if (seq === seqRef.current) { setBacklog(EMPTY); setTickets(EMPTY); } });
  }, []);

  React.useEffect(() => { if (active) loadLists(active, bPage, tPage); }, [active, bPage, tPage, reload, loadLists]);
  // Ganti project atau tab = kembali ke halaman 1 (idiom TriageScreen SPEC-523): halaman 5 dari
  // konteks lama menjawab daftar konteks baru yang cuma punya 2 halaman → kosong tanpa sebab.
  React.useEffect(() => { setBPage(1); setTPage(1); }, [active, tab]);
```

`listProjects` kini beramplop, tapi call site-nya tak berubah (`r.items` tetap).

(d) tab memakai `total`:

```tsx
                <Tabs value={tab} onChange={setTab} style={{ flex: 1, minWidth: 0 }} tabs={[
                  { value: "backlog", label: "Pekerjaan", count: backlog.total },
                  { value: "tickets", label: "Help desk", count: tickets.total },
                ]} />
```

(e) kedua cabang daftar: baca `…​.items`, dan sisipkan `PortalPager` sesudah `Card`. Cabang
backlog jadi:

```tsx
              {tab === "backlog" ? (
                backlog.total === 0
                  ? <StateBlock kind="empty" icon="list-checks" title="Belum ada pekerjaan tercatat"
                      hint="Begitu tim mulai mengerjakan sesuatu di project ini, daftarnya muncul di sini." />
                  : <>
                      <Card padding={0} data-testid="portal-list">
                        {backlog.items.map((s) => (
                          <div key={s.id} role="button" tabIndex={0}
                            onClick={() => void portalApi.getSpec(active!, s.id).then(setOpenSpec)}
                            onKeyDown={(e) => { if (e.key === "Enter") void portalApi.getSpec(active!, s.id).then(setOpenSpec); }}
                            style={ROW}>
                            <span style={{ ...META, fontFamily: "var(--font-mono)", width: 92 }}>{s.id}</span>
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "var(--text-strong)" }}>{s.title}</span>
                            <StatusPill status={stagePill(s.stage)} size="sm">{STAGE_LABEL[s.stage] ?? s.stage}</StatusPill>
                            <span style={META}>{s.priority}</span>
                            <span style={META}>{tanggal(s.doneAt ?? s.startedAt ?? s.createdAt)}</span>
                          </div>
                        ))}
                      </Card>
                      <PortalPager total={backlog.total} page={bPage} onPage={setBPage} unit="pekerjaan" />
                    </>
              ) : (
```

dan cabang tiket jadi:

```tsx
                tickets.total === 0
                  ? <StateBlock kind="empty" icon="inbox" title="Belum ada tiket"
                      hint="Kirim keluhan lewat tombol Kirim keluhan di atas — atau lewat halaman Help Center project ini." />
                  : <>
                      <Card padding={0} data-testid="portal-list">
                        {tickets.items.map((t) => (
                          <div key={t.id} role="button" tabIndex={0}
                            onClick={() => void portalApi.getTicket(active!, t.id).then(setOpenTicket)}
                            onKeyDown={(e) => { if (e.key === "Enter") void portalApi.getTicket(active!, t.id).then(setOpenTicket); }}
                            style={ROW}>
                            <span style={{ ...META, fontFamily: "var(--font-mono)", width: 48 }}>#{t.number}</span>
                            <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "var(--text-strong)" }}>{t.title}</span>
                            <span style={META}>{t.category}</span>
                            <StatusPill status={ticketPill(t.status)} size="sm">{t.status}</StatusPill>
                            <span style={META}>{tanggal(t.createdAt)}</span>
                          </div>
                        ))}
                      </Card>
                      <PortalPager total={tickets.total} page={tPage} onPage={setTPage} unit="tiket" />
                    </>
              )}
```

(f) `onSent` memaksa halaman tiket ke 1; `reload` yang memicu muat ulang untuk project yang
sama supaya `setTPage(1)` + pemuatan jadi **satu** fetch:

```tsx
          onSent={(id) => {
            setComposing(false);
            setTab("tickets");
            // Tiket baru duduk paling atas (createdAt desc), jadi memuat ulang di halaman yang
            // sedang aktif akan menyembunyikan tiket yang baru saja dikirim.
            setTPage(1);
            // Dimuat ulang dari server, bukan disisipkan di klien: yang tampil adalah tiket
            // seperti yang dilihat operator, bukan tebakan bentuk baris.
            if (id === active) setReload((n) => n + 1); else setActive(id);
          }}
```

- [ ] **Step 5: Jalankan test — harus lulus**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest run src/test/client-portal.test.tsx src/test/portal-scroll.test.tsx src/test/portal-api-page.test.ts
```

Expected: PASS ketiganya. `portal-scroll.test.tsx` memakai mock yang mengembalikan 60/40 baris
tanpa melihat argumen — ia tetap hijau; kalau merah, penyebabnya rantai gulir yang berubah,
bukan paginasi (`portal-list` wajib tetap ada dan tetap di dalam `<main>`).

- [ ] **Step 6: Typecheck paket web**

```bash
env -u NODE_ENV ./node_modules/.bin/tsc -p src --noEmit
```

Expected: exit 0. (Paket web = `@hanoman/app`, `tsconfig` di `src/tsconfig.json`; `pnpm` di mesin
ini diproksi `rtk` sehingga `pnpm vitest`/`pnpm --filter` bisa gagal — pakai biner langsung.)

- [ ] **Step 7: Commit**

```bash
git add src/src/portal/ClientPortal.tsx src/test/client-portal.test.tsx
git commit -m "feat(spec-647): portal klien berhalaman dengan Pager design system"
```

---

### Task 5: Docs SoT yang tersentuh

**Files:**
- Modify: `internal/docs/architecture/api-contract.md:61`
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian "Portal klien", ±737-795)
- Modify: `internal/docs/adr/README.md` (entri ADR-0107 — catat jangkauan portal)

**Interfaces:**
- Consumes: keputusan D1–D8 di `docs/superpowers/specs/2026-08-11-portal-klien-paginasi-design.md`.

- [ ] **Step 1: `api-contract.md` — amplop daftar project portal**

Ganti baris 61 menjadi:

```
GET /portal/projects[?page=&limit=]         -> { items: [{ id, name }], total, page, pageSize }   # HANYA project yang ditugaskan
```

dan tambahkan satu baris catatan di bawah blok endpoint portal (sesudah baris `#   Proyeksi = allowlist field …`):

```
#   SPEC-647 · ADR-0107 · ketiga daftar portal beramplop `Paginated` dan menerima page+limit.
#   UI portal mengirim KEDUANYA untuk backlog & tiket (limit tanpa page = plafon, bukan halaman);
#   pemilih project sengaja meminta daftar penuh — project terpilih tak boleh jatuh dari halaman.
```

- [ ] **Step 2: `frontend-implementation.md` — paginasi portal**

Tambahkan sub-bagian baru tepat sebelum "**Kirim keluhan** (SPEC-626 · ADR-0111)":

```markdown
**Paginasi** (SPEC-647 · ADR-0107 diterapkan, tanpa ADR baru). Kedua daftar mengambil dan
merender **satu halaman** (`PORTAL_PAGE = 20`, cermin `TICKET_PAGE` triase) lewat `Pager` design
system + `serverPage()` — bukan tombol ad-hoc. Empat hal yang menentukan bentuknya:

- **`page` dan `limit` selalu berpasangan.** `api/portal.ts` menerima satu argumen
  `PortalPage = {page,limit}`; `limit` tanpa `page` bukan halaman melainkan **plafon** (jebakan
  terukur SPEC-523). Bentuk argumennya yang mencegahnya, bukan disiplin call site.
- **Angka di tab = `total` dari amplop**, bukan `items.length`. Sesudah paginasi, `items.length`
  hanya menjawab "berapa baris yang kebetulan tampil" — lencana yang mengecil saat klien membuka
  halaman 2 adalah kebohongan (ADR-0107). Itu juga satu-satunya alasan **kedua** daftar tetap
  dimuat bersama meski hanya satu yang tampak.
- **Satu nomor halaman per daftar, di-reset oleh satu effect `[active, tab]`.** Ganti project
  atau tab → halaman 1 (idiom `TriageScreen`); klik halaman **tidak** menggeser project maupun
  tab. `onSent` (kirim keluhan) memaksa halaman tiket ke 1 — tiket baru duduk paling atas
  (`createdAt desc`), jadi memuat ulang di halaman aktif akan menyembunyikan tiket yang baru
  saja dikirim. Muat ulang untuk project yang sama dipicu penghitung `reload` supaya reset
  halaman + pemuatan jadi **satu** fetch.
- **Respons basi tak menimpa halaman yang lebih baru:** `loadLists` memegang nomor urut di
  `useRef` dan hanya respons terbaru yang boleh `setState`.

`Pager` portal **tak** memakai `FIXED_ROW_STYLE`: portal hanya punya satu scroller (`<main>`,
tabel di atas) dan tak memakai rantai flex per-daftar seperti layar operator, jadi ia ikut
menggulir di ujung daftarnya. Keadaan kosong & ujung daftar bawaan DS: `Pager` mengembalikan
`null` saat `total === 0` dan men-disable Sebelumnya/Berikutnya di ujung.

**Pemilih project sengaja tanpa kontrol halaman** — dinyatakan supaya audit berikutnya tak
"memperbaikinya". `GET /portal/projects` ikut beramplop `paginate()` (pola yang sama, bukan pola
sendiri) dan UI memintanya tanpa query: ia pemilih, bukan daftar yang ditelusuri, dan project
terpilih yang jatuh dari halaman justru mematahkan syarat "perpindahan halaman mempertahankan
project terpilih".
```

Perbarui juga judul bagiannya supaya SPEC-nya ikut tercatat:

```markdown
## Portal klien — chrome sendiri, rantai gulir sendiri, warna dari fungsi murni (SPEC-617/626/647 · ADR-0110/0111)
```

- [ ] **Step 3: `adr/README.md` — catat jangkauan portal di narasi ADR-0107**

Tambahkan satu kalimat di akhir entri ADR-0107 (cari `0107` di berkas itu):

```markdown
  **SPEC-647 menerapkannya ke portal klien** (tanpa ADR baru): endpoint portal sudah beramplop
  sejak ADR-0110, yang belum ada adalah kliennya — `api/portal.ts` memanggil tanpa satu pun
  parameter sehingga `paginate()` membalas seluruh baris. Pemilih project portal adalah
  **pengecualian keempat yang dinyatakan**: beramplop, tapi tanpa kontrol halaman.
```

- [ ] **Step 4: Verifikasi integritas index docs**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || echo "cli belum dibangun — lewati, tak ada doc BARU yang ditambahkan"
```

Expected: tak ada doc baru di task ini (hanya doc yang sudah ter-link yang disunting), jadi index
`internal/docs/README.md` tak perlu entri baru.

- [ ] **Step 5: Commit**

```bash
git add internal/docs/architecture/api-contract.md internal/docs/frontend/frontend-implementation.md internal/docs/adr/README.md
git commit -m "docs(spec-647): paginasi portal klien di api-contract, frontend, narasi ADR-0107"
```

---

### Task 6: Verifikasi akhir — test yang tersentuh + endpoint nyata di local

**Files:** —

**Interfaces:**
- Consumes: seluruh perubahan Task 1–5.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest run --no-file-parallelism \
  server/test/portal.route.test.ts server/test/portal-ticket.route.test.ts \
  src/test/client-portal.test.tsx src/test/portal-scroll.test.tsx src/test/portal-api-page.test.ts
```

Expected: PASS semuanya, dan **jumlah berkas test = 5** (bukan "no test files" — `--changed`
menyalakan `passWithNoTests`, jadi nol test terlihat hijau).

- [ ] **Step 2: Typecheck dua paket yang tersentuh**

```bash
env -u NODE_ENV ./node_modules/.bin/tsc -p server --noEmit && env -u NODE_ENV ./node_modules/.bin/tsc -p src --noEmit
```

Expected: exit 0 keduanya.

- [ ] **Step 3: Boot server + curl endpoint portal yang tersentuh**

Task ini menyentuh endpoint (`GET /portal/projects`), jadi ia diuji nyata sekali di akhir. **DB
khusus + port khusus**: DB test dibagi antar-worktree dan port 8787 mungkin dipakai sesi lain.

```bash
export HANOMAN_HOME="$(mktemp -d)" PORT=8799
./node_modules/.bin/prisma migrate deploy --schema server/prisma/schema.prisma
node --import tsx server/src/server.ts &   # atau: node server/dist/server.js sesudah build
```

Sesudah port hidup, siapkan satu akun klien + akses project lewat Prisma di DB smoke itu, login,
lalu curl ketiga daftar portal dengan cookie-nya:

```bash
curl -s -c /tmp/spec647.jar -H 'content-type: application/json' \
  -d '{"email":"klien647@x.co","password":"password647"}' http://127.0.0.1:8799/api/auth/login
curl -s -b /tmp/spec647.jar "http://127.0.0.1:8799/api/portal/projects"
curl -s -b /tmp/spec647.jar "http://127.0.0.1:8799/api/portal/projects/<id>/backlog?page=2&limit=1"
curl -s -b /tmp/spec647.jar "http://127.0.0.1:8799/api/portal/projects/<id>/tickets?page=1&limit=1"
```

Expected: ketiganya `{items,total,page,pageSize}`; `backlog?page=2&limit=1` mengembalikan **satu**
baris yang **bukan** baris halaman 1, dan `total` = seluruh baris. Matikan server per-PID
(`lsof -ti:8799` → `kill <pid>`), **jangan** `pkill -f node` (SPEC-402).

- [ ] **Step 4: Centang seluruh kotak plan ini lalu commit**

```bash
git add docs/superpowers/plans/2026-08-11-portal-klien-paginasi.md
git commit -m "chore(spec-647): centang plan + catat bukti verifikasi"
```

- [ ] **Step 5: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-647
```
