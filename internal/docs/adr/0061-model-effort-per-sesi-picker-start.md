# ADR-0061 — Model & effort per sesi (picker saat Start), mencabut matrix per-fase

**Status:** accepted · **Date:** 2026-07-20 · **Spec:** SPEC-252
**Terkait:** [ADR-0058](0058-model-effort-per-fase.md) (mencabut mekanisme per-fase-nya),
[ADR-0024](0024-sesi-interaktif-menggantikan-run.md) (sesi = satu proses), [ADR-0015](0015-one-session-per-backlog.md)
(satu backlog satu sesi), [ADR-0035](0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md) (sesi menembus
batas fase), [ADR-0003](0003-per-step-model-selection.md) (*tetap de-facto obsolete*)

## Context
ADR-0058 (SPEC-238) menghidupkan **model & effort per fase**: sesi lahir dengan config fase pertama
(argv `--model`/`--effort`, andal), lalu **agen** disuruh mengetik `/model`+`/effort` di batas tiap fase.

QA SPEC-252 (severity major) melaporkan mekanisme itu **tak berpindah otomatis saat sesi sudah running —
agen tak mengalihkan sendiri**. Investigasi (audit SPEC-252) menemukan itu memang perilaku yang diharapkan
dari desainnya, bukan bug lepas: peralihan per-fase **bergantung penuh pada kerja sama agen** di dalam band —
padahal `AUTONOMY_CLAUSE` justru menyuruh agen **menembus batas fase tanpa berhenti**, server **tak pernah
menegakkan** peralihan (tak ada jalur server→PTY), dan `/effort` diabaikan di Opus/Fable. Efektifnya model
menetap di nilai saat lahir seumur hidup sesi, sementara matrix per-fase memberi **ekspektasi palsu** bahwa ia
berpindah per fase.

Operator memutuskan: jadikan model & effort **per sesi**, bukan per fase — ditetapkan sekali saat lahir
(jalur argv yang andal), dipilih **per sesi** saat Start.

## Decision
1. **Cabut matrix per-fase.** `phaseModels` dihapus dari `zSetting`; `resolvePhaseModels`/`phaseModelInstruction`
   di `runner/src/prompt.ts` dan `phaseModelsForFlow` di `server/src/services/settings.ts` dibuang. Prompt sesi
   **tak lagi** memuat blok instruksi `/model`+`/effort` per-fase. Sesi tetap **satu proses** dengan **satu**
   model/effort seumur hidup — konsisten ADR-0024/0015.
2. **Model & effort dipilih per sesi saat Start** (per-instance override). `POST /terminal/sessions` untuk
   backlog item menerima field opsional `{ spec, flow, model?, effort? }`. UI Backlog Start menampilkan picker
   model & effort **ter-prefill dari setting global**; nilai terpilih dikirim di body. Sesi di-spawn dengan
   `--model`/`--effort` itu (jalur argv saat lahir → **andal penuh**, termasuk effort di Opus/Fable).
3. **Setting global tetap = default sesi baru.** `model`/`effort` di `zSetting` bertahan sebagai fallback saat
   body tak menyertakan override (`model ?? global`, `effort ?? global`). `phaseModels` yang hilang tak memaksa
   migration — ia hidup di `Setting.data` (Json); baris lama yang masih memuatnya **tetap parse** (z.object
   non-strict membuang key asing), tanpa membuat layar Settings kosong.
4. **`MODELS`/`EFFORTS`** tetap diekspor `@hanoman/shared` (dipakai picker Start + kartu global Settings).
   Server tetap lenient (`model`/`effort` = `z.string()`), daftar valid hidup di UI.
5. **Cakupan.** Picker per-instance ada di **Backlog Start** (App). Flow project-level (reverse/scaffold/prd)
   dan quick-pick backlog di TerminalScreen memakai **default global** — picker per-instance adalah fitur
   Backlog Start; memperluasnya ke jalur project-level ditunda sampai diminta (YAGNI).

## Alternatif ditolak
- **Global-saja tanpa picker.** Menyelesaikan keandalan (sesi selalu lahir dengan global) tapi **bukan
  "per sesi"** — operator minta granularitas memilih model tiap sesi. Ditolak.
- **Server menyuntik `/model` ke PTY sesi yang sedang running.** Menjawab "ganti saat sudah running" secara
  harfiah, tapi **menghidupkan kembali** orkestrasi server + keandalan-bergantung-agen yang justru dicabut di
  sini; "per sesi = ditetapkan sekali saat lahir" jauh lebih sederhana & andal. Ditolak (bisa jadi follow-up
  bila kebutuhan mengganti sesi berjalan muncul nyata).
- **Pertahankan per-fase + penegakan server (respawn/inject terdeteksi transisi).** Membalik ADR-0024/0015
  (satu sesi = satu proses, live tmux attach). Ditolak — sama seperti alternatif yang sudah ditolak ADR-0058.

## Consequences

**Amandemen 2026-09-05:** `MODELS` dan `CODEX_MODELS` menjadi snapshot runtime dengan fallback
bawaan. CLI memasok model/effort baru tanpa rilis Hanoman; Settings menghitung pilihan saat
render. Pilihan default dan sesi berjalan tidak diganti oleh discovery.
Lihat [katalog model otomatis](../architecture/model-catalog.md).

- Operator memilih model/effort tiap memulai sesi backlog; andal karena argv saat lahir (tak bergantung agen).
- Tanpa perubahan skema Prisma — `phaseModels` dihapus dari skema **zod**, bukan tabel; baris lama tetap parse.
- Kontrak API `POST /terminal/sessions` bertambah field **opsional** `model`/`effort` pada varian spec-flow;
  aditif & wire-compatible (klien lama yang tak mengirimnya tetap dapat default global).
- Prompt sesi menyusut (blok per-fase hilang); regresi nol untuk sesi yang dulu seragam.
- **Mengamandemen ADR-0058**: mekanisme model/effort per-fase dicabut. Nilai `MODELS`/`EFFORTS` dan sikap
  "satu proses per sesi" tetap. ADR-0003 tetap de-facto obsolete.

## Acceptance (EARS)
- **AC-1** — WHEN operator menekan Start sebuah backlog item, THE UI SHALL menampilkan picker model & effort
  ter-prefill dari setting global.
- **AC-2** — WHEN Start dikonfirmasi dengan model/effort terpilih, THE `POST /terminal/sessions` SHALL
  menyertakannya dan sesi SHALL di-spawn dengan `--model`/`--effort` itu.
- **AC-3** — WHERE body `POST /terminal/sessions` tak menyertakan `model`/`effort`, THE sesi SHALL lahir dengan
  model/effort global.
- **AC-4** — THE prompt sesi SHALL tak memuat instruksi `/model`+`/effort` per-fase (dicabut).
- **AC-5** — THE baris `Setting` lama yang masih memuat `phaseModels` SHALL tetap parse (field diabaikan),
  tanpa membuat layar Settings kosong.
- **AC-6** — THE layar Settings SHALL tak lagi menampilkan matrix per-fase; kartu default global (model/effort)
  tetap ada.
