# Fase Review Resmi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jadikan `Review` fase pipeline resmi sesudah `Execute` di flow `feature` & `qa`, di semua mode sesi.

**Architecture:** `Review` masuk `FLOW_PHASES`; reviewer independen ADR-0170 berubah dari "lampiran Execute"
(`PhasePlan.reviewer`, langkah R) menjadi agen fase `Review` biasa di `PhasePlan.phases` dengan default
`REVIEWER_DEFAULTS`. Server memetakan `Execute → executing`, `Review → done`, dan menolak `Review skipped`
sebagai tercapai (konstanta bersama `UNSKIPPABLE_PHASES`).

**Tech Stack:** TypeScript strict, vitest, pnpm workspace (`shared`, `runner`, `server`, `src`).

Spec: [`docs/superpowers/specs/2026-10-25-fase-review-resmi-design.md`](../specs/2026-10-25-fase-review-resmi-design.md)

## Global Constraints

- Tanpa migration skema Prisma; `Spec.stage` hanya maju (ADR-0008).
- Nama agen tetap `hanoman-fase-review` (= `phaseAgentName("Review")`); sel Setting tetap `orchestration.<flow>.<runtime>.Review`.
- Review default TIDAK mewarisi orchestrator: `REVIEWER_DEFAULTS` (claude `opus`·`high`, codex `gpt-5.6-sol`·`high`, antigravity `inherit`·`null`).
- `Review skipped` tak pernah dihitung tercapai/lengkap.
- Flow selain feature/qa tak berubah perilakunya.
- Test: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run <path…> --no-file-parallelism`
  (lepas env `HANOMAN_*` bila dijalankan dari dalam sesi hanoman — lihat memori `test-server-env-sesi-hanoman`).
- Kode gaya sekitar: komentar Indonesia berlabel `ADR-0230 ·`.

---

### Task 1: shared — fase Review di data orkestrasi

**Files:**
- Modify: `shared/src/orchestration.ts` (FLOW_PHASES, konstanta reviewer, tipe `PhasePlan`)
- Modify: `shared/src/orchestration-plan.ts:70-90` (`resolvePhasePlan`)
- Modify: `shared/src/runtime-defaults.ts` (sel `Review` feature/qa, versi)
- Modify: `shared/src/method-catalog.ts` (`phaseSkills.Review` tiap metode)
- Test: `shared/src/orchestration.test.ts`, `shared/src/method-catalog.test.ts`, test runtime-defaults shared/server yang ada

**Interfaces:**
- Produces: `FLOW_PHASES.feature/qa` berakhiran `"Review"`; `export const UNSKIPPABLE_PHASES: ReadonlySet<string>` (= `{"Review"}`);
  `REVIEWER_CELL` tetap `"Review"`; `REVIEWER_FLOWS` diturunkan = flow yang `FLOW_PHASES`-nya memuat `REVIEWER_CELL`;
  `PhasePlan.reviewer` dan tipe `PhaseReviewerEntry` **dihapus**.

- [x] **Step 1: Tulis test gagal** di `orchestration.test.ts` — ganti asersi `.reviewer` (baris ~161-255) menjadi
  asersi entri fase:

```ts
const review = (p: PhasePlan | null) => p!.phases.find((e) => e.phase === "Review");
expect(FLOW_PHASES.feature.at(-1)).toBe("Review");
expect(FLOW_PHASES.qa.at(-1)).toBe("Review");
expect(review(resolvePhasePlan({ ...base, flow: "feature" }))).toMatchObject(
  { agentName: "hanoman-fase-review", model: "opus", effort: "high" });
// codex: gpt-5.6-sol·high walau orchestrator terra·low; override phaseOverrides.Review & sel Setting Review tetap menang;
// flow lain (goal/audit/…) tak punya entri Review; antigravity → { model: "inherit", effort: null }.
expect(UNSKIPPABLE_PHASES.has("Review")).toBe(true);
```

- [x] **Step 2: Jalankan, pastikan gagal.** `pnpm vitest --run shared/src/orchestration.test.ts`
- [x] **Step 3: Implementasi.**
  - `FLOW_PHASES.feature = [..., "Execute", "Review"]`, `qa = [..., "Execute", "Review"]`, komentar ADR-0230.
  - Ganti komentar blok "BUKAN fase pipeline" menjadi penjelasan ADR-0230; tambah `UNSKIPPABLE_PHASES`.
  - `resolvePhasePlan`: hapus blok `reviewer`; di `phases.map` pakai
    `resolve(phase, phase === REVIEWER_CELL ? REVIEWER_DEFAULTS[input.runtime] : input.orchestrator)`.
  - `runtime-defaults.ts`: tambah `Review` ke sel feature & qa (claude `cell("opus","high")`, codex
    `cell("gpt-5.6-sol","high")`, antigravity sesuai bentuk `flow(...)` yang ada / `inherit`), naikkan
    `RUNTIME_DEFAULTS_VERSION` ke `"2026-10-25-v1"`. **Baca dulu** `server/src/services/runtime-defaults.ts:120-230`:
    pastikan upgrade versi TIDAK menimpa sel `Review` yang sudah diisi operator (sel lama tanpa marker). Bila
    seeding menimpanya, perlakukan sel yang sudah ada tanpa marker sebagai `user`, dan tambahkan test untuk itu.
  - `method-catalog.ts`: tiap metode yang punya `Execute` di `phaseSkills` mendapat `Review`. superpowers:
    `["superpowers:requesting-code-review", VERIFICATION_GATE]`; metode lain: skill review milik metode itu bila
    ada di katalognya, kalau tidak `[VERIFICATION_GATE]`. Catatan: `exitSkills` kini menempel ke fase TERAKHIR = Review
    (`phaseSkillsFor`), itu disengaja.
- [x] **Step 4: Jalankan test shared + runtime-defaults server**, perbaiki sampai hijau.
  `pnpm vitest --run shared/src server/test/runtime-defaults* --no-file-parallelism`
- [x] **Step 5: Commit** `feat(orchestration): Review jadi fase pipeline feature & qa (shared)`

### Task 2: server & gate — peta stage, gerbang selesai, continue

**Files:**
- Modify: `server/src/services/session-phases.ts` (`REACHED`, `stageFor`, `phasesComplete`)
- Modify: `server/src/services/session-launch.ts:265-272, 304-306` (filter fase continue)
- Modify: `runner/src/codex-settings.ts:72-85`, `runner/src/goal.ts:~47` (gate grep Review tanpa `skipped`)
- Test: test `session-phases` di `server/test/` (cari `stageFor`/`phasesComplete`), test codex-settings & goal di `runner/test/`

**Interfaces:**
- Consumes: `UNSKIPPABLE_PHASES`, `FLOW_PHASES` dari Task 1.

- [x] **Step 1: Tulis test gagal:**

```ts
const P = (rows: [string, PhaseState][]) => rows.map(([name, state]) => ({ name, state }));
const pre = [["Brainstorm","done"],["Objective","done"],["Spec","done"],["Plan","done"]] as const;
expect(stageFor(P([...pre, ["Execute","done"], ["Review","active"]]))).toBe("executing");
expect(stageFor(P([...pre, ["Execute","done"], ["Review","done"]]))).toBe("done");
expect(stageFor(P([...pre, ["Execute","done"], ["Review","skipped"]]))).toBe("executing");
expect(phasesComplete(P([...pre, ["Execute","done"], ["Review","skipped"]]))).toBe(false);
expect(phasesComplete(P([...pre, ["Execute","done"], ["Review","done"]]))).toBe(true);
// goal/no_effort/audit stageFor tak berubah (test lama tetap hijau).
// enrichPhases: invocation { phase:"Review", agentName:"hanoman-fase-review" } → agent chip Review;
// invocation lama { phase:"Execute", agentName:"hanoman-fase-review" } tak menaikkan attempts Execute.
```

  Gate codex: `codexGoalScript({ flow: "feature", … })` memuat `^Review done[[:space:]]*$` (tanpa `skipped`) dan
  `^Execute (done|skipped)…`. Cermin yang sama di `goal.ts` bila ia menyusun daftar fase sendiri.
- [x] **Step 2: Jalankan, pastikan gagal.**
- [x] **Step 3: Implementasi.**
  - `REACHED`: `Execute: "executing"`, `Review: "done"` (komentar ADR-0230 di sebelah `Execute`).
  - `stageFor`: `if (p.state === "skipped" && UNSKIPPABLE_PHASES.has(p.name)) continue;` sebelum lookup REACHED.
  - `phasesComplete`: `p.state === "done" || (p.state === "skipped" && !UNSKIPPABLE_PHASES.has(p.name))`.
  - `session-launch.ts`: continue menyaring `["Execute", REVIEWER_CELL].includes(p.phase)`; perbarui komentar
    SPEC-172 ("continue melanjutkan Execute lalu Review"). `rerunPhases` ikut otomatis.
  - `codex-settings.ts`/`goal.ts`: pola grep per fase `UNSKIPPABLE_PHASES.has(p) ? "done" : "(done|skipped)"`.
- [x] **Step 4: Jalankan test tersentuh** (server serial + DB terisolasi), hijau.
- [x] **Step 5: Commit** `feat(phases): Review menutup stage done; Review tak boleh skipped`

### Task 3: runner — prompt orchestrator, agen fase, sesi tunggal, continue

**Files:**
- Modify: `runner/src/prompt.ts` (`phaseInstruction` ~86-100, `orchestratorClause` ~225-300, `continuePrompt` ~605-645)
- Modify: `runner/src/phase-agents.ts` (`phaseAgentInstructions` ~250, `buildPhaseAgents` ~280-318, `reviewerInstructions` ~338)
- Test: `runner/test/orchestrator-prompt.test.ts`, `runner/test/prompt.test.ts`, test phase-agents di `runner/test/`, golden `runner/test/prompt-golden.test.ts`

**Interfaces:**
- Consumes: `PhasePlan.phases` memuat entri `Review` (Task 1); tak ada lagi `plan.reviewer`.

- [x] **Step 1: Tulis/ubah test gagal:**
  - `buildPhaseAgents(planFeature)` → tepat satu def `name: "hanoman-fase-review"` dengan `phase: "Review"`
    dan instruksi `reviewerInstructions` (memuat `Verdict: lulus | rework`); tak ada def ber-`phase: "Execute"` selain execute.
  - Prompt orchestrator feature: memuat `Review → \`hanoman-fase-review\``, memuat `Review done` hanya sesudah
    `Verdict: lulus`, rework melanjutkan agen Execute yang SAMA, maks 2 putaran; TIDAK memuat `langkah R`,
    `Reviewer Execute`, maupun `SEBELUM menulis \`Execute done\``.
  - Prompt sesi tunggal feature/qa: daftar fase berakhir `Execute → Review`, memuat klausa review mandiri
    (tabel `AC → putusan → bukti`, `Verdict:`, maks 2 putaran, `Review` tak boleh `skipped`). Prompt goal/audit tanpa klausa itu.
  - `continuePrompt` (plan & tanpa plan): fase yang dilanjutkan Execute lalu Review; baris `Execute done` DAN
    `Review done` lama dinyatakan tak berlaku.
- [x] **Step 2: Jalankan, pastikan gagal.**
- [x] **Step 3: Implementasi.**
  - `phaseInstruction`: bila `phases.includes(REVIEWER_CELL)` tempelkan konstanta baru `SELF_REVIEW_CLAUSE`
    (review mandiri atas spec & plan vs diff `$HANOMAN_BASE_SHA...HEAD` + test sesuai scope; tabel AC → putusan → bukti;
    `Verdict: lulus | rework`; `rework` → perbaiki lalu review ulang, maks 2 putaran, sisanya keputusan terbuka;
    `Review done` hanya sesudah `lulus`; `Review` TIDAK PERNAH `skipped`).
  - `orchestratorClause`: hapus variabel `reviewer`, baris "Reviewer Execute … langkah R", dan `reviewStep`.
    Ganti dengan `reviewStep` baru bila `plan.phases.some(p => p.phase === REVIEWER_CELL)`:
    "R. Fase Review: panggil agen fasenya seperti langkah 1 dengan baris tambahan `Laporan Execute: <tabel AC → bukti>`
    dan `Putaran rework: <r>/2`. `Verdict: lulus` → langkah 2 (`Review done`). `Verdict: rework` → lanjutkan agen
    Execute yang SAMA lewat ${resume} dengan `Temuan wajib diperbaiki:` apa adanya, lalu agen Review yang SAMA dengan
    laporan barunya; …(sisa kalimat batas putaran/galat dari teks lama)… JANGAN memperbaiki sendiri, JANGAN menulis
    `Review done` tanpa `Verdict: lulus`, dan Review tak pernah `skipped`." Langkah 2: ganti sufiks
    "Khusus Execute: langkah R dulu…" dengan "Khusus Review: marker hanya sesudah `Verdict: lulus` (langkah R)."
    `artefactRule`: tambahkan "untuk Review: dokumen spec & berkas plan yang sama".
  - `phase-agents.ts`: `buildPhaseAgents` memetakan entri `phase === REVIEWER_CELL` ke def dengan
    `instructions: reviewerInstructions(plan, ctx)` dan deskripsi reviewer lama; hapus blok append `plan.reviewer`.
    `skipSkillFinalReview`: ganti `!!plan.reviewer` → `plan.phases.some((p) => p.phase === REVIEWER_CELL)`; teksnya
    "…reviewer fase Review `hanoman-fase-review`…". `reviewerInstructions`: kalimat pembuka "Kamu agen fase Review
    (reviewer independen hasil fase Execute)…", "dipanggil sesudah fase Execute ditutup". Periksa pemakai
    `REVIEWER_AGENT_NAME` (baris ~35) masih benar.
  - `continuePrompt`: teks plan → "Lanjutkan HANYA fase Execute lalu Review lewat subagent fasenya"; klausa S3 menyebut
    baris `Execute done` dan `Review done` lama; tulis baris baru masing-masing sesudah sesi INI menyelesaikannya.
    Tanpa plan: "Lanjut di fase Execute … lalu fase Review" + `SELF_REVIEW_CLAUSE`, dan
    `skillInstruction(flow, ["Execute", REVIEWER_CELL], m)`.
- [x] **Step 4: Perbarui golden** `pnpm vitest --run runner/test/prompt-golden.test.ts -u`, lalu **baca diff** `runner/test/__golden__/`:
  yang boleh berubah hanya start-feature, start-qa-matt, continue-feature, resume-qa (dan hanya di bagian fase/review).
- [x] **Step 5: Jalankan test runner tersentuh**, hijau. `pnpm vitest --run runner/test`
- [x] **Step 6: Commit** `feat(prompt): fase Review di orchestrator & sesi tunggal, langkah R pindah ke fase Review`

### Task 4: docs — ADR-0230 & Source of Truth

**Files:**
- Create: `internal/docs/adr/0230-fase-review-resmi.md`
- Modify: `internal/docs/adr/0170-…md` (catatan amandemen di keputusan #4), `internal/docs/adr/README.md`, `internal/docs/README.md`
- Modify (bila menyebut reviewer-bukan-fase/langkah R): `internal/docs/adr/0164-…md` (catatan saja), `0173-…md`,
  `internal/docs/architecture/antigravity-runtime.md`, `internal/docs/architecture/data-model.md`, `internal/skills/hanoman/SKILL.md`

- [x] **Step 1:** Tulis ADR-0230 (format ADR repo: Status/Tanggal/SPEC/Terkait, Konteks, Keputusan = isi spec §1-§4, Konsekuensi:
  sesi lama di-continue menjalankan Review; stage `done` kini butuh `Review done`; satu baris marker lagi; review di sesi tunggal
  murni lewat prompt; `Verdict:` tetap belum ditegakkan server).
- [x] **Step 2:** Amandemen ADR-0170 #4: tambahkan `[Diamandemen ADR-0230: Review kini fase pipeline]` seperti pola #2. Tautkan ADR-0230 di kedua README.
- [x] **Step 3:** `grep -rn "langkah R\|bukan fase\|Reviewer Execute\|phase = Execute" internal/docs internal/skills` → perbarui sisa yang kini salah.
- [x] **Step 4: Commit** `docs(adr): ADR-0230 fase Review resmi`

### Task 5: Verifikasi akhir

- [ ] **Step 1:** Typecheck paket tersentuh: `pnpm --filter @hanoman/shared --filter @hanoman/runner --filter @hanoman/server --filter ./src exec tsc --noEmit` (sesuaikan nama filter dengan `package.json` tiap paket).
- [ ] **Step 2:** `pnpm vitest --run --changed main --no-file-parallelism` dengan `TEST_DATABASE_URL` terisolasi → hijau.
- [ ] **Step 3:** Boot server lokal dari worktree (`HANOMAN_HOME` sementara) dan curl endpoint pratinjau rencana fase (route
  yang dipakai `PhasePlanPreview`, cari di `src/src/api/client.ts`) untuk flow `feature`: respons memuat fase `Review` dengan
  model reviewer. `hanoman_session_phases` (MCP) tak butuh perubahan — pastikan respons fase memuat Review.
- [ ] **Step 4:** Centang semua kotak plan ini, commit.
