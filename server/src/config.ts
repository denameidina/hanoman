import { prisma } from "./db";
import { configEntry } from "@hanoman/shared";
import { decryptSecret, encryptSecret } from "./services/secret-box";

// SPEC-215 · ADR-0049 · resolver terpusat: override DB → env → default registry.
// Cache in-memory agar hot-path sinkron; di-refresh saat setConfig/clearConfig.
//
// SPEC-477 · ADR-0097 · nilai ber-`kind: "secret"` disimpan TERENKRIPSI di kolom DB, tapi cache
// memegang PLAINTEXT. Mendekripsi di `effectiveStr` akan memaksa kripto di hot-path sinkron dan
// memutus setiap pemakai `rawDbValue` — batasnya sengaja di `loadConfig`/`setConfig`.
let cache = new Map<string, string>();

const isSecret = (key: string): boolean => configEntry(key)?.kind === "secret";

export async function loadConfig(): Promise<void> {
  const rows = await prisma.runtimeConfig.findMany();
  const next = new Map<string, string>();
  for (const r of rows) {
    if (!isSecret(r.key)) { next.set(r.key, r.value); continue; }
    const plain = decryptSecret(r.value);
    // Kunci hilang/berganti: perlakukan sebagai ABSEN. Boot tak boleh mati karena satu secret
    // tak terbaca — resolver akan jatuh ke env/default seperti saat DB memang kosong.
    if (plain === null) { console.error(`config: nilai '${r.key}' tak bisa didekripsi — diabaikan`); continue; }
    next.set(r.key, plain);
  }
  cache = next;
}

export function rawDbValue(key: string): string | undefined { return cache.get(key); }

export function effectiveStr(key: string): string | undefined {
  return cache.get(key) ?? process.env[key] ?? configEntry(key)?.default;
}
export function effectiveInt(key: string): number | undefined {
  const v = effectiveStr(key);
  return v === undefined ? undefined : Number(v);
}
export function effectiveBool(key: string): boolean {
  const v = effectiveStr(key);
  return v === "1" || v === "true";
}
export function sourceOf(key: string): "db" | "env" | "default" {
  if (cache.has(key)) return "db";
  if (process.env[key] !== undefined) return "env";
  return "default";
}

export async function setConfig(key: string, value: string): Promise<void> {
  const stored = isSecret(key) ? encryptSecret(value) : value;
  await prisma.runtimeConfig.upsert({ where: { key }, create: { key, value: stored }, update: { value: stored } });
  cache.set(key, value);
}
export async function setConfigsAtomic(values: Record<string, string>): Promise<void> {
  await prisma.$transaction(Object.entries(values).map(([key, value]) => {
    const stored = isSecret(key) ? encryptSecret(value) : value;
    return prisma.runtimeConfig.upsert({ where: { key }, create: { key, value: stored }, update: { value: stored } });
  }));
  for (const [key, value] of Object.entries(values)) cache.set(key, value);
}
export async function clearConfig(key: string): Promise<void> {
  await prisma.runtimeConfig.deleteMany({ where: { key } });
  cache.delete(key);
}
