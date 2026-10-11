import React from "react";
import {
  portalChatApi,
  type PortalChatMessageRow, type PortalChatQuotaRow, type PortalChatSessionRow,
} from "../api/client";
import { Button, Card, Input, Pager, serverPage, StateBlock, StatusPill } from "../ds";
import { PORTAL_CHAT_TYPE_LABEL } from "../lib/labels";
import { MarkdownView } from "../ds/markdown";
import "./styles/portal-chat.css";

// SPEC-854 · ADR-0129 · panel operator untuk obrolan portal klien. Ia menjawab tiga pertanyaan:
// apa yang klien bicarakan, apakah penjagaan bekerja, dan apakah ada PRD draft yang layak
// dijadikan dokumen.

const PAGE = 20;

const TYPE_LABEL: Readonly<Record<string, string>> = PORTAL_CHAT_TYPE_LABEL;

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
    <div className="hn-pc">
      {kuota && (
        <div data-testid="portal-chat-kuota" className="hn-pc-kuota">
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
                onClick={() => buka(s.id)} className="hn-pc-row">
                <span className="hn-pc-type">
                  {TYPE_LABEL[s.type] ?? s.type}
                </span>
                <span className="hn-pc-summary">
                  {s.summary || "Belum ada ringkasan"}
                </span>
                {s.prdSiap && (
                  <StatusPill status={s.prdDocPath ? "ok" : "warn"} size="sm">
                    {s.prdDocPath ? "PRD dokumen" : "PRD draft"}
                  </StatusPill>
                )}
                <span className="hn-pc-meta">{s.clientEmail}</span>
                <span className="hn-pc-meta">{tanggal(s.createdAt)}</span>
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
          <div data-testid="portal-chat-transkrip" className="hn-pc-transcript">
            {open.messages.map((m) => (
              <div key={m.id} className="hn-pc-msg" data-role={m.role} data-blocked={m.blocked ? "true" : "false"}>
                <div className="hn-pc-msg-meta">
                  {m.role === "klien" ? "Klien" : "hanoman"} · {tanggal(m.createdAt)}
                </div>
                <div className="hn-pc-msg-text">{m.text}</div>
                {/* Baris yang tertolak gerbang keluaran diperlihatkan UTUH beserta alasannya —
                    hanya dari sini operator bisa menilai penjagaannya bekerja atau kelewat lapar. */}
                {m.blocked && (
                  <div className="hn-pc-blocked">
                    <b>Diblokir</b> ({(m.blockReasons ?? []).join(", ")}) — teks asli agen:
                    <div className="hn-pc-raw">{m.rawText}</div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {open.prdMarkdown && (
            <>
              <div data-testid="portal-chat-prd" className="hn-pc-prd">
                <MarkdownView text={open.prdMarkdown} name="prd-draft.md" />
              </div>
              <div className="hn-pc-prd-actions">
                <Input data-testid="portal-chat-slug" aria-label="Slug dokumen PRD"
                  placeholder="nama-dokumen" value={slug} className="hn-pc-slug"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSlug(e.target.value)} />
                <Button data-testid="portal-chat-jadikan-prd" disabled={!slug.trim()}
                  onClick={() => void jadikanPrd()}>Jadikan dokumen PRD</Button>
                <span className="hn-pc-meta">
                  Menyimpan ke <code>docs/prd/</code>. Tidak membuat backlog.
                </span>
              </div>
            </>
          )}
          {pesan && <p className="hn-pc-note">{pesan}</p>}
        </Card>
      )}
    </div>
  );
}
