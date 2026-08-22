# hanoman

Orchestrator + dashboard workflow docs-driven: ia menyuruh **Claude Code** atau **Codex** membangun
project terhadap dokumentasi sebagai kebenaran, lalu memantau semua sesi dalam satu dashboard.

## Pasang

```bash
npm i -g hanoman
hanoman doctor     # periksa prasyarat
hanoman            # jalan di http://127.0.0.1:8787
```

Buka URL-nya. Pada pemakaian pertama hanoman menyajikan **wizard setup dua langkah** — peruntukan
(device sendiri / diakses orang lain) lalu keamanan — kemudian meminta akun pertama. Datanya di
`~/.hanoman/` (SQLite — **tanpa Docker, tanpa Postgres, tanpa Redis**).

**Hardening bersifat opsional dan default MATI** (SPEC-884/ADR-0139): tanpa `HANOMAN_HARDENING=1`,
hanoman jalan di device mana pun tanpa podman, tanpa reverse proxy, tanpa setup token — termasuk
sebagai root. Nyalakan hardening dari wizard (atau Settings → Setup awal) begitu prasyaratnya hijau.

> Instance yang diakses orang lain tanpa hardening hanya dijaga password akun hanoman — sesi agen
> berjalan langsung di mesin itu. Kalau instance akan dibuka ke internet, **selesaikan wizard di
> `localhost` dulu, baru sambungkan domain**: selama akun pertama belum ada, wizard bisa diklaim
> siapa pun yang membukanya.

## Prasyarat yang tidak dibawa npm

| Butuh | Untuk apa |
|---|---|
| `git` | tiap sesi jalan di git worktree terisolasi |
| `tmux` | sesi agen hidup di tmux, selamat dari restart server |
| `claude` **atau** `codex` | agen yang mengerjakan backlog |

`hanoman doctor` melaporkan mana yang belum ada, dan keluar dengan kode ≠ 0 bila ada yang wajib.

## Perintah

```
hanoman [start]                    jalankan (migrasi + server + dashboard)
  --port <n> --host <h> --db <file> --no-migrate
hanoman doctor                     periksa prasyarat
hanoman update [--check]           pasang versi terbaru dari npm
hanoman provision [--with=a,b]     pasang komponen di MESIN INI (hanoman, caddy, claude, codex, gh)
  [--profile=lab|production] [--domain=<d>] [--probe] [--dry-run] [--yes]
hanoman migrate-from-postgres --from <url> [--to <file>] [--dry-run] [--force]
hanoman mcp [--read-only]          MCP server stdio untuk klien AI
  [--host <url>] [--max-bytes <n>]
hanoman docs scan | index | link   operasi index Source of Truth
```

## Menyiapkan VPS

`hanoman provision` memasang komponen di mesin tempat ia dijalankan; layar VPS di dashboard
menjalankan skrip yang sama lewat SSH ke VPS terdaftar.

```sh
hanoman provision --probe                                        # laporkan apa yang ada, nol tulis
hanoman provision --with=hanoman,caddy --domain=hn.contoh.id --dry-run
hanoman provision --with=hanoman,caddy --domain=hn.contoh.id --yes
```

`claude`, `codex`, dan `gh` dipasang binernya saja — login-nya interaktif dan tetap kerjaan manusia;
probe melaporkannya `partial not-logged-in` sampai kamu login sekali. hanoman tak pernah menyentuh
kredensial agen. Bila `caddy` dipilih, A record domain harus sudah menunjuk ke IP mesin itu.

## Dipakai agen AI (MCP)

Agen AI mana pun yang berbicara MCP — Claude Code, Claude Desktop, Codex, Cursor, Copilot — bisa
membaca dan menulis backlog hanoman lewat `hanoman mcp`, tanpa kode pembungkus khusus. Buat agent
token di **Settings → Akses AI Agent**, lalu:

```json
{
  "mcpServers": {
    "hanoman": {
      "command": "hanoman",
      "args": ["mcp"],
      "env": {
        "HANOMAN_HOST": "http://localhost:8787",
        "HANOMAN_AGENT_TOKEN": "hnm_agt_…"
      }
    }
  }
}
```

Panduan siap salin per klien ada di halaman Settings itu sendiri. Tambahkan `--read-only` untuk
menyembunyikan seluruh tool yang menulis. Membuat sesi terminal dan perintah VPS **tidak tersedia**
lewat MCP.

## Update

Dari dashboard: badge **Update** di kanan atas → **Pasang & mulai ulang** → konfirmasi. hanoman
memasang versi baru dari npm lalu menjalankan dirinya lagi; sesi agen yang sedang berjalan tetap
hidup di tmux dan terminalnya tersambung lagi sendiri (SPEC-405 · ADR-0088).

Tombol itu hanya muncul bila instance dijalankan lewat `hanoman` / `hanoman start` — proses itulah
yang memasang dan menghidupkannya kembali. Dijalankan dengan cara lain (mis. `node dist/server.js`
langsung), panel tetap hanya menampilkan perintah untuk disalin.

Dari terminal:

```bash
hanoman update            # npm i -g hanoman@latest --prefer-online
```

Sesudah `hanoman update`, instance yang berjalan perlu di-restart (mis. `systemctl restart hanoman`).

## Konfigurasi

| Env | Default | Untuk apa |
|---|---|---|
| `HANOMAN_HOME` | `~/.hanoman` | akar seluruh state hanoman — lihat [Isi `$HANOMAN_HOME`](#isi-hanoman_home) |
| `HANOMAN_DATABASE_URL` | — | berkas DB khusus hanoman; hanya URL `file:` (nilai lain **melempar**) |
| `DATABASE_URL` | `file:$HANOMAN_HOME/hanoman.db` | dipakai bila ber-`file:`; nilai lain **diabaikan** dengan peringatan |
| `HANOMAN_TRANSCRIPT_DIR` | `$HANOMAN_HOME/transcripts` | transkrip sesi yang sudah ditutup |
| `HANOMAN_UPLOAD_DIR` | `$HANOMAN_HOME/uploads` | lampiran tiket & lampiran gambar sesi terminal |
| `HANOMAN_SSH_KEY_DIR` | `$HANOMAN_HOME` | keypair identitas hanoman untuk VPS |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | alamat bind |
| `HANOMAN_CLAUDE_BIN` / `HANOMAN_CODEX_BIN` | `claude` / `codex` | biner agen |
| `HANOMAN_TMUX_SOCKET` | `hanoman` | socket tmux terpisah dari milikmu |

<a id="isi-hanoman_home"></a>

## Isi `$HANOMAN_HOME` — satu batas backup/restore

Tanpa override, **seluruh** state hanoman hidup di bawah satu direktori. Itulah batas yang harus
disalin: memindahkan DB saja meninggalkan metadata yang menunjuk byte yang tak ada (SPEC-846).

| Path | Isi | Hilang berarti |
|---|---|---|
| `hanoman.db` (+ `-wal`/`-shm`) | seluruh state aplikasi | semuanya |
| `secret.key` | kunci AES untuk RuntimeConfig & webhook secret | credential terenkripsi tak bisa dibuka |
| `id_ed25519` + `.pub` | identitas SSH hanoman ke VPS | akses VPS mati; `authorized_keys` tak lagi cocok |
| `transcripts/` | transkrip sesi yang ditutup | `hasTranscript` benar, isinya tak terbaca |
| `uploads/` | lampiran tiket, byte source-map lama | lampiran 404 walau metadata utuh |
| `uploads/terminal/<sessionId>/` | lampiran gambar sesi terminal | path di prompt agen menunjuk berkas hilang |
| `setup.token` | token bootstrap admin pertama (one-time, 15 menit) | hanya relevan sebelum admin pertama |
| `agent-token` | agent token yang dibaca `hanoman mcp` | klien MCP lokal kehilangan autentikasi |

```bash
# Backup — SQLite disalin konsisten, sisanya berkas biasa.
sqlite3 "$HANOMAN_HOME/hanoman.db" ".backup '/backup/hanoman.db'"
tar -C "$HANOMAN_HOME" -czf /backup/hanoman-files.tgz \
  secret.key id_ed25519 id_ed25519.pub transcripts uploads

# Restore di host lain — umask dulu, isinya memuat kunci privat.
umask 077
install -d -m 0700 "$HANOMAN_HOME"
cp /backup/hanoman.db "$HANOMAN_HOME/hanoman.db"
tar -C "$HANOMAN_HOME" -xzf /backup/hanoman-files.tgz
hanoman doctor          # memverifikasi tiap path data efektif + izin tulisnya
```

`setup.token` dan `agent-token` sengaja **tidak** ikut: yang pertama one-time dan lahir ulang
sendiri bila DB belum punya user, yang kedua sebaiknya diterbitkan ulang di host baru.

Mengeset `HANOMAN_TRANSCRIPT_DIR`, `HANOMAN_UPLOAD_DIR`, atau `HANOMAN_SSH_KEY_DIR` memindahkan
bagian itu ke luar batas ini — sah, tapi backup-nya menjadi tanggung jawabmu. `hanoman doctor`
mencetak path efektifnya supaya tak perlu ditebak.

## Bind & TLS

Default `127.0.0.1:8787`. hanoman punya auth, tapi cookie sesinya `Secure` — set
`--host 0.0.0.0` **hanya** di belakang reverse proxy yang menerminasi TLS.

## Pindah dari Postgres

Instalasi hanoman lama memakai Postgres. Pindahkan sekali (backup dulu dengan `pg_dump`):

```bash
hanoman migrate-from-postgres --from "postgresql://user:pass@host:5432/hanoman" --dry-run
hanoman migrate-from-postgres --from "postgresql://user:pass@host:5432/hanoman"
```

`--dry-run` hanya menghitung baris per tabel tanpa menulis apa pun. Target yang sudah berisi data
ditolak kecuali `--force`.

> **Punya `DATABASE_URL` untuk project lain?** Tidak masalah — hanoman mengabaikan nilai non-`file:`
> dan tetap memakai `$HANOMAN_HOME/hanoman.db`, sambil mencetak peringatan sekali. Untuk menunjuk
> berkas DB tertentu tanpa menyentuh var itu, pakai `HANOMAN_DATABASE_URL=file:/path/hanoman.db`
> atau `hanoman --db /path/hanoman.db`.

## Kalau `hanoman` gagal menerapkan migrasi

**`P3005 — The database schema is not empty`** berarti berkas DB itu sudah punya tabel tapi tak
punya riwayat migrasi hanoman — biasanya bukan DB hanoman versi ini (sisa prototipe lama, atau
berkas tool lain yang kebetulan bernama sama). hanoman **tidak** mengubah isinya. Pindahkan berkas
itu lalu jalankan ulang, atau tunjuk berkas lain dengan `hanoman --db /path/baru.db`.

## Kalau terminal sesi terbuka tapi kosong

Sesi hanoman hidup di dalam **tmux**; layarnya dialirkan ke browser lewat node-pty. Dua sebab:

- **tmux belum terpasang** — `brew install tmux` (macOS) atau paket distro Anda.
- **`spawn-helper` node-pty tak executable** — node-pty menerbitkan biner pendampingnya dengan mode
  `0644`, jadi `posix_spawnp` gagal dan tak satu byte pun mengalir ke terminal walau sesinya hidup.
  Sejak `0.1.3` `hanoman` memperbaikinya sendiri saat start, dan sejak `0.1.34` perbaikan itu
  dipasang di jembatan node-pty-nya sendiri — jadi ia tetap jalan walau Anda memanggil bundle
  server langsung (`node .../hanoman/dist/server.js`) alih-alih lewat `hanoman start`. Bila instalasi
  global itu milik root dan hanoman dijalankan sebagai pengguna biasa, chmod-nya ditolak — perbaiki
  manual: `sudo chmod +x "$(npm root -g)"/hanoman/node_modules/node-pty/prebuilds/*/spawn-helper`.

## Lisensi

MIT — lihat `LICENSE`.
