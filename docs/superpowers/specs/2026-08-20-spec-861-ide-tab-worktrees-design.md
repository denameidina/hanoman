# SPEC-861 — IDE: tab Worktrees (daftar worktree hidup + hapus worktree & branch sekaligus)

Tanggal: 2026-08-20 · sumber: brief backlog SPEC-861 · prioritas sedang

## Masalah

Satu backlog = satu sesi = satu git worktree di `<repoDir>/.worktrees/<session-id>` (ADR-0002/0015).
Sisi **branch**-nya sudah punya permukaan bersih-bersih — tab **Branches** (SPEC-360/ADR-0077).
Sisi **worktree**-nya tidak: satu-satunya yang terlihat dari dashboard adalah `WorktreeCleanupView`
(SPEC-742/ADR-0116), dan itu hanya membaca `<repoDir>/.worktrees/.trash/` — worktree yang **sudah**
dilepas dan sedang dihapus byte-nya. Worktree yang masih **hidup** di `.worktrees/` tak terdaftar
di mana pun.

Akibatnya worktree yatim (sesi mati tak wajar, penutupan gagal di tengah, sisa migrasi/rename repo,
worktree buatan tangan) hanya bisa ditemukan lewat `git worktree list` di terminal. Reaper tak
pernah menyentuhnya — domainnya sengaja `.trash/**` dan HANYA itu, dan invarian itulah yang membuat
desainnya bebas kunci. Sisa-sisa itu memakan disk, dan registrasinya membuat `BranchLock: "worktree"`
mengunci branch di tab Branches sehingga branch-nya pun tak bisa dibersihkan — dua kebuntuan yang
saling mengait.

## Yang dibangun

Tab **Worktrees** di IDE (bersebelahan dengan Explorer / Git Graph / Branches) plus endpoint
pendukungnya.

### 1. Service murni `server/src/services/worktree-list.ts`

Cermin `branch-cleanup.ts` sepenuhnya:

- **Nilai turunan penuh** dari `git worktree list --porcelain` tiap request (ADR-0018/0011): tak ada
  kolom DB, tak ada cache.
- **Murni**: sinyal non-git (Spec + stage, sesi tmux hidup) masuk sebagai `Map`/`Set` parameter,
  bukan import — supaya modul ini bisa dites tanpa DB maupun tmux.
- **`out()` tak pernah melempar**: repo rusak / tanpa commit → daftar kosong, bukan 500.
- `execFile` async, bukan `spawnSync` — route ini melayani event loop yang sama dengan terminal PTY.

Bentuk baris (`WorktreeView`, di `@hanoman/shared`):

```ts
export type WorktreeView = {
  path: string;                 // absolut, apa adanya dari git
  name: string;                 // basename — juga id baris di API tulis
  head: string;                 // sha HEAD ("" bila tak terbaca)
  branch: string | null;        // null = detached HEAD (sesi hanoman selalu detached, ADR-0002)
  prunable: boolean;            // registrasi menunjuk direktori yang sudah lenyap
  locked: boolean;              // `git worktree lock`
  main: boolean;                // worktree utama repo
  deletable: boolean;           // ownsWorktree(repoDir, path) — SATU-SATUNYA gerbang
  spec: { id: string; stage: string } | null;
  session: { id: string; specId: string | null } | null;   // sesi tmux HIDUP di worktree ini
  createdAt: string | null;     // ISO
};
export type WorktreeReport = { repoDir: string; worktrees: WorktreeView[] };
```

**Entri `.trash/**` DIKECUALIKAN** — itu wilayah reaper, sudah punya permukaannya sendiri
(`GET /terminal/cleanups`). Filternya path-prefix terhadap `trashDirOf(repoDir)`, bukan substring.

**Pemetaan worktree → backlog.** `basename(path)` dibandingkan dengan id sesi yang deterministik
dari id spec: `sessionIdForSpec(specId)` (ADR-0015). Route membangun `Map<sessionId, {id, stage}>`
dari `prisma.spec.findMany({ where: { projectId } })` dan menyerahkannya ke service. Worktree
`merge-*` (integrasi) dan `cron-*` (ADR-0112) memang tak memetakan ke spec mana pun → `null`.

**`deletable` = `ownsWorktree(repoDir, path)`, tanpa kecuali.** Predikat itu ada persis untuk lubang
ini: hanoman didogfood di dalam worktree-nya sendiri, sehingga sebuah project bisa ter-bind ke
checkout yang kebetulan berada di bawah `.worktrees/` — menguji bentuk path saja pernah membuat
`removeWorktree(repoDir, repoDir)` menghapus checkout project itu sendiri (SPEC-362). `repoDir`
sendiri tetap **tampil** sebagai baris (berguna: ia menunjukkan checkout project) dengan
`main: true, deletable: false`; direktori `.worktrees` tak pernah jadi baris karena ia bukan
worktree terdaftar.

**`createdAt`** = `stat(join(path, ".git"))` → `birthtime` bila valid, jatuh ke `mtime`. Untuk
worktree tertaut `.git` adalah **berkas** yang ditulis sekali saat `worktree add` dan tak pernah
disentuh lagi, jadi ia stempel lahir yang jujur. Baris `prunable` (direktorinya lenyap) → `null`.

### 2. Sinyal mahal di endpoint kedua

Ukuran disk dan status kotor berpotensi lambat di repo besar, dan daftar tak boleh menunggu
keduanya. Karena itu **dua endpoint**:

```
GET  /projects/:id/worktrees                 → WorktreeReport   (field murah saja)
GET  /projects/:id/worktrees/stats?name=…    → WorktreeStats    (per baris, dimuat menyusul)
```

```ts
export type WorktreeStats = {
  name: string;
  sizeBytes: number | null;   // null = du gagal/timeout
  dirtyFiles: number;         // `git status --porcelain` di worktree itu
  orphanCommits: number;      // commit yang HANYA hidup di worktree ini
};
```

`name` divalidasi terhadap daftar turunan — klien tak bisa menyelundupkan path lewat query; nama
yang tak ada di daftar → 404.

**`orphanCommits` = kerja yang benar-benar akan hilang.** Bukan sekadar "tak ter-merge": commit yang
reachable dari HEAD worktree ini tetapi tidak dari ref lain **mana pun**, dengan branch yang
ter-checkout DI SINI ikut dikecualikan (karena checkbox 'hapus branch juga' akan ikut menghapusnya):

```
git rev-list --count <head> --not --exclude=<branch> --branches \
                            --exclude=*/<branch> --remotes --tags
```

**Gotcha terukur (git 2.50.1):** pola `--exclude` untuk `--branches` **relatif terhadap
`refs/heads/`** — `--exclude=feat` bekerja, `--exclude=refs/heads/feat` **tidak** (diam-diam tak
mengecualikan apa pun). Untuk `--remotes` ia relatif terhadap `refs/remotes/` → `*/feat`. Dan
`--exclude` **di-reset sesudah setiap** `--branches`/`--remotes`/`--tags`, jadi ia wajib ditulis
ulang sebelum masing-masing. Worktree detached tanpa branch memakai bentuk polos tanpa `--exclude`.

Ukuran disk: `du -sk <path>` async ber-timeout; gagal → `null`, bukan 500.

### 3. `POST /projects/:id/worktrees/delete`

Body `{ names: string[], deleteBranch?: boolean }`. Selalu 200 bila body sah — kegagalan hidup di
baris `results`, bukan di status HTTP (cermin `/branches/delete`).

```ts
export type WorktreeDeleteResult = {
  name: string;
  ok: boolean;
  cleanup: string | null;                 // nama entri `.trash` yang lahir (SPEC-742)
  closedSession?: string;                 // sesi yang ikut ditutup
  branch?: BranchDeleteResult;            // hasil deleteBranches, bila diminta
  error?: string;
};
```

Urutan per baris, dan urutannya mengikat:

1. **Turunkan ulang daftarnya sendiri** dan cari `name` di sana. Tak ada → error. Klien tak pernah
   memberi path.
2. `!deletable` → error. Ini gerbang `ownsWorktree`, ditegakkan **di jalur tulis**, bukan sekadar
   petunjuk UI (cermin pagar per-branch ADR-0077).
3. Ada sesi tmux hidup → **tutup lewat jalur penutupan sesi yang sudah ada**, bukan mencabut
   direktori dari bawah proses yang masih jalan. Lihat §4.
4. Tak ada sesi → `releaseWorktree(repoDir, path, projectId)` langsung (SPEC-742: hanya `rename` ke
   `.trash`, lalu balas; byte-nya dihabisi `worktree-reaper.ts`).
5. `git worktree prune` — supaya registrasinya lenyap **sekarang**, dan bersamanya kunci
   `BranchLock: "worktree"` di tab Branches. Ini yang membuka kebuntuan.
6. `deleteBranch && row.branch` → `deleteBranches(repoDir, [branch], { scope: "both", ...lockInputs })`.

**Tak ada baris terkunci permanen — tapi pagar branch tetap berdiri.** Kedua kalimat itu tidak
bertabrakan: yang tak pernah terkunci adalah **baris worktree** (sesi hidup, backlog belum done, isi
kotor semuanya **peringatan** yang dinamai dialog konfirmasi, bukan penolakan). Penghapusan
**branch** tetap lewat `deleteBranches` **beserta pagar kuncinya** — brief menyuruh memakai ulang
jalur itu, bukan menulis jalur kedua. Konsekuensinya jujur dan dilaporkan per baris: branch sesi
untuk backlog yang belum `done` akan gagal dengan `terkunci: backlog-nya belum selesai`, sementara
worktree-nya tetap terhapus. Itu tetap membuka kebuntuan, karena kunci `worktree` sudah lepas dan
branch-nya bisa dibersihkan dari tab Branches begitu backlog-nya selesai.

Baris `prunable` (registrasi tanpa direktori) melewati jalur yang sama: `releaseWorktree` menjawab
`null` karena tak ada yang dipindah, lalu langkah 5 yang membuang registrasinya.

### 4. Ekstraksi `services/session-close.ts`

"Tutup sesi" hari ini hidup **inline di dalam** `DELETE /terminal/sessions/:id`: `advanceStage` →
`recordHeadSha` → `killSession` → gerbang `ownsWorktree` → `releaseWorktree`. Menyalinnya ke route
worktrees adalah persis kelas bug yang sudah menggigit repo ini berkali-kali (SPEC-431/448/475/481:
satu definisi, N call site). Badannya karena itu pindah utuh ke
`server/src/services/session-close.ts`:

```ts
export async function closeSession(id: string): Promise<{ cleanup: string | null } | null>;
```

`null` = sesi tak ada (route balas 404). Perilaku `DELETE /terminal/sessions/:id` **tidak berubah**
sebaris pun; ia jadi pembungkus tipis. Route worktrees memanggil fungsi yang sama, jadi
`advanceStage` & `recordHeadSha` — dua bacaan yang WAJIB terjadi selagi worktree masih di tempatnya —
ikut jalan tanpa satu pun call site perlu mengingatnya.

### 5. Capability

`worktrees` masuk `IDE_SUBS` di `agent-capabilities.ts` → `ide:read` untuk GET, `ide:write` untuk
POST. `rw()` sudah menurunkannya **dari method**, jadi tak ada pengulangan kelas bug SPEC-405
(prefix dipetakan tanpa melihat method).

### 6. Frontend — `src/src/screens/WorktreesPanel.tsx`

Pola `BranchesPanel.tsx`: `Card padding={0}`, header ber-`hn-eyebrow`, seleksi multi-baris lewat
`Checkbox`, badge alasan, `StateBlock` untuk loading/error/empty. Design system
`internal/docs/design-system/**` apa adanya.

Per baris: nama + path relatif, branch (atau `sha` pendek + badge `detached`), badge `SPEC-nnn ·
<stage>`, badge peringatan (`sesi aktif`, `belum selesai`, `kotor`, `prunable`, `checkout project`),
umur, ukuran disk. Sinyal mahal dimuat menyusul per baris dengan konkurensi kecil dan tampil `…`
sampai datang.

**Konfirmasi destruktif** lewat `useConfirm` (ADR-0127 — brief menyebut ADR-0125, tetapi kontrak
konfirmasi destruktif final bernomor **0127**; 0125 adalah "akhir sesi riwayat tercatat"). Dialog
menyebut secara spesifik apa yang akan hilang lewat `impact[]`: sesi yang ikut ditutup, berapa
commit yang tak ada di tempat lain, berapa berkas belum tersimpan, dan — bila dicentang — branch
yang ikut dihapus. Bila stats sebuah baris belum termuat saat tombol ditekan, panel **menunggu**
satu fetch stats sebelum membuka dialog: dialog yang tak bisa menyebut angkanya bukan konfirmasi.

Checkbox **'hapus branch juga'** hanya hidup bila setidaknya satu baris terpilih punya branch —
worktree detached tak punya apa pun untuk dihapus.

State tampilan (`deleteBranch`, nanti filter bila perlu) lewat `usePersistedState` ber-scope
`ide`/project (SPEC-740). Nilai `tab` sudah persisten dan menerima string apa pun, jadi tab baru
ikut tanpa perubahan.

### 7. Kaitan dua arah dengan tab Branches

- `UnusedBranch` dapat field **additif** `worktree?: string` — path worktree yang menguncinya.
  `worktreeBranches()` di `branch-cleanup.ts` berubah dari `Set<string>` jadi `Map<string, string>`
  (nama branch → path).
- `BranchesPanel`: badge `dipakai worktree` jadi tombol yang membawa ke tab Worktrees dengan baris
  itu ter-fokus.
- `WorktreesPanel`: nama branch pada sebuah baris membawa ke tab Branches.
- `IdeScreen` memegang `worktreeFocus`/`tab` dan meneruskannya sebagai prop; tak ada router URL di
  dashboard (state `section`, ADR-0115).

## Yang TIDAK berubah

- **Domain reaper tidak diperlebar.** Ia tetap hanya menyentuh `.trash/**`. Yang berubah adalah APA
  yang masuk ke `.trash`, bukan ke mana reaper melangkah. Invarian bebas-kunci ADR-0116 utuh.
- Tak ada kolom DB, tak ada migration, tak ada model baru. Seluruh daftar adalah nilai turunan.
- `DELETE /terminal/sessions/:id` berperilaku identik.

## Test

Wajib, sesuai constraint brief:

1. **Parsing `git worktree list --porcelain`** atas repo git sungguhan: detached HEAD, branch
   ter-checkout, `prunable`, `locked`, worktree utama, dan **`.trash/**` terkecualikan**.
2. **Pemetaan worktree → SPEC** lewat `sessionIdForSpec`, termasuk worktree yang tak memetakan
   ke spec mana pun.
3. **Pagar `repoDir`/`.worktrees` sendiri**: `deletable:false` untuk worktree utama, dan kasus
   dogfood (project ter-bind ke checkout DI BAWAH `.worktrees/`) → tak ada baris yang deletable.
4. **Git rusak / tanpa commit → daftar kosong, tak melempar.**
5. **`orphanCommits`**: 0 saat commit-nya juga ada di branch lain, > 0 saat hanya hidup di sini,
   dan kasus branch-ter-checkout-di-sini yang ikut dikecualikan.
6. **Jalur hapus-dengan-branch** (route test): worktree lepas → `.trash`, registrasi ter-prune,
   `deleteBranches` terpanggil, dan branch terkunci melapor alasannya tanpa membatalkan penghapusan
   worktree-nya.
7. **Sesi hidup** ditutup lewat `closeSession` lebih dulu.
8. Frontend: baris terender, dialog konfirmasi menyebut angka kerugian, checkbox branch, dan
   tautan dua arah.

## Docs yang tersentuh

- ADR baru untuk permukaan penghapusan ini (nomor berikutnya, `0132`).
- `internal/docs/architecture/api-contract.md` — tiga endpoint baru.
- `internal/docs/README.md` — tautan ADR baru.
- `internal/skills/hanoman/SKILL.md` — aturan arsitektur ringkas (cermin entri SPEC-360).
