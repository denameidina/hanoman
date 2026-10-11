import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_TOOLS } from "@hanoman/shared";
import { createCaller } from "../src/mcp/client";
import { resolveMcpConfig, type McpConfig } from "../src/mcp/config";
import { resolveTransferPolicy } from "../src/mcp/transfer";

// ADR-0183 · bentuk permintaan baru di klien: multipart dari disk lokal, dan balasan berkas.
let base: string, work: string, tmp: string, cfg: McpConfig;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "hnm-client-")));
  work = join(base, "work"); tmp = join(base, "tmp");
  mkdirSync(work); mkdirSync(tmp);
  cfg = {
    host: "http://h:8787", token: "hnm_agt_secret", level: "danger", maxBytes: 24576, problems: [],
    transfer: resolveTransferPolicy([], {}, { cwd: work, home: join(base, "home"), tmp }).policy,
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tool = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("createCaller · multipart", () => {
  it("merakit FormData dari disk lokal; Content-Type diserahkan ke fetch (boundary), Bearer tetap terpasang", async () => {
    writeFileSync(join(work, "bukti.png"), "PNG!");
    const f = vi.fn(async () => json(201, { added: 1 }));
    const req = tool("hanoman_backlog_attachment_upload").build({ spec: "SPEC-1", filePaths: [join(work, "bukti.png")] })!;
    const r = await createCaller(cfg, f as unknown as typeof fetch)(req, "t");
    expect(r).toEqual({ ok: true, body: { added: 1 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://h:8787/api/specs/SPEC-1/attachments");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer hnm_agt_secret");
    expect(h["Content-Type"]).toBeUndefined();
    const file = (init.body as FormData).get("file") as File;
    expect(file.name).toBe("bukti.png");
    expect(file.type).toBe("image/png");
    expect(await file.text()).toBe("PNG!");
  });

  it("path berbahaya → TIDAK ADA panggilan jaringan; pesan menyebut alasannya", async () => {
    const f = vi.fn(async () => json(201, {}));
    const call = createCaller(cfg, f as unknown as typeof fetch);
    for (const p of ["/etc/passwd", `${work}/../x`, join(work, ".env")]) {
      writeFileSync(join(work, ".env"), "A=1");
      const req = tool("hanoman_session_attachment_upload").build({ session: "s1", filePath: p })!;
      const r = await call(req, "t");
      expect(r.ok, p).toBe(false);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("unggah IDE mengirim dir → overwrite → manifest → berkas, persis urutan kontrak server", async () => {
    writeFileSync(join(work, "a.txt"), "A"); writeFileSync(join(work, "b.txt"), "B");
    const f = vi.fn(async () => json(200, { written: ["x/a.txt", "x/b.txt"], skipped: [] }));
    const req = tool("hanoman_ide_upload").build({
      project: "p1", dir: "x", files: [{ filePath: join(work, "a.txt") }, { filePath: join(work, "b.txt"), path: "sub/b.txt" }],
    })!;
    await createCaller(cfg, f as unknown as typeof fetch)(req, "t");
    const form = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect([...form.keys()]).toEqual(["dir", "overwrite", "manifest", "file", "file"]);
    expect(form.get("manifest")).toBe('["a.txt","sub/b.txt"]');
    expect(((form.getAll("file")[1]) as File).name).toBe("sub/b.txt");
  });

  it("galat server pada unggah tetap lewat penjelas galat biasa (403 → capability)", async () => {
    writeFileSync(join(work, "a.png"), "x");
    const f = vi.fn(async () => json(403, { error: "capability required", need: "backlog:write" }));
    const req = tool("hanoman_backlog_attachment_upload").build({ spec: "SPEC-1", filePaths: [join(work, "a.png")] })!;
    const r = await createCaller(cfg, f as unknown as typeof fetch)(req, "t");
    expect((r as { message: string }).message).toContain("backlog:write");
  });
});

describe("createCaller · unduhan", () => {
  it("2xx berkas → disimpan ke disk lokal, jawabannya path+ukuran+mime (bukan byte)", async () => {
    const f = vi.fn(async () => new Response("ZIPBYTES", {
      status: 200, headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="QA-001.zip"' },
    }));
    const req = tool("hanoman_qa_report_export_file").build({ project: "p1", report: "r1", format: "zip", savePath: join(work, "laporan.zip") })!;
    const r = await createCaller(cfg, f as unknown as typeof fetch)(req, "t");
    if (!r.ok) throw new Error(r.message);
    expect(r.body).toMatchObject({ savedTo: join(work, "laporan.zip"), bytes: 8, mime: "application/zip" });
    expect(readFileSync(join(work, "laporan.zip"), "utf8")).toBe("ZIPBYTES");
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Accept: "*/*" });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("http://h:8787/api/projects/p1/qa/reports/r1/export?format=zip");
  });

  it("404 pada unduhan tidak menulis apa pun dan memakai kalimat galat biasa", async () => {
    const f = vi.fn(async () => json(404, { error: "not found" }));
    const req = tool("hanoman_qa_attachment_download").build({ project: "p1", report: "r1", attachment: "a1", savePath: join(work, "x.png") })!;
    const r = await createCaller(cfg, f as unknown as typeof fetch)(req, "t");
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message).toMatch(/Tidak ditemukan/);
    expect(() => readFileSync(join(work, "x.png"))).toThrow();
  });

  it("template Markdown dikembalikan inline", async () => {
    const f = vi.fn(async () => new Response("# Template", { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } }));
    const r = await createCaller(cfg, f as unknown as typeof fetch)(tool("hanoman_qa_template_md").build({})!, "t");
    expect(r).toMatchObject({ ok: true, body: { content: "# Template", mime: "text/markdown", filename: "qa-template.md" } });
  });

  it("token yang bocor di pesan galat transfer tetap disamarkan", async () => {
    const req = tool("hanoman_qa_attachment_download").build({ project: "p1", report: "r1", attachment: "a1", savePath: join(work, "hnm_agt_secret.png") })!;
    writeFileSync(join(work, "hnm_agt_secret.png"), "x");
    const r = await createCaller(cfg, (async () => new Response("y", { status: 200 })) as unknown as typeof fetch)(req, "t");
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).not.toContain("hnm_agt_secret");
  });

  it("tanpa kebijakan di konfigurasi (pemanggil lama) memakai default aman: cwd + tmp MCP", async () => {
    const { transfer: _drop, ...bare } = cfg;
    const f = vi.fn(async () => new Response("x", { status: 200, headers: { "content-type": "image/png" } }));
    const req = tool("hanoman_qa_attachment_download").build({ project: "p1", report: "r1", attachment: "a1", savePath: "/etc/hosts-baru" })!;
    const r = await createCaller(bare, f as unknown as typeof fetch)(req, "t");
    expect(r.ok).toBe(false);
  });
});

describe("resolveMcpConfig · transfer", () => {
  it("membawa kebijakan transfer; root `/` jadi keluhan konfigurasi", () => {
    const ok = resolveMcpConfig([], { HANOMAN_HOST: "http://h", HANOMAN_AGENT_TOKEN: "t" }, () => null);
    expect(ok.transfer?.roots.length).toBeGreaterThan(0);
    expect(ok.problems).toEqual([]);
    const bad = resolveMcpConfig([], { HANOMAN_HOST: "http://h", HANOMAN_AGENT_TOKEN: "t", HANOMAN_MCP_TRANSFER_DIRS: "/" }, () => null);
    expect(bad.problems.join()).toMatch(/akar filesystem/);
  });
});
