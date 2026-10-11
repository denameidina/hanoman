import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      const body = JSON.parse(String(init.body)) as
        Partial<{ control: RemoteControlView["control"]; logs: RemoteControlView["logs"] }>;
      puts.push(body);
      current = {
        ...current,
        ...(body.control ? { control: body.control } : {}),
        ...(body.logs ? { logs: body.logs } : {}),
      };
      return json(current);
    }
    if (String(url) === "/api/remote-control") return json(current);
    throw new Error(`unexpected fetch ${String(url)}`);
  });
  return puts;
}

afterEach(() => vi.restoreAllMocks());

// Radio DS menaruh label + deskripsi di nama aksesibelnya, jadi cocokkan awalannya saja.
const tier = (name: RegExp) => screen.findByRole("radio", { name });

describe("RemoteControlPanel · selektor tingkat akses (SPEC-1215 · Fase 3G)", () => {
  it("default mati: selektor tingkat terkunci sampai master menyala", async () => {
    const puts = mockApi(base);
    render(<RemoteControlPanel />);
    const master = await screen.findByRole("switch", { name: "Izinkan kendali jarak jauh" });
    expect(master).toHaveAttribute("aria-checked", "false");
    expect(await tier(/^Lihat/)).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(await tier(/^Kerja/));
    expect(puts).toEqual([]);
  });

  it("menyalakan master mengirim tingkat Lihat (tiga grant baca)", async () => {
    const puts = mockApi(base);
    render(<RemoteControlPanel />);
    fireEvent.click(await screen.findByRole("switch", { name: "Izinkan kendali jarak jauh" }));
    await waitFor(() => expect(puts).toEqual([
      { control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read"] } },
    ]));
  });

  it("tingkat Lihat aktif saat grant hanya baca; Kerja dan Tulis tak tercentang", async () => {
    mockApi({ ...base, control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read"] } });
    render(<RemoteControlPanel />);
    expect(await tier(/^Lihat/)).toHaveAttribute("aria-checked", "true");
    expect(await tier(/^Kerja/)).toHaveAttribute("aria-checked", "false");
    expect(await tier(/^Tulis/)).toHaveAttribute("aria-checked", "false");
  });

  // Naik ke tingkat berisiko selalu menyalakan Lihat dulu (termasuk dalam daftar grant), dan dikonfirmasi.
  it("naik ke Kerja meminta konfirmasi, lalu menyimpan grant Lihat + kerja", async () => {
    const puts = mockApi({ ...base, control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read"] } });
    render(<RemoteControlPanel />);
    fireEvent.click(await tier(/^Kerja/));
    expect(puts).toEqual([]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Server pusat boleh membuka sesi agen baru/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Izinkan Kerja" }));
    await waitFor(() => expect(puts.at(-1)).toEqual({
      control: {
        enabled: true,
        capabilities: ["sessions:read", "backlog:read", "ide:read", "backlog:write", "sessions:spawn"],
      },
    }));
  });

  it("membatalkan naik ke Tulis tidak menyimpan apa pun", async () => {
    const puts = mockApi({ ...base, control: { enabled: true, capabilities: ["sessions:read", "backlog:read", "ide:read"] } });
    render(<RemoteControlPanel />);
    fireEvent.click(await tier(/^Tulis/));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Server pusat boleh mengetik ke terminal/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts).toEqual([]);
  });

  // Menurunkan tingkat juga lewat dialog, dan dialognya menyebut grant yang dicabut.
  it("turun dari Tulis ke Kerja menampilkan efek yang dicabut sebelum menyimpan", async () => {
    const puts = mockApi({ ...base, control: { enabled: true, capabilities: [
      "sessions:read", "backlog:read", "ide:read", "backlog:write", "sessions:spawn", "sessions:write"] } });
    render(<RemoteControlPanel />);
    fireEvent.click(await tier(/^Kerja/));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Dicabut: Tulis ke terminal.")).toBeInTheDocument();
    expect(puts).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Turunkan ke Kerja" }));
    await waitFor(() => expect(puts.at(-1)).toEqual({
      control: {
        enabled: true,
        capabilities: ["sessions:read", "backlog:read", "ide:read", "backlog:write", "sessions:spawn"],
      },
    }));
  });

  // Kombinasi grant yang tak sama dengan tingkat mana pun tampil sebagai Khusus dengan rincian yang dilipat.
  it("kombinasi di luar tingkat tampil sebagai Khusus dengan rincian lipat", async () => {
    mockApi({ ...base, control: { enabled: true, capabilities: ["sessions:read", "sessions:write"] } });
    render(<RemoteControlPanel />);
    expect(await tier(/^Khusus/)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Rincian izin khusus")).toBeInTheDocument();
    expect(screen.getByText("Lihat sesi, Tulis ke terminal")).toBeInTheDocument();
  });

  it("status relay dan riwayat perintah tampil ringkas; detail ada di balik lipatan", async () => {
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
    expect(screen.getByText("1 perintah tercatat", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByTestId("remote-audit-row")).toHaveLength(1);
  });
});

// SPEC-1217 · AC-D1 UI · tiga lajur log ke hub, terpisah dari grant kendali jarak jauh.
describe("RemoteControlPanel lajur log (SPEC-1217 AC-D1)", () => {
  it("lajur event ditampilkan menyala secara default", async () => {
    mockApi(base);
    render(<RemoteControlPanel />);
    expect(await screen.findByRole("switch", { name: /kejadian/i })).toHaveAttribute("aria-checked", "true");
  });

  it("mengetuk toggle server memanggil putRemoteControl dengan logs.server berubah", async () => {
    const puts = mockApi(base);
    render(<RemoteControlPanel />);
    fireEvent.click(await screen.findByRole("switch", { name: /^log server$/i }));
    await waitFor(() => expect(puts).toEqual([
      expect.objectContaining({ logs: expect.objectContaining({ server: expect.any(Boolean) }) }),
    ]));
  });
});
