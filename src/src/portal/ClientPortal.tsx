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
import { TicketNote, TicketTimeline } from "./TicketTimeline";
import { ticketNote } from "./ticket-timeline";
import { kategoriLabel, prioritasLabel, jaringanAtauPesan } from "./labels";
import "./portal.css";

// SPEC-617 · ADR-0110 · permukaan klien. SENGAJA tidak memakai <Shell>: sidebar HN_NAV adalah
// navigasi OPERATOR, dan setiap entrinya adalah 403 yang menunggu diklik. Chrome-nya sendiri,
// minimal, mengikuti design system (bone paper, brass accent). Tak ada satu pun aksi tulis
// selain "Lapor masalah".
//
// Audit UI/UX 2026-10 · Fase 3 (3M) · "Beranda Klien" per project. Pertanyaan yang dijawab layar
// ini: "Bagaimana masalah saya?" — tiap keluhan tampil sebagai linimasa 4 langkah (Diterima →
// Ditinjau → Dikerjakan → Selesai) dengan satu kalimat keadaan. Progres pekerjaan tim tinggal di
// tab sendiri; obrolan tetap tab karena sesinya milik project, bukan milik satu keluhan.

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

type Tab = "keluhan" | "progres" | "tanya";

const EMPTY: Paginated<never> = { items: [], total: 0, page: 1, pageSize: PORTAL_PAGE };

/* Pager DS, satu bentuk untuk kedua daftar. `total` datang dari amplop server — bukan
   `items.length`, yang sesudah paginasi hanya menjawab "berapa baris yang kebetulan tampil".
   Tanpa `FIXED_ROW_STYLE`: portal hanya punya satu scroller (`<main>`, SPEC-626) dan tak memakai
   rantai flex per-daftar seperti layar operator, jadi Pager ikut menggulir di ujung daftarnya. */
function PortalPager({ total, page, onPage, unit }:
  { total: number; page: number; onPage: (n: number) => void; unit: string }) {
  const sp = serverPage(total, page, PORTAL_PAGE);
  return (
    <div className="hn-portal-pager">
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />
    </div>
  );
}

export function ClientPortal({ user, onLoggedOut }: { user: UserView; onLoggedOut: () => void }) {
  const [projects, setProjects] = React.useState<PortalProject[] | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>("keluhan");
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

  const activeProject = projects?.find((p) => p.id === active);
  const activeName = activeProject?.name ?? "";
  // SPEC-854 · ADR-0129 · ADR-0211 · chat portal opt-in. Penandanya datang bersama daftar project
  // dari server (`chatEnabled`, gerbang yang sama dengan route chat), jadi tak ada request probe ke
  // /chat/sessions hanya untuk menebak apakah tab ini boleh ada. Settings tetap tak dibaca klien.
  const chatAda = activeProject?.chatEnabled === true;
  // Tab "tanya" yang tertinggal dari project lain (chat-nya mati di project ini) jatuh ke Keluhan,
  // bukan ke ChatPanel yang akan menembak route 404.
  const tabAktif: Tab = tab === "tanya" && !chatAda ? "keluhan" : tab;

  return (
    // SPEC-626 · `#root` (app.css) mengunci viewport — benar untuk Shell operator
    // yang menggulir di panel dalamnya. Portal tidak memakai Shell, jadi ia harus memasang rantai
    // gulirnya SENDIRI: header di luar scroller (tetap terbaca), <main> yang menggulir. Konstanta
    // DS yang sama dengan layar operator — bukan angka baru, dan app.css tak disentuh.
    <div data-testid="portal-root" className="hn-dynamic-viewport hn-portal" style={{
      height: "100dvh", minHeight: 0, display: "flex", flexDirection: "column",
      background: "var(--surface-page)", color: "var(--text-body)",
    }}>
      <header className="hn-portal-header" style={FIXED_ROW_STYLE}>
        <span className="hn-portal-mark"><Mark id="buntut" size={17} color="var(--surface-card)" /></span>
        <span className="hn-portal-brand">Klien</span>
        <div className="hn-portal-spacer" />
        <span className="hn-portal-who">{user.email}</span>
        <Button size="sm" variant="ghost" leftIcon="log-out" onClick={logout}>Keluar</Button>
      </header>

      <main data-testid="portal-scroll" style={LIST_SCROLL_STYLE}>
        <div className="hn-portal-content">
        {bukaGagal && <p role="alert" className="hn-portal-alert">{bukaGagal}</p>}
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
              {projects.length > 1 && (
                <div className="hn-portal-projects">
                  {projects.map((p) => (
                    <Button key={p.id} size="sm" variant={p.id === active ? "primary" : "ghost"}
                      aria-pressed={p.id === active} onClick={() => setActive(p.id)}>{p.name}</Button>
                  ))}
                </div>
              )}

              <div className="hn-portal-head">
                <div className="hn-portal-titlebox">
                  <h1 className="hn-portal-title">{activeName}</h1>
                  <p className="hn-portal-sub">Beranda Klien · lihat bagaimana masalah Anda berkembang di sini.</p>
                </div>
                <Button variant="primary" leftIcon="send" onClick={() => setComposing(true)}>Lapor masalah</Button>
              </div>

              <div className="hn-portal-tabs-row">
                <Tabs className="hn-portal-tabs" value={tabAktif} onChange={(v) => setTab(v as Tab)} tabs={[
                  { value: "keluhan", label: "Keluhan saya", count: tickets.total },
                  { value: "progres", label: "Progres pekerjaan", count: backlog.total },
                  // SPEC-854 · ADR-0129 · tab hanya lahir kalau chat menyala (`chatEnabled`, ADR-0211).
                  ...(chatAda ? [{ value: "tanya", label: "Tanya & ide" }] : []),
                ]} />
              </div>

              {tabAktif === "tanya" ? <ChatPanel projectId={active!} /> : listGagal ? (
                <StateBlock kind="error" title="Daftar belum bisa dimuat" hint={listGagal}
                  action={() => setReload((n) => n + 1)} actionLabel="Coba lagi" />
              ) : tabAktif === "progres" ? (
                backlog.total === 0
                  ? <StateBlock kind="empty" icon="list-checks" title="Belum ada pekerjaan tercatat"
                      hint="Begitu tim mulai mengerjakan sesuatu di project ini, daftarnya muncul di sini." />
                  : <>
                      <p className="hn-portal-note">Ini pekerjaan yang dikerjakan tim untuk project ini. Keluhan Anda ada di tab Keluhan saya.</p>
                      <Card padding={0} data-testid="portal-list" className="hn-portal-list">
                        {backlog.items.map((s) => (
                          <button key={s.id} type="button" className="hn-portal-row"
                            onClick={() => void openSpecDetail(s.id)}>
                            <span className="hn-portal-row-title" title={s.title}>{s.title}</span>
                            <StatusPill status={stagePill(s.stage)} size="sm">{STAGE_LABEL[s.stage] ?? s.stage}</StatusPill>
                            <span className="hn-portal-meta">{prioritasLabel(s.priority)}</span>
                            <span className="hn-portal-meta">{tanggal(s.doneAt ?? s.startedAt ?? s.createdAt)}</span>
                          </button>
                        ))}
                      </Card>
                      <PortalPager total={backlog.total} page={bPage} onPage={setBPage} unit="pekerjaan" />
                    </>
              ) : (
                tickets.total === 0
                  ? <StateBlock kind="empty" illustration="PST-002" illustrationDecorative
                      title="Belum ada keluhan" hint="Ada yang tidak berfungsi? Lapor di sini. Perkembangannya akan tampil di halaman ini."
                      action={() => setComposing(true)} actionLabel="Lapor masalah" />
                  : <>
                      <ul className="hn-portal-cases" data-testid="portal-list">
                        {tickets.items.map((t) => (
                          <li key={t.id} className="hn-portal-case">
                            <div className="hn-portal-case-head">
                              <span className="hn-portal-case-num">#{t.number}</span>
                              <button type="button" className="hn-portal-case-title"
                                onClick={() => void openTicketDetail(t.id)}>{t.title}</button>
                              <StatusPill status={ticketPill(t.status)} size="sm">{t.status}</StatusPill>
                            </div>
                            <TicketTimeline status={t.status} compact />
                            <p className="hn-portal-case-note">{ticketNote(t.status)}</p>
                            <span className="hn-portal-case-meta">{kategoriLabel(t.category)} · dikirim {tanggal(t.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                      <PortalPager total={tickets.total} page={tPage} onPage={setTPage} unit="keluhan" />
                    </>
              )}
            </>
          )}
        </div>
      </main>

      {composing && projects && projects.length > 0 && (
        <TicketForm projects={projects} activeId={active!} email={user.email} onCancel={() => setComposing(false)}
          onSent={(id) => {
            setComposing(false);
            setTab("keluhan");
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
          <div className="hn-portal-detail">
            <div className="hn-portal-pillrow">
              <StatusPill status={stagePill(openSpec.stage)} size="sm">
                {STAGE_LABEL[openSpec.stage] ?? openSpec.stage}
              </StatusPill>
              <span className="hn-portal-meta">{prioritasLabel(openSpec.priority)}</span>
            </div>
            <p className="hn-portal-body">{openSpec.objective}</p>
            <dl className="hn-portal-dl">
              <dt>Dibuat</dt><dd>{tanggal(openSpec.createdAt)}</dd>
              <dt>Mulai</dt><dd>{tanggal(openSpec.startedAt)}</dd>
              <dt>Selesai</dt><dd>{tanggal(openSpec.doneAt)}</dd>
            </dl>
          </div>
        )}
      </Modal>

      <Modal open={!!openTicket} title={openTicket?.title ?? ""}
        eyebrow={openTicket ? `#${openTicket.number} · ${kategoriLabel(openTicket.category)}` : undefined}
        onClose={() => setOpenTicket(null)}>
        {openTicket && (
          <div className="hn-portal-detail">
            <div><StatusPill status={ticketPill(openTicket.status)} size="sm">{openTicket.status}</StatusPill></div>
            <TicketTimeline status={openTicket.status} />
            <TicketNote status={openTicket.status} />
            <p className="hn-portal-body">{openTicket.detail}</p>
            <dl className="hn-portal-dl">
              <dt>Dikirim</dt><dd>{tanggal(openTicket.createdAt)}</dd>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}
