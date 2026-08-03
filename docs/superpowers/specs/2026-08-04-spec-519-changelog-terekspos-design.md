# SPEC-519 — Changelog terekspos dan mudah dijangkau

**Tanggal:** 2026-08-04 · **Sumber:** brief · **Prioritas:** sedang
**Melanjutkan:** SPEC-516 / [ADR-0105](../../../internal/docs/adr/0105-changelog-per-project.md) (mesin changelog),
[ADR-0071](../../../internal/docs/adr/0071-link-ticket-triase-deeplink-sharetoken.md) (deep-link hash SPA),
[ADR-0038](../../../internal/docs/adr/0038-paginasi-di-response-layer.md) (paginasi/filter di layer response).
**Tanpa ADR baru** — tak ada keputusan arsitektur yang berubah: mesin, kontrak generate, capability
domain, dan skema tetap persis seperti ADR-0105. Yang berubah cuma **permukaan** (letak & jangkauan),
kelas yang sama dengan SPEC-489 ("panduan agen punya URL", tanpa ADR).

## Masalah

`ChangelogPanel` (SPEC-516) hanya dirender di satu tempat: `ProjectDetailScreen.tsx:141`, yaitu
`section === "project"` — layar yang **tidak punya entri sidebar sendiri** (`Shell active="projects"`).
Jalur satu-satunya untuk sampai ke sana: sidebar **Projects** → klik satu project → gulir melewati
kartu Help Center, Auto-merge, dan Custom agent. Tiga klik plus scroll, tanpa satu pun label
"changelog" yang terlihat sebelum langkah terakhir.

Tiga akibat yang terukur dari kode hari ini:

1. **Tak ada titik masuk yang bisa dilihat.** 12 entri `HN_NAV` (`src/src/ds/shell.tsx:17`) tak memuat
   changelog; tak ada tombol changelog di topbar mana pun; `OverviewScreen` tak menyebutnya.
2. **Tak ada URL.** hanoman bukan router SPA (ADR-0071); satu-satunya deep-link yang ada adalah
   `#spec=<id>` (`screens/deeplink.ts`). Changelog karena itu tak bisa dibagikan, di-bookmark, atau
   dibuka langsung dari notifikasi/chat.
3. **Daftar rilisnya tumpul.** Blok "Tersimpan" di panel memanggil `listChangelogs(p.id, {limit: 10})`
   — sepuluh teratas, tanpa kotak cari, tanpa paginasi, tanpa area gulir sendiri, dan tanpa tanggal.
   Begitu sebuah project melewati 10 rilis, sisanya **tak terjangkau dari UI mana pun**.

## Objective

Changelog punya titik akses yang jelas dan mudah dijangkau — entri navigasi tersendiri **dan** halaman
yang bisa dibuka langsung lewat tautan — lengkap dengan daftar rilis yang bisa digulir dan dicari.

## Batasan (dari brief)

- Ikuti design system editorial / bone paper / brass (`internal/docs/design-system/**`).
- **Reuse endpoint changelog yang sudah ada; jangan duplikasi logika git tag.** Konsekuensinya
  mengikat: `services/changelog/collect.ts` (`listTags`), `generate.ts`, `render.ts`, `scrub.ts`
  **tak disentuh sama sekali** di spec ini, dan tak ada route baru — hanya satu parameter query
  aditif pada `GET /projects/:id/changelog` yang sudah ada.

## Keputusan desain

### 1. Entri sidebar `Changelog` + section `changelog`

`HN_NAV` bertambah satu entri (`key: "changelog"`, ikon lucide `megaphone`) tepat di bawah
`Docs · SoT` — kelompok "hasil kerja yang dibaca manusia", bukan kelompok eksekusi.

**Pasangan wajib:** komentar di `shell.tsx:12` menyatakan setiap key nav **harus** punya cabang
`section === …` di `App.tsx`; kalau tidak, `screen` tetap `null` dan App merender **kosong** —
sidebar ikut hilang dan pengguna terjebak sampai reload (`runs`/`triggers` pernah begitu, SPEC-162).
Jadi entri nav dan cabang App lahir dalam satu langkah, dan diikat satu test kontrak yang
mengenumerasi `HN_NAV` melawan cabang App, bukan hanya menguji entri barunya.

**Alternatif yang ditolak:** (a) tombol di topbar `Shell` — topbar sudah penuh (Update, Bell,
LimitBadge, CodexLimitBadge, actions, AccountMenu) dan tombol di sana berlaku global, sementara
changelog selalu milik satu project; (b) modal dari Projects — modal tak bisa di-bookmark dan
membuat "daftar yang digulir" berebut ruang dengan hasil generate.

### 2. `ChangelogScreen` — satu project, dua kartu

```
┌ Shell active="changelog" · actions: [Select project] [Salin link] ────────────┐
│ ┌ Card "Ringkasan perubahan untuk pemakai" (ChangelogPanel, tak berubah) ───┐ │
│ │ [Rentang tanggal][Rentang commit][Versi rilis]  … field …  [Bangkitkan]   │ │
│ │ hasil terakhir: badge naratif/draf · MarkdownView                          │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Card "Rilis" ─────────────────────────────────────────────────────────────┐ │
│ │ [🔎 cari judul atau isi…]                                    12 rilis     │ │
│ │ ┌ daftar bergulir (maxHeight 340) ───────────────────────────────────────┐ │ │
│ │ │ v1.2.0 · versi · 4 Agu 2026 · 7 perubahan · [naratif]        [hapus]  │ │ │
│ │ │ Juli 2026 · rentang tanggal · 1 Agu 2026 · 12 perubahan · [draf]      │ │ │
│ │ └────────────────────────────────────────────────────────────────────────┘ │ │
│ │ [Pager]                                                                    │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Card rilis terpilih: judul · MarkdownView · [Salin][Unduh .md][Salin link] ┐ │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Pemilih project di `actions`** mengikuti pola `section === "docs"` (`App.tsx:1201`): `Select`
  ber-`size="sm"` yang menulis `setProjectId`. Satu sumber "project yang sedang dibuka", sama dengan
  Docs/IDE — bukan `projectFilter` (pemilik makna "daftar disaring ke project mana", SPEC-146).
- **Generator dipakai ulang apa adanya.** `ChangelogPanel` tetap komponennya; yang dicabut darinya
  hanya blok "Tersimpan" (limit 10, tanpa cari) karena layar ini menggantikannya dengan daftar penuh.
  Panel mendapat satu prop baru `onGenerated?: (v: ChangelogView) => void` supaya daftar ikut segar
  begitu rilis baru lahir — tanpa itu operator harus pindah layar untuk melihat hasilnya masuk daftar.
- **Daftar bergulir dengan tinggi berbatas** (`maxHeight` + `overflowY: "auto"`), **bukan**
  `LIST_SCROLL_STYLE`. Alasannya terukur di audit SPEC-393: rantai flex yang menembus `Card` putus
  kecuali prop `fill` dipasang, dan pane yang **berbatas sendiri** terbukti aman justru karena tak
  bergantung pada rantai itu. Kartu ini duduk di antara dua kartu lain di kolom yang menggulir
  bersama `<main>`; tinggi tetap adalah bentuk yang benar di sini, bukan kompromi.
- **Detail rilis kartu terpisah** — `MarkdownView` (sama seperti hasil generate) plus Salin, Unduh
  `.md` (`?download=md`, ADR-0078), Salin link, dan Hapus.

### 3. Deep link `#changelog=<projectId>[&cl=<changelogId>]`

Mengikuti ADR-0071 apa adanya: hash fragment, di-parse **sekali saat mount** di `App.tsx`, lalu
dibersihkan dengan `history.replaceState` agar tak memicu ulang. `screens/deeplink.ts` bertambah dua
fungsi murni bersebelahan dengan `parseSpecHash`/`specDeepLink`:

```ts
parseChangelogHash(hash): { projectId: string; changelogId: string | null } | null
changelogDeepLink(projectId, changelogId?, loc?): string
```

Tanpa `cl=` tautan membuka halaman changelog project itu; dengan `cl=` ia langsung memilih satu rilis.
Tombol **Salin link** di header memakai bentuk pertama, tombol di kartu detail memakai bentuk kedua.

**Gotcha yang dijaga test:** `parseSpecHash` memakai `(?:^|[#&])spec=` dan `parseChangelogHash` memakai
`(?:^|[#&])changelog=`; keduanya tak boleh saling menangkap (`#changelog=p1` bukan spec, `#spec=X`
bukan changelog). Efek mount juga wajib **saling eksklusif** — satu hash, satu section.

### 4. Cari = satu parameter aditif di endpoint yang sudah ada

`GET /projects/:id/changelog?q=<teks>` — **bukan** route baru. Filter dijalankan di **layer response**,
persis pola ADR-0038 yang sudah dipakai route ini (`findMany` set penuh → `paginate`): baris disaring
lebih dulu, `paginate` menerima hasil saringan sehingga `total`/`pageCount` konsisten dengan apa yang
dilihat operator.

Predikatnya fungsi murni di `@hanoman/shared`:

```ts
changelogMatches(row: {title, body, mode}, q: string): boolean
```

— case-insensitive, trim, `q` kosong → semua lolos. Ditaruh di shared (bukan di route) karena ia
kontrak yang bisa diuji tanpa DB dan tanpa Fastify, dan karena web memakai definisi yang sama untuk
menyorot/menjelaskan hasil kosong. Pencarian **server-side**, bukan grep di klien: badan rilis bisa
ribuan byte dan daftar berpaginasi — menyaring di klien berarti hanya halaman yang sedang tampil
yang bisa dicari, yakni bug yang sedang kita perbaiki dalam bentuk baru.

**Ini satu-satunya perubahan sisi server di spec ini.** Tak ada model baru, tak ada migration, tak ada
capability baru (`docs`, tak berubah), tak ada sentuhan pada `listTags`/git.

### 5. Project detail: panel → pintu

`ProjectDetailScreen` melepas `<ChangelogPanel>` dan mendapat **`Door`** "Changelog" di grid pintu yang
sudah ada (bersama Source of Truth / Buka terminal / Lihat backlog), yang menavigasi ke section
changelog dengan project itu terpilih. Alasan tidak menyimpan keduanya: dua salinan generator berarti
dua tempat yang bisa berbeda perilaku, dan pintu **sudah** menjadi kosakata layar itu untuk "area lain
milik project ini". Discoverability naik di dua arah sekaligus — sidebar untuk yang mencari changelog,
pintu untuk yang sedang membaca project.

## Yang TIDAK dikerjakan

- Mesin changelog: `collect.ts` / `generate.ts` / `render.ts` / `scrub.ts` — nol perubahan.
- Skema Prisma, migration, `FIELDS`/`DATE_FIELDS` sync, `PG_ORDER`, `WEBHOOK_ENTITIES`.
- Capability & gerbang agent token (`docs` tetap, `capabilityForRoute` tak berubah karena tak ada
  route baru).
- Katalog MCP (`mcp-catalog.ts`) — spec ini tak menambah tool.
- Halaman changelog publik tanpa login. Changelog tetap di balik auth; brief tak memintanya dan itu
  keputusan yang butuh ADR sendiri (permukaan publik = kelas ADR-0062/0071).

## Bentuk unit & batasnya

| Unit | Tugas | Bergantung pada |
|---|---|---|
| `shared/src/changelog.ts` → `changelogMatches` | predikat cari, murni | — |
| `server/src/routes/changelog.ts` | terima `?q=`, saring sebelum `paginate` | `changelogMatches` |
| `src/src/screens/deeplink.ts` | parse & bangun hash changelog, murni | — |
| `src/src/screens/ChangelogPanel.tsx` | generator (tiga mode) + hasil | api client |
| `src/src/screens/ChangelogScreen.tsx` | pilih project · rakit panel + daftar + detail | panel, api, deeplink |
| `src/src/ds/shell.tsx` | entri nav | — |
| `src/src/App.tsx` | cabang section + efek mount deep-link | screen, deeplink |

## Rencana test (TDD, merah dulu)

1. `shared/src/changelog.test.ts` — `changelogMatches`: judul, isi, mode, case-insensitive, `q` kosong
   lolos semua, `q` spasi doang lolos semua, tak cocok → false.
2. `server/test/changelog.route.test.ts` — `?q=` menyaring; `total` ikut menyusut (bukan total penuh);
   tanpa `q` perilaku lama identik.
3. `src/src/screens/deeplink.test.ts` — parse dua bentuk hash, tolak hash spec, builder simetris
   dengan parser (round-trip), id ter-encode.
4. `src/src/screens/ChangelogScreen.test.tsx` — daftar tampil & bergulir (elemen ber-`overflowY`),
   ketik di kotak cari → `listChangelogs` dipanggil ulang dengan `q`, klik baris → badan rilis
   terender, keadaan kosong menjelaskan sebabnya (belum ada rilis vs cari tak ketemu).
5. `src/src/ds/shell.test.tsx` (kontrak nav) — setiap key `HN_NAV` punya cabang `section === "<key>"`
   di sumber `App.tsx`. Menjaga kelas bug `runs`/`triggers`, bukan cuma entri baru ini.
6. `src/src/screens/ChangelogPanel.test.tsx` — tetap hijau; blok "Tersimpan" yang dicabut tak boleh
   menyisakan assertion basi, dan `onGenerated` dipanggil sesudah generate sukses.

Test web dijalankan dengan `env -u NODE_ENV` (mode production membuat RTL `act` gagal — SPEC-293);
test server dengan `--no-file-parallelism` + `TEST_DATABASE_URL` sendiri (SPEC-397/479).

## Docs yang tersentuh (commit yang sama)

- `internal/docs/architecture/api-contract.md` — parameter `q` pada `GET /projects/:id/changelog`.
- `internal/docs/frontend/frontend-implementation.md` — section `changelog`, entri nav, deep-link.
- `internal/skills/hanoman/SKILL.md` — butir SPEC-516 diperluas satu kalimat SPEC-519 (letak & tautan).
- `internal/docs/README.md` — hanya bila ada berkas doc baru (tidak ada; semuanya perbarui yang ada).
