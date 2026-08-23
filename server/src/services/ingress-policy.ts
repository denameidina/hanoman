type Env = Record<string, string | undefined>;
export type IngressPolicy = {
  publicHosts: Set<string>; controlHosts: Set<string>; publicBase: string | null; enforce: boolean;
};
export type IngressRequest = { host: string; method: string; url: string };

function origins(value: string | undefined, key: string): { host: string; base: string }[] {
  const out: { host: string; base: string }[] = [];
  for (const raw of value?.split(",") ?? []) {
    const input = raw.trim();
    if (!input) continue;
    const parsed = new URL(input);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/")
      throw new Error(`${key} harus berisi exact http(s) origin`);
    out.push({ host: parsed.host.toLowerCase(), base: `${parsed.protocol}//${parsed.host}` });
  }
  return out;
}

export function loadIngressPolicy(env: Env): IngressPolicy {
  const pub = origins(env.HANOMAN_PUBLIC_ORIGINS, "HANOMAN_PUBLIC_ORIGINS");
  const control = origins(env.HANOMAN_CONTROL_ORIGINS, "HANOMAN_CONTROL_ORIGINS");
  const publicHosts = new Set(pub.map((o) => o.host));
  const controlHosts = new Set(control.map((o) => o.host));
  for (const host of publicHosts) if (controlHosts.has(host)) throw new Error("public dan control origin harus berbeda");
  return {
    publicHosts, controlHosts,
    // SPEC-805 · origin publik pertama, lengkap dengan scheme-nya: satu-satunya basis sah untuk
    // link status yang dibagikan operator, yang selalu lahir di request ber-host control.
    publicBase: pub[0]?.base ?? null,
    enforce: publicHosts.size > 0 || controlHosts.size > 0,
  };
}

/**
 * Host control pertama, atau `null` bila deployment ini tak memisahkan origin.
 *
 * SPEC-909 · dipakai hook sesi sebagai header `Host` di atas koneksi loopback. `classifyIngress`
 * SENGAJA tak diberi pengecualian loopback: ia menilai `Host`, dan `Host` dikendalikan pemanggil —
 * mengistimewakan `127.0.0.1` di sana akan membuka seluruh permukaan control lewat reverse proxy
 * publik, yaitu persis pemisahan yang gerbang itu ada untuk menegakkan.
 */
export function controlHost(policy: IngressPolicy): string | null {
  for (const host of policy.controlHosts) return host;
  return null;
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
  // SPEC-805 · permukaan Help disingkirkan dari host control hanya bila deployment ini MEMANG punya
  // host publik. Tanpa split (dev, tunnel single-host) deny itu menghapus Help sama sekali walau
  // helpEnabled=1 — dan `enforce` sudah menyala hanya dengan HANOMAN_CONTROL_ORIGINS terisi.
  // Produksi tak ikut turun: `assertRuntimeBoundary` menolak boot tanpa split.
  if (policy.controlHosts.has(host))
    return policy.publicBase && path.startsWith("/api/help") ? "denied" : "control";
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
