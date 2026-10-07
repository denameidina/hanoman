import { beforeEach, describe, expect, it, vi } from "vitest";

// Insiden 2026-10-07: proses hanoman yang hidup berhari-hari kehilangan DNS (“DNS tak mengembalikan
// alamat”) sampai direstart, padahal hub sehat dan proses `node` baru meresolve normal. `resolve4`/
// `resolve6` modul-level memakai channel c-ares bawaan yang dibuat SEKALI dengan daftar nameserver
// saat itu — basi setelah pindah jaringan. Lookup harus memakai `Resolver` segar tiap panggilan.
const state = vi.hoisted(() => ({ created: 0, staleCalls: 0 }));
vi.mock("node:dns/promises", () => ({
  resolve4: async () => { state.staleCalls++; throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }); },
  resolve6: async () => { state.staleCalls++; throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }); },
  Resolver: class {
    constructor() { state.created++; }
    resolve4 = async () => ["103.59.161.119"];
    resolve6 = async () => { throw Object.assign(new Error("ENODATA"), { code: "ENODATA" }); };
    cancel() {}
  },
}));

import { defaultLookup } from "../src/services/safe-outbound-request";

describe("defaultLookup — resolver segar", () => {
  beforeEach(() => { state.created = 0; state.staleCalls = 0; });
  it("tidak bergantung pada channel c-ares global yang bisa basi", async () => {
    await expect(defaultLookup("hub.example.test")).resolves.toEqual([{ address: "103.59.161.119", family: 4 }]);
    expect(state.staleCalls).toBe(0);
  });
  it("membuat Resolver baru di tiap panggilan", async () => {
    await defaultLookup("a.example.test"); await defaultLookup("b.example.test");
    expect(state.created).toBe(2);
  });
});
