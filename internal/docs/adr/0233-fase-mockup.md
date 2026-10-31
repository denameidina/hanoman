# ADR-0233 — Fase Mockup opsional, skill `codex-image` milik hanoman, dan viewer mockup

**Status:** aktif (2026-10-31). **Memperluas** ADR-0230 (daftar fase feature/qa), ADR-0040 (jalur cepat qa
kini juga melewati Mockup), dan ADR-0172 (skill global kini bisa datang dari bundel paket).
Desain: [`docs/superpowers/specs/2026-10-31-fase-mockup-design.md`](../../../docs/superpowers/specs/2026-10-31-fase-mockup-design.md) ·
plan: [`docs/superpowers/plans/2026-10-31-fase-mockup.md`](../../../docs/superpowers/plans/2026-10-31-fase-mockup.md).

## Konteks

Flow feature dan qa melompat dari Spec ke Plan. Tampilan baru baru terlihat sesudah Execute, jadi salah
tafsir UI ketahuan di Review atau sesudah merge. Operator ingin melihat dan menyetujui gambar UI sebelum
Plan, dan tak membayar langkah itu untuk backlog tanpa UI.

## Keputusan

1. **`Mockup` fase pipeline** di `FLOW_PHASES.feature` dan `FLOW_PHASES.qa`, tepat sesudah `Spec` dan
   sebelum `Plan`. Flow lain tak berubah. Agen fase `hanoman-fase-mockup`, default claude `sonnet·medium`,
   codex `gpt-5.6-terra·medium`, antigravity `inherit` (`RUNTIME_DEFAULTS_VERSION = 2026-10-31-v1`; sel yang
   sudah diisi operator dipertahankan, mekanisme ADR-0230 #3).
2. **Skip diputuskan agen**: backlog tanpa layar/komponen/state UI yang berubah atau dibuat → `Mockup
   skipped` dengan satu baris alasan; ragu → buat mockup. Jalur cepat qa menulis `Spec skipped`, `Mockup
   skipped`, `Plan skipped`.
3. **Fase opsional** (`OPTIONAL_PHASES = {Mockup}`, `@hanoman/shared`): fase yang belum tercatat dibaca
   `skipped` bila ada fase sesudahnya yang sudah tercatat. Sesi yang lahir sebelum ADR ini tak pernah menulis
   baris Mockup; tanpa aturan ini `phasesComplete` tak pernah benar dan chip Mockup menyala di belakang Plan.
   Gerbang codex & kondisi goal mencerminkan aturan yang sama.
4. **Stage tak berubah**: `Mockup` tak masuk `REACHED`; backlog tetap `spec-ready` sampai Plan. Bukan
   `WORK_PHASES`, bukan `UNSKIPPABLE_PHASES`. Tanpa migration.
5. **Persetujuan wajib** lewat jalur tanya ADR-0167/0231 (lead bila aktif, selain itu manusia) dengan opsi
   Setujui · Revisi · Lewati. Kepatuhannya lewat prompt (ADR-0037), tak ditegakkan server.
6. **Engine**: skill fase `codex-image` untuk semua metode dan runtime (prompt netral-agen, ADR-0074). Di
   dalam skill, runtime yang punya `image_gen` (Codex) memakainya langsung; runtime lain memanggil
   `codex exec` lewat skrip skill. Codex tak tersedia → tanya, tak pernah gambar pengganti.
7. **Skill milik hanoman**: `server/skills/codex-image` ikut paket npm, di-seed ke
   `$HANOMAN_HOME/skills/codex-image` saat boot (marker `.hanoman-bundled.json`; salinan yang diubah operator
   tak ditimpa), lalu disuntik per sesi lewat mekanisme ADR-0172 — kecuali runtime sesi itu sudah punya
   skill user/project bernama sama.
8. **Mockup di git**: `docs/mockups/<spec-id>/<NN>-<slug>.png`, maks 6 per backlog.
9. **Viewer**: `GET /specs/:id/mockups` + `GET /specs/:id/mockups/:name` membaca folder itu dari worktree sesi,
   jatuh ke checkout project. MCP: `hanoman_backlog_mockups_list` (read) + `hanoman_backlog_mockup_download`
   (transfer, preseden ADR-0183). Dashboard: `ImageViewer` (zoom/pan/pinch) dari dialog tanya sesi, chip
   fase Mockup, dan detail backlog.

## Konsekuensi

- Satu baris marker lagi per run feature/qa; backlog ber-UI menambah 1–3 menit per gambar dan satu putaran
  tanya.
- PNG ikut di-commit ke repo project (disengaja: rekam desain terlihat di PR dan tetap ada sesudah merge).
- Runtime non-codex butuh `codex` CLI yang sudah login di mesin yang sama; `hanoman doctor` menyebutnya.
- Golden prompt `start-feature`, `start-qa-matt`, `continue-feature`, `resume-qa` dan hash Antigravity berubah
  sengaja.
