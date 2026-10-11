// ADR-0196 (kredensial & akun) · ADR-0197 (kendali jarak jauh, relay, log, presence) · ADR-0198
// (metrik custom agent) · katalog tool permukaan ADMIN yang dulu cookie-only.
//
// Pemilik repo MEMINTA permukaan ini dibungkus, jadi keputusan ADR-0065/0097/0099/0100/0110/0146/
// 0147/0165 yang mengecualikannya diamandemen. Yang menggantikan larangan lama BUKAN kelonggaran,
// melainkan tiga lapis:
//   1. capability BARU yang opt-in — tak diimplikasikan capability lama mana pun (agent.ts);
//   2. SEMUA tool tulis bermode `danger` (hilang dari tingkat default; bukan kontrol keamanan);
//   3. pagar tak-eskalasi-diri ditegakkan di HANDLER server (routes/agent-tokens.ts dkk.): token
//      hasil cetak ⊆ hak pencetaknya, token sendiri tak bisa diubah/dicabut, grant jarak jauh ⊆ hak
//      pemanggil. Skema tool di sini bukan tempat pagar itu hidup.
//
// TIDAK dibungkus (tak bisa bermakna secara teknis, bukan kelalaian): `auth/{status,setup,login,
// logout}` (cookie sesi & bootstrap), `sync/*` (Bearer device-token mesin-ke-mesin),
// `POST /session-events` (token HMAC turunan per sesi), `terminal/workspace` (tata letak browser
// per akun), WebSocket relay `/devices/:id/relay/**/ws`.
import { CAPABILITY_IDS } from "../agent";
import { RELAY_METHODS, REMOTE_CAPABILITIES } from "../relay";
import { LOG_LANES, LOG_LEVELS } from "../logs";
import { PAGE_PARAMS, bool, enumStr, int, obj, str } from "../mcp-schema";
import { enc, localPage, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

const ONCE =
  "Plaintext token hanya ada di balasan INI dan tak bisa diambil lagi — simpan hanya di tempat rahasia, jangan di dokumen, commit, atau log.";

const capArray = (what: string) => ({
  type: "array", description: what, items: { type: "string", enum: CAPABILITY_IDS },
});

const view = (r: Record<string, unknown>) => r;

// ── agent token (tokens:*) ──────────────────────────────────────────────────────────────────
const TOKENS: readonly McpToolDef[] = [
  {
    name: "hanoman_agent_tokens_list",
    title: "Daftar agent token",
    description:
      "Seluruh agent token instance: nama, prefix (bukan token), capability, aktif/dicabut, siapa pencetaknya (`createdBy`: id akun, atau `agent:<id>` bila dicetak agent token lain), dan kapan terakhir dipakai. Plaintext token TIDAK PERNAH ikut.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "tokens:read", samplePath: "/agent-tokens", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/agent-tokens" }),
    shape: (raw, a) => localPage(raw, a, view),
  },
  {
    name: "hanoman_agent_token_capabilities",
    title: "Katalog capability",
    description:
      "Katalog capability yang bisa dicentang pada agent token: id, tingkat akses (`read`/`write`/`danger`), penanda risiko (`rce`/`exec`), dan label. Pakai ini untuk memilih `capabilities` sebelum hanoman_agent_token_create.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "tokens:read", samplePath: "/agent-tokens/capabilities", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/agent-tokens/capabilities" }),
    shape: (raw) => {
      const list = (raw as { capabilities?: Record<string, unknown>[] })?.capabilities ?? [];
      return {
        items: list.map((c) => ({ id: c.id, access: c.access, risk: c.risk ?? null, label: c.label })),
        total: list.length,
      };
    },
  },
  {
    name: "hanoman_agent_token_create",
    title: "Cetak agent token (BERBAHAYA)",
    description:
      `BERBAHAYA — mencetak kredensial BARU. Pagar server: \`capabilities\` token baru HARUS himpunan-bagian dari capability yang dimiliki token pemanggil (write ⊇ read; danger hanya bila pemanggil memegang persis danger itu) — selebihnya 403 dengan daftar \`exceeds\`. ${ONCE} Dicatat di log event sebagai dicetak oleh token pemanggil. Hanya muncul saat tingkat \`--danger\` menyala.`,
    inputSchema: obj({
      properties: {
        name: str("Nama token, mis. `agent-ci`.", { minLength: 1 }),
        capabilities: capArray("Capability token baru. Tak boleh melebihi milik token pemanggil."),
      },
      required: ["name", "capabilities"],
    }),
    mode: "danger", capability: "tokens:write", revealsSecret: true,
    samplePath: "/agent-tokens", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/agent-tokens",
      body: { name: String(a.name), capabilities: Array.isArray(a.capabilities) ? a.capabilities : [] },
    }),
    shape: (raw) => ({ ...(raw as object), note: ONCE }),
  },
  {
    name: "hanoman_agent_token_update",
    title: "Ubah agent token (BERBAHAYA)",
    description:
      "BERBAHAYA — mengubah nama, capability, atau status aktif satu agent token. Pagar server (403 bila dilanggar): (1) `capabilities` baru ⊆ milik pemanggil; (2) token TARGET tak boleh lebih berkuasa dari pemanggil — capability-nya harus ⊆ milik pemanggil; (3) token pemanggil SENDIRI tak bisa diubah (minta manusia). Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        token: str("Id agent token, dari hanoman_agent_tokens_list (bukan plaintext token)."),
        name: str("Nama baru.", { minLength: 1 }),
        capabilities: capArray("Himpunan capability BARU (mengganti, bukan menambah)."),
        enabled: bool("`false` menonaktifkan sementara; `true` mengaktifkan lagi."),
      },
      required: ["token"],
    }),
    mode: "danger", capability: "tokens:write",
    samplePath: "/agent-tokens/t1", sampleMethod: "PATCH",
    build: (a) => ({
      method: "PATCH", path: `/agent-tokens/${enc(String(a.token))}`,
      body: {
        ...(s(a.name) ? { name: s(a.name) } : {}),
        ...(Array.isArray(a.capabilities) ? { capabilities: a.capabilities } : {}),
        ...(typeof a.enabled === "boolean" ? { enabled: a.enabled } : {}),
      },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_agent_token_revoke",
    title: "Cabut agent token (BERBAHAYA)",
    description:
      "BERBAHAYA — mencabut satu agent token secara permanen (tak bisa dipulihkan; cetak baru bila perlu). Pagar server: token pemanggil SENDIRI tak bisa dicabut, dan token yang lebih berkuasa dari pemanggil (capability-nya tak ⊆ milik pemanggil) ditolak 403. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { token: str("Id agent token, dari hanoman_agent_tokens_list.") }, required: ["token"] }),
    mode: "danger", capability: "tokens:write",
    samplePath: "/agent-tokens/t1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/agent-tokens/${enc(String(a.token))}` }),
    shape: (raw) => raw,
  },
];

// ── device token (devices:*) ────────────────────────────────────────────────────────────────
const DEVICES: readonly McpToolDef[] = [
  {
    name: "hanoman_device_tokens_list",
    title: "Daftar device token",
    description:
      "Device token (identitas mesin untuk sync workspace & relay) milik AKUN yang menerbitkan agent token ini: nama, kapan terakhir terlihat, dicabut atau belum. Id-nya adalah `deviceId` untuk hanoman_device_relay. Plaintext TIDAK PERNAH ikut. 409 bila agent token ini tak punya akun admin penerbit.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "devices:read", samplePath: "/device-tokens", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/device-tokens" }),
    shape: (raw, a) => localPage(raw, a, view),
  },
  {
    name: "hanoman_device_token_create",
    title: "Cetak device token (BERBAHAYA)",
    description:
      `BERBAHAYA — mencetak kredensial mesin BARU atas nama akun admin yang menerbitkan agent token ini. Pemegangnya bisa menyinkronkan workspace dan menyambung relay. ${ONCE} Dicatat di log event. Hanya muncul saat tingkat \`--danger\` menyala.`,
    inputSchema: obj({ properties: { name: str("Nama mesin, mis. `laptop-kantor`.", { minLength: 1 }) }, required: ["name"] }),
    mode: "danger", capability: "devices:write", revealsSecret: true,
    samplePath: "/device-tokens", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: "/device-tokens", body: { name: String(a.name) } }),
    shape: (raw) => ({ ...(raw as object), note: ONCE }),
  },
  {
    name: "hanoman_device_token_revoke",
    title: "Cabut device token (BERBAHAYA)",
    description:
      "BERBAHAYA — mencabut satu device token milik akun penerbit; socket sync & relay mesin itu ditutup seketika. Token milik akun lain menjawab 404. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { device: str("Id device token, dari hanoman_device_tokens_list.") }, required: ["device"] }),
    mode: "danger", capability: "devices:write",
    samplePath: "/device-tokens/d1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/device-tokens/${enc(String(a.device))}` }),
    shape: (raw) => raw,
  },
];

// ── akun & password (access:*) ──────────────────────────────────────────────────────────────
const ACCESS: readonly McpToolDef[] = [
  {
    name: "hanoman_users_list",
    title: "Daftar akun",
    description:
      "Seluruh akun instance: id, email, role (`admin` operator atau `client` portal klien), dan kapan dibuat. Hash password tidak pernah ikut.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "access:read", samplePath: "/auth/users", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/auth/users" }),
    shape: (raw, a) => localPage(raw, a, view),
  },
  {
    name: "hanoman_user_create",
    title: "Buat akun admin (BERBAHAYA)",
    description:
      "BERBAHAYA — membuat akun ADMIN dengan password langsung (tanpa undangan email). Akun admin punya akses penuh dashboard, termasuk semua yang cookie-only: capability `access:admin` setara menyerahkan seluruh instance. Password minimal 8 karakter; ia tak pernah dikembalikan, dan disensor dari keluaran. Dicatat di log event. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        email: str("Email akun (unik)."),
        password: str("Password awal, minimal 8 karakter.", { minLength: 8 }),
      },
      required: ["email", "password"],
    }),
    mode: "danger", capability: "access:admin", samplePath: "/auth/users", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: "/auth/users", body: { email: String(a.email), password: String(a.password) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_user_delete",
    title: "Hapus akun (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus satu akun beserta sesi login-nya. Admin TERAKHIR tak bisa dihapus (400). Tak ada jalan pulang. Dicatat di log event. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { user: str("Id akun, dari hanoman_users_list.") }, required: ["user"] }),
    mode: "danger", capability: "access:admin", samplePath: "/auth/users/u1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/auth/users/${enc(String(a.user))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_user_password_reset",
    title: "Setel ulang password akun (BERBAHAYA)",
    description:
      "BERBAHAYA — menyetel ulang password akun LAIN tanpa password lama, lalu mencabut semua sesi login akun itu. Tak ada cookie diterbitkan ke pemanggil. Password disensor dari keluaran. Dicatat di log event. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        user: str("Id akun, dari hanoman_users_list."),
        newPassword: str("Password baru, minimal 8 karakter.", { minLength: 8 }),
      },
      required: ["user", "newPassword"],
    }),
    mode: "danger", capability: "access:admin", samplePath: "/auth/change-password", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: "/auth/change-password", body: { userId: String(a.user), newPassword: String(a.newPassword) } }),
    shape: (raw) => raw,
  },
];

// ── kendali jarak jauh & relay ──────────────────────────────────────────────────────────────
const bodyObj = (description: string) => ({ type: "object", description, additionalProperties: true });

const REMOTE: readonly McpToolDef[] = [
  {
    name: "hanoman_remote_control_get",
    title: "Grant kendali jarak jauh",
    description:
      "Grant kendali jarak jauh mesin INI (menyala/mati + capability yang diberikan ke hub), lajur pengiriman log ke hub (`event`/`server`/`transcript`), status tautan relay, dan audit terakhir perubahan grant.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "remote:read", samplePath: "/remote-control", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/remote-control" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_remote_control_set",
    title: "Ubah grant kendali jarak jauh (BERBAHAYA)",
    description:
      "BERBAHAYA — ESKALASI RCE: grant yang menyala membuat hub menjalankan/mengendalikan agen di mesin ini. Blok `control` butuh `enabled` DAN `capabilities` sekaligus; blok log butuh ketiga flag sekaligus (kirim hanya blok yang ingin diubah). Pagar server: `capabilities` ⊆ capability pemanggil (403 + `exceeds` bila tidak), dan mengubah blok log butuh juga `logs:write`. Grant tak kosong wajib memuat `sessions:read`. Dicatat di log event. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        enabled: bool("Menyalakan/mematikan grant. Wajib bersama `capabilities`."),
        capabilities: { type: "array", description: "Capability yang diberikan ke hub (subset REMOTE_CAPABILITIES). Wajib bersama `enabled`.", items: { type: "string", enum: REMOTE_CAPABILITIES } },
        logEvent: bool("Kirim log event ke hub. Wajib bersama logServer & logTranscript."),
        logServer: bool("Kirim log server ke hub."),
        logTranscript: bool("Kirim transkrip sesi ke hub (data keluar)."),
      },
    }),
    mode: "danger", capability: "remote:control", samplePath: "/remote-control", sampleMethod: "PUT",
    build: (a) => {
      const hasControl = typeof a.enabled === "boolean" || Array.isArray(a.capabilities);
      const hasLogs = [a.logEvent, a.logServer, a.logTranscript].some((v) => typeof v === "boolean");
      return {
        method: "PUT", path: "/remote-control",
        body: {
          ...(hasControl ? { control: { enabled: a.enabled, capabilities: a.capabilities } } : {}),
          ...(hasLogs ? { logs: { event: a.logEvent, server: a.logServer, transcript: a.logTranscript } } : {}),
        },
      };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_device_relay",
    title: "Relay aksi ke mesin lain (BERBAHAYA)",
    description:
      "BERBAHAYA — EKSEKUSI LINTAS MESIN: meneruskan satu request ke mesin lain lewat relay hub, atas nama operator (aktor ditandai `agent:<id>`). Allowlist route-nya ketat dan ditegakkan mesin tujuan (mis. GET /terminal/sessions, POST /terminal/sessions dengan `spec`, POST /terminal/sessions/:id/steer, GET /specs/:id/docs, POST /specs/:id/done); di luar itu 403 `relay route not allowed`, dan grant mesin tujuan menentukan sisanya. `path` relatif terhadap `/api`. WebSocket (`…/ws`) tak didukung. 503 = mesin offline, 504 = timeout. Dicatat di log event hub. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        device: str("Id device (device token), dari hanoman_device_tokens_list."),
        method: enumStr(RELAY_METHODS, "Method HTTP."),
        path: str("Path di mesin tujuan relatif terhadap /api, mis. `/terminal/sessions`. Tanpa `..`, `?`, atau `#`."),
        query: bodyObj("Parameter query (nilai string)."),
        body: bodyObj("Body JSON (untuk POST/PUT/PATCH)."),
      },
      required: ["device", "method", "path"],
    }),
    mode: "danger", capability: "relay:exec",
    samplePath: "/devices/d1/relay/terminal/sessions", sampleMethod: "POST",
    build: (a) => {
      const method = String(a.method).toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      const raw = String(a.path ?? "").replace(/^\/api(?=\/)/, "");
      const p = raw.startsWith("/") ? raw : `/${raw}`;
      // Cermin `zRelayPath` + larangan WS di server; ditolak lebih dulu supaya tak ada request sia-sia.
      if (/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\|[?#]/i.test(p) || /\/ws$/.test(p)) return null;
      const q = a.query && typeof a.query === "object"
        ? query(Object.fromEntries(Object.entries(a.query as Record<string, unknown>).map(([k, v]) => [k, v === undefined || v === null ? undefined : String(v)])))
        : undefined;
      const withBody = method !== "GET" && method !== "DELETE" && a.body !== undefined;
      return {
        method, path: `/devices/${enc(String(a.device))}/relay${p}`,
        ...(q && Object.keys(q).length ? { query: q } : {}),
        ...(withBody ? { body: a.body } : {}),
      };
    },
    shape: (raw) => raw,
  },
];

// ── log terpusat (logs:*), presence (presence:read), metrik custom agent (metrics:*) ─────────
const OBSERVE: readonly McpToolDef[] = [
  {
    name: "hanoman_logs_search",
    title: "Cari log lintas device",
    description:
      "Mencari log terpusat lintas device (lajur `event`/`server`/`transcript`). `from` & `to` WAJIB (ISO 8601) dan rentangnya ≤ 31 hari. Berhalaman dengan kursor: ulangi dengan `cursor` dari `nextCursor` sampai kosong. Entri dengan `hasTranscript: true` bisa dibaca penuh lewat hanoman_log_transcript.",
    inputSchema: obj({
      properties: {
        from: str("Awal rentang, ISO 8601 mis. `2026-10-01T00:00:00Z`."),
        to: str("Akhir rentang, ISO 8601. Maksimum 31 hari dari `from`."),
        device: str("Saring menurut id device; `local` = mesin ini."),
        project: str("Saring menurut id project."),
        spec: str("Saring menurut id backlog."),
        lane: enumStr(LOG_LANES, "Saring menurut lajur."),
        level: enumStr(LOG_LEVELS, "Tingkat minimum (`warn` mencakup `warn` dan `error`)."),
        kind: str("Saring menurut jenis entri, mis. `grant.changed`."),
        q: str("Kata kunci, maksimum 200 karakter."),
        cursor: str("Kursor opaque dari `nextCursor` halaman sebelumnya."),
        limit: int("Item per halaman, 1–200. Default 200.", { minimum: 1, maximum: 200 }),
      },
      required: ["from", "to"],
    }),
    mode: "read", capability: "logs:read", samplePath: "/logs", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/logs",
      query: query({
        from: s(a.from), to: s(a.to), deviceId: s(a.device), projectId: s(a.project), specId: s(a.spec),
        lane: s(a.lane), level: s(a.level), kind: s(a.kind), q: s(a.q), cursor: s(a.cursor), limit: n(a.limit)?.toString(),
      }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_log_transcript",
    title: "Transkrip dari log",
    description:
      "Teks penuh transkrip yang melekat pada satu entri log (`hasTranscript: true` di hanoman_logs_search). Bisa sangat panjang — balasan dipotong di batas ukuran dan ditandai `truncated`. 404 bila entri tak punya transkrip.",
    inputSchema: obj({ properties: { log: int("Id numerik entri log (`id`), dari hanoman_logs_search.", { minimum: 1 }) }, required: ["log"] }),
    mode: "read", capability: "logs:read", samplePath: "/logs/1/transcript", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/logs/${enc(String(a.log))}/transcript` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_logs_retention_get",
    title: "Retensi log",
    description: "Retensi log terpusat: `eventDays`, `serverDays`, `transcriptDays` (hari) dan `maxBytes` (plafon ukuran).",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "logs:read", samplePath: "/logs/retention", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/logs/retention" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_logs_retention_set",
    title: "Ubah retensi log (BERBAHAYA)",
    description:
      "BERBAHAYA — memendekkan retensi MENGHAPUS jejak audit lebih awal dan tak bisa dipulihkan. Keempat field wajib (field yang hilang akan kembali ke default server, bukan dipertahankan) — baca dulu dengan hanoman_logs_retention_get. Perubahan oleh agent token dicatat di log event SEBELUM nilainya berubah. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        eventDays: int("Hari simpan lajur event, 1–365.", { minimum: 1, maximum: 365 }),
        serverDays: int("Hari simpan lajur server, 1–365.", { minimum: 1, maximum: 365 }),
        transcriptDays: int("Hari simpan transkrip, 1–365.", { minimum: 1, maximum: 365 }),
        maxBytes: int("Plafon ukuran total log dalam byte, 16 MiB–4 GiB.", { minimum: 16 * 1024 ** 2, maximum: 4 * 1024 ** 3 }),
      },
      required: ["eventDays", "serverDays", "transcriptDays", "maxBytes"],
    }),
    mode: "danger", capability: "logs:write", samplePath: "/logs/retention", sampleMethod: "PUT",
    build: (a) => ({
      method: "PUT", path: "/logs/retention",
      body: { eventDays: a.eventDays, serverDays: a.serverDays, transcriptDays: a.transcriptDays, maxBytes: a.maxBytes },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_presence_get",
    title: "Presence: sesi hidup lintas device",
    description:
      "Peta pekerjaan yang sedang berjalan di SELURUH mesin operator: device mana online, sesi apa hidup di mana, dan keadaan tautan kendalinya. Satu-satunya cara agen melihat sesi di mesin lain; sesi mesin ini saja ada di hanoman_sessions_list.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "presence:read", samplePath: "/presence", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/presence" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_agent_metrics",
    title: "Metrik custom agent",
    description:
      "Metrik pemakaian custom agent (jumlah invokasi, durasi, status) dan disposisi manusia (accepted/partial/rejected/false-positive), dengan filter project & rentang waktu opsional. Id invokasi di sini dipakai hanoman_agent_invocation_disposition.",
    inputSchema: obj({
      properties: {
        project: str("Saring menurut id project."),
        from: str("Awal rentang, ISO 8601 dengan zona waktu."),
        to: str("Akhir rentang, ISO 8601 dengan zona waktu; harus ≥ `from`."),
      },
    }),
    mode: "read", capability: "metrics:read", samplePath: "/custom-agents/metrics", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/custom-agents/metrics", query: query({ projectId: s(a.project), from: s(a.from), to: s(a.to) }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_agent_invocation_disposition",
    title: "Setel disposisi invokasi agen (BERBAHAYA)",
    description:
      "BERBAHAYA — mengubah vonis atas satu invokasi custom agent. Disposisi adalah penilaian MANUSIA atas mutu agen; jangan dipakai untuk menilai pekerjaan agen itu sendiri atau pekerjaanmu — itu merusak sinyal mutunya. Menimpa disposisi sebelumnya; dicatat di log event. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        invocation: str("Id invokasi, dari hanoman_agent_metrics."),
        disposition: enumStr(["accepted", "partial", "rejected", "false-positive"], "Vonis atas invokasi."),
        note: str("Catatan, maksimum 500 karakter.", { maxLength: 500 }),
        reworkRequired: bool("Apakah hasilnya perlu dikerjakan ulang."),
      },
      required: ["invocation", "disposition"],
    }),
    mode: "danger", capability: "metrics:write",
    samplePath: "/custom-agents/invocations/i1", sampleMethod: "PATCH",
    build: (a) => ({
      method: "PATCH", path: `/custom-agents/invocations/${enc(String(a.invocation))}`,
      body: {
        disposition: String(a.disposition),
        ...(s(a.note) ? { note: s(a.note) } : {}),
        ...(typeof a.reworkRequired === "boolean" ? { reworkRequired: a.reworkRequired } : {}),
      },
    }),
    shape: (raw) => raw,
  },
];

export const ADMIN_TOOLS: readonly McpToolDef[] = [...TOKENS, ...DEVICES, ...ACCESS, ...REMOTE, ...OBSERVE];
