import React from "react";
import type {
  PortalChatMessageView, PortalChatQuotaView, PortalChatSessionView, PortalChatType,
} from "@hanoman/shared";
import { Button, Card, StateBlock } from "../ds";
import { portalApi } from "../api/portal";

// SPEC-854 · ADR-0129 · permukaan obrolan klien. Ia hidup di samping Help desk, bukan
// menggantikannya — bedanya dijelaskan di layar, karena "kenapa ada dua kotak masuk" adalah
// pertanyaan pertama yang muncul di kepala klien.
//
// ATURAN BERKAS INI: tak satu pun teks di sini boleh teknis. Tanpa kode status, tanpa nama
// alamat, tanpa pesan galat mentah. Gagal apa pun dijawab satu kalimat biasa (huruf E).

const PAGE = { page: 1, limit: 20 };

const TIPE: { value: PortalChatType; label: string; jelas: string }[] = [
  { value: "brainstorm", label: "Brainstorming",
    jelas: "Kita gali ide Anda bersama-sama sampai jelas, lalu saya rangkum jadi usulan untuk tim." },
  { value: "tanya", label: "Bertanya",
    jelas: "Tanyakan apa saja seputar project Anda — saya jawab langsung di sini." },
];

const GAGAL_UMUM = "Maaf, ada kendala sebentar. Coba lagi ya.";
// Pesan klien yang gagal terkirim: tetap di layar, bertanda, dan bisa dikirim ulang.
type Gelembung = PortalChatMessageView & { gagal?: boolean };

// Tanggal panjang, bukan ISO: yang dibaca klien adalah "1 September 2026", bukan stempel waktu.
const tanggalPanjang = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

const BUBBLE: React.CSSProperties = {
  maxWidth: "min(560px, 88%)", padding: "10px 14px", borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-hair)", whiteSpace: "pre-wrap", lineHeight: 1.6,
};

export function ChatPanel({ projectId }: { projectId: string }) {
  const [sesi, setSesi] = React.useState<PortalChatSessionView | null>(null);
  const [riwayat, setRiwayat] = React.useState<PortalChatSessionView[]>([]);
  const [riwayatGagal, setRiwayatGagal] = React.useState(false);
  const [pesan, setPesan] = React.useState<Gelembung[]>([]);
  const seqLokal = React.useRef(0);
  const [draft, setDraft] = React.useState("");
  const [menunggu, setMenunggu] = React.useState(false);
  const [galat, setGalat] = React.useState<string | null>(null);
  const [kuota, setKuota] = React.useState<PortalChatQuotaView | null>(null);

  const muatRiwayat = React.useCallback(() => {
    setRiwayatGagal(false);
    portalApi.listChatSessions(projectId, PAGE)
      .then((r) => setRiwayat(r.items))
      .catch(() => { setRiwayat([]); setRiwayatGagal(true); });
  }, [projectId]);

  React.useEffect(() => {
    setSesi(null); setPesan([]); setGalat(null);
    muatRiwayat();
    portalApi.getChatQuota(projectId).then(setKuota).catch(() => setKuota(null));
  }, [projectId, muatRiwayat]);

  // Jatah dimuat ulang sesudah sesi lahir supaya angkanya tak basi satu langkah. Gagal memuatnya
  // menyembunyikan baris jatah (angka basi lebih menyesatkan daripada tanpa angka); server tetap menjaga batas.
  const segarkanKuota = () =>
    void portalApi.getChatQuota(projectId).then(setKuota).catch(() => setKuota(null));

  const buka = async (s: PortalChatSessionView) => {
    setSesi(s); setGalat(null);
    try {
      const d = await portalApi.getChatSession(projectId, s.id, PAGE);
      setPesan(d.messages.items);
    } catch { setPesan([]); setGalat(GAGAL_UMUM); }
  };

  const mulai = async (type: PortalChatType) => {
    setGalat(null);
    try {
      const s = await portalApi.startChatSession(projectId, type);
      setSesi(s); setPesan([]); setRiwayat((r) => [s, ...r]);
      segarkanKuota();
    } catch { setGalat(GAGAL_UMUM); }
  };

  // `ulang` = kirim ulang gelembung yang gagal (ia tak menambah gelembung baru).
  const kirim = async (ulang?: { id: string; teks: string }) => {
    const teks = (ulang ? ulang.teks : draft).trim();
    if (!teks || !sesi || menunggu) return;
    setGalat(null);
    setMenunggu(true);
    // Giliran klien tampil seketika supaya percakapan terasa hidup selama agen berpikir; server
    // tetap yang menomori urutannya, jadi `seq` sementara ini tak pernah dipakai untuk apa pun.
    const id = ulang?.id ?? `lokal-${++seqLokal.current}`;
    setPesan((m) => ulang
      ? m.map((x) => (x.id === id ? { ...x, gagal: false } : x))
      : [...m, { id, seq: m.length + 1, role: "klien", text: teks, createdAt: new Date().toISOString() }]);
    if (!ulang) setDraft("");
    try {
      const balasan = await portalApi.sendChatMessage(projectId, sesi.id, teks);
      setPesan((m) => [...m, balasan]);
    } catch {
      // Gagal: gelembungnya ditandai, dan teksnya dikembalikan ke kotak tulis bila kotak itu kosong.
      setPesan((m) => m.map((x) => (x.id === id ? { ...x, gagal: true } : x)));
      if (!ulang) setDraft((d) => (d.trim() ? d : teks));
      setGalat(GAGAL_UMUM);
    } finally { setMenunggu(false); }
  };

  const beda = (
    <p data-testid="chat-beda-help" style={{
      margin: "0 0 18px", padding: "10px 14px", borderRadius: "var(--radius-lg)",
      background: "var(--bone-100)", border: "1px solid var(--border-hair)",
      color: "var(--text-subtle)", fontSize: 13, lineHeight: 1.6,
    }}>
      Obrolan ini dijawab hanoman saat itu juga. Kalau Anda ingin melaporkan sesuatu supaya
      ditangani orang, kirimkan lewat <strong>Laporan &amp; keluhan</strong> — laporan di sana masuk antrean
      tim dan dijawab manusia.
    </p>
  );

  const sisaOf = (t: PortalChatType) => kuota?.[t === "brainstorm" ? "brainstorm" : "tanya"];

  const jatahBlok = kuota && (
    <p data-testid="chat-jatah" style={{
      margin: "0 0 14px", color: "var(--text-subtle)", fontSize: 13, lineHeight: 1.6,
    }}>
      Brainstorming: sudah dipakai {kuota.brainstorm.terpakai} dari {kuota.brainstorm.jatah} bulan
      ini. Bertanya: {kuota.tanya.terpakai} dari {kuota.tanya.jatah}. Jatah kembali penuh pada{" "}
      {tanggalPanjang(kuota.resetPada)}.
    </p>
  );

  if (!sesi) return (
    <div>
      {beda}
      {jatahBlok}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {TIPE.map((t) => (
          <Card key={t.value}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <Button disabled={sisaOf(t.value)?.sisa === 0} onClick={() => void mulai(t.value)}>{t.label}</Button>
              <p style={{ margin: 0, color: "var(--text-subtle)", fontSize: 13, lineHeight: 1.6 }}>
                {t.jelas}
              </p>
            </div>
          </Card>
        ))}
      </div>
      {galat && <p data-testid="chat-galat" role="alert" style={GALAT}>{galat}</p>}
      {riwayatGagal && <StateBlock kind="error" compact title="Riwayat obrolan belum bisa dimuat" hint={GAGAL_UMUM} action={muatRiwayat} actionLabel="Coba lagi" />}
      {riwayat.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, color: "var(--text-strong)" }}>Obrolan sebelumnya</h3>
          <Card padding={0}>
            {riwayat.map((s) => (
              <button key={s.id} type="button" className="hn-portal-row" onClick={() => void buka(s)}
                style={{ display: "flex", gap: 12, width: "100%", textAlign: "left",
                  padding: "12px 16px", background: "none", border: "none", cursor: "pointer",
                  borderBottom: "1px solid var(--border-hair)" }}>
                <span style={{ fontSize: 13, color: "var(--text-subtle)", width: 110 }}>
                  {TIPE.find((t) => t.value === s.type)?.label ?? s.type}
                </span>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-strong)" }}>
                  {s.summary || "Belum ada ringkasan"}
                </span>
              </button>
            ))}
          </Card>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {beda}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button size="sm" variant="ghost" onClick={() => { setSesi(null); setPesan([]); }}>
          ← Semua obrolan
        </Button>
        <span style={{ fontSize: 13, color: "var(--text-subtle)" }}>
          {TIPE.find((t) => t.value === sesi.type)?.label}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {pesan.map((m) => (
          <div key={m.id} style={{
            display: "flex", flexDirection: "column", alignItems: m.role === "klien" ? "flex-end" : "flex-start", gap: 4 }}>
            <div style={{ ...BUBBLE,
              background: m.role === "klien" ? "var(--bone-100)" : "var(--surface-card)",
              opacity: m.gagal ? 0.85 : 1, borderColor: m.gagal ? "var(--clay-500)" : "var(--border-hair)" }}>
              {m.text}
            </div>
            {m.gagal && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--clay-600)" }}>
                <span role="alert">Gagal terkirim</span>
                <Button size="sm" variant="ghost" disabled={menunggu}
                  onClick={() => void kirim({ id: m.id, teks: m.text })}>Kirim ulang</Button>
              </div>
            )}
          </div>
        ))}
        {menunggu && <StateBlock kind="loading" title="hanoman sedang memikirkan…"
          hint="Ini bisa memakan waktu sebentar." />}
      </div>

      {galat && <p data-testid="chat-galat" role="alert" style={GALAT}>{galat}</p>}

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* textarea native: font 16px agar iOS tak men-zoom saat kotak ini difokus. */}
          <textarea data-testid="chat-input" value={draft} rows={3} aria-label="Pesan Anda"
            placeholder="Tulis pesan Anda…" disabled={menunggu}
            onChange={(e) => setDraft(e.target.value)}
            style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "9px 11px", resize: "vertical",
              border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--surface-card)",
              color: "var(--text-strong)", fontSize: 16, fontFamily: "var(--font-ui)" }} />
        </div>
        <Button data-testid="chat-kirim" disabled={menunggu || !draft.trim()} onClick={() => void kirim()}>
          Kirim
        </Button>
      </div>
    </div>
  );
}

const GALAT: React.CSSProperties = {
  margin: "10px 0 0", color: "var(--clay-600)", fontSize: 13, lineHeight: 1.6,
};
