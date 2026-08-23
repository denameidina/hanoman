// SPEC-883 · panel provisioning & lencana komponen. Penutupan dependensi di klien HANYA untuk
// mengunci checkbox; server tetap menghitung ulang lewat resolveComponents.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { VpsProvisionPanel, ComponentBadges, ComponentSummary } from "../src/screens/VpsProvision";
import { api } from "../src/api/client";
import type { ProvisionComponent, VpsView } from "@hanoman/shared";

const VPS = { id: "v1", name: "vps1", host: "203.0.113.10", port: 22, user: "deploy",
  keyPath: null, createdAt: "", lastSeenAt: null, health: null, lastAuditAt: null,
  audit: null, hardened: false } as VpsView;

const CATALOG = [
  { id: "base", label: "Paket dasar", section: "dasar", requires: { lab: [], production: [] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: false },
  { id: "node", label: "Node.js 22 LTS", section: "dasar", requires: { lab: ["base"], production: ["base"] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: false },
  { id: "hanoman", label: "hanoman", section: "hanoman", requires: { lab: ["node"], production: ["node", "podman"] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: false },
  { id: "caddy", label: "Caddy + TLS", section: "ingress", requires: { lab: [], production: [] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: true },
  { id: "podman", label: "Podman", section: "sandbox", requires: { lab: ["base"], production: ["base"] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: false },
  { id: "agent-image", label: "Image agen", section: "sandbox", requires: { lab: [], production: ["podman"] },
    profiles: ["production"], interactiveLogin: false, needsDomain: false },
  { id: "claude", label: "Claude Code CLI", section: "agen", requires: { lab: ["node"], production: ["agent-image"] },
    profiles: ["lab", "production"], interactiveLogin: true, needsDomain: false },
] as ProvisionComponent[];

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, "listVpsComponents").mockResolvedValue({ components: CATALOG });
});

const panel = () =>
  render(<VpsProvisionPanel vps={VPS} onToast={() => {}} onGotoTerminal={() => {}} />);

describe("SPEC-883 · lencana komponen", () => {
  it("belum pernah diprobe → 'belum diperiksa', bukan deretan strip", () => {
    render(<ComponentBadges components={null} checkedAt={null} />);
    expect(screen.getByText(/belum diperiksa/i)).toBeTruthy();
  });

  it("partial ditampilkan sebagai 'belum login', bukan terpasang", () => {
    render(<ComponentBadges checkedAt="2026-08-22T00:00:00.000Z"
      components={{ claude: { status: "partial", detail: "not-logged-in 1.2.3" } }} />);
    expect(screen.getByText(/belum login/i)).toBeTruthy();
  });
});

describe("ringkasan komponen di daftar VPS", () => {
  const PROBED = {
    base: { status: "ok", detail: "git+tmux+curl" },
    node: { status: "ok", detail: "v24.15.0" },
    hanoman: { status: "ok", detail: "0.1.47" },
    claude: { status: "partial", detail: "not-logged-in 1.2.3" },
    gh: { status: "absent", detail: "" },
  } as const;

  it("meringkas yang beres jadi hitungan, dan hanya memunculkan yang bermasalah", () => {
    render(<ComponentSummary components={PROBED} checkedAt="2026-08-22T18:14:31.000Z" />);
    expect(screen.getByText("3/5")).toBeTruthy();
    // Yang ok tak lagi jadi lencana sendiri-sendiri — itulah yang dulu membungkus 8 baris.
    expect(screen.queryByText(/terpasang v24\.15\.0/i)).toBeNull();
    expect(screen.getByText(/claude · belum login/i)).toBeTruthy();
    expect(screen.getByText(/gh · belum ada/i)).toBeTruthy();
    expect(screen.getByText(/diperiksa/i)).toBeTruthy();
  });

  it("belum pernah diprobe → kalimat, bukan meter kosong", () => {
    render(<ComponentSummary components={null} checkedAt={null} />);
    expect(screen.getByText(/belum diperiksa/i)).toBeTruthy();
  });
});

describe("SPEC-883 · panel provisioning", () => {
  it("mencentang hanoman ikut mencentang & mengunci prasyaratnya", async () => {
    panel();
    await waitFor(() => screen.getByRole("checkbox", { name: "hanoman" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "hanoman" }));
    const base = screen.getByRole("checkbox", { name: "Paket dasar" });
    const node = screen.getByRole("checkbox", { name: "Node.js 22 LTS" });
    expect(base.getAttribute("aria-checked")).toBe("true");
    expect(node.getAttribute("aria-checked")).toBe("true");
    expect(base.getAttribute("aria-disabled")).toBe("true");
  });

  it("field domain muncul hanya saat caddy menyala, dan Pratinjau terkunci tanpa isinya", async () => {
    panel();
    await waitFor(() => screen.getByRole("checkbox", { name: "Caddy + TLS" }));
    expect(screen.queryByLabelText(/domain/i)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Caddy + TLS" }));
    expect(screen.getByLabelText(/domain/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /pratinjau/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("profil production menyembunyikan komponen yang tak tersedia di sana", async () => {
    panel();
    await waitFor(() => screen.getByRole("checkbox", { name: "Node.js 22 LTS" }));
    expect(screen.queryByRole("checkbox", { name: "Image agen" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /production/i }));
    expect(screen.getByRole("checkbox", { name: "Image agen" })).toBeTruthy();
  });

  it("Pratinjau menampilkan langkah would", async () => {
    vi.spyOn(api, "provisionPreview").mockResolvedValue({
      steps: [{ item: "base", status: "would", detail: "akan dipasang" }] });
    panel();
    await waitFor(() => screen.getByRole("checkbox", { name: "Paket dasar" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Paket dasar" }));
    fireEvent.click(screen.getByRole("button", { name: /pratinjau/i }));
    await waitFor(() => expect(screen.getByText(/akan dipasang/)).toBeTruthy());
  });

  it("komponen partial menawarkan Login lewat Console", async () => {
    vi.spyOn(api, "probeVps").mockResolvedValue({
      components: [{ id: "claude", status: "partial", detail: "not-logged-in 1.2.3" }],
      checkedAt: "2026-08-22T00:00:00.000Z" });
    panel();
    await waitFor(() => screen.getByRole("button", { name: /periksa/i }));
    fireEvent.click(screen.getByRole("button", { name: /periksa/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /login lewat console/i })).toBeTruthy());
  });
});
