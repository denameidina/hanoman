# ADR-0105 — Changelog per project: `Spec.doneAt` berkolom, hasil tersimpan LOCAL-only, narasi agen ber-fallback

- **Status:** Diterima (2026-08-03)
- **Konteks SPEC:** SPEC-516
- **Menegakkan:** ADR-0018/0019 (nilai turunan), ADR-0033 (notifikasi selesai), ADR-0037 (guardrail dicabut), ADR-0078 (unduh dokumen), ADR-0091 (lead sebagai agen one-shot), ADR-0099 (MCP), ADR-0100 (webhook)
- **Melanjutkan arah:** ADR-0090 (stempel waktu backlog sebagai kolom), ADR-0103 (notifikasi `done:` sebagai stempel selesai)

## Konteks

hanoman menyimpan seluruh bahan sebuah changelog tapi tak punya permukaan yang menyajikannya
untuk manusia non-teknis. Backlog (`Spec`), riwayat git per repo project, dan tag rilis — ketiganya
teknis dan tersebar. Yang hilang adalah **satu teks pendek** yang bisa ditempel ke pengumuman
rilis: apa yang berubah bagi pemakai, bukan berkas atau fungsi apa yang disentuh.

Tiga hambatan konkret muncul begitu fitur ini dirancang:

1. **Tak ada stempel "selesai".** `Spec` punya `createdAt` dan `startedAt` sejak ADR-0090, tapi tak
   punya kolom yang menjawab *kapan item ini selesai*. `updatedAt` bukan proksinya — mesin sync
   mem-*bump* `version` dan overlay stage-live menulis tiap `GET /specs` dibaca, jadi ia bergerak
   tanpa ada manusia (ADR-0090).
2. **Sumbernya teknis, keluarannya harus tidak.** Subject conventional-commit dan objective backlog
   memuat nama berkas, hash, dan nomor SPEC. Perakitan deterministik atas bahan seperti itu
   menghasilkan daftar backlog, bukan prosa untuk pemakai.
3. **Dua dari tiga mode butuh checkout git di mesin ini,** dan repo tanpa remote atau tanpa tag
   adalah keadaan yang lumrah — bukan kegagalan sistem.

## Keputusan

### 1. `Spec.doneAt` adalah kolom, dan penulisnya SATU

`doneAt DateTime?` ditambahkan ke `Spec`. Arahnya sama dengan ADR-0090 dan **berlawanan dengan
ADR-0018/0019**, dan itu disengaja: aturannya bukan "selalu turunkan" melainkan *bisakah dihitung
ulang dari sumber lain* — coverage bisa, diff bisa, **kapan sebuah baris selesai tidak**.

`stage = "done"` dipersist di **tiga** tempat (`routes/terminal.ts` `advanceStage`,
`services/scheduler/reconcile.ts`, `services/live-specs.ts`). Kolom ini **tidak** ditulis di satu
pun dari ketiganya: ia ditulis **di dalam `recordCompletion()`**, satu-satunya fungsi yang sudah
dipanggil oleh ketiganya dan yang oleh ADR-0103 sudah ditetapkan sebagai "stempel selesai yang
sudah ada di ketiga jalur". Menyalin efek samping ke banyak call site adalah kelas bug yang sudah
menggigit repo ini tiga kali — SPEC-431 (`baseSha`), SPEC-448 (`rootBypassEnv`), SPEC-475
(`headSha`) — dan efek samping, tak seperti predikat, **tak punya tipe yang memaksanya konsisten**.
`PATCH /specs/:id` hanya bisa memundurkan stage (guard 422), jadi ia bukan pintu keempat.

### 2. Tulis-sekali, dan revert tidak membatalkannya

`updateMany({ where: { id, doneAt: null } })` membuat penulisan idempoten sekaligus tak melempar
bila spec sudah dihapus. Maknanya karena itu **selesai pertama**, cermin `startedAt` = mulai
pertama (ADR-0090) dan cermin idempotensi `recordCompletion` (ADR-0033: reopen lalu selesai lagi
tak menotifikasi ulang). Memundurkan stage **tidak** mengosongkan `doneAt`. Diterima sadar: sebuah
changelog bicara tentang apa yang pernah dikirim ke pemakai, dan itu tak dibatalkan oleh keputusan
internal untuk membuka kembali sebuah item.

### 3. Backfill dari notifikasi `done:<specId>`

Migration mengisi kolom baru dari `Notification.createdAt` ber-`key = 'done:' || Spec.id` — sumber
yang sama yang dipakai sweep auto-merge ADR-0103, tersedia untuk seluruh riwayat sejak SPEC-180.
Item yang selesai sebelum SPEC-180, atau yang notifikasinya dihapus operator, tetap `null`; mereka
**dilaporkan sebagai catatan** di hasil changelog, bukan disamarkan.

`doneAt` masuk `FIELDS.spec` **dan** `DATE_FIELDS.spec`.

### 4. `Changelog` adalah model LOCAL-only

Hasil pembangkitan disimpan (bukan diturunkan ulang) supaya bisa dibuka lagi tanpa membakar kuota
agen. Tabelnya **tanpa kolom `version`**, jadi ia tak pernah masuk changefeed sync — cermin
`LeadFlow`, `WebhookEndpoint`, dan `Project.autoMerge`. Alasannya: dua dari tiga modenya diturunkan
dari checkout git di **mesin ini**, jadi barisnya fakta lokal. Yang portabel adalah keluarannya,
dan jalannya sudah ada — unduh `.md` (ADR-0078).

### 5. `think()` DIIMPOR, bukan disalin

Narasi dihasilkan satu panggilan agen one-shot lewat `think()` dari `services/lead/brain.ts`. Itu
bukan kenyamanan melainkan inti keputusannya: hanoman punya **dua** titik spawn agen (`pty.ts` dan
`lead/brain.ts`), dan titik ketiga akan mengulang SPEC-448 — di sana `rootBypassEnv` ada di
`pty.ts` tapi tak pernah menyeberang ke `brain.ts`, dan lead gagal **100 %** di setiap instance yang
servernya jalan sebagai root (`User=root` adalah konfigurasi deploy RESMI). `think()` sudah membawa
gerbang root, `stdin.end()`, `maxBuffer` 16 MiB, dan `leadFailureReason()` yang membaca kedua stream.

Agen/model/effort dari `sessionAgentDefaults()` — bukan `sessionModel()`, yang sengaja khusus claude
dan akan melahirkan `codex -m claude-opus-5` (SPEC-377). Prompt **menyebutkan anggaran waktunya
sendiri**: SPEC-432 mengukur agen berbatas waktu yang tak diberi tahu batasnya memakai 306 dtk untuk
pekerjaan yang, dengan satu paragraf anggaran, selesai dalam 101 dtk.

### 6. Gagal agen bukan galat

Agen yang gagal, tak terpasang, atau menjawab kosong **tidak** menggagalkan permintaan: baris tetap
lahir dengan `generator: "fallback"`, draf deterministik sebagai `body`, dan `warning` berisi alasan
yang bisa dibaca operator. Fitur tetap hidup di mesin tanpa CLI agen, dan seluruh logikanya bisa
diuji tanpa men-spawn apa pun.

### 7. Scrub di dua sisi; yang menentukan adalah sisi INPUT

`scrubSubject`/`scrubBody` dijalankan **sebelum** bahan diserahkan ke agen, `scrubOutput` sesudahnya.
Cara terkuat mencegah kebocoran teknis adalah tak pernah menyerahkannya — SHA bahkan tak pernah
dikumpulkan dari `git log`, bukan sekadar tak dirender. Ketiganya murni dan diuji langsung,
**berikut kontrol negatif**: prosa Indonesia biasa, nama produk ber-kapital tengah, dan angka besar
harus lewat utuh.

### 8. Capability domain `docs`, bukan `projects`

`capabilityForRoute` memetakan `projects/:id/<sub>` yang tak dikenal ke `rw("projects")`. Tanpa
entri eksplisit, agen harus dipercaya menyunting & menghapus project hanya untuk membaca changelog.
Changelog adalah **dokumen**, sejajar `docs`/`prds` yang sudah ada di cabang yang sama. Diikat test
di `agent-capabilities.test.ts`.

### 9. Keadaan sah dijawab 422, tak pernah 500

Repo belum ditautkan, repo tanpa tag, revisi tak dikenal, rentang kosong, rentang terbalik — semua
adalah keadaan yang lumrah, bukan kegagalan sistem. Pengumpul memulangkan `{ ok:false, reason }`
berbahasa manusia dan route menerjemahkannya ke **422 + pesan** (400 untuk rentang terbalik, ditolak
zod sebelum menyentuh repo). `GET …/changelog/sources` menjawab **200 dengan `reason`** supaya form
bisa menjelaskan alasannya sebelum operator menekan tombol.

## Konsekuensi

- Satu migration aditif (satu kolom + satu tabel), nol tabel diredefinisi, nol baris pra-migrasi
  berubah perilaku.
- Kuota agen menumpang langganan yang sama seperti lead — konsekuensi yang sudah diterima ADR-0091
  (OQ-1), terlihat di badge limit yang ada, bukan akunting terpisah.
- Setiap pembangkitan menyimpan satu baris. Operator yang membangkitkan ulang mendapat baris baru;
  penghapusan manual tersedia.

## Alternatif yang ditolak

- **Perakitan deterministik saja.** Gratis dan instan, tapi hasilnya tetap terbaca sebagai daftar
  backlog — kebalikan dari yang diminta. Dipertahankan sebagai *fallback*, bukan sebagai jalur utama.
- **`updatedAt` sebagai stempel selesai.** Bergerak tanpa ada manusia (ADR-0090).
- **`startedAt` + `stage=done`.** Maknanya "mulai"; item yang dikerjakan lintas bulan jatuh di
  rentang yang salah.
- **Changelog sebagai nilai turunan tanpa tabel.** Sejalan ADR-0018, tapi setiap tampilan ulang
  membakar satu panggilan agen.
- **Urutan tag menurut tanggal untuk menemukan "versi sebelumnya".** Tanggal tag anotasi beresolusi
  detik: dua rilis di menit yang sama berakhir seri dan git jatuh ke urutan NAMA. Diganti
  `git describe --abbrev=0 <tag>^`, yang mengikuti **riwayat**.

## Non-goal (sadar, bukan kelalaian)

- **Tanpa tool MCP.** Katalog ADR-0099 punya versi skema sendiri; REST + panduan agen sudah memenuhi
  "agen bisa memanggilnya".
- **Tanpa peristiwa webhook.** `Changelog` sengaja tak masuk `WEBHOOK_ENTITIES` (ADR-0100): ia
  artefak yang dibangkitkan atas permintaan, bukan perubahan keadaan yang perlu disiarkan.
- **Tanpa sync lintas mesin** untuk baris `Changelog`.
- **Tanpa penjadwalan otomatis** dan **tanpa terbit ke luar** (GitHub Release, dsb.).

## Gotcha wajib

1. **`PG_ORDER` harus memuat model baru.** `cli/test/migrate-pg.test.ts` menuntutnya **sama persis**
   dengan daftar model DMMF — itulah satu-satunya gerbang yang menangkap model yang lupa
   didaftarkan, dan `Changelog` wajib berada **sesudah** `Project` (FK).
2. **`doneAt` wajib ada di `FIELDS.spec` DAN `DATE_FIELDS.spec`.** `upsert` yang tak menyebut sebuah
   kolom **tetap berhasil**, jadi kolom yang terlewat mendarat sebagai null palsu di setiap client
   tanpa satu pun error — kelas gagal-senyap ADR-0090/0093/0094.
3. **Batas hari harus LOKAL, bukan UTC.** `new Date("2026-07-31")` adalah tengah malam UTC dan
   sebagai batas `to` ia membuang hampir seluruh hari itu di WIB. Dipakai ulang `dayStart`/`dayEnd`/
   `inDayRange` dari `services/date-range.ts`, dan `dayString` di `@hanoman/shared` sengaja tak
   memakai `toISOString()`.
4. **Regex scrub camelCase wajib menuntut ≥2 huruf kecil di kedua sisi kapital.** Tanpa itu `macOS`
   dan `iOS` ikut terbuang bersama `macOptionClickForcesSelection`. Regex hash serupa: wajib memuat
   satu digit **dan** satu huruf a–f, kalau tidak `1000000` terbaca sebagai sha.
5. **`sources` menjawab 200, bukan 4xx, saat repo belum ditautkan.** Ia adalah pertanyaan "apa yang
   tersedia", dan jawaban "tidak ada, ini sebabnya" adalah jawaban yang sah.
