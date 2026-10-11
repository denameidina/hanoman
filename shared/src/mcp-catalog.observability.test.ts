// ADR-0187/0188/0189 · katalog observabilitas mesin, log aktivitas, dan chat portal operator.
// Yang diuji: bentuk permintaan yang dirakit build(), bentuk balasan yang dipadatkan shape() —
// terutama NDJSON ekspor, yang datang dalam TIGA bentuk berbeda dari klien MCP — dan janji capability.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS, mcpToolsFor } from "./mcp";

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("katalog observabilitas mesin (ADR-0187)", () => {
  it("keempat tool tak menuntut capability dan semuanya baca-saja", () => {
    for (const n of ["hanoman_health", "hanoman_models", "hanoman_codex_version", "hanoman_methods_status"]) {
      expect(byName(n).capability, n).toBeNull();
      expect(byName(n).mode, n).toBe("read");
    }
  });

  it("hanoman_health benar-benar memanggil /health (beda dari about yang build() = null)", () => {
    expect(byName("hanoman_health").build({})).toEqual({ method: "GET", path: "/health" });
    expect(byName("hanoman_about").build({})).toBeNull();
  });

  it("hanoman_models menyaring satu penyedia bila diminta, dan menjaga status probe-nya", () => {
    const raw = {
      claude: [{ id: "c1" }], codex: [{ id: "x1" }],
      providers: { claude: { source: "cli" }, codex: { source: "cache" } },
    };
    const t = byName("hanoman_models");
    expect(t.shape(raw, {})).toEqual(raw);
    expect(t.shape(raw, { agent: "codex" })).toEqual({ codex: [{ id: "x1" }], providers: { codex: { source: "cache" } } });
  });
});

describe("katalog log aktivitas (ADR-0188)", () => {
  it("baca → activity:read, purge → activity:write dan hanya di tingkat danger", () => {
    expect(byName("hanoman_activity_list").capability).toBe("activity:read");
    const purge = byName("hanoman_activity_purge");
    expect(purge.capability).toBe("activity:write");
    expect(purge.mode).toBe("danger");
    expect(mcpToolsFor("default").map((t) => t.name)).not.toContain("hanoman_activity_purge");
    expect(mcpToolsFor("default").map((t) => t.name)).toContain("hanoman_activity_list");
  });

  it("purge memetakan project→projectId dan before; yang tak diisi TAK ikut", () => {
    const t = byName("hanoman_activity_purge");
    expect(t.build({ project: "p1", before: "2026-06-01T00:00:00Z" })).toEqual({
      method: "DELETE", path: "/session-results", query: { projectId: "p1", before: "2026-06-01T00:00:00Z" },
    });
    expect(t.build({ before: "2026-06-01" })!.query).toEqual({ before: "2026-06-01" });
  });

  it("daftar meminta satu baris LEBIH dari halaman, dan hasilnya menandai kelanjutan dengan jujur", () => {
    const t = byName("hanoman_activity_list");
    expect(t.build({ project: "p1", page: 2, limit: 3 })!.query).toEqual({ projectId: "p1", limit: "7" });
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` }));
    const p2 = t.shape(rows, { page: 2, limit: 3 }) as { items: { id: string }[]; hasMore: boolean };
    expect(p2.items.map((r) => r.id)).toEqual(["r3", "r4", "r5"]);
    expect(p2.hasMore).toBe(true);
    const last = t.shape(rows.slice(0, 6), { page: 2, limit: 3 }) as { hasMore: boolean };
    expect(last.hasMore).toBe(false);
    // Plafon server 1000 baris: halaman jauh tak boleh meminta lebih dari itu.
    expect(t.build({ page: 100, limit: 100 })!.query?.limit).toBe("1000");
  });
});

describe("katalog chat portal operator (ADR-0189)", () => {
  it("capability: baca → portal-chat:read, tulis PRD → portal-chat:write; export & tulis hanya danger", () => {
    expect(byName("hanoman_portal_chat_sessions").capability).toBe("portal-chat:read");
    expect(byName("hanoman_portal_chat_session_get").capability).toBe("portal-chat:read");
    expect(byName("hanoman_portal_chat_export").capability).toBe("portal-chat:read");
    expect(byName("hanoman_portal_chat_prd_write").capability).toBe("portal-chat:write");
    const def = new Set(mcpToolsFor("default").map((t) => t.name));
    expect(def.has("hanoman_portal_chat_sessions")).toBe(true);
    expect(def.has("hanoman_portal_chat_export")).toBe(false);
    expect(def.has("hanoman_portal_chat_prd_write")).toBe(false);
  });

  it("daftar sesi SELALU mengirim limit — tanpanya server mengembalikan seluruh sesi", () => {
    const t = byName("hanoman_portal_chat_sessions");
    expect(t.build({ project: "p1" })!.query).toEqual({ project: "p1", limit: "20" });
    expect(t.build({ project: "p1", page: 3, limit: 5 })!.query).toEqual({ project: "p1", page: "3", limit: "5" });
  });

  it("tulis PRD merakit path ter-encode dan body {slug}", () => {
    expect(byName("hanoman_portal_chat_prd_write").build({ session: "a/b", slug: "fitur-x" })).toEqual({
      method: "POST", path: "/portal-chat/sessions/a%2Fb/prd", body: { slug: "fitur-x" },
    });
  });

  const sess = (id: string, extra: Record<string, unknown> = {}) => ({
    id, projectId: "p1", type: "brainstorm", summary: "s".repeat(500), periodKey: "2026-10",
    prdSiap: true, prdDocPath: null, prdReadyAt: null, clientEmail: "klien@x.co",
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    prdMarkdown: "# PRD\n" + "x".repeat(100),
    messages: [
      { id: "m1", seq: 1, role: "klien", text: "halo " + "y".repeat(3000), rawText: null, blocked: false, blockReasons: null, createdAt: "t" },
      { id: "m2", seq: 2, role: "hanoman", text: "ditolak", rawText: "teks mentah " + "z".repeat(3000), blocked: true, blockReasons: ["project-lain"], createdAt: "t" },
    ],
    ...extra,
  });

  it("detail sesi: pesan jadi `items` terpaginasi, teks dipotong, rawText hanya untuk yang tertolak", () => {
    const out = byName("hanoman_portal_chat_session_get").shape(sess("s1"), {}) as Record<string, unknown>;
    expect(out.clientEmail).toBe("klien@x.co");
    expect(out.prdChars).toBe(106);
    const items = out.items as Record<string, unknown>[];
    expect(items.map((m) => m.seq)).toEqual([1, 2]);
    expect((items[0]!.text as string).length).toBeLessThan(2100);
    expect("rawText" in items[0]!).toBe(false);
    expect((items[1]!.rawText as string).length).toBeLessThan(1100);
    expect(out.total).toBe(2);
    expect((out.summary as string).length).toBeLessThan(320);
  });

  describe("ekspor NDJSON — tiga bentuk yang bisa diserahkan klien MCP", () => {
    const t = byName("hanoman_portal_chat_export");
    const ndjson = `${JSON.stringify(sess("s1"))}\n${JSON.stringify(sess("s2"))}\n`;

    it("banyak baris → string: tiap sesi dipadatkan, PRD jadi prdChars, rawText hilang", () => {
      const out = t.shape(ndjson, {}) as { items: Record<string, unknown>[]; total: number; pageSize: number };
      expect(out.total).toBe(2);
      expect(out.pageSize).toBe(5);
      const s1 = out.items[0]!;
      expect(s1.messageCount).toBe(2);
      expect("prdMarkdown" in s1).toBe(false);
      expect(s1.prdChars).toBe(106);
      const msgs = s1.messages as Record<string, unknown>[];
      expect(msgs.every((m) => !("rawText" in m))).toBe(true);
      expect((msgs[0]!.text as string).length).toBeLessThan(900);
    });

    it("satu baris lolos JSON.parse di klien → datang sebagai OBJEK, bukan string", () => {
      const out = t.shape(sess("only"), {}) as { items: { id: string }[]; total: number };
      expect(out.total).toBe(1);
      expect(out.items[0]!.id).toBe("only");
    });

    it("nol sesi → null atau string kosong menjadi halaman kosong, bukan galat", () => {
      for (const raw of [null, "", undefined]) {
        const out = t.shape(raw, {}) as { items: unknown[]; total: number };
        expect(out.items).toEqual([]);
        expect(out.total).toBe(0);
      }
    });

    it("baris cacat dilewati, yang sah tetap terbaca; halaman ikut `page`/`limit`", () => {
      const raw = `${JSON.stringify(sess("a"))}\n{rusak\n${JSON.stringify(sess("b"))}\n`;
      const out = t.shape(raw, { page: 2, limit: 1 }) as { items: { id: string }[]; total: number };
      expect(out.total).toBe(2);
      expect(out.items.map((s) => s.id)).toEqual(["b"]);
    });

    it("rentang tanggal diteruskan sebagai query, yang kosong tidak", () => {
      expect(t.build({ project: "p1", from: "2026-10-01" })!.query).toEqual({ project: "p1", from: "2026-10-01" });
    });
  });
});
