# SPEC-1442 — Runtime Antigravity CLI

## Konteks & keputusan

Fase Brainstorm · 2026-10-14. Base/kandidat riset:
`c6800c59837a152e413d8b7834ced0b21adcb084`.
Status desain: terhalang oleh kontrak native child `agy` 1.3.4. Seluruh keputusan scope diterima; tidak ada izin untuk menggantinya dengan bridge atau batas kemampuan yang lebih rendah. Belum menjadi spesifikasi implementasi.

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
| One-shot | Help mengonfirmasi `--print/-p`, `--output-format text\|json\|stream-json`, `--print-timeout`, `--continue`, `--conversation`. [Headless resmi](https://antigravity.google/docs/cli/headless/) menjelaskan error model unknown dan stream. | Lead dapat memakai `-p`; hanoman tidak perlu mengganti sesi interaktif dengan headless. |
| Auth | Docs install: keyring lokal atau browser OAuth; SSH memakai URL/code; API key membutuhkan `modelProvider: gemini` dan `GEMINI_API_KEY`; endpoint opsional `GOOGLE_GEMINI_BASE_URL`. | Kredensial tetap milik mesin; jangan menyalin ke response atau anak runtime lain. |
| Trust | Settings lokal dibaca hanya bentuknya: `trustedWorkspaces` = list of strings. Probe PTY direktori temp, tanpa prompt/inferensi, dengan bypass tetap menampilkan `Do you trust the contents of this project?`. Proses dihentikan per-PID dan di-reap. | Bypass tool tidak menyelesaikan trust. Normalisasi realpath, matching parent/worktree dan append-preserve perlu probe lanjutan di Spec/Execute. Jangan menyatakan parent inheritance sudah terbukti. |
| Model | `agy models` exit 0 mengembalikan `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`, `gpt-oss-120b-medium`. [Model resmi](https://antigravity.google/docs/models/) bergantung plan. | Discovery CLI/cache/fallback mengikuti katalog existing; jangan menawarkan semua effort help untuk setiap model tanpa bukti. |
| Rules/skill | [Rules](https://antigravity.google/docs/rules/): root/directory `AGENTS.md` atau `GEMINI.md`, `.agents/rules`; global `.gemini`. [Skills](https://antigravity.google/docs/skills/): `.agents/skills`, global `~/.gemini/antigravity-cli/skills`. | Instruksi repo dan injeksi symlink `.agents/skills` dapat dipakai; precedence project tetap dijaga. |
| MCP | [MCP](https://antigravity.google/docs/mcp/): global `~/.gemini/config/mcp_config.json`, workspace `.agents/mcp_config.json`, objek `mcpServers`, stdio `command/args/env` atau remote `serverUrl`. `agy mcp add --help` membuktikan env/header dan urutan flag. | Hanoman stdio `hanoman mcp` dapat dikonfigurasi; jangan memakai key config Codex atau Claude. |
| Hook/idle | [Hooks](https://antigravity.google/docs/hooks/): workspace `.agents/hooks.json`, global config/settings; SessionStart, Pre/PostToolUse, Pre/PostInvocation, Stop. [Statusline](https://antigravity.google/docs/cli/statusline/): stdin JSON `agent_state=idle/thinking/working/tool_use/initializing`, task_count, pending-input dan confirmation. | Ada sumber native potensial; belum dibuktikan relay event/gate/foreground hanoman bekerja. Jangan mengklaim parity telemetry. |
| Custom child | [Subagent](https://antigravity.google/docs/subagents/): `.agents/agents`, global `.gemini/config/agents`, invoke_subagent, model tier `inherit/flash/pro`, async, workspace branch. | Docs belum membuktikan exact model+effort, foreground, read-only hook dan lifecycle yang diwajibkan ADR-0159/0170. Native branch bukan bukti isolated-worktree hanoman. |

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

### Alternatif pendekatan

1. **Adapter ketiga dengan batas v1 eksplisit (rekomendasi):** pertahankan pipeline dan schema
   lama, cabang biner/argv/trust/default/model/MCP eksplisit, child atau deployment yang belum
   terverifikasi unavailable dengan alasan. Murah diverifikasi, tetapi fitur native tertentu tertunda.
2. **Parity native lengkap:** tambah materialisasi child, policy read-only, foreground, exact
   model/effort, relay hooks/statusline dan sandbox auth/state. Cakupan lebih besar; perlu bukti
   live dan amandemen ADR sebelum klaim parity.
3. **Command kustom generik:** operator memasok shell command dan config sendiri. Lebih cepat
   tetapi tak memenuhi pemilihan model/trust/MCP dan validasi runtime yang diminta; tidak direkomendasikan.

### Keputusan manusia yang diterima (relay pertama)

| Butir | Putusan |
| --- | --- |
| Default | `gemini-3.8-flash-high` + `high`. |
| Native child | Wajib lengkap dalam SPEC ini: exact model/effort, foreground, read-only enforcement, availability teruji. Sesi tunggal/unavailable bukan pengganti requirement ini. |
| Status/decision | Observasi tmux + marker fase; batas notifikasi, gate goal dan native telemetry eksplisit. Hook policy read-only tetap diperlukan oleh keputusan native child. |
| MCP | Global `~/.gemini/config/mcp_config.json`, merge-preserve. |
| Deployment | Host/lab; launch sandbox ditolak jelas sampai auth/state terverifikasi. Boundary produksi tetap utuh. |
| Versi | Additive `/api/antigravity/version` + tool MCP baca; `/api/codex/version` dipertahankan. |

### Verifikasi lanjutan native child

`agy agents --help` mengonfirmasi discovery/list, tetapi tidak menyediakan flag native model/effort
atau foreground. Docs subagent dan [changelog resmi](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md)
menyebut tier `inherit/flash/pro`; tidak ditemukan kontrak exact slug/effort per-child atau primitive
blocking foreground. Inspect string schema biner menemukan `Model yaml:"model,omitempty"`,
tanpa field `yaml:"effort` (petunjuk, bukan bukti runtime execution).

Probe schema-only, **nol inferensi**, menggunakan `agy -p /model --agent <probe> --output-format json`:

- Agen global sementara `~/.gemini/config/agents/hanoman-spec1442-probe-flash.md`, `model: flash`:
  exit 0, `SUCCESS`, `num_turns: 0`; command model melaporkan `gemini-3.8-flash-high`, effort `high`.
- Agen global kedua, format identik tetapi `model: gemini-3.8-flash-high`:
  exit 1, `unknown agent ... (available: hanoman-spec1442-probe-flash)`.
  Jadi slug exact belum bisa diperlakukan sebagai nilai frontmatter yang didukung.
- Agen `.agents/agents` di direktori temp, termasuk repo git temp yang diberi trust eksplisit,
  tetap menghasilkan `no custom agents are available` pada probe. Discovery worktree belum terbukti.
- Semua proses probe selesai; dua berkas global milik probe dihapus. Hanya entri trust temp milik
  probe dicabut kembali; entri operator dipertahankan. Tidak ada kredensial/account yang dicetak.

Probe read-only slash di primary agent membuktikan discovery, **bukan** actual model execution child,
foreground, atau policy enforcement. Klaim parity membutuhkan live invocation dan bukti lifecycle.
Dengan kontrak yang ditemukan, requirement native child lengkap tidak boleh dianggap sudah feasible.

### Steering manusia: sesi tetap interaktif

Manusia menyatakan: "saya mau sesi nya tetap interaktip no oneshot prompt".
Usulan bridge child `agy -p` **tidak disetujui dan ditarik**. `-p /model` di riset terdahulu
hanya probe read-only slash dengan nol inferensi; bukan rancangan sesi kerja.
Sesi parent sudah direncanakan `agy --prompt-interactive` di tmux/worktree, dan tetap demikian.

Dua jalur yang masih dapat dibandingkan tanpa menganggapnya telah disetujui:

- **Native interaktif:** parent TUI menggunakan `invoke_subagent`, child native discovery.
  Ini paling dekat requirement 2B; exact model/effort dan blocking foreground tetap belum
  mempunyai bukti runtime. Definisi tier `flash` ditemukan, slug exact tidak ditemukan.
  Riset native harus diselesaikan sebelum memilih schema/flag, bukan melengkapi field dari asumsi.
- **Bridge interaktif persisten (alternatif baru, belum terverifikasi):** hanoman mengelola TUI
  `agy -i` per child di tmux dengan model/effort pada argv, pesan susulan ke conversation yang
  sama, dan lifecycle/wait terkontrol. Konteks child tetap hidup lintas giliran; tidak memakai
  `-p` untuk pekerjaan child. Ini mengubah arsitektur dari native `invoke_subagent` menjadi
  proses interaktif terkelola, sehingga membutuhkan persetujuan amandemen requirement 2B.
  Read-only enforcement, termination, readiness, limit concurrency, relaying keputusan dan
  completion evidence perlu desain serta probe; belum ada bukti yang mengizinkan klaim parity.

Cakupan larangan one-shot belum jelas: `lead/brain.ts` existing adalah one-shot internal keputusan,
terpisah dari sesi kerja lead yang interaktif. Melarang keduanya akan memperluas SPEC ke redesign
lead brain; membiarkan pengecualian internal itu juga tidak boleh diputuskan sendiri.

### Keputusan manusia relay berikutnya

- Seluruh sesi kerja **parent dan child** harus interaktif; lead brain internal existing boleh
  tetap one-shot. Read-only slash command untuk probe schema tidak menjadi pekerjaan child.
- Native `invoke_subagent` tetap wajib. **Bridge ditolak**, termasuk bridge TUI persisten.
- Exact model/effort, foreground dan enforcement read-only tetap syarat keras; instruksi prosa
  bukan pengganti kemampuan runtime. Semua keputusan awal pada tabel di atas tetap berlaku.

### Penghalang konkret setelah riset bounded

Hipotesis loader membatasi model ke tier diuji ulang dengan **berkas dan nama agent yang sama**
agar nama file, registry stale dan penambahan berkas baru tidak menjadi confounder. Berkas global
sementara `hanoman-spec1442-loader-control.md` ditulis ulang; tiap pemanggilan `agy -p /model
--agent hanoman-spec1442-loader-control --output-format json` adalah read-only slash, nol inferensi,
`num_turns: 0`. Hasil berurutan pada biner 1.3.4:

| Frontmatter model | Exit | Hasil discovery |
| --- | --- | --- |
| `flash` | 0 | SUCCESS |
| `gemini-3.8-flash-high` | 1 | unknown agent; no custom agents are available |
| `flash` (kontrol balik) | 0 | SUCCESS |
| `inherit` | 0 | SUCCESS |
| `claude-opus-5-5-high` | 1 | unknown agent; no custom agents are available |

Biner juga memuat pesan validasi eksplisit `model must be 'inherit', 'flash_lite', 'flash', or
'pro', got %q` dan schema `ModelTier`. Bersama kontrol balik dan docs resmi, ini membuktikan
**frontmatter native tidak mendukung pemilihan slug exact per-child** pada CLI yang diuji.
`inherit` bukan pengganti konfigurasi exact model/effort independen setiap child.

Hipotesis bahwa validator plugin memberi schema lebih luas diuji melalui `agy plugin validate
<direktori-temp>`: tier **dan slug invalid sama-sama exit 0**, `agents: 1 processed`. Maka hasil
validator plugin tidak boleh dipakai sebagai bukti dukungan model native—loader aktual yang menentukan.
Tidak ada plugin di-install dan berkas probe global telah dihapus; semua proses selesai.

Foreground: dokumentasi native menyatakan async dan tool `invoke_subagent` mendokumentasikan
Prompt/Role/TypeName/Workspace, tanpa wait/blocking. Biner memiliki field internal `task_mode` /
`allow_task_mode`, tetapi ini **bukan API publik terverifikasi**; jangan memancarkannya atau mengklaim
foreground dari nama simbol. Tidak ada live lifecycle proof foreground.

Read-only: kontrak hooks mendukung `PreToolUse` output `decision: deny`, conversationId, modelName
serta frontmatter `hooks` pada schema biner. Ini memberi jalur potensial penegakan; scope per-child,
warisan hooks dan enforcement pada invocation nyata belum dibuktikan. Allowlist tool/instruksi
prosa saja tidak memenuhi syarat keras ADR-0159.

Kesimpulan fase: **terhalang**, bukan selesai. Exact per-child yang diwajibkan ditolak loader;
foreground/read-only belum mempunyai bukti execution. Tidak ada alternatif native berbeda yang
sudah terverifikasi memenuhi requirement. Melanjutkan implementasi sebagai parity penuh akan
mengambil asumsi yang dilarang. Keputusan terbuka: `-`; keputusan scope sudah jelas dan tetap
mengikat, penghalangnya kemampuan runtime pada versi yang diuji.

### Audit independen retry Brainstorm (percobaan 2/2)

Audit pada kandidat `c8837707ee14dfdd8067372dd5f82462d0f8ad13` tidak mengulang
probe loader. Hipotesis baru: override exact model/effort mungkin tersedia lewat definisi
transient, setting sesi, atau kontrak SDK yang berlaku juga pada CLI. Biner tetap `agy` 1.3.4
(`agy --version`, exit 0); `agy agents --help` hanya menyediakan discovery. `agy --help`
menempatkan `--model` dan `--effort` pada **sesi CLI saat ini**, bukan setiap native child.

- [Kontrak tools resmi](https://antigravity.google/docs/hooks) mendokumentasikan
  `define_subagent` tanpa parameter model/effort dan `invoke_subagent` tanpa override keduanya.
  Maka definisi transient tidak memberi jalur publik terverifikasi untuk requirement ini.
- [Settings CLI](https://antigravity.google/docs/settings) menjelaskan override per-sesi;
  pencarian `subagent` pada halaman tersebut tidak menghasilkan kontrak per-child.
- [Changelog resmi](https://www.antigravity.google/docs/changelog?tab=cli) membedakan model
  frontmatter CLI **tier** dari model target child independen pada **SDK**. Contoh
  [subagent SDK](https://antigravity.google/docs/sdk/subagents/) memakai Python `Agent.chat`,
  bukan TUI `agy`. SDK bukan bukti kontrak CLI; mengganti runtime ke SDK akan mengubah scope.
- Pemeriksaan `strings` biner menemukan accessor internal `SubagentSpec.GetModel`,
  `GetModelTier`, `GetRunAsTask` serta `InvokeSubagent.GetTaskMode`. Ini mempersempit kesimpulan:
  **loader frontmatter** exact ditolak pada probe sebelumnya, tetapi audit tidak membuktikan
  semua primitive internal mustahil. Primitive internal tersebut tetap tidak mempunyai
  kontrak publik dan bukti invocation native yang memenuhi exact model/effort/foreground.
  Tidak ada alasan menganggap field internal ini aman dipancarkan dari konfigurasi hanoman.

Hasil: **terhalang kembali**. Belum ditemukan jalur native CLI resmi terverifikasi yang
memenuhi seluruh syarat keras. Requirement tetap utuh, termasuk interaktivitas parent/child,
penolakan bridge, dan pengecualian lead brain internal. Read-only child tetap memerlukan
bukti enforcement nyata. Audit ini tidak membuat konfigurasi/proses/model-call baru dan tidak
menyentuh credential. Perubahan hanya catatan Brainstorm dan link index. Orchestrator perlu
merelay blocker setelah retry kedua sesuai kontrak sesi; tidak ada izin menurunkan requirement.

### Aturan verifikasi fase berikutnya

Test harus mencakup biner efektif, argv/escaping prompt, trust/realpath/preservasi config, seed
runtime-defaults/user edits, katalog model, capability unavailable, env credential terisolasi,
parsing metadata setelah restart, dan regresi argv Claude/Codex. Semua route/kontrak berubah
punya keputusan MCP di commit yang sama. Uji server serial dengan DB temp unik, bersihkan
`HANOMAN_CONTROL_ORIGINS`/`SSH_ASKPASS`; typecheck paket tersentuh dan satu smoke endpoint nyata.
Docs internal yang berubah + ADR baru terindeks dalam commit implementasi yang sama.
