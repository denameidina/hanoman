# Filter goal pada daftar backlog (SPEC-521) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daftar backlog punya tab **Goal** yang menyaring ke backlog bermode goal (ADR-0089), ditopang `GET /specs?source=goal`.

**Architecture:** `goal` sudah menjadi nilai sah `Spec.source`, dan `GET /specs?source=<s>` sudah menyaring di level DB di dalam `liveSpecs()` — **sebelum** overlay stage-live, berbeda lapis dari `q`/`stage`/`priority`/`startable`/`dateField` yang disaring `filterSpecs()` di layer response (ADR-0038). Jadi perubahan produknya satu entri tab di `BacklogScreen`; sisanya adalah test yang mengikat param `source` (hari ini nol coverage) dan docs.

**Tech Stack:** React 18 + TypeScript (Vite) · Fastify + Prisma 6/SQLite · Vitest + Testing Library.

## Global Constraints

- **Tanpa ADR baru, tanpa perubahan skema, tanpa endpoint baru, tanpa parameter query baru.** ADR-0089 (backlog goal) & ADR-0038 (filter di layer response) ditegakkan, bukan diamandemen.
- **Tidak ada perubahan kode server.** `server/src/routes/specs.ts` dan `server/src/services/live-specs.ts` **tidak disentuh** — hanya test-nya yang bertambah.
- Label tab **persis `"Goal"`** — sama dengan `SOURCE_META.goal.label` di `src/src/screens/BacklogScreen.tsx:38`. Dua nama untuk satu hal lebih mahal daripada satu assertion yang diperbaiki.
- Tab `help` **tidak** ditambahkan (di luar objective SPEC-521).
- Docs yang tersentuh diperbarui **dalam commit yang sama** (AGENTS.md aturan 2). Keduanya sudah ter-link di `internal/docs/README.md` → tak ada entri index baru.
- Verifikasi ber-scope perubahan saja (ADR-0080). Perintah test **wajib** memakai `TEST_DATABASE_URL` terisolasi (SPEC-479) dan `--no-file-parallelism`; test web **wajib** `env -u NODE_ENV` (SPEC-293).

## File Structure

| Berkas | Tanggung jawab | Aksi |
|---|---|---|
| `server/test/specs.route.test.ts` | Kontrak `GET /specs` | Modify — `describe` baru untuk param `source` |
| `internal/docs/architecture/api-contract.md` | Kontrak API (SoT) | Modify — eja lapis & nilai sah `source` |
| `src/src/screens/BacklogScreen.tsx` | Daftar backlog + baris penyaring | Modify — satu entri tab |
| `src/test/backlog-goal.test.tsx` | Perilaku item goal di backlog | Modify — mock `listSpecs`, `describe` tab, perbaiki assertion badge |
| `internal/docs/frontend/frontend-implementation.md` | Implementasi frontend (SoT) | Modify — deret tab sumber kini lima |

---

### Task 1: Kontrak param `source` di `GET /specs` (server, test-only)

Param `source` adalah satu-satunya penopang filter goal, dan `grep "source=" server/test/specs.route.test.ts` hari ini memulangkan **0 match**. Task ini mengikatnya sebelum UI bersandar padanya.

**Files:**
- Test: `server/test/specs.route.test.ts` (tambah `describe` di akhir berkas)
- Modify: `internal/docs/architecture/api-contract.md:91-95`
- **Tidak ada** berkas produksi server yang berubah.

**Interfaces:**
- Consumes: `app` (`buildApp({ requireAuth: false })`), `makeProject`, `makeSpec`, `makeTempRepo` — semuanya sudah di-import di baris 1-7 berkas test itu.
- Produces: jaminan bahwa `GET /specs?source=goal` memulangkan **hanya** item goal dengan `total` envelope ikut menyusut. Task 2 bersandar pada jaminan ini.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di **akhir** `server/test/specs.route.test.ts` (sesudah `describe("filter rentang tanggal (SPEC-408)", …)` ditutup, boleh ditaruh setelah blok terakhir berkas):

```ts
// SPEC-521 · filter goal daftar backlog = `source=goal`. Beda LAPIS dari filter lain: `source`
// disaring di DB oleh liveSpecs (`where: { projectId, source }`) SEBELUM overlay stage-live,
// sementara q/stage/priority/startable/dateField disaring filterSpecs SESUDAHNYA (ADR-0038).
// Konsekuensinya nyata: saat tab Goal aktif, overlay + write-through + notifikasi `done` berjalan
// atas himpunan goal saja. Param ini nol coverage sampai SPEC-521 — ia menopang tab Goal, jadi
// diikat di sini sebelum UI bersandar padanya.
describe("filter source (SPEC-521)", () => {
  beforeAll(async () => {
    await makeProject({ id: "psrc", repoDir: makeTempRepo({ "a.txt": "a" }) });
    await makeSpec({ id: "SPEC-G01", projectId: "psrc", source: "goal", title: "turunkan latensi",
      stage: "planned", priority: "tinggi" });
    await makeSpec({ id: "SPEC-G02", projectId: "psrc", source: "goal", title: "rapikan log",
      stage: "done", priority: "sedang" });
    await makeSpec({ id: "SPEC-B01", projectId: "psrc", source: "brief", title: "form invoice",
      stage: "planned", priority: "tinggi" });
    await makeSpec({ id: "SPEC-Q01", projectId: "psrc", source: "qa", title: "tombol mati",
      stage: "planned", priority: "tinggi" });
  });
  const ids = async (qs: string) => {
    const res = await app.inject({ url: `/api/specs?project=psrc&${qs}` });
    expect(res.statusCode).toBe(200);
    return res.json().items.map((s: any) => s.id).sort();
  };

  it("source=goal hanya memulangkan item bersumber goal", async () => {
    expect(await ids("source=goal")).toEqual(["SPEC-G01", "SPEC-G02"]);
  });

  it("total di envelope ikut menyusut, bukan hanya items", async () => {
    const all = (await app.inject({ url: "/api/specs?project=psrc" })).json();
    const goal = (await app.inject({ url: "/api/specs?project=psrc&source=goal" })).json();
    expect(all.total).toBe(4);
    expect(goal.total).toBe(2);
  });

  it("source absen memulangkan seluruh sumber (tab \"Semua spec\" tak berubah)", async () => {
    expect(await ids("")).toEqual(["SPEC-B01", "SPEC-G01", "SPEC-G02", "SPEC-Q01"]);
  });

  // Lapisnya berbeda (DB vs response layer) tapi hasilnya wajib berkomposisi: tab Goal + Select
  // stage/prioritas + kotak cari dipakai berbarengan di layar yang sama.
  it("source berkomposisi dengan filter layer-response", async () => {
    expect(await ids("source=goal&startable=true")).toEqual(["SPEC-G01"]);
    expect(await ids("source=goal&priority=tinggi")).toEqual(["SPEC-G01"]);
    expect(await ids("source=goal&q=latensi")).toEqual(["SPEC-G01"]);
    // Filter response layer TIDAK boleh bocor melewati batas source.
    expect(await ids("source=goal&q=invoice")).toEqual([]);
  });

  // Konsisten dengan stage/priority/dateField yang juga lenient (bukan 400) — nilai ngawur
  // menyaring habis, bukan melempar.
  it("source tak dikenal memulangkan himpunan kosong, bukan 400", async () => {
    const res = await app.inject({ url: "/api/specs?project=psrc&source=ngawur" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    expect(res.json().total).toBe(0);
  });
});
```

- [x] **Step 2: Jalankan test — pastikan ia benar-benar BERJALAN**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run server/test/specs.route.test.ts --no-file-parallelism -t "filter source"
```

Expected: **5 test berjalan** di bawah `filter source (SPEC-521)`. Karena param `source` sudah bekerja, seluruhnya diharap **PASS** sejak awal — ini test karakterisasi yang mengunci perilaku, bukan TDD merah-dulu.

**Gerbang yang wajib dicek:** kalau outputnya `No test files found` atau `0 passed`, test-nya **tidak berjalan** — jangan diterima sebagai hijau (jebakan `passWithNoTests`, AGENTS.md). Perbaiki path/`-t` dulu.

Kalau ada yang **gagal**, itu temuan sungguhan: `source` tidak berperilaku seperti yang diasumsikan tab Goal. Hentikan dan laporkan sebelum menyentuh UI.

- [x] **Step 3: Perbarui `internal/docs/architecture/api-contract.md`**

Di blok `GET /specs` (baris 91-95), sesudah baris yang berbunyi
`#   & paginasi diterapkan DI MEMORI SETELAH overlay — filter stage cocok ke stage LIVE, bukan DB.`,
sisipkan:

```
#   SPEC-521 · `source` beda LAPIS dari filter lain: ia disaring di DB (`liveSpecs` where) SEBELUM
#   overlay, jadi ia yang menentukan scope overlay/write-through/notifikasi — sementara sisanya
#   disaring di memori sesudahnya. Nilai sah = `zSpecSource` (brief|qa|audit|help|goal); nilai tak
#   dikenal → himpunan KOSONG (bukan 400, dan bukan "diabaikan" seperti stage/priority/dateField).
#   Pemakainya: deret tab sumber daftar backlog — Semua spec · Dari brief · Dari QA · Audit · Goal.
```

- [x] **Step 4: Jalankan lagi test yang tersentuh**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run server/test/specs.route.test.ts --no-file-parallelism
```

Expected: seluruh berkas PASS (test lama + 6 test baru). Berkas ini menyentuh DB, jadi `TEST_DATABASE_URL` terisolasi + `--no-file-parallelism` **wajib** — suite yang gagal ramai dengan 404/P2022 hampir selalu isolasi DB, bukan regresi (SPEC-479).

- [x] **Step 5: Commit**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
git add server/test/specs.route.test.ts internal/docs/architecture/api-contract.md
git commit -m "test(spec-521): kontrak param source di GET /specs (nol coverage sebelumnya)"
```

---

### Task 2: Tab "Goal" di daftar backlog

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (deret `Tabs` sumber, ±baris 782-785)
- Test: `src/test/backlog-goal.test.tsx` (mock + `describe` baru + perbaikan satu assertion)
- Modify: `internal/docs/frontend/frontend-implementation.md:99-102`

**Interfaces:**
- Consumes: jaminan Task 1 — `GET /specs?source=goal` memulangkan hanya item goal.
- Produces: state `tab` bernilai `"goal"` menyeberang sebagai `source: "goal"` ke `api.listSpecs`. Tak ada modul lain yang bersandar padanya.

**Jebakan yang wajib ditutup lebih dulu:** `src/test/backlog-goal.test.tsx` sudah memakai `await screen.findByText("Goal")` untuk **badge kartu**. Label tab baru juga `"Goal"`, jadi `findByText` akan menemukan **dua** elemen dan melempar `Found multiple elements` — test hijau berubah merah tanpa satu pun regresi produk. Preseden repo: `src/test/backlog-board.test.tsx:134` untuk "Audit". Test baru memakai `getByRole("tab", { name: "Goal" })` yang kebal tabrakan itu.

- [x] **Step 1: Tulis test yang gagal**

**1a.** Di `src/test/backlog-goal.test.tsx`, tambahkan `listSpecs` ke mock modul di baris 4-7 sehingga berbunyi:

```ts
vi.mock("../src/api/client", () => ({
  api: {
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    listSpecs: vi.fn(),
  },
  ApiError: class extends Error {},
}));
```

`vi.fn()` polos memulangkan `undefined`, dan `BacklogScreen` memanggilnya sebagai `api.listSpecs?.(…)` lalu `p?.then(…)` — optional chaining memutus rantainya, jadi test lama di berkas ini tetap membaca prop `backlog` apa adanya. Tak ada yang berubah untuk mereka.

**1b.** Tambahkan `import { api } from "../src/api/client";` di dekat `import { BacklogScreen } …` (berkas ini belum meng-import `api`).

**1c.** Tambahkan `describe` baru di **akhir** berkas:

```tsx
// SPEC-521 · filter goal = tab kelima di deret tab sumber, ditopang GET /specs?source=goal.
// Penyaringan hidup di SERVER (ADR-0038), jadi yang diuji adalah PARAM yang menyeberang —
// menghitung baris yang dirender klien hanya akan menguji mock, bukan produk.
describe("BacklogScreen · tab Goal (SPEC-521)", () => {
  const briefSpec: any = {
    id: "SPEC-1", projectId: "p1", title: "form invoice", source: "brief", stage: "planned",
    priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null, baseSha: null,
  };
  const mount = () => {
    vi.mocked(api.listSpecs).mockResolvedValue(
      { items: [briefSpec], total: 1, page: 1, pageSize: 20 } as never);
    render(<BacklogScreen backlog={[briefSpec]} projects={[{ id: "p1", name: "P1" }] as never}
      projectFilter="all" onProjectFilter={() => {}} />);
  };
  // getByRole("tab") — BUKAN getByText: badge kartu item goal berlabel "Goal" juga
  // (SOURCE_META.goal), jadi pencarian berbasis teks cocok ganda begitu ada item goal di layar.
  const tab = (name: string) => screen.getByRole("tab", { name });
  const lastCall = () => vi.mocked(api.listSpecs).mock.calls.at(-1)![0]!;

  it("tab Goal ada di deret tab sumber", () => {
    mount();
    expect(tab("Goal")).toBeTruthy();
    // Tab lama tak boleh hilang.
    expect(tab("Semua spec")).toBeTruthy();
    expect(tab("Dari brief")).toBeTruthy();
    expect(tab("Dari QA")).toBeTruthy();
    expect(tab("Audit")).toBeTruthy();
  });

  it("mengklik tab Goal mengirim source=goal ke server", async () => {
    mount();
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(lastCall().source).toBeUndefined();
    fireEvent.click(tab("Goal"));
    await waitFor(() => expect(lastCall().source).toBe("goal"));
  });

  it("kembali ke Semua spec mengirim source undefined, bukan sentinel \"all\"", async () => {
    mount();
    fireEvent.click(tab("Goal"));
    await waitFor(() => expect(lastCall().source).toBe("goal"));
    fireEvent.click(tab("Semua spec"));
    await waitFor(() => expect(lastCall().source).toBeUndefined());
  });
});
```

**1d.** Perbaiki assertion badge yang akan cocok ganda. Di `describe("BacklogScreen · item goal (SPEC-407)")`, ganti baris

```tsx
    expect(await screen.findByText("Goal")).toBeTruthy();
```

menjadi

```tsx
    // SPEC-521 · "Goal" kini muncul di tab filter DAN badge kartu → findByText cocok ganda
    // dan melempar. Pola yang sama dipakai untuk "Audit" di backlog-board.test.tsx.
    await waitFor(() => expect(screen.getAllByText("Goal").length).toBeGreaterThan(1));
```

- [x] **Step 2: Jalankan test — pastikan GAGAL karena alasan yang benar**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
env -u NODE_ENV pnpm vitest --run src/test/backlog-goal.test.tsx
```

Expected: **FAIL**. Ketiga test `tab Goal (SPEC-521)` gagal dengan `Unable to find an accessible element with the role "tab" and name "Goal"`, dan test badge SPEC-407 gagal karena `getAllByText("Goal")` baru berjumlah 1 (badge saja).

`env -u NODE_ENV` **wajib**: shell mesin ini menyetel `NODE_ENV=production`, yang membuat React membuang peringatan `act()` dan test RTL gagal massal tanpa sebab (SPEC-293).

- [x] **Step 3: Tambahkan tab Goal**

Di `src/src/screens/BacklogScreen.tsx`, pada `<Tabs variant="pill" value={tab} onChange={setTab} tabs={[…]} />` di deret tab sumber, ubah daftarnya menjadi:

```tsx
          <Tabs variant="pill" value={tab} onChange={setTab} tabs={[
            { value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" },
            { value: "qa", label: "Dari QA" }, { value: "audit", label: "Audit" },
            // SPEC-521 · ADR-0089 · backlog goal punya alur sendiri (dua fase, tanpa perencanaan),
            // jadi ia butuh pintunya sendiri — tanpa tab ini item goal hanya muncul tercampur di
            // "Semua spec". `tab` menyeberang apa adanya sebagai `source` ke GET /specs.
            { value: "goal", label: "Goal" },
          ]} />
```

Tak ada perubahan lain: `tab` sudah dikirim sebagai `source: tab === "all" ? undefined : tab`, sudah ada di dependency array efek fetch, sudah mereset `page` ke 1, dan sudah dikembalikan ke `"all"` oleh tombol **Reset filter**.

- [x] **Step 4: Jalankan test — pastikan PASS**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
env -u NODE_ENV pnpm vitest --run src/test/backlog-goal.test.tsx
```

Expected: **PASS**, seluruh test di berkas itu (7 lama + 3 baru).

- [x] **Step 5: Jalankan test backlog tetangga yang menghitung teks**

Tab baru menambah satu simpul teks di layar yang sama; berkas-berkas ini merender `BacklogScreen` dan sebagian menghitung kemunculan teks.

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
env -u NODE_ENV pnpm vitest --run \
  src/test/backlog-board.test.tsx src/test/backlog-date-filter.test.tsx \
  src/test/backlog-deeplink.test.tsx src/test/backlog-dependency.test.tsx \
  src/test/search-filter.test.tsx src/test/project-filter.test.tsx
```

Expected: **PASS** semua. Bila ada yang gagal dengan `Found multiple elements with the text: Goal`, terapkan perbaikan yang sama seperti Step 1d (`getAllByText(...).length`) — itu tabrakan label, bukan regresi produk.

- [x] **Step 6: Typecheck paket yang tersentuh**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
pnpm --filter ./src typecheck
```

Expected: exit 0, nol error. Hanya paket `src` — `pnpm -r typecheck` menyalakan satu proses tsc per paket dan mencekik sesi lain di mesin ini (ADR-0080).

- [x] **Step 7: Perbarui `internal/docs/frontend/frontend-implementation.md`**

Di bagian "Backlog: tiga mode tampilan, dan board yang tidak boleh berbohong", **sesudah** paragraf
toolbar (yang berakhir dengan kalimat `Search/stage/prioritas view-local; project tetap
App.projectFilter (SPEC-146).`) sisipkan paragraf baru:

```
Tab sumbernya lima (SPEC-521): `Semua spec · Dari brief · Dari QA · Audit · Goal`. Nilainya
menyeberang apa adanya sebagai `source` ke `GET /specs` (`all` → param di-omit), dan **Goal**
adalah backlog bermode goal — alur dua fase tanpa perencanaan (ADR-0089) yang tanpa tab ini hanya
muncul tercampur di "Semua spec". `source` disaring di DB sebelum overlay stage-live, jadi ia pula
yang menentukan scope overlay/write-through — beda lapis dari stage/prioritas/tanggal yang
disaring di layer response (ADR-0038). `help` sengaja tak bertab: item tiket sudah dinaikkan ke
brief/qa/audit oleh jalur triase (ADR-0062).
```

- [x] **Step 8: Commit**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
git add src/src/screens/BacklogScreen.tsx src/test/backlog-goal.test.tsx \
  internal/docs/frontend/frontend-implementation.md
git commit -m "feat(spec-521): tab Goal di daftar backlog (source=goal)"
```

---

### Task 3: Verifikasi endpoint nyata + centang plan

Task ini menyentuh perilaku endpoint yang menopang filter baru, jadi AGENTS.md menuntut satu smoke nyata di akhir — sekali, bukan tiap task.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-04-spec-521-filter-goal-backlog.md` (centang seluruh kotak)

- [x] **Step 1: Boot server dengan DB khusus**

DB khusus, **bukan** DB test bersama: run tetangga di mesin ini menghapus `~/.hanoman/hanoman.test.db` di tengah jalan (SPEC-479). **Port khusus juga** — 8787 hampir selalu sudah dipakai dashboard/sesi tetangga di mesin ini (terukur saat SPEC-521 dikerjakan: `lsof -ti:8787` memulangkan dua PID milik orang lain). `HANOMAN_DATABASE_URL` mendahului `DATABASE_URL` di `runner/src/paths.ts`, dan itulah yang dipakai server; `prisma` CLI sendiri membaca `DATABASE_URL` (`schema.prisma` `env("DATABASE_URL")`), jadi keduanya perlu disetel — ke berkas yang sama.

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
SMOKE_DIR=$(mktemp -d)
DATABASE_URL="file:$SMOKE_DIR/smoke.db" pnpm --filter ./server exec prisma migrate deploy
HANOMAN_DATABASE_URL="file:$SMOKE_DIR/smoke.db" HANOMAN_HOME="$SMOKE_DIR" PORT=8899 \
  pnpm --filter ./server exec tsx src/server.ts > "$SMOKE_DIR/server.log" 2>&1 &
```

Tunggu sampai server siap:

```bash
for i in $(seq 1 40); do curl -sf http://127.0.0.1:8899/api/health >/dev/null && { echo siap; break; }; sleep 1; done
```

- [x] **Step 2: Seed satu project + dua spec, lalu curl endpointnya**

`/api` digerbangi sesi cookie (ADR-0028) — tanpa cookie seluruh seed memulangkan `{"error":"unauthorized"}`. DB kosong berarti `POST /auth/setup` masih terbuka; simpan cookie-nya lalu pakai di tiap permintaan.

```bash
B=http://127.0.0.1:8899/api; J=$(mktemp)
curl -s -c $J -X POST $B/auth/setup -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","password":"SmokePass123!"}'
curl -s -b $J -X POST $B/projects -H 'content-type: application/json' \
  -d '{"id":"psmoke","name":"psmoke","desc":"smoke","kind":"existing","stack":""}'
curl -s -b $J -X POST $B/specs -H 'content-type: application/json' \
  -d '{"project":"psmoke","source":"goal","title":"turunkan latensi","priority":"sedang","payload":{"goal":"p95 < 200 ms","done":"benchmark hijau","constraints":"","priority":"sedang"}}'
curl -s -b $J -X POST $B/specs -H 'content-type: application/json' \
  -d '{"project":"psmoke","source":"brief","title":"form invoice","priority":"sedang","payload":{"context":"c","outcome":"o","constraints":"","priority":"sedang"}}'
for qs in "" "&source=goal" "&source=brief" "&source=ngawur"; do
  curl -s -b $J -o /tmp/spec521-out.json "$B/specs?project=psmoke$qs"
  echo -n "[$qs] "; python3 -c 'import json;d=json.load(open("/tmp/spec521-out.json"));print("total=",d["total"],[(i["id"],i["source"]) for i in d["items"]])'
done
```

Expected: `[]` → `total= 2`; `[&source=goal]` → `total= 1` berisi item ber-`source` `goal`; `[&source=brief]` → `total= 1` brief; `[&source=ngawur]` → `total= 0` dan `items` kosong (bukan 400).

Terukur saat SPEC-521 dikerjakan: `total=2 [('SPEC-142','brief'),('SPEC-141','goal')]` · `goal → total=1 [('SPEC-141','goal')]` · `brief → total=1 [('SPEC-142','brief')]` · `ngawur → total=0 []`.

- [x] **Step 3: Matikan server per-PID**

```bash
for p in $(lsof -ti:8899); do kill $p; done
```

**JANGAN** `pkill -f node` / `pkill -f tsx`: prompt tiap sesi hidup di ARGV proses agennya dan `pkill` mengecualikan leluhurnya sendiri, jadi yang mati selalu sesi tetangga (SPEC-402).

- [x] **Step 4: Centang seluruh kotak plan ini dan commit**

Ubah setiap `- [ ]` di berkas plan ini menjadi `- [x]`. hanoman menahan backlog di `executing` selama masih ada kotak kosong.

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-521
git add docs/superpowers/plans/2026-08-04-spec-521-filter-goal-backlog.md
git commit -m "docs(spec-521): centang plan"
```
