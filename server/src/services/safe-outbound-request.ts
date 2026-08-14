import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isBlockedAddress } from "./webhooks/ssrf";

export type SafeRequestOptions = {
  url: URL; method: "GET" | "POST"; headers: Record<string, string>; body?: Buffer;
  allowPrivate: boolean; connectMs: number; totalMs: number; maxResponseBytes: number;
};
export type ResolvedAddress = { address: string; family: number };
export type SafeResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
export type PinnedInput = SafeRequestOptions & { address: string; family: number };
export type SafeRequestDeps = {
  lookupAll?: (host: string) => Promise<ResolvedAddress[]>;
  request?: (input: PinnedInput) => Promise<SafeResponse>;
};

const defaultLookup = async (host: string): Promise<ResolvedAddress[]> =>
  (await dnsLookup(host, { all: true })).map((row) => ({ address: row.address, family: row.family }));

async function pinnedRequest(input: PinnedInput): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const transport = input.url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport({
      protocol: input.url.protocol, hostname: input.url.hostname, port: input.url.port || undefined,
      method: input.method, path: `${input.url.pathname}${input.url.search}`, headers: input.headers,
      servername: input.url.hostname,
      // Node >= 20 menyalakan `autoSelectFamily` secara default: socket memanggil `lookup` dengan
      // `all: true` dan membaca `addresses[0].address` dari hasilnya. Menjawab dalam bentuk skalar
      // di situ memberi `undefined` → ERR_INVALID_IP_ADDRESS sebelum satu paket pun keluar, dan
      // pemanggil (sync tick, webhook) menelannya sebagai "offline". Kedua bentuk dijawab supaya
      // pinning tetap benar apa pun setelan family-nya.
      lookup: (_host, opts, callback) => (opts as { all?: boolean }).all
        ? (callback as unknown as (e: null, a: ResolvedAddress[]) => void)(null, [{ address: input.address, family: input.family }])
        : callback(null, input.address, input.family as 4 | 6),
      timeout: input.connectMs,
    }, (response) => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > input.maxResponseBytes) {
          response.destroy(new Error("outbound response terlalu besar"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks),
      }));
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("outbound timeout"), { name: "AbortError" })), input.totalMs);
    timer.unref?.();
    req.once("close", () => clearTimeout(timer));
    req.once("error", reject);
    if (input.body) req.write(input.body);
    req.end();
  });
}

export async function safeRequest(options: SafeRequestOptions, deps: SafeRequestDeps = {}): Promise<SafeResponse> {
  if (options.url.protocol !== "http:" && options.url.protocol !== "https:") throw new Error("outbound scheme ditolak");
  if (options.url.username || options.url.password) throw new Error("outbound credential URL ditolak");
  const addresses = await (deps.lookupAll ?? defaultLookup)(options.url.hostname);
  if (!addresses.length) throw new Error("DNS tak mengembalikan alamat");
  if (!options.allowPrivate) {
    const blocked = addresses.find((row) => isBlockedAddress(row.address));
    if (blocked) throw new Error(`alamat internal ditolak (${blocked.address})`);
  }
  const selected = addresses[0]!;
  return (deps.request ?? pinnedRequest)({ ...options, address: selected.address, family: selected.family });
}
