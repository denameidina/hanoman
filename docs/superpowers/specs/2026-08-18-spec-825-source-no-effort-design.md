# SPEC-825 — Source `no_effort`: flow satu fase untuk task remeh

**Tanggal:** 2026-08-18 · **Source:** brief · **Prioritas:** sedang
**ADR:** 0123 (baru) · **Migration:** tidak ada (`Spec.source` sudah kolom `String`)

## Masalah

`zSpecSource` punya lima nilai (`brief` · `qa` · `audit` · `help` · `goal`). Yang paling pendek
adalah `goal` = **dua** fase (`Goal` → `Verifikasi`, ADR-0089). Untuk pekerjaan yang benar-benar
remeh — ganti copy/label, bump konstanta, perbaiki typo docs, tambah satu baris allowlist — dua
fase pun kelebihan: fase `Verifikasi` menghabiskan satu giliran agen untuk membuktikan sesuatu
yang diff-nya sendiri sudah membuktikan.

Akibatnya operator memfilekan task remeh sebagai `goal` (atau lebih buruk, `brief` lima fase) dan
sesi berjalan jauh lebih lama dari kerjaannya. Yang hilang bukan cuma token: satu slot sesi
tertahan, dan mesin ini menjalankan beberapa sesi sekaligus.

## Keputusan

### 1. Source keenam `no_effort` → flow keenam `no_effort` = `PIPELINES.no_effort = ["Kerjakan"]`

Satu fase, bernama **`Kerjakan`**. Nama itu **unik lintas seluruh `PIPELINES`** — syarat keras,
karena peta `REACHED` (`server/src/services/session-phases.ts`) berkunci **nama fase saja**, bukan
pasangan (flow, fase). Memakai ulang `Execute` atau `Goal` merusak deteksi fase seluruh flow yang
memakainya.

Nama fase yang sudah terpakai hari ini: `Brainstorm`, `Objective`, `Spec`, `Plan`, `Execute`,
`Audit`, `Doc index`, `Scan`, `Docs teknis`, `Wawancara`, `Konvensi & index`, `Serah terima`,
`PRD`, `Laporan`, `Analisis`, `Breakdown`, `Goal`, `Verifikasi`. `Kerjakan` tidak bertabrakan.

Pemetaan stage: `Kerjakan` **aktif** ⇒ `executing`, `Kerjakan` **done/skipped** ⇒ `done`. Tak ada
stage antara — memang tak ada fase antara.

### 2. Payload menumpang bentuk `goal` — TIDAK ada bentuk keempat

`payloadShapeFor("no_effort") === "goal"`, jadi payload-nya `{goal, done, constraints, priority}`.

Alasannya bukan hemat kode, tapi karena bentuk keempat tak punya field keempat untuk dibawa.
Yang dibutuhkan task remeh persis: *apa yang dikerjakan* (`goal`), *bukti berhentinya* (`done`,
boleh kosong — untuk task remeh diff-nya sendiri buktinya), *batasan* (`constraints`), dan
*prioritas*. Bentuk keempat dengan field yang identik akan membeli:

- matriks `convertPayload` 4×4 alih-alih 3×3 (enam pasangan baru, semuanya identitas),
- entri `SHAPE_FIELDS` + `SHAPE_REQUIRED` keempat yang menyalin `GOAL_FIELDS` kata per kata,
- cabang `oneOf`/`allOf` keempat di `mcp-schema.ts`,
- pembeda baru di `shapeOfPayload` — dan **tak ada field yang bisa membedakannya**, karena
  bentuknya sama. Itu bukan detail: `shapeOfPayload` adalah yang menjaga `payloadMatchesSource`,
  dan bentuk yang tak terbedakan dari isinya membuat predikat itu tak bisa ditulis.

Konsekuensi yang diterima sadar: **`Spec.source` adalah satu-satunya yang membedakan** item
`goal` dari item `no_effort`. Itu memang cukup — `flowForSource` membaca `source`, bukan payload.

`SHAPE_REQUIRED.goal` tetap `["goal", "done"]`. `done` yang kosong bukan penghalang: daftar itu
hanya menyalakan catatan "field ini lahir kosong" di dialog konversi, bukan gerbang.

### 3. Prompt: satu builder, dua flow

`startGoalPrompt` sudah punya kerangka yang **persis** dibutuhkan `no_effort`: mengeja isi payload
sebagai prosa (Goal / Selesai bila / Batasan) alih-alih melampirkan JSON, tanpa keputusan
pasca-Audit, tanpa skill Brainstorm/Plan, tanpa `resumeClause` ber-plan. Yang berbeda hanya
kepala prompt dan satu klausa.

Karena itu ia **diparametrisasi flow** (`startGoalPrompt(flow, spec, branchTo, opts)`), bukan
disalin. Perbedaan per flow:

| | `goal` | `no_effort` |
|---|---|---|
| pipeline | `Goal → Verifikasi` | `Kerjakan` |
| kepala prompt | "mengejar SATU goal sampai tercapai" | "SATU pekerjaan remeh: kerjakan lalu berhenti" |
| klausa verifikasi | "fase Verifikasi bukan formalitas…" | — (tak ada fase itu) |
| larangan | tak ada design doc / plan berkotak / pecah backlog | sama, **+** jangan menambah fase sendiri |

Sisanya (autonomy, `verifyScope`, klausa gaya kode, klausa metode, `skillInstruction`, baris push,
baris backlog) identik dan dirakit oleh potongan yang sama.

### 4. `writesCode()` tetap satu definisi — lewat daftar fase kerja, bukan daftar flow

Hari ini: `PIPELINES[flow].includes("Execute") || PIPELINES[flow].includes("Goal")`. Rantai `||`
itu tumbuh satu suku tiap flow penulis-kode baru, dan **suku yang lupa ditambah tak menghasilkan
error apa pun** — `verifyScope` (SPEC-376/ADR-0080), klausa gaya kode (SPEC-543/ADR-0108), dan
`exitSkills` (SPEC-734/ADR-0113) semuanya diam-diam tak terpasang.

Jadi daftarnya diangkat jadi satu konstanta di `runner/src/prompt.ts`:

```ts
export const WORK_PHASES = ["Execute", "Goal", "Kerjakan"] as const;
```

Konstanta itu dipakai **dua** gerbang di **dua** paket:

1. `writesCode(flow)` di runner — verifyScope + gaya kode + exitSkills;
2. aturan "fase kerja yang sedang **aktif** sudah berarti `executing`" di `stageFor`
   (server, `session-phases.ts`) — yang hari ini juga sebuah rantai `||` berisi nama yang sama.

Server sudah mengimpor `PIPELINES` dari `@hanoman/runner`, jadi tak ada arah impor baru.

### 5. Mode goal DIPAKSA menyala, cermin ADR-0089

`isGoalShapedFlow(flow)` (`shared/src/dto.ts`, tetangga `flowForSource`) menggantikan
`opts.flow === "goal"` di `session-launch.ts` dan `defaultGoalCondition`. Ketiga akibatnya
berlaku sama untuk `no_effort`:

- mode goal selalu menyala (`opts.goal:false` diabaikan) — tanpa Stop hook, sesi satu fase justru
  paling gampang berhenti sebelum menulis baris fase & push;
- template global `Setting.goal.condition` **dilewati** — item membawa kondisinya sendiri;
- kondisinya `goalFlowCondition`, yang kini menyebut `PIPELINES[flow]` (bukan `PIPELINES.goal`
  hardcode) sehingga daftar fase yang dituntut ikut benar.

Gate codex (`codexGoalScript`) dan `defaultGoalCondition` sudah menurunkan fase dari
`PIPELINES[flow]`; keduanya benar tanpa perubahan selain di atas.

### 6. Item yang sudah dimulai terkunci — otomatis, cukup diuji

`checkSourceChange` (ADR-0109) mengunci **flow**, bukan label. `flowForSource("no_effort")` ≠
`flowForSource(<apa pun yang lain>)`, jadi item yang sudah dimulai tak bisa pindah ke/dari
`no_effort` tanpa satu baris kode baru. Itu benar: berkas fase item `feature` tak akan pernah
memuaskan `phasesComplete(["Kerjakan"])`, dan sebaliknya (bentuk kelas bug SPEC-433). Yang
ditambahkan hanya **test** yang mengunci perilaku itu.

Item yang **belum** dimulai tetap bisa pindah bebas: `brief ↔ no_effort` lewat `convertPayload`
yang sudah melayani arah `brief ↔ goal` — nol baris baru, karena konversi berkunci **bentuk**,
bukan source.

### 7. Lencana & pintu masuk UI

`SOURCE_META.no_effort = { label: "Tanpa effort", icon: "zap", tone: "brass", color: "var(--brass-400)" }`.

Entri ini **wajib**: fallback `SOURCE_META[s] ?? SOURCE_META.brief` diam — item `no_effort` akan
memakai lencana "feature brief" tanpa satu pun error (persis yang menimpa `help`, ADR-0109 poin 5).
`SOURCE_OPTS` diturunkan dari `zSpecSource.options`, jadi dialog "Ubah type" ikut otomatis.

Tiga pintu masuk:

- **tab filter** daftar backlog (`{ value: "no_effort", label: "Tanpa effort" }`) — `tab`
  menyeberang apa adanya sebagai `source` ke `GET /specs`;
- **tab form** "backlog baru" dengan field bentuk goal;
- `POST /specs` (jalur agen/MCP).

Form buat-backlog dan form edit detail memilih field lewat **`payloadShapeFor(source)`**, bukan
`source === "goal"` — satu predikat, cermin aturan yang sama di server.

Author diberi prefiks `No effort · <email>`, cermin `Audit ·` / `Goal ·`.

## Yang TIDAK berubah

- **Tanpa migration.** `Spec.source` sudah `String`; penambahan nilai murni zod (preseden `audit`
  SPEC-237, `help` ADR-0062, `goal` ADR-0089).
- `cross-audit` tetap dicabut (ADR-0092).
- `FIELDS.spec` sync allowlist sudah memuat `source` & `payload` — tak ada kolom baru.
- `zSpec.sourceHistory` menyimpan `from`/`to` sebagai string; nilai baru menyeberang apa adanya.
- Prompt flow lain **byte-identik**: `WORK_PHASES` menghasilkan boolean yang sama untuk
  `Execute`/`Goal`, dan `startGoalPrompt` merakit teks yang sama untuk flow `goal`.

## Permukaan yang tersentuh

| # | Berkas | Perubahan |
|---|---|---|
| 1 | `shared/src/enums.ts` | `zSpecSource` += `no_effort` |
| 2 | `shared/src/spec-source.ts` | `payloadShapeFor` → bentuk `goal` untuk `no_effort` |
| 3 | `shared/src/dto.ts` | `zFlow` += `no_effort`; `flowForSource`; `isGoalShapedFlow` |
| 4 | `shared/src/mcp-schema.ts` | cabang `allOf` goal menerima `no_effort`; deskripsi |
| 5 | `runner/src/types.ts` | `Flow` += `no_effort` |
| 6 | `runner/src/prompt.ts` | `PIPELINES.no_effort`; `WORK_PHASES`; `writesCode`; `startGoalPrompt(flow, …)` |
| 7 | `runner/src/goal.ts` | `isGoalShapedFlow`; `goalFlowCondition` memakai `PIPELINES[flow]` |
| 8 | `server/src/services/session-phases.ts` | `REACHED.Kerjakan`; aturan fase-kerja-aktif memakai `WORK_PHASES` |
| 9 | `server/src/services/spec-fields.ts` | objective diturunkan lewat `payloadShapeFor` |
| 10 | `server/src/routes/specs.ts` | prefiks author `No effort ·` |
| 11 | `server/src/services/session-launch.ts` | `isGoalShapedFlow`; teruskan flow ke prompt |
| 12 | `src/src/screens/source-meta.ts` | `SOURCE_META.no_effort` |
| 13 | `src/src/screens/BacklogScreen.tsx` | tab filter; field lewat `payloadShapeFor` |
| 14 | `src/src/App.tsx` | tab form; payload; `goalLocked` lewat `isGoalShapedFlow` |
| 15 | `src/src/api/client.ts` | `Flow` += `no_effort` |

Docs SoT dalam commit yang sama: `internal/docs/adr/0123-*.md` (+ link di `adr/README.md` dan
`internal/docs/README.md`), `internal/docs/architecture/data-model.md`,
`internal/docs/architecture/api-contract.md`, `internal/skills/hanoman/SKILL.md`.

## Test

| Berkas | Yang dikunci |
|---|---|
| `shared/src/spec-source.test.ts` | enam source → tiga bentuk; matriks 6×3; `zCreateSpec` menolak bentuk salah untuk `no_effort` |
| `shared/src/no-effort-flow.test.ts` (baru) | `flowForSource`; `isGoalShapedFlow`; cabang `mcp-schema` |
| `runner/src/no-effort-prompt.test.ts` (baru) | `PIPELINES.no_effort = ["Kerjakan"]` & nama unik lintas PIPELINES; `writesCode("no_effort")`; prompt memuat klausa scope + gaya kode + exitSkills, dan TIDAK memuat kata "Verifikasi"/"plan berkotak" |
| `server/test/session-phases.test.ts` | `Kerjakan` aktif → `executing`; `Kerjakan done` → `done`; `phasesComplete` |
| `server/test/spec-source-gate.test.ts` | item yang sudah dimulai ditolak 409 ke/dari `no_effort`; item belum dimulai `brief → no_effort` mengkonversi payload |
| `src/test/change-source.test.tsx` | `SOURCE_META` punya enam entri; dialog menawarkan `no_effort` |

Semua dijalankan dengan `--no-file-parallelism` + `TEST_DATABASE_URL` sendiri (constraint 8).
