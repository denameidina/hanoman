import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import cookie from "@fastify/cookie";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { pickWebDir, shouldServeWeb } from "./web-dir";
import { pickGuideFile } from "./guide-file";
import health from "./routes/health";
import agentDoc from "./routes/agent-doc";
import projects from "./routes/projects";
import specs from "./routes/specs";
import notifications from "./routes/notifications";
import settings from "./routes/settings";
import docs from "./routes/docs";
import ide from "./routes/ide";
import fs from "./routes/fs";
import terminal from "./routes/terminal";
import terminalWorkspace from "./routes/terminal-workspace";
import vps from "./routes/vps";
import limits from "./routes/limits";
import codex from "./routes/codex";
import methods from "./routes/methods";
import update from "./routes/update";
import events from "./routes/events";
import deviceTokens from "./routes/device-tokens";
import bindings from "./routes/bindings";
import sync from "./routes/sync";
import presence from "./routes/presence";
import sessionResults from "./routes/session-results";
import sessionHistory from "./routes/session-history";
import sessionEvents from "./routes/session-events";
import config from "./routes/config";
import help from "./routes/help";
import tickets from "./routes/tickets";
import scheduler from "./routes/scheduler";
import lead from "./routes/lead";
import changelog from "./routes/changelog";
import customAgents from "./routes/custom-agents";
import members from "./routes/members";
import githubIssues from "./routes/github-issues";
import telegram from "./routes/telegram";
import webhooks from "./routes/webhooks";
import portal from "./routes/portal";
import portalChat from "./routes/portal-chat";
import portalChatAdmin from "./routes/portal-chat-admin";
import clientAccounts from "./routes/client-accounts";
import wsTickets from "./routes/ws-tickets";
import fastifyMultipart from "@fastify/multipart";
import authRoutes from "./routes/auth";
import setupRoutes from "./routes/setup";
import agentTokens from "./routes/agent-tokens";
import { COOKIE_NAME, lookupSession } from "./services/auth";
import { agentTokenFromReq, authenticateAgent } from "./services/agent-auth";
import { checkAgentCapability } from "./services/agent-capabilities";
import { clientRouteAllowed } from "./services/client-access";
import { detachAll } from "./services/pty";
import { auditTelegramGatewayResponse, guardTelegramGatewayRequest } from "./services/telegram/security";
import { stopTelegramRuntime } from "./services/telegram/runtime";
import { actorFromRequest, setActor } from "./services/webhooks/actor";
import { classifyIngress, loadIngressPolicy, trustProxyFromEnv } from "./services/ingress-policy";
import { MAX_WS_MESSAGE_BYTES, wsControlOrigins } from "./services/ws-admission";
import { resolveHardening, resolveHome } from "@hanoman/runner";
import { prisma } from "./db";

// Endpoint yang boleh diakses tanpa sesi (path lengkap termasuk prefix /api).
const PUBLIC = new Set([
  "GET /api/health",
  "GET /api/auth/status",
  "POST /api/auth/login",
  "POST /api/auth/setup",
  // SPEC-489 · panduan AI agent. Sengaja tanpa auth: byte-nya sudah publik di GitHub, dan
  // "cukup diberi link + token" hanya benar bila link-nya terbaca SEBELUM token disetel —
  // menggerbanginya berarti agen yang capability-nya kurang menerima 403 pada dokumen yang
  // justru menjelaskan arti 403 itu.
  "GET /api/agent-integration.md",
]);

// SPEC-884 · ADR-0139 · publik BERSYARAT: hanya selama `prisma.user.count() === 0`. Sengaja tak
// digabung ke PUBLIC di atas — daftar itu berarti "publik tanpa syarat", dan mencampurnya akan
// membuat permukaan setup terbuka selamanya.
const SETUP_PUBLIC = new Set([
  "GET /api/setup/status",
  "POST /api/setup",
]);

// requireAuth default true: prod (server.ts) selalu tergerbang. Test route yang tak
// menguji auth mem-build dgn { requireAuth: false } untuk melewati gate.
export function buildApp(
  { requireAuth = true, agentDocFile, env = process.env }:
  { requireAuth?: boolean; agentDocFile?: string | null; env?: Record<string, string | undefined> } = {},
): FastifyInstance {
  // SPEC-489 · diresolve DI SINI, bukan di route-nya: `import.meta.url` app.ts sedalam
  // `server/src` (tsx) DAN `server/dist` (esbuild) — satu kedalaman, jadi satu kandidat melayani
  // keduanya. Pola & alasan identik dengan pickWebDir di bawah.
  const docFile = agentDocFile !== undefined
    ? agentDocFile
    : pickGuideFile(dirname(fileURLToPath(import.meta.url)), env, existsSync);
  const ingress = loadIngressPolicy(env);
  const app = Fastify({ logger: false, trustProxy: trustProxyFromEnv(env) });
  app.addHook("onRequest", async (req, reply) => {
    const role = classifyIngress({ host: req.headers.host ?? "", method: req.method, url: req.url }, ingress);
    if (role === "denied") return reply.code(404).send({ error: "not found" });
    // SPEC-805 · link status yang terlanjur tersebar menunjuk host control (dibangun dari Host
    // request, yang untuk route triase selalu host dashboard). Tanpa ini host control menyajikan
    // shell SPA yang XHR-nya pasti 404 — "halaman tak bisa dibuka". Permukaan API Help tetap tak
    // pindah ke sini; hanya browsernya yang diarahkan ke origin publik.
    if (role === "control" && ingress.publicBase && req.url.startsWith("/help/"))
      return reply.redirect(`${ingress.publicBase}${req.url}`, 302);
  });
  // POST tanpa body masih boleh membawa content-type JSON; parser bawaan Fastify menjawab
  // 400 untuk body kosong. Perlakukan kosong sebagai undefined, sementara body sungguhan
  // tetap diparse.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body) return done(null, undefined);
    try { done(null, JSON.parse(body as string)); }
    catch (err) { (err as Error & { statusCode?: number }).statusCode = 400; done(err as Error, undefined); }
  });
  // fastify-plugin'd, jadi dekoratornya menurun ke scope /api di bawah.
  // SPEC-812 · `ws` mematikan permessage-deflate secara default, dan Cloudflare Tunnel meneruskan
  // frame WebSocket apa adanya — jadi aliran terminal berjalan tanpa kompresi sama sekali sampai
  // ke ponsel. Terukur pada aliran TUI agen sungguhan: 966 → 36 kbit/detik per pane (26,5×), dan
  // burst scrollback saat attach/reconnect 306 → 15,4 KB. Ongkosnya 15 ms CPU per 10 detik aliran.
  // `memLevel` 7 memberi rasio identik dengan 8 pada aliran ini dengan separuh memori deflate per
  // koneksi; `threshold` bawaan (1 KiB) menjaga frame kecil — `phase`, `exit` — tak membayar apa pun.
  // Arah masuk tetap tergerbang SPEC-761: `ws` menegakkan `maxPayload` atas ukuran TERDEKOMPRESI
  // dan membatalkan inflate begitu melewatinya, jadi frame kompresi-bom tak punya jalan masuk.
  app.register(websocket, {
    options: {
      maxPayload: MAX_WS_MESSAGE_BYTES,
      perMessageDeflate: { zlibDeflateOptions: { level: 6, memLevel: 7 }, concurrencyLimit: 10 },
    },
  });
  // Lepaskan klien tmux (PTY yatim menahan proses tetap hidup), tapi JANGAN bunuh sesinya:
  // claude yang sedang bekerja harus selamat dari restart server (ADR-0016).
  app.addHook("onClose", async () => { await stopTelegramRuntime(); detachAll(); });
  app.register(async (api) => {
    // Cookie parser lebih dulu supaya req.cookies terisi sebelum gate berjalan.
    await api.register(cookie);
    // SPEC-253 · lampiran tiket Help Center (multipart). throwFileSizeLimit:false → berkas oversize
    // di-truncate & di-skip di route (bukan menggagalkan seluruh submit). Batas final ditegakkan route.
    await api.register(fastifyMultipart, {
      throwFileSizeLimit: false,
      limits: { fileSize: 5 * 1024 * 1024, files: 12, fields: 20, fieldSize: 20_000 },
    });
    if (requireAuth) {
      api.addHook("onRequest", async (req, reply) => {
        // Isi req.user best-effort dulu (juga untuk endpoint publik spt /auth/status
        // yang ingin tahu siapa pemanggilnya), baru gerbang route non-publik.
        const token = req.cookies?.[COOKIE_NAME];
        const user = token ? await lookupSession(token) : null;
        if (user) req.user = user;
        const path = req.url.split("?")[0] ?? req.url;
        if (PUBLIC.has(`${req.method} ${path}`)) return;
        // SPEC-884 · ADR-0139 · wizard setup awal harus bisa dijangkau SEBELUM ada akun — ia yang
        // mendahului kelahiran akun pertama. Begitu satu akun ada ia jatuh ke gate cookie biasa;
        // syaratnya sama persis dengan `needsSetup`, jangan menambah gerbang kedua yang bisa
        // melenceng darinya. COUNT hanya dijalankan untuk dua path ini, bukan tiap request.
        if (SETUP_PUBLIC.has(`${req.method} ${path}`) && (await prisma.user.count()) === 0) return;
        // SPEC-617 · ADR-0110 · di bawah ini dulu berdiri satu baris tanpa syarat: "cookie sesi
        // = akses penuh". Letak gerbang klien paling awal DISENGAJA — dengan begitu allowlist
        // adalah pernyataan LENGKAP tentang apa yang boleh disentuh klien, tak ada urutan cabang
        // (sync/help) yang harus diingat pembaca berikutnya. Deny-by-default: route baru
        // tertutup bagi klien sampai sengaja dibuka.
        if (user?.role === "client" && !clientRouteAllowed(req.method, path))
          return reply.code(403).send({ error: "portal klien: baca-saja" });
        // SPEC-213 · ADR-0044/0046 · surface sync mesin-ke-mesin di-bypass gate cookie; tiap
        // route /api/sync di-enforce device token Bearer sendiri; credential query ditolak.
        // SPEC-268 · KECUALI POST /api/sync/now — pemicu manual = aksi UI, digerbangi cookie gate
        // (dan agent-deny "cookie-only" untuk /sync), bukan device token.
        // SPEC-270 · KECUALI /api/sync/conflicts* — antrean rekonsil = aksi UI, cookie-only juga.
        // SPEC-799 · KECUALI GET /api/sync/pending — umpan balik hapus tertunda = aksi UI, cookie-only.
        if (path.startsWith("/api/sync") && path !== "/api/sync/now" && path !== "/api/sync/pending"
          && !path.startsWith("/api/sync/conflicts")) return;
        // SPEC-253 · ADR-0062 · halaman/submit/status Help Center dipanggil pengguna akhir tanpa sesi
        // login; route /api/help di-otorisasi helpEnabled + kunci opaque tiket sendiri (pengecualian sah).
        // SPEC-909 · ADR-0146 · event hook sesi: kredensialnya token turunan per sesi, di-enforce
        // route-nya sendiri (pola /api/sync device token).
        //
        // Bypass ini mendahului cabang agent token di bawah, jadi `capabilityForRoute` TAK PERNAH
        // dieksekusi untuk path ini: agent token ditolak route-nya dengan **401** (token sesi tak
        // cocok), bukan 403 "cookie session required". Petanya tetap `COOKIE_ONLY` supaya jawabannya
        // benar bila urutan cabang ini kelak berubah — tapi jangan mengandalkannya sebagai lapis
        // kedua yang aktif hari ini. Yang menutup pintunya adalah HMAC di route.
        if (path === "/api/session-events") return;
        if (path.startsWith("/api/help")) return;
        if (user) return; // cookie sesi = akses penuh (tak ada RBAC, konsisten model sekarang)
        // SPEC-257 · ADR-0065 · jalur auth kedua: agent token Bearer. WS browser memakai tiket sekali pakai.
        const agentTok = agentTokenFromReq(req);
        if (agentTok) {
          const agent = await authenticateAgent(agentTok);
          if (agent) {
            req.agent = agent;
            const verdict = checkAgentCapability(agent.capabilities, req.method, path);
            if (verdict.ok) return;
            return reply.code(403).send(
              verdict.reason === "cookie-only"
                ? { error: "cookie session required" }
                : { error: "capability required", need: verdict.need },
            );
          }
        }
        return reply.code(401).send({ error: "unauthorized" });
      });
    }
    // SPEC-476 · berjalan sesudah onRequest auth/capability agar identitas AgentToken sudah ada.
    // Cookie dan AgentToken biasa lewat apa adanya; hanya token gateway runtime yang wajib correlation
    // dan confirmation untuk aksi sulit dibatalkan.
    api.addHook("preHandler", guardTelegramGatewayRequest);
    // SPEC-481 · ADR-0100 · stempel aktor untuk amplop webhook. Dipasang di `preHandler` (bukan
    // `onRequest`) supaya `req.user`/`req.agent` sudah terisi gate auth di atas; tanpa itu setiap
    // peristiwa yang lahir dari request akan berkata `system` dan riwayatnya kehilangan pelakunya.
    api.addHook("preHandler", async (req) => {
      setActor(actorFromRequest({ user: req.user ?? null, agent: req.agent ?? null }));
    });
    api.addHook("onResponse", auditTelegramGatewayResponse);
    // SPEC-884 · ADR-0139 · bukti setup token menjaga instance yang minta dikeraskan. Di instalasi
    // biasa ia justru menutup pintu terakhir: orang yang baru `npm i -g hanoman` harus membaca
    // berkas di HANOMAN_HOME lewat shell sebelum bisa memakai dashboard-nya sendiri.
    await api.register(authRoutes, { bootstrapRequired: resolveHardening(env), home: resolveHome(env) });
    await api.register(setupRoutes, { home: resolveHome(env), env });
    await api.register(health);
    await api.register(agentDoc, { file: docFile });   // SPEC-489 · panduan AI agent (PUBLIC)
    await api.register(projects);
    await api.register(specs);
    await api.register(notifications);
    await api.register(settings);
    await api.register(docs);
    await api.register(ide);
    await api.register(fs);
    const wsOptions = { allowedOrigins: wsControlOrigins(env) };
    await api.register(terminal, wsOptions);
    await api.register(terminalWorkspace);
    await api.register(vps);
    await api.register(limits);
    await api.register(update);
    await api.register(events, wsOptions);
    await api.register(wsTickets, { allowTestPrincipal: !requireAuth && env.NODE_ENV === "test" });
    await api.register(deviceTokens);
    await api.register(agentTokens);   // SPEC-257 · kelola agent token (cookie-only)
    await api.register(bindings);
    await api.register(sync);
    await api.register(presence);   // SPEC-919 · ADR-0147 · muat awal halaman Klien
    await api.register(sessionResults);
    await api.register(sessionHistory);  // SPEC-362 · riwayat sesi terminal (di belakang gate cookie)
    await api.register(sessionEvents);   // SPEC-909 · event hook sesi (token sesi, gate di-bypass di atas)
    await api.register(config);
    await api.register(help);     // SPEC-253 · Help Center publik (gate di-bypass di atas)
    await api.register(tickets, { publicBase: ingress.publicBase });  // SPEC-253 · triase (di belakang gate cookie)
    await api.register(scheduler);  // SPEC-294 · config/state scheduler (di belakang gate cookie)
    await api.register(codex);      // SPEC-339 · versi codex CLI untuk peringatan model 5.6
    await api.register(methods);    // SPEC-739 · ADR-0114 · kesiapan skill metode per agen
    await api.register(lead);       // SPEC-409 · ADR-0091 · hanoman-lead (cookie + capability `lead`)
    await api.register(customAgents); // SPEC-450 · ADR-0094 · katalog custom agent (capability `agents`)
    await api.register(githubIssues); // SPEC-471 · ADR-0095 · tarik & triase issue GitHub (capability `support`)
    await api.register(telegram);     // SPEC-476 · ADR-0096 · context/memory/reply/audit Telegram
    await api.register(webhooks);     // SPEC-481 · ADR-0100 · webhook keluar (cookie-only)
    await api.register(changelog);    // SPEC-516 · ADR-0105 · changelog per project (capability `docs`)
    await api.register(portal);       // SPEC-617 · ADR-0110 · portal klien baca-saja (cookie-only)
    await api.register(portalChat);   // SPEC-854 · ADR-0129 · chat portal klien
    await api.register(portalChatAdmin); // SPEC-854 · ADR-0129 · transkrip & PRD draft (operator)
    await api.register(clientAccounts); // SPEC-617 · ADR-0110 · kelola akun klien (cookie-only)
    await api.register(members);      // SPEC-945 · ADR-0150 · direktori orang papan tim (cookie-only)
  }, { prefix: "/api" });

  // Prod: serve the built dashboard from one process; SPA-fallback to
  // index.html for non-/api routes (api 404s stay JSON, never a fake page).
  // SPEC-398 · ADR-0087 · direktorinya dipilih pickWebDir (paket npm `web/` atau checkout
  // `src/dist`); absen → server tetap jalan sebagai API saja, bukan crash.
  if (shouldServeWeb(env)) {
    const dist = pickWebDir(dirname(fileURLToPath(import.meta.url)), env, existsSync);
    if (dist) {
      app.register(fastifyStatic, { root: dist });
      app.setNotFoundHandler((req, reply) =>
        req.url.startsWith("/api") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"));
    }
  }
  return app;
}
