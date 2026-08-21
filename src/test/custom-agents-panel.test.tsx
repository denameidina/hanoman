import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listCustomAgents = vi.fn();
const createCustomAgent = vi.fn();
const updateCustomAgent = vi.fn();
const deleteCustomAgent = vi.fn();
const getCustomAgentCatalog = vi.fn();

// `vi.mock` di-hoist ke atas berkas, jadi kelas yang dideklarasikan di scope modul masih TDZ
// saat factory-nya jalan → "Cannot access before initialization". `vi.hoisted` ikut terangkat.
const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class extends Error {
    status: number; detail: unknown;
    constructor(status: number, msg: string, detail: unknown = null) { super(msg); this.status = status; this.detail = detail; }
  },
}));
vi.mock("../src/api/client", () => ({
  api: {
    listCustomAgents: (p?: string) => listCustomAgents(p),
    createCustomAgent: (b: unknown) => createCustomAgent(b),
    updateCustomAgent: (id: string, b: unknown) => updateCustomAgent(id, b),
    deleteCustomAgent: (id: string) => deleteCustomAgent(id),
    getCustomAgentCatalog: (p?: string) => getCustomAgentCatalog(p),
  },
  ApiError: FakeApiError,
}));

import { CustomAgentsPanel } from "../src/screens/CustomAgentsPanel";

const rows = [
  { id: "global:rev", projectId: null, name: "rev", description: "tinjau", instructions: "i",
    tools: null, model: null, mentions: ["tes"], runtime: null, enabled: true, inherited: true },
  { id: "p1:tes", projectId: "p1", name: "tes", description: "uji", instructions: "i",
    tools: null, model: null, mentions: [], runtime: null, enabled: true, inherited: false },
];

// SPEC-484 · ADR-0101 · katalog datang dari API, bukan hardcode di komponen.
const catalog = {
  tools: [
    { id: "*", label: "Semua tools", group: "shortcut" },
    { id: "Read", label: "Read", group: "builtin" },
    { id: "Bash", label: "Bash", group: "builtin" },
    { id: "mcp__context7__*", label: "context7 — semua tool", group: "mcp" },
  ],
  models: [
    { id: "claude-opus-5", label: "Opus 5", runtime: "claude" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", runtime: "codex" },
  ],
  runtimes: [{ id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex CLI" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  listCustomAgents.mockResolvedValue(rows);
  getCustomAgentCatalog.mockResolvedValue(catalog);
});

// SPEC-484 · helper `pick` (klik <span> di dalam <label> DS) DICABUT bersama Checkbox mention:
// `MultiSelect` memakai <button role="option"> justru supaya jebakan itu tak terulang —
// `Checkbox`/`Switch` DS bukan <input>, jadi mengklik labelnya no-op dan test yang melakukannya
// "lulus" tanpa terjadi apa-apa (pelajaran SPEC-299/360/447).

describe("CustomAgentsPanel", () => {
  it("menampilkan agen efektif project", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    expect(await screen.findByText("rev")).toBeTruthy();
    expect(screen.getByText("tes")).toBeTruthy();
    expect(listCustomAgents).toHaveBeenCalledWith("p1");
  });

  it("menandai agen warisan global sebagai read-only di permukaan project", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    await screen.findByText("rev");
    expect(screen.getByText(/warisan global/i)).toBeTruthy();
  });

  it("menampilkan tools HASIL RESOLUSI, jadi efek 'Task dicabut' terlihat", async () => {
    render(<CustomAgentsPanel projectId="p1" />);
    await screen.findByText("rev");
    // rev ber-mentions → Task ADA; tes daun → Task TIDAK ada. Ini lapis 2 anti-loop yang terlihat.
    expect(screen.getByTestId("tools-rev").textContent).toContain("Task");
    expect(screen.getByTestId("tools-tes").textContent).not.toContain("Task");
  });

  it("permukaan global hanya meminta agen global (tanpa projectId)", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    expect(listCustomAgents).toHaveBeenCalledWith(undefined);
    expect(screen.queryByText(/warisan global/i)).toBeNull();
  });

  it("menampilkan jalur siklus apa adanya saat server menolak 409", async () => {
    createCustomAgent.mockRejectedValue(new FakeApiError(409, "409",
      { error: "mention membentuk siklus", scope: "global", cycle: ["agn-a", "agn-b", "agn-a"] }));

    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agn-a" } });
    fireEvent.change(screen.getByLabelText("Deskripsi"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Instruksi"), { target: { value: "i" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));

    await waitFor(() => expect(screen.getByText(/agn-a → agn-b → agn-a/)).toBeTruthy());
    expect(screen.getByText(/scope global/i)).toBeTruthy();
  });

  it("menampilkan mention tak dikenal saat server menolak 400", async () => {
    createCustomAgent.mockRejectedValue(new FakeApiError(400, "400", { error: "mention tak dikenal", unknown: ["hantu"] }));

    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agn-a" } });
    fireEvent.change(screen.getByLabelText("Deskripsi"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Instruksi"), { target: { value: "i" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));

    await waitFor(() => expect(screen.getByText(/Mention tak dikenal: hantu/)).toBeTruthy());
  });

  it("mengirim tools kosong sebagai null (= pakai DEFAULT) dan mentions terpilih", async () => {
    createCustomAgent.mockResolvedValue(rows[0]);
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agn-baru" } });
    fireEvent.change(screen.getByLabelText("Deskripsi"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Instruksi"), { target: { value: "i" } });
    fireEvent.click(screen.getByRole("button", { name: "Mention" }));
    fireEvent.click(screen.getByRole("option", { name: /rev/ }));
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));

    await waitFor(() => expect(createCustomAgent).toHaveBeenCalled());
    expect(createCustomAgent.mock.calls[0]![0]).toMatchObject({
      name: "agn-baru", projectId: null, tools: null, mentions: ["rev"],
      runtime: null, enabled: true,
    });
  });

  it("nama TAK bisa diubah saat mengedit (changefeed tak punya operasi hapus)", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    fireEvent.click(screen.getAllByRole("button", { name: /ubah/i })[0]!);
    expect((screen.getByLabelText("Nama") as HTMLInputElement).disabled).toBe(true);
  });

  it("menolak simpan saat nama bukan slug yang sah", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "Rev" } });
    expect((screen.getByRole("button", { name: /simpan/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPEC-484 · ADR-0101 · kontrol pilihan menggantikan teks bebas
// ═══════════════════════════════════════════════════════════════════════════════
describe("CustomAgentsPanel · kontrol pilihan (SPEC-484)", () => {
  it("Tools memakai MultiSelect bersumber katalog API, bukan teks bebas", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names.some((n) => n?.includes("Semua tools"))).toBe(true);
    expect(names.some((n) => n?.includes("context7"))).toBe(true);
    expect(getCustomAgentCatalog).toHaveBeenCalled();
  });

  it("memilih 'Semua tools (*)' MENGOSONGKAN pilihan lain, dan sebaliknya", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("option", { name: /^Read/ }));
    fireEvent.click(screen.getByRole("option", { name: /Semua tools/ }));
    expect(screen.queryByTestId("chip-Read")).toBeNull();
    expect(screen.getByTestId("chip-*")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /^Bash/ }));
    expect(screen.queryByTestId("chip-*")).toBeNull();
    expect(screen.getByTestId("chip-Bash")).toBeTruthy();
  });

  it("Model menyusut mengikuti Runtime", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    const model = () => screen.getByLabelText("Model") as HTMLSelectElement;
    expect([...model().options].map((o) => o.value)).toContain("gpt-5.6-sol");
    fireEvent.change(screen.getByLabelText("Runtime agent"), { target: { value: "claude" } });
    expect([...model().options].map((o) => o.value)).not.toContain("gpt-5.6-sol");
    expect([...model().options].map((o) => o.value)).toContain("claude-opus-5");
  });

  it("menukar runtime yang membuat model terpilih tak sah akan MENGOSONGKAN model", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-sol" } });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("gpt-5.6-sol");
    fireEvent.change(screen.getByLabelText("Runtime agent"), { target: { value: "claude" } });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("");
  });

  it("mengirim runtime & tools sebagai array saat simpan", async () => {
    createCustomAgent.mockResolvedValue(rows[0]);
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agn-baru" } });
    fireEvent.change(screen.getByLabelText("Deskripsi"), { target: { value: "d" } });
    fireEvent.change(screen.getByLabelText("Instruksi"), { target: { value: "i" } });
    fireEvent.change(screen.getByLabelText("Runtime agent"), { target: { value: "codex" } });
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("option", { name: /^Read/ }));
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(createCustomAgent).toHaveBeenCalled());
    expect(createCustomAgent.mock.calls[0]![0]).toMatchObject({
      name: "agn-baru", runtime: "codex", tools: ["Read"],
    });
  });

  // Validasi server KERAS (ADR-0101 keputusan 5): nilai lama tetap TERBACA, tapi tak bisa
  // disimpan ulang apa adanya — dan operator melihat sebabnya sebelum menekan Simpan.
  it("nilai lama di luar katalog jadi chip BERTANDA dan mengunci Simpan", async () => {
    listCustomAgents.mockResolvedValue([{
      id: "global:lawas", projectId: null, name: "lawas", description: "d", instructions: "i",
      tools: ["ToolHilang"], model: null, mentions: [], runtime: null, enabled: true,
    }]);
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /ubah/i }));
    expect(screen.getByTestId("chip-ToolHilang").getAttribute("title")).toMatch(/tak ada di katalog/i);
    expect((screen.getByRole("button", { name: /simpan/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("kartu agen menampilkan pil runtime; warisi tak menampilkan apa pun", async () => {
    listCustomAgents.mockResolvedValue([
      { id: "global:aa", projectId: null, name: "aa", description: "d", instructions: "i",
        tools: null, model: null, mentions: [], runtime: "codex", enabled: true },
      { id: "global:bb", projectId: null, name: "bb", description: "d", instructions: "i",
        tools: null, model: null, mentions: [], runtime: null, enabled: true },
    ]);
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("aa");
    expect(screen.getByTestId("runtime-aa").textContent).toContain("codex");
    expect(screen.queryByTestId("runtime-bb")).toBeNull();
  });
});

// SPEC-881 · ADR-0136 · status "bawaan" datang sebagai field TURUNAN dari response, bukan kolom.
describe("badge agen bawaan", () => {
  const bawaan = (extra: Record<string, unknown>) => ({
    id: "global:scout", projectId: null, name: "scout", description: "cari kode",
    instructions: "i", tools: null, model: null, mentions: [], runtime: null,
    enabled: true, inherited: false, ...extra,
  });

  it("menandai agen bawaan", async () => {
    listCustomAgents.mockResolvedValue([bawaan({ builtin: true, builtinEdited: false })]);
    render(<CustomAgentsPanel projectId={null} />);
    expect((await screen.findByTestId("builtin-scout")).textContent).toBe("bawaan");
  });

  it("membedakan bawaan yang sudah disunting", async () => {
    listCustomAgents.mockResolvedValue([bawaan({ builtin: true, builtinEdited: true })]);
    render(<CustomAgentsPanel projectId={null} />);
    expect((await screen.findByTestId("builtin-scout")).textContent).toBe("bawaan · disunting");
  });

  it("agen buatan operator tak bertanda bawaan", async () => {
    listCustomAgents.mockResolvedValue([
      bawaan({ id: "global:punyaku", name: "punyaku", builtin: false, builtinEdited: false }),
    ]);
    render(<CustomAgentsPanel projectId={null} />);
    await waitFor(() => expect(listCustomAgents).toHaveBeenCalled());
    expect(screen.queryByTestId("builtin-punyaku")).toBeNull();
  });
});
