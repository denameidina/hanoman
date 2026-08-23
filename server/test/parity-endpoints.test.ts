import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";

// SPEC-213 · AC-23 · additive: tak ada endpoint hari ini yang boleh hilang. Snapshot daftar
// route baseline (dari kode sebelum SPEC-213) ⊆ route sekarang. Sekaligus memastikan surface
// sync baru terdaftar.
const app = buildApp();
let routes = "";
beforeAll(async () => { await app.ready(); routes = app.printRoutes({ commonPrefix: false }); });

const BASELINE = [
  "/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup", "/api/auth/logout",
  "/api/auth/users", "/api/auth/change-password",
  "/api/projects", "/api/specs", "/api/prds", "/api/notifications", "/api/settings",
  "/tree", "/file", "/graph",          // ide (di bawah /api/projects/:id)
  "/api/fs/browse", "/api/terminal/sessions", "/api/vps", "/api/limits", "/api/events/ws",
];
const NEW_SYNC = ["/api/device-tokens", "/api/sync/pull", "/api/sync/push", "/api/sync/ws", "/api/session-results"];
// SPEC-909 · ADR-0146 · permukaan event hook sesi. Terdaftar di daftar ini karena route baru yang
// lupa di-`register` gagal SENYAP: gate cookie sudah di-bypass untuk path-nya, jadi hook cuma
// menerima 404 tanpa satu pun jejak.
const NEW_SESSION_EVENTS = ["/api/session-events"];

describe("parity: endpoint baseline preserved (SPEC-213 AC-23)", () => {
  it("every baseline endpoint still registered", () => {
    for (const p of BASELINE) expect(routes, `hilang: ${p}`).toContain(p);
  });
  it("new sync surface registered", () => {
    for (const p of NEW_SYNC) expect(routes, `belum ada: ${p}`).toContain(p);
  });
  it("session events surface registered (SPEC-909)", () => {
    for (const p of NEW_SESSION_EVENTS) expect(routes, `belum ada: ${p}`).toContain(p);
  });
});
