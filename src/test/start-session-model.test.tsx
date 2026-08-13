import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

// SPEC-252 · ADR-0061 — picker model & effort per SESI saat Start (default = setting global).
vi.mock("../src/api/client", () => ({
  api: {
    // SPEC-739 · kedua permukaan ini kini ikut menanyakan kesiapan skill metode; dijawab
    // KOSONG di sini karena checklist & catatannya punya berkas test sendiri.
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), startSession: vi.fn(), getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

const spec = { id: "SPEC-9", source: "qa", projectId: "p1" } as any;

beforeEach(() => {
  // SPEC-332 · ADR-0073 · response /settings selalu membawa blok goal (zod default).
  (api.getSettings as any).mockResolvedValue({ model: "claude-opus-5", effort: "xhigh", goal: { enabled: false, condition: "" } });
  (api.startSession as any).mockResolvedValue({ id: "spec-9" });
});

describe("StartSessionModal (SPEC-252)", () => {
  it("prefill dari setting global lalu mengirim model/effort terpilih ke startSession", async () => {
    const onStarted = vi.fn();
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={onStarted} />);
    // prefill: model & effort global tampil di picker
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    expect(screen.getByLabelText("Effort")).toHaveValue("xhigh");
    // operator memilih model berbeda untuk sesi ini
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "claude-sonnet-5" } });
    fireEvent.click(screen.getByRole("button", { name: /Mulai/i }));
    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith(
      // SPEC-338 · payload kini juga membawa agen sesi; tanpa pilihan lain ia "claude".
      // SPEC-376 · dan scope verifikasi; tanpa pilihan lain ia "changed" (default global).
      // SPEC-734 · dan metode workflow; tanpa pilihan lain ia "superpowers" (DEFAULT_METHOD).
      { spec: "SPEC-9", flow: "qa", model: "claude-sonnet-5", effort: "xhigh", agent: "claude",
        goal: false, goalCondition: undefined, verifyScope: "changed", method: "superpowers" }));
    // SPEC-394 · onStarted kini juga menerima `resumed`; respons ini sesi baru, jadi undefined.
    expect(onStarted).toHaveBeenCalledWith("spec-9", undefined);
  });

  it("tak merender apa pun bila spec null", () => {
    const { container } = render(<StartSessionModal open spec={null} onClose={() => {}} onStarted={() => {}} />);
    expect(container.textContent).toBe("");
  });
});
