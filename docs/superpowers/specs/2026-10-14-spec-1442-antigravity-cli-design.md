# SPEC-1442 — Runtime Antigravity CLI

## Konteks & keputusan

Fase Brainstorm · 2026-10-14. Base/kandidat riset:
`c6800c59837a152e413d8b7834ced0b21adcb084`.
Status desain: enam keputusan awal diterima; kontrak native child masih membutuhkan keputusan lanjutan. Belum menjadi spesifikasi implementasi.

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

### Keputusan terbuka lanjutan untuk relay

1. Karena `agy` 1.3.4 menerima native tier `flash` tetapi tidak menemukan definisi dengan slug exact, sementara effort per-child dan foreground belum punya kontrak terverifikasi, jalur mana yang dipilih: A pertahankan 2B sebagai syarat keras dan tahan desain native sampai riset/probe menemukan kontrak yang memenuhi semuanya (rekomendasi menjaga requirement), B izinkan bridge child yang dikelola hanoman lewat proses `agy -p --model --effort` dengan kontrol blocking dan read-only tersendiri—mengamandemen tuntutan native `invoke_subagent`, atau C amandemen 2B menjadi child native tier/inherit dengan batas exact model/effort/foreground diumumkan eksplisit?

### Aturan verifikasi fase berikutnya

Test harus mencakup biner efektif, argv/escaping prompt, trust/realpath/preservasi config, seed
runtime-defaults/user edits, katalog model, capability unavailable, env credential terisolasi,
parsing metadata setelah restart, dan regresi argv Claude/Codex. Semua route/kontrak berubah
punya keputusan MCP di commit yang sama. Uji server serial dengan DB temp unik, bersihkan
`HANOMAN_CONTROL_ORIGINS`/`SSH_ASKPASS`; typecheck paket tersentuh dan satu smoke endpoint nyata.
Docs internal yang berubah + ADR baru terindeks dalam commit implementasi yang sama.
