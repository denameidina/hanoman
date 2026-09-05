# Worktree sesi yatim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Temukan checkout yatim saat boot dan pungut setelah konfirmasi operator di Worktrees.

**Architecture:** Input history/tmux dirakit satu service untuk boot dan API. Klasifikasi dan pemungutan menerima deps; rename ketat menyerahkan byte kepada reaper yang sudah ada.

**Tech Stack:** TypeScript, Fastify, Prisma SQLite, React, Vitest, git/tmux.

**Spec:** `docs/superpowers/specs/2026-09-05-spec-1109-worktree-yatim-design.md`.

## Global Constraints

- Tanpa penghapusan otomatis, skema/migrasi, layar baru, atau penghapusan worktree operator selama pengembangan.
- Reaper tetap hanya `.trash/**`; rename gagal mempertahankan path asal.
- Tmux gagal dibaca bukan daftar kosong. Pane exited juga melindungi checkout.
- Semua test server serial dengan DB temporer; typecheck shared/server/app berurutan.
- Commit implementasi dan seluruh docs bersama setelah verifikasi; push ke `hanoman/spec-1109`.

### Task 1: Deteksi yatim dari riwayat dan tmux

Files: `server/src/services/worktree-list.ts`, `session-history.ts`, baru
`worktree-project.ts`; `server/src/server.ts`; `server/src/routes/ide.ts`;
`shared/src/dto.ts`, `src/src/api/client.ts`.
Tests: `server/test/worktree-list.test.ts`, baru `worktree-project.test.ts`.

Interfaces: `WorktreeInputs.history?: WorktreeHistory[]`,
`WorktreeView.orphan?: {historyId: string; sessionId: string}`;
`projectWorktreeInputs(projectId): Promise<WorktreeInputs>`;
`detectOrphanWorktrees(deps): Promise<{projectId: string; count: number}[]>`.

- [x] Tambahkan test kandidat history `reconciled` tanpa pane pada repo fixture.

```ts
expect(row.orphan).toEqual({ historyId: "h1", sessionId: "spec-1" });
expect(row.session).toBeNull();
```

- [x] Jalankan test itu dan buktikan gagal karena `orphan` belum tersedia.
- [x] Implementasikan klasifikasi latest history per path fisik, menolak history closed terbaru dan semua pane yang cocok id/cwd. Beri test untuk history terbuka, symlink, history nihil, dan path digunakan ulang.

```ts
const latest = historyByPath.get(real(path));
if (latest && (!latest.endedAt || latest.endedReason === "reconciled")
    && !hasWorktreeSession(path, latest.sessionId, inputs.sessions)) {
  row.orphan = { historyId: latest.id, sessionId: latest.sessionId };
}
```

- [x] Rakit pembaca history + tmux bersama di `worktree-project.ts`, gunakan di route dan deteksi boot setelah `reconcileHistory`; injected deps menguji tmux throw dan no deletion. Jalankan kedua test hingga hijau.

### Task 2: Pemungutan dengan pemeriksaan ulang

Files: `server/src/services/worktree-list.ts`, `worktree-reaper.ts`, `server/src/routes/ide.ts`.
Tests: baru `server/test/worktree-collect.test.ts`, `worktree-reaper.test.ts`, `worktrees.route.test.ts`.

Interfaces: `collectOrphanWorktrees(repoDir, names, deps)` dengan `inputs()` async,
`sessionsNow()` sync, `release(repo,path)` sync, `prune(repo)` async.
`releaseWorktreeToTrash(repoDir,cwd,projectId,deps?)` throws ketika rename gagal.

- [x] Tulis dan jalankan test merah: kandidat dipindah, kandidat bukan yatim ditolak, pane muncul kembali atau tmux throw sebelum rename tidak memindahkan checkout.

```ts
expect(result.results[0].ok).toBe(false);
expect(existsSync(worktree)).toBe(true);
```

- [x] Implementasikan daftar ulang per baris, nama unik/deletable/orphan wajib, pemeriksaan tmux sinkron terakhir, lalu release ketat tanpa await di antaranya. Jangan closeSession atau deleteBranch.

```ts
if (hasWorktreeSession(w.path, w.orphan.sessionId, deps.sessionsNow())) {
  throw new Error("worktree kembali dipakai sesi; muat ulang daftar");
}
row.cleanup = deps.release(repoDir, w.path);
await deps.prune(repoDir);
```

- [x] Ekstrak pelepasan ketat dengan rename injected; wrapper lama mempertahankan fallback-nya. Test rename throw membuktikan tidak ada penghapusan path asal. Route `orphanOnly: true` memakai mode baru; tolak kombinasi deleteBranch dan nilai orphanOnly bukan boolean.
- [x] Jalankan test kolektor, reaper, route dengan DB terisolasi hingga hijau.

### Task 3: Worktrees dan dampak yang jujur

Files: `src/src/screens/WorktreesPanel.tsx`, `src/src/api/client.ts`, `shared/src/dto.ts`,
`server/src/services/worktree-list.ts`.
Tests: `src/test/worktrees-panel.test.tsx`, `server/test/worktree-list.test.ts`.

Interfaces: `WorktreeStats.dirtyFiles` dan `orphanCommits` menjadi `number | null`;
`api.deleteWorktrees(id,{names,orphanOnly:true})`.

- [x] Tulis/jalankan test merah untuk badge/jumlah yatim, tombol konfirmasi, cancel, payload orphanOnly, serta statistik tak terbaca yang tidak diklaim nol.

```ts
fireEvent.click(screen.getByRole("button", { name: /Pungut yatim/ }));
expect(await screen.findByText(/termasuk berkas ignored/)).toBeInTheDocument();
```

- [x] Tambahkan ringkasan dan tombol hanya untuk kandidat yatim deletable. Gunakan `ask(names, orphanOnly)` dan dialog yang sudah ada; selalu nyatakan hilangnya seluruh isi, jangan menyatakan aman hanya karena nol. Mode yatim tidak memakai checkbox branch.
- [x] Ubah kegagalan status/rev-list menjadi null dan tampilkan dampak tidak diketahui untuk null maupun request stats gagal. Jalankan test UI/list hingga hijau.

### Task 4: Verifikasi, dokumentasi, dan pengiriman

Files: `internal/docs/architecture/api-contract.md`, `internal/docs/adr/0162-*`,
`internal/docs/README.md`, `internal/docs/adr/README.md`, audit/spec/plan sesi ini.

- [x] Perbarui kontrak API dan keputusan audit; cek link docs serta `git diff --check`.
- [x] Jalankan test terkait (list, project, collect, reaper, route, history, panel, IDE tab); typecheck shared, server, app secara berurutan.
- [x] Boot server fixture lokal terisolasi sekali, curl list/stats/collect; pastikan kandidat bertahan sebelum konfirmasi dan dilepas sesudahnya, lalu tutup PID server milik smoke.
- [x] Minta review `blast-radius` dan `security-reviewer`; perbaiki temuan yang terbukti dan verifikasi ulang bagian yang berubah.
- [x] Pastikan seluruh implementasi dan dokumen siap dikirim, tanpa task yang tertinggal.

Sesudah seluruh task selesai: append `Execute done`, commit seluruh diff, lalu
`git push origin HEAD:refs/heads/hanoman/spec-1109` dan cocokkan SHA remote.


## Hasil verifikasi

2026-09-05: 106 test dalam 10 berkas lulus, serial dengan DB SQLite temporer dan
`HANOMAN_TMUX_SOCKET=hanoman-test-spec-1109`. Berkas: worktree-list, worktree-project,
worktree-collect, worktree-reaper, worktrees.route, session-history.service,
tmux-errors, telegram-confirmation, worktrees-panel, ide-worktrees-tab. Typecheck
shared → server → app lulus berurutan. Tidak menjalankan suite/build/lint penuh.

Smoke HTTP melalui Fastify nyata di loopback dengan repo/DB/home/socket terisolasi:
deteksi boot menemukan satu yatim; GET daftar mempertahankan berkas kerja; GET stats
menjawab dirtyFiles=1; POST orphanOnly memberi cleanup `spec-smoke.<stempel>`;
GET berikutnya tidak lagi memuat registrasinya. PID smoke ditutup tersendiri.

Review blast-radius dan security-reviewer menemukan tiga jalur: id pane hilang pada
cwd kembar, EACCES/EMFILE tmux terbaca kosong, dan konfirmasi Telegram terlewati.
Ketiganya direproduksi dengan test merah, diperbaiki, lalu hijau. Review keamanan
ulang tidak menemukan temuan konkret tambahan.
