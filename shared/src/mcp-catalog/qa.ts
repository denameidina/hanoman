// Workspace QA · katalog tool domain `qa` (`/api/projects/:id/qa/**`). Delapan tool: baca laporan, tulis
// laporan/test case/temuan. SENGAJA tanpa tool hapus/lampiran/ekspor/impor (lihat UNWRAPPED di
// server/test/mcp-coverage.test.ts): hapus tak punya jalan pulang, lampiran & ZIP adalah biner.
//
// Dua sifat yang WAJIB terbaca agen di deskripsi karena sudah terukur di servernya:
//   1. Laporan `closed` read-only (409) — buka kembali dulu dengan `status: draft`.
//   2. `severity` (dampak teknis) BUKAN `priority` (urutan perbaikan); keduanya diisi terpisah.
import { QA_CASE_STATUSES, QA_PRIORITIES, QA_REPORT_STATUSES, QA_SEVERITIES, QA_VERDICTS } from "../qa";
import { enumStr, obj, str } from "../mcp-schema";
import { enc, s } from "./helpers";
import type { Args, McpToolDef } from "./types";

const PROJECT = str("Id project, seperti muncul di hanoman_projects_list.");
const REPORT = str("Id laporan QA (cuid), seperti muncul di hanoman_qa_reports_list — BUKAN nomor tampil `QA-007`, yang dihitung saat render.");
const CASE = str("Id test case (cuid), dari hanoman_qa_report_get.");
const FINDING = str("Id temuan (cuid), dari hanoman_qa_report_get.");

const base = (a: Args) => `/projects/${enc(String(a.project))}/qa/reports`;
const one = (a: Args) => `${base(a)}/${enc(String(a.report))}`;

/** `k=v` dipisah baris atau `;` → objek. Baris tanpa `=` jadi kunci bernilai kosong. */
const parseEnv = (v: unknown): Record<string, string> | undefined => {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const out: Record<string, string> = {};
  for (const part of v.split(/[\n;]/)) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf("=");
    const k = (i < 0 ? t : t.slice(0, i)).trim();
    if (k) out[k] = i < 0 ? "" : t.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
};
/** Satu langkah per baris; awalan `1.`, `2)`, `-`, `*` dibuang supaya server yang menomori. */
const parseSteps = (v: unknown): string[] | undefined =>
  typeof v === "string" && v.trim()
    ? v.split("\n").map((l) => l.trim().replace(/^(?:\d+[.)]|[-*])\s+/, "")).filter(Boolean)
    : undefined;
/** Tiga keadaan seperti tool papan Tim: tak disebut = biarkan, "" = kosongkan (null), string = isi. */
const nullable = (v: unknown): string | null | undefined => (typeof v !== "string" ? undefined : v === "" ? null : v);

const put = (body: Record<string, unknown>, key: string, v: unknown) => { if (v !== undefined) body[key] = v; };

const REPORT_FIELDS = {
  title: str("Judul laporan, satu baris."),
  buildVersion: str("Versi/build yang diuji, mis. `0.9.12`."),
  environment: str("Lingkungan uji: `kunci=nilai` dipisah baris atau `;`, mis. `os=macOS 15; browser=Chrome 130; url=https://staging.x.id`. Maks 20 entri."),
  scope: str("Cakupan: apa yang diuji dan apa yang sengaja tidak."),
  tester: str("Nama penguji."),
  summary: str("Ringkasan hasil, 2–3 kalimat, memuat alasan keputusan."),
  verdict: enumStr(QA_VERDICTS, "Keputusan rilis. Wajib terisi sebelum `status` boleh `submitted`/`closed`."),
};
const reportBody = (a: Args): Record<string, unknown> => {
  const b: Record<string, unknown> = {};
  for (const k of ["title", "buildVersion", "scope", "tester", "summary", "verdict", "status"] as const) put(b, k, s(a[k]));
  put(b, "environment", parseEnv(a.environment));
  return b;
};
const caseBody = (a: Args): Record<string, unknown> => {
  const b: Record<string, unknown> = {};
  for (const k of ["title", "steps", "expected", "actual", "status"] as const) put(b, k, s(a[k]));
  return b;
};
const findingBody = (a: Args): Record<string, unknown> => {
  const b: Record<string, unknown> = {};
  for (const k of ["title", "severity", "priority", "area", "expected", "actual", "status"] as const) put(b, k, s(a[k]));
  put(b, "steps", parseSteps(a.steps));
  put(b, "caseId", nullable(a.testCase));
  return b;
};

const CASE_FIELDS = {
  title: str("Judul test case."),
  steps: str("Langkah uji (teks bebas)."),
  expected: str("Hasil yang diharapkan."),
  actual: str("Hasil aktual."),
  status: enumStr(QA_CASE_STATUSES, "Status eksekusi."),
};
const FINDING_FIELDS = {
  title: str("Judul temuan — satu masalah, satu baris."),
  severity: enumStr(QA_SEVERITIES, "Dampak TEKNIS. Bukan prioritas."),
  priority: enumStr(QA_PRIORITIES, "Urutan perbaikan P0 (paling mendesak)–P3. Terpisah dari severity: bug minor di halaman checkout bisa P0."),
  area: str("Area/fitur, mis. `checkout`."),
  steps: str("Langkah reproduksi, SATU PER BARIS (penomoran `1.` di awal dibuang; server menomori)."),
  expected: str("Yang seharusnya terjadi."),
  actual: str("Yang benar-benar terjadi."),
  status: enumStr(["open", "wontfix"], "`open` atau `wontfix`. `sent` (sudah jadi backlog) hanya ditulis server."),
  testCase: str("Id test case terkait, dari hanoman_qa_report_get. String KOSONG melepas tautan; tak menyebutnya membiarkan apa adanya."),
};

export const QA_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_qa_reports_list",
    title: "Daftar laporan QA",
    description:
      "Laporan QA sebuah project, terbaru-diubah dulu, dengan nomor tampil (`QA-001`), status (`draft|submitted|closed`), keputusan (`go|no-go|conditional`), dan statistik (pass-rate dari yang dieksekusi, temuan per severity, jumlah open). Nomor tampil dihitung dari urutan pembuatan — pakai `id`, bukan nomor, saat memanggil tool lain.",
    inputSchema: obj({ properties: { project: PROJECT }, required: ["project"] }),
    mode: "read", capability: "qa:read", samplePath: "/projects/p1/qa/reports", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: base(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_report_get",
    title: "Detail laporan QA",
    description:
      "Satu laporan QA lengkap: header, test case (`TC-01…`), temuan (`F-01…`, dengan repro bernomor, severity, prioritas, `caseCode`), dan metadata lampiran (nama, tipe, ukuran — bukan byte).",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT }, required: ["project", "report"] }),
    mode: "read", capability: "qa:read", samplePath: "/projects/p1/qa/reports/r1", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: one(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_report_create",
    title: "Buat laporan QA",
    description: "Membuat laporan QA berstatus `draft`. Hanya `project` dan `title` yang wajib. Test case dan temuan ditambahkan lewat tool terpisah.",
    inputSchema: obj({ properties: { project: PROJECT, ...REPORT_FIELDS }, required: ["project", "title"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: base(a), body: reportBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_report_update",
    title: "Ubah laporan QA",
    description:
      "Mengubah header laporan; hanya field yang disebut yang ditulis. `status`: `draft → submitted → closed`; `submitted`/`closed` DITOLAK 400 bila `verdict` belum terisi. Laporan `closed` read-only (409) untuk semua tool QA — satu-satunya ubahan yang lolos adalah `status: draft` untuk membukanya kembali.",
    inputSchema: obj({
      properties: { project: PROJECT, report: REPORT, ...REPORT_FIELDS, status: enumStr(QA_REPORT_STATUSES, "Status laporan.") },
      required: ["project", "report"],
    }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: one(a), body: reportBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_case_create",
    title: "Tambah test case",
    description: "Menambah test case ke akhir daftar laporan. Hanya `title` yang wajib; status awal `todo`. Jawabannya adalah laporan terbaru (test case baru = entri terakhir `cases`).",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, ...CASE_FIELDS }, required: ["project", "report", "title"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/cases", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${one(a)}/cases`, body: caseBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_case_update",
    title: "Ubah test case",
    description: "Mengubah test case; hanya field yang disebut yang ditulis. Biasa dipakai untuk mencatat hasil: `status` (`pass|fail|blocked|skipped`) dan `actual`.",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, case: CASE, ...CASE_FIELDS }, required: ["project", "report", "case"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/cases/c1", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: `${one(a)}/cases/${enc(String(a.case))}`, body: caseBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_finding_create",
    title: "Catat temuan QA",
    description:
      "Mencatat satu temuan (bug) di laporan. Isi `severity` (dampak teknis) DAN `priority` (urutan perbaikan) secara terpisah — keduanya tak selalu sama. Tulis `steps` sebagai langkah reproduksi yang bisa diulang orang lain, satu per baris. Temuan baru berstatus `open`; jawabannya laporan terbaru (temuan baru = entri terakhir `findings`).",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, ...FINDING_FIELDS }, required: ["project", "report", "title"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/findings", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${one(a)}/findings`, body: findingBody(a) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_qa_finding_update",
    title: "Ubah temuan QA",
    description: "Mengubah temuan; hanya field yang disebut yang ditulis. `status`: `open` atau `wontfix`.",
    inputSchema: obj({ properties: { project: PROJECT, report: REPORT, finding: FINDING, ...FINDING_FIELDS }, required: ["project", "report", "finding"] }),
    mode: "write", capability: "qa:write", samplePath: "/projects/p1/qa/reports/r1/findings/f1", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: `${one(a)}/findings/${enc(String(a.finding))}`, body: findingBody(a) }),
    shape: (raw) => raw,
  },
];
