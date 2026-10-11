# ADR-0191 — Cronjob dibungkus MCP: capability `scheduler:read|write`, eksekusi menuntut `sessions:spawn`

Tanggal: 2026-10-11
Status: diterima (permintaan eksplisit pemilik repo)
**Mengamandemen ADR-0112 / SPEC-646** ("`/scheduler/crons*` COOKIE_ONLY") dan **ADR-0099** (MCP tak mengekspos yang mengeksekusi). Melanjutkan **ADR-0155** · Terkait: ADR-0072 (scheduler), SPEC-405 (kelas bug prefix), ADR-0157 (preseden domain baru)

## Konteks

ADR-0112 menutup `/scheduler/crons*` sebagai `COOKIE_ONLY` dengan alasan yang benar: sebuah baris cron
adalah `POST /terminal/sessions` yang DITUNDA — hanoman membuka sesi agen berizin penuh di worktree
project, berulang, tanpa manusia di pane. Membiarkannya di `settings` berarti setiap token
`settings:write` bisa menjadwalkan sesi tanpa batas.

Pemilik repo meminta cron dibungkus. `COOKIE_ONLY` tidak bisa dipertahankan sambil membungkusnya
(route cookie-only tak terjangkau agen sama sekali), jadi bentuk gerbangnya harus berubah — tanpa
mengulang kesalahan lama: domain yang opt-in, TIDAK diwarisi `settings:*`, dan eksekusi tidak
pernah lebih murah daripada `sessions:spawn`.

## Keputusan

1. **Domain baru `scheduler`** (`scheduler:read`, `scheduler:write`), dipetakan MENURUT METHOD untuk
   `seg[1] === "crons"`. `/scheduler/{config,state,queue*}` tetap `settings:*` — tak diubah, tak
   diperlebar. `write` mengimplikasikan `read` seperti domain lain.
2. **Eksekusi menuntut `sessions:spawn` juga, ditegakkan di HANDLER** (`routes/scheduler.ts`),
   karena `capabilityForRoute` sengaja tak melihat body (kemurnian `(method, path)` yang membuat uji
   kontrak katalog mungkin — preseden `PATCH /specs {stage}`, ADR-0155). Token agen tanpa
   `sessions:spawn` dijawab 403 `{ need: "sessions:spawn", reason: "cron-executes" }` untuk:
   - `POST /scheduler/crons` (selalu: ia menetapkan prompt/agen),
   - `PATCH /scheduler/crons/:id` bila body menyentuh `prompt`/`agent`/`model`/`effort`/`expr` ATAU
     `enabled: true` (apa/kapan/oleh siapa sesi diluncurkan, atau menyalakannya),
   - `POST /scheduler/crons/:id/run`.
   Yang tidak memulai apa pun tetap cukup dengan `scheduler:write`: ganti nama, `enabled: false`,
   hapus. Cookie (manusia) tak dinilai.
3. **Enam tool** di `gates.ts`: `hanoman_scheduler_crons_list` & `hanoman_scheduler_cron_runs`
   (`read`, `scheduler:read`); `hanoman_scheduler_cron_create|update|delete|run` (`danger`,
   `scheduler:write`). Deskripsi create/update/run menyebut kebutuhan `sessions:spawn`; katalog tool
   hanya mampu mengaku SATU capability per tool, jadi kebenarannya ada di server, dan test server
   (`scheduler-cron-gate.test.ts`) yang menjaganya.
4. **Cron baru tetap lahir nonaktif** (`enabled` default `false` di server); tool tak pernah memaksa
   `enabled`. `run` tetap membuat baris `queued` yang diluncurkan tick berikutnya lewat governor —
   tunduk cap, Pause, dan master switch, tanpa menyalin gerbangnya (SPEC-646).
5. Alternatif yang ditolak: capability `scheduler:exec` terpisah (menambah satu centang yang manusia
   harus ingat berpasangan dengan `sessions:spawn`, padahal yang diwakilinya SUDAH `sessions:spawn`);
   dan membiarkan `scheduler:write` cukup (jalan memutar menuju sesi yang `sessions:spawn`-nya tak
   pernah dicentang).

## Konsekuensi

- Nol endpoint baru, nol migration. Token lama tak berubah: sebelum ini agen tak bisa menyentuh cron.
- Manusia yang ingin agen mengelola cron mencentang DUA kotak: `scheduler:write` dan `sessions:spawn`;
  deskripsi capability di Settings menyebutnya.
- `scheduler-cron.route.test.ts` tidak lagi menegaskan `COOKIE_ONLY`; ia menegaskan peta baru.
