# ADR-0225 — Memangkas durasi sesi backlog: plan tanpa kode, keputusan di depan, verifikasi berirama, tanpa polling tidur

Tanggal: 2026-10-19 · Status: diterima · tanpa nomor SPEC (dikerjakan langsung atas permintaan operator)

**Mengamandemen** [ADR-0080](0080-scope-verifikasi-per-sesi.md) (klausa `changed` mendapat aturan
ritme), [ADR-0164](0164-orkestrasi-subagent-per-fase.md) (panduan fase Brainstorm/Audit/Plan dan
batas peran agen fase), dan [ADR-0170](0170-orkestrasi-mutu-subagent-foreground-reviewer-beban.md)
(bentuk berkas plan). **Menegakkan** [ADR-0167](0167-keputusan-ambigu-lead-atau-manusia.md):
keputusan ambigu tetap selalu ditanyakan, tanpa batas jumlah — yang berubah hanya KAPAN ditanyakan.
Nol skema, nol endpoint, nol perubahan kontrak MCP.

## Konteks

Operator: "setiap sesi backlog terasa sangat lama pengerjaannya". Diukur dari transkrip 86 sesi
orchestrator 2026-10-01 … 10-19 — rincian di
[audit durasi sesi backlog](../research/audit-2026-10-19-durasi-sesi-backlog.md). Sesi ≥ 15 menit:
median **89 m** agen aktif + **39 m** menunggu manusia. Overhead hanoman sendiri hitungan detik; waktu
habis di empat tempat yang semuanya digerakkan prompt:

1. **Plan menulis kode lengkap** — median 143 rb token output dan plan 130 KB (maks 378 KB), 22 m
   per fase; Execute lalu mengetik kode yang sama lagi. Sumbernya `superpowers:writing-plans`
   ("kode lengkap di setiap langkah", langkah 2–5 menit).
2. **Putaran tanya tersebar** — median 2 putaran / 11 pertanyaan; putaran lahir sesudah Brainstorm
   (76), Spec (68), Plan (32), Execute (17). Tiap putaran menghentikan sesi; p90 36 m per putaran.
3. **Verifikasi berulang** — median 26 perintah test per Execute, berkas yang sama 6,5× (p90 15×),
   730 typecheck: ±21 m per Execute.
4. **Polling tidur** — 257 perintah `sleep N` = 14,4 jam. Aturan T1 ADR-0164 ("jangan mengakhiri
   giliran selama menunggu proses latar") benar, tetapi tanpa larangan melepas ke latar ia
   menghasilkan polling.

## Keputusan

1. **Plan adalah rencana, bukan kode** (`PLAN_SHAPE`, `runner/src/prompt.ts`). Tiap task = satu
   irisan perilaku terverifikasi: berkas, perilaku, AC, nama + inti test. Isi implementasi dan isi test
   lengkap DILARANG; potongan kode hanya untuk kontrak yang tak boleh ditafsirkan. Sasaran ±300 baris.
   Klausa menyatakan dirinya **mengalahkan** anjuran skill plan mana pun — untuk ketiga metode, karena
   bentuk plan adalah urusan hanoman (gerbang `- [ ]`, ADR-0029), bukan urusan skill. Satu konstanta
   dipakai dua mode: agen fase Plan dan `phaseInstruction` sesi tunggal.
2. **Keputusan dikumpulkan di depan.** Fase pertama yang bertanya — Brainstorm (feature) dan Audit
   (qa) — menarik SEMUA keputusan yang akan dibutuhkan sampai Execute (data model & migrasi, kontrak
   API, scope, perilaku terlihat pengguna, sumber data, kasus tepi) ke satu putaran `Keputusan
   terbuka:`. Semua agen fase dan reviewer memperlakukan keputusan yang sudah dijawab (blok serah-terima
   `Keputusan manusia sejauh ini:`, bagian keputusan dokumen spec/audit) sebagai final dan tak
   menanyakannya ulang. Ambiguitas BARU tetap dilaporkan (0167 utuh); flow `audit` (audit-only) tak
   disentuh.
3. **Ritme verifikasi** (klausa `changed`, `runner/src/verify-scope.ts`): per task hanya berkas test
   task itu; berkas yang sudah hijau tak diulang selama kodenya tak berubah; typecheck sesudah task yang
   mengubah tipe/kontrak ekspor, bukan tiap task; gabungan test tersentuh + typecheck SEKALI di akhir.
4. **Foreground, bukan polling tidur** (`FOREGROUND_RULE`, `runner/src/phase-agents.ts`, agen fase
   dan reviewer): test/typecheck/build dijalankan di foreground berbatas waktu; set yang terlalu lama
   dipecah; proses yang memang harus di latar ditunggu dengan pemeriksaan kesiapan yang berhenti
   sendiri. Aturan T1 tetap.

## Alternatif yang ditolak

- **Mengganti skill plan atau model fase Plan** — mengubah pilihan metode/model operator; klausa
  bentuk plan menyelesaikan akar (volume keluaran) tanpa menyentuh katalog.
- **Batas jumlah pertanyaan / larangan bertanya sesudah Brainstorm** — bertentangan dengan 0167:
  keputusan yang tak ditanyakan diputuskan diam-diam.
- **Menyalakan hanoman-lead otomatis** — mengubah prinsip "manusia terakhir yang memutuskan" per
  project; tetap opt-in (ADR-0091).
- **Penegakan lewat hook** (menolak `sleep`, menghitung run test) — ADR-0037 mencabut guardrail
  perintah; ini panduan biaya, sama seperti ADR-0080.
- **Reviewer berhenti menjalankan test** — independensinya disengaja (ADR-0170 P2); tak diubah.

## Konsekuensi & gotcha

- Golden mode sesi tunggal (`runner/test/__golden__`) dan hash definisi agen fase claude/codex
  (`phase-agents.test.ts`, SPEC-1442) diperbarui sengaja; hash klausa orchestrator tak berubah.
- Plan yang lebih tipis berarti Execute menulis kodenya sendiri dari spec + plan — itu memang yang
  terjadi sebelumnya juga (kode di plan diketik ulang), jadi tak ada tanggung jawab yang berpindah.
- Prompt hidup di ARGV agen (ADR-0108); klausa baru hanya menyebut `sleep N` sebagai contoh yang
  dilarang.
- Dua tindak lanjut lain dari audit yang sama berada di luar ADR ini: notifikasi keputusan ke Telegram
  (ADR-0226) dan snapshot DB test di repo erp-tumbuh-ai.
- Ukur ulang dengan metode yang sama sesudah ±2 minggu: median fase Plan, putaran tanya per sesi,
  perintah test per Execute, dan total `sleep N`.
