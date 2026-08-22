# Pet inbox keputusan (SPEC-899) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel pet bisa menjawab dialog `AskUserQuestion` sebuah sesi agen langsung dari dashboard, lewat dua endpoint bergerbang `screenHash` yang membungkus `tui-dialog.ts` apa adanya.

**Architecture:** Satu modul server baru (`services/session-dialog.ts`) memetakan `DialogScreen` → DTO shared dan mendispatch jawaban ke primitif `tui-dialog.ts` yang sudah ada, dengan `PaneIO` disuntikkan. Dua route tipis di `routes/terminal.ts` menambahkan gerbang sesi (`404`), gerbang lead (`409 deciding`), dan kunci in-flight (`409 answering`). Di frontend, komponen `PetAnswer.tsx` sendiri merender pertanyaan + opsi di dalam panel pet; gelembung `waiting` menumbuhkan CTA "Jawab di sini".

**Tech Stack:** TypeScript strict · Fastify · zod (shared) · React 18 · vitest + @testing-library/react · tmux/`capture-pane` (hanya di uji nyata).

## Global Constraints

- Spec acuan: `docs/superpowers/specs/2026-08-22-spec-899-pet-inbox-keputusan-design.md`. ADR baru: **ADR-0142**.
- **Jangan ubah** `sendToPane`, `submitPaneDialog`, satu pun primitif di `server/src/services/tui-dialog.ts`, `server/src/services/lead/gate.ts`, atau `server/src/services/lead/deciding.ts`. Satu-satunya perubahan yang diizinkan di `pty.ts` adalah **mengekspor** primitif pane yang sudah ada.
- Tanpa skema DB baru, tanpa migration, tanpa channel realtime baru, tanpa polling berkala.
- Tanpa tool MCP baru: `shared/src/mcp-catalog.ts` **tidak** disentuh.
- Peta capability `server/src/services/agent-capabilities.ts` **tidak** disentuh — `/api/terminal/*` sudah `rw("sessions")`.
- Bahasa komentar & string UI: Bahasa Indonesia, mengikuti berkas di sekitarnya. Komentar hanya untuk hal yang tak terbaca dari kode (alasan, trade-off, rujukan SPEC/ADR).
- Perintah test: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>` untuk test server; `pnpm vitest --run <path>` untuk test `src/` & `shared/`.
- Setiap task diakhiri commit. Centang `- [x]` tiap step yang selesai di berkas plan ini.

---

### Task 1: Kontrak shared — DTO dialog, skema jawaban, path builder

**Files:**
- Create: `shared/src/session-dialog.ts`
- Create: `shared/src/session-dialog.test.ts`
- Modify: `shared/src/index.ts` (tambah satu baris `export *`)
- Modify: `shared/src/api.ts:110` (tambah dua path builder setelah `terminalInterrupt`)

**Interfaces:**
- Consumes: `z` dari `zod` (sudah dipakai `shared/src/telegram.ts`).
- Produces: tipe `SessionDialogOption`, `SessionDialog`, `SessionDialogPayload`, `SessionDialogAnswer`; skema `zSessionDialogAnswer`; `paths.terminalDialog(id)`, `paths.terminalDialogAnswer(id)`.

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/session-dialog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { zSessionDialogAnswer } from "./session-dialog";
import { paths } from "./api";

describe("SPEC-899 · kontrak jawaban dialog sesi", () => {
  it("menerima jawaban single-select lewat nomor baris", () => {
    const r = zSessionDialogAnswer.safeParse({ screenHash: "abc123", choice: 2 });
    expect(r.success).toBe(true);
  });

  it("menerima jawaban multiSelect + prosa", () => {
    const r = zSessionDialogAnswer.safeParse({ screenHash: "abc123", choices: [1, 3], text: "yang ini" });
    expect(r.success).toBe(true);
  });

  it("menerima centang kosong — 'batalkan semua lalu submit' adalah jawaban yang sah", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc123", choices: [] }).success).toBe(true);
  });

  it("menolak body tanpa satu pun bentuk jawaban", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc123" }).success).toBe(false);
  });

  it("menolak choice dan choices sekaligus — dua bentuk jawaban untuk satu layar", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc", choice: 1, choices: [2] }).success).toBe(false);
  });

  it("menolak screenHash kosong: gerbang kesegaran tak boleh bisa dilewati dengan string kosong", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "", choice: 1 }).success).toBe(false);
  });

  it("menolak nomor baris nol/negatif — baris dialog dinomori mulai 1", () => {
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc", choice: 0 }).success).toBe(false);
    expect(zSessionDialogAnswer.safeParse({ screenHash: "abc", choices: [-1] }).success).toBe(false);
  });

  it("path dialog duduk di bawah prefix /terminal supaya ikut capability sessions", () => {
    expect(paths.terminalDialog("s1")).toBe("/api/terminal/sessions/s1/dialog");
    expect(paths.terminalDialogAnswer("s1")).toBe("/api/terminal/sessions/s1/dialog/answer");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/session-dialog.test.ts`
Expected: FAIL — `Failed to resolve import "./session-dialog"`.

- [x] **Step 3: Tulis modul shared**

Buat `shared/src/session-dialog.ts`:

```ts
import { z } from "zod";

// SPEC-899 · ADR-0142 · bentuk dialog pilihan sebuah sesi, sebagaimana diserahkan server ke
// dashboard. Ini CERMIN `DialogScreen` milik server/src/services/tui-dialog.ts, bukan tipe itu
// sendiri: modul tersebut tahu soal tmux dan teks pane, dan frontend tak boleh mengimpornya.
export type SessionDialogOption = {
  n: number;
  label: string;
  /** Keadaan kotak centang; `null` untuk dialog yang memang tak punya kotak (single-select). */
  checked: boolean | null;
};

export type SessionDialog = {
  /** Judul pertanyaan; "" bila layarnya tak punya (dialog tanpa tab strip: trust, prompt izin). */
  title: string;
  /** Widget `multiSelect`: opsinya berkotak dan dikirim lewat tombol Submit tanpa nomor. */
  multi: boolean;
  /** Nomor baris kolom jawaban bebas, atau `null` bila dialog ini tak punya. */
  freeIndex: number | null;
  /** Varian ber-`preview`: tak ada baris kolom bebas; jalan masuk prosa lewat kolom catatan. */
  notes: boolean;
  /** Baris yang boleh dipilih — tanpa baris kolom bebas dan tanpa "Chat about this". */
  options: SessionDialogOption[];
  /** Strip pertanyaan dialog berantai (SPEC-474); `[]` untuk dialog satu pertanyaan. */
  tabs: { header: string; answered: boolean }[];
};

export type SessionDialogPayload = { dialog: SessionDialog; screenHash: string };

// `choice`/`choices` selalu NOMOR BARIS yang dipancarkan GET (`SessionDialogOption.n`), bukan
// indeks array: nomor itulah yang ditekan di pane, dan menerjemahkannya dua kali adalah cara
// paling mudah memilih opsi yang salah.
export const zSessionDialogAnswer = z.object({
  screenHash: z.string().min(1),
  choice: z.number().int().positive().optional(),
  choices: z.array(z.number().int().positive()).max(32).optional(),
  text: z.string().trim().min(1).max(16_000).optional(),
})
  .refine((v) => !(v.choice !== undefined && v.choices !== undefined),
    { message: "choice dan choices tak boleh dikirim bersamaan" })
  .refine((v) => v.choice !== undefined || v.choices !== undefined || v.text !== undefined,
    { message: "jawaban kosong" });

export type SessionDialogAnswer = z.infer<typeof zSessionDialogAnswer>;
```

- [x] **Step 4: Ekspor dari index shared**

Di `shared/src/index.ts`, setelah baris `export * from "./terminal-io";`, tambahkan:

```ts
export * from "./session-dialog";
```

- [x] **Step 5: Tambah path builder**

Di `shared/src/api.ts`, tepat setelah baris `terminalInterrupt: (id: string) => …`, sisipkan:

```ts
  // SPEC-899 · ADR-0142 · inbox keputusan. Di bawah prefix /terminal supaya ikut capability
  // `sessions` yang sudah ada — GET menurunkan cabang bacanya, POST cabang tulisnya, tanpa satu
  // baris pun perubahan di services/agent-capabilities.ts.
  terminalDialog: (id: string) => `${API}/terminal/sessions/${id}/dialog`,
  terminalDialogAnswer: (id: string) => `${API}/terminal/sessions/${id}/dialog/answer`,
```

- [x] **Step 6: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/src/session-dialog.test.ts`
Expected: PASS — 8 test.

- [x] **Step 7: Typecheck paket shared**

Run: `pnpm --filter ./shared typecheck`
Expected: keluar tanpa error.

- [x] **Step 8: Commit**

```bash
git add shared/src/session-dialog.ts shared/src/session-dialog.test.ts shared/src/index.ts shared/src/api.ts
git commit -m "feat(dialog): kontrak shared inbox keputusan sesi (SPEC-899)"
```

---

### Task 2: Service server — baca layar, hash, dan dispatch jawaban

**Files:**
- Modify: `server/src/services/pty.ts:718-728` (rename `dialogIO` → `paneIO` + ekspor)
- Create: `server/src/services/session-dialog.ts`
- Create: `server/test/session-dialog.test.ts`

**Interfaces:**
- Consumes: `PaneIO`, `readDialogScreen`, `dialogKey`, `answerChoiceDialog`, `answerMultiSelectDialog`, `answerNotesDialog` dari `./tui-dialog`; `SessionDialog`, `SessionDialogAnswer`, `SessionDialogPayload` dari `@hanoman/shared`.
- Produces: `screenHashOf(paneText: string): string`; `readSessionDialog(io: PaneIO): SessionDialogPayload | null`; `answerSessionDialog(io: PaneIO, input: SessionDialogAnswer, chunkMs?: number): Promise<AnswerResult>` dengan `AnswerResult = { ok: true } | { ok: false; reason: "stale" | "shape" | "not-landed" }`; `sessionPaneIO(id: string): PaneIO`; `beginAnswer(id): boolean`; `endAnswer(id): void`; `__setPaneIO(fn)`, `__resetPaneIO()`, `__resetAnswering()`; `paneIO(id: string): PaneIO` (dari `pty.ts`).

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/session-dialog.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PaneIO } from "../src/services/tui-dialog";
import { answerSessionDialog, readSessionDialog, screenHashOf } from "../src/services/session-dialog";

// Layar dialog nyata claude 2.1.220, dipangkas ke bagian yang dibaca tui-dialog.ts.
const SINGLE = [
  "  ←  ☐ Warna  ☐ Ukuran  →",
  "  Warna apa yang dipakai?",
  "",
  "❯ 1. merah",
  "  2. biru",
  "  3. Type something.",
  "  4. Chat about this",
  "",
  "  enter to select · esc to cancel",
].join("\n");

const MULTI = [
  "  ←  ☐ Paket  →",
  "  Paket mana yang ikut?",
  "",
  "❯ 1. [ ] alpha",
  "  2. [ ] beta",
  "  3. [ ] Type something",
  "",
  "     Submit",
  "",
  "  enter to select · esc to cancel",
].join("\n");

// Dialog trust codex: berdaftar & ber-footer, TAPI tanpa baris kolom bebas dan tanpa kolom catatan.
const TRUST = [
  "  Do you trust the files in this folder?",
  "❯ 1. Yes, proceed",
  "  2. No, exit",
  "",
  "  enter to confirm · esc to cancel",
].join("\n");

const NOT_A_DIALOG = "$ pnpm dev\n  ready in 312 ms\n";

function fakeIO(screens: string[]): PaneIO & { typed: string[]; enters: number; downs: number } {
  const typed: string[] = [];
  let at = 0;
  const io = {
    typed, enters: 0, downs: 0,
    capture: () => screens[Math.min(at, screens.length - 1)]!,
    literal: (s: string) => { typed.push(s); at = Math.min(at + 1, screens.length - 1); },
    enter: () => { io.enters += 1; },
    down: () => { io.downs += 1; at = Math.min(at + 1, screens.length - 1); },
    sleep: async () => { },
  };
  return io;
}

describe("SPEC-899 · membaca dialog sesi", () => {
  it("memetakan layar single-select jadi DTO tanpa baris bebas & tanpa Chat about this", () => {
    const found = readSessionDialog(fakeIO([SINGLE]));
    expect(found).not.toBeNull();
    expect(found!.dialog.title).toBe("Warna apa yang dipakai?");
    expect(found!.dialog.multi).toBe(false);
    expect(found!.dialog.freeIndex).toBe(3);
    expect(found!.dialog.options).toEqual([
      { n: 1, label: "merah", checked: null },
      { n: 2, label: "biru", checked: null },
    ]);
    expect(found!.dialog.tabs.map((t) => t.header)).toEqual(["Warna", "Ukuran"]);
  });

  it("memetakan layar multiSelect beserta keadaan kotaknya", () => {
    const found = readSessionDialog(fakeIO([MULTI]));
    expect(found!.dialog.multi).toBe(true);
    expect(found!.dialog.options).toEqual([
      { n: 1, label: "alpha", checked: false },
      { n: 2, label: "beta", checked: false },
    ]);
  });

  it("layar bukan dialog → null", () => {
    expect(readSessionDialog(fakeIO([NOT_A_DIALOG]))).toBeNull();
  });

  it("dialog trust/izin → null: tombol dashboard tak pernah menjawab prompt izin", () => {
    expect(readSessionDialog(fakeIO([TRUST]))).toBeNull();
  });

  it("hash berubah begitu dialognya lenyap, dan sama untuk layar yang sama", () => {
    expect(screenHashOf(SINGLE)).toBe(screenHashOf(SINGLE));
    expect(screenHashOf(SINGLE)).not.toBe(screenHashOf(NOT_A_DIALOG));
  });

  it("hash TIDAK berubah saat kotak centang berbalik — itu gotcha ADR-0102 #1", () => {
    const checked = MULTI.replace("1. [ ] alpha", "1. [✔] alpha").replace("☐ Paket", "☒ Paket");
    expect(screenHashOf(checked)).toBe(screenHashOf(MULTI));
  });
});

describe("SPEC-899 · menjawab dialog sesi", () => {
  const hashOf = (s: string) => screenHashOf(s);

  it("single-select: label opsi diketik ke kolom bebas, Enter hanya setelah teks mendarat", async () => {
    const landed = SINGLE.replace("3. Type something.", "3. biru");
    const io = fakeIO([SINGLE, SINGLE, landed]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choice: 2 }, 0);
    expect(r).toEqual({ ok: true });
    expect(io.typed).toEqual(["3", "biru"]);   // nomor kolom bebas dulu, baru prosanya
    expect(io.enters).toBe(1);
  });

  it("single-select: `text` menang atas label opsi", async () => {
    const landed = SINGLE.replace("3. Type something.", "3. hijau saja");
    const io = fakeIO([SINGLE, SINGLE, landed]);
    await answerSessionDialog(io, { screenHash: hashOf(SINGLE), text: "hijau saja" }, 0);
    expect(io.typed).toEqual(["3", "hijau saja"]);
  });

  it("multiSelect: mencentang lalu menekan Submit", async () => {
    const one = MULTI.replace("1. [ ] alpha", "1. [✔] alpha");
    const focused = one.replace("     Submit", "❯    Submit");
    const io = fakeIO([MULTI, one, one, focused]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(MULTI), choices: [1] }, 0);
    expect(r).toEqual({ ok: true });
    expect(io.typed).toEqual(["1"]);
    expect(io.enters).toBe(1);
  });

  it("hash basi → stale, dan tak satu byte pun dikirim ke pane", async () => {
    const io = fakeIO([SINGLE]);
    const r = await answerSessionDialog(io, { screenHash: "basi", choice: 1 }, 0);
    expect(r).toEqual({ ok: false, reason: "stale" });
    expect(io.typed).toEqual([]);
    expect(io.enters).toBe(0);
  });

  it("layar sudah bukan dialog → stale", async () => {
    const io = fakeIO([NOT_A_DIALOG]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choice: 1 }, 0);
    expect(r).toEqual({ ok: false, reason: "stale" });
  });

  it("nomor baris di luar opsi layar → shape", async () => {
    const io = fakeIO([SINGLE]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choice: 9 }, 0);
    expect(r).toEqual({ ok: false, reason: "shape" });
    expect(io.typed).toEqual([]);
  });

  it("`choices` di layar single → shape", async () => {
    const io = fakeIO([SINGLE]);
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choices: [1] }, 0);
    expect(r).toEqual({ ok: false, reason: "shape" });
  });

  it("teks tak mendarat → not-landed, dan Enter TIDAK ditekan (bug SPEC-452)", async () => {
    const io = fakeIO([SINGLE]);   // layar tak pernah berubah: kolom bebas tetap placeholder
    const r = await answerSessionDialog(io, { screenHash: hashOf(SINGLE), choice: 1 }, 0);
    expect(r).toEqual({ ok: false, reason: "not-landed" });
    expect(io.enters).toBe(0);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-dialog.test.ts`
Expected: FAIL — `Failed to resolve import "../src/services/session-dialog"`.

- [x] **Step 3: Ekspor primitif pane dari `pty.ts`**

Di `server/src/services/pty.ts`, ganti deklarasi `const dialogIO = (id: string): PaneIO => ({` menjadi `export const paneIO = (id: string): PaneIO => ({` dan perbarui komentar di atasnya menjadi:

```ts
// Primitif pane untuk SELURUH interaksi dialog. Satu tempat supaya `sendToPane`,
// `submitPaneDialog`, dan (SPEC-899) jalur jawaban manusia tak bisa berselisih soal cara mengetik
// — dua titik tulis yang tak sepakat adalah pola kegagalan SPEC-431/448.
```

Lalu ganti dua pemakaiannya (`const io = dialogIO(id);` di dalam `sendToPane` dan di dalam `submitPaneDialog`) menjadi `const io = paneIO(id);`. Tidak ada perubahan perilaku — hanya nama & visibilitas.

- [x] **Step 4: Tulis service**

Buat `server/src/services/session-dialog.ts`:

```ts
import { createHash } from "node:crypto";
import type { SessionDialogAnswer, SessionDialogPayload } from "@hanoman/shared";
import {
  answerChoiceDialog, answerMultiSelectDialog, answerNotesDialog, dialogKey, readDialogScreen,
  type DialogScreen, type PaneIO,
} from "./tui-dialog";
import { paneIO } from "./pty";

// SPEC-899 · ADR-0142 · membungkus tui-dialog.ts untuk MANUSIA di dashboard. Tak satu pun primitif
// di sana ditulis ulang: modul ini hanya memetakan layar → DTO, menjaga kesegarannya, lalu
// mendispatch ke jalur yang sama persis yang dipakai `sendToPane`.

/** Jeda antar potongan keystroke — nilai yang sama dengan default `sendToPane`. */
export const DIALOG_CHUNK_MS = 50;

/**
 * Identitas layar yang dijawab. Bersumber pada `dialogKey`, BUKAN pada teks pane mentah: teks pane
 * memuat kursor berkedip & spinner, jadi hash atasnya berbeda antar dua `capture-pane` berturut-
 * turut dan setiap jawaban akan ditolak. `dialogKey` sudah memikul dua pelajaran yang persis
 * dibutuhkan di sini — label kolom bebas tak ikut (SPEC-474) dan `☐/☒` tab strip layar multi
 * dibuang (gotcha ADR-0102 #1) — sehingga hash hanya berubah saat dialognya benar-benar berganti
 * atau terjawab. Di-hash supaya klien memperlakukannya sebagai token buram.
 */
export const screenHashOf = (paneText: string): string =>
  createHash("sha256").update(dialogKey(paneText)).digest("hex").slice(0, 16);

type Question = Extract<DialogScreen, { kind: "question" }>;

/**
 * Layar yang boleh dijawab dari dashboard. `null` untuk: bukan dialog, layar rekap rantai, dan
 * dialog TANPA kolom bebas maupun kolom catatan.
 *
 * Yang terakhir itu dialog trust & prompt izin. `sendToPane` sengaja tak menyentuhnya ("`Enter`
 * memilih baris 1 yang memang berarti 'ya'"), dan memasang tombol dashboard yang menjawabnya
 * adalah kebalikan penuh dari batas ADR-0037: kepercayaan penuh pada agen ditebus dengan isolasi
 * worktree, bukan dengan prompt izin yang bisa diklik dari jauh.
 */
const answerable = (paneText: string): Question | null => {
  const s = readDialogScreen(paneText);
  if (s?.kind !== "question") return null;
  if (!(s.multi && s.submit.present) && s.freeIndex === null && !s.notes) return null;
  return s;
};

export function readSessionDialog(io: PaneIO): SessionDialogPayload | null {
  const text = io.capture();
  const s = answerable(text);
  if (!s) return null;
  return {
    dialog: {
      title: s.title, multi: s.multi, freeIndex: s.freeIndex, notes: s.notes,
      options: s.rows.filter((r) => !r.free && !r.chat)
        .map((r) => ({ n: r.n, label: r.label, checked: r.checked })),
      tabs: s.tabs,
    },
    screenHash: screenHashOf(text),
  };
}

export type AnswerResult = { ok: true } | { ok: false; reason: "stale" | "shape" | "not-landed" };

/**
 * Dispatch-nya CERMIN `sendToPane`, tanpa cabang tambahan: multiSelect mencentang lalu menekan
 * Submit, dialog ber-kolom-bebas diketik lewat kolom itu, varian ber-`preview` lewat kolom catatan.
 *
 * Jawaban single-select dikirim sebagai TEKS berisi label opsi, bukan dengan menekan digitnya:
 * `answerChoiceDialog` membuktikan teksnya mendarat sebelum menekan `Enter`, sedangkan digit tak
 * punya titik pembatalan sama sekali — begitu byte-nya keluar, sesi sudah bergerak (spec §4.5).
 */
export async function answerSessionDialog(
  io: PaneIO, input: SessionDialogAnswer, chunkMs = DIALOG_CHUNK_MS,
): Promise<AnswerResult> {
  const text = io.capture();
  const s = answerable(text);
  if (!s) return { ok: false, reason: "stale" };
  if (screenHashOf(text) !== input.screenHash) return { ok: false, reason: "stale" };

  const optionLabel = (n: number): string | null =>
    s.rows.find((r) => r.n === n && !r.free && !r.chat)?.label ?? null;

  if (s.multi && s.submit.present) {
    if (input.choice !== undefined) return { ok: false, reason: "shape" };
    const pick = input.choices ?? [];
    if (pick.some((n) => optionLabel(n) === null)) return { ok: false, reason: "shape" };
    if (input.text && s.freeIndex === null) return { ok: false, reason: "shape" };
    const ok = await answerMultiSelectDialog(
      io, { pick, line: input.text ?? "", freeIndex: s.freeIndex }, chunkMs);
    return ok ? { ok: true } : { ok: false, reason: "not-landed" };
  }

  if (input.choices !== undefined) return { ok: false, reason: "shape" };
  const line = input.text ?? (input.choice !== undefined ? optionLabel(input.choice) : null);
  if (!line) return { ok: false, reason: "shape" };
  const ok = s.freeIndex !== null
    ? await answerChoiceDialog(io, s.freeIndex, line, chunkMs)
    : await answerNotesDialog(io, line, chunkMs);
  return ok ? { ok: true } : { ok: false, reason: "not-landed" };
}

// Satu jawaban pada satu waktu per sesi. Dua POST berbarengan menyilangkan keystroke di satu pane
// jadi sampah yang tak bisa ditarik kembali. In-memory dan sengaja begitu, cermin
// lead/deciding.ts: keadaan ini berumur satu panggilan dan tak boleh selamat dari restart.
const answering = new Set<string>();

export function beginAnswer(sessionId: string): boolean {
  if (answering.has(sessionId)) return false;
  answering.add(sessionId);
  return true;
}
export function endAnswer(sessionId: string): void { answering.delete(sessionId); }

// Seam pane: route memakai primitif tmux sungguhan, test menyuntikkan `PaneIO` palsu.
let paneIOFactory: (id: string) => PaneIO = paneIO;
export const sessionPaneIO = (id: string): PaneIO => paneIOFactory(id);

export function __setPaneIO(fn: (id: string) => PaneIO): void { paneIOFactory = fn; }
export function __resetPaneIO(): void { paneIOFactory = paneIO; }
export function __resetAnswering(): void { answering.clear(); }
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-dialog.test.ts`
Expected: PASS — 15 test. Bila `not-landed` lulus tapi `single-select` gagal, periksa urutan layar `fakeIO`: `answerChoiceDialog` memanggil `capture()` sekali sesudah mengetik prosa.

- [x] **Step 6: Jalankan test dialog yang sudah ada — pastikan rename `dialogIO` tak merusak apa pun**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/tui-dialog.test.ts`
Expected: PASS, jumlah test sama seperti sebelum perubahan.

- [x] **Step 7: Commit**

```bash
git add server/src/services/pty.ts server/src/services/session-dialog.ts server/test/session-dialog.test.ts
git commit -m "feat(dialog): service baca+jawab dialog sesi lewat PaneIO (SPEC-899)"
```

---

### Task 3: Route server — GET dialog & POST jawaban, dengan gerbang lead dan kunci in-flight

**Files:**
- Modify: `server/src/routes/terminal.ts` (import + dua route setelah `/interrupt`, sekitar baris 333)
- Create: `server/test/terminal-dialog.route.test.ts`

**Interfaces:**
- Consumes: `readSessionDialog`, `answerSessionDialog`, `sessionPaneIO`, `beginAnswer`, `endAnswer` dari `../services/session-dialog`; `isDeciding` dari `../services/lead/deciding`; `zSessionDialogAnswer` dari `@hanoman/shared`; `getSession` dari `../services/pty` (sudah diimpor).
- Produces: `GET /api/terminal/sessions/:id/dialog`, `POST /api/terminal/sessions/:id/dialog/answer`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/terminal-dialog.route.test.ts`:

```ts
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import type { PaneIO } from "../src/services/tui-dialog";
import { screenHashOf, __setPaneIO, __resetPaneIO, __resetAnswering } from "../src/services/session-dialog";
import { markDeciding, __resetDeciding } from "../src/services/lead/deciding";
import { killAll, createSession } from "../src/services/pty";
import { resetDb, makeProject } from "./factory";

// Pane tmux SUNGGUHAN dipakai hanya sebagai "sesi ini ada" — layarnya datang dari PaneIO palsu.
// Memisahkan keduanya membuat test ini menguji ROUTE (gerbang, status, bentuk respons), bukan
// kemampuan tmux merender widget Ink.
const app = buildApp({ requireAuth: false });

const SINGLE = [
  "  ←  ☐ Warna  →",
  "  Warna apa yang dipakai?",
  "",
  "❯ 1. merah",
  "  2. biru",
  "  3. Type something.",
  "",
  "  enter to select · esc to cancel",
].join("\n");

const typed: string[] = [];
let screens: string[] = [SINGLE];
let at = 0;
const fakeIO = (): PaneIO => ({
  capture: () => screens[Math.min(at, screens.length - 1)]!,
  literal: (s) => { typed.push(s); at = Math.min(at + 1, screens.length - 1); },
  enter: () => { typed.push("<enter>"); },
  down: () => { at = Math.min(at + 1, screens.length - 1); },
  sleep: async () => { },
});

let sessionId = "";

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  typed.length = 0;
  at = 0;
  screens = [SINGLE];
  __resetDeciding();
  __resetAnswering();
  __setPaneIO(fakeIO);
  sessionId = createSession("p1", "/tmp", { command: ["/bin/cat"] }).id;
});

afterEach(() => {
  __resetPaneIO();
  __resetDeciding();
  __resetAnswering();
  killAll();
});

describe("SPEC-899 · GET /terminal/sessions/:id/dialog", () => {
  it("mengembalikan dialog + screenHash saat pane menampilkan dialog pilihan", async () => {
    const r = await app.inject({ method: "GET", url: `/api/terminal/sessions/${sessionId}/dialog` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      screenHash: screenHashOf(SINGLE),
      dialog: {
        title: "Warna apa yang dipakai?", multi: false, freeIndex: 3, notes: false,
        options: [{ n: 1, label: "merah", checked: null }, { n: 2, label: "biru", checked: null }],
        tabs: [{ header: "Warna", answered: false }],
      },
    });
  });

  it("204 saat layarnya bukan dialog", async () => {
    screens = ["$ pnpm dev\n  ready in 312 ms\n"];
    const r = await app.inject({ method: "GET", url: `/api/terminal/sessions/${sessionId}/dialog` });
    expect(r.statusCode).toBe(204);
  });

  it("404 untuk sesi yang tak ada", async () => {
    const r = await app.inject({ method: "GET", url: "/api/terminal/sessions/tak-ada/dialog" });
    expect(r.statusCode).toBe(404);
  });
});

describe("SPEC-899 · POST /terminal/sessions/:id/dialog/answer", () => {
  const answer = (body: unknown, id = sessionId) =>
    app.inject({ method: "POST", url: `/api/terminal/sessions/${id}/dialog/answer`, payload: body });

  it("202 dan mengetik label opsi ke kolom bebas", async () => {
    screens = [SINGLE, SINGLE, SINGLE.replace("3. Type something.", "3. biru")];
    const r = await answer({ screenHash: screenHashOf(SINGLE), choice: 2 });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ accepted: true });
    expect(typed).toEqual(["3", "biru", "<enter>"]);
  });

  it("409 stale saat screenHash tak lagi cocok — dan pane tak disentuh", async () => {
    const r = await answer({ screenHash: "sudah-basi", choice: 1 });
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toBe("stale");
    expect(typed).toEqual([]);
  });

  it("409 deciding saat lead sedang menyusun keputusan untuk sesi ini", async () => {
    markDeciding(sessionId);
    const r = await answer({ screenHash: screenHashOf(SINGLE), choice: 1 });
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toBe("deciding");
    expect(typed).toEqual([]);
  });

  it("404 untuk sesi yang tak ada", async () => {
    const r = await answer({ screenHash: screenHashOf(SINGLE), choice: 1 }, "tak-ada");
    expect(r.statusCode).toBe(404);
  });

  it("400 untuk body tanpa bentuk jawaban", async () => {
    const r = await answer({ screenHash: screenHashOf(SINGLE) });
    expect(r.statusCode).toBe(400);
  });

  it("409 answering saat satu jawaban lain masih berjalan untuk sesi yang sama", async () => {
    // `sleep` yang menahan jawaban pertama sampai POST kedua sudah dinilai gerbangnya.
    let release = () => { };
    const held = new Promise<void>((res) => { release = res; });
    __setPaneIO(() => ({ ...fakeIO(), sleep: () => held }));
    const first = answer({ screenHash: screenHashOf(SINGLE), choice: 1 });
    await new Promise((r) => setTimeout(r, 20));
    const second = await answer({ screenHash: screenHashOf(SINGLE), choice: 2 });
    expect(second.statusCode).toBe(409);
    expect(second.json().reason).toBe("answering");
    release();
    await first;
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/terminal-dialog.route.test.ts`
Expected: FAIL — GET menjawab `404` dari handler catch-all Fastify (route belum ada).

- [x] **Step 3: Tambah import di route**

Di `server/src/routes/terminal.ts`, tambahkan ke daftar import dari `@hanoman/shared` (baris 4) simbol `zSessionDialogAnswer`, lalu tambahkan dua import baru di bawah blok import service yang sudah ada:

```ts
import {
  readSessionDialog, answerSessionDialog, sessionPaneIO, beginAnswer, endAnswer,
} from "../services/session-dialog";
import { isDeciding } from "../services/lead/deciding";
```

- [x] **Step 4: Tambah kedua route**

Di `server/src/routes/terminal.ts`, tepat setelah route `/interrupt` (yang berakhir dengan `return reply.code(202).send({ accepted: true });`), sisipkan:

```ts
  // SPEC-899 · ADR-0142 · inbox keputusan: dialog `AskUserQuestion` sebuah sesi dijawab dari panel
  // pet, bukan dengan pindah layar ke pane-nya. Membungkus tui-dialog.ts apa adanya — yang baru di
  // sini hanya tiga gerbang: sesi hidup, lead tak sedang memutuskan, dan layar yang dijawab masih
  // layar yang ditampilkan (`screenHash`). Capability datang dari peta yang sudah ada
  // (`rw("sessions")` untuk seluruh prefix /terminal), dan endpoint ini sengaja DI LUAR katalog
  // MCP: agen yang bisa memanggilnya bisa menjawab pertanyaannya sendiri.
  app.get("/terminal/sessions/:id/dialog", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSession(id);
    if (!s) return reply.code(404).send({ error: "not found" });
    if (s.exited) return reply.code(204).send();
    const found = readSessionDialog(sessionPaneIO(id));
    if (!found) return reply.code(204).send();
    return found;
  });

  // Prosa `reason` dipisah dari kodenya supaya klien bisa membedakan "muat ulang lalu tampilkan
  // lagi" dari "jangan sentuh, lead yang berhak" tanpa mem-parsing kalimat.
  const DIALOG_ANSWER_ERROR = {
    stale: "layar dialog sudah berubah — muat ulang pertanyaannya",
    shape: "bentuk jawaban tak cocok dengan dialog di layar",
    "not-landed": "jawaban tak mendarat di pane — sesi tidak digerakkan",
  } as const;

  app.post("/terminal/sessions/:id/dialog/answer", async (req, reply) => {
    const parsed = zSessionDialogAnswer.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const { id } = req.params as { id: string };
    const s = getSession(id);
    if (!s || s.exited) return reply.code(404).send({ error: "live session not found" });
    // ADR-0091 ditegakkan apa adanya: selama lead memegang sesi ini, dialah yang berhak menjawab.
    if (isDeciding(id))
      return reply.code(409).send({ error: "hanoman-lead sedang menyusun keputusan untuk sesi ini", reason: "deciding" });
    if (!beginAnswer(id))
      return reply.code(409).send({ error: "jawaban lain sedang dikirim ke sesi ini", reason: "answering" });
    try {
      const r = await answerSessionDialog(sessionPaneIO(id), parsed.data);
      if (!r.ok) return reply.code(409).send({ error: DIALOG_ANSWER_ERROR[r.reason], reason: r.reason });
      return reply.code(202).send({ accepted: true });
    } finally {
      endAnswer(id);
    }
  });
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/terminal-dialog.route.test.ts`
Expected: PASS — 9 test.

- [x] **Step 6: Typecheck server**

Run: `pnpm --filter ./server typecheck`
Expected: keluar tanpa error.

- [x] **Step 7: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal-dialog.route.test.ts
git commit -m "feat(dialog): endpoint GET dialog + POST jawaban sesi (SPEC-899)"
```

---

### Task 4: Kunci pemetaan capability & batas MCP

**Files:**
- Modify: `server/test/mcp-capability.test.ts` (tambah satu `it` di dalam describe yang sudah ada)

**Interfaces:**
- Consumes: `capabilityForRoute` dari `../src/services/agent-capabilities`; `MCP_TOOLS` dari `@hanoman/shared`.
- Produces: — (hanya test).

- [x] **Step 1: Tulis test**

Di `server/test/mcp-capability.test.ts`, di dalam `describe("kontrak capability katalog MCP", …)`, tambahkan setelah `it("tak ada tool yang bisa menjalankan sesi atau menyentuh VPS", …)`:

```ts
  // SPEC-899 · ADR-0142 · inbox keputusan. Dua sifatnya dikunci sekaligus: capability-nya
  // diturunkan dari METHOD (bukan dari prefix — kelas bug SPEC-405), dan ia TAK ADA di katalog MCP.
  // Yang terakhir bukan kelalaian: agen yang bisa menjawab `AskUserQuestion` bisa menjawab
  // pertanyaannya sendiri, dan gerbang "manusia terakhir yang memutuskan" runtuh lewat pintu itu.
  it("dialog sesi memakai capability sessions menurut method, dan tak muncul di katalog MCP", () => {
    expect(capabilityForRoute("GET", "/api/terminal/sessions/s1/dialog")).toBe("sessions:read");
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s1/dialog/answer")).toBe("sessions:write");
    for (const t of MCP_TOOLS) expect(t.samplePath, t.name).not.toMatch(/\/dialog/);
  });
```

- [x] **Step 2: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-capability.test.ts`
Expected: PASS. (Test ini lulus tanpa perubahan kode produksi — itu memang tujuannya: ia mengunci sifat yang sudah benar supaya cabang `seg[1]` berikutnya di bawah `terminal` tak diam-diam melonggarkannya.)

- [x] **Step 3: Commit**

```bash
git add server/test/mcp-capability.test.ts
git commit -m "test(dialog): kunci capability sessions + batas MCP untuk dialog sesi (SPEC-899)"
```

---

### Task 5: Klien API & daftar sesi `waiting`

**Files:**
- Modify: `src/src/api/client.ts` (dua entri baru di `api`, setelah `listTerminals`)
- Modify: `src/src/screens/pet-state.ts` (helper `waitingSessions`)
- Modify: `src/test/api-client.test.ts` (dua test baru)
- Modify: `src/test/pet-state.test.ts` (satu describe baru)

**Interfaces:**
- Consumes: `paths.terminalDialog`, `paths.terminalDialogAnswer`, tipe `SessionDialogAnswer`, `SessionDialogPayload` dari `@hanoman/shared`.
- Produces: `api.sessionDialog(id): Promise<SessionDialogPayload | null>`; `api.answerSessionDialog(id, body): Promise<{ accepted: true }>`; `waitingSessions(sessions: TerminalSession[], backlog: Spec[]): TerminalSession[]`.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/api-client.test.ts`, tambahkan di akhir berkas:

```ts
// SPEC-899 · ADR-0142 · inbox keputusan pet.
describe("api client · dialog sesi", () => {
  it("sessionDialog memetakan 204 jadi null, bukan undefined", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.sessionDialog("s1")).resolves.toBeNull();
  });

  it("sessionDialog mengembalikan payload pada 200", async () => {
    const payload = {
      screenHash: "deadbeef",
      dialog: { title: "Warna?", multi: false, freeIndex: 3, notes: false, options: [], tabs: [] },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(api.sessionDialog("s1")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalDialog("s1"), expect.anything());
  });

  it("answerSessionDialog mem-POST screenHash + pilihan ke path jawaban", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } }));
    await api.answerSessionDialog("s1", { screenHash: "deadbeef", choice: 2 });
    expect(fetchMock).toHaveBeenCalledWith(paths.terminalDialogAnswer("s1"), expect.objectContaining({
      method: "POST", body: JSON.stringify({ screenHash: "deadbeef", choice: 2 }),
    }));
  });
});
```

Di `src/test/pet-state.test.ts`, tambahkan di akhir berkas:

```ts
// SPEC-899 · daftar sesi yang benar-benar meminta jawaban manusia — dipakai panel inbox keputusan.
describe("waitingSessions", () => {
  it("hanya sesi hidup ber-marker keputusan, dan sesi yang dipegang lead tak ikut", () => {
    const backlog = [spec({ id: "SPEC-1" })];
    const rows = waitingSessions([
      session({ id: "b", specId: "SPEC-1", decision: true }),
      session({ id: "a", specId: "SPEC-1", decision: true }),
      session({ id: "c", specId: "SPEC-1", decision: true, deciding: true }),
      session({ id: "d", specId: "SPEC-1" }),
      session({ id: "e", specId: "SPEC-1", decision: true, exited: true }),
    ], backlog);
    expect(rows.map((s) => s.id)).toEqual(["a", "b"]);   // stabil menurut id, bukan urutan tmux
  });
});
```

Tambahkan `waitingSessions` ke daftar import dari `../src/screens/pet-state` di berkas itu. Bila helper `spec()`/`session()` belum ada di `pet-state.test.ts`, pakai bentuk yang sudah dipakai berkas itu untuk membangun `Spec`/`TerminalSession`.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/api-client.test.ts src/test/pet-state.test.ts`
Expected: FAIL — `api.sessionDialog is not a function` dan `waitingSessions is not exported`.

- [ ] **Step 3: Tambah entri klien API**

Di `src/src/api/client.ts`, tambahkan tipe pada blok import dari `@hanoman/shared` (`SessionDialogAnswer`, `SessionDialogPayload`) dan sisipkan tepat setelah `listTerminals: () => j<TerminalSession[]>(paths.terminalSessions),`:

```ts
  // SPEC-899 · ADR-0142 · inbox keputusan. `204` (pane tak menampilkan dialog yang bisa dijawab)
  // dinormalkan ke `null` supaya pemanggil tak perlu membedakannya dari "belum dimuat".
  sessionDialog: (id: string) =>
    j<SessionDialogPayload | undefined>(paths.terminalDialog(id)).then((p) => p ?? null),
  answerSessionDialog: (id: string, b: SessionDialogAnswer) =>
    j<{ accepted: true }>(paths.terminalDialogAnswer(id), { method: "POST", ...body(b) }),
```

- [ ] **Step 4: Tambah helper `waitingSessions`**

Di `src/src/screens/pet-state.ts`, tepat setelah fungsi `sessionKind`, sisipkan:

```ts
// SPEC-899 · sesi yang benar-benar meminta jawaban manusia. Sengaja lewat `sessionKind` yang sama
// dengan panel & rekap, bukan lewat predikat kedua (`decision && !deciding`) yang bisa berselisih
// dengannya — tabel yang disalin ke pemakai kedua adalah kelas bug SPEC-431/448.
export const waitingSessions = (sessions: TerminalSession[], backlog: Spec[]): TerminalSession[] => {
  const done = doneSpecIds(backlog);
  return byId(sessions).filter((s) => sessionKind(s, done) === "waiting");
};
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/api-client.test.ts src/test/pet-state.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/pet-state.ts src/test/api-client.test.ts src/test/pet-state.test.ts
git commit -m "feat(pet): klien API dialog sesi + daftar sesi waiting (SPEC-899)"
```

---

### Task 6: Komponen `PetAnswer` — pertanyaan, opsi, kirim, terkirim

**Files:**
- Create: `src/src/screens/PetAnswer.tsx`
- Modify: `src/src/screens/HanomanPet.tsx` (import + render di baris kondisi `waiting`)
- Modify: `src/test/hanoman-pet.test.tsx` (describe baru)

**Interfaces:**
- Consumes: `api.sessionDialog`, `api.answerSessionDialog`, `ApiError` dari `../api/client`; `Button`, `Checkbox`, `Input` dari `../ds`; `waitingSessions` dari `./pet-state`.
- Produces: `<PetAnswer sessionId={string} label={string} reduced={boolean} />`; test id `pet-answer`, `pet-answer-option`, `pet-answer-text`, `pet-answer-submit`, `pet-answer-sent`, `pet-answer-note`.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/hanoman-pet.test.tsx`, tambahkan di akhir berkas:

```ts
// SPEC-899 · ADR-0142 · inbox keputusan: pertanyaan agen dijawab dari panel, bukan dari pane.
describe("Pet · inbox keputusan", () => {
  const dialog = (over: Partial<SessionDialog> = {}): SessionDialogPayload => ({
    screenHash: "deadbeef",
    dialog: {
      title: "Warna apa yang dipakai?", multi: false, freeIndex: 3, notes: false,
      options: [{ n: 1, label: "merah", checked: null }, { n: 2, label: "biru", checked: null }],
      tabs: [], ...over,
    },
  });

  const waiting = () => [session({ id: "s1", specId: "SPEC-1", decision: true })];

  it("merender pertanyaan + opsi untuk sesi waiting, lalu mengirim nomor barisnya", async () => {
    const get = vi.spyOn(api, "sessionDialog").mockResolvedValue(dialog());
    const post = vi.spyOn(api, "answerSessionDialog").mockResolvedValue({ accepted: true });
    render(<Wrapper sessions={waiting()} />);
    fireEvent.click(hit());
    expect(await screen.findByText("Warna apa yang dipakai?")).toBeTruthy();
    expect(get).toHaveBeenCalledWith("s1");
    const options = screen.getAllByTestId("pet-answer-option");
    expect(options.map((b) => b.textContent)).toEqual(["merah", "biru"]);
    await act(async () => { fireEvent.click(options[1]!); });
    expect(post).toHaveBeenCalledWith("s1", { screenHash: "deadbeef", choice: 2 });
    expect(screen.getByTestId("pet-answer-sent").textContent).toContain("Terkirim");
  });

  it("multiSelect mengirim centang lewat choices dan satu tombol Submit", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(dialog({
      multi: true, freeIndex: null,
      options: [{ n: 1, label: "alpha", checked: false }, { n: 2, label: "beta", checked: true }],
    }));
    const post = vi.spyOn(api, "answerSessionDialog").mockResolvedValue({ accepted: true });
    render(<Wrapper sessions={waiting()} />);
    fireEvent.click(hit());
    await screen.findByTestId("pet-answer");
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);          // centang alpha; beta sudah tercentang
    await act(async () => { fireEvent.click(screen.getByTestId("pet-answer-submit")); });
    expect(post).toHaveBeenCalledWith("s1", { screenHash: "deadbeef", choices: [1, 2] });
  });

  it("409 stale memuat ulang pertanyaannya alih-alih mengaku terkirim", async () => {
    const get = vi.spyOn(api, "sessionDialog").mockResolvedValue(dialog());
    vi.spyOn(api, "answerSessionDialog").mockRejectedValue(
      new ApiError(409, "409", { reason: "stale" }));
    render(<Wrapper sessions={waiting()} />);
    fireEvent.click(hit());
    await screen.findByTestId("pet-answer");
    await act(async () => { fireEvent.click(screen.getAllByTestId("pet-answer-option")[0]!); });
    expect(screen.queryByTestId("pet-answer-sent")).toBeNull();
    expect(screen.getByTestId("pet-answer-note").textContent).toContain("berubah");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("tak ada dialog di layar → panel mengatakannya, tak ada tombol jawaban", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(null);
    render(<Wrapper sessions={waiting()} />);
    fireEvent.click(hit());
    expect(await screen.findByTestId("pet-answer-note")).toBeTruthy();
    expect(screen.queryAllByTestId("pet-answer-option")).toHaveLength(0);
  });
});
```

Catatan untuk implementer: `Wrapper` adalah pembungkus render yang sudah dipakai berkas ini (`HanomanPet` di dalam `NotificationsContext.Provider`). Bila berkas ini merender `<HanomanPet …>` langsung, pakai bentuk yang sama seperti test tetangganya alih-alih memperkenalkan `Wrapper` baru. Tambahkan import `api`, `ApiError` dari `../src/api/client` dan tipe `SessionDialog`, `SessionDialogPayload` dari `@hanoman/shared`; tambahkan `vi.restoreAllMocks()` di `beforeEach` bila berkas belum melakukannya.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/hanoman-pet.test.tsx`
Expected: FAIL — `api.sessionDialog` tak pernah dipanggil / `pet-answer` tak ditemukan.

- [ ] **Step 3: Tulis komponen**

Buat `src/src/screens/PetAnswer.tsx`:

```tsx
import React from "react";
import type { SessionDialogAnswer, SessionDialogPayload } from "@hanoman/shared";
import { api, ApiError } from "../api/client";
import { Button, Checkbox, Input } from "../ds";

// SPEC-899 · ADR-0142 · kotak jawaban satu sesi di dalam panel pet. Komponen sendiri, bukan blok di
// HanomanPet.tsx: siklus hidupnya (muat → kirim → terkirim → 409 muat ulang) tak berhubungan sama
// sekali dengan mesin berkeliaran, gelembung, dan a11y panggung yang dipegang komponen itu.
//
// Tak ada polling di sini (ADR-0039 ditegakkan): dialog diambil saat kotak ini mount — yaitu saat
// panel dibuka — dan keadaan "sudah terjawab" datang dari siaran `sessions` yang sudah ada, yang
// meng-unmount kotak ini begitu sesinya berhenti `waiting`.

const NOTE = {
  loading: "Membaca layar sesi…",
  none: "Pertanyaannya tak terbaca dari sini — buka Terminal untuk menjawabnya.",
  stale: "Layarnya sudah berubah — pertanyaannya dimuat ulang.",
  deciding: "hanoman-lead sedang menyusun keputusan untuk sesi ini.",
  failed: "Jawaban tak terkirim. Buka Terminal untuk menjawabnya.",
};

const reasonOf = (e: unknown): string | undefined =>
  e instanceof ApiError ? (e.detail as { reason?: string } | null)?.reason : undefined;

export function PetAnswer({ sessionId, label, reduced }:
  { sessionId: string; label: string; reduced: boolean }) {
  const [payload, setPayload] = React.useState<SessionDialogPayload | null | undefined>(undefined);
  const [picked, setPicked] = React.useState<number[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setPayload(undefined);
    api.sessionDialog(sessionId)
      .then((p) => {
        if (!alive) return;
        setPayload(p);
        setPicked(p ? p.dialog.options.filter((o) => o.checked).map((o) => o.n) : []);
      })
      .catch(() => { if (alive) setPayload(null); });
    return () => { alive = false; };
  }, [sessionId, reload]);

  async function send(answer: Omit<SessionDialogAnswer, "screenHash">) {
    if (!payload || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await api.answerSessionDialog(sessionId, { screenHash: payload.screenHash, ...answer });
      setSent(true);
    } catch (e) {
      const reason = reasonOf(e);
      // `stale` adalah satu-satunya kegagalan yang bisa dibereskan di tempat: layar berganti, jadi
      // pertanyaannya dimuat ulang. Sisanya butuh manusia pindah ke Terminal.
      if (reason === "stale") { setNote(NOTE.stale); setReload((n) => n + 1); }
      else if (reason === "deciding") setNote(NOTE.deciding);
      else setNote(NOTE.failed);
    } finally {
      setBusy(false);
    }
  }

  const flat = reduced ? { transition: "none", transform: "none" } : undefined;
  const box: React.CSSProperties = {
    marginTop: 8, padding: "8px 10px", background: "var(--bone-100)",
    border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
  };
  const noteLine = (text: string) => (
    <div data-testid="pet-answer-note" style={{
      fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45,
    }}>{text}</div>
  );

  if (sent) {
    return (
      <div style={box}>
        <div data-testid="pet-answer-sent" style={{
          fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--text-strong)",
        }}>Terkirim — menunggu {label} bergerak</div>
      </div>
    );
  }
  if (payload === undefined) return <div style={box}>{noteLine(NOTE.loading)}</div>;
  if (payload === null) return <div style={box}>{noteLine(NOTE.none)}</div>;

  const { dialog } = payload;
  const answered = dialog.tabs.filter((t) => t.answered).length;
  return (
    <div data-testid="pet-answer" data-session={sessionId} style={box}>
      {dialog.tabs.length > 1 && (
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>
          Pertanyaan {Math.min(answered + 1, dialog.tabs.length)} dari {dialog.tabs.length}
        </div>
      )}
      {dialog.title && (
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600,
          color: "var(--text-strong)", lineHeight: 1.4, marginBottom: 6 }}>{dialog.title}</div>
      )}
      {dialog.multi ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {dialog.options.map((o) => (
            <Checkbox key={o.n} label={o.label} checked={picked.includes(o.n)} disabled={busy}
              onChange={(on) => setPicked((v) => (on ? [...v, o.n] : v.filter((n) => n !== o.n)).sort((a, b) => a - b))} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {dialog.options.map((o) => (
            <Button key={o.n} data-testid="pet-answer-option" size="sm" variant="ghost"
              disabled={busy} style={flat}
              onClick={() => { void send({ choice: o.n }); }}>{o.label}</Button>
          ))}
        </div>
      )}
      {(dialog.freeIndex !== null || dialog.notes) && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Input data-testid="pet-answer-text" size="sm" value={text} disabled={busy}
            placeholder="Jawab dengan kalimatmu sendiri"
            style={{ flex: 1, minWidth: 0 }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)} />
          {!dialog.multi && (
            <Button size="sm" variant="ghost" disabled={busy || !text.trim()} style={flat}
              onClick={() => { void send({ text: text.trim() }); }}>Kirim</Button>
          )}
        </div>
      )}
      {dialog.multi && (
        <div style={{ marginTop: 8 }}>
          <Button data-testid="pet-answer-submit" size="sm" variant="primary" disabled={busy} style={flat}
            onClick={() => { void send({ choices: picked, ...(text.trim() ? { text: text.trim() } : {}) }); }}>
            Submit
          </Button>
        </div>
      )}
      {note && <div style={{ marginTop: 6 }}>{noteLine(note)}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Pasang di panel pet**

Di `src/src/screens/HanomanPet.tsx`:

1. Tambahkan `waitingSessions` ke daftar import dari `./pet-state`, dan `import { PetAnswer } from "./PetAnswer";` di bawah import `pet-walk`.
2. Di dalam komponen, setelah `const view = React.useMemo(…)`, tambahkan:

```tsx
  // SPEC-899 · satu kotak jawaban per sesi `waiting`. Daftarnya memakai klasifikasi yang sama
  // dengan panel (`sessionKind`), jadi sesi yang sedang dipegang lead memang tak muncul di sini.
  const waiting = React.useMemo(() => waitingSessions(sessions, backlog), [sessions, backlog]);
```

3. Di dalam `view.conditions.map(...)`, tepat setelah blok `{c.target && ( … )}`, sisipkan:

```tsx
                {c.kind === "waiting" && open && waiting.map((s) => (
                  <PetAnswer key={s.id} sessionId={s.id} label={s.specId ?? s.id} reduced={reduced} />
                ))}
```

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/hanoman-pet.test.tsx`
Expected: PASS — termasuk seluruh test Pet yang sudah ada (SPEC-585/896/897/898) tanpa satu pun regresi.

- [ ] **Step 6: Typecheck frontend**

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa error.

- [ ] **Step 7: Commit**

```bash
git add src/src/screens/PetAnswer.tsx src/src/screens/HanomanPet.tsx src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): panel menjawab dialog sesi waiting (SPEC-899)"
```

---

### Task 7: Gelembung "Jawab di sini"

**Files:**
- Modify: `src/src/screens/HanomanPet.tsx` (blok `pet-bubble`, sekitar baris 424-447)
- Modify: `src/test/hanoman-pet.test.tsx` (dua test baru)

**Interfaces:**
- Consumes: `view.kind`, `speech`, `showPanel()`, `setSpeech()` yang sudah ada di komponen.
- Produces: tombol ber-teks "Jawab di sini" di dalam `pet-bubble` untuk kondisi `waiting`.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/hanoman-pet.test.tsx`, tambahkan di dalam `describe("Pet · inbox keputusan", …)`:

```ts
  it("gelembung waiting menawarkan 'Jawab di sini' dan membuka panel", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(dialog());
    render(<Wrapper sessions={waiting()} />);
    const cta = await screen.findByRole("button", { name: /jawab di sini/i });
    expect(screen.getByTestId("pet-bubble").getAttribute("aria-hidden")).toBeNull();
    await act(async () => { fireEvent.click(cta); });
    expect(await screen.findByTestId("pet-answer")).toBeTruthy();
  });

  it("teks gelembung tetap aria-hidden — region status pet-stage yang membacakannya", async () => {
    vi.spyOn(api, "sessionDialog").mockResolvedValue(dialog());
    render(<Wrapper sessions={waiting()} />);
    const bubble = await screen.findByTestId("pet-bubble");
    expect(within(bubble).getByTestId("pet-bubble-text").getAttribute("aria-hidden")).toBe("true");
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/hanoman-pet.test.tsx -t "Jawab di sini"`
Expected: FAIL — tombol tak ditemukan.

- [ ] **Step 3: Ubah blok gelembung**

Di `src/src/screens/HanomanPet.tsx`, ganti seluruh blok `{speech && !open && ( … )}` menjadi:

```tsx
        {speech && !open && (
          // SPEC-899 · gelembung `waiting` menumbuhkan satu aksi, dan elemen di dalam `aria-hidden`
          // tak bisa difokuskan sama sekali — jadi bungkusnya berhenti `aria-hidden` begitu ia
          // punya tombol, sementara TEKS-nya tetap disembunyikan supaya region `role="status"` di
          // pet-stage tetap satu-satunya yang membacakan kabar (keputusan SPEC-898 #3 ditegakkan).
          <div data-testid="pet-bubble" data-kind={speech.kind}
            aria-hidden={speech.kind === "pose" && view.kind !== "waiting" ? "true" : undefined} style={{
            pointerEvents: "none", position: "absolute", left: bubbleLeft, bottom: cellH - 6,
            width: "max-content", maxWidth: BUBBLE_W, boxSizing: "border-box", padding: "6px 10px",
            fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.35,
            color: "var(--text-strong)", background: "var(--surface-card)",
            border: "1px solid var(--border-hair)", borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-sm)",
            animation: reduced ? "none" : "hn-pet-bubble-in var(--dur-base) var(--ease-out) both",
          }}>
            <span data-testid="pet-bubble-text"
              aria-hidden={speech.kind === "pose" ? "true" : undefined}>{speech.text}</span>
            {(speech.kind === "recap" || view.kind === "waiting") && (
              // Satu-satunya hit area tambahan di jalur pet, dan ia transient: kelas yang sama
              // dengan panel, bukan pelebaran badan pet (SPEC-763).
              <div style={{ marginTop: 6, pointerEvents: "auto" }}>
                <Button size="sm" variant="ghost"
                  leftIcon={speech.kind === "recap" ? "list-checks" : "terminal"}
                  aria-label={speech.kind === "recap"
                    ? `${speech.text} — buka ringkasan pet`
                    : `${speech.text} — jawab di sini`}
                  style={reduced ? { transition: "none", transform: "none" } : undefined}
                  onClick={() => { setSpeech(null); showPanel(); }}>
                  {speech.kind === "recap" ? "Lihat" : "Jawab di sini"}
                </Button>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/hanoman-pet.test.tsx`
Expected: PASS — seluruh berkas, termasuk test gelembung SPEC-898 yang sudah ada.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/HanomanPet.tsx src/test/hanoman-pet.test.tsx
git commit -m "feat(pet): gelembung waiting menawarkan 'Jawab di sini' (SPEC-899)"
```

---

### Task 8: Docs — ADR-0142 + Source of Truth yang tersentuh

**Files:**
- Create: `internal/docs/adr/0142-inbox-keputusan-dialog-sesi.md`
- Modify: `internal/docs/README.md` (satu baris ADR baru di atas baris 0141; segarkan baris `frontend-implementation`)
- Modify: `internal/docs/adr/README.md` (narasi ADR baru)
- Modify: `internal/docs/architecture/api-contract.md` (dua endpoint, di seksi terminal)
- Modify: `internal/docs/frontend/frontend-implementation.md` (seksi Pet)
- Modify: `docs/agent-integration.md` (baris domain `sessions` + catatan di luar MCP)

**Interfaces:**
- Consumes: kontrak yang sudah dikunci Task 1–4.
- Produces: — (dokumen).

- [ ] **Step 1: Tulis ADR-0142**

Buat `internal/docs/adr/0142-inbox-keputusan-dialog-sesi.md` mengikuti bentuk ADR tetangganya (`0141-onset-menunggu-di-marker-keputusan.md`). Isi wajib:

- **Status**: Diterima, 2026-08-22, SPEC-899.
- **Konteks**: `tui-dialog.ts` sudah memiliki seluruh mekanismenya (parse + jawab + jebakan terukur SPEC-452/474/485), tetapi hanya `hanoman-lead` yang memakainya. Panel pet menunjuk sesi `waiting` dan hanya bisa menawarkan "Buka Terminal".
- **Keputusan**: (1) dua endpoint di bawah `/api/terminal/sessions/:id/`; (2) `screenHash = sha256(dialogKey(paneText)).slice(0,16)` sebagai gerbang kesegaran, beserta alasan kenapa BUKAN hash teks pane mentah dan kenapa `dialogKey` (dua gotcha SPEC-474 & ADR-0102 #1); (3) dispatch = cermin `sendToPane`, tanpa cabang baru; (4) layar tanpa kolom bebas & tanpa catatan (trust, prompt izin) dan layar rekap **tak pernah** dilaporkan bisa dijawab; (5) gerbang `deciding` + kunci in-flight; (6) capability dari peta yang sudah ada (`sessions:read`/`sessions:write`) dan **di luar katalog MCP**.
- **Konsekuensi**: jawaban single-select tiba di agen sebagai teks kolom bebas berisi label opsi, bukan sebagai "opsi ke-n dipilih"; dua pertanyaan berjudul sama dalam satu rantai punya hash yang sama.
- **Alternatif yang ditolak**: menekan digit opsi (tak punya titik pembatalan); memperluas `POST /steer` (tak punya kontrak layar); menaruhnya di katalog MCP (agen bisa menjawab pertanyaannya sendiri, ADR-0099/0112 diperluas).
- **Hubungan ADR lain**: menegakkan 0039, 0037, 0065, 0091, 0099, 0102; tak mencabut apa pun.

- [ ] **Step 2: Tautkan di index**

Di `internal/docs/README.md`, tepat di atas baris `- [0141 — …]`, tambahkan:

```markdown
- [0142 — Inbox keputusan: dialog sesi dibaca & dijawab lewat HTTP bergerbang `screenHash`, di luar katalog MCP](adr/0142-inbox-keputusan-dialog-sesi.md) — menegakkan 0039, 0037, 0065, 0091, 0099 & 0102 (SPEC-899)
```

Perbarui juga baris `frontend-implementation` (baris ~245) supaya menyebut program Pet hidup D: tambahkan `… lalu MENJAWAB pertanyaan agen langsung dari panel (Pet hidup D SPEC-899 ADR-0142)` di ujung deskripsinya.

Tambahkan narasi ADR-0142 ke `internal/docs/adr/README.md` mengikuti bentuk entri 0141 di berkas itu.

- [ ] **Step 3: Perbarui kontrak API**

Di `internal/docs/architecture/api-contract.md`, di seksi endpoint terminal (cari `terminal/sessions/:id/steer`), tambahkan dua endpoint beserta tabel status lengkap dari spec §5.2/§5.3, termasuk `reason` pada 409 dan catatan bahwa capability-nya `sessions:read`/`sessions:write` tanpa perubahan peta.

- [ ] **Step 4: Perbarui naskah agent**

Di `docs/agent-integration.md`, pada baris domain `sessions` (baris ~103) tambahkan bahwa domain itu kini juga mencakup membaca & menjawab dialog sesi, dan tambahkan satu catatan di seksi yang mendaftar apa yang **tak** ada di MCP (dekat baris ~464, yang sudah menyebut `POST /api/terminal/sessions`) bahwa `POST /api/terminal/sessions/:id/dialog/answer` sengaja di luar katalog MCP.

- [ ] **Step 5: Perbarui frontend-implementation**

Di `internal/docs/frontend/frontend-implementation.md`, seksi Pet, tambahkan sub-bagian **Inbox keputusan (SPEC-899)**: `PetAnswer.tsx` per sesi `waiting`, sumber daftarnya `waitingSessions` (klasifikasi `sessionKind` yang sama), tak ada polling, gelembung `waiting` ber-CTA "Jawab di sini", dan aturan a11y-nya (bungkus gelembung berhenti `aria-hidden` saat ia punya aksi; teksnya tetap `aria-hidden` supaya region `role="status"` tetap satu-satunya yang membacakan).

- [ ] **Step 6: Verifikasi integritas index**

Run: `node cli/dist/index.js docs index --check` — atau, bila `cli/dist` belum terbangun di worktree ini, `pnpm --filter ./cli build && node cli/dist/index.js docs index --check`.
Expected: index utuh (nol dokumen tak tertaut yang baru).

- [ ] **Step 7: Commit**

```bash
git add internal/docs docs/agent-integration.md
git commit -m "docs(dialog): ADR-0142 inbox keputusan + api-contract, agent-integration, pet (SPEC-899)"
```

---

### Task 9: Uji nyata endpoint & verifikasi akhir

**Files:**
- Modify: `docs/superpowers/plans/2026-08-22-spec-899-pet-inbox-keputusan.md` (catat hasil smoke di bawah task ini)

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: bukti terukur bahwa endpoint bekerja terhadap pane tmux sungguhan.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  shared/src/session-dialog.test.ts \
  server/test/session-dialog.test.ts \
  server/test/terminal-dialog.route.test.ts \
  server/test/mcp-capability.test.ts \
  server/test/tui-dialog.test.ts \
  src/test/api-client.test.ts \
  src/test/pet-state.test.ts \
  src/test/hanoman-pet.test.tsx
```

Expected: seluruhnya PASS. **Jangan** menerima "no test files" sebagai bukti — pastikan jumlah test yang berjalan masuk akal.

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: ketiganya keluar tanpa error. (Tiga paket, bukan `-r`: perubahan ini memang menyentuh ketiganya lewat tipe shared.)

- [ ] **Step 3: Boot server dengan DB & HOME khusus**

```bash
export SMOKE_HOME="$(mktemp -d)"
HANOMAN_HOME="$SMOKE_HOME" DATABASE_URL="file:$SMOKE_HOME/smoke.db" \
  HANOMAN_TMUX_SOCKET="hanoman-smoke-899" NODE_ENV=test PORT=4899 \
  pnpm --filter ./server exec tsx src/server.ts > "$SMOKE_HOME/server.log" 2>&1 &
```

`HANOMAN_HOME` & `DATABASE_URL` wajib: tanpa keduanya smoke menulis ke `~/.hanoman` milik operator. `HANOMAN_TMUX_SOCKET` khusus menjaga pane uji tak bercampur dengan sesi tetangga di mesin ini.
Expected: `curl -s localhost:4899/api/health` menjawab.

- [ ] **Step 4: Buat pane tmux yang MENAMPILKAN dialog tiruan**

Bukan `POST /terminal/sessions` — itu melahirkan agen sungguhan. Buat pane lewat tmux langsung dengan nama ber-prefix `hanoman-` dan opsi yang dibaca `parsePanes`:

```bash
cat > "$SMOKE_HOME/dialog.txt" <<'EOF'
  ←  ☐ Warna  →
  Warna apa yang dipakai?

❯ 1. merah
  2. biru
  3. Type something.

  enter to select · esc to cancel
EOF
tmux -L hanoman-smoke-899 new-session -d -s hanoman-smoke1 \
  "cat '$SMOKE_HOME/dialog.txt'; sleep 600"
tmux -L hanoman-smoke-899 set-option -t hanoman-smoke1 @hanoman_project p1
tmux -L hanoman-smoke-899 set-option -t hanoman-smoke1 @hanoman_cwd /tmp
```

Expected: `tmux -L hanoman-smoke-899 capture-pane -p -t hanoman-smoke1` menampilkan dialognya.

- [ ] **Step 5: `curl` GET lalu POST**

```bash
curl -s localhost:4899/api/terminal/sessions/smoke1/dialog | tee "$SMOKE_HOME/get.json"
HASH=$(node -e "process.stdout.write(require('$SMOKE_HOME/get.json').screenHash)")
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' \
  -d "{\"screenHash\":\"basi\",\"choice\":1}" \
  localhost:4899/api/terminal/sessions/smoke1/dialog/answer
curl -s -X POST -H 'content-type: application/json' \
  -d "{\"screenHash\":\"$HASH\",\"choice\":2}" \
  localhost:4899/api/terminal/sessions/smoke1/dialog/answer
```

Expected: GET → `200` dengan `dialog.options` = merah/biru dan `dialog.freeIndex` = 3. POST ber-hash basi → `409` `reason: "stale"`. POST ber-hash benar → `409` `reason: "not-landed"` — **itu hasil yang BENAR** terhadap `cat`: layarnya statis, jadi `freeTextFilled` tak pernah benar dan `Enter` sengaja tak ditekan (fail-closed SPEC-452). Jalur sukses dikunci test ber-`PaneIO` palsu di Task 2 & 3.

- [ ] **Step 6: Bereskan proses uji per-PID**

```bash
tmux -L hanoman-smoke-899 kill-server
lsof -ti:4899 | xargs -r kill
rm -rf "$SMOKE_HOME"
```

**Jangan** `pkill -f`/`killall` — pola seperti itu mematikan agen sesi tetangga di mesin ini (SPEC-402).

- [ ] **Step 7: Catat hasilnya di plan ini & commit**

Tulis hasil terukur Step 5 (kode status + potongan payload) sebagai blok di bawah task ini, lalu:

```bash
git add docs/superpowers/plans/2026-08-22-spec-899-pet-inbox-keputusan.md
git commit -m "docs(dialog): hasil smoke endpoint dialog sesi (SPEC-899)"
```

---

## Self-review — cakupan spec

| Bagian spec | Task |
| --- | --- |
| §5.1 capability tanpa perubahan peta | 4 |
| §5.2 `GET …/dialog` + DTO | 1, 2, 3 |
| §5.3 `POST …/dialog/answer` + tabel status | 1, 2, 3 |
| §5.4 modul `session-dialog.ts` + seam `PaneIO` | 2 |
| §4.2 `screenHash` dari `dialogKey` | 2 |
| §4.4 layar trust/izin & rekap `204` | 2 |
| §6.1 klien API | 5 |
| §6.2 panel per sesi `waiting` | 5, 6 |
| §6.3 gelembung "Jawab di sini" + a11y | 7 |
| §7 test | 1–7 (uji nyata: 9) |
| §9 docs | 8 |
