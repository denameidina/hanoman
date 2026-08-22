import { icons } from "lucide-react";
import type React from "react";
type IconProps = {
  name: string; size?: number; stroke?: number; color?: string;
  className?: string; style?: React.CSSProperties;
} & Record<string, unknown>;
export function Icon({ name, size = 16, stroke, color, style, ...rest }: IconProps) {
  const Cmp = resolve(name) ?? icons.Circle;
  return <Cmp data-icon={name} size={size} color={color} strokeWidth={stroke} style={style} {...rest} />;
}
// SPEC-906 · lucide 0.400 memberi banyak ikon nama kanonik baru dan menyimpan nama lamanya HANYA
// sebagai alias di level modul — peta `icons` memuat yang kanonik saja. Selama lookup-nya `icons`,
// lima belas nama di bawah jatuh ke `Circle` di ±123 call site (ikon tiap toast error, spinner tiap
// tombol loading, menu overflow): ikonnya hilang, layout utuh, nol error, jadi tak ada yang
// menyadarinya. Dipetakan di sini, bukan lewat `import * as lucide`: namespace dinamis memaksa
// Rollup membangun objek berisi ~2 000 getter (+20 KB gzip, terukur) untuk hasil yang sama.
// Ini juga daftar utang migrasi — kosongkan dengan mengganti nama di call site, tapi awas dua yang
// TERTUKAR: `check-circle` yang tebal, `check-circle-2` yang tipis.
const LEGACY: Record<string, string> = {
  "alert-triangle": "TriangleAlert", "arrow-up-circle": "CircleArrowUp",
  "check-circle": "CircleCheckBig", "check-circle-2": "CircleCheck",
  "code-2": "CodeXml", "download-cloud": "CloudDownload", "edit-3": "PenLine",
  "git-commit": "GitCommitHorizontal", "help-circle": "CircleHelp", "loader-2": "LoaderCircle",
  "minus-circle": "CircleMinus", "more-horizontal": "Ellipsis", "sliders": "SlidersVertical",
  "terminal-square": "SquareTerminal", "x-circle": "CircleX",
};
const known = icons as Record<string, React.FC<Record<string, unknown>> | undefined>;
const warned = new Set<string>();
function resolve(name: string): React.FC<Record<string, unknown>> | undefined {
  const hit = known[toPascal(name)] ?? known[LEGACY[name] ?? ""];
  if (hit) return hit;
  // Nama tak dikenal tetap jadi lingkaran kosong — tapi berteriak sekali di dev, supaya salah ketik
  // berikutnya tak ikut senyap seperti kelima belas nama tadi.
  if (import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(`Icon: nama "${name}" tak dikenal lucide — dirender sebagai lingkaran kosong.`);
  }
  return undefined;
}
const toPascal = (s: string) => (s || "").split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
