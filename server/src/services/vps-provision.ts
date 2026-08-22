// SPEC-883 · ADR-0137 · provisioning VPS berbasis katalog. Jalur eksekusinya identik
// vps-remediate.ts: skrip deterministik dikirim lewat stdin ssh, keluaran di-parse per baris.
// Bukan sesi Claude — provisioning harus bisa diulang dan hasilnya harus bisa dibandingkan.
import { readFileSync } from "node:fs";
import type {
  ComponentId, ComponentProbe, ComponentStatus, ProvisionProfile, ProvisionStep,
} from "@hanoman/shared";
import { sshExec } from "./vps-ssh";
import { scriptPath, type VpsRow } from "./vps-audit";
import { componentById } from "../vps/catalog/components";

// `npm i -g` + build image bisa jauh melewati 300 dtk yang dipakai remediate. sshExec
// SIGKILL pada timeout tetapi TETAP memulangkan `out` yang sudah terkumpul, jadi kegagalan
// karena timeout tetap terbaca sebagai transcript parsial, bukan layar kosong.
export const PROVISION_TIMEOUT_MS = 900_000;
const PROBE_TIMEOUT_MS = 60_000;

const STATUSES: ComponentStatus[] = ["ok", "partial", "absent"];

// Baris di luar format diabaikan diam-diam (pola parseAudit/parseSteps).
export function parseComponents(out: string): ComponentProbe[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^COMP (\S+) (\S+)(?: (.*))?$/);
    if (!m) return [];
    const [, id, status] = m;
    if (!componentById(id!)) return [];
    if (!STATUSES.includes(status as ComponentStatus)) return [];
    return [{ id: id as ComponentId, status: status as ComponentStatus, detail: (m[3] ?? "").trim() }];
  });
}

export function parseProvisionSteps(out: string): ProvisionStep[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^STEP (\S+) (would|ok|fail|skip)(?: (.*))?$/);
    return m ? [{ item: m[1]!, status: m[2] as ProvisionStep["status"], detail: (m[3] ?? "").trim() }] : [];
  });
}

const script = (): string => readFileSync(scriptPath("provision.sh"), "utf8");

// Probe TIDAK memakai sudo: setiap pemeriksaannya (`command -v`, `--version`, `systemctl
// is-active`) bekerja sebagai user biasa. `sudo -n` yang meminta password menghasilkan keluaran
// tanpa satu pun baris protokol — dan itu akan terbaca sebagai "semua absent", bukan "gagal".
export async function probeComponents(v: VpsRow):
  Promise<{ ok: true; components: ComponentProbe[] } | { ok: false; out: string }> {
  const r = await sshExec(v, "env MODE=probe bash -s", { stdin: script(), timeoutMs: PROBE_TIMEOUT_MS });
  const components = parseComponents(r.out);
  if (r.code !== 0 || components.length === 0) return { ok: false, out: r.out };
  return { ok: true, components };
}

export async function provision(
  v: VpsRow,
  items: ComponentId[],
  opts: { profile: ProvisionProfile; domain?: string; dryRun: boolean },
): Promise<{ ok: boolean; steps: ProvisionStep[]; out: string }> {
  // items sudah divalidasi & diurutkan resolveComponents; profile/domain sudah lewat zod
  // (enum + HOST_RE), jadi aman dirangkai ke `env` — pola yang sama dengan vps-remediate.
  const env = [
    "MODE=apply",
    `ITEMS=${items.join(",")}`,
    `PROFILE=${opts.profile}`,
    ...(opts.domain ? [`DOMAIN=${opts.domain}`] : []),
    ...(opts.dryRun ? ["DRY_RUN=1"] : []),
  ].join(" ");
  const r = await sshExec(v, `sudo -n env ${env} bash -s`, { stdin: script(), timeoutMs: PROVISION_TIMEOUT_MS });
  return { ok: r.code === 0, steps: parseProvisionSteps(r.out), out: r.out };
}

// Setup token dibaca sebagai user service, dua baris pertama (services/bootstrap.ts menulis
// "<token>\n<expiry ISO>\n"). Nilainya TAK PERNAH disimpan, di-log, atau dipulangkan endpoint
// lain — ia hanya lewat sekali di badan respons provision.
export async function readSetupToken(v: VpsRow, home = "/var/lib/hanoman"): Promise<string | null> {
  const r = await sshExec(v, `sudo -n cat ${home}/setup.token`, { timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  const [token, expires] = r.out.trim().split("\n");
  if (!token || !expires) return null;
  return Date.parse(expires) > Date.now() ? token : null;
}
