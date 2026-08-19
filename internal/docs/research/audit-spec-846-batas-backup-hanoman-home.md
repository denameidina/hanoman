# Audit SPEC-846 — direktori data di luar `HANOMAN_HOME` merusak batas backup/restore

Sumber: GitHub issue [denameidina/hanoman#7](https://github.com/denameidina/hanoman/issues/7)
(@wulanrlestari), severity **Major**. Metode: `superpowers:systematic-debugging` — bukti dulu,
baru hipotesis, baru fix.

## Ringkasan

Klaim inti issue — transkrip dan upload jatuh ke `<cwd>/data/**` — **sudah tidak berlaku**: commit
`1699c2d6` (SPEC-761) memindahkan keduanya ke `resolveHome()` pada 2026-08-14. Issue ditulis
terhadap keadaan sebelum commit itu.

Yang **masih benar** adalah premis issue-nya: `$HANOMAN_HOME` belum menjadi satu batas
backup/restore yang utuh. Empat cacat tersisa, semuanya terkonfirmasi, plus dua doc yang berbohong
tentang isi direktori itu.

## Bukti — resolusi direktori data hari ini

Dijalankan dengan `HANOMAN_HOME=/tmp/h-home-846`, tanpa override lain, di dalam runtime server:

```
HOME       = /Users/denameidina
keyDir     = /Users/denameidina/.hanoman     ← TIDAK mengikuti HANOMAN_HOME
transcript = /tmp/h-home-846/transcripts     ← benar
upload     = /tmp/h-home-846/uploads         ← benar
```

Jadi acceptance criteria #1 dan #3 issue (cwd tak berpengaruh; override eksplisit tetap menang)
sudah dipenuhi untuk transkrip & upload, dan **tidak** dipenuhi untuk key SSH.

## Temuan

### F1 · `keyDir()` mengabaikan `HANOMAN_HOME` — key SSH keluar dari batas backup

`server/src/services/vps-key.ts:9`

```ts
export const keyDir = (): string => effectiveStr("HANOMAN_SSH_KEY_DIR") ?? join(homedir(), ".hanoman");
```

`homedir()`, bukan `resolveHome()`. Tiga akibat, urut dari yang paling mahal:

1. **Backup `$HANOMAN_HOME` tidak memuat identitas SSH hanoman.** Restore di host lain melahirkan
   keypair baru → seluruh `authorized_keys` VPS yang sudah di-bootstrap tak lagi cocok, dan
   `Vps.keyPath` di DB menunjuk berkas yang tak ada. Audit/console VPS mati tanpa jalan pulih
   selain bootstrap ulang dengan password.
2. **Runbook berbohong.** `internal/docs/operations/npm-readme.md:87` menyatakan `HANOMAN_HOME`
   berisi "DB SQLite, **key SSH**, transkrip sesi". Untuk `HANOMAN_HOME` non-default itu salah.
3. **Dua instance di satu mesin berbagi satu identitas.** `internal/docs/operations/production.md`
   memisahkan dev & prod lewat `HANOMAN_HOME` (`~/.hanoman` vs `/srv/hanoman-prod`), tetapi key
   SSH keduanya tetap satu berkas di `~/.hanoman/id_ed25519`. Mencabut akses satu instance dari
   sebuah VPS mencabut akses instance yang lain juga.

Pada layout VPS di `deploy-vps.md` (`HANOMAN_HOME=/var/lib/hanoman` + `Environment=HOME=/var/lib/hanoman`)
key mendarat di `/var/lib/hanoman/.hanoman/` — kebetulan masih di dalam pohon home, tetapi di
subdirektori tersembunyi yang tak disebut runbook mana pun.

**Bahaya migrasi:** memindahkan default begitu saja akan membuat instance yang sudah berjalan
membuat key BARU dan kehilangan akses VPS-nya secara senyap. Fix harus memungut key lama.

### F2 · `hanoman mcp` menduplikasi resolusi home

`cli/src/commands/mcp.ts:22`

```ts
const home = env.HANOMAN_HOME ?? join(homedir(), ".hanoman");
```

Logika `resolveHome()` disalin alih-alih dipanggil, dan salinannya berbeda: tak ada `.trim()`.
`HANOMAN_HOME="  "` (mudah lahir dari `EnvironmentFile` yang ceroboh) membuat `resolveHome()`
jatuh ke `~/.hanoman` sementara baris ini membaca `"  /agent-token"` → token tak ketemu, MCP jalan
tanpa autentikasi dan hanya mencetak peringatan. Ini duplikasi yang sama bentuknya dengan yang
melahirkan F1.

### F3 · `hanoman doctor` tak menyebut satu pun path data

`cli/src/commands/doctor.ts:36` melaporkan `data dir bisa ditulis` — **tanpa menyebut direktori
mana**. Transkrip, upload, dan key SSH tak dilaporkan sama sekali. Operator yang ingin memastikan
"apa yang harus saya backup" atau "kenapa upload gagal" tak punya perintah yang menjawabnya;
satu-satunya path yang tercetak adalah `db`.

Acceptance criteria #5 issue meminta persis ini.

### F4 · Kegagalan menulis transkrip membatalkan penutupan baris riwayat

`server/src/services/session-history.ts:47`

```ts
const t = d.transcript ? await saveTranscript(d.transcript) : { key: "", bytes: 0 };
await prisma.sessionHistory.update({ /* endedAt, exitCode, transcriptKey */ });
```

`saveTranscript` melempar bila direktorinya tak bisa ditulis (disk penuh, `$HANOMAN_HOME` read-only,
mount hilang). Lemparannya melewati `update()` dan ditelan `installSessionHistory()`
(`onDeath: (d) => void finishSession(d).catch(console.error)`).

Akibatnya bukan "transkrip hilang" melainkan **baris riwayat tak pernah ditutup**: `endedAt` tetap
`null` dan `exitCode` hilang, sehingga sesi mati terbaca "berjalan" di UI sampai boot berikutnya
menjalankan `reconcileHistory()` — yang menulis `endedAt = updatedAt` dan `exitCode` tetap `null`.
Satu kegagalan I/O opsional menjatuhkan dua field yang tidak opsional. Ini pengulangan kelas bug
"konflasi exited↔selesai" yang sudah tiga kali muncul di repo ini (SPEC-433/451).

Acceptance criteria #4 issue menyebut gejala ini ("does not lose history silently").

### F5 · Doc: batas backup/restore tak pernah ditulis utuh

- `npm-readme.md:87` — `HANOMAN_HOME` = "DB SQLite, key SSH, transkrip sesi". Key SSH salah (F1),
  upload/lampiran tidak disebut, `secret.key`/`setup.token` tidak disebut.
- `deploy-vps.md` §7 — hanya "backup SQLite bersama `secret.key`". Transkrip, upload (yang memuat
  lampiran tiket **dan** byte source-map lama), dan key SSH tak disebut. Restore dari resep ini
  menghasilkan DB dengan pointer transkrip/lampiran yang tak bisa dibuka — persis skenario
  reproduksi issue.
- Tak ada satu pun tempat yang mencantumkan daftar lengkap isi `$HANOMAN_HOME`.

### F6 · Doc stale: default upload di ADR-0062

`internal/docs/adr/0062-help-center-tiket-publik-triase.md:44` masih menyebut default
`<server>/data/uploads`. Sudah tidak benar sejak SPEC-761.

## Keputusan

**Spec & Plan dilewati.** Empat temuan kode berconfidence tinggi dengan akar yang sama dan tunggal —
lokasi data diturunkan di lebih dari satu tempat, dan satu di antaranya memakai `homedir()` alih-alih
`resolveHome()`. Diffnya kecil, tanpa perubahan skema, endpoint, payload, maupun kontrak API.
Dokumen ini menjadi doc-of-record perbaikannya.

## Perbaikan

1. **`runner/src/paths.ts` menjadi satu-satunya penurun lokasi data.** Tambah `resolveDataDirs(env, home)`
   yang mengembalikan `{ home, transcripts, uploads, sshKeys }` — semuanya turun dari `resolveHome()`,
   dengan override env per-direktori tetap menang. Server & CLI memakai fungsi yang sama, sehingga
   drift yang melahirkan F1/F2 tak bisa lahir lagi.
2. **`vps-key.ts` memakai resolver itu** (`sshKeys` default = akar home, jadi instance default
   `~/.hanoman` tidak bergerak sedikit pun), plus **pemungutan key lama**: bila lokasi kanonik kosong
   dan `~/.hanoman/id_ed25519` ada, key dipindahkan ke lokasi kanonik alih-alih membuat yang baru.
   Ini yang menjaga akses VPS instance yang sudah berjalan.
3. **`mcp.ts` memanggil `resolveHome(env)`** alih-alih menyalinnya.
4. **`finishSession` memperlakukan transkrip sebagai best-effort** — kegagalannya dicatat, baris
   riwayat tetap ditutup dengan `endedAt`/`exitCode`. Cermin `dropSessionUploads` yang sudah
   best-effort karena alasan yang sama.
5. **`hanoman doctor` melaporkan setiap path data efektif + writability-nya.** Home fatal (seperti
   sekarang), direktori turunan memberi peringatan — ia dibuat saat dipakai, jadi yang diperiksa
   adalah leluhur terdekat yang sudah ada.
6. **Doc:** daftar lengkap isi `$HANOMAN_HOME` + resep backup/restore utuh di `deploy-vps.md`,
   tabel env `npm-readme.md` dikoreksi, amandemen satu baris di ADR-0062.

Tidak dikerjakan: relokasi key SSH untuk instance yang mengeset `HANOMAN_SSH_KEY_DIR` secara
eksplisit (override eksplisit tak boleh disentuh), dan tooling backup otomatis (di luar scope
issue — yang diminta adalah batasnya bisa didefinisikan, bukan dieksekusi hanoman).

## Verifikasi

- `runner/test/paths.test.ts` — `resolveDataDirs` mengikuti `HANOMAN_HOME`, tak tergantung cwd,
  override eksplisit menang (AC #1, #3).
- `server/test/vps-key.test.ts` — key lahir di bawah `HANOMAN_HOME`; key lama dipungut, bukan
  diganti (AC #2 untuk key SSH).
- `server/test/session-history.service.test.ts` — direktori transkrip tak bisa ditulis → baris
  tetap tertutup dengan `exitCode` (AC #4).
- `cli/test/doctor.test.ts` — path tercetak; path tak bisa ditulis memberi peringatan/fatal (AC #5).
- `server/test/home-relocation.test.ts` — simpan di satu home, salin direktorinya, baca kembali
  dari home hasil restore (AC #2, #6). Mutation-check: memoisasi `transcriptDir()` saat modul dimuat
  membuatnya gagal, jadi ia benar-benar mengunci resolusi saat-panggil.
- `server/test/transcript-store.test.ts` + `server/test/session-uploads.test.ts` — default turun dari
  `$HANOMAN_HOME`, dan override berisi spasi tak berubah menjadi direktori di bawah cwd (AC #1).
- `cli/test/mcp-cmd.test.ts` — `agentTokenPath` mengikuti `resolveHome`, termasuk `.trim()`-nya.
