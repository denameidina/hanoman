// ADR-0099 · ADR-0155 · katalog tool domain `docs`: dokumen SoT project, PRD, dan changelog.
// Tiga permukaan yang di REST hidup di dua berkas route (docs.ts, changelog.ts) tapi SATU domain
// capability — `capabilityForRoute` memetakan `projects/:id/{docs,prds,changelog}` ke `docs:*`
// justru supaya membaca changelog tak menuntut hak menyunting project (SPEC-516, ADR-0105).
import { enumStr, int, obj, str } from "../mcp-schema";
import { enc, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

/**
 * Path dokumen di-encode PER SEGMEN. `encodeURIComponent` atas seluruh path akan mengubah `/`
 * menjadi `%2F` dan route wildcard Fastify tak lagi cocok — jebakan yang sama sudah ada di
 * `hanoman_backlog_doc_read`.
 */
const encPath = (p: string) => String(p).split("/").map(enc).join("/");

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
    // `projects/:id/*` yang tak terdaftar ke `projects:*` — hanya `docs`, `prds`, dan `changelog`
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
  {
    name: "hanoman_changelog_sources",
    title: "Sumber changelog yang tersedia",
    description:
      "Bahan mentah yang bisa dipakai membuat changelog: daftar tag git, HEAD, dan rentang backlog yang sudah selesai. Panggil ini SEBELUM hanoman_changelog_create — ia memberitahu mode mana yang mungkin (`hasRepo: false` berarti mode commit & version tak akan jalan) dan `defaultRange` yang masuk akal.",
    inputSchema: obj({ properties: { project: PROJECT }, required: ["project"] }),
    mode: "read", capability: "docs:read",
    samplePath: "/projects/hanoman/changelog/sources", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/changelog/sources` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_changelog_list",
    title: "Daftar changelog project",
    description:
      "Changelog yang sudah dibuat untuk sebuah project, terbaru dulu, berhalaman. `q` menyaring judul & isi.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        q: str("Kata kunci penyaring judul & isi changelog. Kosongkan untuk semua."),
        page: int("Halaman, mulai 1.", { minimum: 1 }),
        limit: int("Item per halaman.", { minimum: 1, maximum: 200 }),
      },
      required: ["project"],
    }),
    mode: "read", capability: "docs:read",
    samplePath: "/projects/hanoman/changelog", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `/projects/${enc(String(a.project))}/changelog`,
      query: query({ q: s(a.q), page: n(a.page)?.toString(), limit: n(a.limit)?.toString() }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_changelog_get",
    title: "Baca satu changelog",
    description: "Satu entri changelog beserta isinya, dicari menurut id di dalam project tersebut.",
    inputSchema: obj({
      properties: { project: PROJECT, changelog: str("Id changelog, dari hanoman_changelog_list.") },
      required: ["project", "changelog"],
    }),
    mode: "read", capability: "docs:read",
    samplePath: "/projects/hanoman/changelog/c1", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/changelog/${enc(String(a.changelog))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_changelog_create",
    title: "Buat changelog",
    description:
      "Membuat changelog baru dari salah satu dari tiga sumber. `mode` menentukan field mana yang WAJIB menyertainya: `backlog` memakai rentang tanggal (`from`/`to`, boleh kosong = seluruhnya), `commit` memakai dua sha, `version` memakai tag. Server menjawab 422 bila sumbernya tak tersedia — panggil hanoman_changelog_sources lebih dulu.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        mode: enumStr(["backlog", "commit", "version"], "Sumber changelog. Field yang menyertainya ditentukan nilai ini."),
        from: str("Mode `backlog`: tanggal awal `YYYY-MM-DD`. Kosongkan untuk tanpa batas awal."),
        to: str("Mode `backlog`: tanggal akhir `YYYY-MM-DD`. Harus >= `from`."),
        fromSha: str("Mode `commit`: sha awal, minimal 4 karakter."),
        toSha: str("Mode `commit`: sha akhir, minimal 4 karakter."),
        fromTag: str("Mode `version`: tag awal. Kosongkan untuk mulai dari tag terawal."),
        toTag: str("Mode `version`: tag akhir. WAJIB."),
      },
      required: ["project", "mode"],
      // Skema ketat DI KLIEN: validator SDK menolak pasangan yang salah sebelum permintaan lahir,
      // jadi agen dibimbing ke panggilan yang sah alih-alih menemukannya lewat 400 (ADR-0099 #2).
      allOf: [
        { if: { properties: { mode: { const: "backlog" } }, required: ["mode"] },
          then: { properties: { from: { type: "string" }, to: { type: "string" } } } },
        { if: { properties: { mode: { const: "commit" } }, required: ["mode"] },
          then: { required: ["fromSha", "toSha"] } },
        { if: { properties: { mode: { const: "version" } }, required: ["mode"] },
          then: { required: ["toTag"] } },
      ],
    }),
    mode: "write", capability: "docs:write",
    samplePath: "/projects/hanoman/changelog", sampleMethod: "POST",
    build: (a) => {
      const mode = String(a.mode);
      // Hanya field milik `mode` yang ikut: discriminatedUnion di server menolak field asing, dan
      // meneruskan sisa argumen apa adanya akan menghasilkan 400 yang membingungkan agen.
      const body =
        mode === "commit" ? { mode, fromSha: String(a.fromSha), toSha: String(a.toSha) }
        : mode === "version" ? { mode, ...(s(a.fromTag) ? { fromTag: s(a.fromTag) } : {}), toTag: String(a.toTag) }
        : { mode, ...(s(a.from) ? { from: s(a.from) } : {}), ...(s(a.to) ? { to: s(a.to) } : {}) };
      return { method: "POST", path: `/projects/${enc(String(a.project))}/changelog`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_changelog_delete",
    title: "Hapus changelog (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus satu entri changelog secara permanen. Isinya tak tersimpan di tempat lain: changelog lahir dari generator dan tak bisa dipulihkan tanpa membuatnya ulang. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: { project: PROJECT, changelog: str("Id changelog yang akan dihapus.") },
      required: ["project", "changelog"],
    }),
    mode: "danger", capability: "docs:write",
    samplePath: "/projects/hanoman/changelog/c1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/projects/${enc(String(a.project))}/changelog/${enc(String(a.changelog))}` }),
    shape: (raw) => raw,
  },
];
