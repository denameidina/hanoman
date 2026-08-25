# CLAUDE.md

Instruksi khusus **Claude Code** untuk membangun hanoman. Melengkapi `AGENTS.md`.

## Baca Dulu

1. Baca `AGENTS.md`.
2. Baca skill project `internal/skills/hanoman/SKILL.md`.
3. Baca index Source of Truth `internal/docs/README.md`.
4. Baru baca doc SoT yang relevan dengan task setelahnya.

Jangan mulai implementasi dari ingatan atau konteks chat saja saat doc/skill project sudah ada.

## Konteks
hanoman adalah orchestrator + dashboard workflow docs-driven, didistribusikan sebagai **paket npm global** (`npm i -g hanoman` → `hanoman`, SPEC-398/ADR-0087). Frontend React+TS (Vite). Server Node+TS (Fastify): pekerjaan berjalan sebagai **sesi `claude` interaktif** di tmux (`server/src/services/pty.ts`) di **git worktree terisolasi** per backlog, **SQLite (Prisma 6)** untuk state (tujuh model inti: Project/Spec/Setting/Notification/User/Session/Vps) — satu berkas di `$HANOMAN_HOME`, default `~/.hanoman/hanoman.db`, **tanpa Docker/Postgres** (ADR-0086). **Tidak ada** message queue/Redis, worker terpisah, scheduler cron, maupun webhook GitHub — semuanya dicabut saat pindah ke sesi interaktif (ADR-0024). Realtime: **WebSocket untuk terminal PTY + satu kanal siar `/api/events/ws`** untuk data dashboard — sepuluh grup snapshot global — termasuk `presence`, sesi hidup lintas device (SPEC-919/ADR-0147) — plus langganan berparameter (Scheduler/Triase/Lead/GitGraph/Tim); klien tak lagi men-poll HTTP (ADR-0039, diamandemen ADR-0145). Detail di `internal/skills/hanoman/SKILL.md` dan `internal/docs/architecture/stack.md`.

## Kebiasaan
- TypeScript strict. Test untuk setiap logika orchestrasi (trigger, queue, worktree, guardrail).
- Jaga UI responsif: log sesi streaming, jangan blok main thread.
- Update `internal/docs` yang tersentuh **dalam commit yang sama** & tautkan di `internal/docs/README.md`.
- Ikuti design system di `internal/docs/design-system/**` (editorial, bone paper, brass accent).
- **Setiap selesai satu task execute:** centang checklist task/step yang selesai di file plan (`docs/superpowers/plans/**`, `- [ ]` → `- [x]`), lalu jalankan **test yang tersentuh perubahan itu** (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism` atau sebut path test-nya) — bukan suite penuh, bukan `pnpm -r typecheck` (SPEC-376, ADR-0080). **`--no-file-parallelism` wajib** bila set-nya menyentuh test server: run tingkat-root **tidak** menghormati `fileParallelism: false` milik project server, dan test server berbagi **satu berkas DB** (`<db>.test.db`, dimigrasi otomatis `server/test/global-setup.ts`) → terukur di SPEC-397, set `--changed` yang sama memberi **181 gagal palsu** paralel vs **736 lulus** serial. **Tambahkan `TEST_DATABASE_URL` bila ada sesi lain berjalan di mesin ini** (SPEC-479, mengoreksi klaim SPEC-398 "per checkout, aman dari worktree tetangga"): berkas itu diturunkan dari **`HANOMAN_HOME`**, bukan dari checkout, jadi semua worktree memakai satu `~/.hanoman/hanoman.test.db` — dan `global-setup.ts:15` **menghapusnya** (`rmSync`) di awal tiap run, sehingga run tetangga menghapus DB di tengah run kita. Terukur pada set yang sama: **99 → 2 → 0 gagal** semata-mata sebagai fungsi isolasi DB. Pakai `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"`; suite yang gagal ramai dengan **404/P2022** hampir selalu ini, bukan regresi. Bila task menyentuh endpoint, **test API-nya secara nyata di local** sekali di akhir: boot server (`pnpm dev` atau `node server/dist/server.js`) dan curl endpoint yang tersentuh. Kalau masih ada issue, fixing dulu sampai hijau sebelum lanjut ke task berikutnya.

## Jangan
- Guardrail Source of Truth telah dicabut (SPEC-160, ADR-0023): `internal/docs/**` tetap Source of Truth secara konvensi — perbarui docs yang tersentuh dalam commit yang sama — tetapi tak ada lagi gate/Stop hook yang memblokir. Jangan menambahkannya kembali tanpa ADR baru. (Guardrail deny perintah berbahaya di `runner/src/safety.ts` juga telah dicabut — SPEC-197, ADR-0037; agen dipercaya penuh, isolasi murni lewat worktree. Jangan hidupkan kembali tanpa ADR baru.)
- Jangan ubah skema tanpa migration + ADR.
- Jangan jalankan run di working tree utama — selalu worktree terpisah.

## Agent skills

### Issue tracker

Issue dilacak sebagai GitHub Issues di `denameidina/hanoman`, lewat `gh` CLI. Lihat `docs/agents/issue-tracker.md`.

### Triage labels

Kosakata label kanonik apa adanya: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Lihat `docs/agents/triage-labels.md`.

### Domain docs

Single-context: satu `CONTEXT.md` di root, ADR terpusat di `internal/docs/adr/`. Lihat `docs/agents/domain.md`.
