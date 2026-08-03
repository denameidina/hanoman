# SPEC-522 — Batalkan antrian di scheduler

- Tanggal: 2026-08-04
- Source: brief · prioritas tinggi
- Terkait: [ADR-0072](../../../internal/docs/adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md)
  (fondasi scheduler), SPEC-431 (gerbang "spec sudah selesai" di governor), SPEC-447/ADR-0093
  (gerbang dependency), SPEC-299 (panel scheduler)

## Masalah

Panel scheduler menampilkan antrean (`GET /api/scheduler/state.queue`, `status:"queued"`) tetapi
**murni read-only** — tak ada satu pun tombol yang menyentuh sebuah baris antrean. Operator yang
melihat item salah/tak relevan mengantre hanya punya dua jalan, keduanya kasar:

1. **Menunggu** sampai governor meluncurkannya jadi sesi tmux sungguhan, lalu menutup sesinya.
2. **Rem darurat global** — Pause (`{paused:true}`) atau Stop (`{enabled:false}`) — yang
   menghentikan **seluruh** antrean demi membatalkan satu baris.

Tak ada jalan ketiga. Dan pilihan (1) bukan sekadar tak nyaman: peluncuran menciptakan git worktree,
branch `hanoman/<sessionId>`, menulis `Spec.baseSha`/`startedAt` (stempel *mulai pertama*, ADR-0090 —
tak bisa dikembalikan), dan membakar kuota langganan agen. Membiarkan sebuah item meluncur hanya
supaya bisa dimatikan adalah kerusakan yang tak perlu.

## Objective

Operator bisa membatalkan item antrean scheduler dari panel scheduler; item yang dibatalkan berhenti
dijadwalkan dan statusnya terlihat jelas.

## Kendala (dari brief)

- Pembatalan **hanya untuk item yang belum berjalan**.
- Item yang sudah punya sesi aktif **tidak boleh dibunuh diam-diam**.
- Sertakan endpoint + test.

## Keputusan

### 1. `canceled` — nilai kelima `SchedulerQueueItem.status`

ADR-0072 keputusan #2 menuliskan kosakatanya secara eksplisit: *"`status` antrean hanya
`queued|launched|done|failed` (operasional)"*. Spec ini **menambah satu nilai kelima**, `canceled`,
dan karena itu mengamandemen kalimat tersebut → butuh ADR baru.

Kolomnya `String` di Prisma, jadi **tanpa migration** (cermin blok `Json` di `Setting`). Tabelnya
LOCAL-ONLY dan tak masuk `FIELDS` sync — nilai baru ini tak menyeberang ke instance lain, dan itu
benar: antrean adalah state operasional mesin ini.

**`canceled` adalah tombstone, bukan penghapusan.** Barisnya tetap ada, dan itulah mekanismenya:
`enqueue()` memakai `upsert` ber-`update: {}`, jadi checker `backlog` yang menjumpai spec yang sama
lagi pada cadence berikutnya **tidak bisa menghidupkannya kembali**. Mekanisme yang sama sudah
dipakai SPEC-431 untuk menutup baris basi (`markDone` + `ALREADY_DONE_NOTE`).

**Anti-opsi yang ditolak: `DELETE` baris.** Spec-nya masih cocok dengan `UNSTARTED_SPEC_WHERE`
(`baseSha=null` ∧ `stage≠done`), jadi checker `backlog` akan meng-enqueue ulang pada cadence
berikutnya (default 30 menit, bisa disetel lebih pendek) — pembatalan yang membatalkan dirinya
sendiri, persis melanggar "berhenti dijadwalkan".

### 2. Dua endpoint, keduanya **CAS**, keduanya di bawah prefix `/scheduler`

```
POST /api/scheduler/queue/:id/cancel   { reason? }  -> SchedulerQueueItem
POST /api/scheduler/queue/:id/requeue               -> SchedulerQueueItem
```

Prefix `/scheduler` dipilih supaya capability-nya turunan peta yang sudah ada
(`agent-capabilities.ts`: `top === "scheduler"` → `rw("settings")`, jadi POST → `settings:write`).
**Tak ada baris baru di peta capability**, dan tak ada pengulangan kelas bug SPEC-405 (prefix status
dipetakan ke izin baca tanpa melihat method) — `rw()` sudah menurunkannya dari method.

Kontrak status:

| kondisi | kode | badan |
|---|---|---|
| baris tak ada | 404 | `{ error: "item antrean tak ada" }` |
| `cancel` atas baris `queued` | 200 | baris terbaru (`status:"canceled"`, `note` terisi) |
| `cancel` atas baris `launched` | 409 | `{ error: "sesi sudah berjalan — tutup dari Terminal", status: "launched" }` |
| `cancel` atas `done`/`failed`/`canceled` | 409 | `{ error: "item sudah <status>", status }` |
| `requeue` atas baris `canceled` | 200 | baris terbaru (`status:"queued"`, `note: null`) |
| `requeue` atas status lain | 409 | `{ error: …, status }` |

**Gerbangnya adalah CAS, bukan `if` di atas hasil `findUnique`.** Keduanya diimplementasikan sebagai
`updateMany({ where: { id, status: <status asal> }, data: … })` dan menilai `count`. Itulah yang
membuat janji "item yang sudah punya sesi aktif tidak boleh dibunuh" **tak bisa dilanggar oleh
balapan**: antara membaca baris dan menulisnya, governor bisa meluncurkannya. Baca-lalu-tulis akan
menjadikan jaminan itu sekadar niat baik.

`reason` opsional (`z.string().trim().max(200)`): note jadi `"dibatalkan operator"` atau
`"dibatalkan operator: <reason>"`. Panel tak mengirimkannya (tak ada kolom input); ia melayani
pemanggil API/agen yang punya alasan untuk dicatat.

### 3. Dua gerbang di governor supaya pembatalan tidak kalah balapan

Governor sudah otomatis mengabaikan baris `canceled`: `queued()` menyaring `status:"queued"`.
Itu **tidak cukup**, karena `drain()` mengambil snapshot `queued()` **sekali** lalu memproses
item-itemnya berurutan, dan tiap `deps.launch()` men-spawn worktree + sesi tmux sungguhan (hitungan
detik). Item di posisi ke-5 karena itu bisa duduk **puluhan detik** di dalam loop sesudah
snapshot-nya diambil. Jendelanya nyata, bukan teoretis.

**Gerbang A — periksa ulang dari DB di puncak badan loop.** `if (!(await isQueued(item.id))) continue;`
mengikuti pola `isDone` (SPEC-431) & `blockers` (SPEC-447): **dibaca ulang dari DB, bukan dari baris
antrean di snapshot**. Ia ditaruh **paling atas**, bukan tepat sebelum `deps.launch()`, supaya ia
melindungi **semua** mutasi di badan loop: tanpa itu gerbang "spec sudah selesai" (SPEC-431) bisa
menimpa baris `canceled` jadi `done`, dan cabang idempoten `isLive` bisa menimpanya jadi `launched`.
Slot tak terpakai, drain lanjut ke item berikutnya.

**Gerbang B — `markLaunched` jadi CAS.** Sisa jendelanya adalah durasi satu spawn: operator menekan
Batalkan selagi `deps.launch()` untuk item itu sedang berjalan. CAS-nya membuat `markLaunched`
mengembalikan `false` alih-alih **menimpa** `canceled` jadi `launched` secara senyap — persis
kelas kontradiksi yang dilaporkan berulang di hanoman (operator melakukan tindakan eksplisit, UI
membenarkannya, lalu keadaan diam-diam berbalik).

Saat CAS gagal, sesi **sudah lahir**. Governor:
- **tidak membunuhnya** — kendala brief berlaku untuk sesi mana pun yang hidup, dan membunuh sesi
  dari dalam governor menambahkan permukaan yang tak dibutuhkan feature ini;
- menulis `note` di baris `canceled` itu yang menyebut id sesinya, sehingga operator tahu ada sesi
  yatim yang bisa ditutup dari Terminal — kebalikan dari "diam-diam";
- **tetap `slots--`**: sesinya nyata dan memakan slot, jadi cap concurrency tak boleh dilanggar
  hanya karena barisnya dibatalkan.

`reconcile()` hanya memindai `listQueue("launched")`, jadi baris `canceled` tak pernah tersentuh
rekonsiliasi — tak ada `Notification fail` palsu untuk item yang sengaja dibatalkan.

### 4. Panel: satu tombol per baris antrean + seksi "Dibatalkan"

- `QueueRow` mendapat tombol **Batalkan** (ghost, ikon `ban` — ikon yang sama dengan "Cabut opt-in"
  di layar ini). **Tanpa dialog konfirmasi**: tindakannya reversibel lewat Antre lagi, dan
  konfirmasi untuk tindakan reversibel adalah gesekan tanpa hasil.
- Seksi baru **"Dibatalkan"** (`status:"canceled"`) di antara "Antrean" dan "Selesai", tiap baris
  menampilkan `note` dan tombol **Antre lagi** (ikon `rotate-ccw`).
- Kegagalan 409 dilaporkan apa adanya lewat toast dari `ApiError.detail.error` — kalau sesinya
  sudah berjalan, operator membaca kalimat yang menyuruhnya ke Terminal, bukan "gagal".
- Poll 5 detik yang sudah ada memuat ulang state sesudah tiap aksi (`load(true)`).

## Komponen & berkas

| berkas | perubahan |
|---|---|
| `server/prisma/schema.prisma` | komentar kosakata `status` (+`canceled`) — **tanpa migration** |
| `server/src/services/scheduler/queue.ts` | `markCanceled`/`markRequeued`/`isQueued`; `markLaunched` → CAS; `noteQueued` → `noteRow` (menulis note baris apa pun, tetap dedup) |
| `server/src/services/scheduler/governor.ts` | gerbang A (`isQueued` pra-spawn) + gerbang B (CAS `markLaunched` + note sesi yatim) |
| `server/src/routes/scheduler.ts` | dua route POST |
| `shared/src/api.ts` | `schedulerQueueCancel(id)` · `schedulerQueueRequeue(id)` |
| `src/src/api/client.ts` | `cancelSchedulerQueueItem` · `requeueSchedulerQueueItem` |
| `src/src/screens/SchedulerScreen.tsx` | tombol Batalkan · seksi Dibatalkan · Antre lagi |

## Test

**Server**
- `scheduler-queue.service.test.ts` — `markCanceled` sukses dari `queued`, **tolak** dari `launched`
  & `done`; `markRequeued` sukses dari `canceled`, tolak dari lain; `queued()` tak memuat baris
  `canceled`; **`enqueue()` tak menghidupkan baris `canceled`** (jaminan "berhenti dijadwalkan");
  `markLaunched` mengembalikan `false` atas baris non-`queued`.
- `scheduler.route.test.ts` — cancel 200 & bentuk barisnya; cancel `launched` → 409 + `status`;
  cancel id tak dikenal → 404; requeue 200 balik ke `queued` dengan `note` kosong; requeue atas
  `queued` → 409; `reason` masuk ke `note`.
- `scheduler-governor.test.ts` — baris `canceled` tak pernah diluncurkan & tak memakan slot;
  **gerbang A**: baris dibatalkan sesudah snapshot `queued()` (disimulasikan dari dalam `launch`
  item sebelumnya) tak pernah di-spawn; **gerbang B**: dibatalkan *selama* `launch` → baris tetap
  `canceled`, `note` menyebut id sesinya, dan slot tetap terpakai.

**Web**
- `scheduler-screen.test.tsx` — tombol Batalkan memanggil `cancelSchedulerQueueItem(id)`; seksi
  Dibatalkan merender note; Antre lagi memanggil `requeueSchedulerQueueItem(id)`; 409 memunculkan
  pesan server.

## Docs yang tersentuh (commit yang sama)

- `internal/docs/adr/0106-batalkan-antrean-scheduler.md` — **baru** (amandemen kosakata ADR-0072 #2)
- `internal/docs/README.md` + `internal/docs/adr/README.md` — tautan ADR baru (keduanya, SPEC-386)
- `internal/docs/architecture/api-contract.md` — dua endpoint + kontrak status di bagian Scheduler
- `internal/docs/architecture/data-model.md` — kosakata `status`, semantik tombstone, dua gerbang

## Non-goal

- **Tidak** membunuh/menutup sesi yang sudah berjalan (kendala brief). Menutup sesi tetap milik
  Terminal.
- **Tidak** ada pembatalan massal ("batalkan semua") — Pause/Stop sudah menjadi rem global.
- **Tidak** ada penghapusan baris antrean; tombstone justru mekanismenya.
- **Tidak** menyentuh `liveCount()`/cap, `reconcile`, checker source, atau denyut lead.
