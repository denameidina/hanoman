# ADR-0036 — Notifikasi human decision dari hook Claude

**Status:** aktif (SPEC-184)

## Konteks

Sesi Claude yang berhenti menunggu keputusan manusia (brainstorm interview, resolusi konflik,
reverse-docs) tak menghasilkan sinyal apa pun — harus dicek satu-satu. Pill `awaiting`
("Menunggu keputusan") ada di design-system tapi tak pernah terhubung ke deteksi. Mekanisme
lama `.hanoman-ask.json` (ADR-0022) sudah superseded ADR-0024: pertanyaan kini hidup di
terminal interaktif, bukan berkas ask headless.

## Keputusan

**Satu, deteksi lewat hook `Notification` Claude, bukan scraping TUI.** `guardSettings`
(sudah meng-inject hook, merge dengan milik user — ADR-0010) menambah hook `Notification`
yang menandai marker `.worktrees/.decisions/<sessionId>` untuk tipe idle/permission/needs-input,
dan hook `UserPromptSubmit` yang mengosongkannya saat manusia menjawab. Marker ada di dalam
`.worktrees` yang sudah `.gitignore`.

**Dua, notifikasi dibuat reaktif di poll, bukan interval baru.** `scanDecisions()` dipanggil
di `GET /notifications` (poll 10s), membaca marker tiap sesi hidup, dan membuat baris
`Notification` bertipe `decision` pada transisi kosong→terisi. Dedup episode via `Set`
in-memory yang di-rebuild dari kondisi marker (sesi mati otomatis ter-prune). Persis pola
`recordCompletion` yang reaktif.

**Tiga, skema Notification diperluas.** `+type ("done"|"decision")`, `+key String? @unique`
(dedup selesai pindah dari `specId @unique` ke `key`; decision key null), `+sessionId`
(target redirect), `specId` jadi nullable (sesi reverse tak punya spec).

**Empat, aksi item.** decision → buka Terminal + fokus sesi. done → Terminal bila sesinya
masih hidup, kalau tidak Backlog item-nya. Nada decision default `alert`, beda dari selesai
(`short`), diatur di Settings (`notifyDecision` + `notifyDecisionSound`).

## Konsekuensi

- Latensi ~60s: notifikasi idle Claude muncul sekitar semenit setelah agen benar-benar bertanya.
- Restart server: paling banter satu notif ulang untuk keputusan yang masih terbuka (Set hilang).
- Dedup single-process; jika server jadi multi-worker, pindahkan `awaiting` ke kolom DB.
- Marker tak pernah mendarat di branch (di `.worktrees`); `git add -A` agen tak melihatnya.
- `specId` tak lagi `@unique`: `recordCompletion` dedup lewat `key` (`done:<specId>`), bukan skema.

## Alternatif yang ditolak

- **Heuristik idle pane server** (sesi diam >N detik = menunggu): tak bisa membedakan "menunggu
  keputusan" dari "tool jalan senyap"; rapuh seperti sentinel yang ditolak ADR-0020/0022.
  **Amandemen 2026-08-22 (SPEC-903, ADR-0143):** penolakan ini tetap berlaku untuk heuristik idle
  sebagai **sumber** — ia masih tak bisa melahirkan "menunggu" sendirian, dan ADR-0143 tak
  memakainya begitu. Yang diadopsi ADR-0143 adalah idle sebagai **konjungsi**: marker (sinyal dari
  agen) DAN pane diam. Keberatan "tool jalan senyap" gugur di sana karena TUI agen tak pernah
  benar-benar senyap saat bekerja — timer gilirannya berdetak tiap detik, terukur `window_activity ==
  now` pada 22/22 sampel 1 Hz vs pane diam yang beku 317 dtk.
- **Filter notification_type lebih halus dari grep**: tak sepadan; grep substring cukup dan
  bebas dependency.

## Pembaruan SPEC-196

- State decision kini juga **disurface ke grid terminal**: `listSessions()` mengisi `decision`
  (`!exited && marker terisi`, cek `markerFilled` yang sama dgn `scanDecisions` — **sejak ADR-0143
  ditambah gerbang `paneQuiet`, dan `scanDecisions` memakai `markerFilled` hanya untuk dedup**),
  dirender sebagai
  pill `awaiting` "Menunggu keputusan" di `Cell`. Additif pada respons `GET /terminal/sessions`,
  tanpa perubahan skema. `TerminalScreen` mem-poll list ~8s (guard signature) agar transisinya live.
- **Notifikasi OS lintas tab**: `done` & `decision` juga menembak `new Notification` (Web Notifications
  API) saat `document.hidden`, sehingga notifikasi sampai meski user pindah tab. Toast in-app tetap
  untuk tab yang fokus (hindari double).
