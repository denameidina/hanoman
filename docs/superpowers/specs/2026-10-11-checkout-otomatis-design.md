# Checkout otomatis & kredensial git lintas device — design

Tanggal: 2026-10-11 · Status: draf menunggu review

## Masalah

Menjalankan sesi di project server/client tidak seamless di device atau VPS lain:

1. Sync hanya membawa metadata project. `Project.repoDir` dan `LocalBinding` sengaja LOCAL-only
   (ADR-0135, `server/src/services/sync.ts:61-70`), jadi project hasil sync mendarat tanpa checkout
   dan sesi gagal sampai ada binding manual (`server/src/services/local-binding.ts:27-32`).
2. Clone membutuhkan akses git. Di mesin baru belum ada `gh auth`/ssh key, sehingga clone repo
   private gagal sampai pengguna login manual.
3. `POST /projects/:id/clone` berjalan sinkron di request HTTP (`server/src/routes/bindings.ts`),
   dan tombol clone di UI belum rapi (`docs/superpowers/specs/2026-08-21-spec-867-project-tanpa-dir-lokal-design.md`).

## Tujuan

Di device/VPS baru yang sudah terhubung ke hub, meluncurkan sesi untuk project mana pun langsung
jalan: hanoman meng-clone repo sendiri dengan kredensial yang dibawa dari hub, memasang binding,
lalu membuat worktree. Tanpa login git manual.

## Di luar scope

- Setup per worktree (`.env`, install deps, port dev server).
- Melanjutkan sesi/worktree lintas device.
- Penyedia git selain GitHub.
- Memberi token ke agen sesi (hanya hanoman yang memakainya, di luar proses agen).

## Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| 1 | Auto-clone saat launch bila binding kosong | Pilihan pengguna; nol klik tambahan |
| 2 | Lokasi clone `$HANOMAN_HOME/projects/<slug>` | Satu root yang dikelola hanoman; binding manual tetap menang |
| 3 | Token GitHub disimpan di hub, ditarik client lewat device token | Topologi hub–client sudah ada (ADR-0044); tidak perlu keypair baru |
| 4 | Token LOCAL-only per instance, dienkripsi `secret.key` lokal | Konsisten dengan `secret-box`; tidak masuk whitelist `sync.ts` |
| 5 | Clone berjalan asinkron, status lewat `/api/events/ws` | Clone lama; request tak boleh menggantung (ADR-0039) |
| 6 | Agen sesi tidak menerima token | Menghindari eskalasi (alasan sama dengan ADR-0199 butir 4) |

## Rancangan

### 1. Alur launch (`session-launch.ts`)

Saat `resolveRepoDir` tidak menemukan binding:

1. `Project.gitRemote` kosong → launch gagal, galat menyebut project.
2. Pastikan ada kredensial: token lokal, atau tarik dari hub (bagian 2). Bila tak ada dan git
   tidak punya akses sendiri → galat yang menunjuk Settings → Akses Git.
3. `git clone` ke `$HANOMAN_HOME/projects/<slug>` dengan `GIT_ASKPASS` sementara. URL remote dan
   `.git/config` tidak memuat token; remote SSH diubah ke HTTPS hanya untuk operasi clone.
4. Pasang `LocalBinding`, lanjut ke `addWorktree`.
5. `git fetch` sebelum `addWorktree` bila `branchFrom` tidak ada lokal; ref yang tetap tak
   ditemukan = galat jelas, tidak jatuh diam-diam ke HEAD.

Kunci per project: dua launch bersamaan untuk project yang sama menghasilkan satu clone; yang
lain menunggu hasilnya. Clone terputus → hapus folder sisa, tandai launch gagal, bisa dicoba ulang.
Folder tujuan yang sudah berisi repo dengan remote yang cocok dipakai ulang sebagai binding;
folder lain yang sudah ada tidak pernah ditimpa.

Status "cloning" disiarkan lewat kanal `/api/events/ws` agar kartu sesi menampilkan progres.

### 2. Kredensial git

Model baru `GitCredential` (LOCAL-only, tanpa `version`, tidak disync sebagai record biasa):
`host`, `tokenEnc` (secret-box), `scopeNote`, `source` (`manual` | `hub`), `createdAt`.

- **Hub**: pengguna mengisi token GitHub sekali di Settings; hanoman memvalidasi lewat
  `GET /user` dan menampilkan akun + scope. Disarankan fine-grained token terbatas ke repo yang dipakai.
  API tidak pernah mengembalikan token dalam plaintext.
- **Client**: endpoint baru `GET /sync/git-credential` (Bearer device token, TLS) mengembalikan
  token dari hub. Client menyimpannya terenkripsi dengan `secret.key` lokal (`source: hub`).
  Diambil saat siklus sync dan saat launch bila token lokal tidak ada.
- **Pencabutan**: menghapus token di hub membuat endpoint menjawab 404 pada sync berikutnya;
  client menghapus salinan `source: hub`-nya. Device token yang dicabut kehilangan akses otomatis.
- **Pemakaian**: skrip `GIT_ASKPASS` membaca token dari proses hanoman via env sementara pada
  proses git anak; tidak ditulis ke disk, tidak masuk log.

### 3. UI

- Settings → "Akses Git": kolom token (write-only), status validasi, asal token, tombol Hapus.
- Kartu sesi: status "Cloning repo…" selama clone.
- Project tanpa checkout: badge "Belum ada di device ini" + tombol "Clone sekarang" (jalur sama
  dengan auto-clone; menutup celah spec-867). Mengikuti `internal/docs/design-system/**`.

### 4. Galat

| Kondisi | Hasil |
|---|---|
| `gitRemote` kosong | Launch berhenti, menyebut project |
| Tanpa token dan git tak punya akses | Pesan menunjuk Settings → Akses Git |
| Token ditolak (401/403) | "Token kedaluwarsa atau tanpa akses ke repo ini", dengan nama repo |
| Disk penuh / folder tujuan terisi repo lain | Launch berhenti, tidak menimpa |
| Clone terputus | Folder sisa dihapus, launch gagal, bisa retry |
| `branchFrom` tak ada setelah fetch | Galat jelas, tanpa fallback HEAD |
| Launch bersamaan | Satu clone, lainnya menunggu |

## Kontrak & dokumen (satu commit yang sama)

- Migration Prisma `GitCredential` + ADR baru (0203) karena perubahan skema.
- ADR itu juga mencatat jalur `GET /sync/git-credential` sebagai kanal mesin-ke-mesin Bearer
  device token (mengikuti ADR-0199 butir 4: tidak dibungkus MCP, masuk `UNWRAPPED`).
- Settings "Akses Git": keputusan MCP wajib (ADR-0202) — tool status token tanpa nilai token,
  atau pengecualian beralasan di `COOKIE_ONLY`. Tidak ada tool yang mengembalikan token.
- Update `internal/docs/architecture/data-model.md`, `api-contract.md`, dan `internal/docs/README.md`.
- Ganti `POST /projects/:id/clone` sinkron dengan jalur asinkron yang sama, atau jadikan tipis di atasnya.

## Test

- Unit `session-launch`: binding kosong → clone → binding terpasang; binding ada → tanpa clone;
  satu kasus per baris tabel galat. Git dipalsukan lewat seam `realGit`.
- Unit kredensial: enkripsi bolak-balik, token tidak muncul di log/URL/`.git/config`,
  pencabutan di hub menghapus salinan client.
- Konkurensi: dua launch paralel = satu clone.
- Gerbang: agent token (bukan device token) ditolak 401 di `/sync/git-credential`
  (pola `instance-sync-gate.test.ts`).
- Integrasi lokal: clone nyata dari repo git sementara dengan askpass, lalu curl endpoint tersentuh.
- Test server dijalankan dengan `--no-file-parallelism` dan `TEST_DATABASE_URL` terpisah.

## Pertanyaan terbuka

- Apakah `Project.gitRemote` sudah terisi untuk semua project yang dipakai lintas device? Project
  tanpa remote tidak bisa di-auto-clone dan perlu diisi dulu.
- Apakah tombol clone spec-867 sudah ada di `src/`? Belum diperiksa; bila sudah, rancangan UI
  cukup memakai ulang.
