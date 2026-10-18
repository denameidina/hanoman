import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getAntigravityLimits, mapQuota, readAgyToken, _resetAntigravityLimitsCache, type AntigravityLimitsDeps,
} from "../src/services/antigravity-limits";

// ADR-0224 · nol Keychain, nol jaringan: semua sumber disuntik.

const NOW = Date.parse("2026-10-18T06:00:00Z");

/** Bentuk respons `retrieveUserQuotaSummary` terukur 2026-10-18 (agy 1.4.2). */
const QUOTA = {
  groups: [
    { displayName: "Gemini Models", buckets: [
      { bucketId: "gemini-weekly", window: "weekly", resetTime: "2026-10-21T00:53:03Z", remainingFraction: 0.9656534 },
      { bucketId: "gemini-5h", window: "5h", resetTime: "2026-10-18T11:24:14Z", remainingFraction: 1 },
    ] },
    { displayName: "Claude and GPT models", buckets: [
      { bucketId: "3p-weekly", window: "weekly", resetTime: "2026-10-23T15:11:01Z", remainingFraction: 0.7598932 },
      { bucketId: "3p-5h", window: "5h", resetTime: "2026-10-18T11:24:14Z", remainingFraction: 0 },
    ] },
  ],
};

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

function deps(over: Partial<AntigravityLimitsDeps> = {}): AntigravityLimitsDeps {
  return {
    platform: "darwin",
    token: () => ({ accessToken: "tok", expiry: NOW + 3_600_000 }),
    project: () => "proj-1",
    fetch: ok(QUOTA) as unknown as typeof fetch,
    now: () => NOW,
    ...over,
  };
}

beforeEach(() => _resetAntigravityLimitsCache());

describe("mapQuota", () => {
  it("satu window per grup × jendela, persen TERPAKAI dari remainingFraction", () => {
    const w = mapQuota(QUOTA);
    expect(w.map((x) => [x.key, x.label, x.usedPct, x.severity, x.isActive])).toEqual([
      ["antigravity:gemini-weekly", "Gemini · Mingguan", 3, "normal", false],
      ["antigravity:gemini-5h", "Gemini · Sesi 5 jam", 0, "normal", false],
      ["antigravity:3p-weekly", "Claude/GPT · Mingguan", 24, "normal", false],
      ["antigravity:3p-5h", "Claude/GPT · Sesi 5 jam", 100, "critical", true],
    ]);
    expect(w[0]!.resetsAt).toBe("2026-10-21T00:53:03Z");
  });

  it("bentuk tak dikenali → kosong, bukan angka karangan", () => {
    expect(mapQuota(null)).toEqual([]);
    expect(mapQuota({ groups: [{ buckets: [{ bucketId: "x" }] }] })).toEqual([]);
  });
});

describe("readAgyToken", () => {
  it("membuka format go-keyring-base64", () => {
    const json = JSON.stringify({ token: { access_token: "abc", expiry: "2026-10-18T14:12:39.763034+07:00" } });
    const t = readAgyToken(() => `go-keyring-base64:${Buffer.from(json).toString("base64")}\n`);
    expect(t).toEqual({ accessToken: "abc", expiry: Date.parse("2026-10-18T14:12:39.763034+07:00") });
  });
  it("entri tak ada / rusak → null", () => {
    expect(readAgyToken(() => { throw new Error("not found"); })).toBeNull();
    expect(readAgyToken(() => "go-keyring-base64:bukan-json")).toBeNull();
  });
});

describe("getAntigravityLimits", () => {
  it("token hidup → status ok, mengirim token & project", async () => {
    const d = deps();
    const r = await getAntigravityLimits(d);
    expect(r.status).toBe("ok");
    expect(r.windows).toHaveLength(4);
    const [url, init] = vi.mocked(d.fetch).mock.calls[0]!;
    expect(String(url)).toContain("v1internal:retrieveUserQuotaSummary");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok");
    // Tanpa `antigravity` di UA endpoint menjawab 403 "no valid license" (terukur 2026-10-18).
    expect((init!.headers as Record<string, string>)["user-agent"]).toBe("antigravity (hanoman)");
    expect(JSON.parse(String(init!.body))).toEqual({ project: "proj-1" });
  });

  it("token kedaluwarsa → NOL panggilan jaringan, unavailable", async () => {
    const d = deps({ token: () => ({ accessToken: "tok", expiry: NOW - 1 }) });
    expect((await getAntigravityLimits(d)).status).toBe("unavailable");
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("sesudah sukses, token kedaluwarsa memberi data terakhir sebagai stale", async () => {
    let t = 0;
    const d = deps({ now: () => NOW + t });
    await getAntigravityLimits(d);
    t = 2 * 3_600_000;                              // lewat TTL & lewat masa token
    const r = await getAntigravityLimits(d);
    expect(r.status).toBe("stale");
    expect(r.windows).toHaveLength(4);
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it("cache 60 dtk menahan panggilan berulang", async () => {
    const d = deps();
    await getAntigravityLimits(d);
    await getAntigravityLimits(d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it("HTTP gagal / jaringan melempar → unavailable", async () => {
    expect((await getAntigravityLimits(deps({ fetch: vi.fn(async () => new Response("no", { status: 401 })) as never }))).status)
      .toBe("unavailable");
    expect((await getAntigravityLimits(deps({ fetch: vi.fn(async () => { throw new Error("down"); }) as never }))).status)
      .toBe("unavailable");
  });

  it("platform selain macOS → unavailable tanpa membaca token", async () => {
    const token = vi.fn(() => null);
    expect((await getAntigravityLimits(deps({ platform: "linux", token }))).status).toBe("unavailable");
    expect(token).not.toHaveBeenCalled();
  });
});
