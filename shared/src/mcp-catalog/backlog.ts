// ADR-0099 · katalog tool domain `backlog`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { DATE_PARAMS, PAGE_PARAMS, PRIORITY, SOURCE_ENUM, SOURCE_PAYLOAD_ALLOF, SPEC_PAYLOAD_ONEOF, STAGE_ENUM, bool, enumStr, obj, str, strArray } from "../mcp-schema";
import { shapeSpec, shapeSpecDetail } from "../mcp-shape";
import { enc, n, query, reshapePage, s, ID_HINT } from "./helpers";
import type { McpToolDef } from "./types";

export const BACKLOG_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_backlog_search",
    title: "Cari backlog",
    description:
      "Cari & saring backlog lintas proyek. Stage yang dikembalikan sudah stage LIVE (diturunkan dari sesi berjalan), bukan nilai basi di database — tak perlu memanggil apa pun untuk menyegarkannya. Balasannya ringkas: `objective` dipotong 200 karakter dan `payload` tidak ikut; pakai hanoman_backlog_get untuk isi penuh satu item.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Tanpa ini, pencarian mencakup SEMUA proyek."),
        source: enumStr(SOURCE_ENUM, "Asal item. `cross-audit` sudah tidak ada."),
        stage: enumStr(STAGE_ENUM, "Stage live yang dicocokkan persis."),
        priority: PRIORITY,
        startable: bool("true = hanya item yang belum selesai (stage bukan `done`). false / tak diisi = semua item."),
        q: str("Substring, tanpa peduli huruf besar-kecil, dicocokkan ke `id + title + objective` saja. TIDAK menyentuh isi `payload` — kata yang hanya ada di konteks/outcome tak akan ketemu."),
        ...DATE_PARAMS,
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "backlog:read", samplePath: "/specs", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/specs",
      query: query({
        project: s(a.project), source: s(a.source), stage: s(a.stage), priority: s(a.priority),
        // Jebakan yang ditutup di sini: server hanya melihat string "true"; nilai lain diabaikan
        // SENYAP dan mengembalikan SELURUH backlog termasuk yang `done`. Skema tool memakai
        // boolean, dan `false` MENGHILANGKAN parameternya alih-alih mengirim "false".
        startable: a.startable === true ? "true" : undefined,
        q: s(a.q), dateField: s(a.dateField), from: s(a.from), to: s(a.to),
        page: n(a.page) === undefined ? undefined : String(n(a.page)),
        limit: n(a.limit) === undefined ? undefined : String(n(a.limit)),
      }),
    }),
    shape: (raw) => reshapePage(raw, shapeSpec),
  },
  {
    name: "hanoman_backlog_get",
    title: "Detail backlog",
    description:
      "Isi lengkap satu backlog item termasuk `payload`, `baseSha`/`headSha`, dan penanda `editable` (masih boleh diubah bila stage `brainstorming` dan belum pernah punya sesi).",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "read", capability: "backlog:read", samplePath: "/specs", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/specs", query: { q: String(a.spec), limit: "100" } }),
    // REST tak punya `GET /specs/:id`; `q` adalah SUBSTRING, jadi `SPEC-48` mengembalikan
    // SPEC-480…489. Pencocokan persis dilakukan di sini, bukan dipercayakan ke server.
    shape: (raw, a) => {
      const want = String(a.spec).trim().toLowerCase();
      const items = ((raw as { items?: unknown[] })?.items ?? []) as Record<string, unknown>[];
      const hit = items.find((i) => String(i.id).toLowerCase() === want);
      return hit
        ? shapeSpecDetail(hit)
        : { error: `backlog "${String(a.spec)}" tidak ada. Cek ejaannya (bentuknya SPEC-nnn) atau cari dengan hanoman_backlog_search.` };
    },
  },
  {
    name: "hanoman_backlog_docs_list",
    title: "Dokumen hasil sesi",
    description:
      "Daftar dokumen yang dihasilkan sesi backlog ini (design doc, plan, laporan audit). Sumbernya freshest-wins: worktree sesi yang masih hidup menang atas checkout proyek. Isi berkasnya dibaca dengan hanoman_backlog_doc_read.",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "read", capability: "backlog:read", samplePath: "/specs/SPEC-1/docs", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/specs/${enc(String(a.spec))}/docs` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_doc_read",
    title: "Baca dokumen sesi",
    description:
      "Isi satu dokumen hasil sesi. `path` adalah jalur relatif yang persis seperti muncul di hanoman_backlog_docs_list. Balasan panjang dipotong pada plafon byte dan ditandai `truncated`.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        path: str("Jalur relatif dokumen, mis. `docs/superpowers/plans/2026-08-01-x.md`. Salin apa adanya dari hanoman_backlog_docs_list."),
      },
      required: ["spec", "path"],
    }),
    mode: "read", capability: "backlog:read", samplePath: "/specs/SPEC-1/docs/a.md", sampleMethod: "GET",
    build: (a) => ({
      method: "GET",
      path: `/specs/${enc(String(a.spec))}/docs/${String(a.path).split("/").map(enc).join("/")}`,
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_create",
    title: "Buat backlog",
    description:
      "Buat satu backlog item baru. JANGAN kirim `id`, `stage`, atau `objective`: id diturunkan server (SPEC-nnn berikutnya), stage selalu lahir `brainstorming`, dan objective diturunkan dari payload. Bentuk `payload` ditentukan `source` dan sudah ditegakkan skema tool ini.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek. Proyek yang tak dikenal menjawab 404."),
        source: enumStr(SOURCE_ENUM, "Asal item: `brief` (fitur), `qa` (temuan bug), `audit` (telusur tanpa perbaikan), `help` (dari tiket), `goal` (kejar satu tujuan tanpa perencanaan)."),
        title: str("Judul singkat.", { minLength: 1 }),
        priority: PRIORITY,
        payload: SPEC_PAYLOAD_ONEOF,
        branchFrom: str("Opsional. Nama branch basis. Branch yang tak ada di repo proyek menjawab 400."),
        dependsOn: strArray("Opsional. Id backlog yang harus selesai DAN ter-merge lebih dulu. Harus ada, satu proyek, bukan diri sendiri."),
      },
      required: ["project", "source", "title", "priority", "payload"],
      allOf: SOURCE_PAYLOAD_ALLOF,
    }),
    mode: "write", capability: "backlog:write", samplePath: "/specs", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/specs",
      body: {
        project: a.project, source: a.source, title: a.title, priority: a.priority, payload: a.payload,
        ...(s(a.branchFrom) ? { branchFrom: a.branchFrom } : {}),
        ...(Array.isArray(a.dependsOn) ? { dependsOn: a.dependsOn } : {}),
      },
    }),
    shape: (raw) => shapeSpecDetail((raw ?? {}) as Record<string, unknown>),
  },
  {
    name: "hanoman_backlog_update",
    title: "Ubah backlog yang belum dimulai",
    description:
      "Ubah judul, prioritas, isi, atau dependency sebuah backlog. Konten hanya bisa diubah selagi item BELUM DIMULAI (stage `brainstorming` dan belum pernah punya sesi); di luar itu server menjawab 409. Cek `editable` di hanoman_backlog_get lebih dulu. Mengubah stage, menghapus item, dan menjalankan integrate sengaja tidak tersedia lewat MCP.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        title: str("Judul baru."),
        priority: PRIORITY,
        payload: SPEC_PAYLOAD_ONEOF,
        dependsOn: strArray("Ganti seluruh daftar dependency. `[]` mengosongkan. Ini SATU-SATUNYA field di sini yang masih boleh diubah setelah item dimulai."),
      },
      required: ["spec"],
    }),
    mode: "write", capability: "backlog:write", samplePath: "/specs/SPEC-1", sampleMethod: "PATCH",
    build: (a) => ({
      method: "PATCH", path: `/specs/${enc(String(a.spec))}`,
      body: {
        ...(s(a.title) ? { title: a.title } : {}),
        ...(s(a.priority) ? { priority: a.priority } : {}),
        ...(a.payload !== undefined ? { payload: a.payload } : {}),
        ...(Array.isArray(a.dependsOn) ? { dependsOn: a.dependsOn } : {}),
      },
    }),
    shape: (raw) => shapeSpecDetail((raw ?? {}) as Record<string, unknown>),
  },
];
