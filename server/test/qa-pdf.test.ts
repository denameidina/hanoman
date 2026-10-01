import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { qaStats, type QaReportDetail } from "@hanoman/shared";
import { prepareExportImages } from "../src/services/qa-export-images";
import { writeQaPdf } from "../src/services/qa-pdf";

const at = "2026-10-01T10:30:00.000Z";
const base = { createdAt: at, updatedAt: at };
const mkFinding = (i: number) => ({
  ...base, id: `f${i}`, reportId: "r1", code: `F-${String(i).padStart(2, "0")}`, caseId: null, caseCode: null,
  title: `Temuan ke-${i} ✓ → "aneh" 😀`, severity: "major" as const, priority: "P1" as const, area: "checkout",
  steps: ["buka", "klik"], expected: "ok", actual: "diam\nbaris dua ".repeat(6), status: "open" as const, backlogId: null, spec: null,
});
const att = (id: string, ownerId: string, filename: string, mimeType: string) =>
  ({ id, reportId: "r1", ownerType: "finding" as const, ownerId, filename, mimeType, size: 4096, sha256: "x", syncState: "local-only" as const, createdAt: at });
const build = (findings: ReturnType<typeof mkFinding>[], attachments: QaReportDetail["attachments"] = []): QaReportDetail => ({
  ...base, id: "r1", projectId: "p1", code: "QA-007", title: "Smoke ✓ checkout", buildVersion: "0.9.12", environment: { os: "macOS" },
  scope: "checkout", tester: "Dena", summary: "Ringkasan.", status: "submitted", verdict: "go",
  stats: qaStats([], findings), cases: [{ ...base, id: "c1", reportId: "r1", code: "TC-01", title: "Login", steps: "1. buka", expected: "masuk", actual: "masuk", status: "pass", order: 1 }],
  findings, attachments,
});
const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;

describe("prepareExportImages", () => {
  it("png/jpeg dipakai apa adanya, webp → png, dimensi terbaca; non-gambar & gambar rusak dilewati", async () => {
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#c87a3c" } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 30, height: 30, channels: 3, background: "#3c7ac8" } }).jpeg().toBuffer();
    const webp = await sharp({ create: { width: 10, height: 50, channels: 3, background: "#7ac83c" } }).webp().toBuffer();
    const d = build([], [att("p", "f1", "a.png", "image/png"), att("j", "f1", "b.jpg", "image/jpeg"), att("w", "f1", "c.webp", "image/webp"), att("x", "f1", "bad.png", "image/png"), att("t", "f1", "n.txt", "text/plain")]);
    const bytes: Record<string, Buffer> = { p: png, j: jpg, w: webp, x: Buffer.from("bukan gambar"), t: Buffer.from("x") };
    const out = await prepareExportImages(d, async (a) => bytes[a.id] ?? null);
    expect([...out.keys()]).toEqual(["p", "j", "w"]);
    expect(out.get("p")).toMatchObject({ ext: "png", w: 40, h: 20 });
    expect(out.get("j")).toMatchObject({ ext: "jpeg", w: 30, h: 30 });
    expect(out.get("w")).toMatchObject({ ext: "png", w: 10, h: 50 });
    expect(out.get("w")!.data.subarray(1, 4).toString()).toBe("PNG");        // webp sungguh dikonversi
  });
  it("loader yang mengembalikan null (byte tak ada) melewati lampiran itu", async () => {
    const d = build([], [att("p", "f1", "a.png", "image/png")]);
    expect((await prepareExportImages(d, async () => null)).size).toBe(0);
  });
});

describe("writeQaPdf", () => {
  it("PDF sah: header %PDF, trailer %%EOF; emoji/panah/centang tak membuat crash", async () => {
    const pdf = await writeQaPdf(build([mkFinding(1)]), new Map());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-8).toString()).toContain("%%EOF");
    expect(pages(pdf)).toBeGreaterThanOrEqual(1);
  });
  it("banyak temuan → beberapa halaman (tabel/temuan memecah halaman, bukan meluap)", async () => {
    const many = Array.from({ length: 40 }, (_, i) => mkFinding(i + 1));
    expect(pages(await writeQaPdf(build(many), new Map()))).toBeGreaterThan(2);
  });
  it("gambar tertanam: ukuran berkas membesar dan ada objek XObject Image", async () => {
    const png = await sharp({ create: { width: 640, height: 400, channels: 3, background: "#c87a3c" } }).png().toBuffer();
    const d = build([mkFinding(1)], [att("a", "f1", "layar.png", "image/png"), att("b", "f1", "log.txt", "text/plain")]);
    const withImg = await writeQaPdf(d, new Map([["a", { data: png, ext: "png" as const, w: 640, h: 400 }]]));
    expect(withImg.toString("latin1")).toMatch(/\/Subtype \/Image/);
    expect((await writeQaPdf(d, new Map())).toString("latin1")).not.toMatch(/\/Subtype \/Image/);
  });
  it("tanpa test case/temuan tetap valid", async () => {
    const pdf = await writeQaPdf({ ...build([]), cases: [], stats: qaStats([], []) }, new Map());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
