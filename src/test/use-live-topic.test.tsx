import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { subKey } from "@hanoman/shared";
import {
  eventsStub, resetEventsStub, setTopics, emitTopic, setStatus, setSilentSince, lastSubParams,
} from "./helpers/events-stub";

vi.mock("../src/api/events", () => eventsStub);

const { useLiveTopic } = await import("../src/api/live");
const { LiveConnectionBadge } = await import("../src/ds/components/live");

const PARAMS = { page: 1, limit: 20 } as const;

function Probe({ onRefetch, page = 1 }: { onRefetch: () => void; page?: number }) {
  const [n, setN] = React.useState(0);
  useLiveTopic({
    topic: "tickets", params: { page, limit: 20 },
    apply: () => setN((x) => x + 1), refetch: onRefetch, pollMs: 5000,
  });
  return <div data-testid="n">{n}</div>;
}

beforeEach(() => { resetEventsStub(); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("SPEC-908 · useLiveTopic", () => {
  it("server MENDUKUNG topiknya → nol setInterval, refetch tak pernah dipanggil", async () => {
    setTopics(["tickets"]);
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refetch).not.toHaveBeenCalled();
  });

  it("frame tiba → apply dipanggil, refetch tetap nol", async () => {
    setTopics(["tickets"]);
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => {
      emitTopic({ t: "tickets", key: subKey("tickets", PARAMS), data: {} as never });
    });
    expect(screen.getByTestId("n").textContent).toBe("1");
    expect(refetch).not.toHaveBeenCalled();
  });

  it("berlangganan dengan parameter yang SEDANG aktif, dan pindah kunci saat berubah", async () => {
    setTopics(["tickets"]);
    const { rerender } = render(<Probe onRefetch={vi.fn()} page={3} />);
    expect(lastSubParams("tickets")).toEqual({ page: 3, limit: 20 });
    rerender(<Probe onRefetch={vi.fn()} page={4} />);
    expect(lastSubParams("tickets")).toEqual({ page: 4, limit: 20 });
  });

  it("server TAK punya topiknya (hello tanpa `tickets`) → fallback poll menyala di pollMs", async () => {
    setTopics(["git"]);
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("`hello` yang tiba SESUDAH mount mematikan fallback yang sempat menyala", async () => {
    setSilentSince(null);   // belum ada `hello` sama sekali — jangan panggil setTopics
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    // Dua jendela terpisah: update state dari timer baru di-flush saat `act` KELUAR, jadi
    // interval fallback-nya belum terpasang selama jendela yang menyalakannya.
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(refetch.mock.calls.length).toBeGreaterThan(0);
    refetch.mockClear();
    await act(async () => { setTopics(["tickets"]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(refetch).not.toHaveBeenCalled();
  });

  it("socket BISU 15 dtk tanpa `hello` → fallback poll menyala (WS terhalang proxy)", async () => {
    setSilentSince(null);   // belum ada `hello` sama sekali — jangan panggil setTopics
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
    expect(refetch).not.toHaveBeenCalled();
    // `blind` menyala di 15 dtk, tetapi interval-nya baru terpasang saat `act` keluar — jadi
    // denyut pertamanya jatuh di jendela BERIKUTNYA, bukan di jendela yang menyalakannya.
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(refetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(refetch).toHaveBeenCalled();
  });

  it("`hello` berdaftar KOSONG tetap jawaban — fallback menyala tanpa menunggu 15 dtk bisu", async () => {
    // Koneksi yang tak boleh berlangganan (bukan principal cookie) menerima `hello` kosong sambil
    // tetap dibanjiri frame grup global — jadi jalur "socket bisu" tak akan pernah menolongnya.
    setTopics([]);
    setSilentSince(Date.now());
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("tab tersembunyi tak pernah memicu refetch fallback", async () => {
    setTopics(["git"]);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refetch).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
});

describe("SPEC-908 · LiveConnectionBadge", () => {
  it("diam saat terhubung", () => {
    setStatus({ connected: true, since: Date.now(), paused: false });
    render(<LiveConnectionBadge />);
    expect(screen.queryByText(/koneksi terputus/i)).toBeNull();
  });

  it("diam saat `paused` — tab tersembunyi ditutup ATAS PERMINTAAN KITA, bukan gangguan", () => {
    setStatus({ connected: false, since: Date.now() - 60_000, paused: true });
    render(<LiveConnectionBadge />);
    expect(screen.queryByText(/koneksi terputus/i)).toBeNull();
  });

  it("diam selama putus belum melewati grace 6 dtk", () => {
    setStatus({ connected: false, since: Date.now() - 2_000, paused: false });
    render(<LiveConnectionBadge />);
    expect(screen.queryByText(/koneksi terputus/i)).toBeNull();
  });

  it("muncul setelah putus melewati grace, tanpa perlu render ulang dari luar", async () => {
    setStatus({ connected: true, since: Date.now(), paused: false });
    render(<LiveConnectionBadge />);
    await act(async () => { setStatus({ connected: false, since: Date.now(), paused: false }); });
    expect(screen.queryByText(/koneksi terputus/i)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(screen.getByText(/koneksi terputus/i)).toBeTruthy();
  });
});
