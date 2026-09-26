# ADR-0170 — Orkestrasi mutu: subagent foreground, delegasi dalam fase, reviewer Execute, gerbang beban

- Status: Accepted
- Tanggal: 2026-09-25
- SPEC: — (audit 5-subagent + eksekusi langsung di sesi Claude Code; plan
  [2026-09-25-orkestrasi-mutu-multi-subagent](../../../docs/superpowers/plans/2026-09-25-orkestrasi-mutu-multi-subagent.md))
- Terkait: **mengamandemen** [0164](0164-orkestrasi-subagent-per-fase.md) T1 (keputusan "memaksa sinkron"
  yang tertunda kini diambil), [0169](0169-auto-resume-sesi-setelah-boot.md) keputusan #4
  (`bypassCapacity` dicabut), dan [0161](0161-gerbang-peluncuran-sesi-cap-dan-sumber-daya.md) (cap
  membandingkan sesi agen; sinyal memori). **Menegakkan** [0167](0167-keputusan-ambigu-lead-atau-manusia.md)
  di klausa metode matt. Indeks DB di [0171](0171-indeks-spec-project-notification-created.md).

## Konteks

Audit 2026-09-25 memecah sistem ke lima subagent (input · proses · output · performa · desain
multi-subagent). Temuan yang dijawab ADR ini:

- **Agen fase tak bisa benar-benar mendelegasikan.** Di sesi interaktif claude setiap `Agent` berjalan di
  latar (ADR-0164 T1). Pemanggil mengakhiri giliran selagi subagent bekerja, sehingga agen fase bisa melapor
  sebelum anaknya selesai, dan orchestrator membaca teks "menunggu…" sebagai laporan final (22 laporan tanpa
  `Status:` di audit ADR-0164).
- **Execute memaksa `superpowers:executing-plans`**, padahal skill itu berkata "If subagents are available,
  use superpowers:subagent-driven-development instead".
- **"done" = klaim agen.** 200 sesi terakhir: 98% berakhir `done`, 19% spec dijalankan ulang, cacat lolos ke
  produksi (SPEC-1186, SPEC-1259); hanya **7/200** sesi memanggil subagent reviewer.
- **Gerbang plan lolos** bila berkas plan tak memuat spec-id (nama default skill `YYYY-MM-DD-<feature>.md`).
- **Input**: orchestrator disuruh membaca SEMUA lampiran (s.d. 40 MB) padahal dilarang mengerjakan fase;
  fase Verifikasi (goal) tanpa klausa scope verifikasi; klausa metode matt masih "putuskan sendiri".
- **Beban mesin** (Mac mini 8 GB, dua kernel panic akibat sesi paralel): terminal agen operator `exempt` dari
  cap; tak ada sinyal memori; auto-resume boot melewati cap; cap menghitung shell operator.

### Pengukuran P0 (claude 2.1.282, 2026-09-25)

Direktori scratch, tmux socket terpisah, semua agen `haiku`; `probe-parent` memanggil dua `probe-child`
(`sleep 15; date`) dalam satu pesan. `requestShape` dari `subagents/*.meta.json`, event dari hook perekam.

| Varian | requestShape (semua lapis) | Stop sesi utama di tengah | Nested | Anak paralel |
|---|---|---|---|---|
| V0 tanpa apa pun | background | ya (1,8 dtk sesudah launch) | ya | ya |
| V1 `CLAUDE_CODE_FORK_SUBAGENT=0` + hook PreToolUse `updatedInput.run_in_background=false` | foreground | tidak | ya | ya |
| V1b `FORK_SUBAGENT=0` saja | background | ya | ya | ya |
| V2 hook `updatedInput` saja | background — hook **tanpa efek** | ya | ya | ya |
| V3 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` saja | foreground | tidak | ya | ya (stop bersamaan) |

Di V3 Bash latar tetap berjalan (tugas `sleep 5` di latar selesai dan dinotifikasi). Payload PreToolUse dari
dalam subagent membawa `agent_id`/`agent_type` (bahan tautan induk-anak kelak). Catatan: dokumentasi resmi
menyebut subagent latar tak mendapat tool `Agent`; di 2.1.282 V0 tetap bisa bersarang — yang rusak di mode
latar adalah *menunggu*, bukan *memanggil*.

## Keputusan

1. **Subagent foreground di sesi ber-fase claude** (`phaseSessionAgentEnv`, `server/src/services/pty.ts`):
   setiap sesi claude yang membawa `HANOMAN_PHASE_FILE` (orchestrator maupun sesi tunggal backlog/project)
   lahir dengan `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` dan `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=3`.
   Terminal claude bebas dan codex tak disentuh (codex sudah `max_depth=3`, cap 3 thread). Hook
   `updatedInput` tidak dipasang (terukur tanpa efek).
2. **Execute agen fase claude memakai `subagent-driven-development`** (`MethodDef.orchestratedPhaseSkills`,
   `phaseSkillsFor(…, agentRuntime)`). Sesi tunggal dan agen fase codex tetap `executing-plans`: nested SDD di
   codex belum diukur dan cap 3 thread dibagi orchestrator + agen fase + reviewer.
3. **Klausa delegasi agen fase** (`=== DELEGASI ===`, `withPhaseDelegation`, ditempel di `attempt()`
   `createSession` — satu-satunya titik yang tahu roster custom agent yang hidup):
   - fase riset (Brainstorm/Objective/Spec/Plan/Audit/fase dokumen): 2–3 pencarian sempit & independen dalam
     SATU pesan ke agen read-only termurah, sintesis & artefak ditulis agen fase sendiri;
   - Execute/Goal: satu implementer per task **berurutan** (skill SDD melarang implementer paralel; satu
     worktree, satu index git, mesin 8 GB), review per task; paralel hanya untuk pembacaan read-only;
   - aturan bersama: `subagent_type` dari roster (nama · read-only · model), hindari `general-purpose` untuk
     pencarian (mewarisi model sesi yang mahal), larang `hanoman-fase-*`, serah-terima (tujuan, scope, Base
     SHA, jangkar), baca SEMUA laporan anak, `Keputusan terbuka:` anak diteruskan, anak dilarang
     `git push`/`git stash`.
   Kerjakan/Verifikasi/reviewer tanpa klausa. Roster kosong → klausa generik tanpa nama.
4. **Reviewer independen Execute `hanoman-fase-review`** untuk flow feature & qa — BUKAN fase pipeline
   (`FLOW_PHASES`, peta stage, UI, data lama tak berubah). `PhasePlan.reviewer` dari `resolvePhasePlan`:
   default claude `opus`·`high`, codex `gpt-5.6-sol`·`high`, tak mewarisi orchestrator; override lewat sel
   Setting `orchestration.<flow>.<runtime>.Review` (tanpa migration). Instruksi turunan `spec-auditor` +
   gerbang bukti (spec & plan, diff `$HANOMAN_BASE_SHA...HEAD`, test sesuai scope), read-only lewat instruksi,
   laporan tabel AC · putusan · bukti + `Verdict: lulus | rework`. Orchestrator (langkah R): sesudah Execute
   `selesai` dan SEBELUM `Execute done` memanggil reviewer; `rework` → agen Execute yang SAMA lalu reviewer yang
   SAMA, maks 2 putaran, sisanya `Keputusan terbuka`. Invocation reviewer tercatat `phase = Execute`; chip
   fase (`enrichPhases`) memilih agen fase itu sendiri dan tak menghitung reviewer sebagai percobaan.
5. **Kontrak artefak antar-fase**: plan wajib `planDir/<YYYY-MM-DD>-<spec-id>-<slug>.md`, path persis
   diteruskan orchestrator (bukan glob); laporan Execute wajib tabel `AC → bukti`.
6. **Gerbang plan** (`planComplete*`, `stageForRun*`, `sessionComplete*`): bila fase `Plan` tercatat `done`
   (bukan `skipped`) dan tak ada berkas plan ber-spec-id → belum lengkap (tahan `executing`). Jalur lead yang
   memanggil `planComplete` tanpa daftar fase tetap perilaku lama.
   *Amandemen (regresi 0.9.8):* "tak ada berkas plan ber-spec-id" dinilai atas SELURUH worktree, bukan
   hanya `PLAN_DIRS` — sebelum memutus "tak ada", gerbang mencari `.md` ber-spec-id di direktori `plans/`
   mana pun (`git ls-files` tracked+untracked, hormati .gitignore; mis. `internal/docs/superpowers/plans/`
   atau arsip `.../done/plans/`) dan menilai kotaknya seperti biasa. Tanpa ini setiap backlog project yang
   menaruh plan di luar `docs/superpowers/plans` tertahan di `executing` selamanya. Git gagal → perilaku di
   atas apa adanya. Pencarian hanya berjalan di jalur "Plan `done` + PLAN_DIRS kosong".
7. **Input**: orchestrator hanya meneruskan manifest `INDEX.md` lampiran (`orchestratorAttachmentClause`);
   agen fase Verifikasi membawa `scopeClause`; klausa metode matt diselaraskan ADR-0167 (golden
   `start-qa-matt.txt` berubah sengaja — satu-satunya golden yang berubah).
8. **Gerbang beban** (`session-admission.ts`, `session-launch-gate.ts`, `session-boot-resume.ts`):
   - terminal agen operator (`terminal.ts` "Sesi baru" non-shell) ikut gerbang; shell mentah, skrip install,
     dan console VPS tetap exempt (ADR-0161 amandemen SPEC-1108);
   - cap membandingkan `liveAgentCount`, bukan semua pane hidup — menegakkan ADR-0161 keputusan #2 dan
     mengamandemen kalimat "cap selalu memakai semua pane hidup"; `liveCount` tetap dikirim untuk observasi;
   - sinyal memori: darwin `sysctl kern.memorystatus_level`, linux `MemAvailable/MemTotal`, lainnya `null`
     (tak pernah menolak); cache 5 dtk; `os.freemem()` tetap ditolak (ADR-0161). Ambang
     `Scheduler.launchGuard.minMemAvailablePct` default **15** (Setting Json, tanpa migration); penolakan
     `kind: "host-memory"`; UI Scheduler menampilkan memori tersedia + ambang;
   - auto-resume boot tunduk cap/beban (`bypassCapacity` dicabut). Berurutan, jadi tiap sesi yang lahir
     mempersempit cap untuk kandidat berikutnya; kandidat yang ditolak gerbang dicatat `deferred` (notifikasi
     "ditunda — lanjutkan manual") dan dilanjutkan operator lewat tombol "Lanjutkan" (ADR-0084). Tanpa retry
     otomatis dan tanpa antrean baru. Pembalikan sikap risiko ADR-0169 ini dikonfirmasi operator
     2026-09-25 ("ikuti rekomendasimu" atas usulan audit).

## Konsekuensi

- Satu run feature/qa kini memanggil minimal satu agen Opus/Sol tambahan (reviewer) plus subagent anak —
  biaya token naik, dibatasi cap 3 subagent/sesi dan gerbang beban.
- Selama agen fase bekerja, orchestrator tak menganggur, sehingga Stop dan pil "menunggu keputusan" palsu di
  tengah fase (ADR-0164 T3) tak lagi muncul dari subagent; snapshot `background_tasks` tetap terpasang untuk
  Bash latar.
- Pesan operator ke orchestrator selama fase berjalan baru terbaca sesudah agen fase kembali.
- Kepatuhan reviewer read-only, larangan anak, dan urutan implementer murni lewat prompt (ADR-0037: tanpa hook
  deny). `Verdict:` belum ditegakkan server.
- Auto-resume bisa menunda sebagian sesi sesudah reboot; operator melanjutkannya manual.
- Terminal agen dari UI bisa ditolak saat mesin sesak; manusia tetap bisa `force`.

## Amandemen 2026-09-25 (audit custom agent)

Langkah 5 reviewer (`runner/src/phase-agents.ts`) dan builtin `spec-auditor`
(`shared/src/builtin-agents.ts`) sebelumnya memakai dua daftar putusan yang berbeda
isi (5 vs 6) meski reviewer "diturunkan dari spec-auditor" (keputusan 4). Keduanya
sekarang mengimpor `SPEC_AUDIT_VERDICT_LIST` dari `shared/src/spec-audit.ts`
(`SPEC_AUDIT_VERDICTS`, enam putusan: terpenuhi oleh perubahan · sudah terpenuhi di
base · tak terpenuhi · terpenuhi BERBEDA dari yang diminta · belum terverifikasi ·
tidak berlaku) — satu sumber, bukan dua salinan yang bisa menyimpang lagi. `Verdict:
lulus | rework` pada laporan reviewer (keputusan 4) tidak berubah; ini hanya menyatukan
kosakata KRITERIA di dalam tabel, bukan vonis akhirnya. Detail di
[audit 2026-09-25](../research/audit-2026-09-25-custom-agent-dan-agen-domain.md) §1
poin 7.

## Yang TIDAK diputuskan di sini

- Penegakan server atas `Verdict:` (menolak `Execute done` tanpa invocation reviewer `completed`) dan gerbang
  bukti mesin (`.evidence/*.json`) untuk auto-merge; `SessionResult` di semua jalur `done`.
- Kolom `parentInvocationId`/`depth` di `AgentInvocation` untuk menampilkan subagent bersarang — bahan
  tautannya (`agent_id` di payload PreToolUse) sudah terbukti ada.
- Baris `Review` di Settings → Orkestrasi dan pratinjau Start (kini hanya lewat API Setting).
- Codex Execute memakai subagent-driven-development sesudah perilaku nested + cap 3 thread diukur.
- Kalibrasi `minMemAvailablePct` lintas host; resume bertahap otomatis bila `deferred` manual tak cukup.
