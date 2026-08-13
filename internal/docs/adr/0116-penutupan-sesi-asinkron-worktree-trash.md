# ADR-0116 — Penutupan sesi asinkron: worktree dipindah ke `.trash`, penyapu latar yang menghapus

- Status: Accepted
- Tanggal: 2026-08-13
- SPEC: SPEC-742
- Terkait: **menegakkan** [0079](0079-history-sesi-terminal-store-lokal-plus-transkrip.md) (gerbang
  `ownsWorktree` SPEC-362 tak dilonggarkan sedikit pun),
  [0030](0030-spec-menyimpan-base-head-sha.md) & [0093](0093-dependency-antar-backlog.md) (bukti
  `headSha`/stage tetap direkam SEBELUM worktree lenyap), [0018](0018-coverage-nilai-turunan.md)/
  [0019](0019-sha-disimpan-diff-diturunkan.md) (catatan pembersihan = nilai turunan filesystem, bukan
  tabel), dan [0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md)/[0103](0103-auto-merge-saat-sesi-selesai.md)
  (pola sweep in-process yang di-`start` dari `server.ts`). **Tidak mencabut apa pun.**
  Mengubah **satu** kontrak: `DELETE /terminal/sessions/:id` kini `202`, bukan `204`.
  Tanpa migration, tanpa kolom, tanpa domain capability baru.

## Konteks

Menutup satu sesi di dashboard membuat UI menggantung **dan** memblokir seluruh pekerjaan lain.
`DELETE /terminal/sessions/:id` mengerjakan seluruh pembersihan sinkron di dalam satu request:
`advanceStage()` → `recordHeadSha()` → `killSession()` → `realGit.removeWorktree()`.

Diagnosis yang mudah — "request-nya sinkron, balas lebih awal" — **tidak cukup**, dan mengukur
premisnya yang menunjukkannya. Salinan worktree nyata (562 MB / 25 040 entri, hardlink clone di
volume APFS yang sama, detektor lag timer 20 ms):

| operasi | durasi | lag event loop terburuk | tick 20 ms selama operasi |
|---|---|---|---|
| `renameSync` | **1 ms** | 1 ms | — |
| `rmSync` (dipakai hari ini) | 1 370 ms | **1 364 ms** | **0** |
| `fs.promises.rm` | 947 ms | **3 ms** | 46 |

`rmSync` memblokir event loop selama **100 % durasinya**. Yang membeku karena itu bukan request
penutupnya saja melainkan **seluruh server** — setiap request lain mengantre di belakangnya, dan
itulah gejala "sesi lain tak bisa dibuka". Membalas 202 lebih awal lalu memanggil `removeWorktree`
di `setImmediate` hanya memindahkan pembekuannya beberapa milidetik ke belakang. Biayanya bahkan
dibayar dua kali: `removeWorktree` menjalankan `git worktree remove --force` (yang sudah menghapus
pohonnya, lewat `spawnSync`) **lalu** `rmSync` lagi.

Jalur **membuka** sesi terkena hal yang sama: `realGit.addWorktree` merebut path dengan
`worktree remove --force` + `rmSync`, dan membuka lagi backlog yang sudah `done` (SPEC-172)
melewatinya setiap kali.

## Keputusan

**Pindahkan, jangan hapus.** Bagian wajib-urut & murah tetap di dalam request; worktree-nya
di-`rename` ke `<repoDir>/.worktrees/.trash/<sesi>.<stempel>` — 1 ms — lalu request membalas.
Penghapusan byte dikerjakan penyapu latar dengan `fs.promises.rm`.

```
advanceStage() → recordHeadSha() → killSession() → ownsWorktree()? → trashWorktree() → 202
                                                                              ↓
                                                    services/worktree-reaper.ts (fs.promises.rm)
```

Tiga sifat sekaligus, dan ketiganya menjawab constraint SPEC-742 secara **struktural**:

1. **Path-nya benar-benar bebas saat respons kembali**, bukan dijanjikan bebas. Sesi baru untuk
   backlog yang sama langsung berhasil.
2. **Domain penyapu (`.trash/**`) lepas total dari setiap path hidup.** Penyapu tak punya cara
   menyentuh worktree sesi mana pun — jadi penutupan tumpang-tindih untuk sesi berbeda, dan sesi
   baru yang lahir selagi penyapuan jalan, aman **karena konstruksi**, bukan karena penguncian.
   Tak ada mutex, tak ada antrean, tak ada urutan yang harus dijaga.
3. **`.trash` itu sendiri adalah catatan durable-nya.** Isinya menurut konstruksi = sampah, aman
   dihapus siapa pun kapan pun, idempoten, selamat dari crash. "Bisa disapu ulang" jadi gratis:
   nol tabel, nol kolom, nol migration — nilai turunan, ADR-0018/0019.

**Jalur reclaim `addWorktree` memakai primitif yang sama.** Outcome SPEC-742 menyebut "sesi baru
untuk backlog yang sama" secara harfiah, dan tanpa ini penutupan jadi cepat sementara pembukaannya
tetap membekukan server. Ia dipanggil dari server saja (tiga call site), jadi tak ada pemakai CLI
yang akan menumpuk sampah tanpa penyapu.

**`DELETE` membalas `202 { cleanup: string | null }`**, bukan `204`. "Diterima, pembersihan lanjut
di latar" memang bukan "no content", dan `cleanup: null` menyatakan dengan jujur bahwa sesi tanpa
worktree (terminal biasa, shell) tak meninggalkan apa pun. Ini satu-satunya perubahan kontrak.

**Keadaan `closing` → `closed` diamati pada PEMBERSIHANNYA, bukan pada sesi.** Pane sudah mati dan
sesi tmux sudah lenyap saat kita membalas; menyintesis sesi hantu di `GET /terminal/sessions` justru
melawan janji "UI langsung melepas tab yang ditutup". Entri muncul di **`GET /terminal/cleanups`** =
`closing`, hilang = `closed`. Read model-nya peta di memori (frame siar `cleanups` karena itu gratis);
**kebenaran durable-nya tetap direktori `.trash`**, dan peta diisi ulang darinya saat boot & tiap tick.

**Kegagalan bersuara.** `rm` gagal → satu `Notification` `type:"cleanup"` ber-`key` unik per entri
(`P2002` diabaikan, cermin `recordCompletion`) → satu notifikasi per entri, **bukan** satu per tick;
entrinya tetap tinggal dan dicoba lagi.

## Alternatif yang ditolak

- **Balas 202, lalu `removeWorktree` di `setImmediate`.** Bentuk yang paling jelas dari nama
  spec-nya, dan ia tak memperbaiki gejala utamanya: event loop tetap beku 1,4 dtk (nol tick), sesi
  lain tetap tak bisa dibuka. Ditolak oleh pengukuran, bukan oleh selera.
- **Kunci per-path; peluncuran menunggu pembersihan selesai.** Memblokir lagi, cuma pindah tempat —
  dan "sesi baru untuk backlog yang sama" adalah persis kasus yang menunggu paling lama.
- **Path worktree ber-suffix unik.** Mengubah `<repoDir>/.worktrees/<id>` yang jadi kunci review,
  integrate, resume, dan gerbang dependency di belasan tempat. Biaya besar untuk masalah kecil.
- **Tabel `WorktreeCleanup`.** Migration + `FIELDS` sync + `PG_ORDER` + `WEBHOOK_ENTITIES`, untuk
  mencatat sesuatu yang **filesystem sudah catat lebih baik**: direktori itu tak bisa hanyut dari
  kenyataan, sementara barisnya bisa.
- **Sapu worktree yatim dengan menurunkannya dari `git worktree list`.** Berbahaya: worktree sesi
  yang pane-nya mati (`remain-on-exit`) tampak yatim tapi justru artefak yang dipakai "Lanjutkan"
  (ADR-0084). Hanya `.trash` yang aman-menurut-konstruksi.

## Konsekuensi

- `DELETE /terminal/sessions/:id` `204 → 202`. Klien satu-satunya (`api.deleteTerminal`) mengabaikan
  body; test yang mengunci 204 diperbarui.
- Byte worktree belum tentu sudah kembali ke disk saat respons kembali. Yang dijamin: path-nya
  bebas, dan byte-nya kembali segera sesudahnya. Untuk kasus disk penuh, entri `.trash` terlihat di
  `GET /terminal/cleanups`.
- Penyapu adalah timer in-process ke-enam (`server.ts`; `app.ts` tetap bebas-timer).
- Sesi yang lahir dari CLI/luar server tak akan pernah ada — `addWorktree` hanya dipanggil server —
  jadi tak ada `.trash` yang lahir tanpa penyapu yang memilikinya.

## Gotcha wajib

1. **`rmSync` → `fs.promises.rm`, dan itu bukan kosmetik.** Terukur 1 364 ms vs 3 ms lag event loop
   untuk pekerjaan yang sama. Penyapu yang memakai varian sinkron akan mengembalikan seluruh bug ini
   dalam bentuk yang lebih sulit dilihat: request-nya cepat, servernya tetap beku.
2. **`advanceStage()` & `recordHeadSha()` WAJIB tetap di dalam request, sebelum `rename`.** Keduanya
   membaca berkas fase, plan, dan HEAD **dari dalam** worktree (SPEC-176/ADR-0030, SPEC-475).
   Memindahkannya ke latar berarti stage tak maju dan `headSha` hilang — dan bersamanya bukti
   dependency antar-backlog (ADR-0093). Mereka murah; yang mahal cuma penghapusannya.
3. **`ownsWorktree()` berdiri SEBELUM `trashWorktree`, bukan sesudah.** `rename` sama merusaknya
   dengan `rm` bila targetnya checkout project (SPEC-362). `trashWorktree` mengulang jaring pengaman
   `removeWorktree` (menolak target = repo itu sendiri) dan menambah satu: menolak target yang sudah
   berada di dalam `.trash`.
4. **`rename` gagal → jatuh ke `removeWorktree` sinkron, JANGAN ke penghapusan latar atas path
   aslinya.** Degradasi ke perilaku lama itu benar dan lambat; menghapus path hidup di latar
   membukanya untuk direbut peluncuran berikutnya — persis balapan yang seluruh desain ini hindari.
5. **Nama entri trash memuat id sesinya** (`<sesi>.<stempel36>-<urut36>`; id sesi disanitasi ke
   `[a-z0-9_-]` jadi tak pernah memuat titik). Itu satu-satunya cara `GET /terminal/cleanups`
   memulihkan "milik sesi mana" sesudah restart, tanpa tabel.
6. **`git worktree prune` dijalankan sekali per repo per sapuan, bukan per entri.** Registrasi jadi
   basi begitu checkout-nya di-`rename`; `prune` hanya membuang entri yang direktorinya hilang, jadi
   ia tak pernah bisa mengganggu worktree yang baru lahir di path yang sama.
7. **Peta pembersihan di memori adalah read model, bukan sumber.** Ia diisi ulang dari `.trash` saat
   boot dan tiap tick. Mempercayainya sebagai sumber berarti restart di tengah penghapusan
   meninggalkan sampah yang tak seorang pun tahu ada.
8. **Pemindahan, pencatatan, dan tendangan penyapu adalah SATU panggilan** (`releaseWorktree()`).
   Memisahkannya berarti tiap call site baru harus mengingat ketiganya — efek samping yang disalin
   ke call site adalah kelas bug yang sudah menggigit repo ini berkali-kali (SPEC-431/448/475/481).
   `session-worktree.ts` karena itu tetap MURNI (hanya `ownsWorktree`): ia diuji murni justru karena
   kesalahannya menghapus direktori sungguhan, dan menaruh IO di sebelahnya melunturkan alasan itu.
