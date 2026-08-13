# SPEC-734 — Registry metode workflow

Design doc. Backlog item SPEC-734 · sumber brief · prioritas sedang.

## Masalah

hanoman hanya mengenal SATU metodologi kerja (superpowers), dan itu tak dipilih di mana pun — ia
tertulis literal di berkas-berkas yang tersebar, sebagian sebagai string path. Akibatnya metodologi
lain tak bisa dicoba tanpa menyunting semua tempat itu, dan tak ada cara membandingkan hasil dua
metode pada backlog yang sebanding.

## Enumerasi ulang titik sentuh

Brief menyebut **enam** titik. Enumerasi `grep -rn "superpowers"` atas seluruh `*.ts`/`*.tsx`
non-test di `shared/src server/src runner/src src/src cli/src` menemukan **sembilan** titik
fungsional — tiga di antaranya tak ada di brief:

| # | Titik | Peran | Di brief? |
|---|---|---|---|
| 1 | `runner/src/prompt.ts:80-92` `PHASE_SKILLS` | peta fase → skill | ya |
| 2 | `runner/src/prompt.ts:72-74` | klausa gerbang plan di prompt | ya |
| 3 | `runner/src/codex-settings.ts:78` | loop plan di Stop hook codex | ya |
| 4 | `server/src/services/session-phases.ts:83` `planComplete` | gerbang stage `executing` | ya |
| 5 | `server/src/services/stage-artifacts.ts:10-11` | peta stage → dir artefak | ya |
| 6 | `server/src/services/spec-docs.ts:22-23` | klasifikasi doc dari prefix path | ya |
| 7 | **`runner/src/goal.ts:52`** | grep plan di kondisi mode goal | **tidak** |
| 8 | **`runner/src/prompt.ts:241,270,281`** | path plan di `continuePrompt` & `resumeClause` | **tidak** |
| 9 | **`server/src/services/lead/prompt.ts:125`** | plan yang dibaca lead sebelum memutuskan | **tidak** |

Ketiganya kelas yang sama persis dengan INVARIAN 1: sesi metode lain diarahkan ke direktori yang
kosong, lalu gerbangnya lolos hampa. Nomor 7 paling tajam — `defaultGoalCondition` menuntut hasil
`grep` yang KOSONG sebagai bukti selesai, jadi direktori yang salah bukan sekadar tak informatif,
ia **memuaskan gerbangnya**. Ketiganya masuk scope.

`shared/src/mcp-catalog.ts:179` sengaja **tidak** disentuh: ia contoh nilai (`mis. …`) di deskripsi
parameter tool, bukan path fungsional.

## Bentuk

### `shared/src/method-catalog.ts` (baru)

Data murni + fungsi murni, **tanpa zod**. Dua alasan: modul ini diimpor `runner` (lapis yang selama
ini bebas skema), dan invarian katalog diuji di sumber tanpa perlu mesin validasi.

```ts
interface MethodDef {
  id: string; label: string;
  planDir: string; specDir: string;
  phaseSkills: Record<string, readonly string[]>;
  exitSkills: readonly string[];
  extraClause?: string;
  requires: readonly string[];
}
export const METHODS: Record<string, MethodDef>;
export const DEFAULT_METHOD = "superpowers";
export const METHOD_IDS: readonly string[];
export const PLAN_DIRS: readonly string[];   // union ter-dedup, urutan deklarasi
export const SPEC_DIRS: readonly string[];
export function resolveMethod(id?: string | null): MethodDef;   // lenient, TAK PERNAH melempar
```

Katalog awal dua entri:

- **`superpowers`** — `PHASE_SKILLS` hari ini dipindah apa adanya; `planDir`
  `docs/superpowers/plans`, `specDir` `docs/superpowers/specs`.
- **`matt`** — Brainstorm `grilling` · Audit `diagnosing-bugs` · Plan `to-tickets` ·
  Execute `implement`+`tdd`+`code-review` · Verifikasi `superpowers:verification-before-completion`;
  `planDir` `docs/matt/plans`, `specDir` `docs/matt/specs`;
  `requires: ["mattpocock-skills"]`.

Prefiks skill `mattpocock-skills:` diverifikasi dari sumbernya (github.com/mattpocock/skills):
plugin-nya bernama `mattpocock-skills` (`/plugin install mattpocock-skills`), dan skill plugin
di Claude Code beralamat `plugin:skill`.

### `exitSkills` — pintu keluar struktural

`exitSkills` **digabungkan ke fase TERAKHIR** pipeline, hanya untuk flow yang menulis kode
(`writesCode`, gerbang yang sama dengan `scopeClause`/`codeStyleClause`), lalu di-dedup.

Ini yang membuat INVARIAN 2 struktural alih-alih bergantung pada penulis katalog mengingat
menaruh gerbang verifikasi di tiap fase terminal:

- `superpowers` × feature/qa → `Execute` sudah memuat `verification-before-completion` → dedup
  menyerapnya → prompt **byte-identik dengan hari ini**.
- `superpowers` × goal → `Verifikasi` sudah memuatnya → **byte-identik**.
- `superpowers` × scaffold/prd → `writesCode` false → tak ada tambahan → **byte-identik**.
- `matt` × feature/qa → `Execute` = implement, tdd, code-review **+ gerbang verifikasi dari
  exitSkills**. Inilah gunanya: mattpocock tak punya padanan verification-before-completion.

### Resolusi metode (cermin `verifyScope`, SPEC-376/ADR-0080)

```
opts.method  →  Spec.payload.method  →  Setting.method  →  DEFAULT_METHOD
```

Diresolusi di `session-launch.ts`, satu titik. Bila `Spec.payload.method` belum ada, metode hasil
resolusi **distempel ke payload** di peluncuran itu (AC-5) — sesudah itu ia beku untuk item tersebut.

`Setting.method` bertipe `z.string()` **lenient**, bukan `z.enum` ketat: instance yang di-sync dari
hub bisa membawa id metode yang belum ada di build ini, dan itu harus jadi fallback diam — bukan
baris Setting yang gagal parse lalu mengosongkan layar Settings. Nilai mentah **tidak** dikoersi
saat disimpan maupun dibaca `getSetting()` (nilai hub tak dibuang diam-diam); yang lenient adalah
`resolveMethod()` di setiap titik pakai, termasuk picker UI.

### Union direktori plan — INVARIAN 1, fail-closed

Setiap pembaca direktori plan berpindah dari satu path literal ke **`PLAN_DIRS`**:

- `planComplete()` — pindai union; satu berkas cocok spec-id dengan `- [ ]` di direktori mana pun
  → tahan `executing`.
- `codexGoalScript()` — loop `for f in <dir>/*<spec>*` per direktori.
- `defaultGoalCondition()` — `grep` menyebut seluruh direktori.
- `artifactsToRemove()` — `ARTIFACT_DIR` jadi peta stage → **daftar** direktori.
- `kindOf()` — prefix diperiksa terhadap union.
- prompt lead — menyebut union.

Ini bukan kerapian: item yang lahir dengan superpowers lalu dilanjutkan dengan metode lain akan
melihat direktori kosong → `return true` hampa → backlog lompat ke `done` padahal plan lama masih
penuh `- [ ]`.

## Batas scope yang dinyatakan

**Metode adalah properti sesi BACKLOG.** Sesi project-level (reverse/scaffold/prd/breakdown), sesi
cron, dan sesi penyelesai konflik tetap `DEFAULT_METHOD`: tak satu pun punya baris `Spec`, dan
katalog mattpocock tak punya skill penyusun Source of Truth. `startPrdPrompt`/`startScaffoldPrompt`
karena itu tak diubah — dan karena `writesCode` false, prompt keduanya tetap byte-identik.

**`convertPayload` tak diajari membawa `method`.** Mengubah type backlog item (SPEC-546/ADR-0109)
membangun payload baru field-ke-field, jadi stempel metode ikut hilang dan item itu kembali
mengikuti `Setting.method` di peluncuran berikutnya. Aman karena gerbang plan sudah union
(INVARIAN 1) dan stempelnya lahir lagi saat itu juga; payload lama tetap utuh di `Spec.sourceHistory`.
Menambalnya berarti menyunting predikat milik spec lain tanpa AC yang memintanya.

**Di luar scope** (dari brief): default metode per PROJECT, deteksi otomatis plugin terpasang,
metode per-flow, dan memindahkan artefak superpowers yang sudah ada. `requires` cukup tampil
sebagai catatan di picker.

## Rekonsiliasi: "hanya skill model-invoked"

Katalog mattpocock membedakan skill user-invoked (slash command) dan model-invoked. Dari daftar
resminya, `to-tickets` dan `implement` adalah **slash command**, sementara constraint berbunyi
"HANYA SKILL MODEL-INVOKED yang boleh masuk katalog … test sumber menolaknya".

Kedua pernyataan hanya bisa benar bersamaan pada satu bacaan: yang dilarang adalah kelas bahaya
yang constraint itu sendiri sebutkan — **skill yang MEWAWANCARAI manusia** (`/grill-me`, `/to-spec`)
— karena sesi hanoman tak berpenunggu dan `AUTONOMY_CLAUSE_FULL` melarang agen bertanya → deadlock.
Bukti bacaan ini ada di constraint berikutnya, yang justru mengatur cara memakai `to-tickets` di
fase Plan; kalimat itu tak punya makna bila `to-tickets` terlarang. Perhatikan pula bahwa katalog
memilih **`grilling`** (primitif model-invoked) alih-alih `/grill-me` (pembungkus user-invoked) —
persis pemisahan ini.

Penegakannya karena itu berbentuk **denylist di test sumber**: konstanta skill berpenunggu-manusia
dan penulis-tracker-eksternal (`grill-me`, `to-spec`, `triage`, `grill-with-docs`, `to-questionnaire`,
`wait-what`, `teach`, `handoff`, `ask-matt`, `wayfinder`, `setup-matt-pocock-skills`); tak satu pun
boleh muncul di `phaseSkills`/`exitSkills` entri mana pun. Ditambah `extraClause` per metode yang
menyatakan sesi tak berpenunggu dan bahwa `to-tickets` di sini penghasil berkas plan berkotak di
`planDir`, bukan penerbit tiket.

## Deviasi yang wajib dicatat di ADR-0113

**Registry di `shared`, DI-IMPORT `runner` — bukan dicerminkan.** Ini menyimpang dari konvensi
`shared/src/enums.ts` yang mencerminkan `Flow`/`Agent`/`VerifyScope` supaya lapis runner bebas zod.
Cermin masuk akal untuk enum tiga kata, bukan untuk tabel yang harus identik di tiga paket —
SPEC-407 sudah membayarnya dengan EMPAT cermin `Flow`. `runner/package.json` sudah punya
`"@hanoman/shared": "workspace:*"` (sampai kini nol import), dan `method-catalog.ts` sengaja
bebas-zod supaya impor itu tak menyeret mesin validasi ke lapis runner.

## Rencana test

| Berkas | Menguji |
|---|---|
| `shared/src/method-catalog.test.ts` (baru) | AC-7 (`exitSkills` non-kosong), exitSkills memuat gerbang verifikasi, denylist skill berpenunggu-manusia, `id` = kunci peta, `planDir`/`specDir` unik antar-metode, `DEFAULT_METHOD ∈ METHODS`, `resolveMethod` lenient (AC-9) |
| `runner/test/method-phases.test.ts` (baru) | kunci `phaseSkills` wajib nama fase yang ADA di `PIPELINES` |
| `runner/test/prompt.test.ts` | AC-3, AC-4 (kedua metode × keempat builder prompt) + byte-identitas prompt superpowers |
| `runner/test/codex-settings.test.ts` | AC-4 di Stop hook + loop union |
| `runner/test/goal.test.ts` | union `PLAN_DIRS` di kondisi mode goal (titik 7) |
| `server/test/session-phases.test.ts` | AC-6 termasuk item berpindah metode |
| `server/test/session-launch.test.ts` | AC-2, AC-5 |
| `server/test/settings.test.ts` | AC-8, AC-9 |
| `server/test/stage-artifacts.test.ts` | pembersihan artefak lintas metode |
| `src/test/` (Start modal + Settings) | AC-1, AC-10 |

Assertion "phaseSkills ⊆ nama fase PIPELINES" **tak bisa** tinggal di `shared`: `PIPELINES` hidup di
`runner`, dan `runner` sudah mengimpor `shared` — mengujinya dari `shared` berarti siklus paket.
Ia pindah ke `runner/test/`, satu-satunya tempat kedua konstanta terlihat bersamaan. Deviasi dari
RENCANA TEST brief, disengaja.

## Docs (commit yang sama)

`internal/docs/adr/0113-registry-metode-workflow.md` (baru, ditaut di `internal/docs/README.md`
**dan** `internal/docs/adr/README.md`) · `internal/docs/architecture/stack.md` ·
`internal/skills/hanoman/SKILL.md`.

Nomor ADR 0113 tentatif — dienumerasi ulang lintas SEMUA branch + `git worktree list` tepat
sebelum push.
