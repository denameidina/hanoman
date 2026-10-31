/* ImageViewer (ADR-0233) — penampil gambar ber-zoom untuk mockup UI (dan lampiran gambar). Dibangun di atas
   Modal DS supaya fokus, Esc, dan latar inert sama dengan dialog lain; isinya kanvas transform.

   Model koordinat: lapisan gambar berukuran natural, `transform-origin: 0 0`, digeser `translate(x,y)` lalu
   `scale(s)`. Zoom di titik p (koordinat kanvas) menjaga titik itu diam: x' = p − (p − x)·s'/s.
   State gerak hidup di ref dan ditulis langsung ke style (dikoalesir rAF untuk pointer/roda), jadi
   menggeser tidak me-render ulang React; yang ikut state hanya label persen zoom. */
import React from "react";
import { Modal } from "./kit";
import { Icon } from "./icon";
import { IconButton } from "./components/forms";

export type ViewerImage = { src: string; name: string; href?: string };

const MIN = 0.1;
const MAX = 8;
const STEP = 1.25;
const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s));

export function ImageViewer({ images, index, onIndex, onClose, title = "Mockup" }: {
  images: ViewerImage[]; index: number; onIndex: (i: number) => void; onClose: () => void; title?: string;
}) {
  const img = images[index];
  const stageRef = React.useRef<HTMLDivElement>(null);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const view = React.useRef({ s: 1, x: 0, y: 0 });
  const natural = React.useRef({ w: 0, h: 0 });
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const pinch = React.useRef<{ dist: number; s: number } | null>(null);
  const frame = React.useRef(0);
  const [pct, setPct] = React.useState(100);
  const many = images.length > 1;

  const apply = React.useCallback(() => {
    frame.current = 0;
    const { s, x, y } = view.current;
    if (layerRef.current) layerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    setPct(Math.round(s * 100));
  }, []);
  const schedule = React.useCallback(() => {
    if (typeof requestAnimationFrame !== "function") return apply();
    if (!frame.current) frame.current = requestAnimationFrame(apply);
  }, [apply]);
  React.useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  const stageSize = () => {
    const r = stageRef.current?.getBoundingClientRect();
    return { w: r?.width ?? 0, h: r?.height ?? 0 };
  };
  const center = (s: number) => {
    const st = stageSize();
    view.current = { s, x: (st.w - natural.current.w * s) / 2, y: (st.h - natural.current.h * s) / 2 };
  };
  const fit = React.useCallback(() => {
    const st = stageSize();
    const { w, h } = natural.current;
    center(w && h && st.w && st.h ? clamp(Math.min(st.w / w, st.h / h)) : 1);
    apply();
  }, [apply]);
  const zoomAt = (factor: number, px?: number, py?: number) => {
    const st = stageSize();
    const { s, x, y } = view.current;
    const next = clamp(s * factor);
    const cx = px ?? st.w / 2;
    const cy = py ?? st.h / 2;
    view.current = { s: next, x: cx - (cx - x) * (next / s), y: cy - (cy - y) * (next / s) };
  };
  const actualSize = () => { zoomAt(1 / view.current.s); apply(); };

  // Ganti gambar → Fit. Gambar dari cache bisa sudah `complete` sebelum efek ini jalan (onLoad-nya
  // sudah lewat), jadi ukuran natural dibaca dari elemennya; sisanya menunggu onLoad.
  React.useEffect(() => {
    const el = imgRef.current;
    natural.current = el?.complete && el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : { w: 0, h: 0 };
    fit();
  }, [index, fit]);

  // Roda: listener non-pasif supaya halaman di belakang tak ikut menggulir. Pinch trackpad datang
  // sebagai `wheel` + ctrlKey dengan delta kecil — dipercepat agar terasa sama dengan roda.
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      schedule();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // Keyboard di atas Modal (yang sudah memegang Esc & Tab).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") { zoomAt(STEP); apply(); }
      else if (e.key === "-" || e.key === "_") { zoomAt(1 / STEP); apply(); }
      else if (e.key === "0") fit();
      else if (e.key === "ArrowRight" && many) onIndex((index + 1) % images.length);
      else if (e.key === "ArrowLeft" && many) onIndex((index - 1 + images.length) % images.length);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const local = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 } : null;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const sp = spread();
    pinch.current = sp ? { dist: sp.dist, s: view.current.s } : null;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const sp = spread();
    if (sp && pinch.current) {
      zoomAt((pinch.current.s * (sp.dist / pinch.current.dist)) / view.current.s, sp.mx, sp.my);
    } else if (pointers.current.size === 1) {
      view.current = { ...view.current, x: view.current.x + p.x - prev.x, y: view.current.y + p.y - prev.y };
    }
    schedule();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const sp = spread();
    pinch.current = sp ? { dist: sp.dist, s: view.current.s } : null;
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    const st = stageSize();
    const { w, h } = natural.current;
    const fitScale = w && h ? clamp(Math.min(st.w / w, st.h / h)) : 1;
    if (Math.abs(view.current.s - fitScale) < 0.01) { zoomAt(1 / view.current.s, e.clientX - r.left, e.clientY - r.top); apply(); }
    else fit();
  };

  if (!img) return null;
  return (
    <Modal open title={title} eyebrow={`${index + 1} / ${images.length} · ${img.name}`} icon="image"
      onClose={onClose} width={1280} fillHeight>
      <div className="hn-viewer" data-testid="image-viewer">
        <div className="hn-viewer-toolbar" role="toolbar" aria-label="Kontrol zoom">
          {many && <IconButton icon="chevron-left" label="Sebelumnya" size="sm"
            onClick={() => onIndex((index - 1 + images.length) % images.length)} />}
          {many && <IconButton icon="chevron-right" label="Berikutnya" size="sm"
            onClick={() => onIndex((index + 1) % images.length)} />}
          <span className="hn-viewer-spacer" />
          <IconButton icon="zoom-out" label="Perkecil" size="sm" onClick={() => { zoomAt(1 / STEP); apply(); }} />
          <output className="hn-viewer-pct" aria-live="polite" data-testid="image-viewer-zoom">{pct}%</output>
          <IconButton icon="zoom-in" label="Perbesar" size="sm" onClick={() => { zoomAt(STEP); apply(); }} />
          <button type="button" className="hn-viewer-chip" onClick={fit}>Fit</button>
          <button type="button" className="hn-viewer-chip" onClick={actualSize}>100%</button>
          <a className="hn-viewer-chip" href={img.href ?? img.src} target="_blank" rel="noreferrer">
            <Icon name="external-link" size={14} /> Buka asli
          </a>
        </div>
        <div ref={stageRef} className="hn-viewer-stage" data-testid="image-viewer-stage"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}>
          <div ref={layerRef} className="hn-viewer-layer">
            <img ref={imgRef} key={img.src} src={img.src} alt={img.name} draggable={false}
              onLoad={(e) => {
                natural.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight };
                fit();
              }} />
          </div>
        </div>
        {many && (
          <div className="hn-viewer-strip" role="group" aria-label="Daftar gambar">
            {images.map((it, i) => (
              <button key={it.src} type="button" className="hn-viewer-thumb"
                aria-label={`${i + 1}: ${it.name}`} aria-current={i === index ? "true" : undefined}
                onClick={() => onIndex(i)}>
                <img src={it.src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
