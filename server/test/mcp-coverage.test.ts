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
  // ADR-0157 · GLOBAL_READ tapi tetap di luar: kanal siar, bukan request-response. Tool MCP tak
  // punya bentuk untuk aliran yang tak pernah selesai.
  ["GET /events/ws", "WebSocket siar, bukan request-response"],
  // Byte mentah dengan content-disposition: lampiran bisa berupa gambar, dan tool teks akan
  // mengembalikan sampah. Sekelas dengan `archive` di atas.
  ["GET /specs/:id/attachments/:attId", "biner (unduhan lampiran)"],
  ["GET /tickets/:id/attachments/:attId", "biner (unduhan lampiran)"],
  ["POST /terminal/sessions/:id/attachments", "multipart"],
  // SPEC-899 · ADR-0142 · BUKAN kelalaian: agen yang bisa menjawab `AskUserQuestion` bisa menjawab
  // pertanyaannya SENDIRI, dan gerbang "manusia yang terakhir memutuskan" runtuh lewat pintu itu.
  // Assert terpisah di mcp-capability.test.ts menjaga agar tak ada samplePath yang memuat /dialog.
  ["GET /terminal/sessions/:id/dialog", "gerbang keputusan manusia (SPEC-899)"],
  ["POST /terminal/sessions/:id/dialog/answer", "gerbang keputusan manusia (SPEC-899)"],
  ["POST /terminal/sessions/:id/dialog/takeover", "gerbang keputusan manusia (SPEC-899)"],
]);

// Route yang TERCAKUP tool bercabang. Tool semacam itu memilih endpoint menurut argumen (isi `q` →
// /graph/search; isi `path` → /commit/:sha/file), dan `samplePath` hanya bisa menyebut SATU cabang.
// Dicatat di sini dengan NAMA tool-nya, bukan sekadar di-skip: bila tool-nya berganti nama atau
// hilang, assert di bawah merah — jadi daftar ini tak bisa jadi tempat menyembunyikan route.
const COVERED_BY_BRANCH = new Map<string, string>([
  ["GET /projects/:id/prds", "hanoman_prds_list"],
  ["GET /projects/:id/graph/search", "hanoman_ide_graph"],
  ["GET /projects/:id/compare/file", "hanoman_ide_compare"],
  ["GET /projects/:id/commit/:sha/file", "hanoman_ide_commit"],
  ["GET /projects/:id/worktrees/stats", "hanoman_ide_worktrees_list"],
  ["GET /specs/:id/review/*", "hanoman_backlog_review"],
  ["GET /terminal/sessions/:id/review/*", "hanoman_session_review"],
  ["POST /vps/:id/items/na-bulk", "hanoman_vps_item_na"],
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

  it("setiap route yang TERJANGKAU agent token punya tool, atau terdaftar dikecualikan", () => {
    const missing: string[] = [];
    for (const r of routeInventory()) {
      const cap = capabilityForRoute(r.method, r.path);
      if (cap === null || cap === "COOKIE_ONLY" || cap === "GLOBAL_READ") continue;
      const key = `${r.method} ${r.path}`;
      if (UNWRAPPED.has(key) || COVERED_BY_BRANCH.has(key)) continue;
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

  // ADR-0157 · lubang yang sempat ada: `GLOBAL_READ` di-`continue` oleh assert di atas, sehingga
  // `/limits`, `/limits/codex`, `/update`, dan `/fs/browse` terlihat "tercakup" sementara nol tool
  // menyentuhnya — padahal SETIAP agent token sah bisa memanggilnya lewat REST tanpa satu pun
  // capability dicentang. Route paling longgar justru yang paling mudah lolos dari gerbang.
  it("setiap route GLOBAL_READ punya tool, atau terdaftar dikecualikan", () => {
    const missing: string[] = [];
    for (const r of routeInventory()) {
      if (capabilityForRoute(r.method, r.path) !== "GLOBAL_READ") continue;
      const key = `${r.method} ${r.path}`;
      if (UNWRAPPED.has(key) || COVERED_BY_BRANCH.has(key)) continue;
      const re = toPattern(r.path);
      if (!MCP_TOOLS.some((t) => t.sampleMethod === r.method && re.test(t.samplePath))) missing.push(key);
    }
    expect(missing, `route GLOBAL_READ tanpa tool MCP:\n${missing.join("\n")}`).toEqual([]);
  });

  // Sisi lain dari assert yang sama: `capability: null` berarti "tak menuntut apa pun", dan itu
  // hanya boleh benar untuk route GLOBAL_READ. Tanpa assert ini, sebuah tool bisa menyentuh route
  // bergerbang sambil mengaku bebas capability, dan yang menemukannya adalah 403 di lapangan.
  it("tool tanpa capability hanya menyentuh route GLOBAL_READ", () => {
    for (const t of MCP_TOOLS) {
      if (t.capability) continue;
      expect(capabilityForRoute(t.sampleMethod, `/api${t.samplePath}`), t.name).toBe("GLOBAL_READ");
    }
  });

  it("daftar dikecualikan tak memuat route yang sudah tak ada", () => {
    const keys = new Set(routeInventory().map((r) => `${r.method} ${r.path}`));
    for (const k of UNWRAPPED.keys()) expect(keys.has(k), k).toBe(true);
    for (const k of COVERED_BY_BRANCH.keys()) expect(keys.has(k), k).toBe(true);
  });

  it("setiap route bercabang benar-benar punya tool yang diklaimnya", () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    for (const [route, tool] of COVERED_BY_BRANCH) expect(names.has(tool), `${route} → ${tool}`).toBe(true);
  });

  it("gerbang cakupan benar-benar mendeteksi route yang lupa dibungkus", () => {
    // Kontrol negatif: kalau assert ini gagal, gerbang di atas hijau palsu.
    const fake = { method: "GET", path: "/specs/:id/tak-pernah-ada" };
    expect(capabilityForRoute(fake.method, fake.path)).toBe("backlog:read");
    const re = toPattern(fake.path);
    expect(MCP_TOOLS.some((t) => t.sampleMethod === "GET" && re.test(t.samplePath))).toBe(false);
  });
});
