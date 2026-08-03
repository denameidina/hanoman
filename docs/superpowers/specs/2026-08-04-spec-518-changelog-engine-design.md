# SPEC-518 — Setting runtime, model, dan effort untuk agent pembuat changelog

**Tanggal:** 2026-08-04 · **Sumber:** brief · **Prioritas:** sedang
**Menegakkan:** [ADR-0105](../../../internal/docs/adr/0105-changelog-per-project.md) (changelog per project),
[ADR-0091](../../../internal/docs/adr/0091-hanoman-lead-agen-pemimpin.md) (`think()` sebagai titik spawn kedua),
[ADR-0081](../../../internal/docs/adr/0081-default-sesi-konflik-opt-in.md) (override agen opt-in yang mewarisi saat mati).
**Tanpa ADR baru, tanpa perubahan skema, tanpa migration, tanpa endpoint baru.**

## Masalah

`generateChangelog()` (SPEC-516) memanggil agen lewat `think()` dengan triple yang diambil dari
`sessionAgentDefaults()` — default sesi kerja global:

```ts
// server/src/services/changelog/generate.ts:46
const { agent, model, effort } = await sessionAgentDefaults();
```

Artinya pembangkitan changelog **selalu** memakai runtime/model/effort yang sama dengan sesi yang
menulis kode, dan operator tak punya satu pun kontrol untuk memisahkannya. Itu keliru dua arah:

- **Terlalu mahal.** Menulis prosa rilis 20 baris dari daftar judul backlog bukan pekerjaan
  `claude-opus-5 · xhigh`. Ongkosnya menumpang langganan yang sama dengan sesi pekerja (konsekuensi
  yang diterima sadar di ADR-0091 untuk lead, dan berlaku sama di sini).
- **Tak bisa dipisahkan runtime-nya.** Operator yang sesi kerjanya codex tak bisa membuat changelog
  dengan claude, atau sebaliknya — padahal `think()` sudah mendukung keduanya (`leadArgv`).

Tiga permukaan lain di hanoman sudah menyelesaikan persoalan yang sama persis: sesi konflik
(`Setting.conflict`, SPEC-383/ADR-0081), hanoman-lead (`Setting.lead.engine`, SPEC-409/SPEC-488),
dan sesi operator Telegram (`Setting.telegram.engine`, SPEC-492). Changelog adalah pemakai keempat
dari bentuk yang sama, dan satu-satunya yang belum punya kontrolnya.

## Keputusan

### D1 — `Setting.changelog` adalah `zAgentEngine`, bukan bentuk kelima

`shared/src/agent-engine.ts` sudah memegang bentuk bersama "override agen":
`{ enabled, agent, model, effort }`. SPEC-492 melahirkannya justru untuk mencegah dua definisi
yang bercabang diam-diam, dan `agent-engine.test.ts` mengunci `zLeadEngine === zAgentEngine`
**sebagai identitas objek**, bukan kesamaan bentuk.

```ts
// shared/src/entities.ts
changelog: zAgentEngine.default(CHANGELOG_ENGINE_DEFAULTS),
```

**Flat, bukan `changelog.engine`.** `lead`/`telegram` menyarangkan `engine` karena blok mereka
sudah memuat knob lain (rem darurat, denyut, batas waktu, allowlist). Blok changelog **hanya**
override agen — persis kasus `Setting.conflict`, yang flat. Menyarangkan berarti satu tingkat
kosong yang tak pernah punya tetangga.

`CHANGELOG_ENGINE_DEFAULTS = zAgentEngine.parse({})` → `enabled: false`. **Opt-in**: instalasi yang
sudah ada tak berubah satu argv pun sampai operator menyalakannya.

Dipasang lewat `.default()` pada `zSetting` → baris `Setting` lama yang tak punya kunci ini **tetap
parse** (kolom `Setting.data` bertipe `Json`). **Tanpa migration.**

> Catatan sadar, di luar scope: `zConflict` bentuknya identik dengan `zAgentEngine` tapi masih
> definisi terpisah (ia lahir sebelum SPEC-492). Menyatukannya adalah refactor yang tak dituntut
> brief ini dan menyentuh tiga pintu integrasi — tidak dikerjakan di sini.

### D2 — Resolver `changelogAgentDefaults()`, cermin `telegramAgentDefaults()`

Modul baru `server/src/services/changelog/config.ts`:

```ts
export async function changelogAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const e = (await getSetting()).changelog;
  if (!e.enabled) return sessionAgentDefaults();          // opt-in: mati = warisi penuh
  return e.agent === "codex"
    ? { agent: "codex", model: e.model, effort: coerceCodexEffort(e.model, e.effort) }
    : { agent: "claude", model: e.model, effort: e.effort };
}
```

Tiga hal yang mengikat, ketiganya sudah jadi pelajaran berbayar di repo ini:

1. **Mati = mendelegasikan penuh**, bukan menyalin nilai default. Satu setelan agen yang berlaku,
   bukan dua yang bisa berselisih diam-diam (ADR-0081).
2. **`coerceCodexEffort` di dalam resolver**, bukan di UI saja. Effort adalah properti **MODEL**
   (SPEC-339); nilai yang masuk lewat `PUT /settings` ber-`AgentToken` tak lewat picker mana pun.
3. **Dibaca setiap panggilan**, tanpa cache — ganti setelan berlaku pada pembangkitan berikutnya
   tanpa restart, sama seperti `lead-engine-argv.test.ts` mengunci untuk lead.

### D3 — Satu call site: `generate.ts`

`generateChangelog()` adalah **satu-satunya** tempat changelog men-spawn agen. Penukaran
`sessionAgentDefaults()` → `changelogAgentDefaults()` karena itu satu baris, dan tak ada risiko
kelas "satu definisi, N call site" (SPEC-431/448/475/481) untuk ditakuti di sini.

`CHANGELOG_TIMEOUT_MS` (180 dtk) **tidak** ikut jadi setelan — brief menyebut runtime/model/effort
saja, dan angka itu sudah disebutkan di dalam prompt (SPEC-432). Membuatnya bisa disetel berarti
menambah permukaan yang harus dijaga sinkron dengan kalimat anggaran waktu di `changelogPrompt`.

### D4 — Kartu Settings menulis lewat `PUT /settings`, seperti kartu konflik

Kartu **"Agen changelog"** di **Settings → Model sesi**, sesudah kartu Telegram. Bentuknya persis
tiga kartu di atasnya: satu `Switch` opt-in, dan saat mati **menampilkan nilai warisan yang berlaku**
(pelajaran SPEC-383 — tanpa itu operator ditinggal bertanya "lalu changelog pakai apa?").

Ia menulis lewat `save()` (`PUT /settings`), **bukan** endpoint khusus seperti kartu lead. Alasannya
bukan selera melainkan bukti: kartu lead terpaksa membaca-ulang lewat `PUT /lead/config` karena blok
`lead` punya **penulis kedua** (`LeadScreen`: Pause, denyut, opt-in per project), dan kartu Telegram
membaca-ulang karena bloknya punya penulis kedua **di luar browser** (command `/runtime|/model|/effort`
dari chat). Blok `changelog` **tak punya penulis kedua** — satu-satunya yang menulisnya adalah kartu
ini. Pola `save()` karena itu sah, persis seperti pada `Setting.conflict`.

Katalognya sumber yang sama dengan tiga kartu di atas: `MODELS`/`EFFORTS` untuk claude,
`CODEX_MODELS` + **`codexEfforts(model)`** untuk codex — bukan `CODEX_EFFORTS` (SPEC-339). Menukar
runtime **menukar model+effort sekalian** ke default runtime itu (cermin `pickAgent`); tanpa itu
changelog lahir `codex -m claude-opus-5`.

## Bentuk data

```
Setting.data.changelog = { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" }
```

| | nilai |
|---|---|
| Skema | `zAgentEngine` (dipakai bersama `lead.engine` & `telegram.engine`) |
| Default | override **MATI** → warisi `sessionAgentDefaults()` |
| Migration | **tidak ada** — kolom `Setting.data` bertipe `Json`, dipasang `.default()` |
| Endpoint | **tidak ada yang baru** — `GET/PUT /settings` yang sudah ada |
| Sync | ikut `Setting` apa adanya (tak ada perlakuan khusus) |

## Aliran

```
Settings → Model sesi → kartu "Agen changelog"
        └─ PUT /settings { …, changelog: { enabled, agent, model, effort } }

POST /projects/:id/changelog
  → generateChangelog()
      → collect()                       (tak berubah)
      → changelogPrompt()               (tak berubah)
      → changelogAgentDefaults()        ← BARU: setelan changelog, atau warisan bila mati
      → think(prompt, { agent, model, effort, timeoutMs })
      → scrubOutput() → prisma.changelog.create()
```

## Penanganan galat

Tak ada jalur galat baru. Setelan yang menghasilkan agen gagal (biner tak ada, model ditolak CLI)
jatuh ke jalur yang sudah ada di ADR-0105: `generator: "fallback"` + `warning` berisi alasan dari
`leadFailureReason()`, dan **barisnya tetap lahir** — agen gagal bukan galat. Setelan tak masuk akal
karena itu tak pernah bisa menjatuhkan endpoint ke 500.

`zSetting` menolak `agent` di luar `claude|codex` (400 dari `PUT /settings`). `model`/`effort` tetap
`z.string()` longgar seperti seluruh blok engine lain — katalog ditegakkan permukaan operator, bukan
server.

## Test

TDD, merah dulu. Yang paling menentukan adalah AC-3: tanpa test itu, "setelan tersimpan tapi tak
pernah dipakai" **terlihat persis sama** dengan berhasil.

| # | Berkas | Yang dikunci |
|---|---|---|
| AC-1 | `shared/src/agent-engine.test.ts` | `Setting.changelog` default = override mati, `claude-opus-5 · xhigh`; ia **adalah** `zAgentEngine`, bukan bentuk kelima |
| AC-2 | `shared/src/agent-engine.test.ts` | baris `Setting` lama **tanpa** kunci `changelog` tetap parse |
| **AC-3** | `server/test/changelog-engine.test.ts` | **triple hasil resolver benar-benar sampai ke `think()`** — opts-nya di-assert, bukan cuma `think` di-stub |
| AC-4 | `server/test/changelog-engine.test.ts` | `enabled:false` → mewarisi `sessionAgentDefaults()`, untuk akar claude **dan** akar codex |
| AC-5 | `server/test/changelog-engine.test.ts` | `enabled:true` → memakai triple sendiri, beda dari akar |
| AC-6 | `server/test/changelog-engine.test.ts` | effort codex dikoersi ke yang didukung model (`gpt-5.6-luna` + `ultra` → `xhigh`) |
| AC-7 | `server/test/changelog-engine.test.ts` | setelan dibaca **tiap panggilan** — dua `generateChangelog()` dalam satu proses dengan baris `Setting` berbeda memberi argv berbeda |
| AC-8 | `src/test/settings-changelog-engine.test.tsx` | kartu ada di tab Model sesi |
| AC-9 | `src/test/settings-changelog-engine.test.tsx` | mati → tak ada picker, **nilai warisan ditampilkan** |
| AC-10 | `src/test/settings-changelog-engine.test.tsx` | toggle → `PUT /settings` (bukan endpoint lain), `changelog.enabled: true` |
| AC-11 | `src/test/settings-changelog-engine.test.tsx` | menukar runtime ke codex → model & effort ikut bertukar ke katalog codex |
| AC-12 | `src/test/settings-changelog-engine.test.tsx` | picker effort codex hanya menawarkan effort yang didukung model terpilih |

## Docs yang tersentuh (commit yang sama)

- `internal/docs/architecture/data-model.md` — butir `changelog` di daftar field `Setting`.
- `internal/docs/architecture/api-contract.md` — blok `GET/PUT /settings`.
- `internal/docs/adr/0105-changelog-per-project.md` — catatan amandemen: agen penarasi kini
  bersetelan sendiri, bukan selalu `sessionAgentDefaults()`.
- `internal/skills/hanoman/SKILL.md` — butir changelog & butir "titik kelahiran sesi wajib lewat
  helper defaults".

Tak ada berkas doc baru → index `internal/docs/README.md` tak bertambah entri.

## Di luar scope

- Menyatukan `zConflict` ke `zAgentEngine` (refactor tiga pintu integrasi, tak diminta brief).
- `CHANGELOG_TIMEOUT_MS` sebagai setelan.
- Override per-permintaan di body `POST /projects/:id/changelog` — cermin `conflict`/`lead`/
  `telegram` yang ketiganya sengaja **tak** punya override per-request; pilihan hidup di Settings.
- Menampilkan runtime/model yang dipakai pada baris `Changelog` hasil (kolom baru = migration).
- Prefiks `lead <agent>` pada pesan `leadFailureReason()` yang ikut terbaca di `warning` changelog —
  kosmetik, sudah terkunci test SPEC-516, dan mengubahnya menyentuh jejak keputusan lead.
