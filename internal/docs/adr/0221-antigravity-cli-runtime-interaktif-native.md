# ADR-0221 — Antigravity CLI: runtime interaktif ketiga dan batas native

Tanggal: 2026-10-14
Status: Accepted — scope dan reviewer diputuskan manusia melalui relay
SPEC: SPEC-1442
Terkait: mengamandemen [0074](0074-codex-sebagai-mesin-sesi.md),
[0101](0101-form-custom-agent-katalog-runtime.md),
[0159](0159-custom-agent-native-terukur-terisolasi.md),
[0164](0164-orkestrasi-subagent-per-fase.md),
[0170](0170-orkestrasi-mutu-subagent-foreground-reviewer-beban.md);
menegakkan 0002/0016/0037/0049/0117/0167/0202.

## Konteks

Operator membutuhkan runtime Antigravity bersama Claude dan Codex. Biner resmi adalah `agy`;
versi lokal 1.3.4 mempunyai TUI interaktif, parent model/effort flags dan permission bypass.
Custom child CLI memakai tier native; exact model/effort per-child dan foreground belum terbukti.
Manusia menyetujui batas native tersebut, menolak bridge dan one-shot sesi kerja, serta mengizinkan
lead brain internal existing tetap one-shot. Riset ada di
[spec](../../../docs/superpowers/specs/2026-10-14-spec-1442-antigravity-cli-design.md).

## Keputusan

1. `Agent` mencakup `antigravity`. Sesi kerja parent TUI memakai tmux + worktree existing dan
   `--prompt-interactive`; child persistent memakai `invoke_subagent` dan relay ke ID yang sama.
   Tidak ada child `agy -p`, bridge TUI, atau SDK pengganti native CLI.
2. Biner efektif `HANOMAN_ANTIGRAVITY_BIN` mengikuti DB→env→`agy`; defaults parent
   `gemini-3.8-flash-high`/`high` disimpan additive di Setting JSON dengan ownership seeded/user.
   Rekomendasi baru tidak mengganti pilihan Claude/Codex yang sudah ada.
3. Parent model catalog dan child tier adalah dua kontrak berbeda. Child memakai publik
   `inherit|flash|pro`, tanpa independent effort/foreground guarantee. Tidak memetakan slug parent
   ke tier diam-diam. Phase plan dan UI menyebut tier/effort native, bukan model exact terkunci.
4. Trust menambah realpath cwd aktual di settings Antigravity sendiri secara append-preserve,
   atomik dan idempoten; instruksi repo dipertahankan. Skill memakai konvensi `.agents/skills`.
   Auth/keyring tetap milik operator. Env Antigravity disaring per runtime pada launch/probe/lead.
5. MCP memakai global `~/.gemini/config/mcp_config.json`, merge-preserve operator. Alur token
   existing dan capability tidak berubah. Endpoint versi baru `/api/antigravity/version` mendapat
   tool baca `hanoman_antigravity_version` pada `GLOBAL_READ`; schema tool existing yang menerima
   runtime/setting/child ikut diperluas sesuai ADR-0202.
6. Registry native per-sesi harus terbukti discover/invoke/follow-up dari cwd worktree. Adapter
   boleh menaruh `.agents/agents` di worktree dengan exclude Git, manifest ownership sesi,
   permission 0700/0600 dan cleanup ber-hash; ini mengamandemen larangan worktree config pada
   ADR-0159 karena CLI tidak memiliki flag registry sesi terverifikasi. Dilarang overwrite definisi
   operator atau memakai global registry untuk roster project/sesi. Gagal materialisasi memiliki
   warning/availabilityReason; phase plan all-or-nothing tidak boleh mengaku orchestrated bila fallback.
7. Custom Agent auditor read-only unavailable sampai enforcement tool mutasi per-child terbukti.
   Isolated-worktree Custom Agent unavailable: native branch belum membuktikan handoff kandidat/
   SHA hasil. Policy tidak diremap ke inherit agar agent tampak tersedia. Reviewer generated
   `kind:phase` existing tidak mempunyai policy read-only enforced; penerapannya pada Antigravity
   boleh memakai child native `inherit` sesuai keputusan manusia 1A pada fase Spec. Larangan
   tulisnya **instruksional**, mengikuti ADR-0170 existing, dan tidak diklaim enforcement runtime.
   Ini tidak mengubah unavailable Custom Agent auditor dengan policy read-only.
8. V1 host/lab saja. Boundary sandbox aktif/required menolak launch Antigravity sebelum spawn;
   tidak menurunkan hardening atau fallback host. Dukungan image/auth/state Podman adalah pekerjaan
   berikutnya yang membutuhkan bukti. Goal gate native juga ditolak eksplisit; flow marker tidak
   dipasarkan sebagai Stop enforcement.
9. Status memakai observasi tmux dan marker fase. Native telemetry, notifikasi keputusan dan
   relay gate goal tidak dijanjikan. Unknown tetap null/unknown; tidak membuat invocation/token
   sintetis. Guardrail safety parent yang telah dicabut tidak dihidupkan lagi.

## Konsekuensi dan bukti

Tidak ada perubahan skema DB dari keputusan ini. Claude/Codex mempertahankan kontraknya;
tests menangkap cabang fallback `else=claude/codex`, seed/argv/trust/roster dan credential leak.
CLI native masih asynchronous; protokol orchestrator menunggu laporan, bukan runtime foreground.
Live trust, discovery/skill/MCP dan satu invoke+follow-up native wajib dibuktikan pada Execute.
`agy agents` non-PTY yang exit 0 dengan stdout kosong bukan bukti discovery. Availability tidak
boleh didasarkan hanya pada `plugin validate` atau simbol internal binary.

Referensi primer: [CLI](https://antigravity.google/docs/cli/overview/),
[subagents](https://antigravity.google/docs/subagents/),
[settings](https://antigravity.google/docs/settings/), [MCP](https://antigravity.google/docs/mcp/).
Nomor 0221 dipilih setelah enumerasi empat refs heads/remotes/HEAD (tertinggi 0220) pada fase Spec.
