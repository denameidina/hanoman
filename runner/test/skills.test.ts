import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentSkillHome, scanAgentSkills } from "../src/skills";

// CATATAN VERIFIKASI SPEC-739: seluruh bukti "terpasang/tak terpasang" datang dari pohon
// direktori yang dirakit test ini dan ditunjuk lewat env — TIDAK PERNAH dari HOME mesin yang
// menjalankannya. Tanpa itu hijau/merah bergantung siapa yang menjalankan suite-nya.
let root: string;
const skill = (dir: string, name: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
};

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "hn-skills-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("agentSkillHome", () => {
  it("default ~/.claude dan ~/.codex", () => {
    expect(agentSkillHome("claude", {}, "/Users/x")).toBe("/Users/x/.claude");
    expect(agentSkillHome("codex", {}, "/Users/x")).toBe("/Users/x/.codex");
  });
  it("HANOMAN_*_HOME menang (cermin HANOMAN_CLAUDE_BIN/HANOMAN_CODEX_BIN)", () => {
    expect(agentSkillHome("claude", { HANOMAN_CLAUDE_HOME: "/a" }, "/Users/x")).toBe("/a");
    expect(agentSkillHome("codex", { HANOMAN_CODEX_HOME: "/b" }, "/Users/x")).toBe("/b");
  });
  it("CODEX_HOME dihormati untuk codex, tapi kalah dari HANOMAN_CODEX_HOME", () => {
    expect(agentSkillHome("codex", { CODEX_HOME: "/c" }, "/Users/x")).toBe("/c");
    expect(agentSkillHome("codex", { CODEX_HOME: "/c", HANOMAN_CODEX_HOME: "/b" }, "/Users/x")).toBe("/b");
  });
  it("CODEX_HOME TIDAK bocor ke claude — dua akar, dua agen", () => {
    expect(agentSkillHome("claude", { CODEX_HOME: "/c" }, "/Users/x")).toBe("/Users/x/.claude");
  });
});

describe("scanAgentSkills · akar tak ada", () => {
  it("akar kosong → nol skill, bukan lemparan", () => {
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: join(root, "tak-ada") });
    expect(r.skills).toEqual([]);
    expect(r.packages).toEqual([]);
    expect(r.roots).toEqual([]);
  });
});

describe("scanAgentSkills · skill user", () => {
  it("`<home>/skills/<n>/SKILL.md` → id polos tanpa paket", () => {
    skill(join(root, "skills"), "hanoman");
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["hanoman"]);
    expect(r.skills[0]!.pkg).toBeNull();
    expect(r.packages).toEqual([]);
  });
  it("direktori tanpa SKILL.md bukan skill", () => {
    mkdirSync(join(root, "skills", "bukan-skill"), { recursive: true });
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.skills).toEqual([]);
  });
  it("direktori berawalan titik dilewati (mis. ~/.codex/skills/.system)", () => {
    skill(join(root, "skills", ".system"), "review-agent");
    skill(join(root, "skills"), "hanoman");
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["hanoman"]);
  });
});

describe("scanAgentSkills · plugin dari cache", () => {
  const cached = (pkg: string, mkt: string, ver: string, names: string[]) => {
    const dir = join(root, "plugins", "cache", mkt, pkg, ver, "skills");
    for (const n of names) skill(dir, n);
  };

  it("`plugins/cache/<mkt>/<pkg>/<ver>/skills/<n>` → id `<pkg>:<n>`", () => {
    cached("superpowers", "superpowers-marketplace", "6.0.3", ["brainstorming", "writing-plans"]);
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.skills.map((s) => s.id).sort())
      .toEqual(["superpowers:brainstorming", "superpowers:writing-plans"]);
    expect(r.packages).toEqual(["superpowers"]);
  });

  // KOREKSI TERUKUR atas premis brief: codex punya akar KEDUA yang sama bentuknya. Deteksi yang
  // hanya memindai ~/.codex/skills melaporkan superpowers KURANG di mesin yang sebenarnya sehat.
  it("codex memindai cache plugin-nya juga, bukan hanya ~/.codex/skills", () => {
    cached("superpowers", "openai-curated", "11c74d6b", ["brainstorming"]);
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["superpowers:brainstorming"]);
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("plugin yang DINYATAKAN nonaktif dilewati · claude settings.json", () => {
    cached("ponytail", "ponytail", "4.8.4", ["tail"]);
    cached("superpowers", "superpowers-marketplace", "6.0.3", ["brainstorming"]);
    writeFileSync(join(root, "settings.json"), JSON.stringify({
      enabledPlugins: { "ponytail@ponytail": false, "superpowers@superpowers-marketplace": true },
    }));
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("plugin yang DINYATAKAN nonaktif dilewati · codex config.toml", () => {
    cached("ponytail", "ponytail", "4.8.4", ["tail"]);
    cached("superpowers", "openai-curated", "11c74d6b", ["brainstorming"]);
    writeFileSync(join(root, "config.toml"),
      `[projects."/tmp/x"]\ntrust_level = "trusted"\n\n`
      + `[plugins."ponytail@ponytail"]\nenabled = false\n\n`
      + `[plugins."superpowers@openai-curated"]\nenabled = true\n`);
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("tanpa pernyataan apa pun plugin dianggap AKTIF — absen bukan penolakan", () => {
    cached("superpowers", "openai-curated", "11c74d6b", ["brainstorming"]);
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("berkas gerbang rusak tidak mengosongkan hasil (fail-open per sumber)", () => {
    cached("superpowers", "superpowers-marketplace", "6.0.3", ["brainstorming"]);
    writeFileSync(join(root, "settings.json"), "{ bukan json");
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.packages).toEqual(["superpowers"]);
  });
});

describe("scanAgentSkills · plugin dari manifest", () => {
  it("installed_plugins.json → installPath dipindai walau di luar cache", () => {
    const dir = join(root, "elsewhere", "sp");
    skill(join(dir, "skills"), "brainstorming");
    mkdirSync(join(root, "plugins"), { recursive: true });
    writeFileSync(join(root, "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: { "superpowers@superpowers-marketplace": [{ installPath: dir, version: "6.0.3" }] },
    }));
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["superpowers:brainstorming"]);
  });

  it("manifest & cache menunjuk skill yang sama → tak ada duplikat", () => {
    const dir = join(root, "plugins", "cache", "m", "superpowers", "1.0.0");
    skill(join(dir, "skills"), "brainstorming");
    mkdirSync(join(root, "plugins"), { recursive: true });
    writeFileSync(join(root, "plugins", "installed_plugins.json"), JSON.stringify({
      plugins: { "superpowers@m": [{ installPath: dir }] },
    }));
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["superpowers:brainstorming"]);
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("manifest rusak diabaikan, cache tetap terbaca", () => {
    skill(join(root, "plugins", "cache", "m", "superpowers", "1.0.0", "skills"), "brainstorming");
    mkdirSync(join(root, "plugins"), { recursive: true });
    writeFileSync(join(root, "plugins", "installed_plugins.json"), "]]]");
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["superpowers:brainstorming"]);
  });
});
