# 0179 — Memori project disuntik ke sesi backlog; sesi menulis memori atas namanya sendiri

Tanggal: 2026-10-07 · Status: diterima · Melanjutkan [ADR-0178](0178-memori-project-bersama.md) · Plan: [tahap 2](../../../docs/superpowers/plans/2026-10-07-shared-project-memory-stage2.md)

## Konteks

ADR-0178 memberi memori project lewat REST/MCP, tetapi sesi `claude`/`codex` yang diluncurkan hanoman
belum melihatnya saat lahir, dan memori yang mereka tulis tercatat sebagai `external` tanpa jejak sesi
maupun penanda input eksternal.

## Keputusan

1. **Suntik saat sesi backlog lahir** (`startSpecSession`). `session-launch.ts` (punya DB) memilih
   memori `active`, memverifikasi setiap jangkar terhadap HEAD worktree yang baru lahir dengan SATU
   `git ls-tree -r` (bukan satu subproses per jangkar), membuang yang usang, mengurutkan memori
   seluruh-project lalu memori ber-scope yang cocok dengan path yang disebut spec, dan memotong di
   **40 butir / 6000 byte**. Hasil verifikasi ditulis ke `MemoryLocalState` (verdict, HEAD, waktu;
   `lastUsedAt` untuk yang tersuntik). pty.ts tetap nol-DB: ia hanya menerima **teks** lalu menulis
   berkasnya di `agentTempDir(id)` lewat modul murni `memory/file.ts`.
2. **Jalur per mesin sesi:**
   - claude → `--append-system-prompt-file <memory.md>` (tanpa batas argv/tmux).
   - codex → `-c "$(cat memory.toml)"` berisi `developer_instructions='''…'''`. Spike 2026-10-07 dengan
     codex-cli 0.160.0 `codex debug prompt-input` (tanpa panggilan model): blok tampil utuh sebagai
     pesan `developer` terpisah; AGENTS.md dan base instructions tak diganti. `-c` mem-parse TOML dan
     jatuh ke string mentah bila gagal, jadi berkas WAJIB TOML literal sah; `'''` di isi disanitasi.
     **Konsekuensi:** bila `~/.codex/config.toml` operator kelak memuat `developer_instructions`
     top-level, `-c` ini menimpanya untuk sesi itu.
3. **Isi blok = DATA, bukan instruksi**, dengan cara memakai tool `hanoman_memory_*` di header — tanpa
   skill terpisah. Instruksi pengguna dan AGENTS.md/CLAUDE.md dinyatakan selalu menang.
4. **Principal sesi.** CLI MCP mewarisi `HANOMAN_SESSION_ID` + `HANOMAN_EVENT_TOKEN` (ADR-0146) dari
   sesi induknya dan meneruskannya sebagai `x-hanoman-session` / `x-hanoman-session-token` — **hanya ke
   host loopback**; token HMAC per-mesin tak pernah dikirim ke hub jarak jauh. Server memverifikasi
   HMAC + pane hidup; project & HEAD diambil dari pane (worktree sesi), menang atas header repo, dan
   **tak membutuhkan allowlist `projectIds`** (kredensial sesi membuktikan project). Capability
   `memory:*` tetap dituntut gate. Header setengah/HMAC salah = 401 — tak pernah jatuh diam-diam ke jalur
   repo. Memori tercatat `sourceRuntime` = mesin sesi, `sourceSessionId` = id sesi.
5. **Trust.** Sesi tak tepercaya bila spec-nya `source = help`, atau ada `Ticket`/`GithubIssue` yang
   `specId`-nya menunjuk spec itu. Memori dari sesi tak tepercaya selalu `proposed` dengan
   `reviewReason = untrusted-source` (mitigasi memory poisoning, OWASP T1). Sesi Telegram/VPS ber-project
   sintetis → 400 (tak terikat project).
6. **Fail-open:** kegagalan memori apa pun → peringatan stderr, sesi lahir tanpa memori. Memori yang tak
   terverifikasi tak pernah disuntik.

## Konsekuensi

- Sesi terminal ad-hoc (bukan backlog) belum mendapat memori.
- Memori ber-scope hanya tersuntik bila teks spec menyebut path yang cocok; selebihnya lewat `search`.
- Kelahiran sesi membayar satu `ls-tree` + kueri ≤ 500 baris memori.
