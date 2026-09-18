import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp();
const clean = async () => { await prisma.user.deleteMany(); };
beforeEach(clean);

describe("POST /api/ws-tickets — target relay:<deviceId>:… (SPEC-1218 · prasyarat C1-C9)", () => {
  it("req.user → 200 untuk relay:dev1:events dan relay:dev1:terminal:abc", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op@d.co", password: "password1" } });
    const cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
    for (const target of ["relay:dev1:events", "relay:dev1:terminal:abc"]) {
      const res = await app.inject({ method: "POST", url: "/api/ws-tickets", headers: { cookie }, payload: { target } });
      expect(res.statusCode).toBe(200);
      expect(res.json().ticket).toEqual(expect.any(String));
    }
  });

  it("target relay malformed (dua titik dua/kosong deviceId) → 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op2@d.co", password: "password1" } });
    const cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
    const res = await app.inject({ method: "POST", url: "/api/ws-tickets", headers: { cookie }, payload: { target: "relay::events" } });
    expect(res.statusCode).toBe(400);
  });
});
