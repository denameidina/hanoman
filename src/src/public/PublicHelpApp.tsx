/* PublicHelpApp — halaman PUBLIK Help Center (SPEC-253). Di-mount oleh main.tsx saat pathname
   diawali /help/ (tanpa login, tanpa Shell dashboard). Dua rute:
     /help/:slug                 → form lapor keluhan + akses cek status
     /help/:slug/status/:key     → status publik tiket (terpetakan otomatis)
   Same-origin: form men-submit multipart ke /api/help/:slug/tickets. */
import React from "react";
import { Card, Button, Select, StateBlock, Badge } from "../ds";
import { helpApi } from "../api/help";
import type { HelpInfo, PublicTicketStatus } from "@hanoman/shared";
import { kategoriLabel, jaringanAtauPesan } from "../portal/labels";

const MAX_FILES = 3;

// Parse /help/<slug>[/status/<key>].
function parseRoute(pathname: string): { slug: string; key?: string } | null {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts[0] !== "help" || !parts[1]) return null;
  if (parts[2] === "status" && parts[3]) return { slug: decodeURIComponent(parts[1]), key: decodeURIComponent(parts[3]) };
  return { slug: decodeURIComponent(parts[1]) };
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="public-help-scroll" className="hn-dynamic-viewport" style={{ height: "100dvh", minHeight: 0, overflowY: "auto",
      overscrollBehavior: "contain", boxSizing: "border-box", background: "var(--bone-100)",
      padding: "max(40px, var(--safe-top)) max(16px, var(--safe-right)) max(40px, var(--safe-bottom)) max(16px, var(--safe-left))" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

function StatusView({ slug, statusKey }: { slug: string; statusKey: string }) {
  const [st, setSt] = React.useState<PublicTicketStatus | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const load = React.useCallback(() => {
    helpApi.status(slug, statusKey).then((d) => { setSt(d); setState("ready"); }).catch(() => setState("error"));
  }, [slug, statusKey]);
  React.useEffect(() => { load(); }, [load]);

  return (
    <Layout>
      <Card eyebrow="status keluhan" title={st ? `Tiket #${st.number}` : "Status tiket"}>
        {state === "loading" ? <StateBlock kind="loading" />
          : state === "error" || !st ? <StateBlock kind="error" title="Status belum bisa dimuat" hint="Periksa kembali link status Anda, lalu coba lagi." action={load} actionLabel="Coba lagi" />
          : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Status</span>
                <Badge tone="ok">{st.status}</Badge>
              </div>
              <div><span className="hn-eyebrow">Kategori</span><div>{kategoriLabel(st.category)}</div></div>
              <div><span className="hn-eyebrow">Judul</span><div style={{ color: "var(--text-body)" }}>{st.title}</div></div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-subtle)" }}>Dilaporkan {new Date(st.createdAt).toLocaleString("id-ID")}</div>
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
    if (!navigator.clipboard) { setErr("Salin tak tersedia di browser ini. Pilih linknya lalu salin manual."); return; }
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
        <div style={{ color: "var(--text-body)", marginBottom: 12 }}>
          Keluhan Anda sudah kami terima. Simpan link berikut untuk memantau statusnya:
        </div>
        <div style={{ padding: 12, border: "1px solid var(--brass-300)", borderRadius: "var(--radius-sm)", background: "var(--brass-100)" }}>
          <code style={{ display: "block", wordBreak: "break-all", fontSize: 12.5 }}>{done.statusUrl}</code>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <Button size="sm" leftIcon="copy" onClick={() => void copyLink(done.statusUrl)}>{copied ? "Tersalin" : "Salin link"}</Button>
            <Button size="sm" variant="ghost" onClick={() => window.location.assign(done.statusUrl)}>Buka status</Button>
          </div>
        </div>
      </Card>
    </Layout>
  );

  return (
    <Layout>
      <Card eyebrow="help center" title={`Lapor keluhan · ${info.projectName}`}>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="hc-cat" className="hn-eyebrow">Kategori</label>
            <Select id="hc-cat" value={category} onChange={(e) => setCategory(e.target.value)}
              options={info.categories.map((c) => ({ value: c, label: kategoriLabel(c) }))} />
          </div>
          <div>
            <label htmlFor="hc-title" className="hn-eyebrow">Judul</label>
            <input id="hc-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200}
              style={inputStyle} placeholder="mis. Tombol Simpan tak berfungsi di HP" />
          </div>
          <div>
            <label htmlFor="hc-detail" className="hn-eyebrow">Detail</label>
            <textarea id="hc-detail" value={detail} onChange={(e) => setDetail(e.target.value)} required maxLength={10_000} rows={6}
              style={{ ...inputStyle, resize: "vertical" }} placeholder="mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tak tersimpan. Jangan sertakan data sensitif (kata sandi, dsb)." />
          </div>
          <div>
            <label htmlFor="hc-email" className="hn-eyebrow">Email Anda</label>
            <input id="hc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200}
              style={inputStyle} placeholder="nama@contoh.id" />
          </div>
          <div>
            <label htmlFor="hc-files" className="hn-eyebrow">Lampiran gambar (opsional, maks {MAX_FILES})</label>
            <input id="hc-files" className="hn-touch-target" type="file" accept="image/png,image/jpeg,image/webp" multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))} />
            {files.length > 0 && <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 4 }}>{files.map((f) => f.name).join(", ")}</div>}
          </div>
          {/* honeypot — disembunyikan dari manusia; bot cenderung mengisinya. SPEC-352: namanya
              WAJIB netral dan autocomplete-nya WAJIB `new-password`. Versi lama bernama `hp`
              (= "handphone") dengan `autocomplete="off"` — atribut yang diabaikan browser untuk
              autofill — sehingga autofill mengisinya untuk pelapor sungguhan dan submit mereka
              tertelan sukses palsu. `new-password` dihormati semua browser. */}
          {/* placeholder-exempt: honeypot SPEC-352 — sengaja tak terlihat manusia; placeholder justru memandu bot */}
          <input tabIndex={-1} autoComplete="new-password" aria-hidden value={trap} onChange={(e) => setTrap(e.target.value)}
            name="hc_trap" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
          {err && <div role="alert" style={{ color: "var(--clay-600)", fontSize: 13 }}>{err}</div>}
          <Button type="submit" disabled={busy} leftIcon="send">Kirim keluhan</Button>
        </form>
      </Card>
      <Card eyebrow="sudah pernah lapor?" title="Cek status tiket">
        <form onSubmit={goCheck} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="hc-check" className="hn-eyebrow">Kode status atau link</label>
            <input id="hc-check" value={checkKey} onChange={(e) => setCheckKey(e.target.value)}
              placeholder="mis. a1b2c3d4e5f6, atau tempel link statusnya" style={inputStyle} />
          </div>
          <Button type="submit" variant="secondary" disabled={!checkKey.trim()}>Cek status</Button>
        </form>
      </Card>
    </Layout>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", minHeight: "var(--touch-target)", boxSizing: "border-box", marginTop: 4, padding: "8px 10px",
  border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
  background: "var(--surface-card)", color: "var(--text-body)", fontSize: 16, fontFamily: "var(--font-ui)",
};

export function PublicHelpApp() {
  const route = parseRoute(window.location.pathname);
  if (!route) return <Layout><Card title="Help Center"><StateBlock kind="error" title="Halaman tidak ditemukan" hint="Link Help Center tidak valid." /></Card></Layout>;
  if (route.key) return <StatusView slug={route.slug} statusKey={route.key} />;
  return <ReportForm slug={route.slug} />;
}
