import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChecklistView, ChecklistItem } from "@hanoman/shared";

const item = (over: Partial<ChecklistItem> & { id: string }): ChecklistItem => ({
  section: "ssh", sectionTitle: "SSH Hardening", level: "Basic", title: over.id,
  mode: "AUDIT", severity: "high", probe: true, remediable: false, appLayer: false,
  status: "unknown", na: false, attested: false, drifted: false,
  actorEmail: null, naReason: null, attestNote: null,
  ...over,
});

const VIEW: ChecklistView = {
  vpsId: "v1", scoreTotal: 42, lastAuditAt: null,
  scoreBySection: { ssh: 50, firewall: 0 },
  sections: [
    { id: "ssh", title: "SSH Hardening", icon: "🔑", score: 50, items: [
      item({ id: "ssh-b2", title: "Nonaktifkan login root", mode: "AUDIT", severity: "critical", status: "fail" }),
      item({ id: "ssh-b3", title: "Nonaktifkan password login", mode: "AUDIT", severity: "critical", status: "fail", drifted: true }),
      item({ id: "ssh-a1", title: "SSH Certificate Authority", mode: "INFO", level: "Advanced", status: "unknown", probe: false }),
    ] },
    { id: "firewall", title: "Firewall & Network", icon: "🔥", score: 0, items: [
      item({ id: "fw-b1", section: "firewall", sectionTitle: "Firewall & Network", title: "Aktifkan UFW", mode: "AUTO", severity: "critical", status: "pass" }),
    ] },
    { id: "webserver", title: "Web Server Hardening", icon: "🌐", score: 0,
      suggestion: { applicable: false, detail: "tak ada nginx/apache" }, items: [
      item({ id: "ws-b1", section: "webserver", sectionTitle: "Web Server Hardening", title: "Sembunyikan versi", mode: "INFO", appLayer: true, status: "unknown", probe: false }),
    ] },
  ],
};

const { vpsChecklist, markNa, attestItem, remediatePreview, remediate, markNaBulk } = vi.hoisted(() => ({
  vpsChecklist: vi.fn(),
  markNa: vi.fn(async () => ({ ok: true })),
  attestItem: vi.fn(async () => ({ ok: true })),
  remediatePreview: vi.fn(async () => ({ steps: [{ item: "fw-b1", status: "would", detail: "akan" }] })),
  remediate: vi.fn(async () => ({ steps: [{ item: "fw-b1", status: "ok", detail: "" }], audit: null, scoreTotal: 5, scoreBySection: {} })),
  markNaBulk: vi.fn(async () => ({ ok: true, count: 1 })),
}));
vi.mock("../src/api/client", () => ({
  api: { vpsChecklist, markNa, attestItem, remediatePreview, remediate, markNaBulk },
  ApiError: class extends Error {},
}));
import { VpsChecklistModal } from "../src/screens/VpsChecklist";

async function open() {
  render(<VpsChecklistModal vpsId="v1" onClose={() => {}} onToast={() => {}} />);
  await screen.findByTestId("score-total");
}
const expand = (id: string) => fireEvent.click(screen.getByTestId(`section-${id}`));

describe("VpsChecklistModal (SPEC-220/221 · UI modal)", () => {
  beforeEach(() => { vpsChecklist.mockResolvedValue(VIEW); markNa.mockClear(); attestItem.mockClear(); markNaBulk.mockClear(); });

  it("default collapsed: item tersembunyi, header seksi tampil (AC-9)", async () => {
    await open();
    expect(screen.getByTestId("score-total").textContent).toBe("42%");
    expect(screen.getByTestId("section-ssh")).toBeTruthy();
    expect(screen.queryByText("Nonaktifkan login root")).toBeNull();
    expand("ssh"); expand("firewall");
    expect(screen.getByText("Nonaktifkan login root")).toBeTruthy();
    expect(screen.getByText("Aktifkan UFW")).toBeTruthy();
  });

  it("klik header expand lalu collapse", async () => {
    await open();
    expect(screen.queryByTestId("item-ssh-b2")).toBeNull();
    expand("ssh");
    expect(screen.getByTestId("item-ssh-b2")).toBeTruthy();
    expand("ssh");
    expect(screen.queryByTestId("item-ssh-b2")).toBeNull();
  });

  it("header collapsed menampilkan hitungan status + badge drift", async () => {
    await open();
    const header = screen.getByTestId("section-ssh");
    expect(header.textContent).toMatch(/2 fail/);
    expect(header.textContent).toMatch(/1 unknown/);
    expect(within(header).getByText(/drift/i)).toBeTruthy();
    expect(screen.getByTestId("section-firewall").textContent).toMatch(/semua pass/);
  });

  it("search memfilter + auto-expand; dikosongkan → collapse lagi", async () => {
    await open();
    const box = screen.getByLabelText("cari item");
    fireEvent.change(box, { target: { value: "root" } });
    expect(screen.getByText("Nonaktifkan login root")).toBeTruthy();       // ssh-b2 cocok, auto-expand
    expect(screen.queryByText("Nonaktifkan password login")).toBeNull();   // ssh-b3 tak cocok
    expect(screen.queryByText("Aktifkan UFW")).toBeNull();                 // seksi firewall tak tampil
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.queryByText("Nonaktifkan login root")).toBeNull();       // collapse lagi
  });

  it("filter mode=INFO menyembunyikan non-INFO + auto-expand (AC-12)", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("mode"), { target: { value: "INFO" } });
    expect(screen.getByText("SSH Certificate Authority")).toBeTruthy(); // INFO tampil
    expect(screen.queryByText("Nonaktifkan login root")).toBeNull();    // AUDIT tersembunyi
  });

  it("tombol Attest hanya untuk item INFO (AC-11)", async () => {
    await open(); expand("ssh");
    expect(within(screen.getByTestId("item-ssh-a1")).queryByRole("button", { name: /attest/i })).toBeTruthy();
    expect(within(screen.getByTestId("item-ssh-b2")).queryByRole("button", { name: /attest/i })).toBeNull();
  });

  it("klik N/A memanggil api.markNa (AC-10)", async () => {
    await open(); expand("ssh");
    fireEvent.click(within(screen.getByTestId("item-ssh-b2")).getByRole("button", { name: /^n\/a$/i }));
    await vi.waitFor(() => expect(markNa).toHaveBeenCalledWith("v1", "ssh-b2", true, expect.any(String)));
  });

  it("klik Attest memanggil api.attestItem (AC-11)", async () => {
    await open(); expand("ssh");
    fireEvent.click(within(screen.getByTestId("item-ssh-a1")).getByRole("button", { name: /attest/i }));
    await vi.waitFor(() => expect(attestItem).toHaveBeenCalledWith("v1", "ssh-a1"));
  });

  it("hanya item AUTO punya checkbox seleksi (AC-13)", async () => {
    await open(); expand("ssh"); expand("firewall");
    expect(within(screen.getByTestId("item-fw-b1")).queryByRole("checkbox")).toBeTruthy();
    expect(within(screen.getByTestId("item-ssh-b2")).queryByRole("checkbox")).toBeNull();
    expect(within(screen.getByTestId("item-ssh-a1")).queryByRole("checkbox")).toBeNull();
  });

  it("pilih AUTO → Preview memanggil api.remediatePreview + tampil would (AC-13)", async () => {
    await open(); expand("firewall");
    fireEvent.click(within(screen.getByTestId("item-fw-b1")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    await vi.waitFor(() => expect(remediatePreview).toHaveBeenCalledWith("v1", ["fw-b1"]));
    expect(within(await screen.findByTestId("remediate-preview")).getByText(/fw-b1/)).toBeTruthy();
  });

  it("Apply memanggil api.remediate (AC-14)", async () => {
    await open(); expand("firewall");
    fireEvent.click(within(screen.getByTestId("item-fw-b1")).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^apply/i }));
    // SPEC-847 · konfirmasi kini dialog aplikasi, bukan window.confirm yang di-mock.
    fireEvent.click(await screen.findByRole("button", { name: "Terapkan" }));
    await vi.waitFor(() => expect(remediate).toHaveBeenCalledWith("v1", ["fw-b1"]));
  });

  it("item drifted → badge drift di baris + ringkasan header (AC-19)", async () => {
    await open();
    expect(screen.getByTestId("drift-summary").textContent).toMatch(/1 item/);
    expand("ssh");
    expect(within(screen.getByTestId("item-ssh-b3")).getByText(/drift/i)).toBeTruthy();
  });

  it("seksi app-layer stack absent → banner saran + Tandai seksi N/A memanggil markNaBulk", async () => {
    await open(); expand("webserver");
    const banner = screen.getByTestId("suggestion-webserver");
    fireEvent.click(within(banner).getByRole("button", { name: /tandai seksi n\/a/i }));
    // SPEC-847 · konfirmasi kini dialog aplikasi, bukan window.confirm yang di-mock.
    fireEvent.click(await screen.findByRole("button", { name: "Tandai N/A" }));
    await vi.waitFor(() => expect(markNaBulk).toHaveBeenCalledWith("v1", ["ws-b1"], true, expect.any(String)));
  });

  it("seksi non-app-layer TIDAK menampilkan banner saran", async () => {
    await open(); expand("ssh");
    expect(screen.queryByTestId("suggestion-ssh")).toBeNull();
  });

  // UI 2026-07-18 · detail VPS (bekas side panel) pindah ke dalam modal ini.
  it("menampilkan detail VPS (last audit + health) di header modal", async () => {
    render(<VpsChecklistModal vpsId="v1" vpsName="web-1"
      lastAuditAt="2026-07-17T10:00:00Z" health={{ uptime: "3d", disk: "42%", mem: "1.2G", load: "0.30" }}
      onClose={() => {}} onToast={() => {}} />);
    const detail = await screen.findByTestId("vps-detail");
    expect(detail.textContent).toMatch(/Audit terakhir/);
    expect(detail.textContent).toMatch(/disk 42%/);
    expect(detail.textContent).toMatch(/mem 1\.2G/);
    expect(detail.textContent).toMatch(/load 0\.30/);
  });

  it("detail: 'Belum pernah diaudit' saat lastAuditAt null, tanpa health", async () => {
    render(<VpsChecklistModal vpsId="v1" onClose={() => {}} onToast={() => {}} />);
    const detail = await screen.findByTestId("vps-detail");
    expect(detail.textContent).toMatch(/Belum pernah diaudit/);
    expect(detail.textContent).not.toMatch(/disk/);
  });
});
