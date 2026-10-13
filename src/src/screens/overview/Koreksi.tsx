import React from "react";
import { DenseRow, RowList, StatusPill } from "../../ds";
import { DOC_STATUS_LABEL, labelOf } from "../../lib/labels";
import type { ProjectVM } from "../types";

// Dokumen rusak perlu tindakan; drift hanya tidak sinkron.
export function attentionOf(p: ProjectVM): "high" | "low" | "none" {
  return p.docStatus === "broken" ? "high" : p.docStatus === "drift" ? "low" : "none";
}
const ATTENTION_REASON: Record<string, string> = {
  broken: "Dokumen belum memenuhi standar",
  drift: "Sebagian kategori dokumen belum terindeks",
};

/** Kotak ralat ala koran: hanya tampil bila ada project broken/drift (pengganti "Perlu perhatian"). */
export function Koreksi({ projects, onOpen }: { projects: ProjectVM[]; onOpen: (p: ProjectVM) => void }) {
  const list = projects.filter((p) => attentionOf(p) !== "none")
    .sort((a, b) => (attentionOf(a) === "high" ? 0 : 1) - (attentionOf(b) === "high" ? 0 : 1));
  if (list.length === 0) return null;
  return (
    <section className="hn-ovk-koreksi" aria-labelledby="ovk-koreksi">
      <h3 id="ovk-koreksi" className="hn-ovk-kicker">Koreksi</h3>
      {/* `hn-ov-attn`: kelas yang aturan ponselnya dikunci (nama wrap dua baris, alasan clamp dua baris). */}
      <RowList label="Koreksi" className="hn-ov-attn">
        {list.map((p) => (
          <DenseRow key={p.id} onClick={() => onOpen(p)}>
            <StatusPill status={p.docStatus} variant="dot" size="sm">{labelOf(DOC_STATUS_LABEL, p.docStatus)}</StatusPill>
            <span className="hn-ov-name" title={p.name}>{p.name}</span>
            <span className="hn-ov-meta">{`${ATTENTION_REASON[p.docStatus] ?? ""} · cakupan ${p.coverage}%`}</span>
          </DenseRow>
        ))}
      </RowList>
    </section>
  );
}
