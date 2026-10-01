import PDFDocument from "pdfkit";
import type { QaAttachmentView, QaReportDetail } from "@hanoman/shared";
import { toWinAnsi } from "./doc-export";
import type { DocxImage } from "./qa-docx";

// Workspace QA · bagian 4 · laporan PDF (pdfkit). Berbeda dari doc-export.ts (Markdown → PDF, gambar hanya
// jadi teks `[gambar: …]`): di sini screenshot BENAR-BENAR tertanam, karena itu inti laporan QA.
// Font standar-14 hanya WinAnsi → semua teks lewat `toWinAnsi` (aturan yang sama dengan doc-export).
// pdfkit tak punya API tabel: tabel digambar manual (tinggi baris dari `heightOfString`).

const INK = "#2B2620", MUTED = "#6B6558", BRASS = "#8A6A2F", RULE = "#BFB8A6", HEAD_FILL = "#F4EEDF";
const STATUS_FILL: Record<string, string> = { pass: "#E3F1E3", fail: "#F8D7D2", blocked: "#FCEBC8", skipped: "#DCE8F5", todo: "#EEEEEE" };
const M = 50, PAGE_W = 595.28, PAGE_H = 841.89, CONTENT_W = PAGE_W - 2 * M, BOTTOM = PAGE_H - M;
const humanSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const day = (iso: string) => iso.slice(0, 16).replace("T", " ");
const T = (s: string) => toWinAnsi(s ?? "");

export function writeQaPdf(d: QaReportDetail, images: ReadonlyMap<string, DocxImage>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: T(`${d.code} ${d.title}`), Author: T(d.tester || "hanoman"), Subject: "Laporan QA" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const room = (h: number) => { if (doc.y + h > BOTTOM) doc.addPage(); };
    const font = (bold = false, italic = false) => doc.font(bold ? "Helvetica-Bold" : italic ? "Helvetica-Oblique" : "Helvetica");
    const h1 = (s: string) => { room(50); doc.moveDown(0.6); font(true).fontSize(15).fillColor(BRASS).text(T(s), M, doc.y, { width: CONTENT_W }); doc.moveDown(0.3); };
    const h3 = (s: string) => { room(50); doc.moveDown(0.5); font(true).fontSize(11.5).fillColor(INK).text(T(s), M, doc.y, { width: CONTENT_W }); };
    const p = (s: string, o: { bold?: boolean; italic?: boolean; color?: string; size?: number } = {}) => {
      font(o.bold, o.italic).fontSize(o.size ?? 10).fillColor(o.color ?? INK);
      room(doc.heightOfString(T(s), { width: CONTENT_W }) + 4);
      doc.text(T(s), M, doc.y, { width: CONTENT_W });
    };

    function table(cols: { label: string; w: number }[], rows: { cells: string[]; fills?: (string | undefined)[] }[]) {
      const pad = 4;
      const drawRow = (cells: string[], fills: (string | undefined)[] | undefined, header: boolean) => {
        font(header).fontSize(8.5);
        const h = Math.max(...cells.map((c, i) => doc.heightOfString(T(c) || " ", { width: cols[i]!.w - 2 * pad }))) + 2 * pad;
        if (doc.y + h > BOTTOM) { doc.addPage(); if (!header) drawRow(cols.map((c) => c.label), undefined, true); }
        const y = doc.y;
        let x = M;
        cells.forEach((c, i) => {
          const fill = header ? HEAD_FILL : fills?.[i];
          doc.rect(x, y, cols[i]!.w, h).lineWidth(0.5).strokeColor(RULE);
          if (fill) doc.fillAndStroke(fill, RULE); else doc.stroke();
          font(header).fontSize(8.5).fillColor(INK).text(T(c), x + pad, y + pad, { width: cols[i]!.w - 2 * pad });
          x += cols[i]!.w;
        });
        doc.y = y + h;
      };
      drawRow(cols.map((c) => c.label), undefined, true);
      for (const r of rows) drawRow(r.cells, r.fills, false);
      doc.moveDown(0.6);
    }

    function image(a: QaAttachmentView): boolean {
      const img = images.get(a.id);
      if (!img) return false;
      const k = Math.min(1, CONTENT_W / img.w, 360 / img.h);          // skala turun saja, rasio terjaga
      const w = img.w * k, h = img.h * k;
      room(h + 24);
      try { doc.image(img.data, M, doc.y, { width: w, height: h }); } catch { return false; }
      doc.y += h + 3;
      p(`${a.filename} · ${humanSize(a.size)}`, { color: MUTED, size: 8 });
      return true;
    }
    const attachments = (list: QaAttachmentView[]) => {
      for (const a of list) if (!image(a)) p(`• ${a.filename} (${a.mimeType}, ${humanSize(a.size)})`, { size: 9 });
    };
    const att = (type: string, id: string) => d.attachments.filter((a) => a.ownerType === type && a.ownerId === id);

    // ── isi ────────────────────────────────────────────────────────────────
    const s = d.stats;
    font(true).fontSize(20).fillColor(INK).text(T(`${d.code} · ${d.title}`), M, M, { width: CONTENT_W });
    doc.moveDown(0.5);
    table([{ label: "Informasi", w: 110 }, { label: "", w: CONTENT_W - 110 }], [
      ["Build / versi", d.buildVersion || "-"], ["Penguji", d.tester || "-"], ["Status", d.status],
      ["Keputusan", d.verdict ?? "belum diputuskan"], ["Cakupan", d.scope || "-"],
      ["Lingkungan", Object.entries(d.environment).map(([k, v]) => `${k}: ${v}`).join("\n") || "-"],
      ["Dibuat / diubah", `${day(d.createdAt)} / ${day(d.updatedAt)}`],
    ].map(([k, v]) => ({ cells: [k!, v!] })));
    p(`Test case: ${s.cases.total} · pass ${s.cases.pass} · fail ${s.cases.fail} · blocked ${s.cases.blocked} · skipped ${s.cases.skipped} · todo ${s.cases.todo} · pass rate ${s.passRate === null ? "-" : `${Math.round(s.passRate * 100)}%`}`);
    p(`Temuan: ${s.findings.total} (blocker ${s.findings.blocker} · critical ${s.findings.critical} · major ${s.findings.major} · minor ${s.findings.minor} · trivial ${s.findings.trivial}) · open ${s.findings.open}`);

    h1("Ringkasan");
    p(d.summary || "-");

    h1("Test case");
    if (d.cases.length === 0) p("Belum ada test case.", { italic: true });
    else table(
      [{ label: "Kode", w: 42 }, { label: "Judul", w: 100 }, { label: "Langkah", w: 120 }, { label: "Diharapkan", w: 85 }, { label: "Aktual", w: 85 }, { label: "Status", w: CONTENT_W - 432 }],
      d.cases.map((c) => ({ cells: [c.code, c.title, c.steps, c.expected, c.actual, c.status], fills: [undefined, undefined, undefined, undefined, undefined, STATUS_FILL[c.status]] })),
    );

    h1("Temuan");
    if (d.findings.length === 0) p("Tidak ada temuan.", { italic: true });
    for (const f of d.findings) {
      h3(`${f.code} · [${f.severity}/${f.priority}] ${f.title}`);
      p([f.area && `Area: ${f.area}`, f.caseCode && `Test case: ${f.caseCode}`, f.backlogId && `Backlog: ${f.backlogId}${f.spec ? ` (${f.spec.stage})` : ""}`, `Status: ${f.status}`].filter(Boolean).join(" · "), { color: MUTED, size: 9 });
      p("Langkah reproduksi", { bold: true });
      if (f.steps.length) f.steps.forEach((t, i) => p(`${i + 1}. ${t}`)); else p("-");
      p("Expected", { bold: true }); p(f.expected || "-");
      p("Actual", { bold: true }); p(f.actual || "-");
      attachments(att("finding", f.id));
    }

    const reportAtt = att("report", d.id);
    if (reportAtt.length) { h1("Lampiran"); attachments(reportAtt); }
    const caseAtt = d.cases.filter((c) => att("case", c.id).length);
    if (caseAtt.length) { h1("Lampiran test case"); for (const c of caseAtt) { h3(`${c.code} · ${c.title}`); attachments(att("case", c.id)); } }

    // nomor halaman: margin bawah dinolkan sementara supaya teks di zona margin tak memicu halaman baru
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const prev = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      font().fontSize(8).fillColor(MUTED).text(T(`${d.code} · halaman ${i + 1} dari ${range.count}`), M, PAGE_H - 32, { width: CONTENT_W, align: "center", lineBreak: false });
      doc.page.margins.bottom = prev;
    }
    doc.end();
  });
}
