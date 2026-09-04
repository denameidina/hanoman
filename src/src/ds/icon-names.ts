// Nama ikon kebab-case → ekspor lucide PascalCase. Modul murni (tanpa React, tanpa lucide) supaya
// dipakai bersama oleh `icon.tsx` (runtime) dan `scripts/gen-icon-registry.ts` (build/test).

// SPEC-906 · lucide 0.400 memberi banyak ikon nama kanonik baru dan menyimpan nama lamanya HANYA
// sebagai alias di level modul — peta `icons` memuat yang kanonik saja. Selama lookup-nya `icons`,
// lima belas nama di bawah jatuh ke `Circle` di ±123 call site (ikon tiap toast error, spinner tiap
// tombol loading, menu overflow): ikonnya hilang, layout utuh, nol error, jadi tak ada yang
// menyadarinya. Ini juga daftar utang migrasi — kosongkan dengan mengganti nama di call site, tapi
// awas dua yang TERTUKAR: `check-circle` yang tebal, `check-circle-2` yang tipis.
export const LEGACY: Record<string, string> = {
  "alert-triangle": "TriangleAlert", "arrow-up-circle": "CircleArrowUp",
  "check-circle": "CircleCheckBig", "check-circle-2": "CircleCheck",
  "code-2": "CodeXml", "download-cloud": "CloudDownload", "edit-3": "PenLine",
  "git-commit": "GitCommitHorizontal", "help-circle": "CircleHelp", "loader-2": "LoaderCircle",
  "minus-circle": "CircleMinus", "more-horizontal": "Ellipsis", "sliders": "SlidersVertical",
  "terminal-square": "SquareTerminal", "x-circle": "CircleX",
};

export const toPascal = (s: string): string =>
  (s || "").split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");

/** Kandidat nama ekspor lucide untuk sebuah nama ikon, urutan prioritas. */
export const pascalCandidates = (name: string): string[] =>
  [toPascal(name), LEGACY[name] ?? ""].filter(Boolean);
