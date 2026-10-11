// Audit UI/UX 2026-10 · Fase 2D — penjaga glosarium (internal/docs/frontend/glossary.md).
//
// Yang diperiksa adalah TEKS YANG TAMPIL ke operator: string literal, potongan template literal, dan
// teks JSX di layar, portal, public, palet, dan shell. Dipindai lewat AST TypeScript, bukan regex di
// atas sumber, supaya komentar, identifier (mis. tipe `SpecSlim`), dan import tak ikut terhitung.
//
// Pengecualian ada di ALLOWLIST dengan alasan. Entri "UTANG Fase 3" adalah copy yang sudah tercatat
// dan menunggu redesign per layar; ia dihapus begitu copy-nya diganti. Test "allowlist tak basi"
// memastikan entri yang sudah tak cocok ikut dihapus.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = "src/src";
const SCOPE = ["screens", "portal", "public", "palette", "ds/shell.tsx"];

export type Shown = { file: string; line: number; kind: "str" | "tpl" | "jsx"; text: string };
export type Violation = Shown & { rule: string };
export type Rule = { id: string; test: (s: Shown) => boolean; saran: string };

/** Kata utuh. Tanda `-` ikut dihitung sebagai bagian kata: `hub-crumb` (nama kelas) bukan kata `hub`. */
const word = (w: string, flags = "i") => new RegExp(`(?<![\\w-])${w}(?![\\w-])`, flags);
const has = (re: RegExp) => (s: Shown) => re.test(s.text);

/** Istilah yang dilarang di teks tampil. Daftar sumbernya glosarium audit 2026-10. */
export const RULES: Rule[] = [
  { id: "device", test: has(word("Device", "")), saran: "Perangkat (lihat glosarium)" },
  { id: "specslim", test: has(word("SpecSlim", "")), saran: "Item" },
  { id: "on-convention", test: has(word("on-convention")), saran: "sebut keadaannya langsung, mis. \"sesuai standar\"" },
  { id: "basi", test: has(word("basi")), saran: "tulis keadaan konkret (kapan dimuat, sumbernya apa)" },
  { id: "hub", test: has(word("hub")), saran: "server pusat, atau Perangkat sesuai konteks" },
  { id: "sot", test: has(word("SoT", "")), saran: "Dokumen (Docs · SoT → Dokumen)" },
  { id: "retry", test: has(word("retry")), saran: "Coba lagi / Kirim ulang" },
  // Waktu relatif dirakit di tiga tempat dulu ("N menit lalu" + " lalu" ditempel di luar fungsi).
  // Sekarang satu fungsi: lib/time-format.ts. "lalu" sendirian hanya dicek di string/template:
  // di prosa JSX ("… lalu <code>…") ia berarti "kemudian".
  {
    id: "relatif-manual",
    test: (s) => /\b(menit|jam|hari|detik) lalu\b/.test(s.text) || /baru saja lalu/i.test(s.text)
      || (s.kind !== "jsx" && s.text === "lalu"),
    saran: "lib/time-format.ts relativeTime()",
  },
];

/** Teks tampil ternormalisasi (spasi dirapikan). `null` bila kosong. */
const normalize = (raw: string): string | null => {
  const t = raw.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** Semua teks yang tampil dalam satu berkas, lewat AST. Import dan kunci objek dilewati. */
export function shownTexts(file: string, src: string): Shown[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Shown[] = [];
  const push = (node: ts.Node, kind: Shown["kind"], raw: string) => {
    const text = normalize(raw);
    if (text === null) return;
    out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, kind, text });
  };
  const visit = (node: ts.Node): void => {
    const parent = node.parent;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const skip = parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
        || ts.isLiteralTypeNode(parent) || (ts.isPropertyAssignment(parent) && parent.name === node));
      if (!skip) push(node, "str", node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      push(node, "tpl", node.text);
    } else if (ts.isJsxText(node)) {
      push(node, "jsx", node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function violationsOf(shown: Shown[]): Violation[] {
  return shown.flatMap((s) => RULES.filter((r) => r.test(s)).map((r) => ({ ...s, rule: r.id })));
}

function listSources(path: string): string[] {
  if (statSync(path).isFile()) return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((e) => listSources(join(path, e)));
}

const files = SCOPE.flatMap((s) => listSources(join(ROOT, s)));
const shown = files.flatMap((f) => shownTexts(f, readFileSync(f, "utf8")));

/**
 * Pengecualian per berkas: `fragment` adalah potongan UNIK dari teks tampil (sudah dinormalisasi)
 * di berkas itu. Potongan, bukan teks penuh, karena banyak copy multi-baris dan kutipan kode yang
 * panjang; potongannya tetap cukup spesifik untuk tak menutupi copy lain. `reason` wajib menyebut
 * mengapa. Copy yang belum diganti ditandai "UTANG Fase 3" dan dibahas di glossary.md.
 */
export const ALLOWLIST: { file: string; fragment: string; reason: string }[] = [
  // UTANG Fase 3 — copy di layar yang belum diredesain. Daftar lengkap ada di glossary.md.
  { file: "src/src/screens/LogsPanel.tsx", fragment: "Device",
    reason: "UTANG Fase 3 (Klien · log): aria-label 'Device' belum diganti 'Perangkat'; dibaca pembaca layar." },
  { file: "src/src/screens/PhasePlanPreview.tsx", fragment: "Pratinjau ini memakai Setting hub ini",
    reason: "UTANG Fase 3 (Settings · orkestrasi): 'hub' dan 'device' di copy pratinjau fase; perlu istilah server pusat." },
  { file: "src/src/screens/ReconcileModal.tsx", fragment: "Hub bergeser lagi",
    reason: "UTANG Fase 3 (Konflik sinkron): 'Hub' sebagai nama server pusat; belum ada keputusan istilah." },
  { file: "src/src/screens/ReconcileModal.tsx", fragment: "Konflik ini sudah tak ada di hub",
    reason: "UTANG Fase 3 (Konflik sinkron): 'hub' sebagai nama server pusat; belum ada keputusan istilah." },
  { file: "src/src/screens/ReconcileModal.tsx", fragment: "Hub menolak keputusan ini",
    reason: "UTANG Fase 3 (Konflik sinkron): 'Hub' sebagai nama server pusat; belum ada keputusan istilah." },
  { file: "src/src/screens/ReconcileModal.tsx", fragment: "di hub akan diganti dengan data",
    reason: "UTANG Fase 3 (Konflik sinkron): 'hub' di kalimat konfirmasi; belum ada keputusan istilah." },
  { file: "src/src/screens/SyncButton.tsx", fragment: "Instance ini hub",
    reason: "UTANG Fase 3 (Sinkronisasi): 'hub' sebagai nama server pusat; belum ada keputusan istilah." },
  { file: "src/src/screens/SyncButton.tsx", fragment: "menyeberang ke hub pada sync berikutnya",
    reason: "UTANG Fase 3 (Sinkronisasi): 'hub' di tooltip penghapusan; belum ada keputusan istilah." },
  { file: "src/src/screens/WebhookDocs.tsx", fragment: "bisa basi",
    reason: "UTANG Fase 3 (Dokumen webhook): 'basi' di prosa; ganti 'bisa tak sesuai lagi'." },
  { file: "src/src/screens/WebhookDocs.tsx", fragment: "Retry, pengiriman ganda",
    reason: "UTANG Fase 3 (Dokumen webhook): judul kartu memakai 'Retry'; ganti 'Kirim ulang' bila istilahnya diputuskan." },
  { file: "src/src/screens/WebhookDocs.tsx", fragment: "retry setelah jaringan putus",
    reason: "UTANG Fase 3 (Dokumen webhook): 'retry' di prosa penjelasan; ikut keputusan istilah di atas." },
  // SAH — kutipan kode contoh untuk integrator; istilah 'retry' di sana adalah identifier protokol.
  { file: "src/src/screens/WebhookDocs.tsx", fragment: "Idempoten: retry mengirim event.id",
    reason: "SAH: kutipan kode contoh (Node) untuk integrator; 'retry' di komentar kode, bukan copy UI." },
  { file: "src/src/screens/WebhookDocs.tsx", fragment: "retry membawa id yang sama",
    reason: "SAH: kutipan kode contoh (Python) untuk integrator; 'retry' di komentar kode, bukan copy UI." },
  { file: "src/src/ds/shell.tsx", fragment: "Docs · SoT",
    reason: "UTANG Fase 3 (Shell · nav): label menu 'Docs · SoT'; berkas milik agen 3A, ganti ke 'Dokumen' di sana." },
];

const allowed = (v: Shown) => ALLOWLIST.some((a) => a.file === v.file && v.text.includes(a.fragment));
const where = (v: Violation) => `${v.file}:${v.line} [${v.rule}] ${JSON.stringify(v.text)}`;

describe("glosarium: penjaga istilah di teks tampil", () => {
  it("pemindai mengenali teks tampil dan mengabaikan kode, komentar, dan identifier", () => {
    const sample = [
      "// Device lama di komentar",
      "type SpecSlim = { id: string };",
      'import { X } from "./hub";',
      'export const a = "Device terhubung";',
      "export const b = `${n} menit lalu`;",
      'export const c = " lalu";',
      'export const d = { "Device": 1 };',
      'export const e = <p title="x">Perangkat hub</p>;',
    ].join("\n");
    const v = violationsOf(shownTexts("sample.tsx", sample)).map((x) => `${x.line}:${x.rule}`);
    expect(v).toEqual(["4:device", "5:relatif-manual", "6:relatif-manual", "8:hub"]);
  });

  it("uji pola: istilah yang dilarang tertangkap, istilah yang sah tidak", () => {
    const hit = (t: string) => violationsOf([{ file: "x", line: 1, kind: "str", text: t }]).map((v) => v.rule);
    expect(hit("Device terhubung")).toEqual(["device"]);
    expect(hit("Perangkat terhubung")).toEqual([]);
    expect(hit("deviceId")).toEqual([]);
    expect(hit("Mesin basi")).toEqual(["basi"]);
    expect(hit("5 menit lalu")).toEqual(["relatif-manual"]);
    expect(hit("terakhir terlihat baru saja")).toEqual([]);
    expect(hit("baru saja lalu")).toEqual(["relatif-manual"]);
    expect(hit("Coba lagi")).toEqual([]);
  });

  // Penjaga yang diam-diam tak memindai apa pun memberi gejala yang sama dengan "semua bersih".
  it("benar-benar memindai layar, portal, public, palet, dan shell", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("ds/shell.tsx"))).toBe(true);
    expect(shown.length).toBeGreaterThan(1000);
  });

  it("tak ada istilah terlarang di luar allowlist", () => {
    const violations = violationsOf(shown).filter((v) => !allowed(v));
    expect(violations.map(where)).toEqual([]);
  });

  it("allowlist tak basi: tiap entri masih cocok dengan teks tampil di berkasnya", () => {
    const stale = ALLOWLIST.filter((a) => !shown.some((s) => s.file === a.file && s.text.includes(a.fragment)));
    expect(stale.map((a) => `${a.file} ${JSON.stringify(a.fragment)}`)).toEqual([]);
  });

  it("tiap pengecualian menyebut alasannya, dan alasannya jelas kategorinya (SAH atau UTANG Fase 3)", () => {
    const blank = ALLOWLIST.filter((a) => a.reason.trim().length < 30 || !/^(SAH|UTANG Fase 3)/.test(a.reason));
    expect(blank.map((a) => a.file)).toEqual([]);
  });
});
