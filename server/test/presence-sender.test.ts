import { describe, it, expect } from "vitest";
import { PRESENCE_HEARTBEAT_MS, PRESENCE_PROTOCOL, type PresenceSession } from "@hanoman/shared";
import { createPresenceSender } from "../src/services/presence/sender";

const T0 = 1_000_000;
const s = (over: Partial<PresenceSession> = {}): PresenceSession => ({
  sessionId: "spec-919", projectId: "hanoman", agent: "claude",
  status: "working", startedAt: "2026-08-24T00:00:00.000Z", ...over,
});

function harness(build: () => Promise<PresenceSession[]>) {
  const sent: string[] = [];
  return { sent, sender: createPresenceSender({ send: (j) => sent.push(j), build }) };
}

describe("pengirim presence", () => {
  it("mengirim pada tick pertama", async () => {
    const h = harness(async () => [s()]);
    await h.sender.tick(T0);
    expect(h.sent).toHaveLength(1);
    expect(JSON.parse(h.sent[0]!)).toMatchObject({ t: "presence", v: PRESENCE_PROTOCOL });
  });

  it("diam saat isinya tak berubah dan denyut belum jatuh tempo", async () => {
    const h = harness(async () => [s()]);
    await h.sender.tick(T0);
    await h.sender.tick(T0 + 3_000);
    await h.sender.tick(T0 + 6_000);
    expect(h.sent).toHaveLength(1);
  });

  it("mengirim saat status berubah", async () => {
    let status: PresenceSession["status"] = "working";
    const h = harness(async () => [s({ status })]);
    await h.sender.tick(T0);
    status = "waiting";
    await h.sender.tick(T0 + 3_000);
    expect(h.sent).toHaveLength(2);
  });

  it("mengirim saat sesi hilang", async () => {
    let list = [s()];
    const h = harness(async () => list);
    await h.sender.tick(T0);
    list = [];
    await h.sender.tick(T0 + 3_000);
    expect(h.sent).toHaveLength(2);
    expect(JSON.parse(h.sent[1]!).sessions).toEqual([]);
  });

  it("denyut mengirim ulang walau isinya sama", async () => {
    const h = harness(async () => [s()]);
    await h.sender.tick(T0);
    await h.sender.tick(T0 + PRESENCE_HEARTBEAT_MS);
    expect(h.sent).toHaveLength(2);
  });

  // Kegagalan snapshot tak boleh merambat ke socket sync.
  it("build yang melempar tidak melempar keluar dan tidak mengirim apa-apa", async () => {
    const h = harness(async () => { throw new Error("tmux mati"); });
    await expect(h.sender.tick(T0)).resolves.toBeUndefined();
    expect(h.sent).toHaveLength(0);
  });

  it("send yang melempar ditelan", async () => {
    const sender = createPresenceSender({
      send: () => { throw new Error("socket tertutup"); },
      build: async () => [s()],
    });
    await expect(sender.tick(T0)).resolves.toBeUndefined();
  });
});
