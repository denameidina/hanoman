# SPEC-949 — Linimasa lintas project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan mode tampilan ketiga "Lintas project" di layar Tim — satu baris ringkas per project (amplop `min(startDate)` → `max(dueDate)` plus segmen per task) yang bisa dibuka menjadi task-nya, memakai ULANG `TimelineCanvas` dari SPEC-948.

**Architecture:** Seluruhnya frontend. Aritmetika agregasi lahir sebagai fungsi murni di `team-rules.ts` (`spanGeometry` hasil refactor · `projectSpan` · `projectGroups`), lalu `TeamProjectTimeline` di `team-timeline.tsx` merakitnya menjadi `TimelineRowSpec[]` dan menyerahkannya ke `TimelineCanvas` yang sudah ada. `TeamScreen` menambah satu entri `TEAM_VIEWS`, satu cabang render, dan mematikan penyaring project selama mode ini hidup.

**Tech Stack:** React 18 + TypeScript (Vite), vitest 2.1.9 + jsdom + @testing-library/react, lucide-react 0.400.0, token DS (`--bone-*`, `--brass-*`, `--border-*`).

## Global Constraints

- **Nol perubahan skema, route, dan kontrak sync.** Tak ada kolom Prisma, tak ada endpoint, tak ada entri `SYNCED`/`FIELDS`/`PARENTS`/`BOOTSTRAP_ORDER`. Bila sebuah task terasa butuh salah satunya, plan ini salah — berhenti dan lapor.
- **`team-rules.ts` tetap nol React dan nol I/O.** Tak satu pun fungsi di dalamnya membaca jam sistem: `today` selalu argumen (ADR-0153 keputusan 1).
- **`TimelineCanvas` dipakai ULANG, tidak disalin.** Perubahan yang boleh: menambah prop **opsional** ber-default. Perubahan yang dilarang: mengubah tanda tangan lama, mem-fork komponennya, atau membuat kanvas kedua.
- **Nol dependency baru.** Tak ada library chart, tak ada library tanggal.
- **Aritmetika & label UTC di kedua sisi** — `dateInputToIso` menulis `T12:00:00.000Z`.
- **Nol nilai hex baru.** Warna, radius, dan bayangan dari token DS.
- **`OverviewScreen.tsx` tidak disentuh sama sekali.**
- **Setiap `<button>` baru di dalam kanvas WAJIB menyatakan `minHeight` inline.** `app.css` menaikkan setiap `button` ke `min-height: var(--touch-target)` (44 px) di `pointer: coarse` dan di bawah 768 px; tombol 44 px di baris 34 px meluber menimpa baris berikutnya, dan jsdom tak memuat stylesheet sehingga **nol test akan merah**.
- **Nama ikon lucide wajib diverifikasi ada** sebelum dipakai (SPEC-906: nama salah jatuh ke `Circle` tanpa satu pun galat). Sudah diverifikasi untuk plan ini: `layers` → `Layers` ✓, `chevron-right` → `ChevronRight` ✓, `chevron-down` → `ChevronDown` ✓ di lucide 0.400.0.
- **Perintah test:** `pnpm --filter ./src exec vitest run test/<berkas>` dijalankan dari root worktree. Baseline sebelum plan ini: `team-rules.test.ts` 49 · `team-timeline.test.tsx` 16 · `team-screen.test.tsx` 22 = **87 lulus**.
- **Docs yang tersentuh diperbarui dalam commit yang sama** dan ditautkan di `internal/docs/README.md` (AGENTS.md aturan 2).

---

### Task 1: `spanGeometry` + `projectSpan` — aritmetika agregasi

`barGeometry(task, window)` hari ini mengunci `taskSpan` di dalamnya, jadi rentang yang **bukan** milik satu task tak punya jalan menuju persen. Task ini memisahkannya tanpa mengubah tanda tangan lama, lalu menambahkan agregasi yang diminta objective.

**Files:**
- Modify: `src/src/screens/team-rules.ts` (fungsi `barGeometry` di sekitar baris 269–288; tambahan di ekor berkas)
- Test: `src/test/team-rules.test.ts`

**Interfaces:**
- Consumes: `TaskSpan`, `TimelineWindow`, `BarGeometry`, `taskSpan` — semuanya sudah ada di `team-rules.ts`.
- Produces:
  ```ts
  export function spanGeometry(span: TaskSpan, window: TimelineWindow): BarGeometry | null;
  export function projectSpan(tasks: Pick<TaskView, "startDate" | "dueDate">[]): TaskSpan | null;
  // barGeometry mempertahankan tanda tangannya PERSIS:
  export function barGeometry(
    task: Pick<TaskView, "startDate" | "dueDate">, window: TimelineWindow,
  ): BarGeometry | null;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di ekor `src/test/team-rules.test.ts`. Blok impor di baris 3–7 bertambah `spanGeometry, projectSpan` (tulis ulang blok itu dengan dua nama tambahan; jangan menambah statement impor kedua dari modul yang sama).

```ts
describe("spanGeometry", () => {
  const win = timelineWindow([], "day", at("2026-09-10"));

  it("menerima rentang yang TIDAK berasal dari satu task", () => {
    // Rentang buatan: 2026-09-10 s/d 2026-09-12 eksklusif. Inilah yang tak bisa dilakukan
    // `barGeometry` — ia hanya menerima task, dan rentang project tak punya `startDate`.
    const g = spanGeometry({ start: at("2026-09-10"), end: at("2026-09-12"), invalid: false }, win)!;
    expect(g).not.toBeNull();
    expect(g.left).toBeGreaterThanOrEqual(0);
    expect(g.left + g.width).toBeLessThanOrEqual(100);
  });

  it("barGeometry adalah spanGeometry(taskSpan(task)) — bukan rumus kedua", () => {
    const t = task({ startDate: iso("2026-09-11"), dueDate: iso("2026-09-14") });
    expect(barGeometry(t, win)).toEqual(spanGeometry(taskSpan(t)!, win));
  });
});

describe("projectSpan", () => {
  it("null untuk daftar kosong — nol batang, jadi nol lebar dan nol NaN", () => {
    expect(projectSpan([])).toBeNull();
  });

  it("null bila TIDAK SATU PUN task punya tanggal sah", () => {
    expect(projectSpan([task(), task({ id: "t2" })])).toBeNull();
    expect(projectSpan([task({ startDate: "besok" })])).toBeNull();
  });

  it("min dari mulai, max dari akhir", () => {
    const s = projectSpan([
      task({ startDate: iso("2026-09-10"), dueDate: iso("2026-09-12") }),
      task({ id: "t2", startDate: iso("2026-09-08"), dueDate: iso("2026-09-09") }),
    ])!;
    expect(s.start).toBe(at("2026-09-08"));
    expect(s.end).toBe(at("2026-09-13"));   // akhir INKLUSIF: 12 Sep + 1 hari
  });

  it("satu task saja identik dengan taskSpan-nya — akhir inklusif tidak ditambahkan DUA kali", () => {
    const t = task({ startDate: iso("2026-09-10"), dueDate: iso("2026-09-10") });
    expect(projectSpan([t])).toEqual(taskSpan(t));
  });

  it("task tanpa tanggal DIABAIKAN, bukan membatalkan rentangnya", () => {
    const s = projectSpan([task({ startDate: iso("2026-09-10") }), task({ id: "t2" })])!;
    expect(s.start).toBe(at("2026-09-10"));
    expect(s.end).toBe(at("2026-09-11"));
  });

  it("tanggal tak sah tak mencemari min/max", () => {
    const s = projectSpan([
      task({ startDate: iso("2026-09-10") }),
      task({ id: "t2", startDate: "besok", dueDate: "kemarin" }),
    ])!;
    expect(Number.isFinite(s.start)).toBe(true);
    expect(Number.isFinite(s.end)).toBe(true);
    expect(s.start).toBe(at("2026-09-10"));
  });

  it("satu task terbalik menular ke invalid project — barisnya harus mengaku", () => {
    const s = projectSpan([
      task({ startDate: iso("2026-09-10"), dueDate: iso("2026-09-12") }),
      task({ id: "t2", startDate: iso("2026-09-20"), dueDate: iso("2026-09-15") }),
    ])!;
    expect(s.invalid).toBe(true);
    // Rentangnya tetap rentang yang SEBENARNYA, tidak ditukar.
    expect(s.start).toBe(at("2026-09-10"));
    expect(s.end).toBe(at("2026-09-21"));
  });

  it("seluruhnya sah → invalid false", () => {
    expect(projectSpan([task({ startDate: iso("2026-09-10"), dueDate: iso("2026-09-12") })])!.invalid)
      .toBe(false);
  });
});
```

Berkas ini belum punya helper `at`/`iso`. Tambahkan tepat di bawah factory `task` (sekitar baris 14):

```ts
const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (d: string) => `${d}T12:00:00.000Z`;
```

Bila `at`/`iso` ternyata SUDAH ada di berkas itu, jangan menambahkan salinan kedua — pakai yang ada.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./src exec vitest run test/team-rules.test.ts`
Expected: FAIL — `spanGeometry is not a function` / `projectSpan is not a function` (atau galat impor dari `team-rules`).

- [ ] **Step 3: Implementasi minimal**

Di `src/src/screens/team-rules.ts`, **ganti** badan `barGeometry` (baris ~269–288) dengan pasangan berikut. Seluruh komentar `barGeometry` yang menjelaskan clamping, irisan setengah terbuka, dan lebar piksel **ikut pindah** ke `spanGeometry` — itu tempat aturannya sekarang hidup:

```ts
/**
 * Rentang menjadi `{left%, width%}` dengan clamping di kedua tepi jendela.
 *
 * Menerima `TaskSpan`, bukan task: rentang sebuah PROJECT (`projectSpan`) tak punya `startDate`,
 * dan sebelum pemisahan ini satu-satunya jalan menuju persen mensyaratkan satu task.
 *
 * `null` berarti **tak ada batang di jendela ini** — rentangnya tak beririsan sama sekali.
 *
 * `clippedStart`/`clippedEnd` menyala saat rentang aslinya melewati tepi. Batang terpotong yang
 * tak mengaku terpotong berbohong tentang tenggat.
 *
 * Lebar PIKSEL minimum sengaja **tidak** ada di sini — itu urusan CSS. Memaksa lebar minimum ke
 * dalam persen membuat batang satu hari di zoom bulan tampak lebih panjang dari waktunya, dan itu
 * kebohongan yang sama jenisnya.
 */
export function spanGeometry(span: TaskSpan, window: TimelineWindow): BarGeometry | null {
  const total = window.to - window.from;
  if (total <= 0) return null;
  // Irisan SETENGAH TERBUKA: rentang yang berakhir tepat di tepi kiri tak beririsan. Tanpa aturan
  // ini, task yang berakhir kemarin muncul sebagai garis rambut selebar nol di tepi kiri.
  if (span.end <= window.from || span.start >= window.to) return null;
  const left = Math.max(span.start, window.from);
  const right = Math.min(span.end, window.to);
  return {
    left: ((left - window.from) / total) * 100,
    width: ((right - left) / total) * 100,
    clippedStart: span.start < window.from,
    clippedEnd: span.end > window.to,
    invalid: span.invalid,
  };
}

/** Tanggal sebuah task menjadi geometri. `null` juga untuk task tanpa tanggal — pemanggil yang
    membedakannya dari "di luar jendela" lewat `taskSpan`, jadi tak ada informasi yang hilang. */
export function barGeometry(
  task: Pick<TaskView, "startDate" | "dueDate">, window: TimelineWindow,
): BarGeometry | null {
  const span = taskSpan(task);
  return span ? spanGeometry(span, window) : null;
}
```

Lalu tambahkan `projectSpan` **tepat di bawah** `barGeometry`:

```ts
/**
 * Rentang gabungan sebuah project: `min` dari mulai, `max` dari akhir seluruh task-nya.
 *
 * `null` bila **tak satu pun** task punya tanggal sah — termasuk daftar kosong. Ini satu-satunya
 * pintu yang menutup batasan objective "project tanpa task bertanggal tak boleh menghasilkan
 * batang selebar nol atau NaN": baris tanpa rentang tak punya jalan menuju `NaN%`.
 *
 * Akhir tetap inklusif karena `taskSpan` SUDAH menambahkan satu hari (ADR-0153) — menambahkannya
 * lagi di sini membuat setiap project satu hari lebih panjang dari task-nya.
 *
 * `invalid` menular dari task mana pun yang tenggatnya mendahului mulainya. Artinya di baris
 * project adalah "berisi rentang yang tak sah", bukan "tenggat project mendahului mulainya" — yang
 * mustahil, `min <= max` selalu. Nada galat itulah yang membuat operator membuka barisnya dan
 * menemukan kartunya; tanpa itu tanggal terbalik hanya bisa ditemukan dengan membuka semua baris.
 */
export function projectSpan(
  tasks: Pick<TaskView, "startDate" | "dueDate">[],
): TaskSpan | null {
  let start = Infinity;
  let end = -Infinity;
  let invalid = false;
  for (const t of tasks) {
    const s = taskSpan(t);
    if (!s) continue;
    if (s.start < start) start = s.start;
    if (s.end > end) end = s.end;
    if (s.invalid) invalid = true;
  }
  return start === Infinity ? null : { start, end, invalid };
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./src exec vitest run test/team-rules.test.ts`
Expected: PASS. Jumlahnya **≥ 58** (49 baseline + 9 baru). Seluruh 49 test lama — termasuk blok `barGeometry` — harus lulus **tanpa disentuh**; itulah bukti langkah ini pemisahan, bukan penulisan ulang. Bila ada test `barGeometry` lama yang merah, jangan menyesuaikan test-nya: `spanGeometry` yang salah.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/team-rules.ts src/test/team-rules.test.ts
git commit -m "feat(949): spanGeometry + projectSpan sebagai fungsi murni

barGeometry dipisah jadi spanGeometry(span, window) supaya rentang yang
bukan milik satu task punya jalan menuju persen. projectSpan mengembalikan
null saat tak satu pun task bertanggal — pintu yang menutup batang selebar
nol dan NaN.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `projectGroups` — pembagian ember dan urutan baris

**Files:**
- Modify: `src/src/screens/team-rules.ts` (tambahan di ekor)
- Test: `src/test/team-rules.test.ts`

**Interfaces:**
- Consumes: `projectSpan`, `spanGeometry`, `taskSpan` (Task 1); `TaskSpan`, `TimelineWindow`, `BarGeometry`, `TaskView`.
- Produces:
  ```ts
  export type ProjectGroup = {
    projectId: string | null;
    span: TaskSpan | null;
    geometry: BarGeometry | null;
    tasks: TaskView[];
  };
  export function projectGroups(
    tasks: TaskView[], window: TimelineWindow, name: (projectId: string | null) => string,
  ): ProjectGroup[];
  ```

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di ekor `src/test/team-rules.test.ts`; tambahkan `projectGroups` ke blok impor yang sudah ada.

```ts
describe("projectGroups", () => {
  const TODAY = at("2026-09-10");
  const win = (tasks: TaskView[], zoom: "day" | "week" | "month" = "day") =>
    timelineWindow(tasks.map(taskSpan).filter((s): s is NonNullable<typeof s> => s !== null),
      zoom, TODAY);
  // Nama sengaja BERLAWANAN urutan dengan id: yang menguji bahwa seri dipecah oleh NAMA,
  // bukan oleh id yang kebetulan cuid.
  const name = (id: string | null) =>
    id === null ? "Tanpa project" : ({ pa: "Zeta", pb: "Alfa" } as Record<string, string>)[id] ?? id;

  it("invarian: tiap task muncul TEPAT SEKALI, dan tak ada ember keempat", () => {
    const tasks = [
      task({ id: "a", projectId: "pa", startDate: iso("2026-09-10") }),
      task({ id: "b", projectId: "pb" }),
      task({ id: "c", projectId: null, startDate: iso("2026-09-11") }),
      task({ id: "d", projectId: "pa" }),
    ];
    const gs = projectGroups(tasks, win(tasks), name);
    const ids = gs.flatMap((g) => g.tasks.map((t) => t.id)).sort();
    expect(ids).toEqual(["a", "b", "c", "d"]);
    expect(gs.reduce((n, g) => n + g.tasks.length, 0)).toBe(tasks.length);
  });

  it("task tanpa project menjadi grup ber-projectId null", () => {
    const tasks = [task({ id: "c", projectId: null, startDate: iso("2026-09-11") })];
    const gs = projectGroups(tasks, win(tasks), name);
    expect(gs).toHaveLength(1);
    expect(gs[0]!.projectId).toBeNull();
    expect(gs[0]!.geometry).not.toBeNull();
  });

  it("project yang seluruh task-nya tanpa tanggal: span null, geometry null, baris tetap ada", () => {
    const tasks = [task({ id: "a", projectId: "pa" }), task({ id: "b", projectId: "pa" })];
    const gs = projectGroups(tasks, win(tasks), name);
    expect(gs).toHaveLength(1);
    expect(gs[0]!.span).toBeNull();
    expect(gs[0]!.geometry).toBeNull();
    expect(gs[0]!.tasks).toHaveLength(2);
  });

  it("urutan berjenjang: terlihat → di luar jendela → tanpa jadwal", () => {
    const tasks = [
      task({ id: "n", projectId: "pn" }),                                  // tanpa jadwal
      task({ id: "f", projectId: "pf", startDate: iso("2031-01-01") }),    // jauh di luar plafon
      task({ id: "v", projectId: "pv", startDate: iso("2026-09-11") }),    // terlihat
    ];
    const gs = projectGroups(tasks, win(tasks), (id) => id ?? "Tanpa project");
    expect(gs.map((g) => g.projectId)).toEqual(["pv", "pf", "pn"]);
    expect(gs[0]!.geometry).not.toBeNull();
    expect(gs[1]!.geometry).toBeNull();
    expect(gs[1]!.span).not.toBeNull();   // punya rentang, tapi di luar jendela
    expect(gs[2]!.span).toBeNull();
  });

  it("dalam satu jenjang, mulai paling awal lebih dulu", () => {
    const tasks = [
      task({ id: "a", projectId: "pa", startDate: iso("2026-09-14") }),
      task({ id: "b", projectId: "pb", startDate: iso("2026-09-11") }),
    ];
    expect(projectGroups(tasks, win(tasks), name).map((g) => g.projectId)).toEqual(["pb", "pa"]);
  });

  it("seri dipecah oleh NAMA, bukan id", () => {
    // Keduanya tanpa jadwal → jenjang yang sama, tak ada span untuk dibandingkan.
    // name(pa)="Zeta", name(pb)="Alfa" → pb lebih dulu meski id-nya belakangan.
    const tasks = [task({ id: "a", projectId: "pa" }), task({ id: "b", projectId: "pb" })];
    expect(projectGroups(tasks, win(tasks), name).map((g) => g.projectId)).toEqual(["pb", "pa"]);
  });

  it("stabil terhadap urutan masukan — empat langganan mendarat kapan saja", () => {
    const tasks = [
      task({ id: "a", projectId: "pa", startDate: iso("2026-09-14") }),
      task({ id: "b", projectId: "pb", startDate: iso("2026-09-11") }),
      task({ id: "c", projectId: null }),
    ];
    const w = win(tasks);
    const forward = projectGroups(tasks, w, name).map((g) => g.projectId);
    const backward = projectGroups([...tasks].reverse(), w, name).map((g) => g.projectId);
    expect(backward).toEqual(forward);
  });

  it("di dalam grup: bertanggal lebih dulu (mulai paling awal), tak bertanggal di ekor", () => {
    const tasks = [
      task({ id: "kosong", projectId: "pa", title: "Kosong" }),
      task({ id: "akhir", projectId: "pa", title: "Akhir", startDate: iso("2026-09-14") }),
      task({ id: "awal", projectId: "pa", title: "Awal", startDate: iso("2026-09-11") }),
    ];
    const gs = projectGroups(tasks, win(tasks), name);
    expect(gs[0]!.tasks.map((t) => t.id)).toEqual(["awal", "akhir", "kosong"]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./src exec vitest run test/team-rules.test.ts`
Expected: FAIL — `projectGroups is not a function`.

- [ ] **Step 3: Implementasi minimal**

Tambahkan di ekor `src/src/screens/team-rules.ts`:

```ts
/* ── SPEC-949 · agregasi lintas project ───────────────────────────────────────────────────────── */

export type ProjectGroup = {
  /** `null` = "Tanpa project" — tugas internal tim (ADR-0150). */
  projectId: string | null;
  span: TaskSpan | null;
  /** `null` = tak ada amplop: `span` null, atau `span` di luar jendela. Bedanya dibaca dari `span`. */
  geometry: BarGeometry | null;
  /** Bertanggal lebih dulu (mulai paling awal), tak bertanggal di ekor. */
  tasks: TaskView[];
};

/** Urutan DI DALAM grup dan di antara grup memakai pemecah seri yang sama, supaya dua permukaan
    tak bisa menyusun daftar yang sama dengan urutan berbeda. */
const byTitleThenId = (a: TaskView, b: TaskView): number =>
  a.title.localeCompare(b.title, "id") || a.id.localeCompare(b.id);

/**
 * Satu-satunya tempat task dibagi per project, jadi tak ada task yang bisa jatuh keluar — invarian
 * "tiap id muncul tepat sekali" diuji langsung, cermin `timelineRows`.
 *
 * `name` adalah ARGUMEN, bukan impor: `team-rules.ts` tak boleh tahu apa itu `ProjectVM`, dan urutan
 * baris yang tak bertanggal harus mengikuti nama yang dilihat operator — bukan `id` yang kebetulan
 * cuid. Fungsinya tetap murni; pemanggil yang merakit resolvernya.
 *
 * Urutannya berjenjang: yang TERLIHAT di kanvas naik ke atas, karena baris tanpa batang tak punya
 * apa pun untuk dibandingkan di sumbu waktu dan mendorongnya ke bawah menjaga bagian atas kanvas
 * tetap padat.
 */
export function projectGroups(
  tasks: TaskView[], window: TimelineWindow, name: (projectId: string | null) => string,
): ProjectGroup[] {
  const buckets = new Map<string, { projectId: string | null; tasks: TaskView[] }>();
  for (const t of tasks) {
    // Kunci Map dipisah dari `projectId` karena `null` dan string `"null"` adalah dua project
    // berbeda; menyatukannya lewat `String(projectId)` menggabungkan keduanya diam-diam.
    const key = t.projectId ?? " none";
    const hit = buckets.get(key);
    if (hit) hit.tasks.push(t);
    else buckets.set(key, { projectId: t.projectId, tasks: [t] });
  }

  const groups: ProjectGroup[] = [...buckets.values()].map(({ projectId, tasks: ts }) => {
    const span = projectSpan(ts);
    const dated: { task: TaskView; start: number }[] = [];
    const undated: TaskView[] = [];
    for (const t of ts) {
      const s = taskSpan(t);
      if (s) dated.push({ task: t, start: s.start });
      else undated.push(t);
    }
    // Diurutkan oleh `span.start`, BUKAN `geometry.left`: batang yang terpotong di kiri semuanya
    // ber-`left` 0 dan urutannya akan runtuh jadi urutan kedatangan (pelajaran `timelineRows`).
    dated.sort((a, b) => a.start - b.start || byTitleThenId(a.task, b.task));
    undated.sort(byTitleThenId);
    return {
      projectId, span,
      geometry: span ? spanGeometry(span, window) : null,
      tasks: [...dated.map((d) => d.task), ...undated],
    };
  });

  const rank = (g: ProjectGroup): number => (g.geometry ? 0 : g.span ? 1 : 2);
  // `null` (Tanpa project) terakhir di antara yang seri — nilainya bukan id, jadi ia tak punya
  // tempat alami di urutan string.
  const idKey = (g: ProjectGroup): [number, string] => (g.projectId === null ? [1, ""] : [0, g.projectId]);
  groups.sort((a, b) => {
    const [an, ai] = idKey(a);
    const [bn, bi] = idKey(b);
    return rank(a) - rank(b)
      || (a.span && b.span ? a.span.start - b.span.start : 0)
      || name(a.projectId).localeCompare(name(b.projectId), "id")
      || an - bn
      || ai.localeCompare(bi);
  });
  return groups;
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./src exec vitest run test/team-rules.test.ts`
Expected: PASS, **≥ 66** test (58 sesudah Task 1 + 8 baru).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/team-rules.ts src/test/team-rules.test.ts
git commit -m "feat(949): projectGroups — pembagian ember & urutan baris lintas project

Satu tempat task dibagi per project (invarian tiap id tepat sekali).
Urutan berjenjang terlihat → di luar jendela → tanpa jadwal; seri dipecah
oleh NAMA yang dilihat operator, jadi resolvernya masuk sebagai argumen
dan team-rules tetap tak tahu apa itu ProjectVM.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `TeamProjectTimeline` — kanvas dipakai ulang

**Files:**
- Modify: `src/src/screens/team-timeline.tsx` (`TONE` baris ~36–40; `TimelineCanvas` baris ~90–175; tambahan komponen di ekor)
- Create: `src/test/team-projects.test.tsx`

**Interfaces:**
- Consumes: `projectGroups`, `projectSpan`, `spanGeometry`, `taskSpan`, `timelineWindow`, `taskDates` (Task 1–2 + yang sudah ada); `TimelineCanvas`, `TimelineRowSpec`, `TimelineBarSpec`.
- Produces:
  ```ts
  // Prop TAMBAHAN pada TimelineCanvas — keduanya opsional, pemanggil SPEC-948 tak berubah:
  //   testId?: string     default "team-timeline"
  //   labelHead?: string  default "Tugas"
  // Nada baru pada TimelineBarSpec["tone"]: "envelope"
  export function TeamProjectTimeline(props: {
    tasks: TaskView[];
    projects: { id: string; name: string }[];
    members: MemberView[];
    zoom: TimelineZoom;
    today: number;
    hidden: number;
    expanded: string[];
    onToggle: (projectId: string) => void;
    onOpen: (t: TaskView) => void;
  }): JSX.Element;
  ```
  Kunci baris & batang (dipakai test dan Task 4): baris project `p:<projectId>` / `p:__none__`; amplop `span:<projectId>` / `span:__none__`; segmen `seg:<taskId>`; baris anak `t:<taskId>` dengan batang `t:<taskId>`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/team-projects.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { MemberView, TaskView } from "@hanoman/shared";
import { TeamProjectTimeline } from "../src/screens/team-timeline";
import { projectSpan, spanGeometry, taskSpan, timelineWindow } from "../src/screens/team-rules";

const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const iso = (d: string) => `${d}T12:00:00.000Z`;
const TODAY = at("2026-09-10");

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p1", title: "Desain", detail: null, status: "doing",
  priority: "sedang", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: iso("2026-08-25"), updatedAt: iso("2026-08-25"),
  ...over,
});
const members: MemberView[] = [{
  id: "dena@x.id", name: "Dena", email: "dena@x.id", role: null, active: true,
  createdAt: iso("2026-08-25"), updatedAt: iso("2026-08-25"),
}];
const projects = [{ id: "p1", name: "Project Satu" }, { id: "p2", name: "Project Dua" }];

const view = (tasks: TaskView[], over: Partial<Parameters<typeof TeamProjectTimeline>[0]> = {}) => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  const r = render(<TeamProjectTimeline tasks={tasks} projects={projects} members={members}
    zoom="day" today={TODAY} hidden={0} expanded={[]} onToggle={onToggle} onOpen={onOpen} {...over} />);
  return { onOpen, onToggle, rerender: r.rerender, unmount: r.unmount };
};
const win = (tasks: TaskView[]) =>
  timelineWindow(tasks.map(taskSpan).filter((s): s is NonNullable<typeof s> => s !== null),
    "day", TODAY);

describe("TeamProjectTimeline · baris per project", () => {
  it("kanvasnya punya testid SENDIRI — mode lain tak boleh berbagi permukaan", () => {
    view([task({ startDate: iso("2026-09-11") })]);
    expect(screen.getByTestId("team-projects")).toBeInTheDocument();
    expect(screen.queryByTestId("team-timeline")).toBeNull();
  });

  it("satu baris per project, plus baris Tanpa project", () => {
    view([
      task({ id: "a", projectId: "p1", startDate: iso("2026-09-11") }),
      task({ id: "b", projectId: "p2", startDate: iso("2026-09-12") }),
      task({ id: "c", projectId: null, startDate: iso("2026-09-13") }),
    ]);
    expect(screen.getByTestId("timeline-row-p:p1")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-row-p:p2")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-row-p:__none__")).toBeInTheDocument();
    expect(screen.getByText(/Tanpa project/)).toBeInTheDocument();
    expect(screen.getByText(/Project Satu/)).toBeInTheDocument();
  });

  it("amplop memakai persen yang SAMA dengan spanGeometry(projectSpan(...))", () => {
    const tasks = [
      task({ id: "a", startDate: iso("2026-09-11"), dueDate: iso("2026-09-12") }),
      task({ id: "b", startDate: iso("2026-09-14"), dueDate: iso("2026-09-15") }),
    ];
    view(tasks);
    const g = spanGeometry(projectSpan(tasks)!, win(tasks))!;
    const env = screen.getByTestId("timeline-bar-span:p1");
    expect(env.style.left).toBe(`${g.left}%`);
    expect(env.style.width).toBe(`${g.width}%`);
  });

  it("amplop dilukis SEBELUM segmen, dan ada satu segmen per task bertanggal", () => {
    const tasks = [
      task({ id: "a", startDate: iso("2026-09-11") }),
      task({ id: "b", startDate: iso("2026-09-14") }),
      task({ id: "kosong" }),
    ];
    view(tasks);
    const row = screen.getByTestId("timeline-row-p:p1");
    const bars = [...row.querySelectorAll("[data-testid^='timeline-bar-']")]
      .map((el) => el.getAttribute("data-testid"));
    // Urutan DOM = urutan lukis: amplop harus di indeks 0, kalau tidak ia menutupi segmennya.
    expect(bars).toEqual(["timeline-bar-span:p1", "timeline-bar-seg:a", "timeline-bar-seg:b"]);
  });

  it("project tanpa satu pun task bertanggal: baris ada, NOL batang, nol NaN", () => {
    view([task({ id: "a", projectId: "p1" }), task({ id: "b", projectId: "p1" })]);
    const row = screen.getByTestId("timeline-row-p:p1");
    expect(row).toBeInTheDocument();
    expect(row.querySelectorAll("[data-testid^='timeline-bar-']")).toHaveLength(0);
    expect(row.innerHTML).not.toMatch(/NaN/);
    expect(screen.getByText(/belum dijadwalkan/i)).toBeInTheDocument();
  });

  it("project bertanggal di luar jendela berplafon: baris ada, nol batang, meta menyebut sebabnya", () => {
    view([
      task({ id: "dekat", projectId: "p1", startDate: iso("2026-09-11") }),
      task({ id: "jauh", projectId: "p2", startDate: iso("2031-01-01") }),
    ]);
    const row = screen.getByTestId("timeline-row-p:p2");
    expect(row.querySelectorAll("[data-testid^='timeline-bar-']")).toHaveLength(0);
    expect(screen.getByText(/di luar jendela/i)).toBeInTheDocument();
  });
});

describe("TeamProjectTimeline · buka baris", () => {
  const tasks = () => [
    task({ id: "a", projectId: "p1", title: "Awal", startDate: iso("2026-09-11") }),
    task({ id: "kosong", projectId: "p1", title: "Kosong" }),
  ];

  it("tertutup: tak ada baris anak", () => {
    view(tasks());
    expect(screen.queryByTestId("timeline-row-t:a")).toBeNull();
  });

  it("klik tombol buka memanggil onToggle dengan project yang benar", () => {
    const { onToggle } = view(tasks());
    fireEvent.click(screen.getByTestId("expand-p1"));
    expect(onToggle).toHaveBeenCalledWith("p1");
  });

  it("baris Tanpa project memakai kunci sentinel, bukan string \"null\"", () => {
    const { onToggle } = view([task({ id: "c", projectId: null, startDate: iso("2026-09-11") })]);
    fireEvent.click(screen.getByTestId("expand-__none__"));
    expect(onToggle).toHaveBeenCalledWith("__none__");
  });

  it("dibuka: baris anak muncul, dan JENDELA tidak bergeser", () => {
    const t = tasks();
    const { unmount } = view(t);
    const tutup = screen.getAllByTestId("timeline-tick").length;
    unmount();
    view(t, { expanded: ["p1"] });
    expect(screen.getByTestId("timeline-row-t:a")).toBeInTheDocument();
    // Task tanpa tanggal tetap punya BARIS (di situlah operator melihatnya), tanpa batang.
    const kosong = screen.getByTestId("timeline-row-t:kosong");
    expect(kosong.querySelectorAll("[data-testid^='timeline-bar-']")).toHaveLength(0);
    expect(screen.getAllByTestId("timeline-tick").length).toBe(tutup);
  });

  it("klik segmen membuka task yang benar", () => {
    const { onOpen } = view(tasks());
    fireEvent.click(screen.getByTestId("timeline-bar-seg:a"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0].id).toBe("a");
  });

  it("tanggal terbalik: amplop project ikut bernada galat", () => {
    view([task({ id: "x", projectId: "p1", startDate: iso("2026-09-20"), dueDate: iso("2026-09-15") })]);
    expect(screen.getByTestId("timeline-bar-span:p1").dataset.invalid).toBe("true");
  });

  it("projectId yang tak ada di daftar tetap punya baris, label jatuh ke id mentah", () => {
    view([task({ id: "a", projectId: "phantom", startDate: iso("2026-09-11") })]);
    expect(screen.getByTestId("timeline-row-p:phantom")).toBeInTheDocument();
    expect(screen.getByText(/phantom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./src exec vitest run test/team-projects.test.tsx`
Expected: FAIL — `TeamProjectTimeline is not a function` / gagal impor.

- [ ] **Step 3a: Tambahkan nada `envelope` dan dua prop ke kanvas**

Di `src/src/screens/team-timeline.tsx`, ganti konstanta `TONE` (baris ~36–40):

```tsx
const TONE: Record<TimelineBarSpec["tone"], { bg: string; border: string }> = {
  brass: { bg: "var(--brass-300)", border: "var(--brass-500)" },
  err: { bg: "var(--status-err-tint)", border: "var(--status-err)" },
  muted: { bg: "var(--bone-300)", border: "var(--border-strong)" },
  // SPEC-949 · amplop rentang project. Harus lebih resesif dari `muted`, yang sudah dipakai task
  // berstatus `done`: amplop yang sewarna dengan task selesai membuat dua hal berbeda tampak sama.
  envelope: { bg: "var(--bone-200)", border: "var(--border-hair)" },
};
```

dan lebarkan tipenya (baris ~24):

```tsx
  tone: "brass" | "err" | "muted" | "envelope";
```

Ganti tanda tangan `TimelineCanvas` (baris ~90–92) menjadi:

```tsx
export function TimelineCanvas({ window: win, rows, today, emptyHint, testId, labelHead }: {
  window: TimelineWindow; rows: TimelineRowSpec[]; today: number; emptyHint?: string;
  /* SPEC-949 · `data-testid` kanvas. Mode Lintas project memakai komponen yang SAMA, dan cermin
     `TEAM_VIEWS` ↔ cabang render di `team-screen.test.tsx` menuntut "tak ada dua mode yang berbagi
     permukaan" — tanpa testid sendiri ia lolos cermin itu sambil melanggar apa yang dijaganya. */
  testId?: string;
  labelHead?: string;
}) {
```

Ganti `data-testid="team-timeline"` (baris ~109) menjadi `data-testid={testId ?? "team-timeline"}`, dan teks header `Tugas` (baris ~125) menjadi `{labelHead ?? "Tugas"}`.

- [ ] **Step 3b: Tulis `TeamProjectTimeline` di ekor `team-timeline.tsx`**

Tambahkan `barGeometry` dan `projectGroups` ke blok impor dari `./team-rules` di baris 4–7 (tulis ulang blok itu; jangan menambah statement impor kedua dari modul yang sama). `taskDates`, `taskSpan`, `timelineWindow`, `TaskSpan`, `BarGeometry`, `TimelineWindow`, dan `TimelineZoom` sudah ada di sana — jangan menduplikasinya. Lalu tambahkan di ekor berkas:

```tsx
/* ── mode lintas project (SPEC-949) ─────────────────────────────────────────────────────────────
   Baris ringkas per project menjawab pertanyaan yang mode Linimasa TIDAK jawab: project mana yang
   jadwalnya bertabrakan. Amplop `projectSpan` sendirian berbohong tentang okupansi — project ber-
   task di Januari dan Desember menggambar batang selebar setahun dan tampak bertabrakan dengan
   segalanya — jadi tiap baris membawa amplop DAN satu segmen per task. Itulah pemakaian `bars`
   jamak yang sudah disiapkan `TimelineCanvas`. */

const NONE_KEY = "__none__";
const CHILD_INDENT = 16;

const taskTone = (t: TaskView, g: BarGeometry): TimelineBarSpec["tone"] =>
  g.invalid ? "err" : t.status === "done" ? "muted" : "brass";

const barTitle = (t: TaskView, g: BarGeometry, dates: string | null): string => [
  t.title, dates,
  g.invalid ? "tenggat mendahului mulai" : null,
  g.clippedStart || g.clippedEnd ? "melewati tepi jendela" : null,
].filter(Boolean).join(" · ");

function ExpandLabel({ testId, open, name, count, onClick }: {
  testId: string; open: boolean; name: string; count: number; onClick: () => void;
}) {
  return (
    /* `data-testid` sendiri, bukan `getByRole("button", { name })`: amplop project juga sebuah
       `button` dan `aria-label`-nya memuat nama project yang sama, jadi query berbasis nama
       cocok DUA elemen dan test gagal karena ambiguitas, bukan karena kode. */
    <button type="button" onClick={onClick} data-testid={testId}
      aria-expanded={open}
      style={{
        display: "flex", alignItems: "center", gap: 5, width: "100%", padding: 0,
        background: "none", border: "none", cursor: "pointer", textAlign: "left",
        // WAJIB inline: `app.css` menaikkan setiap `button` ke `min-height: var(--touch-target)`
        // (44 px) di `pointer: coarse` dan di bawah 768 px. Tombol 44 px di baris 34 px meluber
        // menimpa baris berikutnya, dan jsdom tak memuat stylesheet — nol test akan merah.
        minHeight: 0,
        fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: "var(--weight-medium)",
        color: "var(--text-strong)",
      }}>
      <Icon name={open ? "chevron-down" : "chevron-right"} size={12} color="var(--text-subtle)" />
      <span style={{ ...ELLIPSIS, flex: 1 }}>{name}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-subtle)" }}>
        {count}
      </span>
    </button>
  );
}

export function TeamProjectTimeline({
  tasks, projects, members, zoom, today, hidden, expanded, onToggle, onOpen,
}: {
  tasks: TaskView[];
  /** Disempitkan ke `{ id, name }`: kanvas tak butuh sisa `ProjectVM`, dan tanda tangan yang
      menyebut lebih dari yang dipakai mengundang ketergantungan yang tak disadari. */
  projects: { id: string; name: string }[];
  members: MemberView[];
  zoom: TimelineZoom; today: number;
  /** Selisih `total` vs yang termuat, akibat plafon 200/kolom (ADR-0151). */
  hidden: number;
  expanded: string[];
  onToggle: (projectId: string) => void;
  onOpen: (t: TaskView) => void;
}) {
  // Jendela dihitung dari SELURUH task yang termuat, bukan dari baris yang terlihat: kalau tidak,
  // membuka satu project menggeser sumbu dan seluruh baris lain ikut bergerak — persis saat
  // operator sedang membandingkan dua di antaranya.
  const win = React.useMemo(() => {
    const spans = tasks.map(taskSpan).filter((s): s is TaskSpan => s !== null);
    return timelineWindow(spans, zoom, today);
  }, [tasks, zoom, today]);

  const nameOf = React.useCallback((projectId: string | null): string => {
    if (projectId === null) return "Tanpa project";
    // Project bisa lenyap dari daftar sebelum kartunya menyusul (frame sync mendahului). Id mentah
    // lebih jujur daripada baris yang hilang — cermin "belum ditugaskan" di kartu papan.
    return projects.find((p) => p.id === projectId)?.name ?? projectId;
  }, [projects]);

  const groups = React.useMemo(
    () => projectGroups(tasks, win, nameOf), [tasks, win, nameOf]);

  const open = React.useMemo(() => new Set(expanded), [expanded]);

  const rows = React.useMemo<TimelineRowSpec[]>(() => {
    const out: TimelineRowSpec[] = [];
    for (const g of groups) {
      const key = g.projectId ?? NONE_KEY;
      const isOpen = open.has(key);
      const label = nameOf(g.projectId);
      const meta = g.geometry
        ? (g.span ? taskDates({ startDate: new Date(g.span.start).toISOString(),
            dueDate: new Date(g.span.end - 1).toISOString() }) : null)
        : g.span ? "di luar jendela · pilih zoom yang lebih lebar"
          : "belum dijadwalkan";

      const bars: TimelineBarSpec[] = [];
      if (g.geometry) {
        bars.push({
          key: `span:${key}`, geometry: g.geometry,
          tone: g.geometry.invalid ? "err" : "envelope",
          title: `${label} · ${meta ?? ""}`.trim(),
          onClick: () => onToggle(key),
        });
        // Segmen tetap dirender saat baris DIBUKA: baris ringkas yang berubah arti tergantung
        // apakah ia sedang dibuka lebih sulit dibaca daripada sedikit pengulangan.
        for (const t of g.tasks) {
          const geometry = barGeometry(t, win);
          if (!geometry) continue;
          bars.push({
            key: `seg:${t.id}`, geometry, tone: taskTone(t, geometry),
            title: barTitle(t, geometry, taskDates(t)), onClick: () => onOpen(t),
          });
        }
      }

      out.push({
        key: `p:${key}`, meta, bars,
        label: <ExpandLabel testId={`expand-${key}`} open={isOpen} name={label}
          count={g.tasks.length} onClick={() => onToggle(key)} />,
      });

      if (!isOpen) continue;
      for (const t of g.tasks) {
        const geometry = barGeometry(t, win);
        const assignee = members.find((m) => m.id === t.memberId)?.name ?? "belum ditugaskan";
        const dates = taskDates(t);
        out.push({
          key: `t:${t.id}`,
          label: <span style={{ ...ELLIPSIS, display: "block", paddingLeft: CHILD_INDENT }}>
            {t.title}
          </span>,
          meta: dates ? `${assignee} · ${dates}` : assignee,
          bars: geometry
            ? [{
                key: `t:${t.id}`, geometry, tone: taskTone(t, geometry),
                title: barTitle(t, geometry, dates), onClick: () => onOpen(t),
              }]
            : [],
        });
      }
    }
    return out;
  }, [groups, open, nameOf, win, members, onToggle, onOpen]);

  return (
    <>
      <TimelineCanvas window={win} rows={rows} today={today}
        testId="team-projects" labelHead="Project"
        emptyHint="Belum ada project bertanggal — isi mulai atau tenggat di kartunya." />
      {hidden > 0 && (
        <div data-testid="projects-truncated" style={{
          ...FIXED_ROW_STYLE, marginTop: 8, fontSize: "var(--text-xs)", color: "var(--amber-600)",
        }}>
          {hidden} tugas tak termuat karena plafon 200 per kolom — persempit penyaring
        </div>
      )}
    </>
  );
}
```

Catatan implementasi: `meta` untuk baris yang terlihat memanggil `taskDates` dengan `span.end - 1` karena `end` **eksklusif** (`taskSpan` menambahkan satu hari) — mengirim `end` apa adanya membuat setiap project berakhir sehari lebih lambat dari task terakhirnya.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./src exec vitest run test/team-projects.test.tsx test/team-timeline.test.tsx`
Expected: PASS. `team-projects.test.tsx` **13 lulus**, dan `team-timeline.test.tsx` tetap **16 lulus tanpa disentuh** — itulah bukti prop barunya opsional dan `TimelineCanvas` tidak di-fork.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/team-timeline.tsx src/test/team-projects.test.tsx
git commit -m "feat(949): TeamProjectTimeline memakai ULANG TimelineCanvas

Amplop projectSpan + satu segmen per task di baris yang sama (bars jamak
yang memang disiapkan SPEC-948). Kanvas bertambah dua prop OPSIONAL —
testId supaya cermin TEAM_VIEWS tak lolos dengan dua mode berbagi
permukaan, dan labelHead untuk judul kolom label.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Mode ketiga di `TeamScreen`

**Files:**
- Modify: `src/src/screens/TeamScreen.tsx` (`TEAM_VIEWS` baris ~44–49; state & filter baris ~94–121; toolbar baris ~259–277; cabang render baris ~294–299)
- Test: `src/test/team-screen.test.tsx`

**Interfaces:**
- Consumes: `TeamProjectTimeline` (Task 3), `strList` dari `../ui-state` (sudah diekspor).
- Produces: `TEAM_VIEWS` bertiga entri; permukaan `data-testid="team-projects"`.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/team-screen.test.tsx`, **ganti** baris `const SURFACES = ["team-board", "team-timeline"];` (di dalam `describe("TeamScreen · kontrak mode tampilan")`) menjadi:

```ts
  const SURFACES = ["team-board", "team-timeline", "team-projects"];
```

Lalu tambahkan blok baru **sebelum** `describe("TeamScreen · kontrak mode tampilan")`:

```tsx
/* SPEC-949 · mode ketiga. Berbeda dari mode Linimasa, mode ini MELEPAS penyaring project — jadi
   satu-satunya mode yang boleh melahirkan request saat berpindah, dan hanya saat penyaringnya
   memang sedang aktif. */
describe("TeamScreen · mode Lintas project", () => {
  const dated = () => task({ id: "t1", title: "Desain", startDate: "2026-09-10T12:00:00.000Z" });

  it("tab Lintas project ada dan memilihnya mengganti papan dengan kanvasnya", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([dated()]) : page([]));
    view();
    await screen.findByTestId("team-board");
    fireEvent.click(screen.getByRole("tab", { name: /lintas project/i }));
    expect(await screen.findByTestId("team-projects")).toBeInTheDocument();
    expect(screen.queryByTestId("team-board")).toBeNull();
    expect(screen.queryByTestId("team-timeline")).toBeNull();
  });

  it("penyaring project MATI di mode ini dan hidup lagi saat pindah, nilainya tak berubah", async () => {
    const { onProjectFilter } = view("p1");
    await screen.findByTestId("team-board");
    const sel = screen.getByLabelText("Filter project") as HTMLSelectElement;
    expect(sel.disabled).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("team-projects");
    expect((screen.getByLabelText("Filter project") as HTMLSelectElement).disabled).toBe(true);
    // Nilainya milik App dan dipakai bersama Backlog (SPEC-146) — menulisnya di sini mengubah apa
    // yang dilihat layar LAIN.
    expect((screen.getByLabelText("Filter project") as HTMLSelectElement).value).toBe("p1");
    expect(onProjectFilter).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: /^papan$/i }));
    await screen.findByTestId("team-board");
    expect((screen.getByLabelText("Filter project") as HTMLSelectElement).disabled).toBe(false);
  });

  it("dengan penyaring project aktif, masuk ke mode ini memuat ulang TANPA projectId", async () => {
    view("p1");
    await screen.findByTestId("team-board");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    expect(vi.mocked(api.listTasks).mock.calls[0]![0]!.projectId).toBe("p1");

    vi.mocked(api.listTasks).mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("team-projects");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    for (const c of vi.mocked(api.listTasks).mock.calls) {
      expect(c[0]!.projectId).toBeUndefined();
    }
  });

  it("tanpa penyaring project aktif, berpindah ke mode ini TIDAK memuat ulang", async () => {
    view();
    await screen.findByTestId("team-board");
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(4));
    vi.mocked(api.listTasks).mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("team-projects");
    expect(api.listTasks).not.toHaveBeenCalled();
  });

  it("Select zoom hidup di mode ini juga", async () => {
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("team-projects");
    expect(screen.getByLabelText("Zoom linimasa")).toBeInTheDocument();
  });

  it("buka baris project memunculkan task-nya", async () => {
    vi.mocked(api.listTasks).mockImplementation(async (p) =>
      p?.status === "backlog" ? page([dated()]) : page([]));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: /lintas project/i }));
    await screen.findByTestId("timeline-row-p:p1");
    expect(screen.queryByTestId("timeline-row-t:t1")).toBeNull();
    fireEvent.click(screen.getByTestId("expand-p1"));
    expect(await screen.findByTestId("timeline-row-t:t1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm --filter ./src exec vitest run test/team-screen.test.tsx`
Expected: FAIL — `Unable to find role="tab" with name /lintas project/i`, dan test cermin gagal dengan pesan "mode ... tak merender satu pun permukaan yang dikenal".

- [ ] **Step 3: Implementasi**

Di `src/src/screens/TeamScreen.tsx`:

**3a.** Tambahkan impor komponen di sebelah `TeamTimeline` (baris 11):

```tsx
import { TeamTimeline, TeamProjectTimeline } from "./team-timeline";
```

dan tambahkan `strList` ke blok impor `../ui-state` (baris 19):

```tsx
import { usePersistedState, ResetViewButton, isStr, oneOf, strList } from "../ui-state";
```

**3b.** Tambahkan entri ketiga di `TEAM_VIEWS` (baris ~44–49) dan hapus komentar "Item E ... menambahkan entri" di atasnya karena item E sudah masuk:

```tsx
/* Diekspor supaya `team-screen.test.tsx` bisa menegakkan cermin `TEAM_VIEWS` ↔ cabang render:
   entri yang tak punya cabangnya sendiri merender permukaan mode LAIN di bawah pilnya, 200 dan
   nol error — kelas bug yang sama yang dijaga `changelog-nav.test.tsx` untuk `HN_NAV`. */
export const TEAM_VIEWS = [
  { value: "board", label: "Papan", icon: "kanban" },
  // SPEC-948 · `gantt-chart` → `GanttChart` DIVERIFIKASI ada di lucide 0.400.0: SPEC-906
  // menunjukkan nama yang salah jatuh ke `Circle` tanpa satu pun galat, di ±123 call site sekaligus.
  { value: "timeline", label: "Linimasa", icon: "gantt-chart" },
  // SPEC-949 · `layers` → `Layers`, diverifikasi di lucide yang sama.
  { value: "projects", label: "Lintas project", icon: "layers" },
];
```

**3c.** Tepat di bawah `const timeline = view === "timeline";` (baris ~103), tambahkan:

```tsx
  const cross = view === "projects";
```

dan tambahkan state baris terbuka di bawah `zoom` (baris ~102):

```tsx
  // SPEC-949 · baris project yang sedang dibuka. `strList` menolak nilai rusak → jatuh ke `[]`,
  // tak pernah melempar (ADR-0115). Project yang sudah lenyap tinggal di sini tanpa efek: tak ada
  // baris yang bisa dibukanya, jadi tak ada sweep pembersih.
  const [expanded, setExpanded] = usePersistedState<string[]>("team", "expanded", [], strList);
  const toggleProject = React.useCallback((key: string) => {
    setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, [setExpanded]);
```

**3d.** Ganti `activeFilters` (baris ~114–115) dan `filters` (baris ~117–121):

```tsx
  // `projectFilter` tak berlaku di mode Lintas project, jadi menghitungnya di lencana "N filter
  // aktif" sama menyesatkannya dengan mengabaikannya diam-diam.
  const activeFilters = [projectFilter !== "all" && !cross, colFilter !== "all",
    memberFilter !== "all", q.trim() !== ""].filter(Boolean).length;

  // Mode yang gunanya membandingkan antar-project tak boleh mendarat menampilkan satu baris karena
  // penyaring yang disetel di layar lain masih menempel. Ia DILEPAS di sini dan `disabled` di
  // toolbar — penyaring yang tampak aktif tapi tak berlaku adalah kebohongan UI.
  //
  // Diturunkan SEBELUM `useMemo` dan dipakai sebagai dependensinya, bukan `cross` + `projectFilter`
  // mentah: dengan dua dep mentah, berpindah mode saat penyaring `all` melahirkan objek `filters`
  // baru yang ISINYA identik, dan `load` yang bergantung padanya menembakkan empat request yang
  // tak mengubah apa pun.
  const effectiveProject = cross || projectFilter === "all" ? undefined : projectFilter;

  const filters = React.useMemo(() => ({
    projectId: effectiveProject,
    memberId: memberFilter === "all" ? undefined : memberFilter,
    q: q.trim() || undefined,
  }), [effectiveProject, memberFilter, q]);
```

**3e.** Di toolbar, `Select` project (baris ~259–262) bertambah `disabled` dan `title`:

```tsx
          <Select size="sm" aria-label="Filter project" value={projectFilter}
            disabled={cross}
            title={cross ? "Mode Lintas project melintasi semua project — penyaring ini tak berlaku di sini" : undefined}
            onChange={(e) => onProjectFilter(e.target.value)}
            options={[{ value: "all", label: "Semua project" },
              ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
```

dan gerbang `Select` zoom (baris ~273) menjadi `{(timeline || cross) && (`.

**3f.** Ganti cabang render (baris ~294–299):

```tsx
        : cross
          ? <TeamProjectTimeline tasks={tasks} projects={projects} members={members}
              zoom={zoom} today={today} hidden={hiddenTasks} expanded={expanded}
              onToggle={toggleProject} onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />
        : timeline
          ? <TeamTimeline tasks={tasks} members={members} zoom={zoom} today={today}
              hidden={hiddenTasks} onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />
          : <TeamBoard board={board} totals={totals} columns={columns} members={members}
              onMove={move} onAssign={assign} onEscalate={setEscalating} onUnlink={unlink}
              onOpen={(t) => { setEditing(t); setTaskOpen(true); }} />}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm --filter ./src exec vitest run test/team-screen.test.tsx test/team-projects.test.tsx test/team-timeline.test.tsx test/team-board.test.tsx test/team-rules.test.ts test/team-escalate.test.tsx test/team-nav.test.tsx`
Expected: PASS di ketujuh berkas. `team-screen.test.tsx` **28 lulus** (22 baseline + 6 baru).

- [ ] **Step 5: Typecheck paket `src`**

Run: `pnpm --filter ./src exec tsc --noEmit -p tsconfig.json`
Expected: keluar tanpa galat. (Bila `tsconfig.json` tak punya target `noEmit`, pakai `pnpm --filter ./src typecheck`.)

- [ ] **Step 6: Commit**

```bash
git add src/src/screens/TeamScreen.tsx src/test/team-screen.test.tsx
git commit -m "feat(949): mode ketiga Lintas project di layar Tim

Penyaring project DINONAKTIFKAN dan terlihat mati di mode ini — nilainya
tak diubah karena ia milik App dan dipakai bersama Backlog (SPEC-146).
Konsekuensinya berpindah mode memuat ulang saat penyaring sedang aktif;
itu diuji supaya tak hilang diam-diam.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Docs — ADR-0154, index, frontend, skill

**Files:**
- Create: `internal/docs/adr/0154-linimasa-lintas-project.md`
- Modify: `internal/docs/README.md` (baris ringkas layar `Tim` di sekitar baris 83; daftar ADR di sekitar baris 98)
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian layar Tim)
- Modify: `internal/skills/hanoman/SKILL.md` (klausa "Papan Tim — kerja MANUSIA, papan LAIN", baris ~192)

**Interfaces:**
- Consumes: keputusan Task 1–4 apa adanya.
- Produces: tak ada kode.

- [ ] **Step 1: Tulis ADR-0154**

Buat `internal/docs/adr/0154-linimasa-lintas-project.md` mengikuti bentuk `0153-linimasa-gantt-papan-tim.md` (judul · Tanggal · Status · SPEC · relasi · Konteks · Keputusan bernomor · Konsekuensi · Alternatif yang ditolak). Isinya **enam** keputusan, masing-masing dengan sebab yang bisa diuji:

1. **Penyaring project dinonaktifkan, bukan diabaikan** — tiga jalan, dua berbohong; nilainya tak ditulis karena milik App (SPEC-146); konsekuensi jujur: mode ini **melahirkan** empat request saat penyaring sedang aktif, satu-satunya mode yang begitu, dan itu diuji.
2. **Amplop DAN segmen** — amplop sendirian berbohong tentang okupansi (Januari + Desember = batang selebar setahun yang tampak bertabrakan dengan segalanya), dan itu tepat mengenai satu-satunya pembacanya. Pemakaian `bars` jamak yang disiapkan ADR-0153 — tanda tangannya tak berubah satu huruf pun.
3. **`projectSpan` mengembalikan `null`, bukan rentang selebar nol** — satu-satunya pintu yang menutup `NaN%`/batang tak terlihat; akhir tetap inklusif karena `taskSpan` sudah menambahkan satu hari (menambahkannya lagi = tiap project sehari lebih panjang dari task-nya); `invalid` **menular** dari task mana pun supaya baris mengaku.
4. **`barGeometry` dipisah menjadi `spanGeometry`** — rentang yang bukan milik satu task tak punya jalan menuju persen sebelumnya; buktinya pemisahan (bukan penulisan ulang) adalah seluruh test `barGeometry` lama tetap hijau tanpa disentuh.
5. **Jendela dihitung dari seluruh task, bukan dari baris yang terlihat** — membuka satu baris tak boleh menggeser sumbu saat operator sedang membandingkan dua project.
6. **`TimelineCanvas` bertambah `testId`** — mode ini memakai komponen yang SAMA dengan mode Linimasa, jadi tanpa testid sendiri ia lolos cermin `TEAM_VIEWS` ↔ cabang render sambil melanggar persis apa yang dijaganya.

Bagian **Konsekuensi** wajib menyebut: nol kolom, nol route, nol entri sync; `data-model.md` dan `api-contract.md` **tidak** tersentuh; dan item E menutup rantai A→B→{C,D}→E dari ADR-0150.

Bagian **Alternatif yang ditolak** wajib memuat: penyaring diabaikan diam-diam; amplop polos tanpa segmen; menyalin `team-timeline.tsx`; dan menempelkan mode ini ke `OverviewScreen`.

- [ ] **Step 2: Tautkan di index**

Di `internal/docs/README.md`:

- Tambahkan baris ringkas layar `Tim` tepat **sesudah** baris "Layar `Tim` — mode Linimasa (ADR-0153)" (sekitar baris 83), dengan bentuk yang sama: `- **Layar \`Tim\` — mode Lintas project (ADR-0154)** — …` menyebut amplop + segmen, `projectSpan` → `null`, penyaring project yang dimatikan, dan `TimelineCanvas` yang dipakai ulang.
- Tambahkan entri ADR di daftar ADR (sekitar baris 98, **sebelum** entri 0153 supaya urutannya tetap menurun): `- [0154 — Linimasa lintas project: amplop yang tak berbohong tentang okupansi](adr/0154-linimasa-lintas-project.md) — **memperluas 0150 & 0153** …`

- [ ] **Step 3: Perbarui frontend-implementation.md**

Cari bagian layar Tim (`grep -n "Linimasa\|TEAM_VIEWS\|team-timeline" internal/docs/frontend/frontend-implementation.md`) dan tambahkan mode ketiga di daftar mode tampilan: baris per project, amplop + segmen, buka baris, penyaring project yang mati, dan berkas `team-timeline.tsx` yang dipakai ulang (bukan berkas baru).

- [ ] **Step 4: Perbarui SKILL.md**

Di `internal/skills/hanoman/SKILL.md`, klausa "**Papan Tim — kerja MANUSIA, papan LAIN**" (sekitar baris 192): tambahkan `SPEC-949` ke daftar SPEC dan `**ADR-0154**` ke daftar ADR di kepala klausa, lalu satu kalimat padat tentang mode ketiga — amplop yang berbohong tanpa segmen, `projectSpan` → `null` sebagai pintu anti-NaN, dan penyaring project yang dimatikan alih-alih diabaikan.

- [ ] **Step 5: Verifikasi integritas index**

Run: `pnpm --filter ./cli exec tsx src/hanoman.ts docs index --check`
Expected: keluar tanpa galat integritas. Bila perintah itu tak tersedia di worktree ini, jalankan sebagai gantinya:
`grep -c "0154-linimasa-lintas-project.md" internal/docs/README.md`
Expected: `1` atau lebih.

- [ ] **Step 6: Commit**

```bash
git add internal/docs/adr/0154-linimasa-lintas-project.md internal/docs/README.md \
        internal/docs/frontend/frontend-implementation.md internal/skills/hanoman/SKILL.md
git commit -m "docs(949): ADR-0154 linimasa lintas project + index + frontend + skill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Verifikasi akhir dan penyapuan

**Files:** tak ada yang diubah kecuali temuan menuntutnya.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS \
  pnpm --filter ./src exec vitest run \
    test/team-rules.test.ts test/team-timeline.test.tsx test/team-projects.test.tsx \
    test/team-screen.test.tsx test/team-board.test.tsx test/team-escalate.test.tsx \
    test/team-nav.test.tsx
```
Expected: **7 berkas lulus**, **123 test** (87 baseline + 9 Task 1 + 8 Task 2 + 13 Task 3 + 6 Task 4). Nol "no test files" — `--changed` menyalakan `passWithNoTests`, jadi nol test terlihat hijau; di sini path-nya disebut eksplisit sehingga jebakan itu tertutup.

- [ ] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa galat. **Jangan** `pnpm -r typecheck` — mesin ini menjalankan beberapa sesi sekaligus (SPEC-376/ADR-0080).

- [ ] **Step 3: Penyapuan cermin senyap**

Dispatch subagent **blast-radius** dengan perintah: "SPEC-949 menambahkan mode tampilan ketiga di layar Tim. Cari tempat LAIN yang seharusnya ikut berubah tapi tidak: daftar `TEAM_VIEWS` dan cerminnya di test, daftar `SURFACES`, nada `TimelineBarSpec['tone']` dan `TONE`, kunci `hn.ui.v1.team.*` di test/docs, daftar mode tampilan di `internal/docs/**`, dan tempat mana pun yang mengasumsikan layar Tim punya DUA mode."

Perbaiki temuannya, lalu jalankan ulang Step 1.

- [ ] **Step 4: Verifikasi bahwa test benar-benar menguji perubahannya**

Dispatch subagent **qa-verifier** dengan perintah: "Buktikan bahwa test yang lulus di `src/test/team-projects.test.tsx`, `team-rules.test.ts`, dan `team-screen.test.tsx` benar-benar menguji perubahan SPEC-949 — bukan lulus karena mock, karena assertion yang selalu benar, atau karena berkas test-nya tak pernah dijalankan. Pisahkan gagal palsu dari regresi."

Perbaiki temuannya, lalu jalankan ulang Step 1.

- [ ] **Step 5: Centang seluruh checklist plan ini**

Pastikan **tak ada** `- [ ]` yang tersisa di berkas plan ini — hanoman menahan backlog di `executing` selama masih ada satu pun.

- [ ] **Step 6: Commit hasil penyapuan (bila ada) dan push**

```bash
git add -A && git commit -m "docs(plan-949): centang tuntas + hasil dua penyapuan subagent

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin HEAD:refs/heads/hanoman/spec-949
```

---

## Catatan untuk pelaksana

- **Boot server + curl tidak diperlukan.** Task ini nol endpoint dan nol perubahan runtime server; syarat "test API nyata di local" di `CLAUDE.md` berlaku bila task menyentuh endpoint, dan ini tidak.
- **Bila suite terlihat merah ramai dengan 404/P2022** saat menjalankan test *server* (yang plan ini tak menyentuh sama sekali), itu isolasi DB, bukan regresi — lihat `AGENTS.md`. Plan ini hanya menjalankan test `src`, jadi jebakan itu di luar jangkauannya.
- **`localStorage` bocor antar-test** kalau `src/test/setup.ts` tak membersihkannya; ia sudah melakukannya, dan `team-screen.test.tsx` memanggil `localStorage.clear()` di `beforeEach`. State `expanded` yang bertahan antar-test terbaca persis seperti regresi komponen.
