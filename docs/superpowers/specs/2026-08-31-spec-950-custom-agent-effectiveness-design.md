# SPEC-950 — Custom agent efektif, terisolasi, terukur, dan native di kedua runtime

Tanggal: 2026-08-31
Status: diimplementasi; verifikasi final 2026-08-31 (lihat ADR-0159)
Pendahulu: SPEC-450 (ADR-0094) · SPEC-484 (ADR-0101) · SPEC-881 (ADR-0136) · SPEC-909 (ADR-0146)
ADR yang lahir dari spec ini: **ADR-0159**

## Masalah

Katalog delapan custom agent Hanoman sudah dipakai nyata, tetapi "tersedia" belum sama dengan
"efektif". Audit atas katalog, runtime, basis data hidup, dan transcript sesi menemukan empat
keadaan yang berbeda:

1. `scout`, `blast-radius`, dan `security-reviewer` berulang kali mengembalikan temuan yang
   memperbaiki hasil sesi. Prosedur, gerbang bukti, dan bentuk laporannya bernilai.
2. `qa-verifier` pernah memodifikasi source di worktree induk selama belasan menit; satu berkas
   probe bahkan ikut masuk commit agen utama lewat `git add -A`. Ini insiden, bukan risiko teoretis.
3. Claude menerima subagent native lewat `--agents`, sedangkan Codex hanya menerima ±7 KB roster
   prosa lalu disuruh mengadopsi peran inline. Codex karena itu tak memperoleh isolasi konteks,
   paralelisme, model per agen, atau lifecycle invocation.
4. Tak ada telemetry first-class. Pemakaian harus dihitung dari transcript terminal, test hanya
   menjaga seed/serialisasi, dan tidak ada precision, recall, durasi, biaya, atau disposition.

Kemampuan runtime sudah berubah sejak ADR-0094 diukur pada Codex 0.146. Codex 0.151.0 yang ada di
mesin pengembangan membawa `multi_agent` dan `hooks` berstatus stabil. Dokumentasi resmi runtime
kini menetapkan custom agent TOML, `agents.<name>.config_file`, `SubagentStart`, dan
`SubagentStop`. Claude Code 2.1.251 juga membawa lifecycle hook yang sama serta field `isolation`,
`maxTurns`, `permissionMode`, `effort`, dan `hooks` pada JSON `--agents`.

## Objective

Custom agent Hanoman menjadi subagent native di Claude dan Codex, agen bawaan aktif tidak dapat
mengotori worktree induk, pemilihan dan biaya agen mengikuti pekerjaan yang sedang dilakukan,
setiap invocation meninggalkan telemetry yang dapat dinilai manusia, dan prompt bawaan mempunyai
evaluation set terhadap kegagalan historis.

## Yang bukan objective

- Bukan menghidupkan kembali CLI flow/headless Agent SDK yang dicabut ADR-0010/0024. Eval live
  adalah developer harness opt-in; pekerjaan produk tetap sesi interaktif di tmux.
- Bukan menambah guardrail perintah global. ADR-0037 tetap utuh; batas ini khusus subagent yang
  menyatakan dirinya read-only atau isolated.
- Bukan menjamin angka token jika runtime tidak memancarkannya. Parser transcript bersifat
  best-effort dan menyimpan `null`, bukan mengarang nol.
- Bukan menjalankan semua eval di test rutin. Test deterministik menguji renderer, scorer, dan
  fixture; invokasi model live harus diminta eksplisit karena memakai waktu dan kuota.
- Bukan menyimpan transcript subagent penuh di SQLite. Transcript tetap milik runtime; telemetry
  hanya menyimpan metadata dan excerpt terbatas.
- Bukan menjadikan agen penulis paralel sebagai default. Agen write-heavy tetap opt-in dan harus
  memakai worktree terisolasi.

## Keputusan yang mengikat

| Pertanyaan | Keputusan |
|---|---|
| Jalur Codex | Native custom agents lewat TOML sementara + override `-c agents.\"name\".*` |
| Lokasi materialisasi | Direktori temp sesi ber-mode `0700`; nol file di repo dan home operator |
| Roster prompt Codex | Dihapus; prompt hanya membawa daftar ringkas + aturan dispatch |
| QA bawaan | Default mati, termasuk upgrade aman bagi row seed yang belum disunting |
| Agen aktif bawaan | `scout`, `blast-radius`, `security-reviewer`; semuanya read-only |
| Policy eksekusi | `activation`, `effort`, `workspacePolicy`, `maxTurns`, `timeoutSeconds` |
| Aktivasi bawaan | `smart`; custom agent operator default `always` |
| Concurrency | Maksimum 3 subagent terbuka per sesi Codex; prompt Claude melarang lebih dari 3 |
| Telemetry | Model LOCAL-only `AgentInvocation`, lifecycle dari hook runtime |
| Penilaian | Disposition manusia + agregat precision; eval fixture memberi recall/control rate |
| Data sensitif | Excerpt hasil maksimum 4 KiB, path transcript tidak dikirim ke client |

## 1. Profil eksekusi custom agent

### Kontrak data

`CustomAgent` bertambah lima kolom yang ikut sync:

```prisma
activation     String @default("always")
effort         String?
workspacePolicy String @default("inherit")
maxTurns       Int?
timeoutSeconds Int?
```

Nilai sah:

```ts
type AgentActivation = "always" | "smart";
type AgentWorkspacePolicy = "inherit" | "read-only" | "isolated-worktree";
```

- `effort`: `null` mewarisi sesi; nilai dipilih dari irisan katalog runtime efektif.
- `maxTurns`: `null` mewarisi runtime; selain itu integer `1..200`.
- `timeoutSeconds`: `null` tanpa batas Hanoman; selain itu `30..3600`.
- `isolated-worktree` hanya sah untuk `runtime: "claude"`. Codex belum mempunyai worktree
  terpisah per custom subagent; menerima nilai itu lalu diam adalah kegagalan senyap.
- `read-only` berlaku lintas runtime dan tidak hanya mengandalkan `sandbox_mode`, sebab live
  override parent Codex dapat menang atas default custom agent. Renderer mencabut tool mutasi dan
  memasang `PreToolUse` hook validator pada local-shell serta `apply_patch`.
- `inherit` mempertahankan perilaku custom agent lama.

`model` yang sudah ada tetap menjadi override per agen. Builtin yang `runtime:null` memperoleh
rekomendasi model per runtime dari katalog konstanta; override operator selalu menang:

| Agen | Claude | Codex | Effort |
|---|---|---|---|
| `scout` | `haiku` | `gpt-5.6-terra` | `low` |
| `blast-radius` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `security-reviewer` | `sonnet` | `gpt-5.6` | `high` |
| `spec-auditor` | `sonnet` | `gpt-5.6-terra` | `high` |
| `dep-auditor` | `haiku` | `gpt-5.6-terra` | `medium` |
| `root-causer` | `sonnet` | `gpt-5.6` | `high` |
| `qa-verifier` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `edge-case-hunter` | `sonnet` | `gpt-5.6` | `high` |

Model rekomendasi hanya dipakai bila tersedia di katalog runtime saat itu; bila hilang, renderer
tidak memancarkan model dan runtime mewarisi parent. Katalog yang menua tidak boleh mematikan sesi.

### Makna read-only

Read-only adalah kontrak observable:

- tool `Write`, `Edit`, dan `Task`/delegasi dicabut;
- local shell hanya menerima bentuk baca yang dipahami validator: `rg`, `git diff/show/status/log`,
  `sed`, `head`, `tail`, `wc`, dan `ls`, tanpa redirect, command substitution, pipeline ke proses
  penulis, atau operator pengubah state;
- `apply_patch` dan tool MCP yang tidak dapat dibuktikan read-only ditolak;
- Claude sekaligus menerima `permissionMode:"plan"`; Codex menerima
  `sandbox_mode:"read-only"`. Keduanya lapis tambahan, bukan satu-satunya pagar;
- penolakan hook mengembalikan alasan singkat kepada subagent dan tidak mematikan parent.

Validator berupa modul murni `runner/src/agent-readonly.ts`; hook command ditulis ke berkas JS
sementara bersama materialisasi sesi. Tidak bergantung pada `jq`, Python, atau binary global
Hanoman. Test mengeksekusi script terhadap payload hook nyata kedua runtime, bukan memeriksa teks.

### QA

`qa-verifier` berubah dari default aktif menjadi default mati. Upgrade hanya mematikan row bila:

1. id-nya `global:qa-verifier`;
2. isi row masih cocok dengan fingerprint seed yang terakhir dipasang;
3. marker migration policy belum pernah diterapkan.

Row yang sudah disunting operator tidak disentuh. Perubahan ini adalah satu-satunya pengecualian
terhadap keputusan ADR-0136 bahwa upgrade seed tak pernah mengubah `enabled`; alasannya insiden
mutasi worktree sudah terbukti.

Instruksi QA tetap diperbaiki untuk pemakaian opt-in:

- ia tidak pernah mengubah worktree tempat parent berjalan;
- mutation relevance hanya boleh dilakukan di worktree sementara yang dibuat dari `baseSha`;
- patch test diterapkan ke worktree sementara, bukan source parent;
- sebelum keluar, ia menghapus worktree sendiri dan melaporkan bila cleanup gagal;
- bila prasyarat base SHA atau test patch tidak tersedia, hasilnya `belum terbukti`, bukan mencoba
  kontrol di parent.

Untuk Claude, profile QA memakai `isolated-worktree`, `maxTurns:40`, dan timeout 15 menit. Untuk
Codex, builtin QA tidak dimaterialisasi sampai Codex menyediakan isolasi worktree per subagent;
row tetap terlihat di katalog dengan alasan ketidaktersediaan runtime pada response turunan.

## 2. Materialisasi native

### Claude

`renderAgentsJson()` memancarkan field yang didukung `--agents`:

```ts
{
  description, prompt, tools, model?, effort?, permissionMode?,
  maxTurns?, isolation?, hooks?
}
```

`read-only` memasang tool hasil filter + permission mode + validator hook. `isolated-worktree`
memasang `isolation:"worktree"`. `timeoutSeconds` masuk ke instruksi dan telemetry; Claude tidak
menyediakan timeout wall-clock native per subagent.

### Codex

`agentRosterBlock()` dihapus. Untuk setiap definisi sesi, Hanoman menulis satu TOML `0600`:

```toml
name = "scout"
description = "..."
developer_instructions = """..."""
model = "gpt-5.6-terra"
model_reasoning_effort = "low"
sandbox_mode = "read-only"
```

Argumen parent mendapat pasangan berikut per agen:

```text
-c agents."scout".description="..."
-c agents."scout".config_file="/tmp/hanoman-.../scout.toml"
```

Nama selalu dikutip sebagai TOML dotted key karena builtin memakai tanda hubung. Nilai melewati
renderer TOML, bukan interpolasi shell. `agents.enabled=true` dan
`agents.max_concurrent_threads_per_session=3` dipasang satu kali bila roster tidak kosong.

Prompt parent menerima `agentDelegationClause()` yang runtime-aware. Untuk Codex ia menyebut
custom agent sebagai target `spawn_agent`; untuk Claude sebagai target `Agent`/`Task` sesuai
runtime. Isinya hanya nama + deskripsi + trigger, bukan full instructions.

Materialisasi kosong menjaga argv dan prompt byte-identik dengan perilaku tanpa custom agent.
Kegagalan menulis satu config membuat agen itu dilewati dan direkam sebagai event materialization
error; kelahiran sesi tetap fail-open seperti ADR-0094.

## 3. Aktivasi smart

Pemilihan menerima konteks sesi, bukan hanya `(projectId, agent)`:

```ts
type AgentSelectionContext = {
  projectId: string;
  runtime: Agent;
  flow?: Flow;
  cwd: string;
  baseSha?: string;
  prompt?: string;
  changedFiles: string[];
};
```

`changedFiles` diturunkan satu kali saat sesi lahir melalui `git diff --name-only <baseSha>...HEAD`
dan working-tree diff. Kegagalan git menghasilkan `[]`, tidak menggagalkan sesi.

Custom agent `activation:"always"` selalu ikut bila enabled dan runtime cocok. Builtin
`activation:"smart"` memakai aturan konstanta:

| Agen | Dipilih ketika |
|---|---|
| `scout` | flow mempunyai Plan/Execute/Audit, atau sesi project tanpa diff |
| `blast-radius` | flow mempunyai Execute/Audit, atau sudah ada changed files |
| `security-reviewer` | flow Execute/Audit dan diff/prompt menyentuh route, handler, auth, CLI, config reader, filesystem, atau external input |
| `spec-auditor` | flow mempunyai Plan/Execute dan agen ini diaktifkan operator |
| `dep-auditor` | manifest/lockfile berubah dan agen ini diaktifkan operator |
| `root-causer` | flow Audit dan agen ini diaktifkan operator |
| `qa-verifier` | flow Execute, ada diff test/production, runtime mendukung isolasi, dan diaktifkan operator |
| `edge-case-hunter` | flow Execute, runtime Claude, workspace policy isolated, dan diaktifkan operator |

Untuk sesi Execute yang lahir sebelum diff dibuat, `blast-radius` tetap ikut karena fase mendatang
membutuhkannya. Security reviewer hanya ikut tanpa diff bila objective/prompt mengandung penanda
permukaan eksternal yang eksplisit. Policy memilih konservatif: false negative lebih mahal daripada
satu deskripsi tambahan, tetapi full instructions tidak lagi hidup di prompt parent Codex.

Response Custom Agent membawa field turunan `available` dan `availabilityReason` untuk menjelaskan
mengapa sebuah agen enabled tidak masuk runtime tertentu. Field itu bukan kolom sync.

## 4. Telemetry invocation

### Model lokal

```prisma
model AgentInvocation {
  id                  String   @id
  sessionId           String
  projectId           String
  specId              String?
  runtime             String
  runtimeInvocationId String
  customAgentId       String?
  agentName           String
  model               String?
  status              String
  startedAt           DateTime
  endedAt             DateTime?
  durationMs          Int?
  inputTokens         Int?
  outputTokens        Int?
  cachedTokens        Int?
  resultExcerpt       String?
  resultHash          String?
  workspaceChanged    Boolean  @default(false)
  disposition         String   @default("pending")
  dispositionNote     String?
  evaluatedAt         DateTime?

  @@unique([sessionId, runtimeInvocationId])
  @@index([agentName, startedAt])
  @@index([sessionId, startedAt])
}
```

Model LOCAL-only, tidak masuk `SYNCED`, `FIELDS`, atau `PG_ORDER`. Ia tidak memakai FK:
SessionHistory dapat dipangkas dan CustomAgent dapat dihapus, sementara bukti historis harus tetap
terbaca. `customAgentId` hanya soft-link.

Status: `running | completed | interrupted | abandoned`. Saat boot, invocation `running` yang
parent session-nya tidak hidup ditutup sebagai `abandoned`.

Disposition: `pending | accepted | partial | rejected | false-positive`. Hanya admin cookie yang
bisa mengubah disposition; AgentToken read-only hanya boleh membaca agregat bila kelak route-nya
masuk MCP.

### Lifecycle

`guardSettings()` dan `codexHookArgs()` memasang `SubagentStart`/`SubagentStop` ke pengirim event
yang sama dengan SPEC-909. Endpoint `/api/session-events` membedakan union:

- event AskUserQuestion lama → `intakeAsk`, perilaku byte-identik;
- `SubagentStart` → create/upsert invocation;
- `SubagentStop` → tutup invocation, hitung durasi, hash dan potong excerpt;
- event lain → `202 {ignored:true}`.

Identitas sesi tetap berasal dari header HMAC, bukan body. `agent_type` harus cocok roster sesi;
subagent builtin runtime yang bukan CustomAgent Hanoman diabaikan. Start/stop idempoten karena
unique `(sessionId,runtimeInvocationId)`.

Token parser membaca transcript subagent hanya bila path berada di bawah direktori runtime yang
diizinkan dan berukuran di bawah 10 MiB. Parser mengenali field usage JSON yang diketahui; bentuk
asing menghasilkan `null`. Path transcript tidak disimpan dan tidak pernah dikirim ke browser.

`workspaceChanged` diturunkan dari snapshot `git status --porcelain=v1 -z` pada start dan stop.
Snapshot disimpan sebagai hash sementara in-memory; perubahan hash berarti true. Kegagalan git
berarti `false` + event telemetry warning, bukan klaim worktree bersih.

### API dan UI

```text
GET   /api/custom-agents/metrics?projectId=&from=&to=
      -> { agents: AgentMetricView[], recent: AgentInvocationView[] }
PATCH /api/custom-agents/invocations/:id
      { disposition, note? } -> AgentInvocationView
```

Route cookie-admin only karena excerpt bisa memuat detail internal. Daftar recent berplafon 100;
excerpt maksimum 4 KiB dan note maksimum 500 karakter.

Panel Custom Agent menampilkan pada tiap kartu:

- invocation 30 hari;
- median durasi dan token yang benar-benar tersedia;
- accepted/partial/rejected/false-positive;
- operational precision = `(accepted + partial) / seluruh disposition non-pending`;
- lencana merah bila pernah `workspaceChanged`;
- lima invocation terbaru dengan kontrol disposition.

Tidak ada angka `0 token` bila datanya tidak tersedia; UI menulis `—`.

## 5. Evaluation set

`evals/custom-agents/` berisi manifest dan fixture repo mini. Minimal satu kasus positif dan satu
kontrol negatif untuk setiap builtin; kasus pertama berasal dari kelas insiden audit:

| Agen | Kasus positif utama |
|---|---|
| `scout` | tipe/payload kembar antar-paket yang tak ditemukan satu pencarian nama |
| `blast-radius` | daftar field manual tertinggal setelah kontrak berubah |
| `security-reviewer` | endpoint terautentikasi tanpa ownership check |
| `qa-verifier` | test baru tetap hijau pada base tanpa implementasi |
| `root-causer` | dua hipotesis, hanya satu dibedakan eksperimen |
| `edge-case-hunter` | duplicate delivery/idempotency yang belum diuji |
| `spec-auditor` | acceptance criterion tercentang tanpa jejak di diff |
| `dep-auditor` | dependensi baru menduplikasi kemampuan runtime |

Setiap manifest membawa:

```ts
type AgentEvalCase = {
  id: string;
  agentName: string;
  task: string;
  expected: { id: string; patterns: string[] }[];
  forbidden: { id: string; patterns: string[] }[];
  fixtureDir: string;
  source: string;
};
```

Harness `pnpm agent:eval --runtime claude|codex [--agent name]`:

1. menyalin fixture ke direktori `mktemp`, menginisialisasi git, dan membuat diff yang ditentukan;
2. materialisasi definisi memakai renderer produk yang sama;
3. menjalankan CLI model secara opt-in, tanpa tmux dan tanpa menyentuh repo sumber;
4. menyimpan report JSON ke direktori temp/output yang diminta, bukan ke source tree;
5. scorer murni menghitung recall expected dan forbidden-hit rate dari pola manifest;
6. exit code nonzero bila expected recall <100% atau ada forbidden hit.

Harness tidak dijalankan oleh postinstall, server boot, test rutin, atau CI. Unit test menjalankan
scorer terhadap output fixture yang dibekukan dan membuktikan kontrol merah/hijau tanpa LLM.

Operational precision dari telemetry dan eval recall adalah dua ukuran berbeda; UI tidak
menggabungkannya menjadi satu "quality score" palsu.

## 6. Error handling dan kompatibilitas

- Migration ditulis tangan dan `prisma generate` dijalankan sesudahnya.
- Field CustomAgent baru masuk `FIELDS.customAgent`; nilai asing dari sync dinormalisasi ke default
  aman, tetapi route tulis menolak nilai asing.
- Hub/client versi lama mengikuti aturan sync compatibility existing; perubahan schema dirilis
  bersama migration sebelum field baru ditulis.
- Katalog kosong tetap melahirkan sesi dengan argv/prompt lama.
- Codex yang tidak mendukung native agents membuat renderer mengembalikan warning dan tidak
  menempel roster inline. Hanoman `doctor` melaporkan minimum runtime, bukan berpura-pura native.
- Hook server mati selalu fail-open untuk kelangsungan subagent. Telemetry hilang lebih baik
  daripada pekerjaan macet.
- Event stop tanpa start membuat invocation sintetis dengan `startedAt=endedAt` dan status
  `completed`; durasi `null`. Ini menutup restart server di tengah invocation tanpa mengarang waktu.
- Excerpt dibersihkan dari ANSI dan dipotong berdasarkan byte UTF-8 tanpa memecah code point.

## Acceptance criteria

1. **WHEN** sesi Codex lahir dengan custom agent **THEN** argv SHALL membawa config role native,
   prompt SHALL tidak membawa full instructions, dan `/agent`/runtime SHALL melihat nama agen.
2. **WHEN** roster kosong **THEN** prompt dan argv SHALL byte-identik dengan sebelum SPEC ini.
3. **WHEN** agen ber-policy read-only mencoba `apply_patch`, redirect shell, atau perintah mutasi
   git **THEN** hook SHALL menolak sebelum efek terjadi.
4. **WHEN** builtin aktif dimaterialisasi **THEN** `scout`, `blast-radius`, dan
   `security-reviewer` SHALL read-only dan tidak membawa Write/Edit.
5. **WHEN** instalasi lama mempunyai `qa-verifier` seed yang belum disunting **THEN** boot pertama
   sesudah upgrade SHALL mematikannya tepat sekali; row operator-edited SHALL tidak berubah.
6. **WHEN** smart activation mengevaluasi dependency diff **THEN** `dep-auditor` SHALL tersedia
   hanya bila enabled dan manifest/lockfile berubah.
7. **WHEN** lifecycle start/stop diterima dua kali **THEN** hanya satu AgentInvocation SHALL ada.
8. **WHEN** invocation berhenti **THEN** durasi, excerpt/hash, workspaceChanged, dan token yang
   tersedia SHALL tersimpan; token yang tak tersedia SHALL `null`.
9. **WHEN** admin memberi disposition **THEN** agregat precision SHALL berubah sesuai rumus dan
   note tersimpan; agent token/klien SHALL tidak dapat menulisnya.
10. **WHEN** server restart meninggalkan invocation running tanpa parent hidup **THEN** reconcile
    SHALL menandainya abandoned.
11. **WHEN** eval scorer menerima output yang kehilangan expected finding atau memuat forbidden
    finding **THEN** ia SHALL gagal deterministik tanpa invokasi model.
12. **WHEN** harness live dijalankan **THEN** semua pekerjaan SHALL terjadi di temp repo dan source
    worktree SHALL tetap byte-identik.
13. **WHEN** perubahan selesai **THEN** test tersentuh SHALL hijau serial dengan DB terisolasi,
    typecheck paket tersentuh SHALL hijau, dan sesi Claude serta Codex nyata SHALL diverifikasi.

## Dokumen yang diperbarui bersama implementasi

- `internal/docs/adr/0094-custom-agent-katalog-materialisasi-native.md` — tandai keputusan Codex
  inline dicabut ADR-0159.
- `internal/docs/adr/0136-agen-bawaan-sistem-seed-idempoten.md` — pengecualian safety-disable QA.
- `internal/docs/adr/0159-custom-agent-native-terukur-terisolasi.md` — keputusan baru.
- `internal/docs/adr/README.md` dan `internal/docs/README.md` — tautan dua tingkat.
- `internal/docs/architecture/data-model.md` — field profile + AgentInvocation.
- `internal/docs/architecture/api-contract.md` — metrics dan disposition.
- `internal/docs/operations/agent-documentation-workflow.md` — policy, telemetry, eval, dan smoke.
- `internal/skills/hanoman/SKILL.md`, `AGENTS.md`, dan `CLAUDE.md` bila gotcha runtime/test baru
  perlu dibawa ke setiap sesi.

## Alternatif yang ditolak

### Tetap roster prosa Codex

Ditolak karena tidak memberikan context isolation, lifecycle, model/sandbox per agen, atau
parallelism. Ia juga membakar prompt untuk instruksi yang mungkin tidak dipakai.

### Menulis `.codex/agents` ke repo atau `~/.codex/agents`

Ditolak karena mengotori project/operator, bertabrakan dengan definisi milik user, dan membuat
cleanup bergantung sesi berakhir normal. Config temp + override argv mempunyai scope tepat satu
sesi dan sudah menjadi pola `--agents` Claude.

### Menjalankan setiap agen sebagai proses Hanoman sendiri

Ditolak karena menghidupkan kembali runtime headless/Agent SDK yang dicabut ADR-0010/0024,
menambah titik spawn baru, dan membayar ulang autentikasi, sandbox, PTY, serta lifecycle.

### Telemetry dari scraping terminal

Ditolak sebagai sumber utama karena capture-pane bukan event log, teks bisa berubah antar versi,
dan Codex inline tidak punya invocation yang dapat dibedakan. Transcript hanya fallback token
best-effort setelah lifecycle native memberi identitas stabil.

### Menyebut read-only lewat prompt saja

Ditolak karena insiden QA membuktikan instruksi bukan batas write. Tool filter dan hook validator
harus menang sebelum efek filesystem.
