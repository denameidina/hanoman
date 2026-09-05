import { describe, expect, it, vi } from "vitest";
import { bundledModelCatalog } from "@hanoman/shared";
import { createModelCatalogService } from "../src/services/model-catalog";

const future = { id: "gpt-future", label: "Future", efforts: ["new-effort"], fallback: "new-effort", minClient: "" };
describe("model catalog lifecycle", () => {
  it("coalesces readers, updates independently, keeps last-good on failure and recovers", async () => {
    let fail = false;
    const probe = vi.fn(async (agent: string) => {
      await Promise.resolve();
      if (fail || agent === "claude") throw new Error("SECRET must not be exposed");
      return [future];
    });
    const write = vi.fn(async () => {});
    const service = createModelCatalogService({ probe, read: async () => null, write, now: () => 1 });
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(service.snapshot().codex).toContainEqual(future);
    expect(service.snapshot().providers.claude.error).toBeTruthy();
    expect(service.snapshot().providers.codex.source).toBe("cli");
    fail = true;
    await service.refresh();
    expect(service.snapshot().codex).toContainEqual(future);
    expect(service.snapshot().providers.codex.updatedAt).not.toBeNull();
    expect(JSON.stringify(service.snapshot())).not.toContain("SECRET");
    fail = false;
    await service.refresh();
    expect(service.snapshot().providers.codex.error).toBeNull();
    expect(write).toHaveBeenCalledTimes(3);
  });
  it("loads a valid disk snapshot before probing and retains it offline", async () => {
    const cached = bundledModelCatalog();
    cached.codex = [future];
    cached.providers.codex = { source: "cli", checkedAt: "2026-09-01", updatedAt: "2026-09-01", error: null };
    const install = vi.fn();
    const service = createModelCatalogService({
      read: async () => cached, write: async () => {}, now: () => 100,
      probe: async () => { throw new Error("offline"); }, install,
    });
    await service.refresh();
    expect(install.mock.calls[0]![0].codex).toContainEqual(future);
    expect(service.snapshot().providers.codex.source).toBe("cache");
    expect(service.snapshot().codex).toContainEqual(future);
  });
  it("reports cache write failure without discarding discovered models", async () => {
    const service = createModelCatalogService({
      read: async () => ({}), write: async () => { throw new Error("disk full"); },
      now: () => 1, probe: async () => [future],
    });
    await service.refresh();
    expect(service.snapshot().codex).toContainEqual(future);
    expect(service.snapshot().providers.codex.error).toContain("disimpan");
  });
});
