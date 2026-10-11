import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { clearConfig, loadConfig, setConfig } from "../src/config";
import { hashPassword } from "../src/services/auth";
import { issueAgentToken } from "../src/services/agent-token";
import { DEFAULT_SETTING } from "../src/services/settings";
import { refreshWebhookCache } from "../src/services/webhooks/endpoints";
import { TELEGRAM_REQUIRED_CAPABILITIES } from "../src/services/telegram/bootstrap";
import { clearTelegramRuntime } from "../src/services/telegram/runtime";

// ADR-0193..0195 · kredensial Telegram, webhook keluar, akun klien, dan portal-sebagai-klien lewat
// agent token, DIUJI SAMPAI KE ROUTE (gerbang `app.ts` + handler). `agent-capabilities.test.ts` hanya
// menguji fungsi murni `(method, path) -> capability`; berkas ini yang membuktikan gerbang memakainya
// dan handler menegakkan yang tak bisa dinyatakan di peta (anti-eskalasi, allowPrivate, scope akun).
//
// Env ingress dibuang eksplisit (SPEC-761/ADR-0117) agar var shell operator tak membuat semua path 404.
const cleanEnv = { ...process.env, HANOMAN_CONTROL_ORIGINS: undefined, HANOMAN_PUBLIC_ORIGINS: undefined };
const app = buildApp({ env: cleanEnv });

const TG_KEYS = [
  "HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN",
  "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", "HANOMAN_TELEGRAM_TARGET_CHAT_ID",
];
const BOT = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";

async function clean() {
  clearTelegramRuntime();
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await refreshWebhookCache();
  await prisma.portalChatMessage.deleteMany();
  await prisma.portalChatSession.deleteMany();
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.runtimeConfig.deleteMany();
  await prisma.agentToken.deleteMany();
  await prisma.setting.deleteMany();
  for (const k of TG_KEYS) delete process.env[k];
  await loadConfig();
}

const setting = (over: Record<string, unknown> = {}) =>
  prisma.setting.create({ data: { id: 1, data: { ...DEFAULT_SETTING, agentAccessEnabled: true, ...over } as never } });

async function tokenWith(capabilities: string[]) {
  const { token, view } = await issueAgentToken({ name: "bot", capabilities: capabilities as never });
  return { headers: { authorization: `Bearer ${token}` }, token, id: view.id };
}

beforeEach(async () => { await clean(); await setting(); });
afterAll(async () => { await clean(); await app.close(); });

const json = (r: { json(): unknown }) => r.json() as Record<string, any>;

// ───────────────────────── Telegram · telegram:admin ─────────────────────────

describe("Telegram kredensial lewat agent token (ADR-0193)", () => {
  const URLS: [string, string][] = [
    ["GET", "/api/telegram/settings"], ["PUT", "/api/telegram/settings"],
    ["POST", "/api/telegram/test"], ["DELETE", "/api/telegram/credentials"],
  ];

  it("telegram:read/write + settings:write TIDAK menjangkau kredensial, dan 403 menyebut telegram:admin", async () => {
    const { headers } = await tokenWith(["telegram:read", "telegram:write", "settings:write"]);
    for (const [method, url] of URLS) {
      const r = await app.inject({ method: method as never, url, headers, payload: method === "PUT" ? {} : undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
      expect(json(r), `${method} ${url}`).toMatchObject({ need: "telegram:admin" });
    }
  });

  // Gateway Telegram milik hanoman memegang SELURUH capability yang dituntutnya — tapi bukan
  // telegram:admin. Tak boleh ada regresi: ia tetap tak bisa menyentuh kredensialnya sendiri.
  it("token ber-seluruh-TELEGRAM_REQUIRED_CAPABILITIES (gateway) tetap ditolak di kredensial", async () => {
    const { headers } = await tokenWith([...TELEGRAM_REQUIRED_CAPABILITIES]);
    expect(TELEGRAM_REQUIRED_CAPABILITIES as readonly string[]).not.toContain("telegram:admin");
    for (const [method, url] of URLS) {
      const r = await app.inject({ method: method as never, url, headers, payload: method === "PUT" ? {} : undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
      expect(json(r)).toMatchObject({ need: "telegram:admin" });
    }
    // dan permukaan kerjanya (status) tetap terbuka untuknya, seperti sebelum perubahan ini.
    expect((await app.inject({ method: "GET", url: "/api/telegram/status", headers })).statusCode).toBe(200);
  });

  it("telegram:admin membaca isian TERSAMAR — bot token tak pernah utuh", async () => {
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", BOT);
    const { headers } = await tokenWith(["telegram:admin"]);
    const r = await app.inject({ method: "GET", url: "/api/telegram/settings", headers });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(BOT);
    const f = json(r).fields.find((x: { key: string }) => x.key === "HANOMAN_TELEGRAM_BOT_TOKEN");
    expect(f).toMatchObject({ hasValue: true, masked: "••••Dsaw" });
  });

  it("telegram:admin saja BISA mengubah allowlist bila belum ada token gateway", async () => {
    const { headers } = await tokenWith(["telegram:admin"]);
    const r = await app.inject({
      method: "PUT", url: "/api/telegram/settings", headers,
      payload: { HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "42" },
    });
    expect(r.statusCode).toBe(200);
    const f = json(r).fields.find((x: { key: string }) => x.key === "HANOMAN_TELEGRAM_ALLOWED_USER_IDS");
    expect(f.value).toBe("42");
  });

  // Inti anti-eskalasi: allowlist/bot token menentukan SIAPA yang memerintah gateway, dan gateway
  // menjalankan pekerjaan dengan capability token-nya. Pemanggil yang lebih lemah dari token gateway
  // tak boleh mengubahnya — kalau tidak, `telegram:admin` jadi tangga ke capability penuh.
  it("agen yang lebih lemah dari token gateway ditolak 403 saat mengubah kredensial", async () => {
    const gw = await tokenWith([...TELEGRAM_REQUIRED_CAPABILITIES]);
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", gw.token);
    const { headers } = await tokenWith(["telegram:admin"]);

    const r = await app.inject({
      method: "PUT", url: "/api/telegram/settings", headers,
      payload: { HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "666" },
    });
    expect(r.statusCode).toBe(403);
    expect(json(r).error).toMatch(/eskalasi/);
    expect(json(r).missing).toEqual(expect.arrayContaining(["sessions:spawn", "vps:exec"]));
    // tak ada yang tertulis
    expect(await prisma.runtimeConfig.count({ where: { key: "HANOMAN_TELEGRAM_ALLOWED_USER_IDS" } })).toBe(0);
  });

  it("menyodorkan token gateway BARU yang melebihi pemanggil juga ditolak (sebelum divalidasi lain)", async () => {
    const big = await tokenWith([...TELEGRAM_REQUIRED_CAPABILITIES]);
    const { headers } = await tokenWith(["telegram:admin", "projects:read"]);
    const r = await app.inject({
      method: "PUT", url: "/api/telegram/settings", headers,
      payload: { HANOMAN_TELEGRAM_AGENT_TOKEN: big.token },
    });
    expect(r.statusCode).toBe(403);
    expect(await prisma.runtimeConfig.count({ where: { key: "HANOMAN_TELEGRAM_AGENT_TOKEN" } })).toBe(0);
  });

  it("pemanggil yang memegang SEMUA capability token gateway lolos", async () => {
    const gw = await tokenWith([...TELEGRAM_REQUIRED_CAPABILITIES]);
    await setConfig("HANOMAN_TELEGRAM_AGENT_TOKEN", gw.token);
    const { headers } = await tokenWith(["telegram:admin", ...TELEGRAM_REQUIRED_CAPABILITIES]);
    const r = await app.inject({
      method: "PUT", url: "/api/telegram/settings", headers,
      payload: { HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "7" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("DELETE kredensial oleh telegram:admin menghapus nilai DB dan menyebut fallback env", async () => {
    await setConfig("HANOMAN_TELEGRAM_BOT_TOKEN", BOT);
    const { headers } = await tokenWith(["telegram:admin"]);
    const r = await app.inject({ method: "DELETE", url: "/api/telegram/credentials", headers });
    expect(r.statusCode).toBe(200);
    expect(json(r).cleared).toContain("HANOMAN_TELEGRAM_BOT_TOKEN");
    await clearConfig("HANOMAN_TELEGRAM_BOT_TOKEN");
  });
});

// ───────────────────────── Webhook · webhooks:read | write ─────────────────────────

describe("Webhook keluar lewat agent token (ADR-0194)", () => {
  const make = (headers: { authorization: string }, over: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST", url: "/api/webhooks", headers,
      payload: { name: "CI", url: "https://contoh.id/hook", events: ["spec.*"], ...over },
    });

  it("webhooks:read membaca, tapi tulis 403 need webhooks:write", async () => {
    const { headers } = await tokenWith(["webhooks:read"]);
    expect((await app.inject({ method: "GET", url: "/api/webhooks", headers })).statusCode).toBe(200);
    const r = await make(headers);
    expect(r.statusCode).toBe(403);
    expect(json(r)).toMatchObject({ need: "webhooks:write" });
  });

  it("token tanpa domain webhooks (backlog/settings/telegram penuh) tak menjangkaunya", async () => {
    const { headers } = await tokenWith(["backlog:write", "settings:write", "telegram:write", "support:write"]);
    const r = await app.inject({ method: "GET", url: "/api/webhooks", headers });
    expect(r.statusCode).toBe(403);
    expect(json(r)).toMatchObject({ need: "webhooks:read" });
  });

  it("webhooks:write membuat endpoint: secret tampil SEKALI persis seperti REST, tak muncul lagi", async () => {
    const { headers } = await tokenWith(["webhooks:write"]);
    const r = await make(headers);
    expect(r.statusCode).toBe(201);
    const secret = json(r).secret as string;
    expect(secret.length).toBeGreaterThan(20);
    expect(json(r).secretHint).toBe(secret.slice(-4));

    const list = await app.inject({ method: "GET", url: "/api/webhooks", headers });   // write implikasi read
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(secret);
    const row = await prisma.webhookEndpoint.findFirst();
    expect(row!.secret.startsWith("enc:v1:")).toBe(true);
  });

  it("rotateSecret mengembalikan secret baru sekali", async () => {
    const { headers } = await tokenWith(["webhooks:write"]);
    const created = json(await make(headers));
    const r = await app.inject({
      method: "PATCH", url: `/api/webhooks/${created.id}`, headers, payload: { rotateSecret: true },
    });
    expect(r.statusCode).toBe(200);
    expect(json(r).secret).toBeTruthy();
    expect(json(r).secret).not.toBe(created.secret);
  });

  // SSRF: allowPrivate mematikan pagar alamat internal. Tetap keputusan manusia.
  it("agent token TIDAK boleh membuat endpoint ber-allowPrivate (403), cookie/REST manusia tetap bisa", async () => {
    const { headers } = await tokenWith(["webhooks:write"]);
    const r = await make(headers, { url: "http://127.0.0.1:9000/h", allowPrivate: true });
    expect(r.statusCode).toBe(403);
    expect(json(r).error).toMatch(/allowPrivate/);
    expect(await prisma.webhookEndpoint.count()).toBe(0);
    // tanpa flag: pagar SSRF biasa tetap menolak alamat internal (400), bukan 403.
    expect((await make(headers, { url: "http://127.0.0.1:9000/h" })).statusCode).toBe(400);
  });

  it("agent token tak bisa menyalakan allowPrivate lewat PATCH, atau memindahkan endpoint ber-allowPrivate", async () => {
    const { headers } = await tokenWith(["webhooks:write"]);
    const ok = json(await make(headers));
    expect((await app.inject({
      method: "PATCH", url: `/api/webhooks/${ok.id}`, headers, payload: { allowPrivate: true },
    })).statusCode).toBe(403);

    // Endpoint yang SUDAH ber-allowPrivate (dibuat manusia) tak boleh dipindah URL-nya oleh agen:
    // pagar IP literal tak diperiksa ulang untuk flag yang sudah menyala.
    const human = await prisma.webhookEndpoint.create({
      data: {
        name: "internal", url: "http://127.0.0.1:9000/h", secret: "x", events: ["*"] as never,
        enabled: true, allowPrivate: true,
      },
    });
    const r = await app.inject({
      method: "PATCH", url: `/api/webhooks/${human.id}`, headers, payload: { url: "http://169.254.169.254/" },
    });
    expect(r.statusCode).toBe(403);
    expect((await prisma.webhookEndpoint.findUnique({ where: { id: human.id } }))!.url).toBe("http://127.0.0.1:9000/h");
    // ...tapi mengganti hal lain di endpoint itu (mis. menjeda) tidak dihalangi.
    expect((await app.inject({
      method: "PATCH", url: `/api/webhooks/${human.id}`, headers, payload: { enabled: false },
    })).statusCode).toBe(200);
  });

  it("riwayat pengiriman terbaca dengan webhooks:read; retry & hapus butuh webhooks:write", async () => {
    const w = await tokenWith(["webhooks:write"]);
    const created = json(await make(w.headers));
    const d = await prisma.webhookDelivery.create({
      data: {
        endpointId: created.id, eventId: "e1", eventType: "spec.created", payload: {} as never,
        status: "failed", attempt: 6, error: "HTTP 500",
      },
    });
    const r = await tokenWith(["webhooks:read"]);
    const hist = await app.inject({ method: "GET", url: `/api/webhooks/${created.id}/deliveries`, headers: r.headers });
    expect(hist.statusCode).toBe(200);
    expect(json(hist).items).toHaveLength(1);

    const retryRO = await app.inject({ method: "POST", url: `/api/webhooks/deliveries/${d.id}/retry`, headers: r.headers });
    expect(retryRO.statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/webhooks/deliveries/${d.id}/retry`, headers: w.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/webhooks/${created.id}`, headers: r.headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/api/webhooks/${created.id}`, headers: w.headers })).statusCode).toBe(204);
  });
});

// ───────────────────────── Akun klien · clients:read | write ─────────────────────────

describe("Akun klien lewat agent token (ADR-0194)", () => {
  beforeEach(async () => {
    for (const id of ["p1", "p2"]) await prisma.project.create({ data: { id, name: id, desc: "", kind: "existing" } });
  });

  it("clients:read daftar saja; tulis 403 need clients:write; domain lain tak menjangkau", async () => {
    const { headers } = await tokenWith(["clients:read"]);
    expect((await app.inject({ method: "GET", url: "/api/client-accounts", headers })).statusCode).toBe(200);
    const w = await app.inject({
      method: "POST", url: "/api/client-accounts", headers,
      payload: { email: "k@x.co", password: "password2", projects: [] },
    });
    expect(w.statusCode).toBe(403);
    expect(json(w)).toMatchObject({ need: "clients:write" });

    const other = await tokenWith(["settings:write", "projects:write", "support:write"]);
    const r = await app.inject({ method: "GET", url: "/api/client-accounts", headers: other.headers });
    expect(r.statusCode).toBe(403);
    expect(json(r)).toMatchObject({ need: "clients:read" });
  });

  it("clients:write membuat akun ber-role client; password TIDAK kembali di respons; reset mencabut sesi", async () => {
    const { headers } = await tokenWith(["clients:write"]);
    const r = await app.inject({
      method: "POST", url: "/api/client-accounts", headers,
      payload: { email: "k@x.co", password: "rahasia-123", projects: ["p1"] },
    });
    expect(r.statusCode).toBe(201);
    expect(r.body).not.toContain("rahasia-123");
    expect(json(r)).not.toHaveProperty("passwordHash");
    expect(json(r)).toMatchObject({ email: "k@x.co", projects: ["p1"] });
    const id = json(r).id as string;
    expect((await prisma.user.findUnique({ where: { id } }))!.role).toBe("client");

    // sesi klien lama mati saat password di-reset
    await prisma.session.create({ data: { id: "s-old", userId: id, expiresAt: new Date(Date.now() + 1e6) } });
    const reset = await app.inject({
      method: "PATCH", url: `/api/client-accounts/${id}`, headers, payload: { password: "password-baru-9" },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.body).not.toContain("password-baru-9");
    expect(await prisma.session.count({ where: { userId: id } })).toBe(0);
  });

  it("akun OPERATOR tak terjangkau: reset password / hapus / nonaktifkan -> 404", async () => {
    const admin = await prisma.user.create({ data: { email: "admin@x.co", passwordHash: await hashPassword("password1") } });
    const { headers } = await tokenWith(["clients:write"]);
    for (const [method, payload] of [
      ["PATCH", { password: "diretas-12345" }], ["PATCH", { disabled: true }], ["DELETE", undefined],
    ] as const) {
      const r = await app.inject({ method, url: `/api/client-accounts/${admin.id}`, headers, payload });
      expect(r.statusCode, method).toBe(404);
    }
    const row = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(row!.disabled).toBe(false);
    expect(row!.passwordHash).toBe(admin.passwordHash);
    // dan daftar klien tak membocorkan akun operator
    const list = await app.inject({ method: "GET", url: "/api/client-accounts", headers });
    expect(list.body).not.toContain("admin@x.co");
  });
});

// ───────────────────────── Portal · portal:read ─────────────────────────

describe("Portal sebagai klien lewat agent token (ADR-0195)", () => {
  const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
  let clientA = "", clientB = "", adminId = "";

  beforeEach(async () => {
    for (const id of ["p1", "p2"]) await prisma.project.create({ data: { id, name: id.toUpperCase(), desc: "", kind: "existing" } });
    await prisma.spec.create({ data: {
      id: "SPEC-1", projectId: "p1", title: "Milik A", source: "brief", stage: "executing", priority: "tinggi",
      author: "op@x.co", objective: "hasil", payload: { context: "rahasia internal" } } });
    await prisma.ticket.create({ data: {
      id: "t1", projectId: "p1", number: 1, category: "bug", title: "Tombol mati", detail: "repro",
      reporterEmail: "p@luar.co", status: "new", accessKeyHash: "h1" } });
    adminId = (await prisma.user.create({ data: { email: "admin@x.co", passwordHash: await hashPassword("password1") } })).id;
    clientA = (await prisma.user.create({ data: { email: "a@x.co", passwordHash: await hashPassword("password2"), role: "client" } })).id;
    clientB = (await prisma.user.create({ data: { email: "b@x.co", passwordHash: await hashPassword("password3"), role: "client" } })).id;
    await prisma.clientProjectAccess.create({ data: { userId: clientA, projectId: "p1" } });
    await prisma.clientProjectAccess.create({ data: { userId: clientB, projectId: "p2" } });
  });

  const get = (headers: Record<string, string>, url: string) => app.inject({ method: "GET", url, headers });

  it("tanpa portal:read: 403 need portal:read (backlog/support/clients tak cukup)", async () => {
    const { headers } = await tokenWith(["backlog:write", "support:write", "clients:write"]);
    const r = await get(headers, `/api/portal/projects?asClient=${clientA}`);
    expect(r.statusCode).toBe(403);
    expect(json(r)).toMatchObject({ need: "portal:read" });
  });

  it("asClient WAJIB: tanpa itu 400, bukan 500 (req.user tak ada untuk agen)", async () => {
    const { headers } = await tokenWith(["portal:read"]);
    for (const url of ["/api/portal/projects", "/api/portal/projects/p1/backlog", "/api/portal/projects/p1/tickets"]) {
      const r = await get(headers, url);
      expect(r.statusCode, url).toBe(400);
      expect(json(r).error).toMatch(/asClient/);
    }
  });

  it("asClient harus akun KLIEN: id operator atau karangan -> 404", async () => {
    const { headers } = await tokenWith(["portal:read"]);
    expect((await get(headers, `/api/portal/projects?asClient=${adminId}`)).statusCode).toBe(404);
    expect((await get(headers, "/api/portal/projects?asClient=tidak-ada")).statusCode).toBe(404);
  });

  it("melihat persis yang dilihat klien itu: scope project & proyeksi sempit", async () => {
    const { headers } = await tokenWith(["portal:read"]);
    const list = await get(headers, `/api/portal/projects?asClient=${clientA}`);
    expect(list.statusCode).toBe(200);
    expect(json(list).items.map((p: { id: string }) => p.id)).toEqual(["p1"]);

    const backlog = await get(headers, `/api/portal/projects/p1/backlog?asClient=${clientA}`);
    expect(backlog.statusCode).toBe(200);
    expect(backlog.body).not.toContain("rahasia internal");   // payload internal tak ikut
    expect((await get(headers, `/api/portal/projects/p1/backlog/SPEC-1?asClient=${clientA}`)).statusCode).toBe(200);
    expect((await get(headers, `/api/portal/projects/p1/tickets?asClient=${clientA}`)).statusCode).toBe(200);
    expect((await get(headers, `/api/portal/projects/p1/tickets/t1?asClient=${clientA}`)).statusCode).toBe(200);

    // klien B tak punya p1 -> 404 yang sama dengan project yang tak ada
    expect((await get(headers, `/api/portal/projects/p1/backlog?asClient=${clientB}`)).statusCode).toBe(404);
  });

  it("TULIS atas nama klien tak mungkin: kirim tiket & chat tetap 403 cookie-only untuk agen", async () => {
    const { headers } = await tokenWith(["portal:read", "support:write", "clients:write", "backlog:write"]);
    for (const url of [
      `/api/portal/projects/p1/tickets?asClient=${clientA}`,
      `/api/portal/projects/p1/chat/sessions?asClient=${clientA}`,
      `/api/portal/projects/p1/chat/sessions/s1/messages?asClient=${clientA}`,
    ]) {
      const r = await app.inject({ method: "POST", url, headers, payload: {} });
      expect(r.statusCode, url).toBe(403);
      expect(json(r)).toMatchObject({ error: "cookie session required" });
    }
    expect(await prisma.ticket.count()).toBe(1);
  });

  // Tanpa prioritas `req.user`, ?asClient menjadi IDOR antar-klien: klien A menyisipkan id B.
  it("klien yang sedang login TIDAK bisa memakai ?asClient untuk melihat klien lain", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@x.co", password: "password2" } });
    const cookie = cookieOf(login);
    const r = await app.inject({ method: "GET", url: `/api/portal/projects?asClient=${clientB}`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(json(r).items.map((p: { id: string }) => p.id)).toEqual(["p1"]);   // dirinya, bukan B
    expect((await app.inject({
      method: "GET", url: `/api/portal/projects/p2/backlog?asClient=${clientB}`, headers: { cookie },
    })).statusCode).toBe(404);
  });

  describe("chat portal", () => {
    beforeEach(async () => {
      await prisma.setting.deleteMany();
      await setting({ portalChat: { ...DEFAULT_SETTING.portalChat, enabled: true } });
      await prisma.portalChatSession.create({ data: { id: "s-a", projectId: "p1", userId: clientA, type: "tanya", periodKey: "2026-10", summary: "" } });
      await prisma.portalChatMessage.create({ data: { sessionId: "s-a", seq: 1, role: "klien", text: "halo" } });
      await prisma.portalChatSession.create({ data: { id: "s-b", projectId: "p2", userId: clientB, type: "tanya", periodKey: "2026-10", summary: "" } });
    });

    it("kuota, daftar sesi, dan transkrip dibaca atas nama klien", async () => {
      const { headers } = await tokenWith(["portal:read"]);
      expect((await get(headers, `/api/portal/projects/p1/chat?asClient=${clientA}`)).statusCode).toBe(200);
      const list = await get(headers, `/api/portal/projects/p1/chat/sessions?asClient=${clientA}`);
      expect(json(list).items.map((s: { id: string }) => s.id)).toEqual(["s-a"]);
      const one = await get(headers, `/api/portal/projects/p1/chat/sessions/s-a?asClient=${clientA}`);
      expect(one.statusCode).toBe(200);
      expect(json(one).messages.items[0].text).toBe("halo");
    });

    it("sesi milik klien/project lain tetap 404 — id sesi bukan jalan pintas", async () => {
      const { headers } = await tokenWith(["portal:read"]);
      expect((await get(headers, `/api/portal/projects/p1/chat/sessions/s-b?asClient=${clientA}`)).statusCode).toBe(404);
      expect((await get(headers, `/api/portal/projects/p2/chat/sessions/s-b?asClient=${clientA}`)).statusCode).toBe(404);
    });

    it("chat dimatikan di Settings -> 404", async () => {
      await prisma.setting.deleteMany();
      await setting();
      const { headers } = await tokenWith(["portal:read"]);
      expect((await get(headers, `/api/portal/projects/p1/chat?asClient=${clientA}`)).statusCode).toBe(404);
    });
  });
});

// ───────────────────────── Katalog ─────────────────────────

describe("katalog integrasi", () => {
  const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

  it("tool tulis webhook & akun klien, serta SEMUA tool kredensial Telegram, bermode danger", () => {
    const names = [
      "hanoman_telegram_settings_get", "hanoman_telegram_settings_set", "hanoman_telegram_test",
      "hanoman_telegram_credentials_clear", "hanoman_webhook_create", "hanoman_webhook_update",
      "hanoman_webhook_delete", "hanoman_webhook_test", "hanoman_webhook_delivery_retry",
      "hanoman_client_account_create", "hanoman_client_account_update",
      "hanoman_client_account_password_reset", "hanoman_client_account_delete",
    ];
    for (const n of names) expect(byName(n).mode, n).toBe("danger");
    for (const n of ["hanoman_webhooks_list", "hanoman_webhook_deliveries", "hanoman_client_accounts_list"])
      expect(byName(n).mode, n).toBe("read");
  });

  it("tool portal semuanya baca-saja bercapability portal:read dan mensyaratkan asClient", () => {
    const portal = MCP_TOOLS.filter((t) => t.name.startsWith("hanoman_portal_") && !t.name.startsWith("hanoman_portal_admin_"));
    expect(portal.length).toBe(5);
    for (const t of portal) {
      expect(t.mode, t.name).toBe("read");
      expect(t.capability, t.name).toBe("portal:read");
      expect(t.sampleMethod, t.name).toBe("GET");
      expect(t.inputSchema.required, t.name).toContain("asClient");
    }
  });

  it("parameter allowPrivate & secret webhook sengaja TIDAK ada di skema tool", () => {
    for (const n of ["hanoman_webhook_create", "hanoman_webhook_update"]) {
      expect(byName(n).inputSchema.properties.allowPrivate, n).toBeUndefined();
      expect(byName(n).inputSchema.properties.secret, n).toBeUndefined();
    }
  });
});
