# Rencana: perbaikan & redesign hasil audit UI/UX (2026-10)

Sumber: `internal/docs/frontend/ui-ux-audit-2026-10.md`. Branch/worktree: `ui-ux-audit`.
Aturan: file dimiliki satu agen per gelombang; test yang tersentuh dijalankan per gelombang (bukan suite penuh); docs
yang tersentuh diperbarui dalam commit yang sama. Baseline gagal sebelum perubahan: lihat bagian Baseline.

## Baseline (sebelum perubahan)
- `cd src && pnpm vitest --run`: 7 gagal / 6 berkas (confirm-inventory bila dijalankan dari `src/`, placeholder-contract,
  git-graph-live, icon-registry, start-session-admission, terminal-history-button, terminal-screen). Dari root:
  `placeholder-contract` gagal (13 field tanpa placeholder + 2 echo) — sudah ada di main.
- `cd src && pnpm typecheck`: bersih.

## Fase 1 — perbaikan (P0 + quick win)
- [x] 1A token kontras, CSS, viewport, Dalang exit mobile (`ds/tokens/colors.css`, `app.css`, `index.html`)
- [x] 1B `App.tsx` digest snapshot WS, grid mobile, sign-out (`auth/AccountMenu.tsx`), notifikasi
- [x] 1C Backlog: hapus spec/lampiran dikonfirmasi, TaskModal busy guard, label konsisten
- [x] 1D Terminal: konfirmasi kill/buang, error tidak ditelan, diagnostik keluar dari panel, jalan keluar keyboard
- [x] 1E Klien + Settings: persist jujur, konfirmasi reset/hapus, `projectId` tab IDE, grant berisiko
- [x] 1F IDE + Docs + Skills: guard draft, Edit saat ref, native prompt/confirm → DS, keyboard
- [x] 1G Scheduler + Lead: input angka, konfirmasi, aria, form tidak hilang saat reload
- [x] 1H QA + Triase: konfirmasi, label Indonesia, empty/error, loading silent
- [x] 1I Projects + PRD + Tim: FolderPicker keyboard & validasi, empty/error, nama project di Tim
- [x] 1J Overview + Dalang + Review/Reconcile + Auth/Setup + Portal + VPS
- [x] 1K verifikasi gabungan: typecheck, test tersentuh, perbandingan baseline, commit

## Fase 2 — fondasi design system
- [x] 2A komponen DS: PageHeader, FilterBar, RowList, Stack/Inline, Text, hover CSS, StatusPill dot
- [x] 2B a11y DS: Field/Input/Select, Radio, Modal inert+h2, shell h1+skip link, Toast antrean + undo, Icon aria-hidden
- [x] 2C command palette + shortcut + notifikasi "Jawab"
- [ ] 2D map label terpusat + glosarium copy + skeleton/loading
- [ ] 2E layout inline → kelas `hn-*`, hapus `!important`/`[style*=`

## Fase 3 — redesign
- [ ] 3A ADR IA baru (17 → 8 menu) + routes/redirect + nav
- [ ] 3B Overview, 3C Settings, 3D Backlog/Tim, 3E Terminal, 3F Triase/Lead, 3G Klien, 3H IDE,
      3I Scheduler, 3J VPS, 3K Skills, 3L Review, 3M Portal, 3N Onboarding
