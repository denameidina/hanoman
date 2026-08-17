# SPEC-816 — Lampiran gambar sesi terminal: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator bisa mem-paste atau menyeret gambar ke pane sesi terminal — sesi baru maupun berumur seminggu — dan path berkasnya masuk ke prompt sebagai teks, tanpa menyentuh clipboard mesin server sama sekali.

**Architecture:** Pane mengunggah berkas lewat `POST /api/terminal/sessions/:id/attachments` (multipart). Server menyimpannya di `~/.hanoman/uploads/terminal/<sessionId>/<uuid>.<ext>` dan mengembalikan path absolut, yang pane kirim ke PTY lewat `sendInput` **tanpa Enter**. Kepemilikan berkas dicatat oleh subdirektori per sesi — tak ada model Prisma, tak ada migration, tak ada ADR. `killSession()` menyapu direktorinya.

**Tech Stack:** Fastify 5 + `@fastify/multipart` (sudah terdaftar), Node `fs/promises`, React 19 + xterm 6, vitest.

Spec: `docs/superpowers/specs/2026-08-17-spec-816-lampiran-gambar-sesi-terminal-design.md`

## Global Constraints

- **Allowlist mime persis tiga**: `image/png`, `image/jpeg`, `image/webp` — kunci `EXT` di `server/src/services/uploads.ts:11`. `image/gif` **di luar** allowlist (dipetakan `extFor` ke `.bin`).
- **Batas berkas 5 MB**, ditegakkan route dengan memeriksa `part.file.truncated` — multipart terdaftar `throwFileSizeLimit: false` (`server/src/app.ts:126`), jadi berkas oversize datang ter-truncate, **bukan** sebagai error.
- **Tanpa dependensi baru.** hanoman didistribusikan sebagai paket npm global (ADR-0087); biner native seperti `sharp` dilarang.
- **Tanpa perubahan skema Prisma, tanpa ADR baru.**
- **Penghapusan berkas tak boleh sinkron di jalur sesi.** `rmSync` memblokir seluruh event loop (SPEC-742/ADR-0116, terukur 1.364 ms). Pakai `rm()` async, fire-and-forget.
- **Teks UI & pesan galat dalam Bahasa Indonesia**, mengikuti seluruh route yang ada.
- **Perintah test wajib** (CLAUDE.md + SPEC-479):
  ```bash
  cd /Users/denameidina/Documents/Nafanesia/hanoman
  env -u NODE_ENV -u DATABASE_URL TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
    pnpm vitest --run --no-file-parallelism <path-test>
  ```
  `--no-file-parallelism` wajib untuk test server (satu berkas DB bersama); `TEST_DATABASE_URL` sendiri wajib karena `~/.hanoman/hanoman.test.db` dipakai bersama semua worktree dan dihapus di awal tiap run.

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `server/src/services/uploads.ts` (modify) | `saveSessionUpload` / `dropSessionUploads` / validasi `sessionId` sebelum menyentuh disk |
| `server/src/services/pty.ts` (modify, `killSession` ~865) | memanggil `dropSessionUploads` saat sesi mati |
| `server/src/routes/terminal.ts` (modify) | endpoint multipart + kode galat |
| `shared/src/api.ts` (modify) | path `terminalAttachments` |
| `src/src/screens/terminal-clipboard.ts` (modify) | helper murni pemilah berkas gambar dari `DataTransfer` |
| `src/src/api/client.ts` (modify) | `uploadTerminalAttachment` (fetch multipart sendiri) |
| `src/src/screens/TerminalPane.tsx` (modify) | listener `paste`/`dragover`/`drop`, kirim path, tulis galat ke pane |
| `server/test/session-uploads.test.ts` (create) | unit `saveSessionUpload`/`dropSessionUploads` |
| `server/test/terminal-attachments.route.test.ts` (create) | route 200/415/413/404 + sapuan `killSession` |
| `src/test/terminal-clipboard.test.ts` (modify) | helper murni |
| `src/test/terminal-pane.test.tsx` (modify) | paste & drop end-to-end di komponen |

---

### Task 1: Bukti — apakah pembajakan Cmd+V menelan event `paste` native?

Spike, **tanpa perubahan kode**. Hasilnya menentukan Task 7. Jangan lewati: seluruh Task 6–7 mati diam-diam kalau jawabannya "ya" dan kita tak tahu.

**Files:** tak ada. Skrip sekali pakai di scratchpad.

**Interfaces:**
- Consumes: —
- Produces: satu kalimat kesimpulan yang ditempel ke bagian "Catatan hasil Task 1" di bawah.

- [x] **Step 1: Jalankan dev server**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
env -u NODE_ENV -u DATABASE_URL pnpm dev
```

Vite bind ke `localhost` (bukan `127.0.0.1`) dan mem-proxy `/api` ke **8787**.

- [x] **Step 2: Buat sesi tmux palsu — JANGAN `POST /terminal/sessions`**

`POST /terminal/sessions` men-spawn `claude --dangerously-skip-permissions` sungguhan di `repoDir`, memakai subscription pengguna dan menaruh agen otonom di working tree yang dipakai sesi lain.

```bash
tmux -L hanoman -f /dev/null new-session -d -s hanoman-smoke816 -c /tmp 'sh' \
  \; set-option -t hanoman-smoke816 @hanoman_project hanoman \
  \; set-option -t hanoman-smoke816 @hanoman_cwd /tmp
```

- [x] **Step 3: Buka Chrome headless dengan CDP dan cek event paste**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/cdp816 \
  http://localhost:5173 &
```

Lalu dari Node (Node 24 punya `fetch` + `WebSocket` global, jadi tanpa dependensi):
navigasi ke terminal (`document.querySelector('nav button[aria-label="Terminal"]').click()`),
buka pane sesi `smoke816`, lalu evaluasi:

```js
// pasang perekam SEBELUM menekan Cmd+V
window.__paste = 0;
document.querySelector('[data-testid="terminal-host"]')
  .addEventListener("paste", () => { window.__paste += 1; }, true);
```

Kirim keydown Cmd+V lewat `Input.dispatchKeyEvent` (`modifiers: 4` = Meta, `key: "v"`, `code: "KeyV"`), lalu baca `window.__paste`.

- [x] **Step 4: Catat hasilnya di plan ini**

Tulis di bawah judul **Catatan hasil Task 1**: `__paste === 0` → pembajakan menelan event, Task 7 **wajib** dijalankan; `__paste >= 1` → event lolos, Task 7 dilewati dan checkbox-nya ditandai "tak berlaku".

- [x] **Step 5: Bersihkan**

```bash
tmux -L hanoman kill-session -t hanoman-smoke816
pkill -f "user-data-dir=/tmp/cdp816"
```

`pkill -f` di sini aman karena polanya menargetkan `--user-data-dir` unik; **jangan** pernah `pkill -f` pola yang bisa mengenai sesi agen tetangga (SPEC-402).

**Catatan hasil Task 1 (2026-08-17):** Dijawab dari **sumber xterm terpasang**, bukan CDP — lebih
murah dan lebih pasti. Di `src/node_modules/@xterm/xterm/lib/xterm.js`:

```js
_keyDown(e){ this._keyDownHandled=!1, this._keyDownSeen=!0,
  this._customKeyEventHandler && !1===this._customKeyEventHandler(e) ) return !1; ... }
```

Handler kustom yang mengembalikan `false` **kembali sebelum** `cancel(e)`/`preventDefault` mana
pun → default browser berjalan → event `paste` native **tetap terbit**. Setara `__paste >= 1`:
**Task 7 tak berlaku**, langkah-langkahnya ditandai demikian.

Temuan susulan yang TIDAK ada di rencana semula: xterm mendaftarkan listener paste-nya sendiri di
**dua** simpul —

```js
const e = e => handlePasteEvent(e, this.textarea, this.coreService, this.optionsService);
addDisposableListener(this.textarea, "paste", e);
addDisposableListener(this.element,  "paste", e);
```

Artinya teks yang di-paste sudah punya jalur native menuju `onData` → `sendInput`, dan cabang
`readText` di `TerminalPane.tsx:171` **menduplikasinya** — kecuali `readText` selama ini memang
gagal diam-diam karena izin clipboard-read (yang juga menjelaskan kenapa paste-ganda tak pernah
dilaporkan). Dugaan ini **belum dibuktikan**; buktinya diambil di Task 8 Step 5 dengan paste
sungguhan di browser. Bila paste-ganda terlihat, jalankan Task 7 apa adanya — perubahannya identik,
hanya alasannya yang berbeda.

---

### Task 2: `saveSessionUpload` & `dropSessionUploads`

**Files:**
- Modify: `server/src/services/uploads.ts`
- Test: `server/test/session-uploads.test.ts` (create)

**Interfaces:**
- Consumes: `uploadDir()`, `extFor(mime)` dari modul yang sama.
- Produces:
  - `sessionUploadDir(sessionId: string): string` — throw `Error` bila id tak sah.
  - `saveSessionUpload(sessionId: string, buf: Buffer, mimeType: string): Promise<{ path: string; size: number }>` — `path` **absolut**.
  - `dropSessionUploads(sessionId: string): Promise<void>` — best-effort, tak pernah throw.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/session-uploads.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { saveSessionUpload, dropSessionUploads, sessionUploadDir } from "../src/services/uploads";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hanoman-up816-"));
  process.env.HANOMAN_UPLOAD_DIR = dir;
});
afterEach(() => {
  delete process.env.HANOMAN_UPLOAD_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("SPEC-816 · lampiran per sesi", () => {
  it("menyimpan berkas di bawah terminal/<sessionId> dan mengembalikan path absolut", async () => {
    const buf = Buffer.from("PNGDATA");
    const { path, size } = await saveSessionUpload("sesi-1", buf, "image/png");
    expect(isAbsolute(path)).toBe(true);
    expect(path.startsWith(join(dir, "terminal", "sesi-1") + "/")).toBe(true);
    expect(path.endsWith(".png")).toBe(true);
    expect(size).toBe(buf.length);
    expect(readFileSync(path)).toEqual(buf);
  });

  it("memisahkan sesi: berkas satu sesi tak mendarat di direktori sesi lain", async () => {
    const a = await saveSessionUpload("sesi-a", Buffer.from("a"), "image/webp");
    const b = await saveSessionUpload("sesi-b", Buffer.from("b"), "image/jpeg");
    expect(a.path.endsWith(".webp")).toBe(true);
    expect(b.path.endsWith(".jpg")).toBe(true);
    expect(a.path).not.toContain("sesi-b");
  });

  // sessionId datang dari parameter URL — beda dari storageKey yang selalu lahir dari saveUpload.
  it("menolak sessionId yang bisa keluar dari direktori unggahan", () => {
    for (const bad of ["../../etc", "a/b", "sesi 1", "", "SESI"]) {
      expect(() => sessionUploadDir(bad)).toThrow();
    }
    expect(sessionUploadDir("spec-816_reverse")).toBe(join(dir, "terminal", "spec-816_reverse"));
  });

  it("dropSessionUploads menghapus seluruh direktori sesi dan diam untuk sesi tak dikenal", async () => {
    const { path } = await saveSessionUpload("sesi-1", Buffer.from("x"), "image/png");
    await dropSessionUploads("sesi-1");
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(dir, "terminal", "sesi-1"))).toBe(false);
    await expect(dropSessionUploads("sesi-tak-ada")).resolves.toBeUndefined();
    await expect(dropSessionUploads("../../etc")).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
env -u NODE_ENV -u DATABASE_URL TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/session-uploads.test.ts
```

Expected: FAIL — `saveSessionUpload is not a function` / gagal resolve ekspor.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/uploads.ts`, tambahkan `rm` ke impor `node:fs/promises` (`import { mkdir, writeFile, readFile, unlink, rm } from "node:fs/promises";`) dan tambahkan di bawah `saveUpload`:

```ts
// SPEC-816 · lampiran gambar sesi terminal. Kepemilikan berkas dicatat SUBDIREKTORI per sesi —
// tanpa tabel, tanpa migration. `sessionId` datang dari parameter URL (beda dari `storageKey`
// yang selalu lahir dari saveUpload), jadi ia divalidasi sebelum menyentuh disk. Bentuknya
// diturunkan dari kedua pabrik id: `randomUUID().slice(0,8)` dan `sessionIdForSpec`
// (lowercase + `_`/`-`, session-id.ts).
const SESSION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function sessionUploadDir(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error(`sessionId tak sah: ${sessionId}`);
  return join(uploadDir(), "terminal", sessionId);
}

export async function saveSessionUpload(
  sessionId: string, buf: Buffer, mimeType: string,
): Promise<{ path: string; size: number }> {
  const dir = sessionUploadDir(sessionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${randomUUID()}${extFor(mimeType)}`);
  await writeFile(path, buf, { mode: 0o600 });
  return { path, size: buf.length };
}

// Best-effort: kegagalan menghapus TAK boleh menahan penutupan sesi (alasan yang sama seperti
// emitDeath menelan galatnya sendiri). `rm` async, bukan `rmSync` — rmSync memblokir seluruh
// event loop (SPEC-742/ADR-0116).
export async function dropSessionUploads(sessionId: string): Promise<void> {
  let dir: string;
  try { dir = sessionUploadDir(sessionId); } catch { return; }
  await rm(dir, { recursive: true, force: true }).catch(() => { /* sudah tak ada */ });
}
```

- [x] **Step 4: Jalankan, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/session-uploads.test.ts
```

Expected: PASS, 4 test.

- [x] **Step 5: Commit**

```bash
git add server/src/services/uploads.ts server/test/session-uploads.test.ts
git commit -m "feat(spec-816): penyimpanan lampiran per sesi terminal"
```

---

### Task 3: `killSession` menyapu lampiran sesi

**Files:**
- Modify: `server/src/services/pty.ts` (fungsi `killSession`, ~baris 865)
- Test: `server/test/session-uploads.test.ts` (tambah blok describe)

**Interfaces:**
- Consumes: `dropSessionUploads(sessionId)` dari Task 2.
- Produces: efek samping — `killSession(id)` menghapus `<uploadDir>/terminal/<id>/`; `detachAll()` **tidak**.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/session-uploads.test.ts`:

```ts
import { fileURLToPath } from "node:url";
import { killSession, detachAll, killAll, createSession } from "../src/services/pty";

// Fixture yang sama dipakai terminal.route.test.ts: /bin/cat mati karena
// --dangerously-skip-permissions ilegal baginya.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

describe("SPEC-816 · lampiran ikut mati bersama sesinya", () => {
  afterEach(() => { killAll(); });

  it("killSession menghapus direktori lampiran; detachAll membiarkannya", async () => {
    // createSession(projectId, cwd, opts) — posisional.
    const id = createSession("p1", "/tmp", { id: "att816kill", command: [FAKE_CLAUDE] }).id;
    const { path } = await saveSessionUpload(id, Buffer.from("x"), "image/png");

    // Restart server melepas klien tmux tapi membiarkan sesi hidup (ADR-0016) — lampirannya
    // harus ikut selamat.
    detachAll();
    expect(existsSync(path)).toBe(true);

    killSession(id);
    // Penghapusan fire-and-forget (bukan rmSync, SPEC-742), jadi ditunggu.
    await vi.waitFor(() => expect(existsSync(path)).toBe(false));
  });
});
```

Tambahkan `vi` ke impor vitest di berkas itu, dan `existsSync` sudah diimpor di Step 1 Task 2.
**Jangan** memanggil `POST /terminal/sessions` di test ini — jalur itu men-spawn `claude`
sungguhan; `createSession` dengan `command: [FAKE_CLAUDE]` mengganti argv-nya.

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/session-uploads.test.ts
```

Expected: FAIL pada `waitFor` — berkas masih ada sesudah `killSession`.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/pty.ts`, tambahkan impor `import { dropSessionUploads } from "./uploads";` dan di dalam `killSession`, tepat sesudah `emitDeath(...)`:

```ts
  // SPEC-816 · lampiran gambar sesi ini ikut mati. Fire-and-forget: `rm` async (rmSync memblokir
  // event loop, SPEC-742/ADR-0116) dan kegagalannya tak boleh menahan penutupan sesi.
  void dropSessionUploads(id).catch(() => { /* berkas sisa tak fatal */ });
```

- [x] **Step 4: Jalankan, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/session-uploads.test.ts server/test/pty.test.ts
```

Expected: PASS. `pty.test.ts` ikut dijalankan karena `killSession` adalah jalur bersamanya.
Bila `pty.test.ts` gagal ramai soal tmux, itu sesi tmux sisa — jalankan `pnpm vitest --run server/test/pty.test.ts` sekali lagi setelah `tmux -L hanoman-test kill-server`.

- [x] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/test/session-uploads.test.ts
git commit -m "feat(spec-816): sapu lampiran sesi saat killSession"
```

---

### Task 4: Endpoint `POST /terminal/sessions/:id/attachments`

**Files:**
- Modify: `server/src/routes/terminal.ts`
- Modify: `shared/src/api.ts`
- Test: `server/test/terminal-attachments.route.test.ts` (create)

**Interfaces:**
- Consumes: `saveSessionUpload` (Task 2), `getSession(id)` dari `../services/pty`.
- Produces:
  - HTTP `POST /api/terminal/sessions/:id/attachments`, field multipart bernama `file` → `200 { path: string }`.
  - `paths.terminalAttachments(id: string): string` di `@hanoman/shared`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/terminal-attachments.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { killAll, createSession } from "../src/services/pty";
import { resetDb, makeProject } from "./factory";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
let upl = "";
let seq = 0;

function formFile(mime: string, data: Buffer, filename = "gambar.png") {
  const boundary = "----spec816";
  const CRLF = "\r\n";
  const head = Buffer.from(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mime}${CRLF}${CRLF}`);
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

// createSession(projectId, cwd, opts) — posisional. Id eksplisit per test supaya sesi tak
// saling menyambung (ADR-0015: id yang sama = sambung, bukan sesi kedua).
const newSession = (): string =>
  createSession("p1", "/tmp", { id: `att816-${seq++}`, command: [FAKE_CLAUDE] }).id;

beforeAll(async () => { killAll(); await resetDb(); await makeProject({ id: "p1", repoDir: null }); });
afterAll(async () => { killAll(); await app.close(); });
beforeEach(() => { upl = mkdtempSync(join(tmpdir(), "hanoman-att816-")); process.env.HANOMAN_UPLOAD_DIR = upl; });
afterEach(() => { delete process.env.HANOMAN_UPLOAD_DIR; rmSync(upl, { recursive: true, force: true }); killAll(); });

describe("SPEC-816 · POST /terminal/sessions/:id/attachments", () => {
  it("menyimpan png dan mengembalikan path yang benar-benar terbaca", async () => {
    const id = newSession();
    const data = Buffer.from("\x89PNG\r\n\x1a\nfake");
    const res = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${id}/attachments`, ...formFile("image/png", data),
    });
    expect(res.statusCode).toBe(200);
    const { path } = res.json() as { path: string };
    expect(path.startsWith(join(upl, "terminal", id) + "/")).toBe(true);
    expect(readFileSync(path)).toEqual(data);
  });

  it("menolak mime di luar allowlist tanpa menulis berkas apa pun", async () => {
    const id = newSession();
    const res = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${id}/attachments`,
      ...formFile("image/gif", Buffer.from("GIF89a"), "animasi.gif"),
    });
    expect(res.statusCode).toBe(415);
    expect(existsSync(join(upl, "terminal", id))).toBe(false);
  });

  // throwFileSizeLimit:false → berkas oversize datang TER-TRUNCATE, bukan sebagai error.
  // Tanpa gerbang ini kita menyimpan gambar rusak yang gagal dibaca agen tanpa satu tanda pun.
  it("menolak berkas melebihi 5 MB alih-alih menyimpan potongannya", async () => {
    const id = newSession();
    const res = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${id}/attachments`,
      ...formFile("image/png", Buffer.alloc(6 * 1024 * 1024, 1)),
    });
    expect(res.statusCode).toBe(413);
    expect(existsSync(join(upl, "terminal", id))).toBe(false);
  });

  it("404 untuk sesi tak dikenal dan untuk id yang mencoba keluar dari direktori", async () => {
    for (const id of ["tak-ada", "..%2F..%2Fetc"]) {
      const res = await app.inject({
        method: "POST", url: `/api/terminal/sessions/${id}/attachments`,
        ...formFile("image/png", Buffer.from("x")),
      });
      expect(res.statusCode).toBe(404);
    }
    expect(existsSync(join(upl, "terminal"))).toBe(false);
  });

  it("400 bila bukan multipart", async () => {
    const id = newSession();
    const res = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${id}/attachments`, payload: { file: "bukan" },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
env -u NODE_ENV -u DATABASE_URL TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/terminal-attachments.route.test.ts
```

Expected: FAIL — seluruh test 404 (route belum ada).

- [x] **Step 3: Tambah path di shared**

Di `shared/src/api.ts`, tepat di bawah `terminalWs` (baris ~99):

```ts
  // SPEC-816 · lampiran gambar sesi (multipart). Di bawah prefix /terminal supaya ikut capability
  // `sessions` yang sudah ada — POST menurunkan cabang tulisnya tanpa perubahan peta.
  terminalAttachments: (id: string) => `${API}/terminal/sessions/${id}/attachments`,
```

- [x] **Step 4: Implementasi route**

Di `server/src/routes/terminal.ts`, tambahkan `saveSessionUpload` ke impor dari `../services/uploads` (buat impornya bila belum ada) dan pasang route sebelum blok `app.get("/terminal/sessions/:id/ws", ...)`:

```ts
// SPEC-816 · lampiran gambar sesi terminal. Berkas + path, bukan gambar inline: yang bisa dikirim
// ke PTY hanyalah teks, dan CLI-lah yang menyusun blok image dari berkas yang dibacanya.
const ATTACHMENT_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

app.post("/terminal/sessions/:id/attachments", async (req, reply) => {
  const { id } = req.params as { id: string };
  // Gerbang sesi hidup berdiri SEBELUM disk tersentuh: id yang mencoba traversal tak akan pernah
  // cocok dengan sesi tmux mana pun, jadi ia jatuh di 404 yang sama.
  if (!getSession(id)) return reply.code(404).send({ error: "not found" });
  if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

  const part = await (req as any).file?.();
  if (!part) return reply.code(400).send({ error: "unggahan tak valid" });
  const buf = await part.toBuffer();           // menguras stream lebih dulu
  // throwFileSizeLimit:false (app.ts) → oversize datang ter-truncate, bukan sebagai error.
  if (part.file?.truncated) return reply.code(413).send({ error: "berkas melebihi 5 MB" });
  if (!ATTACHMENT_MIME.has(part.mimetype)) return reply.code(415).send({ error: "tipe berkas tak didukung" });

  const { path } = await saveSessionUpload(id, buf, part.mimetype);
  return { path };
});
```

- [x] **Step 5: Jalankan, pastikan LULUS**

```bash
env -u NODE_ENV -u DATABASE_URL TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/terminal-attachments.route.test.ts
```

Expected: PASS, 5 test.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/terminal.ts shared/src/api.ts server/test/terminal-attachments.route.test.ts
git commit -m "feat(spec-816): endpoint lampiran gambar sesi terminal"
```

---

### Task 5: Helper murni pemilah berkas gambar

**Files:**
- Modify: `src/src/screens/terminal-clipboard.ts`
- Test: `src/test/terminal-clipboard.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `ATTACHABLE_MIME: Set<string>`
  - `imageFilesFrom<T extends { type: string }>(dt: { files?: ArrayLike<T> | null } | null | undefined): T[]`
  - `hasImageDrag(dt: { types?: ArrayLike<string> | null } | null | undefined): boolean`

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/terminal-clipboard.test.ts`:

```ts
import { imageFilesFrom, hasImageDrag } from "../src/screens/terminal-clipboard";

describe("SPEC-816 · pemilah berkas gambar", () => {
  it("mengambil png/jpeg/webp dan membuang sisanya", () => {
    const files = [
      { type: "image/png" }, { type: "text/plain" }, { type: "image/webp" },
      { type: "image/gif" }, { type: "image/jpeg" }, { type: "application/pdf" },
    ];
    expect(imageFilesFrom({ files }).map((f) => f.type))
      .toEqual(["image/png", "image/webp", "image/jpeg"]);
  });

  it("clipboard teks polos tak menghasilkan lampiran", () => {
    expect(imageFilesFrom({ files: [] })).toEqual([]);
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
  });

  // dragover: `files` masih KOSONG selama seret berlangsung (baru terisi saat drop), jadi
  // keputusan preventDefault harus dibaca dari `types`.
  it("hasImageDrag membaca types, bukan files", () => {
    expect(hasImageDrag({ types: ["Files"] })).toBe(true);
    expect(hasImageDrag({ types: ["text/plain"] })).toBe(false);
    expect(hasImageDrag(null)).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
env -u NODE_ENV pnpm vitest --run src/test/terminal-clipboard.test.ts
```

Expected: FAIL — `imageFilesFrom is not a function`.

- [x] **Step 3: Implementasi minimal**

Tambahkan di akhir `src/src/screens/terminal-clipboard.ts`:

```ts
// SPEC-816 · allowlist ini CERMIN `ATTACHMENT_MIME` di routes/terminal.ts dan kunci `EXT` di
// services/uploads.ts. `image/gif` sengaja di luar: `extFor` memetakannya ke `.bin`.
export const ATTACHABLE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export function imageFilesFrom<T extends { type: string }>(
  dt: { files?: ArrayLike<T> | null } | null | undefined,
): T[] {
  const files = dt?.files ? Array.from(dt.files) : [];
  return files.filter((f) => ATTACHABLE_MIME.has(f.type));
}

// `dataTransfer.files` KOSONG selama `dragover` — isinya baru terbit saat `drop`. Jadi keputusan
// "seret ini membawa berkas" dibaca dari `types`, dan tanpa preventDefault di dragover browser
// menolak drop-nya sama sekali.
export function hasImageDrag(dt: { types?: ArrayLike<string> | null } | null | undefined): boolean {
  return dt?.types ? Array.from(dt.types).includes("Files") : false;
}
```

- [x] **Step 4: Jalankan, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/terminal-clipboard.test.ts
```

Expected: PASS — test lama (SPEC-289) + 3 test baru.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/terminal-clipboard.ts src/test/terminal-clipboard.test.ts
git commit -m "feat(spec-816): helper pemilah berkas gambar clipboard/drag"
```

---

### Task 6: Pane mengunggah & mengetik path

**Files:**
- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/TerminalPane.tsx`
- Test: `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `imageFilesFrom` / `hasImageDrag` (Task 5), `paths.terminalAttachments` (Task 4).
- Produces: `api.uploadTerminalAttachment(sessionId: string, file: File): Promise<{ path: string }>`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/terminal-pane.test.tsx` (harness `xt`, `FakeWebSocket`, dan `paneHost` sudah ada di berkas itu):

```ts
const imageFile = (type = "image/png") =>
  ({ type, name: "tangkapan.png", size: 4 }) as unknown as File;

describe("SPEC-816 · lampiran gambar", () => {
  it("mem-paste gambar mengunggahnya dan mengetik path-nya TANPA Enter", async () => {
    const upload = vi.spyOn(api, "uploadTerminalAttachment")
      .mockResolvedValue({ path: "/Users/d/.hanoman/uploads/terminal/sesi-1/abc.png" });
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });

    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData: unknown;
    };
    Object.defineProperty(event, "clipboardData", { value: { files: [imageFile()] } });
    act(() => { paneHost(container).dispatchEvent(event); });

    await vi.waitFor(() => expect(upload).toHaveBeenCalledWith("sesi-1", expect.anything()));
    await vi.waitFor(() => expect(sockets[0]?.sent).toContain(
      JSON.stringify({ t: "in", d: "/Users/d/.hanoman/uploads/terminal/sesi-1/abc.png " })));
    expect(event.defaultPrevented).toBe(true);
    // Tanpa Enter: operator melanjutkan mengetik kalimatnya di sebelah path.
    expect(sockets[0]?.sent.some((s) => s.includes("\\r"))).toBe(false);
  });

  it("paste teks polos tak memanggil unggahan sama sekali", async () => {
    const upload = vi.spyOn(api, "uploadTerminalAttachment").mockResolvedValue({ path: "/x.png" });
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [] } });
    act(() => { paneHost(container).dispatchEvent(event); });
    expect(upload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("menyeret berkas ke pane mengunggahnya", async () => {
    const upload = vi.spyOn(api, "uploadTerminalAttachment")
      .mockResolvedValue({ path: "/tmp/seret.webp" });
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });

    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"], files: [] } });
    act(() => { paneHost(container).dispatchEvent(over); });
    expect(over.defaultPrevented).toBe(true);   // tanpa ini browser menolak drop-nya

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["Files"], files: [imageFile("image/webp")] },
    });
    act(() => { paneHost(container).dispatchEvent(drop); });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(sockets[0]?.sent)
      .toContain(JSON.stringify({ t: "in", d: "/tmp/seret.webp " })));
  });

  // Diam adalah cacatnya (audit SPEC-800 §3); diam tak boleh jadi bagian perbaikannya.
  it("menulis baris merah ke pane saat unggahan ditolak", async () => {
    vi.spyOn(api, "uploadTerminalAttachment")
      .mockRejectedValue(new Error("tipe berkas tak didukung"));
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [imageFile()] } });
    act(() => { paneHost(container).dispatchEvent(event); });
    await vi.waitFor(() => expect(xt.written.join("")).toContain("tipe berkas tak didukung"));
    expect(xt.written.join("")).toContain("\x1b[31m");
  });
});
```

- [x] **Step 2: Jalankan, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/terminal-pane.test.tsx
```

Expected: FAIL — `api.uploadTerminalAttachment` tak ada (spyOn melempar).

- [x] **Step 3: Tambah metode client**

Di `src/src/api/client.ts`, tambahkan di atas `export const api = {` :

```ts
// SPEC-816 · multipart punya fetch sendiri: `j()` memaksa `content-type: application/json`, dan
// header itu MENGHAPUS boundary yang dihasilkan FormData → server tak bisa mem-parse body-nya.
async function jUpload<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, detail?.error ?? `POST ${url} → ${res.status}`, detail);
  }
  return res.json() as Promise<T>;
}
```

dan di dalam objek `api`, tepat di bawah `issueWsTicket`:

```ts
  uploadTerminalAttachment: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file, file.name || "lampiran");
    return jUpload<{ path: string }>(paths.terminalAttachments(sessionId), form);
  },
```

- [x] **Step 4: Pasang listener di pane**

Di `src/src/screens/TerminalPane.tsx`: tambahkan `imageFilesFrom, hasImageDrag` ke impor dari `./terminal-clipboard`, lalu sisipkan tepat sebelum blok `el.addEventListener("touchstart", ...)`:

```ts
    // SPEC-816 · lampiran gambar. Yang bisa dikirim ke PTY hanyalah teks, jadi berkasnya diunggah
    // lebih dulu dan yang masuk ke prompt adalah PATH-nya — agen membacanya sendiri dengan Read.
    // Ini juga yang membuatnya lepas dari clipboard mesin server: umur sesi tak lagi jadi variabel.
    const attach = async (files: File[]) => {
      for (const file of files) {
        try {
          const { path } = await api.uploadTerminalAttachment(sessionId, file);
          // Spasi, bukan Enter: operator melanjutkan mengetik kalimatnya di sebelah path.
          // sendInput menampung ke `pendingInput` bila socket sedang menyambung ulang.
          sendInput(`${path} `);
        } catch (e) {
          term.write(`\r\n\x1b[31mlampiran gagal: ${(e as Error).message}\x1b[0m\r\n`);
        }
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFilesFrom(event.clipboardData);
      if (!files.length) return;      // teks polos tetap milik jalur lama
      event.preventDefault();
      void attach(files as File[]);
    };
    const onDragOver = (event: DragEvent) => {
      if (hasImageDrag(event.dataTransfer)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      const files = imageFilesFrom(event.dataTransfer);
      if (!files.length) return;
      event.preventDefault();
      void attach(files as File[]);
    };
    el.addEventListener("paste", onPaste);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
```

dan di fungsi cleanup (di sebelah `el.removeEventListener("touchstart", ...)`):

```ts
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
```

- [x] **Step 5: Jalankan, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/terminal-pane.test.tsx src/test/terminal-clipboard.test.ts
```

Expected: PASS — test SPEC-511/771/800 yang sudah ada tetap hijau, plus 4 test baru.

- [x] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/TerminalPane.tsx src/test/terminal-pane.test.tsx
git commit -m "feat(spec-816): pane mengunggah gambar & mengetik path-nya"
```

---

### Task 7: Cabut pembajakan Cmd+V — **hanya bila Task 1 membuktikan event `paste` tertelan**

Bila catatan Task 1 berbunyi `__paste >= 1`, tandai seluruh langkah task ini "tak berlaku" dan lanjut ke Task 8.

**Files:**
- Modify: `src/src/screens/terminal-clipboard.ts`
- Modify: `src/src/screens/TerminalPane.tsx`
- Test: `src/test/terminal-clipboard.test.ts`, `src/test/terminal-pane.test.tsx`

**Interfaces:**
- Consumes: `clipboardIntent` (bentuk sekarang).
- Produces: `clipboardIntent` yang **tak pernah** mengembalikan `"paste"`; tipenya menyempit jadi `"copy" | null`.

- [~] **(tak berlaku — lihat Catatan hasil Task 1) Step 1: Ubah test yang menyandera perilaku lama**

Di `src/test/terminal-clipboard.test.ts`, ganti dua test paste yang ada dengan:

```ts
  // SPEC-816 · paste TIDAK lagi dibajak di keydown: pembajakan itu memanggil preventDefault dan
  // karenanya menelan event `paste` native, satu-satunya jalur yang membawa berkas gambar.
  // Bonus: melepas ketergantungan pada izin navigator.clipboard.readText (Safari & konteks
  // non-secure menuntut prompt atau gagal diam-diam). Jalur copy tak disentuh — writeText tak
  // punya masalah itu dan SPEC-289 berdiri di atasnya.
  it("Cmd+V dilewatkan ke terminal, bukan dibajak", () => {
    expect(clipboardIntent(key({ key: "v", metaKey: true }), false)).toBeNull();
    expect(clipboardIntent(key({ key: "V", ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });
```

Dan di `src/test/terminal-pane.test.tsx`, tambahkan:

```ts
  it("paste teks native sampai ke PTY tanpa jalur readText", async () => {
    const { container } = render(<TerminalPane sessionId="sesi-1" onExit={() => { }} />);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    act(() => { sockets[0]?.onopen?.(); });
    // keydown Cmd+V tak boleh lagi dibajak: handler mengembalikan true → xterm meneruskannya.
    expect(xt.keyHandler?.(keydown({ key: "v", metaKey: true }))).toBe(true);
  });
```

- [~] **(tak berlaku — lihat Catatan hasil Task 1) Step 2: Jalankan, pastikan GAGAL**

```bash
env -u NODE_ENV pnpm vitest --run src/test/terminal-clipboard.test.ts src/test/terminal-pane.test.tsx
```

Expected: FAIL — `clipboardIntent` masih mengembalikan `"paste"`.

- [~] **(tak berlaku — lihat Catatan hasil Task 1) Step 3: Implementasi**

Di `src/src/screens/terminal-clipboard.ts`:

```ts
export type ClipboardIntent = "copy" | null;
```

dan di dalam `clipboardIntent`, hapus baris `if (k === "v") return "paste";`, ganti dengan komentar:

```ts
  // SPEC-816 · `v` sengaja TIDAK dibajak: mengembalikan false di sini memanggil preventDefault dan
  // menelan event `paste` native, satu-satunya jalur yang membawa berkas gambar. Teks maupun
  // gambar sama-sama ditangani listener `paste` di TerminalPane.
```

Di `src/src/screens/TerminalPane.tsx`, hapus cabang paste dari `attachCustomKeyEventHandler`:

```ts
    term.attachCustomKeyEventHandler((e) => {
      if (clipboardIntent(e, term.hasSelection()) === "copy") {
        void navigator.clipboard?.writeText(term.getSelection());
        return false;
      }
      return true;
    });
```

- [~] **(tak berlaku — lihat Catatan hasil Task 1) Step 4: Jalankan, pastikan LULUS**

```bash
env -u NODE_ENV pnpm vitest --run src/test/terminal-clipboard.test.ts src/test/terminal-pane.test.tsx
```

Expected: PASS.

- [~] **(tak berlaku — lihat Catatan hasil Task 1) Step 5: Commit**

```bash
git add src/src/screens/terminal-clipboard.ts src/src/screens/TerminalPane.tsx \
        src/test/terminal-clipboard.test.ts src/test/terminal-pane.test.tsx
git commit -m "fix(spec-816): lepas pembajakan Cmd+V yang menelan event paste"
```

---

### Task 8: Verifikasi live + docs

**Files:**
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/architecture/stack.md`
- Modify: `internal/docs/README.md`

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: —

- [x] **Step 1: Boot server & buat sesi tmux palsu**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
env -u NODE_ENV -u DATABASE_URL pnpm dev    # biarkan jalan di jendela lain
tmux -L hanoman -f /dev/null new-session -d -s hanoman-live816 -c /tmp 'sh' \
  \; set-option -t hanoman-live816 @hanoman_project hanoman \
  \; set-option -t hanoman-live816 @hanoman_cwd /tmp
```

Jangan `POST /terminal/sessions` — ia men-spawn `claude` sungguhan.

- [x] **Step 2: Unggah png sungguhan lewat curl**

```bash
printf '\x89PNG\r\n\x1a\nhalo' > /tmp/spec816.png
curl -sS -X POST -F "file=@/tmp/spec816.png;type=image/png" \
  http://localhost:8787/api/terminal/sessions/live816/attachments
```

Expected: `{"path":"/Users/denameidina/.hanoman/uploads/terminal/live816/<uuid>.png"}`, dan berkas
di path itu identik dengan `/tmp/spec816.png`.

- [x] **Step 3: Buktikan penolakannya nyata**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -F "file=@/tmp/spec816.png;type=image/gif" \
  http://localhost:8787/api/terminal/sessions/live816/attachments      # 415
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -F "file=@/tmp/spec816.png;type=image/png" \
  http://localhost:8787/api/terminal/sessions/tak-ada/attachments      # 404
```

- [x] **Step 4: Buktikan sapuannya**

```bash
curl -sS -X DELETE http://localhost:8787/api/terminal/sessions/live816
sleep 1
ls ~/.hanoman/uploads/terminal/live816 2>&1     # harus "No such file or directory"
```

- [ ] **Step 5: Paste sungguhan di browser** — MENUNGGU OPERATOR (butuh clipboard manusia)

Salin sebuah screenshot ke clipboard, buka dashboard, tempel di pane sesi. Path muncul di prompt
dengan spasi di belakangnya dan **tanpa** baris tereksekusi. Ketik `baca gambar ini` di
belakangnya lalu Enter — agen membacanya. Ini satu-satunya langkah yang menguji jalur clipboard
sungguhan; test jsdom mensimulasikan event, bukan browser.

- [x] **Step 6: Tulis docs**

`internal/docs/architecture/api-contract.md` — endpoint, field `file`, respons `{ path }`, dan
kode 400/404/413/415. `internal/docs/architecture/stack.md` — di mana berkas lampiran hidup
(`HANOMAN_UPLOAD_DIR/terminal/<sessionId>/`), siapa yang menyapunya (`killSession`, bukan
`detachAll`), dan mengapa bentuknya path alih-alih gambar inline. `internal/docs/README.md` —
satu baris index menunjuk keduanya, mengikuti pola entri SPEC-812.

- [x] **Step 7: Jalankan seluruh test yang tersentuh**

```bash
env -u NODE_ENV -u DATABASE_URL TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism \
  server/test/session-uploads.test.ts server/test/terminal-attachments.route.test.ts \
  server/test/terminal.route.test.ts server/test/pty.test.ts
env -u NODE_ENV pnpm vitest --run src/test/terminal-pane.test.tsx src/test/terminal-clipboard.test.ts
```

Expected: seluruhnya PASS. Suite yang gagal ramai dengan 404/P2022 hampir selalu isolasi DB
(`TEST_DATABASE_URL` terlupa), bukan regresi.

- [x] **Step 8: Bersihkan & commit**

```bash
tmux -L hanoman kill-session -t hanoman-live816 2>/dev/null
rm -f /tmp/spec816.png
git add internal/docs
git commit -m "docs(spec-816): jalur lampiran gambar sesi terminal"
```

---

## Catatan risiko

- **`part.file.truncated` bergantung pada `@fastify/multipart` v9.** Bila field itu `undefined`
  di versi terpasang, gerbang 413 diam-diam lolos dan berkas rusak tersimpan. Test "menolak
  berkas melebihi 5 MB" (Task 4) adalah yang menangkapnya — kalau ia gagal, periksa
  `part.file.bytesRead > 5 * 1024 * 1024` sebagai pengganti, jangan longgarkan test-nya.
- **Sesi tmux sisa dari run sebelumnya** membuat test pty gagal palsu. Socket `hanoman-test`
  dipakai bersama semua worktree.
- **Umur sesi tak lagi jadi variabel setelah ini**, tetapi sesi `claude` CLI langsung di iTerm
  **tetap** terkena masalah aslinya — itu di luar jangkauan repo (lihat Non-goals di spec).
