# ADR-0094 — Custom agent: katalog di DB, materialisasi native per agen, anti-loop berlapis

- Status: Accepted — materialisasi Codex inline **dicabut ADR-0159**
- Tanggal: 2026-08-01
- SPEC: SPEC-450 (custom agent hanoman)
- Terkait: **memperluas** [0074](0074-codex-sebagai-mesin-sesi.md) — satu perbedaan CLI lagi dirakit
  `agentFlags()`, dan asimetri claude↔codex diterima sadar seperti di sana; **mengikuti**
  [0045](0045-skema-sync-synclog-version-stamp.md) (entitas baru masuk changefeed) dan
  [0002](0002-git-worktree-isolation.md) (worktree adalah satu-satunya batas — definisi agen tak
  boleh mengotorinya); **menyentuh** [0065](0065-ai-agent-capability-agent-token.md) (satu domain
  capability baru, dipetakan menurut method — kelas bug SPEC-405);
  **tidak menyentuh** [0037](0037-cabut-guardrail-safety.md) — anti-loop di sini adalah bentuk data
  dan permukaan tool di argv, bukan hook deny di sesi agen; **tidak menghidupkan kembali**
  [0024](0024-sesi-interaktif-menggantikan-run.md) — tak ada proses agen baru yang dilahirkan hanoman,
  `services/lead/brain.ts` tetap satu-satunya titik spawn di luar `pty.ts` (SPEC-448);
  **diamandemen** [0159](0159-custom-agent-native-terukur-terisolasi.md) pada materialisasi Codex,
  execution profile, seleksi, dan telemetry.

> **Amandemen 2026-08-31 (SPEC-950/ADR-0159):** bagian keputusan 4 yang menempelkan roster penuh
> ke prompt Codex dan konsekuensi "tak ada proses kedua" adalah historis. Codex sekarang memakai
> custom agent native berbasis TOML temp; prompt parent hanya membawa klausa delegasi ringkas.
> Tidak ada berkas worktree/home, tetapi berkas konfigurasi sesi memang lahir di tmpdir.

## Konteks

hanoman melahirkan sesi agen di worktree terisolasi, tapi setiap sesi selalu berisi **satu agen
generik**. Tak ada cara menyatakan "di project ini, review keamanan dikerjakan persona X" atau "di
seluruh workspace, penulisan migration selalu lewat persona Y". Pengetahuan seperti itu hari ini
hanya bisa dituang ke prompt sesi — sekali pakai, tak bisa dipilih ulang, tak bisa dibagi antar
project, dan tak terlihat di dashboard.

Kedua CLI sebenarnya **punya** konsep agen custom, tapi tidak setara — dan perbedaannya baru terbaca
setelah diukur, bukan dibaca dari dokumentasi:

| # | Yang diukur (2026-08-01, claude 2.1.220 · codex 0.146.0) | Hasil |
|---|---|---|
| M1 | `claude --agents '<json>'` | **Ada & bekerja.** `{"<name>":{"description","prompt","tools","model"}}`; agen muncul di daftar subagent sesi. |
| M2 | Delegasi antar-subagent | **Bekerja** bila agen pemanggil punya `Task` di `tools`. Tanpa `Task`, agen **tak punya alat** untuk memanggil siapa pun. |
| M3 | `claude --agents '{not json'` | **exit 0, sesi jalan, NOL agen, tanpa satu pun pesan.** |
| M4 | `tools:[…,"Glob","Grep","TodoWrite"]` | Ketiganya **dibuang senyap**; `Task` yang diminta hadir bernama `Agent`. |
| M5 | `codex -c 'agent_roles.reviewer.bogus_field="x"'` | **exit 0, tanpa keluhan.** Codex menerima kunci `-c` tak dikenal secara diam-diam. |
| M6 | `$GIT_DIR/info/exclude` di linked worktree | **Diabaikan git** — hanya common dir yang dibaca. |

M5 adalah yang paling menentukan. Codex 0.146 memang membawa `multi_agent` (stable), tool
`spawn_agent`, dan struct `AgentRoleToml{config_file, nickname_candidates, …}` di binernya — tapi
karena kunci `-c` yang **tak dikenal pun diterima diam-diam**, "konfigurasinya masuk tanpa error"
tidak membuktikan apa pun. Tak ada cara memverifikasi `agent_roles` hari ini, jadi ia tak boleh jadi
fondasi.

M6 mengunci pertanyaan yang berbeda: konvensi `.claude/agents/<name>.md` akan berarti menulis berkas
ke worktree sesi, dan berkas itu **pasti** muncul di `git status` — `info/exclude` per-worktree
diabaikan git, jadi satu-satunya cara menyembunyikannya adalah menyunting `.git/info/exclude` milik
**checkout utama operator**. Menukar "definisi agen" dengan "diff worktree tak pernah bersih" adalah
pertukaran yang buruk: DoD hanoman menuntut diff bersih, dan ADR-0002 menempatkan worktree sebagai
satu-satunya batas yang tersisa.

## Keputusan

**1. Katalog hidup di DB sebagai entitas `CustomAgent` yang DISYNC, dengan `projectId` nullable
sebagai penanda scope.** `projectId = null` berarti global (semua project); terisi berarti milik satu
project. Agen project dengan nama sama **menimpa** agen global — satu aturan, tanpa mode.

**2. `id` DETERMINISTIK: `"<projectId|global>:<name>"`, dan `name` IMMUTABLE.** Ini baris yang
menyeberang changefeed. Dengan id acak, dua mesin yang sama-sama membuat agen global `reviewer`
melahirkan dua baris berbeda yang keduanya tersinkron, lalu bertemu di satu objek JSON `--agents`
yang **berkunci nama** — salah satu hilang tanpa jejak. Dengan id deterministik keduanya adalah baris
yang sama dan rekonsiliasi LWW/`SyncConflict` (ADR-0067) yang sudah ada menanganinya. `name` dikunci
karena changefeed **tak punya operasi hapus**: rename yang mengubah id meninggalkan baris yatim di
setiap mesin lain. Ganti nama = hapus + buat baru, keputusan sadar operator.

**3. Nol berkas ditulis ke worktree atau home runtime.** Definisi mengalir lewat konfigurasi native
di tmpdir sesi. Tak ada `.claude/agents/` di worktree, tak ada sentuhan `~/.claude`, tak ada sentuhan
`.git/info/exclude` (M6). Berkas yang lahir hanya konfigurasi JSON/TOML dan hook sementara di
tmpdir sesi, di luar worktree — persis kelas berkas prompt SPEC-223.

**4. Materialisasi berbeda per agen, dan asimetrinya dinyatakan terbuka.** *(Subbagian Codex di
bawah dicabut ADR-0159; dipertahankan sebagai riwayat pengukuran.)*
- **claude** → `--agents "$(cat <file>)"`. Mekanisme native (M1): custom agent menjadi **subagent
  sungguhan** dengan konteks terisolasi. JSON ditulis ke berkas lalu diserahkan lewat
  command-substitution karena tmux membatasi **satu** command ±16 KB dan instruksi agen adalah prosa
  — kelas kegagalan SPEC-223, dibayar sekali dan dipakai ulang.
- **codex (historis)** → blok **roster** yang ditempel ke akhir prompt sesi: nama · deskripsi · instruksi ·
  daftar mention tiap agen. Codex **mengadopsi peran secara inline**; tak ada proses kedua.

  Ini bukan penyeragaman yang gagal melainkan pembacaan jujur atas M5. Efek sampingnya justru baik:
  **risiko loop di codex secara struktural nol** karena tak ada pemanggilan sama sekali. Batasnya satu
  fungsi murni (`agentRosterBlock`) — bila codex kelak mendokumentasikan `agent_roles`, yang ditukar
  hanya fungsi itu.

**5. Anti-loop tiga lapis, dari keras ke lunak — dan yang menjamin adalah dua lapis pertama.**
- **Lapis 1 — graf mention wajib ASIKLIK (data, ditegakkan server).** `mentions` hanya boleh menyebut
  agen yang terlihat dari scope-nya (global → global saja; project → project + global). Nama tak
  dikenal → **400**. Setiap mutasi menjalankan `detectCycle()` (fungsi murni) atas graf **efektif**
  dan menolak **409** berikut jalur siklusnya. Pola `dependsOn` (ADR-0093), sengaja.
- **Lapis 2 — kapabilitas (argv, fisik).** M2 membuktikan delegasi butuh `Task`. hanoman **selalu**
  memancarkan `tools` eksplisit dan menurunkan `Task` dari `mentions`, bukan dari ketikan operator:
  `mentions` kosong → `Task` **dicabut** walau operator mengetiknya; `mentions` berisi → `Task`
  ditambahkan. Agen daun karena itu **tak punya alat** untuk memanggil siapa pun. Ini yang membuat
  batas atas kedalaman panggilan menjadi properti graf, bukan properti kepatuhan agen.
- **Lapis 3 — anggaran hop (prosa).** Instruksi tiap agen diakhiri satu paragraf: siapa yang boleh ia
  panggil, dan anggaran `MENTION_MAX_HOPS = 3`. Bukan jaminan — jaminannya lapis 1 & 2 — tapi ia yang
  membuat agen **melapor** alih-alih memanggil lagi saat anggarannya habis. SPEC-432 sudah mengukur
  harganya: agen berbatas yang tak diberi tahu batasnya membakar seluruh anggaran tanpa hasil.

**6. `DEFAULT_AGENT_TOOLS` dan `MENTION_MAX_HOPS` adalah KONSTANTA MODUL, bukan konfigurasi.** Pola
`LEAD_ACTIONS` (ADR-0091). Batas yang bisa disetel dari UI adalah batas yang bisa dimatikan dari UI,
dan lapis 2 adalah satu-satunya lapis yang tak bergantung pada kepatuhan siapa pun.

**7. Wiring hidup di titik cekik `createSession`, lewat sumber yang mendaftarkan diri.** `pty.ts`
tetap **nol dependensi DB**: ia memanggil `registerCustomAgentSource(fn)` — cermin
`registerSessionHooks` (ADR-0079) dan `registerSchedulerSource` (ADR-0072). Karena `createSession`
adalah pintu **satu-satunya** semua kelahiran sesi, tak ada call site yang perlu diubah dan **tak ada
yang bisa lupa memasangnya**. Menyalin resolusinya ke tiap route adalah kelas bug SPEC-431/ADR-0093.
Sumber itu **wajib sinkron** (`createSession` sinkron, Prisma tidak) → cache in-memory yang
di-invalidasi tiap mutasi route **dan** tiap `applyPush` sync, pola `effectiveStr()` (ADR-0049).
Gagal baca → **daftar kosong**; katalog agen tak pernah boleh menggagalkan kelahiran sesi.

**8. Domain capability baru `agents`, dipetakan MENURUT METHOD.** `rw("agents")`, bukan prefix yang
dipetakan ke `GLOBAL_READ` — itu persis lubang yang ditutup SPEC-405/ADR-0088.

## Konsekuensi

- **Berbiaya nol saat tak dipakai.** Katalog kosong → flag/config agent tak dipasang, klausa tak ditempel,
  argv sesi byte-identik dengan sebelum ADR ini.
- Sesi ber-`opts.command` (shell mentah ADR-0056, konsol VPS) tak menerima apa pun — tak ada agen di
  sana.
- *(Historis.)* Sesi **codex tanpa prompt** tak menerima roster. Diterima sadar: satu-satunya jalur berprompt-kosong
  adalah terminal, dan terminal biasa sudah shell mentah.
- *(Historis untuk implementasi awal.)* Custom agent **tak menambah permukaan eksekusi**. Subagent claude berjalan di dalam proses agen yang
  sama, di worktree yang sama, di bawah `--dangerously-skip-permissions` yang sama (ADR-0037). Yang
  bertambah hanya persona dan pembagian konteks.
- Kuotanya menumpang langganan yang sama dan terlihat di badge limit yang sudah ada — konsekuensi yang
  sama dengan hanoman-lead (ADR-0091), bukan akunting terpisah.
- Menghapus project menghapus agen project-nya (`onDelete: Cascade`); menghapus agen mencabut namanya
  dari `mentions` agen lain, supaya tak ada rujukan yatim yang mengunci UI (cermin `DELETE /specs/:id`,
  ADR-0093).

## Gotcha yang wajib diingat

1. **Ketiga permukaan GAGAL-SENYAP, dan verifikasi berbasis exit code LULUS PALSU di ketiganya.**
   `--agents` ber-JSON rusak keluar **exit 0 dengan nol agen** (M3); nama tool tak dikenal **dibuang
   tanpa pesan** (M4); codex menerima kunci `-c` tak dikenal **tanpa keluhan** (M5). Verifikasi hidup
   wajib **menanyai agen apa yang benar-benar ia miliki** — kelas jebakan yang sama dengan
   `paneText.includes("/goal")` di ADR-0085, yang lulus persis untuk degradasi yang mau dideteksi.
2. **Memeriksa graf global saja TIDAK cukup.** Agen project boleh menimpa nama global, jadi `G→H` yang
   asiklik di scope global bisa menjadi `G→H(project)→G` di dalam satu project. Validasi siklus wajib
   berjalan atas scope global **dan setiap project yang punya custom agent**, dan pesan 409 menyebut
   scope mana yang pecah.
3. **`@@unique([projectId, name])` TIDAK mencegah dua agen global bernama sama.** Pada indeks unik
   SQLite, NULL saling berbeda. Yang benar-benar mencegahnya adalah PK deterministik (Keputusan 2);
   indeks itu tinggal jaring kedua untuk baris ber-project. Jangan pernah mengandalkannya sendirian.
4. **`--agents` TIDAK boleh lewat `.map(sq)` seperti flag lain.** Ia harus disisipkan seperti
   `promptArg` — sudah berbentuk `"$(cat …)"` — supaya `sh -c` yang melahirkan sesi meng-expand-nya.
   Di-`sq` sekali saja, agen menerima literal `$(cat /tmp/…)` sebagai definisi agen, dan itu tepat
   kegagalan-senyap M3: nol agen, exit 0.
5. **`Task` yang diketik operator di `tools` HARUS dicabut saat `mentions` kosong.** Allowlist yang
   menang, bukan daftar tool. Membiarkan `tools` kosong juga tak boleh: agen tanpa `tools` mewarisi
   **seluruh** tool termasuk `Task`, dan lapis 2 lenyap tanpa jejak.
6. **Nama tool yang dibuang senyap (M4) aman untuk lapis 2, dan itu bukan kebetulan.** Membuang hanya
   **mengurangi** kemampuan — tak ada jalan bagi konstanta yang basi untuk memberikan `Task`. Karena
   itu `DEFAULT_AGENT_TOOLS` boleh sedikit tertinggal dari versi claude tanpa membuka lubang.
7. **`"customAgent"` wajib ikut `PG_ORDER`** (`cli/src/commands/migrate-pg.ts`) — test DMMF merah
   kalau lupa — dan seluruh kolomnya wajib ada di `FIELDS.customAgent`; `upsert` yang tak menyebut
   kolom ber-default **tetap berhasil**, jadi kolom yang terlewat menyeberang sebagai default palsu
   tanpa satu pun error (kelas ADR-0090/0093).

## Alternatif yang ditolak

- **Berkas `.claude/agents/<name>.md` di worktree.** Konvensi paling dikenal, tapi M6 membuatnya
  berarti "diff worktree tak pernah bersih" — atau menyunting `.git/info/exclude` milik checkout
  operator. `--agents` memberi hasil yang sama tanpa menyentuh satu pun berkas repo.
- **Endpoint `POST /api/custom-agents/:name/invoke` (bus hanoman).** Membuat komunikasi antar-agen
  identik di claude & codex dan menegakkan anti-loop di server lewat rantai panggilan. Ditolak
  operator dan sejalan dengan SPEC-448: ia melahirkan **titik spawn agen ketiga**, dan setiap
  pelajaran spawn di repo ini harus dibayar ulang di tiap titik.
- **`[agent_roles]` codex lewat `-c`.** Akan menyeragamkan kedua agen — tapi M5 membuktikan codex
  menerima kunci tak dikenal tanpa keluhan, jadi tak ada cara membedakan "dipakai" dari "diabaikan".
  Membangun fitur di atas permukaan yang tak bisa diverifikasi adalah bagaimana ADR-0074 butir (b)
  lahir dan harus diamandemen ADR-0085.
- **Menyimpan definisi di `Setting` (kolom `Json`, tanpa migration).** Murah, tapi scope per-project
  tak punya tempat, tak ada `enabled`/stempel waktu per agen, dan seluruh katalog jadi satu nilai yang
  saling menimpa di sync — persis kegagalan yang dicegah Keputusan 2.
- **Deteksi loop hanya saat runtime (penghitung hop di prompt).** Satu-satunya lapis yang tersedia
  kalau graf tak divalidasi, dan seluruhnya bergantung pada kepatuhan agen. Dipakai — sebagai lapis
  **ketiga**, bukan sebagai jaminan.
