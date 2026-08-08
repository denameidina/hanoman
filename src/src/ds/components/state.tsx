/* StateBlock — satu komponen untuk tiga keadaan non-data: loading, empty, error.
   Dipakai di semua screen supaya "belum ada data", "sedang memuat", dan "gagal
   memuat" tidak lagi terlihat sama. */
import React from "react";
import { Icon } from "../icon";
import { Illustration } from "../Illustration";
import type { IllustrationId } from "../illustration-registry";
import { Button } from "./forms";

type Kind = "loading" | "empty" | "error";

const KIND: Record<Kind, { icon: string; fg: string; bg: string; title: string }> = {
  loading: { icon: "loader-2", fg: "var(--text-muted)", bg: "var(--bone-200)", title: "Memuat…" },
  empty: { icon: "inbox", fg: "var(--brass-700)", bg: "var(--brass-100)", title: "Belum ada data" },
  error: { icon: "octagon-alert", fg: "var(--clay-600)", bg: "var(--status-err-tint)", title: "Gagal memuat" },
};

type StateBlockProps = {
  kind: Kind;
  title?: React.ReactNode;
  hint?: React.ReactNode;
  icon?: string;
  /** Tombol aksi opsional — retry untuk error, call-to-action untuk empty. */
  action?: () => void;
  actionLabel?: React.ReactNode;
  actionIcon?: string;
  /** Ilustrasi katalog yang menggantikan tile ikon. */
  illustration?: IllustrationId;
  /** Pakai saat artwork hanya mengulang makna title/status yang sudah terbaca. */
  illustrationDecorative?: boolean;
  /** Padding kecil untuk dipakai di dalam Card. */
  compact?: boolean;
};

export function StateBlock({
  kind, title, hint, icon, action, actionLabel, actionIcon,
  illustration, illustrationDecorative, compact,
}: StateBlockProps) {
  const k = KIND[kind];
  const box = compact ? 34 : 44;
  return (
    <div
      role={kind === "error" ? "alert" : undefined}
      aria-busy={kind === "loading" || undefined}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 4, textAlign: "center", padding: compact ? "24px 16px" : "56px 24px",
        fontFamily: "var(--font-sans)",
      }}>
      {illustration ? (
        <Illustration id={illustration} decorative={illustrationDecorative}
          style={{ width: compact ? 132 : 240, maxWidth: "100%", marginBottom: 8,
            borderRadius: "var(--radius-md)" }} />
      ) : (
        <span style={{
          width: box, height: box, borderRadius: "var(--radius-md)", marginBottom: 6,
          background: k.bg, color: k.fg, display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon name={icon || k.icon} size={compact ? 17 : 21}
            style={kind === "loading" ? { animation: "hn-spin 0.7s linear infinite" } : undefined} />
        </span>
      )}
      <div style={{
        fontSize: compact ? 13.5 : 15, fontWeight: 600, color: "var(--text-strong)", lineHeight: 1.3,
      }}>{title ?? k.title}</div>
      {hint && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, maxWidth: 380 }}>{hint}</div>
      )}
      {action && (
        <div style={{ marginTop: 10 }}>
          <Button size="sm" variant={kind === "error" ? "secondary" : "primary"}
            leftIcon={actionIcon || (kind === "error" ? "rotate-ccw" : "plus")} onClick={action}>
            {actionLabel ?? (kind === "error" ? "Coba lagi" : "Tambah")}
          </Button>
        </div>
      )}
      <style>{`@keyframes hn-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
