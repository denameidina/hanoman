import { describe, expect, it } from "vitest";
import { explainHttpError, explainNetworkError, type ErrorCtx } from "../src/mcp/errors";

const ctx = (over: Partial<ErrorCtx> = {}): ErrorCtx => ({
  host: "http://localhost:8787", hostAlive: true,
  toolName: "hanoman_backlog_search", method: "GET", path: "/specs", ...over,
});

describe("explainNetworkError", () => {
  it("sambungan ditolak → server tak jalan / host salah", () => {
    const msg = explainNetworkError(
      Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
      { host: "http://localhost:8787" },
    );
    expect(msg).toContain("http://localhost:8787");
    expect(msg).toMatch(/belum jalan|tidak diterima/);
    expect(msg).toContain("HANOMAN_HOST");
  });
  it("AggregateError (host ber-A dan AAAA seperti localhost) tetap terbaca ECONNREFUSED", () => {
    // Bentuk NYATA dari `fetch` Node saat `localhost` punya IPv4 & IPv6: sebabnya AggregateError,
    // dan kode aslinya ada di `cause.errors[]`.
    const agg = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new AggregateError([{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }], "")),
    });
    (agg.cause as { errors?: unknown[] }).errors = [{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }];
    expect(explainNetworkError(agg, { host: "http://localhost:8798" })).toMatch(/tidak diterima/);
  });

  it("kegagalan tanpa kode apa pun tetap menyebut HANOMAN_HOST", () => {
    const msg = explainNetworkError(
      Object.assign(new Error("fetch failed"), { cause: new Error("bad port") }),
      { host: "http://localhost:9" },
    );
    expect(msg).toContain("HANOMAN_HOST");
    expect(msg).toContain("bad port");
  });

  it("nama host tak ketemu disebut sebagai salah tulis host", () => {
    const msg = explainNetworkError(
      Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }),
      { host: "https://salah.example" },
    );
    expect(msg).toContain("salah.example");
    expect(msg).toMatch(/tak ditemukan|tidak ditemukan/);
  });
});

describe("explainHttpError", () => {
  it("401 saat host HIDUP → salah instance / master switch, bukan 401 telanjang", () => {
    const msg = explainHttpError(401, { error: "unauthorized" }, ctx({ hostAlive: true }));
    expect(msg).toContain("PER-INSTANCE");
    expect(msg).toContain("Akses AI Agent");
    expect(msg).toContain("http://localhost:8787");
    expect(msg).not.toMatch(/hnm_agt/);
  });

  it("401 saat host TIDAK menjawab health → hostnya yang salah", () => {
    const msg = explainHttpError(401, { error: "unauthorized" }, ctx({ hostAlive: false }));
    expect(msg).toMatch(/tidak menjawab sebagai instance hanoman/);
  });

  it("403 capability menyebut capability PERSIS yang harus ditambahkan manusia", () => {
    const msg = explainHttpError(403, { error: "capability required", need: "backlog:write" }, ctx({ method: "POST" }));
    expect(msg).toContain("backlog:write");
    expect(msg).toContain("Settings");
    expect(msg).toMatch(/MANUSIA/);
  });

  it("403 cookie-only dinyatakan permanen — jangan cari jalan lain", () => {
    const msg = explainHttpError(403, { error: "cookie session required" }, ctx({ path: "/agent-tokens" }));
    expect(msg).toMatch(/tak akan pernah|tidak akan pernah/);
  });

  // ADR-0192 · 403 gerbang self-decision tak membawa `need`; tanpa cabang sendiri ia dibaca sebagai
  // "route cookie-only", yang menyuruh agen berhenti dengan alasan yang SALAH.
  it("403 self-decision dijelaskan sebagai penolakan PEMANGGIL, bukan cookie-only atau capability", () => {
    for (const reason of ["self", "in-session", "launcher"]) {
      const msg = explainHttpError(403, { error: "agen tak boleh memutuskan dialog sesinya sendiri", reason },
        ctx({ method: "POST", path: "/terminal/sessions/s1/dialog/answer" }));
      expect(msg, reason).toContain(reason);
      expect(msg, reason).toMatch(/bukan soal capability/i);
      expect(msg, reason).not.toMatch(/tak akan pernah bisa mengaksesnya/);
    }
  });

  it("400 zod flatten diterjemahkan per-field, bukan objek mentah", () => {
    const msg = explainHttpError(
      400,
      { error: { formErrors: [], fieldErrors: { payload: ["bentuk payload tak cocok dengan source"] } } },
      ctx({ method: "POST", path: "/specs" }),
    );
    expect(msg).toContain("payload");
    expect(msg).toContain("bentuk payload tak cocok dengan source");
    expect(msg).not.toContain("fieldErrors");
  });

  it("400 dengan error string diteruskan apa adanya", () => {
    expect(explainHttpError(400, { error: 'branch "x" tidak ada di repo project' }, ctx()))
      .toContain('branch "x" tidak ada');
  });

  it("404 menyebut apa yang dicari", () => {
    expect(explainHttpError(404, { error: 'project "y" tidak ada' }, ctx({ path: "/projects/y" })))
      .toContain('project "y" tidak ada');
  });

  it("409 pada PATCH backlog menyebut syarat 'belum dimulai'", () => {
    const msg = explainHttpError(
      409,
      { error: "backlog item sudah dimulai — tak bisa diedit" },
      ctx({ method: "PATCH", path: "/specs/SPEC-1", toolName: "hanoman_backlog_update" }),
    );
    expect(msg).toContain("sudah dimulai");
    expect(msg).toContain("editable");
  });

  it("409 pada lead menyuruh kembali menunggu manusia", () => {
    const msg = explainHttpError(409, { error: "lead tak aktif" }, ctx({ method: "POST", path: "/lead/decisions", toolName: "hanoman_lead_ask" }));
    expect(msg).toMatch(/tunggu manusia|menunggu manusia/);
  });

  it("504 pada lead dinyatakan sudah tercatat & boleh diulang", () => {
    expect(explainHttpError(504, {}, ctx({ method: "POST", path: "/lead/decisions", toolName: "hanoman_lead_ask" })))
      .toMatch(/batas waktu/);
  });

  it("503 pada lead menyebut antre & sementara", () => {
    expect(explainHttpError(503, { error: "lead sibuk" }, ctx({ method: "POST", path: "/lead/decisions", toolName: "hanoman_lead_ask" })))
      .toMatch(/antre|penuh/);
  });

  it("status lain menyimpan EKOR body, dibatasi 500 char", () => {
    const msg = explainHttpError(500, "x".repeat(4000) + "SEBAB-SEBENARNYA", ctx());
    expect(msg).toContain("SEBAB-SEBENARNYA");
    expect(msg.length).toBeLessThan(900);
  });
});
