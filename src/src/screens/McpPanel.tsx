// SPEC-482 · ADR-0099 · panduan pemasangan MCP siap salin. Ia duduk di tab "Akses AI Agent" karena
// memasang server dan memberi capability adalah SATU pekerjaan manusia — memisahkannya ke tab lain
// berarti setengah pekerjaan itu tak pernah terlihat.
//
// Tabel tool dirender dari `MCP_TOOLS` (@hanoman/shared) — sumber yang sama dengan runtime. Daftar
// capability yang ditulis tangan di panel adalah daftar yang akan basi.
//
// Token di snippet SELALU placeholder `hnm_agt_…`: panel ini memang tak punya aksesnya (server
// hanya menyimpan sha256), dan batasan SPEC-482 melarang token muncul di contoh pemasangan.
import React from "react";
import { MCP_TOOLS, MCP_TOOL_SCHEMA_VERSION } from "@hanoman/shared";
import { Button, Card } from "../ds";

type Client = "claude-code" | "claude-desktop" | "codex" | "cursor";

const CLIENTS: { id: Client; label: string; hint: string }[] = [
  { id: "claude-code", label: "Claude Code", hint: "~/.claude.json — atau jalankan perintah `claude mcp add` di bawah." },
  { id: "claude-desktop", label: "Claude Desktop", hint: "Settings → Developer → Edit Config (claude_desktop_config.json)." },
  { id: "codex", label: "Codex", hint: "~/.codex/config.toml" },
  { id: "cursor", label: "Cursor / Copilot", hint: "~/.cursor/mcp.json atau .vscode/mcp.json di project." },
];

export function snippetFor(client: Client, host: string, readOnly: boolean): string {
  const args = readOnly ? '["mcp", "--read-only"]' : '["mcp"]';
  const json = `{
  "mcpServers": {
    "hanoman": {
      "command": "hanoman",
      "args": ${args},
      "env": {
        "HANOMAN_HOST": "${host}",
        "HANOMAN_AGENT_TOKEN": "hnm_agt_…"
      }
    }
  }
}`;
  if (client === "codex") {
    return `[mcp_servers.hanoman]
command = "hanoman"
args = ${args}
env = { HANOMAN_HOST = "${host}", HANOMAN_AGENT_TOKEN = "hnm_agt_…" }`;
  }
  if (client === "claude-code") {
    return `${json}

# atau, sekali jalan:
claude mcp add hanoman --env HANOMAN_HOST=${host} --env HANOMAN_AGENT_TOKEN=hnm_agt_… -- hanoman mcp${readOnly ? " --read-only" : ""}`;
  }
  if (client === "cursor") return json.replace('"mcpServers"', '"servers"');
  return json;
}

const PRE_STYLE: React.CSSProperties = {
  margin: 0, padding: 12, fontSize: 12, lineHeight: 1.5, overflowX: "auto",
  background: "var(--bone-100)", border: "1px solid var(--ink-200)",
  borderRadius: "var(--radius-sm)", whiteSpace: "pre",
};
const MUTED: React.CSSProperties = { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 10 };
const CELL: React.CSSProperties = { padding: "6px 10px 6px 0", borderBottom: "1px solid var(--ink-100)", verticalAlign: "top", fontSize: 12.5 };

export function McpPanel(): React.ReactElement {
  const [client, setClient] = React.useState<Client>("claude-code");
  const [readOnly, setReadOnly] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const host = typeof window === "undefined" ? "http://localhost:8787" : window.location.origin;
  const snippet = snippetFor(client, host, readOnly);
  const active = CLIENTS.find((c) => c.id === client)!;

  const copy = () => {
    // Klipboard bisa tak tersedia (konteks non-secure): snippet tetap terlihat & bisa diblok manual.
    void navigator.clipboard?.writeText(snippet).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => { /* diamkan */ },
    );
  };

  return (
    <>
      <Card eyebrow="mcp" title="MCP server">
        <div style={MUTED}>
          Agen AI mana pun yang berbicara MCP bisa memakai hanoman lewat <code>hanoman mcp</code> —
          tanpa pembungkus khusus per-klien. Ia memakai <b>agent token yang sama</b> dengan REST dan
          capability yang sama; buat tokennya di kartu di atas, lalu tempel di konfigurasi klien.{" "}
          <b>Skema tool versi {MCP_TOOL_SCHEMA_VERSION}.</b>
        </div>
        <div style={MUTED}>
          Prasyarat: <code>npm i -g hanoman</code> di mesin tempat klien AI-nya jalan. Host di bawah
          diisi otomatis dengan instance ini — <b>agent token diterbitkan per-instance</b>, jadi token
          dari instance lain akan selalu ditolak 401 di sini.
        </div>
        <div style={MUTED}>
          Membuat sesi terminal dan perintah VPS <b>tidak tersedia lewat MCP</b>, begitu pula
          merge/rebase, penghapusan backlog, dan perubahan stage.
        </div>

        <div role="group" aria-label="Klien MCP" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {CLIENTS.map((c) => (
            <Button key={c.id} size="sm" variant={c.id === client ? "primary" : "ghost"} onClick={() => setClient(c.id)}>
              {c.label}
            </Button>
          ))}
          <Button size="sm" variant={readOnly ? "primary" : "ghost"} leftIcon="eye" onClick={() => setReadOnly((v) => !v)}>
            Mode baca-saja
          </Button>
        </div>

        <div style={{ ...MUTED, marginBottom: 8 }}>{active.hint}</div>
        <pre data-testid="mcp-snippet" style={PRE_STYLE}>{snippet}</pre>
        <div style={{ marginTop: 10 }}>
          <Button size="sm" leftIcon="copy" onClick={copy}>{copied ? "Tersalin" : "Salin"}</Button>
        </div>
      </Card>

      <Card eyebrow="tool" title="Tool yang tersedia">
        <div style={MUTED}>
          Centang capability di bawah pada token yang dipakai. Mode baca-saja menyembunyikan seluruh
          tool bertanda <i>tulis</i>.
        </div>
        <div className="hn-local-overflow" style={{ overflowX: "auto" }}>
          <table data-testid="mcp-tools" style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...CELL, textAlign: "left", fontSize: 11.5, color: "var(--text-subtle)" }}>Tool</th>
                <th style={{ ...CELL, textAlign: "left", fontSize: 11.5, color: "var(--text-subtle)" }}>Mode</th>
                <th style={{ ...CELL, textAlign: "left", fontSize: 11.5, color: "var(--text-subtle)" }}>Capability</th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOLS.map((t) => (
                <tr key={t.name}>
                  <td style={CELL}>
                    <code>{t.name}</code>
                    <div style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{t.title}</div>
                  </td>
                  <td style={CELL}>{t.mode === "read" ? "baca" : "tulis"}</td>
                  <td style={CELL}>{t.capability ? <code>{t.capability}</code> : <span style={{ color: "var(--text-subtle)" }}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
