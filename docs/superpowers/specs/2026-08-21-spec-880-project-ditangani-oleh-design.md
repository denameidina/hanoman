# SPEC-880 — Penanda "ditangani oleh" pada Project (mapping project → hanoman client)

Tanggal: 2026-08-21 · Status: design disetujui, siap plan · Sumber: brief backlog SPEC-880

## Masalah

Satu instalasi hanoman kini dipakai dari beberapa mesin — hub VPS `hanoman.nafanesia.id` plus
instance lokal (`hm-dena`, dst) yang saling sync lewat device token (SPEC-213/ADR-0044/0045).
Yang tak ada di mana pun: keterangan **project ini dipegang mesin yang mana**.

`ProjectsScreen` dan `ProjectDetailScreen` hanya menampilkan `repoDir`/`binding`, dan keduanya
justru **LOCAL-only** — `Project.repoDir` sengaja di luar `FIELDS.project`, `LocalBinding` bahkan
tak punya entitas sync sama sekali. Akibatnya di hub setiap project tampak sama tak bertuan.
`SessionResult.deviceId` memang ada dan ikut menyeberang, tapi itu **jejak eksekusi per-sesi**,
bukan pernyataan kepemilikan: project yang belum pernah dikerjakan tak punya jejak sama sekali,
dan satu sesi kebetulan dari laptop lain tidak berarti mesin itu yang memegang project.

Kebutuhannya murni **informasional**. Tidak ada routing, tidak ada gerbang.

## Keputusan

### K1 — Kolom `Project.handledBy` (Json?), MASUK `FIELDS.project`

`handledBy Json?` nullable tanpa default → **nol backfill**, project lama tetap `NULL` = "belum
ditetapkan", dan itu jawaban yang jujur (preseden `Spec.manualDone` SPEC-804/ADR-0120 dan
`Project.autoMerge` SPEC-486/ADR-0103).

Kolom ini **masuk** `FIELDS.project`, sejajar `gitRemote`. Ia sengaja **bukan** cermin
`repoDir`/`schedulerOptIn`/`leadOptIn`/`autoMerge` yang LOCAL-only: nilai-nilai itu adalah properti
checkout/mesin, sedangkan "siapa memegang project ini" adalah **pengetahuan bersama** — justru
menyeberangnya nilai itu yang jadi inti permintaan. Ia juga masuk `__JSON_FIELDS`
(`project:handledBy`) dan **bukan** `DATE_FIELDS`.

Satu `Json` — bukan tabel join `ProjectHandler` — karena nilainya dibaca utuh, tak pernah
di-`orderBy`, dan tabel join yang tak ikut `SYNCED` justru melahirkan kelas gagal yang sama yang
spec ini hendak tutup. Preseden: `Spec.dependsOn` (ADR-0093), `Setting.conflict` (ADR-0081).

### K2 — Isi entri = snapshot device `{ deviceId, name }`, bukan sekadar FK

`DeviceToken` **tidak ikut** `SYNCED` (ia server-local di hub — `sync-exclusions.test.ts`
menegakkannya). Client penerima karena itu **tak punya baris device untuk di-join**. Tanpa `name`
yang ikut tersimpan, chip di client tampil kosong **tanpa satu pun error** — persis kelas
gagal-senyap ADR-0090/0093/0105 (`upsert` yang tak menyebut sebuah kolom tetap berhasil).

Bentuk tersimpan **hanya** `{ deviceId, name }`. `revoked` **tidak** disimpan: ia turunan dari
baris `DeviceToken` lokal dan berbeda per instance — menyimpannya berarti membekukan fakta hub ke
dalam record yang menyeberang.

### K3 — View memperkaya, penyimpanan tetap mentah

`ProjectView.handledBy: { deviceId, name, revoked }[]`, default `[]` (kolom `NULL` → `[]`, jadi UI
tak pernah mengurus dua bentuk "kosong").

Pengayaan di `toProjectView`, dari indeks `DeviceToken` instance ini:

| keadaan baris device lokal | `name` yang dipakai   | `revoked` |
|----------------------------|-----------------------|-----------|
| ada, `revokedAt` null      | nama **hidup** (rename device ikut terlihat) | `false` |
| ada, `revokedAt` terisi    | nama hidup            | `true`    |
| tak ada (client / terhapus)| **snapshot tersimpan**| `false`   |

`toProjectView(p, sessions, devices?)` — parameter ketiga OPSIONAL (cermin `sessions`, SPEC-197):
`GET /projects` memuat indeksnya **sekali** per request (bukan N+1); pemanggil satuan boleh
mengabaikannya dan biarkan service memuatnya sendiri (satu query murah).

### K4 — Pemilihan lewat `MultiSelect` design system + `GET /device-tokens` yang sudah ada

Tak ada endpoint baru untuk daftar device: `GET /device-tokens` (cookie-authed) sudah
mengembalikan `{ id, name, createdAt, lastSeenAt, revokedAt }`.

Editor hidup di **`EditProjectModal`** — form project yang sudah memegang `gitRemote` (disync) dan
`dir` (lokal), jadi pembedaan "disync vs mesin ini" sudah punya rumah di sana.

`MultiSelect` DS (`invalidValues` merender nilai di luar katalog sebagai chip bertanda, bukan
membuangnya senyap) menangani device yang **dicabut atau tak dikenal** tanpa komponen baru.

**Mode baca-saja:** daftar device kosong (`[]`) = instance ini bukan pemegang katalog device
(client, atau hub yang belum pernah menerbitkan token) → editor merender chip nama tersimpan
**tanpa** kontrol, dan `updateProject` **menghilangkan `handledBy` dari body PATCH sepenuhnya**.
Ini bukan kosmetik: mengirim `[]` dari instance read-only akan **menghapus** nilai yang di-set di
hub, dan penghapusannya menyeberang.

### K5 — Daftar project: kolom `Ditangani` + filter `?handledBy=<deviceId>`

`ProjectsScreen` mendapat kolom keenam. Project tanpa penanda menampilkan **"belum ditetapkan"**
bertone netral — bukan sel kosong yang ambigu. Chip mengikuti design system (bone paper, brass
accent) dan **tak pernah memecah baris kepala di layar sempit** (pelajaran SPEC-879): kolomnya
ber-`min-width: 0` dengan ellipsis, dan aturan mobile `.hn-project-row` yang sudah ada menumpuknya
jadi satu kolom ber-`data-label`.

`GET /projects?handledBy=<deviceId>` menyaring **di memori** bersama `q` yang sudah ada (view
sudah dihitung penuh; menyaringnya di SQL berarti mem-parse `Json` di SQLite tanpa manfaat).
Kontrolnya `<Select>` di atas tabel, disembunyikan bila instance ini tak punya daftar device.

### K6 — Detail project: penanda di panel info, dibedakan tegas dari binding lokal

Sel `Ditangani oleh` masuk grid meta header, bersebelahan dengan `Repo · mesin ini`. Pembedaannya
dinyatakan, bukan disiratkan: penanda diberi keterangan **"disync ke semua mesin"**, sementara sel
repo tetap memakai label `Repo · mesin ini` yang sudah ada. Device dicabut tampil bertanda
**"dicabut"** — jejak historis **tidak** dihapus saat revoke (revoke hanya menyetel `revokedAt`;
tak ada kode yang menyentuh `handledBy`).

### K7 — Kompatibilitas versi: rilis hub-dulu + `/sync/push` per-record yang tak lagi meruntuhkan batch

`validateSyncData` **melempar** untuk field tak dikenal, dan `applyPush` memanggilnya sebelum
apa pun. Di route `/sync/push` lemparan itu keluar dari loop → **500 untuk seluruh batch**.

Bahaya nyatanya lebih luas dari "project yang diedit": `snapshot()` menyusun `data` dari
**seluruh** `FIELDS`, jadi client baru mengirim `handledBy: null` di **setiap** push project.
Terhadap hub versi lama, **setiap** push project 500 sampai hub di-upgrade.

Dua langkah, dan keduanya jujur soal batasnya:

1. **Urutan rilis: hub dulu.** Tak ada kode di sisi client yang bisa membuat hub lama menerima
   field yang tak dikenalnya. Ini dicatat di ADR & runbook, bukan disembunyikan.
2. **`/sync/push` menangkap kegagalan per-record** → `{ id, ok: false, error }` alih-alih 500 untuk
   batch (bentuk yang **sudah ada** di route itu untuk `"unknown entity"`). Ini tak menolong rilis
   ini — hub lama tak punya perbaikannya — tapi ia menutup kelasnya untuk setiap penambahan field
   berikutnya, dan mengubah kegagalan senyap jadi hasil yang terbaca.

Kegagalan sisi client sendiri **sudah** non-destruktif dan sembuh sendiri: item outbox bertahan,
tak ada tulisan yang korup, dan ia lolos begitu hub naik versi. Yang ditambahkan hanya satu
`console.warn` saat push memulangkan hasil kosong — supaya kemacetan itu bisa didiagnosis, bukan
ditebak.

## Bentuk data

```ts
// shared/src/entities.ts
export const zHandledByEntry = z.object({ deviceId: z.string().min(1), name: z.string().min(1) });
export const zHandledBy = z.array(zHandledByEntry)
  .superRefine((list, ctx) => { /* tolak deviceId duplikat */ });

// view (turunan, tak pernah disimpan)
export const zHandledByView = zHandledByEntry.extend({ revoked: z.boolean().default(false) });
```

```prisma
model Project {
  // SPEC-880 · ADR-0135 · daftar hanoman client yang memegang project ini. MASUK FIELDS sync.
  handledBy Json?
}
```

Migration ditulis tangan, aditif murni, tanpa backfill (`migrate dev` me-reset DB saat ada drift
worktree tetangga — preseden `20260815130000_spec_manual_done`).

## API

```
GET   /projects?q=&handledBy=&page=&limit=   # handledBy menyaring project yang memuat deviceId itu
GET   /projects/:id                          # view memuat handledBy: {deviceId,name,revoked}[]
POST  /projects   { …, handledBy? }
PATCH /projects/:id { …, handledBy? }        # array | null; [] dan null sama-sama "belum ditetapkan"
```

Validasi `handledBy` di PATCH/POST:

- bukan array → 400
- `deviceId` duplikat → 400
- `deviceId` tak dikenal **bila instance ini punya ≥1 baris `DeviceToken`** → 400.
  Nol baris = instance tak berhak menghakimi (client) → diterima apa adanya.
  Device **dicabut tetap sah** — kalau tidak, satu PATCH nama project akan menolak nilai
  `handledBy` yang sudah tersimpan.
- `null` atau `[]` → kolom dikosongkan (`Prisma.DbNull`, cermin `autoMerge`)

## Test

| berkas | isi |
|---|---|
| `server/test/project-handled-by-contract.test.ts` | kolom Json opsional di dmmf; ada di `__FIELDS.project` + `__JSON_FIELDS`; **tidak** di `__DATE_FIELDS`; ada di `WEBHOOK_ENTITIES` project; `zHandledBy` menolak duplikat |
| `server/test/project-handled-by.route.test.ts` | PATCH sah/duplikat/deviceId asing/`null`; toleran saat nol device; GET list & detail memulangkan `revoked`; filter `?handledBy=`; revoke device **tidak** menghapus penanda |
| `server/test/project-handled-by-sync.test.ts` | round-trip push client → hub → pull ke client kedua, `name` utuh di client yang **tak punya** baris device |
| `server/test/sync-push-partial-failure.test.ts` | satu record bermasalah → `{ok:false,error}` untuk record itu, record lain di batch tetap diterima |
| `src/test/project-handled-by.test.tsx` | chip di baris daftar + "belum ditetapkan" netral; sel detail; editor read-only saat daftar device kosong |

## Docs yang tersentuh (commit yang sama)

- `internal/docs/adr/0135-penanda-project-ditangani-hanoman-client.md` (baru) + link di
  `internal/docs/adr/README.md` dan `internal/docs/README.md`
- `internal/docs/architecture/data-model.md` — kolom `handledBy` di seksi Project
- `internal/docs/architecture/api-contract.md` — `handledBy` di GET/POST/PATCH projects + filter,
  dan catatan hasil per-record `/sync/push`

## Yang TIDAK dikerjakan (YAGNI / di luar scope)

- Tidak ada gerbang eksekusi: penanda ini **tak** menggerbangi start sesi, worktree, auto-merge,
  scheduler, maupun lead.
- Tidak ada `?handledBy=none` (filter "belum ditetapkan") — tak diminta.
- Tidak ada auto-isi dari `SessionResult.deviceId`. Penanda ini di-set manusia; menebaknya dari
  jejak eksekusi persis kesalahan yang disebut brief.
- `DeviceToken` **tidak** dijadikan entitas sync. Itu perubahan trust boundary, bukan fitur ini.
- Tidak menyentuh `repoDir`, `LocalBinding`, `schedulerOptIn`, `leadOptIn`, `autoMerge`.
