# ADR-0192 — Gerbang "agen tak memutuskan sesinya sendiri": bukti yang bisa ditegakkan, dan batasnya

Tanggal: 2026-10-11
Status: diterima
Melengkapi **ADR-0190** (capability `sessions:decide`) · Terkait: ADR-0142/0146 (dialog & rebut sesi), ADR-0037 (agen dipercaya penuh; isolasi = worktree), ADR-0091 (lead), SPEC-909 (token hook turunan per sesi)

## Konteks

`sessions:decide` menjawab "token mana yang BOLEH memutuskan". Ia tak menjawab "boleh memutuskan
UNTUK sesi yang mana". Token yang sama bisa duduk di dua tempat: klien MCP milik manusia, dan
konfigurasi `claude` yang dibaca sesi hanoman (konfigurasi tingkat-user diwarisi setiap sesi). Lalu
sesi itu menjawab pertanyaannya sendiri — persis yang ditakutkan SPEC-899.

Pemilik meminta server menolak bila "token pemanggil adalah token yang sama/turunan dari sesi yang
sedang bertanya", sejauh mungkin dengan bukti. Hasil membaca kode:

- **Sesi TIDAK menerima agent token dari hanoman.** Env sesi hanya memuat `HANOMAN_EVENT_TOKEN`,
  HMAC turunan per sesi (`session-event-token.ts`); satu-satunya pengecualian adalah sesi operator
  Telegram, yang membawa token gateway-nya sendiri. Tak ada baris AgentToken↔sesi untuk
  dibandingkan.
- Token turunan itu **tak pernah diterima gerbang agent token** — `authenticateAgent` mencari
  `hnm_agt_…` ber-hash di DB — jadi jalur "token turunan sesi memanggil `/dialog`" sudah mustahil
  (401; dibuktikan test). Inilah separuh jawaban untuk "turunan".
- Karena itu "token yang sama dengan sesi" TIDAK dapat dibuktikan di server. Yang dapat ditegakkan
  adalah bukti tidak langsung.

## Keputusan

Principal AGEN (`req.agent`) yang memanggil `dialog/answer`, `dialog/takeover`, atau `steer`-ke-dialog
ditolak **403** `{ reason }` bila salah satu bukti berikut ada (`services/decision-guard.ts`):

1. **`launcher`** — token yang MELUNCURKAN atau MENYAMBUNG sesi lewat `POST /terminal/sessions`
   (dicatat di `onSend`, satu pintu untuk keenam jalur lahir sesi) ke `$HANOMAN_HOME/session-launchers/<id>`
   (id token saja, bukan rahasia; himpunan, dipangkas 30 hari, tahan restart server karena sesi tmux
   selamat dari restart — ADR-0016). Untuk sesi backlog yang lahir sebelum pencatatan ada:
   `Spec.launchApprovedBy === "agent:<id>"` (kolom yang sudah ada; nol skema baru).
2. **`self` / `in-session`** — header `x-hanoman-session`. Proses `hanoman mcp` yang diwarisi
   `HANOMAN_SESSION_ID` mengirimnya di SEMUA request (`cli/src/mcp/client.ts`, dari ENV proses,
   tak pernah dari argumen model, tak bisa ditimpa `build()` tool). Header ada ⇒ pemanggil adalah agen
   di dalam sebuah sesi hanoman ⇒ ditolak untuk SEMUA sesi (bukan hanya miliknya): agen di sesi A
   yang memutuskan sesi B sama-sama meruntuhkan "manusia yang memutuskan". `self` bila id = target.

403 mendahului 409 `deciding`/`answering`, supaya penolakan tak membocorkan apakah lead sedang
memegang sesi itu. Cookie (manusia) dan relay (operator hub) tak dinilai.

## Batas yang dinyatakan apa adanya

- **(2) bisa dihindari**: klien yang sengaja memanggil REST dengan token yang sama memakai `curl`
  tanpa header tak terdeteksi. Server tak punya cara membuktikan siapa di balik Bearer. Lapis ini
  menutup jalan yang realistis (proses MCP milik sesi sendiri), bukan agen yang berniat.
  Pengendali sebenarnya adalah capability: **jangan beri `sessions:decide` pada token yang dipasang
  di konfigurasi yang dibaca sesi hanoman.** Panel Settings menyebutnya pada deskripsi capability.
- Bukti kuat tambahan yang dipertimbangkan dan ditolak: memetakan port klien loopback → PID → leluhur
  proses = pane sesi. Rapuh lintas OS, butuh `lsof` sinkron di jalur permintaan, dan tak berlaku untuk
  akses lewat tunnel. Dicatat sebagai opsi bila kelak diperlukan.
- Jalur lain yang mengetik jawaban ke pane tetap ada DAN disengaja: `POST /lead/decisions/:id/override`
  (`lead:write`, risk `exec` — agen meminta/menimpa putusan hanoman-lead; domain itu memang dirancang
  untuk agen, ADR-0091). Tak diubah di sini; dicatat supaya tak dikira tertutup.
- Gateway Telegram dikecualikan dari gerbang steer-ke-dialog (lihat ADR-0190 butir 4); alasannya
  korelasi manusia Telegram, bukan kepercayaan pada tokennya.

## Konsekuensi

- Satu header baru di klien MCP; server lama mengabaikannya, server baru dengan klien lama tetap
  menegakkan bukti (1).
- Satu direktori kecil di `$HANOMAN_HOME`. Gagal menulisnya tak menggagalkan peluncuran sesi.
- Test: `server/test/decision-gate.test.ts` (route sungguhan dengan agent token: kontrol positif dan
  negatif tiap bukti, 409, steer, token turunan 401), `cli/test/mcp-client.test.ts`.
