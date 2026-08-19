---
name: hanoman-devops
description: >-
  Pakai saat men-deploy atau mengoperasikan aplikasi hanoman di server:
  instalasi paket npm global (`npm i -g hanoman`) + systemd, VPS single-host di
  belakang reverse proxy TLS, prod di samping dev lewat `HANOMAN_HOME`,
  split public/control host, rootless Podman agent sandbox, Caddy/nginx, DB SQLite embedded + `prisma migrate deploy`, migrasi sekali-jalan
  dari Postgres (`hanoman migrate-from-postgres`), `hanoman update` (SPEC-398),
  rollout sync hub/client (SPEC-213), migrasi data ke VPS live, serta verifikasi
  & troubleshoot boot/DB/terminal. Sub-skill dari skill `hanoman`.
---

# hanoman-devops

## Ikhtisar

Skill operasional untuk **mengirim & menjalankan aplikasi hanoman di server** — bukan fitur modul VPS (yang mengelola VPS lain), tapi men-deploy hanoman itu sendiri. Sejak SPEC-398 hanoman adalah **paket npm global** dengan **DB SQLite embedded**: server tidak dipaketkan sebagai container, tak ada Postgres, dan tak perlu clone repo ([ADR-0086](../../docs/adr/0086-sqlite-satu-satunya-provider.md) · [ADR-0087](../../docs/adr/0087-distribusi-npm-global-satu-perintah.md)). Sejak SPEC-761, rootless Podman **wajib** sebagai boundary proses agen production ([ADR-0117](../../docs/adr/0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md)). Dua pola hidup berdampingan:

- **VPS public deployment** — Help/status host publik terpisah dari control host ber-SSO/MFA/VPN/access proxy; origin loopback dan sesi rootless. Runbook: `internal/docs/operations/deploy-vps.md`.
- **Prod di samping dev** — dua instance di satu mesin, dipisah `HANOMAN_HOME` + port. Runbook: `internal/docs/operations/production.md`.

Selalu ikuti runbook di `internal/docs/operations/**` sebagai Source of Truth; skill ini merangkum urutan, gotcha, dan aturan keselamatan.

## Instance Live — JANGAN dirusak

hanoman sudah **live di VPS** di `https://hanoman.<domain>` sebagai **hub multi-user** dengan **akun teammate nyata** + Session login mereka. Detail host, IP, akun, dan token **tidak** ada di repo (publik/open-source) — mereka hidup di berkas env (gitignored / `/etc/hanoman.env` mode 600) di VPS dan di catatan ops privat.

- **Cutover Postgres → SQLite adalah operasi sekali-jalan yang membawa SEMUA data**, termasuk `User`/`Session`/`DeviceToken`: `pg_dump` dulu → `hanoman migrate-from-postgres --from "$OLD_PG_URL" --dry-run` → tanpa `--dry-run` → verifikasi lewat login dashboard → **baru** matikan Postgres lama. Sebelum verifikasi, Postgres lama adalah satu-satunya salinan hidup selain dump.
- **Migrasi data lokal → VPS harus ADITIF.** Jangan pernah menyalin berkas DB lokal menimpa berkas DB VPS — itu menghapus User/Session teammate. Copy **tabel konten saja** (Project→Spec FK-order, Vps), sisakan `User`/`Session`/`DeviceToken`. Ambil salinan `$HANOMAN_HOME/hanoman.db` di VPS dulu (rollback) — dengan SQLite, backup = menyalin satu berkas (sertakan `-wal`/`-shm` bila ada, atau `sqlite3 … ".backup"`).
- **Backup ≠ hanya DB (SPEC-846).** Batasnya `$HANOMAN_HOME` seutuhnya: `hanoman.db`, `secret.key`, `id_ed25519(.pub)`, `transcripts/`, `uploads/`. Restore yang hanya membawa DB menghasilkan metadata utuh dengan byte hilang — transkrip gagal dibuka, lampiran 404, dan identitas SSH lahir baru sehingga tiap VPS yang sudah di-bootstrap menolak koneksi diam-diam. Resep lengkap: `internal/docs/operations/deploy-vps.md` §7. `hanoman doctor` mencetak path data efektif + izin tulisnya.
- **`Project.repoDir` & `Vps.keyPath` adalah path mesin lokal** (mac `/Users/...`) yang tak resolve di VPS — set `repoDir` **NULL** lalu re-bind di VPS; `keyPath` di-set ulang di VPS atau healthcheck VPS gagal.
- VPS aktif bermutasi selama dipakai — re-snapshot tepat sebelum menulis.

## Bacaan Awal

- Deploy VPS single-host: `internal/docs/operations/deploy-vps.md`
- Prod di samping dev: `internal/docs/operations/production.md`
- README paket npm (pasang, prasyarat, konfigurasi, pindah dari Postgres): `internal/docs/operations/npm-readme.md`
- **Merilis paket npm** (trusted publishing OIDC, tag `v*`, pagar-pagarnya): `internal/docs/operations/release-npm.md`
- SQLite satu-satunya provider: [ADR-0086](../../docs/adr/0086-sqlite-satu-satunya-provider.md) · distribusi npm global: [ADR-0087](../../docs/adr/0087-distribusi-npm-global-satu-perintah.md) (SPEC-398)
- Auth & bind 127.0.0.1: `internal/docs/security/security-standard.md` · [ADR-0028](../../docs/adr/0028-auth-sesi-opaque-di-db.md)
- Threat model publik: `internal/docs/security/threat-model.md` · [ADR-0117](../../docs/adr/0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md)
- Update deteksi read-only: [ADR-0048](../../docs/adr/0048-auto-update-deteksi-read-only.md) (mekanisme diganti SPEC-398, keputusannya utuh)
- Arsitektur sync hub/client: [ADR-0043](../../docs/adr/0043-sync-arsitektur-hub-client-server-to-server.md) (SPEC-213), device token [ADR-0044](../../docs/adr/0044-device-token-machine-identity.md), knob runtime [ADR-0049](../../docs/adr/0049-config-runtime-store-registry.md)
- Sesi di tmux: [ADR-0016](../../docs/adr/0016-sesi-terminal-hidup-di-tmux.md) · PTY = RCE by design [ADR-0014](../../docs/adr/0014-pty-terminal-di-proses-api.md)

## Prinsip

- **Server bind `127.0.0.1` tanpa pengecualian production.** Public origin hanya health/Help; control origin wajib di belakang SSO/MFA/VPN/access proxy. Exact origin dan trusted proxy hop/CIDR wajib; firewall cukup buka `22/80/443`, port app tetap lokal.
- **Server non-root, agen rootless.** Unit `User=hanoman`, `WorkingDirectory=/var/lib/hanoman`, `UMask=0077`. Semua sesi serta lead/changelog one-shot berjalan lewat Podman rootless, internal network, egress proxy allowlist, mount/credential minimum. Worktree bukan sandbox security.
- **Repo publik → rahasia tak pernah ter-commit.** Host VPS, token, kredensial hanya di berkas env gitignored / `/etc/hanoman.env` (`chmod 600`) di VPS. `.gitignore` mengabaikan semua `.env*` kecuali `*.example`. Pakai placeholder (`<VPS_HOST>`, `hanoman.<domain>`) di dokumen ter-track.
- **Server tak pernah self-mutate** (ADR-0048): ia hanya **mendeteksi** update (badge di topbar), tak pernah memasang/restart sendiri — instance yang me-`npm i` dirinya sendiri lalu keluar akan memutus sesi tmux yang berjalan. `hanoman update` di CLI yang menerapkannya.
- **Bootstrap dari console:** baca token one-time 0600 di `$HANOMAN_HOME/setup.token`, berlaku 15 menit, lalu paste hanya di host control. Setup atomik dan permanen tertutup sesudah admin pertama.

## Deploy VPS baru (single-host)

Prasyarat VPS: Node ≥20 · git · tmux · `build-essential python3` · Podman rootless/uidmap · image agen pinned · egress proxy allowlist · executable malware scanner. pnpm tidak dibutuhkan.

1. **Pasang:** buat user/group `hanoman`, home 0700 dan credential dir terpisah; `npm i -g hanoman`; provision image agen, rootless internal network, egress proxy, dan scanner; jalankan `hanoman doctor` sebagai user service sebelum systemd.
2. **Migrasi (hanya bila ada instance Postgres lama):** `pg_dump` → `hanoman migrate-from-postgres --from "$OLD_PG_URL" --dry-run` → tanpa `--dry-run`. Lihat gotcha di bawah.
3. **Env private:** set home/loopback, exact `HANOMAN_PUBLIC_ORIGINS` + `HANOMAN_CONTROL_ORIGINS`, explicit `HANOMAN_TRUST_PROXY`, `HANOMAN_SESSION_SANDBOX=podman`, image/network/proxy/credential-dir, dan absolute `HANOMAN_UPLOAD_SCANNER`. Jangan taruh token di argv.
4. **systemd:** unit wajib `User=hanoman`, `Group=hanoman`, `WorkingDirectory=/var/lib/hanoman`, `UMask=0077`, `NoNewPrivileges=true`, `PrivateTmp=true`, env file private, dan `ExecStart=/usr/bin/env hanoman`.
5. **Ingress:** dua virtual host. Help boleh publik; control harus melewati access proxy SSO/MFA/VPN. Keduanya reverse ke loopback yang sama; aplikasi tetap menolak route salah-host.
6. **Verifikasi:** smoke host matrix, wrong/valid setup token dan concurrency, exact Origin + WS ticket replay, webhook 307 capture, upload scanner failure, retention dry-run, permission mode, dan satu sesi sandbox. Active DAST production butuh otorisasi manusia terpisah.

## Prod di samping dev (satu mesin)

Dua instance dipisah **`HANOMAN_HOME` + port + tmux socket + sandbox network/credential**. Production tetap wajib membawa seluruh env boundary ADR-0117; satu-liner `HANOMAN_HOME=… hanoman` tidak cukup lagi. Prod dari checkout masih didukung tetapi bukan jalur default. Bahaya berbagi:

- **`pnpm build` saat prod-dari-checkout jalan** menimpa `server/dist/*` & `src/dist/*` yang sedang disajikan — matikan instance lama dulu. Instalasi npm tak punya masalah ini.
- **`HANOMAN_HOME` sama = berkas DB sama.** Pisahkan `HANOMAN_HOME` (atau `--db`) **dan** `HANOMAN_TMUX_SOCKET`.
- **`repoDir` sama** → sesi prod meng-commit ke repo yang sedang diedit; isolasi cuma per-worktree. Nomor SPEC diklaim dari nama berkas docs → waspada tabrakan (ADR-0021).

## Update (SPEC-398 / ADR-0048)

Badge "Update" muncul saat versi di **registry npm** lebih baru dari versi yang jalan — perbandingan **semver**, bukan SHA git (`pnpm build` menanam `version` root ke `dist/build-info.json`; fetch ter-gate `HANOMAN_UPDATE_FETCH`, registry bisa diarahkan `HANOMAN_NPM_REGISTRY`, TTL 5 mnt, gagal → `unavailable` tanpa melempar). Terapkan:

```sh
hanoman update              # npm i -g hanoman@latest --prefer-online  (`--check` hanya melaporkan)
systemctl restart hanoman
```

Migrasi diterapkan otomatis saat start, jadi tak ada langkah `migrate deploy` terpisah. `migrate deploy` idempotent; akun & Session tak tersentuh. Restart aman untuk sesi agen — mereka hidup di tmux server sendiri (ADR-0016) dan selamat dari restart proses API; yang perlu re-attach hanya klien WebSocket.

## Merilis paket npm (ADR-0087, amandemen 2026-07-30)

Publish dijalankan `.github/workflows/release.yml` pada tag `v*` lewat **trusted publishing (OIDC)** — **tak ada token penerbit di mesin mana pun**. Tiap rilis: bump `version` di **root `package.json`** (satu sumber, ditanam ke `dist/build-info.json`) → merge → `git tag v0.2.0 && git push origin v0.2.0`. Runbook lengkap: `internal/docs/operations/release-npm.md`.

- **`pnpm release` TIDAK menerbitkan apa pun** — ia hanya build + rakit staging `dist-npm/` + `npm pack --dry-run`. Tak ada jalur publish dari mesin dev, dan itu disengaja.
- **Jangan pernah membuat Granular Access Token ber-"bypass 2FA"** untuk ini. Ia adalah kredensial penerbit di `~/.npmrc` — bisa dibaca proses apa pun di mesin itu, **termasuk sesi agen**, dan bisa menerbitkan paket apa pun milik akun itu. Docs npm menyarankan menghapusnya dan memakai trust relationship.
- **Gerbang manusia yang sebenarnya = GitHub Environment `release` + Required reviewers.** Mendorong tag saja bukan gerbang: agen yang punya akses push bisa membuat tag.
- **`repository.url` wajib cocok PERSIS** dengan repo pembangun (`REPO_URL` di `cli/src/release/pack.ts`, dijaga `cli/test/pack.test.ts`) — trusted publishing & `--provenance` membandingkannya, dan gagalnya hanya muncul di CI.
- **Versi terbit tak bisa dipakai ulang.** npm menolak menimpa; unpublish hanya ≤72 jam dan tetap memblokir nama+versi selamanya. Karena itu workflow **menggagalkan run** bila tag ≠ `version` root, dan **memasang lalu menjalankan** tarballnya (`hanoman --version`) sebelum publish.
- `hanoman doctor` sengaja **tak** dipakai di CI — ia menuntut tmux & CLI agen yang tak ada di runner.

## Rollout sync hub/client (SPEC-213 / ADR-0043)

Peran ditentukan **env**, bukan binari berbeda — prod single-host tanpa `SYNC_SERVER_URL` = **hub murni** (perilaku lama, tanpa perubahan). Kolom/tabel baru semua additive → cukup `migrate deploy` (dijalankan `hanoman start` sendiri).

| var | efek |
|---|---|
| *(tak diset)* | **Hub** — menerima push, melayani `/api/sync/pull`, siar `/api/sync/ws`. |
| `SYNC_SERVER_URL=https://hub.example` | **Client** — destination sensitif cookie-admin-only. |
| `SYNC_DEVICE_TOKEN=<token>` | Bearer auth sync/WS. Wajib bila `SYNC_SERVER_URL` diset. |
| `SYNC_TICK_MS` | Opsional; interval drain outbox (default 15000). |

Knob sync dapat diatur runtime dari **Settings → Konfigurasi**, tetapi URL dan token hanya oleh cookie admin. Ganti URL menghapus token lama atomik dan menghentikan client; pairing token baru wajib. Transport memakai Bearer header, no-redirect, dan address pinning. Bind project ke checkout lokal sebelum sesi; `repoDir`/binding tak disync.

## Verifikasi & Troubleshoot

- Health: `curl -fsS https://hanoman.<domain>/api/health` → `{"ok":true}`. Isi DB (opsional, `sqlite3` bukan prasyarat): `sqlite3 /srv/hanoman-prod/hanoman.db 'select count(*) from "Spec"'`.
- Log service: `systemctl status hanoman` · `journalctl -u hanoman -f`.
- **`@prisma/client did not initialize yet` di instalasi npm** = `postinstall` (`prisma generate`) dilewati — `--ignore-scripts`, sebagian CI, sebagian setup npm global. `hanoman start` mendeteksi & menggenerate sendiri (`ensurePrismaClient`); bila itu pun gagal, jalankan `prisma generate --schema <pkg>/prisma/schema.prisma` manual atau pasang ulang tanpa `--ignore-scripts`. Gejala khasnya **menyesatkan**: migrasi **berhasil**, server mati seketika sesudahnya.
- **`DATABASE_URL harus URL SQLite file:` saat boot** = env masih menunjuk Postgres. Itu **disengaja** (ADR-0086) — jangan diakali dengan menghapus pemeriksaannya; kosongkan var itu (default `$HANOMAN_HOME/hanoman.db`) atau selesaikan migrasinya.
- **`migrate-from-postgres` melempar sebelum menyentuh apa pun** = `DATABASE_URL` masih Postgres → kosongkan, atau sebut target eksplisit `--to /srv/hanoman-prod/hanoman.db`.
- **Terminal/IDE 500** kerap = migrasi belum diterapkan ke berkas DB yang benar. Periksa berkas mana yang dipakai: `hanoman doctor` mencetak path DB yang di-resolve — path relatif di `DATABASE_URL` di-resolve **relatif ke direktori `schema.prisma`**, bukan cwd, jadi "tabel hilang" biasanya berarti dua berkas berbeda.
- **DB terkunci / `SQLITE_BUSY`** = dua proses menulis ke satu berkas. Pisahkan `HANOMAN_HOME` per instance.

## Jangan

- Jangan `HOST=0.0.0.0` di production, mempublikasikan control host tanpa access proxy, atau memakai satu hostname public/control.
- Jangan menjalankan unit sebagai root, memakai sandbox `off`, mount seluruh home host, atau memberi internet langsung pada container agen.
- Jangan menerima token WS lewat query atau mengganti sync origin tanpa pairing/token baru.
- Jangan menaruh host/IP/token/kredensial di file ter-track (repo publik) — hanya berkas env gitignored di VPS.
- Jangan full-overwrite DB VPS live (termasuk menimpa berkas `hanoman.db`) — migrasi data **aditif** saja, sisakan User/Session/DeviceToken.
- Jangan matikan/hapus Postgres lama sebelum hasil `migrate-from-postgres` **diverifikasi** lewat login dashboard.
- Jangan menjalankan `migrate-from-postgres` tanpa `pg_dump` lebih dulu, dan jangan lewati `--dry-run`.
- Jangan menganggap server akan update sendiri — ia deteksi saja (ADR-0048); operator yang menjalankan `hanoman update` + restart.
- Jangan membuat Granular Access Token npm ber-"bypass 2FA", dan jangan menambahkan `npm publish` ke script apa pun — rilis lewat workflow ber-OIDC pada tag `v*` (ADR-0087).
