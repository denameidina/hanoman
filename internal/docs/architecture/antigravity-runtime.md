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

`ensureAntigravityTrust(cwd, home=homedir())` dipanggil oleh pusat launch sebelum efek
persiapan sesi baru, hanya untuk agen Antigravity; shell mentah dilewati. Settings dibaca
ulang, cwd di-realpath, `trustedWorkspaces` string array ditambah idempoten, sibling fields
dipertahankan dan temp exclusive 0600 di-rename. JSON/shape rusak, symlink, owner asing,
collision/temp/write/rename failure atau perubahan config selama persiapan melempar
`antigravity-trust-preparation-failed` tanpa memuat path/config/credential pada error.
Skill fail-open berbeda: peringatan diberi nama runtime, sesi tetap lahir. Global native
`~/.gemini/antigravity-cli/skills` dipindai tanpa mengartikan manifest/TOML plugin Codex.
Global `~/.agents` tetap Codex-only; workspace `.agents/skills` dibaca keduanya.
Manifest injeksi di temp sesi menyimpan link target + inode/device dan hash marker exclude;
kill mencabut hanya link/exclude owned yang masih cocok, mempertahankan replacement operator.
Karena `info/exclude` berada di Git common dir, setiap worktree mendapat pasangan marker/path
owned sendiri walau path skill identik telah ditambahkan sesi lain. Cleanup satu sesi tidak
mencabut exclude sesi lain; baris operator existing tidak diambil alih.

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

## Receipt helper produk Task 4 — 2026-10-14

Smoke native melalui **`createSession` produk**, bukan trust/symlink buatan harness,
selesai `2026-10-14T01:34:29.654Z` pada `agy` 1.3.4. Repo Git fixture dengan detached
worktree menjadi cwd aktual; `$HANOMAN_HOME/skills/task4-native-probe` adalah skill global
owned. Operator auth tetap di mesin, tanpa copy config/token ke repo. Trust realpath
ditulis helper launch dan sibling settings dibandingkan setara di memori.

| Bukti aktual | Hasil |
| --- | --- |
| Pane/PID sebelum dan sesudah pesan kedua | `%0 25357 agy`, sama |
| Argv proses aktual | `--prompt-interactive`, tanpa `-p`/`--print` |
| Turn awal, batas 180 detik | selesai 23 detik, tanpa dialog trust |
| Native tool, tampilan verbose | `Read(…/.agents/skills/task4-native-probe/SKILL.md)` |
| Jawaban rule/skill | `AGENTS_1442_MAPLE_42`, `GEMINI_1442_IRIS_58`, `SKILL_1442_FLINT_93` |
| Follow-up tanpa tools/files atau nonce pada prompt | `TASK4_RECALL_DONE SKILL_1442_FLINT_93`, selesai 5 detik |
| Repo instructions | bytes AGENTS.md/GEMINI.md tetap sama |
| Cleanup | symlink owned hilang, cwd trust owned dicabut dengan merge-preserve; sibling tetap, PID hilang, socket/fixture dihapus |

Capture pertama pada harness selesai dengan semua nonce tetapi tool path masih collapsed
(`Explored 1 file (SKILL.md)`). Harness mengulang dengan tampilan verbose sebelum assert
path; tidak mengubah helper produk atau menganggap collapsed capture sebagai bukti path.
Receipt tersanitasi dan hasil command tersimpan selama Execute di workspace ignored plan
`Task4-native-receipt.log`; tidak mencetak config, auth/token, atau identitas akun operator.
Native roster/MCP/phase/status masih dibuktikan task berikutnya.

Review Task 4 menemukan exclude common-dir yang awalnya hanya dibuat sesi pertama:
cleanup sesi pertama membuat symlink worktree kedua terlihat sebagai untracked. Regression
dua detached worktree membuktikan RED (`?? .agents/`) lalu GREEN sesudah setiap worktree
mendapat pasangan exclude owned sendiri; setelah cleanup pertama, worktree kedua tetap bersih,
dan cleanup kedua mengembalikan bytes exclude operator persis. Verifikasi rework terbatas pada
`skill-inject.test.ts` dan `skill-inject.pty.test.ts`: **17/17 test lulus**. Receipt native
sebelumnya tetap berlaku; rework hanya mengubah ownership exclude, bukan argv/trust/native roots.


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

## Receipt default/ownership Task 2 — 2026-10-14

`DEFAULT_SETTING` serta default sesi/Terminal/konflik/lead memilih blok parent Antigravity
secara eksplisit. Override lead engine mempertahankan runtime ketiga; argv/biner/isolasi env
lead tetap pekerjaan Task 3. Pembacaan tidak meremap slug parent asing atau tier child ke model
Claude/Codex. Fase native default `inherit`/effort null terpisah dari parent high/high.

Seed `applyRuntimeDefaults` dan marker `markRuntimeDefaultsUserEdited` menambah kepemilikan
Antigravity granular, menginferensikan nilai parent/fase yang lebih dahulu tersimpan tanpa
marker, mempertahankan user edits dan idempoten. Versi rekomendasi tetap `2026-09-23-v2`;
seed current-marker tidak memperbarui nilai/saklar/marker Claude/Codex hanya karena ekstensi
runtime ketiga. Migrasi historis v1 dan baris tanpa marker tetap sama dengan baseline yang
ditetapkan test existing; SPEC-1442 tidak menghapus migrasi lama tersebut.

PUT dari client lama yang tidak mengirim `antigravity` atau matriks native per-flow
mempertahankan blok dan provenance DB. Sel native baru/diubah divalidasi terpisah sebagai
`inherit|flash|pro|null`, effort null; parent slug/effort independen ditolak 400 sebelum write.
Sel legacy incompatible yang tidak berubah tetap tersimpan untuk diagnosis runtime berikutnya.
Keputusan MCP: `hanoman_settings_get/set` existing (capability `settings:read|write`), body
objek penuh existing tetap menerima blok runtime additive; deskripsi tool dan panduan
[agent integration](../../../docs/agent-integration.md) menjelaskan parent/tier/effort dan
preservasi client lama. Tidak ada endpoint/capability/skema DB baru pada Task 2.

Bukti RED dibaca: 11 failed/45 passed (6 files) untuk default/ownership/preservasi; 3 failed/9
passed (2 files) untuk validasi sel native dan override lead; 1 failed/10 passed untuk ownership
fase yang marker-nya belum ada. Final GREEN: **99/99 test, 9/9 files**, command:

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run server/src/services/runtime-defaults.test.ts server/test/settings.test.ts \
  server/test/terminal-agent-defaults.test.ts server/test/settings-remote-keys.test.ts \
  server/test/conflict-session-defaults.test.ts server/test/orchestration.service.test.ts \
  server/test/antigravity-lead-defaults.test.ts server/test/lead-engine-argv.test.ts \
  shared/src/mcp-catalog.test.ts --no-file-parallelism
```

`pnpm --filter ./shared typecheck` exit 0. `pnpm --filter ./server typecheck` exit 2 dengan
lima error pada seam belum dikerjakan: custom-agents runtime args, pty native/runtime maps,
Telegram runtime label. Tidak ada error pada berkas implementasi Task 2; typecheck server
tetap wajib hijau sesudah task adapter berikutnya, bukan diterima sebagai hasil akhir Execute.
Vitest mencetak warning inisialisasi WAL `database is locked` pada satu test; test-nya tetap
lulus dengan DB temp unik. Final server+curl sekali di akhir Execute tetap wajib untuk Settings
sebagaimana seluruh endpoint tersentuh. Receipt Task 2 mencakup AC-04 dan sebagian AC-17/18;
belum menutup seluruh acceptance criteria SPEC-1442.


## Receipt biner, argv dan env Task 3 — 2026-10-14

`antigravityBin()` memakai resolver sinkron existing `effectiveStr`, tanpa cache biner sendiri.
Registry `HANOMAN_ANTIGRAVITY_BIN` adalah `kind:path`, `apply:new-session`, `category:knob`,
default `agy`, tanpa `inheritEnv`. Test DB→env→default, refresh `loadConfig`, dan dua launch
berturut-turut setelah `setConfig` membuktikan executable baru dipakai pada launch berikutnya,
termasuk executable path dengan spasi. Probe katalog/versi dan lead akan memakai helper ini
pada Task 8–10; receipt ini belum membuktikan integrasi caller tersebut.

`agentFlags` punya cabang native tanpa `--settings`, `--agents`, hook Codex, `--print`, `exec`
atau `-p`. `createSession` menempatkan flags model/effort/bypass lalu tepat satu
`--prompt-interactive` sebelum argumen prompt; tanpa prompt tidak ada flag prompt.
Fake executable aktual di tmux merekam argv dan membuktikan prompt multiline/backtick/`$()`/
kutip serta model/effort berkarakter shell utuh; sentinel command injection tidak terbentuk.
Berkas prompt 0600 dan command substitution quoted existing dipertahankan. Argv Claude/Codex
regression existing tetap lulus.

`agentEnvironment(agent|null, env)` mengklon input dan hanya menghapus dua key Antigravity
untuk runtime lain/raw/unrelated. Tmux sync/async/attach mendapat env unrelated; per-pane
`env -u GEMINI_API_KEY -u GOOGLE_GEMINI_BASE_URL` membersihkan nilai daemon lama. Hanya pane
Antigravity menambahkan supplied env terbaru (override pemanggil → env server). Test daemon
berisi sentinel lama membuktikan Claude/Codex/raw tidak menerima dua key, Antigravity menerima
nilai terbaru atau tidak menerima key bila absen, `GOOGLE_CLOUD_PROJECT` tetap ada, dan env
daemon/sesi tetangga unchanged. Receipt/log env hanya boolean dan nama key, bukan nilainya.
Helper siap untuk parent/lead/probe; caller lead/probe actual diverifikasi pada Task 8–10.

RED awal menangkap helper/resolver belum ada, registry belum ada dan flags jatuh ke Claude.
RED retry scoped (5 files) memberi **5 failed / 105 passed**: registry, dua test argv timeout
karena executable yang salah, boolean credential leak, dan satu fixture raw-SSH tercemar env
harness. Initial tmux error `server exited unexpectedly` tidak berulang dengan socket pendek
unik. Final GREEN **111/111 tests, 5/5 files** dibaca dari run path eksplisit:

```bash
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS -u SSH_ASKPASS_REQUIRE -u GIT_TERMINAL_PROMPT \
  CLAUDE_CODE_OAUTH_TOKEN=task3-unused-fixture ANTHROPIC_API_KEY=task3-unused-fixture \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" HANOMAN_TMUX_SOCKET="t3f$$" \
  pnpm vitest --run runner/test/agent-cli.test.ts runner/test/agent-env.test.ts \
  server/test/config-resolver.test.ts server/test/config-registry.test.ts server/test/pty.test.ts \
  --no-file-parallelism
```

Pembersihan `SSH_ASKPASS_REQUIRE`/`GIT_TERMINAL_PROMPT` diperlukan karena env sesi operator
membuat assertion raw shell existing membaca `force`/`0`; tidak mengubah produk. Kredensial
fixture non-secret mencegah fake-Claude existing mencetak token warisan bila assertion gagal;
log awal dipertahankan teredaksi. Typecheck shared dan runner exit 0; server masih exit 2
pada lima seam task berikutnya: custom-agent adapter (Task 6), phase/skill union (Task 4–7),
runtime label pty/Telegram (Task 8). Tidak ada suppression atau perubahan skema/API pada Task 3;
metadata config memakai kontrak/tool config existing, bukan endpoint baru.

## Registry sesi dan receipt helper produk Task 5 — 2026-10-14

`renderAntigravityAgent` menulis frontmatter native yang telah diuji dan body child dari
`agentPromptOf`/`phasePromptOf`. Model `null` menjadi tier `inherit`; `flash|pro` tetap tier,
bukan slug parent. Effort independen, tool allowlist dan policy read-only/isolated ditolak
beralasan, tidak dihilangkan untuk mengaku available. maxTurns/timeout hanya instruksional.
Metadata roster Antigravity mencatat tier `inherit` dan tidak menyalin effort parent ke child.

`materializeAntigravityAgents({cwd,sessionId,defs})` menyimpan Markdown flat di
`.agents/agents/hanoman-<hash-cwd-sesi>-<nama>.md`; nama frontmatter tetap nama roster/prompt.
Manifest private persisten `.hanoman-<hash-cwd-sesi>-manifest.json` mencatat hash isi dan
inode/device. Folder baru 0700, berkas dan manifest 0600, create exclusive; symlink/owner
asing ditolak. Definisi operator dengan nama sama (termasuk scalar berkomentar) tidak ditimpa.
Dua sesi di cwd yang sama dengan nama sama mendapat collision beralasan; worktree berbeda
memiliki registry sendiri. Tidak ada fallback registry global atau persona parent inline.

Setiap file/manifest mendapat pasangan marker/path exclude sendiri di Git common dir.
Cleanup sesi A mempertahankan pasangan sesi/worktree B. `cleanupAntigravityAgents` membaca
manifest persisten sehingga kill sesudah restart API tidak bergantung closure in-memory;
hanya isi/hash dan inode/device owned yang masih cocok dihapus. Edit/replacement operator
serta exclude-nya dipertahankan. Kegagalan write parsial dibersihkan dengan inode owned;
gagal satu custom agent tidak membuang custom agent lain, dan mentions hanya berisi nama
live. Gagal satu agen fase membatalkan seluruh roster fase sebelum fallback sesi tunggal
berperingatan; metadata orchestrated tidak diklaim sukses.

Smoke melalui **`createSession` dan materializer produk** selesai
`2026-10-14T01:50:57.486Z`, `agy` 1.3.4, repo/worktree Git temp owned. Native CLI menemukan
nama frontmatter `task5-native-probe` walau filename memakai namespace hash sesi. Capture
verbose membuktikan `Spawned 1 subagent` dan `Agent(task5-native-probe …)`; bukan sekadar
jawaban daftar registry.

| Bukti aktual | Hasil |
| --- | --- |
| Child native | `a40667a7-6b1a-49a2-972b-23ff8a94df90` |
| Turn awal, batas 180 detik | selesai 43 detik, `TASK5_CHILD_INITIAL CHILD_1442_KUMQUAT_37` |
| Follow-up native | `SendMessage` ke ID yang sama, tanpa nonce dalam pesan baru |
| Recall child, batas 180 detik | selesai 25 detik, `TASK5_PARENT_RECALL_OK` dengan ID sama dan nonce `CHILD_1442_KUMQUAT_37` |
| Parent interaktif | pane `%0`, PID `13667`, command `agy`, sama sebelum/sesudah; tanpa `-p`/`--print` |
| Trust/registry/Git | realpath trusted, tanpa dialog trust; registry excluded, `git status --porcelain` kosong |
| Cleanup | Markdown/manifest/exclude owned hilang, sibling trust dipertahankan; PID/socket/fixture hilang |

Receipt tersanitasi tersimpan selama Execute di workspace ignored plan
`Task5-native-receipt.log`. Tiga test paths Task 5 mencakup renderer, rollback/collision,
restart cleanup, dua worktree, prompt native, tier/effort metadata dan regressi Claude/Codex.
Tidak ada endpoint atau skema baru pada Task 5; availability/API dan orkestrasi fase mengikuti
task berikutnya, tanpa mengklaim enforcement readonly atau model exact dari receipt ini.

Review Task 5 mereproduksi celah pada rewrite body roster: callback write agen kedua dapat
mengedit atau mengganti file agen pertama dengan symlink sebelum rewrite akhir. Ketiga test
regresi memerah (operator edit, symlink ke sentinel luar registry, false-live phase roster).
Rewrite kini membuka file dengan `O_NOFOLLOW`, memeriksa inode/device/owner/permissions dan
hash melalui descriptor, lalu menulis secara positional pada descriptor yang telah diverifikasi.
Identity pathname diperiksa lagi sesudah write. Perubahan ownership mempertahankan file/operator
sentinel dan menghasilkan `native registry ownership changed during roster preparation`;
agent itu dikeluarkan dari roster live dan mentions survivor dihitung ulang. Bila agen fase
terkena, seluruh roster fase dibatalkan sambil mempertahankan perubahan operator.
Verification rework scoped: **19 test registry + 44 test prompt = 63/63 lulus**, typecheck runner
exit 0; `Task5-rework-red-ownership.log` dan `Task5-rework-green-ownership.log` di workspace
ignored plan. Argv/loader tidak berubah; receipt native di atas tidak dijalankan ulang.
