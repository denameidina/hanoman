import { effectiveStr } from "../config";
import { fetchTransport, type Transport } from "./sync-client";

// ADR-0203 · token GitHub untuk operasi git hanoman. Sumber: `GITHUB_TOKEN` instance ini
// (RuntimeConfig, terenkripsi), lalu — di client — hub lewat device token yang SUDAH dipakai sync.
// Tidak disimpan ulang di client: dicabutnya token di hub langsung berlaku di sana.
export const localGitToken = (): string | null => effectiveStr("GITHUB_TOKEN")?.trim() || null;

function clientTransport(): Transport | null {
  const base = effectiveStr("SYNC_SERVER_URL");
  const device = effectiveStr("SYNC_DEVICE_TOKEN");
  return base && device ? fetchTransport(base, device) : null;
}

/** Gagal apa pun (hub offline, 401, bentuk tak dikenal) = `null`; pemanggil yang memilih galatnya. */
export async function hubGitToken(transport?: Transport): Promise<string | null> {
  const t = transport ?? clientTransport();
  if (!t) return null;
  try {
    const res = await t("GET", "/api/sync/git-credential");
    const token = (res.body as { token?: unknown } | null)?.token;
    return res.status === 200 && typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

export async function resolveGitToken(
  deps: { hub?: () => Promise<string | null> } = {},
): Promise<string | null> {
  return localGitToken() ?? (await (deps.hub ?? hubGitToken)());
}
