import { describe, it, expect } from "vitest";
import {
  activationOf, maxTurnsOf, runtimeOf, timeoutSecondsOf, workspacePolicyOf,
  zCreateCustomAgent, zUpdateCustomAgent,
} from "./index";

const base = { name: "rev", description: "d", instructions: "i" };

describe("zCreateCustomAgent · runtime", () => {
  it("menerima claude & codex", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "claude" }).success).toBe(true);
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "codex" }).success).toBe(true);
  });
  it("menerima null (= ikut sesi induk) dan absen", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: null }).success).toBe(true);
    expect(zCreateCustomAgent.safeParse(base).success).toBe(true);
  });
  it("MENOLAK nilai di luar AGENT_RUNTIMES", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, runtime: "gemini" }).success).toBe(false);
  });
});

describe("zUpdateCustomAgent · runtime", () => {
  it("ikut terbawa sebagai field opsional", () => {
    expect(zUpdateCustomAgent.safeParse({ runtime: "codex" }).success).toBe(true);
    expect(zUpdateCustomAgent.safeParse({ runtime: "gemini" }).success).toBe(false);
  });
});

describe("execution profile", () => {
  it("accepts the complete profile and keeps it on updates", () => {
    const profile = {
      activation: "smart",
      effort: "high",
      workspacePolicy: "read-only",
      maxTurns: 40,
      timeoutSeconds: 900,
    } as const;
    expect(zCreateCustomAgent.parse({ ...base, ...profile })).toMatchObject(profile);
    expect(zUpdateCustomAgent.parse(profile)).toEqual(profile);
  });

  it.each([
    { maxTurns: 0 },
    { maxTurns: 201 },
    { maxTurns: 1.5 },
    { timeoutSeconds: 29 },
    { timeoutSeconds: 3601 },
    { timeoutSeconds: 30.5 },
  ])("rejects an out-of-range execution limit: %j", (profile) => {
    expect(zCreateCustomAgent.safeParse({ ...base, ...profile }).success).toBe(false);
  });

  it("rejects isolated worktrees for Codex definitions", () => {
    expect(zCreateCustomAgent.safeParse({
      ...base, runtime: "codex", workspacePolicy: "isolated-worktree",
    }).success).toBe(false);
    expect(zUpdateCustomAgent.safeParse({
      runtime: "codex", workspacePolicy: "isolated-worktree",
    }).success).toBe(false);
  });

  it("normalizes foreign synced values to safe legacy defaults", () => {
    expect(activationOf("sometimes")).toBe("always");
    expect(workspacePolicyOf("write-anywhere")).toBe("inherit");
    expect(maxTurnsOf(-1)).toBeNull();
    expect(timeoutSecondsOf("900")).toBeNull();
  });
});

// Kolom ini menyeberang sync dari client versi lain — nilai asing tak boleh MENYARING HABIS
// seluruh roster, jadi ia dibaca defensif seperti kolom Json lain (ADR-0101 keputusan 1).
describe("runtimeOf", () => {
  it("mengembalikan nilai sah apa adanya", () => {
    expect(runtimeOf("claude")).toBe("claude");
    expect(runtimeOf("codex")).toBe("codex");
  });
  it("nilai asing / kosong → null (warisi), bukan dibuang", () => {
    expect(runtimeOf("gemini")).toBeNull();
    expect(runtimeOf(null)).toBeNull();
    expect(runtimeOf(undefined)).toBeNull();
    expect(runtimeOf(7)).toBeNull();
  });
});
