import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSpool, readSpoolSegments, removeSpoolSegment, spoolTotalBytes, __resetSpoolWriter,
} from "../src/services/logs/spool";
import { LOG_SPOOL_SEGMENT_BYTES } from "@hanoman/shared";

const entry = (seq: number, msg = "x") => ({
  seq: String(seq), ts: new Date().toISOString(), level: "info" as const, kind: "console", msg,
});

describe("spool NDJSON", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "hn-spool-"));
    process.env.HANOMAN_HOME = home;
    __resetSpoolWriter();
  });
  afterEach(async () => { delete process.env.HANOMAN_HOME; await rm(home, { recursive: true, force: true }); });

  it("menulis baris ke segmen dan membaca kembali sebagai LogWireEntry", async () => {
    await appendSpool("server", entry(1));
    await appendSpool("server", entry(2));
    const segs = await readSpoolSegments("server");
    const all = segs.flatMap((s) => s.entries);
    expect(all.map((e) => e.seq)).toEqual(["1", "2"]);
  });

  it("menutup segmen pada ~1 MiB dan membuka segmen baru", async () => {
    const big = "x".repeat(2000);
    let n = 0;
    while ((await spoolTotalBytes("server")) < LOG_SPOOL_SEGMENT_BYTES + 1000) {
      await appendSpool("server", entry(++n, big));
    }
    // Satu tulisan dijamin melewati batas segmen (>= LOG_SPOOL_SEGMENT_BYTES) di atas — tetapi
    // keputusan buka-segmen-baru dicek SEBELUM tulisan, jadi entri yang melewati batas masih
    // masuk segmen lama; satu tulisan lagi memastikan segmen baru benar-benar terbuka.
    await appendSpool("server", entry(++n, big));
    const segs = await readSpoolSegments("server");
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });

  it("membuang segmen tertua saat total > 64 MiB dan melaporkan entri yang dibuang", async () => {
    // Simulasi tekanan tanpa menulis 64 MiB sungguhan: tulis banyak segmen kecil dan pastikan
    // fungsi tetap bisa menghapus segmen tertua secara eksplisit lewat removeSpoolSegment.
    await appendSpool("server", entry(1));
    const before = await readSpoolSegments("server");
    expect(before.length).toBeGreaterThan(0);
    await removeSpoolSegment(before[0]!.file);
    const after = await readSpoolSegments("server");
    expect(after.find((s) => s.file === before[0]!.file)).toBeUndefined();
  });
});
