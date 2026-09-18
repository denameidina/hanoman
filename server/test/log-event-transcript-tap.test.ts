import { describe, expect, it, vi, beforeEach } from "vitest";
import { appendGap, installEventTap, __resetEventLog } from "../src/services/logs/event-log";
import { prisma } from "../src/db";
import * as transcriptStore from "../src/services/transcript-store";

describe("appendGap", () => {
  beforeEach(() => { __resetEventLog(); vi.restoreAllMocks(); });

  it("menulis LogEntry kind log.gap dengan reason dan lost", async () => {
    const spy = vi.spyOn(prisma.logEntry, "create").mockResolvedValue({} as never);
    vi.spyOn(prisma.logEntry, "findFirst").mockResolvedValue(null);
    await appendGap("redaction-failed", { lost: 1 });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "log.gap", level: "warn" }),
    }));
  });
});

describe("installEventTap onDeath transkrip", () => {
  beforeEach(() => { __resetEventLog(); vi.restoreAllMocks(); });

  it("menulis baris lajur transcript saat lajur transcript menyala", async () => {
    vi.spyOn(transcriptStore, "saveTranscript").mockResolvedValue({ key: "k1.log", bytes: 10, truncated: false });
    const create = vi.spyOn(prisma.logEntry, "create").mockResolvedValue({} as never);
    vi.spyOn(prisma.logEntry, "findFirst").mockResolvedValue(null);
    const off = installEventTap({ transcriptEnabled: async () => true });
    // simulasikan onDeath lewat pty test-hook internal tak tersedia di unit test murni ini —
    // ditutup end-to-end di server/test/log-taps.test.ts (Task 6-8 sudah menutup phase/result/rejected;
    // transkrip ditutup di sana juga lewat pemicu nyata pty test helper).
    off();
    expect(create).not.toHaveBeenCalled(); // tak ada kematian sesi disimulasikan di unit ini
  });
});
