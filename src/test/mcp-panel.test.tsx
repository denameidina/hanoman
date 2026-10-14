import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { McpPanel, snippetFor } from "../src/screens/McpPanel";
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

  it("Antigravity memakai JSON global, host instance dan placeholder token", () => {
    render(<McpPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Antigravity" }));
    expect(screen.getByText(/~\/\.gemini\/config\/mcp_config\.json/)).toBeTruthy();
    const config = JSON.parse(screen.getByTestId("mcp-snippet").textContent ?? "");
    expect(config.mcpServers.hanoman).toEqual({
      command: "hanoman",
      args: ["mcp"],
      env: { HANOMAN_HOST: window.location.origin, HANOMAN_AGENT_TOKEN: "hnm_agt_…" },
    });
  });

  it("Antigravity mempertahankan pilihan tingkat tanpa menaikkan capability", () => {
    render(<McpPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Antigravity" }));
    const args = () => JSON.parse(screen.getByTestId("mcp-snippet").textContent ?? "").mcpServers.hanoman.args;
    fireEvent.click(screen.getByRole("button", { name: /baca-saja/i }));
    expect(args()).toEqual(["mcp", "--read-only"]);
    fireEvent.click(screen.getByRole("button", { name: /berbahaya/i }));
    expect(args()).toEqual(["mcp", "--danger"]);
    fireEvent.click(screen.getByRole("button", { name: /berbahaya/i }));
    expect(args()).toEqual(["mcp"]);
  });

  it("panduan Antigravity meminta merge yang menjaga konfigurasi operator", () => {
    render(<McpPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Antigravity" }));
    const guide = screen.getByTestId("antigravity-mcp-guide");
    expect(guide.textContent).toMatch(/hanya entri.*mcpServers.hanoman/);
    expect(guide.textContent).toMatch(/server lain.*field.*root/);
    expect(guide.textContent).toMatch(/JSON rusak.*entri.*berbeda.*rekonsiliasi manual/);
    expect(guide.textContent).toContain("0600");
    expect(guide.textContent).toContain(".agents/mcp_config.json");
    expect(guide.textContent).toMatch(/workspace.*tetap/);
    expect(guide.textContent).toContain("/mcp");
    expect(guide.textContent).toContain("hanoman_about");
  });

  it("snippet Antigravity tetap JSON sah untuk host yang memuat karakter JSON", () => {
    const host = 'https://example.test/path?value="quoted"';
    expect(JSON.parse(snippetFor("antigravity", host, "default")).mcpServers.hanoman.env.HANOMAN_HOST).toBe(host);
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
    expect(screen.getByText(/skema tool versi 2/i)).toBeTruthy();   // naik ke 2 sejak ADR-0182 (tes ini basi di main)
    expect(screen.getByText(/hanya muncul/i)).toBeTruthy();
    expect(screen.queryByText(/tidak tersedia lewat MCP/i)).toBeNull();
  });

  // Anggaran gaya inline (Z3): layout lewat kelas `hn-mcp-*` di integrations.css.
  it("layout lewat kelas: gaya inline tinggal ≤ 2", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../src/screens/McpPanel.tsx"), "utf8");
    expect((src.match(/style=\{\{/g) ?? []).length).toBeLessThanOrEqual(2);
  });
});

// This simulates the documented operator procedure on disposable fixtures, not an application writer.
function applyOperatorFixture(path: string, snippet: string): void {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("manual-reconcile");
  const servers = config.mcpServers ?? {};
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw new Error("manual-reconcile");
  const entry = JSON.parse(snippet).mcpServers.hanoman;
  if (Object.hasOwn(servers, "hanoman") && JSON.stringify(servers.hanoman) !== JSON.stringify(entry)) {
    throw new Error("manual-reconcile");
  }
  writeFileSync(path, JSON.stringify({ ...config, mcpServers: { ...servers, hanoman: entry } }, null, 2));
  chmodSync(path, 0o600);
}

describe("Antigravity operator merge procedure fixtures", () => {
  it("preserves sibling/root fields, secures global permissions and leaves workspace untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-task11-"));
    try {
      const global = join(dir, "global.json");
      const workspace = join(dir, "workspace.json");
      const before = { unknown: { nested: [1, "keep"] }, mcpServers: { other: { command: "operator", unknown: true } } };
      const workspaceBefore = '{"mcpServers":{"workspace":{"serverUrl":"https://example.test"}}}';
      writeFileSync(global, JSON.stringify(before), { mode: 0o644 });
      writeFileSync(workspace, workspaceBefore);
      const snippet = snippetFor("antigravity", "https://example.test", "read-only");
      applyOperatorFixture(global, snippet);
      const after = JSON.parse(readFileSync(global, "utf8"));
      expect(after.unknown).toEqual(before.unknown);
      expect(after.mcpServers.other).toEqual(before.mcpServers.other);
      expect(after.mcpServers.hanoman.args).toEqual(["mcp", "--read-only"]);
      expect(statSync(global).mode & 0o777).toBe(0o600);
      expect(readFileSync(workspace, "utf8")).toBe(workspaceBefore);
      const firstMerge = readFileSync(global, "utf8");
      applyOperatorFixture(global, snippet);
      expect(readFileSync(global, "utf8")).toBe(firstMerge);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["corrupt JSON", "{damaged"],
    ["invalid root", "[]"],
    ["invalid servers", '{"mcpServers":[]}'],
    ["operator collision", '{"mcpServers":{"hanoman":{"command":"operator"}},"keep":true}'],
    ["null operator entry", '{"mcpServers":{"hanoman":null}}'],
  ])("leaves %s byte-for-byte unchanged for manual reconciliation", (_, original) => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-task11-"));
    try {
      const path = join(dir, "global.json");
      writeFileSync(path, original, { mode: 0o600 });
      expect(() => applyOperatorFixture(path, snippetFor("antigravity", "https://example.test", "default"))).toThrow();
      expect(readFileSync(path, "utf8")).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
