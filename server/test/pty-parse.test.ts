import { describe, it, expect } from "vitest";
import { FMT, parsePanes } from "../src/services/pty";

/* SPEC-919 · `parsePanes` men-destructure baris tab per POSISI. Menambah satu field ke FMT
   tanpa menggeser destructuring-nya menghasilkan nilai yang salah di SETIAP kolom sesudahnya —
   tanpa satu pun error. Test ini mengunci jumlah kolom dan pemetaannya. */

const FIELDS = FMT.split("\t");

const line = (over: Record<string, string> = {}) => {
  const v: Record<string, string> = {
    "#{session_name}": "hanoman-spec-919", "#{@hanoman_project}": "hanoman",
    "#{@hanoman_spec}": "SPEC-919", "#{@hanoman_flow}": "feature",
    "#{@hanoman_phase_file}": "/tmp/.phases/spec-919", "#{@hanoman_cwd}": "/tmp/wt",
    "#{pane_dead}": "0", "#{pane_dead_status}": "", "#{@hanoman_decision_file}": "",
    "#{@hanoman_branch}": "", "#{@hanoman_agent}": "codex", "#{alternate_on}": "0",
    "#{window_activity}": "1756000000", "#{@hanoman_event_hook}": "1",
    "#{session_created}": "1755999000",
    "#{@hanoman_agent_roster}": '[{"id":"global:scout","name":"scout","model":"haiku"}]',
    ...over,
  };
  return FIELDS.map((f) => v[f] ?? "").join("\t");
};

describe("parsePanes", () => {
  it("FMT dan destructuring sama panjang", () => {
    expect(FIELDS).toHaveLength(21);
    // M-2 · ADR-0164 · field baru di UJUNG (pola SPEC-919): kolom lama tak bergeser.
    expect(FIELDS[FIELDS.length - 1]).toBe("#{@hanoman_done_at_birth}");
  });

  it("memetakan setiap kolom ke field yang benar", () => {
    const [p] = parsePanes(line());
    expect(p).toMatchObject({
      id: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
      cwd: "/tmp/wt", exited: false, agent: "codex", altScreen: false,
      activityAt: 1756000000, eventHook: true, startedAt: 1755999000,
      agentRoster: [{ id: "global:scout", name: "scout", model: "haiku" }],
    });
  });

  it("membaca kelas launch dari tmux, dan membiarkan pane lama tanpa kelas", () => {
    expect(parsePanes(line({ "#{@hanoman_launch_class}": "terminal" }))[0]!.launchClass).toBe("terminal");
    expect(parsePanes(line({ "#{@hanoman_launch_class}": "agent" }))[0]!.launchClass).toBe("agent");
    expect(parsePanes(line())[0]!.launchClass).toBeUndefined();
  });

  it("startedAt 0 saat tmux tak menjawab field itu", () => {
    const [p] = parsePanes(line({ "#{session_created}": "" }));
    expect(p!.startedAt).toBe(0);
  });

  /* Kolom KOSONG dan kolom HILANG adalah dua hal berbeda: `Number("")` = 0, `Number(undefined)`
     = NaN. Baris terpotong bisa datang dari tmux versi lama yang tak mengenal `#{session_created}`,
     dan NaN yang lolos ke `new Date(NaN).toISOString()` MELEMPAR — lemparan yang lalu ditelan
     `.catch(() => [])` di view dan `catch { return; }` di sender, jadi presence mati SENYAP. */
  it("baris terpotong (kolom tak ada sama sekali) tetap memberi startedAt 0, bukan NaN", () => {
    const potong = (n: number) => line().split("\t").slice(0, n).join("\t");
    const [p] = parsePanes(potong(14));
    expect(p!.startedAt).toBe(0);
    expect(Number.isNaN(p!.startedAt)).toBe(false);
    expect(() => new Date(p!.startedAt * 1000).toISOString()).not.toThrow();
  });

  it("baris di luar prefix hanoman dibuang", () => {
    expect(parsePanes(line({ "#{session_name}": "lain" }))).toHaveLength(0);
  });

  it("ADR-0164 · model/effort orchestrator, penanda orkestrasi, dan roster ber-fase", () => {
    const [p] = parsePanes(line({
      "#{@hanoman_model}": "claude-opus-5", "#{@hanoman_effort}": "high", "#{@hanoman_orchestrated}": "1",
      "#{@hanoman_agent_roster}": '[{"name":"hanoman-fase-plan","phase":"Plan","model":"claude-sonnet-5","effort":"low"}]',
    }));
    expect(p).toMatchObject({ model: "claude-opus-5", effort: "high", orchestrated: true });
    expect(p!.agentRoster).toEqual([{ name: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low" }]);
    expect(parsePanes(line())[0]!.orchestrated).toBe(false);
  });

  it("M-2 · ADR-0164 · daftar fase sudah done|skipped saat lahir, dari opsi tmux @hanoman_done_at_birth", () => {
    const [p] = parsePanes(line({ "#{@hanoman_done_at_birth}": "Brainstorm,Objective" }));
    expect(p!.doneAtBirth).toEqual(["Brainstorm", "Objective"]);
    // Sesi lama tanpa opsi ini (atau tak ada fase done saat lahir) → undefined, bukan [].
    expect(parsePanes(line())[0]!.doneAtBirth).toBeUndefined();
  });
});
