import type React from "react";
import { ICONS } from "./icon-registry";
import { pascalCandidates } from "./icon-names";
type IconProps = {
  name: string; size?: number; stroke?: number; color?: string;
  className?: string; style?: React.CSSProperties;
} & Record<string, unknown>;
// Audit UI/UX 2026-10 · Fase 2B · ikon DEKORATIF (tanpa aria-label/aria-labelledby/title) disembunyikan
// dari pembaca layar: teks di sebelahnya sudah menjelaskan. Ikon yang diberi nama dirender sebagai
// `role="img"` dengan nama itu. Caller tetap bisa menimpa lewat `aria-hidden` eksplisit.
export function Icon({ name, size = 16, stroke, color, style, ...rest }: IconProps) {
  const Cmp = resolve(name) ?? ICONS.Circle!;
  const named = rest["aria-label"] != null || rest["aria-labelledby"] != null || rest.title != null;
  return <Cmp data-icon={name} aria-hidden={named ? undefined : true} role={named ? "img" : undefined}
    size={size} color={color} strokeWidth={stroke} style={style} {...rest} />;
}
// ADR-0160 · lookup ke registry STATIS (`icon-registry.ts`, dibangkitkan dari literal di sumber),
// bukan peta `icons` lucide: peta itu memuat ±1 500 ikon dan menyeret ±1 MB ke chunk utama.
// SPEC-906 · nama lama → kanonik ada di `icon-names.ts` (`LEGACY`), dipakai bersama generatornya.
const known = ICONS as Record<string, React.FC<Record<string, unknown>> | undefined>;
const warned = new Set<string>();
function resolve(name: string): React.FC<Record<string, unknown>> | undefined {
  for (const c of pascalCandidates(name)) { const hit = known[c]; if (hit) return hit; }
  // Nama tak dikenal tetap jadi lingkaran kosong — tapi berteriak sekali di dev, supaya salah ketik
  // berikutnya (atau nama yang belum masuk registry) tak senyap seperti kelima belas nama SPEC-906.
  if (import.meta.env.DEV && !warned.has(name)) {
    warned.add(name);
    console.warn(`Icon: nama "${name}" tak dikenal lucide/registry — dirender sebagai lingkaran kosong.`);
  }
  return undefined;
}
