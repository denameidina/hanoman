import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Spec } from "@hanoman/shared";
import { TerminalScreen, PhaseStrip } from "../src/screens/TerminalScreen";
import { mockViewport, resetViewport } from "./viewport";

// TerminalPane membuka WebSocket + xterm (butuh canvas). jsdom tak punya keduanya; yang
// diuji di sini adalah komposisi grid, bukan rendering terminalnya.
// SPEC-402 · tombol `exit …` memancarkan frame exit pty apa adanya (dengan kode keluarnya) —
// jalur yang dipakai saat operator sedang menonton pane yang panenya mati.
// SPEC-433 · tombol `phases …` memancarkan frame phase pty apa adanya (daftar fase + verdict
// `complete`) — satu-satunya jalan Terminal tahu pekerjaannya tuntas, karena TUI agen tak pernah
// keluar sendiri sesudah fase terakhir dan `exited` selamanya false di jalur sukses.
const ph = vi.hoisted(() => ({
  next: { phases: [] as { name: string; state: string }[], complete: false },
}));
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId, onExit, onPhases }: {
    sessionId: string; onExit?: (c: number) => void;
    onPhases?: (p: { name: string; state: string }[], complete: boolean) => void;
  }) => (
    <div data-testid="pane">
      {sessionId}
      <button aria-label={`exit ${sessionId}`} onClick={() => onExit?.(143)} />
      <button aria-label={`phases ${sessionId}`}
        onClick={() => onPhases?.(ph.next.phases, ph.next.complete)} />
    </div>
  ),
}));
const listTerminals = vi.fn();
const createTerminal = vi.fn();
const createShell = vi.fn();
const deleteTerminal = vi.fn();
const startSession = vi.fn();
const listSpecs = vi.fn();   // SPEC-198 · picker startable via API
// SPEC-517 · "Sesi baru" membuka form runtime yang membaca setelan global + versi codex CLI.
const getSettings = vi.fn();
const getCodexVersion = vi.fn();
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } },
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    createShell: (...a: unknown[]) => createShell(...a),
    deleteTerminal: (...a: unknown[]) => deleteTerminal(...a),
    listBranches: vi.fn(async () => ({ branches: [], remotes: [] })),
    startSession: (...a: unknown[]) => startSession(...a),
    listSpecs: (...a: unknown[]) => listSpecs(...a),
    getSettings: (...a: unknown[]) => getSettings(...a),
    getCodexVersion: (...a: unknown[]) => getCodexVersion(...a),
  },
}));
// SPEC-199 · daftar sesi kini didorong lewat WS siar; tangkap handler subscribe untuk mempush frame.
const ev = vi.hoisted(() => ({ handler: undefined as ((m: unknown) => void) | undefined }));
vi.mock("../src/api/events", () => ({
  subscribe: (fn: (m: unknown) => void) => { ev.handler = fn; return () => { ev.handler = undefined; }; },
}));

const projects = [{ id: "p1", name: "hanoman" }];
const LKEY = "hanoman.terminal.layout";
const WKEY = "hanoman.terminal.workspace";

// SPEC-408 · ADR-0090 · `createdAt`/`startedAt` bagian dari kontrak Spec; nilainya tak relevan
// untuk layar Terminal, tapi literalnya harus lengkap supaya tipe tetap menjaga bentuk wire.
// SPEC-447 · ADR-0093 · idem `dependsOn`/`blockedBy` — server selalu mengirim keduanya (dinormalkan
// `liveSpecs`), jadi fixture yang menghilangkannya tak lagi mencerminkan wire.
// SPEC-546 · ADR-0109 · idem `sourceHistory` (item yang belum pernah dikonversi = daftar kosong).
const backlog: Spec[] = [
  { id: "SPEC-100", projectId: "p1", title: "Fitur A", source: "brief", stage: "brainstorming",
    priority: "tinggi", author: "human", objective: "obj A", payload: null, branchFrom: null, baseSha: null,
    createdAt: "2026-07-01T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [], autoMerge: null,
    sourceHistory: [] },
  { id: "SPEC-101", projectId: "p1", title: "Bug B", source: "qa", stage: "planned",
    priority: "sedang", author: "human", objective: "obj B", payload: null, branchFrom: null, baseSha: null,
    createdAt: "2026-07-02T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [], autoMerge: null,
    sourceHistory: [] },
  { id: "SPEC-102", projectId: "p1", title: "Selesai C", source: "brief", stage: "done",
    priority: "rendah", author: "human", objective: "obj C", payload: null, branchFrom: null, baseSha: null,
    createdAt: "2026-07-03T00:00:00.000Z", startedAt: "2026-07-04T00:00:00.000Z", dependsOn: [], blockedBy: [], autoMerge: null,
    sourceHistory: [] },
];

beforeEach(() => {
  localStorage.clear();
  listTerminals.mockReset(); createTerminal.mockReset(); createShell.mockReset(); deleteTerminal.mockReset();
  startSession.mockReset(); listSpecs.mockReset();
  deleteTerminal.mockResolvedValue(undefined);
  // SPEC-517 · form "Sesi baru": default global + versi codex. Keduanya gagal-diam di modal,
  // tapi mock-nya tetap dipasang supaya test tak bergantung pada jalur galat.
  getSettings.mockReset(); getCodexVersion.mockReset();
  getSettings.mockResolvedValue({ model: "claude-opus-5", effort: "xhigh", agent: "claude",
    codex: { model: "gpt-5.6-sol", effort: "xhigh" } });
  getCodexVersion.mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true });
});
afterEach(resetViewport);

describe("TerminalScreen (grid)", () => {
  it("keeps every terminal mounted while the mobile panel selector changes presentation only", async () => {
    mockViewport(390);
    localStorage.setItem(WKEY, JSON.stringify({ active: "g1", groups: [
      { id: "g1", name: "Utama", layout: { rows: 1, cols: 2, cells: ["aaaa1111", "bbbb2222"] } },
    ] }));
    const before = localStorage.getItem(WKEY);
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tablist", { name: "Panel terminal" });
    expect(screen.getAllByTestId("pane")).toHaveLength(2);
    expect(document.querySelector('[data-terminal-cell-index="0"]')).toHaveAttribute("aria-hidden", "false");
    fireEvent.click(screen.getByRole("tab", { name: /Panel 2/ }));
    expect(document.querySelector('[data-terminal-cell-index="1"]')).toHaveAttribute("aria-hidden", "false");
    expect(JSON.parse(localStorage.getItem(WKEY)!)).toEqual(JSON.parse(before!));
    expect(screen.getByRole("button", { name: "Hapus kolom aktif" })).toBeInTheDocument();
  });
  it("reveals the requested session cell on mobile without changing the persisted grid", async () => {
    mockViewport(390);
    localStorage.setItem(WKEY, JSON.stringify({ active: "g1", groups: [
      { id: "g1", name: "Utama", layout: { rows: 1, cols: 2, cells: ["aaaa1111", "bbbb2222"] } },
    ] }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} focusSession="bbbb2222" />);
    await screen.findByRole("tablist", { name: "Panel terminal" });
    await waitFor(() => expect(document.querySelector('[data-terminal-cell-index="1"]')).toHaveAttribute("aria-hidden", "false"));
    expect(document.querySelector('[data-terminal-cell-index="0"]')).toHaveAttribute("aria-hidden", "true");
  });
  it("empty state saat tak ada sesi & layout default kosong", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    expect(await screen.findByText("Belum ada sesi terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("pane")).toBeNull();
  });

  it("tombol 'Terminal biasa' membuka shell non-claude untuk project terpilih (SPEC-236)", async () => {
    listTerminals.mockResolvedValue([]);
    createShell.mockResolvedValue({ id: "shell-abc123" });
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByText("Terminal biasa"));
    await waitFor(() => expect(createShell).toHaveBeenCalledWith("p1"));
  });

  it("me-mount satu pane per sel terisi — beberapa sekaligus", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: ["aaaa1111", "bbbb2222"] }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getAllByTestId("pane")).toHaveLength(2));
    expect(screen.getByText("aaaa1111")).toBeInTheDocument();
    expect(screen.getByText("bbbb2222")).toBeInTheDocument();
  });

  it("rekonsiliasi: sel yang sesinya sudah lenyap tak me-mount pane", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: ["aaaa1111", "dead0000"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getAllByTestId("pane")).toHaveLength(1));
  });

  // SPEC-517 · "Sesi baru" membuka form runtime dulu; sesinya lahir saat "Buka sesi" ditekan.
  it("Sesi baru menaruh sesi di sel kosong pertama", async () => {
    listTerminals.mockResolvedValue([]);
    createTerminal.mockResolvedValue({ id: "newsesi1" });
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    fireEvent.click(await screen.findByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("newsesi1"));
  });

  it("menempatkan sesi bebas dari tray ke sel kosong pertama", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    const chip = await screen.findByTitle("Taruh di sel kosong pertama grup ini"); // chip tray
    expect(chip).toHaveClass("hn-terminal-unplaced-action");
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("picker sel kosong menempatkan sesi bebas", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: [null, null] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    const picker = (await screen.findAllByLabelText("Pilih sesi untuk sel"))[0]!;
    fireEvent.change(picker, { target: { value: "aaaa1111" } });
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("Lepas mengosongkan sel tanpa mematikan sesi", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByText("lepas"));
    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(deleteTerminal).not.toHaveBeenCalled();
    // sesi masih ada → muncul kembali sebagai chip tray
    expect(screen.getByTitle("Taruh di sel kosong pertama grup ini")).toBeInTheDocument();
  });

  it("Tutup (×) memanggil deleteTerminal", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Tutup sesi aaaa1111"));
    await waitFor(() => expect(deleteTerminal).toHaveBeenCalledWith("aaaa1111"));
  });

  it("sesi yang exited menampilkan badge Selesai + badan meredup (bukan suffix berakhir)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["done1111"] }));
    listTerminals.mockResolvedValue([{ id: "done1111", projectId: "p1", cwd: "/repo", exited: true }]);
    const { container } = render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.getByTestId("illustration-PST-005")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText(/berakhir/)).toBeNull();
    expect(container.querySelector("[style*='opacity: 0.6']")).not.toBeNull();
  });

  it("sesi yang masih hidup tak menampilkan badge Selesai", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["live1111"] }));
    listTerminals.mockResolvedValue([{ id: "live1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByTestId("illustration-PST-003")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  // SPEC-402 · pane mati berkode ≠ 0 = agen dihentikan di tengah kerja (mis. di-SIGTERM oleh
  // `pkill -f` sesi tetangga → status 143). Melabelinya "Selesai" hijau adalah kebohongan yang
  // justru menjadi keluhan: operator percaya pekerjaan tuntas padahal terputus.
  it("sesi yang mati dengan kode ≠ 0 menampilkan Gagal, bukan Selesai", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["fail1111"] }));
    listTerminals.mockResolvedValue([
      { id: "fail1111", projectId: "p1", cwd: "/repo", exited: true, exitCode: 143 }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText(/Gagal/)).toBeInTheDocument();
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  it("kode keluarnya ikut terbaca di pill Gagal", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["fail2222"] }));
    listTerminals.mockResolvedValue([
      { id: "fail2222", projectId: "p1", cwd: "/repo", exited: true, exitCode: 143 }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText(/Gagal · exit 143/)).toBeInTheDocument();
  });

  // Frame exit pty sudah membawa kode keluarnya; sebelum SPEC-402 `markExited` membuangnya, jadi
  // sesi yang mati DI DEPAN MATA operator pun berubah jadi "Selesai" hijau.
  it("frame exit ≠ 0 dari pane hidup langsung menjadi Gagal", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["kill1111"] }));
    listTerminals.mockResolvedValue([{ id: "kill1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("exit kill1111"));
    expect(await screen.findByText(/Gagal · exit 143/)).toBeInTheDocument();
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  it("kode keluar 0 tetap Selesai", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["done3333"] }));
    listTerminals.mockResolvedValue([
      { id: "done3333", projectId: "p1", cwd: "/repo", exited: true, exitCode: 0 }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.queryByText(/Gagal/)).toBeNull();
  });

  it("sesi menunggu keputusan menampilkan pill Menunggu keputusan (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["dec11111"] }));
    listTerminals.mockResolvedValue([{ id: "dec11111", projectId: "p1", cwd: "/repo", exited: false, decision: true }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Menunggu keputusan")).toBeInTheDocument();
    expect(screen.getByTestId("illustration-PST-004")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  it("exited menang atas decision: pill Selesai, bukan Menunggu (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["done2222"] }));
    listTerminals.mockResolvedValue([{ id: "done2222", projectId: "p1", cwd: "/repo", exited: true, decision: true }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
  });

  it("sesi bekerja (tanpa decision/exited) tak ada pill (SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["run33333"] }));
    listTerminals.mockResolvedValue([{ id: "run33333", projectId: "p1", cwd: "/repo", exited: false, decision: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  // SPEC-433 · keluhan: "status selesai di terminal tidak pernah terjadi". Benar — pil hijau
  // digerbangi `exited` (⇐ #{pane_dead}) sementara agen adalah TUI interaktif yang kembali ke
  // prompt-nya sesudah fase terakhir. Terukur: spec-431/432 berkas fasenya lengkap, commit-nya
  // mendarat, Spec.stage=done di DB, tapi pane `dead=0` → sel Terminal tak berpil sama sekali.
  const QA_DONE = [
    { name: "Audit", state: "done" }, { name: "Spec", state: "skipped" },
    { name: "Plan", state: "skipped" }, { name: "Execute", state: "done" },
  ];
  const emitPhases = (id: string, phases: typeof QA_DONE, complete: boolean) => {
    ph.next = { phases, complete };
    fireEvent.click(screen.getByLabelText(`phases ${id}`));
  };

  it("sesi HIDUP yang seluruh fasenya tuntas menampilkan Selesai (SPEC-433)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["fin11111"] }));
    listTerminals.mockResolvedValue([{ id: "fin11111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.queryByText("Selesai")).toBeNull();   // sebelum frame: belum tahu apa-apa

    emitPhases("fin11111", QA_DONE, true);
    expect(await screen.findByText("Selesai")).toBeInTheDocument();
  });

  // Badan pane TIDAK diredupkan: prosesnya masih hidup dan operator masih bisa mengetik di sana.
  // Peredupan tetap milik `exited` (SPEC-188).
  it("sesi hidup yang complete tak ikut meredup", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["fin22222"] }));
    listTerminals.mockResolvedValue([{ id: "fin22222", projectId: "p1", cwd: "/repo", exited: false }]);
    const { container } = render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    emitPhases("fin22222", QA_DONE, true);
    await screen.findByText("Selesai");
    expect(container.querySelector("[style*='opacity: 0.6']")).toBeNull();
  });

  // Gerbang ADR-0029 datang dari server lewat `complete`; klien tak boleh menyimpulkan sendiri
  // dari daftar fase — plan yang masih `- [ ]` berarti Execute belum tuntas.
  it("fase tuntas tapi complete=false (plan masih - [ ]) tetap tanpa pil Selesai", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["fin33333"] }));
    listTerminals.mockResolvedValue([{ id: "fin33333", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    emitPhases("fin33333", QA_DONE, false);
    await waitFor(() => expect(screen.getByText("Execute")).toBeInTheDocument());  // strip fase terpasang
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  // Marker keputusan codex MENYALA saat sesi selesai wajar (tak ada event Notification →
  // dipasang di Stop+UserPromptSubmit, ADR-0074). Membiarkan `awaiting` menang berarti mengulang
  // bug yang sedang diperbaiki, khusus untuk separuh agen.
  it("complete menang atas Menunggu keputusan (SPEC-433 vs SPEC-196)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["fin44444"] }));
    listTerminals.mockResolvedValue([
      { id: "fin44444", projectId: "p1", cwd: "/repo", exited: false, decision: true }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByText("Menunggu keputusan")).toBeInTheDocument();

    emitPhases("fin44444", QA_DONE, true);
    expect(await screen.findByText("Selesai")).toBeInTheDocument();
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
  });

  // SPEC-402 tetap menang: agen bisa di-SIGTERM SESUDAH menulis baris fase terakhir.
  it("pane mati berkode ≠ 0 tetap Gagal meski fasenya tuntas", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["fin55555"] }));
    listTerminals.mockResolvedValue([
      { id: "fin55555", projectId: "p1", cwd: "/repo", exited: true, exitCode: 143 }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    emitPhases("fin55555", QA_DONE, true);
    expect(await screen.findByText(/Gagal · exit 143/)).toBeInTheDocument();
    expect(screen.queryByText("Selesai")).toBeNull();
  });

  it("frame WS sessions menyegarkan state decision live (SPEC-196/199)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["poll1111"] }));
    listTerminals.mockResolvedValue([{ id: "poll1111", projectId: "p1", cwd: "/repo", exited: false, decision: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.queryByText("Menunggu keputusan")).toBeNull();
    // Push frame sessions dengan decision:true — persis yang server siarkan.
    await act(async () => {
      ev.handler?.({ t: "sessions", sessions: [{ id: "poll1111", projectId: "p1", cwd: "/repo", exited: false, decision: true }] });
    });
    expect(screen.getByText("Menunggu keputusan")).toBeInTheDocument();
  });
});

describe("TerminalScreen (Ambil backlog)", () => {
  it("membuka modal berisi spec yang bisa diambil — bukan yang done", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    expect(await screen.findByText("Fitur A")).toBeInTheDocument();
    expect(screen.getByText("Bug B")).toBeInTheDocument();
    expect(screen.queryByText("Selesai C")).toBeNull();       // done tak ditawarkan
  });

  it("spec yang sudah punya sesi hidup tak ditawarkan lagi", async () => {
    listTerminals.mockResolvedValue([
      { id: "spec-100", projectId: "p1", specId: "SPEC-100", flow: "feature", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ambil backlog" }));
    expect(await screen.findByText("Bug B")).toBeInTheDocument();
    expect(screen.queryByText("Fitur A")).toBeNull();          // sudah aktif
  });

  // SPEC-198 · filter picker kini via API (startable). Test memverifikasi PARAM yang dikirim.
  it("cari mengirim q ke API (startable, debounced)", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.change(await screen.findByLabelText("Cari backlog"), { target: { value: "bug" } });
    await waitFor(() => expect(listSpecs.mock.calls.at(-1)?.[0]).toMatchObject({ startable: true, q: "bug" }));
  });

  it("filter stage mengirim stage ke API (startable)", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.change(await screen.findByLabelText("Filter stage"), { target: { value: "planned" } });
    await waitFor(() => expect(listSpecs.mock.calls.at(-1)?.[0]).toMatchObject({ startable: true, stage: "planned" }));
  });

  it("filter prioritas mengirim priority ke API (startable)", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.change(await screen.findByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    await waitFor(() => expect(listSpecs.mock.calls.at(-1)?.[0]).toMatchObject({ startable: true, priority: "tinggi" }));
  });

  it("memilih spec memanggil startSession (flow qa) & menaruh sesinya di grid", async () => {
    listTerminals.mockResolvedValue([]);
    startSession.mockResolvedValue({ id: "spec101sess" });
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.click(await screen.findByText("Bug B"));         // SPEC-101, source qa
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("spec101sess"));
    expect(startSession).toHaveBeenCalledWith({ spec: "SPEC-101", flow: "qa" });
  });

  it("brief memakai flow feature", async () => {
    listTerminals.mockResolvedValue([]);
    startSession.mockResolvedValue({ id: "sfeat" });
    render(<TerminalScreen projects={projects} backlog={backlog} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Ambil backlog" }));
    fireEvent.click(await screen.findByText("Fitur A"));       // SPEC-100, source brief
    await waitFor(() => expect(startSession).toHaveBeenCalledWith({ spec: "SPEC-100", flow: "feature" }));
  });
});

describe("TerminalScreen (grup)", () => {
  it("tabbar menampilkan grup 'Utama' hasil migrasi layout lama", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    const tab = await screen.findByRole("tab", { name: "Utama" });
    expect(tab).toHaveClass("hn-terminal-group-control");
    expect(tab).toHaveAttribute("tabindex", "0");
    expect(localStorage.getItem(LKEY)).toBeNull();
  });

  it("× grup nonaktif saat hanya ada satu grup", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Utama" });
    expect(screen.getByLabelText("Hapus grup Utama")).toBeDisabled();
  });

  it("pindah tab mengganti grid: pane grup lain tak dirender", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    // taruh sesi di grup "Utama"
    fireEvent.click(await screen.findByTitle("Taruh di sel kosong pertama grup ini"));
    await waitFor(() => expect(screen.getByTestId("pane")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Grup baru" }));
    const tab2 = await screen.findByRole("tab", { name: "Grup 2" });
    expect(tab2).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("pane")).toBeNull();        // grid grup 2 kosong

    fireEvent.click(screen.getByRole("tab", { name: "Utama" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));
  });

  it("menghapus grup melepas sesinya ke tray tanpa mematikannya", async () => {
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByTitle("Taruh di sel kosong pertama grup ini"));
    await waitFor(() => expect(screen.getByTestId("pane")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Grup baru" }));   // grup 2 aktif
    await screen.findByRole("tab", { name: "Grup 2" });
    fireEvent.click(screen.getByRole("tab", { name: "Utama" }));          // kembali ke Utama
    fireEvent.click(screen.getByLabelText("Hapus grup Utama"));

    await waitFor(() => expect(screen.getByTitle("Taruh di sel kosong pertama grup ini")).toBeInTheDocument());
    expect(screen.queryByTestId("pane")).toBeNull();
    expect(deleteTerminal).not.toHaveBeenCalled();
  });

  it("rename grup: Enter menyimpan, Escape membatalkan", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Utama" });

    fireEvent.click(screen.getByLabelText("Ganti nama grup Utama"));
    const input = screen.getByLabelText("Nama grup");
    fireEvent.change(input, { target: { value: "Backlog" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("tab", { name: "Backlog" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Ganti nama grup Backlog"));
    const again = screen.getByLabelText("Nama grup");
    fireEvent.change(again, { target: { value: "dibuang" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(await screen.findByRole("tab", { name: "Backlog" })).toBeInTheDocument();
  });

  it("workspace tersimpan dipulihkan apa adanya (dua grup)", async () => {
    localStorage.setItem(WKEY, JSON.stringify({
      active: "g2",
      groups: [
        { id: "g1", name: "Backlog", layout: { rows: 1, cols: 1, cells: ["aaaa1111"] } },
        { id: "g2", name: "Debug", layout: { rows: 1, cols: 1, cells: ["bbbb2222"] } },
      ],
    }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false },
      { id: "bbbb2222", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("bbbb2222"));
    expect(screen.getByRole("tab", { name: "Debug" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("aaaa1111")).toBeNull();   // grup lain tak dirender, juga tak di tray
  });
});

describe("TerminalScreen (tutup kolom/baris)", () => {
  it("menutup kolom melepas sesinya ke tray tanpa mematikannya", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: [null, "aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));

    fireEvent.click(screen.getByLabelText("Tutup kolom 2"));

    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(screen.getByTitle("Taruh di sel kosong pertama grup ini")).toBeInTheDocument();  // ada di tray
    expect(deleteTerminal).not.toHaveBeenCalled();                               // sesi tetap hidup
  });

  it("menutup baris melepas sesinya ke tray tanpa mematikannya", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 2, cols: 1, cells: [null, "aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"));

    fireEvent.click(screen.getByLabelText("Tutup baris 2"));

    await waitFor(() => expect(screen.queryByTestId("pane")).toBeNull());
    expect(screen.getByTitle("Taruh di sel kosong pertama grup ini")).toBeInTheDocument();
    expect(deleteTerminal).not.toHaveBeenCalled();
  });

  it("× kolom & baris nonaktif pada grid 1×1 (tak boleh menyusut ke nol)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    expect(screen.getByLabelText("Tutup kolom 1")).toBeDisabled();
    expect(screen.getByLabelText("Tutup baris 1")).toBeDisabled();
  });

  it("menutup kolom hanya mengubah grid grup aktif", async () => {
    localStorage.setItem(WKEY, JSON.stringify({
      active: "g2",
      groups: [
        { id: "g1", name: "Backlog", layout: { rows: 1, cols: 2, cells: [null, null] } },
        { id: "g2", name: "Debug", layout: { rows: 1, cols: 2, cells: [null, null] } },
      ],
    }));
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("tab", { name: "Debug" });

    fireEvent.click(screen.getByLabelText("Tutup kolom 2"));
    await waitFor(() => expect(screen.queryByLabelText("Tutup kolom 2")).toBeNull());

    fireEvent.click(screen.getByRole("tab", { name: "Backlog" }));
    expect(await screen.findByLabelText("Tutup kolom 2")).toBeInTheDocument();  // grup lain utuh
  });
});

describe("TerminalScreen (layar penuh)", () => {
  const root = () => screen.getByTestId("terminal-root");

  it("tombol memaksimalkan screen, label & aria-pressed berbalik", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);

    const masuk = await screen.findByRole("button", { name: "Layar penuh" });
    expect(masuk).toHaveAttribute("aria-pressed", "false");
    expect(root()).not.toHaveStyle({ position: "fixed" });

    fireEvent.click(masuk);

    expect(root()).toHaveStyle({ position: "fixed", zIndex: "100" });
    expect(screen.getByRole("button", { name: "Keluar layar penuh" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("keluar mengembalikan root flex dengan tinggi minimum yang dapat digulir Shell", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: "Layar penuh" }));

    fireEvent.click(screen.getByRole("button", { name: "Keluar layar penuh" }));

    expect(root()).not.toHaveStyle({ position: "fixed" });
    expect(root()).not.toHaveStyle({ height: "calc(100dvh - 180px)" });
    expect(root()).toHaveStyle({ flex: "1 1 0", minHeight: "640px" });
    expect(screen.getByRole("button", { name: "Layar penuh" })).toBeInTheDocument();
  });

  it("kontrol tetap bekerja di dalam layar penuh", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");

    fireEvent.click(screen.getByRole("button", { name: "Layar penuh" }));

    // tabbar, gutter, toolbar: semuanya masih ada setelah chrome dilebur jadi satu baris
    expect(screen.getByRole("tab", { name: "Utama" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tutup kolom 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sesi baru" })).toBeInTheDocument();

    // dan benar-benar terhubung, bukan sekadar ter-render
    fireEvent.click(screen.getByRole("button", { name: "+ Kolom" }));
    expect(await screen.findByLabelText("Tutup kolom 2")).toBeInTheDocument();
    expect(root()).toHaveStyle({ position: "fixed" });   // tetap maximize
  });

  it("Escape TIDAK keluar dari layar penuh — Escape milik terminal", async () => {
    listTerminals.mockResolvedValue([]);
    render(<TerminalScreen projects={projects} />);
    fireEvent.click(await screen.findByRole("button", { name: "Layar penuh" }));

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(root(), { key: "Escape" });

    expect(root()).toHaveStyle({ position: "fixed" });
    expect(screen.getByRole("button", { name: "Keluar layar penuh" })).toBeInTheDocument();
  });
});

// SPEC-232 · fullscreen SATU terminal sebagai modal. Pane dipindah sel→modal supaya tetap
// satu attach tmux; sel menampilkan placeholder. Escape milik terminal (bukan penutup modal).
describe("TerminalScreen · fullscreen 1 terminal (SPEC-232)", () => {
  it("klik ikon fullscreen membuka modal berisi terminal sesi itu (pane pindah, tetap satu)", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");

    fireEvent.click(screen.getByLabelText("Layar penuh sesi aaaa1111"));

    // modal muncul; pane tetap TEPAT SATU (dipindah dari sel ke modal)
    expect(screen.getByLabelText("Tutup")).toBeInTheDocument();
    expect(screen.getAllByTestId("pane")).toHaveLength(1);
    expect(screen.getByText("Terbuka di layar penuh")).toBeInTheDocument(); // placeholder di sel
  });

  it("tombol tutup modal mengembalikan terminal ke sel", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Layar penuh sesi aaaa1111"));
    expect(screen.getByLabelText("Tutup")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Tutup"));

    await waitFor(() => expect(screen.queryByText("Terbuka di layar penuh")).toBeNull());
    expect(screen.getByTestId("pane")).toHaveTextContent("aaaa1111"); // kembali di sel
  });

  it("Escape TIDAK menutup modal fullscreen — Escape milik terminal", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Layar penuh sesi aaaa1111"));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByLabelText("Tutup")).toBeInTheDocument(); // masih terbuka
    expect(screen.getByText("Terbuka di layar penuh")).toBeInTheDocument();
  });

  it("sesi yang hilang lewat frame WS menutup modal fullscreen", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("pane");
    fireEvent.click(screen.getByLabelText("Layar penuh sesi aaaa1111"));
    expect(screen.getByLabelText("Tutup")).toBeInTheDocument();

    await act(async () => { ev.handler?.({ t: "sessions", sessions: [] }); }); // sesi lenyap

    await waitFor(() => expect(screen.queryByLabelText("Tutup")).toBeNull());
  });
});

// SPEC-175 · aksi rebase/merge di header Cell, hanya untuk sesi ber-specId.
describe("TerminalScreen · integrate (SPEC-175)", () => {
  it("Cell sesi ber-specId punya aksi Rebase / Merge; sesi tanpa spec tidak", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 2, cells: ["spec1sess", "plain0000"] }));
    listTerminals.mockResolvedValue([
      { id: "spec1sess", projectId: "p1", specId: "SPEC-1", cwd: "/repo", exited: false },
      { id: "plain0000", projectId: "p1", cwd: "/repo", exited: false },
    ]);
    const spec = { id: "SPEC-1", projectId: "p1", stage: "done", title: "t", source: "brief",
      priority: "sedang", author: "a", objective: "o", payload: {}, branchFrom: null };
    render(<TerminalScreen projects={projects} onIntegrate={() => {}} specOf={() => spec as never} />);
    await waitFor(() => expect(screen.getAllByTestId("pane")).toHaveLength(2));
    expect(screen.getAllByTitle(/Rebase \/ Merge/i)).toHaveLength(1); // hanya sesi ber-spec
  });
});

// SPEC-511 · modifier yang tak terlihat sama saja dengan tak ada. tmux `mouse on` (SPEC-209)
// membuat drag polos diteruskan ke tmux, bukan menyeleksi; satu-satunya jalan menyeleksi adalah
// menahan Option (macOS) / Shift (Windows·Linux). Petunjuknya hidup di header sel, permukaan yang
// sama tempat semua affordance sel lain berada.
describe("TerminalScreen · petunjuk salin (SPEC-511)", () => {
  it("tiap sel memberi tahu modifier seleksi dan kombo salinnya", async () => {
    localStorage.setItem(LKEY, JSON.stringify({ rows: 1, cols: 1, cells: ["aaaa1111"] }));
    listTerminals.mockResolvedValue([{ id: "aaaa1111", projectId: "p1", cwd: "/repo", exited: false }]);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toBeInTheDocument());
    const hint = screen.getByLabelText("Cara menyalin teks terminal");
    expect(hint).toHaveAttribute("title", expect.stringContaining("Option"));
    expect(hint).toHaveAttribute("title", expect.stringContaining("Shift"));
  });
});

// SPEC-162 · fase dilaporkan agen, server menyiarkannya lewat WS terminal. Strip ini hanya
// menggambar apa yang dilaporkan — ia tak menyimpulkan apa pun sendiri.
describe("PhaseStrip", () => {
  it("menandai tiap fase dengan state-nya", () => {
    render(<PhaseStrip phases={[
      { name: "Brainstorm", state: "done" },
      { name: "Objective", state: "active" },
      { name: "Spec", state: "pending" },
    ]} />);
    expect(screen.getByText("Brainstorm")).toHaveAttribute("data-state", "done");
    expect(screen.getByText("Objective")).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Spec")).toHaveAttribute("data-state", "pending");
  });

  it("fase yang dilewati terbaca berbeda dari yang selesai", () => {
    render(<PhaseStrip phases={[{ name: "Plan", state: "skipped" }]} />);
    expect(screen.getByText("Plan")).toHaveAttribute("data-state", "skipped");
  });

  it("tanpa fase, tak menggambar apa pun (sesi project biasa)", () => {
    const { container } = render(<PhaseStrip phases={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
