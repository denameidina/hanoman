import {
  QA_CASE_STATUSES, QA_FINDING_STATUSES, QA_PRIORITIES, QA_REPORT_STATUSES, QA_SEVERITIES, QA_VERDICTS,
  qaStats,
  type QaAttachmentView, type QaCaseStatus, type QaFindingStatus, type QaPriority, type QaReportDetail,
  type QaReportStatus, type QaSeverity, type QaVerdict,
} from "./qa";

// Workspace QA · format Markdown laporan (template, ekspor, impor). Murni — nol I/O.
// Kontrak formatnya dikunci `qa-markdown.test.ts`; ubah keduanya bersama.

export class QaMarkdownError extends Error {
  constructor(message: string, readonly line: number) {
    super(`baris ${line}: ${message}`);
    this.name = "QaMarkdownError";
  }
}

export type QaParsedCase = {
  id: string | null; code: string; title: string; steps: string; expected: string; actual: string;
  status: QaCaseStatus; attachments: string[];
};
export type QaParsedFinding = {
  id: string | null; caseId: string | null; caseCode: string | null; code: string; title: string;
  severity: QaSeverity; priority: QaPriority; area: string; status: QaFindingStatus;
  steps: string[]; expected: string; actual: string; attachments: string[];
};
export type QaParsedReport = {
  reportId: string | null; title: string; buildVersion: string; tester: string; scope: string;
  status: QaReportStatus; verdict: QaVerdict | null; environment: Record<string, string>;
  summary: string; cases: QaParsedCase[]; findings: QaParsedFinding[]; attachments: string[];
};

// ── escape ──────────────────────────────────────────────────────────────────
// Teks bebas tak boleh meniru struktur (judul seksi, label **Repro**). Baris yang diawali `#`, `**`,
// atau `\` diberi awalan `\`; unesc adalah kebalikan persisnya.
const esc = (s: string) => s.replace(/^(#|\*\*|\\)/gm, "\\$1");
const unesc = (s: string) => s.replace(/^\\(#|\*\*|\\)/gm, "$1");
const block = (lines: string[]) => unesc(lines.join("\n").replace(/^\s*\n|\n\s*$/g, "").trim());
const oneLine = (s: string) => s.replace(/\s*\r?\n\s*/g, " ").trim();
const q = (s: string) => JSON.stringify(s);
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && i + 1 < line.length) { cur += line[++i]; continue; }
    if (c === "|") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.slice(1, -1).map((s) => s.trim().replace(/<br>/g, "\n"));
}

// ── render ──────────────────────────────────────────────────────────────────
export function renderQaMarkdown(d: QaReportDetail, paths: Record<string, string> = {}): string {
  const att = (type: string, id: string) => d.attachments.filter((a) => a.ownerType === type && a.ownerId === id);
  const link = (a: QaAttachmentView) => {
    const name = a.filename.replace(/[[\]]/g, "_");
    return `- ${a.mimeType.startsWith("image/") ? "!" : ""}[${name}](${paths[a.id] ?? `attachments/${a.filename}`})`;
  };
  const s = d.stats;
  const L: string[] = [
    "---", "hanoman-qa: 1", `reportId: ${q(d.id)}`, `project: ${q(d.projectId)}`, `code: ${q(d.code)}`,
    `title: ${q(oneLine(d.title))}`, `build: ${q(d.buildVersion)}`, `tester: ${q(d.tester)}`,
    `status: ${d.status}`, `verdict: ${d.verdict ?? "null"}`, `scope: ${q(d.scope)}`,
    `environment: ${JSON.stringify(d.environment)}`, "---", "",
    `# ${d.code} · ${oneLine(d.title)}`, "",
    `> Test case: ${s.cases.total} · pass ${s.cases.pass} · fail ${s.cases.fail} · blocked ${s.cases.blocked} · skipped ${s.cases.skipped} · todo ${s.cases.todo}`
      + ` · pass rate ${s.passRate === null ? "—" : `${Math.round(s.passRate * 100)}%`}`,
    `> Temuan: ${s.findings.total} (blocker ${s.findings.blocker} · critical ${s.findings.critical} · major ${s.findings.major} · minor ${s.findings.minor} · trivial ${s.findings.trivial}) · open ${s.findings.open}`,
    `> Keputusan: ${d.verdict ?? "belum diputuskan"}`, "",
    "## Ringkasan", "", esc(d.summary), "",
    "## Test case", "",
    "| Kode | Judul | Langkah | Diharapkan | Aktual | Status | Ref |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...d.cases.map((c) => `| ${c.code} | ${cell(c.title)} | ${cell(c.steps)} | ${cell(c.expected)} | ${cell(c.actual)} | ${c.status} | ${c.id} |`),
    "", "## Temuan", "",
  ];
  for (const f of d.findings) {
    const meta = JSON.stringify({ id: f.id, caseId: f.caseId, status: f.status }).replace(/>/g, "\\u003e");
    L.push(`### ${f.code} · [${f.severity}/${f.priority}] ${oneLine(f.title)}`, `<!-- hanoman:${meta} -->`, "");
    if (f.area) L.push(`**Area:** ${oneLine(f.area)}`, "");
    if (f.caseCode) L.push(`**Test case:** ${f.caseCode}`, "");
    L.push("**Repro**", "", ...(f.steps.length ? f.steps.map((t, i) => `${i + 1}. ${oneLine(t)}`) : []), "");
    L.push("**Expected**", "", esc(f.expected), "", "**Actual**", "", esc(f.actual), "");
    const a = att("finding", f.id);
    if (a.length) L.push("**Lampiran**", "", ...a.map(link), "");
  }
  L.push("## Lampiran", "", ...att("report", d.id).map(link), "");
  L.push("## Lampiran test case", "");
  for (const c of d.cases) {
    const a = att("case", c.id);
    if (a.length) L.push(`### ${c.code}`, "", ...a.map(link), "");
  }
  return L.join("\n").trimEnd() + "\n";   // tanpa pemadatan baris kosong: teks bebas harus kembali identik
}

// ── parse ───────────────────────────────────────────────────────────────────
const fmValue = (v: string): unknown => { try { return JSON.parse(v); } catch { return v.trim(); } };
const pathsIn = (lines: string[]) =>
  lines.flatMap((l) => { const m = /\]\((attachments\/[^)\s]+)\)/.exec(l); return m ? [m[1]!] : []; });
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], what: string, line: number): T => {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new QaMarkdownError(`${what} tak dikenal: "${String(v)}" (pilihan: ${allowed.join(", ")})`, line);
};

export function parseQaMarkdown(text: string): QaParsedReport {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") throw new QaMarkdownError("front-matter (---) tidak ditemukan di awal berkas", 1);

  const fm: Record<string, unknown> = {};
  const fmLine: Record<string, number> = {};
  let i = 1;
  for (; i < lines.length && lines[i]!.trim() !== "---"; i++) {
    if (lines[i]!.trim() === "") continue;
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!m) throw new QaMarkdownError(`front-matter tak valid: "${lines[i]}"`, i + 1);
    fm[m[1]!] = fmValue(m[2]!);
    fmLine[m[1]!] = i + 1;
  }
  if (i >= lines.length) throw new QaMarkdownError("front-matter tidak ditutup dengan ---", lines.length);
  if (fm["hanoman-qa"] !== 1) throw new QaMarkdownError("bukan laporan hanoman-qa versi 1 (butuh `hanoman-qa: 1`)", fmLine["hanoman-qa"] ?? 2);
  const fs = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : "");

  const status = fm.status === undefined ? "draft" : oneOf(fm.status, QA_REPORT_STATUSES, "status", fmLine.status!);
  const verdict = fm.verdict === undefined || fm.verdict === null || fm.verdict === "null"
    ? null : oneOf(fm.verdict, QA_VERDICTS, "verdict", fmLine.verdict!);
  if (!fs("title").trim()) throw new QaMarkdownError("title wajib diisi di front-matter", fmLine.title ?? 2);
  const environment: Record<string, string> = {};
  if (fm.environment && typeof fm.environment === "object" && !Array.isArray(fm.environment))
    for (const [k, v] of Object.entries(fm.environment)) if (typeof v === "string") environment[k] = v;

  // seksi `## …`; nomor baris absolut (1-based) untuk baris ke-idx sebuah seksi = start + idx + 2
  type Sec = { name: string; start: number; lines: string[] };
  const secs: Sec[] = [];
  let cur: Sec | null = null;
  for (let j = i + 1; j < lines.length; j++) {
    const m = /^## (.+?)\s*$/.exec(lines[j]!);
    if (m) { cur = { name: m[1]!.toLowerCase(), start: j, lines: [] }; secs.push(cur); continue; }
    cur?.lines.push(lines[j]!);
  }
  const sec = (name: string) => secs.find((s) => s.name === name);
  const abs = (s: Sec, idx: number) => s.start + idx + 2;

  const cases: QaParsedCase[] = [];
  const cs = sec("test case");
  if (cs) {
    const rows = cs.lines.map((l, idx) => ({ l, idx })).filter((x) => x.l.trimStart().startsWith("|")).slice(2);
    for (const { l, idx } of rows) {
      const c = splitRow(l.trim());
      if (c.length !== 7) throw new QaMarkdownError(`baris tabel test case harus 7 kolom, ditemukan ${c.length}`, abs(cs, idx));
      if (!c[1]) throw new QaMarkdownError("judul test case kosong", abs(cs, idx));
      cases.push({
        id: c[6] || null, code: c[0]!, title: c[1], steps: c[2]!, expected: c[3]!, actual: c[4]!,
        status: oneOf(c[5], QA_CASE_STATUSES, "status test case", abs(cs, idx)), attachments: [],
      });
    }
  }

  const findings: QaParsedFinding[] = [];
  const fs2 = sec("temuan");
  if (fs2) {
    const heads = fs2.lines.map((l, idx) => ({ l, idx })).filter((x) => x.l.startsWith("### "));
    heads.forEach((h, n) => {
      const hm = /^### (F-\d+) · \[(\w+)\/(P\d)\] (.+)$/.exec(h.l);
      if (!hm) throw new QaMarkdownError("judul temuan tak valid; format: `### F-01 · [major/P1] Judul`", abs(fs2, h.idx));
      const severity = oneOf(hm[2], QA_SEVERITIES, "severity", abs(fs2, h.idx));
      const priority = oneOf(hm[3], QA_PRIORITIES, "prioritas", abs(fs2, h.idx));
      const end = n + 1 < heads.length ? heads[n + 1]!.idx : fs2.lines.length;
      let meta: { id?: unknown; caseId?: unknown; status?: unknown } = {};
      let area = "";
      let caseCode: string | null = null;
      let part: "head" | "repro" | "expected" | "actual" | "att" = "head";
      const b = { repro: [] as { l: string; idx: number }[], expected: [] as string[], actual: [] as string[], att: [] as string[] };
      for (let k = h.idx + 1; k < end; k++) {
        const l = fs2.lines[k]!;
        const mm = /^<!-- hanoman:(.*) -->$/.exec(l);
        if (mm) {
          try { meta = JSON.parse(mm[1]!); } catch { throw new QaMarkdownError("metadata temuan (<!-- hanoman:… -->) bukan JSON valid", abs(fs2, k)); }
          continue;
        }
        const am = /^\*\*Area:\*\* ?(.*)$/.exec(l);
        if (am) { area = am[1]!.trim(); continue; }
        const tm = /^\*\*Test case:\*\* ?(TC-\d+)\s*$/.exec(l);
        if (tm) { caseCode = tm[1]!; continue; }
        if (l === "**Repro**") { part = "repro"; continue; }
        if (l === "**Expected**") { part = "expected"; continue; }
        if (l === "**Actual**") { part = "actual"; continue; }
        if (l === "**Lampiran**") { part = "att"; continue; }
        if (part === "repro") b.repro.push({ l, idx: k });
        else if (part === "expected") b.expected.push(l);
        else if (part === "actual") b.actual.push(l);
        else if (part === "att") b.att.push(l);
      }
      const steps = b.repro.filter((x) => x.l.trim() !== "").map((x) => {
        const sm = /^\d+\. (.+)$/.exec(x.l);
        if (!sm) throw new QaMarkdownError("langkah repro harus berformat `1. teks`", abs(fs2, x.idx));
        return sm[1]!.trim();
      });
      findings.push({
        id: typeof meta.id === "string" && meta.id ? meta.id : null,
        caseId: typeof meta.caseId === "string" && meta.caseId ? meta.caseId : null,
        caseCode, code: hm[1]!, title: hm[4]!.trim(), severity, priority, area,
        status: meta.status === undefined ? "open" : oneOf(meta.status, QA_FINDING_STATUSES, "status temuan", abs(fs2, h.idx)),
        steps, expected: block(b.expected), actual: block(b.actual), attachments: pathsIn(b.att),
      });
    });
  }

  const ls = sec("lampiran test case");
  if (ls) {
    let code: string | null = null;
    for (const l of ls.lines) {
      const hm = /^### (TC-\d+)\s*$/.exec(l);
      if (hm) { code = hm[1]!; continue; }
      const c = code ? cases.find((x) => x.code === code) : undefined;
      if (c) c.attachments.push(...pathsIn([l]));
    }
  }

  return {
    reportId: fs("reportId") || null, title: fs("title").trim(), buildVersion: fs("build"), tester: fs("tester"),
    scope: fs("scope"), status, verdict, environment, summary: block(sec("ringkasan")?.lines ?? []),
    cases, findings, attachments: pathsIn(sec("lampiran")?.lines ?? []),
  };
}

// ── template ────────────────────────────────────────────────────────────────
const GUIDE = [
  "> **Cara mengisi** — hapus baris contoh, isi sendiri, lalu unggah berkas ini lewat tombol *Impor* di Workspace QA.",
  "> - **Severity** (dampak teknis): blocker · critical · major · minor · trivial. **Prioritas** (urutan perbaikan): P0–P3. Keduanya tidak selalu sama.",
  "> - **Status test case**: todo · pass · fail · blocked · skipped. **Keputusan** (front-matter `verdict`): go · no-go · conditional.",
  "> - Satu temuan = satu masalah. Tulis **Repro** sebagai langkah bernomor yang bisa diulang orang lain, lalu **Expected** vs **Actual**.",
  "> - Lampiran: taruh berkas di folder `attachments/` (ZIP) dan tautkan dengan `![nama](attachments/nama.png)` di bawah **Lampiran** temuan.",
  "> - Biarkan kolom **Ref** dan baris `<!-- hanoman:… -->` apa adanya; kosongkan untuk entri baru.",
];

export function qaTemplateMarkdown(): string {
  const at = new Date(0).toISOString();
  const caseRow = { id: "", reportId: "", code: "TC-01", title: "Contoh: login dengan akun valid", steps: "1. Buka /login\n2. Isi email & kata sandi\n3. Klik Masuk", expected: "Masuk ke dashboard", actual: "Masuk ke dashboard", status: "pass" as const, order: 1, createdAt: at, updatedAt: at };
  const finding = { id: "", reportId: "", code: "F-01", caseId: null, caseCode: "TC-01", title: "Contoh: tombol Masuk tidak bereaksi di Safari", severity: "major" as const, priority: "P1" as const, area: "auth", steps: ["Buka /login di Safari 18", "Isi kredensial valid", "Klik Masuk"], expected: "Masuk ke dashboard", actual: "Tidak ada reaksi; konsol menampilkan TypeError", status: "open" as const, backlogId: null, createdAt: at, updatedAt: at };
  const d: QaReportDetail = {
    id: "", projectId: "", code: "QA-001", title: "Judul laporan — mis. Smoke test rilis 1.0", buildVersion: "1.0.0",
    environment: { os: "macOS 15", browser: "Chrome 130", device: "MacBook Pro", url: "https://staging.example.com", branch: "main" },
    scope: "Apa yang diuji dan apa yang sengaja tidak diuji.", tester: "Nama penguji",
    summary: "Ringkasan hasil dalam 2–3 kalimat: keputusan go/no-go dan alasannya.", status: "draft", verdict: null,
    createdAt: at, updatedAt: at, stats: qaStats([caseRow], [finding]), cases: [caseRow], findings: [finding], attachments: [],
  };
  return renderQaMarkdown(d).replace(/^(# .*\n)/m, `$1\n${GUIDE.join("\n")}\n`);
}
