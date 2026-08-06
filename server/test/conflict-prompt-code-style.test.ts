import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SPEC-543 · ADR-0108 · ketiga pintu konflik merakit prompt-nya INLINE di route, bukan lewat
// `runner/src/prompt.ts` — jadi mereka tak ikut kecipratan gerbang `writesCode`. Test ini membaca
// SUMBER-nya (pola `changelog-nav.test.tsx` SPEC-519): mereproduksi perilaku ketiga route itu butuh
// konflik git sungguhan, sementara yang dijaga di sini adalah "call site-nya tidak lupa" — dan itu
// memang pertanyaan tentang sumber.
const ROOT = join(import.meta.dirname, "..", "src", "routes");
const src = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("prompt sesi konflik membawa klausa gaya kode (SPEC-543)", () => {
  const gates: [string, string][] = [
    ["specs.ts", "POST /specs/:id/integrate"],
    ["ide.ts", "finishGraphOp (git graph)"],
    ["terminal.ts", "POST /terminal/sessions/:id/integrate (PRD)"],
  ];

  for (const [file, label] of gates) {
    it(`${label} menyisipkan CODE_STYLE_CLAUSE`, () => {
      const s = src(file);
      expect(s).toContain("CODE_STYLE_CLAUSE");
      // Ia harus berada di dalam rakitan prompt konflik, bukan sekadar ter-import di kepala berkas.
      const i = s.indexOf("selesaikan konflik");
      expect(i).toBeGreaterThan(-1);
      expect(s.slice(i, i + 1200)).toContain("CODE_STYLE_CLAUSE");
    });
  }
});
