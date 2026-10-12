// SPEC-617 · ADR-0110 · akun klien tak boleh memicu SATU PUN efek operator. Sebelumnya fetch global dan
// socket `events` berjalan sebelum cabang ClientPortal, sehingga konsol penuh 403 (ws-tickets, models,
// projects, specs, terminal/sessions, setup/status). Test ini menjaga gerbangnya dari dua sisi: klien tak
// memanggil apa pun, dan operator (kontrol) memanggilnya — supaya asersi "tak dipanggil" tak kosong.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { eventsStub } from "./helpers/events-stub";
import { api } from "../src/api/client";
import { subscribe } from "../src/api/events";

const { role } = vi.hoisted(() => ({ role: { value: "client" as "client" | "admin" } }));

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  const empty = { items: [], total: 0, page: 1, pageSize: 20 };
  return {
    ...actual,
    api: {
      authStatus: vi.fn(async () => ({ needsSetup: false, user: { id: "u1", email: "k@x.co", role: role.value, createdAt: "" } })),
      setupStatus: vi.fn(async () => ({ needed: false, deployment: "local", hardening: false,
        hardeningLocked: false, supervised: false, setupTokenRequired: false, prerequisites: [] })),
      listProjects: vi.fn(async () => empty),
      listSpecs: vi.fn(async () => empty),
      listTerminals: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({})),
      getMethodStatus: vi.fn(async () => ({ methods: [] })),
      getCodexVersion: vi.fn(async () => ({ version: null, minRequired: "0.144.0" })),
      listNotifications: vi.fn(async () => ({ items: [], unread: 0 })),
      getLimits: vi.fn(async () => null),
      getCodexLimits: vi.fn(async () => null),
      getUpdateStatus: vi.fn(async () => ({ current: "0.0.0", latest: null, canApply: false })),
      presence: vi.fn(async () => ({ enabled: false, devices: [] })),
    },
  };
});

vi.mock("../src/api/events", () => ({
  ...eventsStub,
  subscribe: vi.fn(() => () => {}),
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

// Portal klien punya datanya sendiri (dimuat lewat endpoint klien); test ini hanya menilai gerbangnya.
vi.mock("../src/portal/ClientPortal", async () => {
  const React = await import("react");
  return { ClientPortal: () => React.createElement("p", null, "portal klien") };
});

import App from "../src/App";

const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
const calledModels = () => (fetchMock.mock.calls as unknown[][]).some((call) => String(call[0]).includes("/api/models"));
const operatorCalls = () => [
  api.listProjects, api.listSpecs, api.listTerminals, api.setupStatus,
] as unknown as Array<ReturnType<typeof vi.fn>>;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  vi.clearAllMocks();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("akun klien: tak ada efek operator yang berjalan", () => {
  it("klien mendarat di portalnya tanpa memanggil endpoint operator, tanpa socket, tanpa /api/models", async () => {
    role.value = "client";
    render(<App />);
    expect(await screen.findByText("portal klien")).toBeTruthy();
    for (const fn of operatorCalls()) expect(fn).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(calledModels()).toBe(false);
  });
});

describe("kontrol: operator memanggil efek yang sama (membuktikan asersi di atas tidak kosong)", () => {
  it("operator memuat data, membuka socket, dan memuat katalog model", async () => {
    role.value = "admin";
    render(<App />);
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    expect(api.listSpecs).toHaveBeenCalled();
    expect(api.listTerminals).toHaveBeenCalled();
    expect(api.setupStatus).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalled();
    await waitFor(() => expect(calledModels()).toBe(true));
  });
});
