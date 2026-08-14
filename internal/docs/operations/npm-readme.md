# hanoman

Orchestrator + dashboard workflow docs-driven: ia menyuruh **Claude Code** atau **Codex** membangun
project terhadap dokumentasi sebagai kebenaran, lalu memantau semua sesi dalam satu dashboard.

## Pasang

```bash
npm i -g hanoman
hanoman doctor     # periksa prasyarat
hanoman            # jalan di http://127.0.0.1:8787
```

Buka URL-nya, buat akun pertama, selesai. Datanya di `~/.hanoman/` (SQLite — **tanpa Docker,
tanpa Postgres, tanpa Redis**).

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
hanoman migrate-from-postgres --from <url> [--to <file>] [--dry-run] [--force]
hanoman mcp [--read-only]          MCP server stdio untuk klien AI
  [--host <url>] [--max-bytes <n>]
hanoman docs scan | index | link   operasi index Source of Truth
```

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
hanoman update            # npm i -g hanoman@latest
```

Sesudah `hanoman update`, instance yang berjalan perlu di-restart (mis. `systemctl restart hanoman`).

## Konfigurasi

| Env | Default | Untuk apa |
|---|---|---|
| `HANOMAN_HOME` | `~/.hanoman` | DB SQLite, key SSH, transkrip sesi |
| `HANOMAN_DATABASE_URL` | — | berkas DB khusus hanoman; hanya URL `file:` (nilai lain **melempar**) |
| `DATABASE_URL` | `file:$HANOMAN_HOME/hanoman.db` | dipakai bila ber-`file:`; nilai lain **diabaikan** dengan peringatan |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | alamat bind |
| `HANOMAN_CLAUDE_BIN` / `HANOMAN_CODEX_BIN` | `claude` / `codex` | biner agen |
| `HANOMAN_TMUX_SOCKET` | `hanoman` | socket tmux terpisah dari milikmu |

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
