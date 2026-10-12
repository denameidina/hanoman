/* Menu konteks bersama IDE (Riwayat & Berkas). Dipindah dari GitGraph.tsx supaya menu baris pohon
   berkas memakai perilaku yang sama: fokus masuk ke item pertama, panah/Home/End, Escape menutup
   dan mengembalikan fokus ke pemicu, klik di luar menutup.
   Audit UI/UX 2026-10 (3H) · item boleh diberi `group`; item dengan grup yang sama dikumpulkan di
   bawah satu judul (role="group"), sehingga menu commit yang panjang tak lagi datar. */
import React from "react";

export type MenuItem = { label: string; run: () => void; group?: string };

export function Menu({ x, y, items, onClose, returnFocus }: {
  x: number; y: number; items: MenuItem[]; onClose: () => void; returnFocus?: HTMLElement | null;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useLayoutEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = active && active !== document.body ? active : returnFocus;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => previous?.focus();
  }, []);
  React.useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeRef.current();
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, []);
  const onKeyDown = (event: React.KeyboardEvent) => {
    const controls = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = Math.max(0, controls.indexOf(document.activeElement as HTMLButtonElement));
    let next: number | null = null;
    if (event.key === "Escape") closeRef.current();
    else if (event.key === "ArrowDown") next = (current + 1) % controls.length;
    else if (event.key === "ArrowUp") next = (current - 1 + controls.length) % controls.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = controls.length - 1;
    else return;
    event.preventDefault();
    if (next !== null) controls[next]?.focus();
  };
  const safe = (name: string) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
  const safeLeft = safe("--safe-left"), safeRight = safe("--safe-right");
  const safeTop = safe("--safe-top"), safeBottom = safe("--safe-bottom");
  const menuHeight = Math.min(360, items.length * 44 + 8, window.innerHeight - safeTop - safeBottom - 16);
  const left = Math.max(8 + safeLeft, Math.min(x, window.innerWidth - safeRight - 228));
  const top = Math.max(8 + safeTop, Math.min(y, window.innerHeight - safeBottom - menuHeight - 8));

  const button = (it: MenuItem, index: number) => (
    <button role="menuitem" key={`${index}-${it.label}`} onClick={() => { it.run(); closeRef.current(); }}
      className="hn-ide-menu-item"
      style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none",
        background: "transparent", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 12.5,
        color: "var(--text-body)", borderRadius: 4 }}>{it.label}</button>
  );
  // Kumpulkan item berurutan per grup. Item tanpa grup tampil langsung (tanpa judul).
  const sections: { group?: string; items: { it: MenuItem; index: number }[] }[] = [];
  items.forEach((it, index) => {
    const last = sections[sections.length - 1];
    if (last && last.group === it.group) last.items.push({ it, index });
    else sections.push({ group: it.group, items: [{ it, index }] });
  });
  return (
    <div ref={rootRef} role="menu" onKeyDown={onKeyDown} className="hn-ide-menu" style={{ position: "fixed", left, top, zIndex: 150, background: "var(--surface-card)",
      border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-lg)",
      padding: 4, minWidth: 180, maxWidth: "calc(100vw - var(--safe-left) - var(--safe-right) - 16px)",
      maxHeight: "calc(100dvh - var(--safe-top) - var(--safe-bottom) - 16px)", overflowY: "auto" }}>
      {sections.map((s, i) => s.group
        ? (
          <div key={`g${i}`} role="group" aria-label={s.group} className="hn-ide-menu-group">
            <div aria-hidden="true" className="hn-ide-menu-group-title">{s.group}</div>
            {s.items.map(({ it, index }) => button(it, index))}
          </div>
        )
        : s.items.map(({ it, index }) => button(it, index)))}
    </div>
  );
}
