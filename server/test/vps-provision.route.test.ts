// SPEC-883 · endpoint provisioning. Pola vps-remediate.route.test.ts: ssh diganti fixture lewat
// HANOMAN_SSH_BIN, jadi tak satu pun test di berkas ini menyentuh mesin nyata.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("SPEC-883 · GET /vps/components", () => {
  it("memulangkan katalog lengkap", async () => {
    const res = await app.inject({ method: "GET", url: "/api/vps/components" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().components.map((c: { id: string }) => c.id);
    expect(ids).toContain("hanoman");
    expect(ids).toContain("agent-image");
  });
});

describe("SPEC-883 · POST /vps/:id/probe", () => {
  it("menulis components + componentsCheckedAt", async () => {
    const v = await makeVps({ name: "pb1", host: "198.51.100.11" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/probe` });
    expect(res.statusCode).toBe(200);
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    const comps = row.components as Record<string, { status: string }>;
    expect(comps.node!.status).toBe("ok");
    expect(comps.claude!.status).toBe("partial");
    expect(row.componentsCheckedAt).toBeInstanceOf(Date);
  });

  it("keluaran tanpa satu pun baris COMP = gagal, BUKAN 'semua absent'", async () => {
    const v = await makeVps({ name: "pb2", host: "198.51.100.12" });
    process.env.FAKE_SSH_MODE = "probe-garbage";
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/probe` });
    expect(res.statusCode).toBe(502);
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.components).toBeNull();
  });

  it("vps tak dikenal → 404", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps/hantu/probe" });
    expect(res.statusCode).toBe(404);
  });
});

describe("SPEC-883 · POST /vps/:id/provision/preview", () => {
  it("menutup dependensi & memulangkan would, tak menyentuh DB", async () => {
    const v = await makeVps({ name: "pv1", host: "198.51.100.13" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision/preview`,
      payload: { items: ["hanoman"], profile: "lab" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps.map((s: { item: string }) => s.item)).toEqual(["base", "node", "hanoman"]);
    expect(res.json().steps.every((s: { status: string }) => s.status === "would")).toBe(true);
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.components).toBeNull();
  });

  it("caddy tanpa domain → 400", async () => {
    const v = await makeVps({ name: "pv2", host: "198.51.100.14" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision/preview`,
      payload: { items: ["caddy"], profile: "lab" } });
    expect(res.statusCode).toBe(400);
  });

  it("komponen di luar profil → 400", async () => {
    const v = await makeVps({ name: "pv3", host: "198.51.100.15" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision/preview`,
      payload: { items: ["agent-image"], profile: "lab" } });
    expect(res.statusCode).toBe(400);
  });

  it("id tak dikenal → 400", async () => {
    const v = await makeVps({ name: "pv4", host: "198.51.100.16" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision/preview`,
      payload: { items: ["wat"], profile: "lab" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("SPEC-883 · POST /vps/:id/provision", () => {
  it("tanpa confirm → 409 confirm-required beserta langkah dry-run", async () => {
    const v = await makeVps({ name: "ap1", host: "198.51.100.17" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "lab" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("confirm-required");
    expect(res.json().steps.every((s: { status: string }) => s.status === "would")).toBe(true);
  });

  it("dengan confirm → apply + probe ulang tersimpan + profil tercatat", async () => {
    const v = await makeVps({ name: "ap2", host: "198.51.100.18" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "lab", confirm: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps.every((s: { status: string }) => s.status === "ok")).toBe(true);
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.provisionProfile).toBe("lab");
    expect(row.componentsCheckedAt).toBeInstanceOf(Date);
  });

  it("profil berbeda pada instance yang sudah ada hanoman → 409 profile-mismatch", async () => {
    const v = await makeVps({ name: "ap3", host: "198.51.100.19",
      provisionProfile: "lab", components: { hanoman: { status: "ok", detail: "1.4.2" } } });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "production", confirm: true } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("profile-mismatch");
    expect(res.json().current).toBe("lab");
  });

  it("force menembus profile-mismatch", async () => {
    const v = await makeVps({ name: "ap4", host: "198.51.100.20",
      provisionProfile: "lab", components: { hanoman: { status: "ok", detail: "1.4.2" } } });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "production", confirm: true, force: true } });
    expect(res.statusCode).toBe(200);
  });

  it("ssh mati → 502 dengan transcript, DB tak berubah", async () => {
    const v = await makeVps({ name: "ap5", host: "198.51.100.21" });
    process.env.FAKE_SSH_MODE = "unreachable";
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "lab", confirm: true } });
    expect(res.statusCode).toBe(502);
    expect(res.json().transcript).toBeTruthy();
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.provisionProfile).toBeNull();
  });

  it("key hilang di mesin ini → 409 keyMissing", async () => {
    const v = await makeVps({ name: "ap6", host: "198.51.100.22", keyPath: "/tak/ada/key" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "lab", confirm: true } });
    expect(res.statusCode).toBe(409);
    expect(res.json().keyMissing).toBe(true);
  });
});
