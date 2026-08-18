# Menjalankan hanoman production di samping dev

Dua instance di satu mesin. State aplikasi dipisah lewat `HANOMAN_HOME`, port, tmux socket, dan
credential; eksekusi production juga wajib dipisah lewat rootless Podman network/image. DB tetap
satu berkas SQLite per instance ([ADR-0086](../adr/0086-sqlite-satu-satunya-provider.md)); Podman
hanya menjadi boundary agen, bukan packaging server ([ADR-0117](../adr/0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md)).

| | dev (checkout) | prod (paket npm) |
|---|---|---|
| data | `HANOMAN_HOME` default `~/.hanoman` · DB `file:../../hanoman-dev.db` dari `.env` | `HANOMAN_HOME=/srv/hanoman-prod` → `…/hanoman.db` |
| port | `8787` | `8787` di VPS sejak 2026-07-31 (dulu `8788`; contoh di bawah tetap `8788` supaya bisa dijalankan berdampingan dengan dev di mesin yang sama) |
| dashboard | vite dev server (`:5173`) | `web/` di dalam paket npm, disajikan proses api |

## Cara yang didokumentasikan: paket npm

```sh
npm i -g hanoman
hanoman doctor                                        # periksa git · tmux · CLI agen
sudo -u hanoman sh -c 'set -a; . /etc/hanoman-prod.env; exec hanoman --port 8788'
```

Satu perintah, dari keadaan mati total: `hanoman` me-resolve home & DB, memastikan Prisma client ada,
menjalankan `prisma migrate deploy`, lalu men-spawn bundle server dengan `NODE_ENV=production`
sehingga ia menyajikan dashboard dari `web/` di dalam paket sekaligus API
([ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md)). Tak ada proses worker terpisah.

`--no-migrate` melewati langkah migrasi; `--db <file>` menunjuk berkas DB langsung (menang atas
`DATABASE_URL`); `--host` mengubah bind. Untuk instance yang harus selamat reboot, jalankan di bawah
systemd — lihat [deploy-vps](deploy-vps.md).

`/etc/hanoman-prod.env` wajib memuat seluruh boundary dari runbook deploy-vps, bukan hanya home/port.
`NODE_ENV=production` menolak sandbox off, uid 0, bind non-loopback, origin split/trusted proxy kosong, atau
sandbox selain Podman. Untuk instance publik, gunakan unit dan env lengkap di
[deploy-vps](deploy-vps.md); dashboard control tidak boleh langsung dipublikasikan.

## Prod dari checkout (jalur pengembangan)

Masih didukung — `resolveLayout` mengenali layout repo — tetapi bukan lagi jalur default:

```sh
cp .env.production.example .env.production      # gitignored; setel PORT=8788 + DATABASE_URL prod
pnpm prod
```

`.env.production` di-*source* **sebelum** node boot (`set -a && . ./.env.production`), dan `env.ts`
tidak pernah menimpa var yang sudah ada — jadi nilainya menang atas `.env`. Kunci yang tidak disebut
di sana tetap jatuh ke `.env`: mis. `CLAUDE_CODE_OAUTH_TOKEN` dipakai bersama kecuali prod diberi
token sendiri. `prod` menjalankan `prod:setup` lebih dulu (rantai eksplisit `prod:setup && prod:api`,
**bukan** hook `preprod` — pnpm v7+ mematikan script `pre`/`post` secara default, jadi mengandalkan
`preprod` diam-diam melewati migrasi dan bikin fitur baru 500): `prisma migrate deploy`,
`prisma generate`, `pnpm build`, baru `node server/dist/server.js`.

## Yang masih berbagi — hati-hati

- **`pnpm build` saat prod-dari-checkout jalan** menimpa `server/dist/*` dan `src/dist/*` yang sedang
  disajikan. `prod:setup` ikut membangun, jadi `pnpm prod` kedua me-rebuild di bawah instance yang
  sedang melayani — matikan yang lama dulu. Instalasi npm tidak punya masalah ini: `hanoman update`
  menimpa direktori paket, dan instance lama tetap memakai kode yang sudah ter-`import` sampai
  di-restart.
- **`HANOMAN_HOME` yang sama = DB yang sama.** Dua instance yang lupa memisahkannya menulis ke satu
  berkas SQLite; pisahkan `HANOMAN_HOME` (atau `--db`) **dan** `HANOMAN_TMUX_SOCKET`.
- **`repoDir` yang sama** berarti dua instance tetap dapat mengubah repo yang sama walau kontainernya
  berbeda. Worktree mencegah tabrakan Git, bukan koordinasi nomor/backlog; gunakan clone berbeda dan
  mount hanya worktree sesi. Lihat [ADR-0021](../adr/0021-nomor-spec-diklaim-docs-bukan-hanya-database.md).
- **Network/credential sandbox yang sama** memperbesar blast radius. Gunakan network internal,
  credential directory, image, dan egress policy berbeda untuk prod dan dev.

## Memeriksa isolasi

```sh
curl -s localhost:8788/api/health                                   # {"ok":true}
sqlite3 /srv/hanoman-prod/hanoman.db 'select count(*) from "Spec"'  # opsional; sqlite3 bukan prasyarat
```

## Rollout hub + client (SPEC-213, ADR-0043)

SPEC-213 menambah peran **hub** dan **client** secara **additif** — prod single-host yang ada
sekarang **tetap jalan tanpa perubahan**: tanpa `SYNC_SERVER_URL` ia adalah **hub murni**
(perilaku lama). Tak ada migrasi wajib selain `prisma migrate deploy` (kolom/tabel baru semua
additive dengan default aman).

Peran ditentukan env, bukan binari berbeda:

| var | efek |
|---|---|
| *(tak diset)* | **Hub**: menerima push, melayani `GET /api/sync/pull`, menyiarkan `GET /api/sync/ws`. |
| `SYNC_SERVER_URL=https://hub.example` | **Client**: instance ini menyinkron (server-to-server) ke hub itu. |
| `SYNC_DEVICE_TOKEN=<token>` | Device token (Bearer) untuk auth sync/WS. Wajib bila `SYNC_SERVER_URL` diset. |
| `SYNC_TICK_MS` | Opsional; interval drain fallback outbox (default 15000). |

> **SPEC-761 (ADR-0117):** `SYNC_SERVER_URL` dan `SYNC_DEVICE_TOKEN` adalah setting cookie-admin-only.
> Mengganti URL menulis origin baru dan tombstone token secara atomik, menghentikan client, lalu
> menuntut token device baru; env lama tidak boleh diam-diam menjadi fallback credential.

Langkah pairing device client:

1. Di **hub**, login lalu terbitkan token: `POST /api/device-tokens {"name":"laptop-dev"}` →
   salin `token` (ditampilkan **sekali**).
2. Di **client**, set `SYNC_SERVER_URL` lalu masukkan `SYNC_DEVICE_TOKEN` baru melalui kanal admin
   private. Transport memakai Bearer header, menolak redirect, dan mem-pin alamat DNS tervalidasi.
3. Client menarik state hub (pull-before-push), lalu mem-push write lokalnya. Bind project ke
   checkout lokal (`PUT /api/projects/:id/binding` atau `POST /api/projects/:id/clone`) sebelum
   menjalankan sesi Claude — `repoDir`/binding **tak pernah** disync (per-mesin).

Kehilangan device = cabut satu token di hub (`DELETE /api/device-tokens/:id`); device lain tak
terpengaruh. TLS via reverse proxy (ADR-0028) wajib untuk melindungi token dari internet publik.

## Update (SPEC-398, mengganti mekanisme SPEC-214)

Identitas versi adalah **semver**, bukan SHA git: `pnpm build` menanam `version` root `package.json`
ke `dist/build-info.json`, dan server membandingkannya dengan `GET <registry>/hanoman/latest` (fetch
ter-gate `HANOMAN_UPDATE_FETCH`, registry bisa diarahkan `HANOMAN_NPM_REGISTRY`, TTL 5 menit, gagal →
`unavailable` tanpa melempar). Badge "Update" di topbar menampilkan versi jalan vs terbaru + perintah
untuk disalin. Terapkan:

```sh
hanoman update              # npm i -g hanoman@latest --prefer-online
systemctl restart hanoman   # atau matikan & jalankan ulang `hanoman`
```

Deteksi saja — server tak pernah memasang apa pun sendiri
([ADR-0048](../adr/0048-auto-update-deteksi-read-only.md) utuh): instance yang me-`npm i` dirinya
sendiri lalu keluar akan memutus sesi tmux yang sedang berjalan tanpa peringatan. `hanoman update
--check` hanya melaporkan, exit 0.

## SPEC-384 · membersihkan byte source-map (sekali, SEBELUM migrate)

`SourceMapArtifact` menyimpan byte `.map` di `HANOMAN_UPLOAD_DIR` dengan nama opaque `<uuid>.map` —
**direktori yang sama dengan lampiran tiket**. Jangan pernah menghapus direktorinya: lampiran tiket
yang masih dipakai ikut hilang. Baca daftar `storageKey` **sebelum** `prisma migrate deploy`
menjatuhkan tabelnya; sesudah itu daftarnya tak bisa direkonstruksi dari apa pun.

```bash
sqlite3 "$HANOMAN_HOME/hanoman.db" "SELECT storageKey FROM SourceMapArtifact" > /tmp/maps.txt
while read -r k; do [ -n "$k" ] && rm -f "$HANOMAN_UPLOAD_DIR/$k"; done < /tmp/maps.txt
```

Melewatkannya hanya menyisakan byte inert — tak ada yang rusak, cuma disk terpakai. Migration-nya
sendiri (`20260731180000_drop_errors_sdk_crossaudit`) tetap aman dijalankan tanpa langkah ini.
Lihat [ADR-0092](../adr/0092-cabut-error-monitoring-sdk-cross-audit.md).
