# SPEC-826 — `constraints` di payload QA · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Payload `qa` mendapat field `constraints` sehingga ketiga bentuk payload backlog sama-sama memilikinya, dan `convertPayload` meneruskannya utuh di keenam arah tanpa memecahkan satu pun baris qa lama.

**Architecture:** Satu field zod ber-`.default("")` di `shared/src/entities.ts` adalah gerbangnya — ia membuat payload qa yang sudah tersimpan (tanpa field itu) tetap lolos setiap boundary yang memvalidasi, sekaligus menormalkannya ke `""` sehingga hilir tak perlu menjaga dua bentuk. Sisanya turunan: empat cabang `convertPayload` berhenti membuang/mengosongkan `constraints`, satu baris di katalog field frontend `QA_FIELDS` menutup dua layar sekaligus lewat `SHAPE_FIELDS`, dan dua pabrik payload qa di server plus skema MCP menyusul.

**Tech Stack:** TypeScript strict · zod · vitest · React 18 + Vite · Fastify · Prisma 6/SQLite (tanpa migration — `Spec.payload` sudah kolom `Json`).

## Global Constraints

- **`constraints` di `zQaPayload` WAJIB `z.string().default("")`**, bukan `z.string()` polos. Payload qa yang sudah tersimpan tak punya field itu; polos = setiap baris lama gagal validasi di `zCreateSpec`/`zPatchSpec`/`zChangeSpecSource`/`zSpec`.
- **`constraints` TIDAK boleh masuk `SHAPE_REQUIRED.qa`** (`shared/src/spec-source.ts`). Kosong adalah keadaan normal.
- **Pembeda bentuk payload tak boleh berubah:** `shapeOfPayload` membedakan qa lewat `severity` dan goal lewat `goal`. Predikat tetap SATU di `shared/src/spec-source.ts`.
- **Label qa = `"Batasan"`.** `BRIEF_FIELDS` diseragamkan `"Constraints"` → `"Batasan"` — disengaja (form buat-backlog di `App.tsx` sudah menulis "Batasan" untuk brief).
- **Placeholder wajib contoh nilai konkret** (SPEC-490, ditegakkan `src/test/placeholder-contract.test.ts` atas SUMBER, bukan DOM). Placeholder qa: `"mis. jangan ubah kontrak API"`.
- **`priority` TETAP tidak ada di payload qa** — diturunkan dari `severity` (`priorityFromSeverity`, ADR-0109). Menambahkannya menabrak `deriveSpecFields`.
- **Katalog field frontend tetap satu** (`SHAPE_FIELDS`). `NewSpecModal` di `App.tsx` memang sudah literal sejak awal; menambah Field di cabang qa-nya bukan katalog kedua.
- **Tanpa migration Prisma. Tanpa entri `FIELDS.spec` baru di `sync.ts`** — `payload` sudah satu kolom `Json` utuh.
- **Perintah test WAJIB** memakai DB terisolasi & serial saat menyentuh test server:
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path…>`
- Jalankan semua perintah dari root worktree `/Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-826`.

---

### Task 1: `zQaPayload.constraints` — gerbang kompatibilitas mundur

**Files:**
- Modify: `shared/src/entities.ts:29-32`
- Test: `shared/test/entities.test.ts`

**Interfaces:**
- Produces: `zQaPayload` menerima payload qa **tanpa** `constraints` dan menormalkannya ke `constraints: ""`; menerima `constraints: string` bila dikirim. Bentuk hasil parse: `{severity, steps, expected, actual, env, constraints, fromAudit?}`.

- [ ] **Step 1: Write the failing test**

Tambahkan blok berikut di `shared/test/entities.test.ts`, tepat sesudah `describe("zQaPayload fromAudit (SPEC-244)", …)` yang sudah ada:

```ts
describe("SPEC-826 · zQaPayload.constraints", () => {
  const legacy = { severity: "major", steps: "1. buka", expected: "e", actual: "a", env: "prod" };

  it("payload qa LAMA (tanpa constraints) tetap terbaca, ternormalkan ke string kosong", () => {
    const r = zQaPayload.parse(legacy);
    expect(r.constraints).toBe("");
  });

  it("constraints yang dikirim dipakai apa adanya", () => {
    expect(zQaPayload.parse({ ...legacy, constraints: "jangan ubah kontrak API" }).constraints)
      .toBe("jangan ubah kontrak API");
  });

  it("payload qa lama lolos boundary create & patch — bukan hanya skema payload-nya", () => {
    expect(zCreateSpec.safeParse({
      project: "p", source: "qa", title: "t", priority: "sedang", payload: legacy }).success).toBe(true);
    expect(zPatchSpec.safeParse({ payload: legacy }).success).toBe(true);
  });

  it("ketiga bentuk payload sama-sama punya constraints", () => {
    const qa = zQaPayload.parse(legacy);
    const goal = zGoalPayload.parse({ goal: "g", done: "", constraints: "", priority: "sedang" });
    expect("constraints" in qa && "constraints" in goal).toBe(true);
  });
});
```

`zQaPayload`, `zGoalPayload`, `zCreateSpec`, `zPatchSpec` semuanya sudah ada di baris `import` berkas itu — tak ada import baru.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run shared/test/entities.test.ts -t "SPEC-826"
```

Expected: FAIL — `expected undefined to be ""` pada test pertama.

- [ ] **Step 3: Write minimal implementation**

Di `shared/src/entities.ts`, ganti definisi `zQaPayload`:

```ts
export const zQaPayload = z.object({
  severity: z.enum(["critical","major","minor"]), steps: z.string(),
  expected: z.string(), actual: z.string(), env: z.string(),
  // SPEC-826 · bentuk KETIGA yang ikut punya batasan pengerjaan. `.default("")` bukan gaya:
  // payload qa yang sudah tersimpan tak punya field ini, dan `z.string()` polos membuat setiap
  // baris lama gagal validasi begitu ia lewat zCreateSpec/zPatchSpec/zChangeSpecSource/zSpec.
  constraints: z.string().default(""),
  fromAudit: z.string().optional() });   // SPEC-244 · qa dinaikkan dari audit → sinyal skip fase Audit (ADR-0059)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run shared/test/entities.test.ts
```

Expected: PASS, seluruh berkas hijau.

- [ ] **Step 5: Commit**

```bash
git add shared/src/entities.ts shared/test/entities.test.ts
git commit -m "feat(spec-826): zQaPayload.constraints ber-default, payload qa lama tetap terbaca"
```

---

### Task 2: `convertPayload` meneruskan `constraints` di keenam arah

**Files:**
- Modify: `shared/src/spec-source.ts:62-65` (komentar `SHAPE_REQUIRED`), `:107-141` (cabang konversi)
- Test: `shared/src/spec-source-convert.test.ts`

**Interfaces:**
- Consumes: `zQaPayload` dari Task 1 (tak dipanggil langsung — `convertPayload` murni, tanpa zod).
- Produces: `convertPayload(to, payload)` mengembalikan `payload.constraints` terisi untuk SEMUA `toShape`, dan `dropped` tak pernah lagi memuat `"constraints"`.

- [ ] **Step 1: Write the failing test**

Di `shared/src/spec-source-convert.test.ts`, ubah keempat test yang menyebut arah qa dan tambahkan satu test baru. Ganti test `"brief → qa: …"` (baris ~29) menjadi:

```ts
  it("brief → qa: context→actual, outcome→expected, severity dari priority, constraints ikut", () => {
    const c = convertPayload("qa", brief);
    expect(c.payload).toEqual({
      severity: "major", steps: "", expected: "maunya", actual: "gejalanya", env: "",
      constraints: "tanpa cache",
    });
    expect(c.dropped).toEqual([]);   // SPEC-826 · brief→qa tak lagi membuang apa pun
    expect(c.missing).toEqual(["steps", "env"]);
  });
```

Ganti test `"qa → brief: …"` (baris ~38) menjadi:

```ts
  it("qa → brief: actual→context, expected→outcome, priority dari severity, constraints ikut", () => {
    const c = convertPayload("brief", { ...qa, constraints: "tanpa migration" });
    expect(c.payload).toEqual({
      context: "gejalanya", outcome: "maunya", constraints: "tanpa migration", priority: "sedang",
    });
    expect(c.dropped).toEqual(["steps", "env"]);
    expect(c.missing).toEqual([]);
  });
```

Ganti test `"qa → goal: …"` (baris ~71) menjadi:

```ts
  it("qa → goal: expected jadi goal, constraints ikut, jejak reproduksi dilaporkan dropped", () => {
    const c = convertPayload("goal", { ...qa, constraints: "tanpa migration" });
    expect(c.payload).toEqual({
      goal: "maunya", done: "", constraints: "tanpa migration", priority: "sedang" });
    expect(c.dropped).toEqual(["steps", "actual", "env"]);
    expect(c.missing).toEqual(["done"]);
  });
```

Ganti test `"goal → qa: …"` (baris ~78) menjadi:

```ts
  it("goal → qa: goal jadi expected, constraints ikut, hanya `done` yang dibuang", () => {
    const c = convertPayload("qa", goal);
    expect(c.payload).toEqual({
      severity: "minor", steps: "", expected: "p95 < 200 ms", actual: "", env: "",
      constraints: "tanpa cache",
    });
    expect(c.dropped).toEqual(["done"]);
    expect(c.missing).toEqual(["steps", "actual", "env"]);
  });
```

Ganti test round-trip (baris ~95) menjadi:

```ts
  // Konstrain SPEC-546 + SPEC-826: round-trip brief → qa → brief.
  it("round-trip brief→qa→brief: prosa DAN constraints selamat; priority bergeser sesuai peta 3→2", () => {
    const back = convertPayload("brief", convertPayload("qa", brief).payload);
    expect(back.payload.context).toBe(brief.context);
    expect(back.payload.outcome).toBe(brief.outcome);
    // SPEC-826 · inilah yang dulu hilang: batasan pulang utuh.
    expect(back.payload.constraints).toBe(brief.constraints);
    expect(convertPayload("qa", brief).dropped).toEqual([]);
    expect(back.payload.priority).toBe("tinggi");   // tinggi → major → tinggi
    // Prioritas rendah tetap tak bisa round-trip: peta severity hanya punya dua nilai.
    const low = convertPayload("brief", convertPayload("qa", { ...brief, priority: "rendah" }).payload);
    expect(low.payload.priority).toBe("sedang");
  });
```

Ganti test `"payload null (item lama) …"` (baris ~108) menjadi:

```ts
  it("payload null (item lama) dibaca sebagai brief kosong, tak melempar", () => {
    const c = convertPayload("qa", null);
    expect(c.payload).toEqual({
      severity: "minor", steps: "", expected: "", actual: "", env: "", constraints: "" });
    expect(c.dropped).toEqual([]);
    expect(c.missing).toEqual(["steps", "expected", "actual", "env"]);
  });
```

Terakhir tambahkan satu test baru di akhir `describe`, sebelum kurung tutupnya:

```ts
  // SPEC-826 · payload qa LAMA (tanpa constraints) tak boleh melahirkan `undefined` di bentuk baru.
  it("payload qa tanpa constraints tetap terkonversi, batasannya lahir string kosong", () => {
    expect(convertPayload("brief", qa).payload.constraints).toBe("");
    expect(convertPayload("goal", qa).payload.constraints).toBe("");
    expect(convertPayload("brief", qa).dropped).not.toContain("constraints");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run shared/src/spec-source-convert.test.ts
```

Expected: FAIL — beberapa test, di antaranya `brief → qa` (`dropped` masih `["constraints"]`, payload tanpa `constraints`).

- [ ] **Step 3: Write minimal implementation**

Di `shared/src/spec-source.ts`, ganti komentar di atas `SHAPE_REQUIRED` (baris 62-66):

```ts
/**
 * Field bentuk tujuan yang dianggap harus terisi. `constraints` sengaja TIDAK di sini: kosong
 * itu keadaan normal untuk KETIGA bentuk (SPEC-826 membawanya ke qa juga), dan menandainya
 * "kurang" tiap konversi jadi kebisingan. `severity`/`priority` juga tidak: keduanya selalu
 * punya nilai turunan.
 */
```

Lalu ganti blok `if (toShape === "qa")` (baris 107-117) menjadi:

```ts
  if (toShape === "qa") {
    if (fromShape === "brief")
      return done({
        severity: severityFromPriority(prio()), steps: "", expected: str("outcome"),
        actual: str("context"), env: "", constraints: str("constraints"),
        ...(fromAudit ? { fromAudit } : {}),
      }, []);
    return done({
      severity: severityFromPriority(prio()), steps: "", expected: str("goal"),
      actual: "", env: "", constraints: str("constraints"),
    }, nonEmpty(["done"]));
  }
```

Lalu di blok `if (toShape === "goal")`, ganti cabang `fromShape === "qa"` (baris 126-129) menjadi:

```ts
    return done({
      goal: str("expected"), done: "", constraints: str("constraints"),
      priority: priorityFromSeverity(p.severity),
    }, nonEmpty(["steps", "actual", "env", "fromAudit"]));
```

Lalu di blok terakhir (→ bentuk brief), ganti cabang `fromShape === "qa"` (baris 133-137) menjadi:

```ts
  if (fromShape === "qa")
    return done({
      context: str("actual"), outcome: str("expected"), constraints: str("constraints"),
      priority: priorityFromSeverity(p.severity), ...(fromAudit ? { fromAudit } : {}),
    }, nonEmpty(["steps", "env"]));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run shared/src/spec-source-convert.test.ts
```

Expected: PASS, 12 test hijau.

- [ ] **Step 5: Commit**

```bash
git add shared/src/spec-source.ts shared/src/spec-source-convert.test.ts
git commit -m "feat(spec-826): convertPayload meneruskan constraints di keenam arah"
```

---

### Task 3: Skema MCP mengiklankan `constraints` tanpa mewajibkannya

**Files:**
- Modify: `shared/src/mcp-schema.ts:88-101` (`QA_PAYLOAD`), `:115-120` (`SPEC_PAYLOAD_ONEOF.description`)
- Test: `shared/test/mcp-qa-constraints.test.ts` (create)

**Interfaces:**
- Produces: `QA_PAYLOAD.properties.constraints` ada; `QA_PAYLOAD.required` **tidak** memuatnya.

- [ ] **Step 1: Write the failing test**

Buat `shared/test/mcp-qa-constraints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { QA_PAYLOAD, BRIEF_PAYLOAD, GOAL_PAYLOAD, SPEC_PAYLOAD_ONEOF } from "../src/mcp-schema";

// SPEC-826 · skema MCP adalah kontrak yang dibaca agen sebelum ia memanggil apa pun. Field yang
// tak diiklankan = field yang tak pernah dikirim agen, walau server menerimanya.
describe("SPEC-826 · constraints di skema MCP payload qa", () => {
  it("ketiga bentuk payload mengiklankan constraints", () => {
    for (const shape of [BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD])
      expect(Object.keys(shape.properties ?? {})).toContain("constraints");
  });

  it("qa TIDAK mewajibkannya — kosong adalah keadaan normal (cermin SHAPE_REQUIRED)", () => {
    expect(QA_PAYLOAD.required).not.toContain("constraints");
    expect(QA_PAYLOAD.required).toEqual(["severity", "steps", "expected", "actual", "env"]);
  });

  it("kalimat oneOf mengeja bentuk qa berikut constraints", () => {
    expect(SPEC_PAYLOAD_ONEOF.description).toContain("constraints");
    expect(SPEC_PAYLOAD_ONEOF.description)
      .toContain("{severity, steps, expected, actual, env, constraints}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run shared/test/mcp-qa-constraints.test.ts
```

Expected: FAIL — `expected [ 'severity', 'steps', … ] to contain 'constraints'`.

- [ ] **Step 3: Write minimal implementation**

Di `shared/src/mcp-schema.ts`, di dalam `QA_PAYLOAD.properties`, sisipkan sesudah `env`:

```ts
    constraints: str("Batasan yang mengikat pengerjaan: yang tak boleh berubah, yang wajib dipertahankan. Boleh string kosong — SENGAJA tak wajib (SPEC-826)."),
```

Lalu ganti `SPEC_PAYLOAD_ONEOF.description`:

```ts
  description:
    "Isi backlog. BENTUKNYA DITENTUKAN `source`: `qa` → {severity, steps, expected, actual, env, constraints}; `goal` → {goal, done, constraints, priority}; `brief`/`audit`/`help` → {context, outcome, constraints, priority}. `constraints` qa opsional (default string kosong); bentuk yang tak cocok ditolak sebelum dikirim.",
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run shared/test/mcp-qa-constraints.test.ts
```

Expected: PASS, 3 test hijau.

- [ ] **Step 5: Commit**

```bash
git add shared/src/mcp-schema.ts shared/test/mcp-qa-constraints.test.ts
git commit -m "feat(spec-826): skema MCP mengiklankan constraints qa tanpa mewajibkannya"
```

---

### Task 4: Dua pabrik payload qa di server

**Files:**
- Modify: `server/src/services/ticket-accept.ts:54-57`, `server/src/services/github-accept.ts:34-39`
- Test: `server/test/tickets.test.ts`, `server/test/github-accept.test.ts`

**Interfaces:**
- Consumes: bentuk `zQaPayload` dari Task 1.
- Produces: `Spec.payload` yang lahir dari tiket Help Center & issue GitHub memuat `constraints: ""`.

- [ ] **Step 1: Write the failing test**

Di `server/test/tickets.test.ts`, pada test yang sudah meng-assert `expect(spec.payload).toHaveProperty("severity")` (baris ~212), tambahkan satu baris tepat sesudahnya:

```ts
    // SPEC-826 · pabrik payload qa wajib melahirkan bentuk LENGKAP; field yang absen di kelahiran
    // tak pernah muncul di form edit sampai seseorang mengetiknya.
    expect(spec.payload).toHaveProperty("constraints", "");
```

Di `server/test/github-accept.test.ts`, pada test yang sudah membaca `spec.payload as { severity: string; actual: string }` (baris ~44), ubah anotasi tipe dan tambahkan assert:

```ts
    const p = spec.payload as { severity: string; actual: string; constraints: string };
    expect(p.severity).toBe("major");
    expect(p.constraints).toBe("");   // SPEC-826
```

- [ ] **Step 2: Run test to verify it fails**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/tickets.test.ts server/test/github-accept.test.ts
```

Expected: FAIL — `expected { severity: 'major', … } to have property "constraints"`.

- [ ] **Step 3: Write minimal implementation**

Di `server/src/services/ticket-accept.ts`, ganti pabrik payload qa:

```ts
  const payload = source === "qa"
    ? { severity: "major" as const, steps: "Reproduksi dari keluhan pelapor & lampiran.",
        expected: "Perilaku yang diharapkan pelapor.", actual: detail, env: "", constraints: "" }
    : { context: detail, outcome: "", constraints: "" };
```

Di `server/src/services/github-accept.ts`:

```ts
  const payload = source === "qa"
    ? { severity: "major" as const,
        steps: "Reproduksi dari deskripsi issue.",
        expected: "Perilaku yang diharapkan pelapor issue.",
        actual: detail, env: "", constraints: "" }
    : { context: detail, outcome: "", constraints: "", priority };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/tickets.test.ts server/test/github-accept.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/ticket-accept.ts server/src/services/github-accept.ts \
  server/test/tickets.test.ts server/test/github-accept.test.ts
git commit -m "feat(spec-826): pabrik payload qa tiket & issue melahirkan constraints"
```

---

### Task 5: Test server yang meng-assert isi payload hasil konversi

**Files:**
- Modify: `server/test/spec-source-gate.test.ts:16-27`, `server/test/spec-source.route.test.ts:27-32`

**Interfaces:**
- Consumes: `convertPayload` dari Task 2 lewat `checkSourceChange`.
- Produces: tak ada kode produksi baru — task ini menegakkan bahwa perubahan Task 2 merambat sampai jalur HTTP.

- [ ] **Step 1: Write the failing test**

Di `server/test/spec-source-gate.test.ts`, ganti test `"tanpa payload, server memakai convertPayload sebagai default"`:

```ts
  it("tanpa payload, server memakai convertPayload sebagai default", () => {
    const g = checkSourceChange(fresh, "qa");
    expect(g.ok && g.payload).toEqual({
      severity: "minor", steps: "", expected: "o", actual: "c", env: "", constraints: "k",
    });
    expect(g.ok && g.dropped).toEqual([]);   // SPEC-826 · brief→qa tak lagi membuang constraints
  });
```

Di `server/test/spec-source.route.test.ts`, ganti assert payload di test `"brief → qa in-place: …"`:

```ts
    expect(body.payload).toEqual({
      severity: "minor", steps: "", expected: "satu badge di Overview",
      actual: "operator buka tiga layar", env: "", constraints: "reuse queue",
    });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/spec-source-gate.test.ts server/test/spec-source.route.test.ts
```

Expected: PASS langsung — kode produksi sudah benar sejak Task 2; kalau FAIL, Task 2 belum merambat dan itulah yang task ini ada untuk menangkap.

- [ ] **Step 3: Write minimal implementation**

Tak ada kode produksi. Bila step 2 gagal, perbaiki cabang `convertPayload` yang belum sesuai Task 2 — bukan test-nya.

- [ ] **Step 4: Run test to verify it passes**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/spec-source-gate.test.ts server/test/spec-source.route.test.ts \
  server/test/specs.route.test.ts
```

Expected: PASS, ketiganya hijau.

- [ ] **Step 5: Commit**

```bash
git add server/test/spec-source-gate.test.ts server/test/spec-source.route.test.ts
git commit -m "test(spec-826): konversi ke qa membawa constraints sampai jalur HTTP"
```

---

### Task 6: Katalog field frontend — `QA_FIELDS` + label seragam

**Files:**
- Modify: `src/src/screens/source-meta.ts:27-44`
- Modify: `src/test/change-source.test.tsx:32-46`
- Test: `src/test/change-source.test.tsx`

**Interfaces:**
- Consumes: `convertPayload` dari Task 2 (prefill dialog).
- Produces: `QA_FIELDS` memuat tuple `["constraints", "Batasan", "mis. jangan ubah kontrak API"]` sebagai entri TERAKHIR; `BRIEF_FIELDS` entri constraints berlabel `"Batasan"`. Keduanya terbaca `SHAPE_FIELDS` sehingga `BacklogScreen` (edit + baca) dan `ChangeSourceDialog` ikut tanpa perubahan call site.

- [ ] **Step 1: Write the failing test**

Di `src/test/change-source.test.tsx`, ganti test `"memilih qa merender field bentuk qa ter-prefill convertPayload"`:

```ts
  it("memilih qa merender field bentuk qa ter-prefill convertPayload, Batasan ikut", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect((screen.getByLabelText("Aktual") as HTMLTextAreaElement).value).toBe("gejalanya");
    expect((screen.getByLabelText("Diharapkan") as HTMLTextAreaElement).value).toBe("maunya");
    expect((screen.getByLabelText("Langkah reproduksi") as HTMLTextAreaElement).value).toBe("");
    // SPEC-826 · batasan brief menyeberang ke bentuk qa alih-alih dilaporkan hilang.
    expect((screen.getByLabelText("Batasan") as HTMLTextAreaElement).value).toBe("tanpa cache");
  });
```

Ganti test `"memberitahu field yang tak punya padanan, dan menyebut jejak sebagai penyelamatnya"`:

```ts
  it("memberitahu field yang tak punya padanan, dan menyebut jejak sebagai penyelamatnya", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    // brief → goal masih membuang Konteks; brief → qa sejak SPEC-826 tak membuang apa pun.
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "goal" } });
    expect(screen.getByTestId("source-dropped").textContent).toContain("Konteks");
    expect(screen.getByTestId("source-dropped").textContent).toContain("jejak konversi");
  });

  it("SPEC-826 · brief → qa tak lagi melaporkan apa pun sebagai hilang", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect(screen.queryByTestId("source-dropped")).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run src/test/change-source.test.tsx
```

Expected: FAIL — `Unable to find a label with the text of: Batasan`.

- [ ] **Step 3: Write minimal implementation**

Di `src/src/screens/source-meta.ts`, ganti label brief dan tambahkan entri qa:

```ts
// SPEC-490 · elemen ketiga = placeholder (contoh nilai). Satu <HnTextarea> merender ketiga daftar
// ini, jadi contohnya milik katalog fieldnya — bukan call site.
// SPEC-826 · label batasan diseragamkan "Batasan" untuk KETIGA bentuk: form buat-backlog
// (`App.tsx`) sudah menulis "Batasan" untuk brief, jadi "Constraints" di sini membuat field yang
// sama bernama dua hal tergantung layar mana yang dibuka operator.
export const BRIEF_FIELDS = [
  ["context", "Konteks", "mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu"],
  ["outcome", "Outcome", "mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu"],
  ["constraints", "Batasan", "mis. reuse queue yang ada"],
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
  // SPEC-826 · terakhir, cermin posisi constraints di brief & goal.
  ["constraints", "Batasan", "mis. jangan ubah kontrak API"],
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run src/test/change-source.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/source-meta.ts src/test/change-source.test.tsx
git commit -m "feat(spec-826): QA_FIELDS punya Batasan, label brief diseragamkan"
```

---

### Task 7: Detail backlog qa — Batasan tampil, terisi, dan tersimpan

**Files:**
- Modify: `src/src/screens/BacklogScreen.tsx:174-181` (`saveEdit`), `:485-492` (`fields.map` — `aria-label`)
- Test: `src/test/backlog-qa-constraints.test.tsx` (create)

**Interfaces:**
- Consumes: `QA_FIELDS` dari Task 6 — render field-nya sudah otomatis lewat `fields.map`, tak ada call site baru.
- Produces: `onEditSpec(spec, patch)` untuk item qa mengirim `patch.payload.constraints`.

Komponen detailnya bernama `SpecDetail` dan **tidak** diekspor; ia dibuka lewat `BacklogScreen`
(klik judul item), persis pola `src/test/backlog-goal.test.tsx`. Jangan mengekspornya.

- [ ] **Step 1: Write the failing test**

Buat `src/test/backlog-qa-constraints.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: {
    listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })),
    listSpecs: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { BacklogScreen } from "../src/screens/BacklogScreen";

// SPEC-826 · field yang dirender tapi tak ikut disimpan adalah bentuk kegagalan paling senyap:
// operator mengetik, menekan Simpan, dan batasannya lenyap tanpa satu pun pesan.
// `payload` di sini sengaja bentuk LAMA (tanpa `constraints`) — itulah baris yang sudah ada di DB.
const qaSpec: any = {
  id: "SPEC-826", projectId: "p1", title: "Funnel dobel", source: "qa", stage: "brainstorming",
  priority: "tinggi", author: "dena", objective: "o", branchFrom: null, baseSha: null,
  createdAt: "2026-08-18T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [],
  autoMerge: null, sourceHistory: [],
  payload: { severity: "major", steps: "1. buka", expected: "e", actual: "a", env: "prod" },
};
const mount = (onEditSpec: any) =>
  render(<BacklogScreen backlog={[qaSpec]} projects={[{ id: "p1", name: "P1" }] as never}
    onEditSpec={onEditSpec} projectFilter="all" onProjectFilter={() => {}} />);

beforeEach(() => vi.clearAllMocks());

describe("SPEC-826 · Batasan di detail backlog qa", () => {
  it("item qa LAMA dibuka tanpa galat; Batasan lahir kosong di form edit", async () => {
    mount(vi.fn());
    fireEvent.click(await screen.findByText("Funnel dobel"));
    fireEvent.click(await screen.findByText("Edit"));
    expect((screen.getByLabelText("Batasan") as HTMLTextAreaElement).value).toBe("");
  });

  it("Simpan mengirim constraints yang diketik operator", async () => {
    const onEditSpec = vi.fn();
    mount(onEditSpec);
    fireEvent.click(await screen.findByText("Funnel dobel"));
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.change(screen.getByLabelText("Batasan"),
      { target: { value: "jangan ubah kontrak API" } });
    fireEvent.click(screen.getByText("Simpan"));
    await waitFor(() => expect(onEditSpec).toHaveBeenCalledWith(
      expect.objectContaining({ id: "SPEC-826" }),
      expect.objectContaining({ payload: expect.objectContaining({
        severity: "major", constraints: "jangan ubah kontrak API" }) })));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run src/test/backlog-qa-constraints.test.tsx
```

Expected: FAIL — `Unable to find a label with the text of: Batasan` (`Field` membungkus anaknya
dalam `<label>` tanpa `aria-label`, jadi nama yang bisa dipegang test belum ada).

- [ ] **Step 3: Write minimal implementation**

**(a)** Di `src/src/screens/BacklogScreen.tsx`, di dalam `fields.map` pada blok `editing`, beri
nama aksesibilitas pada kedua kontrol — cermin `ChangeSourceDialog` yang sudah melakukannya:

```tsx
          {fields.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              {k === "severity"
                ? <Select aria-label={label} value={form[k] ?? "major"} onChange={setField(k)} options={SEV_OPTS} style={{ width: "100%" }} />
                : <HnTextarea aria-label={label} value={form[k] ?? ""} onChange={setField(k)} rows={2} placeholder={ph} />}
            </Field>
          ))}
```

**(b)** Ganti cabang qa di `saveEdit`:

```ts
    const patch = spec.source === "qa"
      // SPEC-826 · `?? ""` bukan hiasan: item qa yang lahir sebelum spec ini tak punya field ini
      // di payload, jadi `form.constraints` undefined sampai operator mengetiknya.
      ? { title: form.title, payload: { severity: form.severity, steps: form.steps,
          expected: form.expected, actual: form.actual, env: form.env,
          constraints: form.constraints ?? "" } }
```

(sisa ternari — cabang goal & brief — tak berubah.)

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run src/test/backlog-qa-constraints.test.tsx src/test/change-source.test.tsx \
  src/test/backlog-goal.test.tsx src/test/backlog-dependency.test.tsx
```

Expected: PASS semua — `aria-label` baru tak boleh membuat selector test tetangga jadi ambigu.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/BacklogScreen.tsx src/test/backlog-qa-constraints.test.tsx
git commit -m "feat(spec-826): detail backlog qa menampilkan & menyimpan Batasan"
```

---

### Task 8: Form buat-backlog (`NewSpecModal`) — Field Batasan di cabang qa

**Files:**
- Modify: `src/src/App.tsx:54-57` (`SpecPrefill`), `:290-294` (`blank`), `:415-430` (render cabang qa), `:1001-1012` (`promoteToQa`), `:1137-1145` (`createSpec`)
- Test: `src/test/new-spec-qa-constraints.test.tsx` (create), `src/test/app-flows.test.tsx` (tambah satu test)

**Interfaces:**
- Consumes: bentuk payload qa dari Task 1.
- Produces: `api.createSpec` menerima `payload.constraints` untuk `source: "qa"`; `SpecPrefill` menerima `constraints?: string`.

Dua lapis test disengaja: `NewSpecModal` membuktikan field-nya ada dan ikut di `SpecForm`
(`onCreate(f)` meneruskan seluruh form), sementara perakitan `payload` hidup di `createSpec`
milik `App` — hanya test tingkat-App yang menyentuh baris itu.

- [ ] **Step 1: Write the failing test**

Buat `src/test/new-spec-qa-constraints.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })) },
  ApiError: class extends Error {},
}));

import { NewSpecModal } from "../src/App";

// SPEC-826 · form buat-backlog adalah pintu tempat pelapor QA menuliskan batasannya. Tanpa field
// di sini, `zQaPayload.constraints` cuma hidup di skema dan tak pernah terisi manusia.
const projects = [{ id: "p1", name: "P1" }] as any;

describe("SPEC-826 · Batasan di form temuan QA", () => {
  it("tab QA finding merender Batasan berikut contoh nilainya (SPEC-490)", () => {
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={vi.fn()} />);
    fireEvent.click(screen.getByText("QA finding"));
    expect((screen.getByLabelText("Batasan") as HTMLInputElement).placeholder)
      .toBe("mis. jangan ubah kontrak API");
  });

  it("Filekan meneruskan constraints yang diketik ke onCreate", () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.click(screen.getByText("QA finding"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Funnel dobel" } });
    fireEvent.change(screen.getByLabelText("Batasan"), { target: { value: "jangan ubah kontrak API" } });
    fireEvent.click(screen.getByText("Filekan finding → audit"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      kind: "qa", constraints: "jangan ubah kontrak API" }));
  });
});
```

Lalu tambahkan satu test di `src/test/app-flows.test.tsx`, di dalam `describe("app flows", …)`
yang sudah ada (mock `api` lengkapnya sudah tersedia di berkas itu — jangan menyalinnya ke
berkas baru):

```tsx
  // SPEC-826 · perakitan payload hidup di `createSpec` milik App, bukan di modal: modal
  // meneruskan SELURUH SpecForm apa adanya, jadi test tingkat-modal tak menyentuh baris ini.
  it("SPEC-826 · QA finding baru mengirim constraints di payload qa", async () => {
    listSpecs.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    vi.mocked(api.createSpec).mockResolvedValue(
      { ...spec, id: "SPEC-900", source: "qa", payload: {} } as never);
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/arta/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Backlog")[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Tambah spec" }));
    fireEvent.click(screen.getByText("QA finding"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Funnel dobel" } });
    fireEvent.change(screen.getByLabelText("Batasan"),
      { target: { value: "jangan ubah kontrak API" } });
    fireEvent.click(screen.getByText("Filekan finding → audit"));
    await waitFor(() => expect(api.createSpec).toHaveBeenCalledWith(expect.objectContaining({
      source: "qa",
      payload: expect.objectContaining({
        severity: "major", constraints: "jangan ubah kontrak API" }),
    })));
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest --run src/test/new-spec-qa-constraints.test.tsx src/test/app-flows.test.tsx
```

Expected: FAIL — `Unable to find a label with the text of: Batasan` di kedua berkas.

- [ ] **Step 3: Write minimal implementation**

**(a)** `SpecPrefill` (baris ~54) — tambahkan `constraints`:

```ts
type SpecPrefill = { project?: string; title?: string; context?: string; outcome?: string; prdPath?: string;
  kind?: string; steps?: string; actual?: string; severity?: string; branchFrom?: string; fromAudit?: string;
  // SPEC-826 · batasan pengerjaan kini dimiliki KETIGA bentuk payload, jadi ia bisa ikut di-seed.
  constraints?: string;
  goal?: string; done?: string };   // SPEC-407 · seed dari "Take ke backlog → sebagai goal"
```

**(b)** `blank` (baris ~292) — ganti `constraints: ""` menjadi `constraints: prefill?.constraints ?? ""`:

```ts
    title: prefill?.title ?? "", context: prefill?.context ?? "", outcome: prefill?.outcome ?? "",
    constraints: prefill?.constraints ?? "",
```

**(c)** Render — di cabang `isQa`, sesudah `<Field label="Environment" …>`, tambahkan:

```tsx
          <Field label="Batasan" hint="opsional — batasan pengerjaan yang sudah kamu ketahui">
            <Input aria-label="Batasan" value={f.constraints} onChange={set("constraints")}
              placeholder="mis. jangan ubah kontrak API" style={{ width: "100%" }} />
          </Field>
```

**(d)** `promoteToQa` (baris ~1006) — teruskan batasan dari rekomendasi audit:

```ts
    setSpecPrefill({ project: spec.projectId, kind: "qa", title: pf?.title || spec.title,
      steps: (pf?.steps || backlink).slice(0, 500), actual: pf?.context || spec.objective,
      severity: pf?.severity && ["critical", "major", "minor"].includes(pf.severity) ? pf.severity : "major",
      // SPEC-826 · `zEscalationPrefill.constraints` sudah ada sejak SPEC-340 tapi tak punya
      // tujuan di bentuk qa; sejak spec ini ia punya.
      constraints: pf?.constraints ?? "",
      // SPEC-244 · teruskan branch audit (hanoman/<audit-id>) + sinyal skip fase Audit (ADR-0059).
      branchFrom: `hanoman/${spec.id.toLowerCase()}`, fromAudit: spec.id });
```

**(e)** `createSpec` (baris ~1140) — sertakan di payload qa:

```ts
      ? { severity: f.severity, steps: f.steps, expected: f.expected, actual: f.actual, env: f.env,
          constraints: f.constraints,
          ...(f.fromAudit ? { fromAudit: f.fromAudit } : {}) }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest --run src/test/new-spec-qa-constraints.test.tsx src/test/app-flows.test.tsx \
  src/test/placeholder-contract.test.ts src/test/audit-escalation.test.tsx
```

Expected: PASS — termasuk kontrak placeholder SPEC-490 atas Field baru.

- [ ] **Step 5: Commit**

```bash
git add src/src/App.tsx src/test/new-spec-qa-constraints.test.tsx src/test/app-flows.test.tsx
git commit -m "feat(spec-826): form temuan QA punya field Batasan"
```

---

### Task 9: ADR-0122 + docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0122-constraints-di-payload-qa.md`
- Modify: `internal/docs/adr/README.md`, `internal/docs/README.md`,
  `internal/docs/architecture/api-contract.md:197`,
  `internal/docs/architecture/data-model.md:109`,
  `internal/skills/hanoman/SKILL.md`, `docs/agent-integration.md:234`
- Test: `server/test/agent-doc-contract.test.ts` (sudah ada — dijalankan, tak diubah)

**Interfaces:**
- Consumes: seluruh keputusan Task 1-8.
- Produces: nomor ADR **0122** (0121 dipakai SPEC-826-pendahulunya "operasi berkas IDE"; periksa ulang `ls internal/docs/adr/` sebelum menulis — nomor bisa direbut worktree tetangga).

- [ ] **Step 1: Periksa nomor ADR belum direbut**

```bash
ls internal/docs/adr/ | tail -3
git ls-remote --heads origin
```

Expected: `0121-operasi-berkas-ide-explorer.md` adalah yang terakhir. Bila `0122-*` sudah ada, pakai nomor bebas berikutnya dan sesuaikan seluruh rujukan di berkas yang ditulis task ini.

- [ ] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0122-constraints-di-payload-qa.md` dengan struktur yang sama dengan ADR tetangga (`0120`): judul, Status, Konteks, Keputusan, Konsekuensi, Gotcha. Isinya wajib menyatakan, dengan angka & nama berkas:

1. **Konteks terukur** — empat arah `convertPayload` yang lossy hari ini (`brief→qa` `dropped:["constraints"]` `spec-source.ts:112`; `goal→qa` `["done","constraints"]` `:116`; `qa→brief` lahir `""` `:135`; `qa→goal` lahir `""` `:127`), dan konsekuensinya: item yang pindah `brief → qa → brief` pulang tanpa batasannya walau prosanya selamat di `Spec.sourceHistory` (ADR-0109).
2. **Keputusan `.default("")`** dan kenapa `z.string()` polos salah: `zQaPayload` dipakai `zSpec`, `zCreateSpec`, `zPatchSpec`, `zChangeSpecSource` — polos membuat SETIAP baris qa lama gagal validasi. `.default("")` sekaligus menormalkan sehingga hilir tak menjaga dua bentuk.
3. **Keputusan label "Batasan"** berikut alasannya: `App.tsx` sudah menulis "Batasan" untuk brief & goal sementara `BRIEF_FIELDS` menulis "Constraints", jadi field yang sama sudah bernama dua hal tergantung layar; spec ini menutup itu alih-alih menambah bentuk ketiga.
4. **Apa yang TIDAK berubah dan kenapa itu keputusan:** `constraints` di luar `SHAPE_REQUIRED.qa` (kosong itu normal); `priority` tetap tak ada di payload qa (diturunkan dari `severity` — menambahkannya menabrak `deriveSpecFields`); pembeda `shapeOfPayload` tetap `severity`/`goal` sehingga qa & goal tak jadi ambigu; tanpa migration; tanpa entri `FIELDS.spec` baru.
5. **Gotcha:** (a) `.default("")` adalah SATU-SATUNYA hal yang membuat baris lama selamat — diuji dengan payload qa **tanpa** field itu, bukan hanya yang baru; (b) `dropped` yang menyusut mengubah UI: blok `source-dropped` di `ChangeSourceDialog` **hilang** untuk `brief→qa`, jadi test yang membuktikan laporan `dropped` harus pindah ke arah yang memang masih membuang (`brief→goal`); (c) skema MCP wajib mengiklankan field tanpa memasukkannya ke `required` — agen hanya mengirim apa yang diiklankan; (d) dua pabrik payload qa di server (`ticket-accept.ts`, `github-accept.ts`) melahirkan payload TANPA lewat zod, jadi keduanya harus disebut eksplisit atau item dari tiket & issue lahir tanpa field itu.

- [ ] **Step 3: Perbarui docs SoT yang menyebut bentuk payload qa**

`internal/docs/architecture/api-contract.md` — di sekitar baris 197 tempat bentuk qa dieja, tambahkan `constraints` ke daftar field qa dengan catatan "opsional, default string kosong (SPEC-826)".

`internal/docs/architecture/data-model.md:109` — ganti:

```
- `payload` (Json?) — brief (context/outcome/constraints), qa (severity/steps/expected/actual/env),
```

menjadi baris yang mengeja qa sebagai `severity/steps/expected/actual/env/constraints` dan menyebut `constraints` ber-default `""` (SPEC-826) sehingga baris qa lama tetap sah.

`docs/agent-integration.md` — baris tabel §7 untuk `qa`:

```
| `qa` | qa | `severity` (`critical`\|`major`\|`minor`), `steps`, `expected`, `actual`, `env`, `constraints` (opsional, default `""`) |
```

`internal/skills/hanoman/SKILL.md` — di butir yang menjelaskan ADR-0109/konversi source (sekitar baris 319-341), tambahkan satu kalimat: ketiga bentuk payload kini sama-sama punya `constraints` (SPEC-826/ADR-0122), sehingga `convertPayload` tak lagi membuangnya di arah mana pun; `priority` **tetap** pengecualian yang disengaja karena ia turunan `severity`.

`internal/docs/adr/README.md` — tambahkan satu baris ringkas untuk 0122, mengikuti bentuk baris 0121 di berkas itu.

`internal/docs/README.md` — pastikan ADR 0122 ter-link di daftar ADR (ikuti pola entri 0121).

- [ ] **Step 4: Verifikasi index & kontrak docs**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli exec tsx src/index.ts docs index --check
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/agent-doc-contract.test.ts server/test/agent-doc.route.test.ts
```

Expected: index `--check` tanpa keluhan; kedua test agent-doc PASS (tabel payload tetap menyebut setiap nilai `zSpecSource`).

- [ ] **Step 5: Commit**

```bash
git add internal/docs docs/agent-integration.md internal/skills/hanoman/SKILL.md
git commit -m "docs(adr-0122): constraints di payload qa"
```

---

### Task 10: Verifikasi akhir — typecheck, test yang tersentuh, smoke endpoint

**Files:** tak ada perubahan berkas; task ini gerbangnya.

- [ ] **Step 1: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: ketiganya exit 0. (Ketiga paket memang tersentuh; `runner` & `cli` tidak.)

- [ ] **Step 2: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  --changed "$HANOMAN_BASE_SHA"
```

Expected: hijau, dan **jumlah berkas test > 0** — `--changed` menyalakan `passWithNoTests`, jadi "no test files" BUKAN bukti. Bila nol berkas terpungut, jalankan path-nya eksplisit:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  shared/test/entities.test.ts shared/test/mcp-qa-constraints.test.ts \
  shared/src/spec-source-convert.test.ts \
  server/test/spec-source-gate.test.ts server/test/spec-source.route.test.ts \
  server/test/specs.route.test.ts server/test/tickets.test.ts server/test/github-accept.test.ts \
  server/test/agent-doc-contract.test.ts \
  src/test/change-source.test.tsx src/test/backlog-qa-constraints.test.tsx \
  src/test/new-spec-qa-constraints.test.tsx src/test/placeholder-contract.test.ts
```

- [ ] **Step 3: Smoke endpoint nyata (task ini menyentuh `POST /specs` & `POST /specs/:id/source`)**

Boot server sekali dengan DB khusus lalu curl:

```bash
HANOMAN_HOME="$(mktemp -d)" pnpm dev &
# tunggu server siap, lalu — dengan session cookie / requireAuth mati sesuai setup local:
curl -sS -X POST localhost:5174/api/specs -H 'content-type: application/json' \
  -d '{"project":"<slug>","source":"qa","title":"smoke 826","priority":"sedang",
       "payload":{"severity":"minor","steps":"1","expected":"e","actual":"a","env":"dev"}}' | jq .payload
```

Expected: `payload.constraints === ""` (payload qa **tanpa** field itu diterima — inilah klaim kompatibilitas mundur, diuji di server hidup). Lalu POST kedua dengan `"constraints":"jangan ubah kontrak API"` → tersimpan apa adanya. Lalu `POST /api/specs/<id>/source {"source":"brief"}` → respons `payload.constraints` sama dengan yang dikirim, bukan `""`. Matikan server per-PID (`lsof -ti:5174` → `kill <pid>`), **jangan** `pkill -f`.

- [ ] **Step 4: Diff bersih & push**

```bash
git status --porcelain          # harus kosong
git diff --stat "$HANOMAN_BASE_SHA"...HEAD
git push origin HEAD:refs/heads/hanoman/spec-826
```
