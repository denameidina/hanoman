import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";

// SPEC-880 · satu record yang ditolak `validateSyncData` (mis. field dari instance yang lebih baru)
// dulu melempar keluar dari loop → 500 untuk SELURUH batch, dan client menganggap seluruh push
// gagal. Kini per-record: bentuk `{ id, ok:false, error }` yang sudah dipakai untuk "unknown entity".
const app = buildApp();
const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function token() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return (await issueDeviceToken(u.id, "laptop")).token;
}

describe("SPEC-880 · POST /sync/push tahan record buruk", () => {
  it("record dengan field tak dikenal ditolak sendiri; record lain di batch tetap diterima", async () => {
    const t = await token();
    const r = await app.inject({
      method: "POST", url: "/api/sync/push",
      headers: { authorization: `Bearer ${t}` },
      payload: {
        records: [
          { entity: "project", id: "buruk", baseVersion: 0,
            data: { name: "buruk", desc: "d", kind: "existing", stack: "", fieldDariMasaDepan: "x" } },
          { entity: "project", id: "baik", baseVersion: 0,
            data: { name: "baik", desc: "d", kind: "existing", stack: "" } },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const [buruk, baik] = r.json().results;
    expect(buruk).toMatchObject({ id: "buruk", ok: false });
    expect(String(buruk.error)).toContain("fieldDariMasaDepan");
    expect(baik).toMatchObject({ id: "baik", ok: true, version: 1 });
    expect(await prisma.project.findUnique({ where: { id: "buruk" } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "baik" } })).not.toBeNull();
  });
});
