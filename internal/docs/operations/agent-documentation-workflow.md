# Agent documentation workflow

Kontrak operasional untuk hanoman + Claude Code.

- Docs di `internal/docs/**` adalah **Source of Truth**.
- Sebelum plan execute: **Update the index. Link every doc.**
- **Fitur:** spec → plan → execute. **QA:** audit → **keputusan** → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped`; keputusan dielicit lewat prompt & diambil agen (SPEC-145/ADR-0020, mekanisme SPEC-204/ADR-0040).
- **Audit-only** (SPEC-237/[ADR-0057](../adr/0057-audit-only-source-flow.md)): source `audit` → flow `audit` = **audit → laporan**, berhenti. Hanya menghasilkan dokumen audit `internal/docs/research/audit-<spec-id>-<slug>.md` (Audit→systematic-debugging; Laporan→tulis dokumen + link index), **tanpa perbaikan kode**. Bila perlu diperbaiki, dinaikkan jadi Finding QA (qa → audit → spec → plan → execute) lewat "Jadikan Finding QA". Aksi Terminal (preview docs/review/merge/fullscreen) sama seperti brief/qa.
- **Dokumen audit berumur** (SPEC-386/[ADR-0083](../adr/0083-retensi-dokumen-audit.md)): laporan audit di atas hidup sampai eskalasinya diputuskan (ADR-0076) **dan** spec turunannya tuntas, lalu **dihapus berikut entri indexnya**. Tiga syarat sebelum menghapus: (1) temuannya sudah punya jejak permanen — ADR, baris di doc SoT, atau perbaikan kode ter-commit; (2) rujukan masuk dari doc permanen (`Rincian & bukti: [audit SPEC-nnn](…)`) dialihkan atau dilepas di commit yang sama, kalau tidak link-nya mati; (3) index `internal/docs/README.md` **tidak** menyimpan abstrak audit. ADR tidak ikut berumur (ADR-0021).
- Prompt sesi memetakan fase → skill superpowers (SPEC-166): Brainstorm→brainstorming,
  Audit→systematic-debugging, Plan→writing-plans, Execute→executing-plans + TDD +
  verification-before-completion. Objective/Spec adalah keluaran brainstorming.
- **From-scratch:** pilih folder → hanoman `git init` repo → sesi **scaffold** interaktif: brainstorm
  (satu pertanyaan/giliran) → kunci objective → menyusun seluruh doc index dari ide, pakai STANDAR DOCS
  yang sama dengan reverse (SPEC-222, ADR-0052). Tombol "Scaffold docs" di layar project + `autoScaffold`
  (auto-start setelah buat project); hasil di branch `scaffold-docs`, manusia merge.
- **Existing:** sesi interaktif menyusun docs dari codebase (SPEC-166, ADR-0026): Scan → Docs teknis → Wawancara → Konvensi & index → Serah terima, hasil di branch `reverse-docs`. Pemicu ganda seperti scaffold — CTA **Tambah/Clone → reverse-engineer docs** saat project dibuat memulainya langsung, tombol **Reverse docs** di layar project mengulanginya (SPEC-848).
- Guardrail Source of Truth dicabut (SPEC-160, ADR-0023) — lihat bagian di bawah.
- Setiap sesi di worktree terpisah; commit di worktree, lalu integrasi (rebase/merge) ke target dipicu manual dari dashboard (SPEC-175/ADR-0031); perbarui docs yang tersentuh dalam commit yang sama.

## Guardrail (SPEC-002, dicabut SPEC-160/ADR-0023)
`internal/docs/**` tetap Source of Truth secara **konvensi**: diperbarui dalam commit yang sama,
ter-link di index. Tapi tak ada lagi yang **menegakkannya** secara mekanis — Stop hook (`hanoman
hook stop`), gate Execute (`hanoman docs verify`), dan switch dashboard "Source of Truth" semuanya
dicabut. `hanoman docs scan` tetap ada sebagai laporan coverage read-only (tak memblokir apa pun).

## Eksekusi (sesi interaktif)
Eksekusi adalah **sesi `claude` interaktif di tmux** (`server/src/services/pty.ts`), bukan runner
headless — Agent SDK dicabut (ADR-0010), spawn headless per-run dicabut (ADR-0024). Satu backlog =
**satu sesi** di `<repoDir>/.worktrees/<spec-id>` (ADR-0015), dengan fase sebagai giliran di dalam sesi
itu (`echo "<Fase> done" >> $HANOMAN_PHASE_FILE`). Fase Execute tidak lagi lewat gate docs — dicabut
SPEC-160/ADR-0023. Sesi di-steer/interupsi lewat terminal dashboard; commit terjadi di worktree, dan
integrasi ke branch lain dipicu manual (SPEC-175). Lihat ADR-0002 (isolasi) dan ADR-0016 (sesi tmux).

## Kredensial Claude
Sesi memakai auth Claude Code yang sama dengan sesi harian: `claude` membaca token dari Keychain macOS
atau `~/.claude/.credentials.json`, dengan alternatif env `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`
(lihat `.env.example`). Tak ada lagi verifikasi kredensial saat boot worker — tak ada worker. Indikator
limit membaca token OAuth yang sama untuk memanggil usage API (`services/limits.ts`, ADR-0024).

## Evaluasi custom agent (SPEC-950 · ADR-0159)

Eval live selalu **opt-in** dan memakai kuota runtime:

```bash
pnpm agent:eval --runtime claude|codex [--agent name] [--output path]
```

Manifest `evals/custom-agents/manifest.ts` membawa satu kasus positif + satu kontrol untuk setiap
delapan builtin. Harness menyalin `base/` ke repo `mktemp`, membuat commit, menimpa `change/` untuk
membentuk diff, lalu memakai renderer produk Claude/Codex. Repo temp selalu dibuang di `finally`;
report default hidup di temp report terpisah dan output eksplisit **ditolak** bila menunjuk ke source
eval. Harness membandingkan hash source sebelum/sesudah.

Saat seluruh katalog dijalankan untuk Codex, kasus builtin berprofil `isolated-worktree` dilaporkan
sebagai `SKIP` karena profil itu belum didukung child Codex; memilih agen itu secara eksplisit
berakhir gagal dengan alasan yang sama. Skip kompatibilitas tidak dihitung sebagai lulus atau gagal.

Test rutin tidak menjalankan model. Ia hanya menjalankan scorer terhadap `frozen-output`: semua
expected finding harus cocok (`recall=1`) dan forbidden hit harus nol. Exit live nonzero bila CLI
runtime gagal, expected hilang, atau forbidden muncul. Jangan memasukkan `agent:eval` ke install,
boot, build, test rutin, atau CI.
