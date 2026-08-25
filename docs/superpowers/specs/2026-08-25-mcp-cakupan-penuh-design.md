# Cakupan penuh REST di MCP + pemecahan capability berbahaya

**Tanggal:** 2026-08-25
**Status:** design, menunggu plan
**Menyentuh:** `shared/src/agent.ts`, `shared/src/mcp-catalog.ts` (dipecah), `cli/src/mcp/*`,
`server/src/services/agent-capabilities.ts`, `server/src/routes/specs.ts`,
`server/src/services/telegram/bootstrap.ts`, panel Settings → Akses AI Agent.
**Mengamandemen:** ADR-0099 §4 (batas tool), ADR-0065 (kosakata capability).

## Masalah

MCP hanoman (ADR-0099) mengekspos **17 tool** dari **259 endpoint** REST — ±6,6 % permukaan.
Batas itu disengaja, tapi konsekuensinya: agen di klien MCP lain (Codex/Cursor/Copilot) tak bisa
membaca kode project, tak bisa membaca PRD/docs/changelog, dan tak bisa melihat maupun menyesuaikan
setelan workspace. Tiga kebutuhan itu yang memicu spec ini.

Operator memutuskan cakupan **penuh**: seluruh permukaan REST yang terjangkau agent token dibungkus,
termasuk yang ditolak eksplisit ADR-0099 §4 (spawn sesi, VPS, integrate, delete/stage).

## Yang tak bisa diubah spec ini

`capabilityForRoute` (`server/src/services/agent-capabilities.ts:19`) adalah gerbang sesungguhnya.
Route yang jatuh ke `COOKIE_ONLY` atau `null` **tak terjangkau agent token sama sekali**, jadi tak
ada tool MCP yang bisa dibuat untuknya tanpa mengubah gate itu — dan mengubahnya berada di luar
spec ini:

- `auth`, `agent-tokens`, `device-tokens`, `sync`, `presence`, `portal`, `client-accounts`,
  `session-events`, `webhooks`
- `scheduler/crons` — punya cabang `COOKIE_ONLY` sendiri (`agent-capabilities.ts:44`) dengan alasan
  yang persis kasus kita: *"cron adalah `POST /terminal/sessions` yang ditunda"*
- `telegram/{settings,test,credentials}`, `terminal/workspace`
- `members`, `tasks`, `methods`, `session-results` — top-segment tak terdaftar → `null`

## Keputusan

### 1. Tulis penuh, termasuk yang mengeksekusi

ADR-0099 §4 menolak `POST /terminal/sessions`, `/api/vps*`, `POST /specs/:id/integrate`,
`DELETE /specs/:id`, dan `PATCH /specs/:id {stage}`. Spec ini memasukkan semuanya.

**Alasan yang membalik:** endpoint-endpoint itu **sudah** terjangkau agent token lewat REST hari ini
(`capabilityForRoute` memetakan `sessions:write`, `vps:write`, `backlog:write` ke sana). Tidak
membungkusnya di MCP tak menutup apa pun — ia hanya memaksa agen memakai `curl` tanpa skema, tanpa
redaksi token, tanpa pemotongan JSON yang sah. Batas nyata harus dipasang di capability, bukan di
ketiadaan tool. Itulah keputusan 2.

### 2. Empat capability baru dengan akses ketiga: `danger`

`CAPABILITY_IDS` (`shared/src/agent.ts:5`) bertambah empat. `zCapabilityInfo.access` melebar dari
`"read" | "write"` menjadi `"read" | "write" | "danger"`.

| Capability | risk | Route yang pindah ke sana |
|---|---|---|
| `sessions:spawn` | `rce` | `POST /terminal/sessions` |
| `ide:git` | `exec` | `POST /projects/:id/git`, `/git/{merge,rebase,pull,drop}`, `POST /branches/delete`, `POST /worktrees/delete` |
| `backlog:lifecycle` | `exec` | `DELETE /specs/:id`, `POST /specs/:id/integrate`, `PATCH /specs/:id {stage}` |
| `vps:exec` | `exec` | `console`, `session`, `provision{,/preview}`, `harden`, `remediate{,/preview}`, `probe`, `test` |

**`grantsCapability` (`agent.ts:85`) tidak diubah aturannya.** `:write` mengimplikasikan `:read` dan
itu saja. Pecahan `danger` **tidak** diimplikasikan `:write` — kalau diimplikasikan, pemecahannya
kosmetik dan spec ini tak menghasilkan batas apa pun.

Sisa di `:write` masing-masing domain: sesi → steer/interrupt/jawab dialog/tutup; ide → tulis
berkas, entry, upload, remote; backlog → buat/ubah spec, source, done, lampiran; vps → CRUD,
checklist, na/attest.

`projects:destroy` **tidak** dibuat: `DELETE /projects/:id` dan `POST /:id/rename` tetap
`projects:write`, dan pengamanannya murni di tingkat mode MCP (keputusan 4).

### 3. `PATCH /specs/:id {stage}` bercabang menurut body — dan gerbangnya BUKAN di `capabilityForRoute`

Ini titik paling rawan di seluruh desain. `capabilityForRoute` hari ini murni fungsi
`(method, path)`; ia tak pernah melihat body, dan justru kemurnian itu yang membuatnya bisa diuji
kontrak terhadap katalog MCP (`samplePath`/`sampleMethod`). Mencabangkannya menurut body akan
menghancurkan properti itu.

Karena itu: `capabilityForRoute` tetap memetakan `PATCH /specs/:id` → `backlog:write`, dan gerbang
`backlog:lifecycle` dipasang **di dalam handler route** (`server/src/routes/specs.ts`) sebagai
pemeriksaan kedua yang berjalan setelah gate umum, hanya ketika `body.stage !== undefined`.

Konsekuensi yang harus ditulis di ADR: pemeriksaan kedua ini **tak terlihat** oleh uji kontrak
katalog, jadi ia butuh test unitnya sendiri — sebuah agent token ber-`backlog:write` tanpa
`backlog:lifecycle` yang mengirim `{stage}` harus dapat 403, dan yang mengirim field lain harus 200.

### 4. Tiga tingkat mode CLI; `--danger` bukan gerbang keamanan

`--read-only` → *(default)* → `--danger` / `HANOMAN_MCP_DANGER=1`.

Mengikuti ADR-0099 §5: tingkat yang lebih rendah **menghilangkan** tool dari `tools/list`, bukan
menolaknya saat dipanggil. Tool yang tak terlihat tak bisa dicoba.

`hanoman_about` melaporkan tingkat yang aktif, sehingga agen tahu kenapa sebuah tool tak ada
alih-alih menyimpulkan servernya rusak.

**Ditulis eksplisit di ADR:** flag ini melindungi dari agen yang **salah pilih tool**, bukan dari
agen yang **berniat** — token yang sama tetap bisa memanggil REST langsung. Gerbang keamanannya
adalah capability pada token (keputusan 2). Menyebut `--danger` sebagai kontrol keamanan di dokumen
mana pun adalah kekeliruan yang harus dikoreksi.

### 5. Katalog: 152 tool, dipecah per domain

Satu tool per **niat kerja**, bukan per endpoint. Enumerasi penuh dari tabel route menghasilkan
**152**. Dua perkiraan awal (~75, lalu 113) keliru dan tak berlaku; 152 adalah hasil enumerasi
endpoint demi endpoint, dan lampiran di akhir dokumen ini memuat daftarnya.

| Domain | Ada | Baru | Total | `danger` |
|---|---|---|---|---|
| backlog | 6 | +11 | 17 | 3 |
| docs/prd/changelog | 0 | +12 | 12 | 2 |
| ide | 0 | +27 | 27 | 8 |
| projects | 2 | +8 | 10 | 2 |
| sessions | 1 | +15 | 16 | 4 |
| settings/config/scheduler | 0 | +11 | 11 | 0 |
| agents | 0 | +5 | 5 | 1 |
| lead | 2 | +8 | 10 | 1 |
| support | 3 | +11 | 14 | 1 |
| telegram | 0 | +8 | 8 | 1 |
| vps | 0 | +18 | 18 | 10 |
| notifications | 2 | +1 | 3 | 1 |
| `hanoman_about` | 1 | — | 1 | — |
| **Total** | **17** | **+135** | **152** | **34** |

Dengan `--danger` mati, `tools/list` menampilkan **118 tool**.

Penggabungan yang dipakai, dan hanya ini — semuanya menggabungkan endpoint yang berbeda hanya pada
ada/tidaknya satu argumen, bukan yang berbeda niat: `GET /commit/:sha` + `/commit/:sha/file` → satu
tool ber-`path` opsional; `GET /compare` + `/compare/file` → sama; `graph` + `graph/search` → satu
ber-`q` opsional; `worktrees` + `worktrees/stats` → satu; `GET /specs/:id/review` + `/review/*` →
satu; `GET /terminal/sessions/:id/review` + `/review/*` → satu; `GET /prds` + `GET
/projects/:id/prds` → satu ber-`project` opsional; `POST /vps/:id/items/:itemId/na` +
`/items/na-bulk` → satu.

Operasi git **tidak** digabung: `merge`, `rebase`, `pull`, `drop`, dan runner mentah `POST /git`
adalah lima niat berbeda dengan lima cara gagal berbeda, dan semuanya berbahaya. Hal yang sama untuk
`provision` / `harden` / `remediate` / `probe` / `test` / `console` / `session` di VPS.

**Tiga endpoint sengaja tak dibungkus** — multipart/biner, tak ada bentuk yang masuk akal lewat tool
teks: `POST /specs/:id/attachments`, `POST /projects/:id/upload`, `GET /projects/:id/archive`.
Satu lagi tak dibungkus karena bukan HTTP request-response: `GET /terminal/sessions/:id/ws`.
Keempatnya ditulis di ADR supaya "kok tidak ada" tak jadi pertanyaan berulang.

**Pemecahan berkas.** `shared/src/mcp-catalog.ts` (satu berkas hari ini) menjadi
`shared/src/mcp-catalog/` berisi satu berkas per domain + `index.ts` yang merakit `MCP_TOOLS`.
Bentuk `McpToolDef` tak berubah sedikit pun, jadi `cli/src/mcp/server.ts` **tak tersentuh** kecuali
untuk menyalurkan tingkat mode ketiga.

### 6. Token yang sudah terbit DISEMPITKAN, tidak di-backfill

Migration menambahkan nilai capability baru; ia **tidak** menambahkan hak ke token mana pun. Token
yang hari ini punya `sessions:write` akan berhenti bisa spawn sesi sampai manusia mencentang
`sessions:spawn` di Settings → Akses AI Agent.

Ini breaking change yang disengaja: least-privilege menang atas kenyamanan, dan hak berbahaya harus
lahir dari tindakan sadar, bukan diwarisi diam-diam.

**Radius ledakannya nyata dan sudah terukur.** `TELEGRAM_REQUIRED_CAPABILITIES`
(`server/src/services/telegram/bootstrap.ts:18`) mengunci 23 capability, dan `credentials.ts:60`
menolak menyalakan gateway bila **satu pun** kurang — bukan 403 per-panggilan, tapi gateway tak
jalan sama sekali. Ini kelas kegagalan SPEC-491 ("Telegram diam total") yang sudah pernah dibayar.

Urutan langkah yang menjinakkannya:

1. Migration menambah nilai capability. Tak ada baris token yang disentuh.
2. `TELEGRAM_REQUIRED_CAPABILITIES` bertambah empat → `telegramInboundReadiness` melaporkan
   `missingCapabilities`, dan panel Settings sudah punya jalur menampilkannya
   (`credentials.ts:62`, `bootstrap.ts:157`).
3. Panel "Akses AI Agent" menampilkan kartu peringatan pada token yang **kehilangan hak** akibat
   pemecahan — kalimatnya menyebut hak yang hilang, bukan sekadar memunculkan checkbox kosong baru
   yang tak berbicara apa-apa.
4. Release note menyebutnya breaking change, dengan daftar empat capability dan siapa yang perlu
   mencentangnya.

### 7. Gerbang anti-drift: tiga assert baru di uji kontrak

152 tool tak bisa dijaga dengan ketelitian manusia. `shared/src/mcp-catalog.test.ts` sudah menguji
`samplePath`/`sampleMethod` tiap tool terhadap `capabilityForRoute` (ADR-0099 §3). Tiga assert baru:

1. **Mode ⇔ capability.** Setiap tool yang menuntut capability pecahan (`*:spawn`, `ide:git`,
   `backlog:lifecycle`, `vps:exec`) **wajib** bermode `danger`; dan setiap tool bermode `danger`
   wajib menuntut salah satunya (kecuali daftar-kecuali eksplisit untuk `project_delete`,
   `docs_delete`, `changelog_delete`, `ticket_delete`, `agent_delete`, `history_clear` — destruktif
   tapi capability-nya `:write`).
2. **Cakupan.** Setiap route di `server/src/routes/**` yang **terjangkau** agent token punya tool
   atau tercantum di daftar-kecuali eksplisit. Endpoint baru yang lupa dibungkus **menggagalkan
   test**, bukan lolos senyap. Tabel route diturunkan dari sumber, bukan ditulis tangan.
3. **Tingkat mode.** `mcpToolsFor` tanpa `danger` tak mengembalikan satu pun tool bermode `danger`;
   dengan `--read-only` tak mengembalikan tool bermode `write` maupun `danger`.

Plus test unit untuk gerbang body-aware keputusan 3.

## Yang TIDAK dikerjakan spec ini

- Membuka `scheduler/crons`, `webhooks`, `portal`, `sync`, atau permukaan `COOKIE_ONLY` lain.
  Semuanya butuh perubahan gate server dengan alasannya sendiri.
- Endpoint REST baru. MCP tetap klien kontrak yang sudah ada.
- Perubahan skema Prisma di luar nilai capability. `AgentToken.capabilities` sudah array string.
- Membungkus tiga endpoint multipart/biner.
- `projects:destroy` sebagai capability terpisah.

## Risiko yang diterima

| Risiko | Mitigasi |
|---|---|
| Gateway Telegram mati saat upgrade | Urutan langkah keputusan 6 + kartu peringatan Settings + release note |
| `tools/list` 118 tool membebani konteks klien | `--read-only` menyusutkannya; per-domain split memudahkan pemangkasan kelak |
| Gerbang body-aware `{stage}` luput dari uji kontrak | Test unit khusus, ditulis di ADR sebagai utang yang disadari |
| `--danger` disalahpahami sebagai kontrol keamanan | Dinyatakan eksplisit di ADR, deskripsi tool, dan `hanoman_about` |
| Integrasi pihak ketiga yang memakai token lama patah senyap | Breaking change diumumkan; 403 menyebut capability yang kurang (`checkAgentCapability` sudah mengembalikan `need`) |

## Lampiran — daftar 152 tool

`D` = mode `danger`. `✓` = sudah ada hari ini.

**about (1)** — `hanoman_about` ✓

**backlog (17)** — `backlog_search` ✓, `backlog_get` ✓, `backlog_create` ✓, `backlog_update` ✓,
`backlog_docs_list` ✓, `backlog_doc_read` ✓, `backlog_batch_create`, `backlog_source_set`,
`backlog_mark_done`, `backlog_escalation_get`, `backlog_review`, `backlog_attachments_list`,
`backlog_attachment_read`, `backlog_attachment_delete`, `backlog_delete` D,
`backlog_integrate` D, `backlog_stage_set` D

**docs (12)** — `docs_list`, `docs_read`, `docs_write`, `docs_delete` D, `prds_list`, `prd_read`,
`breakdown_get`, `changelog_sources`, `changelog_list`, `changelog_get`, `changelog_create`,
`changelog_delete` D

**ide (27)** — `ide_tree`, `ide_file_read`, `ide_file_write`, `ide_file_diff`,
`ide_working_status`, `ide_entry_create`, `ide_entry_rename`, `ide_entry_delete` D,
`ide_git_status`, `ide_graph`, `ide_commit`, `ide_compare`, `ide_stashes`, `ide_remotes_list`,
`ide_remote_add`, `ide_remote_update`, `ide_remote_delete`, `ide_pr_url`, `ide_branches_unused`,
`ide_branch_delete` D, `ide_worktrees_list`, `ide_worktree_delete` D, `ide_git_run` D,
`ide_git_merge` D, `ide_git_rebase` D, `ide_git_pull` D, `ide_git_drop` D

**projects (10)** — `projects_list` ✓, `project_get` ✓, `project_create`, `project_update`,
`project_branches`, `help_center_get`, `help_center_set`, `help_center_delete`,
`project_rename` D, `project_delete` D

**sessions (16)** — `sessions_list` ✓, `session_phases`, `session_steer`, `session_interrupt`,
`session_dialog_get`, `session_dialog_answer`, `session_dialog_takeover`, `session_review`,
`session_cleanups`, `session_history_list`, `session_history_get`, `session_history_transcript`,
`session_create` D, `session_integrate` D, `session_delete` D, `session_history_clear` D

**settings (11)** — `settings_get`, `settings_set`, `config_get`, `config_set`, `config_unset`,
`scheduler_state`, `scheduler_queue`, `scheduler_config_get`, `scheduler_config_set`,
`scheduler_queue_cancel`, `scheduler_queue_requeue`

**agents (5)** — `agents_catalog`, `agents_list`, `agent_create`, `agent_update`, `agent_delete` D

**lead (10)** — `lead_ask` ✓, `lead_decisions_list` ✓, `lead_status`, `lead_config_get`,
`lead_config_set`, `lead_flows_list`, `lead_flow_cancel`, `lead_decision_override`,
`lead_decision_cancel`, `lead_flow_submit` D

**support (14)** — `tickets_list` ✓, `ticket_get` ✓, `github_issues_list` ✓,
`ticket_attachment_read`, `ticket_update`, `ticket_accept`, `ticket_reject`, `ticket_unlink`,
`github_issues_pull`, `github_issue_accept`, `github_issues_accept_bulk`, `github_issue_reject`,
`github_issue_unlink`, `ticket_delete` D

**telegram (8)** — `telegram_status`, `telegram_audit`, `telegram_context_get`,
`telegram_context_set`, `telegram_memory_add`, `telegram_memory_delete`,
`telegram_memories_clear`, `telegram_reply_send` D

**vps (18)** — `vps_list`, `vps_create`, `vps_update`, `vps_delete`, `vps_components`,
`vps_checklist`, `vps_item_na`, `vps_item_attest`, `vps_audit` D, `vps_probe` D,
`vps_remediate_preview` D, `vps_remediate` D, `vps_provision_preview` D, `vps_provision` D,
`vps_harden` D, `vps_test` D, `vps_console` D, `vps_session` D

**notifications (3)** — `notifications_list` ✓, `notifications_mark_read` ✓,
`notifications_clear` D
