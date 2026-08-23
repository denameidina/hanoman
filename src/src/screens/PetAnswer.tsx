import React from "react";
import type { SessionAsk, SessionDialogAnswer, SessionDialogPayload } from "@hanoman/shared";
import { api, ApiError } from "../api/client";
import { Button, Checkbox, Input } from "../ds";

// SPEC-899 · ADR-0142 · kotak jawaban satu sesi di dalam panel pet. Komponen sendiri, bukan blok di
// HanomanPet.tsx: siklus hidupnya (muat → kirim → terkirim → 409 muat ulang) tak berhubungan sama
// sekali dengan mesin berkeliaran, gelembung, dan a11y panggung yang dipegang komponen itu.
//
// Tak ada polling di sini (ADR-0039 ditegakkan): dialog diambil saat kotak ini mount — yaitu saat
// panel dibuka — dan keadaan "sudah terjawab" datang dari siaran `sessions` yang sudah ada, yang
// meng-unmount kotak ini begitu sesinya berhenti `waiting`.
//
// SPEC-909 · ADR-0146 · dua sumber, dan pembagiannya tegas. `ask` (payload hook, lewat siaran
// `leadAsks`) menjawab "APA pertanyaannya" — bukti dari agennya sendiri, tiba seketika, tak pernah
// terpotong lebar pane. `payload` (scrape, `GET …/dialog`) menjawab "baris mana yang ditekan" —
// `screenHash` + nomor opsi, yang memang cuma ada di layar. Payload event MENANG untuk yang
// pertama; pagar SPEC-899/ADR-0142 tetap berdiri utuh untuk yang kedua.

const NOTE = {
  loading: "Membaca layar sesi…",
  none: "Pertanyaannya tak terbaca dari sini — buka Terminal untuk menjawabnya.",
  stale: "Layarnya sudah berubah — pertanyaannya dimuat ulang.",
  deciding: "hanoman-lead sedang menyusun keputusan untuk sesi ini.",
  failed: "Jawaban tak terkirim. Buka Terminal untuk menjawabnya.",
  // SPEC-909 · ADR-0146
  answering: "hanoman-lead sudah mengirim jawabannya ke pane — terlambat mengambil alih.",
  taken: "Kamu mengambil alih sesi ini. hanoman-lead berhenti menjawabnya.",
  preparing: "Kotak jawabnya sedang disiapkan — dialognya belum tergambar di pane.",
};

// SPEC-909 · AC-5 · status lead terlihat. Kalimatnya di SATU tempat: tiga permukaan yang menamainya
// sendiri-sendiri adalah tiga kalimat yang akan hanyut terpisah.
const LEAD_STATE: Record<SessionAsk["state"], string> = {
  queued: "hanoman-lead mengantre untuk sesi ini",
  deciding: "hanoman-lead sedang menyusun keputusan",
  answered: "hanoman-lead sudah menjawab",
  "taken-over": "Kamu yang menjawab sesi ini",
  failed: "hanoman-lead tak sanggup menjawab sesi ini",
};

const reasonOf = (e: unknown): string | undefined =>
  e instanceof ApiError ? (e.detail as { reason?: string } | null)?.reason : undefined;

export function PetAnswer({ sessionId, label, reduced, ask }:
  { sessionId: string; label: string; reduced: boolean; ask?: SessionAsk }) {
  const [payload, setPayload] = React.useState<SessionDialogPayload | null | undefined>(undefined);
  const [picked, setPicked] = React.useState<number[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setPayload(undefined);
    api.sessionDialog(sessionId)
      .then((p) => {
        if (!alive) return;
        setPayload(p);
        setPicked(p ? p.dialog.options.filter((o) => o.checked).map((o) => o.n) : []);
      })
      .catch(() => { if (alive) setPayload(null); });
    return () => { alive = false; };
  }, [sessionId, reload]);

  // AC-6 · hentikan lead sebelum ia mengetik ke pane, lalu jawab sendiri lewat kotak yang sama.
  async function takeover() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await api.takeoverSessionDialog(sessionId);
      setNote(NOTE.taken);
      setReload((n) => n + 1);      // gerbang `deciding` sudah lepas; muat ulang dialognya
    } catch (e) {
      setNote(reasonOf(e) === "answering" ? NOTE.answering : NOTE.failed);
    } finally {
      setBusy(false);
    }
  }

  async function send(answer: Omit<SessionDialogAnswer, "screenHash">) {
    if (!payload || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await api.answerSessionDialog(sessionId, { screenHash: payload.screenHash, ...answer });
      setSent(true);
    } catch (e) {
      const reason = reasonOf(e);
      // `stale` adalah satu-satunya kegagalan yang bisa dibereskan di tempat: layar berganti, jadi
      // pertanyaannya dimuat ulang. Sisanya butuh manusia pindah ke Terminal.
      if (reason === "stale") { setNote(NOTE.stale); setReload((n) => n + 1); }
      else if (reason === "deciding") setNote(NOTE.deciding);
      else setNote(NOTE.failed);
    } finally {
      setBusy(false);
    }
  }

  const flat = reduced ? { transition: "none", transform: "none" } : undefined;
  const box: React.CSSProperties = {
    marginTop: 8, padding: "8px 10px", background: "var(--bone-100)",
    border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
  };
  const noteLine = (line: string) => (
    <div data-testid="pet-answer-note" style={{
      fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45,
    }}>{line}</div>
  );

  if (sent) {
    return (
      <div style={box}>
        <div data-testid="pet-answer-sent" style={{
          fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--text-strong)",
        }}>Terkirim — menunggu {label} bergerak</div>
      </div>
    );
  }
  // Payload event tiba lewat siaran dan tak menunggu scrape apa pun — jadi ia dirender di ATAS
  // ketiga cabang keluar di bawah, termasuk saat `GET …/dialog` menyerah.
  const asked = ask?.questions[Math.min(ask.at, Math.max(0, ask.questions.length - 1))];
  const head = ask ? (
    <div style={{ marginBottom: 6 }}>
      <div data-testid="pet-answer-lead-state" className="hn-eyebrow">{LEAD_STATE[ask.state]}</div>
      {ask.total > 1 && (
        <div className="hn-eyebrow" style={{ marginTop: 2 }}>
          Pertanyaan {Math.min(ask.at + 1, ask.total)} dari {ask.total}
        </div>
      )}
      {/* Sesi codex tak punya `AskUserQuestion`: yang ada cuma teks giliran terakhirnya. Katakan
          itu apa adanya alih-alih merendernya sebagai pertanyaan berpilihan yang opsinya tak ada. */}
      {ask.source === "turn-end" && (
        <div data-testid="pet-answer-source" className="hn-eyebrow" style={{ marginTop: 2 }}>
          Giliran terakhir sesi
        </div>
      )}
      {(asked?.question || ask.message) && (
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600,
          color: "var(--text-strong)", lineHeight: 1.4, marginTop: 4 }}>
          {asked?.question || ask.message}
        </div>
      )}
      {ask.state !== "taken-over" && (
        <div style={{ marginTop: 6 }}>
          <Button data-testid="pet-answer-takeover" size="sm" variant="ghost" disabled={busy}
            style={flat} onClick={() => { void takeover(); }}>Ambil alih</Button>
        </div>
      )}
    </div>
  ) : null;

  if (payload === undefined) return <div style={box}>{head}{noteLine(NOTE.loading)}</div>;
  // Payload event ada tapi dialognya belum tergambar — `PreToolUse` menembak SEBELUM tool-nya
  // jalan, jadi jendela itu nyata. Pertanyaannya sudah terbaca; kotak jawabnya belum bisa dipasang.
  // Satu baris catatan, bukan dua: hasil aksi terakhir (`note`) MENANG atas kalimat keadaan, karena
  // ia yang baru saja dijawab operator.
  if (payload === null)
    return <div style={box}>{head}{noteLine(note ?? (ask ? NOTE.preparing : NOTE.none))}</div>;

  const { dialog } = payload;
  const answered = dialog.tabs.filter((t) => t.answered).length;
  return (
    <div data-testid="pet-answer" data-session={sessionId} style={box}>
      {head}
      {!ask && dialog.tabs.length > 1 && (
        <div className="hn-eyebrow" style={{ marginBottom: 4 }}>
          Pertanyaan {Math.min(answered + 1, dialog.tabs.length)} dari {dialog.tabs.length}
        </div>
      )}
      {!ask && dialog.title && (
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600,
          color: "var(--text-strong)", lineHeight: 1.4, marginBottom: 6 }}>{dialog.title}</div>
      )}
      {dialog.multi ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {dialog.options.map((o) => (
            <Checkbox key={o.n} label={o.label} checked={picked.includes(o.n)} disabled={busy}
              onChange={(on: boolean) => setPicked((v) =>
                (on ? [...v, o.n] : v.filter((n) => n !== o.n)).sort((a, b) => a - b))} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {dialog.options.map((o) => (
            <Button key={o.n} data-testid="pet-answer-option" size="sm" variant="ghost"
              disabled={busy} style={flat}
              onClick={() => { void send({ choice: o.n }); }}>{o.label}</Button>
          ))}
        </div>
      )}
      {(dialog.freeIndex !== null || dialog.notes) && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Input data-testid="pet-answer-text" size="sm" value={text} disabled={busy}
            placeholder="Jawab dengan kalimatmu sendiri" style={{ flex: 1, minWidth: 0 }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)} />
          {!dialog.multi && (
            <Button size="sm" variant="ghost" disabled={busy || !text.trim()} style={flat}
              onClick={() => { void send({ text: text.trim() }); }}>Kirim</Button>
          )}
        </div>
      )}
      {dialog.multi && (
        <div style={{ marginTop: 8 }}>
          <Button data-testid="pet-answer-submit" size="sm" variant="primary" disabled={busy} style={flat}
            onClick={() => { void send({ choices: picked, ...(text.trim() ? { text: text.trim() } : {}) }); }}>
            Submit
          </Button>
        </div>
      )}
      {note && <div style={{ marginTop: 6 }}>{noteLine(note)}</div>}
    </div>
  );
}
