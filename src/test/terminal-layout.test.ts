import { describe, it, expect } from "vitest";
import {
  emptyLayout, addRow, addColumn, removeRow, removeColumn, setCell, placeFirstEmpty, reconcile,
  resizeTracks, resizeCol, resizeRow, stepResizeCol, stepResizeRow, resetColSizes, resetRowSizes,
  trackPercent, MIN_TRACK_RATIO, RESIZE_STEP, RESIZE_STEP_BIG, type Layout,
} from "../src/screens/terminal-layout";

describe("terminal-layout", () => {
  it("emptyLayout: 1×1 satu sel kosong", () => {
    expect(emptyLayout()).toEqual({ rows: 1, cols: 1, cells: [null] });
  });

  it("addRow meng-append cols sel & tak menggeser sel lama", () => {
    expect(addRow({ rows: 1, cols: 2, cells: ["a", "b"] }))
      .toEqual({ rows: 2, cols: 2, cells: ["a", "b", null, null] });
  });

  it("addColumn me-rebuild pemetaan baris-mayor (2×2 → 2×3)", () => {
    // baris0=[a,b], baris1=[c,d] → baris0=[a,b,null], baris1=[c,d,null]
    expect(addColumn({ rows: 2, cols: 2, cells: ["a", "b", "c", "d"] }))
      .toEqual({ rows: 2, cols: 3, cells: ["a", "b", null, "c", "d", null] });
  });

  it("removeRow memotong baris yang ditunjuk & tak menggeser sel lain", () => {
    // baris0=[a,b], baris1=[c,d] → buang baris 0
    expect(removeRow({ rows: 2, cols: 2, cells: ["a", "b", "c", "d"] }, 0))
      .toEqual({ rows: 1, cols: 2, cells: ["c", "d"] });
  });

  it("removeRow pada rows===1 → layout apa adanya (grid tak boleh nol baris)", () => {
    const l = { rows: 1, cols: 2, cells: ["a", "b"] };
    expect(removeRow(l, 0)).toBe(l);
  });

  it("removeRow index di luar rentang → layout apa adanya", () => {
    const l = { rows: 2, cols: 1, cells: ["a", "b"] };
    expect(removeRow(l, 2)).toBe(l);
    expect(removeRow(l, -1)).toBe(l);
  });

  it("removeColumn me-rebuild pemetaan baris-mayor (2×3 → 2×2, buang kolom tengah)", () => {
    // baris0=[a,b,c], baris1=[d,e,f] → buang kolom 1 → baris0=[a,c], baris1=[d,f]
    expect(removeColumn({ rows: 2, cols: 3, cells: ["a", "b", "c", "d", "e", "f"] }, 1))
      .toEqual({ rows: 2, cols: 2, cells: ["a", "c", "d", "f"] });
  });

  it("removeColumn pada cols===1 → layout apa adanya", () => {
    const l = { rows: 2, cols: 1, cells: ["a", "b"] };
    expect(removeColumn(l, 0)).toBe(l);
  });

  it("removeColumn index di luar rentang → layout apa adanya", () => {
    const l = { rows: 1, cols: 2, cells: ["a", "b"] };
    expect(removeColumn(l, 2)).toBe(l);
    expect(removeColumn(l, -1)).toBe(l);
  });

  it("setCell menegakkan satu sesi ≤ satu sel (pindah, bukan duplikat)", () => {
    expect(setCell({ rows: 1, cols: 2, cells: ["a", null] }, 1, "a").cells).toEqual([null, "a"]);
  });

  it("setCell idx di luar rentang → layout apa adanya", () => {
    const l = { rows: 1, cols: 1, cells: ["a"] };
    expect(setCell(l, -1, null)).toBe(l);
  });

  it("setCell dengan null hanya mengosongkan idx", () => {
    expect(setCell({ rows: 1, cols: 2, cells: ["a", "b"] }, 0, null).cells).toEqual([null, "b"]);
  });

  it("placeFirstEmpty menaruh di lubang pertama; penuh → no-op", () => {
    expect(placeFirstEmpty({ rows: 1, cols: 2, cells: ["a", null] }, "b").cells).toEqual(["a", "b"]);
    const full = { rows: 1, cols: 1, cells: ["a"] };
    expect(placeFirstEmpty(full, "b")).toBe(full);
  });

  it("reconcile mengosongkan sesi yang lenyap, mempertahankan yang hidup", () => {
    expect(reconcile({ rows: 1, cols: 2, cells: ["a", "b"] }, new Set(["a"])).cells).toEqual(["a", null]);
  });

  it("addRow/addColumn menyertakan bobot 1 untuk track baru bila sizes sudah ada", () => {
    const l: Layout = { rows: 1, cols: 2, cells: ["a", "b"], colSizes: [2, 1], rowSizes: [1] };
    expect(addColumn(l).colSizes).toEqual([2, 1, 1]);
    expect(addRow(l).rowSizes).toEqual([1, 1]);
  });

  it("addRow/addColumn tak menambah sizes bila layout belum pernah di-resize", () => {
    const l = emptyLayout();
    expect(addColumn(l).colSizes).toBeUndefined();
    expect(addRow(l).rowSizes).toBeUndefined();
  });

  it("removeColumn/removeRow membuang entri sizes yang cocok dengan track yang dibuang", () => {
    const l: Layout = { rows: 1, cols: 3, cells: ["a", "b", "c"], colSizes: [1, 2, 3] };
    expect(removeColumn(l, 1).colSizes).toEqual([1, 3]);
    const l2: Layout = { rows: 3, cols: 1, cells: ["a", "b", "c"], rowSizes: [1, 2, 3] };
    expect(removeRow(l2, 0).rowSizes).toEqual([2, 3]);
  });

  it("resizeTracks menggeser batas antar dua track sambil mempertahankan jumlah keduanya", () => {
    expect(resizeTracks([1, 1], 0, 0.2)).toEqual([1.2, 0.8]);
    expect(resizeTracks([1, 1, 1], 1, -0.3)).toEqual([1, 0.7, 1.3]);
  });

  it("resizeTracks mengembalikan referensi sama persis bila delta 0 atau index di luar rentang", () => {
    const sizes = [1, 1];
    expect(resizeTracks(sizes, 0, 0)).toBe(sizes);
    expect(resizeTracks(sizes, -1, 0.2)).toBe(sizes);
    expect(resizeTracks(sizes, 1, 0.2)).toBe(sizes);   // index+1 di luar rentang utk 2 track
  });

  it("resizeTracks clamp ke MIN_TRACK_RATIO — track tak pernah menyusut ke 0/negatif", () => {
    // 2 track @1 → rata-rata 1, ambang 0.3 (~15% dari total 2)
    const shrunk = resizeTracks([1, 1], 0, -10);
    expect(shrunk[0]).toBeCloseTo(0.3, 10);
    expect(shrunk[1]).toBeCloseTo(1.7, 10);
    const grown = resizeTracks([1, 1], 0, 10);
    expect(grown[0]).toBeCloseTo(1.7, 10);
    expect(grown[1]).toBeCloseTo(0.3, 10);
  });

  it("resizeTracks pada grid banyak track: default merata tak pernah dianggap melanggar ambang", () => {
    const twelve = Array(12).fill(1);
    // Rata-rata 1, ambang 0.3 — tiap track default (1) jauh di atas ambang, jadi delta kecil
    // seharusnya tak terpotong.
    expect(resizeTracks(twelve, 0, 0.1)[0]).toBeCloseTo(1.1, 10);
  });

  it("resizeCol/resizeRow menulis sizes hanya bila hasilnya berubah (no-op → referensi layout sama)", () => {
    const l: Layout = { rows: 1, cols: 2, cells: ["a", "b"] };
    expect(resizeCol(l, 0, 0)).toBe(l);
    const resized = resizeCol(l, 0, 0.2);
    expect(resized).not.toBe(l);
    expect(resized.colSizes).toEqual([1.2, 0.8]);
    expect(l.colSizes).toBeUndefined();   // input tak dimutasi

    const l2: Layout = { rows: 2, cols: 1, cells: ["a", "b"] };
    expect(resizeRow(l2, 0, 0)).toBe(l2);
    expect(resizeRow(l2, 0, 0.3).rowSizes).toEqual([1.3, 0.7]);
  });

  it("stepResizeCol/stepResizeRow melangkah RESIZE_STEP (panah) / RESIZE_STEP_BIG (Shift+panah)", () => {
    const closeTo = (sizes: number[] | undefined, expected: number[]) =>
      sizes!.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 10));
    const l: Layout = { rows: 1, cols: 2, cells: ["a", "b"] };
    closeTo(stepResizeCol(l, 0, 1).colSizes, [1 + RESIZE_STEP * 2, 1 - RESIZE_STEP * 2]);
    closeTo(stepResizeCol(l, 0, -1).colSizes, [1 - RESIZE_STEP * 2, 1 + RESIZE_STEP * 2]);
    closeTo(stepResizeCol(l, 0, 1, true).colSizes, [1 + RESIZE_STEP_BIG * 2, 1 - RESIZE_STEP_BIG * 2]);
    const l2: Layout = { rows: 2, cols: 1, cells: ["a", "b"] };
    closeTo(stepResizeRow(l2, 0, 1).rowSizes, [1 + RESIZE_STEP * 2, 1 - RESIZE_STEP * 2]);
  });

  it("resetColSizes/resetRowSizes membuang field sizes, no-op bila belum ada", () => {
    const l: Layout = { rows: 1, cols: 2, cells: ["a", "b"], colSizes: [1.5, 0.5], rowSizes: [1] };
    const reset = resetColSizes(l);
    expect(reset.colSizes).toBeUndefined();
    expect(reset.rowSizes).toEqual([1]);   // sumbu lain tak tersentuh
    expect(resetRowSizes(reset).rowSizes).toBeUndefined();
    const plain = emptyLayout();
    expect(resetColSizes(plain)).toBe(plain);
  });

  it("trackPercent konsisten dengan batas resizeTracks (min/max saling melengkapi 100)", () => {
    const p = trackPercent([1, 1], 0);
    expect(p.now).toBe(50);
    expect(p.min + p.max).toBe(100);
    expect(p.min).toBeCloseTo(15, 0);   // 2 track → ambang ~15% dari pasangan
  });
});
