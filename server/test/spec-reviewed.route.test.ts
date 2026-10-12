import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/app";
import { listSessions } from "../src/services/pty";
import { prisma } from "../src/db";
import { recordCompletion } from "../src/services/notifications";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { resetDb, makeProject, makeSpec } from "./factory";

// Overlay stage-live & daftar sesi membaca tmux nyata; di test tak ada pane (pola spec-done.route).
vi.mock("../src/services/pty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/pty")>();
  return { ...actual, listSessions: vi.fn(() => []) };
});
vi.mock("../src/services/live-phases", async (orig) => ({
  ...(await orig<typeof import("../src/services/live-phases")>()),
  sessionPhasesBySpecAsync: vi.fn(async () => new Map()),
}));

const app = buildApp({ requireAuth: false });
const mark = (id: string, body: unknown = {}) =>
  app.inject({ method: "POST", url: `/api/specs/${id}/reviewed`, payload: body as object });
const reviewedAtOf = async (id: string) =>
  (await prisma.spec.findUnique({ where: { id } }))!.reviewedAt;

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  vi.mocked(listSessions).mockReturnValue([]);
});

// ADR-0218 · penanda "sudah ditinjau" pada item selesai.
describe("ADR-0218 · POST /specs/:id/reviewed", () => {
  it("menandai item selesai: reviewedAt terisi, stage tetap done", async () => {
    await makeSpec({ id: "SPEC-900", projectId: "p1", stage: "done", baseSha: "a1b2c3d" });
    const r = await mark("SPEC-900");
    expect(r.statusCode).toBe(200);
    expect(r.json().stage).toBe("done");
    expect(r.json().reviewedAt).toEqual(expect.any(String));
    expect(await reviewedAtOf("SPEC-900")).not.toBeNull();
  });

  it("idempoten: menandai ulang tak menggeser stempel tinjauan pertama", async () => {
    await makeSpec({ id: "SPEC-901", projectId: "p1", stage: "done" });
    const first = (await mark("SPEC-901")).json().reviewedAt;
    await new Promise((res) => setTimeout(res, 5));
    const again = await mark("SPEC-901");
    expect(again.statusCode).toBe(200);
    expect(again.json().reviewedAt).toBe(first);
  });

  it("body kosong = tandai (true); reviewed:false membatalkan dan kembali null", async () => {
    await makeSpec({ id: "SPEC-902", projectId: "p1", stage: "done" });
    await mark("SPEC-902");
    const undo = await mark("SPEC-902", { reviewed: false });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().reviewedAt).toBeNull();
    expect(await reviewedAtOf("SPEC-902")).toBeNull();
  });

  it("membatalkan yang belum ditandai tak menulis apa-apa dan tetap 200 (idempoten)", async () => {
    await makeSpec({ id: "SPEC-903", projectId: "p1", stage: "done" });
    const r = await mark("SPEC-903", { reviewed: false });
    expect(r.statusCode).toBe(200);
    expect(r.json().reviewedAt).toBeNull();
  });

  it("item yang belum selesai ditolak 409 dan tak ditandai", async () => {
    await makeSpec({ id: "SPEC-904", projectId: "p1", stage: "executing", baseSha: "a1b2c3d" });
    const r = await mark("SPEC-904");
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain("belum selesai");
    expect(await reviewedAtOf("SPEC-904")).toBeNull();
  });

  it("spec tak ada → 404", async () => {
    expect((await mark("SPEC-NIHIL")).statusCode).toBe(404);
  });

  it("reviewed bukan boolean → 400", async () => {
    await makeSpec({ id: "SPEC-905", projectId: "p1", stage: "done" });
    expect((await mark("SPEC-905", { reviewed: "ya" })).statusCode).toBe(400);
  });

  // Keputusan: penanda di-reset saat item DIMUNDURKAN dari done, supaya penyelesaian berikutnya
  // (setelah diubah lalu selesai lagi) kembali tampil "perlu ditinjau".
  it("mundurnya stage dari done (PATCH stage) membuang penanda", async () => {
    await makeSpec({ id: "SPEC-906", projectId: "p1", stage: "done" });
    await mark("SPEC-906");
    const back = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-906", payload: { stage: "executing", confirmDelete: true },
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().stage).toBe("executing");
    expect(await reviewedAtOf("SPEC-906")).toBeNull();
  });

  // Keputusan: penyelesaian ULANG lewat recordCompletion TIDAK mereset penanda. Reconcile memanggilnya
  // untuk setiap item selesai yang masih di antrean, jadi mereset di sana akan menghapus tanda yang
  // baru dipasang beberapa detik sebelumnya.
  it("recordCompletion pada item yang sudah ditandai tak menghapus penandanya", async () => {
    await makeSpec({ id: "SPEC-907", projectId: "p1", stage: "done" });
    await mark("SPEC-907");
    const before = await reviewedAtOf("SPEC-907");
    await recordCompletion("SPEC-907", "judul", "p1");
    expect(await reviewedAtOf("SPEC-907")).toEqual(before);
  });

  // Item yang sudah ditandai tampil di daftar dengan reviewedAt (projection zSpecSlim → select),
  // dan item yang belum ditandai bernilai null — bukan tak ada.
  it("GET /specs membawa reviewedAt di setiap baris, null bila belum ditandai", async () => {
    await makeSpec({ id: "SPEC-908", projectId: "p1", stage: "done" });
    await makeSpec({ id: "SPEC-909", projectId: "p1", stage: "done" });
    await mark("SPEC-908");
    const list = await app.inject({ method: "GET", url: "/api/specs?project=p1" });
    const rows = list.json().items as { id: string; reviewedAt: string | null }[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.reviewedAt]));
    expect(byId["SPEC-908"]).toEqual(expect.any(String));
    expect(byId["SPEC-909"]).toBeNull();
  });
});

describe("ADR-0218 · kapabilitas dan sinkronisasi", () => {
  it("POST /specs/:id/reviewed menuntut backlog:write (setara POST /done, tak lebih)", () => {
    expect(capabilityForRoute("POST", "/api/specs/SPEC-1/reviewed")).toBe("backlog:write");
    expect(capabilityForRoute("POST", "/api/specs/SPEC-1/done")).toBe("backlog:write");
  });

  it("reviewedAt ikut menyeberang sync sebagai DATE, bukan JSON", async () => {
    const { __FIELDS, __DATE_FIELDS, __JSON_FIELDS } = await import("../src/services/sync");
    expect(__FIELDS.spec).toContain("reviewedAt");
    expect(__DATE_FIELDS.spec).toContain("reviewedAt");
    expect(__JSON_FIELDS.has("spec:reviewedAt")).toBe(false);
  });

  // ADR-0218 · peer versi lama tak tahu `reviewedAt` dan tak mengirim kuncinya. Item yang stage-nya bukan done
  // tak boleh membawa penanda lama; item done dari peer itu tak mengubah penanda lokal.
  it("sync dari peer versi lama (tanpa kunci reviewedAt): stage bukan-done mengosongkan penanda lokal; done tak menyentuhnya", async () => {
    const { upsertLocal, snapshot } = await import("../src/services/sync");
    const stamp = new Date("2026-10-11T08:00:00Z");
    await makeSpec({ id: "SPEC-920", projectId: "p1", stage: "done", baseSha: "a1b2c3d" });
    await prisma.spec.update({ where: { id: "SPEC-920" }, data: { reviewedAt: stamp } });
    // Kiriman peer lama = snapshot utuh (upsert butuh record lengkap, seperti push nyata), TANPA kunci reviewedAt.
    const oldPeer: Record<string, unknown> = { ...(await snapshot("spec", "SPEC-920"))!.data };
    delete oldPeer.reviewedAt;
    await upsertLocal("spec", "SPEC-920", 9, { ...oldPeer, stage: "executing" });
    expect(await reviewedAtOf("SPEC-920")).toBeNull();
    await prisma.spec.update({ where: { id: "SPEC-920" }, data: { stage: "done", reviewedAt: stamp } });
    await upsertLocal("spec", "SPEC-920", 10, { ...oldPeer, stage: "done" });
    expect(await reviewedAtOf("SPEC-920")).toEqual(stamp);
  });

  it("zSpec mengisi reviewedAt null untuk respons versi lama", async () => {
    const { zSpec } = await import("@hanoman/shared");
    const old = {
      id: "SPEC-1", projectId: "p", title: "t", source: "brief", stage: "done", priority: "sedang",
      author: "a", objective: "o", payload: null, branchFrom: null, baseSha: null,
      createdAt: "2026-08-15T00:00:00.000Z", startedAt: null,
    };
    expect(zSpec.parse(old).reviewedAt).toBeNull();
  });

  // Penanda ini tak masuk allowlist webhook: ia tak mengubah bentuk peristiwa `spec.updated` yang
  // sudah dikonsumsi penerima eksternal. Dikunci agar keputusan itu terbaca, bukan kebetulan.
  it("tak masuk allowlist webhook spec", async () => {
    const { WEBHOOK_ENTITIES } = await import("@hanoman/shared");
    expect(WEBHOOK_ENTITIES.find((d) => d.entity === "spec")!.fields).not.toContain("reviewedAt");
  });
});
