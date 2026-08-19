# SPEC-854 — Portal klien: sesi chat brainstorming & tanya-jawab berkuota, termediasi hanoman

- Tanggal: 2026-08-19
- Backlog: SPEC-854 (sumber `brief`, prioritas tinggi)
- ADR yang lahir: **ADR-0129** (mesin chat portal) · **ADR-0130** (kuota chat portal)
- Menegakkan: ADR-0110 (portal deny-by-default) · ADR-0111 (satu bentuk path tulis) ·
  ADR-0041 (PRD adalah dokumen) · ADR-0117 (boundary deployment publik) · ADR-0037 (isolasi
  worktree) · ADR-0107 (paginasi seragam)

## Masalah

Portal klien hari ini hanya bisa **membaca** (backlog, tiket) dan **mengantre** (Help Center =
tiket ke manusia, ADR-0111). Yang hilang adalah percakapan: klien tak bisa memikirkan idenya
bersama hanoman, dan tak bisa mendapat jawaban saat itu juga soal projectnya sendiri.

Yang menentukan seluruh bentuk fitur: **klien bukan operator**. Klien tak boleh berinteraksi
langsung dengan runtime agen. Harus ada lapisan penjagaan milik hanoman di antara klien dan
runtime — klien berbicara ke hanoman, hanoman yang berbicara ke mesin.

## Keputusan mesin: sesi agen tersandbox di workspace dokumen (ADR-0129)

Dipilih kandidat (a) dari brief — sesi agen tersandbox — dengan bentuk yang **dibuktikan dari sisi
hanoman**, bukan diasumsikan dari perilaku agen.

### Yang diukur lebih dulu

Empat percobaan atas `claude` 2.1.235 apa adanya, satu variabel per percobaan:

| # | Percobaan | Hasil |
|---|---|---|
| 1 | `--tools "Read,Glob,Grep"`, cwd = workspace berisi satu `.md` | Berkas **terbaca** tanpa prompt izin. Print mode tak menggantung. |
| 2 | Sama, minta `/etc/passwd` + `CLAUDE.md` repo + `~/.claude/CLAUDE.md` | **3/3 DITOLAK**, ketiganya muncul di `permission_denials` keluaran JSON |
| 3 | Sama, minta `../rahasia-luar.txt` lewat 7 cara (Read relatif, Read absolut, Glob `../*.txt`, Glob absolut, Grep `..`, Grep absolut, Glob `**`) | **7/7 DITOLAK**, kelimanya yang sampai ke tool tercatat di `permission_denials` |
| 4 | `--tools ""`, cwd = **root repo hanoman** | Agen mengaku tahu "hanoman codebase / spec di memori". cwd = `mktemp -d` → "**TIDAK ADA**" |

Tiga konsekuensi yang mengikat desain:

1. **Containment cwd itu nyata dan gratis.** Read/Glob/Grep tak bisa keluar dari cwd — tanpa
   podman, tanpa `--dangerously-skip-permissions`. Itulah yang membuat "worktree khusus portal"
   punya arti teknis, bukan sekadar nama.
2. **cwd wajib workspace bersih.** Percobaan 4 membuktikan cwd yang menunjuk repo produk
   membocorkan isi dalam hanoman lewat CLAUDE.md/auto-memory, bahkan dengan nol tool.
3. **Agen tak boleh jadi satu-satunya penjaga — terukur.** Di percobaan 3 agen menolak semuanya
   tapi **menyebutkan path absolut workspace di dalam prosanya**; di percobaan awal `--tools ""`
   ia menjawab dengan blok ```` ```bash ````; dan bahkan run terbersih tetap melihat
   `userEmail` operator dari system-reminder milik claude sendiri. Ketiganya pelanggaran huruf E
   yang **tak satu pun** bisa ditutup oleh prompt.

### Kenapa bukan sesi tmux/PTY

"Sesi" di sini berarti **percakapan yang dimiliki hanoman dan direkam hanoman**, bukan pane tmux.
Menstreamkan PTY ke browser klien sama dengan menyerahkan terminal agen — melanggar huruf E
("klien tak punya jalan menjalankan apa pun") dan membalik kalimat kunci brief. Tiap giliran
karena itu adalah **proses agen berumur pendek** di workspace tersandbox, dipanggil lewat titik
spawn yang sudah ada (`services/lead/brain.ts`) — satu-satunya titik spawn agen di luar `pty.ts`,
yang sudah sadar-sandbox.

### Empat lapis, masing-masing bisa diuji sendiri

```
klien ──▶ [1 gerbang masukan] ──▶ [2 workspace dokumen] ──▶ [3 argv + sandbox] ──▶ agen
                                                                    │
klien ◀── [4 gerbang keluaran] ◀────────────────────────────────────┘
```

**Lapis 1 — gerbang masukan** (`portal-chat/guard-input.ts`, fungsi murni).
Pesan klien dibungkus blok berbatas ber-nonce dan diperlakukan sebagai **bahan**, bukan perintah.
Penanda batas yang muncul di dalam pesan di-escape sehingga klien tak bisa menutup bloknya
sendiri. Ada batas panjang.

**Lapis 2 — workspace dokumen** (`portal-chat/workspace.ts`).
Direktori temp mode 0700 yang **dibangun server**, berisi HANYA proyeksi yang sudah boleh dibaca
klien:

| Berkas | Sumber | Sudah client-facing? |
|---|---|---|
| `project.md` | `toPortalProject` + `Project.desc` | ya (ADR-0110) |
| `pekerjaan.md` | `liveSpecs({project}).map(toPortalSpec)` | ya (ADR-0110) |
| `laporan.md` | tiket project ini via `toPortalTicket` | ya (ADR-0110) |
| `catatan-rilis.md` | `Changelog` project ini | ya (SPEC-519) |
| `dokumen/<slug>.md` | `docs/prd/*.md` via `readPrd` (kalau `repoDir` ada) | dokumen produk |

**Tanpa satu baris source code.** Invariannya bisa diuji langsung: himpunan berkas yang ditulis
== allowlist di atas, dan tiap berkas berasal dari proyeksi yang scope-nya sudah dijaga
`hasProjectAccess`. Workspace dibangun ulang tiap giliran lalu dihapus — tak ada state di disk.

**Lapis 3 — argv & sandbox** (`portal-chat/argv.ts`, fungsi murni).
Wajib ada: `-p` · `--tools "Read,Glob,Grep"` · `--setting-sources ""` · `--strict-mcp-config` ·
`--disable-slash-commands` · `--no-session-persistence` · `--system-prompt` ·
`--output-format json` · `--json-schema`.
Wajib **tak ada**: `--dangerously-skip-permissions` · `--add-dir` · `--mcp-config` · `--worktree`
· tool tulis/shell/jaringan apa pun. Test mengadu **keduanya** — yang ada dan yang tak ada.
Di atasnya, `sandboxArgvFromEnv({ worktreeMode: "ro" })` dipakai bila sandbox terkonfigurasi;
di `NODE_ENV=production` chat portal **menolak jalan** tanpa sandbox (fail closed), sejalan
`assertRuntimeBoundary`.

Chat portal **khusus claude**: gerbang tool di atas adalah flag claude, dan
`codex exec` di `leadArgv` hanya punya bentuk bypass-penuh. Settings karena itu memaparkan
model+effort saja, tanpa pilihan agen.

**Lapis 4 — gerbang keluaran** (`portal-chat/guard-output.ts`, fungsi murni).
Balasan agen datang sebagai objek tervalidasi `--json-schema`:

```jsonc
{ "balasan": string, "keluar_topik": boolean, "prd_siap": boolean,
  "prd": string | null, "ringkasan": string }
```

Sebelum menyentuh klien, `balasan` melewati dua tingkat:

- **Redaksi** — span kode inline, path absolut, dan penyebutan nama berkas dibersihkan.
- **Tolak total** — blok kode berpagar, jejak galat, potongan konfigurasi (`FOO=bar`), perintah
  shell, kata kunci SQL/tabel, alamat email, dan **nama/id project mana pun selain milik klien**
  → seluruh balasan diganti kalimat sopan **karangan server**, balasan mentahnya disimpan untuk
  operator dan tak pernah dikirim.

`keluar_topik: true` juga dijawab dengan kalimat **karangan server**, bukan prosa agen: dengan
begitu pesan yang disusupi tak bisa mengarang teks penolakannya sendiri.

`prd` **tidak** melewati gerbang klien — ia dokumen untuk operator dan tak pernah dikirim ke
portal.

## Dua tipe sesi

| | Brainstorming | Bertanya |
|---|---|---|
| Tujuan | menggali ide klien secara aktif | menjawab soal project klien |
| Gaya | ala skill `grilling` (menantang asumsi, menajamkan lingkup) dengan bekal dokumen | menjawab langsung dari dokumen |
| Keluaran | **PRD berstatus draft** | jawaban di percakapan |
| Kuota | jatah sendiri | jatah sendiri |

Tipe dipilih klien saat memulai sesi dan **tak bisa diubah** sesudahnya — ia menentukan prompt,
keluaran, dan ember kuota yang terpakai.

## PRD draft (huruf B)

PRD tersimpan di baris sesi (`prdMarkdown`, `prdReadyAt`), berstatus **draft**, muncul di layar
PRD dashboard operator dengan asal yang terbaca: *dari portal klien · sesi `<id>` · `<tanggal>` ·
`<email klien>`*. **Tak ada** backlog yang lahir dan **tak ada** pekerjaan yang terpicu.

Materialisasi jadi `docs/prd/<slug>.md` adalah **aksi operator** (`POST /api/portal-chat/
sessions/:id/prd`), bukan efek samping percakapan. Dua alasan: aksi klien tak boleh menulis ke
checkout git operator (bisa kotor / bentrok sesi lain), dan project ber-`repoDir` null tetap harus
bisa menghasilkan PRD. ADR-0041 tetap utuh — PRD yang **dimaterialisasi** tetap dokumen.

## Kuota (ADR-0130, huruf C)

Nilainya di Settings, blok `Setting.portalChat` — kolom `Setting.data` bertipe `Json` sehingga
**tanpa migration**, cermin `scheduler`/`goal`/`conflict`/`lead`:

```ts
{ enabled: false, brainstormPerMonth: 2, askPerMonth: 30,
  model: "claude-opus-5", effort: "high", timeoutSec: 180 }
```

Jatahnya **dihitung per project × per tipe × per periode**, bukan per akun. Itu yang menutup
"beberapa akun klien di project yang sama". Kunci periode `periodKey = "YYYY-MM"` (UTC)
**disimpan di baris sesi saat lahir** — bukan dihitung ulang saat dibaca — sehingga perilaku
sesudah reset bisa diuji dengan menyisipkan baris ber-`periodKey` lain, tanpa memalsukan jam.

Yang menghabiskan jatah adalah **memulai sesi**, bukan mengirim pesan: membuka banyak tab atau
memuat ulang halaman tak menambah apa pun karena tak ada sesi baru yang lahir. Pemeriksaan dan
penulisan baris terjadi dalam satu `$transaction` (SQLite menyerialkan tulisan; server
single-process, asumsi yang sama dengan `help-ratelimit`).

Klien melihat sisa jatah dan tanggal reset dengan **bahasa biasa** di permukaan chat — bukan
pesan galat, dan bukan hanya saat gagal. Operator membaca angka yang sama di dashboard.

## Rekaman & ringkasan (huruf D)

`PortalChatMessage { sessionId, seq, role: "klien"|"hanoman", text, blocked, blockReasons }`.
Berurutan lewat `seq`; terikat project, akun klien, dan tipe lewat sesi induknya. Balasan yang
**ditolak gerbang** tetap tersimpan dengan teks mentahnya + alasannya — itu justru baris yang
paling ingin dibaca operator.

`ringkasan` diperbarui tiap giliran dari keluaran terstruktur, jadi sesi bisa dibaca cepat tanpa
membuka seluruh percakapan.

Pengambilan untuk training: `GET /api/portal-chat/export?project=&from=&to=` (operator saja)
mengembalikan transkrip lengkap.

## Kontrak API

Klien — dibuka di `clientRouteAllowed` sebagai **bentuk path yang persis**, idiom ADR-0111
(bukan "portal boleh POST"):

```
GET  /api/portal/projects/:id/chat            → kuota + sisa + tanggal reset
GET  /api/portal/projects/:id/chat/sessions   → daftar sesi (paginated, ADR-0107)
POST /api/portal/projects/:id/chat/sessions   → mulai sesi { type }        ← tulis #2
GET  /api/portal/projects/:id/chat/sessions/:sid → sesi + pesan (paginated)
POST /api/portal/projects/:id/chat/sessions/:sid/messages → satu giliran   ← tulis #3
```

Operator:

```
GET  /api/portal-chat/sessions?project=       → daftar + ringkasan + kuota
GET  /api/portal-chat/sessions/:id            → transkrip + PRD draft + percobaan keluar
POST /api/portal-chat/sessions/:id/prd        → materialisasi docs/prd/<slug>.md
GET  /api/portal-chat/export                  → transkrip untuk training
```

## Skema (migration + ADR-0129/0130)

```prisma
model PortalChatSession {
  id         String   @id @default(cuid())
  projectId  String
  userId     String
  type       String   // "brainstorm" | "tanya"
  periodKey  String   // "YYYY-MM" UTC, dibekukan saat lahir
  summary    String   @default("")
  prdMarkdown String?
  prdReadyAt DateTime?
  prdDocPath String?  // diisi saat operator memateralisasi
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages   PortalChatMessage[]
  @@index([projectId, type, periodKey])
}

model PortalChatMessage {
  id           String   @id @default(cuid())
  sessionId    String
  seq          Int
  role         String   // "klien" | "hanoman"
  text         String
  rawText      String?  // teks agen sebelum gerbang, saat blocked
  blocked      Boolean  @default(false)
  blockReasons Json?
  createdAt    DateTime @default(now())
  session      PortalChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@unique([sessionId, seq])
}
```

Keduanya **LOCAL-only** — tak masuk `SYNCED` maupun `WEBHOOK_ENTITIES` (cermin
`ClientProjectAccess`: akun klien adalah kredensial per-instance, ADR-0110) — tetapi **wajib**
masuk `PG_ORDER` sesudah `User` dan `Project`; `cli/test/migrate-pg.test.ts` mengadu daftar itu
ke DMMF.

## Bukti (huruf F)

Karena keempat lapis adalah **fungsi murni** di sekitar satu panggilan proses, huruf E bisa
dibuktikan tanpa memanggil agen sekali pun:

- **Injeksi** — korpus pesan yang sungguh-sungguh mencoba menembus (ganti persona, "abaikan
  instruksi di atas", menutup blok berbatas sendiri, instruksi berlapis di dalam kutipan,
  instruksi dalam bahasa lain) diadu ke gerbang masukan: tak satu pun keluar dari blok bahan.
- **Memancing project lain** — nama/id project tetangga di dalam balasan → tolak total; scope
  route diuji dengan project yang tak ditugaskan → 404 yang sama dengan project tak ada.
- **Istilah teknis** — korpus balasan berisi blok kode, path, nama tabel, jejak galat, perintah,
  `FOO=bar`, dan email → semuanya tertolak/teredaksi. Termasuk **tiga contoh nyata yang benar-benar
  diproduksi agen** saat percobaan di atas.
- **Batas runtime** — argv diadu dua arah (flag wajib ada / wajib tak ada); daftar berkas
  workspace diadu ke allowlist; produksi tanpa sandbox → menolak jalan.
- **Kuota** — di batas (jatah terakhir → sesi ke-N+1 ditolak), lintas akun di project yang sama,
  dan sesudah reset (baris ber-`periodKey` bulan lalu tak ikut dihitung).

## Pemecahan kerja

Satu backlog, tiga PR berurutan di satu plan:

1. **PR1 — fondasi & penjagaan.** Skema + migration + `PG_ORDER`, empat lapis gerbang, mode
   **Bertanya**, route klien, permukaan chat di portal, ADR-0129. Semua test huruf E.
2. **PR2 — kuota.** Blok Settings, penegakan per project×tipe×periode, tampilan sisa jatah di
   portal & dashboard, ADR-0130. Semua test huruf C/F-kuota.
3. **PR3 — brainstorming & PRD.** Prompt ala grill-me, keluaran PRD draft, layar operator
   (asal sesi + materialisasi), ekspor training.

## Yang sengaja TIDAK dikerjakan

- Help Center tak disentuh sama sekali; keduanya hidup berdampingan dan bedanya dijelaskan di UI
  ("Help desk = tiket ke tim, dijawab manusia" vs "Obrolan = dijawab hanoman saat itu juga").
- Tak ada streaming/WebSocket: satu giliran = satu request/response. Realtime bukan syarat huruf
  mana pun, dan PTY justru dilarang huruf E.
- Tak ada eskalasi otomatis PRD → backlog. Itu keputusan manusia (huruf B).
- Chat portal tak memakai codex.
