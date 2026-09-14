import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteControlView } from "@hanoman/shared";
import { RemoteControlPanel } from "./RemoteControlPanel";

const base: RemoteControlView = {
  control: { enabled: false, capabilities: [] },
  logs: { event: true, server: false, transcript: false },
  relay: { state: "off", since: null, hubOrigin: null, lastClose: null },
  audit: [],
};
const json = (value: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => value } as Response);

function mockApi(initial: RemoteControlView) {
  const puts: unknown[] = [];
  let current = initial;
  vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    if (String(url) === "/api/remote-control" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { control: RemoteControlView["control"] };
      puts.push(body);
      current = { ...current, control: body.control };
      return json(current);
    }
    if (String(url) === "/api/remote-control") return json(current);
    throw new Error(`unexpected fetch ${String(url)}`);
  });
  return puts;
}

afterEach(() => vi.restoreAllMocks());

describe("RemoteControlPanel (SPEC-1215 · ADR-0165 §4)", () => {
  it("default mati: toggle capability terkunci sampai master menyala", async () => {
    mockApi(base);
    render(<RemoteControlPanel />);
    const master = await screen.findByRole("switch", { name: "Izinkan kendali jarak jauh" });
    expect(master).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Mulai sesi" })).toHaveAttribute("aria-disabled", "true");
  });

  it("menyalakan master mengirim grant Lihat saja", async () => {
    const puts = mockApi(base);
    render(<RemoteControlPanel />);
    fireEvent.click(await screen.findByRole("switch", { name: "Izinkan kendali jarak jauh" }));
    await waitFor(() => expect(puts).toEqual([
      { control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read"] } },
    ]));
  });

  it("menyalakan Mulai sesi selalu menyertakan Lihat", async () => {
    const puts = mockApi({ ...base, control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read"] } });
    render(<RemoteControlPanel />);
    fireEvent.click(await screen.findByRole("switch", { name: "Mulai sesi" }));
    await waitFor(() => expect(puts.at(-1)).toEqual({
      control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read", "sessions:spawn"] },
    }));
  });

  it("status relay dan audit aksi hub ditampilkan", async () => {
    mockApi({
      ...base,
      control: { enabled: true, capabilities: ["sessions:read"] },
      relay: { state: "open", since: "2026-09-15T01:00:00.000Z", hubOrigin: "https://hub.example", lastClose: null },
      audit: [{
        id: 1, deviceId: "local", deviceName: "mac-mini", lane: "event", seq: "1", ts: "2026-09-15T01:00:00.000Z",
        receivedAt: "2026-09-15T01:00:00.000Z", level: "info", kind: "remote.request", projectId: null, specId: null,
        sessionId: null, msg: "GET /api/terminal/sessions → 200", data: null, hasTranscript: false,
      }],
    });
    render(<RemoteControlPanel />);
    expect(await screen.findByText("tersambung")).toBeInTheDocument();
    expect(screen.getByText("https://hub.example")).toBeInTheDocument();
    expect(screen.getAllByTestId("remote-audit-row")).toHaveLength(1);
  });
});
