// ADR-0160 · fallback SPA: path router (`/backlog`, `/projects/<id>`, …) dijawab index.html supaya
// refresh & link yang dibagikan mendarat di layar yang benar; `/api/*` tetap 404 JSON; dan
// `/assets/*` yang hilang (chunk rilis lama, SPEC-868) 404 POLOS — bukan index.html yang dikira
// JavaScript oleh `import()` layar malas.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";

const web = mkdtempSync(join(tmpdir(), "hanoman-web-"));
writeFileSync(join(web, "index.html"), "<!doctype html><div id=\"root\"></div>");
const app = buildApp({ env: { ...process.env, HANOMAN_WEB_DIR: web } });
afterAll(async () => { await app.close(); rmSync(web, { recursive: true, force: true }); });

describe("fallback SPA (ADR-0160)", () => {
  it.each(["/backlog", "/backlog/SPEC-1", "/projects/toko-mekar", "/changelog/p1/c1", "/review/spec/SPEC-2", "/settings"])(
    "%s → index.html", async (url) => {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toMatch(/text\/html/);
      expect(r.body).toContain('id="root"');
    });

  it("/api/* yang tak ada tetap 404 JSON, bukan halaman", async () => {
    const r = await app.inject({ method: "GET", url: "/api/tidak-ada" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "not found" });
  });

  it("/assets/* yang hilang → 404 polos, bukan index.html", async () => {
    const r = await app.inject({ method: "GET", url: "/assets/index-lama.js" });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('id="root"');
  });
});
