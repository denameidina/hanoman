import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, existsSync, chmodSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TRANSCRIPT_BYTES, transcriptDir, saveTranscript, readTranscript, deleteTranscript,
  listTranscripts,
} from "../src/services/transcript-store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hanoman-transcript-"));
  process.env.HANOMAN_TRANSCRIPT_DIR = dir;
});
afterAll(() => { delete process.env.HANOMAN_TRANSCRIPT_DIR; });

describe("transcript-store (SPEC-362)", () => {
  it("menyimpan lalu membaca kembali teks apa adanya", async () => {
    const { key, bytes, truncated } = await saveTranscript("halo\nsesi\n");
    expect(truncated).toBe(false);
    expect(bytes).toBe(Buffer.byteLength("halo\nsesi\n"));
    expect(await readTranscript(key)).toBe("halo\nsesi\n");
    expect(transcriptDir()).toBe(dir);
  });

  it("memangkas transkrip raksasa dengan MENYIMPAN EKOR + penanda", async () => {
    // Ekor adalah bagian yang berarti saat membaca ulang sesi; kepala yang dibuang.
    const huge = "x".repeat(MAX_TRANSCRIPT_BYTES) + "\nBARIS-TERAKHIR\n";
    const { key, bytes, truncated } = await saveTranscript(huge);
    expect(truncated).toBe(true);
    expect(bytes).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES + 200);
    const back = await readTranscript(key);
    expect(back).toContain("BARIS-TERAKHIR");
    expect(back).toContain("dipangkas");
  });

  it("kunci tak dikenal → null, bukan lempar", async () => {
    expect(await readTranscript("tidak-ada.log")).toBeNull();
  });

  it("kunci dengan path traversal di-basename-kan sebelum menyentuh disk", async () => {
    expect(await readTranscript("../../../etc/passwd")).toBeNull();
  });

  it("hapus membuang berkasnya; hapus dua kali tidak melempar", async () => {
    const { key } = await saveTranscript("isi");
    expect(existsSync(join(dir, key))).toBe(true);
    await deleteTranscript(key);
    expect(existsSync(join(dir, key))).toBe(false);
    await deleteTranscript(key);
  });

  // SPEC-845 · ADR-0125 · purge kini melaporkan kegagalan sebagian, jadi kegagalan filesystem
  // yang BUKAN "sudah tak ada" harus punya suara.
  it("hapus melempar untuk galat selain ENOENT", async () => {
    const { key } = await saveTranscript("isi");
    chmodSync(dir, 0o500);  // direktori read-only → unlink EACCES
    try {
      await expect(deleteTranscript(key)).rejects.toThrow();
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("listTranscripts memberi kunci + mtime tiap berkas, mengabaikan yang bukan transkrip", async () => {
    const { key } = await saveTranscript("isi");
    writeFileSync(join(dir, "catatan.txt"), "bukan transkrip");
    const lama = join(dir, "lama.log");
    writeFileSync(lama, "x");
    const jam = Date.now() / 1000 - 7200;
    utimesSync(lama, jam, jam);

    const rows = await listTranscripts();
    expect(rows.map((r) => r.key).sort()).toEqual([key, "lama.log"].sort());
    expect(rows.find((r) => r.key === "lama.log")!.mtimeMs).toBeLessThan(Date.now() - 3_600_000);
  });

  it("listTranscripts pada direktori yang belum ada → daftar kosong", async () => {
    process.env.HANOMAN_TRANSCRIPT_DIR = join(dir, "belum-ada");
    expect(await listTranscripts()).toEqual([]);
  });

  it("teks kosong tak menghasilkan berkas", async () => {
    const r = await saveTranscript("   \n  ");
    expect(r.key).toBe("");
    expect(r.bytes).toBe(0);
  });
});
