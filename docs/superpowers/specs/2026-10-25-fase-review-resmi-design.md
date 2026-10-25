# Fase Review resmi untuk flow feature & qa — Design

- Tanggal: 2026-10-25
- Status: disetujui operator (brainstorming 2026-10-25)
- Mengamandemen: ADR-0170 keputusan #4 ("reviewer BUKAN fase pipeline")
- ADR baru: ADR-0230 (ditulis bersama implementasi)

## Masalah

Reviewer independen `hanoman-fase-review` (ADR-0170 #4) hidup *di dalam* fase Execute: orchestrator
memanggilnya di "langkah R" sebelum menulis `Execute done`, dan invocation-nya tercatat `phase = Execute`.
Akibatnya:

- review tak punya chip, status, durasi, maupun token sendiri — ia tak terlihat di PhaseStrip;
- putaran rework tampak sebagai Execute yang berjalan lama, bukan Execute ⇄ Review;
- sesi tunggal (tanpa orkestrasi subagent) tak menjalankan review sama sekali.

## Keputusan

Review menjadi **fase pipeline sungguhan** di flow `feature` dan `qa`, di **semua** mode sesi.

### 1. Data & stage

- `FLOW_PHASES.feature = ["Brainstorm", "Objective", "Spec", "Plan", "Execute", "Review"]`,
  `FLOW_PHASES.qa = ["Audit", "Spec", "Plan", "Execute", "Review"]`. Flow lain tak berubah.
- Peta `REACHED` (`server/src/services/session-phases.ts`): `Execute → executing`, `Review → done`.
  `Review` aktif tetap `executing`; `Review` tak masuk `WORK_PHASES` (ia tak menulis kode).
- Gerbang selesai (`sessionComplete*`, `stageForRun*`) mewajibkan `Review done` pada flow feature/qa;
  `Review skipped` **tidak** dihitung tercapai untuk gerbang ini (review tak boleh dilewati).
- Tanpa migration skema: `Spec.stage` hanya maju, spec lama yang sudah `done` tetap `done`.
- `PhaseReviewerEntry.phase` berubah `"Execute"` → `"Review"`; invocation reviewer tercatat
  `phase = "Review"`. Nama agen tetap `hanoman-fase-review` (= `phaseAgentName("Review")`), sel Setting
  `orchestration.<flow>.<runtime>.Review` tetap kuncinya — kini sekaligus sel fase biasa.
- Default model/effort Review tetap `REVIEWER_DEFAULTS` (tidak mewarisi orchestrator).

### 2. Alur orchestrator (menggantikan "langkah R")

1. Agen Execute melapor `Status: selesai` → orchestrator menulis `Execute done`.
2. Fase Review: orchestrator memanggil `hanoman-fase-review` (instruksi & gerbang bukti tetap dari ADR-0170).
3. `Verdict: lulus` → `Review done`.
4. `Verdict: rework` → lanjutkan agen Execute yang SAMA dengan `Temuan wajib diperbaiki:` apa adanya,
   lalu reviewer yang SAMA dengan laporan barunya; maks 2 putaran. Selama itu fase **Review** tetap
   aktif; invocation Execute tambahan menaikkan `attempts` chip Execute.
5. Putaran habis / reviewer galat / tanpa baris `Verdict:` → `Keputusan terbuka`, `Review done` TIDAK ditulis.

### 3. Sesi tunggal (tanpa subagent)

Agen yang sama mengerjakan fase Review sendiri: audit spec & plan terhadap diff
`$HANOMAN_BASE_SHA...HEAD` dan test sesuai scope, menulis tabel `AC → putusan → bukti` dan
`Verdict: lulus | rework`. `rework` → perbaiki, lalu review ulang (maks 2 putaran) sebelum `Review done`.

### 4. Kompatibilitas

- Berkas fase sesi lama dengan `Execute done` tanpa baris Review menampilkan Review `active`; bila sesi
  itu di-continue ia menjalankan Review — perilaku yang dikehendaki.
- Klausa continue "baris `Execute done` LAMA" (`runner/src/prompt.ts`) diperluas ke `Review done`:
  keduanya baru ditulis ulang setelah sesi INI menyelesaikannya.
- `enrichPhases` tetap memilih agen fase sendiri per fase; pemilah `agentName` reviewer di Execute
  tak lagi dibutuhkan untuk data baru, tetapi dipertahankan untuk invocation lama (`phase = Execute`,
  `agentName = hanoman-fase-review`) agar tak dihitung sebagai percobaan Execute.

### 5. Permukaan yang tersentuh

- `shared/src/orchestration.ts`, `shared/src/orchestration-plan.ts`, `shared/src/runtime-defaults.ts`
- `runner/src/prompt.ts` (daftar fase, klausa review orchestrator & sesi tunggal, klausa continue),
  `runner/src/phase-agents.ts` (reviewer = agen fase Review; klausa SDD "review akhir kedua"),
  `runner/src/codex-settings.ts`
- `server/src/services/session-phases.ts`, `session-close.ts`, `session-launch.ts`
- UI: `PhasePlanPreview`, Settings orkestrasi (sel Review jadi baris fase biasa)
- Golden prompt berubah sengaja.
- MCP: tak ada API baru; `hanoman_session_phases` membawa fase baru apa adanya.
- Docs: ADR-0230, amandemen catatan di ADR-0170, `internal/docs/README.md`, docs alur fase yang relevan.

## Test

- `stageFor`: Execute done + Review active → `executing`; Review done → `done`; flow lain tak berubah.
- Gerbang selesai: feature/qa tanpa `Review done` → belum lengkap; `Review skipped` → belum lengkap.
- `resolvePhasePlan`: feature/qa memuat fase `Review` dengan default reviewer; override sel `Review` berlaku.
- `enrichPhases`: invocation `phase = Review` menjadi agen chip Review; invocation reviewer lama di Execute
  tak menaikkan `attempts` Execute.
- Prompt: orchestrator & sesi tunggal feature/qa memuat instruksi fase Review; golden diperbarui.
