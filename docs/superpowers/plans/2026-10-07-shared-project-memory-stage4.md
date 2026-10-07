# Memori Project Bersama — Tahap 4 (Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator mengelola memori project dari dashboard — antrean review, daftar aktif dengan verdict mesin ini, arsip, riwayat, hapus permanen — dan mengatur allowlist project agent token tanpa curl.

**Architecture:** Halaman bernavigasi baru `/memori[/<projectId>]` (pola Workspace QA: `routes.ts` + `HN_NAV` + cabang `section` di App + `Door` di ProjectDetail). Server memperkaya `GET /api/memories` dengan `local` (verdict `MemoryLocalState` + `needsConfirm`), menambah topik langganan `memory` (frame = *revision*, layar refetch saat berubah), `PendingCounts.memory`, dan notifikasi `memory` untuk usulan yang butuh review. Settings → Akses AI Agent mendapat `MultiSelect` project saat membuat token dan editor allowlist per token.

**Spec:** [desain](../specs/2026-10-07-shared-project-memory-design.md) §5. Tahap 1–3: ADR-0178/0179/0180.

## Keputusan (disetujui operator 2026-10-07)

| # | Keputusan |
|---|---|
| A | Halaman sidebar tersendiri `/memori`, bukan kartu di ProjectDetail |
| B | Badge sidebar = total `proposed` lintas project; per-project di tab "Perlu review (n)" |
| C | Notifikasi hanya untuk memori yang butuh review (`proposed`) |
| D | "Perlu dikonfirmasi" = `active` dan tak dipakai (atau tak pernah dipakai sejak dibuat) ≥ 90 hari; konstanta `MEMORY_CONFIRM_DAYS = 90` di shared |

## Global Constraints

- Ikuti `internal/docs/design-system/design-system.md`: komponen dari `src/src/ds` (`Card`, `Badge`, `Tabs`, `StateBlock`, `Button`, `Field`/`Input`/`HnTextarea`, `MultiSelect`, `useConfirm`, `Modal`); tanpa warna/tipografi baru; setiap field berlabel; placeholder = contoh berawalan `mis. ` (dikunci `src/test/placeholder-contract.test.ts`).
- Layar memakai `useApi()` (bukan `api` langsung) supaya ikut instance remote.
- Realtime lewat `useLiveTopic` (ADR-0039 · SPEC-908) — tanpa `setInterval` polling di layar.
- Test frontend: `pnpm vitest --run <paths>`; test server: `env -u HANOMAN_CONTROL_ORIGINS -u HANOMAN_PUBLIC_ORIGINS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run <paths> --no-file-parallelism`.
- Tanpa perubahan skema. ADR-0181 untuk keputusan UI/realtime.

---

### Task 1: Server — `local` di daftar, revision, pending, notifikasi

**Files:** `shared/src/memory.ts` (`MemoryLocalView`, `MEMORY_CONFIRM_DAYS`, `MemoryListItem`), `server/src/services/memory/store.ts` (`searchMemories` → item + `local`; `memoryRevision`), `shared/src/pending.ts`, `server/src/services/pending-counts.ts`, `server/src/services/notifications.ts` (`recordMemoryReview`), `shared/src/entities.ts` (enum notifikasi), test `server/test/memory-dashboard.test.ts`.

- [x] **Step 1: Test yang gagal** — cakupan:
  - `searchMemories` mengembalikan `local: { verdict, lastUsedAt, lastVerifiedAt, needsConfirm }`; tanpa baris `MemoryLocalState` → `verdict: null`.
  - `needsConfirm` true untuk `active` dengan `lastUsedAt` 91 hari lalu, atau tanpa `lastUsedAt` dan `createdAt` 91 hari lalu; false untuk `proposed`.
  - `memoryRevision(projectId)` berubah setelah propose dan setelah invalidate; sama bila tak ada perubahan.
  - `pendingCounts().memory` = jumlah `proposed` lintas project.
  - Usulan yang masuk review membuat satu `Notification` `type: "memory"` dengan `key` `memory:<id>` dan `projectId`; usulan yang auto-aktif tidak; propose kedua untuk id yang sama tak menduplikasi.
- [x] **Step 2: Implementasi**
  - `shared/src/memory.ts`:

```ts
// ADR-0181 · "perlu dikonfirmasi": memori aktif yang tak tersuntik/terpakai selama ini.
export const MEMORY_CONFIRM_DAYS = 90;
export type MemoryLocalView = {
  verdict: "valid" | "stale" | "unverifiable" | null;   // null = belum pernah diverifikasi di mesin ini
  lastUsedAt: string | null; lastVerifiedAt: string | null; needsConfirm: boolean;
};
export type MemoryListItem = MemoryView & { local: MemoryLocalView };
export function needsConfirm(m: { status: string; createdAt: string }, lastUsedAt: string | null, now = Date.now()): boolean {
  if (m.status !== "active") return false;
  const since = Date.parse(lastUsedAt ?? m.createdAt);
  return now - since >= MEMORY_CONFIRM_DAYS * 86_400_000;
}
```

  - `searchMemories` membaca `memoryLocalState` untuk id hasil (satu `findMany({ where: { memoryId: { in } } })`) dan mengembalikan `{ items: MemoryListItem[], total }`.
  - `memoryRevision(projectId)`: `${count}:${max(updatedAt)}` dari `projectMemory.aggregate` per project (semua status) — perubahan status menyentuh `updatedAt` (`@updatedAt`).
  - `PendingCounts` += `memory` (komentar definisi di daftar), `EMPTY_PENDING`, `pendingTotal`; server `pendingCounts()` += `prisma.projectMemory.count({ where: { status: "proposed" } })`.
  - `recordMemoryReview(m: { id; projectId; content; reviewReason })` meniru `recordTicket` (`key: memory:<id>`, title `Memori butuh review: <content dipotong 80>`), dipanggil di `store.create()` sesudah commit bila `status === "proposed"`. Enum `type` notifikasi di `shared/src/entities.ts` += `"memory"`.
- [x] **Step 3: PASS** + `memory*.test.ts`, test pending server yang ada. **Step 4: Commit** `feat(memory): daftar memori membawa verdict mesin ini, revision, pending & notifikasi review`

---

### Task 2: Server — topik langganan `memory`

**Files:** `shared/src/dto.ts` (`EventTopic` += `"memory"`, `zTopicParams.memory = z.object({ projectId: z.string().max(120) }).strict()`, `EventMsg` += `{ t: "memory"; key: string; revision: string }`), `server/src/services/events-topics.ts` (`memory: { everyTicks: 3, build: async (p) => ({ revision: await memoryRevision(p.projectId) }) }`), test di `src/test/events-topics.test.ts` / test server topik yang ada (cari `TOPIC_NAMES` di `server/test`).

- [ ] Test: topik `memory` terdaftar, parameter `projectId` wajib, build mengembalikan `revision`. Implementasi. PASS. Commit `feat(memory): topik langganan memory (revision) di /events/ws`.

---

> **Catatan eksekusi:** URL & key nav memakai `memory` (`/memory[/<projectId>]`, label "Memori"), seragam dengan key Inggris lain (`team` → "Tim"); rencana awal `/memori`. Task 3 & 4 di-commit bersama karena test kontrak nav menuntut setiap key nav punya cabang `section` di App. Test layar ada di `src/test/memory-workspace.test.tsx` (butuh helper `events-stub`). `placeholder-contract` sudah gagal di base dengan 15 entri yang sama; tak ada entri dari berkas memori.

### Task 3: Klien API + rute + nav + badge + notifikasi

**Files:** `shared/src/api.ts` (`paths.memories`, `paths.memory`), `src/src/api/client.ts` (`memories(projectId, {status,q})`, `memory(projectId,id)`, `reviewMemory(projectId,id,decision,reason?)`, `invalidateMemory(projectId,id,reason)`, `deleteMemory(projectId,id)`; `createAgentToken`/`patchAgentToken` menerima `projectIds`), `src/src/routes.ts` (`/memori[/<projectId>]`), `src/src/ds/shell.tsx` (`HN_NAV` += `{ key: "memory", label: "Memori", icon: "brain" }` setelah `qa`; key `memory` = key `PendingCounts`), `src/src/App.tsx` (cabang `section === "memory"`, `onGotoMemory` di ProjectDetail), `src/src/screens/ProjectDetailScreen.tsx` (`Door icon="brain" title="Memori" hint="fakta & keputusan project untuk agen"`), notifikasi (`NotificationBell` ikon/label `memory`, `toastFor`, `notifTarget` → `/memori/<projectId>`).

- [x] Test: `routes.test.ts` (round-trip `/memori` & `/memori/p1`), test nav (`changelog-nav`/`qa-nav` pola), `nav-pending-badge` (badge memory), `notif-target` (memory → `/memori/<pid>`), `notification-bell` (label). Implementasi. PASS. Commit `feat(memory): rute, nav, badge, notifikasi & klien API memori`.
- Catatan: path API memakai query `projectId` (cookie) — `GET /api/memories?projectId=…&status=…&q=…`.

---

### Task 4: Layar `MemoryWorkspace`

**Files:** `src/src/screens/memory/MemoryWorkspace.tsx`, `MemoryItem.tsx`, `memory-ui.ts`; test `src/src/screens/memory/MemoryWorkspace.test.tsx` (pola `QaWorkspace.test.tsx`: `vi.spyOn(globalThis, "fetch")` + router URL; `vi.mock("../../api/events", () => eventsStub)` bila `useLiveTopic` menyentuh WS).

- [x] **Step 1: Test yang gagal**
  - Tanpa project → `StateBlock` empty.
  - Tab "Perlu review (n)" default bila ada `proposed`, selain itu "Aktif"; hitungan per tab dari tiga GET (`status=proposed|active` dan arsip `invalidated`+`rejected`).
  - Item menampilkan kind, isi, alasan review (label manusiawi: `decision` → "keputusan", `no-anchor` → "tanpa jangkar", `anchor-unverified` → "jangkar belum terverifikasi", `untrusted-source` → "sumber tak tepercaya"), jangkar, sumber (runtime · sesi · commit 7 karakter), badge verdict lokal (`valid` → ok "terverifikasi", `stale` → warn "usang di mesin ini", `unverifiable`/null → neutral "belum terverifikasi di mesin ini"), badge `needsConfirm` → warn "perlu dikonfirmasi".
  - Setujui → `POST /memories/:id/activate?projectId=` lalu refetch; Tolak membuka dialog alasan (wajib) → `POST …/reject`.
  - Batalkan (aktif) → dialog alasan → `POST …/invalidate` body `{ reason, projectId }`.
  - Hapus permanen → `useConfirm` → `DELETE /memories/:id?projectId=` → toast.
  - "Riwayat" memuat `GET /memories/:id?projectId=` dan menampilkan event (op, aktor, alasan, waktu).
  - Peringatan pengganti ganda: dua memori `active` dengan `supersedesId` sama → banner warn di atas tab Aktif.
  - Pencarian `q` (Field berlabel "Cari", placeholder `mis. migration`) diteruskan ke query.
  - Galat API → toast `errText` dan item tetap.
- [x] **Step 2: Implementasi** — pola `QaWorkspace`: `Select` project di header (label "Project"), `Tabs`, daftar `Card` per memori; `useLiveTopic({ topic: "memory", params: { projectId }, apply: (m) => { if (m.revision !== rev.current) { rev.current = m.revision; void reload(); } }, refetch: reload })`. Dialog alasan = `Modal` + `HnTextarea` berlabel "Alasan" (placeholder `mis. sudah tidak berlaku sejak SPEC-123`).
- [x] **Step 3: PASS** + `placeholder-contract.test.ts`. **Step 4: Commit** `feat(memory): halaman Memori — review, aktif, arsip, riwayat, hapus permanen`.

---

### Task 5: Settings → allowlist project agent token

**Files:** `src/src/screens/SettingsScreen.tsx` (`AgentAccessPanel`), test `src/test/agent-tokens.test.tsx`.

- [x] Test: saat membuat token, `MultiSelect` "Project yang diizinkan (memori)" mengirim `projectIds`; tanpa pilihan, field tak dikirim; baris token menampilkan jumlah/nama project yang diizinkan dan tombol "Atur project" membuka editor (`MultiSelect` + Simpan) yang memanggil `PATCH /agent-tokens/:id { projectIds }` (kosong → `null`); petunjuk teks: memori butuh capability `memory:*` DAN allowlist. Implementasi. PASS. Commit `feat(memory): atur allowlist project agent token dari Settings`.

---

### Task 6: ADR-0181, docs, verifikasi nyata

- [x] ADR-0181 (halaman Memori, revision-topic, `local` per mesin, pending/notifikasi, allowlist UI, konstanta 90 hari); `internal/docs/architecture/frontend-implementation.md` (halaman + pola), `api-contract.md` (`local` di daftar, topik `memory`), `internal/docs/README.md`.
- [x] Test tersentuh (frontend + server) + typecheck src/server/shared.
- [x] Verifikasi nyata: build web (`pnpm --filter ./src build`) dan boot server sementara (skrip tahap 3, `HANOMAN_WEB_DIR` ke hasil build bila perlu), buat project + dua memori (satu `decision` → review, satu berjangkar → aktif) via API; buka `/memori/<pid>` di browser bila tool browser tersedia (screenshot), jika tidak curl HTML + API dan andalkan test komponen. Setujui/tolak via UI atau API, cek badge `pending.memory` lewat frame `/events/ws` atau `pendingCounts`. Catat hasil.
- [x] Centang & commit `docs(memory): ADR-0181 dashboard memori + hasil verifikasi tahap 4`.

## Hasil verifikasi lokal

2026-10-07. Tak ada alat browser di sesi ini (tanpa Playwright/Chrome/browser bawaan) — tampilan visual
belum diperiksa manusia; perilaku dijaga test komponen dan verifikasi nyata HTTP/WS berikut, dengan web
bundle hasil `pnpm --filter ./src build` disajikan server sementara (`HANOMAN_WEB_DIR`, port 8799).

| Kasus | Hasil |
|---|---|
| `GET /memory/memui` (SPA) | `200 text/html`; bundle memuat "Perlu review" |
| Usulan `decision` tanpa jangkar · `gotcha` berjangkar `CLAUDE.md` | `proposed` · `active` |
| `GET /api/memories?status=active` | item membawa `local: { verdict: null, lastUsedAt: null, lastVerifiedAt: null, needsConfirm: false }` |
| `GET /api/notifications` | satu notifikasi `memory`: "Memori butuh review: Pakai SQLite, bukan Postgres" |
| `/api/events/ws` (tiket + cookie + Origin, langganan `memory {projectId}`) | `hello.topics` memuat `memory`; frame `pending.counts.memory = 1`; frame `memory` `revision = "2:…"` |

Test: server tersentuh 52 berkas / 330 lulus; frontend tersentuh 15 berkas / 80 lulus; **seluruh** suite
frontend 2127 lulus, 9 gagal — himpunan berkas gagal identik dengan base (pra-ada). Typecheck
server/cli/shared/src bersih.

> **Catatan eksekusi:** run penuh pertama menemukan tiga regresi yang lolos dari run tersentuh:
> `icon-registry.ts` adalah berkas **generated** (diperbaiki dengan `gen:icons`, bukan sunting tangan), dan
> dua test Settings lama me-mock `api` tanpa `listProjects` (pemuatan project di panel token kini
> gagal-aman). `events-topics` yang ikut gagal adalah timeout di bawah beban, lulus sendiri.
