# SPEC-516 — Changelog ringkas per project (rentang tanggal · SHA · versi)

**Tanggal:** 2026-08-03 · **Source:** brief · **Prioritas:** sedang
**ADR baru:** [0105 — Changelog per project](../../../internal/docs/adr/0105-changelog-per-project.md)

## Objective

Operator dan pemilik project bisa membangkitkan **changelog naratif berorientasi user** untuk sebuah
project — apa yang berubah bagi pemakai, bukan berkas/fungsi apa yang disentuh — lewat tiga mode:

1. **Backlog + rentang tanggal** — backlog yang **selesai** di rentang `from..to`.
2. **Rentang SHA commit** — commit di antara dua SHA pada repo project.
3. **Versi/tag rilis** — perubahan yang masuk ke sebuah tag (atau rentang tag).

Hasilnya tampil di panel Changelog pada detail project, bisa disalin, bisa diunduh `.md`, dan
tersedia lewat REST API sehingga agen ber-`agent token` bisa memanggilnya.

## Masalah yang diselesaikan

hanoman menyimpan semua bahannya tapi tak punya permukaan yang menyajikannya untuk manusia non-teknis:
backlog (`Spec`), riwayat git per repo project, dan tag rilis — ketiganya teknis dan tersebar. Yang
hilang adalah **satu teks pendek** yang bisa ditempel ke pengumuman rilis.

## Keputusan yang diambil manusia (percabangan)

| Percabangan | Putusan | Konsekuensi |
| --- | --- | --- |
| Sumber narasi | **Hybrid**: kumpulkan deterministik → narasikan dengan satu panggilan agen one-shot → jatuh ke draf deterministik bila agen gagal | Kuota menumpang langganan yang sama seperti lead (preseden ADR-0091 OQ-1); fitur tetap hidup di mesin tanpa CLI agen |
| Stempel "selesai" | **Kolom baru `Spec.doneAt`** | Migration + ADR; kolom wajib masuk `FIELDS.spec` + `DATE_FIELDS.spec` |
| Persistensi hasil | **Model `Changelog` baru** | Migration + ADR; hasil bisa dibuka lagi tanpa membakar kuota |

## Arsitektur

### 1. `Spec.doneAt` — stempel selesai sebagai kolom

`Spec` punya `createdAt` (dibuat) dan `startedAt` (sesi pertama lahir) sejak ADR-0090, tapi **tidak**
punya stempel selesai. `updatedAt` bukan proksinya — mesin sync mem-*bump* `version` dan overlay
stage-live menulis tiap `GET /specs` dibaca, jadi ia bergerak tanpa ada manusia (ADR-0090).

**Kolom baru, nullable, tanpa default:**

```prisma
doneAt DateTime?   // SPEC-516 · ADR-0105 · kapan item PERTAMA kali masuk stage `done`
```

**Satu penulis, tiga jalur.** `stage = "done"` dipersist di **tiga** tempat (`routes/terminal.ts`
`advanceStage`, `services/scheduler/reconcile.ts`, `services/live-specs.ts`) dan menyalin
*bookkeeping* ke ketiganya adalah kelas bug yang sudah menggigit repo ini tiga kali (SPEC-431
`baseSha IS NULL`, SPEC-448 `rootBypassEnv`, SPEC-475 `headSha`). Karena itu `doneAt` **tidak**
ditulis di call site mana pun: ia ditulis **di dalam `recordCompletion()`** (`services/notifications.ts`)
— satu-satunya fungsi yang sudah dipanggil oleh ketiganya, dan yang oleh ADR-0103 sudah ditetapkan
sebagai "stempel selesai yang sudah ada di ketiga jalur". `PATCH /specs/:id` hanya bisa memundurkan
stage (guard 422), jadi ia bukan pintu keempat.

**Tulis-sekali.** `recordCompletion` idempoten lewat `key` unik: reopen lalu selesai lagi **tidak**
menotifikasi ulang (batasan sadar ADR-0033). `doneAt` mengikuti semantik yang sama — hanya ditulis
saat masih `null`, jadi maknanya **selesai pertama**, cermin `startedAt` = mulai pertama. Revert stage
mundur **tidak** mengosongkannya; itu diterima sadar dan dicatat di ADR.

**Backfill sekali-jalan di migration.** Baris `Notification` ber-`key = 'done:' || Spec.id` sudah
memuat stempel yang dicari untuk seluruh riwayat sejak SPEC-180:

```sql
UPDATE "Spec" SET "doneAt" = (
  SELECT n."createdAt" FROM "Notification" n WHERE n."key" = 'done:' || "Spec"."id"
) WHERE "doneAt" IS NULL;
```

Item yang selesai sebelum SPEC-180 (atau yang notifikasinya dihapus operator) tetap `null` dan tak
muncul di changelog mode backlog — keadaan sah, dilaporkan sebagai catatan di hasil, bukan disamarkan.

**Sync.** `doneAt` masuk `FIELDS.spec` **dan** `DATE_FIELDS.spec`. Tanpa itu spec asal-hub mendarat di
tiap client dengan `doneAt` null tanpa satu pun error — kelas gagal-senyap yang sudah dicatat
ADR-0090/0093/0094 (`upsert` yang tak menyebut sebuah kolom tetap berhasil).

### 2. Model `Changelog` — LOCAL-only

```prisma
model Changelog {
  id         String   @id @default(cuid())
  projectId  String
  mode       String   // "backlog" | "commit" | "version"
  title      String   // judul yang tampil di daftar, mis. "v0.1.16" / "1–31 Juli 2026"
  params     Json     // parameter pembangkitan, apa adanya (lihat zChangelogRequest)
  body       String   // markdown hasil akhir (sudah di-scrub)
  generator  String   // "agent" | "fallback"
  warning    String?  // alasan fallback / catatan cakupan; null = mulus
  itemCount  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId, createdAt])
}
```

**Tanpa kolom `version` → tak pernah masuk changefeed sync**, cermin `LeadFlow`, `WebhookEndpoint`,
dan `Project.autoMerge`: dua dari tiga modenya diturunkan dari **checkout git di mesin ini**, jadi
barisnya adalah fakta lokal. Yang portabel adalah keluarannya, dan jalannya sudah ada — unduh `.md`.

**`PG_ORDER` wajib ikut.** `cli/test/migrate-pg.test.ts` menuntut `PG_ORDER` **sama persis** dengan
daftar model DMMF; model baru tanpa entri di sana = test merah (dan itu memang gerbangnya). `Changelog`
ditempatkan **sesudah** `Project` karena FK-nya.

**Bukan `WEBHOOK_ENTITIES`.** Diputuskan sadar: changelog adalah artefak yang dibangkitkan atas
permintaan, bukan perubahan keadaan yang perlu disiarkan. Dicatat di ADR sebagai non-goal supaya tak
terbaca sebagai kelalaian.

### 3. Layanan — `server/src/services/changelog/`

Empat berkas, batasnya ditarik supaya bagian yang menentukan kualitas bisa diuji **tanpa men-spawn
apa pun**.

#### `collect.ts` — pengumpul, satu per mode

Semuanya memulangkan bentuk yang sama:

```ts
export type ChangelogItem = { label: string; detail: string };
export type ChangelogInput = {
  mode: ChangelogMode;
  title: string;            // judul turunan (rentang tanggal / tag / ringkas sha)
  items: ChangelogItem[];
  notes: string[];          // catatan cakupan yang harus sampai ke operator
};
```

- `collectBacklog(projectId, from, to)` — `Spec` ber-`stage = "done"` yang `doneAt`-nya di dalam
  rentang. Batas hari memakai `dayStart`/`dayEnd`/`inDayRange` dari `services/date-range.ts`
  (**dipakai ulang, bukan disalin**) — parsing komponen-per-komponen di zona **lokal**, karena
  `new Date("2026-07-31")` adalah tengah malam UTC dan sebagai batas `to` ia membuang hampir seluruh
  hari itu di WIB (ADR-0090). `label` = judul spec, `detail` = objective.
- `collectCommits(repoDir, fromSha, toSha)` — `git log <from>..<to>` dengan format subject + body.
  **SHA tidak ikut ke dalam payload** — bukan sekadar tak dirender, memang tak dikumpulkan.
- `collectVersions(repoDir, fromTag, toTag)` — daftar tag lewat `git tag --list --sort=-creatordate`;
  satu tag → rentang `<tag sebelumnya>..<tag>`; dua tag → `<fromTag>..<toTag>`. Isinya memanggil
  `collectCommits`.

Ketiganya mengembalikan `{ ok: false, reason }` yang **berbicara bahasa manusia** untuk keadaan sah
yang bukan error: repo belum di-bind, repo tanpa tag, SHA tak dikenal, rentang kosong. Route
menerjemahkannya ke **422 + pesan**, bukan 500 (constraint eksplisit brief).

#### `scrub.ts` — murni, dua jaring

- `scrubSubject(s)` — buang prefix conventional-commit (`fix(spec-511):`), path berkas
  (`server/src/x.ts`), token hex ≥ 7, rujukan internal (`SPEC-nnn`, `ADR-nnnn`), dan sisa penanda
  merge. Dipakai **pada input**, sebelum agen melihatnya: cara paling kuat mencegah kebocoran
  teknis adalah tak pernah menyerahkannya.
- `scrubOutput(md)` — jaring kedua atas keluaran agen, aturan yang sama plus pembuangan blok kode.

Keduanya nol I/O, nol Prisma → diuji langsung.

#### `render.ts` — murni

- `fallbackMarkdown(input)` — draf deterministik: judul, satu paragraf pembuka, butir per item.
- `changelogPrompt(input, budgetMs)` — prompt bahasa Indonesia yang menyebutkan **anggaran waktunya
  sendiri**. Pelajaran SPEC-432 terukur: agen berbatas waktu yang tak diberi tahu batasnya memakai
  306 s; prompt yang sama + satu paragraf anggaran selesai 101 s. Prompt juga melarang eksplisit
  nama berkas/fungsi/hash dan meminta gaya editorial.

#### `generate.ts` — orkestrator

`collect → changelogPrompt → think() → scrubOutput → simpan`.

`think()` **diimpor** dari `services/lead/brain.ts`, tidak disalin. Itu bukan kenyamanan melainkan
inti keputusannya: hanoman hari ini punya **dua** titik spawn agen (`pty.ts` dan `lead/brain.ts`), dan
titik ketiga akan mengulang SPEC-448 — di sana `rootBypassEnv` ada di `pty.ts` tapi tak pernah
menyeberang ke `brain.ts`, dan lead gagal **100 %** di setiap instance yang servernya jalan sebagai
root. `think()` sudah membawa: gerbang root, `stdin.end()`, `maxBuffer` 16 MiB, dan
`leadFailureReason()` yang membaca kedua stream.

Agen/model/effort diambil dari `sessionAgentDefaults()` — bukan `sessionModel()`, yang **sengaja
khusus claude** dan akan melahirkan `codex -m claude-opus-5` (SPEC-377).

Kegagalan agen **tidak** melempar: baris tetap disimpan dengan `generator: "fallback"` + `warning`
berisi alasan yang bisa dibaca. Operator melihat sesuatu yang berguna dan tahu persis mengapa ia
belum senaratif seharusnya.

### 4. Kontrak API — `server/src/routes/changelog.ts`

| Method & path | Guna | Capability |
| --- | --- | --- |
| `GET /api/projects/:id/changelog` | daftar changelog tersimpan (paginated) | `docs:read` |
| `POST /api/projects/:id/changelog` | bangkitkan + simpan | `docs:write` |
| `GET /api/projects/:id/changelog/:cid` | baca satu; `?download=md\|pdf` → berkas | `docs:read` |
| `DELETE /api/projects/:id/changelog/:cid` | hapus | `docs:write` |
| `GET /api/projects/:id/changelog/sources` | tag tersedia, rentang tanggal yang punya isi, HEAD | `docs:read` |

**Capability = domain `docs`, bukan `projects`.** `capabilityForRoute` hari ini memetakan
`projects/:id/<sub>` yang tak dikenal ke `rw("projects")` — artinya agen yang ingin membangkitkan
changelog harus dipercaya menyunting & menghapus project. Changelog adalah **dokumen**, sejajar
`docs`/`prds` yang sudah ada di cabang yang sama. `sub === "changelog"` ditambahkan ke cabang itu,
diikat test di `agent-capabilities.test.ts`.

`sources` menjawab constraint "repo tanpa remote/tanpa tag" **sebelum** operator menekan Generate:
ia memulangkan `{ tags: [], reason: "repo project ini belum punya tag" }`, bukan melempar.

Unduh memakai `downloadFormat()` + `sendDocDownload()` dari `services/doc-export.ts` (ADR-0078) apa
adanya — `.md` mentah adalah yang diminta brief; `.pdf` ikut gratis karena helper-nya satu.

**Validasi bentuk** hidup di `shared/src/changelog.ts` sebagai zod discriminated union ber-`mode`,
dipakai server **dan** klien:

```ts
zChangelogRequest = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("backlog"), from: zDay.optional(), to: zDay.optional() }),
  z.object({ mode: z.literal("commit"),  fromSha: z.string().min(4), toSha: z.string().min(4) }),
  z.object({ mode: z.literal("version"), fromTag: z.string().optional(), toTag: z.string().min(1) }),
]).superRefine(/* from <= to */)
```

**Default rentang** saat mode `backlog` dikirim tanpa `from`/`to`: **30 hari terakhir** (`to` = hari
ini, `from` = hari ini − 29), diturunkan fungsi murni `defaultRange(today)` supaya bisa diuji tanpa
membekukan jam. Constraint brief: "default ke rentang wajar bila kosong".

### 5. Dashboard

`src/src/screens/ChangelogPanel.tsx`, dipasang sebagai `Card` di `ProjectDetailScreen` (di bawah
kartu Help Center, sebelum Custom agent). Isinya:

- Tiga tab mode. Form per mode: dua `<input type="date">`; dua kolom SHA; dua `<select>` tag yang
  diisi dari `sources`.
- Tombol **Bangkitkan** (disabled selagi berjalan; panggilan agen bisa puluhan detik → status
  eksplisit, bukan spinner bisu).
- Hasil dirender `<Markdown>` (`ds/markdown.tsx`), dengan `warning` sebagai `Badge tone="warn"` di
  atasnya bila ada.
- **Salin** (`navigator.clipboard`) dan **Unduh .md** (`ds/DocDownload.tsx`).
- Daftar changelog tersimpan; klik = buka, ada tombol hapus.

Mengikuti design system yang berlaku (editorial, bone paper, brass accent) — komponen `Card`/`Button`/
`Badge`/`Markdown` yang sudah ada, tanpa CSS baru. `Card` dipakai polos di sini (tanpa `fill`), jadi
jebakan rantai flex SPEC-393 tak berlaku.

## Penanganan galat

| Keadaan | Perilaku |
| --- | --- |
| Project belum punya `repoDir`/binding (mode commit & versi) | 422 `"project ini belum ditautkan ke repo di mesin ini"` |
| Repo tanpa tag (mode versi) | `sources` → `tags: []` + alasan; POST → 422 dengan pesan yang sama |
| SHA tak dikenal / rentang terbalik | 422 dengan pesan git yang sudah dibersihkan |
| `from > to` | 400 dari zod, sebelum menyentuh repo |
| Rentang tanpa isi | 422 `"tak ada … di rentang itu"` — bukan changelog kosong yang membingungkan |
| Agen gagal / CLI tak ada | 201 dengan `generator: "fallback"` + `warning` |
| Project dihapus | baris `Changelog` ikut terhapus (FK cascade) |

## Testing

**Murni (tanpa DB, tanpa spawn):**
- `changelog-scrub.test.ts` — `scrubSubject`/`scrubOutput`: prefix conventional-commit, path berkas,
  hex ≥ 7, `SPEC-nnn`/`ADR-nnnn`, blok kode. Termasuk kontrol negatif: prosa biasa tak dirusak.
- `changelog-render.test.ts` — `fallbackMarkdown` & `changelogPrompt` (anggaran waktu benar-benar
  disebut; larangan teknis benar-benar ada di prompt).
- `changelog-range.test.ts` — `defaultRange` + `from <= to` di `zChangelogRequest`.

**Layanan (DB):**
- `changelog-collect.test.ts` — mode backlog menyaring `doneAt` inklusif di kedua ujung; `doneAt`
  null dibuang; `stage != done` dibuang.
- `spec-done-at.test.ts` — `recordCompletion` menulis `doneAt`; panggilan kedua **tidak** memindahkannya;
  `doneAt` ada di `FIELDS.spec` **dan** `DATE_FIELDS.spec` (kelas gagal-senyap ADR-0090).

**Git (fixture repo nyata, pola `git-ide.test.ts`):**
- `changelog-git.test.ts` — rentang SHA; daftar tag; repo tanpa tag; SHA tak dikenal → `reason`,
  bukan lemparan.

**Route:**
- `changelog.route.test.ts` — CRUD, `?download=md` (Content-Disposition + isi), 422 untuk tiap
  keadaan sah di tabel galat, dan jalur fallback saat `think` distub gagal.
- `agent-capabilities.test.ts` — `GET/POST …/changelog` → `docs:read`/`docs:write`.

**Frontend:**
- `ChangelogPanel.test.tsx` — tiga mode merender form yang benar; hasil + `warning` tampil; tombol
  salin & unduh ada. Jalankan dengan `env -u NODE_ENV`.

**Katalog:**
- `cli/test/migrate-pg.test.ts` sudah menuntut `Changelog` ada di `PG_ORDER` — tak perlu test baru,
  cukup entri yang benar.

## Docs yang diperbarui (commit yang sama)

- `internal/docs/adr/0105-changelog-per-project.md` — **baru**; ditaut di `internal/docs/README.md`
  **dan** `internal/docs/adr/README.md` (SPEC-386).
- `internal/docs/architecture/data-model.md` — `Spec.doneAt` + model `Changelog`.
- `internal/docs/architecture/api-contract.md` — lima endpoint baru.
- `docs/agent-integration.md` — satu bagian singkat supaya agen tahu endpointnya ada.
- `internal/skills/hanoman/SKILL.md` — satu butir aturan arsitektur.

## Non-goal (sadar)

- **Tanpa tool MCP.** Katalog ADR-0099 punya versi skema sendiri; REST + panduan agen sudah memenuhi
  "agen bisa memanggilnya".
- **Tanpa peristiwa webhook.** Lihat di atas.
- **Tanpa penjadwalan otomatis.** Changelog dibangkitkan saat diminta.
- **Tanpa sync lintas mesin** untuk baris `Changelog`.
- **Tanpa terbit ke luar** (GitHub Release, dsb.).
