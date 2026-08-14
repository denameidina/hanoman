import { vi } from "vitest";

export function mockViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query)?.[1];
      const max = /max-width:\s*(\d+)px/.exec(query)?.[1];
      const pointer = query.includes("pointer: coarse");
      return {
        media: query,
        matches: pointer ? width < 1200 : (!min || width >= Number(min)) && (!max || width <= Number(max)),
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

export function resetViewport() {
  Reflect.deleteProperty(window, "matchMedia");
}
