import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { SYNCED, isEntity } from "../src/services/sync";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const clean = async () => { await prisma.logEntry.deleteMany(); await prisma.logCursor.deleteMany(); };
beforeEach(clean);
afterAll(clean);

describe("skema log terpusat (SPEC-1215 · ADR-0166)", () => {
  it("LogEntry & LogCursor ada, seq BigInt, tanpa kolom version (LOCAL-only)", () => {
    for (const name of ["LogEntry", "LogCursor"]) {
      const m = models.get(name);
      expect(m, name).toBeDefined();
      const fields = new Map(m!.fields.map((f) => [f.name, f]));
      expect(fields.get("seq")!.type, `${name}.seq`).toBe("BigInt");
      expect(fields.has("version"), `${name}.version`).toBe(false);
    }
  });

  it("bukan entitas sync, tapi terdaftar di PG_ORDER (jalur 42P01, keputusan Plan P1)", () => {
    for (const e of ["logEntry", "logCursor"]) {
      expect(SYNCED as readonly string[]).not.toContain(e);
      expect(isEntity(e)).toBe(false);
    }
    expect(PG_ORDER).toContain("LogEntry");
    expect(PG_ORDER).toContain("LogCursor");
  });

  it("unique (deviceId, lane, seq) menolak baris kembar — jaring pengaman dedup", async () => {
    const row = {
      deviceId: "local", lane: "event", seq: BigInt("1757000000000000"), ts: new Date(),
      level: "info", kind: "session.start", msg: "x", bytes: 1,
    };
    await prisma.logEntry.create({ data: row });
    await expect(prisma.logEntry.create({ data: row })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.logEntry.create({ data: { ...row, lane: "server" } })).resolves.toBeTruthy();
  });

  it("LogCursor ber-PK (deviceId, lane)", async () => {
    await prisma.logCursor.create({ data: { deviceId: "local", lane: "event", seq: BigInt(5) } });
    const up = await prisma.logCursor.upsert({
      where: { deviceId_lane: { deviceId: "local", lane: "event" } },
      create: { deviceId: "local", lane: "event", seq: BigInt(9) }, update: { seq: BigInt(9) },
    });
    expect(up.seq).toBe(BigInt(9));
  });
});
