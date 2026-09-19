# ADR-0167 — Keputusan ambigu selalu ditanyakan: lead bila aktif, selain itu manusia

**Status:** diterima · 2026-09-19 · tanpa nomor SPEC (dikerjakan langsung atas permintaan operator).
**Mengamandemen** SPEC-298 (arti `scheduler.autonomy = full-control`) dan
[0164](0164-orkestrasi-subagent-per-fase.md) (kontrak laporan agen fase & langkah 4 relay orchestrator).
**Menegakkan** [0146](0146-lead-dipicu-event-hook.md) & [0091](0091-hanoman-lead-agen-pemimpin.md) (lead sebagai
pemutus lewat `admitAsk` → `leadActive`), [0143](0143-menunggu-keputusan-keadaan-turunan.md) &
[0142](0142-inbox-keputusan-dialog-sesi.md) (pertanyaan yang menunggu manusia terlihat di pet/inbox),
[0074](0074-codex-sebagai-mesin-sesi.md) (satu prompt untuk dua runtime), [0024](0024-sesi-interaktif-menggantikan-run.md)
(nol timer/queue baru). Design-of-record:
[spec](../../../docs/superpowers/specs/2026-09-19-keputusan-lead-atau-manusia-design.md).

## Konteks

Relay pertanyaan subagent → manusia sudah ada sejak 0164 (agen fase menulis `Pertanyaan untuk manusia:`,
orchestrator meneruskannya lewat `AskUserQuestion`), tetapi tak pernah terpicu. Pemindaian transkrip
lokal 2026-09-19: **166** run `hanoman-fase-*` dari **42** sesi orchestrator — **semuanya berpengawas** —
menghasilkan **0** pertanyaan, 157 `Status: selesai`, dan 30 laporan yang menyebut asumsi/keputusan yang
diambil sendiri ("Tiga keputusan berikut diambil tanpa bertanya dan layak dikonfirmasi", spec-1207).

Akarnya ada di prompt, bukan di mesin relay:
1. Prompt agen fase membuka dengan "lanjut sampai tuntas / JANGAN bertanya" dan hanya muat SATU
   pertanyaan; syarat bertanya sempit dan datang belakangan.
2. Kontrak laporan tak punya tempat untuk "selesai tapi ada asumsi" — asumsi jatuh ke prosa atau
   `Rekomendasi fase:`, yang tak dibaca orchestrator.
3. Orchestrator hanya bereaksi pada label harfiah, dan disuruh "di sesi tanpa pengawas, putuskan sendiri".
4. Custom agent tak punya jalur tanya sama sekali; `full-control` (SPEC-298) menyuruh agen memutuskan
   SETIAP percabangan sendiri.

Subagent claude/codex secara struktural **tak bisa** memanggil `AskUserQuestion`; hanya agen utama sesi
yang bisa, dan hanya pertanyaan agen utama yang sampai ke hook lead (0146).

## Keputusan

1. **Pemutus keputusan ambigu: hanoman-lead bila aktif untuk project itu, selain itu manusia** — untuk
   claude dan codex, sesi tunggal maupun orchestrator, agen fase maupun custom agent. "Ambigu" = akan
   mempengaruhi hasil: data model, kontrak API, scope, perilaku terlihat pengguna, atau asumsi yang
   terpaksa diambil agar bisa lanjut.
2. **Status lead TIDAK ditulis ke prompt.** Agen selalu bertanya; gerbang yang sudah ada (`admitAsk`)
   memilih lead atau membiarkan pertanyaan menunggu manusia. Prompt terkunci saat sesi lahir sedangkan
   lead bisa di-toggle di tengah sesi — status yang ditanam akan basi dan "wajib manusia" bocor.
3. **Tanpa batas jumlah pertanyaan maupun putaran.** Batas 4 milik tool `AskUserQuestion` dipecah ke
   beberapa panggilan berturut-turut (lead sudah menjawab rantai panggilan terpisah — audit SPEC-487).
   Codex mengajukan semuanya dalam satu pesan terminal, tiap pertanyaan bernomor dan diakhiri `?`,
   format yang lolos `ASK_SIGNALS` di `readCodexTurn` — dijaga test kontrak lintas modul.
4. **Kontrak laporan `Keputusan terbuka:`** (wajib, daftar atau `-`) + status `menunggu-keputusan` di
   agen fase **dan** custom agent; `selesai` hanya sah bila `-`. `Pertanyaan untuk manusia:` dicabut.
   Orchestrator (dan parent custom agent) wajib menanyakan SEMUA sebelum menulis marker fase, meneruskan
   jawabannya ke subagent yang sama, dan tak pernah menjawab sendiri.
5. **`full-control` diamandemen:** hanya mencabut checkpoint review/approval & menunggu persetujuan.
   Keputusan ambigu tetap ditanyakan; dengan lead mati sesi scheduler **boleh tertahan** menunggu manusia
   (pilihan operator yang disadari). Merge tetap manual ([0031](0031-rebase-merge-backlog.md)).
6. **Claude wajib lewat `AskUserQuestion`** (klausa netral-agen: "bila agenmu punya tool itu"), sebab
   pertanyaan teks biasa dari claude tak terbaca lead sejak 0146.

Implementasi: `runner/src/prompt.ts` (`DECIDER`, `ASK_ROUTE`, kedua klausa otonomi, `orchestratorClause`
langkah 4), `runner/src/phase-agents.ts`, `runner/src/custom-agents.ts` (`handoffClause`,
`agentDelegationClause`), `shared/src/builtin-app-agents.ts`. Nol kode server, nol skema.

## Alternatif yang ditolak

- **Status lead ditanam ke prompt saat lahir** — basi bila lead di-toggle di tengah sesi (lihat #2).
- **Penegakan server** (tolak `<Fase> done` selama ada keputusan terbuka) — butuh parser laporan subagent
  dan keadaan baru; jadi lanjutan bila pembuktian nyata menunjukkan agen masih lolos lewat prompt.
- **`full-control` tetap pengecualian / dicabut total** — operator memilih aturan baru menang tanpa
  mencabut mode-nya.
- **Batas jumlah pertanyaan** — keputusan yang tak ditanyakan karena kuota tetap diputuskan diam-diam.

## Konsekuensi & gotcha

- Pertanyaan yang sudah menunggu saat lead baru dinyalakan tetap ke manusia: lead dipicu event
  `PreToolUse`/`Stop` yang baru, bukan menyapu pertanyaan lama.
- Lebih banyak pertanyaan akan sampai ke lead/operator; itu memang tujuannya.
- Prompt hidup di ARGV agen (muatan `pkill -f`, 0108): klausa baru sengaja tak memuat nama perintah.
- Langkah 3 orchestrator masih berbunyi "walau klausa otonomi … menyuruhmu tak bertanya" — sisa aman
  dari M-6; tak satu pun klausa otonomi kini menyuruh tak bertanya.
