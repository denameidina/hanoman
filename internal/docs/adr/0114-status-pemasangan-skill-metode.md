# ADR-0114 — Status pemasangan skill metode: deteksi per agen LOCAL-only, pemasangan lewat sesi terminal

- Status: Accepted
- Tanggal: 2026-08-13
- SPEC: SPEC-739
- Terkait: **melengkapi** [0113](0113-registry-metode-workflow.md) (`MethodDef.requires` akhirnya
  punya pembaca runtime, dan katalognya ikut membawa perintah pemasangan);
  memakai [0056](0056-terminal-shell-non-claude.md) (shell mentah di `repoDir` project) sebagai
  satu-satunya pemasang; **menegakkan** [0011](0011-docs-realtime-filesystem.md)/[0018](0018-coverage-nilai-turunan.md)
  (nilai turunan, bukan kolom), [0037](0037-cabut-guardrail-safety.md) (mengarahkan, bukan menolak),
  [0087](0087-distribusi-npm-global-satu-perintah.md) & [0088](0088-tombol-update-npm-restart-tersupervisi.md)
  (server tak pernah memasang apa pun — yang memasang adalah proses di luar server).

## Konteks

ADR-0113 memasang `MethodDef.requires` di katalog `METHODS`, tetapi field itu punya **nol pembaca
runtime**: hanya dua titik render teks (`src/src/App.tsx` picker Start, `SettingsScreen.tsx` kartu
Metode) yang mencetaknya apa adanya. `hanoman doctor` memeriksa node/git/tmux/claude/codex/gh dan
tak menyentuh skill sama sekali. hanoman karena itu **menjanjikan metodologi yang tak pernah ia
pastikan ada**.

Konsekuensinya sudah berjalan diam-diam sejak ADR-0074 (codex jadi mesin sesi), jauh sebelum
SPEC-734. Skill yang hilang **tidak** mematikan sesi — dibuktikan in-vivo, memanggil skill yang tak
terpasang menjawab `Unknown skill: …` sebagai tool error dan agen lanjut. Yang berbahaya justru itu:
gagalnya senyap, dan **gerbangnya ikut mati**.

1. Instruksi "tulis plan berkotak" datang dari skill fase Plan (`writing-plans`/`to-tickets`), bukan
   dari `phaseInstruction` yang hanya MENDESKRIPSIKAN gerbangnya. Tanpa skill itu agen bisa tak
   pernah menulis berkas plan, lalu `planComplete` tak menemukan berkas cocok dan mengembalikan
   `true` HAMPA → backlog mencapai `done` tanpa plan sama sekali. Semantik "tak ada plan cocok = tak
   ada checklist untuk digerbang" itu lama dan sah (fast-path qa, ADR-0029/0040), tapi kini bisa
   dipicu **instalasi yang kurang**, bukan hanya keputusan yang sah.
2. `superpowers:verification-before-completion` ada di `exitSkills` KEDUA metode. Bila superpowers
   tak terpasang, INVARIAN 2 ADR-0113 — yang dibangun persis supaya pintu keluar "tak bisa
   dinegosiasikan" — jadi **no-op**. Katalog menjamin gerbang itu DISEBUT di prompt; ia tak menjamin
   gerbang itu ADA.

### Keadaan terukur (mesin dev, 2026-08-13) — dua koreksi atas premis brief

| Agen | Akar | Isi |
|---|---|---|
| claude | `~/.claude/skills/` | 3 skill user |
| claude | `~/.claude/plugins/cache/superpowers-marketplace/superpowers/6.0.3/skills/` | 14 skill superpowers |
| claude | `~/.claude/plugins/cache/ponytail/ponytail/4.8.4/skills/` | plugin ada di cache **dan disabled** |
| codex | `~/.codex/skills/` | `dena-raw-video-edit`, `hanoman` (+ `.system/` milik codex) |
| codex | `~/.codex/plugins/cache/openai-curated/superpowers/11c74d6b/skills/` | **14 skill superpowers**, `installed, enabled` |

**Koreksi 1 — codex punya DUA akar, bukan satu.** Brief menyatakan "codex = `~/.codex/skills/*/`"
dan bahwa `find ~/.codex -iname "*superpower*"` kosong. Pada mesin ini `codex plugin list` menjawab
`superpowers@openai-curated  installed, enabled  11c74d6b`, dan `~/.codex/config.toml` memuat
`[plugins."superpowers@openai-curated"] enabled = true`. Deteksi yang hanya memindai
`~/.codex/skills/` melaporkan superpowers **kurang** di mesin yang sebenarnya sehat.

**Koreksi 2 — "terpasang" belum tentu "aktif".** Kedua agen menyatakan gerbang enable/disable dalam
bentuk yang sama, `"<plugin>@<marketplace>": bool` — claude di `~/.claude/settings.json`
(`enabledPlugins`), codex di `~/.codex/config.toml` (`[plugins."x@y"] enabled`). `ponytail` di mesin
ini ada lengkap di cache **dan disabled**; menghitungnya sebagai terpasang mengulang kebohongan yang
justru diperbaiki spec ini.

## Keputusan

### 1 · Deteksi di `runner/src/skills.ts`, akar bisa di-override env

Duduk di `runner` karena di situlah library node-only yang dipakai server **dan** CLI (preseden
`paths.ts`). `shared` tak bisa: ia ikut dibundel Vite ke browser.

| agen | urutan resolusi akar |
|---|---|
| claude | `HANOMAN_CLAUDE_HOME` → `~/.claude` |
| codex | `HANOMAN_CODEX_HOME` → `CODEX_HOME` → `~/.codex` |

`HANOMAN_*_HOME` mencerminkan `HANOMAN_CLAUDE_BIN`/`HANOMAN_CODEX_BIN` dan **menang** atas
`CODEX_HOME`: test tak boleh bergantung pada env agen nyata, sementara `CODEX_HOME` tetap dihormati
karena codex sendiri memakainya (`codex-limits`, `codex-trust`).

Tiga sumber di dalam satu akar, di-union: skill user `<home>/skills/<n>/SKILL.md` (id `<n>`,
tanpa paket) · plugin dari manifest `plugins/installed_plugins.json` → `installPath` · plugin dari
cache `plugins/cache/<mkt>/<pkg>/<versi>/` (id `<pkg>:<n>`). Manifest menangkap plugin yang dipasang
di luar cache; cache menangkap agen yang tak punya manifest (codex). Plugin dilewati **hanya bila
dinyatakan nonaktif** — absen ⇒ aktif, karena berkas gerbangnya boleh saja tak ada sama sekali.

#### Amandemen 2026-08-13 — dua false negative terukur, keduanya asumsi bentuk

Vonis pertama di mesin operator salah pada **kedua** metode non-superpowers. Bukan kesalahan
pencocokan (§2 tetap utuh), melainkan pemindai yang tak menemukan berkas yang benar-benar ada.

**(a) Layout plugin tak selalu datar.** `skillsUnder` mengandaikan `skills/<n>/SKILL.md`.
`mattpocock-skills` (v1.2.3, terpasang lewat `claude plugin install mattpocock-skills` dari
marketplace `mattpocock` = repo `mattpocock/skills`) menyusunnya **per kategori** —
`skills/engineering/tdd/`, `skills/productivity/grilling/`. Yang terlihat cuma dua direktori tanpa
`SKILL.md` → **nol skill, paketnya bahkan tak masuk daftar**, padahal `.claude-plugin/plugin.json`
menyebut ke-25 path itu eksplisit di `skills[]` dan tak pernah kita baca. Sekarang: **manifest
`skills[]` lebih dulu** (`.claude-plugin/` ∪ `.codex-plugin/`, entri boleh menunjuk direktori atau
`SKILL.md`-nya), jatuh ke pemindaian direktori **sedalam dua tingkat** bila plugin tak menyatakannya.
Direktori yang **sudah** jadi skill tak ditembus: `skills/<n>/agents/` itu berkas pendukung.

**(b) codex punya akar KETIGA: `~/.agents/skills`.** Koreksi 1 di atas ternyata masih kurang satu.
`npx skills@latest add …` (paket npm `skills`, bin `skills`/`add-skill`) tak menyentuh
`~/.codex/skills` sama sekali — ia memasang **datar** ke `~/.agents/skills/<n>/`, akar lintas-agen.
codex membacanya: binary 0.147.0 memuat `codex_skills/src/host_roots.rs` yang menyebut `.agents`
berdampingan dengan `.codex/skills`. Akar ini **khusus codex** — claude tak membacanya, jadi
menghitungnya untuk claude akan jadi hijau palsu. Akarnya ber-env sendiri, `HANOMAN_AGENTS_HOME`,
bukan turunan `agentSkillHome`: ia bukan milik satu agen.

| agen | akar | env |
|---|---|---|
| claude | `~/.claude` | `HANOMAN_CLAUDE_HOME` |
| codex | `~/.codex` | `HANOMAN_CODEX_HOME` → `CODEX_HOME` |
| codex | `~/.agents` | `HANOMAN_AGENTS_HOME` |

### 2 · Fail-open adalah sifat GERBANG, bukan sifat VONIS

Ini kebalikan INVARIAN 1 ADR-0113 dan itu disengaja: gerbang plan menjawab "apakah pekerjaan
selesai" (ragu = tahan), deteksi skill menjawab "apakah lingkungan siap" (ragu = **jangan blokir**).
Metode yang belum siap **ditandai, tak pernah menolak Start**.

Tetapi "jangan blokir" **bukan** "anggap terpasang". Vonis optimistis palsu adalah persis kegagalan
senyap yang spec ini ada untuk menghapus, jadi pencocokan skill **ketat & id persis**:
`superpowers:brainstorming` cocok hanya dengan id yang sama. Skill user bernama `brainstorming`
beralamat `brainstorming`, bukan `superpowers:brainstorming` — prompt yang memanggil id berprefiks
tetap akan gagal.

**Amandemen 2026-08-13 — yang bertambah adalah BUKTInya, bukan kelonggarannya.** Semula instalasi
datar dinyatakan "dilaporkan kurang selamanya", yang berarti metode `matt` tak akan pernah bisa hijau
di codex. Ternyata `npx skills add` meninggalkan `~/.agents/.skill-lock.json` yang mencatat
`pluginName` **per skill** (`tdd` → `mattpocock-skills`, beserta `sourceUrl` & `skillPath` asalnya).
Itu bukti asal-usul, bukan tebakan, jadi pemindai menerbitkan **dua** id untuk berkas yang sama:
`mattpocock-skills:tdd` (yang dipanggil prompt metode) dan `tdd` (yang dilihat codex di direktori
datar). Menerbitkan satu saja membuat salah satu sisi berbohong. Tanpa lock → tetap nama polos,
tetap tanpa paket: **nama tak pernah dinaikkan pangkat dengan menebak.**

Fail-open yang berlaku adalah **per sumber IO**: direktori hilang / JSON rusak / izin ditolak
membuat satu sumber menyumbang nol skill, tak pernah melempar dan tak pernah mengosongkan sumber lain.

### 3 · Dua daftar dilaporkan, keduanya wajib

`MethodDef.requires` adalah nama **PAKET**; yang benar-benar dipanggil prompt adalah id **SKILL**
(`phaseSkills` ∪ `exitSkills`). Paket terpasang dengan skill yang dibutuhkan absen adalah keadaan
nyata (versi lebih tua) — dua pertanyaan, dua jawaban. `methodStatus()` (murni, di `shared`)
mengembalikan `missingPackages` dan `missingSkills` terpisah.

### 4 · Status LOCAL-only, nol tabel: `GET /api/methods/status`

Diturunkan **live tiap request** dari disk. Kolom status instalasi akan basi persis pada saat ia
paling menyesatkan — sesudah operator memasang skill yang kurang (cermin coverage docs
ADR-0011/0018). Nol model Prisma baru ⇒ tak ada yang bisa ditambahkan ke `FIELDS` sync bahkan bila
seseorang mau: ini properti **MESIN**, bukan properti workspace (cermin `LocalBinding`/`repoDir`/
`Project.autoMerge`). `capabilityForRoute` tak mengenal prefix `methods` → **cookie-only**, seperti
`GET /codex/version` yang preseden bentuknya.

### 5 · Perintah instalasi adalah data katalog

`MethodDef.install: Record<Agent, readonly string[]>`, hidup di `METHODS` bersama `requires`. Kalau
tidak, menambah metode ketiga kembali menuntut sunting di server/web — persis yang dihapus ADR-0113
(AC-10). Diikat test SUMBER (pola SPEC-490): setiap metode wajib punya perintah non-kosong untuk
**kedua** agen, dan tiap perintah wajib menyebut sedikitnya satu butir `requires`-nya.

### 6 · Pemasangan lewat SESI TERMINAL, tak pernah oleh server

Varian shell `POST /terminal/sessions` (ADR-0056) diperluas satu field opsional
`install?: { method, agent }`. Klien mengirim **metode + agen**, bukan teks perintah; server
menurunkan perintahnya dari katalog. Dengan begitu "perintah instalasi adalah data katalog" berlaku
ujung ke ujung, dan endpoint ini tak pernah menjadi "jalankan shell arbitrer".

Yang menjalankan perintah adalah shell di dalam pane tmux, ditonton operator. ADR-0087 menolak
alternatif "server meng-install dirinya sendiri" dan ADR-0088 memindahkan pemasangan ke CLI
supervisor justru karena itu; pemasang bukan-server berarti **nol executor baru** — ADR-0037 utuh —
dan tak ada protokol restart untuk sesuatu yang tak butuh restart.

### 7 · `hanoman doctor` melaporkannya, non-fatal

Metode **default** saja (itu yang dipakai sesi tanpa pilihan), dan hanya untuk agen yang CLI-nya
memang terpasang — melaporkan metode codex di mesin tanpa codex cuma derau. Tak siap → baris `!`
dengan sebabnya **dan perintah pemasangannya**, sejajar dengan cara aset dashboard yang hilang
dilaporkan. `doctorReport` tetap murni (probe → laporan).

## Alternatif yang ditolak

- **Menyimpan status di kolom DB, di-refresh berkala.** Basi persis ketika paling menyesatkan, dan
  menambah model untuk properti yang bukan milik workspace (ADR-0011/0018).
- **Server memasang sendiri lewat `execFile`.** Ditolak ADR-0087, dibalikkan bentuknya oleh ADR-0088;
  menambah executor kedua di server juga menyerempet ADR-0037 yang menetapkan worktree sebagai
  satu-satunya batas.
- **Memblokir Start saat metode belum siap.** Tata letak instalasi bisa berubah di versi CLI mana
  pun; deteksi yang salah-negatif lalu memblokir akan menghentikan kerja yang sebenarnya sehat.
- **Pencocokan longgar (nama skill tanpa paket ikut dihitung).** Mengembalikan vonis optimistis palsu
  — kelas kegagalan yang justru dihapus spec ini.
- **Menyatukan status jadi satu bit "skill terpasang".** Gejala paling mahal spec ini lahir persis
  dari mengira "terpasang" adalah bit global.
- **Parser TOML penuh di `runner` untuk membaca `config.toml` codex.** Berkasnya puluhan KB berisi
  ratusan blok `[projects."…"]`; yang dibaca satu boolean.

## Konsekuensi

- `MethodDef` bertambah satu field wajib → entri metode baru tak bisa lahir tanpa perintah
  pemasangan (dijaga test sumber).
- `requires` akhirnya punya pembaca runtime: nilainya kini menggerakkan checklist, peringatan
  picker, dan doctor.
- Tanpa migration, tanpa model baru, tanpa entri `FIELDS` sync.
- Klien lama (`createShell(project)` tanpa `install`) byte-identik dengan sebelumnya.

## Gotcha

1. **Cermin `MethodAgent` di `method-catalog.ts`.** Berkas itu sengaja bebas impor, dan `entities.ts`
   mengimpor `DEFAULT_METHOD` darinya — impor balik menutup lingkaran. Cerminnya tak bisa hanyut:
   `method-status.test.ts` mengadu kunci `install` dengan `zAgent.options`.
2. **Metode tak dikenal di jalur install → 400, sengaja TIDAK lenient** seperti `resolveMethod`.
   Resolusi longgar benar untuk MEMBACA (id dari hub jatuh diam ke default), tapi ini **tindakan**:
   memasang default karena metodenya tak dikenal berarti menjalankan perintah yang tak diminta
   siapa pun.
3. **Direktori berawalan titik dilewati.** `~/.codex/skills/.system/` adalah skill bawaan codex
   (nested satu tingkat), bukan milik metode mana pun.
4. **Bukti test wajib dari akar ber-env.** Membaca HOME mesin yang menjalankan test membuat
   hijau/merah bergantung siapa yang menjalankannya.
5. **`exec` di ujung skrip pemasangan disengaja.** Pemasangan yang gagal harus meninggalkan shell
   hidup di tempat kejadian, dan `npx skills add` (jalur mattpocock di codex) memang interaktif.
6. **Mock parsial di test web.** Kedua permukaan picker kini menanyakan `getMethodStatus`; 18 berkas
   test yang me-mock `api` sebagian harus ikut menyebutnya, kalau tidak `useEffect`-nya melempar
   dan kegagalannya terbaca seperti regresi komponen.
