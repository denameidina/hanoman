import { describe, expect, it } from "vitest";
import { errorMessage, failureMessage } from "../src/lib/report-error";

describe("report-error", () => {
  it("memakai message Error, string, atau fallback", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("teks")).toBe("teks");
    expect(errorMessage(undefined, "x")).toBe("x");
    expect(errorMessage(new Error("  "), "x")).toBe("x");
  });
  it("failureMessage menyebut aksi dan alasan", () => {
    expect(failureMessage("menyimpan", new Error("403"))).toBe("Gagal menyimpan: 403");
    expect(failureMessage("menyimpan", null)).toBe("Gagal menyimpan");
  });
});
