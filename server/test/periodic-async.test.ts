import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { seen, TAG } = vi.hoisted(() => ({ seen: { sync: [] as string[], reads: [] as string[] }, TAG: "hanoman-async-" }));

vi.mock("node:child_process", async (orig) => {
  const m = await orig<typeof import("node:child_process")>();
  return { ...m, execFileSync: ((...a: unknown[]) => { seen.sync.push(`exec:${String(a[0])}`); return (m.execFileSync as (...x: unknown[]) => unknown)(...a); }) as typeof m.execFileSync };
});
vi.mock("node:fs", async (orig) => {
  const m = await orig<typeof import("node:fs")>();
  const spy = <T extends (...a: never[]) => unknown>(name: string, f: T) => ((...a: unknown[]) => {
    if (String(a[0]).includes(TAG)) seen.sync.push(`${name}:${String(a[0])}`);
    return (f as (...x: unknown[]) => unknown)(...a);
  }) as unknown as T;
  return { ...m, readFileSync: spy("readFileSync", m.readFileSync), statSync: spy("statSync", m.statSync), readdirSync: spy("readdirSync", m.readdirSync) };
});
vi.mock("node:fs/promises", async (orig) => {
  const m = await orig<typeof import("node:fs/promises")>();
  return { ...m, readFile: ((...a: unknown[]) => { if (String(a[0]).includes(TAG)) seen.reads.push(String(a[0])); return (m.readFile as (...x: unknown[]) => unknown)(...a); }) as typeof m.readFile };
});

const panes = vi.hoisted(() => ({ list: [] as unknown[], fail: false }));
vi.mock("../src/services/presence/snapshot", async (orig) => {
  const m = await orig<typeof import("../src/services/presence/snapshot")>();
  return { ...m, listPanesShared: vi.fn(async () => { if (panes.fail) throw new Error("tmux mati"); return panes.list; }) };
});

import { liveOverlayTick, specsDigest } from "../src/services/live-specs";
import { sessionPhasesBySpecAsync, liveDecisionsAsync } from "../src/services/live-phases";
import { notificationsFeed } from "../src/services/notifications";
import { readPhasesAsync } from "../src/services/session-phases";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

let wt: string;
let phaseFile: string;
beforeEach(async () => {
  await resetDb();
  await makeProject();
  await makeSpec({ id: "SPEC-5", stage: "brainstorming" });
  wt = mkdtempSync(join(tmpdir(), TAG));
  phaseFile = join(wt, "phases");
  writeFileSync(phaseFile, "Objective done\nSpec done\n");
  mkdirSync(join(wt, "docs/superpowers/plans"), { recursive: true });
  writeFileSync(join(wt, "docs/superpowers/plans/2026-spec-5-x.md"), "- [x] a\n");
  const decisionFile = join(wt, "decision");
  writeFileSync(decisionFile, "1\n");
  panes.fail = false;
  panes.list = [{ id: "hanoman-spec-5", projectId: "p1", specId: "SPEC-5", flow: "feature", phaseFile,
    cwd: wt, exited: false, code: 0, decisionFile, decision: true, eventHook: true }];
  seen.sync.length = 0;
  seen.reads.length = 0;
});

describe("jalur periodik tanpa I/O sinkron (SPEC-1267)", () => {
  it("overlay, digest, dan feed notifikasi tak memanggil execFileSync/readFileSync/statSync/readdirSync", async () => {
    await liveOverlayTick();
    await specsDigest();
    await notificationsFeed();
    expect(seen.sync).toEqual([]);
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-5" } }))!.stage).toBe("spec-ready");
  });

  it("list-panes gagal → peta kosong, stage tak mundur", async () => {
    panes.fail = true;
    expect((await sessionPhasesBySpecAsync()).size).toBe(0);
    expect(await liveDecisionsAsync().catch(() => "gagal")).toBe("gagal");
    await liveOverlayTick();
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-5" } }))!.stage).toBe("brainstorming");
  });

  it("berkas fase yang sama dibaca sekali walau ditanya berkali-kali (memo mtime)", async () => {
    await readPhasesAsync(phaseFile, "feature");
    await readPhasesAsync(phaseFile, "feature");
    await readPhasesAsync(phaseFile, "feature");
    expect(seen.reads.filter((p) => p === phaseFile)).toHaveLength(1);
    writeFileSync(phaseFile, "Objective done\nSpec done\nPlan done\n");
    const phases = await readPhasesAsync(phaseFile, "feature");
    expect(phases.find((p) => p.name === "Plan")!.state).toBe("done");
  });
});
