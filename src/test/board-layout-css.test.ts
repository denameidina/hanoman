// @vitest-environment node
// QA Chrome nyata (P1) · papan kolom Backlog dan Tim tampil menumpuk full-width di tablet dan desktop,
// karena `.hn-bl-board` tak punya `display:flex` sementara kolomnya bertetap lebar (`flex: 0 0 248px`).
// jsdom tak memuat stylesheet dan tak menghitung tata letak, jadi yang diikat di sini deklarasinya:
// papan kolom harus flex (atau grid), dan setiap kelas kolom bertetap lebar punya papan induk seperti itu.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../src");
const STYLES = join(SRC, "screens/styles");
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = [
  readFileSync(join(SRC, "app.css"), "utf8"),
  ...readdirSync(STYLES).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(STYLES, f), "utf8")),
].map(stripComments).join("\n");

type Block = { prelude: string; body: string };

// Blok tingkat-atas (selektor atau at-rule) beserta isinya; blok bersarang seperti @media ikut di `body`.
function blocks(source: string): Block[] {
  const out: Block[] = [];
  let depth = 0;
  let stmt = 0;
  let bodyStart = 0;
  let prelude = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) {
        prelude = source.slice(stmt, i).split(";").pop()!.trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        out.push({ prelude, body: source.slice(bodyStart, i) });
        stmt = i + 1;
      }
    }
  }
  return out;
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of body.split(";")) {
    const at = d.indexOf(":");
    if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
  }
  return out;
}

// Deklarasi gabungan semua aturan di luar @media yang memuat selektor persis `selector`.
function baseOf(selector: string, source: string = CSS): Record<string, string> {
  const acc: Record<string, string> = {};
  for (const b of blocks(source)) {
    if (b.prelude.startsWith("@")) continue;
    if (b.prelude.split(",").map((s) => s.trim()).includes(selector)) Object.assign(acc, declarations(b.body));
  }
  return acc;
}

// Deklarasi `selector` di dalam @media yang preludenya memuat `query`.
function mediaOf(query: string, selector: string): Record<string, string> {
  const acc: Record<string, string> = {};
  for (const b of blocks(CSS)) {
    if (b.prelude.startsWith("@media") && b.prelude.includes(query)) Object.assign(acc, baseOf(selector, b.body));
  }
  return acc;
}

// Selektor tunggal (bukan modifier `--`) di luar @media yang cocok dengan pola.
function selectorsMatching(pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const b of blocks(CSS)) {
    if (b.prelude.startsWith("@")) continue;
    for (const s of b.prelude.split(",").map((x) => x.trim())) if (pattern.test(s)) found.add(s);
  }
  return [...found];
}

const BOARD = /^\.hn-[a-z0-9]+(?:-[a-z0-9]+)*-board$/;
const FIXED_COL = /^\.hn-([a-z0-9]+(?:-[a-z0-9]+)*)-col$/;
const isTrack = (display: string | undefined) => display === "flex" || display === "grid";

describe("papan Backlog dan Tim: kolom tersusun mendatar di tablet dan desktop", () => {
  it(".hn-bl-board flex mendatar dan menggulir mendatar sendiri", () => {
    const d = baseOf(".hn-bl-board");
    expect(d.display).toBe("flex");
    expect(d["overflow-x"]).toBe("auto");
  });

  it(".hn-tm-board flex mendatar dan menggulir mendatar sendiri", () => {
    const d = baseOf(".hn-tm-board");
    expect(d.display).toBe("flex");
    expect(d["overflow-x"]).toBe("auto");
  });

  it("di ponsel (<768px) kolom Backlog tetap menumpuk satu kolom, tak mendatar", () => {
    const d = mediaOf("max-width: 767px", ".hn-bl-board");
    expect(d["flex-direction"]).toBe("column");
  });
});

describe("kontrak umum: setiap papan kolom dan setiap kolom bertetap lebar punya induk flex", () => {
  const boards = selectorsMatching(BOARD);

  it("papan yang dikenali memang ada (agar test tak lolos tanpa isi)", () => {
    expect(boards).toEqual(expect.arrayContaining([".hn-bl-board", ".hn-tm-board"]));
  });

  it.each(boards)("%s mendeklarasikan display flex atau grid", (board) => {
    expect(isTrack(baseOf(board).display)).toBe(true);
  });

  // Kolom ber-basis px: bertetap (`0 0 Npx`) atau lentur dengan basis px (`1 1 Npx`, mis. kolom Tim).
  const fixedCols = selectorsMatching(FIXED_COL).filter((sel) => /^[01] [01] \d+px$/.test(baseOf(sel).flex ?? ""));

  it("kolom ber-basis px (flex: 0|1 0|1 Npx) terdeteksi untuk Backlog dan Tim", () => {
    expect(fixedCols).toEqual(expect.arrayContaining([".hn-bl-col", ".hn-tm-col"]));
  });

  it.each(fixedCols)("%s punya papan induk flex/grid dengan prefiks yang sama", (col) => {
    const prefix = FIXED_COL.exec(col)![1];
    expect(isTrack(baseOf(`.hn-${prefix}-board`).display)).toBe(true);
  });
});

describe("papan Tim: kolom lentur muat di 1280 dan judul kartu memenuhi area sentuh 24 px", () => {
  it("kolom Tim lentur dengan basis 220 px dan lebar minimum 200 px (4 kolom muat di desktop 1280)", () => {
    const d = baseOf(".hn-tm-col");
    expect(d.flex).toBe("1 1 220px");
    expect(d["min-width"]).toBe("200px");
  });

  it("judul kartu Tim punya padding vertikal (tinggi teks ~19 px + 2×4 px ≥ 24 px)", () => {
    expect(baseOf(".hn-tm-title").padding).toBe("var(--space-1) 0");
  });

  it("judul kartu Tim setinggi 44 px di pointer kasar dan ponsel", () => {
    expect(mediaOf("pointer: coarse", ".hn-tm-title")["min-height"]).toBe("var(--touch-target)");
  });
});
