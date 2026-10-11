import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listCustomAgents = vi.fn();
const createCustomAgent = vi.fn();
const updateCustomAgent = vi.fn();
const deleteCustomAgent = vi.fn();
const getCustomAgentCatalog = vi.fn();
const getCustomAgentMetrics = vi.fn();
const updateAgentInvocationDisposition = vi.fn();

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
    listCustomAgents: (p?: string, runtime?: string) => listCustomAgents(p, runtime),
    createCustomAgent: (b: unknown) => createCustomAgent(b),
    updateCustomAgent: (id: string, b: unknown) => updateCustomAgent(id, b),
    deleteCustomAgent: (id: string) => deleteCustomAgent(id),
    getCustomAgentCatalog: (p?: string) => getCustomAgentCatalog(p),
    getCustomAgentMetrics: (p: unknown) => getCustomAgentMetrics(p),
    updateAgentInvocationDisposition: (id: string, b: unknown) =>
      updateAgentInvocationDisposition(id, b),
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
    { id: "opus", label: "Opus 5", runtime: "claude" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", runtime: "codex" },
  ],
  runtimes: [{ id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex CLI" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  listCustomAgents.mockResolvedValue(rows);
  getCustomAgentCatalog.mockResolvedValue(catalog);
  getCustomAgentMetrics.mockResolvedValue({ agents: [], recent: [] });
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
    expect(listCustomAgents).toHaveBeenCalledWith("p1", undefined);
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
    expect(listCustomAgents).toHaveBeenCalledWith(undefined, undefined);
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

  // Form agen hidup di modal: tujuh field + textarea sebagai kartu inline mendorong Simpan
  // ke luar viewport, dan dari kartu terbawah operator harus menggulir lagi mencari formnya.
  it("form agen dibuka sebagai modal, bukan kartu di bawah daftar", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /agen baru/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(screen.getByLabelText("Nama"))).toBe(true);
    expect(dialog.contains(screen.getByRole("button", { name: /simpan/i }))).toBe(true);
  });

  it("Batal menutup modal tanpa menyimpan", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    fireEvent.click(screen.getAllByRole("button", { name: /ubah/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /batal/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCustomAgent).not.toHaveBeenCalled();
  });

  // Penolakan server harus terbaca DI TEMPAT operator berada — di dalam modal, bukan di
  // halaman di belakangnya.
  it("pesan penolakan server tampil di dalam modal", async () => {
    createCustomAgent.mockRejectedValue(new FakeApiError(400, "400", { error: "nama sudah dipakai" }));
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agn-a" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(screen.getByText(/nama sudah dipakai/i)).toBeTruthy());
    expect(screen.getByRole("dialog").contains(screen.getByText(/nama sudah dipakai/i))).toBe(true);
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
    expect([...model().options].map((o) => o.value)).toContain("opus");
  });

  it("menukar runtime yang membuat model terpilih tak sah akan MENGOSONGKAN model", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-sol" } });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("gpt-5.6-sol");
    fireEvent.change(screen.getByLabelText("Runtime agent"), { target: { value: "claude" } });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("");
  });

  it("Effort adalah katalog dan menyusut saat model Codex berubah", async () => {
    getCustomAgentCatalog.mockResolvedValue({
      ...catalog,
      models: [...catalog.models,
        { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", runtime: "codex" }],
    });
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Runtime agent"), { target: { value: "codex" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-sol" } });
    const effort = () => screen.getByLabelText("Effort") as HTMLSelectElement;
    expect([...effort().options].map((option) => option.value)).toContain("ultra");
    fireEvent.change(effort(), { target: { value: "ultra" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-luna" } });
    expect([...effort().options].map((option) => option.value)).not.toContain("ultra");
    expect(effort().value).toBe("");
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

describe("SPEC-950 · profil eksekusi dan bukti efektivitas", () => {
  it("distinguishes missing evidence from a failed metrics request", async () => {
    getCustomAgentMetrics.mockRejectedValue(new Error("offline"));
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    expect(screen.getByText(/Bukti penggunaan gagal dimuat/)).toBeTruthy();
    expect(screen.queryByText(/Belum ada bukti invocation dalam periode ini/)).toBeNull();
  });
  it("shows reviewed samples even when another agent occupies recent history", async () => {
    getCustomAgentMetrics.mockResolvedValue({ agents: [], variants: [], recent: [], samples: [{
      id: "older-reviewed", agentName: "rev", runtime: "claude", model: null,
      startedAt: "2026-09-01T00:00:00Z", disposition: "partial", reworkRequired: true,
      resultExcerpt: "bukti dinilai yang lebih lama",
    }] });
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    expect(screen.getByText(/bukti dinilai yang lebih lama/)).toBeTruthy();
    expect((screen.getByLabelText("Disposition older-reviewed") as HTMLSelectElement).value).toBe("partial");
    expect((screen.getByLabelText("Kerja ulang older-reviewed") as HTMLSelectElement).value).toBe("yes");
  });

  it("shows unknown usage honestly and keeps token categories separate", async () => {
    getCustomAgentMetrics.mockResolvedValue({ agents: [], recent: [], variants: [],
      telemetry: { state: "unobserved", lastEventAt: null, incompleteCount: 0 } });
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    expect(screen.getByText(/Belum ada bukti invocation dalam periode ini/)).toBeTruthy();
    const summary = screen.getByTestId("metrics-rev").textContent;
    expect(summary).toContain("Token masuk: —");
    expect(summary).toContain("keluar: —");
    expect(summary).toContain("cache: —");
  });
  it("meminta availability terhadap runtime sesi", async () => {
    render(<CustomAgentsPanel projectId={null} runtime="codex" />);
    await screen.findByText("rev");
    expect(listCustomAgents).toHaveBeenCalledWith(undefined, "codex");
  });

  it("mengedit dan mengirim seluruh profil eksekusi", async () => {
    updateCustomAgent.mockResolvedValue(rows[1]);
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    fireEvent.click(screen.getAllByRole("button", { name: /ubah/i })[0]!);
    fireEvent.change(screen.getByLabelText("Aktivasi"), { target: { value: "smart" } });
    fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Kebijakan workspace"), { target: { value: "read-only" } });
    fireEvent.change(screen.getByLabelText("Maksimum giliran"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Timeout detik"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));
    await waitFor(() => expect(updateCustomAgent).toHaveBeenCalled());
    expect(updateCustomAgent.mock.calls[0]).toEqual(["global:rev", expect.objectContaining({
      activation: "smart", effort: "high", workspacePolicy: "read-only",
      maxTurns: 42, timeoutSeconds: 900,
    })]);
  });

  it("mengunci simpan untuk batas numerik dan kombinasi isolated+Codex", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "agen-baru" } });
    fireEvent.change(screen.getByLabelText("Maksimum giliran"), { target: { value: "201" } });
    expect((screen.getByRole("button", { name: /simpan/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Maksimum giliran"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Runtime agent"), { target: { value: "codex" } });
    const policy = screen.getByLabelText("Kebijakan workspace") as HTMLSelectElement;
    expect([...policy.options].find((o) => o.value === "isolated-worktree")?.disabled).toBe(true);
  });

  it("menjelaskan agen enabled yang tidak tersedia", async () => {
    listCustomAgents.mockResolvedValue([{ ...rows[0], inherited: false, available: false,
      availabilityReason: "isolated-worktree belum tersedia untuk Codex" }]);
    render(<CustomAgentsPanel projectId={null} />);
    expect(await screen.findByText(/isolated-worktree belum tersedia untuk Codex/i)).toBeTruthy();
  });

  it("menampilkan metrik 30 hari, nilai tak tersedia sebagai em dash, dan alarm workspace", async () => {
    getCustomAgentMetrics.mockResolvedValue({
      agents: [{
        agentName: "rev", invocationCount: 7, medianDurationMs: null,
        inputTokens: null, outputTokens: null, cachedTokens: null,
        dispositions: { pending: 2, accepted: 3, partial: 1, rejected: 1, falsePositive: 0 },
        operationalPrecision: 0.8, workspaceChanged: true,
      }],
      recent: [{
        id: "inv-1", sessionId: "s1", projectId: "p1", specId: null, runtime: "claude",
        customAgentId: "global:rev", agentName: "rev", model: null, status: "completed",
        startedAt: "2026-08-30T00:00:00.000Z", endedAt: "2026-08-30T00:00:01.000Z",
        durationMs: null, inputTokens: null, outputTokens: null, cachedTokens: null,
        resultExcerpt: "temuan", resultHash: "h", workspaceChanged: true,
        disposition: "pending", dispositionNote: null, evaluatedAt: null,
      }],
    });
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    expect(screen.getByTestId("metrics-rev").textContent).toContain("7 invocation");
    expect(screen.getByTestId("metrics-rev").textContent).toContain("Durasi median: —");
    expect(screen.getByTestId("metrics-rev").textContent).toContain("Token masuk: —");
    expect(screen.getByTestId("precision-rev").textContent).toContain("80%");
    expect(screen.getByText(/workspace berubah/i)).toBeTruthy();
    expect(getCustomAgentMetrics).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }));
  });

  it("menilai invocation lalu memuat ulang metrics", async () => {
    getCustomAgentMetrics.mockResolvedValue({ agents: [], recent: [{
      id: "inv-1", sessionId: "s1", projectId: "p1", specId: null, runtime: "claude",
      customAgentId: "global:rev", agentName: "rev", model: null, status: "completed",
      startedAt: "2026-08-30T00:00:00.000Z", endedAt: "2026-08-30T00:00:01.000Z",
      durationMs: 1000, inputTokens: 10, outputTokens: 5, cachedTokens: null,
      resultExcerpt: "temuan", resultHash: "h", workspaceChanged: false,
      disposition: "pending", dispositionNote: null, evaluatedAt: null,
    }] });
    updateAgentInvocationDisposition.mockResolvedValue({});
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    fireEvent.click(screen.getByText(/1 sampel bukti/i));
    fireEvent.change(screen.getByLabelText("Disposition inv-1"), { target: { value: "accepted" } });
    fireEvent.change(screen.getByLabelText("Catatan inv-1"), { target: { value: "berguna" } });
    fireEvent.click(screen.getByRole("button", { name: "Nilai inv-1" }));
    await waitFor(() => expect(updateAgentInvocationDisposition).toHaveBeenCalledWith("inv-1", {
      disposition: "accepted", note: "berguna",
    }));
    expect(getCustomAgentMetrics.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps runtime/model/definition evidence separate and saves explicit rework", async () => {
    const metric = {
      agentName: "rev", invocationCount: 1, evaluatedCount: 1, medianDurationMs: 1000,
      inputTokens: 10, outputTokens: 5, cachedTokens: 3,
      dispositions: { pending: 0, accepted: 1, partial: 0, rejected: 0, falsePositive: 0 },
      operationalPrecision: 1, workspaceChanged: false,
      rework: { required: 0, notRequired: 1, unknown: 0 },
    };
    getCustomAgentMetrics.mockResolvedValue({ agents: [metric], variants: [
      { ...metric, runtime: "claude", model: "sonnet", definitionHash: "a".repeat(64) },
      { ...metric, runtime: "codex", model: null, definitionHash: null },
    ], recent: [{
      id: "inv-1", agentName: "rev", runtime: "claude", model: "sonnet",
      startedAt: "2026-09-05T00:00:00.000Z",
      disposition: "accepted", dispositionNote: "berguna", reworkRequired: false,
      resultExcerpt: "bukti", workspaceChanged: false,
    }] });
    updateAgentInvocationDisposition.mockResolvedValue({});
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("rev");
    expect(screen.getByText(/claude · sonnet/, { selector: "li" }).textContent).toContain("aaaaaaaaaaaa");
    expect(screen.getByText(/codex · model tidak tercatat/).textContent).toContain("versi tidak tercatat");
    fireEvent.click(screen.getByText(/1 sampel bukti/i));
    fireEvent.change(screen.getByLabelText("Kerja ulang inv-1"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("Catatan inv-1"), { target: { value: "perlu penyempurnaan" } });
    fireEvent.click(screen.getByRole("button", { name: "Nilai inv-1" }));
    await waitFor(() => expect(updateAgentInvocationDisposition).toHaveBeenCalledWith("inv-1", {
      disposition: "accepted", note: "perlu penyempurnaan", reworkRequired: true,
    }));
  });
});

describe("audit UI/UX · hapus, galat muat, field lanjutan, validasi", () => {
  const own = { id: "global:punyaku", projectId: null, name: "punyaku", description: "uji",
    instructions: "i", tools: null, model: null, mentions: [], runtime: null,
    enabled: true, inherited: false, builtin: false };
  const bawaan = { ...own, id: "global:scout", name: "scout", builtin: true };

  it("Hapus meminta konfirmasi bernama agen dan baru menghapus setelah disetujui", async () => {
    listCustomAgents.mockResolvedValue([own]);
    deleteCustomAgent.mockResolvedValue(undefined);
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("punyaku");
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(await screen.findByText("Hapus agen punyaku?")).toBeTruthy();
    expect(deleteCustomAgent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hapus agen" }));
    await waitFor(() => expect(deleteCustomAgent).toHaveBeenCalledWith("global:punyaku"));
  });

  it("batal pada konfirmasi tidak menghapus", async () => {
    listCustomAgents.mockResolvedValue([own]);
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("punyaku");
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByText("Hapus agen punyaku?")).toBeNull());
    expect(deleteCustomAgent).not.toHaveBeenCalled();
  });

  it("gagal menghapus menampilkan galat bernama aksi", async () => {
    listCustomAgents.mockResolvedValue([own]);
    deleteCustomAgent.mockRejectedValue(new FakeApiError(500, "500", { error: "db terkunci" }));
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("punyaku");
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hapus agen" }));
    expect(await screen.findByText("Gagal menghapus agen: db terkunci")).toBeTruthy();
  });

  it("agen bawaan: Hapus mati dan alasannya terlihat", async () => {
    listCustomAgents.mockResolvedValue([bawaan]);
    render(<CustomAgentsPanel projectId={null} />);
    await screen.findByText("scout");
    const btn = screen.getByRole("button", { name: "Hapus" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText("Agen bawaan tak bisa dihapus")).toBeTruthy();
  });

  it("galat memuat daftar BUKAN 'Belum ada custom agent': ada galat + Coba lagi", async () => {
    listCustomAgents.mockRejectedValueOnce(new FakeApiError(500, "500", { error: "server mati" }));
    render(<CustomAgentsPanel projectId={null} />);
    expect(await screen.findByText("Gagal memuat custom agent")).toBeTruthy();
    expect(screen.getByText("Gagal memuat daftar agen: server mati")).toBeTruthy();
    expect(screen.queryByText("Belum ada custom agent")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("rev")).toBeTruthy();
  });

  it("field lanjutan ada di <details> 'Lanjutan' yang tertutup default", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    const details = screen.getByText(/^Lanjutan/).closest("details")!;
    expect(details.open).toBe(false);
    for (const label of ["Runtime agent", "Effort", "Kebijakan workspace", "Maksimum giliran", "Timeout detik"]) {
      expect(details.contains(screen.getByLabelText(label))).toBe(true);
    }
    expect(details.contains(screen.getByLabelText("Model"))).toBe(false);
  });

  it("nilai salah memberi aria-invalid + pesan terkait, dan Lanjutan membuka sendiri", async () => {
    render(<CustomAgentsPanel projectId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /agen baru/i }));
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "Rev" } });
    const nama = screen.getByLabelText("Nama");
    expect(nama.getAttribute("aria-invalid")).toBe("true");
    const describedBy = nama.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)!.textContent).toMatch(/huruf kecil/);

    fireEvent.change(screen.getByLabelText("Maksimum giliran"), { target: { value: "201" } });
    const turns = screen.getByLabelText("Maksimum giliran");
    expect(turns.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(turns.getAttribute("aria-describedby")!)!.textContent).toMatch(/1–200/);
    expect((screen.getByText(/^Lanjutan/).closest("details") as HTMLDetailsElement).open).toBe(true);

    fireEvent.change(screen.getByLabelText("Maksimum giliran"), { target: { value: "40" } });
    expect(screen.getByLabelText("Maksimum giliran").getAttribute("aria-invalid")).toBeNull();
  });
});
