# ADR-0164 — Orkestrasi subagent per fase: model & effort lewat definisi subagent

- Status: Accepted
- Tanggal: 2026-09-14
- Spec: [rancangan orkestrasi subagent per fase](../../../docs/superpowers/specs/2026-09-14-orkestrasi-subagent-fase-design.md)
- Terkait: **mengamandemen** [0061](0061-model-effort-per-sesi-picker-start.md) — model/effort sesi kini
  model/effort **orchestrator**; **tidak menghidupkan kembali** [0058](0058-model-effort-per-fase.md) —
  tak ada `/model` yang diketik agen; **memperluas** [0094](0094-custom-agent-katalog-materialisasi-native.md)
  & [0159](0159-custom-agent-native-terukur-terisolasi.md) — renderer, hook, roster, dan `AgentInvocation`
  dipakai untuk agen fase; **menegakkan** [0024](0024-sesi-interaktif-menggantikan-run.md) &
  [0015](0015-one-session-per-backlog.md) — tetap satu sesi tmux per backlog; **mengubah pelaksana**
  [0035](0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md) & [0040](0040-jalur-cepat-qa-dielicit-prompt.md) — batas fase
  ditembus orchestrator, keputusan jalur cepat qa jadi rekomendasi agen Audit.

## Konteks

Operator ingin setiap fase flow (mis. brief: Brainstorm → Objective → Spec → Plan → Execute) dikerjakan
model & effort yang berbeda, disetel dari Settings, dengan sesi utama sebagai orchestrator. ADR-0058
pernah mencobanya lewat agen yang mengetik `/model`+`/effort` di batas fase dan dicabut ADR-0061:
peralihannya bergantung kepatuhan agen, server tak bisa menegakkannya, `/effort` diabaikan di Opus.

Kedua runtime kini punya subagent native ber-model/effort per definisi. Diukur 2026-09-14 (claude
2.1.270, codex 0.154.0), dengan parent SENGAJA berbeda dari anak:

| # | Yang diukur | Hasil |
|---|---|---|
| P1 | claude `--agents` tanpa kunci `tools` | Subagent mendapat seluruh tool sesi dan memanggil skill `superpowers:verification-before-completion`. |
| P2 | claude parent Haiku/low, agen Sonnet/medium | stdin `subagentStatusLine`: `model: claude-sonnet-5`, `effort: medium`; `SubagentStop.effort.level = medium`. |
| P3 | claude `SendMessage` ke agent ID | Subagent yang sama dilanjutkan dengan konteks utuh; `SubagentStart` menembak ulang dengan `agent_id` SAMA. |
| P4 | stdin `subagentStatusLine` | `tasks[]` = `id, type:"local_agent", label/description, startTime (ms), model, effort?, tokenCount` — **tanpa nama agen**. |
| P5 | codex parent Sol/medium, role Luna/low via `config_file` | Rollout anak `gpt-5.6-luna` + `reasoning_effort: low`; rollout parent nol `luna`. |
| P6 | codex `spawn_agent` + `send_input` | Skill tersedia di anak; pesan susulan dijawab dari konteks yang sama. |

## Keputusan

1. **`Setting.orchestration`** (Json, tanpa migration): saklar per flow default **aktif** + matriks
   `claude`/`codex` × fase; sel `null` mewarisi model/effort orchestrator (picker Start). Resolver murni
   `resolvePhasePlan` (`@hanoman/shared`) dipakai server dan pratinjau Start; effort dikoersi ke model
   hasil resolusi.
2. **Agen fase di-generate saat sesi lahir** (`buildPhaseAgents`), bernama `hanoman-fase-<slug>`, bukan
   baris `CustomAgent`: tak disync, tak masuk katalog, tak masuk graf mention. Instruksinya potongan prompt
   mode tunggal yang dipindah ke fase pemiliknya. Awalan `hanoman-fase-` dicadangkan di skema custom agent.
3. **Agen fase dirender tanpa kunci `tools`** — pengecualian sadar atas gotcha 5 ADR-0094 (P1): tanpa itu
   agen fase kehilangan `Skill` tanpa galat. Batas loop: kedalaman native claude (3 lapis), `agents.max_depth=3`
   codex, larangan tertulis memanggil `hanoman-fase-*`.
4. **Prompt orchestrator** hanya membawa kontrak delegasi: deskripsi pemanggilan `Fase <Nama Fase>` (P4),
   blok serah-terima tetap, orchestrator satu-satunya penulis `$HANOMAN_PHASE_FILE`, ulang **sekali** lalu
   `AskUserQuestion` (juga di sesi full-control), relay pertanyaan ke subagent yang SAMA (P3/P6), dilarang
   mengerjakan fase sendiri. **Live smoke 2026-09-14** (orchestrator Haiku 4.5/low) menemukan header blok
   `Fase <n>/<total>: <Nama Fase>` bersebelahan dengan instruksi deskripsi membuat model menyalin header
   sebagai deskripsi, dan langkah tulis `$HANOMAN_PHASE_FILE` bukan gerbang wajib sehingga terlewat sebelum
   commit/push — klausa diperkuat: header jadi `Urutan: <n>/<total> · <Nama Fase>` (deskripsi kalimat
   terpisah, eksplisit BUKAN baris pertama blok), dan penulisan berkas fase jadi tindakan wajib pertama
   (diverifikasi `tail -1`) sebelum fase berikutnya/commit/push, dengan gerbang penutup yang menolak
   commit final sebelum SEMUA fase tercatat `done`/`skipped`.
5. **All-or-nothing**: satu agen fase gagal dimaterialisasi (atau codex < 0.151) → sesi lahir mode tunggal
   dengan prompt lama yang dirakit pemanggil dari input yang sama. Flow mati → argv & prompt byte-identik
   (golden test).
6. **Bukti**: `AgentInvocation.phase`/`effort` (satu migration, LOCAL-only); effort stop dari payload
   runtime. Frame `phase` WS terminal diperkaya status/durasi/percobaan/token; `evidence: missing` sesudah
   60 dtk tanpa invocation dilabeli "bukti subagent tak diterima". Metrik custom agent mengecualikan baris
   ber-`phase`.
7. **Tampilan**: tab Settings "Orkestrasi" (`Switch` `aria-label` `Orkestrasi <flow>` per kartu), pratinjau
   fase di modal Start (`Memuat rencana fase…` sampai Setting — dan bila codex, versi codex — termuat;
   tanda per bagian ` (warisi)`/` (model warisi)`/` (effort warisi)`), chip `PhaseStrip` (strip menggulir
   horizontal, panel detail dibatasi tinggi badan sel) + chip orchestrator di header sel,
   `subagentStatusLine` claude `label · model · effort · durasi · token`.

## Alternatif ditolak

- **Seed baris `CustomAgent` per fase** — ±60 baris tersync, instruksi beku terhadap ganti metode, pengaturan
  pindah ke layar Agents.
- **Server spawn satu sesi tmux per fase** — tanpa orchestrator, membalik ADR-0024/0015; ditolak dua kali.
- **Runtime berbeda per fase** (claude memanggil `codex exec`) — titik spawn baru, ditolak ADR-0094/SPEC-448.
- **Orchestrator mengerjakan fase interaktif sendiri** — melanggar "setiap fase oleh subagent"; relay P3/P6 cukup.

## Konsekuensi

- Delegasi tetap kepatuhan orchestrator; yang dijamin model/effort **saat** didelegasikan dan **terlihatnya**
  pelanggaran, bukan kemustahilannya. Terukur 2026-09-14: orchestrator lemah (Haiku 4.5/low) melewatkan
  penulisan `$HANOMAN_PHASE_FILE` sama sekali sebelum gerbang di atas ditambahkan — Opus 5/medium pada sesi
  pembanding yang sama menulisnya benar. Klausa yang lebih ketat mengurangi risiko ini, tak menghapusnya;
  operator sebaiknya tetap memilih model orchestrator yang cukup mampu, bukan mengandalkan prompt saja.
- Tiap fase mulai dengan konteks segar → biaya token bisa naik; serah-terima lewat berkas.
- Default aktif mengubah perilaku semua flow sesudah upgrade, termasuk `no_effort`.
- `pty.ts` tetap nol dependensi DB: invocation disuntik lewat `setPhaseInvocations`.
