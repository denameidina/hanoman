# ADR-0079 — Riwayat sesi terminal: store LOCAL-only + transkrip berkas, hook di dua titik cekik pty

**Status:** aktif (SPEC-362). **Memperluas 0016** (tmux tetap sumber kebenaran sesi *hidup*) &
**0047** (activity log stage) — dan membuka **pengecualian terbatas** atas larangan transkrip di
0047. Terkait 0002/0015/0028/0038/0065.

> **Amendment SPEC-1215 / [ADR-0166](0166-log-terpusat-ingest-satu-arah.md) (dirancang):** transkrip
> boleh menyeberang ke hub lewat lajur `transcript` `POST /api/sync/logs`, **hanya** bila
> `Setting.data.logShipping.transcript` dinyalakan cookie di klien itu (default mati). Isinya diredaksi
> sebelum dikirim dan sekali lagi di hub. `SessionHistory` sendiri tetap LOCAL-only.

## Konteks

`server/src/services/pty.ts` menyatakan tmux sebagai satu-satunya sumber kebenaran sesi (ADR-0016):
`listPanes()` membaca `tmux list-panes -a`, dan tak ada baris sesi di DB sama sekali. Sesi yang
berakhir wajar masih terlihat (`remain-on-exit on`) sampai operator menekan `×`; sesudah itu
`DELETE /terminal/sessions/:id` memanggil `killSession()` + `realGit.removeWorktree()` dan **tak ada
jejak apa pun** yang tersisa — tidak metadata, tidak transkrip, tidak cara membukanya kembali.

`SessionResult` (ADR-0047) bukan pengganti: ia lahir hanya saat transisi stage spec
(`advanceStage` di `routes/terminal.ts`), jadi terminal biasa, shell, PRD, reverse, scaffold,
breakdown, cross-audit, dan konsol VPS tak pernah menghasilkan satu baris pun. Whitelist-nya juga
**melarang** transkrip PTY ikut tersimpan (AC-21 SPEC-213).

Permintaan SPEC-362 — "history session semuanya tersimpan", bisa dibuka kembali, bisa dicek
riwayatnya, berada di Terminal tanpa menghalangi UI-nya — karenanya menyentuh skema dan butuh ADR.

## Keputusan

**1. Tabel `SessionHistory`, LOCAL-only.** Sesi hidup di tmux mesin ini dan transkripnya berkas di
disk mesin ini; menyiarkannya ke hub akan mengirim baris yang menunjuk berkas yang tak ada di sana.
Tidak masuk `SYNCED`, tidak memanggil `notifySynced()`, tidak punya kolom `version` — sejalan dengan
`LocalBinding` (ADR-0043 dst.) dan `SchedulerQueueItem` (ADR-0072).

**PK = uuid baris, bukan `sessionId`.** `sessionIdForSpec("SPEC-362")` selalu menghasilkan
`spec-362`; satu backlog yang dibuka-tutup lima kali menghasilkan lima baris ber-`sessionId` sama.
Menjadikan `sessionId` PK akan menimpa riwayat lama tiap reopen — persis kebalikan dari yang diminta.

**Tanpa FK ke `Project`.** `routes/vps.ts` melahirkan sesi dengan `projectId` sintetis (`vps:<id>`,
`vps-console:<id>`); FK akan membuat sesi VPS gagal dicatat. Konvensi yang sama sudah dipakai
`SessionResult`.

**2. Baris lahir saat sesi LAHIR, bukan saat ditutup.** Sesi yang sedang berjalan pun sudah ada di
riwayat (`endedAt: null`, terbaca "berjalan"). Kalau baris hanya lahir saat close, riwayat berbohong
selama sesi hidup, dan sesi yang lenyap bersama tmux crash tak pernah tercatat sama sekali.

**3. Dua titik cekik, bukan dua belas call site.** `createSession()` dan `killSession()` adalah
satu-satunya pintu lahir & mati sesi — seluruh pemanggil (`routes/terminal.ts` 8 cabang,
`services/session-launch.ts`, `routes/specs.ts`, `routes/ide.ts`, `routes/vps.ts` ×2) bermuara ke
sana. `pty.ts` **tetap nol dependensi DB**: ia hanya mengekspos
`registerSessionHooks({onBirth,onDeath})`, dan `services/session-history.ts` mendaftarkan diri lewat
`server.ts` — pola `registerSchedulerSource` (SPEC-294). Hook fire-and-forget di dalam `try/catch`:
riwayat tak pernah memblokir atau menggagalkan kelahiran/penutupan sesi. `onBirth` **tidak** menembak
saat `createSession` mengembalikan sesi yang sudah ada — re-attach (ADR-0015) bukan sesi baru.

`kind` diturunkan fungsi murni `sessionKind()` **saat sesi lahir**, saat opsinya masih di tangan;
sesudah itu tmux hanya menyimpan sebagian (tak ada jejak `command` maupun `prompt`).

**4. Transkrip = `capture-pane -p -J -S -50000`, tanpa `-e`, di-capture SEBELUM `kill-session`.**
Sesudah pane dibunuh scrollback-nya tak ada lagi, jadi urutannya wajib. Tanpa `-e` (kebalikan
`attach()` untuk pane mati, yang memang me-replay warna ke xterm): arsip disimpan sebagai teks polos
— bisa dicari, aman dirender di `<pre>`, tak menyuntikkan ANSI ke DOM. Berkasnya hidup di
`HANOMAN_TRANSCRIPT_DIR` (`services/transcript-store.ts`, cermin `services/uploads.ts`); DB hanya
memegang nama berkas + ukurannya. Batas **1 MiB menyimpan EKOR** dengan penanda pemangkasan di atas:
saat membaca ulang sesi, yang dicari hampir selalu apa yang terjadi menjelang akhir.

**5. `GET/DELETE /api/terminal/history*` di bawah prefix `/terminal`.** `capabilityForRoute()` sudah
memetakan seluruh top-level `terminal` ke `sessions:read|write` (ADR-0065), jadi endpoint ini
tergerbang tanpa menambah domain capability baru. Amplop `Paginated<SessionHistoryView>`.
**`skip`/`take` di query DB sah di sini**: larangan ADR-0038 khusus `GET /specs`, yang memerlukan set
penuh untuk overlay stage live + write-through + notifikasi `done`; riwayat adalah baris mati tanpa
overlay apa pun. Purge **wajib ber-scope** (`projectId` dan/atau `before`) dan ikut menghapus berkas
transkripnya — cermin `DELETE /session-results` (ADR-0047).

**6. UI = modal di Terminal.** Tombol "Riwayat" di toolbar membuka `SessionHistoryModal`, pola yang
sama dengan `BacklogPicker`: grid terminal di belakangnya tak berubah ukuran sama sekali — itulah
arti "tidak menghalangi UI terminal". Daftar memakai muat-lebih + `IntersectionObserver` dengan
tombol manual sebagai fallback, dan **baris penutup yang membedakan daftar habis dari daftar
terpotong** (pelajaran SPEC-351). "Mulai lagi" tak pernah menghidupkan proses lama — ia men-spawn
sesi baru lewat endpoint yang sudah ada, dibatasi `restartableKind()` di `@hanoman/shared`:
`spec`/`terminal`/`shell`/`reverse`/`scaffold`/`cross-audit` bisa, sementara `prd`/`breakdown` butuh
`brief`/`prdPath` yang tak tersimpan dan `vps`/`worktree` tak punya arti "mulai lagi".

**7. `reconcileHistory()` saat boot.** tmux bisa mati di luar hanoman (`kill-server`, reboot); tanpa
ini baris tanpa pane akan selamanya terbaca "berjalan". Baris `endedAt: null` yang `sessionId`-nya
tak ada di `listSessions()` ditutup dengan `endedAt = updatedAt` (waktu terbaik yang tersedia),
`exitCode` tetap `null` karena memang tak diketahui. Cermin `backfillFeed` saat hub boot (ADR-0067).

## Konsekuensi

- **Riwayat tumbuh tanpa batas** secara desain ("semuanya tersimpan"). Pagarnya adalah purge manual
  ber-scope, bukan retensi otomatis — retensi berbasis waktu butuh knob & ADR sendiri.
- **Transkrip adalah data baru yang tersimpan.** ADR-0047 dulu sengaja melarangnya di `SessionResult`;
  keputusan ini membukanya **hanya** di store LOCAL-only yang tak pernah menyeberang ke hub. Isinya
  sekelas dengan isi repo (kode, path, output perintah); kredensial yang hanoman pegang (Keychain,
  `~/.claude/.credentials.json`, `Vps.keyPath`) tak pernah dicetak ke pane sehingga tak ikut terekam.
- Endpoint tergerbang auth `/api` (ADR-0028) + capability `sessions` (ADR-0065). Render `<pre>` teks
  polos — bukan `dangerouslySetInnerHTML`, bukan ANSI-ke-HTML.
- **ponytail:** sesi yang panenya lenyap **tanpa** lewat `killSession` (tmux `kill-server`, reboot,
  `killAll()` di test) kehilangan transkripnya — `reconcileHistory()` hanya bisa menutup barisnya,
  tak bisa memulihkan isi. Merekam transkrip secara streaming selama sesi berjalan akan menutup celah
  ini, dengan harga menulis terus-menerus untuk sesi berhari-hari; ditolak sebagai non-goal SPEC-362.
- **ponytail:** `kind` diturunkan sekali saat lahir. Menambah jenis sesi baru berarti menambah cabang
  di `sessionKind()` **dan** entri di `SESSION_KINDS`/`SESSION_KIND_LABEL`; kind yang tak dikenal
  jatuh ke label slug mentah dan tak pernah restartable (aman, tapi terlihat mentah).
