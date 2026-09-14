# Orkestrasi subagent per fase — design

Status: approved 2026-09-14 · diimplementasikan lewat [plan](../plans/2026-09-14-orkestrasi-subagent-fase.md).
[ADR-0164](../../../internal/docs/adr/0164-orkestrasi-subagent-per-fase.md) mengikat. Terkait: [ADR-0024](../../../internal/docs/adr/0024-sesi-interaktif-menggantikan-run.md),
[ADR-0035](../../../internal/docs/adr/0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md),
[ADR-0058](../../../internal/docs/adr/0058-model-effort-per-fase.md),
[ADR-0061](../../../internal/docs/adr/0061-model-effort-per-sesi-picker-start.md),
[ADR-0094](../../../internal/docs/adr/0094-custom-agent-katalog-materialisasi-native.md),
[ADR-0113](../../../internal/docs/adr/0113-registry-metode-workflow.md),
[ADR-0159](../../../internal/docs/adr/0159-custom-agent-native-terukur-terisolasi.md).

## Latar

Hari ini satu sesi backlog = satu proses agen dengan satu model/effort (ADR-0061). Fase adalah
giliran di dalam proses itu. Operator ingin sesi interaktif menjadi **orchestrator**, dan setiap
fase dikerjakan **subagent** yang model & effort-nya disetel per fase dari Settings, terlihat di
sel terminal.

ADR-0058 pernah memberi model per fase lewat agen yang mengetik `/model` di batas fase, lalu
dicabut ADR-0061: peralihannya bergantung kerja sama agen, server tak bisa menegakkannya, dan
`/effort` diabaikan di Opus. Desain ini tidak mengulangnya. Model & effort tiap fase **terkunci di
definisi subagent native saat sesi lahir** (jalur argv yang sama andalnya dengan ADR-0061), dan
setiap delegasi meninggalkan bukti `SubagentStart`/`SubagentStop` (ADR-0159). Yang tersisa
bergantung pada agen hanyalah "orchestrator mendelegasikan", dan pelanggarannya terlihat di UI.

Kedua runtime mendukung ini secara native (terverifikasi dokumentasi 2026-09-14): Claude Code
menerima `model`/`effort` per agen di `--agents`, subagent boleh bersarang 3 lapis (v2.1.219+),
dan subagent bisa dilanjutkan dengan konteks utuh lewat `SendMessage` (v2.1.191+); Codex menerima
`model`/`model_reasoning_effort` per role di `config_file`, plus `send_input`/`resume_agent`.
Terpasang di mesin ini: claude 2.1.270, codex 0.154.0.

## Pengukuran fondasi (2026-09-14)

Diukur dengan parent SENGAJA berbeda dari anak (claude 2.1.270, codex 0.154.0), dicatat juga di ADR-0164:

| # | Yang diukur | Hasil |
|---|---|---|
| P1 | claude `--agents` tanpa kunci `tools` | Subagent mendapat seluruh tool sesi dan memanggil skill `superpowers:verification-before-completion`. |
| P2 | claude parent Haiku/low, agen Sonnet/medium | stdin `subagentStatusLine`: `model: claude-sonnet-5`, `effort: medium`; `SubagentStop.effort.level = medium`. |
| P3 | claude `SendMessage` ke agent ID | Subagent yang sama dilanjutkan dengan konteks utuh; `SubagentStart` menembak ulang dengan `agent_id` SAMA. |
| P4 | stdin `subagentStatusLine` | `tasks[]` = `id, type:"local_agent", label/description, startTime (ms), model, effort?, tokenCount` — **tanpa nama agen**. |
| P5 | codex parent Sol/medium, role Luna/low via `config_file` | Rollout anak `gpt-5.6-luna` + `reasoning_effort: low`; rollout parent nol `luna`. |
| P6 | codex `spawn_agent` + `send_input` | Skill tersedia di anak; pesan susulan dijawab dari konteks yang sama. |

## Keputusan operator

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Cakupan | Saklar **per flow**, default **aktif**; model/effort bisa disetel per fase |
| 2 | Runtime subagent | **Ikut orchestrator** — dua matriks (claude, codex) |
| 3 | Model orchestrator | **Picker Start** yang sudah ada; sel fase kosong = warisi orchestrator |
| 4 | Tampilan | Chip `PhaseStrip` diperkaya **+** `subagentStatusLine` di TUI claude |
| 5 | Subagent gagal | **Ulang sekali, lalu eskalasi**; orchestrator tak pernah mengerjakan fase |
| 6 | Pendekatan | **Agen fase di-generate** saat sesi lahir (bukan baris `CustomAgent`, bukan spawn per fase) |
| 7 | Fase interaktif | **Relay ke subagent yang sama** (lanjutkan dengan konteks utuh) |

## Kontrak

### 1. `Setting.orchestration`

Blok baru di `Setting.data` (Json) — **tanpa migration**, pola `conflict`/`goal`. `setting` tak
ada di `FIELDS` sync, jadi lokal per mesin seperti model/effort hari ini.

```ts
const zPhaseCell = z.object({
  model:  z.string().nullable().default(null),   // null = warisi orchestrator
  effort: z.string().nullable().default(null),   // null = warisi orchestrator
});
const zFlowOrchestration = z.object({
  enabled: z.boolean().default(true),
  claude:  z.record(z.string(), zPhaseCell).default({}),   // kunci = nama fase PIPELINES
  codex:   z.record(z.string(), zPhaseCell).default({}),
});
// Satu kunci per Flow, masing-masing .default({}) → flow baru kelak lahir aktif.
export const zOrchestration = z.object({
  feature: zFlowOrchestration.default({}), qa: zFlowOrchestration.default({}),
  scaffold: zFlowOrchestration.default({}), reverse: zFlowOrchestration.default({}),
  prd: zFlowOrchestration.default({}), audit: zFlowOrchestration.default({}),
  breakdown: zFlowOrchestration.default({}), goal: zFlowOrchestration.default({}),
  no_effort: zFlowOrchestration.default({}),
});
```

Lenient seperti `model`/`effort` akar: `z.string()`, kunci fase tak dikenal diabaikan, katalog
ditegakkan UI. Baris `Setting` lama tanpa blok ini tetap parse.

### 2. Resolusi rencana fase

Satu fungsi murni bebas zod di `shared/src/orchestration.ts` (pola `method-catalog.ts`, diimpor
runner/server/UI):

```ts
resolvePhasePlan({ flow, runtime, method, orchestration, orchestrator: { model, effort },
                   nativeAgents: boolean }): PhasePlan | null
type PhasePlan = { phases: { phase: string; agentName: string; model: string; effort: string }[] }
```

1. `!orchestration[flow].enabled` **atau** `!nativeAgents` → `null`.
2. Untuk tiap fase `PIPELINES[flow]`, baca sel dari kolom `runtime`.
3. `model = sel.model ?? orchestrator.model`; `effort = sel.effort ?? orchestrator.effort`, lalu
   **dikoersi ke model hasil resolusi** (`coerceClaudeEffort` / `coerceCodexEffort`).
4. `agentName = "hanoman-fase-" + slug(phase)` — huruf kecil, non-alnum → `-`, dirapatkan
   (`Doc index` → `doc-index`, `Konvensi & index` → `konvensi-index`). Unik di dalam satu flow.

Rencana dihitung **setiap kelahiran sesi** (start, continue, resume) oleh pemanggil yang sama yang
merakit prompt. Dari satu objek rencana itu pemanggil merakit **tiga** hal sekaligus dan
menyerahkannya ke `createSession`: `opts.prompt` (prompt orchestrator), `opts.phaseAgents`
(`AgentDef[]` agen fase), dan `opts.legacyPrompt` (prompt mode tunggal dari input yang sama). Prompt
dan roster tak mungkin berselisih, dan fallback §6 tak perlu merakit ulang apa pun. Tidak ada stempel di `Spec.payload`:
mengubah Settings memengaruhi sesi berikutnya, bukan sesi berjalan (sejalan ADR-0061).

`nativeAgents` = runtime sanggup subagent native: claude selalu; codex bila client terdeteksi
`>=0.151.0` (gerbang yang sama dengan ADR-0159). Sesi ber-`opts.command` tak pernah diorkestrasi.

### 3. Agen fase

`runner/src/phase-agents.ts` merakit `AgentDef` ber-`kind: "phase"` dari rencana + konteks
kelahiran (flow, brief spec/project, metode, verifyScope, lampiran, slug prd/breakdown).

**Instruksi** = potongan prompt yang HARI INI ada di prompt sesi, dipindah apa adanya ke fase
pemiliknya:

| Fase | Isi yang ikut |
|---|---|
| Semua | `METHODS[method].phaseSkills[fase]`; `extraClause` metode; "checkpoint review skill bukan titik berhenti" |
| Fase terakhir flow penulis-kode | `exitSkills` (gerbang `writesCode` yang sama) |
| Fase kerja (`WORK_PHASES`) | `verifyScopeClause`, `CODE_STYLE_CLAUSE` |
| Execute | Gerbang plan `- [ ]` → `- [x]` di `planDir` |
| Audit (qa) | Keputusan pasca-Audit ADR-0040 → **rekomendasi** di laporan, bukan marker |
| Audit/Laporan (audit) | `auditOnlyInstruction` + `ESCALATION_CONTRACT` di Laporan |
| Fase reverse/scaffold/prd/breakdown | Baris panduan fase itu dari `REVERSE_PHASE_GUIDE`, `SCAFFOLD_PHASE_GUIDE`, panduan PRD/breakdown |
| Docs teknis, Konvensi & index, Doc index | `REVERSE_STANDARD` (hanya fase penulis docs) |
| Verifikasi (goal) | Klausa "Verifikasi bukan formalitas" |
| Brainstorm, Objective, Spec (feature) · Spec (qa) | Panduan pendek BARU — lihat bawah |

Di flow feature, Objective & Spec hari ini hanya keluaran skill brainstorming, tanpa panduan
sendiri. Sebagai fase terpisah mereka mengerjakan **satu dokumen spec yang sama** di `specDir`:
Brainstorm menulis konteks & keputusan, Objective menambah objective terukur + kriteria sukses,
Spec melengkapi arsitektur, kontrak, dan acceptance EARS. Di flow qa, Spec menulis dokumen spec
yang sama dari dokumen audit. Serah-terima lewat berkas. Scaffold (Brainstorm, Objective) dan prd
(Brainstorm) tak butuh panduan baru — `SCAFFOLD_PHASE_GUIDE` dan panduan PRD sudah ada.

**Larangan tertulis:** jangan menulis `$HANOMAN_PHASE_FILE`; jangan push; jangan bertanya ke
manusia (kembalikan pertanyaan lewat laporan); jangan memanggil agen `hanoman-fase-*`.

**Laporan** = kontrak serah-terima ADR-0159 (`Status: selesai | sebagian | terhalang`, bukti,
keyakinan, scope belum diperiksa) + `Artefak:` (path) + `Pertanyaan untuk manusia:` (opsional,
satu pertanyaan) + `Rekomendasi fase:` (opsional, mis. jalur cepat qa).

**Commit:** agen fase meng-commit artefaknya sendiri. Push milik orchestrator.

**Tools — pengecualian sadar atas gotcha 5 ADR-0094.** `DEFAULT_AGENT_TOOLS` tak memuat `Skill`,
dan renderer selalu memancarkan `tools` eksplisit → agen fase akan kehilangan skill tanpa satu pun
galat. Agen fase karena itu dirender **tanpa kunci `tools`** (mewarisi seluruh tool sesi: `Skill`,
`Agent`, MCP), tanpa read-only hook, tanpa `maxTurns`. Batas loop: agen fase tak ada di graf
mention; kedalaman native claude (3 lapis); codex `agents.max_depth=3` eksplisit saat sesi
diorkestrasi; larangan tertulis di atas. `agentPromptOf` (klausa "TIDAK boleh mendelegasikan" saat
`mentions` kosong) **tidak** dipakai untuk `kind: "phase"`.

**Nama dicadangkan:** route custom agent menolak nama berawalan `hanoman-fase-` (400), supaya agen
operator tak bisa menimpa agen fase di registry native yang berkunci nama.

### 4. Prompt orchestrator

Bila `phasePlan` ada, `phaseInstruction` dan `skillInstruction` diganti `orchestratorClause(plan)`,
dan seluruh instruksi *cara* mengerjakan fase (tabel §3) tidak dirakit ke prompt parent. Yang
tetap: kepala flow, konteks backlog/project, lampiran, klausa otonomi, `resumeClause`, detail goal,
aturan commit/push, dan klausa delegasi agen kustom yang sudah ada. Berlaku di semua pembangun:
`startPrompt`, `continuePrompt`, `resumePrompt`, `startGoalPrompt`, `startProjectPrompt`,
`startPrdPrompt`, `startBreakdownPrompt`, `startScaffoldPrompt`.

Loop per fase:

1. Panggil `hanoman-fase-<slug>` (claude `Agent`, codex `spawn_agent`) dengan **blok serah-terima
   tetap**: `Fase <n>/<total> · flow · backlog/project`, objective, base SHA, path artefak fase
   sebelumnya, keputusan manusia sejauh ini, `INDEX.md` lampiran bila ada, `Percobaan <k>/2`.
2. `Status: selesai` + bukti → orchestrator menulis `echo "<Fase> done" >> "$HANOMAN_PHASE_FILE"`.
   **Satu-satunya penulis marker.** Flow project: push sesudah tiap marker; flow backlog: push
   sesudah fase terakhir (aturan hari ini).
3. `sebagian`/`terhalang`/galat → delegasi ulang **sekali** ke agen yang sama, laporan gagal
   disertakan. Gagal lagi → berhenti dan `AskUserQuestion` (hanoman-lead/inbox). Berlaku juga di
   sesi scheduler full-control: kegagalan delegasi dikecualikan dari "jangan bertanya".
4. `Pertanyaan untuk manusia` → tanyakan (lihat §5), lalu **lanjutkan subagent yang sama**
   (`SendMessage` ke agent ID / `send_input`) dengan jawabannya. Giliran relay bukan percobaan.
5. Orchestrator **dilarang** mengerjakan fase sendiri.

### 5. Kasus khusus

| Kasus | Perilaku |
|---|---|
| Jalur cepat qa (ADR-0040) | Laporan Audit memuat `Rekomendasi fase: jalur-cepat \| penuh` + alasan; jalur cepat → orchestrator menulis `Spec skipped`, `Plan skipped`, lanjut Execute |
| Lanjutan audit (`fromAudit`) | Orchestrator menulis `Audit skipped` sendiri — melewati bukan pekerjaan, tanpa subagent |
| Continue (SPEC-172) | Rencana satu fase: Execute |
| Resume (SPEC-394) | Orchestrator menerima `resumeClause`, loop mulai dari `r.next`; agen fase tak berubah |
| Goal / no_effort | Goal → Verifikasi / Kerjakan. Hook `Stop` goal (claude) & goal gate (codex) tetap di orchestrator — keduanya menilai seluruh sesi; selesainya subagent memicu `SubagentStop`, bukan `Stop` |
| Pertanyaan keputusan (sesi manual backlog) | Orchestrator `AskUserQuestion` → relay jawaban. Full-control: orchestrator memutuskan sendiri (klausa hari ini) |
| Fase interaktif (Wawancara reverse, Brainstorm prd & scaffold) | Subagent mengajukan SATU pertanyaan per laporan; orchestrator menampilkannya di terminal seperti hari ini, menunggu jawaban, relay ke subagent yang sama |

### 6. Materialisasi, roster & gerbang

- `createSession` merender agen kustom + agen fase dalam **satu** lintasan renderer yang ada
  (`--agents` JSON / TOML codex), temp dir `0700`, hook, sandbox bind yang sama.
- **All-or-nothing untuk agen fase:** satu agen fase gagal dirender/ditulis → seluruh rencana
  dibatalkan, sesi lahir mode tunggal dengan prompt lama, peringatan stderr. Agen kustom tetap
  dilewati per agen (ADR-0159). Pembatalan terjadi di `createSession` **sebelum** berkas prompt
  ditulis: ia menulis `opts.legacyPrompt` alih-alih `opts.prompt`, membuang `opts.phaseAgents`, dan
  tak memasang `@hanoman_orchestrated` maupun `subagentStatusLine`.
- `SessionAgentMeta` + `phase?`, `effort?` (effort hasil koersi). Opsi tmux baru
  `@hanoman_model`, `@hanoman_effort`, `@hanoman_orchestrated`.
- Sesi claude ber-rencana: `--settings` menambah `subagentStatusLine` →
  `node <tempDir>/subagent-statusline.cjs <tempDir>/subagent-models.json`; label dari deskripsi pemanggilan
  `Fase <Nama Fase>` (stdin tak membawa nama agen), model & effort dari task itu sendiri. Codex: tanpa padanan.
- Argv & prompt flow yang saklarnya mati **byte-identik** dengan sebelum spec ini.

### 7. Bukti & data realtime

- **Migration** `AgentInvocation` + `phase String?`, `effort String?`. Satu-satunya perubahan
  skema; LOCAL-only seperti sebelumnya (tak masuk `FIELDS` sync).
- Route `session-events` mengambil `phase`/`effort` dari roster tepercaya (bukan payload child),
  menyimpannya, lalu memicu siaran ulang frame `phase` sesi itu.
- `pty.ts` tetap nol dependensi DB: status live datang dari **sumber invocation yang mendaftarkan
  diri** (`registerPhaseInvocationSource`, pola `registerCustomAgentSource` ADR-0094 §7). Frame
  `phase` saat attach dan sesudah restart server diisi dari sumber yang sama.
- `Phase` (frontend `client.ts`, server `session-phases.ts`) + `agent?: { name, model, effort,
  status, startedAt, durationMs, attempts, tokens, evidence }`. `attempts` = jumlah
  `runtimeInvocationId` berbeda untuk fase itu (resume memakai id yang sama → idempoten).
- `evidence`: `ok` bila ada invocation; `missing` bila fase `done` (bukan `skipped`), tanpa
  invocation, dan sudah ≥60 detik sejak server pertama melihat marker-nya (tenggang relay spool);
  selain itu `pending`.
- `GET /api/custom-agents/metrics` mengecualikan baris ber-`phase` — telemetri fase milik terminal,
  bukan presisi katalog agen.

### 8. Tampilan

**Settings → tab "Orkestrasi"** (sebelah "Model sesi"). Satu kartu per flow: `Switch` enabled +
dua kolom (Claude Code | Codex CLI), tiap baris fase dua `Select`: model (`— warisi orchestrator` +
katalog runtime) dan effort (`— warisi` + `effortsForRuntimeModel`). Ganti model mengoreksi effort
sel (cermin picker Start). Flow mati → kartu diredupkan, matriks tetap tersimpan. Salinan "matrix
per-fase dicabut" di tab Model sesi (`SettingsScreen.tsx`) diganti tautan ke tab ini.

**Modal Start** (`StartSessionModal`): picker yang ada berlabel **Orchestrator**; di bawahnya
pratinjau read-only "Fase" dari `resolvePhasePlan`, dihitung ulang tiap runtime/model/effort
berubah. Flow mati → "Orkestrasi mati untuk flow ini — sesi tunggal"; codex terlalu tua → "Codex
<0.151 — sesi tunggal".

**Sel terminal.** Header: chip `orch <model> · <effort>` bila `orchestrated`. `PhaseStrip` jadi chip:

| State | Chip |
|---|---|
| selesai | `✓ Spec · Opus 5 · high · 1m12s` |
| berjalan | `● Plan · Opus 5 · high · 0:42` (berdetak) |
| menunggu | `○ Execute · Opus 5 · xhigh` |
| dilewati | ~~`Spec`~~ `dilewati` |
| diulang | badge `↻2` |
| bukti hilang | `⚠` — "bukti subagent tak diterima" (bukan "tidak didelegasikan": hook fail-open, nol invocation bukan bukti tak dipakai) |
| terputus | `abandoned` dari rekonsiliasi boot |

Sel sempit: hanya chip aktif yang penuh, lainnya ikon + nama; strip bergulir horizontal di dalam
barisnya. Klik/tap chip → popover: model, effort, status, durasi, percobaan, token in/out/cache
terpisah (tak dijumlahkan), cuplikan hasil. Label model dari katalog `MODELS`/`CODEX_MODELS`.

**TUI claude:** skrip statusline menulis ulang baris subagent jadi `Fase Spec · Opus 5 · high ·
1m12s`; agen kustom ikut (`scout · Sonnet 5 · medium`). Skrip gagal → baris bawaan claude.

## Di luar cakupan

- Override matriks per sesi di modal Start (pratinjau saja).
- Override per project.
- Runtime berbeda per fase (butuh titik spawn baru — ditolak ADR-0094/SPEC-448).
- Metrik/presisi per fase di layar Agents.
- Sesi tanpa fase: lead, konflik, changelog, portal, cron, Telegram, terminal biasa, konsol VPS.

## Acceptance (EARS)

- **AC-1** — THE `Setting` SHALL memuat `orchestration` dengan `enabled: true` untuk setiap Flow
  secara default, dan baris lama tanpa blok itu SHALL tetap parse.
- **AC-2** — WHERE `orchestration[flow].enabled` mati, THE argv dan prompt sesi flow itu SHALL
  byte-identik dengan sebelum spec ini, untuk semua pembangun prompt.
- **AC-3** — WHEN sesi ber-flow aktif lahir, THE runtime SHALL menerima satu agen native
  `hanoman-fase-<slug>` per fase dengan model/effort hasil `resolvePhasePlan`.
- **AC-4** — WHERE sel fase kosong, THE agen fase SHALL mewarisi model/effort orchestrator, dan
  effort SHALL dikoersi ke model hasil resolusi.
- **AC-5** — THE prompt orchestrator SHALL tak memuat skill fase maupun panduan fase, dan THE
  definisi agen fase SHALL memuatnya.
- **AC-6** — THE agen fase SHALL dirender tanpa kunci `tools` sehingga `Skill` tersedia.
- **AC-7** — IF satu agen fase gagal dimaterialisasi, THEN THE sesi SHALL lahir mode tunggal dengan
  prompt lama dan peringatan.
- **AC-8** — IF runtime codex terdeteksi `<0.151.0` atau tak terdeteksi, THEN THE sesi SHALL lahir
  mode tunggal dan modal Start SHALL menyebut alasannya.
- **AC-9** — WHEN `SubagentStart`/`SubagentStop` agen fase diterima, THE `AgentInvocation` SHALL
  menyimpan `phase` dan `effort` dari roster, dan THE frame `phase` sesi itu SHALL disiarkan ulang.
- **AC-10** — WHILE sebuah fase berjalan, THE chip fase SHALL menampilkan model, effort, dan durasi
  berjalan; WHEN selesai, THE chip SHALL menampilkan durasi akhir dan jumlah percobaan bila >1.
- **AC-11** — IF fase tercatat `done` tanpa invocation selama ≥60 detik, THEN THE chip SHALL
  menampilkan ⚠ "bukti subagent tak diterima".
- **AC-12** — WHERE runtime claude dan sesi diorkestrasi, THE `--settings` SHALL memuat
  `subagentStatusLine`; WHERE runtime codex, SHALL tidak.
- **AC-13** — THE route custom agent SHALL menolak nama berawalan `hanoman-fase-` dengan 400.
- **AC-14** — THE modal Start SHALL menampilkan pratinjau fase read-only yang berubah mengikuti
  pilihan runtime/model/effort orchestrator.
- **AC-15** — THE metrik custom agent SHALL mengecualikan invocation ber-`phase`.

## Verifikasi dan batas

**Test (TDD per unit):**
- `shared` orchestration — flow mati/`nativeAgents` false → `null`; warisi; koersi claude & codex;
  kunci fase asing diabaikan; semua Flow default aktif; setiap fase `PIPELINES` punya entri; slug.
- `runner/test/phase-agents.test.ts` — skill per fase untuk superpowers & matt; `exitSkills` hanya
  fase terakhir flow penulis-kode; gerbang `- [ ]` di Execute; `REVERSE_STANDARD` hanya fase
  penulis docs; larangan; tanpa kunci `tools`.
- `runner/test/prompt.test.ts` — byte-identitas saat `phasePlan = null` untuk kedelapan pembangun;
  prompt orchestrator bebas skill/panduan fase; aturan ulang/eskalasi/marker/relay hadir; varian
  resume/continue/goal.
- Server (pola `custom-agents.pty.test.ts`) — roster memuat `phase`/`effort`; all-or-nothing;
  codex tua → mode tunggal; statusline hanya claude; opsi tmux baru. Route `session-events` —
  menyimpan `phase`/`effort`, memicu siaran. Route custom agent — nama tercadang 400. Metrics —
  pengecualian. Migration & DMMF.
- Frontend RTL — tab Orkestrasi (saklar, warisi, koersi), pratinjau modal Start, chip semua state
  termasuk ⚠ dan sel sempit.

Resep run di mesin bersesi banyak: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <paths>`.

**Smoke live** (claude 2.1.270, codex 0.154.0; dicatat di ADR-0164). Setiap butir dibuktikan dengan
menanyai agen atau membaca bukti, **bukan exit code** (ADR-0094 gotcha 1):
1. Agen fase benar-benar memuat skill (`Skill` tersedia, skill metode ter-invoke).
2. Model/effort agen fase benar-benar terpakai (`AgentInvocation.model`, stdin statusline
   `model`/`effort`, `/tasks`).
3. Agen Execute memanggil `scout` (sarang dua lapis).
4. Relay `SendMessage` ke subagent yang sama mempertahankan konteks (fase Wawancara).
5. Hook `Stop` goal tidak terpicu oleh selesainya subagent.
6. Codex: `spawn_agent` role dengan model/effort, `send_input`, `agents.max_depth`.
7. `subagentStatusLine` tampil dengan field agen yang benar (`type` vs `name`).

**API nyata:** boot server, curl `PUT /settings` (blok orchestration), `POST /terminal/sessions`
(backlog feature), `POST /api/session-events` (Start/Stop agen fase), cek frame `phase`.

**Batas yang diterima sadar:**
- Delegasi tetap kepatuhan orchestrator; yang dijamin adalah model/effort **saat** didelegasikan dan
  **terlihatnya** pelanggaran (⚠), bukan bahwa pelanggaran mustahil.
- Tiap fase mulai dengan konteks segar → biaya token bisa naik (membaca ulang artefak & docs).
- Default aktif mengubah perilaku semua flow sesudah upgrade, termasuk `no_effort` yang satu fase.
- Bila smoke 1, 4, atau 6 gagal, spec ini kembali ke operator sebelum execute dilanjutkan — ketiganya
  fondasi, bukan detail.

## Urutan implementasi

1. `shared` orchestration: skema `Setting.orchestration` + `resolvePhasePlan`.
2. `runner`: potongan prompt diekspor per fase, `phase-agents.ts`, `orchestratorClause` di kedelapan
   pembangun.
3. Server: `opts.phasePlan` di pemanggil sesi, materialisasi all-or-nothing, roster/tmux, statusline,
   nama tercadang.
4. Bukti: migration `AgentInvocation`, route `session-events`, sumber invocation, frame `phase`,
   pengecualian metrics.
5. Frontend: tab Orkestrasi, pratinjau Start, chip `PhaseStrip`, chip header.
6. Smoke live + ADR-0164 + docs tersentuh (`architecture/data-model.md`, `architecture/api-contract.md`,
   `frontend/frontend-implementation.md`, `internal/skills/hanoman/SKILL.md` — kalimat "satu
   model/effort per sesi").
