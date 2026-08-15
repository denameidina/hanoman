import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";
import { findTombstone } from "../src/services/tombstone";
import { pull } from "../src/services/sync";
import { pruneOldTickets } from "../src/services/ticket";

// Pola test route repo ini: auth dimatikan di level app, fixture lewat ./factory.
const app = buildApp({ requireAuth: false });
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await resetDb(); });

const feedHasDelete = (entity: string, id: string) =>
  pull("0").then((f) => f.records.some((r) => r.entity === entity && r.recordId === id && r.op === "delete"));

describe("route DELETE menerbitkan tombstone (SPEC-799 · ADR-0119)", () => {
  it("DELETE /projects/:id", async () => {
    await makeProject({ id: "p1" });
    const res = await app.inject({ method: "DELETE", url: "/api/projects/p1" });
    expect(res.statusCode).toBe(204);
    expect(await findTombstone("project", "p1")).not.toBeNull();
    expect(await feedHasDelete("project", "p1")).toBe(true);
  });

  it("DELETE /specs/:id", async () => {
    await makeProject({ id: "p1" });
    await makeSpec({ id: "SPEC-1", projectId: "p1" });
    await app.inject({ method: "DELETE", url: "/api/specs/SPEC-1" });
    expect(await findTombstone("spec", "SPEC-1")).not.toBeNull();
    expect(await feedHasDelete("spec", "SPEC-1")).toBe(true);
  });

  it("DELETE /vps/:id", async () => {
    await prisma.vps.create({ data: { id: "v1", name: "v", host: "h", user: "root" } });
    await app.inject({ method: "DELETE", url: "/api/vps/v1" });
    expect(await findTombstone("vps", "v1")).not.toBeNull();
    expect(await feedHasDelete("vps", "v1")).toBe(true);
  });

  it("DELETE /vps/:id yang tak ada tetap 404", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/vps/tak-ada" })).statusCode).toBe(404);
  });

  it("DELETE /tickets/:id", async () => {
    await makeProject({ id: "p1" });
    await prisma.ticket.create({ data: { id: "t1", projectId: "p1", number: 1, category: "bug",
      title: "t", detail: "d", reporterEmail: "a@b.co", status: "new", accessKeyHash: "h1" } });
    await app.inject({ method: "DELETE", url: "/api/tickets/t1" });
    expect(await findTombstone("ticket", "t1")).not.toBeNull();
    expect(await feedHasDelete("ticket", "t1")).toBe(true);
  });

  it("DELETE /custom-agents/:id", async () => {
    await prisma.customAgent.create({ data: { id: "global:reviewer", name: "reviewer",
      description: "d", instructions: "i" } });
    await app.inject({ method: "DELETE", url: "/api/custom-agents/global%3Areviewer" });
    expect(await findTombstone("customAgent", "global:reviewer")).not.toBeNull();
  });

  it("DELETE /session-results (purge) menerbitkan satu tombstone per baris", async () => {
    await prisma.sessionResult.create({ data: { id: "sr1", projectId: "p1", status: "ok" } });
    await prisma.sessionResult.create({ data: { id: "sr2", projectId: "p1", status: "ok" } });
    const res = await app.inject({ method: "DELETE", url: "/api/session-results?projectId=p1" });
    expect(res.json()).toMatchObject({ purged: 2 });
    expect(await findTombstone("sessionResult", "sr1")).not.toBeNull();
    expect(await findTombstone("sessionResult", "sr2")).not.toBeNull();
  });

  it("prune retensi TIDAK menerbitkan tombstone (batas yang sudah ada, dinyatakan)", async () => {
    await makeProject({ id: "p1" });
    const tua = new Date(Date.now() - 400 * 86_400_000);
    await prisma.ticket.create({ data: { id: "t-tua", projectId: "p1", number: 9, category: "bug",
      title: "t", detail: "d", reporterEmail: "a@b.co", status: "rejected", accessKeyHash: "h9",
      createdAt: tua } });
    await pruneOldTickets();
    expect(await prisma.ticket.findUnique({ where: { id: "t-tua" } })).toBeNull();
    expect(await findTombstone("ticket", "t-tua")).toBeNull();
  });
});
