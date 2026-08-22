// SPEC-883 · jalur mandiri: `hanoman provision` menjalankan provision.sh yang SAMA secara lokal.
import { describe, it, expect } from "vitest";
import { parseProvisionArgs, scriptEnv } from "../src/commands/provision";
import { route } from "../src/router";

describe("SPEC-883 · argv provision", () => {
  it("--probe → mode probe", () => {
    expect(parseProvisionArgs(["--probe"])).toMatchObject({ mode: "probe" });
  });

  it("--with menentukan items, --profile & --domain diteruskan", () => {
    expect(parseProvisionArgs(["--with=hanoman,caddy", "--profile=production", "--domain=a.test"]))
      .toMatchObject({ mode: "apply", items: ["hanoman", "caddy"], profile: "production", domain: "a.test" });
  });

  it("apply tanpa --with ditolak", () => {
    expect(parseProvisionArgs([])).toMatchObject({ error: expect.stringMatching(/--with/) });
  });

  it("profil tak dikenal ditolak", () => {
    expect(parseProvisionArgs(["--with=node", "--profile=wat"])).toMatchObject({ error: expect.any(String) });
  });

  it("env skrip dirangkai dari argumen", () => {
    const parsed = parseProvisionArgs(["--with=node", "--dry-run"]);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(scriptEnv(parsed)).toMatchObject({ MODE: "apply", ITEMS: "node", PROFILE: "lab", DRY_RUN: "1" });
  });

  it("probe tak pernah mengirim ITEMS/PROFILE", () => {
    const parsed = parseProvisionArgs(["--probe"]);
    if ("error" in parsed) throw new Error("tak seharusnya error");
    expect(scriptEnv(parsed)).toEqual({ MODE: "probe" });
  });

  it("router mengenali `provision`", () => {
    expect(route(["provision", "--probe"])).toEqual({ cmd: "provision", args: ["--probe"] });
  });
});
