import React from "react";
import { Modal, Input, Select, Button, Badge, Callout, StateBlock, Icon, Pager, serverPage } from "../ds";
import { api } from "../api/client";
import { SESSION_KINDS, SESSION_KIND_LABEL, restartableKind, sessionOutcome, type SessionHistoryView } from "@hanoman/shared";

const PAGE = 20;

// Durasi manusiawi. Sesi yang belum ditutup tak punya durasi — jangan mengarang "0 dtk".
export function humanDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "—";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  return `${h} jam ${m % 60} mnt`;
}

export function statusOf(r: SessionHistoryView): { label: string; tone: "ok" | "err" | "warn" | "neutral" } {
  switch (sessionOutcome(r)) {
    case "running": return { label: "berjalan", tone: "neutral" };
    // SPEC-844 · ADR-0125 · panenya lenyap saat boot: bukan sukses (hijau berbohong) dan bukan
    // kegagalan terbukti (merah mengarang) — hasilnya memang tak diketahui.
    case "interrupted": return { label: "terputus", tone: "warn" };
    case "failed": return { label: `exit ${r.exitCode}`, tone: "err" };
    default: return { label: "selesai", tone: "ok" };
  }
}

// Baris terputus tak punya durasi yang bisa dipercaya: `endedAt`-nya batas bawah (waktu baris
// terakhir disentuh = waktu lahirnya), `reconciledAt` batas atasnya. "0 dtk" adalah angka karangan
// — prinsip yang sama dengan `humanDuration` untuk sesi yang belum ditutup.
export const durationOf = (r: SessionHistoryView): string =>
  sessionOutcome(r) === "interrupted" ? "—" : humanDuration(r.startedAt, r.endedAt);

const labelOfKind = (kind: string): string =>
  SESSION_KIND_LABEL[kind as keyof typeof SESSION_KIND_LABEL] ?? kind;

// SPEC-362 · ADR-0079 · riwayat sesi sebagai MODAL, bukan panel tetap: grid terminal di belakangnya
// tak berubah ukuran sama sekali (syarat "tidak menghalangi UI terminal"). Pola sama dengan
// BacklogPicker di TerminalScreen.
export function SessionHistoryModal({ projects, onClose, onRestart }: {
  projects: { id: string; name: string }[];
  onClose: () => void;
  onRestart: (row: SessionHistoryView) => void;
}) {
  const [items, setItems] = React.useState<SessionHistoryView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(false);
  const [project, setProject] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [q, setQ] = React.useState("");
  const [dq, setDq] = React.useState("");
  const [selected, setSelected] = React.useState<SessionHistoryView | null>(null);

  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  // AC-15 · ganti penyaring = kembali ke halaman 1. Halaman 5 dari filter lama menjawab daftar
  // filter baru yang cuma punya 2 halaman → daftar kosong tanpa sebab.
  React.useEffect(() => { setPage(1); }, [project, kind, dq]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api.listSessionHistory({
      projectId: project || undefined, kind: kind || undefined, q: dq || undefined, page, limit: PAGE,
    })
      .then((r) => {
        if (!alive) return;
        setTotal(r.total);
        // SPEC-523 · halaman MENGGANTI isi. Muat-lebih (append) dicabut demi satu pola paginasi
        // yang sama dengan backlog/project/tiket — objective SPEC-523.
        setItems(r.items);
      })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [project, kind, dq, page]);

  const sp = serverPage(total, page, PAGE);

  const nameOf = (pid: string) => projects.find((p) => p.id === pid)?.name ?? pid;

  return (
    <Modal open title="Riwayat sesi" icon="history" onClose={onClose} width={900}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <Input size="sm" leftIcon="search" placeholder="mis. spec-412 atau reverse" aria-label="Cari riwayat sesi"
          value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          style={{ flex: "1 1 200px" }} />
        <Select size="sm" aria-label="Filter project" value={project} onChange={(e) => setProject(e.target.value)}
          options={[{ value: "", label: "Semua project" }].concat(projects.map((p) => ({ value: p.id, label: p.name })))} />
        <Select size="sm" aria-label="Filter jenis" value={kind} onChange={(e) => setKind(e.target.value)}
          options={[{ value: "", label: "Semua jenis" }].concat(
            SESSION_KINDS.map((k) => ({ value: k, label: SESSION_KIND_LABEL[k] })))} />
      </div>

      {items.length === 0 && !loading ? (
        <StateBlock kind="empty" icon="history" title="Belum ada riwayat sesi"
          hint="Riwayat terisi sendiri saat sesi terminal dibuka lalu ditutup — termasuk sesi backlog, terminal biasa, dan sesi project-level." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "60vh", overflowY: "auto" }}>
          {items.map((r) => {
            const st = statusOf(r);
            return (
              // SPEC-763 · cermin baris "Ambil backlog", tiga cacat yang sama: `all: "unset"`
              // inline mengalahkan `button { min-height: var(--touch-target) }`; kotak tombol tak
              // menumbuhkan tinggi untuk baris flex yang membungkus (jadi pembungkusnya <span> di
              // DALAM tombol); dan daftar flex-column ber-`maxHeight` memeras barisnya di bawah
              // konten kalau `flex: 0 0 auto` tak dinyatakan.
              <button key={r.id} onClick={() => setSelected(r)} style={{
                cursor: "pointer", display: "block", width: "100%", flex: "0 0 auto",
                font: "inherit", color: "inherit", textAlign: "left", background: "transparent",
                padding: "9px 8px", border: "none", borderBottom: "1px solid var(--border-hair)",
              }}>
                <span className="hn-dense-row hn-picker-row" style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)", flex: "0 0 132px" }}>
                  {new Date(r.startedAt).toLocaleString("id-ID")}
                </span>
                <Badge size="sm" tone="neutral">{labelOfKind(r.kind)}</Badge>
                <span className="hn-picker-title" style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-strong)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title ?? r.specId ?? nameOf(r.projectId)}
                </span>
                {r.transcriptBytes !== null && <Icon name="file-text" size={12} color="var(--text-subtle)" />}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", flex: "0 0 72px" }}>
                  {durationOf(r)}
                </span>
                <Badge size="sm" tone={st.tone}>{st.label}</Badge>
                </span>
              </button>
            );
          })}
          {loading && (
            <div style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "var(--text-subtle)" }}>memuat…</div>
          )}
        </div>
      )}
      {/* SPEC-523 · kontrol halaman DS, sama dengan backlog/project/tiket. Ia sendiri yang
          menyatakan "N–M dari T", jadi baris penutup SPEC-351 tak lagi perlu. */}
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
        onPage={setPage} unit="sesi" />

      {selected && <SessionHistoryDetail row={selected} projectName={nameOf(selected.projectId)}
        onBack={() => setSelected(null)} onRestart={onRestart} />}
    </Modal>
  );
}

// Detail satu baris riwayat: metadata + transkrip read-only. Transkrip dirender sebagai TEKS POLOS
// di <pre> — server menyimpannya tanpa `capture-pane -e`, jadi tak ada ANSI yang perlu (atau boleh)
// ditafsirkan jadi HTML.
function SessionHistoryDetail({ row, projectName, onBack, onRestart }: {
  row: SessionHistoryView; projectName: string; onBack: () => void; onRestart: (r: SessionHistoryView) => void;
}) {
  const [text, setText] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"idle" | "loading" | "none" | "error">("idle");

  React.useEffect(() => {
    // Baris tanpa transkrip tak perlu request — 404-nya sudah bisa diprediksi dari metadata.
    if (row.transcriptBytes === null) { setState("none"); setText(null); return; }
    let alive = true;
    setState("loading");
    api.sessionTranscript(row.id)
      .then((r) => { if (alive) { setText(r.text); setState("idle"); } })
      .catch(() => { if (alive) { setText(null); setState("error"); } });
    return () => { alive = false; };
  }, [row.id, row.transcriptBytes]);

  const interrupted = sessionOutcome(row) === "interrupted";
  const meta: [string, string][] = [
    ["Project", projectName],
    ["Sesi", row.sessionId],
    ["Jenis", labelOfKind(row.kind)],
    ["Agen", [row.agent, row.model, row.effort].filter(Boolean).join(" · ")],
    ["Mulai", new Date(row.startedAt).toLocaleString("id-ID")],
    // Baris terputus punya DUA stempel yang berbeda artinya, jadi satu label "Selesai" berbohong.
    [interrupted ? "Terakhir terlihat hidup" : "Selesai",
      row.endedAt ? new Date(row.endedAt).toLocaleString("id-ID") : "berjalan"],
    ...(interrupted && row.reconciledAt
      ? [["Terdeteksi mati", new Date(row.reconciledAt).toLocaleString("id-ID")] as [string, string]]
      : []),
    ["Durasi", durationOf(row)],
    ["Direktori", row.cwd],
  ];
  if (row.specId) meta.splice(1, 0, ["Backlog", `${row.specId}${row.title ? ` · ${row.title}` : ""}`]);
  if (row.branch) meta.push(["Branch", row.branch]);

  return (
    <Modal open title={row.title ?? row.specId ?? row.sessionId} icon="history" onClose={onBack} width={1000}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <Button size="sm" variant="ghost" leftIcon="arrow-left" onClick={onBack}>Kembali</Button>
        <div style={{ flex: 1 }} />
        {text && (
          <Button size="sm" variant="secondary" leftIcon="copy"
            onClick={() => void navigator.clipboard?.writeText(text)}>Salin transkrip</Button>
        )}
        {/* Sesi lama tak pernah "hidup lagi" — tmux sudah membunuhnya. Ini men-spawn sesi BARU
            dengan konteks yang sama, dan hanya untuk kind yang konteksnya bisa dibangun ulang. */}
        {restartableKind(row.kind) && (
          <Button size="sm" leftIcon="play" onClick={() => onRestart(row)}>Mulai lagi</Button>
        )}
      </div>

      {interrupted && (
        <Callout tone="warn" title="Sesi terputus — hasilnya tak diketahui" style={{ marginBottom: 12 }}>
          Panenya sudah lenyap saat hanoman menyala lagi (reboot, <code>tmux kill-server</code>, atau
          host mati), jadi sesi ini tak meninggalkan exit code dan transkripnya kemungkinan besar tak
          sempat diambil — capture berjalan tepat sebelum pane dibunuh, dan di jalur ini sudah tak ada
          pane untuk dibaca. Periksa worktree &amp; branch sesi ini sebelum menganggapnya selesai, lalu
          mulai lagi bila pekerjaannya belum tuntas.
        </Callout>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginBottom: 12,
        fontSize: 12 }}>
        {meta.map(([k, v]) => (
          <React.Fragment key={k}>
            <span style={{ color: "var(--text-subtle)" }}>{k}</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-body)", wordBreak: "break-all" }}>{v}</span>
          </React.Fragment>
        ))}
      </div>

      {state === "loading" && <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>memuat transkrip…</div>}
      {state === "none" && (
        <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>
          {interrupted
            ? "Tanpa transkrip — panenya sudah lenyap sebelum hanoman sempat mengambilnya."
            : "Tanpa transkrip — sesi ini ditutup sebelum fitur riwayat ada, atau panenya tak menyisakan keluaran."}
        </div>
      )}
      {state === "error" && (
        <div style={{ fontSize: 12, color: "var(--clay-600)" }}>Transkrip tak terbaca lagi di server.</div>
      )}
      {text !== null && (
        <pre style={{
          maxHeight: "52vh", overflow: "auto", margin: 0, padding: 10,
          background: "var(--bone-200)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: 11,
          whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-body)",
        }}>{text}</pre>
      )}
    </Modal>
  );
}
