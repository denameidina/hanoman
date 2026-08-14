import { configEntry, CONFIG_REGISTRY } from "@hanoman/shared";
import { rawDbValue, setConfigsAtomic } from "../config";
import { applySyncConfig } from "./sync-client";

// SPEC-215 · ADR-0049 · orkestrasi side-effect saat config berubah / boot.
const SYNC_KEYS = new Set(["SYNC_SERVER_URL", "SYNC_DEVICE_TOKEN", "SYNC_TICK_MS"]);

// Snapshot nilai env ASLI untuk kunci warisan, diambil sebelum mirror pertama. Tanpa ini,
// effective value membaca process.env yang sudah kita timpa → clear tak pernah bisa memulihkan.
const ORIGINAL_ENV = new Map<string, string | undefined>();
function ensureSnapshot(key: string): void {
  if (!ORIGINAL_ENV.has(key)) ORIGINAL_ENV.set(key, process.env[key]);
}

// Mirror override DB → process.env agar proses claude baru mewarisinya; tanpa override DB,
// pulihkan nilai env asli (atau hapus bila memang tak pernah ada).
function mirrorInheritEnv(key: string): void {
  ensureSnapshot(key);
  const v = rawDbValue(key) ?? ORIGINAL_ENV.get(key);
  if (v === undefined) delete process.env[key]; else process.env[key] = v;
}

// Dispatch side-effect untuk satu key yang berubah (set/clear).
export async function applyConfigSideEffect(key: string): Promise<void> {
  if (SYNC_KEYS.has(key)) { await applySyncConfig(); return; }
  // SPEC-477 · ADR-0097 · kredensial Telegram berlaku langsung: gateway dipasang ulang in-process.
  if (configEntry(key)?.group === "telegram") {
    const { reloadTelegramGateway } = await import("./telegram/bootstrap");
    await reloadTelegramGateway();
    return;
  }
  if (configEntry(key)?.inheritEnv) mirrorInheritEnv(key);
}

export async function rotateSyncOrigin(input: string): Promise<{ needsDeviceToken: true }> {
  const url = new URL(input);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("URL hub harus exact origin tanpa credential, path, query, atau fragment");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && loopback))
    throw new Error("URL hub harus HTTPS (HTTP hanya loopback development)");
  await setConfigsAtomic({ SYNC_SERVER_URL: url.origin, SYNC_DEVICE_TOKEN: "" });
  await applySyncConfig();
  return { needsDeviceToken: true };
}

// Dipanggil saat boot server: mirror semua kredensial warisan + init sync client.
export async function applyConfigOnBoot(): Promise<void> {
  for (const e of CONFIG_REGISTRY) if (e.inheritEnv) mirrorInheritEnv(e.key);
  await applySyncConfig();
  // SPEC-270 · ADR-0067 · reconciler feed hanya bila peran HUB (tak ada SYNC_SERVER_URL).
  const { effectiveStr } = await import("../config");
  if (!effectiveStr("SYNC_SERVER_URL")) {
    const { backfillFeed } = await import("./sync");
    try { const n = await backfillFeed(); if (n) console.log(`sync backfill: ${n} record ke feed`); }
    catch (e) { console.error("sync backfill gagal:", e); }
  }
}
