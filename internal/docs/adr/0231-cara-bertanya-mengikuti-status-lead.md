# ADR-0231 — Cara bertanya sesi claude mengikuti status lead (dikunci saat lahir)

**Status:** aktif (2026-10-25). **Mengamandemen [ADR-0167](0167-keputusan-ambigu-lead-atau-manusia.md)**
keputusan #2 ("status lead TIDAK ditulis ke prompt") dan #6 ("claude wajib lewat `AskUserQuestion`").
Pemutusnya tetap ADR-0167 #1 (lead bila menjawab project itu, selain itu manusia); gerbang `admitAsk`
tak berubah. Desain: [`docs/superpowers/specs/2026-10-25-lead-tanya-teks-design.md`](../../../docs/superpowers/specs/2026-10-25-lead-tanya-teks-design.md) ·
plan: [`docs/superpowers/plans/2026-10-25-lead-tanya-teks.md`](../../../docs/superpowers/plans/2026-10-25-lead-tanya-teks.md).

## Konteks

Sejak ADR-0146 lead menjawab claude hanya lewat hook `PreToolUse` `AskUserQuestion`, lalu mengetik ke
widget dialog TUI (SPEC-452/474/485 — dialog berantai, multiSelect, kolom bebas). Operator ingin:
saat lead menjawab project-nya, claude bertanya lewat **teks biasa** (seperti codex); saat lead mati
atau dijeda, atau project tak opt-in, claude memakai **`AskUserQuestion`** supaya manusia yang memutuskan
lewat dialognya.

## Keputusan

1. **`askVia` dikunci saat sesi lahir.** `askViaFor(projectId, agent)` (`server/src/services/lead/ask-via.ts`):
   claude → `"text"` bila `leadDecides(cfg, optIn, projectId)` (syarat yang sama dengan `admitAsk`:
   lead aktif, tak dijeda, project opt-in, project tak dijeda), selain itu `"tool"`; galat membaca
   konfigurasi → `"tool"`. Runtime lain → `undefined` (selalu teks, ADR-0167 #3). Dipanggil pemanggil
   ber-prompt: backlog (`session-launch`), reverse/scaffold/prd/breakdown (`routes/terminal.ts`), cron,
   QA. Pane lead sendiri dan sesi Telegram tak memakainya.
2. **Prompt.** `createSession({ askVia: "text" })` (claude) menerapkan `textAsk()` (`runner/src/ask-via.ts`)
   ke prompt sesi, blok roster custom agent, dan instruksi agen fase: setiap frasa rute-tanya
   `AskUserQuestion` (`ASK_ROUTE`, `ASK_ESCALATION_TOOL`, `ASK_DECISIONS_TOOL`, `ASK_RELAY_TOOL`) ditukar
   padanan teks — "JANGAN memakai AskUserQuestion (juga bila sebuah skill menyuruhnya); tanyakan di
   terminal ini sekaligus, bernomor, tiap pertanyaan diakhiri `?` beserta opsi & rekomendasi, lalu
   berhenti dan tunggu". `tool`/absen → prompt byte-identik (golden tak berubah).
3. **Lead membaca teks claude.** Sesi `askVia: "text"` memasang hook `Stop` ke jalur event
   (`guardSettings(…, askText)`). `parseHookEvent` menerima Stop claude: `turn_id` opsional; askId
   sintetis `stop:<prompt_id>:<fnv1a(pesan)>`; `stop_hook_active` dan giliran yang berhenti selagi
   `background_tasks` masih `running` diabaikan. Gerbang `readCodexTurn` → `readTurn` (ambang
   `ASK_SIGNALS` sama). Lead menjawab lewat jalur `turn-end` yang sama dengan codex: mengetik ke prompt
   lalu Enter. Hook `PreToolUse` `AskUserQuestion` tetap terpasang.
4. **Status berubah di tengah sesi** — tak ada pertanyaan hilang: lead dimatikan → pertanyaan teks tetap
   tampil, pil "menunggu keputusan" (hook Notification) & notifikasi tetap menyala, manusia mengetik;
   lead dinyalakan → `AskUserQuestion` dijawab lead seperti sebelumnya.

## Konsekuensi

- Prompt kini membawa jejak status lead saat lahir — basi bila lead di-toggle; diterima operator
  (pilihan "dikunci saat lahir", 2026-10-25) karena kedua jalur tetap terpasang.
- Kepatuhan "jangan AskUserQuestion" murni lewat prompt (ADR-0037); bila agen tetap memakainya, lead
  tetap menjawab lewat jalur ADR-0146.
- Sesi teks mengirim satu event per akhir giliran; `ASK_SIGNALS` yang konservatif menyaring giliran
  yang bukan pertanyaan.
- Tanpa migration, tanpa API baru (tak perlu keputusan MCP).
