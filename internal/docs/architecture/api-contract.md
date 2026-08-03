# API contract

REST + **WebSocket (terminal + events)** + HTTP GET (initial load). Semua di bawah `/api`. Tidak
ada SSE, tidak ada `/runs`, `/triggers`, maupun `/webhooks` — dicabut bersama runner headless
(ADR-0024). Data real-time dashboard (backlog/sesi/notifikasi/limits/vps) **didorong** lewat satu
WebSocket siar `GET /events/ws` (SPEC-199, ADR-0039) — bukan lagi polling. Terminal PTY punya
WebSocket per-sesi tersendiri. Endpoint HTTP GET tiap sumber tetap ada untuk paint pertama.

> **MCP adalah KLIEN kontrak ini, bukan permukaan kedua** (SPEC-482 · ADR-0099). `hanoman mcp`
> memanggil endpoint di dokumen ini lewat HTTP dengan agent token yang sama, jadi tak ada satu pun
> endpoint yang lahir untuknya dan gate `onRequest` tetap satu-satunya otorisasi. Katalog toolnya
> ada di `shared/src/mcp-catalog.ts`, dan `server/test/mcp-capability.test.ts` mengikat capability
> yang dijanjikan tiap tool ke `capabilityForRoute` — kalau peta route→capability berubah dan
> katalognya tidak, testnya merah. Tool yang **mengeksekusi** (`POST /terminal/sessions`, seluruh
> `/vps*`) berikut `integrate`, `DELETE /specs/:id`, dan `PATCH /specs/:id {stage}` sengaja **tak
> punya tool**.

> **Auth (SPEC-169, ADR-0028):** semua endpoint butuh sesi valid (cookie `hn_session`) — gate
> `onRequest` membalas **401** tanpa sesi. Publik tanpa sesi hanya: `GET /health`,
> `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`, dan `GET /agent-integration.md`
> (SPEC-489 · panduan AI agent, lihat bagiannya di bawah).
>
> **Agent token (SPEC-257 · ADR-0065):** jalur auth **kedua** untuk AI agent eksternal —
> `Authorization: Bearer <token>` (upgrade WebSocket: `?agent_token=`) digerbang gate yang sama,
> lalu ditegakkan **capability per-domain read/write** (write⊇read). Cookie sesi = akses penuh (tak
> ada RBAC); agen tanpa capability → **403** `{ need }`; master switch `Setting.agentAccessEnabled` off →
> **401**. Lihat `## Agent tokens` di bawah.

## Auth
```
GET  /auth/status         -> { needsSetup: bool, user: {id,email,createdAt}|null }   # publik
POST /auth/setup          { email, password }   # HANYA saat 0 user; set cookie; 409 bila sudah ada; 400 body cacat
POST /auth/login          { email, password }   # set cookie; 401 generic; 429 throttled; 400 body cacat
POST /auth/logout         # 204; hapus sesi + clear cookie
GET  /auth/users          -> UserView[]                          # sesi
POST /auth/users          { email, password }   -> UserView      # invite (set password langsung); 409 email dipakai
DELETE /auth/users/:id    # 204; 400 bila user terakhir
POST /auth/change-password { currentPassword, newPassword }  # 200 + cookie baru (cabut sesi lain); 400 password lama salah
#   UserView = { id, email, createdAt } — tak pernah membawa passwordHash. password min 8 saat setup/invite/ganti.
```

## Projects
```
GET  /projects?q=&page=&limit=      # -> { items: ProjectView[], total, page, pageSize } (SPEC-198)
#   q menyaring name+desc+stack; tanpa page/limit → seluruh item. coverage/docStatus tetap live-scan tiap panggil.
POST /projects            { name, kind, repoDir?, desc, gitRemote? }   # repoDir OPSIONAL (SPEC-217)
#   SPEC-222 · kind "from-scratch" + repoDir → hanoman `git init` + commit awal (siap scaffold); gagal init → 400
GET  /projects/:id        # view memuat `repoDir` (default project) + `binding` (override per-mesin | null)
PATCH /projects/:id       { name?, desc?, gitRemote?, repoDir?, schedulerOptIn?, leadOptIn?, autoMerge? }   # 200 view; 400 name kosong; 404 tak ada.
#   `id` tak tersentuh oleh PATCH — rename lewat endpoint khusus di bawah (SPEC-255/ADR-0064).
#   SPEC-217 · `repoDir` (path default/server) kini editable; `null` mengosongkan.
#   SPEC-486 · ADR-0103 · `autoMerge` = kebijakan auto-merge saat backlog selesai
#   ({mode:"off"|"default-branch"|"branch", dest:"local"|"origin", branch, deleteBranch}); `null`
#   mengosongkan → tanpa auto-merge. Digerbangi `checkAutoMerge` terhadap repo EFEKTIF:
#   409 bila mode≠off sementara project belum punya repoDir; 400 bila mode "branch" tanpa branch,
#   branch tak ada di daftar `dest`-nya (daftar yang memasok dropdown = daftar yang menjaga gerbang,
#   SPEC-143/ADR-0032), atau mode "default-branch" sementara default branch tak bisa diresolve.
#   Mematikan (mode "off" / null) SELALU boleh — jangan kunci pintu keluar.
POST /projects/:id/rename { newId }   # 200 { id, helpUrl?, affected } · rename slug (SPEC-255/ADR-0064).
#   Transaksional: Project.id + cascade FK OTOMATIS (spec/ticket sudah ON UPDATE CASCADE) + update manual ref longgar
#   (notification/sessionResult/ticketAttachment) + pindah LocalBinding + naikkan version. Merambat ke
#   hub sync (penanda renamedFrom) → Help /help/<id> ikut ganti. `affected` = jumlah record
#   tersentuh per tabel. 400 slug invalid (^[a-z0-9][a-z0-9-]*$); 404 project; 409 id terpakai / ada sesi aktif.
GET  /projects/:id/branches  -> { branches: string[], remotes: string[], defaultBranch: string|null }   # dari path EFEKTIF (resolveRepoDir). [] bila tanpa repo. 404 project tak ada. remotes memasok target rebase/merge (SPEC-175).
#   SPEC-486 · ADR-0103 · `defaultBranch` = origin/HEAD → main → master → null (JANGAN hardcode
#   "main", SPEC-227/ADR-0077). Memasok label opsi "default branch repo" di kartu auto-merge;
#   nilai sebenarnya tetap diresolve ULANG saat sweep berjalan, bukan dibekukan ke setting.
DELETE /projects/:id      # 409 bila ada sesi tmux aktif milik project; cascade ke spec.
#   Worktree on-disk di <repoDir>/.worktrees/ tidak ikut dibersihkan.

# SPEC-213/217 · path per-mesin (LocalBinding, LOCAL-ONLY — TAK PERNAH disync). Menang atas Project.repoDir.
GET    /projects/:id/binding  -> { repoDir: string | null }   # nilai override mesin ini
PUT    /projects/:id/binding  { repoDir }   # 200 { repoDir }; set override; 400 kosong; 404 project.
DELETE /projects/:id/binding  # 204 · kosongkan override → path efektif jatuh ke Project.repoDir (SPEC-217). 404 project.
POST   /projects/:id/clone    { dir }   # 201 { repoDir } · git clone gitRemote→dir lalu set binding; 409 tanpa gitRemote / clone gagal.

# SPEC-253 · ADR-0062 · Help Center per project (opt-in). Link publik terikat Project.id (slug).
GET    /projects/:id/help-center  -> { enabled, publicUrl }   # 404 project.
POST   /projects/:id/help-center  -> 200 { enabled:true, publicUrl }   # aktifkan. 404.
DELETE /projects/:id/help-center  # 200-ish 204 · nonaktifkan (tak hapus tiket yang sudah ada). 404.

```

> **Path efektif** project = `resolveRepoDir(projectId)` = **binding per-mesin ?? `Project.repoDir`** (null-safe).
> Dipakai SELURUH jalur baca — spawn/terminal, IDE, coverage/docStatus, branches, buat/review/integrate spec,
> docs, PRD, spec-docs, stage-artifacts (SPEC-217). `Project.repoDir` & `LocalBinding` sama-sama **tak disync**.
> Coverage/docStatus di-scan **live** tiap `GET /projects` (ADR-0018) — tak ada cache, tak ada `POST /scan`.

## Backlog / specs
```
GET  /specs?project=&source=&q=&stage=&priority=&startable=&dateField=&from=&to=&page=&limit=
#   -> { items: Spec[], total, page, pageSize }. SELALU envelope (SPEC-198).
#   Overlay stage-live dari phase-file + write-through CAS + notifikasi `done` jalan atas SET PENUH
#   (scope project/source). Search/filter (q atas id+title+objective, stage, priority, startable=live≠done)
#   & paginasi diterapkan DI MEMORI SETELAH overlay — filter stage cocok ke stage LIVE, bukan DB.
#   Tanpa page/limit → seluruh item terfilter (page 1, pageSize=total). Lihat ADR-0038.
#   SPEC-408 · ADR-0090 · rentang tanggal: `dateField` = created (default) | started — sumbu
#   `Spec.createdAt` atau `Spec.startedAt`; `from`/`to` = `YYYY-MM-DD` INKLUSIF (boleh sendirian),
#   di-parse di zona waktu LOKAL SERVER (`from` 00:00:00.000, `to` 23:59:59.999) — `new Date("…")`
#   polos akan menaruh batasnya di tengah malam UTC dan membuang hampir seluruh hari `to` di WIB.
#   String bukan-tanggal DIABAIKAN (filter mati), bukan 400 — konsisten dgn stage/priority; tanggal
#   yang tak ada (2026-02-30) juga null, tidak digulirkan. `dateField=started` MEMBUANG item
#   ber-`startedAt` null (belum pernah dikerjakan — pakai `startable` untuk itu). Filternya sebidang
#   dengan yang lain di layer response, jadi `total` di envelope ikut menyusut.
#   SPEC-447 · ADR-0093 · tiap Spec membawa `dependsOn: string[]` (kolom, dinormalkan dari `Json?`)
#   dan `blockedBy: {id, reason:"missing"|"unfinished"|"unmerged"}[]` — TURUNAN (bukan kolom),
#   dihitung `liveSpecs()` dari stage dependency + `git merge-base --is-ancestor` (memo 15 dtk).
#   Dihias di `liveSpecs` supaya endpoint ini dan grup siar WS `specs` tak pernah drift (SPEC-199).
#   `blockedBy` kosong = boleh diluncurkan. Backlog tanpa dependency: nol query & nol git tambahan.
#   SPEC-475 · "ujung kerja" dependency = `headSha` ?? tip branch sesinya (`hanoman/<sessionId>`,
#   memo 15 dtk) — kolom `headSha` sendirian kosong pada ~76 % item `done` ber-worktree, sehingga
#   membacanya begitu saja membuat `unmerged` tak pernah muncul. Tak ada jejak sama sekali = siap.
POST /specs               { project, source, ...payload, branchFrom? }  -> SPEC-n
POST /specs/batch         { project, items:[BreakdownItem], branchFrom?, prdPath? } -> {created:[Spec]}
#   SPEC-273 · ADR-0069 · materialize breakdown: N spec `source:"brief"` independen (id berurutan via
#   nextSpecId+retry), provenance PRD di teks Konteks. 400 items kosong / branch tak dikenal; 404 project.
#   BreakdownItem = { title, context, outcome, priority:"tinggi"|"sedang"|"rendah" }.
#   source ∈ brief|qa|audit|help|goal (SPEC-237/253/407). audit = audit-only (payload
#   brief-shaped, author `Audit ·`); qa payload ber-severity (superRefine mengikat source↔bentuk payload,
#   TIGA-arah sejak SPEC-407). audit → flow `audit` (Audit → Laporan, dokumen SoT tanpa Execute; ADR-0057).
#   SPEC-407 · ADR-0089 · source `goal` → flow `goal` (Goal → Verifikasi): payload bentuk KETIGA
#   { goal, done, constraints, priority } — `goal` WAJIB, `Spec.objective` diturunkan darinya (`done`
#   sebagai cadangan), author `Goal ·`. Payload brief/qa untuk source goal (atau sebaliknya) → 400.
#   Client memetakan source→flow via flowForSource.
#   SPEC-340 · ADR-0076 · eskalasi audit → backlog: payload boleh membawa `fromAudit:"SPEC-n"` untuk
#   source `qa` (ADR-0059, lewati fase Audit) MAUPUN `brief` (baca dokumen audit sbg bahan Brainstorm/
#   Objective, tanpa `skipped`). Pasangannya branchFrom `hanoman/<audit-id>` agar dokumen audit ada di worktree.
#   404 bila project tak dikenal; 400 bila branchFrom tak ada di refs/heads repo project.
#   SPEC-447 · ADR-0093 · `dependsOn?: string[]` — backlog yang harus selesai & ter-merge lebih dulu.
#   Divalidasi di boundary (tak ada FK untuk kolom Json): id harus ADA, berada di PROJECT YANG SAMA,
#   bukan diri sendiri → 400 dengan alasannya. Siklus mustahil di POST (spec baru belum bisa dirujuk).
PATCH /specs/:id          { branchFrom?: string|null, stage?, confirmDelete?, dependsOn?, autoMerge? }   -> Spec
#   branchFrom null = kembali ke default project (main); menentukan basis sesi BERIKUTNYA. Lihat ADR-0032.
#   stage = revert backward-only atas perintah human (SPEC-167/ADR-0027): 422 bila maju/sama,
#   400 bila stage tak dikenal. Bila mundur menghapus artefak docs & confirmDelete≠true →
#   200 { pending:true, stage, wouldDelete:string[] } (dry-run, tak mengubah apa pun);
#   confirmDelete:true → hapus artefak + set stage. Sesi tetap forward-only (ADR-0008/0024).
#   SPEC-447 · ADR-0093 · `dependsOn?: string[]` (`[]` mengosongkan). Validasi POST + **deteksi
#   siklus** (reachability atas graf project sesudah perubahan) → 400. SENGAJA DI LUAR gerbang edit
#   SPEC-186 (`stage=brainstorming ∧ baseSha=null`): ia menggerbangi peluncuran BERIKUTNYA, bukan
#   konten sesi berjalan — menguncinya membuat item yang terlanjur terblokir salah tulis hanya bisa
#   dibebaskan dengan menghapusnya.
#   SPEC-486 · ADR-0103 · `autoMerge?` = override kebijakan auto-merge item ini; `null` mengembalikan
#   ke WARISAN PROJECT, sedangkan `{mode:"off"}` MEMATIKANNYA untuk item ini saja — dua keadaan
#   berbeda. Gerbang & kode galat sama persis dengan PATCH /projects/:id. Juga di luar gerbang edit
#   SPEC-186, alasan yang sama dengan dependsOn.
DELETE /specs/:id
#   SPEC-447 · ADR-0093 · id yang dihapus juga DICABUT dari `dependsOn` seluruh spec lain di project
#   yang sama (+ antre sync per baris yang berubah). Tanpa itu, dependent-nya terkunci selamanya
#   dengan alasan `missing` yang tak bisa diperbaiki dari UI.
GET  /specs/:id/docs                   # daftar dokumen superpowers backlog ini (audit/spec/plan/objective/brainstorm) — SPEC-170
#   kind audit = `*-audit.md` ATAU `…/research/audit-…` (SPEC-237/ADR-0057) — dokumen audit SoT ikut tampil sbg audit
GET  /specs/:id/docs/*path             # isi satu dokumen superpowers (raw)
GET  /specs/:id/escalation             # SPEC-340 · ADR-0076 · { escalation, docPath, live } — rekomendasi
#   tindak lanjut audit, DITURUNKAN dari blok ```json di dokumen audit (bukan kolom DB; ADR-0018/0011).
#   escalation = { target:"none"|"qa"|"brief"|"prd", reason, alternatives:[target], prefill:{title,
#   context,outcome,constraints,severity,steps} }. Dokumen dibaca freshest-wins (cwd sesi hidup >
#   repoDir) lewat listSpecDocs kind `audit`; live=true saat dari worktree sesi. Tanpa dokumen / tanpa
#   blok / json rusak / target tak dikenal → 200 { escalation:null } (keadaan normal, bukan error).
#   404 hanya bila spec tak ada.
GET  /specs/:id/review                 # { base, files:string[], changed:{path,add,del,status,binary}[] }  (SPEC-171)
#   worktree hidup <repoDir>/.worktrees/<specid> → diff working tree, base = merge-base(branchFrom‖main, HEAD).
#   worktree lenyap (done) → diff baseSha..headSha tersimpan (SPEC-176, ADR-0030), fallback grep (spec-N) utk spec lama.
#   files = git ls-files (tracked ∪ untracked-tak-ignored, minus --deleted). 409 bila tak ada sumber apa pun.
GET  /specs/:id/review/*path           # { path, status, binary, truncated, diff, content }  isi 1 file (256 KB)
#   404 bila path di luar (files ∪ changed) — sekaligus gerbang path traversal.
POST /specs/:id/integrate     { op:"merge"|"rebase", target:"local:<b>"|"origin:<b>" }  (SPEC-175 · ADR-0031)
#   Rebase/merge branch hasil done spec `hanoman/<id>`. Hanya stage `done` (else 409). Server jalankan git
#   di worktree isolasi <repoDir>/.worktrees/merge-<id>, TAK menyentuh working tree utama.
#   merge → target: base tip target, `git merge` branch spec; bersih → target lokal: `git branch -f` bila branch
#     tak di-checkout, else fast-forward `git merge --ff-only` di worktree pemiliknya (409 bila working tree
#     kotor/bukan-ff — commit/stash lalu ulangi atau pilih origin); target origin `git push` (409 non-ff). rebase → replay branch
#     spec di atas target, bersih → `git push --force-with-lease` ke hanoman/<id>.
#   Bersih → 200 { status:"clean", detail }. Conflict → 200 { status:"conflict", sessionId } — sesi agen di
#     worktree konflik itu menyelesaikannya (dibuka di Terminal). 400 op/target invalid; 409 non-done/source hilang.
#   SPEC-377 · sesi konflik itu lahir dari Setting.agent + model/effort blok agen itu (codex →
#     ensureCodexTrust dulu), sama seperti POST /terminal/sessions/:id/integrate. Body tak menerima
#     agent/model/effort — pilihan agen hidup di Settings, bukan per-request.
```

## Docs (project SoT)
```
GET    /projects/:id/docs               # index + coverage + tree kategori, live-scanned dari repoDir
GET    /projects/:id/docs/*path         # isi file .md asli (raw, dari disk)
PUT    /projects/:id/docs/*path         { content }   # tulis file .md asli; 400 kalau path keluar repo / bukan .md
DELETE /projects/:id/docs/*path         # hapus file .md asli di disk; 204 sukses, 404 tak ada, 400 guard
GET    /prds                            # SPEC-210 · { items:[PrdDoc] } daftar PRD LINTAS-project (filter "Semua project")
GET    /projects/:id/prds               # SPEC-210 · { items:[PrdDoc] } dokumen docs/prd/*.md project itu
GET    /projects/:id/prds/*path         # SPEC-210 · isi PRD; 404 bila path bukan docs/prd/*.md
GET    /projects/:id/breakdown?prd=<path> # SPEC-273 · ADR-0069 · { items:[BreakdownItem], live } dari
#   manifest docs/prd/<slug>.breakdown.md (freshest-wins). Manifest belum ada / prd non-PRD → { items:[] }.
#   Manifest bukan PRD → dikecualikan dari daftar/isi PRD di atas.
```

### Unduh dokumen (SPEC-361 · ADR-0078 · diperluas SPEC-385)

Sembilan endpoint menerima query **opsional** `?download=md|pdf`. Tak ada endpoint ekspor
terpisah — pola sama dengan `GET /projects/:id/archive` (SPEC-233).

**Endpoint dokumen** (SPEC-361) — badan respons normalnya `{path, content}`:

| Endpoint | Prefix nama berkas |
|---|---|
| `GET /specs/:id/docs/*path` | `<specId>` |
| `GET /projects/:id/prds/*path` | `<projectId>` |
| `GET /projects/:id/docs/*path` | `<projectId>` |
| `GET /projects/:id/file?path=&ref=` | `<projectId>` (+`-<ref>` bila melihat ref tertentu) |

**Endpoint review & diff** (SPEC-385) — badan respons normalnya `ReviewFile`; yang diunduh adalah
`ReviewFile.content`, yaitu isi **sesudah** perubahan, persis yang dirender pratinjaunya:

| Endpoint | Prefix nama berkas |
|---|---|
| `GET /specs/:id/review/*path` | `<specId>` |
| `GET /terminal/sessions/:id/review/*path` | `<sessionId>` |
| `GET /projects/:id/file-diff?path=[&staged=1]` | `<projectId>` |
| `GET /projects/:id/commit/:sha/file?path=` | `<projectId>-<sha8>` |
| `GET /projects/:id/compare/file?from=&to=&path=` | `<projectId>-<to8>` |

- `download=md` → `200 text/markdown; charset=utf-8`, badan = sumber Markdown mentah.
- `download=pdf` → `200 application/pdf`, dirender server-side dari token `marked` (parser yang
  sama dengan preview) lewat `services/doc-export.ts`.
- Keduanya menyetel `content-disposition: attachment; filename="<prefix>-<basename>.<ext>"`.
- Nilai lain **atau query absen** → respons JSON lama (`{path, content}` untuk endpoint dokumen,
  `ReviewFile` untuk endpoint review/diff) **persis seperti sebelumnya**.
- 404 tetap 404. Berkas biner tak ditawari unduhan; di endpoint dokumen ia jatuh ke respons JSON
  biasa, di endpoint review/diff `sendReviewDownload` membalas **404** — begitu pula berkas yang
  **dihapus** (`content === null`), karena tak ada dokumen untuk dicetak dan string kosong akan
  menghasilkan PDF menyesatkan.
- Auth tak berubah: cookie sesi same-origin (ADR-0028); UI memakai `<a download>`, bukan `fetch`.

> **PRD (SPEC-210 · ADR-0041):** PRD = dokumen `docs/prd/<slug>.md` (bukan entitas DB). `PrdDoc` =
> `{slug,name,path,title,live,projectId,projectName}` (`projectId`/`projectName` menyertai tiap item agar
> view lintas-project mengelompokkan & membuka PRD ke project asalnya). List/baca **freshest-wins**:
> worktree sesi `prd` hidup untuk project ini > `repoDir` (pola SPEC-170). `GET /prds` mengiterasi semua
> project (project tanpa `repoDir` menyumbang `[]`). Dibuat lewat sesi `flow:"prd"` (lihat Terminal),
> di-take ke backlog lewat `POST /specs` (tautan PRD di teks Konteks brief).

> Docs dibaca/ditulis **live dari `Project.repoDir`** (tanpa salinan DB — ADR-0011). Korpus **browse** =
> semua `**/*.md` via `git ls-files`. `GET /docs` re-scan tiap panggilan, begitu pula `GET /projects`
> yang menurunkan `coverage`/`docStatus` per project (ADR-0018 — tak ada cache).
> Korpus **skor** = hanya file di bawah `docsDir` (default `internal/docs`) dikurangi index root;
> kategori di luarnya bertanda `scored: false`. SoT coverage = % kategori berskor yang seluruh
> Markdown-nya **transitif reachable** dari `docsDir/README.md` (ADR-0013).

## Changelog per project (SPEC-516 · [ADR-0105](../adr/0105-changelog-per-project.md))

Capability domain **`docs`** (bukan `projects`): changelog adalah dokumen, sejajar `docs`/`prds`.
Tanpa entri eksplisit di `capabilityForRoute` ia jatuh ke `rw("projects")` — artinya agen harus
dipercaya menyunting & menghapus project hanya untuk membacanya.

```
GET    /projects/:id/changelog/sources     -> ChangelogSources                        # docs:read · 404 project
GET    /projects/:id/changelog?page&limit  -> Paginated<ChangelogView>                # docs:read · 404 project
POST   /projects/:id/changelog             -> 201 ChangelogView                       # docs:write · 400 · 404 · 422
GET    /projects/:id/changelog/:cid        -> ChangelogView | berkas (?download=md|pdf) # docs:read · 404
DELETE /projects/:id/changelog/:cid        -> 204 | 404                               # docs:write
```

**Body `POST`** = `zChangelogRequest`, discriminated union ber-`mode`:

```jsonc
{ "mode": "backlog", "from": "2026-07-01", "to": "2026-07-31" }  // keduanya opsional → 30 hari terakhir
{ "mode": "commit",  "fromSha": "4f2a1c9", "toSha": "HEAD" }     // keduanya wajib (≥4 karakter)
{ "mode": "version", "fromTag": "v1.0.0", "toTag": "v1.2.0" }    // fromTag opsional → versi sebelumnya
```

**`ChangelogView`** = `{id, projectId, mode, title, params, body, generator:"agent"|"fallback",
warning, itemCount, createdAt}`. `body` adalah markdown final yang sudah di-scrub;
`warning` terisi saat narasi agen tak tersedia atau saat ada catatan cakupan.

**`ChangelogSources`** = `{hasRepo, tags[], head, reason, backlog:{doneCount,earliest,latest},
defaultRange:{from,to}}` — dipakai form untuk mengisi pilihan **sebelum** operator menekan tombol.

**Kode status yang mengikat.** Keadaan sah yang bukan galat **tidak pernah 500**:

| Keadaan | Jawaban |
| --- | --- |
| `from > to`, tanggal bukan `YYYY-MM-DD`, field mode kurang | **400** (zod, sebelum menyentuh repo) |
| project tak ada | **404** |
| repo belum ditautkan (mode commit & versi) | **422** `"project ini belum ditautkan ke repo di mesin ini"` |
| repo tanpa tag (mode versi) | **422** `"repo project ini belum punya tag rilis"` |
| revisi/tag tak dikenal | **422**, pesan menyebut revisi/tag-nya |
| rentang tanpa isi | **422**, bukan changelog kosong |
| agen gagal / CLI tak terpasang | **201** dengan `generator:"fallback"` + `warning` |

`GET …/changelog/sources` sengaja menjawab **200 dengan `reason`** (bukan 4xx) saat repo belum
ditautkan atau tanpa tag: ia menjawab "apa yang tersedia", dan "tidak ada, ini sebabnya" adalah
jawaban yang sah. Unduh memakai helper yang sama dengan dokumen lain
([ADR-0078](../adr/0078-unduh-dokumen-md-pdf.md)) — `?download=md` adalah bentuk yang dijanjikan,
`pdf` ikut karena helper-nya satu.

## IDE Visual (SPEC-182 · ADR-0034)
```
GET    /projects/:id/tree?ref=          # { ref, files:string[] }  ref kosong=working tree (ls-files), isi=ls-tree <ref>; 404 project tak ada
GET    /projects/:id/file?path=&ref=    # { path, content, binary, truncated }  disk / git show <ref>:<path>; 400 path keluar repo/.git; 404 file tak ada
GET    /projects/:id/working-status      # (SPEC-234) { branch, staged:ChangedFile[], unstaged:ChangedFile[] }  staged=index vs HEAD, unstaged=working tree vs index+untracked (temp-index); read-only, TAK digerbang sesi; repoDir kosong → {branch:"",staged:[],unstaged:[]}; 404 project tak ada. Path /working-status dibedakan dari /status milik SPEC-233 (repoStatus, baris di bawah) yang beda bentuk respons.
GET    /projects/:id/file-diff?path=&staged=  # (SPEC-234) ReviewFile diff satu file working tree; staged=1 → index vs HEAD, else working tree vs index; 400 path buruk/kosong; 404 file tak dalam changeset
PUT    /projects/:id/file               { path, content }   # tulis file ke working tree; 400 guard path. TAK digerbang sesi.
GET    /projects/:id/graph?limit=200    # { commits:{sha,parents,author,at,subject,refs[],tags[]}[], current }  git log --date-order
#   SPEC-233: tag dipisah dari refs (tags[]). Filter opsional ?branches=a,b (bukan --all) & showRemote=/showTags=false.
#   SPEC-351: limit = HALAMAN, bukan plafon. Tak ada cap server; client menaikkannya kelipatan 200 saat
#   operator menggulir ke kaki daftar. commits.length < limit = history habis (satu-satunya penanda akhir).
GET    /projects/:id/commit/:sha        # { sha,parents,author,at,subject,body,changed[], signed,committer,committedAt,authorEmail }  404 sha bukan hex / tak ada (SPEC-233)
POST   /projects/:id/git                { op, ...args, force? }   # { ok, stdout, stderr, current }
#   op ∈ checkout|branch|merge|cherry-pick|revert|delete-branch (+ SPEC-233 di blok Git graph parity). 400 op/field cacat; 400 tanpa repoDir.
#   merge menerima ff opsional (SPEC-193): absen=default git (ff bila bisa); "no-ff"=selalu merge commit; "ff-only"=ff saja (409 bila tak bisa). ff lain → 400.
#   merge menerima deleteBranch opsional (SPEC-193): setelah merge sukses, hapus branch itu lokal (-D) lalu origin bila remote-tracking-nya ada (git push origin --delete). "" → 400. Gagal salah satu langkah → 409 (merge tetap terjadi).
#   delete-branch menerima local?(default true)/remote? opsional (SPEC-206): local → git branch -d/-D; remote → git push origin --delete. local:false+remote → hapus origin saja (ref origin/<b> tanpa branch lokal). Gagal salah satu langkah → 409 (langkah sebelumnya sudah terjadi).
#   409 bila ada sesi aktif project (force melewatinya) ATAU git exit≠0 (stderr diteruskan). force → -f/-D.
```

> Semua bekerja pada **`Project.repoDir` (working tree utama)** — read diturunkan dari git tiap request
> (tanpa cache, cermin ADR-0018). Mutasi git digerbang sesi-aktif + tree-bersih dengan escape `force`
> (ADR-0034). Read-di-`ref` memungkinkan **melihat** branch local/origin tanpa checkout.

### Git graph parity (SPEC-233 · ADR-0055)
```
# Merge isolasi (SPEC-229/ADR-0053) — bentuk { status:"clean",detail } | { status:"conflict",sessionId }
POST   /projects/:id/git/merge          { source, ff?, deleteBranch? }   # merge → branch current, worktree isolasi
POST   /projects/:id/git/rebase         { onto }                         # rebase branch current → onto (isolasi + sesi agen)
POST   /projects/:id/git/pull           { source, ff? }                  # pull remote branch → current (isolasi + sesi agen)
POST   /projects/:id/git/drop           { sha }                          # buang satu commit dari branch current (isolasi + sesi agen)
#   SPEC-377 · sesi penyelesai konflik keempatnya lahir dari Setting.agent + model/effort blok agen itu
#   (codex → ensureCodexTrust dulu). Tak ada override per-request: pilihan agen hidup di Settings.
# Read live (ADR-0018) — tanpa cache/kolom DB
GET    /projects/:id/status             # { branch, ahead, behind, staged[], unstaged[], untracked[], clean }
GET    /projects/:id/stashes            # [{ ref, message, at }]
GET    /projects/:id/remotes            # [{ name, fetch, push }]
GET    /projects/:id/commit/:sha/file?path=       # { path,status,binary,truncated,diff,content }  diff commit vs parent
GET    /projects/:id/compare?from=&to=            # { from, to, changed:{path,add,del,status,binary}[] }
GET    /projects/:id/compare/file?from=&to=&path= # { path,status,binary,truncated,diff,content }
GET    /projects/:id/graph/search?q=&by=          # { shas:string[] }  by ∈ all|message|author|hash
GET    /projects/:id/archive?ref=&format=         # stream (download) git archive  format ∈ zip|tar; 400 ref tak valid
GET    /projects/:id/pr-url?branch=&base=         # { url:string|null }  URL "Create PR" dari origin (github/gitlab/bitbucket) atau null
POST   /projects/:id/remotes  {name,url} · PATCH /projects/:id/remotes/:name {url} · DELETE /projects/:id/remotes/:name   # → Remote[]; 400 field cacat; 409 git gagal
# Bersihkan branch tak terpakai (SPEC-360 · ADR-0077) — nilai turunan git, tanpa kolom DB
GET  /projects/:id/branches/unused?base=   # { base, baseRemote, current, branches:[{name,local,remote,lastCommit:{sha,at,subject}|null,locks[]}] }
#   Isi daftar = HANYA branch ter-merge ke base (git branch --merged); ref origin dibanding origin/<base>.
#   base: ?base= → main → master → branch aktif → "HEAD". TAK PERNAH hardcode "main" (SPEC-227).
#   base di-resolve ke SHA sebelum diberikan ke --merged: `--end-of-options` TAK bisa dipakai di sana
#   (git menelannya sebagai nilai --merged, lalu --format jadi argumen posisi). Hex tak pernah jadi flag (ADR-0032).
#   locks ∈ current|base|worktree|spec-open|session — kosong = boleh dihapus. base & current ikut tampil (terkunci).
#   `session` terpisah dari `worktree` karena sesi lahir --detach (ADR-0002) → tak muncul di `git worktree list`.
#   Disaring: baris `(no branch)` (dipancarkan saat dijalankan di worktree detached) & `origin/HEAD` (git memendekkannya jadi bare `origin`).
#   404 project tak ada; tanpa repoDir/bukan repo → { base:"", baseRemote:null, current:"", branches:[] }.
POST /projects/:id/branches/delete  { names:string[], scope?, base? }   # { base, results:[{name,ok,scope,error?}] }
#   scope ∈ local|remote|both (default both); menyempit per branch mengikuti ref yang benar-benar ada.
#   Menurunkan ulang daftar unused lalu memvalidasi tiap nama: di luar daftar / terkunci → baris ok:false.
#   Selalu 200 bila body sah — kegagalan hidup di baris results, bukan status HTTP. TAK PERNAH pakai -D/force.
#   TAK digerbang sesi aktif global (op ref-only, ADR-0055); pagarnya per-branch. 400 names/scope cacat, tanpa repoDir.
#   Capability agent: keduanya di domain `projects` (projects:read/write), BUKAN `ide` — cermin GET /branches lama.
# Isolasi (merge/rebase/pull/drop): { status:"clean",detail } | { status:"conflict",sessionId } | 400 body/target · 409 detached/source hilang/working-tree kotor
# Read (status/stashes/remotes/compare/search): 404 project tak ada; commit-file/compare-file: 400 path keluar repo · 404 tak ada
# GET /projects/:id/graph menerima filter opsional: ?branches=a,b&showRemote=&showTags= (default = --all lama)
# POST /projects/:id/git op += reset|reset-worktree|clean|tag|delete-tag|push-tag|stash|stash-apply|
#   stash-pop|stash-drop|stash-branch|rename-branch|push-branch|fetch. Gate sesi hanya untuk op yang
#   menyentuh working tree (touchesTree); tag/rename/push/fetch/stash-drop lolos gate (ADR-0055).
```

## Settings / notifications / limits
```
GET/PUT  /settings                      # Setting blob (zSetting): model, effort, autoDefault, autoScaffold,
#                                         notifyFail, notifyDone (bool), notifySound — SPEC-180. Tanpa dailyBudget/maxConcurrent.
#                                         model/effort = DEFAULT GLOBAL sesi baru (SPEC-252/ADR-0061); per sesi di-override saat Start.
#                                         phaseModels DICABUT (SPEC-252/ADR-0061) — baris lama yang masih memuatnya tetap parse (diabaikan).
#                                         goal { enabled:false, condition:"" } (SPEC-332/ADR-0073) — default global mode goal
#                                           sesi backlog; condition kosong = pakai default DoD bawaan. Blok selalu ADA di response
#                                           (zod .default()), jadi baris Setting lama tetap parse tanpa migration.
#                                         agent: "claude"|"codex" (default "claude") + codex { model:"gpt-5.6-sol",
#                                           effort:"xhigh" } (SPEC-338/ADR-0074) — mesin sesi default + katalog
#                                           model/effort codex. model/effort di akar TETAP milik claude.
#                                         conflict { enabled:false, agent:"claude", model:"claude-opus-5",
#                                           effort:"xhigh" } — SPEC-383/ADR-0081 · default KHUSUS sesi
#                                           penyelesai konflik rebase/merge (3 pintu: POST /specs/:id/integrate,
#                                           POST /projects/:id/git/{merge,rebase,pull,drop}, POST
#                                           /terminal/sessions/:id/integrate). OPT-IN: enabled:false →
#                                           mewarisi default global (agent + model/effort agen itu) persis
#                                           seperti sebelum SPEC-383. Satu triple (bukan blok per-agen):
#                                           menukar `agent` menukar model/effort sekalian. Effort codex
#                                           dikoersi saat dibaca (coerceCodexEffort). Blok selalu ADA di
#                                           response (zod .default()) → baris Setting lama tetap parse,
#                                           TANPA migration. Tak ada override per-request di body integrate.
#                                         verifyScope: "changed"|"full" (default "changed") — SPEC-376/ADR-0080 ·
#                                           scope verifikasi default sesi backlog; per sesi di-override saat Start.
#                                           Kunci selalu ADA di response (zod .default()), jadi baris Setting lama
#                                           tetap parse tanpa migration.
#                                           Keduanya .default() → baris lama tetap parse, TANPA migration.
#                                         SPEC-339 · blok codex dinormalkan saat DIBACA: model pensiun
#                                           (gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark) → gpt-5.5, lalu effort
#                                           dikoreksi ke yang didukung model itu (mis. luna+ultra → xhigh).
#                                           Server tetap lenient (z.string()); PUT nilai apa pun diterima,
#                                           tapi yang dibaca kembali sudah pasangan yang sah.
#                                         telegram { enabled:false, progress:true,
#                                           engine:{ enabled:false, agent:"claude",
#                                                    model:"claude-opus-5", effort:"xhigh" } }
#                                           SPEC-476/ADR-0096 + SPEC-492 · `engine` = runtime/model/effort
#                                           KHUSUS sesi operator Telegram (beban kanal ini beda jauh dari
#                                           sesi kerja: baca API lalu rangkum, bukan tulis kode). OPT-IN:
#                                           enabled:false → mewarisi default global persis
#                                           (sessionAgentDefaults). Bentuknya SAMA dengan lead.engine —
#                                           satu definisi `zAgentEngine` di shared/src/agent-engine.ts,
#                                           yang WAJIB duduk di modul daun karena entities.ts sudah
#                                           meng-import ./telegram (siklus → TDZ saat boot). Effort codex
#                                           dikoersi saat dibaca (coerceCodexEffort). Blok selalu ADA di
#                                           response (zod .default()) → baris Setting lama tetap parse,
#                                           TANPA migration. Dibaca ULANG tiap sesi operator LAHIR (bukan
#                                           tiap chat lahir — TelegramChat.agent/model/effort MEMBEKUKAN
#                                           nilai saat chat pertama menyapa dan tak punya penulis lain),
#                                           jadi ia berlaku untuk sesi BERIKUTNYA; sesi yang sedang jalan
#                                           tak pernah di-restart diam-diam.
#                                           Perubahan `engine` SAJA TIDAK memicu reloadTelegramGateway()
#                                           (telegramReloadNeeded) — reload memanggil getMe() dan bisa
#                                           menjatuhkan readiness ke `error` gara-gara satu dropdown.
#                                         PUT ganti seluruh blob (full replace).
GET      /codex/version                 # { version: string|null, minRequired: "0.144.0", ok: boolean }  (SPEC-339)
#   Versi codex CLI terpasang (`<HANOMAN_CODEX_BIN> --version`, cache 5 menit). `version: null` =
#   tak terdeteksi (biner tak ada / keluaran tak dikenal) dan itu TIDAK dianggap gagal → `ok: true`.
#   Murni observabilitas untuk catatan lunak di Settings & picker Start; TIDAK pernah memblokir Start
#   (ADR-0037 — agen dipercaya, isolasi lewat worktree).
GET      /limits/codex                  # CodexLimitsDTO { status, windows[], fetchedAt, plan }  (SPEC-338/ADR-0074)
#   Limit langganan CODEX. Sumbernya BUKAN jaringan: codex menulis `rate_limits` (used_percent,
#   window_minutes, resets_at, plan_type, rate_limit_reached_type) ke rollout sesinya di
#   $CODEX_HOME/sessions/<Y>/<M>/<D>/*.jsonl; server membaca ekor rollout terbaru (≤512KB, ≤8 berkas,
#   cache 30s). Tak ada token codex yang disentuh.
#   `windows[]` memakai LimitWindow yang sama dengan /limits. Label diturunkan dari `window_minutes`
#   (300 → "Sesi 5 jam", 10080 → "Mingguan"), TIDAK dari nama kunci: `primary` terbukti bisa berupa
#   window mingguan maupun 5-jam tergantung akun/waktu. `resets_at` codex = epoch DETIK → ISO.
#   `isActive` hanya true untuk window yang disebut `rate_limit_reached_type` (codex tak punya is_active).
#   status: ok = snapshot ≤12 jam; stale = lebih tua (tetap ditampilkan, ditandai); unavailable = belum
#   pernah ada sesi codex yang melaporkan kuota → badge disembunyikan di UI.
#   `fetchedAt` = waktu SNAPSHOT (bukan waktu baca) — beda semantik dari /limits milik claude.
GET      /notifications                 # { items:Notification[] (≤50 terbaru dulu), unread:int }  (SPEC-180)
#   Notification dibuat server-side saat backlog masuk `done` (advanceStage + write-through GET /specs).
#   type ∈ done|decision|drift|error|ticket|fail|lead|webhook|automerge (fail SPEC-298 = sesi scheduler gagal/limit,
#   rekonsil akhir sesi). SPEC-486 · ADR-0103 · `automerge` (key `automerge:<specId>`) merangkap DUA peran:
#   laporan hasil auto-merge (bersih / konflik / galat / dilewati, berikut alasannya) DAN penanda
#   idempotensi durable — `key` unik itulah yang membuat sweep tak pernah mencoba item yang sama dua kali,
#   lintas restart sekalipun. Ber-`specId`, jadi `notifTarget` mengarahkannya ke Backlog tanpa perubahan UI.
POST     /notifications/read            # 204; tandai semua unread jadi terbaca
DELETE   /notifications                 # 204; clear semua
GET      /limits                        # { …usage } dari OAuth usage API Anthropic (cache 30s, stale/unavailable fallback) — SPEC-181/ADR-0024
GET      /update                        # UpdateStatus — status update dari registry npm. SPEC-214/398/405
#   UpdateStatus = { currentVersion, latestVersion|null, registry:{status:"ok"|"unavailable",checkedAt},
#                    updateAvailable, command, canApply }
#   updateAvailable = compareSemver(latest, current) > 0, sesudah GET <registry>/hanoman/latest (ter-gate HANOMAN_UPDATE_FETCH=1, TTL 5 mnt)
#   canApply        = proses server ini anak dari `hanoman start` (env HANOMAN_SUPERVISOR=1) — SPEC-405/ADR-0088
POST     /update/apply                  # { confirm?: boolean } — SPEC-405 · ADR-0088. Server TAK memasang apa pun:
#   ia keluar dengan UPDATE_RESTART_EXIT=75 dan supervisor `hanoman start` yang `npm i -g` lalu menjalankan ulang.
#   400 { error:"bad-body" }                                 — confirm bukan boolean
#   409 { error:"unsupervised" }                             — canApply false
#   409 { error:"up-to-date", current }                      — tak ada versi lebih baru
#   409 { error:"confirm-required", liveSessions, from, to }  — dry-run; sesi hidup dihitung SAAT ITU, tak memblokir
#   202 { accepted:true, from, to, liveSessions }             — lalu proses keluar
#   agent token DITOLAK (403): prefix status hanya GLOBAL_READ untuk method baca
GET      /fs/browse?path=               # directory picker sisi server (untuk memilih repoDir project)
GET      /health                        # publik; liveness
```

## Dokumentasi AI Agent (SPEC-489) — **PUBLIC**

```
GET /agent-integration.md   -> 200 text/markdown; charset=utf-8   # isi docs/agent-integration.md apa adanya
#   404 { error } bila naskahnya tak ada di instalasi (pesan menyebut berkasnya, BUKAN 500)
#   Tak ada method tulis. Tak ada varian JSON/PDF.
```

> **Tanpa auth**, masuk daftar `PUBLIC` di `app.ts` sejajar `GET /health`. Alasannya bukan kelalaian:
> byte-nya sudah publik di repo GitHub (paket MIT), dan menggerbanginya berarti agen yang
> capability-nya kurang menerima **403 pada dokumen yang justru menjelaskan arti 403 itu** — persis
> kelas "401 telanjang tak bisa dibedakan" yang sudah dibayar ADR-0099. Ia juga yang membuat
> janji fitur ini ("cukup diberi tautan + token") benar-benar berlaku: tautannya terbaca **sebelum**
> token disetel.
>
> **Satu naskah, tiga permukaan, nol salinan:** berkas `docs/agent-integration.md` di repo →
> endpoint ini → kartu "Dokumentasi AI Agent" di Settings (yang me-render respons endpoint ini,
> bukan salinannya). Berkasnya dicari `pickGuideFile()` (`server/src/guide-file.ts`) di dua layout —
> `<pkg>/docs/…` untuk paket npm, `<repo>/docs/…` untuk checkout (`server/dist` **dan** `server/src`
> sama dalamnya) — dengan override `HANOMAN_AGENT_DOC` yang **melempar** bila di-set tapi tak ada
> (cermin `HANOMAN_WEB_DIR`). Resolusinya duduk di `app.ts`, bukan di route-nya: `import.meta.url`
> sebuah route sedalam `server/src/routes` saat tsx tapi `server/dist` sesudah dibundel esbuild.
> Naskahnya ikut `copyPlan`/`files`/`REQUIRED_ARTIFACTS` paket npm — tanpa itu setiap instalasi npm
> menjawab 404 sementara checkout dev terlihat sehat.
>
> Kelengkapan isinya diikat ke katalog oleh `server/test/agent-doc-contract.test.ts`
> (`CAPABILITY_DOMAINS`, daftar `COOKIE_ONLY`, `zSpecSource`, plus larangan token nyata) — pengganti
> render-dari-katalog ADR-0100 yang tak mungkin di sini karena kendalanya satu berkas markdown.

## Agent tokens (SPEC-257 · ADR-0065)

> Panduan berhadapan-agen (cara AI agent eksternal terhubung, langkah demi langkah + contoh `curl`): [`docs/agent-integration.md`](../../../docs/agent-integration.md) — **naskah yang sama** disajikan runtime di `GET /api/agent-integration.md` (publik, markdown mentah) dan dirender di panel "Akses AI Agent" di UI (SPEC-265/489).

```
# Kelola kredensial AI agent — COOKIE-ONLY (agent token sendiri → 403; anti privilege-escalation).
GET    /agent-tokens/capabilities   -> { capabilities: CapabilityInfo[] }   # katalog 24 (12 domain × read/write) untuk UI
GET    /agent-tokens                 -> { items: AgentTokenView[] }          # tanpa hash/plaintext
POST   /agent-tokens { name, capabilities[] }  -> 201 { ...AgentTokenView, token }   # plaintext hnm_agt_… SEKALI
#   400 nama kosong / capability asing (divalidasi vs CAPABILITY_IDS). createdBy = user pemanggil.
PATCH  /agent-tokens/:id { name?, capabilities?, enabled? }  -> 200 AgentTokenView   # 400 body cacat; 404 tak ada
DELETE /agent-tokens/:id             # 204 · revoke (set revokedAt); 404 tak ada
#   AgentTokenView = { id, name, tokenPrefix, capabilities[], enabled, createdBy|null, createdAt, lastUsedAt|null, revokedAt|null }
```

> **Capability** = `"<domain>:<access>"`, `access ∈ {read,write}`, **write⊇read**. 12 domain: `projects`,
> `backlog`, `sessions` (spawn agen = RCE), `docs`, `ide`, `vps` (remote exec), `settings` (+`/scheduler`),
> `support` (tickets + issue GitHub), `notifications`, `lead` (ADR-0091), `agents` (ADR-0094),
> `telegram` (ADR-0096). Peta route→capability di `server/src/services/agent-capabilities.ts`:
> GET/HEAD → `:read`, selainnya → `:write`; sub-path `/projects/:id/{docs,prds}` → `docs`,
> `/projects/:id/{tree,file,git,status,graph,commit,compare,remotes,…}` → `ide`; WS terminal → `sessions:write`.
> **Read-only global** (`/limits`,`/update`,`/events/ws`,`/fs/browse`,`/health`) → token ber-capability apa
> pun, **hanya untuk method baca** (SPEC-405 · ADR-0088). **Tak-boleh-didelegasikan** (agent → 403):
> `/auth`, `/agent-tokens`, `/device-tokens`, `/sync`, `/webhooks` (ADR-0100), dan
> `/telegram/{settings,test,credentials}` (ADR-0097); route tak dikenal peta → cookie-only. Master switch
> `Setting.agentAccessEnabled` (PUT /settings) mematikan semua. **Kecuali** endpoint `PUBLIC`
> (`/health`, `/auth/status`, `/auth/login`, `/auth/setup`, `/agent-integration.md`) yang tak pernah
> menyentuh gate ini sama sekali.

> **Sync mesin-ke-mesin** (SPEC-213 · ADR-0043/0045/0046): surface `/api/sync/{pull,push,ws}` diotorisasi
> **device token** (Bearer / `?token=` WS), di-**bypass** gate cookie.
> **Byte lampiran** (SPEC-272 · ADR-0068): `GET /api/sync/attachments/:storageKey` — **device-token**
> (bukan cookie), stream byte biner lampiran (`Content-Type` mime) untuk fetch-through client → `200` |
> `404` (storageKey bukan milik `TicketAttachment`/file hilang) | `401` (tanpa device token). Metadata
> lampiran sendiri menyeberang via feed `pull` (entitas `ticketAttachment`); byte **tidak** masuk feed.
> **KECUALI `POST /api/sync/now`**
> (SPEC-268 · ADR-0066) — pemicu **manual** dari tombol UI (Backlog/Errors/Triase): **cookie-authed**
> (dikecualikan dari bypass di `app.ts`), tetap **non-delegatable** ke agent (`/sync` cookie-only → 403).
> Menjalankan satu siklus `syncOnce` (pull-before-push) → `200 { ok:true, full:false, pulled, pushed, conflicts }`;
> instance non-client (hub) → `200 { ok:false, reason:"not-configured" }`. Tombol muncul hanya di client
> (`GET /config`.`sync.running`).
> **Tarik ulang penuh** (SPEC-382 · ADR-0082): body opsional `{ full: true }` → kursor `SyncState`
> dikembalikan ke `0` lalu feed di-drain halaman demi halaman (`pull` ber-`limit` 500) →
> `200 { ok:true, full:true, pulled, pushed, conflicts }`. Satu-satunya jalan pulang bagi baris feed
> yang terlanjur **dilompati** kursor sebelum kontrak apply ADR-0082; aman diulang karena pull
> server-authoritative & `upsertLocal` idempoten. Body absen/`{ full:false }` = perilaku lama.

> **Rekonsil konflik** (SPEC-270 · ADR-0067) — **cookie-only** (dikecualikan dari bypass `/api/sync`,
> non-delegatable ke agent):
> - `GET /api/sync/conflicts` → `{ conflicts: SyncConflictView[] }` (divergensi dua-sisi pending;
>   tiap item punya `localData`/`serverData` + `localVersion`/`serverVersion` + `localUpdatedAt`/`serverUpdatedAt`).
> - `POST /api/sync/conflicts/:entity/:recordId/resolve` `{ choice: "local" | "server" }` →
>   `{ ok:true }` | `{ ok:false, reason }`. `local` = force-push data lokal ke hub (`baseVersion=serverVersion`);
>   `server` = adopsi data hub secara lokal. Modal `ReconcileModal` (dipicu saat `conflicts>0`) menyajikan
>   side-by-side; default = sisi `updatedAt` terbaru (LWW). Keputusan per-record.

## Terminal
```
GET    /terminal/sessions            # [{ id, projectId, specId?, flow?, cwd, branch?, exited, exitCode?, decision, agent }]
#   branch? (SPEC-230): branch integrasi sesi project-level (PRD = prd/<slug>) — menyalakan review+merge di sel
#   agent (SPEC-338/ADR-0074): "claude" | "codex" — mesin sesi, dibaca dari opsi tmux @hanoman_agent.
#     Sesi yang lahir sebelum ADR-0074 (tanpa opsi itu) dilaporkan sebagai "claude".
#   exitCode? (SPEC-402): kode keluar pane MATI (#{pane_dead_status}); ABSEN selama pane hidup.
#     ≠ 0 = pekerjaan TERPUTUS (mis. 143 = agen di-SIGTERM), bukan tuntas → UI memberi pil
#     "Gagal · exit <n>", bukan "Selesai". Endpoint ini & frame siar `sessions` membawa nilai yang sama.
#   CATATAN: kegagalan invokasi tmux TIDAK lagi dilaporkan sebagai daftar kosong (SPEC-402) —
#     hanya "no server running"/"error connecting to" berarti nol sesi; kegagalan lain → 500,
#     karena daftar kosong palsu membuat setiap terminal terbuka mengumumkan `exit 0`.
POST   /terminal/sessions  {project, flow?} # 201 { id } · 404 project · 400 tanpa repoDir
#   {project, shell:true} (SPEC-236, ADR-0056): terminal biasa NON-agen — shell mentah
#     (HANOMAN_SHELL ?? $SHELL ?? /bin/bash) di repoDir project, tanpa flow (tak menggerakkan stage,
#     tak buat worktree). 201 { id } · 404 project · 400 tanpa repoDir (needsBind).
#   {spec, flow, model?, effort?, goal?, goalCondition?, agent?, verifyScope?, force?} (SPEC-162; model/effort SPEC-252/ADR-0061;
#     goal SPEC-332/ADR-0073; agent SPEC-338/ADR-0074; verifyScope SPEC-376/ADR-0080; force SPEC-447/ADR-0093):
#     sesi backlog di worktree .worktrees/<spec>, prompt pipeline penuh.
#     201 { id } · 201 { id, resumed: true } bila peluncuran MELANJUTKAN sesi yang sudah berjalan
#       (SPEC-394/ADR-0084). TIGA keadaan: pane tmux HIDUP → re-attach (ADR-0015), tak menyentuh
#       apa pun. Pane MATI (`remain-on-exit on` menahannya) → dibunuh dulu lalu sesi dilahirkan
#       ulang — pane mati BUKAN sesi. Resume bila stage ≠ done DAN baseSha ada DAN artefaknya masih
#       ada: worktree .worktrees/<id> yang masih sah dipakai APA ADANYA (tak dihapus), atau — bila
#       hilang — dibangun ulang `--detach` di tip origin/hanoman/<id> → hanoman/<id> → Spec.headSha
#       (urutan mengikat: origin/… adalah ref yang push di akhir sesi harus fast-forward). baseSha &
#       headSha TIDAK ditulis ulang saat resume (rentang review ADR-0030 tetap dari basis asli), dan
#       prompt = resumePrompt yang menyebut baris fase yang sudah tercatat + fase berikutnya.
#       Selain itu → fresh: persis perilaku sebelum SPEC-394. stage = done tetap jalur SPEC-172
#       (continuePrompt, worktree dari branchFrom). Server tak pernah menulis $HANOMAN_PHASE_FILE.
#     409 { error, blocked: true, blockers: [{id, reason:"missing"|"unfinished"|"unmerged"}] } bila
#       backlog ini punya `dependsOn` yang belum SELESAI & TER-MERGE (SPEC-447/ADR-0093). Gerbangnya
#       berdiri SESUDAH cek pane hidup — re-attach ke sesi yang sedang berjalan tak pernah ditolak —
#       dan SEBELUM kill/worktree, jadi penolakan tak meninggalkan efek (baseSha/startedAt tak
#       tersentuh). `force: true` MELEWATI gerbang ini: hanya jalur manusia yang memilikinya;
#       governor scheduler & denyut lead tak punya jalan paksa (governor melewati item terblokir,
#       barisnya tetap `queued` + `note`, slot tak terpakai).
#     verifyScope?: "changed"|"full" — scope verifikasi PER SESI; kosong → Setting.verifyScope
#       (default "changed"). "changed" menyisipkan klausa scope ke prompt (uji berkas yang berubah
#       saja: `vitest --changed "$HANOMAN_BASE_SHA"`/`vitest related`, typecheck per paket, lint per
#       berkas, build & smoke server hanya bila relevan) dan HANYA untuk flow ber-fase Execute —
#       flow dokumen (audit) tak menulis kode jadi tak membawanya. "full" = prompt
#       persis seperti sebelum SPEC-376. Sesi juga lahir membawa env HANOMAN_BASE_SHA (= commit
#       tempat worktree lahir, wajib karena worktree `--detach` tak punya `main`) dan
#       HANOMAN_VERIFY_SCOPE. BUKAN gerbang: tak ada hook yang menolak perintah (ADR-0037 utuh).
#       Nilai di luar "changed"|"full" → 400 (ditolak zod SEBELUM lookup spec).
#     agent?: "claude"|"codex" — override PER SESI; kosong → Setting.agent. Agen menentukan katalog
#       model/effort default (claude → Setting.model/effort, codex → Setting.codex.model/effort) dan
#       bentuk argv: claude `--model/--effort/--settings`, codex `-m / -c model_reasoning_effort / -c hooks.*`.
#       Sesi project-level (reverse/prd/scaffold/breakdown/terminal/konflik) TAK punya override — ikut Setting.agent.
#     model/effort opsional = override PER SESI (kosong → default global);
#     jadi argv --model/--effort saat sesi lahir (andal, tak bergantung agen).
#     goal?: boolean — mode goal PER SESI. undefined → ikut Setting.goal.enabled; false → MATI walau
#       global menyala; true → nyala. goalCondition?: string ≤4000 — kondisi khusus sesi ini.
#       Presedens kondisi: goalCondition → Setting.goal.condition → default DoD bawaan runner
#       (semua fase tercatat di $HANOMAN_PHASE_FILE, plan tak menyisakan `- [ ]`, push sukses).
#       claude: argv --settings membawa hooks.Stop=[{type:"prompt",prompt:<kondisi>}] (sesi menolak
#       berhenti sampai kondisi terbukti di transkrip) + keystroke `/goal` best-effort ke pane.
#       codex (SPEC-338/ADR-0074): codex MENDIAMKAN hook type:"prompt", jadi gate-nya skrip sh
#       DETERMINISTIK sebagai Stop hook `command` — cek phase file lengkap + plan tak menyisakan
#       `- [ ]`; belum terpenuhi → exit 2 (stderr jadi continuation prompt, codex dipaksa lanjut).
#       Kondisi prosa ikut sebagai teks alasan, bukan yang menggerbang. Pagar anti-loop: 25 penolakan.
#     flow ∈ feature|qa|audit|goal (dari source; flowForSource).
#     goal (SPEC-407/ADR-0089) = pipeline Goal → Verifikasi, tanpa fase perencanaan: prompt-nya
#     startGoalPrompt (mengeja Goal/Selesai bila/Batasan dari payload, tanpa skill Brainstorm/Plan),
#     stage Goal→executing & Verifikasi→done, dan mode goal DIPAKSA menyala — `goal:false` diabaikan,
#     template global Setting.goal.condition DILEWATI (kondisi diturunkan dari item), `goalCondition`
#     per-request tetap menang. Klausa scope verifikasi ikut (flow ini menulis kode meski tanpa Execute).
#     audit (SPEC-237/ADR-0057) = pipeline
#     Audit → Laporan: investigasi + dokumen SoT (research/audit-<spec>-<slug>.md), TANPA Execute; stage done via Laporan.
#   SPEC-172: bila Spec.stage === "done", sesi baru dibuka dengan prompt LANJUTAN (fase Execute
#     saja, continuePrompt) alih-alih pipeline penuh — reopen backlog yang keburu selesai.
#   SPEC-394/ADR-0084 · SEMUA sesi ber-id deterministik (project-level reverse|scaffold|prd|
#     breakdown, sesi konflik merge-<spec> & finishGraphOp, konsol VPS vpsc-<id>):
#     pane tmux yang MATI bukan sesi — ia dibunuh lalu sesi dilahirkan ulang; hanya pane HIDUP yang
#     di-re-attach (ADR-0015). Gerbangnya di titik cekik createSession() + di kelima gerbang route
#     project-level. Untuk kelima flow project-level itu, worktree .worktrees/<id> yang MASIH SAH
#     tidak dibangun ulang (ensureWorktree melewati addWorktree yang selalu `remove --force`), dan
#     prompt-nya diberi satu kalimat RESUMED_WORKTREE_NOTE. Flow dokumen TIDAK memakai resumePrompt.
#     GET /terminal/sessions/:id/ws pada pane mati tetap sah (membaca layar terakhir).
#   flow "reverse" (SPEC-166, ADR-0026): sesi project-level di worktree .worktrees/reverse-<project>
#   dengan prompt standar docs; 422 bila repoDir kosong atau worktree gagal dibuat
#   flow "scaffold" (SPEC-222, ADR-0052): sesi project-level di worktree .worktrees/scaffold-<project>,
#     menyusun SoT penuh dari ide (Project.desc), pipeline Brainstorm→Objective→Doc index; 422 bila repoDir kosong/worktree gagal
#   {project, flow:"prd", brief, branchFrom?, fromAudit?} (SPEC-210, ADR-0041): sesi project-level di
#     .worktrees/prd-<slug>; brainstorm interaktif → dokumen docs/prd/<slug>.md, push branch prd/<slug>;
#     400 judul kosong, 422 worktree.
#     SPEC-340 · ADR-0076 · eskalasi audit → PRD: branchFrom = branch audit (hanoman/<audit-id>) →
#     worktree lahir dari sana (resolveCommit + fallback origin/<rev>, SPEC-244) alih-alih HEAD;
#     fromAudit = id spec audit → isi dokumen auditnya (freshest-wins) DISEMATKAN ke prompt PRD
#     sebagai blok `=== DOKUMEN AUDIT <id> ===`. Keduanya opsional & independen; tanpa keduanya
#     perilaku lama utuh (worktree dari HEAD, prompt polos). 422 bila branchFrom tak resolve.
#   {project, flow:"breakdown", prdPath} (SPEC-273, ADR-0069): sesi project-level di .worktrees/breakdown-<slug>;
#     baca PRD (tersemat, freshest-wins) → manifest docs/prd/<slug>.breakdown.md, push branch breakdown/<slug>;
#     400 PRD tak terbaca / path tak valid, 422 worktree gagal
GET    /terminal/sessions/:id/phases # fase yang sudah dilaporkan sesi (dari $HANOMAN_PHASE_FILE) → stage live
GET    /terminal/sessions/:id/review        # (SPEC-230, ADR-0054) diff worktree HIDUP sesi project-level (PRD);
#   bentuk = /specs/:id/review; kunci worktree = id sesi; 409 bila worktree lenyap (sesi ditutup) — bukan 500
GET    /terminal/sessions/:id/review/*path  # { path, status, binary, truncated, diff, content } · 404 · 409
POST   /terminal/sessions/:id/integrate  { op:"merge"|"rebase", target:"local:<b>"|"origin:<b>" }
#   (SPEC-230, ADR-0054) rebase/merge branch sesi (PRD prd/<slug>); { status:"clean", detail } |
#   { status:"conflict", sessionId } (spawn sesi claude di worktree merge-<id>) | 400 op/target · 409 branch/sesi tanpa branch
DELETE /terminal/sessions/:id        # 204 · 404; menutup sesi: majukan stage, simpan headSha, removeWorktree
#   removeWorktree HANYA dijalankan bila cwd sesi benar-benar berada DI DALAM <repoDir>/.worktrees/
#   (`ownsWorktree`, services/session-worktree.ts). Bentuk path saja bukan bukti kepemilikan:
#   project yang di-bind ke checkout di bawah .worktrees/ (dogfooding hanoman di worktree sendiri)
#   punya `cwd === repoDir` untuk terminal biasa, dan gerbang lama menghapus checkout itu sendiri.
GET    /terminal/sessions/:id/ws     # WebSocket; close 4004 bila sesi tak ada
#   server->klien: { t:"data", d } · { t:"phase", phases, complete } · { t:"exit", code }
#   klien->server: { t:"in", d } · { t:"resize", cols, rows }
#   SPEC-433 · `complete` = seluruh fase pipeline tercatat (done|skipped) DAN plan spec-nya tak
#   menyisakan `- [ ]` (gerbang ADR-0029 yang sama dengan stageForRun). Ia BUKAN turunan
#   `exited`: agen adalah TUI interaktif yang kembali ke prompt-nya sesudah fase terakhir, jadi
#   di jalur sukses pane TAK PERNAH mati dan `exited` tak bisa menjadi kabar "selesai".
#   Frame lahir saat `phases` ATAU `complete` berubah — kotak `- [ ]` terakhir dicentang tanpa
#   menyentuh berkas fase, dan dedup berkunci `phases` saja akan menelannya.

# --- riwayat sesi (SPEC-362, ADR-0079) — LOCAL-only, tak disync -------------------------------
GET    /terminal/history?projectId&specId&kind&q&page&limit
#   → { items: SessionHistoryView[], total, page, pageSize } · urut startedAt desc
#   q mencocokkan sessionId/specId/title/branch (insensitive). Tanpa `limit` → seluruh riwayat
#   terfilter dalam satu halaman. `limit` di-clamp 1..200. `endedAt: null` = sesi masih berjalan.
#   skip/take dilakukan di query DB — SAH di sini, tak seperti larangan ADR-0038 untuk GET /specs
#   (riwayat adalah baris mati; tak ada overlay stage live / write-through yang butuh set penuh).
GET    /terminal/history/:id         # SessionHistoryView + { hasTranscript } · 404
GET    /terminal/history/:id/transcript  # { text, bytes } · 404 bila baris/transkrip tak ada
#   Teks POLOS (capture-pane tanpa -e), di-capture sebelum pane dibunuh, cap 1 MiB menyimpan ekor.
DELETE /terminal/history?projectId&before
#   → { purged } · 400 tanpa parameter (purge WAJIB ber-scope) · 400 `before` bukan tanggal valid.
#   Ikut menghapus berkas transkrip milik baris yang dibuang. Cermin DELETE /session-results.
```

> Riwayat sesi sengaja hidup di bawah prefix `/terminal` supaya mewarisi capability `sessions`
> (`capabilityForRoute()`, ADR-0065) tanpa menambah domain baru.

> PTY menjalankan `claude --dangerously-skip-permissions` di worktree/`repoDir`, di dalam **tmux**
> (socket `-L hanoman`) sehingga sesi hidup melewati restart API (ADR-0016); scrollback 256 KB terakhir
> di-replay saat klien reconnect. RCE by design — server bind `127.0.0.1` secara default, lihat ADR-0014.

## Events (SPEC-199 · ADR-0039)
```
GET    /events/ws                    # WebSocket siar dashboard (global). Auth = gate /api (cookie).
#   server->klien (per-grup, saat berubah; snapshot penuh saat connect):
#     { t:"specs", specs } · { t:"sessions", sessions } · { t:"notifications", items, unread }
#     { t:"limits", limits } · { t:"codexLimits", limits } (SPEC-338, tiap 30s, grup TERPISAH dari
#       `limits` karena sumber & semantik kesegarannya beda) · { t:"vps", vps } ·
#       { t:"update", update } (SPEC-214, tiap 300s)
#   klien->server: — (read-only feed; frame masuk diabaikan)
```

> Satu loop server (cadence per-grup, dedup signature) menggantikan N-klien × poll. Endpoint HTTP
> GET tiap sumber tetap ada untuk paint pertama.

## VPS (SPEC-164 · ADR-0025 · SPEC-211/ADR-0042)
```
GET    /vps                          # [{ id, name, host, port, user, keyPath, lastSeenAt,
                                     #    health, lastAuditAt, audit, hardened }]
POST   /vps  {name,host,user,port?,keyPath?,password?}  # 201 · 400 host/user cacat
                                     # password (SPEC-165) = bootstrap key sekali pakai:
                                     # dipasang ke authorized_keys, diverifikasi key-only,
                                     # lalu dibuang. Gagal → 502 dan TIDAK ada baris lahir.
PATCH  /vps/:id                      # parsial · 200 · 400 body cacat · 404
                                     # `password` = bootstrap ulang → 502 bila gagal
DELETE /vps/:id                      # 204 · 404 (registrasi saja; server-nya tak disentuh)
POST   /vps/:id/audit                # 200 { audit, hardened, scoreTotal, scoreBySection, drift[] } · 404 · 502
                                     # drift (SPEC-221) = item pass→fail/warn sejak snapshot lalu → Notification
POST   /vps/:id/harden               # 200 { transcript, audit, hardened } · 404
                                     # 502 { error, transcript[, verify] } bila ssh gagal
                                     # atau verifikasi koneksi pasca-harden gagal
POST   /vps/:id/session              # 201 { id } — sesi claude tmux berkonteks VPS (cwd $HOME) · 404
POST   /vps/:id/test                  # 200 { ok, out } — ssh `true` key-only, transien · 404
POST   /vps/:id/console               # 201 { id } — shell ssh MENTAH di tmux hanoman (ADR-0042) · 404
# --- Kepatuhan / checklist 232 item (SPEC-220 · ADR-0050) ---
GET    /vps/:id/checklist            # 200 { vpsId, scoreTotal, scoreBySection, lastAuditAt,
                                     #   sections:[{ id,title,icon,score, suggestion?, items:[CatalogItem +
                                     #   status,na,attested,drifted,actorEmail,naReason,attestNote] }] } · 404
                                     # drifted (SPEC-221) = regresi sejak snapshot lalu; suggestion = saran N/A app-layer
POST   /vps/:id/items/:itemId/na     # 200 { ok } {na,reason?} — tandai/lepas N/A + jejak pelaku · 404 itemId asing
POST   /vps/:id/items/:itemId/attest # 200 { ok } {note?} — attest item INFO + jejak pelaku · 404
POST   /vps/:id/items/na-bulk        # 200 { ok, count } {itemIds[],na,reason?} — tandai N/A banyak item · 400 id asing (SPEC-221)
POST   /vps/:id/remediate/preview    # 200 { steps:[{item,status:would,detail}] } {items[]} — dry-run · 404 · 502
POST   /vps/:id/remediate            # 200 { steps, audit, scoreTotal, scoreBySection } {items[]}
                                     #   — apply item AUTO idempoten → verifikasi koneksi → re-audit · 404 · 502
```

> Audit/healthcheck/harden = script bash deterministik (`server/scripts/vps/*.sh`) dikirim
> lewat `ssh … 'sudo -n bash -s'`. `hardened` = semua check kritis `pass` pada audit terakhir.
> Harden TIDAK PERNAH terjadwal; healthcheck (5 mnt) dan audit (24 jam) berjalan lewat
> `setInterval` di `server.ts`. Endpoint ini eksekusi remote — tergerbang sesi auth (seperti seluruh
> `/api`), dan tetap direkomendasikan bind `127.0.0.1` di belakang reverse proxy TLS.
>
> Password tak pernah disimpan, di-log, atau dikembalikan; ia diserahkan ke ssh lewat
> SSH_ASKPASS (bukan argv) dan hidup beberapa detik di env proses anak (ADR-0025, SPEC-165).

## Help Center (SPEC-253 · ADR-0062)
```
# PUBLIK ber-scope-project — pengecualian sah gate /api (bypass cookie, otorisasi non-cookie sendiri).
# Same-origin (SPA + API satu host) → tanpa CORS/OPTIONS.
GET     /api/help/:slug                  -> { projectName, categories }
#   Info halaman publik. Otorisasi = helpEnabled. 404 generik bila project tak ada / helpEnabled=false.
POST    /api/help/:slug/tickets          # multipart/form-data
#   Field: category, title, detail, email, hc_trap (honeypot) + files[] (≤3 gambar png/jpeg/webp, ≤5MB).
#   Otorisasi = helpEnabled. 201 { number, key, statusPath } (key+link ditampilkan SEKALI di layar).
#   400 field wajib kosong/kategori invalid (tak buat tiket). 404 helpEnabled=false. 429 rate-limit
#   per IP & per project. Honeypot terisi → 200 { ok:true } palsu (tak buat tiket). Berkas invalid di-skip.
#   SPEC-352 · honeypot bernama `hc_trap`, BUKAN lagi `hp` — `hp` (= "handphone") diisi autofill
#   browser untuk pelapor sungguhan; kini `hp` field biasa yang diabaikan (bundle basi tetap jadi
#   tiket). Klien WAJIB memvalidasi bentuk respons: 200 { ok:true } bukan sukses.
GET     /api/help/:slug/tickets/:key     -> { number, category, title, status, createdAt }
#   Cek status publik by kunci opaque; status terpetakan otomatis (publicStatus), tanpa jargon internal.
#   Scoped ke slug (isolasi). 404 bila kunci tak dikenal / bukan milik slug (tak membocorkan).
#   SPEC-293 · `:key` boleh kunci pelapor (accessKeyHash) ATAU shareToken bagikan operator (hnm_shr_…).

# TRIASE — di belakang gate cookie. Query selalu ber-scope projectId (isolasi antar-project).
GET   /tickets?project=&status=&q=&page=&limit=  -> { items: TicketView[], total, page, pageSize, unreviewed }
#   urut createdAt desc; q atas title+reporterEmail; paginasi response-layer (ADR-0038); unreviewed = jumlah status new.
GET   /tickets/:id            -> TicketDetail { ...ticket, detail, attachments:[{id,filename,mimeType,size}], spec, publicStatusUrl } · 404
#   SPEC-293 · spec = backlog tertaut (stage → badge status turunan di detail triase). publicStatusUrl =
#   ${base}/help/<projectId>/status/<shareToken> (link publik dibagikan ke pelapor); shareToken di-generate
#   lazily bila tiket lama belum punya (idempoten, tanpa sync). Deep-link backlog UI = ${origin}#spec=<id> (ADR-0071).
GET   /tickets/:id/attachments/:attId    # stream berkas gambar (Content-Type mimeType) ber-auth · 404 (att bukan milik tiket)
      # SPEC-272 · di CLIENT byte ditarik lazy dari hub (readUploadOrFetch → /sync/attachments) bila absen lokal, lalu di-cache
POST  /tickets/:id/accept  { priority? }  # 201 { spec } — buat Spec source help prefilled + tandai tiket
#   accepted + specId (tautan dua arah). Idempoten: sudah promoted → 200 { alreadyPromoted:true, spec }. 404.
#   SPEC-297: inti accept kini di services/ticket-accept.ts (acceptTicket) — dipakai route ini DAN scheduler
#   source-checker `triase`; kontrak HTTP (201/200/404) & pemetaan kategori→source (SPEC-291) tak berubah.
#   SPEC-286 · payload.context memuat DIREKTIF periksa lampiran: bila tiket berlampiran → daftar nama+mime+path
#   upload (agar agen membaca isinya, biasanya screenshot) + cadangan API attachments; tanpa lampiran → "Tanpa lampiran".
POST  /tickets/:id/unlink                 # 200 { id, status:"new", specId:null } — lepas tautan backlog (kebalikan accept).
#   Non-destruktif: Spec dibiarkan (hapus manual). Reset status→new → bisa diterima lagi (Spec baru). Idempoten. 404. (SPEC-271)
POST  /tickets/:id/reject                 # 200 { id, status:"rejected" } — tutup tanpa Spec · 404
PATCH /tickets/:id  { title?, detail?, category?, status? }  # 200 TicketDetail — edit isi tiket; field opsional,
#   minimal satu (zTicketEditInput). category ∈ bug|fitur|pertanyaan|lainnya, status ∈ new|accepted|rejected.
#   400 body kosong/enum invalid. 404. (SPEC-269)
DELETE /tickets/:id                       # 200 { ok:true } — hapus tiket; TicketAttachment cascade (DB) +
#   file fisik di HANOMAN_UPLOAD_DIR dibersihkan best-effort (deleteUpload). 404. (SPEC-269)
```

> **Status publik** `publicStatus(ticket.status, spec.stage?)`: new→"Sedang ditinjau", rejected→"Ditutup",
> accepted+executing→"Sedang dikerjakan", done→"Selesai", selainnya→"Diterima". **Notifikasi** tiket baru →
> `Notification { type:"ticket", key:"ticket:<id>" }` (dedup), tersiar lewat grup `notifications` WS existing.
> **Sync (SPEC-268/ADR-0066):** **metadata** `Ticket` kini **tersync** (kolom `version`, entitas `ticket`
> di `SYNCED`; publish asal-hub pada create/accept/reject; `accessKeyHash` ikut snapshot, kunci plaintext
> tak menyeberang). **Lampiran** di `HANOMAN_UPLOAD_DIR` (server-local, **tetap tak disync** — file biner),
> disajikan **hanya ber-auth** ke triase —
> halaman status publik tak menampilkannya balik. **Halaman publik** `/help/*` di-mount SPA (routing baru,
> `main.tsx`) tanpa auth; fallback `index.html` existing → nol perubahan server untuk menyajikan halaman.
> Realtime area Triase = **HTTP polling** (pola GitGraph), bukan kanal WS baru (ADR-0039).

## Issue GitHub (SPEC-471 · ADR-0095)
```
# Di belakang gate cookie; agent-token → domain `support` (satu domain dengan /tickets — keduanya
# permukaan triase masuk), dipetakan MENURUT METHOD lewat rw(), bukan prefix (kelas bug SPEC-405).
# hanoman HANYA MEMBACA GitHub — tak ada endpoint komentar/close di sini, dan itu keputusan (ADR-0095 §7).
POST /api/projects/:id/github/pull  { state?:"open"|"all", limit?:1..1000 }
#   -> 200 { repo, pulled, created, updated, via:"gh"|"rest", skippedPullRequests }
#   Repo diturunkan `Project.gitRemote ?? origin(repoDir)`; TIDAK mensyaratkan repoDir ada.
#   Ambil: `gh issue list --json …` dulu (env GH_TOKEN = GITHUB_TOKEN bila diisi), fallback HTTPS
#   ke api.github.com HANYA bila gh tak bisa dieksekusi / tak terautentikasi — kegagalan gh yang lain
#   adalah jawaban OTORITATIF (ADR-0095 §3). Jalur REST membuang tiap item ber-`pull_request` dan
#   memeriksa has_issues lebih dulu; `skippedPullRequests` melaporkan berapa yang dibuang.
#   Upsert id deterministik "<projectId>:<slug>#<n>"; update TAK PERNAH menyentuh status/specId.
#   400 no-remote | not-github (pesan menyebut hostnya) | issues-disabled · 404 project/repo tak ada
#   401 kredensial ditolak · 502 GitHub menjawab lain-lain.
GET  /api/projects/:id/github/issues?status=  -> { items: GithubIssueView[] }   # urut number desc · 404
POST /api/github-issues/accept  { ids:[…≤100], priority?, source? }
#   -> 201 { created: Spec[], failed:[{id,error}] } — SATU Spec per issue (ADR-0015). Satu issue gagal
#   tak menghentikan sisanya (cermin checkTriase).
POST /api/github-issues/:id/accept  { priority?, source? }
#   -> 201 { spec } — buat Spec + tandai issue accepted + specId (tautan dua arah).
#   source default dari label: bug-ish→qa, fitur-ish→brief, tanya/docs→audit, TANPA LABEL→qa
#   (sengaja beda dari SPEC-291 yang default brief — lihat ADR-0095). Idempoten: sudah promoted →
#   200 { alreadyPromoted:true, spec }. 404.
POST /api/github-issues/:id/reject  -> 200 { id, status:"rejected" } · 404
POST /api/github-issues/:id/unlink  -> 200 { id, status:"new", specId:null } · 404   # kebalikan accept
```
> **`:id` WAJIB `encodeURIComponent` penuh.** Id-nya deterministik `"<projectId>:<owner>/<repo>#<n>"`
> dan **memuat `/`** — terukur di smoke lokal: `%2F` diteruskan utuh oleh Fastify dan cocok, sedangkan
> `/` telanjang di segmen path menjawab **404 "Route not found"**. Konsekuensi deployment: reverse
> proxy yang **men-dekode `%2F` jadi `/`** akan membuat ketiga endpoint per-issue 404 di produksi
> sementara lolos di test (`app.inject` tak melewati proxy). Endpoint massal
> `POST /github-issues/accept` membawa id di **body** sehingga kebal — itulah yang dipakai UI untuk
> menerima. Bila suatu saat hanoman dipasang di belakang proxy yang menormalkan `%2F`, pindahkan
> ketiganya ke body, jangan ubah bentuk id (ia kunci changefeed).
> **Sync:** `githubIssue` masuk `SYNCED` (ADR-0045) dengan **seluruh** kolom bermakna di `FIELDS`,
> termasuk `status` & `specId` — keputusan triase harus terlihat sama di semua mesin, dan kolom yang
> terlewat mendarat sebagai default palsu tanpa satu pun error. **Config:** `GITHUB_TOKEN`
> (`kind: secret`, melayani jalur `gh` **dan** REST) + `HANOMAN_GH_BIN` (default `gh`); `hanoman doctor`
> melaporkan `gh` sebagai probe **non-fatal**. **UI:** tab kedua di layar Triase, bukan layar baru.

## Scheduler (SPEC-294 · ADR-0072) — LOCAL per-instance
```
# Fondasi scheduler otonom (di belakang gate cookie; agent-token → domain `settings`). Semua default MATI.
GET  /api/scheduler/config   -> Scheduler (zScheduler: enabled, paused, maxConcurrent, autonomy, sources.{backlog,triase})
PUT  /api/scheduler/config   { Scheduler }  -> Scheduler   # ganti blok penuh (pola PUT /settings). Pause = { paused:true }. 400 invalid.
GET  /api/scheduler/state    -> { config, cap, liveCount, sources:[{id,enabled,everyMin,minCount?,lastRunAt,nextRunAt}],
#                                  queue: SchedulerQueueItem[], sessions:[sesi live ber-item 'launched'] }
```
> Engine in-process (di-start dari `server.ts`, timer `.unref`; `app.ts` bebas-timer — **membalik sebagian
> ADR-0024**): per source enable+cadence → checker terdaftar (`registerSchedulerSource`) enqueue kandidat;
> governor drain antrean durable (`SchedulerQueueItem`, `specId @unique` idempoten) di bawah
> `cap=maxConcurrent` (dihitung dari `pty.listSessions`), urut prioritas, tahan saat cap penuh; **Pause**
> blokir drain ≤1 tick. Peluncuran lewat `startSpecSession` (jalur bersama Start manual); `flow` diturunkan
> `flowForSource(spec.source)` server-side. **Opt-in per project:** `PATCH /api/projects/:id { schedulerOptIn }`
> (lokal — tak masuk `FIELDS` sync). Semua knob & state **LOCAL per-instance** (tak disync).
>
> **Source-checker konkret pertama (SPEC-295):** `backlog` — saat cadence backlog jatuh-tempo, meng-enqueue
> semua `Spec` belum-mulai (`baseSha===null`) dari project `schedulerOptIn` urut prioritas `tinggi→sedang→rendah`
> (queue item `source:"backlog"`, idempoten via `specId @unique`). Project non-opt-in tak tersentuh.
> Terdaftar di `server.ts` (`registerBacklogSource()`) sebelum `startScheduler()`.
>
> **Source-checker konkret kedua (SPEC-297):** `triase` — saat cadence triase jatuh-tempo, untuk tiap `Ticket`
> eligible (`status:"new"` ∧ `category ∈ {bug,fitur}` ∧ `specId=null` ∧ project `schedulerOptIn`) memakai ulang
> `acceptTicket` (`services/ticket-accept.ts`, pemetaan kategori→source SPEC-291: bug→`qa`, fitur→`brief`) → Spec
> prioritas `sedang`, lalu enqueue (queue item `source:"triase"`). Kategori `pertanyaan`/`lainnya` **tak pernah**
> auto-accept (tetap manual). Idempoten (tiket accepted/rejected/ber-specId tersaring di query); banyak tiket satu
> window, satu tiket = satu backlog. Terdaftar di `server.ts` (`registerTriaseSource()`) sebelum `startScheduler()`.
>
> **Autonomy + akhir sesi (SPEC-298, daun #5):** governor menyuntik **klausa prompt per mode** dari
> `scheduler.autonomy` saat meluncurkan sesi — `full-control` = agen putuskan sendiri & tembus sampai `done`
> tanpa berhenti bertanya; `butuh-keputusan` = berhenti di titik keputusan (marker SPEC-184 → `Notification`
> `decision`, sesi tetap **memegang slot**). `engine.tick` (sebelum drain) menjalankan **rekonsiliasi akhir sesi**
> (`services/scheduler/reconcile.ts`) + `scanDecisions`: item `launched` yang mencapai `done` → `Notification`
> `done` + `SessionResult` ringkasan (diff review diturunkan `GET /api/specs/:id/review`, `baseSha..headSha`),
> **tanpa auto-merge** (merge tetap manual lewat git graph, ADR-0031); sesi mati sebelum `done` (gagal/limit) →
> `Notification` **`fail`** (tipe baru) + `markFailed(note)`, **tanpa retry**. Item `done`/`failed` tampil di
> `GET /api/scheduler/state.queue`; ringkasan di `GET /api/session-results`.
>
> **Panel Scheduler (SPEC-299, daun #6):** screen mandiri `SchedulerScreen.tsx` + nav item `ds/shell.tsx`
> (`key:"scheduler"`), **murni konsumen read-only** — tak menambah endpoint/skema/ADR. Self-poll `GET
> /api/scheduler/state` (5 dtk, pola GitGraph) merender: status per source (enable/last-run/next-run),
> antrean (`status:"queued"`), sesi berjalan (`state.sessions`, indikator `decision`=menunggu keputusan),
> selesai (`status:"done"`, tombol **Buka review** deep-link `#spec=<id>` → diff/ringkasan di Review yang ada),
> gagal (`status:"failed"` + `note` alasan). Panel setelan menulis semua knob via `PUT /api/scheduler/config`
> (enable+cadence per source, cap, autonomy, ambang errors); **rem darurat** Pause (`{paused:true}`) / Stop
> (`{enabled:false}`) via endpoint yang sama; **opt-in per project** (pola helpEnabled) via `PATCH
> /api/projects/:id { schedulerOptIn }`. Judul spec di baris antrean/sesi di-resolve dari daftar backlog klien.

## hanoman-lead (SPEC-409 · ADR-0091) — LOCAL per-instance
```
# Semua HTTP (polling) — TAK ADA kanal WebSocket baru (ADR-0039 utuh). Semua default MATI.
# Capability agent-token: domain `lead`, dipetakan MENURUT METHOD (baca → lead:read, tulis → lead:write).
GET  /api/lead/config      -> Lead (zLead: enabled, paused, pausedProjects[], everyMin, timeoutSec,
#                                    maxAutoAnswers, maxConcurrent, queueWaitSec,
#                                    requireGreenBeforeIntegrate, engine{enabled,agent,model,effort})
PUT  /api/lead/config      { Lead } -> Lead          # ganti blok penuh (pola PUT /scheduler/config). Pause = { paused:true }. 400 invalid.
GET  /api/lead/status      -> { config, projects:[{projectId,name,optIn,paused,decisions24h,openSessions}],
#                               queue: SchedulerQueueItem[], deciding:[sessionId], queued:[sessionId],
#                               waiting:[sessionId], lastPulseAt, gate:{inFlight,queued,capacity} }
GET  /api/lead/decisions?projectId&specId&sessionId&flowId&status&take&skip -> { items: LeadDecisionView[] }
#    LeadDecisionView: { id, projectId, specId, sessionId, gate, kind, question, answer, reason, refs[],
#                        confidence, action, choice, choiceIndex, options[], missing[],
#                        choices[{index,option}], select{mode,min,max}|null, flowId, step,
#                        status, weighty, supersededById, createdAt }   # answer/reason PENUH di sini (SPEC-480)
#    `?flowId=` = SATU rantai, urut NAIK (SPEC-485); tanpa itu daftar umum terbaru-dulu (AC-24).
POST /api/lead/decisions   { projectId, specId?, sessionId?, question, options?[], context?,
#                            select?{mode:"single"|"multi", min, max|null}, chain?, flowId? }   # SPEC-485
#                          -> 201 { id, decision, reason, refs[], confidence, action,
#                                   choice: { index (1-basis), option } | null, choices[{index,option}],
#                                   missing: string[], flowId, flowStatus }   # PINTU #1
#                             409 lead tak aktif / project tak opt-in · 409 flowId sudah tertutup (SPEC-485)
#                             404 project · 504 lead gagal memutuskan (AC-4)
#                             400 bentuk `select` mustahil dipenuhi daftar opsi yang dikirim (SPEC-485)
#                             503 { error, retryable:true, queued } + Retry-After  gerbang penuh (SPEC-479)
POST /api/lead/decisions/:id/override { answer, reason?, choices?[] } -> { old, next, delivered }
POST /api/lead/decisions/:id/cancel                       -> LeadDecisionView
# SPEC-485 · ADR-0102 · RANTAI keputusan
GET  /api/lead/flows?projectId&status&take&skip -> { items: LeadFlowView[] }
#    LeadFlowView: { id, projectId, specId, sessionId, gate, status, title, steps, closeReason,
#                    openedAt, closedAt, expiresAt }   # status: menunggu|sebagian|selesai|dibatalkan
POST /api/lead/flows/:id/submit -> LeadFlowView   # 409 bila tak ada / sudah tertutup
POST /api/lead/flows/:id/cancel -> LeadFlowView   # idem; closeReason = "operator"
```
> **Tiga pintu, satu otak** (`services/lead/decide.ts`) — urutan wajibnya bukti → putusan → saring
> rujukan → gerbang tindakan → **TULIS JEJAK** → notifikasi. Jejak ditulis SEBELUM jawaban dikirim ke
> peminta (AC-2), dan itulah alasan tak ada jalur kedua.
>
> **Pintu #1 — kontrak eksplisit** (`POST /api/lead/decisions`), dipakai sesi internal **dan** agen
> eksternal ber-`AgentToken`. Ia **endpoint TULIS**: capability `lead:read` tak pernah cukup (403
> `{need:"lead:write"}`). `capabilityForRoute` memetakan prefix `lead` menurut method — bukan
> memetakan prefix ke izin baca lalu menambah endpoint tulis di bawahnya (kelas bug SPEC-405).
>
> **Balasannya terbaca mesin** (SPEC-480 · ADR-0098): saat `options` dikirim, `choice` memuat opsi
> yang dipilih **sebagai field** — divalidasi server terhadap daftar yang dikirim peminta, dan
> pilihan di luar daftar **ditolak** (`choice: null`, alasannya dicatat di jejak, operator
> dinotifikasi). `missing` berisi apa yang kurang bila lead menyatakan konteksnya tak cukup untuk
> memutuskan; terisi ⇒ `confidence: "ragu"`. **`decision`/`reason` di balasan ini TERPANGKAS**
> (≤ 240 / ≤ 480 karakter, dipotong di batas kalimat) — prosa penuhnya ada di jejak, lewat
> `GET /api/lead/decisions`. Pemanggil lama yang hanya membaca `decision` tetap menerima kalimat
> yang bermakna: itu kompatibilitas mundur yang disengaja.
>
> **Pilihan JAMAK & rantai** (SPEC-485 · ADR-0102). `select` menyatakan bentuk pilihannya; default
> `{mode:"single",min:0,max:null}` = perilaku sebelum ADR ini, jadi permintaan lama tak berubah satu
> bit pun. Validasinya **dua lapis dan keduanya di server**: bentuk yang mustahil dipenuhi ditolak
> **400** di pintu masuk (`multi` tanpa `options`, `min > max`, `max`/`min` melebihi jumlah opsi),
> sementara jumlah pilihan lead di luar `min`/`max` **membatalkan seluruh pilihan** — bukan
> memangkasnya: memilih 3 dari maksimum 2 adalah pertanda lead salah membaca soal, dan mengambil dua
> di antaranya secara sewenang-wenang persis tebakan yang ADR-0098 hapus. `choices` adalah bentuk
> yang berlaku (**selalu daftar**); `choice` tinggal `choices[0]`, dan baris pra-migrasi diturunkan
> balik saat dibaca. **`chain: true`** membiarkan alurnya terbuka untuk pertanyaan lanjutan;
> `flowId` melanjutkannya, dan alur yang sudah di-submit menolak dengan **409**. Alur yang
> ditinggalkan ditutup penyapu (`Setting.lead.flowTtlMin`, default 60 menit) yang menumpang tick
> lead — tanpa timer baru (ADR-0024 utuh).
>
> **Pintu #2 — deteksi otomatis** (tanpa endpoint): lead melihat sesi hidup ber-marker keputusan
> terisi (mekanisme SPEC-184/196 yang sudah ada), `capture-pane`, menyimpulkan pertanyaannya, lalu
> **mengetik jawabannya ke pane** (`pty.sendToPane`, dipotong `goalChunks` — burst ≥1024 char jadi
> `[Pasted Content]` secara senyap, ADR-0085). Pane MATI tak pernah dijawab; marker sesi **codex**
> yang sebenarnya selesai wajar (ADR-0074) juga tidak. Batasnya `maxAutoAnswers` berturut-turut per
> sesi → sesudah itu lead berhenti & menotifikasi.
>
> **Pintu #3 — denyut proaktif** (`setInterval` in-process, cermin engine scheduler — tanpa queue/
> worker/cron, ADR-0024 utuh): menata urutan backlog siap-kerja (**diserahkan ke antrean & governor
> yang sudah ada**, bukan antrean kedua), mendeteksi dua sesi yang menyentuh area kerja sama (diff
> worktree lewat `specReview`), dan menindaklanjuti sesi yang berakhir dengan kode keluar ≠ 0 atau
> plan bersisa `- [ ]`.
>
> **Permukaan tindakan lead adalah allowlist tertutup** (`shared/src/lead.ts`, konstanta modul —
> bukan konfigurasi): deploy, perintah/konsol VPS, data produksi, dan penghapusan apa pun TERKUNCI
> dan ditegakkan **di server** (`services/lead/apply.ts`), bukan lewat hook penolak perintah pada
> sesi pekerja — ADR-0037 tetap utuh. Menghentikan sesi memakai `killSession()` langsung sehingga
> **worktree-nya dibiarkan utuh** (berbeda dari `DELETE /api/terminal/sessions/:id`).
>
> **Gerbang konkurensi** (SPEC-479 · QA, `services/lead/gate.ts`): ketiga pintu berbagi SATU gerbang
> penerimaan **FIFO** berkapasitas `maxConcurrent` (default 2), dipasang di choke point yang sudah
> tunggal — `decide()` — bukan disalin ke tiap pintu. Sebelumnya batas itu tak pernah dinyatakan di
> mana pun, jadi ia jatuh ke bentuk kode masing-masing pintu: **1** di pintu deteksi (`for`+`await`,
> terukur `maxInFlight = 1` dengan tangga tunggu linier untuk 6 sesi) dan **tak hingga** di pintu
> kontrak (Fastify konkuren, terukur 12 permintaan → 12 proses `claude -p`). FIFO bukan gaya: urutan
> `tmux list-panes -a` stabil, jadi gerbang "siapa cepat" melaparkan ekor daftar persis seperti loop
> serial yang digantikannya. Slot yang tak didapat dalam `queueWaitSec` (default 120) → penolakan
> **eksplisit yang bisa diulang**: `503 { retryable:true }` + `Retry-After` di pintu kontrak, lewati-
> dan-coba-lagi di pintu deteksi & denyut. Penuh **bukan** kegagalan lead — ia tak menulis baris
> jejak dan tak menambah penghitung `maxAutoAnswers`, sebab pagar itu (SPEC-472) dibuat untuk sebab
> yang tak hilang dengan mengulang sementara penuh hilang begitu slot bebas.
>
> **Opt-in per project:** `PATCH /api/projects/:id { leadOptIn }` (lokal — tak masuk `FIELDS` sync).
> **Panel Lead** (`LeadScreen.tsx` + nav `key:"lead"`) self-poll `GET /api/lead/status` +
> `GET /api/lead/decisions` (5 dtk, pola SchedulerScreen): jejak (pertanyaan → jawaban → alasan →
> rujukan), sesi menunggu vs **sedang diputuskan** vs **antre** (SPEC-479 — ketiganya terlihat sama
> di pane, hanya yang pertama butuh manusia), Pause global & per project, Timpa & Batalkan.

## Custom agent (SPEC-450 · ADR-0094)
```
# Katalog persona yang dipakai SETIAP sesi baru. Capability agent-token: domain `agents`,
# dipetakan MENURUT METHOD (baca → agents:read, tulis → agents:write) — bukan per prefix,
# karena menulis definisi agen mengubah apa yang dilihat semua sesi berikutnya (kelas bug SPEC-405).
GET    /api/custom-agents                 -> CustomAgentView[]        # agen GLOBAL saja
GET    /api/custom-agents?projectId=<id>  -> CustomAgentView[]        # himpunan EFEKTIF (global+project),
#                                            baris global bertanda `inherited: true`; nama yang ditimpa
#                                            project muncul SEKALI (versi project yang menang)
GET    /api/custom-agents/catalog[?projectId=<id>] -> AgentCatalogView
#      { tools: {id,label,group:"shortcut"|"builtin"|"mcp"}[], models: {id,label,runtime}[],
#        runtimes: {id,label}[] }   # SPEC-484 · ADR-0101 · sumber daftar untuk form.
#      tools = pintasan `*` + DEFAULT_AGENT_TOOLS + satu entri `mcp__<server>__*` per server MCP
#      yang ditemukan di ~/.claude.json (global + projects[<repoDir>]), <repoDir>/.mcp.json, dan
#      ~/.codex/config.toml — semuanya GAGAL-TERBUKA (berkas hilang/rusak → sumber dilewati).
#      Daftar MENTION sengaja TIDAK di sini: ia sudah hidup di `GET /custom-agents?projectId=`
#      lengkap dengan aturan project-menimpa-global.
POST   /api/custom-agents { projectId?, name, description, instructions, tools?, model?, mentions?, runtime?, enabled? }
#      -> 201 CustomAgentView
#         400 slug nama tak sah · projectId tak ada · mention tak dikenal { unknown: string[] }
#         400 tool tak dikenal { unknownTools: string[] } · `*` bercampur nama lain
#         400 model tak dikenal untuk runtime-nya { model, runtime } · runtime di luar {claude,codex}
#         409 nama sudah dipakai di scope itu · mention membentuk siklus { scope, cycle: string[] }
PATCH  /api/custom-agents/:id { description?, instructions?, tools?, model?, mentions?, runtime?, enabled? }
#      -> 200 CustomAgentView · 400 (termasuk upaya mengubah `name`/`projectId`) · 404 · 409 siklus
DELETE /api/custom-agents/:id -> 204     # mencabut nama itu dari `mentions` agen lain (tanpa rujukan yatim)
```
> **`id` deterministik `"<projectId|global>:<name>"`** (titik dua sah di segmen path RFC 3986) dan
> **`name` immutable** — baris ini menyeberang changefeed yang tak punya operasi hapus; rename yang
> mengubah id akan meninggalkan baris yatim di setiap mesin lain (ADR-0094).
>
> **Materialisasinya berbeda per agen, dan tak menulis satu berkas pun ke worktree.** Sesi **claude**
> lahir dengan `--agents "$(cat <file>)"` (mekanisme native; JSON di berkas tmpdir seperti prompt
> SPEC-223, karena tmux membatasi SATU command ±16 KB). Sesi **codex** menerima blok **roster** yang
> ditempel ke akhir prompt sesi — codex 0.146 tak punya padanan yang bisa diverifikasi (ia menerima
> kunci `-c` tak dikenal secara diam-diam), jadi ia mengadopsi peran **inline** tanpa proses kedua.
> Keduanya dirakit di titik cekik `createSession` lewat `registerCustomAgentSource`, jadi tak ada
> route yang perlu diubah dan tak ada yang bisa lupa memasangnya.
>
> **Anti-loop tiga lapis**, dan yang menjamin adalah dua lapis pertama: (1) graf mention wajib
> **asiklik** — divalidasi atas scope global **dan setiap project** (agen project bisa menimpa nama
> global, jadi `g→h` yang aman secara global bisa jadi `g→h(project)→g`); (2) alat delegasi (`Task`)
> **diturunkan dari `mentions`, bukan dari ketikan operator** — agen daun tak punya alat memanggil
> siapa pun, dan `Task` yang diketik operator **dicabut**; (3) anggaran hop `MENTION_MAX_HOPS = 3`
> di prosa instruksi. `DEFAULT_AGENT_TOOLS` & `MENTION_MAX_HOPS` adalah **konstanta modul, bukan
> konfigurasi** (pola `LEAD_ACTIONS`).
>
> **Verifikasi wajib menanyai agen apa yang benar-benar ia miliki, bukan exit code:** `--agents`
> ber-JSON rusak keluar **exit 0 dengan nol agen tanpa satu pun pesan**, dan nama tool tak dikenal
> dibuang senyap.
>
> **Validasi katalog KERAS, tapi hanya atas field yang ADA di payload** (SPEC-484 · ADR-0101
> keputusan 5). Nilai di luar katalog ditolak `400` yang **menyebut nilainya**; `PATCH { enabled }`
> pada baris warisan ber-`model`/`tools` asing **tetap 200**, sebab field itu tak ada di payload —
> tanpa klausa ini gerbangnya mengunci saklar aktif/nonaktif setiap baris lama. Satu pengecualian
> yang justru menegakkannya: `model` divalidasi **juga** saat hanya `runtime` yang berubah, memakai
> **runtime efektif** (`payload.runtime` bila ada, selain itu nilai baris) — `?? null` membuat setiap
> `PATCH { model }` pada agen codex divalidasi terhadap gabungan katalog dan lolos untuk model claude.
>
> **`runtime` adalah PENYARING**, bukan pemilih proses: ia menyaring apa yang masuk roster sesi.
> `null` = ikut sesi induk (dipakai **kedua** mesin), jadi baris yang lahir sebelum SPEC-484
> berperilaku persis seperti sebelumnya. Penyaringnya di `agentDefsFor(projectId, agent)`, dan
> `agent` yang dipakai wajib **agen sesi yang sebenarnya** (`agentForDefs` di `createSession`),
> bukan `Setting.agent` — sesi bisa lahir dengan override per-request (kelas bug SPEC-377).

## Telegram gateway (SPEC-476 · ADR-0096)

```text
GET    /api/telegram/status
GET    /api/telegram/chats/:chatId/context
PATCH  /api/telegram/chats/:chatId/context { activeProjectId?, activeSessionId?, personalityAgentId?, summary? }
POST   /api/telegram/chats/:chatId/memories { content }
DELETE /api/telegram/chats/:chatId/memories/:id
DELETE /api/telegram/chats/:chatId/memories
POST   /api/telegram/replies { chatId, updateId, kind, text, summary?, remember[]?, confirmation? }
GET    /api/telegram/audit?chatId&updateId&take&skip

POST   /api/terminal/sessions/:id/steer { text }
POST   /api/terminal/sessions/:id/interrupt
```

### Command runtime — dicegat server (SPEC-492)

Enam bentuk command di bawah **tidak pernah** sampai ke pane sesi operator: coordinator mencegatnya
di `dispatch()` lalu menjawab lewat outbox (`kind: "gateway-control"` — sengaja di luar
`TELEGRAM_REPLY_KINDS` karena `dedupeKey` outbox adalah `chat:update:kind`), dan gateway melewati
balasan progress generiknya (audit `outcome: "control"`). Alasannya: ia soal transport, bukan isi
hanoman; agen tak bisa mengubah model proses yang menjalankan dirinya sendiri; giliran agen terukur
14–95 detik; dan ia harus bekerja justru saat agennya macet. Presedennya update `callback`
konfirmasi, yang juga dicegat sebelum `dispatch`.

| Command | Arti |
|---|---|
| `/engine` | Tampilkan sumber nilai, runtime · model · effort, dan keadaan sesi operator |
| `/engine off` | `enabled:false` → kembali mewarisi default global sesi kerja |
| `/engine restart` | Tutup sesi operator; pesan berikutnya lahir dengan setelan baru |
| `/runtime claude\|codex` | Tukar runtime — model & effort ikut ke default agen itu |
| `/model <id>` | Tukar model (divalidasi katalog agen aktif; effort dikoersi bila codex) |
| `/effort <nilai>` | Tukar effort (divalidasi `codexEfforts(model)` / `EFFORTS`) |

Ketiganya yang menulis (`/runtime`, `/model`, `/effort`) **menyalakan `enabled` secara implisit** —
menyetel nilai lalu tak terjadi apa-apa adalah jebakan yang justru diperbaiki SPEC-492. Setelannya
**global untuk semua chat**, bukan per-chat. Nilai di luar katalog **ditolak** dengan balasan yang
menyebut daftar yang sah; setelan tersimpan tak berubah. Model milik agen seberang dijawab dengan
jalan keluarnya (`/runtime codex` dulu), bukan sekadar "tidak valid".

Yang **tidak** dilakukan: mengetik `/model`/`/effort` ke pane yang sedang hidup. ADR-0061 mencabut
matrix per-fase karena mekanisme itu tak andal, dan SPEC-487 mengukur kelasnya (ketikan ke pane yang
sedang menjalankan giliran mendarat sebagai **pesan liar**). Jalur yang dijanjikan `/engine restart`
— deterministik, dan konteks selamat lewat ringkasan + curated memory yang memang hidup di DB.

### Kredensial dari Settings (SPEC-477 · ADR-0097) — **COOKIE_ONLY**

```text
GET    /api/telegram/settings      → { fields: [{ key, label, help?, kind, source, hasValue, masked?, value? }] }
PUT    /api/telegram/settings      { HANOMAN_TELEGRAM_BOT_TOKEN?, HANOMAN_TELEGRAM_AGENT_TOKEN?,
                                     HANOMAN_TELEGRAM_ALLOWED_USER_IDS?, HANOMAN_TELEGRAM_TARGET_CHAT_ID? }
POST   /api/telegram/test          → { ok, botUsername?, chatId?, error?,
                                       inbound: { ok, reason, missingCapabilities[], polling } }
DELETE /api/telegram/credentials   → { cleared: string[], envFallback: string[] }
```

Keempat nilai adalah entri `CONFIG_REGISTRY` grup `telegram`, jadi resolvernya tetap **DB → env →
default** (ADR-0049) dan `source` per field memberi tahu mana yang masih datang dari `.env`
(deprecated). Nilai `kind: "secret"` disimpan **terenkripsi** di `RuntimeConfig` dan **tak pernah**
dikembalikan utuh — hanya `masked` + `hasValue`. `PUT` menerima subset; secret bernilai string
kosong = **pertahankan nilai lama**, dan seluruh patch divalidasi sebelum satu pun ditulis.

**SPEC-491** menambahkan satu langkah validasi ke `PUT`: bila patch memuat
`HANOMAN_TELEGRAM_AGENT_TOKEN`, nilainya **diadu ke tabel `AgentToken`** (`verifyAgentToken` +
`TELEGRAM_REQUIRED_CAPABILITIES`) sebelum apa pun ditulis; token tak dikenal/dicabut atau
capability kurang → **400** yang menyebut sebabnya. Pola `^\S{20,}$` saja pernah menerima digest
`sha256` 64-hex sebagai kredensial sah, dan nilai seperti itu membuat `installTelegramGateway`
berhenti di gerbang readiness — nol `getUpdates`, nol pesan galat, **diam total**.

`POST /telegram/test` memakai klien sekali pakai ber-timeout **10 detik** (tujuan = target chat id,
atau satu-satunya id di allowlist) dan pesan galatnya sudah lewat redaksi token. Sejak SPEC-491 ia
**selalu** membawa `inbound` — gerbang yang sama dengan `installTelegramGateway`, dibaca segar:
AgentToken sah? capability lengkap? master switch akses agent hidup? gateway sedang polling?
Tanpa itu uji koneksi hanya menguji jalur **keluar** (bot token), dan hijau-nya bisa berdampingan
dengan jalur masuk yang mati total. `DELETE` hanya menghapus
baris DB; bila `.env` lama masih terisi, resolver memakainya lagi — itu isi `envFallback`. Ketiga
sub-path ini `COOKIE_ONLY`: agent token mana pun ditolak **403**, termasuk AgentToken gateway
Telegram sendiri yang wajib memegang `settings:write`. Sama halnya, `PUT`/`DELETE /config` untuk
entri berkategori `credential` menolak identitas agent token.

Prefix `telegram` selebihnya memakai capability `telegram:read|write` menurut method. Request dari identitas
`HANOMAN_TELEGRAM_AGENT_TOKEN` wajib membawa `x-hanoman-telegram-update`; reply body wajib cocok
header dan update/chat binding. Aksi sulit dibatalkan juga wajib
`x-hanoman-telegram-confirmation` approved yang cocok method/path dan dikonsumsi single-use.
Untuk route IDE yang memilih operasi lewat body, pagar membaca operasi aktual: `POST
/projects/:id/git` memeriksa `body.op`, sedangkan revert stage baru destruktif saat
`confirmDelete:true`; request preview tetap non-destruktif.

`POST /telegram/replies` idempoten per chat/update/kind dan hanya menerima output user-facing
`progress|final|decision|failure|confirmation`. Raw PTY tidak punya endpoint ekspor ke Telegram.
Gateway sendiri **hanya** mengantre satu jenis amplop sejak SPEC-493 ·
[ADR-0104](../adr/0104-telegram-typing-indicator-long-poll-adaptif.md): `gateway-failure` saat
dispatch gagal — **tak** digerbangi `Setting.telegram.progress`, karena kegagalan bukan progress dan
harus terbaca. `kind`-nya di luar enum reply karena `dedupeKey` outbox adalah `chat:update:kind`:
memakai `"progress"` akan membuat baris gateway menelan reply session operator untuk update yang
sama. Kind `gateway-progress` **dihapus** — kehadiran gateway sekarang berupa indikator
`sendChatAction` "typing…" yang **sesaat** (tak meninggalkan jejak di chat), dinyalakan saat update
di-dispatch, di-arm ulang sesudah tiap chunk, dan **tidak** sesudah balasan final.
`Setting.telegram.progress` menggerbangi indikator itu: mati = nol panggilan `sendChatAction`.
Denyutnya adalah long-poll `getUpdates` yang **adaptif** (4 detik saat ada update `dispatched` tanpa
balasan final, 25 detik saat idle) — nol timer baru, ADR-0024 utuh.
Endpoint context/memory tidak pernah mengembalikan token atau teks inbound. Audit hanya metadata
correlation/method/path/status, tanpa body/header.

## Webhook keluar (SPEC-481 · [ADR-0100](../adr/0100-webhook-keluar-peristiwa.md)) — **COOKIE_ONLY**

`capabilityForRoute` memetakan seluruh prefix `webhooks` ke `COOKIE_ONLY`, apa pun method-nya:
permukaan ini memegang **secret penandatanganan** dan menentukan ke mana data workspace mengalir
keluar (preseden `/telegram/{settings,test,credentials}`, ADR-0097). Tak ada jalur AgentToken.

| Method | Path | Keterangan |
| --- | --- | --- |
| `GET` | `/api/webhooks` | `{ endpoints: WebhookEndpointView[], eventTypes: string[] }`. Secret **tak pernah** ikut — hanya `secretHint` (4 karakter terakhir). |
| `POST` | `/api/webhooks` | Body `zCreateWebhookEndpoint` (`name`, `url`, `events[]`, `projectIds?`, `enabled?`, `allowPrivate?`, `maxPerMinute?`, `secret?`). **201** membawa `secret` plaintext **sekali seumur hidup** (pola AgentToken). `400` untuk URL non-http(s), URL ber-kredensial, alamat internal tanpa `allowPrivate`, atau jenis peristiwa di luar katalog (respons menyebut `unknown`). |
| `PATCH` | `/api/webhooks/:id` | `zUpdateWebhookEndpoint` (semua field opsional) + `rotateSecret?`. `rotateSecret: true` mengembalikan secret baru **sekali**. Mengaktifkan ulang endpoint yang dinonaktifkan otomatis membersihkan `disabledAt`/`disabledReason`/`failureStreak`. `404` bila tak ada. |
| `DELETE` | `/api/webhooks/:id` | `204`. Riwayat pengirimannya ikut cascade. |
| `POST` | `/api/webhooks/:id/test` | Ping **sinkron** (`webhook.ping`, timeout 10 dtk) → `{ ok, httpStatus, durationMs, error }`. Tetap mencatat baris riwayat; ping yang gagal **tidak** diulang. `409` bila secret tak bisa didekripsi. |
| `GET` | `/api/webhooks/:id/deliveries?limit=` | Riwayat pengiriman, terbaru dulu (`limit` 1…200, default 50). |
| `POST` | `/api/webhooks/deliveries/:id/retry` | Kembalikan satu baris `failed`/`dropped` ke antrean (`attempt` direset). `409` bila masih `pending`/`sending`. |

Perubahan konfigurasi **berlaku tanpa restart**: setiap mutasi menyegarkan cache endpoint yang
menggerbangi tap.

### Bentuk kiriman keluar

`POST` ke URL endpoint, `Content-Type: application/json`, badan = amplop `hanoman.webhook/1`.
Header: `X-Hanoman-Event`, `X-Hanoman-Event-Id`, `X-Hanoman-Delivery`, `X-Hanoman-Attempt`,
`X-Hanoman-Timestamp`, `X-Hanoman-Signature` (`v1=` + HMAC-SHA256 heksadesimal atas
`<timestamp>.<raw body>`). Sukses = 2xx. `410 Gone` menonaktifkan endpoint seketika. Retry
berbackoff tabel (6 percobaan: 0 · 30 dtk · 2 mnt · 10 mnt · 30 mnt · 2 jam); 5 kegagalan beruntun
menonaktifkan endpoint otomatis + satu `Notification` bertipe `webhook`. Katalog jenis peristiwa
hidup di `shared/src/webhook.ts` (`WEBHOOK_ENTITIES`) dan dirender apa adanya oleh halaman
dokumentasi in-app.
