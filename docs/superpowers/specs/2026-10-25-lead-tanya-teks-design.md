# Cara bertanya sesi claude mengikuti status lead — Design

- Tanggal: 2026-10-25
- Status: disetujui operator (brainstorming 2026-10-25)
- Mengamandemen: ADR-0167 (pemutus tak ditulis ke prompt; claude WAJIB `AskUserQuestion`)
- ADR baru: ADR-0231

## Masalah

Sesi claude selalu bertanya lewat `AskUserQuestion`, siapa pun yang menjawab. Operator ingin:

- **lead menjawab** (lead aktif, tak dijeda, project opt-in, lead tak dijeda untuk project itu) →
  claude bertanya lewat **teks biasa** di terminal;
- **lead tak menjawab** (lead mati/dijeda, atau project tak opt-in/dijeda) → claude bertanya lewat
  **`AskUserQuestion`** sehingga manusia yang memutuskan.

## Keputusan

1. **Penentu.** Predikat murni `leadDecides(cfg, optIn, projectId)` = syarat `admitAsk`
   (`enabled && !paused && optIn ∋ projectId && leadActive(cfg, projectId)`). `askViaFor(projectId, agent)`
   (async): agent ≠ claude → `undefined`; selain itu `"text"` bila `leadDecides`, `"tool"` bila tidak;
   galat membaca konfigurasi → `"tool"` (manusia memutuskan).
2. **Dikunci saat lahir.** Pemanggil `createSession` yang membawa prompt agen (session-launch, empat
   flow project di `routes/terminal.ts`, `cron-session`, `qa-session`) meneruskan `askVia`. Pane lead
   sendiri dan sesi Telegram tak berubah.
3. **Prompt.** `askVia: "tool"` → prompt apa adanya (golden lama tak berubah). `askVia: "text"` →
   `textAsk(s)` di runner menukar setiap frasa rute-tanya `AskUserQuestion` milik claude (klausa
   otonomi, langkah 3 & 4 orchestrator, relay custom agent) dengan padanan teks: "JANGAN memakai
   AskUserQuestion; tanyakan di terminal ini sekaligus, bernomor, tiap pertanyaan diakhiri `?` beserta
   opsi & rekomendasi, lalu berhenti dan tunggu jawaban". Diterapkan di `createSession` pada prompt
   sesi, blok roster custom agent, dan instruksi agen fase. Test menjamin tak ada sisa
   `AskUserQuestion` di keluaran builder mana pun sesudah `textAsk`.
4. **Lead membaca teks claude.** Sesi claude `askVia: "text"` memasang hook `Stop` ke jalur event
   (`guardSettings(…, askText)`). `parseHookEvent` menerima Stop claude: `turn_id` opsional, `askId`
   disintesis `stop:<prompt_id>:<hash pesan>`; `stop_hook_active` dan Stop dengan `background_tasks`
   yang masih berjalan diabaikan. Gerbang `readCodexTurn` → `readTurn` (ambang `ASK_SIGNALS` sama).
   Lead menjawab dengan mengetik ke prompt claude (jalur `turn-end` yang sama dengan codex).
   Hook `PreToolUse` `AskUserQuestion` tetap terpasang — agen yang tetap memakai tool itu tetap dilayani.
5. **Status berubah di tengah sesi.** Tak ada pertanyaan hilang: lead dimatikan → pertanyaan teks tetap
   tampil, pil "menunggu keputusan" (hook Notification) & notifikasi Telegram tetap menyala, manusia
   mengetik jawabannya; lead dinyalakan → `AskUserQuestion` dijawab lead seperti sekarang.

## Test

- `leadDecides` setara gerbang `admitAsk`; `askViaFor` (claude/codex, galat → tool).
- `textAsk`: keluaran tiap builder (tunggal, orchestrator claude, custom agent relay) tanpa
  `AskUserQuestion`, memuat rute teks; `tool` = byte-identik.
- `guardSettings` askText memasang Stop event hook; tanpa askText tak berubah.
- `parseHookEvent` Stop claude: askId sintetis, stop_hook_active/background_tasks diabaikan.
- Lead menjawab giliran teks claude (detect turn-end).
- `createSession` askVia text menulis prompt & agen fase hasil `textAsk`.
