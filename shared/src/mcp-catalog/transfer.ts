// ADR-0183 · ADR-0184 · katalog tool MCP untuk route MULTIPART/BINER (lampiran, ekspor, impor,
// unggah IDE, arsip git) dan hapus QA. Sebelumnya semua ini dikecualikan karena "tool MCP berbicara
// JSON teks" — pemilik repo meminta dibungkus, dan jawabannya BUKAN mengirim byte lewat model:
//
//   unggah  → argumen `filePath` (path LOKAL di mesin klien MCP). `build()` hanya menyatakan niat
//             (`McpRequest.multipart`); klien (`cli/src/mcp/transfer.ts`) yang membaca disk & merakit
//             multipart setelah menolak path berbahaya.
//   unduh   → byte disimpan ke `savePath` lokal (default direktori sementara aman) dan model hanya
//             menerima {savedTo, bytes, mime, sha256}. Teks kecil (md/csv) boleh `inline`.
//
// MODE mengikuti efek di mesin KLIEN, bukan hanya di server: tool yang MENULIS ke disk klien bermode
// `write` meski capability-nya `:read` — jadi `--read-only` tak pernah menyentuh disk. Tool `inline`
// tak menyentuh disk dan tetap `read`.
import { QA_OWNER_TYPES } from "../qa";
import { bool, enumStr, obj, str } from "../mcp-schema";
import type { JsonSchemaNode } from "../mcp-schema";
import { ID_HINT, enc, s } from "./helpers";
import type { Args, McpDownload, McpRequest, McpToolDef, McpUploadFile } from "./types";

const PROJECT = str("Id project, seperti muncul di hanoman_projects_list.");
const REPORT = str("Id laporan QA (cuid), seperti muncul di hanoman_qa_reports_list — BUKAN nomor tampil `QA-007`.");
const CASE = str("Id test case (cuid), dari hanoman_qa_report_get.");
const FINDING = str("Id temuan (cuid), dari hanoman_qa_report_get.");
const ATTACHMENT = str("Id lampiran, dari metadata lampiran di hanoman_qa_report_get.");

const LOCAL = "Path LOKAL di mesin tempat MCP server ini berjalan (bukan di server hanoman)";
const FILE_PATH = (extra = ""): JsonSchemaNode =>
  str(`${LOCAL}. Harus berada di dalam direktori kerja MCP atau direktori transfer yang diizinkan manusia; path dengan \`..\`, symlink yang keluar dari sana, dan berkas rahasia (\`.env\`, kunci SSH, dll.) ditolak.${extra ? ` ${extra}` : ""}`);
const FILE_PATHS = (min: number, max: number, extra = ""): JsonSchemaNode => ({
  type: "array", minItems: min, maxItems: max, items: { type: "string" },
  description: `${LOCAL}, satu atau lebih (${min}–${max}). Aturan path sama dengan \`filePath\`: di dalam direktori kerja/transfer yang diizinkan, tanpa \`..\`, tanpa symlink keluar, bukan berkas rahasia.${extra ? ` ${extra}` : ""}`,
});
const SAVE_PATH = str(
  `Tujuan simpan di mesin klien MCP: path berkas, atau direktori (berakhiran \`/\` atau sudah ada) agar nama dari server dipakai. Kosong = direktori sementara aman yang dibuat otomatis. Harus di dalam direktori kerja/transfer yang diizinkan; tanpa \`..\`.`,
);
const OVERWRITE = bool("`true` mengizinkan menimpa berkas yang sudah ada di `savePath`. Default `false`: berkas yang ada menolak (bukan ditimpa diam-diam). Symlink tak pernah ditimpa.");

const DOWNLOAD_RESULT =
  "Jawabannya {savedTo (path absolut), filename, bytes, mime, sha256} — byte TIDAK dikembalikan ke model; baca berkasnya dengan alat berkas milikmu. Menulis di MESIN KLIEN MCP, bukan di server hanoman.";

const dlFile = (a: Args, fallbackName: string): McpDownload => ({
  mode: "file", fallbackName,
  ...(s(a.savePath) ? { savePath: s(a.savePath) } : {}),
  ...(a.overwrite === true ? { overwrite: true } : {}),
});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const files = (field: string, v: unknown): McpUploadFile[] => strs(v).map((filePath) => ({ field, filePath }));
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

const qaBase = (a: Args) => `/projects/${enc(String(a.project))}/qa/reports`;
const qaOne = (a: Args) => `${qaBase(a)}/${enc(String(a.report))}`;
const specOne = (a: Args) => `/specs/${enc(String(a.spec))}/attachments`;

const SPEC = str(ID_HINT);

export const TRANSFER_TOOLS: readonly McpToolDef[] = [
  // ───────────────────────── lampiran backlog ─────────────────────────
  {
    name: "hanoman_backlog_attachment_upload",
    title: "Unggah lampiran backlog",
    description:
      "Mengunggah 1–10 berkas dari DISK LOKAL klien MCP sebagai lampiran backlog item (maks 10 MB per berkas, 40 MB per item; tipe yang diterima ditentukan server). Lampiran ikut dibawa ke konteks sesi berikutnya. Jawabannya hasil server per berkas (yang diterima & yang ditolak beserta alasannya). Daftar lampiran: hanoman_backlog_attachments_list.",
    inputSchema: obj({ properties: { spec: SPEC, filePaths: FILE_PATHS(1, 10) }, required: ["spec", "filePaths"] }),
    mode: "write", capability: "backlog:write", samplePath: "/specs/SPEC-1/attachments", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: specOne(a), multipart: { files: files("file", a.filePaths) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_backlog_attachment_download",
    title: "Unduh lampiran backlog",
    description: `Mengunduh isi SATU lampiran backlog item ke disk lokal klien MCP. Id lampiran dari hanoman_backlog_attachments_list. ${DOWNLOAD_RESULT}`,
    inputSchema: obj({
      properties: { spec: SPEC, attachment: str("Id lampiran."), savePath: SAVE_PATH, overwrite: OVERWRITE },
      required: ["spec", "attachment"],
    }),
    mode: "write", capability: "backlog:read", samplePath: "/specs/SPEC-1/attachments/a1", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${specOne(a)}/${enc(String(a.attachment))}`, download: dlFile(a, "lampiran") }),
    shape: (raw) => raw,
  },

  // ADR-0233 · mockup UI backlog (`docs/mockups/<spec-id>/`), biner → transfer tool (preseden ADR-0183).
  {
    name: "hanoman_backlog_mockup_download",
    title: "Unduh mockup backlog",
    description: `Mengunduh SATU gambar mockup UI backlog item ke disk lokal klien MCP. Nama berkas dari hanoman_backlog_mockups_list. ${DOWNLOAD_RESULT}`,
    inputSchema: obj({
      properties: { spec: SPEC, name: str("Nama berkas mockup, mis. `01-backlog-detail.png`."), savePath: SAVE_PATH, overwrite: OVERWRITE },
      required: ["spec", "name"],
    }),
    mode: "write", capability: "backlog:read", samplePath: "/specs/SPEC-1/mockups/01-x.png", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `/specs/${enc(String(a.spec))}/mockups/${enc(String(a.name))}`,
      download: dlFile(a, String(a.name ?? "mockup.png")),
    }),
    shape: (raw) => raw,
  },

  // ───────────────────────── lampiran tiket ─────────────────────────
  {
    name: "hanoman_ticket_attachment_download",
    title: "Unduh lampiran tiket",
    description: `Mengunduh isi SATU lampiran tiket Help Center ke disk lokal klien MCP. Id lampiran ada di \`attachments[]\` hanoman_ticket_get. ${DOWNLOAD_RESULT}`,
    inputSchema: obj({
      properties: { ticket: str("Id tiket, dari hanoman_tickets_list."), attachment: str("Id lampiran."), savePath: SAVE_PATH, overwrite: OVERWRITE },
      required: ["ticket", "attachment"],
    }),
    mode: "write", capability: "support:read", samplePath: "/tickets/t1/attachments/a1", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `/tickets/${enc(String(a.ticket))}/attachments/${enc(String(a.attachment))}`,
      download: dlFile(a, "lampiran"),
    }),
    shape: (raw) => raw,
  },

  // ───────────────────────── lampiran QA ─────────────────────────
  {
    name: "hanoman_qa_attachment_upload",
    title: "Unggah lampiran QA",
    description:
      "Mengunggah 1–30 berkas dari DISK LOKAL klien MCP (screenshot, log, rekaman) sebagai lampiran QA yang menempel pada SATU pemilik: laporan, test case, atau temuan. Maks 10 MB per berkas, 30 berkas & 100 MB per laporan. Laporan `closed` ditolak 409 — buka kembali dulu dengan hanoman_qa_report_update `status: draft`. Jawabannya hasil per berkas.",
    inputSchema: obj({
      properties: {
        project: PROJECT, report: REPORT,
        ownerType: enumStr(QA_OWNER_TYPES, "Jenis pemilik lampiran: `report`, `case`, atau `finding`."),
        ownerId: str("Id pemilik: id laporan bila `report`, id test case bila `case`, id temuan bila `finding`."),
        filePaths: FILE_PATHS(1, 30),
      },
      required: ["project", "report", "ownerType", "ownerId", "filePaths"],
    }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/attachments", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${qaOne(a)}/attachments`,
      query: { ownerType: String(a.ownerType), ownerId: String(a.ownerId) },
      multipart: { files: files("file", a.filePaths) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_attachment_download",
    title: "Unduh lampiran QA",
    description: `Mengunduh isi SATU lampiran QA ke disk lokal klien MCP. Id lampiran dari metadata lampiran di hanoman_qa_report_get. ${DOWNLOAD_RESULT}`,
    inputSchema: obj({
      properties: { project: PROJECT, report: REPORT, attachment: ATTACHMENT, savePath: SAVE_PATH, overwrite: OVERWRITE },
      required: ["project", "report", "attachment"],
    }),
    mode: "write", capability: "qa:read", samplePath: "/projects/p1/qa/reports/r1/attachments/a1", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `${qaOne(a)}/attachments/${enc(String(a.attachment))}`,
      download: dlFile(a, "lampiran"),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_attachment_delete",
    title: "Hapus lampiran QA (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus SATU lampiran QA beserta byte-nya secara permanen; penghapusan ikut tersinkron ke mesin lain. Laporan `closed` menolak (409). Butuh capability `qa:delete` (BUKAN diimplikasikan `qa:write`). Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: { project: PROJECT, report: REPORT, attachment: ATTACHMENT },
      required: ["project", "report", "attachment"],
    }),
    mode: "danger", capability: "qa:delete", samplePath: "/projects/p1/qa/reports/r1/attachments/a1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `${qaOne(a)}/attachments/${enc(String(a.attachment))}` }),
    shape: (raw) => raw,
  },

  // ───────────────────────── template, ekspor, impor QA ─────────────────────────
  {
    name: "hanoman_qa_template_md",
    title: "Template laporan QA (Markdown)",
    description:
      "Template laporan QA berformat Markdown — kerangka yang diterima impor (hanoman_qa_import). Dikembalikan INLINE sebagai teks `{filename, mime, bytes, content}`; tidak menyentuh disk. Template Excel: hanoman_qa_template_xlsx.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "qa:read", samplePath: "/qa/template.md", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/qa/template.md", download: { mode: "inline", fallbackName: "qa-template.md" } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_template_xlsx",
    title: "Unduh template QA (Excel)",
    description: `Mengunduh template Excel matriks test case QA (biner .xlsx) ke disk lokal klien MCP, siap diisi lalu diimpor lewat hanoman_qa_cases_import. ${DOWNLOAD_RESULT}`,
    inputSchema: obj({ properties: { savePath: SAVE_PATH, overwrite: OVERWRITE } }),
    mode: "write", capability: "qa:read", samplePath: "/qa/template.xlsx", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/qa/template.xlsx", download: dlFile(a, "qa-template.xlsx") }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_report_export_text",
    title: "Ekspor laporan QA (teks)",
    description:
      "Mengekspor satu laporan QA sebagai TEKS kecil, dikembalikan INLINE `{filename, mime, bytes, content}` tanpa menyentuh disk: `md` (laporan lengkap, format yang dibaca-balik impor) atau `csv` (matriks test case). Bila hasilnya melebihi batas inline, tool ini menolak — pakai hanoman_qa_report_export_file.",
    inputSchema: obj({
      properties: { project: PROJECT, report: REPORT, format: enumStr(["md", "csv"], "`md` atau `csv`. Default `md`.") },
      required: ["project", "report"],
    }),
    mode: "read", capability: "qa:read", samplePath: "/projects/p1/qa/reports/r1/export", sampleMethod: "GET",
    build: (a) => {
      const format = s(a.format) ?? "md";
      return {
        method: "GET", path: `${qaOne(a)}/export`, query: { format },
        download: { mode: "inline", fallbackName: `laporan-qa.${format}` },
      };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_report_export_file",
    title: "Ekspor laporan QA (berkas)",
    description: `Mengekspor satu laporan QA ke BERKAS di disk lokal klien MCP. \`format\`: \`zip\` (default; Markdown + lampiran, bisa diimpor ulang), \`md\`, \`csv\`, \`docx\`, \`pdf\`, \`xlsx\`. ${DOWNLOAD_RESULT} Untuk md/csv kecil tanpa disk: hanoman_qa_report_export_text.`,
    inputSchema: obj({
      properties: {
        project: PROJECT, report: REPORT,
        format: enumStr(["zip", "md", "docx", "pdf", "xlsx", "csv"], "Format ekspor. Default `zip`."),
        savePath: SAVE_PATH, overwrite: OVERWRITE,
      },
      required: ["project", "report"],
    }),
    mode: "write", capability: "qa:read", samplePath: "/projects/p1/qa/reports/r1/export", sampleMethod: "GET",
    build: (a) => {
      const format = s(a.format) ?? "zip";
      return {
        method: "GET", path: `${qaOne(a)}/export`, query: { format },
        download: dlFile(a, `laporan-qa.${format}`),
      };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_import",
    title: "Impor laporan QA",
    description:
      "Mengimpor SATU laporan QA dari disk lokal klien MCP: Excel (.xlsx), ZIP (hasil hanoman_qa_report_export_file), atau Markdown (.md). Untuk Markdown yang merujuk gambar, sertakan gambarnya di `attachmentPaths` (maks 30). Total maks ~105 MB. Laporan lahir sebagai BARU (atau diperbarui bila kodenya sudah ada — lihat `created` di jawaban). Untuk hanya memperbarui matriks test case laporan yang sudah ada: hanoman_qa_cases_import.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        filePath: FILE_PATH("Satu berkas: .xlsx, .zip, atau .md."),
        attachmentPaths: FILE_PATHS(1, 30, "Opsional — gambar pendamping untuk impor Markdown."),
      },
      required: ["project", "filePath"],
    }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/import", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/projects/${enc(String(a.project))}/qa/import`,
      multipart: { files: [{ field: "file", filePath: String(a.filePath) }, ...files("attachments", a.attachmentPaths)] },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_cases_import",
    title: "Impor matriks test case QA",
    description:
      "Mengimpor matriks test case dari berkas Excel/CSV di disk lokal klien MCP ke laporan yang SUDAH ada (upsert berdasarkan kolom `Ref`; maks 8 MB). Template: hanoman_qa_template_xlsx. Laporan `closed` ditolak 409. Jawabannya ringkasan baris yang dibuat/diubah/ditolak.",
    inputSchema: obj({
      properties: { project: PROJECT, report: REPORT, filePath: FILE_PATH("Satu berkas .xlsx atau .csv.") },
      required: ["project", "report", "filePath"],
    }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/cases/import", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${qaOne(a)}/cases/import`,
      multipart: { files: [{ field: "file", filePath: String(a.filePath) }] },
    }),
    shape: (raw) => raw,
  },

  // ───────────────────────── IDE: unggah berkas & arsip git ─────────────────────────
  {
    name: "hanoman_ide_upload",
    title: "Unggah berkas ke working tree",
    description:
      "Mengunggah 1–100 berkas dari DISK LOKAL klien MCP ke working tree project (maks 100 MB per berkas, ~2 GB total). Tiap item `{filePath, path?}`: `path` = nama/path relatif tujuan di bawah `dir` (default nama dasar `filePath`, boleh memuat subfolder). Berkas yang sudah ada DILEWATI kecuali `overwrite: true`. Jawabannya `{written[], skipped[{path, reason: exists|too-large|budget|denied}]}`. Capability `ide:write` — hak yang sama untuk menulis berkas apa pun di working tree.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        dir: str("Folder tujuan relatif terhadap akar repo, mis. `docs/assets`. Kosong = akar repo."),
        overwrite: bool("`true` menimpa berkas tujuan yang sudah ada. Default `false`: dilewati dan dilaporkan di `skipped`."),
        files: {
          type: "array", minItems: 1, maxItems: 100,
          description: `Berkas yang diunggah. Setiap \`filePath\` adalah ${LOCAL}; aturan path sama dengan tool unggah lain.`,
          items: {
            type: "object", additionalProperties: false, required: ["filePath"],
            properties: {
              filePath: FILE_PATH(),
              path: str("Path relatif tujuan di bawah `dir`. Kosong = nama dasar `filePath`."),
            },
          },
        },
      },
      required: ["project", "files"],
    }),
    mode: "write", capability: "ide:write", samplePath: "/projects/p1/upload", sampleMethod: "POST",
    build: (a): McpRequest => {
      const items = (Array.isArray(a.files) ? a.files : []) as { filePath?: unknown; path?: unknown }[];
      const picked = items.map((i) => {
        const filePath = String(i.filePath ?? "");
        return { filePath, name: s(i.path) ?? baseName(filePath) };
      });
      // URUTAN part adalah kontrak server (ADR-0121): dir → overwrite → manifest → berkas.
      return {
        method: "POST", path: `/projects/${enc(String(a.project))}/upload`,
        multipart: {
          fields: [
            ["dir", s(a.dir) ?? ""],
            ["overwrite", a.overwrite === true ? "1" : "0"],
            ["manifest", JSON.stringify(picked.map((p) => p.name))],
          ],
          files: picked.map((p) => ({ field: "file", filePath: p.filePath, name: p.name })),
        },
      };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_archive_download",
    title: "Unduh arsip git",
    description: `Mengunduh arsip (\`git archive\`) sebuah ref project — hanya berkas ter-track, tanpa riwayat — ke disk lokal klien MCP. \`format\`: \`zip\` (default) atau \`tar\`. ${DOWNLOAD_RESULT}`,
    inputSchema: obj({
      properties: {
        project: PROJECT,
        ref: str("Branch, tag, atau sha. Default `HEAD`."),
        format: enumStr(["zip", "tar"], "Default `zip`."),
        savePath: SAVE_PATH, overwrite: OVERWRITE,
      },
      required: ["project"],
    }),
    mode: "write", capability: "ide:read", samplePath: "/projects/p1/archive", sampleMethod: "GET",
    build: (a) => {
      const format = s(a.format) ?? "zip";
      return {
        method: "GET", path: `/projects/${enc(String(a.project))}/archive`,
        query: { ...(s(a.ref) ? { ref: s(a.ref)! } : {}), format },
        download: dlFile(a, `arsip.${format}`),
      };
    },
    shape: (raw) => raw,
  },

  // ───────────────────────── sesi: lampiran gambar ─────────────────────────
  {
    name: "hanoman_session_attachment_upload",
    title: "Unggah gambar ke sesi",
    description:
      "Mengunggah SATU gambar (PNG/JPEG/WebP, maks 5 MB) dari DISK LOKAL klien MCP ke sesi yang sedang hidup. Jawabannya `{path}` — path berkas di SERVER, bukan di disk lokalmu; sebutkan path itu di pesan ke sesi (hanoman_session_steer) agar agen sesi bisa membukanya. Sesi tak hidup → 404.",
    inputSchema: obj({
      properties: { session: str("Id sesi hidup, dari hanoman_sessions_list."), filePath: FILE_PATH("Satu gambar PNG/JPEG/WebP.") },
      required: ["session", "filePath"],
    }),
    mode: "write", capability: "sessions:write", samplePath: "/terminal/sessions/s1/attachments", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/terminal/sessions/${enc(String(a.session))}/attachments`,
      multipart: { files: [{ field: "file", filePath: String(a.filePath) }] },
    }),
    shape: (raw) => raw,
  },

  // ───────────────────────── hapus QA (capability `qa:delete`) ─────────────────────────
  {
    name: "hanoman_qa_report_delete",
    title: "Hapus laporan QA (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus SATU laporan QA beserta SEMUA test case, temuan, dan lampirannya secara permanen; penghapusan ikut tersinkron ke mesin lain dan tak ada jalan pulang. Backlog yang sudah dilahirkan dari temuannya TIDAK ikut terhapus. Laporan `closed` menolak (409) — buka kembali dulu dengan hanoman_qa_report_update `status: draft`. Butuh capability `qa:delete` (BUKAN diimplikasikan `qa:write`). Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT }, required: ["project", "report"] }),
    mode: "danger", capability: "qa:delete", samplePath: "/projects/p1/qa/reports/r1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: qaOne(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_case_delete",
    title: "Hapus test case QA (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus SATU test case dari laporan QA beserta lampirannya, permanen (temuan yang menunjuknya hanya dilepas tautannya, tidak terhapus). Jawabannya laporan terbaru. Laporan `closed` menolak (409). Butuh capability `qa:delete` (BUKAN diimplikasikan `qa:write`). Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, case: CASE }, required: ["project", "report", "case"] }),
    mode: "danger", capability: "qa:delete", samplePath: "/projects/p1/qa/reports/r1/cases/c1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `${qaOne(a)}/cases/${enc(String(a.case))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_finding_delete",
    title: "Hapus temuan QA (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus SATU temuan dari laporan QA beserta lampirannya, permanen. Backlog yang sudah dilahirkan dari temuan itu TIDAK ikut terhapus. Laporan `closed` menolak (409). Butuh capability `qa:delete` (BUKAN diimplikasikan `qa:write`). Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, finding: FINDING }, required: ["project", "report", "finding"] }),
    mode: "danger", capability: "qa:delete", samplePath: "/projects/p1/qa/reports/r1/findings/f1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `${qaOne(a)}/findings/${enc(String(a.finding))}` }),
    shape: (raw) => raw,
  },
];
