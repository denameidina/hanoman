// SPEC-883 · provision.sh dijalankan SUNGGUHAN di mesin test dengan PATH fixture, jadi ia tak
// pernah menyentuh mesin nyata. Ini satu-satunya lapis yang menguji skripnya sendiri; test route
// memakai fake-ssh dan karena itu tak pernah melihat isi skrip.
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/vps/provision.sh", import.meta.url));

let binDir: string;
const stub = (name: string, body: string) => {
  const p = join(binDir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(p, 0o755);
};
const run = (env: Record<string, string>) =>
  execFileSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { PATH: `${binDir}:/usr/bin:/bin`, ...env },
  });

beforeAll(() => {
  // PATH sengaja minimal (binDir + /usr/bin + /bin): apa pun di luar itu (node, claude, caddy,
  // podman) tak terlihat skrip kecuali kita men-stub-nya. `command -v` adalah builtin shell —
  // ia TIDAK bisa di-stub lewat PATH, jadi jangan mencoba.
  binDir = mkdtempSync(join(tmpdir(), "hanoman-provision-bin-"));
});

describe("SPEC-883 · provision.sh MODE=probe", () => {
  it("melaporkan satu baris per komponen", () => {
    const out = run({ MODE: "probe" });
    const ids = out.split("\n").filter((l) => l.startsWith("COMP ")).map((l) => l.split(" ")[1]);
    expect(ids).toEqual(expect.arrayContaining(
      ["base", "node", "hanoman", "caddy", "podman", "agent-image", "claude", "codex", "gh"]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("node terpasang → COMP node ok <versi>", () => {
    stub("node", 'echo "v22.11.0"');
    const line = run({ MODE: "probe" }).split("\n").find((l) => l.startsWith("COMP node "));
    expect(line).toMatch(/^COMP node ok v22\.11\.0/);
  });

  it("claude terpasang tapi belum login → partial not-logged-in, TAK PERNAH ok", () => {
    stub("claude", 'echo "1.2.3"');
    const line = run({ MODE: "probe" }).split("\n").find((l) => l.startsWith("COMP claude "));
    expect(line).toMatch(/^COMP claude partial not-logged-in/);
  });

  it("probe nol tulis: tak memanggil satu perintah instalasi pun", () => {
    const log = join(binDir, "install.log");
    stub("apt-get", `echo "$@" >> ${log}; exit 0`);
    stub("dnf", `echo "$@" >> ${log}; exit 0`);
    stub("npm", `echo "$@" >> ${log}; exit 0`);
    run({ MODE: "probe" });
    expect(() => execFileSync("cat", [log])).toThrow(); // berkas tak pernah dibuat
  });
});
