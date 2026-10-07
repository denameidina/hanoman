// SPEC-482 · ADR-0099 · klien HTTP tunggal untuk seluruh tool MCP. Ia sengaja TIDAK tahu apa-apa
// soal katalog: yang diterimanya sudah berupa `McpRequest` hasil `build()`.
import type { McpRequest } from "@hanoman/shared";
import type { McpConfig } from "./config";
import { explainHttpError, explainNetworkError } from "./errors";
import { redactToken } from "./redact";

export type CallResult = { ok: true; body: unknown } | { ok: false; message: string };
export type Caller = (req: McpRequest, toolName: string) => Promise<CallResult>;

export function createCaller(cfg: McpConfig, fetchImpl: typeof fetch): Caller {
  // Probe `/api/health` (endpoint PUBLIK, tanpa auth) dijalankan SEKALI saat 401 pertama. Ia
  // satu-satunya yang bisa membedakan "host salah" dari "token salah" — keduanya tampak identik
  // sebagai 401 telanjang, dan menebaknya salah menyuruh manusia memeriksa hal yang keliru.
  let hostAlive: boolean | null = null;
  const mask = (s: string) => redactToken(s, cfg.token);

  const probe = async (): Promise<void> => {
    if (hostAlive !== null) return;
    try {
      const r = await fetchImpl(`${cfg.host}/api/health`, { method: "GET" });
      hostAlive = r.ok;
    } catch { hostAlive = false; }
  };

  return async (req, toolName) => {
    if (cfg.problems.length)
      return { ok: false, message: `Konfigurasi MCP hanoman belum lengkap:\n- ${cfg.problems.join("\n- ")}` };

    const qs = req.query && Object.keys(req.query).length ? `?${new URLSearchParams(req.query).toString()}` : "";
    const url = `${cfg.host}/api${req.path}${qs}`;
    const init: RequestInit = {
      method: req.method,
      headers: {
        ...(req.headers ?? {}),
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/json",
        ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
    };

    let res: Response;
    try { res = await fetchImpl(url, init); }
    catch (e) { return { ok: false, message: mask(explainNetworkError(e, { host: cfg.host })) }; }

    const text = await res.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* biarkan sebagai teks */ }

    if (res.ok) return { ok: true, body };

    if (res.status === 401) await probe();
    return {
      ok: false,
      message: mask(explainHttpError(res.status, body, {
        host: cfg.host, hostAlive, toolName, method: req.method, path: req.path,
      })),
    };
  };
}
