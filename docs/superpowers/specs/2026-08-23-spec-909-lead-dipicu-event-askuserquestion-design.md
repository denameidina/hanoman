# hanoman-lead dipicu event `AskUserQuestion`, bukan denyut 5 detik

Tanggal: 2026-08-23 · Sumber: brief · Prioritas: tinggi · Backlog **SPEC-909** (project `hanoman`)
· **ADR-0146** (lihat §4).

Seluruh angka di dokumen ini diukur 2026-08-23 pada mesin dev ini — claude **2.1.240**,
codex-cli **0.147.0**, tmux **3.7b** — dengan menjalankan agen sungguhan di pane tmux, bukan
diperkirakan. Bahan mentahnya di §6.

## 1. Masalah

Pintu deteksi hanoman-lead (SPEC-409/ADR-0091, `services/lead/detect.ts` `scanAndAnswer`) adalah
**pemindai**, bukan penerima event. `startLead` memasang `setInterval` 5 detik
(`lead/engine.ts:17,116`) dan tiap putaran menyapu semua sesi hidup: `liveDecisions()` +
`markerFilled(decisionFile)` + — sejak SPEC-487 — satu `capture-pane` per sesi hidup untuk
`readDialogScreen`, lalu `readPaneQuestion` (`detect.ts:245-296`).

Sinyalnya sudah lahir sebagai event, lalu **diturunkan jadi jejak di disk**: hook `Notification`
claude (`runner/src/settings.ts:19`) dan hook `Stop` codex (`runner/src/codex-settings.ts:41`)
hanya menjalankan `date +%s > <marker>`, dan pemindai berikutnya yang memungutnya.

### 1.1 Latensi tunggunya dua lapis, dan lapis pertama tak pernah diukur

Yang selama ini dibicarakan hanya setengah tick (≤ 5 dtk). Pengukuran hari ini menemukan lapis
kedua yang lebih besar dan lebih tua: **hook `Notification` claude bukan hook `AskUserQuestion`**.
Ia menembak dari pengait **idle 6 detik** yang dipasang tiap dialog (mekanisme yang sudah dinamai
SPEC-452), jadi marker baru terisi enam detik sesudah agen benar-benar bertanya.

Diukur dua kali, dua bentuk dialog, stempel `Time::HiRes` di dalam hook itu sendiri:

| panggilan | `PreToolUse(AskUserQuestion)` → `Notification` |
|---|---|
| 1 pertanyaan | **6 071 ms** |
| 3 pertanyaan | **6 023 ms** |

Anggaran tunggu hari ini, di sesi diam, tanpa beban:

```
t=0        agen memanggil AskUserQuestion
t≈6,05 s   hook Notification menembak → marker terisi        ← lapis 1 (baru terukur)
t≈6,05 s + U(0,5 s)   tick berikutnya melihatnya             ← lapis 2 (½ tick, E=2,5 s)
```

**Lantai ≈ 6,05 dtk · harapan ≈ 8,55 dtk · plafon tak berbatas** saat `busyDetect`
(`engine.ts:23`) dipegang satu rantai lain — pada anggaran penuh satu sesi boleh memegang pintu
ini puluhan menit (angka SPEC-479: 60,6 menit).

### 1.2 Beban tetap saat tak ada yang bertanya

Gerbang kedua `scanAndAnswer` (`detect.ts:245-246`) memanggil `capturePane` untuk **setiap sesi
hidup ber-marker kosong, tiap 5 detik**. `tmux()` memakai `execFileSync` dan karena itu
**memblokir event loop** — 6,28 ms/panggilan terukur di SPEC-479 temuan E, dan jalur pemblokiran
yang sama sudah terbukti merusak latensi ketik terminal (SPEC-856/860/878, sampai 916 ms saat
mesin sibuk).

### 1.3 Pertanyaannya ditebak dari layar, padahal event membawanya terstruktur

`readPaneQuestion`/`readDialogScreen` men-*scrape* pane. Itulah sebab kotak jawab pet bisa
menyerah dengan `"Pertanyaannya tak terbaca dari sini"` (`src/src/screens/PetAnswer.tsx:16`).
Payload `PreToolUse` membawa pertanyaan, header, deskripsi opsi, dan `multiSelect` **apa adanya**
(§6.1) — bukti yang lebih kuat dari tangkapan layar 52 kolom, dan gratis.

### 1.4 Rantai dijalankan dengan menunggu layar berganti

`runChain` memakai `CHAIN_POLL_MS` 300 × `CHAIN_POLL_TRIES` 20 (±6 dtk) untuk `waitScreenChange`,
plus `CHAIN_END_TRIES` 5 tangkapan berturut-turut sebelum "rantainya tuntas" boleh dipercaya
(`detect.ts:93-109`). Vonis itu **mengosongkan marker**, dan marker sebuah dialog hanya terisi
sekali (SPEC-474: 0 B selama 120 dtk dengan dialognya masih terbuka) — salah vonis = sisa rantai
tak terjangkau siapa pun.

Pengukuran hari ini menghapus **alasan** menebaknya: satu panggilan `AskUserQuestion` menerbitkan
**satu** event yang memuat **seluruh** pertanyaannya (3 pertanyaan → 1 event, `questions.length = 3`,
§6.2). Berapa langkah rantai itu **diketahui di muka**, bukan disimpulkan dari layar.

## 2. Hasil yang dituju

1. Tak ada lagi `setInterval` yang memindai sesi hidup, dan nol `capture-pane` per sesi selama tak
   ada yang bertanya. `pulse` (`lead.everyMin`) dan `expireFlows` tetap punya irama sendiri.
2. Sesi claude memasang hook yang menembak **tepat pada** `AskUserQuestion` dan mengirim eventnya
   ke server dengan pertanyaan & opsi terstruktur. Sesi codex mendapat hook padanan (akhir-turn)
   sehingga cakupan lead untuk codex **tidak berkurang**.
3. Latensi dari `AskUserQuestion` sampai lead mulai menyusun keputusan **diukur & dilaporkan**,
   sebelum dan sesudah, di sesi diam.
4. Rantai keputusan didorong event; `CHAIN_END_TRIES` dicabut. Satu langkah yang tersisa menuntut
   interaksi layar dinyatakan apa adanya (§3.6). `LeadFlow` tetap merekam rantainya.
5. Pet menampilkan pertanyaan ASLI dari payload, seketika, tanpa scrape — dan tetap jujur bila
   payloadnya tak ada. Rantai tampil sebagai langkah ke-berapa dari berapa. Status lead terlihat.
6. Operator bisa MENGAMBIL ALIH dari pet sebelum lead mengetik ke pane; perebutan diselesaikan
   deterministik, yang kalah mendapat penolakan yang jelas.
7. Seluruh pagar lead yang ada tetap utuh & teruji; event bertubi-tubi tak melahirkan dua
   keputusan paralel untuk satu sesi.
8. ADR-0146 mengamandemen ADR-0091 §5 (irama pintu deteksi).

## 3. Keputusan yang mengikat

### 3.1 Hook `PreToolUse` ber-matcher `AskUserQuestion` (claude) & `Stop` (codex) MENGIRIM, bukan menulis berkas

`guardSettings()` mendapat entri ketiga; `codexHookArgs()` mendapat perintah kedua di `Stop`.
Perintahnya identik bentuknya di kedua mesin — satu `curl` yang meneruskan **payload hook apa
adanya** ke server:

```sh
curl -sS -m 2 -X POST "$HANOMAN_EVENT_URL" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $HANOMAN_EVENT_TOKEN" \
  -H "x-hanoman-session: $HANOMAN_SESSION_ID" \
  ${HANOMAN_EVENT_HOST:+-H "host: $HANOMAN_EVENT_HOST"} \
  --data-binary @- >/dev/null 2>&1; exit 0
```

Empat hal yang mengikat di baris itu, semuanya punya sebab:

- **`exit 0` tanpa syarat.** `PreToolUse` yang keluar dengan kode 2 **memblokir tool-nya**. Server
  mati tak boleh berarti agen tak bisa bertanya.
- **`-m 2`.** Batas atas stall yang dibayar agen saat server tak menjawab. Ia menunggu manusia
  sesudah ini, jadi dua detik adalah harga yang benar untuk kepastian.
- **stdout dibuang.** Keluaran hook `type: "command"` dibaca claude sebagai kendali izin.
- **Payload diteruskan verbatim.** Tak ada `jq` di jalur ini: hook tak boleh menuntut biner yang
  belum tentu ada, dan bentuk payload adalah kontrak agen — server yang memarsenya.

**Marker keputusan tak disentuh.** Hook `Notification`/`Stop` yang mengisinya, dan
`UserPromptSubmit` yang mengosongkannya, tetap persis seperti sekarang. Pil terminal,
`liveDecisions().waiting`, notifikasi `awaiting`, dan panel pet membaca arti yang sama seperti
sebelum SPEC ini (ADR-0141/0143 utuh). Yang ditambahkan adalah **kanal kedua**, bukan pengganti.

### 3.2 Identitas & otorisasi: token turunan HMAC per sesi, bukan id sesi

`HANOMAN_EVENT_TOKEN = base64url(HMAC-SHA256(K, sessionId))`, dengan
`K = HMAC-SHA256(secretKey(), "hanoman:session-event:v1")` — `secretKey()` sudah ada
(`services/secret-box.ts:63`, 32 byte di `$HANOMAN_HOME/secret.key`), dan sub-kunci menjaga
pemisahan domain dari enkripsi at-rest.

Konsekuensi yang dipilih sadar: **verifikasi stateless**. Server menghitung ulang dan
membandingkannya `timingSafeEqual` terhadap `Bearer` yang masuk. Tak ada registry yang harus
dihidrasi ulang sesudah restart, tak ada round-trip tmux di jalur panas, dan sesi yang lahir
sebelum restart tetap bisa mengirim event.

Tiga gerbang, berurutan:

1. `Bearer` cocok dengan token turunan `sessionId` yang dikirim di payload — **id sesi saja tidak
   pernah cukup**.
2. Sesinya **hidup** (`getSession(id)` ada dan `!exited`). Sesi mati → `404`.
3. Batas laju (§3.3).

Token dikirim lewat **env sesi** (`opts.env`, pola `HANOMAN_API_BASE` Telegram di
`services/telegram/session.ts:114`), bukan lewat argv `--settings`. Terukur: proses hook mewarisi
env sesi di **kedua** mesin (§6.3).

> **Batas yang dinyatakan apa adanya.** Semua sesi di mesin ini berjalan sebagai **uid yang sama**,
> dan `envPairs` ikut ke argv `sh -c` yang melahirkan pane. Sesi tetangga yang memang berniat
> mencurinya bisa membacanya dari `ps`/`/proc`. Itu batas yang sama yang sudah diterima ADR-0037
> (kepercayaan penuh pada agen, isolasi murni lewat worktree) — SPEC ini tak melebarkannya dan tak
> berpura-pura menutupnya. Yang ditutup token ini adalah dua hal yang nyata: pemanggil **tanpa**
> kredensial apa pun (termasuk dari jaringan) tak punya jalan masuk, dan sesi yang **tidak**
> berniat mencuri tak bisa memalsukan pertanyaan atas nama sesi lain karena kebetulan tahu id-nya.

### 3.3 Batas laju & idempotensi — supaya event tak jadi badai SPEC-472 versi baru

- **Kunci idempotensi datang dari agennya sendiri**: `tool_use_id` (claude) / `turn_id` (codex).
  Keduanya unik per panggilan/giliran. Event dengan `askId` yang sudah dikenal dijawab
  `202 {duplicate:true}` dan **tak** melahirkan keputusan kedua. LRU berbatas 512 entri.
- **Ember token per sesi**: kapasitas **5**, isi ulang **1 per 10 detik** (≤ 6/menit langgeng).
  Lewat batas → `429`, tanpa memanggil agen. Badai SPEC-472 (152 percobaan / 13 menit ≈ 11,7/menit)
  tak muat di dalamnya.
- **Ember global**: kapasitas **20**, isi ulang **2 per detik** — pagar terakhir bila banyak sesi
  meledak bersamaan.
- Ditolak batas laju **tak** dihitung sebagai kegagalan lead (`failures`), dengan alasan yang sama
  persis seperti `LeadBusyError` (SPEC-479): ia hilang dengan menunggu.

### 3.4 Pintu masuknya route sendiri dengan auth sendiri — cermin `/api/sync`

`POST /api/session-events`. Tiga alasan ia **bukan** sub-path `/api/lead`:

1. `capabilityForRoute` memetakan seluruh prefix `lead` ke `rw("lead")`; di bawah `/api/lead`
   setiap agent token pemegang `lead:write` bisa **memalsukan pertanyaan** dan menggerakkan lead.
   `session-events` dipetakan eksplisit ke `COOKIE_ONLY` → agent token 403, apa pun capability-nya.
2. Gate cookie di `app.ts:145` di-bypass untuk path ini (baris sejajar `/api/sync` dan `/api/help`),
   karena kredensialnya bukan cookie melainkan token sesi.
3. Pemanggilnya bukan manusia dan bukan agen ber-token; ia proses hook. Permukaan dengan model auth
   sendiri layak punya prefix sendiri — itu preseden yang sudah dipakai dua kali.

**Gerbang ingress.** `classifyIngress` **tidak disentuh**: ia menilai `Host`, dan `Host` dikendalikan
pemanggil, jadi mengistimewakan `127.0.0.1` di sana akan membuka permukaan control lewat reverse
proxy publik. Sebagai gantinya sesi menerima `HANOMAN_EVENT_HOST` = host control pertama saat
`HANOMAN_CONTROL_ORIGINS` terpasang, dan hook mengirimkannya sebagai header `Host` di atas koneksi
**loopback** (`HANOMAN_EVENT_URL` selalu `http://127.0.0.1:<port>/api/session-events` — tanpa DNS,
tanpa TLS). Tanpa split origin variabel itu kosong dan headernya tak dikirim.

Balasan: `202` diterima · `202 {ignored:true}` untuk event yang bukan pertanyaan (mis. `PreToolUse`
tool lain, `Stop` codex ber-`stop_hook_active`) · `401` token salah · `404` sesi tak hidup ·
`429` batas laju · `400` bentuk payload tak dikenal.

### 3.5 `scanAndAnswer` diganti `admitAsk` + antrean berpekerja, bukan dihapus isinya

Seluruh pagar tahap 1 `scanAndAnswer` (`detect.ts:216-300`) pindah utuh ke `admitAsk(sessionId)`,
dipanggil **satu sesi per event**: opt-in project · `leadActive` (AC-27/AC-30) · `exited` (AC-10) ·
`maxAutoAnswers` + baris `capped` + notifikasi (AC-11) · masa dingin `FAIL_COOLDOWN_MS` ·
`failCapped` + barisnya (SPEC-472/487). Kalimat, `kind`, dan `weighty` baris jejaknya tak berubah
sehuruf pun — pagar yang "masih menggigit" harus menggigit dengan bunyi yang sama.

Batas konkurensi lintas sesi yang dulu diberikan `runPool(ready, cfg.maxConcurrent)` sekarang
diberikan **antrean + kolam pekerja berukuran `cfg.maxConcurrent`** di `lead/ask.ts`. Bedanya
hanya bahwa antreannya berumur panjang; batasnya angka yang sama.

**Satu sesi = satu pekerjaan.** Event yang tiba untuk sesi yang sedang dikerjakan tidak melahirkan
pekerjaan kedua: ia menimpa "event tertunda" milik sesi itu (yang terbaru menang) dan dijalankan
sesudah yang sekarang selesai. Ini yang membuat AC-7 (event kembar) benar **secara konstruksi**,
bukan lewat penjagaan yang harus diingat.

`sweep()` tak punya daftar penuh lagi; penghitung dipangkas **malas** saat intake — entri yang
sesinya sudah tak hidup dibuang di situ juga.

### 3.6 Yang TETAP digerakkan layar, dinyatakan apa adanya

Terukur: **satu panggilan `AskUserQuestion` = satu event**, betapa pun banyak pertanyaannya
(§6.2). Maka:

- **Berapa langkah** rantai itu diketahui dari payload (`questions.length`, ≤ 4 per kontrak tool).
  `CHAIN_END_TRIES` dan `settledPane()` **dicabut** — keduanya ada semata untuk menebak angka itu.
- **Berpindah antar-tab di DALAM satu dialog tetap butuh layar.** Tak ada event di antara tab;
  claude tak menembak apa pun saat pertanyaan ke-2 dari satu panggilan muncul. `waitScreenChange`
  karena itu **dipertahankan persis untuk langkah itu saja**, dan namanya tetap jujur. Ini satu-
  satunya sisa interaksi layar di jalur keputusan, dan ia **tidak** mengembalikan pemindaian sesi:
  ia berjalan di dalam satu rantai yang sudah dipicu event, untuk sesi yang sudah pasti bertanya.
- **Panggilan `AskUserQuestion` berikutnya tiba sebagai event berikutnya.** Rantai lintas-panggilan
  tak lagi ditunggu di layar sama sekali.
- `MAX_CHAIN_STEPS` tetap 6 dan tetap konstanta modul (pane yang menolak maju masih harus punya
  ujung). `LeadFlow` tetap satu per rantai, `chainSteps` tetap terisi, alur tetap ditutup saat
  tuntas.

### 3.7 Codex: padanan yang lebih kuat dari yang ada sekarang

Codex tak punya `AskUserQuestion`. Padanannya `Stop`, dan payloadnya membawa
**`last_assistant_message`** (§6.4) — teks penuh giliran terakhir, tanpa dipotong lebar pane.

Karena itu gerbang "codex benar-benar bertanya" (`ASK_SIGNALS` di `lead/pane.ts`) dinilai atas
**pesan itu**, bukan atas `capture-pane`. Bukti yang sama, sumber yang lebih baik, **nol** invokasi
tmux. `AGENT_TURN_LINE` (SPEC-487) tak lagi dibutuhkan di jalur claude — di sana pertanyaannya
datang dari kontrak tool, bukan dari tebakan atas baris giliran — tetapi kodenya **tetap** dipakai
codex dan tak dihapus.

Cakupan codex karena itu tidak berkurang: hari ini marker codex menyala di tiap akhir turn dan
lead menyaringnya lewat layar; sesudah SPEC ini event codex terbit di tiap akhir turn dan lead
menyaringnya lewat pesan giliran itu.

### 3.8 Pet menerima payload lewat siaran `/api/events/ws` yang sudah ada

Grup siar baru `leadAsks` di `services/events.ts` `GROUPS` (`everyTicks: 1`, dedup signature
seperti tujuh grup lain). **Tanpa koneksi WebSocket kedua** (ADR-0039 ditegakkan), tanpa polling
klien, tanpa tabel baru — daftar tanya hidup di memori, seperti `deciding`/`queued`.

```ts
type SessionAsk = {
  sessionId: string; agent: Agent;
  source: "ask-tool" | "turn-end";
  askId: string; askedAt: string;
  questions: { header: string; question: string; multiSelect: boolean;
               options: { label: string; description?: string }[] }[];
  message: string;                 // "" (claude) | last_assistant_message terpotong (codex)
  at: number; total: number;       // langkah ke-(at+1) dari total
  state: "queued" | "deciding" | "answered" | "taken-over" | "failed";
  flowId: string | null; step: number | null;
};
```

`state` diturunkan dari sumber yang sudah ada — `queuedIds()`/`decidingIds()`
(`lead/deciding.ts`) — supaya "mengantre" dan "menyusun" tak pernah punya dua definisi. Panjang
`question`/`message` dipagari (masing-masing 2 000 / 4 000 char) sebelum masuk frame.

`PetAnswer` memakai `leadAsks` sebagai **sumber utama** pertanyaan dan menampilkan langkah
"Pertanyaan _n_ dari _N_" dari `at`/`total`. `GET /terminal/sessions/:id/dialog` tetap dipanggil
(ia yang memasok nomor baris opsi & `screenHash` yang dibutuhkan untuk MENJAWAB) tetapi tak lagi
menentukan apakah pertanyaannya **terbaca**. Bila `leadAsks` tak memuat sesi itu — sesi codex,
server yang lebih tua (ADR-0087), atau sesi pra-pembaruan — pet jatuh ke perilaku hari ini apa
adanya, termasuk kalimat `"Pertanyaannya tak terbaca dari sini"`. Untuk sesi codex ia menampilkan
pesan giliran terakhir dengan label yang jujur, bukan berpura-pura itu sebuah pertanyaan berpilihan.

### 3.9 Ambil alih: satu aksi, pemenang ditentukan satu `Set`

`POST /api/terminal/sessions/:id/dialog/takeover` — di bawah prefix `terminal` supaya
capability-nya turun dari peta yang sudah ada (`rw("sessions")` → `sessions:write`, sama dengan
menjawab dialog). Siapa yang boleh menjawab, boleh mengambil alih.

Perebutannya diselesaikan **satu penjaga sinkron**, `beginAnswer()` di
`services/session-dialog.ts:105` — `Set` yang sama yang hari ini mencegah dua POST manusia
menyilangkan keystroke. Yang berubah: **jalur lead ikut masuk ke dalamnya**. `sendToPane` milik
pintu deteksi dibungkus `beginAnswer`/`endAnswer`, jadi dua penulis pane tak punya jalan berpapasan.

| urutan | hasil |
|---|---|
| takeover tiba sebelum lead memegang pane | `202`. Lead membatalkan sebelum mengetik: barisnya ditandai `ditimpa`, `answers` di-reset (ADR-0091 OQ-8), `leadAsks.state = "taken-over"`, pet membuka kotak jawab. |
| takeover tiba saat lead sedang mengetik | `409 {reason:"answering"}` — "hanoman-lead sudah mengirim jawabannya". |
| operator menjawab saat lead memutuskan, tanpa takeover | `409 {reason:"deciding"}` — **persis seperti hari ini** (ADR-0142 §5, tak disentuh). |
| lead selesai memutuskan sesudah takeover | Dibuang sebelum menyentuh pane; jejaknya tetap ditulis. |

Pagar `screenHash`/`dialogKey` SPEC-899 berlaku apa adanya di jalur jawab operator.

### 3.10 Sesi yang sudah berjalan saat server di-update: **tidak dilayani, dan dikatakan**

Sesi lama tak punya hook baru, dan pemindainya sudah tak ada — jadi lead **tidak akan** menjawabnya.
Menyisakan pemindai "hanya untuk sesi lama" berarti mempertahankan persis biaya yang dicabut
AC-1, untuk populasi yang menyusut sendiri.

Supaya tak ada yang menggantung tanpa siapa pun tahu, sesi ditandai saat lahir dengan opsi window
tmux `@hanoman_event_hook` (cermin `@hanoman_decision_file` yang sudah ada). Sesi hidup tanpa
penanda itu **yang markernya terisi** melahirkan **satu** notifikasi, sekali seumur sesi:

> "Sesi `<id>` lahir sebelum pembaruan dan tak memasang hook event — hanoman-lead tak akan
> menjawabnya. Jawab dari panel pet atau terminal, atau mulai ulang sesinya."

Pemeriksaannya menumpang **tick rumah tangga lead** (§3.11, 60 detik): satu `liveDecisions()` —
yaitu satu `tmux list-panes -a`, bukan satu per sesi — lalu selesai. **Nol `capture-pane`, nol
panggilan agen, satu notifikasi per sesi seumur hidupnya.** Sengaja TIDAK menumpang
`scanDecisions()` di tick scheduler: jalur itu memulangkan tick lebih dulu saat master switch
scheduler mati (`scheduler/engine.ts:28`), dan sesi yang menggantung tak boleh bergantung pada
setelan subsistem lain.

### 3.11 Engine: satu irama lambat untuk rumah tangga, nol untuk pertanyaan

`startLead` tetap satu `setInterval` — **bukan timer baru** (ADR-0024 tak dilanggar; jumlah timer
berkurang, bukan bertambah) — tapi `TICK_MS` 5 000 → `HOUSEKEEPING_MS` **60 000**, dan isinya
tinggal dua: `expireFlows` (TTL 60 menit; resolusi 60 detik lebih dari cukup) dan jatuh-tempo
`pulse`. `scanAndAnswer` **tak dipanggil dari timer mana pun lagi**. `busyDetect` dicabut bersamanya;
`busyPulse`, `lastPulseAt`, `pulseEndedAt` tetap apa adanya (gotcha SPEC-432 #8 masih berlaku untuk
denyut).

## 4. ADR

**ADR-0146** — *Pintu deteksi hanoman-lead dipicu event hook, bukan denyut*.
Mengamandemen **ADR-0091 §5** (dua irama → satu irama rumah tangga + satu jalur event) dan bagian
"pintu #2" ADR-0091 §2 (lead tak lagi menyimpulkan pertanyaan dari layar untuk claude).
Menegakkan **ADR-0024** (timer dikurangi, bukan ditambah; tanpa queue/worker/cron),
**ADR-0039** (tanpa kanal WS baru), **ADR-0102** (rantai & `LeadFlow` utuh, `CHAIN_END_TRIES`
dicabut karena payload menggantikannya), **ADR-0142** (gerbang `screenHash`/`deciding`/`answering`),
**ADR-0143** (arti & pemilik marker tak disentuh), **ADR-0037** (batas keamanan tetap worktree),
**ADR-0065** (`session-events` dipetakan eksplisit), **ADR-0087** (dashboard boleh lebih baru).
Nomor 0146 dienumerasi lintas worktree & branch tepat sebelum diklaim (ADR-0021): 0144 dipegang
SPEC-905 (repo utama), 0145 dipegang SPEC-908 (`.worktrees/spec-908`).

## 5. Kontrak

### 5.1 Env sesi baru (`pty.ts`, `opts.env`)

| var | isi | kapan |
|---|---|---|
| `HANOMAN_SESSION_ID` | id sesi hanoman | selalu (sesi agen) |
| `HANOMAN_EVENT_URL` | `http://127.0.0.1:<port>/api/session-events` | selalu (sesi agen) |
| `HANOMAN_EVENT_TOKEN` | token turunan HMAC (§3.2) | selalu (sesi agen) |
| `HANOMAN_EVENT_HOST` | host control pertama | hanya bila `HANOMAN_CONTROL_ORIGINS` terpasang |

Sesi ber-`opts.command` (Console VPS, terminal biasa) **tidak** menerimanya — tak ada agen di sana.

### 5.2 `POST /api/session-events`

Body = payload hook **verbatim**. Server memilih berdasarkan `hook_event_name`:

- `PreToolUse` + `tool_name = "AskUserQuestion"` → `questions` dari `tool_input.questions`,
  `askId = tool_use_id`, `source = "ask-tool"`.
- `Stop` (codex) → `message = last_assistant_message`, `askId = turn_id`, `source = "turn-end"`.
- lainnya → `202 {ignored:true}`.

Header wajib: `authorization: Bearer <token>`. `sessionId` datang dari header
`x-hanoman-session` yang diisi hook dari `$HANOMAN_SESSION_ID` — **bukan** dari `session_id` di
dalam payload, yang id internal agennya sendiri, dan bukan dari body sama sekali: body adalah
kontrak agen yang bisa berubah, header adalah kontrak kita.

**Jalur ini tak boleh memblokir event loop** (constraint SPEC-909, jalur `execFileSync` yang sama
sudah terukur menahan loop sampai 916 ms). `getSession()` memakai `listPanes()` yang sinkron, jadi
route ini memakai **`getSessionAsync()`** — kembaran di atas `listPanesAsync()` yang sudah ada
(`pty.ts:317`), ditambahkan oleh SPEC ini. Sisa jalur intake murni memori.

### 5.3 `POST /api/terminal/sessions/:id/dialog/takeover`

`202 {accepted:true}` · `409 {reason:"answering"}` · `404` sesi tak hidup.

### 5.4 Frame siar

`{ t: "leadAsks", asks: SessionAsk[] }` (§3.8).

## 6. Bukti terukur (2026-08-23)

Semua di `tmux -L spec909`, pane 120×40, claude 2.1.240 / codex-cli 0.147.0, stempel
`perl -MTime::HiRes` **di dalam** hook.

### 6.1 `PreToolUse` menembak tepat pada `AskUserQuestion` & membawa payload terstruktur

```json
{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion",
 "session_id":"6b3cc73f-…","cwd":"…/hooktest","tool_use_id":"toolu_01Ev4E…",
 "permission_mode":"bypassPermissions",
 "tool_input":{"questions":[{"question":"Warna mana yang kamu pilih?","header":"Warna",
   "options":[{"label":"Merah","description":"hangat"},{"label":"Biru","description":"sejuk"}],
   "multiSelect":false}]}}
```

### 6.2 Satu panggilan = satu event, berapa pun pertanyaannya

Prompt meminta **satu** `AskUserQuestion` dengan **tiga** pertanyaan (satu di antaranya
`multiSelect`). Hasil: **satu** berkas event, `questions.length = 3`, `multiSelect` per pertanyaan
terbawa apa adanya:

```
{"tool":"AskUserQuestion","n":3,"q":[
  {"header":"Basis","multiSelect":false,"opts":["SQLite","Postgres"]},
  {"header":"Auth","multiSelect":true,"opts":["Cookie","Token"]},
  {"header":"Deploy","multiSelect":false,"opts":["VPS","Lokal"]}]}
```

Tab strip yang muncul di pane (`←  ☐ Basis  ☐ Auth  ☐ Deploy  ✔ Submit  →`) cocok persis dengan
payload — jadi jumlah langkah rantai **diketahui di muka**.

### 6.3 Proses hook mewarisi env sesi — di kedua mesin

| mesin | `HANOMAN_SESSION_ID` | `HANOMAN_LEAD_TOKEN` | `HANOMAN_API_BASE` |
|---|---|---|---|
| claude (`PreToolUse`) | `spec-909` | `rahasia123` | `http://127.0.0.1:8787` |
| codex (`Stop`) | `spec-909` | `rahasia123` | — |

### 6.4 Payload hook `Stop` codex

```json
{"session_id":"01a02bad-…","turn_id":"01a02bad-5737-…","cwd":"…/hooktest",
 "hook_event_name":"Stop","model":"gpt-5.6-sol","permission_mode":"bypassPermissions",
 "stop_hook_active":false,"last_assistant_message":"siap"}
```

Menembak **sekali** per giliran (penghitung di dalam hook = 1; dua baris `hook: Stop` di keluaran
`codex exec` adalah log, bukan dua invokasi).

### 6.5 Jarak `AskUserQuestion` → `Notification` (marker)

**6 071 ms** (1 pertanyaan) dan **6 023 ms** (3 pertanyaan). Ini lapis latensi yang selama ini tak
terhitung; setengah tick 5 detik menumpuk **di atasnya**.

### 6.6 Yang MASIH harus diukur (dikerjakan di fase Execute, dilaporkan sebagai angka)

- Latensi sesudah: `AskUserQuestion` → `decide()` mulai, di sesi diam, server hidup.
- Stall yang dibayar agen oleh hook `curl` saat server sehat.
- `capture-pane` per tick sebelum vs sesudah, pada N sesi hidup yang sama.

## 7. Yang TIDAK berubah

- Arti marker keputusan, isinya, dan **siapa** yang mengosongkannya (ADR-0141/0143). Tiga
  pengosongnya tetap tiga.
- `tui-dialog.ts` — tak satu primitif pun ditulis ulang. `sendToPane` tetap satu-satunya cara lead
  mengetik ke pane.
- `decide.ts`, `brain.ts`, `trail.ts`, `apply.ts`, `verdict.ts`, `flow.ts`, `prompt.ts`,
  `LEAD_ACTIONS`, `zLeadVerdict`.
- Kontrak sesi: **tak ada prompt baru, tak ada kewajiban baru bagi agen** (ADR-0091). Hook dipasang
  dari luar saat sesi lahir, seperti sekarang.
- Skema DB: **nol migration**, nol model baru, nol dampak sync.
- `pulse.ts` dan seluruh pintu #1 (`POST /lead/decisions`).

## 8. Test yang wajib ada

1. **Event → keputusan (jalur bahagia).** Payload `AskUserQuestion` sah → `decide()` dipanggil
   sekali dengan `question`/`options` **dari payload**, jawaban dikirim ke pane.
2. **Rantai > 1 langkah.** Payload 3 pertanyaan → 3 `decide()` berurutan dalam **satu** `LeadFlow`,
   `chainSteps` terisi, alur ditutup, `MAX_CHAIN_STEPS` tetap mengikat.
3. **Rantai lintas-panggilan.** Event kedua untuk sesi yang sama → alur/langkah berikutnya tanpa
   satu pun `waitScreenChange` di antara kedua event.
4. **Event palsu ditolak.** Tanpa `Authorization` → 401 · token milik sesi LAIN → 401 · agent token
   ber-`lead:write` → 403 · sesi mati → 404.
5. **Event kembar.** `askId` sama dua kali → satu keputusan, balasan kedua `duplicate`. Dua event
   berbeda yang tiba bertumpuk untuk satu sesi → tetap satu pekerjaan berjalan, yang kedua
   menyusul, **tak pernah** dua `decide()` paralel untuk sesi itu.
6. **Batas laju.** > 5 event beruntun → `429`, dan `429` **tidak** menaikkan `failures`.
7. **Pagar lama masih menggigit.** `enabled=false` · `paused` global & per-project · project tak
   opt-in · `maxAutoAnswers` (baris `capped` + notifikasi, kalimat sama) · `failCapped` +
   `FAIL_COOLDOWN_MS` · `cfg.maxConcurrent` membatasi sesi yang dilayani bersamaan.
8. **Perebutan operator-vs-lead.** Takeover sebelum pane → lead batal, baris `ditimpa`, `answers`
   reset · takeover saat mengetik → `409 answering` · jawab tanpa takeover saat `deciding` →
   `409 deciding`.
9. **Hook terpasang benar.** `guardSettings()` memancarkan `PreToolUse` ber-matcher
   `AskUserQuestion` yang **selalu** `exit 0`; `codexHookArgs()` memancarkan perintah `Stop`
   kedua berdampingan dengan penulis marker — dan **penulis marker tidak berubah**.
10. **Engine.** Tick tak pernah memanggil `scanAndAnswer`; `expireFlows` & jatuh-tempo `pulse`
    tetap jalan pada irama barunya.
11. **Siaran `leadAsks`.** Frame lahir saat daftar berubah, tak lahir saat tidak; teks dipagari.
12. **Pet.** Menampilkan pertanyaan dari payload seketika · "Pertanyaan _n_ dari _N_" · sesi codex
    menampilkan pesan giliran dengan label jujur · tanpa `leadAsks` jatuh ke perilaku hari ini.
13. **Sesi pra-pembaruan.** Satu notifikasi, sekali; tak ada `capture-pane` tambahan.
14. Test lead & terminal yang ada tetap hijau.

## 9. Risiko & yang diterima sadar

- **Prompt izin & pertanyaan prosa tak lagi dijemput lead.** Keputusan operator, dinyatakan di
  brief. Marker, pil, notifikasi, dan panel pet tetap menyalakannya — yang hilang hanya jawaban
  otomatis. Tak ada hook lain yang menutup kedua kasus itu tanpa menghidupkan pemindaian: satu-
  satunya sinyal untuk prompt izin adalah `Notification` yang sama, dan ia sudah dipakai untuk
  marker.
- **Stall ≤ 2 detik pada agen** saat server tak menjawab. Dibayar tepat sebelum sesi menunggu
  manusia.
- **`curl` jadi prasyarat runtime** bagi jalur event. Ditambahkan ke `hanoman doctor`; tanpanya
  hook diam dan sesi kembali ke perilaku "menunggu manusia" (`exit 0`, tak pernah memblokir agen).
- **Sesi pra-pembaruan tak dilayani lead** (§3.10).
- **Token bisa dicuri sesi tetangga se-uid** (§3.2) — batas ADR-0037, tak dilebarkan.
- **`events.ts` `GROUPS` juga disentuh SPEC-908** di worktree tetangga. Konflik merge yang dangkal
  dan diharapkan; keduanya menambah entri, tak ada yang mengubah bentuk `GROUPS`.
