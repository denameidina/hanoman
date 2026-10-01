import { type QaAttachmentView, type QaReportDetail } from "@hanoman/shared";
import { xmlClean, xmlEsc, XML_HEAD } from "./ooxml";
import { writeZip } from "./zip";

// Workspace QA · bagian 4 · laporan DOCX tanpa dependensi (keputusan 2026-10-01): OOXML ditulis sendiri.
// Penomoran langkah repro MANUAL ("1. …") agar tak butuh numbering.xml; gambar tertanam sebagai drawing
// inline dibatasi lebar halaman. Byte gambar sudah disiapkan pemanggil (png/jpeg; webp dikonversi di
// qa-export-images.ts) — penulis ini murni dan sinkron.

export type DocxImage = { data: Buffer; ext: "png" | "jpeg"; w: number; h: number };

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAX_W_EMU = 5486400;        // 6 inci — lebar teks halaman A4 berbatas 1 inci kiri-kanan ≈ 6,27 inci
const MAX_H_EMU = 7315200;        // 8 inci
const EMU_PER_PX = 9525;

const STATUS_FILL: Record<string, string> = { pass: "E3F1E3", fail: "F8D7D2", blocked: "FCEBC8", skipped: "DCE8F5", todo: "EEEEEE" };
const humanSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const day = (iso: string) => iso.slice(0, 16).replace("T", " ");

type RunOpts = { bold?: boolean; italic?: boolean; color?: string; size?: number };
const run = (text: string, o: RunOpts = {}) => {
  const rpr = (o.bold ? "<w:b/>" : "") + (o.italic ? "<w:i/>" : "") + (o.color ? `<w:color w:val="${o.color}"/>` : "") + (o.size ? `<w:sz w:val="${o.size}"/>` : "");
  // baris baru → <w:br/>, supaya teks berbaris (langkah, expected/actual) tak menyatu jadi satu baris
  return xmlClean(text).split(/\r?\n/).map((line, i) =>
    `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r>`).join("");
};
const para = (inner: string, style?: string, extra = "") =>
  `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : ""}${inner}</w:p>`;
const text = (t: string, o: RunOpts & { style?: string } = {}) => para(run(t, o), o.style);

type Cell = { w: number; inner: string; fill?: string };
const cell = (c: Cell) =>
  `<w:tc><w:tcPr><w:tcW w:w="${c.w}" w:type="dxa"/>${c.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>` : ""}</w:tcPr>${c.inner || para("")}</w:tc>`;
const table = (widths: number[], rows: { cells: Cell[]; header?: boolean }[]) =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>`
  + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`
  + rows.map((r) => `<w:tr>${r.header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${r.cells.map(cell).join("")}</w:tr>`).join("")
  + "</w:tbl>" + para("");

export function writeDocx(d: QaReportDetail, images: ReadonlyMap<string, DocxImage>): Buffer {
  const media: { name: string; data: Buffer }[] = [];
  const rels: string[] = [];
  let drawingId = 0;

  const imageRun = (a: QaAttachmentView): string => {
    const img = images.get(a.id);
    if (!img) return "";
    const n = media.length + 1;
    media.push({ name: `word/media/image${n}.${img.ext === "jpeg" ? "jpeg" : "png"}`, data: img.data });
    rels.push(`<Relationship Id="rIdImg${n}" Type="${R}/image" Target="media/image${n}.${img.ext === "jpeg" ? "jpeg" : "png"}"/>`);
    let cx = img.w * EMU_PER_PX, cy = img.h * EMU_PER_PX;
    const k = Math.min(1, MAX_W_EMU / cx, MAX_H_EMU / cy);                  // skala turun saja, rasio terjaga
    cx = Math.max(1, Math.round(cx * k)); cy = Math.max(1, Math.round(cy * k));
    const id = ++drawingId;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
      + `<wp:docPr id="${id}" name="Gambar ${id}" descr="${xmlEsc(xmlClean(a.filename))}"/>`
      + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
      + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${xmlEsc(xmlClean(a.filename))}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
      + "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
  };
  /** Gambar tertanam + keterangan kecil; berkas lain cukup dicantumkan (bukan gambar → tak bisa ditanam). */
  const attachmentsBlock = (list: QaAttachmentView[]): string => list.map((a) =>
    images.has(a.id)
      ? para(imageRun(a), undefined, '<w:keepNext/>') + text(`${a.filename} · ${humanSize(a.size)}`, { size: 18, color: "6B6558" })
      : text(`• ${a.filename} (${a.mimeType}, ${humanSize(a.size)})`, { size: 20 })).join("");
  const att = (type: string, id: string) => d.attachments.filter((a) => a.ownerType === type && a.ownerId === id);

  const s = d.stats;
  const body: string[] = [];
  body.push(text(`${d.code} · ${d.title}`, { style: "Title" }));
  const meta: [string, string][] = [
    ["Build / versi", d.buildVersion || "—"], ["Penguji", d.tester || "—"],
    ["Status", d.status], ["Keputusan", d.verdict ?? "belum diputuskan"],
    ["Cakupan", d.scope || "—"],
    ["Lingkungan", Object.entries(d.environment).map(([k, v]) => `${k}: ${v}`).join("\n") || "—"],
    ["Dibuat / diubah", `${day(d.createdAt)} / ${day(d.updatedAt)}`],
  ];
  body.push(table([2000, 7026], meta.map(([k, v]) => ({ cells: [{ w: 2000, inner: text(k, { bold: true }), fill: "F4EEDF" }, { w: 7026, inner: text(v) }] }))));
  body.push(text(`Test case: ${s.cases.total} · pass ${s.cases.pass} · fail ${s.cases.fail} · blocked ${s.cases.blocked} · skipped ${s.cases.skipped} · todo ${s.cases.todo} · pass rate ${s.passRate === null ? "—" : `${Math.round(s.passRate * 100)}%`}`));
  body.push(text(`Temuan: ${s.findings.total} (blocker ${s.findings.blocker} · critical ${s.findings.critical} · major ${s.findings.major} · minor ${s.findings.minor} · trivial ${s.findings.trivial}) · open ${s.findings.open}`));

  body.push(text("Ringkasan", { style: "Heading1" }), text(d.summary || "—"));

  body.push(text("Test case", { style: "Heading1" }));
  if (d.cases.length === 0) body.push(text("Belum ada test case.", { italic: true }));
  else {
    const cw = [800, 1900, 2000, 1600, 1600, 1126];
    const head = ["Kode", "Judul", "Langkah", "Diharapkan", "Aktual", "Status"];
    body.push(table(cw, [
      { header: true, cells: head.map((h, i) => ({ w: cw[i]!, inner: text(h, { bold: true }), fill: "F4EEDF" })) },
      ...d.cases.map((c) => ({ cells: [c.code, c.title, c.steps, c.expected, c.actual, c.status].map((v, i) => ({
        w: cw[i]!, inner: text(v, { size: 20 }), fill: i === 5 ? STATUS_FILL[c.status] : undefined })) })),
    ]));
  }

  body.push(text("Temuan", { style: "Heading1" }));
  if (d.findings.length === 0) body.push(text("Tidak ada temuan.", { italic: true }));
  for (const f of d.findings) {
    body.push(text(`${f.code} · [${f.severity}/${f.priority}] ${f.title}`, { style: "Heading3" }));
    const bits = [f.area && `Area: ${f.area}`, f.caseCode && `Test case: ${f.caseCode}`, f.backlogId && `Backlog: ${f.backlogId}${f.spec ? ` (${f.spec.stage})` : ""}`, `Status: ${f.status}`].filter(Boolean).join(" · ");
    body.push(text(bits, { size: 20, color: "6B6558" }));
    body.push(text("Langkah reproduksi", { bold: true }));
    body.push(...(f.steps.length ? f.steps.map((t, i) => text(`${i + 1}. ${t}`)) : [text("—")]));
    body.push(text("Expected", { bold: true }), text(f.expected || "—"));
    body.push(text("Actual", { bold: true }), text(f.actual || "—"));
    body.push(attachmentsBlock(att("finding", f.id)));
  }

  const reportAtt = att("report", d.id);
  if (reportAtt.length) body.push(text("Lampiran", { style: "Heading1" }), attachmentsBlock(reportAtt));
  const caseAtt = d.cases.filter((c) => att("case", c.id).length);
  if (caseAtt.length) {
    body.push(text("Lampiran test case", { style: "Heading1" }));
    for (const c of caseAtt) body.push(text(`${c.code} · ${c.title}`, { style: "Heading3" }), attachmentsBlock(att("case", c.id)));
  }

  const document = XML_HEAD
    + `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" `
    + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const styles = XML_HEAD + `<w:styles xmlns:w="${W}">`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/><w:color w:val="2B2620"/></w:rPr></w:style>'
    + ["1:32:360", "2:28:240", "3:24:200"].map((h) => { const [n, sz, before] = h.split(":");
      return `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="100"/><w:outlineLvl w:val="${Number(n) - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:color w:val="8A6A2F"/></w:rPr></w:style>`; }).join("")
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>'
    + ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFB8A6"/>`).join("")
    + '</w:tblBorders></w:tblPr></w:style></w:styles>';

  const types = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + (media.some((m) => m.name.endsWith(".png")) ? '<Default Extension="png" ContentType="image/png"/>' : "")
    + (media.some((m) => m.name.endsWith(".jpeg")) ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : "")
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';

  const text8 = (s: string) => Buffer.from(s, "utf8");
  return writeZip([
    { name: "[Content_Types].xml", data: text8(types), deflate: true },
    { name: "_rels/.rels", data: text8(XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'), deflate: true },
    { name: "word/document.xml", data: text8(document), deflate: true },
    { name: "word/_rels/document.xml.rels", data: text8(XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/>${rels.join("")}</Relationships>`), deflate: true },
    { name: "word/styles.xml", data: text8(styles), deflate: true },
    ...media.map((m) => ({ name: m.name, data: m.data })),   // gambar sudah terkompresi: stored
  ]);
}
