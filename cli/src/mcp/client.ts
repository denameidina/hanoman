// SPEC-482 · ADR-0099 · klien HTTP tunggal untuk seluruh tool MCP. Ia sengaja TIDAK tahu apa-apa
// soal katalog: yang diterimanya sudah berupa `McpRequest` hasil `build()`.
import type { McpRequest } from "@hanoman/shared";
import type { McpConfig } from "./config";
import { explainHttpError, explainNetworkError } from "./errors";
import { redactToken } from "./redact";
import { buildMultipart, receiveDownload, resolveTransferPolicy } from "./transfer";

export type CallResult = { ok: true; body: unknown } | { ok: false; message: string };
export type Caller = (req: McpRequest, toolName: string) => Promise<CallResult>;

export function createCaller(cfg: McpConfig, fetchImpl: typeof fetch): Caller {
  // Probe `/api/health` (endpoint PUBLIK, tanpa auth) dijalankan SEKALI saat 401 pertama. Ia
  // satu-satunya yang bisa membedakan "host salah" dari "token salah" — keduanya tampak identik
  // sebagai 401 telanjang, dan menebaknya salah menyuruh manusia memeriksa hal yang keliru.
  let hostAlive: boolean | null = null;
  const mask = (s: string) => redactToken(s, cfg.token);
  // Default AMAN bila konfigurasi tak membawa kebijakan (test, pemanggil lama): cwd + direktori sementara MCP.
  const policy = cfg.transfer ?? resolveTransferPolicy([], {}).policy;

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
    // ADR-0183 · multipart dirakit dari disk LOKAL dan baru setelah path-nya lolos penilaian; satu
    // berkas ditolak membatalkan seluruh panggilan SEBELUM ada byte yang meninggalkan mesin ini.
    let body: BodyInit | undefined;
    if (req.multipart) {
      const built = await buildMultipart(policy, req.multipart);
      if (!built.ok) return { ok: false, message: mask(built.message) };
      body = built.form;
    } else if (req.body !== undefined) body = JSON.stringify(req.body);
    const init: RequestInit = {
      method: req.method,
      headers: {
        ...(req.headers ?? {}),
        // ADR-0192 · identitas sesi dari ENV proses ini, tak pernah dari argumen model; dipasang
        // SESUDAH `req.headers` supaya `build()` sebuah tool tak bisa menimpanya.
        ...(cfg.sessionId ? { "x-hanoman-session": cfg.sessionId } : {}),
        Authorization: `Bearer ${cfg.token}`,
        Accept: req.download ? "*/*" : "application/json",
        // `multipart/form-data` TANPA Content-Type: fetch yang mengisi, lengkap dengan boundary.
        ...(req.body !== undefined && !req.multipart ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    };

    let res: Response;
    try { res = await fetchImpl(url, init); }
    catch (e) { return { ok: false, message: mask(explainNetworkError(e, { host: cfg.host })) }; }

    // ADR-0183 · balasan berkas: HANYA yang 2xx dialirkan ke disk; galat HTTP tetap lewat jalur teks.
    if (res.ok && req.download) {
      const r = await receiveDownload(policy, res, req.download, Math.max(512, Math.floor(cfg.maxBytes / 2)));
      return r.ok ? { ok: true, body: r.body } : { ok: false, message: mask(r.message) };
    }

    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* biarkan sebagai teks */ }

    if (res.ok) return { ok: true, body: parsed };

    if (res.status === 401) await probe();
    return {
      ok: false,
      message: mask(explainHttpError(res.status, parsed, {
        host: cfg.host, hostAlive, toolName, method: req.method, path: req.path,
      })),
    };
  };
}
