import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import * as cfg from "../src/config";
import { ENC_PREFIX } from "../src/services/secret-box";

const clean = async () => { await prisma.runtimeConfig.deleteMany(); };
beforeEach(async () => { await clean(); delete process.env.SYNC_TICK_MS; await cfg.loadConfig(); });
afterAll(clean);

describe("config resolver (DB → env → default)", () => {
  it("default registry saat DB & env kosong", () => {
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(15000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("default");
  });
  it("env menang atas default; source=env", () => {
    process.env.SYNC_TICK_MS = "9000";
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(9000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("env");
    delete process.env.SYNC_TICK_MS;
  });
  it("DB menang atas env; source=db", async () => {
    process.env.SYNC_TICK_MS = "9000";
    await cfg.setConfig("SYNC_TICK_MS", "3000");
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(3000);
    expect(cfg.sourceOf("SYNC_TICK_MS")).toBe("db");
    await cfg.clearConfig("SYNC_TICK_MS");
    expect(cfg.effectiveInt("SYNC_TICK_MS")).toBe(9000); // balik ke env
    delete process.env.SYNC_TICK_MS;
  });
  it("effectiveBool", async () => {
    delete process.env.HANOMAN_UPDATE_FETCH; // vitest.config memaksa "0"; uji default registry
    expect(cfg.effectiveBool("HANOMAN_UPDATE_FETCH")).toBe(true); // default "1"
    await cfg.setConfig("HANOMAN_UPDATE_FETCH", "0");
    expect(cfg.effectiveBool("HANOMAN_UPDATE_FETCH")).toBe(false);
    process.env.HANOMAN_UPDATE_FETCH = "0"; // pulihkan paksaan test
  });
  it("effectiveStr tanpa default → undefined", () => {
    expect(cfg.effectiveStr("SYNC_SERVER_URL")).toBeUndefined();
  });
});

// SPEC-477 · ADR-0097 · nilai `kind: "secret"` terenkripsi at-rest. Cache memegang PLAINTEXT,
// DB memegang ciphertext — mendekripsi di `effectiveStr` akan memaksa kripto di hot-path sinkron.
describe("SPEC-477 · secret at-rest", () => {
  it("kind:secret disimpan sebagai ciphertext di DB tapi terbaca plaintext lewat resolver", async () => {
    await cfg.setConfig("GITHUB_TOKEN", "ghp_rahasia_sekali_123456");
    const row = await prisma.runtimeConfig.findUnique({ where: { key: "GITHUB_TOKEN" } });
    expect(row!.value.startsWith(ENC_PREFIX)).toBe(true);
    expect(row!.value).not.toContain("ghp_rahasia_sekali_123456");
    expect(cfg.effectiveStr("GITHUB_TOKEN")).toBe("ghp_rahasia_sekali_123456");
    expect(cfg.rawDbValue("GITHUB_TOKEN")).toBe("ghp_rahasia_sekali_123456");
    await cfg.loadConfig();
    expect(cfg.effectiveStr("GITHUB_TOKEN")).toBe("ghp_rahasia_sekali_123456");
  });

  it("knob non-secret tetap plaintext (tak ada enkripsi yang tak perlu)", async () => {
    await cfg.setConfig("SYNC_TICK_MS", "5000");
    const row = await prisma.runtimeConfig.findUnique({ where: { key: "SYNC_TICK_MS" } });
    expect(row!.value).toBe("5000");
  });

  // Gotcha 3 · instance yang sudah hidup punya baris plaintext. Ia wajib tetap terbaca.
  it("baris plaintext lama tetap terbaca lewat loadConfig", async () => {
    await prisma.runtimeConfig.create({ data: { key: "GITHUB_TOKEN", value: "ghp_lama_plaintext" } });
    await cfg.loadConfig();
    expect(cfg.effectiveStr("GITHUB_TOKEN")).toBe("ghp_lama_plaintext");
  });

  it("ciphertext tak terbaca (kunci berganti) dianggap ABSEN, bukan melempar", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await prisma.runtimeConfig.create({ data: { key: "GITHUB_TOKEN", value: `${ENC_PREFIX}aaa:bbb:ccc` } });
    await expect(cfg.loadConfig()).resolves.toBeUndefined();
    expect(cfg.effectiveStr("GITHUB_TOKEN")).toBeUndefined();
    quiet.mockRestore();
  });
});

describe("suppressedInheritKeys", () => {
  it("hanya kunci inheritEnv yang dikosongkan eksplisit di DB", async () => {
    const { suppressedInheritKeys, setConfig, clearConfig, loadConfig } = await import("../src/config");
    await loadConfig();
    expect(suppressedInheritKeys()).toEqual([]);
    await setConfig("CLAUDE_CODE_OAUTH_TOKEN", "");
    await setConfig("ANTHROPIC_API_KEY", "sk-aktif");
    expect(suppressedInheritKeys()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN"]);
    await clearConfig("CLAUDE_CODE_OAUTH_TOKEN"); await clearConfig("ANTHROPIC_API_KEY");
  });
});
