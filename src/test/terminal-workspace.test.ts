import { describe, it, expect, beforeEach } from "vitest";
import * as W from "../src/screens/terminal-workspace";
import { addColumn } from "../src/screens/terminal-layout";

beforeEach(() => localStorage.clear());

// Dua grup, masing-masing 1×2, dengan sesi "a" di sel 0 grup pertama. Grup kedua yang aktif.
function twoGroups(): W.Workspace {
  let ws = W.emptyWorkspace();
  ws = W.mapActiveLayout(ws, addColumn);        // grup 1 → 1×2
  ws = W.placeInActive(ws, 0, "a");             // a di grup 1, sel 0
  ws = W.addGroup(ws, "Debug");                 // grup 2, jadi aktif
  ws = W.mapActiveLayout(ws, addColumn);        // grup 2 → 1×2
  return ws;
}

describe("terminal-workspace", () => {
  it("emptyWorkspace: satu grup 'Utama' berisi layout 1×1 dan menjadi aktif", () => {
    const ws = W.emptyWorkspace();
    expect(ws.groups).toHaveLength(1);
    expect(ws.groups[0]!.name).toBe("Utama");
    expect(ws.groups[0]!.layout).toEqual({ rows: 1, cols: 1, cells: [null] });
    expect(ws.active).toBe(ws.groups[0]!.id);
  });

  it("addGroup menambah grup kosong dan memindahkan fokus ke sana", () => {
    const ws = W.addGroup(W.emptyWorkspace(), "Debug");
    expect(ws.groups).toHaveLength(2);
    expect(W.activeGroup(ws).name).toBe("Debug");
    expect(W.activeGroup(ws).layout).toEqual({ rows: 1, cols: 1, cells: [null] });
  });

  it("activeGroup jatuh ke grup pertama bila `active` menunjuk grup yang lenyap", () => {
    const ws = W.emptyWorkspace();
    expect(W.activeGroup({ ...ws, active: "hantu" })).toBe(ws.groups[0]);
  });

  it("placeInActive menegakkan satu-rumah LINTAS grup", () => {
    const ws = twoGroups();                     // "a" ada di grup 1
    const moved = W.placeInActive(ws, 1, "a");  // taruh di grup 2 (aktif), sel 1
    expect(moved.groups[0]!.layout.cells).toEqual([null, null]); // sel lamanya dikosongkan
    expect(moved.groups[1]!.layout.cells).toEqual([null, "a"]);
    expect([...W.placedIds(moved)]).toEqual(["a"]);             // bukan dua kali
  });

  it("placeFirstEmptyInActive menaruh di lubang pertama grup aktif; penuh → no-op", () => {
    let ws = W.emptyWorkspace();                 // 1×1
    ws = W.placeFirstEmptyInActive(ws, "a");
    expect(W.activeGroup(ws).layout.cells).toEqual(["a"]);
    expect(W.placeFirstEmptyInActive(ws, "b")).toBe(ws);
  });

  it("detach melepas sesi dari grup mana pun ia berada, bukan hanya grup aktif", () => {
    const ws = twoGroups();                      // "a" di grup 1, grup 2 yang aktif
    expect(W.placedIds(W.detach(ws, "a")).size).toBe(0);
  });

  it("removeGroup membuang grid tapi sesinya lepas ke tray (bukan mati)", () => {
    const ws = twoGroups();
    const gone = W.removeGroup(ws, ws.groups[0]!.id);
    expect(gone.groups).toHaveLength(1);
    expect(W.placedIds(gone).size).toBe(0);      // "a" tak lagi tertempat → tray
  });

  it("removeGroup memindahkan fokus bila yang dihapus adalah grup aktif", () => {
    const ws = twoGroups();                      // grup 2 aktif
    const gone = W.removeGroup(ws, ws.active);
    expect(gone.active).toBe(gone.groups[0]!.id);
  });

  it("removeGroup pada grup terakhir → workspace apa adanya", () => {
    const ws = W.emptyWorkspace();
    expect(W.removeGroup(ws, ws.groups[0]!.id)).toBe(ws);
  });

  it("removeGroup id tak dikenal → workspace apa adanya", () => {
    const ws = twoGroups();
    expect(W.removeGroup(ws, "hantu")).toBe(ws);
  });

  it("renameGroup mengganti nama grup yang ditunjuk saja", () => {
    const ws = twoGroups();
    expect(W.renameGroup(ws, ws.groups[0]!.id, "Backlog").groups.map((g) => g.name))
      .toEqual(["Backlog", "Debug"]);
    expect(W.renameGroup(ws, "hantu", "y").groups.map((g) => g.name))
      .toEqual(["Utama", "Debug"]);   // id tak dikenal → tak ada yang berubah
  });

  it("selectGroup memindahkan fokus; id tak dikenal → workspace apa adanya", () => {
    const ws = twoGroups();                       // grup 2 aktif
    expect(W.selectGroup(ws, ws.groups[0]!.id).active).toBe(ws.groups[0]!.id);
    expect(W.selectGroup(ws, "hantu")).toBe(ws);
  });

  it("mapActiveLayout hanya menyentuh layout grup aktif", () => {
    const ws = twoGroups();                      // grup 2 aktif, keduanya 1×2
    const grown = W.mapActiveLayout(ws, addColumn);
    expect(grown.groups[0]!.layout.cols).toBe(2);
    expect(grown.groups[1]!.layout.cols).toBe(3);
  });

  it("reconcileAll mengosongkan sesi mati di SEMUA grup", () => {
    let ws = twoGroups();                        // "a" di grup 1
    ws = W.placeInActive(ws, 0, "b");            // "b" di grup 2
    const live = W.reconcileAll(ws, new Set(["b"]));
    expect(live.groups[0]!.layout.cells).toEqual([null, null]);
    expect(live.groups[1]!.layout.cells).toEqual(["b", null]);
  });

  it("toCanonical/fromCanonical memisahkan active lokal tanpa mengubah grup", () => {
    const ws = twoGroups();
    const canonical = W.toCanonical(ws);
    expect(canonical).toEqual({ version: 1, groups: ws.groups });
    expect(W.fromCanonical(canonical, ws.active)).toEqual(ws);
    expect(W.fromCanonical(canonical, "hantu").active).toBe(ws.groups[0]!.id);
  });

  it("readLegacy memvalidasi workspace lama tanpa menghapusnya sebelum server menerima seed", () => {
    const ws = twoGroups();
    localStorage.setItem(W.KEY, JSON.stringify(ws));
    expect(W.readLegacy()).toEqual({ workspace: W.toCanonical(ws), active: ws.active });
    expect(localStorage.getItem(W.KEY)).not.toBeNull();
  });

  it("readLegacy memigrasikan key layout lama di memori tanpa menulis storage", () => {
    const legacy = { rows: 1, cols: 2, cells: ["a", null] };
    localStorage.setItem(W.LEGACY_KEY, JSON.stringify(legacy));
    const migrated = W.readLegacy()!;
    expect(migrated.workspace.groups).toHaveLength(1);
    expect(migrated.workspace.groups[0]!.name).toBe("Utama");
    expect(migrated.workspace.groups[0]!.layout).toEqual(legacy);
    expect(migrated.active).toBe(migrated.workspace.groups[0]!.id);
    expect(localStorage.getItem(W.LEGACY_KEY)).not.toBeNull();
    expect(localStorage.getItem(W.KEY)).toBeNull();
  });

  it("readLegacy: workspace lama menang atas layout yang lebih tua", () => {
    const ws = W.emptyWorkspace();
    localStorage.setItem(W.KEY, JSON.stringify(ws));
    localStorage.setItem(W.LEGACY_KEY, JSON.stringify({ rows: 9, cols: 9, cells: [] }));
    expect(W.readLegacy()).toEqual({ workspace: W.toCanonical(ws), active: ws.active });
  });

  it("clearLegacy baru membuang kedua key sesudah bootstrap server selesai", () => {
    localStorage.setItem(W.KEY, "{}");
    localStorage.setItem(W.LEGACY_KEY, "{}");
    W.clearLegacy();
    expect(localStorage.getItem(W.KEY)).toBeNull();
    expect(localStorage.getItem(W.LEGACY_KEY)).toBeNull();
  });

  it("cache recovery tervalidasi dan terisolasi per user", () => {
    const ws = twoGroups();
    const cached = { workspace: W.toCanonical(ws), revision: 7, active: ws.active };
    W.writeCache("u1", cached);
    expect(W.readCache("u1")).toEqual(cached);
    expect(W.readCache("u2")).toBeNull();

    localStorage.setItem(W.cacheKey("bad"), JSON.stringify({ ...cached, revision: -1 }));
    expect(W.readCache("bad")).toBeNull();
  });

  it("legacy/cache rusak dan storage kosong jatuh ke null tanpa melempar", () => {
    localStorage.setItem(W.KEY, "{not-json");
    expect(W.readLegacy()).toBeNull();
    expect(W.readCache("u1")).toBeNull();
  });
});
