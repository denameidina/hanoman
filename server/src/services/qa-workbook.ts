import {
  QA_REPORT_STATUSES, QA_VERDICTS, QA_SEVERITIES, QA_PRIORITIES, QA_FINDING_STATUSES,
  parseCaseRows, QaTableError, parseQaMarkdown, qaTemplateMarkdown,
  qaCodeKey, zCreateQaReport, zCreateQaCase, zCreateQaFinding, type QaParsedReport, type QaReportDetail, qaStats,
} from "@hanoman/shared";
import { readXlsx, writeXlsx, XlsxError } from "./xlsx";

const GUIDE = [
  ["Bagian", "Cara mengisi"],
  ["Mulai di sini", "Isi Ringkasan, lalu Test case dan Temuan. Hapus atau ganti baris contoh. Sheet Panduan tidak diimpor."],
  ["Ringkasan", "Judul wajib. Kolom lain boleh kosong. Status: draft, submitted, closed. Keputusan: go (siap), no-go (belum siap), conditional (siap dengan catatan); wajib untuk submitted/closed."],
  ["Test case", "Satu baris = satu pengujian. Status: belum, lulus, gagal, terblokir, dilewati (atau todo, pass, fail, blocked, skipped). Langkah: satu per baris di dalam sel (Alt+Enter)."],
  ["Temuan", "Satu baris = satu masalah. Severity: blocker (tidak bisa dipakai), critical (kritis), major (fitur terganggu), minor (gangguan kecil), trivial (tampilan). Prioritas: P0 segera, P1 tinggi, P2 normal, P3 rendah."],
  ["Lampiran", "Satu baris = satu berkas. Pemilik: Laporan, atau Kode test case/temuan (apa pun yang Anda tulis, mis. TC-01 atau LOGIN-3). Berkas: nama screenshot/log yang dipilih bersama Excel, atau attachments/nama.png dalam ZIP. Maks 10 MB/berkas, 30 berkas dan 100 MB/laporan."],
  ["Impor dengan lampiran", "Pilih Excel dan berkas lampiran bersama-sama di dashboard, atau ZIP berisi report.xlsx dan folder attachments/. Gambar yang hanya ditempel di sel Excel tidak diimpor; sertakan berkas gambarnya."],
  ["Ref", "Biarkan Ref laporan/test case/temuan hasil ekspor untuk memperbarui laporan asal. Kosongkan untuk entri baru."],
  ["Kode", "Bebas Anda tentukan (mis. LOGIN-01, AUTH.3), asal unik di seluruh laporan — test case dan temuan tidak boleh sama, huruf besar/kecil dianggap sama. Kosongkan untuk nomor otomatis (TC-01 / F-01). Test case pada Temuan merujuk Kode test case."],
  ["Lingkungan", "Satu per baris: os=Windows 11, browser=Chrome, device=Laptop, url=https://… ."],
];

export function writeQaWorkbook(d: QaReportDetail, paths: Record<string, string> = {}): Buffer {
  const owner = (type: string, id: string) => type === "report" ? "Laporan"
    : type === "case" ? d.cases.find((c) => c.id === id)?.code ?? ""
    : d.findings.find((f) => f.id === id)?.code ?? "";
  return writeXlsx([
    { name: "Panduan", rows: GUIDE, widths: [24, 100] },
    { name: "Ringkasan", widths: [24, 80], dropdowns: [{ range: "B7", values: QA_REPORT_STATUSES }, { range: "B8", values: QA_VERDICTS }], rows: [
      ["Kolom", "Nilai"], ["Judul", d.title], ["Build / versi", d.buildVersion], ["Penguji", d.tester],
      ["Cakupan", d.scope], ["Ringkasan", d.summary], ["Status", d.status], ["Keputusan", d.verdict ?? ""],
      ["Lingkungan", Object.entries(d.environment).map(([k, v]) => `${k}=${v}`).join("\n")], ["Ref", d.id],
    ] },
    { name: "Test case", dropdowns: [{ range: "F2:F5000", values: ["belum", "lulus", "gagal", "terblokir", "dilewati", "todo", "pass", "fail", "blocked", "skipped"] }], widths: [12, 34, 40, 32, 32, 14, 28], rows: [
      ["Kode", "Judul", "Langkah", "Diharapkan", "Aktual", "Status", "Ref"],
      ...d.cases.map((c) => [c.code, c.title, c.steps, c.expected, c.actual, c.status, c.id]),
    ] },
    { name: "Temuan", dropdowns: [{ range: "C2:C5000", values: QA_SEVERITIES }, { range: "D2:D5000", values: QA_PRIORITIES }, { range: "E2:E5000", values: QA_FINDING_STATUSES }], widths: [12, 34, 14, 12, 14, 20, 14, 40, 32, 32, 14, 16, 28, 28], rows: [
      ["Kode", "Judul", "Severity", "Prioritas", "Status", "Area", "Test case", "Langkah", "Expected", "Actual", "Backlog", "Stage backlog", "Lampiran", "Ref"],
      ...d.findings.map((f) => [f.code, f.title, f.severity, f.priority, f.status, f.area, f.caseCode ?? "", f.steps.join("\n"), f.expected, f.actual, f.backlogId ?? "", f.spec?.stage ?? "", d.attachments.filter((a) => a.ownerType === "finding" && a.ownerId === f.id).map((a) => a.filename).join(", "), f.id]),
    ] },
    { name: "Lampiran", widths: [20, 70], rows: [
      ["Pemilik", "Berkas"], ...d.attachments.map((a) => [owner(a.ownerType, a.ownerId), paths[a.id] ?? a.filename]),
    ] },
  ]);
}

export function qaTemplateWorkbook(): Buffer {
  const p = parseQaMarkdown(qaTemplateMarkdown());
  const at = new Date(0).toISOString();
  return writeQaWorkbook({ ...p, id: "", projectId: "", code: "QA-001", createdAt: at, updatedAt: at,
    cases: p.cases.map((c, i) => ({ ...c, id: "", reportId: "", order: i + 1, createdAt: at, updatedAt: at })),
    findings: p.findings.map((f) => ({ ...f, id: "", reportId: "", backlogId: null, spec: null, createdAt: at, updatedAt: at })),
    attachments: [], stats: qaStats(p.cases, p.findings),
  });
}

const norm = (s: string) => s.trim().toLowerCase();
function fail(sheet: string, row: number, message: string): never { throw new XlsxError(`${sheet}, baris ${row}: ${message}`); }
const choice = <T extends string>(s: string, allowed: readonly T[], sheet: string, row: number): T => {
  const v = allowed.find((a) => norm(a) === norm(s));
  return v ?? fail(sheet, row, `nilai "${s}" tidak dikenal; pilih ${allowed.join(", ")}`);
};

/** Parse all sheets and validate before the transfer service writes any database rows. */
export function parseQaWorkbook(buf: Buffer): QaParsedReport {
  const read = (sheet: string) => readXlsx(buf, { sheet, required: true });
  const summary = read("Ringkasan");
  if (norm(summary[0]?.[0] ?? "") !== "kolom" || norm(summary[0]?.[1] ?? "") !== "nilai") fail("Ringkasan", 1, "butuh kolom Kolom dan Nilai");
  const fields = new Map(summary.slice(1).map((r) => [norm(r[0] ?? ""), r[1] ?? ""]));
  const val = (k: string) => fields.get(norm(k)) ?? "";
  const rowOf = (k: string) => Math.max(1, summary.findIndex((r) => norm(r[0] ?? "") === norm(k)) + 1);
  if (!val("Judul").trim()) fail("Ringkasan", rowOf("Judul"), "Judul wajib diisi");
  const environment: Record<string, string> = Object.create(null);
  // Excel menyimpan Alt+Enter sebagai \r\n; `;` (diikuti kunci=) juga pemisah sah (lihat katalog MCP QA).
  for (const line of val("Lingkungan").split(/\r\n|\r|\n|;(?=\s*[^=:;\s]+\s*[=:])/).filter((l) => l.trim())) {
    const match = /^\s*([^=:]+)[=:]\s*(.*)$/.exec(line);
    if (!match) fail("Ringkasan", rowOf("Lingkungan"), "Lingkungan: gunakan kunci=nilai, satu per baris");
    environment[match[1]!.trim()] = match[2]!;
  }
  const base = zCreateQaReport.safeParse({ title: val("Judul"), buildVersion: val("Build / versi"), tester: val("Penguji"), scope: val("Cakupan"), summary: val("Ringkasan"), environment,
    verdict: val("Keputusan") ? choice(val("Keputusan"), QA_VERDICTS, "Ringkasan", rowOf("Keputusan")) : null });
  if (!base.success) fail("Ringkasan", 1, base.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "));
  const parsed: QaParsedReport = { ...base.data, reportId: val("Ref") || null,
    status: choice(val("Status") || "draft", QA_REPORT_STATUSES, "Ringkasan", rowOf("Status")), cases: [], findings: [], attachments: [] };
  let cases;
  try { cases = parseCaseRows(read("Test case")); }
  catch (e) { if (e instanceof QaTableError) throw new XlsxError(`Test case, ${e.message}`); throw e; }
  const rows = read("Temuan");
  const headers = rows[0]?.map(norm) ?? [];
  for (const h of ["judul", "severity", "prioritas", "langkah", "expected", "actual"]) if (!headers.includes(h)) fail("Temuan", 1, `kolom ${h} wajib ada`);
  const getF = (r: string[], k: string) => r[headers.indexOf(norm(k))] ?? "";
  const findingRows = rows.slice(1).map((r, i) => ({ r, row: i + 2 })).filter(({ r }) => !r.every((v) => !v.trim()));
  // Kode bebas (ADR-0176): apa pun yang diketik QA, asal unik di seluruh laporan (test case + temuan, tak peka huruf).
  // Sel Kode kosong = nomor otomatis yang melewati kode bebas.
  const used = new Map<string, string>();
  const claim = (sheet: string, row: number, code: string) => {
    if (norm(code) === "laporan") fail(sheet, row, "Kode \"Laporan\" dicadangkan untuk lampiran laporan");
    if (used.has(qaCodeKey(code))) fail(sheet, row, `Kode ${code} dipakai ${used.get(qaCodeKey(code))}; kode harus unik`);
    used.set(qaCodeKey(code), `${sheet}`);
  };
  for (const c of cases) if (c.code.trim()) claim("Test case", c.row, c.code.trim());
  for (const { r, row } of findingRows) if (getF(r, "Kode").trim()) claim("Temuan", row, getF(r, "Kode").trim());
  const autoCode = (prefix: string, counter: { n: number }) => {
    let code: string;
    do { code = `${prefix}${String(++counter.n).padStart(2, "0")}`; } while (used.has(qaCodeKey(code)));
    return code;
  };
  const caseCounter = { n: 0 };
  const caseByKey = new Map<string, string>();
  const refs = new Set<string>();
  for (const c of cases) {
    const customCode = c.code.trim() || null;
    const code = customCode ?? autoCode("TC-", caseCounter);
    if (c.ref && refs.has(c.ref)) fail("Test case", c.row, "Ref berulang");
    if (c.ref) refs.add(c.ref);
    const result = zCreateQaCase.safeParse({ title: c.title, steps: c.steps ?? "", expected: c.expected ?? "", actual: c.actual ?? "", status: c.status ?? "todo" });
    if (!result.success) fail("Test case", c.row, result.error.issues.map((e) => `${e.path}: ${e.message}`).join("; "));
    caseByKey.set(qaCodeKey(code), code);
    parsed.cases.push({ ...result.data, id: c.ref, code, customCode, attachments: [] });
  }
  const findingCounter = { n: 0 };
  const findingRefs = new Set<string>();
  for (const { r, row } of findingRows) {
    const get = (k: string) => getF(r, k);
    const customCode = get("Kode").trim() || null;
    const code = customCode ?? autoCode("F-", findingCounter);
    const id = get("Ref") || null;
    if (id && findingRefs.has(id)) fail("Temuan", row, "Ref berulang");
    if (id) findingRefs.add(id);
    const caseRef = get("Test case").trim();
    const caseCode = caseRef ? caseByKey.get(qaCodeKey(caseRef)) ?? null : null;
    if (caseRef && !caseCode) fail("Temuan", row, `Test case ${caseRef} tidak ditemukan`);
    const status = choice(get("Status") || "open", QA_FINDING_STATUSES, "Temuan", row);
    const result = zCreateQaFinding.safeParse({ title: get("Judul"), severity: choice(get("Severity") || "major", QA_SEVERITIES, "Temuan", row), priority: choice(get("Prioritas") || "P2", QA_PRIORITIES, "Temuan", row), area: get("Area"),
      steps: get("Langkah").split("\n").map((s) => s.trim().replace(/^\d+[.)]\s+/, "")).filter(Boolean), expected: get("Expected"), actual: get("Actual"), status: status === "sent" ? "open" : status });
    if (!result.success) fail("Temuan", row, result.error.issues.map((e) => `${e.path}: ${e.message}`).join("; "));
    parsed.findings.push({ ...result.data, status, id, code, customCode, caseId: null, caseCode, attachments: [] });
  }
  const attachments = read("Lampiran");
  if (norm(attachments[0]?.[0] ?? "") !== "pemilik" || norm(attachments[0]?.[1] ?? "") !== "berkas") fail("Lampiran", 1, "butuh kolom Pemilik dan Berkas");
  for (let i = 1; i < attachments.length; i++) {
    const [owner = "", path = ""] = attachments[i]!;
    if (!owner.trim() && !path.trim()) continue;
    if (!path.trim() || path.includes("\\") || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === "." || !p)) fail("Lampiran", i + 1, "Berkas harus nama berkas atau path relatif yang aman");
    const target = norm(owner) === "laporan" ? parsed.attachments
      : parsed.cases.find((c) => qaCodeKey(c.code) === qaCodeKey(owner))?.attachments ?? parsed.findings.find((f) => qaCodeKey(f.code) === qaCodeKey(owner))?.attachments;
    if (!target) fail("Lampiran", i + 1, `Pemilik "${owner}" tidak ditemukan; gunakan Laporan atau Kode TC/F yang ada`);
    target.push(path.trim());
  }
  return parsed;
}
