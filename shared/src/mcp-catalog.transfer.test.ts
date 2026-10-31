import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "./agent";
import { MCP_TOOLS, mcpToolsFor } from "./mcp";
import { TRANSFER_TOOLS } from "./mcp-catalog/transfer";

const tool = (name: string) => {
  const t = MCP_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} tak ada`);
  return t;
};

// ADR-0183 · katalog tool untuk route multipart/biner + hapus QA.
describe("katalog MCP · transfer berkas", () => {
  it("sembilan belas tool terdaftar dengan mode & capability yang dijanjikan", () => {
    expect(TRANSFER_TOOLS.map((t) => [t.name, t.mode, t.capability])).toEqual([
      ["hanoman_backlog_attachment_upload", "write", "backlog:write"],
      ["hanoman_backlog_attachment_download", "write", "backlog:read"],
      // ADR-0233 · gambar mockup backlog.
      ["hanoman_backlog_mockup_download", "write", "backlog:read"],
      ["hanoman_ticket_attachment_download", "write", "support:read"],
      ["hanoman_qa_attachment_upload", "write", "qa:write"],
      ["hanoman_qa_attachment_download", "write", "qa:read"],
      ["hanoman_qa_attachment_delete", "danger", "qa:delete"],
      ["hanoman_qa_template_md", "read", "qa:read"],
      ["hanoman_qa_template_xlsx", "write", "qa:read"],
      ["hanoman_qa_report_export_text", "read", "qa:read"],
      ["hanoman_qa_report_export_file", "write", "qa:read"],
      ["hanoman_qa_import", "write", "qa:write"],
      ["hanoman_qa_cases_import", "write", "qa:write"],
      ["hanoman_ide_upload", "write", "ide:write"],
      ["hanoman_ide_archive_download", "write", "ide:read"],
      ["hanoman_session_attachment_upload", "write", "sessions:write"],
      ["hanoman_qa_report_delete", "danger", "qa:delete"],
      ["hanoman_qa_case_delete", "danger", "qa:delete"],
      ["hanoman_qa_finding_delete", "danger", "qa:delete"],
    ]);
  });

  // Mode mengikuti efek di mesin KLIEN: tool yang menulis ke disk lokal tak boleh lolos ke --read-only,
  // sekalipun capability server-nya hanya `:read`. Yang `inline` tak menyentuh disk dan tetap read.
  it("tool yang menulis ke disk klien TIDAK ada di mode baca-saja; yang inline ada", () => {
    const ro = new Set(mcpToolsFor("read-only").map((t) => t.name));
    for (const t of TRANSFER_TOOLS) {
      const req = t.build(sample(t.name));
      if (req?.download?.mode === "file") expect(ro.has(t.name), t.name).toBe(false);
      if (req?.download?.mode === "inline") expect(ro.has(t.name), t.name).toBe(true);
      if (req?.multipart) expect(t.mode, t.name).not.toBe("read");
    }
  });

  it("tak ada tool transfer yang mengembalikan byte: unduhan file/inline, bukan JSON biasa", () => {
    for (const t of TRANSFER_TOOLS.filter((x) => /download|template|export/.test(x.name)))
      expect(t.build(sample(t.name))?.download, t.name).toBeDefined();
  });

  it("capability qa:delete adalah akses danger yang tak diimplikasikan qa:write", () => {
    expect(CAPABILITIES.find((c) => c.id === "qa:delete")).toMatchObject({ domain: "qa", access: "danger" });
    for (const t of TRANSFER_TOOLS.filter((x) => x.capability === "qa:delete")) {
      expect(t.mode, t.name).toBe("danger");
      expect(t.description.slice(0, 12), t.name).toMatch(/BERBAHAYA/);
      expect(t.description, t.name).toMatch(/qa:delete/);
      expect(t.build(sample(t.name))?.method, t.name).toBe("DELETE");
    }
  });

  it("unggah backlog: satu part `file` per path, urutan dijaga", () => {
    expect(tool("hanoman_backlog_attachment_upload").build({ spec: "SPEC-1", filePaths: ["/a/x.png", "/a/y.pdf"] })).toEqual({
      method: "POST", path: "/specs/SPEC-1/attachments",
      multipart: { files: [{ field: "file", filePath: "/a/x.png" }, { field: "file", filePath: "/a/y.pdf" }] },
    });
  });

  it("unggah lampiran QA: ownerType/ownerId di query, berkas di multipart", () => {
    expect(tool("hanoman_qa_attachment_upload").build({
      project: "p 1", report: "r1", ownerType: "finding", ownerId: "f1", filePaths: ["/a/x.png"],
    })).toEqual({
      method: "POST", path: "/projects/p%201/qa/reports/r1/attachments",
      query: { ownerType: "finding", ownerId: "f1" },
      multipart: { files: [{ field: "file", filePath: "/a/x.png" }] },
    });
    expect(tool("hanoman_qa_attachment_upload").inputSchema.properties.ownerType?.enum).toEqual(["report", "case", "finding"]);
  });

  it("impor laporan: berkas utama `file`, pendamping `attachments` (nama field yang dibaca server)", () => {
    expect(tool("hanoman_qa_import").build({ project: "p1", filePath: "/a/r.md", attachmentPaths: ["/a/1.png", "/a/2.png"] })!.multipart).toEqual({
      files: [
        { field: "file", filePath: "/a/r.md" },
        { field: "attachments", filePath: "/a/1.png" },
        { field: "attachments", filePath: "/a/2.png" },
      ],
    });
    expect(tool("hanoman_qa_import").build({ project: "p1", filePath: "/a/r.xlsx" })!.multipart!.files).toHaveLength(1);
  });

  // Kontrak server (ADR-0121): part dibaca berurutan — dir → overwrite → manifest → berkas. Manifest
  // yang tiba SESUDAH berkas ditolak 400, jadi urutan ini harus dikunci.
  it("unggah IDE: field dir → overwrite → manifest dahulu, lalu berkas; manifest = nama tujuan", () => {
    const r = tool("hanoman_ide_upload").build({
      project: "p1", dir: "docs/assets", overwrite: true,
      files: [{ filePath: "/a/b/logo.png" }, { filePath: "/a/c/data.csv", path: "sub/data.csv" }],
    })!;
    expect(r.multipart!.fields).toEqual([
      ["dir", "docs/assets"], ["overwrite", "1"], ["manifest", JSON.stringify(["logo.png", "sub/data.csv"])],
    ]);
    expect(r.multipart!.files).toEqual([
      { field: "file", filePath: "/a/b/logo.png", name: "logo.png" },
      { field: "file", filePath: "/a/c/data.csv", name: "sub/data.csv" },
    ]);
    expect(tool("hanoman_ide_upload").build({ project: "p1", files: [{ filePath: "C:\\x\\y.txt" }] })!.multipart!.fields)
      .toEqual([["dir", ""], ["overwrite", "0"], ["manifest", JSON.stringify(["y.txt"])]]);
  });

  it("unduhan: savePath/overwrite hanya ikut bila disebut; fallbackName tetap terisi", () => {
    expect(tool("hanoman_backlog_attachment_download").build({ spec: "SPEC-1", attachment: "a1" })).toEqual({
      method: "GET", path: "/specs/SPEC-1/attachments/a1", download: { mode: "file", fallbackName: "lampiran" },
    });
    expect(tool("hanoman_backlog_attachment_download").build({ spec: "SPEC-1", attachment: "a1", savePath: "/w/x.png", overwrite: true })!.download)
      .toEqual({ mode: "file", fallbackName: "lampiran", savePath: "/w/x.png", overwrite: true });
    expect(tool("hanoman_qa_template_md").build({})!.download).toEqual({ mode: "inline", fallbackName: "qa-template.md" });
  });

  it("ekspor: teks kecil inline, sisanya berkas; format masuk query", () => {
    expect(tool("hanoman_qa_report_export_text").build({ project: "p1", report: "r1" })).toMatchObject({
      path: "/projects/p1/qa/reports/r1/export", query: { format: "md" }, download: { mode: "inline" },
    });
    expect(tool("hanoman_qa_report_export_text").inputSchema.properties.format?.enum).toEqual(["md", "csv"]);
    expect(tool("hanoman_qa_report_export_file").build({ project: "p1", report: "r1", format: "pdf" })).toMatchObject({
      query: { format: "pdf" }, download: { mode: "file", fallbackName: "laporan-qa.pdf" },
    });
    expect(tool("hanoman_qa_report_export_file").inputSchema.properties.format?.enum).toEqual(["zip", "md", "docx", "pdf", "xlsx", "csv"]);
  });

  it("arsip git: ref hanya bila disebut; format default zip", () => {
    expect(tool("hanoman_ide_archive_download").build({ project: "p1" })).toMatchObject({
      path: "/projects/p1/archive", query: { format: "zip" }, download: { mode: "file", fallbackName: "arsip.zip" },
    });
    expect(tool("hanoman_ide_archive_download").build({ project: "p1", ref: "main", format: "tar" })!.query)
      .toEqual({ ref: "main", format: "tar" });
  });

  it("hapus QA: path persis ke route DELETE", () => {
    expect(tool("hanoman_qa_report_delete").build({ project: "p1", report: "r1" })).toEqual({ method: "DELETE", path: "/projects/p1/qa/reports/r1" });
    expect(tool("hanoman_qa_case_delete").build({ project: "p1", report: "r1", case: "c1" })).toEqual({ method: "DELETE", path: "/projects/p1/qa/reports/r1/cases/c1" });
    expect(tool("hanoman_qa_finding_delete").build({ project: "p1", report: "r1", finding: "f1" })).toEqual({ method: "DELETE", path: "/projects/p1/qa/reports/r1/findings/f1" });
    expect(tool("hanoman_qa_attachment_delete").build({ project: "p1", report: "r1", attachment: "a1" })).toEqual({ method: "DELETE", path: "/projects/p1/qa/reports/r1/attachments/a1" });
  });

  it("tool danger transfer hanya muncul di tingkat danger", () => {
    const def = new Set(mcpToolsFor("default").map((t) => t.name));
    const dg = new Set(mcpToolsFor("danger").map((t) => t.name));
    for (const t of TRANSFER_TOOLS.filter((x) => x.mode === "danger")) {
      expect(def.has(t.name), t.name).toBe(false);
      expect(dg.has(t.name), t.name).toBe(true);
    }
  });

  it("argumen path lokal wajib dan skema melarang properti liar", () => {
    for (const t of TRANSFER_TOOLS) expect(t.inputSchema.additionalProperties, t.name).toBe(false);
    expect(tool("hanoman_session_attachment_upload").inputSchema.required).toEqual(["session", "filePath"]);
    expect(tool("hanoman_backlog_attachment_upload").inputSchema.properties.filePaths).toMatchObject({ minItems: 1, maxItems: 10 });
  });
});

/** Argumen minimal sah untuk tiap tool — cukup agar build() menghasilkan permintaan. */
function sample(name: string): Record<string, unknown> {
  return {
    spec: "SPEC-1", attachment: "a1", ticket: "t1", project: "p1", report: "r1", case: "c1", finding: "f1",
    session: "s1", ownerType: "report", ownerId: "r1", filePath: "/a/x", filePaths: ["/a/x"],
    files: [{ filePath: "/a/x" }], attachmentPaths: [], format: name.includes("export_text") ? "md" : undefined,
  };
}
