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


## Receipt Task 6 — Custom Agent boundary dan availability

`antigravityCustomAgentProblem` menjadi seam murni bersama respons CRUD dan selection roster.
Native compatible: `model:null|inherit|flash|pro`, `effort:null`, `tools:null`, policy `inherit`.
Profil lain tetap disimpan/readable tetapi unavailable beralasan untuk parent Antigravity saja;
policy atau explicit slug tidak diremap. Builtin model recommendation Claude/Codex tidak dipakai
untuk parent ini. PATCH runtime/model/effort memvalidasi profil merged existing; perubahan konten
atau enabled profil warisan tetap boleh. Custom API tidak meneruskan `kind`, dan nama fase reserved;
pengecualian reviewer fase generated tidak bisa dimiliki Custom Agent auditor.

`executionLimits:"instructional"` additive pada view berkonteks Antigravity memperjelas limit
turn/timeout. `hanoman_agent_create`/`hanoman_agent_update` schema enum additive dan
`hanoman_agents_list(runtime?)` menyampaikan availability parent; mode/capability existing
`agents:write` / `agents:read` dipertahankan (keputusan ADR-0202, lihat
[API contract](api-contract.md) dan
[agent integration](../../../docs/agent-integration.md)).

TDD original RED 3 berkas: **14 failed / 76 passed**. GREEN scoped 9 berkas: **199/199 passed**
(route CRUD/merged PATCH/policy/kind/limit label, service cached roster, selection, sync native tier
& unknown slug preservation, shared schema/reserved-name, MCP enum/filter/mode/capability).
Test server serial memakai DB SQLite temp berbeda dan membersihkan env origin/SSH_ASKPASS.
Shared typecheck exit 0. Server typecheck tersisa hanya dua seam task selanjutnya:
`pty.ts` status runtime (Task 8) dan Telegram engine label (Task 13); tidak disuppress.
Endpoint live smoke dijadwalkan sekali pada Task 14 bersama perubahan runtime lain.


## Receipt Task 7 — Native phase protocol dan reviewer — 2026-10-14

`orchestratorClause` membedakan native Antigravity dari tool Claude/Codex: invoke langsung
`invoke_subagent`, catat conversation ID, keputusan dan rework melalui `send_message` ke ID
child yang sama. Semua keputusan diminta sekaligus, bernomor, dengan opsi/rekomendasi/alasan.
Protocol wait menahan fase berikutnya dan marker sampai laporan selesai; ia bukan foreground
runtime atau lock model exact. Daftar fase/reviewer menyebut tier native dan effort unknown.
Generated reviewer memuat larangan tulis instruksional, tanpa policy/read-only enforcement baru.
Roster delegasi fase menggunakan hanya Custom Agent yang kompatibel dengan tier/tool/policy native;
phase Execute inline tetap bekerja sendiri. Satu materialisasi fase gagal membatalkan seluruh
roster fase dan penanda orchestrated sebelum fallback single-session berperingatan.

Phase override transient DTO menerima model/effort nullable. Model null menjadi inherit native;
independent effort dan slug parent ditolak terhadap runtime efektif (termasuk Settings bila body
menghilangkan agent), bahkan ketika orkestrasi mati. `PhasePlanValidationError.statusCode=400`
dilempar sebelum worktree/baseSha/startedAt/stempel metode dan sebelum reaping pane mati lama.
Task 8 melengkapi validasi route sebelum approval dan admission runtime seluruh launch.

| Bukti live produk, selesai 2026-10-14T02:25:31.504Z, agy 1.3.4 | Hasil |
| --- | --- |
| `createSession` + `buildPhaseAgents` + materializer native dalam repo/worktree temp owned | orchestrated true, tier inherit, effort child unknown |
| Execute native | `d61f709e-2717-4278-a344-26facbe245d3`, Agent(hanoman-fase-execute), turn pertama 47 detik |
| Keputusan pertama | dua pertanyaan terbuka diteruskan parent; synthetic phase-file masih kosong |
| Follow-up | SendMessage ke ID Execute sama, nonce tidak dikirim ulang, recall `CHILD_1442_LYCHEE_71` |
| Reviewer independen | `66c05b90-01d2-4b3e-80d8-4d3999a0b1e4`, Agent(hanoman-fase-review), report `Verdict: lulus`, `TASK7_REVIEWER_READONLY_RECEIPT` |
| Marker | parent menulis/tail/cat `Execute done` ke phase-file sintetis sesudah review; berkas fase sesi nyata tidak disentuh |
| Parent | pane `%0`, PID `84248`, command agy tetap sama; argv prompt-interactive tanpa one-shot, turn kedua 87 detik |
| Cleanup | registry/manifest/exclude/temp owned dan PID hilang; trust sibling dipertahankan; tiga socket native percobaan owned dihapus setelah daemon dipastikan mati |

Percobaan pertama berhenti pada batas 180 detik sebelum invoke: parent menyelidiki tool lewat shell.
Prompt kini meminta tool native langsung dan melarang simulasi lewat shell/CLI. Smoke berikutnya
berhasil menjalankan protokol, tetapi harness awal membaca echo instruksi sebagai final marker;
predicate diperbaiki untuk menunggu final yang mengandung UUID child/reviewer dan report verbatim.
Receipt positif di atas berasal dari rerun bersih dengan deadline 180 detik per turn, bukan dari
percobaan gagal. Logs/script/capture ignored: `Task7-native-receipt.*`, `Task7-native-*-capture.log`.

TDD merah membaca 4 kegagalan prompt/delegasi (69 test lain lulus), override saat orkestrasi mati
(1 gagal/27 lulus), null DTO (1 gagal/11 lulus), side-effect baseSha (2 gagal), reaping pane
invalid (1 gagal), serta explicit null reset terhadap tier tersimpan (1 gagal/28 lulus). Scope final delapan test paths: **279/279 test, 8/8 berkas**; dua hash prompt
parent dan dua hash definisi fase menjaga Claude/Codex byte-identik. Shared dan runner typecheck
hijau; server masih memiliki dua seam yang menjadi milik task berikutnya: pty idle map dan
Telegram engine label. Tidak ada endpoint baru; MCP existing Settings/session phases diperbarui
bersama schema null dan API/workflow/ADR/index, sesuai ADR-0202.

Review Task 7 memperbaiki precedence effort transient: `effort:null` eksplisit menggantikan
legacy effort tersimpan yang tidak kompatibel, sama seperti override model. Resolver menilai
hanya effort efektif (override bila dikirim, selain itu sel Settings); tanpa override, sel
legacy `flash/high` tetap ditolak. Ini tidak memperluas dukungan effort child independen.
Regresi terfokus mula-mula 1 gagal/29 lulus karena override null masih membaca sel legacy;
sesudah perbaikan, `shared/src/orchestration.test.ts` lulus 30/30 dan typecheck shared hijau.


## Launch, admission, status dan receipt Task 8 — 2026-10-14

`createSession` memvalidasi Antigravity sebelum trust, registry, prompt/event files, spawn dan
riwayat kelahiran. Boundary sandbox aktif/required atau hardening eksplisit (termasuk kombinasi
hardening aktif dengan sandbox off) ditolak 409 `antigravity-sandbox-unsupported`; tidak ada
fallback host. Goal native ditolak 409 `antigravity-goal-unsupported`. Trust gagal menjadi
500 `antigravity-config-failed` dengan pesan aman tanpa path, isi konfigurasi atau credential.
Shell mentah mempertahankan jalur existing. Route backlog memvalidasi override terhadap runtime
efektif serta admission unsupported sebelum `approveLaunch`, sehingga penolakan tidak meninggalkan
persetujuan; admission capacity/reuse existing tetap berlaku. Default backlog Antigravity mengambil
blok `Setting.antigravity`, bukan model Claude. Semua entrypoint memakai final launcher yang sama.

Lead advisor internal memakai resolver biner yang sama, `-p`, model/effort/bypass dan
`--output-format json`; hanya envelope `status:SUCCESS` dengan `response:string` diteruskan ke
parser keputusan existing. Bentuk ini diverifikasi dari
[headless JSON upstream](https://antigravity.google/docs/cli/headless/#json) serta help agy 1.3.4.
Boundary unsupported juga menolak advisor sebelum spawn. Sesi kerja yang dilahirkan lead tetap
TUI, dan portal tetap restricted Claude-only. Env advisor memakai `agentEnvironment`; proses Git
metadata registry serta skill exclude menerima env unrelated yang menghapus kedua key Antigravity.
Fixture Git executable nyata membuktikan dua key tidak hadir, sementara GOOGLE_CLOUD_PROJECT tetap.

Parser restart tmux mempertahankan runtime `antigravity`, parent model/effort dan cwd. Frame fase
Antigravity memakai `attempts:null`, `effort:null`, `durationMs:null`, token/result null serta
`evidence:unknown`; status/startedAt invocation tidak dibuat dari cache DB tanpa telemetry native.
Model pada chip tetap **tier yang dideklarasikan**, bukan klaim model child aktual. Marker fase dan
plan tetap menentukan completion; pane exited tetap mendahului waiting. Tidak ada regex idle baru.
MCP existing session-create/cron/model schema menerima runtime additive; session-create meneruskan
phaseOverrides nullable/berbatas ke validasi server. Mode/capability lama tetap. Frame Terminal/events
tetap pengecualian streaming existing, session-events tetap HMAC; tidak ada route baru di task ini.

Receipt product launcher actual pada UTC `2026-10-14T02:46:15.800Z`: temp Git worktree canonical
trusted, `agy` 1.3.4 dengan argv interaktif tanpa `-p`/`--print`, metadata runtime Antigravity dan
cwd cocok. Jawaban aritmetika initial selesai **13 detik**, follow-up recall nonce selesai
**11 detik**, keduanya pada pane `%0` dan PID `9721` yang sama. Trust dialog tidak muncul.
Cleanup menghapus PID/socket/fixture dan hanya trust entry cwd owned, mempertahankan sibling
operator. Receipt/harness ignored: `.superpowers/sdd/task8-native-receipt.log` dan
`.superpowers/sdd/2026-10-14-spec-1442-antigravity-cli-runtime/Task8-native-receipt.ts`.
Percobaan pertama harness memakai predicate follow-up Task 4 yang keliru, lalu timeout bounded
180 detik dan cleanup lulus; receipt di atas dari rerun dengan predicate Task 8 yang benar.


Verifikasi Task 8: run scoped 20 berkas/526 test menghasilkan 19 berkas hijau; berkas PTY
memiliki 35 kegagalan sementara `tmux list-panes: server exited unexpectedly`. Rerun hanya
`server/test/pty.test.ts` memakai socket/DB baru dan env SSH bersih lulus **77/77**, sehingga
seluruh 526 kasus di scope memiliki hasil hijau (449 non-PTY + 77 PTY). Tidak menambahkan retry
production atau melemahkan assertion. Runner/shared typecheck exit 0; server hanya menyisakan
Telegram engine label (Task 13), frontend hanya seam runtime defaults/engine (Task 12), tanpa
error baru dari telemetry DTO/nullguard. `docs index --check` memberi `index ok` dan diff-check
bersih. Boot/curl endpoint terintegrasi tetap milik Task 14 sekali di akhir.


Review Task 8 membatasi diagnostik kegagalan advisor Antigravity ke kategori aman timeout,
exit numerik, sinyal OS yang dikenal, atau biner tidak ditemukan. Stdout/stderr provider dan
`execFile.error.message` tidak diteruskan ke jejak/notifikasi karena dapat memuat credential
atau prompt internal. String error-code asing juga tidak disalin. Claude/Codex mempertahankan
diagnostik existing. Test actual executable yang mencetak sentinel di dua stream lalu exit 7
membuktikan rejection hanya berisi kategori aman; RED 5 gagal/1 lulus sebelum perbaikan.
Scoped `lead-brain.test.ts` + `lead-engine-argv.test.ts` sesudah perbaikan lulus 38/38;
server typecheck hanya menyisakan Telegram engine label milik Task 13.


## Receipt Task 9 — katalog parent, cache dan invalidasi konfigurasi

CLI host `agy` 1.3.4 `models` exit 0 pada 2026-10-14: sepuluh baris TSV/462 byte,
fixture non-sensitive `server/test/fixtures/antigravity-models-1.3.4.tsv`. Fetch notice stderr
bukan katalog; parser mengambil id/label dan satu effort suffix konservatif. Parent katalog CLI
menggantikan fallback minimal ketika sukses; failure/empty/malformed/oversize/timeout mempertahankan
last-good. Native child `inherit|flash|pro` tetap terpisah.

Refresh dibatasi 20 detik/4 MiB dan interval lima menit. Key resolver DB→env→`agy` serta mode
sandbox/hardening dibaca kembali setelah await; hasil/error generasi lama tidak publish/cache,
`finally` lama tidak melepas refresh baru. Writer menormalisasi snapshot, temp unik `wx`0600,
memeriksa generation guard sebelum rename dan membersihkan temp. Cache lama tanpa provider
Antigravity mendapat fallback minimal. Mode sandbox ditolak sebelum host spawn dengan alasan aman.

Subprocess fixture nyata membuktikan DB override atas env, credential Antigravity hadir hanya pada
probe Antigravity, hilang pada Codex, dan `GOOGLE_PROJECT_ID` project tetap utuh. HTTP/WS snapshot
menambah provider tanpa mengubah capability tool `hanoman_models` existing (ADR-0202); klien
mounted menerima push, nilai tersimpan asing tetap opsi, HTTP lama tidak menimpa WS baru.
Verification Task 9: RED 4 berkas/9 gagal yang diharapkan +14 lulus; RED cache 1 missing-writer
failure +15 lulus. Final targeted 6 berkas/42 test lulus (parser9, lifecycle/cache10, probe8,
HTTP/WS3, mounted client3, existing shared picker9); default timeout nyata 20.003 detik.
Shared typecheck exit0. Server hanya pending label Telegram Task13; frontend hanya pending
defaults/EngineValue Task12, tanpa error Task9. Log teredaksi disimpan pada ignored workspace
`.superpowers/sdd/2026-10-14-spec-1442-antigravity-cli-runtime/Task9-*.log`.
Smoke endpoint akhir tetap Task 14.

## Observasi versi additive (Task 10)

`antigravity-version.ts` membaca biner efektif DB→env→`agy` lewat resolver Task 3 dan
`GET /api/antigravity/version` terdaftar pada `app.ts` (registrasi route milik aplikasi,
bukan entrypoint server). Versi nyata biner lokal `agy --version` teramati `1.3.4`; parser
hanya menerima semver lengkap, termasuk prerelease/build sah, bukan angka di diagnostic.
Probe berjalan dengan env Antigravity, argumen tunggal `--version`, timeout 10 detik dengan
SIGKILL per-child dan output maksimal 16 KiB tiap stdout/stderr. Error DTO selalu pesan
statis yang membedakan missing, timeout, parse, output-bound, dan boundary unsupported.
Raw stdout/stderr, credential, home, atau argv tidak pernah dibawa ke API/cache.

Service cache 5 menit keyed biner efektif dan mode sandbox/hardening. Read serentak pada key
yang sama berbagi promise; bin/boundary change membuang cache dan memulai generasi baru.
Completion memeriksa ulang key/generation dan cleanup memeriksa identity promise, sehingga
success/error lama tidak menimpa cache atau menghapus refresh baru. Boundary sandbox aktif/
hardening mengembalikan null + reason tanpa spawn executable host; gagal observasi bukan
gerbang launch host. `getAntigravityVersion()` client hanya tersedia sebagai getter, tanpa
fetch tambahan di UI lama atau minimum client rekaan.

Keputusan MCP ADR-0202: tool baru `hanoman_antigravity_version` mode read/capability null,
backed by `GLOBAL_READ` hanya pada GET/HEAD `/antigravity/version`. Method tulis dan sibling
route tetap cookie-only. Auth anonim 401, cookie admin/token kosong capability 200. Endpoint
Codex dan DTO `{version,minRequired,ok}` unchanged. Test route/cache/parser/fake executable,
auth dan MCP catalog/capability/coverage terarah; smoke server nyata sekali akhir Task 14.

Verification Task 10: RED selected 4 files (9 failed, 151 passed; absent service/route/tool/
authorization); corrected route test seed to a valid existing Settings blob after tracing its
401 to master-off fallback. Final targeted 10 files/265 tests passed, including 11 version
probe/cache tests, 5 route tests, 6 unchanged Codex version tests, catalog/capability/coverage,
observability gate and existing API client consumers. Real fake-executable timeout 10.006 s.
Shared typecheck exit 0; server reports only pending Task 13 Telegram runtime label, frontend
only pending Task 12 RuntimeDefs/EngineValue/default fields; no Task 10 diagnostic or suppression.
Logs are in ignored `.superpowers/sdd/2026-10-14-spec-1442-antigravity-cli-runtime/Task10-*.log`.
