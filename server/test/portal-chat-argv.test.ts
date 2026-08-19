import { describe, it, expect } from "vitest";
import { portalChatArgv, portalChatProcess, PORTAL_CHAT_TOOLS, FLAG_TERLARANG }
  from "../src/services/portal-chat/argv";

const O = { model: "claude-opus-5", effort: "high", systemPrompt: "penjaga", prompt: "halo" };

describe("argv chat portal (SPEC-854 · ADR-0129 huruf E)", () => {
  // Batas runtime dibuktikan dari SISI HANOMAN: apa yang dipasang, dan apa yang tak pernah boleh.
  it("memasang seluruh flag pengunci", () => {
    const a = portalChatArgv(O);
    expect(a).toContain("-p");
    expect(a[a.indexOf("--tools") + 1]).toBe(PORTAL_CHAT_TOOLS);
    expect(a[a.indexOf("--setting-sources") + 1]).toBe("");
    expect(a).toContain("--strict-mcp-config");
    expect(a).toContain("--disable-slash-commands");
    expect(a).toContain("--no-session-persistence");
    expect(a[a.indexOf("--output-format") + 1]).toBe("json");
    expect(a).toContain("--json-schema");
    expect(a[a.indexOf("--system-prompt") + 1]).toBe("penjaga");
  });

  it("tak pernah memasang flag terlarang", () => {
    const a = portalChatArgv(O);
    for (const f of FLAG_TERLARANG) expect(a, f).not.toContain(f);
  });

  it("tool set persis tiga tool baca — tanpa shell, tanpa tulis, tanpa jaringan", () => {
    expect(PORTAL_CHAT_TOOLS.split(",").sort()).toEqual(["Glob", "Grep", "Read"]);
    for (const t of ["Bash", "Write", "Edit", "WebFetch", "WebSearch", "Task", "NotebookEdit"])
      expect(PORTAL_CHAT_TOOLS, t).not.toContain(t);
  });

  // Prompt berisi teks klien, jadi ia bisa saja BERBENTUK flag. Yang menjaganya adalah
  // posisinya: selalu argumen terakhir, dan daerah flag di depannya tak pernah ikut berubah.
  it("prompt adalah argumen TERAKHIR, jadi ia tak pernah terbaca sebagai flag", () => {
    const dasar = portalChatArgv(O).slice(0, -1);
    for (const jahat of ["--dangerously-skip-permissions", "--tools", "--add-dir /etc", "-p"]) {
      const a = portalChatArgv({ ...O, prompt: jahat });
      expect(a.at(-1), jahat).toBe(jahat);
      expect(a.slice(0, -1), jahat).toEqual(dasar);
    }
  });

  // Skema keluaran ikut argv sebagai JSON tertutup — agen tak bisa mengarang field lain.
  it("skema keluaran terpasang dan tertutup", () => {
    const a = portalChatArgv(O);
    const skema = JSON.parse(a[a.indexOf("--json-schema") + 1]!);
    expect(skema.additionalProperties).toBe(false);
    expect(Object.keys(skema.properties).sort())
      .toEqual(["balasan", "keluar_topik", "prd", "prd_siap", "ringkasan"]);
  });

  // Dev tanpa sandbox tetap boleh jalan — penjaganya workspace + tool set, bukan podman.
  it("tanpa sandbox: proses langsung di workspace", () => {
    const p = portalChatProcess({ ...O, workspace: "/tmp/ws" }, { NODE_ENV: "test" });
    expect(p.cwd).toBe("/tmp/ws");
    expect(p.file).toBe("claude");
  });

  // Produksi: fail closed. Boundary OS wajib ada di sana (cermin assertRuntimeBoundary).
  it("produksi tanpa sandbox: MENOLAK jalan", () => {
    expect(() => portalChatProcess({ ...O, workspace: "/tmp/ws" }, { NODE_ENV: "production" }))
      .toThrow(/sandbox/i);
  });

  it("dengan sandbox: workspace dimount read-only", () => {
    const p = portalChatProcess({ ...O, workspace: "/tmp/ws" }, {
      NODE_ENV: "test", HANOMAN_SESSION_SANDBOX: "podman",
      HANOMAN_AGENT_CREDENTIAL_DIR: "/cred", HANOMAN_EGRESS_PROXY: "http://proxy:3128",
    });
    expect(p.file).toBe("podman");
    expect(p.args.join(" ")).toContain("/tmp/ws:/workspace:ro");
    expect(p.args.join(" ")).toContain("--read-only");
  });
});
