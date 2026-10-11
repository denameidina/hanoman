// ADR-0196..0198 · katalog permukaan ADMIN. Seperti berkas tetangga, yang diuji bukan "tool-nya ada"
// (gerbang cakupan di server menjaga itu) melainkan sifat yang hanya bisa salah DI KATALOG: mode,
// capability yang dijanjikan, bentuk permintaan hasil build(), dan satu-satunya kebocoran rahasia
// yang disengaja (`revealsSecret`).
import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS, CAPABILITIES, exceedingCapabilities, grantsCapability } from "./agent";
import { MCP_TOOLS, mcpToolsFor } from "./mcp";

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;
const ADMIN_CAPS = new Set([
  "tokens:read", "tokens:write", "devices:read", "devices:write", "access:read", "access:admin",
  "remote:read", "remote:control", "relay:exec", "logs:read", "logs:write", "presence:read",
  "metrics:read", "metrics:write",
]);
const admin = MCP_TOOLS.filter((t) => t.capability && ADMIN_CAPS.has(t.capability));

describe("capability admin", () => {
  it("keempat belas id terdaftar, berpasangan metadata, dan tak satu pun ikut tingkat lama", () => {
    for (const id of ADMIN_CAPS) expect(CAPABILITY_IDS, id).toContain(id);
    for (const id of ADMIN_CAPS) expect(CAPABILITIES.find((c) => c.id === id), id).toBeDefined();
  });

  it("tiap domain admin punya paling banyak SATU id per tingkat akses (grid Settings: baca/tulis/berbahaya)", () => {
    const seen = new Set<string>();
    for (const c of CAPABILITIES) {
      const k = `${c.domain}/${c.access}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it("capability lama TIDAK memberi capability admin, dan sebaliknya", () => {
    for (const old of ["settings:write", "agents:write", "sessions:write", "vps:exec", "projects:write", "lead:write"])
      for (const id of ADMIN_CAPS) expect(grantsCapability([old], id as never), `${old} → ${id}`).toBe(false);
    // dan danger/write admin tak diimplikasikan satu sama lain
    expect(grantsCapability(["tokens:write"], "access:admin")).toBe(false);
    expect(grantsCapability(["access:admin"], "access:read")).toBe(false);
    expect(grantsCapability(["remote:control"], "remote:read")).toBe(false);
    expect(grantsCapability(["tokens:write"], "tokens:read")).toBe(true);
  });
});

describe("exceedingCapabilities — himpunan-bagian milik pemanggil", () => {
  it("kosong bila semua yang diminta dimiliki (write ⊇ read)", () => {
    expect(exceedingCapabilities(["projects:write", "tokens:write"], ["projects:read", "projects:write"])).toEqual([]);
  });
  it("menyebut yang melebihi; danger hanya bila dimiliki persis; id tak dikenal = melebihi", () => {
    expect(exceedingCapabilities(["sessions:write"], ["sessions:spawn"])).toEqual(["sessions:spawn"]);
    expect(exceedingCapabilities(["projects:read"], ["projects:write"])).toEqual(["projects:write"]);
    expect(exceedingCapabilities(["projects:write"], ["ghost:read"])).toEqual(["ghost:read"]);
    expect(exceedingCapabilities([], [])).toEqual([]);
  });
});

describe("katalog admin", () => {
  it("setiap tool menuntut capability admin, dan nama-namanya unik", () => {
    expect(admin.length).toBe(22);
    expect(new Set(admin.map((t) => t.name)).size).toBe(admin.length);
  });

  it("SEMUA tool tulis bermode danger; semua tool baca bermode read", () => {
    for (const t of admin) {
      const writes = t.sampleMethod !== "GET";
      expect(t.mode, t.name).toBe(writes ? "danger" : "read");
    }
    const def = new Set(mcpToolsFor("default").map((t) => t.name));
    for (const t of admin.filter((x) => x.sampleMethod !== "GET")) expect(def.has(t.name), t.name).toBe(false);
  });

  it("revealsSecret hanya pada dua tool pencetak kredensial", () => {
    expect(MCP_TOOLS.filter((t) => t.revealsSecret).map((t) => t.name).sort())
      .toEqual(["hanoman_agent_token_create", "hanoman_device_token_create"]);
  });

  it("deskripsi pencetak kredensial menyebut plaintext sekali-tampil", () => {
    for (const n of ["hanoman_agent_token_create", "hanoman_device_token_create"])
      expect(byName(n).description).toMatch(/hanya ada di balasan INI/);
  });

  it("agent_token_create merakit POST dengan nama & capability, shape menambah catatan sekali-tampil", () => {
    const t = byName("hanoman_agent_token_create");
    expect(t.build({ name: "ci", capabilities: ["projects:read"] }))
      .toEqual({ method: "POST", path: "/agent-tokens", body: { name: "ci", capabilities: ["projects:read"] } });
    const shaped = t.shape({ id: "t1", token: "hnm_agt_x" }, {}) as Record<string, unknown>;
    expect(shaped.token).toBe("hnm_agt_x");
    expect(String(shaped.note)).toMatch(/SEKALI|hanya ada/i);
    // skema menawarkan id capability sah ke model
    const items = t.inputSchema.properties.capabilities!.items!;
    expect(items.enum).toContain("tokens:write");
  });

  it("agent_token_update hanya mengirim field yang disebut", () => {
    const t = byName("hanoman_agent_token_update");
    expect(t.build({ token: "t1", enabled: false })!.body).toEqual({ enabled: false });
    expect(t.build({ token: "t1", name: "baru", capabilities: [] })!.body).toEqual({ name: "baru", capabilities: [] });
  });

  it("user_password_reset memetakan `user` → userId dan tak punya password lama", () => {
    const t = byName("hanoman_user_password_reset");
    expect(t.build({ user: "u1", newPassword: "rahasia123" }))
      .toEqual({ method: "POST", path: "/auth/change-password", body: { userId: "u1", newPassword: "rahasia123" } });
    expect(Object.keys(t.inputSchema.properties)).not.toContain("currentPassword");
  });

  it("remote_control_set: blok control & logs hanya ada bila disebut", () => {
    const t = byName("hanoman_remote_control_set");
    expect(t.build({ enabled: false, capabilities: [] })!.body).toEqual({ control: { enabled: false, capabilities: [] } });
    expect(t.build({ logEvent: true, logServer: false, logTranscript: false })!.body)
      .toEqual({ logs: { event: true, server: false, transcript: false } });
    expect(t.build({})!.body).toEqual({});
  });

  it("device_relay: path dinormalkan, sandi berbahaya & WebSocket ditolak sebelum dikirim", () => {
    const t = byName("hanoman_device_relay");
    expect(t.build({ device: "d1", method: "GET", path: "/terminal/sessions" }))
      .toEqual({ method: "GET", path: "/devices/d1/relay/terminal/sessions" });
    expect(t.build({ device: "d1", method: "get", path: "/api/terminal/sessions", query: { a: 1 } }))
      .toEqual({ method: "GET", path: "/devices/d1/relay/terminal/sessions", query: { a: "1" } });
    expect(t.build({ device: "d1", method: "POST", path: "terminal/sessions", body: { spec: "SPEC-1" } }))
      .toEqual({ method: "POST", path: "/devices/d1/relay/terminal/sessions", body: { spec: "SPEC-1" } });
    // GET tidak membawa body
    expect(t.build({ device: "d1", method: "GET", path: "/x", body: { a: 1 } })).not.toHaveProperty("body");
    for (const bad of ["/../etc", "/a/%2e%2e/b", "/a?x=1", "/a#b", "/terminal/sessions/s1/ws", "/a\\b"])
      expect(t.build({ device: "d1", method: "GET", path: bad }), bad).toBeNull();
  });

  it("logs_retention_set mewajibkan keempat field (zod server me-default field yang hilang)", () => {
    expect([...byName("hanoman_logs_retention_set").inputSchema.required!].sort())
      .toEqual(["eventDays", "maxBytes", "serverDays", "transcriptDays"]);
  });

  it("logs_search meneruskan filter dengan nama kolom server", () => {
    const t = byName("hanoman_logs_search");
    expect(t.build({ from: "a", to: "b", device: "d", project: "p", spec: "s", lane: "event", limit: 5 })!.query)
      .toEqual({ from: "a", to: "b", deviceId: "d", projectId: "p", specId: "s", lane: "event", limit: "5" });
  });

  it("tak satu pun samplePath menyentuh route yang tetap cookie-only", () => {
    for (const t of admin) {
      expect(t.samplePath, t.name).not.toMatch(/^\/(auth\/(status|setup|login|logout)|sync|session-events|terminal\/workspace)/);
    }
  });
});
