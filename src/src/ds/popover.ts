import React from "react";

type PopoverKind = "dialog" | "menu";

export function usePopoverFocus(open: boolean, onClose: () => void, kind: PopoverKind) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = active && active !== document.body ? active : triggerRef.current;
    const selector = kind === "menu"
      ? '[role="menuitem"]'
      : 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    (panelRef.current.querySelector<HTMLElement>(selector) ?? panelRef.current).focus();
    return () => previous?.focus();
  }, [kind, open]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeRef.current();
      return;
    }
    if (kind !== "menu") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }, [kind]);

  return { triggerRef, panelRef, panelId, onKeyDown };
}
