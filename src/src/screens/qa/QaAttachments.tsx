import React from "react";
import type { QaAttachmentView, QaOwnerType } from "@hanoman/shared";
import { Badge, Button, useConfirm, useCoarsePointer } from "../../ds";
import { useApi } from "../../api/instance";
import type { PanelProps } from "./QaReportEditor";
import { SYNC_STATE_BADGE, errText, fmtSize } from "./qa-ui";

const MAX = 10 * 1024 * 1024;   // sama dengan QA_ATTACHMENT_LIMITS.fileBytes di server
const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.md,.txt,.log,.json,.csv";
// Wadah yang bisa difokus (untuk Ctrl/Cmd+V) harus memperlihatkan fokusnya. Cincin memakai token DS.
const FOCUS_CSS = ".qa-attach:focus-visible{outline:2px solid var(--border-focus);outline-offset:3px;border-radius:var(--radius-sm)}";
const OWNER_LABEL: Record<QaOwnerType, string> = { report: "laporan ini", case: "test case ini", finding: "temuan ini" };

type Props = PanelProps & { ownerType: QaOwnerType; ownerId: string; compact?: boolean };

export function QaAttachments({ detail, projectId, locked, onChange, onToast, ownerType, ownerId, compact }: Props) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const coarse = useCoarsePointer();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const items = detail.attachments.filter((a) => a.ownerType === ownerType && a.ownerId === ownerId);

  const upload = async (files: File[]) => {
    if (locked || !files.length) return;
    const ok = files.filter((f) => {
      if (f.size > MAX) { onToast?.(`${f.name} melebihi batas 10 MB`); return false; }
      return true;
    });
    if (!ok.length) return;
    setBusy(true);
    try {
      const r = await api.uploadQaAttachments(projectId, detail.id, { ownerType, ownerId }, ok);
      if (r.rejected.length) onToast?.(`Ditolak: ${r.rejected.map((x) => `${x.filename} (${x.reason})`).join(", ")}`);
      onChange(await api.qaReport(projectId, detail.id));
    } catch (e) { onToast?.(errText(e)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const remove = async (a: QaAttachmentView) => {
    try {
      await confirm({
        title: `Hapus ${a.filename}?`,
        message: `Berkas dihapus dari ${OWNER_LABEL[ownerType]}.`,
        impact: ["Berkas tidak ikut diekspor lagi."],
        tone: "danger",
        confirmLabel: "Hapus",
        run: async () => { await api.deleteQaAttachment(projectId, detail.id, a.id); onChange(await api.qaReport(projectId, detail.id)); },
      });
    } catch (e) { onToast?.(errText(e)); }
  };

  return (
    <>
      {/* Wadah dapat difokus supaya Ctrl/Cmd+V menempel screenshot langsung ke pemilik ini. */}
      <div className="qa-attach" tabIndex={locked ? -1 : 0} style={{ marginTop: compact ? 10 : 0 }}
        onPaste={(e) => { const fs = [...(e.clipboardData?.files ?? [])]; if (fs.length) { e.preventDefault(); void upload(fs); } }}
        onDragOver={(e) => { if (!locked) e.preventDefault(); }}
        onDrop={(e) => { if (locked) return; e.preventDefault(); void upload([...e.dataTransfer.files]); }}>
        <style>{FOCUS_CSS}</style>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          {items.map((a) => {
            const url = api.qaAttachmentUrl(projectId, detail.id, a.id);
            return (
              <div key={a.id} style={{ display: "grid", gap: 4, maxWidth: 160 }}>
                {a.mimeType.startsWith("image/") ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={a.filename} loading="lazy"
                      style={{ height: compact ? 64 : 96, maxWidth: 160, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-strong)" }} />
                  </a>
                ) : (
                  <a href={api.qaAttachmentUrl(projectId, detail.id, a.id, true)} style={{ fontSize: "var(--text-xs)", overflowWrap: "anywhere" }}>{a.filename}</a>
                )}
                <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)" }}>
                  {a.mimeType.startsWith("image/") ? a.filename + " · " : ""}{fmtSize(a.size)}
                </span>
                {SYNC_STATE_BADGE[a.syncState] && (
                  <Badge tone={SYNC_STATE_BADGE[a.syncState]!.tone} size="sm" title={SYNC_STATE_BADGE[a.syncState]!.hint}>{SYNC_STATE_BADGE[a.syncState]!.label}</Badge>
                )}
                {!locked && (
                  <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus lampiran ${a.filename}`} onClick={() => void remove(a)} />
                )}
              </div>
            );
          })}
          {!locked && (
            <>
              <Button size="sm" variant="secondary" leftIcon="paperclip" loading={busy} onClick={() => input.current?.click()}>Lampirkan</Button>
              <input ref={input} type="file" multiple accept={ACCEPT} hidden aria-label="Pilih lampiran"
                onChange={(e) => void upload([...(e.target.files ?? [])])} />
            </>
          )}
        </div>
        {!locked && !compact && (
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)", margin: "8px 0 0" }}>
            {/* Seret dan tempel hanya ada di perangkat berkursor; di layar sentuh pakai tombol Lampirkan. */}
            {coarse ? "Pilih berkas lewat tombol Lampirkan." : "Seret berkas ke sini atau tempel screenshot (Ctrl/Cmd+V)."}{" "}
            Maks 10 MB per berkas: png, jpg, webp, pdf, md, txt, log, json, csv.
          </p>
        )}
      </div>
      {dialog}
    </>
  );
}
