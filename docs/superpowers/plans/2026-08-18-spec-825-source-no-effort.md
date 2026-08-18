# SPEC-825 — Source `no_effort` (flow satu fase) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source keenam `no_effort` ada dan bisa dipilih dari dashboard maupun `POST /specs`, memetakan ke flow satu fase `["Kerjakan"]` yang langsung mengerjakan lalu berhenti — menulis kode dengan `verifyScope` + klausa gaya kode seperti flow penulis-kode lain, dan mencapai `done` tanpa fase perencanaan maupun fase verifikasi terpisah.

**Architecture:** Satu nilai enum (`shared/src/enums.ts`) menarik lima turunan yang semuanya sudah berbentuk peta/predikat tunggal: `payloadShapeFor` mengarahkannya ke bentuk payload `goal` yang sudah ada (nol bentuk baru), `flowForSource` ke flow baru, `PIPELINES` ke pipeline satu fase, `REACHED` ke stage `done`, dan `SOURCE_META` ke lencananya. Dua rantai `||` berisi nama fase kerja (`writesCode` di runner, aturan fase-aktif di `stageFor` server) diangkat jadi satu konstanta `WORK_PHASES` supaya flow penulis-kode berikutnya tak bisa lahir tanpa `verifyScope`/gaya kode secara diam-diam. Prompt sesi memakai builder `startGoalPrompt` yang sama, diparametrisasi flow.

**Tech Stack:** TypeScript strict · zod · vitest · React 18 + Vite · Fastify · Prisma 6/SQLite (tanpa migration — `Spec.source` sudah kolom `String`).

## Global Constraints

- **TANPA migration Prisma.** `Spec.source` sudah `String`; penambahan nilai enum murni zod (preseden `audit` SPEC-237, `help` ADR-0062, `goal` ADR-0089). Jangan sentuh `prisma/schema.prisma`.
- **Nama fase `Kerjakan` HARUS unik lintas seluruh `PIPELINES`** — peta `REACHED` (`server/src/services/session-phases.ts`) berkunci **nama fase saja**. Memakai ulang `Execute` atau `Goal` merusak deteksi fase seluruh flow.
- **Predikat bentuk payload tetap SATU** di `shared/src/spec-source.ts` (`payloadShapeFor` / `shapeOfPayload`). Menyalinnya mengembalikan kelas bug SPEC-431/448/475/481.
- **`writesCode()` tetap satu definisi** di `runner/src/prompt.ts`. Daftar fase kerjanya diangkat ke `WORK_PHASES` dan dipakai bersama `stageFor` — jangan tulis daftar kedua di mana pun.
- **`SOURCE_META` frontend WAJIB dapat entri.** Fallback `SOURCE_META[s] ?? SOURCE_META.brief` diam — tak ada error yang menyanggah (ADR-0109 poin 5, kasus `help`).
- **Item yang SUDAH dimulai tak boleh pindah ke/dari `no_effort`.** Gerbang ADR-0109 (`checkSourceChange`) sudah melakukannya otomatis karena flow-nya berbeda — yang ditambahkan hanya **test**, bukan kode gerbang baru.
- **`cross-audit` tetap dicabut** (ADR-0092). Jangan menghidupkannya sebagai preseden.
- **Nilai enum ditulis `no_effort`** (underscore), sama persis untuk `zSpecSource` dan `zFlow`.
- **Label UI = `"Tanpa effort"`**, ikon `zap`, tone `brass`, warna `var(--brass-400)`. Prefiks author `No effort · <email>`.
- **Prompt flow lain wajib byte-identik.** `WORK_PHASES` menghasilkan boolean yang sama untuk `Execute`/`Goal`; `startGoalPrompt("goal", …)` merakit teks yang sama.
- **Perintah test WAJIB** memakai DB terisolasi & serial saat menyentuh test server:
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path…>`
- Jalankan semua perintah dari root worktree `/Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-825`.

---

### Task 1: Enum, bentuk payload, flow, dan predikat flow di `shared`

**Files:**
- Modify: `shared/src/enums.ts:6`
- Modify: `shared/src/spec-source.ts:12-18`
- Modify: `shared/src/dto.ts:276-287`
- Modify: `shared/src/mcp-schema.ts:104-129`
- Test: `shared/src/spec-source.test.ts`
- Test: `shared/src/no-effort.test.ts` (baru)

**Interfaces:**
- Produces:
  - `zSpecSource` dengan opsi `["brief","qa","audit","help","goal","no_effort"]`
  - `payloadShapeFor("no_effort") === "goal"`
  - `zFlow` dengan opsi `[…,"goal","no_effort"]`, `flowForSource("no_effort") === "no_effort"`
  - `isGoalShapedFlow(flow: string): boolean` — `true` untuk `"goal"` dan `"no_effort"`
- Consumes: tidak ada (task pertama).

- [x] **Step 1: Write the failing test**

Ubah `shared/src/spec-source.test.ts` — ganti tiga `it` pertama di `describe("SPEC-546 · bentuk payload per source (satu predikat)")` menjadi:

```ts
  it("enam source memetakan ke tiga bentuk", () => {
    expect(zSpecSource.options).toEqual(["brief", "qa", "audit", "help", "goal", "no_effort"]);
    expect(zSpecSource.options.map(payloadShapeFor))
      .toEqual(["brief", "qa", "brief", "brief", "goal", "goal"]);
  });

  it("shapeOfPayload mengenali ketiga bentuk; payload null dibaca sebagai brief", () => {
    expect(shapeOfPayload(brief)).toBe("brief");
    expect(shapeOfPayload(qa)).toBe("qa");
    expect(shapeOfPayload(goal)).toBe("goal");
    expect(shapeOfPayload(null)).toBe("brief");
  });

  it("payloadMatchesSource benar untuk seluruh matriks 6×3", () => {
    for (const s of zSpecSource.options)
      for (const [shape, p] of [["brief", brief], ["qa", qa], ["goal", goal]] as const)
        expect(payloadMatchesSource(s, p)).toBe(payloadShapeFor(s) === shape);
  });
```

Lalu tambahkan di dalam `describe` yang sama, sesudah `it("zCreateSpec tetap menolak …")`:

```ts
  // SPEC-825 · source `no_effort` menumpang bentuk goal — tak ada bentuk keempat.
  it("zCreateSpec mengikat no_effort ke bentuk goal", () => {
    const base = { project: "p", title: "t", priority: "sedang" as const };
    expect(zCreateSpec.safeParse({ ...base, source: "no_effort", payload: goal }).success).toBe(true);
    expect(zCreateSpec.safeParse({ ...base, source: "no_effort", payload: brief }).success).toBe(false);
    expect(zCreateSpec.safeParse({ ...base, source: "no_effort", payload: qa }).success).toBe(false);
  });
```

Buat `shared/src/no-effort.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zFlow, flowForSource, isGoalShapedFlow } from "./dto";
import { zSpecSource } from "./enums";
import { SOURCE_PAYLOAD_ALLOF } from "./mcp-schema";

describe("SPEC-825 · source & flow no_effort", () => {
  it("setiap source punya flow, dan no_effort punya flow-nya sendiri", () => {
    for (const s of zSpecSource.options) expect(zFlow.options).toContain(flowForSource(s));
    expect(flowForSource("no_effort")).toBe("no_effort");
    expect(flowForSource("goal")).toBe("goal");
  });

  // Gerbang ADR-0109 mengunci FLOW: flow yang sama berarti item berjalan boleh pindah.
  it("no_effort tak berbagi flow dengan source mana pun", () => {
    const others = zSpecSource.options.filter((s) => s !== "no_effort").map(flowForSource);
    expect(others).not.toContain("no_effort");
  });

  it("isGoalShapedFlow menandai goal & no_effort saja", () => {
    expect(zFlow.options.filter(isGoalShapedFlow)).toEqual(["goal", "no_effort"]);
  });

  it("skema MCP mengikat no_effort ke bentuk goal lewat cabang yang sama", () => {
    const goalBranch = SOURCE_PAYLOAD_ALLOF.find((b) => JSON.stringify(b.if).includes('"goal"'));
    expect(JSON.stringify(goalBranch!.if)).toContain('"no_effort"');
    expect(SOURCE_PAYLOAD_ALLOF).toHaveLength(3);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run shared/src/spec-source.test.ts shared/src/no-effort.test.ts`
Expected: FAIL — `zSpecSource.options` masih lima nilai; `isGoalShapedFlow` tak ada (error impor).

- [x] **Step 3: Write minimal implementation**

`shared/src/enums.ts` — ganti baris `zSpecSource`, tambahkan komentar di atasnya bersama komentar source lain:

```ts
// SPEC-825 · +no_effort · task remeh: satu fase `Kerjakan`, tanpa perencanaan maupun verifikasi.
export const zSpecSource = z.enum(["brief","qa","audit","help","goal","no_effort"]);
```

`shared/src/spec-source.ts` — ganti komentar `PayloadShape` dan `payloadShapeFor`:

```ts
/** Enam source dilayani TIGA bentuk payload (SPEC-197 · SPEC-407 · SPEC-825 · ADR-0089). */
export type PayloadShape = "brief" | "qa" | "goal";

// SPEC-825 · `no_effort` menumpang bentuk `goal`, bukan bentuk keempat: field yang dibutuhkannya
// persis sama, dan bentuk keempat yang tak terbedakan dari isinya membuat `shapeOfPayload` —
// yang menjaga `payloadMatchesSource` — tak bisa ditulis sama sekali.
const GOAL_SHAPED_SOURCES = new Set(["goal", "no_effort"]);

/** source → bentuk yang WAJIB dipakai payload-nya. */
export function payloadShapeFor(source: string): PayloadShape {
  return source === "qa" ? "qa" : GOAL_SHAPED_SOURCES.has(source) ? "goal" : "brief";
}
```

`shared/src/dto.ts` — ganti blok `zFlow`/`flowForSource` (baris 276-287) menjadi:

```ts
// SPEC-407 · +goal · sesi dua fase (Goal → Verifikasi) tanpa fase perencanaan sama sekali.
// SPEC-825 · +no_effort · sesi SATU fase (Kerjakan) untuk task remeh.
export const zFlow = z.enum(["feature", "qa", "scaffold", "reverse", "prd", "audit", "breakdown", "goal", "no_effort"]);
export type FlowName = z.infer<typeof zFlow>;
// SPEC-237 · satu-satunya pemetaan source → flow (client memakainya saat start sesi).
// qa → audit lalu execute perbaikan; audit → dokumen saja (Audit → Laporan, tanpa Execute).
export function flowForSource(source: string): FlowName {
  return source === "qa" ? "qa"
    : source === "audit" ? "audit"
    // SPEC-407 · goal → sesi dua fase yang langsung mengejar goal item, tanpa perencanaan.
    : source === "goal" ? "goal"
    // SPEC-825 · no_effort → sesi satu fase; flow sendiri, bukan varian goal, supaya gerbang
    // konversi ADR-0109 (yang mengunci FLOW) menolaknya untuk item yang sudah dimulai.
    : source === "no_effort" ? "no_effort"
    : "feature";
}

/**
 * Flow yang membawa payload bentuk `goal` dan tak punya fase perencanaan (SPEC-407 · SPEC-825).
 * Ketiganya berlaku sama untuk keduanya: mode goal DIPAKSA menyala, template global
 * `Setting.goal.condition` dilewati (item membawa kondisinya sendiri), dan prompt-nya dirakit
 * builder yang sama. Satu predikat — cermin `flowForSource` di atasnya.
 */
export const isGoalShapedFlow = (flow: string): boolean => flow === "goal" || flow === "no_effort";
```

`shared/src/mcp-schema.ts` — ubah deskripsi `GOAL_PAYLOAD`, deskripsi `SPEC_PAYLOAD_ONEOF`, dan cabang goal di `SOURCE_PAYLOAD_ALLOF`:

```ts
export const GOAL_PAYLOAD = obj({
  description:
    "Bentuk payload untuk source `goal` dan `no_effort`. Sesi goal mengejar satu tujuan tanpa fase perencanaan (ADR-0089); sesi no_effort mengerjakan satu task remeh dalam SATU fase lalu berhenti (ADR-0123).",
```

```ts
export const SPEC_PAYLOAD_ONEOF: JsonSchemaNode = {
  description:
    "Isi backlog. BENTUKNYA DITENTUKAN `source`: `qa` → {severity, steps, expected, actual, env, constraints}; `goal`/`no_effort` → {goal, done, constraints, priority}; `brief`/`audit`/`help` → {context, outcome, constraints, priority}. `constraints` qa opsional (default string kosong); bentuk yang tak cocok ditolak sebelum dikirim.",
  oneOf: [BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD],
};
```

```ts
  { if: { properties: { source: { enum: ["goal", "no_effort"] } }, required: ["source"] }, then: { properties: { payload: GOAL_PAYLOAD } } },
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest --run shared/src/spec-source.test.ts shared/src/no-effort.test.ts shared/src/mcp-schema.test.ts shared/test/enums.test.ts shared/test/dto.test.ts`
Expected: PASS semua. Bila `shared/test/enums.test.ts` mengunci daftar source lama, perbarui daftarnya di sana juga (tambahkan `"no_effort"` di posisi terakhir) lalu jalankan ulang.

- [x] **Step 5: Commit**

```bash
git add shared/src/enums.ts shared/src/spec-source.ts shared/src/dto.ts shared/src/mcp-schema.ts \
  shared/src/spec-source.test.ts shared/src/no-effort.test.ts shared/test
git commit -m "feat(spec-825): source & flow no_effort di shared, menumpang bentuk payload goal"
```

---

### Task 2: Pipeline `Kerjakan`, `WORK_PHASES`, dan prompt sesi di `runner`

**Files:**
- Modify: `runner/src/types.ts:2`
- Modify: `runner/src/prompt.ts:8-22` (PIPELINES), `:196-206` (writesCode), `:341-380` (startGoalPrompt)
- Modify: `runner/src/goal.ts:18-45`
- Test: `runner/src/no-effort-prompt.test.ts` (baru)

**Interfaces:**
- Consumes: `isGoalShapedFlow` dari `@hanoman/shared` (Task 1).
- Produces:
  - `PIPELINES.no_effort === ["Kerjakan"]`
  - `export const WORK_PHASES = ["Execute", "Goal", "Kerjakan"] as const`
  - `startGoalPrompt(flow: Flow, spec: SpecBrief, branchTo: string, opts?): string` — **signature berubah**, flow jadi parameter pertama.
  - `Flow` union memuat `"no_effort"`.

- [x] **Step 1: Write the failing test**

Buat `runner/src/no-effort-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PIPELINES, WORK_PHASES, startGoalPrompt } from "./prompt";
import { defaultGoalCondition } from "./goal";
import type { SpecBrief } from "./types";

const spec: SpecBrief = {
  id: "SPEC-825", title: "Ganti label tombol Simpan", source: "no_effort", priority: "rendah",
  objective: "Tombol Simpan berbunyi Terapkan",
  payload: { goal: "Tombol Simpan berbunyi Terapkan", done: "", constraints: "hanya copy", priority: "rendah" },
};

describe("SPEC-825 · pipeline no_effort", () => {
  it("satu fase bernama Kerjakan", () => {
    expect(PIPELINES.no_effort).toEqual(["Kerjakan"]);
  });

  // Peta REACHED di server berkunci NAMA FASE saja — nama yang dipakai dua flow merusak
  // deteksi fase keduanya (ADR-0089, dan alasan yang sama melahirkan `Kerjakan`).
  it("setiap nama fase unik lintas seluruh PIPELINES", () => {
    const names = Object.values(PIPELINES).flatMap((p) => [...p]);
    expect(new Set(names).size).toBe(new Set(names).size);
    const counted = new Map<string, Set<string>>();
    for (const [flow, phases] of Object.entries(PIPELINES))
      for (const p of phases) counted.set(p, (counted.get(p) ?? new Set()).add(flow));
    const shared = [...counted].filter(([, flows]) => flows.size > 1).map(([p]) => p);
    expect(shared).toEqual(["Spec", "Plan", "Execute", "Audit", "Brainstorm", "Objective"]
      .filter((p) => shared.includes(p)));
    expect(shared).not.toContain("Kerjakan");
  });

  it("WORK_PHASES memuat setiap fase kerja yang dikenal", () => {
    expect([...WORK_PHASES]).toEqual(["Execute", "Goal", "Kerjakan"]);
  });
});

describe("SPEC-825 · prompt sesi no_effort", () => {
  const p = startGoalPrompt("no_effort", spec, "hanoman/spec-825", { verifyScope: "changed" });

  it("menyebut fase Kerjakan dan TIDAK menyebut fase Verifikasi", () => {
    expect(p).toContain("Kerjakan fase berurutan: Kerjakan.");
    expect(p).not.toContain("Verifikasi");
  });

  it("mengeja isi payload sebagai prosa, bukan JSON", () => {
    expect(p).toContain("Goal: Tombol Simpan berbunyi Terapkan");
    expect(p).toContain("Batasan: hanya copy");
    expect(p).not.toContain('{"goal"');
  });

  it("tetap flow penulis-kode: klausa scope verifikasi & gaya kode terpasang", () => {
    expect(p).toContain("Scope verifikasi");
    expect(p).toContain("Gaya kode");
  });

  it("melarang ritual perencanaan dan penambahan fase", () => {
    expect(p).toContain("Plan");
    expect(p.toLowerCase()).toContain("jangan");
  });

  it("kondisi Stop hook menuntut fase Kerjakan, bukan fase flow goal", () => {
    const c = defaultGoalCondition({
      flow: "no_effort", specId: "SPEC-825", branchTo: "hanoman/spec-825", spec,
    });
    expect(c).toContain("Kerjakan");
    expect(c).not.toContain("Verifikasi");
    expect(c).toContain("Tombol Simpan berbunyi Terapkan");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest --run runner/src/no-effort-prompt.test.ts`
Expected: FAIL — `WORK_PHASES` tak diekspor; `PIPELINES.no_effort` undefined.

- [x] **Step 3: Write minimal implementation**

`runner/src/types.ts` baris 2 — tambahkan `"no_effort"` ke union `Flow`:

```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "goal" | "no_effort";
```

`runner/src/prompt.ts` — tambahkan entri terakhir `PIPELINES` beserta komentarnya:

```ts
  // SPEC-825 · ADR-0123 · task remeh: SATU fase. Fase `Verifikasi` milik flow goal menghabiskan
  // satu giliran agen untuk membuktikan sesuatu yang diff-nya sendiri sudah membuktikan; untuk
  // ganti copy / bump konstanta / typo docs itu murni biaya. Nama `Kerjakan` unik lintas
  // PIPELINES — syarat peta REACHED server, yang berkunci nama fase saja.
  no_effort: ["Kerjakan"],
```

Tepat di atas `writesCode`, ganti definisinya menjadi:

```ts
// SPEC-825 · daftar fase KERJA — "sesi ini menulis kode". Dipakai DUA gerbang di DUA paket:
// `writesCode` di bawah (verifyScope + klausa gaya kode + exitSkills) dan aturan "fase kerja yang
// sedang aktif sudah berarti stage `executing`" di `stageFor` (server/services/session-phases.ts).
// Sebelumnya keduanya rantai `||` berisi nama yang sama, dan suku yang lupa ditambah saat flow
// baru lahir tak menghasilkan error apa pun — cuma klausa yang diam-diam hilang.
export const WORK_PHASES = ["Execute", "Goal", "Kerjakan"] as const;

const writesCode = (flow: Flow): boolean =>
  PIPELINES[flow].some((p) => (WORK_PHASES as readonly string[]).includes(p));
```

Hapus komentar `SPEC-407 · flow goal MENULIS KODE juga…` yang menempel pada definisi lama hanya jika isinya sudah terwakili komentar baru; **pertahankan** komentar ADR-0080/SPEC-376 di atasnya.

Ganti `startGoalPrompt` menjadi berparameter flow:

```ts
// SPEC-407 · ADR-0089 · sesi backlog GOAL. Sengaja bukan cabang di dalam startPrompt: yang
// berbeda bukan satu-dua kalimat melainkan KERANGKA-nya — tak ada fase perencanaan, tak ada
// keputusan pasca-Audit, tak ada skill Brainstorm/Plan, tak ada blok Detail berisi JSON payload
// (isi payload sudah dieja sebagai Goal/Selesai bila/Batasan). Mode goal (Stop hook ADR-0073)
// dipasang di sisi server saat sesi lahir, bukan lewat prompt ini.
//
// SPEC-825 · ADR-0123 · flow `no_effort` memakai KERANGKA yang sama persis — payload bentuk yang
// sama, tanpa fase perencanaan, prosa alih-alih JSON — jadi ia diparametrisasi flow, bukan
// disalin. Yang berbeda hanya kepala prompt dan ada/tidaknya klausa fase Verifikasi.
export function startGoalPrompt(
  flow: "goal" | "no_effort", spec: SpecBrief, branchTo: string,
  opts: { autonomy?: Autonomy; verifyScope?: VerifyScope; resume?: ResumeCtx; method?: string } = {},
): string {
  const m = resolveMethod(opts.method);
  const g = readGoalPayload(spec.payload);
  const noEffort = flow === "no_effort";
  const detail = [
    `Goal: ${g?.goal ?? spec.objective}`,
    g?.done ? `Selesai bila: ${g.done}` : "",
    g?.constraints ? `Batasan: ${g.constraints}` : "",
  ].filter(Boolean).join("\n");
  const head = noEffort
    ? "hanoman no-effort — sesi ini mengerjakan SATU pekerjaan remeh lalu berhenti. TIDAK ada "
      + "fase Brainstorm, Objective, Spec, Plan, maupun fase verifikasi terpisah: jangan menulis "
      + "design doc, jangan menulis plan berkotak, jangan memecah pekerjaan ini jadi backlog "
      + "baru, dan jangan menambah fase sendiri. Langsung kerjakan, buktikan seperlunya di fase "
      + "yang sama, lalu berhenti. Tetap ikuti internal/docs sebagai Source of Truth; perbarui "
      + "docs yang tersentuh dan link-nya di index, dalam commit yang sama."
    : "hanoman goal — sesi ini mengejar SATU goal sampai tercapai. TIDAK ada fase Brainstorm, "
      + "Objective, Spec, maupun Plan: jangan menulis design doc, jangan menulis plan berkotak, "
      + "jangan memecah pekerjaan ini jadi backlog baru. Langsung kerjakan goal-nya. Tetap ikuti "
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di "
      + "index, dalam commit yang sama.";
  return [
    head,
    opts.resume ? resumeClause(opts.resume, branchTo, m.planDir, false) : "",
    detail,
    phaseInstruction(PIPELINES[flow], m),
    noEffort ? "" :
      "Fase Verifikasi bukan formalitas: jalankan perintah yang membuktikan goal-nya tercapai "
      + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output "
      + "bukan bukti.",
    autonomyClause(opts.autonomy),
    scopeClause(flow, opts.verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    skillInstruction(PIPELINES[flow], m, writesCode(flow)),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}`,
  ].filter(Boolean).join("\n\n");
}
```

`runner/src/goal.ts` — impor predikat dan pakai untuk memilih kondisi, serta jadikan `goalFlowCondition` berparameter flow:

```ts
import type { Flow } from "./types";
import { PLAN_DIRS, isGoalShapedFlow } from "@hanoman/shared";
```

```ts
// SPEC-407 · ADR-0089 · kondisi sesi goal. Klausa 2 & 3 bukan hiasan: tanpa baris fase, board tak
// pernah melihat item ini selesai (ADR-0008); tanpa push, hasilnya hilang bersama worktree-nya.
// SPEC-825 · daftar fase datang dari `PIPELINES[flow]`, bukan `PIPELINES.goal` hardcode — flow
// `no_effort` memakai kondisi yang sama dengan daftar fasenya sendiri.
function goalFlowCondition(
  flow: Flow, specId: string, branchTo: string, spec?: { payload?: unknown; objective?: string },
): string {
  const g = readGoalPayload(spec?.payload);
  const goal = g?.goal || (spec?.objective ?? "").trim() || "(goal tak tercatat di backlog item)";
  const bukti = g?.done || goal;
  return [
    `Sesi goal hanoman ${specId}. GOAL: ${goal}`,
    "Sesi ini hanya boleh berhenti bila transkrip TERBARU memuat bukti langsung semua hal berikut:",
    `1. goal tercapai — ${bukti};`,
    `2. output \`cat "$HANOMAN_PHASE_FILE"\` yang memuat satu baris untuk SETIAP fase `
      + `${PIPELINES[flow].join(" → ")}, masing-masing berakhiran \`done\` atau \`skipped\`;`,
    `3. output \`git push origin HEAD:refs/heads/${branchTo}\` yang SUKSES sesudah commit terakhir.`,
    "Bila salah satu bukti tak ada di transkrip terbaru, kondisi BELUM terpenuhi: jalankan "
      + "perintah verifikasinya, tuntaskan yang masih kurang, lalu lanjutkan — jangan berhenti.",
  ].join("\n");
}
```

dan di `defaultGoalCondition` ganti gerbangnya:

```ts
  // SPEC-407 · flow goal punya kondisinya sendiri: goal item, bukan DoD pipeline.
  // SPEC-825 · berlaku sama untuk `no_effort` — satu predikat (`isGoalShapedFlow`), bukan dua.
  if (isGoalShapedFlow(flow)) return goalFlowCondition(flow, specId, branchTo, spec);
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest --run runner/src/no-effort-prompt.test.ts`
Expected: PASS. Bila `expect(p).toContain("Scope verifikasi")` gagal, buka `runner/src/verify-scope.ts` dan `runner/src/code-style.ts` lalu ganti string yang di-assert dengan potongan judul klausa yang benar-benar ada di sana (jangan melemahkan assert-nya jadi `toBeTruthy`).

Run juga: `pnpm --filter ./runner typecheck` — Expected: sukses, kecuali error di `server/src/services/session-launch.ts` yang diperbaiki Task 3 (typecheck runner sendiri harus bersih).

- [x] **Step 5: Commit**

```bash
git add runner/src/types.ts runner/src/prompt.ts runner/src/goal.ts runner/src/no-effort-prompt.test.ts
git commit -m "feat(spec-825): pipeline Kerjakan, WORK_PHASES, prompt no_effort di runner"
```

---

### Task 3: Stage, objective, author, dan peluncuran sesi di `server`

**Files:**
- Modify: `server/src/services/session-phases.ts:52-78`
- Modify: `server/src/services/spec-fields.ts:9-20`
- Modify: `server/src/routes/specs.ts:115-121`
- Modify: `server/src/services/session-launch.ts:3` (impor), `:130-136`, `:193-198`
- Test: `server/test/session-phases.test.ts`
- Test: `server/test/spec-source-gate.test.ts`

**Interfaces:**
- Consumes: `WORK_PHASES` & `PIPELINES` dari `@hanoman/runner` (Task 2); `isGoalShapedFlow` & `payloadShapeFor` dari `@hanoman/shared` (Task 1).
- Produces: `stageFor([{name:"Kerjakan",state:"active"}]) === "executing"`, `stageFor([{name:"Kerjakan",state:"done"}]) === "done"`; `deriveSpecFields("no_effort", {goal:"…"}, "rendah").objective === "…"`.

- [ ] **Step 1: Write the failing test**

Tambahkan di `server/test/session-phases.test.ts`, di akhir berkas:

```ts
describe("SPEC-825 · flow no_effort (satu fase)", () => {
  const kerjakan = (state: Phase["state"]): Phase[] => [{ name: "Kerjakan", state }];

  it("readPhases memberi satu fase aktif saat berkas belum ada", () => {
    expect(readPhases(file, "no_effort").map((p) => `${p.name}:${p.state}`))
      .toEqual(["Kerjakan:active"]);
  });

  it("fase kerja yang AKTIF sudah berarti executing — cermin Execute & Goal", () => {
    expect(stageFor(kerjakan("active"))).toBe("executing");
  });

  it("fase kerja selesai langsung mencapai done — tak ada fase verifikasi", () => {
    expect(stageFor(kerjakan("done"))).toBe("done");
    expect(stageFor(kerjakan("skipped"))).toBe("done");
  });

  it("phasesComplete benar untuk pipeline satu fase", () => {
    expect(phasesComplete(kerjakan("done"))).toBe(true);
    expect(phasesComplete(kerjakan("active"))).toBe(false);
  });
});
```

Tambahkan di `server/test/spec-source-gate.test.ts`, di akhir berkas:

```ts
// SPEC-825 · gerbang ADR-0109 mengunci FLOW, dan `no_effort` punya flow sendiri — jadi item yang
// sudah dimulai terkunci dari/ke sana TANPA satu baris gerbang baru. Diuji, bukan diasumsikan:
// berkas fase item feature tak akan pernah memuaskan phasesComplete(["Kerjakan"]) (bentuk SPEC-433).
describe("SPEC-825 · no_effort", () => {
  const goal = { goal: "g", done: "d", constraints: "", priority: "sedang" };

  it("item yang sudah dimulai ditolak 409 ke no_effort", () => {
    expect(checkSourceChange(started, "no_effort"))
      .toEqual({ ok: false, code: 409,
        error: "backlog item sudah dimulai — type hanya bisa pindah ke source dengan flow yang sama" });
  });

  it("item no_effort yang sudah dimulai ditolak 409 ke goal — flow-nya berbeda", () => {
    const startedNoEffort = { source: "no_effort", stage: "executing", baseSha: "abc123", payload: goal };
    expect(checkSourceChange(startedNoEffort, "goal").ok).toBe(false);
  });

  it("item belum dimulai brief → no_effort mengkonversi ke bentuk goal", () => {
    const g = checkSourceChange(fresh, "no_effort");
    expect(g.ok && g.payload).toEqual({ goal: "o", done: "", constraints: "k", priority: "sedang" });
    expect(g.ok && g.dropped).toEqual(["context"]);
  });

  it("goal ↔ no_effort untuk item belum dimulai tak mengubah payload — sebentuk", () => {
    const freshGoal = { source: "goal", stage: "brainstorming", baseSha: null, payload: goal };
    expect(checkSourceChange(freshGoal, "no_effort").ok).toBe(true);
    expect((checkSourceChange(freshGoal, "no_effort") as { payload: unknown }).payload).toEqual(goal);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-phases.test.ts server/test/spec-source-gate.test.ts`
Expected: FAIL — `readPhases(file, "no_effort")` mengembalikan `[]` (PIPELINES belum ada di build server) dan `stageFor` mengembalikan `null` untuk `Kerjakan`.

- [ ] **Step 3: Write minimal implementation**

`server/src/services/session-phases.ts` — impor `WORK_PHASES` dan pakai di dua tempat:

```ts
import { PIPELINES, WORK_PHASES, type Flow } from "@hanoman/runner";
```

```ts
const REACHED: Record<string, Stage> = {
  Objective: "objective", Audit: "objective", Spec: "spec-ready", Plan: "planned",
  Laporan: "done", Execute: "done",
  // SPEC-407 · ADR-0089 · flow goal (Goal → Verifikasi): fase kerja mencapai `executing`, fase
  // verifikasi yang mencapai `done`. Kedua nama unik lintas PIPELINES — peta ini berkunci nama.
  Goal: "executing", Verifikasi: "done",
  // SPEC-825 · ADR-0123 · flow no_effort (Kerjakan): satu fase, jadi fase kerjanya sendiri yang
  // mencapai `done` — tak ada fase verifikasi untuk menutup.
  Kerjakan: "done",
};
export function stageFor(phases: Phase[]): Stage | null {
  let best = -1;
  for (const p of phases) {
    // Fase KERJA yang sedang berjalan sudah berarti `executing`. Daftarnya `WORK_PHASES` di
    // runner — sumber yang SAMA dengan gerbang `writesCode`, supaya flow penulis-kode baru tak
    // bisa lahir dengan salah satunya terpasang dan yang lain terlewat (SPEC-825).
    if ((WORK_PHASES as readonly string[]).includes(p.name) && p.state === "active")
      best = Math.max(best, STAGES.indexOf("executing"));
```

`server/src/services/spec-fields.ts` — ganti gerbang `source === "goal"`:

```ts
import { payloadShapeFor, priorityFromSeverity } from "@hanoman/shared";
```

```ts
  // SPEC-407 · ADR-0089 · backlog goal: objective ADALAH goal-nya (yang dibaca prompt sesi &
  // kondisi Stop hook). Prioritas tetap manual — tak ada severity untuk diturunkan, dan operator
  // yang tahu seberapa mendesak goal itu.
  // SPEC-825 · digerbangi BENTUK payload, bukan nama source: `no_effort` memakai bentuk yang sama,
  // dan predikat bentuk tetap satu (`payloadShapeFor`).
  if (payloadShapeFor(source) === "goal") {
```

`server/src/routes/specs.ts` — tambahkan cabang author sesudah cabang `goal`:

```ts
              : b.source === "goal" ? `Goal · ${author}`
              // SPEC-825 · asal item no_effort terbaca di backlog (cermin `Audit ·`/`Goal ·`).
              : b.source === "no_effort" ? `No effort · ${author}`
              : author,
```

`server/src/services/session-launch.ts` — impor predikat dan pakai:

```ts
import { flowForSource, isGoalShapedFlow, /* impor lain yang sudah ada */ } from "@hanoman/shared";
```

(bila `@hanoman/shared` belum diimpor di berkas itu, tambahkan barisnya sendiri; jangan ganggu impor `@hanoman/runner` di baris 3 selain menambah apa yang dibutuhkan)

```ts
  // SPEC-825 · ADR-0123 · flow `no_effort` mewarisi ketiga aturan flow goal: mode goal dipaksa
  // menyala, template global dilewati, dan prompt-nya dirakit builder yang sama.
  const isGoalFlow = isGoalShapedFlow(opts.flow);
```

dan di perakitan prompt:

```ts
  if (isGoalFlow) {
    // SPEC-407 · satu builder untuk ketiga keadaan sesi goal: `continuePrompt`/`resumePrompt`
    // bicara plan berkotak & fase perencanaan, dan sesi goal tak punya keduanya.
    prompt = startGoalPrompt(opts.flow as "goal" | "no_effort", brief, branchTo, {
      autonomy: opts.autonomy, verifyScope, resume: resumeCtx, method: method.id,
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-phases.test.ts server/test/spec-source-gate.test.ts server/test/spec-source-contract.test.ts server/test/spec-source.route.test.ts server/test/specs.route.test.ts`
Expected: PASS semua.

Run: `pnpm --filter ./server typecheck`
Expected: sukses tanpa error.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/session-phases.ts server/src/services/spec-fields.ts \
  server/src/routes/specs.ts server/src/services/session-launch.ts \
  server/test/session-phases.test.ts server/test/spec-source-gate.test.ts
git commit -m "feat(spec-825): stage Kerjakan, objective per bentuk payload, peluncuran sesi no_effort"
```

---

### Task 4: Lencana, tab filter, dan form di dashboard

**Files:**
- Modify: `src/src/screens/source-meta.ts:11-18`
- Modify: `src/src/screens/BacklogScreen.tsx:181-186` (saveEdit), `:238-243` (fields), `:929-940` (tab)
- Modify: `src/src/App.tsx:110`, `:322-360`, `:1146-1176`
- Modify: `src/src/api/client.ts:10`
- Test: `src/test/change-source.test.tsx`
- Test: `src/test/backlog-no-effort.test.tsx` (baru)

**Interfaces:**
- Consumes: `zSpecSource`, `payloadShapeFor`, `isGoalShapedFlow`, `flowForSource` dari `@hanoman/shared` (Task 1).
- Produces: `SOURCE_META.no_effort = { label: "Tanpa effort", icon: "zap", tone: "brass", color: "var(--brass-400)" }`.

- [ ] **Step 1: Write the failing test**

Di `src/test/change-source.test.tsx`, ganti dua assert daftar:

```ts
    expect(Object.keys(SOURCE_META).sort()).toEqual(["audit", "brief", "goal", "help", "no_effort", "qa"]);
```

```ts
    expect([...sel.options].map((o) => o.value).sort()).toEqual(["audit", "goal", "help", "no_effort", "qa"]);
```

Buat `src/test/backlog-no-effort.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SOURCE_META, sourceMeta } from "../src/screens/source-meta";
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec = {
  id: "SPEC-825", projectId: "p1", title: "Ganti label tombol Simpan", source: "no_effort",
  stage: "executing", priority: "rendah", author: "No effort · dena",
  objective: "Tombol Simpan berbunyi Terapkan", branchFrom: null, baseSha: "abc", headSha: null,
  createdAt: "2026-08-18T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [],
  autoMerge: null, sourceHistory: [],
  payload: { goal: "Tombol Simpan berbunyi Terapkan", done: "", constraints: "hanya copy", priority: "rendah" },
} as unknown as Spec;

describe("SPEC-825 · lencana no_effort", () => {
  // Fallback SOURCE_META diam: tanpa entri, item no_effort memakai lencana "feature brief"
  // dan tak ada satu pun error yang menyanggahnya (ADR-0109 poin 5, kasus `help`).
  it("punya entri sendiri, bukan jatuh ke fallback brief", () => {
    expect(SOURCE_META.no_effort).toBeTruthy();
    expect(sourceMeta("no_effort").label).toBe("Tanpa effort");
    expect(sourceMeta("no_effort").label).not.toBe(SOURCE_META.brief!.label);
  });
});

describe("SPEC-825 · daftar backlog", () => {
  const props = {
    backlog: [spec], projects: [{ id: "p1", name: "P1" } as any], runs: [],
    onStart: vi.fn(), onDelete: vi.fn(), onOpenRun: vi.fn(), onOpenReview: vi.fn(),
  } as any;

  it("punya tab filter sendiri", async () => {
    render(<BacklogScreen {...props} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Tanpa effort" })).toBeTruthy());
  });

  it("detail merender field bentuk goal, bukan konteks/outcome", async () => {
    render(<BacklogScreen {...props} />);
    fireEvent.click(screen.getByText("Ganti label tombol Simpan"));
    await waitFor(() => expect(screen.getByText("Tanpa effort")).toBeTruthy());
    expect(screen.getByText("Tombol Simpan berbunyi Terapkan")).toBeTruthy();
    expect(screen.queryByText("Konteks")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest --run src/test/change-source.test.tsx src/test/backlog-no-effort.test.tsx`
Expected: FAIL — `SOURCE_META.no_effort` undefined; tab "Tanpa effort" tak ditemukan.

- [ ] **Step 3: Write minimal implementation**

`src/src/screens/source-meta.ts` — tambahkan entri sesudah `goal`:

```ts
  // SPEC-825 · ADR-0123 · task remeh: satu fase `Kerjakan`, tanpa perencanaan maupun verifikasi.
  no_effort: { label: "Tanpa effort", icon: "zap", tone: "brass", color: "var(--brass-400)" },
```

`src/src/screens/BacklogScreen.tsx`:

- impor predikat bentuk:

```ts
import { AUTO_MERGE_OFF, autoMergeSummary, resolveAutoMerge, payloadShapeFor, type AutoMerge } from "@hanoman/shared";
```

- di `saveEdit`, ganti `spec.source === "goal"` dengan predikat bentuk:

```ts
      // SPEC-407 · bentuk payload terikat source di boundary server (zPatchSpec + superRefine
      // POST); mengirim bentuk brief untuk item goal akan ditolak dan menghapus goal-nya.
      // SPEC-825 · digerbangi BENTUK, bukan nama source — `no_effort` memakai bentuk yang sama.
      : payloadShapeFor(spec.source) === "goal"
```

- di badan detail, ganti dua baris `isGoal`:

```ts
  const shape = payloadShapeFor(spec.source);   // SPEC-407/825 · goal & no_effort sebentuk
```

dan

```ts
  const fields: readonly (readonly [string, string, string])[] = SHAPE_FIELDS[shape]!;
```

Hapus `const isGoal = …` bila tak lagi dipakai di berkas itu; bila masih ada pemakai lain, ganti pemakaiannya jadi `shape === "goal"`. `GOAL_FIELDS`/`BRIEF_FIELDS`/`QA_FIELDS` yang jadi tak terpakai di impor ikut dihapus dari daftar impor.

- tab filter, sesudah tab `goal`:

```ts
            // SPEC-825 · ADR-0123 · item no_effort punya alur sendiri (satu fase), jadi ia butuh
            // pintunya sendiri — tanpa tab ini ia hanya muncul tercampur di "Semua spec".
            { value: "no_effort", label: "Tanpa effort" },
```

`src/src/App.tsx`:

- `goalLockedNow` (baris 110) memakai predikat bersama:

```ts
      const goalLockedNow = !!spec && isGoalShapedFlow(flowForSource(spec.source));
```

- `goalLocked` (baris ~145):

```ts
  const goalLocked = isGoalShapedFlow(flow);
```

- impor: tambahkan `isGoalShapedFlow` ke impor `@hanoman/shared` yang sudah ada di berkas itu.

- di `NewSpecModal`, tambahkan `isNoEffort` dan pakai bentuk goal untuk keduanya:

```ts
  const isGoal = f.kind === "goal";                         // SPEC-407 · backlog goal (Goal → Verifikasi)
  const isNoEffort = f.kind === "no_effort";                // SPEC-825 · backlog remeh (Kerjakan)
  const isGoalShape = isGoal || isNoEffort;                 // bentuk payload yang sama
```

Ganti setiap pemakaian `isGoal` di dalam `NewSpecModal` yang menyangkut **bentuk payload / validasi / field** menjadi `isGoalShape` (yaitu: `submit`, cabang render field `{isGoal ? (` → `{isGoalShape ? (`), dan **biarkan** pemakaian yang menyangkut ikon/judul/tombol tetap membedakan keduanya:

```ts
  const submit = () => { if (!f.title.trim() || (isGoalShape && !f.goal.trim())) return; onCreate(f); };
```

```tsx
    <Modal open={open} onClose={onClose}
      icon={isQa ? "bug" : isAudit ? "search" : isNoEffort ? "zap" : isGoal ? "target" : "lightbulb"} eyebrow="human → hanoman"
      title={isQa ? "QA finding baru" : isAudit ? "Audit baru"
        : isNoEffort ? "Task remeh baru" : isGoal ? "Goal baru" : "Feature brief baru"}
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" leftIcon={isQa ? "radar" : isAudit ? "search" : isNoEffort ? "zap" : isGoal ? "target" : "messages-square"} onClick={submit}>
          {isQa ? "Filekan finding → audit"
            : isAudit ? "Buat audit → investigasi"
            : isNoEffort ? "Buat task → sesi satu fase"
            : isGoal ? "Buat goal → sesi goal" : "Buat brief → brainstorm"}
        </Button>
      </>}>
```

- tab bentuk, sesudah tab `goal`:

```tsx
          // SPEC-825 · ADR-0123 · task remeh: satu fase, tanpa perencanaan maupun verifikasi.
          { value: "no_effort", label: "Tanpa effort", icon: "zap" },
```

- keterangan di bawah tab:

```tsx
          {isNoEffort ? "Sesi satu fase (Kerjakan): langsung mengerjakan lalu berhenti — tanpa brainstorm, spec, plan, maupun fase verifikasi terpisah. Untuk ganti copy, bump konstanta, typo docs."
            : isGoal ? "Sesi goal langsung mengejar goal-nya — tanpa brainstorm, spec, atau plan (fase: Goal → Verifikasi). Sesi lahir dengan mode goal aktif dan menolak berhenti sampai buktinya ada di transkrip."
```

- placeholder judul:

```tsx
          placeholder={isQa ? "mis. Funnel double-count sesi lintas tengah malam"
            : isNoEffort ? "mis. Label tombol Simpan di form backlog"
            : isGoal ? "mis. Latensi daftar backlog" : "mis. Jadwal invoice berulang"}
```

- di `createSpec` (baris ~1147), gerbangkan payload lewat bentuk:

```ts
    const isQa = f.kind === "qa";
    // SPEC-407 · ADR-0089 · SPEC-825 · ADR-0123 · goal & no_effort berbagi bentuk payload; predikat
    // bentuknya satu (`payloadShapeFor`), sumber yang sama dengan gerbang server.
    const isGoalShape = payloadShapeFor(f.kind) === "goal";
```

ganti `: isGoal` menjadi `: isGoalShape` di rantai payload, dan toast:

```ts
      const toastMsg = f.kind === "audit" ? " dibuat · audit-only (dokumen)"
        : f.kind === "no_effort" ? " dibuat · sesi satu fase (Kerjakan)"
        : f.kind === "goal" ? " dibuat · sesi goal (Goal → Verifikasi)"
        : isQa ? " difilekan · masuk audit" : " dibuat · masuk brainstorm";
      showToast(created.id + toastMsg, "ok",
        f.kind === "audit" ? "search" : f.kind === "no_effort" ? "zap"
          : f.kind === "goal" ? "target" : isQa ? "bug" : "lightbulb");
```

Tambahkan `payloadShapeFor` ke impor `@hanoman/shared` di `App.tsx`.

`src/src/api/client.ts` baris 10:

```ts
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "goal" | "no_effort";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest --run src/test/change-source.test.tsx src/test/backlog-no-effort.test.tsx src/test/backlog-goal.test.tsx src/test/start-session-goal.test.tsx src/test/placeholder-contract.test.tsx`
Expected: PASS semua. Bila `placeholder-contract.test.tsx` mengeluh soal placeholder baru, pastikan setiap placeholder yang ditambahkan berbentuk contoh nilai konkret (`mis. …`), bukan instruksi (SPEC-490).

Run: `pnpm --filter ./src typecheck`
Expected: sukses.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/source-meta.ts src/src/screens/BacklogScreen.tsx src/src/App.tsx \
  src/src/api/client.ts src/test/change-source.test.tsx src/test/backlog-no-effort.test.tsx
git commit -m "feat(spec-825): lencana, tab filter, dan form backlog no_effort"
```

---

### Task 5: ADR-0123 dan docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0123-source-no-effort-flow-satu-fase.md`
- Modify: `internal/docs/adr/README.md` (baris teratas daftar)
- Modify: `internal/docs/README.md:73` (baris teratas bagian `## adr`)
- Modify: `internal/docs/architecture/data-model.md:77`, `:89-95`, `:110-111`
- Modify: `internal/docs/architecture/api-contract.md:172`, `:196-205`, `:231`, `:864-868`
- Modify: `internal/skills/hanoman/SKILL.md` (bagian sesudah butir "Backlog goal — sesi dua fase tanpa perencanaan")

**Interfaces:**
- Consumes: keputusan Task 1-4 apa adanya.
- Produces: docs SoT yang menyebut source keenam, flow keenam, fase `Kerjakan`, dan `WORK_PHASES`.

- [ ] **Step 1: Tulis ADR-0123**

Buat `internal/docs/adr/0123-source-no-effort-flow-satu-fase.md` mengikuti bentuk ADR terbaru (`0122-constraints-di-payload-qa.md`): judul `# ADR-0123 — …`, `Status: berlaku`, `Tanggal`, `Konteks`, `Keputusan` (bernomor), `Konsekuensi`, `Alternatif yang ditolak`.

Isi wajib memuat, apa adanya dari design doc:

1. flow satu fase `PIPELINES.no_effort = ["Kerjakan"]`, dan **mengapa nama fasenya harus unik** (peta `REACHED` berkunci nama fase saja);
2. payload **menumpang bentuk `goal`** — beserta alasan yang mengikat: bentuk keempat tak punya field pembeda, sehingga `shapeOfPayload` tak bisa ditulis untuknya; konsekuensinya `Spec.source` satu-satunya pembeda;
3. `WORK_PHASES` sebagai satu daftar fase kerja yang dipakai `writesCode` (runner) **dan** `stageFor` (server), beserta alasannya: rantai `||` yang lupa ditambah tidak gagal, ia cuma menghilangkan `verifyScope`/gaya kode/`exitSkills` diam-diam;
4. `isGoalShapedFlow` — mode goal dipaksa menyala & template global dilewati, cermin ADR-0089;
5. gerbang ADR-0109 mengunci item berjalan **secara otomatis** karena flow berbeda — diuji, bukan dikodekan ulang;
6. tanpa migration (preseden `audit` SPEC-237, `help` ADR-0062, `goal` ADR-0089);
7. `SOURCE_META` wajib berentri — fallback-nya diam.

Alternatif yang ditolak, tulis dengan alasannya: (a) knob "lewati fase Verifikasi" di atas flow `goal` — knob tak mengubah `PIPELINES`, jadi `REACHED`/`phasesComplete`/gate codex tetap menuntut fase yang tak akan pernah ditulis (bentuk SPEC-433); (b) bentuk payload keempat — lihat butir 2; (c) memakai ulang nama fase `Execute` — merusak deteksi fase seluruh flow yang memakainya.

- [ ] **Step 2: Tautkan di kedua index**

`internal/docs/adr/README.md` — tambahkan baris paling atas daftar:

```markdown
- [0123 — Source `no_effort`: flow satu fase `Kerjakan` untuk task remeh, payload menumpang bentuk goal](0123-source-no-effort-flow-satu-fase.md)
```

`internal/docs/README.md` — tambahkan baris yang sama di atas baris `0122`, dengan path `adr/0123-source-no-effort-flow-satu-fase.md`.

- [ ] **Step 3: Perbarui docs arsitektur**

`internal/docs/architecture/data-model.md`:
- baris 77: daftar nilai `source` → `("brief" | "qa" | "audit" | "help" | "goal" | "no_effort")`;
- sesudah paragraf flow `goal` (baris ~89-95): paragraf baru untuk `no_effort` — flow `no_effort` = pipeline **`Kerjakan`** (satu fase), stage `Kerjakan` aktif → `executing`, `Kerjakan` done/skipped → `done`, payload bentuk goal, author `No effort ·`, mode goal dipaksa menyala, tanpa migration;
- baris 110-111: sebutkan bahwa bentuk **goal** dipakai `goal` **dan** `no_effort`.

`internal/docs/architecture/api-contract.md`:
- baris 172 & 196: tambahkan `no_effort` ke daftar nilai `zSpecSource`;
- sesudah blok SPEC-407 (baris ~203-205): blok baru `SPEC-825 · ADR-0123 · source no_effort → flow no_effort (Kerjakan): payload bentuk yang SAMA dengan goal { goal, done, constraints, priority }, author No effort ·`;
- baris 231: daftar nilai `POST /specs/:id/source` += `"no_effort"`, dengan catatan bahwa item yang sudah dimulai selalu ditolak 409 ke/dari sana (flow berbeda);
- baris 864-868: `flow ∈ feature|qa|audit|goal|no_effort`, dan blok penjelas flow `no_effort` (pipeline satu fase, stage `Kerjakan → executing/done`, mode goal dipaksa menyala & template global dilewati — sama seperti `goal`).

- [ ] **Step 4: Perbarui skill project**

`internal/skills/hanoman/SKILL.md` — sesudah butir "**Backlog goal — sesi dua fase tanpa perencanaan** (SPEC-407/ADR-0089…)", tambahkan butir baru bergaya sama:

`- **Task remeh — sesi SATU fase** (SPEC-825/**ADR-0123**, memperluas ADR-0089): source **`no_effort`** → flow **`no_effort`** = `PIPELINES.no_effort = ["Kerjakan"]`. …` — memuat: nama fase wajib unik (peta `REACHED` berkunci nama), payload **menumpang bentuk goal** (tak ada bentuk keempat; `Spec.source` satu-satunya pembeda), **`WORK_PHASES`** sebagai satu daftar fase kerja yang dipakai `writesCode` *dan* `stageFor` beserta gotcha "rantai `||` yang lupa ditambah tidak gagal, ia cuma menghilangkan klausa", `isGoalShapedFlow` (mode goal dipaksa & template global dilewati), gerbang ADR-0109 yang mengunci item berjalan otomatis, `SOURCE_META` yang fallback-nya diam, dan "tanpa migration".

Sesuaikan juga penyebutan "lima source"/"tiga bentuk" di sekitar baris 351-360 SKILL.md menjadi **enam source → tiga bentuk**.

- [ ] **Step 5: Verifikasi integritas index & commit**

Run: `node cli/dist/index.js docs index --check` — bila `cli/dist` belum dibangun, jalankan `pnpm --filter ./cli build` lebih dulu; bila tetap tak tersedia, verifikasi manual bahwa `internal/docs/adr/0123-*.md` muncul di `internal/docs/README.md` **dan** `internal/docs/adr/README.md`.
Expected: tidak ada doc yang tak ter-link.

```bash
git add internal/docs internal/skills
git commit -m "docs(adr-0123): source no_effort — flow satu fase Kerjakan"
```

---

### Task 6: Verifikasi end-to-end & penutupan

**Files:**
- Test: seluruh berkas test yang tersentuh perubahan ini.

**Interfaces:**
- Consumes: Task 1-5.
- Produces: bukti hijau + satu smoke endpoint nyata.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism --changed "$HANOMAN_BASE_SHA"
```
Expected: PASS, dan **jumlah berkas test yang berjalan > 0**. `--changed` menyalakan `passWithNoTests` — "no test files" BUKAN bukti hijau. Bila nol berkas berjalan, sebut path test-nya langsung.

- [ ] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck`
Expected: keempatnya sukses. (Empat paket memang tersentuh — ini bukan `pnpm -r typecheck`.)

- [ ] **Step 3: Smoke endpoint nyata (sekali, di akhir)**

Boot server dengan DB khusus lalu buat & baca satu item `no_effort`:

```bash
DB=$(mktemp -d)/smoke.db
HANOMAN_HOME=$(mktemp -d) DATABASE_URL="file:$DB" node server/dist/server.js &
# tunggu port siap, lalu:
curl -sS -X POST localhost:4000/api/specs -H 'content-type: application/json' \
  -d '{"project":"<id>","source":"no_effort","title":"smoke","priority":"rendah",
       "payload":{"goal":"g","done":"","constraints":"","priority":"rendah"}}'
curl -sS 'localhost:4000/api/specs?source=no_effort'
```

Expected: `201` dengan `source:"no_effort"`, `author` berprefiks `No effort ·`, `objective:"g"`; daftar berfilter memuat item itu. Kirim juga payload bentuk brief untuk `source:"no_effort"` dan pastikan balasannya **400** `"bentuk payload tak cocok dengan source"`. Matikan server per-PID (`lsof -ti:4000` → `kill <pid>`) — **jangan** `pkill -f`.

- [ ] **Step 4: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-825
```
