# Data model

Entitas inti (**SQLite via Prisma 6** — SPEC-398/[ADR-0086](../adr/0086-sqlite-satu-satunya-provider.md);
satu berkas di `$HANOMAN_HOME`, default `~/.hanoman/hanoman.db`, tanpa Docker/Postgres).
**Tujuh model inti**: Project, Spec, Setting, Notification, User,
Session, Vps — plus model pendukung (VpsAuditSnapshot/VpsItemState, DeviceToken, **AgentToken**,
**ClientProjectAccess** (SPEC-617), SessionResult, SyncLog,
LocalBinding, SyncOutbox, SyncState, SyncConflict, **SyncTombstone** (SPEC-799), RuntimeConfig) dan **model Help Center**
(`Ticket`, `TicketAttachment`, SPEC-253/[ADR-0062](../adr/0062-help-center-tiket-publik-triase.md)).
Tidak ada model `Run` maupun `Trigger` — keduanya di-drop saat pindah ke sesi interaktif (ADR-0024; migrasi
`drop_run_trigger_github`). **Model error monitoring** (`ErrorGroup`, `ErrorEvent`, `SourceMapArtifact`) dan
**relasi antar project** (`ProjectLink`) juga tak ada lagi — dicabut SPEC-384/[ADR-0092](../adr/0092-cabut-error-monitoring-sdk-cross-audit.md)
bersama error monitoring & cross-audit (migrasi `drop_errors_sdk_crossaudit`). Enum
stage/source/priority/ticket-status/ticket-category disimpan sebagai `String` dan divalidasi zod di
`@hanoman/shared` (`enums.ts`), bukan enum Prisma.

**Provider & migrasi.** Riwayat 32 migrasi Postgres diganti satu init SQLite
(`20260730000000_init_sqlite`) — migrasi lama tak bisa di-*replay* di SQLite, dan jalan pindah bagi
data lama bukan riwayat migrasi melainkan `hanoman migrate-from-postgres --from <pg-url>` (26 model
dalam urutan FK yang diverifikasi terhadap DMMF Prisma; `--dry-run` menghitung tanpa menyentuh
target). Skema **tak memakai `@map`** sama sekali, jadi nama kolom DB = nama field Prisma — properti
itulah yang membuat baris `SELECT *` dari Postgres langsung cocok sebagai data `createMany`. Yang
tidak didukung SQLite dan karena itu **tidak boleh masuk** skema ini: scalar list (`String[]` non-relasi),
tipe native `@db.*`, `Decimal`, `Bytes`, dan `mode: "insensitive"` pada filter (`LIKE` SQLite sudah
case-insensitive untuk ASCII).

**DB test adalah berkas per checkout**, bukan database bersama: `<db>.test.db` diturunkan dari
`DATABASE_URL` dan dimigrasi **otomatis** oleh `server/test/global-setup.ts` (hapus berkas →
`migrate deploy`) — tak ada lagi `migrate deploy` manual untuk DB test yang bisa dilupakan, dan
worktree tetangga tak bisa lagi men-*truncate* DB test milik run lain. `--no-file-parallelism` tetap
**wajib**: berkas test dalam satu paket server masih berbagi **satu** berkas DB yang di-seed ulang
tiap berkas.

## Project
- `id` (slug) — **renameable lewat operasi khusus** `POST /projects/:id/rename { newId }` (SPEC-255/ADR-0064,
  mencabut sebagian invariant "kekal" SPEC-146). Kunci asing `Spec`/`Ticket` **sudah**
  `ON UPDATE CASCADE` **dan** `ON DELETE CASCADE` (bawaan Prisma → cascade otomatis, tanpa migration); referensi
  longgar (`Notification/SessionResult/TicketAttachment`) + `LocalBinding` di-update manual dalam
  transaksi rename. Id **tetap tak tersentuh** oleh
  `PATCH`/`zUpdateProject`. Rename merambat ke hub sync (penanda `renamedFrom`) → URL Help `/help/<id>`
  (derived) ikut berganti. Guard: 409 bila id baru terpakai / ada sesi aktif.
- `name`, `desc` — label tampilan; dapat diubah lewat `PATCH /projects/:id` (SPEC-146) dan boleh
  menyimpang dari `id`. Tak ada jalur git/worktree/filesystem yang membacanya.
- `kind` ("from-scratch" | "existing"), `repoDir?` (absolut, OPSIONAL; path default/server, editable via
  `PATCH /projects/:id` — SPEC-217; **tak disync**), `stack` (default "")
- Untuk `kind: "from-scratch"` dengan `repoDir` diisi, `POST /projects` meng-`git init` direktori itu
  (+ commit awal) agar langsung runnable oleh sesi scaffold (SPEC-222/ADR-0052).
- **`LocalBinding`** (`projectId → repoDir`, per-mesin, **LOCAL-ONLY tak disync**): override path. `resolveRepoDir`
  = `binding ?? Project.repoDir` (null-safe), dipakai SELURUH jalur baca (spawn/IDE/coverage/branches/specs/docs).
  Editable via `PUT /projects/:id/binding`, dikosongkan via `DELETE` (SPEC-213/217).
- `createdAt`
- `helpEnabled` (Boolean, default false · SPEC-253 · [ADR-0062](../adr/0062-help-center-tiket-publik-triase.md)) —
  flag opt-in Help Center publik. Link publik `/help/<id>` menerima keluhan HANYA bila aktif. Additive;
  diekspos di `toProjectView` sebagai `helpEnabled`.
- `schedulerOptIn` (Boolean, default false · SPEC-294 · [ADR-0072](../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md)) —
  gerbang kelayakan **scheduler otonom** (pola `helpEnabled`). Project non-opt-in tak pernah disentuh source
  checker. Additive; diekspos `toProjectView` sebagai `schedulerOptIn`, editable via `PATCH /projects/:id`.
  **Tidak** masuk whitelist `FIELDS` sync → tetap **lokal per-instance** (cermin `helpEnabled`).
- `leadOptIn` (Boolean, default false · SPEC-409 · [ADR-0091](../adr/0091-hanoman-lead-agen-pemimpin.md)) —
  gerbang kelayakan **hanoman-lead** (cermin persis `schedulerOptIn`). Project non-opt-in tak pernah
  dijawab, ditata, maupun ditindaklanjuti lead. Additive; diekspos `toProjectView` sebagai `leadOptIn`,
  editable via `PATCH /projects/:id`. **Tidak** masuk whitelist `FIELDS` sync → lokal per-instance.
- `autoMerge` (Json?, SPEC-486 · [ADR-0103](../adr/0103-auto-merge-saat-sesi-selesai.md)) — kebijakan
  **auto-merge saat backlog item selesai**, bentuknya `{mode:"off"|"default-branch"|"branch", dest:"local"|"origin",
  branch:string|null, deleteBranch:boolean}` (`zAutoMerge`, `@hanoman/shared`). `null` = **tanpa
  auto-merge** — default, nol backfill, project lama tak berubah perilaku. `dest`+`branch` memakai
  kosakata target yang sama dengan `POST /specs/:id/integrate` (ADR-0031). Sengaja **satu blok `Json`**,
  bukan empat kolom skalar: ia dibaca utuh, tak pernah difilter/di-`orderBy`, dan empat kolom akan
  mengizinkan keadaan tak masuk akal (`mode:"off"` ber-`branch`) tanpa tipe yang mencegahnya (preseden
  `Setting.conflict` ADR-0081, `Spec.dependsOn` ADR-0093). Diekspos `toProjectView` sebagai `autoMerge`,
  editable via `PATCH /projects/:id` (digerbangi `checkAutoMerge`: 409 tanpa repoDir efektif, 400 branch
  karangan). **Tidak** masuk whitelist `FIELDS` sync → lokal per-instance (nama branch tujuan properti
  checkout mesin ini, cermin `repoDir`); **masuk** allowlist `WEBHOOK_ENTITIES`.
- `docStatus` ("ok" | "drift" | "broken") + `coverage` (0–100) **bukan kolom** — diturunkan dari disk tiap `toProjectView` (ADR-0018).

## Spec (backlog item)
- `id` (SPEC-n), `projectId`, `title`, `source` ("brief" | "qa" | "audit" | "help" | "goal")
  - **`help`** (SPEC-253/[ADR-0062](../adr/0062-help-center-tiket-publik-triase.md)): backlog hasil
    promosi tiket Help Center. `flowForSource("help") = "feature"` (pipeline penuh), payload brief-shaped
    (context berisi keluhan + kategori + pelapor + backlink tiket). Author `Help ·`. Tanpa migration
    (source = String + zod, bukan enum Prisma).
  - **`audit`** (SPEC-237/[ADR-0057](../adr/0057-audit-only-source-flow.md)): audit-only. Flow `audit`
    (pipeline `Audit → Laporan`) hanya menghasilkan **dokumen audit** `internal/docs/research/audit-<spec-id>-<slug>.md`
    — TANPA perbaikan kode. Stage `done` dicapai lewat fase `Laporan` (`REACHED.Laporan="done"`); tak ada
    Plan/Execute, jadi gerbang ADR-0029 tak berlaku. Payload brief-shaped; author berawalan `Audit ·`. Bisa
    dinaikkan jadi Finding QA (source `qa`) lewat "Take ke backlog" (cermin PRD, ADR-0041). Tanpa migration
    (source/flow = String + zod, bukan enum Prisma).
  - **`goal`** (SPEC-407/[ADR-0089](../adr/0089-backlog-goal-flow-dua-fase.md)): backlog yang
    langsung dikejar sesi mode goal. Flow `goal` = pipeline **`Goal → Verifikasi`** — tak ada
    Brainstorm/Objective/Spec/Plan sama sekali. Stage: `Goal` (aktif maupun tercatat) → `executing`,
    `Verifikasi` → `done`. **Payload bentuk ketiga** (`zGoalPayload {goal, done, constraints,
    priority}`), bukan brief-shaped: `goal` wajib dan `Spec.objective` diturunkan darinya. Mode goal
    (ADR-0073) **selalu** menyala untuk flow ini dan kondisinya diturunkan dari item (template
    global `Setting.goal.condition` dilewati; override per-sesi tetap menang). Author berawalan
    `Goal ·`. Gerbang plan ADR-0029 tetap berlaku bila sesi kebetulan menulis plan. Tanpa migration.
- `stage` ("brainstorming" | "objective" | "spec-ready" | "planned" | "executing" | "done").
  Bergerak **maju** hanya lewat fase yang dilaporkan sesi (ADR-0008/0024), **mundur** hanya
  lewat aksi human eksplisit `PATCH /specs/:id { stage }` (backward-only, SPEC-167/ADR-0027).
  Mundur juga membersihkan artefak docs superpowers ber-spec-id fase di atas target
  (`docs/superpowers/specs/*` & `plans/*`); kode/commit Execute tak pernah dihapus.
  `executing` **tertahan** (tak jadi `done`) selama plan `docs/superpowers/plans/**` masih punya
  `- [ ]` (SPEC-173/ADR-0029, `planComplete`).
- `priority` ("tinggi" | "sedang" | "rendah"), `author`, `objective`
- `launchApprovedAt?`/`launchApprovedBy?` (SPEC-761/[ADR-0117](../adr/0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md)) —
  approval durable untuk efek launch. Keduanya **LOCAL-only**: sengaja tidak ada di `FIELDS.spec`,
  `DATE_FIELDS.spec`, feed sync, webhook, atau input record remote. Cookie admin dan AgentToken
  `sessions:write` adalah satu-satunya penulis; scheduler/governor/lead/cron hanya mengonsumsi.
  Migration memberi baris legacy approval `legacy-admin` agar upgrade tidak mematikan backlog lama.
- `payload` (Json?) — brief (context/outcome/constraints), qa (severity/steps/expected/actual/env),
  atau **goal** (goal/done/constraints, SPEC-407). Bentuknya **terikat `source`** di boundary
  (`zCreateSpec.superRefine`, tiga-arah): `qa` ↔ `severity`, `goal` ↔ `goal`, selain itu brief —
  tanpa ikatan itu `deriveSpecFields` bisa menurunkan objective dari bentuk yang salah.
- `branchFrom?` — branch sumber worktree bagi sesi yang lahir dari item ini. `null` = default project
  (`main`). Divalidasi terhadap `refs/heads` repo project; lihat
  [ADR-0032](../adr/0032-branch-adalah-properti-backlog-item.md).
- `baseSha?`/`headSha?` — commit tempat worktree sesi di-detach, dan commit HEAD worktree di akhir sesi.
  Penunjuk, bukan isi: diff/daftar-file review diturunkan dari git saat
  `GET /specs/:id/review` dibaca, tidak pernah dipersist. Lihat [ADR-0019](../adr/0019-sha-disimpan-diff-diturunkan.md) dan [ADR-0030](../adr/0030-spec-menyimpan-base-head-sha.md).
  **SPEC-475 · `headSha` distempel satu penulis bersama `recordHeadSha()` (`services/spec-head.ts`) di
  KETIGA jalur yang mempersist `stage = "done"`** — `DELETE /terminal/sessions/:id` (sebelum
  `removeWorktree`), `scheduler/reconcile.ts`, dan overlay stage-live `live-specs.ts`. Sebelumnya hanya
  jalur DELETE yang menulisnya, sementara penyelesaian OTONOM tak pernah melewatinya (pane sesi sukses
  tak mati sendiri, SPEC-433; `integrate-main` lead melepas pane lewat `killSession` langsung demi
  worktree utuh, SPEC-451) → **159 dari 210** item `done` ber-worktree tak punya ujung kerja tercatat,
  dan gerbang dependency ADR-0093 kehilangan buktinya. `null` **tak pernah ditulis**: HEAD yang tak
  terbaca tak boleh menghapus ujung yang sudah tercatat. `session-launch.ts` tetap me-null-kannya saat
  sesi BARU lahir (bukan saat *melanjutkan*, ADR-0084) — rentang review dimulai ulang bersama basisnya.
- `createdAt`/`startedAt` (SPEC-408/[ADR-0090](../adr/0090-stempel-waktu-backlog-created-started.md)) —
  stempel waktu backlog. `createdAt` NOT NULL ber-`@default(now())`, ditulis DB dan **tak pernah** oleh
  route, sehingga "kapan item difilekan" tak bisa diedit operator. `startedAt` nullable = kapan sesi
  **pertama** lahir; ditulis di titik cekik yang sama dengan `baseSha` (`services/session-launch.ts`,
  cabang `if (!resume)`) sehingga jalur *melanjutkan* ([ADR-0084](../adr/0084-melanjutkan-sesi-backlog.md))
  tak menimpanya — ia berarti "mulai pertama", bukan "sentuhan terakhir". `updatedAt` **bukan**
  penggantinya: mesin sync mem-bump `version` (`publishLocal`/`backfillFeed`) dan overlay stage-live
  menulis kemajuan tiap `GET /specs` dibaca, jadi ia bergerak tanpa ada manusia yang menyentuh item.
  Keduanya menyeberang record-sync (`FIELDS.spec` **dan** `DATE_FIELDS.spec` — tanpa itu spec asal-hub
  mendapat `createdAt` lokal palsu di tiap client, karena `upsert` yang tak menyebut kolom ber-default
  tetap berhasil). Baris pra-migration di-backfill dari `updatedAt` — aproksimasi yang disengaja.
- `doneAt` (SPEC-516/[ADR-0105](../adr/0105-changelog-per-project.md)) — nullable; kapan item
  **pertama** kali masuk stage `done`. Melanjutkan arah ADR-0090 dengan alasan yang sama: waktu
  selesai sebuah baris tak bisa dihitung ulang dari sumber lain, dan `updatedAt` bergerak tanpa ada
  manusia. **Penulisnya SATU** — bukan di ketiga jalur yang mempersist `stage="done"`
  (`advanceStage` · `scheduler/reconcile` · `live-specs`) melainkan **di dalam
  `recordCompletion()`** (`services/notifications.ts`), satu-satunya fungsi yang sudah dipanggil
  ketiganya; menyalin efek samping ke banyak call site adalah kelas bug SPEC-431/448/475.
  **Tulis-sekali** (`updateMany` ber-guard `doneAt: null`) sehingga maknanya "selesai pertama",
  cermin `startedAt` dan cermin idempotensi ADR-0033 — dan **revert stage tidak mengosongkannya**.
  Ikut `FIELDS.spec` **dan** `DATE_FIELDS.spec` (kelas gagal-senyap yang sama seperti
  `createdAt`/`startedAt`). Baris pra-migration di-backfill dari `Notification` ber-key
  `done:<specId>` — stempel yang sudah ada sejak SPEC-180 dan sumber yang sama dengan sweep
  auto-merge ADR-0103; item yang selesai sebelum itu tetap `null` dan **dilaporkan sebagai catatan**
  di hasil changelog, bukan disamarkan.
- `dependsOn` (Json?, SPEC-447/[ADR-0093](../adr/0093-dependency-antar-backlog.md)) — **array id spec**
  yang harus **selesai (`stage=done`) DAN commit-nya sudah ada di branch basis item ini** sebelum
  sesinya boleh diluncurkan. `null`/`[]` = berdiri sendiri; pembaca menormalkannya (`dependsOnOf`,
  defensif — kolom Json menyeberang lewat sync dari client versi lain). Sengaja **kolom, bukan tabel
  join**: SQLite melarang scalar list, `Json` sudah dipakai `payload`, dan kolom ikut `FIELDS.spec`
  apa adanya (**wajib** — tanpa itu client kehilangan urutan dan meluncurkan pekerjaan yang di hub
  terblokir; **bukan** `DATE_FIELDS`). Karena tak ada FK, integritasnya ditegakkan di **boundary
  route**: id harus ada, berada di **project yang sama**, bukan diri sendiri, dan tak membentuk
  **siklus** (reachability atas graf project sesudah perubahan) → 400. `DELETE /specs/:id`
  **mencabut** id itu dari `dependsOn` seluruh dependent-nya; tanpa itu menghapus satu item mengunci
  tetangganya selamanya. `dependsOn` sengaja **di luar** gerbang edit SPEC-186 (`stage=brainstorming
  ∧ baseSha=null`) — ia menggerbangi peluncuran *berikutnya*, bukan konten sesi berjalan.
- `autoMerge` (Json?, SPEC-486 · [ADR-0103](../adr/0103-auto-merge-saat-sesi-selesai.md)) — **override**
  kebijakan auto-merge project untuk item ini; bentuk yang sama persis (`zAutoMerge`). `null` = **warisi
  project**, dan `{mode:"off"}` = matikan auto-merge di item ini saja — dua keadaan yang berbeda, karena
  itu nullable. Resolusinya satu fungsi murni `resolveAutoMerge(project, spec)` (spec menang → project →
  OFF) yang dipakai server **dan** UI. Sengaja **di luar** gerbang edit SPEC-186 seperti `dependsOn`:
  ia menggerbangi apa yang terjadi *sesudah* kerja, bukan konten sesi berjalan. **Tidak** masuk
  `FIELDS.spec` sync (lokal per-instance, cermin `Project.autoMerge`); **masuk** `WEBHOOK_ENTITIES`.
  Kolom nullable tanpa default → spec asal-hub mendarat `null` = warisi project, bukan default palsu
  (jebakan ADR-0090 tak berlaku justru karena nullable).
  **`blockedBy` bukan kolom**: nilai turunan yang dihitung `liveSpecs()` dari `stage` dependency +
  `git merge-base --is-ancestor` (memo 15 dtk), ikut ADR-0018/0019.
- `sourceHistory` (Json?, SPEC-546 · [ADR-0109](../adr/0109-ubah-source-backlog-item.md)) — **jejak
  konversi type** item ini: array append-only `[{ at, from, to, by, payload }]` yang ditulis
  `POST /specs/:id/source`. `null` = belum pernah dikonversi. **Kolom, bukan turunan**, dengan alasan
  yang sama seperti `createdAt`/`doneAt` (ADR-0090): kapan sebuah baris berganti type tak bisa
  dihitung ulang dari sumber mana pun. **`payload` di dalam tiap entri = bentuk LAMA UTUH**, dan itu
  bukan hiasan: konversi antar-bentuk membuang field yang tak punya padanan
  (`convertPayload().dropped`), jadi jejak inilah yang membuat "tanpa kehilangan riwayat" harfiah.
  **Tanpa cap** — cap yang diam-diam membuang mematahkan satu-satunya alasan kolomnya ada; konversi
  adalah tindakan operator manual yang digerbangi flow. **Wajib** ikut `FIELDS.spec` (kelas
  gagal-senyap yang sama dengan `dependsOn`: `upsert` yang tak menyebut kolom tetap berhasil);
  **bukan** `DATE_FIELDS` — `at` hidup di dalam JSON-nya. **Tidak** masuk `WEBHOOK_ENTITIES.fields`,
  karena ia membawa payload dan `payload` memang sudah sengaja dikecualikan dari allowlist itu;
  perubahan `source`-nya sendiri tetap terpancar sebagai `spec.source_changed`.
  **SPEC-475 · "ujung kerja" dependency = `headSha` ?? tip branch sesinya** (`workTip`,
  `hanoman/<sessionIdForSpec(id)>` — nama deterministik per ADR-0032, memo 15 dtk). Yang berarti
  **siap** adalah **tak ada jejak kerja sama sekali**, bukan sekadar kolom `headSha` yang kosong:
  hanoman tak pernah membuatkan worktree untuk item itu (pelajaran SPEC-431) **atau** branch sesinya
  sudah dihapus karena ter-merge (SPEC-360 — penghapusan itu sendiri buktinya). Membaca `headSha` null
  begitu saja sebagai "siap" membuat alasan `unmerged` **tak pernah menyala sekali pun** di produksi
  (0 dari 56 baris antrean), karena kolom itu kosong pada ~76 % item `done` ber-worktree.

## Setting (per workspace)
Singleton `id = 1`, kolom `data` (Json) berbentuk `zSetting`:
- `model` (default `claude-opus-5`) + `effort` (default `xhigh`) — **default global** untuk sesi baru,
  dipakai sebagai argv saat sesi lahir. Sejak [ADR-0061](../adr/0061-model-effort-per-sesi-picker-start.md)
  (SPEC-252) model/effort dipilih **per SESI** saat Start (picker `StartSessionModal` → body opsional
  `model`/`effort` di `POST /terminal/sessions`); kosong → default global ini. Manusia tetap bisa
  `/model` di dalam terminal. `maxConcurrent` dan `askTimeoutMin` **hilang** bersama runner headless
  (ADR-0024) — tak ada `dailyBudget`.
- `phaseModels` **dicabut** (SPEC-252, [ADR-0061](../adr/0061-model-effort-per-sesi-picker-start.md),
  mengamandemen [ADR-0058](../adr/0058-model-effort-per-fase.md)): matrix model/effort **per fase** tak
  andal — ia bergantung agen mengetik `/model`+`/effort` di batas fase, padahal agen menembus batas fase
  tanpa berhenti. Model/effort kini **per sesi** (satu proses, satu model seumur hidup). Field dihapus
  dari skema `zSetting`; baris `Setting` lama yang masih memuatnya tetap parse (key asing diabaikan).
  Model/effort tetap `z.string()` (lenient); daftar pilihan valid (`MODELS`/`EFFORTS`, memuat
  `claude-fable-5` · `max` · `ultracode`) hidup di `@hanoman/shared` untuk picker Start.
- `autoDefault`, `autoScaffold`, `notifyFail`
- `notifyDone` (SPEC-180, default true) — toast+sound saat backlog selesai
- `notifySound` (SPEC-180, default `short`) — `off` atau salah satu nada; durasi/varian bunyi notifikasi
- `agentAccessEnabled` (SPEC-257/[ADR-0065](../adr/0065-ai-agent-capability-agent-token.md), Boolean, default **false**) —
  **master switch** akses AI agent. `false` → semua `AgentToken` ditolak (401), apa pun `enabled`/capability-nya.
- `scheduler` (SPEC-294/[ADR-0072](../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md), `zScheduler`,
  **semua default MATI**) — knob scheduler otonom: `enabled` (master), `paused` (rem darurat Pause),
  `maxConcurrent` (cap sesi hidup — **penerus `maxConcurrent` yang dicabut ADR-0024**), `autonomy`
  (`full-control|butuh-keputusan`, **dikonsumsi SPEC-298**: governor menyuntik klausa prompt per mode saat
  meluncurkan sesi scheduler — `full-control` = putuskan sendiri & tembus sampai `done` tanpa berhenti
  bertanya; `butuh-keputusan` = berhenti di titik keputusan → marker SPEC-184 → notif decision, slot tetap
  terpakai), dan `sources.{backlog,errors,triase}`
  (`enabled`+`everyMin` per source; `errors.minCount`). Ditambahkan sebagai `.default(SCHEDULER_DEFAULTS)`
  → baris Setting lama tetap parse (blok hilang diisi default).

- `goal` (SPEC-332/[ADR-0073](../adr/0073-mode-goal-stop-hook-per-sesi.md), `zGoal`, **default MATI**) —
  mode goal untuk **sesi backlog**: `enabled` (default `false`) dan `condition` (string ≤ 4000, default
  `""` = pakai template DoD bawaan `defaultGoalCondition` di runner). Nyala → sesi lahir dengan
  `hooks.Stop=[{type:"prompt",prompt:<kondisi>}]` di argv `--settings` (mesin yang sama dipasang
  `/goal` Claude Code) sehingga ia **menolak berhenti** sampai kondisinya terbukti di transkrip; plus
  keystroke `/goal` best-effort ke pane untuk visibilitas TUI. Bisa di-override per sesi lewat
  `goal`/`goalCondition` di `POST /terminal/sessions`; sesi scheduler mengikuti default global ini.
  Ditambahkan sebagai `.default(GOAL_DEFAULTS)` → baris Setting lama tetap parse, **tanpa migration**.
- `agent` (`claude|codex`, default `claude`) + `codex` (`{ model, effort }`, default
  `gpt-5.6-sol`/`xhigh`) — SPEC-338/[ADR-0074](../adr/0074-codex-sebagai-mesin-sesi.md): mesin sesi
  default untuk SEMUA sesi yang men-spawn agen. `model`/`effort` di akar **tetap milik claude**;
  `sessionAgentDefaults()` memilih blok mengikuti `agent`. Blok codex dinormalkan saat **dibaca**
  (model pensiun → `gpt-5.5`, lalu effort dikoersi ke yang didukung model itu — SPEC-339).
- `verifyScope` (`changed|full`, default `changed`) — SPEC-376/[ADR-0080](../adr/0080-scope-verifikasi-per-sesi.md):
  scope verifikasi default sesi backlog, di-override per sesi saat Start.
- `conflict` (SPEC-383/[ADR-0081](../adr/0081-default-sesi-konflik-opt-in.md), `zConflict`,
  **default MATI**) — default **khusus sesi penyelesai konflik** rebase/merge:
  `{ enabled:false, agent:"claude", model:"claude-opus-5", effort:"xhigh" }`. Dibaca
  `conflictSessionDefaults()` dan dipakai **ketiga** pintu konflik (`POST /specs/:id/integrate`,
  `finishGraphOp` di `routes/ide.ts`, `POST /terminal/sessions/:id/integrate`). **Opt-in**: selama
  `enabled` mati helper mendelegasikan penuh ke `sessionAgentDefaults()` — perilaku pra-SPEC-383.
  **Satu triple**, bukan blok per-agen seperti akar: menukar `agent` menukar model/effort sekalian.
  Tak ada override per-request. Ditambahkan sebagai `.default(CONFLICT_DEFAULTS)` → baris Setting
  lama tetap parse, **tanpa migration**.
- `lead` (SPEC-409/[ADR-0091](../adr/0091-hanoman-lead-agen-pemimpin.md), `zLead`,
  **semua default MATI**) — knob hanoman-lead: `enabled` (master switch — selama mati hanoman
  berperilaku persis seperti sebelum ADR-0091), `paused` (rem darurat global), `pausedProjects`
  (rem per project), `everyMin` (denyut proaktif, default 5), `timeoutSec` (batas satu putusan,
  default **600** — SPEC-432 menaikkannya dari 120 karena satu keputusan `order` nyata terukur
  **306 dtk** pada claude-opus-5 · xhigh, sehingga 7/7 baris jejak operator berstatus `gagal`;
  angka ini juga disebut ke agennya lewat paragraf anggaran waktu di `leadPrompt`, dan **harus
  berasal dari cfg yang sama** yang dipakai `brain.think()` — anggaran yang berbohong menggeser
  pembacaan lead ke arah yang salah), `maxAutoAnswers` (jawaban otomatis berturut-turut per sesi sebelum lead berhenti,
  default 3), `requireGreenBeforeIntegrate` (syarat objektif sebelum integrasi ke `main`, default
  **menyala**), dan blok `engine` `{enabled,agent,model,effort}` = agen yang menjalankan lead —
  **opt-in seperti `conflict`**: selama `engine.enabled` mati, `leadAgentDefaults()` mendelegasikan
  penuh ke `sessionAgentDefaults()`. Ditambahkan sebagai `.default(LEAD_DEFAULTS)` → baris Setting
  lama tetap parse, **tanpa migration**.
  **Permukaan operatornya** (SPEC-488, tanpa ADR — skema tak berubah) adalah kartu
  "Agen hanoman-lead" di **Settings → Model sesi**, katalognya sumber yang sama dengan dua kartu di
  atasnya (`MODELS`/`EFFORTS` untuk claude; `CODEX_MODELS` + **`codexEfforts(model)`** untuk codex —
  effort codex properti **per-model**, SPEC-339, jadi picker tak boleh memakai `CODEX_EFFORTS`).
  Kartu itu menulis lewat **`PUT /lead/config`**, bukan `PUT /settings` seperti kartu konflik, dan
  itu perbedaan sadar: `SettingsScreen` mengirim seluruh objek `Setting` dari snapshot yang dimuat
  **sekali** saat mount, sementara blok `lead` punya **penulis kedua** (`LeadScreen` — Pause, denyut,
  batas waktu, opt-in per project). Menulisnya dari snapshot berarti rem darurat yang ditekan di
  layar Lead **lepas sendiri** saat operator mengganti model di Settings; blok `conflict` tak punya
  penulis kedua, jadi pola `save()`-nya tetap sah di sana. Nilainya dibaca `getSetting()` **tiap
  panggilan** (tanpa cache) dari dalam `decide()` → ganti setelan **berlaku tanpa restart**, dikunci
  `server/test/lead-engine-argv.test.ts` yang memanggil `decide()` dua kali dalam satu proses
  dengan baris `Setting` berbeda di antaranya.
- `changelog` (SPEC-518, `zAgentEngine`, **default MATI**) — runtime/model/effort **khusus agen
  pembuat changelog** ([ADR-0105](../adr/0105-changelog-per-project.md)):
  `{ enabled:false, agent:"claude", model:"claude-opus-5", effort:"xhigh" }`. Dibaca
  `changelogAgentDefaults()` (`services/changelog/config.ts`) dan dipakai di **satu** call site —
  `generateChangelog()`, satu-satunya tempat changelog men-spawn agen. **Opt-in**: selama `enabled`
  mati helper mendelegasikan penuh ke `sessionAgentDefaults()`, jadi instalasi yang ada tak berubah
  satu argv pun. Skemanya **`zAgentEngine` yang sama** dengan `lead.engine` & `telegram.engine`
  (SPEC-492) — bukan definisi kelima; **flat**, bukan `changelog.engine`, karena bloknya hanya
  override agen dan tak punya knob tetangga (cermin `conflict`). Effort codex dikoersi **di dalam
  resolver**, bukan hanya di picker: `PUT /settings` ber-`AgentToken` tak melewati UI mana pun.
  Ditambahkan sebagai `.default(CHANGELOG_ENGINE_DEFAULTS)` → baris Setting lama tetap parse,
  **tanpa migration**. Permukaan operatornya kartu **"Agen changelog"** di Settings → Model sesi,
  yang menulis lewat **`PUT /settings`** (bukan endpoint khusus seperti kartu lead, dan bukan
  baca-ulang seperti kartu Telegram): blok ini **tak punya penulis kedua**. Nilainya dibaca
  `getSetting()` tiap panggilan → ganti setelan berlaku pada pembangkitan berikutnya **tanpa
  restart**, dikunci `server/test/changelog-engine.test.ts` yang memanggil `generateChangelog()`
  dua kali dalam satu proses dengan baris `Setting` berbeda di antaranya.

## RuntimeConfig (LOCAL-only)

Override konfigurasi mesin ini: `key` unik, `value`, `updatedAt`. Secret disimpan sebagai amplop
AES-256-GCM dan tidak pernah disync. Sejak SPEC-761 `SYNC_SERVER_URL` dikategorikan sensitif walau
nilainya bukan secret: hanya cookie admin boleh mengubahnya, dan perubahan origin ditransaksikan
bersama tombstone `SYNC_DEVICE_TOKEN` agar env/credential lama tidak menjadi fallback. Record sync
tidak boleh menulis `RuntimeConfig` maupun field launch approval.

## User / Session (auth — SPEC-169, [ADR-0028](../adr/0028-auth-sesi-opaque-di-db.md))
- **User**: `id` (cuid), `email` (unique), `passwordHash` (`scrypt` "saltHex:hashHex"),
  **`role`** (`"admin" | "client"`, `@default("admin")`), **`disabled`** (`Boolean @default(false)`),
  `createdAt`. `passwordHash` tak pernah keluar ke client (`UserView` = `{ id, email, role, createdAt }`).
  **Dua peran sejak SPEC-617/[ADR-0110](../adr/0110-portal-klien-read-only.md)** — `admin` = perilaku
  lama persis (cookie = akses penuh), `client` = portal baca-saja ber-scope project. Default `"admin"`
  DISENGAJA: itulah yang membuat migrasi aman untuk instance yang sudah berjalan (setiap baris lama
  otomatis admin, nol backfill). `disabled` ditegakkan di **dua** titik — `POST /auth/login` **dan**
  `lookupSession()`; hanya menutup login berarti cookie yang sudah terbit hidup sampai 7 hari.
  **Workspace Terminal sejak SPEC-786/[ADR-0118](../adr/0118-workspace-terminal-kanonik-per-user.md):**
  `terminalWorkspace Json?` (`TerminalWorkspaceV1` atau null), `terminalWorkspaceRevision Int
  @default(0)`, dan `terminalWorkspaceUpdatedAt DateTime?`. Ketiganya LOCAL-only per akun admin:
  tidak masuk `SYNCED`/`FIELDS`, `PG_ORDER`, atau webhook. Revision di-increment atomik oleh PUT CAS;
  JSON non-null yang gagal schema dibaca sebagai 422, tidak disulap menjadi workspace kosong.
- **ClientProjectAccess** (SPEC-617 · ADR-0110): `id` (cuid), `userId`, `projectId`, `createdAt`,
  `@@unique([userId, projectId])`, `onDelete: Cascade` dari **keduanya** (dan `onUpdate: Cascade`
  bawaan Prisma membuat rename `Project.id` — ADR-0064 — merambat tanpa baris tambahan). Project yang
  boleh dilihat sebuah akun klien; user tanpa satu pun baris di sini tak melihat apa pun.
  **LOCAL-only** — tak masuk `SYNCED`/`FIELDS` (cermin `User`/`Session`/`AgentToken`: akun adalah
  kredensial per-instance) dan tak masuk `WEBHOOK_ENTITIES`, **tapi wajib** di `PG_ORDER` sesudah
  `User` dan `Project`.
- **Session**: `id` = **`sha256(token)`** (token opaque 256-bit hidup hanya di cookie `httpOnly`),
  `userId`, `createdAt`, `expiresAt`. `onDelete: Cascade` dari User. Revocable: logout menghapus
  baris; ganti password menghapus semua sesi user; hapus user meng-cascade sesinya; menonaktifkan
  atau me-reset password akun klien juga menghapus sesinya (SPEC-617). Sesi kedaluwarsa
  (`expiresAt < now`) diperlakukan tak valid dan dibersihkan saat di-lookup.

## AgentToken (SPEC-257 · [ADR-0065](../adr/0065-ai-agent-capability-agent-token.md))
Kredensial **AI agent eksternal** — jalur auth kedua ke seluruh `/api` (di samping cookie sesi & device
token). **Server-local**, TANPA `version`/sync (cermin `DeviceToken` — kredensial mengontrol instance INI).
- `id` (cuid), `name`, `tokenHash` (**@unique**, `sha256(token)` — plaintext hanya lahir & tampil **sekali**
  saat create; **TAK PERNAH** ke client/log), `tokenPrefix` (hint UI, mis. `hnm_agt_ab12cd`), `createdAt`.
- `capabilities` (Json string[]) — subset `CAPABILITY_IDS` (`@hanoman/shared`), divalidasi zod. Bentuk
  `"<domain>:<access>"` (9 domain × `read`/`write`; `write` **meng-implikasikan** `read`). Domain: projects,
  backlog, sessions, docs, ide, vps, settings, support, notifications. Dibuka manusia di Settings.
- `enabled` (default true) — master switch per-token; `revokedAt` (nullable) — revoke instan. Verifikasi
  gagal (disabled/revoked/tak ada/hash beda) → auth ditolak.
- `createdBy` (nullable, `User.id` pembuat — jejak audit), `lastUsedAt` (nullable, best-effort bump tiap
  request ter-auth — audit ringan; cermin `DeviceToken.lastSeenAt`).
- `AgentTokenView` (ke client) = `{ id, name, tokenPrefix, capabilities, enabled, createdBy, createdAt,
  lastUsedAt, revokedAt }` — **tanpa** `tokenHash`/plaintext.
- **Tak-boleh-didelegasikan** (agent token → 403, apa pun capability): `/auth/*` (user), `/agent-tokens*`
  (anti privilege-escalation — agen tak mencetak/menaikkan token), `/device-tokens*`, `/sync*`. Kelola token
  & master switch = **cookie-only**. Route→capability dipetakan di `services/agent-capabilities.ts`.

## Notification (SPEC-180/184, [ADR-0033](../adr/0033-notifikasi-backlog-selesai.md), [ADR-0036](../adr/0036-notifikasi-human-decision.md))
Dua tipe: `done` (backlog masuk `done`, dibuat di `advanceStage()` & write-through `GET /specs`)
dan `decision` (sesi Claude menunggu keputusan manusia, dibuat `scanDecisions()` di `GET /notifications`).
- `id` (cuid), `type` (`done|decision|drift|error|ticket|fail`, default `done`; `error` SPEC-249, `ticket`
  SPEC-253, `fail` SPEC-298 — grup error produksi baru / keluhan Help Center baru / sesi scheduler gagal-limit.
  Longgar String → tanpa migration kolom).
- `key` **@unique** nullable — dedup selesai `"done:<specId>"` / gagal `"fail:<specId>"` (SPEC-298; insert
  kedua kena P2002, diabaikan); `null` untuk decision (di-dedup di sisi scan via `Set` episode; NULL berulang
  diizinkan di kolom `@unique` — berlaku di Postgres maupun SQLite, jadi cutover ADR-0086 tak menyentuhnya).
- `specId` (nullable — sesi reverse tak punya spec), `sessionId` (target redirect terminal),
  `title` (snapshot), `projectId` (opsional), `createdAt`.
- `readAt` (nullable) — `null` = belum dibaca. Read-state **global** (bukan per-user).
- Rute: `GET /notifications` (memicu `scanDecisions()`, lalu `{ items ≤50 terbaru dulu, unread }`),
  `POST /notifications/read` (tandai semua), `DELETE /notifications` (clear).

## Vps (SPEC-164, [ADR-0025](../adr/0025-modul-vps-script-deterministik.md))
VPS yang dikelola hanoman. `keyPath` menunjuk berkas private key **di mesin server** — isinya tak pernah
ada di database.
- `id` (cuid), `name`, `host`, `port` (default 22), `user`, `keyPath?`, `createdAt`
- `lastSeenAt?` (healthcheck sukses terakhir), `health?` (Json `{ uptime, disk, mem, load }`)
- `lastAuditAt?`, `audit?` (Json `VpsCheck[]` — `[{ check, status, detail }]`)
- `hardened` (default false) — derived: semua check kritis pass pada audit terakhir

### VpsAuditSnapshot / VpsItemState (SPEC-220 · [ADR-0050](../adr/0050-vps-compliance-katalog-scoring.md))
Kerangka kepatuhan checklist 232 item (katalog di git, lihat [vps-compliance.md](vps-compliance.md)).
- **`VpsAuditSnapshot`** — hasil satu audit kepatuhan (**append-only**, sumber diff drift):
  `id`, `vpsId`→Vps (cascade), `createdAt`, `results` (Json `{ [itemId]: { status, detail } }`),
  `scoreTotal` (Float 0..100), `scoreBySection` (Json `{ [section]: number }`),
  `detected?` (Json `{ [section]: { present, detail } }` — deteksi stack app-layer advisory, SPEC-221).
  Index `(vpsId, createdAt)`.
- **`VpsItemState`** — keputusan human durable per item: `na`/`naReason` (keluar denominator skor),
  `attested`/`attestNote` (item `INFO`), `actorEmail` (jejak pelaku dari sesi auth), `updatedAt`.
  Unik `(vpsId, itemId)`, `vpsId`→Vps (cascade).

## Ticket / TicketAttachment (SPEC-253 · [ADR-0062](../adr/0062-help-center-tiket-publik-triase.md))
Help Center: keluhan pengguna akhir → antrean triase → promosi ke backlog. **SPEC-268/[ADR-0066](../adr/0066-errors-tickets-masuk-record-sync-plus-pemicu-manual.md):**
**metadata** `Ticket` kini **tersync** (kolom `version`, entitas `ticket` di `SYNCED`); publish
asal-hub pada create/accept/reject. `accessKeyHash` ikut snapshot (kolom `required @unique` tanpa
default — kunci **plaintext** tak pernah menyeberang). **SPEC-272/[ADR-0068](../adr/0068-lampiran-tiket-masuk-record-sync.md):**
**metadata lampiran** (`TicketAttachment`) kini **tersync** (kolom `version`+`updatedAt`, entitas
`ticketAttachment` di `SYNCED`); **byte biner tetap TIDAK masuk feed** — ditarik lazy dari hub saat
lampiran pertama dibuka di client (`readUploadOrFetch` → `GET /api/sync/attachments/:storageKey`) lalu
di-cache lokal. `status`/`category` = `String` + zod (`zTicketStatus`/`zTicketCategory`), bukan enum Prisma.
- **`Ticket`** — tiket keluhan per project: `id` (cuid), `projectId`→Project (cascade), `number` (nomor
  pendek human-readable per project), `category` (`bug|fitur|pertanyaan|lainnya`), `title`, `detail`,
  `reporterEmail`, `status` (`new`|`accepted`|`rejected`, default `new`), `accessKeyHash` (**@unique**,
  `sha256(kunci opaque)` untuk cek status — plaintext hanya sekali; **TAK PERNAH ke client/log**),
  `specId?` (tautan Spec hasil promosi), `createdAt`, `updatedAt`, `version` (sync). Unik `(projectId, number)`; index
  `(projectId, createdAt)`. Nomor dihitung `max+1` per project (retry P2002, cermin `nextSpecId`).
- **`TicketAttachment`** — lampiran gambar: `id`, `ticketId`→Ticket (cascade), `projectId` (denormal,
  isolasi), `filename` (display), `mimeType`, `size`, `storageKey` (nama opaque `uuid+ext` di
  `HANOMAN_UPLOAD_DIR` — **berkas biner** server-local, di luar repoDir, **tak masuk feed**), `createdAt`,
  `updatedAt`, `version` (sync — SPEC-272). **Metadata** menyeberang lewat entitas `ticketAttachment`
  di `SYNCED`; `storageKey` menyeberang sebagai **pointer opaque** (bukan isi file). Index `(ticketId)`.
  Byte dipromosikan hanya sesudah magic-byte/MIME cocok, decode+re-encode, dimension/pixel/time cap,
  quota ticket/project/global, serta scanner quarantine lulus. `filename`, extension, MIME, dan size
  berasal dari hasil normalisasi server, bukan metadata client.
- Submit publik `POST /api/help/:slug/tickets` (multipart) diotorisasi **`Project.helpEnabled`**; cek status
  `GET /api/help/:slug/tickets/:key` diotorisasi **kunci opaque** — pengecualian sah gate `/api` (ADR-0062).
  Tiket baru → `Notification` type `ticket`. Promosi (`POST /tickets/:id/accept`) → `Spec` source `help`
  (payload brief-shaped + backlink). Status publik **diturunkan** (`publicStatus`) dari status tiket +
  `stage` Spec. Rate-limit bounded TTL/LRU (per IP & per project, short-circuit per SPEC-352) +
  honeypot (`hc_trap`). Triase scheduler hanya membuat notification review; promosi selalu aksi
  manusia dan payloadnya dibingkai sebagai data tidak tepercaya.

## Sync — konflik & jam LWW (SPEC-270 · [ADR-0067](../adr/0067-sync-lww-reconciliation-manual.md))
- **`updatedAt` = jam LWW.** Model synced (`Project`, `Spec`, `Vps`, `SessionResult`,
  `Ticket`, `TicketAttachment`) kini `updatedAt @updatedAt` (dulu `@default(now())`) — auto-bump tiap edit;
  masuk `FIELDS`/`DATE_FIELDS` → **ikut menyeberang**; layer sync **mempertahankan `updatedAt` asal**
  saat apply dari peer (bukan menstempel ulang), jadi basis last-write-wins konsisten lintas node.
- **`SyncConflict`** (LOCAL-only, tak disync): antrean divergensi **dua-sisi sejati** menunggu
  keputusan manusia. Kolom `entity`, `recordId`, `localData`/`localVersion`/`localUpdatedAt`,
  `serverData`/`serverVersion`/`serverUpdatedAt`, `detectedAt`, `resolvedAt?`. Unik `(entity,recordId)`
  (idempoten). Diselesaikan via modal side-by-side (default = sisi `updatedAt` terbaru).
- **Backfill feed:** saat boot HUB, `backfillFeed()` mem-`publishLocal` tiap row SYNCED yang belum
  ter-feed (mencakup `version=0` pra-entitas-tersync) — idempoten. **Sejak SPEC-799** ia juga
  memastikan tiap `SyncTombstone` punya baris feed pada versinya: instance yang dulu berperan CLIENT
  memiliki tombstone TANPA baris feed (peran client mengantre outbox, tak menulis `SyncLog`), jadi
  tanpa sapuan itu promosi jadi hub membuat penghapusannya tak pernah menyeberang.

## Sync — tombstone (SPEC-799 · [ADR-0119](../adr/0119-tombstone-sync-penghapusan-menyeberang.md))
- **`SyncTombstone`** — keadaan "record ini dihapus". LOCAL-only **sebagai tabel**, tapi maknanya
  menyeberang lewat feed. Kolom `id` (cuid), `entity`, `recordId`, `version` (versi record SESUDAH
  dihapus = versi terakhirnya + 1), `data` (snapshot field tersync tepat sebelum dihapus),
  `deletedAt`, `deviceId?`. Unik `(entity, recordId)`.
  **Hard-delete dipertahankan** (bukan soft-delete `deletedAt` per entitas): dengan begitu
  `onDelete: Cascade` tingkat-DB tetap merambat ke anak di kedua sisi dan **tak satu pun query baca
  yang sudah ada berubah** — penyaring yang terlewat di bentuk soft-delete gagal SENYAP dengan gejala
  persis bug yang diperbaiki. `data` bukan kenyamanan melainkan prasyarat kompatibilitas: tanpanya,
  push delete ke hub versi lama berbentuk create tanpa kolom required (P2011 → 500 tiap siklus).
- **`SyncLog.op`** — `String @default("upsert")`, nilai `"upsert" | "delete"`. Kolom **TOP-LEVEL**,
  bukan penanda di dalam `data`: `validateSyncData` menegakkan allowlist atas `data`, jadi penanda di
  sana membuat client versi lama **melempar** → `feedHole` menyala → kursornya tertahan selamanya.
  Baris `op:"delete"` tetap membawa `data` snapshot terakhir yang sah, sehingga client versi lama
  sekadar menerapkannya sebagai upsert (delete tak menyeberang ke sana — status quo, bukan kerusakan).
- **Tombstone = versi record itu sendiri.** `applyPush` membaca "versi saat ini" dari baris **atau**
  tombstone, jadi penolakan kebangkitan jatuh dari optimistic-concurrency yang sudah ada. Push
  `op:"delete"` diterima **tanpa** cek `baseVersion` (delete menang tanpa syarat → hasil independen
  urutan tiba) dan **idempoten** (tombstone yang sudah ada = nol baris feed kedua).
- **`SyncTombstone` wajib ada di `PG_ORDER`** (`cli/src/commands/migrate-pg.ts`) —
  `cli/test/migrate-pg.test.ts` menuntutnya sama persis dengan DMMF dan itu satu-satunya gerbangnya.

## SchedulerQueueItem (SPEC-294 · [ADR-0072](../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md))
Antrean durable kandidat peluncuran **scheduler otonom** — **LOCAL-ONLY, tak disync** (cermin
`SyncOutbox`/`RuntimeConfig`: state operasional mesin INI). Unit peluncuran **selalu sebuah `Spec`**
(backlog sudah Spec; errors→escalate & triase→accept membuat Spec dulu), jadi kolom `specId` **@unique**
sekaligus **kunci idempoten satu-sesi-per-spec** (ADR-0015). Antrean **tak menduplikasi** `Spec.stage` /
overlay sesi live — status live (running/done/failed) tetap diturunkan dari `pty.listSessions()` +
`Spec.stage` + `Notification`.
- `id` (cuid), `specId` (**@unique**), `projectId` (tanpa FK — cermin `SyncOutbox`), `source`
  (`backlog|errors|triase`, asal checker), `priority` (`tinggi|sedang|rendah`, urutan drain),
  `status` (`queued|launched|done|failed|canceled`, default `queued`), `sessionId?` (id sesi tmux saat diluncurkan),
  `note?` (alasan gagal — **diisi rekonsiliasi akhir sesi SPEC-298** saat sesi gagal/limit), `enqueuedAt`
  (FIFO dalam prioritas), `launchedAt?`. Index `(status)`.
- Governor men-drain item `queued` (urut prioritas→FIFO) selagi sesi hidup `< cap` (`Setting.scheduler.maxConcurrent`),
  meluncurkan lewat `startSpecSession` (jalur bersama peluncuran manual). Knob scheduler hidup di
  `Setting.data.scheduler` (`zScheduler`, semua default mati). Lihat [ADR-0072](../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md).
- **Diisi oleh checker `backlog` (SPEC-295, dipersempit SPEC-431):** spec **belum-mulai** dari project
  `schedulerOptIn`, urut prioritas `tinggi→sedang→rendah`, `source:"backlog"` (asal checker; `flow`
  peluncuran tetap diturunkan `spec.source`). "Belum-mulai" = **`baseSha=null` DAN `stage ≠ "done"`**
  (`UNSTARTED_SPEC_WHERE`, `services/scheduler/queue.ts` — dipakai checker **dan** denyut lead SPEC-409).
  `baseSha` **sendirian bukan proksi** "belum mulai": ia menjawab "pernahkah hanoman membuatkan worktree",
  dan kolomnya baru ada sejak [ADR-0030](../adr/0030-spec-menyimpan-base-head-sha.md) — item yang selesai
  sebelum itu, ditandai selesai manual, atau dikerjakan di checkout lain permanen ber-`baseSha` null lalu
  **diluncurkan ulang** sebagai sesi (jalur `isContinue`/SPEC-172: worktree + branch baru, `startedAt`
  ditimpa). Terukur di DB produksi: 27 `Spec` `done` ber-`baseSha` null, 27 dari 29 baris antrean, 6 sesi
  telanjur lahir. `startedAt` (SPEC-408) tak menolong — ia ditulis di titik cekik yang sama dengan `baseSha`.
  **Gerbang kedua di governor:** tepat sebelum `launch`, item yang spec-nya sudah `done` **ditutup**
  (`status:"done"` + `note`) tanpa meluncurkan apa pun & tanpa memakan slot — itu yang membereskan baris
  basi yang telanjur ada dan balapan "operator menyelesaikan item selagi ia mengantre". Sengaja **bukan**
  di `startSpecSession`: reopen manual item `done` (SPEC-172) tetap boleh.
- **Diisi oleh checker `triase` (SPEC-297):** tiap `Ticket` eligible (`status:"new"` ∧ `category ∈ {bug,fitur}` ∧
  `specId=null` ∧ project `schedulerOptIn`) di-accept lewat jalur bersama `acceptTicket` (`services/ticket-accept.ts`,
  pemetaan kategori→source SPEC-291: bug→`qa`, fitur→`brief`) → Spec prioritas `sedang`, lalu `source:"triase"`.
  Kategori `pertanyaan`/`lainnya` **tak pernah** auto-accept (tetap manual). Idempoten: filter query menyaring tiket
  accepted/rejected/ber-specId; satu tiket = satu backlog; banyak tiket satu window (tanpa limit checker — cap governor).
- **Rekonsiliasi akhir sesi (SPEC-298, `services/scheduler/reconcile.ts`, dipanggil `engine.tick` sebelum drain):**
  tiap item `launched` → **`done`** (stage live turunan berkas fase = `done`): `Notification done` + `SessionResult`
  ringkasan (`newStage:"done"`, `commitSha`=headSha, `branch:"hanoman/<id>"`; diff diturunkan `baseSha..headSha`,
  tak disimpan) + `markDone` — **tanpa auto-merge** (branch/worktree dibiarkan untuk merge manual ADR-0031);
  **`failed`** (pane sesi mati/gone sebelum `done` = gagal/limit): `Notification fail` + `markFailed(note)` —
  **tanpa retry** (PRD non-goal); atau **biarkan `launched`** (pane hidup, stage<done — masih kerja / menunggu
  keputusan → `scanDecisions` menerbitkan `Notification decision`, sesi tetap **memegang slot** governor `liveCount`).
- **Pembatalan operator (SPEC-522 · [ADR-0106](../adr/0106-batalkan-antrean-scheduler.md)):** `canceled`
  adalah **tombstone**, bukan penghapusan — `enqueue()` memakai `upsert` ber-`update:{}`, jadi checker
  `backlog` yang menjumpai spec yang sama pada cadence berikutnya **tak bisa menghidupkannya**; menghapus
  barisnya justru membuat pembatalan membatalkan dirinya sendiri dalam ≤1 cadence (spec-nya masih cocok
  `UNSTARTED_SPEC_WHERE`). Mekanisme yang sama dipakai SPEC-431 (`markDone` + `ALREADY_DONE_NOTE`).
  Transisinya `queued → canceled` (`POST /api/scheduler/queue/:id/cancel`, `note` = `dibatalkan operator`
  ± `: <reason>`) dan `canceled → queued` (`…/requeue`, `note` dikosongkan), keduanya **CAS**
  (`updateMany` ber-`where` status) — itulah yang membuat "item yang sudah punya sesi aktif tak boleh
  dibunuh diam-diam" tak bisa dilanggar balapan. Governor punya **dua gerbang** sepasang: `isQueued`
  di puncak badan loop `drain` (snapshot `queued()` bisa berumur puluhan detik, dan posisi paling atas
  itulah yang menjaga gerbang SPEC-431 & cabang `isLive` tak menimpa baris `canceled`) dan `markLaunched`
  yang jadi **CAS** (sisa jendela = durasi satu spawn); sesi yang telanjur lahir **tidak dibunuh** —
  id-nya dicatat di `note` dan slotnya tetap terpakai. `reconcile()` tak tersentuh: ia hanya memindai
  `launched`, jadi tak ada `Notification fail` palsu untuk item yang sengaja dibatalkan.

## SchedulerCron & SchedulerCronRun (SPEC-646 · [ADR-0112](../adr/0112-cronjob-per-project-scheduler.md))
Cronjob per project — jadwal jam tertentu (HH:MM) yang ditunda ADR-0072. Keduanya **LOCAL-ONLY, tak
disync** (cermin `SchedulerQueueItem`: tak masuk whitelist `FIELDS`, tanpa kolom `version`) karena
jadwal adalah properti **mesin ini** — worktree, tmux, dan cap concurrency-nya lokal.

`SchedulerCron`
- `id` (cuid), `projectId` (tanpa FK — cermin `SchedulerQueueItem`), `name`, `expr` (cron 5-field,
  dievaluasi di zona waktu **lokal server**), `prompt` (instruksi bebas operator),
  `agent?`/`model?`/`effort?` (**null = warisi** default sesi; diresolusi `terminalAgentDefaults()`,
  fungsi yang sama dengan form "Sesi baru" SPEC-517 — sengaja BUKAN blok `zAgentEngine`, yang membawa
  `enabled` sendiri), `enabled` (default **false**), `nextRunAt?` (jadwal berikutnya, durable lintas
  restart), `lastRunAt?`, `createdAt`, `updatedAt`. Index `(projectId)`, `(enabled)`.
- Preset UI (setiap hari · hari kerja · mingguan · tiap N jam) **tak disimpan** — ia diturunkan
  bolak-balik dari `expr` oleh `presetToExpr`/`exprToPreset` (`shared/src/cron-expr.ts`, murni).
  Menyimpan preset sebagai kolom kedua akan melahirkan drift yang tak punya arbiter.

`SchedulerCronRun` — merangkap **antrean dan riwayat** dalam satu tabel (pola `WebhookDelivery`, ADR-0100)
- `id` (cuid), `cronId`, `projectId`, `dueAt`, `startedAt?`, `status`
  (`queued|launched|skipped|failed`, default `queued`), `sessionId?`, `note?` (alasan skipped/failed),
  `manual` (default false — dari tombol "Jalankan sekarang"), `createdAt`.
  **`@@unique([cronId, dueAt])`** + index `(cronId, dueAt)` & `(status)`.
- Kunci unik itu **adalah** idempotensinya: satu jatuh tempo bisa diklaim paling banyak sekali, apa pun
  yang terjadi pada tick berulang, dua tick yang balapan, atau restart di tengah — P2002 diperlakukan
  sebagai jalur normal, bukan galat. `nextRunAt` **bukan** kuncinya: ia bisa gagal ditulis sementara
  run-nya sudah lahir.
- Jatuh tempo tertunggak **tak pernah** jadi burst: sweep memajukan `nextRunAt` ke jatuh tempo TERBARU
  yang ≤ now dan membuat SATU baris; yang dilompati jadi angka di dalam `note`
  (`terlewat N jatuh tempo — scheduler tak berjalan`).
- Baris dihapus bersama cron-nya (`DELETE /api/scheduler/crons/:id`) — tanpa FK, jadi penghapusannya
  eksplisit di route.

## SessionHistory (SPEC-362 · [ADR-0079](../adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md))
Riwayat **setiap** sesi terminal — **LOCAL-ONLY, tak disync** (cermin `LocalBinding`/`SchedulerQueueItem`:
sesi hidup di tmux mesin ini dan transkripnya berkas di disk mesin ini). tmux tetap sumber kebenaran
sesi **hidup** (ADR-0016); tabel ini adalah jejak sesi yang **sudah berlalu**, yang sebelumnya lenyap
total saat `killSession()` + `removeWorktree()`. Berbeda dari `SessionResult` (ADR-0047) yang hanya
lahir saat transisi stage **spec** — tabel ini mencatat semua jenis sesi, termasuk shell, PRD, reverse,
scaffold, breakdown, dan konsol VPS.
- `id` (**uuid milik BARIS**), `sessionId` (id tmux — **bukan** PK: `sessionIdForSpec()` deterministik,
  jadi satu backlog yang dibuka-tutup lima kali menghasilkan lima baris ber-`sessionId` sama; PK
  `sessionId` akan menimpa riwayat lama tiap reopen), `projectId` (**tanpa FK** — sesi VPS memakai
  `vps:<id>`/`vps-console:<id>`, konvensi `SessionResult`), `specId?`, `title?` (**snapshot** judul spec
  saat sesi lahir — riwayat tetap terbaca setelah spec-nya dihapus), `kind`
  (`spec|reverse|prd|scaffold|breakdown|vps|shell|worktree|terminal`), `flow?`, `agent`
  (`claude|codex`), `model?`, `effort?`, `branch?`, `cwd`, `startedAt`, `endedAt?` (null = **berjalan**),
  `exitCode?`, `transcriptKey?` + `transcriptBytes?` (pointer berkas; **isi tak pernah di DB**),
  `createdAt`, `updatedAt`. Index `(projectId, startedAt)`, `(specId)`, `(sessionId)`.
- **Baris lahir saat sesi LAHIR**, bukan saat ditutup — sesi berjalan pun sudah tercatat. Penulisnya
  `services/session-history.ts`, dipicu hook `registerSessionHooks({onBirth,onDeath})` dari **dua titik
  cekik** `pty.createSession()`/`pty.killSession()`; `pty.ts` tetap **nol dependensi DB**. `onBirth`
  tak menembak saat re-attach (ADR-0015).
- **Transkrip bukan kolom:** `capture-pane -p -J -S -50000` **tanpa `-e`** dijalankan SEBELUM
  `tmux kill-session` (sesudah itu scrollback lenyap), disimpan sebagai berkas di
  `HANOMAN_TRANSCRIPT_DIR` oleh `services/transcript-store.ts` (cermin `services/uploads.ts`), cap
  **1 MiB menyimpan ekor** + penanda pemangkasan.
- **Zombie dibereskan saat boot:** `reconcileHistory()` menutup baris `endedAt: null` yang `sessionId`-nya
  tak ada di `pty.listSessions()` (tmux mati di luar hanoman) dengan `endedAt = updatedAt`, `exitCode`
  tetap null. Cermin `backfillFeed` saat hub boot (ADR-0067).
- **Purge manual ber-scope** (`projectId` dan/atau `before`) tetap tersedia. Sweep retention harian
  juga memilih sesi berakhir >30 hari dalam batch bounded; hold `session:<id>` mengecualikan record.
  Bila delete transkrip gagal, record DB dipertahankan agar percobaan berikutnya dapat retry.

## Retention lifecycle (SPEC-761)

Tidak ada tabel scheduler baru: `retention.ts` menurunkan eligibility dari timestamp model yang ada.
Default: `SessionHistory` 30 hari, `Ticket` accepted/rejected 90 hari, Ticket new 180 hari,
`WebhookDelivery` terminal 30 hari, dan `SessionResult` 90 hari. Satu sweep maksimum 100 record
(hard cap 1000), mendukung dry-run dan hold id eksplisit. Attachment/transcript dihapus sebelum row;
kegagalan filesystem mempertahankan row. Home/direktori memakai 0700, file sensitif 0600.

## LeadDecision (SPEC-409 · [ADR-0091](../adr/0091-hanoman-lead-agen-pemimpin.md))
Jejak keputusan **hanoman-lead** — **LOCAL-ONLY, tak disync** (cermin `SessionHistory`/
`SchedulerQueueItem`: barisnya menunjuk sesi tmux & worktree di mesin ini, jadi menyiarkannya ke hub
akan mengirim rujukan yang tak ada di sana). Tanpa `version`/`notifySynced`, **tak masuk `FIELDS`**.
- Kenapa kolom, bukan nilai turunan: aturannya bukan "selalu turunkan" (ADR-0011/0018) melainkan
  *bisakah dihitung ulang dari sumber lain* — coverage bisa (filesystem), diff bisa (git),
  **pertanyaan yang ditanyakan sesi yang sudah mati dan alasan yang dipakai lead tidak bisa**. Arah
  yang sama dengan ADR-0090.
- `id` (cuid), `projectId` (**tanpa FK** — sesi VPS memakai projectId sintetis, konvensi
  `SessionResult`/`SessionHistory`), `specId?`, `sessionId?`, `gate`
  (`contract|detected|pulse` — pintu masuknya), `kind`
  (`answer|order|collision|quality|refusal`), `question`, `answer`, `reason`, `refs` (Json `string[]`
  — **hanya rujukan yang benar-benar ada di repo**; path absolut & `..` dibuang), `confidence`
  (`tinggi|sedang|ragu`), `action` (allowlist `shared/src/lead.ts`), `status`
  (`berlaku|ditimpa|dibatalkan|gagal`), `weighty`, `supersededById?`, `actor` (`lead|operator`),
  `createdAt`, `updatedAt`. Index `(projectId, createdAt)`, `(specId)`, `(sessionId)`.
- **SPEC-480 · [ADR-0098](../adr/0098-putusan-lead-ringkas-terstruktur.md) — pilihan sebagai data:**
  `choice?` (label opsi terpilih, **verbatim**; null = tak ada opsi / pilihan ditolak), `choiceIndex?`
  (**1-basis**, sepasang dengan `choice`), `options?` (Json `string[]` — menu yang **dikirim
  peminta**), `missing?` (Json `string[]` — apa yang kurang bila lead menyatakan konteksnya tak cukup;
  terisi ⇒ `confidence` dipaksa `ragu` ⇒ weighty). Keempatnya **nullable tanpa default**: baris yang
  lahir sebelum spec ini sah apa adanya, dan "peminta tak menyodorkan menu" adalah keadaan yang sah.
  `options` ikut disimpan karena tanpa itu jejaknya **tak bisa dibaca ulang** — `question` tersimpan,
  menunya tidak, jadi "lead memilih opsi 2" tak bisa diverifikasi enam jam kemudian.
- **`answer`/`reason` menyimpan prosa lead UTUH** (SPEC-480). Batas panjang `LEAD_DECISION_MAX = 240`
  / `LEAD_REASON_MAX = 480` ditegakkan di prompt dan dipangkas **saat pengiriman** (balasan pintu #1
  + teks yang diketik ke pane), bukan di sini: jejak adalah tempat orang mencari kenapa sebuah putusan
  diambil, dan memangkasnya menukar putusan bertele-tele dengan putusan yang tak bisa diaudit.
- **`gagal` bukan keputusan** melainkan catatan bahwa lead tak berhasil memutuskan dalam batas waktu
  (AC-4). Ia tetap disimpan: "tak ada barisnya" tak bisa dibedakan dari "tak pernah diminta".
- **Append-mostly, tak pernah dihapus.** Menimpa (`POST …/override`) menandai baris lama `ditimpa`,
  menyimpan jawaban operator sebagai baris BARU, dan menautkan keduanya lewat `supersededById`.
  `services/lead/trail.ts` **tak punya fungsi hapus sama sekali** — cara termurah menegakkan larangan
  lead menghapus jejaknya sendiri. Pemangkasan retensi, bila kelak ada, jadi wewenang manusia lewat
  jalur terpisah.
- **SPEC-485 · [ADR-0102](../adr/0102-lead-multi-select-dan-rantai-keputusan.md) — pilihan JAMAK &
  tautan rantai:** `choices?` (Json `{index,option}[]`), `select?` (Json `{mode,min,max}` sebagaimana
  dikirim peminta), `flowId?` (rantai tempat langkah ini duduk), `step?` (1-basis). Index `(flowId)`.
  Keempatnya aditif & nullable — baris lama sah apa adanya. **`choices` adalah bentuk penyimpanan
  yang BERLAKU** ("selalu daftar, konsumen tak perlu menebak single vs multi"); `choice`/`choiceIndex`
  **dipertahankan** dan diisi dari `choices[0]` sebagai turunan, dan `toDecisionView` **menurunkan
  balik** `choices` dari pasangan skalar itu untuk baris pra-migrasi — itulah yang membuat riwayat
  lama terbaca sesudah perubahan skema, **tanpa satu pun backfill**.
- Knob-nya sendiri hidup di `Setting.lead` (kolom `Json` → **tanpa migration**); yang butuh migration
  hanya tabel ini + `Project.leadOptIn` + `LeadFlow` di bawah.

## LeadFlow (SPEC-485 · [ADR-0102](../adr/0102-lead-multi-select-dan-rantai-keputusan.md))
Satu **RANTAI keputusan** — beberapa pertanyaan berurutan yang satu urusan, dari pertanyaan pertama
sampai submit akhir. **LOCAL-ONLY, tak disync** (tanpa `version`, alasan yang sama persis dengan
`LeadDecision`) dan **tanpa FK**.
- Kenapa entitas, bukan turunan: sebelum model ini "alur" hanya ada sebagai kebetulan — baris jejak
  yang berdekatan waktunya. Karena itu tak ada tempat untuk menegakkan *"pertanyaan lanjutan hanya
  boleh masuk ke alur yang masih aktif"*, dan tak ada yang bisa ditanya *"sudah di-submit belum"*.
- `id` (cuid), `projectId`, `specId?`, `sessionId?`, `gate` (pintu yang membukanya), `status`
  (**`menunggu | sebagian | selesai | dibatalkan`**), `title` (pertanyaan pertama, terpangkas — ini
  yang dibaca operator), `steps`, `closeReason?` (`tunggal|submit|operator|kedaluwarsa`), `openedAt`,
  `closedAt?`, `expiresAt`, `createdAt`, `updatedAt`. Index `(projectId, createdAt)`, `(status)`.
- **Setiap keputusan punya alur.** Permintaan tanpa `chain` melahirkan alur yang **ditutup seketika**
  (`selesai`, `closeReason: "tunggal"`); yang ber-`chain` terbuka sampai `POST /lead/flows/:id/submit`.
  `flowId` yang menunjuk alur **tertutup** ditolak **409** — bentuk teknis dari "tak bisa menyisipkan
  pertanyaan ke rantai yang sudah di-submit".
- **Alur yang ditinggalkan punya ujung:** `expiresAt` diturunkan dari knob `Setting.lead.flowTtlMin`
  (default 60, kolom `Json` → tanpa migration), dan penyapunya **menumpang tick engine lead yang
  sudah ada** — ADR-0024 melarang timer/scheduler baru.
- Langkah `gagal` tetap duduk di alurnya dan tetap menaikkan `steps`, tapi **tak** memindahkan status:
  alur yang semua langkahnya gagal memang masih "menunggu jawaban".

## CustomAgent (SPEC-450 · [ADR-0094](../adr/0094-custom-agent-katalog-materialisasi-native.md))

Katalog persona agen yang dipakai **setiap sesi baru**. `projectId` **null = GLOBAL** (berlaku di
semua project); terisi = milik satu project, dan agen project **menimpa** agen global bernama sama.

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | `String @id` | **Deterministik** `"<projectId\|global>:<name>"` — bukan cuid. |
| `projectId` | `String?` | null = global. FK `onDelete: Cascade`. |
| `name` | `String` | Slug `^[a-z][a-z0-9-]{1,39}$`. **IMMUTABLE.** |
| `description` | `String` | "Kapan agen ini dipakai" — inilah yang dibaca agen untuk **memilih**. |
| `instructions` | `String` | System prompt agen. |
| `tools` | `Json?` | Array nama tool. `null` = pakai `DEFAULT_AGENT_TOOLS`. |
| `model` | `String?` | `null` = warisi model sesi. |
| `mentions` | `Json?` | Array nama agen yang boleh dipanggil. `null`/`[]` = daun. |
| `runtime` | `String?` | **SPEC-484 · [ADR-0101](../adr/0101-form-custom-agent-katalog-runtime.md)** · penyaring mesin sesi. `null` = **ikut sesi induk** (dipakai sesi claude **dan** codex — perilaku ADR-0094 apa adanya, jadi baris lama tak perlu backfill); `"claude"`/`"codex"` = hanya dimaterialisasi di sesi mesin itu. Nilai asing dari sync dibaca sebagai `null`. Ikut `FIELDS.customAgent`. |
| `enabled` | `Boolean` | Agen project yang **dimatikan menyembunyikan** global bernama sama. |
| `version` | `Int` | Version-stamp sync (ADR-0045). Ikut `SYNCED`/`FIELDS`/`PG_ORDER`. |

- **Kenapa `id` deterministik.** Baris ini menyeberang changefeed. Dengan id acak, dua mesin yang
  sama-sama membuat agen global `reviewer` melahirkan **dua baris** yang keduanya tersinkron lalu
  bertemu di satu objek JSON `--agents` yang **berkunci nama** — salah satunya hilang tanpa jejak.
  Dengan id deterministik keduanya baris yang **sama**, dan rekonsiliasi LWW/`SyncConflict`
  (ADR-0067) yang sudah ada menanganinya.
- **Kenapa `name` immutable.** Rename yang mengubah `id` meninggalkan baris yatim di setiap mesin
  lain. `PATCH` menolak `name`/`projectId` dengan **400**; ganti nama = hapus + buat baru.
  *(Premis aslinya, "`SyncLog` tak punya operasi hapus", **tak lagi berlaku** sejak SPEC-799/ADR-0119
  — `DELETE /custom-agents/:id` kini menerbitkan tombstone yang menghapus baris itu di setiap mesin.
  Keputusan immutable-nya tetap: id deterministik `"<scope>:<name>"` membuat rename = record lain,
  dan "hapus + buat baru" kini benar-benar bersih di semua instance.)*
- **Gotcha SQLite:** `@@unique([projectId, name])` **TIDAK** mencegah dua agen global bernama sama —
  pada indeks unik SQLite, **NULL saling berbeda**. Yang benar-benar mencegahnya adalah PK
  deterministik di atas; indeks itu tinggal jaring kedua untuk baris ber-project.
- **`mentions` tanpa FK**, jadi integritas ditegakkan di **boundary route** (rujukan tak dikenal →
  400; graf bersiklus → 409 + jalurnya) dan `DELETE /custom-agents/:id` **mencabut** nama itu dari
  `mentions` agen lain — cermin `dependsOn` (ADR-0093). Kolomnya dibaca **defensif** (`mentionsOf`/
  `toolsOf`/`runtimeOf`) karena bisa datang dari client versi lain.
- **`tools` punya TIGA nilai yang wajib tetap berbeda** (SPEC-484 · ADR-0101 keputusan 4): `null` =
  tak diisi (pakai `DEFAULT_AGENT_TOOLS`) · `[]` = sengaja tanpa tool · `["*"]` = semua tool yang
  dikenal katalog mesin ini. `["*"]` **di-expand** di `agentDefsFor()` sebelum `resolveTools`, tak
  pernah diteruskan apa adanya (claude **membuangnya senyap** → agen tanpa alat) dan tak pernah
  diterjemahkan jadi `null` (agen tanpa `tools` mewarisi **seluruh** tool termasuk `Task`, dan lapis
  2 anti-loop lenyap tanpa jejak). `runner/src/custom-agents.ts` karena itu tak pernah melihat `"*"`.

## GithubIssue (SPEC-471 · [ADR-0095](../adr/0095-tarik-issue-github-ke-backlog.md))

Cermin lokal issue GitHub sebuah project — **pola `Ticket`** (ADR-0062): sistem luar → record lokal
→ jembatan `accept` idempoten → `Spec`. hanoman **hanya membaca**; tak pernah menulis balik.

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | `String @id` | **Deterministik** `"<projectId>:<owner>/<repo>#<number>"` — bukan cuid. |
| `projectId` | `String` | FK `onDelete: Cascade`. Ikut di dalam `id` karena dua project boleh menunjuk repo yang sama. |
| `repoSlug` · `number` | `String` · `Int` | Asal issue di GitHub. |
| `title` · `body` · `authorLogin` · `labels` · `url` | | Konten issue; **disegarkan** tiap tarikan. `labels` = `Json` array string. |
| `issueState` | `String` | `open` \| `closed` — keadaan **di GitHub** saat ditarik. Berbeda dari `status`. |
| `status` | `String` | `new` \| `accepted` \| `rejected` — keputusan **triase operator**. |
| `specId` | `String?` | Soft-link `Spec`. **Tanpa FK** (cermin `Ticket.specId`). |
| `issueCreatedAt` · `issueUpdatedAt` · `pulledAt` | `DateTime` | Dua yang pertama milik GitHub; `pulledAt` milik hanoman. |
| `version` | `Int` | Version-stamp sync (ADR-0045). Ikut `SYNCED`/`FIELDS`/`DATE_FIELDS`. |

- **Kenapa `id` deterministik.** Alasan yang sama dengan `CustomAgent`: baris ini menyeberang
  changefeed, dan dengan id acak dua mesin yang menarik repo yang sama melahirkan **dua baris**
  untuk satu issue. Dengan id deterministik keduanya baris yang **sama**.
- **Kenapa `specId` tanpa FK.** Changefeed bisa memancarkan `GithubIssue` **sebelum** `Spec`-nya
  mendarat; FK akan menolaknya (kelas SPEC-382). Integritasnya ditegakkan di jalur `accept`.
- **`status` & `specId` KEBAL tarik-ulang.** `pullIssues` hanya memperbarui kolom konten. Bila
  keduanya ikut di-`update`, issue yang sudah diterima kembali `new` dan accept berikutnya
  melahirkan **`Spec` kedua** untuk issue yang sama — inti jaminan "1 per 1".
- **Keduanya ikut `FIELDS.githubIssue`** justru supaya keputusan triase terlihat sama di semua
  mesin. Kolom yang terlewat di `FIELDS` mendarat sebagai **default palsu** tanpa satu pun error
  (kelas ADR-0090/0093/0094).

## Changelog (SPEC-516 · [ADR-0105](../adr/0105-changelog-per-project.md))
Changelog naratif per project yang **sudah dibangkitkan** — teks pendek berorientasi pemakai, hasil
dari salah satu tiga mode: rentang tanggal atas backlog `done` (`Spec.doneAt`), rentang SHA commit,
atau versi/tag rilis.

- Kolom: `id` (cuid), `projectId` (FK → `Project`, **cascade**), `mode` (`backlog|commit|version`),
  `title`, `params` (Json — permintaan apa adanya, `zChangelogRequest`), `body` (markdown final,
  sudah lewat `scrubOutput`), `generator` (`agent|fallback`), `warning?`, `itemCount`,
  `createdAt`/`updatedAt`. Index `(projectId, createdAt)`.
- **LOCAL-only — TANPA kolom `version`**, jadi ia tak pernah masuk changefeed sync (cermin
  `LeadFlow`, `WebhookEndpoint`, `Project.autoMerge`): dua dari tiga modenya diturunkan dari
  **checkout git di mesin ini**, jadi barisnya fakta lokal. Yang portabel adalah keluarannya, dan
  jalannya sudah ada — unduh `.md` lewat `?download=` ([ADR-0078](../adr/0078-unduh-dokumen-md-pdf.md)).
- **Disimpan, bukan diturunkan** — berlawanan dengan ADR-0018 dan disengaja: tiap pembangkitan ulang
  membakar satu panggilan agen. `generator: "fallback"` menandai baris yang lahir dari draf
  deterministik karena agen gagal/tak terpasang; `warning` menyimpan alasannya + catatan cakupan.
- **Wajib ada di `PG_ORDER`** (`cli/src/commands/migrate-pg.ts`), **sesudah `Project`** —
  `cli/test/migrate-pg.test.ts` menuntut daftar itu sama persis dengan model DMMF, dan itulah
  satu-satunya gerbang yang menangkap model baru yang lupa didaftarkan.
- **Sengaja BUKAN `WEBHOOK_ENTITIES`** (ADR-0100): artefak yang dibangkitkan atas permintaan, bukan
  perubahan keadaan yang perlu disiarkan.

## Docs (Source of Truth) — TIDAK dipersist
Docs bukan entitas DB. Tabel `DocFile` sudah di-drop (ADR-0011). Docs dibaca **live dari path
efektif** (`resolveRepoDir` = binding per-mesin ?? `Project.repoDir` — SPEC-217): korpus = semua
`**/*.md` via `git ls-files`, dikelompokkan per direktori, `linked` = reachable dari root index
(`internal/docs/README.md`) lewat graf link Markdown.
- coverage = % direktori (berskor, di bawah `docsDir`) yang seluruh Markdown-nya reachable dari index.
  **Tidak dipersist**: `toProjectView` menghitungnya dari path efektif setiap kali project dibaca (ADR-0018).

## PRD (SPEC-210 · [ADR-0041](../adr/0041-prd-sebagai-dokumen-flow-project-level.md))
PRD **bukan entitas DB** — ia dokumen `docs/prd/<slug>.md` di repo project (konsisten ADR-0011).
Dibuat oleh **flow sesi `prd`** (project-level, tanpa `Spec`; pipeline `Brainstorm → PRD`), meniru
`reverse`: worktree isolasi, brainstorm interaktif, push ke branch `prd/<slug>`, manusia merge.
List/preview **freshest-wins** (worktree sesi `prd` hidup > `repoDir`). "Take ke backlog" kini
**pemilih dua jalur** (SPEC-407/ADR-0089): *sebagai feature brief* — `Spec` source `brief`
ter-prefill dari PRD, tautan balik dibawa teks Konteks ("Dari PRD: <path>") bukan field payload
(zBriefPayload strip key tak dikenal) — atau *sebagai goal*: `Spec` source `goal` ber-`payload.goal`
`"Wujudkan PRD <path>"`. Keduanya membawa `branchFrom = prd/<slug>` (SPEC-244). Set flow sesi kini:
`feature | qa | scaffold | reverse | prd | audit | breakdown | goal` (audit =
SPEC-237/ADR-0057; breakdown = SPEC-273/ADR-0069; goal = SPEC-407/ADR-0089). Sesi shell "terminal biasa" (SPEC-236/ADR-0056) **tanpa flow** — bukan pipeline,
tak menggerakkan stage; ditandai wire `{project, shell:true}`.

**Status PRD (SPEC-520)** — **nilai turunan, bukan kolom** (ADR-0018/0019; PRD memang bukan
entitas DB sehingga tak ada tempat menyimpannya). `PrdDoc` membawa `status` (`draft` ·
`dieskalasi` · `terwujud`) + `specCount`/`doneCount`, dihitung `prdStatusOf()`
(`shared/src/prd-status.ts`, murni) atas baris `Spec` project itu: nol turunan → `draft`;
ada turunan tapi belum semuanya `done` → `dieskalasi`; semuanya `done` → `terwujud`.
Kandidat **wajib** disaring `projectId` lebih dulu — dua project boleh punya
`docs/prd/<slug>.md` bernama sama. Dua kunci jejak: **K1** path PRD **utuh** muncul di
`payload.context` (`Dari PRD: <path>` / `Dari PRD (breakdown): <path>`) atau `payload.goal`
(`Wujudkan PRD <path>`) — menanggung 25 dari 25 baris berjejak di instalasi hidup; **K2**
`branchFrom === "prd/<slug>"` (SPEC-244) — nol tambahan hari ini, dipasang untuk backlog yang
dibuat manual dari branch PRD. **Gotcha:** cocokkan **path utuh, bukan kata "PRD"** — SPEC-244,
SPEC-273, dan SPEC-407 memuat kata itu di prosanya tanpa path apa pun, dan akhiran `.md`
sekaligus yang membuat slug berawalan sama tak saling cocok (`docs/prd/auth.md` bukan substring
`docs/prd/auth-device.md`). Baris prosa `> Status: Draft …` di dalam dokumen PRD **bukan**
sumbernya: ia ditulis agen sekali saat PRD lahir dan tak punya penulis kedua. Field `live`
(freshest-wins worktree sesi `prd`) menjawab pertanyaan lain dan tetap ortogonal — lencananya
karena itu berbunyi **`sesi hidup`**, bukan lagi `draft hidup`.

**Breakdown PRD (SPEC-273 · [ADR-0069](../adr/0069-breakdown-prd-ke-backlog-paralel.md))** — juga **bukan
model DB**. Manifest = dokumen `docs/prd/<slug>.breakdown.md` (sibling PRD, dikecualikan dari daftar PRD);
backlog hasil = baris `Spec` biasa (`source:"brief"`) dibuat lewat `POST /specs/batch`. Provenance PRD di
teks Konteks payload, bukan kolom. **Tanpa migration.**

## Docs sebagai konvensi, bukan lagi gerbang
Fase Execute **tidak** lagi diverifikasi terhadap DocIndex sebelum jalan — guardrail Source of
Truth dicabut (SPEC-160/ADR-0023, supersedes ADR-0001). `internal/docs/**` tetap Source of Truth
secara konvensi; coverage/DocIndex tetap dihitung dan ditampilkan (di atas), hanya tidak lagi
memblokir apa pun.

## Telegram channel state (SPEC-476 · [ADR-0096](../adr/0096-telegram-gateway-session-operator-persisten.md))

Tujuh model LOCAL-only menyimpan state yang tidak dapat diturunkan kembali sesudah restart:
`TelegramGatewayState` (offset/readiness), `TelegramChat` (binding session + active context + summary),
`TelegramUpdate` (dedupe/status/digest tanpa teks), `TelegramMemory` (curated memory per-item),
`TelegramOutbox` (delivery state + reply sanitized), `TelegramConfirmation` (approval inline
single-use), dan `TelegramAudit` (jejak metadata/action tanpa body/header).

Mereka tidak punya `version`, tidak masuk `SYNCED`, dan tidak memanggil `notifySynced`: chat/bot/tmux
melekat pada satu mesin. Tetap ikut `PG_ORDER` agar instalasi Postgres lama yang sudah memakai gateway
dapat dimigrasikan. Tidak ada FK ke Project/Spec/session tmux; referensi boleh hilang sementara jejak
harus bertahan. `TelegramUpdate`/audit tidak pernah menyimpan isi inbound — hanya SHA-256 digest.

`Setting.telegram = { enabled:false, progress:true }` tetap berada di kolom JSON singleton (tanpa
migration). Personality menunjuk id `CustomAgent`; summary dan memory hanya ditulis dari amplop hasil
kurasi session operator yang sama, bukan dari transcript mentah atau model summarizer kedua.

## Webhook keluar (SPEC-481 · [ADR-0100](../adr/0100-webhook-keluar-peristiwa.md))

Dua model, keduanya **LOCAL-only** — tak pernah disync (cermin `AgentToken`/`RuntimeConfig`):
barisnya memegang secret dan menunjuk pengiriman dari **mesin ini**. Tanpa kolom `version`, tanpa
`notifySynced`. Keduanya wajib ada di `PG_ORDER` (`cli/src/commands/migrate-pg.ts`) — test DMMF
merah bila lupa.

**`WebhookEndpoint`** — `id` · `name` · `url` · `secret` (ciphertext `enc:v1:`, ADR-0097) ·
`events` (`Json` string[]; `["*"]` = semua, `"spec.*"` = satu keluarga) · `projectIds`
(`Json?`; null = semua project) · `enabled` · `allowPrivate` (izin **eksplisit** alamat
internal/loopback) · `apiVersion` · `maxPerMinute` · `disabledAt`/`disabledReason` ·
`lastSuccessAt`/`lastFailureAt`/`failureStreak` · `createdAt`/`updatedAt`.

**`WebhookDelivery`** — satu tabel merangkap **antrean dan riwayat**. `endpointId` (FK cascade) ·
`eventId` (SAMA untuk semua endpoint dari satu peristiwa) · `eventType` · `projectId` ·
**`payload`** · `status` (`pending|sending|sent|failed|dropped`) · `attempt`/`maxAttempts` ·
`nextAttemptAt` · `httpStatus`/`durationMs`/`error` · `createdAt`/`sentAt`.

`payload` disimpan **per baris**, bukan dirender ulang saat kirim: retry wajib mengirim byte yang
persis sama supaya `id` peristiwa stabil dan idempotensi penerima berlaku, dan riwayat harus
memperlihatkan apa yang **benar-benar dikirim**, bukan keadaan hari ini. Retensi
`WEBHOOK_HISTORY_KEEP = 200` baris per endpoint, dipangkas worker; baris yang masih mengantre tak
pernah ikut dipangkas.

Peristiwanya sendiri **bukan** kolom di mana pun: ia diturunkan tap Prisma dari perubahan baris
model yang dienumerasi `WEBHOOK_ENTITIES` (`@hanoman/shared`), dengan **allowlist field** sebagai
pagar data sensitif sekaligus kontrak payload.
