import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { createApi, api } from "../src/api/client";
import { InstanceProvider, useInstance, useApi, useWsTarget } from "../src/api/instance";

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

describe("InstanceContext (SPEC-1216 · AC-B7/B9)", () => {
  it("tanpa provider → local, useApi() === api singleton", () => {
    const { result } = renderHook(() => ({ i: useInstance(), a: useApi() }));
    expect(result.current.i).toEqual({ kind: "local" });
    expect(result.current.a).toBe(api);
  });
  it("dengan provider remote → useApi() BUKAN singleton local, useWsTarget merutekan ke relay", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <InstanceProvider value={{ kind: "remote", deviceId: "dev1", name: "laptop", version: "0.6.0", protocol: 1, capabilities: ["sessions:read"] }}>
        {children}
      </InstanceProvider>
    );
    const { result } = renderHook(() => ({ a: useApi(), t: useWsTarget("terminal:sess1") }), { wrapper });
    expect(result.current.a).not.toBe(api);
    expect(result.current.t).toEqual({ url: "/api/devices/dev1/relay/terminal/sessions/sess1/ws", ticketTarget: "relay:dev1:terminal:sess1" });
  });
  it("useApi() remote di-memo per deviceId (referensi sama antar render)", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <InstanceProvider value={{ kind: "remote", deviceId: "dev1", name: "l", version: "v", protocol: 1, capabilities: [] }}>
        {children}
      </InstanceProvider>
    );
    const { result, rerender } = renderHook(() => useApi(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
