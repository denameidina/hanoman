import { icons } from "lucide-react";
import type React from "react";
type IconProps = {
  name: string; size?: number; stroke?: number; color?: string;
  className?: string; style?: React.CSSProperties;
} & Record<string, unknown>;
export function Icon({ name, size = 16, stroke, color, style, ...rest }: IconProps) {
  const Cmp = (icons as Record<string, React.FC<any>>)[toPascal(name)] ?? icons.Circle;
  return <Cmp data-icon={name} size={size} color={color} strokeWidth={stroke} style={style} {...rest} />;
}
const toPascal = (s: string) => (s || "").split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
