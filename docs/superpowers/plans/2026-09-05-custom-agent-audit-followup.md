# Perbaikan Custom Agent Bawaan Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development task-by-task. Steps use checkbox tracking; implementer tidak membuat subagent sendiri.

**Goal:** Menutup seluruh temuan yang dapat diperbaiki dari audit delapan custom agent.

**Architecture:** Registry native memuat agent enabled yang kompatibel; parent memilih kapan memakai agent berdasarkan konteks terbaru. Prompt sesuai policy, eval memakai policy yang sama, dan metrik menyimpan identitas definisi yang dieksekusi.

**Tech Stack:** TypeScript, Node, Fastify, Prisma SQLite, React, Vitest; tanpa dependensi baru.

**Spec:** [spec](../specs/2026-09-05-custom-agent-audit-followup.md)

## Global Constraints
- Main tidak disentuh; cwd implementasi .worktrees/audit-builtin-agents-20260905.
- Default aktif scout/blast-radius/security-reviewer dan model tetap.
- Read-only validator tidak diperlonggar; unsupported Codex worktree tetap unavailable.
- Metadata invocation LOCAL-only; nilainya yang tidak diketahui null.
- Test server serial, DB temp unik, env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS.
- Semua perubahan docs dan kode satu rangkaian commit; tidak publish/merge.

### Task 1: Prompt, availability, dan kontrak delegasi
**Ownership:** shared/src/builtin-agents.ts; runner/src/custom-agents.ts; server/src/services/custom-agents.ts; server/src/routes/custom-agents.ts; test langsung terkait. Jangan edit shared/src/custom-agent.ts, pty.ts, UI, eval, atau docs (parent memilikinya).
**Consumes:** AgentDef existing; availability fields existing.
**Produces:** selectAgentRows tetap signature lama tetapi hanya memfilter enabled/runtime/policy; agentPromptOf menyertakan policy/batas dan handoff; view tambahan selectionReason opsional.
- [x] Tambahkan regresi selector: enabled QA/dep pada feature diff kosong, security pada goal/no_effort, spec-auditor pada audit; disabled dan runtime guard tetap.
- [x] Jalankan test selector merah.
- [x] Ubah selector menjadi registry availability, perbaiki semua prompt sesuai spec, parent menilai ulang kebutuhan saat delegasi dan menyertakan kandidat yang diperiksa.
- [x] Tambahkan maxTurns sesuai spec; renderer menyatakan batas instruksional dan native bila didukung tanpa mengarang hard kill.
- [x] Uji prompt policy/runtime, seed upgrade unedited dan operator-edited, route availability/version gate. Jalankan test terarah dan typecheck shared/runner/server bila kode terkait sudah koheren.

### Task 2: Evaluator sesuai produk dan fixture executable
**Ownership:** runner/src/custom-agent-eval.ts (boleh pecah modul evidence); evals/custom-agents/**; runner/test/custom-agent-eval.test.ts; scripts/agent-eval.ts. Jangan edit renderer, selector, schema, UI, atau docs.
**Consumes:** AgentDef/renderAgentsJson/materializeCodexAgents/writeReadOnlyHook.
**Produces:** eval menolak prosa keyword-only dan memvalidasi evidence/artefak; report mencatat model/fingerprint bila tersedia.
- [x] Kunci regresi keyword-only/negasi, production hook missing, dan baseline-preservation cases dengan test merah.
- [x] Materialisasikan hook via writeReadOnlyHook(configDir), teruskan readOnlyHookCommand ke kedua renderer.
- [x] Rancang amplop JSON evidence dengan status/klaim/jangkar; validasi shape, status, path/line aktual, expected semantics scoped per finding; command evidence/artifact dari fixture terverifikasi, bukan prosa parent.
- [x] Ganti fixture QA/edge dengan project Node test runner tanpa install; beri base SHA pada task, kandidat dirty dapat diperiksa child terisolasi. Tambahkan kontrol perilaku sudah benar dan requirement di base, serta fixture sumber advisory/lisensi.
- [x] Pertahankan lifecycle attribution, source isolation, timeout, dan compatibility guard. Jalankan test terarah plus typecheck runner; jangan memanggil model atau membuat subagents.

### Task 3: Observabilitas definisi dan penilaian hasil (parent)
**Ownership:** shared/src/custom-agent.ts; server/prisma/schema.prisma + migration; server/src/services/agent-invocations.ts; server/src/services/pty.ts; server/src/routes/session-events.ts; server/src/routes/custom-agent-metrics.ts; src/src/screens/CustomAgentsPanel.tsx; test terkait.
**Produces:** definitionHash nullable, reworkRequired nullable; metrics variants + telemetry evidence state; UI sampel, versi, batas/policy, token terpisah.
- [x] Tambahkan regression lifecycle fingerprint immutable, variant grouping, nullable rework, legacy null, dan UI zero-evidence.
- [x] Tambahkan migration dua kolom LOCAL-only; Prisma generate; fingerprint dari prompt/profile efektif pada roster tmux.
- [x] Propagasi hash dari roster trusted lewat session-events ke DB (jangan percaya field kiriman agent).
- [x] Tambahkan variants tanpa mengubah agregat lama, contoh dinilai/pending/rework, last event/state evidence yang jujur.
- [x] UI menampilkan breakdown runtime/model/versi, arti availability/smart/policy dan batas, token terpisah, tri-state rework opsional.
- [x] Test route auth/validation/lifecycle/UI, typecheck paket.

### Task 4: Docs, integrasi, dan review
**Ownership:** internal/docs/**; internal/skills/hanoman/SKILL.md; spec/plan ini; cross-boundary corrections yang dikoordinasikan.
- [x] Perbarui ADR-0159/0136, data-model, API, FRD, frontend, skill dan index.
- [x] Review task dan keseluruhan diff; perbaiki temuan berbukti.
- [x] Jalankan seluruh test terarah sekali sesudah integrasi; typecheck paket tersentuh.
- [x] Boot server local dengan DB temp, curl endpoint yang diubah sekali, simpan bukti.
- [x] Update laporan audit dengan status tindak lanjut; commit perubahan siap review, tanpa merge/publish.
