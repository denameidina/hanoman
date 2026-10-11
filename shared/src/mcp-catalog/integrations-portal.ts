// ADR-0195 · tool "lihat portal sebagai klien". Route `/api/portal/**` adalah permukaan SESI COOKIE
// ber-scope AKUN KLIEN: tiap handler menurunkan project yang boleh dilihat dari `req.user.id`, dan
// agent token tak punya `req.user`. Membungkusnya "apa adanya" tidak mungkin (handler crash / kosong)
// dan membuat capability pura-pura berarti sesuatu.
//
// Desain minimal yang jujur: pemanggil MENYEBUT akun klien secara eksplisit (`asClient`), server
// memvalidasinya (harus akun ber-role klien), dan hanya method BACA yang diterima. Hasilnya persis
// yang dilihat klien itu — berguna untuk memeriksa apa yang diekspos portal — dan setiap panggilan
// jelas atas nama siapa. Tulis atas nama klien (kirim tiket, mulai/kirim chat) TIDAK dibungkus:
// itu peniruan identitas (tiket multipart, chat menghabiskan kuota & tertulis sebagai ucapan klien).
//
// Catatan: chat portal memuat percakapan klien dengan hanoman. `portal:read` karenanya membuka
// transkrip itu bagi pemegangnya — manusia yang memutuskan di Settings → Akses AI Agent.
import { PAGE_PARAMS, obj, str } from "../mcp-schema";
import { enc, n, query, s } from "./helpers";
import type { Args, McpToolDef } from "./types";

const CAP = "portal:read";
const AS_CLIENT = str(
  "Id akun klien yang dilihat (`id` dari hanoman_client_accounts_list, butuh `clients:read` — atau minta manusia menyebutnya). WAJIB: tanpanya server menolak 400, karena portal selalu ber-scope satu akun klien.",
);
const PROJECT = str("Id project. Project yang tak ditugaskan ke akun itu menjawab 404 yang sama dengan project yang tak ada.");
const SUFFIX = " Atas nama akun klien yang disebut di `asClient`; baca-saja. Butuh capability `portal:read`.";

const page = (a: Args): Record<string, string | undefined> => ({
  asClient: s(a.asClient),
  page: n(a.page) === undefined ? undefined : String(n(a.page)),
  limit: n(a.limit) === undefined ? undefined : String(n(a.limit)),
});

export const PORTAL_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_portal_projects",
    title: "Portal: project yang dilihat klien",
    description:
      "Daftar project yang boleh dilihat satu akun klien — proyeksi sempit (id, nama, deskripsi), bukan data project operator." + SUFFIX,
    inputSchema: obj({ properties: { asClient: AS_CLIENT, ...PAGE_PARAMS }, required: ["asClient"] }),
    mode: "read", capability: CAP,
    samplePath: "/portal/projects", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/portal/projects", query: query(page(a)) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_portal_backlog",
    title: "Portal: backlog yang dilihat klien",
    description:
      "Backlog project sebagaimana tampil di portal klien (allowlist field — tanpa payload internal). Tanpa `spec` = daftar; dengan `spec` = satu item. Stage-nya stage live yang sama dengan dashboard operator." + SUFFIX,
    inputSchema: obj({
      properties: {
        asClient: AS_CLIENT, project: PROJECT,
        spec: str("Id backlog (mis. `SPEC-12`). Tanpa ini = daftar seluruh backlog project."),
        ...PAGE_PARAMS,
      },
      required: ["asClient", "project"],
    }),
    mode: "read", capability: CAP,
    samplePath: "/portal/projects/p1/backlog", sampleMethod: "GET",
    build: (a) => s(a.spec)
      ? { method: "GET", path: `/portal/projects/${enc(String(a.project))}/backlog/${enc(String(a.spec))}`, query: query({ asClient: s(a.asClient) }) }
      : { method: "GET", path: `/portal/projects/${enc(String(a.project))}/backlog`, query: query(page(a)) },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_portal_tickets",
    title: "Portal: tiket yang dilihat klien",
    description:
      "Tiket Help Center project sebagaimana tampil di portal klien (kunci opaque pelapor tak pernah ikut). Tanpa `ticket` = daftar; dengan `ticket` = satu tiket lengkap. Tiket milik project lain menjawab 404." + SUFFIX,
    inputSchema: obj({
      properties: {
        asClient: AS_CLIENT, project: PROJECT,
        ticket: str("Id tiket. Tanpa ini = daftar tiket project."),
        ...PAGE_PARAMS,
      },
      required: ["asClient", "project"],
    }),
    mode: "read", capability: CAP,
    samplePath: "/portal/projects/p1/tickets", sampleMethod: "GET",
    build: (a) => s(a.ticket)
      ? { method: "GET", path: `/portal/projects/${enc(String(a.project))}/tickets/${enc(String(a.ticket))}`, query: query({ asClient: s(a.asClient) }) }
      : { method: "GET", path: `/portal/projects/${enc(String(a.project))}/tickets`, query: query(page(a)) },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_portal_chat_quota",
    title: "Portal: status & kuota chat klien",
    description:
      "Sisa jatah chat portal untuk project itu. 404 bila chat portal dimatikan (master switch di Settings) atau project tak ditugaskan ke akun." + SUFFIX,
    inputSchema: obj({ properties: { asClient: AS_CLIENT, project: PROJECT }, required: ["asClient", "project"] }),
    mode: "read", capability: CAP,
    samplePath: "/portal/projects/p1/chat", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/portal/projects/${enc(String(a.project))}/chat`, query: query({ asClient: s(a.asClient) }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_portal_chat_sessions",
    title: "Portal: sesi chat klien",
    description:
      "Sesi chat milik akun klien itu di project tersebut. Tanpa `session` = daftar sesi (ringkasan, tanda `prdSiap`); dengan `session` = satu sesi beserta TRANSKRIP pesannya (percakapan klien dengan hanoman — sensitif). Sesi milik akun/project lain menjawab 404." + SUFFIX,
    inputSchema: obj({
      properties: {
        asClient: AS_CLIENT, project: PROJECT,
        session: str("Id sesi chat. Tanpa ini = daftar sesi. `page`/`limit` pada satu sesi memaginasi PESANNYA."),
        ...PAGE_PARAMS,
      },
      required: ["asClient", "project"],
    }),
    mode: "read", capability: CAP,
    samplePath: "/portal/projects/p1/chat/sessions", sampleMethod: "GET",
    build: (a) => s(a.session)
      ? { method: "GET", path: `/portal/projects/${enc(String(a.project))}/chat/sessions/${enc(String(a.session))}`, query: query(page(a)) }
      : { method: "GET", path: `/portal/projects/${enc(String(a.project))}/chat/sessions`, query: query(page(a)) },
    shape: (raw) => raw,
  },
];
