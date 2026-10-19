# Audit 2026-10-19 — Mengapa sesi backlog terasa sangat lama

Keluhan operator: "setiap sesi backlog terasa sangat lama pengerjaannya". Dokumen ini mencatat
pengukurannya; keputusannya di [ADR-0225](../adr/0225-memangkas-durasi-sesi-backlog.md).

## Sumber data & metode

- Transkrip Claude Code (`~/.claude/projects/*worktrees-spec-*/*.jsonl` + `subagents/*.jsonl` beserta
  `.meta.json` → `agentType`) untuk **86 sesi orchestrator** backlog yang lahir 2026-10-01 … 10-19,
  project erp-tumbuh-ai (`base.tumbuh.ai`) dan crm-tumbuh-ai (`kirimchat-multi`). Sesi Codex tidak
  ikut.
- Waktu tool = selang `tool_use` → `tool_result`; waktu tunggu manusia = selang `AskUserQuestion`
  (digabung bila paralel) + jeda sebelum prompt operator; waktu model = sisa waktu aktif.
- Ukuran plan = panjang konten `Write`/`Edit` ke `…/plans/…` oleh agen `hanoman-fase-plan`.

## Temuan

| Komponen (sesi ≥ 15 menit, N = 73) | Nilai |
|---|---|
| Agen aktif per sesi | median **89 m** (total 120 j) |
| Menunggu manusia per sesi | median **39 m** (total 173 j; 80 j di antaranya `AskUserQuestion`) |

| Fase | n | median | p90 |
|---|---|---|---|
| Execute | 68 | 38 m | 97 m |
| Plan | 62 | 22 m | 35 m |
| Spec | 60 | 9,5 m | 13 m |
| Review Execute | 67 | 8,5 m | 24 m |
| Brainstorm | 60 | 2,4 m | 5 m |
| Objective | 57 | 0,6 m | 0,7 m |

1. **Putaran tanya tersebar.** Median 2 putaran / 11 pertanyaan per sesi (p90 4 / 21). Putaran
   sesudah Brainstorm 76, Spec 68, Plan 32, Execute 17. Waktu jawab per putaran median 5,2 m, p90
   **36 m** — sesi diam selama itu.
2. **Plan menulis kode lengkap.** 70 fase Plan: median **143 rb token output**, plan median
   **130 KB** (p90 224 KB, maks 378 KB). 21,6 dari 24,2 jam fase Plan adalah waktu model. Penyebab:
   `superpowers:writing-plans` meminta kode lengkap di setiap langkah; Execute lalu mengetiknya lagi
   (rata-rata ±128 rb token output).
3. **Verifikasi berulang di Execute.** 92 Execute: median 26 perintah test per sesi, berkas test yang
   sama dijalankan **6,5×** (p90 15×), 730 typecheck (p50 22 d, p90 92 d). Test + typecheck ≈ 21 m per
   Execute.
4. **Polling jeda tidur.** 257 perintah `sleep N` di Execute = **14,4 jam**, 75 % di 10 sesi: proses
   dilepas ke latar lalu dicek tiap 3–10 menit.
5. **Harness test repo target** (erp-tumbuh-ai, di luar repo ini): `apps/api/test/helpers/db.ts`
   menerapkan 332 migrasi untuk setiap DB test — **883 ms** per DB vs **0,45 ms** dengan snapshot
   `serialize()`/`deserialize()`. `tsc` di repo itu membawa 218 galat bawaan dan OOM di heap default.

Overhead hanoman sendiri (memanggil agen fase, marker, fase Objective) hanya hitungan detik.

## Tindak lanjut

- Prompt agen fase & sesi tunggal — ADR-0225 (repo ini).
- Notifikasi keputusan ke Telegram — ADR-0226 (branch terpisah).
- Snapshot DB test — repo erp-tumbuh-ai (branch `perf/test-db-snapshot`).
- hanoman-lead sebagai pemutus tetap opt-in per project (ADR-0091); tidak dinyalakan otomatis.
