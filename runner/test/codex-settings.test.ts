import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexHookArgs, codexGoalScript, GOAL_MAX_BLOCKS } from "../src/codex-settings";
import { EVENT_HOOK_COMMAND } from "../src/settings";
import { PLAN_DIRS } from "@hanoman/shared";

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-cx-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// Menjalankan skrip gate apa adanya lewat /bin/sh. Mengembalikan {code, stderr}.
function runGate(script: string): { code: number; stderr: string } {
  const f = join(dir, "gate.sh");
  writeFileSync(f, script, { mode: 0o755 });
  try {
    execFileSync("/bin/sh", [f], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { code: err.status ?? -1, stderr: err.stderr ?? "" };
  }
}

const gate = (over: Partial<Parameters<typeof codexGoalScript>[0]> = {}) => codexGoalScript({
  flow: "feature", specId: "SPEC-338",
  phaseFile: join(dir, "phases"), worktree: join(dir, "wt"),
  condition: "KONDISI-GOAL-338", stateFile: join(dir, "state"), ...over,
});

describe("codexHookArgs", () => {
  it("marker keputusan: Stop menulis, UserPromptSubmit mengosongkan", () => {
    const args = codexHookArgs({ decisionFile: "/tmp/d1" });
    const joined = args.join(" ");
    expect(joined).toContain("hooks.Stop=");
    expect(joined).toContain("hooks.UserPromptSubmit=");
    expect(joined).toContain("'/tmp/d1'");
    // Hook codex hanya mendukung type="command" (type="prompt" didiamkan CLI).
    expect(joined).toContain('type="command"');
    expect(joined).not.toContain("prompt");
  });

  // SPEC-898 · ADR-0141 · cermin guardSettings: Stop menulis stempel sekali, bukan menumpuk baris.
  it("Stop menulis epoch hanya saat marker kosong", () => {
    const stop = codexHookArgs({ decisionFile: "/tmp/d1" }).find((a) => a.startsWith("hooks.Stop="))!;
    expect(stop).toContain("[ -s '/tmp/d1' ]");
    expect(stop).toContain("date +%s > '/tmp/d1'");
    expect(stop).not.toContain("echo waiting");
  });

  it("tanpa decisionFile & tanpa goalGate tak menghasilkan argumen hook", () => {
    expect(codexHookArgs({})).toEqual([]);
  });

  it("goalGate ikut sebagai entri Stop tambahan", () => {
    const args = codexHookArgs({ decisionFile: "/tmp/d1", goalGate: "/tmp/g1.sh" });
    const stop = args.find((a) => a.startsWith("hooks.Stop="))!;
    expect(stop).toContain("/tmp/d1");
    expect(stop).toContain("/tmp/g1.sh");
  });

  it("setiap nilai hook didahului flag -c tersendiri", () => {
    const args = codexHookArgs({ decisionFile: "/tmp/d1" });
    expect(args.filter((a) => a === "-c").length).toBe(2);
    expect(args.length).toBe(4);
  });
});

describe("codexGoalScript", () => {
  it("memblok (exit 2) saat phase file kosong, alasan memuat kondisi", () => {
    writeFileSync(join(dir, "phases"), "");
    const r = runGate(gate());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("KONDISI-GOAL-338");
    expect(r.stderr).toContain("Brainstorm");
  });

  it("meloloskan (exit 0) saat semua fase tercatat & tak ada plan tersisa", () => {
    writeFileSync(join(dir, "phases"),
      "Brainstorm done\nObjective done\nSpec skipped\nPlan done\nExecute done\n");
    mkdirSync(join(dir, "wt/docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(dir, "wt/docs/superpowers/plans/2026-07-27-x-spec-338.md"), "- [x] beres\n");
    expect(runGate(gate()).code).toBe(0);
  });

  it("memblok saat plan spec ini masih punya - [ ]", () => {
    writeFileSync(join(dir, "phases"),
      "Brainstorm done\nObjective done\nSpec done\nPlan done\nExecute done\n");
    mkdirSync(join(dir, "wt/docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(dir, "wt/docs/superpowers/plans/2026-07-27-x-spec-338.md"), "- [ ] belum\n");
    const r = runGate(gate());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("- [ ]");
  });

  it("mengabaikan plan milik spec lain", () => {
    writeFileSync(join(dir, "phases"),
      "Brainstorm done\nObjective done\nSpec done\nPlan done\nExecute done\n");
    mkdirSync(join(dir, "wt/docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(dir, "wt/docs/superpowers/plans/2026-07-01-lain-spec-299.md"), "- [ ] belum\n");
    expect(runGate(gate()).code).toBe(0);
  });

  it("flow tanpa Plan+Execute tak menggerbang plan sama sekali", () => {
    writeFileSync(join(dir, "phases"), "Audit done\nLaporan done\n");
    mkdirSync(join(dir, "wt/docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(dir, "wt/docs/superpowers/plans/2026-07-27-x-spec-338.md"), "- [ ] belum\n");
    expect(runGate(gate({ flow: "audit" })).code).toBe(0);
  });

  it("melepas gate sesudah GOAL_MAX_BLOCKS penolakan (pagar anti-loop)", () => {
    writeFileSync(join(dir, "phases"), "");
    const s = gate();
    for (let i = 0; i < GOAL_MAX_BLOCKS; i++) expect(runGate(s).code).toBe(2);
    expect(runGate(s).code).toBe(0);   // pagar: berhenti memaksa, serahkan ke manusia
  });
});

describe("SPEC-734 · gate plan lintas metode", () => {
  const base = {
    flow: "feature" as const, specId: "SPEC-9", phaseFile: "/p/ph",
    worktree: "/w", condition: "c", stateFile: "/p/st",
  };

  // Direktori dikutip UTUH (`shq`), globnya tetap di luar kutipan — itulah bentuk yang benar.
  const loopFor = (d: string) => `for f in '/w/${d}'/*spec-9*; do`;

  // AC-4 (Stop hook) + INVARIAN 1 · union, bukan satu direktori.
  it("skrip me-loop SETIAP planDir terdaftar", () => {
    const sh = codexGoalScript(base);
    for (const d of PLAN_DIRS) expect(sh).toContain(loopFor(d));
    expect(PLAN_DIRS.length).toBeGreaterThan(1);   // union sungguhan, bukan daftar satu elemen
  });

  it("flow tanpa Plan+Execute tak punya gate plan sama sekali", () => {
    const sh = codexGoalScript({ ...base, flow: "audit" });
    expect(sh).not.toContain("for f in");
  });
});

// SPEC-909 · ADR-0146 · padanan hook AskUserQuestion untuk codex (akhir-turn).
describe("SPEC-909 · hook pengirim event codex", () => {
  it("menambahkan perintah kedua di Stop, berdampingan dengan penulis marker", () => {
    const args = codexHookArgs({ decisionFile: "/w/.decisions/s1", eventHook: true });
    const stop = args[args.indexOf("-c") + 1]!;
    expect(stop.startsWith("hooks.Stop=")).toBe(true);
    expect(stop).toContain("date +%s >");        // penulis marker tetap ada …
    expect(stop).toContain("curl");              // … dan pengirim event menyusul
    expect(args.some((arg) => arg.startsWith("hooks.SubagentStart=") && arg.includes("curl"))).toBe(true);
    expect(args.some((arg) => arg.startsWith("hooks.SubagentStop=") && arg.includes("curl"))).toBe(true);
  });

  it("tanpa eventHook, argv byte-identik seperti sebelum SPEC-909", () => {
    expect(codexHookArgs({ decisionFile: "/w/.decisions/s1" }))
      .toEqual(codexHookArgs({ decisionFile: "/w/.decisions/s1", eventHook: false }));
  });

  it("memakai definisi perintah yang SAMA dengan claude — bukan salinan", () => {
    const stop = codexHookArgs({ eventHook: true })[1]!;
    // Perintahnya di-escape TOML, jadi cocokkan potongan yang tak mengandung kutip.
    expect(stop).toContain("$HANOMAN_EVENT_URL");
    expect(EVENT_HOOK_COMMAND).toContain("$HANOMAN_EVENT_URL");
  });
});
