import { describe, expect, it } from "vitest";
import { DOCS_TOOLS } from "./mcp-catalog/docs";

const by = (n: string) => DOCS_TOOLS.find((t) => t.name === n)!;

describe("katalog docs", () => {
  it("12 tool, dua bermode danger", () => {
    expect(DOCS_TOOLS).toHaveLength(12);
    expect(DOCS_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name).sort())
      .toEqual(["hanoman_changelog_delete", "hanoman_docs_delete"]);
  });

  // Jebakan yang sama sudah ada di `hanoman_backlog_doc_read`: encodeURIComponent atas SELURUH
  // path mengubah `/` jadi `%2F` dan route wildcard Fastify tak lagi cocok.
  it("path dokumen di-encode PER SEGMEN, bukan sekaligus", () => {
    expect(by("hanoman_docs_read").build({ project: "p", path: "architecture/a b.md" })?.path)
      .toBe("/projects/p/docs/architecture/a%20b.md");
    expect(by("hanoman_docs_write").build({ project: "p", path: "a/b.md", content: "x" })?.path)
      .toBe("/projects/p/docs/a/b.md");
  });

  it("prds_list bekerja dengan dan tanpa project", () => {
    expect(by("hanoman_prds_list").build({})?.path).toBe("/prds");
    expect(by("hanoman_prds_list").build({ project: "p" })?.path).toBe("/projects/p/prds");
  });

  it("docs_write menuntut isi — menulis berkas kosong tak pernah disengaja", () => {
    expect(by("hanoman_docs_write").inputSchema.required).toContain("content");
    expect(by("hanoman_docs_write").build({ project: "p", path: "a.md", content: "isi" })?.body)
      .toEqual({ content: "isi" });
  });

  it("changelog_create mengikat mode ke field yang menyertainya lewat allOf", () => {
    const t = by("hanoman_changelog_create");
    expect(t.inputSchema.allOf).toHaveLength(3);
    expect(t.build({ project: "p", mode: "commit", fromSha: "aaaa", toSha: "bbbb" })?.body)
      .toEqual({ mode: "commit", fromSha: "aaaa", toSha: "bbbb" });
    // Field milik mode LAIN tak ikut terkirim, meski agen mengirimkannya.
    expect(t.build({ project: "p", mode: "version", toTag: "v1", fromSha: "aaaa" })?.body)
      .toEqual({ mode: "version", toTag: "v1" });
  });

  it("tool baca memakai GET, tool tulis tak pernah GET", () => {
    for (const t of DOCS_TOOLS) {
      if (t.mode === "read") expect(t.sampleMethod, t.name).toBe("GET");
      else expect(t.sampleMethod, t.name).not.toBe("GET");
    }
  });

  it("capability diturunkan dari method — kecuali breakdown, yang bukan permukaan docs", () => {
    for (const t of DOCS_TOOLS) {
      // `breakdown` ada di berkas route docs.ts tapi sub-path-nya tak terdaftar sebagai docs di
      // `capabilityForRoute`, jadi ia jatuh ke `projects:*`. Uji kontrak server menegakkannya.
      if (t.name === "hanoman_breakdown_get") { expect(t.capability).toBe("projects:read"); continue; }
      expect(t.capability, t.name).toBe(t.sampleMethod === "GET" ? "docs:read" : "docs:write");
    }
  });

  it("dua tool danger membuka deskripsinya dengan penandaan", () => {
    for (const t of DOCS_TOOLS.filter((x) => x.mode === "danger"))
      expect(t.description.slice(0, 12), t.name).toMatch(/BERBAHAYA/);
  });

  it("changelog_list meneruskan q & paginasi apa adanya", () => {
    const r = by("hanoman_changelog_list").build({ project: "p", q: "fix", page: 2, limit: 10 });
    expect(r?.query).toEqual({ q: "fix", page: "2", limit: "10" });
  });
});
