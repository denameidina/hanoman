import { QaTableError, csvDecode, parseCaseRows, type QaCasesImportResult } from "@hanoman/shared";
import { prisma } from "../db";
import { QaImportError } from "./qa-transfer";
import { notifySynced } from "./sync-notify";
import { XlsxError, readXlsx } from "./xlsx";

// Workspace QA · bagian 4 · impor matriks test case dari XLSX/CSV (diisi di spreadsheet lalu diunggah).
// UPSERT berbasis kolom `Ref` (= id): baris ber-Ref yang ada di laporan ini → diperbarui; selain itu → test
// case baru. Kolom yang TAK ADA di lembar dibiarkan; sel kosong pada kolom yang ADA mengosongkan nilai
// (round-trip jujur). Semua-atau-tidak-sama-sekali: satu baris bermasalah menggagalkan seluruh impor
// (transaksi) supaya tak ada laporan separuh-terimpor.

const isZip = (b: Buffer) => b.length >= 4 && b.readUInt32LE(0) === 0x04034b50;

export async function importCases(projectId: string, reportId: string, file: { name: string; buf: Buffer }): Promise<QaCasesImportResult> {
  const report = await prisma.qaReport.findFirst({ where: { id: reportId, projectId }, select: { id: true, status: true } });
  if (!report) throw new QaImportError(404, "laporan tak ditemukan");
  if (report.status === "closed") throw new QaImportError(409, "laporan sudah closed — buka kembali sebelum mengimpor");

  let rows: string[][];
  try {
    rows = isZip(file.buf) ? readXlsx(file.buf, { sheet: "Test case" }) : csvDecode(file.buf.toString("utf8"));
  } catch (e) {
    if (e instanceof XlsxError || e instanceof QaTableError) throw new QaImportError(400, e.message);
    throw e;
  }
  let parsed;
  try { parsed = parseCaseRows(rows); }
  catch (e) { if (e instanceof QaTableError) throw new QaImportError(400, e.message); throw e; }

  const base = Date.now();
  const changed: string[] = [];     // test case yang berubah/dibuat — diterbitkan ke peer SESUDAH transaksi
  const result = await prisma.$transaction(async (tx) => {
    const existing = new Map((await tx.qaCase.findMany({ where: { reportId } })).map((c) => [c.id, c]));
    let maxOrder = Math.max(0, ...[...existing.values()].map((c) => c.order));
    const out: QaCasesImportResult = { updated: 0, created: 0, unchanged: 0 };

    for (const [i, r] of parsed.entries()) {
      const cur = r.ref ? existing.get(r.ref) : undefined;
      if (cur) {
        const next = {
          title: r.title || cur.title, steps: r.steps ?? cur.steps, expected: r.expected ?? cur.expected,
          actual: r.actual ?? cur.actual, status: r.status ?? cur.status,
        };
        if (next.title === cur.title && next.steps === cur.steps && next.expected === cur.expected
          && next.actual === cur.actual && next.status === cur.status) { out.unchanged++; continue; }
        await tx.qaCase.update({ where: { id: cur.id }, data: next });
        changed.push(cur.id);
        out.updated++;
        continue;
      }
      // Ref asing (mis. dari laporan lain) diperlakukan sebagai baris baru — tapi tetap butuh judul.
      if (!r.title) throw new QaImportError(400, `baris ${r.row}: judul wajib diisi (Ref "${r.ref}" tak dikenal di laporan ini)`);
      const made = await tx.qaCase.create({ data: {
        reportId, title: r.title, steps: r.steps ?? "", expected: r.expected ?? "", actual: r.actual ?? "",
        status: r.status ?? "todo", order: ++maxOrder, createdAt: new Date(base + i),   // +i ms: nomor TC-nn = urutan di lembar
      } });
      changed.push(made.id);
      out.created++;
    }
    if (out.updated + out.created) await tx.qaReport.update({ where: { id: reportId }, data: { updatedAt: new Date() } });
    return out;
  });
  if (changed.length) {
    await notifySynced("qaReport", reportId);
    for (const id of changed) await notifySynced("qaCase", id);
  }
  return result;
}
