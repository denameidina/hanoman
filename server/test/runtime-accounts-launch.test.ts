import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import { buildApp } from "../src/app";
import { beginSession, reconcileHistory, reconciledRuntimesSince } from "../src/services/session-history";
import { prodResumeStart, resumeReconciledSessions } from "../src/services/session-boot-resume";
import { accountIdForLoginSession, loginSessionId } from "../src/services/runtime-accounts/login";
import { _setAccountSnapshot, refreshSnapshot } from "../src/services/runtime-accounts/registry";

// ADR-0234 · akun runtime ikut lahir bersama sesi, tercatat di riwayat, dan dipakai lagi oleh resume.
const home = mkdtempSync(join(tmpdir(), "ra-launch-"));
const prev = process.env.HANOMAN_HOME;
process.env.HANOMAN_HOME = home;
const PROJECT_ID = "ra-launch-proj";

const clean = async () => {
  await prisma.notification.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.sessionHistory.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.spec.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  await prisma.runtimeAccount.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: PROJECT_ID, name: "RA launch", desc: "", kind: "existing" } });
  await refreshSnapshot();
});
afterAll(async () => {
  await clean();
  if (prev === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

const seedSpec = (id: string) => prisma.spec.create({
  data: { id, projectId: PROJECT_ID, title: "Judul", source: "brief", priority: "sedang", author: "t", objective: "o", stage: "executing" },
});

describe("riwayat & resume membawa akun", () => {
  it("beginSession menyimpan accountId; reconciledRuntimesSince mengembalikannya", async () => {
    await seedSpec("SPEC-9301");
    await beginSession({ sessionId: "spec-9301", projectId: PROJECT_ID, specId: "SPEC-9301", kind: "spec", agent: "codex", cwd: "/w", accountId: "a1b2c3d4" });
    const row = await prisma.sessionHistory.findFirstOrThrow({ where: { sessionId: "spec-9301" } });
    expect(row.accountId).toBe("a1b2c3d4");
    const cutoff = new Date();
    await reconcileHistory([]);
    const rt = await reconciledRuntimesSince(cutoff);
    expect(rt.get("SPEC-9301")).toMatchObject({ agent: "codex", accountId: "a1b2c3d4" });
  });

  it("auto-resume dengan akun yang sudah dihapus → failed + alasan, bukan pindah akun", async () => {
    await seedSpec("SPEC-9302");
    await beginSession({ sessionId: "spec-9302", projectId: PROJECT_ID, specId: "SPEC-9302", kind: "spec", agent: "claude", cwd: "/w", accountId: "deadbeef" });
    const cutoff = new Date();
    await reconcileHistory([]);
    _setAccountSnapshot({ rows: [] });
    const fails: string[] = [];
    const report = await resumeReconciledSessions(cutoff, {
      startSpec: prodResumeStart,
      recordFail: async (_s, _t, _p, reason) => { fails.push(reason); },
      recordDeferred: async () => { throw new Error("tak boleh ditunda"); },
    });
    expect(report.failed).toEqual(["SPEC-9302"]);
    expect(fails[0]).toMatch(/akun runtime deadbeef sudah dihapus/);
  });
});

describe("id sesi login", () => {
  it("dua arah, termasuk akun bawaan", () => {
    _setAccountSnapshot({ rows: [{ id: "a1b2c3d4", runtime: "claude", label: "K", homeDir: "/h", identity: null, status: "belum-login", createdAt: new Date(), lastLoginAt: null }] });
    expect(loginSessionId("a1b2c3d4")).toBe("acct-login-a1b2c3d4");
    expect(loginSessionId("default:codex")).toBe("acct-login-default-codex");
    expect(accountIdForLoginSession("acct-login-a1b2c3d4")).toBe("a1b2c3d4");
    expect(accountIdForLoginSession("acct-login-default-codex")).toBe("default:codex");
    expect(accountIdForLoginSession("spec-1")).toBeNull();
  });
});

describe("POST /terminal/sessions + account", () => {
  const app = buildApp({ requireAuth: false });
  afterAll(async () => { await app.close(); });

  it("akun backlog tak dikenal → 404 account-not-found, sesi tak lahir", async () => {
    await seedSpec("SPEC-9303");
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-9303", flow: "feature", agent: "claude", account: "deadbeef" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "account-not-found" });
  });

  it("akun milik runtime lain → 409 account-runtime-mismatch", async () => {
    await seedSpec("SPEC-9304");
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-9304", flow: "feature", agent: "claude", account: "default:codex" } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "account-runtime-mismatch" });
  });
});
