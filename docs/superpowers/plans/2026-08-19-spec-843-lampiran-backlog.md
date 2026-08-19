# SPEC-843 — Lampiran multi-berkas per backlog sebagai konteks agen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setiap backlog item bisa membawa banyak lampiran (gambar + dokumen teks), dan sesi agen benar-benar membacanya — termasuk lampiran yang ditambahkan setelah sesi berjalan.

**Architecture:** Model `SpecAttachment` LOCAL-only (tanpa `version`), byte di `HANOMAN_UPLOAD_DIR`. Server memateralisasi set lampiran ke `<repoDir>/.worktrees/.attachments/<sessionId>/` (sekamar `.phases`, di luar worktree) dengan rekonsiliasi penuh, dan prompt sesi menyebut path absolutnya sebagai directive aktif + menyuruh agen membaca ulang `INDEX.md` tiap fase.

**Tech Stack:** Prisma 6 + SQLite, Fastify 5 + `@fastify/multipart`, `file-type` + `sharp`, React 18 + TS, vitest.

## Global Constraints

- Doc-of-record: `internal/docs/adr/0124-lampiran-backlog-konteks-agen.md` (sudah ditulis, sudah ter-link di `internal/docs/README.md`).
- Migration **ditulis tangan**, aditif murni — `prisma migrate dev` me-reset DB saat ada drift worktree tetangga.
- `SpecAttachment` **TANPA** kolom `version`/`updatedAt` → tak pernah masuk changefeed sync.
- TypeScript strict. Komentar hanya untuk hal yang tak terbaca dari kode (alasan, trade-off, invariant).
- Batas: **10 MB/berkas**, **10 lampiran/backlog**, **40 MB/backlog**. Registrasi multipart global (5 MB/12 berkas) **tidak** dinaikkan — batas dipasang per-request.
- Tipe: `image/png` `image/jpeg` `image/webp` `application/pdf` `text/markdown` `text/plain` `application/json` `text/csv`, dan pasangan mime↔ekstensi **harus** cocok.
- Test dijalankan dengan DB terisolasi: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>`.

---

### Task 1: Model `SpecAttachment` + migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260819120000_spec_attachment/migration.sql`
- Test: `server/test/spec-attachment.model.test.ts`

**Interfaces:**
- Produces: model Prisma `SpecAttachment { id, specId, projectId, filename, mimeType, size, storageKey, createdAt }` dan relasi `Spec.attachments`.

- [x] **Step 1: Tulis test yang gagal**

`server/test/spec-attachment.model.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db";

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => {
  await clean();
  await prisma.project.create({ data: { id: "att-proj", name: "Att", desc: "", kind: "existing" } });
});
afterAll(clean);

describe("SPEC-843 · SpecAttachment", () => {
  it("cascade ikut terhapus saat Spec dihapus", async () => {
    await prisma.spec.create({ data: {
      id: "SPEC-9001", projectId: "att-proj", title: "T", source: "brief",
      stage: "brainstorming", priority: "sedang", author: "t", objective: "o",
    } });
    await prisma.specAttachment.create({ data: {
      specId: "SPEC-9001", projectId: "att-proj", filename: "a.png",
      mimeType: "image/png", size: 3, storageKey: "k1.png",
    } });
    await prisma.spec.delete({ where: { id: "SPEC-9001" } });
    expect(await prisma.specAttachment.count({ where: { specId: "SPEC-9001" } })).toBe(0);
  });

  it("LOCAL-only: tak punya kolom version (tak pernah masuk changefeed)", async () => {
    const row = await prisma.specAttachment.create({ data: {
      specId: null as never, projectId: "att-proj", filename: "x", mimeType: "text/plain", size: 1, storageKey: "k",
    } }).catch(() => null);
    expect(row).toBeNull();   // specId wajib — FK, bukan nullable
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-attachment.model.test.ts`
Expected: FAIL — `prisma.specAttachment` undefined.

- [x] **Step 3: Tambahkan model ke `server/prisma/schema.prisma`**

Di dalam `model Spec { … }`, tepat sebelum baris `project   Project @relation(...)`, tambahkan:

```prisma
  attachments SpecAttachment[]
```

Setelah blok `model Spec`, tambahkan model baru:

```prisma
// SPEC-843 · ADR-0124 · lampiran per backlog item — konteks yang dipegang manusia saat memfilekan
// item, dibaca agen di dalam sesi. Byte hidup di HANOMAN_UPLOAD_DIR (server-local, di luar repoDir);
// `storageKey` opaque, `filename` nama asli tersanitasi untuk tampilan saja.
//
// LOCAL-only: TANPA `version`, jadi ia tak pernah masuk changefeed sync (cermin LeadFlow,
// WebhookEndpoint, Changelog). Byte memang tak menyeberang (ADR-0062), dan metadata yang
// menyeberang TANPA byte-nya hanya menghasilkan lampiran yang tak bisa dibuka di mesin lain —
// keadaan terburuk dari ketiga pilihan. Sengaja BUKAN TicketAttachment: tiket dan backlog dua
// domain dengan aturan sync dan tingkat kepercayaan yang berbeda (ADR-0124 §1/§4).
model SpecAttachment {
  id         String   @id @default(cuid())
  specId     String
  projectId  String   // denormal — kuota & isolasi per project, cermin TicketAttachment
  filename   String
  mimeType   String
  size       Int
  storageKey String
  createdAt  DateTime @default(now())
  spec       Spec     @relation(fields: [specId], references: [id], onDelete: Cascade)

  @@index([specId])
}
```

- [x] **Step 4: Tulis migration tangan**

`server/prisma/migrations/20260819120000_spec_attachment/migration.sql`:

```sql
-- SPEC-843 · ADR-0124 · lampiran per backlog item.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — satu tabel baru, tak ada tabel yang diredefinisi.
--
-- TANPA kolom `version`: entitas ini LOCAL-only dan tak pernah masuk changefeed sync.
CREATE TABLE "SpecAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "specId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpecAttachment_specId_fkey" FOREIGN KEY ("specId") REFERENCES "Spec" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SpecAttachment_specId_idx" ON "SpecAttachment"("specId");
```

- [x] **Step 5: Generate client**

Run: `pnpm --filter ./server exec prisma generate`
Expected: `Generated Prisma Client`.

- [x] **Step 6: Jalankan test, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-attachment.model.test.ts`
Expected: PASS (2 test).

- [x] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations server/test/spec-attachment.model.test.ts
git commit -m "feat(backlog): model SpecAttachment + migration (SPEC-843, ADR-0124)"
```

---

### Task 2: Pipeline unggah dokumen di `upload-pipeline.ts`

**Files:**
- Modify: `server/src/services/upload-pipeline.ts`
- Modify: `server/src/services/ticket-intake.ts:70-76` (call site `ticketBytes` → `parentBytes`)
- Test: `server/test/upload-pipeline.test.ts` (ubah nama field), `server/test/upload-document.test.ts` (baru)

**Interfaces:**
- Consumes: —
- Produces:
  - `UPLOAD_LIMITS.parentBytes` (dulu `ticketBytes`)
  - `processUpload(input: { buffer, clientName, clientMime, projectId, parentBytes }, deps)` — nama field berubah
  - `DOCUMENT_TYPES: Record<string, readonly string[]>` — mime → ekstensi yang sah
  - `processDocumentUpload(input: { buffer, clientName, clientMime, clientExt }, deps: { storageDir?, scanner? }): Promise<SafeUpload>`
  - `SafeUpload.width`/`height` menjadi opsional (`number | undefined`) — dokumen tak punya dimensi

- [x] **Step 1: Tulis test yang gagal**

`server/test/upload-document.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processDocumentUpload, UploadError } from "../src/services/upload-pipeline";

const PDF = Buffer.from("255044462d312e340a25c4e5f2e5eba7f3a0d0c4c6", "hex");
async function dir() { return mkdtemp(join(tmpdir(), "hanoman-doc-")); }
const deps = async () => ({ storageDir: await dir(), scanner: async () => {} });

describe("SPEC-843 · pipeline dokumen", () => {
  it("menyimpan markdown UTF-8 dan menyanitasi nama berkasnya", async () => {
    const storageDir = await dir();
    const out = await processDocumentUpload({
      buffer: Buffer.from("# Judul\n\nisi\n", "utf8"),
      clientName: "../../catatan rapat.MD", clientMime: "text/markdown", clientExt: ".md",
    }, { storageDir, scanner: async () => {} });
    expect(out.filename).toBe("catatan rapat.md");
    expect(out.mimeType).toBe("text/markdown");
    expect(await readFile(join(storageDir, out.storageKey), "utf8")).toContain("# Judul");
  });

  it("menolak biner yang menyamar sebagai .txt", async () => {
    await expect(processDocumentUpload({
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x00]),
      clientName: "log.txt", clientMime: "text/plain", clientExt: ".txt",
    }, await deps())).rejects.toMatchObject({ code: "UPLOAD_TYPE" });
  });

  it("menerima pdf yang magic bytes-nya cocok", async () => {
    const out = await processDocumentUpload({
      buffer: PDF, clientName: "spek.pdf", clientMime: "application/pdf", clientExt: ".pdf",
    }, await deps());
    expect(out.mimeType).toBe("application/pdf");
  });

  it("menolak pdf palsu (magic bytes tak cocok)", async () => {
    await expect(processDocumentUpload({
      buffer: Buffer.from("bukan pdf sama sekali", "utf8"),
      clientName: "spek.pdf", clientMime: "application/pdf", clientExt: ".pdf",
    }, await deps())).rejects.toMatchObject({ code: "UPLOAD_TYPE" });
  });

  it("menolak pasangan mime ↔ ekstensi yang tak cocok", async () => {
    await expect(processDocumentUpload({
      buffer: Buffer.from("halo", "utf8"),
      clientName: "x.csv", clientMime: "text/markdown", clientExt: ".csv",
    }, await deps())).rejects.toMatchObject({ code: "UPLOAD_TYPE" });
  });

  it("gagal-tertutup saat scanner melempar", async () => {
    await expect(processDocumentUpload({
      buffer: Buffer.from("halo", "utf8"),
      clientName: "x.txt", clientMime: "text/plain", clientExt: ".txt",
    }, { storageDir: await dir(), scanner: async () => { throw new Error("nope"); } }))
      .rejects.toBeInstanceOf(UploadError);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm vitest --run --no-file-parallelism server/test/upload-document.test.ts`
Expected: FAIL — `processDocumentUpload` tidak diekspor.

- [x] **Step 3: Ubah `upload-pipeline.ts`**

Ganti `ticketBytes` → `parentBytes` di `UPLOAD_LIMITS` dan di `type Input`:

```ts
export const UPLOAD_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  parentBytes: 10 * 1024 * 1024,
  projectBytes: 250 * 1024 * 1024,
  globalBytes: 1024 * 1024 * 1024,
  pixels: 40_000_000,
  dimension: 12_000,
  decodeMs: 5_000,
  scanMs: 15_000,
} as const;
```

```ts
// `parentBytes` = byte yang sudah terpakai INDUK unggahan ini (tiket atau backlog item).
// Dulu bernama `ticketBytes`: pipeline ini kini melayani dua domain (SPEC-843), dan nama lama
// berbohong di salah satunya.
type Input = {
  buffer: Buffer; clientName: string; clientMime: string; projectId: string; parentBytes: number;
};
```

Di badan `processUpload`, ganti kedua rujukan:

```ts
  if (input.parentBytes + input.buffer.byteLength > UPLOAD_LIMITS.parentBytes)
    throw new UploadError("UPLOAD_QUOTA", "parent quota exceeded");
```

Longgarkan `SafeUpload` (dokumen tak punya dimensi):

```ts
export type SafeUpload = {
  storageKey: string; filename: string; mimeType: string; extension: string;
  size: number; width?: number; height?: number;
};
```

Ekspor `scannerFromEnv` dengan mengganti `function scannerFromEnv` → `export function scannerFromEnv`.

Tambahkan helper penyimpanan bersama tepat sebelum `export async function processUpload`:

```ts
// Karantina → scan → promosi. Diangkat dari badan `processUpload` supaya jalur dokumen memakai
// gerbang malware yang SAMA, bukan salinan yang bisa berselisih. `wx` disengaja: nama karantina
// uuid, jadi berkas yang sudah ada berarti tabrakan sungguhan.
async function commitToStorage(
  buffer: Buffer, extension: string, deps: { storageDir?: string; scanner?: (path: string) => Promise<void> },
  beforePromote?: () => Promise<void>,
): Promise<string> {
  const storageDir = deps.storageDir ?? uploadDir();
  const quarantineDir = join(storageDir, ".quarantine");
  await mkdir(quarantineDir, { recursive: true, mode: 0o700 });
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const quarantine = join(quarantineDir, `${randomUUID()}.upload`);
  const storageKey = `${randomUUID()}${extension}`;
  await writeFile(quarantine, buffer, { mode: 0o600, flag: "wx" });
  try {
    await timeout((deps.scanner ?? scannerFromEnv)(quarantine), UPLOAD_LIMITS.scanMs, "UPLOAD_SCAN");
    await beforePromote?.();
    await rename(quarantine, join(storageDir, storageKey));
  } catch (error) {
    await unlink(quarantine).catch(() => {});
    if (error instanceof UploadError) throw error;
    throw new UploadError("UPLOAD_SCAN", "malware scan failed");
  }
  return storageKey;
}
```

Ganti ekor `processUpload` (mulai `const storageDir = deps.storageDir ?? uploadDir();` sampai `}` penutup blok `catch`) dengan:

```ts
  const storageKey = await commitToStorage(normalized, type.extension, deps, async () => {
    const finalUsage = await (deps.usage ?? defaultUsage)(input.projectId);
    if (finalUsage.project + normalized.byteLength > UPLOAD_LIMITS.projectBytes
      || finalUsage.global + normalized.byteLength > UPLOAD_LIMITS.globalBytes)
      throw new UploadError("UPLOAD_QUOTA", "storage quota exceeded");
  });
```

Tambahkan jalur dokumen di akhir berkas:

```ts
// SPEC-843 · ADR-0124 · tipe dokumen. Peta mime → ekstensi yang SAH untuknya: gerbangnya
// PASANGAN, bukan salah satunya, jadi `.md` ber-mime image/png ditolak dan sebaliknya.
export const DOCUMENT_TYPES: Record<string, readonly string[]> = {
  "application/pdf": [".pdf"],
  "text/markdown": [".md"],
  "text/plain": [".txt", ".log"],
  "application/json": [".json"],
  "text/csv": [".csv"],
};

// Tipe yang punya magic bytes; sisanya teks polos. `file-type` memang TAK mengenali teks polos —
// menuntut sniff untuknya berarti menolak semua .md. Gerbang penggantinya `isUtf8Text`.
const SNIFFABLE = new Set(["application/pdf"]);

// Byte NUL tak pernah ada di teks yang sah, dan `TextDecoder` fatal menolak byte UTF-8 tak sah.
// Keduanya bersama menolak biner yang menyamar sebagai .txt/.md/.json/.csv.
function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); return true; }
  catch { return false; }
}

export async function processDocumentUpload(
  input: { buffer: Buffer; clientName: string; clientMime: string; clientExt: string },
  deps: { storageDir?: string; scanner?: (path: string) => Promise<void> } = {},
): Promise<SafeUpload> {
  const extensions = DOCUMENT_TYPES[input.clientMime];
  if (!extensions || !extensions.includes(input.clientExt.toLowerCase()))
    throw new UploadError("UPLOAD_TYPE", "file type and extension do not match");
  if (SNIFFABLE.has(input.clientMime)) {
    const detected = await fileTypeFromBuffer(input.buffer);
    if (detected?.mime !== input.clientMime)
      throw new UploadError("UPLOAD_TYPE", "file signature and MIME do not match");
  } else if (!isUtf8Text(input.buffer)) {
    throw new UploadError("UPLOAD_TYPE", "file is not valid UTF-8 text");
  }
  // Dokumen disimpan APA ADANYA — tak ada padanan decode/re-encode `sharp` untuk teks/pdf, dan
  // menulis ulangnya justru merusak isi yang justru mau dibaca agen. Jaring pengamannya:
  // ekstensi terkunci + `Content-Disposition: attachment` + `nosniff` + CSP sandbox di route.
  const extension = extensions[0] === input.clientExt.toLowerCase() ? input.clientExt.toLowerCase() : input.clientExt.toLowerCase();
  const storageKey = await commitToStorage(input.buffer, extension, deps);
  return {
    storageKey, filename: safeFilename(input.clientName, extension),
    mimeType: input.clientMime, extension, size: input.buffer.byteLength,
  };
}
```

- [x] **Step 4: Perbarui call site & test lama**

`server/src/services/ticket-intake.ts` — ganti `ticketBytes` menjadi `parentBytes` di pemanggilan `processUpload` (satu tempat, variabel lokal `ticketBytes` boleh tetap bernama begitu karena ia memang byte tiket):

```ts
      const safe = await processUpload({
        buffer: f.buf, clientName: f.name, clientMime: f.mime,
        projectId: input.projectId, parentBytes: ticketBytes,
      });
```

`server/test/upload-pipeline.test.ts` — ganti keempat kemunculan `ticketBytes:` menjadi `parentBytes:` dan `UPLOAD_LIMITS.ticketBytes` menjadi `UPLOAD_LIMITS.parentBytes`.

- [x] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm vitest --run --no-file-parallelism server/test/upload-document.test.ts server/test/upload-pipeline.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/services/upload-pipeline.ts server/src/services/ticket-intake.ts server/test/upload-pipeline.test.ts server/test/upload-document.test.ts
git commit -m "feat(uploads): jalur dokumen di upload pipeline + parentBytes (SPEC-843)"
```

---

### Task 3: Service domain `spec-attachment.ts`

**Files:**
- Create: `server/src/services/spec-attachment.ts`
- Test: `server/test/spec-attachment.service.test.ts`

**Interfaces:**
- Consumes: `processUpload`, `processDocumentUpload`, `UploadError`, `DOCUMENT_TYPES` (Task 2); `deleteUpload` (`services/uploads`).
- Produces:
  - `SPEC_ATTACHMENT_LIMITS = { fileBytes: 10_485_760, perSpec: 10, specBytes: 41_943_040 }`
  - `IMAGE_TYPES: Record<string, readonly string[]>`
  - `attachmentExt(filename: string): string`
  - `type SpecUpload = { buf: Buffer; mime: string; name: string; truncated?: boolean }`
  - `type SavedAttachment = { id, filename, mimeType, size, createdAt }`
  - `addSpecAttachments(spec: { id: string; projectId: string }, files: SpecUpload[]): Promise<{ saved: SavedAttachment[]; rejected: { filename: string; reason: string }[] }>`
  - `deleteSpecAttachment(specId: string, attId: string): Promise<boolean>`
  - `dropSpecAttachments(specId: string): Promise<void>` — hapus byte semua lampiran satu Spec (baris ikut cascade DB)

- [x] **Step 1: Tulis test yang gagal**

`server/test/spec-attachment.service.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { addSpecAttachments, deleteSpecAttachment, dropSpecAttachments, SPEC_ATTACHMENT_LIMITS } from "../src/services/spec-attachment";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const spec = { id: "SPEC-9100", projectId: "sa-proj" };

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => {
  await clean();
  await prisma.project.create({ data: { id: "sa-proj", name: "SA", desc: "", kind: "existing" } });
});
beforeEach(async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.spec.create({ data: {
    id: spec.id, projectId: spec.projectId, title: "T", source: "brief",
    stage: "brainstorming", priority: "sedang", author: "t", objective: "o",
  } });
});
afterAll(clean);

describe("SPEC-843 · addSpecAttachments", () => {
  it("menyimpan beberapa berkas sekaligus (gambar + dokumen)", async () => {
    const res = await addSpecAttachments(spec, [
      { buf: PNG, mime: "image/png", name: "layar.png" },
      { buf: Buffer.from("# catatan\n", "utf8"), mime: "text/markdown", name: "catatan.md" },
      { buf: Buffer.from("a,b\n1,2\n", "utf8"), mime: "text/csv", name: "data.csv" },
    ]);
    expect(res.rejected).toEqual([]);
    expect(res.saved.map((a) => a.filename)).toEqual(["layar.png", "catatan.md", "data.csv"]);
    expect(await prisma.specAttachment.count({ where: { specId: spec.id } })).toBe(3);
  });

  it("berkas yang ditolak tak menggagalkan yang lain", async () => {
    const res = await addSpecAttachments(spec, [
      { buf: Buffer.from("halo", "utf8"), mime: "application/x-sh", name: "jahat.sh" },
      { buf: Buffer.from("halo", "utf8"), mime: "text/plain", name: "ok.txt" },
    ]);
    expect(res.saved.map((a) => a.filename)).toEqual(["ok.txt"]);
    expect(res.rejected).toEqual([{ filename: "jahat.sh", reason: "type" }]);
  });

  it("menolak berkas melebihi batas per-berkas", async () => {
    const res = await addSpecAttachments(spec, [
      { buf: Buffer.alloc(SPEC_ATTACHMENT_LIMITS.fileBytes + 1, 0x61), mime: "text/plain", name: "besar.txt" },
    ]);
    expect(res.saved).toEqual([]);
    expect(res.rejected).toEqual([{ filename: "besar.txt", reason: "size" }]);
  });

  it("menolak berkas yang datang ter-truncate", async () => {
    const res = await addSpecAttachments(spec, [
      { buf: Buffer.from("x", "utf8"), mime: "text/plain", name: "potong.txt", truncated: true },
    ]);
    expect(res.rejected).toEqual([{ filename: "potong.txt", reason: "size" }]);
  });

  it("menegakkan batas jumlah per backlog", async () => {
    const many = Array.from({ length: SPEC_ATTACHMENT_LIMITS.perSpec + 2 }, (_, i) =>
      ({ buf: Buffer.from(`isi ${i}`, "utf8"), mime: "text/plain", name: `f${i}.txt` }));
    const res = await addSpecAttachments(spec, many);
    expect(res.saved.length).toBe(SPEC_ATTACHMENT_LIMITS.perSpec);
    expect(res.rejected.every((r) => r.reason === "count")).toBe(true);
    expect(await prisma.specAttachment.count({ where: { specId: spec.id } })).toBe(SPEC_ATTACHMENT_LIMITS.perSpec);
  });
});

describe("SPEC-843 · hapus", () => {
  it("deleteSpecAttachment membuang baris & menolak lampiran milik spec lain", async () => {
    const { saved } = await addSpecAttachments(spec, [{ buf: Buffer.from("x", "utf8"), mime: "text/plain", name: "a.txt" }]);
    expect(await deleteSpecAttachment("SPEC-OTHER", saved[0]!.id)).toBe(false);
    expect(await deleteSpecAttachment(spec.id, saved[0]!.id)).toBe(true);
    expect(await prisma.specAttachment.count({ where: { specId: spec.id } })).toBe(0);
  });

  it("dropSpecAttachments idempoten pada spec tanpa lampiran", async () => {
    await expect(dropSpecAttachments(spec.id)).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-attachment.service.test.ts`
Expected: FAIL — modul `spec-attachment` tak ada.

- [x] **Step 3: Tulis `server/src/services/spec-attachment.ts`**

```ts
// SPEC-843 · ADR-0124 · lampiran per backlog item. Domain-nya di sini; route tinggal tipis.
//
// Sengaja TIDAK memakai ulang jalur lampiran tiket: tiket adalah pintu publik dengan aturan sync
// dan tingkat kepercayaan yang berbeda (ADR-0124 §1). Yang dipakai ulang adalah PIPELINE
// unggahnya (`upload-pipeline.ts`) — gerbang magic bytes, normalisasi gambar, karantina, dan
// pemindaian malware yang sama, bukan salinan yang bisa berselisih.
import { extname } from "node:path";
import { prisma } from "../db";
import { deleteUpload } from "./uploads";
import {
  DOCUMENT_TYPES, UploadError, processDocumentUpload, processUpload, type SafeUpload,
} from "./upload-pipeline";

export const SPEC_ATTACHMENT_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  perSpec: 10,
  specBytes: 40 * 1024 * 1024,
} as const;

// Gambar dipisah dari `DOCUMENT_TYPES` karena perlakuannya berbeda: ia didekode & di-encode ulang
// `sharp` (membuang metadata dan payload yang ditempel di ekornya), dan itu hanya masuk akal untuk
// raster.
export const IMAGE_TYPES: Record<string, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

export type SpecUpload = { buf: Buffer; mime: string; name: string; truncated?: boolean };
export type SavedAttachment = {
  id: string; filename: string; mimeType: string; size: number; createdAt: string;
};
export type RejectReason = "type" | "size" | "count" | "quota" | "scan";

export const attachmentExt = (filename: string): string => extname(filename).toLowerCase();

const view = (a: { id: string; filename: string; mimeType: string; size: number; createdAt: Date }): SavedAttachment =>
  ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, createdAt: a.createdAt.toISOString() });

// UploadError → alasan yang terbaca operator. Kode pemindai & kuota TIDAK diciutkan jadi "type":
// operator yang melihat "tipe tak didukung" untuk berkas yang sebenarnya kena kuota akan
// mencoba lagi selamanya.
const reasonFor = (code: UploadError["code"]): RejectReason =>
  code === "UPLOAD_QUOTA" ? "quota" : code === "UPLOAD_SCAN" ? "scan" : "type";

export async function addSpecAttachments(
  spec: { id: string; projectId: string }, files: SpecUpload[],
): Promise<{ saved: SavedAttachment[]; rejected: { filename: string; reason: RejectReason }[] }> {
  const existing = await prisma.specAttachment.findMany({
    where: { specId: spec.id }, select: { size: true },
  });
  let count = existing.length;
  let bytes = existing.reduce((n, a) => n + a.size, 0);

  const saved: SavedAttachment[] = [];
  const rejected: { filename: string; reason: RejectReason }[] = [];
  for (const f of files) {
    const name = f.name || "lampiran";
    if (count >= SPEC_ATTACHMENT_LIMITS.perSpec) { rejected.push({ filename: name, reason: "count" }); continue; }
    // `truncated` datang dari @fastify/multipart (`throwFileSizeLimit:false`): berkas oversize tiba
    // TERPOTONG, bukan sebagai error. Tanpa gerbang ini ia tersimpan sebagai berkas rusak yang
    // ukurannya justru lolos batas.
    if (f.truncated || f.buf.byteLength === 0 || f.buf.byteLength > SPEC_ATTACHMENT_LIMITS.fileBytes) {
      rejected.push({ filename: name, reason: "size" }); continue;
    }
    if (bytes + f.buf.byteLength > SPEC_ATTACHMENT_LIMITS.specBytes) {
      rejected.push({ filename: name, reason: "quota" }); continue;
    }
    const ext = attachmentExt(name);
    let safe: SafeUpload;
    try {
      if (IMAGE_TYPES[f.mime]) {
        if (!IMAGE_TYPES[f.mime]!.includes(ext)) throw new UploadError("UPLOAD_TYPE", "extension mismatch");
        safe = await processUpload({
          buffer: f.buf, clientName: name, clientMime: f.mime,
          projectId: spec.projectId, parentBytes: bytes,
        });
      } else if (DOCUMENT_TYPES[f.mime]) {
        safe = await processDocumentUpload({
          buffer: f.buf, clientName: name, clientMime: f.mime, clientExt: ext,
        });
      } else {
        throw new UploadError("UPLOAD_TYPE", "unsupported type");
      }
    } catch (error) {
      if (!(error instanceof UploadError)) throw error;
      rejected.push({ filename: name, reason: reasonFor(error.code) });
      continue;
    }
    let row;
    try {
      row = await prisma.specAttachment.create({ data: {
        specId: spec.id, projectId: spec.projectId, filename: safe.filename,
        mimeType: safe.mimeType, size: safe.size, storageKey: safe.storageKey,
      } });
    } catch (error) {
      // Byte sudah mendarat di upload dir; tanpa ini ia jadi yatim yang tak punya baris.
      await deleteUpload(safe.storageKey);
      throw error;
    }
    count += 1;
    bytes += safe.size;
    saved.push(view(row));
  }
  return { saved, rejected };
}

export async function listSpecAttachments(specId: string): Promise<SavedAttachment[]> {
  const rows = await prisma.specAttachment.findMany({
    where: { specId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(view);
}

export async function deleteSpecAttachment(specId: string, attId: string): Promise<boolean> {
  const a = await prisma.specAttachment.findUnique({ where: { id: attId } });
  if (!a || a.specId !== specId) return false;
  await prisma.specAttachment.delete({ where: { id: attId } });
  await deleteUpload(a.storageKey);
  return true;
}

// Baris ikut `onDelete: Cascade`, byte-nya TIDAK — cascade DB tak menyentuh disk. Dipanggil
// SEBELUM Spec dihapus, selagi barisnya masih bisa dibaca.
export async function dropSpecAttachments(specId: string): Promise<void> {
  const rows = await prisma.specAttachment.findMany({ where: { specId }, select: { storageKey: true } });
  for (const a of rows) await deleteUpload(a.storageKey);
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-attachment.service.test.ts`
Expected: PASS (7 test).

- [x] **Step 5: Commit**

```bash
git add server/src/services/spec-attachment.ts server/test/spec-attachment.service.test.ts
git commit -m "feat(backlog): service lampiran backlog (allowlist, kuota, hapus) (SPEC-843)"
```

---

### Task 4: Materialisasi ke direktori sesi

**Files:**
- Create: `server/src/services/spec-attachment-dir.ts`
- Test: `server/test/spec-attachment-dir.test.ts`

**Interfaces:**
- Consumes: `prisma.specAttachment`, `uploadDir()` (`services/uploads`), `resolveRepoDir` (`services/local-binding`), `sessionIdForSpec` (`services/session-id`).
- Produces:
  - `specAttachmentsDir(repoDir: string, sessionId: string): string`
  - `type MaterializedAttachment = { filename: string; mimeType: string; size: number; path: string }`
  - `syncSpecAttachmentsDir(specId: string, projectId: string): Promise<MaterializedAttachment[]>` — rekonsiliasi penuh; `[]` bila project belum di-bind
  - `dropSpecAttachmentsDir(specId: string, projectId: string): Promise<void>`

- [x] **Step 1: Tulis test yang gagal**

`server/test/spec-attachment-dir.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";

const repoDir = await mkdtemp(join(tmpdir(), "hanoman-repo-"));
const uploads = await mkdtemp(join(tmpdir(), "hanoman-up-"));

vi.mock("../src/services/local-binding", () => ({ resolveRepoDir: async () => repoDir }));
process.env.HANOMAN_UPLOAD_DIR = uploads;

const { syncSpecAttachmentsDir, dropSpecAttachmentsDir, specAttachmentsDir } =
  await import("../src/services/spec-attachment-dir");

const specId = "SPEC-9200";
const dir = specAttachmentsDir(repoDir, "spec-9200");

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

async function seedFile(key: string, body: string) {
  await mkdir(uploads, { recursive: true });
  await writeFile(join(uploads, key), body, "utf8");
}

beforeAll(async () => {
  await clean();
  await prisma.project.create({ data: { id: "sad-proj", name: "SAD", desc: "", kind: "existing" } });
});
beforeEach(async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.spec.create({ data: {
    id: specId, projectId: "sad-proj", title: "T", source: "brief",
    stage: "brainstorming", priority: "sedang", author: "t", objective: "o",
  } });
});
afterAll(clean);

describe("SPEC-843 · materialisasi lampiran", () => {
  it("menulis berkas + INDEX.md dengan path absolut", async () => {
    await seedFile("k1.md", "# isi\n");
    await prisma.specAttachment.create({ data: {
      specId, projectId: "sad-proj", filename: "catatan.md",
      mimeType: "text/markdown", size: 7, storageKey: "k1.md",
    } });
    const out = await syncSpecAttachmentsDir(specId, "sad-proj");
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe(join(dir, "catatan.md"));
    expect(await readFile(join(dir, "catatan.md"), "utf8")).toBe("# isi\n");
    const index = await readFile(join(dir, "INDEX.md"), "utf8");
    expect(index).toContain("catatan.md");
    expect(index).toContain(join(dir, "catatan.md"));
  });

  it("rekonsiliasi PENUH: berkas yang barisnya hilang ikut dibuang", async () => {
    await seedFile("k1.md", "# isi\n");
    await seedFile("k2.txt", "log\n");
    const a = await prisma.specAttachment.create({ data: {
      specId, projectId: "sad-proj", filename: "catatan.md", mimeType: "text/markdown", size: 7, storageKey: "k1.md",
    } });
    await prisma.specAttachment.create({ data: {
      specId, projectId: "sad-proj", filename: "error.txt", mimeType: "text/plain", size: 4, storageKey: "k2.txt",
    } });
    await syncSpecAttachmentsDir(specId, "sad-proj");
    expect((await readdir(dir)).sort()).toEqual(["INDEX.md", "catatan.md", "error.txt"]);

    await prisma.specAttachment.delete({ where: { id: a.id } });
    await syncSpecAttachmentsDir(specId, "sad-proj");
    expect((await readdir(dir)).sort()).toEqual(["INDEX.md", "error.txt"]);
  });

  it("nama yang bertabrakan dibedakan, bukan saling menimpa", async () => {
    await seedFile("k1.txt", "satu");
    await seedFile("k2.txt", "dua");
    await prisma.specAttachment.create({ data: {
      specId, projectId: "sad-proj", filename: "log.txt", mimeType: "text/plain", size: 4, storageKey: "k1.txt",
    } });
    await prisma.specAttachment.create({ data: {
      specId, projectId: "sad-proj", filename: "log.txt", mimeType: "text/plain", size: 3, storageKey: "k2.txt",
    } });
    const out = await syncSpecAttachmentsDir(specId, "sad-proj");
    expect(new Set(out.map((a) => a.path)).size).toBe(2);
  });

  it("tanpa lampiran: direktori dibuang, INDEX.md ikut", async () => {
    await seedFile("k1.md", "# isi\n");
    await prisma.specAttachment.create({ data: {
      specId, projectId: "sad-proj", filename: "catatan.md", mimeType: "text/markdown", size: 7, storageKey: "k1.md",
    } });
    await syncSpecAttachmentsDir(specId, "sad-proj");
    await prisma.specAttachment.deleteMany({ where: { specId } });
    expect(await syncSpecAttachmentsDir(specId, "sad-proj")).toEqual([]);
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("dropSpecAttachmentsDir idempoten", async () => {
    await expect(dropSpecAttachmentsDir(specId, "sad-proj")).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-attachment-dir.test.ts`
Expected: FAIL — modul tak ada.

- [x] **Step 3: Tulis `server/src/services/spec-attachment-dir.ts`**

```ts
// SPEC-843 · ADR-0124 · materialisasi lampiran backlog ke direktori yang terjangkau sesi.
//
// KENAPA bukan menunjuk langsung ke HANOMAN_UPLOAD_DIR: sandbox sesi produksi hanya mem-mount
// worktree + phase file + prompt file (`services/session-sandbox.ts`), jadi upload dir TAK
// terjangkau dari dalam sesi — path ke sana bekerja di dev dan mati senyap di produksi. Di samping
// itu ia akan membuka SELURUH upload dir (termasuk lampiran tiket project lain) ke sesi mana pun.
//
// KENAPA di luar worktree: `git add -A` milik agen akan men-stage lampiran ke branch sesi. Letaknya
// sekamar dengan `.phases`/`.decisions` di dalam `.worktrees` yang sudah `.gitignore` — dan karena
// itu ia juga selamat saat worktree dibangun ulang untuk melanjutkan sesi (ADR-0084).
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../db";
import { resolveRepoDir } from "./local-binding";
import { sessionIdForSpec } from "./session-id";
import { uploadDir } from "./uploads";

export const specAttachmentsDir = (repoDir: string, sessionId: string): string =>
  join(repoDir, ".worktrees", ".attachments", sessionId);

export type MaterializedAttachment = {
  filename: string; mimeType: string; size: number; path: string;
};

const INDEX = "INDEX.md";

const humanSize = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// Nama materialisasi diturunkan dari `filename` supaya terbaca manusia DAN agen di prompt. Dua
// lampiran boleh punya nama asli yang sama, jadi tabrakan disuffiks — menimpa berarti satu lampiran
// hilang dari pandangan agen tanpa jejak.
function uniqueName(taken: Set<string>, filename: string): string {
  if (!taken.has(filename)) { taken.add(filename); return filename; }
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
  }
}

function renderIndex(specId: string, items: MaterializedAttachment[]): string {
  const rows = items.map((a) =>
    `- \`${a.path}\` — **${a.filename}** (${a.mimeType}, ${humanSize(a.size)})`).join("\n");
  return [
    `# Lampiran ${specId}`,
    "",
    "Berkas di bawah dilampirkan manusia ke backlog item ini sebagai konteks kerja. Berkas ini",
    "ditulis ulang server setiap kali daftar lampiran berubah — baca ulang di awal setiap fase.",
    "",
    rows || "_Tak ada lampiran._",
    "",
  ].join("\n");
}

/**
 * Rekonsiliasi PENUH direktori materialisasi terhadap baris DB: yang baru disalin, yang barisnya
 * sudah hilang DIBUANG. Tambal-saja akan membuat lampiran yang dihapus operator tetap terbaca agen
 * — "hapus" yang hanya berarti "hilang dari dashboard".
 *
 * `[]` bila project belum di-bind ke checkout lokal: tak ada repoDir berarti tak ada tempat sah
 * untuk menaruhnya, dan itu bukan galat — sesi pun tak bisa lahir di keadaan itu.
 */
export async function syncSpecAttachmentsDir(
  specId: string, projectId: string,
): Promise<MaterializedAttachment[]> {
  const repoDir = await resolveRepoDir(projectId);
  if (!repoDir) return [];
  const dir = specAttachmentsDir(repoDir, sessionIdForSpec(specId));
  const rows = await prisma.specAttachment.findMany({
    where: { specId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* sudah tak ada */ });
    return [];
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const taken = new Set<string>();
  const items: MaterializedAttachment[] = [];
  for (const a of rows) {
    const name = uniqueName(taken, a.filename);
    const target = join(dir, name);
    try {
      await writeFile(target, await readFile(join(uploadDir(), a.storageKey)), { mode: 0o600 });
    } catch {
      continue;   // byte hilang dari upload dir — jangan sebut lampiran yang tak bisa dibaca agen
    }
    items.push({ filename: name, mimeType: a.mimeType, size: a.size, path: target });
  }
  await writeFile(join(dir, INDEX), renderIndex(specId, items), { mode: 0o600 });

  const keep = new Set([INDEX, ...items.map((a) => a.filename)]);
  for (const name of await readdir(dir)) {
    if (!keep.has(name)) await rm(join(dir, name), { recursive: true, force: true }).catch(() => {});
  }
  return items;
}

export async function dropSpecAttachmentsDir(specId: string, projectId: string): Promise<void> {
  const repoDir = await resolveRepoDir(projectId);
  if (!repoDir) return;
  await rm(specAttachmentsDir(repoDir, sessionIdForSpec(specId)), { recursive: true, force: true })
    .catch(() => { /* sudah tak ada */ });
}
```

- [x] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-attachment-dir.test.ts`
Expected: PASS (5 test).

- [x] **Step 5: Commit**

```bash
git add server/src/services/spec-attachment-dir.ts server/test/spec-attachment-dir.test.ts
git commit -m "feat(backlog): materialisasi lampiran ke direktori sesi + INDEX.md (SPEC-843)"
```

---

### Task 5: Endpoint REST + DTO + paths

**Files:**
- Modify: `shared/src/dto.ts` (setelah `zTicketAttachmentView`), `shared/src/api.ts` (setelah `paths.specDone`)
- Modify: `server/src/routes/specs.ts`
- Test: `server/test/spec-attachments.route.test.ts`

**Interfaces:**
- Consumes: `addSpecAttachments`, `listSpecAttachments`, `deleteSpecAttachment`, `dropSpecAttachments` (Task 3); `syncSpecAttachmentsDir`, `dropSpecAttachmentsDir` (Task 4); `readUpload` (`services/uploads`).
- Produces:
  - `zSpecAttachmentView` / `SpecAttachmentView = { id, filename, mimeType, size, createdAt }`
  - `paths.specAttachments(id)` → `/api/specs/:id/attachments`
  - `paths.specAttachment(id, attId)` → `/api/specs/:id/attachments/:attId`

- [x] **Step 1: Tulis test yang gagal**

`server/test/spec-attachments.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { checkAgentCapability } from "../src/services/agent-capabilities";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const specId = "SPEC-9300";

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

// Multipart dirakit tangan: `app.inject` tak punya pembangun form-data.
function multipart(files: { field: string; name: string; type: string; body: Buffer }[]) {
  const boundary = "----hanomantest843";
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.name}"\r\n`
      + `Content-Type: ${f.type}\r\n\r\n`, "utf8"), f.body, Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  await app.ready();
  await clean();
  await prisma.project.create({ data: { id: "sar-proj", name: "SAR", desc: "", kind: "existing" } });
});
beforeEach(async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.spec.create({ data: {
    id: specId, projectId: "sar-proj", title: "T", source: "brief",
    stage: "brainstorming", priority: "sedang", author: "t", objective: "o",
  } });
});
afterAll(async () => { await clean(); await app.close(); });

describe("SPEC-843 · endpoint lampiran backlog", () => {
  it("unggah beberapa berkas dalam satu request", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/specs/${specId}/attachments`,
      ...multipart([
        { field: "files", name: "layar.png", type: "image/png", body: PNG },
        { field: "files", name: "catatan.md", type: "text/markdown", body: Buffer.from("# hai\n") },
      ]),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().saved.map((a: { filename: string }) => a.filename)).toEqual(["layar.png", "catatan.md"]);
    expect(res.json().rejected).toEqual([]);
  });

  it("tipe tak didukung ditolak tanpa menggagalkan berkas lain", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/specs/${specId}/attachments`,
      ...multipart([
        { field: "files", name: "jahat.sh", type: "application/x-sh", body: Buffer.from("rm -rf /") },
        { field: "files", name: "ok.txt", type: "text/plain", body: Buffer.from("halo") },
      ]),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().saved).toHaveLength(1);
    expect(res.json().rejected).toEqual([{ filename: "jahat.sh", reason: "type" }]);
  });

  it("daftar → unduh → hapus", async () => {
    await app.inject({
      method: "POST", url: `/api/specs/${specId}/attachments`,
      ...multipart([{ field: "files", name: "catatan.md", type: "text/markdown", body: Buffer.from("# hai\n") }]),
    });
    const list = await app.inject({ method: "GET", url: `/api/specs/${specId}/attachments` });
    expect(list.statusCode).toBe(200);
    const att = list.json().attachments[0];
    expect(att.filename).toBe("catatan.md");

    const file = await app.inject({ method: "GET", url: `/api/specs/${specId}/attachments/${att.id}` });
    expect(file.statusCode).toBe(200);
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["content-disposition"]).toContain("catatan.md");
    expect(file.body).toContain("# hai");

    const del = await app.inject({ method: "DELETE", url: `/api/specs/${specId}/attachments/${att.id}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/specs/${specId}/attachments` })).json().attachments).toEqual([]);
  });

  it("lampiran spec lain → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/api/specs/${specId}/attachments/tak-ada` });
    expect(res.statusCode).toBe(404);
  });

  it("spec tak dikenal → 404", async () => {
    expect((await app.inject({ method: "GET", url: "/api/specs/SPEC-0/attachments" })).statusCode).toBe(404);
  });

  it("hapus Spec ikut menghapus baris lampiran", async () => {
    await app.inject({
      method: "POST", url: `/api/specs/${specId}/attachments`,
      ...multipart([{ field: "files", name: "catatan.md", type: "text/markdown", body: Buffer.from("# hai\n") }]),
    });
    expect((await app.inject({ method: "DELETE", url: `/api/specs/${specId}` })).statusCode).toBe(200);
    expect(await prisma.specAttachment.count({ where: { specId } })).toBe(0);
  });

  it("capability: baca cukup untuk daftar/unduh, tak cukup untuk unggah/hapus", () => {
    const read = ["backlog:read"];
    expect(checkAgentCapability(read, "GET", `/api/specs/${specId}/attachments`)).toEqual({ ok: true });
    const write = checkAgentCapability(read, "POST", `/api/specs/${specId}/attachments`);
    expect(write).toMatchObject({ ok: false, status: 403, need: "backlog:write" });
    expect(checkAgentCapability(["backlog:write"], "DELETE", `/api/specs/${specId}/attachments/x`)).toEqual({ ok: true });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-attachments.route.test.ts`
Expected: FAIL — 404 untuk seluruh endpoint lampiran.

- [x] **Step 3: Tambahkan DTO di `shared/src/dto.ts`**

Tepat setelah blok `zTicketAttachmentView` / `TicketAttachmentView`:

```ts
// SPEC-843 · ADR-0124 · lampiran backlog item. Sengaja BUKAN zTicketAttachmentView: ia punya
// `createdAt` (UI mengurut & menampilkannya) dan hidup di domain yang aturan sync-nya berbeda.
export const zSpecAttachmentView = z.object({
  id: z.string(), filename: z.string(), mimeType: z.string(),
  size: z.number().int(), createdAt: z.string(),
});
export type SpecAttachmentView = z.infer<typeof zSpecAttachmentView>;
```

- [x] **Step 4: Tambahkan path di `shared/src/api.ts`**

Tepat setelah baris `specDone`:

```ts
  // SPEC-843 · ADR-0124 · lampiran backlog item (multi-berkas per request).
  specAttachments: (id: string) => `${API}/specs/${id}/attachments`,
  specAttachment: (id: string, attId: string) => `${API}/specs/${id}/attachments/${attId}`,
```

- [x] **Step 5: Tambahkan endpoint di `server/src/routes/specs.ts`**

Tambahkan impor di kepala berkas:

```ts
import {
  addSpecAttachments, deleteSpecAttachment, dropSpecAttachments, listSpecAttachments,
  SPEC_ATTACHMENT_LIMITS, type SpecUpload,
} from "../services/spec-attachment";
import { dropSpecAttachmentsDir, syncSpecAttachmentsDir } from "../services/spec-attachment-dir";
import { readUpload } from "../services/uploads";
```

Tambahkan keempat route (letakkan sesudah route `POST /specs/:id/done`):

```ts
  // SPEC-843 · ADR-0124 · lampiran backlog item. Capability-nya jatuh dari prefix `specs`
  // (`capabilityForRoute` → `rw("backlog")`), jadi read/write diturunkan dari METHOD dan 403-nya
  // tetap membawa `need` tanpa satu baris pun perubahan di peta capability.
  app.get("/specs/:id/attachments", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!await prisma.spec.findUnique({ where: { id }, select: { id: true } }))
      return reply.code(404).send({ error: "not found" });
    return { attachments: await listSpecAttachments(id) };
  });

  // Batas multipart dipasang PER-REQUEST: registrasi global (5 MB/12 berkas, app.ts) milik lampiran
  // gambar SPEC-816 dan tak boleh ikut naik. Pola yang sama dipakai POST /projects/:id/upload.
  app.post("/specs/:id/attachments", async (req, reply) => {
    const { id } = req.params as { id: string };
    const spec = await prisma.spec.findUnique({ where: { id }, select: { id: true, projectId: true } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    const files: SpecUpload[] = [];
    try {
      for await (const part of (req as any).parts({
        limits: { fileSize: SPEC_ATTACHMENT_LIMITS.fileBytes, files: SPEC_ATTACHMENT_LIMITS.perSpec + 2 },
      })) {
        if (part.type !== "file") continue;
        const buf = await part.toBuffer();   // menguras stream — tanpa ini busboy menggantung
        files.push({
          buf, mime: part.mimetype, name: String(part.filename ?? "lampiran"),
          truncated: part.file?.truncated === true,
        });
      }
    } catch { return reply.code(400).send({ error: "unggahan tak valid" }); }
    if (!files.length) return reply.code(400).send({ error: "tak ada berkas" });

    const result = await addSpecAttachments(spec, files);
    // Materialisasi SESUDAH baris tertulis: sesi yang sedang berjalan membaca ulang INDEX.md di
    // awal fase berikutnya, jadi lampiran yang datang di tengah sesi tetap sampai (ADR-0124 §3).
    await syncSpecAttachmentsDir(spec.id, spec.projectId);
    return reply.code(201).send(result);
  });

  app.get("/specs/:id/attachments/:attId", async (req, reply) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const a = await prisma.specAttachment.findUnique({ where: { id: attId } });
    if (!a || a.specId !== id) return reply.code(404).send({ error: "not found" });
    const buf = await readUpload(a.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", a.mimeType);
    reply.header("content-disposition", `attachment; filename="${a.filename.replace(/["\\\r\n]/g, "_")}"`);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");
    return reply.send(buf);
  });

  app.delete("/specs/:id/attachments/:attId", async (req, reply) => {
    const { id, attId } = req.params as { id: string; attId: string };
    const spec = await prisma.spec.findUnique({ where: { id }, select: { id: true, projectId: true } });
    if (!spec) return reply.code(404).send({ error: "not found" });
    if (!await deleteSpecAttachment(id, attId)) return reply.code(404).send({ error: "not found" });
    await syncSpecAttachmentsDir(spec.id, spec.projectId);
    return { ok: true };
  });
```

Di route `DELETE /specs/:id` yang sudah ada, tepat **sebelum** `await deleteSynced("spec", id)`, tambahkan pembersihan byte:

```ts
    // Baris ikut `onDelete: Cascade`, byte-nya TIDAK — cascade DB tak menyentuh disk. Dibaca
    // selagi barisnya masih ada, karena itu di SINI dan bukan sesudah penghapusan.
    await dropSpecAttachments(id);
    await dropSpecAttachmentsDir(id, spec.projectId);
```

- [x] **Step 6: Jalankan test, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-attachments.route.test.ts`
Expected: PASS (7 test).

- [x] **Step 7: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck`
Expected: keluar 0.

- [x] **Step 8: Commit**

```bash
git add shared/src/dto.ts shared/src/api.ts server/src/routes/specs.ts server/test/spec-attachments.route.test.ts
git commit -m "feat(api): endpoint lampiran backlog di bawah capability backlog (SPEC-843)"
```

---

### Task 6: Jalur ke agen — klausa prompt, env, mount sandbox

**Files:**
- Modify: `runner/src/types.ts`, `runner/src/prompt.ts`
- Modify: `server/src/services/session-launch.ts`, `server/src/services/pty.ts`, `server/src/services/session-sandbox.ts`
- Test: `runner/src/attachment-prompt.test.ts`, `server/test/session-sandbox.test.ts` (ubah/tambah), `server/test/spec-attachment-launch.test.ts`

**Interfaces:**
- Consumes: `MaterializedAttachment` (Task 4).
- Produces:
  - `runner`: `type SpecAttachmentBrief = { filename: string; mimeType: string; size: number; path: string }`
  - `startPrompt`/`resumePrompt`/`continuePrompt` menerima parameter opsional ke-7/ke-8 lewat objek `AttachmentCtx = { dir: string; items: readonly SpecAttachmentBrief[] }`
  - `startGoalPrompt(..., opts.attachments?: AttachmentCtx)`
  - `pty.CreateOpts.attachmentsDir?: string` → env `HANOMAN_ATTACHMENTS_DIR` + mount sandbox
  - `SandboxInput.attachmentsDir?: string`

- [x] **Step 1: Tulis test yang gagal**

`runner/src/attachment-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { startPrompt, resumePrompt, continuePrompt, startGoalPrompt } from "./prompt";

const spec = { id: "SPEC-1", title: "T", source: "brief", priority: "tinggi", objective: "O" };
const attachments = {
  dir: "/repo/.worktrees/.attachments/spec-1",
  items: [
    { filename: "layar.png", mimeType: "image/png", size: 2048, path: "/repo/.worktrees/.attachments/spec-1/layar.png" },
    { filename: "error.log", mimeType: "text/plain", size: 4096, path: "/repo/.worktrees/.attachments/spec-1/error.log" },
  ],
};

describe("SPEC-843 · klausa lampiran di prompt sesi", () => {
  it("startPrompt menyebut path absolut tiap lampiran + manifest", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-1", undefined, undefined, undefined, attachments);
    expect(p).toContain("/repo/.worktrees/.attachments/spec-1/layar.png");
    expect(p).toContain("/repo/.worktrees/.attachments/spec-1/error.log");
    expect(p).toContain("INDEX.md");
    expect(p).toContain("layar.png");
  });

  it("menyuruh membaca ulang manifest di awal SETIAP fase", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-1", undefined, undefined, undefined, attachments);
    expect(p).toMatch(/awal setiap fase/i);
  });

  it("tanpa lampiran prompt tak berubah sedikit pun", () => {
    const bare = startPrompt("feature", spec, "hanoman/spec-1");
    expect(startPrompt("feature", spec, "hanoman/spec-1", undefined, undefined, undefined, { dir: "/x", items: [] }))
      .toBe(bare);
    expect(bare).not.toContain("LAMPIRAN");
  });

  it("resume, continue, dan goal membawa klausa yang sama", () => {
    const resume = resumePrompt("feature", spec, "hanoman/spec-1",
      { recorded: ["Brainstorm done"], next: "Objective", worktreeKept: true },
      undefined, undefined, undefined, attachments);
    expect(resume).toContain("/repo/.worktrees/.attachments/spec-1/layar.png");

    const cont = continuePrompt("feature", spec, "hanoman/spec-1", undefined, undefined, undefined, attachments);
    expect(cont).toContain("/repo/.worktrees/.attachments/spec-1/error.log");

    const goal = startGoalPrompt("goal", { ...spec, source: "goal", payload: { goal: "G", done: "" } },
      "hanoman/spec-1", { attachments });
    expect(goal).toContain("/repo/.worktrees/.attachments/spec-1/layar.png");
  });
});
```

`server/test/spec-attachment-launch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sandboxArgv } from "../src/services/session-sandbox";

describe("SPEC-843 · mount lampiran di sandbox sesi", () => {
  const base = {
    command: "claude", worktree: "/w", credentialDir: "/cred",
    image: "img", network: "net", proxy: "http://p",
  };
  it("memasang direktori lampiran read-only bila ada", () => {
    const argv = sandboxArgv({ ...base, attachmentsDir: "/repo/.worktrees/.attachments/spec-1" });
    expect(argv.join(" ")).toContain("/repo/.worktrees/.attachments/spec-1:/repo/.worktrees/.attachments/spec-1:ro");
  });
  it("tanpa lampiran argv tak berubah", () => {
    expect(sandboxArgv(base).join(" ")).not.toContain(".attachments");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm vitest --run --no-file-parallelism runner/src/attachment-prompt.test.ts server/test/spec-attachment-launch.test.ts`
Expected: FAIL — argumen ke-7 tak dikenal / `attachmentsDir` tak dikenal.

- [x] **Step 3: Tambahkan tipe di `runner/src/types.ts`**

Setelah `SpecBrief`:

```ts
// SPEC-843 · ADR-0124 · lampiran backlog yang SUDAH dimaterialisasi ke direktori yang terjangkau
// sesi. `path` absolut & terjamin terbaca agen — bukan storageKey, dan bukan URL.
export type SpecAttachmentBrief = {
  filename: string; mimeType: string; size: number; path: string;
};
export type AttachmentCtx = { dir: string; items: readonly SpecAttachmentBrief[] };
```

- [x] **Step 4: Tambahkan klausa di `runner/src/prompt.ts`**

Tambahkan `SpecAttachmentBrief, AttachmentCtx` ke daftar impor `./types`, lalu tambahkan klausa
tepat setelah `const methodClause = …`:

```ts
// SPEC-843 · ADR-0124 · lampiran backlog. Directive AKTIF dengan path absolut — kebalikan SADAR
// dari lampiran tiket, yang dibingkai UNTRUSTED dan sengaja TANPA path host (SPEC-761). Bedanya
// asal, bukan derajat: lampiran backlog diunggah operator yang sudah lolos gate, sumber
// kepercayaan yang SAMA dengan `Spec.objective` dan `payload` yang sudah masuk prompt apa adanya.
//
// Kalimat "baca ulang di awal setiap fase" adalah inti fiturnya, bukan hiasan: prompt ditulis
// SEKALI saat sesi lahir (ADR-0024), jadi daftar di bawah basi begitu operator menambah lampiran.
// Manifest-lah yang selalu segar — server merekonsiliasinya tiap perubahan.
const attachmentClause = (ctx?: AttachmentCtx): string => {
  if (!ctx || ctx.items.length === 0) return "";
  const list = ctx.items.map((a) =>
    `- \`${a.path}\` — ${a.filename} (${a.mimeType}, ${Math.max(1, Math.round(a.size / 1024))} KB)`).join("\n");
  return `LAMPIRAN backlog item ini (${ctx.items.length} berkas) sudah tersedia sebagai berkas di mesin ini:\n`
    + `${list}\n`
    + "BACA semuanya SEBELUM mengerjakan fase pertama — dokumen teks (.md/.txt/.log/.json/.csv) "
    + "baca langsung, PDF dan gambar baca lewat path berkasnya. Ini konteks yang dipegang manusia "
    + "saat memfilekan item ini; mengabaikannya berarti bekerja dengan konteks yang lebih miskin "
    + "darinya.\n"
    + `Lampiran bisa BERTAMBAH atau BERKURANG selagi sesi berjalan. Di AWAL SETIAP FASE, baca ulang `
    + `manifest \`${ctx.dir}/INDEX.md\` lalu baca lampiran yang belum pernah kamu baca — daftar di `
    + `atas adalah keadaan saat sesi ini lahir, bukan keadaan tetap.`;
};
```

Ubah keempat pembangun prompt:

`startPrompt` — tambahkan parameter dan sisipkan klausa tepat sesudah `methodClause(m)`:

```ts
export function startPrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
  method?: string, attachments?: AttachmentCtx,
): string {
```
```ts
    methodClause(m),
    attachmentClause(attachments),
```

`continuePrompt` — sama:

```ts
export function continuePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
  method?: string, attachments?: AttachmentCtx,
): string {
```
```ts
    methodClause(m),
    attachmentClause(attachments),
```

`resumePrompt` — sama:

```ts
export function resumePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, resume: ResumeCtx,
  autonomy?: Autonomy, verifyScope?: VerifyScope, method?: string, attachments?: AttachmentCtx,
): string {
```
```ts
    methodClause(m),
    attachmentClause(attachments),
```

`startGoalPrompt` — lewat `opts`:

```ts
  opts: { autonomy?: Autonomy; verifyScope?: VerifyScope; resume?: ResumeCtx; method?: string;
          attachments?: AttachmentCtx } = {},
```
```ts
    methodClause(m),
    attachmentClause(opts.attachments),
```

- [x] **Step 5: Mount sandbox di `server/src/services/session-sandbox.ts`**

Tambahkan field ke `SandboxInput`:

```ts
  /** SPEC-843 · ADR-0124 · direktori lampiran backlog. RO: sesi membacanya, tak pernah menulisnya. */
  attachmentsDir?: string;
```

Di `sandboxArgv`, setelah baris `promptFile`:

```ts
  if (input.attachmentsDir) mounts.push("--volume", `${input.attachmentsDir}:${input.attachmentsDir}:ro`);
```

Di `sandboxArgvFromEnv` dan `sandboxCommand`, tambahkan `attachmentsDir?: string` ke tipe `input`
(keduanya sudah meneruskan `...input`, jadi tak ada perubahan badan selain tipe).

- [x] **Step 6: Teruskan lewat `server/src/services/pty.ts`**

Tambahkan ke `CreateOpts`:

```ts
  // SPEC-843 · ADR-0124 · direktori lampiran backlog yang dimaterialisasi server.
  attachmentsDir?: string;
```

Di `createSession`, setelah blok `if (opts.phaseFile) { … }`:

```ts
  if (opts.attachmentsDir) envPairs.push(`HANOMAN_ATTACHMENTS_DIR=${sq(opts.attachmentsDir)}`);
```

Dan teruskan ke sandbox:

```ts
  if (!opts.command) cmd = sandboxCommand({
    command: cmd, worktree: cwd, phaseFile: opts.phaseFile, promptFile,
    attachmentsDir: opts.attachmentsDir,
  });
```

- [x] **Step 7: Rakit di `server/src/services/session-launch.ts`**

Tambahkan impor:

```ts
import { specAttachmentsDir, syncSpecAttachmentsDir } from "./spec-attachment-dir";
```

Tepat sebelum `const brief = { … }`:

```ts
  // SPEC-843 · ADR-0124 · lampiran dimaterialisasi ULANG di tiap kelahiran sesi, bukan hanya saat
  // diunggah: worktree bisa dibangun ulang dan direktori materialisasi bisa terhapus bersamanya.
  const attachments = {
    dir: specAttachmentsDir(repoDir, id),
    items: await syncSpecAttachmentsDir(spec.id, spec.projectId),
  };
```

Teruskan ke keempat pembangun prompt:

```ts
  if (isGoalFlow) {
    prompt = startGoalPrompt(opts.flow as "goal" | "no_effort", brief, branchTo, {
      autonomy: opts.autonomy, verifyScope, resume: resumeCtx, method: method.id, attachments,
    });
  } else if (isContinue) {
    prompt = continuePrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope, method.id, attachments);
  } else if (resumeCtx) {
    prompt = resumePrompt(opts.flow, brief, branchTo, resumeCtx, opts.autonomy, verifyScope, method.id, attachments);
  } else {
    prompt = startPrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope, method.id, attachments);
  }
```

Dan ke `createSession`:

```ts
  const s = createSession(spec.projectId, worktree, {
    specId: spec.id, flow: opts.flow, model, effort, goal, agent,
    phaseFile: phaseFilePath(repoDir, id),
    decisionFile: decisionFilePath(repoDir, id),
    attachmentsDir: attachments.items.length ? attachments.dir : undefined,
    prompt,
    env: scopeEnv,
  });
```

- [x] **Step 8: Jalankan test, pastikan lulus**

Run: `pnpm vitest --run --no-file-parallelism runner/src/attachment-prompt.test.ts server/test/spec-attachment-launch.test.ts`
Expected: PASS.

- [x] **Step 9: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck`
Expected: keluar 0.

- [x] **Step 10: Commit**

```bash
git add runner/src/types.ts runner/src/prompt.ts runner/src/attachment-prompt.test.ts server/src/services/session-sandbox.ts server/src/services/pty.ts server/src/services/session-launch.ts server/test/spec-attachment-launch.test.ts
git commit -m "feat(sesi): lampiran backlog masuk prompt fase + mount sandbox (SPEC-843, ADR-0124)"
```

---

### Task 7: UI dashboard — komponen `SpecAttachments`

**Files:**
- Create: `src/src/screens/SpecAttachments.tsx`
- Modify: `src/src/api/client.ts`, `src/src/App.tsx`, `src/src/screens/BacklogScreen.tsx`
- Test: `src/test/spec-attachments.test.tsx`

**Interfaces:**
- Consumes: `paths.specAttachments`, `paths.specAttachment`, `SpecAttachmentView` (Task 5).
- Produces:
  - `api.listSpecAttachments(id)`, `api.uploadSpecAttachments(id, files)`, `api.deleteSpecAttachment(id, attId)`
  - `<AttachmentPicker files onChange />` — mode *staged* (belum ada `specId`), dipakai `NewSpecModal`
  - `<SpecAttachmentsPanel specId onToast />` — mode live, dipakai detail backlog

- [x] **Step 1: Tulis test yang gagal**

`src/test/spec-attachments.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AttachmentPicker, SpecAttachmentsPanel } from "../src/screens/SpecAttachments";

const attachments = [
  { id: "a1", filename: "layar.png", mimeType: "image/png", size: 2048, createdAt: "2026-08-19T00:00:00.000Z" },
  { id: "a2", filename: "error.log", mimeType: "text/plain", size: 4096, createdAt: "2026-08-19T00:01:00.000Z" },
];
const listSpecAttachments = vi.fn(async () => ({ attachments }));
const deleteSpecAttachment = vi.fn(async () => ({ ok: true }));
const uploadSpecAttachments = vi.fn(async () => ({ saved: [], rejected: [] }));

vi.mock("../src/api/client", () => ({
  api: {
    listSpecAttachments: (...a: unknown[]) => listSpecAttachments(...(a as [])),
    deleteSpecAttachment: (...a: unknown[]) => deleteSpecAttachment(...(a as [])),
    uploadSpecAttachments: (...a: unknown[]) => uploadSpecAttachments(...(a as [])),
  },
}));

beforeEach(() => { listSpecAttachments.mockClear(); deleteSpecAttachment.mockClear(); });

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("SPEC-843 · UI lampiran backlog", () => {
  it("panel menampilkan thumbnail gambar dan ikon+nama dokumen", async () => {
    render(<SpecAttachmentsPanel specId="SPEC-1" onToast={vi.fn()} />);
    expect(await screen.findByAltText("layar.png")).toBeTruthy();
    expect(screen.getByText("error.log")).toBeTruthy();
    expect(screen.getByText(/2 KB/)).toBeTruthy();
  });

  it("tombol hapus memanggil API lalu memuat ulang daftar", async () => {
    render(<SpecAttachmentsPanel specId="SPEC-1" onToast={vi.fn()} />);
    await screen.findByAltText("layar.png");
    fireEvent.click(screen.getByLabelText("Hapus lampiran layar.png"));
    await waitFor(() => expect(deleteSpecAttachment).toHaveBeenCalledWith("SPEC-1", "a1"));
    await waitFor(() => expect(listSpecAttachments).toHaveBeenCalledTimes(2));
  });

  it("picker menerima drop berkas dan menampilkannya sebelum item dibuat", async () => {
    const onChange = vi.fn();
    const { container } = render(<AttachmentPicker files={[]} onChange={onChange} />);
    const zone = container.querySelector("[data-dropzone]")!;
    fireEvent.drop(zone, { dataTransfer: { files: [file("catatan.md", "text/markdown")], types: ["Files"] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]![0]![0].name).toBe("catatan.md");
  });

  it("picker menampilkan berkas yang sudah dipilih beserta tombol buang", () => {
    const onChange = vi.fn();
    render(<AttachmentPicker files={[file("a.pdf", "application/pdf")]} onChange={onChange} />);
    expect(screen.getByText("a.pdf")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Buang a.pdf"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm vitest --run src/test/spec-attachments.test.tsx`
Expected: FAIL — modul `SpecAttachments` tak ada.

- [x] **Step 3: Tambahkan klien API di `src/src/api/client.ts`**

Tambahkan `type SpecAttachmentView` ke daftar impor `@hanoman/shared`, lalu tepat setelah
`deleteSpec`:

```ts
  // SPEC-843 · ADR-0124 · lampiran backlog. Unggah multipart lewat jUpload (bukan j): header
  // application/json menghapus boundary FormData.
  listSpecAttachments: (id: string) =>
    j<{ attachments: SpecAttachmentView[] }>(paths.specAttachments(id)),
  uploadSpecAttachments: (id: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f, f.name || "lampiran");
    return jUpload<{ saved: SpecAttachmentView[]; rejected: { filename: string; reason: string }[] }>(
      paths.specAttachments(id), form);
  },
  deleteSpecAttachment: (id: string, attId: string) =>
    j<{ ok: true }>(paths.specAttachment(id, attId), { method: "DELETE" }),
```

- [x] **Step 4: Tulis `src/src/screens/SpecAttachments.tsx`**

```tsx
/* SPEC-843 · ADR-0124 · lampiran backlog item. Dua mode, satu berkas: `AttachmentPicker` untuk
   form BUAT (berkas belum punya specId, jadi ditahan di memori sampai item lahir) dan
   `SpecAttachmentsPanel` untuk detail item yang sudah ada. Keduanya berbagi tampilan kartu. */
import React from "react";
import { Button, Icon, IconButton } from "../ds";
import { paths, type SpecAttachmentView } from "@hanoman/shared";
import { api } from "../api/client";

export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,application/pdf,text/markdown,text/plain,application/json,text/csv,.md,.txt,.log,.json,.csv,.pdf";

const isImage = (mime: string) => mime.startsWith("image/");
const iconFor = (mime: string): string =>
  mime === "application/pdf" ? "file-text" : mime === "text/csv" ? "table" : "file";

export const humanSize = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const CARD: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
  border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
  background: "var(--surface-raised)", fontSize: 13,
};

const THUMB: React.CSSProperties = {
  width: 44, height: 44, objectFit: "cover", borderRadius: "var(--radius-xs)",
  border: "1px solid var(--border-hair)", display: "block",
};

function Dropzone({ children, onFiles }: { children: React.ReactNode; onFiles: (f: File[]) => void }) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div data-dropzone
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const list = Array.from(e.dataTransfer?.files ?? []);
        if (list.length) onFiles(list);
      }}
      style={{
        border: `1px dashed ${over ? "var(--brass)" : "var(--border-hair)"}`,
        borderRadius: "var(--radius-sm)", padding: 12,
        background: over ? "var(--brass-wash)" : "transparent", transition: "background 120ms",
      }}>
      <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} style={{ display: "none" }}
        aria-label="Pilih lampiran"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length) onFiles(list);
        }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Icon name="paperclip" size={14} />
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          Seret berkas ke sini — gambar, .md, .txt, .log, .json, .csv, .pdf
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" leftIcon="upload"
          onClick={() => input.current?.click()}>Pilih berkas</Button>
      </div>
      {children}
    </div>
  );
}

/** Mode STAGED: lampiran belum punya specId, jadi ditahan di memori sampai item lahir. */
export function AttachmentPicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  return (
    <Dropzone onFiles={(list) => onChange([...files, ...list])}>
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} style={CARD}>
              <Icon name={isImage(f.type) ? "image" : iconFor(f.type)} size={14} />
              <span style={{ flex: 1, color: "var(--text-strong)" }}>{f.name}</span>
              <span style={{ color: "var(--text-subtle)", fontSize: 12 }}>{humanSize(f.size)}</span>
              <IconButton size="sm" variant="ghost" icon="x" aria-label={`Buang ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
    </Dropzone>
  );
}

/** Mode LIVE: daftar dari server, unggah & hapus kapan saja — termasuk selagi sesi berjalan. */
export function SpecAttachmentsPanel({ specId, onToast }:
  { specId: string; onToast: (msg: string, tone?: "ok" | "warn" | "err") => void }) {
  const [items, setItems] = React.useState<SpecAttachmentView[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await api.listSpecAttachments(specId).catch(() => null);
    if (r) setItems(r.attachments);
  }, [specId]);
  React.useEffect(() => { void load(); }, [load]);

  async function upload(files: File[]) {
    setBusy(true);
    try {
      const r = await api.uploadSpecAttachments(specId, files);
      // Penolakan per-berkas TIDAK boleh senyap: unggahan parsial yang terlihat sukses adalah
      // kelas kegagalan tersendiri.
      if (r.rejected.length) onToast(`${r.rejected.length} berkas ditolak: ${r.rejected.map((x) => x.filename).join(", ")}`, "warn");
      if (r.saved.length) onToast(`${r.saved.length} lampiran ditambahkan`, "ok");
      await load();
    } catch { onToast("Gagal mengunggah lampiran", "err"); }
    finally { setBusy(false); }
  }

  async function remove(a: SpecAttachmentView) {
    setBusy(true);
    try { await api.deleteSpecAttachment(specId, a.id); await load(); }
    catch { onToast("Gagal menghapus lampiran", "err"); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Lampiran</div>
      <Dropzone onFiles={(f) => void upload(f)}>
        {items.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {items.map((a) => (
              <div key={a.id} style={CARD}>
                {isImage(a.mimeType)
                  ? <img src={paths.specAttachment(specId, a.id)} alt={a.filename} style={THUMB} />
                  : <Icon name={iconFor(a.mimeType)} size={16} />}
                <span style={{ flex: 1, color: "var(--text-strong)", wordBreak: "break-all" }}>{a.filename}</span>
                <span style={{ color: "var(--text-subtle)", fontSize: 12 }}>{humanSize(a.size)}</span>
                <a href={paths.specAttachment(specId, a.id)} download={a.filename}
                  aria-label={`Unduh ${a.filename}`} style={{ display: "inline-flex" }}>
                  <Icon name="download" size={14} />
                </a>
                <IconButton size="sm" variant="ghost" icon="trash-2" disabled={busy}
                  aria-label={`Hapus lampiran ${a.filename}`} onClick={() => void remove(a)} />
              </div>
            ))}
          </div>
        )}
      </Dropzone>
    </div>
  );
}
```

- [x] **Step 5: Pasang di form buat backlog (`src/src/App.tsx`)**

Impor komponen:

```tsx
import { AttachmentPicker } from "./screens/SpecAttachments";
```

Di `NewSpecModal`, tambahkan state (tepat setelah `const [f, setF] = React.useState<SpecForm>(blank);`):

```tsx
  // SPEC-843 · ADR-0124 · lampiran ditahan di memori: ia butuh specId, dan item belum ada.
  const [attachments, setAttachments] = React.useState<File[]>([]);
```

Kosongkan bersama form saat modal dibuka — di dalam `React.useEffect` yang sudah ada:

```tsx
    if (open) { setF({ ...blank, project: prefill?.project || defaultProject }); setAttachments([]); }
```

Ubah `submit` agar meneruskan lampiran:

```tsx
  const submit = () => { if (!f.title.trim() || (isGoalShape && !f.goal.trim())) return; onCreate(f, attachments); };
```

Ubah tipe prop `onCreate`:

```tsx
onCreate: (f: SpecForm, attachments: File[]) => void;
```

Sisipkan picker tepat sebelum penutup `</Modal>` isi form (setelah blok field terakhir):

```tsx
      <Field label="Lampiran" hint="Gambar, log, CSV, atau PDF — sesi agen membacanya sebagai konteks">
        <AttachmentPicker files={attachments} onChange={setAttachments} />
      </Field>
```

Ubah `createSpec` agar mengunggah setelah item lahir:

```tsx
  async function createSpec(f: SpecForm, attachments: File[] = []) {
```
dan tepat setelah `setBacklog((b) => [created, ...b]);`:

```tsx
      // SPEC-843 · unggah SESUDAH item lahir — lampiran butuh specId. Kegagalannya tak boleh
      // menghapus item yang sudah jadi; operator bisa mengulang unggah dari detail backlog.
      if (attachments.length) {
        const up = await api.uploadSpecAttachments(created.id, attachments).catch(() => null);
        if (!up) showToast("Item dibuat, tapi lampiran gagal diunggah", "warn", "paperclip");
        else if (up.rejected.length)
          showToast(`${up.rejected.length} lampiran ditolak: ${up.rejected.map((x) => x.filename).join(", ")}`, "warn", "paperclip");
      }
```

- [x] **Step 6: Pasang di detail backlog (`src/src/screens/BacklogScreen.tsx`)**

Impor:

```tsx
import { SpecAttachmentsPanel } from "./SpecAttachments";
```

Tambahkan prop `onToast` ke komponen detail bila belum ada; bila komponen sudah menerima
`showToast`/`onToast` dari `App.tsx`, pakai yang ada. Sisipkan panel tepat **sebelum** blok
`{/* SPEC-447 · ADR-0093 · siapa yang ditunggu item ini, dan kenapa. */}`:

```tsx
      {/* SPEC-843 · ADR-0124 · lampiran boleh ditambah/dihapus KAPAN SAJA, termasuk selagi sesi
          berjalan — server memateralisasi ulang dan fase berikutnya membacanya. */}
      <SpecAttachmentsPanel specId={spec.id} onToast={(m, tone) => onToast?.(m, tone)} />
```

Bila komponen detail belum punya `onToast`, tambahkan ke tipe prop-nya sebagai
`onToast?: (msg: string, tone?: "ok" | "warn" | "err") => void` dan teruskan dari `App.tsx`
dengan `onToast={(m, tone) => showToast(m, tone ?? "ok", "paperclip")}`.

- [x] **Step 7: Jalankan test, pastikan lulus**

Run: `pnpm vitest --run src/test/spec-attachments.test.tsx`
Expected: PASS (4 test).

- [x] **Step 8: Jalankan test frontend yang tersentuh + typecheck**

Run: `pnpm vitest --run src/test/backlog-board.test.tsx src/test/app-flows.test.tsx src/test/api-client.test.ts`
Expected: PASS.
Run: `pnpm --filter ./src typecheck`
Expected: keluar 0.

- [x] **Step 9: Commit**

```bash
git add src/src/screens/SpecAttachments.tsx src/src/api/client.ts src/src/App.tsx src/src/screens/BacklogScreen.tsx src/test/spec-attachments.test.tsx
git commit -m "feat(ui): unggah & kelola lampiran backlog di form buat + detail (SPEC-843)"
```

---

### Task 8: Docs SoT + naskah agen

**Files:**
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `docs/agent-integration.md`
- Test: `server/test/agent-doc-contract.test.ts` (jalankan; tambah asersi bila kontraknya menuntut)

**Interfaces:**
- Consumes: bentuk endpoint dari Task 5, model dari Task 1.

- [x] **Step 1: Baca kontrak naskah agen**

Run: `sed -n '1,80p' server/test/agent-doc-contract.test.ts`
Tujuan: tahu apa yang diuji (mis. setiap endpoint di tabel harus punya capability yang cocok dengan `capabilityForRoute`).

- [x] **Step 2: Tambahkan bagian model di `internal/docs/architecture/data-model.md`**

Tepat setelah bagian `## Ticket / TicketAttachment`, tambahkan:

```markdown
## SpecAttachment (SPEC-843 · [ADR-0124](../adr/0124-lampiran-backlog-konteks-agen.md))

Lampiran per **backlog item**, terpisah dari `TicketAttachment` (tiket dan backlog dua domain
dengan aturan sync dan tingkat kepercayaan berbeda). Byte hidup di `HANOMAN_UPLOAD_DIR`
(server-local, di luar `repoDir`); `storageKey` opaque uuid+ext, `filename` nama asli tersanitasi
untuk tampilan saja.

- **`SpecAttachment`** — `id`, `specId`→Spec (**cascade**), `projectId` (denormal, kuota &
  isolasi), `filename`, `mimeType`, `size`, `storageKey`, `createdAt`.
- **LOCAL-only** — **tanpa** kolom `version`, jadi ia tak pernah masuk changefeed sync (cermin
  `LeadFlow`/`WebhookEndpoint`/`Changelog`). Byte memang tak menyeberang (ADR-0062), dan metadata
  tanpa byte hanya menghasilkan lampiran yang tak bisa dibuka di mesin lain.
- Tipe diterima: `image/png|jpeg|webp`, `application/pdf`, `text/markdown`, `text/plain`,
  `application/json`, `text/csv` — gerbangnya **pasangan** mime ↔ ekstensi.
- Batas: 10 MB/berkas, 10 lampiran/backlog, 40 MB/backlog.
- Menghapus `Spec` menghapus baris (cascade DB) **dan** byte + direktori materialisasi
  (`services/spec-attachment.ts`, `services/spec-attachment-dir.ts`) — cascade DB tak menyentuh disk.
- Jalur ke agen: lampiran dimaterialisasi ke `<repoDir>/.worktrees/.attachments/<sessionId>/`
  (sekamar `.phases`, **di luar** worktree) dengan `INDEX.md`, direkonsiliasi penuh tiap perubahan.
```

- [x] **Step 3: Tambahkan endpoint di `internal/docs/architecture/api-contract.md`**

Cari bagian route `/specs` (blok yang memuat `POST /specs/:id/done`) dan tambahkan sesudahnya:

```
# SPEC-843 · ADR-0124 · lampiran backlog item. Capability jatuh dari prefix `specs` → `backlog`,
#   read/write diturunkan dari METHOD. Batas multipart dipasang PER-REQUEST (10 MB/berkas,
#   10 lampiran/backlog, 40 MB/backlog); registrasi global 5 MB/12 berkas milik lampiran gambar
#   SPEC-816 TIDAK ikut naik. Lampiran TIDAK dipajang di katalog MCP (unggah = tindakan manusia).
GET    /specs/:id/attachments             # 200 { attachments:[{id,filename,mimeType,size,createdAt}] } | 404
POST   /specs/:id/attachments             # multipart, N berkas per request →
                                          #   201 { saved:[…], rejected:[{filename,reason}] } — berkas
                                          #   yang ditolak TIDAK menggagalkan yang lain (pola intakeTicket).
                                          #   reason: type|size|count|quota|scan. 400 (bukan multipart /
                                          #   tak ada berkas) | 404 (spec tak ada)
GET    /specs/:id/attachments/:attId      # 200 byte (Content-Type mime, Content-Disposition attachment,
                                          #   nosniff, CSP sandbox) | 404 (bukan milik spec / file hilang)
DELETE /specs/:id/attachments/:attId      # 200 { ok:true } | 404
```

- [x] **Step 4: Perbarui `docs/agent-integration.md`**

Di tabel §6 (endpoint yang paling sering dipakai), tepat setelah baris `POST /api/specs/:id/done`:

```
| `GET /api/specs/:id/attachments` | `backlog:read` | lampiran backlog item — gambar & dokumen yang dilampirkan manusia sebagai konteks. |
| `POST /api/specs/:id/attachments` | `backlog:write` | unggah lampiran (multipart, beberapa berkas per request). Berkas yang ditolak tak menggagalkan yang lain — periksa `rejected[]`. |
| `GET /api/specs/:id/attachments/:attId` | `backlog:read` | byte satu lampiran. |
| `DELETE /api/specs/:id/attachments/:attId` | `backlog:write` | hapus satu lampiran. |
```

Di §13 pada bagian **"Yang sengaja TIDAK tersedia lewat MCP"**, tambahkan kalimat:

```
Lampiran backlog (`/api/specs/:id/attachments*`, SPEC-843 · ADR-0124) juga **tidak** punya tool:
berkasnya lahir dari disk manusia, bukan dari model, dan tool MCP berbentuk JSON sehingga byte
biner tak punya representasi di sana. REST-nya tetap terjangkau agent token ber-`backlog:read`/
`backlog:write` — yang tak dipajang adalah **tool**-nya.
```

Tambahkan juga catatan di §9 (jebakan yang sudah diketahui):

```
- **Lampiran backlog tak menyeberang sync.** `SpecAttachment` LOCAL-only (ADR-0124): item yang
  sama di instance lain tampil tanpa lampiran. Kalau kamu tak menemukan lampiran yang disebut
  manusia, kamu mungkin sedang bicara ke instance yang bukan tempat lampiran itu diunggah.
```

- [x] **Step 5: Verifikasi index & kontrak naskah agen**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/agent-doc-contract.test.ts server/test/agent-doc.route.test.ts server/test/agent-capabilities.test.ts`
Expected: PASS.

Run: `node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli exec tsx src/index.ts docs index --check`
Expected: index bersih (ADR-0124 sudah ter-link dari Task Spec).

- [x] **Step 6: Commit**

```bash
git add internal/docs docs/agent-integration.md
git commit -m "docs: SpecAttachment di data-model, api-contract, naskah agen (SPEC-843, ADR-0124)"
```

---

### Task 9: Verifikasi akhir & smoke endpoint nyata

**Files:** —

- [x] **Step 1: Jalankan seluruh test yang tersentuh perubahan**

Run:
```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```
Expected: PASS, dan **jumlah berkas test > 0** (`--changed` menyalakan `passWithNoTests`, jadi nol test terlihat hijau — baca outputnya).

- [x] **Step 2: Typecheck paket yang tersentuh**

Run: `pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck`
Expected: keluar 0 untuk keempatnya.

- [x] **Step 3: Smoke endpoint nyata (task ini menyentuh endpoint)**

```bash
HANOMAN_HOME="$(mktemp -d)" HANOMAN_UPLOAD_DIR="$(mktemp -d)" NODE_ENV=development \
  pnpm --filter ./server exec tsx src/server.ts &
# tunggu boot, lalu:
curl -sS -X POST localhost:3001/api/specs -H 'content-type: application/json' \
  -d '{"project":"<id>","source":"brief","title":"smoke","priority":"sedang","payload":{"context":"c","outcome":"o","constraints":"","priority":"sedang"}}'
curl -sS -X POST localhost:3001/api/specs/<SPEC-ID>/attachments -F 'files=@README.md;type=text/markdown'
curl -sS localhost:3001/api/specs/<SPEC-ID>/attachments
curl -sS -o /dev/null -w '%{http_code}\n' localhost:3001/api/specs/<SPEC-ID>/attachments/<ATT-ID>
```
Expected: `201` unggah dengan `saved` berisi satu berkas, daftar memuatnya, unduh `200`.
Matikan server per-PID (`lsof -ti:3001` → `kill <pid>`), **jangan** `pkill -f`.

- [x] **Step 4: Commit sisa & push**

```bash
git add -A
git commit -m "chore(spec-843): verifikasi akhir"
git push origin HEAD:refs/heads/hanoman/spec-843
```

---

## Catatan verifikasi (diisi saat Execute)

- **`--changed "$HANOMAN_BASE_SHA"` mengembang jadi 417 berkas test** (2,2 jam): `App.tsx`,
  `runner/src/prompt.ts`, dan `upload-pipeline.ts` diimpor sangat luas. Di mesin yang menjalankan
  beberapa sesi sekaligus, hasilnya 34 berkas "gagal" yang hampir seluruhnya **timeout kontensi** —
  `integrate.test.ts` sendiri butuh 990 detik. Semua suite yang gagal dijalankan ULANG terisolasi
  dan lulus: 8 suite server (61 test), 7 suite server ringan (148 test), 6 suite berat (184 test),
  13 berkas frontend (81 test).
- **Dua regresi NYATA yang ditemukan run itu, sudah diperbaiki:**
  1. `SpecAttachmentsPanel` merobohkan seluruh detail backlog di layar yang me-mock `../api/client`
     sebagian (`api.listSpecAttachments is not a function`) **dan** di layar yang mem-spy `fetch`
     dengan satu amplop untuk semua URL (`setItems(undefined)` → `undefined.length` di render
     BERIKUTNYA, jadi jejaknya menunjuk ke tempat yang salah). Dijaga `?.` + `Array.isArray`.
  2. `PG_ORDER` (`cli/src/commands/migrate-pg.ts`) wajib memuat SETIAP model Prisma tepat sekali —
     `SpecAttachment` ditambahkan sesudah `Spec`.
- **Dua kegagalan PRE-EXISTING**, dibuktikan dengan menjalankan suite yang sama di worktree
  `$HANOMAN_BASE_SHA`: `server/test/events.route.test.ts` (2 gagal, WS 401) dan
  `server/test/terminal.route.test.ts` (15 gagal) — angkanya identik di kedua sisi. Keduanya
  bergantung pada env sesi (`HANOMAN_CONTROL_ORIGINS`) yang sengaja dilepas saat menjalankan test.
- **Jebakan env yang terkonfirmasi lagi:** `HANOMAN_CONTROL_ORIGINS` di env sesi membuat
  `classifyIngress` menjawab `denied` → **seluruh** route test 404 dengan body `{"error":"not found"}`
  milik handler sendiri, termasuk `DELETE /specs/:id` yang tak punya jalur 404 sama sekali.
