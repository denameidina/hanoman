import { vi } from "vitest";

export function mockViewport(width: number) {
  let current = width;
  type Listener = (event: MediaQueryListEvent) => void;
  const listeners = new Map<string, Set<Listener>>();
  const matches = (query: string): boolean => {
    const min = /min-width:\s*(\d+)px/.exec(query)?.[1];
    const max = /max-width:\s*(\d+)px/.exec(query)?.[1];
    const pointer = query.includes("pointer: coarse");
    return pointer
      ? current < 1200
      : (!min || current >= Number(min)) && (!max || current <= Number(max));
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => {
      return {
        media: query,
        get matches() { return matches(query); },
        onchange: null,
        addEventListener: (_: string, listener: Listener) => {
          const set = listeners.get(query) ?? new Set<Listener>();
          set.add(listener);
          listeners.set(query, set);
        },
        removeEventListener: (_: string, listener: Listener) => listeners.get(query)?.delete(listener),
        addListener: (listener: Listener) => {
          const set = listeners.get(query) ?? new Set<Listener>();
          set.add(listener);
          listeners.set(query, set);
        },
        removeListener: (listener: Listener) => listeners.get(query)?.delete(listener),
        dispatchEvent: vi.fn(),
      };
    }),
  });
  return {
    resize(next: number) {
      current = next;
      for (const [query, set] of listeners) {
        const event = { matches: matches(query), media: query } as MediaQueryListEvent;
        for (const listener of set) listener(event);
      }
    },
  };
}

export function resetViewport() {
  Reflect.deleteProperty(window, "matchMedia");
}
