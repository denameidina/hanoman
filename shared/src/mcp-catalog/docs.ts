// Katalog tool dokumen SoT dan PRD (ADR-0182: changelog dihapus).
import { obj, str } from "../mcp-schema";
import { enc, query, s } from "./helpers";
import type { McpToolDef } from "./types";

/**
 * Path dokumen di-encode PER SEGMEN. `encodeURIComponent` atas seluruh path akan mengubah `/`
 * menjadi `%2F` dan route wildcard Fastify tak lagi cocok — jebakan yang sama sudah ada di
 * `hanoman_backlog_doc_read`.
 */
const encPath = (p: unknown) => String(p).split("/").map(enc).join("/");

const PROJECT = str("Id project, mis. `hanoman`. Dapatkan dari hanoman_projects_list.");

export const DOCS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_docs_list",
    title: "Daftar dokumen project",
    description:
      "Indeks seluruh berkas dokumen (.md) di repo project, sebagai pohon jalur relatif. Pakai ini lebih dulu untuk mendapat jalur yang sah sebelum hanoman_docs_read — jalur yang keluar dari direktori dokumen ditolak server.",
    inputSchema: obj({ properties: { project: PROJECT }, required: ["project"] }),
    mode: "read", capability: "docs:read",
    samplePath: "/projects/hanoman/docs", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/docs` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_docs_read",
    title: "Baca dokumen project",
    description:
      "Isi satu berkas dokumen project. Balasan berbentuk `{path, content}`. Isi yang panjang dipotong di batas ukuran dan ditandai `truncated` — itu batas ukuran, bukan galat.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        path: str("Jalur relatif dokumen, mis. `architecture/stack.md`. Salin APA ADANYA dari hanoman_docs_list — jangan menambah prefix sendiri."),
      },
      required: ["project", "path"],
    }),
    mode: "read", capability: "docs:read",
    samplePath: "/projects/hanoman/docs/a.md", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/docs/${encPath(a.path)}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_docs_write",
    title: "Tulis dokumen project",
    description:
      "Menimpa (atau membuat) satu berkas dokumen project dengan isi yang kamu kirim. Isi lama TIDAK digabung — kirim dokumen utuh, bukan potongan. Baca dulu dengan hanoman_docs_read bila kamu bermaksud menyunting.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        path: str("Jalur relatif dokumen, mis. `architecture/stack.md`. Direktori yang belum ada akan dibuat."),
        content: str("Isi berkas UTUH. Yang lama ditimpa seluruhnya."),
      },
      required: ["project", "path", "content"],
    }),
    mode: "write", capability: "docs:write",
    samplePath: "/projects/hanoman/docs/a.md", sampleMethod: "PUT",
    build: (a) => ({
      method: "PUT", path: `/projects/${enc(String(a.project))}/docs/${encPath(a.path)}`,
      body: { content: String(a.content) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_docs_delete",
    title: "Hapus dokumen project (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus berkas dokumen dari working tree project secara permanen. Tak ada undo lewat hanoman; pemulihannya lewat git, dan hanya bila berkasnya sudah pernah di-commit. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: { project: PROJECT, path: str("Jalur relatif dokumen yang akan dihapus.") },
      required: ["project", "path"],
    }),
    mode: "danger", capability: "docs:write",
    samplePath: "/projects/hanoman/docs/a.md", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/projects/${enc(String(a.project))}/docs/${encPath(a.path)}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_prds_list",
    title: "Daftar PRD",
    description:
      "Daftar dokumen PRD. Tanpa `project` ia mendaftar PRD SELURUH project dan tiap item membawa projectId/projectName; dengan `project` ia hanya project itu. Daftarnya freshest-wins: PRD di worktree sesi yang hidup menang atas yang di repo.",
    inputSchema: obj({
      properties: { project: str("Id project. Kosongkan untuk mendaftar PRD seluruh project.") },
    }),
    mode: "read", capability: "docs:read",
    samplePath: "/prds", sampleMethod: "GET",
    build: (a) => {
      const p = s(a.project);
      return { method: "GET", path: p ? `/projects/${enc(p)}/prds` : "/prds" };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_prd_read",
    title: "Baca PRD",
    description:
      "Isi satu dokumen PRD, berbentuk `{path, content}`. Jalurnya disalin dari hanoman_prds_list.",
    inputSchema: obj({
      properties: { project: PROJECT, path: str("Jalur relatif PRD, disalin apa adanya dari hanoman_prds_list.") },
      required: ["project", "path"],
    }),
    mode: "read", capability: "docs:read",
    samplePath: "/projects/hanoman/prds/a.md", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/prds/${encPath(a.path)}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_breakdown_get",
    title: "Manifest breakdown PRD",
    description:
      "Manifest usulan backlog yang lahir dari sebuah PRD. PRD yang tak punya manifest menjawab `{items: []}`, BUKAN 404 — daftar kosong berarti 'belum pernah di-breakdown', bukan 'PRD tak ada'.",
    inputSchema: obj({
      properties: { project: PROJECT, prd: str("Jalur relatif PRD-nya, disalin dari hanoman_prds_list.") },
      required: ["project", "prd"],
    }),
    // `breakdown` hidup di berkas route docs.ts, TAPI `capabilityForRoute` memetakan sub-path
    // `projects/:id/*` yang tak terdaftar ke `projects:*` — hanya `docs` dan `prds`
    // yang dipetakan ke `docs:*`. Menuliskannya `docs:read` membuat uji kontrak merah, dan itulah
    // yang terjadi saat tool ini pertama ditulis.
    mode: "read", capability: "projects:read",
    samplePath: "/projects/hanoman/breakdown", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `/projects/${enc(String(a.project))}/breakdown`,
      query: query({ prd: s(a.prd) }),
    }),
    shape: (raw) => raw,
  },
];
