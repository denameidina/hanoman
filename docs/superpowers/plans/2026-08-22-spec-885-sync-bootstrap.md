# SPEC-885 — Sync hub → client baru Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat instalasi hanoman client yang baru bisa menarik seluruh keadaan hub dalam hitungan detik, dan menghentikan dua kegagalan senyap yang membuatnya mustahil hari ini.

**Architecture:** Lima fase berurutan atas mesin sync yang sudah ada (ADR-0043/0045). Fase 1–2 memperbaiki kebenaran jalur feed: halaman `pull` dipotong per anggaran **byte** (bukan jumlah baris) supaya tak pernah melewati cap byte client, dan `syncOnce` menguras feed sampai habis dalam satu panggilan dengan record tertunda yang hidup lintas halaman. Fase 3 menambah `GET /api/sync/bootstrap` yang mengirim **keadaan tabel** dalam urutan dependensi alih-alih sejarah feed. Fase 4 menghentikan `runHealth` menerbitkan snapshot identik tiap 5 menit. Fase 5 menyalakan gzip opt-in di dua endpoint itu.

**Tech Stack:** TypeScript strict, Fastify 5, Prisma 6 + SQLite, Vitest, `node:zlib`, `node:http`.

## Global Constraints

- Spec acuan: `docs/superpowers/specs/2026-08-22-spec-885-sync-bootstrap-design.md`. Baca sebelum mulai.
- Bahasa komentar kode: **Bahasa Indonesia**, mengikuti gaya berkas yang disentuh. Komentar menjelaskan **mengapa**, bukan mengulang **apa**.
- Semua perubahan **aditif dan kompatibel dua arah**: hub baru harus melayani client lama, client baru harus bekerja terhadap hub lama. Urutan rilis hub-duluan (ADR-0135).
- Field wire baru (`hasMore`, `next`) bersifat aditif — penerima lama mengabaikannya, penerima baru harus punya fallback saat field itu absen.
- Jangan menambah dependency npm baru. Jangan menambah entri ke config registry (`@hanoman/shared`) — knob di plan ini adalah **konstanta modul**, bukan setelan runtime.
- Menjalankan test: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>`. **`TEST_DATABASE_URL` wajib** — tanpa itu berkas DB test dibagi semua worktree di mesin ini dan run tetangga menghapusnya di tengah jalan (SPEC-479). Gejala salah-alarm: banyak 404/P2022.
- Jangan menjalankan suite penuh atau `pnpm -r typecheck` sebagai rutinitas (SPEC-376/ADR-0080). Typecheck paket yang disentuh: `pnpm --filter ./server typecheck`.
- Commit tiap akhir task. Docs yang tersentuh diperbarui **dalam commit yang sama**.
- Angka pengukuran yang boleh dikutip di komentar/ADR (hub produksi, 2026-08-22): feed 3.637 baris / 7,9 MB; keadaan sebenarnya 889 record / ~2,5 MB; halaman kedua **2,51 MB**; **348** jendela 500-baris > 2 MB; **510 dari 728** spec ber-`seq` lebih kecil dari induknya, 508 di halaman berbeda; `vps` 2.469 baris untuk 9 record.

## File Structure

| Berkas | Tanggung jawab | Fase |
|---|---|---|
| `server/src/services/sync.ts` | mesin record-sync sisi hub: `pull` ber-anggaran byte, `bootstrapSnapshot`, helper `recordBytes` | 1, 3 |
| `server/src/routes/sync.ts` | permukaan HTTP: route `bootstrap`, gzip dua endpoint | 3, 5 |
| `server/src/services/sync-client.ts` | mesin sisi client: `fetchTransport`, `syncOnce` (drain), `bootstrapOnce`, `syncNow`, `tick` | 1, 2, 3, 5 |
| `server/src/services/safe-outbound-request.ts` | transport keluar ber-pin DNS: dekompresi gzip opt-in + cap ganda | 5 |
| `server/src/services/vps-audit.ts` | `shouldPublishHealth` + `runHealth` publish-on-change | 4 |
| `server/prisma/schema.prisma` + migration | kolom lokal `Vps.lastPublishedAt` | 4 |
| `server/test/sync-page-budget.test.ts` | **baru** — anggaran byte halaman pull + cap byte client | 1, 2, 5 |
| `server/test/sync-drain.test.ts` | **baru** — drain berkelanjutan, deferred lintas halaman, log transisi | 2 |
| `server/test/sync-bootstrap.test.ts` | **baru** — snapshot bootstrap sisi hub & sisi client | 3 |
| `server/test/vps-audit.test.ts` | tambahan — keputusan publish health (fungsi murni) | 4 |
| `server/test/vps-monitor.test.ts` | tambahan — pemasangan: berapa baris SyncLog yang benar-benar lahir | 4 |
| `server/test/fixtures/fake-ssh.sh` | `FAKE_SSH_DISK` agar health palsu bisa berubah antar-sapuan | 4 |
| `server/test/safe-outbound-request.test.ts` | tambahan — gunzip opt-in + penjaga bom | 5 |
| `internal/docs/adr/0138-*.md` | ADR keputusan | 6 |

---

### Task 1: Anggaran byte di halaman `pull` (hub)

**Files:**
- Modify: `server/src/services/sync.ts` (fungsi `pull`, sekitar baris 290–310)
- Test: `server/test/sync-page-budget.test.ts` (buat baru)

**Interfaces:**
- Consumes: `prisma.syncLog`, tipe `PulledRecord` yang sudah ada di `sync.ts`.
- Produces:
  - `export function recordBytes(rec: PulledRecord): number`
  - `export const PULL_MAX_BYTES: number` (1.048.576)
  - `pull(sinceCursor: string, limit?: number, maxBytes?: number): Promise<{ cursor: string; records: PulledRecord[]; hasMore: boolean }>` — **`hasMore` adalah field baru**; Task 3 mengandalkannya.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/sync-page-budget.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { pull } from "../src/services/sync";

const clean = async () => { await prisma.syncLog.deleteMany(); };
beforeEach(clean); afterAll(clean);

const feedRow = (recordId: string, bytes: number) => prisma.syncLog.create({
  data: { entity: "spec", recordId, version: 1, op: "upsert", data: { title: "x".repeat(bytes) } },
});

describe("SPEC-885 · anggaran byte halaman pull", () => {
  it("memotong halaman per byte, dan kursor menunjuk baris yang BENAR-BENAR dikirim", async () => {
    for (let i = 1; i <= 5; i++) await feedRow(`SPEC-${i}`, 50_000);

    const page = await pull("0", 500, 120_000);
    expect(page.records).toHaveLength(2);          // 3 baris sudah 150 KB > 120 KB
    expect(page.hasMore).toBe(true);

    const rows = await prisma.syncLog.findMany({ orderBy: { seq: "asc" } });
    expect(page.cursor).toBe(String(rows[1]!.seq));

    // Tak ada satu baris pun yang terlompati kursor — inilah invarian fase ini.
    const next = await pull(page.cursor, 500, 120_000);
    expect(next.records[0]!.recordId).toBe("SPEC-3");
  });

  it("satu baris yang sendirian melewati anggaran TETAP dikirim (feed tak boleh beku)", async () => {
    await feedRow("SPEC-BIG", 200_000);
    const page = await pull("0", 500, 1_000);
    expect(page.records).toHaveLength(1);
    expect(page.records[0]!.recordId).toBe("SPEC-BIG");
  });

  it("halaman terakhir menjawab hasMore=false", async () => {
    await feedRow("SPEC-1", 10);
    const page = await pull("0", 500, 120_000);
    expect(page.hasMore).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-page-budget.test.ts
```

Diharapkan: FAIL. Test pertama gagal di `expect(page.records).toHaveLength(2)` (dapat 5, karena `pull` belum mengenal anggaran byte) dan `page.hasMore` `undefined`.

- [x] **Step 3: Implementasi**

Di `server/src/services/sync.ts`, ganti seluruh fungsi `pull` dengan:

```ts
// SPEC-885 · ADR-0138 · anggaran byte satu halaman pull. Sebelum ini `pull` memotong per JUMLAH
// baris (`limit`) sementara client memotong per BYTE (`maxResponseBytes` di `fetchTransport`), dan
// dua satuan itu tak pernah bisa sepakat: baris feed berkisar 100 B–29 KB, jadi halaman 500-baris
// bisa 0,2 MB atau 2,5 MB tergantung komposisinya. Di hub produksi halaman KEDUA berukuran 2,51 MB
// (348 jendela 500-baris melewati 2 MB) → response di-destroy client → pull melempar → `tick()`
// menelannya tanpa log → halaman yang sama diulang tiap 15 detik selamanya. Client baru berhenti
// di 500 dari 3.637 record tanpa satu pun jejak.
export const PULL_MAX_BYTES = 1024 * 1024;

// Ukuran record persis seperti yang akan dikirim. Sengaja men-serialize dua kali (di sini dan oleh
// Fastify): anggaran yang ditaksir tidak menjaga apa pun, dan biayanya ~ms untuk halaman 1 MB.
export function recordBytes(rec: PulledRecord): number {
  return Buffer.byteLength(JSON.stringify(rec));
}

export async function pull(
  sinceCursor: string, limit = 500, maxBytes = PULL_MAX_BYTES,
): Promise<{ cursor: string; records: PulledRecord[]; hasMore: boolean }> {
  // SPEC-398 · ADR-0086 · `SyncLog.seq` kini `Int` (SQLite hanya meng-auto-isi alias rowid ber-tipe
  // deklarasi tepat `INTEGER`). Kursor tetap STRING di wire — jangan ubah bentuk itu.
  const since = Number(sinceCursor || "0");
  const rows = await prisma.syncLog.findMany({
    where: { seq: { gt: since } }, orderBy: { seq: "asc" }, take: limit,
  });

  const records: PulledRecord[] = [];
  let bytes = 0;
  let trimmed = false;
  for (const r of rows) {
    const rec: PulledRecord = {
      entity: r.entity, recordId: r.recordId, version: r.version,
      op: r.op === "delete" ? "delete" : "upsert", data: r.data,
    };
    const size = recordBytes(rec);
    // Minimal satu baris SELALU dikirim: satu record raksasa tak boleh membekukan feed di
    // tempatnya. Cap `MAX_SYNC_RECORD_BYTES` (1 MB) di sisi client yang menjaga batas atasnya.
    if (records.length && bytes + size > maxBytes) { trimmed = true; break; }
    bytes += size;
    records.push(rec);
  }

  // Kursor menunjuk baris terakhir yang BENAR-BENAR dikirim — bukan baris terakhir yang dibaca.
  // Kalau ia menunjuk lebih jauh, baris yang tak terkirim tertinggal di belakang kursor dan tak
  // akan pernah ditarik lagi (akar hilangnya lampiran, audit SPEC-382).
  const cursor = records.length ? String(rows[records.length - 1]!.seq) : sinceCursor || "0";
  // `rows.length === limit` = mungkin masih ada di balik batas baris. Melebihkan `hasMore` hanya
  // memicu satu pull kosong; mengurangkannya membuat client berhenti di tengah feed.
  return { cursor, records, hasMore: trimmed || rows.length === limit };
}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-page-budget.test.ts server/test/sync.service.test.ts server/test/sync.route.test.ts
```

Diharapkan: PASS semua. `sync.service.test.ts` dan `sync.route.test.ts` ikut karena keduanya memanggil `pull` — bentuk balikannya bertambah satu field, jadi harus dipastikan tak ada yang memeriksa bentuk objek secara ketat.

- [x] **Step 5: Typecheck**

```bash
pnpm --filter ./server typecheck
```

Diharapkan: keluar 0. Bila ada pemanggil `pull` yang men-destructure secara ketat, perbaiki di sini.

- [x] **Step 6: Commit**

```bash
git add server/src/services/sync.ts server/test/sync-page-budget.test.ts
git commit -m "fix(spec-885): potong halaman pull per anggaran byte, bukan jumlah baris

Halaman kedua feed hub produksi 2,51 MB melewati cap 2 MB di fetchTransport;
response di-destroy, pull melempar, tick() menelan tanpa log, halaman sama
diulang selamanya. 348 jendela 500-baris melewati 2 MB.

Kursor kini menunjuk baris yang benar-benar dikirim, dan hasMore memberi
tahu client bahwa feed belum habis.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Naikkan cap byte pull di client

**Files:**
- Modify: `server/src/services/sync-client.ts` (fungsi `fetchTransport`, sekitar baris 288–310)
- Test: `server/test/sync-page-budget.test.ts` (tambah)

**Interfaces:**
- Consumes: `safeRequest` dari `./safe-outbound-request`.
- Produces: `fetchTransport` dengan `maxResponseBytes` 8 MB. Tak ada perubahan signature.

**Mengapa terpisah dari Task 1:** Task 1 menolong client mana pun terhadap **hub baru**. Task ini satu-satunya yang menolong **client baru terhadap hub lama** — dan justru itulah kombinasi yang dialami setiap orang yang baru `npm i -g hanoman` sebelum hub-nya naik versi.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/sync-page-budget.test.ts` — di bagian atas berkas tambahkan import:

```ts
import { createServer } from "node:http";
import { fetchTransport } from "../src/services/sync-client";
```

lalu tambahkan blok describe baru di akhir berkas:

```ts
describe("SPEC-885 · cap byte client terhadap hub lama", () => {
  it("halaman pull 3 MB tak lagi ditolak (reproduksi mandek hub produksi)", async () => {
    const body = JSON.stringify({
      cursor: "9",
      records: [{
        entity: "spec", recordId: "SPEC-1", version: 1, op: "upsert",
        data: { title: "x".repeat(3_000_000) },
      }],
    });
    const srv = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(body);
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;
    try {
      const transport = fetchTransport(`http://127.0.0.1:${port}`, "token-uji");
      const res = await transport("GET", "/api/sync/pull?since=0");
      expect(res.status).toBe(200);
      expect(res.body.records).toHaveLength(1);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
```

Catatan: `fetchTransport` menyalakan `allowPrivate` untuk loopback selama `NODE_ENV !== "production"`. Vitest berjalan di `NODE_ENV=test`, jadi permintaan ke `127.0.0.1` diizinkan.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-page-budget.test.ts
```

Diharapkan: FAIL dengan `outbound response terlalu besar`. **Inilah kegagalan produksi yang sedang direproduksi** — kalau test ini tidak gagal dengan pesan itu, hentikan dan cari tahu kenapa sebelum lanjut.

- [x] **Step 3: Implementasi**

Di `server/src/services/sync-client.ts`, di dalam `fetchTransport`, ganti baris `maxResponseBytes`:

```ts
      allowPrivate: process.env.NODE_ENV !== "production" && loopback,
      connectMs: 5_000, totalMs: 15_000,
      // SPEC-885 · ADR-0138 · cap ini dulu 2 MB, dan halaman feed 2,51 MB di hub produksi
      // membuat setiap client baru MANDEK di situ selamanya — bukan lambat, mandek, dan tanpa
      // satu baris log. Hub yang sudah membawa Fase 1 memotong halamannya di 1 MB, jadi cap ini
      // tak akan tersentuh olehnya. Ia dinaikkan justru untuk hub yang BELUM naik versi, yang
      // tetap mengirim 500 baris apa adanya — kombinasi yang dialami tiap `npm i -g hanoman`
      // sebelum hub-nya diperbarui (urutan rilis hub-duluan, ADR-0135).
      maxResponseBytes: 8 * 1024 * 1024,
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-page-budget.test.ts server/test/sync-client.test.ts
```

Diharapkan: PASS semua.

- [x] **Step 5: Commit**

```bash
git add server/src/services/sync-client.ts server/test/sync-page-budget.test.ts
git commit -m "fix(spec-885): naikkan cap byte pull client 2 MB → 8 MB

Satu-satunya lapis yang menolong client baru terhadap hub yang BELUM naik
versi — hub lama tetap mengirim 500 baris apa adanya, dan itulah kombinasi
yang dialami tiap npm i -g hanoman sebelum hub diperbarui.

Test menyalakan server http lokal yang membalas 3 MB: sebelum perubahan ini
ia gagal dengan 'outbound response terlalu besar', persis kegagalan produksi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Drain berkelanjutan + `deferred` lintas halaman

**Files:**
- Modify: `server/src/services/sync-client.ts` (`syncOnce` seluruhnya, `syncNow`, hapus `FULL_PULL_MAX_PAGES`)
- Test: `server/test/sync-drain.test.ts` (buat baru)

**Interfaces:**
- Consumes: `pull` ber-`hasMore` dari Task 1; `validateIncomingRecord`, `applyRemote`, `getCursor`, `setCursor`, `listOutbox`, `snapshot`, `recordConflict` yang sudah ada.
- Produces:
  - `type IncomingRecord = ReturnType<typeof validateIncomingRecord>` (internal modul)
  - `const MAX_DRAIN_PAGES = 500` (internal modul)
  - `syncOnce(transport: Transport): Promise<SyncStats>` — signature **tidak berubah**, tapi kontraknya berubah: ia kini menguras feed sampai habis, bukan satu halaman.
  - `syncNow(opts?: { full?: boolean }): Promise<SyncStats | null>` — signature tidak berubah.

**Ini task terbesar di plan.** Ia memperbaiki dua gejala dengan satu obat: laju yang dipatok timer (satu halaman per tick 15 detik), dan 510 dari 728 spec yang hilang senyap karena `deferred` hanya di-retry di dalam satu halaman.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/sync-drain.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import { syncOnce, getCursor, setCursor, type Transport } from "../src/services/sync-client";

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.syncState.deleteMany(); await prisma.syncTombstone.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned",
  priority: "sedang", author: "a@b.co", objective: "o", ...over,
});
const projectData = () => ({ name: "p1", desc: "d", kind: "existing", stack: "", gitRemote: null });

// Transport palsu yang menyajikan halaman-halaman tetap. Batas unit yang tepat untuk fase ini:
// yang diuji adalah KONTRAK lingkaran drain ("terus tarik selagi hasMore, bawa deferred"), bukan
// kemampuan hub memotong halaman — itu sudah diuji Task 1.
function pagedTransport(pages: Array<{ cursor: string; hasMore?: boolean; records: unknown[] }>): Transport {
  let i = 0;
  return async (method, path) => {
    if (method === "GET" && path.startsWith("/api/sync/pull")) {
      const page = pages[i] ?? { cursor: pages[pages.length - 1]?.cursor ?? "0", hasMore: false, records: [] };
      i++;
      return { status: 200, body: page };
    }
    return { status: 200, body: { results: [] } };
  };
}

describe("SPEC-885 · drain berkelanjutan", () => {
  it("anak di halaman 1 dan induk di halaman 2 → keduanya terpasang, nol dropped", async () => {
    // Bentuk feed ini BUKAN hipotesis. Retensi ADR-0131 menyimpan hanya baris terakhir per
    // record, jadi baris penciptaan induk lenyap dan yang tersisa ber-seq LEBIH BESAR daripada
    // anaknya: 510 dari 728 spec di hub produksi, 508 di antaranya di halaman berbeda.
    const transport = pagedTransport([
      { cursor: "10", hasMore: true, records: [
        { entity: "spec", recordId: "SPEC-1", version: 1, op: "upsert", data: specData() },
      ] },
      { cursor: "20", hasMore: false, records: [
        { entity: "project", recordId: "p1", version: 3, op: "upsert", data: projectData() },
      ] },
    ]);

    const stats = await syncOnce(transport);

    expect(stats.dropped).toBe(0);
    expect(stats.pulled).toBe(2);
    expect(await prisma.project.findUnique({ where: { id: "p1" } })).toBeTruthy();
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeTruthy();
    expect(await getCursor()).toBe("20");
  });

  it("satu panggilan menguras BANYAK halaman (bukan satu halaman per tick)", async () => {
    const transport = pagedTransport([
      { cursor: "10", hasMore: true, records: [
        { entity: "project", recordId: "p1", version: 1, op: "upsert", data: projectData() } ] },
      { cursor: "20", hasMore: true, records: [
        { entity: "spec", recordId: "SPEC-1", version: 1, op: "upsert", data: specData() } ] },
      { cursor: "30", hasMore: false, records: [
        { entity: "spec", recordId: "SPEC-2", version: 1, op: "upsert", data: specData() } ] },
    ]);

    const stats = await syncOnce(transport);

    expect(stats.pulled).toBe(3);
    expect(await getCursor()).toBe("30");
  });

  it("hub lama tanpa hasMore: terus tarik selagi halaman tak kosong, berhenti saat kosong", async () => {
    const transport = pagedTransport([
      { cursor: "10", records: [
        { entity: "project", recordId: "p1", version: 1, op: "upsert", data: projectData() } ] },
      { cursor: "20", records: [
        { entity: "spec", recordId: "SPEC-1", version: 1, op: "upsert", data: specData() } ] },
      { cursor: "20", records: [] },
    ]);

    const stats = await syncOnce(transport);

    expect(stats.pulled).toBe(2);
    expect(await getCursor()).toBe("20");
  });

  it("record yang induknya memang tak pernah ada dibuang SETELAH feed habis, dengan jejak", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = pagedTransport([
      { cursor: "10", hasMore: false, records: [
        { entity: "spec", recordId: "SPEC-9", version: 1, op: "upsert", data: specData({ projectId: "tak-ada" }) },
      ] },
    ]);

    const stats = await syncOnce(transport);

    expect(stats.dropped).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SPEC-9"));
    warn.mockRestore();
  });

  it("kursor yang tak maju menghentikan lingkaran (tak ada drain tak berujung)", async () => {
    let calls = 0;
    const transport: Transport = async (method, path) => {
      if (method === "GET" && path.startsWith("/api/sync/pull")) {
        calls++;
        return { status: 200, body: { cursor: "0", hasMore: true, records: [] } };
      }
      return { status: 200, body: { results: [] } };
    };
    await setCursor("0");

    await syncOnce(transport);

    expect(calls).toBe(1);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-drain.test.ts
```

Diharapkan: FAIL. Test pertama gagal dengan `stats.dropped` = 1 dan `Spec SPEC-1` `null` — persis bug produksinya. Test kedua dan ketiga gagal karena `syncOnce` hanya menarik satu halaman.

- [x] **Step 3: Implementasi — helper `retryDeferred`**

Di `server/src/services/sync-client.ts`, tepat **di atas** deklarasi `export type SyncStats`, sisipkan:

```ts
type IncomingRecord = ReturnType<typeof validateIncomingRecord>;

// SPEC-885 · ADR-0138 · jaring pengaman lingkaran drain, BUKAN kuota. Feed hub produksi 3.637
// baris; batas ini hanya mencegah lingkaran tak berujung bila kursor gagal maju.
const MAX_DRAIN_PAGES = 500;

// Satu pass atas record tertunda; kembalikan yang MASIH belum bisa diterapkan. Sengaja TIDAK
// membuang apa pun.
//
// Sesudah retensi ADR-0131 memangkas baris penciptaan induk, "tak bisa diterapkan di halaman ini"
// berhenti menjadi bukti yatim: yang tersisa di feed hanyalah baris TERAKHIR tiap record, dan
// baris terakhir sebuah project bisa ber-`seq` jauh lebih besar daripada baris spec anaknya. Di
// hub produksi itu berlaku untuk 510 dari 728 spec, 508 di antaranya di halaman berbeda. Kode
// lama membuangnya di sini dan tetap memajukan kursor — jadi 70% spec hilang tanpa satu pun error.
async function retryDeferred(rest: IncomingRecord[], stats: SyncStats): Promise<IncomingRecord[]> {
  while (rest.length) {
    const still: IncomingRecord[] = [];
    for (const rec of rest) {
      try {
        const r = await applyRemote(rec.entity, rec.recordId, rec.version, rec.data, rec.op ?? "upsert");
        if (r === "dropped") stats.dropped++;
        else if (rec.op === "delete") stats.deleted++;
        else stats.pulled++;
      } catch { still.push(rec); }
    }
    // Satu putaran penuh tanpa kemajuan: induknya belum tiba. Tunggu halaman berikutnya, jangan
    // buang — pembuangan hanya sah setelah SELURUH feed habis.
    if (still.length === rest.length) return still;
    rest = still;
  }
  return [];
}
```

- [x] **Step 4: Implementasi — `syncOnce`**

Ganti seluruh fungsi `syncOnce` (dari `export async function syncOnce` sampai `return { pulled, pushed, conflicts, deleted, dropped };`) dengan:

```ts
// Satu siklus sync: kuras feed sampai habis (pull-apply berulang), lalu drain outbox sekali.
//
// SPEC-885 · ADR-0138 · dulu ia menarik SATU halaman per panggilan, dan pemanggilnya adalah tick
// 15 detik — jadi laju tarik client dipatok 500 baris / 15 detik oleh timer, bukan oleh jaringan
// maupun CPU, yang menganggur hampir sepanjang waktu itu.
export async function syncOnce(transport: Transport): Promise<SyncStats> {
  const stats: SyncStats = { pulled: 0, pushed: 0, conflicts: 0, deleted: 0, dropped: 0 };

  const outbox = await listOutbox();
  const pending = new Set(outbox.map((o) => `${o.entity}:${o.recordId}`));
  // SPEC-270 · dedupe hitungan konflik per record (feed bisa punya banyak baris satu recordId).
  const conflicted = new Set<string>();
  const markConflict = async (entity: string, recordId: string, local: { version: number; data: Record<string, unknown> },
    server: { version: number; data: Record<string, unknown> }) => {
    await recordConflict(entity, recordId, local, server);
    const key = `${entity}:${recordId}`;
    if (!conflicted.has(key)) { conflicted.add(key); stats.conflicts++; }
  };

  let deferred: IncomingRecord[] = [];
  for (let page = 0; page < MAX_DRAIN_PAGES; page++) {
    const cursor = await getCursor();
    const pullRes = await transport("GET", `/api/sync/pull?since=${cursor}`);
    const rawRecords: unknown[] = Array.isArray(pullRes.body?.records) ? pullRes.body.records : [];
    const records = rawRecords.map(validateIncomingRecord);

    for (const rec of records) {
      if (!isEntity(rec.entity)) continue;
      // SPEC-799 · jenis peristiwa dari hub yang lebih baru — dilewati, bukan ditunda & bukan melempar.
      if (!rec.op) { stats.dropped++; continue; }
      // SPEC-270 · anti-clobber HANYA untuk upsert. SPEC-799: delete menang tanpa syarat, jadi edit
      // lokal pending justru bukan alasan menundanya — di situlah keputusannya harus berlaku.
      if (rec.op === "upsert" && pending.has(`${rec.entity}:${rec.recordId}`)) {
        const local = await snapshot(rec.entity as Entity, rec.recordId);
        if (local && JSON.stringify(local.data) !== JSON.stringify(rec.data)) {
          await markConflict(rec.entity, rec.recordId,
            { version: local.version, data: local.data }, { version: rec.version, data: rec.data });
        }
        continue;
      }
      try {
        const r = await applyRemote(rec.entity, rec.recordId, rec.version, rec.data, rec.op);
        if (r === "dropped") stats.dropped++;
        else if (rec.op === "delete") stats.deleted++;
        else stats.pulled++;
      } catch { deferred.push(rec); }
    }

    // Induk yang menyusul di halaman ini membuka anaknya yang tertunda dari halaman SEBELUMNYA.
    deferred = await retryDeferred(deferred, stats);

    const next = pullRes.body?.cursor ? String(pullRes.body.cursor) : cursor;
    if (next !== cursor) await setCursor(next);
    // Pull sudah melewati rentang yang menahan kursor WS → lubangnya tertambal (atau sengaja dilewati).
    feedHole = false;

    // Hub lama tak mengirim `hasMore` → "mungkin masih ada" selama halamannya tak kosong. Itu
    // menutup kombinasi client-baru/hub-lama tanpa memaksa hub naik versi lebih dulu.
    const more = (pullRes.body?.hasMore as boolean | undefined) ?? records.length > 0;
    // Kursor yang tak maju berarti menarik lagi hanya mengulang halaman yang sama.
    if (!more || next === cursor) break;
  }

  // Feed habis. Yang masih tak bisa diterapkan di sini memang yatim — dan kini kalimat itu jujur,
  // bukan artefak paginasi. Dilewati dengan jejak, bukan didiamkan: menahan kursor di sini =
  // livelock (ADR-0082), dan induknya justru ada di halaman berikutnya yang takkan pernah ditarik.
  for (const rec of deferred) {
    console.warn(`sync: record ${rec.entity}:${rec.recordId} tak bisa diterapkan — dilewati`);
    stats.dropped++;
  }

  for (const item of outbox) {
    // SPEC-255 · ADR-0064 · operasi rename project: recordId = "<oldId> <newId>". Push satu record
    // project ber-penanda renamedFrom agar hub merename in-place (bukan insert baru).
    if (item.entity === "projectRename") {
      const [oldId, newId] = item.recordId.split(RENAME_SEP);
      const snap = newId ? await snapshot("project", newId) : null;
      if (!oldId || !newId || !snap) { await clearOutbox(item.entity, item.recordId); continue; }
      const res = await transport("POST", "/api/sync/push", {
        records: [{ entity: "project", id: newId, baseVersion: 0, data: { ...snap.data, renamedFrom: oldId } }],
      });
      const r = res.body?.results?.[0];
      if (r?.ok) { await clearOutbox(item.entity, item.recordId); stats.pushed++; }
      else if (r?.conflict) { stats.conflicts++; }
      continue;
    }
    if (!isEntity(item.entity)) { await clearOutbox(item.entity, item.recordId); continue; }
    const snap = await snapshot(item.entity, item.recordId);
    // SPEC-799 · ADR-0119 · baris tak ada TAPI tombstone ada = penghapusan lokal menunggu jendela
    // online. Dulu cabang ini sekadar `clearOutbox` ("record hilang lokal") — di situlah setiap
    // penghapusan client mati tanpa jejak.
    if (!snap) {
      const tomb = await findTombstone(item.entity, item.recordId);
      if (!tomb) { await clearOutbox(item.entity, item.recordId); continue; } // hilang tanpa jejak
      const res = await transport("POST", "/api/sync/push", {
        records: [{
          entity: item.entity, id: item.recordId,
          baseVersion: Math.max(tomb.version - 1, 0), op: "delete", data: tomb.data,
        }],
      });
      if (res.body?.results?.[0]?.ok) { await clearOutbox(item.entity, item.recordId); stats.pushed++; }
      continue;
    }
    const res = await transport("POST", "/api/sync/push", {
      records: [{ entity: item.entity, id: item.recordId, baseVersion: snap.version, data: snap.data }],
    });
    const r = res.body?.results?.[0];
    // SPEC-880 · hub yang menolak record tanpa jejak apa pun tak bisa didiagnosis, hanya ditebak.
    if (!r) {
      console.warn(`sync: push ${item.entity}:${item.recordId} tak dijawab hub (status ${res.status})`
        + " — tetap di outbox; periksa apakah hub lebih tua dari client ini");
    }
    if (r?.ok) {
      // SPEC-270 · naikkan versi lokal = versi hub agar tak nyimpang di edit berikutnya.
      if (typeof r.version === "number") {
        const delegate = (prisma as unknown as Record<string, { update: (a: unknown) => Promise<unknown> } | undefined>)[item.entity];
        await delegate?.update({ where: { id: item.recordId }, data: { version: r.version } }).catch(() => {});
      }
      await clearOutbox(item.entity, item.recordId); stats.pushed++;
    } else if (r?.conflict) {
      // SPEC-799 · ADR-0119 · hub sudah menghapusnya. Delete menang: adopsi tombstone-nya, buang
      // edit lokal, berhenti mendorong. Tanpa lapis ini record bertombstone di-push selamanya.
      if (r.deleted) {
        await applyRemote(item.entity, item.recordId,
          Number(r.deletedVersion ?? snap.version + 1), snap.data, "delete");
        await clearOutbox(item.entity, item.recordId);
        stats.deleted++;
        continue;
      }
      // SPEC-270 · hub menolak → catat konflik dua-sisi bila datanya beda; else konvergen (adopsi hub).
      const server = r.server as { version: number; data: Record<string, unknown> } | null;
      if (server && JSON.stringify(server.data) !== JSON.stringify(snap.data)) {
        await markConflict(item.entity, item.recordId,
          { version: snap.version, data: snap.data }, { version: server.version, data: server.data });
      } else if (server) {
        await applyRemote(item.entity, item.recordId, server.version, server.data);
        await clearOutbox(item.entity, item.recordId);
      }
    }
  }
  return stats;
}
```

- [x] **Step 5: Implementasi — sederhanakan `syncNow`**

Ganti konstanta `FULL_PULL_MAX_PAGES` dan seluruh fungsi `syncNow` dengan:

```ts
// SPEC-268 · ADR-0066 · pemicu sync manual (tombol UI): satu siklus syncOnce memakai config efektif.
// null bila instance bukan client (tak ada hub tujuan) → endpoint/tombol melapor "not-configured".
// SPEC-382 · `full` → tarik ulang feed dari awal (pemulihan baris yang terlanjur dilompati kursor).
// SPEC-885 · lingkaran 200-halaman yang dulu berdiri di sini sudah pindah ke `syncOnce`, yang kini
// menguras sampai habis dengan sendirinya — jadi `full` tinggal "mundurkan kursor lalu jalankan".
export async function syncNow(opts?: { full?: boolean }): Promise<SyncStats | null> {
  const base = effectiveStr("SYNC_SERVER_URL");
  const token = effectiveStr("SYNC_DEVICE_TOKEN");
  if (!base || !token) return null;
  const transport = fetchTransport(base, token);
  if (opts?.full) await setCursor("0");
  return syncOnce(transport);
}
```

- [x] **Step 6: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-drain.test.ts server/test/sync-client.test.ts server/test/sync-tombstone.client.test.ts server/test/sync-push-partial-failure.test.ts server/test/sync-pending.route.test.ts
```

Diharapkan: PASS semua. Bila ada test lama yang berasumsi "satu pull per `syncOnce`", periksa apakah asumsinya masih sah — jangan longgarkan test baru untuk mengakomodasinya tanpa memahami kenapa.

- [x] **Step 7: Typecheck**

```bash
pnpm --filter ./server typecheck
```

Diharapkan: keluar 0.

- [x] **Step 8: Commit**

```bash
git add server/src/services/sync-client.ts server/test/sync-drain.test.ts
git commit -m "fix(spec-885): kuras feed sampai habis, bawa deferred lintas halaman

Dua gejala, satu obat. syncOnce menarik SATU halaman per tick 15 detik, jadi
lajunya dipatok timer. Dan deferred hanya di-retry di dalam satu halaman,
padahal retensi ADR-0131 memangkas baris penciptaan induk sehingga 510 dari
728 spec kini ber-seq lebih kecil dari baris project induknya — 508 di
halaman berbeda. Kode lama membuangnya lalu tetap memajukan kursor: 70%
spec hilang tanpa satu pun error.

Pembuangan kini hanya sah SETELAH feed habis. Kursor tetap tak pernah
ditahan (livelock ADR-0082) — induknya justru ada di halaman berikutnya.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `tick()` berhenti menelan kegagalan pull

**Files:**
- Modify: `server/src/services/sync-client.ts` (`startSyncClient`, sekitar baris 340–360)
- Test: `server/test/sync-drain.test.ts` (tambah)

**Interfaces:**
- Produces: `export function __resetSyncHealth(): void` (test-only, mengikuti preseden `__resetSyncActiveCache` di `SyncButton.tsx`).

**Mengapa ini task sendiri:** kalau tidak dikerjakan, kegagalan sync **berikutnya** — apa pun bentuknya — akan kembali menyamar sebagai "lambat". Yang membuat insiden ini butuh investigasi penuh bukan cap byte-nya, melainkan `catch { }` kosong yang membuat mandek total tak terlihat berbeda dari sepi.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/sync-drain.test.ts` (tambahkan `syncTick` dan `__resetSyncHealth` ke import dari `../src/services/sync-client`):

```ts
describe("SPEC-885 · kegagalan pull tak boleh senyap", () => {
  it("mencatat sekali saat mulai gagal dan sekali saat pulih, bukan tiap tick", async () => {
    __resetSyncHealth();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    let sehat = false;
    const transport: Transport = async (method, path) => {
      if (method === "GET" && path.startsWith("/api/sync/pull")) {
        if (!sehat) throw new Error("outbound response terlalu besar");
        return { status: 200, body: { cursor: "1", hasMore: false, records: [] } };
      }
      return { status: 200, body: { results: [] } };
    };

    // Tiga siklus gagal berturut-turut → satu baris log, bukan tiga.
    for (let i = 0; i < 3; i++) await syncTick(transport);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/sync: pull gagal/);

    sehat = true;
    await syncTick(transport);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toMatch(/sync: pull pulih/);

    warn.mockRestore(); info.mockRestore();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-drain.test.ts
```

Diharapkan: FAIL dengan `syncTick is not exported` / `__resetSyncHealth is not exported`.

- [x] **Step 3: Implementasi**

Di `server/src/services/sync-client.ts`, tepat **di atas** `export async function startSyncClient`, sisipkan:

```ts
// SPEC-885 · ADR-0138 · kegagalan pull dulu ditelan `catch { }` tanpa satu baris pun. Itulah yang
// membuat mandek total (halaman 2,51 MB melewati cap byte) tak bisa dibedakan dari sepi, dan
// karena itu insiden ini butuh investigasi penuh untuk sekadar DIKENALI. Digerbangi flag: tick
// berjalan tiap 15 detik, jadi log per-kegagalan akan jadi hujan log saat hub tak terjangkau —
// yang dicatat adalah TRANSISI, pola yang sama dengan siar dashboard di ADR-0131 §3.
let pullSehat = true;
export function __resetSyncHealth(): void { pullSehat = true; }

export async function syncTick(transport: Transport): Promise<void> {
  try {
    await syncOnce(transport);
    if (!pullSehat) { console.info("sync: pull pulih"); pullSehat = true; }
  } catch (e) {
    if (pullSehat) {
      console.warn(`sync: pull gagal — ${(e as Error).message}`);
      pullSehat = false;
    }
  }
}
```

Lalu di dalam `startSyncClient`, ganti definisi `tick` lokal:

```ts
  const tick = () => syncTick(transport);
```

(Baris lama `const tick = async () => { try { await syncOnce(transport); } catch { /* offline — coba lagi nanti */ } };` dihapus.)

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-drain.test.ts server/test/sync-ws.test.ts
```

Diharapkan: PASS semua.

- [x] **Step 5: Commit**

```bash
git add server/src/services/sync-client.ts server/test/sync-drain.test.ts
git commit -m "fix(spec-885): catat transisi kegagalan pull, jangan telan senyap

catch {} kosong di tick() membuat mandek total tak bisa dibedakan dari sepi.
Itulah sebabnya insiden ini butuh investigasi penuh untuk sekadar dikenali,
bukan cap byte-nya. Yang dicatat adalah transisi sehat→gagal dan pulih,
bukan tiap tick — tick berjalan tiap 15 detik.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Endpoint bootstrap (hub)

**Files:**
- Modify: `server/src/services/sync.ts` (tambah `bootstrapSnapshot` + `BOOTSTRAP_ORDER`)
- Modify: `server/src/routes/sync.ts` (tambah route)
- Test: `server/test/sync-bootstrap.test.ts` (buat baru)

**Interfaces:**
- Consumes: `PULL_MAX_BYTES` dan `recordBytes` dari Task 1; `snapshot`, `DELEGATE`, `SYNCED`, `PARENTS` yang sudah ada.
- Produces:
  - `export type BootstrapPage = { cursor: string; records: PulledRecord[]; hasMore: boolean; next: string | null }`
  - `export async function bootstrapSnapshot(after: string | null, maxBytes?: number): Promise<BootstrapPage>`
  - `GET /api/sync/bootstrap?after=<entity>:<id>` (device-token) — Task 6 memanggilnya.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/sync-bootstrap.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { bootstrapSnapshot } from "../src/services/sync";

const app = buildApp();
const clean = async () => {
  await prisma.syncLog.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function seed() {
  await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: "/lokal" } });
  await prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "planned",
    priority: "sedang", author: "a@b.co", objective: "o" } });
}

describe("SPEC-885 · bootstrapSnapshot (hub)", () => {
  it("mengirim keadaan TABEL dalam urutan dependensi: induk selalu mendahului anaknya", async () => {
    await seed();
    const page = await bootstrapSnapshot(null);
    const urutan = page.records.map((r) => `${r.entity}:${r.recordId}`);
    expect(urutan.indexOf("project:p1")).toBeLessThan(urutan.indexOf("spec:SPEC-1"));
    expect(page.hasMore).toBe(false);
    expect(page.next).toBeNull();
  });

  it("kursor = puncak feed, diambil SEBELUM tabel dibaca", async () => {
    await seed();
    await prisma.syncLog.create({ data: { entity: "project", recordId: "p1", version: 1, op: "upsert", data: {} } });
    const tip = await prisma.syncLog.findFirst({ orderBy: { seq: "desc" } });
    const page = await bootstrapSnapshot(null);
    expect(page.cursor).toBe(String(tip!.seq));
  });

  it("feed kosong → kursor 0 (client menarik seluruh feed sesudahnya, tetap konvergen)", async () => {
    await seed();
    const page = await bootstrapSnapshot(null);
    expect(page.cursor).toBe("0");
  });

  it("berhalaman per anggaran byte; `next` melanjutkan tepat sesudah record terakhir yang dikirim", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing" } });
    for (const id of ["SPEC-1", "SPEC-2", "SPEC-3"]) {
      await prisma.spec.create({ data: {
        id, projectId: "p1", title: "x".repeat(40_000), source: "brief", stage: "planned",
        priority: "sedang", author: "a@b.co", objective: "o" } });
    }
    const page1 = await bootstrapSnapshot(null, 90_000);
    expect(page1.hasMore).toBe(true);
    expect(page1.next).not.toBeNull();

    const page2 = await bootstrapSnapshot(page1.next, 90_000);
    const semua = [...page1.records, ...page2.records].map((r) => `${r.entity}:${r.recordId}`);
    expect(new Set(semua).size).toBe(semua.length);          // tak ada duplikat
    expect(semua).toContain("spec:SPEC-3");                   // tak ada yang terlompati
  });
});

describe("SPEC-885 · GET /api/sync/bootstrap", () => {
  it("butuh device token; menjawab bentuk yang sama dengan service", async () => {
    await seed();
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");

    const tanpa = await app.inject({ method: "GET", url: "/api/sync/bootstrap" });
    expect(tanpa.statusCode).toBe(401);

    const res = await app.inject({
      method: "GET", url: "/api/sync/bootstrap",
      headers: { authorization: `Bearer ${t.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("cursor");
    expect(body).toHaveProperty("hasMore");
    expect(body.records.map((r: { recordId: string }) => r.recordId)).toContain("p1");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-bootstrap.test.ts
```

Diharapkan: FAIL dengan `bootstrapSnapshot is not exported` dan route 404.

- [x] **Step 3: Implementasi — service**

Di `server/src/services/sync.ts`, tepat **di bawah** fungsi `pull`, tambahkan:

```ts
// SPEC-885 · ADR-0138 · urutan dependensi topologis, diturunkan dari `PARENTS`. Induk selalu
// mendahului anaknya, jadi penerima tak pernah perlu menunda satu record pun — urutan FK benar
// BY CONSTRUCTION, bukan diperbaiki oleh retry. `sessionResult` ditaruh terakhir karena
// `projectId`-nya kolom polos TANPA @relation (lihat catatan di `PARENTS`).
const BOOTSTRAP_ORDER: Entity[] = [
  "project", "spec", "ticket", "customAgent", "githubIssue", "ticketAttachment", "sessionResult",
];

export type BootstrapPage = {
  cursor: string; records: PulledRecord[]; hasMore: boolean; next: string | null;
};

// SPEC-885 · ADR-0138 · KEADAAN, bukan sejarah. Client dengan kursor 0 yang menarik lewat feed
// harus memutar ulang setiap versi antara yang masih tersimpan: di hub produksi 3.637 baris /
// 7,9 MB, hanya untuk mendarat jadi 889 record / ~2,5 MB. Membaca tabel langsung menghapus
// kemubaziran itu SEKALIGUS masalah urutan yang ditinggalkan retensi ADR-0131.
export async function bootstrapSnapshot(
  after: string | null, maxBytes = PULL_MAX_BYTES,
): Promise<BootstrapPage> {
  // Kursor DULU, sebelum satu tabel pun dibaca — dan urutan ini yang harus dipertahankan.
  //
  // Akibatnya baris yang dibaca sesudah ini boleh LEBIH BARU daripada kursornya, sehingga client
  // yang memutar ulang feed `> cursor` bisa sesaat menulis versi lama di atas versi baru
  // (`upsertLocal` menulis apa adanya, tak melihat urutan versi). Itu konvergen: seluruh baris
  // diputar berurutan dan berakhir di puncak yang benar.
  //
  // Kebalikannya TIDAK aman. Kursor yang diambil SESUDAH membaca membuat tulisan yang masuk di
  // sela pembacaan ber-`seq` lebih kecil daripada kursor — jadi ia tak pernah ditarik, dan
  // hilangnya permanen.
  const tip = await prisma.syncLog.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
  const cursor = tip ? String(tip.seq) : "0";

  const sep = after ? after.indexOf(":") : -1;
  const afterEntity = sep > 0 ? after!.slice(0, sep) : null;
  const afterId = sep > 0 ? after!.slice(sep + 1) : null;
  const startAt = afterEntity ? BOOTSTRAP_ORDER.indexOf(afterEntity as Entity) : 0;
  if (startAt < 0) throw new Error("bootstrap cursor tak dikenal");

  const records: PulledRecord[] = [];
  let bytes = 0;
  let last: string | null = null;

  for (let i = startAt; i < BOOTSTRAP_ORDER.length; i++) {
    const entity = BOOTSTRAP_ORDER[i]!;
    // Hanya entitas tempat kursor berhenti yang melanjutkan dari id tertentu; sesudahnya penuh.
    const gt = i === startAt && afterId ? afterId : null;
    const rows = await (DELEGATE[entity] as unknown as {
      findMany: (a: object) => Promise<{ id: string }[]>;
    }).findMany({
      ...(gt ? { where: { id: { gt } } } : {}),
      orderBy: { id: "asc" }, select: { id: true },
    });
    for (const row of rows) {
      // Lewat `snapshot()` yang sama dengan feed: satu-satunya jalur proyeksi `FIELDS`, jadi tak
      // ada bentuk kedua yang bisa menyimpang diam-diam saat kolom baru ikut menyeberang.
      const snap = await snapshot(entity, row.id);
      if (!snap) continue;
      const rec: PulledRecord = {
        entity, recordId: row.id, version: snap.version, op: "upsert", data: snap.data,
      };
      const size = recordBytes(rec);
      if (records.length && bytes + size > maxBytes) {
        return { cursor, records, hasMore: true, next: last };
      }
      bytes += size;
      records.push(rec);
      last = `${entity}:${row.id}`;
    }
  }
  // Paginasi ini sengaja BUKAN snapshot berkonsistensi: record yang lahir di antara dua halaman
  // dan ber-id lebih kecil dari kursor memang terlewat di sini. Ia tetap ada di feed pada
  // `seq > cursor`, jadi drain sesudah bootstrap yang menjemputnya. Konvergensi tidak bergantung
  // pada bootstrap yang lengkap — hanya pada kursornya yang tidak pernah melewati kenyataan.
  return { cursor, records, hasMore: false, next: null };
}
```

- [x] **Step 4: Implementasi — route**

Di `server/src/routes/sync.ts`, ubah baris import service:

```ts
import { applyPush, pull, bootstrapSnapshot, isEntity, type Entity } from "../services/sync";
```

lalu tepat **di bawah** route `app.get("/sync/pull", ...)`, tambahkan:

```ts
  // SPEC-885 · ADR-0138 · keadaan sekarang dalam urutan dependensi, untuk client yang kursornya
  // masih 0. Tak ada gerbang tambahan di `app.ts`: path ini di bawah `/api/sync` dan bukan salah
  // satu pengecualian cookie-only, jadi ia otomatis ikut jalur device-token seperti `/sync/pull`.
  app.get("/sync/bootstrap", { preHandler: requireDeviceToken }, async (req) => {
    const after = (req.query as { after?: string }).after ?? null;
    return bootstrapSnapshot(after);
  });
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-bootstrap.test.ts server/test/sync.route.test.ts server/test/sync-hub-origin-writes.test.ts
```

Diharapkan: PASS semua.

- [x] **Step 6: Typecheck**

```bash
pnpm --filter ./server typecheck
```

Diharapkan: keluar 0.

- [x] **Step 7: Commit**

```bash
git add server/src/services/sync.ts server/src/routes/sync.ts server/test/sync-bootstrap.test.ts
git commit -m "feat(spec-885): GET /api/sync/bootstrap — keadaan, bukan sejarah

Client berkursor 0 harus memutar ulang tiap versi antara yang masih
tersimpan: 3.637 baris / 7,9 MB di hub produksi, untuk mendarat jadi 889
record / ~2,5 MB. Membaca tabel dalam urutan dependensi menghapus kemubaziran
itu sekaligus masalah urutan yang ditinggalkan retensi ADR-0131 — urutan FK
benar by construction, bukan diperbaiki retry.

Kursor diambil SEBELUM tabel dibaca. Urutan sebaliknya membuat tulisan yang
masuk di sela pembacaan ber-seq lebih kecil dari kursor: hilang permanen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Client memakai bootstrap

**Files:**
- Modify: `server/src/services/sync-client.ts` (tambah `bootstrapOnce`, panggil dari `startSyncClient` & `syncNow`)
- Test: `server/test/sync-bootstrap.test.ts` (tambah)

**Interfaces:**
- Consumes: route `GET /api/sync/bootstrap` dari Task 5; `MAX_DRAIN_PAGES` dari Task 3.
- Produces: `export async function bootstrapOnce(transport: Transport): Promise<number | null>` — jumlah record terpasang, atau `null` bila tak berlaku / hub tak mendukung.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/sync-bootstrap.test.ts` (tambahkan import):

```ts
import { bootstrapOnce, getCursor, setCursor, type Transport } from "../src/services/sync-client";
import { enqueueOutbox } from "../src/services/outbox";
```

dan blok describe baru:

```ts
describe("SPEC-885 · bootstrapOnce (client)", () => {
  const halaman = (over: Record<string, unknown> = {}) => ({
    cursor: "77", hasMore: false, next: null,
    records: [
      { entity: "project", recordId: "p1", version: 2, op: "upsert",
        data: { name: "p1", desc: "d", kind: "existing", stack: "", gitRemote: null } },
      { entity: "spec", recordId: "SPEC-1", version: 5, op: "upsert",
        data: { projectId: "p1", title: "t", source: "brief", stage: "planned",
                priority: "sedang", author: "a@b.co", objective: "o" } },
    ],
    ...over,
  });
  const transportOk: Transport = async (_m, path) =>
    path.startsWith("/api/sync/bootstrap")
      ? { status: 200, body: halaman() }
      : { status: 200, body: { results: [] } };

  beforeEach(async () => {
    await prisma.syncOutbox.deleteMany(); await prisma.syncState.deleteMany();
  });

  it("memasang seluruh record dan memajukan kursor ke puncak feed", async () => {
    const n = await bootstrapOnce(transportOk);
    expect(n).toBe(2);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeTruthy();
    expect(await getCursor()).toBe("77");
  });

  it("TIDAK berjalan bila kursor sudah maju (bukan instalasi baru)", async () => {
    await setCursor("5");
    expect(await bootstrapOnce(transportOk)).toBeNull();
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });

  it("TIDAK berjalan bila outbox berisi — suntingan lokal tak boleh ditimpa", async () => {
    await enqueueOutbox("spec", "SPEC-LOKAL");
    expect(await bootstrapOnce(transportOk)).toBeNull();
  });

  it("hub lama (404) → null, tanpa melempar; pemanggil jatuh ke drain feed", async () => {
    const transport404: Transport = async () => ({ status: 404, body: { error: "not found" } });
    expect(await bootstrapOnce(transport404)).toBeNull();
    expect(await getCursor()).toBe("0");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-bootstrap.test.ts
```

Diharapkan: FAIL dengan `bootstrapOnce is not exported`.

- [x] **Step 3: Implementasi**

Di `server/src/services/sync-client.ts`, tepat **di atas** `export async function syncOnce`, tambahkan:

```ts
// SPEC-885 · ADR-0138 · instalasi baru menarik KEADAAN, bukan sejarah.
//
// Dua syarat, dan syarat kedua yang penting: kursor 0 saja tidak cukup, karena "Tarik ulang"
// memundurkan kursor ke 0 di mesin yang bisa saja punya suntingan lokal belum terkirim. Outbox
// kosong adalah bukti tak ada yang bisa ditimpa.
//
// Balikan `null` = "tidak berlaku di sini" ATAU "hub tak mendukung" — pemanggil jatuh ke drain
// feed biasa dalam kedua hal. Kegagalan di tengah halaman juga `null`: record yang terlanjur
// terpasang aman karena upsert idempoten dan kursor belum dimajukan, jadi drain berikutnya
// sekadar menerapkannya ulang.
export async function bootstrapOnce(transport: Transport): Promise<number | null> {
  if (await getCursor() !== "0") return null;
  if ((await listOutbox()).length) return null;

  let after: string | null = null;
  let cursor = "0";
  let applied = 0;
  for (let page = 0; page < MAX_DRAIN_PAGES; page++) {
    const q = after ? `?after=${encodeURIComponent(after)}` : "";
    const res = await transport("GET", `/api/sync/bootstrap${q}`);
    if (res.status !== 200 || !Array.isArray(res.body?.records)) return null;
    for (const raw of res.body.records as unknown[]) {
      const rec = validateIncomingRecord(raw);
      if (!rec.op) continue;
      // Urutan dependensi dijamin hub, jadi tak ada `deferred` di sini: satu record yang gagal
      // di jalur ini adalah kesalahan kontrak, bukan artefak urutan — dan harus terlihat.
      await applyRemote(rec.entity, rec.recordId, rec.version, rec.data, rec.op);
      applied++;
    }
    cursor = String(res.body.cursor ?? "0");
    const next = res.body.next ? String(res.body.next) : null;
    if (!res.body.hasMore || !next) break;
    after = next;
  }
  await setCursor(cursor);
  return applied;
}
```

- [x] **Step 4: Implementasi — panggil dari dua tempat**

Di `syncNow`, ganti dua baris terakhir:

```ts
  const transport = fetchTransport(base, token);
  if (opts?.full) await setCursor("0");
  // Menggerbangi dirinya sendiri (kursor 0 + outbox kosong), jadi memanggilnya tanpa syarat aman:
  // di client yang sudah mapan ia langsung mengembalikan null.
  const booted = await bootstrapOnce(transport).catch(() => null);
  const stats = await syncOnce(transport);
  if (booted) stats.pulled += booted;
  return stats;
```

Di `startSyncClient`, ganti baris `await tick();               // drain awal + pull awal` dengan:

```ts
  // SPEC-885 · instalasi baru: satu tarikan keadaan sebelum drain feed. Gagal/tak didukung →
  // `null`, dan `tick()` di bawah menanganinya seperti biasa.
  await bootstrapOnce(transport).catch(() => null);
  await tick();               // drain awal + pull awal
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-bootstrap.test.ts server/test/sync-client.test.ts server/test/sync-drain.test.ts
```

Diharapkan: PASS semua.

- [x] **Step 6: Typecheck**

```bash
pnpm --filter ./server typecheck
```

Diharapkan: keluar 0.

- [x] **Step 7: Commit**

```bash
git add server/src/services/sync-client.ts server/test/sync-bootstrap.test.ts
git commit -m "feat(spec-885): client menarik bootstrap saat kursor 0 dan outbox kosong

Syarat kedua yang penting: 'Tarik ulang' memundurkan kursor ke 0 di mesin
yang bisa punya suntingan lokal belum terkirim. Outbox kosong adalah bukti
tak ada yang bisa ditimpa.

Hub lama menjawab 404 → null → jatuh ke drain feed biasa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `runHealth` berhenti berdenyut ke change-feed

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Vps`)
- Create: `server/prisma/migrations/20260822090000_vps_last_published_at/migration.sql`
- Modify: `server/src/services/vps-audit.ts` (`runHealth` + `shouldPublishHealth` baru)
- Test: `server/test/vps-audit.test.ts` (tambah)

**Interfaces:**
- Produces:
  - `export const PUBLISH_HEARTBEAT_MS = 3_600_000`
  - `export function shouldPublishHealth(prev: { health: unknown; lastPublishedAt: Date | null } | null, next: unknown, now?: number): boolean`
- `Vps.lastPublishedAt` **tidak** ditambahkan ke `FIELDS.vps` di `sync.ts` — ia LOCAL-only.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/vps-audit.test.ts` (tambahkan import `shouldPublishHealth, PUBLISH_HEARTBEAT_MS` dari `../src/services/vps-audit`):

```ts
describe("SPEC-885 · keputusan publish health", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const health = { uptime: "1d", disk: "40%", mem: "50%", load: "0.1" };

  it("health identik + baru saja dipublish → JANGAN publish", () => {
    expect(shouldPublishHealth(
      { health, lastPublishedAt: new Date(now - 60_000) }, health, now,
    )).toBe(false);
  });

  it("health berubah → publish, seberapa pun baru publikasi terakhir", () => {
    expect(shouldPublishHealth(
      { health, lastPublishedAt: new Date(now - 1_000) }, { ...health, disk: "91%" }, now,
    )).toBe(true);
  });

  it("health identik tapi publikasi terakhir sudah lewat ambang → publish (denyut berjangka)", () => {
    expect(shouldPublishHealth(
      { health, lastPublishedAt: new Date(now - PUBLISH_HEARTBEAT_MS - 1) }, health, now,
    )).toBe(true);
  });

  it("belum pernah dipublish → publish", () => {
    expect(shouldPublishHealth({ health, lastPublishedAt: null }, health, now)).toBe(true);
    expect(shouldPublishHealth(null, health, now)).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-audit.test.ts
```

Diharapkan: FAIL dengan `shouldPublishHealth is not exported`.

- [x] **Step 3: Migration + schema**

Tambahkan ke model `Vps` di `server/prisma/schema.prisma`, tepat di bawah baris `hardened`:

```prisma
  // SPEC-885 · ADR-0138 · kapan baris ini TERAKHIR diterbitkan ke change-feed. LOCAL-only —
  // sengaja TIDAK masuk FIELDS sync, cermin repoDir/keyPath: ia properti mesin ini, bukan
  // pernyataan bersama. Dipakai `runHealth` untuk denyut berjangka saat `health` tak berubah.
  lastPublishedAt DateTime?
```

Buat `server/prisma/migrations/20260822090000_vps_last_published_at/migration.sql`:

```sql
-- SPEC-885 · ADR-0138 · aditif, nullable, tanpa default: nol backfill dan aman untuk hub
-- produksi yang sedang berjalan (memori: hub = live, migrate additif saja).
ALTER TABLE "Vps" ADD COLUMN "lastPublishedAt" DATETIME;
```

Regenerate client:

```bash
pnpm --filter ./server db:generate
```

- [x] **Step 4: Implementasi**

Di `server/src/services/vps-audit.ts`, tepat **di atas** `export async function runHealth`, tambahkan:

```ts
// SPEC-885 · ADR-0138 · denyut berjangka. `runHealth` dulu memanggil `notifySynced` di SETIAP
// polling 5 menit, dan itu menghasilkan 2.469 baris change-feed untuk 9 record vps di hub
// produksi — 51% byte feed dan 68% barisnya, hanya untuk mendarat jadi 9 baris. ADR-0131
// menyebutnya eksplisit sebagai optimasi terpisah; di sinilah tempatnya.
export const PUBLISH_HEARTBEAT_MS = 3_600_000;

// Jebakan yang harus dihindari: `runHealth` juga selalu menulis `lastSeenAt: new Date()`, dan
// `lastSeenAt` ADA di `FIELDS.vps` — jadi membandingkan seluruh snapshot akan selalu "berubah"
// dan denyut 5 menit itu justru yang sedang dicabut. Yang dibandingkan HANYA `health`.
//
// Tapi kalau `lastSeenAt` berhenti menyeberang sama sekali, ia mendarat basi selamanya di tiap
// client tanpa satu pun error — kelas gagal-senyap ADR-0090/0093/0105. Denyut berjangka yang
// menjaganya: 12 baris/hari/vps alih-alih 288, dan `lastSeenAt` akurat dalam ±1 jam.
//
// Perbandingan `JSON.stringify` stabil karena `parseHealth` membangun objeknya dengan urutan
// kunci tetap, dan Prisma mengembalikan kolom Json dengan urutan yang sama seperti disimpan.
export function shouldPublishHealth(
  prev: { health: unknown; lastPublishedAt: Date | null } | null,
  next: unknown,
  now: number = Date.now(),
): boolean {
  if (JSON.stringify(prev?.health ?? null) !== JSON.stringify(next ?? null)) return true;
  if (!prev?.lastPublishedAt) return true;
  return now - prev.lastPublishedAt.getTime() >= PUBLISH_HEARTBEAT_MS;
}
```

lalu ganti seluruh fungsi `runHealth` dengan:

```ts
export async function runHealth(v: VpsRow): Promise<boolean> {
  const r = await sshExec(target(v), HEALTH_CMD, { timeoutMs: 60_000 });
  const health = parseHealth(r.out);
  if (r.code !== 0 || !health) return false;
  // Dibaca SEBELUM ditulis: sesudah update, `health` lama sudah tak ada untuk dibandingkan.
  const prev = await prisma.vps.findUnique({
    where: { id: v.id }, select: { health: true, lastPublishedAt: true },
  });
  const publish = shouldPublishHealth(prev, health);
  await prisma.vps.update({ where: { id: v.id }, data: {
    health: health as unknown as Prisma.InputJsonValue,
    lastSeenAt: new Date(),
    ...(publish ? { lastPublishedAt: new Date() } : {}),
  } });
  if (publish) await notifySynced("vps", v.id); // SPEC-213/330 · health ikut disync (sadar-peran)
  return true;
}
```

`runAudit` **tidak disentuh**: `AUDIT_MS = 24 jam` dan `auditSweep` melewati VPS yang `lastAuditAt`-nya < 24 jam, jadi ia paling banyak 1 baris/hari/vps — itu bukan denyut.

- [x] **Step 5: Buat health fixture bisa berubah**

`shouldPublishHealth` menguji **keputusannya**; yang berikut menguji **pemasangannya** — dan justru di situ kelas bug ADR-0090/0093 hidup (lupa menggerbangi `notifySynced`, atau menulis `lastPublishedAt` di cabang yang salah). Untuk itu health palsu harus bisa berbeda antar-sapuan.

Di `server/test/fixtures/fake-ssh.sh`, ganti baris disk pada cabang HEALTH:

```bash
if [[ "$last" == *"HEALTH"* ]]; then
  echo "HEALTH uptime up 3 days"; echo "HEALTH disk ${FAKE_SSH_DISK:-42%}"
  echo "HEALTH mem 512/2048MB"; echo "HEALTH load 0.1 0.2 0.3"; exit 0
fi
```

Default `42%` dipertahankan, jadi test lain yang memeriksa nilai itu tak berubah.

- [x] **Step 6: Tulis test pemasangan, jalankan, pastikan lulus**

Tambahkan ke `server/test/vps-monitor.test.ts` (import `PUBLISH_HEARTBEAT_MS` dari `../src/services/vps-audit`):

```ts
describe("SPEC-885 · healthSweep berhenti berdenyut ke change-feed", () => {
  const hitung = (id: string) => prisma.syncLog.count({ where: { entity: "vps", recordId: id } });

  it("health identik + denyut belum lewat → TIDAK ada baris SyncLog kedua", async () => {
    await resetDb(); await prisma.syncLog.deleteMany();
    const v = await makeVps({ name: "hb1", host: "198.51.100.41" });

    await healthSweep();
    expect(await hitung(v.id)).toBe(1);   // pertama kali selalu publish (health null → terisi)

    await healthSweep();
    expect(await hitung(v.id)).toBe(1);   // dulu: 2, dan begitu seterusnya tiap 5 menit
  });

  it("health berubah → tepat satu baris tambahan", async () => {
    await resetDb(); await prisma.syncLog.deleteMany();
    const v = await makeVps({ name: "hb2", host: "198.51.100.42" });
    await healthSweep();
    process.env.FAKE_SSH_DISK = "91%";
    try {
      await healthSweep();
      expect(await hitung(v.id)).toBe(2);
    } finally { delete process.env.FAKE_SSH_DISK; }
  });

  it("denyut berjangka: lastPublishedAt basi → publish walau health identik", async () => {
    await resetDb(); await prisma.syncLog.deleteMany();
    const v = await makeVps({ name: "hb3", host: "198.51.100.43" });
    await healthSweep();
    await prisma.vps.update({ where: { id: v.id }, data: {
      lastPublishedAt: new Date(Date.now() - PUBLISH_HEARTBEAT_MS - 1_000) } });

    await healthSweep();
    expect(await hitung(v.id)).toBe(2);
  });

  it("lastSeenAt tetap disegarkan tiap sapuan, publish atau tidak", async () => {
    await resetDb(); await prisma.syncLog.deleteMany();
    const v = await makeVps({ name: "hb4", host: "198.51.100.44" });
    await healthSweep();
    const pertama = (await prisma.vps.findUnique({ where: { id: v.id } }))!.lastSeenAt!;

    await healthSweep();
    const kedua = (await prisma.vps.findUnique({ where: { id: v.id } }))!.lastSeenAt!;
    expect(kedua.getTime()).toBeGreaterThanOrEqual(pertama.getTime());
    expect(await hitung(v.id)).toBe(1);   // disegarkan lokal TANPA menerbitkan
  });
});
```

Test terakhir yang menjaga batasnya: memangkas penerbitan tak boleh ikut memangkas pembaruan `lastSeenAt` lokal.

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-monitor.test.ts
```

Diharapkan: PASS. Bila test pertama gagal dengan `2`, `notifySynced` belum digerbangi. Bila test terakhir gagal, `lastSeenAt` ikut terjatuh ke cabang bersyarat — kembalikan ia ke luar spread.

- [x] **Step 7: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-audit.test.ts server/test/vps-sync.test.ts server/test/vps-monitor.test.ts server/test/sync-exclusions.test.ts server/test/vps.route.test.ts
```

Diharapkan: PASS semua. `sync-exclusions.test.ts` ikut karena ia menegakkan kolom mana yang **tidak** menyeberang — `lastPublishedAt` harus tetap di luar `FIELDS.vps`. `vps.route.test.ts` ikut karena ia juga memakai fixture ssh yang barusan disentuh.

- [x] **Step 8: Typecheck**

```bash
pnpm --filter ./server typecheck
```

Diharapkan: keluar 0.

- [x] **Step 9: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/src/services/vps-audit.ts \
       server/test/vps-audit.test.ts server/test/vps-monitor.test.ts server/test/fixtures/fake-ssh.sh
git commit -m "perf(spec-885): runHealth publish saat health berubah, bukan tiap polling

2.469 baris change-feed untuk 9 record vps di hub produksi — 51% byte feed,
68% barisnya, untuk mendarat jadi 9 baris. ADR-0131 menyebutnya eksplisit
sebagai optimasi terpisah; ini tempatnya.

Yang dibandingkan HANYA health: runHealth juga menulis lastSeenAt tiap
polling, dan lastSeenAt ada di FIELDS sync — membandingkan seluruh snapshot
akan selalu 'berubah'. Denyut berjangka 1 jam menjaga lastSeenAt tak mendarat
basi di client (kelas gagal-senyap ADR-0090/0093/0105).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: gzip sisi hub

**Files:**
- Modify: `server/src/routes/sync.ts` (helper `maybeGzip` + dua route)
- Test: `server/test/sync-page-budget.test.ts` (tambah)

**Interfaces:**
- Produces: route `/sync/pull` dan `/sync/bootstrap` menjawab `content-encoding: gzip` bila request membawa `accept-encoding: gzip`; selalu menyetel `vary: accept-encoding`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/sync-page-budget.test.ts` (tambahkan import `buildApp`, `issueDeviceToken`, `gunzipSync` dari `node:zlib`):

```ts
describe("SPEC-885 · gzip endpoint sync (hub)", () => {
  it("membalas gzip saat diminta, plain saat tidak", async () => {
    const app = buildApp();
    const u = await prisma.user.create({ data: { email: "g@g.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    await feedRow("SPEC-1", 5_000);

    const dimampat = await app.inject({
      method: "GET", url: "/api/sync/pull?since=0",
      headers: { authorization: `Bearer ${t.token}`, "accept-encoding": "gzip" },
    });
    expect(dimampat.headers["content-encoding"]).toBe("gzip");
    expect(dimampat.headers["vary"]).toBe("accept-encoding");
    const isi = JSON.parse(gunzipSync(dimampat.rawPayload).toString("utf8"));
    expect(isi.records[0].recordId).toBe("SPEC-1");
    expect(dimampat.rawPayload.length).toBeLessThan(1_000); // 5 KB "x" berulang mampat jauh

    const polos = await app.inject({
      method: "GET", url: "/api/sync/pull?since=0",
      headers: { authorization: `Bearer ${t.token}` },
    });
    expect(polos.headers["content-encoding"]).toBeUndefined();
    expect(polos.json().records[0].recordId).toBe("SPEC-1");
  });
});
```

Catatan: `clean` di berkas ini hanya menghapus `syncLog` — tambahkan `deviceToken`, `session`, dan `user` ke `clean` agar test ini tak bocor antar-run.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-page-budget.test.ts
```

Diharapkan: FAIL — `content-encoding` `undefined`.

- [x] **Step 3: Implementasi**

Di `server/src/routes/sync.ts`, tambahkan import di atas:

```ts
import { gzipSync } from "node:zlib";
import type { FastifyReply, FastifyRequest } from "fastify";
```

lalu tepat **di atas** `export default async function (app: FastifyInstance) {`, tambahkan:

```ts
// SPEC-885 · ADR-0138 · gzip DUA endpoint sync saja, bukan plugin lifecycle global.
//
// `@fastify/compress` sengaja tidak dipakai: ia belum jadi dependency, menambahkannya menyentuh
// daftar `--external` di skrip build esbuild, dan ia memasang hook di seluruh lifecycle. Yang
// dibutuhkan hanya dua endpoint mesin-ke-mesin yang payload-nya sudah dibatasi ≤1 MB oleh
// anggaran byte dan sudah utuh di memori — `gzipSync` atasnya ~10 ms. Plugin sebesar itu untuk
// permukaan sekecil itu adalah dependency yang harus dibayar tiap rilis tanpa alasan.
function maybeGzip(req: FastifyRequest, reply: FastifyReply, payload: unknown): unknown {
  // `vary` disetel TANPA syarat: ia menerangkan bahwa balasan berbeda menurut accept-encoding,
  // dan itu benar juga bagi balasan yang kebetulan tidak dimampatkan. Menyetelnya hanya di
  // cabang gzip adalah cara klasik meracuni cache perantara.
  reply.header("vary", "accept-encoding");
  if (!/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) return payload;
  reply.header("content-type", "application/json; charset=utf-8");
  reply.header("content-encoding", "gzip");
  return gzipSync(Buffer.from(JSON.stringify(payload)));
}
```

Ubah dua route menjadi:

```ts
  app.get("/sync/pull", { preHandler: requireDeviceToken }, async (req, reply) => {
    const since = (req.query as { since?: string }).since ?? "0";
    return maybeGzip(req, reply, await pull(since));
  });

  app.get("/sync/bootstrap", { preHandler: requireDeviceToken }, async (req, reply) => {
    const after = (req.query as { after?: string }).after ?? null;
    return maybeGzip(req, reply, await bootstrapSnapshot(after));
  });
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-page-budget.test.ts server/test/sync-bootstrap.test.ts server/test/sync-client.test.ts
```

Diharapkan: PASS semua. `sync-client.test.ts` penting di sini: `realTransport()`-nya memakai `app.inject` **tanpa** `accept-encoding`, jadi ia membuktikan jalur polos tetap utuh.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/sync.ts server/test/sync-page-budget.test.ts
git commit -m "perf(spec-885): gzip /sync/pull dan /sync/bootstrap saat diminta

gzipSync di dua route, bukan @fastify/compress: paket itu belum jadi
dependency, menambahkannya menyentuh daftar --external esbuild, dan ia
memasang hook lifecycle global — untuk dua endpoint mesin-ke-mesin yang
payload-nya sudah dibatasi 1 MB dan sudah utuh di memori.

vary: accept-encoding disetel tanpa syarat, termasuk pada balasan polos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: gzip sisi client + penjaga bom dekompresi

**Files:**
- Modify: `server/src/services/safe-outbound-request.ts`
- Modify: `server/src/services/sync-client.ts` (`fetchTransport`)
- Test: `server/test/safe-outbound-request.test.ts` (tambah)

**Interfaces:**
- Produces: `SafeRequestOptions` bertambah dua field opsional — `acceptEncoding?: "gzip"` dan `maxDecodedBytes?: number`. Keduanya **default mati/`maxResponseBytes`**, jadi tiap pemanggil lain (webhook keluar, ADR-0100) tak berubah perilakunya.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/safe-outbound-request.test.ts` (import `createServer` dari `node:http`, `gzipSync` dari `node:zlib`, dan `safeRequest`):

```ts
describe("SPEC-885 · dekompresi gzip opt-in", () => {
  async function serve(handler: (res: import("node:http").ServerResponse) => void) {
    const srv = createServer((_req, res) => handler(res));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;
    return { port, close: () => new Promise<void>((r) => srv.close(() => r())) };
  }
  const opts = (port: number) => ({
    url: new URL(`http://127.0.0.1:${port}/x`), method: "GET" as const, headers: {},
    allowPrivate: true, connectMs: 2_000, totalMs: 5_000, maxResponseBytes: 1024 * 1024,
  });

  it("men-decompress hanya saat diminta", async () => {
    const isi = gzipSync(Buffer.from(JSON.stringify({ ok: true })));
    const s = await serve((res) => { res.setHeader("content-encoding", "gzip"); res.end(isi); });
    try {
      const diminta = await safeRequest({ ...opts(s.port), acceptEncoding: "gzip" });
      expect(JSON.parse(diminta.body.toString("utf8"))).toEqual({ ok: true });

      // Tanpa opt-in body dikembalikan APA ADANYA (byte gzip mentah) — pemanggil lain seperti
      // webhook keluar tak boleh berubah perilakunya karena fitur ini.
      const tanpa = await safeRequest(opts(s.port));
      expect(tanpa.body.equals(isi)).toBe(true);
    } finally { await s.close(); }
  });

  it("menolak bom dekompresi: cap kedua atas byte TERURAI", async () => {
    // 40 MB nol mampat jadi ~40 KB — lolos maxResponseBytes, dan itulah kenapa satu cap saja
    // tidak cukup begitu dekompresi menyala.
    const bom = gzipSync(Buffer.alloc(40 * 1024 * 1024));
    expect(bom.length).toBeLessThan(1024 * 1024);
    const s = await serve((res) => { res.setHeader("content-encoding", "gzip"); res.end(bom); });
    try {
      await expect(safeRequest({
        ...opts(s.port), acceptEncoding: "gzip", maxDecodedBytes: 1024 * 1024,
      })).rejects.toThrow(/terurai terlalu besar/);
    } finally { await s.close(); }
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/safe-outbound-request.test.ts
```

Diharapkan: FAIL — test pertama gagal saat `JSON.parse` byte gzip mentah; test kedua tak melempar.

- [x] **Step 3: Implementasi — tipe**

Di `server/src/services/safe-outbound-request.ts`, tambahkan import dan perluas tipe:

```ts
import { createGunzip } from "node:zlib";
```

```ts
export type SafeRequestOptions = {
  url: URL; method: "GET" | "POST"; headers: Record<string, string>; body?: Buffer;
  allowPrivate: boolean; connectMs: number; totalMs: number; maxResponseBytes: number;
  // SPEC-885 · ADR-0138 · dekompresi OPT-IN, default MATI. Modul ini juga melayani webhook keluar
  // (ADR-0100) di balik penjaga SSRF; menyalakan gunzip untuk semua pemanggil memperlebar
  // permukaan serang tanpa ada satu pun yang memintanya.
  acceptEncoding?: "gzip";
  // Cap KEDUA, atas byte TERURAI. `maxResponseBytes` menghitung byte kabel, dan itu berhenti
  // cukup begitu dekompresi menyala: 40 MB nol mampat jadi ~40 KB, lolos cap kabel mana pun.
  maxDecodedBytes?: number;
};
```

- [x] **Step 4: Implementasi — `pinnedRequest`**

Ganti seluruh callback response di `pinnedRequest` (dari `}, (response) => {` sampai penutup callback itu) dengan:

```ts
    }, (response) => {
      const dimampat = input.acceptEncoding === "gzip"
        && String(response.headers["content-encoding"] ?? "").toLowerCase() === "gzip";
      const capTerurai = input.maxDecodedBytes ?? input.maxResponseBytes;
      const chunks: Buffer[] = [];
      let kabel = 0, terurai = 0;
      const selesai = () => resolve({
        status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks),
      });

      const sink = dimampat ? createGunzip() : null;
      if (sink) {
        sink.on("data", (chunk: Buffer) => {
          terurai += chunk.length;
          if (terurai > capTerurai) {
            sink.destroy(new Error("outbound response terurai terlalu besar"));
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        sink.on("end", selesai);
        sink.on("error", reject);
      }

      response.on("data", (chunk: Buffer) => {
        kabel += chunk.length;
        if (kabel > input.maxResponseBytes) {
          response.destroy(new Error("outbound response terlalu besar"));
          return;
        }
        if (sink) sink.write(chunk); else chunks.push(chunk);
      });
      response.on("end", () => { if (sink) sink.end(); else selesai(); });
      // Dulu tak ada handler ini: penolakan saat cap terlampaui bergantung pada propagasi
      // implisit ke event 'error' milik request. Eksplisit lebih murah daripada mengandalkannya.
      response.on("error", reject);
    });
```

- [x] **Step 5: Implementasi — `fetchTransport` meminta gzip**

Di `server/src/services/sync-client.ts`, di dalam `fetchTransport`:

```ts
    const res = await safeRequest({
      url, method,
      headers: {
        authorization: `Bearer ${token}`,
        // SPEC-885 · ADR-0138 · hub lama mengabaikan header ini dan membalas polos; `safeRequest`
        // hanya men-decompress bila balasannya benar-benar ber-`content-encoding: gzip`.
        "accept-encoding": "gzip",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: Buffer.from(JSON.stringify(body)) } : {}),
      allowPrivate: process.env.NODE_ENV !== "production" && loopback,
      connectMs: 5_000, totalMs: 15_000,
      maxResponseBytes: 8 * 1024 * 1024,
      acceptEncoding: "gzip",
      maxDecodedBytes: 16 * 1024 * 1024,
    });
```

(Komentar panjang tentang cap 8 MB dari Task 2 dipertahankan di atas `maxResponseBytes`.)

- [x] **Step 6: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/safe-outbound-request.test.ts server/test/sync-page-budget.test.ts server/test/webhook-tap.test.ts
```

Diharapkan: PASS semua. `webhook-tap.test.ts` ikut karena webhook keluar berbagi `safeRequest` — ia membuktikan pemanggil non-opt-in tak berubah. Bila berkas itu gagal ramai dan mesin sedang sibuk, jalankan ulang sendirian sebelum menyimpulkan regresi (memori: webhook-tap gagal palsu saat mesin sibuk).

- [x] **Step 7: Typecheck**

```bash
pnpm --filter ./server typecheck
```

Diharapkan: keluar 0.

- [x] **Step 8: Commit**

```bash
git add server/src/services/safe-outbound-request.ts server/src/services/sync-client.ts server/test/safe-outbound-request.test.ts
git commit -m "perf(spec-885): gunzip opt-in di safeRequest, dengan cap kedua atas byte terurai

maxResponseBytes menghitung byte KABEL, dan itu berhenti cukup begitu
dekompresi menyala: 40 MB nol mampat jadi ~40 KB dan lolos cap kabel mana
pun. maxDecodedBytes yang menjaganya.

Opt-in per panggilan: modul ini juga melayani webhook keluar (ADR-0100) di
balik penjaga SSRF, dan tak satu pun pemanggil itu meminta dekompresi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: ADR-0138 + docs + verifikasi end-to-end

**Files:**
- Create: `internal/docs/adr/0138-sync-bootstrap-halaman-byte-feed-berdenyut.md`
- Modify: `internal/docs/README.md` (tautkan ADR baru)
- Modify: `internal/docs/architecture/api-contract.md` (endpoint bootstrap, field `hasMore`/`next`, gzip)
- Modify: `internal/docs/architecture/data-model.md` (`Vps.lastPublishedAt` sebagai LOCAL-only)

- [x] **Step 1: Pastikan nomor ADR-nya masih bebas**

```bash
ls internal/docs/adr/ | tail -2
```

Plan ini memakai **0138**. Nomornya semula 0137 dan sudah harus digeser sekali karena SPEC-883 menerbitkan `0137-provisioning-vps-berbasis-katalog.md` ke `main` selagi spec ini ditulis — tabrakan nomor antar-sesi paralel adalah kejadian berulang di repo ini. Bila `0138` sudah terpakai saat task ini dikerjakan, ambil nomor bebas berikutnya dan **ganti semua rujukan `ADR-0138` di kode yang sudah ditulis Task 1–9** (`grep -rn "ADR-0138" server/src`).

- [x] **Step 2: Tulis ADR-nya**

Buat `internal/docs/adr/0138-sync-bootstrap-halaman-byte-feed-berdenyut.md` mengikuti bentuk ADR-0131 (Konteks dengan angka terukur → Keputusan bernomor → Konsekuensi → Alternatif yang ditolak). Isi wajib:

- **Konteks:** angka hub produksi 2026-08-22 dari §Global Constraints, dan dua kegagalan senyapnya. Sebutkan eksplisit bahwa akar kedua (urutan induk→anak) adalah **akibat susulan ADR-0131**, bukan regresi kode sync — retensi menghapus properti yang diam-diam diandalkan `syncOnce`.
- **Keputusan 1:** halaman `pull` dipotong per anggaran byte; kursor menunjuk baris yang benar-benar dikirim; minimal satu baris selalu dikirim.
- **Keputusan 2:** `syncOnce` menguras feed sampai habis; `deferred` hidup lintas halaman; pembuangan hanya sah setelah feed habis. **Tegaskan** bahwa kursor tetap tak pernah ditahan (livelock ADR-0082).
- **Keputusan 3:** bootstrap membaca tabel dalam urutan dependensi. **Wajib memuat** alasan kursor-sebelum-membaca beserta kenapa kebalikannya tidak aman, dan alasan tombstone tidak ikut.
- **Keputusan 4:** `runHealth` publish-on-change + denyut berjangka; `lastPublishedAt` LOCAL-only; `runAudit` tak disentuh dan kenapa.
- **Keputusan 5:** gzip di dua route, bukan plugin global; cap ganda; opt-in per panggilan.
- **Konsekuensi:** client baru selesai dalam ~3 request alih-alih mandek; client yang tertinggal >7 hari ikut sembuh; feed vps mengecil dan penghematannya akan **tumbuh** saat VPS lain kembali sehat.
- **Alternatif yang ditolak:** menahan kursor pada record yang gagal (livelock); tabel `SyncDeferred` durable (tak perlu setelah drain utuh); membuang `lastSeenAt` dari `FIELDS.vps`; `@fastify/compress`; batching apply dalam satu `$transaction`.

- [x] **Step 3: Tautkan di index**

Tambahkan satu baris di bagian `## adr` pada `internal/docs/README.md`, mengikuti format baris tetangganya.

- [x] **Step 4: Perbarui docs arsitektur**

Di `internal/docs/architecture/api-contract.md`, di bagian sync: dokumentasikan `GET /api/sync/bootstrap` (query `after`, balikan `{ cursor, records, hasMore, next }`, auth device-token), field `hasMore` baru pada `GET /api/sync/pull`, dan negosiasi gzip pada keduanya.

Di `internal/docs/architecture/data-model.md`, pada model `Vps`: catat `lastPublishedAt` sebagai kolom **LOCAL-only** yang sengaja di luar `FIELDS.vps`, sejajar `keyPath`.

- [x] **Step 5: Verifikasi index docs**

```bash
hanoman docs index --check
```

Diharapkan: laporan tanpa entri hilang. Perintah ini milik CLI produk (AGENTS.md §Eksekusi & Perintah) dan bersifat read-only. Bila `hanoman` global lebih tua dari checkout ini, pakai salinan repo: `pnpm --filter ./cli build && node cli/dist/index.js docs index --check`.

- [x] **Step 6: Verifikasi endpoint nyata di local**

Wajib menurut AGENTS.md karena task ini menyentuh endpoint — sekali di akhir, bukan tiap task.

```bash
# HANOMAN_HOME tersendiri: tanpa ini smoke menulis ke ~/.hanoman milik operator (SPEC-880).
export HANOMAN_HOME="$(mktemp -d)"
pnpm --filter ./server exec prisma migrate deploy --schema prisma/schema.prisma
pnpm dev &   # tunggu sampai "listening"
```

Terbitkan device token lewat UI Settings, lalu:

```bash
TOKEN="<device token>"
curl -s -H "authorization: Bearer $TOKEN" 'http://127.0.0.1:5173/api/sync/pull?since=0' | head -c 400
curl -s -H "authorization: Bearer $TOKEN" 'http://127.0.0.1:5173/api/sync/bootstrap' | head -c 400
curl -s -H "authorization: Bearer $TOKEN" -H 'accept-encoding: gzip' \
  -D - -o /dev/null 'http://127.0.0.1:5173/api/sync/bootstrap'
```

Diharapkan: dua yang pertama JSON ber-`cursor`/`records`/`hasMore`; yang ketiga memperlihatkan header `content-encoding: gzip` dan `vary: accept-encoding`.

- [x] **Step 7: Reproduksi end-to-end dengan data hub nyata**

Ini gerbang sebenarnya untuk spec ini. Ambil salinan DB hub **tanpa menyentuh produksi**:

```bash
ssh root@103.59.161.119 'sqlite3 /srv/hanoman-prod/hanoman.db ".backup /tmp/hub-salinan.db"'
scp root@103.59.161.119:/tmp/hub-salinan.db /tmp/hub-salinan.db
ssh root@103.59.161.119 'rm -f /tmp/hub-salinan.db'
```

`sqlite3 ".backup"`, **bukan `cp`** — hub berjalan di WAL dan commit terbaru bisa masih berada di berkas `-wal` (ADR-0131).

Jalankan salinan itu sebagai hub di `HANOMAN_HOME` tersendiri dan port cadangan, lalu arahkan client ber-`HANOMAN_HOME` **kosong** kepadanya (set `SYNC_SERVER_URL` + `SYNC_DEVICE_TOKEN` lewat Settings client). Periksa:

```bash
sqlite3 "file:<home-client>/hanoman.db?mode=ro" \
  "SELECT (SELECT COUNT(*) FROM Spec) spec, (SELECT COUNT(*) FROM Project) project,
          (SELECT cursor FROM SyncState) cursor;"
```

Diharapkan: `spec` mencapai jumlah di hub salinan (~724 pada snapshot 2026-08-22) dan `cursor` sampai di puncak feed. Sebelum spec ini, client yang sama berhenti di ~500 record total dengan kursor macet.

- [x] **Step 8: Commit**

```bash
git add internal/docs
git commit -m "docs(spec-885): ADR-0138 sync bootstrap, halaman byte, feed berdenyut

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Catatan rilis

Hub duluan, client menyusul (ADR-0135). Task 2 dirancang agar client baru terhadap hub lama pun sembuh, jadi jendela di antara dua rilis tidak meninggalkan kombinasi yang mandek.

Sesudah hub naik versi, feed vps berhenti tumbuh tetapi 2.469 baris lama tetap di sana sampai `pruneSyncFeed` menyapunya (tersusul + lewat 7 hari, ADR-0131). Tidak perlu tindakan manual; kalau ingin efeknya segera terlihat, jalankan sapuan retensi sekali.
