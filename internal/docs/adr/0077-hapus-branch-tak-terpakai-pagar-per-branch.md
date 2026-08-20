# ADR-0077 — Hapus branch tak terpakai: daftar ter-merge turunan + pagar proteksi per-branch

- **Status:** Accepted (SPEC-360)
- **Memperluas:** ADR-0055 (taksonomi operasi git berlapis)
- **Terkait:** ADR-0018/0011 (nilai turunan, bukan kolom DB) · ADR-0002 (isolasi worktree, sesi detach) · ADR-0032 (branch adalah properti backlog item) · ADR-0037 (guardrail dicabut) · ADR-0065 (capability agent)

## Konteks

`POST /projects/:id/git { op:"delete-branch" }` sudah ada sejak SPEC-206 dan bisa menghapus branch
local, origin, atau keduanya. Yang tak ada: cara **menemukan** branch mana yang sudah selesai masa
pakainya, dan cara menghapus **banyak sekaligus**. Repo hanoman sendiri menumpuk puluhan branch
`hanoman/spec-*` yang sudah masuk `main` dan tak pernah dibersihkan; satu-satunya jalan adalah
klik-kanan pill branch di Git Graph, satu per satu, dua kali (local lalu origin).

Sekaligus ada lubang keselamatan: `delete-branch` polos meneruskan apa pun ke git. `git branch -d`
menolak branch yang ter-checkout, tapi **tidak** tahu bahwa `origin/hanoman/spec-360` sedang jadi
target sesi tmux yang berjalan — sesi hanoman lahir `--detach` (ADR-0002), jadi tak ada ref lokal
yang bisa dilihat git sampai agen mem-push.

## Keputusan

**1. Daftar branch tak terpakai adalah nilai turunan, bukan kolom.**
`GET /projects/:id/branches/unused` menurunkan daftarnya langsung dari git tiap request
(`git branch --merged`), sejalan ADR-0018/0011. Tanpa tabel, tanpa cache, tanpa migration.
Kriterianya **murni git: ter-merge ke base** — bukan umur, bukan stage backlog. `base` ditentukan
`opts.base → main → master → branch aktif`; **tak pernah** hardcode `"main"` (pelajaran SPEC-227).
Untuk ref origin, base pembandingnya `origin/<base>` — "branch utama"-nya sebuah ref origin adalah
`origin/main`, bukan `main` lokal yang bisa tertinggal.

**2. Lima kunci proteksi per-branch, ditegakkan di jalur tulis.**
`current` · `base` · `worktree` (ter-checkout di worktree lain) · `spec-open` (Spec-nya belum
`done`) · `session` (sesi tmux aktif memakainya). Kunci `session` **wajib** terpisah dari
`worktree` justru karena sesi lahir detached: `git worktree list` tak menyebut branch apa pun
untuk sesi yang sedang berjalan.

`POST /projects/:id/branches/delete` menurunkan ulang daftar yang sama sebelum menghapus, lalu
memvalidasi tiap nama terhadapnya. Akibatnya tiga invarian gratis: hanya branch ter-merge yang
bisa dihapus (nama sembarang di body ditolak); kunci bukan sekadar petunjuk UI; dan scope
menyempit per branch (minta `both` pada branch tanpa ref origin → jalankan `local` saja).

**3. Ini pagar keselamatan data, BUKAN guardrail eksekusi.**
ADR-0037 mencabut guardrail perintah dan tetap berlaku: agen boleh menjalankan `git branch -D` apa
pun lewat terminal, dan context-menu Git Graph tetap menyediakan hapus paksa. Yang dipagari di sini
hanyalah **satu endpoint bulk** yang dirancang untuk diklik cepat pada banyak baris sekaligus — di
sanalah kesalahan tak bisa dibatalkan menjadi murah. Pagar ini tidak mengurangi kewenangan siapa
pun; ia hanya menolak melakukan hal berbahaya **atas nama** operator dalam satu klik. Karena itu
pula tak ada `--force`: bila sesuatu belum ter-merge, ia bukan urusan endpoint ini.

**4. Gerbang sesi-aktif global sengaja TIDAK dipakai.**
Hapus branch adalah op ref-only (ADR-0055), jadi ia lolos `touchesTree`. Menggantinya dengan kunci
per-branch justru lebih tepat: yang dilindungi adalah branch yang benar-benar dipakai, bukan
seluruh project setiap kali ada sesi apa pun berjalan.

**5. Eksekusi didelegasikan ke `runGitOp`, bukan implementasi kedua.**
Layer batch hanya menemukan, memvalidasi, dan mempersempit scope; penghapusannya tetap lewat
`delete-branch` SPEC-206. Satu jalur hapus branch di seluruh codebase.

**6. Capability agent tetap di domain `projects`.**
`branches` sengaja bukan anggota `IDE_SUBS`: `GET /projects/:id/branches` yang lama sudah memetakan
ke `projects:read`, dan memindahkannya akan diam-diam mengubah capability endpoint yang sudah
dipakai. Dikunci satu test agar jadi keputusan, bukan kebetulan.

## Konsekuensi

- Tak ada perubahan skema, tak ada migration. Semua turunan.
- Branch yang di-**squash**-merge lewat PR GitHub **tidak** terdeteksi (`--merged` bekerja pada
  ancestry, bukan patch-id). hanoman melakukan merge sungguhan lewat `integrateBranch`/
  `mergeIntoCurrent`, jadi jalur internalnya tertangkap. Deteksi patch-id (`git cherry`) bisa
  menyusul di spec terpisah bila dibutuhkan.
- Bila `main` lokal tertinggal dari `origin/main`, daftar local menyusut (konservatif —
  menyembunyikan, bukan salah menghapus). Operator menekan **Fetch** di toolbar IDE lalu memuat ulang.
- `base` yang bisa dipilih membuat fitur ini berguna di repo ber-default `master`/`develop` dan untuk
  membersihkan branch fitur yang ter-merge ke branch rilis, bukan hanya `main`.
- Dua bentuk keluaran git yang wajib disaring dan mudah terlewat (keduanya **diukur**, bukan
  dugaan): `git branch --merged --format` memancarkan baris `(no branch)` di worktree **detached**
  (yaitu setiap sesi hanoman), dan git memendekkan `origin/HEAD` menjadi bare `origin` — bukan
  `origin/HEAD`. `services/branches.ts` sudah menyaring yang kedua; `branch-cleanup.ts` menyatukan
  keduanya di satu helper `shortName()`.
- Satu batasan git yang mengikat bentuk implementasi: **`--end-of-options` tak bisa dipakai untuk
  argumen `--merged`** (git menelannya sebagai nilai opsi, lalu memperlakukan `--format` sebagai
  argumen posisi). Karena itu base di-resolve ke **SHA** lebih dulu — heksadesimal tak pernah
  terbaca sebagai flag, jadi keamanan argumen ADR-0032 tetap utuh lewat jalur lain.

## Amandemen SPEC-859 (2026-08-20) — panel jadi daftar branch penuh, `-D` dipersempit bukan dicabut

Keputusan aslinya berdiri; **cakupannya** yang melebar, dan satu larangan di dalamnya dipersempit
karena premisnya gugur.

**Yang berubah.**

1. **`GET /projects/:id/branches/unused?include=all`** memancarkan SELURUH ref (`refs/heads` ∪
   `refs/remotes/origin`), ter-merge maupun belum. Tanpa parameter itu himpunan barisnya tetap
   "hanya yang ter-merge", jadi klien lama tak pecah. Sebabnya: panel Branches hanya pernah memanggil
   endpoint ini, sehingga branch yang masih **aktif** tak terlihat sama sekali di dashboard dan
   empty state `"Tak ada branch ter-merge"` membuat repo ber-belasan branch tampak kosong.
2. **`local`/`remote` kini berarti "ref itu ADA"**, bukan "ref itu ter-merge"; merged-ness pindah ke
   `mergedLocal`/`mergedRemote` + turunannya `merged` (= **tiap sisi yang ada** sudah ter-merge ke
   base-nya masing-masing). Tanpa penajaman ini badge scope di UI berbohong untuk branch belum
   ter-merge. Konsekuensinya pada mode default hanya di kasus **divergen** — `x` ter-merge ke `main`
   lokal tetapi `origin/x` belum ke `origin/main`: dulu barisnya muncul dengan `remote:false`, kini
   `merged:false` sehingga **tak muncul**. Arahnya **lebih ketat**, tak pernah lebih longgar; klien
   lama tak pernah menerima baris yang tak aman dihapus.
3. **Larangan `-D` dipersempit, bukan dicabut.** Alasan yang ditulis keputusan ini apa adanya —
   *"Force TAK PERNAH dipakai: semua kandidat sudah ter-merge"* — gugur begitu daftarnya memuat
   branch belum ter-merge, dan `git branch -d` memang **menolak** branch semacam itu. Gerbangnya
   `allowUnmerged: true` di body `POST /projects/:id/branches/delete`, dan **hanya** dialog
   konfirmasi risiko di UI yang mengirimkannya: dialog itu menyebut jumlah + nama branch belum
   ter-merge, menyatakan commit-nya akan hilang, dan menuntut **ketikan ulang** (nama branch bila
   targetnya satu, `hapus paksa` bila batch — pola `requireText` ADR-0121). Force dipasang **per
   sisi**: hanya sisi lokal yang `!mergedLocal`, karena `git push origin --delete` tak pernah
   menguji merged-ness sama sekali.

**Yang TIDAK berubah.** Lima kunci proteksi ditegakkan ulang di jalur tulis dan **menang atas
`allowUnmerged`** — branch berkunci tetap tak bisa dihapus, apa pun isi body. Validasi ulang tiap
nama terhadap daftar turunan tetap ada (nama yang bukan branch nyata → `branch tak ditemukan di
repo`), jadi penyelundupan lewat body tetap mustahil. Eksekusi tetap satu jalur `runGitOp`
`delete-branch` (SPEC-206), tetap ref-only (ADR-0055), tetap tanpa gerbang sesi aktif, tetap nilai
turunan git tanpa kolom DB. ADR-0037 tetap utuh: ini pagar keselamatan data untuk satu endpoint
bulk, bukan guardrail eksekusi.

**Konsekuensi baru.**

- `DeleteResult` mendapat `forced?: true` pada baris yang benar-benar memakai `-D`; hasil di UI
  membacanya sebagai `N terhapus (K dipaksa)` supaya tindakan merusak itu berjejak, bukan senyap.
- Daftar penuh bisa ratusan baris di repo besar. Server tetap memancarkan **seluruhnya**, urut nama
  (deterministik); yang membatasi adalah klien — filter status, kotak cari, dan batas render 100
  baris. Batas render itu **bagian dari definisi "sedang tampak"**: `Pilih semua yang boleh (N)`
  hanya mencakup baris yang benar-benar dirender, sehingga pilihan tak pernah memuat branch yang tak
  terlihat operator.
