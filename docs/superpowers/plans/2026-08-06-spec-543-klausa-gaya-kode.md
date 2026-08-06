# Klausa gaya kode di prompt sesi (SPEC-543) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap prompt agen yang dilahirkan hanoman membawa satu klausa gaya kode yang identik dan berasal dari SATU konstanta — sesi backlog & goal (claude maupun codex), sesi konflik rebase/merge, prompt custom agent, prompt hanoman-lead, dan prompt narator changelog — terdokumentasi sebagai konvensi tetap (ADR-0108) dan diikat test yang membuktikan klausanya benar-benar sampai ke ARGV proses agen.

**Architecture:** Cermin persis mekanisme ADR-0080: satu berkas konstanta di `runner/src/` (`code-style.ts`, tetangga `verify-scope.ts`) diekspor lewat barrel `@hanoman/runner`, lalu disisipkan sebagai satu elemen array di tiap builder prompt. Bedanya dari ADR-0080: **tanpa knob** (tak ada `Setting`, tak ada override per sesi, tak ada env), dan gerbang "hanya berlaku saat menulis kode" hidup **di dalam teks klausanya**, bukan di percabangan pemanggil — sebab klausa yang sama dipasang di prompt yang keluarannya bukan kode (lead, changelog).

**Tech Stack:** TypeScript strict (pnpm workspace: `runner` · `server` · `shared` · `src` · `cli`) · Fastify + Prisma 6/SQLite · Vitest · tmux + node-pty.

## Global Constraints

- **Tanpa `Setting` baru, tanpa perubahan skema Prisma, tanpa migration, tanpa endpoint baru, tanpa parameter query baru.** ADR-0080 dijadikan **pola**, bukan diamandemen.
- **SATU definisi klausa.** Teksnya hidup hanya di `runner/src/code-style.ts`. Tak boleh ada call site yang menulis ulang, memotong, atau membungkusnya dengan varian kedua — kelas bug "satu definisi, N call site" (SPEC-431/448/475/481).
- **Klausa ringkas:** ≤ 10 baris. Prompt sesi hidup di ARGV agen; setiap baris dibayar tiap sesi.
- **Klausa tak boleh memuat nama perintah** (`vitest`, `tsc`, `node`, `pnpm`, …). Prompt hidup di ARGV, jadi kata di dalamnya jadi muatan `pkill -f` milik sesi tetangga — sebab SPEC-402.
- **Gerbang flow memakai `writesCode(flow)` yang sudah ada** di `runner/src/prompt.ts:193`. Jangan menyalin daftar flow.
- **`agentRosterBlock` (codex) TIDAK menerima klausa** — roster itu ditempel ke prompt sesi yang sudah membawanya; hanya `agentPromptOf` (jalur `claude --agents`, konteks subagent terpisah) yang menerimanya.
- Docs yang tersentuh diperbarui **dalam commit yang sama** dan ADR baru ditaut di **`internal/docs/README.md` DAN `internal/docs/adr/README.md`** (SPEC-386).
- Verifikasi ber-scope perubahan saja (ADR-0080). Perintah test server **wajib** `--no-file-parallelism` **dan** `TEST_DATABASE_URL` terisolasi (SPEC-479).

## File Structure

| Berkas | Tanggung jawab | Aksi |
|---|---|---|
| `runner/src/code-style.ts` | Teks klausa gaya kode (satu-satunya definisi) | **Create** |
| `runner/src/index.ts` | Barrel `@hanoman/runner` | Modify — re-export |
| `runner/test/code-style.test.ts` | Kontrak isi klausa (lima butir + pagar) | **Create** |
| `runner/src/prompt.ts` | Builder prompt sesi backlog/goal/dokumen | Modify — sisip di 4 builder |
| `runner/test/prompt.test.ts` | Kontrak builder prompt | Modify — `describe` baru |
| `runner/src/custom-agents.ts` | Render custom agent (claude JSON · codex roster) | Modify — `agentPromptOf` |
| `runner/test/custom-agents.test.ts` | Kontrak render custom agent | Modify — 3 test |
| `server/src/routes/specs.ts:318-323` | Prompt sesi konflik backlog | Modify — sisip klausa |
| `server/src/routes/ide.ts:375-380` | Prompt sesi konflik git graph | Modify — sisip klausa |
| `server/src/routes/terminal.ts` (integrate PRD) | Prompt sesi konflik PRD | Modify — sisip klausa |
| `server/test/conflict-prompt-code-style.test.ts` | Ketiga pintu konflik membawa klausa | **Create** |
| `server/src/services/lead/prompt.ts` | Prompt hanoman-lead | Modify — satu section |
| `server/test/lead-prompt.test.ts` | Kontrak prompt lead | Modify — 1 test |
| `server/src/services/changelog/render.ts` | Prompt narator changelog | Modify — satu baris aturan |
| `server/test/changelog-render.test.ts` | Kontrak prompt changelog | Modify — 1 test |
| `server/test/session-launch.test.ts` | Bukti end-to-end lewat pane tmux | Modify — `describe` baru |
| `internal/docs/adr/0108-klausa-gaya-kode-prompt-agen.md` | ADR (sudah ditulis fase Spec) | — |
| `internal/docs/README.md` | Index SoT | Modify — entri ADR 0108 |
| `internal/docs/adr/README.md` | Narasi ADR | Modify — narasi 0108 |
| `internal/docs/requirements/frd.md` | FRD (EARS) | Modify — satu klausa EARS |
| `internal/skills/hanoman/SKILL.md` | Skill project | Modify — satu butir |

---

### Task 1: Konstanta `CODE_STYLE_CLAUSE` + kontraknya

Berkas ini adalah satu-satunya tempat teks klausa boleh hidup. Test-nya mengikat kelima butir objective SPEC-543 supaya klausa tak bisa "diperbaiki" jadi kehilangan salah satunya, plus dua pagar: ia tak boleh terbaca sebagai larangan berkomentar, dan ia tak boleh memuat nama perintah (SPEC-402).

**Files:**
- Create: `runner/src/code-style.ts`
- Create: `runner/test/code-style.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Produces: `export const CODE_STYLE_CLAUSE: string` — dipakai Task 2 (`prompt.ts`), Task 3 (`custom-agents.ts`), Task 4 (route konflik), Task 5 (lead), Task 6 (changelog). Diekspor ulang dari `@hanoman/runner`.

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/code-style.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CODE_STYLE_CLAUSE } from "../src/code-style";

// SPEC-543 · ADR-0108. Kelima butir di bawah adalah objective spec-nya; mengikatnya di sini
// membuat "merapikan" klausa tak bisa diam-diam menghapus salah satunya.
describe("CODE_STYLE_CLAUSE", () => {
  it("menggerbangi dirinya sendiri di baris pertama (klausa dipasang juga di prompt non-kode)", () => {
    const first = CODE_STYLE_CLAUSE.split("\n")[0]!.toLowerCase();
    expect(first).toContain("gaya kode");
    expect(first).toMatch(/menulis atau mengubah kode/);
  });

  it("butir 1 — rapi & mengikuti idiom/penamaan/struktur sekitarnya", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    for (const kata of ["idiom", "penamaan", "struktur"]) expect(c).toContain(kata);
  });

  it("butir 2 — melarang komentar yang mengulang kode", () => {
    expect(CODE_STYLE_CLAUSE.toLowerCase()).toContain("mengulang");
  });

  it("butir 3 — menyebut apa yang JUSTRU layak dikomentari", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    for (const kata of ["alasan", "trade-off", "workaround", "invariant"]) expect(c).toContain(kata);
    expect(CODE_STYLE_CLAUSE).toMatch(/SPEC\/ADR/);
  });

  it("butir 4 — melarang pembatas seksi, header berhiasan, narasi langkah demi langkah", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    for (const kata of ["pembatas seksi", "berhias", "langkah demi langkah"]) expect(c).toContain(kata);
  });

  it("butir 5 — melarang kode mati / kode yang dikomentari", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    expect(c).toContain("kode mati");
    expect(c).toContain("dikomentari");
  });

  // Pagar 1 · hanoman sendiri bergantung pada komentar ber-rujukan SPEC/ADR di titik cekiknya
  // (verify-scope.ts, brain.ts). Klausa yang terbaca "kurangi komentar" akan menghapus justru
  // informasi yang tak bisa dipulihkan dari kode.
  it("tidak melarang komentar secara umum", () => {
    expect(CODE_STYLE_CLAUSE.toLowerCase()).not.toMatch(/jangan menulis komentar\.|tanpa komentar\b/);
  });

  // Pagar 2 · SPEC-402: prompt sesi hidup di ARGV agennya, jadi nama perintah di dalam klausa
  // menjadikannya sasaran `pkill -f` milik sesi tetangga.
  it("tidak memuat nama perintah yang bisa jadi pola pkill", () => {
    const c = CODE_STYLE_CLAUSE.toLowerCase();
    for (const cmd of ["vitest", "tsc", "pnpm", "node ", "npm "]) expect(c).not.toContain(cmd);
  });

  // Prompt dibayar tiap sesi. Klausa yang membengkak adalah klausa yang akan dicabut.
  it("ringkas — paling banyak 10 baris", () => {
    expect(CODE_STYLE_CLAUSE.split("\n").length).toBeLessThanOrEqual(10);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run runner/test/code-style.test.ts
```
Expected: FAIL — `Failed to load ../src/code-style`.

- [x] **Step 3: Tulis konstantanya**

Buat `runner/src/code-style.ts`:

```ts
// SPEC-543 · ADR-0108 — klausa gaya kode.
//
// Lubangnya sama persis dengan yang ditutup ADR-0080 untuk scope verifikasi: prompt sesi bicara
// fase, otonomi, skill, commit, dan push, tapi tak sekali pun menyebut bentuk kode yang diharapkan.
// Karena diam, tiap sesi jatuh ke kebiasaan default modelnya — dan kebiasaan itu adalah menarasikan
// kode yang baru saja ditulisnya.
//
// Baris pertama menggerbangi seluruh klausa. Itu syarat, bukan gaya bahasa: konstanta yang SAMA
// dipasang di prompt yang keluarannya bukan kode (hanoman-lead, narator changelog), dan tanpa
// gerbang tekstual ia harus bercabang jadi dua varian yang wajib tetap sepakat — kelas bug
// "satu definisi, N call site" (SPEC-431/448/475/481) dalam bentuk teks.
//
// Ia TIDAK melarang komentar. Yang dilarang adalah komentar yang mengulang kode; komentar seperti
// yang sedang kamu baca ini justru bentuk yang diminta butir 3.
export const CODE_STYLE_CLAUSE = [
  "Gaya kode — berlaku setiap kali kamu menulis atau mengubah kode:",
  "- Tulis kode yang rapi dan mengikuti idiom, penamaan, serta struktur kode di sekitarnya.",
  "  Kodemu harus terbaca seperti kode yang sudah ada di berkas itu, bukan seperti tempelan.",
  "- Jangan menulis komentar yang cuma mengulang apa yang sudah dinyatakan kode.",
  "- Komentar hanya untuk hal yang TIDAK terbaca dari kode: alasan/why sebuah keputusan,",
  "  trade-off yang diambil, workaround beserta rujukan SPEC/ADR-nya, atau invariant yang tak",
  "  kelihatan. Komentar semacam itu justru berharga — jangan ikut dibuang.",
  "- Jangan menambahkan komentar pembatas seksi, header berhiasan, atau narasi langkah demi langkah.",
  "- Jangan meninggalkan kode mati atau kode yang dikomentari. Hapus saja; riwayat git yang menyimpannya.",
].join("\n");
```

- [x] **Step 4: Re-export dari barrel**

`runner/src/index.ts` — tambahkan sejajar baris `export * from "./verify-scope";`:

```ts
export * from "./code-style";
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run runner/test/code-style.test.ts
```
Expected: PASS (10 test).

---

### Task 2: Klausa masuk keempat builder prompt sesi backlog & goal

`writesCode(flow)` sudah menjadi definisi tunggal "sesi ini menulis kode" (dipakai `scopeClause`). Task ini menaruh klausa di gerbang yang sama, sehingga flow dokumen tetap bersih dan flow baru yang menulis kode otomatis ikut.

**Files:**
- Modify: `runner/src/prompt.ts` (import, `codeStyleClause`, 4 builder)
- Test: `runner/test/prompt.test.ts` (tambah `describe` di akhir berkas)

**Interfaces:**
- Consumes: `CODE_STYLE_CLAUSE` (Task 1), `writesCode(flow)` (`runner/src/prompt.ts:193`).
- Produces: `startPrompt`/`continuePrompt`/`resumePrompt`/`startGoalPrompt` memuat klausa. Task 7 bersandar pada ini untuk bukti end-to-end.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di **akhir** `runner/test/prompt.test.ts`:

```ts
// SPEC-543 · ADR-0108 · klausa gaya kode. Gerbangnya `writesCode(flow)` — sumber kebenaran yang
// SAMA dengan klausa scope (ADR-0080 keputusan 4), jadi flow dokumen tetap tak membayar token
// untuk instruksi yang tak punya kode untuk diterapkan.
describe("klausa gaya kode (SPEC-543)", () => {
  const spec = { id: "SPEC-543", title: "t", objective: "o", source: "brief", priority: "sedang" } as const;
  const MARK = "Gaya kode —";

  it("startPrompt flow feature membawanya", () => {
    expect(startPrompt("feature", spec, "b")).toContain(MARK);
  });

  it("startPrompt flow qa membawanya", () => {
    expect(startPrompt("qa", spec, "b")).toContain(MARK);
  });

  it("continuePrompt & resumePrompt membawanya", () => {
    expect(continuePrompt("feature", spec, "b")).toContain(MARK);
    expect(resumePrompt("feature", spec, "b", { recorded: [], next: "Execute", worktreeKept: true }))
      .toContain(MARK);
  });

  it("startGoalPrompt membawanya (flow goal menulis kode walau tanpa fase Execute)", () => {
    expect(startGoalPrompt({ ...spec, source: "goal" }, "b")).toContain(MARK);
  });

  // Tak bergantung pada verifyScope: klausa gaya kode tak punya knob (ADR-0108 keputusan 4).
  it("hadir tanpa parameter verifyScope maupun dengan verifyScope full", () => {
    expect(startPrompt("feature", spec, "b")).toContain(MARK);
    expect(startPrompt("feature", spec, "b", undefined, "full")).toContain(MARK);
  });

  it("flow dokumen tidak membawanya", () => {
    expect(startPrompt("audit", spec, "b")).not.toContain(MARK);
    expect(startProjectPrompt("reverse", { id: "p", name: "P", desc: "", stack: "" }, "b"))
      .not.toContain(MARK);
    expect(startScaffoldPrompt({ id: "p", name: "P", desc: "i", stack: "" }, "b")).not.toContain(MARK);
    expect(startPrdPrompt({ id: "p", name: "P", desc: "", stack: "" },
      { title: "t", context: "c", outcome: "o" }, "prd/x")).not.toContain(MARK);
    expect(startBreakdownPrompt({ id: "p", name: "P", desc: "", stack: "" },
      { title: "t", path: "docs/prd/x.md", content: "c" }, "prd/x")).not.toContain(MARK);
  });

  it("hanya muncul SEKALI dalam satu prompt", () => {
    const p = startPrompt("feature", spec, "b", undefined, "changed");
    expect(p.split(MARK).length - 1).toBe(1);
  });
});
```

Bila salah satu builder di atas belum di-`import` di berkas test itu, tambahkan namanya ke daftar import yang sudah ada di baris pertama berkas.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run runner/test/prompt.test.ts -t "klausa gaya kode"
```
Expected: FAIL — beberapa `expect(...).toContain("Gaya kode —")` merah.

- [x] **Step 3: Implementasi**

`runner/src/prompt.ts` — tambahkan import di dekat baris 3:

```ts
import { CODE_STYLE_CLAUSE } from "./code-style";
```

Tepat di bawah `const scopeClause = …` (baris ~195), tambahkan:

```ts
// SPEC-543 · ADR-0108 · klausa gaya kode. Gerbang yang SAMA dengan scopeClause (`writesCode`):
// flow dokumen tak menulis kode, jadi klausanya di sana cuma menambah token. Tak ber-knob —
// tak ada keadaan di mana "sesi ini boleh menulis komentar yang mengulang kode" masuk akal.
const codeStyleClause = (flow: Flow): string => writesCode(flow) ? CODE_STYLE_CLAUSE : "";
```

Sisipkan `codeStyleClause(flow)` sebagai elemen array **tepat sesudah** `scopeClause(...)` di:
- `startPrompt` (baris ~210)
- `continuePrompt` (baris ~236)
- `resumePrompt` (baris ~300)

dan `codeStyleClause("goal")` tepat sesudah `scopeClause("goal", opts.verifyScope)` di `startGoalPrompt` (baris ~337).

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run runner/test/prompt.test.ts
```
Expected: PASS (seluruh berkas, termasuk test lama).

---

### Task 3: Klausa masuk prompt custom agent (jalur `claude --agents`)

Subagent claude yang lahir dari `--agents` punya konteks **terpisah** — prompt sesi tak pernah sampai ke sana. `agentRosterBlock` (codex) sengaja tak disentuh: ia ditempel ke akhir prompt sesi yang sudah membawa klausa.

**Files:**
- Modify: `runner/src/custom-agents.ts` (`agentPromptOf`)
- Test: `runner/test/custom-agents.test.ts`

**Interfaces:**
- Consumes: `CODE_STYLE_CLAUSE` (Task 1).
- Produces: keluaran `agentPromptOf` (dan karenanya `renderAgentsJson`) memuat klausa; `agentRosterBlock` tidak.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di **akhir** `runner/test/custom-agents.test.ts`:

```ts
// SPEC-543 · ADR-0108 · subagent claude punya konteks TERPISAH: prompt sesi (yang membawa klausa
// gaya kode) tak pernah sampai ke sana, jadi klausanya harus ikut di prompt perannya sendiri.
describe("klausa gaya kode di custom agent (SPEC-543)", () => {
  const MARK = "Gaya kode —";

  it("agen daun membawanya", () => {
    expect(agentPromptOf(def({ name: "b" }), [])).toContain(MARK);
  });

  it("agen ber-mentions membawanya juga (kedua cabang)", () => {
    const a = def({ name: "a", mentions: ["b"] });
    expect(agentPromptOf(a, [a, def({ name: "b" })])).toContain(MARK);
  });

  it("ikut terbawa ke JSON --agents", () => {
    const j = JSON.parse(renderAgentsJson([def({ name: "rev" })]));
    expect(j.rev.prompt).toContain(MARK);
  });

  // Roster codex ditempel ke AKHIR prompt sesi yang sudah membawa klausa; memasangnya lagi di sini
  // menggandakan teks yang sama sekali per peran.
  it("roster codex TIDAK mengulanginya", () => {
    expect(agentRosterBlock([def({ name: "a" }), def({ name: "b" })])).not.toContain(MARK);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run runner/test/custom-agents.test.ts -t "klausa gaya kode"
```
Expected: FAIL pada tiga test pertama.

- [x] **Step 3: Implementasi**

`runner/src/custom-agents.ts` — import di baris 2:

```ts
import { CODE_STYLE_CLAUSE } from "./code-style";
```

Ubah `agentPromptOf` supaya kedua cabang menutup dengan klausa:

```ts
export function agentPromptOf(def: AgentDef, roster: AgentDef[]): string {
  const can = liveMentions(def, roster);
  // SPEC-543 · ADR-0108 · subagent claude lahir dengan konteks terpisah — prompt sesi tak
  // menjangkaunya, jadi klausa gaya kode harus ikut di sini atau ia tak pernah sampai.
  if (can.length === 0) {
    return [
      def.instructions,
      "",
      "---",
      "Kamu TIDAK boleh mendelegasikan ke agen lain. Selesaikan sendiri lalu laporkan hasilnya.",
      "",
      CODE_STYLE_CLAUSE,
    ].join("\n");
  }
  const list = can.map((m) => `@${m}`).join(", ");
  return [
    def.instructions,
    "",
    "---",
    `Kamu boleh mendelegasikan HANYA ke: ${list}. Panggil lewat ${MENTION_TOOL} dengan nama agennya.`,
    `Anggaran rantai delegasi seluruh sesi ini ${MENTION_MAX_HOPS} hop. Bila kamu sudah berada di hop ke-${MENTION_MAX_HOPS}, JANGAN mendelegasikan lagi — selesaikan sendiri lalu laporkan.`,
    "Sebutkan hop keberapa kamu berada saat mendelegasikan, dan jangan pernah memanggil agen yang sudah ada di rantai yang membawamu ke sini.",
    "",
    CODE_STYLE_CLAUSE,
  ].join("\n");
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run runner/test/custom-agents.test.ts
```
Expected: PASS (seluruh berkas — test lama `toContain("instruksi b")` dst. tetap hijau).

---

### Task 4: Klausa masuk ketiga pintu sesi konflik

Menyelesaikan konflik rebase/merge selalu berarti menyunting kode, dan ketiga prompt itu dirakit **inline di route**, bukan lewat `runner/src/prompt.ts` — jadi mereka tak ikut kecipratan Task 2.

**Files:**
- Modify: `server/src/routes/specs.ts:318-323`
- Modify: `server/src/routes/ide.ts:375-380`
- Modify: `server/src/routes/terminal.ts` (blok prompt konflik `POST /terminal/sessions/:id/integrate`)
- Create: `server/test/conflict-prompt-code-style.test.ts`

**Interfaces:**
- Consumes: `CODE_STYLE_CLAUSE` dari `@hanoman/runner` (Task 1).
- Produces: ketiga prompt konflik memuat klausa.

- [x] **Step 1: Temukan blok prompt PRD**

```bash
grep -n "selesaikan konflik" server/src/routes/terminal.ts
```
Catat nomor barisnya — bentuk arraynya sama dengan dua yang lain.

- [x] **Step 2: Tulis test yang gagal**

Buat `server/test/conflict-prompt-code-style.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SPEC-543 · ADR-0108 · ketiga pintu konflik merakit prompt-nya INLINE di route, bukan lewat
// `runner/src/prompt.ts` — jadi mereka tak ikut kecipratan gerbang `writesCode`. Test ini membaca
// SUMBER-nya (pola `changelog-nav.test.tsx` SPEC-519): perilaku ketiga route itu butuh konflik git
// sungguhan untuk direproduksi, sementara yang dijaga di sini adalah "call site-nya tidak lupa" —
// dan itu memang pertanyaan tentang sumber.
const ROOT = join(import.meta.dirname, "..", "src", "routes");
const src = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("prompt sesi konflik membawa klausa gaya kode (SPEC-543)", () => {
  const gates: [string, string][] = [
    ["specs.ts", "POST /specs/:id/integrate"],
    ["ide.ts", "finishGraphOp (git graph)"],
    ["terminal.ts", "POST /terminal/sessions/:id/integrate (PRD)"],
  ];

  for (const [file, label] of gates) {
    it(`${label} menyisipkan CODE_STYLE_CLAUSE`, () => {
      const s = src(file);
      expect(s).toContain("CODE_STYLE_CLAUSE");
      // Ia harus berada di dalam rakitan prompt konflik, bukan sekadar ter-import.
      const i = s.indexOf("selesaikan konflik");
      expect(i).toBeGreaterThan(-1);
      expect(s.slice(i, i + 1200)).toContain("CODE_STYLE_CLAUSE");
    });
  }
});
```

- [x] **Step 3: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/conflict-prompt-code-style.test.ts --no-file-parallelism
```
Expected: FAIL ×3 — `expect(s).toContain("CODE_STYLE_CLAUSE")`.

- [x] **Step 4: Implementasi — `server/src/routes/specs.ts`**

Tambahkan `CODE_STYLE_CLAUSE` ke daftar import dari `@hanoman/runner` di berkas itu (bila belum ada baris import dari paket itu, buat satu). Lalu ubah rakitan prompt (baris ~318):

```ts
    const prompt = [
      `hanoman · selesaikan konflik ${r.op} branch \`${sourceBranch(spec.id)}\` ${r.op === "merge" ? "ke" : "di atas"} \`${r.target}\`.`,
      `Kamu berada di worktree yang tertinggal di tengah operasi ${r.op} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
      r.finalize,
      // SPEC-543 · ADR-0108 · menyelesaikan konflik selalu berarti menyunting kode, dan prompt ini
      // dirakit inline di route — gerbang `writesCode` di runner/src/prompt.ts tak menjangkaunya.
      CODE_STYLE_CLAUSE,
      `Backlog item ${spec.id} — ${spec.title}.`,
    ].join("\n\n");
```

- [x] **Step 5: Implementasi — `server/src/routes/ide.ts`**

Tambahkan `CODE_STYLE_CLAUSE` ke import dari `@hanoman/runner`, lalu (baris ~375):

```ts
  const prompt = [
    `hanoman · selesaikan konflik ${verb} \`${r.source}\` → \`${r.target}\`.`,
    `Kamu berada di worktree yang tertinggal di tengah ${verb} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
    r.finalize,
    // SPEC-543 · ADR-0108 · cermin pintu konflik backlog di routes/specs.ts.
    CODE_STYLE_CLAUSE,
    `${verb} via git graph project ${id}.`,
  ].join("\n\n");
```

- [x] **Step 6: Implementasi — `server/src/routes/terminal.ts`**

Tambahkan `CODE_STYLE_CLAUSE` ke import `@hanoman/runner` yang sudah ada di baris 5, lalu sisipkan elemen `CODE_STYLE_CLAUSE` **tepat sesudah** elemen `r.finalize` pada rakitan prompt konflik PRD, dengan komentar yang sama:

```ts
      // SPEC-543 · ADR-0108 · cermin pintu konflik backlog di routes/specs.ts.
      CODE_STYLE_CLAUSE,
```

- [x] **Step 7: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/conflict-prompt-code-style.test.ts --no-file-parallelism
```
Expected: PASS (3 test).

---

### Task 5: Klausa masuk prompt hanoman-lead

`services/lead/brain.ts` adalah titik spawn agen **kedua** dan yang selalu terlewat (SPEC-448). Keluaran lead adalah blok JSON, bukan kode — gerbang di baris pertama klausa yang menanganinya.

**Files:**
- Modify: `server/src/services/lead/prompt.ts` (`leadPrompt`)
- Test: `server/test/lead-prompt.test.ts`

**Interfaces:**
- Consumes: `CODE_STYLE_CLAUSE` dari `@hanoman/runner` (Task 1).
- Produces: `leadPrompt(q, c)` memuat klausa.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di **akhir** `server/test/lead-prompt.test.ts` (pakai helper/fixture yang sudah ada di berkas itu; bila belum ada, pakai bentuk di bawah):

```ts
// SPEC-543 · ADR-0108 · `lead/brain.ts` adalah titik spawn agen KEDUA — yang terlewat SPEC-448
// selama berbulan-bulan. Keluaran lead adalah blok JSON, bukan kode; yang menanganinya adalah
// gerbang di baris pertama klausa ("berlaku setiap kali kamu menulis atau mengubah kode"),
// bukan percabangan di pemanggil.
describe("klausa gaya kode di prompt lead (SPEC-543)", () => {
  it("leadPrompt membawanya", () => {
    const p = leadPrompt(
      { kind: "answer", question: "pilih A atau B" },
      { projectId: "p", projectName: "P", repoDir: null, timeoutSec: 600 },
    );
    expect(p).toContain("Gaya kode —");
  });

  it("kontrak jawaban ringkas (ADR-0098) tetap utuh di prompt yang sama", () => {
    const p = leadPrompt(
      { kind: "answer", question: "q" },
      { projectId: "p", projectName: "P", repoDir: null, timeoutSec: 600 },
    );
    expect(p).toContain("Bentuk jawaban (WAJIB)");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/lead-prompt.test.ts -t "klausa gaya kode" --no-file-parallelism
```
Expected: FAIL pada test pertama.

- [x] **Step 3: Implementasi**

`server/src/services/lead/prompt.ts` — import:

```ts
import { CODE_STYLE_CLAUSE } from "@hanoman/runner";
```

Sisipkan **sebelum** `lines.push("## Sepanjang apa (WAJIB)")`:

```ts
  // SPEC-543 · ADR-0108 · lead tak menulis kode sendiri, tapi `reply`-nya diketikkan ke terminal
  // agen peminta dan `decision`-nya mengarahkan apa yang ditulis di sana. Gerbang di baris pertama
  // klausa yang membuatnya diam saat lead sekadar memutuskan — bukan percabangan di sini.
  lines.push(CODE_STYLE_CLAUSE);
  lines.push("");
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/lead-prompt.test.ts --no-file-parallelism
```
Expected: PASS (seluruh berkas).

---

### Task 6: Klausa masuk prompt narator changelog

Konsumen kedua `think()`. Keluarannya markdown untuk pemakai; klausa diam di sana karena gerbang baris pertamanya, dan ia tetap dipasang agar tak ada titik spawn yang punya perlakuan khusus.

**Files:**
- Modify: `server/src/services/changelog/render.ts` (`changelogPrompt`)
- Test: `server/test/changelog-render.test.ts`

**Interfaces:**
- Consumes: `CODE_STYLE_CLAUSE` dari `@hanoman/runner` (Task 1).
- Produces: `changelogPrompt(input, budgetMs)` memuat klausa; bentuk keluaran markdown-nya tak berubah.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di **akhir** `server/test/changelog-render.test.ts`:

```ts
// SPEC-543 · ADR-0108 · konsumen KEDUA `think()` (titik spawn agen kedua). Keluarannya markdown
// untuk pemakai, jadi klausanya diam karena gerbang baris pertamanya — ia tetap dipasang supaya
// tak ada titik spawn yang punya perlakuan khusus untuk dilupakan nanti.
describe("klausa gaya kode di prompt changelog (SPEC-543)", () => {
  const input = { mode: "backlog" as const, title: "Juli", items: [], notes: [] };

  it("changelogPrompt membawanya", () => {
    expect(changelogPrompt(input, 180_000)).toContain("Gaya kode —");
  });

  it("bentuk keluaran & anggaran waktu tetap utuh", () => {
    const p = changelogPrompt(input, 180_000);
    expect(p).toContain("Anggaran waktumu 180 detik");
    expect(p).toContain("# Changelog — Juli");
  });
});
```

Bila `changelogPrompt` belum di-import di berkas test itu, tambahkan ke daftar import yang sudah ada.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/changelog-render.test.ts -t "klausa gaya kode" --no-file-parallelism
```
Expected: FAIL pada test pertama.

- [x] **Step 3: Implementasi**

`server/src/services/changelog/render.ts` — import di baris 2:

```ts
import { CODE_STYLE_CLAUSE } from "@hanoman/runner";
```

Sisipkan sebagai elemen array di `changelogPrompt`, **tepat sesudah** baris `"Jangan mengarang perubahan yang tak ada di bahan.",` dan sebelum `""`:

```ts
    "",
    // SPEC-543 · ADR-0108 · dipasang di SEMUA prompt agen, bukan hanya yang menulis kode.
    // Gerbang di baris pertama klausa membuatnya diam untuk narator ini.
    CODE_STYLE_CLAUSE,
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/changelog-render.test.ts --no-file-parallelism
```
Expected: PASS (seluruh berkas).

---

### Task 7: Bukti end-to-end — klausa benar-benar sampai ke proses agen

Ini inti acceptance SPEC-543 ("test yang memastikan klausa benar-benar ikut terkirim di prompt sesi, bukan cuma ada di dokumen"). Memanggil `startPrompt()` hanya membuktikan builder-nya; buktinya harus datang dari sesi tmux sungguhan — pola yang sudah dipakai test scope verifikasi di berkas yang sama (`argvOf` membaca pane dengan `HANOMAN_CLAUDE_BIN=/bin/echo`, yang mencetak ARGV-nya utuh).

**Files:**
- Test: `server/test/session-launch.test.ts` (tambah `describe` di akhir berkas)

**Interfaces:**
- Consumes: `startSpecSession`, `killSession`, helper lokal `seedRepo`, `argvOf`, `setSetting` yang sudah ada di berkas itu.
- Produces: bukti bahwa klausa hidup di ARGV proses agen untuk **kedua** runtime.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di dalam `describe("session-launch", …)`, di akhir berkas `server/test/session-launch.test.ts`:

```ts
  // SPEC-543 · ADR-0108 · klausa gaya kode. Bukti diambil dari PANE, bukan dari builder prompt:
  // yang dikhawatirkan spec ini justru call site yang lupa memanggil builder-nya. Prompt sesi
  // diserahkan sebagai argumen positional agen (SPEC-223), jadi `/bin/echo` sebagai biner agen
  // mencetak seluruh prompt apa adanya.
  describe("klausa gaya kode sampai ke proses agen (SPEC-543)", () => {
    const MARK = "Gaya kode";

    it("sesi backlog claude membawanya di argv", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      const spec = await seedRepo("SPEC-543A");
      const r = await startSpecSession(spec, { flow: "feature" });
      const pane = await argvOf(r.id);
      expect(pane).toContain(MARK);
      expect(pane).toContain("mengulang");            // butir "jangan mengulang kode"
      killSession(r.id);
    });

    it("sesi backlog codex membawanya juga (klausa netral-agen)", async () => {
      process.env.HANOMAN_CODEX_BIN = "/bin/echo";
      await setSetting({ agent: "codex" });
      const spec = await seedRepo("SPEC-543B");
      const r = await startSpecSession(spec, { flow: "feature" });
      expect(await argvOf(r.id)).toContain(MARK);
      killSession(r.id);
    });

    // Tak ber-knob: `verifyScope: "full"` mematikan klausa scope, bukan klausa ini.
    it("verifyScope full tetap membawanya", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await setSetting({ verifyScope: "full" });
      const spec = await seedRepo("SPEC-543C");
      const r = await startSpecSession(spec, { flow: "feature" });
      const pane = await argvOf(r.id);
      expect(pane).not.toContain("Scope verifikasi");
      expect(pane).toContain(MARK);
      killSession(r.id);
    });
  });
```

- [x] **Step 2: Jalankan test, pastikan LULUS** (Task 2 sudah membuat implementasinya ada)

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/session-launch.test.ts --no-file-parallelism
```
Expected: PASS (seluruh berkas). Bila `server exited unexpectedly` muncul, socket tmux `hanoman-test` basi — hapus lalu ulang.

---

### Task 8: Docs SoT + index

ADR-0108 sudah ditulis di fase Spec. Task ini menautkannya dan memperbarui doc yang tersentuh, **dalam commit yang sama** dengan kodenya.

**Files:**
- Modify: `internal/docs/README.md` (bagian `## adr`)
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/requirements/frd.md:112`
- Modify: `internal/skills/hanoman/SKILL.md`

- [x] **Step 1: Tautkan ADR di index SoT**

`internal/docs/README.md`, di bagian `## adr`, **di atas** baris 0107:

```markdown
- [0108 — Klausa gaya kode: satu konstanta di setiap prompt agen, tanpa knob](adr/0108-klausa-gaya-kode-prompt-agen.md)
```

- [x] **Step 2: Tautkan + narasikan di sub-index ADR**

`internal/docs/adr/README.md` — tambahkan entri 0108 mengikuti bentuk entri 0107 yang ada di sana (judul + narasi apa yang diperluas/ditegakkan + gotcha).

- [x] **Step 3: Klausa EARS di FRD**

`internal/docs/requirements/frd.md`, tepat **sesudah** baris 112 (butir `verifyScope`):

```markdown
- THE SYSTEM SHALL menyertakan klausa gaya kode yang sama di setiap prompt agen yang dilahirkannya —
  sesi backlog & goal, tiga pintu konflik, prompt custom agent, prompt lead, dan prompt narator
  changelog — tanpa knob dan tanpa override per sesi
  ([ADR-0108](../adr/0108-klausa-gaya-kode-prompt-agen.md)).
```

- [x] **Step 4: Butir di skill project**

`internal/skills/hanoman/SKILL.md`, di bagian **Aturan Sesi & Eksekusi**, tambahkan satu butir yang menyebut: satu konstanta `CODE_STYLE_CLAUSE` (`runner/src/code-style.ts`), gerbang tekstual di baris pertama, daftar permukaan yang menerimanya, `agentRosterBlock` codex sengaja tidak, dan larangan menaruh nama perintah di dalamnya (SPEC-402).

- [x] **Step 5: Verifikasi integritas index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || echo "CLI belum di-build — lewati; entri sudah ditambahkan manual"
```

---

### Task 9: Verifikasi ber-scope + commit + push

- [x] **Step 1: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck
```
Expected: keduanya exit 0.

- [x] **Step 2: Jalankan test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: seluruh berkas hijau. **Jangan** menerima "no test files" sebagai bukti — `--changed` menyalakan `passWithNoTests`. Pastikan `code-style`, `prompt`, `custom-agents`, `session-launch`, `lead-prompt`, `changelog-render`, dan `conflict-prompt-code-style` benar-benar muncul di daftar berkas yang dijalankan.

- [x] **Step 3: Centang seluruh kotak plan ini**

Setiap `- [ ]` di berkas ini menjadi `- [x]`. hanoman menahan backlog di `executing` selama masih ada kotak kosong (ADR-0029).

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(spec-543): klausa gaya kode di setiap prompt agen (ADR-0108)"
```

- [x] **Step 5: Periksa tabrakan nomor ADR sebelum push**

```bash
git fetch origin --quiet
for b in $(git branch -a --format='%(refname:short)'); do git ls-tree --name-only "$b" internal/docs/adr/ 2>/dev/null; done | grep -oE '0[0-9]{3}' | sort -u | tail -3
git worktree list
```
Bila 0108 sudah diklaim branch lain, rename berkas + seluruh rujukannya ke nomor bebas berikutnya.

- [x] **Step 6: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-543
```
