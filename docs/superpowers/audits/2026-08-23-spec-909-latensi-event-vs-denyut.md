# SPEC-909 — latensi pintu deteksi lead: event vs denyut

Tanggal: 2026-08-23 · Backlog **SPEC-909** · ADR-0146.
Mesin: MacBook (darwin 25.3.0), claude **2.1.240**, codex-cli **0.147.0**, tmux **3.7b**, Node 24.11.1.

Semua angka di bawah diukur dengan menjalankan agen sungguhan di pane tmux dan server hanoman
sungguhan, bukan dari harness palsu. Stempel waktu diambil **di dalam hook itu sendiri**
(`perl -MTime::HiRes`) dan **di dalam handler route** (`Date.now()`), keduanya instrumentasi
sementara yang dicabut sesudah pengukuran.

## 1 · Ringkasan

| | sebelum (denyut) | sesudah (event) |
|---|---|---|
| `AskUserQuestion` → lead mulai menyusun, sesi diam | **≥ 6 023 ms**, harapan **≈ 8 550 ms**, tak berbatas saat `busyDetect` dipegang | **32 / 46 / 164 ms** (n=3, median **46 ms**) |
| `capture-pane` per sesi hidup saat **tak ada** yang bertanya | 1 per sesi per 5 dtk (6,28 ms/panggilan, memblokir event loop — SPEC-479 temuan E) | **0** |
| stall yang dibayar agen oleh hook | 0 (hook cuma menulis berkas) | 14–49 ms server sehat · 0,00–0,01 dtk server mati · **2,01 dtk** server menggantung (batas `-m 2`) |

Perbaikan latensi: **≈ 185×** pada median (8 550 → 46 ms), dan lantainya turun dari 6 023 ms ke 32 ms.

## 2 · Kenapa "sebelum" bukan setengah tick

Yang selama ini dibicarakan hanya ½ × 5 dtk. Pengukuran ini menemukan lapis kedua yang lebih besar
dan lebih tua: **hook `Notification` claude bukan hook `AskUserQuestion`**. Ia menembak dari pengait
**idle 6 detik** yang dipasang tiap dialog (mekanisme yang sudah dinamai SPEC-452), jadi marker baru
terisi enam detik sesudah agen benar-benar bertanya.

Diukur dua kali, dua bentuk dialog, dua stempel `Time::HiRes` di dalam hook masing-masing:

| panggilan | `PreToolUse(AskUserQuestion)` → `Notification` |
|---|---|
| 1 pertanyaan | **6 071 ms** |
| 3 pertanyaan | **6 023 ms** |

Anggaran tunggu lama, di sesi diam, tanpa beban:

```
t = 0            agen memanggil AskUserQuestion
t ≈ 6,05 dtk     hook Notification menembak → marker terisi     ← lapis 1 (baru terukur di sini)
t ≈ 6,05 + U(0,5) tick berikutnya melihatnya                    ← lapis 2 (½ tick, E = 2,5 dtk)
```

## 3 · "Sesudah", terukur end-to-end

Harness: server hanoman (`PORT=8799`) + sesi `claude` sungguhan di pane tmux bernama `hanoman-m1`,
membawa `HANOMAN_SESSION_ID` / `HANOMAN_EVENT_URL` / `HANOMAN_EVENT_TOKEN` persis seperti yang
dirakit `sessionEventEnv()`, dan `--settings` persis keluaran `guardSettings(…, eventHook: true)`.

| sampel | ask → server menerima | ask → lead mulai menyusun |
|---|---|---|
| 1 | 14 ms | **32 ms** |
| 2 | 28 ms | **46 ms** |
| 3 | 49 ms | **164 ms** |
| 4 | 16 ms | — (server di-restart `tsx watch` di tengah, dibuang) |

Sisi server sendiri (intake → `answerAsk`): **11 / 11 / 59 ms**.

## 4 · `capture-pane` saat idle

**Sebelum:** gerbang kedua `scanAndAnswer` memanggil `capturePane` untuk setiap sesi hidup
ber-marker kosong, tiap 5 detik. `tmux()` memakai `execFileSync` → memblokir event loop.

**Sesudah:** satu-satunya pemakai `capturePane` di seluruh subsistem lead adalah
`prodDetectDeps.pane` (`lead/detect.ts:175`), dan ia hanya dipanggil dari dalam `runChain`
(`waitDialog`, `waitScreenChange`, `afterLastAnswer`) — yaitu hanya sesudah sebuah event tiba untuk
sesi yang memang bertanya. `lead/engine.ts` tak memanggilnya sama sekali; tick rumah tangganya
membaca satu `tmux list-panes -a` per menit lewat `liveDecisions()`. **Nol** saat tak ada yang
bertanya, apa pun jumlah sesi hidup.

## 5 · Stall yang dibayar agen

Hook memblokir tool-nya selama `curl` berjalan, jadi batasnya harus nyata:

- **server sehat** — 14–49 ms (kolom "ask → server menerima" di §3; termasuk spawn `curl`).
- **server mati** (connection refused) — `real 0.01 / 0.01 / 0.00` dtk. Gagal seketika.
- **server menggantung** (alamat blackhole) — `real 2.01` dtk, persis batas `-m 2`.

Dan `exit 0` tanpa syarat: apa pun hasilnya, tool-nya tak pernah diblokir.

## 6 · Bukti tambahan yang ikut terjaring

- **Rantai `LeadFlow` utuh di produksi (ADR-0102).** Satu panggilan 3-pertanyaan menghasilkan **satu**
  `LeadFlow` ber-`steps = 3` dengan **tiga** `LeadDecision` ber-`flowId` sama dan `step` 1/2/3 —
  persis yang SPEC-487 perbaiki, kini tanpa satu pun tebakan atas layar.
- **Pagar auth menggigit, live.** `Bearer` salah → **401**; `Bearer` benar tapi sesi tak hidup →
  **404**. Yang kedua sekaligus membuktikan tokennya sah (401 sudah dilewati).
- **Keempat keputusan berstatus `gagal`** dengan alasan
  `lead claude gagal (exit 1): Failed to authenticate. API Error: 401 Invalid bearer token`.
  Ini **bukan** cacat SPEC-909: server yang di-boot dari dalam sesi Claude Code tak bisa membaca
  kredensial claude sama sekali, jadi setiap proses agen yang ia spawn 401. Latensi di §3 diukur
  **sebelum** proses agen dipanggil, jadi tak terpengaruh. Round-trip agen sungguhan menuntut server
  yang dijalankan dari terminal manusia.

## 7 · Kekeliruan harness yang layak dicatat

`DATABASE_URL` **ambient di shell operator** (`file:~/.hanoman/hanoman.db`) menang atas
`HANOMAN_HOME` yang disuntikkan ke harness, jadi server pengukur dan seed awal menyentuh **database
dev sungguhan**, bukan yang di direktori scratch. Terdeteksi karena `leadFlow`/`leadDecision` di DB
scratch nol padahal jalurnya jelas jalan.

Dibersihkan: project `m1p`, 1 `LeadFlow`, 4 `LeadDecision`, dan 6 `Notification` dihapus; blok
`Setting.lead` — yang ikut tertimpa — dikembalikan ke `LEAD_DEFAULTS` (master switch **mati**,
`engine` yang ada dipertahankan).

Pelajarannya untuk pengukuran berikutnya: `env -u DATABASE_URL -u HANOMAN_DATABASE_URL` **wajib**
ikut dibersihkan bersama `HANOMAN_CONTROL_ORIGINS`/`NODE_ENV`/`SSH_ASKPASS`; `HANOMAN_HOME` saja
tidak cukup mengisolasi DB.
