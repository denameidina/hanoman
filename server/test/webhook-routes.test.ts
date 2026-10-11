import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
};
beforeEach(async () => { await clean(); await refreshWebhookCache(); });
afterAll(async () => { await clean(); await refreshWebhookCache(); });

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/webhooks", payload });

// SPEC-477 · ADR-0100 dulu menutup ini sebagai COOKIE_ONLY. ADR-0194 membukanya lewat domain BARU
// `webhooks`, dipetakan MENURUT METHOD (kelas bug SPEC-405).
describe("capabilityForRoute · webhooks", () => {
  it("baca -> webhooks:read, tulis -> webhooks:write, apa pun sub-path-nya", () => {
    expect(capabilityForRoute("GET", "/api/webhooks")).toBe("webhooks:read");
    expect(capabilityForRoute("GET", "/api/webhooks/abc/deliveries")).toBe("webhooks:read");
    for (const [m, p] of [
      ["POST", "/api/webhooks"], ["PATCH", "/api/webhooks/abc"], ["DELETE", "/api/webhooks/abc"],
      ["POST", "/api/webhooks/abc/test"], ["POST", "/api/webhooks/deliveries/d1/retry"],
    ] as const) expect(capabilityForRoute(m, p), `${m} ${p}`).toBe("webhooks:write");
  });
});

describe("POST /api/webhooks", () => {
  it("membuat endpoint dan mengembalikan secret SEKALI", async () => {
    const r = await post({ name: "CI", url: "https://contoh.id/hook", events: ["spec.*"] });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(typeof b.secret).toBe("string");
    expect(b.secret.length).toBeGreaterThan(20);
    expect(b.secretHint).toBe(b.secret.slice(-4));
  });

  it("secret TIDAK muncul lagi di GET", async () => {
    const secret = (await post({ name: "CI", url: "https://contoh.id/hook", events: ["*"] })).json().secret;
    const list = await app.inject({ method: "GET", url: "/api/webhooks" });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(secret);
    expect(list.json().endpoints[0].secret).toBeUndefined();
  });

  it("menyimpan secret dalam bentuk terenkripsi, bukan plaintext", async () => {
    const secret = (await post({ name: "CI", url: "https://contoh.id/hook", events: ["*"] })).json().secret;
    const row = await prisma.webhookEndpoint.findFirst();
    expect(row!.secret).not.toBe(secret);
    expect(row!.secret.startsWith("enc:v1:")).toBe(true);
  });

  it("menolak URL non-http(s) dan alamat internal tanpa izin", async () => {
    expect((await post({ name: "x", url: "file:///etc/passwd", events: ["*"] })).statusCode).toBe(400);
    const loop = await post({ name: "x", url: "http://127.0.0.1:9000/h", events: ["*"] });
    expect(loop.statusCode).toBe(400);
    expect(JSON.stringify(loop.json())).toContain("internal");
  });

  it("mengizinkan alamat internal saat allowPrivate dinyalakan", async () => {
    expect((await post({ name: "x", url: "http://127.0.0.1:9000/h", events: ["*"], allowPrivate: true }))
      .statusCode).toBe(201);
  });

  it("menolak jenis peristiwa yang tak ada di katalog", async () => {
    const r = await post({ name: "x", url: "https://contoh.id/h", events: ["spec.meledak"] });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toContain("spec.meledak");
  });

  it("menyegarkan cache — endpoint baru langsung aktif tanpa restart", async () => {
    const { webhooksActive } = await import("../src/services/webhooks/endpoints");
    expect(webhooksActive()).toBe(false);
    await post({ name: "x", url: "https://contoh.id/h", events: ["*"] });
    expect(webhooksActive()).toBe(true);
  });
});

describe("PATCH /api/webhooks/:id", () => {
  it("mengubah langganan tanpa menyentuh secret", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    const before = (await prisma.webhookEndpoint.findUnique({ where: { id: c.id } }))!.secret;
    const r = await app.inject({ method: "PATCH", url: `/api/webhooks/${c.id}`, payload: { events: ["spec.created"] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().events).toEqual(["spec.created"]);
    expect(r.json().secret).toBeUndefined();
    expect((await prisma.webhookEndpoint.findUnique({ where: { id: c.id } }))!.secret).toBe(before);
  });

  it("rotateSecret mengembalikan secret baru SEKALI dan menggantinya di DB", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    const r = await app.inject({ method: "PATCH", url: `/api/webhooks/${c.id}`, payload: { rotateSecret: true } });
    expect(r.json().secret).toBeTruthy();
    expect(r.json().secret).not.toBe(c.secret);
  });

  it("mengaktifkan ulang endpoint yang dinonaktifkan otomatis membersihkan jejaknya", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    await prisma.webhookEndpoint.update({
      where: { id: c.id },
      data: { enabled: false, disabledAt: new Date(), disabledReason: "5 gagal", failureStreak: 5 },
    });
    const r = await app.inject({ method: "PATCH", url: `/api/webhooks/${c.id}`, payload: { enabled: true } });
    expect(r.json().disabledAt).toBeNull();
    expect(r.json().failureStreak).toBe(0);
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "PATCH", url: "/api/webhooks/hantu", payload: { name: "y" } }))
      .statusCode).toBe(404);
  });
});

describe("DELETE /api/webhooks/:id", () => {
  it("menghapus endpoint berikut riwayatnya", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    await prisma.webhookDelivery.create({
      data: { endpointId: c.id, eventId: "e", eventType: "spec.created", payload: {} as never } as never,
    });
    expect((await app.inject({ method: "DELETE", url: `/api/webhooks/${c.id}` })).statusCode).toBe(204);
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });
});

describe("GET /api/webhooks/:id/deliveries", () => {
  it("mengembalikan riwayat terbaru lebih dulu", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    for (const t of ["spec.created", "spec.updated"])
      await prisma.webhookDelivery.create({
        data: { endpointId: c.id, eventId: t, eventType: t, payload: {} as never } as never,
      });
    const r = await app.inject({ method: "GET", url: `/api/webhooks/${c.id}/deliveries` });
    expect(r.statusCode).toBe(200);
    expect(r.json().items).toHaveLength(2);
    expect(r.json().items[0].eventType).toBe("spec.updated");
  });
});

describe("POST /api/webhooks/deliveries/:id/retry", () => {
  it("mengembalikan baris failed ke antrean dengan attempt direset", async () => {
    const c = (await post({ name: "x", url: "https://contoh.id/h", events: ["*"] })).json();
    const d = await prisma.webhookDelivery.create({
      data: {
        endpointId: c.id, eventId: "e", eventType: "spec.created", payload: {} as never,
        status: "failed", attempt: 6, error: "HTTP 500",
      } as never,
    });
    const r = await app.inject({ method: "POST", url: `/api/webhooks/deliveries/${d.id}/retry` });
    expect(r.statusCode).toBe(200);
    const fresh = await prisma.webhookDelivery.findUnique({ where: { id: d.id } });
    expect(fresh!.status).toBe("pending");
    expect(fresh!.attempt).toBe(0);
    expect(fresh!.nextAttemptAt).toBeNull();
  });
});
