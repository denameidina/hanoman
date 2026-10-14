import { mkdtemp, readFile, stat, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { bundledModelCatalog } from "@hanoman/shared";
import { createModelCatalogService, writeModelCatalogCache, startModelDiscovery, modelCatalogService } from "../src/services/model-catalog";

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
    expect(probe).toHaveBeenCalledTimes(3);
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

describe("Antigravity discovery lifecycle", () => {
  const ag = [{ id: "future-high", label: "Future", efforts: ["high"] }];
  it("replaces rather than unions successful models and preserves last-good through failure", async () => {
    let failure = false;
    const service = createModelCatalogService({ read: async () => null, write: async () => {}, now: () => 1,
      probe: async (agent) => { if (failure) throw Error("SECRET"); return agent === "antigravity" ? ag : [future]; },
    });
    await service.refresh();
    expect(service.snapshot().antigravity).toEqual(ag);
    failure = true;
    await service.refresh();
    expect(service.snapshot().antigravity).toEqual(ag);
    expect(service.snapshot().providers.antigravity.error).toBeTruthy();
    expect(JSON.stringify(service.snapshot())).not.toContain("SECRET");
  });
  it("discards an old binary generation and its finally cannot clear the new refresh", async () => {
    let key = "old-host", finishOld!: (models: typeof ag) => void, finishNew!: (models: typeof ag) => void;
    let agCalls = 0;
    const persisted: string[] = [];
    const service = createModelCatalogService({ read: async () => null,
      write: async (catalog) => { persisted.push(catalog.antigravity[0]!.id); }, now: () => 1,
      key: () => key,
      probe: async (agent) => {
        if (agent !== "antigravity") return [future];
        agCalls++;
        return new Promise<typeof ag>((resolve) => { if (agCalls === 1) finishOld = resolve; else finishNew = resolve; });
      },
    });
    const old = service.refresh();
    await vi.waitFor(() => expect(finishOld).toBeTypeOf("function"));
    key = "new-host";
    const next = service.refresh();
    await vi.waitFor(() => expect(finishNew).toBeTypeOf("function"));
    finishOld([{ id: "old-high", label: "Old", efforts: ["high"] }]);
    await old;
    expect(service.snapshot().antigravity[0]?.id).not.toBe("old-high");
    const same = service.refresh();
    finishNew(ag);
    await Promise.all([next, same]);
    expect(agCalls).toBe(2);
    expect(persisted).toEqual(["future-high"]);
    expect(service.snapshot().antigravity).toEqual(ag);
  });
  it("does not publish an old provider error after the binary changes", async () => {
    let key = "old", rejectOld!: (error: Error) => void;
    const writes: string[] = [];
    const service = createModelCatalogService({ read: async () => null, now: () => 1, key: () => key,
      write: async (catalog) => { writes.push(catalog.antigravity[0]!.id); },
      probe: async (agent) => agent !== "antigravity" ? [future] : key === "old"
        ? new Promise<typeof ag>((resolve, reject) => { rejectOld = reject; }) : ag,
    });
    const old = service.refresh();
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf("function"));
    key = "new";
    await service.refresh();
    rejectOld(Error("old SECRET"));
    await old;
    expect(service.snapshot().providers.antigravity.error).toBeNull();
    expect(service.snapshot().antigravity).toEqual(ag);
    expect(writes).toEqual(["future-high"]);
  });
  it("invalidates mode changes even without a second refresh and never installs old completion", async () => {
    let key = "host", finish!: (models: typeof ag) => void;
    const write = vi.fn(async () => {});
    const service = createModelCatalogService({ read: async () => null, write, now: () => 1, key: () => key,
      probe: async (agent) => agent === "antigravity" ? new Promise<typeof ag>((resolve) => { finish = resolve; }) : [future],
    });
    const pending = service.refresh();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    key = "podman";
    finish(ag);
    await pending;
    expect(service.snapshot().providers.antigravity.source).toBe("bundled");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("catalog persistence and refresh cadence", () => {
  it("writes only normalized fields at mode 0600 and discards stale cache commit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catalog-test-"));
    const file = join(dir, "model-catalog.json");
    try {
      const catalog = { ...bundledModelCatalog(), token: "SECRET", antigravity: [{ id: "future-high", label: "Future", efforts: ["high", "max"], token: "SECRET" }] };
      await writeModelCatalogCache(file, catalog);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      const raw = await readFile(file, "utf8");
      expect(raw).not.toContain("SECRET");
      expect(JSON.parse(raw).antigravity).toEqual([{ id: "future-high", label: "Future", efforts: ["high"] }]);
      await writeModelCatalogCache(file, bundledModelCatalog(), () => false);
      expect(await readFile(file, "utf8")).toBe(raw);
      expect(await readdir(dir)).toEqual(["model-catalog.json"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("invalidates a pending cache write before its commit guard", async () => {
    let key = "old", finish!: () => void;
    const persisted: string[] = [];
    const service = createModelCatalogService({ read: async () => null, now: () => 1, key: () => key,
      probe: async (agent) => agent === "antigravity" ? [{ id: `${key}-high`, label: "Model", efforts: ["high"] }] : [future],
      write: async (catalog, current) => {
        if (catalog.antigravity[0]!.id === "old-high") await new Promise<void>((resolve) => { finish = resolve; });
        if (current?.()) persisted.push(catalog.antigravity[0]!.id);
      },
    });
    const old = service.refresh();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    key = "new";
    await service.refresh();
    finish();
    await old;
    expect(persisted).toEqual(["new-high"]);
    expect(service.snapshot().antigravity[0]?.id).toBe("new-high");
  });
  it("refreshes on startup and every five minutes until stopped", async () => {
    vi.useFakeTimers();
    const refresh = vi.spyOn(modelCatalogService, "refresh").mockResolvedValue(bundledModelCatalog());
    const stop = startModelDiscovery();
    try {
      expect(refresh).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(299_999);
      expect(refresh).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(refresh).toHaveBeenCalledTimes(2);
      stop();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally { stop(); refresh.mockRestore(); vi.useRealTimers(); }
  });
});
