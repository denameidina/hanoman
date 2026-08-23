# ADR-0146 — Pintu deteksi hanoman-lead dipicu event hook, bukan denyut

Tanggal: 2026-08-23 · Status: diterima · SPEC-909
Sumber: spec [`docs/superpowers/specs/2026-08-23-spec-909-lead-dipicu-event-askuserquestion-design.md`](../../../docs/superpowers/specs/2026-08-23-spec-909-lead-dipicu-event-askuserquestion-design.md),
audit [`docs/superpowers/audits/2026-08-23-spec-909-latensi-event-vs-denyut.md`](../../../docs/superpowers/audits/2026-08-23-spec-909-latensi-event-vs-denyut.md)

**Mengamandemen [ADR-0091](0091-hanoman-lead-agen-pemimpin.md)** pada §5 (dua irama → satu irama
rumah tangga + satu jalur event) dan pada §2 pintu #2 (lead tak lagi menyimpulkan pertanyaan claude
dari layar). **Menegakkan** [0024](0024-sesi-interaktif-menggantikan-run.md) (jumlah timer
BERKURANG; tanpa queue/worker/cron), [0039](0039-realtime-lewat-websocket-siar.md) (tanpa kanal WS
baru), [0102](0102-lead-multi-select-dan-rantai-keputusan.md) (`LeadFlow` & rantai utuh),
[0142](0142-inbox-keputusan-dialog-sesi.md) (`screenHash`/`deciding`/`answering`),
[0143](0143-menunggu-keputusan-keadaan-turunan.md) (arti & pemilik marker tak disentuh),
[0037](0037-cabut-guardrail-safety.md) (batas keamanan tetap worktree),
[0065](0065-ai-agent-capability-agent-token.md) (peta route→capability),
[0087](0087-distribusi-npm-global-satu-perintah.md) (dashboard boleh lebih baru dari server).
**Tidak mencabut** apa pun.

## Konteks

Pintu deteksi lead (`services/lead/detect.ts` `scanAndAnswer`) adalah **pemindai**, bukan penerima
event: `startLead` memasang `setInterval` 5 detik dan tiap putaran menyapu semua sesi hidup —
`liveDecisions()` + `markerFilled()` + satu `capture-pane` per sesi untuk `readDialogScreen`.

Padahal sinyalnya sudah lahir sebagai event, lalu **diturunkan jadi jejak di disk**: hook
`Notification` claude dan `Stop` codex cuma menjalankan `date +%s > <marker>`, dan pemindai
berikutnya yang memungutnya.

Yang selama ini dibicarakan hanya setengah tick. Pengukuran SPEC-909 menemukan **lapis kedua yang
lebih besar dan lebih tua**: hook `Notification` bukan hook `AskUserQuestion` — ia menembak dari
pengait **idle 6 detik** yang dipasang tiap dialog (mekanisme yang sudah dinamai SPEC-452). Terukur
dua kali, dua bentuk dialog, stempel di dalam hook itu sendiri: **6 071 ms** dan **6 023 ms** dari
`PreToolUse(AskUserQuestion)` ke `Notification`. Setengah tick menumpuk **di atasnya**.

Tiga biaya lain berasal dari keputusan yang sama: `capture-pane` per sesi hidup tiap 5 detik saat
tak ada yang bertanya (6,28 ms/panggilan, `execFileSync` memblokir event loop — SPEC-479 temuan E,
jalur yang sudah terbukti merusak latensi ketik terminal SPEC-856/860/878); pertanyaannya harus
DITEBAK dari layar (sebab kotak jawab pet menyerah dengan "Pertanyaannya tak terbaca dari sini");
dan rantai dijalankan dengan menunggu layar berganti (`CHAIN_POLL_TRIES` 20 + `CHAIN_END_TRIES` 5),
padahal vonis "rantainya tuntas" itu mengosongkan marker dan marker sebuah dialog hanya terisi
sekali (SPEC-474).

## Keputusan

### 1 · Hook `PreToolUse` ber-matcher `AskUserQuestion` MENGIRIM, bukan menulis berkas

`guardSettings()` mendapat entri ketiga; `codexHookArgs()` mendapat perintah `Stop` kedua. Satu
definisi (`EVENT_HOOK_COMMAND`) dipakai kedua mesin — dua penulis perintah yang tak sepakat adalah
kelas kegagalan SPEC-431/448, dan di sini selisih satu header berarti separuh sesi diam tanpa satu
pun error.

**Marker keputusan tak disentuh.** Penulisnya (`Notification`/`Stop`) dan ketiga pengosongnya tetap
persis seperti sebelumnya; ADR-0141/0143 utuh. Yang ditambahkan adalah **kanal kedua**, bukan
pengganti.

### 2 · Kredensialnya token turunan HMAC per sesi, dan verifikasinya stateless

`HANOMAN_EVENT_TOKEN = base64url(HMAC(HMAC(secretKey(), "hanoman:session-event:v1"), sessionId))`.
Sub-kunci menjaga pemisahan domain dari enkripsi at-rest (ADR-0097). Turunan, bukan
acak-lalu-disimpan, karena itu membeli tiga hal: tak ada registry yang harus dihidrasi ulang sesudah
restart, tak ada round-trip tmux di jalur panas, dan sesi yang lahir sebelum restart tetap bisa
mengirim event.

Tiga gerbang berurutan: token cocok dengan turunan `sessionId` (**id sesi saja tak pernah cukup**) →
sesinya hidup → batas laju. Token lewat **env sesi**, bukan argv `--settings`.

### 3 · Batas laju & idempotensi dari agennya sendiri

Kunci idempotensi `tool_use_id` (claude) / `turn_id` (codex) — unik per panggilan, dan bukan hash
payload (dua panggilan berbeda bisa berisi sama persis). Ember token per sesi kapasitas 5, isi ulang
1/10 dtk (≤ 6/menit); ember global 20 @ 2/dtk. Badai SPEC-472 (152 percobaan / 13 menit ≈ 11,7/menit)
tak muat. Ditolak batas laju **tidak** dihitung sebagai kegagalan lead, alasan yang sama dengan
`LeadBusyError` (SPEC-479): ia hilang dengan menunggu.

### 4 · `POST /api/session-events` — prefix sendiri, auth sendiri

Bukan sub-path `/api/lead`: `capabilityForRoute` memetakan seluruh prefix `lead` ke `rw("lead")`,
jadi di sana setiap agent token pemegang `lead:write` bisa **memalsukan pertanyaan** atas nama sesi
mana pun dan menggerakkan lead. `session-events` dipetakan eksplisit ke `COOKIE_ONLY`, dan gate
cookie mem-bypass path-nya — pola yang sama dengan `/api/sync` (device token) dan `/api/help`.

`classifyIngress` **tidak disentuh**: ia menilai `Host`, dan `Host` dikendalikan pemanggil, jadi
mengistimewakan `127.0.0.1` di sana akan membuka permukaan control lewat reverse proxy publik. Sesi
menerima `HANOMAN_EVENT_HOST` = host control pertama saat origin dipisah, dan hook mengirimkannya
sebagai header `Host` di atas koneksi **loopback** — tanpa DNS, tanpa TLS.

### 4b · Sesi ber-SANDBOX tak terjangkau, dan itu dinyatakan alih-alih disembunyikan

Profil production ADR-0117 menjalankan sesi di dalam `podman run --network <bridge>`
(`services/session-sandbox.ts`), sementara server WAJIB bind loopback host. Di dalam container
`127.0.0.1` adalah loopback **container**, dan `NO_PROXY=localhost,127.0.0.1,::1` memastikan curl tak
mencoba egress proxy — jadi hook di sana **tak akan pernah** mencapai server. (Penghalang kedua,
`curl` yang absen dari `agent.Containerfile`, ditutup ADR ini; yang pertama tidak.)

Menutupnya menuntut server yang terjangkau dari jaringan sesi — melebarkan bind dari loopback, yaitu
keputusan keamanan tersendiri dengan ADR-nya sendiri. Yang dilakukan di sini adalah **berhenti
berbohong tentangnya**: sesi ber-sandbox sengaja TIDAK menyandang `@hanoman_event_hook`, sehingga
jalur "sesi tanpa jalur event" (keputusan 10) menotifikasinya sekali alih-alih membiarkannya
menggantung senyap. Tanpa itu penandanya sendiri yang mematikan satu-satunya peringatan yang tersisa.

### 5 · `scanAndAnswer` → `admitAsk` + antrean berpekerja

Seluruh pagar tahap 1 pindah UTUH ke `admitAsk(sessionId)`, dinilai satu sesi per event: opt-in ·
`leadActive` (AC-15/27/30) · `exited` (AC-10) · `maxAutoAnswers` + baris `capped` + notifikasi
(AC-11) · `FAIL_COOLDOWN_MS` · `failCapped` (SPEC-472/487). Kalimat, `kind`, dan `weighty` baris
jejaknya tak berubah sehuruf pun — pagar yang masih menggigit harus menggigit dengan bunyi yang sama.

Batas konkurensi lintas sesi yang dulu diberikan `runPool(ready, cfg.maxConcurrent)` kini diberikan
kolam pekerja berukuran sama di `lead/ask.ts`; yang berubah cuma umur antreannya. **Satu sesi = satu
pekerjaan**: event yang tiba selagi sesi itu dikerjakan menimpa "yang tertunda" (terbaru menang) dan
dijalankan sesudahnya — itulah yang membuat "event kembar tak melahirkan dua keputusan paralel"
benar secara KONSTRUKSI, bukan lewat penjagaan yang harus diingat.

### 6 · Yang TETAP digerakkan layar, dinyatakan apa adanya

Terukur: **satu panggilan `AskUserQuestion` = satu event**, betapa pun banyak pertanyaannya (3
pertanyaan → 1 event, `questions.length = 3`, `multiSelect` per pertanyaan terbawa). Maka
`CHAIN_END_TRIES` dan `settledPane()` **dicabut** — keduanya ada semata untuk menebak angka itu.

Yang tersisa dari layar tinggal tiga, semuanya di DALAM satu rantai yang sudah dipicu event, untuk
sesi yang sudah pasti bertanya:

1. `waitDialog` — `PreToolUse` menembak **sebelum** tool-nya jalan, jadi dialognya belum tergambar.
2. `waitScreenChange` — tak ada event di antara tab satu dialog.
3. `afterLastAnswer` — apakah dialognya menutup sendiri atau menyisakan layar rekap.

### 7 · Codex: padanan yang LEBIH KUAT dari sebelumnya

Payload `Stop` codex membawa **`last_assistant_message`** — teks penuh giliran terakhir, tanpa
dipotong lebar pane (pane sesi di mesin dev 52 kolom). Gerbang "codex benar-benar bertanya"
(`ASK_SIGNALS`/`CODEX_FINISHED`) karena itu dinilai atas pesan itu, bukan atas `capture-pane`.
Ambangnya tak berubah, jadi cakupan codex setara — bukan lebih longgar — dengan nol invokasi tmux.

### 8 · Pet menerima payload lewat siaran yang SUDAH ada

Grup `leadAsks` di `services/events.ts` `GROUPS` (`everyTicks: 1`, dedup signature seperti tujuh grup
lain). Membaca peta di memori: nol I/O, nol tmux, nol DB per tick. Grup sendiri, bukan hiasan di
`sessions`: frame itu sudah yang terbesar di dashboard.

`state` diturunkan dari `queuedIds()`/`decidingIds()` yang sudah ada, supaya "mengantre" dan
"menyusun" tak pernah punya dua definisi. `PetAnswer` memakai payload sebagai sumber **pertanyaan**
dan tetap memakai scrape untuk **cara menjawabnya** (`screenHash` + nomor baris) — pagar SPEC-899
berdiri utuh.

### 9 · Ambil alih: satu penjaga sinkron menentukan pemenang

`POST /api/terminal/sessions/:id/dialog/takeover`, di bawah prefix `terminal` supaya capability-nya
turun dari peta yang sudah ada (`sessions:write`, sama dengan menjawab dialog). Pemenangnya
ditentukan `beginAnswer()` — `Set` yang sama yang mencegah dua POST manusia menyilangkan keystroke
(ADR-0142 §5) — dan **jalur lead kini ikut masuk ke dalamnya**. Takeover sebelum lead memegang pane
→ `202`, lead batal sebelum satu byte keluar; sesudah → `409 answering`. Jawaban operator tanpa
takeover selagi lead memutuskan tetap `409 deciding`, persis seperti sebelumnya.

### 10 · Sesi pra-pembaruan: TIDAK dilayani, dan dikatakan

Menyisakan pemindai "hanya untuk sesi lama" berarti mempertahankan persis biaya yang dicabut ADR
ini, untuk populasi yang menyusut sendiri. Sesi ditandai saat lahir dengan opsi window tmux
`@hanoman_event_hook`; sesi hidup ber-marker terisi tanpa penanda itu melahirkan **satu** notifikasi
seumur sesi (dedup lewat `key` unik di DB — pane mati bertahan berhari-hari sementara `Set` memori
kosong tepat sesudah restart, gotcha 2 ADR-0091).

### 11 · Engine: satu irama rumah tangga, nol untuk pertanyaan

`TICK_MS` 5 000 → `HOUSEKEEPING_MS` **60 000**, isinya tinggal `expireFlows`, `pruneAsks`,
sesi pra-pembaruan, dan jatuh tempo `pulse`. `scanAndAnswer` tak dipanggil dari timer mana pun lagi;
`busyDetect` dicabut bersamanya. **Jumlah timer berkurang, bukan bertambah.**

## Bukti

| | sebelum | sesudah |
|---|---|---|
| `AskUserQuestion` → lead mulai menyusun (sesi diam) | ≥ 6 023 ms, harapan ≈ 8 550 ms, tak berbatas saat `busyDetect` dipegang | **32 / 46 / 164 ms** (median 46) |
| `capture-pane` saat tak ada yang bertanya | 1 per sesi hidup per 5 dtk | **0** |
| stall agen oleh hook | 0 | 14–49 ms sehat · 0,01 dtk server mati · 2,01 dtk menggantung (`-m 2`) |

Ikut terjaring saat mengukur: satu `LeadFlow` ber-`steps = 3` dengan tiga `LeadDecision` ber-`flowId`
sama (ADR-0102 utuh di produksi, tanpa satu pun tebakan atas layar); `Bearer` salah → 401 dan
`Bearer` benar + sesi mati → 404, live. Angka lengkap & harness di audit.

## Alternatif yang ditolak

- **Menyisakan pemindai khusus sesi pra-pembaruan.** Mempertahankan seluruh biaya yang dicabut ADR
  ini (`capture-pane` per sesi per 5 dtk, `execFileSync` yang memblokir event loop) demi populasi
  yang menyusut sendiri — dan populasi itu bisa kosong berhari-hari sementara timernya tetap jalan.
- **Menaruh endpoint di `/api/lead`.** Prefix itu dipetakan `rw("lead")`, jadi agent token pemegang
  `lead:write` bisa memalsukan pertanyaan atas nama sesi mana pun. Peniruan identitas bukan
  capability.
- **Memberi `classifyIngress` pengecualian loopback.** `Host` dikendalikan pemanggil, jadi reverse
  proxy publik yang meneruskan `Host: 127.0.0.1` akan membuka seluruh permukaan control — persis
  pemisahan yang gerbang itu ada untuk menegakkan (SPEC-805).
- **Menutup rantai antar-panggilan dengan menunggu layar.** Itu `CHAIN_END_TRIES` dengan nama lain,
  dan vonisnya mengosongkan marker yang hanya terisi sekali. Panggilan berikutnya tiba sebagai event
  berikutnya; tak ada yang perlu ditunggu.
- **Menyimpan tanya hidup sebagai baris DB.** Ia berumur satu episode dan mati bersama proses lead —
  baris yang tertinggal sesudah restart akan berbohong selamanya (alasan yang sama dengan
  `lead/deciding.ts`). Ongkosnya migration + dampak sync untuk keadaan yang tak boleh awet.
- **Payload dikirim setelah di-`jq`.** Hook tak boleh menuntut biner yang belum tentu terpasang, dan
  bentuk payload adalah kontrak agen yang bertambah field tiap rilis. Server yang memarsenya.

## Konsekuensi

**Diterima sadar:**

- **Prompt IZIN dan pertanyaan PROSA biasa tak lagi dijemput lead.** Keputusan operator, dinyatakan
  di brief. Marker, pil, notifikasi, dan panel pet tetap menyalakannya — yang hilang hanya jawaban
  otomatisnya. Tak ada hook lain yang menutup kedua kasus itu tanpa menghidupkan pemindaian: satu-
  satunya sinyal untuk prompt izin adalah `Notification` yang sama, dan ia sudah dipakai marker.
- **Stall ≤ 2 detik pada agen** saat server menggantung — dibayar tepat sebelum sesi menunggu manusia.
- **`curl` jadi prasyarat runtime** bagi jalur event. Ditambahkan ke `hanoman doctor` sebagai
  peringatan yang menyebut akibatnya, bukan sebagai fatal: tanpanya hook tetap `exit 0` dan tak
  pernah memblokir agen, tapi lead berhenti menerima pertanyaan **tanpa satu pun error di mana pun**.
- **Sesi yang sudah berjalan saat server di-update tak dilayani lead** (keputusan 10).
- **Token bisa dibaca sesi tetangga se-uid.** Semua sesi berjalan sebagai uid yang sama dan env ikut
  ke argv `sh -c` yang melahirkan pane. Itu batas yang sama yang sudah diterima ADR-0037; ADR ini
  menyatakannya alih-alih berpura-pura menutupnya. Yang ditutup token ini nyata: pemanggil **tanpa**
  kredensial apa pun tak punya jalan masuk, dan sesi yang tak berniat mencuri tak bisa memalsukan
  pertanyaan hanya karena kebetulan tahu id sesi tetangganya.

- **Token tak punya kedaluwarsa dan tak bisa dicabut,** dan karena id sesi spec deterministik ia
  **stabil lintas kelahiran-ulang** sesi itu. Rotasinya berarti merotasi `secret.key`, yang juga
  memegang enkripsi at-rest RuntimeConfig — jadi tak ada pencabutan per sesi. Diterima karena
  jangkauan yang dilindunginya sudah dibatasi hal lain: sesi harus HIDUP (404 kalau tidak), ember
  token mengikat, dan `maxAutoAnswers` mengunci sesi sesudah 3 percobaan.
- **Permukaan terimanya bukan cuma loopback.** Terukur: `Host` = origin **publik** → 404
  (`publicPath()` menolak seluruh `/api/…` selain health & help), tapi `Host` = origin **control** →
  sampai ke handler. Di VPS host control ada di balik reverse proxy yang menghadap internet, jadi
  yang menutup pintunya adalah token, bukan topologi. Itu memang desainnya — dinyatakan di sini
  supaya tak ada yang mengira ada lapis kedua.
- **Body diparse sebelum kredensial dicek** untuk route yang di-bypass (Fastify memparse body
  sesudah `onRequest`). Sama seperti `/api/sync`. Ongkosnya dibatasi `bodyLimit` 1 MiB dan — sejak
  pagar biaya `parseHookEvent` — linear.

**Gotcha yang mahal kalau dilupakan:**

1. **`PreToolUse` menembak SEBELUM tool-nya jalan.** Dialognya belum ada di layar saat event tiba.
   Urutannya karena itu `decide()` dulu (detik sampai menit), baru `waitDialog` — menunggunya
   praktis gratis. Dan `waitDialog` yang habis berarti **BATAL**, bukan jatuh ke jalur prosa:
   `sendToPane` akan mengetik prosa + `Enter` ke kolom chat yang sudah normal, persis pesan liar
   yang SPEC-487 ukur (6 dari 22 keputusan, satu di antaranya ke sesi yang sudah bekerja 91 menit).
2. **Hook `PreToolUse` berkode keluar 2 MEMBLOKIR tool-nya.** `exit 0` tanpa syarat bukan kerapian,
   ia syarat: server mati tak boleh berarti agen tak bisa bertanya. Dan stdout hook `type:"command"`
   dibaca claude sebagai kendali izin — wajib dibuang.
3. **`submitPaneDialog` fail-closed untuk layar yang bukan rekap, dan dialog SATU pertanyaan claude
   tak pernah menampilkan layar rekap.** Menekan Submit tanpa syarat di ujung rantai membuat kasus
   PALING UMUM dilaporkan `gagal`: marker tak dikosongkan, `answers` tak naik, `failures` naik, dan
   sesudah `maxAutoAnswers` dialog yang sehat sesi itu kena `failCapped` + notifikasi "gagal
   berturut-turut" padahal semua jawabannya mendarat. Keberadaan layar rekap harus DIBUKTIKAN.
4. **Panggung fixture yang tak pernah BERAKHIR menyembunyikan gotcha 3.** Test rantai wajib berakhir
   seperti TUI sungguhan — menutup sendiri atau menyisakan layar rekap.
5. **`beginAnswer()` kini dipakai lead DAN manusia.** Melewatkan salah satunya mengembalikan dua
   penulis pane yang bisa menyilangkan keystroke jadi sampah yang tak bisa ditarik kembali — dan
   sejak keputusan 9 keduanya memang bisa aktif bersamaan.
6. **Penanda sesi pra-pembaruan adalah opsi window tmux, bukan berkas.** Sumber kebenaran sesi tetap
   tmux, jadi ia selamat dari restart server tanpa registry apa pun.
7. **Penghitung sesi mati wajib dipangkas dari DUA tempat.** Id sesi spec deterministik dan bisa
   LAHIR LAGI: sesi yang mati lalu dilahirkan ulang tanpa satu pun event di antaranya akan mewarisi
   `answers`/`failures` nyawa sebelumnya, dan AC-11 menutupnya sebelum ia sempat bertanya sekali pun.
   Intake memangkas, dan tick rumah tangga memangkas lagi — dulu `sweep()` tiap 5 detik yang
   melakukannya.
8. **`clip()` WAJIB memotong sebelum merapikan.** `s.replace(/\s+$/g, "").slice(0, max)` menjalankan
   regex atas string PENUH, dan `/\s+$/` pada whitespace yang tak berakhir di ujung adalah
   backtracking KUADRATIK — terukur 556 ms @ 30 kB, 2 195 ms @ 60 kB, ekstrapolasi ±11 menit pada
   batas body 1 MiB, sinkron, **di depan ember token**. Satu request membekukan seluruh event loop.
9. **Yang dibatasi JUMLAH, bukan panjang.** Teks kepanjangan DIPOTONG (`clip`); menolaknya membuat
   pertanyaan sah yang kebetulan panjang hilang diam-diam dan sesinya menggantung. Jumlah tak boleh
   diperlakukan begitu — terukur, satu payload 863 kB dengan 46 000 opsi melahirkan prompt agen
   627 kB (satu elemen argv; `MAX_ARG_STRLEN` Linux 128 kB), frame siar 863 kB yang
   di-`JSON.stringify` ulang TIAP DETIK, dan kolom jejak 403 kB.
10. **`clearTakeover` harus di BAWAH gerbang `running`.** Pemicu event milik SESI, bukan operator:
   event kedua yang tiba selagi lead masih di tengah rantai akan mencabut takeover yang baru saja
   dimenangkan operator, dan kendali kembali ke lead tanpa satu pun pesan.
11. **Kotak jawab pet harus lahir untuk kondisi `deciding`, bukan hanya `waiting`.** `sessionKind`
   memberi tiap sesi tepat SATU kondisi dan `deciding` menang; sejak pertanyaan tiba sebagai event,
   `deciding` menyala ±50 ms sesudah agen bertanya sementara marker baru ±6 detik kemudian. Kotak
   yang hanya digantung di `waiting` karena itu tak pernah muncul di jendela yang justru dituju AC-6.
   Test yang me-render `PetAnswer` langsung tak bisa melihat ini — gerbangnya ada di `HanomanPet`.
12. **`DATABASE_URL` ambient menang atas `HANOMAN_HOME`.** Harness pengukuran yang hanya menyetel
   `HANOMAN_HOME` akan menyentuh database dev sungguhan (terjadi saat mengukur ADR ini; lihat audit
   §7). Bersihkan `DATABASE_URL`/`HANOMAN_DATABASE_URL` bersama `HANOMAN_CONTROL_ORIGINS`/`NODE_ENV`.
