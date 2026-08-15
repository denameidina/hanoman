// Grup terminal: tiap grup memegang satu Layout dan grid-nya sendiri.
// Murni, tanpa React/DOM, agar teruji langsung — seperti terminal-layout.ts.
//
// Invarian "satu rumah": satu sesi terpasang di ≤1 sel, di ≤1 grup, lintas seluruh workspace.
// L.setCell hanya menjamin keunikan DI DALAM satu layout; lintas-grup ditegakkan di placeInActive.
import * as L from "./terminal-layout";
import {
  type TerminalWorkspaceV1,
  zTerminalWorkspaceV1,
} from "@hanoman/shared";

export type Group = { id: string; name: string; layout: L.Layout };
export type Workspace = { groups: Group[]; active: string };

const newGroup = (name: string): Group => ({ id: crypto.randomUUID(), name, layout: L.emptyLayout() });

export function emptyWorkspace(): Workspace {
  const g = newGroup("Utama");
  return { groups: [g], active: g.id };
}

// `active` bisa menunjuk grup yang sudah lenyap (state lama di localStorage) → jatuh ke grup pertama.
// groups tak pernah kosong: emptyWorkspace mengisi satu, removeGroup menolak membuang yang terakhir.
export const activeGroup = (ws: Workspace): Group =>
  ws.groups.find((g) => g.id === ws.active) ?? ws.groups[0]!;

export function addGroup(ws: Workspace, name: string): Workspace {
  const g = newGroup(name);
  return { groups: [...ws.groups, g], active: g.id };
}

export const renameGroup = (ws: Workspace, id: string, name: string): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => (g.id === id ? { ...g, name } : g)) });

// Grup terakhir tak bisa dihapus. Sesi di dalamnya tidak di-kill — ia lepas dari cells,
// jadi otomatis keluar dari placedIds dan muncul di tray.
export function removeGroup(ws: Workspace, id: string): Workspace {
  if (ws.groups.length === 1) return ws;
  const groups = ws.groups.filter((g) => g.id !== id);
  if (groups.length === ws.groups.length) return ws;
  return { groups, active: ws.active === id ? groups[0]!.id : ws.active };
}

export const selectGroup = (ws: Workspace, id: string): Workspace =>
  (ws.groups.some((g) => g.id === id) ? { ...ws, active: id } : ws);

export function mapActiveLayout(ws: Workspace, f: (l: L.Layout) => L.Layout): Workspace {
  const act = activeGroup(ws);
  return { ...ws, groups: ws.groups.map((g) => (g.id === act.id ? { ...g, layout: f(g.layout) } : g)) };
}

// Sapu `id` dari layout SEMUA grup lain lebih dulu, baru tulis di sel idx grup aktif.
// L.setCell dengan idx -1 (id tak ada di grup itu) mengembalikan layout apa adanya.
export function placeInActive(ws: Workspace, idx: number, id: string | null): Workspace {
  const act = activeGroup(ws);
  const swept = id === null ? ws.groups : ws.groups.map((g) =>
    g.id === act.id ? g : { ...g, layout: L.setCell(g.layout, g.layout.cells.indexOf(id), null) });
  return { ...ws, groups: swept.map((g) => (g.id === act.id ? { ...g, layout: L.setCell(g.layout, idx, id) } : g)) };
}

// Grid aktif penuh → workspace apa adanya (sesi tinggal di tray).
export function placeFirstEmptyInActive(ws: Workspace, id: string): Workspace {
  const idx = activeGroup(ws).layout.cells.indexOf(null);
  return idx === -1 ? ws : placeInActive(ws, idx, id);
}

// Lepas dari grup mana pun ia berada — tombol "lepas" ada di grid aktif, tapi menjaga
// invarian lebih murah daripada mengasumsikan sesi selalu ada di grup yang sedang dilihat.
export const detach = (ws: Workspace, id: string): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => ({ ...g, layout: L.setCell(g.layout, g.layout.cells.indexOf(id), null) })) });

// Tray = sessions − placedIds. Menutup kolom/baris & menghapus grup membuang sel,
// jadi sesinya jatuh ke tray tanpa satu baris kode pembersih pun.
export const placedIds = (ws: Workspace): Set<string> =>
  new Set(ws.groups.flatMap((g) => g.layout.cells.filter((c): c is string => c !== null)));

export const reconcileAll = (ws: Workspace, liveIds: Set<string>): Workspace =>
  ({ ...ws, groups: ws.groups.map((g) => ({ ...g, layout: L.reconcile(g.layout, liveIds) })) });

export const KEY = "hanoman.terminal.workspace";
export const LEGACY_KEY = "hanoman.terminal.layout"; // SPEC-158, satu layout tanpa grup

export type WorkspaceCache = {
  workspace: TerminalWorkspaceV1;
  revision: number;
  active: string;
};

export const toCanonical = (ws: Workspace): TerminalWorkspaceV1 =>
  zTerminalWorkspaceV1.parse({ version: 1, groups: ws.groups });

export function fromCanonical(canonical: TerminalWorkspaceV1, active?: string): Workspace {
  const groups = canonical.groups;
  const selected = active && groups.some((group) => group.id === active)
    ? active
    : groups[0]!.id;
  return { groups, active: selected };
}

function parseLegacyWorkspace(raw: string): { workspace: TerminalWorkspaceV1; active: string } | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return null;
    const legacy = value as { groups?: unknown; active?: unknown };
    const workspace = zTerminalWorkspaceV1.parse({ version: 1, groups: legacy.groups });
    return {
      workspace,
      active: typeof legacy.active === "string"
        && workspace.groups.some((group) => group.id === legacy.active)
        ? legacy.active
        : workspace.groups[0]!.id,
    };
  } catch {
    return null;
  }
}

export function readLegacy(): { workspace: TerminalWorkspaceV1; active: string } | null {
  try {
    const workspace = localStorage.getItem(KEY);
    if (workspace) return parseLegacyWorkspace(workspace);

    const layout = localStorage.getItem(LEGACY_KEY);
    if (!layout) return null;
    const parsedLayout = JSON.parse(layout) as unknown;
    const group = { id: crypto.randomUUID(), name: "Utama", layout: parsedLayout };
    const canonical = zTerminalWorkspaceV1.parse({ version: 1, groups: [group] });
    return { workspace: canonical, active: group.id };
  } catch {
    return null;
  }
}

export function clearLegacy(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage may be unavailable in private browsing modes.
  }
}

export const cacheKey = (userId: string): string =>
  `hanoman.terminal.workspace.v2.${encodeURIComponent(userId)}`;

export function readCache(userId: string): WorkspaceCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<WorkspaceCache>;
    const workspace = zTerminalWorkspaceV1.parse(value.workspace);
    if (!Number.isInteger(value.revision) || (value.revision ?? -1) < 0) return null;
    const active = typeof value.active === "string"
      && workspace.groups.some((group) => group.id === value.active)
      ? value.active
      : workspace.groups[0]!.id;
    return { workspace, revision: value.revision!, active };
  } catch {
    return null;
  }
}

export function writeCache(userId: string, cache: WorkspaceCache): void {
  try {
    const workspace = zTerminalWorkspaceV1.parse(cache.workspace);
    if (!Number.isInteger(cache.revision) || cache.revision < 0) return;
    const active = workspace.groups.some((group) => group.id === cache.active)
      ? cache.active
      : workspace.groups[0]!.id;
    localStorage.setItem(cacheKey(userId), JSON.stringify({ workspace, revision: cache.revision, active }));
  } catch {
    // Recovery cache is best-effort and never authoritative.
  }
}
