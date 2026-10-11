/* PublicHelpApp — halaman PUBLIK Help Center (SPEC-253). Di-mount oleh main.tsx saat pathname
   diawali /help/ (tanpa login, tanpa Shell dashboard). Dua rute:
     /help/:slug                 → form lapor keluhan + akses cek status
     /help/:slug/status/:key     → status publik tiket (terpetakan otomatis)
   Same-origin: form men-submit multipart ke /api/help/:slug/tickets.

   Audit UI/UX 2026-10 · Fase 3 (3M): status memakai linimasa dan kalimat keadaan yang sama dengan
   Beranda Klien (komponen portal bersama), kosakata kategori dari portal/labels. */
import React from "react";
import { Card, Button, Select, StateBlock, StatusPill } from "../ds";
import { helpApi } from "../api/help";
import type { HelpInfo, PublicTicketStatus } from "@hanoman/shared";
import { kategoriLabel, jaringanAtauPesan } from "../portal/labels";
import { ticketPill } from "../portal/status-pill";
import { TicketNote, TicketTimeline } from "../portal/TicketTimeline";
import "../portal/portal.css";

const MAX_FILES = 3;

// Parse /help/<slug>[/status/<key>].
function parseRoute(pathname: string): { slug: string; key?: string } | null {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts[0] !== "help" || !parts[1]) return null;
  if (parts[2] === "status" && parts[3]) return { slug: decodeURIComponent(parts[1]), key: decodeURIComponent(parts[3]) };
  return { slug: decodeURIComponent(parts[1]) };
}

// Scroller dan padding tetap inline: tes memverifikasi dvh dan gulir vertikal di sini (dikunci
// `public-help.test.tsx`), dan jendela sempit dikunci oleh inline style, bukan oleh berkas CSS.
function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="public-help-scroll" className="hn-dynamic-viewport hn-public" style={{ height: "100dvh", minHeight: 0, overflowY: "auto",
      overscrollBehavior: "contain", boxSizing: "border-box", background: "var(--bone-100)",
      padding: "max(40px, var(--safe-top)) max(16px, var(--safe-right)) max(40px, var(--safe-bottom)) max(16px, var(--safe-left))" }}>
      <div className="hn-public-page">
        {children}
      </div>
    </div>
  );
}

function StatusView({ slug, statusKey }: { slug: string; statusKey: string }) {
  const [st, setSt] = React.useState<PublicTicketStatus | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const load = React.useCallback(() => {
    setState("loading");
    helpApi.status(slug, statusKey).then((d) => { setSt(d); setState("ready"); }).catch(() => setState("error"));
  }, [slug, statusKey]);
  React.useEffect(() => { load(); }, [load]);

  return (
    <Layout>
      <Card eyebrow="status keluhan" title={st ? `Tiket #${st.number}` : "Status tiket"}>
        {state === "loading" ? <StateBlock kind="loading" />
          : state === "error" || !st ? <StateBlock kind="error" title="Status belum bisa dimuat" hint="Periksa kembali link status Anda, lalu coba lagi." action={load} actionLabel="Coba lagi" />
          : <div className="hn-public-form">
              <div><StatusPill status={ticketPill(st.status)} size="sm">{st.status}</StatusPill></div>
              <TicketTimeline status={st.status} />
              <TicketNote status={st.status} />
              <dl className="hn-public-status-dl">
                <div><dt>Kategori</dt><dd>{kategoriLabel(st.category)}</dd></div>
                <div><dt>Judul</dt><dd>{st.title}</dd></div>
                <div><dt>Dilaporkan</dt><dd>{new Date(st.createdAt).toLocaleString("id-ID")}</dd></div>
              </dl>
            </div>}
      </Card>
    </Layout>
  );
}

function ReportForm({ slug }: { slug: string }) {
  const [info, setInfo] = React.useState<HelpInfo | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [category, setCategory] = React.useState("bug");
  const [title, setTitle] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [trap, setTrap] = React.useState(""); // honeypot — harus tetap kosong
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ number: number; statusUrl: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(() => {
    setState("loading");
    helpApi.getInfo(slug).then((d) => { setInfo(d); setCategory(d.categories[0] ?? "bug"); setState("ready"); }).catch(() => setState("error"));
  }, [slug]);
  React.useEffect(() => { load(); }, [load]);

  // Rute cek status: user menempel link atau kode → arahkan.
  const [checkKey, setCheckKey] = React.useState("");
  function goCheck(e: React.FormEvent) {
    e.preventDefault();
    const key = checkKey.trim().split("/").pop() ?? checkKey.trim();
    if (key) window.location.href = `/help/${encodeURIComponent(slug)}/status/${encodeURIComponent(key)}`;
  }

  const copyLink = async (url: string) => {
    if (!navigator.clipboard) { setErr("Salin tidak tersedia di browser ini. Pilih linknya lalu salin manual."); return; }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) { setErr(jaringanAtauPesan(e, "Link belum bisa disalin. Pilih linknya lalu salin manual.")); }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const form = new FormData();
      form.set("category", category); form.set("title", title); form.set("detail", detail);
      form.set("email", email); form.set("hc_trap", trap);
      for (const f of files.slice(0, MAX_FILES)) form.append("files", f, f.name);
      const r = await helpApi.submit(slug, form);
      const statusUrl = `${window.location.origin}${r.statusPath}`;
      setDone({ number: r.number, statusUrl });
    } catch (e) { setErr(jaringanAtauPesan(e, "Keluhan belum terkirim. Coba lagi sebentar.")); }
    finally { setBusy(false); }
  }

  if (state === "loading") return <Layout><StateBlock kind="loading" /></Layout>;
  if (state === "error" || !info) return <Layout><Card title="Help Center"><StateBlock kind="error" title="Belum bisa dibuka" hint="Coba lagi sebentar. Jika tetap gagal, Help Center untuk project ini mungkin tidak aktif." action={load} actionLabel="Coba lagi" /></Card></Layout>;

  if (done) return (
    <Layout>
      <Card eyebrow="terkirim" title={`Terima kasih — tiket #${done.number}`}>
        <div className="hn-public-form">
          <p className="hn-public-lead">
            Keluhan Anda sudah kami terima. Simpan link berikut untuk memantau perkembangannya.
          </p>
          <div className="hn-public-linkbox">
            <code className="hn-public-code">{done.statusUrl}</code>
            <div className="hn-public-actions">
              <Button size="sm" leftIcon="copy" onClick={() => void copyLink(done.statusUrl)}>{copied ? "Tersalin" : "Salin link"}</Button>
              <Button size="sm" variant="ghost" onClick={() => window.location.assign(done.statusUrl)}>Buka status</Button>
            </div>
          </div>
        </div>
      </Card>
    </Layout>
  );

  return (
    <Layout>
      <Card eyebrow="help center" title={`Lapor keluhan · ${info.projectName}`}>
        <form onSubmit={submit} className="hn-public-form">
          <div className="hn-public-field">
            <label htmlFor="hc-cat" className="hn-public-label">Kategori</label>
            <Select id="hc-cat" size="lg" value={category} onChange={(e) => setCategory(e.target.value)}
              options={info.categories.map((c) => ({ value: c, label: kategoriLabel(c) }))} />
          </div>
          <div className="hn-public-field">
            <label htmlFor="hc-title" className="hn-public-label">Judul</label>
            <input id="hc-title" className="hn-public-input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200}
              placeholder="mis. Tombol Simpan tidak berfungsi di HP" />
          </div>
          <div className="hn-public-field">
            <label htmlFor="hc-detail" className="hn-public-label">Detail</label>
            <textarea id="hc-detail" className="hn-public-input" value={detail} onChange={(e) => setDetail(e.target.value)} required maxLength={10_000} rows={6}
              placeholder="mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tidak tersimpan. Jangan sertakan data sensitif (kata sandi, dsb)." />
          </div>
          <div className="hn-public-field">
            <label htmlFor="hc-email" className="hn-public-label">Email Anda</label>
            <input id="hc-email" className="hn-public-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200}
              placeholder="nama@contoh.id" />
          </div>
          <div className="hn-public-field">
            <label htmlFor="hc-files" className="hn-public-label">Lampiran gambar (opsional, maks {MAX_FILES})</label>
            <input id="hc-files" className="hn-portal-file" type="file" accept="image/png,image/jpeg,image/webp" multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))} />
            {files.length > 0 && <div className="hn-public-files">{files.map((f) => f.name).join(", ")}</div>}
          </div>
          {/* honeypot — disembunyikan dari manusia; bot cenderung mengisinya. SPEC-352: namanya
              WAJIB netral dan autocomplete-nya WAJIB `new-password`. Versi lama bernama `hp`
              (= "handphone") dengan `autocomplete="off"` — atribut yang diabaikan browser untuk
              autofill — sehingga autofill mengisinya untuk pelapor sungguhan dan submit mereka
              tertelan sukses palsu. `new-password` dihormati semua browser. */}
          {/* placeholder-exempt: honeypot SPEC-352 — sengaja tak terlihat manusia; placeholder justru memandu bot */}
          <input tabIndex={-1} autoComplete="new-password" aria-hidden value={trap} onChange={(e) => setTrap(e.target.value)}
            name="hc_trap" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
          {err && <p role="alert" className="hn-portal-error">{err}</p>}
          <div className="hn-portal-foot">
            <Button type="submit" disabled={busy} loading={busy} leftIcon="send">Kirim keluhan</Button>
          </div>
        </form>
      </Card>
      <Card eyebrow="sudah pernah lapor?" title="Cek status keluhan">
        <form onSubmit={goCheck} className="hn-public-check">
          <div className="hn-public-field">
            <label htmlFor="hc-check" className="hn-public-label">Kode status atau link</label>
            <input id="hc-check" className="hn-public-input" value={checkKey} onChange={(e) => setCheckKey(e.target.value)}
              placeholder="mis. a1b2c3d4e5f6, atau tempel link statusnya" />
          </div>
          <Button type="submit" variant="secondary" disabled={!checkKey.trim()}>Cek status</Button>
        </form>
      </Card>
    </Layout>
  );
}

export function PublicHelpApp() {
  const route = parseRoute(window.location.pathname);
  if (!route) return <Layout><Card title="Help Center"><StateBlock kind="error" title="Halaman tidak ditemukan" hint="Link Help Center tidak valid." /></Card></Layout>;
  if (route.key) return <StatusView slug={route.slug} statusKey={route.key} />;
  return <ReportForm slug={route.slug} />;
}
