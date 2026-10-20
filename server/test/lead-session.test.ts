import { describe, it, expect, beforeEach } from "vitest";
import {
  leadSessionId, isLeadSessionId, ensureLeadSession, rotateLeadSession, leadSessionFailures,
  noteDelivered, __resetLeadSessions, type LeadSessionDeps,
} from "../src/services/lead/lead-session";
import { noteHumanInput, humanActiveAt, __resetHumanInput } from "../src/services/lead/human-input";
import { leadSystemPrompt, formatBatch } from "../src/services/lead/lead-prompt";
import { sessionKind } from "../src/services/pty";

// ADR-0228 · pane lead per proyek.

beforeEach(() => { __resetLeadSessions(); __resetHumanInput(); });
type Rec = { created: { id: string; cwd: string; prompt: string; env: Record<string, string> }[]; killed: string[] };
const deps = (over: Partial<LeadSessionDeps> = {}): LeadSessionDeps & Rec => {
  const rec: Rec = { created: [], killed: [] };
  return {
    ...rec,
    active: async () => true,
    live: async () => false,
    repoDir: async () => "/repo",
    prepareWorktree: (_r, id) => `/repo/.worktrees/${id}`,
    agent: async () => ({ agent: "claude", model: "m", effort: "high" }),
    create: (id, _p, cwd, o) => { rec.created.push({ id, cwd, prompt: o.prompt, env: o.env }); },
    kill: (id) => { rec.killed.push(id); return true; },
    project: async () => ({ name: "Proyek P", targetBranch: "develop" }),
    now: () => 1_000_000,
    ...over,
  };
};

describe("sesi lead", () => {
  it("id deterministik & dikenali", () => {
    expect(leadSessionId("erp-tumbuh-ai")).toBe("lead-erp-tumbuh-ai");
    expect(leadSessionId("raciklaba.id")).toBe("lead-raciklaba_id");
    expect(isLeadSessionId("lead-x")).toBe(true);
    expect(isLeadSessionId("spec-1")).toBe(false);
  });
  it("membuka pane di worktree baca dengan prompt sistem & URL pane", async () => {
    const d = deps();
    expect(await ensureLeadSession("p", d)).toEqual({ id: "lead-p", started: true });
    expect(d.created).toHaveLength(1);
    expect(d.created[0]!.cwd).toBe("/repo/.worktrees/lead-p");
    expect(d.created[0]!.prompt).toContain("develop");
    expect(d.created[0]!.env.HANOMAN_LEAD_URL).toMatch(/\/api\/lead-pane$/);
  });
  it("pane hidup tak dibuka ulang", async () => {
    const d = deps({ live: async () => true });
    expect(await ensureLeadSession("p", d)).toEqual({ id: "lead-p", started: false });
    expect(d.created).toEqual([]);
  });
  it("lead tak aktif atau proyek belum di-bind → null, tak membuka apa pun", async () => {
    const off = deps({ active: async () => false });
    expect(await ensureLeadSession("p", off)).toBeNull();
    const unbound = deps({ repoDir: async () => null });
    expect(await ensureLeadSession("p", unbound)).toBeNull();
    expect([...off.created, ...unbound.created]).toEqual([]);
  });
  it("backoff 1/2/5 menit setelah gagal lahir, dan penghitungnya naik", async () => {
    let t = 1_000_000;
    const d = deps({ create: () => { throw new Error("tmux"); }, now: () => t });
    await expect(ensureLeadSession("p", d)).rejects.toThrow("tmux");
    expect(leadSessionFailures("p")).toBe(1);
    t += 30_000;
    expect(await ensureLeadSession("p", d)).toBeNull();
    t += 31_000;
    await expect(ensureLeadSession("p", d)).rejects.toThrow("tmux");
    expect(leadSessionFailures("p")).toBe(2);
  });
  it("rotasi menghentikan pane lama lalu membuka yang baru, dan penghitung antar direset", async () => {
    const d = deps();
    noteDelivered("p", 41);
    await rotateLeadSession("p", d);
    expect(d.killed).toEqual(["lead-p"]);
    expect(d.created).toHaveLength(1);
    expect(noteDelivered("p", 0)).toBe(0);
  });
  it("mencatat input manusia", () => {
    noteHumanInput("lead-p", 5);
    expect(humanActiveAt("lead-p")).toBe(5);
    expect(humanActiveAt("lead-q")).toBeNull();
  });
  it("kind sesi lead", () => {
    expect(sessionKind({ id: "lead-p" }, "p", "/repo/.worktrees/lead-p")).toBe("lead");
  });
});

describe("prompt sesi lead", () => {
  it("prompt sistem menjelaskan cara memeriksa & bertindak", () => {
    const s = leadSystemPrompt({ projectId: "p", projectName: "P", targetBranch: "main" });
    expect(s).toContain("$HANOMAN_LEAD_URL/brief");
    expect(s).toContain("$HANOMAN_LEAD_URL/act");
    expect(s).toContain("$HANOMAN_EVENT_TOKEN");
    expect(s).toContain("eventId");
  });
  it("batch memuat id event, prompt tiap event, dan situasi", () => {
    const txt = formatBatch([
      { id: "e1", kind: "ask", question: "q1", payload: { prompt: "PROMPT-1" } },
      { id: "e2", kind: "pulse", question: "q2", payload: null },
    ], "BRIEF");
    expect(txt).toContain("eventId=e1");
    expect(txt).toContain("PROMPT-1");
    expect(txt).toContain("eventId=e2");
    expect(txt).toContain("q2");
    expect(txt).toContain("BRIEF");
  });
});
