# Audit SPEC-862 — prompt passphrase kunci ssh menyela dialog pilihan dan memacetkan sesi

**Tanggal:** 2026-08-20 · **Sumber:** qa · **Severity:** critical
**Versi terukur:** hanoman 0.1.52 · OpenSSH_10.2p1 (LibreSSL 3.3.6) · tmux 3.7b · macOS 25.3.0
**Keputusan:** Spec & Plan **skipped** — akar tunggal, terbukti in-vivo, diff kecil dan terkurung di
satu titik cekik (`createSession`). Dokumen ini adalah doc-of-record perbaikannya.

## Ringkasan

Sesi agen macet bukan karena hanoman kehilangan `SSH_AUTH_SOCK`, melainkan karena **`ssh` boleh
meminta ketikan di pane yang tak punya manusia**. `read_passphrase()` OpenSSH membuka `/dev/tty`
**langsung** — ia tak melewati stdin, jadi tak peduli siapa yang sedang memegangnya. Pane sesi
hanoman punya satu tty, dan TUI agen (widget daftar Ink `AskUserQuestion`, SPEC-452) sudah memegang
tty itu dalam raw mode. Begitu `ssh` ikut membacanya, keduanya menjadi pembaca atas tty yang sama:
ketikan operator terbelah tak tentu di antara mereka, redraw TUI **menghapus prompt ssh dari layar**,
dan tak satu pun bisa selesai. Yang tampak di layar: dialog pilihan yang kelihatan normal tapi tak
bisa dijawab, dengan proses `ssh` tak terlihat yang menelan tombol.

Dan bukan cuma macet. Pada sebagian pembelahan — terukur, berulang — tombol panah ditelan `ssh`,
sorotan tak pernah bergerak, lalu `Enter` mengirim pilihan **pertama** ke agen sebagai kehendak
operator. Kemungkinan kedua yang diminta backlog untuk diperiksa terbukti, dan ia lebih buruk dari
kemacetan: tak ada apa pun yang terlihat gagal.

## Hipotesis yang WAJIB dibuktikan — keduanya TERBANTAH

Backlog mewajibkan dua klaim dibuktikan atau ditolak dengan bukti. Keduanya ditolak. Dicatat di sini
supaya tak ada yang "memperbaikinya" nanti.

### Terbantah 1 — launchd TIDAK menghilangkan `SSH_AUTH_SOCK`

Server memang dijalankan lewat launchd (`~/Library/LaunchAgents/com.nafanesia.hanoman.plist`,
`RunAtLoad`+`KeepAlive`, `ProgramArguments = /bin/sh ~/.hanoman/supervisor.sh`), dan rantai
prosesnya `launchd(1) → supervisor.sh(1331) → node dist/server.js(30583)`. Tapi env-nya utuh —
diukur dengan `ps -p <pid> -Eww`:

| proses | `SSH_AUTH_SOCK` |
|---|---|
| shell login operator | `/private/tmp/com.apple.launchd.xoGfqUa9x7/Listeners` |
| server hanoman (pid 30583, anak launchd) | `/private/tmp/com.apple.launchd.xoGfqUa9x7/Listeners` |
| tmux server socket `hanoman` (pid 10834) | `/private/tmp/com.apple.launchd.xoGfqUa9x7/Listeners` |

Identik, ketiganya. Sebabnya struktural, bukan kebetulan: di macOS `SSH_AUTH_SOCK` bukan variabel
biasa yang diturunkan shell login, melainkan disuntikkan launchd ke **seluruh job di user domain**
lewat `SecureSocketWithKey` milik `com.openssh.ssh-agent` — itulah kenapa `launchctl getenv
SSH_AUTH_SOCK` mengembalikan **kosong** padahal nilainya ada di mana-mana. Blok `EnvironmentVariables`
di plist **menambah**, bukan menggantikan. Jadi "server lewat launchd" tak pernah menjadi sebab di
sini.

### Terbantah 2 — tmux TIDAK mewariskan `SSH_AUTH_SOCK` yang basi ke sesi baru

Server tmux berumur panjang (ppid 1) dan env globalnya memang membeku saat daemon lahir, jadi
kecurigaannya masuk akal. Tapi `update-environment` bawaan tmux memuat `SSH_AUTH_SOCK` dan
menyegarkannya dari **klien yang membuat sesi** — dan `-f /dev/null` tak mematikannya (itu default
terkompilasi, bukan isi `~/.tmux.conf`). Diukur dengan menyalakan server tmux ber-socket lama lalu
membuat sesi kedua dari klien ber-socket baru:

```
pane sesi kedua      → PANE_SOCK=/tmp/SOCK_BARU     ← yang diwarisi proses sesi
show-environment -g  → SSH_AUTH_SOCK=/tmp/SOCK_LAMA ← env global server tmux, memang basi
```

Pane mendapat yang **baru**. Restart server hanoman karena update/launchd karena itu tidak
meninggalkan sesi baru dengan socket basi. (Pane yang sudah hidup tentu memegang nilai saat ia lahir
— itu sifat proses, bukan cacat yang bisa ditambal.)

## Akar sebenarnya — agent yang hidup ≠ kunci yang terbuka

Yang hilang bukan socket agent-nya, melainkan **kuncinya**. Diukur pada mesin pelapor:

```
$ ssh -G git@github.com | grep -E 'identityfile|batchmode'
identityfile ~/.ssh/id_rsa
batchmode no

$ ssh-add -l                       # isi agent, LENGKAP
256 SHA256:RL2dsEox7O9xzN74IQvYFLTWcHUX5ajiKnNpTmn9I0g hanoman (ED25519)   ← ~/.hanoman/id_ed25519

$ ssh-keygen -lf ~/.ssh/id_rsa.pub
4096 SHA256:PxwdtLEK8wh4kLTOQqLLDfs05w2XQLHg0OvMHpy93G4 …                  ← ber-passphrase
```

`~/.ssh/config` memasang `Host *` → `IdentityFile ~/.ssh/id_rsa`. Kunci itu **ber-passphrase** dan
**tidak** ada di agent; satu-satunya isi agent adalah kunci VPS milik hanoman sendiri
(`~/.hanoman/id_ed25519`, ADR-0042). Jadi setiap `git fetch/push` atau `ssh` lewat ssh dari pane sesi
mana pun jatuh ke jalur "buka berkas kunci" → `read_passphrase()` → **`/dev/tty`**.

Dan `pty.ts` tak punya apa pun yang mencegahnya: `createSession` merangkai env sesi di `envPairs`
(pty.ts:395-406) dan satu-satunya penghuninya hari ini adalah `rootBypassEnv()`, `HANOMAN_PHASE_FILE`,
`HANOMAN_ATTACHMENTS_DIR`, dan `opts.env`. Tak ada satu pun yang berkata "di pane ini tidak ada
manusia". `batchmode no`, `SSH_ASKPASS_REQUIRE` tak disetel — ssh berhak, dan benar menurut aturannya
sendiri, untuk meminta ketikan.

## Repro in-vivo di tmux nyata

Unit test atas TUI palsu memang tak bisa membuktikan semantik perebutan tty ini, jadi repro dibangun
utuh: `sshd` OpenSSH sungguhan di `127.0.0.1:2222` dengan host key sendiri, satu kunci klien
**ber-passphrase** yang sengaja tidak dimuat ke agent, dan sebuah TUI raw-mode bergaya widget daftar
Ink yang mencatat setiap byte yang benar-benar sampai kepadanya. Semuanya di dalam pane tmux yang
lahir dengan opsi yang sama dengan sesi hanoman (`remain-on-exit on`, `status off`, `prefix None`).

**Langkah 1 — prompt menyela dialog.** `SSH_AUTH_SOCK` sah dan agent bisa dihubungi:

```
== DIALOG PILIHAN ==
> Opsi A
  Opsi B
Enter passphrase for key '/…/rig/clientkey':
```

**Langkah 2 — operator menjawab dialog: `Down` lalu `Enter`.** Empat kali dijalankan, tiga bentuk
kerusakan berbeda — dan itu **bukan** ketidakrapian repro, melainkan temuannya: dua pembaca atas
satu tty membelah byte sesuka kernel.

| yang diterima TUI | akibat di layar |
|---|---|
| `"\r"` saja | `Enter` mengirim **`Opsi A`** ke agen — jawaban yang tak dipilih siapa pun |
| `"B"` saja | urutan escape panah **robek**, sorotan tak bergerak, dialog tuli |
| tak satu pun | dialog benar-benar mati; setiap tombol masuk ke ssh |

Yang **selalu** benar di keempatnya: urutan escape panah tak pernah sampai utuh, jadi dialog tak bisa
dijawab sebagaimana dimaksud. Dan pada bentuk pertama kerusakannya lebih buruk dari macet — agen
menerima sebuah jawaban yang **salah** sebagai kehendak operator, tanpa apa pun yang terlihat gagal.
Itu kemungkinan kedua yang diminta backlog untuk diperiksa: jawaban dialog memang bisa **nyasar**.

Dua hal lain menyertainya setiap kali. **Prompt ssh lenyap dari layar** — redraw TUI (clear-screen)
menimpanya, jadi operator melihat dialog yang tampak sehat. Dan **`ssh` tetap hidup** sesudahnya
(terekam `pid 8672`, anak TUI, menunggu `Enter`-nya sendiri yang tak pernah datang) sambil terus
menelan tombol. Itu persis "kursor menunggu ketikan yang tak pernah datang" di laporan — dan alasan
satu-satunya jalan keluar adalah menutup sesi dengan tangan.

### Diulang lewat `createSession` sungguhan

Rig di atas membuktikan mekanismenya; untuk memastikan ia benar-benar jalur hanoman, seluruh
percobaan diulang lewat **`createSession()` apa adanya** — `HANOMAN_CLAUDE_BIN` menunjuk TUI rig,
env sesi dirakit `envPairs` seperti biasa, tombol dikirim lewat `writeTo()`, layar dibaca lewat
`attach()`. Dua sel, satu variabel:

| sel | log TUI | vonis |
|---|---|---|
| gerbang **dimatikan** (`SSH_ASKPASS_REQUIRE=never` lewat `opts.env`) | kosong / `"B"` / `"\r"` | prompt passphrase muncul, dialog tak terjawab |
| gerbang **menyala** (bawaan sesudah fix) | `SSH_EXIT 255` · panah utuh · `"\r"` · `TUI_SUBMIT Opsi B` | ssh gagal dalam milidetik, dialog utuh, jawaban benar |

Satu catatan operasional yang mahal ditemukan: percobaan pertama **tampak** seolah fix-nya gagal,
karena `vitest.config.ts` memaku `HANOMAN_TMUX_SOCKET = "hanoman-test"` — socket yang **dipakai
bersama seluruh sesi di mesin ini**, sehingga `killAll()` sesi tetangga membunuh pane repro di tengah
jalan. Dengan socket privat hasilnya stabil dan berulang. Ini kambuhnya jebakan yang sudah tercatat
untuk `pty.test.ts`.

## Perbaikan

Preseden yang dipakai ulang adalah penalaran `services/vps-ssh.ts:34-57` apa adanya, bukan mekanisme
baru: **tanpa password, ssh tak boleh pernah punya prompt**; dan bila prompt terpaksa ada, ia lewat
`SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force`, bukan lewat tty. Bedanya di sini hanoman **tidak
memanggil ssh sendiri** — yang memanggilnya adalah agen, lewat `git`, dengan argv yang bukan milik
kita. Maka gerbangnya harus di **env sesi**, satu-satunya kanal yang kita pegang. `BatchMode` gugur
karena ia hanya ada sebagai opsi `-o`/config, tanpa padanan environment.

Sesi agen karena itu lahir membawa:

- `SSH_ASKPASS` → skrip milik hanoman yang **selalu gagal** (`exit 1`) sambil mencetak satu baris
  yang menyebut apa yang diminta dan apa yang harus dilakukan operator.
- `SSH_ASKPASS_REQUIRE=force` → menurut `ssh(1)`, askpass dipakai untuk **seluruh** input passphrase
  tanpa peduli `DISPLAY`. `read_passphrase()` tak pernah menyentuh `/dev/tty`, dan ia **tidak** jatuh
  balik ke tty saat askpass gagal.
- `GIT_TERMINAL_PROMPT=0` → lihat "Pelebaran scope yang disengaja" di bawah.

Bukti bahwa ini menutup keduanya, rig yang sama persis, satu variabel yang diubah:

```
=== layar ===                                        === yang diterima TUI ===
== DIALOG PILIHAN ==                                 SSH_EXIT 255
> Opsi A                                             TUI_GOT "[B"
  Opsi B                                             TUI_GOT "\r"
hanoman: ssh meminta '…' — sesi tak boleh diminta     TUI_SUBMIT Opsi B
  ketikan. Muat kuncimu: ssh-add ~/.ssh/id_rsa
denameidina@127.0.0.1: Permission denied (publickey).
```

`ssh` gagal dalam hitungan milidetik dengan pesan yang terbaca, dialog memegang tty-nya sendiri,
**kedua** tombol sampai, dan jawaban yang terkirim adalah `Opsi B` — yang benar-benar dipilih.

**Jalur normal tak tersentuh.** Kontrol positif, agent memegang kuncinya:

```
$ ssh-add rig/clientkey && SSH_ASKPASS=<gagal> SSH_ASKPASS_REQUIRE=force ssh -F … rig 'echo REMOTE_OK'
REMOTE_OK
```

askpass tak pernah dipanggil — ia hanya masuk saat sebuah passphrase memang dibutuhkan.

## Gerbang — sesi mana yang menerimanya

Hanya sesi **agen** (`!opts.command`). Sesi ber-argv mentah tidak, dan ini bukan kehati-hatian
melainkan syarat kebenaran: Console VPS (SPEC-211/ADR-0042) dan terminal biasa (SPEC-236) adalah
pane yang **memang** dipegang manusia, di mana prompt passphrase adalah perilaku yang diinginkan dan
memaksanya gagal akan mematikan fitur. Gerbang `!opts.command` yang sama sudah dipakai
`rootBypassEnv` tepat satu blok di atasnya — pembedanya identik: *apakah ada TUI agen yang memegang
tty ini, atau seorang manusia*.

Dipasang **sebelum** `opts.env` supaya operator/pemanggil tetap bisa menimpanya, urutan yang sama
dengan `rootBypassEnv` dan `leadEnv` (SPEC-448).

`lead/brain.ts` sengaja **tidak** ikut: ia mem-`spawn` `claude -p` tanpa tty sama sekali, jadi
`read_passphrase()` di sana sudah jatuh ke askpass/gagal tanpa ada tty untuk direbut. Menyalinnya ke
sana berarti membuat definisi kedua atas hal yang sama — kelas bug SPEC-431/448 yang justru dihindari
`brain.ts` dengan mengimpor `rootBypassEnv`, bukan menyalinnya.

## Pelebaran scope yang disengaja — `GIT_TERMINAL_PROMPT=0`

Satu baris di luar bunyi harfiah backlog, disebut terbuka karena ia adalah **konsekuensi langsung**
dari fix ini, bukan tambahan bebas. `git` mencari askpass berurutan `GIT_ASKPASS` → `core.askPass` →
**`SSH_ASKPASS`**, lalu — bila semuanya gagal — **tetap** bertanya di terminal. Jadi begitu hanoman
menyetel `SSH_ASKPASS`, `git push` lewat HTTPS yang butuh kredensial akan memanggil skrip kita,
mencetak pesannya, **lalu tetap menggantung di tty** — kelas kegagalan yang sama persis, kini dengan
tambahan satu baris membingungkan. `GIT_TERMINAL_PROMPT=0` menutupnya: git gagal cepat dengan
`could not read Username for '…': terminal prompts disabled`. Tanpa baris ini, fix-nya membuat satu
jalur sedikit lebih berisik tanpa membuatnya lebih benar.

## Yang sengaja TIDAK dikerjakan

- **Tidak** mengetik passphrase dari hanoman, dan **tidak** menyimpan passphrase di DB/Settings —
  batas yang ditetapkan backlog dan tidak disentuh. Skrip askpass hanoman tak punya rahasia apa pun;
  ia hanya menolak.
- **Tidak** memuat kunci ke `ssh-agent` atas nama operator. Membuka kunci pribadi adalah keputusan
  manusia; hanoman hanya membuat kegagalannya terbaca.
- **Tidak** menyentuh `~/.ssh/config` operator. Konfigurasi `Host * → id_rsa` di mesin pelapor adalah
  penyebab **pemicu**, bukan akar — akarnya adalah pane yang mengizinkan prompt. Mesin lain akan
  memicunya lewat jalan lain (host key baru, kunci lain yang belum di-`ssh-add`, agent yang mati).
- **Tidak** ada ADR, migration, endpoint, atau knob baru. ADR-0016 (sesi tmux), ADR-0037 (guardrail
  dicabut, agen dipercaya penuh), dan ADR-0042 (Console VPS = ssh mentah) semuanya **ditegakkan**,
  tak satu pun diamandemen.

## Batas yang diakui

- Askpass hanoman menolak **semua** permintaan ketikan ssh di sesi agen, termasuk konfirmasi host key
  saat `StrictHostKeyChecking=ask` bertemu host yang belum dikenal. Itu memang perubahan perilaku —
  dan perubahannya dari *menggantung selamanya* menjadi *gagal dengan pesan*. Untuk sesi tanpa
  manusia, itu arah yang benar.
- Pane yang **sudah** hidup sebelum perbaikan ini tetap membawa env lamanya. Sesi yang sedang macet
  tetap harus ditutup dengan tangan sekali; sesi berikutnya lahir sudah terlindungi.
- Perebutan tty ini bukan milik ssh saja — program apa pun yang membuka `/dev/tty` sendiri bisa
  melakukan hal yang sama. Yang ditutup di sini adalah ssh dan git, dua yang benar-benar terjadi.

## Test yang mengunci

- `server/test/pty.test.ts` — sesi agen lahir membawa ketiga variabel dan berkas askpass-nya benar
  ada + executable; sesi ber-argv mentah (Console VPS / terminal biasa) **tidak**; `opts.env`
  pemanggil tetap menang.
- Skrip askpass diuji sebagai kontrak yang bisa dijalankan: `exit 1`, tak mencetak apa pun ke stdout
  (nilai apa pun di stdout akan dibaca ssh sebagai passphrase), dan menyebut permintaan aslinya di
  stderr.
- Repro tty-steal-nya sendiri tetap berupa rig manual seperti di atas — ia butuh `sshd` sungguhan dan
  tak layak jadi test suite; buktinya terekam di dokumen ini.
