# Cara Bertanya Mengikuti Status Lead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesi claude bertanya lewat teks biasa bila lead menjawab project-nya, lewat `AskUserQuestion` bila tidak — dikunci saat sesi lahir.

**Architecture:** Server menghitung `askVia` (async, dari konfigurasi lead) dan meneruskannya ke `createSession`; runner menyediakan `textAsk()` yang menukar frasa rute-tanya, plus hook `Stop` claude ke jalur event; lead membaca giliran teks claude lewat jalur `turn-end` codex yang sudah ada.

**Tech Stack:** TypeScript strict, vitest, Fastify, Claude Code hooks.

Spec: [`docs/superpowers/specs/2026-10-25-lead-tanya-teks-design.md`](../specs/2026-10-25-lead-tanya-teks-design.md)

## Global Constraints

- `askVia: "tool"` / tanpa `askVia` → prompt & settings byte-identik dengan sekarang (golden tak berubah).
- Codex, antigravity, pane lead, sesi Telegram, terminal operator: tak berubah.
- Galat membaca konfigurasi lead → `"tool"`.
- Tanpa migration; tanpa API baru (tak perlu keputusan MCP).
- Test: skrip env-bersih + `TEST_DATABASE_URL` terisolasi + `--no-file-parallelism`.

---

### Task 1: runner — `textAsk` & hook Stop claude

**Files:** `runner/src/prompt.ts`, `runner/src/custom-agents.ts`, `runner/src/settings.ts`, `runner/src/agent-cli.ts`, `runner/src/index.ts` (ekspor); test `runner/test/ask-via.test.ts`, `runner/test/settings*.test.ts`.

**Produces:** `export type AskVia = "tool" | "text"`; `export function textAsk(s: string): string`;
`export const TEXT_ASK_ROUTE: string`; `guardSettings(decisionFile, goal, eventHook, statusLine, askText?: boolean)`;
`agentFlags({ …, askText?: boolean })`.

- [x] Test gagal: untuk startPrompt/resumePrompt/continuePrompt/startGoalPrompt/startProjectPrompt/
  startScaffoldPrompt/startPrdPrompt/startBreakdownPrompt/cronPrompt (mode tunggal) dan
  `orchestratorClause(plan claude)` serta `agentDelegationClause(defs, "claude")`: keluaran memuat
  `AskUserQuestion` sebelum `textAsk`, tak memuat sesudahnya, dan memuat `TEXT_ASK_ROUTE`/frasa teks;
  `textAsk` idempoten; string tanpa frasa → tak berubah. `guardSettings(..., true)` → `hooks.Stop` memuat
  `EVENT_HOOK_COMMAND`; tanpa flag → JSON identik.
- [x] Implementasi: frasa claude dijadikan konstanta bernama (`ASK_ROUTE`, langkah 3 `askEscalation`,
  langkah 4 `askDecisions`, relay custom agent) dan `textAsk` menukar tiap konstanta dengan padanan teks
  (pakai frasa codex yang sudah ada + "JANGAN memakai AskUserQuestion"). `guardSettings`: bila `askText`
  dan `eventHook`, push `{ hooks: [{ type: "command", command: EVENT_HOOK_COMMAND }] }` ke `hooks.Stop`.
- [x] Test runner hijau, golden tak berubah. Commit.

### Task 2: shared + lead — parse Stop claude, `readTurn`, `leadDecides`, `askViaFor`

**Files:** `shared/src/session-ask.ts`, `server/src/services/lead/pane.ts`, `server/src/services/lead/detect.ts`, `server/src/services/lead/ask-via.ts` (baru); test `shared/src/session-ask.test.ts`, `server/test/lead-*.test.ts` terkait, `server/test/ask-via.test.ts`.

**Produces:** `leadDecides(cfg, optIn, projectId): boolean`; `askViaFor(projectId, agent, deps?): Promise<AskVia | undefined>`; `readTurn(message)` (ganti nama `readCodexTurn`).

- [x] Test gagal: Stop claude (`hook_event_name: "Stop"`, `prompt_id`, `last_assistant_message`, tanpa
  `turn_id`) → `turn-end` dengan askId `stop:<prompt_id>:<hash>` stabil; dua pesan berbeda → askId beda;
  `stop_hook_active: true` → null; `background_tasks` ber-status running → null; Stop codex lama tetap.
  `leadDecides` sesuai empat syarat; `askViaFor`: codex → undefined; claude + lead menjawab → "text";
  lead mati/jeda/tak opt-in → "tool"; deps melempar → "tool". `admitAsk` tetap memakai pemeriksaannya sendiri (alasan penolakan per syarat dipertahankan); `leadDecides` memakai syarat yang sama.
- [x] Implementasi sesuai interface di atas.
- [x] Test tersentuh hijau. Commit.

### Task 3: server — teruskan `askVia` ke `createSession`

**Files:** `server/src/services/pty.ts` (`CreateOpts.askVia`, terapkan `textAsk` ke prompt+roster+agen fase, `askText` ke `agentFlags`), `server/src/services/session-launch.ts`, `server/src/routes/terminal.ts` (4 flow), `server/src/services/scheduler/cron-session.ts`, `server/src/services/qa-session.ts`; test `server/test/pty.test.ts` / `server/test/session-launch.test.ts`.

- [x] Test gagal: `createSession({ agent: "claude", askVia: "text", prompt })` → berkas prompt tanpa
  `AskUserQuestion` dan settings `--settings` memuat Stop event hook; agen fase (berkas `--agents`) tanpa
  `AskUserQuestion`; `askVia` absen → seperti sekarang. `startSpecSession` dengan lead menjawab project →
  prompt teks; lead mati → prompt `AskUserQuestion`.
- [x] Implementasi: setiap pemanggil `await askViaFor(projectId, agent)` sebelum `createSession`.
- [x] Test tersentuh hijau. Commit.

### Task 4: docs & verifikasi

- [ ] ADR-0231 (amandemen ADR-0167), catatan amandemen di ADR-0167, index `internal/docs/README.md` &
  `internal/docs/adr/README.md`, `internal/skills/hanoman/SKILL.md` (bagian lead/ask).
- [ ] Typecheck shared/runner/server; test `--changed main` dibanding `main`; boot server lokal: buat
  project + opt-in lead + start sesi backlog dummy (`HANOMAN_CLAUDE_BIN=/bin/echo`) dan periksa berkas
  prompt-nya, lalu matikan lead dan ulangi. Centang plan, commit.
