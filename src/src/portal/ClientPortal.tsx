import React from "react";
import type { Paginated, PortalProject, PortalSpec, PortalTicket, PortalTicketDetail, UserView } from "@hanoman/shared";
import {
  Button, Card, FIXED_ROW_STYLE, LIST_SCROLL_STYLE, Modal, Pager, serverPage, StateBlock,
  StatusPill, Tabs,
} from "../ds";
import { Mark } from "../ds/marks";
import { portalApi } from "../api/portal";
import { stagePill, ticketPill } from "./status-pill";
import { TicketForm } from "./TicketForm";
import { ChatPanel } from "./ChatPanel";
import { kategoriLabel, prioritasLabel, jaringanAtauPesan } from "./labels";

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

// SPEC-647 · ADR-0107 · ukuran halaman portal, cermin `TICKET_PAGE` TriageScreen (SPEC-523).
const PORTAL_PAGE = 20;

const EMPTY: Paginated<never> = { items: [], total: 0, page: 1, pageSize: PORTAL_PAGE };

/* Pager DS, satu bentuk untuk kedua daftar. `total` datang dari amplop server — bukan
   `items.length`, yang sesudah paginasi hanya menjawab "berapa baris yang kebetulan tampil".
   Tanpa `FIXED_ROW_STYLE`: portal hanya punya satu scroller (`<main>`, SPEC-626) dan tak memakai
   rantai flex per-daftar seperti layar operator, jadi Pager ikut menggulir di ujung daftarnya. */
function PortalPager({ total, page, onPage, unit }:
  { total: number; page: number; onPage: (n: number) => void; unit: string }) {
  const sp = serverPage(total, page, PORTAL_PAGE);
  return (
    <div style={{ marginTop: 14, border: "1px solid var(--border-hair)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />
    </div>
  );
}

export function ClientPortal({ user, onLoggedOut }: { user: UserView; onLoggedOut: () => void }) {
  const [projects, setProjects] = React.useState<PortalProject[] | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("backlog");
  const [backlog, setBacklog] = React.useState<Paginated<PortalSpec>>(EMPTY);
  const [tickets, setTickets] = React.useState<Paginated<PortalTicket>>(EMPTY);
  // Satu nomor halaman per daftar: satu nomor bersama akan meminta halaman yang tak dimiliki
  // daftar tetangga, dan tab yang baru dibuka sempat merender keadaan kosong palsu.
  const [bPage, setBPage] = React.useState(1);
  const [tPage, setTPage] = React.useState(1);
  const [reload, setReload] = React.useState(0);
  const [openSpec, setOpenSpec] = React.useState<PortalSpec | null>(null);
  const [openTicket, setOpenTicket] = React.useState<PortalTicketDetail | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [projReload, setProjReload] = React.useState(0);
  // Gagal memuat daftar ≠ daftar kosong: keadaannya dipisah dan bisa dicoba ulang.
  const [listGagal, setListGagal] = React.useState<string | null>(null);
  const [bukaGagal, setBukaGagal] = React.useState<string | null>(null);
  const [composing, setComposing] = React.useState(false);
  // SPEC-854 · ADR-0129 · chat portal opt-in. Kehadirannya disimpulkan dari route-nya sendiri,
  // bukan dari knob yang disalin ke klien: Settings adalah permukaan operator dan tak pernah
  // dibaca akun klien (ADR-0110).
  const [chatAda, setChatAda] = React.useState(false);

  React.useEffect(() => {
    setProjects(null); setFailed(false);
    portalApi.listProjects()
      .then((r) => { setProjects(r.items); setActive((cur) => cur ?? r.items[0]?.id ?? null); })
      .catch(() => { setProjects([]); setFailed(true); });
  }, [projReload]);

  // Respons yang datang terlambat tak boleh menimpa halaman yang lebih baru: klik halaman
  // beruntun melahirkan dua permintaan yang tak dijamin selesai berurutan.
  const seqRef = React.useRef(0);
  const loadLists = React.useCallback((id: string, bp: number, tp: number) => {
    const seq = ++seqRef.current;
    // Kedua daftar dimuat bersama karena angka di tab wajib `total` — lencana yang mengecil saat
    // klien membuka halaman 2 adalah kebohongan (ADR-0107).
    void Promise.all([
      portalApi.listBacklog(id, { page: bp, limit: PORTAL_PAGE }),
      portalApi.listTickets(id, { page: tp, limit: PORTAL_PAGE }),
    ])
      .then(([b, t]) => { if (seq === seqRef.current) { setBacklog(b); setTickets(t); setListGagal(null); } })
      .catch((e) => { if (seq === seqRef.current) setListGagal(jaringanAtauPesan(e, "Daftar belum bisa dimuat.")); });
  }, []);

  React.useEffect(() => { if (active) loadLists(active, bPage, tPage); }, [active, bPage, tPage, reload, loadLists]);
  React.useEffect(() => {
    if (!active) return;
    setChatAda(false);
    portalApi.listChatSessions(active, { page: 1, limit: 1 })
      .then(() => setChatAda(true))
      .catch(() => setChatAda(false));
  }, [active]);
  // Ganti project atau tab = kembali ke halaman 1 (idiom TriageScreen SPEC-523): halaman 5 dari
  // konteks lama menjawab daftar konteks baru yang cuma punya 2 halaman → kosong tanpa sebab.
  React.useEffect(() => { setBPage(1); setTPage(1); }, [active, tab]);

  // Membuka detail gagal → pesan di atas daftar, bukan klik yang diam saja.
  const openSpecDetail = async (id: string) => {
    setBukaGagal(null);
    try { setOpenSpec(await portalApi.getSpec(active!, id)); }
    catch (e) { setBukaGagal(jaringanAtauPesan(e, "Pekerjaan ini belum bisa dibuka. Coba lagi.")); }
  };
  const openTicketDetail = async (id: string) => {
    setBukaGagal(null);
    try { setOpenTicket(await portalApi.getTicket(active!, id)); }
    catch (e) { setBukaGagal(jaringanAtauPesan(e, "Laporan ini belum bisa dibuka. Coba lagi.")); }
  };

  const logout = async () => {
    try { await portalApi.logout(); } catch { /* jaringan gagal — klien tetap dibersihkan */ }
    finally { onLoggedOut(); }
  };

  return (
    // SPEC-626 · `#root` (app.css) mengunci viewport — benar untuk Shell operator
    // yang menggulir di panel dalamnya. Portal tidak memakai Shell, jadi ia harus memasang rantai
    // gulirnya SENDIRI: header di luar scroller (tetap terbaca), <main> yang menggulir. Konstanta
    // DS yang sama dengan layar operator — bukan angka baru, dan app.css tak disentuh.
    <div data-testid="portal-root" className="hn-dynamic-viewport" style={{
      height: "100dvh", minHeight: 0, display: "flex", flexDirection: "column",
      background: "var(--surface-page)", color: "var(--text-body)",
    }}>
      <header className="hn-portal-header" style={{
        ...FIXED_ROW_STYLE,
        display: "flex", alignItems: "center", gap: 14, padding: "0 22px",
        height: "var(--topbar-h)", borderBottom: "1px solid var(--border-hair)",
        background: "var(--bone-100)",
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: "var(--radius-sm)", background: "var(--accent)",
        }}><Mark id="buntut" size={17} color="var(--surface-card)" /></span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, color: "var(--text-strong)" }}>
          Portal klien
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{user.email}</span>
        <Button size="sm" variant="ghost" leftIcon="log-out" onClick={logout}>Keluar</Button>
      </header>

      <main data-testid="portal-scroll" style={LIST_SCROLL_STYLE}>
        <div className="hn-portal-content" style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: "24px 28px 32px" }}>
        {bukaGagal && <p role="alert" style={{ margin: "0 0 14px", color: "var(--clay-600)", fontSize: 13 }}>{bukaGagal}</p>}
        {projects === null ? <StateBlock kind="loading" title="Memuat…" />
          : projects.length === 0 ? (
            <StateBlock kind={failed ? "error" : "empty"} icon="folder"
              title={failed ? "Gagal memuat data" : "Belum ada project yang bisa dilihat"}
              hint={failed ? "Project Anda belum bisa dimuat. Periksa koneksi, lalu coba lagi."
                : "Hubungi tim hanoman untuk meminta akses ke project Anda."}
              action={failed ? () => setProjReload((n) => n + 1) : undefined}
              actionLabel={failed ? "Coba lagi" : undefined} />
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                {projects.map((p) => (
                  <Button key={p.id} size="sm" variant={p.id === active ? "primary" : "ghost"}
                    aria-pressed={p.id === active} onClick={() => setActive(p.id)}>{p.name}</Button>
                ))}
              </div>

              <div className="hn-portal-toolbar" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <Tabs value={tab} onChange={setTab} style={{ flex: 1, minWidth: 0 }} tabs={[
                  { value: "backlog", label: "Progres pekerjaan", count: backlog.total },
                  { value: "tickets", label: "Laporan & keluhan", count: tickets.total },
                  // SPEC-854 · ADR-0129 · tab hanya lahir kalau chat menyala di Settings; selama
                  // mati, route-nya 404 dan `chatAda` tetap false (tak ada tab yang menipu).
                  ...(chatAda ? [{ value: "chat", label: "Obrolan" }] : []),
                ]} />
                <Button size="sm" leftIcon="send" onClick={() => setComposing(true)}>Kirim keluhan</Button>
              </div>

              {tab === "chat" ? <ChatPanel projectId={active!} /> : listGagal ? (
                <StateBlock kind="error" title="Daftar belum bisa dimuat" hint={listGagal}
                  action={() => setReload((n) => n + 1)} actionLabel="Coba lagi" />
              ) : tab === "backlog" ? (
                backlog.total === 0
                  ? <StateBlock kind="empty" icon="list-checks" title="Belum ada pekerjaan tercatat"
                      hint="Begitu tim mulai mengerjakan sesuatu di project ini, daftarnya muncul di sini." />
                  : <>
                      <Card padding={0} data-testid="portal-list">
                        {backlog.items.map((s) => (
                          <button key={s.id} type="button" className="hn-portal-row"
                            onClick={() => void openSpecDetail(s.id)}
                            style={ROW}>
                            <span title={s.title} style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                            <StatusPill status={stagePill(s.stage)} size="sm">{STAGE_LABEL[s.stage] ?? s.stage}</StatusPill>
                            <span style={META}>{prioritasLabel(s.priority)}</span>
                            <span style={META}>{tanggal(s.doneAt ?? s.startedAt ?? s.createdAt)}</span>
                          </button>
                        ))}
                      </Card>
                      <PortalPager total={backlog.total} page={bPage} onPage={setBPage} unit="pekerjaan" />
                    </>
              ) : (
                tickets.total === 0
                  ? <StateBlock kind="empty" icon="inbox" title="Belum ada tiket"
                      hint="Kirim keluhan lewat tombol Kirim keluhan di atas — atau lewat halaman Help Center project ini." />
                  : <>
                      <Card padding={0} data-testid="portal-list">
                        {tickets.items.map((t) => (
                          <button key={t.id} type="button" className="hn-portal-row"
                            onClick={() => void openTicketDetail(t.id)}
                            style={ROW}>
                            <span style={{ ...META, fontFamily: "var(--font-mono)", width: 48 }}>#{t.number}</span>
                            <span title={t.title} style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                            <span style={META}>{kategoriLabel(t.category)}</span>
                            <StatusPill status={ticketPill(t.status)} size="sm">{t.status}</StatusPill>
                            <span style={META}>{tanggal(t.createdAt)}</span>
                          </button>
                        ))}
                      </Card>
                      <PortalPager total={tickets.total} page={tPage} onPage={setTPage} unit="tiket" />
                    </>
              )}
            </>
          )}
        </div>
      </main>

      {composing && projects && projects.length > 0 && (
        <TicketForm projects={projects} activeId={active!} onCancel={() => setComposing(false)}
          onSent={(id) => {
            setComposing(false);
            setTab("tickets");
            // Tiket baru duduk paling atas (createdAt desc), jadi memuat ulang di halaman yang
            // sedang aktif akan menyembunyikan tiket yang baru saja dikirim.
            setTPage(1);
            // Dimuat ulang dari server, bukan disisipkan di klien: yang tampil adalah tiket
            // seperti yang dilihat operator, bukan tebakan bentuk baris. Lewat `reload` supaya
            // reset halaman + pemuatan jadi SATU fetch, bukan dua.
            if (id === active) setReload((n) => n + 1); else setActive(id);
          }} />
      )}

      <Modal open={!!openSpec} title={openSpec?.title ?? ""} eyebrow="pekerjaan"
        onClose={() => setOpenSpec(null)}>
        {openSpec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusPill status={stagePill(openSpec.stage)} size="sm">
                {STAGE_LABEL[openSpec.stage] ?? openSpec.stage}
              </StatusPill>
              <span style={META}>{prioritasLabel(openSpec.priority)}</span>
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
        eyebrow={openTicket ? `#${openTicket.number} · ${kategoriLabel(openTicket.category)}` : undefined}
        onClose={() => setOpenTicket(null)}>
        {openTicket && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div><StatusPill status={ticketPill(openTicket.status)} size="sm">{openTicket.status}</StatusPill></div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{openTicket.detail}</p>
            <span style={META}>Dikirim {tanggal(openTicket.createdAt)}</span>
          </div>
        )}
      </Modal>
    </div>
  );
}

const ROW: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 16px",
  border: "none", borderBottom: "1px solid var(--border-hair)", cursor: "pointer",
  background: "transparent", color: "inherit", font: "inherit", textAlign: "left",
};
const META: React.CSSProperties = { fontSize: "var(--text-sm)", color: "var(--text-subtle)" };
const DL: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", margin: 0 };
const DD: React.CSSProperties = { margin: 0, fontSize: "var(--text-sm)" };
