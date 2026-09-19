# Keputusan ambigu: lead bila aktif, selain itu manusia — design

Tanpa nomor SPEC (dikerjakan langsung atas permintaan operator, tanpa backlog hanoman). ADR: [0167](../../../internal/docs/adr/0167-keputusan-ambigu-lead-atau-manusia.md).

## Konteks & keputusan

Pemindaian transkrip `~/.claude/projects/**/subagents/*.meta.json` (2026-09-19): **166** run agen fase
(`hanoman-fase-*`) dari **42** sesi orchestrator — **seluruhnya berpengawas** — menghasilkan **0** laporan
dengan `Pertanyaan untuk manusia:` berisi, 157 `Status: selesai`, dan 30 laporan yang menyebut asumsi atau
keputusan yang diambil sendiri. Contoh nyata: spec-1207 *"Tiga keputusan berikut diambil tanpa bertanya dan
layak dikonfirmasi"*, spec-1250 *"perlu konfirmasi satu asumsi terbuka"*. Relay ADR-0164 langkah 4 ada,
tetapi tak pernah terpicu.

Empat akar:
1. `PHASE_AGENT_AUTONOMY` membuka dengan "lanjut sampai tuntas / JANGAN bertanya"; syarat bertanya sempit
   dan datang sesudahnya.
2. Kontrak laporan tak punya tempat untuk "selesai tapi ada asumsi" — asumsi jatuh ke prosa atau
   `Rekomendasi fase:`, yang tak dibaca orchestrator.
3. Orchestrator hanya bereaksi pada label harfiah `Pertanyaan untuk manusia:`; `selesai` berbukti langsung
   ditandai `done`. Plus kalimat "di sesi tanpa pengawas, putuskan sendiri".
4. Custom agent (`handoffClause`) tak punya jalur tanya sama sekali; `AUTONOMY_CLAUSE_FULL` (SPEC-298)
   menyuruh agen memutuskan SETIAP percabangan sendiri.

Keputusan operator:
- **Lead aktif → lead yang memutuskan**; agen tetap mengajukan pertanyaan, lead menjawab lewat jalur
  hook yang sudah ada (ADR-0146). **Lead mati → keputusan wajib manusia.** Berlaku untuk claude & codex.
- **`full-control` tunduk pada aturan ini** — ia hanya mencabut checkpoint review/approval & menunggu
  persetujuan, bukan keputusan yang ambigu.
- **Tanpa batas jumlah pertanyaan** maupun putaran: selama masih ambigu dan akan mempengaruhi hasil,
  tanyakan. Batas 4 milik tool `AskUserQuestion` dipecah ke beberapa panggilan berturut-turut.

## Objective

Setiap keputusan ambigu yang mempengaruhi hasil — dari sesi tunggal, orchestrator, agen fase, maupun
custom agent, di claude maupun codex — sampai ke pemutus yang sah (lead bila `leadActive`, selain itu
manusia) alih-alih diputuskan diam-diam oleh agen. Sukses: pemindaian yang sama atas run sesudah
perubahan ini tak lagi menemukan laporan `selesai` yang menyimpan asumsi tak tertanya.

## Pendekatan

Dipilih **A — satu jalur tanya, pemutus ditentukan saat pertanyaan muncul.** Prompt tak pernah bercabang
pada status lead; semua keputusan ambigu diajukan sebagai pertanyaan (claude: `AskUserQuestion`; codex:
terminal, bernomor, diakhiri `?`). Gerbang yang sudah ada (`admitAsk` → `leadActive`) memilih lead atau
membiarkannya menunggu manusia (marker + notifikasi + pet + inbox ADR-0142). Nol kode server.

Ditolak: **B** menanam status lead ke prompt saat sesi lahir (basi bila lead di-toggle di tengah sesi →
"wajib manusia" bocor); **C** penegakan server (tolak `<Fase> done` selama ada keputusan terbuka) —
butuh parser laporan & keadaan baru; jadi lanjutan bila pembuktian nyata menunjukkan agen masih lolos.

## Kontrak

- **Agen fase** (`runner/src/phase-agents.ts`): dilarang memutuskan hal ambigu yang mempengaruhi hasil
  (data model, kontrak API, scope, perilaku terlihat pengguna, asumsi yang terpaksa diambil). Bagian wajib
  `Keputusan terbuka:` — daftar tanpa batas (tiap butir pertanyaan bernomor diakhiri `?` + opsi +
  rekomendasi) atau `-`. Ada isinya → `Status: menunggu-keputusan` lalu berhenti; `selesai` hanya sah bila
  `-`. Boleh melapor lagi bila jawaban memunculkan ambiguitas baru. `Pertanyaan untuk manusia:` dicabut.
- **Orchestrator** (`orchestratorClause` langkah 4): keputusan terbuka → tanyakan SEMUA sebelum marker
  fase / fase berikutnya; claude `AskUserQuestion` dipecah per 4, codex satu pesan terminal bernomor
  diakhiri `?`; teruskan jawaban ke subagent yang SAMA; ulangi tanpa batas; bukan percobaan ulang;
  jangan pernah menjawab sendiri. Kalimat "putuskan sendiri" dicabut.
- **Klausa otonomi** (`AUTONOMY_CLAUSE`, `AUTONOMY_CLAUSE_FULL`): satu kalimat cara-bertanya bersama
  (`ASK_ROUTE`) netral-agen — `AskUserQuestion` bila agen punya tool itu, selain itu terminal. `full-control`
  tetap tembus sampai `done` tanpa checkpoint/persetujuan, tetapi bertanya untuk keputusan ambigu.
- **Custom agent** (`handoffClause`, `agentDelegationClause`): bagian `Keputusan terbuka:` + status
  `menunggu-keputusan` yang sama; parent wajib meneruskannya dengan cara yang sama. Invarian "roster
  kosong → string kosong" tetap.

## Konsekuensi yang diterima

Sesi scheduler `full-control` dengan lead mati bisa **tertahan** menunggu manusia. Pertanyaan yang sudah
menunggu saat lead baru dinyalakan tetap ke manusia (lead dipicu event `PreToolUse`/`Stop` yang baru).
Pertanyaan teks biasa dari **claude** tak terbaca lead (ADR-0146) — karena itu klausa menyuruh claude
memakai `AskUserQuestion`.

## Pengujian

Test runner: agen fase, orchestrator (claude & codex, pemecahan per 4, tanpa kata "maksimal"),
klausa otonomi dua mode, custom agent & delegasi. Test kontrak lintas modul di server: pertanyaan codex
berformat kontrak (>4 butir) → `readCodexTurn(...).asking === true`. Golden prompt diperbarui sadar.
