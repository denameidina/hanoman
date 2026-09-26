# ADR-0173 — Mode Execute per flow: inline (default) | subagent per task

- Status: Accepted
- Tanggal: 2026-09-26
- SPEC: — ([desain](../../../docs/superpowers/specs/2026-09-26-execute-mode-inline-subagent-design.md),
  [plan](../../../docs/superpowers/plans/2026-09-26-execute-mode.md))
- **Mengamandemen** [0170](0170-orkestrasi-mutu-subagent-foreground-reviewer-beban.md) keputusan #2
  (Execute claude = `subagent-driven-development`) dan #3 (klausa delegasi peran `execute`).

## Konteks

ADR-0170 #2 membuat agen fase Execute claude selalu memakai `superpowers:subagent-driven-development`:
minimal dua subagent BERURUTAN per task (implementer + reviewer, ditambah perbaikan & review ulang),
masing-masing membangun konteks dan menjalankan test dari nol, semuanya foreground
(`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`), plus review akhir DUA kali atas diff yang sama (final
review milik skill + `hanoman-fase-review`). Operator melaporkan fase Execute "lama banget";
pembandingnya, fitur 9 task yang dikerjakan inline selesai tanpa satu subagent pun dan masalahnya
tertangkap test + smoke di akhir.

## Keputusan

1. **`Setting.orchestration.<flow>.executeMode: "inline" | "subagent"`**, default **`inline`**
   (JSON `Setting.data`, tanpa migration; nilai asing → `inline` lewat `.catch`, bukan Setting gagal
   parse). Bermakna hanya untuk `EXECUTE_MODE_FLOWS` = flow ber-fase Execute/Goal (`feature`, `qa`,
   `goal`); dipilih di Settings → Orkestrasi.
2. **Hanya sesi claude ber-orkestrasi yang terpengaruh.** Codex dan sesi tunggal tetap
   `executing-plans` dan klausa delegasi ADR-0170 apa adanya — subagent bersarang di codex belum diukur.
3. **Jalur data:** `resolvePhasePlan` → `PhasePlan.executeMode` → `phaseSkillsFor(…, runtime,
   executeMode)` (`orchestratedPhaseSkills` hanya bila claude ∧ `subagent`) → instruksi agen fase;
   `buildPhaseAgents` menempelkan `executeMode` ke `AgentDef` fase (tidak dirender ke konfigurasi
   runtime) supaya `withPhaseDelegation` di `createSession` memilih klausa.
4. **`inline`**: skill `executing-plans`; klausa delegasi Execute/Goal = kerjakan task plan SENDIRI
   berurutan, subagent hanya untuk pencarian read-only paralel.
5. **`subagent`**: perilaku ADR-0170 (implementer per task berurutan + review per task), dan bila
   reviewer `hanoman-fase-review` ada, final whole-branch review milik skill **dilewati**.

## Konsekuensi

- Semua flow pindah ke inline saat update — disengaja atas permintaan operator; setelan lama tanpa
  field terbaca `inline`. Subagent dapat dinyalakan kembali per flow.
- Inline kehilangan review per task dan konteks segar per task. Gerbang mutu yang tersisa: TDD,
  `verification-before-completion`, dan `hanoman-fase-review` (maks 2 putaran rework).
- Definisi agen fase berubah bentuk (instruksi Execute berbeda) → `agentDefinitionHash` berubah
  untuk sesi baru; itu memang perubahan definisi.
