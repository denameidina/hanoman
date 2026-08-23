import { describe, it, expect, beforeEach } from "vitest";
import { attach, detach, __tick, __reset } from "../src/services/events";
import { intakeAsk, __resetAsks, type AskDeps } from "../src/services/lead/ask";
import { __resetDeciding } from "../src/services/lead/deciding";
import type { Client } from "../src/services/pty";

// SPEC-909 · ADR-0146 · pertanyaan sesi sampai ke pet lewat kanal siar yang SUDAH ada (ADR-0039).
// Tanpa koneksi WebSocket kedua, tanpa polling klien, tanpa tabel baru.

const EV = {
  source: "ask-tool" as const, askId: "t1", message: "",
  questions: [{ header: "Basis", question: "Basis data mana?", multiSelect: false,
    options: [{ label: "SQLite", description: "ringan" }] }],
};

/** Lead yang menggantung: tanya-nya tetap hidup di registry selama frame diperiksa. */
const hanging: AskDeps = {
  admit: async () => ({ ok: true }),
  answer: () => new Promise<never>(() => {}),
  reset: () => {},
  live: () => ["s1"],
  maxConcurrent: async () => 1,
  now: () => 1_000_000,
};

beforeEach(() => { __reset(); __resetAsks(); __resetDeciding(); });

describe("grup siar leadAsks", () => {
  it("membawa pertanyaan ASLI, dan frame lahir hanya saat daftarnya berubah", async () => {
    const sent: string[] = [];
    const client: Client = { send: (m) => sent.push(m), close: () => {} };
    await attach(client);
    const asksIn = () => sent.filter((m) => m.includes('"leadAsks"'));
    const before = asksIn().length;

    await intakeAsk({ sessionId: "s1", agent: "claude", projectId: "p1", event: EV }, hanging);
    await __tick();
    const after = asksIn();
    expect(after.length).toBeGreaterThan(before);
    const frame = JSON.parse(after[after.length - 1]!) as { asks: { questions: { question: string }[] }[] };
    expect(frame.asks[0]!.questions[0]!.question).toBe("Basis data mana?");

    // Dedup signature: daftar yang tak berubah tak melahirkan frame kedua.
    const n = asksIn().length;
    await __tick();
    expect(asksIn().length).toBe(n);
    detach(client);
  });

  it("klien baru menerima daftar tanya SEGERA, tak menunggu tick", async () => {
    await intakeAsk({ sessionId: "s1", agent: "claude", projectId: "p1", event: EV }, hanging);
    const sent: string[] = [];
    const client: Client = { send: (m) => sent.push(m), close: () => {} };
    await attach(client);
    expect(sent.some((m) => m.includes('"leadAsks"') && m.includes("Basis data mana?"))).toBe(true);
    detach(client);
  });
});
