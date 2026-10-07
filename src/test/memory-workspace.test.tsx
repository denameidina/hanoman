import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subKey } from "@hanoman/shared";
import { eventsStub, resetEventsStub, setTopics, emitTopic, lastSubParams } from "./helpers/events-stub";

vi.mock("../src/api/events", () => eventsStub);
const { MemoryWorkspace } = await import("../src/screens/memory/MemoryWorkspace");

const at = "2026-10-01T10:00:00.000Z";
const local = (o: Record<string, unknown> = {}) => ({ verdict: null, lastUsedAt: null, lastVerifiedAt: null, needsConfirm: false, ...o });
const mem = (id: string, o: Record<string, unknown> = {}) => ({
  id, projectId: "p1", kind: "fact", content: `isi ${id}`, scopePaths: [], anchors: [], status: "active",
  supersedesId: null, reviewReason: null, trusted: true,
  source: { runtime: "claude", sessionId: "spec-12", tokenId: null, deviceId: "local", commitSha: "abcdef1234567" },
  createdAt: at, updatedAt: at, local: local(), ...o,
});
const proposed = mem("m1", { status: "proposed", kind: "decision", content: "Pakai SQLite, bukan Postgres", reviewReason: "decision" });
const activeA = mem("m2", { content: "Test server wajib no-file-parallelism", anchors: [{ path: "CLAUDE.md", blobSha: "a".repeat(40) }], local: local({ verdict: "stale" }) });
const activeB = mem("m3", { content: "Fakta lama", local: local({ verdict: "valid", needsConfirm: true }) });
const archived = mem("m4", { status: "invalidated", content: "Sudah salah" });
const projects = [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }];
const json = (v: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v } as Response);
const calls: { url: string; method: string; body?: string }[] = [];

function mockFetch(over: { proposed?: unknown[]; active?: unknown[] } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const u = String(url); const method = init?.method ?? "GET";
    calls.push({ url: u, method, body: init?.body as string | undefined });
    if (method === "GET" && u.includes("/api/memories?")) {
      const status = new URL(u, "http://x").searchParams.get("status");
      if (status === "proposed") return json({ items: over.proposed ?? [proposed], total: 1 });
      if (status === "active") return json({ items: over.active ?? [activeA, activeB], total: 2 });
      if (status === "invalidated") return json({ items: [archived], total: 1 });
      return json({ items: [], total: 0 });
    }
    if (method === "GET" && u.includes("/api/memories/m2?")) {
      return json({ memory: activeA, events: [{ id: "e1", op: "propose", actorKind: "session", actorId: "spec-12", reason: null, createdAt: at },
        { id: "e2", op: "activate", actorKind: "system", actorId: null, reason: "auto: jangkar terverifikasi", createdAt: at }] });
    }
    return json({ memory: proposed });
  });
}
const renderWs = (over: Partial<React.ComponentProps<typeof MemoryWorkspace>> = {}) =>
  render(<MemoryWorkspace projects={projects} projectId="p1" onSelectProject={() => {}} onToast={() => {}} {...over} />);

beforeEach(() => { resetEventsStub(); calls.length = 0; });
afterEach(() => vi.restoreAllMocks());

describe("MemoryWorkspace", () => {
  it("tanpa project → keadaan kosong", () => {
    mockFetch();
    renderWs({ projectId: undefined });
    expect(screen.getByText(/Belum ada project/)).toBeInTheDocument();
  });

  it("default ke tab review bila ada usulan; menampilkan kind, alasan review, sumber", async () => {
    mockFetch();
    renderWs();
    expect(await screen.findByText("Pakai SQLite, bukan Postgres")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Perlu review/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("keputusan")).toBeInTheDocument();
    expect(screen.getByText(/claude · sesi spec-12 · abcdef1/)).toBeInTheDocument();
  });

  it("tanpa usulan → tab Aktif; verdict lokal & perlu dikonfirmasi tampil", async () => {
    mockFetch({ proposed: [] });
    renderWs();
    expect(await screen.findByText("Test server wajib no-file-parallelism")).toBeInTheDocument();
    expect(screen.getByText("usang di mesin ini")).toBeInTheDocument();
    expect(screen.getByText("perlu dikonfirmasi")).toBeInTheDocument();
    expect(screen.getByText(/CLAUDE\.md/)).toBeInTheDocument();
  });

  it("Setujui → POST activate dengan projectId", async () => {
    mockFetch();
    renderWs();
    fireEvent.click(await screen.findByRole("button", { name: "Setujui" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/api/memories/m1/activate?projectId=p1"))).toBe(true));
  });

  it("Tolak meminta alasan (wajib) lalu POST reject", async () => {
    mockFetch();
    renderWs();
    fireEvent.click(await screen.findByRole("button", { name: "Tolak…" }));
    const dlg = await screen.findByRole("dialog");
    const send = within(dlg).getByRole("button", { name: "Tolak memori" });
    expect(send).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Alasan"), { target: { value: "tak relevan" } });
    fireEvent.click(send);
    await waitFor(() => {
      const c = calls.find((x) => x.url.includes("/api/memories/m1/reject?projectId=p1"));
      expect(c && JSON.parse(c.body!)).toEqual({ reason: "tak relevan" });
    });
  });

  it("Batalkan memori aktif → POST invalidate {reason, projectId}", async () => {
    mockFetch({ proposed: [] });
    renderWs();
    await screen.findByText("Test server wajib no-file-parallelism");
    fireEvent.click(screen.getAllByRole("button", { name: "Batalkan…" })[0]!);
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Alasan"), { target: { value: "sudah berubah" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Batalkan memori" }));
    await waitFor(() => {
      const c = calls.find((x) => x.url.endsWith("/api/memories/m2/invalidate"));
      expect(c && JSON.parse(c.body!)).toEqual({ reason: "sudah berubah", projectId: "p1" });
    });
  });

  it("Hapus permanen meminta konfirmasi lalu DELETE", async () => {
    mockFetch({ proposed: [] });
    renderWs();
    await screen.findByText("Test server wajib no-file-parallelism");
    fireEvent.click(screen.getAllByRole("button", { name: "Hapus permanen…" })[0]!);
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Hapus permanen" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/api/memories/m2?projectId=p1"))).toBe(true));
  });

  it("Riwayat memuat event memori", async () => {
    mockFetch({ proposed: [] });
    renderWs();
    await screen.findByText("Test server wajib no-file-parallelism");
    fireEvent.click(screen.getAllByRole("button", { name: "Riwayat" })[0]!);
    expect(await screen.findByText(/auto: jangkar terverifikasi/)).toBeInTheDocument();
  });

  it("peringatan pengganti ganda saat dua memori aktif menggantikan memori yang sama", async () => {
    mockFetch({ proposed: [], active: [mem("a1", { supersedesId: "old" }), mem("a2", { supersedesId: "old" })] });
    renderWs();
    expect(await screen.findByText(/menggantikan memori yang sama/)).toBeInTheDocument();
  });

  it("pencarian meneruskan q; arsip memuat invalidated & rejected", async () => {
    mockFetch({ proposed: [] });
    renderWs();
    await screen.findByText("Test server wajib no-file-parallelism");
    fireEvent.change(screen.getByLabelText("Cari"), { target: { value: "migration" } });
    await waitFor(() => expect(calls.some((c) => c.url.includes("q=migration"))).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: /Arsip/ }));
    expect(await screen.findByText("Sudah salah")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("status=rejected"))).toBe(true);
  });

  it("berlangganan topik memory per project dan memuat ulang saat revision berubah", async () => {
    setTopics(["memory"]);
    mockFetch();
    renderWs();
    await screen.findByText("Pakai SQLite, bukan Postgres");
    expect(lastSubParams("memory")).toEqual({ projectId: "p1" });
    const key = subKey("memory", { projectId: "p1" });
    // Frame pertama = garis dasar (daftar baru saja ditarik lewat HTTP); frame berikutnya yang berbeda memicu muat ulang.
    emitTopic({ t: "memory", key, revision: "4:a" } as never);
    const before = calls.filter((c) => c.method === "GET").length;
    emitTopic({ t: "memory", key, revision: "5:x" } as never);
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(before));
  });
});
