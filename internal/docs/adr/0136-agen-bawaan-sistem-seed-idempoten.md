# ADR-0136 — Agen bawaan sistem: katalog konstanta yang di-SEED sebagai baris, diperbarui hanya bila belum disunting

- Status: Accepted — default/policy builtin **diamandemen ADR-0159**
- Tanggal: 2026-08-22
- SPEC: SPEC-881 (custom agent bawaan sistem)
- Terkait: **memperluas** [0094](0094-custom-agent-katalog-materialisasi-native.md) — katalog,
  anti-loop tiga lapis, dan materialisasi per agen tetap utuh; yang ditambah hanya isi katalognya
  dan satu dorongan di prompt; **memperluas** [0101](0101-form-custom-agent-katalog-runtime.md) —
  batas katalog tool yang ditegakkannya kini juga mengikat entri bawaan;
  **mengikuti** [0113](0113-registry-metode-workflow.md) (tabel konstanta sebagai satu-satunya
  tempat pengetahuan hidup) dan [0119](0119-tombstone-sync-penghapusan-menyeberang.md)
  (penghapusan adalah keadaan, bukan ketiadaan); **tidak menyentuh**
  [0045](0045-skema-sync-synclog-version-stamp.md) — nol kolom baru, jadi `FIELDS` tak berubah;
  **diamandemen** [0159](0159-custom-agent-native-terukur-terisolasi.md) pada default QA,
  execution profile, model rekomendasi, dan aktivasi smart.

> **Amandemen 2026-08-31 (SPEC-950/ADR-0159):** hanya tiga builtin aktif default (`scout`,
> `blast-radius`, `security-reviewer`), semuanya smart + read-only. `qa-verifier` menjadi opt-in,
> isolated-worktree, 40 turn/900 detik. Upgrade mematikan seed QA lama yang belum disunting tepat
> sekali; baris operator-edited tetap utuh. Tabel konstanta sekarang juga membawa profile dan
> rekomendasi model per runtime, sementara kolom `model` seed tetap null agar override operator
> dan pemilihan runtime tetap bekerja.

## Konteks

Fitur custom agent lengkap sejak SPEC-450/484: katalog di DB, id deterministik `<scope>:<name>`,
anti-loop tiga lapis, materialisasi berbeda per mesin (`--agents` untuk claude, blok roster prosa
untuk codex), form dengan dropdown tool/model/runtime, validasi keras di server. Yang tak pernah
terjadi adalah **pemakaiannya**: katalog kosong di setiap instalasi. ADR-0094 mencatat "berbiaya nol
saat tak dipakai" sebagai konsekuensi — kalimat yang hari ini terbaca sebagai "tak dipakai".

Sebabnya bukan bug. Custom agent menuntut operator menulis prosa persona dari nol sebelum tahu
apakah ia berguna, di permukaan yang tak memberi satu pun contoh. Biaya masuknya lebih tinggi
daripada nilai yang terlihat.

## Keputusan

**1. Delapan persona audit awal, dua per domain, dipilih lewat tiga syarat yang menggugurkan.** Entri harus
(a) punya **prosedur**, bukan persona — "kamu reviewer, review-lah" tak menambah apa pun di atas
model utama; (b) menutup kelas kegagalan yang **terukur**; (c) membakar konteks di tempat lain lalu
mengembalikan **putusan kecil** — itu satu-satunya keuntungan struktural subagent claude.

| domain | agen | menyala |
|---|---|---|
| software development | `scout` · `root-causer` | `scout` |
| QA | `qa-verifier` · `edge-case-hunter` | — *(diamandemen ADR-0159)* |
| audit | `blast-radius` · `spec-auditor` | `blast-radius` |
| security | `security-reviewer` · `dep-auditor` | `security-reviewer` |

Yang gugur karena syarat itu: `doc-syncer`, `adr-writer`, `changelog-writer` (fase pipeline & method
skill sudah mengerjakannya) dan `secret-scanner` (satu regex, bukan agen — ia menjadi satu langkah
di dalam `security-reviewer`).

**Amandemen 2026-09-05 — pembuatan dan dukungan aplikasi.** Katalog diperluas
menjadi 16 dengan product-designer, feature-builder, performance-engineer,
product-analyst, solution-architect, operations-engineer, support-triager dan
knowledge-maintainer. Kelompok ini menjalankan pekerjaan bounded dengan artefak
dan bukti, bukan audit saja; efektivitasnya belum dibenchmark. Knowledge-maintainer
menangani pengetahuan pengguna lintas panduan/FAQ/runbook berdasarkan versi terverifikasi,
bukan sekadar menggandakan langkah doc-sync fase. Semua tambahan opt-in/smart;
lima yang menulis memakai isolated-worktree, tiga analisis read-only. Profil,
input dan handoff dijelaskan di [panduan](../operations/app-support-agents.md).

**2. Katalog hidup sebagai TABEL KONSTANTA di `shared`, DATA MURNI.** Pola registry `METHODS`
(ADR-0113): menambah agen = satu entri data. Nol I/O dan **nol `node:*`** — paket itu ikut
dibundel untuk browser, dan sidik jarinya karena itu dihitung di server.

**3. Nilai scope/delegasi untuk seluruh katalog BUKAN field entri.** `projectId` null · `model` null ·
`mentions` `[]` · `runtime` null. Menjadikannya field berarti mengundang entri masa depan yang
memasang `mentions`, dan itu membuka kembali lapis-1 anti-loop ADR-0094 yang hari ini nol risiko:
tanpa `mentions`, `Task` **dicabut** dari argv dan agen daun tak punya alat memanggil siapa pun.

**4. Bawaan lahir sebagai BARIS `CustomAgent` sungguhan (seed), bukan lapis override keempat.**
Ia langsung terlihat, bisa disunting, dimatikan, dan dihapus di permukaan yang sudah ada — tanpa
menambah aturan resolusi baru di samping "project menimpa global".

**5. Seed menghormati TOMBSTONE.** Baris yang absen **dan** punya `SyncTombstone` dilewati. Tanpa
klausa ini, penghapusan operator dibatalkan setiap boot — fitur yang tak bisa dimatikan. Ini yang
membuat ADR-0119 menjadi prasyarat, bukan sekadar tetangga.

**6. Upgrade hanya menimpa baris yang BELUM DISUNTING, dan jalurnya menuntut DUA syarat sekaligus.**
Isi baris sekarang masih persis sidik jari yang terakhir ditulis seed (= belum disentuh operator)
**dan** sidik jari versi terpasang berbeda dari itu (= memang ada yang baru). Tanpa syarat pertama,
upgrade menimpa kerja operator; tanpa syarat kedua, setiap boot menulis ulang baris yang sudah
mutakhir — `updatedAt` bergerak tanpa sebab dan menyeberang sync sebagai **mutasi palsu** ke setiap
mesin lain. `enabled` tak ikut pembaruan isi biasa; pengecualian satu kali untuk QA lama yang belum
disunting ditetapkan ADR-0159.

**7. Bookkeeping sidik jari menumpang `Setting.data`, dan karena itu LOKAL per mesin.** Nol
migration (kolomnya sudah `Json`), dan yang menentukan: `setting` **tidak ada** di `FIELDS` sync,
jadi dua mesin dengan versi hanoman berbeda tak bisa saling menimpa definisi bolak-balik.

**8. Status "bawaan" DITURUNKAN di lapis response, bukan disimpan.** `CustomAgentView` mendapat
`builtin` dan `builtinEdited`; keduanya dihitung di route, pola `inherited` yang sudah ada. Kolom
baru akan menyeberang changefeed, dan hub versi lama menolak **seluruh** push yang membawanya —
kelas SPEC-880, dibayar sekali dan tak perlu dibayar ulang di sini.

**9. Satu KLAUSA prompt parent berukuran tetap.** Amandemen 2026-09-05: daftar nama,
deskripsi dan penjelasan panjang agent dihapus dari prompt parent karena metadata sudah
terdaftar pada runtime native (ADR-0159). Parent hanya menerima arahan delegasi relevan,
handoff berbukti dan pemeriksaan hasil. Ukurannya tidak bertambah ketika jumlah/deskripsi
agent bertambah. Registry kosong → nol byte, jadi invarian "prompt byte-identik saat
katalog kosong" tetap utuh. Agent yang dimatikan tetap tidak didaftarkan.

## Konsekuensi

- Instalasi baru langsung punya 16 peran, tiga aktif — SPEC-450 berhenti menjadi permukaan
  kosong.
- Tiga yang menyala tersedia di registry sepanjang sesi yang kompatibel. Smart mengarahkan
  delegasi dari pekerjaan terkini, bukan menyaring registry dari diff saat kelahiran sesi
  (amandemen ADR-0159, 2026-09-05). Tiga belas yang mati tak ikut registry sampai diaktifkan.
- Baris bawaan **menyeberang sync** seperti baris custom agent lain. Dua mesin dengan versi hanoman
  berbeda berebut lewat LWW dan yang menulis terakhir menang. Diterima — bukan dihilangkan — karena
  id deterministik `global:<name>` membuat keduanya **satu baris**, bukan dua yang saling menelan
  (ADR-0094 keputusan 2).
- Tiga yang aktif default memakai read-only; tiga analis aplikasi tambahan juga read-only.
  Peran penulis meminta worktree terisolasi dan tidak boleh dianggap mengisolasi layanan eksternal.
- Prompt parent kedua runtime tidak menyalin nama/deskripsi/instruksi agent; nama/deskripsi
  tersedia pada registry native, instruksi lengkap pada config child. Metadata native dan
  laporan child tetap dapat memakai konteks; ini penghapusan duplikasi, bukan klaim nol token.

## Gotcha yang wajib diingat

1. **Urutan `seedBuiltinAgents()` → `loadCustomAgents()` MENGIKAT.** Terbalik = sesi pertama sesudah
   boot lahir tanpa agen bawaan (argv-nya sah, agennya cuma tak ada), dan gejalanya hilang sendiri
   di boot berikutnya — bug yang tak bisa direproduksi kalau urutannya tak diuji.
2. **Kunci bookkeeping WAJIB dideklarasikan di `zSetting`.** Zod membuang kunci tak dikenal dan
   `PUT /settings` menulis balik hasil parse — menyelipkannya sebagai kunci asing membuat seluruh
   bookkeeping lenyap di penyimpanan Settings pertama, tanpa satu pun error, dan seed lalu
   menganggap **semua** baris belum pernah disunting.
3. **`enabled` bukan bagian sidik jari.** Memasukkannya membuat operator yang mematikan satu agen
   terbaca sebagai "menyunting", sehingga perbaikan instruksi tak pernah lagi sampai ke baris itu.
4. **`name` immutable** (ADR-0094 keputusan 2). Mengganti nama bawaan di versi berikutnya
   meninggalkan baris yatim di setiap mesin. Delapan nama awal dikunci di SPEC-881,
   delapan tambahan di spec aplikasi 2026-09-05 yang ditautkan dari panduan.
5. **Tak satu pun bawaan boleh memakai nama tool MCP.** Nama server MCP berbeda per mesin; validasi
   keras ADR-0101 menolaknya, dan claude membuang nama tool tak dikenal **senyap** (ADR-0094 M4) —
   agen tanpa alat, exit 0, tanpa keluhan.
6. **Seed melewati validasi route.** Ia menulis langsung lewat Prisma, jadi batas `zCreateCustomAgent`
   (deskripsi ≤ 500, instruksi ≤ 20.000, nama lolos `AGENT_NAME_RE`) hanya ditegakkan test kontrak
   katalog. Kalau test itu tak ada, batasnya tak ada sama sekali.
7. **Jangan memulihkan mock Prisma dengan `mockRestore()`.** Pada klien Prisma ia **menghapus**
   method-nya alih-alih memulihkan, dan test berikutnya berjalan tanpa `findUnique` — seed diam-diam
   mengembalikan katalog kosong dan kegagalannya muncul di test yang lain, jauh dari sebabnya.
8. **`HANOMAN_CONTROL_ORIGINS` di shell menjawab 404 untuk route di belakang cookie.** Suite route
   yang merah ramai dengan `{"error":"not found"}` hampir selalu ini, bukan regresi.

## Alternatif yang ditolak

- **Konstanta runtime + lapis override keempat (builtin < global < project).** Nol baris DB, nol
  lalu lintas sync, selalu ikut versi terpasang. Ditolak operator: bawaan tak akan terlihat sebagai
  baris yang bisa disunting di UI, dan aturan resolusi bertambah satu tingkat untuk seterusnya.
- **Galeri template di form ("Tambah dari template").** Paling murah dan nol risiko sync. Ditolak
  karena tak satu pun yang benar-benar "bawaan" sampai operator mengklik — masalah biaya masuk yang
  jadi konteks ADR ini tetap utuh.
- **Selalu timpa tiap boot.** Definisi bawaan selalu persis versi terpasang. Ditolak: suntingan
  operator hilang di boot berikutnya, jadi menyunting agen bawaan menjadi tak ada gunanya.
- **Seed sekali seumur hidup per nama.** Paling sederhana dan paling aman. Ditolak karena instruksi
  bawaan yang keliru akan menetap di mesin operator selamanya, dan satu-satunya jalur perbaikan
  adalah menyuruh operator menghapus lalu membuat ulang.
- **Kolom `builtin` di skema.** Paling langsung dibaca. Ditolak: kolom baru menyeberang changefeed
  dan hub versi lama menolak seluruh push yang membawanya (kelas SPEC-880), untuk nilai yang bisa
  diturunkan dari nama.
- **Mengikat agen bawaan ke fase pipeline (QA wajib memanggil `qa-verifier`).** Paling pasti
  terpakai. Ditolak: ia mengubah kontrak pipeline untuk semua project sekaligus, dan sesi yang
  katalognya dimatikan operator akan punya instruksi yang menunjuk agen yang tak ada.
