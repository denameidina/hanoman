# ADR-0139 — Hardening jadi opt-in, dan setup awal dipandu wizard di browser

- Status: Accepted
- Tanggal: 2026-08-22
- SPEC: SPEC-884
- Terkait: **mengamandemen** [0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md)
  (seluruh invariant-nya tetap utuh, tetapi **berlaku saat hardening menyala**) dan
  [0087](0087-distribusi-npm-global.md) (instalasi npm polos wajib bisa boot).
  Mengikuti pelajaran [0088](0088-tombol-update-npm-supervisor.md) tentang nilai keamanan yang tak
  boleh lewat config DB. Menyediakan mekanisme yang dipakai profil `lab`/`production`
  [0137](0137-provisioning-vps-katalog-komponen.md) (SPEC-883).

## Konteks

`npm i -g hanoman && hanoman` **tidak bisa boot sama sekali**. Bukan "sandbox merepotkan" — server
menolak lahir.

Dijalankan dengan env yang persis dihasilkan instalasi npm polos (tujuh variabel dari `serverEnv()`,
`cli/src/commands/start.ts:175-184`), `assertRuntimeBoundary` menjawab:

```
user biasa (uid 1000): BOOT GAGAL → HANOMAN_SESSION_SANDBOX=podman wajib di production
root (uid 0):          BOOT GAGAL → production Hanoman harus berjalan sebagai user non-root
```

Empat fakta yang membentuk keputusan ini:

1. **Instalasi npm tak pernah menyetel env hardening.** `HANOMAN_SESSION_SANDBOX`,
   `HANOMAN_PUBLIC_ORIGINS`, `HANOMAN_CONTROL_ORIGINS`, dan `HANOMAN_TRUST_PROXY` hanya lahir bila
   operator mengetiknya sendiri — di VPS lewat `EnvironmentFile=/etc/hanoman.env`
   (`operations/deploy-vps.md`). Itu prosedur devops, bukan bagian instalasi. Gerbang ADR-0117
   karena itu menyasar tepat orang yang tak punya cara memuaskannya.
2. **`NODE_ENV` merangkap tiga pekerjaan yang tak berhubungan:** "runtime terpaket"
   (`server/src/web-dir.ts`), "cookie `Secure`" (`services/auth.ts`), dan "hardening ADR-0117"
   (`session-sandbox.ts`, `app.ts`, `upload-pipeline.ts`, `lead/brain.ts`, `portal-chat/argv.ts`,
   `cli/commands/doctor.ts`). Mencabut satu berarti kehilangan ketiganya.
3. **Karena itu profil `lab` SPEC-883 tak akan pernah lahir.** Ia didefinisikan sebagai "`NODE_ENV`
   tidak diset production", tetapi `serverEnv()` menuliskannya hardcoded dan `runServer` men-spawn
   dengan `env: { ...process.env, ...env }` — objek hardcoded ditumpuk BELAKANGAN, jadi ia
   mengalahkan `EnvironmentFile` systemd.
4. **Setup token menutup pintu terakhir, dan UI-nya lebih ketat dari server.**
   `src/src/screens/AuthScreen.tsx` mewajibkan token tanpa pernah membaca `setupTokenRequired` dari
   `/auth/status`, sehingga akun pertama tak bisa dibuat dari UI bahkan ketika server tak memintanya.

Operator memutuskan, secara sadar dan sesudah keberatan disampaikan: **hardening jadi opt-in penuh
dengan default mati, termasuk untuk instance publik**, dan setup awal dipandu **wizard di browser**.

## Keputusan

### Dua nilai eksplisit menggantikan `NODE_ENV` sebagai penentu hardening

| Nilai | Isi | Default | Menentukan |
|---|---|---|---|
| `HANOMAN_DEPLOYMENT` | `local` \| `public` | `local` | default wizard, peringatan, penanda permanen |
| `HANOMAN_HARDENING` | `1` \| kosong | **kosong** | satu-satunya yang menyalakan gerbang ADR-0117 |

`HANOMAN_DEPLOYMENT` **tidak memaksa apa pun** — memilih `public` tidak membuat boot gagal, tidak
mewajibkan podman, dan tidak mewajibkan setup token. `NODE_ENV=production` sesudah ADR ini hanya
berarti **"terpaket"**.

Resolvernya murni dan tinggal di `@hanoman/runner` (`runtime-profile.ts`), **bukan** di
`server/src/services/`: paket `cli` tidak bergantung pada `server`, dan `hanoman doctor` wajib
menjawab sama persis dengan wizard tentang mesin yang sama. Probe prasyarat (`sandbox-probe.ts`)
tinggal di sana karena alasan yang sama.

`assertRuntimeBoundary` hanya mendapat satu baris di depan (`if (!resolveHardening(env)) return;`);
badannya tidak diubah satu karakter pun, jadi begitu hardening menyala perilakunya identik dengan
sebelum SPEC-884.

### Kompatibilitas mundur adalah bagian dari keputusan, bukan kemurahan hati

`resolveHardening` juga benar bila `HANOMAN_SESSION_SANDBOX === "podman"`, `HANOMAN_PUBLIC_ORIGINS`
terisi, atau `HANOMAN_TRUST_PROXY` terisi. Instance yang env-nya sudah memuat penanda ADR-0117 sudah
menyatakan niatnya lewat systemd, jadi ia tetap keras setelah upgrade. Tanpa klausa ini
`hanoman.nafanesia.id` kehilangan seluruh hardening-nya diam-diam pada `npm i -g hanoman@latest`
berikutnya.

### Jawaban wizard hidup di `$HANOMAN_HOME/config.env`, digabung paling lemah

Berkas `KEY=value`, mode `0600` di dalam home `0700`, ditulis server, dibaca CLI. Presedensi spawn:
`{ ...config.env, ...process.env, ...serverEnv() }` — **env systemd/shell selalu menang atas
berkas**, sehingga dashboard secara struktural tak bisa melemahkan hardening yang dipasang operator.

**Bukan lewat `RuntimeConfig`.** Resolver config server presedensinya DB → env
(`server/src/config.ts`), jadi lewat sana siapa pun yang bisa menulis config bisa mematikan
hardening — jebakan yang sama yang sudah dihindari ADR-0088 untuk `HANOMAN_SUPERVISOR`.

Kunci yang boleh ditulis dibatasi allowlist (`services/setup-config.ts`); berkas ini bukan pintu
belakang untuk menyuntik env sembarang ke proses sesi.

`hardeningLocked` dihitung dengan **dua bacaan** (`process.env` vs berkas): sesudah CLI menggabungkan
keduanya, server tak lagi bisa membedakan nilai dari systemd dan dari berkas — padahal justru itu
yang menentukan apakah dashboard boleh mematikannya.

### Restart punya sentinel sendiri

`CONFIG_RESTART_EXIT = 76`, terpisah dari `UPDATE_RESTART_EXIT = 75`, dengan jatah sendiri
(`MAX_CONFIG_RESTARTS`). Memakai ulang 75 akan menjalankan `npm i -g hanoman@latest` setiap kali
seseorang menyelesaikan wizard. Tanpa supervisor (`HANOMAN_SUPERVISOR !== "1"`) server **menyimpan
tapi tidak keluar** — keluar tanpa ada yang menghidupkan lagi berarti instance mati karena menekan
tombol setup.

Efek keluarnya dipisah ke `services/restart.ts` supaya bisa di-mock: `process.exit` yang dipanggil
langsung dari handler membuat setiap test yang menyentuh apply menjadwalkan exit di dalam worker
vitest — terukur sebagai dua unhandled error pada run yang tetap terlihat hijau.

### Wizard dua langkah, akun pertama tetap di `AuthScreen`

Muncul hanya saat `prisma.user.count() === 0` **dan** wizard belum pernah dijawab
(`HANOMAN_SETUP_DONE=1` di `config.env`). Syarat kedua wajib: tanpa itu wizard muncul lagi setiap
restart selama akun pertama belum dibuat, dan operator terjebak lingkaran wizard → restart → wizard.

Langkah 1 peruntukan, langkah 2 keamanan. **Akun pertama sengaja bukan langkah ketiga**: hanya boleh
ada satu jalur yang melahirkan akun beserta aturan token, limiter, dan 409-nya. Urutan yang dilihat
operator tetap peruntukan → keamanan → buat akun.

Toggle hardening **tak bisa dinyalakan selama ada prasyarat merah**; menulis `HANOMAN_HARDENING=1`
tanpa prasyarat lengkap melahirkan instance yang menolak boot pada restart berikutnya — persis
kegagalan yang ADR ini cabut, cuma dipindah dari instalasi ke tombol.

### Cookie `Secure` dari skema request

Dari `NODE_ENV === "production"` menjadi skema request, dan **dipaksa `true`** saat hardening.
`x-forwarded-proto` dibaca **langsung dari header**, bukan lewat `req.protocol`: Fastify hanya
memercayai header itu bila `trustProxy` terisi, dan instance di balik TLS tanpa
`HANOMAN_TRUST_PROXY` — bentuk hanoman lokal di balik Cloudflare Tunnel — akan kehilangan `Secure`
yang hari ini didapatnya dari `NODE_ENV`. Memercayai header ini aman karena arahnya satu:
menyuntiknya hanya bisa membuat cookie lebih ketat; melonggarkannya menuntut menghapus header, dan
header yang absen memang berarti request polos.

## Alternatif yang ditolak

- **Membiarkan `NODE_ENV` sebagai penentu dan menyuruh operator menyetel `NODE_ENV=lab`.** Tak bisa:
  `serverEnv()` menuliskannya hardceded dan mengalahkan `EnvironmentFile` (fakta 3). Ini bukan
  preferensi, melainkan mustahil tanpa mengubah CLI.
- **Menyimpan profil di `RuntimeConfig`.** Presedensi DB → env membuat siapa pun yang bisa menulis
  config bisa mematikan hardening. Ditolak eksplisit, pelajaran ADR-0088.
- **Wizard di CLI.** Ia bisa mengurus hal yang memblokir boot, tapi operator memilih browser; dengan
  boot yang tak lagi gagal, tak ada lagi yang harus diputuskan sebelum server lahir.
- **Deteksi otomatis "publik" dari bind non-loopback.** Instance hanoman lokal yang dipublikkan lewat
  Cloudflare Tunnel tetap bind `127.0.0.1`, jadi sinyalnya salah di kedua arah.
- **Wizard yang memasang podman/proxy sendiri.** Server tak memasang perangkat lunak apa pun
  (ADR-0048/0088). Wizard memeriksa dan menjelaskan.

## Konsekuensi

- **Instalasi npm polos kini boot di device mana pun, termasuk sebagai root.** Gerbang root claude
  sudah punya jalan keluar resmi (`IS_SANDBOX=1`, dipasang `pty.ts` hanya saat uid 0).
- **Instance publik tanpa hardening dijaga satu password saja.** hanoman menjalankan sesi
  `claude`/`codex` dengan `--dangerously-skip-permissions`; worktree mengisolasi Git, bukan
  filesystem, credential, proses, atau jaringan host (invariant 3 ADR-0117). Keadaan itu karena
  itu **wajib terlihat**: penanda permanen di dashboard, dan satu checkbox pengakuan di wizard.
- **Wizard tidak terlindungi apa pun** — ia harus bisa dijangkau justru karena belum ada akun.
  Instance yang sudah terjangkau internet sebelum wizard selesai **bisa diklaim orang pertama yang
  membukanya**. Urutan amannya: selesaikan wizard di `localhost`, baru sambungkan domain/tunnel.
  Sebelum SPEC-884 pintu itu ditutup setup token; menjadikan token opsional membukanya.
- **Scanner upload jadi peringatan** saat hardening mati — lampiran diterima tanpa dipindai, dan itu
  dicatat di log, bukan senyap.
- Deployment lama tak perlu disentuh: env ADR-0117 yang sudah ada dibaca sebagai hardening menyala.

## Invariant yang tidak boleh dilonggarkan diam-diam

1. `config.env` tak pernah mengalahkan env proses.
2. Hardening yang dinyalakan di luar `config.env` tak bisa dimatikan dari dashboard.
3. `HANOMAN_HARDENING=1` tak pernah ditulis saat prasyarat masih merah.
4. Invariant 1–7 ADR-0117 berlaku penuh, tanpa pengurangan, setiap kali hardening menyala.
5. Permukaan setup publik hanya selama `prisma.user.count() === 0`.
