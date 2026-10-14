import { describe, expect, it } from "vitest";
import {
  CRON_REPORT_KEEP, CRON_REPORT_MAX_BYTES, cronReportFilename, cronReportSlug, truncateCronReport,
} from "./cron-report";

describe("cronReportSlug", () => {
  it("huruf kecil, spasi/simbol jadi satu '-'", () => {
    expect(cronReportSlug('Cek biaya Harian Cloudflare (ERP)')).toBe("cek-biaya-harian-cloudflare-erp");
  });
  it("nama kosong/simbol saja → 'cron'", () => {
    expect(cronReportSlug("   ")).toBe("cron");
    expect(cronReportSlug("???")).toBe("cron");
  });
  it("dibatasi 48 karakter tanpa '-' di ujung", () => {
    const s = cronReportSlug("a".repeat(47) + " b c");
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("cronReportFilename", () => {
  it("<runDate>-<slug>-<runId>.md", () => {
    expect(cronReportFilename({ runDate: "2026-10-14", cronName: "Cek biaya Harian Cloudflare", id: "cmabc" }))
      .toBe("2026-10-14-cek-biaya-harian-cloudflare-cmabc.md");
  });
});

describe("truncateCronReport", () => {
  it("di bawah batas → utuh", () => {
    expect(truncateCronReport("halo")).toEqual({ body: "halo", bytes: 4, truncated: false });
  });
  it("melebihi batas → dipotong ≤ batas byte, berpenanda, tak memecah karakter multibyte", () => {
    const r = truncateCronReport("é".repeat(CRON_REPORT_MAX_BYTES));
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(Buffer.byteLength(r.body, "utf8"));
    expect(r.bytes).toBeLessThanOrEqual(CRON_REPORT_MAX_BYTES);
    expect(r.body).toContain("dipotong");
    expect(r.body).not.toContain("�");
  });
  it("konstanta retensi", () => { expect(CRON_REPORT_KEEP).toBe(90); });
});
