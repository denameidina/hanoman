# Audit SPEC-903 — status "Menunggu keputusan" adalah latch marker, bukan keadaan

**Tanggal:** 2026-08-22 · **Sumber:** qa · **Prioritas:** tinggi
**Worktree:** `.worktrees/spec-903` · **Base:** `5fe3c6ff` (0.1.56)
**Metode:** superpowers:systematic-debugging (Fase 1–3 di bawah; Fase 4 = plan/execute)

---

## 1. Gejala

Pil "Menunggu keputusan" pada sel Terminal dan pose `waiting` pada pet menyala selama agen
jelas-jelas bekerja, dan hanya padam bila kebetulan ada prompt polos diketik manusia.

Terukur 2026-08-22 di mesin dev (laporan backlog):

| pane | layar | marker `.worktrees/.decisions/<id>` |
|---|---|---|
| `hanoman-spec-901` | `✢ Creating… (28m 3s · ↓ 112.3k tokens)` | terisi, 8 B |
| `hanoman-spec-902` | `✶ Manifesting… (25m 12s)` | terisi, 8 B |

Diverifikasi ulang di worktree ini pada pukul yang sama, pane masih hidup:

```
$ tmux -L hanoman capture-pane -p -t hanoman-spec-902 | tail -6
✳ Manifesting… (32m 13s · ↓ 130.3k tokens)
…
$ wc -c < /Users/…/base.tumbuh.ai/.worktrees/.decisions/spec-902
8            # isi: "waiting\n"  → marker pra-ADR-0141, decisionAt undefined
```

`markerFilled()` → `true` → `SessionInfo.decision` → pil menyala pada sesi yang bekerja.

## 2. Akar masalah

Klaim backlog diverifikasi baris per baris di worktree ini. **Semua benar.**

`decision` adalah satu bit yang dibaca dari ukuran berkas marker:

```
server/src/services/pty.ts:46    markerFilled(f) = statSync(f).size > 0
server/src/services/pty.ts:297   decision: !exited && !!decisionFile && markerFilled(decisionFile)
        → shared/src/dto.ts:179  zTerminalSession.decision
        → src/src/screens/TerminalScreen.tsx:796   awaiting = !exited && !!decision
        → src/src/screens/pet-state.ts:140         decision && !deciding → pose "waiting"
        → src/src/screens/SchedulerScreen.tsx:122  badge "menunggu keputusan"
        → server/src/services/notifications.ts:162 notifikasi type "decision"
        → server/src/routes/lead.ts:44             daftar `waiting` panel lead
```

Marker **DITULIS** oleh hook agen:

| agen | event | berkas |
|---|---|---|
| claude | `Notification` yang teksnya cocok `idle\|permission\|waiting for\|needs.?input` | `runner/src/settings.ts:16` |
| codex | `Stop` — codex tak punya `Notification`, jadi **setiap akhir turn** | `runner/src/codex-settings.ts:38` |

Marker **DIHAPUS** oleh tepat dua peristiwa:

| peristiwa | berkas |
|---|---|
| `UserPromptSubmit` (manusia mengetik prompt polos) | `settings.ts:18`, `codex-settings.ts:39` |
| rantai lead selesai | `server/src/services/lead/detect.ts:306` (`deps.clearMarker`) |

Karena itu marker adalah **latch**: ia menyala pada satu pemberitahuan dan hanya padam pada satu
peristiwa yang tak berkorelasi dengan berakhirnya episode menunggu. Empat jalur keluar tetap
terbuka:

| jalur | mengapa marker tak padam |
|---|---|
| (a) memilih opsi `AskUserQuestion`/izin langsung di TUI | jawabannya *tool result*, bukan prompt → `UserPromptSubmit` tak menembak |
| (b) `POST /terminal/sessions/:id/dialog/answer` (SPEC-899) | `server/src/routes/terminal.ts:365-384` tak menyentuh marker sama sekali — diverifikasi dengan membaca handler-nya utuh |
| (c) Esc | bukan event hook apa pun |
| (d) codex melanjutkan sendiri | marker dipasang di **tiap** akhir turn (`codex-settings.ts:38`), jadi menyala walau tak ada yang ditanyakan |

Bukti tambahan bahwa `Notification` tak menembak dua kali dalam satu episode ada di kode lead
sendiri (`lead/detect.ts:300-305`): "hook `Notification` claude mengisi marker SEKALI per dialog dan
tak pernah menembak lagi — terukur 0 B selama 120 dtk dengan dialognya masih terbuka".

**Akar:** `decision` memberi arti *keadaan* ("sesi ini sedang menunggu manusia") kepada sebuah
*pemberitahuan* ("sesi ini pernah minta masukan"). Selama arti itu tak digerbangi keadaan pane yang
sebenarnya, tak ada penambalan jalur keluar yang bisa lengkap — jalur keluar selalu bisa bertambah
(Esc, tombol layar SPEC-800, dialog dari pet SPEC-899, mesin agen ketiga).

## 3. Bahan perbaikan: apa yang tmux sudah tahu, gratis

Batas (1) backlog: biaya baca pane harus hemat — memori proyek mencatat `execFileSync tmux
list-panes` 2×/dtk pernah memblokir event loop sampai 916 ms saat mesin sibuk. Jadi **tambahan
invokasi tmux per sesi per poll tidak boleh ada**.

`listPanes()` sudah menanyakan satu `tmux list-panes -a -F <FMT>` untuk **semua** pane
(`pty.ts:250-256`). Menambah variabel format ke `FMT` karena itu berbiaya nol invokasi — pola yang
persis dipakai SPEC-863 saat menambahkan `#{alternate_on}`.

### Temuan 3.1 — `#{window_activity}` memisahkan "bekerja" dari "menunggu" dengan bersih

22 sampel berturut-turut, 1 Hz, pada pane hidup di socket `hanoman`:

```
now=1787414176  spec-902(bekerja)=1787414176   86c4f130(idle)=1787413880
now=1787414177  spec-902=1787414177            86c4f130=1787413880
…                (22 sampel, delta selalu 0)   …
now=1787414197  spec-902=1787414197            86c4f130=1787413880
```

- pane claude yang **bekerja** (`✳ Manifesting… (32m 13s`): `window_activity == now` pada **22/22**
  sampel → jeda keluaran maksimum ≤ 1 dtk. Timer giliran claude memang wajib berdetak tiap detik.
- pane claude yang **diam di prompt**: beku pada 1787413880 → **317 dtk** dan terus.

Pemisahannya 0 dtk vs 317 dtk. Tak ada teks yang perlu diparse, tak ada pola TUI yang berubah tiap
rilis agen, dan berlaku sama untuk claude maupun codex.

### Temuan 3.2 — `window_activity` tetap berdetak tanpa klien tmux terpasang

Kekhawatiran yang wajar: hanoman baru memasang klien tmux saat ada yang menonton. Diuji pada socket
terpisah, **nol klien**:

```
$ tmux -L hnm903test new-session -d -s probe "while :; do printf .; sleep 0.5; done"
$ tmux -L hnm903test list-clients -F '#{client_name}'     → (kosong)
now=1787414367 act=1787414367
now=1787414369 act=1787414368
now=1787414371 act=1787414370
now=1787414373 act=1787414372
```

Berdetak. Lag ≤ 1 dtk (pembulatan detik + cadence 0,5 dtk) — itu batas bawah ambang yang dipakai.

Struktur sesi hanoman: satu window, satu pane (`list-windows -a` → `panes=1` untuk keempat sesi
hidup), jadi `#{window_activity}` == aktivitas pane.

### Temuan 3.3 — biaya tambahan terukur ≈ 0

50 invokasi `list-panes -a -F …` atas 4 pane, dua putaran:

| format | ms/panggilan |
|---|---|
| `FMT` hari ini | 4,12 / 4,12 |
| `FMT` + `#{window_activity}` + `#{C/ri:enter to (select\|confirm)}` | 4,33 / 4,38 |

Selisih +0,21 ms untuk **dua** variabel tambahan, termasuk pencarian isi pane. Dengan hanya
`#{window_activity}` (yang akhirnya dipakai) selisihnya di bawah resolusi ukur. Batas (1) terpenuhi
dan terukur, bukan diasumsikan.

### Temuan 3.4 — `#{C/ri:}` bekerja di tmux 3.7b, tapi tidak dipakai

tmux 3.7b mendukung `#{C/ri:pola}` (man tmux baris 3204: "‘C’ performs a search for a glob(7)
pattern or regular expression in the pane content"). Diuji, hasilnya nomor baris:

```
$ tmux -L hanoman list-panes -a -F '#{session_name} dlg=#{C/ri:enter to (select|confirm)}'
hanoman-spec-902 dlg=0
```

Godaannya: memakai footer dialog sebagai gerbang positif "ini memang menunggu". **Ditolak.**
Alasannya arah kegagalannya salah: sesudah manusia memilih opsi, footer dialog bisa masih terlihat
di layar sementara agen sudah kembali bekerja — persis jalur (a), jalur utama laporan ini — dan
gerbang itu justru akan menahan pil tetap menyala. Keuntungannya (background task yang mencetak
selagi dialog terbuka) jarang dan sudah dijaring notifikasi `decision` yang lahir lebih dulu.

Dicatat di sini supaya keputusan menolaknya tak perlu ditemukan ulang.

### Temuan 3.5 — sudah ada preseden gerbang pane, di pintu lead

`lead/detect.ts:293` tak pernah mempercayai marker sendirian: ia membaca pane
(`readPaneQuestion`) dan menolak sesi yang layarnya berakhir pada baris giliran agen
(`lead/pane.ts:47` `AGENT_TURN_LINE`, SPEC-487 — pemisahan terukur 6/6 vs 0/16). Jadi "marker
digerbangi keadaan pane" bukan konsep baru di basis kode ini; yang belum dilakukan adalah
menerapkannya pada bit `decision` itu sendiri.

`AGENT_TURN_LINE` **tak bisa** dipakai apa adanya untuk pil: ia juga cocok dengan baris giliran yang
*baru selesai* (`✻ Cooked for 40m 4s`, tetap di layar) — dan sesi yang baru selesai giliran memang
sedang menunggu manusia. Untuk pintu lead itu benar ("jangan ketik ke sana"); untuk pil itu salah.

## 4. Hipotesis dan bentuk perbaikan

> **Hipotesis:** `decision` menyala pada sesi yang bekerja semata-mata karena ia membaca marker
> tanpa gerbang. Menggerbanginya dengan "pane sudah diam ≥ 3 dtk" memadamkan pil pada keempat
> jalur sekaligus, untuk claude maupun codex, tanpa satu pun invokasi tmux tambahan.

Bentuknya:

```
decision  = !exited && markerFilled(f) && paneQuiet(window_activity)
paneQuiet = window_activity tak terbaca            → true   (fail-open = perilaku hari ini)
          | now - window_activity >= PANE_QUIET_MS → true
```

`PANE_QUIET_MS = 3000` — 3× margin di atas jeda keluaran maksimum terukur (≤ 1 dtk) dan di atas lag
pembulatan detik (≤ 1 dtk).

**Arah gagalnya sengaja fail-open:** ragu → pil tetap menyala (perilaku hari ini). Pil yang menyala
kelewat lama itu mengganggu; pil yang padam saat ada pertanyaan sungguhan membuat manusia
kehilangan pertanyaannya — kegagalan yang jauh lebih mahal.

### Kenapa marker TIDAK boleh ikut dihapus saat pane sibuk

Godaan berikutnya: sekalian kosongkan marker saat pane terbaca sibuk, supaya onset ikut segar.
**Ditolak, dan ini penting.** `Notification` claude mengisi marker **sekali per dialog** dan tak
pernah menembak lagi (terukur, `lead/detect.ts:300-305`). Bila satu keluaran latar belakang membuat
kita menghapus marker sementara dialognya masih terbuka, pertanyaan itu **hilang selamanya** dari
pil, pet, notifikasi, dan panel lead. Marker tetap sinyal masuk yang durable; yang berubah hanya
cara membacanya.

Penghapusan marker hanya ditambahkan pada jalur yang memang bukti positif manusia sudah menjawab:
`POST /terminal/sessions/:id/dialog/answer` (batas (5) backlog) — kembaran `UserPromptSubmit` untuk
jalur SPEC-899.

### `decisionAt` harus ikut diturunkan, atau ia berbohong

ADR-0141: isi marker = epoch onset, ditulis sekali. Dengan `decision` menjadi turunan, satu episode
marker bisa memuat beberapa episode menunggu (menunggu → dijawab di TUI → agen bekerja → agen diam
lagi). `decisionAt` yang tetap menunjuk onset marker akan melaporkan "menunggu 40 menit" untuk
tunggu yang baru berumur 1 menit, dan `PET_URGENT_MS` (10 menit) akan menjerit palsu.

Waktu mulai episode menunggu yang sekarang **adalah** `window_activity`: detik terakhir pane
mengeluarkan sesuatu. Jadi:

```
decisionAt = ISO(max(onset di marker, window_activity))
```

Isi marker tetap "epoch onset, ditulis sekali" — semantik ADR-0141 tak disentuh. Yang berubah hanya
turunannya, di bawah ADR baru. Bonus: marker pra-ADR-0141 (isi `waiting`, seperti dua marker di §1)
yang hari ini memberi `decisionAt: undefined` kini punya jawaban yang benar.

## 5. Cakupan perubahan

| berkas | perubahan |
|---|---|
| `server/src/services/pty.ts` | `FMT` += `#{window_activity}`; `Pane.activityAt`; `PANE_QUIET_MS` + `paneQuiet()`; `decision` & `decisionAt` turunan; `liveDecisions()` mengembalikan `waiting` |
| `server/src/services/notifications.ts` | `scanDecisions` menotifikasi saat `waiting`, dedup tetap dikunci pada marker terisi (supaya kedipan tak melahirkan notifikasi kedua) |
| `server/src/routes/lead.ts` | daftar `waiting` panel lead memakai bit turunan |
| `server/src/routes/terminal.ts` | `dialog/answer` mengosongkan marker saat jawaban diterima |
| `internal/docs/adr/0143-*.md` | ADR baru (batas (6) backlog) + catatan amandemen di ADR-0141 |
| `internal/docs/architecture/api-contract.md`, `internal/docs/frontend/frontend-implementation.md` | arti `decision`/`decisionAt` |

**Tidak** disentuh:

- `lead/detect.ts` — pintu lead sudah punya gerbang pane sendiri yang lebih kuat (SPEC-487,
  `AGENT_TURN_LINE`); menumpuk gerbang kedua di sana hanya menambah risiko tanpa menutup jalur baru.
- Prioritas lead (`deciding` menang, ADR-0091) dan gerbang SPEC-433 (`finished`/`complete` menang) —
  keduanya hidup di frontend di atas `decision`, jadi tetap berlaku apa adanya (batas (4)).
- Skema/DTO — `decision: boolean` tak berubah bentuk, hanya artinya. Nol migrasi, nol dampak sync.
- `TerminalScreen` dan `pet-state` — keduanya membaca `session.decision` yang sama, jadi memperbaiki
  sumbernya memperbaiki keduanya serentak. Batas (2) terpenuhi **secara konstruksi**, bukan lewat
  dua tambalan yang harus dijaga tetap sama.

## 6. Keputusan pasca-audit

**Spec → Plan → Execute penuh.** Bukan tambalan sepele: arti sebuah status yang dibaca empat
permukaan (terminal, pet, notifikasi, panel lead) berubah, backlog sendiri menuntut ADR baru
(batas (6)), dan `decision` menjadi bergantung waktu — yang mengubah cara test-nya harus ditulis.

## 7. Lampiran — perintah verifikasi

```bash
# pemisahan bekerja vs diam
for i in $(seq 1 24); do printf "%s " "$(date +%s)"; \
  tmux -L hanoman list-panes -a -F '#{session_name}=#{window_activity}' | tr '\n' ' '; echo; sleep 1; done

# detak tanpa klien
tmux -L probe new-session -d -s p "while :; do printf .; sleep 0.5; done"
tmux -L probe list-clients -F '#{client_name}'          # kosong
tmux -L probe list-panes -a -F '#{window_activity}'

# biaya format
time (for i in $(seq 1 50); do tmux -L hanoman list-panes -a -F "$FMT" >/dev/null; done)
```

---

## Adendum 2026-08-23 — 9 gagal "pra-ada" di `terminal.route.test.ts` ditelusuri sampai akar

Laporan verifikasi SPEC-903 menyebut berkas ini punya **21 gagal pra-ada** (9 sesudah `NODE_ENV`
dibersihkan). Keduanya kini **nol**; keduanya punya akar yang bisa diperbaiki di repo, bukan sekadar
"lingkungan mesin ini".

### Akar A — `HANOMAN_SHELL` yang tertinggal membuang perintah agen tanpa satu pun error

Gejalanya 7 timeout 5000 ms + 2 × `expected 400 to be 201`. Semua test-nya **lulus bila dijalankan
sendirian**, jadi ini pencemaran urutan, bukan cacat produk. Bisect atas `-t` per-describe
menunjuk satu pencemar: `terminal routes · shell non-claude (SPEC-236)`.

Rantainya:

1. Tiga test di describe itu menyetel `process.env.HANOMAN_SHELL = fake-shell.sh` dan **tak pernah
   memulihkannya** (satu lagi di ujung berkas, describe SPEC-742).
2. `createSession` memasang `set-option -g default-shell $(shellBin())` — opsi **global** tmux —
   pada SETIAP kelahiran sesi (`server/src/services/pty.ts`).
3. `server/test/fixtures/fake-shell.sh` berbunyi `echo "SHELL-BIASA-SIAP"; exec cat`: ia
   **mengabaikan argumennya**. tmux menyerahkan seluruh baris perintah agen ke `default-shell`, jadi
   perintah itu dibuang diam-diam.
4. Hasilnya pane yang **hidup dan sehat** tapi isinya bukan prompt agen. Setiap test yang menunggu
   teks prompt karena itu menggantung sampai batas 5 dtk, dan dua test breakdown gagal 400 sebagai
   kaskade dari worktree/state yang ditinggalkan test-test gagal itu.

Diverifikasi langsung, bukan disimpulkan:

```
$ /tmp/…/t.sh terminal.route.test.ts -t "^terminal routes (· shell non-claude|· sesi backlog)"
      Tests  4 failed | 17 passed        # backlog SENDIRIAN: 16 passed
$ tmux -L hanoman-t903 show-options -g default-shell
default-shell …/server/test/fixtures/fake-shell.sh
```

Perbaikannya memulihkan env-nya, bukan menambal test-test korbannya: satu `restoreShell()` di
tingkat berkas, dipanggil dari `afterAll` describe SPEC-236 (melindungi sisa berkas) **dan** dari
`afterAll` tingkat berkas — run ber-`--no-file-parallelism` berbagi satu proses, jadi env yang
tertinggal menyeberang ke berkas test berikutnya.

Uji mutasi: hapus `afterAll(restoreShell)` → **tepat 9 gagal itu kembali**. 81/81 dengan perbaikannya.

### Akar B — `NODE_ENV` warisan shell menjatuhkan tiap test WebSocket jadi 401

12 gagal sisanya (21 → 9) bukan kelemahan mesin: shell sesi hanoman mengekspor
`NODE_ENV=development`, dan `revalidateWsPrincipal` (`server/src/services/ws-admission.ts`) menerima
principal `test` **hanya** saat `NODE_ENV === "test"`. Vitest sendiri hanya `NODE_ENV ??= "test"`,
jadi nilai warisan menang.

Dipatok di `server/vitest.config.ts` — tempat yang sudah memagari `HANOMAN_TMUX_SOCKET` (SPEC-861)
dan `HANOMAN_UPDATE_FETCH` (SPEC-215) untuk kelas masalah yang sama. `=`, bukan `??=`, tepat karena
warisan itulah yang harus kalah. Test yang memang menguji nilai NODE_ENV lain menyuntikkannya
sebagai **argumen** (`assertRuntimeBoundary({ NODE_ENV: … })`) atau memulihkannya sendiri
(`static.test.ts`), jadi tak ada yang tersinggung.

Terukur dengan `NODE_ENV=development` sengaja diwariskan: `terminal.route.test.ts` **81/81**, dan
lima berkas WS lain (`events-ws`, `events-ws-default-origin`, `sync-ws`, `events.route`,
`terminal-input-order`) 11/11.
