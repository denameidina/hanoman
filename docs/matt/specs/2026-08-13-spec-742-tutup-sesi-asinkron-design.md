# SPEC-742 — Tutup sesi terminal jadi asinkron

> Design doc. Metode `matt` (mattpocock) — berkas pertama di `docs/matt/`.
> ADR: [ADR-0116](../../../internal/docs/adr/0116-penutupan-sesi-asinkron-worktree-trash.md).

## Masalah

Operator menutup satu sesi di dashboard → UI menggantung, dan **sesi lain tak bisa dibuka** sampai
penutupan selesai.

`DELETE /terminal/sessions/:id` (`server/src/routes/terminal.ts`) mengerjakan seluruh pembersihan
sinkron di dalam satu request: `advanceStage()` → `recordHeadSha()` → `killSession()` →
`realGit.removeWorktree()`. Langkah terakhir menghapus checkout `.worktrees/<id>` lengkap dengan
`node_modules`-nya.

## Yang diukur (bukan diperkirakan)

Salinan worktree nyata — `.worktrees/release-0.1.11`, **562 MB / 25 040 entri**, hardlink clone
(`cp -al`) di volume APFS yang sama, Node dengan detektor lag timer 20 ms:

| operasi | durasi | lag event loop terburuk | tick 20 ms selama operasi |
|---|---|---|---|
| `renameSync` | **1 ms** | 1 ms | — |
| `rmSync` (dipakai hari ini) | 1 370 ms | **1 364 ms** | **0** |
| `fs.promises.rm` | 947 ms | **3 ms** | 46 |

Dua temuan yang mengubah bentuk perbaikannya:

1. **Yang membeku bukan cuma request-nya — seluruh server.** `rmSync` memblokir event loop selama
   100 % durasinya (nol tick). Itulah sebab "sesi lain tak bisa dibuka": setiap request lain
   mengantre di belakangnya. Jadi *membalas 202 lebih awal lalu memanggil `removeWorktree` di
   `setImmediate` tidak memperbaiki apa pun* — UI dapat balasan cepat, server tetap beku sedetik
   kemudian.
2. **Biayanya dibayar dua kali.** `realGit.removeWorktree` menjalankan `git worktree remove --force`
   (yang sudah menghapus pohonnya, lewat `spawnSync`) **lalu** `rmSync` lagi.

Angka di atas adalah batas BAWAH: hardlink clone tak membebaskan blok data (inode aslinya masih
ada), dan disk mesin produksi tak selalu SSD lokal.

### Jalur MEMBUKA sesi ikut terkena

`realGit.addWorktree` merebut path lebih dulu dengan `worktree remove --force` + `rmSync` — sinkron,
atas worktree penuh. Membuka lagi backlog yang sudah `done` (SPEC-172) melewati situ **setiap kali**.
Karena outcome SPEC-742 menyebut "sesi baru untuk backlog yang sama" secara harfiah, jalur ini masuk
scope: tanpa itu penutupan jadi cepat sementara pembukaannya tetap membekukan server.

## Keputusan

**Pindahkan, jangan hapus.** Bagian wajib-urut & murah dikerjakan di dalam request; worktree-nya
di-`rename` ke `<repoDir>/.worktrees/.trash/<sesi>.<stempel>` — **1 ms** — lalu request membalas.
Penghapusan byte dikerjakan penyapu latar dengan `fs.promises.rm`.

Tiga sifat yang didapat sekaligus, dan ketiganya menjawab constraint brief secara struktural:

- **Path-nya benar-benar bebas saat respons kembali** — bukan dijanjikan bebas. `POST
  /terminal/sessions` untuk backlog yang sama langsung berhasil.
- **Domain penyapu (`.trash/**`) lepas total dari setiap path hidup.** Penyapu tak punya cara
  menyentuh worktree sesi mana pun, jadi "penutupan sesi berbeda yang tumpang tindih" dan "sesi baru
  lahir selagi penyapuan jalan" aman **secara konstruksi**, bukan karena penguncian.
- **`.trash` itu sendiri adalah catatan durable-nya.** Isinya menurut konstruksi = sampah, aman
  dihapus siapa pun kapan pun, idempoten, selamat dari crash. Requirement "bisa disapu ulang" gratis;
  nol tabel, nol kolom, nol migration (doktrin ADR-0018/0019).

`.worktrees/.phases/` & `.worktrees/.decisions/` sudah memakai konvensi dot-dir yang sama.

### Urutan baru DELETE

```
gerbang (s.flow || cwd di .worktrees) → resolveRepoDir
  → advanceStage()      # membaca berkas fase + plan DI DALAM worktree (SPEC-176/ADR-0030)
  → recordHeadSha()     # membaca HEAD worktree (SPEC-475)
  → killSession()       # pane lepas → sesi berhenti dari sudut pandang operator
  → ownsWorktree()?     # SPEC-362 · satu-satunya gerbang ke operasi destruktif, TIDAK dilonggarkan
      → trashWorktree() # rename, 1 ms
  → 202 { cleanup }
  → (sesudah respons) tendang penyapu
```

Urutan `advanceStage` → `recordHeadSha` → `killSession` **tidak diubah** — keduanya membaca dari
dalam worktree, dan memindahkannya ke latar berarti mereka balapan dengan penghapusannya. Itu
constraint eksplisit brief; di sini ia tak perlu dijaga dengan kunci karena keduanya tetap berada di
dalam request, sebelum `rename`.

### Bentuk API

| | sebelum | sesudah |
|---|---|---|
| `DELETE /terminal/sessions/:id` | `204` | **`202 { cleanup: string \| null }`** |
| — | — | **`GET /terminal/cleanups` → `{ items: WorktreeCleanupView[] }`** |
| frame siar | — | **`{ t: "cleanups", cleanups }`** |

`cleanup` = nama entri trash, atau `null` bila memang tak ada yang perlu dibersihkan (terminal biasa,
shell, sesi tanpa worktree). 202 dipilih karena "diterima, pembersihan lanjut di latar" memang bukan
"no content"; `j()` di klien sudah menangani non-204 dengan body JSON.

`GET /terminal/cleanups` jatuh ke `rw("sessions")` di `capabilityForRoute` tanpa satu baris pun
perubahan gerbang (cermin `/terminal/history`, SPEC-362).

### Keadaan `closing` → `closed`

Pane sudah mati dan sesi tmux sudah lenyap saat kita membalas, jadi menyintesis sesi hantu di
`GET /terminal/sessions` justru melawan outcome (3) ("UI langsung melepas tab/pane yang ditutup").
Yang dapat diamati adalah **pembersihannya**, berkunci id sesi — nama entri trash memuatnya:

- entri muncul di `GET /terminal/cleanups` = `closing`
- entri hilang = `closed`
- entri ber-`error` = percobaan terakhirnya gagal, dan ia akan dicoba lagi

Read model-nya peta di memori; **kebenaran durable-nya tetap direktori `.trash`**. Peta diisi ulang
dari filesystem saat boot dan tiap tick penyapu, jadi restart tak kehilangan pekerjaan — hanya
kehilangan keterangan galat percobaan sebelumnya, yang memang milik percobaan itu.

### Kegagalan tak boleh senyap

`rm` gagal → satu baris `Notification` `type:"cleanup"` ber-`key` unik per entri trash (`P2002`
diabaikan, cermin `recordCompletion`) → **satu notifikasi per entri, bukan satu per tick** — dan
entrinya **tetap tinggal** untuk disapu ulang di tick berikutnya dan sesudah restart.

## Yang TIDAK berubah (dinyatakan, bukan kelalaian)

- **`ownsWorktree()`** tetap satu-satunya gerbang, dan `session-worktree.ts` tetap **murni** —
  pemindahan + pencatatan + tendangan penyapu hidup di satu panggilan `releaseWorktree()` milik
  penyapu. `trashWorktree` mengulang jaring pengaman `removeWorktree` (menolak target = repo itu
  sendiri) dan menolak target yang sudah di dalam `.trash`.
- **Tiga jalur `killSession` lain.** `services/lead/apply.ts` (`stopSession` & `integrate-main`)
  sengaja **tidak** menghapus worktree (AC-32a, SPEC-451); `services/telegram/session.ts`
  (`/engine restart`) jalan di `repoDir`, tanpa worktree; `services/session-launch.ts`
  `killSession` lalu **membuat** worktree. Tak satu pun menghapus worktree → tak satu pun bisa
  balapan dengan penyapu, dan itu berlaku *karena* penyapu hanya menyentuh `.trash`.
- **`services/integrate.ts`** (`discardMergeWorktree`, reclaim `.worktrees/merge-<id>`) tetap
  sinkron. Worktree merge lahir dari `git worktree add` tanpa `pnpm install`, jadi ordo biayanya lain,
  dan tak ada operator yang menunggui daftar sesi di jalur itu. **Non-goal yang dinyatakan.**
- Skema Prisma, `FIELDS` sync, `PG_ORDER`, `WEBHOOK_ENTITIES`, katalog capability: nol perubahan.

## Rencana test

| bukti | test |
|---|---|
| respons cepat & tak bergantung ukuran | `terminal.route.test.ts` — DELETE → 202, `.worktrees/<id>` **sudah tak ada** saat respons kembali |
| stage & headSha tetap terekam | test SPEC-176/SPEC-173 yang sudah ada, dipindah ke 202 |
| worktree akhirnya terhapus | `worktree-reaper.test.ts` — sapuan mengosongkan `.trash` |
| sesi baru bisa dibuat selagi penyapuan jalan | `terminal.route.test.ts` — entri trash sengaja ditahan, `POST` untuk spec yang sama tetap 201 |
| penutupan ganda idempoten | DELETE kedua → 404 (sesi sudah lenyap); `trashWorktree` atas path absen → `null` |
| kegagalan tak senyap | penyapu ber-`rm` yang melempar → notifikasi lahir, entri tetap ada, sapuan kedua mencoba lagi |
| `ownsWorktree` tetap menggerbangi | regresi SPEC-362 yang sudah ada (menutup shell tak menghapus repoDir) tetap hijau |
| reclaim `addWorktree` tak lagi menghapus sinkron | `runner/test/git.test.ts` — path direbut, isi lama mendarat di `.trash` |
