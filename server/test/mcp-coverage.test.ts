import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@hanoman/shared";
import { capabilityForRoute } from "../src/services/agent-capabilities";

// ADR-0155 · gerbang anti-drift #2: CAKUPAN. Katalog MCP hidup di `shared`, peta route→capability
// dan route itu sendiri hidup di `server` — berkas ini satu-satunya tempat ketiganya bertemu.
// Tanpa ia, endpoint baru yang terjangkau agent token lahir tanpa tool dan tak ada yang tahu.
//
// Inventaris dibaca dari SUMBER, bukan dari mem-boot Fastify: test ini harus merah saat berkas
// route berubah, bahkan bila route-nya belum terdaftar di app.
const ROUTES_DIR = join(__dirname, "../src/routes");

function routeInventory(): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  for (const f of readdirSync(ROUTES_DIR).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(ROUTES_DIR, f), "utf8");
    for (const m of src.matchAll(/^\s*app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/gm))
      out.push({ method: m[1]!.toUpperCase(), path: m[2]! });
  }
  return out;
}

// Route yang SENGAJA tak punya tool MCP. Alasannya wajib ditulis di sebelahnya — daftar tanpa
// alasan kehilangan gunanya dalam beberapa bulan.
const UNWRAPPED = new Map<string, string>([
  ["POST /specs/:id/attachments", "multipart — tak ada bentuk masuk akal lewat tool teks"],
  ["POST /projects/:id/upload", "multipart"],
  ["GET /projects/:id/archive", "biner (zip)"],
  ["GET /terminal/sessions/:id/ws", "WebSocket, bukan request-response"],
]);

/** Path route Fastify (`/specs/:id`) → regex yang mencocokkan samplePath katalog (`/specs/SPEC-1`). */
const toPattern = (p: string) =>
  new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+").replace(/\*/g, ".*") + "$");

describe("cakupan katalog MCP", () => {
  it("inventaris route terbaca dari sumber, bukan kosong karena regex meleset", () => {
    const inv = routeInventory();
    expect(inv.length).toBeGreaterThan(200);
    expect(inv).toContainEqual({ method: "GET", path: "/specs" });
    expect(inv).toContainEqual({ method: "POST", path: "/terminal/sessions" });
  });

  // Dinyalakan (skip dibuang) di rencana katalog terakhir, saat 135 tool sudah lahir.
  // MELONGGARKAN assert-nya alih-alih men-skip akan membuat gerbang ini bohong selamanya.
  it.skip("setiap route yang TERJANGKAU agent token punya tool, atau terdaftar dikecualikan", () => {
    const missing: string[] = [];
    for (const r of routeInventory()) {
      const cap = capabilityForRoute(r.method, r.path);
      if (cap === null || cap === "COOKIE_ONLY" || cap === "GLOBAL_READ") continue;
      const key = `${r.method} ${r.path}`;
      if (UNWRAPPED.has(key)) continue;
      const re = toPattern(r.path);
      if (!MCP_TOOLS.some((t) => t.sampleMethod === r.method && re.test(t.samplePath))) missing.push(key);
    }
    expect(missing, `route terjangkau tanpa tool MCP:\n${missing.join("\n")}`).toEqual([]);
  });

  it("setiap samplePath katalog menuntut capability yang persis diakui tool-nya", () => {
    for (const t of MCP_TOOLS) {
      if (!t.capability) continue;
      expect(capabilityForRoute(t.sampleMethod, `/api${t.samplePath}`), t.name).toBe(t.capability);
    }
  });

  it("daftar dikecualikan tak memuat route yang sudah tak ada", () => {
    const keys = new Set(routeInventory().map((r) => `${r.method} ${r.path}`));
    for (const k of UNWRAPPED.keys()) expect(keys.has(k), k).toBe(true);
  });

  it("gerbang cakupan benar-benar mendeteksi route yang lupa dibungkus", () => {
    // Kontrol negatif: kalau assert ini gagal, gerbang di atas hijau palsu.
    const fake = { method: "GET", path: "/specs/:id/tak-pernah-ada" };
    expect(capabilityForRoute(fake.method, fake.path)).toBe("backlog:read");
    const re = toPattern(fake.path);
    expect(MCP_TOOLS.some((t) => t.sampleMethod === "GET" && re.test(t.samplePath))).toBe(false);
  });
});
