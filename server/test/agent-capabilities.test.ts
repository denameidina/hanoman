import { describe, it, expect } from "vitest";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";

describe("capabilityForRoute", () => {
  const cases: [string, string, unknown][] = [
    ["GET", "/api/projects", "projects:read"],
    ["POST", "/api/projects", "projects:write"],
    ["GET", "/api/projects/foo", "projects:read"],
    ["POST", "/api/projects/foo/rename", "projects:write"],
    ["GET", "/api/projects/foo/branches", "projects:read"],
    // SPEC-360 · `branches` SENGAJA bukan anggota IDE_SUBS: baris di atas sudah memetakan ke
    // projects:read, dan memasukkannya ke IDE_SUBS akan diam-diam mengubah endpoint lama itu.
    ["GET", "/api/projects/foo/branches/unused", "projects:read"],
    ["POST", "/api/projects/foo/branches/delete", "projects:write"],
    ["PUT", "/api/projects/foo/binding", "projects:write"],
    ["GET", "/api/projects/foo/docs/README.md", "docs:read"],
    ["PUT", "/api/projects/foo/docs/x.md", "docs:write"],
    ["GET", "/api/projects/foo/prds", "docs:read"],
    ["GET", "/api/prds", "docs:read"],
    ["GET", "/api/projects/foo/tree", "ide:read"],
    ["POST", "/api/projects/foo/git", "ide:write"],
    ["GET", "/api/projects/foo/status", "ide:read"],
    ["POST", "/api/projects/foo/remotes", "ide:write"],
    // ADR-0121 · operasi berkas Explorer. Diturunkan DARI METHOD, bukan dari prefix.
    ["POST", "/api/projects/foo/entry", "ide:write"],
    ["PATCH", "/api/projects/foo/entry", "ide:write"],
    ["DELETE", "/api/projects/foo/entry", "ide:write"],
    ["POST", "/api/projects/foo/upload", "ide:write"],
    ["GET", "/api/specs", "backlog:read"],
    ["POST", "/api/specs", "backlog:write"],
    ["POST", "/api/specs/SPEC-1/integrate", "backlog:write"],
    ["GET", "/api/terminal/sessions", "sessions:read"],
    ["POST", "/api/terminal/sessions", "sessions:write"],
    ["GET", "/api/terminal/sessions/abc/ws", "sessions:write"], // WS = kontrol interaktif
    ["GET", "/api/terminal/workspace", "COOKIE_ONLY"],
    ["PUT", "/api/terminal/workspace", "COOKIE_ONLY"],
    // SPEC-742 · ADR-0116 · route baru di bawah /terminal ikut capability `sessions` yang sudah
    // ada — nol domain baru, nol perubahan gerbang. Diikat di sini supaya tetap begitu.
    ["GET", "/api/terminal/cleanups", "sessions:read"],
    ["GET", "/api/vps", "vps:read"],
    ["POST", "/api/vps/v1/harden", "vps:write"],
    ["GET", "/api/settings", "settings:read"],
    ["PUT", "/api/settings", "settings:write"],
    ["GET", "/api/config", "settings:read"],
    ["GET", "/api/tickets", "support:read"],
    ["POST", "/api/tickets/t1/accept", "support:write"],
    ["GET", "/api/notifications", "notifications:read"],
    ["POST", "/api/notifications/read", "notifications:write"],
    ["GET", "/api/limits", "GLOBAL_READ"],
    ["GET", "/api/update", "GLOBAL_READ"],
    ["GET", "/api/events/ws", "GLOBAL_READ"],
    ["GET", "/api/fs/browse", "GLOBAL_READ"],
    ["GET", "/api/auth/users", "COOKIE_ONLY"],
    ["GET", "/api/agent-tokens", "COOKIE_ONLY"],
    ["POST", "/api/agent-tokens", "COOKIE_ONLY"],
    ["GET", "/api/device-tokens", "COOKIE_ONLY"],
    ["GET", "/api/sync/pull", "COOKIE_ONLY"],
    // SPEC-909 · ADR-0146 · memalsukan "sesi X bertanya Y" bukan capability, itu peniruan identitas.
    ["POST", "/api/session-events", "COOKIE_ONLY"],
    ["GET", "/api/nonsense", null],
  ];
  it.each(cases)("%s %s → %s", (m, p, want) => {
    expect(capabilityForRoute(m, p)).toBe(want);
  });

  // SPEC-471 · ADR-0095 · triase issue satu domain dengan tiket; dipetakan MENURUT METHOD
  // (kelas bug SPEC-405: prefix status yang lolos GLOBAL_READ tanpa melihat method).
  it("SPEC-471 · github-issues & projects/:id/github → domain support per-method", () => {
    expect(capabilityForRoute("GET", "/api/projects/p/github/issues")).toBe("support:read");
    expect(capabilityForRoute("POST", "/api/projects/p/github/pull")).toBe("support:write");
    expect(capabilityForRoute("GET", "/api/github-issues")).toBe("support:read");
    expect(capabilityForRoute("POST", "/api/github-issues/x/accept")).toBe("support:write");
  });

  // SPEC-516 · ADR-0105 · changelog adalah DOKUMEN, sejajar docs/prds — bukan `projects`, yang
  // akan menuntut agen dipercaya menyunting & menghapus project hanya untuk membaca changelog.
  it("SPEC-516 · changelog project → domain docs", () => {
    expect(capabilityForRoute("GET", "/api/projects/p1/changelog")).toBe("docs:read");
    expect(capabilityForRoute("GET", "/api/projects/p1/changelog/sources")).toBe("docs:read");
    expect(capabilityForRoute("POST", "/api/projects/p1/changelog")).toBe("docs:write");
    expect(capabilityForRoute("DELETE", "/api/projects/p1/changelog/abc")).toBe("docs:write");
  });
});

describe("checkAgentCapability", () => {
  it("allows when granted, write covers read, denies otherwise", () => {
    expect(checkAgentCapability(["projects:read"], "GET", "/api/projects")).toEqual({ ok: true });
    expect(checkAgentCapability(["projects:write"], "GET", "/api/projects")).toEqual({ ok: true });
    expect(checkAgentCapability(["projects:read"], "POST", "/api/projects"))
      .toMatchObject({ ok: false, status: 403, need: "projects:write", reason: "capability" });
    expect(checkAgentCapability(["projects:read"], "GET", "/api/auth/users"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    expect(checkAgentCapability(["projects:read"], "GET", "/api/nonsense"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    // GLOBAL_READ: token dengan capability apa pun boleh
    expect(checkAgentCapability(["projects:read"], "GET", "/api/limits")).toEqual({ ok: true });
  });
});

describe("status global read-only tak boleh tembus lewat method tulis (SPEC-405 · ADR-0088)", () => {
  it("GET /api/update tetap lolos tanpa capability apa pun", () => {
    expect(capabilityForRoute("GET", "/api/update")).toBe("GLOBAL_READ");
    expect(checkAgentCapability([], "GET", "/api/update")).toEqual({ ok: true });
  });
  it("POST /api/update/apply DITOLAK — bahkan untuk token ber-capability penuh", () => {
    expect(capabilityForRoute("POST", "/api/update/apply")).toBe("COOKIE_ONLY");
    const caps = ["backlog:write", "sessions:write", "settings:write", "projects:write"];
    expect(checkAgentCapability(caps, "POST", "/api/update/apply")).toMatchObject({ ok: false, status: 403 });
  });
  it("prefix status lain ikut: POST /api/limits & /api/health ditolak", () => {
    expect(capabilityForRoute("POST", "/api/limits")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/health")).toBe("COOKIE_ONLY");
  });
  it("HEAD dianggap baca", () => {
    expect(capabilityForRoute("HEAD", "/api/update")).toBe("GLOBAL_READ");
  });
  // SPEC-477 · ADR-0097 · permukaan KREDENSIAL bukan permukaan kerja sesi operator.
  it("SPEC-477 · settings/test/credentials Telegram = COOKIE_ONLY, sisanya tetap domain telegram", () => {
    expect(capabilityForRoute("GET", "/api/telegram/settings")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("PUT", "/api/telegram/settings")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/telegram/test")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("DELETE", "/api/telegram/credentials")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("GET", "/api/telegram/status")).toBe("telegram:read");
    expect(capabilityForRoute("POST", "/api/telegram/replies")).toBe("telegram:write");
    expect(capabilityForRoute("GET", "/api/telegram/audit")).toBe("telegram:read");
  });
});
