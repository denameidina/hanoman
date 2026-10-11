import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";
import type { ChecklistView } from "@hanoman/shared";

// ADR-0211 · `scoreTotal` di listing `GET /vps` = skor checklist, dari audit TERSIMPAN. Listing tak
// pernah menjalankan audit; N/A/attest terkini ikut terhitung tanpa audit ulang.
const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

const listRow = async (id: string) =>
  (await app.inject({ url: "/api/vps" })).json().find((v: { id: string }) => v.id === id);
const checklist = async (id: string): Promise<ChecklistView> =>
  (await app.inject({ url: `/api/vps/${id}/checklist` })).json();

describe("skor kepatuhan di listing VPS (ADR-0211)", () => {
  it("belum pernah diaudit → scoreTotal null, dan listing tak menulis snapshot", async () => {
    const v = await makeVps({ name: "ls0", host: "198.51.100.90" });
    expect((await listRow(v.id)).scoreTotal).toBeNull();
    expect(await prisma.vpsAuditSnapshot.count({ where: { vpsId: v.id } })).toBe(0);
  });

  it("setelah audit, scoreTotal listing = scoreTotal checklist", async () => {
    const v = await makeVps({ name: "ls1", host: "198.51.100.91" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    const row = await listRow(v.id);
    expect(typeof row.scoreTotal).toBe("number");
    expect(row.scoreTotal).toBe((await checklist(v.id)).scoreTotal);
  });

  it("listing membaca audit tersimpan: memanggilnya berulang tak menambah snapshot", async () => {
    const v = await makeVps({ name: "ls2", host: "198.51.100.92" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    await listRow(v.id); await listRow(v.id);
    expect(await prisma.vpsAuditSnapshot.count({ where: { vpsId: v.id } })).toBe(1);
  });

  it("setelah dua audit berbeda hasil, listing mengambil snapshot TERBARU, sama dengan checklist", async () => {
    const v = await makeVps({ name: "ls4", host: "198.51.100.94" });
    const first = (await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` })).json().scoreTotal as number;
    process.env.FAKE_SSH_MODE = "audit-fail";                       // ssh-b3 pass → fail
    const second = (await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` })).json().scoreTotal as number;
    expect(second).not.toBe(first);
    const row = await listRow(v.id);
    expect(row.scoreTotal).toBe(second);
    expect(row.scoreTotal).toBe((await checklist(v.id)).scoreTotal);
  });

  it("N/A yang baru ditandai tercermin di listing tanpa audit ulang, sama dengan checklist", async () => {
    const v = await makeVps({ name: "ls3", host: "198.51.100.93" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/audit` });
    const before = (await listRow(v.id)).scoreTotal as number;
    // Fixture: 4 item lulus dari 232, penyebutnya ikut item INFO yang `unknown`. Skor kecil dan
    // pembulatan menelan N/A satu-dua item, jadi N/A dikirim berkelompok (batas na-bulk 64) sampai
    // penyebutnya menyusut cukup untuk mengubah angka yang tampil.
    const unknown = (await checklist(v.id)).sections.flatMap((s) => s.items)
      .filter((i) => i.status === "unknown" && !i.na).map((i) => i.id);
    for (let k = 0; k < 3; k++) {
      const itemIds = unknown.slice(k * 64, (k + 1) * 64);
      const na = await app.inject({ method: "POST", url: `/api/vps/${v.id}/items/na-bulk`, payload: { itemIds, na: true } });
      expect(na.statusCode).toBe(200);
    }
    const after = (await listRow(v.id)).scoreTotal as number;
    expect(after).toBeGreaterThan(before);
    expect(after).toBe((await checklist(v.id)).scoreTotal);
    expect(await prisma.vpsAuditSnapshot.count({ where: { vpsId: v.id } })).toBe(1);
  });
});
