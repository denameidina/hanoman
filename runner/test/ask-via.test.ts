import { describe, it, expect } from "vitest";
import { ORCHESTRATION_DEFAULTS, resolvePhasePlan } from "@hanoman/shared";
import {
  continuePrompt, cronPrompt, orchestratorClause, resumePrompt, startBreakdownPrompt, startGoalPrompt,
  startPrdPrompt, startProjectPrompt, startPrompt, startScaffoldPrompt,
} from "../src/prompt";
import { agentDelegationClause } from "../src/custom-agents";
import { TEXT_ASK_ROUTE, textAsk } from "../src/ask-via";
import { EVENT_HOOK_COMMAND, guardSettings } from "../src/settings";
import type { Flow } from "../src/types";

// ADR-0231 · sesi claude yang lahir saat lead menjawab project-nya bertanya lewat teks biasa.

const plan = (flow: Flow) => resolvePhasePlan({
  flow, runtime: "claude", orchestration: ORCHESTRATION_DEFAULTS,
  orchestrator: { model: "claude-opus-5", effort: "high" }, nativeAgents: true,
})!;
const spec = { id: "SPEC-9", title: "T", source: "brief", priority: "sedang", objective: "O", payload: { a: 1 } };
const goal = { ...spec, source: "goal", payload: { goal: "G" } };
const project = { id: "p1", name: "P1", desc: "d", stack: "ts" };
const resume = { recorded: ["Audit"], worktreeKept: true };
const custom = [{ name: "scout", description: "d", instructions: "i", tools: null, model: null, mentions: [] }];

const outputs: Record<string, string> = {
  start: startPrompt("feature", spec, "b"),
  startFull: startPrompt("feature", spec, "b", "full-control"),
  resume: resumePrompt("qa", spec, "b", resume),
  continue: continuePrompt("feature", spec, "b"),
  goal: startGoalPrompt("goal", goal, "b"),
  reverse: startProjectPrompt("reverse", project, "r"),
  scaffold: startScaffoldPrompt(project, "s"),
  prd: startPrdPrompt(project, { title: "T", context: "c", outcome: "o", constraints: "k" }, "prd/t"),
  breakdown: startBreakdownPrompt(project, { title: "PRD", path: "docs/prd/p.md", content: "isi" }, "breakdown/p"),
  cron: cronPrompt(project, { name: "c", prompt: "periksa" }),
  orchestratorFeature: orchestratorClause(plan("feature")),
  orchestratorPrd: orchestratorClause(plan("prd")),
  relay: agentDelegationClause(custom, "claude"),
};

// Setiap kemunculan AskUserQuestion sesudah `textAsk` hanyalah larangannya.
const onlyForbidden = (s: string) => s.split("AskUserQuestion").length - 1
  === s.split("JANGAN memakai AskUserQuestion").length - 1;

describe("textAsk (ADR-0231)", () => {
  it.each(Object.keys(outputs))("%s: rute AskUserQuestion ditukar dengan rute teks", (key) => {
    const before = outputs[key]!;
    const after = textAsk(before);
    if (!before.includes("AskUserQuestion")) { expect(after).toBe(before); return; }
    expect(onlyForbidden(before)).toBe(false);
    expect(onlyForbidden(after)).toBe(true);
    expect(after).toContain("di terminal ini");
    expect(textAsk(after)).toBe(after);
  });
  it("klausa otonomi memakai rute teks lengkap dengan penentu jawaban", () => {
    expect(textAsk(outputs.start!)).toContain(TEXT_ASK_ROUTE);
    expect(TEXT_ASK_ROUTE).toContain("hanoman-lead bila aktif");
    expect(TEXT_ASK_ROUTE).toContain("diakhiri `?`");
  });
  it("orchestrator & relay custom agent tetap memakai SendMessage ke agen yang sama", () => {
    expect(textAsk(outputs.orchestratorFeature!)).toContain("SendMessage ke agent ID yang kamu catat");
    expect(textAsk(outputs.relay!)).toContain("SendMessage ke agent ID yang sama");
  });
  it("teks tanpa frasa rute-tanya tidak berubah", () => {
    expect(textAsk("halo AskUserQuestion bebas")).toBe("halo AskUserQuestion bebas");
  });
});

describe("guardSettings askText (ADR-0231)", () => {
  type Entry = { hooks: { command?: string }[] };
  const stopEvents = (s: ReturnType<typeof guardSettings>) =>
    (((s.hooks as Record<string, Entry[]>).Stop) ?? [])
      .flatMap((e) => e.hooks).filter((h) => h.command === EVENT_HOOK_COMMAND).length;
  it("askText memasang hook Stop ke jalur event; tanpa askText settings identik", () => {
    expect(stopEvents(guardSettings("/tmp/d", undefined, true, undefined, true))).toBe(1);
    expect(JSON.stringify(guardSettings("/tmp/d", undefined, true, undefined, false)))
      .toBe(JSON.stringify(guardSettings("/tmp/d", undefined, true, undefined)));
    expect(stopEvents(guardSettings("/tmp/d", undefined, true, undefined))).toBe(0);
    // tanpa eventHook tak ada jalur event sama sekali
    expect(stopEvents(guardSettings("/tmp/d", undefined, false, undefined, true))).toBe(0);
  });
});
