// SPEC-883 · ADR-0137 · katalog komponen provisioning. Komponen adalah DATA, bukan cabang di
// dalam skrip: skrip menerima daftar yang sudah lengkap & terurut dan tak pernah menebak.
import type { ComponentId, ProvisionComponent, ProvisionProfile } from "@hanoman/shared";

const BOTH: ProvisionProfile[] = ["lab", "production"];

export const COMPONENTS: ProvisionComponent[] = [
  { id: "base", label: "Paket dasar (curl, git, tmux, toolchain node-pty)", section: "dasar",
    requires: { lab: [], production: [] }, profiles: BOTH, interactiveLogin: false, needsDomain: false },
  { id: "node", label: "Node.js 22 LTS", section: "dasar",
    requires: { lab: ["base"], production: ["base"] }, profiles: BOTH, interactiveLogin: false, needsDomain: false },
  { id: "hanoman", label: "hanoman (npm global + user service + systemd)", section: "hanoman",
    requires: { lab: ["node"], production: ["node", "podman"] }, profiles: BOTH, interactiveLogin: false, needsDomain: false },
  { id: "caddy", label: "Caddy + TLS otomatis", section: "ingress",
    requires: { lab: [], production: [] }, profiles: BOTH, interactiveLogin: false, needsDomain: true },
  { id: "podman", label: "Podman rootless + network egress", section: "sandbox",
    requires: { lab: ["base"], production: ["base"] }, profiles: BOTH, interactiveLogin: false, needsDomain: false },
  { id: "agent-image", label: "Image agen hanoman-agent:latest", section: "sandbox",
    requires: { lab: [], production: ["podman"] }, profiles: ["production"], interactiveLogin: false, needsDomain: false },
  { id: "claude", label: "Claude Code CLI", section: "agen",
    requires: { lab: ["node"], production: ["agent-image"] }, profiles: BOTH, interactiveLogin: true, needsDomain: false },
  { id: "codex", label: "Codex CLI", section: "agen",
    requires: { lab: ["node"], production: ["agent-image"] }, profiles: BOTH, interactiveLogin: true, needsDomain: false },
  { id: "gh", label: "GitHub CLI", section: "agen",
    requires: { lab: ["base"], production: ["base"] }, profiles: BOTH, interactiveLogin: true, needsDomain: false },
];

const BY_ID = new Map(COMPONENTS.map((c) => [c.id, c]));
export const componentById = (id: string): ProvisionComponent | undefined => BY_ID.get(id as ComponentId);

export type Resolved = { ok: true; items: ComponentId[] } | { ok: false; error: string };

// DFS post-order = urutan topologis. Graf katalog kecil & asiklik (dijaga test); `seen`
// mencegah kunjungan ganda, jadi duplikat di input tak menggandakan langkah.
export function resolveComponents(ids: readonly ComponentId[], profile: ProvisionProfile): Resolved {
  if (ids.length === 0) return { ok: false, error: "tak ada komponen yang dipilih" };
  const out: ComponentId[] = [];
  const seen = new Set<ComponentId>();
  const stack = new Set<ComponentId>();

  const visit = (id: ComponentId): string | null => {
    const c = componentById(id);
    if (!c) return `komponen tak dikenal: ${id}`;
    if (!c.profiles.includes(profile)) return `komponen ${id} tak tersedia di profil ${profile}`;
    if (seen.has(id)) return null;
    if (stack.has(id)) return `siklus dependensi pada ${id}`;
    stack.add(id);
    for (const dep of c.requires[profile]) {
      const err = visit(dep);
      if (err) return err;
    }
    stack.delete(id);
    seen.add(id);
    out.push(id);
    return null;
  };

  for (const id of ids) {
    const err = visit(id);
    if (err) return { ok: false, error: err };
  }
  return { ok: true, items: out };
}
