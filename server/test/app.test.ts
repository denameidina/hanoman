import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app";
describe("app", () => {
  it("health returns ok", async () => {
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200); expect(res.json()).toEqual({ ok: true });
  });
  it("unknown run-control route is 404 (no stub)", async () => {
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "POST", url: "/api/runs/RUN-0000/control", payload: { action: "stop" } });
    expect(res.statusCode).toBe(404);
  });
  it("enforces public/control host separation before auth", async () => {
    const app = buildApp({
      requireAuth: false,
      env: {
        HANOMAN_PUBLIC_ORIGINS: "https://help.example",
        HANOMAN_CONTROL_ORIGINS: "https://admin.example",
      },
    });
    expect((await app.inject({ method: "GET", url: "/api/health", headers: { host: "help.example" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/settings", headers: { host: "help.example" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/help/p/tickets", headers: { host: "admin.example" } })).statusCode).toBe(404);
    await app.close();
  });
});
