# ADR-0151 — Papan Tim berlangganan PER KOLOM, dengan plafonnya terlihat

- Status: berlaku
- Tanggal: 2026-08-25
- SPEC: SPEC-946
- Memperluas: ADR-0150 (fondasi `Task`/`Member`)
- Menegakkan: ADR-0145/ADR-0039 (topik berparameter), ADR-0107 (limit adalah plafon), ADR-0115 (state tampilan persisten), ADR-0127 (konfirmasi destruktif), ADR-0094 (id deterministik)
- Mengamandemen: ADR-0150 pada permukaan `GET /api/tasks` (parameter `q`)
- **Diamandemen: ADR-0153** — konsekuensi "Linimasa (item D) tidak bisa menumpang topik `tasks`" di bawah **terbantah**; item D memakai `board` yang sudah dilanggan apa adanya
- **Diamandemen: ADR-0154** — paragraf item **E** di bawah ikut **terbantah**; Lintas project juga membaca `board`, dan plafon 200/kolom justru **berlaku** di sana

## Konteks

ADR-0150 mendaratkan fondasi data papan tim — `Task`, `Member`, pendaftaran sync, route CRUD, dan
satu topik siar berparameter `tasks`. Ia sengaja berhenti sebelum UI.

SPEC-946 memasang UI-nya: layar `Tim` dengan mode **Papan**. Di situ satu fakta di kontrak
SPEC-945 memaksa keputusan yang tak diantisipasi dokumen desain induk.

**Papan tidak dipaginasi** — kolom yang terpotong halaman bukan board; aturan yang sama sudah
berlaku untuk board Backlog. Tapi topik `tasks` **mewajibkan** `page` dan `limit`, dan `zSubLimit`
(`shared/src/dto.ts`) menjepit `limit` ke **maksimum 200**. Papan yang tak dipaginasi karena itu
harus tetap hidup di atas langganan yang berbatas.

## Keputusan

**1. Papan memasang EMPAT langganan, satu per kolom — bukan satu untuk seluruh papan.**

Satu langganan untuk seluruh papan bisa dibuktikan salah, bukan sekadar kurang optimal.
`buildTasksPage` mengurutkan `order asc, id asc` atas seluruh himpunan yang cocok. `order` bermakna
**di dalam** kolom, jadi urutan lintas-status tak punya arti sama sekali — dan potongan 200 pertama
karena itu memotong himpunan gabungan empat kolom di titik yang **sewenang-wenang**. Kolom mana
yang terpotong, dan seberapa, tak bisa dijelaskan kepada operator, dan tak bisa dijelaskan ke
dirinya sendiri oleh kodenya.

Empat langganan `{projectId?, status, memberId?, q?, page: 1, limit: 200}` memberi:

- tiap kolom `total`-nya **sendiri** — angka di kaki kolom jujur, bukan sisa pembagian;
- plafon yang berlaku **per kolom**, jadi kolom `done` yang menumpuk seiring waktu tak pernah
  menghabiskan jatah kolom `doing`;
- biaya 4 dari `MAX_SUBS = 16` per klien — satu layar Scheduler sudah memakai 5.

Menyaring kolom di toolbar **mempersempit kolom yang tampil**, dan hanya kolom yang tampil yang
dimuat & dilanggan. Biaya server ikut mengecil, bukan sekadar tampilan yang menyempit.

**2. Plafon kolom TERLIHAT.**

Begitu `total > items.length`, kaki kolom merender `menampilkan N dari M — persempit penyaring`.

Papan yang diam-diam memotong terbaca sebagai papan yang **lengkap**, dan itu kebohongan yang
paling mahal di layar ini: keputusan "siapa mengerjakan apa" diambil dari apa yang terlihat. Ini
penerapan prinsip yang sama dengan lencana **"basi"** SPEC-857/ADR-0131 — angka yang tak bisa
dipercaya harus mengatakannya sendiri.

**3. Muat awal HTTP memakai parameter yang IDENTIK dengan langganannya.**

Empat `GET /api/tasks` paralel, `limit=200`, satu per kolom yang tampil. Godaan yang ditolak:
memuat awal **tanpa** `limit` (route memang mengizinkannya — `paginate` tanpa limit mengembalikan
seluruh item) lalu menyerahkan pembaruan ke langganan berplafon. Akibatnya kartu **hilang** dari
layar tiga detik setelah muncul, tanpa satu pun tindakan operator dan tanpa satu pun error.

**4. Muat kedua dan seterusnya TIDAK mengosongkan layar.**

Hanya muat **pertama** yang boleh merender blok `loading`. Tanpa pemisahan itu, tiap huruf di kotak
cari — dan tiap ganti penyaring — membuat keempat kolom lenyap sekejap. Refetch yang gagal sesudah
papan tampil menandai hitungan **"basi"** (ADR-0131), bukan menimpa papan yang sudah benar dengan
layar galat.

Turunan dari prinsip yang sama: **kolom kosong di bawah penyaring tetap dirender sebagai kolom.**
"Dikerjakan 0" adalah jawaban; mengganti papan dengan blok "tak ada hasil" justru menyembunyikan
tiga kolom lain yang mungkin berisi. Yang layak menggantikan papan hanyalah papan yang benar-benar
kosong **tanpa** penyaring aktif — di sana blok kosongnya membawa pintu masuk "Tugas baru".

**5. `q` disaring di SERVER, sebelum paginasi.**

Amandemen kecil atas permukaan `GET /api/tasks` di ADR-0150. Alternatifnya — menyaring di klien —
nol perubahan kontrak, tapi pencarian hanya melihat ≤200 kartu yang sudah termuat: tugas ke-300 di
kolom `done` tak bisa ditemukan dengan mengetik judulnya, dan layar tak punya cara memberi tahu
bahwa ia sedang mencari **di dalam potongan**.

Bentuknya menyalin `buildTicketsPage` apa adanya: substring **case-insensitive** yang dihitung **di
memori** sesudah `findMany`, bukan `contains` Prisma — `contains` di SQLite peka huruf besar-kecil
untuk non-ASCII, dan `mode: "insensitive"` tak didukung provider ini. Ladangnya `title` + `detail`.

Ketikan **di-debounce 400 ms sebelum menyentuh KUNCI langganan**: tiap huruf melahirkan kunci baru
yang dibangun server di luar jadwal, jadi mengetik 12 huruf tanpa jeda berarti 12 pembangunan yang
sebelas di antaranya langsung dibuang. Muat HTTP tetap per-ketikan.

**6. Keempat kolom menerima drop — `canDropTask` adalah PEMBALIKAN, bukan penyempitan.**

Di board Backlog `canDrop` menyempit sampai satu transisi yang sah (`backlog → brainstorming`),
karena `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024) dan UI yang menulisnya akan membuat
`executing`/`done` tercapai tanpa sesi yang benar-benar berjalan. `Task.status` sebaliknya milik
manusia. Yang tersisa satu larangan:

```ts
export const canDropTask = (from: TaskStatus, to: TaskStatus): boolean => from !== to;
```

Drop ke kolom asal bukan perpindahan; menerimanya berarti satu `PATCH` yang menulis nilai yang
sudah ada, satu baris `SyncLog`, dan satu siaran ke tiap device — biaya baris yang lahir tanpa
pembaca sudah terukur di ADR-0131.

Kartu mendarat di **ujung** kolom tujuan (`order = max + 1`). Menyusun ulang kartu di dalam kolom
lewat drag bukan bagian item B: ia butuh indikator sisip antar-kartu. `Task.order` tetap bermakna
— naik monoton per kolom — jadi item D/E membacanya apa adanya.

**Gotcha yang sudah terjadi sekali dalam spec ini:** invariant itu punya DUA jalur masuk, bukan
satu. Drag menghitung `order` lewat `nextOrder`; `TaskModal` sempat tak mengirimnya sama sekali,
jadi tiap kartu yang lahir dari modal ber-`order: 0` dan urutan di dalam kolom runtuh ke `id asc`
sejak kartu **kedua** — "buat" menaruh kartu di ATAS sementara "drag" menaruhnya di BAWAH, dan
ganti kolom lewat modal membawa `order` kolom LAMA. Route menyambutnya tanpa keluhan
(`order: p.order ?? 0` saat create, `undefined` = jangan sentuh saat patch), jadi nol error dan
nol test merah — sementara ADR ini sudah menjanjikan monotonisitas yang akan dibaca item D/E.
Siapa pun yang menambah jalur tulis ketiga (eskalasi item C, impor massal) wajib melewatkan
`order` lewat perhitungan yang **sama**, bukan menyalin rumusnya.

**7. Aturan hidup sebagai fungsi MURNI, dan unit test-nya tidak cukup.**

`src/src/screens/team-rules.ts` nol React & nol I/O: `canDropTask`, `nextOrder`, `moveCard`,
`replaceCard`, `dateInputValue`, `dateInputToIso`.

Tapi `from`/`to` yang **tertukar saat dipasang** lolos dari unit test aturannya sendiri — persis
alasan `src/test/backlog-board.test.tsx` men-drag kartu sungguhan. Pola itu diikuti:
`src/test/team-board.test.tsx` memanggil `fireEvent.dragStart` + `fireEvent.drop` pada elemen
nyata di jsdom (yang tak punya `DataTransfer`, jadi objeknya dipalsukan).

`moveCard` mengembalikan papan baru **berikut** muatan PATCH-nya dari satu fungsi, supaya `order`
yang ditampilkan dan yang disimpan tak bisa berselisih.

**8. `<input type="date">` ↔ ISO ber-offset dikonversi di SATU tempat.**

`zCreateTask` menuntut `z.string().datetime({ offset: true })` sementara input tanggal memancarkan
`YYYY-MM-DD` — mengirimnya apa adanya dijawab `400` oleh route. Konversinya adalah dua fungsi murni
teruji, dan nilai yang dikirim adalah **tengah hari UTC**: `T00:00:00Z` mundur ke tanggal sebelumnya
di zona waktu barat, dan tanggal yang bergeser sehari saat dibaca kembali adalah bug yang tak
memunculkan satu pun error.

**9. Anggota dikelola di modal layar Tim, dan form ubahnya TIDAK punya field email.**

Bukan `SettingsScreen.tsx`, yang sudah 93 KB. `Member.id` diturunkan dari email (ADR-0094/ADR-0150)
dan changefeed sync tak punya operasi rename, jadi emailnya dirender sebagai **teks** plus kalimat
"ganti email berarti hapus lalu buat baru". Route sudah menolak `"email" in body` dengan `400`;
menawarkan field lalu membuangnya adalah persis kelas bug yang membuat lapis kedua itu ditulis.
Menghapus anggota lewat `useConfirm` (ADR-0127), dan dialognya menyebut bahwa tugasnya **tidak**
ikut terhapus (`onDelete: SetNull`).

## Konsekuensi

- Papan hidup di atas langganan berbatas tanpa pernah berbohong tentang batasnya.
- `GET /api/tasks` dan topik `tasks` punya satu parameter tambahan; keduanya tetap satu serializer
  (`buildTasksPage`), jadi tak ada kebenaran kedua yang bisa drift.
- Berkas UI terpisah sejak awal (`team-rules.ts` · `team-board.tsx` · `TaskModal.tsx` ·
  `MembersPanel.tsx` · `TeamScreen.tsx`; ADR-0152 menambah `EscalateDialog.tsx` dan ADR-0153
  `team-timeline.tsx`) — `BacklogScreen` 63 KB dan `TerminalScreen` 57 KB adalah pelajaran yang
  tak perlu diulang.
- `HN_NAV` bertambah satu entri, dan cabang `section === "team"` di `App.tsx` **wajib** menyertainya
  dalam commit yang sama: tanpa itu App merender kosong dan sidebar ikut lenyap (kelas bug
  `runs`/`triggers`, SPEC-162). Dijaga `src/test/changelog-nav.test.tsx`.

### Konsekuensi bagi item D & E (yang harus diputuskan sendiri)

**Linimasa (item D) tidak bisa menumpang topik `tasks` apa adanya.** Gantt membaca SELURUH task
bertanggal dalam satu jendela waktu, bukan 200 teratas per kolom — dan sumbunya tanggal, bukan
`order`, sehingga potongan `order asc` memotong justru di dimensi yang salah. Item D harus memilih
salah satu dengan sadar: parameter rentang tanggal pada topik yang sama, topik baru, atau muat HTTP
tanpa langganan. Keputusan itu **tidak** dibuat di sini.

> **TERBANTAH oleh ADR-0153 (2026-08-25).** Paragraf di atas salah menempatkan masalahnya di
> **sumbu**, padahal yang menumpang adalah **himpunan task**-nya: sumbu waktu lahir di klien dari
> `startDate`/`dueDate` yang sudah ikut di tiap baris `TaskView`. Item D karena itu memilih
> opsi **keempat** yang tak terdaftar di sini — membaca `board` yang sudah dilanggan per kolom,
> nol topik baru, nol langganan baru, nol fetch baru. Plafon 200/kolom tetap berlaku dan tetap
> dirender. Yang masih berdiri hanya paragraf item **E** di bawah, dan itu pun perlu dibuktikan
> sebelum permukaan baru dibangun.

**Lintas project (item E)** menghitung `min(startDate)`/`max(dueDate)` per project — agregat, jadi
plafon 200 per kolom sama sekali bukan bahan yang benar. Ia hampir pasti butuh permukaan sendiri.

> **TERBANTAH oleh ADR-0154 (2026-08-25).** Bukti yang diminta paragraf di atas sudah ada: item E
> membaca `board` yang sama — nol topik, nol langganan, nol fetch baru — dan agregatnya lahir di
> klien (`projectSpan`) dari tanggal yang memang sudah ikut di tiap baris `TaskView`. Plafon
> 200/kolom bukan cuma "bahan yang benar", ia **mengikat**: task yang terpotong plafon membuat
> amplop project lebih pendek dari rentang sebenarnya, jadi kewajiban "plafon yang memotong wajib
> mengaku" berlaku di sini dengan taruhan yang lebih tinggi — spanduknya menyebutkan konsekuensi itu
> secara eksplisit. Yang berubah bukan cuma jawabannya, melainkan arah biayanya.

## Alternatif yang ditolak

**Menaikkan `zSubLimit` untuk topik `tasks`.** Plafon 200 adalah keputusan ADR-0107 yang berlaku
seragam; melonggarkannya untuk satu topik memindahkan biaya yang tak terbatas ke server yang
me-recompute tiap 3 detik, dan tetap tak menjawab pertanyaan "kolom mana yang terpotong".

**Papan sebagai grup global ke-11 di `GROUPS`.** Ditolak ADR-0150 keputusan 9 dan tetap ditolak di
sini: `GROUPS` di-recompute untuk **setiap** klien yang terhubung, termasuk yang tak pernah membuka
layar Tim.

**Menyaring `q` di klien.** Lihat keputusan 5 — ia membuat pencarian buta terhadap kartu di luar
potongan, tanpa cara memberi tahu operator.

**Sentinel "Tanpa project" di penyaring project.** `where.projectId` di server hanya dipasang saat
nilainya truthy, jadi `projectId: null` tak bisa dinyatakan sebagai query tanpa menambah sentinel
ke kontrak. Kartu tanpa project tetap terlihat di "Semua project" dan diberi label `tanpa project`;
barisnya sendiri adalah item **E**, yang memang memerlukannya.

> **Dikoreksi ADR-0154.** Item E mendarat **tanpa** sentinel di kontrak: barisnya lahir dari
> pengelompokan di **klien** (`projectGroups`), berkunci `Symbol` justru supaya tak ada string yang
> bisa bertabrakan dengan `projectId` yang sah — `Project.id` renameable (SPEC-255). Penolakan di
> atas tetap berlaku; yang gugur hanya ramalannya bahwa item E akan memaksa sentinel itu masuk.

**Mode tampilan tanpa mekanisme.** `TEAM_VIEWS` berisi satu entri (`board`) saat ADR ini ditulis —
ADR-0153 menambahkan `timeline`, ADR-0154 menambahkan `projects` — dan tetap dirender sebagai
tablist ber-`usePersistedState` (ADR-0115). Item D dan E memang menambahkan entri ke array yang
**sama** — bukan memasang mekanisme baru pada layar yang sudah dipakai orang. Sejak entri kedua, cermin `TEAM_VIEWS` ↔ cabang render dijaga
test kontrak di `src/test/team-screen.test.tsx`.
