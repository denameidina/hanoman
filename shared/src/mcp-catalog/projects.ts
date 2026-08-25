// ADR-0099 · katalog tool domain `projects`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, obj, str } from "../mcp-schema";
import { shapeProject, shapeProjectDetail } from "../mcp-shape";
import { enc, localPage } from "./helpers";
import type { McpToolDef } from "./types";

export const PROJECTS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_projects_list",
    title: "Daftar proyek",
    description:
      "Daftar seluruh proyek yang dikelola hanoman, dipadatkan ke field yang dipakai agen: id, nama, jenis, jumlah backlog, stage tertinggi, coverage docs, dan opt-in scheduler/lead. Untuk detail satu proyek pakai hanoman_project_get.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "projects:read", samplePath: "/projects", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/projects" }),
    shape: (raw, a) => localPage(raw, a, shapeProject),
  },
  {
    name: "hanoman_project_get",
    title: "Detail proyek",
    description:
      "Detail satu proyek: stack, remote git, status & coverage docs, ringkasan sesi berjalan, aktivitas terakhir, dan opt-in scheduler/lead. Path repo per-mesin sengaja tidak dikembalikan.",
    inputSchema: obj({
      properties: { project: str("Id proyek (slug huruf kecil), mis. `hanoman`. Ambil dari hanoman_projects_list.") },
      required: ["project"],
    }),
    mode: "read", capability: "projects:read", samplePath: "/projects/hanoman", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}` }),
    shape: (raw) => shapeProjectDetail((raw ?? {}) as Record<string, unknown>),
  },
];
