/* SPEC-843 · ADR-0124 · lampiran backlog item. Dua mode, satu berkas: `AttachmentPicker` untuk form
   BUAT (berkas belum punya specId, jadi ditahan di memori sampai item lahir) dan
   `SpecAttachmentsPanel` untuk detail item yang sudah ada. Keduanya berbagi tampilan kartu. */
import React from "react";
import { Button, Icon, IconButton, useConfirm } from "../ds";
import { paths, type SpecAttachmentView } from "@hanoman/shared";
import { api } from "../api/client";
import { failureMessage } from "../lib/report-error";
import "./styles/dialogs.css";

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

// Gaya kartu, miniatur, nama, dan meta hidup di `styles/dialogs.css` (`hn-att-*`).
function Dropzone({ children, onFiles }: { children?: React.ReactNode; onFiles: (f: File[]) => void }) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div data-dropzone className="hn-att-drop" data-over={over ? "true" : "false"}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const list = Array.from(e.dataTransfer?.files ?? []);
        if (list.length) onFiles(list);
      }}>
      <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hn-att-input"
        aria-label="Pilih lampiran"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length) onFiles(list);
        }} />
      <div className="hn-att-row">
        <Icon name="paperclip" size={14} />
        <span className="hn-att-hint">
          Seret berkas ke sini — gambar, .md, .txt, .log, .json, .csv, .pdf
        </span>
        <span className="hn-grow" />
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
        <div className="hn-att-list">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="hn-att-card">
              <Icon name={isImage(f.type) ? "image" : iconFor(f.type)} size={16} />
              <span className="hn-att-name">{f.name}</span>
              <span className="hn-att-meta">{humanSize(f.size)}</span>
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
  const { confirm, dialog } = useConfirm();

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
    } catch (e) { onToast(failureMessage("mengunggah lampiran", e), "err"); }
    finally { setBusy(false); }
  }

  // Hapus lampiran = konfirmasi dulu. Berkasnya hilang dari disk (bukan sekadar daftar), dan fase sesi
  // berikutnya tak lagi membacanya — dua hal itu yang harus terbaca sebelum tombol ditekan.
  async function remove(a: SpecAttachmentView) {
    try {
      const ok = await confirm({
        title: `Hapus lampiran ${a.filename}?`,
        impact: [
          "Berkas dihapus dari disk dan tak bisa dikembalikan.",
          "Fase sesi berikutnya tak lagi membaca lampiran ini.",
        ],
        confirmLabel: "Hapus lampiran", tone: "danger", icon: "trash-2",
        run: () => api.deleteSpecAttachment(specId, a.id),
      });
      if (ok) await load();
    } catch (e) { onToast(failureMessage("menghapus lampiran", e), "err"); }
  }

  return (
    <div className="hn-att-panel">
      <div className="hn-eyebrow hn-att-eyebrow">Lampiran</div>
      <Dropzone onFiles={(f) => void upload(f)}>
        {items.length > 0 && (
          <div className="hn-att-list">
            {items.map((a) => (
              <div key={a.id} className="hn-att-card">
                {isImage(a.mimeType)
                  ? <img src={paths.specAttachment(specId, a.id)} alt={a.filename} className="hn-att-thumb" />
                  : <Icon name={iconFor(a.mimeType)} size={16} />}
                <span className="hn-att-name">{a.filename}</span>
                <span className="hn-att-meta">{humanSize(a.size)}</span>
                <a href={paths.specAttachment(specId, a.id)} download={a.filename}
                  aria-label={`Unduh ${a.filename}`} title={`Unduh ${a.filename}`}
                  className="hn-att-link">
                  <Icon name="download" size={15} />
                </a>
                <IconButton size="sm" icon="trash-2" disabled={busy}
                  label={`Hapus lampiran ${a.filename}`} onClick={() => void remove(a)} />
              </div>
            ))}
          </div>
        )}
      </Dropzone>
      {dialog}
    </div>
  );
}
