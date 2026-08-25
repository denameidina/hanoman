// ADR-0099 · katalog tool domain `backlog`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { DATE_PARAMS, PAGE_PARAMS, PRIORITY, SOURCE_ENUM, SOURCE_PAYLOAD_ALLOF, SPEC_PAYLOAD_ONEOF, STAGE_ENUM, bool, enumStr, obj, str, strArray } from "../mcp-schema";
import { shapeSpec, shapeSpecDetail } from "../mcp-shape";
import { enc, n, query, reshapePage, s, ID_HINT } from "./helpers";
import type { McpToolDef } from "./types";

const CORE: readonly McpToolDef[] = [
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

// ADR-0155 · sisa permukaan domain `backlog`: sisa permukaan yang terjangkau agent token, termasuk
// TIGA tool bermode `danger`. Dua di antaranya (`delete`, `integrate`) menuntut capability
// `backlog:lifecycle`; yang ketiga (`stage_set`) TIDAK — lihat komentar di entrinya.
const LIFECYCLE_AND_MORE: readonly McpToolDef[] = [
  {
    name: "hanoman_backlog_batch_create",
    title: "Buat banyak backlog sekaligus",
    description:
      "Membuat N backlog item independen dalam satu panggilan, biasanya dari hasil breakdown sebuah PRD. Tiap item lahir di stage `brainstorming` dengan source `brief`. Id diterbitkan server berurutan — jangan mengirimnya.",
    inputSchema: obj({
      properties: {
        project: str("Id project tujuan."),
        items: {
          type: "array",
          description: "Daftar item. Tiap item: `title` (wajib), `context`, `outcome`, `priority`.",
          items: obj({
            properties: {
              title: str("Judul backlog item."),
              context: str("Latar: apa yang terjadi sekarang."),
              outcome: str("Hasil yang diinginkan."),
              priority: PRIORITY,   // sudah berupa node skema, bukan array enum
            },
            required: ["title"],
          }),
        },
        branchFrom: str("Branch sumber worktree untuk seluruh item. Kosongkan untuk default project."),
        prdPath: str("Jalur PRD asal, dicantumkan sebagai provenance di teks Konteks tiap item."),
      },
      required: ["project", "items"],
    }),
    mode: "write", capability: "backlog:write",
    samplePath: "/specs/batch", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/specs/batch",
      body: {
        project: String(a.project), items: a.items,
        ...(s(a.branchFrom) ? { branchFrom: s(a.branchFrom) } : {}),
        ...(s(a.prdPath) ? { prdPath: s(a.prdPath) } : {}),
      },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_source_set",
    title: "Ubah type/alur backlog",
    description:
      "Memindahkan backlog item ke source lain. Perpindahan LINTAS-ALUR pada item yang sudah dimulai mengembalikannya ke `brainstorming` dan MEMBUANG jejak sesi lamanya; tanpa `confirmReset: true` server menjawab dry-run (`pending` + daftar apa yang akan hilang) alih-alih mengeksekusi. Baca dry-run itu sebelum mengulang dengan konfirmasi.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        source: enumStr([...SOURCE_ENUM], "Source tujuan."),
        payload: { type: "object", description: "Payload baru, bentuknya harus cocok dengan `source`. Kosongkan untuk mempertahankan yang lama bila masih cocok." },
        confirmReset: bool("true = jalankan meski item harus direset ke brainstorming. Tanpa ini, server hanya melaporkan apa yang akan hilang."),
      },
      required: ["spec", "source"],
    }),
    mode: "write", capability: "backlog:write",
    samplePath: "/specs/SPEC-1/source", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/specs/${enc(String(a.spec))}/source`,
      body: {
        source: String(a.source),
        ...(a.payload !== undefined ? { payload: a.payload } : {}),
        ...(a.confirmReset === true ? { confirmReset: true } : {}),
      },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_mark_done",
    title: "Tandai backlog selesai manual",
    description:
      "Menandai backlog item selesai tanpa menunggu sesi menyelesaikannya. Bila masih ada sesi HIDUP untuk item ini, server menjawab 409 `confirm-required` beserta sesi mana — ulangi dengan `confirm: true` hanya bila kamu memang bermaksud menyelesaikannya di atas sesi yang sedang berjalan.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        reason: str("Alasan singkat (maks 280 karakter), tersimpan di jejak."),
        confirm: bool("true = lanjutkan meski ada sesi hidup untuk item ini."),
      },
      required: ["spec"],
    }),
    mode: "write", capability: "backlog:write",
    samplePath: "/specs/SPEC-1/done", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/specs/${enc(String(a.spec))}/done`,
      body: { ...(s(a.reason) ? { reason: s(a.reason) } : {}), ...(a.confirm === true ? { confirm: true } : {}) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_attachments_list",
    title: "Daftar lampiran backlog",
    description:
      "Metadata lampiran sebuah backlog item (nama, tipe, ukuran). ISI lampiran tak tersedia lewat MCP — ia byte mentah yang bisa berupa gambar, dan tool teks akan mengembalikan sampah.",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "read", capability: "backlog:read",
    samplePath: "/specs/SPEC-1/attachments", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/specs/${enc(String(a.spec))}/attachments` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_attachment_delete",
    title: "Hapus lampiran backlog",
    description: "Menghapus satu lampiran backlog item beserta byte-nya. Id lampiran dari hanoman_backlog_attachments_list.",
    inputSchema: obj({
      properties: { spec: str(ID_HINT), attachment: str("Id lampiran.") },
      required: ["spec", "attachment"],
    }),
    mode: "write", capability: "backlog:write",
    samplePath: "/specs/SPEC-1/attachments/a1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/specs/${enc(String(a.spec))}/attachments/${enc(String(a.attachment))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_escalation_get",
    title: "Rekomendasi tindak lanjut audit",
    description:
      "Rekomendasi eskalasi yang ditulis sesi audit di dokumennya. `escalation: null` adalah keadaan NORMAL — audit lama tak menulisnya, dan sesi yang masih berjalan belum menulisnya; itu bukan galat. 404 hanya bila backlog item-nya sendiri tak ada.",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "read", capability: "backlog:read",
    samplePath: "/specs/SPEC-1/escalation", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/specs/${enc(String(a.spec))}/escalation` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_review",
    title: "Review diff backlog",
    description:
      "Diff pekerjaan sebuah backlog item. Tanpa `path` ia mengembalikan daftar berkas yang berubah; mengisi `path` mengembalikan diff satu berkas. Menjawab 409 bila belum ada worktree maupun commit — itu berarti sesinya belum pernah jalan, bukan galat.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        path: str("Jalur berkas. Mengisinya menghasilkan diff satu berkas, bukan daftar."),
      },
      required: ["spec"],
    }),
    mode: "read", capability: "backlog:read",
    samplePath: "/specs/SPEC-1/review", sampleMethod: "GET",
    build: (a) => {
      const path = s(a.path);
      const base = `/specs/${enc(String(a.spec))}/review`;
      return { method: "GET", path: path ? `${base}/${String(path).split("/").map(enc).join("/")}` : base };
    },
    shape: (raw) => raw,
  },
  // ADR-0155 · capability-nya `backlog:write`, BUKAN `backlog:lifecycle`, dan itu BENAR:
  // `capabilityForRoute` memetakan PATCH /specs/:id ke `backlog:write` dan sengaja tak pernah
  // melihat body. Gerbang `backlog:lifecycle` untuk `{stage}` hidup di HANDLER (routes/specs.ts).
  // Menaikkan nilai di sini akan MEMBUAT uji kontrak merah, bukan memperbaiki keamanan;
  // deskripsinya yang memberitahu agen capability apa yang sebenarnya dituntut server.
  {
    name: "hanoman_backlog_stage_set",
    title: "Geser stage backlog (BERBAHAYA)",
    description:
      "BERBAHAYA — menggeser stage backlog MUNDUR, yang MENGHAPUS artefak dokumen tahap yang dilewati. Stage hanya boleh mundur; maju ditolak 422. Server menuntut capability `backlog:lifecycle` untuk operasi ini meskipun route-nya sama dengan hanoman_backlog_update — token yang hanya punya `backlog:write` menerima 403 yang menyebutnya. Tanpa `confirmDelete: true` server menjawab dry-run berisi daftar dokumen yang akan hilang. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        stage: enumStr([...STAGE_ENUM], "Stage tujuan. Harus lebih awal dari stage sekarang."),
        confirmDelete: bool("true = jalankan meski ada dokumen yang terhapus. Tanpa ini, server hanya melaporkan apa yang akan hilang."),
      },
      required: ["spec", "stage"],
    }),
    mode: "danger", capability: "backlog:write",
    samplePath: "/specs/SPEC-1", sampleMethod: "PATCH",
    build: (a) => ({
      method: "PATCH", path: `/specs/${enc(String(a.spec))}`,
      body: { stage: String(a.stage), ...(a.confirmDelete === true ? { confirmDelete: true } : {}) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_integrate",
    title: "Integrate branch backlog (BERBAHAYA)",
    description:
      "BERBAHAYA — merge atau rebase branch hasil sebuah backlog item yang sudah `done`. Konflik MEMBUKA SESI AGEN untuk menyelesaikannya. Menuntut capability `backlog:lifecycle`; `backlog:write` tidak cukup. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        spec: str(ID_HINT),
        op: enumStr(["merge", "rebase"], "Cara integrasi. `rebase` menulis ulang sejarah."),
        target: str("Tujuan, berbentuk `local:<branch>` atau `origin:<branch>`. Prefix-nya WAJIB."),
      },
      required: ["spec", "op", "target"],
    }),
    mode: "danger", capability: "backlog:lifecycle",
    samplePath: "/specs/SPEC-1/integrate", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/specs/${enc(String(a.spec))}/integrate`,
      body: { op: String(a.op), target: String(a.target) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_delete",
    title: "Hapus backlog (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus backlog item beserta lampirannya secara permanen, dan melepas dependency item lain yang menunjuk padanya. Penghapusan ini MENYEBERANG SYNC: instance lain akan ikut kehilangannya. Menuntut capability `backlog:lifecycle`; `backlog:write` tidak cukup. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { spec: str(ID_HINT) }, required: ["spec"] }),
    mode: "danger", capability: "backlog:lifecycle",
    samplePath: "/specs/SPEC-1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/specs/${enc(String(a.spec))}` }),
    shape: (raw) => raw,
  },
];

export const BACKLOG_TOOLS: readonly McpToolDef[] = [...CORE, ...LIFECYCLE_AND_MORE];
