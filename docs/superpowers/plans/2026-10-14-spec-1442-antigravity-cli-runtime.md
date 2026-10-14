# Antigravity CLI Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Metode eksekusi sudah ditetapkan sesi: agen fase Execute mengimplementasikan, orchestrator memanggil reviewer Execute independen; checkpoint skill tidak meminta approval tambahan.

**Goal:** Tambahkan `antigravity` sebagai runtime sesi interaktif ketiga dengan native child persistent, integrasi Settings/API/MCP/dashboard, serta batas kemampuan yang terlihat dan teruji.

**Architecture:** Adapter runtime memperluas jalur tmux/worktree existing, tanpa dispatcher child atau SDK baru. Pisahkan parent model/effort dari tier child native; persiapan trust/skill/registry berjalan pada cwd aktual dan admission unsupported ditegakkan pada launcher final. Setting/string/JSON existing diperluas additive, tanpa migration.

**Tech Stack:** TypeScript, Zod, Fastify, Prisma SQLite, tmux/node-pty, React/Vite, Vitest; Antigravity CLI `agy` lokal 1.3.4 sebagai baseline bukti.

**Spec:** [SPEC-1442](../specs/2026-10-14-spec-1442-antigravity-cli-design.md), khusus §S1–S8 dan 18 AC EARS; [ADR-0221](../../../internal/docs/adr/0221-antigravity-cli-runtime-interaktif-native.md); [SoT runtime](../../../internal/docs/architecture/antigravity-runtime.md).

## Global Constraints

- Base SHA `c6800c59837a152e413d8b7834ced0b21adcb084`; kandidat masuk Plan `2bbd3d71c7df04d847d3904b483bf6279a33dfe8`. Kerja hanya di worktree sesi; jangan mengubah worktree tetangga atau working tree utama.
- Biner efektif DB `HANOMAN_ANTIGRAVITY_BIN` → env → `agy`; registry `kind=path`, `apply=new-session`, `category=knob`. Biner bukan shell command atau daftar flag.
- Parent kerja interaktif memakai `--prompt-interactive`; tanpa prompt tetap TUI. Seluruh child kerja native `invoke_subagent`, follow-up memakai ID sama; tidak ada `agy -p`, bridge, SDK, atau global roster pengganti. **Hanya lead brain internal existing boleh `-p`.**
- Parent default `gemini-3.8-flash-high`/`high`; child tier publik `inherit|flash|pro`, default `inherit`, effort independen tidak dipancarkan. Exact model/effort per-child dan foreground bukan jaminan.
- Trust `~/.gemini/antigravity-cli/settings.json`, `trustedWorkspaces: string[]`, cwd realpath; read/merge terbaru, append idempoten, temp 0600 + rename atomik, ownership/symlink aman. Config rusak tidak di-reset.
- Registry sesi `.agents/agents` memakai namespace/manifest ownership, direktori 0700/file 0600, common-dir Git exclude dan cleanup ber-hash. Tidak overwrite definisi operator; tidak persona inline.
- Skill `.agents/skills`, project skill menang; AGENTS.md/GEMINI.md dipertahankan; injeksi skill fail-open dengan warning, trust fail-closed.
- Relay Plan Q1 **B**: status/pemasangan metode Antigravity unavailable beralasan sampai installer upstream terverifikasi; injeksi skill native yang sudah tersedia tetap bekerja. Jangan mengarang installer atau membuat pembacaan status/aksi install crash karena matrix lama dua-key.
- MCP global `~/.gemini/config/mcp_config.json`, `mcpServers.hanoman`, `command:"hanoman"`, `args:["mcp"]`, env host/token existing. Sibling/unknown config dipertahankan; token tidak dicetak; tidak menerbitkan token/capability otomatis.
- `GEMINI_API_KEY` dan `GOOGLE_GEMINI_BASE_URL` hanya ke pemakai Antigravity. Bersihkan juga env daemon tmux lama dari proses Claude/Codex/raw shell/subprocess unrelated; jangan menghapus `GOOGLE_*` wildcard.
- Host/lab saja. Sandbox aktif/required → `409 antigravity-sandbox-unsupported`; goal gate native → `409 antigravity-goal-unsupported`; kegagalan trust/config → `500 antigravity-config-failed` teredaksi. Tanpa host fallback atau hardening downgrade.
- Custom Agent `read-only` dan `isolated-worktree` unavailable sampai enforcement/handoff terbukti. Reviewer generated `kind:phase` boleh native inherit, read-only **instruksional**, tanpa klaim enforcement; auditor Custom Agent tidak mendapat pengecualian ini.
- Status tmux/marker; telemetry child unknown tetap null/unknown. Notifikasi keputusan native/Stop gate tidak dijamin. Completion/plan gate dan exited precedence existing tetap berlaku; jangan hidupkan guardrail ADR-0023/0037 kembali.
- Tidak ada tabel/kolom/migration baru. Claude/Codex dan portal restricted Claude-only mempertahankan perilaku existing, kecuali penyaringan dua credential Antigravity tersebut.
- Tiap commit implementasi memperbarui doc SoT yang disentuh + index; setiap kontrak API berubah mempunyai keputusan MCP sesuai tabel §S5. Orchestrator satu-satunya penulis phase-file dan pelaku push final.

## Review Focus

1. Update bin terjadi ketika probe lama masih berjalan: hasil/cache lama tidak boleh menang setelah config baru; uji pada Task 3/9/10.
2. Dua launch ke cwd berbeda berbagi config trust, salah satunya lewat symlink: kedua realpath bertahan, JSON/unknown fields tetap utuh; uji pada Task 4.
3. `.agents/agents` milik operator berisi nama yang berbenturan, atau file owned diedit setelah launch: materialisasi/cleanup tidak overwrite/delete milik operator; uji pada Task 5.
4. Setting/Custom Agent/model cache dari peer lama atau versi mendatang belum mengenal runtime/tier baru: pembacaan additive, unknown slug terlihat, legacy child incompatible unavailable tanpa mengubah runtime lain; uji pada Task 1/2/6/9/12.
5. tmux daemon lama menyimpan sentinel credential dan caller otomatis meminta goal/sandbox: credential tidak diwarisi runtime lain, final launcher menolak unsupported sebelum spawn; uji pada Task 3/8.

## Peta berkas dan seam

| Ownership | Berkas | Hasil/seam |
| --- | --- | --- |
| Kontrak murni runtime | `shared/src/antigravity.ts` (baru), `enums.ts`, `custom-agent.ts`, `entities.ts`, `runtime-defaults.ts`, `orchestration.ts`, `orchestration-plan.ts`, `agent-catalog.ts`, `method-catalog.ts`, `method-status.ts`, `index.ts` | Union/label/default, parent model terpisah dari child tier, schema additive dan phase effort nullable |
| Argv dan env | `runner/src/types.ts`, `agent-cli.ts`, `agent-env.ts` (baru), `index.ts`; `server/src/services/antigravity-runtime.ts` (baru), `pty.ts`, `config.ts` | Cabang argv native, resolver bin tunggal, env per runtime dan admission final |
| Persiapan cwd | `server/src/services/antigravity-trust.ts` (baru), `skill-inject.ts`, `skill-library.ts`; `runner/src/{skills,skill-library}.ts` | Trust atomic/preserve, instruksi dan skill native yang benar |
| Registry child | `runner/src/antigravity-agent-config.ts` (baru), `custom-agents.ts`, `phase-agents.ts`, `prompt.ts`; `server/src/services/custom-agents.ts`, `pty.ts` | Renderer native, materializer ownership, availability, phase relay |
| Launch/default/status | `server/src/services/{settings,runtime-defaults,orchestration,session-launch,session-phases,session-history,session-sandbox}.ts`, `server/src/services/lead/{brain,config}.ts`; `server/src/routes/{settings,terminal,ide,specs,custom-agents}.ts` | Parent launch/restart/lead/conflict dan batas unsupported |
| Observasi/model/API | `server/src/services/model-catalog{,-parser,-probe}.ts`, `antigravity-version.ts` (baru), `server/src/routes/antigravity.ts` (baru), `server/src/server.ts`, `server/src/services/agent-capabilities.ts`; `shared/src/{model-catalog,mcp-schema,api,dto}.ts`, `shared/src/mcp-catalog/observability.ts` | Discovery/version terikat bin, endpoint/tool additive |
| Dashboard | `src/src/App.tsx`, `src/src/screens/{session-runtime,NewTerminalModal,CustomAgentsPanel,OrchestrationPanel,TerminalScreen,McpPanel}.tsx` (runtime helper berakhiran `.ts`), `src/src/screens/settings/{SessionSettings,AgentsModels,fields,engines}.tsx` (engines `.ts`), `src/src/api/client.ts`, `api/model-catalog*.ts` | Picker tiga runtime, tier child dan alasan unsupported/unknown |
| Distribusi/docs | `cli/src/commands/doctor.ts`, `server/src/vps/catalog/components.ts`, `shared/src/dto.ts`, provisioning consumers; `server/src/services/method-status.ts`; `internal/docs/architecture/{antigravity-runtime,api-contract,model-catalog}.md`, `operations/agent-documentation-workflow.md`, `adr/0221-antigravity-cli-runtime-interaktif-native.md`, `docs/agent-integration.md`, index | Installer/auth host/lab, kontrak/evidence aktual |

Nama helper baru di bawah menjadi seam yang dipakai task berikutnya. Pertahankan signature existing `createSession(...): SessionInfo` yang sinkron; trust/materialisasi lokal menggunakan transaksi sinkron sehingga launch concurrent dalam proses server membaca merge terbaru tanpa mengubah semua caller menjadi async. Langkah yang menunggu CLI/probe tetap async dan bounded.

## Verifikasi per task

Untuk langkah merah/hijau, jalankan **path test task tersebut** dengan DB temp unik dan env bersih. Contoh shell zsh:

```bash
spec1442_test_dir=$(mktemp -d)
env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS TEST_DATABASE_URL="file:$spec1442_test_dir/t.test.db" pnpm vitest run runner/test/agent-cli.test.ts --no-file-parallelism
```

Gunakan nama direktori baru tiap run server yang berpotensi bersamaan. Exit 0 **dan jumlah test > 0** adalah bukti; merah harus menunjuk assertion fitur yang belum ada, bukan masalah bootstrap. Jangan menjalankan suite penuh, `pnpm -r typecheck` atau full build. Typecheck hanya paket tersentuh. Bunuh proses owned lewat PID atau tmux session id exact; dilarang `pkill -f`/`killall`. Baca hasil semua proses/anak sebelum melapor.

### Task 0: Buktikan feasibility native interaktif sebelum kode luas

**Files:** catatan bukti pada plan ini dan `internal/docs/architecture/antigravity-runtime.md`; fixture sementara di temp Git repo/worktree, bukan registry global.

**Interfaces:** Mengonsumsi CLI `agy` 1.3.4 dan §S8. Menghasilkan receipt versi, cwd/pane, discovery roster/skill, invoke ID dan follow-up ID sama, native tool/lifecycle yang benar-benar diamati untuk Task 5/7. Tidak mengubah kontrak spekulatif.

- [x] **Step 1:** Baca ulang help/docs primer yang ditaut spec untuk `--prompt-interactive`, native agents dan follow-up; simpan hanya command/flag/tool name yang terbukti. `agy agents` non-PTY stdout kosong bukan proof.
- [x] **Step 2:** Buat temp Git worktree dan `.agents/agents/hanoman-spec1442-probe.md` dengan frontmatter `name`, `description`, `model: inherit`, `mainAgent:false`, `subagent:true`; instruksi child memakai nonce non-rahasia untuk recall. Siapkan skill probe di `.agents/skills` dan AGENTS.md/GEMINI.md bernonce tanpa overwrite user content.
- [x] **Step 3:** Siapkan trust cwd realpath append-preserve menurut §S3; global operator config/token tidak dicetak/disalin ke repo. Jalankan parent **TUI** dalam tmux owned dengan `--prompt-interactive`, capture output yang telah diperiksa dan verify tidak ada dialog trust pada cwd tersebut. Tiap initial/invoke/follow-up turn dibatasi 180 detik; poll/capture dengan wait ≤60 detik, relay bila timeout menetap setelah diagnosis bounded, bukan menunggu proses tak terbatas.
- [x] **Step 4:** Dari parent TUI, discover/invoke child probe native; tunggu hasil, kirim pesan lanjutan lewat native lifecycle teramati **ke ID child yang sama**, minta recall nonce sebelumnya. Catat ID/count/cwd/pane dan skill/instruction discovery; parent tetap menerima follow-up di pane yang sama, tanpa process `agy -p`/bridge.
- [x] **Step 5:** Tutup tmux/proses owned dan hapus hanya file/config probe yang ownership-nya masih cocok, merge-preserve perubahan concurrent. Tulis receipt teredaksi dan hasil actual (bukan transcript fixture) pada SoT.
- [x] **Step 6:** Jika discovery/invoke/follow-up/trust/skill yang diwajibkan tidak terbukti, telusuri satu penyebab/config documented secara bounded; bila kontrak tetap tidak terpenuhi, **hentikan implementasi dan relay `Status: terhalang`/`Keputusan terbuka` ke orchestrator**. Dilarang fallback global registry, SDK/bridge, one-shot atau menandai semua native child unavailable untuk melewati AC-10/11. Lanjut Task 1 hanya setelah receipt positif.

**Receipt Task 0 (2026-10-14):** Gate native positif; lihat [receipt live pada SoT](../../../internal/docs/architecture/antigravity-runtime.md#receipt-live-task-0--2026-10-14). Parent tmux TUI `agy` 1.3.4 membaca kedua rule nonce dan skill workspace, memanggil satu child workspace native, lalu mengirim follow-up tanpa nonce ke ID yang sama; child mengingat nonce. Semua turn <180s. Cleanup trust owned, PID/tmux dan temp Git worktree telah diverifikasi. Task 1 boleh dimulai; ini belum membuktikan helper produk Task 4/5/7/8 atau MCP Task 11.

### Task 1: Union, parent model dan child tier additive

**Files:** Modify shared contract files pada peta, `runner/src/types.ts`, `server/src/services/method-status.ts`, install guard `server/src/routes/terminal.ts`; Create `shared/src/antigravity.ts`; Test `shared/src/custom-agent-runtime.test.ts`, `shared/src/method-status.test.ts`, `shared/src/orchestration.test.ts`, `shared/test/custom-agent.test.ts`, `runner/test/types.test.ts`, `server/test/{method-status.route,terminal.route}.test.ts` (kasus install baru).

**Interfaces:** `AntigravityModel={id:string,label:string,efforts:readonly string[]}`; `ANTIGRAVITY_CHILD_TIERS=["inherit","flash","pro"]`; `AntigravityChildTier` dari tuple; `antigravityEfforts(modelId:string):readonly string[]`; `BUILTIN_ANTIGRAVITY_RUNTIME_DEFAULTS={model:"gemini-3.8-flash-high",effort:"high"}`. `PhasePlan.runtime` menerima runtime ketiga dan entry/reviewer `effort:string|null` agar unknown/native tidak disamarkan sebagai effort terkunci.

- [x] **Step 1:** Tulis assertion: `zAgent`/runner mirror/runtime filter menerima `antigravity`; old Setting tanpa blok baru tetap parse; `Setting.antigravity` default tepat; child explicit tier+null effort valid, slug parent/independent effort invalid. Phase schema menerima native `inherit`/effort null tanpa mengubah sel Claude/Codex.

  Assertion kontrak minimal: `expect(zAgent.parse("antigravity")).toBe("antigravity")`; `expect(zSetting.parse(legacy).antigravity).toEqual({model:"gemini-3.8-flash-high",effort:"high"})`; `expect(ANTIGRAVITY_CHILD_TIERS).toEqual(["inherit","flash","pro"])`.
- [x] **Step 2:** Jalankan test path di atas, baca kegagalan assertion fitur.
- [x] **Step 3:** Tambahkan label `Antigravity CLI`, union/mirror MethodAgent, Setting/default marker dan orchestration block additive; export helper baru. Relay B diterapkan pada seam metode bersamaan union: entri install Antigravity kosong yang **digard**, status available false/reason dan ready false, server menolak install sebelum shell spawn. Jangan memakai parent `modelsForRuntime` sebagai validator tier child. Unknown stored slug dipertahankan; helper effort hanya mengembalikan level terverifikasi (fallback minimal default `high`). Update decoder enum presence/history/sync yang ditemukan, tidak skema DB.
- [x] **Step 4:** Jalankan test sama dan typecheck `./shared` + `./runner`; perbaiki nullable effort caller secara eksplisit, tanpa assertion/suppression untuk menutup gap.
- [x] **Step 5:** Commit intermediate kandidat dengan explicit paths dan perubahan SoT model/runtime + link index yang bersangkutan; commit/push final tetap milik orchestrator setelah semua marker fase sah.

**Receipt implementer Task 1 (2026-10-14, menunggu review Execute):** Red awal 6 berkas,
5 gagal assertion fitur / 98 lulus; guard kontrak HTTP tambahan red 409 vs target 400.
Final scoped 11 berkas / **284 test lulus**, shared + runner typecheck exit 0,
`git diff --check` bersih. Union/default/marker/tier-null, stored unknown, phase resolution,
presence/history dan guard installer sebelum spawn teruji. Fixture Terminal timestamp lama
diperbaiki memakai onset numerik saat lahir + negative stale marker, tanpa ubah detector
baseline `acfaff6c`. Scanner native status tetap pekerjaan Task 4/13, tidak dinyatakan siap.
Koreksi dokumentasi factual MCP methods/status mengikuti tool baca `GLOBAL_READ` existing;
UI/launch/input schemas native dan MCP parent/provider tetap task berikutnya. Kotak Task 1
menunggu review parent sebelum ditandai selesai.

### Task 2: Defaults/ownership dan Settings lama

**Files:** Modify `server/src/services/{settings,runtime-defaults}.ts`, `server/src/routes/settings.ts`, shared defaults; Test `server/src/services/runtime-defaults.test.ts`, `server/test/settings.test.ts`, `server/test/terminal-agent-defaults.test.ts`, `server/test/orchestration.service.test.ts`.

**Interfaces:** Pertahankan `applyRuntimeDefaults(raw:unknown):{data:Setting,changed:boolean}|null`, `markRuntimeDefaultsUserEdited(before:Setting,next:Setting):BuiltinRuntimeDefaults` dan session/terminal/conflict/lead defaults existing; tambah cabang runtime ketiga, parent model/effort default Task 1, phase tier inherit/null.

- [x] **Step 1:** Tulis fixtures fresh, BARIS_LAMA, marker current/legacy, user edit dan PUT client lama. Assert global `agent` operator, semua Claude/Codex values/markers tetap byte-equivalent; seed Antigravity idempoten dan PUT yang menghilangkan blok baru mempertahankan blok sebelum PUT.

  Assertions: `expect(second.changed).toBe(false)`; `expect(after.codex).toEqual(before.codex)`; `expect(after.agent).toBe(before.agent)`; `expect(after.builtinRuntimeDefaults.antigravity.model).toBe("user")` sesudah edit operator.
- [x] **Step 2:** Run test paths, verify FAIL yang relevan.
- [x] **Step 3:** Seed hanya blok/marker Antigravity additive; jangan reseed Claude/Codex karena version marker baru. Cabangkan helper defaults eksplisit agar ternary `codex ? ... : claude` tidak mengirim model Claude ke Antigravity. Settings/orchestration/tool schema memakai validasi native child terpisah.
- [x] **Step 4:** Run test paths sampai PASS >0; perbarui SoT runtime/default ownership dan commit explicit touched paths.

**Receipt Task 2:** commit `4be61a2cbdb142bd31a82393c723f5f9a4455f04` reviewed; scoped 9 files/99 tests lulus, shared typecheck exit 0. Current v2 Claude/Codex value/ownership tetap; historical v1/no-marker migration preserved. Old-client PUT preserves new block/native matrix. Server typecheck pending five later-task seams (custom-agent adapter, pty flags/skill/environment, Telegram runtime label), dicatat untuk Task 3/4/6/8. [Receipt SoT](../../../internal/docs/architecture/antigravity-runtime.md).

### Task 3: Biner efektif, argv interaktif dan isolasi env

**Files:** Create `server/src/services/antigravity-runtime.ts`, `runner/src/agent-env.ts`; Modify `shared/src/config-registry.ts`, `server/src/config.ts`, `runner/src/{agent-cli,index}.ts`, `server/src/services/pty.ts`; Test `runner/test/agent-cli.test.ts`, `runner/test/agent-env.test.ts` (baru), `server/test/{config-resolver,config-registry,pty}.test.ts`.

**Interfaces:** `antigravityBin():string` memakai `effectiveStr("HANOMAN_ANTIGRAVITY_BIN")??"agy"`; `agentEnvironment(agent:Agent|null, env:NodeJS.ProcessEnv):NodeJS.ProcessEnv` clone env, `null` untuk raw/unrelated; `agentFlags(AgentFlagsOpts):string[]` cabang Antigravity; argv prompt tetap dirakit di `createSession` dari berkas 0600 existing.

- [x] **Step 1:** Tests bin DB→env→default, fake executable path dengan spasi, override sesudah cache/config refresh; assert Antigravity flags model/effort/bypass dan `--prompt-interactive` tepat sekali sebelum arg prompt. Prompt multiline/backticks/`$()`/quote dan model berkarakter shell diterima sebagai argv utuh, tanpa efek command injection. Assert `--settings`, `--agents`, `exec`, `--print`, `-p`, hook Codex/goal tidak muncul.

  Assertion argv: `expect(actualArgs).toContain("--prompt-interactive")`; `expect(actualArgs.at(-1)).toBe(originalPrompt)` pada fake bin yang menyimpan argv; `expect(actualArgs).not.toContain("-p")`; `expect(commandInjectionSentinelCreated).toBe(false)`.
- [x] **Step 2:** Tambah env fixtures sentinel pada parent/lead/probe; Claude/Codex/raw/unrelated tidak menerima dua key, Antigravity menerima supplied values. Uji tmux daemon lama membawa sentinel dan overwrite/unset environment per pane secara scoped; log receipt hanya key names/boolean, tidak nilai.
- [x] **Step 3:** Run test paths untuk red; implement resolver tunggal dan cabang argv/env eksplisit. Registry bin bukan credential/inherit-all; setiap probe/lead caller memakai resolver dan builder yang sama. Pertahankan quoting/file substitution existing; daemon env cleanup tidak merusak sesi tetangga.
- [x] **Step 4:** Run green regression argv/env/config/tmux paths; SoT registry/env/binary diperbarui dalam commit explicit paths.

**Receipt Task 3:** commit `ebbcc3ed8d979566698bfd17d2d310b1a3ffd5d4` reviewed; original logs 5 files/111 tests lulus, runner/shared typecheck exit 0. Actual tmux argv path-spasi/multiline/shell-special intact, DB bin refresh, daemon/neighbor unchanged and credential env booleans verified. Five server downstream adapter/phase/skill/status/Telegram seams remain for their owners. [Receipt SoT](../../../internal/docs/architecture/antigravity-runtime.md).

### Task 4: Trust cwd dan injeksi skill tanpa merusak repo

**Files:** Create `server/src/services/antigravity-trust.ts`; Modify `server/src/services/{pty,skill-inject,skill-library}.ts`, `runner/src/{skills,skill-library}.ts`; Test `server/test/antigravity-trust.test.ts` (baru), `server/test/{skill-inject,skill-inject.pty}.test.ts`, `runner/test/skills.test.ts`, `runner/src/skill-library.test.ts`.

**Interfaces:** `ensureAntigravityTrust(cwd:string, home:string=homedir()):void`, synchronous read/merge-latest/temp-rename; existing skill injection interface extended with `agent:"antigravity"` and cleanup ownership. Tests pass temp home, never real HOME.

- [x] **Step 1:** Assert realpath append once, repeated cwd no duplicate, two launch cwd additions preserve both and all sibling fields. Corrupt JSON, wrong trustedWorkspaces type, symlink/unsafe owner/temp collision/write failure throw safe preparation error and leave original bytes untouched.

  Assertions: `expect(config.trustedWorkspaces).toEqual(expect.arrayContaining([realA,realB]))`; `expect(config.other).toEqual(before.other)`; `expect(originalBytesAfterFailure).toEqual(originalBytesBefore)`.
- [x] **Step 2:** Assert AGENTS.md/GEMINI.md and existing project skill content unchanged, global skill symlink `.agents/skills`, project collision wins, common-dir exclude idempotent, cleanup only owned symlink; skill failure warns/fail-open. Scanner recognizes `~/.gemini/antigravity-cli/skills`, no Codex plugin config misparse.
- [x] **Step 3:** Run red test paths; implement guard/atomic merge and branch injection. Invoke trust for actual cwd in final agent launch, no shell/raw preparation. Reuse existing exclude marker mechanism with ownership-specific entries.
- [x] **Step 4:** Run green paths; repeat Task 0 trust/skill receipt through implemented helper rather than hand-written fixture. No trust dialog and native skill discovery are required evidence; commit docs+code explicit paths.

**Receipt Task 4:** commits `a88dc2d84a87f9373952a9fbf22ace4d770b3df5` + review fix `3d19197c8a43d94691ae5f4d1272729cefa156f2` reviewed. Original 7files/74tests green + ownership rework2files/17tests green, runner/shared typecheck0. Actual createSession native Read injected skill + AGENTS/GEMINI nonces, no trust dialog, same pane/PID 23s+5s, owned cleanup verified. Review reproduced common-dir exclude cross-worktree dirty state and fixed per-link owned pairs. Skills source create/fork existing tools updated; source API smoke queued Task14. [Receipt SoT](../../../internal/docs/architecture/antigravity-runtime.md).

### Task 5: Renderer/materializer native roster per sesi

**Files:** Create `runner/src/antigravity-agent-config.ts`; Modify `runner/src/{custom-agents,index}.ts`, `server/src/services/pty.ts`; Test `runner/test/antigravity-agent-config.test.ts` (baru), `runner/test/custom-agents.test.ts`, `server/test/custom-agents.pty.test.ts`.

**Interfaces:** `renderAntigravityAgent(def:AgentDef, roster:AgentDef[]):string`; `materializeAntigravityAgents(opts:{cwd:string,sessionId:string,defs:AgentDef[]}):{names:string[],cleanup:()=>void}`. Inputs have validated tier/effort/policy from Task 1/6; output frontmatter Task 0 verified and body from `agentPromptOf`, no inline parent persona.

- [x] **Step 1:** Assert frontmatter name/description/model/mainAgent/subagent exact; `null` model→inherit, native tier preserved, no slug/independent effort/Claude tool names/settings. Verify name/path traversal rejected and namespace contains no operator overwrite.
- [x] **Step 2:** Fixture two sessions/worktrees, operator collision, partial write failure, owned file later modified, restart cleanup and Git status. Assert file 0600/dir 0700, registry global untouched, manifest/hash cleanup only exact unchanged owned files; phase defs all-or-nothing, one custom failure isolated with reason.

  Assertions: `expect(modeFile & 0o777).toBe(0o600)`; `expect(operatorBytesAfterCleanup).toEqual(operatorBytesBefore)`; `expect(gitTrackedDirtyPaths).toEqual([])`; `expect(childModel).toBe("inherit")`, tanpa effort independen.
- [x] **Step 3:** Run red paths; implement excluded `.agents/agents` materialization, manifest ownership and cleanup using actual native name/lifecycle from Task 0. Tool allowlist fields only emitted after native names/enforcement proven; unsupported restriction must be unavailable rather than silently removed.
- [x] **Step 4:** Run green tests and live discover/invoke/follow-up using implemented session registry. Record same child ID and recall result; validator/plugin manifest alone is insufficient. Update ADR/runtime doc proof and commit explicit paths.

**Receipt Task 5:** commits `b7d27ee19cb346181a4551d47e78c8ebc7f89bca` + review ownership fix `fbffc9189f68777a2bb6576cf2562a69056860f8` reviewed. Original3files/84tests green + rework2files/63tests green, runner typecheck0. Product materializer/createSession native namespaced file resolves frontmatter, one child a40667a7-6b1a-49a2-972b-23ff8a94df90 same-ID recall 43s+25s, cleanup registry/exclude/trust/PID/socket/fixture verified. Review RED reproduced symlink outside-write/operator-edit overwrite and false-phase-live; guarded descriptor ownership preserves operator bytes and unavailable warnings. [Receipt SoT](../../../internal/docs/architecture/antigravity-runtime.md).

### Task 6: Custom Agent validation/availability tanpa policy fallback

**Files:** Modify `shared/src/{custom-agent,agent-catalog}.ts`, runtime selection helper existing, `server/src/services/custom-agents.ts`, `server/src/routes/custom-agents.ts`, `shared/src/mcp-catalog/agents.ts`; Test `shared/test/custom-agent.test.ts`, `shared/src/custom-agent-runtime.test.ts`, `server/test/{custom-agents.route,custom-agents.service,custom-agent-selection,custom-agent-sync}.test.ts`.

**Interfaces:** Existing `agentDefsFor(context)` and availability/selectionReason DTO additive for Antigravity; explicit create/update validation tier `inherit|flash|pro`, independent effort null. Runtime `null` stays inherit/filter, never new process executable.

- [x] **Step 1:** Assert explicit Antigravity tier valid; explicit slug parent/effort independent invalid →400. Legacy/inherit definitions remain stored but incompatible for this parent have availability false + specific reason. Read-only auditor/isolated-worktree not remapped to inherit; compatible inherited agent available after native materialization support.

  Assertions: `expect(invalidCreate.statusCode).toBe(400)`; `expect(readOnlyRow.available).toBe(false)`; `expect(readOnlyRow.workspacePolicy).toBe("read-only")`; `expect(readOnlyRow.selectionReason).toBeTruthy()`.
- [x] **Step 2:** Assert merge of PATCH with existing row is validated even when runtime/policy/model/effort arrives separately; inherited forms do not alter Claude/Codex availability. Generated phase reviewer exception is keyed `kind:phase`, cannot be acquired through custom API or reserved name collision.
- [x] **Step 3:** Run red paths; extend selection/availability through known shared seam, server final validation and MCP schema. Unsupported tool restriction/maxTurns/timeout does not claim runtime enforcement; documented instructional limits remain labeled.
- [x] **Step 4:** Run green paths, MCP agent schema tests; record §S5 existing tool extension decision and commit docs+code.

**Receipt Task 6:** commit `744734936ee3ba1b99aae2f7a3d47a9a3bf24430` reviewed; original9files/199tests green, sharedtypecheck0. Explicit native tier/effort and merged PATCH validated; incompatible legacy model/tool/policy unavailable with reason, no silent fallback; kind spoof/reserved names and sync preservation tested. Existing agents MCP schema/filter + capability decisions/docs updated. Server remains two later seams pty status/Telegram label. [Receipt SoT](../../../internal/docs/architecture/antigravity-runtime.md).

### Task 7: Phase orchestration/native relay yang jujur

**Files:** Modify `shared/src/{orchestration,orchestration-plan,runtime-defaults}.ts`, `runner/src/{phase-agents,prompt,custom-agents}.ts`, `server/src/services/{orchestration,session-launch,pty}.ts`, `shared/src/mcp-catalog/{settings,sessions}.ts`; Test `shared/src/orchestration.test.ts`, `runner/test/{phase-agents,prompt}.test.ts`, `server/test/{orchestration.service,phase-agents.pty}.test.ts`.

**Interfaces:** `resolvePhasePlan(PhasePlanInput):PhasePlan|null` Antigravity uses tier/inherit and null effort; `buildPhaseAgents(plan,ctx):AgentDef[]`, `phaseDelegationClause`/orchestrator prompt render native `invoke_subagent` and verified follow-up tool from Task 0. `kind:phase` reviewer inherit/instructional-only; default inline execution remains existing.

- [x] **Step 1:** Tests default tier inherit/reviewer inherit, explicit flash/pro override, parent slug cannot become phase tier; null effort propagated through DTO/prompt/materializer. Existing Claude/Codex snapshots unchanged and no dependency on their foreground env/tool names for Antigravity.

  Assertions: `expect(plan.phases[0]).toMatchObject({model:"inherit",effort:null})`; `expect(plan.reviewer).toMatchObject({model:"inherit",effort:null})`; `expect(prompt).toContain("invoke_subagent")`; reviewer instruksional tetap tidak mendapat policy read-only enforced.
- [x] **Step 2:** Assert relay reports all open questions, resumes same child ID, rework reviewer same ID, parent sole phase marker writer, Execute marker only after independent `Verdict:lulus`. Prompt explicitly describes async/protocol wait and native effort unknown, not runtime foreground or exact model guarantee.
- [x] **Step 3:** Run red paths; implement runtime-specific prompt/phase renderer with shared existing retry/review/marker contract. Materialization failure clears orchestrated metadata and warns visibly on existing single-session fallback; no false roster success.
- [x] **Step 4:** Run green and one bounded live phase child + same-ID follow-up/reviewer receipt in synthetic temp session. Parent protocol waits; no writes to this real orchestrator's phase-file. Commit updated agent workflow/ADR with code.

**Receipt Task 7:** commits `43b9b706759edfc359d2f896130aacc2e9e11c64` + nullable override fix `bd1c789c90519f9b15cb18e8012f0a79a0ba32ee` reviewed. Original8files/279tests green + focused30tests green, shared/runner typecheck0, old prompt hashes unchanged. Native Execute d61f709e-2717-4278-a344-26facbe245d3 retained context after two-question relay to same ID; synthetic marker empty until independentReviewer66c05b90-01d2-4b3e-80d8-4d3999a0b1e4 Verdict:lulus; parent then wrote/tail/cat Execute done,47s+87s and fullcleanup. Task8 must validate effective runtime overrides before approveLaunch and map existing400; service validates before worktree/DB/reap. [Receipt SoT](../../../internal/docs/architecture/antigravity-runtime.md).

### Task 8: Semua launch, lead brain, boundary dan status

**Files:** Modify `server/src/services/{pty,session-launch,settings,session-history,session-phases,session-sandbox}.ts`, `server/src/routes/{terminal,ide,specs}.ts`, `server/src/services/lead/{brain,config}.ts`, shared presence/launch DTO; Test `server/test/{session-launch,session-launch-admission,session-sandbox,terminal.route,terminal-agent-defaults,lead-engine-argv,lead-brain,pty-parse,pty,session-phases,presence-snapshot}.test.ts` and existing conflict integration tests.

**Interfaces:** `createSession(projectId,cwd,opts):SessionInfo` final choke point; structured runtime preparation/admission errors map to exact §S5 HTTP status/code before spawn. Existing `startSpecSession`, terminal/default/conflict helpers and lead launch use it. Lead internal advisor uses explicit Antigravity `-p` JSON branch only.

- [x] **Step 1:** Table tests backlog/Terminal/IDE/ide/lead/conflict session Agent→correct actual worktree/cwd/argv/tmux metadata; shell bypass unaffected. Sandbox active/required and goal request reject 409 before process spawn/history/roster side effects; 401/403/404/capacity existing precedence retained. Trust/config error returns redacted 500 code, no fallback CLI.

  Assertions: `expect(response.statusCode).toBe(409)`; `expect(response.json().error).toBe("antigravity-sandbox-unsupported")`; `expect(spawn).not.toHaveBeenCalled()`; parse fixture `expect(session.agent).toBe("antigravity")`.
- [x] **Step 2:** Lead brain fake-bin argv includes `-p`, model/effort/bypass/JSON advisor output parser; boundary unsupported blocks its execution too. Lead-born working session has no `-p`. Portal runtime remains Claude-only despite wider Agent union.
- [x] **Step 3:** Restart/tmux parser/history/presence retain `antigravity`; completion needs all terminal markers + checked plan; exited wins. Unknown invocation/token/model/duration remains null/unknown. Any new idle regex requires Task 0/live capture fixture, waiting not automatically human decision.
- [x] **Step 4:** Run red paths; implement guarded preparation and metadata/status branches, update route error mapping/DTO enums. Centralize admission so scheduler/lead/agent-token path cannot bypass it; keep existing trust/goal/telemetry behavior Claude/Codex.
- [x] **Step 5:** Run green table/regression tests, attach/send two messages to actual integrated tmux pane and record same pane/process. Commit docs/error/launch/status changes together.

**Receipt Task 8:** commits `b83572c7bf8700d63ed92d52b7eaa95fc09ca872` + safe-advisor-error fix `72fc3afc01e15c251b8c6399dbe27fa2d817149d` reviewed. Scope20files/526cases green evidence449nonPTY+freshisolated77PTY after transienttmux failure; focusedlead2files38tests green. Runtime admission409sandbox/goal and redacted500trust, preapprovaloverride400, all launch/conflict/lead defaults, unrelatedgit-env sentinel, nativeunknown telemetry/presence/completion +MCP forwarding tested. Actual parent native13s+11s correctAG/cwd/samepane/PID andcleanup. Runner/shared0, server pendingonlyTask13Telegramlabel; frontend pendingTask12existingruntime seams. Docsindexok. [Receipt SoT](../../../internal/docs/architecture/antigravity-runtime.md).

### Task 9: Parent catalog CLI/cache dan config refresh

**Files:** Modify `shared/src/{model-catalog,entities,antigravity}.ts`, `server/src/services/model-catalog{,-parser,-probe}.ts`, `src/src/api/model-catalog{,-state}.ts`; Test `server/test/model-catalog{,-parser,-probe,.route}.test.ts`, `src/src/api/model-catalog.test.tsx`.

**Interfaces:** `parseAntigravityModels(raw:unknown):AntigravityModel[]` uses Task 0 actual `agy models` format; `ModelCatalog.antigravity/providers.antigravity` additive. Existing `probeModelCatalog`/`catalogCommand` accepts runtime union, bin Task 3/env Task 3 and returns normalized parent models. `replaceModelCatalog` preserves old callers through optional third argument.

- [x] **Step 1:** Capture non-sensitive CLI model fixture; test success replaces provider catalog, low/medium/high suffix only known effort, future/unknown slug visible, empty/malformed/output>4MiB/timeout preserve last catalog. Old cache lacking Antigravity parses with bundled minimal default; only id/label/known effort cached, file 0600.

  Assertions: `expect(antigravityEfforts("gemini-3.8-flash-high")).toEqual(["high"])`; `expect(snapshot.antigravity).toEqual(lastSuccessfulModels)` setelah failure; `expect(options).toContainEqual(expect.objectContaining({id:unknownStoredId}))`.
- [x] **Step 2:** Test 20s bounded probe, refresh 5min, same-bin concurrent coalescing; change effective bin while old probe in flight then assert old generation cannot install stale catalog. Unsupported sandbox returns safe provider reason without host probe.
- [x] **Step 3:** Run red paths; add parser/provider, preserve old catalog fallback/cache behavior, invalidation keyed bin+execution mode. Guard every `agent===claude ? ... : codex` in probe/server/client helpers with explicit runtime branch.
- [x] **Step 4:** Run green; update model-catalog/API WS schema tool decision with cache evidence and commit docs+code.

**Receipt Task 9:** commit `236e4ebff08572b3968e284da671978077ed81cc` reviewed; original6files/42tests green (actual20.003s bounded timeout), sharedtype0. Native agy models10TSVrows fixture, parser conservative suffix effort; lastgood/cacheold/futureID/0600normalizedcache/CLI replacement/WSrace/mountedpicker covered. DBbin+executionmode key before/afterawait prevents oldsuccess/error/write/finally; newestrefreshcoalesces, 2-keyenv boundaries verified. Existing HTTP/WS/MCPmodels extension documented. Server/FE pendingonlylaterTask13/12seams. [Receipt SoT](../../../internal/docs/architecture/antigravity-runtime.md).

### Task 10: Endpoint versi additive dan tool MCP baca

**Files:** Create `server/src/services/antigravity-version.ts`, `server/src/routes/antigravity.ts`; Modify `server/src/server.ts`, `shared/src/mcp-catalog/observability.ts`, `server/src/services/agent-capabilities.ts`, `shared/src/{api,dto}.ts`, `src/src/api/client.ts`; Test `server/test/antigravity-version.test.ts` and `server/test/antigravity-version.route.test.ts` (baru), `server/test/{agent-capabilities,mcp-capability,mcp-coverage,mcp-observability.route}.test.ts`, `shared/src/mcp-catalog.observability.test.ts`.

**Interfaces:** `antigravityVersionInfo():Promise<{version:string|null,error:string|null}>`, semver or safe missing/timeout/parse/boundary reason. `GET /api/antigravity/version` →200 authenticated, `GLOBAL_READ`; `hanoman_antigravity_version` mode read/capability null backed by route decision. Codex version API unchanged.

- [ ] **Step 1:** Parser/fake executable tests for 1.3.4, missing, malformed, timeout 10s/output bounded; DTO never raw stderr/stdout/home/token. Cache 5min keyed effective bin+execution mode, concurrent coalesce and stale generation discard after config change.
- [ ] **Step 2:** Route tests principal anonymous→401, valid cookie/agent token→200, mode/capability catalog/coverage assertions; version observation failure not 500 and not independent host launch blocker. Existing Codex DTO/snapshot unchanged.

  Assertions: `expect(validResponse.statusCode).toBe(200)`; `expect(validResponse.json()).toEqual({version:"1.3.4",error:null})`; `expect(missingResponse.json()).toMatchObject({version:null,error:expect.any(String)})`; tool `mode:"read",capability:null`.
- [ ] **Step 3:** Run red; implement service/route register, catalog tool and GLOBAL_READ authorization decision, client getter `getAntigravityVersion():Promise<AntigravityVersionInfo>`.
- [ ] **Step 4:** Run green selected version/MCP tests; update `docs/agent-integration.md`, API SoT and index in same commit. Live curl deliberately belongs to Task 14 once at end.

### Task 11: MCP global format yang aman untuk operator

**Files:** Modify `src/src/screens/McpPanel.tsx`, `src/test/mcp-panel.test.tsx`, `internal/docs/architecture/antigravity-runtime.md`, `docs/agent-integration.md`.

**Interfaces:** Existing `snippetFor(client,host,level):string` adds client `antigravity`, valid global JSON format/path, placeholder token existing. No new local-config writer/API endpoint; operator applies the documented merge to existing global `mcpServers` object. Conditional writer contract §S3 is not a requirement to add one.

- [ ] **Step 1:** Mounted tests select Antigravity and assert global path, `mcpServers.hanoman`, command/args/host, placeholder token; read-only/default/danger flags match existing user choice. Hint says merge only Hanoman entry, preserve sibling/unknown fields, reject damaged JSON/collision until manually reconciled, permissions 0600; workspace config untouched.

  Assertions: `expect(JSON.parse(snippet).mcpServers.hanoman.args).toEqual(["mcp"])`; `expect(snippet).toContain("hnm_agt_…")`; receipt/config fixture `expect(siblingsAfter).toEqual(siblingsBefore)`.
- [ ] **Step 2:** Run red, implement entry/hint using existing token access flow. Do not inject a real token into panel/snippet, auto-issue token or expose credential in logs/clipboard history beyond existing explicit flow.
- [ ] **Step 3:** Verify generated entry on temp config fixtures (existing sibling and root field preserved, corrupt/collision not overwritten) using bounded smoke setup; test/install procedure does not impersonate a production writer. Apply to owned global entry only if safe and consent already in task scope, use selected token without printing; live native `/mcp`/tools-list + `hanoman_about` must succeed. Preserve original operator entry if collision and relay if safe setup cannot be completed.
- [ ] **Step 4:** Run green UI tests; capture only tool names/result status, host/token excluded; cleanup only owned entry with merge-preserve. Commit guide/UI+docs.

### Task 12: Dashboard seluruh pemilih runtime dan alasan batas

**Files:** Modify `src/src/screens/session-runtime.ts`, `src/src/App.tsx`, `src/src/screens/{NewTerminalModal,CustomAgentsPanel,OrchestrationPanel,TerminalScreen}.tsx`, `src/src/screens/settings/{SessionSettings,AgentsModels,fields}.tsx`, `src/src/screens/settings/engines.ts`, terminal label helpers; Test `src/test/{start-session-agent,start-session-model,settings-agent,settings-model-tab,settings-conflict,settings-lead-engine,new-terminal-runtime,start-session-orchestration,custom-agents-panel,orchestration-panel,settings-orchestration,codex-version-note}.test.tsx`; Create `src/test/antigravity-version-note.test.tsx`.

**Interfaces:** Shared parent catalog/defaults Task 1/2/9 and `resolvePhasePlan` Task 7 drive parent picker/preview. Child native picker uses tiers only, effort null/disabled with explanation. Availability/selectionReason Task 6 and version Task 10 are displayed, not duplicated inference in UI.

- [ ] **Step 1:** Mounted tests choose Antigravity in Settings/backlog/New Terminal/IDE/lead/default conflicts and assert model `gemini-3.8-flash-high`+high sent through existing API. Stored unknown slug remains visible; stale/offline catalog keeps last choices; switching runtimes retains each saved block.
- [ ] **Step 2:** Tests child picker offers only inherit/flash/pro, no parent slugs or independent effort; read-only/isolated/legacy incompatible reason visible. Phase reviewer note says read-only instruksional; async/protocol wait/unknown effort text does not claim enforcement/foreground.
- [ ] **Step 3:** Version/null+safe reason and official install/auth links shown; goal native unsupported explained and rejected without sending ignored goal, sandbox host/lab limits visible, native telemetry unknown not zero. Existing Claude/Codex controls unaffected.

  Mounted assertions menggunakan accessible role/label: runtime `Antigravity CLI` tersedia; child picker options persis inherit/flash/pro; reason unsupported terbaca; serialized phase override `effort:null`; token telemetry null ditampilkan unknown.
- [ ] **Step 4:** Run red UI test paths; implement through shared runtime catalog/helper rather than repeated two-runtime ternaries. Add localized labels/accessible names per existing DS/glossary; partial API mocks updated only where new getter used.
- [ ] **Step 5:** Run green UI tests + `pnpm --filter ./src typecheck`; verify in browser Settings/Start/New Terminal/Custom Agent/orchestration, including keyboard selection, reasons and narrow layout. Record runtime/browser receipt and commit frontend SoT with code.

### Task 13: Distribusi, doctor dan dokumentasi final

**Files:** Modify `cli/src/commands/doctor.ts`, `server/src/vps/catalog/components.ts`, `shared/src/dto.ts`, provisioning scripts/catalog consumers, `server/src/services/method-status.ts`, `shared/src/{method-catalog,method-status}.ts`; Test `cli/test/{doctor,provision}.test.ts`, `server/test/{vps-catalog-components,vps-provision-script,method-status.route}.test.ts`, `shared/src/method-status.test.ts`. Update SoT/runtime/API/model/agent workflow/MCP docs, ADR-0221, `internal/skills/hanoman/SKILL.md` only relevant obsolete two-runtime paragraphs, `internal/docs/{README,adr/README}.md`, plan checklist.

**Interfaces:** Doctor reports configured `agy` executable/version/auth manual readiness without auto-install; VPS optional component uses only verified official host installer. Public/production session support remains unavailable with explicit reason; component install cannot imply Podman support. `MethodSkillStatus` adds optional `available:boolean`/`unavailableReason:string` (Antigravity false/reason), `ready:false`, `install:[]`; missing package/skill lists remain observed values, not fabricated failures. `MethodDef.install.antigravity=[]`, safe installer guard rejects this action with existing 400 `{error:string}` validation shape before shell spawn.

Kontrak metode dasar diterapkan di Task 1 agar union tidak menciptakan crash/perilaku install sementara; task ini melengkapi distribusi/doctor dan tampilan alasan berdasarkan kontrak tersebut, bukan mendefinisikannya ulang.

- [ ] **Step 1:** Tests configured/missing agy, optional component probe, no settings-open install/update, production boundary unsupported. Method runtime mirror/status accepts Antigravity, native skills scan uses discovered roots. Relay B: method status `available:false`, `ready:false`, `install:[]`, specific reason even if native skills exist; installed skill scan/injection still works. `POST /terminal/sessions` install Antigravity →400 validation error before shell spawn; Claude/Codex status/install unchanged. Add tests `server/test/method-status.route.test.ts`, `server/test/terminal.route.test.ts`, `src/test/method-status-ui.test.tsx` for Settings/picker reason and disabled install action.
- [ ] **Step 2:** Run red paths; implement doctor/catalog branch and method unavailable contract in shared/server/Settings/picker. Until a separately verified upstream installer exists, no method installer flags generated or executed; do not change Start's fail-open contract or native skill injection. Tests assert no status crash, no false readiness, and no empty command spawning an install shell.
- [ ] **Step 3:** Run green paths. Replace target/pending language in docs only for behavior actually verified; retain limitations explicitly. Record Task 0/native/child/skill/MCP receipts and AC→evidence in plan/SoT, not secrets/full raw config.
- [ ] **Step 4:** Confirm §S5 MCP decisions: new version tool; Settings/launch/agents/models existing tools extended; Terminal/events WS and HMAC session-events keep reasoned streaming/auth exceptions, no new REST config endpoint. Methods status keeps `COOKIE_ONLY` reason (machine-local dashboard readiness); shell install schema/error decision uses existing terminal tools/authorization, unsupported Antigravity method install unavailable. Link every touched/new doc; ADR-0221 exists, no need claim another number.
- [ ] **Step 5:** Commit docs with related code explicit paths, never `git add .`; child isolated handoff uses committed candidate/base literal SHA and returns result SHA for orchestrator cherry-pick. No final push from Execute.

### Task 14: Verifikasi akhir, bukti 18 AC dan serah-terima review

**Files:** Plan ini, `internal/docs/architecture/antigravity-runtime.md` evidence receipts, touched tests/docs only if a real finding requires correction.

**Interfaces:** Final Execute report contains table AC-01…AC-18→exact test/live/typecheck/doc evidence + candidate SHA; `Status:selesai` requires no material open decisions. Reviewer Execute is spawned **oleh orchestrator**, bukan agent fase Execute, sebelum marker Execute.

- [ ] **Step 1:** Audit diff runtime mirror/ternary yang tersisa (`rg` dengan scope touched shared/runner/server/src/src/cli). Periksa setiap live receipt positif dan semua checkboxes sebelumnya benar terpenuhi, bukan unavailable blanket. Tinjau keamanan/config/route dan UI/accessibility lewat reviewer yang relevan jika perubahan memerlukannya; baca semua laporan dan relay material open decisions, jangan menjawab sendiri.
- [ ] **Step 2:** Jalankan scoped regression final, env bersih + DB temp unik: `pnpm vitest --run --changed c6800c59837a152e413d8b7834ced0b21adcb084 --no-file-parallelism`. Baca jumlah file/test >0; jika changed select kosong, jalankan path touched eksplisit. Typecheck hanya `./shared`, `./runner`, `./server`, `./src`, `./cli` yang memang disentuh, satu perintah per paket. Full suite tetap manusia sebelum merge.
- [ ] **Step 3:** Boot server lokal isolated port/DB/home dan auth principal/token existing test fixture; **sekali di akhir** curl endpoint versi dan kontrak touched (settings/models/agents/launch negative) nyata. Assert safe 200 DTO/version or reason, auth/capability rejection, sandbox/goal pre-spawn negative. Token lewat temp 0600 config/header file, tidak stdout/argv/log; hentikan owned server PID sesudah hasil dibaca.
- [ ] **Step 4:** Integrated live session parent/child/native phase/skill/MCP smoke pada tmux worktree owned: discover+invoke+same-ID follow-up, parent same-pane follow-up, actual metadata/status/marker/completion, no native goal claim. Capture TUI teredaksi untuk setiap heuristic baru. Jika proof SC1/4 gagal, relay blocker; jangan centang Task ini atau AC palsu.
- [ ] **Step 5:** Jalankan `pnpm exec tsx cli/src/hanoman.ts docs index --check`, link existence untuk plan/spec/SoT/ADR/MCP, `git diff --check`, status/diff explicit touched paths. Tidak ada config/token/fixture temp di tracked tree. Update semua checkbox hanya sesudah buktinya dibaca; docs+code berada pada commit yang sama.
- [ ] **Step 6:** Laporkan `Status`, path spec **dan** plan persis, tabel 18 AC→bukti dengan command/output/count dan live receipts, candidate SHA serta `Keputusan terbuka:-`. Jangan tulis phase-file/push; orchestrator meminta review, meneruskan rework ke Execute yang sama dan baru menulis `Execute done` setelah `Verdict:lulus`.

## Pemetaan AC → task/evidence wajib

| AC | Task | Bukti sebelum klaim selesai |
| --- | --- | --- |
| AC-01 | 0,3,8,14 | Tests semua launch + tmux/worktree parent actual, same-pane follow-up |
| AC-02 | 0,3 | Help argv nyata + tests prompt multiline/shell quoting, tanpa one-shot kerja |
| AC-03 | 3,9,10 | Resolver DB/env/default, fake bins, refresh stale-generation concurrency |
| AC-04 | 1,2 | Fresh/legacy/seeded/user/idempotent/PUT backward-compatible |
| AC-05 | 1,9,12 | Model parser/probe/cache/timeout/future slug + mounted picker |
| AC-06 | 0,4,14 | Trust realpath/corrupt/ownership/concurrency fixtures + live no trust dialog |
| AC-07 | 0,4,14 | Instructions/skill precedence/exclude/cleanup tests + native discovery |
| AC-08 | 11,14 | Valid global snippet, preserve/corrupt/collision setup fixtures + native tools/about |
| AC-09 | 3,8,9,10 | Parent/lead/probe/raw/unrelated/tmux stale env sentinel tests, boolean-only receipt |
| AC-10 | 0,5,6,14 | Renderer/materializer/isolation/ownership tests + native TUI discovery/invoke |
| AC-11 | 0,5,7,14 | Native lifecycle count/ID same and context recall follow-up; no -p/bridge |
| AC-12 | 1,6,12 | API create/update/list legacy/inherit reasons + UI, no policy/model fallback |
| AC-13 | 1,2,7,14 | Phase plan/override/renderer/prompt tests + native phase/reviewer/protocol receipt |
| AC-14 | 10,12,14 | Version/parser/cache/auth/catalog/capability/coverage tests + final real curl |
| AC-15 | 3,8,12,14 | Final launcher all paths + lead boundary/goal pre-spawn 409 + visible reasons |
| AC-16 | 8,12,14 | Parser/restart/history/presence/completion tests + live TUI regex evidence; unknown null |
| AC-17 | 1–13,14 | Scoped Claude/Codex/portal regressions + touched package typechecks |
| AC-18 | 10,13,14 | MCP decisions/coverage/catalog, docs index/link/diff, nonempty scoped test proof, final AC table |

## Self-review Plan

Plan mencakup §S1–S8/SC1–SC6 dengan Task 0 sebagai feasibility blocker yang dirutekan, bukan fallback keputusan baru. Kelima Review Focus mempunyai task dan assertion pemilik. Nullable effort/tier child tidak dipakai sebagai slug parent; resolver/bin/env yang diproduksi Task 3 menjadi input probe/version/lead. MCP local writer tidak ditambahkan karena §S3 conditional dan UI existing adalah panduan instalasi; live merge-preserve tetap wajib dibuktikan. Gap matrix installer metode diputuskan manusia lewat relay Q1 **B** dan diturunkan ke Task 13/SoT/ADR/API: unavailable beralasan, skill native existing tetap bekerja. Tidak ada keputusan terbuka tersisa.

## Keputusan relay Plan

Q1 diputuskan **B** oleh manusia melalui orchestrator: status/pemasangan metode Antigravity unavailable beralasan sampai installer upstream terverifikasi; injeksi skill native yang telah ada tetap bekerja. Alasan rekomendasi: matrix `MethodAgent`/`installCommand` lama dua-key dan `methodStatusReport` mengiterasi `zAgent.options`; runtime ketiga harus tidak crash atau menerima flag installer asumsi. Pertanyaan material baru pada Execute wajib memuat rekomendasi **dan alasan**, lalu dirutekan; implementer tidak memutuskan sendiri.
