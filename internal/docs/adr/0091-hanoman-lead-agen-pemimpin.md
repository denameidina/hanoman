# ADR-0091 — hanoman-lead: agen pemimpin di atas agen; manusia jadi pembatal, bukan gerbang

- **Diamandemen [ADR-0228](0228-lead-sesi-interaktif-gerbang-server.md)** (2026-10-20): lead kini sesi
  tmux interaktif per proyek, bukan `claude -p`/`codex exec` sekali-panggil; urutan kerja diganti
  pemilihan ≤ jatah server; integrasi berverifikasi + wewenang/izin per proyek. Allowlist tindakan,
  jejak, dan opt-in di bawah tetap berlaku.
- Status: **Accepted** — mengamandemen [ADR-0035](0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md)
  (bagian "berhenti untuk bertanya"), memperluas [ADR-0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md) &
  [ADR-0065](0065-ai-agent-capability-agent-token.md). **Tidak** mencabut
  [ADR-0037](0037-cabut-guardrail-safety.md), [ADR-0024](0024-sesi-interaktif-menggantikan-run.md),
  maupun [ADR-0039](0039-realtime-lewat-websocket-siar.md).
- Tanggal: 2026-07-31 · SPEC-409
- Sumber: PRD [`docs/prd/orchestrator-hanoman.md`](../../../docs/prd/orchestrator-hanoman.md)

## Konteks

hanoman hari ini adalah **orchestrator sesi**: ia melahirkan sesi `claude`/`codex` di tmux, satu sesi
per backlog, di worktree terisolasi. Yang ia belum lakukan adalah **memimpin**. Mekanisme "sesi
sedang menunggu keputusan" sudah lengkap sejak SPEC-184/196 — hook `Notification` menulis marker,
`markerFilled()` menentukannya, `liveDecisions()` memasoknya, `Notification type:"decision"` terbit —
tapi **tak ada yang menjawabnya selain manusia**. Selama manusia itu tak di depan layar, sesi diam,
dan karena `remain-on-exit on` menahan pane, mandek itu tak terlihat berbeda dari "sedang bekerja".

ADR-0035 menyatakan agen "hanya berhenti untuk bertanya saat butuh keputusan manusia sejati", dan
aturan produk berbunyi "manusia terakhir yang memutuskan". PRD orchestrator membalik pihak yang
menjawabnya — bukan mekanisme berhentinya.

## Keputusan

Ada peran baru **hanoman-lead**: satu "tech lead mesin" per project, dengan empat tanggung jawab —
menjawab keputusan, menata urutan kerja & mencegah tabrakan, menjaga mutu hasil, dan memegang
konteks besar yang tak dimiliki sesi manapun.

**Kontrak otonominya dibalik secara sadar: lead memutuskan lalu melapor.** Prinsip produk berubah
dari *"manusia terakhir yang memutuskan"* menjadi **"manusia terakhir yang bisa membatalkan"** —
tapi HANYA untuk project yang di-opt-in (OQ-14). Untuk semua yang lain, prinsip lama tetap berlaku
apa adanya — lihat [product/scope-principles](../product/scope-principles.md).

### 1. Lead adalah agen, dipanggil sekali-jalan

Pertanyaan yang dijawab lead berbentuk prosa, dan jawabannya menuntut membaca docs/kode/riwayat —
jadi lead adalah agen (`claude`/`codex`), bukan pohon `if`. Ia dipanggil **non-interaktif**
(`claude -p …` / `codex exec …`) lewat `services/lead/brain.ts`, keluarannya satu blok ```json`, lalu
ia keluar.

**Ini bukan menghidupkan kembali run headless yang dicabut ADR-0024.** Yang dicabut adalah
MENGERJAKAN pekerjaan lewat CLI headless bertahap (spec/plan/execute); pekerjaan tetap milik sesi
interaktif di tmux. Lead adalah panggilan **penasihat** berumur pendek: ia tak menyentuh worktree
sesi manapun, tak punya berkas fase, dan tak pernah men-shell-out hasil pikirannya sendiri.

Setelan agennya (OQ-1) mengikuti pola `conflictSessionDefaults()` (ADR-0081): blok
`Setting.lead.engine` **opt-in** — selama `enabled` mati, lead memakai `sessionAgentDefaults()`. Satu
setelan agen, bukan dua yang bisa berselisih diam-diam. Kuotanya menumpang langganan yang sama dan
terlihat di badge limit yang sudah ada; **tak ada akunting terpisah** di versi ini.

### 2. Tiga pintu, satu otak

Semua pintu lewat `services/lead/decide.ts`, sehingga hanya ada satu tempat yang tahu urutan wajib
**bukti → putusan → saring rujukan → gerbang tindakan → TULIS JEJAK → notifikasi**. AC-2 menuntut
jejak ditulis sebelum jawaban sampai ke peminta, dan satu-satunya cara memastikannya adalah tak
punya jalur kedua.

- **Pintu #1 — kontrak eksplisit** (`POST /api/lead/decisions`). Untuk sesi yang tahu kontraknya dan
  untuk agen eksternal ber-`AgentToken`. Balasannya terstruktur (`decision`/`reason`/`refs`/
  `confidence`/`action`), bukan prosa bebas.
- **Pintu #2 — deteksi otomatis** (`services/lead/detect.ts`). Melayani sesi **apa adanya**: tak ada
  prompt baru, tak ada kontrak baru. Lead melihat sesi hidup ber-marker terisi, `capture-pane`,
  menyimpulkan pertanyaannya, lalu **mengetik jawabannya ke pane**. Sesi lanjut tanpa tahu siapa
  yang menjawab.
- **Pintu #3 — denyut proaktif** (`services/lead/pulse.ts`). Menata urutan kerja, mendeteksi
  tabrakan area kerja, dan menindaklanjuti sesi yang baru selesai.

### 3. Batas keras hidup di permukaan tindakan LEAD, bukan pada sesi pekerja

`LEAD_ACTIONS` di `shared/src/lead.ts` adalah **allowlist tertutup**, konstanta modul — **bukan
konfigurasi**, persis karena AC-31 berbunyi "dalam keadaan apa pun, termasuk saat operator memintanya
lewat konfigurasi". Yang tak tercantum tak punya jalan masuk: deploy, perintah/konsol VPS, data
produksi, dan penghapusan apa pun. `switch` di `apply.ts` tertutup — tak ada cabang `default` yang
mengeksekusi.

**ADR-0037 tetap utuh.** Sesi pekerja tetap jalan `--dangerously-skip-permissions` tanpa satu pun
hook deny; yang dibatasi adalah apa yang bisa dipanggil LEAD, di sisi server.

Konsekuensi yang tak terduga tapi mengikat: **"ulangi dari nol" mustahil bagi lead**, karena mulai
benar-benar dari nol menuntut menghapus worktree — dan itu terkunci (AC-32). `restart-session`
karena itu berarti "bunuh pane lalu lahirkan sesi baru DI ATAS worktree yang ada". Menghentikan
sesi memakai `killSession()` **langsung**, bukan `DELETE /terminal/sessions/:id`, yang memang
menghapus worktree saat operator menutup sesi (SPEC-362) dan akan membuang pekerjaan belum-commit.

### 4. Jejak keputusan adalah data, bukan turunan

Model baru `LeadDecision` + migration tulis tangan (ADR-0086/0087; ikut `PG_ORDER`). Alasannya sama
dengan ADR-0090 dan berlawanan dengan ADR-0011/0018: aturannya bukan "selalu turunkan" melainkan
*bisakah dihitung ulang dari sumber lain* — coverage bisa, diff bisa, **pertanyaan yang ditanyakan
sesi yang sudah mati dan alasan yang dipakai lead tidak bisa**.

**LOCAL-only** (cermin `SessionHistory`/`SchedulerQueueItem`): barisnya menunjuk sesi tmux & worktree
di mesin ini. Tanpa `version`, tak masuk `FIELDS` sync.

Statusnya empat: `berlaku` · `ditimpa` · `dibatalkan` · **`gagal`**. Yang terakhir bukan keputusan
melainkan catatan bahwa lead TIDAK berhasil memutuskan dalam batas waktu (AC-4) — ia tetap disimpan,
karena "tak ada barisnya" tak bisa dibedakan dari "tak pernah diminta". `services/lead/trail.ts`
**tak punya fungsi hapus sama sekali**: cara termurah menegakkan AC-32 adalah tak pernah menulis
kodenya.

### 5. Polling, in-process, tanpa infrastruktur baru

Denyut = `setInterval` di proses server (cermin engine scheduler ADR-0072 & monitor VPS). Tanpa
message queue/Redis/worker/cron eksternal (ADR-0024 utuh). Jejak & status lewat HTTP polling; **tak
ada kanal WebSocket baru** (ADR-0039 utuh). Urutan yang lead putuskan diserahkan ke antrean &
governor yang **sudah ada** — bukan antrean kedua.

Dua irama sengaja berbeda: pintu deteksi tiap **5 detik** (sesi mandek diukur dalam menit — M1
median ≤ 2 menit; biayanya satu `list-panes` + satu `stat` per sesi, nol panggilan agen selama tak
ada yang menunggu), denyut proaktif tiap `lead.everyMin` (default 5 menit, karena ia menyentuh git
dan bisa memanggil agen).

### 6. Semua default MATI

`Setting.lead` (kolom `Json` → **tanpa migration** untuk knob-nya) + `Project.leadOptIn` (kolom baru,
cermin `schedulerOptIn`). Selama master switch mati, hanoman berperilaku **persis** seperti sebelum
ADR ini.

## Keputusan yang menutup Open Question PRD

| OQ | Ditutup dengan |
|----|----------------|
| OQ-1 agen & ongkos lead | Blok `Setting.lead.engine` opt-in; mati = warisi `sessionAgentDefaults()`. Kuota menumpang langganan yang sama, terlihat di badge limit; tanpa akunting terpisah. |
| OQ-2 frekuensi & anggaran denyut | `everyMin` default 5. Idle benar-benar murah: penataan urutan hanya lahir saat **himpunan backlog siap-kerja berubah** (signature), tindak lanjut mutu hanya sekali per sesi (idempoten lewat jejak), tabrakan hanya sekali per pasangan. Nol pekerjaan → nol panggilan agen. **Diperketat SPEC-432** (audit [`research/audit-spec-432-…`](../research/audit-spec-432-lead-tak-memutuskan-denyut-spam.md)): "berubah" saja ternyata tak cukup — himpunan itu bergeser tiap sesi lahir (`baseSha` ditulis) dan tiap backlog masuk, sementara penataannya bisa nihil sejak awal. Syaratnya kini **aktionabilitas**: scheduler menyala & tak dijeda, project `schedulerOptIn`, dan ≥ 2 backlog siap yang **belum ada di antrean** (`enqueue` = `upsert(update:{})` → yang sudah antre tak bisa dipindah); tanda tangannya dihitung atas himpunan belum-antre itu. |
| OQ-3 syarat sebelum integrasi ke `main` | Tetap ada syarat **objektif**, dan diperiksa server dari berkas & tmux — bukan penilaian prosa lead: plan tak menyisakan `- [ ]` (ADR-0029). Knob `requireGreenBeforeIntegrate` default **menyala**; operator boleh mematikannya. Buktinya ditempel ke baris jejak yang bersangkutan (AC-19). |
| OQ-4 migration oleh lead | Lead **tidak** menulis ADR sendiri di versi ini, dan `run-migration` ada di allowlist tapi **dieksekusi operator** — dicatat sebagai keputusan, tidak dijalankan lead. |
| OQ-5 "putusan berbobot" | `isWeightyDecision()`: keraguan, tabrakan, penolakan tindakan terkunci, atau tindakan yang sulit dibatalkan (`integrate-main`/`run-migration`/`stop-session`/`restart-session`). |
| OQ-6 retensi jejak | Selamanya di versi ini. Pemangkasan, bila kelak ada, jadi wewenang manusia lewat jalur terpisah — bukan lead (AC-32). |
| OQ-7 perambatan override | Jawaban operator dikirim ke pane bila sesinya masih hidup; pekerjaan **dilanjutkan dengan koreksi**, tidak diulang otomatis. |
| OQ-8 tabrakan lead vs operator | **Manusia menang.** Override menandai baris lead `ditimpa` dan me-*reset* penghitung jawaban otomatis sesi itu — campur tangan operator memutus rantai "berturut-turut" yang dijaga AC-11. |
| OQ-9 definisi "area kerja" | **Berkas yang sudah berubah** di worktree sesi (`specReview`, sumber yang sama dengan layar Review) — bukan plan atau isi backlog: plan menyatakan niat dan sering meleset, diff menyatakan kenyataan. Berkas sama = tabrakan kuat; modul (dua segmen path pertama) sama = sinyal lemah, tetap dilaporkan. |
| OQ-10 batas jawaban otomatis | `maxAutoAnswers` default **3** per sesi. |
| OQ-11 rahasia & kredensial | Prompt lead melarang membaca/mengutip kredensial secara eksplisit, dengan alasannya disebut (jejak keputusan adalah DB). |
| OQ-12 nomor ADR | **0091** — dienumerasi lintas semua branch & worktree tepat sebelum diklaim (ADR-0021); tertinggi saat itu 0090. |
| OQ-13 sesi dokumen | Sesi tanpa `specId` dilewati; sesi dokumen dinilai **hanya lewat kode keluar** — kriteria kotak `- [ ]` tak berlaku untuk pipeline tanpa plan. |
| OQ-14 nasib prinsip lama | **Dipertahankan sebagai default.** "Manusia terakhir yang memutuskan" tetap berlaku untuk setiap project yang tidak meng-opt-in lead; yang berubah hanya untuk project yang dipimpin. |

## Alternatif yang ditolak

- **Lead sebagai aturan deterministik tanpa agen.** Menghapus ketergantungan kuota & non-determinisme,
  tapi pertanyaan yang bikin sesi mandek justru yang tak bisa diputuskan tanpa membaca docs. Yang
  tersisa cuma jawaban template — yaitu mandek dengan langkah tambahan.
- **Hook deny pada sesi pekerja sebagai batas keras.** Membalik ADR-0037 untuk masalah yang bukan
  masalah sesi pekerja. Yang perlu dibatasi adalah lead, dan lead hidup di server — batasnya di sana.
- **Sesi tmux berumur panjang sebagai lead.** Menaruh lead di pane berarti ia ikut aturan sesi (satu
  worktree, satu fase, `remain-on-exit`), dan keputusannya jadi teks di layar alih-alih baris data.
- **Kanal WebSocket khusus lead.** ADR-0039 sudah memutuskan: WS hanya untuk terminal PTY.
- **Menulis ulang `Spec.priority` agar urutan lead menang mutlak.** Prioritas adalah pernyataan
  operator. Lead menata **di dalam** pita prioritas (urutan enqueue → tiebreak FIFO `queued()`).
  Batas yang diterima sadar; menaikkannya butuh keputusan produk, bukan patch.
- **Menyimpan `reply` (teks yang diketik ke pane) sebagai kolom.** Ia turunan dari `answer` dan
  berumur satu ketikan. Ia hidup di saluran samping — dan `detect.ts` **jatuh ke `answer`** bila
  saluran itu meleset, supaya tak pernah ada string kosong yang diketik ke terminal.

## Konsekuensi

**Diterima sadar:**

- **Kode dapat masuk `main` tanpa mata manusia** (PRD §Risiko). Pengamannya di belakang: jejak,
  notifikasi, ambil alih, dan git. Syarat objektif OQ-3 mempersempitnya, tidak menghapusnya.
- **Kuota bisa terbakar** saat banyak sesi bertanya berbarengan. Pagarnya `maxAutoAnswers`,
  `timeoutSec`, dan denyut yang benar-benar idle saat tak ada yang berubah.
- **Deteksi "codex sedang bertanya" adalah heuristik.** Marker codex diturunkan dari
  `Stop`+`UserPromptSubmit` (ADR-0074) sehingga menyala juga saat sesi selesai wajar. `pane.ts`
  karena itu **bias ke diam**: butuh sinyal pertanyaan eksplisit DAN tak ada penanda selesai. Salah
  arah ke "diam" hanya mengembalikan perilaku hari ini; salah arah ke "menjawab" membangunkan sesi
  yang sudah selesai.
- **Tiga tindakan dicatat tapi dieksekusi operator** di versi ini: `push-branch`, `run-migration`,
  `hold-work`. Keputusannya tetap tertulis di jejak — yang belum ada hanyalah tangannya.
- **AC-27 (≤ 5 detik)** berlaku untuk *memulai* keputusan baru: `leadActive` dibaca ulang di tick,
  di `scanAndAnswer`, dan di dalam `decide()` sendiri. Putusan yang sudah berjalan dibiarkan selesai.

**Gotcha yang mahal kalau dilupakan:**

1. **Penghitung jawaban otomatis TAK BOLEH di-reset saat marker kosong.** Marker memang kosong
   sesaat setelah lead mengetik — hook `UserPromptSubmit` menjalankan `: > <marker>`. Reset di sana
   membuat pagar AC-11 tak pernah tercapai: loop tanpa ujung, dengan bentuk yang tampak sehat.
2. **Idempotensi denyut harus lewat JEJAK, bukan `Set` di memori.** Pane mati bertahan di tmux
   berhari-hari (`remain-on-exit on`) dan denyut jalan tiap 5 menit; `Set` memori kosong tepat
   sesudah restart, yaitu saat lead paling mungkin memutuskan ulang hal yang sama.
3. **`capabilityForRoute` harus memetakan `lead` MENURUT METHOD.** SPEC-405 sudah membuktikan
   akibatnya bila tidak: prefix status yang dipetakan ke izin baca membuat setiap agent token bisa
   memanggil endpoint tulis di bawahnya. `POST /lead/decisions` adalah endpoint tulis (AC-5).
4. **`zLeadVerdict.action` sengaja `string`, bukan enum.** Tindakan terlarang harus bisa MASUK supaya
   server menolaknya secara sadar, mencatat penolakannya, dan menotifikasi (AC-33). Kalau enum yang
   menyaring, permintaan "deploy ke produksi" hanya tampak sebagai keluaran rusak — dan justru
   peristiwa paling layak dilaporkan itulah yang hilang dari jejak.
5. **Jawaban ke pane wajib dipotong ber-jeda.** `sendToPane` memakai `goalChunks` yang sama dengan
   arming goal: TUI codex mengubah burst ≥ 1024 karakter jadi `[Pasted Content N chars]`, dan
   degradasinya SENYAP (ADR-0085). Jawaban lead gampang melewati batas itu.
6. **Rujukan disaring terhadap repo.** Path absolut & `..` ditolak — rujukan adalah alamat DI DALAM
   repo, dan jejak keputusan dibaca operator sebagai bukti.

**Ditambahkan SPEC-432** — tiga lagi, semuanya terukur di jejak operator (7/7 baris `gagal`;
lihat [audit SPEC-432](../research/audit-spec-432-lead-tak-memutuskan-denyut-spam.md)):

7. **Prompt WAJIB menyebut anggaran waktunya, dan angkanya harus yang benar-benar berlaku.**
   Perintah "kumpulkan bukti dulu: SoT, ADR, plan, kode, riwayat git" tak punya dasar berhenti,
   sementara `brain.think()` meng-SIGTERM agennya di detik ke-`timeoutSec`. Tanpa memberi tahu
   agen bahwa jam berdetak, keduanya bertabrakan **setiap kali** — bukan kadang-kadang. Terukur
   pada agen & harness yang sama: prompt tanpa anggaran **306 236 ms**, prompt yang sama plus satu
   paragraf anggaran **101 136 ms dengan blok json sah**. `timeoutSec` default karena itu naik
   120 → 600, dan `decide()` meneruskan `cfg.timeoutSec` yang sama ke `leadPrompt`: dua sumber
   angka akan berselisih diam-diam begitu operator menggeser knob-nya, dan agen yang dianggarkan
   salah gagal persis seperti agen yang tak dianggarkan.
8. **Dua irama §5 butuh dua penjaga re-entrancy.** Satu flag `busy` untuk keduanya membuat denyut
   proaktif yang lambat (jumlah project × `timeoutSec`) memulangkan setiap tick 5 detik tanpa
   menjalankan pintu deteksi — pintu yang justru satu-satunya penjawab sesi mandek, dan M1
   (median ≤ 2 menit) mustahil di bawahnya. Jatuh tempo denyut juga dihitung dari saat denyut
   **selesai**, bukan mulai: menstempel di awal membuat denyut yang lebih lama dari `everyMin`
   langsung jatuh tempo lagi begitu ia selesai.
9. **Kunci idempotensi denyut TIDAK BOLEH memakai `kind`.** `decide()` menulis ulang `kind` jadi
   `"refusal"` saat tindakan usulan lead di luar allowlist (gotcha #4 di atas adalah alasan
   perilaku itu ada), jadi gerbang `seen` ber-`kind` meleset persis pada baris yang sudah ditulis
   — dan sesi mati yang sama ditanyakan ulang tiap denyut, selamanya. Yang stabil adalah penanda
   di dalam `question` (awalan `Sesi <id> untuk backlog <specId>`, kunci pasangan `[a|b]`).
