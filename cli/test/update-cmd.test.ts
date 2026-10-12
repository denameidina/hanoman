import { describe, it, expect, vi } from "vitest";
import { planUpdate, INSTALL_ARGS, PKG } from "../src/commands/update";

describe("planUpdate", () => {
  it("registry tak terjangkau → unknown (jangan memasang buta)", () => {
    expect(planUpdate("0.1.0", null).action).toBe("unknown");
  });
  it("lebih baru tersedia → install", () => {
    expect(planUpdate("0.1.0", "0.2.0")).toEqual({ action: "install", current: "0.1.0", latest: "0.2.0" });
  });
  it("sama → up-to-date", () => {
    expect(planUpdate("0.2.0", "0.2.0").action).toBe("up-to-date");
  });
  it("registry lebih tua → up-to-date, jangan pernah turun versi", () => {
    expect(planUpdate("0.3.0", "0.2.0").action).toBe("up-to-date");
  });
  it("checkout dev (0.0.0) vs rilis → install", () => {
    expect(planUpdate("0.0.0", "0.1.0").action).toBe("install");
  });
  it("perintah pemasangan global & bernama tepat", () => {
    expect(INSTALL_ARGS.join(" ")).toBe(`i -g ${PKG}@latest --prefer-online`);
    expect(PKG).toBe("hanoman");
  });
});

// Regresi SPEC-403 (lanjutan): `npm i -g hanoman` mengembalikan `spawn-helper` node-pty ke 0644. Server
// yang masih hidup lalu melahirkan sesi berlayar kosong ("menyambung ulang…"). Update harus memperbaikinya
// SEGERA setelah pemasangan, di instalasi yang baru ditulis.
describe("update · pemulihan spawn-helper", () => {
  it("memanggil repairSpawnHelper sesudah npm i -g sukses, sebelum pesan selesai", async () => {
    vi.resetModules();
    const order: string[] = [];
    vi.doMock("node:child_process", () => ({ execFileSync: () => { order.push("npm"); } }));
    vi.doMock("@hanoman/runner", () => ({ repairSpawnHelper: () => { order.push("repair"); return []; } }));
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ version: "999.0.0" }) }));
    const { default: update } = await import("../src/commands/update");
    const out: string[] = [];
    const code = await update([], { env: {}, stdout: (m: string) => { out.push(m); order.push("stdout"); }, stderr: () => {} } as never);
    expect(code).toBe(0);
    expect(order.indexOf("npm")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("repair")).toBeGreaterThan(order.indexOf("npm"));
    expect(out.join("")).toContain("terpasang hanoman 999.0.0");
    expect(order.lastIndexOf("stdout")).toBeGreaterThan(order.indexOf("repair"));
    vi.unstubAllGlobals(); vi.doUnmock("node:child_process"); vi.doUnmock("@hanoman/runner");
  });

  it("npm i -g gagal → tak memperbaiki apa pun dan kode keluar 1", async () => {
    vi.resetModules();
    let repaired = 0;
    vi.doMock("node:child_process", () => ({ execFileSync: () => { throw new Error("EACCES"); } }));
    vi.doMock("@hanoman/runner", () => ({ repairSpawnHelper: () => { repaired += 1; return []; } }));
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ version: "999.0.0" }) }));
    const { default: update } = await import("../src/commands/update");
    const code = await update([], { env: {}, stdout: () => {}, stderr: () => {} } as never);
    expect(code).toBe(1);
    expect(repaired).toBe(0);
    vi.unstubAllGlobals(); vi.doUnmock("node:child_process"); vi.doUnmock("@hanoman/runner");
  });
});
