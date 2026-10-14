import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-409 · ADR-0091 · panel hanoman-lead. Layar ini adalah SATU-SATUNYA tempat operator melihat
// apa yang diputuskan mesin atas namanya — jadi yang diuji di sini: jejaknya terbaca (pertanyaan →
// jawaban → alasan → rujukan), rem daruratnya benar-benar menulis knob, dan "Ubah jawaban" memanggil
// endpoint override (bukan sekadar menutup formulirnya).

const {
  getLeadStatus, getLeadDecisions, putLeadConfig, overrideLeadDecision, cancelLeadDecision, updateProject,
  getLeadFlows, submitLeadFlow, cancelLeadFlow,
} = vi.hoisted(() => ({
  getLeadStatus: vi.fn(), getLeadDecisions: vi.fn(), putLeadConfig: vi.fn(),
  overrideLeadDecision: vi.fn(), cancelLeadDecision: vi.fn(), updateProject: vi.fn(),
  // SPEC-485 · ADR-0102 · rantai keputusan; `mockResolvedValue` default supaya test lama tak perlu
  // tahu apa-apa tentangnya.
  getLeadFlows: vi.fn().mockResolvedValue({ items: [] }),
  submitLeadFlow: vi.fn(), cancelLeadFlow: vi.fn(),
}));
vi.mock("../src/api/client", () => ({
  api: {
    getLeadStatus, getLeadDecisions, putLeadConfig, overrideLeadDecision, cancelLeadDecision, updateProject,
    getLeadFlows, submitLeadFlow, cancelLeadFlow,
  },
  ApiError: class extends Error {},
}));

import { LeadScreen } from "../src/screens/LeadScreen";

beforeEach(() => {
  // Penyaring & nomor halaman dipersistensi (ADR-0115) dan mock tak di-reset antartest: keduanya
  // dibersihkan supaya assertion "tidak dipanggil" hanya melihat test ini.
  localStorage.clear();
  vi.clearAllMocks();
});

const CONFIG = {
  enabled: true, paused: false, pausedProjects: [], everyMin: 5, timeoutSec: 120,
  maxAutoAnswers: 3, requireGreenBeforeIntegrate: true,
  engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
};
const STATUS = {
  config: CONFIG,
  projects: [{ projectId: "a", name: "Alpha", optIn: true, paused: false, decisions24h: 4, openSessions: 1 }],
  queue: [], deciding: ["spec-9"], waiting: ["spec-9", "spec-8"],
  lastPulseAt: "2026-07-31T00:00:00.000Z",
};
const DECISIONS = {
  items: [
    { id: "d1", projectId: "a", specId: "SPEC-1", sessionId: "spec-1",
      gate: "detected", kind: "answer", question: "Pakai kolom baru atau turunkan dari updatedAt?",
      answer: "Kolom baru.", reason: "Waktu lahir sebuah baris tak bisa dihitung ulang.",
      refs: ["ADR-0090", "internal/docs/architecture/data-model.md"],
      confidence: "tinggi", action: "none", status: "berlaku", weighty: false,
      choice: null, choiceIndex: null, options: [], missing: [],
      supersededById: null, createdAt: "2026-07-31T00:00:00.000Z" },
    // SPEC-480 · `d2` sengaja DIBIARKAN tanpa keempat field baru: dashboard bisa lebih baru
    // daripada server yang dilayaninya (paket npm global, ADR-0087), dan baris berbentuk lama
    // tak boleh meruntuhkan panelnya.
    { id: "d2", projectId: "a", specId: null, sessionId: null,
      gate: "pulse", kind: "refusal", question: "Deploy sekarang?", answer: "Tidak.",
      reason: "DITOLAK: deploy ke produksi berada di luar permukaan tindakan lead.",
      refs: [], confidence: "ragu", action: "none", status: "berlaku", weighty: true,
      supersededById: null, createdAt: "2026-07-31T00:00:00.000Z" },
  ],
};
const projects = [{ id: "a", name: "Alpha", leadOptIn: true }] as unknown as Parameters<typeof LeadScreen>[0]["projects"];

function renderScreen(over: Partial<Parameters<typeof LeadScreen>[0]> = {}) {
  return render(<LeadScreen projects={projects} onProjectChanged={vi.fn()}
    onToast={vi.fn()} onGotoTerminal={vi.fn()} {...over} />);
}

// Dialog konfirmasi = `role="dialog"`. Tombol di dalamnya dicari dari situ: namanya sering sama
// dengan tombol pemicunya di baris (mis. "Batalkan").
const inDialog = () => within(screen.getByRole("dialog"));

describe("LeadScreen · jejak keputusan (AC-23/24, US-2)", () => {
  it("shows question, answer, reason and the refs lead actually used", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText(/Pakai kolom baru atau turunkan/)).toBeInTheDocument();
    expect(screen.getByText("Kolom baru.")).toBeInTheDocument();
    expect(screen.getByText(/tak bisa dihitung ulang/)).toBeInTheDocument();
    expect(screen.getByText("ADR-0090")).toBeInTheDocument();
    expect(screen.getByText("internal/docs/architecture/data-model.md")).toBeInTheDocument();
  });
  it("marks a doubtful, weighty refusal so it stands out", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText("berbobot")).toBeInTheDocument();
    expect(screen.getByText("ragu-ragu")).toBeInTheDocument();
    expect(screen.getByText("tindakan ditolak")).toBeInTheDocument();
  });
  // AC-3 · sesi yang sedang DISUSUN keputusannya tak boleh terbaca sebagai sesi mandek.
  it("separates 'sedang diputuskan' from plain 'menunggu kamu'", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText("Sedang diputuskan")).toBeInTheDocument();
    expect(screen.getByText("Menunggu kamu")).toBeInTheDocument();
  });

  // SPEC-479 (QA) · keadaan KETIGA. Di pane, "menunggu manusia", "sedang diputuskan", dan
  // "menunggu giliran" terlihat persis sama — marker terisi, agen diam — tapi hanya yang pertama
  // butuh manusia. Batas konkurensi yang tak terlihat terbaca sebagai "lead diam", dan salah baca
  // itulah yang melahirkan tiket ini.
  it("membedakan sesi yang mengantre slot dari sesi yang menunggu manusia", async () => {
    getLeadStatus.mockResolvedValue({
      ...STATUS,
      deciding: ["spec-9"], queued: ["spec-8"], waiting: ["spec-9", "spec-8"],
      gate: { inFlight: 1, queued: 1, capacity: 2 },
    });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText("Sedang diputuskan")).toBeInTheDocument();
    expect(screen.getByText("Antre giliran")).toBeInTheDocument();
    expect(screen.queryByText("Menunggu kamu")).not.toBeInTheDocument();
  });

  it("menyebut batas konkurensi saat gerbangnya sedang mengikat", async () => {
    getLeadStatus.mockResolvedValue({
      ...STATUS, deciding: ["spec-9"], queued: ["spec-8"],
      gate: { inFlight: 2, queued: 3, capacity: 2 },
    });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByText(/2 dari 2 sedang diputuskan, 3 menunggu giliran/)).toBeInTheDocument();
  });

  // Audit 1G · "Menunggu kamu" paling atas halaman, sebelum kendali (Fase 3F: kolom utama vs samping).
  it("'Menunggu kamu' paling atas halaman, sebelum kartu kendali", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    await screen.findByText(/Pakai kolom baru atau turunkan/);
    const body = document.body.textContent ?? "";
    expect(body.indexOf("Menunggu kamu (")).toBeLessThan(body.indexOf("Kendali"));
  });

  // Audit UI/UX 2026-10 · axe (heading-order): judul bagian berlevel 2 di bawah h1 shell, bukan h3 yatim.
  it("judul bagian Menunggu kamu, Riwayat, dan Kendali berlevel 2", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    await screen.findByText(/Pakai kolom baru atau turunkan/);
    expect(screen.getByRole("heading", { level: 2, name: /^Menunggu kamu/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Riwayat" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Kendali" })).toBeInTheDocument();
  });

  // Audit 1G · sesi di "Menunggu kamu" tampil dengan project & spec, bukan ID sesi mentah.
  it("sesi menunggu tampil dengan nama project dan spec dari jejak keputusan", async () => {
    getLeadStatus.mockResolvedValue({ ...STATUS, deciding: [], queued: [], waiting: ["spec-1"] });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    // Nama itu muncul di baris "Menunggu kamu" DAN di footer jejak keputusan: cukup ada, dan ID mentah tak.
    expect((await screen.findAllByText("Alpha · SPEC-1")).length).toBeGreaterThan(0);
    expect(screen.queryByText("spec-1")).not.toBeInTheDocument();
  });
});

describe("LeadScreen · kendali manusia (AC-27/28, US-3/4)", () => {
  it("Jeda menulis paused:true lewat endpoint config", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    putLeadConfig.mockResolvedValue(CONFIG);
    renderScreen();
    // Mode lead = radio group Aktif/Jeda/Mati (rem global). Rem per project tetap tombol terpisah.
    const btn = await screen.findByRole("radio", { name: /^Jeda/ });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(putLeadConfig).toHaveBeenCalledWith(expect.objectContaining({ paused: true })));
  });

  // Audit 1G · Matikan lead minta konfirmasi dan menyebut efeknya; batal tak menulis apa pun.
  it("Matikan lead minta konfirmasi dulu dan menjelaskan efeknya", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    putLeadConfig.mockResolvedValue(CONFIG);
    renderScreen();
    fireEvent.click(await screen.findByRole("radio", { name: /^Mati/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Matikan lead?");
    expect(inDialog().getByText(/Sesi yang sudah berjalan tidak diubah/)).toBeInTheDocument();
    expect(putLeadConfig).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: "Matikan lead" })); });
    await waitFor(() => expect(putLeadConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
  });

  it("'Ubah jawaban' lalu 'Kirim jawaban' memanggil endpoint override", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    overrideLeadDecision.mockResolvedValue({ old: DECISIONS.items[0], next: DECISIONS.items[0], delivered: true });
    renderScreen();
    const btn = (await screen.findAllByRole("button", { name: /ubah jawaban/i }))[0]!;
    await act(async () => { fireEvent.click(btn); });
    const input = screen.getByLabelText("Jawaban kamu untuk SPEC-1");
    await act(async () => { fireEvent.change(input, { target: { value: "turunkan saja" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /kirim jawaban/i })); });
    // Perubahan jawaban dikonfirmasi dulu; tanda tangannya `(id, answer, reason, choices)`.
    expect(screen.getByRole("dialog")).toHaveTextContent("Ubah jawaban keputusan ini?");
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: "Ubah jawaban" })); });
    await waitFor(() => expect(overrideLeadDecision).toHaveBeenCalledWith("d1", "turunkan saja", "", []));
  });

  // Audit 1G · draft jawaban dikosongkan HANYA setelah API sukses; galat menyisakan ketikan utuh.
  it("draft jawaban tetap utuh bila kirim gagal", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    overrideLeadDecision.mockRejectedValue(new Error("server sibuk"));
    renderScreen();
    fireEvent.click((await screen.findAllByRole("button", { name: /ubah jawaban/i }))[0]!);
    fireEvent.change(screen.getByLabelText("Jawaban kamu untuk SPEC-1"), { target: { value: "jangan hilang" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /kirim jawaban/i })); });
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: "Ubah jawaban" })); });
    await waitFor(() => expect(overrideLeadDecision).toHaveBeenCalled());
    expect(screen.getByLabelText("Jawaban kamu untuk SPEC-1")).toHaveValue("jangan hilang");
  });

  // Audit 1G · membatalkan keputusan minta konfirmasi lebih dulu.
  it("membatalkan keputusan meminta konfirmasi dulu", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    cancelLeadDecision.mockResolvedValue(DECISIONS.items[0]);
    renderScreen();
    const btn = (await screen.findAllByRole("button", { name: /^batalkan$/i }))[0]!;
    await act(async () => { fireEvent.click(btn); });
    expect(screen.getByRole("dialog")).toHaveTextContent("Batalkan keputusan ini?");
    expect(cancelLeadDecision).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: "Batalkan keputusan" })); });
    await waitFor(() => expect(cancelLeadDecision).toHaveBeenCalledWith("d1"));
  });

  it("per-project pause writes the project into pausedProjects (AC-15)", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    putLeadConfig.mockResolvedValue(CONFIG);
    renderScreen();
    const buttons = await screen.findAllByRole("button", { name: /^jeda$/i });
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]!); });
    await waitFor(() => expect(putLeadConfig).toHaveBeenCalledWith(expect.objectContaining({ pausedProjects: ["a"] })));
  });
  it("opting a project out goes through PATCH /projects/:id", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    updateProject.mockResolvedValue({});
    renderScreen();
    const btn = await screen.findByRole("button", { name: /tarik dari lead/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith("a", { leadOptIn: false }));
  });
});

describe("LeadScreen · keadaan kosong", () => {
  it("says so plainly when lead has not decided anything yet", async () => {
    getLeadStatus.mockResolvedValue({ ...STATUS, deciding: [], waiting: [] });
    getLeadDecisions.mockResolvedValue({ items: [] });
    renderScreen();
    expect(await screen.findByText(/Belum ada keputusan/)).toBeInTheDocument();
    expect(screen.getByText(/Tidak ada sesi yang menunggu keputusanmu/)).toBeInTheDocument();
  });
});

// SPEC-480 · ADR-0098 · operator harus bisa membaca "opsi mana yang dipilih" tanpa mengurai prosa
// — persis kemampuan yang dituntut peminta mesin, di permukaan yang dilihat manusia.
describe("LeadScreen · pilihan terstruktur (SPEC-480)", () => {
  const row = (over: Record<string, unknown>) => ({
    ...DECISIONS.items[0], id: "d9",
    choice: null, choiceIndex: null, options: [], missing: [], ...over,
  });

  it("shows which option was chosen, out of how many", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: [row({
      choice: "Node 22", choiceIndex: 2, options: ["Node 20 LTS", "Node 22"],
    })] });
    renderScreen();
    expect(await screen.findByText("opsi 2 dari 2")).toBeInTheDocument();
    expect(screen.getByText("Node 22")).toBeInTheDocument();
  });

  it("shows what lead said was missing", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: [row({ missing: ["versi Node produksi"] })] });
    renderScreen();
    expect(await screen.findByText("kurang konteks")).toBeInTheDocument();
    expect(screen.getByText(/versi Node produksi/)).toBeInTheDocument();
  });

  // Baris tanpa opsi (jawaban bebas, denyut tanpa menu) tak boleh menumbuhkan badge kosong.
  it("stays quiet when there was no menu at all", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: [row({})] });
    renderScreen();
    expect(await screen.findByText("Kolom baru.")).toBeInTheDocument();
    expect(screen.queryByText(/^opsi \d/)).not.toBeInTheDocument();
    expect(screen.queryByText("kurang konteks")).not.toBeInTheDocument();
  });
});

// SPEC-485 · ADR-0102 · pilihan jamak & rantai di dashboard.
const OPT_ROW = {
  id: "d3", projectId: "a", specId: null, sessionId: "spec-3",
  gate: "contract", kind: "answer", question: "Paket mana?", answer: "beta & gamma",
  reason: "keduanya dipakai.", refs: [], confidence: "tinggi", action: "none",
  status: "berlaku", weighty: false, supersededById: null,
  choice: "beta", choiceIndex: 2, options: ["alpha", "beta", "gamma"], missing: [],
  choices: [{ index: 2, option: "beta" }, { index: 3, option: "gamma" }],
  select: { mode: "multi", min: 1, max: 3 }, flowId: "f1", step: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
};
const flow = (over: Record<string, unknown> = {}) => ({
  id: "f1", projectId: "a", specId: null, sessionId: null, gate: "contract",
  status: "sebagian", title: "Paket mana?", steps: 2, closeReason: null,
  openedAt: "2026-08-01T00:00:00.000Z", closedAt: null, expiresAt: "2026-08-01T01:00:00.000Z",
  ...over,
});

describe("LeadScreen · pilihan jamak & rantai (SPEC-485)", () => {
  const boot = (rows: unknown[], flows: unknown[] = []) => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue({ items: rows });
    getLeadFlows.mockResolvedValue({ items: flows });
  };

  it("menampilkan SEMUA label terpilih, bukan hanya yang pertama", async () => {
    boot([OPT_ROW]);
    renderScreen();
    expect(await screen.findByText(/beta · gamma/)).toBeInTheDocument();
    expect(screen.getByText("2 dari 3 opsi")).toBeInTheDocument();
  });

  it("Ubah jawaban menampilkan CHECKBOX saat pilihannya jamak, dan mengirim semua yang dicentang", async () => {
    boot([OPT_ROW]);
    overrideLeadDecision.mockResolvedValue({ old: OPT_ROW, next: OPT_ROW, delivered: true });
    renderScreen();
    const ubah = (await screen.findAllByRole("button", { name: /ubah jawaban/i }))[0]!;
    await act(async () => { fireEvent.click(ubah); });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(within(screen.getByRole("group", { name: "Pilihan jawaban" })).queryAllByRole("radio")).toHaveLength(0);
    await act(async () => { fireEvent.click(boxes[0]!); });
    await act(async () => { fireEvent.click(boxes[2]!); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /kirim jawaban/i })); });
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: "Ubah jawaban" })); });
    await waitFor(() => expect(overrideLeadDecision)
      .toHaveBeenCalledWith("d3", expect.any(String), "", ["alpha", "gamma"]));
  });

  it("Ubah jawaban menampilkan RADIO saat pilihannya tunggal, dan hanya satu yang bertahan", async () => {
    boot([{ ...OPT_ROW, select: { mode: "single", min: 0, max: 1 },
      choices: [{ index: 2, option: "beta" }] }]);
    overrideLeadDecision.mockResolvedValue({ old: OPT_ROW, next: OPT_ROW, delivered: true });
    renderScreen();
    const ubah = (await screen.findAllByRole("button", { name: /ubah jawaban/i }))[0]!;
    await act(async () => { fireEvent.click(ubah); });
    const radios = within(screen.getByRole("radiogroup", { name: "Pilihan jawaban" })).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    await act(async () => { fireEvent.click(radios[0]!); });
    await act(async () => { fireEvent.click(radios[2]!); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /kirim jawaban/i })); });
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: "Ubah jawaban" })); });
    await waitFor(() => expect(overrideLeadDecision)
      .toHaveBeenCalledWith("d3", expect.any(String), "", ["gamma"]));
  });

  // Audit 1G · pilihan tunggal = radiogroup; panah memindahkan pilihan sekaligus fokus.
  it("pilihan tunggal berupa radiogroup yang bisa digeser dengan panah", async () => {
    boot([{ ...OPT_ROW, select: { mode: "single", min: 0, max: 1 }, choices: [] }]);
    renderScreen();
    fireEvent.click((await screen.findAllByRole("button", { name: /ubah jawaban/i }))[0]!);
    const radios = within(screen.getByRole("radiogroup", { name: "Pilihan jawaban" })).getAllByRole("radio");
    fireEvent.keyDown(radios[0]!, { key: "ArrowDown" });            // panah memilih & memindahkan fokus
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios[1]!, { key: "ArrowUp" });
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
  });

  it("kartu rangkaian merender status & tombol hanya untuk alur yang masih terbuka", async () => {
    boot([], [flow(), flow({ id: "f2", status: "selesai", title: "Versi mana?", closeReason: "submit" })]);
    renderScreen();
    expect(await screen.findByText("Sebagian terjawab")).toBeInTheDocument();
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^kirim rangkaian$/i })).toHaveLength(1);
  });

  // Audit 1G · menutup rangkaian minta konfirmasi lebih dulu (dampaknya disebut di dialog).
  it("Kirim rangkaian minta konfirmasi lalu memanggil endpoint submit", async () => {
    boot([], [flow()]);
    submitLeadFlow.mockResolvedValue(flow({ status: "selesai" }));
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^kirim rangkaian$/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Kirim rangkaian ini?");
    expect(submitLeadFlow).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(inDialog().getByRole("button", { name: /^kirim rangkaian$/i })); });
    await waitFor(() => expect(submitLeadFlow).toHaveBeenCalledWith("f1"));
  });

  // Dashboard bisa lebih baru daripada server yang dilayaninya (paket npm global, ADR-0087).
  it("respons server lama (tanpa `choices`/`select`/`flows`) tak meruntuhkan panel", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    getLeadFlows.mockResolvedValue({});
    renderScreen();
    expect(await screen.findByText(/Pakai kolom baru atau turunkan/)).toBeInTheDocument();
  });

  // Audit 1G · galat memuat rangkaian TAMPIL sebagai galat, bukan "Belum ada rangkaian".
  it("galat memuat rangkaian tampil sebagai galat, bukan daftar kosong", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    getLeadFlows.mockRejectedValueOnce(new Error("404"));
    renderScreen();
    expect(await screen.findByText("Gagal memuat rangkaian keputusan.")).toBeInTheDocument();
    expect(screen.queryByText(/Belum ada rangkaian/)).not.toBeInTheDocument();
  });
});

// SPEC-488 · mesin yang menjalankan lead disetel di Settings → Model sesi, tapi layar INI yang
// dilihat operator saat mengurus lead. Nilainya sudah ada di `config` yang dipoll — menampilkannya
// tak menambah satu permintaan pun.
describe("SPEC-488 · baris mesin lead", () => {
  it("engine mati → menunjuk ke Settings, bukan diam", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    const line = await screen.findByTestId("lead-engine-line");
    expect(line).toHaveTextContent("ikut default global");
    expect(line).toHaveTextContent("Settings");
  });

  it("engine hidup → runtime, model, dan effort tampil apa adanya", async () => {
    getLeadStatus.mockResolvedValue({
      ...STATUS,
      config: { ...CONFIG, engine: { enabled: true, agent: "codex", model: "gpt-5.6-terra", effort: "medium" } },
    });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    const line = await screen.findByTestId("lead-engine-line");
    expect(line).toHaveTextContent("Codex CLI");
    expect(line).toHaveTextContent("gpt-5.6-terra");
    expect(line).toHaveTextContent("medium");
  });

  it("displays Antigravity lead engine with its actual runtime label", async () => {
    getLeadStatus.mockResolvedValue({ ...STATUS, config: { ...CONFIG, engine: { enabled: true, agent: "antigravity", model: "gemini-3.8-flash-high", effort: "high" } } });
    getLeadDecisions.mockResolvedValue(DECISIONS); renderScreen();
    const line = await screen.findByTestId("lead-engine-line");
    expect(line).toHaveTextContent("Antigravity CLI"); expect(line).not.toHaveTextContent("Claude Code");
  });

  // Server lama tak mengirim blok `engine` sama sekali — barisnya harus tetap terbaca, bukan
  // meruntuhkan panel dengan `undefined.enabled` (ADR-0087).
  it("config tanpa blok engine → jatuh ke kalimat warisan", async () => {
    const { engine: _drop, ...noEngine } = CONFIG as Record<string, unknown>;
    getLeadStatus.mockResolvedValue({ ...STATUS, config: noEngine });
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    expect(await screen.findByTestId("lead-engine-line")).toHaveTextContent("ikut default global");
  });
});

// Audit 1G · kolom angka: mengetik tak menyimpan; blur/Enter menyimpan sekali dengan nilai yang dijepit.
describe("LeadScreen · pengaturan (draft + Simpan, Fase 3F)", () => {
  it("mengetik tak menyimpan; Simpan pengaturan menyimpan sekali dengan nilai yang sah", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    putLeadConfig.mockResolvedValue(CONFIG);
    renderScreen();
    const field = await screen.findByLabelText("lead memeriksa tiap (menit)");
    fireEvent.change(field, { target: { value: "" } });
    expect(field).toHaveValue(null);
    expect(field).toBeEnabled();
    fireEvent.change(field, { target: { value: "3" } });
    expect(putLeadConfig).not.toHaveBeenCalled();      // tak ada PUT per ketukan
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Simpan pengaturan" })); });
    await waitFor(() => expect(putLeadConfig).toHaveBeenCalledTimes(1));
    expect(putLeadConfig).toHaveBeenCalledWith(expect.objectContaining({ everyMin: 3 }));
  });

  it("nilai di luar rentang dijepit saat Simpan", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    putLeadConfig.mockResolvedValue(CONFIG);
    renderScreen();
    const field = await screen.findByLabelText("batas waktu keputusan (detik)");
    fireEvent.change(field, { target: { value: "5" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Simpan pengaturan" })); });
    await waitFor(() => expect(putLeadConfig).toHaveBeenCalledWith(expect.objectContaining({ timeoutSec: 10 })));
  });

  it("dikosongkan lalu disimpan tanpa perubahan nilai tak menulis apa pun", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    const field = await screen.findByLabelText("lead memeriksa tiap (menit)");
    fireEvent.change(field, { target: { value: "" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Simpan pengaturan" })); });
    expect(field).toHaveValue(5);                      // kembali ke nilai tersimpan
    expect(putLeadConfig).not.toHaveBeenCalled();
  });

  it("Batal mengembalikan draft ke nilai tersimpan dan tak menulis apa pun", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValue(DECISIONS);
    renderScreen();
    const field = await screen.findByLabelText("lead memeriksa tiap (menit)");
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(field).toHaveValue(5);
    expect(putLeadConfig).not.toHaveBeenCalled();
  });
});

// Audit 1G · ganti penyaring/halaman tak menjatuhkan layar ke loading penuh; draft tetap hidup.
describe("LeadScreen · muat ulang senyap", () => {
  it("ganti penyaring tak menampilkan loading dan draft jawaban tetap ada", async () => {
    getLeadStatus.mockResolvedValue(STATUS);
    getLeadDecisions.mockResolvedValueOnce(DECISIONS);
    renderScreen();
    await screen.findByText(/Pakai kolom baru atau turunkan/);
    fireEvent.click((await screen.findAllByRole("button", { name: /ubah jawaban/i }))[0]!);
    fireEvent.change(screen.getByLabelText("Jawaban kamu untuk SPEC-1"), { target: { value: "draf saya" } });

    let resolveNext: (v: unknown) => void = () => undefined;
    getLeadDecisions.mockReturnValueOnce(new Promise((r) => { resolveNext = r; }));
    fireEvent.click(screen.getByRole("button", { name: /^Project/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "saring project" }), { target: { value: "a" } });
    await waitFor(() => expect(getLeadDecisions.mock.calls.length).toBeGreaterThan(1));

    expect(screen.queryByText(/Memuat/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Jawaban kamu untuk SPEC-1")).toHaveValue("draf saya");
    await act(async () => { resolveNext(DECISIONS); });
  });
});
