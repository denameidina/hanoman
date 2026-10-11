// Audit UI/UX 2026-10 · frame snapshot `sessions` / `leadAsks` / `pending` yang isinya sama tak boleh
// me-render ulang App (dan HanomanPet di dalamnya). HanomanPet di-mock supaya hitungan render-nya
// hanya berasal dari App.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { eventsStub } from "./helpers/events-stub";

const { subs, pet } = vi.hoisted(() => ({
  subs: new Set<(m: any) => void>(),
  pet: { renders: 0 },
}));

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      authStatus: vi.fn().mockResolvedValue({ needsSetup: false, user: { id: "u1", email: "a@b.c", role: "admin" } }),
      setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
        hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
      listProjects: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listSpecs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listTerminals: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({}),
      getMethodStatus: vi.fn().mockResolvedValue({ statuses: [] }),
      getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0" }),
      listNotifications: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getLimits: vi.fn().mockResolvedValue(null),
      getCodexLimits: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ current: "0.0.0", latest: null, canApply: false }),
      presence: vi.fn().mockResolvedValue({ enabled: false, devices: [] }),
    },
  };
});

vi.mock("../src/api/events", () => ({
  ...eventsStub,
  // Penangkap handler: setiap pemanggilan `subscribe` (App dan NotificationsProvider) didaftarkan di sini
  // sehingga test bisa mendorong frame siar seperti server.
  subscribe: (fn: (m: any) => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

vi.mock("../src/screens/HanomanPet", () => ({
  HanomanPet: () => { pet.renders += 1; return null; },
}));

import App from "../src/App";

const emit = (m: unknown) => act(() => { for (const fn of [...subs]) fn(m); });

const session = (over: Record<string, unknown> = {}) => ({
  id: "s1", projectId: "p1", cwd: "/repo", exited: false, decision: false, ...over,
});
const ask = (over: Record<string, unknown> = {}) => ({
  sessionId: "s1", agent: "claude", source: "hook", askId: "a1", askedAt: "2026-10-11T00:00:00.000Z",
  questions: [], message: "lanjut?", at: 0, total: 1, state: "queued", flowId: null, step: null, ...over,
});
const counts = { triage: 0, backlog: 0, prd: 0, lead: 0 };

beforeEach(() => {
  localStorage.clear();
  // Pet tablet/ponsel default MATI (SPEC-pet lajur). Test ini mengukur render pet, jadi nyalakan dulu.
  localStorage.setItem("hn.ui.v1.pet.enabled", "true");
  window.location.hash = "";
  subs.clear();
  pet.renders = 0;
});

describe("App: frame siar identik tak me-render ulang", () => {
  it("sessions, leadAsks, pending: isi sama = tanpa render; isi berubah = render", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("nafanesia.id · ringkasan workspace")).toBeTruthy());
    await waitFor(() => expect(subs.size).toBeGreaterThan(0));

    // sessions: berubah dari [] → render.
    const beforeSessions = pet.renders;
    emit({ t: "sessions", sessions: [session()] });
    expect(pet.renders).toBeGreaterThan(beforeSessions);

    // sessions: objek baru, isi sama → tanpa render.
    const afterSessions = pet.renders;
    emit({ t: "sessions", sessions: [session()] });
    expect(pet.renders).toBe(afterSessions);

    // pending: null → nilai pertama → render; lalu isi sama → tanpa render.
    const beforePending = pet.renders;
    emit({ t: "pending", counts });
    expect(pet.renders).toBeGreaterThan(beforePending);
    const afterPending = pet.renders;
    emit({ t: "pending", counts: { ...counts } });
    expect(pet.renders).toBe(afterPending);

    // leadAsks: [] → [ask] → render; lalu isi sama → tanpa render.
    const beforeAsks = pet.renders;
    emit({ t: "leadAsks", asks: [ask()] });
    expect(pet.renders).toBeGreaterThan(beforeAsks);
    const afterAsks = pet.renders;
    emit({ t: "leadAsks", asks: [ask()] });
    expect(pet.renders).toBe(afterAsks);

    // Sessions berubah lagi (stage/exited) → render: digest tak membungkam perubahan nyata.
    const beforeExit = pet.renders;
    emit({ t: "sessions", sessions: [session({ exited: true, exitCode: 0 })] });
    expect(pet.renders).toBeGreaterThan(beforeExit);
  });
});
