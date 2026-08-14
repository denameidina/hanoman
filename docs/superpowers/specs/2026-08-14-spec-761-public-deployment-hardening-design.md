# SPEC-761 — Hardening menyeluruh public deployment Hanoman

> Design doc · 2026-08-14 · sumber QA · prioritas tinggi
> ADR baru: **0117 — Boundary deployment publik, otoritas efektif, dan sandbox sesi**

## Masalah

SPEC-759 menutup stored XSS pada renderer Markdown, tetapi audit lanjutan membuktikan dua belas
kelompok temuan lain yang dapat dirangkai menjadi pengambilalihan control plane. Hanoman saat ini
memperlakukan bind loopback, cookie admin, dan worktree sebagai boundary yang cukup, padahal public
deployment juga menerima input anonim, token capability, forwarded headers, upload, webhook/sync
keluar, dan meluncurkan agen dengan permission bypass.

Audit sumber dan bukti akar masalah ada di
[`internal/docs/research/audit-spec-761-hardening-public-deployment.md`](../../../internal/docs/research/audit-spec-761-hardening-public-deployment.md).
Design ini menutup seluruh AC-01…AC-14 sebagai satu hardening release; perbaikan parsial tidak
dianggap selesai.

## Alternatif arsitektur

### A. Konfigurasi reverse proxy dan dokumentasi saja

Caddy dapat memisahkan host publik dari dashboard dan systemd dapat mengganti user. Ini murah,
tetapi tidak menutup origin yang salah konfigurasi, token capability yang memperoleh RCE transitif,
symlink/SSRF, bootstrap race, atau agen yang tetap melihat credential host. Ditolak karena boundary
penting hanya berupa instruksi operator.

### B. Membelah portal, API control-plane, dan worker menjadi tiga produk

Pemisahan proses paling eksplisit, tetapi mengubah paket npm tunggal, protokol deploy, ownership DB,
dan operasi upgrade sekaligus. Portal tetap memerlukan subset API, sementara worker memerlukan
protokol queue dan secret baru. Biaya serta surface migrasinya tidak proporsional untuk release ini.

### C. Satu paket dengan ingress policy dan choke point fail-closed — dipilih

Satu proses Fastify tetap melayani paket yang sama, tetapi exact host policy membagi permukaan:
public host hanya aset portal, health, dan Help API; control host memuat dashboard/control API dan
wajib berada di belakang SSO/MFA, VPN, atau access proxy. Origin bind loopback. Di dalam proses,
setiap transisi ke side effect berbahaya melewati modul bersama: launch authority, canonical path,
pinned network destination, WebSocket admission, bootstrap proof, dan upload quarantine. Proses agen
berjalan dalam rootless OS sandbox dengan mount dan egress minimum.

Pilihan C memberi defense in depth tanpa membuat format data atau distribusi baru. Konfigurasi yang
kurang pada mode production gagal boot, bukan diam-diam membuka control plane.

## Invariant keamanan

1. **Public input berhenti sebagai data.** Tiket/lampiran anonim tak pernah membuat backlog atau sesi
   otomatis. Hanya aksi admin/capability `sessions:write` yang dapat menyetujui launch.
2. **Otoritas dinilai pada efek akhir.** State yang mencapai `startSpecSession`, cron, lead,
   governor, atau scheduler membawa approval durable; launcher memeriksanya lagi.
3. **Tujuan network adalah alamat yang benar-benar dihubungi.** URL di-parse, DNS di-resolve dan
   divalidasi, lalu socket menggunakan address tervalidasi. Redirect tidak diikuti.
4. **Containment berlaku pada inode, bukan string.** Komponen path di-`lstat`/`realpath`, symlink
   ditolak, final write memakai no-follow dan atomic rename di direktori tervalidasi.
5. **Browser WebSocket membawa origin, bukan credential di URL.** Upgrade memakai exact allowlist,
   tiket sekali pakai, quota, dan revalidation.
6. **Agen bukan proses host.** Worktree tetap boundary Git; rootless container/VM adalah boundary
   security untuk filesystem, credential, proses, dan network.
7. **Data sensitif private by construction.** `umask 0077`, direktori 0700, file 0600, quarantine,
   dan retention sweep berlaku juga pada instalasi lama.

## Desain

### 1. Pemisahan public host dan control host

`server/src/services/ingress-policy.ts` mengompilasi konfigurasi menjadi exact origin/host:

- `HANOMAN_PUBLIC_ORIGINS` — origin `https://host[:port]` untuk portal;
- `HANOMAN_CONTROL_ORIGINS` — origin dashboard di belakang access proxy;
- `HANOMAN_TRUST_PROXY` — hop/CIDR eksplisit, tidak pernah boolean `true`;
- `HANOMAN_BIND_PUBLIC=1` hanya sah bila trusted proxy dan kedua origin terisi.

Hook Fastify pertama menentukan host dari peer/proxy yang dipercaya. Public origin hanya dapat
mengakses aset Help, `GET /api/health`, dan `/api/help/**`; `/api/auth/**`, dashboard admin,
terminal, settings, scheduler, webhook, IDE, sync, dan VPS membalas 404. Control origin menolak
intake publik. Origin tak dikenal membalas 421. Caddy resmi menyediakan dua virtual host, tetapi
upstream tunggal tetap `127.0.0.1`; direct origin ditolak firewall.

### 2. Help Center sebagai data tak tepercaya

`checkTriase()` berhenti pada notifikasi “menunggu review”; ia tidak lagi memanggil
`acceptTicket()` atau `enqueue()`. Accept eksplisit cookie-admin atau `sessions:write` membuat Spec
berapproval. Payload memberi delimiter data dan larangan mengikuti directive di title/detail/
attachment. Lampiran dipasang read-only di sandbox dan tidak pernah menjadi path host bebas.

Tidak ada mode otomatis/sandbox-lunak. Bila automation Help dihidupkan lagi, ia memerlukan ADR dan
worker khusus dengan filesystem/secret/egress minimum serta corpus prompt-injection.

### 3. Otoritas efektif yang durable

`Spec` mendapat:

```text
launchApprovedAt DateTime?
launchApprovedBy String?   // LOCAL-only principal/audit label
```

Migration menandai backlog lama yang sudah ada sebagai `legacy-admin` agar kompatibel. Spec baru
hanya mendapat approval bila mutasi dilakukan cookie admin atau token `sessions:write`. Token
`backlog:write`, `settings:write`, atau `projects:write` tetap boleh menjalankan domainnya, tetapi
tak dapat menambah approval. Governor/scheduler/lead dan setiap wrapper `start*Session` memanggil
`assertLaunchApproved()` tepat sebelum launch. Manual Start oleh admin dapat menambahkan approval
secara atomik lalu launch. Cron dan terminal shell tetap cookie-only.

Kedua field approval LOCAL-only dan tidak masuk changefeed: peer tak dapat mengangkat backlog dari
null ke approved melalui record sync, dan identitas operator tidak keluar dari mesin control-plane.

### 4. Sync destination sebagai credential boundary

Semua setting sync menjadi cookie-admin-only. Operasi khusus mengganti origin secara atomik:

1. validasi exact HTTPS origin (HTTP hanya loopback dev);
2. simpan URL baru;
3. simpan tombstone token kosong agar environment lama tidak menjadi fallback;
4. tutup client aktif;
5. status menjadi `needs_device_token`.

Device token baru dimasukkan sesudah pairing. HTTP memakai header `Authorization`, manual redirect,
pinned DNS address, dan exact-origin check. WebSocket memakai header/subprotocol non-URL. Setiap
record masuk harus lulus schema entity/field, byte limit, dan aturan approval sebelum apply.

### 5. Rootless session sandbox

CLI/server production menolak berjalan sebagai root. Unit systemd memakai `User=hanoman`,
`Group=hanoman`, `WorkingDirectory=/var/lib/hanoman`, `UMask=0077`, `NoNewPrivileges`, dan hardening
systemd yang kompatibel dengan rootless Podman.

`server/src/services/session-sandbox.ts` adalah satu-satunya pembentuk perintah agen. Production
mewajibkan `HANOMAN_SESSION_SANDBOX=podman`; mode `off` hanya untuk development/test eksplisit.
Container memakai user namespace rootless, read-only root filesystem, `cap-drop=ALL`,
`no-new-privileges`, PID/memory/CPU limit, tmpfs kecil, dan hanya mount:

- worktree sesi read-write;
- phase file dan prompt sementara sesi pada direktori private;
- credential agen khusus sesi read-only, bukan seluruh home host.

Network container berada di internal network tanpa internet langsung. Egress proxy terpisah hanya
mengizinkan origin model API dan source/dependency host yang dikonfigurasi. DNS/proxy menolak IP
private/metadata. Flag permission bypass ADR-0037 tetap ada **di dalam** sandbox; hook deny perintah
tidak dihidupkan kembali.

### 6. Filesystem descriptor-safe

`server/src/services/safe-repo-path.ts` menjadi pintu tunggal untuk scan, Docs, IDE/Git, dan review:

- root di-`realpath` lalu setiap komponen existing di-`lstat`;
- absolute path, `..`, symlink file/direktori/nested/dangling ditolak;
- read membuka final path dengan `O_NOFOLLOW`, memeriksa `fstat`, lalu membaca descriptor;
- write memvalidasi parent canonical, membuat temp 0600 di parent yang sama dengan
  `O_CREAT|O_EXCL|O_NOFOLLOW`, kemudian atomic rename ke final non-symlink;
- perubahan link antara validasi dan open gagal tertutup.

Node tidak memiliki `openat2(RESOLVE_BENEATH)`, jadi parent-swap TOCTOU residual dikecilkan dengan
menolak seluruh symlink dan memvalidasi ulang parent sesudah open. Sandbox mount memastikan residual
bug tetap tak dapat keluar dari worktree.

### 7. Network destination pinned dan redirect ditolak

`server/src/services/safe-outbound-request.ts` dipakai webhook dan sync. Ia mengizinkan HTTPS,
menolak userinfo/private/link-local/loopback/metadata, memvalidasi seluruh A/AAAA, memilih address
tervalidasi, dan memberikannya ke custom `lookup` pada `node:http`/`node:https`. Host header dan TLS
SNI tetap hostname asli. Status 3xx adalah error permanen; body, signature, dan Authorization tidak
pernah dikirim ke origin kedua. Limit response, connect, header, dan total timeout diterapkan.

### 8. Dependency runtime

Fastify dan plugin dinaikkan sebagai satu keluarga major kompatibel yang patched. Lockfile
diperbarui. `pnpm audit --prod` harus menyisakan nol critical/high runtime. Advisory yang tak dapat
dihapus dicatat dengan exploitability, mitigasi, owner, dan deadline; release tak boleh
menyembunyikannya lewat ignore global.

### 9. Admission WebSocket

Semua upgrade melewati `ws-admission.ts`:

- `Origin` wajib exact-match `HANOMAN_CONTROL_ORIGINS` untuk browser; client non-browser hanya
  diterima dengan agent header/subprotocol tervalidasi;
- query `agent_token` dan `token` dihapus;
- browser mengambil tiket satu-kali dari `POST /api/ws-tickets`, cookie-admin, dengan tujuan
  (`events|terminal:<id>|sync`), principal, TTL 30 detik, dan nonce; store bounded/evicting;
- `maxPayload`, maksimum frame per jendela, koneksi/principal, dan idle timeout;
- setiap 60 detik serta sebelum input terminal, principal/sesi diperiksa ulang; revoke/expiry
  menutup socket dengan code policy violation.

### 10. Bootstrap atomik

Saat belum ada user, boot membuat `setup-token` random mode 0600 di `HANOMAN_HOME`; log hanya
menampilkan path dan expiry 15 menit. `POST /api/auth/setup` hanya tersedia di control
origin/loopback, memakai bounded limiter, dan membutuhkan constant-time token match.

Admin pertama selalu memakai invariant id `bootstrap-admin`. Dua transaksi konkuren yang lolos
count bersaing pada unique id; hanya satu berhasil. Sesudah commit sukses, token dihapus dan endpoint
tertutup permanen. Token expired hanya dapat diganti lewat console/restart dan setiap percobaan
dicatat tanpa secret.

### 11. Trusted proxy dan bounded limiter

`trustProxy` berasal dari hop/CIDR config; default hanya loopback peer dan tidak mempercayai
X-Forwarded-For dari direct client. Login, setup, Help, dan WS memakai satu
`BoundedRateLimiter`: TTL bucket, maksimum key, LRU eviction, per-principal+peer key, periodic prune,
dan metric ukuran. Body limit route ditetapkan sebelum multipart. Production yang listen
non-loopback tanpa trusted proxy menolak boot.

### 12. Permission dan retensi

Boot memanggil `secureHanomanHome()` untuk membuat/chmod home dan subdirektori 0700 serta file DB,
secret, upload, transcript, log, prompt, dan token 0600. Proses memasang `umask(0o077)` sebelum file
dibuat. Permission instalasi lama diperbaiki idempoten; symlink di HANOMAN_HOME ditolak.

Satu sweep retention bounded berjalan harian dan dapat dipicu dry-run dari CLI:

| data | retensi | syarat hapus |
|---|---:|---|
| tiket + lampiran | 90 hari | resolved/rejected, tidak dirujuk Spec aktif |
| tiket belum ditangani | 180 hari | expired, notifikasi dibuat |
| transkrip + history sesi | 30 hari | sesi ended dan bukan bukti review aktif |
| webhook delivery/log sensitif | 30 hari | terminal status |
| audit keamanan | 90 hari | bukan legal hold |
| prompt/temp/quarantine gagal | 24 jam | tidak dipakai proses hidup |

Delete DB/filesystem berada dalam batch kecil; kegagalan file mempertahankan record untuk retry.

### 13. Pipeline upload

Upload masuk ke quarantine private. Nama dibentuk ulang dari id; magic bytes menentukan
MIME/extension. PNG/JPEG/WebP harus decode dalam worker dengan timeout, pixel/dimension cap, lalu
di-re-encode untuk membuang metadata/polyglot tail. Kuota dihitung sebelum dan sesudah decode:
per-file, per-ticket, per-project, dan global.

Production mewajibkan executable scanner absolut (`HANOMAN_MALWARE_SCANNER`) atau upload ditolak
fail-closed. Exit non-zero, timeout, atau scanner hilang tidak membuat attachment. File final
dipindah atomik mode 0600. Download selalu `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff`, CSP sandbox, dan tidak dirender inline pada origin admin.

## Perubahan data dan kompatibilitas

- Dua kolom nullable approval ditambahkan ke `Spec`; migration backfill menjaga backlog lama.
- Tidak ada destructive migration dan format TicketAttachment tetap kompatibel.
- Setting lama tetap terbaca; perubahan sync pertama menulis tombstone token.
- Client WebSocket lama dengan query token menerima 401 dan harus upgrade; ini break sengaja.
- Public deployment lama gagal start sampai origin/trusted proxy/session sandbox dikonfigurasi.
  Mode local development tetap tersedia secara eksplisit.

## Penanganan error dan observability

Boundary memakai kode stabil tanpa memantulkan secret/path internal: `INGRESS_DENIED`,
`LAUNCH_NOT_APPROVED`, `PATH_CONTAINMENT`, `OUTBOUND_DESTINATION`, `WS_ADMISSION`,
`BOOTSTRAP_CLOSED`, `RATE_LIMITED`, dan `UPLOAD_QUARANTINED`. Audit log mencatat principal, target
domain, outcome, dan correlation id; tidak mencatat token, body tiket, signature, query credential,
atau path host penuh. Repeated denial menghasilkan metric/notifikasi bounded.

## Matriks acceptance dan test negatif

| AC | bukti implementasi | bukti test |
|---|---|---|
| 01 | ingress policy + Caddy loopback/access proxy | host matrix public/control/direct |
| 02 | auto-triase berhenti pada review | public ticket tidak membuat Spec/launch; directive corpus |
| 03 | sync cookie-only + atomic token reset + pinned transport | capability ditolak; redirect/record invalid gagal |
| 04 | non-root unit + rootless sandbox/egress proxy | config fail-closed; mount/network command contract |
| 05 | durable launch approval + final launcher gate | matrix settings/projects/backlog tanpa sessions tidak launch |
| 06 | safe repo path | file/dir/nested/dangling/swap link read-write gagal |
| 07 | safe outbound request | 301/302/307/308, rebind, IPv4/IPv6/private gagal |
| 08 | dependency upgrade | audit prod nol critical/high + touched integration tests |
| 09 | WS admission/tickets/quota/revalidation | foreign Origin/query token/oversize/burst/revoke gagal |
| 10 | bootstrap token + unique invariant | missing/expired token dan concurrency hanya satu sukses |
| 11 | exact trusted proxy + bounded limiter | spoofed XFF tak mengganti key; max-size/eviction terukur |
| 12 | secure home + retention sweep | stat 0700/0600; dry-run/delete/retry/hold |
| 13 | quarantine/magic/decode/quota/scanner | MIME palsu/polyglot/bomb/quota/scanner failure gagal |
| 14 | docs/ADR/API/deploy/threat model + local smoke | test terkait serial, endpoint lokal per host |

Test server memakai `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan
`--no-file-parallelism`. Endpoint berubah diuji sekali pada server lokal dengan Host/Origin public
dan control. Tidak ada DAST produksi.

## Rollout

1. Upgrade dependency dan deploy package saat service masih private.
2. Buat user/group, secure HANOMAN_HOME, setup rootless Podman network/egress proxy, dan validasi
   sandbox lewat doctor.
3. Konfigurasi public/control origin, trusted proxy, Caddy, SSO/MFA/VPN, firewall loopback-only.
4. Rotasi device token sync, agent token, cookie/session secret, webhook secret, API/model/Git key,
   dan credential host yang pernah terlihat proses root.
5. Jalankan migration/backfill, retention dry-run, lalu enable sweep.
6. Smoke host matrix, setup-closed, WS, webhook redirect, upload scanner, dan satu sesi sandbox.
7. Baru buka public Help host; control host tak dipublikasikan tanpa access proxy.

Rollback package tidak boleh menghidupkan kembali query token, root service, atau public control
host. Rollback fungsional dilakukan dengan menutup public ingress dan mempertahankan boundary deploy.

## Di luar cakupan

- Active DAST terhadap produksi tanpa otorisasi manusia terpisah.
- Menghidupkan kembali deny hook command ADR-0037.
- Membuat malware engine atau egress proxy buatan sendiri; Hanoman mengintegrasikan executable/proxy
  yang dikelola operator.
- Menjadikan Help input otomatis lagi atau memberi agen akses penuh host demi kompatibilitas.
