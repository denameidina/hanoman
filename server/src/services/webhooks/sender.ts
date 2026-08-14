import { WEBHOOK_TIMEOUT_MS } from "@hanoman/shared";
import { signedHeaders } from "./sign";
import { checkDestination, validateWebhookUrl, type Lookup } from "./ssrf";
import { secretOf, type Endpoint } from "./endpoints";
import { safeRequest, type SafeRequestDeps } from "../safe-outbound-request";

// SPEC-481 · ADR-0100 · satu pengiriman HTTP. Murni terhadap DB — pemanggilnya yang membukukan
// hasilnya, supaya jalur ini bisa dites tanpa jaringan maupun tabel.

export type Fetcher = (url: string, init: {
  method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "manual";
}) => Promise<{ status: number }>;

export type SenderDeps = { fetcher?: Fetcher; lookup?: Lookup; outbound?: SafeRequestDeps };

export type SendResult = {
  ok: boolean; httpStatus: number | null; durationMs: number; error: string | null;
  /** Penerima menyatakan dirinya mati — jangan diulang, matikan endpointnya. */
  gone: boolean;
};

export async function sendOnce(o: {
  endpoint: Pick<Endpoint, "url" | "secret" | "allowPrivate">;
  deliveryId: string; eventId: string; eventType: string; attempt: number; body: string;
  nowSec?: number;
}, deps: SenderDeps = {}): Promise<SendResult> {
  const started = Date.now();
  const fail = (error: string, httpStatus: number | null = null, gone = false): SendResult =>
    ({ ok: false, httpStatus, durationMs: Date.now() - started, error, gone });

  const parsed = validateWebhookUrl(o.endpoint.url);
  if (!parsed.ok) return fail(`URL tak sah: ${parsed.error}`);
  const guard = await checkDestination(parsed.url, o.endpoint.allowPrivate, deps.lookup);
  if (!guard.ok) return fail(guard.error);

  const secret = secretOf(o.endpoint);
  // Kunci enkripsi berganti → ciphertext tak terbuka. Mengirim TANPA tanda tangan lebih buruk
  // daripada tak mengirim: penerima yang benar akan menolaknya, penerima yang lalai menerimanya.
  if (!secret) return fail("secret tak bisa dibuka — rotasi secret endpoint ini");

  const headers = signedHeaders({
    secret, body: o.body, eventType: o.eventType, eventId: o.eventId,
    deliveryId: o.deliveryId, attempt: o.attempt,
    nowSec: o.nowSec ?? Math.floor(Date.now() / 1000),
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = deps.fetcher
      ? await deps.fetcher(parsed.url.toString(), {
          method: "POST", headers, body: o.body, signal: ac.signal, redirect: "manual",
        })
      : await safeRequest({
          url: parsed.url, method: "POST", headers, body: Buffer.from(o.body),
          allowPrivate: o.endpoint.allowPrivate, connectMs: WEBHOOK_TIMEOUT_MS,
          totalMs: WEBHOOK_TIMEOUT_MS, maxResponseBytes: 64 * 1024,
        }, {
          ...deps.outbound,
          lookupAll: deps.lookup
            ? async (host) => (await deps.lookup!(host)).map((a) => ({
                address: a.address, family: a.address.includes(":") ? 6 : 4,
              }))
            : deps.outbound?.lookupAll,
        });
    const durationMs = Date.now() - started;
    if (res.status >= 200 && res.status < 300)
      return { ok: true, httpStatus: res.status, durationMs, error: null, gone: false };
    if (res.status === 410)
      return { ok: false, httpStatus: 410, durationMs, error: "penerima menjawab 410 Gone", gone: true };
    return { ok: false, httpStatus: res.status, durationMs, error: `HTTP ${res.status}`, gone: false };
  } catch (e) {
    const msg = (e as Error).name === "AbortError"
      ? `timeout ${WEBHOOK_TIMEOUT_MS} ms` : (e as Error).message;
    return fail(msg);
  } finally { clearTimeout(timer); }
}
