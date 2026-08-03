# SPEC-517 — Pilih runtime claude/codex saat buat sesi terminal baru

**Tanggal:** 2026-08-04 · **Source:** brief · **Prioritas:** tinggi
**Status:** design disetujui (pipeline sesi — checkpoint review bukan titik berhenti)

## Masalah

Halaman Terminal punya tombol **“Sesi baru”** yang langsung men-`POST /terminal/sessions {project}`
tanpa satu pun pertanyaan. Server menjawabnya di cabang terakhir route (`routes/terminal.ts:286-291`)
dengan `sessionAgentDefaults()` — **default global apa adanya**. Operator yang ingin membuka satu
terminal codex sementara default globalnya claude (atau sebaliknya) harus mengubah Settings dulu,
yang berarti mengubahnya untuk **semua** sesi baru di seluruh workspace, lalu mengembalikannya.

Kemampuannya sendiri sudah ada sejak ADR-0074: sesi backlog boleh meng-override `agent` per sesi
lewat `StartSessionModal`, dan `createSession` sudah merakit argv untuk kedua agen. Yang hilang
hanya **pintunya** di jalur terminal biasa.

## Objective

Form pembuatan sesi terminal baru menyediakan pemilihan runtime (claude / codex) beserta model dan
effort yang relevan untuk runtime terpilih. Pilihan itu ikut ke `POST /terminal/sessions` dan jadi
argv pane tmux saat sesi lahir. Tanpa memilih apa pun, perilaku hari ini utuh: default global.

## Scope

**Masuk:**
- Tombol “Sesi baru” di halaman Terminal → modal pemilih runtime/model/effort sebelum sesi lahir.
- Varian `{project}` (terminal agen biasa) di `POST /terminal/sessions` menerima
  `agent?`/`model?`/`effort?` opsional.
- “Mulai lagi” dari Riwayat untuk baris ber-`kind: "terminal"` memakai runtime baris itu
  (`SessionHistory` sudah menyimpan `agent`/`model`/`effort` sejak ADR-0079 — kolomnya ada,
  nilainya tercatat, dan sampai sekarang tak pernah dibaca kembali).

**Keluar (sengaja):**
- Sesi project-level (`reverse`/`scaffold`/`prd`/`breakdown`) dan sesi penyelesai konflik tetap
  mengikuti default global (ADR-0074/ADR-0081 utuh). Objective menyebut “sesi terminal baru”, dan
  memberi picker ke lima pintu lain adalah fitur lain dengan permukaan UI-nya sendiri.
- “Terminal biasa” (shell mentah, ADR-0056) tak tersentuh — tak ada agen di sana.
- Tak ada knob Settings baru, tak ada kolom DB baru, tak ada endpoint baru.

## Keputusan: tanpa ADR baru

Tidak ada perubahan skema, endpoint, maupun arah arsitektur. Yang terjadi adalah **ADR-0061**
(“model & effort per sesi, picker saat Start”) diperluas ke satu call site yang belum punya picker,
dan satu klausa ADR-0074 (“sesi project-level *dan terminal* tak punya override”) menyempit menjadi
“sesi project-level tak punya override”. Keduanya dicatat di `api-contract.md` dan
`internal/skills/hanoman/SKILL.md` dalam commit yang sama.

## Arsitektur

### 1. Kontrak (`shared/src/dto.ts`)

`zTerminalSession` adalah `z.union` yang **berurutan** dan objek-objeknya non-strict (key asing
dibuang). Hari ini satu varian melayani dua bentuk sekaligus:

```ts
z.object({ project: z.string(), flow: z.literal("reverse").optional() })   // plain + reverse
```

Varian itu dipecah dua, karena hanya yang plain yang boleh menerima override:

```ts
// reverse: sesi project-level, tetap tanpa picker (ADR-0074)
z.object({ project: z.string(), flow: z.literal("reverse") }),
…
// terminal agen biasa + override runtime per sesi (SPEC-517). `flow: z.undefined()` BUKAN hiasan:
// tanpa gerbang itu, varian permisif ini akan menelan body flow yang cacat (mis. {project,
// flow:"prd"} tanpa brief) dan melahirkan terminal biasa secara SENYAP alih-alih menjawab 400.
z.object({
  project: z.string(), flow: z.undefined(),
  agent: zAgent.optional(), model: z.string().optional(), effort: z.string().optional(),
}),
```

`model`/`effort` tetap `z.string()` longgar, persis seperti varian `spec` — katalog di
`@hanoman/shared` adalah kurasi UI, bukan gerbang validasi (`coerceCodexEffort` di `createSession`
tetap titik cekik tunggalnya, SPEC-339).

### 2. Resolusi default (`server/src/services/settings.ts`)

Fungsi baru `terminalAgentDefaults(o)`, cermin bentuk `conflictSessionDefaults()`:

```
o.agent kosong  → sessionAgentDefaults(), lalu o.model/o.effort menimpa bila ada
o.agent terisi  → blok Setting agen ITU (claude → {model,effort}, codex → {codex.model,codex.effort}),
                  lalu o.model/o.effort menimpa bila ada; effort codex dikoersi ke katalog modelnya
```

Aturan mengikat: saat operator menukar agen tanpa menyebut model, model **wajib** datang dari blok
agen terpilih. Membaca `Setting.model` untuk sesi codex melahirkan `codex -m claude-opus-5` — persis
bug SPEC-377.

### 3. Route (`server/src/routes/terminal.ts`)

Cabang terakhir (terminal agen biasa) berubah dari `sessionAgentDefaults()` menjadi
`terminalAgentDefaults(parsed.data)`. `ensureCodexTrust(repoDir)` diturunkan dari **agen hasil
fungsi itu**, bukan dari `Setting.agent` — gotcha ADR-0081 yang sekarang berlaku di sini juga,
karena keduanya bisa berbeda untuk pertama kalinya di jalur ini.

### 4. UI

**`src/src/screens/NewTerminalModal.tsx` (baru).** Modal kecil: Agen · Model · Effort, plus catatan
lunak versi codex (`codexClientTooOld`) yang sudah dipakai `StartSessionModal` dan kartu Settings.
Prefill dari `GET /settings` (blok per agen), sama seperti `StartSessionModal`. Tombol
“Buka sesi”. Berkas sendiri, bukan tambahan ke `TerminalScreen.tsx` yang sudah 672 baris.

**`src/src/screens/session-runtime.ts` (baru, murni).** Tiga fungsi yang selama ini hidup sebagai
salinan di dalam `StartSessionModal`:

```ts
runtimeModels(agent)              // MODELS | CODEX_MODELS
runtimeEfforts(agent, model)      // EFFORTS | codexEfforts(model)
runtimeFor(defs, agent)           // { model, effort } blok agen + koersi effort codex
```

`StartSessionModal` ikut memakainya (perubahan murni penataan, perilaku byte-identik). Alasannya
bukan estetika: “satu definisi, N call site” adalah kelas bug yang sudah dibayar hanoman di
SPEC-431/448/475/481, dan picker kedua ini adalah call site ketiga dari aturan yang sama.

**`TerminalScreen.tsx`.** Tombol “Sesi baru” membuka modal alih-alih langsung memanggil API.
`restartFromHistory` meneruskan `agent`/`model`/`effort` baris riwayat untuk `kind === "terminal"`.

**`src/src/api/client.ts`.** `createTerminal(project, opts?)` — `opts` absen ⇒ body byte-identik
dengan hari ini (`{project}`), jadi seluruh pemanggil lama tak berubah artinya.

## Aliran data

```
operator → NewTerminalModal (prefill GET /settings)
        → POST /terminal/sessions { project, agent?, model?, effort? }
        → terminalAgentDefaults()  → { agent, model, effort }
        → ensureCodexTrust(agent hasil)   (codex saja)
        → createSession(..., { agent, model, effort })
            → coerceCodexEffort (titik cekik SPEC-339)
            → argv `claude --model … --effort …` | `codex -m … -c model_reasoning_effort=…`
            → tmux @hanoman_agent = agent   → SessionInfo.agent → daftar sesi & SessionHistory
```

## Penanganan galat

| Keadaan | Jawaban |
|---|---|
| `agent` di luar `claude`\|`codex` | 400 (zod, sebelum menyentuh apa pun) |
| body flow cacat (`{project, flow:"prd"}` tanpa brief) | 400 — dijaga `flow: z.undefined()` |
| project tak ada / belum di-bind | 404 / 400 `needsBind` (tak berubah) |
| model tak dikenal katalog | diteruskan apa adanya (kurasi UI, bukan gerbang) |
| effort tak didukung model codex | diturunkan ke `fallback` model itu, tanpa galat |
| `GET /settings` gagal saat modal dibuka | modal tetap terbuka dengan default bawaan (gagal-diam, cermin `StartSessionModal`) |

## Acceptance criteria (EARS)

- **AC-1** — When operator menekan “Sesi baru” di halaman Terminal, the system shall menampilkan
  form pemilihan agen, model, dan effort sebelum sesi dibuat.
- **AC-2** — While form terbuka dan operator belum mengubah apa pun, the system shall menampilkan
  agen/model/effort dari setelan global (`GET /settings`).
- **AC-3** — When operator memilih agen `codex`, the system shall mengganti daftar model ke
  `CODEX_MODELS` dan daftar effort ke `codexEfforts(model terpilih)`, tanpa daftar model baru yang
  di-hardcode.
- **AC-4** — When operator menukar agen tanpa menyebut model, the system shall memakai model &
  effort dari blok Setting agen terpilih (claude → `model`/`effort`, codex → `codex.model`/
  `codex.effort`), bukan blok agen sebelumnya.
- **AC-5** — When body `POST /terminal/sessions` memuat `{project, agent, model, effort}`, the
  system shall melahirkan pane tmux dengan agen dan argv model/effort tersebut.
- **AC-6** — When body hanya `{project}`, the system shall berperilaku persis seperti sebelum
  SPEC-517 (default global).
- **AC-7** — When agen hasil resolusi adalah `codex`, the system shall memanggil
  `ensureCodexTrust(repoDir)` walaupun `Setting.agent` bernilai `claude`.
- **AC-8** — When body memuat `flow` yang tak dikenal varian mana pun, the system shall menjawab
  400, bukan membuka terminal biasa.
- **AC-9** — When operator menekan “Mulai lagi” pada baris riwayat ber-`kind: "terminal"`, the
  system shall melahirkan sesi dengan agen/model/effort baris riwayat itu.
- **AC-10** — Sesi `reverse`/`scaffold`/`prd`/`breakdown` dan sesi konflik shall tetap mengikuti
  default global — tak ada override per-request di sana.

## Rencana test

**shared** (`terminal-session-runtime.test.ts`) — varian union: `{project}` lolos;
`{project, agent:"codex", model, effort}` lolos & fieldnya terbawa; `{project, agent:"gemini"}`
ditolak; `{project, flow:"reverse", agent:"codex"}` **tidak** masuk varian plain;
`{project, flow:"prd"}` ditolak seluruh union (gerbang `z.undefined()`).

**server** (`terminal-agent-defaults.test.ts` + tambahan di `terminal.route.test.ts`) —
`terminalAgentDefaults` untuk enam kombinasi (tanpa override / agen saja / agen+model / model saja /
effort codex tak sah → fallback / default global codex); route melahirkan argv yang benar
(memakai `HANOMAN_CLAUDE_BIN=/bin/echo` seperti test yang sudah ada) dan `ensureCodexTrust`
terpanggil untuk override codex di atas default claude.

**web** (`new-terminal-runtime.test.tsx`) — modal muncul saat “Sesi baru” ditekan; prefill dari
settings; menukar agen menukar daftar model & effort; body request memuat pilihan; “Mulai lagi”
riwayat terminal membawa runtime baris itu. Ingat `env -u NODE_ENV` untuk test web.

## Dokumen yang tersentuh

- `internal/docs/architecture/api-contract.md` — varian `{project, agent?, model?, effort?}`,
  amandemen klausa “terminal … tak punya override”.
- `internal/skills/hanoman/SKILL.md` — butir ADR-0074 (daftar pintu yang mengikuti `Setting.agent`).
- `internal/docs/frontend/frontend-implementation.md` — bila layar Terminal dijelaskan di sana.
- `internal/docs/README.md` — hanya bila ada berkas doc baru (rencananya tidak ada).
