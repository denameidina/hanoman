# ADR-0141 — Onset "menunggu manusia" hidup di ISI marker keputusan, dan menyeberang sebagai `decisionAt`

Tanggal: 2026-08-22 · Status: diterima · Sumber: spec `docs/superpowers/specs/2026-08-22-spec-898-pet-bicara-design.md`
Mengamandemen SPEC-184 pada **isi** marker keputusan (semantiknya tak berubah); menegakkan ADR-0039
(tanpa channel realtime baru), ADR-0024 (tanpa queue/worker/scheduler), dan ADR-0091.

## Konteks

`TerminalSession` tak punya satu pun stempel waktu. Sesi yang baru saja bertanya dan sesi yang sudah
40 menit tak dijawab karena itu tak bisa dibedakan oleh konsumen mana pun — dashboard, pet, atau
agen. SPEC-898 butuh umur itu untuk menaikkan urgensi pet menurut umur pertanyaan.

Jawaban naifnya adalah `mtime` marker keputusan (`.worktrees/.decisions/<id>`, SPEC-184). Ia
**salah, dan ini terukur**: hook `Notification` menjalankan `echo waiting >> f` **setiap kali**
Claude menandai dirinya idle/butuh input, dan hanya `UserPromptSubmit` (manusia menjawab) yang
mengosongkannya. Marker nyata di mesin pengembang membuktikan pengulangan itu — misalnya
`.worktrees/.decisions/prd-orchestrator-hanoman` berisi **13 baris** tanpa satu pun truncate di
antaranya. Tiap baris mencap ulang mtime, jadi umur yang diturunkan darinya selalu terbaca lebih
muda dari satu putaran idle: gerbang 10 menit tak akan pernah menyala.

## Keputusan

1. **Isi marker adalah detik epoch ONSET episode menunggu, ditulis SEKALI.** Hook berubah dari
   "tambahkan satu baris" menjadi "tulis stempel bila masih kosong":
   `grep -qiE '…' && { [ -s F ] || date +%s > F; } || true` (`runner/src/settings.ts`), dengan
   cermin `[ -s F ] || date +%s > F` pada hook `Stop` codex (`runner/src/codex-settings.ts`).
   `UserPromptSubmit` tetap `: > F` — episode berikutnya mendapat stempel baru.
2. **Semantik `size > 0` tidak berubah.** "Non-kosong = menunggu manusia" tetap satu-satunya arti
   marker, jadi `markerFilled()`, `scanDecisions()` (SPEC-184), dan `GET /lead/status` tak berubah
   satu baris pun. Yang diamandemen ADR ini hanya **isi**-nya: dulu tak bermakna, kini bermakna.
3. **`decisionAt` adalah kolom payload sesi yang additif & opsional** — ISO 8601, ada hanya saat
   `decision === true` **dan** isi marker bisa diparse sebagai integer. Ia ditumbuhkan bersamaan di
   `SessionInfo` (`server/src/services/pty.ts`), `SessionDTO` (`shared/src/dto.ts`), dan
   `TerminalSession` (`src/src/api/client.ts`). **Absen berarti "tak diketahui"**, dan konsumen tak
   boleh mengeskalasi apa pun tanpa stempel.
4. **Tanpa endpoint, channel, skema DB, atau poll baru.** Berkasnya dibaca hanya untuk marker yang
   sudah terbukti terisi — sesi yang tak menunggu membayar nol I/O tambahan di atas `statSync` yang
   sudah dibayar `markerFilled`. `pty.ts` tetap **nol dependensi DB**.

## Konsekuensi

- Sesi yang **sedang berjalan** saat versi ini dipasang punya marker berisi `waiting`; `decisionAt`
  absen untuk mereka sampai episode menunggu berikutnya. Itu jawaban yang benar, bukan kompromi.
- Klien lama mengabaikan kolom baru; server lama tak mengirimnya. Kompatibel dua arah, tak ada
  gerbang versi.
- Cacat lama SPEC-184 tetap ada dan **tidak** diperkenalkan di sini: dialog TUI yang dijawab tanpa
  `UserPromptSubmit` (mis. `AskUserQuestion`, SPEC-452) meninggalkan marker terisi. Sebelumnya
  akibatnya "`decision` lengket"; kini akibatnya "`decision` lengket **dan** umurnya terus tumbuh".
  Memperbaikinya butuh pintu jawaban yang mengosongkan marker — pekerjaan SPEC-899, bukan ini.
- `date +%s` berpresisi detik. Cukup: ambang yang memakainya berorde menit.

## Alternatif yang ditolak

- **`mtime` marker** — tercap ulang tiap notifikasi idle (lihat Konteks). Gratis, dan salah.
- **Peta onset di memori server** (`Map<sessionId, number>` di `pty.ts`) — tak menyentuh hook, tapi
  hilang saat server restart, dan onset hanya tercatat saat `listSessions()` dipanggil: dashboard
  yang ditutup dua jam kembali dengan umur nol.
- **`createdAt` notifikasi `decision` di DB** — persis benar dan tahan restart, tetapi `pty.ts`
  sengaja nol dependensi DB (ADR-0091 menghias `deciding` di `services/events.ts` justru karena
  itu), dan grup siar `sessions` di-recompute tiap detik. Satu query per detik untuk sebuah stempel
  yang sudah ada di disk adalah biaya tanpa imbalan.
