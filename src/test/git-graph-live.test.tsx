import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { subKey } from "@hanoman/shared";
import { eventsStub, resetEventsStub, setTopics, emitTopic, lastSubParams } from "./helpers/events-stub";

// SPEC-908 · GitGraph berhenti men-poll HTTP tiap 4 dtk per klien. Satu `git log` dihitung per
// PARAMETER yang benar-benar ditonton dan dibagi semua tab yang melihat project & opsi yang sama.

vi.mock("../src/api/events", () => eventsStub);

const { GitGraph } = await import("../src/screens/GitGraph");
const { api } = await import("../src/api/client");

const commits = [
  { sha: "aaaa111", parents: ["bbbb222"], author: "t", at: "2026-01-02T00:00:00Z", subject: "kedua", refs: ["main"], tags: [] },
  { sha: "bbbb222", parents: [], author: "t", at: "2026-01-01T00:00:00Z", subject: "pertama", refs: [], tags: [] },
];
const STATUS = { branch: "main", ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], clean: true };
const GIT_PARAMS = { projectId: "p1", limit: 200, branch: "", showRemote: true, showTags: true };

const view = () => (
  <GitGraph projectId="p1" onRunGit={vi.fn()} onMerge={vi.fn()} onRebase={vi.fn()}
    onPull={vi.fn()} onDrop={vi.fn()} onOpenFile={vi.fn()} />
);

// Tipe spy di-INFER dari pabriknya; anotasi `ReturnType<typeof vi.spyOn>` polos kehilangan
// signature fungsinya dan ditolak tsc.
const makeSpies = () => ({
  ideGraph: vi.spyOn(api, "ideGraph").mockResolvedValue({ commits, current: "main", total: 2 }),
  ideStatus: vi.spyOn(api, "ideStatus").mockResolvedValue(STATUS),
  ideStashes: vi.spyOn(api, "ideStashes").mockResolvedValue([]),
});
let ideGraph: ReturnType<typeof makeSpies>["ideGraph"];
let ideStatus: ReturnType<typeof makeSpies>["ideStatus"];
let ideStashes: ReturnType<typeof makeSpies>["ideStashes"];

beforeEach(() => {
  vi.restoreAllMocks();
  resetEventsStub();
  ({ ideGraph, ideStatus, ideStashes } = makeSpies());
  vi.spyOn(api, "getConfig").mockResolvedValue({ entries: [] } as never);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); });

describe("SPEC-908 · GitGraph live", () => {
  it("nol poll HTTP saat WS mendukung — tak satu pun panggilan sesudah muat awal", async () => {
    setTopics(["git"]);
    render(view());
    expect(await screen.findByText("kedua")).toBeTruthy();
    // Muat awal sendiri lebih dari satu panggilan: `getConfig` menyemai showRemote/showTags dan
    // menghasilkan objek `gopts` baru, yang memuat ulang sekali. Itu perilaku lama (SPEC-233/351)
    // dan bukan polling — yang diuji di sini jumlahnya BERHENTI bertambah. Cuplikannya karena itu
    // diambil setelah muat awal benar-benar reda, bukan pada baris pertama yang tampil.
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const settled = [ideGraph.mock.calls.length, ideStatus.mock.calls.length, ideStashes.mock.calls.length];
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect([ideGraph.mock.calls.length, ideStatus.mock.calls.length, ideStashes.mock.calls.length])
      .toEqual(settled);
  });

  it("berlangganan dengan opsi graph yang SEDANG aktif", async () => {
    setTopics(["git"]);
    render(view());
    await screen.findByText("kedua");
    expect(lastSubParams("git")).toEqual(GIT_PARAMS);
  });

  it("satu frame menyetel graph + status + stash sekaligus, tanpa berkedip ke loading", async () => {
    setTopics(["git"]);
    render(view());
    await screen.findByText("kedua");
    await act(async () => {
      emitTopic({
        t: "git", key: subKey("git", GIT_PARAMS),
        graph: {
          commits: [{ sha: "cccc333", parents: [], author: "t", at: "2026-01-03T00:00:00Z", subject: "ketiga", refs: ["main"], tags: [] }],
          current: "main", total: 1,
        } as never,
        status: { ...STATUS, clean: false, unstaged: ["a.ts"] } as never,
        stashes: [{ ref: "stash@{0}", message: "wip", at: "2026-01-03T00:00:00Z" }] as never,
      });
    });
    expect(screen.getByText("ketiga")).toBeTruthy();
    expect(screen.queryByText("kedua")).toBeNull();
    expect(screen.getByText(/wip/)).toBeTruthy();
    expect(screen.queryByText(/Memuat/i)).toBeNull();
  });

  it("frame berkunci lain (project/opsi berbeda) tak mendarat", async () => {
    setTopics(["git"]);
    render(view());
    await screen.findByText("kedua");
    await act(async () => {
      emitTopic({
        t: "git", key: subKey("git", { ...GIT_PARAMS, projectId: "p2" }),
        graph: { commits: [{ sha: "dddd444", parents: [], author: "t", at: "2026-01-04T00:00:00Z", subject: "project lain", refs: [], tags: [] }], current: "x", total: 1 } as never,
        status: STATUS as never, stashes: [] as never,
      });
    });
    expect(screen.queryByText("project lain")).toBeNull();
    expect(screen.getByText("kedua")).toBeTruthy();
  });

  it("`Muat 200 lagi` menaikkan limit → langganan pindah ke kunci baru", async () => {
    setTopics(["git"]);
    const many = Array.from({ length: 200 }, (_, i) => ({
      sha: `s${i}`.padEnd(7, "0"), parents: [], author: "t",
      at: "2026-01-01T00:00:00Z", subject: `commit ${i}`, refs: [], tags: [],
    }));
    ideGraph.mockResolvedValue({ commits: many, current: "main", total: 400 });
    render(view());
    await screen.findByText("commit 0");
    expect(lastSubParams("git")).toMatchObject({ limit: 200 });
    await act(async () => { fireEvent.click(screen.getByText(/Muat 200 lagi/)); });
    expect(lastSubParams("git")).toMatchObject({ limit: 400 });
  });
});
