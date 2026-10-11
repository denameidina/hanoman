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
    // ADR-0199 · regex LAMA hanya mengenal receiver `app.`, jadi route di scope bersarang
    // (`logs.post("/sync/logs")`, `qb.get|put("/sync/qa-attachments/:id")` di sync.ts) tak pernah
    // masuk inventaris. Receiver apa pun boleh, tetapi path WAJIB berawalan "/" — itu yang
    // membedakan route dari `map.get("kunci")`.
    for (const m of src.matchAll(/^\s*[A-Za-z_$][\w$]*\.(get|post|patch|put|delete)\(\s*"(\/[^"]*)"/gm))
      out.push({ method: m[1]!.toUpperCase(), path: m[2]! });
    // `app.route({ method, url })` (devices-relay.ts). Method literal → satu entri; array/identifier
    // (mis. `NON_GET_METHODS`) tak bisa dibaca statis → semua method bermutasi, supaya tak ada yang lolos.
    for (const m of src.matchAll(/\.route\(\{\s*method:\s*(?:"(\w+)"|[^,]+),\s*url:\s*"([^"]+)"/g))
      for (const method of m[1] ? [m[1].toUpperCase()] : ["POST", "PUT", "PATCH", "DELETE"])
        out.push({ method, path: m[2]! });
  }
  return out;
}

// Route yang SENGAJA tak punya tool MCP. Alasannya wajib ditulis di sebelahnya — daftar tanpa
// alasan kehilangan gunanya dalam beberapa bulan.
const UNWRAPPED = new Map<string, string>([
  ["GET /terminal/sessions/:id/ws", "WebSocket, bukan request-response"],
  // ADR-0157 · GLOBAL_READ tapi tetap di luar: kanal siar, bukan request-response. Tool MCP tak
  // punya bentuk untuk aliran yang tak pernah selesai.
  ["GET /events/ws", "WebSocket siar, bukan request-response"],
  // ADR-0183 · route multipart/biner (lampiran, ekspor, impor, unggah IDE, arsip) dan hapus QA sudah
  // TIDAK di daftar ini: tool-nya ada di shared/src/mcp-catalog/transfer.ts.
  // ADR-0190 · route dialog sesi dibungkus gates.ts (sessions:decide); ADR-0191 · /scheduler/crons* dibungkus gates.ts (scheduler:*).
  // ADR-0196..0198 · route admin yang DIBUKA kini punya tool (admin.ts). Yang di bawah ini tetap
  // cookie-only karena TAK BISA dibungkus bermakna secara teknis — kejujuran lebih penting dari
  // centang. Semuanya COOKIE_ONLY di capabilityForRoute, jadi gerbang cakupan tak menuntutnya;
  // dicatat di sini agar alasannya tak hilang, dan uji "daftar dikecualikan" memastikan route-nya ada.
  ["GET /auth/status", "PUBLIK dan dijawab tanpa auth; `user` selalu null untuk agent token — tak ada isi untuk agen (hanoman_about / GET /health untuk probe)"],
  ["POST /auth/setup", "bootstrap akun pertama + cookie sesi + setup token di berkas HANOMAN_HOME; bukan operasi agen"],
  ["POST /auth/login", "menerbitkan cookie sesi untuk browser; agen tak punya sesi cookie (kredensialnya agent token)"],
  ["POST /auth/logout", "menghapus cookie sesi browser; tak ada artinya untuk Bearer agent token"],
  ["GET /terminal/workspace", "tata letak tab/pane BROWSER per akun (req.user.id); agent token tak punya req.user"],
  ["PUT /terminal/workspace", "tata letak tab/pane BROWSER per akun (req.user.id); agent token tak punya req.user"],
  ["POST /session-events", "kredensial = token HMAC turunan per sesi (header x-hanoman-session), bukan agent token; gate cookie mem-bypass-nya dan agent token dijawab 401 (SPEC-909/ADR-0146)"],
  // ADR-0199 §3 · kanal sync MESIN-KE-MESIN. Semuanya COOKIE_ONLY di peta capability (jadi gerbang
  // di atas tak menuntutnya), dan dicatat di sini supaya alasannya terbaca: auth-nya Bearer
  // DEVICE-TOKEN (atau tiket WS) yang ditegakkan route-nya sendiri. Agent token BUKAN device token —
  // membungkusnya berarti mengeluarkan kredensial mesin ke agen, atau tool yang pasti 401. Yang
  // dibungkus hanya tiga permukaan UI sync (now/conflicts/pending → hanoman_sync_*).
  ["GET /sync/pull", "mesin-ke-mesin: Bearer device-token, bukan permukaan agen (ADR-0199)"],
  ["GET /sync/bootstrap", "mesin-ke-mesin: Bearer device-token (ADR-0199)"],
  ["POST /sync/push", "mesin-ke-mesin: Bearer device-token (ADR-0199)"],
  ["POST /sync/logs", "mesin-ke-mesin: Bearer device-token, gzip (ADR-0199)"],
  ["GET /sync/attachments/:storageKey", "mesin-ke-mesin: Bearer device-token + biner (ADR-0199)"],
  ["GET /sync/qa-attachments/:id", "mesin-ke-mesin: Bearer device-token + biner (ADR-0199)"],
  ["PUT /sync/qa-attachments/:id", "mesin-ke-mesin: Bearer device-token + biner (ADR-0199)"],
  ["GET /sync/ws", "WebSocket mesin-ke-mesin, Bearer device-token (ADR-0199)"],
  ["GET /sync/relay/ws", "WebSocket relay mesin-ke-mesin, Bearer device-token (ADR-0199)"],
  ["POST /ws-tickets", "menerbitkan tiket WebSocket sekali-pakai untuk sesi cookie; tiket = kredensial, bukan data (ADR-0199)"],
  // ADR-0201 · Help Center publik: ANONIM by design, bypass gerbang /api (app.ts), dan tak pernah
  // memegang capability — tool apa pun di atasnya tak menambah akses, hanya menambah jalur masuk.
  ["GET /help/:slug", "publik anonim; operator memakai hanoman_help_center_get (ADR-0201)"],
  ["POST /help/:slug/tickets", "publik anonim + honeypot + rate-limit untuk MANUSIA; agen yang mengirim = membanjiri jalur anonim (ADR-0201)"],
  ["GET /help/:slug/tickets/:key", "publik anonim, otorisasi kunci opaque pelapor; status mentah tiket sudah terbaca operator lewat hanoman_ticket_get/support:read (ADR-0201)"],
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
  ["GET /skills/:key/file", "hanoman_skill_read"],
  ["DELETE /skills/:key/entry", "hanoman_skill_entry"],
  // ADR-0195 · tool portal memilih endpoint menurut argumen opsional (`spec`/`ticket`/`session`).
  ["GET /portal/projects/:id/backlog/:specId", "hanoman_portal_backlog"],
  ["GET /portal/projects/:id/tickets/:ticketId", "hanoman_portal_tickets"],
  ["GET /portal/projects/:id/chat/sessions/:sid", "hanoman_portal_chat_sessions"],
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
    // ADR-0199 · bentuk yang DULU lolos dari regex: receiver bersarang (`logs.`, `qb.`) dan `.route({...})`.
    expect(inv).toContainEqual({ method: "POST", path: "/sync/logs" });
    expect(inv).toContainEqual({ method: "PUT", path: "/sync/qa-attachments/:id" });
    expect(inv).toContainEqual({ method: "GET", path: "/devices/:deviceId/relay/*" });
    expect(inv).toContainEqual({ method: "DELETE", path: "/devices/:deviceId/relay/*" });
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
