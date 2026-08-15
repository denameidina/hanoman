import { useCallback, useEffect, useRef, useState } from "react";
import {
  type TerminalWorkspaceSnapshot,
  sameTerminalWorkspace,
  zTerminalWorkspaceSnapshot,
} from "@hanoman/shared";
import { api, ApiError } from "../api/client";
import * as W from "./terminal-workspace";

export type TerminalWorkspaceStatus = "loading" | "ready" | "recovering" | "conflict";

export type TerminalWorkspaceController = {
  workspace: W.Workspace;
  status: TerminalWorkspaceStatus;
  message: string | null;
  writable: boolean;
  mutate(change: (workspace: W.Workspace) => W.Workspace): Promise<boolean>;
  setActive(groupId: string): void;
  refresh(): Promise<void>;
};

function conflictCurrent(error: unknown): TerminalWorkspaceSnapshot | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const detail = error.detail as { code?: unknown; current?: unknown } | null;
  if (detail?.code !== "revision-conflict") return null;
  const parsed = zTerminalWorkspaceSnapshot.safeParse(detail.current);
  return parsed.success ? parsed.data : null;
}

export function useTerminalWorkspace(userId: string): TerminalWorkspaceController {
  const initial = useRef<W.Workspace | null>(null);
  if (!initial.current) initial.current = W.emptyWorkspace();
  const [workspace, setWorkspace] = useState(initial.current);
  const [status, setStatus] = useState<TerminalWorkspaceStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [writable, setWritable] = useState(false);
  const workspaceRef = useRef(workspace);
  const revisionRef = useRef(0);
  const writableRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);

  const replaceWorkspace = useCallback((next: W.Workspace): void => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);

  const setCanWrite = useCallback((next: boolean): void => {
    writableRef.current = next;
    setWritable(next);
  }, []);

  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(operation, operation);
    queueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  const adopt = useCallback((
    snapshot: TerminalWorkspaceSnapshot,
    nextStatus: TerminalWorkspaceStatus = "ready",
    nextMessage: string | null = null,
    activeHint: string = workspaceRef.current.active,
  ): void => {
    const next = snapshot.workspace
      ? W.fromCanonical(snapshot.workspace, activeHint)
      : W.emptyWorkspace();
    revisionRef.current = snapshot.revision;
    replaceWorkspace(next);
    setStatus(nextStatus);
    setMessage(nextMessage);
    setCanWrite(true);
    if (snapshot.workspace) {
      W.writeCache(userId, { workspace: snapshot.workspace, revision: snapshot.revision, active: next.active });
    }
  }, [replaceWorkspace, setCanWrite, userId]);

  const recover = useCallback((error: unknown): void => {
    const cached = W.readCache(userId);
    if (cached) {
      revisionRef.current = cached.revision;
      replaceWorkspace(W.fromCanonical(cached.workspace, cached.active));
    }
    setCanWrite(false);
    setStatus("recovering");
    setMessage(error instanceof Error ? error.message : "Layout server belum tersambung");
  }, [replaceWorkspace, setCanWrite, userId]);

  const refresh = useCallback((): Promise<void> => enqueue(async () => {
    try {
      adopt(await api.getTerminalWorkspace());
    } catch (error) {
      recover(error);
    }
  }), [adopt, enqueue, recover]);

  useEffect(() => {
    const generation = ++generationRef.current;
    setStatus("loading");
    setMessage(null);
    setCanWrite(false);
    void enqueue(async () => {
      try {
        const snapshot = await api.getTerminalWorkspace();
        if (generation !== generationRef.current) return;
        if (snapshot.workspace) {
          adopt(snapshot);
          W.clearLegacy();
          return;
        }

        const legacy = W.readLegacy();
        if (!legacy) {
          adopt(snapshot);
          return;
        }

        try {
          const seeded = await api.putTerminalWorkspace({
            baseRevision: snapshot.revision,
            workspace: legacy.workspace,
          });
          if (generation !== generationRef.current) return;
          replaceWorkspace(W.fromCanonical(seeded.workspace!, legacy.active));
          revisionRef.current = seeded.revision;
          W.writeCache(userId, {
            workspace: seeded.workspace!,
            revision: seeded.revision,
            active: legacy.active,
          });
          W.clearLegacy();
          setStatus("ready");
          setMessage(null);
          setCanWrite(true);
        } catch (error) {
          const current = conflictCurrent(error);
          if (current?.workspace) {
            adopt(current, "conflict", "Layout server lebih baru; layout lokal lama tidak diunggah");
            W.clearLegacy();
          } else {
            recover(error);
          }
        }
      } catch (error) {
        if (generation === generationRef.current) recover(error);
      }
    });
    return () => { generationRef.current += 1; };
  }, [adopt, enqueue, recover, replaceWorkspace, setCanWrite, userId]);

  useEffect(() => {
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const mutate = useCallback((change: (current: W.Workspace) => W.Workspace): Promise<boolean> =>
    enqueue(async () => {
      if (!writableRef.current) return false;
      const next = change(workspaceRef.current);
      let canonical;
      let currentCanonical;
      try {
        canonical = W.toCanonical(next);
        currentCanonical = W.toCanonical(workspaceRef.current);
      } catch {
        setStatus("conflict");
        setMessage("Layout tidak valid dan tidak disimpan");
        return false;
      }
      if (sameTerminalWorkspace(canonical, currentCanonical)) return true;

      try {
        adopt(await api.putTerminalWorkspace({ baseRevision: revisionRef.current, workspace: canonical }), "ready", null, next.active);
        return true;
      } catch (error) {
        const current = conflictCurrent(error);
        if (!current?.workspace) {
          recover(error);
          return false;
        }

        const reapplied = change(W.fromCanonical(current.workspace, workspaceRef.current.active));
        try {
          const saved = await api.putTerminalWorkspace({
            baseRevision: current.revision,
            workspace: W.toCanonical(reapplied),
          });
          adopt(saved, "conflict", "Layout berubah di perangkat lain; perubahan ini diterapkan ulang", reapplied.active);
          return true;
        } catch (retryError) {
          if (!conflictCurrent(retryError) && !(retryError instanceof ApiError && retryError.status === 409)) {
            recover(retryError);
            return false;
          }
          try {
            adopt(
              await api.getTerminalWorkspace(),
              "conflict",
              "Layout berubah lagi di perangkat lain; state terbaru dimuat",
            );
          } catch (refreshError) {
            recover(refreshError);
          }
          return false;
        }
      }
    }), [adopt, enqueue, recover]);

  const setActive = useCallback((groupId: string): void => {
    const next = W.selectGroup(workspaceRef.current, groupId);
    replaceWorkspace(next);
    const canonical = W.toCanonical(next);
    W.writeCache(userId, { workspace: canonical, revision: revisionRef.current, active: next.active });
  }, [replaceWorkspace, userId]);

  return { workspace, status, message, writable, mutate, setActive, refresh };
}
