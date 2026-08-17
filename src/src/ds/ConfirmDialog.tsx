// SPEC-269 · dialog konfirmasi reusable (di atas Modal). Dipakai untuk aksi hapus data.
// ADR-0121 · `requireText` untuk aksi yang tak bisa dibatalkan (hapus folder rekursif):
// tombol tetap mati sampai operator mengetik ulang namanya. Tanpa prop itu perilakunya
// identik dengan sebelumnya bagi seluruh pemakai lama.
import React from "react";
import { Modal } from "./kit";
import { Button, Input } from "./components/forms";

export function ConfirmDialog({
  open, title, message, eyebrow, confirmLabel = "Hapus", cancelLabel = "Batal",
  tone = "danger", busy = false, requireText, onConfirm, onCancel,
}: {
  open: boolean; title: React.ReactNode; message?: React.ReactNode; eyebrow?: React.ReactNode;
  confirmLabel?: string; cancelLabel?: string; tone?: "danger" | "default"; busy?: boolean;
  requireText?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  // Dialog yang sama dipakai ulang untuk target berbeda — kosongkan tiap kali ia dibuka atau
  // targetnya berganti, kalau tidak konfirmasi target lama ikut membuka target baru.
  React.useEffect(() => { setTyped(""); }, [open, requireText]);
  const locked = !!requireText && typed !== requireText;
  return (
    <Modal
      open={open} title={title} eyebrow={eyebrow} width={440}
      icon={tone === "danger" ? "trash-2" : "help-circle"}
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button size="sm" variant="primary" leftIcon={tone === "danger" ? "trash-2" : "check"}
            onClick={onConfirm} disabled={busy || locked}>{confirmLabel}</Button>
        </>
      }>
      {message && <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55 }}>{message}</div>}
      {requireText && (
        <Input size="sm" value={typed} aria-label={`Ketik ${requireText} untuk konfirmasi`}
          placeholder={requireText}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTyped(e.target.value)}
          style={{ marginTop: 12, width: "100%" }} />
      )}
    </Modal>
  );
}
