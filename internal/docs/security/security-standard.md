# Security standard

- **Ingress publik dan control plane (SPEC-761, [ADR-0117](../adr/0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md))**:
  production wajib mengisi exact origin `HANOMAN_PUBLIC_ORIGINS` dan `HANOMAN_CONTROL_ORIGINS` yang
  berbeda. Host publik hanya melayani dashboard statis, `GET /api/health`, dan `/api/help/**`; seluruh
  route control-plane ditolak. Host control menolak `/api/help/**` dan wajib berada di belakang
  SSO/MFA, VPN, atau access proxy. Origin langsung bind loopback dan firewall tidak membuka port app.
  `HANOMAN_TRUST_PROXY` wajib berupa jumlah hop atau CIDR reverse proxy eksplisit; `true` dilarang.
- **Auth (SPEC-169, ADR-0028 diamandemen ADR-0117)**: login email/password menggerbangi seluruh
  control-plane `/api`; upgrade WebSocket memakai admission tersendiri di bawah.
  - Password: `crypto.scrypt` (stdlib) + salt acak + `timingSafeEqual`. Tak pernah dikembalikan ke client.
  - Sesi: token opaque 256-bit di cookie `httpOnly`; DB menyimpan `sha256(token)`, bukan token mentah.
    Revocable — logout/ganti-password/hapus-user mencabut sesi. Cookie `httpOnly` + `sameSite=strict`
    + `secure` (prod) + `maxAge` 7 hari.
  - Login dan setup di-throttle per alamat hasil trusted-proxy policy; limiter TTL/LRU dibatasi jumlah
    key sehingga alamat palsu tidak menumbuhkan memori tanpa batas. Error login selalu generic.
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
  - Bootstrap akun pertama hanya di host control dan membutuhkan token one-time 32-byte dari
    `$HANOMAN_HOME/setup.token` (0600), kedaluwarsa 15 menit. Create memakai id unik tetap dalam
    transaksi; race menghasilkan tepat satu admin, token dihapus sesudah commit, dan route selamanya
    menjawab 409 sesudah user pertama ada. Nilai token tidak dicetak ke log—hanya path dan expiry.
- **TLS / deployment**: cookie `Secure` butuh HTTPS. Production selalu bind `127.0.0.1`; tidak ada
  pengecualian `0.0.0.0`. Topologi normatif dan contoh unit ada di [deploy-vps](../operations/deploy-vps.md).
- **Kredensial Claude**: sesi memakai auth Claude Code (Keychain macOS / `~/.claude/.credentials.json` /
  env `CLAUDE_CODE_OAUTH_TOKEN`|`ANTHROPIC_API_KEY`); tak pernah ke client. Private key VPS ada sebagai
  file di server (`Vps.keyPath`), tak pernah di DB.
- **Boundary eksekusi agen**: API/worker production wajib berjalan sebagai user dedicated non-root.
  Semua agen—sesi tmux serta lead/changelog one-shot—dibentuk lewat `session-sandbox.ts` dan berjalan
  di Podman rootless: root filesystem read-only, capability none, no-new-privileges, PID/memory/CPU
  limit, tmpfs private, credential khusus read-only, dan internal network lewat egress allowlist proxy.
  Sesi mendapat hanya worktree-nya read-write; agen one-shot mendapat repo read-only dan prompt 0600.
  Worktree tetap boundary Git, bukan boundary filesystem/process/network/security.
- **Guardrail perintah**: hook deny tetap dicabut (SPEC-197, ADR-0037 diamandemen ADR-0117). Flag
  permission-bypass tetap ada **di dalam sandbox OS**; jangan menghidupkan blacklist command sebagai
  pengganti sandbox.
- **Otoritas launch efektif**: `Spec.launchApprovedAt/By` adalah state LOCAL-only. Cookie admin atau
  AgentToken dengan `sessions:write` dapat memberi approval; `settings:write`, `projects:write`, dan
  `backlog:write` tidak. `startSpecSession()` memeriksa approval tepat sebelum efek worktree/tmux,
  sehingga scheduler, governor, lead, cron, dan wrapper lain tidak dapat melewati gerbang akhir.
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
    balik dan selalu `Content-Disposition: attachment`, `nosniff`, CSP `sandbox`. Batas: ≤3 berkas,
    5 MiB/file, 10 MiB/tiket, 250 MiB/project, 1 GiB/global. Magic byte wajib cocok MIME, image harus
    lolos decode serta batas 12k dimensi/40M pixel, lalu di-re-encode sebelum quarantine 0600.
    Production fail-closed tanpa executable scanner absolut `HANOMAN_UPLOAD_SCANNER`; scanner berjalan
    tanpa shell, timeout 15 detik, dan hanya hasil bersih yang dipromosikan atomik.
  - **Ketahanan**: limiter bounded TTL/LRU **per IP & per project** (429) + **honeypot**
    (`hc_trap` terisi → 200 palsu, tak buat tiket) + caps field. **Bukan** anti-spam berat (tanpa
    CAPTCHA/verifikasi email). Triase otomatis hanya membuat notifikasi review: ia tidak membuat Spec,
    enqueue, atau launch. Saat admin menerima tiket, semua field dibingkai sebagai
    `UNTRUSTED_TICKET_DATA`; instruksi di dalam tiket/lampiran bukan instruksi agen. SPEC-352: nama
    honeypot WAJIB netral bagi autofill (`hp` = "handphone"
    diisi browser untuk pelapor sungguhan) dan atributnya `autocomplete="new-password"`, bukan `off`
    yang diabaikan browser; honeypot yang menyala WAJIB meninggalkan jejak log agar false positive
    teramati. Rate-limit per IP **short-circuit** — IP yang jatahnya habis tak boleh ikut menguras
    bucket per-project bersama (amplifikasi 429 ke pelapor lain).
- **Agent token — akses AI agent (SPEC-257, [ADR-0065](../adr/0065-ai-agent-capability-agent-token.md))**:
  **jalur auth kedua** ke seluruh `/api` di samping cookie sesi. Agen eksternal mengirim
  `Authorization: Bearer <token>`; credential tidak diterima dari query. Gate `onRequest` yang sama
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
  - **Efek transitif**: capability route bukan bukti launch. Hanya `sessions:write` boleh menulis
    launch approval; gate final launcher tetap berlaku walau token mengubah scheduler/project/backlog.
- **WebSocket**: browser meminta tiket target-spesifik lewat `POST /api/ws-tickets`, mengirimnya sekali
  melalui subprotocol `hanoman-ticket.<token>`, dan tidak menaruh credential di URL. Tiket hidup 30
  detik, one-use, serta bounded; exact `Origin` scheme/host/port harus ada di control allowlist.
  **Tanpa `HANOMAN_CONTROL_ORIGINS`, allowlist itu diturunkan dari `Host` request** (same-origin,
  kedua scheme) alih-alih kosong — lihat "Default same-origin" di bawah. Production tak ikut:
  di sana env-nya wajib dan boot gagal tanpanya.
  Maksimum payload 64 KiB, 120 pesan/menit, dan 8 koneksi/principal. Sesi diverifikasi ulang setiap
  60 detik dan sebelum input terminal diterapkan. Sync machine-to-machine memakai Bearer header.
  - **Default same-origin (`wsAllowlistFor`)**: allowlist yang kosong dulu berarti **tolak semua**,
    dan karena instalasi polos (`npm i -g hanoman` → `hanoman`) tak pernah menyetel
    `HANOMAN_CONTROL_ORIGINS`, seluruh WebSocket browser ditolak 401 — `events` **dan**
    `terminal:<id>` — sehingga terminal kosong sejak paket dipasang walau tmux dan REST sehat.
    Di luar production allowlist itu kini diturunkan dari `Host` request: `http://<host>` +
    `https://<host>` (plus bentuk tanpa port bila proxy menulis `:80`/`:443`). Pencocokannya tetap
    **exact** lewat `assertWsOrigin` — yang berubah hanya sumber daftarnya, bukan ketatnya.
  - **Kenapa ini tidak melemahkan CSWSH**: halaman lintas-situs tetap ditolak karena Origin-nya tak
    pernah sama dengan Host dashboard, dan lapis utamanya tetap tiket one-use 30 detik yang hanya
    bisa diambil lewat `POST /api/ws-tickets` bercookie (`sameSite=strict`) — tak terbaca dari
    origin lain. Scheme tak dibandingkan karena di belakang proxy TLS server hanya melihat `Host`
    tanpa scheme; menuntut kecocokan scheme akan menolak tunnel yang sah.
  - **Production tetap fail-closed** (ADR-0117): `wsAllowlistFor` mengembalikan set kosong apa adanya
    saat `NODE_ENV=production`, dan `assertRuntimeBoundary` sudah menolak boot tanpa origin split.
    Deployment publik karena itu tak pernah bergantung pada `Host` yang datang dari luar.
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
  - Retensi otomatis bounded menghapus sesi berakhir >30 hari; purge manual scoped tetap tersedia.
    Delete file gagal mempertahankan record DB untuk retry; `HANOMAN_RETENTION_HOLDS` mengecualikan
    `session:<id>`, `ticket:<id>`, `delivery:<id>`, atau `result:<id>` yang wajib dipertahankan.
- **Permission dan lifecycle data**: process memasang umask 0077. `$HANOMAN_HOME`, uploads,
  transcripts, quarantine, dan direktori prompt memakai 0700; DB, `secret.key`, setup token, upload,
  transcript, dan prompt memakai 0600. Symlink final ditolak. Sweep harian/batch 100 menghapus tiket
  accepted/rejected >90 hari, tiket new >180 hari, SessionHistory >30 hari, WebhookDelivery terminal
  >30 hari, dan SessionResult >90 hari; dry-run API internal melaporkan row/byte tanpa menghapus.
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
    `SYNC_SERVER_URL` juga termasuk kategori sensitif: perubahan URL dan pengosongan
    `SYNC_DEVICE_TOKEN` terjadi atomik, client berhenti, lalu pairing/token baru wajib dilakukan.
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
- **Pagar SSRF address-pinned dan no-redirect.** Saat **simpan**: hanya `http`/`https`,
  tanpa kredensial di URL, tolak IP literal privat/loopback/link-local/ULA/multicast dan
  `localhost` — tanpa menyentuh DNS, supaya pendaftaran endpoint tak bergantung jaringan. Saat
  **setiap percobaan kirim**: resolve seluruh A/AAAA, tolak bila satu pun internal/private/metadata,
  lalu koneksi dipin ke alamat yang sudah divalidasi sambil mempertahankan Host dan TLS SNI. DNS gagal
  tertutup. Semua 3xx adalah kegagalan terminal; body, auth, dan signature tidak pernah diteruskan ke
  hop kedua. `allowPrivate` hanya membuka alamat privat eksplisit—tidak menghidupkan redirect.
  **Pinning-nya wajib menjawab bentuk `all: true`.** Node ≥ 20 menyalakan `autoSelectFamily` secara
  default, jadi socket memanggil hook `lookup` dengan `all: true` dan membaca `addresses[0].address`
  dari jawabannya; menjawab dalam bentuk skalar `(err, address, family)` memberi `undefined` →
  `ERR_INVALID_IP_ADDRESS` **sebelum satu paket pun keluar**. Kegagalannya senyap dan tampak seperti
  jaringan: pemanggilnya (tick sync, antrean webhook) menelan lemparan itu sebagai "offline", jadi
  sync mati total tanpa satu baris log pun. Test yang memakai URL ber-**IP literal** tak bisa
  menangkapnya — untuk itu Node melewati `lookup` sama sekali; hanya URL ber-**hostname** yang
  menyalakan jalur ini.
- **Batas laju & ukuran.** Token bucket per endpoint (`maxPerMinute`), antrean per endpoint dibatasi
  1000 kiriman menunggu (kelebihannya tercatat `dropped` — terlihat, bukan hilang diam-diam), dan
  amplop dipangkas bertahap di 64 KiB dengan penanda `truncated`/`truncatedFields`.
