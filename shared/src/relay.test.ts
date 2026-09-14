import { describe, it, expect } from "vitest";
import {
  RELAY_PART_MAX_BYTES, REMOTE_CAPABILITIES, relayBodyAllowed, relayRouteAllowed, remoteCapabilityFor,
  splitUtf8, utf8Bytes, validateRemoteGrant, zClientToHubFrame, zHubToClientFrame,
} from "./relay";

const actor = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };

describe("relayRouteAllowed (SPEC-1215 · ADR-0165 §5)", () => {
  const allowed: [string, string][] = [
    ["GET", "/api/terminal/sessions"],
    ["POST", "/api/terminal/sessions"],
    ["GET", "/api/terminal/sessions/spec-1/phases"],
    ["GET", "/api/terminal/sessions/spec-1/dialog"],
    ["POST", "/api/terminal/sessions/spec-1/steer"],
    ["POST", "/api/terminal/sessions/spec-1/interrupt"],
    ["POST", "/api/terminal/sessions/spec-1/dialog/answer"],
    ["POST", "/api/terminal/sessions/spec-1/dialog/takeover"],
    ["GET", "/api/terminal/sessions/spec-1/ws"],
    ["GET", "/api/terminal/sessions/spec-1/review"],
    ["GET", "/api/terminal/sessions/spec-1/review/docs/plan.md"],
    ["GET", "/api/specs/SPEC-1/docs"],
    ["GET", "/api/specs/SPEC-1/docs/docs/superpowers/plans/x.md"],
    ["GET", "/api/specs/SPEC-1/review"],
    ["GET", "/api/specs/SPEC-1/review/file.md?x=1"],
    ["GET", "/api/projects/hanoman/tree"],
    ["GET", "/api/projects/hanoman/file?path=README.md"],
    ["GET", "/api/projects/hanoman/working-status"],
    ["GET", "/api/projects/hanoman/file-diff?path=a.ts"],
    ["GET", "/api/projects/hanoman/status"],
    ["GET", "/api/projects/hanoman/graph"],
    ["GET", "/api/projects/hanoman/graph/search?q=x"],
    ["GET", "/api/projects/hanoman/compare"],
    ["GET", "/api/projects/hanoman/compare/file"],
    ["GET", "/api/projects/hanoman/commit/abc123"],
    ["GET", "/api/projects/hanoman/commit/abc123/file"],
    ["POST", "/api/specs/SPEC-1/done"],
    ["GET", "/api/events/ws"],
  ];
  for (const [m, p] of allowed) it(`boleh: ${m} ${p}`, () => expect(relayRouteAllowed(m, p)).toBe(true));

  const denied: [string, string][] = [
    ["PATCH", "/api/specs/SPEC-1"],
    ["DELETE", "/api/specs/SPEC-1"],
    ["POST", "/api/specs/SPEC-1/attachments"],
    ["POST", "/api/specs/SPEC-1/integrate"],
    ["DELETE", "/api/terminal/sessions/spec-1"],
    ["PUT", "/api/projects/hanoman/file"],
    ["POST", "/api/projects/hanoman/git"],
    ["POST", "/api/projects/hanoman/entry"],
    ["POST", "/api/projects/hanoman/upload"],
    ["GET", "/api/projects/hanoman/archive"],
    ["GET", "/api/settings"],
    ["PUT", "/api/settings"],
    ["GET", "/api/remote-control"],
    ["GET", "/api/device-tokens"],
    ["GET", "/api/sync/pull"],
    ["GET", "/api/presence"],
    ["GET", "/api/terminal/workspace"],
    ["GET", "/api/specs/SPEC-1/review/x.md?download=1"],
    ["GET", "/api/terminal/sessions/spec-1/review?download"],
    ["GET", "/api/specs/SPEC-1/docs/../../../etc/passwd"],
    ["GET", "/api/specs/SPEC-1/docs/%2e%2e/secret"],
    ["GET", "/api/terminal/sessions/"],
    ["GET", "/terminal/sessions"],
  ];
  for (const [m, p] of denied) it(`tolak: ${m} ${p}`, () => expect(relayRouteAllowed(m, p)).toBe(false));
});

describe("relayBodyAllowed", () => {
  it("POST /terminal/sessions hanya varian spec", () => {
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", { spec: "SPEC-1", flow: "feature" })).toBe(true);
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", { project: "p1", shell: true })).toBe(false);
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", { project: "p1", flow: "reverse" })).toBe(false);
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", { spec: "" })).toBe(false);
    expect(relayBodyAllowed("POST", "/api/terminal/sessions", undefined)).toBe(false);
  });
  it("route lain tak dinilai body-nya", () => {
    expect(relayBodyAllowed("POST", "/api/terminal/sessions/spec-1/steer", { text: "x" })).toBe(true);
  });
});

describe("remoteCapabilityFor", () => {
  it("WS terminal mode read menuntut sessions:read", () => {
    expect(remoteCapabilityFor("GET", "/api/terminal/sessions/spec-1/ws", "read")).toBe("sessions:read");
    expect(remoteCapabilityFor("GET", "/api/terminal/sessions/spec-1/ws", "write")).toBeNull();
    expect(remoteCapabilityFor("GET", "/api/terminal/sessions", "read")).toBeNull();
  });
});

describe("validateRemoteGrant", () => {
  it("menerima kosong, Lihat, dan kombinasi ber-sessions:read", () => {
    expect(validateRemoteGrant([])).toBeNull();
    expect(validateRemoteGrant(["sessions:read", "backlog:read", "ide:read"])).toBeNull();
    expect(validateRemoteGrant([...REMOTE_CAPABILITIES])).toBeNull();
  });
  it("menolak capability di luar kosakata dan tulis tanpa sessions:read", () => {
    expect(validateRemoteGrant(["vps:exec"])).toMatch(/REMOTE_CAPABILITIES/);
    expect(validateRemoteGrant(["sessions:write"])).toMatch(/sessions:read/);
  });
});

describe("utf8Bytes & splitUtf8", () => {
  it("menghitung byte UTF-8 termasuk pasangan surrogate", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("€")).toBe(3);
    expect(utf8Bytes("😀")).toBe(4);
    expect(utf8Bytes("😀é")).toBe(new TextEncoder().encode("😀é").byteLength);
  });
  it("memotong ≤ maxBytes tanpa membelah karakter, dan menyambung kembali utuh", () => {
    const text = "a😀€é".repeat(20_000);
    const parts = splitUtf8(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(utf8Bytes(p)).toBeLessThanOrEqual(RELAY_PART_MAX_BYTES);
    expect(parts.join("")).toBe(text);
    expect(splitUtf8("")).toEqual([""]);
    expect(splitUtf8("😀😀", 4)).toEqual(["😀", "😀"]);
  });
});

describe("frame relay .strict()", () => {
  it("req sah lolos; field asing, path non-/api, dan method asing dibuang", () => {
    const req = { t: "req", id: "r1", method: "GET", path: "/api/terminal/sessions", actor };
    expect(zHubToClientFrame.safeParse(req).success).toBe(true);
    expect(zHubToClientFrame.safeParse({ ...req, extra: 1 }).success).toBe(false);
    expect(zHubToClientFrame.safeParse({ ...req, path: "/etc/passwd" }).success).toBe(false);
    expect(zHubToClientFrame.safeParse({ ...req, path: "/api/a/../b" }).success).toBe(false);
    expect(zHubToClientFrame.safeParse({ ...req, method: "TRACE" }).success).toBe(false);
    expect(zHubToClientFrame.safeParse({ ...req, actor: { ...actor, role: "x" } }).success).toBe(false);
  });
  it("hello membawa protocol numerik apa pun (hub yang memutuskan cocok/tidak)", () => {
    const hello = { t: "hello", v: 1, protocol: 2, version: "0.5.0", capabilities: ["sessions:read"] };
    expect(zClientToHubFrame.safeParse(hello).success).toBe(true);
    expect(zClientToHubFrame.safeParse({ ...hello, capabilities: ["vps:exec"] }).success).toBe(false);
  });
  it("res dengan part > 32 KiB ditolak", () => {
    const big = "x".repeat(RELAY_PART_MAX_BYTES + 1);
    expect(zClientToHubFrame.safeParse({ t: "res", id: "r1", status: 200, part: "ok", end: true }).success).toBe(true);
    expect(zClientToHubFrame.safeParse({ t: "res", id: "r1", part: big, end: true }).success).toBe(false);
  });
});
