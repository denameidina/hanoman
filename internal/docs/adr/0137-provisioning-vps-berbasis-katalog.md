# ADR-0137 — Provisioning VPS berbasis katalog: probe sebagai sumber kebenaran, biner ≠ login

- Status: berlaku
- Tanggal: 2026-08-22
- SPEC: SPEC-883
- Menegakkan: ADR-0117, ADR-0042, ADR-0088 · Mengamandemen: ADR-0087 · Kontras dengan: ADR-0035

## Konteks

Memasang hanoman di sebuah VPS adalah prosedur manual sepanjang enam bagian di
`internal/docs/operations/deploy-vps.md`: user service, `/etc/hanoman.env`, Node, `npm i -g
hanoman`, unit systemd, reverse proxy + TLS, lalu membaca `setup.token` lewat shell untuk membuat
admin pertama. Setiap langkah benar; gabungannya memakan waktu dan tiap pengulangan melenceng
sedikit dari sebelumnya.

Modul VPS sudah punya separuh mesinnya sejak SPEC-164/220: `sshExec`, skrip deterministik lewat
stdin, protokol baris `STEP <item> <status> <detail>`, dry-run → apply, katalog item, dan Console
tmux (ADR-0042). Semuanya diarahkan ke *hardening* mesin yang sudah dipakai, bukan ke *menyiapkan*
mesin kosong.

Tiga fakta membentuk keputusan ini:

1. **Skrip VPS tak pernah ikut terpaket.** `copyPlan()` tidak menyalin `server/scripts/vps/`,
   sementara `scriptPath()` menjangkar ke `repoRoot()` — yang mencari marker `pnpm-workspace.yaml`
   dan **jatuh ke `process.cwd()`** bila tak ketemu. Di instalasi npm global dengan systemd
   (`WorkingDirectory=/var/lib/hanoman`) itu berarti ENOENT di setiap aksi VPS, senyap, sementara
   checkout dev terlihat sehat. Direproduksi sebagai test (`vps-script-path.test.ts`, `chdir("/")`).
2. **Biner ≠ siap pakai.** `claude`, `codex`, dan `gh` menuntut login interaktif. Skrip
   non-interaktif bisa memasang binernya dan membuktikan `--version`, tak bisa membuatnya siap.
3. **Profil production menolak boot tanpa sandbox.** `assertRuntimeBoundary` mensyaratkan non-root,
   `HANOMAN_SESSION_SANDBOX=podman`, control origin, trusted proxy, dan bind loopback saat
   `NODE_ENV=production` (ADR-0117) — dan sesi agen di sana berjalan **di dalam image Podman**,
   jadi `claude` yang terpasang di host tak akan pernah dipakai satu sesi pun.

## Keputusan

**K1 — Komponen adalah data, bukan cabang di dalam skrip.** `server/src/vps/catalog/components.ts`
mendefinisikan sembilan komponen beserta `requires` **per profil**, `profiles`, `interactiveLogin`,
dan `needsDomain`. `resolveComponents()` menutup dependensi dan mengurutkannya topologis **di
server**; skrip menerima daftar yang sudah lengkap & terurut dan tak pernah menebak.

**K2 — Satu skrip, dua mode, protokol baris yang sudah ada.** `server/scripts/vps/provision.sh`
menerbitkan `COMP <id> <ok|partial|absent> <detail>` pada `MODE=probe` dan `STEP <id>
<would|ok|fail|skip> <detail>` pada `MODE=apply`. `skip` adalah tambahan terhadap protokol
`remediate.sh`: komponen yang prasyaratnya gagal **wajib tetap menerbitkan baris**
(`skip blocked-by <id>`), karena daftar langkah yang lebih pendek dari yang dicentang terbaca
seperti "berhasil". Skrip tak boleh berasumsi apa pun tentang SSH — ia juga dijalankan lokal oleh
`hanoman provision`.

**K3 — Probe adalah satu-satunya penulis penandaan.** `Vps.components` tak pernah ditulis dari niat
("kami barusan memasang X"); apply yang sukses pun diakhiri probe ulang, dan itulah yang tersimpan
bersama `componentsCheckedAt`. Konsekuensinya penandaan tetap jujur ketika mesin diubah di luar
hanoman — kelas kegagalan SPEC-487 (marker ≠ bukti).

**K4 — Komponen ber-login berhenti di `partial`.** `probe` **tak pernah** memulangkan `ok` untuk
`claude`/`codex`/`gh`; paling jauh `partial not-logged-in <versi>`. UI menawarkan Console
(ADR-0042) tempat operator login sekali. **Nol rahasia menyeberang**: skrip tak pernah membaca,
menulis, meminta, atau meneruskan kredensial agen.

**K5 — Dua profil, `lab` dan `production`.** `lab` tak menyetel `NODE_ENV=production`: sesi berjalan
di host dan `claude`/`codex` dipasang di host. `production` memenuhi gerbang ADR-0117 utuh dan
memasang agen **ke dalam image**, dengan login mendarat di `HANOMAN_AGENT_CREDENTIAL_DIR` yang
di-mount RO oleh `sandboxArgv`. ADR-0117 **ditegakkan**, tak dilonggarkan sedikit pun.

**K6 — Gerbang DNS mendahului Caddy.** Bila `caddy` dipilih, skrip membandingkan A record domain
dengan alamat publik mesin lebih dulu; tak cocok → `STEP caddy fail dns-mismatch`, dan komponen lain
**tetap berjalan**. Sertifikat ACME yang gagal terbit meninggalkan Caddy hidup tanpa TLS sekaligus
membakar rate-limit Let's Encrypt.

**K7 — Kolom penandaan LOCAL-ONLY.** `components`, `componentsCheckedAt`, dan `provisionProfile`
sengaja di luar `FIELDS.vps`. Terukur di SPEC-880: `snapshot()` mengirim kolom baru di **setiap**
push, sehingga hub yang lebih tua menolak seluruh push entitas itu. Status komponen juga milik mesin
yang memegang key SSH-nya; client lain tak punya cara memverifikasinya.

**K8 — Serah-terima lewat setup token transien.** Sesudah probe ulang melaporkan `hanoman ok`,
server membaca `setup.token` lewat SSH dan memulangkan `{ setup: { url, expiresAt } }` **hanya di
badan respons provision**. Token tak pernah masuk DB, log, maupun endpoint lain.

**K9 — Skrip VPS menjadi bagian paket npm.** `copyPlan()` menyalin `server/scripts/vps` dan
`REQUIRED_ARTIFACTS` menuntut keempat skrip; `scriptPath()` mencari lokasi terpaket lebih dulu lalu
jatuh ke `repoRoot(<direktori modul>)` — **bukan** `process.cwd()`. Ini mengamandemen ADR-0087
(daftar artefak paket) dan sekaligus menghidupkan kembali audit/harden/remediate di instalasi npm.

## Konsekuensi

- Provisioning bisa diulang dan hasilnya bisa dibandingkan: idempoten, `skip already-present`.
- Penandaan tetap jujur saat mesin disentuh di luar hanoman, dengan harga satu round-trip SSH.
- **Profil `lab` bukan konfigurasi bertahan-serangan.** Karena `NODE_ENV` bukan production, cookie
  sesi lahir **tanpa flag `Secure`** (`server/src/services/auth.ts`). Di balik Caddy yang memaksa
  HTTPS ini tak membuka apa pun ke jaringan, tetapi profil itu tak boleh melayani permukaan Help
  publik. Disebut eksplisit di UI dan `deploy-vps.md`.
- Tabel dependensi ada di dua tempat (katalog TypeScript & `deps_of` di skrip). Duplikasi disengaja:
  server sudah mengirim daftar lengkap, tabel di skrip hanya menerbitkan `blocked-by` yang benar
  saat prasyarat gagal di tengah jalan. Test route yang menangkap bila keduanya melenceng.

## Alternatif yang ditolak

- **Mencatat apa yang hanoman pasang** (flag saat apply sukses). Lebih murah, tapi bohong begitu
  ada yang uninstall/upgrade/mematikan service di luar hanoman — SPEC-487.
- **Menyalin kredensial agen antar mesin** (`~/.claude/.credentials.json`, `~/.codex/auth.json`,
  token `gh`). Sekali provision langsung siap pakai, tapi hanoman jadi memindahkan rahasia jangka
  panjang antar mesin, dan sesi tersalin bisa ditolak perangkat/ToS.
- **Field API key di form.** API key ≠ langganan Claude Code, dan rahasianya jadi tersimpan di DB.
- **Sesi Claude sebagai mesin provisioning** (jalur `POST /vps/:id/session` yang sudah ada). Tak
  deterministik, tak bisa dry-run, tak bisa dibandingkan antar-mesin. Escape hatch itu tetap ada
  untuk kasus yang skrip tak tangani — kontras dengan ADR-0035.
- **Menyertakan `components` ke sync.** Lihat K7.
- **Melonggarkan `assertRuntimeBoundary` agar profil siap-pakai lolos di production.** Itu mencabut
  ADR-0117 diam-diam; yang dipilih justru dua profil eksplisit dengan batas yang disebutkan.
