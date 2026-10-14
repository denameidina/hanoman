# Runtime Antigravity CLI

Kontrak target SPEC-1442 / [ADR-0221](../adr/0221-antigravity-cli-runtime-interaktif-native.md).
Dokumen ini menetapkan perilaku implementasi; status bukti live dicatat di laporan Execute,
bukan disimpulkan dari keberadaan spec.

- Runtime `antigravity`, default executable `agy`, override `HANOMAN_ANTIGRAVITY_BIN`
  efektif DB→env→default. Parent TUI interaktif `--prompt-interactive`, tmux + worktree existing;
  parent model/effort default `gemini-3.8-flash-high`/`high`. Lead brain internal existing boleh
  `-p`; sesi kerja yang dilahirkan lead dan seluruh child tetap persistent/interaktif native.
- Parent catalog `agy models` berbeda dari child tier publik `inherit|flash|pro`. Custom Agent
  runtime tetap filter; effort independen/foreground bukan jaminan native. Registry per-sesi
  `.agents/agents` excluded Git dengan ownership/cleanup, tanpa overwrite atau global roster leak.
- Trust cwd realpath append-preserve di `~/.gemini/antigravity-cli/settings.json`
  (`trustedWorkspaces` string array). AGENTS.md/GEMINI.md/project skill dipertahankan;
  `.agents/skills` memuat injeksi Hanoman dan skill project bernama sama menang.
- Relay Plan Q1 **B**: status/pemasangan metode Antigravity unavailable beralasan sampai
  installer upstream terverifikasi. Skill native yang sudah tersedia tetap dipindai/disuntik;
  Start tetap fail-open. Tidak mengarang command install, tidak mengaku ready atau membiarkan
  matrix installer lama crash. Unsupported install ditolak sebelum shell spawn.
- MCP global `~/.gemini/config/mcp_config.json`, `mcpServers.hanoman` stdio `hanoman mcp`,
  host/token sesuai pilihan operator. Format Settings/alur token existing; merge-preserve,
  token teredaksi dan file 0600. Tidak menerbitkan capability/credential baru otomatis.
- Env `GEMINI_API_KEY`/`GOOGLE_GEMINI_BASE_URL` hanya ke proses Antigravity yang membutuhkan.
  Auth OAuth/keyring/provider setup dilakukan operator; Hanoman tidak mengganti provider config.
- Auditor Custom Agent read-only dan isolated-worktree unavailable sampai kontraknya terbukti.
  Reviewer generated phase boleh memakai native inherit dengan batas read-only **instruksional**
  seperti ADR-0170 existing, sesuai relay manusia 1A; bukan enforcement runtime. Unsupported
  berarti alasan terlihat di UI dan final launcher/API.
- Host/lab saja: sandbox aktif/required ditolak sebelum spawn, tanpa downgrade ke host.
  Goal gate native unsupported. Tmux/marker memberi status; token/model/durasi child unknown
  tetap null, notifikasi keputusan/native telemetry tidak dijamin. Operator menjawab via Terminal.
- `GET /api/antigravity/version` dan tool baca `hanoman_antigravity_version` additive.
  Tidak ada migration/skema baru. Claude/Codex dan portal restricted Claude-only tidak berubah.

Arsitektur komponen, format data, error dan 18 AC EARS:
[spec lengkap](../../../docs/superpowers/specs/2026-10-14-spec-1442-antigravity-cli-design.md).
Discovery registry, trust, skill, MCP dan native invoke/follow-up adalah bukti wajib Execute;
manifest/fixture saja tidak membuktikan integrasi native tersedia.

[Plan implementasi](../../../docs/superpowers/plans/2026-10-14-spec-1442-antigravity-cli-runtime.md)
memetakan 18 AC ke Task 0–14, dimulai proof discovery/invoke/follow-up native dari TUI
sebelum kode integrasi luas. Keputusan installer/kesiapan metode disepakati lewat relay B;
belum ada klaim implementasi atau smoke selesai.
