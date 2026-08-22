// SPEC-883 · provision.sh dijalankan SUNGGUHAN di mesin test dengan PATH fixture, jadi ia tak
// pernah menyentuh mesin nyata. Ini satu-satunya lapis yang menguji skripnya sendiri; test route
// memakai fake-ssh dan karena itu tak pernah melihat isi skrip.
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
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
// `have()` di skrip memakai `command -v`, jadi ia menilai KEBERADAAN berkas — stub yang
// "exit 127" tetap terhitung ada. Untuk membuat sebuah biner benar-benar absen, buang berkasnya.
const unstub = (name: string) => rmSync(join(binDir, name), { force: true });
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

describe("SPEC-883 · provision.sh MODE=apply", () => {
  const steps = (out: string) =>
    out.split("\n").filter((l) => l.startsWith("STEP ")).map((l) => {
      const [, item, status, ...rest] = l.split(" ");
      return { item, status, detail: rest.join(" ") };
    });

  it("DRY_RUN=1 memulangkan `would` untuk setiap item, nol tulis", () => {
    const log = join(binDir, "apply.log");
    // Gerbang idempotensi berjalan SEBELUM dry-run — komponen yang sudah ada tetap dilaporkan
    // `skip already-present`, juga di pratinjau. Jadi pastikan keduanya benar-benar absen dulu.
    unstub("node");
    stub("apt-get", `echo "$@" >> ${log}; exit 0`);
    const out = run({ MODE: "apply", ITEMS: "base,node", PROFILE: "lab", DRY_RUN: "1" });
    expect(steps(out).map((s) => s.item)).toEqual(["base", "node"]);
    expect(steps(out).every((s) => s.status === "would")).toBe(true);
    expect(() => execFileSync("cat", [log])).toThrow();
  });

  it("komponen yang sudah ada → skip already-present (idempoten)", () => {
    stub("node", 'echo "v22.11.0"');
    const out = run({ MODE: "apply", ITEMS: "node", PROFILE: "lab" });
    expect(steps(out)[0]).toMatchObject({ item: "node", status: "skip" });
    expect(steps(out)[0]!.detail).toMatch(/already-present/);
  });

  it("prasyarat gagal → dependennya skip blocked-by, komponen tak terkait TETAP jalan", () => {
    stub("apt-get", "exit 1");
    stub("dnf", "exit 1");
    unstub("node");   // node benar-benar absen supaya ia mencoba dipasang, bukan di-skip
    const out = run({ MODE: "apply", ITEMS: "base,node,gh", PROFILE: "lab" });
    const byItem = Object.fromEntries(steps(out).map((s) => [s.item, s]));
    expect(byItem.base!.status).toBe("fail");
    expect(byItem.node!.status).toBe("skip");
    expect(byItem.node!.detail).toMatch(/blocked-by base/);
    expect(byItem.gh).toBeDefined();  // baris tetap terbit, tak pernah hilang senyap
  });

  it("caddy dengan DNS tak cocok → fail dns-mismatch, komponen lain tetap jalan", () => {
    stub("getent", 'echo "203.0.113.99  contoh.test"');
    stub("curl", 'echo "198.51.100.7"');
    stub("node", 'echo "v22.11.0"');
    const out = run({ MODE: "apply", ITEMS: "caddy,node", PROFILE: "lab", DOMAIN: "contoh.test" });
    const byItem = Object.fromEntries(steps(out).map((s) => [s.item, s]));
    expect(byItem.caddy!.status).toBe("fail");
    expect(byItem.caddy!.detail).toMatch(/dns-mismatch/);
    expect(byItem.node).toBeDefined();
  });

  it("caddy tanpa DOMAIN → fail, tak pernah memasang apa pun", () => {
    const out = run({ MODE: "apply", ITEMS: "caddy", PROFILE: "lab" });
    expect(steps(out)[0]).toMatchObject({ item: "caddy", status: "fail" });
  });
});
