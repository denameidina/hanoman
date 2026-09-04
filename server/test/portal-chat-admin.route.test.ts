import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";
import { PORTAL_CHAT_DEFAULTS, periodKeyOf } from "@hanoman/shared";

const app = buildApp();
const clean = async () => {
  await prisma.portalChatMessage.deleteMany(); await prisma.portalChatSession.deleteMany();
  await prisma.clientProjectAccess.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) =>
  (r.headers["set-cookie"] as string).split(";")[0]!;

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "spec854-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

async function seed(repoDir: string | null) {
  await prisma.setting.create({ data: { id: 1, data: {
    autoDefault: true, autoScaffold: true, notifyFail: true,
    portalChat: { ...PORTAL_CHAT_DEFAULTS, enabled: true } } as object } });
  await prisma.project.create({ data: {
    id: "p1", name: "Toko Mekar", desc: "", kind: "existing", repoDir } });
  await prisma.user.create({ data: {
    email: "op@x.co", passwordHash: await hashPassword("password1") } });
  const klien = await prisma.user.create({ data: {
    email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: klien.id, projectId: "p1" } });
  const s = await prisma.portalChatSession.create({ data: {
    // periodKey mengikuti BULAN BERJALAN: kuota `terpakai` dihitung dari periodKeyOf(now), jadi
    // nilai literal "2026-08" membuat test ini mati sendiri begitu kalender berganti bulan.
    projectId: "p1", userId: klien.id, type: "brainstorm", periodKey: periodKeyOf(new Date()),
    summary: "ide program loyalitas", prdMarkdown: "# Program loyalitas\n\nisi",
    prdReadyAt: new Date("2026-08-19T10:00:00Z") } });
  await prisma.portalChatMessage.create({ data: {
    sessionId: s.id, seq: 1, role: "klien", text: "mau bikin program loyalitas" } });
  await prisma.portalChatMessage.create({ data: {
    sessionId: s.id, seq: 2, role: "hanoman", text: "Maaf, tidak bisa saya tampilkan.",
    rawText: "Di Klinik Sehat sudah ada.", blocked: true, blockReasons: ["project-lain"] } });
  const login = async (email: string, password: string) => cookieOf(await app.inject({
    method: "POST", url: "/api/auth/login", payload: { email, password } }));
  return { sid: s.id, cookie: await login("op@x.co", "password1"),
           cookieKlien: await login("klien@x.co", "password2") };
}

describe("permukaan operator chat portal (SPEC-854)", () => {
  it("daftar sesi memperlihatkan asal, ringkasan, dan sisa jatah", async () => {
    const { cookie } = await seed(null);
    const r = await app.inject({ method: "GET", url: "/api/portal-chat/sessions?project=p1",
      headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().items[0]).toMatchObject({ type: "brainstorm",
      summary: "ide program loyalitas", clientEmail: "klien@x.co", prdSiap: true });
    expect(r.json().kuota).toMatchObject({ brainstorm: { terpakai: 1 } });
  });

  it("detail memperlihatkan transkrip + PRD draft + balasan yang diblokir", async () => {
    const { sid, cookie } = await seed(null);
    const r = await app.inject({ method: "GET", url: `/api/portal-chat/sessions/${sid}`,
      headers: { cookie } });
    expect(r.json().prdMarkdown).toContain("Program loyalitas");
    expect(r.json().messages[0].text).toContain("loyalitas");
    // Baris yang tertolak gerbang keluaran justru yang paling perlu dibaca operator.
    expect(r.json().messages[1]).toMatchObject({
      blocked: true, rawText: "Di Klinik Sehat sudah ada.", blockReasons: ["project-lain"] });
  });

  it("klien tak boleh menyentuh permukaan operator", async () => {
    const { sid, cookieKlien } = await seed(null);
    for (const url of ["/api/portal-chat/sessions?project=p1",
      `/api/portal-chat/sessions/${sid}`, "/api/portal-chat/export?project=p1"]) {
      const r = await app.inject({ method: "GET", url, headers: { cookie: cookieKlien } });
      expect(r.statusCode, url).toBe(403);
    }
    const p = await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${sid}/prd`,
      headers: { cookie: cookieKlien }, payload: { slug: "x" } });
    expect(p.statusCode).toBe(403);
  });

  it("materialisasi menulis docs/prd/<slug>.md dan mencatat pathnya", async () => {
    const dir = repo();
    const { sid, cookie } = await seed(dir);
    const r = await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${sid}/prd`,
      headers: { cookie }, payload: { slug: "program-loyalitas" } });
    expect(r.statusCode).toBe(201);
    expect(readFileSync(join(dir, "docs/prd/program-loyalitas.md"), "utf8"))
      .toContain("Program loyalitas");
    expect((await prisma.portalChatSession.findUnique({ where: { id: sid } }))!.prdDocPath)
      .toBe("docs/prd/program-loyalitas.md");
  });

  // Eskalasi adalah keputusan manusia: materialisasi TIDAK melahirkan backlog (huruf B).
  it("materialisasi tidak melahirkan backlog apa pun", async () => {
    const dir = repo();
    const { sid, cookie } = await seed(dir);
    await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${sid}/prd`,
      headers: { cookie }, payload: { slug: "program-loyalitas" } });
    expect(await prisma.spec.count()).toBe(0);
  });

  it("project tanpa checkout menolak materialisasi dengan keterangan", async () => {
    const { sid, cookie } = await seed(null);
    const r = await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${sid}/prd`,
      headers: { cookie }, payload: { slug: "x" } });
    expect(r.statusCode).toBe(409);
  });

  it("sesi tanpa PRD draft tak bisa dimaterialisasi", async () => {
    const dir = repo();
    const { cookie } = await seed(dir);
    const kosong = await prisma.portalChatSession.create({ data: {
      projectId: "p1", userId: (await prisma.user.findFirstOrThrow({
        where: { role: "client" } })).id, type: "tanya", periodKey: "2026-08" } });
    const r = await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${kosong.id}/prd`,
      headers: { cookie }, payload: { slug: "apa-saja" } });
    expect(r.statusCode).toBe(409);
  });

  it("slug tak aman ditolak dan tak menyentuh disk", async () => {
    const dir = repo();
    const { sid, cookie } = await seed(dir);
    for (const slug of ["../keluar", "a/b/../../c", "", "Program Loyalitas", "-awal", "x".repeat(70)]) {
      const r = await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${sid}/prd`,
        headers: { cookie }, payload: { slug } });
      expect(r.statusCode, slug).toBe(400);
    }
    expect(existsSync(join(dir, "docs/prd"))).toBe(false);
  });

  it("ekspor mengembalikan transkrip lengkap untuk training", async () => {
    const { cookie } = await seed(null);
    const r = await app.inject({ method: "GET", url: "/api/portal-chat/export?project=p1",
      headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("x-ndjson");
    const rows = r.body.trim().split("\n").map((l) => JSON.parse(l));
    expect(rows[0]).toMatchObject({ projectId: "p1", type: "brainstorm",
      clientEmail: "klien@x.co" });
    expect(rows[0].messages[0].text).toContain("loyalitas");
    expect(rows[0].messages[1]).toMatchObject({ blocked: true });
  });
});
