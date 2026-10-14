# SPEC-1442 — Runtime Antigravity CLI

## Konteks & keputusan

Fase Brainstorm · 2026-10-14. Base/kandidat riset:
`c6800c59837a152e413d8b7834ced0b21adcb084`.
Status Brainstorm: selesai setelah relay keputusan manusia atas blocker native CLI. Desain memakai
adapter native dengan batas kemampuan eksplisit. Objective dan Spec ditambahkan oleh agen fase
masing-masing; Plan dan Execute meneruskan kontrak serta bukti wajib di dokumen ini.

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
| Reviewer fase (relay Spec 1A) | Generated `hanoman-fase-review` boleh native child `inherit` dengan batas read-only **instruksional**, mengikuti ADR-0170; bukan enforcement runtime. Custom Agent auditor read-only tetap unavailable sampai enforcement terbukti. |
| Kesiapan/pemasangan metode (relay Plan Q1 B) | Status/pemasangan metode Antigravity unavailable beralasan sampai installer upstream terverifikasi. Injeksi skill native yang sudah tersedia tetap bekerja; tidak mengarang perintah installer atau mengubah fail-open Start. |

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

## Spec — kontrak implementasi

Fase Spec · 2026-10-14. Base `c6800c59837a152e413d8b7834ced0b21adcb084`,
kandidat masuk `40800f7cce009b3a4e92c2f1059bd62a2d67fb5f`. Bagian ini menurunkan SC1–SC6;
keputusan manusia pada bagian sebelumnya tetap mengikat. [ADR-0221](../../../internal/docs/adr/0221-antigravity-cli-runtime-interaktif-native.md)
adalah keputusan arsitekturnya. Kontrak di bawah adalah target implementasi, bukan klaim kode
atau live smoke telah lulus. Plan/Execute wajib menyertakan bukti AC per ID.

### S1. Arsitektur dan batas ownership

| Lapis | Tanggung jawab | Titik perubahan |
| --- | --- | --- |
| Shared | Union runtime, label, setting/default marker, katalog parent/child, availability, DTO/API/MCP | `enums.ts`, `custom-agent.ts`, `entities.ts`, `runtime-defaults.ts`, `orchestration*.ts`, `model-catalog*.ts`, `agent-catalog.ts`, `config-registry.ts`, `mcp-catalog/*` |
| Runner | Argv interaktif runtime, renderer Markdown native, prompt fase/relay, policy dan cleanup | `types.ts`, `agent-cli.ts`, `custom-agents.ts`, `phase-agents.ts`, `prompt.ts` |
| Server | Effective bin, prepare trust/injeksi, launch admission, tmux metadata/detector, probe version/models, materialisasi roster | `services/pty.ts`, `session-launch.ts`, `skill-inject.ts`, `runtime-defaults.ts`, `custom-agents.ts`, `model-catalog-probe.ts`, service Antigravity khusus |
| Routes | Validasi enum/pasangan model, error launch, endpoint versi baru | Settings, specs/start, Terminal, IDE/ide, lead, Custom Agent |
| Dashboard | Runtime ketiga di seluruh pemakai katalog; batas kemampuan di konteks pengguna | Settings runtime/orkestrasi/MCP, modal Start/New Terminal, Custom Agent, label sesi/phase |
| Distribusi | Config registry, doctor/VPS katalog dan panduan installer/auth resmi | CLI doctor, VPS components/provisioning yang mengenali CLI |

Alur kelahiran: request tervalidasi → defaults efektif → launch admission existing → worktree
existing → persiapan Antigravity → argv native → tmux → metadata/history/presence existing.
Persiapan mencakup trust cwd aktual, instruksi/skill dan roster; shell mentah melewati seluruh
persiapan agen seperti sebelumnya. Semua jalur otomatis/manual wajib melewati pemeriksaan
runtime yang sama; memperbaiki picker saja tidak cukup. Tidak ada dispatcher process child baru,
SDK eksekusi, atau bridge. Tidak ada tabel/kolom/migration baru: runtime tersimpan pada string
dan JSON yang sudah ada. Parser/validator sync/history yang mencerminkan enum ikut diperluas.

### S2. Biner, argv, defaults dan env

- Biner efektif: config DB `HANOMAN_ANTIGRAVITY_BIN` → env → `agy`, metadata registry
  `kind=path`, `apply=new-session`, `category=knob`, mengikuti ADR-0049. Nilainya adalah executable,
  bukan shell command/daftar flag. Probe dan launch menggunakan resolver yang sama.
- Sesi kerja menghasilkan `agy [--model <slug>] [--effort <effort>]
  --dangerously-skip-permissions --prompt-interactive <prompt>`; prompt panjang tetap memakai
  berkas sesi 0600 dan quoting existing, sebagai satu argumen setelah flag interaktif.
  Tidak meneruskan `--settings`, `--agents` Claude, `-c` TOML Codex, `--print`, `exec`, atau
  `--sandbox` sebagai substitusi boundary Podman.
- Tanpa prompt awal, parent tetap TUI interaktif. Prompt berikutnya dikirim lewat PTY yang sama;
  tidak spawn ulang per giliran. Metadata `@hanoman-agent`/history/presence menyimpan
  `antigravity`, dan restore sesudah restart tidak menganggapnya Claude/Codex.
- `Setting.agent` menerima nilai ketiga. `Setting.antigravity={model,effort}` dan marker
  `builtinRuntimeDefaults.antigravity={model:"seeded"|"user",effort:"seeded"|"user"}`
  additive. Default parent `gemini-3.8-flash-high`/`high`; override sesi → default runtime.
  Read/write Setting lama yang belum membawa blok ini tetap sah. Seed mempertahankan runtime
  global operator, seluruh edit Claude/Codex, serta marker `user`; tidak menjalankan ulang
  perubahan rekomendasi Claude/Codex hanya karena versi marker Antigravity bertambah.
- Parent catalog: `agy models`, timeout 20 dtk/output 4 MiB/cache 0600/refresh 5 menit mengikuti
  model-catalog. Parsing mengambil hanya slug/label dan effort yang benar-benar diketahui.
  Slug dengan suffix `low|medium|high` memberi batas effort konservatif itu sampai CLI memberi
  metadata lebih kuat; daftar `--help` tidak menjadi bukti semua effort berlaku untuk semua model.
  Katalog fallback minimal memuat default yang telah terverifikasi; kegagalan probe mempertahankan
  hasil terakhir. Unknown stored slug tetap terlihat, tidak diremap diam-diam.
- Credential OAuth/keyring tetap lokal dan login dilakukan operator lewat installer/auth resmi.
  API-key mode memerlukan konfigurasi provider milik operator; Hanoman tidak mengubah
  `modelProvider` atau menyalin credential. `GEMINI_API_KEY` dan konektivitas
  `GOOGLE_GEMINI_BASE_URL` hanya diteruskan ke proses Antigravity bila disediakan; bila
  diregistrasi sebagai config, `inheritEnv` tetap tidak menjadi izin menyuntik ke semua runtime.
  Env builder launch/probe/lead harus menghapus kedua nilai dari Claude/Codex/raw shell dan
  subprocess Hanoman yang tidak membutuhkan mereka, termasuk environment tmux daemon lama.
  Jangan menghapus `GOOGLE_*` secara wildcard karena project lain dapat memerlukan variabel berbeda.
- `lead/brain.ts` mendapat cabang Antigravity eksplisit dengan `-p`, model/effort/bypass dan
  kontrak JSON advisor existing. Ini satu-satunya pengecualian one-shot untuk runtime ini;
  sesi kerja yang dilahirkan lead tetap interaktif. Portal chat yang restricted Claude-only
  tetap demikian; union runtime tidak boleh membuka fallback argv Claude untuk Antigravity.

### S3. Trust, instruksi, skill dan MCP

Trust ditulis di `~/.gemini/antigravity-cli/settings.json`, field `trustedWorkspaces: string[]`
yang bentuknya telah diperiksa tanpa mencetak nilainya. Gunakan realpath cwd worktree aktual,
append idempoten tanpa bergantung pada inheritance parent yang belum terbukti. JSON root dan
field lain dipertahankan. File malformed, field trust salah tipe, symlink/ownership tak aman,
atau write gagal harus gagal persiapan dengan alasan; jangan reset config operator. Write memakai
read/merge terbaru, serialisasi per path, temp 0600 + rename atomik untuk launch concurrent.
Live smoke harus membuktikan cwd yang ditulis membuka TUI tanpa dialog trust, bukan hanya fixture.
CLI `--dangerously-skip-permissions` sendiri tidak membuktikan trust.

Repo `AGENTS.md`/`GEMINI.md` tidak ditimpa. Skill global Hanoman memakai `.agents/skills`
symlink + Git common-dir exclude bertanda existing; skill project dengan nama sama menang.
Sumber global user `~/.gemini/antigravity-cli/skills` dikenali library bila pemindai tersentuh.
Child dan parent mendapat instruksi/konteks fase melalui konvensi native yang terbukti dibaca.
Injeksi skill tetap fail-open dengan warning sebagaimana ADR-0172; trust tidak fail-open.

**Amandemen relay Plan Q1 B:** kesiapan/pemasangan metode Antigravity ditampilkan unavailable
dengan alasan sampai installer upstream terverifikasi. `METHODS.install`/`MethodAgent` dan
laporan status yang mengiterasi `zAgent.options` harus aman untuk runtime ketiga: tidak crash,
tidak menjalankan command kosong/fabrikasi, tidak mengaku ready. Skill native yang sudah ada
tetap dipindai/disuntik dan Start tetap fail-open. Aksi install runtime ini ditolak sebelum
shell spawn dalam shape validation 400 existing. Claude/Codex mempertahankan installer/status.

MCP global memakai `~/.gemini/config/mcp_config.json`, objek `mcpServers.hanoman`:
`command: "hanoman"`, `args: ["mcp"]`, env `HANOMAN_HOST` dan `HANOMAN_AGENT_TOKEN` dari
konfigurasi/token yang dipilih operator. Settings → Akses AI Agent menyediakan format Antigravity
dan petunjuk merge, menggunakan alur token existing; tidak otomatis menerbitkan token baru atau
menaikkan capability. Writer bila disediakan hanya mengubah entri Hanoman yang dikelolanya,
mempertahankan sibling/unknown fields, menolak JSON rusak dan collision entri operator berbeda
tanpa menggantinya. Simpan 0600; redaksi token di log/response. Konfigurasi workspace MCP operator
tidak diubah. `/mcp`/tools-list native dan `hanoman_about` membuktikan koneksi, tanpa membocorkan token.

### S4. Child native, orkestrasi dan availability

- `CustomAgent.runtime="antigravity"` adalah filter runtime (ADR-0101), bukan spawn executable
  lintas runtime. `null` tetap inherit parent. Untuk Antigravity, `model:null` berarti native
  `inherit`, nilai explicit hanya tier publik `inherit|flash|pro`; slug parent bukan child tier.
  `flash_lite` yang ditemukan lewat binary internal tidak dipasarkan sampai kontrak publik terbukti.
- Form child/sel orkestrasi Antigravity memakai picker tier terpisah berlabel **tier native**.
  Effort child independen tidak dipancarkan; UI menjelaskan inherited/native dan menonaktifkan
  picker effort independen. Definisi baru explicit Antigravity dengan slug/effort independen
  invalid ditolak 400; definisi legacy/inherit dengan konfigurasi tak kompatibel tetap tersimpan
  tetapi unavailable untuk Antigravity dengan alasan, tanpa memengaruhi runtime lain.
- Sel per fase/reviewer Antigravity additive pada JSON orkestrasi existing, default tier `inherit`
  dan tanpa effort independen. Override memakai validasi child, bukan koersi katalog parent.
  Metadata/prompt melabeli tier dan effort unknown/native; jangan mengklaim model exact terkunci.
  Alur relay/marker/review existing tetap berlaku, tapi pemanggilan native memakai `invoke_subagent`
  dan pesan ke ID child yang sama untuk putaran keputusan/rework. Parent menunggu hasil sebelum
  fase berikutnya secara protokol; tidak ada klaim runtime memaksa foreground.
- Renderer native menulis Markdown frontmatter `name`, `description`, `model`,
  `mainAgent:false`, `subagent:true` dan body instruksi. Lokasi workspace `.agents/agents`
  harus dibuktikan discovery pada cwd worktree aktual. Batas native tool-name mapping wajib
  diverifikasi; jangan meneruskan nama Claude `Read|Task|Bash` sebagai nama tool Antigravity.
  Field policy/maxTurns/timeout yang belum punya enforcement tidak dipasarkan sebagai jaminan.
- Registry per-sesi dikelola/excluded Git tanpa menyentuh definisi operator atau registry global.
  File/folder sesi 0700/0600, namespace dan manifest ownership sesi; collision nama yang sudah
  ada tidak boleh ditimpa. Cleanup hanya berkas yang ownership/hash-nya masih milik Hanoman;
  sesi lain dan instruksi repo tidak disentuh. Amandemen ADR-0159 mengizinkan adapter ini menaruh
  registry sesi di worktree karena CLI tidak mempunyai `--agents`/config-dir sesi terverifikasi.
  Prompt tidak mengadopsi persona inline dan discovery global bukan pengganti isolasi per-sesi.
- `workspacePolicy=inherit` tersedia setelah materialisasi/discovery berhasil. `read-only`
  unavailable dengan alasan sampai uji mutasi nyata membuktikan enforcement per-child;
  instruksi atau `tools` allowlist saja tidak cukup. `isolated-worktree` unavailable untuk
  Antigravity: fitur native `branch` belum membuktikan handoff kandidat/hasil ADR-0159.
  Peran auditor tidak boleh diam-diam diremap ke `inherit` agar tersedia.
- Reviewer generated `kind:phase` memakai `inherit` tanpa policy read-only enforced seperti
  kontrak ADR-0170 existing, sesuai relay manusia 1A. Instruksi melarang perubahan worktree;
  UI/docs tidak menyebut pembatasan itu enforcement runtime. Pengecualian ini hanya reviewer
  fase generated, tidak mengubah availability Custom Agent auditor read-only.
- Satu Custom Agent gagal tidak mematikan parent; availability/selectionReason menjelaskan
  kegagalan. Materialisasi phase plan all-or-nothing mengikuti fallback sesi tunggal existing
  hanya dengan warning yang terlihat; metadata `orchestrated` harus jujur. Smoke sukses roster
  dan child adalah AC wajib, bukan alasan mengirim fitur yang seluruh native child-nya unavailable.

### S5. API, MCP dan galat

Endpoint baru `GET /api/antigravity/version` (auth seperti versi Codex, `GLOBAL_READ` untuk
agent token sah) mengembalikan 200 `{version:string|null,error:string|null}`. `version` adalah
semver terdeteksi, `error` alasan aman bila missing/timeout/parse gagal atau runtime sandbox
tidak didukung. Tidak mengembalikan raw stdout/stderr, credential, home path, atau minimum
client rekaan. Cache 5 menit keyed effective binary/execution mode, timeout 10 dtk dan output
bounded; invalidasi config bin segera dan serialisasi refresh mencegah hasil probe lama menang.
Kegagalan observasi tidak menjadi 500 atau alasan sendiri memblokir sesi host.

| Kontrak tersentuh | Keputusan MCP dalam commit implementasi |
| --- | --- |
| GET `/api/antigravity/version` | Tool baru `hanoman_antigravity_version`, mode `read`, capability `null` yang dibuktikan route `GLOBAL_READ`; entri observability + test coverage/catalog + docs/agent-integration |
| Settings/runtimeDefaults/orchestration | Perluas schema tool Settings existing dan response type; capability lama tidak berubah |
| Launch backlog/Terminal/IDE/lead | Perluas enum schema/input tool existing serta validasi final launcher; pertahankan danger/capability launch/approval existing |
| Custom Agent create/update/list | Tool agents existing menerima runtime/tier ketiga; availability response additive dan enforcement server |
| GET `/api/models` dan frame models | Schema katalog/tool models existing additive; otorisasi HTTP/WS existing tidak dilonggarkan |
| Terminal WS/events WS/session-events | Tetap pengecualian beralasan existing: streaming WebSocket atau HMAC per-sesi, bukan REST agent-token; enum runtime diperluas tanpa kanal baru |
| Config/MCP format UI | Tool/config sensitive existing tetap gated; tidak membuat endpoint tulis config lokal Antigravity baru |
| Methods status/install (relay Plan Q1 B) | Status `/api/methods/status` tetap `COOKIE_ONLY` beralasan sebagai kesiapan mesin lokal untuk dashboard; response unavailable/reason additive. Terminal install mengikuti schema/tool/otorisasi existing, input Antigravity unavailable ditolak sebelum shell spawn; tidak menambah installer endpoint/tool |

Launch Antigravity pada boundary sandbox aktif/required ditolak **sebelum spawn** dengan
`409` dan `error:"antigravity-sandbox-unsupported"` beserta alasan aman. Hardening produksi
tidak boleh dimatikan otomatis dan tidak fallback host. Launch yang meminta goal gate native
ditolak `409`, `error:"antigravity-goal-unsupported"`; marker untuk flow goal boleh menjadi
pelaporan progres tetapi bukan enforcement Stop gate. Trust/config preparation gagal memakai
galat launch `500`, `error:"antigravity-config-failed"` dengan pesan teredaksi. Input tier/effort
child invalid → 400 lewat validation shape route existing. Error 401/403/404/principal/capacity
existing tetap mendahului tindakan yang tidak diizinkan; jalur agent-token tidak dapat melewati
unsupported/capability gate. Biner missing/exit langsung tetap terlihat sebagai kegagalan launch
atau pane exited dengan diagnosis, tidak fallback runtime lain.

### S6. Status dan pengalaman operator

Antigravity ditampilkan di picker Settings, Start backlog, New Terminal, IDE/ide dan lead yang
menggunakan Agent. Label sesi/history/presence dan runtime filter Custom Agent mengikuti union
shared. Picker model parent dan effort memakai katalog parent; child selalu tier native.

Saat Antigravity dipilih, jelaskan host/lab, tier/effort child native, asynchronous child dan
telemetry/notifikasi/goal yang belum tersedia. Capability unsupported tampil alasan spesifik,
bukan disabled tanpa sebab. Goal gate ditolak juga oleh API, bukan checkbox yang diam-diam diabaikan.
Settings menampilkan versi/null+alasan dan panduan login/install resmi; Hanoman tidak auto-install
atau auto-update `agy` karena membuka Settings.

Pane/status membaca tmux movement/dead dan marker fase existing. Terminal completion tetap
mensyaratkan semua fase terminal + plan lengkap dan `exited` menang. Idle heuristic hanya boleh
ditambahkan dari capture TUI nyata yang telah diperiksa; jangan menyalin regex prompt Claude/Codex.
Tanpa bukti semantik, status waiting tidak disebut keputusan manusia. Token/durasi/model child
yang tidak diketahui tetap null/unknown; tidak membuat AgentInvocation sintetis atau angka nol
seolah telemetry native telah terhubung. Routing keputusan lewat hook/notifikasi native/lead
tidak dijamin; operator dapat menjawab langsung di Terminal, sementara protokol agen tetap
melaporkan `Keputusan terbuka` sebelum marker. Tidak memasang Stop/PreToolUse guardrail parent.

### S7. Acceptance criteria (EARS)

| ID / SC | Kriteria | Bukti wajib |
| --- | --- | --- |
| AC-01 / SC1 | WHEN runtime Antigravity dipilih melalui backlog, Terminal, IDE/ide atau launch lead, THE SYSTEM SHALL melahirkan parent TUI interaktif dalam tmux + worktree yang benar dengan metadata `antigravity`. | Test setiap jalur + satu smoke tmux/worktree nyata; attach/send follow-up pada pane yang sama |
| AC-02 / SC1 | WHEN prompt awal/model/effort berisi karakter shell atau newline, THE SYSTEM SHALL meneruskannya sebagai argv utuh dengan `--prompt-interactive`, tanpa flag one-shot pada parent/child kerja. | Test argv/quoting + output help biner terpasang |
| AC-03 / SC2 | WHEN config biner berubah, THE SYSTEM SHALL menggunakan DB→env→agy pada launch, model discovery, versi dan lead brain berikutnya serta menginvalidasi cache probe lama. | Test resolver/config refresh concurrency + fake biner executable |
| AC-04 / SC2 | WHEN Setting lama/fresh di-seed atau operator menyunting defaults, THE SYSTEM SHALL menambah default `gemini-3.8-flash-high`/`high` dan marker tanpa menimpa pilihan/runtime/edit Claude/Codex. | Test fresh, legacy, seeded, user, idempotensi dan PUT schema |
| AC-05 / SC2 | WHEN probe models sukses/gagal/offline, THE SYSTEM SHALL mengganti katalog provider dari CLI atau mempertahankan cache terakhir, serta hanya menawarkan effort parent yang diketahui dan tier child terpisah. | Fixture parser/timeouts/cache/future model + UI mounted picker |
| AC-06 / SC3 | WHEN cwd worktree Antigravity disiapkan, THE SYSTEM SHALL menambah realpath cwd ke trust secara atomik/idempoten dan mempertahankan field operator, termasuk dua launch concurrent. | Test JSON corrupt/tipe/collision/realpath/concurrency + live TUI tanpa trust prompt pada cwd yang dipersiapkan |
| AC-07 / SC3 | WHEN skill/instruksi diinjeksi, THE SYSTEM SHALL mempertahankan AGENTS.md/GEMINI.md/project skill yang ada dan membuat skill global terbaca native tanpa tracked dirty changes. | Test precedence/exclude/cleanup + discovery skill native |
| AC-08 / SC3 | WHEN operator mengonfigurasi MCP Hanoman untuk Antigravity, THE SYSTEM SHALL menyediakan format global yang valid dan mempertahankan entri operator serta credential teredaksi. | Fixture merge/corrupt/collision + live `/mcp`/tools-list dan `hanoman_about` |
| AC-09 / SC3 | WHEN proses runtime/subprocess dibentuk, THE SYSTEM SHALL meneruskan env Antigravity hanya ke pemakai yang membutuhkan dan tidak membocorkannya ke Claude/Codex/raw shell/probe unrelated. | Test env parent/lead/probe dan tmux inherited env dengan sentinel credential; laporan hanya boolean/nama key |
| AC-10 / SC4 | WHEN Custom Agent inherit atau Antigravity-compatible dipilih, THE SYSTEM SHALL mendaftarkan child native dari roster sesi tanpa persona inline, global registry collision atau slug parent sebagai tier. | Test renderer/native names/ownership/isolation + live discover/invoke satu child dari TUI parent |
| AC-11 / SC1,4 | WHEN child native selesai lalu menerima pesan lanjutan, THE SYSTEM SHALL memakai ID child yang sama dengan konteks yang bertahan tanpa `agy -p`/bridge baru. | Live native lifecycle dan follow-up; jumlah/id child yang diamati dicatat |
| AC-12 / SC4,5 | IF read-only/isolated-worktree atau explicit model/effort child tidak didukung, THEN THE SYSTEM SHALL menolak input baru atau menyatakan availability false beralasan tanpa fallback policy/model senyap. | Test API create/update/list, legacy/inherit roster dan UI reason; read-only boleh tetap unavailable |
| AC-13 / SC4 | WHEN phase orchestration Antigravity aktif, THE SYSTEM SHALL memakai tier native, relay keputusan/rework ke child sama, marker hanya sesudah hasil/review dan menyatakan batas foreground/effort/native telemetry. | Test phase renderer/plan/prompt/overrides + live satu fase child; reviewer tetap prosedur independen, bukan klaim policy read-only |
| AC-14 / SC2,4 | WHEN GET `/api/antigravity/version` dipanggil oleh principal sah, THE SYSTEM SHALL mengembalikan 200 dengan semver atau null+alasan aman, dan menawarkan tool MCP baca tanpa mengubah versi Codex. | Test parser/missing/timeout/cache/auth/capability/catalog/coverage + curl server nyata sekali di akhir |
| AC-15 / SC5 | IF boundary sandbox aktif/required atau goal gate native diminta, THEN THE SYSTEM SHALL menolak Antigravity secara eksplisit sebelum spawn tanpa host fallback atau hardening downgrade. | Test final launcher pada semua entrypoint, lead brain boundary dan goal request; UI unavailable reason |
| AC-16 / SC5 | WHILE Antigravity berjalan atau telah menyelesaikan fase, THE SYSTEM SHALL menampilkan status tmux/marker yang terukur serta null/unknown untuk telemetry yang tidak tersedia, dengan completion dan exited precedence existing. | Test tmux parser/restart/presence/completion + capture TUI nyata untuk setiap regex idle baru |
| AC-17 / SC6 | WHEN Claude/Codex/portal Claude-only digunakan setelah integrasi, THE SYSTEM SHALL mempertahankan argv/default/trust/native roster/goal/boundary existing di luar penyaringan credential Antigravity baru. | Regression tests existing yang tersentuh; typecheck paket tersentuh |
| AC-18 / SC6 | WHEN implementasi dinyatakan selesai, THE SYSTEM SHALL memiliki keputusan MCP semua kontrak tersentuh, ADR-0221 dan docs/index terbaru dalam commit perubahan terkait, serta AC→bukti tanpa test kosong. | MCP coverage/catalog, docs links/diff-check, test serial DB unik/env bersih, typecheck; daftar semua AC di laporan Execute |

### S8. Ketidakpastian teknis yang harus dibuktikan

Spec membaca ulang docs resmi [subagents](https://antigravity.google/docs/subagents/),
[Settings](https://antigravity.google/docs/settings/), [MCP](https://antigravity.google/docs/mcp/)
dan [skills](https://antigravity.google/docs/skills/) pada 2026-10-14, serta
`agy --version`, `--help`, `agents --help`, `models --help` (exit 0, versi 1.3.4).
Probe temp Git repo dengan `.agents/agents/hanoman-spec1442-probe.md` menjalankan
`agy agents` dengan/tanpa `--add-dir`: keduanya exit 0, stdout/stderr kosong. Ini **tidak**
membuktikan discovery berhasil maupun gagal; daftar non-PTY kosong bukan loader TUI.
Temp probe dibersihkan. Trust lokal dibaca hanya tipenya (`list`, seluruh elemen `string`).

Discovery per-worktree, trust bypass sesudah write, native skill/MCP, dan invoke/follow-up
memerlukan live smoke bounded pada Execute. Bila bukti gagal, cari penyebab/config terdokumentasi;
jangan menggantinya dengan global child registry atau bridge. Bila ternyata kontrak native
per-sesi tidak dapat dipenuhi, laporkan terhalang/Keputusan terbuka melalui orchestrator.
Unavailable policy read-only/isolated-worktree yang telah disetujui manusia bukan blocker;
ketiadaan seluruh child native yang diwajibkan SC1/4 tetap blocker.
