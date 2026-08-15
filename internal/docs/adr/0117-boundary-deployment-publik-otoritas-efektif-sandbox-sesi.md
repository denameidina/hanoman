# ADR-0117 — Boundary deployment publik, otoritas efektif, dan sandbox sesi

- Status: Accepted
- Tanggal: 2026-08-14
- SPEC: SPEC-761
- Terkait: **mengamandemen** [0028](0028-auth-sesi-opaque-di-db.md) (bootstrap bukan lagi
  first-user-wins dan host publik bukan UI admin), [0037](0037-cabut-guardrail-safety.md) (worktree
  tetap boundary Git, tetapi rootless OS sandbox kini boundary security; deny hook tidak kembali),
  [0065](0065-ai-agent-capability-agent-token.md) (capability dinilai sampai efek launch), dan
  [0100](0100-webhook-keluar-peristiwa.md) (DNS address dipin ke koneksi, redirect ditolak).
  Menegakkan 0046/0066/0068 untuk sync/Help tanpa credential URL atau public-input auto-launch.

## Konteks

Audit SPEC-761 membuktikan bahwa deployment publik menambahkan trust boundary yang tidak dimodelkan
oleh keputusan lama. Satu tiket anonim dapat menjadi prompt agen; kombinasi capability non-session
dapat mengaktifkan scheduler dan membuat backlog; redirect webhook dapat membawa body/signature ke
host lain; symlink dapat membuat operasi repo keluar dari worktree; dan unit resmi menjalankan
service sebagai root sementara agen memakai permission bypass.

ADR-0037 benar dalam satu hal penting: blacklist perintah bukan sandbox dan tak boleh menjadi model
keamanan diam-diam. Ia tidak cukup untuk public deployment karena worktree hanya mengisolasi Git,
bukan filesystem host, credential, proses, atau jaringan.

## Keputusan

Hanoman mempertahankan **satu paket** tetapi mempunyai **dua ingress role**:

- public origin hanya portal Help/status;
- control origin memuat dashboard, auth, terminal, settings, scheduler, webhook, IDE, sync, dan VPS,
  serta wajib berada di belakang SSO/MFA, VPN, atau access proxy;
- origin process bind loopback/firewall-deny dan server menegakkan exact host policy sendiri.

Production gagal boot bila listen non-loopback tanpa trusted-proxy CIDR/hop, origin split, atau
session sandbox. `trustProxy=true` dilarang.

Setiap peluncuran sesi memerlukan **launch approval durable** pada backlog dan pengecekan ulang tepat
di launcher. Cookie admin dan `sessions:write` boleh memberi approval; `settings:write`,
`projects:write`, dan `backlog:write` tidak. Input Help publik berhenti pada review manusia. Ini
memperluas capability dari “route mana yang boleh dipanggil” menjadi “efek akhir apa yang boleh
terjadi”.

Sesi agen production wajib berjalan di **rootless container/VM boundary**. Implementasi resmi
memakai Podman rootless dengan mount worktree/temp/credential minimum, root filesystem read-only,
tanpa capability, resource limit, dan internal network lewat egress allowlist proxy. API/worker
berjalan sebagai dedicated non-root user. Permission-bypass agen tetap berlaku di dalam sandbox;
command deny hooks tetap dicabut.

Operasi lintas boundary memakai choke point bersama:

- canonical no-follow repository path untuk scan/IDE/review;
- pinned-address, no-redirect HTTP untuk webhook/sync;
- cookie-only atomic sync destination rotation;
- exact-origin WebSocket ticket admission tanpa token query;
- one-time, expiring, atomic bootstrap token;
- bounded limiter dan upload quarantine/scan;
- home 0700/file 0600 serta retention sweep terukur.

Detail interface, migration, quota, retensi, dan test berada di design doc SPEC-761.

## Alternatif yang ditolak

- **Proxy/docs saja.** Salah konfigurasi origin tetap membuka control plane dan tidak menutup efek
  transitif, SSRF, symlink, atau credential host.
- **Tiga service terpisah.** Boundary kuat, tetapi menuntut protokol queue/DB/deploy baru. Exact
  ingress policy + sandbox memberi sifat keamanan yang diperlukan tanpa memecah distribusi.
- **Menghidupkan deny hook ADR-0037.** Blacklist mudah dilewati dan mengubah kontrak tanpa boundary
  OS. Ditolak eksplisit.
- **Menjalankan agen sebagai user non-root tanpa container.** Mengurangi blast radius root tetapi
  masih memberi akses ke home, credential, proses, dan egress milik service.
- **Menerima redirect lalu memvalidasi tiap hop.** Hanoman tidak membutuhkan redirect untuk
  webhook/sync, jadi 3xx gagal-tertutup memberi state machine credential yang lebih kecil.

## Konsekuensi

- Public deployment lama memerlukan cutover config dan rootless Podman sebelum upgrade dapat start.
- Query token WebSocket putus sengaja; client harus memakai cookie+tiket atau header/subprotocol.
- Backlog lama di-backfill approved; backlog baru yang dibuat token non-session dapat ada tetapi tak
  pernah diluncurkan sampai admin menyetujui.
- Menjalankan sesi local development tanpa sandbox tetap mungkin hanya melalui mode eksplisit dan
  tidak boleh dipakai pada listener publik.
- Operasi file dan outbound network sedikit lebih mahal karena lstat/DNS pinning, tetapi terjadi
  pada jalur IO berisiko, bukan hot path render.
- Credential yang pernah berada pada service root dianggap terekspos dan wajib dirotasi saat cutover.

## Amandemen — default same-origin untuk WebSocket non-production (2026-08-14)

Choke point "exact-origin WebSocket ticket admission" di atas mengisi allowlist-nya **hanya** dari
`HANOMAN_CONTROL_ORIGINS`, dan set kosong berarti tolak-semua. Instalasi polos (`npm i -g hanoman` →
`hanoman`) tak pernah menyetel env itu — `dist/cli.js` tidak menyetelnya dan `hanoman doctor` tak
memeriksanya — sehingga sejak v0.1.31 **setiap** WebSocket browser ditolak 401 dan terminal, fitur
inti produk, kosong sejak paket dipasang walau tmux dan REST-nya sehat. Gejalanya menipu: tak ada
yang gagal selain upgrade WS-nya.

Karena itu `wsAllowlistFor` menurunkan allowlist dari `Host` request bila env-nya tak diisi **dan**
`NODE_ENV` bukan production. Yang berubah hanya **sumber** daftarnya; pencocokannya tetap exact lewat
`assertWsOrigin`, jadi origin lintas-situs tetap ditolak dan tiket one-use tetap lapis utamanya.
Scheme tak dibandingkan (di belakang proxy TLS server hanya melihat `Host` tanpa scheme).

Production **tidak** ikut turun: set kosong tetap tolak-semua di sana, dan `assertRuntimeBoundary`
sudah menolak boot tanpa origin split — invariant 5 tetap utuh, kebijakan host tak pernah
disimpulkan dari request yang datang pada deployment publik.

Konsekuensi tambahan yang tetap berlaku: mengisi `HANOMAN_CONTROL_ORIGINS` juga menyalakan `enforce`
di `loadIngressPolicy`, sehingga Host yang tak terdaftar menjadi `denied`. Deployment yang memakai
reverse proxy atau tunnel wajib menyebut semua host dashboard-nya sekaligus, bukan hanya satu.

## Amandemen — Help hanya disingkir dari control origin bila split-nya nyata (2026-08-15)

SPEC-805: link status publik `hnm_shr_…` mati di mana-mana. `loadIngressPolicy` menyalakan `enforce`
begitu **salah satu** dari kedua env origin terisi, sedangkan `classifyIngress` menolak seluruh
`/api/help*` pada host control tanpa syarat. Deployment yang hanya menyetel `HANOMAN_CONTROL_ORIGINS`
— yaitu tepat yang dianjurkan amandemen WS di atas untuk tunnel/reverse-proxy — dengan demikian
kehilangan **seluruh** permukaan Help walau `helpEnabled=1`, tanpa pesan apa pun.

Karena itu deny tersebut kini bersyarat `publicBase` (origin publik pertama, lengkap scheme).
Tanpa public origin, host control menyajikan Help; dengan public origin, perilakunya persis seperti
sebelumnya. Produksi tak ikut turun: `assertRuntimeBoundary` menolak boot tanpa split, jadi di sana
`publicBase` selalu terisi dan invariant 5 tetap ditegakkan aplikasi.

Dua konsekuensi yang menyertainya:

- **Link status dibangun dari `publicBase`, bukan `Host` request.** `GET /api/tickets/:id` hanya
  hidup di belakang gate cookie, jadi Host-nya selalu host control — host yang menolak `/api/help`.
  Setiap link yang disalin operator karenanya lahir mati. Bila split dikonfigurasi, host control
  juga me-redirect 302 path SPA `/help/*` ke public origin, sehingga link yang telanjur tersebar
  tetap hidup **tanpa** memindahkan permukaan API Help ke host control.
- **Lihat-status tidak digerbangi `helpEnabled` maupun slug project.** Otorisasinya adalah kunci
  opaque 48 hex yang sudah dipegang pemanggil; `helpEnabled=false` berarti berhenti menerima keluhan
  baru (info + submit), bukan menutup status tiket yang sudah masuk, dan `Project.id` dapat
  di-rename (SPEC-255) sehingga slug pada link lama basi. Submit dan info halaman tak berubah.

Detail bukti di [audit SPEC-805](../research/audit-spec-805-link-status-publik-help-404.md).

## Invariant yang tidak boleh dilonggarkan diam-diam

1. Public input tidak dapat memberi launch approval, langsung maupun lewat sync.
2. Semua wrapper launch berakhir pada gate yang sama; gate route awal tidak cukup.
3. Worktree bukan sandbox security dan command deny hook bukan pengganti OS sandbox.
4. Credential/signature tak pernah mengikuti redirect, host berbeda, atau query URL.
5. Public host policy ditegakkan aplikasi walaupun proxy juga menegakkannya.
6. Symlink dalam repository tak pernah diikuti operasi server yang menerima path pengguna.
7. Production upload gagal tertutup bila scanner/boundary wajib tidak tersedia.
