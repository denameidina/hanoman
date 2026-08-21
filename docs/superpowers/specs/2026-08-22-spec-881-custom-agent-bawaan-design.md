# SPEC-881 — Custom agent bawaan sistem: katalog delapan persona dev/QA/audit/security

- Tanggal: 2026-08-22
- ADR yang lahir: **ADR-0136**
- Memperluas: ADR-0094 (katalog custom agent), ADR-0101 (form berbasis katalog + `runtime`)
- Menyentuh: ADR-0113 (registry `METHODS` sebagai pola tabel konstanta), ADR-0119 (tombstone),
  ADR-0045 (kolom baru & changefeed), ADR-0049 (cache yang di-invalidasi tiap mutasi)

## Konteks

Fitur custom agent lengkap sejak SPEC-450/484: katalog di DB, id deterministik `<scope>:<name>`,
anti-loop tiga lapis, materialisasi berbeda per mesin (`--agents` untuk claude, blok roster prosa
untuk codex), form dengan dropdown tool/model/runtime, validasi keras di server. Yang tak pernah
terjadi adalah **pemakaiannya**: katalog kosong di setiap instalasi, dan ADR-0094 sendiri mencatat
"berbiaya nol saat tak dipakai" sebagai konsekuensi — kalimat yang hari ini terbaca sebagai
"tak dipakai".

Sebabnya bukan bug. Custom agent menuntut operator menulis prosa persona dari nol sebelum tahu
apakah ia berguna, di permukaan yang tak memberi satu pun contoh. Biaya masuknya lebih tinggi
daripada nilai yang terlihat.

Spec ini mengisi katalog itu dengan delapan persona yang dikirim hanoman sendiri.

## Prinsip seleksi

Tiga syarat, dan entri yang gagal salah satunya tidak masuk:

1. **Punya prosedur, bukan persona.** "Kamu reviewer, review-lah" tak menambah apa pun di atas
   model utama; yang menambah adalah langkah berurutan dengan gerbang bukti.
2. **Menutup kelas kegagalan yang terukur** — yang salah secara berulang, bukan yang kebetulan.
3. **Membakar konteks di tempat lain lalu mengembalikan putusan kecil.** Itu satu-satunya
   keuntungan struktural subagent claude; agen yang tak menyapu apa pun tak perlu jadi agen.

Yang gugur karena syarat ini: `doc-syncer`, `adr-writer`, `changelog-writer` (fase pipeline &
method skill sudah mengerjakannya) dan `secret-scanner` (itu satu regex, bukan agen — ia menjadi
satu langkah di dalam `security-reviewer`).

## Keputusan yang dikunci

| # | Keputusan | Alasan |
|---|---|---|
| K1 | Sasaran **semua project** yang dikelola hanoman, bukan repo hanoman | hanoman adalah paket npm global; agen bawaan tak boleh menyebut path khas satu repo |
| K2 | Bawaan lahir sebagai **baris `CustomAgent` sungguhan** (seed), bukan konstanta runtime | langsung terlihat & bisa disunting di UI, tanpa lapis override keempat |
| K3 | Kedelapan di-seed; **empat menyala** (`scout`, `qa-verifier`, `security-reviewer`, `blast-radius`) | empat sisanya lahir `enabled:false` — nol byte di argv/prompt sampai operator mengklik |
| K4 | Upgrade **hanya menimpa baris yang belum disunting** | perbaikan instruksi tetap sampai; kerja operator tak pernah hilang |
| K5 | Satu **klausa prompt** yang menyebut agen yang benar-benar ada di roster sesi itu | tanpa dorongan, claude tak punya alasan menoleh ke katalog — persis keadaan hari ini |
| K6 | Semua bawaan **daun**: `mentions: []` | lapis-2 anti-loop bekerja fisik — tanpa `mentions`, `Task` dicabut dari argv, jadi tak satu pun punya alat memanggil siapa pun |

## Katalog

Nilai yang **konstan untuk kedelapan** dan karena itu tak menjadi field entri:
`projectId: null` (global) · `model: null` (warisi sesi) · `mentions: []` · `runtime: null`
(dipakai sesi claude maupun codex).

Bentuk entri karena itu hanya lima field:

```ts
type BuiltinAgentDef = {
  readonly name: string;            // lolos AGENT_NAME_RE
  readonly description: string;     // INI yang dibaca claude untuk memilih subagent
  readonly instructions: string;    // prosedur + gerbang bukti + bentuk keluaran
  readonly tools: readonly string[];// himpunan bagian DEFAULT_AGENT_TOOLS
  readonly enabledByDefault: boolean;
};
```

`model`/`mentions`/`runtime` **sengaja tak ada di bentuk ini**. Menjadikannya field berarti
mengundang entri masa depan yang memasang `mentions`, dan itu membuka kembali lapis-1 anti-loop
yang hari ini nol risiko.

### 1. `scout` — navigator basis kode berkonteks terisolasi · **menyala**

- **Tools:** `Read Glob Grep` — tanpa `Bash`/`Edit`/`Write`: ia tak bisa mengubah apa pun, jadi
  aman dipanggil sesering apa pun.
- **Kebutuhan:** sesi utama membakar setengah konteksnya membaca puluhan berkas hanya untuk tahu
  di mana sesuatu dikerjakan.
- **Prosedur:** menyapu lewat beberapa sudut sekaligus — nama simbol, nama konsep dalam bahasa
  manusia, jejak string yang muncul di UI/log, dan riwayat perubahan — bukan satu grep. Wajib
  mencari juga **cermin** konsep yang sama: tipe yang disalin antar-paket, enum kembar, konstanta
  yang diduplikasi, daftar literal string yang tak punya rujukan tipe.
- **Gerbang bukti:** setiap klaim berpasangan `path:baris`. **Dilarang mengembalikan isi berkas** —
  hanya kesimpulan dan jangkar.
- **Keluaran:** titik masuk · alur data · tempat perubahan harus mendarat · cermin yang ditemukan.

### 2. `root-causer` — diagnosis sampai akar, dilarang menebak · mati

- **Tools:** `Read Glob Grep Bash` — tanpa `Edit`: ia mendiagnosis, yang memperbaiki sesi utama.
- **Kebutuhan:** kelas kegagalan paling mahal di sesi otonom — agen memperbaiki **gejala**, test
  hijau, bug kembali kemudian.
- **Prosedur:** reproduksi dulu sebagai perintah yang bisa dijalankan ulang → daftar hipotesis yang
  **bersaing** → satu eksperimen yang **membedakan** hipotesis, bukan yang mengonfirmasi favorit →
  ulangi sampai akar terbukti.
- **Gerbang bukti:** **dilarang mengusulkan perbaikan sebelum akar terbukti**, dan wajib
  menyertakan eksperimen yang akan **gagal** bila hipotesisnya salah. "Kemungkinan besar karena…"
  ditolak sebagai keluaran.
- **Keluaran:** akar · bukti · perbaikan terkecil yang menyentuh akar · cara memverifikasinya.

### 3. `qa-verifier` — pembunuh hijau palsu · **menyala**

- **Tools:** `Read Glob Grep Bash`.
- **Kebutuhan:** dua kegagalan berbeda yang tampak sama — (a) test lulus tapi tak menyentuh
  perubahan sama sekali, (b) yang merah adalah gagal palsu (isolasi DB, paralelisme, sisa proses
  tetangga, drift env) dan orang menyerah pada regresi sungguhan.
- **Prosedur:** tentukan test yang **tersentuh** (bukan suite penuh) → jalankan → untuk tiap
  kegagalan putuskan **palsu vs regresi** dengan bukti → lalu langkah yang jarang dilakukan
  siapa pun: **uji relevansi test** dengan menyiapkan worktree scratch di base SHA, memasang test
  barunya di sana, dan menuntut test itu **MERAH**. Test yang hijau tanpa perubahan bukan bukti.
- **Gerbang bukti:** setiap klaim membawa perintah **dan** potongan keluarannya. Tanpa keluaran =
  tanpa klaim.
- **Larangan keras:** `git stash` tak boleh dipakai untuk apa pun — tumpukan stash milik repo, dan
  sesi tetangga di worktree lain bisa mem-pop stash milik sesi ini. Isolasi memakai
  `git worktree add --detach`, bukan stash.
- **Keluaran:** putusan per test — lulus-dan-relevan · lulus-tapi-tak-membuktikan-apa-pun ·
  regresi · gagal-palsu (+ sebabnya).

### 4. `edge-case-hunter` — penambal jalur bahagia · mati

- **Tools:** `Read Glob Grep Bash Write Edit`.
- **Kebutuhan:** test ada, hijau, dan hanya menguji satu jalur mulus. Cakupan terlihat baik;
  kontraknya tak pernah diuji.
- **Prosedur:** baca kontrak unit yang berubah → enumerasi batas secara sistematis (kosong ·
  null/undefined · nol & negatif · unicode & string sangat panjang · urutan terbalik · kedatangan
  ganda/idempotensi · kegagalan separuh jalan · timeout & retry · nilai asing dari luar batas
  kepercayaan) → adu dengan test yang ada → **tulis** yang hilang → jalankan.
- **Gerbang bukti:** tiap test baru wajib ditunjukkan **merah dulu** terhadap kode yang belum
  diperbaiki; test yang lahir langsung hijau dilaporkan sebagai "tak membuktikan apa-apa", bukan
  disimpan diam-diam.
- **Keluaran:** batas yang kini tertutup · yang sengaja dilewati · alasannya.

### 5. `blast-radius` — pencari cermin yang hanyut · **menyala**

- **Tools:** `Read Glob Grep Bash`.
- **Kebutuhan:** kelas bug paling senyap di sistem mana pun — satu kontrak hidup di lebih dari
  satu tempat, satu tempat diperbarui, sisanya tidak, **dan tak ada yang error**.
- **Prosedur:** dari diff tarik simbol/kolom/nilai yang berubah → untuk tiap satu sapu seluruh
  repo untuk semua tempat lain yang menyebutnya **atau seharusnya menyebutnya**, termasuk daftar
  literal string dan tabel konstanta yang tak punya rujukan tipe → laporkan yang belum ikut.
- **Gerbang bukti:** tiap temuan menyebut `path:baris` **dan** apa yang terjadi bila dibiarkan.
  Bila konsekuensinya "gagal senyap", prioritasnya **dinaikkan**, bukan diturunkan.
- **Keluaran:** cermin yang hanyut, diurut menurut seberapa senyap kegagalannya.

### 6. `spec-auditor` — pengadu janji dengan bukti · mati

- **Tools:** `Read Glob Grep Bash`.
- **Kebutuhan:** pekerjaan diumumkan selesai, checklist tercentang, dan sebagian yang diminta tak
  pernah dikerjakan — atau dikerjakan berbeda dari yang diminta.
- **Prosedur:** baca spec/plan/issue asalnya → ubah jadi daftar kriteria yang bisa diperiksa satu
  per satu → untuk tiap kriteria cari **jejaknya di diff** → tandai: terpenuhi (+`path:baris`) ·
  tak terpenuhi · terpenuhi berbeda dari yang diminta · **dikerjakan tanpa diminta** (dilaporkan
  terpisah, bukan dipuji).
- **Gerbang bukti:** "sepertinya sudah" ditolak. Kriteria tanpa jangkar di diff = **tak
  terpenuhi**, walau kotaknya sudah tercentang.
- **Keluaran:** tabel kriteria → putusan → jangkar.

### 7. `security-reviewer` — penelusur sumber-ke-sink · **menyala**

- **Tools:** `Read Glob Grep Bash`.
- **Kebutuhan:** review keamanan yang berupa daftar kekhawatiran umum tak mengubah apa pun. Yang
  mengubah adalah satu jalur konkret dari input tak terpercaya sampai ke tempat ia melukai.
- **Prosedur:** enumerasi **titik masuk** yang tersentuh diff (route, handler, job, CLI, konsumer
  webhook/pesan) → untuk tiap satu telusuri input tak terpercaya sampai sink (query SQL,
  `exec`/shell, path berkas, template/render, deserialisasi, permintaan keluar, redirect) →
  periksa gerbang yang seharusnya ada di jalur itu: autentikasi, **otorisasi kepemilikan objek**
  (yang paling sering hilang justru saat authN-nya benar), validasi bentuk di batas, batas ukuran,
  kredensial yang bocor ke log/response/diff.
- **Gerbang bukti:** temuan tanpa jalur konkret **input → dampak** tidak dilaporkan. Ia juga
  menyebut jalur mana yang sudah ditelusuri dan **bersih** — supaya diamnya bisa dipercaya.
- **Keluaran:** per temuan jalur · dampak · perbaikan terkecil; plus daftar titik masuk bersih.

### 8. `dep-auditor` — gerbang rantai pasok · mati

- **Tools:** `Read Glob Grep Bash WebSearch WebFetch` — satu-satunya yang butuh dunia luar.
- **Kebutuhan:** satu dependensi baru masuk lewat satu baris diff dan tak pernah diperiksa lagi.
- **Prosedur:** ambil dependensi yang **bertambah atau naik versi** di diff → untuk tiap satu:
  advisory yang diketahui, tanggal rilis & tanda pemeliharaan, lisensi, ukuran pohon transitif,
  ada tidaknya install script, dan — yang paling sering terlewat — **apakah fungsinya sudah
  tersedia** di dependensi yang ada atau di runtime.
- **Gerbang bukti:** klaim CVE/lisensi wajib membawa URL sumbernya; tanpa sumber ditulis sebagai
  "tak terverifikasi", bukan dihilangkan.
- **Keluaran:** per dependensi — aman · aman dengan catatan · tolak + penggantinya.

## Arsitektur

### Sumber definisi

`shared/src/builtin-agents.ts` — tabel konstanta, cermin registry `METHODS` (ADR-0113): bebas zod,
satu-satunya tempat pengetahuan itu hidup, menambah agen kesembilan = satu entri. Diimpor server
(seed) dan web (chip "bawaan"); **tidak** diimpor runner — runner tetap hanya melihat `AgentDef`
yang sudah jadi.

### Penyemaian

`server/src/services/builtin-agents.ts`, dipanggil dari `installCustomAgents()` **sebelum**
`loadCustomAgents()`. Titik yang sama dengan ADR-0094 keputusan 7: satu pintu, tak ada call site
yang bisa lupa memasangnya.

Untuk tiap entri katalog:

```
fp   = sidik jari isi bawaan (name + description + instructions + tools)
id   = "global:<name>"
row  = customAgent.findUnique(id)

row absen, ada tombstone(customAgent, id)     -> LEWATI  (operator sudah membuangnya)
row absen, tanpa tombstone                   -> CREATE  (enabled = enabledByDefault), catat fp
row ada,   fp(row) == tersimpan[name] != fp  -> UPDATE  isi saja, catat fp baru
row ada,   selebihnya                        -> BIARKAN (disunting operator, atau sudah mutakhir)
```

Baris ketiga adalah satu-satunya jalur perbaruan, dan ia menuntut **dua** hal sekaligus: isi baris
sekarang masih persis sidik jari yang terakhir ditulis seed (= belum disentuh operator) **dan**
sidik jari versi terpasang berbeda dari itu (= memang ada yang baru). Salah satu saja tak cukup:
tanpa syarat pertama upgrade menimpa kerja operator; tanpa syarat kedua setiap boot menulis ulang
baris yang sudah mutakhir dan `updatedAt` bergerak tanpa sebab — yang lalu menyeberang sync sebagai
mutasi palsu ke setiap mesin lain.

- **`enabled` tak pernah ikut UPDATE.** Saklar itu milik operator sejak seed pertama.
- **Bukan `upsert` buta.** Baris yang disunting tak tersentuh selamanya.
- Mutasi menaikkan `version` seperti mutasi lain agar menyeberang changefeed (ADR-0045).
- Seluruhnya di dalam `try/catch`: gagal = katalog apa adanya. Seed **tak pernah** boleh
  menggagalkan boot maupun kelahiran sesi.
- Sesudah seed, `loadCustomAgents()` mengisi cache — urutannya mengikat, terbalik berarti sesi
  pertama sesudah boot lahir tanpa agen bawaan.

### Bookkeeping sidik jari

`Setting.data.builtinAgents: Record<name, fp>` — field baru di `zSetting` ber-`.default({})`.

- **Nol migration**: kolomnya sudah `Json`.
- **Lokal per mesin**: `setting` **tidak ada** di `FIELDS` sync (`server/src/services/sync.ts`),
  jadi dua mesin dengan versi hanoman berbeda tak bisa saling menimpa definisi bolak-balik.
- **Wajib dideklarasikan di `zSetting`, bukan diselipkan sebagai kunci asing.** `getSetting()`
  mem-`parse` dan zod **membuang kunci tak dikenal**, jadi kunci asing lenyap diam-diam di
  `PUT /settings` pertama — gagal senyap, bukan error.

### Permukaan UI

Baris bawaan adalah baris biasa: bisa disunting, dimatikan, dihapus. Statusnya **diturunkan, bukan
disimpan**: `CustomAgentView` mendapat dua field turunan — `builtin` (namanya dikenal
`BUILTIN_AGENTS`) dan `builtinEdited` (sidik jari isi baris tak lagi cocok dengan yang tersimpan
seed). Keduanya dihitung di lapis response, persis pola `inherited` yang sudah ada di view itu.

Karena itu **nol kolom baru di skema**, nol lalu lintas sync tambahan, dan tak ada kolom yang bisa
ditolak hub versi lama (kelas SPEC-880). UI menampilkan chip "bawaan" atau "bawaan · disunting".

### Klausa prompt

Satu paragraf di perakit prompt yang menyebut agen yang **benar-benar ada di roster sesi itu** —
bukan daftar statis. Operator yang mematikan `qa-verifier` tak boleh menerima prompt yang menyuruh
memanggilnya. Roster kosong → **nol byte**, jadi invarian "argv byte-identik saat katalog kosong"
tetap utuh. Untuk codex klausa ini berdiri di atas blok roster yang sudah ada, tidak menggandakannya.

## Test

- **Kontrak katalog** (`shared`): tiap `name` lolos `AGENT_NAME_RE` · tiap tool anggota
  `DEFAULT_AGENT_TOOLS` · `mentions` kosong di semua entri · `detectCycle` mengembalikan null ·
  tepat empat entri ber-`enabledByDefault`.
- **Seed idempoten**: dua boot berturut → `updatedAt` tak bergerak di boot kedua.
- **Tombstone dihormati**: hapus satu bawaan → boot ulang → baris tetap tak ada.
- **Baris disunting tak tersentuh**: sunting `instructions` → naikkan versi katalog → boot ulang →
  suntingan bertahan.
- **`enabled` operator menang**: matikan bawaan yang menyala → naikkan versi katalog → boot ulang →
  tetap mati.
- **Klausa prompt**: roster kosong → prompt byte-identik; roster berisi → klausa hanya menyebut
  nama yang ada di roster.

## Konsekuensi

- Instalasi baru langsung punya delapan persona, empat di antaranya aktif — fitur SPEC-450 berhenti
  menjadi permukaan kosong.
- Empat yang menyala membayar byte di setiap kelahiran sesi (argv claude; prompt codex). Empat yang
  mati tak membayar apa pun sampai diklik.
- Baris bawaan **menyeberang sync** ke hub seperti baris custom agent lain. Dua mesin dengan versi
  hanoman berbeda berebut lewat LWW dan yang menulis terakhir menang. Diterima — bukan dihilangkan —
  karena id deterministik `global:<name>` membuat keduanya **satu baris**, bukan dua yang saling
  menelan (ADR-0094 keputusan 2).
- Operator yang tak menginginkan satu pun cukup menghapusnya; tombstone menjaga penghapusan itu
  bertahan lintas boot dan lintas upgrade.

## Gotcha yang wajib diingat

1. **Urutan `seedBuiltinAgents()` → `loadCustomAgents()` mengikat.** Terbalik = sesi pertama
   sesudah boot lahir tanpa agen bawaan, dan gejalanya hilang sendiri di boot berikutnya — bug
   yang tak bisa direproduksi kalau urutannya tak diuji.
2. **Kunci bookkeeping wajib ada di `zSetting`.** Zod membuang kunci tak dikenal; menyelipkannya
   sebagai kunci asing membuat seluruh bookkeeping lenyap di `PUT /settings` pertama, dan seed
   lalu menganggap **semua** baris belum pernah disunting.
3. **`enabled` bukan bagian sidik jari.** Memasukkannya membuat operator yang mematikan satu agen
   terbaca sebagai "menyunting", sehingga perbaikan instruksi tak pernah sampai ke baris itu.
4. **`name` immutable** (ADR-0094 keputusan 2). Mengganti nama bawaan di versi berikutnya berarti
   meninggalkan baris yatim di setiap mesin. Nama dikunci sekarang, di spec ini.
5. **Tak satu pun bawaan boleh memakai nama tool MCP.** Nama server MCP berbeda per mesin;
   validasi keras ADR-0101 akan menolaknya, dan claude membuang nama tool tak dikenal **senyap**
   (ADR-0094 M4) — agen tanpa alat, exit 0, tanpa keluhan.
6. **`instructions` bawaan wajib di bawah 20.000 karakter** (`zCreateCustomAgent`). Seed menulis
   langsung lewat Prisma dan **melewati** validasi route, jadi batas itu hanya ditegakkan test
   kontrak — kalau tak diuji, ia tak ditegakkan sama sekali.

## Yang TIDAK dikerjakan

- Tak ada lapis override keempat (builtin < global < project): bawaan **adalah** baris global.
- Tak ada kolom `builtin` di skema — chip diturunkan dari nama.
- Tak ada preset per-project maupun galeri template.
- Tak ada bawaan yang memakai `mentions`, `model`, atau `runtime` non-null.
- Tak ada pengikatan ke fase pipeline; pemanggilan tetap keputusan sesi, didorong klausa prompt.
