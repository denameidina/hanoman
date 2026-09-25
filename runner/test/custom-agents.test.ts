import { describe, it, expect } from "vitest";
import {
  renderAgentsJson, agentPromptOf, agentDelegationClause, phasePromptOf, agentContractOf,
  READ_ONLY_DENIED_COMMANDS, READ_ONLY_DENIED_OPERATORS, type AgentContractFile, type AgentDef,
} from "../src/custom-agents";
import { READ_ONLY_POLICY, readOnlyDecision } from "../src/agent-readonly";
import { DEFAULT_AGENT_TOOLS, MENTION_MAX_HOPS } from "@hanoman/shared";

const def = (o: Partial<AgentDef> & { name: string }): AgentDef => ({
  name: o.name,
  description: o.description ?? `deskripsi ${o.name}`,
  instructions: o.instructions ?? `instruksi ${o.name}`,
  tools: o.tools ?? null,
  model: o.model ?? null,
  mentions: o.mentions ?? [],
  activation: o.activation ?? "always",
  effort: o.effort ?? null,
  workspacePolicy: o.workspacePolicy ?? "inherit",
  maxTurns: o.maxTurns ?? null,
  timeoutSeconds: o.timeoutSeconds ?? null,
});

describe("renderAgentsJson", () => {
  it("daftar kosong → string kosong (flag tak dipasang sama sekali)", () => {
    expect(renderAgentsJson([])).toBe("");
  });

  it("bentuknya {name:{description,prompt,tools}} sesuai --agents claude", () => {
    const parsed = JSON.parse(renderAgentsJson([def({ name: "rev" })]));
    expect(Object.keys(parsed)).toEqual(["rev"]);
    expect(parsed.rev.description).toBe("deskripsi rev");
    expect(typeof parsed.rev.prompt).toBe("string");
    expect(parsed.rev.tools).toEqual([...DEFAULT_AGENT_TOOLS]);
  });

  it("model hanya dipancarkan bila diisi (else agen mewarisi model sesi)", () => {
    expect(JSON.parse(renderAgentsJson([def({ name: "a" })])).a.model).toBeUndefined();
    expect(JSON.parse(renderAgentsJson([def({ name: "a", model: "haiku" })])).a.model).toBe("haiku");
  });

  it("agen ber-mentions mendapat Task; agen daun TIDAK", () => {
    const j = JSON.parse(renderAgentsJson([
      def({ name: "a", mentions: ["b"] }),
      def({ name: "b" }),
    ]));
    expect(j.a.tools).toContain("Task");
    expect(j.b.tools).not.toContain("Task");
  });

  it("Task yang diketik operator dicabut untuk agen daun", () => {
    const j = JSON.parse(renderAgentsJson([def({ name: "b", tools: ["Read", "Task"] })]));
    expect(j.b.tools).toEqual(["Read"]);
  });

  it("keluarannya JSON sah walau instruksi memuat kutip, newline, dan backslash", () => {
    const nasty = 'baris1\n"kutip" \\ backslash \t tab';
    const j = JSON.parse(renderAgentsJson([def({ name: "a", instructions: nasty })]));
    expect(j.a.prompt).toContain(nasty);
  });

  it("memancarkan profil Claude yang didukung runtime", () => {
    const parsed = JSON.parse(renderAgentsJson([def({
      name: "qa", model: "sonnet", effort: "high", workspacePolicy: "isolated-worktree",
      maxTurns: 40, timeoutSeconds: 900,
    })]));
    expect(parsed.qa).toMatchObject({
      model: "sonnet", effort: "high", isolation: "worktree", maxTurns: 40,
    });
    expect(parsed.qa.prompt).toContain("900 detik");
  });

  it("read-only mencabut tool mutasi dan memasang permission + validator hook", () => {
    const parsed = JSON.parse(renderAgentsJson([def({
      name: "review", tools: ["Read", "Write", "Edit", "Bash", "Task", "mcp__db__write"],
      mentions: ["other"], workspacePolicy: "read-only",
    }), def({ name: "other" })], { readOnlyHookCommand: "node /tmp/readonly.js" }));
    expect(parsed.review.tools).toEqual(["Read", "Bash"]);
    expect(parsed.review.permissionMode).toBe("plan");
    expect(parsed.review.hooks.PreToolUse[0].hooks[0]).toMatchObject({
      type: "command", command: "node /tmp/readonly.js",
    });
  });
});

describe("agentPromptOf — lapis 3 anti-loop", () => {
  it("agen daun diberi tahu ia TIDAK boleh mendelegasikan", () => {
    const p = agentPromptOf(def({ name: "b" }), []);
    expect(p).toContain("instruksi b");
    expect(p.toLowerCase()).toContain("tidak boleh mendelegasikan");
  });

  it("agen ber-mentions menyebut siapa yang boleh dipanggil + anggaran hop", () => {
    const a = def({ name: "a", mentions: ["b", "c"] });
    const p = agentPromptOf(a, [a, def({ name: "b" }), def({ name: "c" })]);
    expect(p).toContain("@b");
    expect(p).toContain("@c");
    expect(p).toContain(String(MENTION_MAX_HOPS));
  });

  // Amandemen ADR-0094 (2026-09-25) · mention ke agen read-only = pasangan review.
  it("mention ke agen read-only menambah klausa review ber-SHA literal", () => {
    const eng = def({ name: "eng", mentions: ["rev"], workspacePolicy: "isolated-worktree" });
    const rev = def({ name: "rev", workspacePolicy: "read-only" });
    const p = agentPromptOf(eng, [eng, rev]);
    expect(p).toContain("@rev");
    expect(p).toContain("Sebelum melapor `Status: selesai`");
    expect(p).toContain("git diff --no-ext-diff --no-textconv <base> <hasil>");
  });

  it("mention ke agen penulis tidak memicu klausa review", () => {
    const a = def({ name: "a", mentions: ["b"], workspacePolicy: "isolated-worktree" });
    const p = agentPromptOf(a, [a, def({ name: "b", workspacePolicy: "isolated-worktree" })]);
    expect(p).toContain("@b");
    expect(p).not.toContain("Sebelum melapor `Status: selesai`");
  });

  it("auditor yang dibuang dari roster (mis. anggaran argv) tak disebut sebagai reviewer", () => {
    const eng = def({ name: "eng", mentions: ["rev"], workspacePolicy: "isolated-worktree" });
    const p = agentPromptOf(eng, [eng]);
    expect(p).not.toContain("@rev");
    expect(p.toLowerCase()).toContain("tidak boleh mendelegasikan");
  });

  it("mention ke agen yang tak ada di roster tak ikut disebut", () => {
    const a = def({ name: "a", mentions: ["b", "hantu"] });
    const p = agentPromptOf(a, [a, def({ name: "b" })]);
    expect(p).toContain("@b");
    expect(p).not.toContain("@hantu");
  });

  it("membawa policy efektif read-only dan melarang klaim eksperimen tanpa output", () => {
    const p = agentPromptOf(def({
      name: "root-causer", workspacePolicy: "read-only", maxTurns: 40,
    }), [], "claude");
    expect(p).toContain("Policy efektif: read-only");
    expect(p).toContain("diagnosis statis");
    expect(p).toContain("rencana eksperimen untuk parent");
    expect(p).toContain("`terbukti-statis`/`belum-terbukti`/`gugur`");
    expect(p).toContain("Jangan mengklaim eksperimen telah dijalankan tanpa output");
  });

  it("mengizinkan root-causer mereproduksi hanya pada isolated-worktree", () => {
    const p = agentPromptOf(def({
      name: "root-causer", workspacePolicy: "isolated-worktree", maxTurns: 40,
    }), [], "claude");
    expect(p).toContain("Policy efektif: isolated-worktree");
    expect(p).toContain("boleh mereproduksi");
    expect(p).toContain("worktree terisolasi");
  });

  // Audit P0-2 · worktree isolasi lahir dari COMMIT: dirty parent tak ikut, hasil tak kembali sendiri.
  it("isolated-worktree: langkah 0 cocokkan kandidat SHA, serah balik SHA hasil untuk cherry-pick", () => {
    const p = agentPromptOf(def({ name: "builder", workspacePolicy: "isolated-worktree" }), []);
    expect(p).toContain("lahir dari sebuah COMMIT");
    expect(p).toContain("`git rev-parse HEAD`");
    expect(p).toContain("`Kandidat SHA`");
    expect(p).toContain("`git checkout --detach <kandidat>`");
    expect(p).toContain("`Status: terhalang` dan berhenti");
    expect(p).toContain("`SHA dasar`, `SHA hasil`");
    expect(p).toContain("`git cherry-pick`");
    expect(p).toContain("`git add <path>` eksplisit");
  });

  // Audit P0-5 · pertahanan kedua: env pane bisa mewarisi DATABASE_URL operasional.
  it("isolated-worktree: larang migrate/test terhadap DATABASE_URL ~/.hanoman", () => {
    const p = agentPromptOf(def({ name: "builder", workspacePolicy: "isolated-worktree" }), []);
    expect(p).toContain("`DATABASE_URL` yang menunjuk `~/.hanoman`");
    expect(p).toContain("DB sekali-pakai");
    expect(agentPromptOf(def({ name: "rev", workspacePolicy: "read-only" }), [])).not.toContain("DATABASE_URL");
  });

  it("serah-terima menuntut base & kandidat SHA sebagai NILAI, bukan nama variabel", () => {
    const p = agentPromptOf(def({ name: "scout" }), []);
    expect(p).toContain("base SHA dan kandidat SHA sebagai NILAI heksadesimal");
    expect(p).toContain("(bukan nama variabel)");
    expect(p).not.toContain("dirty changes");
  });

  it("membawa kontrak handoff, batas laporan, dan batas turn instruksional", () => {
    const p = agentPromptOf(def({ name: "scout", maxTurns: 20 }), [], "codex");
    expect(p).toContain("Status: selesai | sebagian | terhalang");
    expect(p).toContain("maksimal 12 temuan utama");
    expect(p).toContain("maksimal 1200 kata");
    expect(p).toContain("20 turn");
    expect(p).toContain("batas instruksional");
    expect(p).toContain("bukan hard kill");
  });

  // ADR-0167 · custom agent dulu tak punya jalur tanya sama sekali.
  it.each(["claude", "codex"] as const)("%s: keputusan ambigu dilaporkan sebagai `Keputusan terbuka:`", (rt) => {
    const p = agentPromptOf(def({ name: "scout" }), [], rt);
    expect(p).toContain("Status: selesai | sebagian | terhalang | menunggu-keputusan");
    expect(p).toContain("`Keputusan terbuka:`");
    expect(p).toContain("tanpa batas jumlah");
    expect(p).toContain("Jangan memutuskannya sendiri");
  });
});

// SPEC-543 · ADR-0108 · subagent claude punya konteks TERPISAH: prompt sesi (yang membawa klausa
// gaya kode) tak pernah sampai ke sana, jadi klausanya harus ikut di prompt perannya sendiri.
describe("klausa gaya kode di custom agent (SPEC-543)", () => {
  const MARK = "Gaya kode —";

  it("agen daun membawanya", () => {
    expect(agentPromptOf(def({ name: "b" }), [])).toContain(MARK);
  });

  it("agen ber-mentions membawanya juga (kedua cabang)", () => {
    const a = def({ name: "a", mentions: ["b"] });
    expect(agentPromptOf(a, [a, def({ name: "b" })])).toContain(MARK);
  });

  it("ikut terbawa ke JSON --agents", () => {
    const j = JSON.parse(renderAgentsJson([def({ name: "rev" })]));
    expect(j.rev.prompt).toContain(MARK);
  });

});

// ADR-0136/0159 · metadata tersedia melalui registry native. Prompt parent hanya arahan
// delegasi/handoff yang ukurannya tetap, berapa pun jumlah atau panjang definisi agent.
describe("agentDelegationClause", () => {
  const def = (name: string, description: string): AgentDef => ({
    name, description, instructions: "i", tools: null, model: null, mentions: [],
  });

  // Invarian ADR-0094: katalog kosong → prompt byte-identik dengan sebelum fitur ini.
  it("kosong saat tak ada agen", () => {
    expect(agentDelegationClause([])).toBe("");
  });

  it.each(["claude", "codex"] as const)("arahan %s tetap sama tanpa menyalin metadata agent", (runtime) => {
    const agents = Array.from({ length: 16 }, (_, i) => ({
      ...def(`role-${i}`, `DESKRIPSI-${i}-${"panjang ".repeat(50)}`),
      instructions: `INSTRUKSI-PRIVAT-${i}`, activation: "smart" as const,
    }));
    const out = agentDelegationClause(agents, runtime);
    expect(out).toBe(agentDelegationClause([agents[0]!], runtime));
    expect(out).not.toBe("");
    for (const agent of agents) {
      expect(out).not.toContain(agent.name);
      expect(out).not.toContain(agent.description);
      expect(out).not.toContain(agent.instructions);
    }
    expect(out).not.toContain("## Subagent yang tersedia");
  });

  it("mempertahankan handoff berbukti dan pemilihan sesuai pekerjaan", () => {
    const out = agentDelegationClause([def("scout", "cari kode")]);
    expect(out).toContain("relevan");
    expect(out).toContain("base SHA");
    expect(out).toContain("kandidat SHA sebagai nilai literal");
    expect(out).not.toContain("dirty changes");
    expect(out).toContain("bukti sebelumnya");
    // Audit P0-2 · agen isolated-worktree hanya melihat COMMIT; hasilnya kembali lewat SHA.
    expect(out).toContain("commit kandidat dulu");
    expect(out).toContain("`git cherry-pick <sha>`");
    expect(out).toContain("aturan verifikasi");
    expect(out).toContain("Task");
  });

  it("parent meneruskan `Keputusan terbuka:` ke pemutus, bukan menjawabnya sendiri (ADR-0167)", () => {
    const claude = agentDelegationClause([def("scout", "cari kode")], "claude");
    expect(claude).toContain("`Keputusan terbuka:`");
    expect(claude).toContain("JANGAN menjawabnya sendiri");
    expect(claude).toContain("AskUserQuestion");
    expect(claude).toContain("SendMessage");
    const codex = agentDelegationClause([def("scout", "cari kode")], "codex");
    expect(codex).toContain("`Keputusan terbuka:`");
    expect(codex).toContain("send_input");
    expect(codex).not.toContain("AskUserQuestion");
  });

  it("Codex diarahkan ke spawn_agent tanpa membawa full instructions", () => {
    const agent = def("scout", "cari kode");
    agent.instructions = "RAHASIA-INSTRUKSI-PANJANG";
    const out = agentDelegationClause([agent], "codex");
    expect(out).toContain("spawn_agent");
    expect(out).not.toContain("scout");
    expect(out).not.toContain("cari kode");
    expect(out).not.toContain("RAHASIA-INSTRUKSI-PANJANG");
  });
});

// ADR-0164 · agen fase: instruksi apa adanya dan TANPA kunci tools — terukur 2026-09-14 (claude
// 2.1.270): subagent tanpa `tools` mewarisi seluruh tool sesi termasuk Skill.
describe("renderAgentsJson · agen fase (ADR-0164)", () => {
  const phase = def({
    name: "hanoman-fase-plan", description: "Fase Plan", instructions: "INSTRUKSI FASE",
    model: "claude-sonnet-5",
  });
  it("tanpa tools, prompt apa adanya, model & effort ikut", () => {
    const j = JSON.parse(renderAgentsJson([{ ...phase, kind: "phase" as const, phase: "Plan", effort: "low" }, def({ name: "scout" })]));
    expect(j["hanoman-fase-plan"]).toEqual({
      description: "Fase Plan", prompt: "INSTRUKSI FASE", model: "claude-sonnet-5", effort: "low",
    });
    expect(j.scout.tools).toBeDefined();
  });
  // T2 · konteks bersama (brief/payload/PRD) dulu disalin utuh ke SETIAP agen fase lalu seluruh JSON
  // lewat SATU argumen `--agents`: payload 25 KB → 168 KB, lewat MAX_ARG_STRLEN Linux (128 KiB) →
  // exec gagal "Argument list too long". Kini konteks ditulis sekali ke berkas dan dirujuk path-nya.
  it("konteks bersama: inline tanpa berkas (byte-identik), dirujuk path bila berkas diberikan", () => {
    const withCtx = { ...phase, kind: "phase" as const, phase: "Plan", context: "ISI-KONTEKS" };
    const inline = JSON.parse(renderAgentsJson([withCtx]))["hanoman-fase-plan"].prompt;
    expect(inline).toBe("INSTRUKSI FASE\n\n=== KONTEKS ===\nISI-KONTEKS");
    expect(phasePromptOf(withCtx)).toBe(inline);
    const ref = JSON.parse(renderAgentsJson([withCtx], {
      phaseContextFile: { context: "ISI-KONTEKS", path: "/tmp/hanoman-agents/s1/phase-context.md" },
    }))["hanoman-fase-plan"].prompt;
    expect(ref).not.toContain("ISI-KONTEKS");
    expect(ref.startsWith("INSTRUKSI FASE\n\n=== KONTEKS ===\n")).toBe(true);
    expect(ref).toContain("`/tmp/hanoman-agents/s1/phase-context.md`");
    expect(ref).toMatch(/Baca berkas itu UTUH/);
    // Konteks yang BUKAN isi berkas tetap inline — berkas tak pernah dirujuk untuk isi yang lain.
    const other = { ...withCtx, name: "hanoman-fase-spec", context: "LAIN" };
    const j = JSON.parse(renderAgentsJson([withCtx, other], {
      phaseContextFile: { context: "ISI-KONTEKS", path: "/tmp/x.md" },
    }));
    expect(j["hanoman-fase-spec"].prompt).toContain("=== KONTEKS ===\nLAIN");
  });
  it("agen fase tanpa konteks: prompt apa adanya", () => {
    expect(phasePromptOf({ ...phase, kind: "phase" as const })).toBe("INSTRUKSI FASE");
  });
  it("agen fase tak masuk klausa delegasi custom agent", () => {
    const phaseDef = { ...phase, kind: "phase" as const, phase: "Plan" };
    expect(agentDelegationClause([phaseDef])).toBe("");
    expect(agentDelegationClause([phaseDef], "codex")).toBe("");
    expect(agentDelegationClause([phaseDef, def({ name: "scout" })])).toBe(agentDelegationClause([def({ name: "scout" })]));
  });
});

// Audit custom agent P1-1 · prosa allowlist read-only diturunkan dari `READ_ONLY_POLICY` dan contohnya
// diikat ke validator: yang disebut diterima benar-benar lolos, yang disebut ditolak benar-benar ditolak.
describe("P1-1 · prosa read-only terikat ke readOnlyDecision", () => {
  const prose = agentPromptOf(def({ name: "rev", workspacePolicy: "read-only" }), []);
  const bash = (command: string) => readOnlyDecision({ tool_name: "Bash", tool_input: { command } }, {});
  const SHA = "0123456789abcdef0123456789abcdef01234567";

  it("setiap perintah shell allowlist disebut prosa dan contohnya lolos", () => {
    const allowed = [
      "rg -n customAgent server/src", "sed -n '1,80p' README.md", "head -n 20 README.md", "tail README.md",
      "wc -l README.md", "ls server/src", "git status", "git status --porcelain",
      `git diff --no-ext-diff --no-textconv ${SHA}`, `git show --no-ext-diff --no-textconv ${SHA}`,
      "git log --no-ext-diff --no-textconv -5",
    ];
    for (const c of READ_ONLY_POLICY.shellCommands) {
      expect(prose).toContain("`" + c + "`");
      expect(allowed.some((a) => a.split(" ")[0] === c), c).toBe(true);
    }
    for (const g of READ_ONLY_POLICY.gitCommands) expect(prose).toMatch(new RegExp(`git [a-z|]*\\b${g}\\b`));
    for (const a of allowed) expect(bash(a), a).toEqual({ allowed: true });
  });

  it("contoh berplaceholder di prosa lolos sesudah diisi nilai literal", () => {
    const section = prose.slice(prose.indexOf("Bash hanya menerima"), prose.indexOf("SHA wajib literal"));
    // `git diff|show|log` adalah ringkasan tiga subperintah, bukan perintah yang bisa dijalankan.
    const examples = [...section.matchAll(/`((?:sed|git) [^`]*)`/g)].map((m) => m[1]!)
      .filter((c) => !c.includes("|"));
    expect(examples).toEqual([
      "sed -n 'A,Bp' <berkas>", "git status", "git diff --no-ext-diff --no-textconv <baseSha>",
      "git status --porcelain",
    ]);
    for (const c of examples) {
      const filled = c.replace("A,B", "1,80").replace("<berkas>", "README.md").replace("<baseSha>", SHA);
      expect(bash(filled), filled).toEqual({ allowed: true });
    }
  });

  it("operator yang disebut ditolak memang ditolak — juga di dalam kutip", () => {
    for (const op of READ_ONLY_DENIED_OPERATORS) {
      expect(prose).toContain(op === "`" ? "backtick" : "`" + op + "`");
      for (const cmd of [`rg x . ${op} ls`, `rg 'x${op}y' .`, `rg "x${op}y" .`]) {
        expect(bash(cmd).allowed, cmd).toBe(false);
      }
    }
    expect(prose).toContain("juga di dalam kutip");
    expect(bash("rg 'a|b' .").allowed).toBe(false);
    expect(prose).toContain("alternasi `a|b`");
  });

  it("perintah yang disebut ditolak memang ditolak", () => {
    for (const c of READ_ONLY_DENIED_COMMANDS) {
      const word = c.startsWith("git ") ? c.slice(4) : c;
      expect(prose).toContain(word);
      const cmd = c.startsWith("git ") ? `${c} --no-ext-diff --no-textconv HEAD` : `${c} README.md`;
      expect(bash(cmd).allowed, cmd).toBe(false);
    }
    expect(prose).toContain("git blame/grep/rev-parse/merge-base");
  });

  it("git diff/show/log tanpa kedua flag, atau SHA lewat variabel, ditolak", () => {
    expect(prose).toContain("WAJIB membawa `--no-ext-diff --no-textconv`");
    expect(bash(`git diff ${SHA}`).allowed).toBe(false);
    expect(bash(`git diff --no-ext-diff ${SHA}`).allowed).toBe(false);
    expect(prose).toContain("SHA wajib literal heksadesimal");
    expect(bash("git diff --no-ext-diff --no-textconv $HANOMAN_BASE_SHA").allowed).toBe(false);
  });
});

// Audit custom agent P1-11 · kontrak bersama (policy + serah-terima + gaya kode) ditulis SEKALI per
// policy dan dirujuk path-nya — pola `phaseContextFile`. Tanpa berkas: inline, byte-identik.
describe("P1-11 · berkas kontrak bersama custom agent", () => {
  const MARK = "Gaya kode —";
  const files = (["read-only", "isolated-worktree", "inherit"] as const).map((policy): AgentContractFile => ({
    policy, content: agentContractOf(policy), path: `/tmp/hanoman-agents/s1/agent-contract-${policy}.md`,
  }));

  it("isi kontrak per policy memuat policy generik, serah-terima, dan gaya kode", () => {
    const iso = agentContractOf("isolated-worktree");
    expect(iso).toContain("Policy efektif: isolated-worktree");
    expect(iso).toContain("`git cherry-pick`");
    expect(iso).toContain("Kontrak serah-terima:");
    expect(iso).toContain(MARK);
    expect(agentContractOf("read-only")).toContain("Bash hanya menerima:");
    expect(agentContractOf("inherit")).not.toContain("isolated-worktree");
  });

  it("prompt merujuk berkas policy-nya, tanpa menyalin kontrak; Status tetap inline", () => {
    const j = JSON.parse(renderAgentsJson([
      def({ name: "rev", workspacePolicy: "read-only" }),
      def({ name: "wt", workspacePolicy: "isolated-worktree" }),
      def({ name: "inh" }),
    ], { agentContractFiles: files }));
    for (const [name, policy] of [["rev", "read-only"], ["wt", "isolated-worktree"], ["inh", "inherit"]] as const) {
      const p = j[name].prompt as string;
      expect(p).toContain(`\`/tmp/hanoman-agents/s1/agent-contract-${policy}.md\``);
      expect(p).toContain(`Policy efektif: ${policy}.`);
      expect(p).toMatch(/Baca berkas itu UTUH/);
      expect(p).toContain("Status: selesai | sebagian | terhalang | menunggu-keputusan");
      expect(p).not.toContain(MARK);
      expect(p).not.toContain("Kontrak serah-terima:");
    }
    const full = JSON.parse(renderAgentsJson([def({ name: "wt", workspacePolicy: "isolated-worktree" })]));
    expect(j.wt.prompt.length).toBeLessThan(full.wt.prompt.length);
  });

  it("baris khas agen (root-causer) dan batas kerja tetap inline", () => {
    const j = JSON.parse(renderAgentsJson([def({
      name: "root-causer", workspacePolicy: "read-only", maxTurns: 30,
    })], { agentContractFiles: files }));
    expect(j["root-causer"].prompt).toContain("`terbukti-statis`/`belum-terbukti`/`gugur`");
    expect(j["root-causer"].prompt).toContain("30 turn");
  });

  it("tanpa berkas, isi berbeda, atau agen tanpa Read → kontrak inline apa adanya", () => {
    const d = def({ name: "wt", workspacePolicy: "isolated-worktree" });
    const inline = JSON.parse(renderAgentsJson([d])).wt.prompt;
    expect(inline).toBe(agentPromptOf(d, [d]));
    expect(inline).toContain(MARK);
    const stale = files.map((f) => ({ ...f, content: f.content + "basi" }));
    expect(JSON.parse(renderAgentsJson([d], { agentContractFiles: stale })).wt.prompt).toBe(inline);
    const noRead = def({ name: "nr", tools: ["Bash"] });
    expect(JSON.parse(renderAgentsJson([noRead], { agentContractFiles: files })).nr.prompt)
      .toBe(agentPromptOf(noRead, [noRead]));
  });
});
