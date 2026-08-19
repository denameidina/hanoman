# SPEC-844 — Riwayat sesi mencatat **bagaimana** sebuah sesi berakhir · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesi yang mati bersama tmux di luar hanoman berhenti terbaca sebagai `selesai` hijau — ia jadi `terputus`, menjelaskan bahwa hasil & transkripnya tak diketahui, dan menawarkan jalan pemulihan.

**Architecture:** `SessionHistory` mendapat **dua** kolom: `endedReason` (`closed` | `reconciled`) dan `reconciledAt`. Yang disimpan hanya **cara sebuah baris ditutup** — kelas hasilnya (`running`/`completed`/`failed`/`interrupted`) **diturunkan** satu fungsi murni `sessionOutcome()` di `@hanoman/shared`, karena `completed`/`failed` sudah bisa dihitung ulang dari `exitCode` (ADR-0011/0018) sementara "siapa yang menutup barisnya" tidak (arah ADR-0090). Baris lama di-backfill sekali jalan lewat jejak `updatedAt − endedAt` yang terukur memisah bersih.

**Tech Stack:** TypeScript strict · Prisma 6 / SQLite · Fastify · React 18 + Vite · Vitest · zod.

## Global Constraints

- **ADR baru = 0125.** `0124` sudah diklaim worktree `spec-843`; jangan memakainya.
- **Nama migration = `20260819130000_session_history_ended_reason`.** `spec-843` memakai `20260819120000_spec_attachment`; stempel ini sengaja sesudahnya.
- **Migration ditulis tangan**, jangan `prisma migrate dev` — worktree tetangga membuatnya me-reset DB saat ada drift.
- **Test WAJIB ber-`TEST_DATABASE_URL` sendiri dan `--no-file-parallelism`** (SPEC-479/SPEC-397). Perintah kanonik di plan ini:
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path…>`
- **Scope verifikasi = hanya berkas yang berubah.** Jangan `pnpm test`, `pnpm -r typecheck`, atau build penuh.
- **Kosakata kolom apa adanya:** `"closed"` dan `"reconciled"`. Kosakata hasil turunan apa adanya: `"running"`, `"completed"`, `"failed"`, `"interrupted"`. Label UI apa adanya: `berjalan`, `selesai`, `exit <code>`, `terputus`.
- **`satisfies` tidak dipakai di repo ini** — jangan memperkenalkannya; pakai const beranotasi tipe.
- Semua komentar & teks UI berbahasa Indonesia, mengikuti berkas di sekitarnya. Jangan menulis komentar yang mengulang kode.

---

### Task 1: Kosakata & verdict turunan di `@hanoman/shared`

**Files:**
- Create: `shared/src/session-end.ts`
- Create: `shared/src/session-end.test.ts`
- Modify: `shared/src/index.ts` (tambah satu baris ekspor setelah `export * from "./session-kind";`)

**Interfaces:**
- Consumes: —
- Produces:
  - `SESSION_END_REASONS: readonly ["closed", "reconciled"]`
  - `type SessionEndReason = "closed" | "reconciled"`
  - `SESSION_OUTCOMES: readonly ["running", "completed", "failed", "interrupted"]`
  - `type SessionOutcome = "running" | "completed" | "failed" | "interrupted"`
  - `sessionOutcome(r: { endedAt: string | null; endedReason?: string | null; exitCode: number | null }): SessionOutcome`

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/session-end.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SESSION_END_REASONS, SESSION_OUTCOMES, sessionOutcome } from "./session-end";

const row = (over: Partial<Parameters<typeof sessionOutcome>[0]> = {}) => ({
  endedAt: "2026-08-19T02:00:00.000Z", endedReason: "closed" as string | null,
  exitCode: null as number | null, ...over,
});

describe("kosakata", () => {
  it("dua alasan tutup dan empat kelas hasil, apa adanya", () => {
    expect([...SESSION_END_REASONS]).toEqual(["closed", "reconciled"]);
    expect([...SESSION_OUTCOMES]).toEqual(["running", "completed", "failed", "interrupted"]);
  });
});

describe("sessionOutcome (SPEC-844)", () => {
  it("endedAt null = berjalan, apa pun kolom lainnya", () => {
    expect(sessionOutcome(row({ endedAt: null }))).toBe("running");
    expect(sessionOutcome(row({ endedAt: null, endedReason: "reconciled" }))).toBe("running");
  });

  it("ditutup hanoman: exitCode null atau 0 = selesai, selain itu gagal", () => {
    expect(sessionOutcome(row({ exitCode: null }))).toBe("completed");
    expect(sessionOutcome(row({ exitCode: 0 }))).toBe("completed");
    expect(sessionOutcome(row({ exitCode: 1 }))).toBe("failed");
    expect(sessionOutcome(row({ exitCode: 143 }))).toBe("failed");
  });

  it("direkonsiliasi = TERPUTUS, dan exitCode tak bisa membatalkannya", () => {
    expect(sessionOutcome(row({ endedReason: "reconciled" }))).toBe("interrupted");
    expect(sessionOutcome(row({ endedReason: "reconciled", exitCode: 0 }))).toBe("interrupted");
  });

  // Baris sebelum SPEC-844 (784 di DB hidup) tak punya kolom ini — mereka WAJIB terbaca persis
  // seperti sebelumnya, bukan jadi "terputus" massal.
  it("endedReason null/hilang/asing dibaca seperti `closed`", () => {
    expect(sessionOutcome(row({ endedReason: null }))).toBe("completed");
    expect(sessionOutcome({ endedAt: "2026-08-19T02:00:00.000Z", exitCode: 2 })).toBe("failed");
    expect(sessionOutcome(row({ endedReason: "entah-apa" }))).toBe("completed");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/session-end.test.ts`
Expected: FAIL — `Failed to resolve import "./session-end"`.

- [x] **Step 3: Implementasi**

Buat `shared/src/session-end.ts`:

```ts
// SPEC-844 · ADR-0125 · CARA sebuah baris riwayat sesi ditutup — satu-satunya fakta di sini yang
// tak bisa dihitung ulang dari kolom lain. Kelas hasilnya DITURUNKAN (`sessionOutcome`):
// `completed`/`failed` sudah terbaca dari `exitCode`, dan menyimpannya dua kali membuat dua sumber
// yang bisa berselisih (ADR-0011/0018; arah yang sama dengan ADR-0090).
export const SESSION_END_REASONS = ["closed", "reconciled"] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export const SESSION_OUTCOMES = ["running", "completed", "failed", "interrupted"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

// `endedReason` dibaca LONGGAR: kolomnya `String?`, baris sebelum SPEC-844 null, dan nilai asing
// dari instance yang lebih baru tak boleh melempar di boundary. Semua yang bukan `reconciled`
// jatuh ke jalur `closed` — perilaku persis sebelum spec ini. Hanya `reconciled` memindahkan
// verdict, dan ia mengalahkan `exitCode`: pane yang lenyap tak meninggalkan kode untuk dipercaya.
export function sessionOutcome(r: {
  endedAt: string | null; endedReason?: string | null; exitCode: number | null;
}): SessionOutcome {
  if (!r.endedAt) return "running";
  if (r.endedReason === "reconciled") return "interrupted";
  return r.exitCode === null || r.exitCode === 0 ? "completed" : "failed";
}
```

Tambahkan di `shared/src/index.ts`, tepat setelah baris `export * from "./session-kind";`:

```ts
export * from "./session-end";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/src/session-end.test.ts`
Expected: PASS — 4 test.

- [x] **Step 5: Commit**

```bash
git add shared/src/session-end.ts shared/src/session-end.test.ts shared/src/index.ts
git commit -m "feat(spec-844): kosakata akhir sesi & verdict turunan sessionOutcome()"
```

---

### Task 2: Kolom `endedReason` + `reconciledAt` dan backfill sekali jalan

**Files:**
- Modify: `server/prisma/schema.prisma` (model `SessionHistory`, setelah `exitCode`)
- Create: `server/prisma/migrations/20260819130000_session_history_ended_reason/migration.sql`

**Interfaces:**
- Consumes: kosakata `"closed"`/`"reconciled"` dari Task 1 (sebagai literal SQL).
- Produces: kolom Prisma `SessionHistory.endedReason: String?` dan `SessionHistory.reconciledAt: DateTime?`.

- [x] **Step 1: Tambahkan kolom di schema**

Di `server/prisma/schema.prisma`, di dalam `model SessionHistory`, tepat setelah baris `exitCode        Int?`:

```prisma
  // SPEC-844 · ADR-0125 · CARA baris ini ditutup: "closed" (killSession) atau "reconciled" (pane
  // sudah lenyap saat boot — hasilnya tak diketahui). null = baris lahir sebelum kolom ini ada.
  // Kelas hasil (selesai/gagal) sengaja TIDAK disimpan: ia turunan exitCode (sessionOutcome).
  endedReason     String?
  // Kapan boot menemukan panenya lenyap. `endedAt` baris rekonsiliasi adalah batas BAWAH
  // ("terakhir diketahui hidup"); kolom ini batas atasnya.
  reconciledAt    DateTime?
```

- [x] **Step 2: Tulis migration tangan**

Buat `server/prisma/migrations/20260819130000_session_history_ended_reason/migration.sql`:

```sql
-- SPEC-844 · ADR-0125 · riwayat sesi mencatat BAGAIMANA sebuah baris ditutup.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — dua kolom NULLABLE tanpa default, tak ada tabel diredefinisi, jadi
-- jebakan `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` (ADR-0090) tak berlaku di sini.
ALTER TABLE "SessionHistory" ADD COLUMN "endedReason" TEXT;
ALTER TABLE "SessionHistory" ADD COLUMN "reconciledAt" DATETIME;

-- Backfill SEKALI JALAN. Baris lama tak bisa ditanyai, tapi jejaknya masih ada: `reconcileHistory`
-- membaca `updatedAt` SEBELUM update-nya sendiri (jadi `updatedAt` melompat ke waktu boot dan
-- meninggalkan `endedAt` di belakang), sementara `finishSession` menulis `endedAt = new Date()` DI
-- DALAM update yang sama (jadi jaraknya nol). Terukur pada DB hidup 806 baris: tutup normal
-- 0–39 ms (n=777) vs rekonsiliasi 275 966–82 224 277 ms (n=20) — empat orde besaran tanpa satu pun
-- baris di antaranya; ambang 60 000 ms duduk di tengah celah itu.
--
-- Ini backfill, BUKAN aturan render: menjadikannya kontrak akan mengunci detail penyimpanan Prisma
-- sebagai semantik produk. Prisma menyimpan DateTime SQLite sebagai INTEGER milidetik, jadi
-- selisihnya aritmetika biasa; `CAST` dipasang supaya representasi lain (teks ISO) menghasilkan
-- selisih 0 → nol baris cocok → seluruh tabel jatuh ke 'closed', yaitu perilaku sebelum spec ini.
UPDATE "SessionHistory"
   SET "endedReason" = 'reconciled', "reconciledAt" = "updatedAt"
 WHERE "endedAt" IS NOT NULL
   AND CAST("updatedAt" AS INTEGER) - CAST("endedAt" AS INTEGER) > 60000;

UPDATE "SessionHistory"
   SET "endedReason" = 'closed'
 WHERE "endedAt" IS NOT NULL AND "endedReason" IS NULL;
```

- [x] **Step 3: Regenerasi client Prisma**

Run: `pnpm --filter ./server exec prisma generate`
Expected: `Generated Prisma Client (v6.x.x)`.

- [x] **Step 4: Buktikan migration + backfill benar-benar berjalan atas data berbentuk produksi**

Jalankan skrip verifikasi ini apa adanya (DB sekali pakai, tak menyentuh `~/.hanoman`):

```bash
D=$(mktemp -d)/verify.db
DATABASE_URL="file:$D" pnpm --filter ./server exec prisma migrate deploy
sqlite3 "$D" "
INSERT INTO SessionHistory (id,sessionId,projectId,kind,agent,cwd,startedAt,endedAt,updatedAt,createdAt)
VALUES ('n1','s-normal','p','spec','claude','/r',1000000,1060000,1060012,1000000),
       ('r1','s-zombie','p','spec','claude','/r',1000000,1000000,1082224277,1000000);
"
sqlite3 "$D" "SELECT id, endedReason, reconciledAt FROM SessionHistory ORDER BY id;"
```

Skrip di atas menyisipkan baris **setelah** migrate deploy, jadi backfill-nya belum menyentuhnya — jalankan ulang kedua `UPDATE` migration secara manual untuk mengujinya:

```bash
sqlite3 "$D" "$(sed -n '/^UPDATE/,$p' server/prisma/migrations/20260819130000_session_history_ended_reason/migration.sql)"
sqlite3 "$D" "SELECT id, endedReason, reconciledAt FROM SessionHistory ORDER BY id;"
```

Expected persis:
```
n1|closed|
r1|reconciled|1082224277
```

- [x] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260819130000_session_history_ended_reason
git commit -m "feat(spec-844): kolom endedReason & reconciledAt + backfill sekali jalan"
```

---

### Task 3: Service riwayat menulis alasan tutup; DTO membawanya keluar

**Files:**
- Modify: `shared/src/dto.ts:32-38` (`zSessionHistory`)
- Modify: `server/src/services/session-history.ts` (`Row`, `view`, `finishSession`, `reconcileHistory`)
- Test: `server/test/session-history.service.test.ts`

**Interfaces:**
- Consumes: `SessionEndReason` (Task 1); kolom Prisma (Task 2).
- Produces: `SessionHistoryView` bertambah `endedReason: string | null` dan `reconciledAt: string | null` (ISO).

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/session-history.service.test.ts`, di dalam `describe("session-history service (SPEC-362)", …)`, tepat sesudah test `reconcileHistory menutup baris berjalan…` yang sudah ada:

```ts
  // SPEC-844 · ADR-0125 · dua jalur tutup yang dulu tak terbedakan.
  it("finishSession menandai baris `closed` dan TIDAK menyentuh reconciledAt", async () => {
    await beginSession(birth({ sessionId: "tutup" }));
    await finishSession({ sessionId: "tutup", exitCode: null, transcript: null });
    const { items } = await listHistory({ q: "tutup" });
    expect(items[0]).toMatchObject({ endedReason: "closed", reconciledAt: null });
  });

  it("reconcileHistory menandai `reconciled`, menstempel reconciledAt, dan endedAt tetap batas BAWAH", async () => {
    await beginSession(birth({ sessionId: "zombie" }));
    const born = await prisma.sessionHistory.findFirstOrThrow({ where: { sessionId: "zombie" } });
    const before = Date.now();
    expect(await reconcileHistory([])).toBe(1);
    const row = await prisma.sessionHistory.findUniqueOrThrow({ where: { id: born.id } });
    expect(row.endedReason).toBe("reconciled");
    // endedAt = updatedAt SEBELUM update ini — batas bawah "terakhir diketahui hidup", bukan
    // waktu boot. Memindahkannya ke waktu boot mengarang klaim bahwa sesinya hidup selama downtime.
    expect(row.endedAt?.getTime()).toBe(born.updatedAt.getTime());
    expect(row.reconciledAt).not.toBeNull();
    expect(row.reconciledAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("satu sapuan boot memberi SATU stempel reconciledAt untuk semua barisnya", async () => {
    await beginSession(birth({ sessionId: "z1" }));
    await beginSession(birth({ sessionId: "z2" }));
    expect(await reconcileHistory([])).toBe(2);
    const rows = await prisma.sessionHistory.findMany({ where: { sessionId: { in: ["z1", "z2"] } } });
    expect(new Set(rows.map((r) => r.reconciledAt!.getTime())).size).toBe(1);
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-history.service.test.ts
```
Expected: FAIL — tiga test baru; `endedReason` `undefined`/`null` alih-alih `"closed"`/`"reconciled"`.

- [x] **Step 3: Implementasi**

Di `shared/src/dto.ts`, ganti isi `zSessionHistory` (baris 32-38) menjadi:

```ts
export const zSessionHistory = z.object({
  id: z.string(), sessionId: z.string(), projectId: z.string(), specId: z.string().nullable(),
  title: z.string().nullable(), kind: z.string(), flow: z.string().nullable(), agent: z.string(),
  model: z.string().nullable(), effort: z.string().nullable(), branch: z.string().nullable(),
  cwd: z.string(), startedAt: z.string(), endedAt: z.string().nullable(),
  // SPEC-844 · ADR-0125 · `string` longgar, bukan enum: baris lama null dan nilai asing dari
  // instance lebih baru tak boleh melempar di boundary — `sessionOutcome()` yang menafsirkannya.
  endedReason: z.string().nullable(), reconciledAt: z.string().nullable(),
  exitCode: z.number().nullable(), transcriptBytes: z.number().nullable(),
});
```

Di `server/src/services/session-history.ts`:

Tambahkan dua kolom di `type Row` (setelah `exitCode: number | null;`):

```ts
  endedReason: string | null; reconciledAt: Date | null;
```

Tambahkan dua field di `const view` (setelah `exitCode: r.exitCode,`):

```ts
  endedReason: r.endedReason, reconciledAt: r.reconciledAt?.toISOString() ?? null,
```

Ubah impor tipe di baris 4 menjadi:

```ts
import type { Paginated, SessionEndReason, SessionHistoryView } from "@hanoman/shared";
```

Tambahkan tepat di bawah blok impor:

```ts
// Kosakata `endedReason` hidup di @hanoman/shared bersama pembacanya (`sessionOutcome`): penulis
// dan pembaca yang tak sepakat adalah kelas bug SPEC-431/448.
const CLOSED: SessionEndReason = "closed";
const RECONCILED: SessionEndReason = "reconciled";
```

Di `finishSession`, ubah blok `data` menjadi:

```ts
    data: {
      endedAt: new Date(), endedReason: CLOSED, exitCode: d.exitCode,
      transcriptKey: t.key || null, transcriptBytes: t.key ? t.bytes : null,
    },
```

Ganti seluruh badan `reconcileHistory` menjadi:

```ts
export async function reconcileHistory(liveSessionIds: string[]): Promise<number> {
  const open = await prisma.sessionHistory.findMany({
    where: { endedAt: null }, select: { id: true, sessionId: true, updatedAt: true },
  });
  const live = new Set(liveSessionIds);
  // Satu stempel untuk seluruh sapuan: semua baris yang ditemukan mati oleh boot yang sama memang
  // ditemukan pada saat yang sama.
  const at = new Date();
  let closed = 0;
  for (const r of open) {
    if (live.has(r.sessionId)) continue;
    // `updatedAt` = kapan baris ini TERAKHIR disentuh, dan service ini hanya menulis saat lahir &
    // tutup — jadi untuk baris berjalan ia sama dengan waktu lahirnya. Ia dipakai apa adanya
    // sebagai batas BAWAH ("terakhir diketahui hidup"), `reconciledAt` batas atasnya; memindahkan
    // `endedAt` ke `at` akan mengarang klaim bahwa sesinya hidup selama seluruh downtime. UI tak
    // merender durasi baris ini sama sekali (SPEC-844).
    await prisma.sessionHistory.update({
      where: { id: r.id },
      data: { endedAt: r.updatedAt, endedReason: RECONCILED, reconciledAt: at },
    });
    closed++;
  }
  return closed;
}
```

Perbarui juga komentar di atas `reconcileHistory` — kalimat "exitCode tetap null karena memang tak diketahui" kini pindah ke dalam badan fungsi; ganti komentar blok itu menjadi:

```ts
// tmux bisa mati di luar hanoman (kill-server, reboot). Tanpa ini, baris tanpa pane akan selamanya
// terbaca "berjalan". Dipanggil sekali saat boot — cermin backfillFeed saat hub boot (ADR-0067).
// SPEC-844 · ADR-0125 · barisnya ditandai `reconciled`: `exitCode` null di sini berarti "tak
// diketahui", sementara `exitCode` null di jalur `finishSession` berarti "agen masih hidup saat
// ditutup" — dua keadaan yang dulu tak terbedakan dan sama-sama dirender hijau "selesai".
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-history.service.test.ts
```
Expected: PASS — 12 test (9 lama + 3 baru).

Run: `pnpm --filter ./server typecheck`
Expected: keluar tanpa output (exit 0).

- [x] **Step 5: Commit**

```bash
git add shared/src/dto.ts server/src/services/session-history.ts server/test/session-history.service.test.ts
git commit -m "feat(spec-844): finishSession & reconcileHistory mencatat alasan tutup"
```

---

### Task 4: Katalog webhook berhenti memancarkan konflasi yang sama

**Files:**
- Modify: `shared/src/webhook.ts:139-157` (entri `entity: "session"`)
- Test: `server/test/webhook-catalog-dmmf.test.ts` (sudah ada — dijalankan sebagai gerbang, tak diubah)

**Interfaces:**
- Consumes: kolom Prisma dari Task 2.
- Produces: payload `session.*` membawa `endedReason` & `reconciledAt`.

- [x] **Step 1: Jalankan test gerbang lebih dulu untuk melihat baseline HIJAU**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/webhook-catalog-dmmf.test.ts shared/src/webhook.test.ts
```
Expected: PASS. (Test ini yang akan menangkap salah ketik nama kolom di langkah berikutnya — itulah perannya di sini.)

- [x] **Step 2: Ubah katalog**

Di `shared/src/webhook.ts`, pada entri `{ entity: "session", model: "SessionHistory", … }`:

Ganti `fields` menjadi:

```ts
    fields: ["id", "sessionId", "projectId", "specId", "title", "kind", "flow", "agent",
      "model", "effort", "branch", "startedAt", "endedAt", "endedReason", "reconciledAt", "exitCode"],
```

Ganti seluruh entri `derived` menjadi:

```ts
    derived: [{
      type: "session.ended", label: "Sesi selesai, gagal, atau terputus", changed: ["endedAt"],
      when: "Sesi berakhir dan endedAt terisi. endedReason memberi tahu CARANYA: \"closed\" = hanoman menutupnya, jadi exitCode berlaku (null = agen masih hidup saat ditutup, 0 = keluar bersih, selain itu gagal); \"reconciled\" = panenya sudah lenyap saat hanoman menyala lagi (reboot, kill-server, host mati) sehingga hasilnya TAK DIKETAHUI, exitCode selalu null, dan reconciledAt menyebut kapan hanoman menemukannya — endedAt di kasus itu batas BAWAH, bukan waktu berakhir sebenarnya. null = baris lahir sebelum SPEC-844.",
    }],
```

Tambahkan dua field di `sample`, tepat sesudah `endedAt`:

```ts
      endedReason: "closed", reconciledAt: null,
```

- [x] **Step 3: Jalankan test gerbang, pastikan masih LULUS**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/webhook-catalog-dmmf.test.ts shared/src/webhook.test.ts
```
Expected: PASS — nama kolom baru terbukti ada di DMMF Prisma.

- [x] **Step 4: Commit**

```bash
git add shared/src/webhook.ts
git commit -m "feat(spec-844): payload webhook sesi membawa endedReason & reconciledAt"
```

---

### Task 5: Riwayat sesi merender `terputus`, menjelaskannya, dan menawarkan pemulihan

**Files:**
- Modify: `src/src/screens/SessionHistoryModal.tsx`
- Test: `src/test/session-history-modal.test.tsx`

**Interfaces:**
- Consumes: `sessionOutcome()` (Task 1); field `endedReason`/`reconciledAt` di `SessionHistoryView` (Task 3).
- Produces: `statusOf(r)` kini mengembalikan tone `"warn"` juga; `durationOf(r)`.

- [x] **Step 1: Tulis test yang gagal**

Di `src/test/session-history-modal.test.tsx`, tambahkan dua field di helper `row()` (sesudah `endedAt`):

```ts
  endedReason: "closed", reconciledAt: null,
```

Lalu tambahkan blok berikut sesudah test `sesi yang belum ditutup terbaca 'berjalan'`:

```ts
  it("exit bukan nol terbaca sebagai kodenya, bukan 'selesai'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ exitCode: 2 })], total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("exit 2")).toBeTruthy();
  });

  // SPEC-844 · sebelum ini baris rekonsiliasi tampil hijau "selesai · 0 dtk".
  it("baris hasil rekonsiliasi boot terbaca 'terputus', bukan 'selesai'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: "2026-07-28T01:00:00.000Z", endedReason: "reconciled",
        reconciledAt: "2026-07-29T03:00:00.000Z", exitCode: null, transcriptBytes: null })],
      total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    expect(await screen.findByText("terputus")).toBeTruthy();
    expect(screen.queryByText("selesai")).toBeNull();
  });

  it("baris terputus tak mengarang durasi", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: "2026-07-28T01:00:00.000Z", endedReason: "reconciled",
        reconciledAt: "2026-07-29T03:00:00.000Z", exitCode: null })],
      total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    await screen.findByText("terputus");
    expect(screen.queryByText("0 dtk")).toBeNull();
  });
```

Dan blok berikut di dalam `describe("SessionHistoryModal — detail (SPEC-362)", …)`:

```ts
  // SPEC-844 · AC "Session detail explains that exit code and final transcript may be incomplete"
  it("detail baris terputus menjelaskan hasil tak diketahui & tetap menawarkan 'Mulai lagi'", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ endedAt: "2026-07-28T01:00:00.000Z", endedReason: "reconciled",
        reconciledAt: "2026-07-29T03:00:00.000Z", exitCode: null, transcriptBytes: null })],
      total: 1, page: 1, pageSize: 20 });
    render(<SessionHistoryModal projects={projects} onClose={() => {}} onRestart={() => {}} />);
    fireEvent.click(await screen.findByText("History session terminal"));
    expect(await screen.findByText("Sesi terputus — hasilnya tak diketahui")).toBeTruthy();
    expect(screen.getByText("Terakhir terlihat hidup")).toBeTruthy();
    expect(screen.getByText("Terdeteksi mati")).toBeTruthy();
    expect(screen.getByText("Mulai lagi")).toBeTruthy();
    expect(screen.queryByText(/ditutup sebelum fitur riwayat ada/)).toBeNull();
  });
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/session-history-modal.test.tsx`
Expected: FAIL — `terputus` tak ditemukan (barisnya masih merender `selesai`).

- [x] **Step 3: Implementasi**

Di `src/src/screens/SessionHistoryModal.tsx`:

Ganti baris impor DS & shared (baris 2 & 4) menjadi:

```ts
import { Modal, Input, Select, Button, Badge, Callout, StateBlock, Icon, Pager, serverPage } from "../ds";
```
```ts
import { SESSION_KINDS, SESSION_KIND_LABEL, restartableKind, sessionOutcome, type SessionHistoryView } from "@hanoman/shared";
```

Ganti seluruh `statusOf` (baris 21-25) dan tambahkan `durationOf` di bawahnya:

```ts
export function statusOf(r: SessionHistoryView): { label: string; tone: "ok" | "err" | "warn" | "neutral" } {
  switch (sessionOutcome(r)) {
    case "running": return { label: "berjalan", tone: "neutral" };
    // SPEC-844 · ADR-0125 · panenya lenyap saat boot: bukan sukses (hijau berbohong) dan bukan
    // kegagalan terbukti (merah mengarang) — hasilnya memang tak diketahui.
    case "interrupted": return { label: "terputus", tone: "warn" };
    case "failed": return { label: `exit ${r.exitCode}`, tone: "err" };
    default: return { label: "selesai", tone: "ok" };
  }
}

// Baris terputus tak punya durasi yang bisa dipercaya: `endedAt`-nya batas bawah (waktu baris
// terakhir disentuh = waktu lahirnya), `reconciledAt` batas atasnya. "0 dtk" adalah angka karangan
// — prinsip yang sama dengan `humanDuration` untuk sesi yang belum ditutup.
export const durationOf = (r: SessionHistoryView): string =>
  sessionOutcome(r) === "interrupted" ? "—" : humanDuration(r.startedAt, r.endedAt);
```

Di daftar baris, ganti pemakaian `humanDuration(r.startedAt, r.endedAt)` menjadi `durationOf(r)`.

Di `SessionHistoryDetail`, tepat sebelum `const meta`, tambahkan:

```ts
  const interrupted = sessionOutcome(row) === "interrupted";
```

Ganti seluruh blok `const meta` + `if (row.specId)` + `if (row.branch)` menjadi:

```ts
  const meta: [string, string][] = [
    ["Project", projectName],
    ["Sesi", row.sessionId],
    ["Jenis", labelOfKind(row.kind)],
    ["Agen", [row.agent, row.model, row.effort].filter(Boolean).join(" · ")],
    ["Mulai", new Date(row.startedAt).toLocaleString("id-ID")],
    // Baris terputus punya DUA stempel yang berbeda artinya, jadi satu label "Selesai" berbohong.
    [interrupted ? "Terakhir terlihat hidup" : "Selesai",
      row.endedAt ? new Date(row.endedAt).toLocaleString("id-ID") : "berjalan"],
    ...(interrupted && row.reconciledAt
      ? [["Terdeteksi mati", new Date(row.reconciledAt).toLocaleString("id-ID")] as [string, string]]
      : []),
    ["Durasi", durationOf(row)],
    ["Direktori", row.cwd],
  ];
  if (row.specId) meta.splice(1, 0, ["Backlog", `${row.specId}${row.title ? ` · ${row.title}` : ""}`]);
  if (row.branch) meta.push(["Branch", row.branch]);
```

Tepat setelah `<div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>…</div>` (baris toolbar detail) dan **sebelum** grid metadata, sisipkan:

```tsx
      {interrupted && (
        <Callout tone="warn" title="Sesi terputus — hasilnya tak diketahui" style={{ marginBottom: 12 }}>
          Panenya sudah lenyap saat hanoman menyala lagi (reboot, <code>tmux kill-server</code>, atau
          host mati), jadi sesi ini tak meninggalkan exit code dan transkripnya kemungkinan besar tak
          sempat diambil — capture berjalan tepat sebelum pane dibunuh, dan di jalur ini sudah tak ada
          pane untuk dibaca. Periksa worktree &amp; branch sesi ini sebelum menganggapnya selesai,
          lalu mulai lagi bila pekerjaannya belum tuntas.
        </Callout>
      )}
```

Ganti blok `{state === "none" && …}` menjadi:

```tsx
      {state === "none" && (
        <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>
          {interrupted
            ? "Tanpa transkrip — panenya sudah lenyap sebelum hanoman sempat mengambilnya."
            : "Tanpa transkrip — sesi ini ditutup sebelum fitur riwayat ada, atau panenya tak menyisakan keluaran."}
        </div>
      )}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/session-history-modal.test.tsx src/test/session-history-pager.test.tsx src/test/terminal-history-button.test.tsx`
Expected: PASS — seluruh test lama tetap hijau plus 4 test baru.

Run: `pnpm --filter ./src typecheck`
Expected: keluar tanpa output (exit 0).

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SessionHistoryModal.tsx src/test/session-history-modal.test.tsx
git commit -m "feat(spec-844): riwayat sesi merender 'terputus' & menjelaskan hasil tak diketahui"
```

---

### Task 6: Docs Source of Truth + verifikasi akhir

**Files:**
- Create: `internal/docs/adr/0125-akhir-sesi-riwayat-tercatat.md`
- Modify: `internal/docs/adr/README.md` (tambah narasi ADR-0125 sesudah 0124/0123)
- Modify: `internal/docs/README.md` (tambah baris index ADR-0125)
- Modify: `internal/docs/architecture/data-model.md:599-601` (butir "Zombie dibereskan saat boot")
- Modify: `internal/docs/architecture/api-contract.md:970-980` (blok riwayat sesi)
- Modify: `internal/docs/frontend/frontend-implementation.md:564-575` (kosakata status; sekalian cabut paragraf "muat lebih/IntersectionObserver" yang usang sejak SPEC-523)
- Modify: `internal/skills/hanoman/SKILL.md` (butir "Riwayat sesi")

**Interfaces:**
- Consumes: seluruh keputusan Task 1-5.
- Produces: —

- [x] **Step 1: Tulis ADR-0125**

Isi wajib, mengikuti bentuk ADR lain di `internal/docs/adr/`: Status `Diterima`, tanggal 2026-08-19, konteks (tiga akhir sesi yang dipadatkan ke dua kolom + angka DB hidup 784/797 dan 20/20), keputusan (§1-§5 design doc), konsekuensi, dan **gotcha**:

1. `endedReason` dibaca longgar — `null`/nilai asing jatuh ke `closed`, bukan melempar; kalau tidak, 784 baris lama gagal di boundary.
2. `endedAt` baris rekonsiliasi **batas bawah**, bukan waktu berakhir; memindahkannya ke waktu boot mengarang durasi seluruh downtime.
3. Backfill berambang 60 000 ms adalah **sekali jalan**, bukan aturan render — memakainya sebagai aturan mengunci detail penyimpanan Prisma sebagai semantik produk.
4. Kolom baru wajib masuk `WEBHOOK_ENTITIES.fields`, dijaga `webhook-catalog-dmmf.test.ts`; salah ketik nama kolom mengosongkan payload **tanpa satu pun error**.
5. Baris `closed` **sengaja tak berubah** — menutup sesi yang panenya masih hidup adalah cara normal sesi sehat berakhir (`pty.ts:55`), dan melabelinya "terputus" menukar bug ini dengan kebalikannya yang 38× lebih besar.

- [x] **Step 2: Perbarui butir `data-model.md` "Zombie dibereskan saat boot"**

Ganti baris 599-601 menjadi (menyebut kedua kolom baru, `endedAt` sebagai batas bawah, dan backfill):

```markdown
- **Zombie dibereskan saat boot:** `reconcileHistory()` menutup baris `endedAt: null` yang `sessionId`-nya
  tak ada di `pty.listSessions()` (tmux mati di luar hanoman) dengan `endedAt = updatedAt`,
  `endedReason = "reconciled"`, dan `reconciledAt` = waktu sapuan (satu stempel untuk seluruh sapuan);
  `exitCode` tetap null. Cermin `backfillFeed` saat hub boot (ADR-0067).
- **`endedReason` + `reconciledAt`** (SPEC-844 · [ADR-0125](../adr/0125-akhir-sesi-riwayat-tercatat.md)):
  `endedReason` = **cara** baris ditutup — `"closed"` (`killSession()`) atau `"reconciled"` (pane sudah
  lenyap saat boot, hasil **tak diketahui**); `null` = baris lahir sebelum kolom ini ada, dibaca seperti
  `closed`. Kelas hasil (`running|completed|failed|interrupted`) **tidak** disimpan — ia diturunkan
  `sessionOutcome()` (`@hanoman/shared`) dari `endedAt`+`endedReason`+`exitCode`, karena
  `completed`/`failed` sudah terbaca dari `exitCode` (ADR-0011/0018) sementara siapa yang menutup
  barisnya tidak (arah ADR-0090). Untuk baris `reconciled`, `endedAt` adalah **batas bawah**
  ("terakhir diketahui hidup") dan `reconciledAt` batas atasnya — durasinya karena itu tak dirender.
```

- [x] **Step 3: Perbarui `api-contract.md`**

Di blok `# --- riwayat sesi …`, ganti kalimat `` `endedAt: null` = sesi masih berjalan. `` menjadi:

```
#   `endedAt: null` = sesi masih berjalan. `endedReason` = cara baris ditutup: "closed" (hanoman
#   menutupnya — `exitCode` berlaku) | "reconciled" (pane lenyap saat boot — hasil TAK DIKETAHUI,
#   `exitCode` selalu null, `endedAt` batas BAWAH, `reconciledAt` batas atasnya) | null (baris
#   sebelum SPEC-844, dibaca seperti "closed"). Kelas hasilnya diturunkan `sessionOutcome()`
#   (@hanoman/shared), tak disimpan — SPEC-844/ADR-0125.
```

- [x] **Step 4: Perbarui `frontend-implementation.md`**

Di paragraf toolbar **Riwayat** (baris ±564-575): ganti `status `berjalan`/`selesai`/`exit <code>`` menjadi ``status `berjalan`/`selesai`/`exit <code>`/**`terputus`** (SPEC-844 · ADR-0125 — baris hasil rekonsiliasi boot: hijau berbohong dan merah mengarang, jadi tone `warn`; durasinya `—` bukan `0 dtk`, dan detailnya merender Callout yang menyatakan hasil & transkripnya tak diketahui plus dua stempel `Terakhir terlihat hidup`/`Terdeteksi mati`)``. Ganti kalimat "lalu **muat lebih**: `IntersectionObserver` auto-load … terbaca sebagai bug)" dengan penyebutan `Pager` DS (SPEC-523: halaman **mengganti** isi, kontrol halaman sendiri yang menyatakan "N–M dari T"), dan hapus kalimat "modal hanya menaikkan `page` dan **menambah** item, tak menggantinya."

- [x] **Step 5: Perbarui `internal/skills/hanoman/SKILL.md`**

Di butir **Riwayat sesi** (SPEC-362/ADR-0079), tambahkan kalimat SPEC-844 sesudah kalimat "…ditutup saat `killSession`": bahwa baris kini mencatat **bagaimana** ia berakhir (`endedReason`), bahwa `exitCode: null` adalah keadaan **normal** sesi sehat sehingga tak bisa dipakai membedakan zombie, dan bahwa verdict-nya satu fungsi murni `sessionOutcome()` di shared — jangan menyalinnya ke UI.

- [x] **Step 6: Tautkan ADR baru di `internal/docs/README.md` dan `internal/docs/adr/README.md`**

Ikuti bentuk baris ADR yang sudah ada (satu baris padat berisi keputusan + gotcha terukur).

- [x] **Step 7: Verifikasi integritas index**

Run: `pnpm --filter ./cli exec tsx src/hanoman.ts docs index --check`
Expected: index utuh, nol doc tak tertaut. (Bila CLI belum ter-build, boleh dilewati — cukup pastikan setiap berkas doc baru muncul di `internal/docs/README.md`.)

- [x] **Step 8: Verifikasi penuh berkas yang berubah**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism --changed "$HANOMAN_BASE_SHA"
```
Expected: PASS, dan **jumlah berkas test > 0** (`--changed` menyalakan `passWithNoTests`, jadi "no test files" BUKAN bukti hijau — baca jumlahnya).

Run: `pnpm --filter ./server typecheck && pnpm --filter ./src typecheck && pnpm --filter ./shared typecheck`
Expected: ketiganya exit 0.

- [x] **Step 9: Smoke endpoint nyata (task ini menyentuh response `GET /api/terminal/history`)**

Boot server terhadap DB sekali pakai, isi satu baris zombie, lalu curl:

```bash
D=$(mktemp -d)/smoke.db
DATABASE_URL="file:$D" pnpm --filter ./server exec prisma migrate deploy
sqlite3 "$D" "INSERT INTO SessionHistory (id,sessionId,projectId,kind,agent,cwd,startedAt,endedAt,endedReason,reconciledAt,updatedAt,createdAt)
VALUES ('smoke','s-smoke','p','spec','claude','/r',1000000,1000000,'reconciled',1082224277,1082224277,1000000);"
```

Boot server dengan `DATABASE_URL="file:$D"` (port bebas), login/cookie sesuai jalur auth yang berlaku, lalu:

```bash
curl -s "http://127.0.0.1:<port>/api/terminal/history?q=s-smoke" | python3 -m json.tool
```

Expected: item memuat `"endedReason": "reconciled"` dan `"reconciledAt": "1970-01-13T..."` (ISO non-null). Matikan server per-PID (`lsof -ti:<port>` → `kill <pid>`), **jangan** `pkill -f`.

- [x] **Step 10: Commit**

```bash
git add internal/docs docs/superpowers
git commit -m "docs(spec-844): ADR-0125 + data-model/api-contract/frontend/SKILL"
```
