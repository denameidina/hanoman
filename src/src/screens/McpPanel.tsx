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
import "./styles/integrations.css";

type Client = "claude-code" | "claude-desktop" | "codex" | "cursor" | "antigravity";

const CLIENTS: { id: Client; label: string; hint: string }[] = [
  { id: "claude-code", label: "Claude Code", hint: "~/.claude.json — atau jalankan perintah `claude mcp add` di bawah." },
  { id: "claude-desktop", label: "Claude Desktop", hint: "Settings → Developer → Edit Config (claude_desktop_config.json)." },
  { id: "antigravity", label: "Antigravity", hint: "~/.gemini/config/mcp_config.json — konfigurasi global MCP." },
  { id: "codex", label: "Codex", hint: "~/.codex/config.toml" },
  { id: "cursor", label: "Cursor / Copilot", hint: "~/.cursor/mcp.json atau .vscode/mcp.json di project." },
];

// ADR-0155 · TIGA tingkat, dan snippet ini disalin bulat-bulat oleh manusia — flag yang tak ikut
// tersalin berarti tingkat yang tak pernah aktif. `default` sengaja tanpa flag apa pun.
export type SnippetLevel = "read-only" | "default" | "danger";
const FLAG: Record<SnippetLevel, string> = { "read-only": "--read-only", default: "", danger: "--danger" };

export function snippetFor(client: Client, host: string, level: SnippetLevel): string {
  const flag = FLAG[level];
  const args = flag ? `["mcp", "${flag}"]` : '["mcp"]';
  const json = `{
  "mcpServers": {
    "hanoman": {
      "command": "hanoman",
      "args": ${args},
      "env": {
        "HANOMAN_HOST": ${JSON.stringify(host)},
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
claude mcp add hanoman --env HANOMAN_HOST=${host} --env HANOMAN_AGENT_TOKEN=hnm_agt_… -- hanoman mcp${flag ? " " + flag : ""}`;
  }
  if (client === "cursor") return json.replace('"mcpServers"', '"servers"');
  return json;
}

export function McpPanel(): React.ReactElement {
  const [client, setClient] = React.useState<Client>("claude-code");
  const [level, setLevel] = React.useState<SnippetLevel>("default");
  const [copied, setCopied] = React.useState(false);
  const host = typeof window === "undefined" ? "http://localhost:8787" : window.location.origin;
  const snippet = snippetFor(client, host, level);
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
        <div className="hn-mcp-muted">
          Agen AI mana pun yang berbicara MCP bisa memakai hanoman lewat <code>hanoman mcp</code> —
          tanpa pembungkus khusus per-klien. Ia memakai <b>agent token yang sama</b> dengan REST dan
          capability yang sama; buat tokennya di kartu di atas, lalu tempel di konfigurasi klien.{" "}
          <b>Skema tool versi {MCP_TOOL_SCHEMA_VERSION}.</b>
        </div>
        <div className="hn-mcp-muted">
          Prasyarat: <code>npm i -g hanoman</code> di mesin tempat klien AI-nya jalan. Host di bawah
          diisi otomatis dengan instance ini — <b>agent token diterbitkan per-instance</b>, jadi token
          dari instance lain akan selalu ditolak 401 di sini.
        </div>
        {/* ADR-0155 · kalimat lama di sini berkata permukaan berbahaya "tidak tersedia lewat MCP".
            Itu sudah tidak benar, dan kalimat yang berbohong lebih buruk daripada tak ada. */}
        <div className="hn-mcp-muted">
          Tool berbahaya — membuka sesi agen di worktree, perintah VPS, merge/rebase, penghapusan
          backlog, perubahan stage — <b>hanya muncul</b> pada tingkat <code>--danger</code>. Tingkat
          itu <b>bukan kontrol keamanan</b>: ia menentukan tool mana yang terlihat, sementara yang
          menahan sungguhan adalah capability berlabel <b>berbahaya</b> yang kamu centang di kartu
          di atas. Sebuah tool bisa terlihat dan tetap menjawab 403.
        </div>

        <div role="group" aria-label="Klien MCP" className="hn-mcp-clients">
          {CLIENTS.map((c) => (
            <Button key={c.id} size="sm" variant={c.id === client ? "primary" : "ghost"} onClick={() => setClient(c.id)}>
              {c.label}
            </Button>
          ))}
          <Button size="sm" variant={level === "read-only" ? "primary" : "ghost"} leftIcon="eye"
            onClick={() => setLevel((v) => (v === "read-only" ? "default" : "read-only"))}>
            Mode baca-saja
          </Button>
          {/* Ketiganya saling meniadakan: snippet yang memuat --read-only DAN --danger sekaligus
              akan menyuruh manusia memasang konfigurasi yang justru dikeluhkan CLI. */}
          <Button size="sm" variant={level === "danger" ? "primary" : "ghost"} leftIcon="alert-triangle"
            onClick={() => setLevel((v) => (v === "danger" ? "default" : "danger"))}>
            Tampilkan tool berbahaya
          </Button>
        </div>

        <div className="hn-mcp-muted hn-mcp-hint">{active.hint}</div>
        {client === "antigravity" && (
          <div data-testid="antigravity-mcp-guide" className="hn-mcp-muted">
            Gabungkan hanya entri <code>mcpServers.hanoman</code> dari contoh ini; pertahankan
            server lain dan field yang tidak dikenal di root. Bila JSON rusak atau entri hanoman
            berbeda sudah ada, lakukan rekonsiliasi manual sebelum menyimpan. Gunakan izin berkas
            <code>0600</code> setelah mengganti placeholder dengan token yang kamu pilih di kartu
            akses agent; pilihan tingkat di sini tidak menambah capability token. Konfigurasi
            workspace <code>.agents/mcp_config.json</code> tetap utuh. Buka sesi Antigravity baru,
            periksa <code>/mcp</code>, lalu panggil <code>hanoman_about</code> untuk memverifikasi
            koneksi.
          </div>
        )}
        <pre data-testid="mcp-snippet" className="hn-mcp-pre">{snippet}</pre>
        <div className="hn-mcp-copy">
          <Button size="sm" leftIcon="copy" onClick={copy}>{copied ? "Tersalin" : "Salin"}</Button>
        </div>
      </Card>

      <Card eyebrow="tool" title="Tool yang tersedia">
        <div className="hn-mcp-muted">
          Centang capability di bawah pada token yang dipakai. Mode baca-saja menyembunyikan seluruh
          tool bertanda <i>tulis</i>.
        </div>
        <div className="hn-local-overflow">
          <table data-testid="mcp-tools" className="hn-mcp-table">
            <thead>
              <tr>
                <th className="hn-mcp-th">Tool</th>
                <th className="hn-mcp-th">Mode</th>
                <th className="hn-mcp-th">Capability</th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOLS.map((t) => (
                <tr key={t.name}>
                  <td className="hn-mcp-td">
                    <code>{t.name}</code>
                    <div className="hn-mcp-sub">{t.title}</div>
                  </td>
                  <td className="hn-mcp-td">{t.mode === "read" ? "baca" : "tulis"}</td>
                  <td className="hn-mcp-td">{t.capability ? <code>{t.capability}</code> : <span className="hn-mcp-dash">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
