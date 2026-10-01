import { QA_CASE_STATUSES, type QaCaseStatus } from "./qa";

// Workspace QA · bagian 4 · matriks test case sebagai tabel datar (CSV + XLSX). Murni — nol I/O; pembaca
// dan penulis XLSX hidup di server (butuh ZIP). Dipakai ekspor (casesToRows) dan impor (parseCaseRows).

export class QaTableError extends Error {
  constructor(message: string, readonly row: number) {
    super(`baris ${row}: ${message}`);
    this.name = "QaTableError";
  }
}

/** Header baku ekspor. `Ref` = id test case (kunci upsert saat impor); biarkan/kosongkan untuk baris baru. */
export const CASE_COLUMNS = ["Kode", "Judul", "Langkah", "Diharapkan", "Aktual", "Status", "Ref"] as const;

// ── CSV (RFC 4180) ───────────────────────────────────────────────────────────
const needsQuote = (s: string) => /[",\r\n]/.test(s) || s !== s.trim();

/** BOM UTF-8 + CRLF: Excel mengenali UTF-8 hanya dengan BOM, dan CRLF adalah baku RFC 4180. */
export function csvEncode(rows: readonly (readonly string[])[]): string {
  const cell = (s: string) => (needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

/** Pemisah dideteksi dari baris pertama di luar kutip: Excel berlokal Indonesia menyimpan CSV dengan `;`. */
function detectDelimiter(text: string): "," | ";" {
  let inQ = false, commas = 0, semis = 0;
  for (const c of text) {
    if (c === '"') inQ = !inQ;
    else if (!inQ && (c === "\n" || c === "\r")) break;
    else if (!inQ && c === ",") commas++;
    else if (!inQ && c === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

export function csvDecode(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const d = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  let started = false;     // ada isi (atau pemisah) di baris ini — membedakan baris kosong dari akhir berkas
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
      continue;
    }
    if (c === '"' && cur === "") { inQ = true; started = true; continue; }
    if (c === d) { row.push(cur); cur = ""; started = true; continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (started || cur !== "") { row.push(cur); rows.push(row); } else rows.push([""]);
      row = []; cur = ""; started = false;
      continue;
    }
    cur += c; started = true;
  }
  if (inQ) throw new QaTableError("kutip (\") tak ditutup", rows.length + 1);
  if (started || cur !== "") { row.push(cur); rows.push(row); }
  return rows;
}

// ── matriks test case ────────────────────────────────────────────────────────
export function casesToRows(
  cases: readonly { id: string; code: string; title: string; steps: string; expected: string; actual: string; status: string }[],
): string[][] {
  return [[...CASE_COLUMNS], ...cases.map((c) => [c.code, c.title, c.steps, c.expected, c.actual, c.status, c.id])];
}

export type QaCaseRow = {
  /** Nomor baris di lembar (1-based) — untuk pesan galat. */
  row: number;
  ref: string | null; code: string; title: string;
  /** `undefined` = kolomnya TAK ADA di lembar (biarkan nilai lama); "" = kolom ada, sel kosong (kosongkan). */
  steps: string | undefined; expected: string | undefined; actual: string | undefined;
  /** `null` = sel kosong → pemanggil membiarkan status yang ada (baris baru: `todo`). */
  status: QaCaseStatus | null;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const HEADER_ALIASES: Record<string, keyof Omit<QaCaseRow, "row">> = {
  kode: "code", code: "code", no: "code",
  judul: "title", title: "title", judultestcase: "title", namatestcase: "title", testcase: "title",
  langkah: "steps", steps: "steps", langkahuji: "steps", langkahlangkah: "steps",
  diharapkan: "expected", expected: "expected", hasildiharapkan: "expected", hasilyangdiharapkan: "expected", hasilharapan: "expected",
  aktual: "actual", actual: "actual", hasilaktual: "actual",
  status: "status",
  ref: "ref", id: "ref", referensi: "ref",
};
const STATUS_ALIASES: Record<string, QaCaseStatus> = {
  pass: "pass", passed: "pass", lulus: "pass", ok: "pass", berhasil: "pass",
  fail: "fail", failed: "fail", gagal: "fail",
  blocked: "blocked", block: "blocked", terblokir: "blocked", terhambat: "blocked",
  skipped: "skipped", skip: "skipped", dilewati: "skipped", lewati: "skipped",
  todo: "todo", belum: "todo", pending: "todo",
};

/**
 * Baca baris lembar → baris test case. Header (= baris yang memuat kolom `Judul`) dicari di 10 baris pertama (judul laporan di atas tabel
 * tak mengganggu), kolom dikenali lewat alias tak peka huruf/spasi, urutan kolom bebas.
 */
export function parseCaseRows(rows: readonly (readonly string[])[]): QaCaseRow[] {
  let h = -1;
  let col: Partial<Record<keyof Omit<QaCaseRow, "row">, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 10) && h < 0; i++) {
    const m: typeof col = {};
    rows[i]!.forEach((c, j) => { const k = HEADER_ALIASES[norm(c)]; if (k && m[k] === undefined) m[k] = j; });
    if (m.title !== undefined) { h = i; col = m; }
  }
  if (h < 0) throw new QaTableError("header tak ditemukan — butuh kolom `Judul` (kolom lain opsional: Status, Aktual, Ref, …)", 1);

  const out: QaCaseRow[] = [];
  const at = (r: readonly string[], k: keyof typeof col) => (col[k] === undefined ? "" : (r[col[k]!] ?? "").trim());
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const rowNo = i + 1;
    const cells = {
      ref: at(r, "ref"), code: at(r, "code"), title: at(r, "title"),
      steps: col.steps === undefined ? undefined : (r[col.steps] ?? ""), expected: col.expected === undefined ? undefined : (r[col.expected] ?? ""),
      actual: col.actual === undefined ? undefined : (r[col.actual] ?? ""), status: at(r, "status"),
    };
    if (Object.values(cells).every((v) => (v ?? "").trim() === "")) continue;   // baris kosong
    if (!cells.title && !cells.ref) throw new QaTableError("judul wajib diisi untuk baris baru (tanpa Ref)", rowNo);
    let status: QaCaseStatus | null = null;
    if (cells.status) {
      status = STATUS_ALIASES[norm(cells.status)] ?? null;
      if (!status) throw new QaTableError(`status tak dikenal: "${cells.status}" (pilihan: ${QA_CASE_STATUSES.join(", ")})`, rowNo);
    }
    out.push({
      row: rowNo, ref: cells.ref || null, code: cells.code, title: cells.title,
      steps: cells.steps, expected: cells.expected, actual: cells.actual, status,
    });
  }
  return out;
}
