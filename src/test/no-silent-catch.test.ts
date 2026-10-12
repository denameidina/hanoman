// Audit UI/UX 2026-10 · Fase 2F butir 6: `.catch(() => {})` kosong menelan galat tanpa jejak.
// Kebijakan (design-system.md): galat ditampilkan (failureMessage / toast / state inline). Catch yang
// memang tak perlu tindakan boleh kosong HANYA bila badannya memuat komentar alasan yang bermakna.
// Pemindai ini menolak catch kosong yang tak punya komentar seperti itu.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCAN_DIRS = ["src/src/screens", "src/src/portal"];

// Alasan harus lebih panjang dari ini; "tanpa alasan" atau "ok" tak lolos.
const MIN_REASON_CHARS = 20;

// Pengecualian eksplisit (berkas + alasan). Sengaja kosong: tiap catch kosong di layar harus
// menampilkan galat atau menyebut alasan di badannya. Entri di sini harus tetap punya catch kosong
// (lihat test "allowlist tak basi") supaya daftar tak membusuk.
const ALLOWLIST: { file: string; reason: string }[] = [];

/** Ganti komentar dengan spasi (panjang & baris tetap), supaya indeks tetap sama dengan sumber. */
function blankComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));
}

/** Indeks `}` yang menutup `{` di `open`, dihitung di teks yang komentarnya sudah dikosongkan. */
function matchingBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

export type EmptyCatch = { line: number; reason: string | null };

/**
 * Cari `.catch(() => { … })` yang badannya hanya komentar/spasi. `reason` = gabungan teks komentar
 * di badan itu (null bila tak ada komentar). Komentar di luar badan (mis. teks dokumentasi) tak dihitung.
 */
export function findEmptyCatches(src: string): EmptyCatch[] {
  const code = blankComments(src);
  const found: EmptyCatch[] = [];
  const re = /\.catch\(\s*\(\s*\)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    const close = matchingBrace(code, open);
    if (close < 0) continue;
    if (code.slice(open + 1, close).trim() !== "") continue;   // ada statement → bukan catch kosong
    const body = src.slice(open + 1, close);
    const comments = [...body.matchAll(/\/\*([\s\S]*?)\*\/|\/\/([^\n]*)/g)]
      .map((c) => (c[1] ?? c[2] ?? "").trim())
      .filter(Boolean);
    found.push({ line: src.slice(0, m.index).split("\n").length, reason: comments.join(" ") || null });
  }
  return found;
}

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listSources(p));
    else if (/\.(tsx?|mts)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap(listSources);
const lacksReason = (c: EmptyCatch) => !c.reason || c.reason.length < MIN_REASON_CHARS;

describe("pemindai catch kosong (audit 2F·6)", () => {
  // Pemindai yang diam-diam tak menemukan apa pun memberi gejala yang sama dengan "semua bersih".
  it("uji pemindai: mengenali catch kosong dan membedakan yang beralasan", () => {
    expect(findEmptyCatches("p.catch(() => {})")).toEqual([{ line: 1, reason: null }]);
    expect(findEmptyCatches("p.catch(() => { })").length).toBe(1);
    expect(findEmptyCatches("p.catch(() => {\n  // tanpa alasan\n})")).toEqual([{ line: 1, reason: "tanpa alasan" }]);
    expect(findEmptyCatches("p.catch(() => { /* galat sudah ditampilkan di tempat lain */ })"))
      .toEqual([{ line: 1, reason: "galat sudah ditampilkan di tempat lain" }]);
    expect(findEmptyCatches("p.catch(() => { setErr(String(e)); })")).toEqual([]);
    // Teks dokumentasi yang menyebut bentuk ini di dalam komentar bukan kode.
    expect(findEmptyCatches("// jangan tulis `.catch(() => {})` di sini\nconst x = 1;")).toEqual([]);
    // Alasan terlalu pendek dihitung tak beralasan.
    expect(lacksReason({ line: 1, reason: "tanpa alasan" })).toBe(true);
  });

  it("benar-benar memindai layar dan portal", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("tiap catch kosong di screens/ dan portal/ menyebut alasan di badannya atau ada di allowlist", () => {
    const allowed = new Set(ALLOWLIST.map((a) => a.file));
    const violations = files.flatMap((file) =>
      allowed.has(file) ? [] : findEmptyCatches(readFileSync(file, "utf8"))
        .filter(lacksReason)
        .map((c) => `${file}:${c.line}`));
    expect(violations).toEqual([]);
  });

  it("allowlist tak basi: tiap entri masih memuat catch kosong", () => {
    const stale = ALLOWLIST.filter((a) => findEmptyCatches(readFileSync(a.file, "utf8")).length === 0)
      .map((a) => a.file);
    expect(stale).toEqual([]);
  });
});
