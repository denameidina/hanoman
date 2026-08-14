# Security standard

- **Auth (SPEC-169, ADR-0028)**: login email/password menggerbangi seluruh `/api` (gate `onRequest`,
  401 tanpa sesi; termasuk upgrade WebSocket `/api/terminal`). Publik hanya `GET /health`,
  `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`.
  - Password: `crypto.scrypt` (stdlib) + salt acak + `timingSafeEqual`. Tak pernah dikembalikan ke client.
  - Sesi: token opaque 256-bit di cookie `httpOnly`; DB menyimpan `sha256(token)`, bukan token mentah.
    Revocable — logout/ganti-password/hapus-user mencabut sesi. Cookie `httpOnly` + `sameSite=strict`
    + `secure` (prod) + `maxAge` 7 hari.
  - Login di-throttle per IP (10 gagal → tunda 60 dtk); error selalu generic ("email atau password salah").
  - **Dua peran** (SPEC-617, [ADR-0110](../adr/0110-portal-klien-read-only.md)): `User.role` =
    `admin` (operator — cookie = akses penuh, perilaku lama persis) atau `client` (portal baca-saja
    ber-scope project). `@default("admin")` supaya migrasi tak memutus akun yang sudah ada.
    - Klien ditolak **403** di seluruh `/api` kecuali allowlist `services/client-access.ts`
      (`GET|HEAD /portal/**` · `/help/**` · `POST /auth/logout` · `POST /auth/change-password`).
      **Deny-by-default** — endpoint baru tertutup bagi klien sampai sengaja dibuka; berlaku juga
      untuk upgrade WebSocket, jadi PTY & feed siar tertutup secara struktural.
    - Scope project ditegakkan **di server** lewat `ClientProjectAccess`, termasuk saat id project
      ditebak langsung di URL: bukan-miliknya → **404 yang sama** dengan project yang tak ada.
    - `User.disabled` ditegakkan di **dua** titik — `POST /auth/login` (pesan generic yang sama
      dengan password salah) **dan** `lookupSession()`. Hanya menutup login berarti cookie yang
      sudah terbit hidup sampai 7 hari. Nonaktif/reset password menghapus sesi akun itu.
    - `DELETE /auth/users/:id` menolak menghapus **admin terakhir** (bukan "user terakhir": sejak ada
      akun klien, syarat lama bisa terpenuhi oleh akun yang tak boleh melihat apa pun).
    - Tak ada jalur signup publik; akun klien hanya dibuat admin lewat `POST /client-accounts`.
  - Bootstrap: saat 0 user, `POST /auth/setup` membuat akun pertama, lalu tertutup (409).
- **TLS / deployment**: cookie `Secure` butuh HTTPS. Pola deploy: bind `127.0.0.1` di belakang reverse
  proxy yang menerminasi TLS. Contoh `Caddyfile` (auto Let's Encrypt):
  ```
  hanoman.example.com {
      reverse_proxy 127.0.0.1:8787
  }
  ```
  `HOST=0.0.0.0` hanya bila ada TLS di depannya. Lakukan `setup` segera pada deploy pertama (jendela
  0-user terbuka sampai akun pertama dibuat).
- **Kredensial Claude**: sesi memakai auth Claude Code (Keychain macOS / `~/.claude/.credentials.json` /
  env `CLAUDE_CODE_OAUTH_TOKEN`|`ANTHROPIC_API_KEY`); tak pernah ke client. Private key VPS ada sebagai
  file di server (`Vps.keyPath`), tak pernah di DB.
- **Guardrail perintah**: DICABUT sepenuhnya (SPEC-197, [ADR-0037](../adr/0037-cabut-guardrail-safety.md)).
  Sesi jalan `--dangerously-skip-permissions` tanpa hook deny apa pun — agen dipercaya penuh, setara
  developer yang menjalankan `claude` di mesinnya sendiri. Batas kerusakan satu-satunya adalah isolasi worktree.
- **Sesi sebagai root (VPS)**: claude CLI menolak `--dangerously-skip-permissions` saat `uid 0`
  (`"cannot be used with root/sudo privileges for security reasons"` lalu `exit(1)`) — di VPS, tempat
  hanoman lazim jalan sebagai root, akibatnya SETIAP sesi claude lahir lalu mati seketika. `createSession`
  memasang `IS_SANDBOX=1` di env sesi **hanya** bila `process.getuid() === 0` dan hanya untuk agen claude
  (`rootBypassEnv`, `server/src/services/pty.ts`) — jalan keluar resmi gerbang itu di CLI. Ini tidak
  menurunkan batas keamanan apa pun: sikap kepercayaan penuh sudah diputuskan di ADR-0037, dan menolak
  bypass hanya membuat sesi mati, bukan membuat eksekusi lebih terkurung. Sesi non-claude (Console VPS
  `ssh`, terminal biasa, codex) tak menyentuh env ini. Menjalankan hanoman sebagai user non-root tetap
  lebih disukai bila lingkungan memungkinkan.
- **Isolasi**: sesi di worktree terpisah (`.worktrees/<id>`); tak ada akses ke working tree utama.
  Sejak ADR-0037 ini adalah satu-satunya batas keamanan yang tersisa.
- **Markdown repository adalah input tidak tepercaya** (SPEC-759): seluruh preview dashboard wajib
  melewati `MarkdownView`/`hnDocHtml` di `src/src/ds/markdown.tsx`. Hasil `marked.parse()` **selalu**
  disanitasi DOMPurify dengan allowlist HTML eksplisit sebelum masuk `dangerouslySetInnerHTML`:
  SVG/MathML, script/style, iframe/object/embed/form, event handler, inline style, `data-*`, dan
  `aria-*` dibuang. URL hanya boleh relatif atau memakai `http:`/`https:`; `mailto:` juga boleh pada
  `href`. Pemeriksaan scheme menormalkan case serta whitespace/control sehingga entity/malformed
  HTML tak dapat menyelundupkan `javascript:`/`data:`/`vbscript:`. Checkbox GFM dipaksa `disabled`;
  kelas CSS dibatasi ke task-list dan `language-*`. Parse/sanitasi gagal → sumber di-escape ke `<pre>`,
  bukan dipasang mentah. Jangan membuat pemanggilan `marked.parse()` atau renderer Markdown kedua.
- **Help Center publik (SPEC-253, [ADR-0062](../adr/0062-help-center-tiket-publik-triase.md))**:
  `/api/help/*` adalah **pengecualian sah** gate `/api` — dipanggil pengguna akhir tanpa sesi login.
  Gate cookie di-bypass untuk prefix `/api/help` (cermin pola `/api/sync`); route mengotorisasi sendiri.
  - **Otorisasi non-cookie**: submit/info oleh `Project.helpEnabled` (nonaktif/project asing → **404
    generik**, tak enumerasi); cek status oleh **kunci opaque tiket** `hnm_tkt_<hex>`, disimpan
    **hash-at-rest** `sha256(key)` (**@unique**, `accessKeyHash` **TAK PERNAH** ke client/log), lookup
    by hash + diverifikasi milik slug (404 tanpa membocorkan keberadaan tiket/project lain). Plaintext
    kunci hanya ditampilkan **sekali** di layar setelah submit.
  - **Isolasi antar-project**: query tiket/lampiran selalu ber-scope `projectId`; satu Help Center tak
    pernah membaca/menulis tiket project lain.
  - **Lampiran**: berkas di `HANOMAN_UPLOAD_DIR` (server-local, **di luar repoDir, tak disync**), nama
    opaque `uuid+ext` (bukan input user → tanpa path traversal), disajikan **hanya ber-auth**
    (`GET /api/tickets/:id/attachments/:attId` di belakang gate); halaman status publik tak menampilkannya
    balik. Batas: ≤3 berkas, ≤5MB, mime gambar; invalid di-skip (submit sisanya tetap jadi).
  - **Ketahanan**: rate-limit token-bucket in-memory **per IP & per project** (429) + **honeypot**
    (`hc_trap` terisi → 200 palsu, tak buat tiket) + caps field. **Bukan** anti-spam berat (tanpa
    CAPTCHA/verifikasi email) — spam disaring saat triase (Non-goal PRD). PII isi/lampiran disimpan apa
    adanya (scrub pasca-MVP). SPEC-352: nama honeypot WAJIB netral bagi autofill (`hp` = "handphone"
    diisi browser untuk pelapor sungguhan) dan atributnya `autocomplete="new-password"`, bukan `off`
    yang diabaikan browser; honeypot yang menyala WAJIB meninggalkan jejak log agar false positive
    teramati. Rate-limit per IP **short-circuit** — IP yang jatahnya habis tak boleh ikut menguras
    bucket per-project bersama (amplifikasi 429 ke pelapor lain).
- **Agent token — akses AI agent (SPEC-257, [ADR-0065](../adr/0065-ai-agent-capability-agent-token.md))**:
  **jalur auth kedua** ke seluruh `/api` di samping cookie sesi. Agen eksternal mengirim
  `Authorization: Bearer <token>` (upgrade WebSocket: `?agent_token=`); gate `onRequest` yang sama
  memverifikasi lalu menegakkan **capability**. Cookie sesi **berperan `admin`** tetap = akses penuh;
  sejak SPEC-617/ADR-0110 cookie berperan `client` tergerbang allowlist tersendiri (lihat Auth di atas),
  dan `/portal`/`/client-accounts` dipetakan **COOKIE_ONLY** sehingga agent token tak menjangkaunya.
  - **Master switch**: `Setting.agentAccessEnabled` (default **false**). Off → semua agent token ditolak
    **401**, apa pun `enabled`/capability-nya. Human menyalakannya di Settings.
  - **Token hash-at-rest**: `AgentToken.tokenHash = sha256(token)` + `timingSafeEqual` (pola `DeviceToken`).
    Plaintext (`hnm_agt_<hex>`) hanya ditampilkan **sekali** saat create; `tokenHash` **tak pernah** ke
    client/log (`AgentTokenView` hanya `tokenPrefix`). Revocable instan (`revokedAt`) + disable per-token
    (`enabled`). `lastUsedAt` = audit ringan.
  - **Capability per-domain read/write** (`"<domain>:<access>"`, write⊇read; 9 domain, katalog di
    `@hanoman/shared`). Route→capability dipetakan `services/agent-capabilities.ts`; agen tanpa capability
    → **403** `{ need }`. Read-only global (`/limits`,`/update`,`/events`,`/fs`) → token ber-capability apa pun.
  - **Tak-boleh-didelegasikan** (agent token → **403** apa pun capability): `/auth/*` (kelola user),
    `/agent-tokens*` (**anti privilege-escalation** — agen tak mencetak/menaikkan token), `/device-tokens*`,
    `/sync*`. Kelola token & master switch = **cookie-only**. Route tak dikenal peta → default cookie-only.
  - **Bukan perluasan permukaan eksekusi**: `sessions:write` = RCE (spawn `claude --dangerously-skip-permissions`)
    & `vps:write` = remote exec tetap dibatasi **isolasi worktree** (ADR-0037) — agent token hanya membuka
    pintu API yang sama lewat auth berbeda, bukan menambah kemampuan baru.
- **Transkrip sesi tersimpan (SPEC-362, [ADR-0079](../adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md))**:
  riwayat sesi menyimpan **snapshot layar** tiap sesi yang ditutup — data baru yang sebelumnya tak
  pernah ada di disk hanoman. ADR-0047 dulu **sengaja** melarangnya masuk `SessionResult`; ADR-0079
  membuka pengecualian **terbatas dan eksplisit**, dengan pagar berikut:
  - **LOCAL-only.** `SessionHistory` tak masuk record-sync dan berkas transkripnya tak pernah
    menyeberang ke hub (cermin `Vps.keyPath` & upload lampiran: berkas server-local, di luar repoDir).
  - **Berkas, bukan kolom.** Isi hidup di `HANOMAN_TRANSCRIPT_DIR` (`services/transcript-store.ts`),
    nama berkas opaque (`<uuid>.log`) dan di-`basename` sebelum menyentuh disk. DB hanya memegang
    pointer + ukuran. Batas 1 MiB menyimpan ekor.
  - **Teks polos.** `capture-pane` dijalankan **tanpa `-e`**, jadi tak ada ANSI yang tersimpan maupun
    dirender; UI menampilkannya di `<pre>` — bukan `dangerouslySetInnerHTML`, bukan ANSI-ke-HTML.
  - **Tergerbang seperti sesi.** Endpoint ada di bawah prefix `/terminal`, jadi ia mewarisi gate cookie
    (ADR-0028) dan capability `sessions` (ADR-0065) tanpa domain baru.
  - **Isinya sekelas isi repo** (kode, path, output perintah), bukan kredensial: rahasia yang hanoman
    pegang (Keychain, `~/.claude/.credentials.json`, `Vps.keyPath`) tak pernah dicetak ke pane.
  - **Purge manual ber-scope** (`projectId` dan/atau `before`, minimal satu) adalah satu-satunya
    penghapusan, dan ia ikut membuang berkas transkripnya — tak ada retensi otomatis.
- **Telegram gateway (SPEC-476, [ADR-0096](../adr/0096-telegram-gateway-session-operator-persisten.md))**:
  - Bot token tak pernah masuk session, dan tidak ada secret plaintext di
    log/prompt/transkrip/memory/audit/respons. Sejak SPEC-477 ia boleh hidup di DB, **terenkripsi**
    (butir di bawah) — sebelumnya env-only.
  - Hanya private chat + numeric user id allowlisted; inbound divalidasi, ber-rate-limit durable,
    idempoten `update_id`, dan tidak disimpan isi teksnya (audit memakai digest).
  - Session operator memakai API existing dengan AgentToken/capability. Identitas token gateway wajib
    correlation update id; audit menyimpan method/path/status saja, tanpa body/header.
  - DELETE/integrate/reset/clean/drop/update/harden/remediate/revert destruktif membutuhkan confirmation
    inline approved yang terikat chat/update/method/path, expiring, dan single-use. Capability dan pagar
    endpoint existing tetap ditegakkan sesudahnya.
  - Reply hanya amplop eksplisit tersanitasi; raw PTY/capture-pane dilarang menjadi chat meski ANSI
    sudah dibuang, karena tetap dapat memuat reasoning, command echo, atau credential.
- **Secret config at-rest & pagar kredensial (SPEC-477, [ADR-0097](../adr/0097-kredensial-telegram-di-settings-terenkripsi.md))**:
  - Setiap nilai `RuntimeConfig` yang entrinya ber-`kind: "secret"` disimpan **terenkripsi
    AES-256-GCM** (`enc:v1:<iv>:<tag>:<ciphertext>`). Kuncinya 32 byte di
    `<HANOMAN_HOME>/secret.key` mode `0600`, dibuat otomatis; `HANOMAN_SECRET_KEY` adalah override
    opsional. Berlaku untuk bot token & AgentToken Telegram, `SYNC_DEVICE_TOKEN`, `GITHUB_TOKEN`,
    `ANTHROPIC_API_KEY`, dan `CLAUDE_CODE_OAUTH_TOKEN`. Cache in-memory memegang plaintext; DB tidak.
  - Baris plaintext yang ditulis sebelum SPEC-477 tetap terbaca dan naik kelas saat ditulis ulang.
    Ciphertext yang tak bisa didekripsi diperlakukan **absen** (fail-soft), bukan fatal saat boot.
  - `PUT`/`DELETE /api/config` untuk entri berkategori `credential` **menolak agent token (403)** —
    hanya sesi cookie admin. Demikian pula `/api/telegram/{settings,test,credentials}` yang
    `COOKIE_ONLY`. Ini menutup jalur nyata: AgentToken gateway Telegram wajib memegang
    `settings:write`, sehingga tanpa pagar itu sesi operator bisa menulis ulang kredensialnya sendiri.
  - `GET` kredensial tak pernah mengembalikan secret utuh — hanya `masked` (`••••` + 4 karakter
    terakhir) + `hasValue`. Galat Test Connection dilewatkan redaksi token dua lapis.
  - `secret.key` wajib ikut dicadangkan bersama berkas DB; kehilangannya membuat secret tersimpan
    tak terbaca (instance tetap boot, nilainya harus diisi ulang).

## Webhook keluar (SPEC-481 · [ADR-0100](../adr/0100-webhook-keluar-peristiwa.md))

- **Pengelolaan endpoint COOKIE_ONLY.** Seluruh prefix `/api/webhooks` dipetakan `COOKIE_ONLY` apa
  pun method-nya. Permukaan ini memegang secret penandatanganan **dan** menentukan ke mana data
  workspace mengalir keluar; tak ada capability yang cukup untuk itu. Preseden `/telegram/
  {settings,test,credentials}` (ADR-0097).
- **Secret per endpoint.** 32 byte acak, disimpan **terenkripsi** (`services/secret-box.ts`,
  AES-256-GCM, kunci `<HANOMAN_HOME>/secret.key` mode `0600`). Dikembalikan **plaintext sekali**
  saat dibuat atau dirotasi (pola AgentToken); `GET` hanya mengembalikan empat karakter terakhir
  sebagai `secretHint`, dan secret tak pernah masuk log. Ciphertext yang tak bisa dibuka membuat
  pengiriman **gagal dengan alasan jelas** — tak pernah dikirim tanpa tanda tangan, karena penerima
  yang lalai akan menerimanya.
- **Tanda tangan & anti-replay.** `X-Hanoman-Signature: v1=<hex>` = HMAC-SHA256 atas
  `<timestamp>.<raw body>`; timestamp ikut ditandatangani lewat `X-Hanoman-Timestamp`. Penerima
  diminta membandingkan dengan perbandingan waktu-tetap **atas byte mentah** (serialisasi ulang
  mengubah byte) dan menolak selisih waktu > **300 detik**.
- **Data sensitif tak pernah ikut payload.** Isi amplop dibatasi **allowlist field** per entitas di
  `WEBHOOK_ENTITIES` — yang tak disebut tak pernah keluar. Test DMMF menjaga nama kolomnya tetap
  nyata; notifikasi bertipe `webhook` sengaja tak difan-out agar kegagalan satu endpoint tak
  mengirim lalu lintas ke endpoint lain.
- **Pagar SSRF dua lapis, dengan batas yang dinyatakan.** Saat **simpan**: hanya `http`/`https`,
  tanpa kredensial di URL, tolak IP literal privat/loopback/link-local/ULA/multicast dan
  `localhost` — tanpa menyentuh DNS, supaya pendaftaran endpoint tak bergantung jaringan. Saat
  **setiap percobaan kirim**: resolve DNS dan tolak bila **satu pun** alamat hasilnya internal;
  DNS yang tak menjawab dibaca **gagal-tertutup**. Keduanya bisa dibuka per endpoint lewat
  `allowPrivate` yang eksplisit. **Jendela DNS rebinding tetap ada** (antara resolve dan connect) —
  dipersempit, tidak ditutup; ini dinyatakan apa adanya di halaman dokumentasi in-app.
- **Batas laju & ukuran.** Token bucket per endpoint (`maxPerMinute`), antrean per endpoint dibatasi
  1000 kiriman menunggu (kelebihannya tercatat `dropped` — terlihat, bukan hilang diam-diam), dan
  amplop dipangkas bertahap di 64 KiB dengan penanda `truncated`/`truncatedFields`.
