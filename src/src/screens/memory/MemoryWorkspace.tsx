// src/src/screens/memory/MemoryWorkspace.tsx
// ADR-0181 · halaman Memori satu project: antrean review, memori aktif, arsip. Pola Workspace QA
// (/qa/<projectId>). Daftar ditarik lewat HTTP; topik langganan `memory` hanya membawa sidik
// perubahan (revision), dan layar menarik ulang saat sidiknya berubah — tanpa polling di sini.
import React from "react";
import type { MemoryEventView, MemoryListItem, MemoryStatus } from "@hanoman/shared";
import { Badge, Button, Callout, Card, Field, HnTextarea, Input, Modal, Select, StateBlock, Tabs, useConfirm } from "../../ds";
import { useApi } from "../../api/instance";
import { useLiveTopic } from "../../api/live";
import {
  KIND_LABEL, KIND_TONE, OP_LABEL, REVIEW_REASON_LABEL, duplicateSupersedes, errText, sourceLine, verdictBadge,
} from "./memory-ui";

type Props = {
  projects: { id: string; name: string }[];
  projectId: string | undefined;
  onSelectProject: (id: string) => void;
  onToast?: (m: string) => void;
};
type TabKey = "review" | "active" | "archive";
type Lists = { review: MemoryListItem[]; active: MemoryListItem[]; archive: MemoryListItem[] };
type ReasonAsk = { item: MemoryListItem; action: "reject" | "invalidate" };

export function MemoryWorkspace({ projects, projectId, onSelectProject, onToast }: Props) {
  const api = useApi();
  const { confirm, dialog } = useConfirm();
  const [lists, setLists] = React.useState<Lists | null>(null);
  const [error, setError] = React.useState(false);
  const [tab, setTab] = React.useState<TabKey | null>(null);
  const [q, setQ] = React.useState("");
  const [ask, setAsk] = React.useState<ReasonAsk | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<Record<string, MemoryEventView[] | "loading">>({});
  const revision = React.useRef<string | null>(null);

  const reload = React.useCallback(async () => {
    if (!projectId) return;
    setError(false);
    try {
      const get = (status: MemoryStatus) => api.memories(projectId, { status, ...(q.trim() ? { q: q.trim() } : {}) });
      const [review, active, invalidated, rejected] = await Promise.all([
        get("proposed"), get("active"), get("invalidated"), get("rejected"),
      ]);
      setLists({ review: review.items, active: active.items, archive: [...invalidated.items, ...rejected.items] });
      // Tab awal: antrean review bila ada isinya — itulah pekerjaan yang menunggu manusia.
      setTab((t) => t ?? (review.items.length ? "review" : "active"));
    } catch { setError(true); }
  }, [api, projectId, q]);

  React.useEffect(() => { void reload(); }, [reload]);
  React.useEffect(() => { setTab(null); setLists(null); setHistory({}); revision.current = null; }, [projectId]);

  useLiveTopic({
    topic: "memory", params: { projectId: projectId ?? "" },
    apply: (m) => {
      if (revision.current !== null && revision.current !== m.revision) void reload();
      revision.current = m.revision;
    },
    refetch: () => void reload(),
    pollMs: 15_000,
  });

  if (!projectId) {
    return <StateBlock kind="empty" title="Belum ada project" hint="Buat atau muat project di halaman Projects, lalu buka Memori lagi." />;
  }

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); onToast?.(ok); await reload(); } catch (e) { onToast?.(errText(e)); }
  };
  const approve = (m: MemoryListItem) => act(() => api.reviewMemory(projectId, m.id, "activate"), "Memori disetujui");
  const remove = (m: MemoryListItem) => confirm({
    title: "Hapus memori ini secara permanen?",
    message: "Memori dan seluruh riwayatnya dihapus di semua mesin yang tersinkron. Untuk fakta yang salah, lebih baik Batalkan — riwayatnya tetap tersimpan.",
    tone: "danger", confirmLabel: "Hapus permanen",
    run: () => api.deleteMemory(projectId, m.id),
  }).then((yes) => { if (yes) { onToast?.("Memori dihapus permanen"); void reload(); } })
    .catch((e) => onToast?.(errText(e)));
  const submitReason = async () => {
    if (!ask || !reason.trim() || busy) return;
    setBusy(true);
    const r = reason.trim();
    await act(
      () => ask.action === "reject"
        ? api.reviewMemory(projectId, ask.item.id, "reject", r)
        : api.invalidateMemory(projectId, ask.item.id, r),
      ask.action === "reject" ? "Memori ditolak" : "Memori dibatalkan",
    );
    setBusy(false); setAsk(null); setReason("");
  };
  const toggleHistory = async (m: MemoryListItem) => {
    if (history[m.id]) { setHistory(({ [m.id]: _, ...rest }) => rest); return; }
    setHistory((h) => ({ ...h, [m.id]: "loading" }));
    try {
      const d = await api.memory(projectId, m.id);
      setHistory((h) => ({ ...h, [m.id]: d.events }));
    } catch (e) {
      setHistory(({ [m.id]: _, ...rest }) => rest);
      onToast?.(errText(e));
    }
  };

  const current = tab ?? "review";
  const items = lists ? lists[current] : [];
  const dupes = lists ? duplicateSupersedes(lists.active) : [];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Project">
          <Select value={projectId} onChange={(e) => onSelectProject(e.target.value)}
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Cari">
          <Input value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            placeholder="mis. migration" leftIcon="search" />
        </Field>
      </div>
      <p style={{ margin: 0, color: "var(--text-subtle)", maxWidth: "72ch" }}>
        Fakta, konvensi, dan keputusan yang dicatat agen untuk project ini. Memori aktif yang jangkarnya
        cocok dengan kode disuntikkan ke setiap sesi backlog; usulan tanpa jangkar, keputusan, dan usulan
        dari sumber tak tepercaya menunggu persetujuanmu di sini.
      </p>

      {error ? (
        <StateBlock kind="error" title="Gagal memuat memori" action={() => void reload()} actionLabel="Coba lagi" />
      ) : !lists ? (
        <StateBlock kind="loading" />
      ) : (
        <>
          <Tabs value={current} onChange={(v: string) => setTab(v as TabKey)} tabs={[
            { value: "review", label: "Perlu review", count: lists.review.length },
            { value: "active", label: "Aktif", count: lists.active.length },
            { value: "archive", label: "Arsip", count: lists.archive.length },
          ]} />
          {current === "active" && dupes.length > 0 && (
            <Callout tone="warn" title="Pengganti ganda">
              {dupes.length} memori digantikan oleh lebih dari satu memori aktif — dua mesin menggantikan memori
              yang sama secara bersamaan. Tinjau penggantinya dan batalkan yang tidak tepat.
            </Callout>
          )}
          {items.length === 0 ? (
            <StateBlock kind="empty" compact title={
              current === "review" ? "Tak ada usulan yang menunggu review"
                : current === "active" ? "Belum ada memori aktif" : "Arsip kosong"} />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {items.map((m) => (
                <MemoryCard key={m.id} m={m} tab={current} history={history[m.id]}
                  onApprove={() => void approve(m)}
                  onReject={() => { setReason(""); setAsk({ item: m, action: "reject" }); }}
                  onInvalidate={() => { setReason(""); setAsk({ item: m, action: "invalidate" }); }}
                  onDelete={() => void remove(m)}
                  onHistory={() => void toggleHistory(m)} />
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={!!ask} onClose={() => { if (!busy) setAsk(null); }}
        title={ask?.action === "reject" ? "Tolak usulan memori" : "Batalkan memori"}
        footer={<>
          <Button variant="ghost" onClick={() => setAsk(null)} disabled={busy}>Kembali</Button>
          <Button variant="danger" onClick={() => void submitReason()} disabled={!reason.trim() || busy}>
            {ask?.action === "reject" ? "Tolak memori" : "Batalkan memori"}
          </Button>
        </>}>
        {ask && <p style={{ marginTop: 0 }}>{ask.item.content}</p>}
        <Field label="Alasan" hint="Tercatat permanen di riwayat memori dan ikut tersinkron.">
          <HnTextarea aria-label="Alasan" value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="mis. sudah tidak berlaku sejak SPEC-123" />
        </Field>
      </Modal>
      {dialog}
    </div>
  );
}

function MemoryCard({ m, tab, history, onApprove, onReject, onInvalidate, onDelete, onHistory }: {
  m: MemoryListItem; tab: TabKey; history: MemoryEventView[] | "loading" | undefined;
  onApprove: () => void; onReject: () => void; onInvalidate: () => void; onDelete: () => void; onHistory: () => void;
}) {
  const v = verdictBadge(m.local);
  return (
    <Card>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <Badge tone={KIND_TONE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
        {m.reviewReason && tab === "review" && <Badge tone="brass">{REVIEW_REASON_LABEL[m.reviewReason] ?? m.reviewReason}</Badge>}
        {tab === "active" && <Badge tone={v.tone}>{v.label}</Badge>}
        {m.local.needsConfirm && <Badge tone="warn">perlu dikonfirmasi</Badge>}
        {tab === "archive" && <Badge tone="neutral">{m.status === "rejected" ? "ditolak" : "dibatalkan"}</Badge>}
        {!m.trusted && <Badge tone="warn">sumber tak tepercaya</Badge>}
      </div>
      <p style={{ margin: "0 0 8px", color: "var(--text-strong)" }}>{m.content}</p>
      <div style={{ display: "grid", gap: 2, fontSize: 12.5, color: "var(--text-subtle)" }}>
        {m.anchors.length > 0 && <div>jangkar: <span style={{ fontFamily: "var(--font-mono)" }}>{m.anchors.map((a) => a.path).join(", ")}</span></div>}
        {m.scopePaths.length > 0 && <div>berlaku: <span style={{ fontFamily: "var(--font-mono)" }}>{m.scopePaths.join(", ")}</span></div>}
        <div>sumber: {sourceLine(m)}</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {tab === "review" && <>
          <Button size="sm" leftIcon="check" onClick={onApprove}>Setujui</Button>
          <Button size="sm" variant="secondary" onClick={onReject}>Tolak…</Button>
        </>}
        {tab === "active" && <Button size="sm" variant="secondary" onClick={onInvalidate}>Batalkan…</Button>}
        <Button size="sm" variant="ghost" onClick={onHistory}>Riwayat</Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>Hapus permanen…</Button>
      </div>
      {history === "loading" && <StateBlock kind="loading" compact />}
      {Array.isArray(history) && (
        <ol style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--text-subtle)" }}>
          {history.map((e) => (
            <li key={e.id}>
              {OP_LABEL[e.op] ?? e.op} · {e.actorKind}{e.actorId ? ` ${e.actorId}` : ""}
              {e.reason ? ` — ${e.reason}` : ""} · {new Date(e.createdAt).toLocaleString("id-ID")}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
