# ADR-0106 — Pembatalan antrean scheduler: status `canceled` sebagai tombstone, dua endpoint CAS

- Status: Accepted
- Tanggal: 2026-08-04
- SPEC: SPEC-522 (brief, prioritas tinggi)
- Terkait: **mengamandemen keputusan #2 [0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md)**
  (yang menuliskan kosakata status antrean hanya `queued|launched|done|failed`), memperluas pola
  tombstone SPEC-431 (`markDone` + `ALREADY_DONE_NOTE`), sejajar gerbang pra-launch
  [0093](0093-dependency-antar-backlog.md); [0015](0015-one-session-per-backlog.md),
  [0016](0016-sesi-terminal-hidup-di-tmux.md), [0065](0065-ai-agent-capability-agent-token.md) utuh.

## Konteks

Panel scheduler (SPEC-299) menampilkan antrean tapi **murni read-only** — tak satu pun tombol
menyentuh sebuah baris. Operator yang melihat item salah mengantre hanya punya dua jalan, keduanya
kasar: **menunggu** sampai governor meluncurkannya lalu menutup sesinya, atau menarik **rem global**
(Pause/Stop) yang menghentikan seluruh antrean demi satu baris.

Menunggu bukan sekadar tak nyaman. Peluncuran membuat git worktree, branch `hanoman/<sessionId>`,
menulis `Spec.baseSha` dan `Spec.startedAt` — stempel *mulai pertama* yang menurut ADR-0090 sengaja
tak pernah ditulis ulang — dan membakar kuota langganan agen. Membiarkan item meluncur hanya supaya
bisa dimatikan adalah kerusakan yang tak perlu.

## Keputusan

1. **`canceled` = nilai kelima `SchedulerQueueItem.status`.** ADR-0072 #2 menyebut kosakatanya
   secara eksplisit; ADR ini mengamandemen kalimat itu. Kolomnya `String` → **tanpa migration**.
   Tabelnya LOCAL-ONLY (tak di `FIELDS` sync), jadi nilai baru ini tak menyeberang antar-instance —
   dan itu benar: antrean adalah state operasional mesin ini.

2. **Tombstone, bukan penghapusan.** Barisnya tetap ada, dan itulah mekanismenya: `enqueue()`
   memakai `upsert` ber-`update:{}`, jadi checker `backlog` yang menjumpai spec yang sama pada
   cadence berikutnya **tak bisa menghidupkannya**. Alternatif `DELETE` ditolak: spec-nya masih
   cocok `UNSTARTED_SPEC_WHERE` (`baseSha=null` ∧ `stage≠done`), jadi ia akan di-enqueue ulang
   dalam ≤1 cadence — pembatalan yang membatalkan dirinya sendiri.

3. **Dua endpoint, keduanya CAS, keduanya di bawah `/scheduler`.**
   `POST /api/scheduler/queue/:id/cancel { reason? }` dan `…/requeue`. Prefix-nya dipilih supaya
   capability-nya turunan peta yang sudah ada (`scheduler` → `settings`, **menurut method**) —
   **tanpa baris peta baru**, dan tanpa pengulangan kelas bug SPEC-405 (prefix status dipetakan ke
   izin baca tanpa melihat method). Transisi ditulis `updateMany({ where: { id, status: <asal> } })`
   dan dinilai dari `count`, **bukan** `findUnique` → `if` → `update`: di antara dua pernyataan itu
   governor bisa meluncurkan barisnya, dan kendala "item yang sudah punya sesi aktif tak boleh
   dibunuh diam-diam" akan jadi sekadar niat baik. Alasan penolakan disusun **sesudah** CAS gagal
   (404 bila barisnya hilang, 409 + `status` saat ini bila transisinya haram).

4. **Reversibel.** `requeue` (`canceled → queued`, `note` dikosongkan) ada karena tombstone-nya
   permanen secara mekanis: tanpa jalan pulang, "Batalkan" diam-diam berarti "jangan pernah
   dijadwalkan lagi, selamanya". Konsekuensinya UI tak perlu dialog konfirmasi.

5. **Dua gerbang di governor.** `queued()` memang sudah menyaring `canceled`, tapi daftar itu
   **snapshot**: `drain()` memprosesnya berurutan dan tiap `launch` men-spawn worktree + sesi tmux
   (hitungan detik), jadi item di ekor daftar bisa duduk puluhan detik di dalam loop sesudah
   snapshotnya diambil. **Gerbang A** = `isQueued(item.id)` dibaca ulang dari DB di **puncak badan
   loop** (pola `isDone` SPEC-431 & `blockers` SPEC-447) — ditaruh paling atas, bukan tepat sebelum
   `launch`, supaya ia melindungi semua mutasi di badan loop: baris `canceled` tak boleh ditimpa
   jadi `done` oleh gerbang SPEC-431 maupun jadi `launched` oleh cabang idempoten `isLive`.
   **Gerbang B** = `markLaunched` jadi CAS; sisa jendelanya adalah durasi satu spawn, dan CAS yang
   gagal mempertahankan `canceled` alih-alih menimpanya senyap.

6. **Sesi yang telanjur lahir TIDAK dibunuh.** Saat gerbang B menyala, sesinya sudah nyata.
   Governor menulis `note` yang menyebut id sesinya (operator bisa menutupnya dari Terminal) dan
   **tetap** `slots--` — cap concurrency tak boleh dilanggar hanya karena barisnya dibatalkan.
   Membunuh sesi dari dalam governor ditolak: kendala spec berlaku untuk sesi hidup mana pun, dan
   itu menambah permukaan yang tak dibutuhkan fitur ini.

## Konsekuensi

- **Positif:** satu baris bisa dicabut tanpa menyentuh rem global; nol migration, nol tabel, nol
  baris peta capability; `reconcile()` tak tersentuh (ia hanya memindai `launched`, jadi tak ada
  `Notification fail` palsu untuk item yang sengaja dibatalkan); jaminan "sesi aktif tak dibunuh"
  ditegakkan **struktur** (CAS), bukan niat.
- **Negatif / batas:** pembatalan tak berlaku surut — item yang sudah `launched` harus ditutup dari
  Terminal, dan panel mengatakannya dengan kalimat, bukan dengan tombol. Tak ada pembatalan massal
  (Pause/Stop sudah menjadi rem global). Sesi yatim akibat gerbang B tak muncul di daftar "sesi
  scheduler" (`state.sessions` diturunkan dari baris `launched`) — ia terbaca sebagai sesi biasa di
  Terminal, dengan `note` di baris `canceled` sebagai penunjuknya.
- **Reversibilitas:** murni aditif. Mencabutnya = menghapus dua route + dua tombol; baris
  `canceled` yang telanjur ada akan diam selamanya (tak pernah di-drain, tak pernah di-reconcile),
  yang persis perilaku yang diinginkan.
