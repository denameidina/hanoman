import { describe, it, expect, afterEach } from "vitest";
import { __emitSessionHooks, registerSessionHooks, type SessionBirth, type SessionDeath } from "../src/services/pty";

const birth: SessionBirth = {
  sessionId: "spec-1", projectId: "p1", specId: "SPEC-1", flow: "feature", kind: "spec", agent: "claude", cwd: "/tmp/x",
};
const death: SessionDeath = { sessionId: "spec-1", exitCode: 0, transcript: null };
const offs: (() => void)[] = [];
afterEach(() => { while (offs.length) offs.pop()!(); });

// SPEC-1215 · ADR-0166 · dulu satu slot: pendaftar kedua (tap log) mematikan riwayat sesi tanpa error.
describe("registerSessionHooks aditif", () => {
  it("dua pendaftar sama-sama menerima lahir dan tutup", () => {
    const a: string[] = []; const b: string[] = [];
    offs.push(registerSessionHooks({ onBirth: (x) => a.push(`lahir:${x.sessionId}`), onDeath: (x) => a.push(`tutup:${x.sessionId}`) }));
    offs.push(registerSessionHooks({ onBirth: (x) => b.push(`lahir:${x.sessionId}`), onDeath: (x) => b.push(`tutup:${x.sessionId}`) }));
    __emitSessionHooks.birth(birth);
    __emitSessionHooks.death(death);
    expect(a).toEqual(["lahir:spec-1", "tutup:spec-1"]);
    expect(b).toEqual(["lahir:spec-1", "tutup:spec-1"]);
  });

  it("pendaftar yang melempar tak membungkam pendaftar sesudahnya", () => {
    const seen: string[] = [];
    offs.push(registerSessionHooks({ onBirth: () => { throw new Error("boom"); } }));
    offs.push(registerSessionHooks({ onBirth: (x) => seen.push(x.sessionId) }));
    expect(() => __emitSessionHooks.birth(birth)).not.toThrow();
    expect(seen).toEqual(["spec-1"]);
  });

  it("fungsi yang dikembalikan mencabut pendaftar", () => {
    const seen: string[] = [];
    const off = registerSessionHooks({ onBirth: (x) => seen.push(x.sessionId) });
    off();
    __emitSessionHooks.birth(birth);
    expect(seen).toEqual([]);
  });
});
