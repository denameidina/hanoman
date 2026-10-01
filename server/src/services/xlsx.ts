import { xmlClean, xmlEsc, XML_HEAD } from "./ooxml";
import { readZip, writeZip, ZipError } from "./zip";

// Workspace QA · bagian 4 · XLSX tanpa dependensi (keputusan 2026-10-01): OOXML ditulis/dibaca sendiri di
// atas zip.ts. PENULIS: sel `inlineStr` (tanpa sharedStrings → lebih sederhana, Excel/Numbers/LibreOffice
// membukanya), header dibekukan & di-bold, kolom berlebar. PEMBACA: tahan berkas yang DISIMPAN Excel —
// sharedStrings (termasuk rich text & fonetik), `t="str"|"b"|"e"`, angka, sel lompat, dan sheet pertama
// menurut workbook.xml (bukan menurut nama berkas). Hanya SHEET PERTAMA dibaca.

export class XlsxError extends Error {}

const MAX_ROWS = 5000;
const MAX_COLS = 60;
const MAX_CELL = 32767;                          // batas Excel per sel

const esc = xmlEsc;
const clean = (s: string) => xmlClean(s).slice(0, MAX_CELL);
const colLetter = (i: number): string => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const colIndex = (letters: string): number => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const sheetName = (n: string, i: number) => (n.replace(/[[\]:*?/\\]/g, "_").trim().slice(0, 31) || `Sheet${i + 1}`);

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEAD = XML_HEAD;

export type XlsxSheet = { name: string; rows: readonly (readonly string[])[]; widths?: readonly number[] };

export function writeXlsx(sheets: readonly XlsxSheet[]): Buffer {
  const parts: { name: string; data: Buffer; deflate: boolean }[] = [];
  const add = (name: string, body: string) => parts.push({ name, data: Buffer.from(HEAD + body, "utf8"), deflate: true });

  add("[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    + "</Types>");
  add("_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add("xl/workbook.xml",
    `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets>`
    + sheets.map((s, i) => `<sheet name="${esc(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
    + "</sheets></workbook>");
  add("xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // xf 0 = baku · 1 = header (tebal, latar krem, rata atas) · 2 = isi (bungkus teks, rata atas)
  add("xl/styles.xml",
    `<styleSheet xmlns="${NS}">`
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF1E6CC"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');

  sheets.forEach((s, si) => {
    const cols = s.widths?.length
      ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const data = s.rows.map((r, ri) => {
      const cells = r.map((v, ci) => {
        const t = clean(v);
        return t === "" ? "" : `<c r="${colLetter(ci)}${ri + 1}" s="${ri === 0 ? 1 : 2}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
      }).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join("");
    add(`xl/worksheets/sheet${si + 1}.xml`,
      `<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData></worksheet>`);
  });
  return writeZip(parts);
}

// ── pembaca ──────────────────────────────────────────────────────────────────
function unesc(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e === "lt") return "<"; if (e === "gt") return ">"; if (e === "amp") return "&";
    if (e === "quot") return '"'; if (e === "apos") return "'";
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
}
const attrs = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = unesc(m[2]!);
  return out;
};
/** Gabungkan semua `<t>` (rich text = beberapa run), tanpa teks fonetik `<rPh>`. */
const textOf = (xmlFragment: string): string =>
  [...xmlFragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1]!)).join("");

/** `sheet` memilih lembar menurut NAMA (tak peka huruf/spasi tepi); tak ada/tak ditemukan → lembar pertama. */
export function readXlsx(buf: Buffer, opts: { sheet?: string } = {}): string[][] {
  let files: Map<string, Buffer>;
  try { files = readZip(buf, { maxEntries: 100, maxTotalBytes: 40 * 1024 * 1024 }); }
  catch (e) { if (e instanceof ZipError) throw new XlsxError(`bukan berkas XLSX yang valid: ${e.message}`); throw e; }
  const text = (name: string) => files.get(name)?.toString("utf8");

  // Sheet pertama menurut urutan di workbook.xml → relasinya → target. Fallback sheet1.xml.
  let target = "xl/worksheets/sheet1.xml";
  const wb = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const all = [...wb.matchAll(/<sheet\b([^>]*)>/g)].map((m) => attrs(m[1]!));
    const want = opts.sheet?.trim().toLowerCase();
    const chosen = (want ? all.find((a) => (a.name ?? "").trim().toLowerCase() === want) : undefined) ?? all[0];
    const rid = chosen?.["r:id"];
    for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
      const a = attrs(m[1]!);
      if (rid && a.Id === rid && a.Target) { target = a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target}`; break; }
    }
  }
  const sheet = text(target);
  if (sheet === undefined) throw new XlsxError("lembar (worksheet) tak ditemukan di XLSX");

  const shared: string[] = [];
  const sst = text("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));

  const rows: string[][] = [];
  let rowSeq = 0;
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    rowSeq++;
    const rn = Number(attrs(rm[1]!).r) || rowSeq;
    if (rn > MAX_ROWS) throw new XlsxError(`terlalu banyak baris (maks ${MAX_ROWS})`);
    const row: string[] = rows[rn - 1] ?? [];
    let colSeq = -1;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cm[1]!);
      const ref = /^([A-Z]+)\d+$/.exec(a.r ?? "");
      const ci = ref ? colIndex(ref[1]!) : colSeq + 1;
      colSeq = ci;
      if (ci >= MAX_COLS) throw new XlsxError(`terlalu banyak kolom (maks ${MAX_COLS})`);
      const inner = cm[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = "";
      if (a.t === "s") val = shared[Number(v)] ?? "";
      else if (a.t === "inlineStr") val = textOf(inner);
      else if (a.t === "str") val = v === undefined ? "" : unesc(v);
      else if (a.t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (a.t === "e") val = "";
      else val = v === undefined ? "" : unesc(v);
      while (row.length < ci) row.push("");
      row[ci] = val;
    }
    while (rows.length < rn - 1) rows.push([]);
    rows[rn - 1] = row;
  }
  return rows;
}
