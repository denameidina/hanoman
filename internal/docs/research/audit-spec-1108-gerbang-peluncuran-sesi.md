# Audit SPEC-1108 — Gerbang peluncuran sesi

Tanggal: 2026-09-05. Basis: `a0ac6da8515106613782bd81d8e85edd69ad02ad`.
Keputusan mengikat: [ADR-0161](../adr/0161-gerbang-peluncuran-sesi-cap-dan-sumber-daya.md).

## Bukti dan akar masalah

- `server/src/services/scheduler/governor.ts` menghitung slot hanya di `drain()`.
  `engine.ts` baru memanggil drain bila scheduler enabled dan tidak paused.
- `server/src/services/session-launch.ts` langsung bergerak dari re-attach, approval,
  binding, dan dependency ke kill/worktree/spawn. Tidak ada pembacaan cap atau load.
  `routes/terminal.ts` (manual) dan `lead/apply.ts` memakai launcher yang sama,
  sehingga kedua pemanggil itu tidak memperoleh perlindungan governor.
- Pembacaan sesi hidup untuk batching governor masih sinkron. API asinkron sudah ada
  di `pty.ts`: `listSessionsAsync()` dan `getSessionAsync()`; pane `exited` harus dibuang.
- Menambah pembacaan asinkron tanpa melindungi rentang check→spawn membuka balapan:
  dua request dapat melihat slot terakhir yang sama sebelum salah satunya membuat pane.
- Audit juga menemukan asumsi cakupan ADR tidak lengkap: cron (`scheduler/cron-session.ts`)
  dan workflow project reverse/scaffold/PRD/breakdown (`routes/terminal.ts`) tidak memakai
  `startSpecSession()`. Terminal biasa dan shell memang dikecualikan ADR-0161 §2.
- Tidak ada pengukur load host di jalur peluncuran. Angka panic/load/memori pada brief
  adalah bukti historis operator yang sudah direkam ADR-0161; audit ini tidak mencoba
  mereproduksi host overload atau kernel panic.

Confidence akar masalah: tinggi, terbukti lewat aliran panggilan dan absennya gerbang.

Reproduksi executable: `server/test/session-launch-admission.test.ts` menjalankan
launcher nyata dengan batas OS/DB diganti test double. Dengan scheduler mati, cap 1,
dan satu pane hidup, peluncuran baru tetap menghasilkan `{id: "spec-1108"}`.
Hasil baseline: **1 gagal (cap diabaikan), 1 lulus (re-attach tetap boleh)**; exit 1.
Tidak ada tmux/claude nyata yang diluncurkan. Kasus merah ini menjadi regression test
untuk Execute.

## Keputusan pasca-Audit

Jalankan **Spec → Plan → Execute** penuh: perubahan melibatkan perilaku konkurensi,
kontrak penolakan HTTP 409, konfigurasi persisten, dan tampilan operator. Ini bukan
perbaikan kecil yang cukup ditutup dengan audit sebagai satu-satunya doc-of-record.

Usulan default load-per-core **2,5**: sekitar 51% di atas titik sehat 1,66 dan 33%
di bawah titik 3,75 menuju panic. Nilai ini awal yang dapat disetel, belum terkalibrasi
lintas host. Tidak menggunakan `os.freemem()`. Windows diberi status tidak tersedia,
bukan load nol yang menyesatkan.

Operator menyetujui cakupan seluruh agen terstruktur dan default 2,5. Keputusan
dicatat dalam spec dan amandemen ADR-0161, tanpa menerbitkan ADR baru.

Penyapuan lanjutan menemukan launcher agen konflik di `routes/specs.ts`, `routes/ide.ts`,
dan `routes/terminal.ts`, hardening VPS di `routes/vps.ts`, serta gateway Telegram di
`services/telegram/session.ts`. Menegakkan batas pada *seluruh* agen terstruktur
memerlukan klasifikasi eksplisit bersama: `SessionInfo.agent` tidak cukup, sebab shell
juga membawa default `agent`. `sessionKind()` saat ini hanya dipakai saat pencatatan
history; jenis tersebut belum disimpan sebagai metadata pane tmux. Perubahan luas
harus mempertahankan konsol VPS, terminal biasa, dan shell sebagai akses operator.

## Strategi verifikasi

Unit test gerbang dengan dependency injection (tanpa tmux/claude), termasuk dua
peluncuran bersamaan, pane mati, re-attach, force, dan kegagalan baca tmux. Test HTTP
memeriksa angka 409 dan tidak adanya efek samping. Test konfigurasi dan tampilan
mencakup default aktif serta status Windows. Semua test server serial dengan DB dan
socket tmux khusus sesi; hanya test terkait dan typecheck paket tersentuh. Smoke
server lokal terisolasi + curl sekali di akhir.

## Hasil Execute dan bukti verifikasi

Implementasi menutup seluruh agen terstruktur melalui kebijakan asinkron bersama,
menyimpan kelas pada tmux, dan memberi pengecualian operator yang tetap memakai mutex.
Default guard aktif 2,5; raw terminal/shell/SSH tetap tersedia. UI manual mempertahankan
konteks retry dan menampilkan angka sebelum force. Bearer force ditolak sebelum approval.

Review security menemukan bypass force dari AgentToken; diperbaiki dan re-review bersih.
Review blast-radius menemukan mutex raw terminal, separator Windows pada fallback pane
lama, dan UI project-flow tanpa retry force; ketiganya diperbaiki dengan test regresi.
Review akhir seluruh perubahan tidak menemukan cacat correctness atau kontrak yang tersisa.

Verifikasi 2026-09-05, hanya scope terkait:

- Gerbang/deps dan HTTP terstruktur, termasuk Bearer force, Windows, race, serta antrean:
  **67/67** test di lima berkas pada run final. Parsing pane + mock lampiran:
  **26/26** di tiga berkas (termasuk unit gerbang yang sama, bukan jumlah tambahan unik).
- Regresi server: 12 berkas terkait, 278 test dijalankan. Sembilan berkas langsung hijau;
  tiga penyebab gagal ditelusuri dan dikoreksi: fixture terminal menumpuk pane lintas
  81 test sehingga perlu guard off secara eksplisit; mock pty lampiran perlu API asinkron;
  test raw SSH mewarisi SSH_ASKPASS_REQUIRE=force/GIT_TERMINAL_PROMPT=0. Retest terminal
  **81/81**, lampiran **4/4**, SSH/sessionKind/onBirth **3/3** dengan env bersih.
- Shared/UI konfigurasi, status, modal, serta client: **115 test unik / 17 berkas** lulus.
  Regresi UI perluasan retry manusia: **121/121 / 9 berkas** lulus (set beririsan).
  Test PRD existing mengeluarkan warning React act, tanpa assertion gagal.
- Telegram: **33/33** di lima berkas terkait, termasuk async lookup/birth dan reuse
  yang tetap mengirim turn yang datang bersamaan.
- Typecheck shared, server, frontend lulus, dijalankan berurutan; bukan typecheck seluruh repo.
- `hanoman docs index --check`: index ok. `git diff --check`: bersih.

Smoke memakai listener Fastify lokal, DB/home/socket tmux QA terpisah. Satu pane shell
nyata menempati cap 1 sementara scheduler mati: POST backlog → **409 capacity**, snapshot
liveCount=1/liveAgentCount=0/loadPerCore=0,4464/maxLoadPerCore=2,5. PUT konfigurasi QA
mengubah cap ke 100 dan ambang ke 0,000001 (tanpa membebani host): POST reverse →
**409 host-load**. POST shell → **201** pada keadaan yang sama. Kedua penolakan tidak
menciptakan direktori worktree. GET scheduler/state mengembalikan status available dan
angka yang sama. Shell QA ditutup melalui API dan server QA dihentikan per PID; tidak
ada perubahan pada instance operator atau sesi proyek lain.
