type Env = Record<string, string | undefined>;
export type IngressPolicy = { publicHosts: Set<string>; controlHosts: Set<string>; enforce: boolean };
export type IngressRequest = { host: string; method: string; url: string };

function origins(value: string | undefined, key: string): Set<string> {
  const out = new Set<string>();
  for (const raw of value?.split(",") ?? []) {
    const input = raw.trim();
    if (!input) continue;
    const parsed = new URL(input);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/")
      throw new Error(`${key} harus berisi exact http(s) origin`);
    out.add(parsed.host.toLowerCase());
  }
  return out;
}

export function loadIngressPolicy(env: Env): IngressPolicy {
  const publicHosts = origins(env.HANOMAN_PUBLIC_ORIGINS, "HANOMAN_PUBLIC_ORIGINS");
  const controlHosts = origins(env.HANOMAN_CONTROL_ORIGINS, "HANOMAN_CONTROL_ORIGINS");
  for (const host of publicHosts) if (controlHosts.has(host)) throw new Error("public dan control origin harus berbeda");
  return { publicHosts, controlHosts, enforce: publicHosts.size > 0 || controlHosts.size > 0 };
}

function publicPath(method: string, path: string): boolean {
  if (method === "GET" && path === "/api/health") return true;
  if (path === "/api/help" || path.startsWith("/api/help/")) return true;
  return !path.startsWith("/api/");
}

export function classifyIngress(req: IngressRequest, policy: IngressPolicy): "public" | "control" | "denied" {
  if (!policy.enforce) return "control";
  const host = req.host.trim().toLowerCase();
  const path = req.url.split("?")[0] ?? req.url;
  if (policy.publicHosts.has(host)) return publicPath(req.method, path) ? "public" : "denied";
  if (policy.controlHosts.has(host)) return publicPath(req.method, path) && path.startsWith("/api/help")
    ? "denied" : "control";
  return "denied";
}

export function trustProxyFromEnv(env: Env): string[] | number | false {
  const raw = env.HANOMAN_TRUST_PROXY?.trim();
  if (!raw) return false;
  if (/^[1-9]\d*$/.test(raw)) return Number(raw);
  const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (!values.length || values.some((v) => v === "true" || (!v.includes("/") && v !== "loopback")))
    throw new Error("HANOMAN_TRUST_PROXY harus berupa hop atau CIDR eksplisit");
  return values;
}
