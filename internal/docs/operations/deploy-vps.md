# Deploy hanoman ke VPS publik

Runbook normatif untuk instance yang memiliki URL publik. Sejak SPEC-761, "satu instance" tidak
berarti satu trust boundary: Help/status boleh publik, sedangkan dashboard, terminal, settings,
scheduler, webhook, IDE, sync administration, dan VPS adalah control plane privat.

Hanoman tetap didistribusikan sebagai paket npm global dengan SQLite embedded
([ADR-0086](../adr/0086-sqlite-satu-satunya-provider.md),
[ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md)). Podman di bawah bukan packaging
aplikasi; ia adalah boundary wajib untuk proses agen.

## Topologi wajib

```text
Internet ──TLS── help.example ─┐
                              ├─ Caddy ── 127.0.0.1:8787 ── hanoman API (user hanoman)
operator ─ SSO/MFA/VPN ─ admin.example ┘                         │
                                                                 ├─ $HANOMAN_HOME (0700)
                                                                 └─ rootless Podman agent sandbox
                                                                      └─ internal net → egress proxy allowlist
```

> **SPEC-884 / ADR-0139 — hardening kini opt-in.** Seluruh syarat di bawah (podman rootless, split
> origin, trusted proxy, non-root, setup token, scanner upload) ditegakkan **hanya bila
> `HANOMAN_HARDENING=1`**, atau bila salah satu env ADR-0117 lama sudah terisi
> (`HANOMAN_SESSION_SANDBOX=podman`, `HANOMAN_PUBLIC_ORIGINS`, `HANOMAN_TRUST_PROXY`) — deployment
> yang sudah berdiri karena itu tetap keras tanpa disentuh. Tanpa satu pun dari itu hanoman boot
> longgar: sesi agen berjalan di host, `hanoman doctor` menandai sandbox `!` bukan `✗`, dan akun
> pertama dibuat tanpa membaca `setup.token`. Pilih jalur itu **hanya** untuk host yang tak
> menghadap publik.

- `help.example` hanya boleh mencapai static UI, `/api/health`, dan `/api/help/**`.
- `admin.example` wajib berada di belakang SSO/MFA, VPN, atau access proxy dan menolak Help publik.
- **`HANOMAN_PUBLIC_ORIGINS` wajib benar-benar ada**: DNS ter-resolve + vhost proxy-nya berdiri.
  Nilainya juga menjadi basis link status yang dibagikan operator dan tujuan redirect `/help/*` dari
  host control (SPEC-805). Mengisinya hanya agar `assertRuntimeBoundary` mengizinkan boot membuat
  seluruh Help tak terjangkau lewat host mana pun — host control menolaknya secara desain, host
  publik tak pernah di-resolve. Bila host publik memang tak akan didirikan, pilih single-origin
  secara **sadar**: hapus `HANOMAN_PUBLIC_ORIGINS` dan setel `HANOMAN_SINGLE_ORIGIN=1` — Help lalu
  disajikan di host control itu sendiri. Mengosongkan env tanpa flag itu tetap gagal boot. Split
  tetap bentuk yang dianjurkan; single-origin menaruh control plane di host yang sama dengan
  permukaan anonim dan menyerahkan perlindungannya pada cookie login + limiter.
- Hanoman bind loopback. Firewall hanya membuka SSH dan listener reverse proxy; port 8787 tidak
  pernah dibuka langsung.
- Caddy harus menjadi satu-satunya proxy ke origin. `HANOMAN_TRUST_PROXY=1` berarti tepat satu hop;
  gunakan CIDR bila ada lebih dari satu proxy yang diketahui. Jangan mempercayai semua forwarded IP.

## 0. Provisioning satu perintah (SPEC-883 · [ADR-0137](../adr/0137-provisioning-vps-berbasis-katalog.md))

Prosedur manual di bagian 1–5 di bawah **tetap acuan kebenaran**: `provision.sh` mengeksekusi apa
yang ditulis di sana, dan bila keduanya berbeda, dokumen inilah yang benar.

Dua jalur, satu skrip (`server/scripts/vps/provision.sh`, ikut terpaket sebagai
`<pkg>/scripts/vps/provision.sh`):

- **Dari dashboard** — layar VPS → buka detail → panel *Pasang komponen*: pilih profil, centang
  komponen, **Pratinjau** (dry-run), lalu **Pasang**. hanoman mengirim skrip lewat SSH dengan key
  yang sudah dibootstrap (SPEC-165), lalu memprobe ulang dan menampilkan tautan setup.
- **Di mesin itu sendiri** — `hanoman provision --with=… [--profile=…] [--domain=…]`. Butuh Node +
  paket `hanoman` sudah ada di mesin itu; untuk mesin kosong pakai jalur dashboard.

```sh
hanoman provision --probe                                   # laporkan apa yang ada, nol tulis
hanoman provision --with=hanoman,caddy --domain=hn.contoh.id --dry-run
hanoman provision --with=hanoman,caddy --domain=hn.contoh.id --yes
```

### Komponen

| id | isi | prasyarat (lab) | prasyarat (production) | login manual |
|---|---|---|---|---|
| `base` | curl, git, tmux, ca-certificates, toolchain `node-pty` | — | — | — |
| `node` | Node.js 22 LTS | `base` | `base` | — |
| `hanoman` | `npm i -g hanoman`, user service, `/etc/hanoman.env`, unit systemd, `enable --now` | `node` | `node`, `podman` | — |
| `caddy` | Caddy + `reverse_proxy 127.0.0.1:8787` + TLS otomatis (butuh `--domain`) | — | — | — |
| `podman` | Podman rootless + network internal `hanoman-egress` | `base` | `base` | — |
| `agent-image` | build `hanoman-agent:latest` dari `agent.Containerfile` | *(production saja)* | `podman` | — |
| `claude` | Claude Code CLI | `node` | `agent-image` | ya |
| `codex` | Codex CLI | `node` | `agent-image` | ya |
| `gh` | GitHub CLI | `base` | `base` | ya |

Komponen ber-login berhenti di **biner terpasang + `--version` terbukti**; probe melaporkannya
`partial not-logged-in` dan **tak pernah** `ok`. Login dilakukan sekali lewat Console
([ADR-0042](../adr/0042-vps-console-ssh-tmux-lokal.md)). hanoman tak pernah menyentuh kredensial agen.

### Dua profil

- **`lab`** — `NODE_ENV` tidak diset production. Sesi agen berjalan di host, `claude`/`codex`
  dipasang di host. Siap dipakai satu operator dalam hitungan menit. **Batasnya jujur:** karena
  `NODE_ENV` bukan production, cookie sesi lahir **tanpa flag `Secure`**
  (`server/src/services/auth.ts`). Di balik Caddy yang memaksa HTTPS ini tak membuka apa pun ke
  jaringan, tetapi profil ini **tidak boleh** melayani permukaan Help publik — untuk itu pakai
  `production`.
- **`production`** — memenuhi gerbang `assertRuntimeBoundary`
  ([ADR-0117](../adr/0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md)) utuh: Podman rootless, credential dir,
  egress proxy, trusted proxy, `HANOMAN_SINGLE_ORIGIN=1` + `HANOMAN_CONTROL_ORIGINS`. `claude` dan
  `codex` dipasang **ke dalam image agen**, dan login-nya mendarat di `HANOMAN_AGENT_CREDENTIAL_DIR`
  yang di-mount RO oleh sesi.

Provision ulang dengan profil berbeda pada instance yang `hanoman`-nya sudah `ok` ditolak
`409 profile-mismatch` kecuali `force` — menulis ulang `/etc/hanoman.env` dari lab ke production
membuat service menolak boot sampai Podman siap.

### Penandaan komponen

`Vps.components` **hanya** ditulis dari keluaran probe, tak pernah dari niat; apply yang sukses pun
diakhiri probe ulang. Nilai `null` berarti **belum diperiksa**, bukan "tak ada komponen".
Ketiga kolomnya (`components`, `componentsCheckedAt`, `provisionProfile`) local-only dan tak ikut
sync.

### Gerbang domain

Bila `caddy` dipilih, skrip membandingkan A record domain dengan alamat publik mesin **sebelum**
memasang apa pun. Tak cocok → `STEP caddy fail dns-mismatch`, komponen lain tetap berjalan.
Sertifikat ACME yang gagal terbit meninggalkan Caddy hidup tanpa TLS sekaligus membakar rate-limit
Let's Encrypt.

## 1. User, paket, dan direktori private

Prasyarat: Node ≥20, git, tmux, toolchain native `node-pty`, Podman rootless, satu CLI agen di image
sandbox, dan executable malware scanner yang dikelola operator.

```sh
apt-get install -y build-essential python3 git tmux podman uidmap
useradd --system --create-home --home-dir /var/lib/hanoman --shell /usr/sbin/nologin hanoman
install -d -o hanoman -g hanoman -m 0700 /var/lib/hanoman
install -d -o hanoman -g hanoman -m 0700 /var/lib/hanoman/agent-credentials
install -m 0755 /opt/security/bin/scan-upload /opt/security/bin/scan-upload
npm i -g hanoman
```

Provision image `hanoman-agent:latest` dari source/pin yang ditinjau. Image harus memuat CLI agen,
git, dan tool build yang benar-benar dibutuhkan; jangan memasukkan credential. Credential runtime
khusus agen diletakkan read-only di `/var/lib/hanoman/agent-credentials`, bukan seluruh home host.

Sebagai user `hanoman`, buat rootless internal network dan pasang egress proxy terpisah pada network
itu. Proxy hanya mengizinkan API model serta host source/dependency yang disetujui dan menolak alamat
private, loopback, link-local, metadata, serta DNS rebinding.

```sh
sudo -u hanoman podman network create --internal hanoman-egress
# Jalankan/provision proxy organisasi pada hanoman-egress, mis. http://egress-proxy:3128.
```

## 2. Konfigurasi private

```sh
umask 077
install -o root -g hanoman -m 0640 /dev/null /etc/hanoman.env
```

```ini
HANOMAN_HOME=/var/lib/hanoman
PORT=8787
HOST=127.0.0.1
NODE_ENV=production
HANOMAN_TMUX_SOCKET=hanoman-prod

HANOMAN_PUBLIC_ORIGINS=https://help.example
HANOMAN_CONTROL_ORIGINS=https://admin.example
HANOMAN_TRUST_PROXY=1

HANOMAN_SESSION_SANDBOX=podman
HANOMAN_SESSION_IMAGE=hanoman-agent:latest
HANOMAN_SESSION_NETWORK=hanoman-egress
HANOMAN_EGRESS_PROXY=http://egress-proxy:3128
HANOMAN_AGENT_CREDENTIAL_DIR=/var/lib/hanoman/agent-credentials

HANOMAN_UPLOAD_SCANNER=/opt/security/bin/scan-upload
```

`DATABASE_URL` tidak perlu: default adalah `$HANOMAN_HOME/hanoman.db`. Nilai non-`file:` yang masih
terwarisi dari shell atau unit lama **tidak** menggagalkan boot — hanoman mengabaikannya, tetap
memakai berkas default, dan mencetak notice yang menyebut skemanya saja (amandemen
[ADR-0086](../adr/0086-sqlite-satu-satunya-provider.md), karena nama env itu hampir selalu milik
project lain). Notice itu satu-satunya sinyal bahwa instance memakai DB default; instance yang
tampak kosong sesudah cutover hampir selalu ini, bukan data hilang. Knob milik hanoman sendiri
adalah `HANOMAN_DATABASE_URL` — di situ niatnya eksplisit, jadi nilai non-`file:` **gagal keras**
saat boot maupun migrasi. Bila target tidak boleh ambigu, sebut berkasnya langsung: `hanoman --db
<file>` dan `migrate-from-postgres --to <file>` menang atas kedua env.

`SYNC_SERVER_URL` dan `SYNC_DEVICE_TOKEN` adalah pairing opsional; perubahan
origin sync dari Settings menghapus token lama secara atomik dan wajib di-pair ulang.

Jalankan pemeriksaan sebagai user service. Production dianggap belum siap bila doctor melaporkan
sandbox rootless, network, proxy, credential directory, tmux, git, atau CLI agen gagal.

```sh
sudo -u hanoman sh -c 'set -a; . /etc/hanoman.env; exec hanoman doctor'
```

Jangan menaruh token langsung pada command line di lingkungan yang mencatat argv.

## 3. systemd

`/etc/systemd/system/hanoman.service`:

```ini
[Unit]
Description=hanoman orchestrator + dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hanoman
Group=hanoman
WorkingDirectory=/var/lib/hanoman
UMask=0077
Environment=HOME=/var/lib/hanoman
EnvironmentFile=/etc/hanoman.env
ExecStart=/usr/bin/env hanoman
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```sh
systemctl daemon-reload
systemctl enable --now hanoman
systemctl status hanoman
journalctl -u hanoman -f
```

Server menolak boot production bila uid 0, bind bukan loopback, origin split/trusted proxy absen,
atau sandbox bukan Podman. `WorkingDirectory` tidak dipakai untuk menemukan aset paket, tetapi
memastikan cwd private dan stabil. Migrasi Prisma tetap diterapkan otomatis setiap start.

## 4. Reverse proxy TLS dan access proxy

Contoh Caddy di bawah menunjukkan pemisahan host. Blok `forward_auth` adalah placeholder kontrak;
sesuaikan URI/header dengan access proxy organisasi dan pastikan ia mewajibkan MFA.

```caddy
(security_headers) {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
	}
}

help.example {
	import security_headers
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}

admin.example {
	import security_headers
	forward_auth 127.0.0.1:4180 {
		uri /oauth2/auth
		copy_headers X-Auth-Request-User X-Auth-Request-Email
	}
	reverse_proxy 127.0.0.1:8787
}
```

Set A/AAAA record sebelum reload, lalu `caddy validate` dan `systemctl reload caddy`. Ingress policy
Hanoman adalah lapis fail-closed kedua: salah route pada host publik tetap ditolak aplikasi.

## 5. Bootstrap akun pertama

Saat DB belum memiliki user, boot membuat `$HANOMAN_HOME/setup.token` mode 0600, berlaku 15 menit.
Log hanya menyebut path dan expiry. Baca token dari console/local shell sebagai user service, lalu
paste di layar Setup pada **host control**:

```sh
sudo -u hanoman sed -n '1p' /var/lib/hanoman/setup.token
```

Hanya satu create atomik yang dapat menang. Sesudah admin pertama dibuat, token dihapus dan
`POST /api/auth/setup` permanen 409. Jangan mengirim token lewat chat, URL, access log, atau host Help.

## 6. Migrasi Postgres lama

Backup dan dry-run lebih dulu; data produksi memuat akun dan tiket nyata.

```sh
umask 077
pg_dump "$OLD_PG_URL" > /var/lib/hanoman/backup-postgres.sql
sudo -u hanoman hanoman migrate-from-postgres --from "$OLD_PG_URL" --to /var/lib/hanoman/hanoman.db --dry-run
sudo -u hanoman hanoman migrate-from-postgres --from "$OLD_PG_URL" --to /var/lib/hanoman/hanoman.db
```

`--to` disebut eksplisit karena tanpa ia target diturunkan dari env — dan `DATABASE_URL` Postgres
lama yang masih terwarisi diabaikan, bukan ditolak, sehingga migrasi menarget berkas default tanpa
memberi tahu selain lewat notice. `--to` melewati resolusi env sepenuhnya. Pada `--dry-run` ia inert
— dry-run adalah pertanyaan tentang sumber dan tak menyentuh target sama sekali — tetapi menuliskannya
membuat kedua perintah identik selain flag itu, sehingga yang di-dry-run memang yang dijalankan.

Target berisi ditolak kecuali `--force`. Jangan memakai `--force` pada instance live. Tabel sumber
yang memang tidak ada dilewati; integer di luar safe range ditolak. Dry-run tidak membuktikan semua
tipe dapat ditulis, jadi verifikasi login, jumlah project/spec/tiket/user, dan sync sebelum mematikan
Postgres lama. Simpan backup sampai cutover dinyatakan selesai.

## 7. Retensi, upload, backup, dan rotasi

- Jalankan retention dry-run pada salinan DB sebelum rollout. Runtime lalu menyapu harian dengan
  batch bounded: sesi 30 hari; ticket selesai 90 hari; ticket baru 180 hari; webhook delivery 30
  hari; session result 90 hari. Set `HANOMAN_RETENTION_HOLDS` untuk legal/incident hold eksplisit.
- Upload production fail-closed bila scanner hilang/gagal/timeout. Pantau quota 250 MiB/project dan
  1 GiB/global serta direktori quarantine.
- **Batas backup/restore adalah `$HANOMAN_HOME` seutuhnya, bukan hanya DB** (SPEC-846). Menyalin
  `hanoman.db` saja menghasilkan restore yang metadatanya utuh tetapi byte-nya hilang: transkrip
  terbaca "ada" lalu gagal dibuka, lampiran tiket 404, dan identitas SSH lahir baru sehingga setiap
  VPS yang sudah di-bootstrap menolak koneksi tanpa pemberitahuan.

  | Path (relatif `$HANOMAN_HOME`) | Isi |
  |---|---|
  | `hanoman.db` (+ `-wal`/`-shm`) | seluruh state aplikasi |
  | `secret.key` | kunci AES RuntimeConfig & webhook secret |
  | `id_ed25519` + `.pub` | identitas SSH hanoman ke VPS |
  | `transcripts/` | transkrip sesi yang ditutup |
  | `uploads/` | lampiran tiket + byte source-map lama + `terminal/<sessionId>/` |

  ```sh
  umask 077
  sudo -u hanoman sqlite3 "$HANOMAN_HOME/hanoman.db" ".backup '/backup/hanoman.db'"
  sudo -u hanoman tar -C "$HANOMAN_HOME" -czf /backup/hanoman-files.tgz \
    secret.key id_ed25519 id_ed25519.pub transcripts uploads
  ```

  `sqlite3 ".backup"` bukan gaya penulisan: DB dibuka `journal_mode=WAL` (SPEC-857,
  [ADR-0131](../adr/0131-retensi-change-feed-sync.md) §4), dan di WAL commit terbaru bisa masih
  berada di berkas `-wal`. `.backup` adalah backup online yang ikut membacanya; `cp hanoman.db`
  menghasilkan salinan yang **diam-diam** tertinggal beberapa transaksi.

  Restore: buat `$HANOMAN_HOME` mode `0700` milik user service, kembalikan kedua artefak di atas,
  lalu jalankan `hanoman doctor` — ia mencetak setiap path data efektif beserta izin tulisnya.
  Backup tanpa `secret.key` tidak dapat membuka RuntimeConfig/webhook secret. Backup harus
  dienkripsi dan mode private: ia memuat kunci privat SSH.
- Mengeset `HANOMAN_TRANSCRIPT_DIR`, `HANOMAN_UPLOAD_DIR`, atau `HANOMAN_SSH_KEY_DIR` memindahkan
  bagian itu keluar dari batas tersebut. Sah, tetapi backup-nya menjadi item runbook tersendiri —
  `hanoman doctor` mencetak path efektif yang berlaku.
- Setelah dugaan compromise atau migrasi dari deployment lama, rotasi cookie/session (cabut sesi),
  device token sync, AgentToken, webhook secret, model/API/Git credential, VPS key, setup token yang
  belum dipakai, serta credential access proxy. Jangan hanya mengganti password dashboard.

## 8. Verifikasi sebelum membuka Help publik

```sh
curl -fsS https://help.example/api/health
curl -i https://help.example/api/auth/status          # harus ditolak ingress
curl -i https://admin.example/api/help/project         # harus ditolak ingress
curl -i https://admin.example/api/auth/status          # hanya sesudah access proxy
```

Uji juga wrong setup token, exact WebSocket Origin, one-time ticket replay, upload EICAR-compatible
scanner fixture pada staging, webhook redirect 307 ke capture server staging, dan satu sesi agen
sandbox. Active DAST terhadap produksi membutuhkan otorisasi manusia terpisah.

## Update

```sh
hanoman update
systemctl restart hanoman
```

Migrasi dijalankan saat start. Sesudah update, ulangi `hanoman doctor`, smoke host matrix, dan satu
sesi sandbox sebelum membuka kembali traffic control. Jangan rollback ke konfigurasi root, public
control host, query token, atau sandbox `off`; rollback aman adalah menutup ingress publik sambil
mempertahankan boundary keamanan.
