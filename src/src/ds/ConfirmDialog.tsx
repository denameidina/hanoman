// SPEC-269 · dialog konfirmasi reusable (di atas Modal). Dipakai untuk aksi hapus data.
// ADR-0121 · `requireText` untuk aksi yang tak bisa dibatalkan (hapus folder rekursif):
// tombol tetap mati sampai operator mengetik ulang namanya. Tanpa prop itu perilakunya
// identik dengan sebelumnya bagi seluruh pemakai lama.
// SPEC-847 · ADR-0125 · `impact` (daftar dampak terstruktur) dan `icon` (aksi yang bukan hapus
// tak dipaksa memakai trash). Tombol konfirmasi mengikuti severity lewat varian `danger` DS.
import React from "react";
import { Modal } from "./kit";
import { Button, Input } from "./components/forms";

export function ConfirmDialog({
  open, title, message, impact, eyebrow, confirmLabel = "Hapus", cancelLabel = "Batal",
  tone = "danger", icon, busy = false, requireText, onConfirm, onCancel,
}: {
  open: boolean; title: React.ReactNode; message?: React.ReactNode; impact?: React.ReactNode[];
  eyebrow?: React.ReactNode; confirmLabel?: string; cancelLabel?: string;
  tone?: "danger" | "default"; icon?: string; busy?: boolean;
  requireText?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  // Dialog yang sama dipakai ulang untuk target berbeda — kosongkan tiap kali ia dibuka atau
  // targetnya berganti, kalau tidak konfirmasi target lama ikut membuka target baru.
  React.useEffect(() => { setTyped(""); }, [open, requireText]);
  const locked = !!requireText && typed !== requireText;
  const mark = icon ?? (tone === "danger" ? "trash-2" : "help-circle");
  return (
    <Modal
      open={open} title={title} eyebrow={eyebrow} width={440}
      icon={mark}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button size="sm" variant={tone === "danger" ? "danger" : "primary"}
            leftIcon={icon ?? (tone === "danger" ? "trash-2" : "check")} loading={busy}
            onClick={onConfirm} disabled={busy || locked}>{confirmLabel}</Button>
        </>
      }>
      {message && <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55 }}>{message}</div>}
      {!!impact?.length && (
        <ul style={{ margin: message ? "10px 0 0" : 0, paddingLeft: 18, fontSize: 13,
          color: "var(--text-body)", lineHeight: 1.55 }}>
          {impact.map((it, i) => <li key={i} style={{ marginTop: i ? 4 : 0 }}>{it}</li>)}
        </ul>
      )}
      {requireText && (
        <Input size="sm" value={typed} aria-label={`Ketik ${requireText} untuk konfirmasi`}
          placeholder={requireText}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTyped(e.target.value)}
          style={{ marginTop: 12, width: "100%" }} />
      )}
    </Modal>
  );
}
