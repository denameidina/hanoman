// SPEC-816 · lampiran gambar sesi terminal. Kepemilikan berkas dicatat SUBDIREKTORI per sesi —
// tanpa tabel, tanpa migration.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { saveSessionUpload, dropSessionUploads, sessionUploadDir, uploadDir } from "../src/services/uploads";
import { killSession, detachAll, killAll, createSession } from "../src/services/pty";

// Fixture yang sama dipakai terminal.route.test.ts: /bin/cat mati karena
// --dangerously-skip-permissions ilegal baginya.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

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

// SPEC-846 · cermin transcript-store: tanpa override, lampiran hidup di bawah `$HANOMAN_HOME`
// supaya backup satu direktori benar-benar memuat byte yang ditunjuk metadata DB.
describe("uploadDir turun dari HANOMAN_HOME (SPEC-846)", () => {
  let home = "";
  beforeEach(() => {
    delete process.env.HANOMAN_UPLOAD_DIR;
    home = mkdtempSync(join(tmpdir(), "hanoman-home-u846-"));
    process.env.HANOMAN_HOME = home;
  });
  afterEach(() => {
    delete process.env.HANOMAN_HOME;
    process.env.HANOMAN_UPLOAD_DIR = dir;
    rmSync(home, { recursive: true, force: true });
  });

  it("default = $HANOMAN_HOME/uploads, lepas dari cwd", () => {
    expect(uploadDir()).toBe(join(home, "uploads"));
  });

  it("override berisi spasi diabaikan, bukan menjadi direktori di bawah cwd", () => {
    process.env.HANOMAN_UPLOAD_DIR = "  ";
    expect(uploadDir()).toBe(join(home, "uploads"));
  });
});
