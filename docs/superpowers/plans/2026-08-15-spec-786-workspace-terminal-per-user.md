# Workspace Terminal Per-User Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use CommonMark checkboxes for tracking. Sesi ini berjalan inline; jangan dispatch sub-agent tanpa permintaan eksplisit pengguna.

**Goal:** Persistenkan grup, urutan, grid, dan pemetaan `sessionId` Terminal sebagai state server per akun admin dengan revision/CAS, migrasi legacy localStorage yang aman, serta render responsive yang tidak mengubah layout kanonik.

**Architecture:** `@hanoman/shared` mendefinisikan schema `TerminalWorkspaceV1`; tiga field additive pada `User` menyimpan JSON, revision, dan waktu update secara LOCAL-only. Route cookie-only `GET/PUT /api/terminal/workspace` melakukan validasi dan optimistic concurrency, sedangkan hook frontend memegang state machine load/seed/cache/retry/reconcile dan memberi `TerminalScreen` satu pintu mutasi kanonik.

**Tech Stack:** TypeScript strict, Zod, Prisma 6.19 + SQLite, Fastify, React 19, Vitest + Testing Library.

## Global Constraints

- Server adalah source of truth setelah bootstrap; `localStorage` baru hanya cache recovery per-user dan tidak pernah diunggah otomatis.
- Payload kanonik tepat `{version:1,groups}`; `active`, `activeCell`, fullscreen, modal, dan tier responsive tetap lokal.
- Satu `sessionId` paling banyak satu sel di seluruh grup; rows/cols 1–12, groups 1–24, cells tepat `rows*cols`.
- Semua route workspace cookie-only dan bergantung `req.user.id`; jangan memakai device sync ADR-0043/0045 atau WebSocket baru.
- Rekonsiliasi hanya setelah GET workspace dan `listTerminals()` sama-sama sukses.
- Konflik stale harus 409 + snapshot current; frontend reapply operasi satu kali, lalu fail visible dan refetch.
- Verifikasi hanya paket/test yang tersentuh; test server selalu memakai `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan `--no-file-parallelism`.
- Commit hanya sekali setelah seluruh fase selesai, sesuai instruksi sesi; docs SoT dan kode berada pada commit yang sama.

---

### Task 1: Kontrak Workspace Kanonik dan Adapter Legacy

**Files:**
- Create: `shared/src/terminal-workspace.ts`
- Create: `shared/src/terminal-workspace.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `src/src/screens/terminal-workspace.ts`
- Modify: `src/test/terminal-workspace.test.ts`

**Interfaces:**
- Produces: `TerminalWorkspaceV1`, `TerminalWorkspaceSnapshot`, `zTerminalWorkspaceV1`, `zTerminalWorkspaceWrite`, `sameTerminalWorkspace` dari `@hanoman/shared`.
- Produces frontend adapters: `toCanonical(ws)`, `fromCanonical(workspace, active?)`, `readLegacy()`, `clearLegacy()`, `readCache(userId)`, `writeCache(userId, value)`.
- Cache value: `{ workspace: TerminalWorkspaceV1; revision: number; active: string }`.

- [x] **Step 1: Tulis test merah untuk schema dan invariant lintas-grup**

```ts
const valid = { version: 1 as const, groups: [
  { id: "g1", name: "Utama", layout: { rows: 1, cols: 2, cells: ["s1", null] } },
] };
expect(zTerminalWorkspaceV1.parse(valid)).toEqual(valid);
expect(() => zTerminalWorkspaceV1.parse({ ...valid, version: 2 })).toThrow();
expect(() => zTerminalWorkspaceV1.parse({ version: 1, groups: [
  ...valid.groups,
  { id: "g2", name: "Debug", layout: { rows: 1, cols: 1, cells: ["s1"] } },
] })).toThrow(/sessionId/i);
expect(() => zTerminalWorkspaceV1.parse({ version: 1, groups: [
  { ...valid.groups[0], layout: { rows: 2, cols: 2, cells: [null] } },
] })).toThrow();
```

- [x] **Step 2: Jalankan test schema dan buktikan merah**

Run: `pnpm vitest --run shared/src/terminal-workspace.test.ts --no-file-parallelism`

Expected: FAIL karena modul/export belum ada.

- [x] **Step 3: Implementasikan schema v1 dan equality**

```ts
export const zTerminalWorkspaceV1 = z.object({
  version: z.literal(1),
  groups: z.array(z.object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(80),
    layout: z.object({
      rows: z.number().int().min(1).max(12),
      cols: z.number().int().min(1).max(12),
      cells: z.array(z.string().trim().min(1).max(256).nullable()),
    }).strict(),
  }).strict()).min(1).max(24),
}).strict().superRefine((workspace, ctx) => {
  const groups = new Set<string>();
  const sessions = new Set<string>();
  for (const [groupIndex, group] of workspace.groups.entries()) {
    if (groups.has(group.id)) ctx.addIssue({ code: "custom", path: ["groups", groupIndex, "id"], message: "group id duplikat" });
    groups.add(group.id);
    if (group.layout.cells.length !== group.layout.rows * group.layout.cols)
      ctx.addIssue({ code: "custom", path: ["groups", groupIndex, "layout", "cells"], message: "jumlah cells tidak cocok dimensi" });
    for (const [cellIndex, sessionId] of group.layout.cells.entries()) {
      if (sessionId === null) continue;
      if (sessions.has(sessionId)) ctx.addIssue({ code: "custom", path: ["groups", groupIndex, "layout", "cells", cellIndex], message: "sessionId duplikat" });
      sessions.add(sessionId);
    }
  }
});
export const zTerminalWorkspaceWrite = z.object({
  baseRevision: z.number().int().nonnegative(), workspace: zTerminalWorkspaceV1,
}).strict();
export const sameTerminalWorkspace = (a: TerminalWorkspaceV1, b: TerminalWorkspaceV1) =>
  JSON.stringify(a) === JSON.stringify(b);
```

- [x] **Step 4: Tulis test merah adapter legacy/cache lalu implementasikan adapter**

```ts
localStorage.setItem(W.KEY, JSON.stringify({ active: "g1", groups: valid.groups }));
expect(W.readLegacy()).toEqual({ workspace: valid, active: "g1" });
W.writeCache("u1", { workspace: valid, revision: 7, active: "g1" });
expect(W.readCache("u1")?.revision).toBe(7);
expect(W.readCache("u2")).toBeNull();
expect(W.fromCanonical(W.toCanonical(view), view.active)).toEqual(view);
```

`readLegacy()` hanya membaca/validasi dan tidak menghapus. `clearLegacy()` menghapus kedua key lama.
`readCache()` memvalidasi ulang `workspace`, revision non-negatif, dan active string; semua operasi
storage dibungkus `try/catch`.

- [x] **Step 5: Jalankan test shared + adapter sampai hijau**

Run: `pnpm vitest --run shared/src/terminal-workspace.test.ts src/test/terminal-workspace.test.ts --no-file-parallelism`

Expected: dua berkas PASS; test `load/save` lama diganti test adapter/cache, invariant layout lama tetap PASS.

---

### Task 2: Migration dan API Optimistic Concurrency Per-User

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260815000000_terminal_workspace_user/migration.sql`
- Create: `server/src/services/terminal-workspace.ts`
- Create: `server/src/routes/terminal-workspace.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/services/agent-capabilities.ts`
- Create: `server/test/terminal-workspace.route.test.ts`
- Modify: `server/test/agent-capabilities.test.ts`

**Interfaces:**
- Consumes: `zTerminalWorkspaceV1`, `zTerminalWorkspaceWrite`, `TerminalWorkspaceSnapshot`.
- Produces: `readTerminalWorkspace(userId)` dan `writeTerminalWorkspace(userId, baseRevision, workspace)`.
- Route: `GET/PUT /api/terminal/workspace`, cookie admin only.

- [x] **Step 1: Tulis test route merah untuk empty, dua user, valid write, stale write, invalid payload**

```ts
const a = await login("a@x.co", "password1");
const b = await login("b@x.co", "password2");
expect((await get(a)).json()).toEqual({ workspace: null, revision: 0, updatedAt: null });
const saved = await put(a, { baseRevision: 0, workspace: workspace("session-a") });
expect(saved.json()).toMatchObject({ revision: 1, workspace: workspace("session-a") });
expect((await get(b)).json()).toEqual({ workspace: null, revision: 0, updatedAt: null });
const stale = await put(a, { baseRevision: 0, workspace: workspace("stale") });
expect(stale.statusCode).toBe(409);
expect(stale.json()).toMatchObject({ code: "revision-conflict", current: { revision: 1 } });
expect((await put(a, { baseRevision: 1, workspace: { version: 2, groups: [] } })).statusCode).toBe(400);
```

Tambahkan test yang menulis JSON DB rusak melalui Prisma cast dan memastikan GET 422 tanpa mengubah row.

- [x] **Step 2: Jalankan test API dan buktikan merah**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/terminal-workspace.route.test.ts server/test/agent-capabilities.test.ts --no-file-parallelism`

Expected: FAIL karena kolom/route belum ada dan capability masih `sessions:*`.

- [x] **Step 3: Tambahkan field + migration additive dan generate client**

```prisma
terminalWorkspace          Json?
terminalWorkspaceRevision  Int       @default(0)
terminalWorkspaceUpdatedAt DateTime?
```

```sql
ALTER TABLE "User" ADD COLUMN "terminalWorkspace" JSONB;
ALTER TABLE "User" ADD COLUMN "terminalWorkspaceRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "terminalWorkspaceUpdatedAt" DATETIME;
```

Run: `pnpm --filter ./server exec prisma generate`

- [x] **Step 4: Implementasikan service CAS dan route cookie-only**

```ts
export async function writeTerminalWorkspace(userId: string, input: TerminalWorkspaceWrite) {
  const updatedAt = new Date();
  const changed = await prisma.user.updateMany({
    where: { id: userId, terminalWorkspaceRevision: input.baseRevision },
    data: {
      terminalWorkspace: input.workspace,
      terminalWorkspaceRevision: { increment: 1 },
      terminalWorkspaceUpdatedAt: updatedAt,
    },
  });
  const current = await readTerminalWorkspace(userId);
  return changed.count === 1 ? { ok: true as const, current } : { ok: false as const, current };
}
```

Route memakai `req.user!.id`; stored JSON non-null yang gagal `zTerminalWorkspaceV1.safeParse`
melempar error domain dan dipetakan 422. Di `capabilityForRoute`, deteksi `top === "terminal" &&
seg[1] === "workspace"` sebelum mapping generik terminal, hasil selalu `COOKIE_ONLY`.

- [x] **Step 5: Jalankan test server sampai hijau dan verifikasi migration dari DB kosong**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run server/test/terminal-workspace.route.test.ts server/test/agent-capabilities.test.ts --no-file-parallelism`

Run: `DATABASE_URL="file:$(mktemp -d)/migrate.db" pnpm --filter ./server exec prisma migrate deploy`

Expected: tests PASS; migrate deploy menerapkan seluruh migration tanpa reset/error.

---

### Task 3: Path/API Client dan State Machine Sinkronisasi Frontend

**Files:**
- Modify: `shared/src/api.ts`
- Modify: `src/src/api/client.ts`
- Create: `src/src/screens/use-terminal-workspace.ts`
- Create: `src/test/use-terminal-workspace.test.tsx`

**Interfaces:**
- `paths.terminalWorkspace = "/api/terminal/workspace"`.
- `api.getTerminalWorkspace(): Promise<TerminalWorkspaceSnapshot>`.
- `api.putTerminalWorkspace(input: TerminalWorkspaceWrite): Promise<TerminalWorkspaceSnapshot>`.
- Hook output:

```ts
type TerminalWorkspaceController = {
  workspace: W.Workspace;
  status: "loading" | "ready" | "recovering" | "conflict";
  message: string | null;
  writable: boolean;
  mutate(change: (workspace: W.Workspace) => W.Workspace): Promise<boolean>;
  refresh(): Promise<void>;
};
```

- [x] **Step 1: Tulis test hook merah untuk load-before-write, seed, cache read-only, dan browser kosong**

```ts
getWorkspace.mockResolvedValueOnce({ workspace: null, revision: 0, updatedAt: null });
const { result } = renderHook(() => useTerminalWorkspace("u1"));
expect(result.current.writable).toBe(false);
await waitFor(() => expect(result.current.status).toBe("ready"));
expect(putWorkspace).not.toHaveBeenCalled();

localStorage.setItem(W.KEY, JSON.stringify(legacy));
getWorkspace.mockResolvedValueOnce({ workspace: null, revision: 0, updatedAt: null });
putWorkspace.mockResolvedValueOnce({ workspace: canonical, revision: 1, updatedAt: NOW });
renderHook(() => useTerminalWorkspace("u1"));
await waitFor(() => expect(putWorkspace).toHaveBeenCalledWith({ baseRevision: 0, workspace: canonical }));
```

Tambahkan kasus GET reject + cache u1: layout tampil, `writable=false`, mutation tidak PUT; u2 tidak membaca cache u1.

- [x] **Step 2: Jalankan test hook dan buktikan merah**

Run: `pnpm vitest --run src/test/use-terminal-workspace.test.tsx --no-file-parallelism`

Expected: FAIL karena hook/path/client belum ada.

- [x] **Step 3: Implementasikan bootstrap server-first dan refresh focus/visible terserialisasi**

Gunakan satu promise queue untuk seluruh GET/PUT agar respons refresh lama tak dapat menang atas
mutasi. Bootstrap:

```ts
if (snapshot.workspace) adopt(snapshot, currentActive), W.clearLegacy();
else if (W.readLegacy()) seedWithRevisionZero();
else adoptEmptyRevisionZeroWithoutPut();
```

Event listeners memanggil `refresh()` pada `focus` dan `visibilitychange` hanya saat
`document.visibilityState === "visible"`, lalu dilepas saat unmount.

- [x] **Step 4: Tulis test konflik dua device lalu implementasikan reapply bounded**

```ts
putWorkspace
  .mockRejectedValueOnce(new ApiError(409, "conflict", { code: "revision-conflict", current: remote }))
  .mockResolvedValueOnce({ workspace: reapplied, revision: remote.revision + 1, updatedAt: NOW });
await act(() => result.current.mutate((ws) => W.renameGroup(ws, "g1", "Baru")));
expect(putWorkspace).toHaveBeenNthCalledWith(2, {
  baseRevision: remote.revision,
  workspace: expect.objectContaining({ groups: [expect.objectContaining({ name: "Baru" })] }),
});
expect(result.current.status).toBe("conflict");
```

Retry tepat satu kali. Konflik kedua memanggil GET/adopt terbaru, mengembalikan `false`, dan tidak
menjalankan PUT ketiga. Error jaringan mengubah status ke `recovering` tanpa menulis cache baru.

- [x] **Step 5: Jalankan test hook sampai hijau**

Run: `pnpm vitest --run src/test/use-terminal-workspace.test.tsx src/test/terminal-workspace.test.ts --no-file-parallelism`

Expected: PASS termasuk focus/visible, race seed 409, cache per-user, dan konflik bounded.

---

### Task 4: Integrasikan Controller ke TerminalScreen dan Rekonsiliasi Tmux

**Files:**
- Modify: `src/src/App.tsx`
- Modify: `src/src/screens/TerminalScreen.tsx`
- Modify: `src/test/terminal-screen.test.tsx`
- Modify mocks API parsial pada test Terminal yang terdampak TypeScript bila diperlukan.

**Interfaces:**
- `TerminalScreen` menerima prop baru `userId: string`; `App` mengirim `me.id`.
- Semua mutasi kanonik memakai `void controller.mutate(change)`; `selectGroup` dan `activeCell` tetap lokal.
- `sessionsLoaded` true hanya saat `listTerminals()` resolve; reject tidak pernah menjadi daftar kosong otoritatif.

- [x] **Step 1: Ubah fixture/mocks dan tulis test merah bahwa server state menang sebelum render/mutasi**

Tambahkan mock `getTerminalWorkspace`/`putTerminalWorkspace` dengan default snapshot server. Test:

```ts
getTerminalWorkspace.mockResolvedValue({ workspace: canonicalWith("remote-session"), revision: 4, updatedAt: NOW });
listTerminals.mockResolvedValue([{ id: "remote-session", projectId: "p1", cwd: "/repo", exited: false }]);
render(<TerminalScreen userId="u1" projects={projects} />);
expect(await screen.findByText("remote-session")).toBeInTheDocument();
expect(putTerminalWorkspace).not.toHaveBeenCalled();
```

- [x] **Step 2: Implementasikan prop/controller dan ganti seluruh writer `setWs` kanonik**

Writer yang wajib lewat `mutate`: add/rename/remove group, add/remove row/column, place, detach,
place sesi baru, hasil picker backlog, restart history, focus session, serta placement mobile.
`onSelect` group hanya memperbarui `active` lokal melalui method controller yang tidak PUT; bila
hook tidak menyediakan method terpisah, `setActive(id)` wajib ditambahkan pada interface.

- [x] **Step 3: Implementasikan status/disable recovery yang terlihat**

Toolbar menampilkan `data-testid="terminal-workspace-status"`:

- loading: “Memuat layout server…”;
- recovering: “Layout server belum tersambung” + tombol Retry;
- conflict: “Layout berubah di perangkat lain”;
- ready: tidak perlu badge permanen.

Saat `writable=false`, disable/hilangkan kontrol add/remove/rename/place/detach; kontrol presentasi
(pilih grup/cell, fullscreen) dan close session tetap aktif.

- [x] **Step 4: Tulis test merah rekonsiliasi lalu implementasikan gerbang dua sumber**

```ts
let resolveSessions!: (value: TerminalSession[]) => void;
listTerminals.mockReturnValue(new Promise((resolve) => { resolveSessions = resolve; }));
render(<TerminalScreen userId="u1" projects={projects} />);
await waitFor(() => expect(getTerminalWorkspace).toHaveBeenCalled());
expect(putTerminalWorkspace).not.toHaveBeenCalled();
resolveSessions([]);
await waitFor(() => expect(putTerminalWorkspace).toHaveBeenCalledWith(expect.objectContaining({
  workspace: expect.objectContaining({ groups: [expect.objectContaining({ layout: expect.objectContaining({ cells: [null] }) })] }),
})));
```

Kasus `listTerminals.reject` harus mempertahankan cell dan tidak PUT. Effect membandingkan canonical
sebelum/selesai reconcile supaya snapshot sesi identik tidak menghasilkan write loop.

- [x] **Step 5: Jalankan test layar Terminal sampai hijau**

Run: `pnpm vitest --run src/test/terminal-screen.test.tsx src/test/terminal-history-button.test.tsx src/test/terminal-cleanups.test.tsx src/test/new-terminal-runtime.test.tsx --no-file-parallelism`

Expected: semua PASS dan benar-benar menjalankan test (bukan “no test files”).

---

### Task 5: Bukti Desktop → Tablet → Mobile Tidak Mengubah Kanonik

**Files:**
- Modify: `src/test/terminal-screen.test.tsx`
- Modify: `src/test/viewport.ts` bila helper belum dapat memancarkan perubahan tier pada rerender.

**Interfaces:**
- Tidak menambah API produksi; ini kontrak regresi atas `useResponsiveTier` + `TerminalScreen`.

- [x] **Step 1: Tulis test simulasi lintas tier dengan layout 2 grup dan koordinat tetap**

```ts
const canonical = workspaceWith({ group: "g-debug", rows: 2, cols: 2, cells: [null, "session-x", null, null] });
getTerminalWorkspace.mockResolvedValue({ workspace: canonical, revision: 9, updatedAt: NOW });
listTerminals.mockResolvedValue([{ id: "session-x", projectId: "p1", cwd: "/repo", exited: false }]);
mockViewport(1440);
render(<TerminalScreen userId="u1" projects={projects} />);
// desktop → tablet → mobile; emit media change pada tiap langkah
expect(cell("g-debug", 1)).toHaveTextContent("session-x");
expect(putTerminalWorkspace).not.toHaveBeenCalled();
```

Test juga memilih panel mobile lain dan kembali; payload cache/server tetap group `g-debug`, cell 1.

- [x] **Step 2: Jalankan test dan buktikan merah bila resize memicu writer**

Run: `pnpm vitest --run src/test/terminal-screen.test.tsx --no-file-parallelism`

Expected sebelum penyesuaian: test baru FAIL bila helper tidak memancarkan tier atau ada PUT responsive.

- [x] **Step 3: Perbaiki hanya proyeksi responsive/test hook yang diperlukan**

Jangan menambah conditional layout mutation. Tablet/desktop boleh berbeda DOM dari mobile, tetapi
`controller.workspace.groups` yang dipakai semua tier harus objek yang sama; hanya `activeCell` dan
`aria-hidden` lokal yang berubah.

- [x] **Step 4: Jalankan test responsive + layout hingga hijau**

Run: `pnpm vitest --run src/test/terminal-screen.test.tsx src/test/responsive.test.tsx src/test/terminal-layout.test.ts --no-file-parallelism`

Expected: PASS, session tetap pada indeks row-major yang sama, nol PUT karena tier.

---

### Task 6: Source of Truth dan ADR-0118

**Files:**
- Create: `internal/docs/adr/0118-workspace-terminal-kanonik-per-user.md`
- Modify: `internal/docs/adr/0115-state-tampilan-dashboard-persisten.md`
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/requirements/frd.md`
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/skills/hanoman/SKILL.md`

**Interfaces:**
- Docs harus menyebut field User, shape v1, GET/PUT/409, cookie-only, bootstrap/cache, reconcile gate, dan responsive invariant dengan nama yang sama seperti kode.

- [x] **Step 1: Tulis ADR-0118 dan tandai ADR-0115 diamandemen**

ADR-0118 berisi konteks, keputusan User+revision, state kanonik vs presentasional, kontrak seed,
alternatif ditolak, konsekuensi, dan invariant. ADR-0115 mendapat status terkait bahwa baris
“workspace grid tetap di key lama” diamandemen oleh 0118; state tampilan lain tetap utuh.

- [x] **Step 2: Perbarui kedua index ADR**

Tambahkan satu baris link 0118 di `internal/docs/README.md` dan narasi ringkas di
`internal/docs/adr/README.md`. Jangan memindahkan/menghapus ADR lama.

- [x] **Step 3: Perbarui data model, API contract, FRD, frontend, dan skill proyek**

Gunakan terminology persis `TerminalWorkspaceV1`, `baseRevision`, `revision-conflict`,
`terminalWorkspaceRevision`, dan cache `hanoman.terminal.workspace.v2.<userId>`. Hapus klaim lama
“Nol perubahan server” untuk layout Terminal dan ganti dengan sejarah/amandemen yang akurat.

- [x] **Step 4: Verifikasi integritas docs**

Run: `pnpm exec hanoman docs index --check` bila binary workspace tersedia; fallback:
`hanoman docs index --check`.

Run: `git diff --check`

Expected: index check PASS dan tidak ada whitespace error/link path salah.

---

### Task 7: Verifikasi Terbatas, Smoke Endpoint, dan Checklist Final

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-spec-786-workspace-terminal-per-user.md` (centang semua task)
- Tidak membuat berkas produk baru kecuali fix yang ditemukan verifikasi.

**Interfaces:**
- Verifikasi akhir mencakup shared/server/src saja; cli tidak disentuh karena tidak ada model baru/PG_ORDER change.

- [x] **Step 1: Jalankan seluruh test terkait dengan DB terisolasi**

Run:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run \
  shared/src/terminal-workspace.test.ts \
  src/test/terminal-workspace.test.ts \
  src/test/use-terminal-workspace.test.tsx \
  src/test/terminal-screen.test.tsx \
  src/test/terminal-history-button.test.tsx \
  src/test/terminal-cleanups.test.tsx \
  src/test/new-terminal-runtime.test.tsx \
  src/test/responsive.test.tsx \
  src/test/terminal-layout.test.ts \
  server/test/terminal-workspace.route.test.ts \
  server/test/agent-capabilities.test.ts \
  --no-file-parallelism
```

Expected: semua berkas ditemukan dan PASS; periksa summary jumlah file/test bukan nol.

- [x] **Step 2: Jalankan typecheck hanya paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck`

Run: `pnpm --filter ./server typecheck`

Run: `pnpm --filter ./src typecheck`

Expected: ketiganya exit 0. Jangan `pnpm -r typecheck`.

- [x] **Step 3: Boot server sekali dan curl kontrak GET/PUT/409 nyata**

Pakai temp home/DB dan port yang dipastikan kosong dengan `lsof`; jalankan server per-PID, bukan
`pkill`. Setup admin ke cookie jar, lalu:

```bash
curl -b "$COOKIE_JAR" "$BASE/api/terminal/workspace"
curl -b "$COOKIE_JAR" -X PUT -H 'content-type: application/json' \
  --data '{"baseRevision":0,"workspace":{"version":1,"groups":[{"id":"g1","name":"Utama","layout":{"rows":1,"cols":1,"cells":[null]}}]}}' \
  "$BASE/api/terminal/workspace"
curl -b "$COOKIE_JAR" -X PUT -H 'content-type: application/json' \
  --data '{"baseRevision":0,"workspace":{"version":1,"groups":[{"id":"g1","name":"Stale","layout":{"rows":1,"cols":1,"cells":[null]}}]}}' \
  "$BASE/api/terminal/workspace"
```

Expected: status/body berurutan 200 revision 0, 200 revision 1, 409 `revision-conflict` current revision 1. Hentikan tepat PID server.

- [x] **Step 4: Audit diff, checklist, dan phase gate**

Run: `git diff --name-only "$HANOMAN_BASE_SHA"...HEAD` dan `git status --porcelain` untuk daftar perubahan.

Run: `rg -n -- '- \[ \]' docs/superpowers/plans/2026-08-15-spec-786-workspace-terminal-per-user.md`

Expected: setelah langkah ini seluruh checkbox plan tercentang, `git diff --check` bersih,
dan tidak ada file tak terkait.

- [x] **Step 5: Commit dan push branch sesi**

```bash
git add shared src server internal docs/superpowers
git commit -m "feat(spec-786): persist terminal workspace per user"
git push origin HEAD:refs/heads/hanoman/spec-786
```

Expected: commit sukses dan remote branch menunjuk commit yang sama. Baru sesudah itu tulis
`Execute done` ke `$HANOMAN_PHASE_FILE`.
