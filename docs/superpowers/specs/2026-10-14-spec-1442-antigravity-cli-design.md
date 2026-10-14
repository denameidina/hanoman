# SPEC-1442 — Runtime Antigravity CLI

## Konteks & keputusan

Fase Brainstorm · 2026-10-14. Base/kandidat riset:
`c6800c59837a152e413d8b7834ced0b21adcb084`.
Status Brainstorm: selesai setelah relay keputusan manusia atas blocker native CLI. Desain memakai adapter native dengan batas kemampuan eksplisit; Objective, Spec, Plan dan Execute masih harus dikerjakan oleh fase masing-masing.

### Tujuan dan kontrak yang mengikat

Operator ingin memilih runtime ketiga `antigravity` untuk sesi interaktif tmux + worktree
melalui Backlog, Terminal, IDE/ide, dan lead. Biner efektif `HANOMAN_ANTIGRAVITY_BIN`, versi di
Settings, model/effort, trust, instruksi, skill, MCP, dan picker mengikuti jalur produk yang sama.
Claude/Codex tidak berubah perilakunya. Batas kemampuan runtime harus terlihat, bukan fallback
diam-diam. Tidak ada perubahan skema DB tanpa migration + ADR.

SoT: ADR-0002/0016 (worktree/tmux), ADR-0037 (permission bypass sesi), ADR-0049 (config efektif),
ADR-0074 (dimensi runtime), ADR-0101 (runtime Custom Agent = filter), ADR-0159 (native child,
availability dan bukti), ADR-0164/0170 (orchestrasi foreground/fallback), ADR-0202 (keputusan MCP),
serta [katalog model](../../../internal/docs/architecture/model-catalog.md).

### Riset primer — fakta dan batas bukti

| Area | Bukti terverifikasi | Implikasi |
| --- | --- | --- |
| Biner/install | `command -v agy` = `/Users/denameidina/.local/bin/agy`; `agy --version` = `1.3.4`. [Install resmi](https://antigravity.google/docs/cli/install/) memakai installer native ke `~/.local/bin/agy`. | Default biner `agy`, bukan launcher IDE `antigravity`. |
| Interaktif | `agy --help` exit 0: `--prompt-interactive/-i`, `--model`, `--effort low\|medium\|high\|xhigh\|max`, `--dangerously-skip-permissions`. [Overview](https://antigravity.google/docs/cli/overview/) menyebut tmux. | Prompt awal wajib lewat `-i`; jangan meneruskan argv Claude/Codex. |
| One-shot | Help mengonfirmasi `--print/-p`, `--output-format text\|json\|stream-json`, `--print-timeout`, `--continue`, `--conversation`. [Headless resmi](https://antigravity.google/docs/cli/headless/) menjelaskan error model unknown dan stream. | Hanya lead brain internal existing boleh memakai `-p`; seluruh sesi kerja parent/child tetap interaktif. |
| Auth | Docs install: keyring lokal atau browser OAuth; SSH memakai URL/code; API key membutuhkan `modelProvider: gemini` dan `GEMINI_API_KEY`; endpoint opsional `GOOGLE_GEMINI_BASE_URL`. | Kredensial tetap milik mesin; jangan menyalin ke response atau anak runtime lain. |
| Trust | Settings lokal dibaca hanya bentuknya: `trustedWorkspaces` = list of strings. Probe PTY direktori temp, tanpa prompt/inferensi, dengan bypass tetap menampilkan `Do you trust the contents of this project?`. Proses dihentikan per-PID dan di-reap. | Bypass tool tidak menyelesaikan trust. Normalisasi realpath, matching parent/worktree dan append-preserve perlu probe lanjutan di Spec/Execute. Jangan menyatakan parent inheritance sudah terbukti. |
| Model | `agy models` exit 0 mengembalikan `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`, `gpt-oss-120b-medium`. [Model resmi](https://antigravity.google/docs/models/) bergantung plan. | Discovery CLI/cache/fallback mengikuti katalog existing; jangan menawarkan semua effort help untuk setiap model tanpa bukti. |
| Rules/skill | [Rules](https://antigravity.google/docs/rules/): root/directory `AGENTS.md` atau `GEMINI.md`, `.agents/rules`; global `.gemini`. [Skills](https://antigravity.google/docs/skills/): `.agents/skills`, global `~/.gemini/antigravity-cli/skills`. | Instruksi repo dan injeksi symlink `.agents/skills` dapat dipakai; precedence project tetap dijaga. |
| MCP | [MCP](https://antigravity.google/docs/mcp/): global `~/.gemini/config/mcp_config.json`, workspace `.agents/mcp_config.json`, objek `mcpServers`, stdio `command/args/env` atau remote `serverUrl`. `agy mcp add --help` membuktikan env/header dan urutan flag. | Hanoman stdio `hanoman mcp` dapat dikonfigurasi; jangan memakai key config Codex atau Claude. |
| Hook/idle | [Hooks](https://antigravity.google/docs/hooks/): workspace `.agents/hooks.json`, global config/settings; SessionStart, Pre/PostToolUse, Pre/PostInvocation, Stop. [Statusline](https://antigravity.google/docs/cli/statusline/): stdin JSON `agent_state=idle/thinking/working/tool_use/initializing`, task_count, pending-input dan confirmation. | Ada sumber native potensial; belum dibuktikan relay event/gate/foreground hanoman bekerja. Jangan mengklaim parity telemetry. |
| Custom child | [Subagent](https://antigravity.google/docs/subagents/): `.agents/agents`, global `.gemini/config/agents`, invoke_subagent, model tier `inherit/flash/pro`, async, workspace branch. | Tier native diizinkan; exact model/effort independen dan foreground bukan syarat v1. Auditor read-only unavailable sampai enforcement terbukti. Native branch belum membuktikan kontrak isolated-worktree hanoman. |

### Peta implementasi yang harus diteruskan

- `shared/src/enums.ts:12`, `runner/src/types.ts:12`: union Agent; cermin presence/history/overview,
  DTO MCP, skills/method/model catalogs dan engine harus mengenali nilai ketiga.
- `server/src/services/pty.ts:275,801,1053,1103`: biner, pusat spawn, prompt/skill, sandbox.
  `runner/src/agent-cli.ts:22` harus punya cabang Antigravity eksplisit. Parser metadata tmux
  `pty.ts:552` harus mempertahankan runtime sesudah restart.
- `session-launch.ts:161,205,261`, routes Terminal/IDE/specs: runtime/default/trust/phase plan.
  `server/src/services/lead/brain.ts:24,40` adalah spawn one-shot kedua; biner, argv dan env wajib ikut.
- `shared/src/runtime-defaults.ts`, `server/src/services/runtime-defaults.ts`, Settings:
  blok baru bersifat additive di Setting JSON; seed mempertahankan pilihan operator dan default lama.
- `model-catalog-probe.ts`, `codex-version.ts`, `shared/src/agent-catalog.ts`:
  discovery/version Antigravity, cache bounded, sumber sesuai host/sandbox, model effort terverifikasi.
- `shared/src/custom-agent.ts:13`, routes/services Custom Agent, orchestration/builtin matrices:
  picker/filter tersedia, capability unavailable punya alasan dan tidak mengadopsi persona inline.
- `skill-inject.ts:26`, katalog VPS `components.ts:17`, provisioning/doctor/config registry:
  jalur install dan skill, serta kemampuan deployment harus konsisten.

Production memakai image sesi, credential dir `/agent-home:ro`, dan worktree `/workspace`;
login keyring host tidak otomatis tersedia. Layout config/state writable Antigravity dan image
ber-`agy` belum dibuktikan. Jangan melonggarkan boundary produksi untuk membuat runtime baru jalan.

### Alternatif dan pendekatan yang dipilih

1. **Adapter native dengan batas eksplisit — dipilih manusia:** runtime ketiga mengikuti
   pipeline tmux/worktree yang ada. Parent memakai model/effort CLI exact; child native memakai
   tier yang didukung CLI. Kemampuan yang belum terbukti ditolak/ditandai unavailable dengan
   alasan. Ini memenuhi sesi interaktif tanpa menjanjikan parity yang belum ada.
2. **Parity native penuh:** exact model/effort per-child, foreground, telemetry dan sandbox
   lengkap. Riset versi 1.3.4 belum membuktikannya; bukan scope wajib SPEC ini setelah relay.
3. **Bridge atau SDK sebagai pengganti child native:** membutuhkan arsitektur proses baru;
   ditolak manusia. Tidak ada child `agy -p`, bridge TUI atau substitusi Python SDK.

### Keputusan manusia final (menggantikan requirement native penuh sebelumnya)

| Area | Keputusan yang berlaku |
| --- | --- |
| Sesi kerja | Parent TUI di tmux + worktree; child persistent native `invoke_subagent`. Parent dan child tetap interaktif, tidak one-shot. Lead brain internal existing boleh tetap one-shot. |
| Default parent | `gemini-3.8-flash-high` + `high`; seed additive mempertahankan pilihan operator Claude/Codex. |
| Child model | Tier native bawaan diizinkan. Model/effort exact independen dan foreground yang belum terbukti **tidak lagi wajib**; keterbatasannya terlihat pada dashboard dan docs. |
| Read-only | Auditor baru tersedia hanya sesudah enforcement nyata terbukti. Bila belum terbukti, `available=false` dengan alasan; instruksi prosa bukan bukti enforcement. |
| Status | Observasi tmux + marker fase. Batas native telemetry, notifikasi keputusan, dan gate goal dijelaskan; jangan menyatakan parity hook Claude/Codex. |
| MCP | Global `~/.gemini/config/mcp_config.json`, merge-preserve entri operator. |
| Deployment | Host/lab; launch sandbox ditolak eksplisit sampai auth/state terverifikasi, boundary produksi tetap utuh. |
| Versi/API | Additive `/api/antigravity/version` + tool MCP baca; endpoint Codex dipertahankan. |
| Bridge | Tetap ditolak, termasuk bridge interaktif persisten. |

Keputusan ini diterima lewat relay orchestrator setelah retry Brainstorm. Requirement awal exact
model/effort independen dan foreground telah diamandemen **oleh manusia**; tidak diturunkan agen.
Riset bounded sebelumnya tetap menjadi bukti batas CLI, bukan blocker scope final ini.

## Objective

Dalam satu rilis, operator dapat memilih `antigravity` untuk melahirkan sesi kerja interaktif di
tmux + worktree melalui backlog, Terminal, IDE, dan lead, dengan konfigurasi runtime yang
terdeteksi dan batas kemampuan yang dinyatakan jelas; Claude dan Codex tetap berperilaku sama.

Kriteria sukses:

- **SC1 — Peluncuran:** `Agent` dan metadata sesi menerima `antigravity`; jalur backlog, Terminal,
  IDE, dan lead meluncurkan TUI `agy` interaktif dengan prompt awal, default model/effort, dan
  permission bypass sesuai kontrak CLI. Parent dan child native tetap interaktif; hanya lead brain
  internal existing yang boleh memakai mode one-shot.
- **SC2 — Konfigurasi runtime:** `HANOMAN_ANTIGRAVITY_BIN` memilih biner efektif, versi tampil di
  Settings melalui endpoint versi aditif dan tool MCP baca, serta default parent
  `gemini-3.8-flash-high`/`high` dapat diubah tanpa mengubah pilihan Claude/Codex yang sudah ada.
- **SC3 — Konfigurasi workspace:** trust worktree, aturan/instruksi, skill, dan server MCP Hanoman
  memakai format Antigravity; pembaruan trust dan MCP merge-preserve konfigurasi operator, dan
  kredensial runtime tidak bocor ke proses Claude/Codex atau subprocess yang tidak terkait.
- **SC4 — Ketersediaan UI/API:** Settings, backlog, Custom Agent, dan Terminal menampilkan pilihan
  Antigravity. Native child menggunakan tier yang didukung; exact model/effort independen dan
  foreground bukan jaminan. Auditor read-only dan capability lain yang belum terbukti ditolak
  dengan alasan yang dapat dilihat, termasuk pada jalur API.
- **SC5 — Observabilitas dan batas:** status sesi memakai observasi tmux dan marker fase. Batas
  telemetry native, notifikasi keputusan, goal gate, isolated-worktree Custom Agent, dan launch
  sandbox host harus dinyatakan; sandbox ditolak sampai auth/state terverifikasi.
- **SC6 — Bukti regresi dan dokumentasi:** test memverifikasi pemilihan biner, argv sesi interaktif,
  trust, runtime-defaults, dan tidak berubahnya perilaku Claude/Codex; docs internal serta ADR dan
  keputusan MCP untuk API baru diperbarui dan ditautkan di index dalam commit implementasi yang
  sama.

### Desain komponen dan perilaku

- Adapter runtime eksplisit pada shared/runner/server: tidak memakai cabang `else = codex`.
  Biner efektif `HANOMAN_ANTIGRAVITY_BIN` (default `agy`), argv `--prompt-interactive`, model,
  effort dan permission bypass berasal dari kontrak CLI. Jalur backlog, Terminal, IDE, lead
  mengikuti pusat launch existing; shell mentah tetap bukan agen. Metadata tmux memulihkan
  runtime ketiga setelah restart.
- Settings/runtime-defaults additive pada JSON existing, tanpa perubahan skema yang direncanakan.
  Katalog model parent ditemukan lewat CLI non-inferensi, bounded/cache seperti
  [katalog model otomatis](../../../internal/docs/architecture/model-catalog.md). Katalog
  **child tier** dipisahkan dari slug parent agar form/phase plan tidak memancarkan slug invalid
  atau menjanjikan effort independen. Nilai existing unsupported diberi alasan, tidak diganti
  diam-diam. Custom Agent tetap runtime filter sesuai ADR-0101.
- Registry Custom Agent dimaterialisasi untuk discovery native; tidak mengadopsi persona inline.
  Native tier/inherit diteruskan apa adanya, bukan dipresentasikan sebagai model exact terkunci.
  Kemampuan `read-only` dan `isolated-worktree` yang belum memenuhi kontrak ADR-0159 ditandai
  unavailable. Orkestrasi fase mengikuti lifecycle persistent native; batas background/foreground
  dijelaskan, tanpa menganggap prompt sebagai enforcement runtime.
- Trust memakai konfigurasi Antigravity sendiri dan normalisasi realpath. Write append/merge
  mempertahankan konfigurasi operator, idempoten dan atomik. Parent/worktree matching harus
  dibuktikan pada Spec/Execute; bila tidak mendukung inheritance, trust cwd worktree aktual.
  Gagal persiapan trust/config harus menghasilkan alasan nyata, bukan sesi yang dianggap siap.
- Skill/instruksi menggunakan konvensi resmi AGENTS.md/GEMINI.md dan `.agents/skills` tanpa
  menimpa instruksi repo. Config MCP global ditulis merge-preserve, tidak mencetak token ke
  dashboard/log. Env runtime baru disaring mengikuti pola `inheritEnv` supaya credential tidak
  bocor ke sesi Claude/Codex atau subprocess lain.
- Dashboard menampilkan Antigravity pada Settings, backlog, Custom Agent dan Terminal, beserta
  batas yang relevan saat dipilih. Versi unavailable/timeout/error terlihat; bukan version palsu.
  Capability yang belum tersedia tidak bisa dipakai lewat API meskipun picker disabled.
  Native telemetry/token yang tidak diukur tetap unknown/null, bukan nol.
- Goal/notifikasi memakai perilaku tmux/marker yang terukur. Gate native, deteksi keputusan
  semantik, dan telemetry child tidak dijanjikan oleh v1; opsi yang membutuhkan kemampuan
  tersebut diberi alasan unsupported sesuai kontrak existing. Jangan memasang hook safety
  umum yang telah dicabut ADR-0037.

### Bukti native dan batas verifikasi

Probe schema-only terdahulu memakai `agy -p /model --agent <probe> --output-format json`,
read-only slash dengan nol inferensi (`num_turns: 0`), bukan rancangan pekerjaan child.
Kontrol **nama/file sama** menghasilkan `flash` exit 0 SUCCESS, slug
`gemini-3.8-flash-high` exit 1 unknown agent, `flash` kembali exit 0, `inherit` exit 0,
`claude-opus-5-5-high` exit 1. Biner memuat validasi tier
`inherit|flash_lite|flash|pro`. `agy plugin validate` menerima tier dan slug invalid sama-sama
exit 0, sehingga validator plugin bukan bukti loader runtime. Berkas global/temp probe telah
dibersihkan; tidak ada plugin di-install.

Audit retry pada kandidat `c8837707ee14dfdd8067372dd5f82462d0f8ad13` memeriksa hipotesis
transient/settings/SDK: [kontrak tools](https://antigravity.google/docs/hooks) tidak memberikan
parameter exact model/effort pada `define_subagent`/`invoke_subagent`;
[Settings](https://antigravity.google/docs/settings) menjelaskan override sesi;
[changelog](https://www.antigravity.google/docs/changelog?tab=cli) membedakan tier CLI dan model
child independen SDK. [SDK](https://antigravity.google/docs/sdk/subagents/) bukan TUI `agy`.
Accessor internal `SubagentSpec.GetModel/GetModelTier/GetRunAsTask` dan
`InvokeSubagent.GetTaskMode` ditemukan lewat `strings`, tetapi bukan kontrak publik atau
bukti live execution. Tidak boleh dipancarkan hanya berdasarkan nama simbol.

Dokumentasi native [subagents](https://antigravity.google/docs/subagents/) mendukung lifecycle
running/idle, auto-wake dari pesan dan retensi konteks; ini mendasari interaktivitas persistent
child tanpa proses one-shot baru. Model tier dan lifecycle yang terdokumentasi belum membuktikan
semua konfigurasi yang akan ditulis hanoman bekerja; Spec/Execute perlu smoke materialisasi native.
Probe `.agents/agents` temp sebelumnya tidak discover agent, sedangkan global berhasil;
discovery sesi terisolasi harus diselesaikan sebelum klaim availability. Jangan menimpa registry
operator atau membocorkan agent khusus satu sesi ke sesi tetangga.

Read-only: `PreToolUse` dengan `decision: deny` adalah jalur potensial. Warisan/scope child dan
blocking tool mutasi nyata belum dibuktikan; karena manusia menyetujui unavailable dengan alasan,
ketidaktersediaan auditor read-only adalah hasil v1 yang sah hingga bukti enforcement ada.

### Dokumentasi dan keputusan MCP fase implementasi

ADR baru harus mengamandemen ADR-0074/0101/0159/0164/0170 untuk runtime ketiga dan batasnya;
nomor ADR diregistrasi lintas branch saat ditulis. Docs model-catalog, API, operations/agent,
frontend/runtime, serta `docs/agent-integration.md` yang tersentuh diperbarui dan di-link pada
index dalam commit implementasi yang sama. Tidak diperlukan migration dari desain ini; bila
fase Spec menemukan kebutuhan perubahan DB, keputusan skema harus direlay dahulu.

Keputusan MCP: endpoint versi baru memakai tool baca dan capability sesuai ADR-0202; Settings,
Custom Agent dan launch yang menerima enum/runtime baru memperbarui schema tool yang ada.
Kontrak cookie-only/WS tetap mempunyai pengecualian beralasan yang tercatat. Tidak membuat API
baru tanpa tool atau pengecualian di commit yang sama.

### Aturan verifikasi fase berikutnya

Test mencakup biner efektif, argv interaktif/escaping prompt, trust/realpath/preservasi config,
seed runtime-defaults/user edits, katalog parent versus child tier, capability unavailable,
env credential terisolasi, parsing metadata sesudah restart dan regresi argv Claude/Codex.
Materialisasi native diuji dari berkas sesungguhnya; availability tidak didasarkan pada plugin
validate saja. Auditor hanya tersedia bila live enforcement terbukti; jika belum, unavailable.
Satu smoke endpoint nyata di akhir; test server serial dengan DB temp unik, bersihkan
`HANOMAN_CONTROL_ORIGINS`/`SSH_ASKPASS`, typecheck paket tersentuh, tanpa suite penuh rutin.

Keputusan terbuka: -.
