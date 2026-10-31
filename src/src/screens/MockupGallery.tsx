/* MockupGallery (ADR-0233) — mockup UI hasil fase Mockup (`docs/mockups/<spec-id>/`). Daftarnya dimuat saat
   komponen muncul/dibuka, bukan di-poll (ADR-0039): mockup berubah hanya saat agen merevisinya, dan
   operator membuka galeri justru sesudah ditanya. URL gambar membawa `?v=<modifiedAt>` supaya revisi
   (nama sama, isi baru) tak tertahan cache browser.

   Tiga titik masuk: dialog tanya sesi (`variant="button"`), detail backlog (`variant="section"`), dan
   chip fase Mockup (`MockupViewer`, langsung membuka viewer). */
import React from "react";
import { createPortal } from "react-dom";
import type { MockupItem } from "@hanoman/shared";
import { ImageViewer, Modal, StateBlock, type ViewerImage } from "../ds";
import { api } from "../api/client";
import "./styles/dialogs.css";

type Load = { state: "loading" } | { state: "error" } | { state: "ok"; items: MockupItem[] };

function useMockups(specId: string): Load {
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  React.useEffect(() => {
    let alive = true;
    setLoad({ state: "loading" });
    // `?.` — layar yang me-mock `../api/client` sebagian tak punya method ini (pola SpecAttachmentsPanel).
    Promise.resolve(api.specMockups?.(specId))
      .then((r) => { if (alive) setLoad(Array.isArray(r?.items) ? { state: "ok", items: r.items } : { state: "error" }); })
      .catch(() => { if (alive) setLoad({ state: "error" }); });
    return () => { alive = false; };
  }, [specId]);
  return load;
}

const toImages = (specId: string, items: MockupItem[]): ViewerImage[] =>
  items.map((m) => ({ src: api.mockupSrc(specId, m.name, m.modifiedAt), name: m.name }));

export function MockupGallery({ specId, variant }: { specId: string; variant: "section" | "button" }) {
  const load = useMockups(specId);
  const [open, setOpen] = React.useState<number | null>(null);
  if (load.state === "loading") return null;
  if (load.state === "error")
    return variant === "section" ? <div className="hn-mockup-error">Mockup tak bisa dimuat</div> : null;
  if (!load.items.length) return null;
  const images = toImages(specId, load.items);
  const viewer = open !== null && (
    <ImageViewer images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
  );

  if (variant === "button") {
    return (
      <>
        <button type="button" data-testid="mockup-open" className="hn-mockup-open" onClick={() => setOpen(0)}>
          Lihat mockup ({images.length})
        </button>
        {viewer}
      </>
    );
  }
  return (
    <div className="hn-mockup-section" data-testid="mockup-section">
      <div className="hn-eyebrow hn-att-eyebrow">Mockup</div>
      <div className="hn-mockup-grid">
        {images.map((img, i) => (
          <button key={img.src} type="button" className="hn-mockup-thumb" aria-label={`Lihat mockup ${img.name}`}
            onClick={() => setOpen(i)}>
            <img src={img.src} alt="" loading="lazy" />
            <span className="hn-mockup-name">{img.name}</span>
          </button>
        ))}
      </div>
      {viewer}
    </div>
  );
}

/** Chip fase Mockup: muat lalu langsung tampilkan viewer; kosong/galat dijelaskan, bukan diam. */
export function MockupViewer({ specId, onClose }: { specId: string; onClose: () => void }) {
  const load = useMockups(specId);
  const [index, setIndex] = React.useState(0);
  if (load.state === "loading") return null;
  if (load.state === "ok" && load.items.length)
    return <ImageViewer images={toImages(specId, load.items)} index={index} onIndex={setIndex} onClose={onClose} />;
  return createPortal(
    <Modal open title="Mockup" icon="image" onClose={onClose}>
      {load.state === "error"
        ? <StateBlock kind="error" icon="image" title="Mockup tak bisa dimuat" hint={specId} />
        : <StateBlock kind="empty" icon="image" title="Belum ada mockup" hint={`docs/mockups/${specId.toLowerCase()}/`} />}
    </Modal>,
    document.body,
  );
}
