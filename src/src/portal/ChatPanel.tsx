import React from "react";
import type { PortalChatMessageView, PortalChatSessionView, PortalChatType } from "@hanoman/shared";
import { Button, Card, HnTextarea, StateBlock } from "../ds";
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

const BUBBLE: React.CSSProperties = {
  maxWidth: "min(560px, 88%)", padding: "10px 14px", borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-hair)", whiteSpace: "pre-wrap", lineHeight: 1.6,
};

export function ChatPanel({ projectId }: { projectId: string }) {
  const [sesi, setSesi] = React.useState<PortalChatSessionView | null>(null);
  const [riwayat, setRiwayat] = React.useState<PortalChatSessionView[]>([]);
  const [pesan, setPesan] = React.useState<PortalChatMessageView[]>([]);
  const [draft, setDraft] = React.useState("");
  const [menunggu, setMenunggu] = React.useState(false);
  const [galat, setGalat] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSesi(null); setPesan([]); setGalat(null);
    portalApi.listChatSessions(projectId, PAGE)
      .then((r) => setRiwayat(r.items))
      .catch(() => setRiwayat([]));
  }, [projectId]);

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
    } catch { setGalat(GAGAL_UMUM); }
  };

  const kirim = async () => {
    const teks = draft.trim();
    if (!teks || !sesi || menunggu) return;
    setGalat(null);
    setMenunggu(true);
    // Giliran klien tampil seketika supaya percakapan terasa hidup selama agen berpikir; server
    // tetap yang menomori urutannya, jadi `seq` sementara ini tak pernah dipakai untuk apa pun.
    setPesan((m) => [...m, {
      id: `lokal-${m.length}`, seq: m.length + 1, role: "klien", text: teks,
      createdAt: new Date().toISOString() }]);
    setDraft("");
    try {
      const balasan = await portalApi.sendChatMessage(projectId, sesi.id, teks);
      setPesan((m) => [...m, balasan]);
    } catch {
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
      ditangani orang, kirimkan lewat <strong>Help desk</strong> — laporan di sana masuk antrean
      tim dan dijawab manusia.
    </p>
  );

  if (!sesi) return (
    <div>
      {beda}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {TIPE.map((t) => (
          <Card key={t.value}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <Button onClick={() => void mulai(t.value)}>{t.label}</Button>
              <p style={{ margin: 0, color: "var(--text-subtle)", fontSize: 13, lineHeight: 1.6 }}>
                {t.jelas}
              </p>
            </div>
          </Card>
        ))}
      </div>
      {galat && <p data-testid="chat-galat" style={GALAT}>{galat}</p>}
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
            display: "flex", justifyContent: m.role === "klien" ? "flex-end" : "flex-start" }}>
            <div style={{ ...BUBBLE,
              background: m.role === "klien" ? "var(--bone-100)" : "var(--surface-card)" }}>
              {m.text}
            </div>
          </div>
        ))}
        {menunggu && <StateBlock kind="loading" title="hanoman sedang memikirkan…"
          hint="Ini bisa memakan waktu sebentar." />}
      </div>

      {galat && <p data-testid="chat-galat" style={GALAT}>{galat}</p>}

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <HnTextarea data-testid="chat-input" value={draft} rows={3}
            placeholder="Tulis pesan Anda…" disabled={menunggu}
            onChange={(e) => setDraft(e.target.value)} />
        </div>
        <Button data-testid="chat-kirim" disabled={menunggu} onClick={() => void kirim()}>
          Kirim
        </Button>
      </div>
    </div>
  );
}

const GALAT: React.CSSProperties = {
  margin: "10px 0 0", color: "var(--text-subtle)", fontSize: 13, lineHeight: 1.6,
};
