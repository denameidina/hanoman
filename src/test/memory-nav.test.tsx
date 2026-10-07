import { describe, expect, it } from "vitest";
import { pendingFor } from "@hanoman/shared";
import { HN_NAV, NAV_KEYS } from "../src/ds/shell";
import { ICONS } from "../src/ds/icon-registry";
import { parseRoute, routePath } from "../src/routes";
import { notifTarget } from "../src/notifications/target";
import { toastFor } from "../src/notifications/NotificationsContext";

const prefs = { notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" } as const;
const notif = (over: any) => ({ id: "1", specId: null, sessionId: null, title: "Memori butuh review: x", projectId: "p1", createdAt: "", readAt: null, ...over });

describe("ADR-0181 · navigasi Memori", () => {
  it("entri nav 'Memori' ber-ikon brain, tanpa gate, tepat sesudah QA; ikon terdaftar", () => {
    expect(HN_NAV.find((n) => n.key === "memory")).toEqual({ key: "memory", label: "Memori", icon: "brain" });
    const keys = HN_NAV.map((n) => n.key);
    expect(keys[keys.indexOf("qa") + 1]).toBe("memory");
    expect(ICONS.Brain).toBeDefined();
  });

  it("rute /memory dan /memory/<projectId> bolak-balik", () => {
    expect(parseRoute("/memory", NAV_KEYS)).toEqual({ section: "memory" });
    expect(parseRoute("/memory/p%201", NAV_KEYS)).toEqual({ section: "memory", projectId: "p 1" });
    expect(routePath({ section: "memory", projectId: "p 1" })).toBe("/memory/p%201");
    expect(routePath({ section: "memory" })).toBe("/memory");
  });

  it("badge sidebar memakai PendingCounts.memory", () => {
    expect(pendingFor({ triage: 0, backlog: 0, prd: 0, lead: 0, memory: 3 }, "memory")).toBe(3);
  });

  it("notifikasi memory → halaman Memori project-nya; toast warn", () => {
    expect(notifTarget(notif({ type: "memory" }) as never, [])).toEqual({ section: "memory", projectFilter: "p1" });
    expect(toastFor(notif({ type: "memory" }) as never, prefs as never)).toMatchObject({ tone: "warn", icon: "brain", enabled: true });
  });
});
