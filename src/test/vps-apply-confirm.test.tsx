// SPEC-847 · AC-1..AC-3 untuk apply remediasi VPS — mutasi server produksi, salah satu dari
// empat flow yang diminta issue diuji lewat RTL (batal, konfirmasi, Escape, focus restore,
// klik ganda). Fixture-nya cermin `vps-checklist.test.tsx`; jaga tetap sinkron.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChecklistView, ChecklistItem } from "@hanoman/shared";

const item = (over: Partial<ChecklistItem> & { id: string }): ChecklistItem => ({
  section: "firewall", sectionTitle: "Firewall & Network", level: "Basic", title: over.id,
  mode: "AUDIT", severity: "high", probe: true, remediable: false, appLayer: false,
  status: "unknown", na: false, attested: false, drifted: false,
  actorEmail: null, naReason: null, attestNote: null,
  ...over,
});

const VIEW: ChecklistView = {
  vpsId: "v1", scoreTotal: 42, lastAuditAt: null,
  scoreBySection: { firewall: 0 },
  sections: [
    { id: "firewall", title: "Firewall & Network", icon: "🔥", score: 0, items: [
      item({ id: "fw-b1", title: "Aktifkan UFW", mode: "AUTO", severity: "critical", status: "pass" }),
    ] },
  ],
};

const { vpsChecklist, markNa, attestItem, remediatePreview, remediate, markNaBulk } = vi.hoisted(() => ({
  vpsChecklist: vi.fn(),
  markNa: vi.fn(async () => ({ ok: true })),
  attestItem: vi.fn(async () => ({ ok: true })),
  remediatePreview: vi.fn(async () => ({ steps: [] })),
  remediate: vi.fn(async () => ({ steps: [], audit: null, scoreTotal: 5, scoreBySection: {} })),
  markNaBulk: vi.fn(async () => ({ ok: true, count: 1 })),
}));
vi.mock("../src/api/client", () => ({
  api: { vpsChecklist, markNa, attestItem, remediatePreview, remediate, markNaBulk },
  ApiError: class extends Error {},
}));
import { VpsChecklistModal } from "../src/screens/VpsChecklist";

beforeEach(() => { vpsChecklist.mockResolvedValue(VIEW); remediate.mockClear(); });

// Checklist sendiri hidup di dalam Modal, jadi `role="dialog"` ada DUA saat konfirmasi
// terbuka — yang teratas (terakhir di DOM) adalah ConfirmDialog-nya.
const confirmDialog = () => screen.getAllByRole("dialog").at(-1)!;
const TITLE = "Terapkan 1 item AUTO ke VPS ini?";

// Buka checklist, pilih satu item AUTO, tekan Apply, tunggu dialognya.
async function openApply() {
  render(<VpsChecklistModal vpsId="v1" onClose={() => {}} onToast={() => {}} />);
  await screen.findByTestId("score-total");
  fireEvent.click(screen.getByTestId("section-firewall"));
  fireEvent.click(within(screen.getByTestId("item-fw-b1")).getByRole("checkbox"));
  const trigger = screen.getByRole("button", { name: /^apply/i });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByText(TITLE);
  return trigger;
}

describe("VPS apply remediasi · konfirmasi aplikasi (SPEC-847)", () => {
  it("dialog menyebut jumlah item dan dampaknya sebagai daftar", async () => {
    await openApply();
    const dialog = within(confirmDialog());
    expect(dialog.getByText(TITLE)).toBeTruthy();
    expect(dialog.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Langkahnya idempoten dan anti-lockout.", "Checklist diaudit ulang setelah selesai.",
    ]);
  });

  it("Batal tak memanggil remediate, dan fokus kembali ke tombol pemicu", async () => {
    const trigger = await openApply();
    fireEvent.click(within(confirmDialog()).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(remediate).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("Escape tak memanggil remediate", async () => {
    await openApply();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(remediate).not.toHaveBeenCalled();
  });

  // Fokus TIDAK diuji di jalur konfirmasi: apply yang sukses memanggil `clearSel()`, dan
  // toolbar Apply hanya dirender saat `selected.size > 0` — pemicunya sudah tak ada lagi
  // untuk dikembalikan. Jalur batal di atas yang menguji focus restore.
  it("konfirmasi memanggil remediate tepat sekali walau diklik dua kali", async () => {
    await openApply();
    const ok = within(confirmDialog()).getByRole("button", { name: "Terapkan" });
    fireEvent.click(ok); fireEvent.click(ok);
    await waitFor(() => expect(remediate).toHaveBeenCalledTimes(1));
    expect(remediate).toHaveBeenCalledWith("v1", ["fw-b1"]);
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
  });
});
