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
// SPEC-919 · ADR-0147 · alasan yang sama: `ClientsScreen` menelan kegagalan `api.presence()`
// dengan `.catch(() => {})` (server lama menjawab 404 di sana), jadi route yang lupa di-`register`
// hanya terlihat sebagai halaman Klien yang diam kosong.
const NEW_PRESENCE = ["/api/presence"];
// SPEC-945 · ADR-0150 · alasan yang sama sekali lagi: papan tim adalah permukaan yang HANYA
// dijangkau lewat cookie, jadi route yang lupa di-`register` terbaca sebagai 401/404 yang
// tak terbedakan dari "belum login" — bukan sebagai kesalahan pemasangan.
const NEW_TEAM = ["/api/members", "/api/tasks",
  "/escalate"];   // SPEC-947 · ADR-0152 · di bawah /api/tasks/:id, cermin bentuk ide di BASELINE

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
  it("presence surface registered (SPEC-919)", () => {
    for (const p of NEW_PRESENCE) expect(routes, `belum ada: ${p}`).toContain(p);
  });
  it("team surface registered (SPEC-945)", () => {
    for (const p of NEW_TEAM) expect(routes, `belum ada: ${p}`).toContain(p);
  });
});
