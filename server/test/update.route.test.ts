import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app";
import { _resetUpdateCache, __setRegistrySnapshot, __setExiter } from "../src/services/update";

// SPEC-398 · ADR-0087 · tak ada lagi repo git palsu yang perlu disiapkan: statusnya semver +
// registry npm, dan vitest.config memaksa HANOMAN_UPDATE_FETCH=0 → nol jaringan.
beforeEach(() => _resetUpdateCache());
afterEach(() => _resetUpdateCache());

describe("GET /api/update", () => {
  it("balas 200 + shape valid; fail-safe tanpa jaringan", async () => {
    const previous = process.env.HANOMAN_SUPERVISOR;
    delete process.env.HANOMAN_SUPERVISOR;
    try {
      const app = buildApp({ requireAuth: false });
      const res = await app.inject({ method: "GET", url: "/api/update" });
      expect(res.statusCode).toBe(200);
      const b = res.json();
      expect(b).toMatchObject({ updateAvailable: false, command: "", latestVersion: null, canApply: false });
      expect(b.registry.status).toBe("unavailable");
      expect(b.currentVersion).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      if (previous === undefined) delete process.env.HANOMAN_SUPERVISOR;
      else process.env.HANOMAN_SUPERVISOR = previous;
    }
  });
  it("401 tanpa cookie saat requireAuth", async () => {
    const app = buildApp({ requireAuth: true });
    const res = await app.inject({ method: "GET", url: "/api/update" });
    expect(res.statusCode).toBe(401);
  });
});

const savedSup = process.env.HANOMAN_SUPERVISOR;
const savedDelay = process.env.HANOMAN_UPDATE_RESTART_DELAY_MS;
const restoreEnv = () => {
  if (savedSup === undefined) delete process.env.HANOMAN_SUPERVISOR; else process.env.HANOMAN_SUPERVISOR = savedSup;
  if (savedDelay === undefined) delete process.env.HANOMAN_UPDATE_RESTART_DELAY_MS; else process.env.HANOMAN_UPDATE_RESTART_DELAY_MS = savedDelay;
};

describe("POST /api/update/apply (SPEC-405 · ADR-0088)", () => {
  let exits: number[];
  beforeEach(() => {
    _resetUpdateCache();
    exits = [];
    __setExiter((c) => exits.push(c));
    process.env.HANOMAN_UPDATE_RESTART_DELAY_MS = "0";
  });
  afterEach(() => { __setExiter(null); restoreEnv(); _resetUpdateCache(); });

  const post = async (body: Record<string, unknown>, supervised: boolean, latest: string | null) => {
    if (supervised) process.env.HANOMAN_SUPERVISOR = "1"; else delete process.env.HANOMAN_SUPERVISOR;
    _resetUpdateCache();
    __setRegistrySnapshot(latest, latest ? "ok" : "unavailable");
    const app = buildApp({ requireAuth: false });
    return await app.inject({ method: "POST", url: "/api/update/apply", payload: body });
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("tak tersupervisi → 409 unsupervised, TIDAK keluar", async () => {
    const res = await post({ confirm: true }, false, "99.9.9");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("unsupervised");
    await settle();
    expect(exits).toEqual([]);
  });

  it("sudah terkini → 409 up-to-date, TIDAK keluar", async () => {
    const res = await post({ confirm: true }, true, null);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("up-to-date");
    await settle();
    expect(exits).toEqual([]);
  });

  it("tanpa confirm → 409 confirm-required + jumlah sesi hidup, TIDAK keluar", async () => {
    const res = await post({}, true, "99.9.9");
    expect(res.statusCode).toBe(409);
    const b = res.json();
    expect(b.error).toBe("confirm-required");
    expect(b.to).toBe("99.9.9");
    expect(typeof b.from).toBe("string");
    expect(Number.isInteger(b.liveSessions)).toBe(true);
    expect(b.liveSessions).toBeGreaterThanOrEqual(0);
    await settle();
    expect(exits).toEqual([]);
  });

  it("confirm:true → 202 lalu keluar dengan sentinel 75", async () => {
    const res = await post({ confirm: true }, true, "99.9.9");
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: true, to: "99.9.9" });
    await settle();
    expect(exits).toEqual([75]);
  });

  it("confirm non-boolean → 400, TIDAK keluar", async () => {
    const res = await post({ confirm: "ya" }, true, "99.9.9");
    expect(res.statusCode).toBe(400);
    await settle();
    expect(exits).toEqual([]);
  });

  it("401 tanpa cookie saat requireAuth", async () => {
    process.env.HANOMAN_SUPERVISOR = "1";
    const app = buildApp({ requireAuth: true });
    const res = await app.inject({ method: "POST", url: "/api/update/apply", payload: { confirm: true } });
    expect(res.statusCode).toBe(401);
    await settle();
    expect(exits).toEqual([]);
  });
});
