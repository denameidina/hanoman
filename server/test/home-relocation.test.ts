// SPEC-846 · janji runbook: menyalin `$HANOMAN_HOME` ke host lain memulihkan DB DAN byte yang
// ditunjuk metadata. Yang dikunci di sini adalah bagian byte-nya — transkrip & lampiran ikut
// berpindah, dan pembacanya menurunkan lokasi saat DIPANGGIL, bukan saat modul dimuat.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTranscript, readTranscript } from "../src/services/transcript-store";
import { saveUpload, readUpload } from "../src/services/uploads";

let asal: string;
let pulih: string;
let sebelum: Record<string, string | undefined>;

beforeEach(() => {
  sebelum = {
    HANOMAN_HOME: process.env.HANOMAN_HOME,
    HANOMAN_TRANSCRIPT_DIR: process.env.HANOMAN_TRANSCRIPT_DIR,
    HANOMAN_UPLOAD_DIR: process.env.HANOMAN_UPLOAD_DIR,
  };
  delete process.env.HANOMAN_TRANSCRIPT_DIR;
  delete process.env.HANOMAN_UPLOAD_DIR;
  asal = mkdtempSync(join(tmpdir(), "hanoman-home-asal-"));
  pulih = mkdtempSync(join(tmpdir(), "hanoman-home-pulih-"));
  process.env.HANOMAN_HOME = asal;
});
afterEach(() => {
  for (const [k, v] of Object.entries(sebelum)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(asal, { recursive: true, force: true });
  rmSync(pulih, { recursive: true, force: true });
});

describe("restore $HANOMAN_HOME di lokasi lain (SPEC-846)", () => {
  it("transkrip & lampiran ikut berpindah dan terbaca kembali", async () => {
    const { key } = await saveTranscript("baris terakhir sesi\n");
    const { storageKey } = await saveUpload(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png");

    // "Backup lalu restore di host lain": satu direktori disalin, env menunjuk salinan itu.
    cpSync(asal, pulih, { recursive: true });
    process.env.HANOMAN_HOME = pulih;

    expect(await readTranscript(key)).toBe("baris terakhir sesi\n");
    expect(await readUpload(storageKey)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("home lama yang dibuang membuat byte tak terbaca — buktinya memang byte itu yang dipulihkan", async () => {
    const { key } = await saveTranscript("isi");
    rmSync(asal, { recursive: true, force: true });
    process.env.HANOMAN_HOME = pulih;
    expect(await readTranscript(key)).toBeNull();
  });
});
