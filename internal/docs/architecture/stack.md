# Tech stack

| Lapis | Pilihan | Alasan |
|---|---|---|
| Dashboard | React + TypeScript + Vite | UI cepat, tim familiar |
| Realtime | WebSocket (terminal) + HTTP polling | terminal butuh stream dua arah; sisanya cukup poll |
| Server | Node.js + TypeScript (Fastify) | satu bahasa lintas stack; `@fastify/websocket`, `cookie`, `static` |
| DB | **SQLite (Prisma 6)** | embedded, nol proses eksternal; berkas di `~/.hanoman/hanoman.db` ([ADR-0086](../adr/0086-sqlite-satu-satunya-provider.md)) |
| Distribusi | **paket npm global `hanoman`** | `npm i -g hanoman` → `hanoman`; update `hanoman update` ([ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md)) |
| Terminal (server) | node-pty + **tmux** | sesi `claude` interaktif butuh TTY sungguhan; tmux menahannya hidup lintas restart API (ADR-0016) |
| Terminal (web) | xterm.js | render TUI Claude Code apa adanya |
| VCS | git + **git worktree** | isolasi sesi per backlog/branch (ADR-0002) |
| Agent | Claude Code CLI **interaktif** + hooks/skills/plugins | eksekusi brainstorm → objective → spec → plan → execute sebagai giliran satu sesi |
| Auth | cookie sesi opaque revocable | bind `127.0.0.1` + reverse proxy TLS (ADR-0028) |
| Kanal operator | Telegram Bot API long polling | satu bot/private chat; transport ke session tmux, bukan runtime agen ([ADR-0096](../adr/0096-telegram-gateway-session-operator-persisten.md)) |

Tidak ada message queue, Redis, worker terpisah, cron eksternal, maupun webhook GitHub — semuanya
dicabut saat pindah ke sesi interaktif (ADR-0024). Pekerjaan latar belakang berjalan **in-process**
lewat `setInterval` yang di-`start` dari `server.ts` saja (`app.ts` bebas-timer): monitor VPS (health
5 mnt, audit 24 jam) dan — sejak SPEC-294/[ADR-0072](../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md) —
**engine scheduler otonom** (tick governor: checker source enable+cadence → antrean durable
`SchedulerQueueItem` → drain di bawah cap). Scheduler **membalik sebagian ADR-0024** (menghidupkan kembali
antrean durable + cap concurrency), tetap **tanpa** broker eksternal: "antrean durable" = tabel DB hanoman. Sejak
SPEC-409/[ADR-0091](../adr/0091-hanoman-lead-agen-pemimpin.md) ada timer ketiga: **denyut hanoman-lead**
(tick 5 dtk untuk pintu deteksi keputusan; denyut proaktif tiap `Setting.lead.everyMin`). Ia mengikuti
pola yang sama persis — in-process, `.unref`, di-`start` dari `server.ts` — dan **tak menambah
infrastruktur apa pun**: urutan kerja yang ia putuskan diserahkan ke antrean & governor scheduler yang
sudah ada, bukan antrean kedua.

## Bentuk sistem
```
Dashboard (React + xterm.js)
   │  WebSocket (PTY terminal)  +  HTTP polling (projects, backlog, notifications, limits, vps)
   ▼
Server (Fastify, bind 127.0.0.1:8787)
   ├─ routes: auth · projects · specs · docs · terminal · vps · fs · settings · notifications · limits · health
   ├─ PTY/tmux  ─► sesi `claude` interaktif per backlog, di git worktree terisolasi
   ├─ VPS monitor (setInterval: health 5 mnt · audit 24 jam)
   ├─ Scheduler engine (setInterval tick: source enable+cadence → antrean durable → rekonsil akhir sesi + scanDecisions → drain di bawah cap · SPEC-294/ADR-0072; checker konkret: backlog SPEC-295, errors SPEC-296 — grup produksi berulang → escalate → antrean, satu grup = satu backlog, triase SPEC-297 — tiket bug/fitur eligible → accept → antrean, satu tiket = satu backlog; SPEC-298 — klausa autonomy per mode saat launch [full-control tembus sampai done / butuh-keputusan berhenti→notif decision, slot tetap] + akhir sesi: done→ringkasan `SessionResult`+notif done tanpa auto-merge, gagal/limit→notif fail tanpa retry)
   ├─ Lead engine (setInterval: 5 dtk pintu deteksi keputusan [pane ber-marker → capture → putuskan → ketik jawabannya];
   │                denyut proaktif tiap Setting.lead.everyMin: urutan kerja → antrean scheduler yang SUDAH ADA,
   │                tabrakan area kerja dari diff worktree, tindak lanjut sesi exitCode≠0 / plan bersisa `- [ ]` · SPEC-409/ADR-0091;
   │                default MATI, opt-in per project lewat Project.leadOptIn)
   ├─ Docs SoT scan (live dari Project.repoDir tiap request — ADR-0011/0018)
   ├─ @fastify/static → web/  (aset dashboard di dalam paket npm; HANOMAN_WEB_DIR)
   └─ SQLite (Prisma): Project · Spec · Setting · Notification · User · Session · Vps (+ LeadDecision, LOCAL-only · SPEC-409)
```

**Nol proses eksternal, dan itu termasuk DB-nya.** Sejak SPEC-398/ADR-0086 provider Prisma adalah
`sqlite`: satu berkas di `$HANOMAN_HOME` (default `~/.hanoman/hanoman.db`), tanpa Docker, tanpa
Postgres, tanpa Redis. Lokasinya ditentukan tiga fungsi murni di `runner/src/paths.ts`
(`resolveHome`/`resolveDbUrl`/`dbFilePath`) yang dipakai server **dan** CLI; `DATABASE_URL` yang
bukan `file:` **melempar** dan menunjuk `hanoman migrate-from-postgres`.

Yang tidak bisa dibawa npm justru inti produknya: **`git`** (worktree per sesi, ADR-0002), **`tmux`**
(sesi agen, ADR-0016), dan **CLI agen** `claude`/`codex`. `hanoman doctor` melaporkan keberadaannya
berikut exit code alih-alih memasangnya diam-diam atau menyembunyikan absennya sampai muncul di dalam
pane tmux yang tak dibaca siapa pun (ADR-0087).

## Eksekusi
`runner/src/*` adalah **library**, bukan proses: operasi git worktree (`git.ts`), pembangun prompt +
definisi pipeline fase (`prompt.ts`), teks standar reverse-docs (`reverse-standard.ts`), dan konfigurasi
guardrail PreToolUse (`safety.ts`/`settings.ts`). Tidak ada lagi invokasi `claude` headless — flow CLI
lama (`execute/spec/plan/qa`) sudah dicabut (ADR-0024).

Mesin eksekusi nyata adalah **`server/src/services/pty.ts`**. `createSession()` men-spawn agen
`<prompt> …flag agen…` di dalam window **tmux** (socket `-L hanoman`, `remain-on-exit on`); sebuah
node-pty `tmux attach` menjembatani sesi itu ke klien WebSocket, dan satu poll 500 ms mengawasi exit +
perubahan phase-file lalu mem-broadcast frame. tmux adalah satu-satunya sumber kebenaran pekerjaan yang
berjalan — tidak ada baris `Run` di DB.

### Chrome terminal (SPEC-800)

Sisi klien pane (`src/src/screens/TerminalPane.tsx` + `TerminalScreen.tsx`) memikul empat invariant
yang lahir dari audit SPEC-800:

- **Aksi header sel runtuh berdasarkan lebar KONTAINERNYA**, bukan lebar viewport — sel grid 4 kolom
  di desktop 1440px lebih sempit daripada satu pane di ponsel 390px, dan selnya `overflow: hidden`
  sehingga aksi yang tak muat bukan hanya tak terbaca melainkan **tak bisa diklik**. Aritmetikanya
  murni di `screens/terminal-chrome.ts` (`inlineActionCount`); `Layar penuh` dan `Tutup` tak pernah
  runtuh. Sisanya masuk `OverflowActions` (DS).
- **Pane menyambung ulang WebSocket-nya sendiri** (backoff 500 ms→8 s dengan plafon 8 s, 12 percobaan
  ≈ 76 dtk, tiket admission baru tiap percobaan sesuai ADR-0117, berhenti pada close 4004 karena sesi
  tmux-nya memang lenyap) dan **menguras input yang mengantre pada SETIAP `onopen`**. Anggaran 12
  percobaan itu dikalibrasi dari smoke SPEC-800: restart server sungguhan memakan lebih dari 20 detik,
  dan anggaran 6 percobaan (≈23 dtk) menyerah sebelum server kembali. Sebelum SPEC-800 tak ada satu
  pun `onclose`, jadi setiap penutupan — revalidasi principal, kuota, restart server saat update,
  jaringan mobile — membuat ketikan menumpuk di buffer tanpa pembaca dan hilang tanpa tanda.
  Keadaannya kasatmata di dalam pane; diam adalah cacatnya, bukan bagian perbaikannya.
- **Papan tombol layar mengirim satu keystroke per tekan** (SPEC-452 — dialog Ink menelan burst >1
  karakter). `Esc` bukan pelengkap: ia satu-satunya jalan keluar dari copy-mode tmux, dan keyboard
  virtual ponsel tak menyediakannya. Tap pada baris opsi dialog claude mengirim satu digit, dengan
  footer dialog Ink sebagai gerbang supaya daftar bernomor di layar kerja biasa tak ikut terkirim.
- **Wheel polos tetap milik tmux** (SPEC-209: wheel → tmux → copy-mode → riwayat 50 000 baris);
  `Shift+wheel` menggulir scrollback xterm secara lokal lewat `attachCustomWheelEventHandler`, satu
  jalur gulir yang tak pernah melewati mouse-mode. Ukuran font terminal adalah state tampilan
  persisten (SPEC-740 · ADR-0115), bukan bagian workspace kanonik per-user (SPEC-786 · ADR-0118).
- **Lampiran gambar adalah BERKAS + PATH, bukan gambar inline** (SPEC-816). Yang bisa dikirim ke PTY
  hanyalah teks; CLI-lah yang menyusun blok image, dari clipboard mesin server atau dari berkas yang
  dibacanya. Pane karena itu mengunggah gambar yang di-paste/di-drop ke
  `POST /terminal/sessions/:id/attachments`, lalu mengetikkan path absolut yang dikembalikan (+ satu
  spasi, tanpa Enter) supaya operator melanjutkan kalimatnya. Berkasnya hidup di
  `HANOMAN_UPLOAD_DIR/terminal/<sessionId>/` — subdirektori itulah yang mencatat kepemilikan, tanpa
  tabel dan tanpa migration — dan disapu `killSession()`, **bukan** `detachAll()` (restart server
  membiarkan sesi hidup, ADR-0016). Sebelumnya hanoman tak punya satu baris pun jalur gambar: Cmd+V
  hanya membaca teks dan Ctrl+V polos diteruskan mentah ke tmux, sehingga gambar hanya bisa masuk
  bila proses agen membaca clipboard mesin server sendiri — mustahil dari HP/tablet, dan rapuh
  terhadap umur sesi. Pemilahan berkas dari `DataTransfer` murni di `screens/terminal-clipboard.ts`
  (`imageFilesFrom`, `hasImageDrag`); `dataTransfer.files` KOSONG selama `dragover` — baru terisi
  saat `drop` — jadi keputusan `preventDefault` di dragover dibaca dari `types`.

**Dua agen didukung** (SPEC-338/ADR-0074): `Agent = "claude" | "codex"`. Default global
`Setting.agent` berlaku untuk semua sesi yang men-spawn agen; sesi backlog bisa meng-override saat
Start. Argv dirakit `runner/src/agent-cli.ts` (`agentFlags()`, murni & bertest); agen sesi disimpan di
opsi tmux `@hanoman_agent`. Perilaku sesi identik — worktree, fase, stage, review, integrate. Yang
berbeda hanya CLI-nya:

| | Claude Code | Codex CLI |
|---|---|---|
| Model | `--model <id>` | `-m <slug>` |
| Effort | `--effort <v>` | `-c model_reasoning_effort="<v>"` |
| Bypass izin | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` |
| Hook | `--settings <json>` | `-c hooks.<Event>=<toml>` + `--dangerously-bypass-hook-trust` |
| Marker keputusan | hook `Notification` (grep teks) | hook `Stop` (tak ada event `Notification`) |
| Mode goal | Stop hook `type:"prompt"` (evaluator prosa) | Stop hook `command` — gate sh **deterministik** (`type:"prompt"` didiamkan codex) |
| Biner | `HANOMAN_CLAUDE_BIN` | `HANOMAN_CODEX_BIN` |

Codex menolak jalan di direktori yang belum dipercaya; `services/codex-trust.ts` menambahkan satu
entri `[projects."<repoDir>"]` ke config codex sebelum spawn (worktree mewarisi trust root repo).

**Katalog codex per model** (SPEC-339). Effort adalah properti MODEL, bukan properti CLI: GPT-5.6
menambah `max` dan `ultra`, tapi `gpt-5.6-luna` tak mendukung `ultra` dan `gpt-5.5` tak mendukung
keduanya. `CODEX_MODELS` (shared) karena itu membawa `efforts`/`fallback`/`minClient` per entri, dan
`CODEX_EFFORTS` hanya bertahan sebagai gabungan — **bukan** sumber pilihan UI.

| Slug | Effort | Klien minimum |
|---|---|---|
| `gpt-5.6-sol` (default) | ultra, max, xhigh, high, medium, low | 0.144.0 |
| `gpt-5.6-terra` | ultra, max, xhigh, high, medium, low | 0.144.0 |
| `gpt-5.6-luna` | max, xhigh, high, medium, low | 0.144.0 |
| `gpt-5.5` | xhigh, high, medium, low | 0.124.0 |

Koersi effort terjadi di `createSession` — satu titik yang dilewati SEMUA kelahiran sesi, termasuk
jalur ber-`AgentToken` yang tak menyentuh UI. Model pensiun (`gpt-5.4`, `gpt-5.4-mini`,
`gpt-5.3-codex-spark`) diremap ke `gpt-5.5` saat `getSetting()` membaca, sengaja bukan ke 5.6 supaya
setelan lama tak berpindah ke model yang CLI-nya belum sanggup. Katalog model codex di-fetch dari
manifest OpenAI dan disaring **berdasarkan versi klien** (cache di `~/.codex/models_cache.json`),
jadi `codex debug models` adalah rujukan otoritatifnya — bukan ingatan.

**Limit langganan punya dua sumber terpisah.** `services/limits.ts` memanggil endpoint OAuth Anthropic
tiap 30 dtk (**claude**). `services/codex-limits.ts` (SPEC-338) **tidak memanggil apa pun**: codex
sendiri menulis `rate_limits` ke rollout sesinya di `$CODEX_HOME/sessions/<Y>/<M>/<D>/*.jsonl`, dan
server membaca ekor rollout terbaru (≤512KB, ≤8 berkas, cache 30 dtk) — nol jaringan, nol sentuhan
kredensial codex. Konsekuensinya nilai codex adalah **snapshot**: ia bergerak saat ada sesi codex
berjalan, dan snapshot >12 jam dilaporkan `stale`. Karena itu keduanya disajikan sebagai **dua badge
terpisah** (`LimitBadge` + `CodexLimitBadge`) dan dua grup siar (`limits` + `codexLimits`) — satu
angka "terburuk" gabungan akan mencampur data hidup dengan data historis. Badge codex menyembunyikan
diri sampai ada snapshot pertama.

**Satu backlog = satu sesi** (ADR-0015): id sesi diturunkan deterministik dari id spec, sehingga menekan
Start dua kali **re-attach**, bukan spawn kedua. Sesi berjalan di worktree-nya sendiri di
`<repoDir>/.worktrees/<id>` yang dibuat `--detach` dari `branchFrom` (default `main`); `baseSha` dicatat
untuk rentang review (SPEC-176/ADR-0030). Jenis sesi: **spec-flow** (`feature`/`qa`), **reverse**
(project-level, `reverse-<project>`), **plain terminal** (agen di repoDir ATAU shell mentah
non-agen `{shell:true}`, SPEC-236/ADR-0056), **integrate-conflict** (`merge-<id>`), **vps**.

**Fase bukan proses melainkan giliran** di dalam sesi itu: `runner/src/prompt.ts` `PIPELINES` mendefinisikan
nama fase per flow, dan prompt menyuruh agen `echo "<Fase> done" >> $HANOMAN_PHASE_FILE` selesai tiap fase.
Server membaca file append-only itu (`services/session-phases.ts`) untuk menurunkan fase aktif → `Stage`.
Konteks terbawa antar fase karena semuanya satu sesi. Prompt membawa **kontrak otonomi** (ADR-0035):
agen menembus batas antar-fase tanpa berhenti — checkpoint "review" milik skill superpowers bukan
titik berhenti — dan hanya berhenti untuk bertanya di terminal saat butuh keputusan manusia sejati. Model & effort bersifat **per sesi** (SPEC-252/ADR-0061, mengamandemen ADR-0058): sesi lahir dengan
**satu** `--model`/`--effort` — dipilih saat **Start** (picker default = `Setting.model`/`effort`, body opsional
di `POST /terminal/sessions`) dan berlaku seumur hidup sesi (satu proses); manusia bisa mengetik `/model`
di dalam terminal untuk menggesernya. Matrix per-fase (ADR-0058) dicabut — tak andal. Model-per-step (ADR-0003) usang bersama runner headless (ADR-0024).

**Metodologi kerja sebuah sesi adalah data, bukan literal** (SPEC-734/ADR-0113): satu konstanta
`METHODS` di `shared/src/method-catalog.ts` mendeklarasikan per metode peta fase→skill, direktori
artefak (`planDir`/`specDir`), klausa prompt tambahan, `exitSkills`, dan prasyarat instalasi —
menambah metode ketiga = **satu entri**. Katalog awal `superpowers` (default) dan `matt`
(mattpocock/skills). Registry hidup di `shared` dan **DI-IMPORT** runner alih-alih dicerminkan
seperti `Flow`/`Agent`/`VerifyScope` di `enums.ts` — deviasi sadar: cermin masuk akal untuk enum
tiga kata, bukan untuk tabel yang harus identik di tiga paket (SPEC-407 membayarnya dengan EMPAT
cermin `Flow`); `method-catalog.ts` karena itu bebas zod. Resolusinya mencerminkan `verifyScope`:
`opts.method` → `Spec.payload.method` (distempel di peluncuran PERTAMA lalu **beku**, cermin
`startedAt`) → `Setting.method` → `superpowers`, dengan `zMethod` **lenient** supaya id dari hub
yang belum ada di build ini jadi fallback diam alih-alih baris Setting yang gagal parse. **Dua
invarian mengikat:** setiap **gerbang** plan (`planComplete`, Stop hook codex, kondisi mode goal,
pembersihan artefak, klasifikasi doc, prompt lead) memindai **union** seluruh `planDir` dan wajib
`continue` — bukan `return true` — saat sebuah direktori tak ada, kalau tidak item yang berpindah
metode lolos ke `done` lewat direktori kosong; dan `exitSkills` wajib memuat gerbang verifikasi,
digabungkan ke fase terakhir flow penulis-kode, ditegakkan test di sumber. `PIPELINES` **tidak
berubah** — metode mengganti CARA sebuah fase dikerjakan, bukan fase apa yang ada. Tanpa pilihan
eksplisit, prompt byte-identik dengan sebelum spec ini.

Sesi memakai `--dangerously-skip-permissions`/padanan codex tanpa hook deny perintah; guardrail itu
dicabut ADR-0037. Sejak ADR-0117, worktree hanya boundary Git dan production menjalankan semua agen
di rootless Podman dengan mount/secret/egress minimum. Telegram tidak menambah executor:
session operator memakai API ber-AgentToken/capability, dan confirmation inline menjadi syarat
tambahan khusus action sulit dibatalkan dari identitas token gateway (ADR-0096).
Production menolak API/worker uid 0. `rootBypassEnv` tersisa hanya untuk kompatibilitas local/test
legacy; ia bukan konfigurasi deploy. Lihat [security-standard](../security/security-standard.md).

Biaya bersifat **estimasi dan tidak menggerakkan apa pun** (ADR-0012): tidak ada `dailyBudget`, tidak ada
budget flag. Indikator limit dibaca langsung dari OAuth usage API Anthropic (`services/limits.ts`,
ADR-0024), bukan dari parsing output terminal.
