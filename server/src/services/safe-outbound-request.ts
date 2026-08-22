import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createGunzip } from "node:zlib";
import { isBlockedAddress } from "./webhooks/ssrf";

export type SafeRequestOptions = {
  url: URL; method: "GET" | "POST"; headers: Record<string, string>; body?: Buffer;
  allowPrivate: boolean; connectMs: number; totalMs: number; maxResponseBytes: number;
  // SPEC-885 · ADR-0138 · dekompresi OPT-IN, default MATI. Modul ini juga melayani webhook keluar
  // (ADR-0100) di balik penjaga SSRF; menyalakan gunzip untuk semua pemanggil memperlebar
  // permukaan serang tanpa ada satu pun yang memintanya.
  acceptEncoding?: "gzip";
  // Cap KEDUA, atas byte TERURAI. `maxResponseBytes` menghitung byte kabel, dan itu berhenti
  // cukup begitu dekompresi menyala: 40 MB nol mampat jadi ~40 KB, lolos cap kabel mana pun.
  maxDecodedBytes?: number;
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
      // SPEC-885 · ADR-0138 · dekompresi hanya bila pemanggil MEMINTANYA dan balasannya memang
      // ber-gzip. Dua syarat, bukan satu: peer yang mengirim `content-encoding: gzip` tanpa
      // diminta tak boleh mengubah bentuk body bagi pemanggil yang tak siap menerimanya.
      const dimampat = input.acceptEncoding === "gzip"
        && String(response.headers["content-encoding"] ?? "").toLowerCase() === "gzip";
      const capTerurai = input.maxDecodedBytes ?? input.maxResponseBytes;
      const chunks: Buffer[] = [];
      let kabel = 0, terurai = 0;
      const selesai = () => resolve({
        status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks),
      });

      const sink = dimampat ? createGunzip() : null;
      if (sink) {
        sink.on("data", (chunk: Buffer) => {
          terurai += chunk.length;
          if (terurai > capTerurai) {
            sink.destroy(new Error("outbound response terurai terlalu besar"));
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        sink.on("end", selesai);
        sink.on("error", reject);
      }

      response.on("data", (chunk: Buffer) => {
        kabel += chunk.length;
        if (kabel > input.maxResponseBytes) {
          response.destroy(new Error("outbound response terlalu besar"));
          return;
        }
        if (sink) sink.write(chunk); else chunks.push(chunk);
      });
      response.on("end", () => { if (sink) sink.end(); else selesai(); });
      // Dulu tak ada handler ini: penolakan saat cap terlampaui bergantung pada propagasi
      // implisit ke event 'error' milik request. Eksplisit lebih murah daripada mengandalkannya.
      response.on("error", reject);
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
