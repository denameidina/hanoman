import { describe, it, expect } from "vitest";
import { clientRouteAllowed } from "../src/services/client-access";

describe("clientRouteAllowed (SPEC-617)", () => {
  it("portal boleh dibaca", () => {
    expect(clientRouteAllowed("GET", "/api/portal/projects")).toBe(true);
    expect(clientRouteAllowed("GET", "/api/portal/projects/p1/backlog")).toBe(true);
    expect(clientRouteAllowed("HEAD", "/api/portal/projects/p1/tickets")).toBe(true);
  });

  // Read-only ditegakkan oleh BENTUK, bukan sekadar oleh ketiadaan route tulis: route portal
  // yang suatu hari ditambahkan tanpa dipikirkan tetap tertutup.
  it("portal TIDAK boleh ditulis", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE"])
      expect(clientRouteAllowed(m, "/api/portal/projects/p1/backlog"), m).toBe(false);
  });

  it("Help Center tetap terbuka — permukaan itu sudah publik tanpa login", () => {
    expect(clientRouteAllowed("GET", "/api/help/proj")).toBe(true);
    expect(clientRouteAllowed("POST", "/api/help/proj/tickets")).toBe(true);
  });

  it("keluar & ganti password sendiri boleh; sisa /auth tidak", () => {
    expect(clientRouteAllowed("POST", "/api/auth/logout")).toBe(true);
    expect(clientRouteAllowed("POST", "/api/auth/change-password")).toBe(true);
    expect(clientRouteAllowed("GET", "/api/auth/users")).toBe(false);
    expect(clientRouteAllowed("POST", "/api/auth/users")).toBe(false);
    expect(clientRouteAllowed("DELETE", "/api/auth/users/x")).toBe(false);
  });

  // Deny-by-default: daftar ini bukan denylist yang harus dirawat, melainkan bukti bahwa
  // permukaan operator memang tertutup. Domain baru otomatis ikut tertutup.
  it("seluruh permukaan operator tertutup", () => {
    const paths = [
      "/api/specs", "/api/specs/SPEC-1", "/api/projects", "/api/projects/p1/docs",
      "/api/tickets", "/api/terminal/sessions", "/api/terminal/sessions/s1/ws",
      "/api/events/ws", "/api/settings", "/api/vps", "/api/notifications",
      "/api/agent-tokens", "/api/device-tokens", "/api/sync/pull", "/api/sync/now",
      "/api/lead/decisions", "/api/scheduler", "/api/webhooks", "/api/client-accounts",
      "/api/changelog", "/api/custom-agents", "/api/github-issues", "/api/telegram/settings",
      "/api/config", "/api/fs", "/api/limits", "/api/update/apply", "/api/ide",
      "/api/session-results", "/api/docs", "/api/codex/version", "/api/prds",
      "/api/session-events",   // SPEC-909 · ADR-0146
      "/api/members", "/api/members/a@x.id",   // SPEC-945 · ADR-0150
      "/api/tasks", "/api/tasks/t1", "/api/tasks/t1/escalate",   // SPEC-947 · ADR-0152
    ];
    for (const p of paths)
      for (const m of ["GET", "POST", "PATCH", "DELETE"])
        expect(clientRouteAllowed(m, p), `${m} ${p}`).toBe(false);
  });

  it("tak bisa ditipu path traversal atau prefix mirip", () => {
    expect(clientRouteAllowed("GET", "/api/portalx/secrets")).toBe(false);
    expect(clientRouteAllowed("GET", "/api/portal/../specs")).toBe(false);
    expect(clientRouteAllowed("GET", "/api/helpdesk/secrets")).toBe(false);
  });
  // SPEC-626 · ADR-0111 · SATU pintu tulis, dibuka sebagai BENTUK PATH, bukan sebagai
  // "portal boleh POST". Semua bentuk tulis lain tetap tertutup — termasuk yang lahir nanti.
  it("hanya kirim tiket portal yang boleh ditulis", () => {
    expect(clientRouteAllowed("POST", "/api/portal/projects/p1/tickets")).toBe(true);
    expect(clientRouteAllowed("POST", "/api/portal/projects/toko-mekar/tickets")).toBe(true);
  });

  // SPEC-854 · ADR-0129 · dua bentuk tulis baru, masing-masing dinyatakan sebagai BENTUK PATH
  // yang persis — bukan "portal boleh POST" (idiom ADR-0111).
  it("chat portal: baca boleh, dua bentuk tulis boleh", () => {
    expect(clientRouteAllowed("GET", "/api/portal/projects/p1/chat")).toBe(true);
    expect(clientRouteAllowed("GET", "/api/portal/projects/p1/chat/sessions")).toBe(true);
    expect(clientRouteAllowed("GET", "/api/portal/projects/p1/chat/sessions/s1")).toBe(true);
    expect(clientRouteAllowed("POST", "/api/portal/projects/p1/chat/sessions")).toBe(true);
    expect(clientRouteAllowed("POST", "/api/portal/projects/p1/chat/sessions/s1/messages")).toBe(true);
  });

  it("bentuk tulis chat lain tetap ditolak", () => {
    const paths = [
      "/api/portal/projects/p1/chat", "/api/portal/projects/p1/chat/sessions/s1",
      "/api/portal/projects/p1/chat/sessions/s1/prd",
      "/api/portal/projects/p1/chat/sessions/s1/messages/m1",
      "/api/portal/projects/p1/chat/export",
    ];
    for (const p of paths)
      for (const m of ["POST", "PATCH", "PUT", "DELETE"])
        expect(clientRouteAllowed(m, p), `${m} ${p}`).toBe(false);
    for (const m of ["PATCH", "PUT", "DELETE"])
      expect(clientRouteAllowed(m, "/api/portal/projects/p1/chat/sessions"), m).toBe(false);
  });

  // Permukaan operator chat portal tetap tertutup bagi klien.
  it("route operator chat portal tertutup", () => {
    for (const m of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(clientRouteAllowed(m, "/api/portal-chat/sessions"), m).toBe(false);
      expect(clientRouteAllowed(m, "/api/portal-chat/export"), m).toBe(false);
    }
  });

  it("bentuk tulis portal lain tetap ditolak", () => {
    const paths = [
      "/api/portal/projects/p1/tickets/t1", "/api/portal/projects/p1/backlog",
      "/api/portal/projects/p1/backlog/SPEC-1", "/api/portal/projects", "/api/portal/tickets",
      "/api/portal/projects/p1", "/api/portal/projects/p1/tickets/t1/attachments",
    ];
    for (const p of paths)
      for (const m of ["POST", "PATCH", "PUT", "DELETE"])
        expect(clientRouteAllowed(m, p), `${m} ${p}`).toBe(false);
    for (const m of ["PATCH", "PUT", "DELETE"])
      expect(clientRouteAllowed(m, "/api/portal/projects/p1/tickets"), m).toBe(false);
  });
});
