import React from "react";
import { Tabs } from "./components/ui";

export type ResponsiveTier = "mobile" | "tablet" | "desktop";

export const MOBILE_MAX = 767;
export const TABLET_MAX = 1199;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX}px)`;
export const TABLET_QUERY = `(min-width: ${MOBILE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`;
export const DESKTOP_QUERY = `(min-width: ${TABLET_MAX + 1}px)`;

export function responsiveTier(width: number): ResponsiveTier {
  if (width <= MOBILE_MAX) return "mobile";
  if (width <= TABLET_MAX) return "tablet";
  return "desktop";
}

function tierFromMedia(): ResponsiveTier {
  if (typeof window === "undefined") return "desktop";
  if (typeof window.matchMedia !== "function") return responsiveTier(window.innerWidth);
  if (window.matchMedia(MOBILE_QUERY).matches) return "mobile";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "desktop";
}

function subscribeTier(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const queries = [MOBILE_QUERY, TABLET_QUERY, DESKTOP_QUERY].map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

export function useResponsiveTier(): ResponsiveTier {
  return React.useSyncExternalStore(subscribeTier, tierFromMedia, () => "desktop");
}

const COARSE_QUERY = "(pointer: coarse)";

export function useCoarsePointer(): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
    const query = window.matchMedia(COARSE_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const snapshot = React.useCallback(() => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(COARSE_QUERY).matches, []);
  return React.useSyncExternalStore(subscribe, snapshot, () => false);
}

export type ResponsivePanel = {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode;
  className?: string;
};

export function ResponsivePanels({
  panels,
  active,
  onActiveChange,
  ariaLabel,
  splitAt = "tablet",
  masterWidth,
  className = "",
  style,
}: {
  panels: readonly ResponsivePanel[];
  active: string;
  onActiveChange: (id: string) => void;
  ariaLabel: string;
  splitAt?: "tablet" | "desktop";
  masterWidth?: number | string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const tier = useResponsiveTier();
  const split = tier === "desktop" || (tier === "tablet" && splitAt === "tablet");
  const panelRefs = React.useRef(new Map<string, HTMLElement>());
  const previous = React.useRef({ active, split });
  const rootStyle = masterWidth === undefined
    ? style
    : ({ "--hn-master-width": typeof masterWidth === "number" ? `${masterWidth}px` : masterWidth, ...style } as React.CSSProperties);

  React.useLayoutEffect(() => {
    const changedPanel = previous.current.active !== active;
    const collapsed = previous.current.split && !split;
    previous.current = { active, split };
    if (!split && (changedPanel || collapsed)) panelRefs.current.get(active)?.focus();
  }, [active, split]);

  return (
    <div
      className={`hn-responsive-panels hn-responsive-panels--${splitAt} ${className}`.trim()}
      data-active-panel={active}
      data-split={split ? "true" : "false"}
      style={{ display: "flex", flex: "1 1 auto", minWidth: 0, minHeight: 0,
        flexDirection: "column", gap: 12, ...rootStyle }}
    >
      <div className="hn-panel-switcher">
        <Tabs
          aria-label={ariaLabel}
          variant="pill"
          value={active}
          onChange={onActiveChange}
          tabs={panels.map((panel) => ({ value: panel.id, label: panel.label }))}
        />
      </div>
      <div className="hn-panels-grid" style={{ display: "grid", flex: "1 1 auto", minWidth: 0, minHeight: 0,
        ...(split && panels.length === 1 ? { gridTemplateColumns: "minmax(0, 1fr)" } : null) }}>
        {panels.map((panel) => {
          const visible = split || panel.id === active;
          return (
            <section
              key={panel.id}
              ref={(element) => {
                if (element) panelRefs.current.set(panel.id, element);
                else panelRefs.current.delete(panel.id);
              }}
              className={`hn-responsive-panel ${panel.className ?? ""}`.trim()}
              data-panel={panel.id}
              role="region"
              aria-label={typeof panel.label === "string" ? panel.label : panel.id}
              aria-hidden={visible ? "false" : "true"}
              tabIndex={-1}
              style={panel.className?.includes("hn-panel-flex")
                ? { display: visible ? "flex" : undefined, flexDirection: "column", minWidth: 0, minHeight: 0 }
                : { minWidth: 0, minHeight: 0 }}
            >
              {panel.content}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export const ResponsiveToolbar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function ResponsiveToolbar({ className = "", ...props }, ref) {
    return <div ref={ref} className={`hn-responsive-toolbar ${className}`.trim()} {...props} />;
  },
);

export const LocalOverflow = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function LocalOverflow({ className = "", ...props }, ref) {
    return <div ref={ref} className={`hn-local-overflow ${className}`.trim()} {...props} />;
  },
);
