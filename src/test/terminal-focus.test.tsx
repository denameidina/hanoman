// Audit UI/UX 2026-10 · Fase 3E · mode Fokus (rail sesi + satu pane) dan toggle Grid.
// TerminalPane diganti stub (xterm butuh canvas); yang diuji komposisi layar, bukan rendering terminal.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalScreen } from "../src/screens/TerminalScreen";
import { mockViewport, resetViewport } from "./viewport";

// Stub menampilkan prop yang kini dikendalikan layar (papan tombol, dock ringkas) supaya tes bisa
// membaca keputusan layar tanpa xterm. "Tombol khusus" meniru pemicu nyata lewat onToggleKeys.
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId, showKeys, compact, onToggleKeys }: {
    sessionId: string; showKeys?: boolean; compact?: boolean; onToggleKeys?: () => void;
  }) => (
    <div data-testid="pane" data-keys={String(!!showKeys)} data-compact={String(!!compact)}>
      {sessionId}
      {onToggleKeys && <button type="button" onClick={onToggleKeys}>Tombol khusus</button>}
    </div>
  ),
}));
const listTerminals = vi.fn();
const deleteTerminal = vi.fn();
const getTerminalWorkspace = vi.fn();
const putTerminalWorkspace = vi.fn();
const listSessionHistory = vi.fn();
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, msg: string, public detail: unknown = null) { super(msg); }
  },
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: vi.fn(),
    createShell: vi.fn(),
    deleteTerminal: (...a: unknown[]) => deleteTerminal(...a),
    listBranches: vi.fn(async () => ({ branches: [], remotes: [] })),
    startSession: vi.fn(),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    getSettings: vi.fn(async () => ({ model: "opus", effort: "xhigh", agent: "claude" })),
    getCodexVersion: vi.fn(async () => ({ version: "0.145.0", minRequired: "0.144.0", ok: true })),
    getTerminalWorkspace: (...a: unknown[]) => getTerminalWorkspace(...a),
    putTerminalWorkspace: (...a: unknown[]) => putTerminalWorkspace(...a),
    listSessionHistory: (...a: unknown[]) => listSessionHistory(...a),
  },
}));
vi.mock("../src/api/events", () => ({
  subscribe: () => () => {},
}));

const projects = [{ id: "p1", name: "hanoman" }];
const VIEW_KEY = "hn.ui.v1.terminal.view";

// Urutan masuk sengaja tak sesuai urutan rail: rail harus menyusunnya sendiri.
const SESSIONS = [
  { id: "done44", projectId: "p1", cwd: "", exited: true, exitCode: 0 },
  { id: "fail33", projectId: "p1", cwd: "", exited: true, exitCode: 1 },
  { id: "run222", projectId: "p1", cwd: "", exited: false },
  { id: "att111", projectId: "p1", cwd: "", exited: false, decision: true,
    decisionAt: "2026-10-11T08:00:00.000Z" },
];

// Id sesi dalam urutan tampil rail, dibaca dari tombol ⋯ tiap baris ("Aksi sesi <id> di daftar").
function railOrder(): string[] {
  const list = screen.getByRole("list", { name: "Daftar sesi" });
  return within(list).getAllByRole("listitem").map((li) => {
    const menu = within(li).getByRole("button", { name: /^Aksi sesi \S+ di daftar$/ });
    return menu.getAttribute("aria-label")!.split(" ")[2]!;
  });
}
function railRows(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".hn-terminal-rail-main"));
}

beforeEach(() => {
  localStorage.clear();
  listTerminals.mockReset().mockResolvedValue(SESSIONS.map((s) => ({ ...s })));
  deleteTerminal.mockReset().mockResolvedValue(undefined);
  getTerminalWorkspace.mockReset().mockResolvedValue({ workspace: null, revision: 0, updatedAt: null });
  listSessionHistory.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1 });
  putTerminalWorkspace.mockReset().mockImplementation(async (input: { baseRevision: number; workspace: unknown }) => ({
    workspace: input.workspace, revision: input.baseRevision + 1, updatedAt: "2026-10-11T00:00:00.000Z",
  }));
});
afterEach(() => { resetViewport(); });

describe("TerminalScreen · mode Fokus (Fase 3E)", () => {
  it("default ke Fokus: satu pane dan rail, tanpa grid", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("terminal-focus");
    expect(screen.queryByTestId("terminal-grid")).toBeNull();
    expect(screen.getByRole("button", { name: "Fokus" })).toHaveAttribute("aria-pressed", "true");
    // Hanya satu pane terpasang: satu sesi = satu attach tmux.
    expect(screen.getAllByTestId("pane")).toHaveLength(1);
  });

  it("rail menyusun sesi: butuh keputusan → berjalan → gagal → selesai", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("list", { name: "Daftar sesi" });
    await waitFor(() => expect(railOrder()).toHaveLength(4));
    expect(railOrder()).toEqual(["att111", "run222", "fail33", "done44"]);
    const labels = railRows().map((b) => b.querySelector(".hn-terminal-rail-meta")?.textContent ?? "");
    expect(labels[0]).toContain("Menunggu keputusan");
    expect(labels[1]).toContain("Berjalan");
    expect(labels[2]).toContain("Gagal · exit 1");
    expect(labels[3]).toContain("Selesai");
  });

  it("sesi fokus = baris pertama rail bila belum ada yang dipilih", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("list", { name: "Daftar sesi" });
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("att111"));
    expect(railRows()[0]).toHaveAttribute("aria-current", "true");
  });

  it("panah ↑/↓ memindahkan fokus dan memilih sesi; Home/End ke ujung", async () => {
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(railOrder()).toHaveLength(4));
    const rows = railRows();
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    expect(screen.getByTestId("pane")).toHaveTextContent("run222");
    expect(rows[1]).toHaveAttribute("aria-current", "true");

    fireEvent.keyDown(rows[1]!, { key: "End" });
    expect(document.activeElement).toBe(rows[3]);
    expect(screen.getByTestId("pane")).toHaveTextContent("done44");

    fireEvent.keyDown(rows[3]!, { key: "ArrowDown" });        // tanpa berputar di ujung
    expect(screen.getByTestId("pane")).toHaveTextContent("done44");

    fireEvent.keyDown(rows[3]!, { key: "Home" });
    expect(document.activeElement).toBe(rows[0]);
    expect(screen.getByTestId("pane")).toHaveTextContent("att111");
  });

  it("klik baris rail membuka sesi itu di pane fokus", async () => {
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(railOrder()).toHaveLength(4));
    fireEvent.click(railRows()[2]!);
    expect(screen.getByTestId("pane")).toHaveTextContent("fail33");
  });

  it("kill lewat menu baris: konfirmasi dulu, Batal tak mematikan, Tutup mematikan", async () => {
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(railOrder()).toHaveLength(4));

    // Batal: sesi tetap ada dan tak ada panggilan DELETE.
    fireEvent.click(screen.getByLabelText("Aksi sesi run222 di daftar"));
    const menu = await screen.findByRole("dialog", { name: "Aksi sesi run222 di daftar" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Tutup sesi" }));
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    expect(deleteTerminal).not.toHaveBeenCalled();
    expect(railOrder()).toContain("run222");

    // Tutup: dikonfirmasi, lalu DELETE dan baris hilang dari rail.
    fireEvent.click(screen.getByLabelText("Aksi sesi run222 di daftar"));
    const again = await screen.findByRole("dialog", { name: "Aksi sesi run222 di daftar" });
    fireEvent.click(within(again).getByRole("menuitem", { name: "Tutup sesi" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tutup sesi" }));
    await waitFor(() => expect(deleteTerminal).toHaveBeenCalledWith("run222"));
    await waitFor(() => expect(railOrder()).not.toContain("run222"));
  });

  it("deep link focusSession membuka sesi itu di fokus", async () => {
    render(<TerminalScreen projects={projects} focusSession="run222" />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("run222"));
    expect(screen.getAllByTestId("pane")).toHaveLength(1);
  });

  it("deep link ke sesi yang sudah berakhir: tak memfokus sesi lain, dan memberi tahu", async () => {
    render(<TerminalScreen projects={projects} focusSession="gone999" />);
    expect(await screen.findByText("Sesi itu sudah berakhir.")).toBeInTheDocument();
    // Tak ada pane untuk sesi itu, dan pane yang tampil bukan hasil pindah fokus ke sesi lain.
    expect(listSessionHistory).toHaveBeenCalledWith({ q: "gone999", limit: 1 });
    expect(screen.queryByRole("button", { name: "Riwayat sesi" })).toBeNull();
  });

  it("sesi berakhir yang tercatat di riwayat: toast menawarkan aksi Riwayat sesi yang membukanya", async () => {
    // Hanya panggilan pertama (pemeriksaan riwayat sesi ini) yang melaporkan satu baris.
    listSessionHistory.mockResolvedValueOnce({ items: [], total: 1, page: 1, pageSize: 1 });
    render(<TerminalScreen projects={projects} focusSession="gone999" />);
    fireEvent.click(await screen.findByRole("button", { name: "Riwayat sesi" }));
    expect(await screen.findByRole("dialog", { name: "Riwayat sesi" })).toBeInTheDocument();
  });

  it("sesi berakhir tetap diberi tahu bila riwayatnya gagal dimuat (tanpa aksi)", async () => {
    listSessionHistory.mockRejectedValue(new Error("offline"));
    render(<TerminalScreen projects={projects} focusSession="gone999" />);
    expect(await screen.findByText("Sesi itu sudah berakhir.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Riwayat sesi" })).toBeNull();
  });

  it("sesi target yang masih hidup tetap difokuskan tanpa pemberitahuan", async () => {
    render(<TerminalScreen projects={projects} focusSession="run222" />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("run222"));
    expect(screen.queryByText("Sesi itu sudah berakhir.")).toBeNull();
    expect(listSessionHistory).not.toHaveBeenCalled();
  });

  it("toggle Grid tersimpan dan dipulihkan saat layar dibuka lagi", async () => {
    const first = render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("terminal-focus");
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(localStorage.getItem(VIEW_KEY)).toBe(JSON.stringify("grid"));
    await screen.findByTestId("terminal-grid");
    expect(screen.queryByTestId("terminal-focus")).toBeNull();
    first.unmount();

    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("terminal-grid");
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Fokus" }));
    expect(localStorage.getItem(VIEW_KEY)).toBe(JSON.stringify("focus"));
    await screen.findByTestId("terminal-focus");
  });

  it("nilai view yang rusak di storage jatuh ke Fokus", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify("kacau"));
    render(<TerminalScreen projects={projects} />);
    await screen.findByTestId("terminal-focus");
  });

  it("toolbar memuat ≤ 6 kontrol; pembukaan sesi lain ada di menu Buka…", async () => {
    render(<TerminalScreen projects={projects} />);
    const toolbar = await screen.findByRole("group", { name: "Terminal" });
    const controls = within(toolbar).getAllByRole("button");
    expect(controls.length).toBeLessThanOrEqual(6);
    expect(within(toolbar).queryByRole("button", { name: "Ambil backlog" })).toBeNull();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Buka…" }));
    const open = await screen.findByRole("dialog", { name: "Buka sesi" });
    for (const name of ["Ambil backlog", "Riwayat sesi", "Terminal biasa"]) {
      expect(within(open).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("mobile: rail jadi laci; memilih sesi di laci menutupnya dan membuka sesi itu", async () => {
    mockViewport(390);
    render(<TerminalScreen projects={projects} />);
    const toggle = await screen.findByRole("button", { name: /^Sesi · 4$/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const drawer = await screen.findByRole("dialog", { name: "Sesi terminal" });
    const list = within(drawer).getByRole("list", { name: "Daftar sesi" });
    const row = within(list).getAllByRole("listitem").map((li) => li.querySelector<HTMLButtonElement>(".hn-terminal-rail-main")!)[3]!;
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sesi terminal" })).toBeNull());
    expect(screen.getByTestId("pane")).toHaveTextContent("done44");
    // Sesi yang sudah berakhir tetap menampilkan banner Berakhir (perilaku Fase 1).
    expect(screen.getByTestId("terminal-ended")).toBeInTheDocument();
  });
});

// Fase 3E+ · ponsel: toolbar satu baris (Sesi baru · Sesi · N · ⋯), kepala pane satu baris, dan papan
// tombol khusus yang tertutup dulu. Tinggi dan tata letak nyata tak bisa diukur jsdom; yang diikat di
// sini adalah struktur dan keputusan layar, sedangkan CSS-nya dijaga `terminal-css-contract.test.ts`.
describe("TerminalScreen · ponsel: toolbar satu baris dan papan tombol khusus (Fase 3E+)", () => {
  it("toolbar ponsel satu baris: Sesi baru, Buka… (ikon), Sesi · N, dan ⋯; Fokus|Grid dan layar penuh pindah ke ⋯", async () => {
    mockViewport(390);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("button", { name: /^Sesi · 4$/ });
    const toolbar = screen.getByRole("group", { name: "Terminal" });
    expect(within(toolbar).getAllByRole("button")).toHaveLength(4);
    expect(within(toolbar).getByRole("button", { name: "Sesi baru" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Buka…" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Sesi · 4" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Menu terminal" })).toBeInTheDocument();
    expect(within(toolbar).queryByRole("button", { name: "Fokus" })).toBeNull();
    expect(within(toolbar).queryByRole("button", { name: "Layar penuh" })).toBeNull();
  });

  it("⋯ ponsel memuat mode, layar penuh, dan tampilan; mode Grid berpindah dari sana", async () => {
    mockViewport(390);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("button", { name: /^Sesi · 4$/ });
    fireEvent.click(screen.getByRole("button", { name: "Menu terminal" }));
    const menu = await screen.findByRole("dialog", { name: "Terminal" });
    for (const name of ["Pakai mode Grid", "Layar penuh", "Tampilan terminal"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Pakai mode Grid" }));
    expect(localStorage.getItem(VIEW_KEY)).toBe(JSON.stringify("grid"));
    await screen.findByTestId("terminal-grid");
    expect(screen.queryByTestId("terminal-focus")).toBeNull();
  });

  it("⋯ ponsel: Tampilan terminal membuka sheet kontrol tampilannya, bukan baris toolbar", async () => {
    mockViewport(390);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("button", { name: /^Sesi · 4$/ });
    fireEvent.click(screen.getByRole("button", { name: "Menu terminal" }));
    const menu = await screen.findByRole("dialog", { name: "Terminal" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Tampilan terminal" }));
    const sheet = await screen.findByRole("dialog", { name: "Tampilan terminal" });
    expect(within(sheet).getByText("Ukuran teks terminal")).toBeInTheDocument();
    expect(within(sheet).getByText("Papan tombol layar (Esc · panah · Enter)")).toBeInTheDocument();
  });

  it("pane fokus ponsel: kepala satu baris tanpa tombol Sesi, dan pane memakai dock ringkas", async () => {
    mockViewport(390);
    render(<TerminalScreen projects={projects} />);
    await screen.findByRole("button", { name: /^Sesi · 4$/ });
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveAttribute("data-compact", "true"));
    const head = document.querySelector<HTMLElement>(".hn-terminal-focus-head")!;
    expect(within(head).queryByRole("button", { name: /^Sesi · / })).toBeNull();
    expect(within(head).getByRole("button", { name: /^Aksi sesi / })).toBeInTheDocument();
  });

  it("ponsel: papan tombol khusus tertutup dulu, lalu dibuka dan pilihannya diingat", async () => {
    mockViewport(390);
    const first = render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveAttribute("data-compact", "true"));
    expect(screen.getByTestId("pane")).toHaveAttribute("data-keys", "false");
    fireEvent.click(screen.getByRole("button", { name: "Tombol khusus" }));
    expect(screen.getByTestId("pane")).toHaveAttribute("data-keys", "true");
    expect(localStorage.getItem("hn.ui.v1.terminal.keys")).toBe("true");
    first.unmount();

    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveAttribute("data-keys", "true"));
  });

  it("tablet sentuh tetap membuka papan tombol, dan desktop tetap tertutup", async () => {
    mockViewport(900);
    const tablet = render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveAttribute("data-compact", "false"));
    expect(screen.getByTestId("pane")).toHaveAttribute("data-keys", "true");
    tablet.unmount();

    // Pilihan papan tombol dari tablet tadi tersimpan; desktop diuji dari default-nya sendiri.
    localStorage.removeItem("hn.ui.v1.terminal.keys");
    mockViewport(1280);
    render(<TerminalScreen projects={projects} />);
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveAttribute("data-compact", "false"));
    expect(screen.getByTestId("pane")).toHaveAttribute("data-keys", "false");
  });
});
