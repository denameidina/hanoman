// SPEC-884 · ADR-0138 · prasyarat hardening ADR-0117, dinilai di SATU tempat supaya
// `hanoman doctor` dan wizard setup tak pernah menjawab berbeda tentang mesin yang sama.
// Keputusannya murni (fakta → baris); IO-nya dipisah di `collectProbeFacts`.
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import type { SetupPrerequisite } from "@hanoman/shared";

type Env = Record<string, string | undefined>;

export type ProbeFacts = {
  podman: string | null;
  rootless: boolean;
  networkExists: boolean;
  credentialDirReadable: boolean;
};

const filled = (v: string | undefined): boolean => !!v && v.trim() !== "";

// Cermin `trustProxyFromEnv` (server/src/services/ingress-policy.ts:55-63) tanpa melempar —
// wizard menampilkan status, bukan menggagalkan boot.
function trustProxyOk(raw: string | undefined): boolean {
  const v = raw?.trim();
  if (!v) return false;
  if (/^[1-9]\d*$/.test(v)) return true;
  const values = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (!values.length) return false;
  return !values.some((s) => s === "true" || (!s.includes("/") && s !== "loopback"));
}

export function prerequisites(env: Env, facts: ProbeFacts): SetupPrerequisite[] {
  const network = env.HANOMAN_SESSION_NETWORK ?? "hanoman-egress";
  const credentialDir = env.HANOMAN_AGENT_CREDENTIAL_DIR;
  const scanner = env.HANOMAN_UPLOAD_SCANNER?.trim();
  return [
    { id: "podman", label: "Podman rootless",
      ok: !!facts.podman && facts.rootless,
      detail: facts.podman
        ? (facts.rootless ? facts.podman : `${facts.podman} — berjalan rootful, butuh rootless`)
        : "podman tak ada" },
    { id: "network", label: `Network "${network}"`,
      ok: facts.networkExists, detail: facts.networkExists ? network : `network ${network} belum dibuat` },
    { id: "egress-proxy", label: "Egress proxy",
      ok: filled(env.HANOMAN_EGRESS_PROXY),
      detail: env.HANOMAN_EGRESS_PROXY ?? "HANOMAN_EGRESS_PROXY belum disetel" },
    { id: "credential-dir", label: "Dir credential agen",
      ok: filled(credentialDir) && facts.credentialDirReadable,
      detail: !filled(credentialDir)
        ? "HANOMAN_AGENT_CREDENTIAL_DIR belum disetel"
        : (facts.credentialDirReadable ? credentialDir! : `${credentialDir} — tak terbaca`) },
    { id: "control-origin", label: "Control origin",
      ok: filled(env.HANOMAN_CONTROL_ORIGINS),
      detail: env.HANOMAN_CONTROL_ORIGINS ?? "HANOMAN_CONTROL_ORIGINS belum disetel" },
    { id: "trust-proxy", label: "Trusted proxy hop/CIDR",
      ok: trustProxyOk(env.HANOMAN_TRUST_PROXY),
      detail: filled(env.HANOMAN_TRUST_PROXY)
        ? (trustProxyOk(env.HANOMAN_TRUST_PROXY) ? env.HANOMAN_TRUST_PROXY! : "harus hop atau CIDR eksplisit")
        : "HANOMAN_TRUST_PROXY belum disetel" },
    { id: "upload-scanner", label: "Scanner upload",
      ok: !!scanner && isAbsolute(scanner),
      detail: !scanner ? "HANOMAN_UPLOAD_SCANNER belum disetel"
        : (isAbsolute(scanner) ? scanner : `${scanner} — path harus absolut`) },
  ];
}

export function allReady(rows: SetupPrerequisite[]): boolean {
  return rows.every((r) => r.ok);
}

function run(file: string, args: string[]): string | null {
  try { return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

/** IO. Dipanggil `doctor` dan route setup; tak pernah melempar — kegagalan probe adalah data. */
export function collectProbeFacts(env: Env): ProbeFacts {
  const podman = run("podman", ["--version"]);
  const network = env.HANOMAN_SESSION_NETWORK ?? "hanoman-egress";
  const dir = env.HANOMAN_AGENT_CREDENTIAL_DIR;
  let credentialDirReadable = false;
  if (dir) { try { accessSync(dir, constants.R_OK); credentialDirReadable = true; } catch { /* tetap false */ } }
  return {
    podman,
    rootless: podman ? run("podman", ["info", "--format", "{{.Host.Security.Rootless}}"]) === "true" : false,
    networkExists: podman ? run("podman", ["network", "exists", network]) !== null : false,
    credentialDirReadable,
  };
}
