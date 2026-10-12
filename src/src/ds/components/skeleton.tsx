// Skeleton: placeholder bentuk untuk loading yang punya bentuk daftar/kartu. Satu pola untuk semua
// layar (Audit UI/UX 2026-10 · "satu skeleton untuk loading"). Animasi shimmer ada di app.css dan
// dimatikan oleh `prefers-reduced-motion`; keadaan tetap terbaca sebagai blok abu-abu statis.
import React from "react";

type SkeletonProps = { width?: number | string; height?: number | string; radius?: "xs" | "sm" | "md" | "pill";
  className?: string; style?: React.CSSProperties };
// Dekoratif: pembaca layar tak perlu membaca blok kosong. Pengumuman ada di SkeletonList.
export function Skeleton({ width = "100%", height = 14, radius = "sm", className = "", style }: SkeletonProps) {
  return (
    <span aria-hidden="true" className={`hn-skeleton hn-skeleton-r-${radius} ${className}`.trim()}
      style={{ width, height, ...style }} />
  );
}

type SkeletonListProps = { rows?: number; label?: string; rowHeight?: number; className?: string };
// Wilayah loading daftar. `aria-busy` + status sopan: "Memuat…" diumumkan sekali, bukan per baris.
export function SkeletonList({ rows = 3, label = "Memuat…", rowHeight = 44, className = "" }: SkeletonListProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={`hn-skeleton-list ${className}`.trim()}>
      <span className="hn-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={rowHeight} radius="md" width={i % 3 === 2 ? "70%" : "100%"} />
      ))}
    </div>
  );
}
