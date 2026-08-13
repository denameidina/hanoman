# Registry metode workflow (SPEC-734) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu konstanta `METHODS` di `shared/src/method-catalog.ts` menjadi satu-satunya tempat hanoman tahu metodologi kerja; sembilan titik yang selama ini menulis "superpowers" literal bertanya ke registry itu, dan menambah metode ketiga = SATU entri katalog.

**Architecture:** Katalog data-murni bebas-zod di `shared`, **diimpor** (bukan dicerminkan) oleh `runner` dan `server`. Prompt & artefak memakai `planDir`/`specDir` metode sesi itu; setiap **gerbang** (planComplete, Stop hook codex, kondisi mode goal, pembersihan artefak, klasifikasi doc) memindai **union seluruh `planDir`/`specDir`** supaya item yang berpindah metode tak pernah lolos lewat direktori kosong. Resolusi mencerminkan `verifyScope`: `opts.method` → `Spec.payload.method` → `Setting.method` → `"superpowers"`.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), zod 3 (hanya di `shared/src/entities.ts`), Prisma 6 + SQLite, Fastify, React 18 + Vite, vitest 2.

## Global Constraints

- **DEFAULT TETAP `superpowers`.** Tanpa pilihan eksplisit prompt yang dihasilkan wajib **byte-identik** dengan hari ini. Setiap task yang menyentuh prompt wajib membuktikannya lewat test.
- **INVARIAN 1 — gerbang plan fail-closed.** Pembaca direktori plan memindai **union** `PLAN_DIRS`; direktori satu metode yang tak ada **tidak boleh** menghentikan pemindaian metode lain (`continue`, bukan `return true`).
- **INVARIAN 2 — pintu keluar tak bisa dinegosiasikan.** `exitSkills` wajib non-kosong dan wajib memuat `superpowers:verification-before-completion`, ditegakkan test DI SUMBER (pola SPEC-490).
- **PIPELINES TIDAK BERUBAH.** Nama fase adalah kunci peta `REACHED` di `server/src/services/session-phases.ts:55`; mengubahnya merusak pemetaan stage.
- **Hanya skill yang tak mewawancarai manusia** boleh masuk katalog. Denylist ditegakkan test sumber. `triage`/`to-spec` dilarang (menulis ke issue tracker eksternal; hanoman ADALAH tracker-nya).
- **`zMethod` LENIENT** — `z.string()`, bukan `z.enum`. Id yang tak dikenal jatuh ke `DEFAULT_METHOD` lewat `resolveMethod()` di titik pakai, **tanpa** dikoersi saat disimpan/dibaca (nilai dari hub tak dibuang diam-diam).
- **Tanpa migration.** `Setting.data` dan `Spec.payload` bertipe `Json`; keduanya dimuat lewat `.default()` zod / penulisan langsung.
- **Metode adalah properti sesi BACKLOG.** Sesi project-level (reverse/scaffold/prd/breakdown), cron, dan konflik tetap `DEFAULT_METHOD`.
- Test dijalankan dengan `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan `--no-file-parallelism` bila menyentuh test server. Jalankan dari **akar worktree** (`./node_modules/.bin/vitest`), bukan dari subdirektori.

---

### Task 1: Katalog metode di `shared`

**Files:**
- Create: `shared/src/method-catalog.ts`
- Create: `shared/src/method-catalog.test.ts`
- Modify: `shared/src/index.ts` (tambah satu baris export)

**Interfaces:**
- Consumes: —
- Produces: `MethodDef`, `METHODS`, `METHOD_IDS`, `DEFAULT_METHOD`, `VERIFICATION_GATE`, `PLAN_DIRS`, `SPEC_DIRS`, `resolveMethod(id?: string | null): MethodDef`, `readSpecMethod(payload: unknown): string | null`, `stampSpecMethod(payload: unknown, methodId: string): Record<string, unknown> | null`

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/method-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  METHODS, METHOD_IDS, DEFAULT_METHOD, VERIFICATION_GATE, PLAN_DIRS, SPEC_DIRS,
  resolveMethod, readSpecMethod, stampSpecMethod,
} from "./method-catalog";

// SPEC-734 · invarian katalog ditegakkan DI SUMBER (pola SPEC-490): metode ketiga yang melanggar
// salah satunya membuat suite merah sebelum ia sempat melahirkan satu sesi pun.
const entries = () => Object.entries(METHODS);

describe("METHODS · invarian sumber", () => {
  it("kunci peta sama dengan id entrinya", () => {
    for (const [key, m] of entries()) expect(m.id).toBe(key);
  });

  // AC-7 · INVARIAN 2
  it("exitSkills tak boleh kosong", () => {
    for (const [key, m] of entries()) {
      expect(m.exitSkills.length, `${key}.exitSkills kosong`).toBeGreaterThan(0);
    }
  });

  it("exitSkills wajib memuat gerbang verifikasi", () => {
    for (const [key, m] of entries()) {
      expect(m.exitSkills, `${key} tanpa gerbang verifikasi`).toContain(VERIFICATION_GATE);
    }
  });

  it("DEFAULT_METHOD ada di katalog", () => {
    expect(METHODS[DEFAULT_METHOD]).toBeDefined();
  });

  it("planDir & specDir unik antar-metode", () => {
    expect(PLAN_DIRS.length).toBe(METHOD_IDS.length);
    expect(SPEC_DIRS.length).toBe(METHOD_IDS.length);
  });

  it("planDir & specDir relatif, tanpa slash di ujung", () => {
    for (const m of Object.values(METHODS)) {
      for (const d of [m.planDir, m.specDir]) {
        expect(d.startsWith("/")).toBe(false);
        expect(d.endsWith("/")).toBe(false);
      }
    }
  });

  it("requires tak boleh kosong", () => {
    for (const [key, m] of entries()) {
      expect(m.requires.length, `${key}.requires kosong`).toBeGreaterThan(0);
    }
  });

  it("extraClause bila ada wajib menyebut planDir metodenya", () => {
    for (const [key, m] of entries()) {
      if (m.extraClause) expect(m.extraClause, key).toContain(m.planDir);
    }
  });
});

// Skill yang kontraknya MEWAWANCARAI manusia, atau menulis ke issue tracker EKSTERNAL. Sesi
// hanoman tak berpenunggu dan AUTONOMY_CLAUSE_FULL menyuruh agen tak pernah bertanya → deadlock
// (kelas bug yang sama dengan checkpoint "review" superpowers, runner/src/prompt.ts:29-31).
// hanoman sendiri adalah issue tracker-nya, jadi `triage`/`to-spec` juga terlarang.
const HUMAN_INVOKED = [
  "grill-me", "to-spec", "triage", "grill-with-docs", "to-questionnaire",
  "wait-what", "teach", "handoff", "ask-matt", "wayfinder", "setup-matt-pocock-skills",
  "improve-codebase-architecture",
];

describe("METHODS · tak boleh memuat skill berpenunggu-manusia", () => {
  it("tak ada entri yang memakai skill dari denylist", () => {
    for (const [key, m] of entries()) {
      const all = [...Object.values(m.phaseSkills).flat(), ...m.exitSkills];
      for (const skill of all) {
        const bare = skill.slice(skill.indexOf(":") + 1);
        expect(HUMAN_INVOKED, `${key} memakai skill berpenunggu-manusia: ${skill}`)
          .not.toContain(bare);
      }
    }
  });
});

describe("resolveMethod", () => {
  it("id yang dikenal mengembalikan entrinya", () => {
    expect(resolveMethod("matt").id).toBe("matt");
  });
  // AC-9
  it("id yang tak ada jatuh ke DEFAULT_METHOD tanpa melempar", () => {
    expect(resolveMethod("tak-ada-metode-ini").id).toBe(DEFAULT_METHOD);
  });
  it("undefined/null/kosong jatuh ke DEFAULT_METHOD", () => {
    expect(resolveMethod().id).toBe(DEFAULT_METHOD);
    expect(resolveMethod(null).id).toBe(DEFAULT_METHOD);
    expect(resolveMethod("").id).toBe(DEFAULT_METHOD);
  });
});

describe("readSpecMethod", () => {
  it("membaca payload.method", () => {
    expect(readSpecMethod({ method: "matt", goal: "x" })).toBe("matt");
  });
  it("payload tanpa method / bukan objek → null", () => {
    expect(readSpecMethod({ goal: "x" })).toBeNull();
    expect(readSpecMethod(null)).toBeNull();
    expect(readSpecMethod(["matt"])).toBeNull();
    expect(readSpecMethod("matt")).toBeNull();
    expect(readSpecMethod({ method: "   " })).toBeNull();
  });
});

describe("stampSpecMethod", () => {
  it("menambahkan method tanpa menyentuh field lain", () => {
    expect(stampSpecMethod({ goal: "x", done: "y" }, "matt"))
      .toEqual({ goal: "x", done: "y", method: "matt" });
  });
  it("payload null lahir sebagai objek berisi method saja", () => {
    expect(stampSpecMethod(null, "superpowers")).toEqual({ method: "superpowers" });
  });
  // Menimpa array/skalar berarti membuang data yang bukan milik kita; resolusi tetap benar
  // tanpa stempel, jadi jawabannya "jangan stempel", bukan "timpa".
  it("payload array/skalar → null (tak distempel)", () => {
    expect(stampSpecMethod(["a"], "matt")).toBeNull();
    expect(stampSpecMethod("a", "matt")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
./node_modules/.bin/vitest --run shared/src/method-catalog.test.ts
```

Expected: FAIL — `Failed to resolve import "./method-catalog"`.

- [x] **Step 3: Tulis katalognya**

Buat `shared/src/method-catalog.ts`:

```ts
// SPEC-734 · ADR-0113 — registry metode workflow.
//
// Sampai spec ini hanoman hanya mengenal SATU metodologi (superpowers) dan itu tak dipilih di mana
// pun: ia tertulis literal di sembilan tempat, sebagian sebagai string path. Berkas ini menjadi
// satu-satunya tempat pengetahuan itu hidup — menambah metode ketiga = satu entri di `METHODS`.
//
// SENGAJA BEBAS ZOD. Ia diimpor `@hanoman/runner`, lapis yang selama ini bebas skema; menyeret
// mesin validasi ke sana hanya untuk membaca tabel konstanta tak sepadan. Validasinya di batas
// HTTP (`zSetting.method`, `zTerminalSession.method`) dan lenient di sana — lihat ADR-0113.
//
// DEVIASI SADAR dari `enums.ts`, yang mencerminkan Flow/Agent/VerifyScope supaya runner bebas zod:
// cermin masuk akal untuk enum tiga kata, bukan untuk tabel yang harus identik di tiga paket.
// SPEC-407 sudah membayar konvensi itu dengan EMPAT cermin `Flow`.

export interface MethodDef {
  readonly id: string;
  /** Dipakai di judul blok skill prompt DAN sebagai label picker — satu sumber, tak bisa berselisih. */
  readonly label: string;
  /** Relatif terhadap akar worktree, TANPA slash di ujung. */
  readonly planDir: string;
  readonly specDir: string;
  /** Nama fase `PIPELINES` → skill yang wajib dimuat. Fase tanpa entri = sengaja tanpa skill. */
  readonly phaseSkills: Readonly<Record<string, readonly string[]>>;
  /** Gerbang yang digabungkan ke fase TERAKHIR pipeline penulis-kode. Wajib non-kosong (AC-7). */
  readonly exitSkills: readonly string[];
  /** Klausa prompt tambahan khas metode ini. Wajib menyebut `planDir`-nya (dijaga test sumber). */
  readonly extraClause?: string;
  /** Prasyarat instalasi, ditampilkan sebagai catatan di picker. */
  readonly requires: readonly string[];
}

export const DEFAULT_METHOD = "superpowers";

// INVARIAN 2 · mattpocock TIDAK punya padanan verification-before-completion, dan flow `goal`
// (Goal → Verifikasi) kehilangan satu-satunya gerbangnya tanpa ini — fase `Goal` memang sengaja
// tanpa skill (runner/src/prompt.ts). Karena itu gerbangnya konstanta, bukan pilihan katalog.
export const VERIFICATION_GATE = "superpowers:verification-before-completion";

// Sesi hanoman tak berpenunggu: tak ada manusia di terminal yang menjawab wawancara, dan
// AUTONOMY_CLAUSE_FULL eksplisit menyuruh agen tak pernah bertanya. Katalog mattpocock mayoritas
// diketik manusia (`/grill-me`, `/to-spec`), jadi entri di bawah memilih primitif model-invoked-nya
// (`grilling`, bukan `/grill-me`) dan klausa ini menegaskannya ke agen.
const MATT_CLAUSE =
  "Sesi ini TAK BERPENUNGGU — tak ada manusia yang menonton terminal untuk menjawab. Skill "
  + "mattpocock yang kontraknya mewawancarai manusia (`/grill-me`, `/to-spec`, `/triage`) JANGAN "
  + "dipakai: pakai primitif model-invoked-nya dan putuskan sendiri. `to-tickets` di fase Plan "
  + "dipakai HANYA sebagai penghasil berkas plan berkotak `- [ ]` di `docs/matt/plans/`, BUKAN "
  + "penerbit tiket — hanoman sendiri adalah issue tracker-nya, jadi jangan menulis ke tracker "
  + "eksternal mana pun.";

export const METHODS: Readonly<Record<string, MethodDef>> = {
  // Isi `PHASE_SKILLS` (SPEC-166) dipindah APA ADANYA. Objective & Spec adalah keluaran skill
  // brainstorming yang di-invoke di fase Brainstorm — sengaja tak punya entri sendiri. Fase reverse
  // dipandu standar docs di prompt-nya, bukan skill.
  superpowers: {
    id: "superpowers",
    label: "superpowers",
    planDir: "docs/superpowers/plans",
    specDir: "docs/superpowers/specs",
    phaseSkills: {
      Brainstorm: ["superpowers:brainstorming"],
      Audit: ["superpowers:systematic-debugging"],
      Plan: ["superpowers:writing-plans"],
      Execute: [
        "superpowers:executing-plans",
        "superpowers:test-driven-development",
        VERIFICATION_GATE,
      ],
      // SPEC-407 · fase `Goal` sengaja TANPA skill: seluruh inti flow itu membebaskan sesi dari
      // proses kaku. Yang tetap dijaga cuma pintu keluarnya.
      Verifikasi: [VERIFICATION_GATE],
    },
    exitSkills: [VERIFICATION_GATE],
    requires: ["superpowers"],
  },
  // Plugin `mattpocock-skills` (`/plugin install mattpocock-skills`); skill plugin di Claude Code
  // beralamat `plugin:skill`. `superpowers` tetap ikut di `requires` karena gerbang verifikasinya
  // dipinjam dari sana — mattpocock tak punya padanannya.
  matt: {
    id: "matt",
    label: "mattpocock",
    planDir: "docs/matt/plans",
    specDir: "docs/matt/specs",
    phaseSkills: {
      Brainstorm: ["mattpocock-skills:grilling"],
      Audit: ["mattpocock-skills:diagnosing-bugs"],
      Plan: ["mattpocock-skills:to-tickets"],
      Execute: [
        "mattpocock-skills:implement",
        "mattpocock-skills:tdd",
        "mattpocock-skills:code-review",
      ],
      Verifikasi: [VERIFICATION_GATE],
    },
    exitSkills: [VERIFICATION_GATE],
    extraClause: MATT_CLAUSE,
    requires: ["mattpocock-skills", "superpowers"],
  },
};

export const METHOD_IDS: readonly string[] = Object.keys(METHODS);

const uniq = (xs: readonly string[]): readonly string[] => [...new Set(xs)];

/**
 * Union direktori plan seluruh metode terdaftar — INVARIAN 1. Setiap GERBANG (planComplete, Stop
 * hook codex, kondisi mode goal, pembersihan artefak, klasifikasi doc) memindai daftar ini, bukan
 * direktori metode terpilih: item yang lahir dengan superpowers lalu dilanjutkan dengan metode lain
 * akan melihat direktori kosong → gerbang lolos hampa → backlog lompat ke `done` padahal plan lama
 * masih penuh `- [ ]`.
 */
export const PLAN_DIRS: readonly string[] = uniq(METHOD_IDS.map((id) => METHODS[id]!.planDir));
export const SPEC_DIRS: readonly string[] = uniq(METHOD_IDS.map((id) => METHODS[id]!.specDir));

/**
 * Resolusi LENIENT. Instance yang di-sync dari hub bisa membawa id metode yang belum ada di build
 * ini; itu harus jadi fallback diam, bukan lemparan yang mengosongkan layar Settings.
 */
export function resolveMethod(id?: string | null): MethodDef {
  return (id ? METHODS[id] : undefined) ?? METHODS[DEFAULT_METHOD]!;
}

/**
 * Metode yang tercatat di `Spec.payload.method` — metode saat item ini PERTAMA diluncurkan (AC-5).
 * Defensif seperti `readGoalPayload`: payload datang dari kolom `Json`, jadi bentuk apa pun bisa
 * mendarat di sana dan tak satu pun boleh membuat peluncuran sesi melempar.
 */
export function readSpecMethod(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const m = (payload as Record<string, unknown>).method;
  return typeof m === "string" && m.trim() !== "" ? m.trim() : null;
}

/**
 * Payload dengan stempel metode. `null` bila payload bukan objek biasa (array/skalar): menstempel
 * di situ berarti menimpa data yang bukan milik kita, sementara resolusi tetap benar tanpa stempel.
 */
export function stampSpecMethod(
  payload: unknown, methodId: string,
): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return { method: methodId };
  if (typeof payload !== "object" || Array.isArray(payload)) return null;
  return { ...(payload as Record<string, unknown>), method: methodId };
}
```

- [x] **Step 4: Ekspor dari barrel**

Di `shared/src/index.ts`, tambahkan setelah baris `export * from "./spec-source";`:

```ts
export * from "./method-catalog";
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest --run shared/src/method-catalog.test.ts
```

Expected: PASS, ±20 test.

- [x] **Step 6: Typecheck shared**

```bash
pnpm --filter ./shared typecheck
```

Expected: keluar tanpa error.

- [x] **Step 7: Commit**

```bash
git add shared/src/method-catalog.ts shared/src/method-catalog.test.ts shared/src/index.ts
git commit -m "feat(spec-734): katalog METHODS di shared, bebas zod"
```

---

### Task 2: `Setting.method` — default global yang lenient

**Files:**
- Modify: `shared/src/entities.ts` (tambah field `method` ke `zSetting`)
- Modify: `server/src/services/settings.ts:12` (`DEFAULT_SETTING`)
- Modify: `server/test/settings.test.ts` (tambah blok test)
- Modify: `src/src/screens/SettingsScreen.tsx:34` (`S_DEFAULTS`)
- Modify: setiap literal `Setting` di test yang jadi merah karena field baru

**Interfaces:**
- Consumes: `DEFAULT_METHOD`, `resolveMethod`, `METHODS` dari Task 1
- Produces: `Setting["method"]: string` (nilai mentah, TIDAK dikoersi saat dibaca)

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/settings.test.ts`, di dalam `describe("settings", …)`:

```ts
  // SPEC-734 · AC-8 · baris Setting yang ditulis SEBELUM spec ini tak punya kunci `method`;
  // `.default()` mengisinya saat dibaca → tanpa migration, cermin goal/codex/verifyScope.
  it("baris Setting lama tetap parse dan mendapat method default", async () => {
    await prisma.setting.create({ data: { id: 1, data: BARIS_LAMA } });
    const s = await getSetting();
    expect(s.method).toBe("superpowers");
  });

  it("method tersimpan dikembalikan apa adanya", async () => {
    await prisma.setting.create({ data: { id: 1, data: { ...BARIS_LAMA, method: "matt" } } });
    expect((await getSetting()).method).toBe("matt");
  });

  // AC-9 · id dari hub yang belum ada di build ini TIDAK boleh membuat baris gagal parse
  // (layar Settings kosong). Nilainya juga TIDAK dikoersi saat dibaca — yang lenient adalah
  // resolveMethod() di titik pakai, supaya nilai hub tak dibuang diam-diam.
  it("method tak dikenal tetap parse, dan resolveMethod menjatuhkannya ke default", async () => {
    await prisma.setting.create({ data: { id: 1, data: { ...BARIS_LAMA, method: "tak-ada" } } });
    const s = await getSetting();
    expect(s.method).toBe("tak-ada");
    expect(resolveMethod(s.method).id).toBe(DEFAULT_METHOD);
  });

  it("DEFAULT_SETTING memakai DEFAULT_METHOD", () => {
    expect(DEFAULT_SETTING.method).toBe(DEFAULT_METHOD);
  });
```

Dan tambahkan import di kepala berkas itu:

```ts
import { DEFAULT_METHOD, resolveMethod } from "@hanoman/shared";
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run server/test/settings.test.ts --no-file-parallelism
```

Expected: FAIL — `expected undefined to be 'superpowers'`.

- [x] **Step 3: Tambah field ke `zSetting`**

Di `shared/src/entities.ts`, tambahkan import di kepala berkas:

```ts
import { DEFAULT_METHOD } from "./method-catalog";
```

lalu tambahkan satu baris di dalam `zSetting`, tepat setelah baris `verifyScope`:

```ts
  // SPEC-734 · ADR-0113 · metode workflow default. LENIENT (`z.string()`, bukan `z.enum`):
  // instance yang di-sync dari hub bisa membawa id metode yang belum ada di build ini, dan itu
  // harus jadi fallback diam di titik pakai (`resolveMethod`) — bukan baris Setting yang gagal
  // parse lalu mengosongkan layar Settings. Alasan yang sama dengan model/effort di sini.
  method: z.string().default(DEFAULT_METHOD),                             // SPEC-734 · ADR-0113 · metode workflow default
```

- [x] **Step 4: Tambah ke `DEFAULT_SETTING`**

Di `server/src/services/settings.ts`, tambahkan ke import dari `@hanoman/shared`: `DEFAULT_METHOD`. Lalu tambahkan satu baris di `DEFAULT_SETTING`, setelah `verifyScope`:

```ts
  method: DEFAULT_METHOD,          // SPEC-734 · ADR-0113 · metode workflow default
```

- [x] **Step 5: Perbaiki literal `Setting` yang jadi merah**

Cari semua literal bertipe `Setting`:

```bash
grep -rln "verifyScope: \"changed\"" src/src src/test server/test shared/src
```

Untuk tiap berkas yang muncul, tambahkan `method: DEFAULT_METHOD,` (impor `DEFAULT_METHOD` dari `@hanoman/shared`) tepat setelah baris `verifyScope`. Minimal: `src/src/screens/SettingsScreen.tsx` (`S_DEFAULTS`) dan `src/src/screens/SettingsScreen.test.tsx`.

- [x] **Step 6: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run server/test/settings.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 7: Typecheck shared + server**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```

Expected: keluar tanpa error.

- [x] **Step 8: Commit**

```bash
git add shared/src/entities.ts server/src/services/settings.ts server/test/settings.test.ts src/src/screens/SettingsScreen.tsx src/src/screens/SettingsScreen.test.tsx
git commit -m "feat(spec-734): Setting.method lenient tanpa migration"
```

---

### Task 3: Prompt runner bertanya ke registry

**Files:**
- Modify: `runner/src/prompt.ts` (`PHASE_SKILLS` dihapus, `skillInstruction`/`phaseInstruction`/`resumeClause` + 4 builder)
- Create: `runner/test/method-phases.test.ts`
- Modify: `runner/test/prompt.test.ts` (tambah blok test)

**Interfaces:**
- Consumes: `METHODS`, `resolveMethod`, `MethodDef` dari Task 1
- Produces: `startPrompt(flow, spec, branchTo, autonomy?, verifyScope?, method?)`, `continuePrompt(...sama)`, `resumePrompt(flow, spec, branchTo, resume, autonomy?, verifyScope?, method?)`, `startGoalPrompt(spec, branchTo, opts & { method?: string })` — `method` adalah **id string**, diresolusi lenient di dalam.

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/method-phases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { METHODS } from "@hanoman/shared";
import { PIPELINES } from "../src/prompt";

// SPEC-734 · assertion ini TAK BISA tinggal di `shared`: `PIPELINES` hidup di `runner`, dan
// `runner` sudah mengimpor `shared` — mengujinya dari sana berarti siklus paket. Di sini kedua
// konstanta terlihat bersamaan.
const PHASE_NAMES = new Set(Object.values(PIPELINES).flat());

describe("METHODS × PIPELINES", () => {
  it("setiap kunci phaseSkills adalah nama fase yang ADA di PIPELINES", () => {
    for (const [id, m] of Object.entries(METHODS)) {
      for (const phase of Object.keys(m.phaseSkills)) {
        expect(PHASE_NAMES.has(phase), `${id}.phaseSkills["${phase}"] bukan nama fase PIPELINES`)
          .toBe(true);
      }
    }
  });
});
```

Tambahkan blok berikut di akhir `runner/test/prompt.test.ts`:

```ts
describe("SPEC-734 · metode workflow", () => {
  const spec = { id: "SPEC-9", title: "T", source: "brief", priority: "sedang", objective: "O" };

  // DEFAULT TETAP superpowers: tanpa argumen `method`, prompt wajib byte-identik.
  it("tanpa method, keempat builder byte-identik dengan method superpowers eksplisit", () => {
    const r = { recorded: ["Audit done"], next: "Spec", worktreeKept: true };
    expect(startPrompt("feature", spec, "b")).toBe(startPrompt("feature", spec, "b", undefined, undefined, "superpowers"));
    expect(continuePrompt("feature", spec, "b")).toBe(continuePrompt("feature", spec, "b", undefined, undefined, "superpowers"));
    expect(resumePrompt("qa", spec, "b", r)).toBe(resumePrompt("qa", spec, "b", r, undefined, undefined, "superpowers"));
    expect(startGoalPrompt(spec, "b")).toBe(startGoalPrompt(spec, "b", { method: "superpowers" }));
  });

  // AC-3 · instruksi skill disusun dari METHODS[M].phaseSkills untuk fase PIPELINES[flow] SAJA.
  it("AC-3 · metode matt memakai skill mattpocock, hanya untuk fase flow-nya", () => {
    const p = startPrompt("feature", spec, "b", undefined, undefined, "matt");
    expect(p).toContain("- Brainstorm: mattpocock-skills:grilling");
    expect(p).toContain("mattpocock-skills:implement");
    expect(p).not.toContain("superpowers:brainstorming");
    // Audit bukan fase flow `feature` → tak boleh muncul.
    expect(p).not.toContain("diagnosing-bugs");
  });

  it("AC-3 · flow qa memakai fase Audit metode itu", () => {
    const p = startPrompt("qa", spec, "b", undefined, undefined, "matt");
    expect(p).toContain("- Audit: mattpocock-skills:diagnosing-bugs");
    expect(p).not.toContain("grilling");
  });

  // INVARIAN 2 · gerbang verifikasi digabungkan ke fase TERAKHIR flow penulis-kode.
  it("INVARIAN 2 · Execute matt tetap membawa gerbang verifikasi", () => {
    const p = startPrompt("feature", spec, "b", undefined, undefined, "matt");
    expect(p).toContain("superpowers:verification-before-completion");
  });

  it("INVARIAN 2 · flow goal metode matt tetap bergerbang di fase Verifikasi", () => {
    const p = startGoalPrompt(spec, "b", { method: "matt" });
    expect(p).toContain("- Verifikasi: superpowers:verification-before-completion");
  });

  // Flow dokumen tak menulis kode → exitSkills tak ditambahkan → prompt tetap seperti dulu.
  it("flow dokumen tak kejatuhan exitSkills", () => {
    expect(startScaffoldPrompt({ id: "p", name: "P", desc: "", stack: "" }, "b"))
      .not.toContain("verification-before-completion");
  });

  // AC-4 (prompt) · klausa gerbang plan menyebut planDir metode itu.
  it("AC-4 · klausa gerbang plan menyebut planDir metodenya", () => {
    expect(startPrompt("feature", spec, "b", undefined, undefined, "matt"))
      .toContain("docs/matt/plans/**");
    expect(startPrompt("feature", spec, "b"))
      .toContain("docs/superpowers/plans/**");
  });

  it("AC-4 · continuePrompt & resumePrompt menyebut planDir metodenya", () => {
    const r = { recorded: [], worktreeKept: false };
    expect(continuePrompt("feature", spec, "b", undefined, undefined, "matt"))
      .toContain("docs/matt/plans/**");
    expect(resumePrompt("feature", spec, "b", r, undefined, undefined, "matt"))
      .toContain("docs/matt/plans/**");
  });

  it("extraClause metode ikut ke prompt; superpowers tak punya sehingga tak menambah apa pun", () => {
    expect(startPrompt("feature", spec, "b", undefined, undefined, "matt"))
      .toContain("TAK BERPENUNGGU");
    expect(startPrompt("feature", spec, "b")).not.toContain("TAK BERPENUNGGU");
  });

  it("id metode tak dikenal jatuh ke superpowers, tak melempar", () => {
    expect(startPrompt("feature", spec, "b", undefined, undefined, "tak-ada"))
      .toBe(startPrompt("feature", spec, "b"));
  });
});
```

Pastikan `startScaffoldPrompt`, `continuePrompt`, `resumePrompt`, `startGoalPrompt` ada di baris import berkas test itu.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
./node_modules/.bin/vitest --run runner/test/prompt.test.ts runner/test/method-phases.test.ts
```

Expected: FAIL — `startPrompt` menolak argumen ke-6 / `docs/matt/plans/**` tak ditemukan.

- [x] **Step 3: Ubah `runner/src/prompt.ts`**

Tambahkan import di kepala berkas:

```ts
import { resolveMethod, type MethodDef } from "@hanoman/shared";
```

Ganti `phaseInstruction` (baris 62-75) supaya menerima metode:

```ts
const phaseInstruction = (phases: readonly string[], method: MethodDef) => {
  const base =
    `Kerjakan fase berurutan: ${phases.join(" → ")}.\n`
    + `Setiap kali sebuah fase selesai (atau kamu putuskan dilewati), append satu baris ke berkas `
    + `di $HANOMAN_PHASE_FILE — persis: \`echo "<Nama Fase> done" >> "$HANOMAN_PHASE_FILE"\`, `
    + `atau \`skipped\` sebagai ganti \`done\`. Nama fase ditulis apa adanya seperti di atas.`;
  // Flow ber-fase Plan+Execute saja (feature, qa): Execute belum selesai selama plan masih
  // punya kotak `- [ ]`. Cermin server-side gate (SPEC-173, ADR-0029) di prompt-nya.
  if (!phases.includes("Plan") || !phases.includes("Execute")) return base;
  return base
    + `\nExecute BELUM selesai selama plan (\`${method.planDir}/**\`) masih punya task `
    + `\`- [ ]\`: kerjakan SEMUA PR/task sampai tiap kotak jadi \`- [x]\` sebelum menulis `
    + `\`Execute done\`. hanoman menahan backlog di \`executing\`, bukan \`done\`, selama masih ada \`- [ ]\`.`;
};
```

Hapus seluruh blok `PHASE_SKILLS` (baris 77-92) dan ganti `skillInstruction` (baris 94-105) dengan:

```ts
// SPEC-734 · ADR-0113 · peta fase → skill datang dari registry metode, bukan konstanta di sini.
//
// `exitSkills` digabungkan ke fase TERAKHIR pipeline dan hanya untuk flow penulis-kode (gerbang
// `writesCode` yang SAMA dengan scopeClause/codeStyleClause — menyalin daftar flow-nya berarti dua
// definisi "sesi ini menulis kode" yang bisa berselisih). Itulah yang membuat INVARIAN 2
// struktural: metode boleh mengganti CARA sebuah fase dikerjakan, tapi tak boleh menegosiasikan
// pintu keluarnya. Untuk `superpowers` gabungan ini di-dedup habis (Execute & Verifikasi sudah
// memuat gerbangnya) → prompt byte-identik dengan sebelum spec ini.
const skillInstruction = (
  phases: readonly string[], method: MethodDef, withExit: boolean,
) => {
  const last = phases[phases.length - 1];
  const lines = phases
    .map((p) => {
      const own = method.phaseSkills[p] ?? [];
      const skills = withExit && p === last
        ? [...new Set([...own, ...method.exitSkills])]
        : own;
      return skills.length ? `- ${p}: ${skills.join(", ")}` : "";
    })
    .filter(Boolean);
  // SPEC-338 · ADR-0074 · netral-agen: Claude Code meng-invoke skill lewat Skill tool, Codex CLI
  // memuatnya secara native. Prompt menyebut HASIL yang diminta, bukan mekanismenya — satu prompt
  // melayani kedua agen tanpa percabangan.
  return lines.length
    ? `Skills ${method.label} WAJIB: sebelum mengerjakan fase di bawah, muat & ikuti skill-nya dengan `
      + `mekanisme yang tersedia di agenmu — bila skill relevan tersedia, pakai.\n${lines.join("\n")}`
    : "";
};
```

Tambahkan helper di dekat `codeStyleClause` (baris 203):

```ts
// SPEC-734 · klausa khas metode (mis. "sesi ini tak berpenunggu"). Metode tanpa `extraClause`
// menghasilkan string kosong → `filter(Boolean)` membuangnya → prompt tak berubah sedikit pun.
const methodClause = (method: MethodDef): string => method.extraClause ?? "";
```

Ubah `resumeClause` supaya menerima `planDir` alih-alih path literal — ganti tanda tangannya dan ketiga penyebutan:

```ts
const resumeClause = (
  r: ResumeCtx, branchTo: string, planDir: string, hasPlan = true,
): string => {
```

lalu di dalamnya ganti `` "docs/superpowers/plans/**" `` (dua tempat) jadi `` `${planDir}/**` ``:

```ts
  const lanjut = r.next
    ? `Lanjutkan dari fase: ${r.next}.`
    : hasPlan
      ? `Semua fase sudah tercatat. Periksa apakah plan di \`${planDir}/**\` masih `
        + "menyisakan task `- [ ]` dan selesaikan sisanya; bila sudah bersih, tinggal commit & push."
      : "Semua fase sudah tercatat. Buktikan sekali lagi goal-nya benar-benar tercapai, lalu "
        + "commit & push.";
```

```ts
  const baca = hasPlan
    ? "Sebelum menulis apa pun: baca `git log --oneline` dan `git status`, lalu plan di "
      + `\`${planDir}/**\` untuk backlog item ini (\`- [x]\` sudah selesai, \`- [ ]\` belum). `
      + "Jangan menulis ulang yang sudah ada."
    : "Sebelum menulis apa pun: baca `git log --oneline` dan `git status` untuk melihat apa yang "
      + "sudah dikerjakan. Jangan menulis ulang yang sudah ada.";
```

Ubah keempat builder. `startPrompt`:

```ts
export function startPrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
  method?: string,
): string {
  const m = resolveMethod(method);
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
      + `dan link-nya di index, dalam commit yang sama.`,
    phaseInstruction(PIPELINES[flow], m),
    auditDecisionInstruction(flow),
    auditContinuationInstruction(flow, spec),
    auditOnlyInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    skillInstruction(PIPELINES[flow], m, writesCode(flow)),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
```

`continuePrompt`:

```ts
export function continuePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
  method?: string,
): string {
  const m = resolveMethod(method);
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow} — MELANJUTKAN backlog item yang sebelumnya ditandai selesai padahal `
      + `pekerjaannya belum tuntas. Ikuti internal/docs sebagai Source of Truth; perbarui `
      + `docs yang tersentuh dan link-nya di index, dalam commit yang sama.`,
    `JANGAN mengulang fase awal — spec & plan sudah ada. Lanjut di fase Execute: baca plan `
      + `di ${m.planDir}/** untuk backlog item ini, periksa task yang sudah \`[x]\` `
      + `dan selesaikan yang masih \`[ ]\`. Verifikasi nyata sebelum klaim selesai.`,
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    skillInstruction(["Execute"], m, writesCode(flow)),
    `Setelah selesai: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Worktree `
      + `ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
```

`resumePrompt`:

```ts
export function resumePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, resume: ResumeCtx,
  autonomy?: Autonomy, verifyScope?: VerifyScope, method?: string,
): string {
  const m = resolveMethod(method);
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  const auditDecided = resume.recorded.some((line) => line.startsWith("Audit "));
  return [
    `hanoman ${flow} — MELANJUTKAN sesi backlog yang sudah berjalan. Ikuti internal/docs sebagai `
      + `Source of Truth; perbarui docs yang tersentuh dan link-nya di index, dalam commit yang sama.`,
    resumeClause(resume, branchTo, m.planDir, PIPELINES[flow].includes("Plan")),
    phaseInstruction(PIPELINES[flow], m),
    auditDecided ? "" : auditDecisionInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    skillInstruction(PIPELINES[flow], m, writesCode(flow)),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}
```

`startGoalPrompt` — tambahkan `method` ke opts dan teruskan:

```ts
export function startGoalPrompt(
  spec: SpecBrief, branchTo: string,
  opts: { autonomy?: Autonomy; verifyScope?: VerifyScope; resume?: ResumeCtx; method?: string } = {},
): string {
  const m = resolveMethod(opts.method);
  const g = readGoalPayload(spec.payload);
  const detail = [
    `Goal: ${g?.goal ?? spec.objective}`,
    g?.done ? `Selesai bila: ${g.done}` : "",
    g?.constraints ? `Batasan: ${g.constraints}` : "",
  ].filter(Boolean).join("\n");
  return [
    "hanoman goal — sesi ini mengejar SATU goal sampai tercapai. TIDAK ada fase Brainstorm, "
      + "Objective, Spec, maupun Plan: jangan menulis design doc, jangan menulis plan berkotak, "
      + "jangan memecah pekerjaan ini jadi backlog baru. Langsung kerjakan goal-nya. Tetap ikuti "
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di "
      + "index, dalam commit yang sama.",
    opts.resume ? resumeClause(opts.resume, branchTo, m.planDir, false) : "",
    detail,
    phaseInstruction(PIPELINES.goal, m),
    "Fase Verifikasi bukan formalitas: jalankan perintah yang membuktikan goal-nya tercapai "
      + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output "
      + "bukan bukti.",
    autonomyClause(opts.autonomy),
    scopeClause("goal", opts.verifyScope),
    codeStyleClause("goal"),
    methodClause(m),
    skillInstruction(PIPELINES.goal, m, writesCode("goal")),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}`,
  ].filter(Boolean).join("\n\n");
}
```

Terakhir, ketiga pemanggil `phaseInstruction`/`skillInstruction` yang tersisa (`startProjectPrompt`, `startPrdPrompt`, `startBreakdownPrompt`, `startScaffoldPrompt`) memakai `DEFAULT_METHOD`. Tambahkan satu konstanta modul di dekat `methodClause`:

```ts
// Sesi project-level (reverse/scaffold/prd/breakdown) TAK punya baris `Spec`, jadi tak punya
// metode tersimpan; keduanya juga flow dokumen, yang katalog mattpocock tak layani. Mereka tetap
// di metode default — dinyatakan, bukan kebetulan (ADR-0113).
const PROJECT_METHOD = resolveMethod(undefined);
```

lalu di keempat builder itu ganti `phaseInstruction(PIPELINES.x)` → `phaseInstruction(PIPELINES.x, PROJECT_METHOD)` dan `skillInstruction(PIPELINES.x)` → `skillInstruction(PIPELINES.x, PROJECT_METHOD, false)`.

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest --run runner/test/prompt.test.ts runner/test/method-phases.test.ts
```

Expected: PASS, termasuk seluruh test prompt lama (bukti byte-identitas).

- [x] **Step 5: Typecheck runner**

```bash
pnpm --filter ./runner typecheck
```

Expected: keluar tanpa error.

- [x] **Step 6: Commit**

```bash
git add runner/src/prompt.ts runner/test/prompt.test.ts runner/test/method-phases.test.ts
git commit -m "feat(spec-734): prompt runner bertanya ke registry metode"
```

---

### Task 4: Gerbang plan lintas metode di runner (Stop hook codex + mode goal)

**Files:**
- Modify: `runner/src/codex-settings.ts:75-84`
- Modify: `runner/src/goal.ts:50-54`
- Modify: `runner/test/codex-settings.test.ts`
- Modify: `runner/test/goal.test.ts`

**Interfaces:**
- Consumes: `PLAN_DIRS` dari Task 1
- Produces: `codexGoalScript` tak berubah tanda tangannya; skripnya kini me-loop **union** direktori plan.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `runner/test/codex-settings.test.ts`:

```ts
import { PLAN_DIRS } from "@hanoman/shared";

describe("SPEC-734 · gate plan lintas metode", () => {
  const base = {
    flow: "feature" as const, specId: "SPEC-9", phaseFile: "/p/ph",
    worktree: "/w", condition: "c", stateFile: "/p/st",
  };

  // AC-4 (Stop hook) + INVARIAN 1 · union, bukan satu direktori.
  it("skrip me-loop SETIAP planDir terdaftar", () => {
    const sh = codexGoalScript(base);
    for (const d of PLAN_DIRS) expect(sh).toContain(`/w/${d}/*spec-9*`);
  });

  it("flow tanpa Plan+Execute tak punya gate plan sama sekali", () => {
    const sh = codexGoalScript({ ...base, flow: "audit" });
    for (const d of PLAN_DIRS) expect(sh).not.toContain(`/w/${d}/*spec-9*`);
  });
});
```

Tambahkan di akhir `runner/test/goal.test.ts`:

```ts
import { PLAN_DIRS } from "@hanoman/shared";

describe("SPEC-734 · kondisi mode goal menyebut union planDir", () => {
  // Gerbang ini menuntut hasil `grep` yang KOSONG sebagai bukti selesai, jadi direktori yang salah
  // bukan sekadar tak informatif — ia MEMUASKAN gerbangnya. Union wajib.
  it("defaultGoalCondition menyebut setiap planDir", () => {
    const c = defaultGoalCondition({ flow: "feature", specId: "SPEC-9", branchTo: "hanoman/x" });
    for (const d of PLAN_DIRS) expect(c).toContain(`${d}/`);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
./node_modules/.bin/vitest --run runner/test/codex-settings.test.ts runner/test/goal.test.ts
```

Expected: FAIL — `/w/docs/matt/plans/*spec-9*` tak ada di skrip.

- [x] **Step 3: Ubah `codex-settings.ts`**

Tambahkan import: `import { PLAN_DIRS } from "@hanoman/shared";`

Ganti blok `if (planGate) { … }` (baris 75-84) dengan:

```ts
  if (planGate) {
    // Cermin planComplete() di server: hanya berkas plan yang cocok id spec ini yang digerbang.
    // SPEC-734 · INVARIAN 1 · loop atas UNION seluruh planDir terdaftar, bukan satu direktori:
    // item yang lahir dengan satu metode lalu dilanjutkan dengan metode lain akan menemukan
    // direktori metode barunya kosong dan berhenti dengan plan lama yang masih penuh `- [ ]`.
    for (const dir of PLAN_DIRS) {
      lines.push(
        `for f in ${shq(`${o.worktree}/${dir}`)}/*${o.specId.toLowerCase()}*; do`,
        `  [ -f "$f" ] || continue`,
        `  grep -qE '^[ \t]*- \\[ \\]' "$f" && `
        + `missing="$missing\\n- plan $f masih punya task - [ ] yang belum selesai"`,
        "done",
      );
    }
  }
```

- [x] **Step 4: Ubah `goal.ts`**

Tambahkan import: `import { PLAN_DIRS } from "@hanoman/shared";`

Ganti blok `if (planGate) { clauses.push(...) }` (baris 50-54) dengan:

```ts
  if (planGate) {
    // SPEC-734 · INVARIAN 1 · gerbang ini menuntut hasil grep KOSONG sebagai bukti, jadi
    // direktori yang salah justru MEMUASKANNYA. Seluruh planDir terdaftar disebut.
    const dirs = PLAN_DIRS.map((d) => `${d}/`).join(" ");
    clauses.push(
      `2. output \`grep -rn -- "- \\[ \\]" ${dirs}\` yang KOSONG untuk plan backlog `
      + `ini — tak ada task yang masih \`- [ ]\` (atau bukti bahwa backlog ini memang tak berplan);`,
    );
  }
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest --run runner/test/codex-settings.test.ts runner/test/goal.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add runner/src/codex-settings.ts runner/src/goal.ts runner/test/codex-settings.test.ts runner/test/goal.test.ts
git commit -m "feat(spec-734): gate plan codex & mode goal memindai union planDir"
```

---

### Task 5: Gerbang & artefak server lintas metode

**Files:**
- Modify: `server/src/services/session-phases.ts:82-93` (`planComplete`)
- Modify: `server/src/services/stage-artifacts.ts:9-33`
- Modify: `server/src/services/spec-docs.ts:22-23`
- Modify: `server/src/services/lead/prompt.ts:125`
- Modify: `server/test/session-phases.test.ts`
- Modify: `server/test/stage-artifacts.test.ts`

**Interfaces:**
- Consumes: `PLAN_DIRS`, `SPEC_DIRS` dari Task 1
- Produces: tanda tangan `planComplete(worktree, specId)`, `artifactsToRemove(...)`, `kindOf(path)` **tak berubah** — hanya perilakunya yang jadi union.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/session-phases.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// SPEC-734 · AC-6 · INVARIAN 1 — item yang BERPINDAH metode adalah kasus yang menentukan.
describe("planComplete · lintas metode (SPEC-734)", () => {
  const wt = () => mkdtempSync(join(tmpdir(), "hn-plan-"));
  const write = (root: string, rel: string, body: string) => {
    mkdirSync(join(root, rel.slice(0, rel.lastIndexOf("/"))), { recursive: true });
    writeFileSync(join(root, rel), body);
  };

  it("plan superpowers yang masih `- [ ]` menahan item meski metode aktifnya matt", () => {
    const root = wt();
    write(root, "docs/superpowers/plans/2026-08-13-spec-9.md", "- [ ] belum\n");
    mkdirSync(join(root, "docs/matt/plans"), { recursive: true });
    expect(planComplete(root, "SPEC-9")).toBe(false);
  });

  it("plan matt yang masih `- [ ]` menahan item meski dir superpowers tak ada", () => {
    const root = wt();
    write(root, "docs/matt/plans/2026-08-13-spec-9.md", "- [ ] belum\n");
    expect(planComplete(root, "SPEC-9")).toBe(false);
  });

  it("kedua direktori bersih → selesai", () => {
    const root = wt();
    write(root, "docs/superpowers/plans/2026-08-13-spec-9.md", "- [x] beres\n");
    write(root, "docs/matt/plans/2026-08-13-spec-9.md", "- [x] beres\n");
    expect(planComplete(root, "SPEC-9")).toBe(true);
  });

  // Direktori satu metode yang TAK ADA tak boleh menghentikan pemindaian metode lain — inilah
  // bentuk kode yang membuat gerbangnya fail-open sebelum spec ini.
  it("dir metode pertama tak ada tak menghentikan pemindaian metode kedua", () => {
    const root = wt();
    write(root, "docs/matt/plans/2026-08-13-spec-9.md", "- [ ] belum\n");
    expect(planComplete(root, "SPEC-9")).toBe(false);
  });

  it("tak ada plan cocok sama sekali → true (tak ada checklist untuk digerbang)", () => {
    expect(planComplete(wt(), "SPEC-9")).toBe(true);
  });
});
```

Tambahkan di `server/test/stage-artifacts.test.ts` — pertama tambahkan berkas matt ke `makeTempRepo`:

```ts
const repo = makeTempRepo({
  "docs/superpowers/specs/2026-07-11-x-spec-167-design.md": "s",
  "docs/superpowers/plans/2026-07-11-x-spec-167.md": "p",
  "docs/superpowers/specs/2026-07-11-y-spec-16-design.md": "s16",
  "docs/matt/plans/2026-08-13-spec-167.md": "pm",
  "docs/matt/specs/2026-08-13-spec-167-design.md": "sm",
  "internal/docs/README.md": "root",
});
```

lalu ubah dua ekspektasi lama dan tambahkan satu test:

```ts
  it("done→objective menghapus artefak spec-ready DAN planned, di SEMUA metode", async () => {
    const out = await artifactsToRemove("p1", "SPEC-167", "objective", "done");
    expect(out.sort()).toEqual([
      "docs/matt/plans/2026-08-13-spec-167.md",
      "docs/matt/specs/2026-08-13-spec-167-design.md",
      "docs/superpowers/plans/2026-07-11-x-spec-167.md",
      "docs/superpowers/specs/2026-07-11-x-spec-167-design.md",
    ]);
  });
  it("done→spec-ready menghapus hanya artefak planned, di SEMUA metode", async () => {
    const out = await artifactsToRemove("p1", "SPEC-167", "spec-ready", "done");
    expect(out.sort()).toEqual([
      "docs/matt/plans/2026-08-13-spec-167.md",
      "docs/superpowers/plans/2026-07-11-x-spec-167.md",
    ]);
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run server/test/session-phases.test.ts server/test/stage-artifacts.test.ts --no-file-parallelism
```

Expected: FAIL — `planComplete` mengembalikan `true`, dan `artifactsToRemove` tak memuat berkas matt.

- [x] **Step 3: Ubah `planComplete`**

Di `server/src/services/session-phases.ts`, tambahkan `PLAN_DIRS` ke import `@hanoman/shared`, lalu ganti fungsinya:

```ts
// SPEC-173 · ADR-0029 — plan milik spec ini, dibaca dari worktree run-nya: `false` hanya jika ada
// file plan yang cocok segmen spec-id DAN masih memuat task `- [ ]`. Tak ada plan yang cocok
// (fast-path qa yang melewati Plan, atau worktree tanpa docs) → `true`: tak ada checklist untuk
// digerbang. Cocokkan sama seperti artifactsToRemove — batas kiri non-alnum, kanan non-digit,
// jadi "spec-16" tak menyerempet "spec-167".
//
// SPEC-734 · ADR-0113 · INVARIAN 1 — pindai UNION seluruh `planDir` terdaftar, bukan direktori
// metode terpilih. Direktori satu metode yang tak ada harus `continue`, BUKAN mengakhiri
// pemindaian: item yang lahir dengan superpowers lalu dilanjutkan dengan metode lain akan melihat
// direktori kosong → `true` hampa → backlog lompat ke `done` padahal plan lama masih penuh `- [ ]`.
export function planComplete(worktree: string, specId: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${specId.toLowerCase()}([^0-9]|$)`);
  for (const rel of PLAN_DIRS) {
    const dir = `${worktree}/${rel}`;
    let names: string[];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!re.test(n.toLowerCase())) continue;
      try { if (/^[ \t]*- \[ \]/m.test(readFileSync(`${dir}/${n}`, "utf8"))) return false; }
      catch { /* file lenyap saat dibaca — abaikan */ }
    }
  }
  return true;
}
```

- [x] **Step 4: Ubah `stage-artifacts.ts`**

```ts
import type { Stage } from "@hanoman/shared";
import { PLAN_DIRS, SPEC_DIRS } from "@hanoman/shared";
import { listRepoDocs } from "./scan";
import { resolveRepoDir } from "./local-binding";
import { STAGES } from "./stage-machine";

// Konvensi penamaan docs by spec-id adalah satu-satunya pemetaan fase→berkas yang andal di repo
// ini. Stage yang tak tercantum tak punya artefak berkas: `objective` hidup sebagai kolom DB, dan
// artefak Execute = kode/commit yang TAK PERNAH dihapus otomatis.
//
// SPEC-734 · ADR-0113 · daftar per stage, bukan satu direktori: sebuah item bisa meninggalkan
// artefak di direktori metode LAIN (ia berpindah metode di tengah jalan), dan revert stage yang
// hanya membersihkan metode terpilih meninggalkan artefak basi yang nanti dibaca gerbang plan.
const ARTIFACT_DIR: Partial<Record<Stage, readonly string[]>> = {
  "spec-ready": SPEC_DIRS.map((d) => `${d}/`),
  planned: PLAN_DIRS.map((d) => `${d}/`),
};
```

dan di dalam `artifactsToRemove` ganti perakitan `dirs`:

```ts
  const dirs = STAGES
    .filter((_, i) => i > ti && i <= ci)
    .flatMap((s) => ARTIFACT_DIR[s] ?? []);
```

- [x] **Step 5: Ubah `spec-docs.ts`**

Tambahkan import `import { PLAN_DIRS, SPEC_DIRS } from "@hanoman/shared";` dan ganti dua baris klasifikasi:

```ts
  // SPEC-734 · prefix diperiksa terhadap UNION direktori terdaftar — dokumen metode lain yang
  // masih ada di worktree tetap terklasifikasi benar di preview docs.
  if (p.endsWith("-design.md") || p.endsWith("-spec.md")
    || SPEC_DIRS.some((d) => p.startsWith(`${d}/`))) return "spec";
  if (PLAN_DIRS.some((d) => p.startsWith(`${d}/`)) || p.endsWith("-plan.md")) return "plan";
```

- [x] **Step 6: Ubah prompt lead**

Di `server/src/services/lead/prompt.ts`, tambahkan `PLAN_DIRS` ke import `@hanoman/shared` dan ganti baris 125 supaya menyebut union:

```ts
  lines.push(`1. KUMPULKAN BUKTI DULU sebelum memutuskan, DI DALAM anggaran waktu di atas: \`internal/docs/**\` (Source of Truth) dan index-nya, ADR yang relevan, plan ${PLAN_DIRS.map((d) => `\`${d}/**\``).join(" / ")}, kode yang bersangkutan, dan riwayat git. Baca, jangan mengingat — tapi baca seperlunya, bukan sehabisnya.`);
```

- [x] **Step 7: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run server/test/session-phases.test.ts server/test/stage-artifacts.test.ts server/test/spec-docs.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add server/src/services/session-phases.ts server/src/services/stage-artifacts.ts server/src/services/spec-docs.ts server/src/services/lead/prompt.ts server/test/session-phases.test.ts server/test/stage-artifacts.test.ts
git commit -m "feat(spec-734): gerbang & artefak server memindai union direktori metode"
```

---

### Task 6: Resolusi & stempel metode saat sesi lahir

**Files:**
- Modify: `server/src/services/session-launch.ts:56-195`
- Modify: `shared/src/dto.ts` (varian `spec` di `zTerminalSession`)
- Modify: `server/src/routes/terminal.ts:86-92`
- Modify: `server/test/session-launch.test.ts`

**Interfaces:**
- Consumes: `resolveMethod`, `readSpecMethod`, `stampSpecMethod` (Task 1); prompt builder ber-`method` (Task 3)
- Produces: `startSpecSession(spec, opts & { method?: string })`; `POST /terminal/sessions` menerima `method?: string` di varian `spec`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/session-launch.test.ts`:

Berkas itu sudah punya `seedRepo(id)`, `argvOf(id)`, dan `setSetting(patch)`. Bukti prompt diambil
dari **argv pane** (`HANOMAN_CLAUDE_BIN=/bin/echo`) — pola yang sama dipakai test mode goal & agen,
karena di situlah prompt benar-benar mewujud. `argvOf` meratakan whitespace, jadi cocokkan potongan
yang memang berspasi tunggal.

```ts
  // SPEC-734 · ADR-0113 · metode workflow. Bukti dari argv pane, sama seperti mode goal & agen.
  const withPayload = async (id: string, payload: object) => {
    const spec = await seedRepo(id);
    return prisma.spec.update({ where: { id: spec.id }, data: { payload } });
  };

  // AC-2 · tanpa method eksplisit, sesi memakai Setting.method.
  it("AC-2 · sesi lahir memakai Setting.method", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "matt" });
    const spec = await seedRepo("SPEC-800");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).toContain("mattpocock-skills:grilling");
    killSession(r.id);
  });

  // Baris Setting yang belum punya kunci itu → "superpowers" (bukan undefined).
  it("AC-2 · tanpa baris Setting sama sekali → superpowers", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-801");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).toContain("superpowers:brainstorming");
    killSession(r.id);
  });

  // AC-5 · metode sesi PERTAMA dicatat di payload, tanpa merusak field payload lain.
  it("AC-5 · metode dicatat di Spec.payload.method saat sesi pertama lahir", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "matt" });
    const spec = await withPayload("SPEC-802", { context: "c", outcome: "o" });
    const r = await startSpecSession(spec, { flow: "feature" });
    const after = await prisma.spec.findUnique({ where: { id: "SPEC-802" } });
    const p = after!.payload as Record<string, unknown>;
    expect(p.method).toBe("matt");
    expect(p.context).toBe("c");
    expect(p.outcome).toBe("o");
    killSession(r.id);
  });

  // …dan nilai tercatat itu MENANG atas Setting yang sudah berubah sesudahnya.
  it("AC-5 · peluncuran berikutnya memakai metode tercatat, bukan Setting yang baru", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "superpowers" });
    const spec = await withPayload("SPEC-803", { method: "matt", context: "c", outcome: "o" });
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).toContain("mattpocock-skills:grilling");
    killSession(r.id);
  });

  it("opts.method menang atas payload maupun Setting", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "matt" });
    const spec = await withPayload("SPEC-804", { method: "matt", context: "c", outcome: "o" });
    const r = await startSpecSession(spec, { flow: "feature", method: "superpowers" });
    expect(await argvOf(r.id)).toContain("superpowers:brainstorming");
    killSession(r.id);
  });

  // AC-9 · id yang tak dikenal tak boleh melempar; ia jatuh ke default.
  it("AC-9 · Setting.method tak dikenal jatuh ke superpowers tanpa melempar", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "tak-ada-metode-ini" });
    const spec = await seedRepo("SPEC-805");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).toContain("superpowers:brainstorming");
    killSession(r.id);
  });
```

Sisipkan blok itu **di dalam** `describe("session-launch", …)` yang sudah ada, sesudah blok test agen
(supaya `seedRepo`/`argvOf`/`setSetting` sudah terdefinisi).

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run server/test/session-launch.test.ts --no-file-parallelism
```

Expected: FAIL — prompt tak memuat `mattpocock-skills:grilling`.

- [x] **Step 3: Ubah `session-launch.ts`**

Tambahkan ke import `@hanoman/shared`:

```ts
import { resolveMethod, readSpecMethod, stampSpecMethod, type Agent } from "@hanoman/shared";
```

Tambahkan opsi baru pada `startSpecSession` (setelah `verifyScope`):

```ts
    // SPEC-734 · ADR-0113 · metode workflow. undefined → metode yang tercatat di
    // `Spec.payload.method` → `Setting.method` → "superpowers". Governor scheduler tak
    // memasoknya → ikut rantai itu, seperti model/effort.
    method?: string;
```

Tepat setelah baris `const verifyScope: VerifyScope = opts.verifyScope ?? setting.verifyScope;`, tambahkan:

```ts
  // SPEC-734 · ADR-0113 · resolusi metode, cermin verifyScope: override sesi → metode yang
  // TERCATAT di item → Setting global → default. `recordedMethod` dibaca SEBELUM stempel ditulis;
  // begitu terisi ia beku, supaya mengganti default global tak memindahkan item yang sedang
  // berjalan ke direktori plan lain di tengah jalan.
  const recordedMethod = readSpecMethod(spec.payload);
  const method = resolveMethod(opts.method ?? recordedMethod ?? setting.method);
```

Tepat setelah blok `if (!resume) await prisma.spec.update({...})` (blok worktree, berakhir sekitar baris 162), tambahkan:

```ts
  // AC-5 · stempel metode item. Ditulis hanya bila belum ada: sesudah itu ia fakta historis
  // ("metode saat item ini pertama diluncurkan"), cermin `startedAt` (ADR-0090). Payload yang
  // bukan objek biasa tak distempel — `stampSpecMethod` mengembalikan null di sana, dan resolusi
  // tetap benar tanpanya.
  if (!recordedMethod) {
    const stamped = stampSpecMethod(spec.payload, method.id);
    if (stamped) await prisma.spec.update({ where: { id: spec.id }, data: { payload: stamped } });
  }
```

Teruskan `method.id` ke keempat builder:

```ts
  if (isGoalFlow) {
    prompt = startGoalPrompt(brief, branchTo, {
      autonomy: opts.autonomy, verifyScope, resume: resumeCtx, method: method.id,
    });
  } else if (isContinue) {
    prompt = continuePrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope, method.id);
  } else if (resumeCtx) {
    prompt = resumePrompt(opts.flow, brief, branchTo, resumeCtx, opts.autonomy, verifyScope, method.id);
  } else {
    prompt = startPrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope, method.id);
  }
```

- [x] **Step 4: Ubah DTO + route**

Di `shared/src/dto.ts`, tambahkan satu baris di varian `spec` `zTerminalSession`, setelah `verifyScope`:

```ts
    // SPEC-734 · ADR-0113 — metode workflow per SESI: undefined → Spec.payload.method →
    // Setting.method → "superpowers". LENIENT (`z.string()`): id yang tak dikenal jatuh ke
    // default di `resolveMethod`, bukan ditolak 400 — picker klien lama tak mengirim apa pun.
    method: z.string().optional(),
```

Di `server/src/routes/terminal.ts`, tambahkan satu baris pada pemanggilan `startSpecSession`:

```ts
          method: parsed.data.method,                                       // SPEC-734 · ADR-0113
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run server/test/session-launch.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 6: Typecheck server**

```bash
pnpm --filter ./server typecheck
```

Expected: keluar tanpa error.

- [x] **Step 7: Commit**

```bash
git add server/src/services/session-launch.ts server/src/routes/terminal.ts shared/src/dto.ts server/test/session-launch.test.ts
git commit -m "feat(spec-734): resolusi & stempel metode saat sesi backlog lahir"
```

---

### Task 7: Picker metode di Start modal & Settings

**Files:**
- Modify: `src/src/api/client.ts:279-285` (`startSession`)
- Modify: `src/src/App.tsx:61-237` (`StartSessionModal`)
- Modify: `src/src/screens/SettingsScreen.tsx` (kartu baru di tab verifikasi)
- Create: `src/test/method-picker.test.tsx`

**Interfaces:**
- Consumes: `METHODS`, `METHOD_IDS`, `resolveMethod`, `DEFAULT_METHOD` (Task 1); `Setting["method"]` (Task 2); `api.startSession({ method })` (Task 6)
- Produces: —

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/method-picker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { METHODS, METHOD_IDS, DEFAULT_METHOD } from "@hanoman/shared";
import { StartSessionModal } from "../src/App";

const settings = { method: "matt" };
vi.mock("../src/api/client", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    api: {
      getSettings: vi.fn(async () => ({
        model: "claude-opus-5", effort: "xhigh", agent: "claude",
        goal: { enabled: false, condition: "" }, verifyScope: "changed",
        codex: { model: "gpt-5.6-sol", effort: "high" },
        ...settings,
      })),
      getCodexVersion: vi.fn(async () => ({ version: null })),
      startSession: vi.fn(async () => ({ id: "s1" })),
    },
  };
});

const spec = {
  id: "SPEC-9", title: "T", source: "brief", priority: "sedang", objective: "O",
  stage: "brainstorming", projectId: "p", blockedBy: [], sourceHistory: [],
} as never;

describe("StartSessionModal · picker Metode (SPEC-734)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // AC-1 + AC-10 · seluruh METHOD_IDS muncul, terpilih pada Setting.method.
  it("AC-1 · menampilkan seluruh METHOD_IDS dan terpilih pada Setting.method", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    const sel = await screen.findByLabelText("Metode") as HTMLSelectElement;
    await waitFor(() => expect(sel.value).toBe("matt"));
    const values = [...sel.options].map((o) => o.value);
    for (const id of METHOD_IDS) expect(values).toContain(id);
    expect(values).toHaveLength(METHOD_IDS.length);
  });

  // AC-10 · opsi datang dari katalog, bukan daftar hardcode: labelnya pun dari katalog.
  it("AC-10 · label opsi datang dari METHODS", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    const sel = await screen.findByLabelText("Metode") as HTMLSelectElement;
    await waitFor(() => expect(sel.value).toBe("matt"));
    for (const id of METHOD_IDS) {
      expect([...sel.options].find((o) => o.value === id)!.textContent)
        .toContain(METHODS[id]!.label);
    }
  });

  it("AC-9 · Setting.method tak dikenal → picker jatuh ke DEFAULT_METHOD", async () => {
    settings.method = "tak-ada";
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    const sel = await screen.findByLabelText("Metode") as HTMLSelectElement;
    await waitFor(() => expect(sel.value).toBe(DEFAULT_METHOD));
    settings.method = "matt";
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/test/method-picker.test.tsx
```

Expected: FAIL — `Unable to find a label with the text of: Metode`.

- [ ] **Step 3: Ubah `client.ts`**

Tambahkan `method?: string;` pada tipe body `startSession`:

```ts
  startSession: (b: { spec: string; flow: Flow; model?: string; effort?: string; goal?: boolean; goalCondition?: string;
    agent?: Agent;                    // SPEC-338 · ADR-0074 · mesin sesi; kosong → Setting.agent
    verifyScope?: VerifyScope;        // SPEC-376 · ADR-0080 · scope verifikasi; kosong → Setting.verifyScope
    method?: string;                  // SPEC-734 · ADR-0113 · metode workflow; kosong → payload/Setting
    force?: boolean }) =>             // SPEC-447 · ADR-0093 · lewati gerbang dependency (jalur manusia)
```

- [ ] **Step 4: Ubah `StartSessionModal`**

Tambahkan ke import `@hanoman/shared` di `src/src/App.tsx`: `METHODS, METHOD_IDS, resolveMethod`.

Tambahkan state setelah `verifyScope` (baris 82):

```ts
  // SPEC-734 · ADR-0113 · metode workflow per sesi. Prefill dari default global; `resolveMethod`
  // menjaga id yang tak dikenal (mis. dari hub) tak membuat picker-nya kosong.
  const [method, setMethod] = React.useState<string>(resolveMethod().id);
```

Di dalam `api.getSettings().then(...)`, setelah `setVerifyScope(...)`:

```ts
      setMethod(resolveMethod(s.method).id);
```

Kirimkan di `start()`:

```ts
        verifyScope, method,
```

Tambahkan `Field` baru tepat setelah `Field` "Scope verifikasi" (sebelum `</Modal>`):

```tsx
      {/* SPEC-734 · ADR-0113 · metode workflow: skill mana yang dipakai per fase dan di direktori
          mana plan-nya ditulis. Opsi datang dari katalog METHODS — menambah metode ketiga tak
          butuh perubahan di berkas ini. */}
      <Field label="Metode"
        hint="Metodologi kerja sesi ini: skill per fase + direktori plan/spec. Metode item yang sudah pernah dijalankan tercatat dan dipakai lagi saat dilanjutkan.">
        <Select aria-label="Metode" value={method} style={{ width: "100%" }}
          options={METHOD_IDS.map((id) => ({ value: id, label: METHODS[id]!.label }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMethod(e.target.value)} />
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          Butuh terpasang: {METHODS[method]?.requires.join(" · ") ?? "—"}
        </div>
      </Field>
```

- [ ] **Step 5: Ubah `SettingsScreen.tsx`**

Tambahkan ke import `@hanoman/shared`: `METHODS, METHOD_IDS, resolveMethod, DEFAULT_METHOD`.

Tambahkan kartu baru tepat setelah `</Card>` kartu "Scope verifikasi — sesi backlog":

```tsx
      {/* SPEC-734 · ADR-0113 · metode workflow: default global untuk sesi backlog; tiap Start
          masih bisa meng-override, dan item yang sudah pernah jalan memakai metode tercatatnya. */}
      <Card eyebrow="metode" title="Metode workflow — sesi backlog">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Metode menentukan <b>skill mana yang dimuat di tiap fase</b> dan <b>di direktori mana plan
          &amp; spec ditulis</b>. Fase-fasenya sendiri tak berubah. Gerbang plan memindai direktori
          SEMUA metode, jadi item yang berpindah metode tak pernah lolos lewat direktori kosong.
        </div>
        <SettingRow title="Metode default" last
          desc="Sesi backlog baru lahir dengan metode ini. Masih bisa diubah per sesi saat Start.">
          <Select size="sm" aria-label="Metode default" style={{ width: 220 }}
            value={resolveMethod(s.method).id}
            options={METHOD_IDS.map((id) => ({ value: id, label: METHODS[id]!.label }))}
            onChange={(e) => save({ method: e.target.value }, "Metode → " + e.target.value)} />
        </SettingRow>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Butuh terpasang: {METHODS[resolveMethod(s.method).id]!.requires.join(" · ")}
        </div>
      </Card>
```

Bila `SettingRow` menuntut `last` sebagai baris terakhir, letakkan blok "Butuh terpasang" di dalam `SettingRow` alih-alih sesudahnya — sesuaikan dengan pola kartu tetangga.

- [ ] **Step 6: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/test/method-picker.test.tsx src/test/start-session-agent.test.tsx src/src/screens/SettingsScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/src/App.tsx src/src/api/client.ts src/src/screens/SettingsScreen.tsx src/test/method-picker.test.tsx
git commit -m "feat(spec-734): picker Metode di Start modal & Settings"
```

---

### Task 8: Docs — ADR-0113 + index + stack + SKILL

**Files:**
- Create: `internal/docs/adr/0113-registry-metode-workflow.md`
- Modify: `internal/docs/README.md` (daftar adr)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/docs/architecture/stack.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Consumes: seluruh keputusan Task 1-7
- Produces: —

- [ ] **Step 1: Enumerasi ulang nomor ADR**

Nomor 0113 tentatif. Buktikan ia belum dipakai di branch mana pun:

```bash
git worktree list
for b in $(git branch -a --format='%(refname:short)'); do
  git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null
done | grep -oE '01[0-9]{2}' | sort -u | tail -5
ls ../*/internal/docs/adr/ 2>/dev/null | grep -oE '01[0-9]{2}' | sort -u | tail -5
```

Bila 0113 sudah terpakai, naikkan ke nomor bebas berikutnya dan sesuaikan SEMUA rujukan `ADR-0113` di kode + docs (`grep -rn "ADR-0113"`).

- [ ] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0113-registry-metode-workflow.md` mengikuti bentuk ADR tetangga (baca `internal/docs/adr/0112-cronjob-per-project-scheduler.md` untuk formatnya). Wajib memuat, masing-masing beserta alasannya:

1. Keputusan: satu registry `METHODS` di `shared/src/method-catalog.ts`; menambah metode = satu entri.
2. **Deviasi konvensi cermin**: registry di `shared` **di-impor** runner, bukan dicerminkan seperti `Flow`/`Agent`/`VerifyScope` di `enums.ts` — cermin masuk akal untuk enum tiga kata, bukan untuk tabel yang harus identik di tiga paket (SPEC-407 membayarnya dengan EMPAT cermin `Flow`). `method-catalog.ts` sengaja bebas-zod supaya impor itu tak menyeret mesin validasi ke lapis runner.
3. **INVARIAN 1**: gerbang plan memindai union; direktori metode yang tak ada `continue`, bukan `return true`.
4. **INVARIAN 2**: `exitSkills` non-kosong + memuat gerbang verifikasi, digabungkan ke fase TERAKHIR flow penulis-kode, ditegakkan test sumber.
5. `zMethod` lenient (bukan `z.enum`) dan alasan sync-dari-hub; nilai mentah tak dikoersi saat disimpan/dibaca.
6. Resolusi `opts.method → Spec.payload.method → Setting.method → superpowers`, dan mengapa stempel payload beku sesudah peluncuran pertama.
7. **PIPELINES tidak berubah** — nama fase adalah kunci `REACHED`.
8. Rekonsiliasi "hanya skill model-invoked": yang dilarang adalah skill yang MEWAWANCARAI manusia / menulis ke tracker eksternal, ditegakkan denylist di test sumber; `to-tickets`/`implement` masuk karena bukan wawancara, `grilling` dipilih di atas `/grill-me`.
9. **Tiga titik di luar enumerasi brief** yang ikut diperbaiki: `runner/src/goal.ts` (grep plan mode goal — gerbangnya menuntut hasil KOSONG sehingga direktori salah justru memuaskannya), `runner/src/prompt.ts` continue/resume, `server/src/services/lead/prompt.ts`.
10. Batas scope: metode = properti sesi BACKLOG; sesi project-level/cron/konflik tetap default. `convertPayload` (ADR-0109) tak membawa stempel metode — aman karena gerbang union + stempel lahir lagi di peluncuran berikutnya.
11. Di luar scope: default per project, deteksi otomatis plugin, metode per-flow, memindahkan artefak lama.

Akhiri dengan `Status: accepted`, tanggal, dan rujukan SPEC-734.

- [ ] **Step 3: Taut di kedua index**

Di `internal/docs/README.md`, di bawah heading `## adr`, sisipkan sebagai baris PERTAMA daftar:

```markdown
- [0113 — Registry metode workflow: katalog METHODS di `shared`, gerbang plan memindai union direktori](adr/0113-registry-metode-workflow.md)
```

Di `internal/docs/adr/README.md`, tambahkan entri narasinya mengikuti bentuk tetangga (ADR-0112).

- [ ] **Step 4: Perbarui `stack.md` & `SKILL.md`**

Di `internal/docs/architecture/stack.md`, tambahkan satu butir di bagian arsitektur/sesi yang menerangkan registry metode, resolusinya, dan INVARIAN 1/2 secara ringkas.

Di `internal/skills/hanoman/SKILL.md`, tambahkan butir sejenis di bagian **Aturan Sesi & Eksekusi**, memuat gotcha yang wajib: (a) gerbang plan memindai union — jangan pernah mengembalikannya ke satu direktori; (b) `exitSkills` ditegakkan test sumber; (c) `PIPELINES` tak boleh berubah; (d) registry di `shared` di-IMPOR runner, bukan dicerminkan.

- [ ] **Step 5: Periksa integritas index**

```bash
grep -c "0113" internal/docs/README.md internal/docs/adr/README.md
```

Expected: keduanya ≥ 1.

- [ ] **Step 6: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(spec-734): ADR-0113 registry metode workflow + index & SKILL"
```

---

### Task 9: Verifikasi akhir ber-skop

**Files:** —

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV \
  ./node_modules/.bin/vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: PASS. **Jangan menerima "no test files" sebagai bukti** — pastikan jumlah berkas test yang berjalan masuk akal (≥ 10) dan sebutkan angkanya.

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck \
  && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: keempatnya keluar tanpa error. (Keempat paket memang tersentuh — ini bukan `pnpm -r`.)

- [ ] **Step 3: Smoke endpoint yang tersentuh**

`POST /terminal/sessions` dan `PUT /settings` berubah bentuknya. Boot server lalu buktikan `method` diterima & tersimpan:

```bash
HANOMAN_HOME="$(mktemp -d)" pnpm dev &
sleep 8
curl -s -X PUT localhost:8787/api/settings -H 'content-type: application/json' \
  -d '{"method":"matt"}' | head -c 400
curl -s localhost:8787/api/settings | python3 -c 'import sys,json; print(json.load(sys.stdin)["method"])'
```

Expected: baris terakhir mencetak `matt`. Matikan server per-PID (`lsof -ti:8787` → `kill <pid>`), **jangan** `pkill -f`.

- [ ] **Step 4: Centang plan + commit penutup**

Pastikan seluruh kotak di berkas plan ini `- [x]`, lalu:

```bash
git add -A && git commit -m "chore(spec-734): centang plan + bukti verifikasi"
git push origin HEAD:refs/heads/hanoman/spec-734
```
