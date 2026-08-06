# SPEC-546 — Ubah type/source backlog item · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sebuah backlog item bisa dipindah `source`-nya ke source mana pun yang didukung
(`brief`·`qa`·`audit`·`help`·`goal`) **in-place** — id SPEC-nnn, riwayat, dependency, dan dokumen
sesi tetap — lewat endpoint khusus, dengan jejak konversi yang terbaca mesin.

**Architecture:** Satu predikat "source ↔ bentuk payload" di `@hanoman/shared` yang dipakai
`zCreateSpec` **dan** jalur konversi (tak ada validasi kedua). Satu fungsi murni `convertPayload`
yang dipakai UI untuk prefill form **dan** server sebagai default. Endpoint khusus
`POST /specs/:id/source` (preseden ADR-0064 rename project) dengan gerbang yang mengunci **flow**,
bukan label. Kolom baru `Spec.sourceHistory` menyimpan jejak berikut **payload bentuk lama utuh**,
sehingga konversi beda-bentuk tak pernah kehilangan prosa.

**Tech Stack:** TypeScript strict · zod · Fastify · Prisma 6 + SQLite · React 18 + Vite · vitest.

## Global Constraints

- **Bahasa komentar & pesan: Indonesia**, mengikuti gaya berkas yang disunting (padat, menyebut
  SPEC/ADR, menjelaskan *kenapa* bukan *apa*).
- **`cross-audit` TIDAK ADA** — dicabut SPEC-384/ADR-0092. Daftar source yang sah adalah
  `zSpecSource` = `["brief","qa","audit","help","goal"]`. Jangan menambah nilai enum.
- **Migration additif saja** (VPS = hub produksi): satu `ALTER TABLE … ADD COLUMN` nullable,
  ditulis tangan, **jangan** `prisma migrate dev` (worktree tetangga bikin ia me-reset DB).
- **Tanpa jalur validasi kedua**: bentuk payload divalidasi HANYA lewat `payloadMatchesSource`
  dan union `zBriefPayload|zQaPayload|zGoalPayload` yang sudah ada.
- **Jangan sentuh** `PATCH /specs/:id`, `zSpecSource`, `flowForSource`, `PIPELINES`, `Flow`.
- **Perintah test wajib** (mesin ini menjalankan beberapa sesi sekaligus):
  ```bash
  export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
  ./node_modules/.bin/vitest --run --no-file-parallelism <path…>
  ```
  Jalankan dari **root repo** (cwd Bash bertahan antar-panggilan — `--changed` dari subdir paket
  hanya melihat sebagian berkas). Untuk test web tambahkan `env -u NODE_ENV`.
- **Jangan** `pnpm test`, `pnpm -r typecheck`, build penuh, `pkill -f`. Typecheck hanya paket yang
  tersentuh: `pnpm --filter ./shared typecheck`, `pnpm --filter ./server typecheck`,
  `pnpm --filter ./src typecheck`.
- **Docs yang tersentuh diperbarui dalam commit yang sama** dan di-link di
  `internal/docs/README.md` **dan** `internal/docs/adr/README.md`.

## File Structure

**Create**
| Berkas | Tanggung jawab |
|---|---|
| `shared/src/spec-source.ts` | SELURUH pengetahuan murni tentang source ↔ bentuk payload: predikat bentuk, peta prioritas↔severity, `convertPayload`, tipe `SourceChange` |
| `shared/src/spec-source.test.ts` | test predikat bentuk + regresi `zCreateSpec` |
| `shared/src/spec-source-convert.test.ts` | test tabel konversi + round-trip |
| `server/src/services/spec-fields.ts` | `deriveSpecFields` (dipindah dari `routes/specs.ts` agar bisa dipakai dua pemanggil) |
| `server/src/services/spec-source.ts` | gerbang konversi (murni) + perakit entri jejak |
| `server/prisma/migrations/20260806000000_spec_source_history/migration.sql` | kolom `Spec.sourceHistory` |
| `server/test/spec-source.route.test.ts` | test endpoint + gerbang + notifikasi |
| `server/test/spec-source-contract.test.ts` | kontrak sync/webhook kolom baru |
| `src/src/screens/source-meta.ts` | SATU katalog UI source (lencana, opsi select, daftar field per bentuk) |
| `src/src/screens/ChangeSourceDialog.tsx` | dialog "Ubah type" |
| `src/test/change-source.test.tsx` | test render dialog + lencana/tab `help` |
| `internal/docs/adr/0109-ubah-source-backlog-item.md` | ADR |

**Modify**
| Berkas | Perubahan |
|---|---|
| `shared/src/enums.ts` | — (tak berubah; dirujuk saja) |
| `shared/src/entities.ts` | `zSourceChange` + `zSpec.sourceHistory` |
| `shared/src/dto.ts` | `zCreateSpec.superRefine` memanggil predikat bersama; `zChangeSpecSource` |
| `shared/src/api.ts` | `paths.specSource` |
| `shared/src/index.ts` | `export * from "./spec-source"` |
| `shared/src/webhook.ts` | derived event `spec.source_changed` + sample |
| `server/prisma/schema.prisma` | kolom `sourceHistory Json?` |
| `server/src/services/sync.ts` | `FIELDS.spec` += `sourceHistory` |
| `server/src/services/notifications.ts` | `recordSourceChange` |
| `server/src/routes/specs.ts` | route `POST /specs/:id/source`; `deriveSpecFields` diimpor |
| `src/src/api/client.ts` | `changeSpecSource` |
| `src/src/screens/BacklogScreen.tsx` | pakai `source-meta.ts`; tombol "Ubah type"; blok jejak; tab `help` |
| `src/src/App.tsx` | handler `changeSourceOfSpec` + wiring |
| `internal/docs/README.md`, `internal/docs/adr/README.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/architecture/data-model.md`, `internal/skills/hanoman/SKILL.md` | docs |

---

### Task 1: Predikat bentuk payload — satu definisi untuk POST /specs dan konversi

**Files:**
- Create: `shared/src/spec-source.ts`
- Create: `shared/src/spec-source.test.ts`
- Modify: `shared/src/dto.ts:61-77` (superRefine `zCreateSpec`), `shared/src/index.ts`

**Interfaces:**
- Consumes: `zSpecSource`, `zPriority`, `zSeverity` dari `shared/src/enums.ts`
- Produces:
  - `type PayloadShape = "brief" | "qa" | "goal"`
  - `payloadShapeFor(source: string): PayloadShape`
  - `shapeOfPayload(payload: unknown): PayloadShape`
  - `payloadMatchesSource(source: string, payload: unknown): boolean`
  - `zChangeSpecSource` (di `dto.ts`) — `{ source: SpecSource; payload?: BriefPayload|QaPayload|GoalPayload }`

- [ ] **Step 1: Tulis test yang gagal**

Buat `shared/src/spec-source.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { payloadShapeFor, shapeOfPayload, payloadMatchesSource } from "./spec-source";
import { zCreateSpec, zChangeSpecSource } from "./dto";
import { zSpecSource } from "./enums";

const brief = { context: "c", outcome: "o", constraints: "", priority: "sedang" as const };
const qa = { severity: "major" as const, steps: "s", expected: "e", actual: "a", env: "prod" };
const goal = { goal: "g", done: "d", constraints: "", priority: "sedang" as const };

describe("SPEC-546 · bentuk payload per source (satu predikat)", () => {
  it("lima source memetakan ke tiga bentuk", () => {
    expect(zSpecSource.options).toEqual(["brief", "qa", "audit", "help", "goal"]);
    expect(zSpecSource.options.map(payloadShapeFor))
      .toEqual(["brief", "qa", "brief", "brief", "goal"]);
  });

  it("shapeOfPayload mengenali ketiga bentuk; payload null dibaca sebagai brief", () => {
    expect(shapeOfPayload(brief)).toBe("brief");
    expect(shapeOfPayload(qa)).toBe("qa");
    expect(shapeOfPayload(goal)).toBe("goal");
    expect(shapeOfPayload(null)).toBe("brief");
  });

  it("payloadMatchesSource benar untuk seluruh matriks 5×3", () => {
    for (const s of zSpecSource.options)
      for (const [shape, p] of [["brief", brief], ["qa", qa], ["goal", goal]] as const)
        expect(payloadMatchesSource(s, p)).toBe(payloadShapeFor(s) === shape);
  });

  // Regresi SPEC-197/407: gerbang POST /specs tak boleh melemah setelah predikatnya diekstrak.
  it("zCreateSpec tetap menolak kombinasi source × payload yang salah", () => {
    const base = { project: "p", title: "t", priority: "sedang" as const };
    expect(zCreateSpec.safeParse({ ...base, source: "qa", payload: brief }).success).toBe(false);
    expect(zCreateSpec.safeParse({ ...base, source: "brief", payload: goal }).success).toBe(false);
    expect(zCreateSpec.safeParse({ ...base, source: "goal", payload: qa }).success).toBe(false);
    expect(zCreateSpec.safeParse({ ...base, source: "help", payload: brief }).success).toBe(true);
    expect(zCreateSpec.safeParse({ ...base, source: "qa", payload: qa }).success).toBe(true);
  });

  it("zChangeSpecSource: payload opsional, tapi bila ada wajib cocok source tujuan", () => {
    expect(zChangeSpecSource.safeParse({ source: "qa" }).success).toBe(true);
    expect(zChangeSpecSource.safeParse({ source: "qa", payload: qa }).success).toBe(true);
    expect(zChangeSpecSource.safeParse({ source: "qa", payload: brief }).success).toBe(false);
    expect(zChangeSpecSource.safeParse({ source: "bukan-source" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-546
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
./node_modules/.bin/vitest --run --no-file-parallelism shared/src/spec-source.test.ts
```
Expected: FAIL — `Failed to resolve import "./spec-source"`.

- [ ] **Step 3: Buat `shared/src/spec-source.ts`**

```ts
import { z } from "zod";
import { zPriority, zSeverity, zSpecSource } from "./enums";

// SPEC-546 · ADR-0109 · SELURUH pengetahuan murni tentang "source mana memakai bentuk payload
// mana" hidup di berkas ini. Sebelumnya predikat itu inline di `zCreateSpec.superRefine`, jadi
// jalur konversi baru hanya bisa memakainya dengan MENYALIN — dan salinan predikat adalah kelas
// bug yang sudah menggigit repo ini berkali-kali (SPEC-431/448/475/481). Di sini ia satu.
export type SpecSource = z.infer<typeof zSpecSource>;
export type Priority = z.infer<typeof zPriority>;
export type Severity = z.infer<typeof zSeverity>;

/** Lima source dilayani TIGA bentuk payload (SPEC-197 · SPEC-407 · ADR-0089). */
export type PayloadShape = "brief" | "qa" | "goal";

/** source → bentuk yang WAJIB dipakai payload-nya. */
export function payloadShapeFor(source: string): PayloadShape {
  return source === "qa" ? "qa" : source === "goal" ? "goal" : "brief";
}

/**
 * payload → bentuk yang sebenarnya ia pakai. Kunci pembedanya field yang hanya dimiliki satu
 * bentuk (`severity` milik qa, `goal` milik goal); union zod sendiri tak menjaganya karena
 * objeknya non-strict. `null` (kolom `payload` nullable) dibaca sebagai brief — bentuk default
 * item lama — supaya pemanggil server tak perlu menjaga cabang null sendiri-sendiri.
 */
export function shapeOfPayload(payload: unknown): PayloadShape {
  const p = (payload ?? {}) as Record<string, unknown>;
  return "severity" in p ? "qa" : "goal" in p ? "goal" : "brief";
}

export function payloadMatchesSource(source: string, payload: unknown): boolean {
  return shapeOfPayload(payload) === payloadShapeFor(source);
}
```

- [ ] **Step 4: Ekspor dari barrel**

Di `shared/src/index.ts`, sisipkan setelah baris `export * from "./enums";`:

```ts
export * from "./spec-source";
```

- [ ] **Step 5: `zCreateSpec` memanggil predikat bersama + tambah `zChangeSpecSource`**

Di `shared/src/dto.ts`, tambahkan import (setelah baris 10):

```ts
import { payloadMatchesSource } from "./spec-source";
```

Ganti blok `superRefine` `zCreateSpec` (baris 67-77) dengan:

```ts
  // SPEC-197 · ikat source ke bentuk payload: union saja tak menjaganya (objek non-strict), jadi
  // `deriveSpecFields` bisa menurunkan objective/priority dari bentuk yang salah.
  // SPEC-546 · ADR-0109 · predikatnya kini hidup di `spec-source.ts` dan dipakai jalur konversi
  // juga — satu definisi, bukan dua yang bisa melenceng.
  .superRefine((o, ctx) => {
    if (!payloadMatchesSource(o.source, o.payload))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "bentuk payload tak cocok dengan source" });
  });
```

Tambahkan tepat sesudah definisi `zPatchSpec` (setelah baris 99):

```ts
// SPEC-546 · ADR-0109 · ubah type/source item IN-PLACE. Operasi khusus, bukan field `zPatchSpec`:
// gerbangnya berbeda dari `editingContent` (SPEC-186) dan preseden ADR-0064 (rename project)
// sudah menetapkan bentuk ini untuk perubahan yang punya gerbang & efek sampingnya sendiri.
// `payload` OPSIONAL: tak dikirim = server memakai `convertPayload` (jalur agen lewat REST).
export const zChangeSpecSource = z.object({
  source: zSpecSource,
  payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]).optional(),
}).superRefine((o, ctx) => {
  if (o.payload !== undefined && !payloadMatchesSource(o.source, o.payload))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "bentuk payload tak cocok dengan source" });
});
```

- [ ] **Step 6: Jalankan test — harus lulus**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism shared/src/spec-source.test.ts
```
Expected: PASS, 5 test.

- [ ] **Step 7: Typecheck shared**

```bash
pnpm --filter ./shared typecheck
```
Expected: keluar tanpa error.

- [ ] **Step 8: Commit**

```bash
git add shared/src/spec-source.ts shared/src/spec-source.test.ts shared/src/dto.ts shared/src/index.ts
git commit -m "feat(spec-546): predikat bentuk payload per source jadi satu definisi bersama"
```

---

### Task 2: `convertPayload` — peta konversi antar-bentuk

**Files:**
- Modify: `shared/src/spec-source.ts` (tambah di bawah)
- Create: `shared/src/spec-source-convert.test.ts`

**Interfaces:**
- Consumes: `payloadShapeFor`, `shapeOfPayload` (Task 1)
- Produces:
  - `priorityFromSeverity(severity: unknown): Priority`
  - `severityFromPriority(priority: unknown): Severity`
  - `interface PayloadConversion { payload: Record<string, unknown>; dropped: string[]; missing: string[] }`
  - `convertPayload(to: string, payload: unknown): PayloadConversion`
  - `SHAPE_REQUIRED: Record<PayloadShape, readonly string[]>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `shared/src/spec-source-convert.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convertPayload, priorityFromSeverity, severityFromPriority } from "./spec-source";

const brief = { context: "gejalanya", outcome: "maunya", constraints: "tanpa cache", priority: "tinggi" as const };
const qa = { severity: "minor" as const, steps: "1. buka", expected: "maunya", actual: "gejalanya", env: "prod" };
const goal = { goal: "p95 < 200 ms", done: "output benchmark", constraints: "tanpa cache", priority: "rendah" as const };

describe("SPEC-546 · peta prioritas ↔ severity", () => {
  it("priorityFromSeverity mencerminkan aturan deriveSpecFields", () => {
    expect(priorityFromSeverity("minor")).toBe("sedang");
    expect(priorityFromSeverity("major")).toBe("tinggi");
    expect(priorityFromSeverity("critical")).toBe("tinggi");
  });
  it("severityFromPriority adalah invers 3→2 nilai yang dinyatakan", () => {
    expect(severityFromPriority("tinggi")).toBe("major");
    expect(severityFromPriority("sedang")).toBe("minor");
    expect(severityFromPriority("rendah")).toBe("minor");
  });
});

describe("SPEC-546 · convertPayload", () => {
  it("sebentuk (brief → audit/help) tak mengubah apa pun", () => {
    const c = convertPayload("help", brief);
    expect(c.payload).toEqual(brief);
    expect(c.dropped).toEqual([]);
    expect(c.missing).toEqual([]);
  });

  it("brief → qa: context→actual, outcome→expected, severity dari priority", () => {
    const c = convertPayload("qa", brief);
    expect(c.payload).toEqual({
      severity: "major", steps: "", expected: "maunya", actual: "gejalanya", env: "",
    });
    expect(c.dropped).toEqual(["constraints"]);
    expect(c.missing).toEqual(["steps", "env"]);
  });

  it("qa → brief: actual→context, expected→outcome, priority dari severity", () => {
    const c = convertPayload("brief", qa);
    expect(c.payload).toEqual({
      context: "gejalanya", outcome: "maunya", constraints: "", priority: "sedang",
    });
    expect(c.dropped).toEqual(["steps", "env"]);
    expect(c.missing).toEqual([]);
  });

  it("brief → goal: outcome jadi goal, context yang tak terpakai dilaporkan dropped", () => {
    const c = convertPayload("goal", brief);
    expect(c.payload).toEqual({
      goal: "maunya", done: "", constraints: "tanpa cache", priority: "tinggi",
    });
    expect(c.dropped).toEqual(["context"]);
    expect(c.missing).toEqual(["done"]);
  });

  it("brief tanpa outcome → goal: context NAIK jadi goal, jadi tak ada yang dibuang", () => {
    const c = convertPayload("goal", { ...brief, outcome: "" });
    expect(c.payload.goal).toBe("gejalanya");
    expect(c.dropped).toEqual([]);
  });

  it("goal → brief: goal jadi outcome, done dilaporkan dropped", () => {
    const c = convertPayload("brief", goal);
    expect(c.payload).toEqual({
      context: "", outcome: "p95 < 200 ms", constraints: "tanpa cache", priority: "rendah",
    });
    expect(c.dropped).toEqual(["done"]);
    expect(c.missing).toEqual(["context"]);
  });

  it("qa → goal: expected jadi goal, jejak reproduksi dilaporkan dropped", () => {
    const c = convertPayload("goal", qa);
    expect(c.payload).toEqual({ goal: "maunya", done: "", constraints: "", priority: "sedang" });
    expect(c.dropped).toEqual(["steps", "actual", "env"]);
    expect(c.missing).toEqual(["done"]);
  });

  it("goal → qa: goal jadi expected, done+constraints dilaporkan dropped", () => {
    const c = convertPayload("qa", goal);
    expect(c.payload).toEqual({
      severity: "minor", steps: "", expected: "p95 < 200 ms", actual: "", env: "",
    });
    expect(c.dropped).toEqual(["done", "constraints"]);
    expect(c.missing).toEqual(["steps", "actual", "env"]);
  });

  it("fromAudit ikut menyeberang antar brief↔qa, dan dilaporkan dropped saat ke goal", () => {
    const withAudit = { ...brief, fromAudit: "SPEC-400" };
    expect(convertPayload("qa", withAudit).payload.fromAudit).toBe("SPEC-400");
    expect(convertPayload("goal", withAudit).payload.fromAudit).toBeUndefined();
    expect(convertPayload("goal", withAudit).dropped).toEqual(["context", "fromAudit"]);
  });

  // Konstrain SPEC-546: round-trip brief → qa → brief.
  it("round-trip brief→qa→brief: prosa selamat; constraints hilang & priority bergeser sesuai peta 3→2", () => {
    const back = convertPayload("brief", convertPayload("qa", brief).payload);
    expect(back.payload.context).toBe(brief.context);
    expect(back.payload.outcome).toBe(brief.outcome);
    // Yang TIDAK selamat, dinyatakan bukan disembunyikan:
    expect(back.payload.constraints).toBe("");
    expect(convertPayload("qa", brief).dropped).toContain("constraints");
    expect(back.payload.priority).toBe("tinggi");   // tinggi → major → tinggi
    // Prioritas rendah tak bisa round-trip: peta severity hanya punya dua nilai.
    const low = convertPayload("brief", convertPayload("qa", { ...brief, priority: "rendah" }).payload);
    expect(low.payload.priority).toBe("sedang");
  });

  it("payload null (item lama) dibaca sebagai brief kosong, tak melempar", () => {
    const c = convertPayload("qa", null);
    expect(c.payload).toEqual({ severity: "minor", steps: "", expected: "", actual: "", env: "" });
    expect(c.dropped).toEqual([]);
    expect(c.missing).toEqual(["steps", "expected", "actual", "env"]);
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism shared/src/spec-source-convert.test.ts
```
Expected: FAIL — `convertPayload is not a function`.

- [ ] **Step 3: Implementasi di `shared/src/spec-source.ts`**

Tambahkan di akhir berkas:

```ts
/**
 * Cermin aturan yang sudah dipakai `deriveSpecFields` sejak SPEC-186: severity `minor` → prioritas
 * `sedang`, selain itu `tinggi`. Diekspor supaya `deriveSpecFields` memakai fungsi INI, bukan
 * menyalin ternarinya.
 */
export function priorityFromSeverity(severity: unknown): Priority {
  return severity === "minor" ? "sedang" : "tinggi";
}

/**
 * Invers yang sengaja LOSSY: prioritas punya tiga nilai, severity yang bisa diturunkan darinya
 * hanya dua (`tinggi` ⇒ `major`, sisanya `minor`). Konsekuensinya `rendah → minor → sedang` —
 * dinyatakan di ADR-0109 dan diuji, bukan disembunyikan.
 */
export function severityFromPriority(priority: unknown): Severity {
  return priority === "tinggi" ? "major" : "minor";
}

export interface PayloadConversion {
  /** Payload dalam bentuk source tujuan. */
  payload: Record<string, unknown>;
  /** Field payload LAMA yang tak punya tujuan — utuh tersimpan di `Spec.sourceHistory`. */
  dropped: string[];
  /** Field WAJIB bentuk tujuan yang lahir kosong; dialog memintanya ke operator. */
  missing: string[];
}

/**
 * Field bentuk tujuan yang dianggap harus terisi. `constraints` sengaja TIDAK di sini: kosong
 * itu keadaan normal untuk brief maupun goal, dan menandainya "kurang" tiap konversi jadi
 * kebisingan. `severity`/`priority` juga tidak: keduanya selalu punya nilai turunan.
 */
export const SHAPE_REQUIRED: Record<PayloadShape, readonly string[]> = {
  brief: ["context", "outcome"],
  qa: ["steps", "expected", "actual", "env"],
  goal: ["goal", "done"],
};

/**
 * Peta konversi payload antar-bentuk. MURNI, dipakai DUA pemanggil: dialog UI memakainya untuk
 * prefill form, server memakainya sebagai default saat `payload` tak dikirim (jalur agen lewat
 * REST). Satu definisi — pola `resolveAutoMerge`/`flowForSource`.
 *
 * Aturan yang mengikat: **field-ke-field, tak pernah menyambung dua field jadi satu.** Prosa yang
 * disambung tak bisa diurai lagi, sementara operator toh ada di depan form. Yang tak punya padanan
 * masuk `dropped`, diberitahukan di dialog, dan tersimpan UTUH di `Spec.sourceHistory` — itulah
 * yang membuat kehilangan di sini tak pernah jadi kehilangan sungguhan.
 */
export function convertPayload(to: string, payload: unknown): PayloadConversion {
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const prio = (): Priority =>
    p.priority === "tinggi" || p.priority === "rendah" ? p.priority : "sedang";
  const nonEmpty = (fields: string[]) => fields.filter((f) => str(f) !== "");
  const fromShape = shapeOfPayload(payload);
  const toShape = payloadShapeFor(to);
  const fromAudit = str("fromAudit");

  const done = (out: Record<string, unknown>, dropped: string[]): PayloadConversion => ({
    payload: out, dropped,
    missing: SHAPE_REQUIRED[toShape].filter(
      (f) => typeof out[f] !== "string" || out[f] === ""),
  });

  // Sebentuk (brief ↔ audit ↔ help): payload tak berubah sama sekali.
  if (fromShape === toShape) return { payload: { ...p }, dropped: [], missing: [] };

  if (toShape === "qa") {
    if (fromShape === "brief")
      return done({
        severity: severityFromPriority(prio()), steps: "", expected: str("outcome"),
        actual: str("context"), env: "", ...(fromAudit ? { fromAudit } : {}),
      }, nonEmpty(["constraints"]));
    return done({
      severity: severityFromPriority(prio()), steps: "", expected: str("goal"),
      actual: "", env: "",
    }, nonEmpty(["done", "constraints"]));
  }

  if (toShape === "goal") {
    if (fromShape === "brief") {
      const goal = str("outcome") || str("context");
      // `context` hanya hilang bila ia TAK dipakai sebagai goal.
      return done({ goal, done: "", constraints: str("constraints"), priority: prio() },
        nonEmpty([...(str("outcome") ? ["context"] : []), "fromAudit"]));
    }
    return done({
      goal: str("expected"), done: "", constraints: "",
      priority: priorityFromSeverity(p.severity),
    }, nonEmpty(["steps", "actual", "env", "fromAudit"]));
  }

  // → bentuk brief (brief | audit | help)
  if (fromShape === "qa")
    return done({
      context: str("actual"), outcome: str("expected"), constraints: "",
      priority: priorityFromSeverity(p.severity), ...(fromAudit ? { fromAudit } : {}),
    }, nonEmpty(["steps", "env"]));
  return done({
    context: "", outcome: str("goal"), constraints: str("constraints"), priority: prio(),
  }, nonEmpty(["done"]));
}

/**
 * Satu baris jejak konversi (`Spec.sourceHistory`). `payload` = bentuk LAMA utuh — itulah yang
 * membuat `dropped` di atas bukan kehilangan sungguhan.
 */
export interface SourceChange {
  at: string; from: string; to: string; by: string; payload?: unknown;
}
```

- [ ] **Step 4: Jalankan test — harus lulus**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism shared/src/spec-source-convert.test.ts shared/src/spec-source.test.ts
```
Expected: PASS, 16 test.

- [ ] **Step 5: Typecheck shared**

```bash
pnpm --filter ./shared typecheck
```
Expected: keluar tanpa error.

- [ ] **Step 6: Commit**

```bash
git add shared/src/spec-source.ts shared/src/spec-source-convert.test.ts
git commit -m "feat(spec-546): convertPayload — peta konversi payload antar bentuk source"
```

---

### Task 3: Kolom `Spec.sourceHistory` + kontrak sync & webhook

**Files:**
- Modify: `server/prisma/schema.prisma:36-70` (model `Spec`)
- Create: `server/prisma/migrations/20260806000000_spec_source_history/migration.sql`
- Modify: `server/src/services/sync.ts:47` (`FIELDS.spec`)
- Modify: `shared/src/entities.ts:39-66` (`zSourceChange`, `zSpec`)
- Modify: `shared/src/webhook.ts:97-101` (derived) dan `shared/src/webhook.ts:327` (sample)
- Create: `server/test/spec-source-contract.test.ts`

**Interfaces:**
- Consumes: `SourceChange` (Task 2)
- Produces: kolom `Spec.sourceHistory` (Json?), `zSourceChange`, `zSpec.sourceHistory`,
  event webhook `spec.source_changed`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/spec-source-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { __FIELDS, __DATE_FIELDS } from "../src/services/sync";
import { WEBHOOK_ENTITIES, eventTypeFor } from "@hanoman/shared";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

describe("SPEC-546 · ADR-0109 · kontrak kolom sourceHistory", () => {
  it("ikut menyeberang sync — tanpa ini jejak konversi berhenti di satu mesin", () => {
    expect(__FIELDS.spec).toContain("sourceHistory");
    expect(__FIELDS.spec).toContain("source");   // kontrol negatif: source memang sudah ikut
  });

  it("BUKAN DATE_FIELDS — `at` hidup DI DALAM JSON, kolomnya sendiri bukan DateTime", () => {
    expect(__DATE_FIELDS.spec).not.toContain("sourceHistory");
  });

  it("TIDAK masuk allowlist webhook — ia membawa payload, dan payload memang dikecualikan", () => {
    const spec = WEBHOOK_ENTITIES.find((d) => d.entity === "spec")!;
    expect(spec.fields).not.toContain("sourceHistory");
    expect(spec.fields).not.toContain("payload");   // kontrol negatif
    expect(spec.fields).toContain("source");
  });

  it("perubahan `source` memancarkan spec.source_changed, menggantikan spec.updated", () => {
    const spec = WEBHOOK_ENTITIES.find((d) => d.entity === "spec")!;
    expect(eventTypeFor(spec, "updated", ["source"])).toBe("spec.source_changed");
    expect(eventTypeFor(spec, "updated", ["stage"])).toBe("spec.stage_changed");
    expect(eventTypeFor(spec, "updated", ["title"])).toBe("spec.updated");
  });

  it("kolomnya benar-benar ada di DB dan menerima array objek", async () => {
    await resetDb();
    await makeProject({ id: "psh" });
    await makeSpec({ id: "SPEC-900", projectId: "psh" });
    await prisma.spec.update({
      where: { id: "SPEC-900" },
      data: { sourceHistory: [{ at: "2026-08-06T00:00:00.000Z", from: "brief", to: "qa", by: "x", payload: { context: "c" } }] },
    });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-900" } });
    expect((row!.sourceHistory as unknown[]).length).toBe(1);
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
./node_modules/.bin/vitest --run --no-file-parallelism server/test/spec-source-contract.test.ts
```
Expected: FAIL — `expected [...] to contain 'sourceHistory'`.

- [ ] **Step 3: Tambah kolom di `server/prisma/schema.prisma`**

Di model `Spec`, tepat sesudah blok komentar+kolom `autoMerge` (sebelum `updatedAt`), sisipkan:

```prisma
  // SPEC-546 · ADR-0109 · jejak konversi type item ini: array append-only
  // [{ at, from, to, by, payload }] dengan `payload` = BENTUK LAMA UTUH. Kolom, bukan turunan —
  // aturan ADR-0090 bukan "selalu turunkan" melainkan *bisakah dihitung ulang dari sumber lain*,
  // dan kapan sebuah baris berganti type tidak bisa. `payload` lama disimpan di sini justru
  // supaya field yang tak punya padanan di bentuk baru (`convertPayload().dropped`) tidak lenyap.
  // Ikut FIELDS.spec sync; TIDAK masuk allowlist webhook (ia membawa payload).
  sourceHistory Json?
```

- [ ] **Step 4: Tulis migration tangan**

Buat `server/prisma/migrations/20260806000000_spec_source_history/migration.sql`:

```sql
-- SPEC-546 · ADR-0109 · jejak konversi type backlog item.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu kolom NULLABLE tanpa default, tak ada tabel diredefinisi, jadi
-- aman untuk hub produksi.
--
-- TANPA backfill, dan itu disengaja: sebelum SPEC-546 mengubah `source` sebuah item memang tidak
-- mungkin, jadi tak ada jejak lama yang bisa dipulihkan dari sumber mana pun. NULL di sini
-- berarti persis "item ini belum pernah dikonversi".
ALTER TABLE "Spec" ADD COLUMN "sourceHistory" JSONB;
```

- [ ] **Step 5: Terapkan migration + regenerate client**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
DATABASE_URL="$TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy --schema server/prisma/schema.prisma
./node_modules/.bin/prisma generate --schema server/prisma/schema.prisma
```
Expected: `All migrations have been successfully applied.` lalu `Generated Prisma Client`.

- [ ] **Step 6: Masukkan kolom ke whitelist sync**

Di `server/src/services/sync.ts`, ganti baris 47 (array `spec`) menjadi:

```ts
  // SPEC-546 · ADR-0109 · sourceHistory ikut menyeberang: jejak konversi type adalah bagian
  // keadaan yang harus dilihat sama oleh semua mesin. `upsert` yang tak menyebut sebuah kolom
  // TETAP berhasil, jadi kolom yang terlewat di sini mendarat sebagai null palsu di tiap client
  // tanpa satu pun error (kelas gagal-senyap ADR-0090/0093/0094/0105). BUKAN DATE_FIELDS —
  // `at` hidup di dalam JSON-nya, kolomnya sendiri bukan DateTime.
  spec: ["projectId", "title", "source", "stage", "priority", "author", "objective", "payload", "branchFrom", "baseSha", "headSha", "dependsOn", "sourceHistory", "createdAt", "startedAt", "doneAt", "updatedAt"],
```

- [ ] **Step 7: Tambah `zSourceChange` + field di `zSpec`**

Di `shared/src/entities.ts`, tepat sebelum `export const zSpec = z.object({` (baris 47), sisipkan:

```ts
// SPEC-546 · ADR-0109 · satu baris jejak konversi type. `payload` = bentuk LAMA utuh — itulah
// yang membuat field tanpa padanan di bentuk baru tidak pernah benar-benar hilang.
export const zSourceChange = z.object({
  at: z.string(), from: z.string(), to: z.string(), by: z.string(),
  payload: z.unknown().optional(),
});
export type SourceChange = z.infer<typeof zSourceChange>;
```

Di dalam `zSpec`, tepat sesudah field `autoMerge` (baris 65), sisipkan:

```ts
  // SPEC-546 · ADR-0109 · jejak konversi type. `.default([])` menjaga respons/klien versi lama
  // tetap parse; kolom DB-nya `Json?` sehingga baris yang belum pernah dikonversi mengirim
  // `null` — pemakai UI menulis `spec.sourceHistory ?? []`, cermin `blockedBy`.
  sourceHistory: z.array(zSourceChange).default([]),
```

`SourceChange` kini terdefinisi di DUA berkas (`spec-source.ts` interface + `entities.ts` z.infer).
Hapus `export interface SourceChange` dari `shared/src/spec-source.ts` (Task 2 Step 3) dan ganti
dengan re-export supaya tetap satu tipe:

```ts
// SPEC-546 · tipe barisnya milik skema (`zSourceChange` di entities.ts) — di sini cukup dirujuk
// supaya pemakai `spec-source.ts` tak perlu tahu dari berkas mana ia datang.
export type { SourceChange } from "./entities";
```

- [ ] **Step 8: Tambah event webhook turunan**

Di `shared/src/webhook.ts`, ganti array `derived` entitas `spec` (baris 97-101) menjadi:

```ts
    derived: [{
      type: "spec.stage_changed", label: "Stage backlog berpindah", changed: ["stage"],
      when: "Stage berpindah — baik oleh fase sesi yang tercatat (otomatis) maupun revert manual operator. Menggantikan spec.updated untuk perubahan itu.",
    }, {
      // SPEC-546 · ADR-0109 · konversi type item. Pola yang sama dengan stage_changed: peristiwa
      // turunan MENGGANTIKAN spec.updated, supaya penerima bisa bereaksi pada "type berpindah"
      // tanpa mendiff dua amplop.
      type: "spec.source_changed", label: "Type backlog berpindah", changed: ["source"],
      when: "Type/source item backlog dikonversi lewat POST /specs/:id/source (mis. brief → qa). Menggantikan spec.updated untuk perubahan itu.",
    }],
```

Di fungsi `sampleEnvelope` (baris 327), ganti baris `const changed = …` menjadi:

```ts
  const changed = type === "spec.stage_changed" ? ["stage"]
    : type === "spec.source_changed" ? ["source"]     // SPEC-546 · ADR-0109
    : type === "session.ended" ? ["endedAt", "exitCode"]
      : created || deleted ? [] : ["title"];
```

- [ ] **Step 9: Jalankan test — harus lulus**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism server/test/spec-source-contract.test.ts shared/src/webhook.test.ts
```
Expected: PASS. Bila `shared/src/webhook.test.ts` gagal karena jumlah event, perbarui angka yang
diharapkan di test itu — event baru memang bertambah satu.

- [ ] **Step 10: Typecheck shared + server**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```
Expected: keduanya keluar tanpa error.

- [ ] **Step 11: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations shared/src/entities.ts shared/src/spec-source.ts shared/src/webhook.ts server/src/services/sync.ts server/test/spec-source-contract.test.ts
git commit -m "feat(spec-546): kolom Spec.sourceHistory + kontrak sync & webhook spec.source_changed"
```

---

### Task 4: Gerbang konversi (murni) + notifikasi

**Files:**
- Create: `server/src/services/spec-source.ts`
- Create: `server/src/services/spec-fields.ts` (pindahan `deriveSpecFields`)
- Modify: `server/src/services/notifications.ts` (tambah `recordSourceChange` di akhir berkas)
- Modify: `server/src/routes/specs.ts:37-57` (hapus `deriveSpecFields`, impor dari service)
- Create: `server/test/spec-source-gate.test.ts`

**Interfaces:**
- Consumes: `flowForSource`, `convertPayload`, `payloadMatchesSource`, `priorityFromSeverity`,
  `SourceChange` (Task 1–3)
- Produces:
  - `deriveSpecFields(source: string, payload: any, manualPriority: string): { priority: string; objective: string }` (`services/spec-fields.ts`)
  - `type SourceGate = { ok: true; payload: Record<string, unknown>; dropped: string[] } | { ok: false; code: number; error: string }`
  - `checkSourceChange(spec, to: string, payload?: unknown): SourceGate`
  - `sourceChangeEntry(spec, to: string, by: string, at: Date): SourceChange`
  - `appendSourceHistory(current: unknown, entry: SourceChange): SourceChange[]`
  - `recordSourceChange(specId, projectId, title, from, to, seq): Promise<void>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/spec-source-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkSourceChange, sourceChangeEntry, appendSourceHistory } from "../src/services/spec-source";

const brief = { context: "c", outcome: "o", constraints: "k", priority: "sedang" };
const fresh = { source: "brief", stage: "brainstorming", baseSha: null, payload: brief };
const started = { source: "brief", stage: "executing", baseSha: "abc123", payload: brief };

describe("SPEC-546 · ADR-0109 · gerbang konversi", () => {
  it("item belum dimulai boleh pindah ke source mana pun", () => {
    for (const to of ["qa", "audit", "help", "goal"]) {
      const g = checkSourceChange(fresh, to);
      expect(g.ok).toBe(true);
    }
  });

  it("tanpa payload, server memakai convertPayload sebagai default", () => {
    const g = checkSourceChange(fresh, "qa");
    expect(g.ok && g.payload).toEqual({
      severity: "minor", steps: "", expected: "o", actual: "c", env: "",
    });
    expect(g.ok && g.dropped).toEqual(["constraints"]);
  });

  it("payload yang dikirim dipakai apa adanya bila bentuknya cocok", () => {
    const qa = { severity: "critical", steps: "1", expected: "e", actual: "a", env: "prod" };
    const g = checkSourceChange(fresh, "qa", qa);
    expect(g.ok && g.payload).toEqual(qa);
  });

  it("payload bentuk salah ditolak 400 walau pemanggil bukan HTTP", () => {
    const g = checkSourceChange(fresh, "qa", brief);
    expect(g).toEqual({ ok: false, code: 400, error: "bentuk payload tak cocok dengan source" });
  });

  // Gerbang mengunci FLOW, bukan label (ADR-0109).
  it("item yang sudah dimulai TETAP boleh brief ↔ help — flow-nya sama", () => {
    const g = checkSourceChange(started, "help");
    expect(g.ok).toBe(true);
    expect(g.ok && g.payload).toEqual(brief);   // payload tak disentuh
  });

  it("item yang sudah dimulai DITOLAK ke source ber-flow lain", () => {
    for (const to of ["qa", "audit", "goal"]) {
      const g = checkSourceChange(started, to);
      expect(g.ok).toBe(false);
      expect(!g.ok && g.code).toBe(409);
    }
  });

  it("item yang sudah dimulai tak boleh sekalian mengubah payload", () => {
    const g = checkSourceChange(started, "help", brief);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.code).toBe(409);
  });

  it("stage maju tanpa baseSha pun terhitung sudah dimulai (cermin SPEC-186)", () => {
    const g = checkSourceChange({ ...fresh, stage: "planned" }, "qa");
    expect(g.ok).toBe(false);
  });

  it("entri jejak membawa payload LAMA utuh dan menumpuk append-only", () => {
    const e1 = sourceChangeEntry(fresh, "qa", "dena@x", new Date("2026-08-06T04:00:00Z"));
    expect(e1).toEqual({
      at: "2026-08-06T04:00:00.000Z", from: "brief", to: "qa", by: "dena@x", payload: brief,
    });
    const e2 = sourceChangeEntry({ source: "qa", payload: null }, "goal", "dena@x", new Date("2026-08-06T05:00:00Z"));
    expect(appendSourceHistory([e1], e2)).toEqual([e1, e2]);
    expect(appendSourceHistory(null, e1)).toEqual([e1]);        // kolom masih null
    expect(appendSourceHistory("rusak", e1)).toEqual([e1]);     // nilai tak terduga tak melempar
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
./node_modules/.bin/vitest --run --no-file-parallelism server/test/spec-source-gate.test.ts
```
Expected: FAIL — `Cannot find module '../src/services/spec-source'`.

- [ ] **Step 3: Pindahkan `deriveSpecFields` ke service**

Buat `server/src/services/spec-fields.ts`:

```ts
import { priorityFromSeverity } from "@hanoman/shared";

// SPEC-186 · derivasi priority + objective dari source+payload. Satu sumber untuk POST /specs,
// PATCH /specs/:id, dan — sejak SPEC-546 — POST /specs/:id/source. Dipindah dari routes/specs.ts
// justru karena pemakai ketiga itu: fungsi turunan yang dipakai lintas berkas tak boleh hidup
// sebagai fungsi lokal sebuah route.
export function deriveSpecFields(source: string, payload: any, manualPriority: string) {
  // SPEC-407 · ADR-0089 · backlog goal: objective ADALAH goal-nya (yang dibaca prompt sesi &
  // kondisi Stop hook). Prioritas tetap manual — tak ada severity untuk diturunkan, dan operator
  // yang tahu seberapa mendesak goal itu.
  if (source === "goal") {
    const pick = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return {
      priority: manualPriority,
      objective: pick(payload?.goal) || pick(payload?.done) || "— goal belum diisi.",
    };
  }
  const isQa = source === "qa";
  // SPEC-546 · aturan severity→priority kini fungsi bersama (`priorityFromSeverity`), sumber yang
  // sama dipakai `convertPayload` — dua ternari yang berdiri sendiri pasti melenceng suatu hari.
  const priority = isQa && payload && "severity" in payload
    ? priorityFromSeverity(payload.severity) : manualPriority;
  const objective = isQa && payload && "actual" in payload
    ? (payload.actual || payload.steps || "— audit untuk menelusuri akar masalah.")
    : (payload && "outcome" in payload ? (payload.outcome || payload.context || "— brainstorm untuk memperjelas objective.") : "");
  return { priority, objective };
}
```

Di `server/src/routes/specs.ts`, **hapus** fungsi `deriveSpecFields` (baris 37-57 berikut blok
komentarnya) dan tambahkan import di antara import service lain:

```ts
import { deriveSpecFields } from "../services/spec-fields";
```

- [ ] **Step 4: Buat `server/src/services/spec-source.ts`**

```ts
import { flowForSource, convertPayload, payloadMatchesSource, type SourceChange } from "@hanoman/shared";

// SPEC-546 · ADR-0109 · gerbang & perakit jejak untuk konversi type backlog item.
// SELURUH isi berkas ini MURNI (tanpa DB, tanpa git, tanpa jam sistem — `at` diserahkan
// pemanggil): keputusan "boleh atau tidak" adalah bagian yang paling mudah salah dan paling
// pantas diuji tanpa harness.

export type SourceGate =
  | { ok: true; payload: Record<string, unknown>; dropped: string[] }
  | { ok: false; code: number; error: string };

type SpecLike = { source: string; stage: string; baseSha: string | null; payload: unknown };

/**
 * Boleh tidak item ini pindah ke `to`, dan payload apa yang berlaku sesudahnya.
 *
 * Gerbangnya mengunci **flow, bukan label**. Yang dilindungi SPEC-186 adalah pekerjaan yang
 * sedang berjalan: sesi yang sudah lahir menulis nama fase `PIPELINES[flow]` ke berkas fase,
 * jadi memindahkan item ber-flow `feature` ke `goal` meninggalkan berkas fase yang TAK AKAN
 * PERNAH memuaskan `phasesComplete` flow barunya (kelas SPEC-433: pil hijau yang secara
 * struktural tak bisa muncul). Sebaliknya `brief → help` tak mengubah apa pun yang dipegang
 * sesi — flow sama, bentuk payload sama, prompt sama — jadi menguncinya berarti menolak justru
 * kasus yang paling sering terjadi hanya karena sesinya kebetulan sudah pernah jalan.
 */
export function checkSourceChange(spec: SpecLike, to: string, payload?: unknown): SourceGate {
  const started = spec.stage !== "brainstorming" || spec.baseSha !== null;
  if (started) {
    if (flowForSource(spec.source) !== flowForSource(to))
      return { ok: false, code: 409,
        error: "backlog item sudah dimulai — type hanya bisa pindah ke source dengan flow yang sama" };
    // Konversi se-flow selalu se-bentuk, jadi tak ada field yang perlu diisi operator; dan
    // membuka payload di sini berarti membatalkan gerbang SPEC-186 lewat pintu belakang.
    if (payload !== undefined)
      return { ok: false, code: 409, error: "backlog item sudah dimulai — isinya tak bisa diubah" };
    return { ok: true, payload: (spec.payload ?? {}) as Record<string, unknown>, dropped: [] };
  }
  if (payload !== undefined) {
    // Bentuknya sudah dijamin `zChangeSpecSource` di batas HTTP; diperiksa lagi di sini supaya
    // pemanggil non-HTTP tak bisa menyelundupkan bentuk salah lewat service.
    if (!payloadMatchesSource(to, payload))
      return { ok: false, code: 400, error: "bentuk payload tak cocok dengan source" };
    return { ok: true, payload: payload as Record<string, unknown>, dropped: [] };
  }
  const c = convertPayload(to, spec.payload);
  return { ok: true, payload: c.payload, dropped: c.dropped };
}

/** Satu entri jejak. `payload` = bentuk LAMA utuh — inilah yang membuat `dropped` tak fatal. */
export function sourceChangeEntry(
  spec: { source: string; payload: unknown }, to: string, by: string, at: Date,
): SourceChange {
  return { at: at.toISOString(), from: spec.source, to, by, payload: spec.payload ?? null };
}

/** Append-only, tahan kolom `null` maupun nilai tak terduga dari baris yang datang lewat sync. */
export function appendSourceHistory(current: unknown, entry: SourceChange): SourceChange[] {
  return [...(Array.isArray(current) ? (current as SourceChange[]) : []), entry];
}
```

- [ ] **Step 5: Tambah `recordSourceChange`**

Di akhir `server/src/services/notifications.ts`, tambahkan:

```ts
// SPEC-546 · ADR-0109 · konversi type sebuah backlog item. Dedup lewat `key` berurutan
// `source:<specId>:<n>` (n = panjang `sourceHistory` sesudah append): unik & deterministik, jadi
// dua permintaan konversi yang balapan hanya menyisakan satu baris — pola `recordCompletion`.
export async function recordSourceChange(
  specId: string, projectId: string | null, title: string,
  from: string, to: string, seq: number,
): Promise<void> {
  const sessionId = specId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  await prisma.notification.create({
    data: {
      type: "spec-source", key: `source:${specId}:${seq}`, specId, sessionId,
      title: `${specId} · type ${from} → ${to} — ${title}`, projectId,
    },
  }).catch(() => { /* P2002: konversi yang sama sudah tercatat */ });
}
```

- [ ] **Step 6: Jalankan test — harus lulus**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism server/test/spec-source-gate.test.ts
```
Expected: PASS, 9 test.

- [ ] **Step 7: Pastikan pemindahan `deriveSpecFields` tak merusak jalur lama**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism server/test/specs.route.test.ts server/test/specs-batch.route.test.ts
```
Expected: PASS (tak ada perubahan perilaku — fungsi yang sama, letak baru).

- [ ] **Step 8: Commit**

```bash
git add server/src/services/spec-source.ts server/src/services/spec-fields.ts server/src/services/notifications.ts server/src/routes/specs.ts server/test/spec-source-gate.test.ts
git commit -m "feat(spec-546): gerbang konversi source (mengunci flow, bukan label) + notifikasi"
```

---

### Task 5: Endpoint `POST /specs/:id/source`

**Files:**
- Modify: `server/src/routes/specs.ts` (route baru sesudah `app.patch("/specs/:id", …)`)
- Modify: `shared/src/api.ts:21` (tambah `specSource`)
- Create: `server/test/spec-source.route.test.ts`

**Interfaces:**
- Consumes: `zChangeSpecSource` (Task 1), `checkSourceChange`/`sourceChangeEntry`/
  `appendSourceHistory` (Task 4), `deriveSpecFields` (Task 4), `recordSourceChange` (Task 4),
  `notifySynced`
- Produces: `POST /api/specs/:id/source` → `Spec`; `paths.specSource(id)`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/spec-source.route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

const app = buildApp({ requireAuth: false });
const brief = { context: "operator buka tiga layar", outcome: "satu badge di Overview", constraints: "reuse queue", priority: "sedang" };
const post = (id: string, body: unknown) =>
  app.inject({ method: "POST", url: `/api/specs/${id}/source`, payload: body as object });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "ps" });
});

describe("SPEC-546 · ADR-0109 · POST /specs/:id/source", () => {
  it("brief → qa in-place: id/dependency/createdAt tetap, payload & turunan berpindah", async () => {
    await makeSpec({ id: "SPEC-800", projectId: "ps", source: "brief", stage: "brainstorming",
      priority: "sedang", payload: brief, dependsOn: ["SPEC-799"], branchFrom: null });
    const before = await prisma.spec.findUnique({ where: { id: "SPEC-800" } });
    const r = await post("SPEC-800", { source: "qa" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.id).toBe("SPEC-800");                      // id SPEC-nnn TIDAK berubah
    expect(body.source).toBe("qa");
    expect(body.payload).toEqual({
      severity: "minor", steps: "", expected: "satu badge di Overview",
      actual: "operator buka tiga layar", env: "",
    });
    expect(body.priority).toBe("sedang");                   // diturunkan dari severity
    expect(body.objective).toBe("operator buka tiga layar");
    expect(body.dependsOn).toEqual(["SPEC-799"]);           // dependency utuh
    expect(new Date(body.createdAt).toISOString()).toBe(before!.createdAt.toISOString());
    // Jejak: bentuk LAMA tersimpan utuh.
    expect(body.sourceHistory).toHaveLength(1);
    expect(body.sourceHistory[0]).toMatchObject({ from: "brief", to: "qa" });
    expect(body.sourceHistory[0].payload).toEqual(brief);
    // Tak ada baris baru: konversi adalah update in-place.
    expect(await prisma.spec.count({ where: { projectId: "ps" } })).toBe(1);
  });

  it("payload eksplisit dipakai; bentuk salah ditolak 400", async () => {
    await makeSpec({ id: "SPEC-801", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    const bad = await post("SPEC-801", { source: "qa", payload: brief });
    expect(bad.statusCode).toBe(400);
    const ok = await post("SPEC-801", { source: "qa", payload: {
      severity: "critical", steps: "1. buka", expected: "e", actual: "a", env: "prod" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().priority).toBe("tinggi");   // critical → tinggi
  });

  it("source yang sama ditolak 400 — permintaan no-op adalah bug klien, bukan jejak baru", async () => {
    await makeSpec({ id: "SPEC-802", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    const r = await post("SPEC-802", { source: "brief" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("tak berubah");
  });

  it("spec tak ada → 404; source tak dikenal → 400", async () => {
    expect((await post("SPEC-999", { source: "qa" })).statusCode).toBe(404);
    await makeSpec({ id: "SPEC-803", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    expect((await post("SPEC-803", { source: "cross-audit" })).statusCode).toBe(400);
  });

  it("item yang SUDAH DIMULAI: brief→help 200, brief→qa 409, brief→help+payload 409", async () => {
    await makeSpec({ id: "SPEC-804", projectId: "ps", source: "brief", stage: "executing",
      baseSha: "deadbeef", payload: brief });
    expect((await post("SPEC-804", { source: "qa" })).statusCode).toBe(409);
    expect((await post("SPEC-804", { source: "help", payload: brief })).statusCode).toBe(409);
    const ok = await post("SPEC-804", { source: "help" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().source).toBe("help");
    expect(ok.json().payload).toEqual(brief);   // isi tak tersentuh
  });

  it("goal ↔ brief bolak-balik: objective ikut bentuk yang berlaku", async () => {
    await makeSpec({ id: "SPEC-805", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    const toGoal = await post("SPEC-805", { source: "goal" });
    expect(toGoal.json().objective).toBe("satu badge di Overview");
    expect(toGoal.json().payload.goal).toBe("satu badge di Overview");
    const back = await post("SPEC-805", { source: "brief" });
    expect(back.json().objective).toBe("satu badge di Overview");
    expect(back.json().sourceHistory).toHaveLength(2);
  });

  it("tiap konversi menulis satu notifikasi ber-key unik", async () => {
    await makeSpec({ id: "SPEC-806", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    await post("SPEC-806", { source: "qa" });
    await post("SPEC-806", { source: "brief" });
    const rows = await prisma.notification.findMany({
      where: { specId: "SPEC-806", type: "spec-source" }, orderBy: { key: "asc" } });
    expect(rows.map((r) => r.key)).toEqual(["source:SPEC-806:1", "source:SPEC-806:2"]);
    expect(rows[0]!.title).toContain("brief → qa");
  });

  it("konversi mengantre outbox sync (perubahan source harus menyeberang)", async () => {
    await prisma.syncOutbox.deleteMany();
    await makeSpec({ id: "SPEC-807", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    await prisma.syncOutbox.deleteMany();
    await post("SPEC-807", { source: "help" });
    const out = await prisma.syncOutbox.findMany({ where: { recordId: "SPEC-807" } });
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
./node_modules/.bin/vitest --run --no-file-parallelism server/test/spec-source.route.test.ts
```
Expected: FAIL — semua request menjawab 404 (route belum ada).

- [ ] **Step 3: Tambah `paths.specSource`**

Di `shared/src/api.ts`, tepat sesudah baris `specIntegrate:` (baris 21):

```ts
  // SPEC-546 · ADR-0109 · ubah type/source item in-place (operasi khusus, bukan field PATCH).
  specSource: (id: string) => `${API}/specs/${id}/source`,
```

- [ ] **Step 4: Tambah route**

Di `server/src/routes/specs.ts`, perbarui import dari `@hanoman/shared` menjadi:

```ts
import { zCreateSpec, zPatchSpec, zIntegrate, zBatchCreateSpec, zChangeSpecSource, type Stage } from "@hanoman/shared";
```

Tambahkan import service:

```ts
import { checkSourceChange, sourceChangeEntry, appendSourceHistory } from "../services/spec-source";
import { recordSourceChange } from "../services/notifications";
```

Sisipkan route tepat sesudah blok `app.patch("/specs/:id", …)` berakhir (sebelum
`app.get("/specs/:id/docs", …)`):

```ts
  // SPEC-546 · ADR-0109 · ubah type/source item IN-PLACE — id SPEC-nnn, riwayat, dependency, dan
  // dokumen sesi tetap. Operasi khusus, bukan field `PATCH /specs/:id`: gerbangnya berbeda dari
  // `editingContent` (SPEC-186) — ia mengunci FLOW, bukan label — dan preseden ADR-0064 (rename
  // project) sudah menetapkan bentuk ini untuk perubahan yang punya gerbang & efek sampingnya
  // sendiri. Menumpuknya ke PATCH berarti setiap kombinasi `{source, stage}` / `{source, title}`
  // jadi pertanyaan yang harus dijawab pasal per pasal.
  app.post("/specs/:id/source", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = zChangeSpecSource.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const spec = await prisma.spec.findUnique({ where: { id } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    const to = parsed.data.source;
    // Permintaan no-op adalah bug klien; menerimanya diam-diam berarti menulis baris jejak
    // "brief → brief" yang mengotori satu-satunya alasan kolom itu ada.
    if (to === spec.source) return reply.code(400).send({ error: "source tak berubah" });
    const gate = checkSourceChange(spec, to, parsed.data.payload);
    if (!gate.ok) return reply.code(gate.code).send({ error: gate.error });
    const by = req.user?.email ?? "system";
    const history = appendSourceHistory(
      spec.sourceHistory, sourceChangeEntry(spec, to, by, new Date()));
    // Turunan dihitung ulang terhadap bentuk yang BERLAKU: konversi ke qa memindahkan kendali
    // prioritas ke `severity`, konversi ke goal membuat objective = goal-nya.
    const { priority, objective } = deriveSpecFields(
      to, gate.payload, (gate.payload.priority as string) ?? spec.priority);
    // `author` SENGAJA tak disentuh: prefix `QA ·`/`Audit ·`/`Goal ·` menjawab *siapa yang
    // memfilekan item ini dan lewat pintu mana* — fakta historis, cermin `createdAt` ADR-0090
    // yang tak pernah ditulis route. Lencana type yang dilihat operator memang berpindah.
    const updated = await prisma.spec.update({
      where: { id },
      data: {
        source: to, payload: gate.payload as Prisma.InputJsonValue, priority, objective,
        sourceHistory: history as unknown as Prisma.InputJsonValue,
      },
    });
    await recordSourceChange(spec.id, spec.projectId, spec.title, spec.source, to, history.length);
    await notifySynced("spec", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish
    return updated;
  });
```

- [ ] **Step 5: Jalankan test — harus lulus**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism server/test/spec-source.route.test.ts
```
Expected: PASS, 8 test.

- [ ] **Step 6: Regresi route specs + capability**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism server/test/specs.route.test.ts server/test/agent-capabilities.test.ts server/test/mcp-capability.test.ts
```
Expected: PASS. `/specs/*` sudah dipetakan `backlog:read|write` per method
(`agent-capabilities.ts:48`), jadi tak ada perubahan gate.

- [ ] **Step 7: Typecheck server**

```bash
pnpm --filter ./server typecheck
```
Expected: keluar tanpa error.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/specs.ts shared/src/api.ts server/test/spec-source.route.test.ts
git commit -m "feat(spec-546): endpoint POST /specs/:id/source — konversi type in-place"
```

---

### Task 6: Katalog UI source + dialog "Ubah type"

**Files:**
- Create: `src/src/screens/source-meta.ts`
- Create: `src/src/screens/ChangeSourceDialog.tsx`
- Modify: `src/src/api/client.ts` (tambah `changeSpecSource` sesudah `patchSpec`)
- Modify: `src/src/screens/BacklogScreen.tsx:30-40, 89-108` (pindah katalog ke `source-meta.ts`)

**Interfaces:**
- Consumes: `convertPayload`, `flowForSource`, `payloadShapeFor` (Task 1–2), `paths.specSource` (Task 5)
- Produces:
  - `src/src/screens/source-meta.ts`: `SOURCE_META`, `sourceMeta(s)`, `SOURCE_OPTS`,
    `SHAPE_FIELDS`, `PRIO_OPTS`, `SEV_OPTS`
  - `ChangeSourceDialog({ spec, onClose, onSubmit })`
  - `api.changeSpecSource(id, { source, payload? }): Promise<Spec>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/change-source.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeSourceDialog } from "../src/screens/ChangeSourceDialog";
import { SOURCE_META } from "../src/screens/source-meta";
import type { Spec } from "../src/screens/types";

const base = {
  id: "SPEC-800", projectId: "p", title: "Judul", stage: "brainstorming", priority: "sedang",
  author: "dena", objective: "o", branchFrom: null, baseSha: null,
  createdAt: "2026-08-06T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [],
  autoMerge: null, sourceHistory: [],
} as unknown as Spec;
const briefSpec = { ...base, source: "brief",
  payload: { context: "gejalanya", outcome: "maunya", constraints: "tanpa cache", priority: "sedang" } } as Spec;

describe("SPEC-546 · lencana & tab source", () => {
  it("SOURCE_META punya entri help — tanpa itu item Help Center memakai lencana brief", () => {
    expect(SOURCE_META.help).toBeTruthy();
    expect(SOURCE_META.help!.label).toBe("Help Center");
    expect(Object.keys(SOURCE_META).sort()).toEqual(["audit", "brief", "goal", "help", "qa"]);
  });
});

describe("SPEC-546 · ChangeSourceDialog", () => {
  it("item belum dimulai menawarkan keempat source lain", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    const sel = screen.getByLabelText("Type tujuan") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value).sort()).toEqual(["audit", "goal", "help", "qa"]);
  });

  it("memilih qa merender field bentuk qa ter-prefill convertPayload", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect((screen.getByLabelText("Aktual") as HTMLTextAreaElement).value).toBe("gejalanya");
    expect((screen.getByLabelText("Diharapkan") as HTMLTextAreaElement).value).toBe("maunya");
    expect((screen.getByLabelText("Langkah reproduksi") as HTMLTextAreaElement).value).toBe("");
  });

  it("memberitahu field yang tak punya padanan, dan menyebut jejak sebagai penyelamatnya", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect(screen.getByTestId("source-dropped").textContent).toContain("Constraints");
    expect(screen.getByTestId("source-dropped").textContent).toContain("jejak konversi");
  });

  it("Simpan mengirim source + payload hasil form", () => {
    const onSubmit = vi.fn();
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    fireEvent.change(screen.getByLabelText("Langkah reproduksi"), { target: { value: "1. buka" } });
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    expect(onSubmit).toHaveBeenCalledWith("qa", expect.objectContaining({
      severity: "minor", steps: "1. buka", actual: "gejalanya", expected: "maunya",
    }));
  });

  it("item yang sudah dimulai hanya menawarkan source se-flow dan tak menampilkan form", () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    const onSubmit = vi.fn();
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={onSubmit} />);
    const sel = screen.getByLabelText("Type tujuan") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["help"]);
    expect(screen.queryByLabelText("Konteks")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    expect(onSubmit).toHaveBeenCalledWith("help", undefined);
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/change-source.test.tsx
```
Expected: FAIL — `Failed to resolve import "../src/screens/source-meta"`.

- [ ] **Step 3: Buat katalog UI `src/src/screens/source-meta.ts`**

```ts
// SPEC-546 · ADR-0109 · SATU katalog UI untuk source backlog: lencana, opsi dialog, dan daftar
// field per bentuk payload. Sebelumnya semuanya hidup sebagai const lokal `BacklogScreen.tsx`,
// jadi dialog "Ubah type" hanya bisa memakainya dengan menyalin — dan katalog yang disalin pasti
// berselisih (pola `session-runtime.ts`, yang dipakai bersama picker Start & form Sesi baru).
import { zSpecSource } from "@hanoman/shared";

// SPEC-237 · satu peta source → tampilan. audit = audit-only (dokumen). brief adalah fallback
// untuk source tak dikenal.
// SPEC-546 · +help. Sebelum ini item Help Center jatuh ke fallback dan memakai lencana
// "feature brief"; sejak konversi ada, `help` adalah tujuan yang sah dan wajib punya wajah.
export const SOURCE_META: Record<string, { label: string; icon: string; tone: "err" | "brass" | "info"; color: string }> = {
  qa:    { label: "QA finding",    icon: "bug",       tone: "err",   color: "var(--clay-500)" },
  audit: { label: "Audit",         icon: "search",    tone: "info",  color: "var(--wind-600)" },
  brief: { label: "feature brief", icon: "lightbulb", tone: "brass", color: "var(--brass-500)" },
  // SPEC-407 · ADR-0089 · backlog goal: sesi dua fase (Goal → Verifikasi), tanpa perencanaan.
  goal:  { label: "Goal",          icon: "target",    tone: "brass", color: "var(--brass-600)" },
  help:  { label: "Help Center",   icon: "life-buoy", tone: "info",  color: "var(--wind-500)" },
};
export const sourceMeta = (s: string) => SOURCE_META[s] ?? SOURCE_META.brief!;

// Opsi dialog DITURUNKAN dari enum + katalog di atas: source baru di `zSpecSource` otomatis
// muncul, dan labelnya tak bisa berbeda dari lencananya.
export const SOURCE_OPTS = zSpecSource.options.map((v) => ({ value: v, label: sourceMeta(v).label }));

// SPEC-490 · elemen ketiga = placeholder (contoh nilai). Satu <HnTextarea> merender ketiga daftar
// ini, jadi contohnya milik katalog fieldnya — bukan call site.
export const BRIEF_FIELDS = [
  ["context", "Konteks", "mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu"],
  ["outcome", "Outcome", "mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu"],
  ["constraints", "Constraints", "mis. reuse queue yang ada"],
] as const;
// SPEC-407 · ADR-0089 · bentuk payload backlog goal (zGoalPayload) — bukan konteks/outcome.
export const GOAL_FIELDS = [
  ["goal", "Goal", "mis. p95 GET /api/specs di bawah 200 ms"],
  ["done", "Selesai bila", "mis. output benchmark menunjukkan < 200 ms"],
  ["constraints", "Batasan", "mis. tanpa cache eksternal"],
] as const;
export const QA_FIELDS = [
  ["severity", "Severity", ""],
  ["steps", "Langkah reproduksi", "1. Buka …\n2. Lakukan …\n3. Amati …"],
  ["expected", "Diharapkan", "mis. total funnel sama dengan jumlah baris laporan harian"],
  ["actual", "Aktual", "mis. total funnel dua kali lipat untuk sesi yang melewati tengah malam"],
  ["env", "Environment", "prod · web · v0.9.2"],
] as const;

/** bentuk payload → daftar field yang dirender form. Kunci sama dengan `PayloadShape`. */
export const SHAPE_FIELDS: Record<string, readonly (readonly [string, string, string])[]> = {
  brief: BRIEF_FIELDS, qa: QA_FIELDS, goal: GOAL_FIELDS,
};

// SPEC-186 · opsi enum untuk form edit inline & dialog konversi.
export const PRIO_OPTS = [
  { value: "tinggi", label: "Tinggi" }, { value: "sedang", label: "Sedang" }, { value: "rendah", label: "Rendah" }];
export const SEV_OPTS = [
  { value: "critical", label: "Critical" }, { value: "major", label: "Major" }, { value: "minor", label: "Minor" }];
```

- [ ] **Step 4: `BacklogScreen.tsx` memakai katalog itu**

Hapus dari `src/src/screens/BacklogScreen.tsx`: blok `SOURCE_META` + `sourceMeta` (baris 30-40),
`PRIO_OPTS` + `SEV_OPTS` (baris 56-57), dan `BRIEF_FIELDS`/`GOAL_FIELDS`/`QA_FIELDS`
(baris 89-108). Ganti dengan import di dekat import `./branch`:

```ts
import {
  SOURCE_META, sourceMeta, SHAPE_FIELDS, PRIO_OPTS, SEV_OPTS,
  BRIEF_FIELDS, GOAL_FIELDS, QA_FIELDS,
} from "./source-meta";
```

Tambahkan re-export supaya pemakai lama (`TerminalScreen`, test) tak putus:

```ts
export { SOURCE_META, sourceMeta };
```

- [ ] **Step 5: Buat `src/src/screens/ChangeSourceDialog.tsx`**

```tsx
import React from "react";
import { Modal, Button, Select, Field, HnTextarea, Badge } from "../ds";
import { convertPayload, flowForSource, payloadShapeFor } from "@hanoman/shared";
import { SOURCE_OPTS, SHAPE_FIELDS, PRIO_OPTS, SEV_OPTS, sourceMeta } from "./source-meta";
import type { Spec } from "./types";

// SPEC-546 · ADR-0109 · dialog "Ubah type". Prefill form-nya memakai `convertPayload` — fungsi
// MURNI yang sama yang dipakai server saat `payload` tak dikirim, jadi apa yang dilihat operator
// di sini persis apa yang akan tersimpan.
export function ChangeSourceDialog({ spec, onClose, onSubmit }: {
  spec: Spec;
  onClose: () => void;
  /** `payload` undefined = item sudah dimulai (server memakai payload lama apa adanya). */
  onSubmit: (source: string, payload?: Record<string, string>) => void;
}) {
  // Cermin gerbang server (`checkSourceChange`): sudah dimulai ⇒ hanya source SE-FLOW, dan
  // isinya tak ikut berpindah. Dicerminkan di sini supaya operator tak menemui 409 di ujung.
  const started = spec.stage !== "brainstorming" || spec.baseSha != null;
  const options = SOURCE_OPTS.filter((o) => o.value !== spec.source
    && (!started || flowForSource(o.value) === flowForSource(spec.source)));
  const [target, setTarget] = React.useState(options[0]?.value ?? "");
  const conv = React.useMemo(() => convertPayload(target, spec.payload), [target, spec.payload]);
  const [form, setForm] = React.useState<Record<string, string>>(
    () => conv.payload as Record<string, string>);
  React.useEffect(() => { setForm(conv.payload as Record<string, string>); }, [target]);
  const setField = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));
  const shape = payloadShapeFor(target);
  const fields = SHAPE_FIELDS[shape] ?? [];
  const labelOf = (key: string) =>
    (SHAPE_FIELDS[conv.payload && "severity" in (spec.payload ?? {}) ? "qa" : "brief"] ?? [])
      .find(([k]) => k === key)?.[1] ?? key;

  if (!options.length) return null;
  return (
    <Modal open title="Ubah type backlog item" icon="shuffle"
      eyebrow={`${spec.id} · ${sourceMeta(spec.source).label}`} onClose={onClose}>
      <Field label="Type tujuan">
        <Select aria-label="Type tujuan" value={target} onChange={(e) => setTarget(e.target.value)}
          options={options} style={{ width: "100%" }} />
      </Field>
      {started ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
          Item ini sudah pernah dikerjakan sesi. Yang berpindah hanya <strong>labelnya</strong> —
          isi, worktree, dan berkas fase tak disentuh, dan hanya type dengan alur kerja yang sama
          yang ditawarkan.
        </div>
      ) : (
        <>
          {conv.dropped.length > 0 && (
            <div data-testid="source-dropped" style={{
              fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12,
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 10,
            }}>
              <Badge tone="warn" size="sm">tak punya padanan</Badge>{" "}
              {conv.dropped.map(labelOf).join(", ")} tidak ada di bentuk{" "}
              {sourceMeta(target).label}. Teks lamanya tetap tersimpan di{" "}
              <strong>jejak konversi</strong> item ini.
            </div>
          )}
          {shape !== "qa" && (
            <Field label="Prioritas">
              <Select aria-label="Prioritas" value={form.priority ?? "sedang"}
                onChange={setField("priority")} options={PRIO_OPTS} style={{ width: "100%" }} />
            </Field>
          )}
          {fields.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              {k === "severity"
                ? <Select aria-label={label} value={form[k] ?? "minor"} onChange={setField(k)}
                    options={SEV_OPTS} style={{ width: "100%" }} />
                : <HnTextarea aria-label={label} value={form[k] ?? ""} onChange={setField(k)}
                    rows={2} placeholder={ph} />}
            </Field>
          ))}
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <Button size="sm" variant="secondary" onClick={onClose}>Batal</Button>
        <Button size="sm" variant="primary" leftIcon="shuffle"
          onClick={() => onSubmit(target, started ? undefined : { ...form })}>Ubah type</Button>
      </div>
    </Modal>
  );
}
```

Ganti helper `labelOf` di atas dengan versi yang benar (label field LAMA, bukan tujuan) —
tulis persis:

```tsx
  // Label yang ditampilkan untuk field yang hilang datang dari bentuk LAMA, bukan bentuk tujuan.
  const fromShape = "severity" in ((spec.payload ?? {}) as Record<string, unknown>) ? "qa"
    : "goal" in ((spec.payload ?? {}) as Record<string, unknown>) ? "goal" : "brief";
  const labelOf = (key: string) =>
    (SHAPE_FIELDS[fromShape] ?? []).find(([k]) => k === key)?.[1] ?? key;
```

- [ ] **Step 6: Tambah `changeSpecSource` ke api client**

Di `src/src/api/client.ts`, tepat sesudah `patchSpec` (baris 149-152):

```ts
  // SPEC-546 · ADR-0109 · ubah type/source item in-place. `payload` dihilangkan untuk item yang
  // sudah dimulai (server memakai payload lama apa adanya); 409 = gerbang flow.
  changeSpecSource: (id: string, b: { source: string; payload?: unknown }) =>
    j<Spec>(paths.specSource(id), { method: "POST", ...body(b) }),
```

- [ ] **Step 7: Jalankan test — harus lulus**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/change-source.test.tsx
```
Expected: PASS, 6 test.

- [ ] **Step 8: Regresi layar backlog (katalog dipindah)**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/backlog-board.test.tsx src/test/backlog-dependency.test.tsx src/test/backlog-deeplink.test.tsx
```
Expected: PASS.

- [ ] **Step 9: Typecheck web**

```bash
pnpm --filter ./src typecheck
```
Expected: keluar tanpa error.

- [ ] **Step 10: Commit**

```bash
git add src/src/screens/source-meta.ts src/src/screens/ChangeSourceDialog.tsx src/src/screens/BacklogScreen.tsx src/src/api/client.ts src/test/change-source.test.tsx
git commit -m "feat(spec-546): katalog UI source + dialog Ubah type"
```

---

### Task 7: Pasang dialog di detail backlog, tab `help`, dan blok jejak

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx` (prop `onChangeSource`, tombol, blok jejak, tab)
- Modify: `src/src/App.tsx` (handler `changeSourceOfSpec` + wiring ke `<BacklogScreen>`)
- Modify: `src/test/change-source.test.tsx` (tambah test tab + blok jejak)

**Interfaces:**
- Consumes: `ChangeSourceDialog`, `api.changeSpecSource` (Task 6)
- Produces: prop `onChangeSource?: (s: Spec, source: string, payload?: unknown) => void` pada
  `BacklogScreen`/`SpecDetail`

- [ ] **Step 1: Tambah test yang gagal**

Tambahkan di akhir `src/test/change-source.test.tsx`:

```tsx
import { BacklogScreen } from "../src/screens/BacklogScreen";

describe("SPEC-546 · backlog: tab help & jejak konversi", () => {
  it("tab filter punya pintu Help Center", () => {
    render(<BacklogScreen backlog={[]} projects={[]} projectFilter="all" onProjectFilter={() => {}} />);
    expect(screen.getByRole("tab", { name: "Help Center" })).toBeTruthy();
  });

  it("detail menampilkan tombol Ubah type dan blok jejak konversi", () => {
    const withTrail = { ...briefSpec,
      sourceHistory: [{ at: "2026-08-06T04:00:00.000Z", from: "qa", to: "brief", by: "dena@x" }] } as Spec;
    render(<BacklogScreen backlog={[withTrail]} projects={[]} projectFilter="all"
      onProjectFilter={() => {}} initialDetailId="SPEC-800" onChangeSource={() => {}} />);
    expect(screen.getByRole("button", { name: /Ubah type/i })).toBeTruthy();
    expect(screen.getByTestId("source-trail").textContent).toContain("qa → brief");
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/change-source.test.tsx
```
Expected: FAIL — `Unable to find role="tab" and name "Help Center"`.

- [ ] **Step 3: Tab `help` di daftar backlog**

Di `src/src/screens/BacklogScreen.tsx`, tambahkan di array `tabs` (baris 779-786) sesudah entri
`goal`:

```tsx
            // SPEC-546 · ADR-0109 · `help` kini tujuan konversi yang sah, jadi ia butuh pintunya
            // sendiri — tanpa tab ini item Help Center hanya muncul tercampur di "Semua spec".
            { value: "help", label: "Help Center" },
```

- [ ] **Step 4: Tombol "Ubah type" + dialog + blok jejak di `SpecDetail`**

Tambahkan prop pada tanda tangan `SpecDetail` (baris 133-154) — parameter dan tipenya:

```tsx
    // SPEC-546 · ADR-0109 · ubah type/source item in-place. Boleh kapan saja: gerbangnya
    // (flow, bukan label) ditegakkan server, dan dialog mencerminkannya.
    onChangeSource?: (s: Spec, source: string, payload?: unknown) => void;
```

Tambahkan state di dekat `const [showIntegrate, setShowIntegrate] = React.useState(false);`:

```tsx
  const [showSource, setShowSource] = React.useState(false);
```

Tambahkan tombol tepat sesudah tombol Edit (baris 237-239):

```tsx
        {onChangeSource && (
          <Button size="sm" variant="secondary" leftIcon="shuffle"
            onClick={() => setShowSource(true)}>Ubah type</Button>
        )}
```

Tambahkan blok jejak tepat sebelum blok `{onEditAutoMerge && (` (baris 308):

```tsx
      {/* SPEC-546 · ADR-0109 · jejak konversi type. Hanya muncul bila item pernah dikonversi —
          item yang tak pernah berpindah tak perlu barisnya. */}
      {(spec.sourceHistory ?? []).length > 0 && (
        <div style={{ marginBottom: 14 }} data-testid="source-trail">
          <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Jejak konversi type</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(spec.sourceHistory ?? []).map((h, i) => (
              <div key={`${h.at}-${i}`} style={{ fontSize: 13, color: "var(--text-muted)" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-strong)" }}>
                  {h.from} → {h.to}
                </span>
                {" · "}{new Date(h.at).toLocaleString("id-ID")}{" · "}{h.by}
              </div>
            ))}
          </div>
        </div>
      )}
```

Tambahkan render dialog tepat sesudah blok `{showIntegrate && onIntegrate && ( … )}` (baris 435):

```tsx
      {showSource && onChangeSource && (
        <ChangeSourceDialog spec={spec} onClose={() => setShowSource(false)}
          onSubmit={(source, payload) => {
            setShowSource(false);
            onChangeSource(spec, source, payload);
          }} />
      )}
```

Tambahkan import di atas:

```tsx
import { ChangeSourceDialog } from "./ChangeSourceDialog";
```

- [ ] **Step 5: Teruskan prop dari `BacklogScreen` ke `SpecDetail`**

Tambahkan `onChangeSource` ke daftar parameter `BacklogScreen` (baris 700) dan ke blok tipenya
(baris 702-721):

```tsx
    // SPEC-546 · ADR-0109 · ubah type/source item in-place.
    onChangeSource?: (s: Spec, source: string, payload?: unknown) => void;
```

Lalu teruskan ke `<SpecDetail … />` (cari elemen itu di bagian bawah berkas dan tambahkan
`onChangeSource={onChangeSource}` di antara prop lain).

- [ ] **Step 6: Handler di `App.tsx`**

Di `src/src/App.tsx`, tambahkan tepat sesudah `editSpec` (baris 990):

```tsx
  // SPEC-546 · ADR-0109 · ubah type/source item in-place — id SPEC-nnn, riwayat, dan dependency
  // tetap. 409 = gerbang flow (item sudah dimulai, tujuannya beda alur kerja); 400 = bentuk
  // payload tak cocok source tujuan.
  async function changeSourceOfSpec(spec: Spec, source: string, payload?: unknown) {
    try {
      const updated = await api.changeSpecSource(spec.id, { source, payload });
      setBacklog((b) => b.map((s) => (s.id === updated.id ? updated : s)));
      showToast(`${spec.id} · type ${spec.source} → ${source}`, "ok", "shuffle");
    } catch (e) {
      const locked = e instanceof ApiError && e.status === 409;
      showToast(locked
        ? `${spec.id} sudah dimulai — type hanya bisa pindah ke alur kerja yang sama`
        : `Gagal mengubah type ${spec.id}`, "warn", "x-circle");
    }
  }
```

Teruskan ke `<BacklogScreen …>` di baris yang sama dengan `onEditSpec` (baris 1134 area):

```tsx
              onChangeSource={changeSourceOfSpec}
```

- [ ] **Step 7: Jalankan test — harus lulus**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/change-source.test.tsx
```
Expected: PASS, 8 test.

- [ ] **Step 8: Regresi App + backlog**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/app-flows.test.tsx src/test/app-states.test.tsx src/test/backlog-board.test.tsx src/test/backlog-dependency.test.tsx src/test/backlog-deeplink.test.tsx
```
Expected: PASS.

- [ ] **Step 9: Typecheck web**

```bash
pnpm --filter ./src typecheck
```
Expected: keluar tanpa error.

- [ ] **Step 10: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/src/App.tsx src/test/change-source.test.tsx
git commit -m "feat(spec-546): aksi Ubah type di detail backlog, tab Help Center, blok jejak konversi"
```

---

### Task 8: Docs — ADR-0109 + index + kontrak API + data model + SKILL

**Files:**
- Create: `internal/docs/adr/0109-ubah-source-backlog-item.md`
- Modify: `internal/docs/README.md` (baris 57 area — daftar ADR)
- Modify: `internal/docs/adr/README.md` (narasi ADR)
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/skills/hanoman/SKILL.md` (butir Aturan Arsitektur)

**Interfaces:**
- Consumes: seluruh keputusan Task 1–7
- Produces: —

- [ ] **Step 1: Pastikan nomor ADR belum direbut sesi lain**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
git worktree list
for b in $(git branch -a --format='%(refname)' | grep -v HEAD); do
  git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null
done | grep -oE '0[0-9]{3}-' | sort -u | tail -5
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-546
```
Expected: `0109-` **tidak** muncul. Bila muncul, pakai nomor bebas berikutnya dan ganti seluruh
rujukan `ADR-0109` di kode & docs.

- [ ] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0109-ubah-source-backlog-item.md`:

```markdown
# ADR-0109 — Ubah type/source backlog item: operasi khusus, gerbang mengunci flow, jejak berpayload

- Status: accepted
- Tanggal: 2026-08-06
- Konteks: SPEC-546
- Menegakkan: ADR-0018/0019 (turunan vs tersimpan) · ADR-0038 · ADR-0045 · ADR-0064 · ADR-0090 · ADR-0100
- Tidak mencabut apa pun.

## Konteks

`Spec.source` ditetapkan sekali saat `POST /specs` dan tak pernah bisa diubah — `PATCH /specs/:id`
hanya menerima title/priority/payload/branchFrom/stage/dependsOn/autoMerge. Type sering salah
tebak di awal, dan satu-satunya jalan hari ini adalah hapus lalu buat ulang: nomor SPEC hilang,
riwayat/notifikasi/dependency putus, dan jejak triase — yang menurut SPEC-520 hanya hidup di prosa
`payload` — ikut hilang.

Objective SPEC-546 menyebut enam source; **`cross-audit` sudah tak ada** (dicabut SPEC-384 /
ADR-0092). Yang berlaku adalah `zSpecSource` = `brief`·`qa`·`audit`·`help`·`goal`.

## Keputusan

### 1. Operasi khusus `POST /specs/:id/source`, bukan field `PATCH`

`PATCH /specs/:id` sudah memikul lima gerbang berbeda, dan `source` punya gerbang yang berbeda
lagi. **ADR-0064** sudah menetapkan bentuk ini untuk perubahan sejenis: rename `Project.id`
adalah operasi khusus, bukan field PATCH, justru karena ia punya gerbang & efek sampingnya
sendiri. Konversi source adalah spesies yang sama.

Body: `{ source, payload? }`. `payload` **opsional** — tak dikirim berarti server memakai
`convertPayload`, sehingga panggilan agen lewat REST tetap menghasilkan baris yang sah alih-alih
400. Capability tak berubah: `/specs/*` sudah dipetakan `backlog:read|write` per method.

### 2. Gerbang mengunci FLOW, bukan label

| Keadaan | Konversi |
|---|---|
| Belum dimulai (`stage === "brainstorming"` ∧ `baseSha === null`) | ke source mana pun; `payload` boleh diganti |
| Sudah dimulai | hanya bila `flowForSource(lama) === flowForSource(baru)`; `payload` ditolak |

Hari ini kelompok se-flow satu-satunya adalah `{brief, help}` (keduanya → `feature`).

Alasannya: yang dilindungi gerbang SPEC-186 adalah **pekerjaan yang sedang berjalan**, bukan
label. Sesi yang sudah lahir menulis nama fase `PIPELINES[flow]` ke `$HANOMAN_PHASE_FILE`;
memindahkan item ber-flow `feature` (lima fase) ke `goal` (dua fase) meninggalkan berkas fase yang
**tak akan pernah** memuaskan `phasesComplete` flow barunya — bentuk yang sama dengan kelas bug
SPEC-433, di mana sebuah keadaan secara struktural tak bisa tercapai. Sebaliknya `brief → help`
tak mengubah apa pun yang dipegang sesi: flow sama, bentuk payload sama, prompt sama. Menguncinya
berarti menolak justru kasus yang paling sering terjadi hanya karena sesinya kebetulan sudah
pernah jalan.

`payload` tetap terkunci untuk item yang sudah dimulai — itu SPEC-186 apa adanya. Karena konversi
se-flow selalu se-bentuk, tak ada field yang perlu diisi operator, jadi larangan itu tak memotong
apa pun.

Permintaan `source` yang sama dengan yang sekarang dijawab **400**: no-op yang diterima diam-diam
akan menulis baris jejak "brief → brief" yang mengotori satu-satunya alasan kolom jejak itu ada.

### 3. `Spec.sourceHistory Json?` — kolom, append-only, **membawa payload lama**

`[{ at, from, to, by, payload }]`. Kolom, bukan turunan: aturan ADR-0090 bukan "selalu turunkan"
melainkan *bisakah dihitung ulang dari sumber lain* — kapan sebuah baris berganti type tidak bisa.

`payload` **bentuk lama disimpan utuh**, dan itulah kunci yang membuat konversi beda-bentuk aman:
field yang tak punya padanan di bentuk baru tidak lenyap, ia pindah ke jejak. Janji SPEC-546
("tanpa kehilangan riwayat") karena itu harfiah.

**Tanpa cap.** Konversi adalah tindakan operator manual yang digerbangi butir 2; kolomnya cermin
`dependsOn`/`payload` yang juga tak dibatasi. Cap yang diam-diam membuang justru mematahkan
satu-satunya alasan kolom ini ada.

Migration **additif** (satu `ALTER TABLE … ADD COLUMN … JSONB` nullable, ditulis tangan, tanpa
backfill — sebelum SPEC-546 konversi memang tak mungkin, jadi NULL berarti persis "belum pernah
dikonversi").

### 4. Peta konversi payload: field-ke-field, **tak pernah menyambung prosa**

`convertPayload(to, payload) → { payload, dropped, missing }`, MURNI, di `@hanoman/shared`.
Dipakai UI untuk prefill form **dan** server sebagai default — pola `resolveAutoMerge`/
`flowForSource`.

Menyambung dua field jadi satu membuat data yang tak bisa diurai lagi, sementara operator toh ada
di depan form. Field tanpa padanan masuk `dropped`, diberitahukan di dialog, dan tersimpan utuh di
`sourceHistory`.

`priority ↔ severity` memakai aturan yang **sudah** dipakai `deriveSpecFields`
(`minor → sedang`, selain itu `tinggi`) dan inversnya (`tinggi → major`, selain itu `minor`).
Peta itu 3→2 nilai, jadi **prioritas tidak round-trip** (`rendah → minor → sedang`). Dinyatakan
dan diuji, bukan disembunyikan; yang round-trip adalah prosanya.

### 5. Turunan dihitung ulang; `author` tidak disentuh

`deriveSpecFields(sourceBaru, payloadBaru, …)` dijalankan ulang → `objective` & `priority` selalu
cerminan bentuk yang berlaku. `author` (`QA · …`, `Audit · …`, `Goal · …`) **tetap**: ia menjawab
*siapa yang memfilekan item ini dan lewat pintu mana* — fakta historis, cermin `createdAt`
ADR-0090 yang tak pernah ditulis route. Lencana type yang dilihat operator memang berpindah.

### 6. Jejak keluar: notifikasi + peristiwa webhook turunan

`Notification` `type: "spec-source"`, `key: "source:<specId>:<n>"` (n = panjang `sourceHistory`
sesudah append → unik & deterministik, pola `recordCompletion`). `WEBHOOK_ENTITIES` spec dapat
derived kedua **`spec.source_changed`** (`changed: ["source"]`) yang menggantikan `spec.updated` —
pola `spec.stage_changed` (ADR-0100).

## Gotcha wajib

1. **`sourceHistory` WAJIB masuk `FIELDS.spec`** — `upsert` yang tak menyebut sebuah kolom tetap
   berhasil, jadi kolom yang terlewat mendarat sebagai null palsu di tiap client tanpa satu pun
   error (kelas gagal-senyap ADR-0090/0093/0094/0105). Ia **bukan** `DATE_FIELDS`: `at` hidup di
   dalam JSON-nya.
2. **`sourceHistory` TIDAK boleh masuk `WEBHOOK_ENTITIES.fields`** — ia membawa payload, dan
   `payload` memang sudah sengaja dikecualikan dari allowlist itu (pagar data sensitif).
3. **Predikat bentuk payload harus tetap SATU.** Ia kini di `shared/src/spec-source.ts` dan
   dipanggil `zCreateSpec.superRefine` maupun `zChangeSpecSource`. Menyalinnya kembali ke salah
   satu sisi mengembalikan kelas bug "satu definisi, N call site" (SPEC-431/448/475/481).
4. **Flow tak punya salinan yang perlu ikut diperbarui.** `flowForSource` dibaca *saat sesi lahir*
   oleh ketiga pemanggilnya (`TerminalScreen`, `scheduler/engine.ts`, `lead/apply.ts`), dan
   `SchedulerQueueItem.source` adalah asal *checker* (`backlog`|`triase`), bukan source Spec.
   Konversi karena itu otomatis mengubah flow — yang perlu dijaga hanya sejarah fase (butir 2).
5. **`convertPayload` mengambil bentuk dari PAYLOAD-nya, bukan dari `source` lama.** Baris yang
   `source` dan `payload`-nya sudah terlanjur berselisih (mis. datang dari klien versi lama lewat
   sync) tetap dikonversi berdasar isi yang benar-benar ada.
6. **Dialog UI mencerminkan gerbang server, bukan menggantikannya.** Server tetap menegakkan
   keduanya (`checkSourceChange` memeriksa bentuk payload lagi walau `zChangeSpecSource` sudah) —
   jalur non-HTTP tak boleh bisa menyelundupkan bentuk salah.

## Alternatif yang ditolak

- **Field `source` di `PATCH /specs/:id`** — menumpuk gerbang yang berbeda ke handler yang sudah
  memikul lima; ADR-0064 sudah memutuskan arah sebaliknya untuk kasus sejenis.
- **Terkunci total sesudah item dimulai** — menolak `help → brief`, kasus yang paling sering
  disebut, padahal konversi itu tak menyentuh apa pun yang dipegang sesi.
- **Bebas sepenuhnya sesudah item dimulai** — meninggalkan berkas fase yang tak akan pernah
  memuaskan flow barunya (kelas SPEC-433).
- **Jejak lewat notifikasi saja** — notifikasi bisa dihapus operator dan tak menyeberang sync;
  jejak yang jadi dasar audit tak boleh bergantung pada baris yang boleh dibuang.
- **Menyambung prosa yang tak punya padanan ke satu field** — menghasilkan data yang tak bisa
  diurai lagi; `dropped` + `sourceHistory` menjawab kebutuhan yang sama tanpa merusak bentuk.
```

- [ ] **Step 3: Link ADR di kedua index**

Di `internal/docs/README.md`, tambahkan sebagai baris pertama daftar ADR (di atas `0108`):

```markdown
- [0109 — Ubah type/source backlog item: operasi khusus, gerbang mengunci flow, jejak berpayload](adr/0109-ubah-source-backlog-item.md)
```

Di `internal/docs/adr/README.md`, tambahkan entri naratif di posisi yang sama dengan gaya berkas
itu (paling atas daftar), memuat: apa yang diputuskan, apa yang **ditegakkan** (ADR-0064 preseden
operasi khusus, ADR-0090 kolom vs turunan, ADR-0100 peristiwa turunan), dan enam gotcha di atas
dalam bentuk ringkas.

- [ ] **Step 4: Perbarui kontrak API**

Di `internal/docs/architecture/api-contract.md`, di bagian endpoint `/specs`, tambahkan:

```markdown
### `POST /specs/:id/source` — ubah type/source item (SPEC-546 · ADR-0109)

Body: `{ source: "brief"|"qa"|"audit"|"help"|"goal", payload?: <bentuk source tujuan> }`

Konversi **in-place**: id SPEC-nnn, `createdAt`, `dependsOn`, `branchFrom`, dan dokumen sesi tak
disentuh; tak ada baris baru. `payload` opsional — tak dikirim berarti server memakai peta
`convertPayload` (`@hanoman/shared`), fungsi yang sama yang dipakai dialog UI untuk prefill.

| Kode | Arti |
|---|---|
| 200 | `Spec` sesudah konversi (`source`, `payload`, `priority`, `objective`, `sourceHistory` diperbarui) |
| 400 | source tak dikenal · source sama dengan yang sekarang · bentuk payload tak cocok source tujuan |
| 404 | spec tak ada |
| 409 | item sudah dimulai dan tujuannya beda flow · item sudah dimulai tapi `payload` disertakan |

Gerbang "sudah dimulai" = `stage !== "brainstorming" || baseSha !== null` dan **mengunci flow,
bukan label**: item yang sudah dikerjakan tetap boleh `brief ↔ help` (`flowForSource` sama).
Setiap konversi menulis satu `Notification` (`type: "spec-source"`) dan memancarkan webhook
`spec.source_changed`.
```

- [ ] **Step 5: Perbarui data model**

Di `internal/docs/architecture/data-model.md`, di bagian model `Spec`, tambahkan baris kolom:

```markdown
| `sourceHistory` | `Json?` | SPEC-546 · ADR-0109 · jejak konversi type: `[{at, from, to, by, payload}]`, append-only, `payload` = bentuk LAMA utuh. Ikut `FIELDS.spec` sync; **tidak** masuk allowlist webhook. `null` = belum pernah dikonversi. |
```

- [ ] **Step 6: Perbarui SKILL project**

Di `internal/skills/hanoman/SKILL.md`, bagian **Aturan Arsitektur**, tambahkan butir baru sesudah
butir "Status PRD adalah nilai turunan":

```markdown
- **Type backlog item bisa dipindah — operasi khusus, gerbang mengunci FLOW bukan label**
  (SPEC-546/**ADR-0109**; ADR-0064 preseden, ADR-0090 & ADR-0100 ditegakkan):
  `POST /specs/:id/source` `{source, payload?}` mengubah `Spec.source` **in-place** — id SPEC-nnn,
  `createdAt`, `dependsOn`, dan dokumen sesi tak disentuh. Bukan field `PATCH /specs/:id`: gerbangnya
  berbeda dari `editingContent` (SPEC-186), dan ADR-0064 sudah menetapkan bentuk "operasi khusus"
  untuk perubahan sejenis (rename `Project.id`). **Gerbangnya**: item belum dimulai bebas ke source
  mana pun; item yang sudah dimulai **hanya** ke source ber-`flowForSource` sama (hari ini
  `brief ↔ help`) dan **tanpa** payload — karena yang dilindungi SPEC-186 adalah pekerjaan yang
  sedang berjalan, dan berkas fase sesi berisi nama fase `PIPELINES[flow lama]` yang tak akan pernah
  memuaskan `phasesComplete` flow baru (kelas SPEC-433). Ikatan source↔bentuk payload kini SATU
  predikat di `shared/src/spec-source.ts` yang dipakai `zCreateSpec` **dan** `zChangeSpecSource`;
  peta konversinya `convertPayload(to, payload)` — MURNI, **field-ke-field, tak pernah menyambung
  prosa** — dipakai dialog UI untuk prefill **dan** server sebagai default saat `payload` tak
  dikirim. `Spec.sourceHistory Json?` menyimpan jejak `[{at, from, to, by, payload}]` dengan
  **payload bentuk LAMA utuh**, jadi field tanpa padanan (`dropped`) tak pernah benar-benar hilang.
  **Enam gotcha:** (1) `sourceHistory` wajib di `FIELDS.spec` — kolom yang terlewat mendarat
  sebagai null palsu tanpa satu pun error; (2) **tak boleh** masuk `WEBHOOK_ENTITIES.fields` (ia
  membawa payload, yang memang dikecualikan); (3) predikat bentuk wajib tetap satu — menyalinnya
  mengembalikan kelas SPEC-431/448/475/481; (4) tak ada salinan `source` yang perlu ikut
  diperbarui — `flowForSource` dibaca saat sesi lahir, dan `SchedulerQueueItem.source` itu asal
  *checker*, bukan source Spec; (5) `convertPayload` mengambil bentuk dari **payload**-nya, bukan
  dari `source` lama; (6) `priority` **tidak** round-trip lewat qa (peta severity hanya dua nilai:
  `rendah → minor → sedang`) — dinyatakan & diuji, yang round-trip adalah prosanya. `author`
  (`QA ·`/`Audit ·`/`Goal ·`) **sengaja tak disentuh**: ia fakta historis, cermin `createdAt`.
```

- [ ] **Step 7: Verifikasi integritas index docs**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism server/test/agent-doc-contract.test.ts
git status --porcelain internal/docs
```
Expected: test PASS; `git status` menampilkan berkas ADR baru + tiga docs yang disunting.

- [ ] **Step 8: Commit**

```bash
git add internal/docs internal/skills
git commit -m "docs(spec-546): ADR-0109 ubah type backlog + kontrak API, data model, SKILL"
```

---

### Task 9: Verifikasi akhir & smoke endpoint nyata

**Files:** —

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-546
export TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"
./node_modules/.bin/vitest --run --no-file-parallelism \
  shared/src/spec-source.test.ts shared/src/spec-source-convert.test.ts \
  shared/src/webhook.test.ts shared/src/spec-deps-contract.test.ts \
  server/test/spec-source-contract.test.ts server/test/spec-source-gate.test.ts \
  server/test/spec-source.route.test.ts server/test/specs.route.test.ts \
  server/test/specs-batch.route.test.ts server/test/sync-exclusions.test.ts \
  server/test/spec-done-at.test.ts server/test/spec-deps.test.ts
```
Expected: seluruh berkas PASS. **Pastikan jumlah test > 0** — `--changed` menyalakan
`passWithNoTests`, jadi nol test terlihat hijau; di sini path disebut eksplisit justru untuk
menghindari itu.

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism \
  src/test/change-source.test.tsx src/test/backlog-board.test.tsx \
  src/test/backlog-dependency.test.tsx src/test/backlog-deeplink.test.tsx \
  src/test/app-flows.test.tsx src/test/app-states.test.tsx
```
Expected: seluruh berkas PASS.

- [ ] **Step 2: Typecheck ketiga paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```
Expected: ketiganya keluar tanpa error. (Tiga paket, bukan `-r`: memang ketiganya yang disunting.)

- [ ] **Step 3: Smoke endpoint nyata (boot server + curl, sekali di akhir)**

```bash
export HANOMAN_HOME="$(mktemp -d)"
export DATABASE_URL="file:$HANOMAN_HOME/smoke.db"
./node_modules/.bin/prisma migrate deploy --schema server/prisma/schema.prisma
PORT=8799 HANOMAN_REQUIRE_AUTH=0 node --import tsx server/src/server.ts &
sleep 4
curl -s -X POST localhost:8799/api/projects -H 'content-type: application/json' \
  -d '{"name":"smoke","kind":"existing","desc":""}'
curl -s -X POST localhost:8799/api/specs -H 'content-type: application/json' \
  -d '{"project":"smoke","source":"brief","title":"Smoke","priority":"sedang","payload":{"context":"c","outcome":"o","constraints":"k","priority":"sedang"}}'
curl -s -X POST localhost:8799/api/specs/SPEC-1/source -H 'content-type: application/json' \
  -d '{"source":"qa"}'
curl -s -X POST localhost:8799/api/specs/SPEC-1/source -H 'content-type: application/json' \
  -d '{"source":"qa"}'
curl -s 'localhost:8799/api/specs?project=smoke&source=qa'
```
Expected: konversi pertama **200** dengan `"source":"qa"` + `sourceHistory` berisi satu entri
ber-`payload` bentuk brief; konversi kedua **400** `"source tak berubah"`; `GET` ber-filter
`source=qa` mengembalikan item itu (`total: 1`).

Matikan server **per-PID** (JANGAN `pkill -f`):
```bash
kill $(lsof -ti:8799)
```

- [ ] **Step 4: Diff bersih & commit sisa**

```bash
git status --porcelain
git diff --stat "$HANOMAN_BASE_SHA"...HEAD
```
Expected: `git status` kosong; diff memuat seluruh berkas di tabel File Structure.

- [ ] **Step 5: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-546
```
Expected: branch terbuat/terperbarui di origin.

---

## Self-Review

**Cakupan spec → task**

| Butir objective/konstrain | Task |
|---|---|
| (1) endpoint perubahan source + validasi pakai skema yang sama dengan POST /specs | 1, 5 |
| (2) konversi payload antar-bentuk + pemetaan default | 2 |
| (2) form UI melengkapi field tanpa padanan | 6 |
| (3) aksi "Ubah type" di detail backlog + dialog + segarkan badge/tab | 6, 7 |
| (4) badge & filter `source` ikut berubah | 7 (tab `help`, state backlog diganti in-place) |
| Payload wajib cocok source sesudah konversi, tanpa jalur validasi kedua | 1, 4 |
| Jangan ubah id / jangan clone+delete | 5 (test `count === 1`, `id` tetap) |
| Putuskan & tulis di ADR: item yang sudah dimulai | 4, 8 |
| Tak meninggalkan kombinasi source+flow mustahil | 4 (gerbang flow), 8 (gotcha 4) |
| Simpan jejak konversi terbaca mesin | 3, 5 |
| ADR + migration additif | 3, 8 |
| Test: tiap pasangan, round-trip, penolakan, gerbang, render dialog | 1, 2, 4, 5, 6, 7 |
| Sync/LWW merambat | 3 (`FIELDS.spec`), 5 (`notifySynced` + test outbox) |

**Konsistensi tipe:** `convertPayload(to, payload)` dipakai dengan tanda tangan yang sama di
Task 2 (definisi), Task 4 (`checkSourceChange`), Task 6 (dialog). `SourceChange` didefinisikan
sekali di `entities.ts` dan di-re-export `spec-source.ts` (Task 3 Step 7). `SourceGate` hanya
dipakai Task 4 & 5. `deriveSpecFields` pindah di Task 4 dan dipakai Task 5 dengan tanda tangan
yang sama.

**Selaras dengan dokumen desain:** `docs/superpowers/specs/2026-08-06-spec-546-ubah-type-backlog-design.md`
sudah diperbarui ke tanda tangan yang sama (`convertPayload(to, payload)`, `missing` dihitung dari
`SHAPE_REQUIRED`, `dropped` hanya memuat field yang benar-benar terisi). Kedua artefak tak
berselisih.
