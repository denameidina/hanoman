import type { LaunchStatus, Scheduler } from "@hanoman/shared";

export type LaunchPane = {
  id: string; exited: boolean; launchClass?: "agent" | "terminal";
  specId?: string; flow?: string; cwd?: string; projectId?: string;
};
export type HostLoad = { platform: string; loadAverage: number; cores: number };
export type LaunchGateDeps<P extends LaunchPane = LaunchPane> = {
  listPanes(): Promise<P[]>;
  config(): Promise<Scheduler>;
  host(): HostLoad;
};

export function launchStatus(panes: LaunchPane[], cfg: Scheduler, host: HostLoad): LaunchStatus {
  const live = panes.filter((p) => !p.exited);
  const available = host.platform !== "win32" && Number.isFinite(host.loadAverage)
    && host.loadAverage >= 0 && Number.isFinite(host.cores) && host.cores > 0;
  return {
    enabled: cfg.launchGuard.enabled,
    liveCount: live.length,
    liveAgentCount: live.filter((p) => p.launchClass ? p.launchClass === "agent"
      : !!(p.specId || p.flow || /[\\/]\.worktrees[\\/]/.test(p.cwd ?? "")
        || p.projectId?.startsWith("telegram:") || p.projectId?.startsWith("vps:"))).length,
    maxConcurrent: cfg.maxConcurrent,
    loadPerCore: available ? host.loadAverage / host.cores : null,
    maxLoadPerCore: cfg.launchGuard.maxLoadPerCore,
    loadStatus: host.platform === "win32" ? "unsupported" : available ? "available" : "unavailable",
  };
}

export class LaunchAdmissionError extends Error {
  readonly statusCode = 409;
  constructor(readonly kind: "capacity" | "host-load", readonly admission: LaunchStatus) {
    const a = admission;
    const load = a.loadPerCore === null ? `tidak tersedia (${a.loadStatus})` : a.loadPerCore.toFixed(2);
    super(`${kind === "capacity" ? "Cap sesi penuh" : "Beban host melampaui ambang"}: `
      + `${a.liveAgentCount} agen, ${a.liveCount} sesi hidup / cap ${a.maxConcurrent}; `
      + `load/core ${load} / ambang ${a.maxLoadPerCore}. Tunggu atau gunakan force.`);
  }
}

export function createLaunchGate<P extends LaunchPane>(deps: LaunchGateDeps<P>) {
  // ADR-0161: reservasi hanya sepanjang check→spawn. Pane tmux tetap sumber hitungan;
  // tidak ada counter yang harus direkonsiliasi sesudah kegagalan atau restart.
  let tail = Promise.resolve();
  return {
    async run<T>(opts: { id?: string; force?: boolean; exempt?: boolean }, start: () => Promise<T>, reuse: (pane: P) => T): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const panes = await deps.listPanes();
        const live = opts.id ? panes.find((p) => p.id === opts.id && !p.exited) : undefined;
        if (live) return reuse(live);
        if (!opts.exempt) {
          const status = launchStatus(panes, await deps.config(), deps.host());
          if (status.enabled && !opts.force) {
            if (status.liveCount >= status.maxConcurrent) throw new LaunchAdmissionError("capacity", status);
            if (status.loadPerCore !== null && status.loadPerCore > status.maxLoadPerCore)
              throw new LaunchAdmissionError("host-load", status);
          }
        }
        return await start();
      } finally { release(); }
    },
  };
}
