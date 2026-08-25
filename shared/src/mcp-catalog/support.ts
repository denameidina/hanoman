// ADR-0099 · katalog tool domain `support`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, enumStr, obj, str } from "../mcp-schema";
import { shapeGithubIssue, shapeTicket } from "../mcp-shape";
import { enc, localPage, query, s } from "./helpers";
import type { McpToolDef } from "./types";

export const SUPPORT_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_tickets_list",
    title: "Tiket Help Center",
    description:
      "Tiket yang masuk lewat Help Center publik. `status`: `new` (belum ditriase), `accepted` (sudah jadi backlog — lihat `specId`), `rejected`.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Tanpa ini, seluruh proyek."),
        status: enumStr(["new", "accepted", "rejected"], "Status triase."),
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "support:read", samplePath: "/tickets", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/tickets", query: query({ project: s(a.project), status: s(a.status) }) }),
    shape: (raw, a) => localPage(raw, a, shapeTicket),
  },
  {
    name: "hanoman_ticket_get",
    title: "Detail tiket",
    description: "Isi lengkap satu tiket Help Center berikut daftar lampirannya.",
    inputSchema: obj({ properties: { ticket: str("Id tiket, seperti muncul di hanoman_tickets_list.") }, required: ["ticket"] }),
    mode: "read", capability: "support:read", samplePath: "/tickets/t1", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/tickets/${enc(String(a.ticket))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_github_issues_list",
    title: "Issue GitHub yang sudah ditarik",
    description:
      "Issue GitHub yang SUDAH ditarik ke hanoman untuk ditriase (record lokal, bukan panggilan langsung ke GitHub — daftarnya sesegar tarikan terakhir). Pull request tidak pernah ikut. Menarik ulang dari GitHub adalah tindakan manusia di dashboard.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        status: enumStr(["new", "accepted", "rejected"], "Status triase di hanoman (bukan status di GitHub — itu `issueState`)."),
        ...PAGE_PARAMS,
      },
      required: ["project"],
    }),
    mode: "read", capability: "support:read", samplePath: "/projects/hanoman/github/issues", sampleMethod: "GET",
    build: (a) => ({
      method: "GET",
      path: `/projects/${enc(String(a.project))}/github/issues`,
      query: query({ status: s(a.status) }),
    }),
    shape: (raw, a) => localPage(raw, a, shapeGithubIssue),
  },
];
