import { describe, it, expect } from "vitest";
import { readDroppedEntries } from "../src/screens/drop-entries";

const berkas = (name: string, body = "x") => new File([body], name);
function fileEntry(name: string, file: File) {
  return { isFile: true, isDirectory: false, name, file: (cb: (f: File) => void) => cb(file) };
}
function dirEntry(name: string, kids: unknown[]) {
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => {
      let sisa = kids;
      return { readEntries: (cb: (e: unknown[]) => void) => { const k = sisa; sisa = []; cb(k); } };
    },
  };
}

describe("readDroppedEntries", () => {
  it("membaca folder bersarang jadi path relatif", async () => {
    const a = berkas("a.ts"), b = berkas("b.ts");
    const dt = {
      items: [{ kind: "file", webkitGetAsEntry: () => dirEntry("src", [fileEntry("a.ts", a), dirEntry("ds", [fileEntry("b.ts", b)])]) }],
      files: [],
    } as unknown as DataTransfer;
    expect(await readDroppedEntries(dt)).toEqual([
      { path: "src/a.ts", file: a }, { path: "src/ds/b.ts", file: b },
    ]);
  });

  it("tanpa webkitGetAsEntry jatuh ke daftar berkas datar", async () => {
    const a = berkas("a.ts");
    const dt = { items: undefined, files: [a] } as unknown as DataTransfer;
    expect(await readDroppedEntries(dt)).toEqual([{ path: "a.ts", file: a }]);
  });
});
