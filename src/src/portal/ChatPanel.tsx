import React from "react";
import type {
  PortalChatMessageView, PortalChatQuotaView, PortalChatSessionView, PortalChatType,
} from "@hanoman/shared";
import { Button, Card, StateBlock } from "../ds";
import { portalApi } from "../api/portal";
import "./portal.css";

// SPEC-854 · ADR-0129 · permukaan obrolan klien. Ia hidup di samping Keluhan saya, bukan
// menggantikannya — bedanya dijelaskan di layar, karena "kenapa ada dua kotak masuk" adalah
// pertanyaan pertama yang muncul di kepala klien.
//
// ATURAN BERKAS INI: tak satu pun teks di sini boleh teknis. Tanpa kode status, tanpa nama
// alamat, tanpa pesan galat mentah. Gagal apa pun dijawab satu kalimat biasa (huruf E).
// Audit UI/UX 2026-10 · Fase 3 (3M): tampilan dipindah ke kelas `hn-chat-*` (portal.css).
// Logika, testid, dan urutan langkah tetap sama.

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
    <p data-testid="chat-beda-help" className="hn-portal-note">
      Obrolan ini dijawab hanoman saat itu juga. Kalau Anda ingin melaporkan masalah supaya
      ditangani orang, kirimkan lewat <strong>Keluhan saya</strong> — laporan di sana masuk antrean
      tim dan dijawab manusia.
    </p>
  );

  const sisaOf = (t: PortalChatType) => kuota?.[t === "brainstorm" ? "brainstorm" : "tanya"];

  const jatahBlok = kuota && (
    <p data-testid="chat-jatah" className="hn-chat-jatah">
      Brainstorming: sudah dipakai {kuota.brainstorm.terpakai} dari {kuota.brainstorm.jatah} bulan
      ini. Bertanya: {kuota.tanya.terpakai} dari {kuota.tanya.jatah}. Jatah kembali penuh pada{" "}
      {tanggalPanjang(kuota.resetPada)}.
    </p>
  );

  if (!sesi) return (
    <div className="hn-chat">
      {beda}
      {jatahBlok}
      <div className="hn-chat-types">
        {TIPE.map((t) => (
          <Card key={t.value}>
            <div className="hn-chat-type">
              <Button disabled={sisaOf(t.value)?.sisa === 0} onClick={() => void mulai(t.value)}>{t.label}</Button>
              <p>{t.jelas}</p>
            </div>
          </Card>
        ))}
      </div>
      {galat && <p data-testid="chat-galat" role="alert" className="hn-portal-error">{galat}</p>}
      {riwayatGagal && <StateBlock kind="error" compact title="Riwayat obrolan belum bisa dimuat" hint={GAGAL_UMUM} action={muatRiwayat} actionLabel="Coba lagi" />}
      {riwayat.length > 0 && (
        <div className="hn-chat-history">
          <h3>Obrolan sebelumnya</h3>
          <Card padding={0}>
            {riwayat.map((s) => (
              <button key={s.id} type="button" className="hn-chat-row" onClick={() => void buka(s)}>
                <span className="hn-chat-row-type">
                  {TIPE.find((t) => t.value === s.type)?.label ?? s.type}
                </span>
                <span className="hn-chat-row-sum">
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
    <div className="hn-chat">
      {beda}
      <div className="hn-chat-bar">
        <Button size="sm" variant="ghost" onClick={() => { setSesi(null); setPesan([]); }}>
          ← Semua obrolan
        </Button>
        <span>{TIPE.find((t) => t.value === sesi.type)?.label}</span>
      </div>

      <div className="hn-chat-thread">
        {pesan.map((m) => (
          <div key={m.id} className="hn-chat-msg" data-role={m.role} data-gagal={m.gagal ? "true" : undefined}>
            <div className="hn-chat-bubble">{m.text}</div>
            {m.gagal && (
              <div className="hn-chat-failed">
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

      {galat && <p data-testid="chat-galat" role="alert" className="hn-portal-error">{galat}</p>}

      <div className="hn-chat-compose">
        <div>
          {/* textarea native: font 16px (kelas hn-portal-textarea) agar iOS tak men-zoom saat difokus. */}
          <textarea data-testid="chat-input" className="hn-portal-textarea" value={draft} rows={3} aria-label="Pesan Anda"
            placeholder="Tulis pesan Anda…" disabled={menunggu}
            onChange={(e) => setDraft(e.target.value)} />
        </div>
        <Button data-testid="chat-kirim" disabled={menunggu || !draft.trim()} onClick={() => void kirim()}>
          Kirim
        </Button>
      </div>
    </div>
  );
}
