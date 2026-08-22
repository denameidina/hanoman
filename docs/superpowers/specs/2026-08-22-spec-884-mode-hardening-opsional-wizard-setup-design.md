# SPEC-884 · Hardening jadi opt-in, dan wizard setup awal di browser

**Tanggal:** 2026-08-22
**Status:** design, disetujui operator
**Menyentuh:** `server/src/services/session-sandbox.ts`, `server/src/services/runtime-profile.ts` (baru),
`server/src/server.ts`, `server/src/app.ts`, `server/src/routes/setup.ts` (baru), `server/src/routes/auth.ts`,
`server/src/services/auth.ts`, `server/src/services/upload-pipeline.ts`, `cli/src/commands/start.ts`,
`cli/src/commands/doctor.ts`, `runner/src/config-env.ts` (baru), `shared/src/dto.ts`,
`src/src/screens/SetupWizard.tsx` (baru), `src/src/screens/AuthScreen.tsx`, `src/src/App.tsx`.
ADR baru: **ADR-0138** (mengamandemen ADR-0117 dan ADR-0087).

> Nomor spec ini menunggu id backlog yang diterbitkan server. Bila server memberi nomor lain,
> selaraskan nama berkas, judul, dan seluruh rujukan dalam satu commit (preseden SPEC-882/883).

## Masalah

`npm i -g hanoman && hanoman` di sebuah laptop **tidak bisa boot sama sekali** hari ini. Bukan
"sandbox merepotkan" — server menolak lahir.

Dijalankan dengan env yang persis dihasilkan instalasi npm polos (tujuh variabel dari `serverEnv()`,
`cli/src/commands/start.ts:175-184`), `assertRuntimeBoundary` (`server/src/services/session-sandbox.ts:3`,
dipanggil `server/src/server.ts:35` **sebelum** `app.listen`) menjawab:

```
user biasa (uid 1000): BOOT GAGAL → HANOMAN_SESSION_SANDBOX=podman wajib di production
root (uid 0):          BOOT GAGAL → production Hanoman harus berjalan sebagai user non-root
```

Empat fakta yang membentuk rancangan ini:

1. **Instalasi npm tak pernah menyetel env hardening.** Yang lahir dari `npm i -g hanoman` → `hanoman`
   hanya `NODE_ENV`, `DATABASE_URL`, `PORT`, `HOST`, `HANOMAN_HOME`, `HANOMAN_SUPERVISOR`,
   `HANOMAN_WEB_DIR`. `HANOMAN_SESSION_SANDBOX`, `HANOMAN_PUBLIC_ORIGINS`, `HANOMAN_CONTROL_ORIGINS`,
   dan `HANOMAN_TRUST_PROXY` **hanya** ada bila operator mengetiknya sendiri — di VPS lewat
   `EnvironmentFile=/etc/hanoman.env` (`internal/docs/operations/deploy-vps.md:131-132`). Itu prosedur
   devops, bukan bagian instalasi. Gerbang ADR-0117 karena itu menyasar tepat orang yang tak punya cara
   memuaskannya.

2. **`NODE_ENV` merangkap tiga pekerjaan yang tak berhubungan.** "Runtime terpaket" (sajikan dashboard
   dari dist — `server/src/web-dir.ts:9`), "cookie `Secure`" (`server/src/services/auth.ts:84`), dan
   "hardening ADR-0117" (`session-sandbox.ts:4`, `app.ts:191`, `upload-pipeline.ts:67`,
   `lead/brain.ts:97`, `portal-chat/argv.ts:71`, `doctor.ts:121`). Mencabut satu berarti kehilangan
   ketiganya.

3. **Karena itu profil `lab` SPEC-883 tak akan pernah lahir.** SPEC-883 K2 mendefinisikan profil lab
   sebagai "`NODE_ENV` **tidak** diset production", tetapi `serverEnv()` menuliskannya hardcoded
   (`start.ts:177`) dan `runServer` men-spawn dengan `env: { ...process.env, ...env }` (`start.ts:201`)
   — objek hardcoded itu ditumpuk **belakangan**, jadi ia mengalahkan `EnvironmentFile` systemd.
   Konsekuensi jujur yang ditulis SPEC-883 ("cookie lahir tanpa `Secure`") adalah gejala dari fakta 2,
   bukan harga yang memang harus dibayar.

4. **Setup token menutup pintu terakhir, dan UI-nya bahkan lebih ketat dari server.** `app.ts:191`
   mewajibkan bukti `~/.hanoman/setup.token` saat production. Terlepas dari itu,
   `src/src/screens/AuthScreen.tsx:16` mewajibkan token **tanpa pernah membaca** `setupTokenRequired`
   dari `/auth/status` (field itu ada di `shared/src/dto.ts:497` dan diisi `routes/auth.ts:24`) —
   jadi walau server tak memintanya, tombolnya tetap terkunci. Ini bug berdiri sendiri.

Yang diminta operator: **hardening jadi opt-in penuh — default mati, termasuk untuk instance publik**
— dan setup awal dipandu **wizard di browser**, bukan dengan mengedit env atau membaca berkas token
lewat shell.

### Yang diterima secara sadar

hanoman menjalankan sesi `claude`/`codex` dengan `--dangerously-skip-permissions` di worktree pada
mesin itu. Instance publik tanpa hardening berarti satu-satunya penghalang antara internet dan
eksekusi perintah penuh di mesin itu adalah **password akun hanoman**; worktree mengisolasi Git,
bukan filesystem, credential, proses, atau jaringan host (invariant 3 ADR-0117). Operator memutuskan
untuk menerima ini. Tugas rancangan ini bukan menghalanginya, melainkan membuatnya **terlihat** —
lihat K8 — dan memastikan hardening tetap satu klik, bukan satu prosedur.

## Keputusan

### K1 — Dua nilai eksplisit menggantikan `NODE_ENV` sebagai penentu hardening

`NODE_ENV` berhenti berarti "keras". Ia tetap berarti "runtime terpaket". Yang menentukan jadi dua
nilai yang saling bebas:

| Nilai | Isi | Default | Menentukan |
|---|---|---|---|
| `HANOMAN_DEPLOYMENT` | `local` \| `public` | `local` | default wizard, peringatan, penanda permanen |
| `HANOMAN_HARDENING` | `1` \| kosong | **kosong** | satu-satunya yang menyalakan gerbang ADR-0117 |

`HANOMAN_DEPLOYMENT` **tidak memaksa apa pun**. Ia hanya mengubah default dan kalimat yang
ditampilkan. Memilih `public` tidak membuat boot gagal, tidak mewajibkan podman, dan tidak
mewajibkan setup token.

`assertRuntimeBoundary` mendapat tepat satu baris di depan:

```ts
export function assertRuntimeBoundary(
  env: Env, runtime: { uid: number | undefined; host: string },
): void {
  if (!resolveHardening(env)) return;          // ← BARU
  if (runtime.uid === 0) throw new Error(…);   // ← isi lama, tak disentuh
  …
}
```

Badannya tidak diubah satu karakter pun. Begitu hardening menyala, perilakunya **byte-identik**
dengan hari ini, dan seluruh assertion `server/test/session-sandbox.test.ts` yang ada tetap lulus apa
adanya di bawah `HANOMAN_HARDENING=1`. Syarat `NODE_ENV !== "production"` di baris 4 dihapus:
hardening tak lagi diturunkan dari `NODE_ENV`.

### K2 — Presedensi: env menang atas berkas, dan berkas hanya boleh menaikkan

Resolver murni di `server/src/services/runtime-profile.ts`:

```ts
export type Deployment = "local" | "public";
export function resolveDeployment(env: Env): Deployment;
export function resolveHardening(env: Env): boolean;
```

`resolveHardening(env)` benar bila **salah satu**:

- `env.HANOMAN_HARDENING === "1"`;
- `env.HANOMAN_SESSION_SANDBOX === "podman"`;
- `env.HANOMAN_PUBLIC_ORIGINS` terisi;
- `env.HANOMAN_TRUST_PROXY` terisi.

Tiga syarat terakhir adalah **kompatibilitas mundur, dan ia yang menjaga hub produksi**: instance yang
env-nya sudah memuat penanda ADR-0117 diperlakukan sebagai "hardening dinyalakan secara sadar" dan
tetap keras setelah upgrade. Tanpa klausa ini `hanoman.nafanesia.id` kehilangan seluruh hardening-nya
diam-diam pada `npm i -g hanoman@latest` berikutnya.

`resolveDeployment(env)` = `public` bila `HANOMAN_DEPLOYMENT === "public"` **atau** `resolveHardening`
benar; selain itu `local`.

Kedua resolver membaca **satu** objek env. Yang mengatur siapa mengisi env itu adalah K3, dan di sana
env proses selalu menang atas berkas — sehingga dashboard secara struktural tak bisa **mematikan**
hardening yang dipasang operator lewat systemd.

**Bukan lewat `effectiveStr`/`RuntimeConfig`.** Resolver config yang ada presedensinya
`DB → env → default` (`server/src/config.ts:31`), artinya siapa pun yang bisa menulis config bisa
menimpa env. Itu persis jebakan yang sudah dihindari ADR-0088 untuk `HANOMAN_SUPERVISOR` ("dibaca dari
`process.env` langsung, bukan `effectiveBool()`"). Nilai yang menentukan boundary keamanan tidak boleh
lewat jalur itu.

### K3 — Jawaban wizard tinggal di `$HANOMAN_HOME/config.env`

Berkas `KEY=value` per baris, mode `0600` di dalam home `0700`, ditulis server, dibaca CLI.

`runner/src/config-env.ts` (baru, murni + satu pembaca IO tipis):

```ts
export function parseConfigEnv(text: string): Record<string, string>;
export function readConfigEnv(home: string): Record<string, string>;   // ENOENT → {}
export function formatConfigEnv(values: Record<string, string>): string;
```

`start.ts` menggabungkannya dengan presedensi eksplisit:

```ts
const child = spawn(process.execPath, [serverJs], {
  stdio: "inherit",
  env: { ...readConfigEnv(home), ...process.env, ...env },   // berkas < systemd/shell < serverEnv
});
```

Berkas ada di posisi **paling lemah**. `EnvironmentFile` systemd dan `export` di shell mengalahkannya;
`serverEnv()` (yang menyuntik `HANOMAN_SUPERVISOR` dan `NODE_ENV`) tetap paling kuat.

**Server membaca `config.env` sendiri, bukan hanya mewarisinya.** Setelah CLI menggabungkan berkas ke
`process.env`, server tak lagi bisa membedakan nilai yang datang dari systemd dan yang datang dari
berkas — padahal `hardeningLocked` justru bergantung pada perbedaan itu. Karena itu route setup
menghitungnya dengan dua bacaan:

```ts
const fromFile = readConfigEnv(resolveHome());
const hardeningLocked = resolveHardening(process.env) && !resolveHardening(fromFile);
```

Terkunci = hardening menyala karena sesuatu **di luar** berkas (systemd, shell) → UI tak menawarkan
tombol mematikannya, dan `POST /api/setup` menjawab `409 hardening-locked`. Konsekuensi lanjutan yang
harus dijaga: `setupTokenRequired` dievaluasi pada env **boot yang sedang berjalan**, jadi hardening
yang baru saja ditulis wizard ke berkas belum berlaku saat akun pertama dibuat — itu memang yang
diinginkan (orang yang sedang duduk di depan wizard-lah yang membuat akunnya), tetapi jangan
"memperbaikinya" dengan membaca berkas di jalur `/auth/setup`.

Kunci yang boleh ditulis wizard dibatasi allowlist: `HANOMAN_DEPLOYMENT`, `HANOMAN_HARDENING`,
`HANOMAN_SESSION_SANDBOX`, `HANOMAN_SESSION_NETWORK`, `HANOMAN_EGRESS_PROXY`,
`HANOMAN_AGENT_CREDENTIAL_DIR`, `HANOMAN_CONTROL_ORIGINS`, `HANOMAN_PUBLIC_ORIGINS`,
`HANOMAN_SINGLE_ORIGIN`, `HANOMAN_TRUST_PROXY`, `HANOMAN_UPLOAD_SCANNER`. Kunci di luar daftar
ditolak `400` — berkas ini bukan pintu belakang untuk menyuntik env sembarang ke proses sesi.

### K4 — Sentinel restart terpisah, bukan `UPDATE_RESTART_EXIT`

`CONFIG_RESTART_EXIT = 76` di `shared/src/dto.ts`, bersebelahan dengan `UPDATE_RESTART_EXIT = 75`
(`shared/src/dto.ts:607`). `planSupervisorStep` (`start.ts:160`) mendapat cabang ketiga:

```ts
export type SupervisorStep =
  | { action: "exit"; code: number } | { action: "update" } | { action: "restart" };
```

`restart` men-spawn ulang server **tanpa** menyentuh npm maupun `prisma generate`. Memakai ulang kode
75 akan menjalankan `npm i -g hanoman@latest` setiap kali seseorang menyelesaikan wizard — akibat yang
sama sekali tak diminta. Jatah `MAX_UPDATE_RESTARTS` tidak berlaku untuk `restart`; yang berlaku
adalah jatah terpisah `MAX_CONFIG_RESTARTS = 5` dengan alasan dicetak saat habis (jangan pernah
membatasi diam-diam — pola ADR-0088).

Bila `HANOMAN_SUPERVISOR !== "1"` (server dijalankan langsung, bukan lewat `hanoman start`), wizard
tetap menyimpan `config.env` tetapi respons-nya berkata **restart manual diperlukan** dan server tidak
keluar. Keluar tanpa ada yang menghidupkan lagi = instance mati karena menekan tombol setup.

### K5 — Wizard tiga langkah, muncul hanya saat belum ada user

Pemicunya `prisma.user.count() === 0` — penanda yang sama yang sudah dipakai `needsSetup`
(`routes/auth.ts:21`). Mac mini dan VPS yang sudah punya akun **tak akan pernah** melihat wizard.
Bisa dibuka ulang dari Settings → **Setup awal**; jalur itu hanya mengubah toggle dan tak pernah
menyentuh akun.

1. **Peruntukan.** Dua kartu: *Device saya sendiri* (default) / *Diakses orang lain*. Menulis
   `HANOMAN_DEPLOYMENT`.
2. **Keamanan.** Satu toggle `Aktifkan hardening`, default mengikuti langkah 1 — lokal: mati; publik:
   menyala tetapi **boleh ditolak**. Di bawahnya hasil probe prasyarat (K6). Publik + hardening
   ditolak → satu checkbox pengakuan berbunyi eksplisit bahwa instance ini menjalankan perintah penuh
   di mesin ini, dan penanda permanen K8 menyala.
3. **Akun pertama.** Email + password. Setup token **hanya** diminta bila `resolveHardening(process.env)`
   benar pada boot yang sedang berjalan — yaitu ketika hardening sudah menyala sebelum wizard dibuka
   (lihat K3 soal kenapa nilai yang baru ditulis wizard sengaja belum berlaku di sini).

Selesai → tulis `config.env` → bila ada kunci yang berubah, `process.exit(CONFIG_RESTART_EXIT)`.

**Kejujuran yang wajib masuk docs:** wizard sendiri tidak terlindungi apa pun — ia harus bisa
dijangkau justru karena belum ada akun. Instance baru yang sudah terjangkau internet sebelum wizard
selesai **bisa diklaim orang pertama yang membukanya**. Urutan amannya: selesaikan wizard di
`localhost` dulu, baru sambungkan domain/tunnel. Ini bukan regresi — hari ini pintu itu ditutup setup
token; menjadikan token opsional membukanya, dan itu konsekuensi yang diterima sadar (lihat "Yang
diterima secara sadar").

### K6 — Toggle hardening tak bisa menyala selama prasyarat merah

`GET /api/setup/status` menjalankan probe yang sama dengan `hanoman doctor` (`doctor.ts:120-131`),
dipindahkan ke `server/src/services/setup-probe.ts` supaya CLI dan route memakai satu sumber:

| Prasyarat | Probe |
|---|---|
| podman rootless | `podman info --format {{.Host.Security.Rootless}}` = `true` |
| network egress | `podman network exists <network>` |
| egress proxy | `HANOMAN_EGRESS_PROXY` terisi |
| credential dir | terisi **dan** terbaca (`accessSync R_OK`) |
| control origin | terisi |
| trusted proxy | terisi dan berbentuk hop/CIDR (`trustProxyFromEnv` tak melempar) |
| scanner upload | `HANOMAN_UPLOAD_SCANNER` terisi dan absolut |

`POST /api/setup` menolak `hardening: true` dengan `400 prerequisites-missing` + daftar yang merah.
Alasannya bukan estetika: menulis `HANOMAN_HARDENING=1` tanpa prasyarat lengkap melahirkan instance
yang **menolak boot** pada restart berikutnya — persis kegagalan yang spec ini ada untuk mencabut, cuma
dipindah dari instalasi ke tombol.

### K7 — Cookie `Secure` dari skema request, bukan dari `NODE_ENV`

`cookieOpts()` (`services/auth.ts:80`) menerima request:

```ts
export function cookieOpts(req: FastifyRequest) {
  const https = req.protocol === "https"
    || (req.headers["x-forwarded-proto"] ?? "").toString().split(",")[0]?.trim() === "https";
  return { httpOnly: true, sameSite: "strict" as const,
           secure: https || resolveHardening(process.env), path: "/", … };
}
```

Tiga akibat: login lewat `http://192.168.x.x` (dashboard dibuka dari HP di LAN) berhenti gagal senyap;
deployment di balik proxy TLS tetap mendapat `Secure` seperti sekarang; dan konsekuensi jujur "profil
lab lahir tanpa `Secure`" yang ditulis SPEC-883 K2 hilang dengan sendirinya.

**`x-forwarded-proto` dibaca LANGSUNG dari header, sengaja tidak lewat `req.protocol`.** Fastify hanya
memercayai header itu bila `trustProxy` terisi, dan `trustProxyFromEnv` mengembalikan `false` tanpa
`HANOMAN_TRUST_PROXY` (`services/ingress-policy.ts:55-57`, dipakai `app.ts:88`). Instance yang berada
di balik TLS **tanpa** menyetel variabel itu — persis bentuk hanoman lokal di balik Cloudflare Tunnel —
karena itu akan kehilangan flag `Secure` yang hari ini didapatnya dari `NODE_ENV`. Itu regresi, dan
tidak boleh terjadi.

Memercayai header ini untuk keputusan cookie aman karena **arahnya satu**: menyuntik
`x-forwarded-proto: https` hanya bisa membuat cookie **lebih ketat**. Melonggarkannya menuntut
**menghapus** header, dan header yang absen memang berarti request polos — keadaan yang sudah
seharusnya menghasilkan cookie tanpa `Secure`. Tak ada serangan yang dibuka; yang ada hanyalah
kemungkinan cookie jadi `Secure` di koneksi yang sebenarnya http, yang efeknya cookie tak terkirim —
gagal tertutup, bukan gagal terbuka.

### K8 — Penanda permanen saat publik tanpa hardening

`GET /api/setup/status` mengembalikan `{ deployment, hardening, prerequisites }` dan boleh dipanggil
sesi ber-cookie kapan saja. Saat `deployment === "public" && !hardening`, `App.tsx` menampilkan baris
tipis persisten di header: **"Instance ini terbuka tanpa hardening"** + tautan ke Settings → Setup
awal. Ia tak bisa ditutup permanen — hanya hilang saat hardening menyala.

Ini konsekuensi langsung dari keputusan operator di "Yang diterima secara sadar": kalau perlindungan
turun menjadi satu password, keadaan itu tidak boleh tak terlihat.

### K9 — Gerbang yang ikut longgar, dan yang tidak pernah longgar

Semua yang di bawah ini berganti pemicu dari `NODE_ENV === "production"` menjadi `resolveHardening(env)`:

| Gerbang | Lokasi | Saat hardening mati |
|---|---|---|
| boundary boot (non-root, sandbox, origin, proxy, bind) | `session-sandbox.ts:3` | dilewati — **root diizinkan**; `pty.ts:111` sudah menyuntik `IS_SANDBOX=1` saat uid 0 |
| sandbox sesi agen | `session-sandbox.ts:57` | `mode = "off"` → sesi jalan di host |
| lead one-shot | `lead/brain.ts:97` | jalan tanpa sandbox |
| chat portal | `portal-chat/argv.ts:71` | jalan tanpa sandbox |
| scanner upload | `upload-pipeline.ts:67` | **peringatan** di log, bukan `UploadError` |
| setup token akun pertama | `app.ts:191` | tak diminta |
| `doctor` | `doctor.ts:121` | `sandboxRequired = false` → baris `!`, bukan `✗` fatal |

Yang **tidak** bergantung profil dan tetap berlaku apa pun pilihannya: auth wajib di seluruh `/api`,
isolasi worktree per sesi (ADR-0002), limiter login & bootstrap, tiket WebSocket exact-origin,
canonical no-follow path untuk operasi repo, dan pinned-address no-redirect untuk webhook/sync.
Invariant 4 dan 6 ADR-0117 tak pernah bergantung pada podman, jadi tak ikut turun.

### K10 — `AuthScreen` menghormati `setupTokenRequired`

`src/src/screens/AuthScreen.tsx:16` dan `:58` membaca `setupTokenRequired` dari `/auth/status`
(sudah tersedia di `AuthStatus`, `shared/src/dto.ts:497`) alih-alih mengasumsikan `needsSetup` berarti
token wajib. Bug berdiri sendiri: hari ini form itu mengunci tombol bahkan saat server tak meminta
token, sehingga instalasi dev pun tak bisa membuat akun pertama dari UI.

## Bentuk data

```ts
// shared/src/dto.ts
export const CONFIG_RESTART_EXIT = 76;

export type SetupPrerequisite = {
  id: "podman" | "network" | "egress-proxy" | "credential-dir"
    | "control-origin" | "trust-proxy" | "upload-scanner";
  ok: boolean; detail: string | null;
};
export type SetupStatus = {
  needed: boolean;                       // user.count() === 0
  deployment: "local" | "public";
  hardening: boolean;
  hardeningLocked: boolean;              // env yang menyalakannya → tak bisa dimatikan dari UI
  supervised: boolean;                   // HANOMAN_SUPERVISOR === "1" → bisa restart sendiri
  setupTokenRequired: boolean;
  prerequisites: SetupPrerequisite[];
};
export const zSetupApply = z.object({
  deployment: z.enum(["local", "public"]),
  hardening: z.boolean(),
  acknowledgedUnhardened: z.boolean().optional(),
});
```

`zSetup` (`shared/src/dto.ts:493`) tetap ada — ia dipakai saat `setupTokenRequired` benar.

## API

| Route | Auth | Isi |
|---|---|---|
| `GET /api/setup/status` | publik saat `needed`, cookie sesudahnya | `SetupStatus` |
| `POST /api/setup` | publik saat `needed`, cookie sesudahnya | `zSetupApply` → tulis `config.env`; `400 prerequisites-missing` bila `hardening` tanpa prasyarat lengkap; `409 hardening-locked` bila env mengunci; `{ restart: "self" \| "manual" }` |

`POST /api/setup` memakai limiter yang sama dengan `/auth/setup` (`BoundedRateLimiter`,
`routes/auth.ts:19`) — permukaan tak ber-auth kedua tak boleh lahir tanpa limiter.

## UI

- `src/src/screens/SetupWizard.tsx` — tiga langkah K5, dirender `App.tsx:1256` **sebelum** `AuthScreen`
  saat `setup.needed`. Mengikuti design system editorial (`Card`, `Field`, `Button`); tanpa komponen baru.
- `src/src/screens/AuthScreen.tsx` — K10.
- `src/src/App.tsx` — penanda permanen K8.
- `SettingsScreen` — kartu **Setup awal**: menampilkan `deployment`/`hardening`/prasyarat, dan tombol
  yang membuka ulang wizard di langkah 1–2 (tanpa langkah akun).

## Test

Semua test baru berdampingan dengan yang lama; **tak satu pun assertion `session-sandbox.test.ts` yang
ada dihapus atau dilonggarkan** — semuanya dipindah ke bawah `HANOMAN_HARDENING: "1"` supaya jalur
produksi ter-pin sebagai regresi.

- `server/test/runtime-profile.test.ts` (baru) — table-driven: env kosong → `local`/mati; `HANOMAN_HARDENING=1` → menyala; `HANOMAN_SESSION_SANDBOX=podman` saja (VPS lama) → menyala **dan** `public`; `HANOMAN_PUBLIC_ORIGINS` saja → menyala; `HANOMAN_DEPLOYMENT=public` saja → `public` tapi **mati**.
- `server/test/session-sandbox.test.ts` — tambah: hardening mati → root, tanpa sandbox, tanpa origin, bind `0.0.0.0` semuanya **tidak** melempar.
- `runner/test/config-env.test.ts` (baru) — parse/format round-trip, komentar & baris kosong, nilai bertanda `=`, ENOENT → `{}`.
- `cli/test/start.test.ts` — presedensi spawn: kunci yang ada di `config.env` **dan** `process.env` → nilai `process.env` yang menang; `planSupervisorStep(76, n)` → `{action:"restart"}`; jatah `MAX_CONFIG_RESTARTS`.
- `server/test/setup-route.test.ts` (baru) — `hardening: true` tanpa prasyarat → `400`; `hardeningLocked` → `409`; `supervised: false` → `restart: "manual"` dan proses tidak keluar; allowlist kunci; limiter.
- `server/test/auth-setup.test.ts` — `setupTokenRequired` mengikuti `resolveHardening`, bukan `NODE_ENV`.
- `server/test/auth-cookie.test.ts` (baru) — `Secure` mati di `http` polos, menyala lewat `x-forwarded-proto: https` **walau `HANOMAN_TRUST_PROXY` kosong** (kasus Cloudflare Tunnel), dan dipaksa menyala saat hardening.
- `src/test/setup-wizard.test.tsx` (baru) — toggle terkunci saat prasyarat merah; checkbox pengakuan wajib saat publik+ditolak; wizard tak muncul saat `needed: false`.
- `src/test/auth-screen.test.tsx` — tombol aktif tanpa token saat `setupTokenRequired: false`.

Perintah verifikasi (SPEC-376, ADR-0080):
`TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`

## Docs yang tersentuh (commit yang sama)

- `internal/docs/adr/0138-hardening-opsional-dan-wizard-setup.md` (baru) — mengamandemen ADR-0117
  (invariant-nya tetap utuh, tetapi **berlaku saat hardening menyala**; hardening jadi opt-in dengan
  kompatibilitas mundur env) dan ADR-0087 (instalasi npm polos wajib bisa boot).
- `internal/docs/operations/deploy-vps.md` — dua jalur: default longgar vs `HANOMAN_HARDENING=1`.
- `internal/docs/operations/production.md`, `internal/docs/operations/npm-readme.md`.
- `internal/docs/product/onboarding.md` — langkah 1 diganti wizard.
- `internal/docs/security/threat-model.md` — model ancaman instance tanpa hardening + klaimabilitas wizard.
- `internal/docs/architecture/stack.md`, `internal/docs/architecture/api-contract.md`.
- `internal/docs/README.md` — tautkan ADR-0138.
- `docs/superpowers/plans/2026-08-22-spec-883-provisioning-vps-satu-perintah.md` — profil `lab` jadi
  `HANOMAN_DEPLOYMENT=public` + hardening mati; `production` jadi hardening menyala. Catatan
  "cookie tanpa `Secure`" dicabut (K7).

## Gotcha yang wajib dijaga

1. **`serverEnv()` ditumpuk paling belakang** (`start.ts:201`). Menaruh `config.env` di sebelah kanan
   akan membuat berkas mengalahkan systemd — kebalikan dari yang dirancang. Urutannya diuji, bukan
   diandalkan dari pembacaan.
2. **Jangan pakai `effectiveStr` untuk profil.** Presedensinya DB-menang-atas-env (`config.ts:31`) →
   siapa pun yang bisa menulis config bisa mematikan hardening. Pelajaran ADR-0088.
3. **`resolveHardening` dibaca dari `process.env`, bukan dari objek env hasil merge di server.**
   Server anak sudah menerima hasil merge sebagai `process.env`-nya sendiri; membaca sumber lain akan
   menjawab beda antara boot dan runtime.
4. **Kode keluar 76 tak boleh dipakai saat tak disupervisi.** `HANOMAN_SUPERVISOR !== "1"` → simpan,
   jangan keluar. Keluar tanpa supervisor = instance mati karena menekan tombol setup.
5. **`SETUP_TOKEN_FILE` tetap ada dan tetap dipakai** saat hardening menyala — `ensureSetupToken`
   (`services/bootstrap.ts:29`) tidak dihapus. Yang berubah hanya siapa yang memintanya.
6. **Smoke tanpa `HANOMAN_HOME` menulis `setup.token` ke home nyata** (pelajaran SPEC-880) — test
   route setup wajib menyetel `HANOMAN_HOME` ke tmpdir.
7. **Instance yang sudah punya user tak pernah melihat wizard.** Gerbangnya `user.count() === 0`, sama
   dengan `needsSetup`; jangan menambah gerbang kedua yang bisa melenceng darinya.
8. **Jangan memakai `req.protocol` sendirian untuk `Secure`.** Ia bergantung `trustProxy`, yang kosong
   di instance di balik TLS tanpa `HANOMAN_TRUST_PROXY` (Cloudflare Tunnel) — hasilnya `Secure` yang
   hari ini ada akan hilang. Baca headernya langsung; lihat K7 untuk kenapa itu aman.

## Yang TIDAK dikerjakan (YAGNI / di luar scope)

- **Wizard CLI.** Operator memilih wizard browser; `hanoman doctor` tetap jalur terminalnya.
- **Memasang podman/proxy dari wizard.** Wizard memeriksa dan menjelaskan; ia tak pernah memasang
  perangkat lunak (ADR-0048/0088 — server tak memasang apa pun).
- **Menghapus setup token.** Ia tetap jadi pintu saat hardening menyala.
- **Login tanpa akun.** Operator sudah memutuskan akun tetap wajib; hanya tokennya yang opsional.
- **Mengubah `NODE_ENV` yang disuntik `serverEnv()`.** Ia tetap `production` — artinya "terpaket",
  dan sesudah spec ini itu satu-satunya artinya.
- **Profil ketiga.** Dua nilai × dua keadaan sudah menutup semua kasus yang diminta.
