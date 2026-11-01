import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import {
  AccountError, _setAccountSnapshot, accountSnapshot, checkAccount, createAccount, deleteAccount,
  listAccountDTOs, refreshSnapshot, renameAccount, setDefaultAccount,
} from "../src/services/runtime-accounts/registry";
import { assertLaunchAccount, resolveLaunchAccount } from "../src/services/runtime-accounts/resolver";

const home = mkdtempSync(join(tmpdir(), "ra-reg-"));
const prev = { h: process.env.HANOMAN_HOME, c: process.env.HANOMAN_CLAUDE_HOME, x: process.env.HANOMAN_CODEX_HOME };
process.env.HANOMAN_HOME = home;
// Home bawaan palsu: test tak boleh membuat symlink ke ~/.claude / ~/.codex mesin operator.
process.env.HANOMAN_CLAUDE_HOME = join(home, "base-claude");
process.env.HANOMAN_CODEX_HOME = join(home, "base-codex");
afterAll(() => {
  for (const [k, v] of [["HANOMAN_HOME", prev.h], ["HANOMAN_CLAUDE_HOME", prev.c], ["HANOMAN_CODEX_HOME", prev.x]] as const)
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(home, { recursive: true, force: true });
});

const okProbe = async () => ({ loggedIn: true, identity: { email: "a@x.id", plan: "max" } });
const probes = { claude: okProbe, codex: okProbe, antigravity: async () => ({ loggedIn: false, identity: null }) };
const quiet = { sandbox: false, warn: () => {} };

beforeEach(async () => {
  await prisma.runtimeAccount.deleteMany();
  await prisma.setting.deleteMany();
  await refreshSnapshot();
});

describe("registry", () => {
  it("akun bawaan selalu ada (3 runtime) dan jadi default", () => {
    const all = listAccountDTOs();
    expect(all.filter((a) => a.builtin).map((a) => a.id)).toEqual(["default:claude", "default:codex", "default:antigravity"]);
    expect(all.every((a) => a.isDefault)).toBe(true);
  });

  it("create → baris + home 0700 di bawah $HANOMAN_HOME/accounts, status belum-login", async () => {
    const a = await createAccount("claude", "Kantor");
    expect(a).toMatchObject({ runtime: "claude", label: "Kantor", builtin: false, status: "belum-login", isDefault: false });
    expect(a.id).toMatch(/^[0-9a-f]{8}$/);
    expect(existsSync(join(home, "accounts", "claude", a.id))).toBe(true);
  });

  it("label duplikat per runtime / label 'Default' → account-label-taken", async () => {
    await createAccount("claude", "Kantor");
    await expect(createAccount("claude", "Kantor")).rejects.toMatchObject({ code: "account-label-taken", status: 409 });
    await expect(createAccount("codex", "default")).rejects.toMatchObject({ code: "account-label-taken" });
    await expect(createAccount("codex", "Kantor")).resolves.toMatchObject({ runtime: "codex" });
  });

  it("rename & delete; delete menghapus home dan mengembalikan default ke bawaan", async () => {
    const a = await createAccount("codex", "A");
    await renameAccount(a.id, "B");
    await checkAccount(a.id, probes);
    await setDefaultAccount("codex", a.id, false);
    expect(accountSnapshot().defaults.codex).toBe(a.id);
    await deleteAccount(a.id, () => []);
    expect(existsSync(join(home, "accounts", "codex", a.id))).toBe(false);
    expect(accountSnapshot().defaults.codex).toBeUndefined();
  });

  it("delete akun yang dipakai sesi hidup → account-in-use", async () => {
    const a = await createAccount("claude", "Sibuk");
    await expect(deleteAccount(a.id, () => [a.id])).rejects.toMatchObject({ code: "account-in-use", status: 409 });
  });

  it("setDefault: runtime salah → mismatch; sandbox → sandbox-unsupported; id asing → 404", async () => {
    const a = await createAccount("claude", "K");
    await expect(setDefaultAccount("codex", a.id, false)).rejects.toMatchObject({ code: "account-runtime-mismatch" });
    await expect(setDefaultAccount("claude", a.id, true)).rejects.toMatchObject({ code: "account-sandbox-unsupported" });
    await expect(setDefaultAccount("claude", "deadbeef", false)).rejects.toMatchObject({ code: "account-not-found", status: 404 });
    await expect(setDefaultAccount("claude", "default:codex", false)).rejects.toMatchObject({ code: "account-runtime-mismatch" });
  });

  it("checkAccount: login → aktif + identitas + lastLoginAt", async () => {
    const a = await createAccount("claude", "K");
    const got = await checkAccount(a.id, probes);
    expect(got).toMatchObject({ status: "aktif", identity: { email: "a@x.id", plan: "max" } });
    expect(got.lastLoginAt).not.toBeNull();
  });
});

describe("resolver", () => {
  it("akun bawaan / tanpa default → null (perilaku lama)", () => {
    expect(resolveLaunchAccount("claude", undefined, quiet)).toBeNull();
    expect(resolveLaunchAccount("claude", "default:claude", quiet)).toBeNull();
  });

  it("akun claude eksplisit → CLAUDE_CONFIG_DIR + lepas token env", async () => {
    const a = await createAccount("claude", "K");
    await checkAccount(a.id, probes);
    const r = resolveLaunchAccount("claude", a.id, quiet);
    expect(r).toEqual({ id: a.id, env: { CLAUDE_CONFIG_DIR: join(home, "accounts", "claude", a.id) }, unset: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] });
  });

  it("default codex aktif dipakai sesi otomatis; default yang belum login jatuh ke bawaan", async () => {
    const a = await createAccount("codex", "C");
    await checkAccount(a.id, probes);
    await setDefaultAccount("codex", a.id, false);
    expect(resolveLaunchAccount("codex", undefined, quiet)?.env).toEqual({ CODEX_HOME: join(home, "accounts", "codex", a.id) });
    _setAccountSnapshot({ rows: accountSnapshot().rows.map((r) => ({ ...r, status: "perlu-login-ulang" as const })) });
    const warns: string[] = [];
    expect(resolveLaunchAccount("codex", undefined, { sandbox: false, warn: (m) => warns.push(m) })).toBeNull();
    expect(warns).toHaveLength(1);
  });

  it("agy: tanpa akun agy terdaftar → tak ada penukaran; dengan akun → slot target diaktifkan", async () => {
    const calls: string[] = [];
    const d = { ...quiet, activateAgy: (id: string) => { calls.push(id); } };
    expect(resolveLaunchAccount("antigravity", undefined, d)).toBeNull();
    expect(calls).toEqual([]);
    const a = await createAccount("antigravity", "G");
    _setAccountSnapshot({ rows: accountSnapshot().rows.map((r) => (r.id === a.id ? { ...r, status: "aktif" as const } : r)) });
    expect(resolveLaunchAccount("antigravity", a.id, d)).toEqual({ id: a.id, env: {}, unset: [] });
    // Default = bawaan → slot bawaan diaktifkan kembali (akun lain mungkin sedang memegang Keychain).
    expect(resolveLaunchAccount("antigravity", undefined, d)).toBeNull();
    expect(calls).toEqual([a.id, "default:antigravity"]);
  });

  it("sandbox aktif → selalu null", async () => {
    const a = await createAccount("claude", "K");
    await checkAccount(a.id, probes);
    expect(resolveLaunchAccount("claude", a.id, { sandbox: true, warn: () => {} })).toBeNull();
  });

  it("assertLaunchAccount: 404 / mismatch / belum login / sandbox", async () => {
    const a = await createAccount("claude", "K");
    await expect(assertLaunchAccount("claude", "deadbeef", false)).rejects.toMatchObject({ code: "account-not-found", status: 404 });
    await expect(assertLaunchAccount("codex", a.id, false)).rejects.toMatchObject({ code: "account-runtime-mismatch" });
    await expect(assertLaunchAccount("claude", a.id, false)).rejects.toMatchObject({ code: "account-not-logged-in" });
    await checkAccount(a.id, probes);
    await expect(assertLaunchAccount("claude", a.id, true)).rejects.toMatchObject({ code: "account-sandbox-unsupported" });
    await expect(assertLaunchAccount("claude", a.id, false)).resolves.toBeUndefined();
    await expect(assertLaunchAccount("claude", undefined, false)).resolves.toBeUndefined();
    await expect(assertLaunchAccount("claude", "default:codex", false)).rejects.toBeInstanceOf(AccountError);
  });
});
