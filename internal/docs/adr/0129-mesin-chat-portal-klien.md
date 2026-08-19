# ADR-0129 — Mesin chat portal klien: sesi agen tersandbox di workspace dokumen, empat lapis penjagaan

- Status: accepted
- Tanggal: 2026-08-19
- Konteks: SPEC-854
- Mengamandemen: [ADR-0111](0111-portal-klien-kirim-tiket.md) — permukaan klien kini punya **tiga**
  bentuk path tulis, bukan satu. Sifat deny-by-default ADR-0110 tetap berlaku apa adanya.
- Menegakkan: [ADR-0110](0110-portal-klien-read-only.md) (deny-by-default, scope per project) ·
  [ADR-0041](0041-prd-sebagai-dokumen-flow-project-level.md) (PRD adalah dokumen) ·
  [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md) (sandbox sesi
  produksi) · [ADR-0037](0037-cabut-guardrail-safety.md) (isolasi lewat batas, bukan
  lewat daftar larangan) · [ADR-0107](0107-paginasi-seragam-daftar-dashboard.md)
- Tidak mencabut apa pun. Help Center tak disentuh.

## Konteks

Portal klien punya dua permukaan: **membaca** (backlog, tiket — ADR-0110) dan **mengantre**
(Help Center = tiket ke manusia — ADR-0111). Yang hilang adalah **percakapan**: klien tak bisa
memikirkan idenya bersama hanoman, dan tak bisa mendapat jawaban saat itu juga soal projectnya
sendiri.

Satu kalimat menentukan seluruh bentuknya: **klien bukan operator**. Klien tak boleh berinteraksi
langsung dengan runtime agen. Harus ada lapisan penjagaan milik hanoman di antara klien dan
runtime — klien berbicara ke hanoman, hanoman yang berbicara ke mesin.

## Yang diukur lebih dulu

Empat percobaan atas `claude` 2.1.235 apa adanya, satu variabel per percobaan, sebelum satu baris
kode ditulis:

| # | Percobaan | Hasil |
|---|---|---|
| 1 | `--tools "Read,Glob,Grep"`, cwd = workspace berisi satu `.md` | Berkas **terbaca** tanpa prompt izin; print mode tak menggantung |
| 2 | Sama, minta `/etc/passwd` + `CLAUDE.md` repo + `~/.claude/CLAUDE.md` | **3/3 DITOLAK**, ketiganya muncul di `permission_denials` keluaran JSON |
| 3 | Sama, minta `../rahasia-luar.txt` lewat 7 cara (Read relatif, Read absolut, Glob `../*.txt`, Glob absolut, Grep `..`, Grep absolut, Glob `**`) | **7/7 DITOLAK**; yang sampai ke tool tercatat di `permission_denials` |
| 4 | `--tools ""`, cwd = **root repo hanoman** | Agen mengaku tahu "hanoman codebase / spec di memori". cwd = `mktemp -d` → "**TIDAK ADA**" |

Tiga konsekuensi yang mengikat desain:

1. **Containment cwd itu nyata dan gratis.** Read/Glob/Grep tak bisa keluar dari cwd — tanpa
   podman, tanpa `--dangerously-skip-permissions`. Itulah yang membuat "worktree khusus portal"
   punya arti teknis, bukan sekadar nama.
2. **cwd wajib workspace bersih.** Percobaan 4 membuktikan cwd yang menunjuk repo produk
   membocorkan isi dalam hanoman lewat CLAUDE.md/auto-memory — bahkan dengan **nol** tool.
3. **Agen tak boleh jadi satu-satunya penjaga, dan itu terukur.** Di percobaan 3 agen menolak
   semuanya tapi **menyebut path absolut workspace di dalam prosanya**; pada percobaan `--tools ""`
   ia menjawab dengan blok berpagar `bash`; dan bahkan run terbersih tetap melihat `userEmail`
   operator dari system-reminder milik claude sendiri. Ketiganya pelanggaran huruf E yang **tak
   satu pun** bisa ditutup oleh prompt.

## Keputusan

### 1. Sesi agen tersandbox — bukan panggilan model langsung

Repo tak punya SDK Anthropic sama sekali, dan audit SPEC-472 sudah membuktikan `ANTHROPIC_API_KEY`
di env server adalah **bahaya hidup** (ia menolak seluruh keputusan lead 401 di panggilan API
pertama). Memanggil model langsung berarti dependency baru + kredensial baru + permukaan tagihan
baru. Chat portal karena itu menumpang jalur agen CLI yang sudah ada, lewat titik spawn yang sudah
sadar-sandbox (`services/lead/brain.ts`, satu-satunya di luar `pty.ts`).

### 2. "Sesi" berarti percakapan milik hanoman — bukan pane tmux

Menstreamkan PTY ke browser klien sama dengan menyerahkan terminal agen: klien akan mengetik
keystroke mentah ke TUI. Itu membalik kalimat kunci brief dan melanggar syarat "klien tak punya
jalan menjalankan apa pun". Tiap giliran karena itu adalah **proses berumur pendek** — satu
request, satu jawaban, tanpa tmux dan tanpa PTY.

Riwayat **diputar ulang dari rekaman hanoman sendiri** (`PortalChatMessage`), bukan lewat
`--resume`. Dengan begitu satu-satunya sumber kebenaran percakapan adalah tabel yang sama yang
dibaca operator, tak ada state agen di disk yang tak bisa diaudit, dan pengujiannya tak butuh
proses.

### 3. Empat lapis, masing-masing bisa diuji sendiri

```
klien ──▶ [1 gerbang masukan] ──▶ [2 workspace dokumen] ──▶ [3 argv + sandbox] ──▶ agen
                                                                    │
klien ◀── [4 gerbang keluaran] ◀────────────────────────────────────┘
```

**Lapis 1 — `portal-chat/guard-input.ts`.** Pesan klien hidup di dalam satu blok berbatas
ber-nonce **acak per giliran**, dan penanda batas yang muncul di dalam pesan disisipi spasi
lebar-nol sehingga klien tak punya cara menutup bloknya sendiri. Penanda tetap akan ada di dalam
jangkauan tebakan; menebaknya sekali cukup untuk keluar. Giliran klien di **riwayat** ikut
dibungkus — pesan lama sama tak dipercayainya dengan pesan baru.

**Lapis 2 — `portal-chat/workspace.ts`.** Direktori temp mode 0700 yang **dibangun server**, berisi
HANYA proyeksi yang sudah boleh dibaca klien: `project.md`, `pekerjaan.md` (`liveSpecs` →
`toPortalSpec`), `laporan.md` (`toPortalTicket`), `catatan-rilis.md` (`Changelog`), dan
`dokumen/<slug>.md` (PRD project, bila `repoDir` ada). **Tanpa satu baris source code.**

Ini BUKAN git worktree project: `repoDir` sering null (project clone/hub) dan worktree produk
memuat kode. Proyeksinya dipakai ulang dari `@hanoman/shared`, bukan query kedua yang kebetulan
sepakat — dari situ lahir invarian yang diuji langsung: **apa pun yang bisa dikatakan agen berasal
dari berkas di sini, dan berkas di sini tak pernah memuat isi project lain.** Workspace dibangun
ulang tiap giliran lalu dihapus; tak ada state di disk.

**Lapis 3 — `portal-chat/argv.ts`.** Wajib ada: `-p` · `--tools "Read,Glob,Grep"` ·
`--setting-sources ""` · `--strict-mcp-config` · `--disable-slash-commands` ·
`--no-session-persistence` · `--system-prompt` · `--output-format json` · `--json-schema`.
Wajib **tak ada**: `--dangerously-skip-permissions`, `--add-dir`, `--mcp-config`, `--worktree`,
`--settings`, `--agents`, `--resume`, dan 15 lainnya di `FLAG_TERLARANG`. Test mengadu argv
**dua arah** — yang ada dan yang tak pernah boleh ada.

**Lapis 4 — `portal-chat/guard-output.ts`.** Balasan datang sebagai objek tervalidasi
`--json-schema`; sebelum menyentuh klien ia melewati dua tingkat: **redaksi** (span kode inline
jadi teks biasa) dan **tolak total** (blok kode berpagar, path absolut, email, nama berkas, istilah
teknis, perintah shell, potongan konfigurasi, jejak galat, dan **nama/id project mana pun selain
milik klien**). Yang ditolak diganti kalimat **karangan server**; mentahnya disimpan untuk
operator dan tak pernah dikirim.

### 4. Teks penolakan selalu dikarang server

`keluar_topik: true` maupun balasan yang tertolak gerbang dijawab dengan kalimat dari
`TEKS_TETAP` (`@hanoman/shared`), bukan prosa agen. Kalau teks penolakan boleh datang dari agen,
pesan yang disusupi bisa mengarang penolakannya sendiri — dan itu persis jalur yang ditutup.

### 5. Tiga bentuk path tulis, dinyatakan persis (idiom ADR-0111)

`POST …/chat/sessions` dan `POST …/chat/sessions/:sid/messages` ditambahkan ke
`clientRouteAllowed` sebagai **bentuk path**, bukan sebagai "portal boleh POST".
`POST …/sessions/:id/prd` (materialisasi PRD) sengaja **tidak** ada di sana — itu keputusan
operator, bukan klien.

### 6. PRD hasil brainstorming = draft di baris sesi, dimaterialisasi operator

`prdMarkdown` + `prdReadyAt` di `PortalChatSession`, muncul di dashboard dengan asal yang terbaca
(sesi mana, kapan, dari akun klien mana). **Tak ada backlog yang lahir dan tak ada pekerjaan yang
terpicu.** Aksi klien tak boleh menulis ke checkout git operator (bisa kotor / bentrok sesi lain),
dan project ber-`repoDir` null tetap harus bisa menghasilkan PRD. ADR-0041 tetap utuh — PRD yang
**dimaterialisasi** tetap dokumen `docs/prd/<slug>.md`.

## Konsekuensi

- Klien mendapat percakapan tanpa satu pun jalan ke runtime, worktree, shell, atau tool tulis.
- Keempat lapis adalah **fungsi murni** di sekitar satu panggilan proses, jadi huruf E bisa
  dibuktikan tanpa memanggil agen sekali pun.
- Kuota chat menumpang langganan yang sama dengan sesi pekerja — akunting terpisah tidak ada,
  sama seperti lead (ADR-0091 OQ-1). Yang membatasinya adalah jatah bulanan ([ADR-0130](0130-kuota-chat-portal-klien.md)).
- Satu giliran memanggil satu proses agen penuh; latensinya puluhan detik, dan UI harus
  mengatakannya alih-alih terlihat menggantung.

## Gotcha

1. **cwd wajib workspace bersih.** cwd = repo produk membocorkan isi dalam hanoman lewat
   CLAUDE.md/auto-memory — terukur, bahkan dengan nol tool. Jangan pernah menjalankan giliran chat
   dengan cwd repo, worktree sesi, atau `$HOME`.
2. **Gerbang keluaran bukan kehati-hatian.** Ia menutup tiga kebocoran yang agen benar-benar
   produksi sendiri: blok kode berpagar, path absolut workspace, dan email operator dari
   system-reminder claude. Melonggarkannya = membuka kembali ketiganya.
3. **Urutan di dalam gerbang keluaran mengikat.** Pola diadu ke teks **mentah**; menjalankan
   redaksi span inline lebih dulu membuat dua backtick pertama runtuh jadi kosong sehingga pagar
   ``` lolos **justru karena dibersihkan**. Terukur saat implementasi.
4. **Fail-closed di produksi — kebalikan jalur pty.** `sandboxArgvFromEnv` mengembalikan `null`
   saat `HANOMAN_SESSION_SANDBOX` kosong (default dev `off`), jadi sesi pty di luar produksi jatuh
   ke `claude --dangerously-skip-permissions` penuh. Chat portal **menolak jalan** di
   `NODE_ENV=production` tanpa sandbox. Jangan menyeragamkan keduanya "demi konsistensi" — arah
   defaultnya memang sengaja berbeda.
5. **Khusus claude.** `--tools` tak punya padanan di `codex exec`, yang bentuk one-shot-nya hanya
   `--dangerously-bypass-approvals-and-sandbox`. Karena itu `Setting.portalChat` **tidak** punya
   field `agent`; menawarkan pilihan agen = menjanjikan penjagaan yang separuhnya tak bisa
   ditegakkan.
6. **`PORTAL_CHAT_REPLY_SCHEMA` ditulis tangan** dan `additionalProperties: false`. Generator
   zod→JSON Schema tak menjamin properti itu, dan tanpa itu agen bisa menyelipkan field yang tak
   pernah dibaca siapa pun. `shared/src/portal-chat.test.ts` mengadu daftar kuncinya ke zod.
7. **`permission_denials` adalah sinyal, bukan sampah.** Ia satu-satunya cara operator melihat
   percobaan keluar workspace tanpa menebak. Disimpan sebagai `escapeAttempts`.
8. **Kedua model LOCAL-only** — tak masuk `SYNCED` maupun `WEBHOOK_ENTITIES` (cermin
   `ClientProjectAccess`), tetapi **wajib** masuk `PG_ORDER`; `cli/test/migrate-pg.test.ts`
   mengadunya ke DMMF.
