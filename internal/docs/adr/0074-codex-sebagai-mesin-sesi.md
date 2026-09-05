# ADR-0074 — Codex sebagai mesin sesi: `Agent` per sesi, hook lewat `-c`, mode goal deterministik

- Status: Accepted
- Tanggal: 2026-07-27
- SPEC: SPEC-338 (Support Codex sebagai session)
- Terkait: **memperluas [0024](0024-sesi-interaktif-menggantikan-run.md)** (mesin sesi tak lagi
  identik dengan `claude`), mengikuti pola [0061](0061-model-effort-per-sesi-picker-start.md)
  (knob dipilih saat Start → argv saat sesi lahir), memberi **padanan** bagi
  [0073](0073-mode-goal-stop-hook-per-sesi.md) (mode goal) dan [0029](0029-execute-done-butuh-plan-terceklist.md)
  (gate plan terceklist), memakai [0002](0002-git-worktree-isolation.md)/[0015](0015-one-session-per-backlog.md)/[0016](0016-sesi-terminal-hidup-di-tmux.md)
  apa adanya; **TIDAK membalik** [0037](0037-cabut-guardrail-safety.md).

## Konteks

Mesin eksekusi hanoman adalah `createSession()` di `server/src/services/pty.ts`, yang men-spawn
`claude <prompt> --model … --effort … --dangerously-skip-permissions --settings <json>` di window
tmux. Seluruh lapis di atasnya — prompt (`runner/src/prompt.ts`), phase file
(`services/session-phases.ts`), stage machine, review, integrate, worktree — **sudah agnostik
terhadap agen**. Yang mengikat hanoman ke Claude Code hanya tiga hal: nama binary, bentuk argv, dan
mekanisme hook lewat `--settings`.

Operator ingin menjalankan pekerjaan development dengan **Codex CLI** juga, dengan perilaku sesi yang
sama. Pertanyaannya bukan "apakah bisa" melainkan "di mana tepatnya kedua CLI berbeda, dan bagaimana
perbedaan itu ditutup tanpa mencabut jaminan yang sudah ada".

### Temuan verifikasi (codex-cli 0.142.5, dijalankan langsung — bukan dari ingatan)

1. **Prompt positional + TUI.** `codex [FLAGS] "<prompt>"` membuka TUI interaktif dengan prompt awal —
   bentuk yang sama dengan `claude <prompt>`. Jalur berkas prompt + `"$(cat …)"` (SPEC-223) dipakai
   apa adanya.
2. **Model & effort.** `-m/--model <slug>`; effort **bukan flag** melainkan config:
   `-c model_reasoning_effort="<v>"`. Katalog (`codex debug models`): `gpt-5.5`, `gpt-5.4`,
   `gpt-5.4-mini`, `gpt-5.3-codex-spark`; effort `low|medium|high|xhigh`.
3. **Bypass izin.** `--dangerously-bypass-approvals-and-sandbox` = padanan
   `--dangerously-skip-permissions`.
4. **Hook injectable saat lahir.** `-c 'hooks.Stop=[{hooks=[{type="command",command="…"}]}]'`
   diterima dan benar-benar dieksekusi — **padanan persis `--settings`**. Wajib disertai
   `--dangerously-bypass-hook-trust`; tanpa itu TUI berhenti di layar "Hooks need review".
5. **Event hook codex:** PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact,
   SessionStart, SessionEnd, UserPromptSubmit, SubagentStart, SubagentStop, Stop.
   **Tidak ada `Notification`.**
6. **Handler `type="prompt"` DIDIAMKAN.** Diuji: hook `prompt` tak pernah muncul di daftar hook yang
   berjalan, sementara hook `command` yang identik berjalan. Hanya `command` yang terpasang.
7. **Stop hook bisa MENAHAN turn.** Exit 2 dengan alasan di stderr → alasan itu menjadi continuation
   prompt dan agen dipaksa lanjut. Diuji end-to-end: gate menolak sekali, codex mengerjakan
   kekurangannya, gate lolos di percobaan kedua.
8. **Env diwariskan ke shell tool codex.** `HANOMAN_PHASE_FILE=… codex …` → agen bisa
   `echo "<Fase> done" >> "$HANOMAN_PHASE_FILE"`. Mekanisme fase hanoman jalan **tanpa perubahan**.
9. **Gerbang trust direktori** (jebakan utama). Di direktori baru TUI berhenti di "Do you trust the
   contents of this directory?" — dan `-c projects."…".trust_level` **tidak** membukanya (gerbang
   membaca config yang tersimpan, bukan override runtime; itu disengaja). Tapi trust pada **root repo
   menurun ke worktree-nya**: cukup satu entri `[projects."<repoDir>"]`, bukan satu per sesi.

## Keputusan

**`Agent = "claude" | "codex"` menjadi dimensi sesi**, sejajar `Flow`/`Stage`: String + zod di
`@hanoman/shared`, union TS di `runner` (pola yang sama dipakai `zFlow`/`Flow`).

1. **Setelan.** `Setting.agent` (default `"claude"`) + `Setting.codex { model, effort }` (default
   `gpt-5.5` / `xhigh`). `Setting` adalah kolom `Json` dan keduanya ditambahkan lewat `.default()` →
   **tanpa migration**, baris lama tetap parse (pola SPEC-294 `scheduler`, SPEC-332 `goal`).
   `Setting.model`/`Setting.effort` sengaja **tetap milik claude**: keduanya sudah jadi kontrak
   `GET /settings` dan memindahkannya akan memecah baris lama tanpa imbalan.
2. **Cakupan.** Setelan berlaku untuk **semua** sesi yang men-spawn agen: backlog (feature/qa/audit),
   reverse, prd, scaffold, breakdown, terminal-agen biasa, dan sesi resolusi konflik integrasi.
   Sesi shell mentah (ADR-0056) dan Console VPS (ADR-0042) tak tersentuh — memang bukan agen.
3. **Override per sesi.** `POST /terminal/sessions` varian spec menerima `agent?`, sejajar
   `model`/`effort`/`goal`. Sesi project-level tak punya picker; ia mengikuti default global.
   Governor scheduler tak memasok `agent` → ikut default global, seperti model/effort.
4. **Perakitan argv terkumpul di `runner/src/agent-cli.ts`** (`agentFlags()`, murni & tanpa I/O).
   `pty.ts` hanya mengutip & merangkai. Perbedaan CLI tak bocor ke lapis proses/tmux.
5. **Hook codex di `runner/src/codex-settings.ts`**, cermin `guardSettings()`.
6. **Agen sesi disimpan di tmux** (`@hanoman_agent`) — tmux tetap satu-satunya sumber kebenaran
   pekerjaan berjalan; tak ada baris DB. Sesi yang lahir sebelum ADR ini dibaca sebagai `claude`.
7. **`ensureCodexTrust(repoDir)`** dipanggil sebelum spawn sesi codex: menambahkan
   `[projects."<repoDir>"] trust_level = "trusted"` ke config codex bila belum ada. Idempoten,
   append-only, satu entri per project, gagal-diam. **Path dinormalkan lewat `realpathSync`**
   (perbaikan SPEC-337): gerbang codex mencocokkan realpath, sementara `repoDir` bisa lewat symlink
   (`/tmp`, `/var`, atau checkout yang dicapai lewat symlink) — entri ber-path mentah tak pernah
   cocok dan sesi mati di layar trust selamanya. Path yang belum ada di disk ditulis apa adanya.

### Tiga perbedaan sadar terhadap Claude Code

**(a) Marker keputusan memakai `Stop`, bukan `Notification`.** Codex tak punya event `Notification`,
jadi padanan "sesi menunggu manusia" adalah `Stop` (turn berakhir = giliran manusia), dikosongkan
`UserPromptSubmit` persis seperti claude. Konsekuensi yang diterima sadar: pada codex marker juga
menyala saat sesi selesai wajar, jadi notifikasi "butuh keputusan" sedikit lebih ramai. Mode goal
menekan Stop dini, sehingga dalam pemakaian normal selisihnya kecil.

**(b) Mode goal codex = gate deterministik, bukan evaluator prosa.** Karena hook `type="prompt"`
didiamkan codex, mode goal (ADR-0073) diwujudkan sebagai skrip sh yang dipasang sebagai Stop hook.
Ia memeriksa hal yang **sama** yang sudah digerbang server (ADR-0029):

1. `$HANOMAN_PHASE_FILE` memuat satu baris `done`/`skipped` untuk SETIAP fase pipeline;
2. `docs/superpowers/plans/**` tak menyisakan `- [ ]` untuk spec ini (hanya flow ber-Plan+Execute).

Terpenuhi → exit 0. Belum → exit 2 dengan alasan di stderr: apa yang masih kurang, plus teks kondisi
goal yang berlaku. Ini **lebih andal** daripada jalur claude, yang menyerahkan penilaian ke evaluator
tanpa tool di atas transkrip yang bisa terpotong. Konsekuensi jujur: **kondisi goal prosa bebas tak
dievaluasi pada codex** — ia ikut sebagai teks alasan, sementara yang benar-benar menggerbang adalah
dua cek deterministik di atas. `armGoalInTui` (`/goal`) tetap **khusus claude**; codex tak punya
padanan terverifikasi, dan jaminannya memang tak bergantung TUI.

**(c) Pagar anti-loop `GOAL_MAX_BLOCKS = 25`.** Gate deterministik tak pernah "cukup puas" seperti
evaluator LLM. Bila agen benar-benar mentok, memaksa terus hanya membakar token tanpa kemajuan.
Sesudah 25 penolakan, gate melepas dan menyerahkan ke manusia. Jalur claude tak berpagar karena
evaluatornya pada akhirnya bisa menilai "cukup"; asimetri ini disengaja.

## Konsekuensi

- **Tanpa migration.** Skema Prisma tak tersentuh.
- **Tanpa endpoint baru.** Hanya satu field opsional di body `POST /terminal/sessions`, dan dua field
  baru di `GET/PUT /settings`.
- **ADR-0037 tetap berlaku.** Tak satu pun hook yang dipasang menolak tool call: yang satu menandai
  marker keputusan, yang satu menahan sesi *berhenti* sebelum DoD terbukti. Isolasi worktree tetap
  satu-satunya batas keamanan. `--dangerously-bypass-hook-trust` dipakai untuk hook **milik hanoman
  sendiri** yang disuntik saat sesi lahir — bukan untuk mempercayai hook pihak ketiga.
- **Prompt jadi netral-agen.** `skillInstruction()` tak lagi menyebut "Skill tool" (istilah Claude
  Code); codex memuat skill secara native. Satu prompt melayani keduanya tanpa percabangan.
- **`ensureCodexTrust` menulis ke config codex milik operator.** Ini persis yang codex tulis sendiri
  saat manusia menjawab "Yes, continue", dan dibatasi satu entri per project. Alternatif
  `CODEX_HOME` terpisah ditolak (lihat di bawah).
- **Indikator limit codex: badge TERPISAH, sumber lokal.** (Ditambahkan setelah revisi awal ADR ini,
  yang sempat menyatakan limit "khusus claude" — batasan itu kini dicabut.) `services/codex-limits.ts`
  membaca blok `rate_limits` yang codex tulis sendiri ke rollout sesinya
  (`$CODEX_HOME/sessions/<Y>/<M>/<D>/*.jsonl`): ekor berkas ≤512KB dari ≤8 rollout terbaru, cache 30
  dtk. **Tanpa jaringan dan tanpa menyentuh token codex** — konsisten dengan aturan kredensial
  (kredensial agen tak pernah ke client maupun DB). Endpoint `GET /api/limits/codex` + grup siar
  `codexLimits`, keduanya terpisah dari milik claude.

  Dipisah, bukan digabung, karena **semantik kesegarannya beda**: angka claude adalah panggilan API
  live; angka codex adalah snapshot yang hanya bergerak saat sesi codex berjalan (>12 jam → `stale`).
  Satu angka "terburuk" lintas keduanya akan mencampur data hidup dengan data historis dan
  menyesatkan operator. Badge codex menyembunyikan diri sampai ada snapshot pertama, jadi operator
  yang hanya memakai claude tak melihat perubahan apa pun.

  Jebakan yang sudah terbukti dan dijaga test: **`primary`/`secondary` bukan 5-jam/mingguan tetap** —
  pada 27 Jul `primary` adalah window 10080 menit, pada 3 Jul ia 300 menit. Label WAJIB diturunkan
  dari `window_minutes`. Juga: `resets_at` codex adalah epoch **detik**, dan codex tak punya
  `is_active` (hanya `rate_limit_reached_type`) — window lain tak diklaim aktif.
- **Kredensial codex** (`~/.codex/auth.json`) mengikuti pola kredensial claude: milik mesin, tak
  pernah ke client maupun DB.

## Alternatif yang ditolak

- **`CODEX_HOME` per-sesi.** Akan memberi isolasi config penuh, tapi memutus operator dari plugin,
  MCP server, dan skill yang sudah terpasang di `~/.codex` — persis yang membuat sesi berguna. Juga
  butuh menyalin/symlink `auth.json`. Ditolak: biaya besar untuk masalah kecil (satu entri trust).
- **Satu entri trust per worktree.** Benar secara mekanis tetapi menggelembungkan config codex dengan
  ratusan direktori ephemeral. Trust root repo sudah menurun ke worktree — dipakai itu saja.
- **Mode goal dimatikan untuk codex.** Paling murah, tapi meninggalkan satu perilaku Claude tanpa
  padanan padahal codex justru menyediakan mekanisme blocking yang lebih tegas.
- **`Setting.agents.{claude,codex}` bersarang penuh.** Lebih simetris, tapi memindahkan
  `model`/`effort` keluar dari akar `Setting` = memecah kontrak `GET /settings` dan baris lama, demi
  kerapian saja.
- **Flow/pipeline khusus codex.** Ditolak tegas: seluruh nilai SPEC-338 justru pada perilaku yang
  **sama** — worktree, fase, stage, review, integrate. Yang berbeda hanya CLI-nya.

## Pembaruan SPEC-339 (2026-07-27) — katalog per model

**Amandemen 2026-09-05:** discovery `codex debug models` menggantikan pemeliharaan manual
katalog sebagai sumber utama, dengan fallback bawaan dan cache terakhir. Astra sudah tersedia
di fallback. Peta pensiun tidak mengganti model yang ditemukan kembali oleh CLI.
Lihat [katalog model otomatis](../architecture/model-catalog.md).


GPT-5.6 (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`) menambahkan effort `max` dan `ultra`, dan
dukungannya **tidak seragam**: Luna tak mendukung `ultra`, dan seluruh model 5.5 ke bawah tak
mendukung keduanya. Asumsi awal ADR ini — bahwa katalog codex cukup berupa dua daftar sejajar
(`CODEX_MODELS` + `CODEX_EFFORTS`), cermin `MODELS`/`EFFORTS` milik claude — karena itu tak lagi
berlaku. Effort adalah properti MODEL, bukan properti CLI.

Yang berubah: `CODEX_MODELS` membawa `efforts`/`fallback`/`minClient` per entri; `CODEX_EFFORTS`
bertahan hanya sebagai gabungan demi pemanggil lama dan bukan lagi sumber pilihan UI. Koersi effort
dipasang di `createSession` — satu titik yang dilewati SEMUA kelahiran sesi, termasuk jalur
ber-`AgentToken` yang tak menyentuh UI, sehingga kombinasi tolak mustahil sampai ke argv. Default
global codex berpindah dari `gpt-5.5` ke `gpt-5.6-sol`, dan model yang dipangkas dari picker
(`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`) diremap ke `gpt-5.5` saat dibaca — sengaja bukan
ke 5.6, karena 5.6 menuntut klien lebih baru dan pensiun tak boleh merusak setelan yang sudah jalan.

Temuan yang mengubah desain: **katalog model codex di-fetch, bukan di-compile**, dan manifest-nya
disaring server berdasarkan versi klien (cache `~/.codex/models_cache.json` menyimpan
`client_version`). CLI < 0.144.0 karena itu tak pernah melihat trio 5.6 sama sekali — bukan soal
langganan. `max` bahkan belum ada di enum effort 0.142.5. `GET /api/codex/version` memberi peringatan
lunak di Settings & picker Start; ia **tidak** memblokir Start, konsisten dengan ADR-0037.

Tanpa migration dan tanpa ADR baru: bentuk keputusannya masih berada di dalam ADR ini, `Setting`
tetap kolom `Json`, dan endpoint versi hanyalah observabilitas.
