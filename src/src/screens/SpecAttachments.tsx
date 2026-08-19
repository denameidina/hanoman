/* SPEC-843 · ADR-0124 · lampiran backlog item. Dua mode, satu berkas: `AttachmentPicker` untuk form
   BUAT (berkas belum punya specId, jadi ditahan di memori sampai item lahir) dan
   `SpecAttachmentsPanel` untuk detail item yang sudah ada. Keduanya berbagi tampilan kartu. */
import React from "react";
import { Button, Icon, IconButton } from "../ds";
import { paths, type SpecAttachmentView } from "@hanoman/shared";
import { api } from "../api/client";

// Cermin allowlist server (`services/spec-attachment.ts` + `DOCUMENT_TYPES`). Mime DAN ekstensi
// disebut keduanya: picker macOS menyaring lewat ekstensi, Linux lewat mime.
export const ATTACHMENT_ACCEPT = [
  "image/png", "image/jpeg", "image/webp", "application/pdf",
  "text/markdown", "text/plain", "application/json", "text/csv",
  ".png", ".jpg", ".jpeg", ".webp", ".pdf", ".md", ".txt", ".log", ".json", ".csv",
].join(",");

const isImage = (mime: string) => mime.startsWith("image/");
const iconFor = (mime: string): string =>
  mime === "application/pdf" ? "file-text" : mime === "text/csv" ? "table" : "file";

export const humanSize = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : n >= 1024 ? `${Math.round(n / 1024)} KB`
    : `${n} B`;

const CARD: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
  border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)",
  background: "var(--surface-card)", fontSize: 13,
};

const THUMB: React.CSSProperties = {
  width: 44, height: 44, objectFit: "cover", borderRadius: "var(--radius-xs)",
  border: "1px solid var(--border-hair)", display: "block", flexShrink: 0,
};

const NAME: React.CSSProperties = { flex: 1, color: "var(--text-strong)", wordBreak: "break-all" };
const META: React.CSSProperties = { color: "var(--text-subtle)", fontSize: 12, whiteSpace: "nowrap" };

function Dropzone({ children, onFiles }: { children?: React.ReactNode; onFiles: (f: File[]) => void }) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div data-dropzone
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const list = Array.from(e.dataTransfer?.files ?? []);
        if (list.length) onFiles(list);
      }}
      style={{
        border: `1px dashed ${over ? "var(--accent)" : "var(--border-hair)"}`,
        borderRadius: "var(--radius-sm)", padding: 12,
        background: over ? "var(--accent-tint)" : "transparent", transition: "background 120ms",
      }}>
      <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} style={{ display: "none" }}
        aria-label="Pilih lampiran"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length) onFiles(list);
        }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Icon name="paperclip" size={14} />
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          Seret berkas ke sini — gambar, .md, .txt, .log, .json, .csv, .pdf
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" leftIcon="upload"
          onClick={() => input.current?.click()}>Pilih berkas</Button>
      </div>
      {children}
    </div>
  );
}

/** Mode STAGED: lampiran belum punya specId, jadi ditahan di memori sampai item lahir. */
export function AttachmentPicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  return (
    <Dropzone onFiles={(list) => onChange([...files, ...list])}>
      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} style={CARD}>
              <Icon name={isImage(f.type) ? "image" : iconFor(f.type)} size={16} />
              <span style={NAME}>{f.name}</span>
              <span style={META}>{humanSize(f.size)}</span>
              <IconButton size="sm" icon="x" label={`Buang ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
    </Dropzone>
  );
}

export type AttachmentToast = (msg: string, tone?: "ok" | "warn" | "err") => void;

/** Mode LIVE: daftar dari server, unggah & hapus kapan saja — termasuk selagi sesi berjalan. */
export function SpecAttachmentsPanel({ specId, onToast }: { specId: string; onToast: AttachmentToast }) {
  const [items, setItems] = React.useState<SpecAttachmentView[]>([]);
  const [busy, setBusy] = React.useState(false);

  // Dua penjagaan, dua sebab berbeda — keduanya kelas "detail backlog roboh seluruhnya":
  // `?.` untuk klien yang tak punya method ini (layar yang me-mock `../api/client` sebagian, pola
  // `api.getEscalation?.()` yang sudah ada di BacklogScreen), dan `Array.isArray` untuk respons
  // yang bentuknya bukan amplop ini — `setItems(undefined)` melempar di render berikutnya, bukan
  // di sini, jadi jejaknya menunjuk ke tempat yang salah. Bentuk yang tak dikenali membiarkan
  // daftar terakhir berdiri, bukan mengosongkannya: kedip jaringan bukan "lampiran dihapus".
  const load = React.useCallback(async () => {
    const r = await api.listSpecAttachments?.(specId).catch(() => null);
    if (Array.isArray(r?.attachments)) setItems(r.attachments);
  }, [specId]);
  React.useEffect(() => { void load(); }, [load]);

  async function upload(files: File[]) {
    setBusy(true);
    try {
      const r = await api.uploadSpecAttachments(specId, files);
      // Penolakan per-berkas TIDAK boleh senyap: unggahan parsial yang terlihat sukses adalah kelas
      // kegagalan tersendiri.
      if (r.rejected.length)
        onToast(`${r.rejected.length} berkas ditolak: ${r.rejected.map((x) => x.filename).join(", ")}`, "warn");
      if (r.saved.length) onToast(`${r.saved.length} lampiran ditambahkan`, "ok");
      await load();
    } catch { onToast("Gagal mengunggah lampiran", "err"); }
    finally { setBusy(false); }
  }

  async function remove(a: SpecAttachmentView) {
    setBusy(true);
    try { await api.deleteSpecAttachment(specId, a.id); await load(); }
    catch { onToast("Gagal menghapus lampiran", "err"); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="hn-eyebrow" style={{ marginBottom: 4 }}>Lampiran</div>
      <Dropzone onFiles={(f) => void upload(f)}>
        {items.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {items.map((a) => (
              <div key={a.id} style={CARD}>
                {isImage(a.mimeType)
                  ? <img src={paths.specAttachment(specId, a.id)} alt={a.filename} style={THUMB} />
                  : <Icon name={iconFor(a.mimeType)} size={16} />}
                <span style={NAME}>{a.filename}</span>
                <span style={META}>{humanSize(a.size)}</span>
                <a href={paths.specAttachment(specId, a.id)} download={a.filename}
                  aria-label={`Unduh ${a.filename}`} title={`Unduh ${a.filename}`}
                  style={{ display: "inline-flex", color: "var(--text-muted)" }}>
                  <Icon name="download" size={15} />
                </a>
                <IconButton size="sm" icon="trash-2" disabled={busy}
                  label={`Hapus lampiran ${a.filename}`} onClick={() => void remove(a)} />
              </div>
            ))}
          </div>
        )}
      </Dropzone>
    </div>
  );
}
