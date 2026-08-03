# SPEC-520 — Status draft PRD hanya untuk yang belum dieskalasi ke backlog

> Sumber: brief · prioritas sedang · project `hanoman`
> Menegakkan ADR-0018/0019 (nilai turunan), ADR-0041 (PRD dokumen, bukan entitas DB),
> ADR-0069 (breakdown PRD → backlog). **Tanpa ADR baru, tanpa migration, tanpa kolom baru.**

## Objective

Status `draft` hanya melekat pada PRD yang **belum** menurunkan backlog. PRD yang sudah
menurunkan backlog memakai status lain, dan pembedaannya **terlihat di daftar PRD**.

## Masalah yang diselesaikan

Daftar PRD hari ini tak punya status sama sekali. Satu-satunya lencana di
`PrdSidebarItem` adalah `draft hidup`, dan ia menjawab pertanyaan yang **berbeda**: apakah
dokumen ini dibaca dari worktree sesi `prd` yang masih hidup (freshest-wins). Yang tersisa
sebagai "status" adalah baris prosa di dalam dokumennya sendiri — dan prosa itu ditulis
sekali oleh agen saat PRD lahir, jadi ia **tak bisa** ikut berubah saat PRD dieskalasi:

```
docs/prd/hardening-vps-checklist.md:3  > Status: Draft untuk review · Penulis: PM/PO …
docs/prd/help-center-per-project.md:3   > Status: Draft untuk review. Author: PM/PO …
docs/prd/server-and-client-side.md:3    > Status: Draft untuk review. Author: PM/PO …
docs/prd/scheduler-auto-start-….md:3    > Status: draft (hasil brainstorm PM/PO, 2026-07-22).
                                        >   Belum diimplementasikan.
```

Terukur dari DB instalasi hidup (`~/.hanoman/hanoman.db`, read-only) — keempat baris
"draft" itu **semuanya salah**:

| PRD (project `hanoman`) | backlog turunan | keadaan sebenarnya |
|---|---|---|
| `hardening-vps-checklist.md` | SPEC-220 `done` | tuntas |
| `help-center-per-project.md` | SPEC-253 `done` | tuntas |
| `server-and-client-side.md` | SPEC-213 `done` | tuntas |
| `orchestrator-hanoman.md` | SPEC-409 `done` | tuntas |
| `scheduler-auto-start-…md` | SPEC-294/295/296/297/299 `done` + SPEC-298 `executing` | **masih berjalan** |

**0 dari 5** PRD di repo ini benar-benar draft, tapi kelimanya terbaca sama. Itulah
"status tidak informatif untuk memilah mana PRD yang masih perlu ditindaklanjuti".

Lintas project, jejaknya 25 baris `Spec` (14 `crm-tumbuh-ai` + 11 `hanoman`).

## Keputusan yang diambil manusia (percabangan)

1. **Tiga keadaan, bukan dua** — `draft` · `dieskalasi` · `terwujud`. Query-nya sama persis,
   jadi keadaan ketiga tak berbiaya, dan ia yang paling langsung menjawab pertanyaan
   operator: PRD yang seluruh turunannya sudah `done` bukan lagi pekerjaan siapa pun.
2. **Filter status di header layar PRD** — Select kedua di samping filter project.

## Arsitektur

### 1. Jejak eskalasi yang sudah ada — dua kunci, tanpa kolom baru

Ada **tiga** jalur PRD → backlog, dan ketiganya sudah menuliskan path PRD ke baris `Spec`
yang lahir. Tak ada satu pun kolom yang perlu ditambah (kendala brief ditegakkan):

| jalur | ditulis oleh | jejak yang mendarat di `Spec` |
|---|---|---|
| Take → *feature brief* | `PrdScreen` → `POST /specs` | `payload.context` = `Dari PRD: <path>` **dan** `branchFrom` = `prd/<slug>` |
| Take → *goal* (ADR-0089) | `PrdScreen` → `POST /specs` | `payload.goal` = `Wujudkan PRD <path>` **dan** `branchFrom` = `prd/<slug>` |
| Breakdown (ADR-0069) | `routes/specs.ts:161` → `POST /specs/batch` | `payload.context` = `Dari PRD (breakdown): <path>\n\n…` |

Kunci pencocokan:

- **K1 — path PRD utuh muncul di `payload`** (`context` atau `goal`). Ini kunci yang
  menanggung beban: terukur **25 dari 25** baris berjejak tertangkap olehnya.
- **K2 — `branchFrom === "prd/" + slug`.** Terukur **0 tambahan** hari ini (ketiga baris
  ber-`branchFrom` `prd/*` sudah tertangkap K1). Tetap dipasang karena jalur take-single
  memang menulisnya dan backlog yang dibuat manual dari branch PRD adalah turunan PRD itu
  juga — K2 satu-satunya yang melihatnya.

**Path utuh, bukan kata "PRD".** Kontrol negatif dari DB hidup: SPEC-244, SPEC-273, dan
SPEC-407 memuat kata "PRD" di prosanya tanpa path apa pun. Pencocokan berbasis kata akan
menempelkan ketiganya ke PRD acak; pencocokan berbasis path utuh (`docs/prd/<slug>.md`,
berakhiran `.md`) **membuang ketiganya** dan kebal terhadap slug yang saling berawalan
(`docs/prd/auth.md` bukan substring `docs/prd/auth-device.md`).

**Scope project.** Kandidat selalu disaring `projectId` PRD-nya lebih dulu, jadi dua project
yang kebetulan punya `docs/prd/<slug>.md` bernama sama tak pernah saling mewarnai.

### 2. `shared/src/prd-status.ts` — murni, satu sumber kebenaran

Pola `shared/src/ticket-status.ts` (SPEC-293): status turunan yang dipakai server **dan**
dibaca ulang klien untuk label, hidup sebagai fungsi murni tanpa DB.

```ts
export const PRD_STATUSES = ["draft", "dieskalasi", "terwujud"] as const;
export type PrdStatus = (typeof PRD_STATUSES)[number];

// baris Spec seperlunya — sengaja bukan tipe Prisma (shared tak boleh tahu DB)
export type PrdSpecTrace = { stage: string; payload: unknown; branchFrom: string | null };

export function prdBranchFor(prdPath: string): string | null   // docs/prd/x.md → prd/x
export function specDerivesFromPrd(spec: PrdSpecTrace, prdPath: string): boolean
export function prdStatusOf(prdPath: string, specs: readonly PrdSpecTrace[]):
  { status: PrdStatus; specCount: number; doneCount: number }
```

Aturan `prdStatusOf`:

| turunan | status |
|---|---|
| `specCount === 0` | `draft` |
| `doneCount < specCount` | `dieskalasi` |
| `doneCount === specCount` (dan > 0) | `terwujud` |

`payload` diterima `unknown` dan dibaca defensif (`typeof v === "string"` sebelum
`includes`): kolomnya `Json?` di Prisma, jadi `null`, bentuk `qa`, dan bentuk lama semuanya
sah dan tak boleh melempar.

`stage === "done"` dibaca dari kolom DB apa adanya. Overlay stage-live (`live-specs.ts`)
mempersist nilainya, jadi kolom itu memang kebenaran terakhir; tak ada alasan menyalakan
jalur kedua di sini.

### 3. `PrdDoc` bertambah tiga field (aditif)

`shared/src/dto.ts` — `zPrdDoc` mendapat:

```ts
status: zPrdStatus,          // "draft" | "dieskalasi" | "terwujud"
specCount: z.number().int(), // jumlah backlog turunan
doneCount: z.number().int(), // yang stage-nya sudah done
```

Aditif murni: tak ada field yang berubah arti atau hilang. `live` **tak disentuh** — ia
menjawab pertanyaan lain (freshest-wins) dan tetap ortogonal terhadap status.

### 4. `listPrds` / `listAllPrds` — satu query, tanpa N+1

`server/src/services/project-prds.ts`:

- `listPrds(projectId, sessions, traces?)` — parameter ketiga **opsional**. Bila tak
  diberikan, ia menarik sendiri `prisma.spec.findMany({ where: { projectId },
  select: { stage, payload, branchFrom } })`.
- `listAllPrds(sessions)` — menarik trace untuk **semua** project sekali
  (`where: { projectId: { in: ids } }`), mengelompokkannya per project, lalu menyuntikkannya
  ke tiap `listPrds`. Tanpa ini daftar lintas-project jadi N+1.

Ukuran yang ditanggung, dari DB hidup: **337 baris `Spec`, 294 KB total `payload`** —
satu `findMany` empat kolom, tak perlu filter di SQL (kolom `payload` bertipe `Json` dan
`string_contains` Prisma tak seragam di SQLite; menyaring di JS lebih jujur dan sudah cukup).

### 5. Dashboard — lencana + filter

`src/src/screens/PrdScreen.tsx`:

- **Lencana status** di `PrdSidebarItem` dan di header pane preview. Tone: `draft` →
  `neutral`, `dieskalasi` → `info`, `terwujud` → `ok`. Yang punya turunan membawa
  hitungannya: `dieskalasi 5/6`, `terwujud 4/4`.
- **Lencana `live` diganti kata**: `draft hidup` → **`sesi hidup`**. Kata "draft" kini milik
  status; membiarkannya di dua tempat membuat PRD yang hidup **dan** sudah dieskalasi
  memakai dua lencana yang saling membantah.
- **Filter status** — `Select` di baris header, di samping filter project:
  `Semua status · draft · dieskalasi · terwujud`. Menyaring di klien atas `items` yang
  sudah utuh di memori (tak ada paginasi server di layar ini; pola yang sama dengan filter
  project). Hasil kosong → `StateBlock` yang menyebut status yang sedang disaring, bukan
  "Belum ada PRD" yang menyesatkan.

## Keadaan tepi

| keadaan | perilaku |
|---|---|
| PRD baru, nol turunan | `draft` — persis maksud objective |
| Seluruh turunan dihapus | kembali `draft`; benar, tak ada lagi yang menurunkannya |
| Turunan di-revert dari `done` (ADR-0027) | `terwujud` → `dieskalasi`; status ini memang cermin keadaan sekarang, bukan stempel sekali-tulis |
| PRD dibaca dari worktree sesi hidup | status tetap dihitung dari DB project itu; `live` terpisah |
| Project tanpa `repoDir` | `listPrds` sudah `[]` lebih dulu — nol query trace |
| `payload` `null` / bentuk `qa` | tak cocok, tak melempar |
| Manifest `*.breakdown.md` | sudah dikecualikan `isPrd` sebelum status dihitung |

## Testing

**`shared/src/prd-status.test.ts`** (murni, tanpa DB)
- ketiga jalur eskalasi cocok: `Dari PRD: <path>`, `Dari PRD (breakdown): <path>\n\n…`,
  `payload.goal` `Wujudkan PRD <path>`
- K2: `branchFrom: "prd/<slug>"` tanpa jejak payload → cocok
- kontrol negatif: prosa memuat kata "PRD" tanpa path → **tidak** cocok (bentuk SPEC-244/273/407)
- kontrol negatif: PRD lain di project yang sama → tidak cocok; slug berawalan sama
  (`auth.md` vs `auth-device.md`) tidak saling cocok
- `payload` `null` / bentuk `qa` / non-objek → `false`, tanpa lempar
- transisi status: 0 turunan → `draft`; 1 dari 3 `done` → `dieskalasi` (3/1); 3 dari 3 →
  `terwujud`

**`server/test/project-prds.test.ts`** (perluasan)
- `listPrds` mengembalikan `status`/`specCount`/`doneCount` per PRD
- spec milik project lain **tak** mewarnai status
- `listAllPrds` memberi status yang benar untuk kedua project sekaligus

**`src/test/prd-screen.test.tsx`** (perluasan)
- lencana status muncul di daftar dengan hitungannya
- lencana `live` kini berbunyi `sesi hidup`
- filter status menyempitkan daftar; nol hasil → StateBlock yang menyebut statusnya

## Docs yang diperbarui (commit yang sama)

- `internal/docs/architecture/data-model.md` — bagian PRD: status turunan + dua kunci jejak
  + kontrol negatif
- `internal/docs/architecture/api-contract.md` — field baru `PrdDoc` di `GET /prds` &
  `GET /projects/:id/prds`
- `internal/skills/hanoman/SKILL.md` — satu butir ringkas berikut gotcha-nya

Keduanya sudah ter-link di `internal/docs/README.md`; tak ada dokumen baru, jadi index tak
bertambah baris.

## Non-goal (sadar)

- **Tak menyentuh baris prosa `Status:` di dalam dokumen PRD.** Ia ditulis agen sekali saat
  PRD lahir dan tak punya penulis kedua; mengejarnya berarti menulis ulang dokumen orang
  setiap kali backlog berubah. Lencana turunan adalah jawabannya, prosa itu tinggal riwayat.
- **Tak ada kolom `Spec.prdPath`.** Kendala brief eksplisit, dan relasi yang ada sudah cukup
  menentukan (25/25 terukur).
- **Tak ada ADR baru.** Tak ada keputusan arsitektur yang berubah — ADR-0018/0019 (turunkan
  bila bisa dihitung ulang), ADR-0041, dan ADR-0069 justru ditegakkan.
- **Tak ada filter/urutan di sisi server.** Daftar PRD tak berpaginasi; menyaring di klien
  konsisten dengan filter project yang sudah ada.
