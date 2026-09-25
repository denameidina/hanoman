import { resolve4, resolve6 } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createGunzip } from "node:zlib";
import { Agent, setGlobalDispatcher } from "undici";
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

// Insiden 2026-09-23: `dns.lookup()` jalan di libuv threadpool lewat `getaddrinfo()` — panggilan
// native yang TAK BISA dibatalkan dari JS. Resolver hub yang macet meninggalkan thread itu nyangkut
// selamanya, dan `process.exit()` (dipanggil `requestRestartForUpdate` saat tombol update ditekan)
// WAJIB `pthread_join` semua thread threadpool sebelum keluar — jadi satu lookup yang macet
// membekukan seluruh proses tanpa batas waktu, bahkan dengan `totalMs` di `pinnedRequest` di bawah.
// `resolve4`/`resolve6` pakai c-ares lewat event loop biasa, bukan threadpool: resolver yang macet
// meninggalkan query menggantung di c-ares, bukan thread OS yang diblokir `process.exit()`.
export const defaultLookup = async (host: string): Promise<ResolvedAddress[]> => {
  const literal = isIP(host);
  if (literal) return [{ address: host, family: literal }];
  const [v4, v6] = await Promise.allSettled([resolve4(host), resolve6(host)]);
  const out: ResolvedAddress[] = [];
  if (v4.status === "fulfilled") out.push(...v4.value.map((address) => ({ address, family: 4 })));
  if (v6.status === "fulfilled") out.push(...v6.value.map((address) => ({ address, family: 6 })));
  return out;
};

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

// Lapis kedua di atas `defaultLookup`: bukan cuma menghindari thread yang macet, pemanggil tetap
// harus dapat jawaban dalam anggaran waktunya sendiri sekalipun lookup-nya (mock test atau resolver
// nyata) tak pernah selesai.
function withLookupTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("outbound timeout"), { name: "AbortError" })), ms);
    timer.unref?.();
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// Insiden 2026-09-25: fix di atas (defaultLookup) hanya menutup lubang untuk safeRequest.
// `fetch()` global (dipakai apa adanya oleh update.ts, github-fetch.ts, limits.ts, telegram/*)
// tetap resolve hostname lewat `dns.lookup()` bawaan undici — threadpool lagi, lubang yang sama.
// Daripada menambal tiap pemanggil satu-satu, ini menutupnya SEKALI di dispatcher global undici,
// yang menurut dokumentasinya dipakai bersama oleh `fetch()` bawaan Node (Symbol.for
// ('undici.globalDispatcher.1'/'.2')) — jadi berlaku otomatis untuk pemanggil yang sudah ada
// maupun yang akan ditulis nanti.
// `family` datang sebagai angka (4/6) dari sebagian besar pemanggil, tapi Node juga menerima
// bentuk string ("IPv4"/"IPv6") di beberapa jalur (mis. `tls.connect`) — undici mewarisi union itu.
export type GlobalLookupOptions = { all?: boolean; family?: number | "IPv4" | "IPv6" };
// Bentuk `(err, address, family)` di sini WAJIB sama persis dengan `LookupFunction` bawaan Node
// (dipakai `net`/`tls`/undici's connector) — address & family bukan opsional di tipe itu, jadi cabang
// error di bawah tetap mengirim nilai dummy ("" / 0). Pemanggil sungguhan selalu cek `err` dulu.
export type GlobalLookupCallback =
  (err: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family: number) => void;
export type GlobalLookup = (hostname: string, options: GlobalLookupOptions, callback: GlobalLookupCallback) => void;

function wantedFamily(family: GlobalLookupOptions["family"]): number | undefined {
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  return family || undefined;
}

export function toGlobalLookup(lookup: (host: string) => Promise<ResolvedAddress[]>): GlobalLookup {
  return (hostname, options, callback) => {
    lookup(hostname).then(
      (addresses) => {
        const family = wantedFamily(options.family);
        const matched = family ? addresses.filter((a) => a.family === family) : addresses;
        if (matched.length === 0) {
          callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", hostname }), "", 0);
          return;
        }
        if (options.all) { callback(null, matched, 0); return; }
        callback(null, matched[0]!.address, matched[0]!.family);
      },
      (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), "", 0),
    );
  };
}

let installedDispatcher: unknown = null;

export function installSafeGlobalFetch(o: {
  lookup?: (host: string) => Promise<ResolvedAddress[]>;
  makeDispatcher?: (lookup: GlobalLookup) => unknown;
  setDispatcher?: (d: unknown) => void;
} = {}): void {
  if (installedDispatcher) return;
  const makeDispatcher = o.makeDispatcher ?? ((lookup: GlobalLookup) => new Agent({ connect: { lookup } }));
  const setDispatcher = o.setDispatcher ?? (setGlobalDispatcher as (d: unknown) => void);
  installedDispatcher = makeDispatcher(toGlobalLookup(o.lookup ?? defaultLookup));
  setDispatcher(installedDispatcher);
}

/** Test-only: lupakan dispatcher yang sudah terpasang supaya test berikutnya bisa memasang lagi. */
export function __resetSafeGlobalFetchForTest(): void { installedDispatcher = null; }

export async function safeRequest(options: SafeRequestOptions, deps: SafeRequestDeps = {}): Promise<SafeResponse> {
  if (options.url.protocol !== "http:" && options.url.protocol !== "https:") throw new Error("outbound scheme ditolak");
  if (options.url.username || options.url.password) throw new Error("outbound credential URL ditolak");
  const addresses = await withLookupTimeout(
    (deps.lookupAll ?? defaultLookup)(options.url.hostname), options.connectMs,
  );
  if (!addresses.length) throw new Error("DNS tak mengembalikan alamat");
  if (!options.allowPrivate) {
    const blocked = addresses.find((row) => isBlockedAddress(row.address));
    if (blocked) throw new Error(`alamat internal ditolak (${blocked.address})`);
  }
  const selected = addresses[0]!;
  return (deps.request ?? pinnedRequest)({ ...options, address: selected.address, family: selected.family });
}
