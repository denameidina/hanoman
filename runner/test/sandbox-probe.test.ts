import { describe, expect, it } from "vitest";
import { allReady, prerequisites, type ProbeFacts } from "../src/sandbox-probe";

const facts = (o: Partial<ProbeFacts> = {}): ProbeFacts => ({
  podman: null, rootless: false, networkExists: false, credentialDirReadable: false, ...o,
});
const byId = (rows: ReturnType<typeof prerequisites>, id: string) => rows.find((r) => r.id === id)!;

describe("prasyarat hardening (SPEC-884)", () => {
  it("mesin kosong: semua merah, tak ada yang siap", () => {
    const rows = prerequisites({}, facts());
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => !r.ok)).toBe(true);
    expect(allReady(rows)).toBe(false);
  });

  it("podman ada tapi tidak rootless tetap merah, dan alasannya disebut", () => {
    const row = byId(prerequisites({}, facts({ podman: "podman 5.2.0", rootless: false })), "podman");
    expect(row.ok).toBe(false);
    expect(row.detail).toContain("rootless");
  });

  it("scanner upload harus absolut", () => {
    expect(byId(prerequisites({ HANOMAN_UPLOAD_SCANNER: "clamscan" }, facts()), "upload-scanner").ok).toBe(false);
    expect(byId(prerequisites({ HANOMAN_UPLOAD_SCANNER: "/usr/bin/clamscan" }, facts()), "upload-scanner").ok).toBe(true);
  });

  it("trusted proxy menolak nilai yang bukan hop/CIDR", () => {
    expect(byId(prerequisites({ HANOMAN_TRUST_PROXY: "true" }, facts()), "trust-proxy").ok).toBe(false);
    expect(byId(prerequisites({ HANOMAN_TRUST_PROXY: "1" }, facts()), "trust-proxy").ok).toBe(true);
    expect(byId(prerequisites({ HANOMAN_TRUST_PROXY: "127.0.0.1/32" }, facts()), "trust-proxy").ok).toBe(true);
  });

  it("semua terpenuhi → siap", () => {
    const env = {
      HANOMAN_EGRESS_PROXY: "http://egress:3128",
      HANOMAN_AGENT_CREDENTIAL_DIR: "/srv/cred",
      HANOMAN_CONTROL_ORIGINS: "https://admin.example",
      HANOMAN_TRUST_PROXY: "127.0.0.1/32",
      HANOMAN_UPLOAD_SCANNER: "/usr/bin/clamscan",
    };
    const rows = prerequisites(env, facts({
      podman: "podman 5.2.0", rootless: true, networkExists: true, credentialDirReadable: true,
    }));
    expect(allReady(rows)).toBe(true);
  });

  it("credential dir yang terisi tapi tak terbaca tetap merah", () => {
    const rows = prerequisites({ HANOMAN_AGENT_CREDENTIAL_DIR: "/srv/cred" },
      facts({ credentialDirReadable: false }));
    expect(byId(rows, "credential-dir").ok).toBe(false);
  });
});
