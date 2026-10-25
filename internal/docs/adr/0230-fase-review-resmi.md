# ADR-0230 — Fase Review resmi untuk flow feature & qa

**Status:** aktif (2026-10-25). **Mengamandemen ADR-0170 #4** ("reviewer BUKAN fase pipeline") dan peta
stage ADR-0008 untuk flow `feature`/`qa`. Instruksi & gerbang bukti reviewer ADR-0170 tak berubah.
Desain: [`docs/superpowers/specs/2026-10-25-fase-review-resmi-design.md`](../../../docs/superpowers/specs/2026-10-25-fase-review-resmi-design.md) ·
plan: [`docs/superpowers/plans/2026-10-25-fase-review-resmi.md`](../../../docs/superpowers/plans/2026-10-25-fase-review-resmi.md).

## Konteks

ADR-0170 menambah reviewer independen `hanoman-fase-review` yang dipanggil orchestrator di "langkah R",
**di dalam** fase Execute, sebelum `Execute done`. Invocation-nya tercatat `phase = Execute`. Operator
melihat review "menyatu dengan execution":

- review tak punya chip, status, durasi, maupun token sendiri di PhaseStrip;
- putaran rework tampak sebagai Execute yang berjalan lama, bukan Execute ⇄ Review;
- sesi tunggal (tanpa orkestrasi subagent) tak menjalankan review sama sekali.

## Keputusan

1. **`Review` fase pipeline resmi** di `FLOW_PHASES.feature` dan `FLOW_PHASES.qa`, sesudah `Execute`,
   di **semua** mode sesi. Flow lain tak berubah.
2. **Stage**: `REACHED.Execute = executing`, `REACHED.Review = done`. `Review` bukan `WORK_PHASES`.
   `UNSKIPPABLE_PHASES = {Review}` (`@hanoman/shared`): `Review skipped` tak dihitung tercapai oleh
   `stageFor`, tak menutup `phasesComplete`, dan tak lolos gate goal/codex (`^Review done$` saja).
   Tanpa migration — `Spec.stage` hanya maju, spec lama yang `done` tetap `done`.
3. **Rencana fase**: `PhasePlan.reviewer` dan `PhaseReviewerEntry` dicabut; reviewer adalah entri
   `phases` dengan `phase = "Review"`, nama agen tetap `hanoman-fase-review`, default tetap
   `REVIEWER_DEFAULTS` (claude `opus`·`high`, codex `gpt-5.6-sol`·`high`, antigravity `inherit`) dan
   TIDAK mewarisi orchestrator. Sel Setting `orchestration.<flow>.<runtime>.Review` kini sel fase biasa
   (tampil di tab Orkestrasi, ikut seed `BUILTIN_ORCHESTRATION_DEFAULTS`, versi `2026-10-25-v1`).
   Seed mempertahankan sel `Review` yang sudah diisi operator sebelum marker-nya ada: kunci marker
   yang absen + nilai tersimpan = milik operator.
4. **Orchestrator** (langkah R baru): agen Execute `selesai` → `Execute done`; fase Review dipanggil
   dengan serah-terima tambahan (`Laporan Execute:`, `Putaran rework:`). `Verdict: lulus` → `Review done`.
   `Verdict: rework` → agen Execute yang SAMA dilanjutkan dengan temuan, lalu reviewer yang SAMA; maks 2
   putaran, sisanya `Keputusan terbuka`. Rework tak menulis ulang `Execute done`; chip Review tetap aktif.
5. **Sesi tunggal**: `SELF_REVIEW_CLAUSE` — agen memeriksa hasil Execute-nya sendiri (spec & plan vs
   perubahan sesi, test sesuai scope), tabel `AC → putusan → bukti`, `Verdict:`; `Review done` hanya
   sesudah `lulus`. Skill fase Review per metode: superpowers `requesting-code-review`, matt
   `code-review`, agent-skills `code-review-and-quality`, plus gerbang verifikasi. `exitSkills` kini
   menempel ke fase terakhir = Review.
6. **Continue** (SPEC-172) melanjutkan Execute lalu Review; baris `Execute done`/`Review done` lama
   tak berlaku dan ditulis ulang sesudah sesi INI menuntaskannya.
7. **Data lama**: invocation reviewer lama (`phase = Execute`, `agentName = hanoman-fase-review`) tetap
   tak dihitung percobaan Execute (`enrichPhases`, ADR-0170). Berkas fase lama berisi `Execute done`
   tanpa Review menampilkan Review `active`; sesi itu, bila dilanjutkan, menjalankan Review.

## Konsekuensi

- Stage `done` feature/qa kini butuh `Review done`; sesi yang berhenti sesudah Execute tertahan di
  `executing` — disengaja.
- Satu baris marker lagi per run; review sesi tunggal menambah waktu dan token, dan kepatuhannya murni
  lewat prompt (ADR-0037). `Verdict:` tetap belum ditegakkan server.
- MCP: tak ada API baru; `hanoman_session_phases` membawa fase Review apa adanya.
- Golden prompt `start-feature`, `start-qa-matt`, `continue-feature`, `resume-qa` dan hash prompt
  Antigravity berubah sengaja.
