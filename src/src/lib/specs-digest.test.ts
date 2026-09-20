import { describe, it, expect } from "vitest";
import { specsDigestOf, mergeSlim } from "./specs-digest";

const base = { id: "S1", stage: "planned", version: 1, updatedAt: "t" } as const;

describe("specsDigestOf", () => {
  it("sama untuk isi sama walau referensi beda", () => {
    expect(specsDigestOf([base])).toBe(specsDigestOf(structuredClone([base])));
  });

  it("berubah saat stage/version/updatedAt/tambah/hapus", () => {
    const d = specsDigestOf([base]);
    expect(specsDigestOf([{ ...base, stage: "executing" }])).not.toBe(d);
    expect(specsDigestOf([{ ...base, version: 2 }])).not.toBe(d);
    expect(specsDigestOf([{ ...base, updatedAt: "u" }])).not.toBe(d);
    expect(specsDigestOf([base, { ...base, id: "S2" }])).not.toBe(d);
    expect(specsDigestOf([])).not.toBe(d);
  });
});

describe("mergeSlim", () => {
  it("menjaga objective dari HTTP dan menimpa kolom siar", () => {
    const http = { id: "S1", objective: "obj", stage: "planned", version: 1 } as never;
    const m = mergeSlim(http, { id: "S1", stage: "executing", version: 2 } as never) as Record<string, unknown>;
    expect(m.objective).toBe("obj");
    expect(m.stage).toBe("executing");
    expect(m.version).toBe(2);
  });

  it("tanpa slim mengembalikan item HTTP apa adanya", () => {
    const http = { id: "S1", objective: "obj" } as never;
    expect(mergeSlim(http, undefined)).toBe(http);
  });
});
