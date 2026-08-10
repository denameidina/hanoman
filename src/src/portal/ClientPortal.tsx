import React from "react";
import type { PortalProject, PortalSpec, PortalTicket, PortalTicketDetail, UserView } from "@hanoman/shared";
import { Button, Card, Modal, StateBlock, StatusPill, Tabs } from "../ds";
import { Mark } from "../ds/marks";
import { portalApi } from "../api/portal";

// SPEC-617 · ADR-0110 · permukaan klien. SENGAJA tidak memakai <Shell>: sidebar HN_NAV adalah
// navigasi OPERATOR, dan setiap entrinya adalah 403 yang menunggu diklik. Chrome-nya sendiri,
// minimal, mengikuti design system (bone paper, brass accent). Tak ada satu pun aksi tulis.

const tanggal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

// Kosakata yang dibaca klien, bukan stage internal — cermin `publicStatus()` untuk tiket
// (SPEC-293). Stage yang tak dikenal jatuh ke labelnya sendiri, bukan ke layar kosong.
const STAGE_LABEL: Record<string, string> = {
  brainstorming: "Dirumuskan", objective: "Dirumuskan", "spec-ready": "Disiapkan",
  planned: "Direncanakan", executing: "Sedang dikerjakan", done: "Selesai",
};
const stageStatus = (stage: string) =>
  stage === "done" ? "done" : stage === "executing" ? "running" : "queued";

export function ClientPortal({ user, onLoggedOut }: { user: UserView; onLoggedOut: () => void }) {
  const [projects, setProjects] = React.useState<PortalProject[] | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("backlog");
  const [backlog, setBacklog] = React.useState<PortalSpec[]>([]);
  const [tickets, setTickets] = React.useState<PortalTicket[]>([]);
  const [openSpec, setOpenSpec] = React.useState<PortalSpec | null>(null);
  const [openTicket, setOpenTicket] = React.useState<PortalTicketDetail | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    portalApi.listProjects()
      .then((r) => { setProjects(r.items); setActive((cur) => cur ?? r.items[0]?.id ?? null); })
      .catch(() => { setProjects([]); setFailed(true); });
  }, []);

  React.useEffect(() => {
    if (!active) return;
    void Promise.all([portalApi.listBacklog(active), portalApi.listTickets(active)])
      .then(([b, t]) => { setBacklog(b.items); setTickets(t.items); })
      .catch(() => { setBacklog([]); setTickets([]); });
  }, [active]);

  const logout = async () => {
    try { await portalApi.logout(); } catch { /* jaringan gagal — klien tetap dibersihkan */ }
    finally { onLoggedOut(); }
  };

  return (
    <div style={{ minHeight: "100%", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 14, padding: "0 22px",
        height: "var(--topbar-h)", borderBottom: "1px solid var(--border-hair)",
        background: "var(--bone-100)",
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: "var(--radius-sm)", background: "var(--accent)",
        }}><Mark id="buntut" size={17} color="#fff" /></span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, color: "var(--text-strong)" }}>
          Portal klien
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{user.email}</span>
        <Button size="sm" variant="ghost" leftIcon="log-out" onClick={logout}>Keluar</Button>
      </header>

      <main style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: "24px 28px 32px" }}>
        {projects === null ? <StateBlock kind="loading" title="Memuat…" />
          : projects.length === 0 ? (
            <StateBlock kind={failed ? "error" : "empty"} icon="folder"
              title={failed ? "Gagal memuat data" : "Belum ada project yang bisa dilihat"}
              hint={failed ? "Coba muat ulang halaman ini."
                : "Hubungi tim hanoman untuk meminta akses ke project Anda."} />
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                {projects.map((p) => (
                  <Button key={p.id} size="sm" variant={p.id === active ? "primary" : "ghost"}
                    onClick={() => setActive(p.id)}>{p.name}</Button>
                ))}
              </div>

              <Tabs value={tab} onChange={setTab} style={{ marginBottom: 14 }} tabs={[
                { value: "backlog", label: "Pekerjaan", count: backlog.length },
                { value: "tickets", label: "Help desk", count: tickets.length },
              ]} />

              {tab === "backlog" ? (
                backlog.length === 0
                  ? <StateBlock kind="empty" icon="list-checks" title="Belum ada pekerjaan tercatat"
                      hint="Begitu tim mulai mengerjakan sesuatu di project ini, daftarnya muncul di sini." />
                  : <Card padding={0}>
                      {backlog.map((s) => (
                        <div key={s.id} role="button" tabIndex={0}
                          onClick={() => void portalApi.getSpec(active!, s.id).then(setOpenSpec)}
                          onKeyDown={(e) => { if (e.key === "Enter") void portalApi.getSpec(active!, s.id).then(setOpenSpec); }}
                          style={ROW}>
                          <span style={{ ...META, fontFamily: "var(--font-mono)", width: 92 }}>{s.id}</span>
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "var(--text-strong)" }}>{s.title}</span>
                          <StatusPill status={stageStatus(s.stage)} size="sm">{STAGE_LABEL[s.stage] ?? s.stage}</StatusPill>
                          <span style={META}>{s.priority}</span>
                          <span style={META}>{tanggal(s.doneAt ?? s.startedAt ?? s.createdAt)}</span>
                        </div>
                      ))}
                    </Card>
              ) : (
                tickets.length === 0
                  ? <StateBlock kind="empty" icon="inbox" title="Belum ada tiket"
                      hint="Keluhan yang dikirim lewat halaman Help Center project ini akan muncul di sini." />
                  : <Card padding={0}>
                      {tickets.map((t) => (
                        <div key={t.id} role="button" tabIndex={0}
                          onClick={() => void portalApi.getTicket(active!, t.id).then(setOpenTicket)}
                          onKeyDown={(e) => { if (e.key === "Enter") void portalApi.getTicket(active!, t.id).then(setOpenTicket); }}
                          style={ROW}>
                          <span style={{ ...META, fontFamily: "var(--font-mono)", width: 48 }}>#{t.number}</span>
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "var(--text-strong)" }}>{t.title}</span>
                          <span style={META}>{t.category}</span>
                          <StatusPill status="idle" size="sm">{t.status}</StatusPill>
                          <span style={META}>{tanggal(t.createdAt)}</span>
                        </div>
                      ))}
                    </Card>
              )}
            </>
          )}
      </main>

      <Modal open={!!openSpec} title={openSpec?.title ?? ""} eyebrow={openSpec?.id}
        onClose={() => setOpenSpec(null)}>
        {openSpec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusPill status={stageStatus(openSpec.stage)} size="sm">
                {STAGE_LABEL[openSpec.stage] ?? openSpec.stage}
              </StatusPill>
              <span style={META}>prioritas {openSpec.priority}</span>
            </div>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{openSpec.objective}</p>
            <dl style={DL}>
              <dt style={META}>Dibuat</dt><dd style={DD}>{tanggal(openSpec.createdAt)}</dd>
              <dt style={META}>Mulai</dt><dd style={DD}>{tanggal(openSpec.startedAt)}</dd>
              <dt style={META}>Selesai</dt><dd style={DD}>{tanggal(openSpec.doneAt)}</dd>
            </dl>
          </div>
        )}
      </Modal>

      <Modal open={!!openTicket} title={openTicket?.title ?? ""}
        eyebrow={openTicket ? `#${openTicket.number} · ${openTicket.category}` : undefined}
        onClose={() => setOpenTicket(null)}>
        {openTicket && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div><StatusPill status="idle" size="sm">{openTicket.status}</StatusPill></div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{openTicket.detail}</p>
            <span style={META}>Dikirim {tanggal(openTicket.createdAt)}</span>
          </div>
        )}
      </Modal>
    </div>
  );
}

const ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
  borderBottom: "1px solid var(--border-hair)", cursor: "pointer",
};
const META: React.CSSProperties = { fontSize: "var(--text-sm)", color: "var(--text-subtle)" };
const DL: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", margin: 0 };
const DD: React.CSSProperties = { margin: 0, fontSize: "var(--text-sm)" };
