# PRD — Orchestrator Hanoman (hanoman-lead: agen pemimpin atas agen)

> Status: **Diwujudkan di SPEC-409** — lihat [ADR-0091](../../internal/docs/adr/0091-hanoman-lead-agen-pemimpin.md),
> yang menutup keempat belas Open Question di bawah dan mencatat batas yang diterima sadar.
> Author: PM/PO (nafanesia). Disusun dari brief "Orchestrator Hanoman" + brainstorm.
> Deliverable ini adalah **dokumen PRD**, bukan spesifikasi teknis/rencana implementasi. Keputusan implementasi mengikuti PRD ini lewat SPEC/ADR tersendiri.
> PRD ini **mengamandemen kontrak otonomi ADR-0035** dan prinsip produk "manusia terakhir yang memutuskan". Perubahan itu wajib diwujudkan sebagai ADR baru sebelum implementasi.

## Ringkasan

hanoman hari ini adalah **orchestrator sesi**: ia melahirkan sesi `claude`/`codex` di tmux, satu sesi per backlog, di worktree terisolasi, lalu menampilkan semuanya di satu dashboard. Yang ia **belum** lakukan adalah **memimpin**. Setiap kali agen menemui persimpangan yang butuh keputusan, sesi berhenti dan menunggu manusia — dan selama manusia itu tidak di depan layar, seluruh pekerjaan diam.

PRD ini menaikkan hanoman dari orchestrator sesi menjadi **hanoman-lead**: satu peran "tech lead mesin" di atas semua agen, dengan empat tanggung jawab — **menjawab keputusan**, **menata urutan kerja & mencegah tabrakan antar-agen**, **menjaga mutu hasil**, dan **memegang konteks besar** yang tak dimiliki sesi manapun secara individual.

Kontrak otonominya dibalik secara sadar: **hanoman-lead memutuskan semuanya sendiri, lalu melapor.** Manusia berhenti menjadi gerbang di depan dan menjadi **pengawas di belakang** — pengamannya empat lapis: **jejak keputusan yang bisa ditelusuri**, **tombol ambil alih kapan saja**, **batas kerusakan yang keras** (produksi/VPS & penghapusan data terkunci), dan **notifikasi saat putusan berbobot**.

Populasi yang dipimpin ada dua: sesi yang hanoman spawn sendiri, **dan** agen eksternal yang datang lewat `AgentToken` (ADR-0065) — Claude Code/Codex yang dijalankan manual di terminal lain, agen di mesin lain, atau tool pihak ketiga. Karena itu ada **dua pintu masuk keputusan**: kontrak eksplisit "minta putusan" untuk agen yang tahu, dan **deteksi otomatis** untuk yang tidak tahu (hanoman melihat sesi menunggu lewat marker keputusan yang sudah ada, membaca layarnya, lalu mengetik jawabannya ke pane).

Wujudnya **hybrid**: on-demand saat ada pertanyaan (lahir → baca konteks → jawab → selesai) plus **denyut berkala** untuk kerja proaktif yang tak dipicu siapa-siapa. Saat lead sendiri ragu, ia **wajib mengumpulkan bukti dulu** (docs SoT/ADR/plan, kode, riwayat git, test) lalu tetap memutuskan — memilih opsi yang paling mudah dibatalkan, menandai keputusannya "ragu", dan mengirim notifikasi.

Cakupan: **satu workspace** (`nafanesia`), **satu lead per project** (lead lintas-project ada di luar scope versi ini), sejalan dengan prinsip MVP hanoman.

## Masalah & konteks

### Masalah

1. **Sesi mandek menunggu manusia.** Mekanisme marker keputusan sudah ada (SPEC-184/196: hook `Notification` menulis path ke `.worktrees/.decisions/<id>`; `SessionInfo.decision` menyala; `Notification type: "decision"` terbit). Yang tidak ada adalah **yang menjawabnya selain manusia**. Akibatnya sesi bisa diam berjam-jam untuk keputusan yang sebetulnya kecil dan jawabannya ada di docs — dan karena `remain-on-exit on` menahan pane, mandek itu tidak terlihat berbeda dari "sedang bekerja" sampai seseorang membuka terminalnya.
2. **Tidak ada yang mengatur antar-agen.** Beberapa sesi berjalan bersamaan di satu mesin. Urutan dan prioritasnya ditentukan operator secara ad-hoc; tak ada yang tahu bahwa dua sesi sedang menyentuh area yang sama sampai keduanya selesai dan bertabrakan saat integrasi. Scheduler yang ada (SPEC-294–299/ADR-0072) mengantre dan membatasi jumlah sesi, tapi ia **tidak memutuskan apa pun** — ia tidak tahu isi pekerjaannya.
3. **Mutu hasil tidak dijaga.** Sesi bisa mengklaim selesai padahal dangkal (subagent async membuat agen `end_turn` lebih cepat; gate mode goal menilai lewat prosa). `SessionInfo.exitCode` kini membedakan "Selesai" dari "Gagal · exit n" (SPEC-402), tapi yang **membaca** sinyal itu dan memutuskan "ulangi" tetap manusia. Selama manusia tidak hadir, sesi gagal hanya menumpuk.
4. **Agen buta konteks besar.** Tiap sesi hanya tahu backlog-nya sendiri dan repo di worktree-nya. Ia tidak tahu keputusan yang baru diambil sesi tetangga, tidak tahu backlog lain sedang mengubah modul yang sama, dan tidak tahu preseden ADR yang relevan kecuali ia kebetulan membacanya. Konteks itu ada di hanoman — tapi tak pernah sampai ke agen pada saat ia membutuhkannya.

### Konteks arsitektur hanoman (fakta yang mengikat desain)

- **Kontrak otonomi hari ini adalah kebalikan dari PRD ini.** ADR-0035 menyatakan agen menembus batas fase tanpa berhenti **dan hanya berhenti untuk bertanya saat butuh keputusan manusia sejati**; aturan produk berbunyi "manusia terakhir yang memutuskan". PRD ini menggantikan pihak yang menjawab, bukan mekanisme berhentinya — dan karena itu **wajib lewat ADR baru** yang menyatakan ADR-0035 diamandemen.
- **Marker keputusan sudah ada dan sudah menjadi sinyal terstruktur.** `pty.ts` menulis direktori marker per sesi, `markerFilled()` menentukan sesi sedang menunggu, `liveDecisions()` memasoknya ke `notifications.ts`. Pintu deteksi otomatis **membangun di atas ini**, bukan membuat mekanisme deteksi baru. Catatan agen: codex tak punya event `Notification` — markernya diturunkan dari `Stop`+`UserPromptSubmit`, sehingga **marker codex juga menyala saat sesi selesai wajar** (ADR-0074). Lead harus membedakan keduanya, bukan menganggap semua marker sebagai pertanyaan.
- **Guardrail perintah berbahaya sudah dicabut (ADR-0037).** Sesi pekerja jalan `--dangerously-skip-permissions` tanpa hook deny apa pun; isolasi worktree adalah satu-satunya batas keamanan yang tersisa. **Batas kerasnya hanoman-lead karena itu bukan hook deny pada sesi pekerja** — ia adalah batas pada **permukaan tindakan lead sendiri** (apa yang boleh dipanggil lead), ditegakkan di sisi server. ADR-0037 tetap utuh; PRD ini tidak menghidupkan kembali guardrail apa pun pada agen pekerja.
- **Agen eksternal sudah punya jalur auth & capability.** `AgentToken` Bearer + capability per-domain read/write (SPEC-257/ADR-0065), master switch `Setting.agentAccessEnabled` default mati. Pintu "minta putusan" untuk agen eksternal menempel pada jalur ini. Jebakan terukur (SPEC-405): `capabilityForRoute` pernah memetakan prefix ke `GLOBAL_READ` **tanpa melihat method**, sehingga endpoint **tulis** baru di bawah prefix status terbuka untuk setiap token — endpoint keputusan adalah endpoint tulis dan tak boleh mengulang kelas bug itu.
- **Realtime = WebSocket hanya untuk terminal PTY; sisanya HTTP polling** (ADR-0039). Layar Lead, jejak keputusan, dan badge mengikuti pola polling — **jangan menambah kanal WebSocket baru**.
- **Tidak ada message queue/Redis/worker terpisah** (ADR-0024). Kerja latar hanoman berupa `setInterval` di proses server, plus engine scheduler in-process (ADR-0072). **Denyut lead mengikuti pola yang sama** — bukan infrastruktur baru.
- **Antrean & governor sudah ada.** `services/scheduler/{engine,queue,governor,registry,reconcile}.ts` menyediakan antrean durable, cap jumlah sesi bersamaan, dan Pause. Lead **memakai** itu untuk mengeksekusi urutan yang ia putuskan; ia tidak membangun antrean kedua.
- **Menambah model = migration + ADR.** Jejak keputusan adalah data baru yang harus bertahan (bukan nilai turunan seperti coverage/PRD, ADR-0011/0018), jadi ia menuntut model baru + `migration.sql` tulis tangan + `migrate deploy`, dan model baru **wajib ikut `PG_ORDER`** di alat migrasi (ADR-0086/0087). Fitur SQLite yang terlarang (scalar list, `@db.*`, `Decimal`, `Bytes`, `mode:"insensitive"`, `@map`) tidak boleh masuk.
- **Satu backlog = satu sesi** (ADR-0015), **sesi hidup di worktree `--detach`** (ADR-0002), **stage maju hanya lewat fase yang dilaporkan sesi** dan mundur hanya lewat aksi human eksplisit (ADR-0027), **`executing` tertahan selama plan menyisakan `- [ ]`** (ADR-0029). Wewenang lead menata & mengulangi kerja bekerja **di dalam** aturan-aturan ini, bukan menerobosnya.
- **Sesi bisa dilanjutkan, bukan diulang** (SPEC-394/ADR-0084): `startSpecSession` punya keadaan live/resume/fresh. Ketika lead memutuskan "lanjutkan pekerjaan yang terputus", jalur itu sudah tersedia dan tak perlu dibuat ulang.
- **Prinsip produk yang berubah, dan yang tidak.** Yang berubah: "manusia terakhir yang memutuskan" → **"manusia terakhir yang bisa membatalkan"**. Yang tidak berubah: satu workspace, instrumen panel yang tenang, docs sebagai Source of Truth, otomasi penuh selalu bisa diinterupsi.

## Persona/pengguna

**P1 — Operator/PM (pengguna utama, hari ini satu orang).** Menjalankan banyak project sekaligus dari satu dashboard. Ingin bisa meninggalkan mesin seharian dan menemukan backlog tetap maju. Perhatiannya bukan "apakah agen menunggu izin saya", melainkan "apakah saya bisa melihat & membatalkan apa yang sudah diputuskan". Bukan orang yang mau membaca setiap keputusan — ia mau **notifikasi untuk yang berbobot** dan **jejak lengkap saat ia curiga**.

**P2 — Sesi agen internal (`claude`/`codex` yang di-spawn hanoman).** Pengguna mesin. Hari ini ia berhenti dan menulis pertanyaan ke terminal saat menemui persimpangan. Ia **tidak perlu diubah** untuk dilayani lead — pintu deteksi otomatis melayani sesi apa adanya. Bila ia tahu kontraknya, ia boleh bertanya secara eksplisit dan dapat jawaban terstruktur berikut alasan & rujukan.

**P3 — Agen eksternal ber-`AgentToken`.** Claude Code/Codex yang dijalankan manual di terminal lain, agen di mesin lain, atau tool pihak ketiga. Ia tidak hidup di tmux hanoman dan tidak punya marker keputusan; satu-satunya jalannya adalah **memanggil kontrak minta-putusan lewat API**. Ia harus mendapat jawaban yang bisa dipakai mesin (bukan prosa bebas), berikut rujukan supaya bisa memverifikasi sendiri.

**P4 — Reviewer/rekan (pasca-MVP, disebut agar desain tidak menutup jalannya).** Orang yang membaca jejak keputusan untuk memahami *kenapa* kode jadi begini. Kebutuhannya sama dengan P1 pada sisi baca, tanpa wewenang ambil alih. Tidak diimplementasikan di versi ini (tak ada RBAC, ADR-0065).

## Goals & non-goals

### Goals

- **G1 — Sesi tidak pernah mandek karena menunggu keputusan.** Setiap sesi yang menunggu mendapat jawaban dari lead, bukan dari kehadiran manusia.
- **G2 — Backlog tetap maju saat operator tidak hadir.** Satu hari kerja penuh tanpa dashboard dibuka, backlog tetap bergerak.
- **G3 — Setiap keputusan tertelusur dan bisa dibatalkan.** Pertanyaan, jawaban, alasan, rujukan, dan dampaknya tercatat; operator bisa menimpanya kapan saja.
- **G4 — Kerja antar-agen terkoordinasi.** Urutan & prioritas ditata oleh satu pihak yang tahu isi pekerjaannya; tabrakan area kerja terdeteksi sebelum jadi konflik integrasi.
- **G5 — Mutu keluaran tidak turun tanpa manusia sebagai gerbang.** Sesi gagal, kerja dangkal, dan konflik tidak bertambah dibanding keadaan sekarang.
- **G6 — Satu sumber keputusan untuk agen internal maupun eksternal.** Dua pintu masuk, satu otak, satu jejak.

### Non-goals

- **NG1 — Bukan lead lintas-project.** Satu lead melayani satu project. Relasi `ProjectLink` & audit lintas project (ADR-0075) tidak dipakai di versi ini.
- **NG2 — Bukan pengganti scheduler.** Antrean durable, governor cap, dan Pause yang ada tetap dipakai apa adanya; lead menjadi lapisan **keputusan** di atasnya, bukan antrean kedua.
- **NG3 — Bukan menghidupkan kembali guardrail deny pada sesi pekerja.** ADR-0037 tetap utuh; batas keras berlaku pada permukaan tindakan lead sendiri.
- **NG4 — Manusia tidak ikut antre keputusan.** Operator tidak bertanya ke lead lewat kontrak ini di versi ini.
- **NG5 — Lead tidak menyentuh produksi.** Tidak deploy, tidak restart service, tidak menjalankan perintah di VPS, tidak menyentuh DB/data produksi, tidak membuka konsol VPS.
- **NG6 — Lead tidak menghapus data.** Tidak menghapus project, backlog, branch, worktree, notifikasi, jejak keputusan, atau berkas di luar worktree sesi yang bersangkutan.
- **NG7 — Bukan infrastruktur baru.** Tanpa message queue/Redis/worker terpisah/cron eksternal (ADR-0024); tanpa kanal WebSocket baru (ADR-0039).
- **NG8 — Bukan RBAC & bukan sistem izin berlapis.** Tidak ada peran pengguna baru; cookie tetap akses penuh.
- **NG9 — Bukan mesin belajar dari override.** Lead tidak otomatis menyesuaikan kebijakannya dari pembatalan operator di versi ini (lihat Open questions).
- **NG10 — Tidak multi-tenant.** Satu workspace (`nafanesia`).

## Scope (in/out)

### In scope

**A. Peran & kontrak otonomi**
- hanoman-lead sebagai peran baru dengan empat tanggung jawab (menjawab · menata · menjaga mutu · memegang konteks).
- Amandemen tertulis atas ADR-0035 & prinsip "manusia terakhir yang memutuskan" → **ADR baru**.
- Master switch lead (default **mati**), plus penyalaan per project — mengikuti pola opt-in yang sudah dipakai fitur-fitur otonom hanoman.

**B. Pintu keputusan #1 — kontrak eksplisit**
- Kontrak "minta putusan": agen mengirim pertanyaan + konteks (project, backlog, fase, opsi yang ia lihat) dan menerima **jawaban terstruktur**: keputusan yang dipilih, alasan, rujukan (dokumen/ADR/plan/commit), tingkat keyakinan, dan penanda "ragu" bila ada.
- Dipakai sesi internal **dan** agen eksternal ber-`AgentToken`, dengan capability tulis tersendiri (bukan menumpang prefix baca).

**C. Pintu keputusan #2 — deteksi otomatis**
- Lead menerima event pertanyaan dari hook sesi (SPEC-909/ADR-0146; sebelumnya: memantau sesi hidup ber-marker keputusan terisi lalu membaca layar pane-nya), lalu **mengetik jawaban ke pane** sehingga agen lanjut tanpa tahu siapa yang menjawab.
- Membedakan marker "benar-benar bertanya" dari marker "sesi codex selesai wajar".
- Melayani sesi lama & agen yang tak tahu kontrak apa pun.

**D. Denyut proaktif**
- Menata urutan & prioritas backlog yang siap dikerjakan, dieksekusi lewat antrean & governor yang ada.
- Mendeteksi dua sesi/backlog yang menyentuh area kerja sama sebelum keduanya selesai.
- Memeriksa sesi yang baru selesai: membaca kode keluar (`exitCode`), keadaan fase, dan sisa kotak `- [ ]` di plan; memutuskan **terima**, **lanjutkan** (jalur resume ADR-0084), atau **ulangi**.

**E. Konteks besar**
- Lead membaca docs SoT/ADR/PRD/plan, riwayat git, keadaan backlog & sesi berjalan, dan **jejak keputusan sebelumnya** sebagai konteks — sehingga keputusan berikutnya konsisten dengan yang sudah diambil.

**F. Jejak keputusan (data baru)**
- Setiap keputusan tersimpan permanen: waktu, project, backlog/sesi peminta, pintu masuk yang dipakai, pertanyaan, jawaban, alasan, rujukan, tingkat keyakinan, tindakan yang menyusul, dan status (berlaku · ditimpa · dibatalkan).
- Bisa dibaca urut waktu, disaring per project & per backlog.

**G. Kendali manusia**
- Pause/lanjutkan lead: global dan per project.
- Timpa satu keputusan dengan jawaban operator, dan batalkan keputusan yang sudah diambil.
- Ambil alih sesi yang sedang dipimpin (interupsi & steer manual seperti hari ini).

**H. Batas keras**
- Permukaan tindakan lead **tidak memuat** produksi/VPS dan penghapusan data. Terkunci secara teknis, bukan lewat permintaan izin.
- Yang **boleh**: menjawab keputusan, memulai/menghentikan/mengurutkan sesi, menyuruh sesi mengulang atau melanjutkan kerja, mendorong perubahan ke branch, mengintegrasikan ke `main`, dan menjalankan migration — sesuai keputusan sadar operator, dengan risiko yang dinyatakan di bawah.

**I. Notifikasi**
- Notifikasi saat keputusan berbobot diambil dan saat keputusan ditandai "ragu" — **memberi tahu, bukan meminta izin**.

**J. Layar Lead**
- Layar baru di sidebar: keputusan terbaru (pertanyaan → jawaban → alasan → rujukan), status lead per project, antrean kerja yang sedang ia tata, tombol Pause & ambil alih. Mengikuti design system (editorial, bone paper, brass accent) dan pola polling.

### Out of scope

- Lead lintas-project / satu lead untuk banyak project.
- Manusia sebagai peminta putusan lewat kontrak yang sama.
- Beberapa lead sekaligus (lead per tim/domain), atau hierarki lead.
- Penyesuaian kebijakan otomatis dari riwayat override (umpan balik belajar).
- Perencanaan biaya/kuota cerdas (memilih model/effort demi hemat kuota).
- Ekspor/arsip jejak keputusan ke luar hanoman, dan retensi otomatis.
- RBAC, peran pengguna, atau pembatasan baca jejak per orang.
- Menyentuh produksi/VPS dalam bentuk apa pun.
- Mengubah mekanisme fase, stage machine, atau kontrak prompt sesi di luar yang dibutuhkan lead untuk menjawab.

### Risiko yang diterima sadar

**Kode dapat masuk `main` tanpa mata manusia.** Operator memilih tingkat batas "hanya produksi & data yang terkunci", sehingga lead boleh mengintegrasikan hasil kerja agen ke branch utama dan menjalankan migration. Pengamannya sepenuhnya di belakang: jejak keputusan, notifikasi, tombol ambil alih, dan kemampuan membalik lewat git. Syarat minimum sebelum lead boleh mengintegrasikan (mis. bukti test hijau) **belum diputuskan** — lihat Open questions OQ-3.

## User stories

**US-1 — Operator pergi, pekerjaan jalan.** Sebagai operator, saya ingin sesi yang menemui persimpangan tetap mendapat keputusan meski saya tidak di depan layar, supaya backlog tidak diam berjam-jam menunggu kehadiran saya.

**US-2 — Operator membaca ulang keputusan.** Sebagai operator, saya ingin membuka daftar keputusan yang diambil lead hari ini — lengkap dengan pertanyaan aslinya, alasan, dan rujukan yang ia pakai — supaya saya bisa menilai apakah ia memutuskan dengan benar tanpa harus membuka satu per satu terminal.

**US-3 — Operator membatalkan keputusan yang salah.** Sebagai operator, saya ingin menimpa satu keputusan dengan jawaban saya sendiri dan menyuruh sesi yang bersangkutan mengikuti jawaban baru itu, supaya kesalahan lead tidak terus berlanjut sampai selesai.

**US-4 — Operator menyetop lead.** Sebagai operator, saya ingin menghentikan lead — untuk semua project atau satu project saja — kapan pun saya mau mengambil kendali penuh, supaya saya tidak perlu mematikan hanoman untuk merebut kemudi.

**US-5 — Operator diberi tahu untuk yang berbobot.** Sebagai operator, saya ingin diberi tahu saat lead mengambil keputusan berdampak besar atau menandai keputusannya "ragu", supaya saya bisa turun tangan lebih awal — tanpa harus dimintai izin untuk setiap hal kecil.

**US-6 — Sesi internal dijawab tanpa perlu tahu apa-apa.** Sebagai sesi agen yang berhenti bertanya di terminal, saya ingin pertanyaan saya dijawab dan diketikkan ke pane saya, supaya saya bisa lanjut bekerja tanpa perlu mengenal kontrak baru apa pun.

**US-7 — Agen eksternal minta putusan.** Sebagai agen eksternal ber-`AgentToken` yang berjalan di mesin lain, saya ingin memanggil hanoman untuk sebuah keputusan dan menerima jawaban terstruktur berikut rujukannya, supaya saya bisa lanjut bekerja dan memverifikasi sendiri dasar keputusannya.

**US-8 — Agen mendapat konteks yang tak ia punya.** Sebagai sesi yang hanya tahu backlog saya sendiri, saya ingin jawaban lead memuat rujukan ke docs/ADR/keputusan sebelumnya yang relevan, supaya saya tidak mengulang keputusan yang sudah pernah diambil di tempat lain.

**US-9 — Urutan kerja ditata.** Sebagai operator, saya ingin lead menata sendiri backlog mana yang dikerjakan lebih dulu berdasarkan isi pekerjaannya, supaya saya tidak perlu memilih satu per satu setiap pagi.

**US-10 — Tabrakan terdeteksi lebih awal.** Sebagai operator, saya ingin diberi tahu saat dua pekerjaan menyentuh area yang sama sebelum keduanya selesai, supaya saya tidak menemukan konflik integrasi setelah dua sesi sama-sama terlanjur jauh.

**US-11 — Sesi gagal ditindaklanjuti.** Sebagai operator, saya ingin sesi yang mati dengan kode keluar bukan nol atau berhenti dengan plan belum tuntas langsung ditindaklanjuti lead (dilanjutkan atau diulang), supaya kegagalan tidak menumpuk menunggu saya membacanya.

**US-12 — Lead tidak bisa merusak yang tak boleh rusak.** Sebagai operator, saya ingin yakin bahwa apa pun yang lead putuskan, ia tidak dapat menyentuh produksi/VPS atau menghapus data, supaya saya bisa memberinya otonomi penuh tanpa mempertaruhkan hal yang tak bisa dibalik.

**US-13 — Lead yang ragu tetap bergerak.** Sebagai operator, saya ingin lead yang tidak yakin mencari bukti dulu lalu tetap memutuskan dengan opsi yang paling mudah dibatalkan, supaya keraguan tidak berubah jadi mandek yang justru ingin saya hilangkan.

## Acceptance criteria (gaya EARS)

### A. Menjawab keputusan

- **AC-1** — WHEN sebuah agen mengirim permintaan putusan lewat kontrak eksplisit, THE SYSTEM SHALL mengembalikan jawaban terstruktur yang memuat keputusan, alasan, daftar rujukan, dan tingkat keyakinan.
- **AC-2** — WHEN hanoman-lead menghasilkan sebuah keputusan, THE SYSTEM SHALL menuliskan satu baris jejak keputusan sebelum jawaban itu dikirim ke peminta.
- **AC-3** — WHILE hanoman-lead sedang menyusun keputusan untuk sebuah sesi, THE SYSTEM SHALL menandai sesi itu sebagai "sedang diputuskan" pada daftar sesi, sehingga operator tidak salah membacanya sebagai mandek.
- **AC-4** — IF sebuah permintaan putusan tidak dapat dijawab dalam batas waktu yang ditetapkan, THEN THE SYSTEM SHALL mencatat kegagalan itu pada jejak keputusan dan menerbitkan notifikasi, dan sesi peminta SHALL tetap menunggu manusia seperti perilaku hari ini.
- **AC-5** — WHERE sebuah permintaan putusan datang dari agen eksternal, THE SYSTEM SHALL menolaknya dengan 403 bila token pemanggil tidak memiliki capability tulis untuk keputusan, dan capability baca SHALL TIDAK pernah cukup untuk membuat permintaan itu.
- **AC-6** — THE SYSTEM SHALL memuat rujukan yang benar-benar dibaca lead pada setiap jawaban; rujukan yang tidak ada di repo SHALL TIDAK dilaporkan sebagai rujukan.

### B. Deteksi otomatis

- **AC-7** — WHEN sebuah sesi hidup meminta masukan manusia dan lead aktif untuk project itu, THE SYSTEM SHALL menurunkan pertanyaannya tanpa campur tangan manusia. *(Diamandemen SPEC-909/[ADR-0146](../../internal/docs/adr/0146-lead-dipicu-event-hook.md): sumbernya kini **event hook** yang membawa pertanyaan & opsi terstruktur — `AskUserQuestion` untuk claude, akhir-turn untuk codex — bukan lagi "marker keputusan terisi → baca layar pane". Marker tetap ada dan tetap milik pil/notifikasi/pet, tapi ia bukan lagi pemicu lead. Konsekuensi yang diterima sadar: prompt IZIN dan pertanyaan PROSA tanpa tool tak lagi dijemput lead.)*
- **AC-8** — WHEN hanoman-lead telah memutuskan jawaban untuk sesi yang terdeteksi menunggu, THE SYSTEM SHALL mengirimkan jawaban itu ke pane sesi sebagai masukan, dan sesi SHALL melanjutkan pekerjaannya tanpa perubahan apa pun pada prompt atau kontrak sesi.
- **AC-9** — IF marker keputusan berasal dari sesi `codex` yang sebenarnya telah selesai wajar, THEN THE SYSTEM SHALL TIDAK mengirim masukan apa pun ke pane itu.
- **AC-10** — IF sebuah pane sudah mati, THEN THE SYSTEM SHALL TIDAK memperlakukannya sebagai sesi yang menunggu keputusan.
- **AC-11** — THE SYSTEM SHALL membatasi jumlah jawaban otomatis berturut-turut untuk satu sesi; WHEN batas itu tercapai, THE SYSTEM SHALL berhenti menjawab sesi tersebut dan menerbitkan notifikasi.

### C. Denyut proaktif & koordinasi

- **AC-12** — WHILE lead aktif, THE SYSTEM SHALL menjalankan denyut berkala di dalam proses server tanpa menambahkan message queue, worker terpisah, atau cron eksternal.
- **AC-13** — WHEN denyut menemukan backlog siap kerja melebihi kapasitas sesi bersamaan, THE SYSTEM SHALL menyerahkan urutan yang ia putuskan ke antrean dan governor yang sudah ada, dan SHALL TIDAK membuat antrean kedua.
- **AC-14** — WHEN dua pekerjaan aktif terdeteksi menyentuh area kerja yang sama, THE SYSTEM SHALL mencatat temuan itu sebagai keputusan berikut tindakannya (menunda salah satu, menggabungkan, atau membiarkan dengan alasan) dan menerbitkan notifikasi.
- **AC-15** — WHILE lead dijeda untuk sebuah project, THE SYSTEM SHALL TIDAK mengambil keputusan, mengetik ke pane, atau mengubah urutan kerja pada project itu.

### D. Menjaga mutu

- **AC-16** — WHEN sebuah sesi berakhir dengan kode keluar bukan nol, THE SYSTEM SHALL memutuskan tindak lanjutnya (lanjutkan, ulangi, atau hentikan berikut alasan) dan mencatatnya sebagai keputusan.
- **AC-17** — WHEN sebuah sesi berakhir sementara plan-nya masih menyisakan kotak `- [ ]`, THE SYSTEM SHALL memperlakukan pekerjaan itu sebagai belum tuntas dan memutuskan tindak lanjutnya.
- **AC-18** — WHEN hanoman-lead memutuskan melanjutkan pekerjaan yang terputus, THE SYSTEM SHALL memakai jalur lanjutkan-sesi yang sudah ada dan SHALL TIDAK menulis ulang basis review pekerjaan itu.
- **AC-19** — THE SYSTEM SHALL mencatat bukti yang menjadi dasar keputusan integrasi ke branch utama pada jejak keputusan yang bersangkutan.

### E. Saat ragu

- **AC-20** — IF hanoman-lead menilai konteksnya tidak cukup, THEN THE SYSTEM SHALL mengumpulkan bukti terlebih dahulu dari docs Source of Truth, ADR, plan, kode, dan riwayat git sebelum menghasilkan keputusan.
- **AC-21** — IF keraguan tetap ada setelah bukti dikumpulkan, THEN THE SYSTEM SHALL tetap menghasilkan keputusan, memilih opsi yang paling mudah dibatalkan, menandai keputusan itu "ragu", dan menerbitkan notifikasi.
- **AC-22** — THE SYSTEM SHALL TIDAK membiarkan sebuah permintaan putusan berakhir tanpa keputusan hanya karena lead tidak yakin.

### F. Jejak & notifikasi

- **AC-23** — THE SYSTEM SHALL menyimpan setiap keputusan secara permanen berikut waktu, project, peminta, pintu masuk, pertanyaan, jawaban, alasan, rujukan, tingkat keyakinan, dan statusnya.
- **AC-24** — THE SYSTEM SHALL menyajikan jejak keputusan urut waktu dan dapat disaring per project dan per backlog.
- **AC-25** — WHEN hanoman-lead mengambil keputusan yang tergolong berbobot, THE SYSTEM SHALL menerbitkan notifikasi yang bersifat memberi tahu, dan SHALL TIDAK menahan pekerjaan menunggu tanggapan operator.
- **AC-26** — THE SYSTEM SHALL menyediakan jejak keputusan lewat mekanisme polling HTTP dan SHALL TIDAK menambah kanal WebSocket baru.

### G. Kendali manusia

- **AC-27** — WHEN operator menekan Pause pada lead, THE SYSTEM SHALL menghentikan pengambilan keputusan baru dalam ≤ 5 detik, sementara sesi yang sedang berjalan SHALL tetap berjalan.
- **AC-28** — WHEN operator menimpa sebuah keputusan, THE SYSTEM SHALL menandai keputusan lama sebagai ditimpa, menyimpan jawaban operator sebagai keputusan yang berlaku, dan menyampaikan jawaban baru itu ke sesi yang bersangkutan bila sesi itu masih hidup.
- **AC-29** — THE SYSTEM SHALL memungkinkan operator menginterupsi dan menyetir sesi yang sedang dipimpin, dengan perilaku yang sama seperti sesi yang tidak dipimpin.
- **AC-30** — THE SYSTEM SHALL menyalakan lead hanya secara opt-in; WHILE master switch lead mati, THE SYSTEM SHALL berperilaku persis seperti hanoman sebelum PRD ini.

### H. Batas keras

- **AC-31** — THE SYSTEM SHALL TIDAK memberi hanoman-lead kemampuan melakukan deploy, menjalankan perintah pada VPS, membuka konsol VPS, atau menyentuh data produksi — dalam keadaan apa pun, termasuk saat operator memintanya lewat konfigurasi.
- **AC-32** — THE SYSTEM SHALL TIDAK memberi hanoman-lead kemampuan menghapus project, backlog, branch, worktree, notifikasi, atau baris jejak keputusan.
- **AC-32a** — WHEN hanoman-lead menghentikan sebuah sesi, THE SYSTEM SHALL membiarkan worktree sesi itu utuh, sehingga pekerjaan yang belum di-commit tidak hilang dan sesi masih dapat dilanjutkan. Penghapusan worktree yang menyertai penutupan sesi oleh operator SHALL tetap berlaku seperti hari ini.
- **AC-33** — IF sebuah keputusan lead mensyaratkan tindakan yang terkunci, THEN THE SYSTEM SHALL menolak tindakan itu, mencatat penolakannya pada jejak, dan menerbitkan notifikasi kepada operator.
- **AC-34** — THE SYSTEM SHALL menegakkan batas keras pada permukaan tindakan lead di sisi server, dan SHALL TIDAK menegakkannya dengan memasang hook penolak perintah pada sesi agen pekerja.

### I. Non-fungsional

- **AC-35** — WHEN lead menjawab sebuah permintaan putusan, THE SYSTEM SHALL menyelesaikannya dalam batas waktu yang ditetapkan sehingga sesi tidak menunggu lebih lama daripada perilaku hari ini.
- **AC-36** — THE SYSTEM SHALL menyimpan jejak keputusan pada basis data SQLite yang sudah dipakai hanoman, lewat migration yang ditulis tangan dan disertai ADR.
- **AC-37** — THE SYSTEM SHALL memastikan kegagalan hanoman-lead — termasuk saat proses agennya mati atau kuota habis — tidak menghentikan sesi yang sedang berjalan; sesi SHALL kembali ke perilaku menunggu manusia seperti sebelum PRD ini.

## Metrik sukses

| # | Metrik | Cara ukur | Baseline | Target versi pertama |
|---|--------|-----------|----------|----------------------|
| M1 | **Waktu tunggu keputusan** | Selisih waktu marker keputusan terisi / permintaan putusan masuk → jawaban tersampaikan. Diambil dari jejak keputusan. | Hari ini = waktu sampai operator membuka terminal (bisa berjam-jam; tak terukur) | Median ≤ 2 menit; p90 ≤ 5 menit |
| M2 | **Backlog maju saat operator tidak hadir** | Jumlah backlog yang berubah stage atau selesai selama periode ≥ 8 jam tanpa sesi login operator | ≈ 0 | ≥ 1 backlog selesai per periode tidak-hadir, tanpa sesi mandek tersisa |
| M3 | **Tingkat override** | Keputusan yang ditimpa/dibatalkan operator ÷ total keputusan, per minggu | Tidak berlaku (belum ada keputusan mesin) | ≤ 10% ditimpa; ≤ 2% menyebabkan kerja harus diulang |
| M4 | **Mutu tidak turun** | Tiga angka dibanding 4 minggu sebelum lead menyala: (a) sesi berakhir dengan kode keluar bukan nol, (b) backlog yang harus dikerjakan ulang, (c) integrasi yang berkonflik | Diukur dari `SessionHistory`, riwayat stage, dan riwayat integrasi | Tidak ada dari ketiganya naik > 10% |
| M5 | **Jangkauan** *(pendukung)* | Porsi permintaan keputusan yang dijawab lead vs jatuh kembali ke manusia | Tidak berlaku | ≥ 90% dijawab lead |
| M6 | **Keterbacaan jejak** *(pendukung)* | Porsi keputusan yang memuat ≥ 1 rujukan sah ke dokumen/ADR/plan/commit yang benar-benar ada | Tidak berlaku | ≥ 95% |

Metrik gagal yang membatalkan asumsi PRD ini: **M3 > 25%** (lead lebih sering salah daripada benar → tingkat batas otonomi harus ditinjau ulang) atau **M4 naik > 25%** pada salah satu dari tiga angkanya (mutu benar-benar turun tanpa gerbang manusia).

## Open questions

- **OQ-1 — Agen apa yang menjalankan lead, dan berapa ongkosnya?** Lead sendiri adalah agen (`claude` atau `codex`) dengan model & effort tertentu. Belum diputuskan: apakah ia mengikuti `Setting.agent` global, punya setelan sendiri seperti sesi konflik (ADR-0081), dan bagaimana konsumsi kuotanya diperhitungkan terhadap limit langganan yang sudah dipantau hanoman.
- **OQ-2 — Frekuensi & anggaran denyut.** Seberapa sering denyut proaktif berjalan, dan apakah ia berhenti sendiri saat tak ada pekerjaan supaya tidak membakar kuota saat idle.
- **OQ-3 — Syarat minimum sebelum lead mengintegrasikan ke `main`.** Operator memilih agar integrasi tidak terkunci. Belum diputuskan apakah tetap ada syarat objektif (mis. test yang tersentuh hijau, plan tak menyisakan `- [ ]`, tidak ada konflik) sebelum lead boleh menekan tombol itu — atau memang tanpa syarat.
- **OQ-4 — Migration oleh lead.** Aturan repo menuntut perubahan skema disertai migration **dan ADR**. Belum diputuskan apakah lead boleh menulis ADR-nya sendiri, dan apakah menjalankan migration pada basis data lokal operator termasuk "boleh" tanpa syarat.
- **OQ-5 — Definisi "putusan berbobot".** Apa persisnya yang memicu notifikasi: integrasi ke `main`, migration, penghentian sesi, keputusan bertanda "ragu", atau daftar eksplisit lain.
- **OQ-6 — Retensi jejak keputusan.** Apakah jejak disimpan selamanya (dan tumbuh terus), atau dipangkas setelah periode tertentu. Berkaitan dengan AC-32 yang melarang lead menghapusnya — pemangkasan, bila ada, jadi wewenang siapa.
- **OQ-7 — Perambatan override ke pekerjaan yang terlanjur jalan.** Bila operator membatalkan keputusan setelah sesi mengerjakannya beberapa langkah, apa yang terjadi pada pekerjaan itu: dilanjutkan dengan koreksi, diulang dari awal, atau diserahkan ke operator.
- **OQ-8 — Tabrakan lead vs operator.** Apa yang terjadi bila operator dan lead menjawab pertanyaan yang sama hampir bersamaan; siapa yang menang dan bagaimana yang kalah dicatat.
- **OQ-9 — Cara lead menurunkan "area kerja".** Deteksi tabrakan menuntut definisi area kerja (berkas yang disentuh? modul? paket?) dan sumbernya (diff berjalan, plan, atau isi backlog).
- **OQ-10 — Batas atas keputusan otomatis.** Angka konkret untuk AC-11 (berapa jawaban berturut-turut per sesi sebelum lead berhenti) belum ditetapkan.
- **OQ-11 — Rahasia & kredensial.** Apakah lead boleh menjawab pertanyaan yang menuntut ia membaca kredensial (token, kunci VPS, kredensial Claude). Aturan hari ini: kredensial tak pernah ke client maupun DB — jejak keputusan adalah DB.
- **OQ-12 — Nomor ADR.** ADR amandemen ADR-0035 belum bernomor. Nomor tertinggi di checkout ini adalah 0088, tetapi nomor wajib dienumerasi lintas semua branch dan worktree tepat sebelum diklaim (ADR-0021).
- **OQ-13 — Perilaku lead terhadap sesi dokumen.** Sesi PRD/audit/reverse/scaffold tidak punya plan berkotak `- [ ]` dan tidak punya fase Execute. Belum diputuskan apakah lead memimpin sesi dokumen dengan kriteria mutu yang berbeda, atau melewatinya di versi ini.
- **OQ-14 — Nasib "manusia terakhir yang memutuskan" di dokumen produk.** Prinsip itu tertulis di beberapa dokumen Source of Truth dan skill project; belum diputuskan apakah ia diganti seluruhnya atau dipertahankan sebagai default untuk project yang tidak menyalakan lead.
