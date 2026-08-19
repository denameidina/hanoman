import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { TEKS_TETAP } from "@hanoman/shared";

const execMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()), execFile: execMock,
}));

import { runTurn } from "../src/services/portal-chat/turn";

type Cb = (err: unknown, stdout: string, stderr: string) => void;

const balas = (stdout: string) =>
  execMock.mockImplementation((_f: string, _a: string[], _o: unknown, cb: Cb) => {
    cb(null, stdout, "");
    return { stdin: { end: () => {} } };
  });

const jawab = (obj: unknown, denials: unknown[] = []) =>
  balas(JSON.stringify({ structured_output: obj, permission_denials: denials }));

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(async () => {
  execMock.mockReset(); await clean();
  await prisma.project.create({ data: { id: "p1", name: "Toko Mekar", desc: "toko", kind: "existing" } });
  await prisma.project.create({ data: { id: "p2", name: "Klinik Sehat", desc: "x", kind: "existing" } });
});
afterAll(clean);

const OPS = { projectId: "p1", type: "tanya" as const, history: [], message: "kapan selesai?",
  model: "claude-opus-5", effort: "high", timeoutSec: 30 };

describe("satu giliran chat portal (SPEC-854)", () => {
  it("balasan awam diteruskan apa adanya + ringkasan tersimpan", async () => {
    jawab({ balasan: "Fitur keranjang ditargetkan bulan ini.", keluar_topik: false,
      prd_siap: false, prd: null, ringkasan: "tanya jadwal" });
    const r = await runTurn(OPS);
    expect(r.blocked).toBe(false);
    expect(r.reply).toContain("keranjang");
    expect(r.summary).toBe("tanya jadwal");
  });

  // Teks penolakan dikarang SERVER — pesan yang disusupi tak bisa mengarang penolakannya sendiri.
  it("keluar topik dijawab kalimat karangan server", async () => {
    jawab({ balasan: "Tentu! Ini resep rendang: ...", keluar_topik: true,
      prd_siap: false, prd: null, ringkasan: "" });
    expect((await runTurn(OPS)).reply).toBe(TEKS_TETAP.keluarTopik);
  });

  it("balasan yang bocor diblokir; mentahnya disimpan untuk operator", async () => {
    jawab({ balasan: "Di Klinik Sehat sudah selesai.", keluar_topik: false,
      prd_siap: false, prd: null, ringkasan: "" });
    const r = await runTurn(OPS);
    expect(r.blocked).toBe(true);
    expect(r.reply).toBe(TEKS_TETAP.diblokir);
    expect(r.raw).toContain("Klinik Sehat");
    expect(r.reasons).toContain("project-lain");
  });

  it("PRD hanya dihormati untuk sesi brainstorm", async () => {
    jawab({ balasan: "ok", keluar_topik: false, prd_siap: true, prd: "# PRD", ringkasan: "" });
    expect((await runTurn(OPS)).prd).toBeNull();
    expect((await runTurn({ ...OPS, type: "brainstorm" })).prd).toBe("# PRD");
  });

  it("agen gagal → kalimat sopan, bukan jejak galat", async () => {
    execMock.mockImplementation((_f: string, _a: string[], _o: unknown, cb: Cb) => {
      cb(Object.assign(new Error("Command failed: claude"), { code: 1 }), "", "boom");
      return { stdin: { end: () => {} } };
    });
    const r = await runTurn(OPS);
    expect(r.reply).toBe(TEKS_TETAP.gagal);
    expect(r.blocked).toBe(true);
    expect(r.reply).not.toMatch(/claude|boom|Command failed/);
  });

  it("keluaran yang bukan JSON sah → kalimat sopan", async () => {
    balas("bukan json");
    expect((await runTurn(OPS)).reply).toBe(TEKS_TETAP.gagal);
  });

  it("keluaran JSON tapi bentuknya asing → kalimat sopan", async () => {
    balas(JSON.stringify({ structured_output: { balasan: "cuma ini" } }));
    expect((await runTurn(OPS)).reply).toBe(TEKS_TETAP.gagal);
  });

  // Percobaan keluar workspace tercatat — supaya operator bisa melihatnya, bukan menebaknya.
  it("percobaan keluar workspace ikut dicatat", async () => {
    jawab({ balasan: "Saya tidak bisa membaca itu.", keluar_topik: false,
      prd_siap: false, prd: null, ringkasan: "" },
      [{ tool_name: "Read", tool_input: { file_path: "/etc/passwd" } }]);
    expect((await runTurn(OPS)).escapeAttempts).toBe(1);
  });

  // Agen dipanggil DI DALAM workspace dokumen, tanpa satu pun flag bypass.
  it("proses lahir di workspace dengan tool set terkunci", async () => {
    jawab({ balasan: "ok", keluar_topik: false, prd_siap: false, prd: null, ringkasan: "" });
    await runTurn(OPS);
    const [file, args, opts] = execMock.mock.calls[0] as [string, string[], { cwd?: string }];
    expect(file).toBe("claude");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(opts.cwd).toMatch(/hanoman-portal-chat-/);
  });
});
