import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";

const app = buildApp({ env: { NODE_ENV: "test" } });
const cookieOf = (response: { headers: Record<string, unknown> }): string =>
  (response.headers["set-cookie"] as string).split(";")[0]!;

const workspace = (sessionId: string) => ({
  version: 1 as const,
  groups: [{
    id: "utama",
    name: "Utama",
    layout: { rows: 1, cols: 2, cells: [sessionId, null] },
  }],
});

async function createAdmin(email: string, password: string): Promise<{ cookie: string; id: string }> {
  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password) },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  expect(login.statusCode).toBe(200);
  return { cookie: cookieOf(login), id: user.id };
}

beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await app.close();
});

describe("terminal workspace per admin", () => {
  it("starts empty, persists for one user, and remains isolated from another user", async () => {
    const first = await createAdmin("first@example.com", "password1");
    const second = await createAdmin("second@example.com", "password2");

    const empty = await app.inject({ method: "GET", url: "/api/terminal/workspace", headers: { cookie: first.cookie } });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ workspace: null, revision: 0, updatedAt: null });

    const saved = await app.inject({
      method: "PUT",
      url: "/api/terminal/workspace",
      headers: { cookie: first.cookie },
      payload: { baseRevision: 0, workspace: workspace("session-a") },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ workspace: workspace("session-a"), revision: 1 });
    expect(saved.json().updatedAt).toEqual(expect.any(String));

    const other = await app.inject({ method: "GET", url: "/api/terminal/workspace", headers: { cookie: second.cookie } });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual({ workspace: null, revision: 0, updatedAt: null });
  });

  it("rejects a stale revision with the current snapshot and leaves the winner intact", async () => {
    const admin = await createAdmin("conflict@example.com", "password1");
    await app.inject({
      method: "PUT",
      url: "/api/terminal/workspace",
      headers: { cookie: admin.cookie },
      payload: { baseRevision: 0, workspace: workspace("winner") },
    });

    const stale = await app.inject({
      method: "PUT",
      url: "/api/terminal/workspace",
      headers: { cookie: admin.cookie },
      payload: { baseRevision: 0, workspace: workspace("stale") },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "revision-conflict",
      current: { workspace: workspace("winner"), revision: 1 },
    });

    const current = await app.inject({ method: "GET", url: "/api/terminal/workspace", headers: { cookie: admin.cookie } });
    expect(current.json()).toMatchObject({ workspace: workspace("winner"), revision: 1 });
  });

  it("validates request bodies without changing stored state", async () => {
    const admin = await createAdmin("invalid@example.com", "password1");
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/terminal/workspace",
      headers: { cookie: admin.cookie },
      payload: { baseRevision: 0, workspace: { version: 2, groups: [] } },
    });
    expect(invalid.statusCode).toBe(400);

    const current = await app.inject({ method: "GET", url: "/api/terminal/workspace", headers: { cookie: admin.cookie } });
    expect(current.json()).toEqual({ workspace: null, revision: 0, updatedAt: null });
  });

  it("fails closed when persisted JSON is invalid", async () => {
    const admin = await createAdmin("corrupt@example.com", "password1");
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "terminalWorkspace" = ?, "terminalWorkspaceRevision" = 3 WHERE "id" = ?`,
      JSON.stringify({ version: 99, groups: [] }),
      admin.id,
    );

    const response = await app.inject({ method: "GET", url: "/api/terminal/workspace", headers: { cookie: admin.cookie } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "stored terminal workspace is invalid" });

    const repair = await app.inject({
      method: "PUT",
      url: "/api/terminal/workspace",
      headers: { cookie: admin.cookie },
      payload: { baseRevision: 3, workspace: workspace("replacement") },
    });
    expect(repair.statusCode).toBe(422);

    const row = await prisma.$queryRawUnsafe<Array<{ terminalWorkspaceRevision: number }>>(
      `SELECT "terminalWorkspaceRevision" FROM "User" WHERE "id" = ?`,
      admin.id,
    );
    expect(row[0]!.terminalWorkspaceRevision).toBe(3);
  });
});
