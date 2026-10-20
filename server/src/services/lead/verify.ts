import { spawn } from "node:child_process";

// ADR-0228 · bukti hijau dijalankan SERVER, bukan diklaim lead. Asinkron + batas waktu: integrasi
// dipanggil dari jalur act/tick, dan spawnSync akan memblokir event loop (SPEC-197).

// Env sesi hanoman yang tak boleh bocor ke perintah verifikasi: `HANOMAN_SESSION_ID`/`EVENT_*`
// membuat hook agen di dalamnya mengira ia sesi kita, dan `CONTROL_ORIGINS`/`SUPERVISOR`/`WEB_DIR`
// mengubah perilaku server yang di-boot test (terukur: 404 massal di `app.inject`).
const STRIP = /^HANOMAN_(SESSION_ID|EVENT_|CONTROL_ORIGINS|SUPERVISOR|WEB_DIR|LEAD_)/;

export type VerifyResult = { ok: boolean; code: number | null; tail: string };

export function runVerify(cwd: string, command: string, timeoutMs: number): Promise<VerifyResult> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !STRIP.test(k)));
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (b: Buffer) => { out = (out + b.toString()).slice(-4000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !signal, code, tail: signal ? `${out}\n[dihentikan: ${signal}]` : out });
    });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, code: null, tail: e.message }); });
  });
}
