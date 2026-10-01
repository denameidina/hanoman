import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "./mcp";

const tool = (name: string) => {
  const t = MCP_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} tak ada`);
  return t;
};

describe("katalog MCP · qa", () => {
  it("tool ke backlog merakit path + body; priority hanya bila disebut", () => {
    expect(tool("hanoman_qa_finding_to_backlog").build({ project: "p1", report: "r1", finding: "f1" }))
      .toEqual({ method: "POST", path: "/projects/p1/qa/reports/r1/findings/f1/backlog", body: {} });
    expect(tool("hanoman_qa_finding_to_backlog").build({ project: "p1", report: "r1", finding: "f1", priority: "rendah" }))
      .toEqual({ method: "POST", path: "/projects/p1/qa/reports/r1/findings/f1/backlog", body: { priority: "rendah" } });
    expect(tool("hanoman_qa_report_to_backlog").build({ project: "p1", report: "r1" }))
      .toEqual({ method: "POST", path: "/projects/p1/qa/reports/r1/backlog", body: {} });
    expect(tool("hanoman_qa_finding_to_backlog").description).toMatch(/IDEMPOTEN/);
    expect(tool("hanoman_qa_finding_to_backlog").description).toMatch(/LOSSY/);
  });

  it("sepuluh tool terdaftar dengan capability qa:read / qa:write sesuai mode", () => {
    const names = MCP_TOOLS.filter((t) => t.name.startsWith("hanoman_qa_")).map((t) => [t.name, t.capability, t.mode]);
    expect(names).toEqual([
      ["hanoman_qa_reports_list", "qa:read", "read"],
      ["hanoman_qa_report_get", "qa:read", "read"],
      ["hanoman_qa_report_create", "qa:write", "write"],
      ["hanoman_qa_report_update", "qa:write", "write"],
      ["hanoman_qa_case_create", "qa:write", "write"],
      ["hanoman_qa_case_update", "qa:write", "write"],
      ["hanoman_qa_finding_create", "qa:write", "write"],
      ["hanoman_qa_finding_update", "qa:write", "write"],
      ["hanoman_qa_finding_to_backlog", "qa:write", "write"],
      ["hanoman_qa_report_to_backlog", "qa:write", "write"],
    ]);
  });

  it("list/get merakit path project + laporan dengan encoding", () => {
    expect(tool("hanoman_qa_reports_list").build({ project: "p 1" })).toEqual({ method: "GET", path: "/projects/p%201/qa/reports" });
    expect(tool("hanoman_qa_report_get").build({ project: "p1", report: "r1" })).toEqual({ method: "GET", path: "/projects/p1/qa/reports/r1" });
  });

  it("create laporan: environment `k=v` per baris/`;` jadi objek; hanya field terisi ikut", () => {
    const r = tool("hanoman_qa_report_create").build({ project: "p1", title: "Smoke", environment: "os=macOS; browser=Chrome\nurl=https://x.id?a=b", tester: "" });
    expect(r).toEqual({
      method: "POST", path: "/projects/p1/qa/reports",
      body: { title: "Smoke", environment: { os: "macOS", browser: "Chrome", url: "https://x.id?a=b" } },
    });
  });

  it("update laporan: status/verdict dikirim apa adanya", () => {
    expect(tool("hanoman_qa_report_update").build({ project: "p1", report: "r1", status: "submitted", verdict: "go" }))
      .toEqual({ method: "PATCH", path: "/projects/p1/qa/reports/r1", body: { status: "submitted", verdict: "go" } });
  });

  it("finding create: steps satu-per-baris dipecah, nomor di awal dibuang", () => {
    const r = tool("hanoman_qa_finding_create").build({
      project: "p1", report: "r1", title: "Tombol mati", severity: "major", priority: "P1",
      steps: "1. buka keranjang\n2) klik bayar\n\n- amati", testCase: "c1",
    });
    expect(r).toEqual({
      method: "POST", path: "/projects/p1/qa/reports/r1/findings",
      body: { title: "Tombol mati", severity: "major", priority: "P1", steps: ["buka keranjang", "klik bayar", "amati"], caseId: "c1" },
    });
  });

  it("finding update: `testCase` KOSONG = lepas tautan (null); tak disebut = biarkan", () => {
    const clear = tool("hanoman_qa_finding_update").build({ project: "p1", report: "r1", finding: "f1", testCase: "" });
    expect(clear).toEqual({ method: "PATCH", path: "/projects/p1/qa/reports/r1/findings/f1", body: { caseId: null } });
    const keep = tool("hanoman_qa_finding_update").build({ project: "p1", report: "r1", finding: "f1", status: "wontfix" });
    expect(keep).toEqual({ method: "PATCH", path: "/projects/p1/qa/reports/r1/findings/f1", body: { status: "wontfix" } });
  });

  it("case create/update merakit body", () => {
    expect(tool("hanoman_qa_case_create").build({ project: "p1", report: "r1", title: "Login", steps: "1. buka", status: "todo" }))
      .toEqual({ method: "POST", path: "/projects/p1/qa/reports/r1/cases", body: { title: "Login", steps: "1. buka", status: "todo" } });
    expect(tool("hanoman_qa_case_update").build({ project: "p1", report: "r1", case: "c1", status: "fail", actual: "diam" }))
      .toEqual({ method: "PATCH", path: "/projects/p1/qa/reports/r1/cases/c1", body: { status: "fail", actual: "diam" } });
  });

  it("deskripsi memperingatkan agen: laporan closed read-only dan severity ≠ prioritas", () => {
    expect(tool("hanoman_qa_report_update").description).toMatch(/closed/);
    expect(tool("hanoman_qa_finding_create").description).toMatch(/severity/i);
  });
});
