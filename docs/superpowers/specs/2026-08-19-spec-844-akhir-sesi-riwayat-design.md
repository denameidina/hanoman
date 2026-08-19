# SPEC-844 — Riwayat sesi mencatat **bagaimana** sebuah sesi berakhir

**Tanggal:** 2026-08-19 · **Source:** qa (GitHub issue #9) · **Prioritas:** sedang
**ADR:** 0125 (baru) · **Migration:** ya (`SessionHistory` + 2 kolom + backfill sekali jalan)
**Audit:** `internal/docs/research/audit-spec-844-sesi-direkonsiliasi-terbaca-selesai.md`

## Masalah

`SessionHistory` mencatat **kapan** sebuah baris berakhir, tak pernah **bagaimana**. Tiga akhir
yang berbeda dipadatkan ke dua kolom nullable yang sama, dan dua di antaranya jadi tak
terbedakan:

| akhir sesi | penulis | `endedAt` | `exitCode` | hari ini |
|---|---|---|---|---|
| operator menutup sesi, pane masih hidup | `finishSession` | `now` | `null` | `selesai` hijau |
| operator menutup sesi, pane sudah mati | `finishSession` | `now` | `p.code` | `selesai` / `exit N` |
| tmux lenyap di luar hanoman (reboot/crash) | `reconcileHistory` | `updatedAt` | `null` | `selesai` hijau |

Karena baris 1 dan 3 identik di DB, **tak ada perbaikan murni-UI yang mungkin** — membalik
`statusOf()` akan salah melabeli 764 penutupan normal. Terukur di DB hidup: **784 dari 797 baris
berakhir (98,4 %) hijau tanpa bukti sukses**; 20 di antaranya rekonsiliasi, **20/20 berdurasi
0 ms dan 20/20 tanpa transkrip**. Detail & angka lengkap di dokumen audit.

## Keputusan

### 1. Yang disimpan = **cara sebuah baris ditutup**; kelas hasilnya **diturunkan**

Dua kolom baru, keduanya `String?`/`DateTime?` tanpa default:

- **`endedReason`** — `"closed"` (hanoman menutupnya lewat `killSession()`) atau `"reconciled"`
  (pane sudah lenyap saat boot; hasil **tak diketahui**). `null` = baris lahir sebelum kolom ini
  ada dan tak tercatat.
- **`reconciledAt`** — kapan boot menemukan panenya lenyap. Hanya terisi bersama
  `endedReason: "reconciled"`.

Issue menyarankan enum empat nilai `completed|failed|interrupted|reconciled_unknown` **di
kolom**. Ditolak sebagai bentuk penyimpanan: `completed`/`failed` **bisa dihitung ulang** dari
`exitCode` yang sudah tersimpan, dan menyimpan keduanya membuat dua sumber yang bisa berselisih
(ADR-0011/0018). Yang **tidak** bisa dihitung ulang adalah siapa yang menutup barisnya — arah
yang sama dengan ADR-0090 (`Spec.createdAt`): aturannya bukan "selalu turunkan", melainkan
*bisakah dihitung ulang dari sumber lain*.

Kosakata empat nilai itu tetap dikirimkan — sebagai **hasil turunan** dari satu fungsi murni
`sessionOutcome()` di `@hanoman/shared`, jadi permukaan yang dilihat operator & integrator persis
yang diminta issue tanpa kolom yang bisa drift:

| `endedAt` | `endedReason` | `exitCode` | `sessionOutcome()` | label | tone |
|---|---|---|---|---|---|
| `null` | — | — | `running` | `berjalan` | neutral |
| terisi | `reconciled` | apa pun | **`interrupted`** | **`terputus`** | **warn** |
| terisi | `closed` / `null` | `null` atau `0` | `completed` | `selesai` | ok |
| terisi | `closed` / `null` | ≠ 0 | `failed` | `exit N` | err |

`null` dibaca **seperti `closed`**: fail-safe ke perilaku hari ini untuk 784 baris lama, dan nilai
asing di masa depan (kolomnya `String`, bukan enum DB) jatuh ke cabang yang sama alih-alih
melempar di boundary — cermin pembacaan `kind`/`agent` yang sudah longgar di baris ini.

`exit 143` (SIGTERM, kelas SPEC-402) sengaja **tetap** `failed` dengan kodenya terlihat, bukan
dilebur jadi `interrupted`: kode yang tercetak lebih informatif daripada kategorinya, dan itu
bukan bagian dari temuan.

### 2. `endedAt` baris rekonsiliasi tetap batas **BAWAH**; `reconciledAt` batas atasnya

Komentar `session-history.ts:127` mengklaim `updatedAt` = "waktu terbaik yang tersedia". Itu
keliru dan terukur: service ini hanya menulis saat **lahir** dan **tutup**, jadi `updatedAt` baris
berjalan = waktu lahirnya — **20 dari 20** baris rekonsiliasi ber-`endedAt − startedAt` = **0 ms**,
sehingga sesi yang hidup 22 j 50 mnt tercatat "0 dtk".

`endedAt` **tidak** dipindah ke waktu boot: itu akan mengarang klaim bahwa sesinya hidup selama
seluruh downtime. Ia tetap batas bawah yang jujur ("terakhir diketahui hidup"), `reconciledAt`
jadi batas atas, dan **durasinya tak dirender sama sekali** (`—`) — perluasan prinsip yang sudah
ditulis di `humanDuration`: *"Sesi yang belum ditutup tak punya durasi — jangan mengarang 0 dtk"*.

Konsekuensi `retention.ts` disengaja dan tak berbahaya: baris rekonsiliasi jadi kandidat purge
sedikit lebih awal (selisihnya jam, ambangnya 30 hari).

### 3. Backfill sekali jalan di migration, berambang yang **terukur**

Baris lama tak bisa ditanyai, tapi jejaknya masih ada: `reconcileHistory` membaca `updatedAt`
**sebelum** update-nya sendiri, sementara `finishSession` menulis `endedAt = new Date()` **di
dalam** update yang sama. Terukur di DB hidup:

| kelompok | n | `updatedAt − endedAt` |
|---|---|---|
| tutup normal | 777 | **0 – 39 ms** |
| rekonsiliasi | 20 | **275 966 – 82 224 277 ms** |

Ambang **60 000 ms** duduk di tengah celah empat orde besaran itu (margin 1 538× ke satu sisi,
4,6× ke sisi lain). Arah salahnya fail-safe: yang **terlewat** tetap terbaca persis seperti hari
ini (`closed`), yang **kelebihan** menuntut update `finishSession` mendarat > 60 dtk sesudah
`endedAt` dihitung — mustahil, keduanya satu pernyataan.

Heuristik ini **hanya** backfill, **bukan** aturan render (lihat hipotesis terbantah di audit).

### 4. Baris terputus menjelaskan dirinya, dan menawarkan jalan keluar

Detail baris `interrupted` merender `Callout` warn yang menyatakan tiga hal yang selama ini
disembunyikan: hasilnya tak diketahui, tak ada exit code, dan transkripnya kemungkinan besar tak
ada — `captureTranscript()` berjalan di dalam `killSession()` dan pada jalur ini tmux sudah lenyap
(**20 dari 20** baris rekonsiliasi tanpa transkrip). Pesan "Tanpa transkrip" yang lama menyebut
dua sebab yang **keduanya salah** untuk baris ini, jadi ia diganti untuk kasus terputus.

CTA pemulihan **tak perlu jalur baru**: "Mulai lagi" (`restartableKind`, ADR-0079) sudah men-spawn
sesi baru dengan konteks yang sama lewat endpoint yang sudah ada. Yang kurang cuma keterangan
kenapa operator perlu menekannya, dan itulah isi Callout. Metadata detail ikut berubah: `Selesai`
→ **`Terakhir terlihat hidup`**, plus baris **`Terdeteksi mati`** (`reconciledAt`).

### 5. Kontrak keluar ikut diperbaiki, bukan hanya UI

`shared/src/webhook.ts` mendokumentasikan `session.ended` sebagai *"exitCode … null berarti tak
terbaca, misalnya tmux mati di luar hanoman"* — satu kalimat yang **memancarkan konflasi yang
sama** ke setiap integrator dan ke halaman dokumentasi in-app yang disetir katalog itu.
`endedReason` + `reconciledAt` masuk allowlist `fields` (dijaga `webhook-catalog-dmmf.test.ts`)
dan prosanya ditulis ulang.

Peristiwa turunan **tak berubah**: `derived.changed` tetap `["endedAt"]`, dan ketiga kolom selalu
ditulis dalam satu `update` yang sama, jadi `session.ended` tetap yang menang. Perubahan yang
hanya menyentuh kolom baru tak mungkin terjadi; seandainya terjadi, `def.events.updated` tak ada
untuk entitas ini → `eventTypeFor` mengembalikan `null` (tak ada peristiwa hampa).

### 6. Yang **tidak** disentuh, dan itu disengaja

- **Baris `closed` tetap terbaca seperti hari ini.** 764 baris; menutup sesi yang panenya masih
  hidup adalah cara **normal** sesi sehat berakhir (`pty.ts:55` — TUI agen tak pernah mati
  sendiri, jadi pane sesi sukses justru selalu hidup). Melabelinya "terputus" menukar bug ini
  dengan kebalikannya yang 38× lebih besar.
- **`SessionHistory` tetap LOCAL-only** — tak masuk `FIELDS`/`SYNCED`/`PG_ORDER` sebagai model
  baru (ia sudah ada di `PG_ORDER`), tak ada `version`.
- **Tak ada filter/endpoint baru.** `GET /terminal/history` bertambah dua field di response;
  query-nya tak berubah.
- **`exitCode` tak disentuh sama sekali** — ia tetap satu-satunya sumber kelas sukses/gagal.

## Permukaan yang berubah

**prisma**
- `schema.prisma` — `SessionHistory.endedReason String?`, `reconciledAt DateTime?`.
- `migrations/20260819000000_session_history_ended_reason/migration.sql` — dua `ADD COLUMN`
  (nullable tanpa default → aman untuk SQLite, **tak** kena jebakan `DEFAULT CURRENT_TIMESTAMP`
  ADR-0090) + dua `UPDATE` backfill.

**shared**
- `session-end.ts` (baru) — `SESSION_END_REASONS`, `zSessionEndReason`, `SESSION_OUTCOMES`,
  `sessionOutcome()`, `SESSION_OUTCOME_LABEL`. Berkas sendiri, bukan tempelan di
  `session-kind.ts`: nama berkas itu akan berbohong.
- `index.ts` — ekspor berkas baru.
- `dto.ts` — `zSessionHistory` += `endedReason`, `reconciledAt` (keduanya
  `z.string().nullable()`).
- `webhook.ts` — allowlist `fields` + prosa `session.ended` + `sample`.

**server**
- `services/session-history.ts` — `Row`/`view` += dua kolom; `finishSession` menulis
  `endedReason: "closed"`; `reconcileHistory` menulis `endedReason: "reconciled"` +
  `reconciledAt` (satu stempel untuk seluruh sapuan boot) dan komentar yang keliru diperbaiki.

**frontend**
- `screens/SessionHistoryModal.tsx` — `statusOf` lewat `sessionOutcome()`; durasi baris terputus
  `—`; Callout + metadata detail.

## Test

Menutup keenam acceptance criteria issue, dan **dua** di antaranya harus diuji atas keadaan yang
selama ini dianggap sama:

1. `shared/src/session-end.test.ts` — tabel lengkap `sessionOutcome()`: berjalan · `closed`+null ·
   `closed`+0 · `closed`+1 · `reconciled` (dengan **dan** tanpa `exitCode`) · `endedReason: null`
   warisan · nilai asing.
2. `server/test/session-history.service.test.ts` — `finishSession` menulis `closed` &
   `reconciledAt` tetap null; `reconcileHistory` menulis `reconciled` + `reconciledAt` non-null
   dan `endedAt` **tetap** `updatedAt` lama (batas bawah, bukan waktu boot); baris hidup tak
   tersentuh.
3. `src/test/session-history-modal.test.tsx` — keempat status dirender: `berjalan`, `selesai`
   (exit 0), `exit 2`, dan **`terputus`** untuk baris `reconciled` — plus baris terputus berdurasi
   `—` bukan `0 dtk`, Callout penjelasnya muncul, dan "Mulai lagi" tetap ditawarkan.

## Docs (commit yang sama)

`internal/docs/adr/0125-*.md` (baru) + `internal/docs/adr/README.md` + `internal/docs/README.md`;
`internal/docs/architecture/data-model.md` §SessionHistory; `internal/docs/architecture/api-contract.md`
§riwayat sesi; `internal/docs/frontend/frontend-implementation.md` (kosakata status — sekalian
mencabut paragraf "muat lebih/IntersectionObserver" yang sudah usang sejak SPEC-523);
`internal/skills/hanoman/SKILL.md` §Riwayat sesi.
