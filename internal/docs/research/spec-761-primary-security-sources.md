# SPEC-761 — bukti sumber primer untuk hardening public deployment

**Tanggal verifikasi:** 2026-08-14

**Cakupan:** AC-01–AC-13 · riset read-only, tanpa active DAST produksi

Catatan ini melengkapi audit source-code SPEC-761 dengan perilaku platform dan pedoman upstream.
Ia bukan pengganti threat model, spec, atau ADR. Implikasi di bawah adalah batas minimum yang perlu
dibawa ke desain Hanoman.

## Baseline repo yang memerlukan hardening

- `server/src/app.ts` membuat Fastify dengan `trustProxy: true`; `req.ip` kemudian menjadi kunci
  throttle login dan Help Center.
- `server/src/routes/terminal.ts` tidak memeriksa `Origin`, ukuran, atau laju frame WebSocket;
  `server/src/services/agent-auth.ts` masih menerima `?agent_token=`.
- `server/src/services/webhooks/sender.ts` memanggil `fetch()` tanpa `redirect: "manual"`; validasi
  SSRF hanya dilakukan terhadap URL awal sebelum fetch.
- `server/src/routes/auth.ts` melakukan `user.count()` lalu `user.create()` sebagai dua operasi dan
  setup tidak memiliki bootstrap secret.
- `server/src/services/help-ratelimit.ts` dan `server/src/services/auth.ts` memakai `Map` tanpa
  eviction; `server/src/services/uploads.ts` mempercayai MIME dari multipart dan membuat direktori /
  berkas tanpa mode eksplisit.
- Contoh unit `internal/docs/operations/deploy-vps.md` memakai `User=root` dan belum menetapkan
  `WorkingDirectory` atau `UMask`.

## Implikasi per acceptance criterion

### AC-01 — pisahkan permukaan publik dan control plane

[OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html#management-endpoints)
menyarankan management endpoint tidak diekspos ke internet; bila terpaksa, gunakan autentikasi kuat
(MFA) dan host/port/NIC serta subnet/firewall terpisah. [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final)
menetapkan autentikasi dan otorisasi subject/device sebelum sesi ke resource dibuat, tanpa implicit
trust hanya karena lokasi jaringan.

**Implikasi Hanoman:** `/help`/status boleh berada pada public ingress, tetapi dashboard, PTY,
settings, scheduler, webhook, sync, IDE, dan VPS perlu ingress/policy enforcement terpisah di belakang
SSO/MFA atau VPN/access proxy. Origin aplikasi tetap loopback dan firewall-deny; password aplikasi
saja bukan pengganti pemisahan control plane.

### AC-02 — tiket dan lampiran adalah data, bukan instruksi agen

[OWASP LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
menyatakan konten eksternal harus diperlakukan tidak tepercaya; untuk agen ber-tool, scope tool harus
least-privilege, setiap tool call dinilai terhadap intent asli, dan tindakan berisiko memerlukan
human approval. Pola terkuat yang dijelaskan adalah pemisahan model karantina yang membaca konten
dari model privileged yang dapat bertindak. [OWASP AI Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
juga meminta test adversarial untuk prompt override, privilege escalation, dan tool abuse.

**Implikasi Hanoman:** intake Help tidak boleh otomatis mencapai `startSpecSession()`/scheduler/
lead sebagai prompt bagi sesi `--dangerously-*`. Default aman adalah triase manusia; bila otomasi
dipertahankan, worker karantina tidak memiliki secret, filesystem host, PTY, atau egress bebas dan
hanya mengeluarkan schema terstruktur yang divalidasi sebelum tindakan lain.

### AC-03 — setting sync adalah tujuan eksfiltrasi dan perubahan kredensial berisiko tinggi

[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#reauthentication-after-risk-events)
meminta reauthentication untuk perubahan berisiko tinggi, dan memperingatkan session/token di URL
dapat bocor melalui log, history, bookmark, dan referrer. [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html#sensitive-information-in-http-requests)
juga melarang security token/API key di URL.

**Implikasi Hanoman:** perubahan `SYNC_SERVER_URL` serta device token harus cookie-admin-only atau
capability sensitif tersendiri dengan reauthentication. Transaksi perubahan endpoint harus sekaligus
menghapus credential lama, memutus koneksi lama, dan mewajibkan pairing ulang; URL baru tidak boleh
mengaktifkan pull/push sampai record masuk lolos schema/ownership validation. Device token hanya di
header dan tidak boleh diteruskan ke host redirect.

### AC-04 — non-root service dan boundary OS bagi sesi agen

[`systemd.exec`](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
mendefinisikan `User=`, `NoNewPrivileges=`, `ProtectSystem=`, `ProtectHome=`, `PrivateTmp=`,
`RestrictAddressFamilies=`, `SystemCallFilter=`, `WorkingDirectory=`, serta direktori state dengan
ownership terkelola. [`systemd.resource-control`](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)
menyediakan `MemoryMax=`, `TasksMax=`, dan `IPAddressAllow=`/`IPAddressDeny=`. Dokumentasi upstream
[Podman rootless](https://github.com/containers/podman#rootless) menjelaskan container rootless tidak
dapat memperoleh privilege melebihi user yang meluncurkannya.

**Implikasi Hanoman:** API/CLI supervisor harus berjalan sebagai user khusus non-root. Hardening unit
systemd mengurangi blast radius service, tetapi tidak cukup untuk sesi agen yang sengaja menjalankan
shell penuh; setiap sesi perlu rootless container/VM (atau boundary OS setara), mount allowlist,
tanpa home/credential host, resource limits, dan egress allowlist. Ini perubahan model isolasi dan
harus diikat ADR baru, bukan menghidupkan kembali hook deny ADR-0037.

### AC-05 — otorisasi harus mengikuti efek efektif

[OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
meminta least privilege, deny-by-default, validasi permission pada setiap request, dan test unit/
integrasi atas authorization logic. [OWASP API5:2023](https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/)
menekankan bahwa letak URL tidak membuktikan suatu fungsi non-administratif dan semua fungsi harus
memerlukan grant eksplisit.

**Implikasi Hanoman:** capability tidak boleh dinilai hanya pada mutasi awal. Setiap effect sink yang
dapat melahirkan sesi (`startSpecSession`, cron, governor, lead, scheduler drain, konfigurasi opt-in)
harus membawa actor/authority dan menuntut `sessions:write`, atau hanya menerima cookie admin.
Matriks negatif harus membuktikan gabungan `settings:write + projects:write + backlog:write` tetap
tidak dapat mencapai spawn.

### AC-06 — containment canonical dan descriptor-safe

[Node `fs`](https://nodejs.org/api/fs.html) mendokumentasikan bahwa `realpath()` menyelesaikan `.`,
`..`, dan symlink; `lstat()` memeriksa link itu sendiri; dan `O_NOFOLLOW` membuat open gagal bila
komponen terakhir adalah symlink. Pada Linux, [`openat2(2)`](https://man7.org/linux/man-pages/man2/openat2.2.html)
menyediakan `RESOLVE_BENEATH` dan `RESOLVE_NO_SYMLINKS` untuk seluruh komponen path, berbeda dari
`O_NOFOLLOW` yang hanya melindungi komponen terakhir.

**Implikasi Hanoman:** `resolve()+startsWith()` di scan/IDE/Git/review bukan containment. Read harus
`lstat`/`realpath` target dan root lalu membandingkan boundary path canonical. Write perlu membuka
parent/target tanpa mengikuti link, bekerja melalui descriptor bila primitive platform tersedia,
dan memverifikasi ulang sebelum commit/rename. Test wajib meliputi symlink file/direktori, nested,
dangling, dan link-swap; pada platform tanpa `openat2`, nyatakan residual TOCTOU dan fail closed.

### AC-07 — redirect webhook harus divalidasi per hop

Node menyatakan global [`fetch`](https://nodejs.org/api/globals.html#fetch) adalah implementasi
browser-compatible berbasis Undici. [Fetch Standard, HTTP-redirect fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch)
menetapkan redirect 301/302/303/307/308, batas internal 20 hop, serta mempertahankan method/body
untuk 307/308; ketika origin berubah ia secara khusus menghapus header credential seperti
`Authorization`, bukan header aplikasi arbitrer seperti `X-Hanoman-Signature`. [OWASP SSRF
Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
secara eksplisit meminta redirect client dimatikan untuk mencegah bypass validasi dan meminta seluruh
hasil A+AAAA dinilai terhadap kebijakan jaringan.

**Implikasi Hanoman:** gunakan `redirect: "manual"` sebagai primitive. Setiap `Location` di-resolve
terhadap URL hop sebelumnya, divalidasi ulang (scheme, hostname, DNS A/AAAA, private/reserved range),
hop dibatasi, dan body/HMAC hanya dikirim kembali bila origin diotorisasi. PoC 307 harus menjadi test
regresi tertutup; DNS resolve-then-connect tetap perlu dispatcher yang mengikat koneksi ke alamat yang
sudah divalidasi atau mitigasi network egress untuk menutup rebinding.

### AC-08 — dependency runtime harus dipatch

`pnpm audit --prod --json` pada lockfile worktree ini melaporkan **16 entry: 13 high, 2 moderate,
1 low** pada 203 dependency produksi (4 optional):

| Paket terkunci | Entry / severity | Advisory primer |
| --- | --- | --- |
| `fastify@4.29.1` | 1 high · 1 moderate · 1 low | [GHSA-jx2c-rxcm-jvmq](https://github.com/advisories/GHSA-jx2c-rxcm-jvmq) · [GHSA-444r-cwp2-x5xf](https://github.com/advisories/GHSA-444r-cwp2-x5xf) · [GHSA-mrq3-vjjr-p77c](https://github.com/advisories/GHSA-mrq3-vjjr-p77c) |
| `@fastify/static@7.0.4` | 1 high · 1 moderate | [GHSA-83w8-p2f5-377r](https://github.com/advisories/GHSA-83w8-p2f5-377r) · [GHSA-8pvw-jcv7-9cmj](https://github.com/advisories/GHSA-8pvw-jcv7-9cmj) |
| `find-my-way@8.2.2` | 1 high | [GHSA-c96f-x56v-gq3h](https://github.com/advisories/GHSA-c96f-x56v-gq3h) |
| `fast-uri@2.4.0` dan `3.1.3` | 7 high entries | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) · [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) · [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6) · [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc) · [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) |
| `brace-expansion@2.1.1` | 3 high | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) · [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) · [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |

**Implikasi Hanoman:** ini bukan advisory dev-only: Fastify melayani seluruh API dan
`@fastify/static` melayani dashboard produksi. Upgrade harus membawa pasangan versi Fastify/plugin
yang kompatibel, memperbarui lockfile, menjalankan test route/WS/static yang tersentuh, lalu
`pnpm audit --prod` harus nol critical/high. Exception sementara memerlukan exploitability,
mitigasi, owner, dan deadline per advisory.

### AC-09 — Origin, token, ukuran/laju, dan umur sesi WebSocket

[RFC 6455 §10.2](https://datatracker.ietf.org/doc/html/rfc6455#section-10.2) mengatakan server yang
hanya dimaksudkan untuk site tertentu **SHOULD** memverifikasi `Origin` yang diharapkan dan menjawab
403 untuk origin yang tidak diterima. Upstream [`@fastify/websocket`](https://github.com/fastify/fastify-websocket#options)
mengekspos opsi `verifyClient` dan `maxPayload`. [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
meminta exact origin allowlist, revalidasi session pada koneksi panjang, batas pesan/laju, dan
memperingatkan token query masuk access log.

**Implikasi Hanoman:** handshake terminal/event/sync harus membandingkan exact
`scheme://host[:port]`, bukan suffix/subdomain; non-browser client perlu jalur autentikasi eksplisit.
Ganti query agent token dengan header/subprotocol aman atau tiket WS single-use ber-TTL pendek,
tetapkan `maxPayload`, rate limit frame dan connection, lalu tutup socket ketika session/token
dicabut atau kedaluwarsa.

### AC-10 — bootstrap first admin harus one-time dan atomik

[OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
memberi properti token bootstrap yang dapat dipakai ulang: CSPRNG, cukup panjang, tersimpan aman,
single-use, dan expiring. [SQLite Transactions](https://www.sqlite.org/lang_transaction.html)
menjelaskan hanya ada satu write transaction bersamaan dan `BEGIN IMMEDIATE` memperoleh write
transaction dari awal; Prisma mencatat SQLite hanya mendukung isolation
[`Serializable`](https://www.prisma.io/docs/orm/prisma-client/queries/transactions#transaction-isolation-level).

**Implikasi Hanoman:** token setup dibuat lewat console/env/file mode 0600, di-hash at rest,
ber-TTL dan attempt limit, tidak di URL/log. Consume-token + klaim singleton bootstrap + create admin
harus satu transaksi/conditional write; concurrency test dengan banyak request harus menghasilkan
tepat satu sukses dan semua sisanya 409/unauthorized. Setelah admin ada, route tertutup permanen.

### AC-11 — proxy trust dan rate limiter harus bounded

[Fastify `trustProxy`](https://fastify.dev/docs/latest/Reference/Server/#trustproxy) memperingatkan
`X-Forwarded-*` mudah dipalsukan; `true` berarti mempercayai semua proxy, sedangkan IP/CIDR atau hop
count dapat dibatasi. Fastify juga menegaskan [`request.ip` adalah input tidak tepercaya](https://fastify.dev/docs/latest/Reference/Request/)
untuk keputusan keamanan. Upstream [`@fastify/rate-limit`](https://github.com/fastify/fastify-rate-limit#options)
menggunakan LRU cache berukuran dapat dikonfigurasi atau store durable, dan default key-nya bergantung
pada `request.ip`. [Fastify `bodyLimit`](https://fastify.dev/docs/latest/Reference/Server/#bodylimit)
memberi batas global/per-route; parser custom harus tetap menetapkan limit.

**Implikasi Hanoman:** trust hanya loopback/CIDR reverse proxy yang nyata dan tolak direct origin.
Login, setup, Help, serta WS handshake membutuhkan store ber-eviction/capacity tetap; key diambil dari
socket/proxy chain yang sudah tervalidasi dan, setelah auth, identitas akun/token. Tetapkan body limit
lebih kecil per endpoint sensitif, max connection, dan test bahwa `X-Forwarded-For` spoof tidak
mengganti bucket serta cardinality attacker tidak menumbuhkan memory tanpa batas.

### AC-12 — permission eksplisit dan retensi terukur

[`systemd.exec` `UMask=`](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#UMask=)
mengontrol mode default file proses. Node menjelaskan mode create tetap dipengaruhi umask dan
menyediakan mode eksplisit pada `mkdir`/`open` di dokumentasi [`fs`](https://nodejs.org/api/fs.html).
SQLite menyimpan [`-wal` dan `-shm` di direktori yang sama](https://www.sqlite.org/tempfiles.html)
dengan database, jadi mode DB utama saja tidak cukup. [NIST SP 800-53 Rev. 5, SI-12](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)
meminta penanganan dan retensi informasi sesuai kebijakan serta penghapusan ketika tidak lagi
dibutuhkan.

**Implikasi Hanoman:** buat seluruh `HANOMAN_HOME` dan subdir data `0700`, setiap DB/key/upload/
transkrip/temp prompt/log sensitif `0600`, verifikasi/chmod artefak existing saat startup, dan pasang
`UMask=0077` + `WorkingDirectory=` pada unit. Retensi harus memiliki TTL per kelas data, purge job
bounded dan auditable, legal hold/backup policy, serta test bahwa purge menghapus row dan byte terkait
tanpa menghapus data yang masih diwajibkan.

### AC-13 — upload perlu identifikasi konten, kuota, dan quarantine

[OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
menyatakan `Content-Type` dari client tidak dapat dipercaya; extension, MIME, dan file signature
harus diperiksa bersama, nama harus diganti oleh aplikasi, ukuran dibatasi, file disimpan di luar
webroot/dilayani lewat handler, dan AV/sandbox atau CDR dipakai bila relevan. Panduan yang sama
mencatat ZIP/XML bomb, parser exploit, pengisian disk, dan active-content XSS sebagai threat terpisah.

**Implikasi Hanoman:** decode image dengan library yang dipatch, cocokkan magic bytes + hasil decode
dengan extension/MIME ternormalisasi, strip metadata bila perlu, dan jangan render active content
inline pada origin admin. Terapkan timeout, pixel/dimension/decompression ratio guard, kuota
per-file/per-ticket/per-project/global, atomic reservation sebelum write, quarantine di luar webroot,
serta malware hook yang fail closed (status scan eksplisit sebelum lampiran dapat diunduh/diproses).

## Kesimpulan riset

Sumber primer mendukung seluruh arah AC-01–AC-13. Temuan tidak membentuk quick fix tunggal:
dependency major upgrade, auth/effective-authority, redirect-safe networking, bootstrap atomik,
filesystem API, WebSocket protocol, data lifecycle, dan boundary eksekusi saling melintasi kontrak.
Karena itu audit perlu diteruskan ke Spec → Plan → Execute penuh, dengan test negatif per trust
boundary dan ADR baru khusus perubahan model isolasi eksekusi.
