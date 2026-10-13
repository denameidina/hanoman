# SPEC-1442 — Runtime Antigravity CLI

## Konteks & keputusan

Fase Brainstorm · 2026-10-14. Base/kandidat riset:
`c6800c59837a152e413d8b7834ced0b21adcb084`.
Status desain: menunggu keputusan scope di bawah; belum menjadi spesifikasi implementasi.

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

### Keputusan terbuka untuk relay

1. Default Antigravity baru hendak memakai model/effort mana: A `gemini-3.8-flash-high` + `high` (rekomendasi, tersedia pada katalog lokal dan lebih luas antar-plan), B `claude-opus-5-5-high` + `high`, atau C model/effort pilihan lain yang disebutkan eksplisit?
2. Untuk v1, apakah Antigravity memakai mode sesi tunggal dengan seluruh Custom Agent/orkestrasi fase native ditandai unavailable beserta alasannya (A, rekomendasi sampai kontrak native terbukti), atau wajib implementasi native child lengkap dengan exact model/effort, foreground dan read-only enforcement dalam SPEC ini (B)?
3. Untuk status dan keputusan v1, apakah memakai observasi tmux dan marker fase dengan batas notifikasi/gate/native telemetry dijelaskan eksplisit (A, rekomendasi scope awal), atau wajib relay native hook/statusline untuk idle/decision dan gate goal dalam SPEC ini (B)?
4. Konfigurasi MCP hanoman Antigravity hendak ditulis dengan merge-preserve ke global `~/.gemini/config/mcp_config.json` (A, rekomendasi mengikuti config operator), atau dibuat per-worktree `.agents/mcp_config.json` yang excluded dan mempertahankan config repo (B)?
5. Dukungan deployment awal hendak dibatasi host/lab dengan launch Antigravity di sandbox ditolak jelas sampai auth/state terverifikasi (A, rekomendasi scope awal), atau produksi Podman lengkap wajib tersedia di SPEC ini dengan image dan layout credential/state yang teruji (B)?
6. Versi Antigravity hendak memakai endpoint additive `/api/antigravity/version` + tool MCP baca tanpa mengubah `/api/codex/version` (A, rekomendasi kompatibilitas), atau endpoint versi generik baru dengan response semua runtime dan kontrak/tool tersendiri (B)?

### Aturan verifikasi fase berikutnya

Test harus mencakup biner efektif, argv/escaping prompt, trust/realpath/preservasi config, seed
runtime-defaults/user edits, katalog model, capability unavailable, env credential terisolasi,
parsing metadata setelah restart, dan regresi argv Claude/Codex. Semua route/kontrak berubah
punya keputusan MCP di commit yang sama. Uji server serial dengan DB temp unik, bersihkan
`HANOMAN_CONTROL_ORIGINS`/`SSH_ASKPASS`; typecheck paket tersentuh dan satu smoke endpoint nyata.
Docs internal yang berubah + ADR baru terindeks dalam commit implementasi yang sama.
