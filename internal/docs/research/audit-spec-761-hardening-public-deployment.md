# Audit SPEC-761 — hardening public deployment Hanoman

> Tanggal bukti: 2026-08-14 · scope: source code dan konfigurasi deploy di worktree
> `spec-761`; tidak ada DAST aktif ke produksi. SPEC-759 (stored XSS renderer Markdown) adalah
> prasyarat yang sudah selesai dan tidak diaudit ulang.

## Ringkasan keputusan

Semua kelompok finding pada backlog terkonfirmasi. Akar bersamanya adalah trust boundary lama:
Hanoman menganggap bind loopback, cookie admin, dan worktree cukup untuk instance operator tunggal,
sementara deployment publik sekarang menerima input anonim, token capability, reverse-proxy headers,
sync/webhook keluar, dan sesi agen berizin penuh. Worktree hanya mengisolasi state Git; ia tidak
mengisolasi filesystem host, credential, proses, atau jaringan.

Finding ini luas dan mengubah kontrak auth, deploy, filesystem, bootstrap, dan runtime sesi. Karena
itu jalur cepat QA tidak aman: **Spec dan Plan wajib dijalankan**, lalu seluruh AC-01…AC-14
dikerjakan sebagai satu hardening release.

Sumber primer platform/library yang dipakai untuk keputusan desain dicatat terpisah di
[catatan sumber keamanan SPEC-761](spec-761-primary-security-sources.md).

## Metode

- Menelusuri data dari pintu publik/token ke side effect akhir, bukan hanya capability route awal.
- Membandingkan implementasi dengan `security-standard.md`, kontrak API, ADR auth/capability,
  runbook VPS, dan konfigurasi dependency produksi.
- Menjalankan `pnpm audit --prod --json` pada lockfile saat ini.
- Memeriksa jalur filesystem yang menerima path pengguna dan operasi tulis/read aktualnya.
- Memeriksa perilaku fetch redirect berdasarkan PoC lokal yang sudah dilampirkan pada backlog;
  produksi tidak disentuh.

## Temuan dan akar masalah

### F-01 · input Help Center dapat menjadi instruksi sesi agen — critical, confidence tinggi

Alur otomatisnya lengkap dan tidak membutuhkan persetujuan manusia:

1. `POST /api/help/:slug/tickets` menerima `title`, `detail`, dan lampiran anonim
   (`server/src/routes/help.ts`).
2. `checkTriase()` memilih tiket `bug|fitur`, memanggil `acceptTicket()`, lalu langsung
   `enqueue()` (`server/src/services/scheduler/sources/triase.ts`).
3. `acceptTicket()` menyalin teks pelapor ke payload Spec dan mengubah lampiran menjadi direktif
   imperatif “PERIKSA setiap lampiran” dengan path host (`server/src/services/ticket-accept.ts`).
4. Governor meluncurkan Spec sebagai sesi agen berizin penuh ketika scheduler/project opt-in.

Akar masalahnya bukan kurangnya satu escape, melainkan tidak adanya approval boundary antara data
publik dan prompt executable. Otomasi triase harus berhenti pada antrean review; backlog dari tiket
hanya boleh lahir lewat aksi admin yang jelas, dan payload harus dilabel sebagai data tak tepercaya.

### F-02 · perubahan tujuan sync mengekfiltrasi device token dan menerima state asing — critical,
confidence tinggi

`SYNC_SERVER_URL` berkategori `knob`, sehingga `AgentToken settings:write` boleh mengubahnya lewat
`PUT /api/config`; hanya entri kategori `credential` yang cookie-only (`server/src/routes/config.ts`,
`shared/src/config-registry.ts`). `applyConfigSideEffect()` langsung me-restart client. Transport
kemudian mengirim `Authorization: Bearer <SYNC_DEVICE_TOKEN>` ke base baru dan menerapkan record
respons ke DB lokal (`server/src/services/sync-client.ts`).

Perubahan URL dan token adalah dua write terpisah, bukan rotasi atomik. Fetch HTTP mengikuti redirect
secara default, dan token WS juga berada di query. Akar masalahnya adalah endpoint tujuan dianggap
knob biasa padahal ia menentukan tujuan eksfiltrasi. Tujuan sync harus cookie-only, perubahan origin
harus menghapus credential lama secara atomik, transport harus menolak redirect/host berbeda, dan
record masuk harus melewati validasi schema yang ketat sebelum `upsertLocal`.

### F-03 · service root + sesi bypass permission tidak punya boundary OS — critical, confidence tinggi

Runbook resmi masih menetapkan `User=root`, tidak menetapkan `WorkingDirectory`/`UMask`, lalu
`createSession()` menjalankan Claude/Codex dengan bypass permission. `rootBypassEnv()` bahkan
menonaktifkan penolakan root milik Claude supaya sesi tetap hidup. Security standard menyatakan
worktree sebagai satu-satunya isolasi.

Dengan demikian compromise prompt/sesi sama dengan akses user service ke host, credential, socket
tmux, home, dan jaringan. Akar masalahnya adalah boundary Git disalahartikan sebagai boundary
security. Service harus menjadi user dedicated non-root; sesi harus fail-closed di dalam rootless
sandbox/container dengan mount/secret minimum dan egress allowlist. Ini mengubah keputusan
arsitektur ADR-0037 dan memerlukan ADR baru, bukan hook deny tersembunyi.

### F-04 · capability dinilai di route awal, bukan efek efektif — critical, confidence tinggi

Peta route memberi `settings:write` untuk konfigurasi scheduler, `projects:write` untuk opt-in
project, dan `backlog:write` untuk pembuatan backlog. Kombinasi itu cukup untuk menyalakan engine,
menandai project, dan membuat backlog yang kemudian diluncurkan governor. Jalur tiket juga dapat
membuat backlog. Tidak ada pemeriksaan `sessions:write` di side-effect yang akhirnya memanggil
`startSpecSession()`.

Cron sudah cookie-only, tetapi itu hanya satu jalur. Akar masalahnya adalah capability route-centric.
Setiap mutasi yang membuat item menjadi schedulable harus memeriksa otoritas efektif
`sessions:write` atau menjadi cookie-only; scheduler/governor wajib melakukan pemeriksaan kedua agar
state lama atau race tidak dapat melewati gate.

### F-05 · containment filesystem leksikal dapat dilewati symlink — high, confidence tinggi

`repoAbsPath()` dan `docAbsPath()` memakai `resolve()` lalu `startsWith(repoDir + sep)`.
`writeRepoFile()` membuat parent dan `writeFile()` pada path itu; read path memakai `readFile()`.
Symlink file atau direktori yang berada secara leksikal di repo dapat menunjuk ke luar. Jalur review
working-tree juga membaca `join(wt, path)` tanpa canonical containment.

Akar masalahnya adalah validasi nama path, bukan objek filesystem yang dibuka. Choke point baru harus
memakai `realpath`/`lstat` per komponen, menolak dangling/escape, membuka final component dengan
`O_NOFOLLOW`, dan menulis lewat file descriptor/temp file yang aman. Test wajib mencakup symlink file,
direktori, nested, dangling, dan link yang diganti sebelum operasi.

### F-06 · webhook memvalidasi URL awal tetapi fetch mengikuti redirect — critical, confidence tinggi

`sendOnce()` memanggil `checkDestination()` sekali untuk URL endpoint, lalu global `fetch()` tanpa
`redirect:"manual"`. PoC 307 lokal pada backlog membuktikan Node meneruskan POST body dan
`X-Hanoman-Signature` ke Location. DNS juga di-resolve untuk validasi lalu di-resolve lagi saat
connect, menyisakan rebinding window yang sudah diakui ADR-0100.

Akar masalahnya adalah validator dan koneksi tidak berbagi tujuan konkret. Pengiriman harus memakai
request tanpa redirect dan alamat hasil resolusi yang dipin ke koneksi; respons 3xx gagal-tertutup.
Test harus mencakup 301/302/307/308, IPv4/IPv6/private range, multi-address DNS, dan rebinding.

### F-07 · dependency produksi memiliki advisory runtime — high, confidence tinggi

`pnpm audit --prod --json` melaporkan **16 advisory**: 13 high, 2 moderate, 1 low. Jalur runtime
mencakup Fastify 4.29.1, `@fastify/static` 7.0.4, `find-my-way` 8.2.2, `fast-uri` 2.4.0/3.1.3,
dan `brace-expansion` 2.1.1. Advisory high mencakup route/path guard bypass, content-type validation
bypass, host confusion/path traversal, DDoS, dan expansion OOM.

Akar masalahnya adalah rentang major lama yang tak lagi menerima patch advisory terbaru. Seluruh
keluarga Fastify harus dinaikkan sebagai unit kompatibel, lockfile diperbarui, lalu audit produksi
harus nol critical/high yang berlaku pada runtime.

### F-08 · WebSocket bergantung cookie/query token tanpa Origin policy dan quota — high,
confidence tinggi

`/events/ws`, `/terminal/sessions/:id/ws`, dan `/sync/ws` tidak memvalidasi `Origin`. Gate agent
menerima `?agent_token=`, sedangkan sync menerima `?token=`; keduanya dapat masuk access log/proxy
log. Terminal menerima JSON input tanpa batas pesan/laju selain default library, dan koneksi panjang
tidak memeriksa ulang pencabutan sesi/token.

SameSite tidak memisahkan sibling subdomain yang same-site. Akar masalahnya adalah upgrade dianggap
request HTTP biasa padahal koneksi bertahan lama dan browser membawa cookie otomatis. Semua upgrade
harus memakai exact Origin allowlist, max payload/rate, principal revalidation, dan token sekali pakai
berumur pendek atau header non-URL.

### F-09 · bootstrap first-user-wins publik dan create tidak atomik — critical, confidence tinggi

`POST /api/auth/setup` berada di PUBLIC, hanya memeriksa `user.count()`, lalu membuat user dengan id
acak. Dua request konkuren dapat sama-sama melihat nol; deployment baru juga dapat diambil siapa pun
yang lebih dulu mencapai public URL. Runbook hanya meminta operator “segera” setup.

Akar masalahnya adalah tidak ada possession proof dan tidak ada invariant DB yang membuat hanya satu
create mungkin. Bootstrap harus memakai one-time setup token ber-expiry dari console/file mode 0600,
id/invariant atomik untuk admin pertama, rate limit, audit, dan tertutup permanen sesudah sukses.

### F-10 · proxy trust global dan limiter Map tak berbatas — high, confidence tinggi

`Fastify({ trustProxy:true })` mempercayai seluruh `X-Forwarded-*`. Login/help memakai `req.ip` sebagai
key. `services/auth.ts` dan `services/help-ratelimit.ts` menyimpan key dalam `Map` tanpa TTL/eviction;
alamat spoofed unik membypass throttle sekaligus menumbuhkan heap. Setup dan WebSocket tidak punya
limiter setara.

Akar masalahnya adalah trust proxy dan state limiter tidak punya boundary eksplisit. Trust harus
dibatasi ke hop/CIDR proxy yang diketahui, listener non-loopback harus fail-closed tanpa konfigurasi
proxy, dan limiter harus bounded/evicting dengan key dari peer terpercaya serta body/message caps.

### F-11 · permission dan retensi data sensitif tidak konsisten — high, confidence tinggi

CLI membuat `HANOMAN_HOME` dan parent DB tanpa mode eksplisit; upload/transcript menggunakan
`mkdir({recursive:true})` dan `writeFile()` tanpa mode. Prompt/agents/goal temp file juga ditulis
tanpa mode. Hanya `secret.key` menegakkan 0600. systemd tidak punya `UMask=0077`.

Retensi tiket hanya opportunistic saat tiket baru masuk dan hanya untuk tiket rejected tanpa Spec.
Transkrip hanya punya purge manual. Webhook memakai count cap, sedangkan log/session/attachment tidak
punya sweep terukur. Akar masalahnya adalah lifecycle data tersebar per fitur. Boot harus menegakkan
0700/0600 dan satu sweep retensi harus mencakup tiket/lampiran, transkrip/history, delivery/audit/log
sensitif dengan status yang aman untuk dihapus.

### F-12 · upload mempercayai MIME client dan belum punya quota/scan/decode guard — high,
confidence tinggi

`parseTicketUpload()` menerima buffer ketika `part.mimetype` termasuk PNG/JPEG/WebP; tidak ada magic
byte/decode validation. Batas per-file dan per-ticket sudah ada, tetapi tidak ada quota per-project/
global, pixel/decompression guard, malware scanner, atau timeout. Lampiran disajikan dengan MIME
tersimpan dan tanpa `Content-Disposition: attachment`.

Akar masalahnya adalah parser multipart dipakai sebagai validator konten. Pipeline upload harus
menentukan MIME/extension dari bytes, decode dengan pixel cap+timeout, menormalisasi nama, memeriksa
quota DB/disk, menulis quarantine mode 0600, dan fail-closed bila scan yang diwajibkan tidak tersedia.
Active content tidak boleh dirender inline pada origin admin.

## Hipotesis terpadu dan uji minimum

Hipotesis: bila setiap transisi antar trust boundary memiliki choke point fail-closed — host publik,
principal/capability efektif, tujuan network pinned, path canonical/no-follow, bootstrap possession,
upload bytes, serta sandbox proses — rantai control-plane takeover putus walau satu input publik atau
token domain biasa kompromi.

Uji minimum yang harus merah sebelum implementasi:

- tiket publik + scheduler tidak melahirkan Spec/sesi tanpa accept admin;
- token tanpa `sessions:write` tidak dapat membuat state yang kemudian diluncurkan governor;
- ganti sync URL mencabut token dan redirect tidak menerima Authorization;
- file/directory symlink escape gagal untuk read maupun write;
- webhook 307 dan DNS rebind tidak pernah menerima body/signature;
- Origin asing, token query, message oversized/rate burst, dan principal revoked menutup WS;
- dua setup konkuren menghasilkan tepat satu admin dan token kedua gagal;
- spoofed XFF tidak mengganti key dari peer tak dipercaya; limiter tetap bounded;
- file bermime palsu/polyglot/decompression bomb/quota penuh/scanner gagal tidak menjadi attachment;
- permission/retention sweep terukur lewat stat dan DB+filesystem assertions.

## Keputusan fase

**Audit done → Spec done → Plan done → Execute.** Tidak ada cabang produk yang perlu ditanyakan:
backlog sudah menetapkan seluruh acceptance dan secara eksplisit mewajibkan boundary OS baru lewat
ADR. Pilihan implementasi akan memprioritaskan fail-closed dan kompatibilitas data/migration.
