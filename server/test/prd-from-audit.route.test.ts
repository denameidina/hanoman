import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { killAll, getSession, promptFilePath, agentsFilePath } from "../src/services/pty";
import { DEFAULT_SETTING } from "../src/services/settings";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { makeRepoWithBranches } from "./factory";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

// Sesi men-spawn `claude` sungguhan bila tak distub.
process.env.HANOMAN_CLAUDE_BIN = resolve(import.meta.dirname, "fixtures/fake-claude.sh");
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "hanoman-codexhome-"));

const app = buildApp({ requireAuth: false });
const AUDIT_REL = "internal/docs/research/audit-spec-900-antrean.md";
const AUDIT_MD = "# Audit SPEC-900\n\nTEMUAN PENTING dari audit.\n";

const clean = async () => {
  await prisma.setting.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.localBinding.deleteMany();
  await prisma.project.deleteMany();
};

let repoDir = "";

beforeEach(async () => {
  killAll();
  await clean();
  repoDir = makeRepoWithBranches();
  // Dokumen audit + branch audit tempat worktree PRD nanti lahir.
  const abs = join(repoDir, AUDIT_REL);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, AUDIT_MD);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "audit doc");
  git("branch", "hanoman/spec-900");
  await prisma.project.create({ data: {
    id: "p1", name: "P1", desc: "", kind: "existing", repoDir, stack: "TS" } });
  await prisma.spec.create({ data: {
    id: "SPEC-900", projectId: "p1", title: "audit antrean", source: "audit",
    stage: "done", priority: "sedang", author: "Audit · t@t", objective: "telusuri" } });
});
afterAll(async () => { killAll(); await clean(); });

const promptOf = (id: string) => readFileSync(promptFilePath(id), "utf8");

describe("POST /terminal/sessions flow:prd dari audit (SPEC-340 · ADR-0076)", () => {
  it("memakai branchFrom untuk worktree & menyematkan dokumen audit ke prompt", async () => {
    // ADR-0164 · orkestrasi PRD dimatikan EKSPLISIT di sini: dengan orkestrasi OFF (mode tunggal),
    // dokumen audit disematkan penuh di PROMPT SESI (legacyPrompt/startPrdPrompt tanpa plan). Dengan
    // orkestrasi ON (default — lihat test "orkestrasi ON (default)" di bawah) prompt sesi HANYA
    // membawa `prdBriefBlock`; dokumen audit hidup di instruksi agen fase PRD (buildPhaseAgents),
    // dibaca lewat agentsFilePath — bukan di prompt sesi/parent.
    const data = { ...DEFAULT_SETTING,
      orchestration: { ...ORCHESTRATION_DEFAULTS, prd: { enabled: false, claude: {}, codex: {} } } };
    await prisma.setting.create({ data: { id: 1, data } });
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: {
      project: "p1", flow: "prd", brief: { title: "Kuota tenant", context: "c", outcome: "o" },
      branchFrom: "hanoman/spec-900", fromAudit: "SPEC-900" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    expect(id).toBe("prd-kuota-tenant");
    const s = getSession(id)!;
    expect(existsSync(s.cwd)).toBe(true);
    // Worktree lahir dari branch audit → dokumen audit ikut ter-checkout di sana.
    expect(existsSync(join(s.cwd, AUDIT_REL))).toBe(true);
    const prompt = promptOf(id);
    expect(prompt).toContain("DOKUMEN AUDIT SPEC-900");
    expect(prompt).toContain(AUDIT_REL);
    expect(prompt).toContain("TEMUAN PENTING dari audit.");
  });

  // ADR-0164 · jalur DEFAULT (tanpa override Setting.orchestration → orkestrasi ON untuk semua flow,
  // termasuk prd). Ini pembuktian bahwa dokumen audit BENAR-BENAR sampai ke agen fase PRD lewat
  // buildPhaseAgents — bukan cuma lewat prompt sesi tunggal (yang dites terpisah di atas dengan
  // orkestrasi dimatikan eksplisit). Mengganti `audit` jadi `undefined` di prdContext(...) pada
  // terminal.ts akan membuat test ini RED tanpa menyentuh test manapun di atas.
  it("orkestrasi ON (default): dokumen audit sampai ke agen fase PRD, bukan ke prompt sesi", async () => {
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: {
      project: "p1", flow: "prd", brief: { title: "Kuota tenant", context: "c", outcome: "o" },
      branchFrom: "hanoman/spec-900", fromAudit: "SPEC-900" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    expect(id).toBe("prd-kuota-tenant");
    const agents = JSON.parse(readFileSync(agentsFilePath(id), "utf8"));
    for (const agentName of ["hanoman-fase-brainstorm", "hanoman-fase-prd"]) {
      const p = agents[agentName].prompt as string;
      expect(p).toContain("DOKUMEN AUDIT SPEC-900");
      expect(p).toContain(AUDIT_REL);
    }
    const prompt = promptOf(id);
    expect(prompt).toContain("Sesi ini ORCHESTRATOR");
    expect(prompt).not.toContain("DOKUMEN AUDIT");
  });

  it("tanpa branchFrom/fromAudit: prompt polos (perilaku lama utuh)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: {
      project: "p1", flow: "prd", brief: { title: "PRD polos", context: "c", outcome: "o" } } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    const prompt = promptOf(id);
    expect(prompt).not.toContain("DOKUMEN AUDIT");
    expect(prompt).toContain("PRD polos");
    // ADR-0164 · orkestrasi ON (default): tanpa fromAudit sama sekali, marker audit juga harus
    // absen di agen fase — bukan cuma di prompt sesi (yang orkestrasi ON tak pernah memuatnya
    // apa pun kondisinya, jadi assertion di atas saja tak cukup membuktikan absennya audit).
    const agents = JSON.parse(readFileSync(agentsFilePath(id), "utf8"));
    expect(agents["hanoman-fase-brainstorm"].prompt).not.toContain("DOKUMEN AUDIT");
    expect(agents["hanoman-fase-prd"].prompt).not.toContain("DOKUMEN AUDIT");
  });

  it("422 bila branchFrom tak resolve di lokal maupun origin", async () => {
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: {
      project: "p1", flow: "prd", brief: { title: "PRD hantu", context: "c", outcome: "o" },
      branchFrom: "hanoman/tidak-ada" } });
    expect(res.statusCode).toBe(422);
  });

  it("fromAudit yang dokumennya tak terbaca: PRD tetap jalan, tanpa blok audit", async () => {
    await prisma.spec.create({ data: {
      id: "SPEC-901", projectId: "p1", title: "audit tanpa dokumen", source: "audit",
      stage: "done", priority: "sedang", author: "Audit · t@t", objective: "x" } });
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: {
      project: "p1", flow: "prd", brief: { title: "PRD tanpa doc", context: "c", outcome: "o" },
      fromAudit: "SPEC-901" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    expect(promptOf(id)).not.toContain("DOKUMEN AUDIT");
    // ADR-0164 · orkestrasi ON (default): fromAudit DIBERIKAN tapi dokumennya tak terbaca — pastikan
    // ia juga tak bocor ke agen fase (satu-satunya tempat audit sungguh bisa muncul saat orkestrasi
    // ON), bukan cuma absen di prompt sesi yang memang tak pernah membawanya apa pun kondisinya.
    const agents = JSON.parse(readFileSync(agentsFilePath(id), "utf8"));
    expect(agents["hanoman-fase-brainstorm"].prompt).not.toContain("DOKUMEN AUDIT");
    expect(agents["hanoman-fase-prd"].prompt).not.toContain("DOKUMEN AUDIT");
  });
});
