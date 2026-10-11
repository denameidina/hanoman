// ADR-0193 · ADR-0194 · katalog tool permukaan INTEGRASI yang dulu cookie-only: kredensial Telegram
// (ADR-0097), webhook keluar (ADR-0100), dan akun klien portal (ADR-0110). Pemilik repo meminta
// ketiganya dibungkus; keputusan lama yang mengecualikannya DIBALIK lewat capability BARU yang
// opt-in — bukan lewat memperlebar capability yang sudah ada:
//   telegram:admin (danger) · webhooks:read|write · clients:read|write
//
// Aturan yang berlaku untuk SEMUA tool tulis di sini, dan ditegakkan di handler SERVER (bukan di
// katalog — katalog hanya klien):
//   · tak ada eskalasi diri: yang mengubah kredensial gateway tak boleh memberi gateway capability
//     lebih besar daripada milik pemanggil (routes/telegram.ts);
//   · `allowPrivate` webhook (SSRF ke jaringan internal) tetap keputusan MANUSIA — parameternya
//     sengaja tak ada di sini dan server menolaknya bila agent token mencoba mengirimnya;
//   · rahasia yang dibangkitkan server (secret webhook) tampil SEKALI persis seperti REST; rahasia
//     yang dikirim pemanggil (password, bot token) disensor dari keluaran tool (`secretArgs`).
//
// Portal klien (ADR-0195) hidup di berkas tetangga `integrations-portal.ts` dan dirakit di bawah.
import { PAGE_PARAMS, bool, int, obj, str, strArray } from "../mcp-schema";
import { enc, localPage, n, query, s } from "./helpers";
import { PORTAL_TOOLS } from "./integrations-portal";
import type { Args, McpToolDef } from "./types";

// ───────────────────────── Telegram · kredensial (telegram:admin) ─────────────────────────

const TG_ADMIN = "telegram:admin";
const TG_DANGER =
  " Menuntut capability `telegram:admin` (berakses danger, tak diimplikasikan `telegram:write`). Hanya muncul saat tingkat `--danger` menyala.";

const TELEGRAM_ADMIN: readonly McpToolDef[] = [
  {
    name: "hanoman_telegram_settings_get",
    title: "Kredensial Telegram (BERBAHAYA)",
    description:
      "BERBAHAYA — membaca isian kredensial gateway Telegram: bot token dan AgentToken gateway hanya tampil TERSAMAR (`masked`) + `hasValue`, tak pernah utuh; allowlist user id dan chat target tampil apa adanya. `source` menyebut asalnya (`db`, `env`, atau `default`)." + TG_DANGER,
    inputSchema: obj({ properties: {} }),
    mode: "danger", capability: TG_ADMIN,
    samplePath: "/telegram/settings", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/telegram/settings" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_settings_set",
    title: "Ubah kredensial Telegram (BERBAHAYA)",
    description:
      "BERBAHAYA — mengubah kredensial gateway Telegram lalu memuat ulang gateway. MENAMBAL: hanya field yang kamu kirim yang berubah; secret berisi string kosong berarti pertahankan nilai lama. AgentToken gateway wajib memegang seluruh capability yang dituntut gateway. ATURAN ANTI-ESKALASI (ditegakkan server, 403): token gateway efektif — yang baru kamu kirim, atau yang sudah tersimpan — TIDAK boleh memegang capability yang tak dimiliki token pemanggil, karena allowlist/bot token menentukan siapa yang bisa memerintah gateway itu. Nilai bot token & AgentToken yang kamu kirim disensor dari keluaran tool." + TG_DANGER,
    inputSchema: obj({
      properties: {
        botToken: str("Bot token dari BotFather (`<angka>:<secret>`). Kosong = pertahankan yang lama."),
        agentToken: str("Plaintext `hnm_agt_…` milik token gateway — BUKAN hash. Harus memegang seluruh capability gateway. Kosong = pertahankan yang lama."),
        allowedUserIds: str("Allowlist user id Telegram: angka dipisah koma/spasi. Hanya mereka yang bisa memerintah gateway."),
        targetChatId: str("Chat/channel id tujuan notifikasi & uji koneksi."),
      },
    }),
    mode: "danger", capability: TG_ADMIN,
    samplePath: "/telegram/settings", sampleMethod: "PUT",
    secretArgs: ["botToken", "agentToken"],
    build: (a) => {
      const body: Record<string, string> = {};
      const map: Record<string, string> = {
        botToken: "HANOMAN_TELEGRAM_BOT_TOKEN", agentToken: "HANOMAN_TELEGRAM_AGENT_TOKEN",
        allowedUserIds: "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", targetChatId: "HANOMAN_TELEGRAM_TARGET_CHAT_ID",
      };
      for (const [arg, key] of Object.entries(map)) if (s(a[arg]) !== undefined) body[key] = s(a[arg])!;
      return { method: "PUT", path: "/telegram/settings", body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_test",
    title: "Uji koneksi Telegram (BERBAHAYA)",
    description:
      "BERBAHAYA — menguji bot token dengan `getMe` lalu MENGIRIM satu pesan uji sungguhan ke chat target operator di Telegram (dibaca manusia, tak bisa ditarik). Hasilnya juga melaporkan kesiapan jalur MASUK gateway (`inbound`): hijau tanpa `inbound.ok` berarti gateway tetap diam." + TG_DANGER,
    inputSchema: obj({ properties: {} }),
    mode: "danger", capability: TG_ADMIN,
    samplePath: "/telegram/test", sampleMethod: "POST",
    build: () => ({ method: "POST", path: "/telegram/test" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_credentials_clear",
    title: "Hapus kredensial Telegram (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus kredensial Telegram yang tersimpan di database (bot token, AgentToken gateway, allowlist, chat target) lalu memuat ulang gateway, yang berarti gateway BERHENTI. Nilai dari `.env` tidak terhapus dan akan dipakai lagi — balasan menyebutnya di `envFallback`. Tak ada jalan pulang: nilai lama harus diketik ulang." + TG_DANGER,
    inputSchema: obj({ properties: {} }),
    mode: "danger", capability: TG_ADMIN,
    samplePath: "/telegram/credentials", sampleMethod: "DELETE",
    build: () => ({ method: "DELETE", path: "/telegram/credentials" }),
    shape: (raw) => raw,
  },
];

// ───────────────────────── Webhook keluar (webhooks:read | webhooks:write) ─────────────────────────

const WEBHOOK_ID = str("Id endpoint webhook, seperti muncul di hanoman_webhooks_list.");
const WH_DANGER =
  " Menuntut capability `webhooks:write`. Hanya muncul saat tingkat `--danger` menyala.";

const EVENTS = strArray(
  "Jenis peristiwa yang dikirim: `*` (semua), `<keluarga>.*` (mis. `spec.*`), atau jenis persis (mis. `spec.created`). Daftar yang sah ada di `eventTypes` hanoman_webhooks_list; salah ketik ditolak 400.",
);
const PROJECT_IDS = strArray(
  "Batasi ke peristiwa project tertentu (id project). Peristiwa tanpa project TIDAK dikirim ke endpoint yang dibatasi.",
);

const WEBHOOKS: readonly McpToolDef[] = [
  {
    name: "hanoman_webhooks_list",
    title: "Endpoint webhook keluar",
    description:
      "Daftar endpoint webhook keluar (URL, peristiwa, project yang disaring, status, jumlah antrean, kegagalan beruntun) beserta `eventTypes` yang sah. Secret penandatanganan TIDAK pernah ada di sini — hanya `secretHint` (4 karakter terakhir); secret utuh tampil sekali saat endpoint dibuat atau diputar.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "webhooks:read",
    samplePath: "/webhooks", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/webhooks" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_webhook_deliveries",
    title: "Riwayat pengiriman webhook",
    description:
      "Riwayat pengiriman satu endpoint, terbaru dulu (maks 200). Tiap baris memuat `status` (`pending`, `sending`, `sent`, `failed`, `dropped`), percobaan ke-berapa, HTTP status, galat, dan `payload` amplop peristiwa — payload itu memuat data project APA PUN yang cocok, bukan hanya yang boleh kamu lihat lewat capability lain.",
    inputSchema: obj({
      properties: { webhook: WEBHOOK_ID, limit: int("Jumlah baris (1–200). Default 50.", { minimum: 1, maximum: 200 }) },
      required: ["webhook"],
    }),
    mode: "read", capability: "webhooks:read",
    samplePath: "/webhooks/w1/deliveries", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `/webhooks/${enc(String(a.webhook))}/deliveries`,
      query: query({ limit: n(a.limit)?.toString() }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_webhook_create",
    title: "Daftarkan webhook keluar (BERBAHAYA)",
    description:
      "BERBAHAYA — mendaftarkan endpoint yang akan menerima data workspace lewat HTTP POST bertanda tangan. Balasan memuat `secret` penandatanganan SEKALI SAJA, persis seperti REST: simpan/serahkan ke penerima SEKARANG, tak bisa dibaca lagi (hanya diputar). Alamat jaringan internal/loopback ditolak 400 — mengizinkannya (`allowPrivate`) sengaja bukan wewenang agen." + WH_DANGER,
    inputSchema: obj({
      properties: {
        name: str("Nama endpoint (1–80 karakter)."),
        url: str("URL http(s) penerima."),
        events: EVENTS,
        projectIds: PROJECT_IDS,
        enabled: bool("Default true."),
        maxPerMinute: int("Batas laju per endpoint (1–600) — melindungi PENERIMA. Default 60.", { minimum: 1, maximum: 600 }),
      },
      required: ["name", "url", "events"],
    }),
    mode: "danger", capability: "webhooks:write",
    samplePath: "/webhooks", sampleMethod: "POST",
    build: (a) => {
      const body: Record<string, unknown> = { name: String(a.name), url: String(a.url), events: a.events };
      if (Array.isArray(a.projectIds)) body.projectIds = a.projectIds;
      if (typeof a.enabled === "boolean") body.enabled = a.enabled;
      if (n(a.maxPerMinute) !== undefined) body.maxPerMinute = n(a.maxPerMinute);
      return { method: "POST", path: "/webhooks", body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_webhook_update",
    title: "Ubah webhook keluar (BERBAHAYA)",
    description:
      "BERBAHAYA — mengubah endpoint webhook. Hanya field yang disebut yang ditulis. `rotateSecret: true` MEMUTAR secret: balasan memuat secret baru SEKALI SAJA, dan yang lama mati seketika (penerima harus diperbarui). `enabled: true` pada endpoint yang dinonaktifkan otomatis memberi kesempatan baru (streak kegagalan dibersihkan). Server menolak 403 bila endpoint ber-`allowPrivate` diubah URL-nya oleh agent token — memindahkan endpoint internal ke tujuan lain adalah keputusan manusia." + WH_DANGER,
    inputSchema: obj({
      properties: {
        webhook: WEBHOOK_ID,
        name: str("Nama baru."),
        url: str("URL penerima baru."),
        events: EVENTS,
        projectIds: PROJECT_IDS,
        allProjects: bool("true = cabut penyaringan project (kirim peristiwa SEMUA project). Mengabaikan `projectIds`."),
        enabled: bool("false = jeda, true = aktifkan."),
        maxPerMinute: int("Batas laju per endpoint (1–600).", { minimum: 1, maximum: 600 }),
        rotateSecret: bool("true = bangkitkan secret baru (tampil sekali)."),
      },
      required: ["webhook"],
    }),
    mode: "danger", capability: "webhooks:write",
    samplePath: "/webhooks/w1", sampleMethod: "PATCH",
    build: (a) => {
      const body: Record<string, unknown> = {};
      if (s(a.name)) body.name = s(a.name);
      if (s(a.url)) body.url = s(a.url);
      if (Array.isArray(a.events)) body.events = a.events;
      if (a.allProjects === true) body.projectIds = null;
      else if (Array.isArray(a.projectIds)) body.projectIds = a.projectIds;
      if (typeof a.enabled === "boolean") body.enabled = a.enabled;
      if (n(a.maxPerMinute) !== undefined) body.maxPerMinute = n(a.maxPerMinute);
      if (a.rotateSecret === true) body.rotateSecret = true;
      return { method: "PATCH", path: `/webhooks/${enc(String(a.webhook))}`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_webhook_delete",
    title: "Hapus webhook keluar (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus endpoint webhook beserta SELURUH riwayat pengirimannya (cascade). Pengiriman yang masih antre ikut hilang. Untuk sekadar menjeda, pakai hanoman_webhook_update dengan `enabled: false`." + WH_DANGER,
    inputSchema: obj({ properties: { webhook: WEBHOOK_ID }, required: ["webhook"] }),
    mode: "danger", capability: "webhooks:write",
    samplePath: "/webhooks/w1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/webhooks/${enc(String(a.webhook))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_webhook_test",
    title: "Kirim ping webhook (BERBAHAYA)",
    description:
      "BERBAHAYA — mengirim SATU ping bertanda tangan ke endpoint dan MENUNGGU jawabannya (sinkron; maks ~10 detik). Itu permintaan HTTP keluar sungguhan ke URL penerima. Hasil `{ok, httpStatus, durationMs, error}` juga dicatat di riwayat. Ping yang gagal tidak diulang otomatis. 409 bila secret endpoint tak bisa dibuka (kunci berganti) — putar secret dulu." + WH_DANGER,
    inputSchema: obj({ properties: { webhook: WEBHOOK_ID }, required: ["webhook"] }),
    mode: "danger", capability: "webhooks:write",
    samplePath: "/webhooks/w1/test", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/webhooks/${enc(String(a.webhook))}/test` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_webhook_delivery_retry",
    title: "Ulangi pengiriman webhook (BERBAHAYA)",
    description:
      "BERBAHAYA — mengantrekan ULANG satu pengiriman yang sudah selesai atau gagal ke URL penerima (percobaan diulang dari awal; penerima bisa menerima peristiwa yang sama dua kali — idempotensinya ada di `eventId`). 409 bila pengiriman itu masih dalam antrean. Id pengiriman dari hanoman_webhook_deliveries." + WH_DANGER,
    inputSchema: obj({ properties: { delivery: str("Id pengiriman, dari hanoman_webhook_deliveries.") }, required: ["delivery"] }),
    mode: "danger", capability: "webhooks:write",
    samplePath: "/webhooks/deliveries/d1/retry", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/webhooks/deliveries/${enc(String(a.delivery))}/retry` }),
    shape: (raw) => raw,
  },
];

// ───────────────────────── Akun klien portal (clients:read | clients:write) ─────────────────────────

const ACCOUNT_ID = str("Id akun klien, seperti muncul di hanoman_client_accounts_list.");
const CL_DANGER =
  " Menuntut capability `clients:write`. Hanya muncul saat tingkat `--danger` menyala.";
const PASSWORD_NOTE =
  " Password yang kamu kirim disensor dari keluaran tool dan TIDAK dikembalikan server.";

const CLIENTS: readonly McpToolDef[] = [
  {
    name: "hanoman_client_accounts_list",
    title: "Akun klien portal",
    description:
      "Akun login portal klien (role `client`): email, status `disabled`, dan `projects` — id project yang BOLEH dilihatnya. Akun operator tidak ada di sini. Password tak pernah dikembalikan. `id` dipakai sebagai `account` di tool akun klien dan sebagai `asClient` di tool portal.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "clients:read",
    samplePath: "/client-accounts", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/client-accounts" }),
    shape: (raw, a) => localPage(raw, a, (r) => r),
  },
  {
    name: "hanoman_client_account_create",
    title: "Buat akun klien (BERBAHAYA)",
    description:
      "BERBAHAYA — membuat login portal klien baru dengan password awal dan daftar project yang boleh dilihatnya. Ini MEMBUKA akses orang luar ke backlog & tiket project-project itu (read-only), jadi serahkan password lewat saluran yang aman, bukan lewat chat. Email yang sudah dipakai (akun apa pun) menjawab 409; project tak dikenal menjawab 400 dan akunnya tidak jadi dibuat." + PASSWORD_NOTE + CL_DANGER,
    inputSchema: obj({
      properties: {
        email: str("Email login klien."),
        password: str("Password awal, minimal 8 karakter.", { minLength: 8 }),
        projects: strArray("Id project yang boleh dilihat. Kosong/tak disebut = belum bisa melihat apa pun."),
      },
      required: ["email", "password"],
    }),
    mode: "danger", capability: "clients:write",
    samplePath: "/client-accounts", sampleMethod: "POST",
    secretArgs: ["password"],
    build: (a) => ({
      method: "POST", path: "/client-accounts",
      body: { email: String(a.email), password: String(a.password), projects: Array.isArray(a.projects) ? a.projects : [] },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_client_account_update",
    title: "Ubah akses/status akun klien (BERBAHAYA)",
    description:
      "BERBAHAYA — mengubah project yang boleh dilihat akun klien dan/atau menonaktifkannya. `projects` MENGGANTI seluruh daftar (bukan menambah): kirim daftar lengkap yang diinginkan. `disabled: true` mematikan semua sesi login akun itu SEKARANG. Untuk reset password pakai hanoman_client_account_password_reset. Hanya akun ber-role klien yang bisa disentuh; akun operator tak terjangkau." + CL_DANGER,
    inputSchema: obj({
      properties: {
        account: ACCOUNT_ID,
        projects: strArray("Daftar LENGKAP id project yang boleh dilihat (menggantikan yang lama). Kosongkan array untuk mencabut semua akses."),
        disabled: bool("true = nonaktifkan (sesi aktif langsung mati), false = aktifkan lagi."),
      },
      required: ["account"],
    }),
    mode: "danger", capability: "clients:write",
    samplePath: "/client-accounts/c1", sampleMethod: "PATCH",
    build: (a) => {
      const body: Record<string, unknown> = {};
      if (Array.isArray(a.projects)) body.projects = a.projects;
      if (typeof a.disabled === "boolean") body.disabled = a.disabled;
      return { method: "PATCH", path: `/client-accounts/${enc(String(a.account))}`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_client_account_password_reset",
    title: "Reset password akun klien (BERBAHAYA)",
    description:
      "BERBAHAYA — mengganti password akun klien dan mematikan semua sesi login lamanya SEKARANG. Siapa pun yang mengetahui password baru bisa masuk sebagai klien itu, jadi serahkan lewat saluran yang aman." + PASSWORD_NOTE + CL_DANGER,
    inputSchema: obj({
      properties: { account: ACCOUNT_ID, password: str("Password baru, minimal 8 karakter.", { minLength: 8 }) },
      required: ["account", "password"],
    }),
    mode: "danger", capability: "clients:write",
    samplePath: "/client-accounts/c1", sampleMethod: "PATCH",
    secretArgs: ["password"],
    build: (a) => ({
      method: "PATCH", path: `/client-accounts/${enc(String(a.account))}`,
      body: { password: String(a.password) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_client_account_delete",
    title: "Hapus akun klien (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus akun klien permanen beserta sesi dan daftar akses project-nya. Tiket yang pernah dikirimnya TIDAK ikut terhapus. Untuk menutup akses sementara, pakai hanoman_client_account_update dengan `disabled: true`." + CL_DANGER,
    inputSchema: obj({ properties: { account: ACCOUNT_ID }, required: ["account"] }),
    mode: "danger", capability: "clients:write",
    samplePath: "/client-accounts/c1", sampleMethod: "DELETE",
    build: (a: Args) => ({ method: "DELETE", path: `/client-accounts/${enc(String(a.account))}` }),
    shape: (raw) => raw,
  },
];

export const INTEGRATIONS_TOOLS: readonly McpToolDef[] = [
  ...TELEGRAM_ADMIN, ...WEBHOOKS, ...CLIENTS, ...PORTAL_TOOLS,
];
