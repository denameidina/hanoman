import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureAntigravityTrust } from "../src/services/antigravity-trust";

vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>() }));
let root: string, home: string, cwd: string, file: string;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "agy-trust-"));
  home = join(root, "home"); cwd = join(root, "repo");
  fs.mkdirSync(cwd); fs.mkdirSync(join(home, ".gemini/antigravity-cli"), { recursive: true });
  file = join(home, ".gemini/antigravity-cli/settings.json");
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
describe("ensureAntigravityTrust", () => {
  it("merges latest fields and two realpaths idempotently with mode 0600", () => {
    const other = { nested: ["keep"] };
    fs.writeFileSync(file, JSON.stringify({ trustedWorkspaces: ["/existing"], other }));
    const alias = join(root, "alias"); fs.symlinkSync(cwd, alias);
    ensureAntigravityTrust(alias, home); ensureAntigravityTrust(cwd, home);
    const second = join(root, "second"); fs.mkdirSync(second);
    const latest = JSON.parse(fs.readFileSync(file, "utf8")); latest.operator = true;
    fs.writeFileSync(file, JSON.stringify(latest));
    ensureAntigravityTrust(second, home);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      trustedWorkspaces: ["/existing", fs.realpathSync(cwd), fs.realpathSync(second)], other, operator: true,
    });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
  it("creates missing settings and native directories", () => {
    fs.rmSync(home, { recursive: true });
    ensureAntigravityTrust(cwd, home);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).trustedWorkspaces).toEqual([fs.realpathSync(cwd)]);
  });
  it("concurrent server launch requests retain both cwd additions and sibling fields", async () => {
    fs.writeFileSync(file, JSON.stringify({ trustedWorkspaces: ["/operator"], provider: { keep: true } }));
    const second = join(root, "second"); fs.mkdirSync(second);
    await Promise.all([cwd, second].map(async (dir) => ensureAntigravityTrust(dir, home)));
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ trustedWorkspaces: ["/operator", fs.realpathSync(cwd), fs.realpathSync(second)], provider: { keep: true } });
  });
  it.each(["{bad", "[]", "null", '{"trustedWorkspaces":true}', '{"trustedWorkspaces":[1]}'])
    ("rejects damaged shape %s without changing original bytes", (bytes) => {
      fs.writeFileSync(file, bytes);
      expect(() => ensureAntigravityTrust(cwd, home)).toThrow("antigravity-trust-preparation-failed");
      expect(fs.readFileSync(file, "utf8")).toBe(bytes);
    });
  it("rejects settings symlink without changing target", () => {
    const target = join(root, "operator.json"); fs.writeFileSync(target, "{}"); fs.symlinkSync(target, file);
    expect(() => ensureAntigravityTrust(cwd, home)).toThrow("antigravity-trust-preparation-failed");
    expect(fs.readFileSync(target, "utf8")).toBe("{}"); expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
  });
  it("rejects native directory symlink", () => {
    fs.rmSync(join(home, ".gemini/antigravity-cli"), { recursive: true });
    const target = join(root, "target"); fs.mkdirSync(target); fs.writeFileSync(join(target, "settings.json"), "{}");
    fs.symlinkSync(target, join(home, ".gemini/antigravity-cli"));
    expect(() => ensureAntigravityTrust(cwd, home)).toThrow("antigravity-trust-preparation-failed");
    expect(fs.readFileSync(join(target, "settings.json"), "utf8")).toBe("{}");
  });
  it("rejects wrong owner without changing bytes", () => {
    fs.writeFileSync(file, "{}"); const actual = fs.lstatSync; const canonicalFile = fs.realpathSync(file);
    vi.spyOn(fs, "lstatSync").mockImplementation(((path: fs.PathLike, options?: unknown) => {
      const st = actual(path, options as never);
      return String(path) === canonicalFile ? Object.assign(Object.create(st), { uid: (process.getuid?.() ?? 0) + 1 }) : st;
    }) as typeof fs.lstatSync);
    expect(() => ensureAntigravityTrust(cwd, home)).toThrow("antigravity-trust-preparation-failed");
    expect(fs.readFileSync(file, "utf8")).toBe("{}");
  });
  it.each(["collision", "write", "rename"])("preserves bytes and cleans owned temp after %s failure", (failure) => {
    fs.writeFileSync(file, "{}");
    if (failure === "collision") vi.spyOn(fs, "openSync").mockImplementation(() => { throw Object.assign(new Error("private path"), { code: "EEXIST" }); });
    if (failure === "write") vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw new Error("private path"); });
    if (failure === "rename") vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("private path"); });
    expect(() => ensureAntigravityTrust(cwd, home)).toThrow("antigravity-trust-preparation-failed");
    expect(fs.readFileSync(file, "utf8")).toBe("{}");
    expect(fs.readdirSync(join(home, ".gemini/antigravity-cli"))).toEqual(["settings.json"]);
  });
});
