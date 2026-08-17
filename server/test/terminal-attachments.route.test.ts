// SPEC-816 · endpoint lampiran gambar sesi terminal.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
