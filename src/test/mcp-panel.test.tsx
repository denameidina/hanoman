import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { McpPanel } from "../src/screens/McpPanel";
import { MCP_TOOLS } from "@hanoman/shared";

describe("McpPanel", () => {
  it("menampilkan snippet Claude Code dengan host instance ini dan token PLACEHOLDER", () => {
    render(<McpPanel />);
    const snippet = screen.getByTestId("mcp-snippet").textContent ?? "";
    expect(snippet).toContain('"command": "hanoman"');
    expect(snippet).toContain('"args": ["mcp"]');
    expect(snippet).toContain(window.location.origin);
    expect(snippet).toContain("hnm_agt_…");
    expect(snippet).not.toMatch(/hnm_agt_[0-9a-f]{8}/);
  });

  it("berganti klien mengganti bentuk konfigurasinya", () => {
    render(<McpPanel />);
    fireEvent.click(screen.getByRole("button", { name: /codex/i }));
    const snippet = screen.getByTestId("mcp-snippet").textContent ?? "";
    expect(snippet).toContain("[mcp_servers.hanoman]");
    expect(snippet).toContain('command = "hanoman"');
  });

  // ADR-0155 · TIGA tingkat, dan snippet-nya harus memantulkan pilihan itu apa adanya: manusia
  // menyalin blok ini bulat-bulat, jadi flag yang tak ikut tersalin = tingkat yang tak pernah aktif.
  it("sakelar baca-saja menambahkan --read-only ke snippet", () => {
    render(<McpPanel />);
    expect(screen.getByTestId("mcp-snippet").textContent).not.toContain("--read-only");
    fireEvent.click(screen.getByRole("button", { name: /baca-saja/i }));
    expect(screen.getByTestId("mcp-snippet").textContent).toContain("--read-only");
  });

  it("sakelar berbahaya menambahkan --danger, dan ketiganya saling meniadakan", () => {
    render(<McpPanel />);
    const snip = () => screen.getByTestId("mcp-snippet").textContent ?? "";
    expect(snip()).not.toContain("--danger");

    fireEvent.click(screen.getByRole("button", { name: /berbahaya/i }));
    expect(snip()).toContain("--danger");
    expect(snip()).not.toContain("--read-only");

    // Memilih baca-saja HARUS membuang --danger: snippet yang memuat keduanya menyuruh manusia
    // memasang konfigurasi yang justru dikeluhkan CLI.
    fireEvent.click(screen.getByRole("button", { name: /baca-saja/i }));
    expect(snip()).toContain("--read-only");
    expect(snip()).not.toContain("--danger");
  });

  it("kartu menyatakan --danger BUKAN kontrol keamanan", () => {
    render(<McpPanel />);
    expect(screen.getByText(/bukan kontrol keamanan/i)).toBeTruthy();
  });

  it("tabel tool bersumber dari katalog, bukan daftar tangan", () => {
    render(<McpPanel />);
    const table = screen.getByTestId("mcp-tools");
    for (const t of MCP_TOOLS) expect(within(table).getByText(t.name)).toBeTruthy();
    expect(within(table).getAllByText("backlog:write").length).toBeGreaterThan(0);
  });

  // ADR-0155 · kalimat lama ("tidak tersedia lewat MCP") sudah TIDAK BENAR sejak tool berbahaya
  // lahir. Yang dijaga sekarang adalah kalimat penggantinya, bukan kalimat yang berbohong.
  it("menyebut versi skema tool dan syarat munculnya tool berbahaya", () => {
    render(<McpPanel />);
    expect(screen.getByText(/skema tool versi 1/i)).toBeTruthy();
    expect(screen.getByText(/hanya muncul/i)).toBeTruthy();
    expect(screen.queryByText(/tidak tersedia lewat MCP/i)).toBeNull();
  });
});
