# SPEC-883 · Provisioning VPS satu perintah dengan katalog komponen ber-toggle

**Tanggal:** 2026-08-22
**Status:** design, disetujui operator
**Menyentuh:** `server/scripts/vps/**` (baru), `server/src/vps/catalog/**`, `server/src/services/vps-provision.ts`,
`server/src/routes/vps.ts`, `server/prisma/schema.prisma` (2 kolom additif), `cli/src/**` (subperintah +
packing), `shared/src/**` (DTO), `src/src/screens/VpsScreen.tsx`. ADR baru: **ADR-0137**.

> Nomor spec ini menunggu id backlog yang diterbitkan server. Bila server memberi nomor lain,
> selaraskan nama berkas, judul, dan seluruh rujukan dalam satu commit (preseden SPEC-882).

## Masalah

Memasang hanoman di sebuah VPS hari ini adalah prosedur manual sepanjang enam bagian di
`internal/docs/operations/deploy-vps.md`: buat user service, tulis `/etc/hanoman.env`, pasang Node,
`npm i -g hanoman`, karang unit systemd, pasang reverse proxy + TLS, lalu baca `setup.token` lewat
shell untuk membuat admin pertama. Setiap langkah benar; gabungannya memakan waktu dan setiap
pengulangan melenceng sedikit dari sebelumnya.

Modul VPS hanoman sudah memiliki separuh mesin yang dibutuhkan untuk mengotomatiskannya —
`sshExec` (`services/vps-ssh.ts`), skrip deterministik yang dikirim lewat stdin, protokol baris
`STEP <item> <status> <detail>`, dry-run → apply, katalog item, dan Console tmux — tetapi semuanya
diarahkan ke *hardening* mesin yang sudah dipakai, bukan ke *menyiapkan* mesin kosong.

Tiga fakta yang ditemukan saat memeriksa keadaan sekarang, dan ketiganya membentuk rancangan ini:

1. **Skrip VPS tidak ikut terpaket.** `copyPlan()` (`cli/src/release/pack.ts:73`) tidak menyalin
   `server/scripts/vps/`, sementara `scriptPath()` (`services/vps-audit.ts:73`) menjangkar ke
   `repoRoot()/server/scripts/vps`. Pada instalasi npm global berkas itu tak ada — artinya audit,
   harden, dan remediate kemungkinan besar sudah mati di produksi hari ini, senyap. `provision.sh`
   mustahil bekerja sebelum ini diperbaiki, jadi perbaikannya masuk scope.
2. **Biner ≠ siap pakai.** `claude`, `codex`, dan `gh` sama-sama menuntut login interaktif. Skrip
   non-interaktif bisa memasang binernya dan membuktikan `--version`, tetapi tidak bisa membuatnya
   siap. Menyatakan "terpasang" untuk keduanya adalah kelas kesalahan SPEC-487 (marker ≠ bukti).
3. **Profil production menolak boot tanpa sandbox.** `assertRuntimeBoundary`
   (`services/session-sandbox.ts:3`) mensyaratkan non-root, `HANOMAN_SESSION_SANDBOX=podman`,
   control origin, trusted proxy, dan bind loopback saat `NODE_ENV=production` (ADR-0117). Lebih
   jauh, sesi agen di profil itu berjalan **di dalam image Podman** — `claude` yang terpasang di
   host tak akan pernah dipakai satu sesi pun.

## Keputusan

### K1 — Katalog komponen, bukan daftar langkah

`server/src/vps/catalog/components.ts` (cermin katalog checklist SPEC-220) mendefinisikan komponen
sebagai data, bukan cabang di dalam skrip:

```ts
export type ComponentId =
  | "base" | "node" | "hanoman" | "caddy" | "podman" | "agent-image"
  | "claude" | "codex" | "gh";

export type Component = {
  id: ComponentId;
  label: string;
  section: "dasar" | "hanoman" | "ingress" | "sandbox" | "agen";
  requires: ComponentId[];              // per profil, lihat K2
  interactiveLogin: boolean;            // true → probe tak pernah memulangkan `ok`, hanya `partial`
  params?: Array<{ key: "domain"; required: true }>;
  profiles: Array<"lab" | "production">;
};
```

Isi awal:

| id | label | requires (lab) | requires (production) | login |
|---|---|---|---|---|
| `base` | paket dasar: curl, git, tmux, ca-certificates, toolchain `node-pty` | — | — | — |
| `node` | Node.js 22 LTS | `base` | `base` | — |
| `hanoman` | `npm i -g hanoman`, user service, `/etc/hanoman.env`, unit systemd, `enable --now` | `node` | `node`, `podman` | — |
| `caddy` | Caddy + `reverse_proxy 127.0.0.1:8787` + TLS otomatis (param `domain`) | — | — | — |
| `podman` | Podman rootless + network internal `hanoman-egress` + egress proxy | `base` | `base` | — |
| `agent-image` | build `hanoman-agent:latest` dari `agent.Containerfile` | *(production saja)* | `podman` | — |
| `claude` | Claude Code CLI | `node` | `agent-image` | ya |
| `codex` | Codex CLI | `node` | `agent-image` | ya |
| `gh` | GitHub CLI | `base` | `base` | ya |

Dependensi diselesaikan **di server** (`resolveComponents(ids, profile)`), bukan di skrip: mencentang
`hanoman` mengirim `base,node,hanoman` (lab) atau `base,node,podman,hanoman` (production), terurut
topologis. Skrip menerima daftar yang sudah lengkap dan berurut — ia tak pernah menebak.

### K2 — Dua profil, dipilih di form

`profile: "lab" | "production"` adalah parameter provision, bukan komponen.

- **lab** — `NODE_ENV` **tidak** diset production. Sesi agen berjalan di host, jadi `claude`/`codex`
  dipasang di host. Env yang ditulis: `HANOMAN_HOME=/var/lib/hanoman`, `PORT=8787`,
  `HOST=127.0.0.1`, `HANOMAN_TMUX_SOCKET=hanoman-prod`. Ini profil "satu operator, siap dalam
  hitungan menit" yang diminta brief.
- **production** — gerbang ADR-0117 lengkap: `NODE_ENV=production`, `HANOMAN_SESSION_SANDBOX=podman`,
  `HANOMAN_SESSION_NETWORK=hanoman-egress`, `HANOMAN_EGRESS_PROXY`,
  `HANOMAN_AGENT_CREDENTIAL_DIR=/var/lib/hanoman/agent-credentials`, `HANOMAN_TRUST_PROXY=1`,
  `HANOMAN_CONTROL_ORIGINS=https://<domain>` + `HANOMAN_SINGLE_ORIGIN=1` (pengakuan eksplisit
  single-origin, SPEC-805). `claude`/`codex` dipasang **ke dalam image agen**, dan login-nya
  mendarat di credential dir yang di-mount RO oleh `sandboxArgv`.

Profil yang dipilih menentukan `requires` mana yang dipakai dan ke mana komponen agen dipasang.
Tak ada profil ketiga, dan profil **tidak** bisa diubah dengan provision ulang menjadi profil lain
tanpa `--force` — lihat K9.

Konsekuensi profil lab yang harus disebut jujur di UI dan docs: cookie sesi lahir **tanpa flag
`Secure`** (`services/auth.ts:84` mengikat flag itu ke `NODE_ENV === "production"`). Di balik Caddy
yang memaksa HTTPS ini tidak membuka apa pun ke jaringan, tetapi ia berarti profil lab **bukan**
konfigurasi bertahan-serangan dan tak boleh dipakai untuk host yang melayani permukaan Help publik.

### K3 — Satu skrip, dua mode, protokol baris yang sudah ada

`server/scripts/vps/provision.sh` — satu berkas, tanpa asumsi apa pun tentang SSH (ia harus jalan
sama persis saat dieksekusi lokal oleh CLI, K7). Deteksi OS family apt/dnf memakai pola yang sudah
diuji `vps-os-family.test.ts`.

**Mode probe** (`MODE=probe`, nol tulis, tanpa `sudo` bila memungkinkan):

```
COMP <id> <ok|partial|absent> <detail>
```

- `ok` — terpasang dan siap. Komponen `interactiveLogin` **tak pernah** memulangkan `ok`.
- `partial` — terpasang tetapi belum siap: `claude partial not-logged-in`,
  `hanoman partial service-inactive`, `caddy partial no-tls`.
- `absent` — tak terpasang.
- `detail` memuat versi bila ada (`hanoman ok 1.4.2`).

**Mode apply** (`MODE=apply ITEMS=a,b,c PROFILE=lab DOMAIN=… DRY_RUN=1`):

```
STEP <id> <would|ok|fail|skip> <detail>
```

Protokolnya identik `remediate.sh`, jadi `parseSteps` dipakai ulang apa adanya. `DRY_RUN=1`
memulangkan seluruh langkah sebagai `would` tanpa menyentuh mesin. Idempoten: menjalankan ulang
komponen yang sudah `ok` menghasilkan `skip already-present`.

Urutan berhenti: kegagalan sebuah komponen membuat semua komponen yang `requires`-nya memuat
komponen itu dilaporkan `skip blocked-by <id>` — sisanya tetap jalan. Satu komponen gagal tak
pernah membatalkan yang tak bergantung padanya.

### K4 — Gerbang DNS di depan, bukan kegagalan di tengah

Bila `caddy` termasuk item, skrip lebih dulu me-resolve `A`/`AAAA` `DOMAIN` dan membandingkannya
dengan alamat publik mesin. Tak cocok → `STEP caddy fail dns-mismatch <resolved> != <mesin>`, dan
komponen lain **tetap berjalan**. Alasannya: sertifikat Let's Encrypt yang gagal terbit meninggalkan
Caddy hidup tanpa TLS dan rate-limit ACME yang terbakar, dua-duanya jauh lebih mahal daripada
menolak di depan.

### K5 — Probe adalah sumber kebenaran, DB hanya cache

`Vps.components` **tidak pernah** ditulis dari niat ("kami barusan memasang X"). Ia hanya ditulis
dari keluaran `MODE=probe`. Provision yang sukses pun diakhiri probe ulang, dan itulah yang
tersimpan. Konsekuensinya penandaan tetap jujur ketika seseorang meng-uninstall, meng-upgrade, atau
mematikan service di luar hanoman — kelas kegagalan yang sudah pernah ditabrak di SPEC-487.

`componentsCheckedAt` selalu ditampilkan bersama lencana; lencana tanpa waktu adalah klaim tanpa
tanggal.

### K6 — Nol rahasia

`provision.sh` tak pernah membaca, menulis, menyalin, atau meminta kredensial agen. Komponen
`interactiveLogin` berhenti di biner + verifikasi versi, lalu UI menawarkan **Login lewat Console**
— sesi ssh tmux yang sudah ada (`POST /vps/:id/console`, SPEC-211/ADR-0042), tempat operator
menjalankan `claude` / `codex` / `gh auth login` sekali. Di profil production tombol yang sama
membuka Console dengan perintah yang sudah dirangkai untuk masuk ke dalam container dengan
`HOME=$HANOMAN_AGENT_CREDENTIAL_DIR`, sehingga login mendarat tepat di direktori yang di-mount sesi.

Password SSH tetap hanya hidup di jalur bootstrap key yang sudah ada (`bootstrapKey`, SPEC-165);
provision **selalu** berjalan key-only, `BatchMode=yes`.

### K7 — Jalur mandiri lewat paket npm, skrip yang sama

`hanoman provision [--with=a,b] [--profile=lab|production] [--domain=…] [--probe] [--dry-run] [--yes]`
menjalankan `provision.sh` **secara lokal** (`bash provision.sh`, tanpa ssh) dan mencetak
`STEP`/`COMP` apa adanya ke stdout. Tanpa `--yes` ia dry-run lebih dulu lalu meminta konfirmasi.

Ini memaksa satu batasan pada skrip yang disebut di K3: nol asumsi tentang SSH, stdin, atau
lingkungan yang dikirim server.

Prasyaratnya jujur: jalur ini menuntut Node + paket `hanoman` sudah ada di mesin itu. Ia bukan untuk
mesin kosong dari nol — untuk itu jalur dashboard (K8) yang dipakai. Di mesin kosong, dua baris
yang terdokumentasi di `deploy-vps.md` (pasang Node, `npm i -g hanoman`) mendahuluinya.

**Packing**: `copyPlan()` mendapat `{ from: server/scripts/vps, to: scripts/vps, dir: true }`, dan
`scriptPath()` mencari `<pkg>/scripts/vps/<f>` lebih dulu sebelum jatuh ke `repoRoot()`. `REQUIRED_ARTIFACTS`
+ `verify-packed` menegakkan keempat skrip ada di tarball. Ini sekaligus menghidupkan kembali audit,
harden, dan remediate di instalasi npm.

### K8 — Endpoint: pratinjau, pasang, probe

Semuanya di `routes/vps.ts`, capability tetap turun dari prefix `vps` per method — **tak ada peta
capability baru** (kelas jebakan ADR-0088: menambah endpoint tulis di bawah prefix baca).

Provision yang sukses **tak pernah** dipicu penjadwal. Seperti `harden`, ia hanya lahir dari tombol.

### K9 — Konfirmasi & idempotensi

`POST /vps/:id/provision` tanpa `confirm` memulangkan `409 confirm-required` beserta langkah dry-run
— pola dua langkah `POST /api/update/apply` (ADR-0088). UI memakai `useConfirm` (ADR-0125).

Provision ulang pada VPS yang `components.hanoman.status === "ok"` dengan **profil berbeda** ditolak
`409 profile-mismatch` kecuali `force: true`: menulis ulang `/etc/hanoman.env` dari lab ke production
akan membuat service menolak boot sampai Podman siap, dan itu memutus instance yang sedang dipakai.

### K10 — Serah-terima: tautan setup siap klik

Sesudah apply sukses dan probe ulang melaporkan `hanoman ok`, server memeriksa apakah instance baru
itu belum punya admin. Bila `setup.token` ada, isinya dibaca lewat SSH
(`sudo -u hanoman sed -n '1p' $HANOMAN_HOME/setup.token`) dan dipulangkan **hanya di badan respons
provision** sebagai `{ setup: { url, expiresAt } }` dengan `url = https://<domain>/setup?token=…`
(atau `http://<host>:8787/setup?token=…` bila `caddy` tak dipasang).

Token itu **tidak pernah** disimpan ke DB, tidak masuk log, dan tidak dipulangkan endpoint lain.
Ia berumur 15 menit (`services/bootstrap.ts`); UI menampilkan hitung mundur dan tombol salin, dan
menyediakan **Ambil ulang** yang menjalankan pembacaan yang sama saat token sudah kedaluwarsa.

## Bentuk data

```prisma
model Vps {
  // …
  components         Json?     // SPEC-883 · { [ComponentId]: { status, detail, version? } } — hasil probe
  componentsCheckedAt DateTime? // SPEC-883 · kapan probe terakhir dijalankan
  provisionProfile   String?   // SPEC-883 · "lab" | "production" — profil yang terakhir diterapkan
}
```

Migration **additif** (hub produksi hidup — kolom baru saja, nol backfill, nol perubahan tipe).

Ketiga kolom **tidak** masuk `FIELDS.vps` sync — local-only, sekelas `keyPath`. Alasannya terukur di
SPEC-880: `snapshot()` mengirim kolom baru di **setiap** push, sehingga hub yang lebih tua menolak
seluruh push entitas itu. Status komponen juga milik mesin yang punya key SSH-nya; client lain tak
punya cara memverifikasinya.

## API

```
GET  /vps/components                       -> { components: Component[] }   # katalog untuk render toggle
POST /vps/:id/probe                        -> { components, checkedAt }      # simpan ke DB, 502 bila ssh gagal
POST /vps/:id/provision/preview  { items[], profile, domain? }
                                           -> { steps: STEP[] }             # DRY_RUN, nol tulis
POST /vps/:id/provision  { items[], profile, domain?, confirm?, force? }
                                           -> 409 confirm-required { steps }
                                           -> 409 profile-mismatch { current }
                                           -> 200 { steps, components, checkedAt, setup? }
```

Validasi di route sebelum menyentuh SSH:

- `items` bukan array / memuat id di luar katalog → 400
- komponen di luar `profiles` profil terpilih → 400
- `caddy` tercentang tanpa `domain` → 400
- `domain` bukan hostname sah → 400
- key VPS tak ada di mesin ini → `409 { keyMissing: true }` (pola `keyMissing` yang sudah ada)

## UI (`VpsScreen`)

- **Lencana komponen** per kartu VPS: `hanoman ✓ 1.4.2 · claude ⚠ belum login · caddy –`, diikuti
  "diperiksa <relatif>" dan tombol **Periksa** (probe). Nol data ≠ nol komponen: sebelum probe
  pertama lencana berbunyi "belum diperiksa", bukan deretan strip.
- **Panel Pasang komponen**: profil (dua radio) + daftar toggle dari katalog, dikelompokkan per
  `section`. Mencentang komponen otomatis mencentang `requires`-nya dan menguncinya (dengan alasan
  terlihat). Field `domain` muncul hanya saat `caddy` menyala.
- **Pratinjau** → daftar `STEP would` → **Pasang** (`useConfirm`) → transcript di modal, pola
  harden yang sudah ada.
- **Kartu serah-terima** sesudah sukses: tautan `https://<domain>/setup?token=…`, hitung mundur,
  tombol salin, tombol **Ambil ulang**.
- **Login lewat Console** untuk tiap komponen berstatus `partial not-logged-in`.

State panel (profil, toggle, domain) memakai `usePersistedState` berskop `vps@<id>` (ADR-0115).

## Test

| berkas | isi |
|---|---|
| `server/test/vps-provision-parse.test.ts` | `parseComponents` untuk `COMP` sah/rusak/baris asing; `parseSteps` dipakai ulang tanpa perubahan |
| `server/test/vps-catalog-components.test.ts` | `resolveComponents` menutup dependensi & terurut topologis; beda `requires` per profil; komponen di luar profil ditolak; nol siklus |
| `server/test/vps-provision.route.test.ts` | fixture `HANOMAN_SSH_BIN` (pola `vps-remediate.test.ts`): preview `would`; `confirm` wajib; `profile-mismatch` + `force`; `keyMissing`; probe menulis `components`+`componentsCheckedAt`; validasi `domain` |
| `server/test/vps-provision-setup.test.ts` | `setup` hanya muncul saat `hanoman ok` + token ada; token tak pernah masuk DB maupun respons lain; kedaluwarsa → `setup: null` |
| `server/test/vps-provision-contract.test.ts` | ketiga kolom ada di dmmf, **tidak** ada di `__FIELDS.vps` |
| `server/test/vps-provision-script.test.ts` | jalankan `provision.sh` sungguhan di mesin test dengan `MODE=probe` dan `MODE=apply DRY_RUN=1 PATH` fixture: keluarannya sah, nol tulis, `skip blocked-by` saat prasyarat gagal, `dns-mismatch` saat resolver fixture tak cocok |
| `cli/test/provision.test.ts` | argv → env skrip; `--probe`; `--dry-run`; tanpa `--yes` meminta konfirmasi |
| `cli/test/pack.test.ts` | `copyPlan` memuat `scripts/vps`; `verify-packed` gagal bila salah satu dari empat skrip hilang |
| `src/test/vps-provision.test.tsx` | toggle menutup dependensi & menguncinya; `domain` muncul/wajib bersama `caddy`; lencana "belum diperiksa"; kartu serah-terima + hitung mundur; tombol Login lewat Console hanya untuk `partial` |

## Docs yang tersentuh (commit yang sama)

- `internal/docs/adr/0137-provisioning-vps-berbasis-katalog.md` (baru) + link di
  `internal/docs/adr/README.md` dan `internal/docs/README.md`
- `internal/docs/operations/deploy-vps.md` — jalur provision sebagai ringkasan di depan prosedur
  manual (prosedur manual **tetap**, ia acuan kebenaran skrip), dua profil, dan batas jujur profil lab
- `internal/docs/architecture/api-contract.md` — empat endpoint di seksi VPS
- `internal/docs/architecture/data-model.md` — tiga kolom baru + catatan local-only
- `internal/docs/operations/npm-readme.md` — subperintah `hanoman provision`

## Gotcha yang wajib dijaga

1. **`scriptPath()` harus mencari lokasi terpaket lebih dulu.** Memperbaiki `copyPlan` saja tak
   cukup; tanpa perubahan resolusi, instalasi npm tetap menunjuk `repoRoot()` yang tak ada.
2. **Probe tak boleh memakai `sudo -n` bila tak perlu.** `audit.sh` sudah membuktikan bahwa `sudo`
   yang meminta password menghasilkan keluaran tanpa satu pun baris protokol; probe yang gagal
   seperti itu harus terbaca "gagal", bukan "semua absent".
3. **`agent-image` tak boleh dibangun ulang tanpa perlu.** Build image adalah langkah termahal;
   probe melaporkan `ok <image-id>` dan apply `skip already-present` bila id-nya sama.
4. **`STEP` untuk komponen terblokir wajib terbit.** Diam pada komponen yang dilewati membuat UI
   menampilkan daftar langkah yang lebih pendek dari yang dicentang — terbaca seperti komponen itu
   berhasil.
5. **Timeout apply jauh lebih panjang dari remediate.** `npm i -g` + build image bisa melewati
   300 detik; pakai 900 detik, dan pastikan `sshExec` yang SIGKILL tetap memulangkan transcript
   parsial supaya kegagalan bisa dibaca.

## Yang TIDAK dikerjakan (YAGNI / di luar scope)

- **Tidak** ada pembuatan record DNS. hanoman memeriksa A record, tak pernah membuatnya.
- **Tidak** ada penyalinan kredensial agen antar mesin, dan tidak ada field API key di form.
- **Tidak** ada provision terjadwal, otomatis, atau lewat lead/scheduler. Hanya tombol dan CLI.
- **Tidak** ada uninstall/rollback komponen. Menghapus adalah pekerjaan Console.
- **Tidak** ada perubahan pada `audit.sh`/`harden.sh`/`remediate.sh` selain jalur pencariannya.
- **Tidak** ada sync untuk `components` — lihat Bentuk data.
- **Tidak** ada dukungan OS di luar apt/dnf yang sudah dikenali modul VPS hari ini.
- **Tidak** ada perubahan pada `assertRuntimeBoundary`. Profil production menyesuaikan diri pada
  gerbang yang ada; ia tak melonggarkan satu pun.
