import { describe, it, expect } from "vitest";
import { prisma } from "../src/db";

// SPEC-857 · ADR-0131 §4 · `journal_mode=delete` adalah lapis kedua insiden P1008: di mode itu tiap
// tulisan mengambil kunci eksklusif atas SELURUH berkas dan memblokir semua pembaca, jadi feed yang
// membengkak mencekik `GET /specs` sampai timeout. Keputusannya dulu dijalankan dengan tangan pada
// satu berkas di satu host; test ini yang membuatnya berlaku untuk setiap DB yang dibuka hanoman.
describe("mode jurnal SQLite (SPEC-857)", () => {
  it("membuka DB dalam WAL, bukan rollback journal", async () => {
    const rows = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
    expect(rows[0]?.journal_mode?.toLowerCase()).toBe("wal");
  });
});
