// SPEC-883 · scriptPath adalah satu-satunya jalan skrip VPS ditemukan runtime. Sebelum spec ini
// ia menjangkar ke repoRoot(), yang mencari marker pnpm-workspace.yaml dan JATUH KE process.cwd()
// bila tak ketemu — persis keadaan instalasi npm global (systemd WorkingDirectory=/var/lib/hanoman).
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { scriptPath } from "../src/services/vps-audit";

describe("SPEC-883 · scriptPath", () => {
  it("menemukan skrip di checkout", () => {
    for (const f of ["audit.sh", "harden.sh", "remediate.sh"]) {
      expect(existsSync(scriptPath(f))).toBe(true);
    }
  });

  it("mengabaikan cwd — dijalankan dari direktori mana pun tetap benar", () => {
    const before = process.cwd();
    try {
      process.chdir("/");
      expect(existsSync(scriptPath("audit.sh"))).toBe(true);
    } finally { process.chdir(before); }
  });
});
