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
receipt feasibility Task 0 di bawah membuktikan native TUI pada fixture, belum helper produk.


## Receipt live Task 0 — 2026-10-14

Gate feasibility **lulus** pada biner terpasang `agy --version` → `1.3.4` dan
`agy --help` → exit 0. Sumber primer dibaca ulang:
[subagents](https://antigravity.google/docs/subagents/),
[rules](https://antigravity.google/docs/rules/),
[skills](https://antigravity.google/docs/skills/) dan
[overview CLI](https://antigravity.google/docs/cli/overview/).
Native workspace agent memakai `.agents/agents/hanoman-spec1442-probe.md` dengan
`name`, `description`, `model: inherit`, `mainAgent: false`, `subagent: true`;
tidak ada field tools/effort independen atau registry global tambahan.

Fixture: repo Git temp plus `git worktree add --detach … HEAD`; cwd aktual
`/private/var/folders/5r/0thjglr117g8ln97vs1wf3lw0000gn/T/spec1442-native-60n43nvl/worktree`.
Skill `.agents/skills/spec1442-probe/SKILL.md`, AGENTS.md dan GEMINI.md memuat
nonce non-rahasia terpisah. Trust menambahkan **realpath cwd ini** ke
`trustedWorkspaces` lewat read/merge + temp 0600 + rename. Assert sebelum launch
membuktikan array lama utuh plus satu cwd dan seluruh field lain tetap setara.
Tidak ada config credential/token yang dicetak atau disalin ke repo.

Launch aktual pada socket tmux owned `spec1442-731a0d4295`, session `probe`:

```text
tmux -L spec1442-731a0d4295 new-session -d -s probe -x 160 -y 48 -c <realpath fixture> <owned launcher>
agy --model gemini-3.8-flash-high --effort high --dangerously-skip-permissions --prompt-interactive <initial prompt>
```

`tmux … list-panes -F '#{pane_id} #{pane_pid} #{pane_current_command} #{pane_current_path}'`
sebelum dan sesudah follow-up → pane `%0`, PID `46426`, command `agy`, cwd di atas.
Tidak ada trust dialog pada initial capture. `ps -p 46426 -o command=` diperiksa
sebagai boolean: argv interaktif benar, tidak memuat `-p`/`--print`.
Setiap turn dibatasi 180 detik; poll/capture menggunakan jeda 1–15 detik,
bukan wait tanpa batas. Timestamp UTC aktual:

| Turn | Mulai → hasil selesai dibaca | Durasi maksimum teramati | Hasil |
| --- | --- | --- | --- |
| Initial TUI | 00:52:54 → 00:53:28.742 | 35 detik | AGENTS/GEMINI rules dan skill workspace ditemukan |
| Native invoke | 00:53:39.157 → 00:54:03.626 | 25 detik | Satu child custom workspace selesai dan idle |
| Native follow-up | 00:54:18.151 → 00:54:45.772 | 28 detik | ID sama mengingat nonce tanpa nonce pada pesan baru |

Ringkasan output **actual capture** (identitas akun/home teredaksi, bukan fixture
transcript):

```text
AGENTS Rule Nonce: AGENTS_1442_CEDAR_29
GEMINI Rule Nonce: GEMINI_1442_ORCHID_51
Read(<fixture>/.agents/skills/spec1442-probe/SKILL.md): Read 6 lines
Skill spec1442-probe Nonce: SKILL_1442_PEBBLE_73
PARENT_INITIAL_DONE
Spawned 1 subagent
Agent(hanoman-spec1442-probe: SPEC1442 Probe Agent)(Remember CHILD_1442_TANGERINE_86 and respond CHILD_INITIAL with it.)
Child Conversation ID: 1debdc0b-6780-42e6-bcd5-f1f6b9abf453
CHILD_INITIAL CHILD_1442_TANGERINE_86
CHILD_READY_DONE
Messaged 1 subagent
SendMessage(1debdc0b-6780-42e6-bcd5-f1f6b9abf453: Recall the nonce from your own previous turn without tools or files and reply CHILD_RECALL plus it.)
Child Reply: CHILD_RECALL CHILD_1442_TANGERINE_86
CHILD_RECALL_DONE
/agents: (1 done)
```

Discovery dibuktikan invocation **custom workspace** yang berhasil, bukan jawaban
"Available" saja. Tidak ada `define_subagent`, global roster, `self`, bridge, SDK,
atau one-shot child. Parent menerima dua follow-up dalam pane/PID yang sama.
Native tools teramati sebagai `invoke_subagent` (TUI `Agent`) dan `send_message`
(TUI `SendMessage`). Parent melaporkan schema invoke
`Subagents[{TypeName, Role, Workspace, Model, Prompt}]`, output
`conversationId/logAbsoluteUri/workspaceUris`, follow-up `Recipient/Message`
(+ metadata `toolAction/toolSummary`); ini laporan schema parent, bukan capture
payload JSON mentah. Rendering prompt berikutnya memakai tool names dan ID
terbukti; jangan menganggap casing field internal sebagai kontrak publik baru.

Cleanup dibaca selesai **00:55:26.407 UTC**. Read/merge terbaru menghapus hanya
satu trust cwd owned; assert array sibling dan seluruh field selain trust tetap
setara sebelum/sesudah cleanup. `tmux … kill-session -t probe` + `kill-server`
pada socket owned; PID 46426 dan semua descendant owned sudah tidak ada lewat
`os.kill(pid, 0)`, `tmux … has-session -t probe` exit nonzero. Semua command
subprocess ditunggu/reaped. `git worktree remove --force <fixture>` berhasil;
temp repo/launcher/capture milik probe dihapus. Tidak ada proses background
probe yang tersisa atau registry/config MCP global yang berubah.

Tidak ada timeout atau diagnosis fallback yang dibutuhkan. Receipt ini membuka
Task 1; tetap wajib mengulang live smoke lewat helper produk pada Task 4/5/7/8.
MCP global, sandbox, read-only enforcement, telemetry dan exact child
model/effort tidak diuji oleh probe ini.


## Receipt kontrak Task 1 — 2026-10-14

Kontrak shared/runner menerima runtime ketiga; JSON Setting lama memperoleh default parent
`gemini-3.8-flash-high`/`high` dan marker seeded additive tanpa mengubah versi rekomendasi
Claude/Codex. Sel orkestrasi native default `inherit`/effort `null`, termasuk reviewer; model
parent tidak dipakai sebagai fallback child. Write explicit child hanya menerima tier publik
`inherit|flash|pro` dan effort null/absen; stored slug asing tetap terbaca untuk diagnosis.
History resume dan presence mempertahankan enum Antigravity; persiapan/argv produk belum
merupakan bukti live Task 3–8.

Status metode `available:false`, `ready:false`, `availabilityReason` dan `install:[]` memberi
alasan installer upstream belum terverifikasi. Aksi shell install ditolak 400 `{error:string}`
sebelum pane dibuat, termasuk guard helper internal. Scanner native/injeksi serta daftar
missing berdasarkan observasi disk belum diimplementasikan dalam Task 1; diselesaikan pada
Task 4/13. Status sementara tidak mengklaim readiness dari scan kosong.

Keputusan MCP Task 1: status memakai tool baca existing `hanoman_methods_status` (`GLOBAL_READ`);
Settings/Custom Agent/launch tetap tool/capability existing, perluasan input enum dijadwalkan
Task 6/9–10. Tidak menambah endpoint/tool installer. Test kontrak membuktikan parent/child
terpisah, legacy JSON, nilai stored asing, penolakan installer sebelum spawn, history/presence.
Fixture Terminal `decisionAt` sebelumnya memakai onset tetap Agustus 2025 yang ditolak
`markerCurrent` baseline `acfaff6c` (activity sekarang lebih baru >10 detik); fixture kini
mengontrol onset saat lahir dan tetap menguji marker usang menghasilkan false/kolom absen.

Bukti verifikasi scoped Task 1: 11 berkas / 284 test lulus (`vitest run` path eksplisit,
`--no-file-parallelism`, DB temp unik dan env operator dibersihkan); typecheck shared/runner
exit 0, diff-check bersih. Bukti ini belum menutup seluruh AC SPEC-1442.
