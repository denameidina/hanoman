/* SPEC-489 · Kartu "Dokumentasi AI Agent" — permukaan MANUSIA untuk naskah yang dibaca AGEN.
   Yang dirender di sini adalah respons `GET /api/agent-integration.md` itu sendiri, bukan salinan:
   kendala fitur ini adalah satu sumber tulisan, jadi dashboard dan GitHub tak boleh bisa berbeda
   (pola WebhookDocs SPEC-481, hanya saja sumbernya berkas markdown, bukan katalog data). */
import React from "react";
import { Card, Button, StateBlock, DocPreviewModal } from "../ds";
import type { ShowToast } from "../ds";
import { paths } from "@hanoman/shared";
import { api } from "../api/client";
import { failureMessage } from "../lib/report-error";

const GITHUB = "https://github.com/denameidina/hanoman/blob/main/docs/agent-integration.md";

export function AgentDocCard({ onToast }: { onToast?: ShowToast }) {
  const [text, setText] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [err, setErr] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Absolut: nilainya disalin ke agen yang jalan di mesin lain, jadi path relatif tak berguna.
  const url = `${window.location.origin}${paths.agentDoc}`;

  async function buka() {
    if (busy) return;
    if (text) { setOpen(true); return; }
    setBusy(true); setErr(false);
    // Modal baru dibuka setelah isinya ADA — modal kosong yang lalu terisi terbaca sebagai rusak.
    try { setText(await api.agentDoc()); setOpen(true); }
    catch { setErr(true); }
    finally { setBusy(false); }
  }

  async function salin() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard tidak tersedia di browser ini");
      await navigator.clipboard.writeText(url);
      onToast?.("Tautan disalin", "ok", "copy");
    } catch (e) { onToast?.(failureMessage("menyalin link", e), "err"); }
  }

  return (
    <>
      <Card eyebrow="dokumentasi" title="Dokumentasi AI Agent">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Satu halaman yang membuat agen mana pun bisa langsung bekerja — cukup berikan
          {" "}<b>tautan ini + satu agent token</b>. Markdown mentah, bisa diambil agen lewat HTTP
          biasa, <b>tanpa auth</b>.
        </div>
        <code style={{ display: "block", wordBreak: "break-all", fontSize: 12, marginBottom: 10 }}>{url}</code>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button size="sm" leftIcon="copy" onClick={() => void salin()}>Salin tautan</Button>
          <Button size="sm" variant="ghost" leftIcon="book-open" disabled={busy}
            onClick={() => void buka()}>{busy ? "Memuat…" : "Buka"}</Button>
          <Button as="a" size="sm" variant="ghost" leftIcon="external-link" href={GITHUB} target="_blank" rel="noreferrer">
            Lihat di GitHub
          </Button>
        </div>
        {err && (
          <div style={{ marginTop: 12 }}>
            <StateBlock kind="error" compact title="Gagal memuat dokumentasi" hint={url}
              action={() => void buka()} actionLabel="Coba lagi" />
          </div>
        )}
      </Card>

      {open && text !== null && (
        <DocPreviewModal path="agent-integration.md" text={text}
          eyebrow="hanoman · panduan AI agent" onClose={() => setOpen(false)} />
      )}
    </>
  );
}
