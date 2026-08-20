# SPEC-859 — IDE → Branches: tampilkan semua branch, bukan hanya yang ter-merge

- **Tanggal:** 2026-08-20
- **Backlog:** SPEC-859 (sumber brief, prioritas sedang)
- **Menyentuh:** ADR-0077 (**diamandemen**), ADR-0055 & ADR-0018 & ADR-0121 (ditegakkan)

## Masalah

Tab **Branches** di IDE hanya memanggil `GET /projects/:id/branches/unused`, yang menurut ADR-0077
memancarkan **hanya branch yang sudah ter-merge ke base**. Akibatnya:

- Branch yang masih aktif / belum ter-merge **tak terlihat sama sekali** di dashboard, padahal
  daftar lengkapnya sudah tersedia (`GET /projects/:id/branches` memberi local + origin).
- Empty state `"Tak ada branch ter-merge"` membuat repo yang punya belasan branch aktif tampak
  **kosong** — pembacaan yang salah, bukan sekadar kurang informasi.
- Panel judulnya literal `branch ter-merge ke <base>`; tak ada cara melihat "apa saja branch di
  project ini" tanpa membuka terminal.

Panel ini lahir dari SPEC-360/ADR-0077 yang memang menyasar **pembersihan** branch tak terpakai.
Permintaan ini **memperluas** panelnya jadi daftar branch penuh — bukan mencabut kemampuan hapus.

## Keputusan yang diambil manusia

Branch yang **belum ter-merge boleh dihapus**, tetapi lewat **gerbang eksplisit**:
`POST /projects/:id/branches/delete` menerima `allowUnmerged: true`; hanya dengan flag itu baris
yang belum ter-merge dieksekusi, dan hanya sisi lokalnya yang memakai `git branch -D`.

Ini **mengamandemen ADR-0077**, tidak mencabutnya. ADR-0077 menuliskan "TAK PERNAH pakai `-D`/force"
dengan **alasan** yang dinyatakan di sana: *"semua kandidat sudah ter-merge"*. Premis itu gugur
begitu daftarnya memuat branch belum ter-merge. Lima kunci proteksi (`current`/`base`/`worktree`/
`spec-open`/`session`) **tidak dilonggarkan sedikit pun** dan tetap ditegakkan ulang di jalur tulis.

## Bentuk

### Server — `services/branch-cleanup.ts`

Satu perluasan aditif, bukan endpoint kedua: menyalin `lockInputs()` + resolusi base + penyaringan
ref ke endpoint baru adalah kelas bug yang sudah menggigit repo ini berkali-kali (SPEC-431/448/475).

```ts
type UnusedBranch = {
  name: string;
  local: boolean;         // ref lokal ADA          (sebelumnya: "ref lokal ter-merge")
  remote: boolean;        // ref origin ADA         (sebelumnya: "ref origin ter-merge")
  mergedLocal: boolean;   // baru — ter-merge ke <base>
  mergedRemote: boolean;  // baru — ter-merge ke origin/<base>
  merged: boolean;        // baru — TIAP sisi yang ada sudah ter-merge
  lastCommit: { sha; at; subject } | null;
  locks: BranchLock[];
};
listUnusedBranches(repoDir, { base?, include?: "merged" | "all", ...locks })
```

- `include` default **`"merged"`** → himpunan baris **sama seperti hari ini**; klien lama tak pecah,
  hanya melihat tiga field tambahan yang bisa diabaikan.
- `include: "all"` → seluruh ref `refs/heads` ∪ `refs/remotes/origin`, ter-merge maupun belum,
  urut nama (deterministik, sama seperti sekarang).
- **Penajaman semantik `local`/`remote`.** Keduanya kini berarti **ref itu ADA**, bukan "ref itu
  ter-merge". Ini yang membuat badge scope di UI ("local / origin / local + origin") jujur untuk
  branch yang belum ter-merge. Konsekuensinya pada mode default hanya di kasus **divergen** (mis.
  `x` ter-merge ke `main` lokal tetapi `origin/x` belum ter-merge ke `origin/main`): dulu barisnya
  muncul dengan `remote:false`, kini `merged:false` sehingga **tak muncul** di mode default. Arahnya
  **lebih ketat**, tak pernah lebih longgar — klien lama tak pernah menerima baris yang tak aman.
- Satu `for-each-ref` melayani himpunan ref + `lastCommit` sekaligus (sebelumnya dua tujuan, satu
  panggilan yang membuang informasi sisi ref-nya).

`deleteBranches(repoDir, names, { scope, base?, allowUnmerged?, ...locks })`:

1. Menurunkan ulang laporan dengan `include: "all"`, lalu **memvalidasi ulang tiap nama** terhadapnya
   — nama yang bukan branch nyata tetap ditolak (`branch tak ditemukan`), jadi penyelundupan lewat
   body tetap mustahil.
2. `locks` tak kosong → ditolak, apa adanya seperti sekarang.
3. `!merged && !allowUnmerged` → ditolak dengan alasan yang **menyebut risikonya**
   (`belum ter-merge ke <base> — commit-nya bisa hilang; butuh konfirmasi terpisah`).
4. `!merged && allowUnmerged` → dieksekusi. `runGitOp delete-branch` menerima `force: true`
   **hanya untuk sisi lokal yang belum ter-merge** (`!mergedLocal`); `git push origin --delete`
   tak pernah menguji merged-ness sehingga tak butuh flag apa pun.
5. `DeleteResult` mendapat `forced?: true` pada baris yang memakai `-D`, supaya tindakan merusak itu
   terlihat di hasil, bukan tak berjejak.

Route: `GET …/branches/unused?base=&include=all` dan body `POST …/branches/delete` bertambah
`allowUnmerged?: boolean`. Read tetap **turunan git murni** (ADR-0018), tak digerbang sesi aktif;
hapus tetap **ref-only per-branch** (ADR-0055).

### Frontend — `screens/BranchesPanel.tsx`

- **Header** — eyebrow jadi `branch project · base <base>`; `Select` **base** dan `Select` **scope**
  tetap, di antaranya `Select` **status** baru: `semua` (default) · `ter-merge saja` ·
  `belum ter-merge`. Ditambah **kotak cari** nama branch: dengan ratusan branch, filter status
  sendirian tak membuat daftar terbaca. Panel selalu meminta `include=all`; filter status & cari
  murni klien, jadi menoggle-nya seketika dan tak memicu request.
- **Baris** — checkbox · nama (mono) · badge **status** (`ter-merge` leaf / `belum ter-merge` warn) ·
  badge scope · badge kunci (`LOCK_LABEL`, tak berubah) · subject + umur commit terakhir · Hapus.
- **Batas render** — `PAGE = 100` baris, sisanya lewat tombol `Tampilkan N lagi`. Batas ini adalah
  bagian dari definisi "sedang tampak": **pilihan tak pernah memuat baris yang tak dirender**,
  sehingga `Pilih semua yang boleh (N)` selalu jujur. Reset ke 100 tiap ganti base/status/cari.
- **Pilih semua yang boleh** = baris **bebas kunci** di antara yang **sedang tampak** setelah filter
  + batas render. Branch belum ter-merge **boleh** dipilih (pagarnya konfirmasi, bukan checkbox mati);
  branch berkunci tetap tak bisa dipilih.
- **Konfirmasi** — `ConfirmDialog` biasa bila semua target sudah ter-merge. Bila **ada** target yang
  belum ter-merge, dialognya berbeda: menyebut jumlah & nama branch belum-ter-merge, menyatakan
  **commit yang hanya ada di branch itu akan hilang dan tak bisa dibatalkan**, dan menuntut
  `requireText` (nama branch bila targetnya satu, `hapus paksa` bila batch — pola ADR-0121). Hanya
  dialog inilah yang mengirim `allowUnmerged: true`.
- **Hasil** — `N terhapus · M gagal`, ditambah `(K dipaksa)` bila ada baris `forced`.
- **Empty state** — bedakan "project ini belum punya branch" dari "tak ada branch cocok filter"
  (yang kedua menawarkan reset filter), supaya daftar tersaring tak terbaca sebagai data kosong.

## Yang TIDAK berubah

- Lima kunci proteksi & penegakan ulangnya di jalur tulis.
- Eksekusi lewat `runGitOp delete-branch` — satu-satunya jalur hapus branch di codebase.
- Read tanpa gerbang sesi aktif; hapus tanpa gerbang `touchesTree`.
- `GET /projects/:id/branches` (dropdown base) apa adanya.
- Tak ada kolom DB, tak ada migration, tak ada cache — seluruhnya nilai turunan git tiap request.

## Test

- `server/test/branch-cleanup.test.ts` — `include: "all"` memuat branch belum ter-merge; mode default
  tak berubah; `merged`/`mergedLocal`/`mergedRemote` benar untuk local-saja, origin-saja, dan
  divergen; hapus unmerged **ditolak tanpa** `allowUnmerged`; **berhasil dengan** `allowUnmerged`
  (dan `forced:true`); kunci tetap menang atas `allowUnmerged`; nama palsu tetap ditolak.
- `server/test/ide-route.test.ts` (atau berkas route yang memuat branches) — `?include=all`
  meneruskan parameter; body `allowUnmerged` divalidasi (400 bila bukan boolean).
- `src/test/branches-panel.test.tsx` — daftar memuat branch belum ter-merge; filter status menyaring;
  cari menyaring; `Pilih semua yang boleh` hanya mencakup yang tampak setelah filter; memilih branch
  belum ter-merge memunculkan dialog risiko + `requireText` dan mengirim `allowUnmerged:true`; batch
  semua-ter-merge **tidak** mengirim flag itu; batas render + `Tampilkan N lagi`.
- `src/test/branch-cleanup-client.test.ts` — `include` masuk query; `allowUnmerged` masuk body.

## Docs yang tersentuh (commit yang sama)

`internal/docs/adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md` (amandemen) ·
`internal/docs/adr/README.md` · `internal/docs/architecture/api-contract.md` ·
`internal/docs/frontend/frontend-implementation.md` · `internal/docs/requirements/frd.md` ·
`internal/docs/requirements/rd.md` · `internal/docs/README.md`.
