# Plan — Keputusan ambigu: lead bila aktif, selain itu manusia

Spec: [`docs/superpowers/specs/2026-09-19-keputusan-lead-atau-manusia-design.md`](../specs/2026-09-19-keputusan-lead-atau-manusia-design.md) · ADR-0167.

- [x] **Task 1 — Agen fase.** Test merah di `runner/test/phase-agents.test.ts` (`Keputusan terbuka:`,
  `menunggu-keputusan`, larangan memutuskan sendiri, tanpa `Pertanyaan untuk manusia:`, tanpa "maksimal"
  di kalimat keputusan); ubah `PHASE_AGENT_AUTONOMY` & `PHASE_AGENT_REPORT`.
- [x] **Task 2 — Orchestrator.** Test merah di `runner/test/orchestrator-prompt.test.ts` (langkah 4
  sebelum marker, claude pecah per 4 panggilan `AskUserQuestion`, codex terminal bernomor `?`, tanpa
  "putuskan sendiri", jangan menjawab sendiri); ubah `orchestratorClause`.
- [x] **Task 3 — Klausa otonomi.** Test merah di `runner/test/prompt.test.ts` (full-control: tanpa
  "Putuskan sendiri"/"JANGAN berhenti bertanya", tetap tembus tanpa checkpoint, bertanya untuk keputusan
  ambigu; butuh-keputusan: `AskUserQuestion` bila ada, terminal selain itu); `ASK_ROUTE` bersama.
- [x] **Task 4 — Custom agent.** Test merah di `runner/test/custom-agents.test.ts` (`handoffClause`
  `Keputusan terbuka:` + `menunggu-keputusan`; `agentDelegationClause` meneruskan per runtime; invarian
  string kosong); ubah `custom-agents.ts` + status di `shared/src/builtin-app-agents.ts`.
- [x] **Task 5 — Kontrak codex ↔ lead.** Test di `server/test/lead-pane.test.ts`: pesan codex berformat
  kontrak (>4 pertanyaan) → `readCodexTurn(...).asking === true`.
- [x] **Task 6 — Golden & test tersentuh.** Perbarui golden prompt dengan sengaja, jalankan test runner +
  test server yang tersentuh.
- [x] **Task 7 — Docs.** ADR-0167 + index ADR, `api-contract.md` & `data-model.md` (arti `full-control`),
  `stack.md`, `internal/docs/README.md`.
