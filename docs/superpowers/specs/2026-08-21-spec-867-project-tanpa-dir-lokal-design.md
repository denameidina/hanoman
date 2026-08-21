# SPEC-867 — Project tanpa dir lokal: CTA clone dari git remote (atau pilih folder yang sudah ada)

Tanggal: 2026-08-21 · Prioritas: tinggi · Sumber: brief

## Masalah

`POST /projects/:id/clone` (`server/src/routes/bindings.ts:35`) menerima **project id apa pun**
yang punya `gitRemote` — kemampuannya sudah ada sejak SPEC-218. Yang tak ada adalah **pintunya di
UI** untuk project yang sudah ada tapi belum punya checkout di mesin ini. Satu-satunya jalan masuk
`api.cloneProject` hari ini adalah tab "Clone dari URL git" di modal **Project baru**
(`src/src/App.tsx:882`), yang hanya hidup saat project dibuat.

Dua populasi mendarat tanpa dir lokal:

1. **Project dari sync hub.** `Project.repoDir` **sengaja dikecualikan** dari whitelist sync
   (`server/src/services/sync.ts:41`, ADR-0043), dan `LocalBinding` tak pernah menyeberang sama
   sekali. Project asal-hub karena itu mendarat dengan `repoDir` **dan** `binding` = null.
2. **Project yang clone-nya gagal saat dibuat.** `createProject` sengaja tak menghapus baris
   project-nya (App.tsx:879) supaya remote-nya tersimpan.

Untuk keduanya, detail project justru makin bisu: `onReverse`/`onScaffold` sudah digerbangi
`(proj.binding ?? proj.repoDir)` (`App.tsx:1300-1301`), jadi saat dir tak ada **pintunya hilang
tanpa satu pun penjelasan**. Yang tersisa hanya `Meta` "Repo: —" di antara empat meta lain.

Dan kode menjanjikan jalan yang tak ada: komentar `App.tsx:879` berbunyi "remote tersimpan → bisa
clone ulang dari Edit", toast kegagalan `App.tsx:888` berbunyi "clone ulang dari Edit". Tak ada
tombol clone di `EditProjectModal` (App.tsx:630-680) maupun di `ProjectDetailScreen`. Akibatnya
operator harus membuka terminal, `git clone` manual, lalu menempel path-nya ke field Path.

## Keadaan "tanpa dir" = `!binding && !repoDir`

Predikatnya murni klien, tanpa sinyal server baru. `ProjectView` sudah membawa keduanya
(`shared/src/dto.ts:139`), dan karena `repoDir` tak pernah disync (di atas), tak ada kasus
"repoDir terisi path mesin lain" yang perlu dibedakan — kalau `repoDir` terisi, ia diisi **di mesin
ini**. Predikat yang sama sudah dipakai App.tsx untuk menggerbangi pintu reverse/scaffold, jadi
kartu ini muncul **tepat** saat dua pintu itu menghilang.

## Bentuk

### 1. `src/src/screens/FolderPicker.tsx` — dipindah, bukan disalin

`FolderPicker` (+ `FolderRow`, `FsEntry`) hari ini private di `App.tsx:500`. Ia sudah dipakai tiga
call site dan spec ini menambah yang keempat dari berkas lain, jadi ia pindah ke modulnya sendiri
dan diekspor. Isinya tak berubah sedikit pun — invariant SPEC-858 (`start=` nilai field yang
sedang ada; input teks tetap bisa diketik) ikut pindah utuh. App.tsx mengimpornya.

### 2. `src/src/screens/git-remote.ts` — tiga fungsi murni

- `repoBasename(remote)` — `https://github.com/org/repo.git` / `git@github.com:org/repo.git` →
  `repo`; kosong/aneh → `"repo"`. Ini **ekstraksi**, bukan fungsi baru: `App.tsx:872` (`fromUrl`)
  sudah menghitungnya inline dan sekarang memanggil helper ini.
- `cloneTargetInto(parent, remote)` — `parent` + `/` + `repoBasename(remote)`, trailing slash
  dinormalkan. Inilah yang menjembatani dua semantik yang berlawanan: `FolderPicker` memulangkan
  folder yang **sudah ada**, sementara `git clone` menuntut folder yang **belum ada atau kosong**.
  Tanpa komposisi ini, memilih `~/code` di picker berarti `git clone` gagal dengan "destination
  path already exists and is not an empty directory" pada setiap percobaan pertama.
- `cloneErrorText(e)` — `ApiError.detail` endpoint clone berbentuk `{ error, detail }` dengan
  `detail` = **stderr git**. `ApiError.message` sendiri hanya `POST /api/… → 409`, tak bisa
  ditindaklanjuti. Helper ini memulangkan `{ error, stderr }` supaya modal **dan** toast App.tsx
  memakai teks yang sama.

### 3. `src/src/screens/MissingRepoCard.tsx`

Merender `null` saat `(p.binding ?? p.repoDir)` truthy — kartunya tak pernah jadi ruang kosong.

**Cabang A — `gitRemote` ada:** `Callout tone="warn"` berjudul "Belum ada checkout di mesin ini",
menyebut remote-nya, dua aksi: **"Clone dari git remote"** (primer, membuka `CloneRepoModal`) dan
**"Pilih folder di device"** (sekunder, membuka `FolderPicker` langsung).

**Cabang B — `gitRemote` kosong:** pesan jujur — clone **tak mungkin** karena project ini belum
punya git remote. Dua aksi: **"Isi git remote"** (memanggil prop `onEdit`, yaitu modal Edit yang
sudah punya field itu) dan **"Pilih folder di device"**. Tak ada tombol clone yang menunggu untuk
gagal.

`CloneRepoModal` (private di berkas yang sama):

- Satu `Field` "Folder tujuan clone" berisi `Input` mono + tombol "Pilih folder" — bentuk baris
  yang sama persis dengan tiga call site FolderPicker lain (SPEC-858).
- `onPick` menulis `cloneTargetInto(picked, gitRemote)`, jadi memilih `~/code` mengisi
  `~/code/<nama-repo>`. Teksnya tetap bisa diedit tangan.
- Hint menyebut aturannya apa adanya: folder tujuan harus belum ada atau kosong.
- Gagal → `Callout tone="err"` **di dalam modal** berisi pesan endpoint + stderr dalam `<pre>`
  yang bisa digulir; modal **tetap terbuka**, tombolnya berbunyi "Coba lagi". Toast yang lewat
  tak bisa dibaca-ulang, dan stderr git adalah satu-satunya keterangan yang berguna di sini.
- Sukses → `onProjectChanged(p.id)` (jalur refetch VM SPEC-258 yang sudah ada) + toast + modal
  tutup. Binding sudah diset **oleh endpoint**, klien tak menulis binding kedua kali.

"Pilih folder di device" memanggil `api.putBinding(p.id, path)` lalu `onProjectChanged` yang sama.

### 4. `ProjectDetailScreen`

Satu baris: `<MissingRepoCard …/>` di atas `HelpCenterCard`, meneruskan `onEdit`, `onToast`,
`onProjectChanged` yang sudah jadi prop layar itu. Tak ada prop baru dari App.tsx.

### 5. Janji yang jadi benar lagi

Komentar `App.tsx:879` dan toast `App.tsx:888` berhenti menyebut "Edit" dan menunjuk kartu di
detail project — tempat pintunya benar-benar ada. Cabang itu sudah `setSection("project")`, jadi
operator mendarat persis di kartu yang dimaksud toast-nya. Toast itu sekaligus berhenti memuntahkan
`POST /api/… → 409` dan memakai `cloneErrorText`.

## Keputusan yang diambil, beserta alasannya

**Pintunya di detail project, bukan di `EditProjectModal`.** Objective menyuruh keadaan tanpa-dir
"terbaca jelas di detail project (bukan hanya field kosong di Edit)", dan dua pintu clone berarti
dua tempat yang bisa berbeda perilaku. Edit tetap jadi tempat mengisi `gitRemote` — cabang B
mengantar ke sana, lalu operator kembali ke kartu yang kini menawarkan clone.

**Clone digerbangi `useConfirm`, di setiap clone.** Constraint SPEC-847/ADR-0127 di brief
bersyarat ("bila menimpa/menulis ke folder tak kosong"), tetapi syarat itu **tak bisa dievaluasi
klien**: `GET /fs/browse` (`server/src/routes/fs.ts:18`) hanya melist **direktori**, bukan berkas,
jadi "folder ini kosong?" tak punya jawaban di sisi UI. Karena itu konfirmasinya dipasang tanpa
syarat — clone menulis ke disk mesin ini dan mengunduh isi repo, dan itu memang layak dinamai
sebelum berjalan.

Yang tetap benar, dan justru dipakai sebagai isi dialog: `git clone` **menolak** folder tak kosong
(terukur di server hidup — `fatal: destination path '…' already exists and is not an empty
directory`, dan berkas yang sudah ada di sana tak tersentuh). Jadi pertanyaan "apa ini menimpa
sesuatu?" dijawab di dalam dialog alih-alih digantung. `cloneTargetInto` tetap membuat target
default selalu folder yang belum ada.

Bentuknya: `confirm({ …, run: () => api.cloneProject(id, target) })` — `run` menahan dialog terbuka
& `busy` selama clone berjalan (itu yang menutup submit kedua) dan meneruskan lemparannya ke
`catch` yang menampilkan stderr di dalam modal. `{dialog}` dirender **di luar** `<Modal>` clone
supaya focus trap & `modalStack` (`ds/kit.tsx`) tak bertabrakan, dan tombol ghost modal clone
berbunyi **"Tutup"** — dua "Batal" yang bertumpuk tak bisa dibedakan operator maupun test.

"Pilih folder di device" tak menyentuh disk sama sekali (hanya baris `LocalBinding`), jadi ia
memang di luar ADR-0127.

**Tak ada endpoint/jalur clone kedua.** Semuanya lewat `api.cloneProject` → `POST
/projects/:id/clone` yang sudah ada, termasuk penulisan binding-nya (endpoint yang melakukannya).

**Tak ada ADR baru.** Tak ada kontrak, skema, atau batas arsitektur yang berubah: nol endpoint
baru, nol kolom baru, nol field sync baru. ADR-0043 (binding LOCAL-only per-device) dan ADR-0127
ditegakkan apa adanya, ADR-0115 tak tersentuh (kartu ini tak punya state tampilan yang perlu
bertahan).

## Test

Frontend, mengikuti pola `src/test/new-project-clone.test.tsx` &
`src/test/edit-project-folder-picker.test.tsx`:

- `src/test/git-remote.test.ts` — murni: `repoBasename` (https, ssh, trailing `.git`, kosong),
  `cloneTargetInto` (trailing slash induk), `cloneErrorText` (ApiError ber-detail, tanpa detail,
  error biasa).
- `src/test/project-missing-repo.test.tsx` — lewat `App`:
  - project ber-`gitRemote` tanpa dir → kartu + kedua CTA tampil; project ber-binding → kartu
    **tak** dirender.
  - klik "Clone dari git remote" → picker → target terkomposisi `<induk>/<nama-repo>` → "Clone"
    memanggil `api.cloneProject(id, target)` lalu `getProject` (refresh).
  - clone digerbangi konfirmasi: dialog menyebut folder tujuan, dan `cloneProject` **belum**
    dipanggil sebelum tombol konfirmasinya diklik; membatalkan tak memanggilnya sama sekali dan
    modal clone tetap terbuka dengan path yang sudah diisi.
  - clone gagal → stderr endpoint tampil di modal, modal tetap terbuka, percobaan kedua
    dikonfirmasi ulang lalu memanggil `cloneProject` lagi — dan project tak hilang dari daftar.
  - tanpa `gitRemote` → tak ada tombol clone; ada "Isi git remote" yang membuka modal Edit.
  - "Pilih folder di device" → `api.putBinding(id, path)` lalu refresh.

Test lama yang ikut membuktikan tak ada regresi pemindahan FolderPicker:
`new-project-clone.test.tsx`, `new-project-reverse.test.tsx`, `edit-project-folder-picker.test.tsx`.

## Docs yang tersentuh

- `internal/docs/frontend/frontend-implementation.md` — seksi "Path project dipilih, bukan diketik
  (SPEC-217/218 · SPEC-858)": FolderPicker pindah dari `App.tsx` ke modulnya sendiri, call site
  keempat, dan seksi baru untuk kartu tanpa-dir.
- `internal/docs/architecture/api-contract.md` — catatan `POST /projects/:id/clone` (bukan lagi
  hanya jalur pembuatan project) dan daftar call site `GET /fs/browse`.
- Keduanya sudah ter-link di `internal/docs/README.md`; tak ada berkas doc baru.
