import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Setting } from "@hanoman/shared";
import { getSetting } from "../src/services/settings";
import { leadAgentDefaults } from "../src/services/lead/config";
import { decide, prodDecideDeps, type DecideDeps } from "../src/services/lead/decide";
import { __resetLeadGate } from "../src/services/lead/gate";
import { __resetDeciding } from "../src/services/lead/deciding";

// SPEC-488 · runtime/model/effort agen lead disetel operator, dan setelan itu harus benar-benar
// sampai ke ARGV proses lead — bukan sekadar tersimpan. Rantainya:
//
//   Setting.data.lead.engine → leadAgentDefaults() → decide() → brain.think() → leadArgv() → argv
//
// Sampai spec ini rantai itu tak punya satu pun test: `lead-decide.test.ts` menyuntik `think`
// sebagai stub (kelas jebakan SPEC-448), jadi `brain.ts` tak pernah dieksekusi olehnya dan
// `leadAgentDefaults()` tak pernah dipanggil sama sekali.

const FAKE = fileURLToPath(new URL("./fixtures/fake-lead-argv.sh", import.meta.url));
chmodSync(FAKE, 0o755);

let argvFile = "";

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.leadFlow.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};

beforeEach(async () => {
  await clean();
  __resetLeadGate(); __resetDeciding();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
  argvFile = join(mkdtempSync(join(tmpdir(), "lead-argv-")), "argv.txt");
  process.env.HANOMAN_LEAD_ARGV_FILE = argvFile;
  process.env.HANOMAN_CLAUDE_BIN = FAKE;
  process.env.HANOMAN_CODEX_BIN = FAKE;
});
afterEach(() => {
  delete process.env.HANOMAN_LEAD_ARGV_FILE;
  delete process.env.HANOMAN_CLAUDE_BIN;
  delete process.env.HANOMAN_CODEX_BIN;
  delete process.env.HANOMAN_ANTIGRAVITY_BIN;
});
afterAll(clean);

/** Tulis seluruh blok Setting sekaligus — perlu karena test ini menggeser `agent`/`codex` GLOBAL. */
async function putSetting(over: Partial<Setting>): Promise<void> {
  const data = { ...(await getSetting()), ...over } as unknown as object;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
}

const leadOn = (engine: Partial<Setting["lead"]["engine"]> = {}) => ({
  ...LEAD_DEFAULTS, enabled: true,
  engine: { ...LEAD_DEFAULTS.engine, ...engine },
});

/** Argv yang benar-benar dilihat proses lead, satu argumen per baris (prompt tak direkam). */
const recordedArgv = (): string[] =>
  existsSync(argvFile) ? readFileSync(argvFile, "utf8").split("\n").filter(Boolean) : [];

/** Nilai yang mengikuti sebuah flag di argv. `undefined` bila flag-nya tak ada sama sekali. */
const after = (argv: string[], flag: string): string | undefined =>
  argv.indexOf(flag) === -1 ? undefined : argv[argv.indexOf(flag) + 1];

// `prodDecideDeps` dipakai APA ADANYA untuk `think` & `defaults` — itulah inti test ini. Hanya
// pembacaan tmux & notifikasi yang dilucuti: keduanya di luar rantai yang sedang dibuktikan, dan
// `listSessions()` menembak `tmux` sungguhan di mesin yang menjalankan test.
const argvDeps: DecideDeps = { ...prodDecideDeps, liveSessions: () => [], notify: async () => {} };
const ask = { projectId: "demo", gate: "contract", kind: "answer", question: "Lanjut?" } as const;

describe("leadAgentDefaults · setelan lead vs warisan default sesi", () => {
  it("engine mati → warisan default sesi claude (perilaku lama, tanpa kejutan)", async () => {
    await putSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh", lead: leadOn() });
    expect(await leadAgentDefaults()).toEqual({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
  });

  it("engine mati + agen global codex → lead ikut codex, bukan claude", async () => {
    await putSetting({
      agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" }, lead: leadOn(),
    });
    expect(await leadAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  it("engine hidup → triple lead menang atas default sesi", async () => {
    await putSetting({
      agent: "claude", model: "claude-opus-5", effort: "xhigh",
      lead: leadOn({ enabled: true, agent: "claude", model: "claude-sonnet-5", effort: "low" }),
    });
    expect(await leadAgentDefaults()).toEqual({ agent: "claude", model: "claude-sonnet-5", effort: "low" });
  });

  it("engine codex → effort dikoersi ke yang didukung MODEL-nya (SPEC-339)", async () => {
    // Luna tak mendukung `ultra`; menyimpannya apa adanya berarti lead lahir dengan pasangan
    // yang ditolak codex.
    await putSetting({ lead: leadOn({ enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "ultra" }) });
    expect(await leadAgentDefaults()).toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });
});

describe("SPEC-488 · setelan lead sampai ke ARGV proses lead", () => {
  it("engine hidup (claude) → --model/--effort persis dari setelan", async () => {
    await putSetting({
      model: "claude-opus-5", effort: "xhigh",
      lead: leadOn({ enabled: true, agent: "claude", model: "claude-sonnet-5", effort: "low" }),
    });
    const row = await decide({ ...ask }, argvDeps);
    expect(row?.status).toBe("berlaku");
    const argv = recordedArgv();
    expect(argv[0]).toBe("-p");
    expect(after(argv, "--model")).toBe("claude-sonnet-5");
    expect(after(argv, "--effort")).toBe("low");
  });

  it("engine hidup (codex) → `exec -m` + `-c model_reasoning_effort`", async () => {
    await putSetting({ lead: leadOn({ enabled: true, agent: "codex", model: "gpt-5.6-terra", effort: "medium" }) });
    const row = await decide({ ...ask }, argvDeps);
    expect(row?.status).toBe("berlaku");
    const argv = recordedArgv();
    expect(argv[0]).toBe("exec");
    expect(after(argv, "-m")).toBe("gpt-5.6-terra");
    expect(argv).toContain('model_reasoning_effort="medium"');
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("engine mati → argv memakai default sesi global (fallback ke perilaku lama)", async () => {
    await putSetting({
      agent: "claude", model: "claude-haiku-4-5", effort: "medium", lead: leadOn(),
    });
    const row = await decide({ ...ask }, argvDeps);
    expect(row?.status).toBe("berlaku");
    const argv = recordedArgv();
    expect(after(argv, "--model")).toBe("claude-haiku-4-5");
    expect(after(argv, "--effort")).toBe("medium");
  });

  // AC "ganti setting tanpa restart server": `getSetting()` membaca baris DB tiap panggilan dan
  // `leadAgentDefaults()` dipanggil DI DALAM `decide()`. Sifat itu tak boleh berubah diam-diam —
  // siapa pun yang kelak memasang cache di `getSetting()` harus melihat test ini merah.
  it("setelan diganti di tengah proses yang sama → putusan BERIKUTNYA memakai argv baru", async () => {
    await putSetting({ lead: leadOn({ enabled: true, agent: "claude", model: "claude-sonnet-5", effort: "low" }) });
    await decide({ ...ask }, argvDeps);
    await putSetting({ lead: leadOn({ enabled: true, agent: "claude", model: "claude-fable-5", effort: "high" }) });
    await decide({ ...ask }, argvDeps);

    const argv = recordedArgv();
    // Dua panggilan → dua rekaman berurutan di berkas yang sama.
    expect(argv.filter((a) => a === "claude-sonnet-5")).toHaveLength(1);
    expect(argv.filter((a) => a === "claude-fable-5")).toHaveLength(1);
    expect(argv.filter((a) => a === "high")).toHaveLength(1);
  });
});


it("Antigravity advisor executable JSON envelope is parsed into a valid lead decision", async () => {
  const bin = join(mkdtempSync(join(tmpdir(), "lead-agy-")), "fake agy");
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs'); fs.writeFileSync(process.env.HANOMAN_LEAD_ARGV_FILE, process.argv.slice(2,-1).join('\\n'));
process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({status:'SUCCESS',response:'{"decision":"lanjut","reason":"argv terekam","confidence":"tinggi"}'})));
`, { mode: 0o700 });
  process.env.HANOMAN_ANTIGRAVITY_BIN = bin;
  await putSetting({ agent: "antigravity", antigravity: { model: "gemini-3.8-flash-high", effort: "high" }, lead: leadOn() });
  const row = await decide(ask, argvDeps);
  expect(row?.status).toBe("berlaku");
  const argv = recordedArgv();
  expect(argv).toContain("-p"); expect(after(argv, "--output-format")).toBe("json");
  expect(after(argv, "--model")).toBe("gemini-3.8-flash-high");
  expect(after(argv, "--effort")).toBe("high");
});
