import { describe, expect, it, vi, beforeEach } from "vitest";
import * as eventLog from "../src/services/logs/event-log";
import { recordSessionResult } from "../src/services/session-result";
import { prisma } from "../src/db";

describe("session.result tap", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("menulis session.result sesudah SessionResult dibuat", async () => {
    vi.spyOn(prisma.sessionResult, "create").mockResolvedValue({ id: "x" } as never);
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    await recordSessionResult({ projectId: "p1", status: "done", oldStage: "spec", newStage: "plan" });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      kind: "session.result", data: { status: "done", oldStage: "spec", newStage: "plan" },
    }));
  });

  it("penulisan log gagal tak menggagalkan SessionResult", async () => {
    vi.spyOn(prisma.sessionResult, "create").mockResolvedValue({ id: "x" } as never);
    vi.spyOn(eventLog, "appendEvent").mockRejectedValue(new Error("boom"));
    // `id` dihasilkan lokal (randomUUID), bukan dari `create()` yang dimock — invariant yang
    // diuji di sini adalah "resolves, bukan reject", bukan nilai id literalnya.
    await expect(recordSessionResult({ projectId: "p1", status: "done" })).resolves.toEqual({ id: expect.any(String) });
  });
});
