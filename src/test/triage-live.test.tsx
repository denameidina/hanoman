import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subKey } from "@hanoman/shared";
import {
  eventsStub, resetEventsStub, setTopics, emitTopic, setStatus, lastSubParams,
  allSubs,
} from "./helpers/events-stub";

// SPEC-908 · TriageScreen berhenti men-poll HTTP. Scout memastikan TAK SATU pun test lama
// menegakkan kadens poll — menghapus `setInterval` tidak memerahkan apa pun tanpa berkas ini.

const TICKET: any = {
  id: "t1", projectId: "demo", number: 1, category: "bug", title: "Tak bisa login",
  reporterEmail: "r@e.co", status: "new", specId: null, attachmentCount: 0, createdAt: "2026-07-20T00:00:00Z",
};
const PUSHED: any = { ...TICKET, id: "t2", number: 2, title: "Graph kosong" };

const { listTickets } = vi.hoisted(() => ({
  listTickets: vi.fn(async () => ({ items: [TICKET], total: 1, page: 1, pageSize: 20, unreviewed: 1 })),
}));
vi.mock("../src/api/client", () => ({
  api: {
    listTickets, getTicket: vi.fn(), acceptTicket: vi.fn(), rejectTicket: vi.fn(),
    editTicket: vi.fn(), deleteTicket: vi.fn(), unlinkTicket: vi.fn(),
    listGithubIssues: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  },
  ApiError: class extends Error {},
}));
vi.mock("../src/api/events", () => eventsStub);

const { TriageScreen } = await import("../src/screens/TriageScreen");

const projects: any = [{ id: "demo", name: "Demo" }];
const view = () => <TriageScreen projects={projects} onAccepted={() => {}} onToast={() => {}} />;
const page = (items: any[], extra: Record<string, unknown> = {}) => ({
  items, total: items.length, page: 1, pageSize: 20, unreviewed: 1, ...extra,
});

beforeEach(() => {
  resetEventsStub();
  // `mockResolvedValue` di sebuah test bertahan ke test berikutnya — reset implementasinya, bukan
  // sekadar riwayat panggilannya.
  listTickets.mockReset();
  listTickets.mockResolvedValue(page([TICKET]));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); });

describe("SPEC-908 · TriageScreen live", () => {
  it("tidak men-poll HTTP saat WS mendukung topiknya — hanya satu muat awal", async () => {
    setTopics(["tickets"]);
    render(view());
    expect(await screen.findByText("Tak bisa login")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(listTickets).toHaveBeenCalledTimes(1);
  });

  it("frame WS memperbarui daftar TANPA layar berkedip ke loading", async () => {
    setTopics(["tickets"]);
    render(view());
    await screen.findByText("Tak bisa login");
    await act(async () => {
      emitTopic({
        t: "tickets", key: subKey("tickets", { page: 1, limit: 20 }),
        data: page([PUSHED]) as never,
      });
    });
    expect(screen.getByText("Graph kosong")).toBeTruthy();
    expect(screen.queryByText(/Memuat/i)).toBeNull();
  });

  it("berlangganan dengan penyaring yang SEDANG aktif, bukan penyaring kosong", async () => {
    setTopics(["tickets"]);
    localStorage.setItem("hn.ui.v1.triage.status", '"new"');
    localStorage.setItem("hn.ui.v1.triage.project", '"demo"');
    render(view());
    await act(async () => {});
    expect(lastSubParams("tickets")).toMatchObject({ status: "new", project: "demo", limit: 20 });
  });

  it("pindah halaman memindahkan langganannya — bukan menahan halaman 1", async () => {
    setTopics(["tickets"]);
    listTickets.mockResolvedValue(page(Array.from({ length: 20 }, (_, i) => ({ ...TICKET, id: `t${i}`, number: i + 1 })), { total: 60 }));
    render(view());
    await screen.findByRole("button", { name: "Berikutnya" });
    expect(lastSubParams("tickets")).toMatchObject({ page: 1 });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Berikutnya" })); });
    expect(lastSubParams("tickets")).toMatchObject({ page: 2 });
  });

  it("frame untuk halaman LAIN tak mendarat — operator tak dilempar keluar halamannya", async () => {
    setTopics(["tickets"]);
    render(view());
    await screen.findByText("Tak bisa login");
    await act(async () => {
      emitTopic({
        t: "tickets", key: subKey("tickets", { page: 9, limit: 20 }),
        data: page([PUSHED]) as never,
      });
    });
    expect(screen.queryByText("Graph kosong")).toBeNull();
    expect(screen.getByText("Tak bisa login")).toBeTruthy();
  });

  it("mengetik pencarian tak melahirkan satu kunci langganan per huruf", async () => {
    setTopics(["tickets"]);
    render(view());
    await screen.findByText("Tak bisa login");
    const box = screen.getByLabelText("Cari tiket");
    const before = allSubs("tickets").length;
    for (const v of ["t", "te", "ter", "term"]) {
      await act(async () => { fireEvent.change(box, { target: { value: v } }); });
    }
    // Debounce belum jatuh tempo: kuncinya masih yang lama, nol langganan tambahan.
    expect(allSubs("tickets")).toHaveLength(before);
    expect(lastSubParams("tickets")).not.toHaveProperty("q", "term");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(lastSubParams("tickets")).toMatchObject({ q: "term" });
    expect(allSubs("tickets")).toHaveLength(before);   // tetap satu langganan, bukan lima
  });

  it("koneksi putus: data lama tetap terpampang dan indikator muncul sesudah grace", async () => {
    setTopics(["tickets"]);
    render(view());
    await screen.findByText("Tak bisa login");
    await act(async () => { setStatus({ connected: false, since: Date.now(), paused: false }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(screen.getByText("Tak bisa login")).toBeTruthy();
    expect(screen.getByText(/koneksi terputus/i)).toBeTruthy();
  });
});
