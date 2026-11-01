import { beforeEach, describe, expect, it } from "vitest";
import type { LimitsDTO } from "@hanoman/shared";
import { _setAccountSnapshot } from "../src/services/runtime-accounts/registry";
import { _resetAccountLimitsCache, getAccountLimits, type AccountLimitsDeps } from "../src/services/runtime-accounts/limits";

const W = (pct: number) => [{ key: "session", label: "Sesi 5 jam", usedPct: pct, resetsAt: null, severity: "normal" as const, isActive: true }];
const OK = (pct: number): LimitsDTO => ({ status: "ok", windows: W(pct), fetchedAt: "2026-11-01T00:00:00.000Z" });
const NONE: LimitsDTO = { status: "unavailable", windows: [], fetchedAt: null };
const row = (id: string, runtime: "claude" | "codex") =>
  ({ id, runtime, label: id, homeDir: `/h/${id}`, identity: { email: "rahasia@x.id" }, status: "aktif" as const, createdAt: new Date(), lastLoginAt: null });

let now = 1_000_000;
const deps = (over: Partial<AccountLimitsDeps> = {}): AccountLimitsDeps => ({
  now: () => now, fetchEnabled: true,
  builtin: { claude: async () => OK(10), codex: async () => OK(20), antigravity: async () => NONE },
  claudeToken: () => "tok", claudeWindows: async () => W(55), codexLimits: async () => OK(66),
  antigravity: async () => NONE,
  ...over,
});

beforeEach(() => {
  _resetAccountLimitsCache(); now = 1_000_000;
  _setAccountSnapshot({ rows: [row("aaaaaaaa", "claude"), row("bbbbbbbb", "codex")], defaults: { claude: "aaaaaaaa" } });
});

describe("getAccountLimits", () => {
  it("bawaan + akun, default ditandai, TANPA email", async () => {
    const out = await getAccountLimits(deps());
    expect(out.map((a) => [a.accountId, a.limits.windows[0]?.usedPct ?? null, a.isDefault])).toEqual([
      ["default:claude", 10, false], ["aaaaaaaa", 55, true],
      ["default:codex", 20, true], ["bbbbbbbb", 66, false],
      ["default:antigravity", null, true],
    ]);
    expect(JSON.stringify(out)).not.toContain("rahasia@x.id");
  });

  it("cache 30 dtk per akun; gagal sesudahnya → data terakhir sebagai stale", async () => {
    let calls = 0;
    const d = deps({ claudeWindows: async () => (++calls === 1 ? W(55) : null) });
    await getAccountLimits(d);
    await getAccountLimits(d);
    expect(calls).toBe(1);
    now += 31_000;
    const out = await getAccountLimits(d);
    expect(out.find((a) => a.accountId === "aaaaaaaa")!.limits).toMatchObject({ status: "stale", windows: W(55) });
  });

  it("token tak terbaca → unavailable; fetch dimatikan → unavailable tanpa memanggil apa pun", async () => {
    expect((await getAccountLimits(deps({ claudeToken: () => null }))).find((a) => a.accountId === "aaaaaaaa")!.limits.status).toBe("unavailable");
    let called = false;
    await getAccountLimits(deps({ fetchEnabled: false, claudeWindows: async () => { called = true; return W(1); } }));
    expect(called).toBe(false);
  });

  it("codex membaca <homeDir>/sessions", async () => {
    let dir = "";
    await getAccountLimits(deps({ codexLimits: async (d) => { dir = d; return OK(1); } }));
    expect(dir).toBe("/h/bbbbbbbb/sessions");
  });
});
