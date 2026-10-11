// Z2 · jsdom tak memuat stylesheet dari `import "*.css"` (vitest melewatinya), jadi layout yang kini
// berupa kelas tak punya nilai di `getComputedStyle`. Helper ini menyuntikkan CSS proyek ke `document`,
// satu `<style>` per berkas (satu berkas rusak tak menggugurkan yang lain), supaya tes bisa membaca
// nilai KASKADE. Batas jsdom: spesifisitas diabaikan (berkas & aturan yang lebih akhir menang), dan
// `@media` selain `screen` dilewati, jadi tes ini mengukur desktop.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "../src");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Menyuntikkan semua CSS proyek sekali per dokumen. `app.css` didahulukan seperti di `main.tsx`. */
export function injectProjectCss(): void {
  if (document.head.querySelector("style[data-project-css]")) return;
  const files = cssFiles(SRC).sort((a, b) => Number(b.endsWith("/app.css")) - Number(a.endsWith("/app.css")));
  for (const file of files) {
    const style = document.createElement("style");
    style.setAttribute("data-project-css", file);
    style.textContent = readFileSync(file, "utf8");
    document.head.appendChild(style);
  }
}
