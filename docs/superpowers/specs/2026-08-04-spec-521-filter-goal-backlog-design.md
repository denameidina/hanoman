# SPEC-521 — Filter goal pada daftar backlog

**Sumber:** brief · **Prioritas:** sedang · **Tanggal:** 2026-08-04
**ADR:** tidak ada ADR baru. ADR-0089 (backlog goal) & ADR-0038 (filter di layer response) **ditegakkan**.

## Objective

Daftar backlog menyediakan filter goal, sejalan dengan filter yang sudah ada, dan didukung
parameter query di `GET /specs`.

## Konteks terukur

`goal` sudah menjadi salah satu nilai `Spec.source` sejak SPEC-407/ADR-0089
(`zSpecSource = brief|qa|audit|help|goal`, `shared/src/enums.ts:6`), dan `flowForSource("goal")`
→ flow `goal` dua fase tanpa perencanaan.

Yang **sudah ada**:

- `GET /specs?source=<s>` — disaring di **level DB** oleh `liveSpecs()`
  (`server/src/services/live-specs.ts:15`, `where: { projectId, source }`), yaitu **sebelum**
  overlay stage-live. Berbeda dari `q`/`stage`/`priority`/`startable`/`dateField` yang disaring di
  layer response oleh `filterSpecs()` **sesudah** overlay (SPEC-198 · ADR-0038).
- Badge & detail item goal di backlog (`SOURCE_META.goal`, label **"Goal"**, ikon `target`).
- Tab **Goal** di `NewSpecModal` (membuat item bersumber goal).

Yang **tidak ada**:

- Tab/kontrol apa pun di daftar backlog yang menyaring ke `source=goal`. Deret tab sumber berisi
  empat entri — `all` · `brief` · `qa` · `audit` (`BacklogScreen.tsx`) — sehingga item goal hanya
  muncul di "Semua spec", bercampur dengan brief/QA/audit yang alurnya berbeda.
- Satu pun test server untuk param `source`: `grep "source=" server/test/specs.route.test.ts` →
  **0 match**. Param yang menopang filter ini karena itu tak terjaga apa pun.

## Keputusan

**Filter goal = tab kelima "Goal" di deret tab sumber, ditopang `GET /specs?source=goal`.**

Diputuskan operator saat brainstorm, di antara tiga bentuk yang ditimbang:

| Bentuk | Isi | Kenapa tidak |
|---|---|---|
| **Tab "Goal" (dipilih)** | Tab kelima → `source=goal` | — |
| Param baru `goal=true\|false` | Filter tri-state di `filterSpecs` | Menduplikasi `source=goal`; nilai tambah satu-satunya (`goal=false` = sembunyikan goal) tak diminta |
| Keduanya | Tab + Select mode | Dua permukaan tumpang tindih di layar yang sama; kombinasi tab Goal + "Tanpa goal" saling meniadakan |

Konsekuensi yang diterima sadar: **tak ada parameter query baru**. Constraint backlog menyebut
"sertakan test untuk parameter query barunya"; yang dikerjakan sebagai gantinya adalah test
kontrak untuk param `source` — parameter yang **menopang filter baru ini** dan yang hari ini
sama sekali tak diuji. Itu menutup risiko yang sama (filter UI diam-diam berhenti menyaring)
tanpa menambah permukaan API yang redundan.

## Perubahan

### 1. UI — `src/src/screens/BacklogScreen.tsx`

Tambah satu entri ke `Tabs` sumber:

```
{ value: "all", label: "Semua spec" }, { value: "brief", label: "Dari brief" },
{ value: "qa", label: "Dari QA" }, { value: "audit", label: "Audit" },
{ value: "goal", label: "Goal" },                                    // SPEC-521
```

Nol perubahan lain di UI: `tab` sudah menyeberang sebagai `source` di efek fetch
(`source: tab === "all" ? undefined : tab`), sudah masuk dependency array, sudah mereset `page`
ke 1, dan sudah dikembalikan ke `"all"` oleh tombol **Reset filter** pada `StateBlock` kosong.
`api.listSpecs` (`src/src/api/client.ts`) sudah menerima `source?: string` — tak disentuh.

**`help` sengaja tidak ikut.** Item bersumber `help` lahir dari triase tiket (ADR-0062) dan
sudah dinaikkan jadi `brief`/`qa`/`audit` oleh jalur triase; menambahkannya di sini di luar
objective backlog ini.

### 2. Server — tanpa perubahan kode

`GET /specs?source=goal` sudah bekerja. Yang ditambahkan hanya test (§3).

Satu perilaku yang **wajib dieja di test** karena tak terlihat dari route: `source` disaring di
DB, jadi saat tab Goal aktif, overlay stage-live + write-through + notifikasi `done` berjalan
atas **himpunan goal saja**, bukan seluruh backlog project. Itu memang kontrak yang tertulis di
`api-contract.md` ("Overlay … jalan atas SET PENUH (scope project/source)"), tapi belum pernah
diikat test.

### 3. Test

**`server/test/specs.route.test.ts`** — kontrak param `source` (nol coverage hari ini):

- `GET /specs?source=goal` hanya memulangkan item bersumber goal; `total` envelope ikut menyusut
  (bukan total backlog).
- `source` komposabel dengan filter layer-response: `?source=goal&priority=tinggi` dan
  `?source=goal&q=…` memotong lagi di atas himpunan goal.
- `source` absen → seluruh sumber (tak ada regresi pada tab "Semua spec").
- `source` tak dikenal → himpunan kosong, **bukan 400** (perilaku Prisma apa adanya; dieja agar
  tak berubah diam-diam).

**`src/test/backlog-goal.test.tsx`** — tab Goal:

- Tab "Goal" ada di baris tab.
- Mengkliknya memanggil `api.listSpecs` dengan `source: "goal"`.
- Kembali ke "Semua spec" mengirim `source: undefined` (sentinel `all` tak pernah bocor ke API).
- Mengklik tab mereset `page` ke 1 (halaman 3 + ganti tab → `page: 1`).

Harness-nya mencerminkan `src/test/backlog-date-filter.test.tsx`: `api.listSpecs` di-mock dan
yang diperiksa adalah **param yang menyeberang**, bukan jumlah baris yang dirender — penyaringan
hidup di server (ADR-0038), jadi menghitung baris klien akan menguji mock, bukan produk.

### 4. Jebakan yang wajib ditutup — `findByText("Goal")` cocok ganda

`src/test/backlog-goal.test.tsx:76` berbunyi `expect(await screen.findByText("Goal")).toBeTruthy()`
untuk badge kartu. Label tab baru **juga** "Goal" (sama dengan `SOURCE_META.goal.label`), jadi
`findByText` akan menemukan **dua** elemen dan melempar — test hijau berubah merah tanpa satu pun
regresi produk.

Presedennya sudah ada di repo ini: `src/test/backlog-board.test.tsx:134`
(`expect(screen.getAllByText("Audit").length).toBeGreaterThan(1)` — komentarnya sendiri berbunyi
*"Audit" muncul di tab filter DAN badge kartu → >1*). Assertion badge goal diubah mengikuti pola
itu, sehingga ia justru **mengikat** kehadiran tab + badge sekaligus.

Label tab sengaja **tidak** dibedakan dari label badge ("Mode goal", "Dari goal", …) demi
menghindari tabrakan test: dua nama untuk satu hal adalah harga yang lebih mahal daripada satu
assertion yang diperbaiki.

## Docs yang tersentuh (commit yang sama)

- `internal/docs/architecture/api-contract.md` — blok `GET /specs`: eja bahwa `source` disaring di
  **DB sebelum overlay** (beda lapis dari filter lain), nilai sahnya `brief|qa|audit|help|goal`,
  dan bahwa tab sumber daftar backlog adalah pemakainya.
- `internal/docs/frontend/frontend-implementation.md` — bagian "Backlog: tiga mode tampilan":
  deret tab sumber kini lima, dengan **Goal** (SPEC-521 · ADR-0089).

Keduanya sudah ter-link di `internal/docs/README.md` → tak ada entri index baru.
Tidak ada ADR baru, tidak ada perubahan skema, tidak ada endpoint baru.

## Scope verifikasi

- `pnpm vitest --run server/test/specs.route.test.ts src/test/backlog-goal.test.tsx --no-file-parallelism`
  dengan `TEST_DATABASE_URL` terisolasi (SPEC-479) dan `env -u NODE_ENV` untuk test web (SPEC-293).
- `pnpm --filter ./src typecheck` (satu-satunya paket yang kodenya berubah).
- Boot server + `curl "…/api/specs?source=goal"` sekali di akhir: task ini menyentuh perilaku
  endpoint yang dipakai filter baru, walau bukan kodenya.
