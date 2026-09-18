import React from "react";
import type { RemoteCapability } from "@hanoman/shared";
import { api, createApi } from "./client";

// SPEC-1216 · ADR-0165 §4/§11 · identitas "mesin yang sedang dilihat operator" — local (default,
// tanpa provider) atau remote (dialihkan dari device panel/dialog Start). Konsumen stream terminal
// jarak jauh (TerminalPane) milik turunan C; kontrak di sini murni, sudah diuji sekarang.
export type Instance =
  | { kind: "local" }
  | { kind: "remote"; deviceId: string; name: string; version: string; protocol: number; capabilities: RemoteCapability[] };

const LOCAL: Instance = { kind: "local" };
const InstanceCtx = React.createContext<Instance>(LOCAL);

export function InstanceProvider({ value, children }: { value: Instance; children: React.ReactNode }) {
  return <InstanceCtx.Provider value={value}>{children}</InstanceCtx.Provider>;
}
export function useInstance(): Instance {
  return React.useContext(InstanceCtx);
}
export function useApi(): ReturnType<typeof createApi> {
  const instance = useInstance();
  // Memo per deviceId: instance.kind === "local" mengembalikan singleton `api` yang sama persis
  // yang dipakai 61 importir lama, jadi tak ada perbedaan referensi untuk konsumen yang tak pernah
  // membaca instance.
  return React.useMemo(
    () => (instance.kind === "local" ? api : createApi({ base: `/api/devices/${instance.deviceId}/relay` })),
    [instance.kind === "local" ? "local" : instance.deviceId],
  );
}
export function useWsTarget(local: "events" | `terminal:${string}`): { url: string; ticketTarget: string } {
  const instance = useInstance();
  if (instance.kind === "local") return { url: `/api/${local === "events" ? "events" : `terminal/sessions/${local.slice("terminal:".length)}`}/ws`, ticketTarget: local };
  const path = local === "events" ? "events/ws" : `terminal/sessions/${local.slice("terminal:".length)}/ws`;
  return { url: `/api/devices/${instance.deviceId}/relay/${path}`, ticketTarget: `relay:${instance.deviceId}:${local}` };
}
