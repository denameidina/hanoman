import React from "react";
import {
  portalChatApi,
  type PortalChatMessageRow, type PortalChatQuotaRow, type PortalChatSessionRow,
} from "../api/client";
import { Button, Card, Input, Pager, serverPage, StateBlock, StatusPill } from "../ds";
import { MarkdownView } from "../ds/markdown";

// SPEC-854 · ADR-0129 · panel operator untuk obrolan portal klien. Ia menjawab tiga pertanyaan:
// apa yang klien bicarakan, apakah penjagaan bekerja, dan apakah ada PRD draft yang layak
// dijadikan dokumen.

const PAGE = 20;

const TYPE_LABEL: Record<string, string> = { brainstorm: "Brainstorming", tanya: "Bertanya" };

const tanggal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID",
    { day: "numeric", month: "short", year: "numeric" }) : "—";

type Detail = PortalChatSessionRow & {
  prdMarkdown: string | null; messages: PortalChatMessageRow[];
};

export function PortalChatPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = React.useState<PortalChatSessionRow[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [kuota, setKuota] = React.useState<PortalChatQuotaRow | null>(null);
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<Detail | null>(null);
  const [slug, setSlug] = React.useState("");
  const [pesan, setPesan] = React.useState<string | null>(null);

  const muat = React.useCallback(() => {
    portalChatApi.listSessions(projectId, { page, limit: PAGE })
      .then((r) => { setRows(r.items); setTotal(r.total); setKuota(r.kuota); })
      .catch(() => { setRows([]); setTotal(0); setKuota(null); });
  }, [projectId, page]);
  React.useEffect(() => { setOpen(null); muat(); }, [muat]);
  React.useEffect(() => { setPage(1); }, [projectId]);

  const buka = (id: string) => {
    setPesan(null); setSlug("");
    void portalChatApi.getSession(id).then(setOpen).catch(() => setOpen(null));
  };

  const jadikanPrd = async () => {
    if (!open || !slug.trim()) return;
    try {
      const r = await portalChatApi.materializePrd(open.id, slug.trim());
      setPesan(`PRD tersimpan di ${r.path}. Ia BELUM jadi backlog — eskalasi tetap keputusan Anda.`);
      muat();
    } catch (e) {
      setPesan(e instanceof Error ? e.message : "gagal menulis PRD");
    }
  };

  if (rows === null) return <StateBlock kind="loading" title="Memuat obrolan…" />;

  const sp = serverPage(total, page, PAGE);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {kuota && (
        <div data-testid="portal-chat-kuota" style={{
          fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
          Jatah bulan ini — Brainstorming <b>{kuota.brainstorm.terpakai} / {kuota.brainstorm.jatah}</b>
          {" · "}Bertanya <b>{kuota.tanya.terpakai} / {kuota.tanya.jatah}</b>
          {" · "}reset {tanggal(kuota.resetPada)}
          {!kuota.enabled && " · obrolan portal sedang MATI di Settings"}
        </div>
      )}

      {rows.length === 0 ? (
        <StateBlock kind="empty" icon="messages-square" title="Belum ada obrolan"
          hint="Begitu klien memulai obrolan di portal, sesinya muncul di sini." />
      ) : (
        <>
          <Card padding={0}>
            {rows.map((s) => (
              <button key={s.id} type="button" data-testid={`portal-chat-row-${s.id}`}
                onClick={() => buka(s.id)}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%",
                  textAlign: "left", padding: "12px 16px", background: "none", border: "none",
                  borderBottom: "1px solid var(--border-hair)", cursor: "pointer" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)", width: 110 }}>
                  {TYPE_LABEL[s.type] ?? s.type}
                </span>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)" }}>
                  {s.summary || "Belum ada ringkasan"}
                </span>
                {s.prdSiap && (
                  <StatusPill status={s.prdDocPath ? "ok" : "warn"} size="sm">
                    {s.prdDocPath ? "PRD dokumen" : "PRD draft"}
                  </StatusPill>
                )}
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{s.clientEmail}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{tanggal(s.createdAt)}</span>
              </button>
            ))}
          </Card>
          <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
            onPage={setPage} unit="obrolan" />
        </>
      )}

      {open && (
        <Card eyebrow={`${TYPE_LABEL[open.type] ?? open.type} · ${open.clientEmail}`}
          title={open.summary || "Obrolan"}>
          <div data-testid="portal-chat-transkrip"
            style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {open.messages.map((m) => (
              <div key={m.id} style={{
                padding: "10px 12px", borderRadius: "var(--radius-lg)",
                border: `1px solid ${m.blocked ? "var(--status-err)" : "var(--border-hair)"}`,
                background: m.role === "klien" ? "var(--bone-100)" : "var(--surface-card)" }}>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 4 }}>
                  {m.role === "klien" ? "Klien" : "hanoman"} · {tanggal(m.createdAt)}
                </div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{m.text}</div>
                {/* Baris yang tertolak gerbang keluaran diperlihatkan UTUH beserta alasannya —
                    hanya dari sini operator bisa menilai penjagaannya bekerja atau kelewat lapar. */}
                {m.blocked && (
                  <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
                    <b>Diblokir</b> ({(m.blockReasons ?? []).join(", ")}) — teks asli agen:
                    <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{m.rawText}</div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {open.prdMarkdown && (
            <>
              <div data-testid="portal-chat-prd" style={{
                border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)",
                padding: "12px 14px", marginBottom: 12 }}>
                <MarkdownView text={open.prdMarkdown} name="prd-draft.md" />
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Input data-testid="portal-chat-slug" aria-label="Slug dokumen PRD"
                  placeholder="nama-dokumen" value={slug} style={{ width: 240 }}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSlug(e.target.value)} />
                <Button data-testid="portal-chat-jadikan-prd" disabled={!slug.trim()}
                  onClick={() => void jadikanPrd()}>Jadikan dokumen PRD</Button>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  Menyimpan ke <code>docs/prd/</code>. Tidak membuat backlog.
                </span>
              </div>
            </>
          )}
          {pesan && <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)" }}>{pesan}</p>}
        </Card>
      )}
    </div>
  );
}
