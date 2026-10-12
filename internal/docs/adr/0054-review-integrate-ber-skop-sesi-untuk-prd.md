# ADR-0054 — Review + integrate ber-skop sesi untuk sesi project-level (PRD)

**Status:** accepted · **Date:** 2026-07-19 · **Spec:** SPEC-230 · **sebagian diamandemen [0215](0215-review-sesi-keadaan-kosong-tanpa-409.md)**: worktree sesi yang lenyap kini 200 `empty` (`no-commit`), bukan 409; `…/review/*` tetap 409.
**Terkait:** [ADR-0041](0041-prd-sebagai-dokumen-flow-project-level.md) (PRD dokumen, project-level),
[ADR-0031](0031-rebase-merge-backlog.md) (rebase/merge branch dari dashboard),
[ADR-0030](0030-spec-menyimpan-base-head-sha.md) (base/head SHA), [ADR-0011](0011-docs-realtime-filesystem.md)
(docs = filesystem), [ADR-0002](0002-git-worktree-isolation.md) (isolasi worktree)

## Context
Sesi PRD (ADR-0041) adalah **sesi project-level**: `flow: "prd"`, id `prd-<slug>`, worktree
`.worktrees/prd-<slug>`, push ke branch `prd/<slug>`, **tanpa `Spec`**. Prompt PRD menutup dengan
*"Manusia yang me-review lalu merge"* — jadi affordance review+merge memang diniatkan, seragam
dengan reverse-docs & done-spec.

Tapi review dan integrate selama ini **terkopel penuh ke `Spec`** (SPEC-230 audit):
- Frontend `TerminalScreen` `Cell` menggerbangi tombol review/merge pada `session.specId`.
- Server `GET /specs/:id/review` & `POST /specs/:id/integrate` menuntut baris `Spec`
  (`baseSha`/`headSha`, `stage === "done"`, branch `hanoman/<specid>`).

Sesi PRD tak punya `specId`, tak menyimpan SHA, dan bekerja di `prd/<slug>` — sehingga selnya di
Terminal tampil **polos**, tanpa aksi lanjutan. Inilah keluhan SPEC-230.

## Decision
Beri sesi PRD jalur **review + rebase/merge ber-skop sesi**, keyed ke worktree + branch **sesi**,
bukan `Spec`. **Tanpa perubahan skema** — PRD tetap dokumen, bukan entitas DB (ADR-0041/0011).

1. **Branch integrasi disimpan pada sesi.** `createSession` menerima opsi `branch`; disimpan sebagai
   opsi tmux `@hanoman_branch` dan disurfacekan lewat `SessionInfo` → `SessionDTO.branch` (wire) →
   `TerminalSession.branch` (client). Server & UI **tak menebak** nama branch dari id. Diset untuk
   `flow: "prd"` (= `prd/<slug>`); jalur `reverse`/`scaffold` sengaja belum di-opt-in (di luar skop
   keluhan), tapi mekanismenya generik.

2. **Integrate digeneralisasi ke branch eksplisit.** `services/integrate.ts` menerima
   `{ branch, mergeId }` alih-alih `specId` saja: `resolveSource` mencari `origin/<branch>` →
   fallback lokal `<branch>`; worktree integrasi = `.worktrees/merge-<sanitize(mergeId)>`.
   `sourceBranch(specId)` = `hanoman/<specid>` tetap ada untuk pemanggil Spec (kompatibel).
   - Spec: `integrate(repoDir, { branch: sourceBranch(spec.id), mergeId: spec.id }, op, target)`.
   - Sesi: `integrate(repoDir, { branch: session.branch, mergeId: session.id }, op, target)`.

3. **Endpoint ber-skop sesi (baru):**
   - `GET /terminal/sessions/:id/review` (+ `/review/*`) — diff worktree hidup sesi. Mengulang
     `services/spec-review.ts` dengan **id sesi sebagai kunci worktree** (`worktreeDir(repoDir, id)`
     = `s.cwd`; `baseSha`/`branchFrom` = `null` → `mergeBase` jatuh ke default repo/HEAD, SPEC-227).
     Worktree tak ada (sesi sudah ditutup) → **409** (cermin empty-state ReviewScreen).
   - `POST /terminal/sessions/:id/integrate { op, target }` — pakai `session.branch` sebagai source.
     Bersih → `{ status:"clean", detail }`; konflik → spawn sesi claude di worktree `merge-<id>`
     (tanpa flow → tak menggerakkan stage, ADR-0031), `{ status:"conflict", sessionId }`. Branch
     belum ada → 409 (dari `integrate`).

4. **Frontend.** `ReviewScreen` menerima `kind: "spec" | "session"` (default `spec`) → memilih
   `api.specReview*` vs `api.sessionReview*`. `IntegrateDialog` digeneralisasi ke
   `{ projectId, ownBranch, eyebrow }` (bukan `Spec`). `Cell` menampilkan review+merge untuk sesi
   dengan `session.branch` (mis. PRD), memakai handler ber-skop sesi di `App`.

## Batas (ceiling)
Review sesi PRD hanya sah **selama sesi hidup** (worktree ada). Sesudah ditutup, worktree dibuang &
tak ada SHA tersimpan → review 409; hanya branch `prd/<slug>` tersisa. Ini sengaja — konsisten
dengan ceiling ADR-0041. **Integrate** tetap jalan kapan pun branch ada (beroperasi pada ref).
Upgrade path bila perlu: review berbasis range `merge-base(default, prd/<slug>)..prd/<slug>`.

## Alternatif ditolak
- **Beri PRD sebuah `Spec`** (agar endpoint lama langsung jalan): melanggar ADR-0041 (PRD bukan
  entitas DB) + butuh migration/ADR. Ditolak.
- **Turunkan branch dari id di server/klien** (`prd-<slug>` → `prd/<slug>`): rapuh terhadap slug
  ber-tanda-hubung & flow lain. Menyimpan branch di sesi lebih jujur & generik.
- **Gerbang `flow === "prd"` di frontend saja** (tanpa endpoint): tombol muncul tapi 404/ tak ada
  yang dikerjakan server. Bukan perbaikan.

## Consequences
- Sesi PRD kini punya review (diff dokumen PRD) + rebase/merge, seragam dengan brief/qa — persis
  yang diminta SPEC-230.
- Tanpa perubahan skema; `SessionDTO` bertambah satu field opsional `branch` (aditif, wire-compatible).
- `services/integrate.ts` kini generik atas branch; pemanggil Spec tak berubah perilaku.
- Mekanisme siap diperluas ke `reverse`/`scaffold` bila diminta (tinggal set `branch` saat spawn).

## Acceptance (EARS)
- **AC-1** — WHEN operator menjalankan create PRD lalu membuka Terminal, THE sel sesi PRD SHALL
  menampilkan tombol **review** (`git-compare`) dan **rebase/merge** (`git-merge`).
- **AC-2** — WHEN operator membuka review sesi PRD selagi sesi hidup, THE server SHALL mengembalikan
  diff worktree PRD (dokumen `docs/prd/<slug>.md` dsb.) via `GET /terminal/sessions/:id/review`.
- **AC-3** — WHEN operator memilih merge/rebase sesi PRD ke target sah dan tak ada konflik, THE
  server SHALL mengintegrasikan branch `prd/<slug>` dan mengembalikan `{ status:"clean" }`.
- **AC-4** — WHEN integrasi sesi PRD menemui konflik, THE server SHALL men-spawn sesi claude di
  worktree `merge-<id>` dan mengembalikan `{ status:"conflict", sessionId }`.
- **AC-5** — WHERE branch `prd/<slug>` belum ada (sesi belum push), THE integrate SHALL 409 jelas.
- **AC-6** — WHERE sesi PRD sudah ditutup (worktree lenyap), THE review SHALL 409 jelas, bukan 500.
- **AC-7** — THE perilaku review/integrate sesi **brief/qa** (Spec) SHALL tak berubah (regresi nol).
