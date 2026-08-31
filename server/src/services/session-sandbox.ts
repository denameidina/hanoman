import { resolveHardening } from "@hanoman/runner";

type Env = Record<string, string | undefined>;

export function assertRuntimeBoundary(env: Env, runtime: { uid: number | undefined; host: string }): void {
  // SPEC-884 · ADR-0139 · satu-satunya perubahan pada gerbang ini: ia berhenti diturunkan dari
  // `NODE_ENV` dan mulai diturunkan dari hardening yang diminta eksplisit. Isinya di bawah TIDAK
  // disentuh — begitu hardening menyala, perilakunya identik dengan sebelum SPEC-884.
  if (!resolveHardening(env)) return;
  if (runtime.uid === 0) throw new Error("production Hanoman harus berjalan sebagai user non-root");
  if (env.HANOMAN_SESSION_SANDBOX !== "podman")
    throw new Error("HANOMAN_SESSION_SANDBOX=podman wajib di production");
  // SPEC-805 · single-origin sah, tetapi hanya sebagai pengakuan eksplisit. Tanpa `HANOMAN_SINGLE_ORIGIN`
  // syarat split tetap berlaku — sebab kegagalan yang dihindari di sini adalah env yang diisi asal agar
  // boot lolos (host publik tanpa DNS/vhost), yang mematikan seluruh permukaan Help tanpa jejak.
  if (!env.HANOMAN_CONTROL_ORIGINS || (!env.HANOMAN_PUBLIC_ORIGINS && !env.HANOMAN_SINGLE_ORIGIN))
    throw new Error("public/control origin wajib dipisahkan di production (HANOMAN_SINGLE_ORIGIN=1 untuk sadar memilih satu origin)");
  if (!env.HANOMAN_TRUST_PROXY) throw new Error("trusted proxy hop/CIDR wajib di production");
  if (runtime.host !== "127.0.0.1" && runtime.host !== "::1" && runtime.host !== "localhost")
    throw new Error("origin Hanoman harus bind loopback; buka hanya reverse proxy");
}

export type SandboxInput = {
  podmanBin?: string;
  command: string;
  worktree: string;
  worktreeMode?: "ro" | "rw";
  phaseFile?: string;
  promptFile?: string;
  /** SPEC-950 · ADR-0159 · JSON/TOML + hook custom-agent; dibaca child, tidak ditulis. */
  agentConfigDir?: string;
  /** SPEC-950 · spool event atomik; satu-satunya mount custom-agent yang writable. */
  eventDir?: string;
  /** SPEC-843 · ADR-0124 · direktori lampiran backlog. RO: sesi membacanya, tak pernah menulisnya. */
  attachmentsDir?: string;
  credentialDir: string;
  image: string;
  network: string;
  proxy: string;
};

export function sandboxArgv(input: SandboxInput): string[] {
  const mounts = ["--volume", `${input.worktree}:/workspace:${input.worktreeMode ?? "rw"}`];
  if (input.phaseFile) mounts.push("--volume", `${input.phaseFile}:${input.phaseFile}:rw`);
  if (input.promptFile) mounts.push("--volume", `${input.promptFile}:${input.promptFile}:ro`);
  if (input.agentConfigDir)
    mounts.push("--volume", `${input.agentConfigDir}:${input.agentConfigDir}:ro`);
  if (input.eventDir)
    mounts.push("--volume", `${input.eventDir}:${input.eventDir}:rw`);
  if (input.attachmentsDir)
    mounts.push("--volume", `${input.attachmentsDir}:${input.attachmentsDir}:ro`);
  mounts.push("--volume", `${input.credentialDir}:/agent-home:ro`);
  return [
    input.podmanBin ?? "podman", "run", "--rm", "--read-only", "--cap-drop=ALL", "--userns=keep-id",
    "--security-opt", "no-new-privileges", "--pids-limit", "512", "--memory", "4g",
    "--cpus", "4", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=256m", "--workdir", "/workspace",
    "--network", input.network,
    "--env", `HTTPS_PROXY=${input.proxy}`, "--env", `HTTP_PROXY=${input.proxy}`,
    "--env", "NO_PROXY=localhost,127.0.0.1,::1", "--env", "HOME=/agent-home",
    ...(input.eventDir ? ["--env", `HANOMAN_EVENT_DIR=${input.eventDir}`] : []),
    ...mounts, input.image, "/bin/sh", "-lc", input.command,
  ];
}

const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

export function sandboxArgvFromEnv(input: {
  command: string; worktree: string; worktreeMode?: "ro" | "rw";
  phaseFile?: string; promptFile?: string; agentConfigDir?: string; eventDir?: string;
  attachmentsDir?: string; env?: Env;
}): string[] | null {
  const env = input.env ?? process.env;
  // SPEC-884 · pemicunya hardening, bukan NODE_ENV. Operator yang menyetel HANOMAN_SESSION_SANDBOX
  // secara eksplisit tetap menang atas keduanya (termasuk "off" untuk mematikannya sementara).
  const mode = env.HANOMAN_SESSION_SANDBOX ?? (resolveHardening(env) ? "required" : "off");
  if (mode === "off") return null;
  if (mode !== "podman") throw new Error("session sandbox production tidak dikonfigurasi");
  const credentialDir = env.HANOMAN_AGENT_CREDENTIAL_DIR;
  const proxy = env.HANOMAN_EGRESS_PROXY;
  if (!credentialDir || !proxy) throw new Error("credential dir dan egress proxy wajib untuk sandbox");
  return sandboxArgv({
    ...input, credentialDir, proxy,
    podmanBin: env.HANOMAN_PODMAN_BIN ?? "podman",
    image: env.HANOMAN_SESSION_IMAGE ?? "hanoman-agent:latest",
    network: env.HANOMAN_SESSION_NETWORK ?? "hanoman-egress",
  });
}

export function sandboxCommand(input: {
  command: string; worktree: string; phaseFile?: string; promptFile?: string;
  agentConfigDir?: string; eventDir?: string; attachmentsDir?: string; env?: Env;
}): string {
  const argv = sandboxArgvFromEnv(input);
  if (!argv) return input.command;
  return argv.map(quote).join(" ");
}
