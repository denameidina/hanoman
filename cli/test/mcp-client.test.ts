import { describe, expect, it, vi } from "vitest";
import { createCaller } from "../src/mcp/client";
import type { McpConfig } from "../src/mcp/config";

const cfg: McpConfig = { host: "http://h:8787", token: "hnm_agt_secret", level: "default", maxBytes: 24576, problems: [] };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createCaller", () => {
  it("memasang Bearer dan merakit URL + query", async () => {
    const f = vi.fn(async () => json(200, { items: [] }));
    await createCaller(cfg, f as unknown as typeof fetch)(
      { method: "GET", path: "/specs", query: { project: "a b", startable: "true" } }, "t");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://h:8787/api/specs?project=a+b&startable=true");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hnm_agt_secret");
  });

  it("POST mengirim body JSON dengan content-type", async () => {
    const f = vi.fn(async () => json(201, { id: "SPEC-1" }));
    await createCaller(cfg, f as unknown as typeof fetch)({ method: "POST", path: "/specs", body: { a: 1 } }, "t");
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("401 memicu probe /api/health SEKALI, lalu di-cache untuk panggilan berikutnya", async () => {
    const f = vi.fn(async (url: string) =>
      String(url).endsWith("/api/health") ? json(200, { ok: true }) : json(401, { error: "unauthorized" }));
    const call = createCaller(cfg, f as unknown as typeof fetch);
    const a = await call({ method: "GET", path: "/specs" }, "t");
    const b = await call({ method: "GET", path: "/projects" }, "t");
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect((a as { message: string }).message).toContain("PER-INSTANCE");
    expect(f.mock.calls.filter(([u]) => String(u).endsWith("/api/health"))).toHaveLength(1);
  });

  it("401 saat health mati → pesan menyalahkan HOST, bukan token", async () => {
    const f = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/health"))
        throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      return json(401, { error: "unauthorized" });
    });
    const r = await createCaller(cfg, f as unknown as typeof fetch)({ method: "GET", path: "/specs" }, "t");
    expect((r as { message: string }).message).toMatch(/HANOMAN_HOST/);
  });

  it("konfigurasi bermasalah → tak ada panggilan jaringan sama sekali, keluhannya yang dikembalikan", async () => {
    const f = vi.fn(async () => json(200, {}));
    const r = await createCaller(
      { ...cfg, token: "", problems: ["HANOMAN_AGENT_TOKEN belum diisi."] },
      f as unknown as typeof fetch,
    )({ method: "GET", path: "/specs" }, "t");
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toContain("HANOMAN_AGENT_TOKEN");
    expect(f).not.toHaveBeenCalled();
  });

  it("token tak pernah bocor ke pesan galat", async () => {
    const f = vi.fn(async () => json(500, "gagal memakai hnm_agt_secret"));
    const r = await createCaller(cfg, f as unknown as typeof fetch)({ method: "GET", path: "/specs" }, "t");
    expect((r as { message: string }).message).not.toContain("hnm_agt_secret");
    expect((r as { message: string }).message).toContain("«token disembunyikan»");
  });

  it("balasan bukan JSON tetap jadi kalimat, bukan lemparan", async () => {
    const f = vi.fn(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    const r = await createCaller(cfg, f as unknown as typeof fetch)({ method: "GET", path: "/specs" }, "t");
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toContain("502");
  });
});
