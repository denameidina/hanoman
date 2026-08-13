# SPEC-739 — Status & pemasangan skill metode

Design doc. Backlog item SPEC-739 · sumber brief · prioritas tinggi.

## Masalah

SPEC-734/ADR-0113 memasang `MethodDef.requires` di katalog `METHODS`, tetapi field itu punya **nol
pembaca runtime** — hanya dua titik render teks (`src/src/App.tsx` picker Start, `SettingsScreen.tsx`
kartu Metode) yang menuliskannya apa adanya. `hanoman doctor` memeriksa node/git/tmux/claude/codex/gh
dan tak menyentuh skill sama sekali. hanoman karena itu **menjanjikan metodologi yang tak pernah ia
pastikan ada**.

Konsekuensinya sudah berjalan diam-diam sejak ADR-0074: skill yang hilang tidak mematikan sesi
(`Unknown skill: …` adalah tool error; agen lanjut), tetapi **gerbangnya ikut mati** — instruksi
"tulis plan berkotak" datang dari skill fase Plan, dan `superpowers:verification-before-completion`
(INVARIAN 2 ADR-0113) jadi no-op bila paketnya tak terpasang. Katalog menjamin gerbang itu
**disebut** di prompt; ia tak menjamin gerbang itu **ada**.

## Keadaan terukur (2026-08-13, mesin dev)

Diukur ulang saat brainstorm — **dua temuan mengoreksi premis brief**.

| Agen | Akar | Isi |
|---|---|---|
| claude | `~/.claude/skills/` | 3 skill user (`investigating-with-uptrace`, `context7-mcp`, `hanoman`) |
| claude | `~/.claude/plugins/cache/superpowers-marketplace/superpowers/6.0.3/skills/` | **14 skill superpowers** |
| claude | `~/.claude/plugins/cache/ponytail/ponytail/4.8.4/skills/` | plugin **disabled** (`settings.json` → `enabledPlugins["ponytail@ponytail"] = false`) |
| codex | `~/.codex/skills/` | `dena-raw-video-edit`, `hanoman` (+ `.system/` milik codex) |
| codex | `~/.codex/plugins/cache/openai-curated/superpowers/11c74d6b/skills/` | **14 skill superpowers**, `installed, enabled` |

**Koreksi 1 — codex punya DUA akar, bukan satu.** Brief menyatakan "codex = `~/.codex/skills/*/`"
dan bahwa `find ~/.codex -iname "*superpower*"` kosong. Pada mesin ini `codex plugin list` menjawab
`superpowers@openai-curated  installed, enabled  11c74d6b`, dan `~/.codex/config.toml` memuat
`[plugins."superpowers@openai-curated"] enabled = true`. Deteksi yang hanya memindai
`~/.codex/skills/` akan melaporkan superpowers **kurang** untuk codex di mesin yang sebenarnya
sehat — salah-negatif, persis kelas yang dilarang constraint "DETEKSI FAIL-OPEN". Karena itu kedua
agen dipindai **simetris**: `<home>/skills/*` ∪ plugin cache ∪ manifest.

**Koreksi 2 — "terpasang" belum tentu "aktif".** Kedua agen menyatakan gerbang enable/disable dalam
bentuk yang sama, `"<plugin>@<marketplace>": bool` — claude di `~/.claude/settings.json`
(`enabledPlugins`), codex di `~/.codex/config.toml` (`[plugins."x@y"] enabled`). `ponytail` di mesin
ini ada lengkap di cache **dan disabled**. Deteksi wajib menghormatinya, kalau tidak ia mengulang
kebohongan yang justru diperbaiki spec ini.

`mattpocock-skills` tak terpasang di keduanya — tetap benar.

## Prinsip yang mengikat bentuknya

1. **Fail-open adalah sifat GERBANG, bukan sifat VONIS.** "Ragu → jangan blokir" berarti Start tak
   pernah ditolak. Ia **tidak** berarti "ragu → anggap terpasang": vonis optimistis palsu adalah
   persis kegagalan senyap yang spec ini ada untuk menghapus. Maka pencocokan skill **ketat & id
   persis**; yang longgar hanyalah akibatnya (ditandai, tak pernah menolak).
2. **Tanpa status di DB.** Diturunkan dari disk tiap request, cermin coverage docs (ADR-0011/0018).
   Nol model baru ⇒ nol kolom `FIELDS` sync ⇒ properti MESIN tetap milik mesin.
3. **Server tak memasang apa pun.** Tombol melahirkan **sesi terminal** (ADR-0056); yang menjalankan
   perintah adalah shell di dalam pane tmux, ditonton operator. Nol executor baru (ADR-0037 utuh),
   nol protokol restart (ADR-0088 tak disentuh).
4. **Perintah instalasi adalah data katalog.** Ia hidup di `METHODS` bersama `requires`. Metode
   ketiga = satu entri; nol sunting di server/web (AC-10 ADR-0113).

## Bentuk

### 1 · `runner/src/skills.ts` (baru) — deteksi

Duduk di `runner` karena di situlah "library, bukan proses" yang dipakai **server dan CLI**
(preseden `paths.ts`: `resolveHome`/`resolveDbUrl` dipakai `server` + `cli/src/commands/doctor.ts`).
`shared` tak bisa: ia ikut ter-bundle ke web, dan modul ini membaca `node:fs`.

```ts
export interface InstalledSkill {
  id: string;          // "superpowers:brainstorming" (plugin) | "hanoman" (skill user)
  name: string;        // segmen terakhir
  pkg: string | null;  // null = skill user, tanpa paket
  dir: string;         // bukti: direktori yang memuat SKILL.md
}
export interface AgentSkills {
  agent: Agent;
  home: string;                  // akar yang dipindai (sesudah override env)
  roots: string[];               // direktori skill yang benar-benar ada
  skills: InstalledSkill[];
  packages: string[];            // nama plugin aktif yang punya skill
}
export function agentSkillHome(agent: Agent, env?: NodeJS.ProcessEnv): string;
export function scanAgentSkills(agent: Agent, env?: NodeJS.ProcessEnv): AgentSkills;
```

Akar & override env (cermin `HANOMAN_CLAUDE_BIN`/`HANOMAN_CODEX_BIN`):

| agen | urutan resolusi |
|---|---|
| claude | `HANOMAN_CLAUDE_HOME` → `~/.claude` |
| codex | `HANOMAN_CODEX_HOME` → `CODEX_HOME` → `~/.codex` |

`CODEX_HOME` ikut dihormati karena codex sendiri memakainya dan hanoman sudah membacanya di dua
tempat (`codex-limits.ts`, `codex-trust.ts`); `HANOMAN_*` menang supaya test tak pernah bergantung
pada env agen nyata.

Sumber di dalam satu akar:

1. **Skill user** — `<home>/skills/<name>/SKILL.md` → id `<name>`, `pkg: null`. Direktori berawalan
   titik dilewati (`~/.codex/skills/.system/` adalah skill bawaan codex, bukan milik metode).
2. **Plugin dari manifest** — `<home>/plugins/installed_plugins.json`, `plugins["<pkg>@<mkt>"][]
   .installPath` → `<installPath>/skills/<name>/SKILL.md`.
3. **Plugin dari cache** — `<home>/plugins/cache/<mkt>/<pkg>/<versi>/skills/<name>/SKILL.md`.

(2) dan (3) di-union: manifest menangkap plugin yang dipasang di luar cache, cache menangkap agen
yang tak punya manifest (codex). Keduanya menghasilkan id `<pkg>:<name>`.

Gerbang aktif — sebuah plugin dilewati **hanya bila dinyatakan nonaktif**:

- claude: `~/.claude/settings.json` → `enabledPlugins["<pkg>@<mkt>"] === false`
- codex: `~/.codex/config.toml` → `[plugins."<pkg>@<mkt>"]` … `enabled = false`

Absen ⇒ dianggap aktif. Berkas hilang/rusak ⇒ dianggap aktif (tak bisa membuktikan nonaktif). TOML
dibaca dengan regex sempit atas dua baris itu saja — menyeret parser TOML ke `runner` demi satu
boolean tak sepadan, dan `config.toml` mesin ini 62 KB berisi ratusan blok `[projects."…"]` yang tak
ada urusannya dengan kita.

Seluruh IO **fail-open per-langkah**: direktori tak ada / tak bisa dibaca / JSON rusak → sumber itu
menyumbang nol skill, bukan lemparan. Satu akar rusak tak boleh mengosongkan akar lain.

### 2 · `shared/src/method-status.ts` (baru) — vonis murni

Perbandingan katalog ↔ hasil deteksi adalah fungsi murni, dan ia dipakai server **dan** web (badge
di picker Start memakai bentuk yang sama). Karena murni, ia duduk di `shared` dan tak menyentuh fs.

```ts
export interface MethodSkillStatus {
  method: string; label: string; agent: Agent;
  ready: boolean;
  missingPackages: string[];   // dari MethodDef.requires — nama PAKET
  missingSkills: string[];     // dari phaseSkills ∪ exitSkills — id SKILL yang dipanggil prompt
  install: string[];           // perintah dari katalog, untuk agen ini
}
export function methodSkills(m: MethodDef): string[];              // union phaseSkills+exitSkills, ter-dedup
export function methodStatus(m: MethodDef, agent: Agent,
  installed: { skills: string[]; packages: string[] }): MethodSkillStatus;
```

`ready = missingPackages.length === 0 && missingSkills.length === 0`.

Dua daftar dilaporkan **terpisah dan keduanya wajib**, persis seperti diminta brief: butir `requires`
adalah **nama paket** (`"superpowers"`), sementara yang benar-benar dipanggil prompt adalah **id
skill** (`"superpowers:brainstorming"`). Paket bisa terpasang dengan skill yang dibutuhkan absen
(versi lebih tua), dan sebaliknya tak pernah terjadi — dua pertanyaan, dua jawaban.

**Pencocokan ketat.** `superpowers:brainstorming` cocok hanya dengan id yang persis sama. Skill user
bernama `brainstorming` **tidak** dianggap memuaskannya: ia beralamat `brainstorming`, bukan
`superpowers:brainstorming`, jadi prompt yang memanggil id berprefiks tetap akan gagal. Ini
konsekuensi langsung Prinsip 1 — dan ia punya harga yang dinyatakan: instalasi datar (mis.
`npx skills@latest add mattpocock/skills` yang menaruh skill langsung di `~/.codex/skills/<name>/`)
akan dilaporkan kurang, karena memang begitulah prompt akan melihatnya.

### 3 · `MethodDef.install` — perintah di katalog

```ts
/** Perintah instalasi per agen, dijalankan di SESI TERMINAL. Server tak pernah menjalankannya. */
readonly install: Readonly<Record<Agent, readonly string[]>>;
```

Isi awal (diverifikasi terhadap CLI terpasang, bukan ingatan — `claude plugin --help`,
`codex plugin add --help`, README `mattpocock/skills`):

| metode | claude | codex |
|---|---|---|
| superpowers | `claude plugin marketplace add obra/superpowers-marketplace` · `claude plugin install superpowers@superpowers-marketplace` | `codex plugin add superpowers@openai-curated` |
| matt | `claude plugin install mattpocock-skills` · `claude plugin marketplace add obra/superpowers-marketplace` · `claude plugin install superpowers@superpowers-marketplace` | `npx skills@latest add mattpocock/skills` · `codex plugin add superpowers@openai-curated` |

`matt` ikut memasang superpowers karena `requires`-nya memang menyebutnya — gerbang verifikasinya
dipinjam dari sana (INVARIAN 2). Perintah `marketplace add` disertakan lebih dulu dan idempoten di
kedua CLI; `mattpocock-skills` ada di marketplace resmi Claude Code sehingga tak butuh `add`.

Test sumber (pola SPEC-490/AC-7) mengikat: setiap entri `METHODS` wajib punya `install` non-kosong
untuk **kedua** agen, dan setiap perintah wajib menyebut sedikitnya satu butir `requires`-nya.

### 4 · `GET /api/methods/status` — endpoint baca

```ts
{
  agents: [{ agent: "claude"|"codex", home: string, roots: string[], skills: number }],
  methods: MethodSkillStatus[]        // |METHOD_IDS| × 2 agen
}
```

Diturunkan **live tiap request**, nol tabel, nol kolom. Model `Prisma` tak bertambah ⇒ tak ada yang
bisa ditambahkan ke `FIELDS` sync bahkan bila seseorang mau (cermin `LocalBinding`/`repoDir`/
`Project.autoMerge` — properti mesin, bukan properti workspace).

Capability: `capabilityForRoute` tak mengenal `methods` → `null` → **COOKIE_ONLY**, persis seperti
`GET /codex/version` yang preseden bentuknya. Tak ada alasan agent token perlu membacanya.

### 5 · Pemasangan lewat sesi terminal

Varian shell `POST /terminal/sessions` diperluas **satu field opsional**:

```ts
z.object({ project: z.string(), shell: z.literal(true),
           install: z.object({ method: z.string(), agent: zAgent }).optional() })
```

Klien mengirim **metode + agen**, bukan teks perintah; server menurunkan perintahnya dari katalog.
Dengan begitu "perintah instalasi adalah data katalog" berlaku ujung ke ujung — UI tak pernah
memegang literal perintah, dan endpoint tak pernah menjadi "jalankan shell arbitrer".

Metode tak dikenal di sini → **400**, sengaja menyimpang dari `resolveMethod` yang lenient: resolusi
lenient benar untuk **membaca** (id dari hub harus jatuh diam ke default), tetapi ini **tindakan** —
memasang superpowers karena operator meminta metode yang tak dikenal adalah menjalankan perintah yang
tak diminta siapa pun.

Eksekusi: `createSession(project.id, repoDir, { command: [shellBin(), "-lc", script] })` dengan
`script` = perintah katalog dirangkai `&&`, diakhiri `exec <shellBin> -l` supaya pane tetap hidup
untuk diperiksa operator (dan `remain-on-exit on` tetap menahan pane bila shell-nya mati). Jalur
`createSession({command})` **sudah** ada dan tak berubah — yang bertambah hanya isi `command`.

### 6 · Dashboard

**Settings → tab Sesi → kartu "Metode workflow"** (yang sudah ada). Baris statis
`Butuh terpasang: …` diganti checklist per **metode × agen**: tanda siap/kurang, sebab spesifik
(paket kurang & id skill kurang, terpisah), dan tombol **Pasang** yang melahirkan sesi terminal.
Tombol butuh project yang ter-bind ke checkout lokal → kartu memuat pemilih project kecil
(default: project pertama). Tanpa project ter-bind, tombol nonaktif dengan sebabnya.

**Picker Start (`StartSessionModal`)**. Baris statis yang sama diganti catatan status untuk
**metode terpilih × agen terpilih** — modal ini sudah punya kedua state, jadi peringatannya bisa
menyebut agen tanpa menebak. Metode belum siap **tidak** memblokir Start: tombol Mulai tetap hidup,
cermin persis catatan versi codex SPEC-339 (`codex-version-note`) yang juga hanya memperingatkan.

Peringatan **wajib menyebut agen** di seluruh jalur — superpowers bisa siap untuk claude dan kosong
untuk codex di mesin yang sama.

### 7 · `hanoman doctor`

`Probes` bertambah `methods: MethodSkillStatus[]`; `doctorReport` tetap **murni** (probe → laporan).
Yang dilaporkan hanya **metode default** (`DEFAULT_METHOD`), dan hanya untuk agen yang CLI-nya
memang terpasang — melaporkan metode codex di mesin tanpa codex adalah derau. Tak siap → baris
bertanda `!` **non-fatal** (`fatal: false`), sejajar dengan cara `web` melaporkan aset dashboard yang
hilang, diikuti perintah pemasangannya:

```
  ! metode superpowers · codex — belum siap: superpowers:brainstorming, …
      codex plugin add superpowers@openai-curated
```

## Yang TIDAK dikerjakan

Di luar scope, dinyatakan supaya tak merayap: memasang plugin untuk agen di mesin lain (VPS/klien
sync), memilih versi/marketplace lewat UI, mengunci sesi supaya menolak lahir saat skill kurang,
memasang skill sebagai bagian dari `hanoman start`, dan menambah cermin `requires` di mana pun —
katalognya tetap tunggal di `shared/src/method-catalog.ts` dan di-**impor** runner.

## Verifikasi

Bukti "terpasang/tak terpasang" **selalu** dari akar yang disuntik test lewat env
(`HANOMAN_CLAUDE_HOME`/`HANOMAN_CODEX_HOME` → direktori sementara), **tidak pernah** dari HOME mesin
yang menjalankan test — kalau tidak, hijau/merah bergantung pada siapa yang menjalankannya. Setiap
test deteksi merakit pohon direktorinya sendiri (`skills/<n>/SKILL.md`, `plugins/cache/…`,
`settings.json`, `config.toml`) dan membongkarnya lagi.

## ADR

Butuh ADR baru: **ADR-0114** — status pemasangan skill sebagai nilai turunan LOCAL-only, dan
pemasangan lewat sesi terminal alih-alih executor server.
