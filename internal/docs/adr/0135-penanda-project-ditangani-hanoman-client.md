# ADR-0135 — Penanda "ditangani oleh" pada Project: kolom `Json` yang MASUK sync, berisi snapshot device

- Status: berlaku
- Tanggal: 2026-08-21
- SPEC: SPEC-880
- Menegakkan: ADR-0043, ADR-0044, ADR-0045 · Kontras dengan: ADR-0072, ADR-0091, ADR-0103

## Konteks

Satu instalasi hanoman dipakai dari beberapa mesin (hub VPS + instance lokal) yang saling sync
lewat device token (ADR-0044/0045). Yang tak ada di mana pun: keterangan **project ini dipegang
mesin yang mana**.

`ProjectsScreen` dan detail project hanya menampilkan `repoDir`/`binding`, dan keduanya justru
**LOCAL-only** — `Project.repoDir` sengaja di luar `FIELDS.project`, `LocalBinding` bahkan tak
punya entitas sync. Akibatnya di hub setiap project tampak sama tak bertuan.

`SessionResult.deviceId` ada dan ikut menyeberang, tapi itu **jejak eksekusi per-sesi**, bukan
pernyataan kepemilikan: project yang belum pernah dikerjakan tak punya jejak sama sekali.

## Keputusan

**1. Kolom `Project.handledBy` (`Json?`, nullable, nol backfill) yang MASUK `FIELDS.project`.**

Ini pembalikan yang disengaja dari pola empat kolom project sebelumnya. `repoDir` (SPEC-217),
`schedulerOptIn` (ADR-0072), `leadOptIn` (ADR-0091), dan `autoMerge` (ADR-0103) semuanya
LOCAL-only karena masing-masing adalah **properti mesin ini** — path checkout, apakah mesin ini
ikut menjalankan scheduler, branch tujuan di checkout ini. `handledBy` adalah **pernyataan tentang
dunia**, dan justru menyeberangnya nilai itu yang jadi seluruh gunanya.

`Json` tunggal, bukan tabel join `ProjectHandler`: nilainya dibaca utuh, tak pernah di-`orderBy`,
dan tabel join yang tak ikut `SYNCED` akan melahirkan kelas gagal yang sama yang keputusan ini
hendak tutup. Preseden: `Spec.dependsOn` (ADR-0093), `Setting.conflict` (ADR-0081).

**2. Tiap entri adalah SNAPSHOT device `{ deviceId, name }`, bukan sekadar FK.**

`DeviceToken` **tidak** ikut `SYNCED` — ia server-local di hub, dan `sync-exclusions.test.ts`
menegakkannya. Client penerima karena itu **tak punya baris device untuk di-join**. Tanpa `name`
yang ikut tersimpan, chip di client tampil **kosong tanpa satu pun error** — persis kelas
gagal-senyap ADR-0090/0093/0105.

`revoked` sengaja **tidak** disimpan: ia turunan baris `DeviceToken` lokal dan berbeda per
instance. Menyimpannya berarti membekukan fakta hub ke dalam record yang menyeberang.

**3. Penyimpanan mentah, tampilan yang menghitung.** `toProjectView` memperkaya nilai tersimpan
jadi `{ deviceId, name, revoked }`: nama **hidup** menang bila barisnya ada di instance ini
(rename device ikut terlihat), snapshot jadi jaring pengamannya, dan `revoked` selalu `false` di
instance yang tak memegang katalog device.

**4. Gerbang tulis menghakimi hanya bila ia berhak.** Instance tanpa satu pun baris `DeviceToken`
(client) menerima `deviceId` apa adanya — katalognya hidup di hub. Device yang **sudah dicabut**
tetap sah: kalau tidak, satu PATCH yang cuma mengganti nama project akan menolak nilai yang sudah
tersimpan. Revoke **tidak pernah** menghapus penanda; jejak historis tetap terbaca, bertanda
"dicabut".

**5. Editor jatuh ke baca-saja di instance tanpa katalog device**, dan pada mode itu `handledBy`
**dihilangkan sepenuhnya** dari body PATCH. Mengirim `[]` dari sana akan **menghapus** nilai yang
di-set di hub, dan penghapusan itu menyeberang.

**6. Murni informasional.** Penanda ini tak menggerbangi start sesi, worktree, auto-merge,
scheduler, maupun lead. Sesi tetap boleh dijalankan dari mesin mana pun.

## Kompatibilitas versi: rilis HUB DULU

`validateSyncData` **melempar** untuk field tak dikenal, dan `applyPush` memanggilnya lebih dulu.
Bahayanya lebih luas dari "project yang penandanya diisi": `snapshot()` menyusun `data` dari
**seluruh** `FIELDS`, jadi client baru mengirim `handledBy: null` di **setiap** push project.
Terhadap hub versi lama, **setiap** push project ditolak sampai hub di-upgrade.

Dua langkah, dan keduanya jujur soal batasnya:

1. **Urutkan rilis: hub dulu.** Tak ada kode di sisi client yang bisa membuat hub lama menerima
   field yang tak dikenalnya.
2. **`POST /sync/push` menangkap kegagalan per-record** → `{ id, ok: false, error }` alih-alih 500
   untuk seluruh batch (bentuk yang sudah dipakai route itu untuk `"unknown entity"`). Ini **tak
   menolong hub lama** — ia menutup kelasnya untuk setiap penambahan field berikutnya.

Kegagalan sisi client sendiri **sudah** non-destruktif dan sembuh sendiri: item outbox bertahan,
tak ada tulisan yang korup, dan ia lolos begitu hub naik versi. Yang ditambahkan hanya satu
`console.warn` supaya kemacetan itu bisa didiagnosis, bukan ditebak.

## Konsekuensi

**Baik.** "Apa saja yang dipegang mesin X" bisa dijawab satu klik (`GET /projects?handledBy=<id>`).
Hub berhenti menampilkan project tak bertuan. Setiap penambahan field sync ke depan tak lagi bisa
meruntuhkan satu batch push utuh.

**Buruk.** Nama device tersimpan **dua kali** (baris `DeviceToken` di hub + snapshot di tiap
project) — konsekuensi yang diterima sadar: satu-satunya alternatif adalah menyync `DeviceToken`,
dan itu memindahkan kredensial-adjacent ke setiap client. Nama basi hanya terlihat di instance
yang tak punya baris device-nya; di mana pun barisnya ada, nama hidup yang menang.

**Batas.** Penanda ini **bukan** otorisasi dan **bukan** routing. Ia tak dibaca satu pun jalur
eksekusi, dan tak boleh mulai dibaca tanpa ADR baru.
