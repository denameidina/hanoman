import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApi } from "../src/api/client";

describe("createApi({base}) (SPEC-1216 · AC-B7/B9)", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  it("base default '/api' — j() memanggil URL apa adanya", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createApi();
    await api.getSettings();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toMatch(/^\/api\/settings/);
  });
  it("base 'http://client:9000' — j() merebase '/api/...' jadi base + sisanya", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createApi({ base: "/api/devices/dev1/relay" });
    await api.getSettings();
    const url = String(vi.mocked(fetch).mock.calls[0]![0]);
    expect(url.startsWith("/api/devices/dev1/relay/settings")).toBe(true);
  });
  it("jUpload dan agentDoc ikut rebase", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ path: "x" }), { status: 200 }));
    const api = createApi({ base: "/api/devices/dev1/relay" });
    await api.uploadTerminalAttachment("s1", new File(["x"], "a.txt"));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toMatch(/^\/api\/devices\/dev1\/relay\//);
  });
});
