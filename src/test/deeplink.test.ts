import { describe, it, expect } from "vitest";
import { parseSpecHash, specDeepLink } from "../src/screens/deeplink";
import { parseRoute } from "../src/routes";
import { NAV_KEYS } from "../src/ds/shell";

describe("parseSpecHash", () => {
  it("hash #spec=SPEC-9 → SPEC-9", () => expect(parseSpecHash("#spec=SPEC-9")).toBe("SPEC-9"));
  it("hash kombinasi #a=1&spec=SPEC-9 → SPEC-9", () => expect(parseSpecHash("#a=1&spec=SPEC-9")).toBe("SPEC-9"));
  it("URL-encoded didekode", () => expect(parseSpecHash("#spec=SPEC%2D9")).toBe("SPEC-9"));
  it("tanpa spec → null", () => expect(parseSpecHash("#foo=bar")).toBe(null));
  it("hash kosong → null", () => expect(parseSpecHash("")).toBe(null));
});

// ADR-0160 · builder memakai path router; parser hash di atas tinggal untuk link lama.
describe("specDeepLink", () => {
  it("bangun URL absolut /backlog/<id>", () =>
    expect(specDeepLink("SPEC-9", { origin: "https://h.id" })).toBe("https://h.id/backlog/SPEC-9"));
  it("roundtrip parse lewat routes", () =>
    expect(parseRoute(new URL(specDeepLink("SPEC-9", { origin: "https://h.id" })).pathname, NAV_KEYS))
      .toEqual({ section: "backlog", specId: "SPEC-9" }));
});
